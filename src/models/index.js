const mongoose = require('mongoose');
const config = require('../../config');
const logger = require('../utils/logger');

let _connected = false;

// ── Connection ────────────────────────────────────────────────────────
async function connect() {
  // Must register BEFORE connect() call — mongoose emits 'error' even for initial failure
  mongoose.connection.on('error', (e) => {
    // After a failed initial connect, mongoose keeps re-emitting. Just log it.
    logger.warn('MongoDB connection error', { err: e.message });
  });
  mongoose.connection.on('connected',    () => { _connected = true;  logger.info('MongoDB connected'); });
  mongoose.connection.on('disconnected', () => { _connected = false; logger.warn('MongoDB disconnected'); });

  await mongoose.connect(config.mongo.uri, {
    serverSelectionTimeoutMS: 3000,
    connectTimeoutMS:         3000,
    bufferCommands:           false,   // fail fast; don't queue ops while offline
  });

  _connected = true;
}

function isConnected() { return _connected; }

// ── Presence Snapshot Schema ──────────────────────────────────────────
const presenceSnapshotSchema = new mongoose.Schema(
  {
    userId:     { type: String, index: true },
    guildId:    { type: String, index: true },
    status:     { type: String, enum: ['online', 'idle', 'dnd', 'offline', 'invisible'] },
    clientStatus: { desktop: String, mobile: String, web: String },
    activities: [mongoose.Schema.Types.Mixed],
    recordedAt: { type: Date, default: Date.now },
  },
  { timestamps: false, versionKey: false }
);
presenceSnapshotSchema.index({ recordedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

// ── User Profile Cache Schema ─────────────────────────────────────────
const userProfileSchema = new mongoose.Schema(
  {
    userId:        { type: String, unique: true },
    username:      String,
    displayName:   String,
    discriminator: String,
    avatar:        String,
    avatarUrl:     String,
    banner:        String,
    bannerColor:   String,
    accentColor:   Number,
    bot:           Boolean,
    createdAt:     Date,
    fetchedAt:     { type: Date, default: Date.now },
  },
  { timestamps: true, versionKey: false }
);

// ── Request Analytics Schema ──────────────────────────────────────────
const requestLogSchema = new mongoose.Schema(
  {
    ip:         String,
    path:       String,
    userId:     String,
    statusCode: Number,
    durationMs: Number,
    cacheHit:   Boolean,
    ts:         { type: Date, default: Date.now },
  },
  { versionKey: false }
);
requestLogSchema.index({ ts: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 7 });

const PresenceSnapshot = mongoose.model('PresenceSnapshot', presenceSnapshotSchema);
const UserProfile      = mongoose.model('UserProfile',      userProfileSchema);
const RequestLog       = mongoose.model('RequestLog',       requestLogSchema);

module.exports = { connect, isConnected, PresenceSnapshot, UserProfile, RequestLog };
