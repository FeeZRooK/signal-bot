const fs = require('fs');
const path = require('path');
const { getClosedKlines } = require('./binance.service');

let stateLoaded = false;
const activeSignals = new Map();

function ensureDirectoryForFile(filePath) {
  const absolutePath = path.resolve(process.cwd(), filePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  return absolutePath;
}

function readJsonFileSafe(filePath, fallbackValue) {
  try {
    const absolutePath = path.resolve(process.cwd(), filePath);

    if (!fs.existsSync(absolutePath)) {
      return fallbackValue;
    }

    return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
  } catch (error) {
    return fallbackValue;
  }
}

function writeJsonFileSafe(filePath, data) {
  const absolutePath = ensureDirectoryForFile(filePath);
  fs.writeFileSync(absolutePath, JSON.stringify(data, null, 2), 'utf8');
}

function loadActiveSignals(config) {
  if (stateLoaded) {
    return;
  }

  const persistedSignals = readJsonFileSafe(config.liquidityActiveSignalsFile, []);

  for (const signal of persistedSignals) {
    activeSignals.set(signal.id, signal);
  }

  stateLoaded = true;
}

function persistActiveSignals(config) {
  writeJsonFileSafe(config.liquidityActiveSignalsFile, Array.from(activeSignals.values()));
}

function buildTrackedSignalId(signalContext) {
  return [
    signalContext.symbol,
    signalContext.focus,
    signalContext.up?.exists ? signalContext.up.distancePct.toFixed(1) : 'U0',
    signalContext.down?.exists ? signalContext.down.distancePct.toFixed(1) : 'D0',
    Date.now(),
  ].join(':');
}

function getTimeframeMinutes(timeframe) {
  const match = String(timeframe || '').match(/^(\d+)([mhd])$/i);

  if (!match) {
    return 5;
  }

  const value = Number(match[1]);
  const unit = match[2].toLowerCase();

  if (unit === 'm') {
    return value;
  }

  if (unit === 'h') {
    return value * 60;
  }

  if (unit === 'd') {
    return value * 60 * 24;
  }

  return 5;
}

function getFocusTargetPct(signalContext) {
  if (signalContext.focus === 'Up' && signalContext.up?.exists) {
    return Number(signalContext.up.distancePct);
  }

  if (signalContext.focus === 'Down' && signalContext.down?.exists) {
    return Number(signalContext.down.distancePct);
  }

  return null;
}

function formatTargetPct(targetPct) {
  if (!Number.isFinite(targetPct)) {
    return null;
  }

  return `${targetPct >= 0 ? '+' : ''}${targetPct.toFixed(1)}%`;
}

function registerTrackedLiquiditySignal(signalContext, config) {
  if (!config.liquidityTrackingEnabled) {
    return null;
  }

  loadActiveSignals(config);

  // We persist the exact state of the liquidity idea at send time so later checks
  // can evaluate the same entry, targets, and focus without reconstructing them.
  const trackedSignal = {
    id: buildTrackedSignalId(signalContext),
    symbol: signalContext.symbol,
    sentAt: Date.now(),
    entryPrice: signalContext.currentPrice,
    upDistancePct: signalContext.up?.exists ? signalContext.up.distancePct : null,
    downDistancePct: signalContext.down?.exists ? signalContext.down.distancePct : null,
    upTargetPrice: signalContext.up?.exists ? signalContext.up.targetPrice : null,
    downTargetPrice: signalContext.down?.exists ? signalContext.down.targetPrice : null,
    focus: signalContext.focus,
    targetPct: getFocusTargetPct(signalContext),
    timeframeForTracking: config.liquidityTrackingTimeframe,
    status: 'active',
    minPriceAfterSignal: signalContext.currentPrice,
    maxPriceAfterSignal: signalContext.currentPrice,
    maxAdverseMovePct: 0,
  };

  activeSignals.set(trackedSignal.id, trackedSignal);
  persistActiveSignals(config);

  return trackedSignal;
}

function buildFollowUpMessage(event) {
  if (event.resultStatus === 'focus_hit') {
    const targetLabel = formatTargetPct(event.targetPct);

    return [
      `✅ ${event.symbol}`,
      '',
      targetLabel
        ? `Результат: Фокус отработал (${targetLabel})`
        : 'Результат: Фокус отработал',
      `Достигнуто: ${event.reached}`,
      `Время: ${event.timeToResolveMinutes}м`,
      `Макс. отклонение против движения: ${event.maxAdverseMovePct.toFixed(2)}%`,
    ].join('\n');
  }

  if (event.resultStatus === 'opposite_hit') {
    return [
      `⚠️ ${event.symbol}`,
      '',
      'Результат: Сработала противоположная сторона',
      `Достигнуто: ${event.reached}`,
      `Время: ${event.timeToResolveMinutes}м`,
      `Макс. отклонение против движения: ${event.maxAdverseMovePct.toFixed(2)}%`,
      `Фокус: ${event.focus}`,
    ].join('\n');
  }

  if (event.resultStatus === 'ambiguous_hit') {
    return [
      `⚪ ${event.symbol}`,
      '',
      'Результат: Обе цели задеты в одной свече',
      'Достигнуто: неоднозначно',
      `Время: ${event.timeToResolveMinutes}м`,
      `Макс. отклонение против движения: ${event.maxAdverseMovePct.toFixed(2)}%`,
      `Фокус: ${event.focus}`,
    ].join('\n');
  }

  return [
    `⏳ ${event.symbol}`,
    '',
    'Результат: Истекло время ожидания',
    'Достигнуто: нет',
    `Окно: ${Math.round(event.trackWindowMinutes / 60)}ч`,
    `Фокус: ${event.focus}`,
  ].join('\n');
}

function persistResolvedLiquidityStat(event, config) {
  const stats = readJsonFileSafe(config.liquidityStatsFile, []);
  stats.push(event);
  writeJsonFileSafe(config.liquidityStatsFile, stats);
}

function getLiquidityTrackingStats(config) {
  const stats = readJsonFileSafe(config.liquidityStatsFile, []);
  const totalSignals = stats.length;
  const focusHitCount = stats.filter((item) => item.resultStatus === 'focus_hit').length;
  const oppositeHitCount = stats.filter((item) => item.resultStatus === 'opposite_hit').length;
  const ambiguousHitCount = stats.filter((item) => item.resultStatus === 'ambiguous_hit').length;
  const expiredCount = stats.filter((item) => item.resultStatus === 'expired').length;
  const resolvedSignals = stats.filter((item) => Number.isFinite(item.timeToResolveMinutes));
  const averageResolveMinutes =
    resolvedSignals.length > 0
      ? resolvedSignals.reduce((sum, item) => sum + item.timeToResolveMinutes, 0) /
        resolvedSignals.length
      : 0;

  return {
    totalSignals,
    focusHitCount,
    oppositeHitCount,
    ambiguousHitCount,
    expiredCount,
    focusAccuracyPct: totalSignals > 0 ? (focusHitCount / totalSignals) * 100 : 0,
    averageResolveMinutes,
  };
}

function buildResolvedEvent(signal, resultStatus, reached, resolvedAt, trackWindowMinutes) {
  return {
    id: signal.id,
    symbol: signal.symbol,
    sentAt: signal.sentAt,
    resolvedAt,
    entryPrice: signal.entryPrice,
    upTargetPrice: signal.upTargetPrice,
    downTargetPrice: signal.downTargetPrice,
    focus: signal.focus,
    targetPct: signal.targetPct,
    resultStatus,
    reached,
    maxAdverseMovePct: signal.maxAdverseMovePct ?? 0,
    timeToResolveMinutes: Math.max(1, Math.round((resolvedAt - signal.sentAt) / 60000)),
    trackWindowMinutes,
  };
}

function updateAdverseMove(signal, candle) {
  // We track the worst move against the expected direction from the original entry
  // to quantify path risk, not just whether the target was eventually reached.
  if (signal.focus === 'Up') {
    const minPrice = Math.min(
      Number.isFinite(signal.minPriceAfterSignal) ? signal.minPriceAfterSignal : signal.entryPrice,
      Number(candle.low)
    );

    signal.minPriceAfterSignal = minPrice;
    signal.maxAdverseMovePct = ((signal.entryPrice - minPrice) / signal.entryPrice) * 100;
    return;
  }

  const maxPrice = Math.max(
    Number.isFinite(signal.maxPriceAfterSignal) ? signal.maxPriceAfterSignal : signal.entryPrice,
    Number(candle.high)
  );

  signal.maxPriceAfterSignal = maxPrice;
  signal.maxAdverseMovePct = ((maxPrice - signal.entryPrice) / signal.entryPrice) * 100;
}

async function resolveTrackedSignal(signal, config) {
  // We replay only closed candles after the signal time in chronological order.
  // This keeps the tracker honest: no unfinished candles and no pretending we know
  // the intra-candle order when both targets are touched in the same bar.
  const timeframeMinutes = getTimeframeMinutes(signal.timeframeForTracking);
  const candles = await getClosedKlines(
    signal.symbol,
    signal.timeframeForTracking,
    Math.max(2, Math.ceil(config.liquidityTrackWindowMinutes / timeframeMinutes) + 5)
  );

  const relevantCandles = candles
    .filter((candle) => candle.closeTime > signal.sentAt)
    .sort((a, b) => a.closeTime - b.closeTime);

  for (const candle of relevantCandles) {
    updateAdverseMove(signal, candle);

    const upHit =
      signal.upTargetPrice !== null && Number(candle.high) >= Number(signal.upTargetPrice);
    const downHit =
      signal.downTargetPrice !== null && Number(candle.low) <= Number(signal.downTargetPrice);

    if (!upHit && !downHit) {
      continue;
    }

    if (upHit && downHit) {
      return buildResolvedEvent(
        signal,
        'ambiguous_hit',
        'ambiguous',
        candle.closeTime,
        config.liquidityTrackWindowMinutes
      );
    }

    const reached = upHit ? 'Up' : 'Down';
    const resultStatus = reached === signal.focus ? 'focus_hit' : 'opposite_hit';

    return buildResolvedEvent(
      signal,
      resultStatus,
      reached,
      candle.closeTime,
      config.liquidityTrackWindowMinutes
    );
  }

  const expiresAt = signal.sentAt + config.liquidityTrackWindowMinutes * 60 * 1000;

  if (Date.now() >= expiresAt) {
    return {
      ...buildResolvedEvent(
        signal,
        'expired',
        'none',
        expiresAt,
        config.liquidityTrackWindowMinutes
      ),
      timeToResolveMinutes: config.liquidityTrackWindowMinutes,
    };
  }

  return null;
}

async function checkTrackedLiquiditySignals(config) {
  if (!config.liquidityTrackingEnabled) {
    return [];
  }

  loadActiveSignals(config);

  const resolvedEvents = [];

  for (const signal of Array.from(activeSignals.values())) {
    const resolvedEvent = await resolveTrackedSignal(signal, config);

    if (!resolvedEvent) {
      continue;
    }

    activeSignals.delete(signal.id);
    persistResolvedLiquidityStat(resolvedEvent, config);
    resolvedEvents.push({
      ...resolvedEvent,
      message: buildFollowUpMessage(resolvedEvent),
    });
  }

  persistActiveSignals(config);

  return resolvedEvents;
}

module.exports = {
  registerTrackedLiquiditySignal,
  checkTrackedLiquiditySignals,
  resolveTrackedSignal,
  persistResolvedLiquidityStat,
  getLiquidityTrackingStats,
};
