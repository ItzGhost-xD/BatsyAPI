const rateLimit = require('express-rate-limit');
const config = require('../../config');

// In production, back this with Redis via rate-limit-redis
// For now: in-memory store (swap out easily)

const apiLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests',
    retryAfter: Math.ceil(config.rateLimit.windowMs / 1000),
  },
  keyGenerator: (req) => req.headers['x-forwarded-for']?.split(',')[0] || req.ip,
});

// Tighter limit for expensive endpoints (analytics, bulk lookups)
const heavyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit exceeded on heavy endpoint', retryAfter: 60 },
});

module.exports = { apiLimiter, heavyLimiter };
