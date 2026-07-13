import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(root, 'output');
const mime = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'], ['.svg', 'image/svg+xml'], ['.png', 'image/png'],
]);

await fs.mkdir(outputDir, { recursive: true });
const server = http.createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
  const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
  const filePath = path.resolve(root, requested);
  if (!filePath.startsWith(root)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const contents = await fs.readFile(filePath);
    response.writeHead(200, { 'Content-Type': mime.get(path.extname(filePath)) || 'application/octet-stream' });
    response.end(contents);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

const executablePath = process.env.BROCHURE_BROWSER_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const browser = await chromium.launch({ headless: true, executablePath });
const page = await browser.newPage({ viewport: { width: 1684, height: 1191 }, deviceScaleFactor: 4 });
await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'networkidle' });
await page.emulateMedia({ media: 'print' });
await page.pdf({
  path: path.join(outputDir, 'SPEED_AD_旧パンフレット_A4巻三つ折り_印刷確認.pdf'),
  width: '297mm', height: '210mm', printBackground: true, preferCSSPageSize: true,
  margin: { top: '0', right: '0', bottom: '0', left: '0' },
});

for (const [side, filename] of [
  ['outside', 'SPEED_AD_旧パンフレット_外面_高解像度.png'],
  ['inside', 'SPEED_AD_旧パンフレット_内面_高解像度.png'],
]) {
  const element = page.locator(`[data-side="${side}"]`);
  await element.screenshot({ path: path.join(outputDir, filename), animations: 'disabled' });
}

const preview = sharp({
  create: { width: 2380, height: 3380, channels: 4, background: '#eaf0f5' },
});
const outside = await sharp(path.join(outputDir, 'SPEED_AD_旧パンフレット_外面_高解像度.png')).resize({ width: 2180 }).png().toBuffer();
const inside = await sharp(path.join(outputDir, 'SPEED_AD_旧パンフレット_内面_高解像度.png')).resize({ width: 2180 }).png().toBuffer();
await preview.composite([{ input: outside, left: 100, top: 80 }, { input: inside, left: 100, top: 1740 }])
  .png().toFile(path.join(outputDir, 'SPEED_AD_旧パンフレット_6面一覧プレビュー.png'));

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'speed-ad-gradient-'));
const pdfPath = path.join(outputDir, 'SPEED_AD_旧パンフレット_A4巻三つ折り_印刷確認.pdf');
const pdfPrefix = path.join(tempDir, 'page-1-600dpi');
execFileSync('pdftoppm', ['-f', '1', '-singlefile', '-r', '600', '-png', pdfPath, pdfPrefix]);
const renderedPdf = `${pdfPrefix}.png`;
const metadata = await sharp(renderedPdf).metadata();
const fullRegion = {
  left: Math.round(metadata.width * (197 / 297)),
  top: Math.round(metadata.height * 0.76),
  width: Math.round(metadata.width * (100 / 297)),
  height: Math.round(metadata.height * 0.24),
};
const fullGradient = await sharp(renderedPdf).extract(fullRegion).png().toBuffer();
const detailRegion = {
  left: Math.round(fullRegion.width * 0.39),
  top: Math.round(fullRegion.height * 0.08),
  width: Math.round(fullRegion.width * 0.25),
  height: Math.round(fullRegion.height * 0.84),
};
const detailGradient = await sharp(fullGradient).extract(detailRegion).png().toBuffer();
await sharp(fullGradient).png().toFile(path.join(outputDir, 'gradient-pdf-600dpi-full.png'));
await sharp(detailGradient).png().toFile(path.join(outputDir, 'gradient-pdf-600dpi-4x-crop.png'));
const label = text => Buffer.from(`<svg width="1200" height="90" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#f3f6f9"/><text x="0" y="62" font-family="Arial, sans-serif" font-size="44" font-weight="700" fill="#031f54">${text}</text></svg>`);
await sharp({ create: { width: 2600, height: 1500, channels: 4, background: '#f3f6f9' } })
  .composite([
    { input: label('PDF 600 dpi - full gradient'), left: 100, top: 55 },
    { input: label('PDF 600 dpi - 4x detail crop'), left: 1400, top: 55 },
    { input: await sharp(fullGradient).resize({ width: 1100, height: 1180, fit: 'contain', background: '#ffffff' }).png().toBuffer(), left: 100, top: 170 },
    { input: await sharp(detailGradient).resize({ width: 1100, height: 1180, fit: 'contain', kernel: 'nearest', background: '#ffffff' }).png().toBuffer(), left: 1400, top: 170 },
  ]).png().toFile(path.join(outputDir, 'SPEED_AD_旧パンフレット_グラデーション等倍_高倍率比較.png'));
await fs.rm(tempDir, { recursive: true, force: true });
await fs.rm(path.join(outputDir, 'gradient-1x.png'), { force: true });
await fs.rm(path.join(outputDir, 'gradient-8x.png'), { force: true });

console.log(`Exported brochure artifacts to ${outputDir}`);
process.exit(0);
