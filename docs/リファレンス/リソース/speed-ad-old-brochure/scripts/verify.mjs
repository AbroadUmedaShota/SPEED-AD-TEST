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
const variant = process.env.BROCHURE_VARIANT?.trim();
const entryPath = variant ? `variants/${variant}/index.html` : 'index.html';
const outputDir = variant ? path.join(root, 'output', variant) : path.join(root, 'output');
const reportPath = path.join(outputDir, 'verification.json');
const expectedTarget = 'https://speed-ad.com/';
const expectedContactEmail = 'info@abroad-o.com';
const expectedCompanyWebsite = 'https://www.abroad-o.com/';
const expectedCompanyWebsiteText = 'www.abroad-o.com';
const patternBCopyRequirements = [
  {
    id: 'freeTwoFields',
    phrases: [
      '基本情報を無料でデータ化',
      '2項目を無料で',
      '氏名・メールアドレスの基本2項目',
    ],
    pdfPhrases: [
      '基本情報を無料でデータ化',
      '項目を無料で',
      '氏名・メールアドレスの基本2項目',
    ],
  },
  { id: 'standardTenFields', phrases: ['標準10項目'] },
  {
    id: 'onDemandConditions',
    phrases: [
      'オンデマンドなら最短当日中※',
      '※最短当日中はオンデマンドプラン。Premium契約・18時までの入稿など所定条件があります。',
    ],
    pdfPhrases: [
      'オンデマンドなら',
      '最短当日中※',
      '※最短当日中はオンデマンドプラン。Premium契約・18時',
      'までの入稿など所定条件があります。',
    ],
  },
  {
    id: 'csvPlanConditions',
    phrases: ['プランに応じてCSV出力し、営業共有や集計に活用。'],
  },
  {
    id: 'billingStatement',
    phrases: [
      '請求書・明細確認',
      '請求書と明細を一覧で確認し、PDF出力にも対応。',
    ],
  },
];
const patternBForbiddenCopy = [
  '対象イベント',
  '自動で取り込み',
  '外部システムと連携',
  '入金状況を可視化',
  '請求・クローズ',
];
const expectedPatternBStructuredCopy = {
  freeTitle: '基本情報を無料でデータ化',
  freeValue: '2項目を無料で',
  freeDetail: '氏名・メールアドレスの基本2項目から、費用をかけずにお試しいただけます。',
  paidTitle: '必要な情報を、より早く',
  paidValue: '標準10項目オンデマンドなら最短当日中※',
  paidDetail: '営業フォローに必要な情報を標準10項目でデータ化。納期も用途に合わせて選べます。',
  paidNote: '※最短当日中はオンデマンドプラン。Premium契約・18時までの入稿など所定条件があります。',
  csvDescription: 'プランに応じてCSV出力し、営業共有や集計に活用。',
  billingTitle: '請求書・明細確認',
  billingDescription: '請求書と明細を一覧で確認し、PDF出力にも対応。',
};
const mime = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'], ['.svg', 'image/svg+xml'], ['.png', 'image/png'],
  ['.woff2', 'font/woff2'],
]);

function checkPatternBCopy(text, source) {
  const normalizedText = text.replace(/\s+/g, '');
  return {
    required: patternBCopyRequirements.map(requirement => {
      const phrases = source === 'pdf' && requirement.pdfPhrases
        ? requirement.pdfPhrases
        : requirement.phrases;
      return {
        id: requirement.id,
        pass: phrases.every(phrase => normalizedText.includes(phrase.replace(/\s+/g, ''))),
        phrases,
      };
    }),
    forbidden: patternBForbiddenCopy.map(phrase => ({
      phrase,
      present: normalizedText.includes(phrase.replace(/\s+/g, '')),
    })),
  };
}

function copyCheckPassed(check) {
  return check.required.every(item => item.pass)
    && check.forbidden.every(item => !item.present);
}

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
  try {
    const file = await fs.readFile(filePath);
    response.writeHead(200, { 'Content-Type': mime.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream' });
    response.end(file);
  } catch { response.writeHead(404).end(); }
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
await page.goto(`http://127.0.0.1:${port}/${entryPath}`, { waitUntil: 'domcontentloaded' });
await page.evaluate(async () => { await document.fonts.ready; });
const htmlCopyText = await page.locator('.brochure').innerText();
const patternBStructuredCopy = variant === 'pattern-b'
  ? await page.evaluate(() => {
      const normalize = value => value?.replace(/\s+/g, '') || null;
      const featureByTitle = title => [...document.querySelectorAll('.feature-list li')]
        .find(item => item.querySelector('h3')?.textContent.trim() === title);
      const csvFeature = featureByTitle('CSVエクスポート');
      const billingFeature = featureByTitle('請求書・明細確認');
      return {
        freeTitle: normalize(document.querySelector('.benefit-card--free h3')?.textContent),
        freeValue: normalize(document.querySelector('.benefit-free-value')?.textContent),
        freeDetail: normalize(document.querySelector('.benefit-card--free .benefit-detail')?.textContent),
        paidTitle: normalize(document.querySelector('.benefit-card--paid h3')?.textContent),
        paidValue: normalize(document.querySelector('.benefit-paid-value')?.textContent),
        paidDetail: normalize(document.querySelector('.benefit-card--paid .benefit-detail')?.textContent),
        paidNote: normalize(document.querySelector('.benefit-card--paid .benefit-note')?.textContent),
        csvDescription: normalize(csvFeature?.querySelector('p')?.textContent),
        billingTitle: normalize(billingFeature?.querySelector('h3')?.textContent),
        billingDescription: normalize(billingFeature?.querySelector('p')?.textContent),
      };
    })
  : null;

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
    contactEmail: [...document.querySelectorAll('.company-block dl div')]
      .find(row => row.querySelector('dt')?.textContent.trim() === 'E-MAIL')
      ?.querySelector('dd')?.textContent.trim(),
    companyWebsite: {
      href: document.querySelector('.company-website')?.href,
      text: document.querySelector('.company-website')?.textContent.trim(),
    },
    brand: (() => {
      const wordmarkFace = [...document.fonts].find(face => face.family.replace(/["']/g, '') === 'SPEED AD Wordmark');
      return {
        wordmarkFontLoaded: wordmarkFace?.status === 'loaded',
        placements: [...document.querySelectorAll('[data-brand-location]')].map(lockup => {
          const emblem = lockup.querySelector('.brand-emblem');
          const wordmark = lockup.querySelector('.brand-wordmark');
          return {
            location: lockup.dataset.brandLocation,
            emblemPresent: Boolean(emblem),
            emblemLoaded: Boolean(emblem?.complete && emblem.naturalWidth > 0),
            emblemSrc: emblem?.getAttribute('src') || null,
            wordmarkText: wordmark?.textContent.trim() || null,
            wordmarkFontFamily: wordmark ? getComputedStyle(wordmark).fontFamily : null,
          };
        }),
      };
    })(),
    insideDesign: (() => {
      const toMm = value => Number((Number.parseFloat(value) * 25.4 / 96).toFixed(2));
      const minFontMm = selector => {
        const sizes = [...document.querySelectorAll(selector)].map(element => toMm(getComputedStyle(element).fontSize));
        return sizes.length ? Math.min(...sizes) : null;
      };
      return {
        headingTops: [...document.querySelectorAll('.sheet--inside .inside-title-row h2')].map(heading => Number(heading.getBoundingClientRect().top.toFixed(2))),
        mainBodyMinMm: minFontMm('.sheet--inside .flow-list li p, .sheet--inside .feature-list p, .sheet--inside .scene-list p, .sheet--inside .scene-gradient > p'),
        supplementalMinMm: minFontMm('.sheet--inside .problem-box p, .sheet--inside .mini-flow'),
        bottomWhitespaceMm: [...document.querySelectorAll('.sheet--inside .panel')].map(panel => {
          const lastContent = [...panel.querySelectorAll('.flow-list, .problem-box, .scene-gradient')].at(-1);
          return lastContent
            ? Number((((panel.getBoundingClientRect().bottom - lastContent.getBoundingClientRect().bottom) * 25.4) / 96).toFixed(2))
            : null;
        }),
      };
    })(),
    coverDesign: (() => {
      const panel = document.querySelector('.panel--cover');
      const lockup = panel?.querySelector('.brand-lockup--cover');
      const panelRect = panel?.getBoundingClientRect();
      const emblemRect = lockup?.querySelector('.brand-emblem')?.getBoundingClientRect();
      const wordmarkRect = lockup?.querySelector('.brand-wordmark')?.getBoundingClientRect();
      return {
        lockupCenterOffsetPx: panelRect && emblemRect && wordmarkRect
          ? Number(Math.abs((panelRect.left + panelRect.width / 2) - (emblemRect.left + (wordmarkRect.right - emblemRect.left) / 2)).toFixed(2))
          : null,
        hasDataFlowIllustration: Boolean(panel?.querySelector('.cover-data-flow')),
        sourceCount: panel?.querySelectorAll('.cover-data-source').length || 0,
        hasDataHub: Boolean(panel?.querySelector('.cover-data-hub')),
      };
    })(),
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
const pngTarget = await decodeQr(path.join(outputDir, 'SPEED_AD_旧パンフレット_外面_高解像度.png'), true);
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'speed-ad-brochure-'));
const pdfPrefix = path.join(tempDir, 'page-1');
console.log('Rendering PDF page at 300dpi...');
execFileSync('pdftoppm', ['-f', '1', '-singlefile', '-r', '300', '-png', path.join(outputDir, 'SPEED_AD_旧パンフレット_A4巻三つ折り_印刷確認.pdf'), pdfPrefix]);
console.log('Decoding PDF-rendered QR...');
const pdfTarget = await decodeQr(`${pdfPrefix}.png`, true);
await fs.rm(tempDir, { recursive: true, force: true });
const pdfPath = path.join(outputDir, 'SPEED_AD_旧パンフレット_A4巻三つ折り_印刷確認.pdf');
const pdfInfoText = execFileSync('pdfinfo', [pdfPath], { encoding: 'utf8' });
const pdfText = execFileSync('pdftotext', [pdfPath, '-'], { encoding: 'utf8' });
const publicCopy = variant === 'pattern-b'
  ? {
      html: checkPatternBCopy(htmlCopyText),
      pdf: checkPatternBCopy(pdfText, 'pdf'),
      structuredHtml: {
        expected: expectedPatternBStructuredCopy,
        actual: patternBStructuredCopy,
        pass: Object.entries(expectedPatternBStructuredCopy)
          .every(([key, value]) => patternBStructuredCopy[key] === value.replace(/\s+/g, '')),
      },
    }
  : { skipped: true, reason: 'Pattern B専用検査' };
const publicCopyPass = variant !== 'pattern-b'
  || (copyCheckPassed(publicCopy.html)
    && copyCheckPassed(publicCopy.pdf)
    && publicCopy.structuredHtml.pass);
const pages = Number(pdfInfoText.match(/^Pages:\s+(\d+)/m)?.[1]);
const pageSize = pdfInfoText.match(/^Page size:\s+([\d.]+) x ([\d.]+) pts/m);
const pdfInfo = { pages, widthPt: Number(pageSize?.[1]), heightPt: Number(pageSize?.[2]) };
const outsidePng = await sharp(path.join(outputDir, 'SPEED_AD_旧パンフレット_外面_高解像度.png')).metadata();
const insidePng = await sharp(path.join(outputDir, 'SPEED_AD_旧パンフレット_内面_高解像度.png')).metadata();
const pngInfo = {
  outside: { width: outsidePng.width, height: outsidePng.height, effectiveDpi: Number((outsidePng.width / (297 / 25.4)).toFixed(1)) },
  inside: { width: insidePng.width, height: insidePng.height, effectiveDpi: Number((insidePng.width / (297 / 25.4)).toFixed(1)) },
};
const expectedPanelWidths = [[97, 100, 100], [100, 100, 97]];
const panelGeometryPass = results.every(result => result.layout.sheets.every((sheet, sheetIndex) =>
  sheet.panelWidthsMm.every((width, panelIndex) => Math.abs(width - expectedPanelWidths[sheetIndex][panelIndex]) <= 1.2)));
const expectedBrandLocations = ['back', 'cover'];
const brandAssetPass = variant !== 'pattern-b' || results.every(result => {
  const placements = result.layout.brand.placements;
  return result.layout.brand.wordmarkFontLoaded
    && placements.length === expectedBrandLocations.length
    && expectedBrandLocations.every(location => placements.some(placement =>
      placement.location === location
      && placement.emblemPresent
      && placement.emblemLoaded
      && placement.emblemSrc === '../../assets/brand/speed-ad-emblem-color.svg'
      && placement.wordmarkText === 'SPEED AD'
      && placement.wordmarkFontFamily.includes('SPEED AD Wordmark')));
});
const insideDesignPass = variant !== 'pattern-b' || results.every(result => {
  const { headingTops, mainBodyMinMm, supplementalMinMm, bottomWhitespaceMm } = result.layout.insideDesign;
  return headingTops.length === 3
    && Math.max(...headingTops) - Math.min(...headingTops) <= 1
    && mainBodyMinMm >= 2.75
    && supplementalMinMm >= 2.55
    && bottomWhitespaceMm.length === 3
    && Math.max(...bottomWhitespaceMm) <= 8;
});
const coverDesignPass = variant !== 'pattern-b' || results.every(result => {
  const { lockupCenterOffsetPx, hasDataFlowIllustration, sourceCount, hasDataHub } = result.layout.coverDesign;
  return lockupCenterOffsetPx <= 1
    && hasDataFlowIllustration
    && sourceCount === 2
    && hasDataHub;
});
const companyWebsitePass = variant !== 'pattern-b' || results.every(result =>
  result.layout.companyWebsite.href === expectedCompanyWebsite
    && result.layout.companyWebsite.text === expectedCompanyWebsiteText);
const report = {
  generatedAt: new Date().toISOString(),
  expectedTarget,
  expectedContactEmail,
  expectedCompanyWebsite,
  qrAssetIsVector: qrSvg.startsWith('<svg'),
  qrDecode: { htmlAsset: qrAssetTarget, png: pngTarget, pdf300dpi: pdfTarget },
  pdfInfo,
  pngInfo,
  panelGeometryPass,
  brandAssetPass,
  insideDesignPass,
  coverDesignPass,
  companyWebsitePass,
  publicCopyPass,
  publicCopy,
  contactEmail: {
    html: results[0].layout.contactEmail,
    pdfTextIncludesExpected: pdfText.includes(expectedContactEmail),
  },
  pass: [qrAssetTarget, pngTarget, pdfTarget].every(target => target === expectedTarget)
    && pages === 2 && Math.abs(pdfInfo.widthPt - 841.92) < 1 && Math.abs(pdfInfo.heightPt - 594.96) < 1
    && pngInfo.outside.effectiveDpi >= 300 && pngInfo.inside.effectiveDpi >= 300 && panelGeometryPass
    && brandAssetPass && insideDesignPass && coverDesignPass && companyWebsitePass && publicCopyPass
    && pdfText.includes(expectedContactEmail)
    && (variant !== 'pattern-b' || pdfText.includes(expectedCompanyWebsiteText))
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
