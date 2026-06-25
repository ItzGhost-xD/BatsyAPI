/**
 * BatsyAPI — Discord Presence API
 * Developer : Venom
 * Team      : Veyron Labs
 * GitHub    : https://github.com/ItzGhost-xD/BatsyAPI
 * License   : MIT © 2024 Veyron Labs
 */

const { createLogger, format, transports } = require('winston');
const { combine, timestamp, colorize, printf, errors } = format;
const path = require('path');
const fs   = require('fs');
const config = require('../../config');

const logFormat = printf(({ level, message, timestamp, stack, ...meta }) => {
  let out = `${timestamp} [${level}] ${stack || message}`;
  if (Object.keys(meta).length) out += ` ${JSON.stringify(meta)}`;
  return out;
});

const logger = createLogger({
  level: config.log.level,
  format: combine(
    errors({ stack: true }),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    logFormat
  ),
  transports: [
    new transports.Console({
      format: combine(colorize(), timestamp({ format: 'HH:mm:ss' }), logFormat),
    }),
  ],
});

// Add rotating file transport in production — but only if the logs dir is writable
if (config.server.env === 'production') {
  try {
    const logsDir = path.join(process.cwd(), 'logs');
    fs.mkdirSync(logsDir, { recursive: true }); // create if missing

    const DailyRotate = require('winston-daily-rotate-file');
    logger.add(new DailyRotate({
      filename:    path.join(logsDir, 'app-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxFiles:    '14d',
      format:      combine(timestamp(), logFormat),
    }));
  } catch (e) {
    // Can't write logs to disk (e.g. read-only container) — console only is fine
    logger.warn('File logging disabled — cannot create logs directory: ' + e.message);
  }
}

module.exports = logger;
