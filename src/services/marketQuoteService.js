import { supabase } from '../lib/supabase.js';

const BRAPI_URL = 'https://brapi.dev/api/quote';
const MARKET_CLASSES = new Set(['Ações', 'FIIs', 'ETFs']);

function buildUrl(path, params = {}) {
  const url = new URL(path, 'https://brapi.dev');

  Object.entries(params).forEach(([key, value]) => {
    if (value != null) url.searchParams.set(key, value);
  });

  if (import.meta.env.VITE_BRAPI_TOKEN) {
    url.searchParams.set('token', import.meta.env.VITE_BRAPI_TOKEN);
  }

  return url;
}

async function requestBrapi(url) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        'A API exige um token válido ou acesso ao recurso.'
      );
    }

    throw new Error(`Erro ao consultar a Brapi (${response.status}).`);
  }

  return response.json();
}

function normalizeClass(item) {
  const type = String(item?.type || '').toLowerCase();
  const subType = String(
    item?.subType || item?.subtype || ''
  ).toLowerCase();

  if (subType.includes('fii')) return 'FIIs';
  if (subType.includes('etf')) return 'ETFs';

  if (type === 'fund') return 'FIIs';

  if (
    type === 'stock' ||
    type === 'bdr' ||
    ['stock', 'unit', 'bdr'].includes(subType)
  ) {
    return 'Ações';
  }

  return null;
}

function mapDatabaseAsset(row) {
  return {
    ativoId: row.id,
    ticker: row.ticker,
    name: row.nome || row.ticker,
    class: row.classe,
    // O banco armazena em reais; a interface utiliza centavos.
    quote:
      row.cotacao_atual == null
        ? null
        : Math.round(Number(row.cotacao_atual) * 100),
    quoteDate: row.data_cotacao
      ? String(row.data_cotacao).slice(0, 10)
      : new Date().toISOString().slice(0, 10),
    quoteUpdatedAt:
      row.atualizado_em || row.data_cotacao || null,
    quoteSource: row.fonte_cotacao || 'supabase',
  };
}

async function findAssetInSupabase(symbol) {
  const { data, error } = await supabase
    .from('ativos')
    .select(`
      id,
      ticker,
      nome,
      classe,
      cotacao_atual,
      data_cotacao,
      fonte_cotacao,
      atualizado_em
    `)
    .eq('ticker', symbol)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Não foi possível consultar o ativo no Supabase: ${error.message}`
    );
  }

  return data;
}

async function saveAssetInSupabase(asset) {
  const row = {
    ticker: asset.ticker,
    nome: asset.name,
    classe: asset.class,
    moeda: 'BRL',
    cotacao_atual:
      asset.quote == null ? null : asset.quote / 100,
    data_cotacao: asset.quoteDate
      ? `${asset.quoteDate}T12:00:00.000Z`
      : null,
    fonte_cotacao: asset.quoteSource || 'brapi',
    atualizado_em: asset.quoteUpdatedAt || new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('ativos')
    .upsert(row, { onConflict: 'ticker' })
    .select(`
      id,
      ticker,
      nome,
      classe,
      cotacao_atual,
      data_cotacao,
      fonte_cotacao,
      atualizado_em
    `)
    .single();

  if (error) {
    throw new Error(
      `O ativo foi encontrado na Brapi, mas não foi possível salvá-lo no Supabase: ${error.message}`
    );
  }

  return mapDatabaseAsset(data);
}

async function fetchAssetFromBrapi(symbol) {
  const quoteUrl = new URL(
    `${BRAPI_URL}/${encodeURIComponent(symbol)}`
  );

  if (import.meta.env.VITE_BRAPI_TOKEN) {
    quoteUrl.searchParams.set(
      'token',
      import.meta.env.VITE_BRAPI_TOKEN
    );
  }

  const [quoteBody, listBody] = await Promise.all([
    requestBrapi(quoteUrl),
    requestBrapi(
      buildUrl('/api/quote/list', { search: symbol })
    ),
  ]);

  const quote = (quoteBody.results || []).find(
    item => item.symbol?.toUpperCase() === symbol
  );

  if (!quote) {
    throw new Error(
      'Ativo não encontrado. Confira o código informado.'
    );
  }

  const listedAsset = (listBody.stocks || []).find(
    item =>
      (item.stock || item.symbol)?.toUpperCase() === symbol
  );

  const assetClass = normalizeClass(listedAsset);

  if (!assetClass) {
    throw new Error(
      'Não foi possível identificar o tipo do ativo automaticamente.'
    );
  }

  const now = new Date().toISOString();

  return {
    ticker: quote.symbol.toUpperCase(),
    name: quote.longName || quote.shortName || symbol,
    class: assetClass,
    quote:
      typeof quote.regularMarketPrice === 'number'
        ? Math.round(quote.regularMarketPrice * 100)
        : null,
    quoteDate:
      quote.regularMarketTime?.slice(0, 10) ||
      now.slice(0, 10),
    quoteUpdatedAt: quote.regularMarketTime || now,
    quoteSource:
      typeof quote.regularMarketPrice === 'number'
        ? 'brapi'
        : 'manual',
  };
}

/**
 * Primeiro consulta o Supabase.
 * A Brapi só é consultada quando o ticker ainda não está cadastrado.
 */
export async function fetchBrapiAsset(ticker) {
  const symbol = String(ticker || '').trim().toUpperCase();

  if (!symbol) {
    throw new Error('Informe o código do ativo.');
  }

  const existingAsset = await findAssetInSupabase(symbol);

  if (existingAsset) {
    return mapDatabaseAsset(existingAsset);
  }

  const assetFromBrapi = await fetchAssetFromBrapi(symbol);

  return saveAssetInSupabase(assetFromBrapi);
}

export const supportsAutomaticQuote = asset =>
  MARKET_CLASSES.has(asset.class) &&
  Boolean(asset.ticker?.trim());

export async function fetchBrapiQuotes(assets) {
  const supported = assets.filter(supportsAutomaticQuote);

  if (!supported.length) {
    return { quotes: [], skipped: assets.length };
  }

  const now = new Date().toISOString();
  const quotes = [];
  let failed = 0;

  for (const asset of supported) {
    const symbol = asset.ticker.trim().toUpperCase();

    const url = new URL(
      `${BRAPI_URL}/${encodeURIComponent(symbol)}`
    );

    if (import.meta.env.VITE_BRAPI_TOKEN) {
      url.searchParams.set(
        'token',
        import.meta.env.VITE_BRAPI_TOKEN
      );
    }

    try {
      const body = await requestBrapi(url);

      const item = (body.results || []).find(
        result => result.symbol?.toUpperCase() === symbol
      );

      if (typeof item?.regularMarketPrice !== 'number') {
        failed++;
        console.warn(`Cotação não encontrada para ${symbol}.`);
        continue;
      }

      quotes.push({
        id: asset.id,
        quote: Math.round(item.regularMarketPrice * 100),
        quoteDate:
          item.regularMarketTime?.slice(0, 10) ||
          now.slice(0, 10),
        quoteUpdatedAt: item.regularMarketTime || now,
        quoteSource: 'brapi',
      });
    } catch (error) {
      failed++;
      console.warn(`Falha ao atualizar ${symbol}:`, error.message);
    }
  }

  return {
    quotes,
    skipped: assets.length - quotes.length,
  };
}
