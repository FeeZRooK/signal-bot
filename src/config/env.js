import dotenv from "dotenv";

dotenv.config();

export const env = {
  port: Number(process.env.PORT || 3000),
  mongoUri: process.env.MONGODB_URI || "",
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || "",
  telegramChatId: process.env.TELEGRAM_CHAT_ID || "",
  binanceWsUrl: process.env.BINANCE_WS_URL || "",
  bybitWsUrl: process.env.BYBIT_WS_URL || ""
};

const requiredVars = [
  "MONGODB_URI",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_ID",
  "BINANCE_WS_URL",
  "BYBIT_WS_URL"
];

export function validateEnv() {
  const missing = requiredVars.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing environment variables: ${missing.join(", ")}`);
  }
}