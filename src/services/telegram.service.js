const TelegramBot = require('node-telegram-bot-api');
const { env } = require('../config/env');

const botCache = new Map();
let configWarningShown = false;
let initErrorWarningShown = false;

function getBot(botToken = env.telegramBotToken) {
  if (!botCache.has(botToken)) {
    botCache.set(botToken, new TelegramBot(botToken, { polling: false }));
  }

  return botCache.get(botToken);
}

async function sendTelegramMessage(chatId, text, options = {}) {
  const botToken = options.botToken || env.telegramBotToken;

  if (!botToken || !chatId) {
    if (!configWarningShown) {
      console.warn(
        '[telegram] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not set. Telegram notifications are disabled.'
      );
      configWarningShown = true;
    }

    return false;
  }

  try {
    return await getBot(botToken).sendMessage(chatId, text);
  } catch (error) {
    if (!initErrorWarningShown) {
      console.warn(`[telegram] failed to initialize or send message: ${error.message}`);
      initErrorWarningShown = true;
    }

    throw error;
  }
}

module.exports = {
  sendTelegramMessage,
};
