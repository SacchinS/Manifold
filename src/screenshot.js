import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

export default async function takeScreenshot(url, outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
    await page.screenshot({ path: outputPath, fullPage: false });
    console.log(`[screenshot] Saved: ${outputPath}`);
  } finally {
    await browser.close();
  }

  return outputPath;
}
