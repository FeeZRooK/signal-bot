const axios = require('axios');

const BASE_URL = 'https://fapi.binance.com';

async function getFuturesKlines(symbol, interval = '5m', limit = 100) {
  const res = await axios.get(`${BASE_URL}/fapi/v1/klines`, {
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

async function getTopUsdtPerpetualSymbolsByVolume(limit = 50) {
  const [exchangeInfoRes, ticker24hRes] = await Promise.all([
    axios.get(`${BASE_URL}/fapi/v1/exchangeInfo`, { timeout: 15000 }),
    axios.get(`${BASE_URL}/fapi/v1/ticker/24hr`, { timeout: 15000 }),
  ]);

  const activeUsdtPerpetualSet = new Set(
    exchangeInfoRes.data.symbols
      .filter((s) => {
        return (
          s.contractType === 'PERPETUAL' &&
          s.quoteAsset === 'USDT' &&
          s.status === 'TRADING'
        );
      })
      .map((s) => s.symbol)
  );

  const sorted = ticker24hRes.data
    .filter((t) => activeUsdtPerpetualSet.has(t.symbol))
    .map((t) => ({
      symbol: t.symbol,
      quoteVolume: Number(t.quoteVolume),
    }))
    .sort((a, b) => b.quoteVolume - a.quoteVolume)
    .slice(0, limit);

  return sorted;
}

module.exports = {
  getFuturesKlines,
  getTopUsdtPerpetualSymbolsByVolume,
};