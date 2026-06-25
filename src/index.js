/**
 * ╔══════════════════════════════════════════════════════╗
 * ║  BatsyAPI — Discord Presence API                    ║
 * ║  Developer : Venom                                   ║
 * ║  Team      : Veyron Labs                             ║
 * ║  GitHub    : github.com/ItzGhost-xD/BatsyAPI        ║
 * ║  License   : MIT © 2024 Veyron Labs                 ║
 * ╚══════════════════════════════════════════════════════╝
 *
 * Entry point — boot order:
 *   Redis → MongoDB → Discord bot → HTTP + WebSocket
 */

const http   = require('http');
const config = require('../config');
const logger = require('./utils/logger');

async function main() {
  logger.info(`Starting BatsyAPI [shard ${config.discord.shardId}/${config.discord.shardCount}] — by Venom @ Veyron Labs`);

  // 1. Redis
  const redis = require('./services/redis');
  await redis.connect();

  // 2. MongoDB (optional — analytics degrade gracefully)
  const db = require('./models');
  try {
    await db.connect();
  } catch (e) {
    logger.warn('MongoDB unavailable — analytics disabled', { err: e.message });
  }

  // 3. Discord gateway (mock mode when no token set)
  const discordService = config.discord.token
    ? require('./services/discord')
    : require('./services/mockDiscord');
  await discordService.start();

  // 4. Express app
  const { createApp } = require('./app');
  const app    = createApp();
  const server = http.createServer(app);

  // 5. WebSocket
  const { createWsServer } = require('./websocket/server');
  createWsServer(server);

  // 6. Listen
  await new Promise((resolve, reject) => {
    server.listen(config.server.port, resolve);
    server.once('error', reject);
  });

  logger.info(`🚀 BatsyAPI running on port ${config.server.port}`);
  logger.info(`📖 Docs   → http://localhost:${config.server.port}/docs`);
  logger.info(`🔌 WS     → ws://localhost:${config.server.port}/ws`);
  logger.info(`❤️  Health → http://localhost:${config.server.port}/health`);

  // Graceful shutdown
  async function shutdown(signal) {
    logger.info(`${signal} — shutting down BatsyAPI`);
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
  console.error('BatsyAPI fatal startup error:', e.message, e.stack);
  process.exit(1);
});
