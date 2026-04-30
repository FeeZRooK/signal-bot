const axios = require('axios');

const BASE_URL = 'https://fapi.binance.com';
const EXCHANGE_INFO_TTL_MS = 5 * 60 * 1000;
const exchangeInfoCache = {
  symbols: null,
  fetchedAt: 0,
};

async function getExchangeInfo() {
  const now = Date.now();

  if (
    exchangeInfoCache.symbols &&
    now - exchangeInfoCache.fetchedAt < EXCHANGE_INFO_TTL_MS
  ) {
    return exchangeInfoCache.symbols;
  }

  const response = await axios.get(`${BASE_URL}/fapi/v1/exchangeInfo`, {
    timeout: 15000,
  });

  exchangeInfoCache.symbols = response.data.symbols;
  exchangeInfoCache.fetchedAt = now;

  return exchangeInfoCache.symbols;
}

async function getTickers24h() {
  const response = await axios.get(`${BASE_URL}/fapi/v1/ticker/24hr`, {
    timeout: 15000,
  });

  return response.data;
}

async function getTopUsdtSymbolsByVolume(limit = 10) {
  const [symbols, tickers] = await Promise.all([getExchangeInfo(), getTickers24h()]);

  const activeUsdtPairs = new Set(
    symbols
      .filter((item) => item.quoteAsset === 'USDT' && item.status === 'TRADING')
      .filter((item) => item.contractType === 'PERPETUAL')
      .map((item) => item.symbol)
  );

  return tickers
    .filter((item) => activeUsdtPairs.has(item.symbol))
    .sort((a, b) => Number(b.quoteVolume) - Number(a.quoteVolume))
    .slice(0, limit)
    .map((item) => item.symbol);
}

async function isSymbolTrading(symbol) {
  const symbols = await getExchangeInfo();
  const symbolInfo = symbols.find((item) => item.symbol === symbol);

  if (!symbolInfo) {
    return false;
  }

  return symbolInfo.status === 'TRADING';
}

async function getKlines(symbol, interval, limit = 100) {
  if (!interval) {
    throw new Error('getKlines interval is required');
  }

  const response = await axios.get(`${BASE_URL}/fapi/v1/klines`, {
    params: { symbol, interval, limit },
    timeout: 15000,
  });

  return response.data.map((item) => ({
    openTime: Number(item[0]),
    open: Number(item[1]),
    high: Number(item[2]),
    low: Number(item[3]),
    close: Number(item[4]),
    volume: Number(item[5]),
    closeTime: Number(item[6]),
  }));
}

async function getClosedKlines(symbol, interval, limit = 12) {
  if (!interval) {
    throw new Error('getClosedKlines interval is required');
  }

  const candles = await getKlines(symbol, interval, limit);
  const now = Date.now();

  return candles
    .map((item) => ({
      ...item,
      isClosed: item.closeTime < now && Number(item.close) > 0,
    }))
    .filter((item) => item.isClosed);
}

async function getOpenInterest(symbol) {
  const response = await axios.get(`${BASE_URL}/fapi/v1/openInterest`, {
    params: { symbol },
    timeout: 15000,
  });

  return Number(response.data.openInterest);
}

async function getPremiumIndex(symbol) {
  const response = await axios.get(`${BASE_URL}/fapi/v1/premiumIndex`, {
    params: { symbol },
    timeout: 15000,
  });

  return response.data;
}

async function getFundingRate(symbol) {
  const premiumIndex = await getPremiumIndex(symbol);
  return Number(premiumIndex.lastFundingRate);
}

async function getMarkPrice(symbol) {
  const premiumIndex = await getPremiumIndex(symbol);
  return Number(premiumIndex.markPrice);
}

module.exports = {
  getTopUsdtSymbolsByVolume,
  getKlines,
  getClosedKlines,
  isSymbolTrading,
  getOpenInterest,
  getFundingRate,
  getMarkPrice,
};
