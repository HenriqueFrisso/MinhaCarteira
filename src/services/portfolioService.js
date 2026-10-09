import { supabase } from '../lib/supabase.js';

const fail = ({ data, error }) => {
  if (error) throw error;
  return data;
};

// A interface atual usa valores monetários em centavos.
// O banco normalizado armazena valores monetários em reais (NUMERIC).
const fromCents = value => Number(value ?? 0) / 100;
const toCents = value => Math.round(Number(value ?? 0) * 100);

const mapAsset = row => {
  const asset = row.ativos || {};
  return {
    id: row.id, // ID da posição do usuário, não o ID global do ativo
    ativoId: row.ativo_id,
    name: asset.nome || asset.ticker || '',
    ticker: asset.ticker || '',
    class: asset.classe || '',
    quantity: Number(row.quantidade || 0),
    averagePrice: toCents(row.preco_medio),
    quote: toCents(asset.cotacao_atual),
    quoteDate: asset.data_cotacao
      ? String(asset.data_cotacao).slice(0, 10)
      : null,
    quoteSource: asset.fonte_cotacao || 'manual',
    quoteUpdatedAt: asset.atualizado_em || asset.data_cotacao || null,
  };
};

const mapOperation = row => ({
  id: row.id,
  assetId: row.carteira_ativo_id,
  type: row.tipo,
  date: row.data_movimentacao,
  quantity: Number(row.quantidade || 0),
  value: toCents(Number(row.preco_unitario || 0) * Number(row.quantidade || 0)),
  fees: toCents(row.taxas),
});

export async function loadPortfolio(userId) {
  const positions = fail(await supabase
    .from('carteira_ativos')
    .select(`
      id, ativo_id, quantidade, preco_medio,
      ativos!carteira_ativos_ativo_id_fkey (
        id, ticker, nome, classe, cotacao_atual,
        data_cotacao, fonte_cotacao, atualizado_em
      )
    `)
    .eq('user_id', userId)
    .order('criado_em', { ascending: true })) || [];

  if (!positions.length) return { assets: [], operations: [] };

  const positionIds = positions.map(position => position.id);
  const movements = fail(await supabase
    .from('movimentacoes')
    .select('id, carteira_ativo_id, tipo, data_movimentacao, quantidade, preco_unitario, taxas')
    .in('carteira_ativo_id', positionIds)
    .order('data_movimentacao', { ascending: true })) || [];

  return {
    assets: positions.map(mapAsset),
    operations: movements.map(mapOperation),
  };
}

/**
 * Persiste o estado da interface nas três tabelas normalizadas.
 * Os ativos globais são compartilhados por ticker; quantidade, preço médio
 * e movimentações permanecem vinculados à posição do usuário.
 */
export async function persistPortfolio(userId, portfolio) {
  const assets = portfolio.assets || [];
  const operations = portfolio.operations || [];

  // 1. Cria/atualiza os registros globais de ativos pelo ticker.
  const tickers = [...new Set(
    assets.map(asset => String(asset.ticker || '').trim().toUpperCase()).filter(Boolean)
  )];

  const globalIdByTicker = new Map();

  if (assets.length) {
    const globalRows = assets.map(asset => ({
      ticker: String(asset.ticker || '').trim().toUpperCase(),
      nome: String(asset.name || asset.ticker || '').trim(),
      classe: asset.class || 'Outro',
      moeda: 'BRL',
      cotacao_atual: fromCents(asset.quote),
      data_cotacao: asset.quoteDate
        ? `${asset.quoteDate}T12:00:00.000Z`
        : null,
      fonte_cotacao: asset.quoteSource || 'manual',
      atualizado_em: asset.quoteUpdatedAt || null,
    }));

    const savedGlobals = fail(await supabase
      .from('ativos')
      .upsert(globalRows, { onConflict: 'ticker' })
      .select('id, ticker')) || [];

    for (const row of savedGlobals) {
      globalIdByTicker.set(row.ticker, row.id);
    }

    // Em alguns cenários o PostgREST pode não devolver todas as linhas do upsert.
    const missingTickers = tickers.filter(ticker => !globalIdByTicker.has(ticker));
    if (missingTickers.length) {
      const found = fail(await supabase
        .from('ativos')
        .select('id, ticker')
        .in('ticker', missingTickers)) || [];
      for (const row of found) globalIdByTicker.set(row.ticker, row.id);
    }
  }

  // 2. Persiste as posições específicas do usuário.
  const positionRows = assets.map(asset => {
    const ticker = String(asset.ticker || '').trim().toUpperCase();
    const ativoId = globalIdByTicker.get(ticker) || asset.ativoId;
    if (!ativoId) {
      throw new Error(`Não foi possível localizar o ativo ${ticker || asset.name}.`);
    }
    return {
      id: asset.id,
      user_id: userId,
      ativo_id: ativoId,
      quantidade: Number(asset.quantity || 0),
      preco_medio: fromCents(asset.averagePrice),
    };
  });

  if (positionRows.length) {
    fail(await supabase
      .from('carteira_ativos')
      .upsert(positionRows, { onConflict: 'id' }));
  }

  // 3. Salva o histórico de movimentações ligado à posição do usuário.
  const operationRows = operations.map(operation => ({
    id: operation.id,
    carteira_ativo_id: operation.assetId,
    tipo: operation.type,
    data_movimentacao: operation.date,
    quantidade: Number(operation.quantity || 0),
    // A interface guarda o valor total da movimentação em centavos;
    // o banco guarda preço unitário em reais.
    preco_unitario: Number(operation.quantity)
      ? fromCents(operation.value) / Number(operation.quantity)
      : 0,
    taxas: fromCents(operation.fees),
  }));

  if (operationRows.length) {
    fail(await supabase
      .from('movimentacoes')
      .upsert(operationRows, { onConflict: 'id' }));
  }

  // 4. Remove itens que foram excluídos na interface, sem apagar ativos globais.
  const existingPositions = fail(await supabase
    .from('carteira_ativos')
    .select('id')
    .eq('user_id', userId)) || [];
  const keepPositionIds = new Set(assets.map(asset => asset.id));
  const stalePositionIds = existingPositions
    .map(row => row.id)
    .filter(id => !keepPositionIds.has(id));

  if (stalePositionIds.length) {
    // As movimentações dessas posições são excluídas pela FK ON DELETE CASCADE.
    fail(await supabase
      .from('carteira_ativos')
      .delete()
      .eq('user_id', userId)
      .in('id', stalePositionIds));
  }

  const activePositionIds = assets.map(asset => asset.id);
  if (activePositionIds.length) {
    const existingMovements = fail(await supabase
      .from('movimentacoes')
      .select('id')
      .in('carteira_ativo_id', activePositionIds)) || [];
    const keepMovementIds = new Set(operations.map(operation => operation.id));
    const staleMovementIds = existingMovements
      .map(row => row.id)
      .filter(id => !keepMovementIds.has(id));

    if (staleMovementIds.length) {
      fail(await supabase
        .from('movimentacoes')
        .delete()
        .in('id', staleMovementIds));
    }
  }
}
