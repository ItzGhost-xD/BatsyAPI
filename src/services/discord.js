const { Client, GatewayIntentBits, Partials } = require('discord.js');
const config = require('../../config');
const logger = require('../utils/logger');
const redis  = require('./redis');
const { parsePresence, avatarUrl, bannerUrl } = require('./presenceParser');
const { PresenceSnapshot } = require('../models');

let client = null;

const PRESENCE_KEY      = (id) => redis.shardKey(`presence:${id}`);
const PRESENCE_LAST_KEY = (id) => redis.shardKey(`presence:last:${id}`);
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
    shards:     config.discord.shardId,
    shardCount: config.discord.shardCount,
  });

  client.on('ready', () => {
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

// ── Safely fetch full user via REST (includes banner, accentColor) ────

async function fetchFullUser(userId) {
  try {
    return await client.users.fetch(userId, { force: true });
  } catch (e) {
    logger.debug('fetchFullUser failed', { userId, err: e.message });
    return null;
  }
}

// ── Build a plain profile object — no discord.js methods, pure data ───
// We use our own CDN helpers from presenceParser instead of calling
// user.bannerURL() / user.displayAvatarURL() so there are no method errors.

function buildUserProfile(user) {
  if (!user) return null;

  const CDN = 'https://cdn.discordapp.com';

  // Avatar URL — handles animated avatars
  const avatarHash = user.avatar || null;
  const builtAvatarUrl = avatarHash
    ? `${CDN}/avatars/${user.id}/${avatarHash}.${avatarHash.startsWith('a_') ? 'gif' : 'png'}?size=256`
    : `${CDN}/embed/avatars/${Number(BigInt(user.id) >> 22n) % 6}.png`;

  // Banner URL — only present if user has a banner set
  const bannerHash = user.banner || null;
  const builtBannerUrl = bannerHash
    ? `${CDN}/banners/${user.id}/${bannerHash}.${bannerHash.startsWith('a_') ? 'gif' : 'png'}?size=600`
    : null;

  // Accent / banner color — hex string like "#5865f2"
  const builtBannerColor = user.hexAccentColor || null;

  return {
    id:            user.id,
    username:      user.username,
    displayName:   user.globalName || user.displayName || user.username,
    discriminator: user.discriminator && user.discriminator !== '0' ? user.discriminator : null,
    avatar:        avatarHash,
    avatarUrl:     builtAvatarUrl,
    banner:        bannerHash,
    bannerUrl:     builtBannerUrl,
    bannerColor:   builtBannerColor,
    accentColor:   user.accentColor || null,
    bot:           user.bot  || false,
    createdAt:     user.createdAt?.toISOString() || null,
  };
}

// ── Presence update handler ───────────────────────────────────────────

async function handlePresenceUpdate(oldPresence, newPresence) {
  if (!newPresence?.userId) return;

  try {
    const parsed = parsePresence(newPresence);

    // Enrich user profile with REST fetch so banner is always included
    const fullUser = await fetchFullUser(parsed.userId);
    if (fullUser) parsed.user = buildUserProfile(fullUser);

    await redis.set(PRESENCE_KEY(parsed.userId), parsed, config.redis.ttl);
    await redis.set(PRESENCE_LAST_KEY(parsed.userId), parsed, 60 * 60 * 24 * 7);
    if (parsed.user) await redis.set(USER_KEY(parsed.userId), parsed.user, config.redis.userTtl);

    PresenceSnapshot.create({
      userId:       parsed.userId,
      guildId:      parsed.guildId,
      status:       parsed.status,
      clientStatus: parsed.clientStatus,
      activities:   parsed.activities.all,
    }).catch((e) => logger.error('Analytics write failed', { err: e.message }));

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

// ── Build offline presence ────────────────────────────────────────────

function buildOfflinePresence(userId, fullUser, guildId) {
  return {
    userId,
    status:       'offline',
    clientStatus: { desktop: null, mobile: null, web: null },
    activities:   {
      all: [], customStatus: null, spotify: null,
      games: [], streaming: null, watching: null, competing: null,
    },
    user:      buildUserProfile(fullUser),
    guildId:   guildId || null,
    updatedAt: new Date().toISOString(),
    offline:   true,
  };
}

// ── Public helpers ────────────────────────────────────────────────────

async function getPresence(userId) {
  // 1. Redis hot cache
  const cached = await redis.get(PRESENCE_KEY(userId));
  if (cached) return { data: cached, source: 'cache' };

  if (!client) return { data: null, source: 'none' };

  // 2. Live fetch
  for (const guild of client.guilds.cache.values()) {
    try {
      const member = await guild.members.fetch({ user: userId, force: true }).catch(() => null);
      if (!member) continue;

      // Always do a REST fetch for the full user object (includes banner)
      const fullUser = await fetchFullUser(userId);
      const presence = member.presence;

      if (presence && presence.status !== 'offline') {
        const parsed = parsePresence(presence);
        if (fullUser) parsed.user = buildUserProfile(fullUser);

        await redis.set(PRESENCE_KEY(parsed.userId), parsed, config.redis.ttl);
        await redis.set(PRESENCE_LAST_KEY(parsed.userId), parsed, 60 * 60 * 24 * 7);
        if (parsed.user) await redis.set(USER_KEY(parsed.userId), parsed.user, config.redis.userTtl);

        return { data: parsed, source: 'live' };
      }

      // Offline / invisible
      const lastKnown   = await redis.get(PRESENCE_LAST_KEY(userId));
      const offlineData = buildOfflinePresence(userId, fullUser, guild.id);

      // Prefer last-known user profile if it has a banner and current fetch doesn't
      if (lastKnown?.user?.banner && !offlineData.user?.banner) {
        offlineData.user = lastKnown.user;
      }

      await redis.set(PRESENCE_KEY(userId), offlineData, 30);
      if (offlineData.user) await redis.set(USER_KEY(userId), offlineData.user, config.redis.userTtl);

      return { data: offlineData, source: 'live' };

    } catch (e) {
      logger.error('getPresence error', { guild: guild.id, err: e.message, stack: e.stack });
    }
  }

  // 3. Not in any shared guild — serve stale last-known
  const lastKnown = await redis.get(PRESENCE_LAST_KEY(userId));
  if (lastKnown) {
    return {
      data:   { ...lastKnown, status: 'offline', stale: true },
      source: 'stale_cache',
    };
  }

  return { data: null, source: 'none' };
}

async function getUser(userId) {
  const cached = await redis.get(USER_KEY(userId));
  if (cached) return { data: cached, source: 'cache' };

  if (!client) return { data: null, source: 'none' };

  const fullUser = await fetchFullUser(userId);
  if (!fullUser) return { data: null, source: 'none' };

  const profile = buildUserProfile(fullUser);
  await redis.set(USER_KEY(userId), profile, config.redis.userTtl);
  return { data: profile, source: 'live' };
}

function getClient() { return client; }

module.exports = { start, getPresence, getUser, getClient, PRESENCE_CHANNEL };