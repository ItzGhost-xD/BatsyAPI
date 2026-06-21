/**
 * presenceParser.js
 * Converts raw Discord.js Presence objects into clean, structured data.
 * Handles: custom status, Spotify, rich presence, streaming, game, watching, competing.
 */

const ACTIVITY_TYPES = {
  0: 'game',
  1: 'streaming',
  2: 'listening',
  3: 'watching',
  4: 'custom',
  5: 'competing',
};

// ── CDN helpers ───────────────────────────────────────────────────────
const CDN = 'https://cdn.discordapp.com';

function avatarUrl(userId, hash, size = 256) {
  if (!hash) return `${CDN}/embed/avatars/${parseInt(userId) % 5}.png`;
  const fmt = hash.startsWith('a_') ? 'gif' : 'png';
  return `${CDN}/avatars/${userId}/${hash}.${fmt}?size=${size}`;
}

function bannerUrl(userId, hash) {
  if (!hash) return null;
  const fmt = hash.startsWith('a_') ? 'gif' : 'png';
  return `${CDN}/banners/${userId}/${hash}.${fmt}?size=600`;
}

function applicationIconUrl(appId, hash) {
  if (!appId || !hash) return null;
  return `${CDN}/app-icons/${appId}/${hash}.png?size=256`;
}

// ── Activity parsers ──────────────────────────────────────────────────

function parseCustomStatus(act) {
  return {
    type: 'custom',
    name: act.name,
    emoji: act.emoji
      ? {
          name: act.emoji.name,
          id: act.emoji.id,
          animated: act.emoji.animated,
          url: act.emoji.id
            ? `${CDN}/emojis/${act.emoji.id}.${act.emoji.animated ? 'gif' : 'png'}`
            : null,
        }
      : null,
    state: act.state || null,
    raw: act.name || act.state,
  };
}

function parseSpotify(act) {
  const albumArt = act.assets?.largeImageURL
    ? act.assets.largeImageURL({ size: 256 })
    : null;

  return {
    type: 'spotify',
    trackId: act.syncId,
    song: act.details,
    artist: act.state,
    album: act.assets?.largeText,
    albumArt,
    trackUrl: act.syncId ? `https://open.spotify.com/track/${act.syncId}` : null,
    duration: act.timestamps
      ? {
          start: act.timestamps.start?.getTime() || null,
          end: act.timestamps.end?.getTime() || null,
          durationMs: act.timestamps.end && act.timestamps.start
            ? act.timestamps.end - act.timestamps.start
            : null,
        }
      : null,
  };
}

function parseRichPresence(act) {
  return {
    type: 'rich_presence',
    name: act.name,
    applicationId: act.applicationId,
    details: act.details || null,
    state: act.state || null,
    largeImage: {
      key: act.assets?.largeImage || null,
      text: act.assets?.largeText || null,
      url: act.assets?.largeImageURL?.({ size: 256 }) || null,
    },
    smallImage: {
      key: act.assets?.smallImage || null,
      text: act.assets?.smallText || null,
      url: act.assets?.smallImageURL?.({ size: 64 }) || null,
    },
    timestamps: act.timestamps
      ? {
          start: act.timestamps.start?.getTime() || null,
          end: act.timestamps.end?.getTime() || null,
        }
      : null,
    party: act.party
      ? { id: act.party.id, size: act.party.size || null }
      : null,
    buttons: act.buttons || [],
    applicationIcon: applicationIconUrl(act.applicationId, null),
  };
}

function parseStreaming(act) {
  return {
    type: 'streaming',
    name: act.name,
    url: act.url,
    details: act.details || null,
    state: act.state || null,
    platform: act.url?.includes('twitch') ? 'twitch'
      : act.url?.includes('youtube') ? 'youtube'
      : 'unknown',
  };
}

function parseGenericActivity(act) {
  const typeName = ACTIVITY_TYPES[act.type] || 'unknown';
  return {
    type: typeName,
    name: act.name,
    details: act.details || null,
    state: act.state || null,
    timestamps: act.timestamps
      ? {
          start: act.timestamps.start?.getTime() || null,
          end: act.timestamps.end?.getTime() || null,
        }
      : null,
  };
}

// ── Main dispatcher ───────────────────────────────────────────────────

function parseActivity(act) {
  if (!act) return null;

  // Spotify detection: type 2 + party id starts with "spotify:"
  if (act.type === 2 && act.name === 'Spotify') return parseSpotify(act);

  switch (act.type) {
    case 4: return parseCustomStatus(act);
    case 1: return parseStreaming(act);
    case 0:
    case 3:
    case 5:
      // Rich presence = has assets or applicationId
      return act.applicationId ? parseRichPresence(act) : parseGenericActivity(act);
    default:
      return parseGenericActivity(act);
  }
}

// ── Top-level presence parser ─────────────────────────────────────────

function parsePresence(presence) {
  if (!presence) return null;

  const user = presence.user || presence.member?.user;
  const activities = [...(presence.activities || [])].map(parseActivity).filter(Boolean);

  // Split activities by type for easy access
  const customStatus = activities.find((a) => a.type === 'custom') || null;
  const spotify = activities.find((a) => a.type === 'spotify') || null;
  const games = activities.filter((a) => ['game', 'rich_presence'].includes(a.type));
  const streaming = activities.find((a) => a.type === 'streaming') || null;
  const watching = activities.find((a) => a.type === 'watching') || null;
  const competing = activities.find((a) => a.type === 'competing') || null;

  return {
    userId: user?.id || presence.userId,
    status: presence.status || 'offline',
    clientStatus: {
      desktop: presence.clientStatus?.desktop || null,
      mobile: presence.clientStatus?.mobile || null,
      web: presence.clientStatus?.web || null,
    },
    activities: {
      all: activities,
      customStatus,
      spotify,
      games,
      streaming,
      watching,
      competing,
    },
    user: user
      ? {
          id: user.id,
          username: user.username,
          displayName: user.displayName || user.globalName || user.username,
          discriminator: user.discriminator !== '0' ? user.discriminator : null,
          avatar: user.avatar,
          avatarUrl: avatarUrl(user.id, user.avatar),
          avatarDecorationUrl: user.avatarDecoration
            ? `${CDN}/avatar-decoration-presets/${user.avatarDecoration}.png`
            : null,
          banner: user.banner,
          bannerUrl: bannerUrl(user.id, user.banner),
          bannerColor: user.hexAccentColor || null,
          accentColor: user.accentColor || null,
          bot: user.bot || false,
          system: user.system || false,
          createdAt: user.createdAt?.toISOString() || null,
        }
      : null,
    guildId: presence.guild?.id || null,
    updatedAt: new Date().toISOString(),
  };
}

module.exports = { parsePresence, parseActivity, avatarUrl, bannerUrl };
