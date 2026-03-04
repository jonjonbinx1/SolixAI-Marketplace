#!/usr/bin/env node
/*
 * get_refresh_token.js
 * Obtain a Google OAuth2 refresh token.
 *
 * MODE 1 — paste existing code (no server needed):
 *   node get_refresh_token.js --code "4/0Afr..."
 *
 * MODE 2 — full interactive flow (starts local server + opens browser):
 *   node get_refresh_token.js
 *
 * Credentials are read automatically from ~/.solix/config.json.
 * Override with --clientId and --clientSecret flags.
 */

import http from 'node:http';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { exec } from 'node:child_process';
import readline from 'node:readline';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
function question(q) {
  return new Promise((res) => {
    rl.question(q, (a) => res(a.trim()));
  });
}

// ── Parse CLI args ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : null;
}

// ── Auto-load solix config ────────────────────────────────────────────────────
function loadSolixConfig() {
  try {
    const raw = readFileSync(join(homedir(), '.solix', 'config.json'), 'utf-8');
    return JSON.parse(raw)?.toolConfig?.['solix/gmail'] ?? {};
  } catch { return {}; }
}

async function exchangeCode({ clientId, clientSecret, code, redirectUri }) {
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });
  const data = await tokenRes.json();
  if (!tokenRes.ok) {
    console.error('Token exchange failed:', JSON.stringify(data, null, 2));
    process.exit(1);
  }
  if (!data.refresh_token) {
    console.error('No refresh_token in response. Ensure access_type=offline and prompt=consent were used.');
    console.error('Response:', JSON.stringify(data, null, 2));
    process.exit(1);
  }
  console.log('\n✅ Refresh token obtained!');
  console.log('\nRefresh token:', data.refresh_token);
  console.log('\nPaste this value into the Gmail tool config → OAuth 2.0 Refresh Token field.');
}

// Cross-platform browser launcher. Falls back to printing the URL
// if the platform command fails.
function openBrowser(url) {
  const plat = process.platform;
  let cmd;
  if (plat === 'win32') {
    // `start` must be run through cmd.exe
    cmd = `cmd /c start "" "${url}"`;
  } else if (plat === 'darwin') {
    cmd = `open "${url}"`;
  } else {
    cmd = `xdg-open "${url}"`;
  }

  exec(cmd, (err) => {
    if (err) {
      console.warn('Could not open browser automatically – please open the URL manually:\n', url);
    }
  });
}

async function main() {
  const solixCfg = loadSolixConfig();
  const presetClientId = getArg('clientId') ?? solixCfg.clientId ?? null;
  const presetClientSecret = getArg('clientSecret') ?? solixCfg.clientSecret ?? null;
  const existingCode = getArg('code');
  const portInput = getArg('port');
  const port = parseInt(portInput ?? '3000', 10);
  const redirectUri = `http://localhost:${port}/oauth2callback`;

  const scopes = getArg('scopes') ?? solixCfg.scopes ??
    'https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send';

  // ── MODE 1: code already in hand ─────────────────────────────────────────
  if (existingCode) {
    const clientId = presetClientId;
    const clientSecret = presetClientSecret;
    if (!clientId || !clientSecret) {
      console.error('Could not find clientId/clientSecret in ~/.solix/config.json.');
      console.error('Pass them explicitly: --clientId ID --clientSecret SECRET');
      process.exit(1);
    }
    console.log('Google OAuth2 Refresh Token Helper — code exchange mode');
    console.log('Using clientId from config:', clientId.slice(0, 20) + '...');
    console.log('Exchanging code for tokens...');
    await exchangeCode({ clientId, clientSecret, code: existingCode, redirectUri });
    rl.close();
    return;
  }

  // ── MODE 2: interactive flow ──────────────────────────────────────────────
  console.log('Google OAuth2 Refresh Token Helper — interactive mode');
  if (presetClientId) console.log('(Using clientId from config — press Enter to accept)');
  const clientId = (await question(`OAuth Client ID [${presetClientId ?? 'required'}]: `)) || presetClientId;
  const clientSecret = (await question(`OAuth Client Secret [${presetClientId ? '****' : 'required'}]: `)) || presetClientSecret;

  if (!clientId || !clientSecret) {
    console.error('clientId and clientSecret are required.');
    process.exit(1);
  }

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', scopes);
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');

  console.log(`\nStarting local callback server on port ${port}...`);

  const server = http.createServer(async (req, res) => {
    if (!req.url) return;
    const u = new URL(req.url, `http://localhost:${port}`);
    if (u.pathname !== '/oauth2callback') {
      res.writeHead(404); res.end('Not found'); return;
    }
    const code = u.searchParams.get('code');
    const error = u.searchParams.get('error');
    if (error) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end(`OAuth error: ${error}`);
      console.error('OAuth error:', error);
      server.close(); process.exit(1);
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Authorization received. You can close this tab. Check the terminal for the refresh token.');
    server.close();
    await exchangeCode({ clientId, clientSecret, code, redirectUri });
    rl.close();
  });

  server.on('error', (err) => {
    console.error('[gmail:get_refresh_token] Server error:', err);
    process.exit(1);
  });

  // Bind explicitly to the loopback interface to ensure the browser can
  // reach the local callback endpoint regardless of how `localhost` resolves.
  server.listen(port, '127.0.0.1', () => {
    console.log(`Listening on ${redirectUri}`);
    const addr = server.address();
    try {
      console.log('[gmail:get_refresh_token] server.address():', JSON.stringify(addr));
    } catch (e) {
      console.log('[gmail:get_refresh_token] server listening');
    }
    console.log('\nPlease open the following URL in a browser to authorize:');
    console.log('\n' + authUrl.toString() + '\n');
    // attempt to open the user's browser automatically; if this fails
    // the helper will have already printed the URL for manual copy/paste.
    try {
      openBrowser(authUrl.toString());
    } catch (e) {
      // ignore errors here; openBrowser logs a warning on failure
    }
    console.log('If you are on a different machine, copy this URL into a browser there.');
    console.log('After granting access the browser will redirect to the local callback and the terminal will display the refresh token.');
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
