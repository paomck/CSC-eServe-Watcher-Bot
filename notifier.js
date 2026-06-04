'use strict';

/**
 * notifier.js
 * Sends push notifications to a Telegram chat via the Bot API.
 * Uses the built-in `fetch` (Node 18+) — no extra HTTP library needed.
 */

const logger = require('./logger');

const TELEGRAM_API = 'https://api.telegram.org';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 3000;

/**
 * Sleep helper.
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Send a Telegram message with retry logic.
 *
 * @param {string} token   - Telegram Bot token from process.env
 * @param {string} chatId  - Telegram Chat ID from process.env
 * @param {string} message - Message text (supports Markdown)
 * @returns {Promise<boolean>} true if sent successfully
 */
async function sendTelegramMessage(token, chatId, message) {
  if (!token || !chatId) {
    logger.warn('Telegram credentials not configured — skipping notification.');
    return false;
  }

  const url = `${TELEGRAM_API}/bot${token}/sendMessage`;
  const body = JSON.stringify({
    chat_id: chatId,
    text: message,
    parse_mode: 'Markdown',
    disable_web_page_preview: false,
  });

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });

      const data = await response.json();

      if (data.ok) {
        logger.ok(`Telegram notification sent (attempt ${attempt}).`);
        return true;
      } else {
        logger.warn(`Telegram API error (attempt ${attempt}):`, data.description);
      }
    } catch (err) {
      logger.error(`Telegram fetch failed (attempt ${attempt}):`, err.message);
    }

    if (attempt < MAX_RETRIES) {
      logger.info(`Retrying in ${RETRY_DELAY_MS / 1000}s…`);
      await sleep(RETRY_DELAY_MS);
    }
  }

  logger.error('All Telegram notification attempts failed.');
  return false;
}

/**
 * Build and send the slot-availability alert message.
 *
 * @param {object} opts
 * @param {string} opts.token
 * @param {string} opts.chatId
 * @param {string} opts.region
 * @param {string} opts.location
 * @param {string} opts.service
 * @param {string[]} opts.availableDates  - Human-readable date strings found
 * @param {string} opts.portalUrl
 */
async function notifySlotFound({ token, chatId, region, location, service, availableDates, portalUrl }) {
  const dateList = availableDates.length
    ? availableDates.map((d) => `  • ${d}`).join('\n')
    : '  • (dates detected — check portal)';

  const message =
    `🎉 *CSC eServe Slot Available!*\n\n` +
    `📍 *Region:* ${region}\n` +
    `🏢 *Location:* ${location}\n` +
    `📝 *Service:* ${service}\n\n` +
    `📅 *Available Dates:*\n${dateList}\n\n` +
    `👉 [Book your slot now](${portalUrl})`;

  return sendTelegramMessage(token, chatId, message);
}

module.exports = { sendTelegramMessage, notifySlotFound };
