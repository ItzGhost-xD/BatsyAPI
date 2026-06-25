/**
 * BatsyAPI — Discord Presence API
 * Developer : Venom
 * Team      : Veyron Labs
 * GitHub    : https://github.com/ItzGhost-xD/BatsyAPI
 * License   : MIT © 2024 Veyron Labs
 */

const config = require('../../config');

/**
 * Optional API key gate.
 * Set API_KEY_REQUIRED=true and API_KEYS=key1,key2 in .env to enable.
 * Clients send:  Authorization: Bearer <key>  or  x-api-key: <key>
 */
function apiKeyAuth(req, res, next) {
  if (!config.auth.required) return next();

  const header = req.headers['authorization'] || '';
  const keyHeader = req.headers['x-api-key'] || '';
  const key = header.startsWith('Bearer ') ? header.slice(7) : keyHeader;

  if (!key || !config.auth.keys.includes(key)) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Valid API key required. Pass via Authorization: Bearer <key> or x-api-key header.',
    });
  }

  next();
}

module.exports = { apiKeyAuth };
