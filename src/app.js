/**
 * BatsyAPI — Discord Presence API
 * Developer : Venom
 * Team      : Veyron Labs
 * GitHub    : https://github.com/ItzGhost-xD/BatsyAPI
 * License   : MIT © 2024 Veyron Labs
 */

const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const compression = require('compression');
const morgan     = require('morgan');
const swaggerUi  = require('swagger-ui-express');
const YAML       = require('yamljs');
const path       = require('path');
const fs         = require('fs');

const config     = require('../config');
const logger     = require('./utils/logger');
const { apiLimiter }        = require('./middleware/rateLimit');
const { apiKeyAuth }        = require('./middleware/auth');
const { analyticsMiddleware } = require('./middleware/analytics');
const { presenceFormatter } = require('./middleware/formatter');
const { router: statsRouter, recordRequest } = require('./routes/stats');

const usersRouter    = require('./routes/users');
const analyticsRouter = require('./routes/analytics');
const healthRouter   = require('./routes/health');
const deployRouter   = require('./routes/deploy');

function createApp() {
  const app = express();

  // ── Security & basics ─────────────────────────────────────────────
  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({
    origin: '*',
    methods: ['GET', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'x-api-key', 'Accept'],
  }));
  app.use(compression());
  app.use(express.json({ limit: '16kb' }));
  app.use(morgan('short', { stream: { write: (m) => logger.info(m.trim()) } }));

  // ── Global middleware ──────────────────────────────────────────────
  app.use(apiLimiter);
  app.use(analyticsMiddleware);
  app.use(presenceFormatter);

  // ── Stats counter — fires on every user presence lookup ───────────
  app.use((req, res, next) => {
    // Match /v1/users/:id  /v1/users/:id/presence  /v1/users/:id/status
    const match = req.path.match(/^\/v1\/users\/(\d{17,20})/);
    if (match) {
      recordRequest(match[1]).catch(() => {});
    }
    next();
  });

  // ── Swagger UI ─────────────────────────────────────────────────────
  const swaggerDoc = YAML.load(path.join(__dirname, 'docs/openapi.yaml'));
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDoc, {
    customSiteTitle: 'BatsyAPI — Veyron Labs',
    customCss: `.topbar { background: #5865f2 !important; }`,
    swaggerOptions: { persistAuthorization: true },
  }));

  // ── Favicon — serve from /public if file exists, else inline SVG ──
  const faviconPath = path.join(__dirname, 'public', 'favicon.ico');
  const faviconPng  = path.join(__dirname, 'public', 'favicon.png');

  app.get('/favicon.ico', (req, res) => {
    if (fs.existsSync(faviconPath)) return res.sendFile(faviconPath);
    if (fs.existsSync(faviconPng))  return res.sendFile(faviconPng);
    // Fallback: 1x1 transparent ICO
    res.setHeader('Content-Type', 'image/x-icon');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(Buffer.from('AAABAAEAAQEAAAEAGAAwAAAAFgAAACgAAAABAAAAAgAAAAEAGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==', 'base64'));
  });

  app.get('/favicon.png', (req, res) => {
    if (fs.existsSync(faviconPng)) return res.sendFile(faviconPng);
    res.status(404).end();
  });

  // Serve anything in /public (icon, manifest, etc.)
  const publicDir = path.join(__dirname, 'public');
  if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir, { maxAge: '1d' }));
  }

  // ── API routes ─────────────────────────────────────────────────────
  const v1 = express.Router();
  v1.use(apiKeyAuth);
  v1.use('/users',     usersRouter);
  v1.use('/analytics', analyticsRouter);
  v1.use('/stats',     statsRouter);

  app.use('/v1',     v1);
  app.use('/health', healthRouter);
  app.use('/deploy', deployRouter);

  // ── Root — interactive dashboard ──────────────────────────────────
  const demoHtml = fs.readFileSync(path.join(__dirname, 'docs/demo.html'), 'utf8');
  app.get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(demoHtml);
  });

  // ── 404 ───────────────────────────────────────────────────────────
  app.use((req, res) => {
    res.status(404).json({ error: 'Not found', hint: 'See /docs for the API reference' });
  });

  // ── Error handler ─────────────────────────────────────────────────
  app.use((err, req, res, _next) => {
    logger.error('Unhandled error', { err: err.message });
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
