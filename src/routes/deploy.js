/**
 * BatsyAPI — Discord Presence API
 * Developer : Venom
 * Team      : Veyron Labs
 * GitHub    : https://github.com/ItzGhost-xD/BatsyAPI
 * License   : MIT © 2024 Veyron Labs
 */

/**
 * Auto-deploy webhook — POST /deploy
 *
 * GitHub sends a webhook here on every push to main.
 * We verify the signature, then run git pull + npm install + pm2 restart.
 *
 * Setup:
 *   1. Set DEPLOY_SECRET in your .env (any random string)
 *   2. Add GitHub webhook:
 *      URL: https://api.yourdomain.com/deploy
 *      Secret: same value as DEPLOY_SECRET
 *      Events: Just the push event
 */

const router  = require('express').Router();
const crypto  = require('crypto');
const { exec } = require('child_process');
const logger  = require('../utils/logger');

const DEPLOY_SECRET = process.env.DEPLOY_SECRET || '';
const DEPLOY_BRANCH = process.env.DEPLOY_BRANCH || 'main';

// Verify GitHub's HMAC-SHA256 signature
function verifySignature(rawBody, signature) {
  if (!DEPLOY_SECRET) return false;
  const expected = 'sha256=' + crypto
    .createHmac('sha256', DEPLOY_SECRET)
    .update(rawBody)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

router.post('/', express_raw_handler, async (req, res) => {
  const sig    = req.headers['x-hub-signature-256'] || '';
  const event  = req.headers['x-github-event']      || '';
  const rawBody = req.rawBody;

  // Verify signature
  if (DEPLOY_SECRET && !verifySignature(rawBody, sig)) {
    logger.warn('Deploy webhook: invalid signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // Only handle push events
  if (event !== 'push') {
    return res.json({ ok: true, message: `Ignored event: ${event}` });
  }

  // Only deploy pushes to the configured branch
  const ref    = req.body?.ref || '';
  const branch = ref.replace('refs/heads/', '');
  if (branch !== DEPLOY_BRANCH) {
    return res.json({ ok: true, message: `Ignored branch: ${branch}` });
  }

  const pusher  = req.body?.pusher?.name || 'unknown';
  const commits = req.body?.commits?.length || 0;
  logger.info(`Deploy triggered by ${pusher} (${commits} commit(s) on ${branch})`);

  // Respond immediately so GitHub doesn't time out
  res.json({ ok: true, message: 'Deploy started', branch, pusher });

  // Run deploy script asynchronously
  const cmd = `cd ${process.cwd()} && git pull origin ${DEPLOY_BRANCH} && npm install --omit=dev && pm2 restart batsy-api --update-env`;

  exec(cmd, { timeout: 120_000 }, (err, stdout, stderr) => {
    if (err) {
      logger.error('Deploy failed', { err: err.message, stderr });
    } else {
      logger.info('Deploy complete', { stdout: stdout.slice(-500) });
    }
  });
});

// Raw body capture middleware (needed for HMAC verification)
function express_raw_handler(req, res, next) {
  let raw = '';
  req.on('data', chunk => raw += chunk);
  req.on('end', () => { req.rawBody = raw; next(); });
}

module.exports = router;
