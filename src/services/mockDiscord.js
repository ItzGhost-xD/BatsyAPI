/**
 * mockDiscord.js
 *
 * Replaces the real Discord service when DISCORD_BOT_TOKEN is not set.
 * Generates realistic-looking presence data so you can develop and demo
 * the full API without a bot in any server.
 *
 * Activated automatically when NODE_ENV=development and no token is set.
 */

const { EventEmitter } = require('events');
const redis = require('./redis');
const logger = require('../utils/logger');

const emitter = new EventEmitter();
const PRESENCE_CHANNEL = 'presence:updates';

// ── Seed data ─────────────────────────────────────────────────────────

const STATUSES = ['online', 'idle', 'dnd', 'offline'];
const PLATFORMS = [
  { desktop: 'online', mobile: null, web: null },
  { desktop: null, mobile: 'online', web: null },
  { desktop: 'online', mobile: null, web: 'online' },
  { desktop: 'dnd', mobile: null, web: null },
];

const MOCK_USERS = {
  '111111111111111111': {
    id: '111111111111111111',
    username: 'alice',
    displayName: 'Alice 🌸',
    discriminator: null,
    avatar: null,
    avatarUrl: 'https://cdn.discordapp.com/embed/avatars/0.png',
    bannerUrl: null,
    bannerColor: '#5865f2',
    bot: false,
    createdAt: '2019-04-01T00:00:00.000Z',
  },
  '222222222222222222': {
    id: '222222222222222222',
    username: 'bob_dev',
    displayName: 'Bob',
    discriminator: null,
    avatar: null,
    avatarUrl: 'https://cdn.discordapp.com/embed/avatars/1.png',
    bannerUrl: null,
    bannerColor: '#f23f43',
    bot: false,
    createdAt: '2020-06-15T00:00:00.000Z',
  },
  '333333333333333333': {
    id: '333333333333333333',
    username: 'streamerguy',
    displayName: 'StreamerGuy 🎮',
    discriminator: null,
    avatar: null,
    avatarUrl: 'https://cdn.discordapp.com/embed/avatars/2.png',
    bannerUrl: null,
    bannerColor: '#f0b232',
    bot: false,
    createdAt: '2018-01-20T00:00:00.000Z',
  },
};

function makeMockPresence(userId, overrides = {}) {
  const user = MOCK_USERS[userId] || {
    id: userId,
    username: `user_${userId.slice(-4)}`,
    displayName: `User ${userId.slice(-4)}`,
    discriminator: null,
    avatar: null,
    avatarUrl: 'https://cdn.discordapp.com/embed/avatars/3.png',
    bannerUrl: null,
    bannerColor: '#23a55a',
    bot: false,
    createdAt: '2021-01-01T00:00:00.000Z',
  };

  const status = overrides.status || STATUSES[Math.floor(Math.random() * STATUSES.length)];
  const platform = PLATFORMS[Math.floor(Math.random() * PLATFORMS.length)];
  const now = Date.now();

  const activities = { all: [], customStatus: null, spotify: null, games: [], streaming: null, watching: null, competing: null };

  // Always give alice a custom status and spotify
  if (userId === '111111111111111111') {
    const custom = { type: 'custom', name: 'Custom Status', state: 'vibing 🎶', emoji: { name: '🎶', id: null, animated: false, url: null } };
    const spotify = {
      type: 'spotify',
      trackId: '0VjIjW4GlUZAMYd2vXMi3b',
      song: 'Blinding Lights',
      artist: 'The Weeknd',
      album: 'After Hours',
      albumArt: 'https://i.scdn.co/image/ab67616d0000b273ef017e899c0547766997d874',
      trackUrl: 'https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b',
      duration: { start: now - 80000, end: now + 140000, durationMs: 220000 },
    };
    activities.all = [custom, spotify];
    activities.customStatus = custom;
    activities.spotify = spotify;
  }

  // Bob is always coding
  if (userId === '222222222222222222') {
    const vscode = {
      type: 'rich_presence',
      name: 'Visual Studio Code',
      applicationId: '383226320970055681',
      details: 'Editing presence-parser.js',
      state: 'Workspace: discord-presence-api',
      largeImage: { key: 'vscode-large', text: 'Visual Studio Code', url: 'https://cdn.discordapp.com/app-icons/383226320970055681/74ef73e0894b7d771b6f7f9ef0a9bcfa.png' },
      smallImage: { key: 'js', text: 'JavaScript', url: null },
      timestamps: { start: now - 3_600_000, end: null },
      party: null,
      buttons: [],
    };
    activities.all = [vscode];
    activities.games = [vscode];
  }

  // StreamerGuy is live
  if (userId === '333333333333333333') {
    const stream = {
      type: 'streaming',
      name: 'Valorant',
      url: 'https://www.twitch.tv/streamerguy',
      details: 'Ranked Grind',
      state: 'Diamond I',
      platform: 'twitch',
    };
    activities.all = [stream];
    activities.streaming = stream;
  }

  return {
    userId,
    status: status === 'offline' && userId !== '333333333333333333' ? status : status,
    clientStatus: platform,
    activities,
    user,
    guildId: '987654321098765432',
    updatedAt: new Date().toISOString(),
  };
}

// ── Mock service interface (mirrors discord.js service) ───────────────

async function getPresence(userId) {
  // Only serve presence for seeded mock users
  if (!MOCK_USERS[userId]) return { data: null, source: 'none' };

  const cacheKey = require('./redis').shardKey(`presence:${userId}`);
  const cached   = await redis.get(cacheKey);
  if (cached) return { data: cached, source: 'cache' };

  const data = makeMockPresence(userId);
  await redis.set(cacheKey, data, 60);
  return { data, source: 'live' };
}

async function getUser(userId) {
  if (!MOCK_USERS[userId]) return { data: null, source: 'none' };

  const cacheKey = require('./redis').shardKey(`user:${userId}`);
  const cached   = await redis.get(cacheKey);
  if (cached) return { data: cached, source: 'cache' };

  const presence = makeMockPresence(userId);
  await redis.set(cacheKey, presence.user, 300);
  return { data: presence.user, source: 'live' };
}

function getClient() { return null; }

// Simulate live presence changes every 15s for known mock users
async function startMockUpdates() {
  logger.warn('⚠️  Running in MOCK MODE — no Discord bot token set');
  logger.info('Mock users available: 111111111111111111, 222222222222222222, 333333333333333333');

  setInterval(async () => {
    const userId = Object.keys(MOCK_USERS)[Math.floor(Math.random() * 3)];
    const data = makeMockPresence(userId);
    const cacheKey = redis.shardKey(`presence:${userId}`);
    await redis.set(cacheKey, data, 60);
    await redis.publish(PRESENCE_CHANNEL, { type: 'PRESENCE_UPDATE', userId, data });
    logger.debug('Mock presence update', { userId, status: data.status });
  }, 15_000);
}

async function start() {
  await startMockUpdates();
  return null;
}

module.exports = { start, getPresence, getUser, getClient, PRESENCE_CHANNEL };
