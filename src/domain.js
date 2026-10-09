
export const TYPES = {
  BUY: 'Compra',
  SELL: 'Venda',
  INCOME: 'Provento',
  DEPOSIT: 'Aplicação',
  WITHDRAW: 'Resgate',
};

export const money = value =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value / 100);

export const pct = value =>
  new Intl.NumberFormat('pt-BR', {
    style: 'percent',
    minimumFractionDigits: 2,
  }).format(value);

export function position(asset, ops) {
  // A posição inicial vem do cadastro do ativo.
  let quantity = Number(asset.quantity) || 0;

  // Os valores monetários são armazenados em centavos.
  const averagePrice = Number(
    asset.averagePrice ?? asset.quote ?? 0
  );

  let cost = Math.round(quantity * averagePrice);
  let realized = 0;
  let income = 0;

  const operations = ops
    .filter(operation => operation.assetId === asset.id)
    .sort((a, b) => a.date.localeCompare(b.date));

  for (const op of operations) {
    if ([TYPES.BUY, TYPES.DEPOSIT].includes(op.type)) {
      quantity += op.quantity;
      cost += op.value + op.fees;
    }

    if (op.type === TYPES.SELL) {
      const averageCost = quantity > 0 ? cost / quantity : 0;
      const soldQuantity = Math.min(op.quantity, quantity);
      const soldCost = Math.round(averageCost * soldQuantity);

      quantity -= soldQuantity;
      cost -= soldCost;
      realized += op.value - op.fees - soldCost;
    }

    if (op.type === TYPES.INCOME) {
      income += op.value;
    }

    if (op.type === TYPES.WITHDRAW) {
      // Resgates não alteram a quantidade do ativo.
      // O efeito financeiro depende de como o resgate é registrado.
    }
  }

  const current = Math.round(quantity * (Number(asset.quote) || 0));
  const unrealized = current - cost;
  const totalReturn = income + realized + unrealized;

  return {
    ...asset,
    quantity,
    cost,
    current,
    income,
    realized,
    unrealized,
    totalReturn,
    returnPct: cost ? totalReturn / cost : 0,
  };
}

export function portfolio(assets, ops) {
  const rows = assets.map(asset => position(asset, ops));

  const current = rows.reduce(
    (total, row) => total + row.current,
    0
  );

  const cost = rows.reduce(
    (total, row) => total + row.cost,
    0
  );

  const income = rows.reduce(
    (total, row) => total + row.income,
    0
  );

  const groupedClasses = rows.reduce((groups, row) => {
    const name = row.class || 'Outros';

    if (!groups[name]) {
      groups[name] = {
        name,
        value: 0,
      };
    }

    groups[name].value += row.current;

    return groups;
  }, {});

  const classes = Object.values(groupedClasses);

  return {
    rows,
    current,
    cost,
    income,
    totalReturn: rows.reduce(
      (total, row) => total + row.totalReturn,
      0
    ),
    classes,
  };
}
