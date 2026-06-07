/**
 * refresh-buffer-token.mjs
 *
 * Exchanges a Buffer auth code for an access token.
 *
 * Usage:
 *   node --env-file=.env scripts/refresh-buffer-token.mjs --code=<auth_code>
 *
 * Required env vars:
 *   BUFFER_CLIENT_ID
 *   BUFFER_CLIENT_SECRET
 *
 * How to get the auth code:
 *   Open this URL in your browser (replace YOUR_CLIENT_ID):
 *   https://bufferapp.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&redirect_uri=https://experiencecaddie.com&response_type=code
 *   After authorizing, copy the `code` value from the redirect URL.
 */

const clientId     = process.env.BUFFER_CLIENT_ID;
const clientSecret = process.env.BUFFER_CLIENT_SECRET;
const codeArg      = process.argv.find(a => a.startsWith('--code='));
const code         = codeArg?.split('=')[1];

if (!clientId || !clientSecret) {
  console.error('\n  Missing BUFFER_CLIENT_ID or BUFFER_CLIENT_SECRET in .env\n');
  process.exit(1);
}
if (!code) {
  console.error('\n  Usage: node --env-file=.env scripts/refresh-buffer-token.mjs --code=<auth_code>\n');
  process.exit(1);
}

const body = new URLSearchParams({
  client_id:     clientId,
  client_secret: clientSecret,
  redirect_uri:  'https://experiencecaddie.com',
  code,
  grant_type:    'authorization_code',
});

const res  = await fetch('https://api.bufferapp.com/1/oauth2/token.json', { method: 'POST', body });
const data = await res.json();

if (data.error || !data.access_token) {
  console.error(`\n  Error: ${JSON.stringify(data)}\n`);
  process.exit(1);
}

console.log(`\n  Buffer access token (does not expire):`);
console.log(`\n  ${data.access_token}\n`);
console.log(`  Add to .env as:             BUFFER_ACCESS_TOKEN=${data.access_token}`);
console.log(`  Add to GitHub secrets as:   BUFFER_ACCESS_TOKEN\n`);
