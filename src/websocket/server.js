const { WebSocketServer, WebSocket } = require('ws');
const { v4: uuidv4 } = require('uuid');
const redis = require('../services/redis');
const discord = require('../services');
const config = require('../../config');
const logger = require('../utils/logger');

// Track subs: Map<userId, Set<ws>>
const subscriptions = new Map();
// Track per-IP connection count for WS rate limiting
const ipConnections = new Map();

function ipOf(req) {
  return req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
}

function send(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function subscribe(userId, ws) {
  if (!subscriptions.has(userId)) subscriptions.set(userId, new Set());
  subscriptions.get(userId).add(ws);
}

function unsubscribe(userId, ws) {
  subscriptions.get(userId)?.delete(ws);
  if (subscriptions.get(userId)?.size === 0) subscriptions.delete(userId);
}

function unsubscribeAll(ws) {
  for (const [userId, clients] of subscriptions) {
    clients.delete(ws);
    if (clients.size === 0) subscriptions.delete(userId);
  }
}

// Redis pub/sub listener — fans out to all WS clients watching that userId
async function startPresenceFan() {
  const sub = await redis.subscribe(discord.PRESENCE_CHANNEL, (msg) => {
    if (msg.type !== 'PRESENCE_UPDATE') return;
    const { userId, data } = msg;
    const clients = subscriptions.get(userId);
    if (!clients?.size) return;

    const payload = { type: 'PRESENCE_UPDATE', userId, data, ts: Date.now() };
    for (const ws of clients) {
      send(ws, payload);
    }
    logger.debug(`WS fan-out: ${clients.size} client(s) for ${userId}`);
  });

  logger.info('WebSocket Redis fan-out active');
  return sub;
}

// ── Message handlers ──────────────────────────────────────────────────

async function handleMessage(ws, raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return send(ws, { type: 'ERROR', code: 4000, message: 'Invalid JSON' });
  }

  const { type, userId, userIds } = msg;

  switch (type) {
    // Subscribe to a single user
    case 'SUBSCRIBE': {
      if (!userId || !/^\d{17,20}$/.test(userId)) {
        return send(ws, { type: 'ERROR', code: 4001, message: 'Invalid userId' });
      }

      // Cap subscriptions per connection
      if (ws.subscriptions.size >= 25) {
        return send(ws, { type: 'ERROR', code: 4003, message: 'Subscription limit reached (25)' });
      }

      subscribe(userId, ws);
      ws.subscriptions.add(userId);

      // Send current presence immediately so the client isn't blind on connect
      const { data, source } = await discord.getPresence(userId);
      send(ws, { type: 'SUBSCRIBED', userId, current: data, source });
      break;
    }

    // Bulk subscribe (up to 10 at once)
    case 'SUBSCRIBE_BULK': {
      const ids = (userIds || []).filter((id) => /^\d{17,20}$/.test(id)).slice(0, 10);
      for (const id of ids) {
        subscribe(id, ws);
        ws.subscriptions.add(id);
      }
      const snapshots = await Promise.all(ids.map((id) => discord.getPresence(id)));
      send(ws, {
        type: 'SUBSCRIBED_BULK',
        userIds: ids,
        current: Object.fromEntries(ids.map((id, i) => [id, snapshots[i].data])),
      });
      break;
    }

    case 'UNSUBSCRIBE': {
      if (!userId) return;
      unsubscribe(userId, ws);
      ws.subscriptions.delete(userId);
      send(ws, { type: 'UNSUBSCRIBED', userId });
      break;
    }

    case 'PING':
      send(ws, { type: 'PONG', ts: Date.now() });
      break;

    // Ask for a presence snapshot without subscribing
    case 'FETCH': {
      if (!userId || !/^\d{17,20}$/.test(userId)) {
        return send(ws, { type: 'ERROR', code: 4001, message: 'Invalid userId' });
      }
      const { data, source } = await discord.getPresence(userId);
      send(ws, { type: 'FETCH_RESULT', userId, data, source, ts: Date.now() });
      break;
    }

    default:
      send(ws, { type: 'ERROR', code: 4002, message: `Unknown message type: ${type}` });
  }
}

// ── Server bootstrap ──────────────────────────────────────────────────

function createWsServer(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  // Kick off Redis fan-out
  startPresenceFan().catch((e) =>
    logger.error('Failed to start WS Redis fan-out', { err: e.message })
  );

  // Heartbeat: drop dead connections every 30s
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30_000);

  wss.on('close', () => clearInterval(heartbeat));

  wss.on('connection', (ws, req) => {
    const ip = ipOf(req);
    const connCount = (ipConnections.get(ip) || 0) + 1;

    // IP-level WS rate limit
    if (connCount > config.rateLimit.wsMax) {
      send(ws, { type: 'ERROR', code: 4429, message: 'Too many connections from your IP' });
      ws.close();
      return;
    }

    ipConnections.set(ip, connCount);
    ws.id = uuidv4();
    ws.isAlive = true;
    ws.subscriptions = new Set(); // userId strings this socket watches
    ws.connectedAt = Date.now();

    logger.info('WS connected', { id: ws.id, ip });

    send(ws, {
      type: 'HELLO',
      message: 'Discord Presence WebSocket v1',
      sessionId: ws.id,
      docs: 'https://github.com/your-org/discord-presence-api#websocket',
    });

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (raw) => handleMessage(ws, raw));

    ws.on('close', () => {
      unsubscribeAll(ws);
      const count = Math.max((ipConnections.get(ip) || 1) - 1, 0);
      if (count === 0) ipConnections.delete(ip);
      else ipConnections.set(ip, count);
      logger.info('WS disconnected', { id: ws.id, subs: ws.subscriptions.size });
    });

    ws.on('error', (e) => logger.error('WS error', { id: ws.id, err: e.message }));
  });

  logger.info('WebSocket server running on /ws');
  return wss;
}

// Stats endpoint helper
function wsStats() {
  return {
    activeConnections: [...require('ws').WebSocketServer?.prototype?.clients?.size ?? 0],
    trackedUsers: subscriptions.size,
    subscriptions: [...subscriptions.entries()].map(([userId, clients]) => ({
      userId,
      clients: clients.size,
    })),
  };
}

module.exports = { createWsServer, wsStats };
