/**
 * BatsyAPI — Discord Presence API
 * Developer : Venom
 * Team      : Veyron Labs
 * GitHub    : https://github.com/ItzGhost-xD/BatsyAPI
 * License   : MIT © 2024 Veyron Labs
 */

const { RequestLog } = require('../models');
const logger = require('../utils/logger');

/**
 * Fires after response is sent — logs path, status, duration, cache-hit to MongoDB.
 * Non-blocking: errors here never affect the actual response.
 */
function analyticsMiddleware(req, res, next) {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const cacheHit = res.getHeader('X-Cache') === 'HIT';

    RequestLog.create({
      ip: req.headers['x-forwarded-for']?.split(',')[0] || req.ip,
      path: req.path,
      userId: req.params?.id || null,
      statusCode: res.statusCode,
      durationMs: duration,
      cacheHit,
    }).catch((e) => logger.debug('Analytics log failed', { err: e.message }));
  });

  next();
}

module.exports = { analyticsMiddleware };
