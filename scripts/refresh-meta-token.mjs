/**
 * refresh-meta-token.mjs
 *
 * Exchanges a short-lived user token for a long-lived token (60 days).
 * Run this once after getting your token from the Graph API Explorer,
 * then save the result to META_ACCESS_TOKEN in your .env and GitHub secrets.
 *
 * Usage:
 *   node --env-file=.env scripts/refresh-meta-token.mjs --token=<short_lived_token>
 *
 * Required env vars:
 *   META_APP_ID
 *   META_APP_SECRET
 */

const appId     = process.env.META_APP_ID;
const appSecret = process.env.META_APP_SECRET;
const tokenArg  = process.argv.find(a => a.startsWith('--token='));
const shortToken = tokenArg?.split('=')[1];

if (!appId || !appSecret) {
  console.error('\n  Missing META_APP_ID or META_APP_SECRET in .env\n');
  process.exit(1);
}
if (!shortToken) {
  console.error('\n  Usage: node --env-file=.env scripts/refresh-meta-token.mjs --token=<short_lived_token>\n');
  process.exit(1);
}

const url = `https://graph.facebook.com/v21.0/oauth/access_token` +
  `?grant_type=fb_exchange_token` +
  `&client_id=${appId}` +
  `&client_secret=${appSecret}` +
  `&fb_exchange_token=${shortToken}`;

const res  = await fetch(url);
const data = await res.json();

if (data.error) {
  console.error(`\n  Error: ${data.error.message}\n`);
  process.exit(1);
}

const expiresInDays = Math.round((data.expires_in ?? 0) / 86400);
console.log(`\n  Long-lived access token (valid ~${expiresInDays} days):`);
console.log(`\n  ${data.access_token}\n`);
console.log(`  Add this to your .env as META_ACCESS_TOKEN`);
console.log(`  Also add it as a GitHub Actions secret named META_ACCESS_TOKEN\n`);
