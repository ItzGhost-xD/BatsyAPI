/**
 * BatsyAPI — Discord Presence API
 * Developer : Venom
 * Team      : Veyron Labs
 */

const router = require('express').Router();
const redis  = require('../services/redis');
const { PresenceSnapshot, RequestLog } = require('../models');
const logger = require('../utils/logger');

// Keys we track in Redis (fast, no Mongo needed)
const KEYS = {
  totalRequests:  's0:stats:totalRequests',
  uniqueUsers:    's0:stats:uniqueUsers',    // Redis Set
  totalLookups:   's0:stats:totalLookups',
  wsConnections:  's0:stats:wsConnections',
};

// Called by middleware on every API request
async function recordRequest(userId) {
  try {
    await redis.incr(KEYS.totalRequests);
    await redis.incr(KEYS.totalLookups);
    if (userId) {
      // SADD — adds to a set, auto-deduplicates
      const client = redis.getClient();
      if (client) await client.sAdd(KEYS.uniqueUsers, userId);
    }
  } catch (_) {}
}

// GET /v1/stats
router.get('/', async (req, res) => {
  try {
    const client = redis.getClient();

    const [
      totalRequests,
      totalLookups,
      uniqueUsersCount,
      wsConnections,
    ] = await Promise.all([
      redis.get(KEYS.totalRequests).then(v => parseInt(v?.value ?? v ?? '0') || 0),
      redis.get(KEYS.totalLookups).then(v => parseInt(v?.value ?? v ?? '0') || 0),
      client ? client.sCard(KEYS.uniqueUsers).catch(() => 0) : 0,
      redis.get(KEYS.wsConnections).then(v => parseInt(v?.value ?? v ?? '0') || 0),
    ]);

    // Try MongoDB for richer 24h stats (optional — degrades if Mongo offline)
    let mongoStats = null;
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const [requests24h, uniqueUsers24h] = await Promise.all([
        RequestLog.countDocuments({ ts: { $gte: since } }),
        PresenceSnapshot.distinct('userId', { recordedAt: { $gte: since } }).then(r => r.length),
      ]);
      mongoStats = { requests24h, uniqueUsers24h };
    } catch (_) {}

    return res.json({
      ok: true,
      stats: {
        totalRequests,
        totalLookups,
        uniqueUsersTracked: uniqueUsersCount,
        activeWsConnections: wsConnections,
        ...(mongoStats || {}),
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