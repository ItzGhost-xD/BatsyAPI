const { Client, GatewayIntentBits, Partials } = require('discord.js');
const config = require('../../config');
const logger = require('../utils/logger');
const redis  = require('./redis');
const { parsePresence } = require('./presenceParser');
const { PresenceSnapshot } = require('../models');

let client = null;

const PRESENCE_KEY      = (id) => redis.shardKey(`presence:${id}`);
const PRESENCE_LAST_KEY = (id) => redis.shardKey(`presence:last:${id}`); // survives offline
const USER_KEY          = (id) => redis.shardKey(`user:${id}`);
const PRESENCE_CHANNEL  = 'presence:updates';

// ── Bot startup ───────────────────────────────────────────────────────

async function start() {
  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildPresences,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.User, Partials.GuildMember],
    shards:      config.discord.shardId,
    shardCount:  config.discord.shardCount,
  });

  client.on('clientReady', () => {
    logger.info(`Discord bot ready — logged in as ${client.user.tag}`);
    logger.info(`Shard ${config.discord.shardId}/${config.discord.shardCount} — ${client.guilds.cache.size} guilds`);
  });

  client.on('presenceUpdate', handlePresenceUpdate);
  client.on('error', (e) => logger.error('Discord client error', { err: e.message }));
  client.on('warn',  (msg) => logger.warn('Discord warning', { msg }));

  if (config.discord.token) {
    await client.login(config.discord.token);
  } else {
    logger.warn('No DISCORD_BOT_TOKEN set — running in mock mode');
  }

  return client;
}

// ── Presence update handler ───────────────────────────────────────────

async function handlePresenceUpdate(oldPresence, newPresence) {
  if (!newPresence?.userId) return;

  try {
    const parsed = parsePresence(newPresence);

    // Short-lived cache (TTL matches config — refreshed on every update)
    await redis.set(PRESENCE_KEY(parsed.userId), parsed, config.redis.ttl);

    // Long-lived "last known" cache — 7 days, never wiped when user goes offline
    // This means we can always return something even if the user is invisible/offline
    await redis.set(PRESENCE_LAST_KEY(parsed.userId), parsed, 60 * 60 * 24 * 7);

    // Cache user profile
    if (parsed.user) {
      await redis.set(USER_KEY(parsed.userId), parsed.user, config.redis.userTtl);
    }

    // Analytics snapshot (fire-and-forget)
    PresenceSnapshot.create({
      userId:       parsed.userId,
      guildId:      parsed.guildId,
      status:       parsed.status,
      clientStatus: parsed.clientStatus,
      activities:   parsed.activities.all,
    }).catch((e) => logger.error('Analytics write failed', { err: e.message }));

    // Broadcast to WS subscribers
    await redis.publish(PRESENCE_CHANNEL, {
      type:   'PRESENCE_UPDATE',
      userId: parsed.userId,
      data:   parsed,
    });

    logger.debug('Presence updated', { userId: parsed.userId, status: parsed.status });
  } catch (e) {
    logger.error('handlePresenceUpdate failed', { err: e.message });
  }
}

// ── Build an offline/invisible presence object for a member ──────────

function buildOfflinePresence(member) {
  const user = member.user;
  return {
    userId: user.id,
    status: 'offline',
    clientStatus: { desktop: null, mobile: null, web: null },
    activities: { all: [], customStatus: null, spotify: null, games: [], streaming: null, watching: null, competing: null },
    user: {
      id:            user.id,
      username:      user.username,
      displayName:   user.displayName || user.globalName || user.username,
      discriminator: user.discriminator !== '0' ? user.discriminator : null,
      avatar:        user.avatar,
      avatarUrl:     user.displayAvatarURL({ size: 256 }),
      banner:        user.banner  || null,
      bannerUrl:     user.bannerURL?.({ size: 600 }) || null,
      bannerColor:   user.hexAccentColor || null,
      accentColor:   user.accentColor    || null,
      bot:           user.bot || false,
      createdAt:     user.createdAt?.toISOString() || null,
    },
    guildId:   member.guild.id,
    updatedAt: new Date().toISOString(),
    offline:   true,   // flag so callers know this isn't a live presence
  };
}

// ── Public helpers ────────────────────────────────────────────────────

async function getPresence(userId) {
  // 1. Redis hot cache (recent update)
  const cached = await redis.get(PRESENCE_KEY(userId));
  if (cached) return { data: cached, source: 'cache' };

  if (!client) return { data: null, source: 'none' };

  // 2. Try fetching live from Discord
  for (const guild of client.guilds.cache.values()) {
    try {
      const member = await guild.members.fetch({ user: userId, force: true }).catch(() => null);
      if (!member) continue;

      const presence = member.presence;

      if (presence && presence.status !== 'offline') {
        // User is online/idle/dnd — parse and cache normally
        const parsed = parsePresence(presence);
        await redis.set(PRESENCE_KEY(parsed.userId), parsed, config.redis.ttl);
        await redis.set(PRESENCE_LAST_KEY(parsed.userId), parsed, 60 * 60 * 24 * 7);
        if (parsed.user) await redis.set(USER_KEY(parsed.userId), parsed.user, config.redis.userTtl);
        return { data: parsed, source: 'live' };
      }

      // User is offline / invisible — build offline presence with their profile
      // but first check if we have a last-known presence to enrich with
      const lastKnown = await redis.get(PRESENCE_LAST_KEY(userId));

      const offlineData = buildOfflinePresence(member);

      // Preserve user profile from last known if richer
      if (lastKnown?.user) offlineData.user = lastKnown.user;

      // Cache briefly so repeated calls don't hammer Discord API
      await redis.set(PRESENCE_KEY(userId), offlineData, 30);
      if (offlineData.user) await redis.set(USER_KEY(userId), offlineData.user, config.redis.userTtl);

      return { data: offlineData, source: 'live' };
    } catch (e) {
      logger.debug('getPresence guild fetch failed', { guild: guild.id, err: e.message });
    }
  }

  // 3. Not in any shared guild — return last known presence marked as stale
  const lastKnown = await redis.get(PRESENCE_LAST_KEY(userId));
  if (lastKnown) {
    return {
      data: { ...lastKnown, status: 'offline', stale: true },
      source: 'stale_cache',
    };
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
      id:            user.id,
      username:      user.username,
      displayName:   user.displayName || user.globalName || user.username,
      discriminator: user.discriminator !== '0' ? user.discriminator : null,
      avatar:        user.avatar,
      avatarUrl:     user.displayAvatarURL({ size: 256 }),
      banner:        user.banner || null,
      bannerUrl:     user.bannerURL?.({ size: 600 }) || null,
      bannerColor:   user.hexAccentColor || null,
      accentColor:   user.accentColor    || null,
      bot:           user.bot || false,
      createdAt:     user.createdAt?.toISOString() || null,
    };
    await redis.set(USER_KEY(userId), profile, config.redis.userTtl);
    return { data: profile, source: 'live' };
  } catch (e) {
    return { data: null, source: 'none' };
  }
}

function getClient() { return client; }

module.exports = { start, getPresence, getUser, getClient, PRESENCE_CHANNEL };