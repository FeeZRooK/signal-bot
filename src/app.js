const http = require('http');
const path = require('path');

require('dotenv').config({
  path: path.resolve(process.cwd(), process.env.ENV_FILE || '.env'),
  override: true,
});

const { env, validateEnv } = require('./config/env');
const {
  getTopUsdtSymbolsByVolume,
  getClosedKlines,
  isSymbolTrading,
} = require('./services/binance.service');
const { sendTelegramMessage } = require('./services/telegram.service');
const {
  getH1DivergenceSignal,
  getM15DivergenceSignal,
} = require('./services/divergence.service');
const { getLiquiditySignal } = require('./services/liquidity-signal.service');
const {
  registerTrackedLiquiditySignal,
  checkTrackedLiquiditySignals,
  getLiquidityTrackingStats,
} = require('./services/liquidity-tracker.service');
const {
  buildTelegramCandleTimeLabel,
  formatTimestampInTimeZone,
} = require('./utils/time.util');

const lastSignalState = new Map();
const sentSignalKeys = new Set();
const sentDivergenceSignals = new Map();
const RSI_PERIOD = 14;
let top10Logged = false;
const divergenceTimers = new Map();


const healthServerState = {
  startedAt: new Date().toISOString(),
  botStarted: false,
};

function startHealthServer() {
  const port = Number(process.env.PORT || 3000);

  const server = http.createServer((request, response) => {
    if (request.url === '/health') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({
        status: 'ok',
        service: 'signal-bot',
        botStarted: healthServerState.botStarted,
        startedAt: healthServerState.startedAt,
      }));
      return;
    }

    if (request.url === '/' || request.url === '/healthz') {
      response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('OK');
      return;
    }

    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not Found');
  });

  server.listen(port, '0.0.0.0', () => {
    console.log('[health] server listening on port ' + port);
  });

  return server;
}

function getDivergenceDedupTtlMs() {
  return env.divergenceDedupTtlHours * 60 * 60 * 1000;
}

function getSignalStateKey(symbol, signalType, timeframe) {
  return `${symbol}:${timeframe}:${signalType}`;
}

function isDivergenceSignal(signal) {
  return /_DIVERGENCE_(BULLISH|BEARISH)$/.test(String(signal?.type || ''));
}

function getDivergenceSignalKey(signal) {
  return [
    signal.symbol,
    signal.timeframe,
    signal.type,
    signal.divergenceKind || 'REGULAR',
    signal.point1TimeMs,
    signal.point2TimeMs,
    signal.point1PriceIndex,
    signal.point2PriceIndex,
    signal.t2Source || 'unknown',
  ].join(':');
}

function getSentSignalKey(signal) {
  if (isDivergenceSignal(signal)) {
    return getDivergenceSignalKey(signal);
  }

  return `${signal.symbol}:${signal.timeframe}:${signal.type}:${signal.closeTimeMs}`;
}

function cleanupExpiredDivergenceSignals(now = Date.now()) {
  const ttlMs = getDivergenceDedupTtlMs();

  for (const [signalKey, sentAt] of sentDivergenceSignals.entries()) {
    if (now - sentAt >= ttlMs) {
      sentDivergenceSignals.delete(signalKey);
    }
  }
}

function getAverageVolume(candles) {
  const totalVolume = candles.reduce((sum, candle) => sum + candle.volume, 0);
  return totalVolume / candles.length;
}

function getMedianVolume(candles) {
  const sortedVolumes = candles
    .map((candle) => candle.volume)
    .slice()
    .sort((left, right) => left - right);
  const middleIndex = Math.floor(sortedVolumes.length / 2);

  if (sortedVolumes.length % 2 === 1) {
    return sortedVolumes[middleIndex];
  }

  return (sortedVolumes[middleIndex - 1] + sortedVolumes[middleIndex]) / 2;
}

function getTrimmedAverageVolume(candles, trimCount) {
  const sortedVolumes = candles
    .map((candle) => candle.volume)
    .slice()
    .sort((left, right) => left - right);
  const trimmedVolumes = sortedVolumes.slice(
    0,
    Math.max(1, sortedVolumes.length - trimCount)
  );
  const totalVolume = trimmedVolumes.reduce((sum, volume) => sum + volume, 0);

  return totalVolume / trimmedVolumes.length;
}

function getVolumeBaselines(candles, trimCount) {
  const meanVolume = getAverageVolume(candles);
  const medianVolume = getMedianVolume(candles);
  const trimmedVolume = getTrimmedAverageVolume(candles, trimCount);

  return {
    meanVolume,
    medianVolume,
    trimmedVolume,
  };
}

function getPrimaryBaselineVolume(baselines) {
  if (env.volumeBaselineMethod === 'median') {
    return baselines.medianVolume;
  }

  if (env.volumeBaselineMethod === 'trimmed') {
    return baselines.trimmedVolume;
  }

  return baselines.meanVolume;
}

function getPercentileValue(values, percentile) {
  if (!values.length) {
    return null;
  }

  const sortedValues = values.slice().sort((left, right) => left - right);
  const position = (sortedValues.length - 1) * percentile;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);

  if (lowerIndex === upperIndex) {
    return sortedValues[lowerIndex];
  }

  const weight = position - lowerIndex;
  return (
    sortedValues[lowerIndex] * (1 - weight) +
    sortedValues[upperIndex] * weight
  );
}

function calculateRsi(candles, period = RSI_PERIOD) {
  if (candles.length < period + 1) {
    return null;
  }

  const closes = candles.map((candle) => Number(candle.close));

  if (closes.some((value) => Number.isNaN(value))) {
    console.log('[RSI] NaN detected in closes', closes);
    return null;
  }

  const deltas = [];

  for (let index = 1; index < closes.length; index += 1) {
    deltas.push(closes[index] - closes[index - 1]);
  }

  let averageGain = 0;
  let averageLoss = 0;

  for (let index = 0; index < period; index += 1) {
    const delta = deltas[index];
    averageGain += delta > 0 ? delta : 0;
    averageLoss += delta < 0 ? Math.abs(delta) : 0;
  }

  averageGain /= period;
  averageLoss /= period;

  for (let index = period; index < deltas.length; index += 1) {
    const delta = deltas[index];
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? Math.abs(delta) : 0;

    averageGain = (averageGain * (period - 1) + gain) / period;
    averageLoss = (averageLoss * (period - 1) + loss) / period;
  }

  if (averageLoss === 0) {
    return 100;
  }

  if (averageGain === 0) {
    return 0;
  }

  const relativeStrength = averageGain / averageLoss;
  return 100 - 100 / (1 + relativeStrength);
}

function parseDebugCloseTime(closeTimeValue) {
  if (!closeTimeValue) {
    return null;
  }

  if (/^\d+$/.test(String(closeTimeValue).trim())) {
    return Number(closeTimeValue);
  }

  const parsed = Date.parse(closeTimeValue);
  return Number.isNaN(parsed) ? null : parsed;
}

function isDebugTimeframeMatch(symbol, timeframe) {
  if (!env.debugSignalSymbol || !env.debugSignalTimeframe) {
    return false;
  }

  return (
    String(env.debugSignalSymbol).toUpperCase() === String(symbol).toUpperCase() &&
    String(env.debugSignalTimeframe) === String(timeframe)
  );
}

function shouldLogSignalDebug(symbol, timeframe, closeTimeMs) {
  if (!isDebugTimeframeMatch(symbol, timeframe) || !env.debugSignalCloseTime) {
    return false;
  }

  const debugCloseTimeMs = parseDebugCloseTime(env.debugSignalCloseTime);

  if (!Number.isFinite(debugCloseTimeMs)) {
    return false;
  }

  return Number(closeTimeMs) === debugCloseTimeMs;
}

function mapDebugCandles(candles) {
  return candles.map((candle, index) => ({
    index,
    openTime: candle.openTime,
    closeTime: candle.closeTime,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
  }));
}

function buildDiagnosticBase(kind, symbol, timeframe, candles, signalIndex) {
  const signalCandle = candles[signalIndex] || null;

  return {
    kind,
    symbol,
    timeframe,
    fetchedCandlesCount: candles.length,
    fetchedCandles: isDebugTimeframeMatch(symbol, timeframe) ? mapDebugCandles(candles) : undefined,
    signalCandleIndex: signalIndex,
    closeTimeMs: signalCandle ? signalCandle.closeTime : null,
    signalCandle: signalCandle
      ? {
          openTime: signalCandle.openTime,
          closeTime: signalCandle.closeTime,
          open: signalCandle.open,
          high: signalCandle.high,
          low: signalCandle.low,
          close: signalCandle.close,
          volume: signalCandle.volume,
        }
      : null,
  };
}

function getRecentSignalIndexes(candles, recentCandles, minimumHistory) {
  const indexes = [];
  const startIndex = Math.max(minimumHistory, candles.length - recentCandles);

  for (let index = candles.length - 1; index >= startIndex; index -= 1) {
    indexes.push(index);
  }

  return indexes;
}

function buildVolumeSignalType(volumeRatio, absolutePriceChangePercent) {
  if (volumeRatio >= 8 && absolutePriceChangePercent >= 0.5) {
    return {
      level: 'STRONG',
      emoji: '🚨',
      reason: 'volume_ratio>=8 and abs_price_change>=0.5',
    };
  }

  if (volumeRatio >= 4 && absolutePriceChangePercent >= 0.25) {
    return {
      level: 'NORMAL',
      emoji: '🔔',
      reason: 'volume_ratio>=4 and abs_price_change>=0.25',
    };
  }

  return null;
}

function evaluateVolumeSignalAtIndex(symbol, timeframe, candles, signalIndex) {
  const diagnostic = buildDiagnosticBase('volume', symbol, timeframe, candles, signalIndex);

  if (!diagnostic.signalCandle) {
    diagnostic.rejectedReason = 'signal_candle_not_found';
    return { signal: null, diagnostic };
  }

  if (signalIndex < 10) {
    diagnostic.rejectedReason = 'insufficient_history_for_volume_baseline';
    return { signal: null, diagnostic };
  }

  const signalCandle = candles[signalIndex];
  const previousCandles = candles.slice(signalIndex - 10, signalIndex);
  const contextCandles = candles.slice(
    Math.max(0, signalIndex - env.volumeContextLookbackCandles),
    signalIndex
  );
  const baselines = getVolumeBaselines(previousCandles, env.volumeBaselineTrimCount);
  const averageVolume = baselines.meanVolume;
  const medianVolume = baselines.medianVolume;
  const trimmedVolume = baselines.trimmedVolume;
  const baselineVolume = getPrimaryBaselineVolume(baselines);
  const contextVolumes = contextCandles.map((candle) => candle.volume);
  const contextMaxVolume = contextVolumes.length > 0 ? Math.max(...contextVolumes) : null;
  const contextP90Volume = getPercentileValue(contextVolumes, 0.9);
  const contextP95Volume = getPercentileValue(contextVolumes, 0.95);
  const currentToContextMaxRatio =
    Number.isFinite(contextMaxVolume) && contextMaxVolume > 0
      ? signalCandle.volume / contextMaxVolume
      : null;
  const priceChangePercent =
    ((signalCandle.close - signalCandle.open) / signalCandle.open) * 100;
  const absolutePriceChangePercent = Math.abs(priceChangePercent);
  const volumeRatioMean = averageVolume > 0 ? signalCandle.volume / averageVolume : null;
  const volumeRatioMedian = medianVolume > 0 ? signalCandle.volume / medianVolume : null;
  const volumeRatioTrimmed = trimmedVolume > 0 ? signalCandle.volume / trimmedVolume : null;
  const volumeRatio = baselineVolume > 0 ? signalCandle.volume / baselineVolume : null;
  const signalType = Number.isFinite(volumeRatio)
    ? buildVolumeSignalType(volumeRatio, absolutePriceChangePercent)
    : null;

  diagnostic.baselineCandles = previousCandles.map((candle, index) => ({
    index: signalIndex - previousCandles.length + index,
    closeTime: candle.closeTime,
    volume: candle.volume,
  }));
  diagnostic.averageVolume = averageVolume;
  diagnostic.medianVolume = medianVolume;
  diagnostic.trimmedVolume = trimmedVolume;
  diagnostic.baselineMethod = env.volumeBaselineMethod;
  diagnostic.baselineVolume = baselineVolume;
  diagnostic.volumeRatio = volumeRatio;
  diagnostic.volumeRatioMean = volumeRatioMean;
  diagnostic.volumeRatioMedian = volumeRatioMedian;
  diagnostic.volumeRatioTrimmed = volumeRatioTrimmed;
  diagnostic.contextLookbackCandles = contextCandles.length;
  diagnostic.contextVolumes = contextCandles.map((candle, index) => ({
    index: signalIndex - contextCandles.length + index,
    closeTime: candle.closeTime,
    volume: candle.volume,
  }));
  diagnostic.contextMaxVolume = contextMaxVolume;
  diagnostic.contextP90Volume = contextP90Volume;
  diagnostic.contextP95Volume = contextP95Volume;
  diagnostic.currentToContextMaxRatio = currentToContextMaxRatio;
  diagnostic.priceMovePct = priceChangePercent;
  diagnostic.absolutePriceMovePct = absolutePriceChangePercent;
  diagnostic.detectedSignalLevel = signalType ? signalType.level : null;

  if (baselineVolume <= 0) {
    diagnostic.rejectedReason = 'non_positive_volume_baseline';
    return { signal: null, diagnostic };
  }

  if (!signalType) {
    diagnostic.rejectedReason = 'volume_or_price_threshold_not_met';
    return { signal: null, diagnostic };
  }

  if (
    env.volumeContextFilterEnabled &&
    Number.isFinite(currentToContextMaxRatio) &&
    currentToContextMaxRatio < env.volumeContextMinRatioToRecentMax
  ) {
    diagnostic.rejectedReason = 'volume_context_filter_not_met';
    return { signal: null, diagnostic };
  }

  return {
    signal: {
      type: 'VOLUME_PRICE',
      symbol,
      level: signalType.level,
      emoji: signalType.emoji,
      direction: priceChangePercent > 0 ? 'LONG' : 'SHORT',
      timeframe,
      closeTimeMs: signalCandle.closeTime,
      closeTime: new Date(signalCandle.closeTime).toISOString(),
      open: signalCandle.open,
      close: signalCandle.close,
      volume: signalCandle.volume,
      averageVolume,
      medianVolume,
      trimmedVolume,
      baselineMethod: env.volumeBaselineMethod,
      baselineVolume,
      volumeRatio,
      volumeRatioMean,
      volumeRatioMedian,
      volumeRatioTrimmed,
      contextMaxVolume,
      contextP90Volume,
      contextP95Volume,
      currentToContextMaxRatio,
      priceChangePercent,
    },
    diagnostic: {
      ...diagnostic,
      signalDecisionReason: signalType.reason,
    },
  };
}

function evaluateRsiSignalAtIndex(symbol, timeframe, candles, signalIndex) {
  const diagnostic = buildDiagnosticBase('rsi', symbol, timeframe, candles, signalIndex);

  if (!diagnostic.signalCandle) {
    diagnostic.rejectedReason = 'signal_candle_not_found';
    return { signal: null, diagnostic };
  }

  if (signalIndex < RSI_PERIOD) {
    diagnostic.rejectedReason = 'insufficient_history_for_rsi';
    return { signal: null, diagnostic };
  }

  const signalCandle = candles[signalIndex];
  const rsiInputCandles = candles.slice(0, signalIndex + 1);
  const rsi = calculateRsi(rsiInputCandles, RSI_PERIOD);

  diagnostic.rsi = rsi;
  diagnostic.rsiInputCandlesCount = rsiInputCandles.length;

  if (rsi === null) {
    diagnostic.rejectedReason = 'rsi_is_null';
    return { signal: null, diagnostic };
  }

  if (rsi >= env.rsiOverboughtLevel) {
    return {
      signal: {
        type: 'RSI',
        symbol,
        emoji: '📊',
        timeframe,
        closeTimeMs: signalCandle.closeTime,
        closeTime: new Date(signalCandle.closeTime).toISOString(),
        close: signalCandle.close,
        rsi,
      },
      diagnostic: {
        ...diagnostic,
        signalDecisionReason: `rsi>=${env.rsiOverboughtLevel}`,
      },
    };
  }

  if (rsi <= env.rsiOversoldLevel) {
    return {
      signal: {
        type: 'RSI',
        symbol,
        emoji: '📊',
        timeframe,
        closeTimeMs: signalCandle.closeTime,
        closeTime: new Date(signalCandle.closeTime).toISOString(),
        close: signalCandle.close,
        rsi,
      },
      diagnostic: {
        ...diagnostic,
        signalDecisionReason: `rsi<=${env.rsiOversoldLevel}`,
      },
    };
  }

  diagnostic.rejectedReason = 'rsi_threshold_not_met';
  return { signal: null, diagnostic };
}

function getVolumeSignalEvaluations(symbol, candles) {
  return getRecentSignalIndexes(candles, env.fastSignalRecentCandles, 10).map((signalIndex) =>
    evaluateVolumeSignalAtIndex(symbol, env.volumeSignalTimeframe, candles, signalIndex)
  );
}

function getRsiSignalEvaluations(symbol, candles) {
  return getRecentSignalIndexes(candles, env.rsiSignalRecentCandles, RSI_PERIOD).map((signalIndex) =>
    evaluateRsiSignalAtIndex(symbol, env.rsiSignalTimeframe, candles, signalIndex)
  );
}

function isDuplicateSignal(signal) {
  if (isDivergenceSignal(signal)) {
    cleanupExpiredDivergenceSignals();
    return sentDivergenceSignals.has(getDivergenceSignalKey(signal));
  }

  return sentSignalKeys.has(getSentSignalKey(signal));
}

function isCooldownActive(signal) {
  const state = lastSignalState.get(getSignalStateKey(signal.symbol, signal.type, signal.timeframe));
  if (!state) {
    return false;
  }

  return signal.closeTimeMs - state.closeTimeMs < env.cooldownMs;
}

function markSignalSent(signal) {
  if (isDivergenceSignal(signal)) {
    cleanupExpiredDivergenceSignals();
    sentDivergenceSignals.set(getDivergenceSignalKey(signal), Date.now());
  } else {
    sentSignalKeys.add(getSentSignalKey(signal));
  }

  lastSignalState.set(getSignalStateKey(signal.symbol, signal.type, signal.timeframe), {
    closeTimeMs: signal.closeTimeMs,
  });
}

function buildProcessedDiagnostic(signal, diagnostic) {
  const expectedSignalType =
    signal
      ? signal.type
      : diagnostic.kind === 'volume'
        ? 'VOLUME_PRICE'
        : diagnostic.kind === 'rsi'
          ? 'RSI'
          : signal?.type || 'UNKNOWN';
  const closeTimeMs = signal ? signal.closeTimeMs : diagnostic.closeTimeMs;
  const timeframe = signal ? signal.timeframe : diagnostic.timeframe;
  const sentSignalKey = signal
    ? getSentSignalKey(signal)
    : `${diagnostic.symbol}:${timeframe}:${expectedSignalType}:${closeTimeMs}`;
  const cooldownStateKey = getSignalStateKey(
    diagnostic.symbol,
    expectedSignalType,
    timeframe
  );
  const lastState = lastSignalState.get(cooldownStateKey) || null;
  const duplicate = signal ? isDuplicateSignal(signal) : false;
  const cooldownActive = signal ? isCooldownActive(signal) : false;
  const droppedReason = signal
    ? duplicate
      ? 'anti_duplicate_blocked_signal'
      : cooldownActive
        ? 'cooldown_blocked_signal'
        : null
    : diagnostic.rejectedReason || 'signal_not_generated';

  return {
    ...diagnostic,
    expectedSignalType,
    sentSignalKey,
    cooldownStateKey,
    duplicate,
    cooldownActive,
    lastSentCloseTimeMs: lastState ? lastState.closeTimeMs : null,
    droppedReason,
    wouldSend: Boolean(signal) && !duplicate && !cooldownActive,
  };
}

function logSignalDiagnostic(kind, diagnostic) {
  console.log(
    `[${kind}-debug] ${diagnostic.symbol} ${diagnostic.timeframe} ${new Date(diagnostic.closeTimeMs).toISOString()}`
  );
  console.log(JSON.stringify(diagnostic, null, 2));
}

function formatPivotPrice(value) {
  const absoluteValue = Math.abs(Number(value));

  if (absoluteValue >= 1) {
    return Number(value).toFixed(2);
  }

  if (absoluteValue >= 0.01) {
    return Number(value).toFixed(4);
  }

  return Number(value).toFixed(6);
}

function formatSignedValue(value, digits, suffix = '') {
  const numericValue = Number(value);
  const sign = numericValue >= 0 ? '+' : '';
  return `${sign}${numericValue.toFixed(digits)}${suffix}`;
}

function formatCandleDisplayTime(timestampMs) {
  return formatTimestampInTimeZone(timestampMs, env.telegramTimeZone);
}

function formatRsiSignal(signal) {
  return [
    `${signal.emoji} RSI SIGNAL`,
    `Пара: ${signal.symbol}`,
    `Таймфрейм: ${signal.timeframe}`,
    `RSI: ${signal.rsi.toFixed(1)}`,
    `Цена закрытия: ${signal.close.toFixed(6)}`,
  ].join('\n');
}

function formatVolumeSignal(signal) {
  const title =
    signal.level === 'STRONG'
      ? `${signal.emoji} STRONG ${signal.direction}`
      : `${signal.emoji} NORMAL ${signal.direction}`;

  return [
    title,
    `Пара: ${signal.symbol}`,
    `Таймфрейм: ${signal.timeframe}`,
    `Направление: ${signal.direction}`,
    `Объём x: ${signal.volumeRatio.toFixed(2)}`,
    `Изменение цены: ${signal.priceChangePercent.toFixed(2)}%`,
  ].join('\n');
}

function formatDivergenceSignal(signal) {
  const pricePointsLine = `${formatPivotPrice(signal.point1Price)} → ${formatPivotPrice(signal.point2Price)} (${formatSignedValue(signal.priceMovePct, 2, '%')})`;
  const rsiPointsLine = `${signal.point1Rsi.toFixed(1)} → ${signal.point2Rsi.toFixed(1)} (${formatSignedValue(signal.rsiMove, 1)})`;
  const point1DisplayTimeMs = signal.point1CloseTimeMs ?? signal.point1TimeMs;
  const point2DisplayTimeMs = signal.point2CloseTimeMs ?? signal.point2TimeMs;
  const divergenceLabel =
    signal.divergenceKind === 'REGULAR'
      ? signal.direction === 'BULLISH'
        ? 'Бычья дивергенция по RSI'
        : 'Медвежья дивергенция по RSI'
      : signal.direction === 'BULLISH'
        ? 'Скрытая бычья дивергенция по RSI'
        : 'Скрытая медвежья дивергенция по RSI';

  return [
    `🔀 ${signal.symbol} | ${signal.timeframe}`,
    divergenceLabel,
    '',
    `Strength: ${signal.strength}`,
    '',
    `${signal.pricePivotLabel}:`,
    pricePointsLine,
    '',
    `${signal.rsiPivotLabel}:`,
    rsiPointsLine,
    '',
    `Times (${buildTelegramCandleTimeLabel(env.telegramTimeZone)}):`,
    `Pivot 1: ${formatCandleDisplayTime(point1DisplayTimeMs)}`,
    `Pivot 2: ${formatCandleDisplayTime(point2DisplayTimeMs)}`,
    '',
    'Conditions:',
    signal.priceCondition,
    signal.rsiCondition,
  ].join('\n');
}

function formatSignal(signal) {
  if (/_DIVERGENCE_(BULLISH|BEARISH)$/.test(signal.type)) {
    return formatDivergenceSignal(signal);
  }

  if (signal.type === 'RSI') {
    return formatRsiSignal(signal);
  }

  return formatVolumeSignal(signal);
}

function getTelegramChatIds() {
  if (env.telegramChatIds) {
    return String(env.telegramChatIds)
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
  }

  const fallback = [env.telegramChatId];

  return [...new Set(
    fallback
      .filter(Boolean)
      .map((id) => String(id).trim())
  )];
}

function getLiquidityTelegramConfig() {
  const fallbackChatIds = getTelegramChatIds();
  const chatIds = env.liquidityTelegramChatIds
    ? String(env.liquidityTelegramChatIds)
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
    : env.liquidityTelegramChatId
      ? [String(env.liquidityTelegramChatId).trim()]
      : fallbackChatIds;

  return {
    botToken: env.liquidityTelegramBotToken || env.telegramBotToken,
    chatIds,
  };
}

function isLiquidityEnabledForCurrentBot() {
  return env.scanLimit === 50 && env.liquiditySignalEnabled;
}

async function notifyMessage(message) {
  const chatIds = getTelegramChatIds();

  console.log(message);

  for (const chatId of chatIds) {
    try {
      await sendTelegramMessage(chatId, message);
    } catch (error) {
      console.error(`[telegram] send failed (${chatId}): ${error.message}`);
    }
  }
}

async function notifyLiquidityMessage(message) {
  const liquidityTelegramConfig = getLiquidityTelegramConfig();

  console.log(message);

  for (const chatId of liquidityTelegramConfig.chatIds) {
    try {
      await sendTelegramMessage(chatId, message, {
        botToken: liquidityTelegramConfig.botToken,
      });
    } catch (error) {
      console.error(`[telegram] liquidity send failed (${chatId}): ${error.message}`);
    }
  }
}

async function notifySignal(signal) {
  await notifyMessage(formatSignal(signal));
}

async function processSignalEvaluation(evaluation, options = {}) {
  const { signal, diagnostic } = evaluation;
  const processedDiagnostic = buildProcessedDiagnostic(signal, diagnostic);

  if (shouldLogSignalDebug(diagnostic.symbol, diagnostic.timeframe, diagnostic.closeTimeMs)) {
    logSignalDiagnostic(diagnostic.kind, processedDiagnostic);
  }

  if (options.debugOnly || !signal || processedDiagnostic.duplicate || processedDiagnostic.cooldownActive) {
    return processedDiagnostic;
  }

  await notifySignal(signal);
  markSignalSent(signal);

  return processedDiagnostic;
}

async function processSignalEvaluations(evaluations) {
  for (const evaluation of evaluations) {
    await processSignalEvaluation(evaluation);
  }
}

async function maybeRunTargetedSignalDebug(symbol, timeframe, candles, evaluateAtIndex) {
  if (!isDebugTimeframeMatch(symbol, timeframe) || !env.debugSignalCloseTime) {
    return;
  }

  const debugCloseTimeMs = parseDebugCloseTime(env.debugSignalCloseTime);

  if (!Number.isFinite(debugCloseTimeMs)) {
    return;
  }

  const signalIndex = candles.findIndex((candle) => candle.closeTime === debugCloseTimeMs);

  if (signalIndex === -1) {
    return;
  }

  const evaluation = evaluateAtIndex(symbol, timeframe, candles, signalIndex);
  await processSignalEvaluation(evaluation, { debugOnly: true });
}

async function processSymbol(symbol) {
  if (!(await isSymbolTrading(symbol))) {
    return;
  }

  const volumeCandlesPromise = getClosedKlines(symbol, env.volumeSignalTimeframe, 100);
  const [mainCandles, rsiCandles] =
    env.rsiSignalTimeframe === env.volumeSignalTimeframe
      ? await Promise.all([volumeCandlesPromise, volumeCandlesPromise])
      : await Promise.all([
          volumeCandlesPromise,
          getClosedKlines(symbol, env.rsiSignalTimeframe, 100),
        ]);

  const volumeSignalEvaluations = getVolumeSignalEvaluations(symbol, mainCandles);
  const rsiSignalEvaluations = getRsiSignalEvaluations(symbol, rsiCandles);

  await processSignalEvaluations(volumeSignalEvaluations);
  await processSignalEvaluations(rsiSignalEvaluations);

  await maybeRunTargetedSignalDebug(
    symbol,
    env.volumeSignalTimeframe,
    mainCandles,
    evaluateVolumeSignalAtIndex
  );
  await maybeRunTargetedSignalDebug(
    symbol,
    env.rsiSignalTimeframe,
    rsiCandles,
    evaluateRsiSignalAtIndex
  );

  if (!isLiquidityEnabledForCurrentBot()) {
    return;
  }

  try {
    const liquidityResult = await getLiquiditySignal(symbol, env);

    if (liquidityResult.error) {
      console.error(`[liquidity] ${symbol}: ${liquidityResult.error.message}`);
      return;
    }

    if (!liquidityResult.shouldSend || !liquidityResult.message) {
      return;
    }

    await notifyLiquidityMessage(liquidityResult.message);

    if (env.liquidityTrackingEnabled && liquidityResult.context) {
      registerTrackedLiquiditySignal(liquidityResult.context, env);
    }
  } catch (error) {
    console.error(`[liquidity] ${symbol}: ${error.message}`);
  }
}

async function processDivergenceSymbol(symbol, timeframe, getSignal) {
  if (!(await isSymbolTrading(symbol))) {
    return;
  }

  const candles = await getClosedKlines(symbol, timeframe, 120);
  const divergenceSignal = getSignal(symbol, candles, env);

  if (divergenceSignal) {
    await processSignalEvaluation({
      signal: divergenceSignal,
      diagnostic: {
        kind: 'divergence',
        symbol,
        timeframe,
        closeTimeMs: divergenceSignal.closeTimeMs,
      },
    });
  }
}

async function processH1DivergenceSymbol(symbol) {
  await processDivergenceSymbol(symbol, env.h1DivergenceTimeframe, getH1DivergenceSignal);
}

async function processM15DivergenceSymbol(symbol) {
  await processDivergenceSymbol(symbol, env.m15DivergenceTimeframe, getM15DivergenceSignal);
}

async function processSymbolsInBatches(symbols, batchSize) {
  for (let index = 0; index < symbols.length; index += batchSize) {
    const batch = symbols.slice(index, index + batchSize);

    await Promise.all(
      batch.map(async (symbol) => {
        try {
          await processSymbol(symbol);
        } catch (error) {
          console.error(`[error] ${symbol}: ${error.message}`);
        }
      })
    );
  }
}

async function processWithBatches(symbols, batchSize, handler) {
  for (let index = 0; index < symbols.length; index += batchSize) {
    const batch = symbols.slice(index, index + batchSize);

    await Promise.all(
      batch.map(async (symbol) => {
        try {
          await handler(symbol);
        } catch (error) {
          console.error(`[error] ${symbol}: ${error.message}`);
        }
      })
    );
  }
}

async function runScan() {
  console.log(`[env] file=${path.resolve(process.cwd(), process.env.ENV_FILE || '.env')}`);
  console.log(
    `[scan] volume=${env.volumeSignalTimeframe}, rsi=${env.rsiSignalTimeframe}, liquidity=${env.liquiditySignalTimeframe}, h1=${env.h1DivergenceTimeframe}, m15=${env.m15DivergenceTimeframe}, top=${env.scanLimit}, batch=${env.scanBatchSize}, cooldown=${env.cooldownMinutes}m recentFast=${env.fastSignalRecentCandles} recentRsi=${env.rsiSignalRecentCandles}`
  );

  const symbols = await getTopUsdtSymbolsByVolume(env.scanLimit);

  if (env.scanLimit === 10 && !top10Logged) {
    console.log('[TOP10 LIST]');
    console.log(symbols.join(', '));
    console.log('--------------------');
    top10Logged = true;
  }

  await processSymbolsInBatches(symbols, env.scanBatchSize);

  if (!isLiquidityEnabledForCurrentBot() || !env.liquidityTrackingEnabled) {
    return;
  }

  try {
    const resolvedLiquidityEvents = await checkTrackedLiquiditySignals(env);

    for (const event of resolvedLiquidityEvents) {
      await notifyLiquidityMessage(event.message);
    }

    if (env.liquidityTrackLogDetails) {
      const stats = getLiquidityTrackingStats(env);
      console.log(
        `[liquidity-tracker] total=${stats.totalSignals} focusHit=${stats.focusHitCount} oppositeHit=${stats.oppositeHitCount} expired=${stats.expiredCount} focusAccuracyPct=${stats.focusAccuracyPct.toFixed(2)} averageResolveMinutes=${stats.averageResolveMinutes.toFixed(1)}`
      );
    }
  } catch (error) {
    console.error(`[liquidity-tracker] ${error.message}`);
  }
}

function getDivergenceScanConfigs() {
  return [
    {
      key: 'h1',
      enabled: env.h1DivergenceEnabled,
      timeframe: env.h1DivergenceTimeframe,
      closeDelayMs: env.h1DivergenceCloseDelayMs,
      logPrefix: 'h1-divergence',
      processSymbol: processH1DivergenceSymbol,
    },
    {
      key: 'm15',
      enabled: env.m15DivergenceEnabled,
      timeframe: env.m15DivergenceTimeframe,
      closeDelayMs: env.m15DivergenceCloseDelayMs,
      logPrefix: 'm15-divergence',
      processSymbol: processM15DivergenceSymbol,
    },
  ];
}

async function runDivergenceScan(divergenceConfig, trigger) {
  if (!divergenceConfig.enabled) {
    return;
  }

  console.log(`[${divergenceConfig.logPrefix}] trigger=${trigger}`);

  const symbols = await getTopUsdtSymbolsByVolume(env.scanLimit);

  await processWithBatches(symbols, env.scanBatchSize, divergenceConfig.processSymbol);
}

function getTimeframeDurationMs(timeframe) {
  const match = String(timeframe || '').match(/^(\d+)([mhd])$/i);

  if (!match) {
    throw new Error(`Unsupported timeframe: ${timeframe}`);
  }

  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  const unitMs =
    unit === 'm'
      ? 60 * 1000
      : unit === 'h'
        ? 60 * 60 * 1000
        : 24 * 60 * 60 * 1000;

  return value * unitMs;
}

function getDelayUntilNextTimeframeClose(timeframe, closeDelayMs) {
  const nowMs = Date.now();
  const timeframeDurationMs = getTimeframeDurationMs(timeframe);
  const nextCloseMs = (Math.floor(nowMs / timeframeDurationMs) + 1) * timeframeDurationMs;

  return Math.max(0, nextCloseMs - nowMs + closeDelayMs);
}

async function runScheduledDivergenceScan(divergenceConfig, trigger) {
  try {
    await runDivergenceScan(divergenceConfig, trigger);
  } catch (error) {
    console.error(`[${divergenceConfig.logPrefix}] scan failed: ${error.message}`);
  }
}

function scheduleNextDivergenceScan(divergenceConfig) {
  if (!divergenceConfig.enabled) {
    return;
  }

  const delayMs = getDelayUntilNextTimeframeClose(
    divergenceConfig.timeframe,
    divergenceConfig.closeDelayMs
  );
  const delaySeconds = Math.round(delayMs / 1000);

  console.log(`[${divergenceConfig.logPrefix}] next scheduled scan in ${delaySeconds}s`);

  const timer = setTimeout(async () => {
    await runScheduledDivergenceScan(divergenceConfig, 'timeframe_close');
    scheduleNextDivergenceScan(divergenceConfig);
  }, delayMs);

  divergenceTimers.set(divergenceConfig.key, timer);
}

async function startDivergenceSchedulers() {
  for (const divergenceConfig of getDivergenceScanConfigs()) {
    if (!divergenceConfig.enabled) {
      continue;
    }

    await runScheduledDivergenceScan(divergenceConfig, 'startup');
    scheduleNextDivergenceScan(divergenceConfig);
  }
}

async function debugSignalCandle(symbol, timeframe, closeTimeInput, kind = 'volume') {
  const candles = await getClosedKlines(symbol, timeframe, 100);
  const closeTimeMs = parseDebugCloseTime(closeTimeInput);
  const signalIndex = candles.findIndex((candle) => candle.closeTime === closeTimeMs);

  if (signalIndex === -1) {
    return {
      kind,
      symbol,
      timeframe,
      closeTimeMs,
      found: false,
      fetchedCandlesCount: candles.length,
      fetchedCandles: mapDebugCandles(candles),
      droppedReason: 'target_candle_not_found_in_recent_closed_klines',
    };
  }

  const evaluation =
    kind === 'rsi'
      ? evaluateRsiSignalAtIndex(symbol, timeframe, candles, signalIndex)
      : evaluateVolumeSignalAtIndex(symbol, timeframe, candles, signalIndex);

  return {
    ...buildProcessedDiagnostic(evaluation.signal, evaluation.diagnostic),
    fetchedCandles: mapDebugCandles(candles),
  };
}

async function start() {
  validateEnv();
  startHealthServer();
  healthServerState.botStarted = true;

  const liquidityTelegramConfig = getLiquidityTelegramConfig();

  console.log('[bot] Binance signal bot started');
  console.log(`[telegram] bot token configured: ${env.telegramBotToken ? 'yes' : 'no'}`);
  console.log(`[telegram] chat id: ${env.telegramChatId || 'not set'}`);
  console.log(`[telegram] chat ids: ${getTelegramChatIds().join(', ')}`);
  console.log(`[liquidity-telegram] bot token configured: ${env.liquidityTelegramBotToken ? 'yes' : 'no'}`);
  console.log(`[liquidity-telegram] chat ids: ${liquidityTelegramConfig.chatIds.join(', ')}`);
  console.log('[liquidity-telegram] mode: liquidity-only notifications');

  setInterval(() => {
    cleanupExpiredDivergenceSignals();
  }, env.divergenceDedupCleanupMinutes * 60 * 1000);

  await startDivergenceSchedulers();

  try {
    await runScan();
  } catch (error) {
    console.error(`[error] initial scan failed: ${error.message}`);
  }

  setInterval(async () => {
    try {
      await runScan();
    } catch (error) {
      console.error(`[error] scan failed: ${error.message}`);
    }
  }, env.scanIntervalMs);
}

module.exports = {
  start,
  calculateRsi,
  evaluateVolumeSignalAtIndex,
  evaluateRsiSignalAtIndex,
  debugSignalCandle,
  getVolumeSignalEvaluations,
  getRsiSignalEvaluations,
  buildProcessedDiagnostic,
  getDivergenceSignalKey,
  isDuplicateSignal,
  markSignalSent,
  cleanupExpiredDivergenceSignals,
};

if (require.main === module) {
  start().catch((error) => {
    console.error(`[fatal] ${error.message}`);
    process.exit(1);
  });
}
