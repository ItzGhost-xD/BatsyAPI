<div align="center">

# Batsy - Discord Presence API

**Production-grade REST + WebSocket API for real-time Discord presence data**

[![Node.js](https://img.shields.io/badge/Node.js-20+-green?logo=node.js)](https://nodejs.org)
[![Redis](https://img.shields.io/badge/Redis-7-red?logo=redis)](https://redis.io)
[![MongoDB](https://img.shields.io/badge/MongoDB-7-green?logo=mongodb)](https://mongodb.com)
[![Docker](https://img.shields.io/badge/Docker-ready-blue?logo=docker)](https://docker.com)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Status badges · Online/Idle/DND/Offline · Spotify · Rich Presence · Games · Custom Status · Platform detection · Redis cache · WebSocket subscriptions · Swagger docs · HTML cards

</div>

---

## ✨ Features

| Feature | Details |
|---|---|
| **Presence** | Online / Idle / DND / Offline / Invisible |
| **Platform detection** | Desktop, Mobile, Web per-status |
| **Activities** | Spotify, Rich Presence, games, streaming, watching, competing, custom status |
| **Response formats** | Beautiful HTML card (browser) **or** JSON (`?format=json`) |
| **Cache** | Redis shared cache · ETag · Cache-Control · stale-while-revalidate |
| **Analytics** | MongoDB snapshots, 30-day rolling history, trend queries |
| **WebSocket** | Real-time subscriptions, Redis pub/sub fan-out across shards |
| **Rate limiting** | Per-IP REST limits + WS connection cap |
| **Sharding** | Horizontal scaling via `SHARD_ID` / `SHARD_COUNT` |
| **Docs** | Swagger UI at `/docs` + interactive demo at `/` |
| **Mock mode** | Works without a real Discord token for dev/testing |

---

##  Quick Start

### Option A — Docker (recommended)

```bash
git clone https://github.com/YOUR_USERNAME/discord-presence-api.git
cd discord-presence-api

cp .env.example .env
# Edit .env — set DISCORD_BOT_TOKEN at minimum

docker compose up
```

Open **http://localhost:3000** — interactive demo page.  
Open **http://localhost:3000/docs** — Swagger UI.

### Option B — Local Node.js

```bash
git clone https://github.com/YOUR_USERNAME/discord-presence-api.git
cd discord-presence-api

npm install
cp .env.example .env
# Edit .env

# Requires Redis running locally
redis-server --daemonize yes

npm start
```

---

## Discord Bot Setup

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications) → **New Application**
2. **Bot** tab → **Add Bot** → copy the token
3. Paste it as `DISCORD_BOT_TOKEN` in your `.env`
4. Under **Privileged Gateway Intents**, enable:
   -  **Server Members Intent**
   -  **Presence Intent**
5. Invite URL: `https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&scope=bot&permissions=0`
6. The bot only needs to **share a guild** with users you want to track — no special permissions needed

> **No token?** The API starts in **mock mode** automatically with 3 demo users.

---

##  REST API

**Base URL:** `/v1`

| Method | Endpoint | Description | Cache |
|---|---|---|---|
| `GET` | `/v1/users/:id` | Full profile + presence (HTML or JSON) | 60s ETag |
| `GET` | `/v1/users/:id/presence` | Presence data only | 30s ETag |
| `GET` | `/v1/users/:id/status` | Status string only — ultra-light | 15s ETag |
| `GET` | `/v1/users/:id/history` | Historical snapshots (MongoDB) | no-store |
| `GET` | `/v1/analytics/overview` | 24h API + presence stats | — |
| `GET` | `/v1/analytics/status-over-time/:id` | Status trends for a user | — |
| `GET` | `/health` | Redis / MongoDB / Discord health | no-store |

### Response format

```bash
# HTML presence card (default for browsers)
curl http://localhost:3000/v1/users/111111111111111111

# JSON (add header or query param)
curl http://localhost:3000/v1/users/111111111111111111?format=json
curl -H "Accept: application/json" http://localhost:3000/v1/users/111111111111111111
```

### Cache headers on every response

```
ETag: "a1b2c3d4e5f6g7h8"
Cache-Control: public, max-age=60, stale-while-revalidate=60
Vary: Accept-Encoding, Accept
X-Cache: HIT | MISS
```

### Presence data shape

```jsonc
{
  "ok": true,
  "data": {
    "userId": "111111111111111111",
    "status": "online",             // online | idle | dnd | offline | invisible
    "clientStatus": {
      "desktop": "online",
      "mobile": null,
      "web": "dnd"
    },
    "activities": {
      "all": [...],
      "customStatus": {
        "type": "custom",
        "state": "shipping code 🚀",
        "emoji": { "name": "🚀", "id": null, "animated": false, "url": null }
      },
      "spotify": {
        "type": "spotify",
        "song": "Blinding Lights",
        "artist": "The Weeknd",
        "album": "After Hours",
        "albumArt": "https://i.scdn.co/...",
        "trackUrl": "https://open.spotify.com/track/...",
        "duration": { "start": 1700000000000, "end": 1700000220000, "durationMs": 220000 }
      },
      "games": [{
        "type": "rich_presence",
        "name": "Visual Studio Code",
        "details": "Editing index.js",
        "state": "Workspace: my-project",
        "largeImage": { "url": "https://...", "text": "VS Code" },
        "timestamps": { "start": 1700000000000, "end": null }
      }],
      "streaming": null,
      "watching": null,
      "competing": null
    },
    "user": {
      "id": "111111111111111111",
      "username": "alice",
      "displayName": "Alice 🌸",
      "avatarUrl": "https://cdn.discordapp.com/avatars/...",
      "bannerUrl": null,
      "bannerColor": "#5865f2",
      "bot": false,
      "createdAt": "2019-04-01T00:00:00.000Z"
    },
    "updatedAt": "2024-01-01T12:00:00.000Z"
  },
  "meta": { "source": "cache" }
}
```

---

## 🔌 WebSocket

Connect to `ws://localhost:3000/ws`

### Messages you send

```jsonc
// Subscribe to a user — receive all future updates
{ "type": "SUBSCRIBE", "userId": "111111111111111111" }

// Bulk subscribe (up to 10)
{ "type": "SUBSCRIBE_BULK", "userIds": ["111...", "222..."] }

// Unsubscribe
{ "type": "UNSUBSCRIBE", "userId": "111111111111111111" }

// One-shot fetch (no subscription)
{ "type": "FETCH", "userId": "111111111111111111" }

// Keepalive
{ "type": "PING" }
```

### Messages you receive

```jsonc
{ "type": "HELLO",          "sessionId": "uuid",  "message": "Discord Presence WebSocket v1" }
{ "type": "SUBSCRIBED",     "userId": "...",       "current": { ...presenceData }, "source": "cache" }
{ "type": "PRESENCE_UPDATE","userId": "...",       "data": { ...presenceData }, "ts": 1700000000000 }
{ "type": "PONG",           "ts": 1700000000000 }
{ "type": "ERROR",          "code": 4001,         "message": "Invalid userId" }
```

### Browser example

```javascript
const ws = new WebSocket('ws://localhost:3000/ws');

ws.onmessage = ({ data }) => {
  const msg = JSON.parse(data);

  if (msg.type === 'HELLO') {
    ws.send(JSON.stringify({ type: 'SUBSCRIBE', userId: '111111111111111111' }));
  }

  if (msg.type === 'PRESENCE_UPDATE') {
    console.log('Status:', msg.data.status);
    console.log('Spotify:', msg.data.activities.spotify?.song);
  }
};
```

### CLI test client

```bash
node scripts/ws-client.js 111111111111111111
```

---

##  Configuration

Copy `.env.example` to `.env` and fill in:

| Variable | Default | Description |
|---|---|---|
| `DISCORD_BOT_TOKEN` | — | **Required for live data.** From Discord Developer Portal |
| `PORT` | `3000` | HTTP port |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string |
| `REDIS_TTL` | `300` | Presence cache TTL in seconds |
| `REDIS_USER_TTL` | `3600` | User profile cache TTL in seconds |
| `MONGODB_URI` | `mongodb://localhost:27017/discord_presence` | MongoDB connection string |
| `RATE_LIMIT_MAX` | `100` | Requests per minute per IP |
| `WS_RATE_LIMIT_MAX` | `10` | Max WebSocket connections per IP |
| `API_KEY_REQUIRED` | `false` | Set `true` to enable API key gate |
| `API_KEYS` | — | Comma-separated valid keys |
| `ETAG_SECRET` | — | HMAC secret for ETag signing |
| `SHARD_COUNT` | `1` | Total number of shards (horizontal scaling) |
| `SHARD_ID` | `0` | This instance's shard index (0-indexed) |
| `LOG_LEVEL` | `info` | Winston log level |

---

##  Architecture

```
                    ┌─────────────┐
                    │   Clients   │
                    └──────┬──────┘
                           │ HTTP / WS
                    ┌──────▼──────┐
                    │   Nginx     │  ← TLS termination, WS upgrade
                    └──────┬──────┘
              ┌────────────┼────────────┐
       ┌──────▼─────┐ ┌───▼──────┐ ┌──▼───────┐
       │  API Shard0 │ │ Shard 1  │ │ Shard N  │  ← Node.js instances
       └──────┬──────┘ └───┬──────┘ └──┬───────┘
              └────────────┼────────────┘
                           │
              ┌────────────▼────────────┐
              │         Redis           │  ← Shared cache + pub/sub
              └────────────┬────────────┘
                           │
              ┌────────────▼────────────┐
              │         MongoDB         │  ← Analytics, history
              └─────────────────────────┘

Discord Gateway ──► presenceUpdate event ──► Redis cache + pub/sub ──► WS fans out
```

---

##  Deploying to a VPS

```bash
# 1. Clone on your server
git clone https://github.com/YOUR_USERNAME/discord-presence-api.git
cd discord-presence-api

# 2. Configure
cp .env.example .env
nano .env  # set DISCORD_BOT_TOKEN, ETAG_SECRET, etc.

# 3. Start with Docker
docker compose up -d

# 4. Install Nginx + SSL
sudo apt install nginx certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com

# 5. Apply Nginx config
sudo cp nginx.conf /etc/nginx/sites-available/presence-api
sudo ln -s /etc/nginx/sites-available/presence-api /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 6. Check health
curl https://your-domain.com/health
```

### Horizontal scaling

```bash
# Run 3 shards, each with a different SHARD_ID
SHARD_COUNT=3 SHARD_ID=0 docker compose up -d
SHARD_COUNT=3 SHARD_ID=1 PORT=3001 docker compose up -d
SHARD_COUNT=3 SHARD_ID=2 PORT=3002 docker compose up -d

# Put all 3 behind Nginx with upstream load balancing
```

---

##  Project Structure

```
discord-presence-api/
├── config/
│   └── index.js              # All env config in one place
├── src/
│   ├── index.js              # Entry point — boot sequence
│   ├── app.js                # Express app factory
│   ├── docs/
│   │   ├── demo.html         # Interactive demo page (served at /)
│   │   └── openapi.yaml      # OpenAPI 3.0 spec (Swagger UI)
│   ├── middleware/
│   │   ├── analytics.js      # Request logging → MongoDB
│   │   ├── auth.js           # Optional API key gate
│   │   ├── etag.js           # ETag + Cache-Control headers
│   │   ├── formatter.js      # HTML card vs JSON response renderer
│   │   └── rateLimit.js      # Per-IP rate limiting
│   ├── models/
│   │   └── index.js          # Mongoose schemas (snapshots, users, requests)
│   ├── routes/
│   │   ├── analytics.js      # /v1/analytics/*
│   │   ├── health.js         # /health
│   │   └── users.js          # /v1/users/*
│   ├── services/
│   │   ├── index.js          # Service resolver (real vs mock)
│   │   ├── discord.js        # Discord.js bot + presence listener
│   │   ├── mockDiscord.js    # Mock service for dev without a token
│   │   ├── presenceParser.js # Parses all activity types
│   │   └── redis.js          # Redis client + pub/sub helpers
│   ├── utils/
│   │   └── logger.js         # Winston logger
│   └── websocket/
│       └── server.js         # WS server + Redis fan-out
├── scripts/
│   ├── migrate.js            # Create MongoDB indexes
│   └── ws-client.js          # Interactive WS CLI test client
├── .env.example
├── .gitignore
├── .dockerignore
├── docker-compose.yml
├── Dockerfile
├── nginx.conf
└── package.json
```

---

##  Testing

```bash
# Start the server (mock mode, no token needed)
npm start

# Run the interactive WS test client
node scripts/ws-client.js 111111111111111111

# Mock users available in dev mode:
#   111111111111111111  —  alice   (Spotify + custom status)
#   222222222222222222  —  bob     (VS Code rich presence)
#   333333333333333333  —  streamer (Live Twitch stream)

# Curl examples
curl http://localhost:3000/health
curl "http://localhost:3000/v1/users/111111111111111111"          # HTML card
curl "http://localhost:3000/v1/users/111111111111111111?format=json"  # JSON
curl "http://localhost:3000/v1/users/111111111111111111/status"   # status only
```

---

##  License

MIT — see [LICENSE](LICENSE)
