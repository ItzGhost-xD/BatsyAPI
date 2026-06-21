const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');
const path = require('path');
const fs = require('fs');

const config = require('../config');
const logger = require('./utils/logger');
const { apiLimiter } = require('./middleware/rateLimit');
const { apiKeyAuth } = require('./middleware/auth');
const { analyticsMiddleware } = require('./middleware/analytics');
const { presenceFormatter } = require('./middleware/formatter');

const usersRouter = require('./routes/users');
const analyticsRouter = require('./routes/analytics');
const healthRouter = require('./routes/health');

function createApp() {
  const app = express();

  // ── Security & basics ────────────────────────────────────────────
  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: false })); // CSP off so Swagger UI loads
  app.use(cors({
    origin: '*',
    methods: ['GET', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'x-api-key', 'Accept'],
  }));
  app.use(compression());
  app.use(express.json({ limit: '16kb' }));
  app.use(morgan('short', { stream: { write: (m) => logger.info(m.trim()) } }));

  // ── Global middleware ────────────────────────────────────────────
  app.use(apiLimiter);
  app.use(analyticsMiddleware);
  app.use(presenceFormatter);  // adds res.presence() helper to all routes

  // ── Swagger docs — /docs ─────────────────────────────────────────
  const swaggerDoc = YAML.load(path.join(__dirname, 'docs/openapi.yaml'));
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDoc, {
    customSiteTitle: 'Discord Presence API',
    customCss: `
      .topbar { background: #5865f2 !important; }
      .topbar-wrapper img { content: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='white' d='M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057.1 18.09.12 18.12.144 18.14a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z'/%3E%3C/svg%3E"); height: 30px; }
      body { background: #1e1f22; }
    `,
    swaggerOptions: { persistAuthorization: true },
  }));

  // ── API routes — /v1 ─────────────────────────────────────────────
  const v1 = express.Router();
  v1.use(apiKeyAuth);
  v1.use('/users', usersRouter);
  v1.use('/analytics', analyticsRouter);

  app.use('/v1', v1);
  app.use('/health', healthRouter);

  // ── Root — interactive demo page ─────────────────────────────────
  const demoHtml = fs.readFileSync(path.join(__dirname, 'docs/demo.html'), 'utf8');
  app.get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(demoHtml);
  });

  // ── 404 ──────────────────────────────────────────────────────────
  app.use((req, res) => {
    res.status(404).json({ error: 'Not found', hint: 'See /docs for the API reference' });
  });

  // ── Global error handler ─────────────────────────────────────────
  app.use((err, req, res, _next) => {
    logger.error('Unhandled error', { err: err.message, stack: err.stack });
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
