#!/usr/bin/env node
/*
 * get_refresh_token.js
 * Simple Node helper to obtain a Google OAuth2 refresh token by running
 * a local HTTP callback and opening the browser to the consent URL.
 *
 * Usage: node get_refresh_token.js
 * Follow prompts for client ID / secret and desired scopes.
 * The script will print the returned refresh_token to stdout.
 */

import http from 'node:http';
import { exec } from 'node:child_process';
import readline from 'node:readline';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function question(q) {
  return new Promise((res) => rl.question(q, (a) => res(a.trim())));
}

async function main() {
  console.log('Google OAuth2 Refresh Token Helper');
  const clientId = await question('OAuth Client ID: ');
  const clientSecret = await question('OAuth Client Secret: ');
  let scopes = await question('Scopes (space-separated, default: https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send): ');
  scopes = scopes || 'https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send';
  const portInput = await question('Local callback port (default 3000): ');
  const port = parseInt(portInput || '3000', 10);

  const redirectUri = `http://localhost:${port}/oauth2callback`;
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', scopes);
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');

  console.log('\nStarting local server to receive the authorization code...');

  const server = http.createServer(async (req, res) => {
    if (!req.url) return;
    const u = new URL(req.url, `http://localhost:${port}`);
    if (u.pathname === '/oauth2callback') {
      const code = u.searchParams.get('code');
      const error = u.searchParams.get('error');
      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end(`Error from provider: ${error}`);
        console.error('OAuth error:', error);
        server.close();
        process.exit(1);
      }
      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Missing code in callback.');
        server.close();
        process.exit(1);
      }

      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Authorization received. You can close this tab. Check the terminal for the refresh token.');

      console.log('\nAuthorization code received. Exchanging for tokens...');

      try {
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
          console.error('Token exchange failed:', data);
        } else {
          console.log('\nToken response:');
          console.log(JSON.stringify(data, null, 2));
          if (data.refresh_token) {
            console.log('\nRefresh token:\n' + data.refresh_token + '\n');
            console.log('Store this value securely (do not commit it to source control).');
          } else {
            console.warn('\nNo refresh_token returned. Make sure you used `access_type=offline` and `prompt=consent` and that your OAuth client is configured to allow refresh tokens.');
          }
        }
      } catch (e) {
        console.error('Error exchanging token:', e);
      } finally {
        server.close();
        rl.close();
        process.exit(0);
      }
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    }
  });

  server.listen(port, () => {
    console.log(`Local callback listening on http://localhost:${port}/oauth2callback`);
    console.log('Opening browser to consent page...');
    // Open the user's default browser in a cross-platform way
    const urlStr = authUrl.toString();
    if (process.platform === 'win32') {
      exec(`start "" "${urlStr}"`);
    } else if (process.platform === 'darwin') {
      exec(`open "${urlStr}"`);
    } else {
      exec(`xdg-open "${urlStr}" || echo "Open this URL in your browser: ${urlStr}"`);
    }
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
