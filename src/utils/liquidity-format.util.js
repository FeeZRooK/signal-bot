function formatDistance(direction, distancePct) {
  const sign = direction === 'Up' ? '+' : '-';
  return `${sign}${distancePct.toFixed(1)}%`;
}

function formatPrice(value) {
  const absoluteValue = Math.abs(Number(value));

  if (absoluteValue >= 1) {
    return Number(value).toFixed(2);
  }

  if (absoluteValue >= 0.01) {
    return Number(value).toFixed(4);
  }

  return Number(value).toFixed(6);
}

function formatSignedPercent(value) {
  const numericValue = Number(value);
  const sign = numericValue >= 0 ? '+' : '';
  return `${sign}${numericValue.toFixed(2)}%`;
}

function normalizeFocusDirection(value) {
  const normalizedValue = String(value || '').trim().toLowerCase();

  if (normalizedValue === 'up') {
    return 'Up';
  }

  if (normalizedValue === 'down') {
    return 'Down';
  }

  return null;
}

function getLiquidityEmoji() {
  return '💧';
}

function buildGoalLine(context) {
  const currentPrice = Number(context.currentPrice);

  if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
    return null;
  }

  const focus = normalizeFocusDirection(context.focus);
  const focusSide = focus === 'Up' ? context.up : focus === 'Down' ? context.down : null;

  if (!focusSide || !focusSide.exists) {
    return null;
  }

  const targetPrice = Number(focusSide.targetPrice);

  if (!Number.isFinite(targetPrice)) {
    return null;
  }

  const movePct = ((targetPrice - currentPrice) / currentPrice) * 100;

  if ((focus === 'Up' && movePct <= 0) || (focus === 'Down' && movePct >= 0)) {
    return null;
  }

  return `Goal: current ${formatPrice(currentPrice)} \u2192 ${formatPrice(targetPrice)} (${formatSignedPercent(movePct)})`;
}

function formatLiquiditySignal(context) {
  const lines = [`${getLiquidityEmoji()} LIQUIDITY MAP ${context.symbol}`, ''];

  if (context.up && context.up.exists) {
    lines.push(`Up: ${formatDistance('Up', context.up.distancePct)}`);
  }

  if (context.down && context.down.exists) {
    lines.push(`Down: ${formatDistance('Down', context.down.distancePct)}`);
  }

  lines.push('');
  lines.push(`Focus: ${normalizeFocusDirection(context.focus) || context.focus}`);

  const goalLine = buildGoalLine(context);

  if (goalLine) {
    lines.push(goalLine);
  }

  return lines.join('\n');
}

module.exports = {
  buildGoalLine,
  formatLiquiditySignal,
};
