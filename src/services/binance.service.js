const axios = require('axios');

// Переводим сервис на Spot API.
// Официальные публичные market-data эндпоинты Spot:
// https://api.binance.com/api/v3/...
const BASE_URL = 'https://api.binance.com';

async function getSpotKlines(symbol, interval = '5m', limit = 100) {
  const res = await axios.get(`${BASE_URL}/api/v3/klines`, {
    params: { symbol, interval, limit },
    timeout: 15000,
  });

  return res.data.map((k) => ({
    openTime: Number(k[0]),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
    closeTime: Number(k[6]),
    quoteVolume: Number(k[7]),
    trades: Number(k[8]),
    takerBaseVolume: Number(k[9]),
    takerQuoteVolume: Number(k[10]),
  }));
}

// Оставляю старое имя функции, чтобы не ломать остальной код проекта.
// Но фактически теперь она возвращает spot klines, а не futures.
async function getFuturesKlines(symbol, interval = '5m', limit = 100) {
  return getSpotKlines(symbol, interval, limit);
}

// Раньше тут был отбор USDT perpetual futures.
// Теперь делаем ближайший безопасный вариант:
// берём топ USDT spot-пар по quoteVolume.
async function getTopUsdtPerpetualSymbolsByVolume(limit = 50) {
  const [exchangeInfoRes, ticker24hRes] = await Promise.all([
    axios.get(`${BASE_URL}/api/v3/exchangeInfo`, { timeout: 15000 }),
    axios.get(`${BASE_URL}/api/v3/ticker/24hr`, { timeout: 15000 }),
  ]);

  const activeUsdtSet = new Set(
    exchangeInfoRes.data.symbols
      .filter((s) => s.quoteAsset === 'USDT' && s.status === 'TRADING')
      .map((s) => s.symbol)
  );

  const sorted = ticker24hRes.data
    .filter((t) => activeUsdtSet.has(t.symbol))
    .map((t) => ({
      symbol: t.symbol,
      quoteVolume: Number(t.quoteVolume),
    }))
    .sort((a, b) => b.quoteVolume - a.quoteVolume)
    .slice(0, limit);

  return sorted.map((item) => item.symbol);
}

module.exports = {
  getFuturesKlines,
  getTopUsdtPerpetualSymbolsByVolume,
};