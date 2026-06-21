/**
 * Discord Presence API — entry point
 * Boot order: Redis → MongoDB (optional) → Discord bot → HTTP + WebSocket
 */

const http   = require('http');
const config = require('../config');
const logger = require('./utils/logger');

async function main() {
  logger.info(`Starting Discord Presence API [shard ${config.discord.shardId}/${config.discord.shardCount}]`);

  // ── 1. Redis (required) ──────────────────────────────────────────
  const redis = require('./services/redis');
  await redis.connect();

  // ── 2. MongoDB (optional — analytics degrade gracefully without it) ──
  const db = require('./models');
  try {
    await db.connect();
  } catch (e) {
    logger.warn('MongoDB unavailable — analytics disabled', { err: e.message });
    // Swallow: mongoose already registered its error listener, won't crash us
  }

  // ── 3. Discord gateway (mock when no token) ──────────────────────
  const discordService = require('./services');
  await discordService.start();

  // ── 4. Express app ───────────────────────────────────────────────
  const { createApp } = require('./app');
  const app    = createApp();
  const server = http.createServer(app);

  // ── 5. WebSocket ─────────────────────────────────────────────────
  const { createWsServer } = require('./websocket/server');
  createWsServer(server);

  // ── 6. Listen ────────────────────────────────────────────────────
  await new Promise((resolve, reject) => {
    server.listen(config.server.port, resolve);
    server.once('error', reject);
  });

  logger.info(`🚀 HTTP  → http://localhost:${config.server.port}`);
  logger.info(`📖 Docs  → http://localhost:${config.server.port}/docs`);
  logger.info(`🔌 WS    → ws://localhost:${config.server.port}/ws`);
  logger.info(`❤️  Health→ http://localhost:${config.server.port}/health`);

  // ── Graceful shutdown ────────────────────────────────────────────
  async function shutdown(signal) {
    logger.info(`${signal} — shutting down`);
    server.close(async () => {
      try { await discordService?.getClient()?.destroy(); } catch (_) {}
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('unhandledRejection', (r) => logger.error('Unhandled rejection', { reason: String(r) }));
}

main().catch((e) => {
  console.error('Fatal startup error:', e.message, e.stack);
  process.exit(1);
});
