import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  BinaryBitmap, DecodeHintType, BarcodeFormat, HybridBinarizer,
  MultiFormatReader, RGBLuminanceSource,
} from '@zxing/library';
import { printSpec } from './print-layout.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(root, 'output', 'pattern-b', 'print');
const pdfPath = path.join(root, 'output', 'pdf', 'SPEED_AD_旧パンフレット_PatternB_A4巻三つ折り_ACCEA入稿用_CMYK.pdf');
const rgbPath = path.join(outputDir, 'SPEED_AD_旧パンフレット_PatternB_A4巻三つ折り_ACCEA台紙_RGB.pdf');
const reportPath = path.join(outputDir, 'verification.json');
const expectedQr = 'https://speed-ad.com/';
const popplerBin = process.env.POPPLER_BIN?.trim();
const tool = name => popplerBin ? path.join(popplerBin, `${name}.exe`) : name;
const mmFromPt = value => value * 25.4 / 72;

function parseBox(info, name) {
  const match = info.match(new RegExp(`^${name}:\\s+([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)`, 'm'));
  return match ? match.slice(1).map(Number) : null;
}

async function decodeQr(input) {
  const metadata = await sharp(input).metadata();
  const template = printSpec.acceaTemplate;
  const cropped = sharp(input).extract({
    left: Math.round(metadata.width * ((template.bleedLeftMm + 100) / template.widthMm)),
    top: Math.round(metadata.height * ((template.heightMm - template.bleedBottomMm - printSpec.mediaHeightMm + 43) / template.heightMm)),
    width: Math.round(metadata.width * (90 / template.widthMm)),
    height: Math.round(metadata.height * (100 / template.heightMm)),
  });
  const { data, info } = await cropped.resize({ width: 1100, height: 1100, fit: 'inside' })
    .flatten({ background: '#fff' }).greyscale().raw().toBuffer({ resolveWithObject: true });
  const source = new RGBLuminanceSource(new Uint8ClampedArray(data), info.width, info.height);
  const bitmap = new BinaryBitmap(new HybridBinarizer(source));
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  return new MultiFormatReader().decode(bitmap, hints).getText();
}

const info = execFileSync(tool('pdfinfo'), ['-box', pdfPath], { encoding: 'utf8' });
const fonts = execFileSync(tool('pdffonts'), [pdfPath], { encoding: 'utf8' });
const text = execFileSync(tool('pdftotext'), [pdfPath, '-'], { encoding: 'utf8' });
const rgbText = execFileSync(tool('pdftotext'), [rgbPath, '-'], { encoding: 'utf8' });
const images = execFileSync(tool('pdfimages'), ['-list', pdfPath], { encoding: 'utf8' });
const pages = Number(info.match(/^Pages:\s+(\d+)/m)?.[1]);
const encrypted = info.match(/^Encrypted:\s+(\S+)/m)?.[1];
const form = info.match(/^Form:\s+(\S+)/m)?.[1];
const javaScript = info.match(/^JavaScript:\s+(\S+)/m)?.[1];
const pdfVersion = info.match(/^PDF version:\s+(\S+)/m)?.[1];
const mediaBox = parseBox(info, 'MediaBox');
const bleedBox = parseBox(info, 'BleedBox');
const trimBox = parseBox(info, 'TrimBox');
const boxesMm = Object.fromEntries(Object.entries({ mediaBox, bleedBox, trimBox }).map(([name, values]) => [
  name,
  values?.map(value => Number(mmFromPt(value).toFixed(2))),
]));
const fontLines = fonts.split(/\r?\n/).filter(line => /^\S/.test(line) && !line.startsWith('name') && !line.startsWith('-'));
const embeddedFontsPass = fontLines.length > 0 && fontLines.every(line => /\syes\s+yes\s+yes\s+/.test(line));
const wordmarkFontPass = fonts.includes('SPEEDADWordmark-Regular');
const imageRows = images.split(/\r?\n/).filter(line => /^\s*\d+\s+\d+\s+image\s+/.test(line)).map(line => {
  const columns = line.trim().split(/\s+/);
  const ppiIndex = columns.includes('[inline]') ? 11 : 12;
  return { xPpi: Number(columns[ppiIndex]), yPpi: Number(columns[ppiIndex + 1]) };
});
const minimumImagePpi = imageRows.length
  ? Math.min(...imageRows.flatMap(image => [image.xPpi, image.yPpi]))
  : null;
const imageResolutionPass = imageRows.length === 0 || minimumImagePpi >= 300;
const rgbImageRows = images.split(/\r?\n/).filter(line => /^\s*\d+\s+\d+\s+image\s+/.test(line)
  && /\s(rgb|icc)\s/i.test(line));
const pdfSource = (await fs.readFile(pdfPath)).toString('latin1');
const rgbResourceTokens = ['/DeviceRGB', '/CalRGB'].filter(token => pdfSource.includes(token));
const cmykResourcePresent = pdfSource.includes('/DeviceCMYK') || pdfSource.includes('/N 4');
const cmykPass = rgbImageRows.length === 0 && rgbResourceTokens.length === 0 && cmykResourcePresent;

const layoutReport = JSON.parse(await fs.readFile(path.join(outputDir, 'print-layout.json'), 'utf8'));
const layoutPass = layoutReport.submissionLayout.every(sheet => sheet.safeAreaPass && sheet.foldClearancePass
  && Math.abs(sheet.sheetMm.width - printSpec.mediaWidthMm) <= 0.1
  && Math.abs(sheet.sheetMm.height - printSpec.mediaHeightMm) <= 0.1);

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'speed-ad-print-'));
const renderPrefix = path.join(tempDir, 'submission');
execFileSync(tool('pdftoppm'), ['-f', '1', '-singlefile', '-r', '300', '-png', pdfPath, renderPrefix]);
const rendered = `${renderPrefix}.png`;
const qrTarget = await decodeQr(rendered);
const renderMetadata = await sharp(rendered).metadata();
await fs.rm(tempDir, { recursive: true, force: true });

const dimensionsPass = pages === 2
  && boxesMm.mediaBox?.every((value, index) => Math.abs(value - [0, 0, 420, 350][index]) <= 0.1)
  && boxesMm.bleedBox?.every((value, index) => Math.abs(value - [58.5, 67, 361.5, 283][index]) <= 0.1)
  && boxesMm.trimBox?.every((value, index) => Math.abs(value - [61.5, 70, 358.5, 280][index]) <= 0.1);
const requiredText = ['回答・名刺情報を、次のアクションへ。', '標準10項目', 'info@abroad-o.com', 'www.abroad-o.com'];
const textPass = requiredText.every(phrase => rgbText.replace(/\s+/g, '').includes(phrase.replace(/\s+/g, '')));
const finalTextExtractionPass = requiredText.every(phrase => text.replace(/\s+/g, '').includes(phrase.replace(/\s+/g, '')));
const outsideText = execFileSync(tool('pdftotext'), ['-f', '1', '-l', '1', rgbPath, '-'], { encoding: 'utf8' });
const insideText = execFileSync(tool('pdftotext'), ['-f', '2', '-l', '2', rgbPath, '-'], { encoding: 'utf8' });
const pageOrderPass = outsideText.includes('導入・活用のご相談') && insideText.includes('サービスの流れ');
const report = {
  generatedAt: new Date().toISOString(),
  file: path.basename(pdfPath),
  productUrl: 'https://ex.accea.co.jp/pamph/A4_70k_4C4C_o2',
  pages,
  pdfVersion,
  encrypted,
  form,
  javaScript,
  boxesMm,
  dimensionsPass,
  embeddedFontsPass,
  wordmarkFontPass,
  imageResolutionPass,
  minimumImagePpi,
  imageRows,
  cmykPass,
  rgbImageRows,
  rgbResourceTokens,
  cmykResourcePresent,
  fontLines,
  layoutPass,
  layout: layoutReport.submissionLayout,
  render300dpi: { width: renderMetadata.width, height: renderMetadata.height },
  qrDecode: qrTarget,
  qrPass: qrTarget === expectedQr,
  textPass,
  finalTextExtractionPass,
  finalTextExtractionNote: finalTextExtractionPass
    ? null
    : 'Ghostscript変換後は一部日本語のToUnicode抽出が欠落。印刷表示、フォント埋め込み、RGB正本の文言一致を別検証。',
  pageOrderPass,
  requiredText,
  colorHandling: 'Ghostscript + JapanColor2001Uncoated.icc によるCMYK変換。PDF/X準拠表記は行わない。',
  pass: dimensionsPass && pdfVersion === '1.4' && embeddedFontsPass && wordmarkFontPass
    && imageResolutionPass && cmykPass && layoutPass && pageOrderPass
    && qrTarget === expectedQr && textPass && encrypted === 'no' && form === 'none' && javaScript === 'no',
};
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
if (!report.pass) {
  console.error(report);
  process.exit(1);
}
console.log(`Print verification passed: ${reportPath}`);
