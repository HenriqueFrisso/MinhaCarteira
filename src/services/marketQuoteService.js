
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
      throw new Error('A API exige um token válido ou acesso ao recurso.');
    }

    throw new Error(`Erro ao consultar a brapi (${response.status}).`);
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

export async function fetchBrapiAsset(ticker) {
  const symbol = ticker.trim().toUpperCase();

  if (!symbol) {
    throw new Error('Informe o código do ativo.');
  }

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
    ticker: quote.symbol,
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

  // O plano gratuito permite consultar apenas um ticker por requisição.
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

      console.warn(
        `Falha ao atualizar ${symbol}:`,
        error.message
      );
    }
  }

  return {
    quotes,
    skipped: assets.length - quotes.length,
  };
}