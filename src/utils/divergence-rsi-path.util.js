const DEFAULT_COUNTER_MOVE_TOLERANCE = 0.25;
const MIN_RSI_MOVE_ABS = 1e-6;

function normalizeDivergenceType(type) {
  return String(type || '').trim().toLowerCase();
}

function getSegmentValues(rsiValues, startIndex, endIndex) {
  if (!Array.isArray(rsiValues)) {
    return null;
  }

  if (
    !Number.isInteger(startIndex) ||
    !Number.isInteger(endIndex) ||
    startIndex < 0 ||
    endIndex <= startIndex ||
    endIndex >= rsiValues.length
  ) {
    return null;
  }

  const segment = rsiValues.slice(startIndex, endIndex + 1).map((value) => Number(value));

  if (segment.length < 2 || segment.some((value) => !Number.isFinite(value))) {
    return null;
  }

  return segment;
}

function getLineRsiValue(startValue, endValue, stepIndex, totalSteps) {
  if (totalSteps <= 0) {
    return startValue;
  }

  return startValue + ((endValue - startValue) * stepIndex) / totalSteps;
}

function getRsiCounterMoveDiagnostics(
  rsiValues,
  startIndex,
  endIndex,
  divergenceType,
  options = {}
) {
  const type = normalizeDivergenceType(divergenceType);
  const tolerance = Number.isFinite(Number(options.tolerance))
    ? Number(options.tolerance)
    : DEFAULT_COUNTER_MOVE_TOLERANCE;
  const minRsiMoveAbs = Number.isFinite(Number(options.minRsiMoveAbs))
    ? Number(options.minRsiMoveAbs)
    : MIN_RSI_MOVE_ABS;
  const segment = getSegmentValues(rsiValues, startIndex, endIndex);
  const diagnostics = {
    type,
    startIndex,
    endIndex,
    segmentLength: segment ? segment.length : 0,
    rsiT1: segment ? segment[0] : Number(rsiValues?.[startIndex]),
    rsiT2: segment ? segment[segment.length - 1] : Number(rsiValues?.[endIndex]),
    rsiMoveAbs: 0,
    counterMoveAbs: 0,
    counterMovePct: null,
    tolerance,
    isValid: false,
    reason: null,
  };

  if (!['bullish', 'bearish'].includes(type)) {
    diagnostics.reason = 'invalid_divergence_type';
    return diagnostics;
  }

  if (!segment) {
    diagnostics.reason = 'invalid_rsi_segment';
    return diagnostics;
  }

  diagnostics.rsiT1 = segment[0];
  diagnostics.rsiT2 = segment[segment.length - 1];

  const isNetMoveValid =
    type === 'bearish' ? diagnostics.rsiT2 < diagnostics.rsiT1 : diagnostics.rsiT2 > diagnostics.rsiT1;

  if (!isNetMoveValid) {
    diagnostics.reason = type === 'bearish' ? 'rsi_not_lower_at_t2' : 'rsi_not_higher_at_t2';
    return diagnostics;
  }

  diagnostics.rsiMoveAbs = Math.abs(diagnostics.rsiT2 - diagnostics.rsiT1);

  if (diagnostics.rsiMoveAbs <= minRsiMoveAbs) {
    diagnostics.reason = 'rsi_move_too_small';
    return diagnostics;
  }

  const totalSteps = segment.length - 1;

  for (let stepIndex = 0; stepIndex < segment.length; stepIndex += 1) {
    const lineRsi = getLineRsiValue(
      diagnostics.rsiT1,
      diagnostics.rsiT2,
      stepIndex,
      totalSteps
    );
    const actualRsi = segment[stepIndex];
    const deviation =
      type === 'bearish'
        ? Math.max(0, actualRsi - lineRsi)
        : Math.max(0, lineRsi - actualRsi);

    diagnostics.counterMoveAbs = Math.max(diagnostics.counterMoveAbs, deviation);
  }

  diagnostics.counterMovePct = diagnostics.counterMoveAbs / diagnostics.rsiMoveAbs;
  diagnostics.isValid = diagnostics.counterMovePct <= tolerance;
  diagnostics.reason = diagnostics.isValid ? null : 'counter_move_ratio_exceeded';

  return diagnostics;
}

function isRsiPathAcceptableBetweenPoints(
  rsiValues,
  startIndex,
  endIndex,
  divergenceType,
  options = {}
) {
  return getRsiCounterMoveDiagnostics(
    rsiValues,
    startIndex,
    endIndex,
    divergenceType,
    options
  ).isValid;
}

module.exports = {
  DEFAULT_COUNTER_MOVE_TOLERANCE,
  getRsiCounterMoveDiagnostics,
  isRsiPathAcceptableBetweenPoints,
  normalizeDivergenceType,
};
