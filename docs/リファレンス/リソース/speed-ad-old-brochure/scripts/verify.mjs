import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';
import {
  BinaryBitmap, DecodeHintType, BarcodeFormat, HybridBinarizer,
  MultiFormatReader, RGBLuminanceSource,
} from '@zxing/library';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportPath = path.join(root, 'output', 'verification.json');
const expectedTarget = 'https://speed-ad.com/';
const expectedContactEmail = 'info@abroad-o.com';

async function decodeQr(input, cropToContactPanel = false) {
  let image = sharp(input);
  if (cropToContactPanel) {
    const metadata = await image.metadata();
    image = image.extract({
      left: Math.round(metadata.width * 0.34),
      top: Math.round(metadata.height * 0.24),
      width: Math.round(metadata.width * 0.25),
      height: Math.round(metadata.height * 0.44),
    });
  }
  const { data, info } = await image.resize({ width: 900, height: 900, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).greyscale().raw().toBuffer({ resolveWithObject: true });
  const source = new RGBLuminanceSource(new Uint8ClampedArray(data), info.width, info.height);
  const bitmap = new BinaryBitmap(new HybridBinarizer(source));
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  return new MultiFormatReader().decode(bitmap, hints).getText();
}
const server = http.createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
  const filePath = path.resolve(root, pathname === '/' ? 'index.html' : pathname.replace(/^\//, ''));
  try { response.end(await fs.readFile(filePath)); } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const executablePath = process.env.BROCHURE_BROWSER_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const browser = await chromium.launch({ headless: true, executablePath });
const results = [];
const page = await browser.newPage({ viewport: { width: 1684, height: 1191 } });
const browserErrors = [];
page.on('console', message => {
  if (message.type() === 'error' && !message.text().includes('404 (Not Found)')) browserErrors.push(message.text());
});
page.on('pageerror', error => browserErrors.push(error.message));
await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });

for (const viewport of [{ width: 1684, height: 1191 }, { width: 1188, height: 840 }, { width: 900, height: 1200 }]) {
  await page.setViewportSize(viewport);
  await page.waitForTimeout(100);
  const layout = await page.evaluate(() => ({
    sheets: [...document.querySelectorAll('.sheet')].map(sheet => ({
      width: sheet.scrollWidth, clientWidth: sheet.clientWidth,
      height: sheet.scrollHeight, clientHeight: sheet.clientHeight,
      panelWidthsMm: [...sheet.querySelectorAll('.panel')].map(panel => Number((panel.clientWidth * 25.4 / 96).toFixed(2))),
    })),
    qrAlt: document.querySelector('.contact-qr')?.getAttribute('alt'),
    target: document.querySelector('.contact-link')?.href,
    contactEmail: document.querySelector('.company-block dl div:last-child dd')?.textContent.trim(),
    overflowElements: [...document.querySelectorAll('.panel')].filter(el => {
      const verticalOverflow = el.scrollHeight > el.clientHeight + 1;
      const horizontalOverflow = !el.classList.contains('panel--cover') && el.scrollWidth > el.clientWidth + 1;
      return verticalOverflow || horizontalOverflow;
    }).map(el => ({ label: el.getAttribute('aria-label'), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight })),
  }));
  results.push({ viewport, errors: [...browserErrors], layout });
}

const qrSvg = await fs.readFile(path.join(root, 'assets', 'speed-ad-qr.svg'), 'utf8');
console.log('Decoding HTML QR asset...');
const qrAssetTarget = await decodeQr(Buffer.from(qrSvg));
console.log('Decoding exported PNG QR...');
const pngTarget = await decodeQr(path.join(root, 'output', 'SPEED_AD_旧パンフレット_外面_高解像度.png'), true);
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'speed-ad-brochure-'));
const pdfPrefix = path.join(tempDir, 'page-1');
console.log('Rendering PDF page at 300dpi...');
execFileSync('pdftoppm', ['-f', '1', '-singlefile', '-r', '300', '-png', path.join(root, 'output', 'SPEED_AD_旧パンフレット_A4巻三つ折り_印刷確認.pdf'), pdfPrefix]);
console.log('Decoding PDF-rendered QR...');
const pdfTarget = await decodeQr(`${pdfPrefix}.png`, true);
await fs.rm(tempDir, { recursive: true, force: true });
const pdfPath = path.join(root, 'output', 'SPEED_AD_旧パンフレット_A4巻三つ折り_印刷確認.pdf');
const pdfInfoText = execFileSync('pdfinfo', [pdfPath], { encoding: 'utf8' });
const pdfText = execFileSync('pdftotext', [pdfPath, '-'], { encoding: 'utf8' });
const pages = Number(pdfInfoText.match(/^Pages:\s+(\d+)/m)?.[1]);
const pageSize = pdfInfoText.match(/^Page size:\s+([\d.]+) x ([\d.]+) pts/m);
const pdfInfo = { pages, widthPt: Number(pageSize?.[1]), heightPt: Number(pageSize?.[2]) };
const outsidePng = await sharp(path.join(root, 'output', 'SPEED_AD_旧パンフレット_外面_高解像度.png')).metadata();
const insidePng = await sharp(path.join(root, 'output', 'SPEED_AD_旧パンフレット_内面_高解像度.png')).metadata();
const pngInfo = {
  outside: { width: outsidePng.width, height: outsidePng.height, effectiveDpi: Number((outsidePng.width / (297 / 25.4)).toFixed(1)) },
  inside: { width: insidePng.width, height: insidePng.height, effectiveDpi: Number((insidePng.width / (297 / 25.4)).toFixed(1)) },
};
const expectedPanelWidths = [[97, 100, 100], [100, 100, 97]];
const panelGeometryPass = results.every(result => result.layout.sheets.every((sheet, sheetIndex) =>
  sheet.panelWidthsMm.every((width, panelIndex) => Math.abs(width - expectedPanelWidths[sheetIndex][panelIndex]) <= 1.2)));
const report = {
  generatedAt: new Date().toISOString(),
  expectedTarget,
  expectedContactEmail,
  qrAssetIsVector: qrSvg.startsWith('<svg'),
  qrDecode: { htmlAsset: qrAssetTarget, png: pngTarget, pdf300dpi: pdfTarget },
  pdfInfo,
  pngInfo,
  panelGeometryPass,
  contactEmail: {
    html: results[0].layout.contactEmail,
    pdfTextIncludesExpected: pdfText.includes(expectedContactEmail),
  },
  pass: [qrAssetTarget, pngTarget, pdfTarget].every(target => target === expectedTarget)
    && pages === 2 && Math.abs(pdfInfo.widthPt - 841.92) < 1 && Math.abs(pdfInfo.heightPt - 594.96) < 1
    && pngInfo.outside.effectiveDpi >= 300 && pngInfo.inside.effectiveDpi >= 300 && panelGeometryPass
    && pdfText.includes(expectedContactEmail)
    && results.every(result => result.errors.length === 0 && result.layout.overflowElements.length === 0 && result.layout.target === expectedTarget && result.layout.contactEmail === expectedContactEmail),
  results,
};
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
if (!report.pass) {
  console.error(report);
  process.exit(1);
} else {
  console.log(`Verification passed: ${reportPath}`);
  process.exit(0);
}
