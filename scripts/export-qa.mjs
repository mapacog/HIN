import { chromium } from 'playwright-core';

const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(25000);
await page.locator('.drawer-handle').click();
await page.waitForTimeout(1000);
const buttons = page.locator('.export-menu button');
const downloads = [];
const startIndex = Number(process.argv[2] || 0);
for (let index = startIndex; index < 3; index += 1) {
  try {
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), buttons.nth(index).click()]);
    const filename = download.suggestedFilename();
    await download.saveAs(`qa-${filename}`);
    downloads.push({ filename, failure: await download.failure() });
  } catch (error) {
    downloads.push({ index, error: error.message });
  }
}
await browser.close();
console.log(JSON.stringify({ downloads, errors }, null, 2));
