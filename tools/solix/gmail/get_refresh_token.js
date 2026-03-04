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
// When spawned by tool.js the parent will open the browser after receiving
// the READY signal; --no-open suppresses the duplicate browser launch here.
const noOpen = args.includes('--no-open');

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
  // Use 127.0.0.1 explicitly for redirect_uri and server
  const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
  let actualPort = port;
  const servers = [];

  const scopes = getArg('scopes') ?? solixCfg.scopes ??
    'https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send';

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', scopes);
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');

  console.log(`\nStarting local callback server on port ${port}...`);

  // Called once the first server successfully binds.
  // Emits the READY signal so tool.js can open the browser, and also opens
  // it locally when the script is run standalone (without --no-open).
  let firstListenFired = false;
  function onFirstListen() {
    if (firstListenFired) return;
    firstListenFired = true;
    // Signal parent process (tool.js) with the full auth URL so it can open
    // the browser and display it in the UI.
    process.stdout.write(`READY ${authUrl.toString()}\n`);
    if (!noOpen) {
      console.log(`\nOpening browser for Google authorization...`);
      console.log(`Auth URL: ${authUrl.toString()}`);
      openBrowser(authUrl.toString());
    }
  }

  // Request handler shared across IPv4/IPv6 servers.
  async function handleRequest(req, res) {
    if (!req.url) return;
    // Use the literal host we bound to when constructing the URL base so
    // parsing works regardless of whether browser used IPv4 or IPv6.
    const host = req.headers.host || `localhost:${port}`;
    const u = new URL(req.url, `http://${host}`);
    if (u.pathname !== '/oauth2callback') {
      res.writeHead(404); res.end('Not found'); return;
    }
    const code = u.searchParams.get('code');
    const error = u.searchParams.get('error');
    if (error) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end(`OAuth error: ${error}`);
      console.error('OAuth error:', error);
      // close all servers and exit
      servers.forEach((s) => { try { s.close(); } catch {} });
      process.exit(1);
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Authorization received. You can close this tab. Check the terminal for the refresh token.');
    // close all servers and exchange the code
    servers.forEach((s) => { try { s.close(); } catch {} });
    await exchangeCode({ clientId, clientSecret, code, redirectUri });
    rl.close();
  }

  // Only listen on IPv4 for reliability
  function makeServer(host) {
    const s = http.createServer(handleRequest);
    s.on('error', (err) => {
      console.error(`[gmail:get_refresh_token] Server error on ${host}:`, err && err.code ? err.code : err);
    });
    s.on('listening', () => {
      const a = s.address();      actualPort = a?.port || actualPort;      try { console.log(`[gmail:get_refresh_token] listening on ${host}:`, JSON.stringify(a)); }
      catch (e) { console.log(`[gmail:get_refresh_token] listening on ${host}`); }
      servers.push(s);
      onFirstListen();
    });
    try {
      s.listen(port, host);
    } catch (e) {
      console.error(`[gmail:get_refresh_token] listen(${host}) failed:`, e && e.code ? e.code : e);
    }
  }

  // Only listen on IPv4
  makeServer('127.0.0.1');

  // Safety net: if neither loopback bound, fall back to all interfaces.
  setTimeout(() => {
    if (servers.length === 0) {
      console.error('[gmail:get_refresh_token] Could not bind loopback; falling back to 0.0.0.0');
      const s = http.createServer(handleRequest);
      s.on('error', (err) => console.error('[gmail:get_refresh_token] fallback server error:', err));
      s.on('listening', () => {
        console.log('[gmail:get_refresh_token] fallback listening on all interfaces:', JSON.stringify(s.address()));
        servers.push(s);
        onFirstListen();
      });
      s.listen(port);
    }
  }, 500);

  // Prevent exit until callback is received
  process.on('SIGINT', () => {
    console.log('[gmail:get_refresh_token] Received SIGINT, shutting down servers.');
    servers.forEach((s) => { try { s.close(); } catch {} });
    process.exit(0);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
