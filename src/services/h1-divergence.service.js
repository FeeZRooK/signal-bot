const {
  getRsiCounterMoveDiagnostics,
  normalizeDivergenceType,
} = require('../utils/divergence-rsi-path.util');

const DIVERGENCE_STRENGTH = {
  STRONG: 'STRONG',
  MEDIUM: 'MEDIUM',
  WEAK: 'WEAK',
};

function calculateRsiSeries(candles, period) {
  const rsis = new Array(candles.length).fill(null);

  if (candles.length < period + 1) {
    return rsis;
  }

  const closes = candles.map((candle) => Number(candle.close));

  if (closes.some((value) => Number.isNaN(value))) {
    return rsis;
  }

  let averageGain = 0;
  let averageLoss = 0;

  for (let index = 1; index <= period; index += 1) {
    const delta = closes[index] - closes[index - 1];
    averageGain += delta > 0 ? delta : 0;
    averageLoss += delta < 0 ? Math.abs(delta) : 0;
  }

  averageGain /= period;
  averageLoss /= period;

  if (averageLoss === 0) {
    rsis[period] = 100;
  } else if (averageGain === 0) {
    rsis[period] = 0;
  } else {
    const relativeStrength = averageGain / averageLoss;
    rsis[period] = 100 - 100 / (1 + relativeStrength);
  }

  for (let index = period + 1; index < closes.length; index += 1) {
    const delta = closes[index] - closes[index - 1];
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? Math.abs(delta) : 0;

    averageGain = ((averageGain * (period - 1)) + gain) / period;
    averageLoss = ((averageLoss * (period - 1)) + loss) / period;

    if (averageLoss === 0) {
      rsis[index] = 100;
    } else if (averageGain === 0) {
      rsis[index] = 0;
    } else {
      const relativeStrength = averageGain / averageLoss;
      rsis[index] = 100 - 100 / (1 + relativeStrength);
    }
  }

  return rsis;
}

function isPivot(values, index, leftBars, rightBars, type) {
  if (index < leftBars || index + rightBars >= values.length) {
    return false;
  }

  const value = values[index];

  if (!Number.isFinite(value)) {
    return false;
  }

  for (let cursor = index - leftBars; cursor <= index + rightBars; cursor += 1) {
    if (cursor === index) {
      continue;
    }

    const neighbor = values[cursor];

    if (!Number.isFinite(neighbor)) {
      return false;
    }

    if (type === 'HIGH') {
      if (neighbor >= value) {
        return false;
      }
    } else {
      if (neighbor <= value) {
        return false;
      }
    }
  }

  return true;
}

function findPivots(values, leftBars, rightBars, type) {
  const pivots = [];

  for (let index = leftBars; index < values.length - rightBars; index += 1) {
    if (isPivot(values, index, leftBars, rightBars, type)) {
      pivots.push({
        index,
        value: values[index],
      });
    }
  }

  return pivots;
}

function buildPairTimeMeta(candle) {
  return {
    priceOpenTimeMs: candle.openTime,
    priceCloseTimeMs: candle.closeTime,
    rsiOpenTimeMs: candle.openTime,
    rsiCloseTimeMs: candle.closeTime,
  };
}

function buildPricePivotPairs(candles, rsis, direction, settings) {
  const priceValues = candles.map((candle) =>
    direction === 'BULLISH' ? Number(candle.low) : Number(candle.high)
  );
  const priceType = direction === 'BULLISH' ? 'LOW' : 'HIGH';
  const pricePivots = findPivots(
    priceValues,
    settings.pivotLeftBars,
    settings.pivotRightBars,
    priceType
  );

  return pricePivots
    .map((pricePivot) => {
      const rsiValue = rsis[pricePivot.index];

      if (!Number.isFinite(rsiValue)) {
        return null;
      }

      return {
        priceIndex: pricePivot.index,
        priceValue: pricePivot.value,
        rsiIndex: pricePivot.index,
        rsiValue,
        ...buildPairTimeMeta(candles[pricePivot.index]),
        source: 'confirmed_pivot',
      };
    })
    .filter(Boolean);
}

function findNearbyStrongerPivot(
  pair,
  pairs,
  oppositePairs,
  type,
  significantPivotWindowBars
) {
  let strongerPair = null;

  for (const candidatePair of pairs) {
    if (candidatePair.priceIndex === pair.priceIndex) {
      continue;
    }

    const distance = Math.abs(candidatePair.priceIndex - pair.priceIndex);

    if (distance > significantPivotWindowBars) {
      continue;
    }

    const isStronger =
      type === 'HIGH'
        ? candidatePair.priceValue > pair.priceValue
        : candidatePair.priceValue < pair.priceValue;

    if (!isStronger) {
      continue;
    }

    if (
      countOppositeSwingPairsBetween(
        oppositePairs,
        Math.min(candidatePair.priceIndex, pair.priceIndex),
        Math.max(candidatePair.priceIndex, pair.priceIndex)
      ) > 0
    ) {
      continue;
    }

    if (!strongerPair) {
      strongerPair = candidatePair;
      continue;
    }

    const strongerDistance = Math.abs(strongerPair.priceIndex - pair.priceIndex);

    if (distance < strongerDistance) {
      strongerPair = candidatePair;
      continue;
    }

    if (
      distance === strongerDistance &&
      ((type === 'HIGH' && candidatePair.priceValue > strongerPair.priceValue) ||
        (type === 'LOW' && candidatePair.priceValue < strongerPair.priceValue))
    ) {
      strongerPair = candidatePair;
    }
  }

  return strongerPair;
}

function filterSignificantPivotPairs(
  pairs,
  oppositePairs,
  type,
  significantPivotWindowBars
) {
  const acceptedPairs = [];
  const rejectedPairs = [];

  for (const pair of pairs) {
    const strongerPair = findNearbyStrongerPivot(
      pair,
      pairs,
      oppositePairs,
      type,
      significantPivotWindowBars
    );

    if (strongerPair) {
      rejectedPairs.push({
        ...pair,
        rejectedReason: 'stronger_same_type_pivot_nearby',
        strongerPairIndex: strongerPair.priceIndex,
        strongerPairValue: strongerPair.priceValue,
        strongerPairTimeMs: strongerPair.priceCloseTimeMs,
      });
      continue;
    }

    acceptedPairs.push(pair);
  }

  return {
    acceptedPairs,
    rejectedPairs,
  };
}

function countOppositeSwingPairsBetween(oppositePairs, leftIndex, rightIndex) {
  return oppositePairs.filter(
    (pair) => pair.priceIndex > leftIndex && pair.priceIndex < rightIndex
  ).length;
}

function shouldLogDivergenceDebug(settings, symbol) {
  if (!settings.debugEnabled) {
    return false;
  }

  if (settings.debugSymbol && settings.debugSymbol !== symbol) {
    return false;
  }

  if (settings.debugTimeframe && settings.debugTimeframe !== settings.timeframe) {
    return false;
  }

  return true;
}

function logPivotDiagnostics(
  settings,
  symbol,
  direction,
  primaryType,
  primaryPairs,
  primaryRejectedPairs,
  oppositeType,
  oppositePairs,
  oppositeRejectedPairs
) {
  if (!shouldLogDivergenceDebug(settings, symbol)) {
    return;
  }

  const formatPair = (pair) =>
    `${pair.priceIndex}@${formatDebugTime(pair.priceCloseTimeMs)}:${pair.priceValue.toFixed(6)}|rsi=${pair.rsiValue.toFixed(2)}`;
  const formatRejectedPair = (pair) =>
    `${formatPair(pair)} rejected=${pair.rejectedReason} stronger=${pair.strongerPairIndex}@${formatDebugTime(pair.strongerPairTimeMs)}:${pair.strongerPairValue.toFixed(6)}`;

  console.log(
    `[${settings.logPrefix}] ${symbol} direction=${direction} significantWindowBars=${settings.significantPivotWindowBars} primaryType=${primaryType} oppositeType=${oppositeType}`
  );
  console.log(
    `[${settings.logPrefix}] ${symbol} accepted ${primaryType} pivots: ${
      primaryPairs.length ? primaryPairs.map(formatPair).join(' | ') : 'none'
    }`
  );
  console.log(
    `[${settings.logPrefix}] ${symbol} rejected ${primaryType} pivots: ${
      primaryRejectedPairs.length
        ? primaryRejectedPairs.map(formatRejectedPair).join(' | ')
        : 'none'
    }`
  );
  console.log(
    `[${settings.logPrefix}] ${symbol} accepted ${oppositeType} pivots: ${
      oppositePairs.length ? oppositePairs.map(formatPair).join(' | ') : 'none'
    }`
  );
  console.log(
    `[${settings.logPrefix}] ${symbol} rejected ${oppositeType} pivots: ${
      oppositeRejectedPairs.length
        ? oppositeRejectedPairs.map(formatRejectedPair).join(' | ')
        : 'none'
    }`
  );
}

function logCandidateRejection(
  settings,
  symbol,
  direction,
  signalPair,
  referencePair,
  reason,
  details = null
) {
  if (!shouldLogDivergenceDebug(settings, symbol)) {
    return;
  }

  console.log(
    `[${settings.logPrefix}] ${symbol} direction=${direction} rejected candidate reason=${reason} refIndex=${referencePair.priceIndex} refTime=${formatDebugTime(referencePair.priceCloseTimeMs)} signalIndex=${signalPair.priceIndex} signalTime=${formatDebugTime(signalPair.priceCloseTimeMs)}`
  );

  if (details) {
    console.log(
      `[${settings.logPrefix}] ${symbol} direction=${direction} rejected-details=${JSON.stringify(details)}`
    );
  }
}

function logActiveEdgeEvaluation(settings, symbol, direction, signalIndex, candles, accepted, reason) {
  if (!shouldLogDivergenceDebug(settings, symbol)) {
    return;
  }

  const candle = candles[signalIndex];
  const priceValue = direction === 'BULLISH' ? Number(candle.low) : Number(candle.high);

  console.log(
    `[${settings.logPrefix}] ${symbol} direction=${direction} activeEdgeIndex=${signalIndex} activeEdgeTime=${formatDebugTime(candle.closeTime)} activeEdgeValue=${priceValue} lookbackBars=${settings.edgePivotLookbackBars} accepted=${accepted} reason=${reason}`
  );
}

function buildStructuralPivotData(symbol, candles, rsis, direction, settings) {
  const primaryType = direction === 'BULLISH' ? 'LOW' : 'HIGH';
  const oppositeDirection = direction === 'BULLISH' ? 'BEARISH' : 'BULLISH';
  const oppositeType = direction === 'BULLISH' ? 'HIGH' : 'LOW';
  const primaryRawPairs = buildPricePivotPairs(candles, rsis, direction, settings);
  const oppositeRawPairs = buildPricePivotPairs(candles, rsis, oppositeDirection, settings);
  const primarySelection = filterSignificantPivotPairs(
    primaryRawPairs,
    oppositeRawPairs,
    primaryType,
    settings.significantPivotWindowBars
  );
  const oppositeSelection = filterSignificantPivotPairs(
    oppositeRawPairs,
    primaryRawPairs,
    oppositeType,
    settings.significantPivotWindowBars
  );

  logPivotDiagnostics(
    settings,
    symbol,
    direction,
    primaryType,
    primarySelection.acceptedPairs,
    primarySelection.rejectedPairs,
    oppositeType,
    oppositeSelection.acceptedPairs,
    oppositeSelection.rejectedPairs
  );

  return {
    primaryPairs: primarySelection.acceptedPairs,
    oppositePairs: oppositeSelection.acceptedPairs,
  };
}

function buildReferencePairFromIndex(candles, rsis, index, direction, source) {
  const priceValue =
    direction === 'BULLISH' ? Number(candles[index].low) : Number(candles[index].high);
  const rsiValue = rsis[index];

  if (!Number.isFinite(priceValue) || !Number.isFinite(rsiValue)) {
    return null;
  }

  return {
    priceIndex: index,
    priceValue,
    rsiIndex: index,
    rsiValue,
    ...buildPairTimeMeta(candles[index]),
    source,
  };
}

function isActiveEdgeHigh(candles, signalIndex, lookbackBars) {
  if (signalIndex < lookbackBars) {
    return null;
  }

  const signalHigh = Number(candles[signalIndex].high);

  if (!Number.isFinite(signalHigh)) {
    return false;
  }

  for (let index = signalIndex - lookbackBars; index < signalIndex; index += 1) {
    const previousHigh = Number(candles[index].high);

    if (!Number.isFinite(previousHigh) || signalHigh <= previousHigh) {
      return false;
    }
  }

  return true;
}

function isActiveEdgeLow(candles, signalIndex, lookbackBars) {
  if (signalIndex < lookbackBars) {
    return null;
  }

  const signalLow = Number(candles[signalIndex].low);

  if (!Number.isFinite(signalLow)) {
    return false;
  }

  for (let index = signalIndex - lookbackBars; index < signalIndex; index += 1) {
    const previousLow = Number(candles[index].low);

    if (!Number.isFinite(previousLow) || signalLow >= previousLow) {
      return false;
    }
  }

  return true;
}

function buildActiveEdgeSignalPair(symbol, direction, candles, rsis, signalIndex, settings) {
  if (!settings.useEdgeT2) {
    return null;
  }

  const isValidEdge =
    direction === 'BULLISH'
      ? isActiveEdgeLow(candles, signalIndex, settings.edgePivotLookbackBars)
      : isActiveEdgeHigh(candles, signalIndex, settings.edgePivotLookbackBars);

  if (!isValidEdge) {
    logActiveEdgeEvaluation(
      settings,
      symbol,
      direction,
      signalIndex,
      candles,
      false,
      'last_closed_candle_is_not_active_edge_extremum'
    );
    return null;
  }

  const signalPair = buildReferencePairFromIndex(
    candles,
    rsis,
    signalIndex,
    direction,
    direction === 'BULLISH' ? 'active_edge_low' : 'active_edge_high'
  );

  if (!signalPair) {
    logActiveEdgeEvaluation(
      settings,
      symbol,
      direction,
      signalIndex,
      candles,
      false,
      'active_edge_rsi_or_price_invalid'
    );
    return null;
  }

  logActiveEdgeEvaluation(
    settings,
    symbol,
    direction,
    signalIndex,
    candles,
    true,
    signalPair.source
  );

  return {
    signalPair,
    signalAgeCandles: 0,
    t2RankFromEnd: null,
    signalSource: signalPair.source,
    maxReferencePairIndex: null,
    maxPivotDistance: settings.maxPivotDistance,
  };
}

function hasMinimumPullback(candles, referenceIndex, signalIndex, direction, minimumPullbackPct) {
  if (signalIndex - referenceIndex < 2) {
    return false;
  }

  if (direction === 'BULLISH') {
    const referenceLow = Number(candles[referenceIndex].low);
    let highestHighAfterReference = -Infinity;

    for (let index = referenceIndex + 1; index < signalIndex; index += 1) {
      highestHighAfterReference = Math.max(
        highestHighAfterReference,
        Number(candles[index].high)
      );
    }

    if (!Number.isFinite(highestHighAfterReference) || referenceLow <= 0) {
      return false;
    }

    return (
      ((highestHighAfterReference - referenceLow) / referenceLow) * 100 >= minimumPullbackPct
    );
  }

  const referenceHigh = Number(candles[referenceIndex].high);
  let lowestLowAfterReference = Infinity;

  for (let index = referenceIndex + 1; index < signalIndex; index += 1) {
    lowestLowAfterReference = Math.min(lowestLowAfterReference, Number(candles[index].low));
  }

  if (!Number.isFinite(lowestLowAfterReference) || referenceHigh <= 0) {
    return false;
  }

  return (
    ((referenceHigh - lowestLowAfterReference) / referenceHigh) * 100 >= minimumPullbackPct
  );
}

function buildLocalReferencePairs(direction, candles, rsis, signalPair, settings, maxPivotDistance) {
  const referencePairs = [];
  const startIndex = Math.max(1, signalPair.priceIndex - maxPivotDistance);
  const endIndex = signalPair.priceIndex - settings.minPivotDistance;

  for (let index = startIndex; index <= endIndex; index += 1) {
    const currentPrice =
      direction === 'BULLISH' ? Number(candles[index].low) : Number(candles[index].high);
    const previousPrice =
      direction === 'BULLISH' ? Number(candles[index - 1].low) : Number(candles[index - 1].high);

    if (!Number.isFinite(currentPrice) || !Number.isFinite(previousPrice)) {
      continue;
    }

    const hasLeftStrength =
      direction === 'BULLISH' ? currentPrice < previousPrice : currentPrice > previousPrice;

    if (!hasLeftStrength) {
      continue;
    }

    if (
      !hasMinimumPullback(
        candles,
        index,
        signalPair.priceIndex,
        direction,
        settings.minReferencePullbackPct
      )
    ) {
      continue;
    }

    const referencePair = buildReferencePairFromIndex(
      candles,
      rsis,
      index,
      direction,
      'local_anchor'
    );

    if (referencePair) {
      referencePairs.push(referencePair);
    }
  }

  return referencePairs;
}

function buildReferencePairs(direction, candles, rsis, pairs, signalPairIndex, settings) {
  const signalPair = pairs[signalPairIndex];
  const referencePairs = [];
  const seenReferenceIndexes = new Set();

  for (let index = signalPairIndex - 1; index >= 0; index -= 1) {
    const referencePair = pairs[index];
    const pivotDistance = signalPair.priceIndex - referencePair.priceIndex;

    if (pivotDistance < settings.minPivotDistance) {
      continue;
    }

    if (pivotDistance > settings.maxPivotDistance) {
      break;
    }

    referencePairs.push({
      ...referencePair,
      source: 'confirmed_pivot',
      intermediatePivotCount: signalPairIndex - index - 1,
    });
    seenReferenceIndexes.add(referencePair.priceIndex);
  }

  for (const localReferencePair of buildLocalReferencePairs(
    direction,
    candles,
    rsis,
    signalPair,
    settings
  )) {
    if (seenReferenceIndexes.has(localReferencePair.priceIndex)) {
      continue;
    }

    referencePairs.push({
      ...localReferencePair,
      intermediatePivotCount: 0,
    });
  }

  return referencePairs.sort((left, right) => right.priceIndex - left.priceIndex);
}

function buildReferencePairsForSignalCandidate(
  direction,
  candles,
  rsis,
  pairs,
  signalPairCandidate,
  settings
) {
  const { signalPair, maxReferencePairIndex, maxPivotDistance } = signalPairCandidate;
  const referencePairs = [];

  for (let index = maxReferencePairIndex; index >= 0; index -= 1) {
    const referencePair = pairs[index];
    const pivotDistance = signalPair.priceIndex - referencePair.priceIndex;

    if (pivotDistance < settings.minBarsBetweenPivots) {
      continue;
    }

    if (pivotDistance > maxPivotDistance) {
      break;
    }

    referencePairs.push({
      ...referencePair,
      source: 'confirmed_pivot',
      intermediatePivotCount: maxReferencePairIndex - index,
    });
  }

  return referencePairs.sort((left, right) => right.priceIndex - left.priceIndex);
}

function isPriceStructureValid(direction, referencePriceValue, signalPriceValue) {
  if (direction === 'BULLISH') {
    return signalPriceValue < referencePriceValue;
  }

  return signalPriceValue > referencePriceValue;
}

function getPriceDeltaPct(direction, referencePriceValue, signalPriceValue) {
  if (direction === 'BULLISH') {
    return ((referencePriceValue - signalPriceValue) / referencePriceValue) * 100;
  }

  return ((signalPriceValue - referencePriceValue) / referencePriceValue) * 100;
}

function passesPriceDeltaFilter(priceDeltaPct, settings) {
  return priceDeltaPct >= settings.minPriceDeltaPct;
}

function buildCandidateScore(candidate, settings) {
  const freshnessScore =
    Math.max(0, settings.maxSignalAgeCandles - candidate.signalAgeCandles) * 400;
  const distanceScore =
    Math.max(0, candidate.maxPivotDistance - candidate.pivotDistance) * 120;
  const structureScore =
    Math.max(0, settings.maxIntermediatePivots - candidate.intermediatePivotCount) * 250;
  const recencyScore = candidate.t2RankFromEnd === 0 ? 80 : 0;
  const syncScore = Math.max(0, 4 - candidate.rsiOffsetCandles) * 20;
  const qualityScore =
    (Math.abs(candidate.priceDeltaPct) * 6) + (Math.abs(candidate.rsiDelta) * 4);

  return (
    freshnessScore +
    distanceScore +
    structureScore +
    recencyScore +
    syncScore +
    qualityScore
  );
}

function formatDebugTime(timestampMs) {
  return new Date(timestampMs).toISOString();
}

function formatDebugNumber(value, digits = 4) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : 'n/a';
}

function logRsiPathValidation(
  settings,
  symbol,
  divergenceType,
  referencePair,
  signalPair,
  diagnostics
) {
  if (!shouldLogDivergenceDebug(settings, symbol)) {
    return;
  }

  console.log(
    `[${settings.logPrefix}] ${symbol} timeframe=${settings.timeframe} divergenceType=${divergenceType} t1Index=${referencePair.rsiIndex} t1Time=${formatDebugTime(referencePair.rsiCloseTimeMs)} t2Index=${signalPair.rsiIndex} t2Time=${formatDebugTime(signalPair.rsiCloseTimeMs)} rsiT1=${formatDebugNumber(diagnostics.rsiA, 2)} rsiT2=${formatDebugNumber(diagnostics.rsiB, 2)} rsiMoveAbs=${formatDebugNumber(diagnostics.rsiMoveAbs, 4)} counterMoveAbs=${formatDebugNumber(diagnostics.counterMoveAbs, 4)} counterMovePct=${formatDebugNumber(diagnostics.counterMovePct, 4)} tolerance=${formatDebugNumber(diagnostics.counterMoveTolerance, 4)} result=${diagnostics.rejectedBy.length === 0 ? 'accepted' : 'rejected'}`
  );
}

function calculateRegressionSlope(values) {
  if (!Array.isArray(values) || values.length < 2) {
    return 0;
  }

  const meanX = (values.length - 1) / 2;
  const meanY = values.reduce((sum, value) => sum + value, 0) / values.length;
  let numerator = 0;
  let denominator = 0;

  for (let index = 0; index < values.length; index += 1) {
    const x = index - meanX;
    const y = values[index] - meanY;
    numerator += x * y;
    denominator += x * x;
  }

  return denominator > 0 ? numerator / denominator : 0;
}

function validateRsiContext(rsiValues, aIndex, bIndex, divergenceType, settings) {
  const normalizedType = normalizeDivergenceType(divergenceType);
  const diagnostics = {
    type: normalizedType,
    aIndex,
    bIndex,
    rsiA: Number(rsiValues?.[aIndex]),
    rsiB: Number(rsiValues?.[bIndex]),
    netMove: 0,
    pathLength: 0,
    directionEfficiency: 0,
    regressionSlope: 0,
    finalLegDelta: 0,
    directionalStepRatio: 0,
    rsiMoveAbs: 0,
    counterMoveAbs: 0,
    counterMovePct: null,
    counterMoveTolerance: Number(settings?.rsiContext?.maxCounterMoveRatio),
    rejectedBy: [],
  };

  if (!['bullish', 'bearish'].includes(normalizedType)) {
    diagnostics.rejectedBy.push('invalid_divergence_type');
    return {
      valid: false,
      diagnostics,
    };
  }

  if (!Number.isInteger(aIndex) || !Number.isInteger(bIndex) || bIndex <= aIndex) {
    diagnostics.rejectedBy.push('invalid_rsi_context_indexes');
    return {
      valid: false,
      diagnostics,
    };
  }

  const segment = rsiValues.slice(aIndex, bIndex + 1).map((value) => Number(value));

  if (segment.length < 2 || segment.some((value) => !Number.isFinite(value))) {
    diagnostics.rejectedBy.push('invalid_rsi_context_segment');
    return {
      valid: false,
      diagnostics,
    };
  }

  diagnostics.rsiA = segment[0];
  diagnostics.rsiB = segment[segment.length - 1];
  diagnostics.netMove =
    normalizedType === 'bearish'
      ? diagnostics.rsiA - diagnostics.rsiB
      : diagnostics.rsiB - diagnostics.rsiA;

  let totalSteps = 0;
  let directionalSteps = 0;

  for (let index = 1; index < segment.length; index += 1) {
    const delta = segment[index] - segment[index - 1];

    diagnostics.pathLength += Math.abs(delta);
    totalSteps += 1;

    if (
      (normalizedType === 'bearish' && delta < 0) ||
      (normalizedType === 'bullish' && delta > 0)
    ) {
      directionalSteps += 1;
    }
  }

  diagnostics.directionEfficiency =
    diagnostics.pathLength > 0 ? diagnostics.netMove / diagnostics.pathLength : 0;
  diagnostics.regressionSlope = calculateRegressionSlope(segment);

  const finalLegStartOffset = Math.max(
    0,
    segment.length - 1 - settings.rsiContext.finalLegLookback
  );
  diagnostics.finalLegDelta = segment[segment.length - 1] - segment[finalLegStartOffset];
  diagnostics.directionalStepRatio =
    totalSteps > 0 ? directionalSteps / totalSteps : 0;
  const counterMoveDiagnostics = getRsiCounterMoveDiagnostics(
    rsiValues,
    aIndex,
    bIndex,
    normalizedType,
    {
      tolerance: settings.rsiContext.maxCounterMoveRatio,
    }
  );

  diagnostics.rsiMoveAbs = counterMoveDiagnostics.rsiMoveAbs;
  diagnostics.counterMoveAbs = counterMoveDiagnostics.counterMoveAbs;
  diagnostics.counterMovePct = counterMoveDiagnostics.counterMovePct;
  diagnostics.counterMoveTolerance = counterMoveDiagnostics.tolerance;

  if (counterMoveDiagnostics.reason === 'rsi_not_lower_at_t2') {
    diagnostics.rejectedBy.push('rsi_not_lower_at_b');
  } else if (counterMoveDiagnostics.reason === 'rsi_not_higher_at_t2') {
    diagnostics.rejectedBy.push('rsi_not_higher_at_b');
  } else if (counterMoveDiagnostics.reason === 'rsi_move_too_small') {
    diagnostics.rejectedBy.push('rsi_move_too_small');
  } else if (counterMoveDiagnostics.reason === 'counter_move_ratio_exceeded') {
    diagnostics.rejectedBy.push('counter_move_ratio_exceeded');
  }

  return {
    valid: diagnostics.rejectedBy.length === 0,
    diagnostics,
  };
}

function evaluateDivergenceStrength(signal) {
  const absolutePriceMovePct = Math.abs(Number(signal.priceMovePct));
  const absoluteRsiMove = Math.abs(Number(signal.rsiMove));
  const pivotDistance = Number(signal.pivotDistance);
  const signalAgeCandles = Number(signal.signalAgeCandles);

  if (
    absolutePriceMovePct >= 1 &&
    absoluteRsiMove >= 8 &&
    pivotDistance <= 20 &&
    signalAgeCandles <= 1
  ) {
    return DIVERGENCE_STRENGTH.STRONG;
  }

  if (
    absolutePriceMovePct >= 0.5 &&
    absoluteRsiMove >= 5 &&
    pivotDistance <= 35 &&
    signalAgeCandles <= 3
  ) {
    return DIVERGENCE_STRENGTH.MEDIUM;
  }

  return DIVERGENCE_STRENGTH.WEAK;
}

function logSelectedDivergenceCandidate(
  settings,
  symbol,
  selectedCandidate,
  bullishCandidate,
  bearishCandidate,
  strength,
  signalAgeCandles
) {
  const selectionReason =
    bullishCandidate && bearishCandidate
      ? 'selected highest-score valid candidate'
      : 'selected only valid candidate';
  const priceMovePct =
    ((selectedCandidate.signalPair.priceValue - selectedCandidate.referencePair.priceValue) /
      selectedCandidate.referencePair.priceValue) *
    100;
  const rsiMove = selectedCandidate.signalPair.rsiValue - selectedCandidate.referencePair.rsiValue;

  console.log(
    `[${settings.logPrefix}] ${symbol} timeframe=${settings.timeframe} direction=${selectedCandidate.direction} reason=${selectionReason} score=${selectedCandidate.score.toFixed(2)} bullishScore=${
      bullishCandidate ? bullishCandidate.score.toFixed(2) : 'n/a'
    } bearishScore=${bearishCandidate ? bearishCandidate.score.toFixed(2) : 'n/a'} strength=${strength} signalAgeCandles=${signalAgeCandles} t2Rank=${
      selectedCandidate.t2RankFromEnd === null
        ? selectedCandidate.signalSource
        : selectedCandidate.t2RankFromEnd === 0
          ? 'last'
          : 'penultimate'
    } signalSource=${selectedCandidate.signalSource} referenceSource=${selectedCandidate.referenceSource} intermediatePivots=${selectedCandidate.intermediatePivotCount} rsiSource=price_pivot_candles`
  );
  console.log(
    `[${settings.logPrefix}] ${symbol} price pivots refIndex=${selectedCandidate.referencePair.priceIndex} refTime=${formatDebugTime(selectedCandidate.referencePair.priceCloseTimeMs)} refValue=${selectedCandidate.referencePair.priceValue} signalIndex=${selectedCandidate.signalPair.priceIndex} signalTime=${formatDebugTime(selectedCandidate.signalPair.priceCloseTimeMs)} signalValue=${selectedCandidate.signalPair.priceValue} movePct=${priceMovePct.toFixed(2)} structure=${
      selectedCandidate.direction === 'BULLISH' ? 'LL' : 'HH'
    }`
  );
  console.log(
    `[${settings.logPrefix}] ${symbol} rsi-on-price-pivots refIndex=${selectedCandidate.referencePair.rsiIndex} refTime=${formatDebugTime(selectedCandidate.referencePair.rsiCloseTimeMs)} refValue=${selectedCandidate.referencePair.rsiValue.toFixed(2)} signalIndex=${selectedCandidate.signalPair.rsiIndex} signalTime=${formatDebugTime(selectedCandidate.signalPair.rsiCloseTimeMs)} signalValue=${selectedCandidate.signalPair.rsiValue.toFixed(2)} move=${rsiMove.toFixed(2)} structure=${
      selectedCandidate.direction === 'BULLISH' ? 'HL' : 'LH'
    }`
  );
  console.log(
    `[${settings.logPrefix}] ${symbol} pivotDistance=${selectedCandidate.pivotDistance} minBarsBetween=${settings.minBarsBetweenPivots} maxPivotDistance=${selectedCandidate.maxPivotDistance} signalSource=${selectedCandidate.signalSource} referenceSource=${selectedCandidate.referenceSource} intermediatePivots=${selectedCandidate.intermediatePivotCount} maxIntermediatePivots=${settings.maxIntermediatePivots} oppositeSwings=${selectedCandidate.oppositeSwingCountBetween} requireOppositeSwing=${settings.requireOppositeSwing} edgePivotLookbackBars=${settings.edgePivotLookbackBars} priceDeltaPct=${selectedCandidate.priceDeltaPct.toFixed(2)} rsiDelta=${selectedCandidate.rsiDelta.toFixed(2)} why=regular divergence requires confirmed structural T1 pivot, active edge T2 on the last closed candle, strict price ${selectedCandidate.direction === 'BULLISH' ? 'LL' : 'HH'} and strict RSI ${selectedCandidate.direction === 'BULLISH' ? 'HL' : 'LH'}`
  );
}

function getSignalPairCandidates(pairs, signalIndex, settings) {
  const candidates = [];
  const firstSignalPairIndex = Math.max(0, pairs.length - 2);

  for (
    let signalPairIndex = pairs.length - 1;
    signalPairIndex >= firstSignalPairIndex;
    signalPairIndex -= 1
  ) {
    const signalPair = pairs[signalPairIndex];
    const signalAgeCandles = signalIndex - signalPair.priceIndex;

    if (signalAgeCandles > settings.maxSignalAgeCandles) {
      continue;
    }

    candidates.push({
      signalPair,
      signalPairIndex,
      signalAgeCandles,
      t2RankFromEnd: (pairs.length - 1) - signalPairIndex,
      signalSource: 'confirmed_pivot',
      maxReferencePairIndex: signalPairIndex - 1,
      maxPivotDistance: settings.maxPivotDistance,
    });
  }

  return candidates;
}

function getRegularDivergenceCandidate(symbol, direction, candles, rsis, signalIndex, settings) {
  const { primaryPairs: pairs, oppositePairs } = buildStructuralPivotData(
    symbol,
    candles,
    rsis,
    direction,
    settings
  );
  const minimumBarsBetweenPivots = settings.minBarsBetweenPivots;

  if (pairs.length < 1) {
    return null;
  }

  const activeEdgeSignalPairCandidate = buildActiveEdgeSignalPair(
    symbol,
    direction,
    candles,
    rsis,
    signalIndex,
    settings
  );

  const signalPairCandidates = settings.useEdgeT2
    ? activeEdgeSignalPairCandidate
      ? [activeEdgeSignalPairCandidate]
      : []
    : getSignalPairCandidates(pairs, signalIndex, settings);

  if (signalPairCandidates.length === 0) {
    return null;
  }

  let bestConfirmedCandidate = null;

  for (const signalPairCandidate of signalPairCandidates) {
      const {
        signalPair,
        signalAgeCandles,
        t2RankFromEnd,
        signalSource,
        maxPivotDistance,
        maxReferencePairIndex,
      } = signalPairCandidate;

    for (const referencePair of buildReferencePairsForSignalCandidate(
      direction,
      candles,
      rsis,
      pairs,
      {
        signalPair,
        maxReferencePairIndex:
          maxReferencePairIndex === null ? pairs.length - 1 : maxReferencePairIndex,
        maxPivotDistance,
      },
      settings
    )) {
      const pivotDistance = signalPair.priceIndex - referencePair.priceIndex;
      const intermediatePivotCount = referencePair.intermediatePivotCount;
      const rsiOffsetCandles =
        Math.abs(signalPair.rsiIndex - signalPair.priceIndex) +
        Math.abs(referencePair.rsiIndex - referencePair.priceIndex);
      const oppositeSwingCountBetween = countOppositeSwingPairsBetween(
        oppositePairs,
        referencePair.priceIndex,
        signalPair.priceIndex
      );

      if (pivotDistance < minimumBarsBetweenPivots) {
        logCandidateRejection(
          settings,
          symbol,
          direction,
          signalPair,
          referencePair,
          'pivot_distance_below_minimum'
        );
        continue;
      }

      if (pivotDistance > maxPivotDistance) {
        logCandidateRejection(
          settings,
          symbol,
          direction,
          signalPair,
          referencePair,
          'pivot_distance_above_maximum'
        );
        continue;
      }

      if (intermediatePivotCount > settings.maxIntermediatePivots) {
        logCandidateRejection(
          settings,
          symbol,
          direction,
          signalPair,
          referencePair,
          'too_many_same_type_intermediate_pivots'
        );
        continue;
      }

      if (settings.requireOppositeSwing && oppositeSwingCountBetween === 0) {
        logCandidateRejection(
          settings,
          symbol,
          direction,
          signalPair,
          referencePair,
          'missing_opposite_swing_between_pivots'
        );
        continue;
      }

      if (direction === 'BULLISH') {
        const priceDeltaPct = getPriceDeltaPct(
          direction,
          referencePair.priceValue,
          signalPair.priceValue
        );
        const rsiDelta = signalPair.rsiValue - referencePair.rsiValue;

        if (
          !isPriceStructureValid(
            direction,
            referencePair.priceValue,
            signalPair.priceValue
          )
        ) {
          logCandidateRejection(
            settings,
            symbol,
            direction,
            signalPair,
            referencePair,
            'price_not_lower_low'
          );
          continue;
        }

        if (signalPair.rsiValue <= referencePair.rsiValue) {
          logCandidateRejection(
            settings,
            symbol,
            direction,
            signalPair,
            referencePair,
            'rsi_not_higher_low'
          );
          continue;
        }

        if (!passesPriceDeltaFilter(priceDeltaPct, settings)) {
          logCandidateRejection(
            settings,
            symbol,
            direction,
            signalPair,
            referencePair,
            'price_delta_below_threshold'
          );
          continue;
        }

        if (rsiDelta < settings.minRsiDelta) {
          logCandidateRejection(
            settings,
            symbol,
            direction,
            signalPair,
            referencePair,
            'rsi_delta_below_threshold'
          );
          continue;
        }

        const rsiContextValidation = validateRsiContext(
          rsis,
          referencePair.rsiIndex,
          signalPair.rsiIndex,
          'bullish',
          settings
        );
        logRsiPathValidation(
          settings,
          symbol,
          'bullish',
          referencePair,
          signalPair,
          rsiContextValidation.diagnostics
        );

        if (!rsiContextValidation.valid) {
          logCandidateRejection(
            settings,
            symbol,
            direction,
            signalPair,
            referencePair,
            'rsi_context_filter_failed',
            rsiContextValidation.diagnostics
          );
          continue;
        }

        const candidate = {
          direction,
          signalPair,
          referencePair,
          priceDeltaPct,
          rsiDelta,
          pivotDistance,
          intermediatePivotCount,
          signalAgeCandles,
          t2RankFromEnd,
          signalSource,
          maxPivotDistance,
          rsiOffsetCandles,
          referenceSource: referencePair.source,
          oppositeSwingCountBetween,
          rsiContext: rsiContextValidation.diagnostics,
        };

        candidate.score = buildCandidateScore(candidate, settings);

        if (!bestConfirmedCandidate || candidate.score > bestConfirmedCandidate.score) {
          bestConfirmedCandidate = candidate;
        }

        continue;
      }

      const priceDeltaPct = getPriceDeltaPct(
        direction,
        referencePair.priceValue,
        signalPair.priceValue
      );
      const rsiDelta = referencePair.rsiValue - signalPair.rsiValue;

      if (
        !isPriceStructureValid(
          direction,
          referencePair.priceValue,
          signalPair.priceValue
        )
      ) {
        logCandidateRejection(
          settings,
          symbol,
          direction,
          signalPair,
          referencePair,
          'price_not_higher_high'
        );
        continue;
      }

      if (signalPair.rsiValue >= referencePair.rsiValue) {
        logCandidateRejection(
          settings,
          symbol,
          direction,
          signalPair,
          referencePair,
          'rsi_not_lower_high'
        );
        continue;
      }

      if (!passesPriceDeltaFilter(priceDeltaPct, settings)) {
        logCandidateRejection(
          settings,
          symbol,
          direction,
          signalPair,
          referencePair,
          'price_delta_below_threshold'
        );
        continue;
      }

      if (rsiDelta < settings.minRsiDelta) {
        logCandidateRejection(
          settings,
          symbol,
          direction,
          signalPair,
          referencePair,
          'rsi_delta_below_threshold'
        );
        continue;
      }

      const rsiContextValidation = validateRsiContext(
        rsis,
        referencePair.rsiIndex,
        signalPair.rsiIndex,
        'bearish',
        settings
      );
      logRsiPathValidation(
        settings,
        symbol,
        'bearish',
        referencePair,
        signalPair,
        rsiContextValidation.diagnostics
      );

      if (!rsiContextValidation.valid) {
        logCandidateRejection(
          settings,
          symbol,
          direction,
          signalPair,
          referencePair,
          'rsi_context_filter_failed',
          rsiContextValidation.diagnostics
        );
        continue;
      }

      const candidate = {
        direction,
        signalPair,
        referencePair,
        priceDeltaPct,
        rsiDelta,
        pivotDistance,
        intermediatePivotCount,
        signalAgeCandles,
        t2RankFromEnd,
        signalSource,
        maxPivotDistance,
        rsiOffsetCandles,
        referenceSource: referencePair.source,
        oppositeSwingCountBetween,
        rsiContext: rsiContextValidation.diagnostics,
      };

      candidate.score = buildCandidateScore(candidate, settings);

      if (!bestConfirmedCandidate || candidate.score > bestConfirmedCandidate.score) {
        bestConfirmedCandidate = candidate;
      }
    }
  }

  return bestConfirmedCandidate;
}

function buildDivergenceSettings(config, timeframeKey) {
  const rsiContext = {
    minDirectionEfficiency: config.divergenceRsiContextMinDirectionEfficiency,
    finalLegLookback: config.divergenceRsiContextFinalLegLookback,
    maxAllowedFinalCounterMove: config.divergenceRsiContextMaxAllowedFinalCounterMove,
    minDirectionalStepRatio: config.divergenceRsiContextMinDirectionalStepRatio,
    maxCounterMoveRatio: config.divergenceMaxCounterMoveRatio,
    requireRegressionSlopeConfirmation:
      config.divergenceRsiContextRequireRegressionSlopeConfirmation,
  };

  if (timeframeKey === 'M15') {
    return {
      enabled: config.m15DivergenceEnabled,
      timeframe: config.m15DivergenceTimeframe,
      lookbackCandles: config.m15DivergenceLookbackCandles,
      rsiPeriod: config.m15DivergenceRsiPeriod,
      pivotLeftBars: config.m15DivergencePivotLeftBars,
      pivotRightBars: config.m15DivergencePivotRightBars,
      significantPivotWindowBars: config.m15DivergenceSignificantPivotWindowBars,
      useEdgeT2: config.m15DivergenceUseEdgeT2,
      edgePivotLookbackBars: config.m15DivergenceEdgePivotLookbackBars,
      minBarsBetweenPivots: config.m15DivergenceMinBarsBetweenPivots,
      minPivotDistance: config.m15DivergenceMinPivotDistance,
      maxPivotDistance: config.m15DivergenceMaxPivotDistance,
      maxActivePivotDistance: config.m15DivergenceMaxActivePivotDistance,
      maxIntermediatePivots: config.m15DivergenceMaxIntermediatePivots,
      enableActiveT2: config.m15DivergenceEnableActiveT2,
      activeT2RightBars: config.m15DivergenceActiveT2RightBars,
      minReferencePullbackPct: config.m15DivergenceMinReferencePullbackPct,
      requireOppositeSwing: config.m15DivergenceRequireOppositeSwing,
      priceTolerancePct: config.m15DivergencePriceTolerancePct,
      minPriceDeltaPct: config.m15DivergenceMinPriceDeltaPct,
      minRsiDelta: config.m15DivergenceMinRsiDelta,
      maxSignalAgeCandles: config.m15DivergenceMaxSignalAgeCandles,
      typePrefix: 'M15',
      logPrefix: 'm15-divergence',
      debugEnabled: config.divergenceDebugEnabled,
      debugSymbol: config.divergenceDebugSymbol,
      debugTimeframe: config.divergenceDebugTimeframe,
      rsiContext,
    };
  }

  return {
    enabled: config.h1DivergenceEnabled,
    timeframe: config.h1DivergenceTimeframe,
    lookbackCandles: config.h1DivergenceLookbackCandles,
    rsiPeriod: config.h1DivergenceRsiPeriod,
    pivotLeftBars: config.h1DivergencePivotLeftBars,
    pivotRightBars: config.h1DivergencePivotRightBars,
    significantPivotWindowBars: config.h1DivergenceSignificantPivotWindowBars,
    useEdgeT2: config.h1DivergenceUseEdgeT2,
    edgePivotLookbackBars: config.h1DivergenceEdgePivotLookbackBars,
    minBarsBetweenPivots: config.h1DivergenceMinBarsBetweenPivots,
    minPivotDistance: config.h1DivergenceMinPivotDistance,
    maxPivotDistance: config.h1DivergenceMaxPivotDistance,
    maxActivePivotDistance: config.h1DivergenceMaxActivePivotDistance,
    maxIntermediatePivots: config.h1DivergenceMaxIntermediatePivots,
    enableActiveT2: config.h1DivergenceEnableActiveT2,
    activeT2RightBars: config.h1DivergenceActiveT2RightBars,
    minReferencePullbackPct: config.h1DivergenceMinReferencePullbackPct,
    requireOppositeSwing: config.h1DivergenceRequireOppositeSwing,
    priceTolerancePct: config.h1DivergencePriceTolerancePct,
    minPriceDeltaPct: config.h1DivergenceMinPriceDeltaPct,
    minRsiDelta: config.h1DivergenceMinRsiDelta,
    maxSignalAgeCandles: config.h1DivergenceMaxSignalAgeCandles,
    typePrefix: 'H1',
    logPrefix: 'h1-divergence',
    debugEnabled: config.divergenceDebugEnabled,
    debugSymbol: config.divergenceDebugSymbol,
    debugTimeframe: config.divergenceDebugTimeframe,
    rsiContext,
  };
}

function getDivergenceSignal(symbol, candles, settings) {
  if (!settings.enabled) {
    return null;
  }

  const minimumCandles =
    settings.rsiPeriod +
    settings.pivotLeftBars +
    settings.pivotRightBars +
    2;

  if (
    candles.length < minimumCandles ||
    candles.length < settings.lookbackCandles
  ) {
    return null;
  }

  const rsis = calculateRsiSeries(candles, settings.rsiPeriod);
  const signalIndex = candles.length - 1;

  if (rsis.every((value) => value === null)) {
    return null;
  }

  // Divergence is confirmed only after both the price pivot and the RSI pivot are
  // local extrema with closed candles on the right side, which cuts out noisy
  // "last candle vs any previous candle" comparisons.
  const bullishCandidate = getRegularDivergenceCandidate(
    symbol,
    'BULLISH',
    candles,
    rsis,
    signalIndex,
    settings
  );
  const bearishCandidate = getRegularDivergenceCandidate(
    symbol,
    'BEARISH',
    candles,
    rsis,
    signalIndex,
    settings
  );

  if (!bullishCandidate && !bearishCandidate) {
    return null;
  }

  const selectedCandidate =
    bullishCandidate && bearishCandidate
      ? bullishCandidate.score >= bearishCandidate.score
        ? bullishCandidate
        : bearishCandidate
      : bullishCandidate || bearishCandidate;
  const priceMovePct =
    ((selectedCandidate.signalPair.priceValue - selectedCandidate.referencePair.priceValue) /
      selectedCandidate.referencePair.priceValue) *
    100;
  const rsiMove = selectedCandidate.signalPair.rsiValue - selectedCandidate.referencePair.rsiValue;
  const signalAgeCandles = signalIndex - selectedCandidate.signalPair.priceIndex;
  const strength = evaluateDivergenceStrength({
    priceMovePct,
    rsiMove,
    pivotDistance: selectedCandidate.pivotDistance,
    signalAgeCandles,
  });

  logSelectedDivergenceCandidate(
    settings,
    symbol,
    selectedCandidate,
    bullishCandidate,
    bearishCandidate,
    strength,
    signalAgeCandles
  );

  return {
    type:
      selectedCandidate.direction === 'BULLISH'
        ? `${settings.typePrefix}_DIVERGENCE_BULLISH`
        : `${settings.typePrefix}_DIVERGENCE_BEARISH`,
    divergenceKind: 'REGULAR',
    symbol,
    direction: selectedCandidate.direction,
    timeframe: settings.timeframe,
    closeTimeMs: selectedCandidate.signalPair.priceCloseTimeMs,
    close: candles[selectedCandidate.signalPair.priceIndex].close,
    rsi: selectedCandidate.signalPair.rsiValue,
    strength,
    priceStructure: selectedCandidate.direction === 'BULLISH' ? 'LL' : 'HH',
    rsiStructure: selectedCandidate.direction === 'BULLISH' ? 'HL' : 'LH',
    pricePivotLabel: selectedCandidate.direction === 'BULLISH' ? 'Price lows' : 'Price highs',
    rsiPivotLabel: selectedCandidate.direction === 'BULLISH' ? 'RSI lows' : 'RSI highs',
    priceCondition:
      selectedCandidate.direction === 'BULLISH'
        ? 'priceLow2 < priceLow1'
        : 'priceHigh2 > priceHigh1',
    rsiCondition:
      selectedCandidate.direction === 'BULLISH'
        ? 'rsiLow2 > rsiLow1'
        : 'rsiHigh2 < rsiHigh1',
    point1TimeMs: selectedCandidate.referencePair.priceOpenTimeMs,
    point2TimeMs: selectedCandidate.signalPair.priceOpenTimeMs,
    point1CloseTimeMs: selectedCandidate.referencePair.priceCloseTimeMs,
    point2CloseTimeMs: selectedCandidate.signalPair.priceCloseTimeMs,
    point1Price: selectedCandidate.referencePair.priceValue,
    point2Price: selectedCandidate.signalPair.priceValue,
    point1Rsi: selectedCandidate.referencePair.rsiValue,
    point2Rsi: selectedCandidate.signalPair.rsiValue,
    point1PriceIndex: selectedCandidate.referencePair.priceIndex,
    point2PriceIndex: selectedCandidate.signalPair.priceIndex,
    point1RsiIndex: selectedCandidate.referencePair.rsiIndex,
    point2RsiIndex: selectedCandidate.signalPair.rsiIndex,
    point1RsiTimeMs: selectedCandidate.referencePair.rsiOpenTimeMs,
    point2RsiTimeMs: selectedCandidate.signalPair.rsiOpenTimeMs,
    point1RsiCloseTimeMs: selectedCandidate.referencePair.rsiCloseTimeMs,
    point2RsiCloseTimeMs: selectedCandidate.signalPair.rsiCloseTimeMs,
    referenceCloseTimeMs: selectedCandidate.referencePair.priceCloseTimeMs,
    referenceRsi: selectedCandidate.referencePair.rsiValue,
    referenceRsiCloseTimeMs: selectedCandidate.referencePair.rsiCloseTimeMs,
    signalRsiCloseTimeMs: selectedCandidate.signalPair.rsiCloseTimeMs,
    priceMovePct,
    rsiMove,
    priceDeltaPct: selectedCandidate.priceDeltaPct,
    rsiDelta: selectedCandidate.rsiDelta,
    pivotDistance: selectedCandidate.pivotDistance,
    intermediatePivotCount: selectedCandidate.intermediatePivotCount,
    oppositeSwingCountBetween: selectedCandidate.oppositeSwingCountBetween,
    signalAgeCandles,
    t2RankFromEnd: selectedCandidate.t2RankFromEnd,
    t2Source: selectedCandidate.signalSource,
    referenceSource: selectedCandidate.referenceSource,
    rsiOffsetCandles: 0,
    rsiContext: selectedCandidate.rsiContext,
  };
}

function getH1DivergenceSignal(symbol, candles, config) {
  return getDivergenceSignal(symbol, candles, buildDivergenceSettings(config, 'H1'));
}

function getM15DivergenceSignal(symbol, candles, config) {
  return getDivergenceSignal(symbol, candles, buildDivergenceSettings(config, 'M15'));
}

module.exports = {
  evaluateDivergenceStrength,
  getH1DivergenceSignal,
  getM15DivergenceSignal,
  validateRsiContext,
};
