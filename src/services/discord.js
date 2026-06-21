const { Client, GatewayIntentBits, Partials } = require('discord.js');
const config = require('../../config');
const logger = require('../utils/logger');
const redis = require('./redis');
const { parsePresence } = require('./presenceParser');
const { PresenceSnapshot } = require('../models');

let client = null;
const PRESENCE_KEY = (userId) => redis.shardKey(`presence:${userId}`);
const USER_KEY = (userId) => redis.shardKey(`user:${userId}`);
const PRESENCE_CHANNEL = 'presence:updates';

// ── Bot Startup ───────────────────────────────────────────────────────

async function start() {
  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildPresences,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.User, Partials.GuildMember],
    shards: config.discord.shardId,
    shardCount: config.discord.shardCount,
  });

  client.on('ready', () => {
    logger.info(`Discord bot ready — logged in as ${client.user.tag}`);
    logger.info(`Shard ${config.discord.shardId}/${config.discord.shardCount} — ${client.guilds.cache.size} guilds`);
  });

  client.on('presenceUpdate', handlePresenceUpdate);
  client.on('error', (e) => logger.error('Discord client error', { err: e.message }));
  client.on('warn', (msg) => logger.warn('Discord warning', { msg }));

  if (config.discord.token) {
    await client.login(config.discord.token);
  } else {
    logger.warn('No DISCORD_BOT_TOKEN set — running in mock mode');
  }

  return client;
}

// ── Presence Update Handler ───────────────────────────────────────────

async function handlePresenceUpdate(oldPresence, newPresence) {
  if (!newPresence?.userId) return;

  try {
    const parsed = parsePresence(newPresence);

    // Cache in Redis — fast path for API reads
    await redis.set(PRESENCE_KEY(parsed.userId), parsed, config.redis.ttl);

    // Cache user profile separately with longer TTL
    if (parsed.user) {
      await redis.set(USER_KEY(parsed.userId), parsed.user, config.redis.userTtl);
    }

    // Async: write analytics snapshot to MongoDB (fire-and-forget)
    PresenceSnapshot.create({
      userId: parsed.userId,
      guildId: parsed.guildId,
      status: parsed.status,
      clientStatus: parsed.clientStatus,
      activities: parsed.activities.all,
    }).catch((e) => logger.error('Analytics write failed', { err: e.message }));

    // Broadcast to WebSocket subscribers via Redis pub/sub
    await redis.publish(PRESENCE_CHANNEL, {
      type: 'PRESENCE_UPDATE',
      userId: parsed.userId,
      data: parsed,
    });

    logger.debug('Presence updated', { userId: parsed.userId, status: parsed.status });
  } catch (e) {
    logger.error('handlePresenceUpdate failed', { err: e.message });
  }
}

// ── Public helpers ────────────────────────────────────────────────────

/**
 * Fetch a user's presence. Redis → Discord cache → null.
 */
async function getPresence(userId) {
  // 1. Redis hit
  const cached = await redis.get(PRESENCE_KEY(userId));
  if (cached) return { data: cached, source: 'cache' };

  // 2. Try fetching from any guild the bot shares
  if (!client) return { data: null, source: 'none' };

  for (const guild of client.guilds.cache.values()) {
    try {
      const member = await guild.members.fetch({ user: userId, force: false }).catch(() => null);
      if (!member) continue;

      const presence = member.presence;
      if (!presence) continue;

      const parsed = parsePresence(presence);
      await redis.set(PRESENCE_KEY(userId), parsed, config.redis.ttl);
      return { data: parsed, source: 'live' };
    } catch (e) {
      // try next guild
    }
  }

  return { data: null, source: 'none' };
}

async function getUser(userId) {
  const cached = await redis.get(USER_KEY(userId));
  if (cached) return { data: cached, source: 'cache' };

  if (!client) return { data: null, source: 'none' };

  try {
    const user = await client.users.fetch(userId, { force: true });
    const profile = {
      id: user.id,
      username: user.username,
      displayName: user.displayName || user.globalName || user.username,
      discriminator: user.discriminator !== '0' ? user.discriminator : null,
      avatar: user.avatar,
      avatarUrl: user.displayAvatarURL({ size: 256 }),
      banner: user.banner,
      bannerUrl: user.bannerURL?.({ size: 600 }) || null,
      bannerColor: user.hexAccentColor || null,
      accentColor: user.accentColor || null,
      bot: user.bot || false,
      createdAt: user.createdAt?.toISOString() || null,
    };
    await redis.set(USER_KEY(userId), profile, config.redis.userTtl);
    return { data: profile, source: 'live' };
  } catch (e) {
    return { data: null, source: 'none' };
  }
}

function getClient() { return client; }

module.exports = { start, getPresence, getUser, getClient, PRESENCE_CHANNEL };
