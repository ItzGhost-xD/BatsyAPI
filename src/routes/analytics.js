const router = require('express').Router();
const { PresenceSnapshot, RequestLog } = require('../models');
const { heavyLimiter } = require('../middleware/rateLimit');
const logger = require('../utils/logger');

// ── GET /v1/analytics/overview ────────────────────────────────────────
router.get('/overview', heavyLimiter, async (req, res) => {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [totalSnapshots, uniqueUsers, statusBreakdown, requestStats] =
      await Promise.all([
        PresenceSnapshot.countDocuments({ recordedAt: { $gte: since } }),
        PresenceSnapshot.distinct('userId', { recordedAt: { $gte: since } }).then(r => r.length),
        PresenceSnapshot.aggregate([
          { $match: { recordedAt: { $gte: since } } },
          { $group: { _id: '$status', count: { $sum: 1 } } },
          { $sort:  { count: -1 } },
        ]),
        RequestLog.aggregate([
          { $match: { ts: { $gte: since } } },
          { $group: { _id: null,
              total:       { $sum: 1 },
              avgDuration: { $avg: '$durationMs' },
              cacheHits:   { $sum: { $cond: ['$cacheHit', 1, 0] } },
              errors:      { $sum: { $cond: [{ $gte: ['$statusCode', 400] }, 1, 0] } },
          }},
        ]),
      ]);

    const req0 = requestStats[0] || { total: 0, avgDuration: 0, cacheHits: 0, errors: 0 };

    return res.json({
      ok: true,
      window: '24h',
      presence: {
        totalUpdates: totalSnapshots,
        uniqueUsers,
        statusBreakdown: Object.fromEntries(statusBreakdown.map(s => [s._id, s.count])),
      },
      api: {
        totalRequests:  req0.total,
        avgResponseMs:  Math.round(req0.avgDuration || 0),
        cacheHitRate:   req0.total ? `${Math.round((req0.cacheHits / req0.total) * 100)}%` : 'N/A',
        errorRate:      req0.total ? `${Math.round((req0.errors  / req0.total) * 100)}%` : 'N/A',
      },
    });
  } catch (e) {
    logger.error('Analytics overview failed', { err: e.message });
    return res.status(500).json({ error: 'Internal server error', detail: e.message });
  }
});

// ── GET /v1/analytics/status-over-time/:id ────────────────────────────
router.get('/status-over-time/:id', heavyLimiter, async (req, res) => {
  const { id }  = req.params;
  const hours   = Math.min(parseInt(req.query.hours || '24'), 168);

  if (!/^\d{17,20}$/.test(id))
    return res.status(400).json({ error: 'Invalid Discord user ID format' });

  try {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const snapshots = await PresenceSnapshot.aggregate([
      { $match: { userId: id, recordedAt: { $gte: since } } },
      { $group: { _id: {
          hour:   { $dateToString: { format: '%Y-%m-%dT%H:00:00Z', date: '$recordedAt' } },
          status: '$status',
        }, count: { $sum: 1 } } },
      { $sort: { '_id.hour': 1 } },
    ]);

    return res.json({ ok: true, userId: id, window: `${hours}h`, data: snapshots });
  } catch (e) {
    logger.error('Status-over-time failed', { id, err: e.message });
    return res.status(500).json({ error: 'Internal server error', detail: e.message });
  }
});

module.exports = router;
