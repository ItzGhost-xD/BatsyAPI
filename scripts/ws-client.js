#!/usr/bin/env node
/**
 * scripts/ws-client.js
 *
 * Interactive WebSocket test client.
 * Usage:
 *   node scripts/ws-client.js [userId]
 *   node scripts/ws-client.js 111111111111111111  (mock user)
 */

const WebSocket = require('ws');
const readline = require('readline');

const HOST = process.env.API_HOST || 'ws://localhost:3000';
const userId = process.argv[2] || '111111111111111111';

const ws = new WebSocket(`${HOST}/ws`);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function pretty(obj) {
  return JSON.stringify(obj, null, 2);
}

function colorStatus(status) {
  const colors = { online: '\x1b[32m', idle: '\x1b[33m', dnd: '\x1b[31m', offline: '\x1b[90m' };
  return (colors[status] || '') + status + '\x1b[0m';
}

ws.on('open', () => {
  console.log('\x1b[36m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m');
  console.log('\x1b[1mDiscord Presence WebSocket Test Client\x1b[0m');
  console.log('\x1b[36m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m');
  console.log(`Connected to ${HOST}/ws\n`);
  console.log('Commands:');
  console.log('  sub <userId>    — subscribe to a user');
  console.log('  unsub <userId>  — unsubscribe');
  console.log('  fetch <userId>  — one-shot fetch');
  console.log('  ping            — ping server');
  console.log('  quit            — exit\n');
});

ws.on('message', (raw) => {
  try {
    const msg = JSON.parse(raw);
    const ts = new Date().toLocaleTimeString();

    switch (msg.type) {
      case 'HELLO':
        console.log(`\x1b[32m[${ts}] 👋 HELLO\x1b[0m — session: ${msg.sessionId}`);
        // Auto-subscribe to the passed userId
        const sub = { type: 'SUBSCRIBE', userId };
        ws.send(JSON.stringify(sub));
        console.log(`\x1b[90m→ Auto-subscribing to ${userId}\x1b[0m\n`);
        break;

      case 'SUBSCRIBED':
        console.log(`\x1b[32m[${ts}] ✅ SUBSCRIBED\x1b[0m — ${msg.userId}`);
        if (msg.current) {
          const d = msg.current;
          console.log(`   Status: ${colorStatus(d.status)}`);
          if (d.clientStatus) {
            const plat = Object.entries(d.clientStatus)
              .filter(([, v]) => v)
              .map(([k, v]) => `${k}:${v}`)
              .join(' | ');
            if (plat) console.log(`   Platforms: ${plat}`);
          }
          if (d.activities?.customStatus) console.log(`   Custom: ${d.activities.customStatus.state}`);
          if (d.activities?.spotify) console.log(`   Spotify: ${d.activities.spotify.song} — ${d.activities.spotify.artist}`);
          if (d.activities?.games?.length) console.log(`   Playing: ${d.activities.games[0].name}`);
        }
        console.log();
        break;

      case 'PRESENCE_UPDATE':
        console.log(`\x1b[33m[${ts}] 🔔 PRESENCE_UPDATE\x1b[0m — ${msg.userId}`);
        if (msg.data) {
          const d = msg.data;
          console.log(`   Status: ${colorStatus(d.status)}`);
          if (d.activities?.customStatus) console.log(`   Custom: ${d.activities.customStatus.state}`);
          if (d.activities?.spotify) console.log(`   Spotify: ${d.activities.spotify.song}`);
          if (d.activities?.streaming) console.log(`   \x1b[31m🔴 LIVE\x1b[0m: ${d.activities.streaming.name}`);
        }
        console.log();
        break;

      case 'FETCH_RESULT':
        console.log(`\x1b[36m[${ts}] 📦 FETCH_RESULT\x1b[0m — ${msg.userId} (${msg.source})`);
        console.log(`   Status: ${colorStatus(msg.data?.status)}\n`);
        break;

      case 'UNSUBSCRIBED':
        console.log(`\x1b[90m[${ts}] UNSUBSCRIBED — ${msg.userId}\x1b[0m\n`);
        break;

      case 'PONG':
        console.log(`\x1b[90m[${ts}] PONG — latency: ${Date.now() - msg.ts}ms\x1b[0m\n`);
        break;

      case 'ERROR':
        console.log(`\x1b[31m[${ts}] ❌ ERROR ${msg.code}\x1b[0m — ${msg.message}\n`);
        break;

      default:
        console.log(`[${ts}] ${msg.type}`, pretty(msg));
    }
  } catch (e) {
    console.log('Raw:', raw.toString());
  }
});

ws.on('close', () => {
  console.log('\x1b[90mConnection closed.\x1b[0m');
  process.exit(0);
});

ws.on('error', (e) => {
  console.error('\x1b[31mWS Error:\x1b[0m', e.message);
  process.exit(1);
});

// Simple interactive prompt
rl.on('line', (line) => {
  const [cmd, arg] = line.trim().split(/\s+/);
  switch (cmd) {
    case 'sub':
      ws.send(JSON.stringify({ type: 'SUBSCRIBE', userId: arg }));
      break;
    case 'unsub':
      ws.send(JSON.stringify({ type: 'UNSUBSCRIBE', userId: arg }));
      break;
    case 'fetch':
      ws.send(JSON.stringify({ type: 'FETCH', userId: arg }));
      break;
    case 'ping':
      ws.send(JSON.stringify({ type: 'PING', ts: Date.now() }));
      break;
    case 'quit':
    case 'exit':
      ws.close();
      break;
    default:
      if (cmd) console.log('Unknown command. Try: sub, unsub, fetch, ping, quit');
  }
});
