const DEFAULT_TELEGRAM_TIMEZONE = 'Europe/Kyiv';

const formatterCache = new Map();

function resolveTelegramTimeZone(timeZone) {
  const candidate = String(timeZone || '').trim();
  return candidate || DEFAULT_TELEGRAM_TIMEZONE;
}

function isValidTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch (error) {
    return false;
  }
}

function getTimeFormatter(timeZone) {
  const resolvedTimeZone = resolveTelegramTimeZone(timeZone);

  if (!formatterCache.has(resolvedTimeZone)) {
    formatterCache.set(
      resolvedTimeZone,
      new Intl.DateTimeFormat('en-CA', {
        timeZone: resolvedTimeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    );
  }

  return formatterCache.get(resolvedTimeZone);
}

function formatTimestampInTimeZone(timestampMs, timeZone) {
  const numericTimestamp = Number(timestampMs);

  if (!Number.isFinite(numericTimestamp)) {
    return 'Invalid time';
  }

  const parts = getTimeFormatter(timeZone).formatToParts(new Date(numericTimestamp));
  const mappedParts = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${mappedParts.year}-${mappedParts.month}-${mappedParts.day} ${mappedParts.hour}:${mappedParts.minute}`;
}

function buildTelegramCandleTimeLabel(timeZone) {
  return `${resolveTelegramTimeZone(timeZone)}, candle open`;
}

module.exports = {
  DEFAULT_TELEGRAM_TIMEZONE,
  buildTelegramCandleTimeLabel,
  formatTimestampInTimeZone,
  isValidTimeZone,
  resolveTelegramTimeZone,
};
