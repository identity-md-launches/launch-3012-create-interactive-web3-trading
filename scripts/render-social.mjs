import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(process.env.SQUEEK_DEPENDENCY_MANIFEST || new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.SQUEEK_CHROMIUM_PATH ? { executablePath: process.env.SQUEEK_CHROMIUM_PATH } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.goto(new URL('../public/social-card.svg', import.meta.url).href);
  await page.screenshot({ path: fileURLToPath(new URL('../public/social-card.png', import.meta.url)) });
} finally { await browser.close(); }
