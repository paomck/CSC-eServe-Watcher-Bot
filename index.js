'use strict';

/**
 * index.js — CSC eServe Slot Watcher
 * ─────────────────────────────────────────────────────────────────────────────
 * Entry point. Loads config from .env, then runs the watcher in a continuous
 * loop, sleeping between cycles and sending a Telegram notification whenever
 * an available slot is detected.
 *
 * Usage:
 *   node index.js
 *
 * Environment variables (see .env):
 *   ESERVE_COOKIE       - Session cookie string copied from your browser
 *   TELEGRAM_BOT_TOKEN  - Telegram bot token from @BotFather
 *   TELEGRAM_CHAT_ID    - Your Telegram Chat ID
 *   POLL_INTERVAL_MS    - Poll frequency in ms (default: 600000 = 10 min)
 *   TARGET_REGION       - Region to select (default: NCR)
 *   TARGET_SERVICE      - Service type to select
 *                         All 24 NCR field offices are always monitored.
 */

require('dotenv').config();

const logger                                                    = require('./logger');
const { checkAllLocations, NCR_LOCATIONS, PORTAL_URL, SCHEDULE_URL } = require('./watcher');
const { notifySlotFound }                                       = require('./notifier');

// ─── Configuration ────────────────────────────────────────────────────────────

const CONFIG = {
  cookie:         process.env.ESERVE_COOKIE      ?? '',
  telegramToken:  process.env.TELEGRAM_BOT_TOKEN ?? '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID   ?? '',
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 600_000),
  region:         process.env.TARGET_REGION      ?? 'NCR',
  service:        process.env.TARGET_SERVICE     ?? 'Career Service - Professional',
  // All NCR_LOCATIONS are always checked — no single-location override here.
};

// ─── Startup banner ───────────────────────────────────────────────────────────

function printBanner() {
  const intervalMin = Math.round(CONFIG.pollIntervalMs / 60_000);
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║         CSC eServe Slot Watcher — Background Monitor       ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`  Portal URL  : ${SCHEDULE_URL}`);
  console.log(`  Region      : ${CONFIG.region}`);
  console.log(`  Locations   : All ${NCR_LOCATIONS.length} NCR field offices`);
  console.log(`  Service     : ${CONFIG.service}`);
  console.log(`  Poll every  : ${intervalMin} minute(s)`);
  console.log(`  Telegram    : ${CONFIG.telegramToken ? '✅ configured' : '⚠️  NOT configured'}`);
  console.log('');
  console.log('  Press Ctrl+C to stop the watcher at any time.');
  console.log('════════════════════════════════════════════════════════════\n');
}

// ─── Validation ───────────────────────────────────────────────────────────────

function validateConfig() {
  const errors = [];

  if (!CONFIG.cookie || CONFIG.cookie === 'YOUR_SESSION_COOKIE_HERE') {
    errors.push('ESERVE_COOKIE is not set. Edit your .env file and paste your session cookie.');
  }
  if (!CONFIG.telegramToken || CONFIG.telegramToken === 'YOUR_BOT_TOKEN_HERE') {
    logger.warn('TELEGRAM_BOT_TOKEN is not set — notifications will be logged to console only.');
  }
  if (!CONFIG.telegramChatId || CONFIG.telegramChatId === 'YOUR_CHAT_ID_HERE') {
    logger.warn('TELEGRAM_CHAT_ID is not set — notifications will be logged to console only.');
  }
  if (Number.isNaN(CONFIG.pollIntervalMs) || CONFIG.pollIntervalMs < 60_000) {
    logger.warn('POLL_INTERVAL_MS < 60 000 ms — enforcing minimum of 60 seconds to be polite.');
    CONFIG.pollIntervalMs = 60_000;
  }

  if (errors.length > 0) {
    errors.forEach((e) => logger.error(e));
    process.exit(1);
  }
}

// ─── Sleep ────────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Single check cycle ───────────────────────────────────────────────────────

let cycleCount = 0;

async function runCycle() {
  cycleCount += 1;
  logger.info(`─── Cycle #${cycleCount} started — checking ${NCR_LOCATIONS.length} location(s) ───`);

  const results = await checkAllLocations({
    cookie:  CONFIG.cookie,
    region:  CONFIG.region,
    service: CONFIG.service,
  });

  // ── Fatal error sentinel ─────────────────────────────────────────────────
  if (results.length === 1 && results[0].location === '__fatal__') {
    logger.warn(`Cycle #${cycleCount} aborted with fatal error: ${results[0].error}`);
    return;
  }

  // ── Summarise results ────────────────────────────────────────────────────
  const found    = results.filter((r) => r.found);
  const errored  = results.filter((r) => r.error && !r.found);
  const clean    = results.filter((r) => !r.found && !r.error);

  logger.info(
    `Cycle #${cycleCount} summary: ` +
    `${found.length} available | ${clean.length} no-slots | ${errored.length} errors`
  );

  if (found.length === 0) {
    logger.info(`Cycle #${cycleCount} complete — no available slots found across any location.`);
  } else {
    // ── Print console alert box ────────────────────────────────────────────
    console.log('\n');
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║   🎉 SLOT(S) AVAILABLE — BOOK NOW!                        ║');
    console.log(`║   Region  : ${CONFIG.region.padEnd(46)}║`);
    console.log(`║   Service : ${CONFIG.service.slice(0, 46).padEnd(46)}║`);
    console.log('╠═══════════════════════════════════════════════════════════╣');
    for (const r of found) {
      const locLine  = r.location.slice(0, 30).padEnd(30);
      const dateLine = r.dates.join(', ').slice(0, 16).padEnd(16);
      console.log(`║   📍 ${locLine}  Dates: ${dateLine}║`);
    }
    console.log(`║   URL     : ${SCHEDULE_URL.slice(0, 46).padEnd(46)}║`);
    console.log('╚═══════════════════════════════════════════════════════════╝');
    console.log('\n');

    // ── Fire one Telegram notification per available office ───────────────
    for (const r of found) {
      logger.ok(`🎉 AVAILABLE: ${r.location} — dates: ${r.dates.join(', ')}`);
      await notifySlotFound({
        token:          CONFIG.telegramToken,
        chatId:         CONFIG.telegramChatId,
        region:         CONFIG.region,
        location:       r.location,
        service:        CONFIG.service,
        availableDates: r.dates,
        portalUrl:      SCHEDULE_URL,
      });
    }
  }

  if (errored.length > 0) {
    logger.warn(`${errored.length} location(s) had errors this cycle:`);
    errored.forEach((r) => logger.warn(`  ⚠ ${r.location}: ${r.error}`));
  }

  logger.info(`─── Cycle #${cycleCount} finished ───\n`);
}

// ─── Worker loop ──────────────────────────────────────────────────────────────

// Single-run mode: run once and exit (used by GitHub Actions)
// Triggered by passing --single-run as a CLI argument.
const SINGLE_RUN = process.argv.includes('--single-run');

async function workerLoop() {
  printBanner();
  validateConfig();

  // Graceful shutdown
  process.on('SIGINT',  () => { logger.info('\nReceived SIGINT — shutting down gracefully…');  process.exit(0); });
  process.on('SIGTERM', () => { logger.info('\nReceived SIGTERM — shutting down gracefully…'); process.exit(0); });

  // Catch unhandled rejections so the loop stays alive
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection (loop will continue):', reason);
  });

  if (SINGLE_RUN) {
    // ── GitHub Actions mode: run once and exit ─────────────────────────────
    logger.info('Running in single-run mode (GitHub Actions)…');
    try {
      await runCycle();
    } catch (err) {
      logger.error('Single-run cycle failed:', err.message);
      process.exit(1);
    }
    logger.info('Single-run complete — exiting.');
    process.exit(0);
  }

  // ── Local mode: continuous polling loop ───────────────────────────────────
  logger.info('Watcher started. Running first check immediately…');

  while (true) {
    try {
      await runCycle();
    } catch (err) {
      logger.error('Unexpected error in worker loop (will retry next cycle):', err.message);
    }

    const nextRun = new Date(Date.now() + CONFIG.pollIntervalMs);
    logger.info(`Next check scheduled at ${nextRun.toLocaleTimeString()} (in ${CONFIG.pollIntervalMs / 60_000} min)…`);
    await sleep(CONFIG.pollIntervalMs);
  }
}

// ─── Start ────────────────────────────────────────────────────────────────────

workerLoop().catch((err) => {
  logger.error('Fatal error — worker loop crashed:', err);
  process.exit(1);
});
