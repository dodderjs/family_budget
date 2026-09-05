#!/usr/bin/env node
// Headless screenshot helper for verifying UI changes actually render.
//
// Playwright's own bundled Chromium is glibc-only and won't run on this
// project's Alpine (musl) frontend container - `apk add chromium` installs
// a musl-native build instead, so this points Playwright at that binary via
// executablePath rather than downloading browsers (see frontend/Dockerfile).
//
// Usage (from inside the frontend container):
//   node scripts/screenshot.mjs <url> <output.png> [--selector "css"] [--full]
import { chromium } from 'playwright';

const [, , url, outPath, ...rest] = process.argv;
if (!url || !outPath) {
  console.error('Usage: node scripts/screenshot.mjs <url> <output.png> [--selector "css"] [--full]');
  process.exit(1);
}

const selectorIdx = rest.indexOf('--selector');
const selector = selectorIdx !== -1 ? rest[selectorIdx + 1] : null;
const fullPage = rest.includes('--full');

const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium-browser';

const browser = await chromium.launch({
  executablePath,
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    // The app is built to call the API at http://localhost:8000, which only
    // means "this container" from inside the frontend container itself -
    // the backend is a separate container (family-budget-api on the same
    // compose network). Redirect just that host:port at the network layer
    // rather than touching the app's configured API URL.
    '--host-resolver-rules=MAP localhost:8000 family-budget-api:8000',
  ],
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + err.message));

  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1000);

  const target = selector ? page.locator(selector) : page;
  await target.screenshot({ path: outPath, fullPage });

  if (consoleErrors.length) {
    console.error('--- CONSOLE ERRORS ---');
    console.error(consoleErrors.join('\n'));
  }
  console.log(`Screenshot saved to ${outPath}`);
} finally {
  await browser.close();
}
