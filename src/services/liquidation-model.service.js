function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function toPercent(value, baseValue) {
  if (!baseValue) {
    return 0;
  }

  return ((value - baseValue) / baseValue) * 100;
}

function getVwapEntryZone(candles) {
  const totalVolume = candles.reduce((sum, candle) => sum + candle.volume, 0);

  if (totalVolume <= 0) {
    const averageHlc3 =
      candles.reduce((sum, candle) => sum + (candle.high + candle.low + candle.close) / 3, 0) /
      candles.length;

    return averageHlc3;
  }

  return (
    candles.reduce((sum, candle) => {
      const hlc3 = (candle.high + candle.low + candle.close) / 3;
      return sum + hlc3 * candle.volume;
    }, 0) / totalVolume
  );
}

function buildZoneCandidate(currentPrice, referencePrice, offsetPct, direction) {
  const multiplier = direction === 'Up' ? 1 + offsetPct / 100 : 1 - offsetPct / 100;
  const zonePrice = referencePrice * multiplier;
  const distancePct =
    direction === 'Up'
      ? ((zonePrice - currentPrice) / currentPrice) * 100
      : ((currentPrice - zonePrice) / currentPrice) * 100;

  if (distancePct <= 0) {
    return null;
  }

  return {
    direction,
    price: zonePrice,
    distancePct,
  };
}

function buildStrengthScore({
  priceMovePct,
  oiGrowthPct,
  fundingRate,
  distancePct,
  isUp,
  config,
}) {
  const priceComponent = clamp(Math.abs(priceMovePct) / (config.liquidityMinPriceMovePct * 2), 0, 1);
  const oiComponent = clamp(oiGrowthPct / (config.liquidityMinOiGrowthPct * 2), 0, 1);
  const distanceComponent = clamp(
    1 - distancePct / Math.max(config.liquidityNearDistancePct, 0.1),
    0,
    1
  );

  let fundingComponent = 0.5;

  if (config.liquidityUseFunding) {
    if (fundingRate > 0) {
      fundingComponent = isUp ? 0.3 : 1;
    } else if (fundingRate < 0) {
      fundingComponent = isUp ? 1 : 0.3;
    }
  }

  const crowdingComponent =
    priceMovePct > 0 ? (isUp ? 0.4 : 1) : priceMovePct < 0 ? (isUp ? 1 : 0.4) : 0.5;

  const score =
    priceComponent * 0.35 +
    oiComponent * 0.4 +
    distanceComponent * 0.15 +
    fundingComponent * 0.05 +
    crowdingComponent * 0.05;

  return clamp(score * 10, 0, 10);
}

function selectNearestZone(candidates, maxDistancePct) {
  return (
    candidates
      .filter((candidate) => candidate)
      .sort((a, b) => a.distancePct - b.distancePct)[0] || null
  );
}

function isValidLiquidityZone(zone, config) {
  if (!zone || !zone.exists) {
    return false;
  }

  if (zone.distancePct < config.liquidityMinDistancePct) {
    return false;
  }

  if (zone.distancePct <= config.liquidityNearDistancePct) {
    return true;
  }

  if (
    zone.distancePct <= config.liquidityMaxDistancePct &&
    zone.strength >= config.liquidityStrongStrengthScore
  ) {
    return true;
  }

  return false;
}

function buildLiquidityContext({
  symbol,
  candles,
  currentPrice,
  openInterest,
  previousOpenInterest,
  fundingRate,
  config,
}) {
  if (!config.liquiditySignalEnabled) {
    return { enabled: false };
  }

  if (!candles || candles.length < config.liquidityLookbackCandles) {
    return {
      enabled: true,
      isSignificant: false,
      reason: 'insufficient_candles',
    };
  }

  if (!currentPrice || !openInterest) {
    return {
      enabled: true,
      isSignificant: false,
      reason: 'missing_market_data',
    };
  }

  if (!previousOpenInterest || previousOpenInterest <= 0) {
    return {
      enabled: true,
      isSignificant: false,
      reason: 'insufficient_oi_history',
    };
  }

  const lookbackCandles = candles.slice(-config.liquidityLookbackCandles);
  const firstClose = Number(lookbackCandles[0].close);
  const lastClose = Number(lookbackCandles[lookbackCandles.length - 1].close);
  const priceMovePct = toPercent(lastClose, firstClose);
  const oiGrowthPct = toPercent(openInterest, previousOpenInterest);

  if (
    Math.abs(priceMovePct) < config.liquidityMinPriceMovePct ||
    oiGrowthPct < config.liquidityMinOiGrowthPct
  ) {
    return {
      enabled: true,
      symbol,
      currentPrice,
      isSignificant: false,
      reason: 'weak_context',
      metrics: {
        priceMovePct,
        oiGrowthPct,
        fundingRate,
      },
    };
  }

  const entryZone = getVwapEntryZone(lookbackCandles);
  const offsets = [2, 4, 6, 8];
  const upCandidate = selectNearestZone(
    offsets.map((offset) => buildZoneCandidate(currentPrice, entryZone, offset, 'Up')),
    config.liquidityMaxDistancePct
  );
  const downCandidate = selectNearestZone(
    offsets.map((offset) => buildZoneCandidate(currentPrice, entryZone, offset, 'Down')),
    config.liquidityMaxDistancePct
  );

  const up = upCandidate
    ? {
        exists: true,
        distancePct: upCandidate.distancePct,
        targetPrice: upCandidate.price,
        strength: buildStrengthScore({
          priceMovePct,
          oiGrowthPct,
          fundingRate,
          distancePct: upCandidate.distancePct,
          isUp: true,
          config,
        }),
      }
    : { exists: false };

  const down = downCandidate
    ? {
        exists: true,
        distancePct: downCandidate.distancePct,
        targetPrice: downCandidate.price,
        strength: buildStrengthScore({
          priceMovePct,
          oiGrowthPct,
          fundingRate,
          distancePct: downCandidate.distancePct,
          isUp: false,
          config,
        }),
      }
    : { exists: false };

  const validUp = isValidLiquidityZone(up, config)
    ? up
    : {
        exists: false,
      };

  const validDown = isValidLiquidityZone(down, config)
    ? down
    : {
        exists: false,
      };

  if (!validUp.exists && !validDown.exists) {
    return {
      enabled: true,
      symbol,
      currentPrice,
      isSignificant: false,
      reason: 'no_valid_zones_after_distance_filter',
      metrics: {
        priceMovePct,
        oiGrowthPct,
        fundingRate,
      },
    };
  }

  let focus = null;

  if (validUp.exists && !validDown.exists) {
    focus = 'Up';
  } else if (!validUp.exists && validDown.exists) {
    focus = 'Down';
  } else {
    const upCombinedScore =
      validUp.strength - clamp(validUp.distancePct / config.liquidityMaxDistancePct, 0, 1);
    const downCombinedScore =
      validDown.strength - clamp(validDown.distancePct / config.liquidityMaxDistancePct, 0, 1);

    focus = upCombinedScore >= downCombinedScore ? 'Up' : 'Down';
  }

  return {
    enabled: true,
    symbol,
    currentPrice,
    up: validUp,
    down: validDown,
    focus,
    isSignificant: true,
    metrics: {
      priceMovePct,
      oiGrowthPct,
      fundingRate,
    },
  };
}

module.exports = {
  buildLiquidityContext,
};
