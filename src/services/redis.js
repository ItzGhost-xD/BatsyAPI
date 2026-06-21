const { createClient } = require('redis');
const config = require('../../config');
const logger = require('../utils/logger');

let client = null;
let pubClient = null;  // dedicated publish client

function makeClient() {
  return createClient({
    url: config.redis.url,
    password: config.redis.password || undefined,
    socket: { reconnectStrategy: (retries) => Math.min(retries * 100, 3000) },
  });
}

async function connect() {
  if (client) return client;

  client = makeClient();
  client.on('error',       (e) => logger.error('Redis error',       { err: e.message }));
  client.on('reconnecting',()  => logger.warn('Redis reconnecting...'));
  client.on('ready',       ()  => logger.info('Redis connected'));
  await client.connect();

  // Persistent publish client (avoids per-call connect overhead)
  pubClient = makeClient();
  pubClient.on('error', (e) => logger.debug('Redis pub error', { err: e.message }));
  await pubClient.connect();

  return client;
}

async function get(key) {
  try {
    const val = await client.get(key);
    return val ? JSON.parse(val) : null;
  } catch (e) {
    logger.error('Redis GET failed', { key, err: e.message });
    return null;
  }
}

async function set(key, value, ttl = config.redis.ttl) {
  try {
    await client.setEx(key, ttl, JSON.stringify(value));
  } catch (e) {
    logger.error('Redis SET failed', { key, err: e.message });
  }
}

async function del(key) {
  try { await client.del(key); } catch (_) {}
}

// Uses the persistent pubClient — no per-call connect
async function publish(channel, message) {
  try {
    await pubClient.publish(channel, JSON.stringify(message));
  } catch (e) {
    logger.error('Redis PUBLISH failed', { err: e.message });
  }
}

// Creates a fresh subscriber client (subscribe mode is exclusive)
async function subscribe(channel, callback) {
  const sub = makeClient();
  sub.on('error', (e) => logger.debug('Redis sub error', { err: e.message }));
  await sub.connect();
  await sub.subscribe(channel, (msg) => {
    try { callback(JSON.parse(msg)); } catch (_) {}
  });
  return sub;
}

async function incr(key, ttl) {
  const val = await client.incr(key);
  if (val === 1 && ttl) await client.expire(key, ttl);
  return val;
}

// Sharded key helper
function shardKey(base) {
  const shard = config.discord.shardId % Math.max(config.discord.shardCount, 1);
  return `s${shard}:${base}`;
}

module.exports = { connect, get, set, del, publish, subscribe, incr, shardKey };
