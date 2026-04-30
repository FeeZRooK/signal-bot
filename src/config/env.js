const {
  isValidTimeZone,
  resolveTelegramTimeZone,
} = require('../utils/time.util');

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  return String(value).toLowerCase() === 'true';
}

function isValidTimeframe(value) {
  return /^(\d+)([mhd])$/i.test(String(value || ''));
}

const legacyMainSignalTimeframe = process.env.MAIN_SIGNAL_TIMEFRAME || process.env.TIMEFRAME || '3m';
const volumeSignalTimeframe = process.env.VOLUME_SIGNAL_TIMEFRAME || legacyMainSignalTimeframe;
const mainSignalTimeframe = volumeSignalTimeframe;
const rsiSignalTimeframe = process.env.RSI_SIGNAL_TIMEFRAME || legacyMainSignalTimeframe;
const h1DivergenceTimeframe = process.env.H1_DIVERGENCE_TIMEFRAME || '1h';
const m15DivergenceTimeframe = process.env.M15_DIVERGENCE_TIMEFRAME || '15m';
const liquiditySignalTimeframe = process.env.LIQUIDITY_SIGNAL_TIMEFRAME || '5m';
const liquidityTrackingTimeframe =
  process.env.LIQUIDITY_TRACKING_TIMEFRAME || liquiditySignalTimeframe;

const env = {
  binanceApiKey: process.env.BINANCE_API_KEY || '',
  binanceApiSecret: process.env.BINANCE_API_SECRET || '',

  telegramBotToken:
    process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_TOKEN || '',

  telegramChatId:
    process.env.TELEGRAM_CHAT_ID ||
    process.env.TELEGRAM_CHAT ||
    process.env.CHAT_ID ||
    '',

  telegramChatIds:
    process.env.TELEGRAM_CHAT_IDS || '',

  telegramTimeZone: resolveTelegramTimeZone(process.env.TELEGRAM_TIMEZONE),

  liquidityTelegramBotToken:
    process.env.LIQUIDITY_TELEGRAM_BOT_TOKEN ||
    process.env.LIQUIDITY_TELEGRAM_TOKEN ||
    '',

  liquidityTelegramChatId:
    process.env.LIQUIDITY_TELEGRAM_CHAT_ID ||
    process.env.LIQUIDITY_TELEGRAM_CHAT ||
    '',

  liquidityTelegramChatIds:
    process.env.LIQUIDITY_TELEGRAM_CHAT_IDS || '',

  scanLimit: Number(process.env.SCAN_LIMIT || 50),
  scanIntervalMs: Number(process.env.SCAN_INTERVAL_MS || 60000),
  scanBatchSize: Number(process.env.SCAN_BATCH_SIZE || 10),
  fastSignalRecentCandles: Number(process.env.FAST_SIGNAL_RECENT_CANDLES || 2),
  rsiSignalRecentCandles: Number(
    process.env.RSI_SIGNAL_RECENT_CANDLES || process.env.FAST_SIGNAL_RECENT_CANDLES || 2
  ),
  volumeBaselineMethod: String(process.env.VOLUME_BASELINE_METHOD || 'trimmed').toLowerCase(),
  volumeBaselineTrimCount: Number(process.env.VOLUME_BASELINE_TRIM_COUNT || 1),
  volumeContextFilterEnabled: parseBoolean(process.env.VOLUME_CONTEXT_FILTER_ENABLED, true),
  volumeContextLookbackCandles: Number(process.env.VOLUME_CONTEXT_LOOKBACK_CANDLES || 20),
  volumeContextMinRatioToRecentMax: Number(
    process.env.VOLUME_CONTEXT_MIN_RATIO_TO_RECENT_MAX || 1.4
  ),
  debugSignalSymbol: process.env.DEBUG_SIGNAL_SYMBOL || '',
  debugSignalTimeframe: process.env.DEBUG_SIGNAL_TIMEFRAME || '',
  debugSignalCloseTime: process.env.DEBUG_SIGNAL_CLOSE_TIME || '',

  // Legacy alias kept for backward compatibility with older config consumers.
  timeframe: volumeSignalTimeframe,
  volumeSignalTimeframe,
  mainSignalTimeframe,
  rsiSignalTimeframe,
  h1DivergenceEnabled: parseBoolean(process.env.H1_DIVERGENCE_ENABLED, true),
  h1DivergenceTimeframe,
  h1DivergenceLookbackCandles: Number(process.env.H1_DIVERGENCE_LOOKBACK_CANDLES || 40),
  h1DivergenceRsiPeriod: Number(process.env.H1_DIVERGENCE_RSI_PERIOD || 14),
  h1DivergenceCloseDelayMs: Number(process.env.H1_DIVERGENCE_CLOSE_DELAY_MS || 10000),
  h1DivergencePivotLeftBars: Number(process.env.H1_DIVERGENCE_PIVOT_LEFT_BARS || 2),
  h1DivergencePivotRightBars: Number(process.env.H1_DIVERGENCE_PIVOT_RIGHT_BARS || 2),
  h1DivergenceSignificantPivotWindowBars: Number(
    process.env.H1_DIVERGENCE_SIGNIFICANT_PIVOT_WINDOW_BARS || 6
  ),
  h1DivergenceUseEdgeT2: parseBoolean(
    process.env.H1_DIVERGENCE_USE_EDGE_T2,
    parseBoolean(process.env.H1_DIVERGENCE_ENABLE_ACTIVE_T2, true)
  ),
  h1DivergenceEdgePivotLookbackBars: Number(
    process.env.H1_DIVERGENCE_EDGE_PIVOT_LOOKBACK_BARS ||
      process.env.H1_DIVERGENCE_PIVOT_LEFT_BARS ||
      3
  ),
  h1DivergenceMinBarsBetweenPivots: Number(
    process.env.H1_DIVERGENCE_MIN_BARS_BETWEEN_PIVOTS ||
      process.env.H1_DIVERGENCE_MIN_PIVOT_DISTANCE ||
      5
  ),
  h1DivergenceMinPivotDistance: Number(process.env.H1_DIVERGENCE_MIN_PIVOT_DISTANCE || 5),
  h1DivergenceMaxPivotDistance: Number(process.env.H1_DIVERGENCE_MAX_PIVOT_DISTANCE || 10),
  h1DivergenceMaxActivePivotDistance: Number(
    process.env.H1_DIVERGENCE_MAX_ACTIVE_PIVOT_DISTANCE || 14
  ),
  h1DivergenceMaxIntermediatePivots: Number(
    process.env.H1_DIVERGENCE_MAX_INTERMEDIATE_PIVOTS || 0
  ),
  h1DivergenceEnableActiveT2: parseBoolean(process.env.H1_DIVERGENCE_ENABLE_ACTIVE_T2, true),
  h1DivergenceActiveT2RightBars: Number(process.env.H1_DIVERGENCE_ACTIVE_T2_RIGHT_BARS || 1),
  h1DivergenceMinReferencePullbackPct: Number(
    process.env.H1_DIVERGENCE_MIN_REFERENCE_PULLBACK_PCT || 2
  ),
  h1DivergenceRequireOppositeSwing: parseBoolean(
    process.env.H1_DIVERGENCE_REQUIRE_OPPOSITE_SWING,
    true
  ),
  h1DivergencePriceTolerancePct: Number(process.env.H1_DIVERGENCE_PRICE_TOLERANCE_PCT || 0.25),
  h1DivergenceMinPriceDeltaPct: Number(process.env.H1_DIVERGENCE_MIN_PRICE_DELTA_PCT || 0.5),
  h1DivergenceMinRsiDelta: Number(process.env.H1_DIVERGENCE_MIN_RSI_DELTA || 5),
  h1DivergenceMaxSignalAgeCandles: Number(
    process.env.H1_DIVERGENCE_MAX_SIGNAL_AGE_CANDLES || 3
  ),
  m15DivergenceEnabled: parseBoolean(process.env.M15_DIVERGENCE_ENABLED, true),
  m15DivergenceTimeframe,
  m15DivergenceLookbackCandles: Number(
    process.env.M15_DIVERGENCE_LOOKBACK_CANDLES ||
      process.env.H1_DIVERGENCE_LOOKBACK_CANDLES ||
      40
  ),
  m15DivergenceRsiPeriod: Number(
    process.env.M15_DIVERGENCE_RSI_PERIOD || process.env.H1_DIVERGENCE_RSI_PERIOD || 14
  ),
  m15DivergenceCloseDelayMs: Number(process.env.M15_DIVERGENCE_CLOSE_DELAY_MS || 10000),
  m15DivergencePivotLeftBars: Number(
    process.env.M15_DIVERGENCE_PIVOT_LEFT_BARS || process.env.H1_DIVERGENCE_PIVOT_LEFT_BARS || 2
  ),
  m15DivergencePivotRightBars: Number(
    process.env.M15_DIVERGENCE_PIVOT_RIGHT_BARS || process.env.H1_DIVERGENCE_PIVOT_RIGHT_BARS || 2
  ),
  m15DivergenceSignificantPivotWindowBars: Number(
    process.env.M15_DIVERGENCE_SIGNIFICANT_PIVOT_WINDOW_BARS ||
      process.env.H1_DIVERGENCE_SIGNIFICANT_PIVOT_WINDOW_BARS ||
      6
  ),
  m15DivergenceUseEdgeT2: parseBoolean(
    process.env.M15_DIVERGENCE_USE_EDGE_T2,
    parseBoolean(
      process.env.H1_DIVERGENCE_USE_EDGE_T2,
      parseBoolean(process.env.M15_DIVERGENCE_ENABLE_ACTIVE_T2, true)
    )
  ),
  m15DivergenceEdgePivotLookbackBars: Number(
    process.env.M15_DIVERGENCE_EDGE_PIVOT_LOOKBACK_BARS ||
      process.env.H1_DIVERGENCE_EDGE_PIVOT_LOOKBACK_BARS ||
      process.env.M15_DIVERGENCE_PIVOT_LEFT_BARS ||
      process.env.H1_DIVERGENCE_PIVOT_LEFT_BARS ||
      3
  ),
  m15DivergenceMinBarsBetweenPivots: Number(
    process.env.M15_DIVERGENCE_MIN_BARS_BETWEEN_PIVOTS ||
      process.env.H1_DIVERGENCE_MIN_BARS_BETWEEN_PIVOTS ||
      process.env.M15_DIVERGENCE_MIN_PIVOT_DISTANCE ||
      process.env.H1_DIVERGENCE_MIN_PIVOT_DISTANCE ||
      5
  ),
  m15DivergenceMinPivotDistance: Number(
    process.env.M15_DIVERGENCE_MIN_PIVOT_DISTANCE ||
      process.env.H1_DIVERGENCE_MIN_PIVOT_DISTANCE ||
      5
  ),
  m15DivergenceMaxPivotDistance: Number(
    process.env.M15_DIVERGENCE_MAX_PIVOT_DISTANCE ||
      process.env.H1_DIVERGENCE_MAX_PIVOT_DISTANCE ||
      10
  ),
  m15DivergenceMaxActivePivotDistance: Number(
    process.env.M15_DIVERGENCE_MAX_ACTIVE_PIVOT_DISTANCE ||
      process.env.H1_DIVERGENCE_MAX_ACTIVE_PIVOT_DISTANCE ||
      14
  ),
  m15DivergenceMaxIntermediatePivots: Number(
    process.env.M15_DIVERGENCE_MAX_INTERMEDIATE_PIVOTS ||
      process.env.H1_DIVERGENCE_MAX_INTERMEDIATE_PIVOTS ||
      0
  ),
  m15DivergenceEnableActiveT2: parseBoolean(
    process.env.M15_DIVERGENCE_ENABLE_ACTIVE_T2,
    parseBoolean(process.env.H1_DIVERGENCE_ENABLE_ACTIVE_T2, true)
  ),
  m15DivergenceActiveT2RightBars: Number(
      process.env.M15_DIVERGENCE_ACTIVE_T2_RIGHT_BARS ||
      process.env.H1_DIVERGENCE_ACTIVE_T2_RIGHT_BARS ||
      1
  ),
  m15DivergenceMinReferencePullbackPct: Number(
    process.env.M15_DIVERGENCE_MIN_REFERENCE_PULLBACK_PCT ||
      process.env.H1_DIVERGENCE_MIN_REFERENCE_PULLBACK_PCT ||
      2
  ),
  m15DivergenceRequireOppositeSwing: parseBoolean(
    process.env.M15_DIVERGENCE_REQUIRE_OPPOSITE_SWING,
    parseBoolean(process.env.H1_DIVERGENCE_REQUIRE_OPPOSITE_SWING, true)
  ),
  m15DivergencePriceTolerancePct: Number(
    process.env.M15_DIVERGENCE_PRICE_TOLERANCE_PCT ||
      process.env.H1_DIVERGENCE_PRICE_TOLERANCE_PCT ||
      0.25
  ),
  m15DivergenceMinPriceDeltaPct: Number(
    process.env.M15_DIVERGENCE_MIN_PRICE_DELTA_PCT ||
      process.env.H1_DIVERGENCE_MIN_PRICE_DELTA_PCT ||
      0.5
  ),
  m15DivergenceMinRsiDelta: Number(
    process.env.M15_DIVERGENCE_MIN_RSI_DELTA || process.env.H1_DIVERGENCE_MIN_RSI_DELTA || 5
  ),
  m15DivergenceMaxSignalAgeCandles: Number(
    process.env.M15_DIVERGENCE_MAX_SIGNAL_AGE_CANDLES ||
      process.env.H1_DIVERGENCE_MAX_SIGNAL_AGE_CANDLES ||
      3
  ),
  divergenceDedupTtlHours: Number(process.env.DIVERGENCE_DEDUP_TTL_HOURS || 24),
  divergenceDedupCleanupMinutes: Number(
    process.env.DIVERGENCE_DEDUP_CLEANUP_MINUTES || 60
  ),
  divergenceDebugEnabled: parseBoolean(process.env.DIVERGENCE_DEBUG_ENABLED, false),
  divergenceDebugSymbol: process.env.DIVERGENCE_DEBUG_SYMBOL || '',
  divergenceDebugTimeframe: process.env.DIVERGENCE_DEBUG_TIMEFRAME || '',
  divergenceMaxCounterMoveRatio: Number(
    process.env.DIVERGENCE_MAX_COUNTER_MOVE_RATIO || 0.25
  ),
  divergenceRsiContextMinDirectionEfficiency: Number(
    process.env.DIVERGENCE_RSI_CONTEXT_MIN_DIRECTION_EFFICIENCY || 0.35
  ),
  divergenceRsiContextFinalLegLookback: Number(
    process.env.DIVERGENCE_RSI_CONTEXT_FINAL_LEG_LOOKBACK || 4
  ),
  divergenceRsiContextMaxAllowedFinalCounterMove: Number(
    process.env.DIVERGENCE_RSI_CONTEXT_MAX_ALLOWED_FINAL_COUNTER_MOVE || 0.5
  ),
  divergenceRsiContextMinDirectionalStepRatio: Number(
    process.env.DIVERGENCE_RSI_CONTEXT_MIN_DIRECTIONAL_STEP_RATIO || 0.55
  ),
  divergenceRsiContextRequireRegressionSlopeConfirmation: parseBoolean(
    process.env.DIVERGENCE_RSI_CONTEXT_REQUIRE_REGRESSION_SLOPE_CONFIRMATION,
    true
  ),
  rsiOverboughtLevel: Number(process.env.RSI_OVERBOUGHT_LEVEL || 90),
  rsiOversoldLevel: Number(process.env.RSI_OVERSOLD_LEVEL || 10),

  cooldownMinutes: Number(process.env.COOLDOWN_MINUTES || 10),
  cooldownMs: Number(process.env.COOLDOWN_MINUTES || 10) * 60 * 1000,

  liquiditySignalEnabled: parseBoolean(process.env.LIQUIDITY_SIGNAL_ENABLED, true),
  liquiditySignalTimeframe,
  liquidityLookbackCandles: Number(process.env.LIQUIDITY_LOOKBACK_CANDLES || 24),
  liquidityMinPriceMovePct: Number(process.env.LIQUIDITY_MIN_PRICE_MOVE_PCT || 1.0),
  liquidityMinOiGrowthPct: Number(process.env.LIQUIDITY_MIN_OI_GROWTH_PCT || 2.0),
  liquidityMinDistancePct: Number(process.env.LIQUIDITY_MIN_DISTANCE_PCT || 0.5),
  liquidityMaxDistancePct: Number(process.env.LIQUIDITY_MAX_DISTANCE_PCT || 3.5),
  liquidityNearDistancePct: Number(process.env.LIQUIDITY_NEAR_DISTANCE_PCT || 2.0),
  liquidityMinStrengthScore: Number(process.env.LIQUIDITY_MIN_STRENGTH_SCORE || 6.0),
  liquidityStrongStrengthScore: Number(process.env.LIQUIDITY_STRONG_STRENGTH_SCORE || 7.0),
  liquidityUseFunding: parseBoolean(process.env.LIQUIDITY_USE_FUNDING, true),
  liquiditySignalCooldownMinutes: Number(
    process.env.LIQUIDITY_SIGNAL_COOLDOWN_MINUTES || 60
  ),
  liquiditySignalCooldownMs:
    Number(process.env.LIQUIDITY_SIGNAL_COOLDOWN_MINUTES || 60) * 60 * 1000,
  liquidityLogDetails: parseBoolean(process.env.LIQUIDITY_LOG_DETAILS, false),

  liquidityTrackingEnabled: parseBoolean(process.env.LIQUIDITY_TRACKING_ENABLED, true),
  liquidityTrackWindowMinutes: Number(process.env.LIQUIDITY_TRACK_WINDOW_MINUTES || 240),
  liquidityTrackingTimeframe,
  liquidityStatsFile: process.env.LIQUIDITY_STATS_FILE || './data/liquidity-stats.json',
  liquidityActiveSignalsFile:
    process.env.LIQUIDITY_ACTIVE_SIGNALS_FILE || './data/liquidity-active-signals.json',
  liquidityTrackLogDetails: parseBoolean(process.env.LIQUIDITY_TRACK_LOG_DETAILS, false),
};

function validateEnv() {
  if (!Number.isFinite(env.scanLimit) || env.scanLimit <= 0) {
    throw new Error('SCAN_LIMIT must be a positive number');
  }

  if (!Number.isFinite(env.scanIntervalMs) || env.scanIntervalMs <= 0) {
    throw new Error('SCAN_INTERVAL_MS must be a positive number');
  }

  if (!Number.isFinite(env.scanBatchSize) || env.scanBatchSize <= 0) {
    throw new Error('SCAN_BATCH_SIZE must be a positive number');
  }

  if (!Number.isFinite(env.fastSignalRecentCandles) || env.fastSignalRecentCandles <= 0) {
    throw new Error('FAST_SIGNAL_RECENT_CANDLES must be a positive number');
  }

  if (!Number.isFinite(env.rsiSignalRecentCandles) || env.rsiSignalRecentCandles <= 0) {
    throw new Error('RSI_SIGNAL_RECENT_CANDLES must be a positive number');
  }

  if (!['mean', 'median', 'trimmed'].includes(env.volumeBaselineMethod)) {
    throw new Error('VOLUME_BASELINE_METHOD must be one of: mean, median, trimmed');
  }

  if (
    !Number.isFinite(env.volumeBaselineTrimCount) ||
    env.volumeBaselineTrimCount < 0 ||
    !Number.isInteger(env.volumeBaselineTrimCount)
  ) {
    throw new Error('VOLUME_BASELINE_TRIM_COUNT must be a non-negative integer');
  }

  if (
    !Number.isFinite(env.volumeContextLookbackCandles) ||
    env.volumeContextLookbackCandles <= 0
  ) {
    throw new Error('VOLUME_CONTEXT_LOOKBACK_CANDLES must be a positive number');
  }

  if (
    !Number.isFinite(env.volumeContextMinRatioToRecentMax) ||
    env.volumeContextMinRatioToRecentMax <= 0
  ) {
    throw new Error('VOLUME_CONTEXT_MIN_RATIO_TO_RECENT_MAX must be a positive number');
  }

  if (!Number.isFinite(env.cooldownMinutes) || env.cooldownMinutes < 0) {
    throw new Error('COOLDOWN_MINUTES must be a non-negative number');
  }

  if (!Number.isFinite(env.rsiOverboughtLevel) || !Number.isFinite(env.rsiOversoldLevel)) {
    throw new Error('RSI_OVERBOUGHT_LEVEL and RSI_OVERSOLD_LEVEL must be numeric');
  }

  if (!isValidTimeZone(env.telegramTimeZone)) {
    throw new Error('TELEGRAM_TIMEZONE must be a valid IANA time zone, for example UTC or Europe/Kyiv');
  }

  if (!isValidTimeframe(env.volumeSignalTimeframe)) {
    throw new Error(
      'VOLUME_SIGNAL_TIMEFRAME or MAIN_SIGNAL_TIMEFRAME must look like 1m, 3m, 5m, 1h, etc.'
    );
  }

  if (!isValidTimeframe(env.rsiSignalTimeframe)) {
    throw new Error('RSI_SIGNAL_TIMEFRAME must look like 1m, 3m, 5m, 1h, etc.');
  }

  if (!isValidTimeframe(env.h1DivergenceTimeframe)) {
    throw new Error('H1_DIVERGENCE_TIMEFRAME must look like 1h.');
  }

  if (String(env.h1DivergenceTimeframe).toLowerCase() !== '1h') {
    throw new Error(
      'H1_DIVERGENCE_TIMEFRAME must stay 1h because the current divergence scheduler is aligned to hourly closes'
    );
  }

  if (!isValidTimeframe(env.m15DivergenceTimeframe)) {
    throw new Error('M15_DIVERGENCE_TIMEFRAME must look like 15m.');
  }

  if (String(env.m15DivergenceTimeframe).toLowerCase() !== '15m') {
    throw new Error(
      'M15_DIVERGENCE_TIMEFRAME must stay 15m because the current divergence scheduler is aligned to 15-minute closes'
    );
  }

  if (!Number.isFinite(env.h1DivergenceLookbackCandles) || env.h1DivergenceLookbackCandles <= 0) {
    throw new Error('H1_DIVERGENCE_LOOKBACK_CANDLES must be a positive number');
  }

  if (!Number.isFinite(env.h1DivergenceRsiPeriod) || env.h1DivergenceRsiPeriod <= 0) {
    throw new Error('H1_DIVERGENCE_RSI_PERIOD must be a positive number');
  }

  if (!Number.isFinite(env.h1DivergenceCloseDelayMs) || env.h1DivergenceCloseDelayMs < 0) {
    throw new Error('H1_DIVERGENCE_CLOSE_DELAY_MS must be a non-negative number');
  }

  if (!Number.isFinite(env.h1DivergencePivotLeftBars) || env.h1DivergencePivotLeftBars <= 0) {
    throw new Error('H1_DIVERGENCE_PIVOT_LEFT_BARS must be a positive number');
  }

  if (!Number.isFinite(env.h1DivergencePivotRightBars) || env.h1DivergencePivotRightBars <= 0) {
    throw new Error('H1_DIVERGENCE_PIVOT_RIGHT_BARS must be a positive number');
  }

  if (
    !Number.isFinite(env.h1DivergenceSignificantPivotWindowBars) ||
    env.h1DivergenceSignificantPivotWindowBars <= 0
  ) {
    throw new Error('H1_DIVERGENCE_SIGNIFICANT_PIVOT_WINDOW_BARS must be a positive number');
  }

  if (
    !Number.isFinite(env.h1DivergenceEdgePivotLookbackBars) ||
    env.h1DivergenceEdgePivotLookbackBars <= 0
  ) {
    throw new Error('H1_DIVERGENCE_EDGE_PIVOT_LOOKBACK_BARS must be a positive number');
  }

  if (!Number.isFinite(env.h1DivergenceMinPivotDistance) || env.h1DivergenceMinPivotDistance <= 0) {
    throw new Error('H1_DIVERGENCE_MIN_PIVOT_DISTANCE must be a positive number');
  }

  if (
    !Number.isFinite(env.h1DivergenceMinBarsBetweenPivots) ||
    env.h1DivergenceMinBarsBetweenPivots <= 0
  ) {
    throw new Error('H1_DIVERGENCE_MIN_BARS_BETWEEN_PIVOTS must be a positive number');
  }

  if (!Number.isFinite(env.h1DivergenceMaxPivotDistance) || env.h1DivergenceMaxPivotDistance <= 0) {
    throw new Error('H1_DIVERGENCE_MAX_PIVOT_DISTANCE must be a positive number');
  }

  if (
    !Number.isFinite(env.h1DivergenceMaxActivePivotDistance) ||
    env.h1DivergenceMaxActivePivotDistance <= 0
  ) {
    throw new Error('H1_DIVERGENCE_MAX_ACTIVE_PIVOT_DISTANCE must be a positive number');
  }

  if (env.h1DivergenceMaxPivotDistance < env.h1DivergenceMinPivotDistance) {
    throw new Error(
      'H1_DIVERGENCE_MAX_PIVOT_DISTANCE must be greater than or equal to H1_DIVERGENCE_MIN_PIVOT_DISTANCE'
    );
  }

  if (env.h1DivergenceMaxPivotDistance < env.h1DivergenceMinBarsBetweenPivots) {
    throw new Error(
      'H1_DIVERGENCE_MAX_PIVOT_DISTANCE must be greater than or equal to H1_DIVERGENCE_MIN_BARS_BETWEEN_PIVOTS'
    );
  }

  if (env.h1DivergenceMaxActivePivotDistance < env.h1DivergenceMinPivotDistance) {
    throw new Error(
      'H1_DIVERGENCE_MAX_ACTIVE_PIVOT_DISTANCE must be greater than or equal to H1_DIVERGENCE_MIN_PIVOT_DISTANCE'
    );
  }

  if (
    !Number.isFinite(env.h1DivergenceMaxIntermediatePivots) ||
    env.h1DivergenceMaxIntermediatePivots < 0
  ) {
    throw new Error('H1_DIVERGENCE_MAX_INTERMEDIATE_PIVOTS must be a non-negative number');
  }

  if (!Number.isFinite(env.h1DivergenceActiveT2RightBars) || env.h1DivergenceActiveT2RightBars <= 0) {
    throw new Error('H1_DIVERGENCE_ACTIVE_T2_RIGHT_BARS must be a positive number');
  }

  if (
    !Number.isFinite(env.h1DivergenceMinReferencePullbackPct) ||
    env.h1DivergenceMinReferencePullbackPct < 0
  ) {
    throw new Error('H1_DIVERGENCE_MIN_REFERENCE_PULLBACK_PCT must be a non-negative number');
  }

  if (!Number.isFinite(env.h1DivergencePriceTolerancePct) || env.h1DivergencePriceTolerancePct < 0) {
    throw new Error('H1_DIVERGENCE_PRICE_TOLERANCE_PCT must be a non-negative number');
  }

  if (!Number.isFinite(env.h1DivergenceMinPriceDeltaPct) || env.h1DivergenceMinPriceDeltaPct < 0) {
    throw new Error('H1_DIVERGENCE_MIN_PRICE_DELTA_PCT must be a non-negative number');
  }

  if (!Number.isFinite(env.h1DivergenceMinRsiDelta) || env.h1DivergenceMinRsiDelta < 0) {
    throw new Error('H1_DIVERGENCE_MIN_RSI_DELTA must be a non-negative number');
  }

  if (
    !Number.isFinite(env.h1DivergenceMaxSignalAgeCandles) ||
    env.h1DivergenceMaxSignalAgeCandles <= 0
  ) {
    throw new Error('H1_DIVERGENCE_MAX_SIGNAL_AGE_CANDLES must be a positive number');
  }

  if (!Number.isFinite(env.m15DivergenceLookbackCandles) || env.m15DivergenceLookbackCandles <= 0) {
    throw new Error('M15_DIVERGENCE_LOOKBACK_CANDLES must be a positive number');
  }

  if (!Number.isFinite(env.m15DivergenceRsiPeriod) || env.m15DivergenceRsiPeriod <= 0) {
    throw new Error('M15_DIVERGENCE_RSI_PERIOD must be a positive number');
  }

  if (!Number.isFinite(env.m15DivergenceCloseDelayMs) || env.m15DivergenceCloseDelayMs < 0) {
    throw new Error('M15_DIVERGENCE_CLOSE_DELAY_MS must be a non-negative number');
  }

  if (!Number.isFinite(env.m15DivergencePivotLeftBars) || env.m15DivergencePivotLeftBars <= 0) {
    throw new Error('M15_DIVERGENCE_PIVOT_LEFT_BARS must be a positive number');
  }

  if (!Number.isFinite(env.m15DivergencePivotRightBars) || env.m15DivergencePivotRightBars <= 0) {
    throw new Error('M15_DIVERGENCE_PIVOT_RIGHT_BARS must be a positive number');
  }

  if (
    !Number.isFinite(env.m15DivergenceSignificantPivotWindowBars) ||
    env.m15DivergenceSignificantPivotWindowBars <= 0
  ) {
    throw new Error('M15_DIVERGENCE_SIGNIFICANT_PIVOT_WINDOW_BARS must be a positive number');
  }

  if (
    !Number.isFinite(env.m15DivergenceEdgePivotLookbackBars) ||
    env.m15DivergenceEdgePivotLookbackBars <= 0
  ) {
    throw new Error('M15_DIVERGENCE_EDGE_PIVOT_LOOKBACK_BARS must be a positive number');
  }

  if (!Number.isFinite(env.m15DivergenceMinPivotDistance) || env.m15DivergenceMinPivotDistance <= 0) {
    throw new Error('M15_DIVERGENCE_MIN_PIVOT_DISTANCE must be a positive number');
  }

  if (
    !Number.isFinite(env.m15DivergenceMinBarsBetweenPivots) ||
    env.m15DivergenceMinBarsBetweenPivots <= 0
  ) {
    throw new Error('M15_DIVERGENCE_MIN_BARS_BETWEEN_PIVOTS must be a positive number');
  }

  if (!Number.isFinite(env.m15DivergenceMaxPivotDistance) || env.m15DivergenceMaxPivotDistance <= 0) {
    throw new Error('M15_DIVERGENCE_MAX_PIVOT_DISTANCE must be a positive number');
  }

  if (
    !Number.isFinite(env.m15DivergenceMaxActivePivotDistance) ||
    env.m15DivergenceMaxActivePivotDistance <= 0
  ) {
    throw new Error('M15_DIVERGENCE_MAX_ACTIVE_PIVOT_DISTANCE must be a positive number');
  }

  if (env.m15DivergenceMaxPivotDistance < env.m15DivergenceMinPivotDistance) {
    throw new Error(
      'M15_DIVERGENCE_MAX_PIVOT_DISTANCE must be greater than or equal to M15_DIVERGENCE_MIN_PIVOT_DISTANCE'
    );
  }

  if (env.m15DivergenceMaxPivotDistance < env.m15DivergenceMinBarsBetweenPivots) {
    throw new Error(
      'M15_DIVERGENCE_MAX_PIVOT_DISTANCE must be greater than or equal to M15_DIVERGENCE_MIN_BARS_BETWEEN_PIVOTS'
    );
  }

  if (env.m15DivergenceMaxActivePivotDistance < env.m15DivergenceMinPivotDistance) {
    throw new Error(
      'M15_DIVERGENCE_MAX_ACTIVE_PIVOT_DISTANCE must be greater than or equal to M15_DIVERGENCE_MIN_PIVOT_DISTANCE'
    );
  }

  if (
    !Number.isFinite(env.m15DivergenceMaxIntermediatePivots) ||
    env.m15DivergenceMaxIntermediatePivots < 0
  ) {
    throw new Error('M15_DIVERGENCE_MAX_INTERMEDIATE_PIVOTS must be a non-negative number');
  }

  if (!Number.isFinite(env.m15DivergenceActiveT2RightBars) || env.m15DivergenceActiveT2RightBars <= 0) {
    throw new Error('M15_DIVERGENCE_ACTIVE_T2_RIGHT_BARS must be a positive number');
  }

  if (
    !Number.isFinite(env.m15DivergenceMinReferencePullbackPct) ||
    env.m15DivergenceMinReferencePullbackPct < 0
  ) {
    throw new Error('M15_DIVERGENCE_MIN_REFERENCE_PULLBACK_PCT must be a non-negative number');
  }

  if (!Number.isFinite(env.m15DivergencePriceTolerancePct) || env.m15DivergencePriceTolerancePct < 0) {
    throw new Error('M15_DIVERGENCE_PRICE_TOLERANCE_PCT must be a non-negative number');
  }

  if (!Number.isFinite(env.m15DivergenceMinPriceDeltaPct) || env.m15DivergenceMinPriceDeltaPct < 0) {
    throw new Error('M15_DIVERGENCE_MIN_PRICE_DELTA_PCT must be a non-negative number');
  }

  if (!Number.isFinite(env.m15DivergenceMinRsiDelta) || env.m15DivergenceMinRsiDelta < 0) {
    throw new Error('M15_DIVERGENCE_MIN_RSI_DELTA must be a non-negative number');
  }

  if (
    !Number.isFinite(env.m15DivergenceMaxSignalAgeCandles) ||
    env.m15DivergenceMaxSignalAgeCandles <= 0
  ) {
    throw new Error('M15_DIVERGENCE_MAX_SIGNAL_AGE_CANDLES must be a positive number');
  }

  if (!Number.isFinite(env.divergenceDedupTtlHours) || env.divergenceDedupTtlHours <= 0) {
    throw new Error('DIVERGENCE_DEDUP_TTL_HOURS must be a positive number');
  }

  if (
    !Number.isFinite(env.divergenceDedupCleanupMinutes) ||
    env.divergenceDedupCleanupMinutes <= 0
  ) {
    throw new Error('DIVERGENCE_DEDUP_CLEANUP_MINUTES must be a positive number');
  }

  if (
    !Number.isFinite(env.divergenceMaxCounterMoveRatio) ||
    env.divergenceMaxCounterMoveRatio < 0 ||
    env.divergenceMaxCounterMoveRatio > 1
  ) {
    throw new Error('DIVERGENCE_MAX_COUNTER_MOVE_RATIO must be between 0 and 1');
  }

  if (
    !Number.isFinite(env.divergenceRsiContextMinDirectionEfficiency) ||
    env.divergenceRsiContextMinDirectionEfficiency < 0 ||
    env.divergenceRsiContextMinDirectionEfficiency > 1
  ) {
    throw new Error(
      'DIVERGENCE_RSI_CONTEXT_MIN_DIRECTION_EFFICIENCY must be between 0 and 1'
    );
  }

  if (
    !Number.isFinite(env.divergenceRsiContextFinalLegLookback) ||
    env.divergenceRsiContextFinalLegLookback <= 0 ||
    !Number.isInteger(env.divergenceRsiContextFinalLegLookback)
  ) {
    throw new Error('DIVERGENCE_RSI_CONTEXT_FINAL_LEG_LOOKBACK must be a positive integer');
  }

  if (
    !Number.isFinite(env.divergenceRsiContextMaxAllowedFinalCounterMove) ||
    env.divergenceRsiContextMaxAllowedFinalCounterMove < 0
  ) {
    throw new Error(
      'DIVERGENCE_RSI_CONTEXT_MAX_ALLOWED_FINAL_COUNTER_MOVE must be a non-negative number'
    );
  }

  if (
    !Number.isFinite(env.divergenceRsiContextMinDirectionalStepRatio) ||
    env.divergenceRsiContextMinDirectionalStepRatio < 0 ||
    env.divergenceRsiContextMinDirectionalStepRatio > 1
  ) {
    throw new Error(
      'DIVERGENCE_RSI_CONTEXT_MIN_DIRECTIONAL_STEP_RATIO must be between 0 and 1'
    );
  }

  if (!Number.isFinite(env.liquidityLookbackCandles) || env.liquidityLookbackCandles <= 0) {
    throw new Error('LIQUIDITY_LOOKBACK_CANDLES must be a positive number');
  }

  if (!isValidTimeframe(env.liquiditySignalTimeframe)) {
    throw new Error('LIQUIDITY_SIGNAL_TIMEFRAME must look like 1m, 3m, 5m, 1h, etc.');
  }

  if (!Number.isFinite(env.liquidityMinDistancePct) || env.liquidityMinDistancePct < 0) {
    throw new Error('LIQUIDITY_MIN_DISTANCE_PCT must be a non-negative number');
  }

  if (!Number.isFinite(env.liquidityMaxDistancePct) || env.liquidityMaxDistancePct <= 0) {
    throw new Error('LIQUIDITY_MAX_DISTANCE_PCT must be a positive number');
  }

  if (!Number.isFinite(env.liquiditySignalCooldownMinutes) || env.liquiditySignalCooldownMinutes < 0) {
    throw new Error('LIQUIDITY_SIGNAL_COOLDOWN_MINUTES must be a non-negative number');
  }

  if (!Number.isFinite(env.liquidityTrackWindowMinutes) || env.liquidityTrackWindowMinutes <= 0) {
    throw new Error('LIQUIDITY_TRACK_WINDOW_MINUTES must be a positive number');
  }

  if (!isValidTimeframe(env.liquidityTrackingTimeframe)) {
    throw new Error('LIQUIDITY_TRACKING_TIMEFRAME must look like 1m, 3m, 5m, 1h, etc.');
  }
}

module.exports = {
  env,
  validateEnv,
};
