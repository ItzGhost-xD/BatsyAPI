/**
 * BatsyAPI — Discord Presence API
 * Developer : Venom
 * Team      : Veyron Labs
 * GitHub    : https://github.com/ItzGhost-xD/BatsyAPI
 * License   : MIT © 2024 Veyron Labs
 */

const router  = require('express').Router();
const discord = require('../services');          // ← resolver, not hardcoded
const redis   = require('../services/redis');
const { PresenceSnapshot } = require('../models');
const { etagMiddleware }   = require('../middleware/etag');
const { heavyLimiter }     = require('../middleware/rateLimit');
const logger               = require('../utils/logger');

// ── GET /v1/users/:id  — full profile + presence ──────────────────────
router.get('/:id', etagMiddleware(60), async (req, res) => {
  const { id } = req.params;
  if (!/^\d{17,20}$/.test(id))
    return res.status(400).json({ error: 'Invalid Discord user ID format' });

  try {
    const [presenceResult, userResult] = await Promise.all([
      discord.getPresence(id),
      discord.getUser(id),
    ]);

    if (!userResult.data && !presenceResult.data)
      return res.status(404).json({ error: 'User not found' });

    const data = presenceResult.data
      ? { ...presenceResult.data, user: userResult.data || presenceResult.data.user }
      : { userId: id, status: 'offline', user: userResult.data, activities: { all: [] }, clientStatus: {} };

    const source = (presenceResult.source === 'cache' && userResult.source === 'cache') ? 'cache' : 'live';
    return res.presence(data, { source });
  } catch (e) {
    logger.error('GET /users/:id failed', { id, err: e.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /v1/users/:id/presence  — presence only ───────────────────────
router.get('/:id/presence', etagMiddleware(30), async (req, res) => {
  const { id } = req.params;
  if (!/^\d{17,20}$/.test(id))
    return res.status(400).json({ error: 'Invalid Discord user ID format' });

  try {
    const { data, source } = await discord.getPresence(id);
    if (!data)
      return res.status(404).json({
        error: 'Presence not found',
        message: 'User not found or bot does not share a guild with them',
      });
    return res.presence(data, { source });
  } catch (e) {
    logger.error('GET /users/:id/presence failed', { id, err: e.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /v1/users/:id/status  — status string only, ultra-light ───────
router.get('/:id/status', etagMiddleware(15), async (req, res) => {
  const { id } = req.params;
  if (!/^\d{17,20}$/.test(id))
    return res.status(400).json({ error: 'Invalid Discord user ID format' });

  try {
    const cacheKey = redis.shardKey(`presence:${id}`);
    const cached   = await redis.get(cacheKey);
    const source   = cached ? 'cache' : 'live';
    const data     = cached || (await discord.getPresence(id)).data;

    if (!data) return res.status(404).json({ error: 'Not found' });

    res.setHeader('X-Cache', source === 'cache' ? 'HIT' : 'MISS');
    return res.json({
      ok: true,
      userId: id,
      status: data.status,
      clientStatus: data.clientStatus,
      updatedAt: data.updatedAt,
    });
  } catch (e) {
    logger.error('GET /users/:id/status failed', { id, err: e.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /v1/users/:id/history  — analytics snapshots ─────────────────
router.get('/:id/history', heavyLimiter, async (req, res) => {
  const { id }  = req.params;
  const limit   = Math.min(parseInt(req.query.limit || '50'), 200);
  const since   = req.query.since ? new Date(req.query.since) : null;

  if (!/^\d{17,20}$/.test(id))
    return res.status(400).json({ error: 'Invalid Discord user ID format' });

  try {
    const query = { userId: id };
    if (since) query.recordedAt = { $gte: since };

    const snapshots = await PresenceSnapshot
      .find(query)
      .sort({ recordedAt: -1 })
      .limit(limit)
      .lean();

    res.setHeader('Cache-Control', 'no-store');
    return res.json({ ok: true, data: snapshots, count: snapshots.length });
  } catch (e) {
    logger.error('GET /users/:id/history failed', { id, err: e.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
