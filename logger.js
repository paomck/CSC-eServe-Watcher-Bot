'use strict';

/**
 * Lightweight timestamped logger.
 * All messages are prefixed with an ISO timestamp and a level badge.
 */

const LEVELS = {
  info:  { badge: 'ℹ️  INFO ', color: '\x1b[36m' },  // cyan
  ok:    { badge: '✅  OK   ', color: '\x1b[32m' },  // green
  warn:  { badge: '⚠️  WARN ', color: '\x1b[33m' },  // yellow
  error: { badge: '🚨 ERROR ', color: '\x1b[31m' },  // red
  debug: { badge: '🔍 DEBUG ', color: '\x1b[90m' },  // grey
};

const RESET = '\x1b[0m';

function log(level, ...args) {
  const { badge, color } = LEVELS[level] ?? LEVELS.info;
  const ts = new Date().toISOString();
  console.log(`${color}[${ts}] ${badge}${RESET}`, ...args);
}

module.exports = {
  info:  (...a) => log('info',  ...a),
  ok:    (...a) => log('ok',    ...a),
  warn:  (...a) => log('warn',  ...a),
  error: (...a) => log('error', ...a),
  debug: (...a) => log('debug', ...a),
};
