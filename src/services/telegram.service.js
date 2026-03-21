const TelegramBot = require('node-telegram-bot-api');

const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: false });

async function sendTelegramMessage(chatId, text) {
  return bot.sendMessage(chatId, text);
}

module.exports = { sendTelegramMessage };