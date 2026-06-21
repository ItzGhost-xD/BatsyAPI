const router  = require('express').Router();
const redis   = require('../services/redis');
const mongoose = require('mongoose');
const discord  = require('../services');         // ← resolver
const { noCache } = require('../middleware/etag');

router.get('/', noCache, async (req, res) => {
  const checks = await Promise.allSettled([
    (async () => {
      const start = Date.now();
      await redis.set('health:ping', 'pong', 5);
      const val = await redis.get('health:ping');
      return { latencyMs: Date.now() - start, ok: val === 'pong' };
    })(),
    Promise.resolve({ ok: mongoose.connection.readyState === 1 }),
    Promise.resolve({ ok: !!discord.getClient?.()?.isReady?.() }),
  ]);

  const [redisC, mongoC, discordC] = checks;

  const services = {
    redis: redisC.status === 'fulfilled'
      ? { status: redisC.value.ok ? 'ok' : 'degraded', latencyMs: redisC.value.latencyMs }
      : { status: 'error', error: redisC.reason?.message },
    mongodb: mongoC.status === 'fulfilled'
      ? { status: mongoC.value.ok ? 'ok' : 'disconnected' }
      : { status: 'error' },
    discord: discordC.status === 'fulfilled'
      ? { status: discordC.value.ok ? 'ok' : 'disconnected (mock mode)' }
      : { status: 'error' },
  };

  const allOk = services.redis.status === 'ok'; // redis is the only hard dependency
  return res.status(allOk ? 200 : 503).json({
    status: allOk ? 'healthy' : 'degraded',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    services,
  });
});

module.exports = router;
