/**
 * BatsyAPI — Discord Presence API
 * Developer : Venom
 * Team      : Veyron Labs
 * GitHub    : https://github.com/ItzGhost-xD/BatsyAPI
 * License   : MIT © 2024 Veyron Labs
 */

require('dotenv').config();

module.exports = {
  discord: {
    token: process.env.DISCORD_BOT_TOKEN,
    clientId: process.env.DISCORD_CLIENT_ID,
    shardCount: parseInt(process.env.SHARD_COUNT || '1'),
    shardId: parseInt(process.env.SHARD_ID || '0'),
  },

  server: {
    port: parseInt(process.env.PORT || '3000'),
    env: process.env.NODE_ENV || 'development',
    baseUrl: process.env.API_BASE_URL || 'http://localhost:3000',
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    password: process.env.REDIS_PASSWORD || undefined,
    ttl: parseInt(process.env.REDIS_TTL || '300'),
    userTtl: parseInt(process.env.REDIS_USER_TTL || '3600'),
  },

  mongo: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/discord_presence',
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'),
    max: parseInt(process.env.RATE_LIMIT_MAX || '100'),
    wsMax: parseInt(process.env.WS_RATE_LIMIT_MAX || '10'),
  },

  cache: {
    etagSecret: process.env.ETAG_SECRET || 'default-secret-change-me',
  },

  auth: {
    required: process.env.API_KEY_REQUIRED === 'true',
    keys: (process.env.API_KEYS || '').split(',').filter(Boolean),
  },

  log: {
    level: process.env.LOG_LEVEL || 'info',
  },
};
