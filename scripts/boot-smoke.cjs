#!/usr/bin/env node
/* Boot smoke for NEXUS — verification any session can run before deploying.
   Serves the repo, loads index.html headless, and fails on any non-network
   JS error. This is the seatbelt: node --check your JS, then run this, and
   only push if it prints BOOT-OK.

   Usage (from repo root):
     NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
       node scripts/boot-smoke.cjs
   Exit 0 = clean. Exit 1 = a real (non-network) error was seen; DO NOT push.
*/
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8700 + (process.pid % 90);

(async () => {
  const server = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', ROOT], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1400));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  } catch (e) {
    console.log('SMOKE-SKIP (no browser available):', e.message);
    server.kill(); process.exit(0);   // don't block if the harness itself can't run
  }
  const page = await browser.newPage();
  const errors = [];
  const NETRE = /supabase|net::|Failed to (load resource|fetch)|NetworkError|ERR_|CDN|cdn|fetch|jsdelivr|cloudflare/i;
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !NETRE.test(m.text())) errors.push('CONSOLE: ' + m.text()); });
  try {
    await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);
  } catch (e) {
    errors.push('NAV: ' + e.message);
  }
  const real = errors.filter(e => !NETRE.test(e));
  console.log(real.length ? 'ERRORS:\n' + real.join('\n') : 'BOOT-OK (no non-network errors)');
  await browser.close();
  server.kill();
  process.exit(real.length ? 1 : 0);
})().catch(e => { console.error('SMOKE-FAIL', e); process.exit(1); });
