require('dotenv').config();

const connectDB = require('./config/db');
const Candle = require('./models/Candle');
const {
  getFuturesKlines,
  getTopUsdtPerpetualSymbolsByVolume,
} = require('./services/binance.service');
const { sendTelegramMessage } = require('./services/telegram.service');

const lastSignalTime = {};

function getSignalKey(symbol, type) {
  return `${symbol}_${type}`;
}

function canSendSignal(symbol, type, cooldownMinutes = 30) {
  const key = getSignalKey(symbol, type);
  const now = Date.now();
  const lastTime = lastSignalTime[key];

  if (!lastTime) return true;

  const diffMinutes = (now - lastTime) / 1000 / 60;
  return diffMinutes >= cooldownMinutes;
}

function markSignalSent(symbol, type) {
  lastSignalTime[getSignalKey(symbol, type)] = Date.now();
}

function calculateRSI(closes, period = 14) {
  if (!closes || closes.length < period + 1) return null;

  const gains = [];
  const losses = [];

  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? Math.abs(diff) : 0);
  }

  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 0; i < period; i++) {
    avgGain += gains[i];
    avgLoss += losses[i];
  }

  avgGain /= period;
  avgLoss /= period;

  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
  }

  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function detectVolumeSignal(candles) {
  if (candles.length < 21) return null;

  const last = candles[candles.length - 1];
  const prevCandles = candles.slice(-21, -1);

  const avgVolume =
    prevCandles.reduce((sum, c) => sum + c.volume, 0) / prevCandles.length;

  const ratio = last.volume / avgVolume;
  const priceChange = ((last.close - last.open) / last.open) * 100;
  const absPriceChange = Math.abs(priceChange);

  // 🔥 STRONG
  if (ratio >= 2.0 && absPriceChange >= 0.4) {
    return {
      type: 'VOLUME_STRONG',
      level: 'STRONG',
      direction: priceChange > 0 ? 'LONG' : 'SHORT',
      volumeRatio: ratio.toFixed(2),
      priceChange: priceChange.toFixed(2),
    };
  }

  // 🟡 NORMAL
  if (ratio >= 1.4 && absPriceChange >= 0.25) {
    return {
      type: 'VOLUME_NORMAL',
      level: 'NORMAL',
      direction: priceChange > 0 ? 'LONG' : 'SHORT',
      volumeRatio: ratio.toFixed(2),
      priceChange: priceChange.toFixed(2),
    };
  }

  return null;
}

function detectRSISignal(candles) {
  if (candles.length < 20) return null;

  const closes = candles.map((c) => c.close);
  const rsi = calculateRSI(closes, 14);

  if (rsi === null) return null;

  if (rsi <= 20) {
    return {
      type: 'RSI',
      direction: 'LONG',
      state: 'OVERSOLD',
      rsi: rsi.toFixed(2),
    };
  }

  if (rsi >= 80) {
    return {
      type: 'RSI',
      direction: 'SHORT',
      state: 'OVERBOUGHT',
      rsi: rsi.toFixed(2),
    };
  }

  return null;
}

async function saveCandles(symbol, interval, candles) {
  for (const candle of candles) {
    try {
      await Candle.updateOne(
        { symbol, interval, openTime: candle.openTime },
        { $setOnInsert: { symbol, interval, ...candle } },
        { upsert: true }
      );
    } catch (e) {
      if (e.code !== 11000) {
        console.error(`Ошибка сохранения ${symbol}:`, e.message);
      }
    }
  }
}

async function processSymbol(symbol, interval) {
  console.log(`Проверяем ${symbol}...`);

  try {
    const candles = await getFuturesKlines(symbol, interval, 100);
    await saveCandles(symbol, interval, candles);

    const volumeSignal = detectVolumeSignal(candles);
    const rsiSignal = detectRSISignal(candles);

    if (volumeSignal) {
      if (canSendSignal(symbol, volumeSignal.type, 30)) {
        const icon = volumeSignal.level === 'STRONG' ? '🔥' : '🚨';

        const message =
          `${icon} ${volumeSignal.level} VOLUME SIGNAL\n` +
          `Пара: ${symbol}\n` +
          `Таймфрейм: ${interval}\n` +
          `Направление: ${volumeSignal.direction}\n` +
          `Объём x: ${volumeSignal.volumeRatio}\n` +
          `Изменение цены: ${volumeSignal.priceChange}%`;

        await sendTelegramMessage(process.env.TELEGRAM_CHAT_ID, message);
        markSignalSent(symbol, volumeSignal.type);

        console.log(`Отправлен ${volumeSignal.level} сигнал по ${symbol}`);
      } else {
        console.log(`⛔ ${symbol} — кулдаун`);
      }
    } else {
      console.log(`Нет VOLUME сигнала по ${symbol}`);
    }

    if (rsiSignal) {
      if (canSendSignal(symbol, rsiSignal.type, 30)) {
        const message =
          `📉 RSI SIGNAL\n` +
          `Пара: ${symbol}\n` +
          `Таймфрейм: ${interval}\n` +
          `Состояние: ${rsiSignal.state}\n` +
          `Направление: ${rsiSignal.direction}\n` +
          `RSI(14): ${rsiSignal.rsi}`;

        await sendTelegramMessage(process.env.TELEGRAM_CHAT_ID, message);
        markSignalSent(symbol, rsiSignal.type);

        console.log(`Отправлен RSI сигнал по ${symbol}`);
      } else {
        console.log(`⛔ RSI ${symbol} — кулдаун`);
      }
    } else {
      console.log(`Нет RSI сигнала по ${symbol}`);
    }
  } catch (err) {
    console.error(`Ошибка по ${symbol}:`, err.message);
  }
}

async function processSymbolsInParallel(symbols, interval, batchSize = 8) {
  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);

    console.log(`\nПакет ${Math.floor(i / batchSize) + 1}: ${batch.join(', ')}\n`);

    await Promise.all(batch.map((symbol) => processSymbol(symbol, interval)));
  }
}

async function runScan() {
  const interval = '5m';

  console.log('Загружаем топ-50 по объёму...');
  const topSymbolsData = await getTopUsdtPerpetualSymbolsByVolume(50);

  const symbols = topSymbolsData.map((item) => item.symbol);

  console.log('Топ-50:', symbols.join(', '));

  await processSymbolsInParallel(symbols, interval, 8);
}

async function startBot() {
  await connectDB();

  while (true) {
    console.log('\n--- Новый цикл ---\n');

    try {
      await runScan();
    } catch (err) {
      console.error('Ошибка:', err.message);
    }

    console.log('\nЖдём 60 секунд...\n');
    await new Promise((resolve) => setTimeout(resolve, 60000));
  }
}

startBot();