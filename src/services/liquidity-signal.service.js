const {
  getClosedKlines,
  getOpenInterest,
  getFundingRate,
  getMarkPrice,
} = require('./binance.service');
const { buildLiquidityContext } = require('./liquidation-model.service');
const { formatLiquiditySignal } = require('../utils/liquidity-format.util');

const openInterestMemory = new Map();
const liquiditySignalMemory = new Map();

function getCooldownKey(symbol) {
  return symbol;
}

function getSignalSignature(context) {
  const upSignature =
    context.up && context.up.exists ? `U${context.up.distancePct.toFixed(1)}` : 'Uno';
  const downSignature =
    context.down && context.down.exists ? `D${context.down.distancePct.toFixed(1)}` : 'Dno';

  return `${context.focus}:${upSignature}:${downSignature}`;
}

function shouldSkipByCooldown(symbol, context, config) {
  const previousSignal = liquiditySignalMemory.get(getCooldownKey(symbol));

  if (!previousSignal) {
    return false;
  }

  const signature = getSignalSignature(context);
  const isSameSignature = previousSignal.signature === signature;
  const isOnCooldown = Date.now() - previousSignal.sentAt < config.liquiditySignalCooldownMs;

  return isSameSignature && isOnCooldown;
}

function markSignalSent(symbol, context) {
  liquiditySignalMemory.set(getCooldownKey(symbol), {
    signature: getSignalSignature(context),
    sentAt: Date.now(),
  });
}

function logLiquidityDecision(symbol, context, decision, reason, config) {
  if (!config.liquidityLogDetails) {
    return;
  }

  console.log(
    `[liquidity] ${symbol} price=${context.currentPrice ?? 'n/a'} priceMovePct=${
      context.metrics?.priceMovePct ?? 'n/a'
    } oiGrowthPct=${context.metrics?.oiGrowthPct ?? 'n/a'} fundingRate=${
      context.metrics?.fundingRate ?? 'n/a'
    } upDistance=${context.up?.exists ? context.up.distancePct.toFixed(2) : 'n/a'} downDistance=${
      context.down?.exists ? context.down.distancePct.toFixed(2) : 'n/a'
    } upStrength=${context.up?.exists ? context.up.strength.toFixed(2) : 'n/a'} downStrength=${
      context.down?.exists ? context.down.strength.toFixed(2) : 'n/a'
    } focus=${context.focus ?? 'n/a'} decision=${decision} reason=${reason}`
  );
}

async function getLiquiditySignal(symbol, config) {
  if (!config.liquiditySignalEnabled) {
    return { enabled: false };
  }

  try {
    const [candles, currentOpenInterest, fundingRate, currentPrice] = await Promise.all([
      getClosedKlines(symbol, config.liquiditySignalTimeframe, config.liquidityLookbackCandles + 2),
      getOpenInterest(symbol),
      getFundingRate(symbol),
      getMarkPrice(symbol),
    ]);

    const previousOpenInterest = openInterestMemory.get(symbol);

    openInterestMemory.set(symbol, currentOpenInterest);

    const context = buildLiquidityContext({
      symbol,
      candles,
      currentPrice,
      openInterest: currentOpenInterest,
      previousOpenInterest,
      fundingRate,
      config,
    });

    if (!context.enabled) {
      return context;
    }

    if (!context.isSignificant) {
      logLiquidityDecision(symbol, context, 'skipped', context.reason || 'not_significant', config);
      return {
        enabled: true,
        shouldSend: false,
        context,
      };
    }

    const strongestSide = Math.max(context.up?.strength || 0, context.down?.strength || 0);

    if (strongestSide < config.liquidityMinStrengthScore) {
      logLiquidityDecision(symbol, context, 'skipped', 'strength_below_threshold', config);
      return {
        enabled: true,
        shouldSend: false,
        context,
      };
    }

    if (shouldSkipByCooldown(symbol, context, config)) {
      logLiquidityDecision(symbol, context, 'skipped', 'cooldown', config);
      return {
        enabled: true,
        shouldSend: false,
        context,
      };
    }

    markSignalSent(symbol, context);
    logLiquidityDecision(symbol, context, 'sent', 'ok', config);

    return {
      enabled: true,
      shouldSend: true,
      context,
      message: formatLiquiditySignal(context),
    };
  } catch (error) {
    return {
      enabled: true,
      shouldSend: false,
      error,
    };
  }
}

module.exports = {
  getLiquiditySignal,
};
