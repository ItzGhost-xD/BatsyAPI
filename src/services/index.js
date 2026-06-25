/**
 * BatsyAPI — Discord Presence API
 * Developer : Venom
 * Team      : Veyron Labs
 * GitHub    : https://github.com/ItzGhost-xD/BatsyAPI
 * License   : MIT © 2024 Veyron Labs
 */

/**
 * src/services/index.js
 *
 * Single source of truth for which Discord service is active.
 * Routes import from here — never directly from discord.js or mockDiscord.js.
 * This makes mock mode work transparently without touching any route files.
 */

const config = require('../../config');

module.exports = config.discord.token
  ? require('./discord')
  : require('./mockDiscord');
