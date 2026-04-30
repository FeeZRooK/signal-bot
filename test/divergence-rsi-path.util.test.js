const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getRsiCounterMoveDiagnostics,
  isRsiPathAcceptableBetweenPoints,
} = require('../src/utils/divergence-rsi-path.util');
const {
  getH1DivergenceSignal,
  getM15DivergenceSignal,
  validateRsiContext,
} = require('../src/services/divergence.service');

const COUNTER_MOVE_TOLERANCE = 0.25;

function buildSettings(timeframe) {
  return {
    timeframe,
    rsiContext: {
      finalLegLookback: 4,
      maxCounterMoveRatio: COUNTER_MOVE_TOLERANCE,
    },
  };
}

test('bearish divergence stays valid when local RSI counter move is within tolerance', () => {
  const rsiValues = [70, 65.5, 66, 62];
  const diagnostics = getRsiCounterMoveDiagnostics(rsiValues, 0, 3, 'bearish', {
    tolerance: COUNTER_MOVE_TOLERANCE,
  });

  assert.equal(diagnostics.isValid, true);
  assert.ok(diagnostics.counterMovePct < COUNTER_MOVE_TOLERANCE);
  assert.equal(
    isRsiPathAcceptableBetweenPoints(rsiValues, 0, 3, 'bearish', {
      tolerance: COUNTER_MOVE_TOLERANCE,
    }),
    true
  );
});

test('bearish divergence is rejected when local RSI counter move exceeds tolerance', () => {
  const rsiValues = [70, 61, 68, 60];
  const diagnostics = getRsiCounterMoveDiagnostics(rsiValues, 0, 3, 'bearish', {
    tolerance: COUNTER_MOVE_TOLERANCE,
  });

  assert.equal(diagnostics.isValid, false);
  assert.ok(diagnostics.counterMovePct > COUNTER_MOVE_TOLERANCE);
});

test('bullish divergence stays valid when local RSI counter move is within tolerance', () => {
  const rsiValues = [30, 34.5, 34, 38];
  const diagnostics = getRsiCounterMoveDiagnostics(rsiValues, 0, 3, 'bullish', {
    tolerance: COUNTER_MOVE_TOLERANCE,
  });

  assert.equal(diagnostics.isValid, true);
  assert.ok(diagnostics.counterMovePct < COUNTER_MOVE_TOLERANCE);
});

test('bullish divergence is rejected when local RSI counter move exceeds tolerance', () => {
  const rsiValues = [30, 39, 32, 40];
  const diagnostics = getRsiCounterMoveDiagnostics(rsiValues, 0, 3, 'bullish', {
    tolerance: COUNTER_MOVE_TOLERANCE,
  });

  assert.equal(diagnostics.isValid, false);
  assert.ok(diagnostics.counterMovePct > COUNTER_MOVE_TOLERANCE);
});

test('shared RSI context validation behaves the same for 15m and 1h divergence settings', () => {
  const validRsiValues = [70, 65.5, 66, 62];
  const expected = {
    valid: true,
    rejectedBy: [],
  };

  for (const timeframe of ['15m', '1h']) {
    const result = validateRsiContext(validRsiValues, 0, 3, 'bearish', buildSettings(timeframe));

    assert.equal(result.valid, expected.valid);
    assert.deepEqual(result.diagnostics.rejectedBy, expected.rejectedBy);
    assert.equal(result.diagnostics.counterMoveTolerance, COUNTER_MOVE_TOLERANCE);
  }
});

test('shared divergence service exports both H1 and M15 signal builders', () => {
  assert.equal(typeof getH1DivergenceSignal, 'function');
  assert.equal(typeof getM15DivergenceSignal, 'function');
});
