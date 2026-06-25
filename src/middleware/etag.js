/**
 * BatsyAPI — Discord Presence API
 * Developer : Venom
 * Team      : Veyron Labs
 * GitHub    : https://github.com/ItzGhost-xD/BatsyAPI
 * License   : MIT © 2024 Veyron Labs
 */

const crypto = require('crypto');
const config = require('../../config');

/**
 * Attaches ETag and Cache-Control headers.
 * If the client's If-None-Match matches, short-circuits with 304.
 */
function etagMiddleware(maxAge = 30) {
  return (req, res, next) => {
    const originalJson = res.json.bind(res);

    res.json = function (body) {
      if (res.headersSent) return;

      const payload = JSON.stringify(body);
      const etag = `"${crypto
        .createHmac('sha256', config.cache.etagSecret)
        .update(payload)
        .digest('hex')
        .slice(0, 16)}"`;

      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', `public, max-age=${maxAge}, stale-while-revalidate=60`);
      res.setHeader('Vary', 'Accept-Encoding, Accept');

      // 304 if client already has this version
      if (req.headers['if-none-match'] === etag) {
        return res.status(304).end();
      }

      return originalJson(body);
    };

    next();
  };
}

/**
 * For endpoints that must never be cached
 */
function noCache(req, res, next) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  next();
}

module.exports = { etagMiddleware, noCache };
