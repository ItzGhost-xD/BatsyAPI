/**
 * BatsyAPI — Discord Presence API
 * Developer : Venom
 * Team      : Veyron Labs
 * GitHub    : https://github.com/ItzGhost-xD/BatsyAPI
 * License   : MIT © 2024 Veyron Labs
 */

const { EmbedBuilder, Colors } = require('discord.js');
const config = require('../../config');

const API_URL = process.env.API_BASE_URL || 'https://api.yourdomain.com';

// ── Main help embed ───────────────────────────────────────────────────
function buildHelpEmbed(client) {
  const ping = client?.ws?.ping ?? '—';

  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setAuthor({
      name: 'BatsyAPI — Discord Presence API',
      iconURL: client?.user?.displayAvatarURL() || null,
    })
    .setTitle('👋 Hey! I\'m Batsy')
    .setDescription(
      'I track Discord presence in real-time — status, Spotify, games, rich presence, and more.\n' +
      'Built by **Venom** @ **Veyron Labs**.'
    )
    .addFields(
      {
        name: '🌐 Dashboard',
        value: `[Open Dashboard](${API_URL}) — live presence cards, WebSocket demo, docs`,
        inline: false,
      },
      {
        name: '📡 REST API',
        value: [
          `\`GET ${API_URL}/v1/users/:id\` — full presence`,
          `\`GET ${API_URL}/v1/users/:id/status\` — status only`,
          `\`GET ${API_URL}/v1/users/:id/presence\` — presence only`,
          `\`GET ${API_URL}/v1/users/:id/history\` — history`,
        ].join('\n'),
        inline: false,
      },
      {
        name: '🔌 WebSocket',
        value: `Connect to \`${API_URL.replace('https','wss').replace('http','ws')}/ws\`\nSend \`{"type":"SUBSCRIBE","userId":"YOUR_ID"}\` to get live updates`,
        inline: false,
      },
      {
        name: '📖 Docs',
        value: `[Swagger UI](${API_URL}/docs) — full interactive API reference`,
        inline: true,
      },
      {
        name: '💻 GitHub',
        value: '[ItzGhost-xD/BatsyAPI](https://github.com/ItzGhost-xD/BatsyAPI)',
        inline: true,
      },
      {
        name: '⚡ How to use',
        value: [
          '1. Get your Discord User ID (Settings → Advanced → Developer Mode → right-click yourself → Copy ID)',
          `2. Open \`${API_URL}/v1/users/YOUR_ID\` in a browser`,
          '3. You\'ll see a live presence card with your status, Spotify, games, and more',
          '4. Add `?format=json` to get raw JSON instead',
        ].join('\n'),
        inline: false,
      },
      {
        name: '🤖 Bot Status',
        value: [
          `**Ping:** ${ping}ms`,
          `**Guilds:** ${client?.guilds?.cache?.size ?? '—'}`,
          `**Mode:** ${config.discord.token ? 'Live Gateway' : 'Mock Mode'}`,
        ].join('\n'),
        inline: false,
      }
    )
    .setFooter({
      text: `BatsyAPI by Venom @ Veyron Labs • ${new Date().toLocaleString()}`,
    })
    .setTimestamp();
}

// ── Presence embed (shown when someone asks about a user) ─────────────
function buildPresenceEmbed(data, userId) {
  if (!data) {
    return new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle('User Not Found')
      .setDescription(`Could not find presence data for \`${userId}\`.\nMake sure the bot shares a server with that user.`);
  }

  const user   = data.user || {};
  const acts   = data.activities || {};
  const STATUS_COLORS = { online: 0x23a55a, idle: 0xf0b232, dnd: 0xf23f43, offline: 0x80848e, invisible: 0x80848e };
  const STATUS_EMOJI  = { online: '🟢', idle: '🟡', dnd: '🔴', offline: '⚫', invisible: '⚫' };
  const color  = STATUS_COLORS[data.status] || 0x80848e;
  const emoji  = STATUS_EMOJI[data.status]  || '⚫';

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`${emoji} ${user.displayName || user.username || userId}`)
    .setDescription(`**@${user.username || ''}** · ${data.status?.toUpperCase() || 'OFFLINE'}`)
    .setThumbnail(user.avatarUrl || null);

  if (user.bannerUrl) embed.setImage(user.bannerUrl);

  // Client status
  const cs = data.clientStatus || {};
  const platforms = Object.entries(cs)
    .filter(([, v]) => v && v !== 'offline')
    .map(([k, v]) => `${k}: ${v}`)
    .join(' · ');
  if (platforms) embed.addFields({ name: '📱 Platforms', value: platforms, inline: true });

  // Custom status
  if (acts.customStatus?.state) {
    embed.addFields({
      name: '💬 Custom Status',
      value: `${acts.customStatus.emoji?.name || ''} ${acts.customStatus.state}`.trim(),
      inline: true,
    });
  }

  // Spotify
  if (acts.spotify) {
    const sp = acts.spotify;
    embed.addFields({
      name: '🎵 Listening to Spotify',
      value: `**${sp.song}** by ${sp.artist}\n${sp.album ? `on *${sp.album}*` : ''}\n[Open Track](${sp.trackUrl || 'https://spotify.com'})`,
      inline: false,
    });
  }

  // Games
  (acts.games || []).forEach(g => {
    embed.addFields({
      name: '🎮 Playing',
      value: `**${g.name}**${g.details ? `\n${g.details}` : ''}${g.state ? `\n${g.state}` : ''}`,
      inline: true,
    });
  });

  // Streaming
  if (acts.streaming) {
    const st = acts.streaming;
    embed.addFields({
      name: '🔴 Live Streaming',
      value: `**${st.name}**${st.details ? `\n${st.details}` : ''}\n[Watch](${st.url || ''})`,
      inline: true,
    });
  }

  embed
    .addFields({
      name: '🔗 Live Card',
      value: `[View Full Presence Card](${API_URL}/v1/users/${userId})`,
      inline: false,
    })
    .setFooter({ text: `BatsyAPI by Venom @ Veyron Labs • Updated` })
    .setTimestamp(new Date(data.updatedAt || Date.now()));

  return embed;
}

// ── Register message listeners on the client ──────────────────────────
function registerBotCommands(client, getPresenceFn) {
  client.on('messageCreate', async (message) => {
    // Ignore bots
    if (message.author.bot) return;

    const content = message.content.trim();
    const botMention = `<@${client.user.id}>`;
    const botMentionNick = `<@!${client.user.id}>`;

    const isMentioned = content.startsWith(botMention) || content.startsWith(botMentionNick);
    if (!isMentioned) return;

    // Parse command after the mention
    const afterMention = content
      .replace(botMention, '')
      .replace(botMentionNick, '')
      .trim();

    const [cmd, ...args] = afterMention.split(/\s+/);

    // @Batsy  or  @Batsy help
    if (!cmd || cmd.toLowerCase() === 'help') {
      const embed = buildHelpEmbed(client);
      return message.reply({ embeds: [embed] });
    }

    // @Batsy presence <userId>
    if (cmd.toLowerCase() === 'presence' || cmd.toLowerCase() === 'p') {
      const userId = args[0];
      if (!userId || !/^\d{17,20}$/.test(userId)) {
        return message.reply('Please provide a valid Discord User ID.\nExample: `@Batsy presence 123456789012345678`');
      }
      try {
        await message.channel.sendTyping();
        const { data } = await getPresenceFn(userId);
        const embed = buildPresenceEmbed(data, userId);
        return message.reply({ embeds: [embed] });
      } catch (e) {
        return message.reply('Failed to fetch presence. Try again in a moment.');
      }
    }

    // @Batsy ping
    if (cmd.toLowerCase() === 'ping') {
      const ping = client.ws.ping;
      return message.reply(`🏓 Pong! Gateway latency: **${ping}ms**`);
    }

    // @Batsy stats
    if (cmd.toLowerCase() === 'stats') {
      try {
        const redis = require('./redis');
        const totalReqs = await redis.get('s0:stats:totalRequests') || 0;
        const embed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('📊 BatsyAPI Stats')
          .addFields(
            { name: 'Total API Requests', value: String(totalReqs || 0), inline: true },
            { name: 'Gateway Ping',        value: `${client.ws.ping}ms`,  inline: true },
            { name: 'Guilds',              value: String(client.guilds.cache.size), inline: true },
          )
          .setFooter({ text: 'BatsyAPI by Venom @ Veyron Labs' })
          .setTimestamp();
        return message.reply({ embeds: [embed] });
      } catch {
        return message.reply('Could not fetch stats right now.');
      }
    }

    // Unknown command — show mini help
    return message.reply(
      `I didn't understand that. Try:\n` +
      `• \`@Batsy help\` — show full help\n` +
      `• \`@Batsy presence <userId>\` — look up a user's presence\n` +
      `• \`@Batsy ping\` — check bot latency\n` +
      `• \`@Batsy stats\` — show API stats`
    );
  });
}

module.exports = { registerBotCommands, buildHelpEmbed, buildPresenceEmbed };
