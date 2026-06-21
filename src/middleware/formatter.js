/**
 * responseFormatter.js
 *
 * Wraps presence data in a beautiful HTML card when the client
 * sends  Accept: text/html  (e.g. a browser), otherwise returns JSON.
 *
 * Usage:  res.presence(data, meta)
 */

const STATUS_COLORS = {
  online: '#23a55a',
  idle: '#f0b232',
  dnd: '#f23f43',
  offline: '#80848e',
  invisible: '#80848e',
};

const STATUS_LABELS = {
  online: 'Online',
  idle: 'Idle',
  dnd: 'Do Not Disturb',
  offline: 'Offline',
  invisible: 'Invisible',
};

function statusLabel(data) {
  const base = STATUS_LABELS[data.status] || 'Offline';
  if ((data.status === 'offline' || data.status === 'invisible') && data.stale) return base + ' (last seen)';
  if (data.offline) return 'Offline';
  return base;
}

function activityBadge(act) {
  if (!act) return '';
  switch (act.type) {
    case 'custom':
      return `
        <div class="activity custom">
          ${act.emoji ? `<img class="emoji" src="${act.emoji.url || ''}" alt="${act.emoji.name}" onerror="this.style.display='none'">` : ''}
          <span>${escHtml(act.state || act.name || '')}</span>
        </div>`;
    case 'spotify':
      return `
        <div class="activity spotify">
          <div class="sp-art-wrap">
            ${act.albumArt ? `<img class="sp-art" src="${act.albumArt}" alt="album art">` : '<div class="sp-art-placeholder">♪</div>'}
          </div>
          <div class="sp-info">
            <div class="sp-label">Listening to Spotify</div>
            <div class="sp-song">${escHtml(act.song || '')}</div>
            <div class="sp-artist">by ${escHtml(act.artist || '')}</div>
            <div class="sp-album">on ${escHtml(act.album || '')}</div>
          </div>
        </div>`;
    case 'rich_presence':
    case 'game':
      return `
        <div class="activity game">
          ${act.largeImage?.url ? `<img class="game-icon" src="${act.largeImage.url}" alt="${escHtml(act.name)}">` : '<div class="game-icon-placeholder">🎮</div>'}
          <div class="game-info">
            <div class="game-name">${escHtml(act.name || '')}</div>
            ${act.details ? `<div class="game-details">${escHtml(act.details)}</div>` : ''}
            ${act.state ? `<div class="game-state">${escHtml(act.state)}</div>` : ''}
          </div>
        </div>`;
    case 'streaming':
      return `
        <div class="activity streaming">
          <span class="stream-dot">🔴</span>
          <div>
            <div class="stream-label">Streaming</div>
            <div class="stream-name">${escHtml(act.name || '')}</div>
            ${act.url ? `<a class="stream-link" href="${escHtml(act.url)}" target="_blank">Watch Stream ↗</a>` : ''}
          </div>
        </div>`;
    default:
      return `<div class="activity generic"><span>${escHtml(act.name || act.type)}</span></div>`;
  }
}

function platformDots(clientStatus) {
  if (!clientStatus) return '';
  const platforms = [
    { key: 'desktop', icon: '🖥️', label: 'Desktop' },
    { key: 'mobile', icon: '📱', label: 'Mobile' },
    { key: 'web', icon: '🌐', label: 'Web' },
  ];
  return platforms
    .filter((p) => clientStatus[p.key] && clientStatus[p.key] !== 'offline')
    .map((p) => `<span class="platform-tag" title="${p.label}: ${clientStatus[p.key]}">${p.icon} ${clientStatus[p.key]}</span>`)
    .join('');
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderHtml(data, meta = {}) {
  if (!data) {
    return `<!DOCTYPE html><html><body><h2 style="font-family:sans-serif;color:#ccc;text-align:center;margin-top:100px">User not found or offline</h2></body></html>`;
  }

  const statusColor = STATUS_COLORS[data.status] || STATUS_COLORS.offline;
  const label = statusLabel(data);
  const user = data.user || {};
  const activities = data.activities?.all || [];
  const activitiesHtml = activities.map(activityBadge).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escHtml(user.displayName || user.username || 'User')} — Discord Presence</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      background: #111214;
      color: #dbdee1;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }

    .card {
      background: #1e1f22;
      border-radius: 16px;
      width: 100%;
      max-width: 440px;
      overflow: hidden;
      box-shadow: 0 8px 32px rgba(0,0,0,.5);
    }

    /* Banner */
    .banner {
      height: 96px;
      background: ${user.bannerColor ? user.bannerColor : 'linear-gradient(135deg, #5865f2, #7950f2)'};
      position: relative;
    }
    .banner img { width: 100%; height: 100%; object-fit: cover; }

    /* Avatar */
    .avatar-wrap {
      position: relative;
      display: inline-block;
      margin: -40px 0 0 16px;
    }
    .avatar {
      width: 80px; height: 80px;
      border-radius: 50%;
      border: 4px solid #1e1f22;
      background: #313338;
      display: block;
      object-fit: cover;
    }
    .status-dot {
      position: absolute;
      bottom: 4px; right: 4px;
      width: 18px; height: 18px;
      border-radius: 50%;
      background: ${statusColor};
      border: 3px solid #1e1f22;
    }

    /* User info */
    .user-info { padding: 8px 16px 0; }
    .display-name {
      font-size: 20px;
      font-weight: 700;
      color: #f2f3f5;
      line-height: 1.2;
    }
    .username {
      font-size: 13px;
      color: #b5bac1;
      margin-top: 2px;
    }
    .status-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 6px;
      flex-wrap: wrap;
    }
    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
      background: ${statusColor}22;
      color: ${statusColor};
      border: 1px solid ${statusColor}44;
    }
    .status-pill::before {
      content: '';
      width: 7px; height: 7px;
      border-radius: 50%;
      background: ${statusColor};
    }
    .platform-tag {
      font-size: 11px;
      background: #2b2d31;
      padding: 2px 8px;
      border-radius: 999px;
      color: #b5bac1;
    }

    /* Divider */
    .divider { height: 1px; background: #2b2d31; margin: 14px 16px; }

    /* Activities */
    .section-label {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: .06em;
      text-transform: uppercase;
      color: #b5bac1;
      padding: 0 16px;
      margin-bottom: 8px;
    }
    .activities { padding: 0 16px 16px; display: flex; flex-direction: column; gap: 8px; }

    .activity {
      background: #2b2d31;
      border-radius: 10px;
      padding: 10px 12px;
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 13px;
    }

    /* Custom status */
    .activity.custom { background: transparent; padding: 0 16px 4px; gap: 6px; color: #b5bac1; }
    .emoji { width: 18px; height: 18px; object-fit: contain; }

    /* Spotify */
    .activity.spotify { align-items: flex-start; }
    .sp-art-wrap { flex-shrink: 0; }
    .sp-art { width: 52px; height: 52px; border-radius: 6px; object-fit: cover; }
    .sp-art-placeholder { width: 52px; height: 52px; border-radius: 6px; background: #1db954; display: flex; align-items: center; justify-content: center; font-size: 22px; color: #fff; }
    .sp-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .sp-label { font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: #1db954; }
    .sp-song { font-weight: 700; color: #f2f3f5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sp-artist, .sp-album { font-size: 12px; color: #b5bac1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    /* Game */
    .activity.game { align-items: flex-start; }
    .game-icon { width: 52px; height: 52px; border-radius: 6px; object-fit: cover; flex-shrink: 0; }
    .game-icon-placeholder { width: 52px; height: 52px; border-radius: 6px; background: #2b2d31; display: flex; align-items: center; justify-content: center; font-size: 22px; border: 1px solid #404249; }
    .game-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .game-name { font-weight: 700; color: #f2f3f5; }
    .game-details, .game-state { font-size: 12px; color: #b5bac1; }

    /* Streaming */
    .activity.streaming { background: #ff000011; border: 1px solid #ff000033; }
    .stream-dot { font-size: 10px; }
    .stream-label { font-size: 10px; font-weight: 700; text-transform: uppercase; color: #ff4444; letter-spacing:.06em; }
    .stream-name { font-weight: 600; color: #f2f3f5; }
    .stream-link { font-size: 12px; color: #5865f2; text-decoration: none; }
    .stream-link:hover { text-decoration: underline; }

    .generic { color: #b5bac1; }

    /* Footer */
    .card-footer {
      background: #232428;
      padding: 8px 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11px;
      color: #6d6f78;
    }
    .json-link {
      color: #5865f2;
      text-decoration: none;
      font-weight: 600;
    }
    .json-link:hover { text-decoration: underline; }

    .no-activities {
      padding: 0 16px 16px;
      font-size: 13px;
      color: #6d6f78;
      font-style: italic;
    }
  </style>
</head>
<body>
<div class="card">

  <!-- Banner -->
  <div class="banner">
    ${user.bannerUrl ? `<img src="${escHtml(user.bannerUrl)}" alt="banner" onerror="this.remove()">` : ''}
  </div>

  <!-- Avatar + status dot -->
  <div class="avatar-wrap">
    <img class="avatar" src="${escHtml(user.avatarUrl || '')}" alt="avatar" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'">
    <div class="status-dot" title="${label}"></div>
  </div>

  <!-- Stale/offline notice -->
  ${data.stale ? `<div style="background:#f0b23222;border-bottom:1px solid #f0b23244;padding:6px 16px;font-size:12px;color:#f0b232;">⏱ Last known status — user may have gone offline or invisible</div>` : ''}
  ${data.offline && !data.stale ? `<div style="background:#80848e22;border-bottom:1px solid #80848e44;padding:6px 16px;font-size:12px;color:#80848e;">● This user is currently offline or invisible</div>` : ''}

  <!-- User Info -->
  <div class="user-info">
    <div class="display-name">${escHtml(user.displayName || user.username || 'Unknown User')}</div>
    <div class="username">@${escHtml(user.username || '')}${user.discriminator ? '#' + user.discriminator : ''}</div>
    <div class="status-row">
      <span class="status-pill">${label}</span>
      ${platformDots(data.clientStatus)}
    </div>
  </div>

  ${activitiesHtml ? `
  <div class="divider"></div>
  <div class="section-label">Activities</div>
  <div class="activities">${activitiesHtml}</div>
  ` : `
  <div class="divider"></div>
  <div class="no-activities">No active sessions</div>
  `}

  <!-- Footer -->
  <div class="card-footer">
    <span>Updated ${new Date(data.updatedAt || Date.now()).toLocaleTimeString()}</span>
    <span>${meta.source === 'cache' ? '⚡ cached' : '🔴 live'}</span>
    <a class="json-link" href="?format=json">View JSON ↗</a>
  </div>
</div>
</body>
</html>`;
}

/**
 * Express middleware that adds res.presence(data, meta) helper.
 * Checks ?format=json or Accept header to decide HTML vs JSON.
 */
function presenceFormatter(req, res, next) {
  res.presence = function (data, meta = {}) {
    const wantsJson =
      req.query.format === 'json' ||
      (req.headers.accept || '').includes('application/json') ||
      (req.headers.accept || '') === '*/*' && !req.headers['user-agent']?.includes('Mozilla');

    if (wantsJson) {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('X-Cache', meta.source === 'cache' ? 'HIT' : 'MISS');
      return res.json({ ok: true, data, meta });
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('X-Cache', meta.source === 'cache' ? 'HIT' : 'MISS');
    return res.send(renderHtml(data, meta));
  };

  next();
}

module.exports = { presenceFormatter };
