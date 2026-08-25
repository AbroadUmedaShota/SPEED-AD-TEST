import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PDFDocument, cmyk } from 'pdf-lib';
import { chromium } from 'playwright';
import { inspectPrintLayout, preparePrintPage, printSpec } from './print-layout.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(root, 'output', 'pattern-b', 'print');
const finalOutputDir = path.join(root, 'output', 'pdf');
const entryPath = 'variants/pattern-b/index.html';
const submissionName = 'SPEED_AD_旧パンフレット_PatternB_ACCEA_A4上質70kg_両面カラー_巻三つ折り_入稿用.pdf';
const proofName = 'SPEED_AD_旧パンフレット_PatternB_ACCEA_折り断裁確認用.pdf';
const templateRgbName = 'SPEED_AD_旧パンフレット_PatternB_A4巻三つ折り_ACCEA台紙_RGB.pdf';
const finalCmykName = 'SPEED_AD_旧パンフレット_PatternB_A4巻三つ折り_ACCEA入稿用_CMYK.pdf';
const mime = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'], ['.svg', 'image/svg+xml'], ['.png', 'image/png'],
  ['.woff2', 'font/woff2'],
]);
const mmToPt = value => value * 72 / 25.4;

await fs.mkdir(outputDir, { recursive: true });
await fs.mkdir(finalOutputDir, { recursive: true });
const server = http.createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
  const requested = pathname === '/' ? entryPath : pathname.replace(/^\//, '');
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

async function createPdf({ filename, proof }) {
  const page = await browser.newPage({ viewport: { width: 1718, height: 1225 }, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${port}/${entryPath}`, { waitUntil: 'networkidle' });
  await page.emulateMedia({ media: 'print' });
  await preparePrintPage(page, { proof });
  const layout = await inspectPrintLayout(page);
  const target = path.join(outputDir, filename);
  await page.pdf({
    path: target,
    width: `${printSpec.mediaWidthMm}mm`,
    height: `${printSpec.mediaHeightMm}mm`,
    printBackground: true,
    preferCSSPageSize: true,
    margin: { top: '0', right: '0', bottom: '0', left: '0' },
  });
  await page.close();

  const document = await PDFDocument.load(await fs.readFile(target));
  const mediaWidthPt = mmToPt(printSpec.mediaWidthMm);
  const mediaHeightPt = mmToPt(printSpec.mediaHeightMm);
  const trimOffsetPt = mmToPt(printSpec.bleedMm);
  const trimWidthPt = mmToPt(printSpec.trimWidthMm);
  const trimHeightPt = mmToPt(printSpec.trimHeightMm);
  for (const pdfPage of document.getPages()) {
    pdfPage.setMediaBox(0, 0, mediaWidthPt, mediaHeightPt);
    pdfPage.setCropBox(0, 0, mediaWidthPt, mediaHeightPt);
    pdfPage.setBleedBox(0, 0, mediaWidthPt, mediaHeightPt);
    pdfPage.setTrimBox(trimOffsetPt, trimOffsetPt, trimWidthPt, trimHeightPt);
    pdfPage.setArtBox(trimOffsetPt, trimOffsetPt, trimWidthPt, trimHeightPt);
  }
  await fs.writeFile(target, await document.save({ useObjectStreams: false }));
  return { target, layout };
}

const submission = await createPdf({ filename: submissionName, proof: false });
const proof = await createPdf({ filename: proofName, proof: true });
await browser.close();
server.close();

const lineWidth = mmToPt(.2);
const markColor = cmyk(0, 0, 0, 1);
const drawLineMm = (page, startX, startY, endX, endY) => page.drawLine({
  start: { x: mmToPt(startX), y: mmToPt(startY) },
  end: { x: mmToPt(endX), y: mmToPt(endY) },
  thickness: lineWidth,
  color: markColor,
});

function drawAcceaMarks(page, side) {
  const left = 61.5;
  const right = 358.5;
  const bleedLeft = 58.5;
  const bleedRight = 361.5;
  const bottom = 70;
  const top = 280;
  const bleedBottom = 67;
  const bleedTop = 283;
  for (const ySide of ['bottom', 'top']) {
    const isBottom = ySide === 'bottom';
    const outerY = isBottom ? 58 : 292;
    const foldOuterY = isBottom ? 57.3 : 292.7;
    const bleedY = isBottom ? bleedBottom : bleedTop;
    const trimY = isBottom ? bottom : top;
    drawLineMm(page, left, outerY, left, bleedY);
    drawLineMm(page, 49.5, bleedY, left, bleedY);
    drawLineMm(page, 49.5, trimY, bleedLeft, trimY);
    drawLineMm(page, bleedLeft, outerY, bleedLeft, trimY);
    drawLineMm(page, right, outerY, right, bleedY);
    drawLineMm(page, right, bleedY, 370.5, bleedY);
    drawLineMm(page, bleedRight, trimY, 370.5, trimY);
    drawLineMm(page, bleedRight, outerY, bleedRight, trimY);
    for (const foldPosition of printSpec.foldPositionsMm[side]) {
      const x = printSpec.acceaTemplate.trimLeftMm + foldPosition;
      drawLineMm(page, x, foldOuterY, x, bleedY);
    }
  }
  drawLineMm(page, 210, 57.3, 210, 65.77);
  drawLineMm(page, 197.3, 63.65, 222.7, 63.65);
  drawLineMm(page, 210, 292.7, 210, 284.23);
  drawLineMm(page, 197.3, 286.35, 222.7, 286.35);
}

async function createAcceaTemplatePdf(sourcePath, targetPath) {
  const source = await PDFDocument.load(await fs.readFile(sourcePath));
  const target = await PDFDocument.create();
  target.setTitle('SPEED AD 旧パンフレット Pattern B ACCEA入稿用');
  target.setSubject('A4横 右表紙 巻き三つ折り 上質紙70kg 両面カラー');
  target.setCreator('SPEED AD brochure print pipeline');
  const template = printSpec.acceaTemplate;
  for (const [index, sourcePage] of source.getPages().entries()) {
    const embedded = await target.embedPage(sourcePage);
    const page = target.addPage([mmToPt(template.widthMm), mmToPt(template.heightMm)]);
    page.drawPage(embedded, {
      x: mmToPt(template.bleedLeftMm),
      y: mmToPt(template.bleedBottomMm),
      width: mmToPt(printSpec.mediaWidthMm),
      height: mmToPt(printSpec.mediaHeightMm),
    });
    drawAcceaMarks(page, index === 0 ? 'outside' : 'inside');
    page.setMediaBox(0, 0, mmToPt(template.widthMm), mmToPt(template.heightMm));
    page.setCropBox(0, 0, mmToPt(template.widthMm), mmToPt(template.heightMm));
    page.setBleedBox(
      mmToPt(template.bleedLeftMm), mmToPt(template.bleedBottomMm),
      mmToPt(printSpec.mediaWidthMm), mmToPt(printSpec.mediaHeightMm),
    );
    page.setTrimBox(
      mmToPt(template.trimLeftMm), mmToPt(template.trimBottomMm),
      mmToPt(printSpec.trimWidthMm), mmToPt(printSpec.trimHeightMm),
    );
    page.setArtBox(
      mmToPt(template.trimLeftMm), mmToPt(template.trimBottomMm),
      mmToPt(printSpec.trimWidthMm), mmToPt(printSpec.trimHeightMm),
    );
  }
  await fs.writeFile(targetPath, await target.save({ useObjectStreams: false }));
}

const templateRgbPath = path.join(outputDir, templateRgbName);
const finalCmykPath = path.join(finalOutputDir, finalCmykName);
await createAcceaTemplatePdf(submission.target, templateRgbPath);

const ghostscript = process.env.GHOSTSCRIPT_PATH?.trim() || 'gswin64c';
const cmykProfile = process.env.CMYK_ICC_PROFILE?.trim();
if (!cmykProfile) {
  throw new Error('CMYK_ICC_PROFILE must point to JapanColor2001Uncoated.icc');
}
await fs.access(cmykProfile);
await fs.rm(finalCmykPath, { force: true });
execFileSync(ghostscript, [
  '-dSAFER', '-dBATCH', '-dNOPAUSE', '-dPDFSTOPONERROR',
  `--permit-file-read=${cmykProfile}`,
  '-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.4', '-dPDFSETTINGS=/prepress',
  '-r600', '-dMaxShadingBitmapSize=100000000',
  '-dColorImageResolution=600', '-dGrayImageResolution=600', '-dMonoImageResolution=1200',
  '-dDownsampleColorImages=false', '-dDownsampleGrayImages=false', '-dDownsampleMonoImages=false',
  '-dEmbedAllFonts=true', '-dSubsetFonts=true', '-dAutoRotatePages=/None',
  '-sColorConversionStrategy=CMYK', '-sProcessColorModel=DeviceCMYK',
  '-dOverrideICC', `-sOutputICCProfile=${cmykProfile}`,
  `-sOutputFile=${finalCmykPath}`, templateRgbPath,
], { stdio: 'inherit' });

const popplerBin = process.env.POPPLER_BIN?.trim();
const pdftoppm = popplerBin ? path.join(popplerBin, 'pdftoppm.exe') : 'pdftoppm';
const proofPrefix = path.join(outputDir, 'SPEED_AD_旧パンフレット_PatternB_ACCEA_折り断裁確認用');
execFileSync(pdftoppm, ['-r', '300', '-png', proof.target, proofPrefix], { stdio: 'inherit' });
await fs.rename(`${proofPrefix}-1.png`, `${proofPrefix}_外面.png`);
await fs.rename(`${proofPrefix}-2.png`, `${proofPrefix}_内面.png`);
const cmykPrefix = path.join(outputDir, 'SPEED_AD_旧パンフレット_PatternB_ACCEA入稿用_CMYK');
execFileSync(pdftoppm, ['-r', '300', '-png', finalCmykPath, cmykPrefix], { stdio: 'inherit' });
await fs.rename(`${cmykPrefix}-1.png`, `${cmykPrefix}_外面.png`);
await fs.rename(`${cmykPrefix}-2.png`, `${cmykPrefix}_内面.png`);

await fs.writeFile(path.join(outputDir, 'print-layout.json'), `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  product: 'ACCEA A4 上質紙70kg 両面カラー + 巻き三つ折り加工',
  productUrl: 'https://ex.accea.co.jp/pamph/A4_70k_4C4C_o2',
  printSpec,
  cmykProfile,
  templateRgbFile: path.relative(root, templateRgbPath),
  finalCmykFile: path.relative(root, finalCmykPath),
  submissionLayout: submission.layout,
  proofLayout: proof.layout,
}, null, 2)}\n`, 'utf8');

console.log(`Exported ACCEA print artifacts to ${outputDir}`);
