const mongoose = require('mongoose');

const candleSchema = new mongoose.Schema(
  {
    symbol: { type: String, required: true },
    interval: { type: String, required: true },
    openTime: { type: Number, required: true },
    closeTime: { type: Number, required: true },
    open: Number,
    high: Number,
    low: Number,
    close: Number,
    volume: Number,
    quoteVolume: Number,
    trades: Number,
    takerBaseVolume: Number,
    takerQuoteVolume: Number,
  },
  { timestamps: true }
);

candleSchema.index({ symbol: 1, interval: 1, openTime: 1 }, { unique: true });

module.exports = mongoose.model('Candle', candleSchema);