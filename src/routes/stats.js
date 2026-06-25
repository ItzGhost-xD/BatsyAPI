/**
 * BatsyAPI — Discord Presence API
 * Developer : Venom
 * Team      : Veyron Labs
 */

const router = require('express').Router();
const redis  = require('../services/redis');
const { PresenceSnapshot, RequestLog } = require('../models');
const logger = require('../utils/logger');

// Redis key constants — prefixed with batsy: so they're easy to find
const KEYS = {
  totalRequests: 'batsy:stats:requests',
  uniqueUsers:   'batsy:stats:users',    // Redis SET — auto-deduplicates
};

// ── Called on every /v1/users/:id request ────────────────────────────
async function recordRequest(userId) {
  try {
    const client = redis.getClient();
    if (!client) return;

    // Atomic increment — no race conditions
    await client.incr(KEYS.totalRequests);

    // SADD to a set — same user ID added 100x still counts as 1 unique
    if (userId && /^\d{17,20}$/.test(userId)) {
      await client.sAdd(KEYS.uniqueUsers, String(userId));
    }
  } catch (e) {
    logger.debug('recordRequest failed', { err: e.message });
  }
}

// ── GET /v1/stats ─────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const client = redis.getClient();
    if (!client) {
      return res.json({ ok: true, stats: { totalRequests: 0, uniqueUsersTracked: 0 }, source: 'unavailable' });
    }

    const [totalRequests, uniqueUsersTracked] = await Promise.all([
      client.get(KEYS.totalRequests).then(v => parseInt(v || '0') || 0),
      client.sCard(KEYS.uniqueUsers).catch(() => 0),
    ]);

    // Optional MongoDB enrichment — degrades gracefully if Mongo offline
    let mongo = {};
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const [r24, u24] = await Promise.all([
        RequestLog.countDocuments({ ts: { $gte: since } }),
        PresenceSnapshot.distinct('userId', { recordedAt: { $gte: since } }).then(a => a.length),
      ]);
      mongo = { requests24h: r24, uniqueUsers24h: u24 };
    } catch (_) {}

    return res.json({
      ok: true,
      stats: {
        totalRequests,
        uniqueUsersTracked,
        ...mongo,
      },
      meta: {
        project:   'BatsyAPI',
        developer: 'Venom',
        team:      'Veyron Labs',
        github:    'https://github.com/ItzGhost-xD/BatsyAPI',
      },
    });
  } catch (e) {
    logger.error('Stats endpoint failed', { err: e.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = { router, recordRequest, KEYS };