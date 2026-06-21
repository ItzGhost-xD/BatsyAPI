#!/usr/bin/env node
/**
 * scripts/migrate.js
 * Creates MongoDB indexes and validates Redis connection on first run.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { createClient } = require('redis');

async function run() {
  console.log('Running migrations...\n');

  // ── MongoDB ─────────────────────────────────────────────────────────
  console.log('Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/discord_presence');
  console.log('  ✅ Connected');

  // Load models so indexes are registered
  require('../src/models');
  await mongoose.connection.syncIndexes();
  console.log('  ✅ Indexes synced');

  const collections = await mongoose.connection.db.listCollections().toArray();
  console.log(`  ✅ Collections: ${collections.map((c) => c.name).join(', ') || 'none yet'}`);

  await mongoose.disconnect();
  console.log('  ✅ MongoDB done\n');

  // ── Redis ────────────────────────────────────────────────────────────
  console.log('Connecting to Redis...');
  const client = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
  client.on('error', (e) => console.error('  ❌ Redis error:', e.message));
  await client.connect();

  await client.set('migrate:ping', 'ok', { EX: 10 });
  const val = await client.get('migrate:ping');
  console.log(`  ✅ Redis roundtrip: ${val}`);

  await client.quit();
  console.log('  ✅ Redis done\n');

  console.log('Migrations complete ✅');
}

run().catch((e) => {
  console.error('Migration failed:', e.message);
  process.exit(1);
});
