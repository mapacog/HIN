import { chromium } from 'playwright-core';

const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.goto(process.env.QA_URL || 'http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.locator('.loading-block').waitFor({ state: 'detached', timeout: 180000 });
const before = await page.locator('.drawer-handle').innerText();
await page.locator('.selection-tools button[data-shape="point"]').click();
await page.mouse.click(800, 450);
await page.waitForFunction(() => /^\d[\d,]* roads · \d[\d,]* intersections$/.test(document.querySelector('.selection-count')?.textContent || ''), null, { timeout: 60000 });
await page.waitForTimeout(900);
await page.locator('.loading-block').waitFor({ state: 'detached', timeout: 180000 });
const result = {
  tools: await page.locator('.selection-tools').innerText(),
  before,
  after: await page.locator('.drawer-handle').innerText(),
  performance: await page.locator('.performance-total').first().innerText(),
  errors,
};
console.log(JSON.stringify(result, null, 2));
await browser.close();
