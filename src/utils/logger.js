const { createLogger, format, transports } = require('winston');
const { combine, timestamp, colorize, printf, errors } = format;
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

// Add file transport in production
if (config.server.env === 'production') {
  const DailyRotate = require('winston-daily-rotate-file');
  logger.add(new DailyRotate({
    filename: 'logs/app-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    maxFiles: '14d',
    format: combine(timestamp(), logFormat),
  }));
}

module.exports = logger;
