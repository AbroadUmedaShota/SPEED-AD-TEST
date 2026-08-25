const path = require('path');
const fs = require('fs');
const http = require('http');
const { chromium } = require('playwright');

const outputDirectory = __dirname;
const bundleRoot = outputDirectory;
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

(async () => {
  const contentTypes = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.svg': 'image/svg+xml'
  };
  const server = http.createServer((request, response) => {
    const requestPath = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const localPath = path.resolve(bundleRoot, `.${requestPath}`);
    if (!localPath.startsWith(bundleRoot) || !fs.existsSync(localPath) || fs.statSync(localPath).isDirectory()) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }
    response.writeHead(200, {
      'Content-Type': contentTypes[path.extname(localPath)] || 'application/octet-stream'
    });
    fs.createReadStream(localPath).pipe(response);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  const browser = await chromium.launch({
    executablePath: chromePath,
    headless: true
  });
  const page = await browser.newPage({
    viewport: { width: 1800, height: 1200 },
    deviceScaleFactor: 1
  });

  await page.goto(`http://127.0.0.1:${port}/index.html`, {
    waitUntil: 'networkidle'
  });
  await page.evaluate(() => document.fonts.ready);

  const setCount = await page.locator('.card-set').count();
  if (setCount !== 30) {
    throw new Error(`Expected 30 card sets, found ${setCount}.`);
  }

  await page.screenshot({
    path: path.join(outputDirectory, 'speed-ad-business-cards-preview.png'),
    fullPage: true
  });

  await page.pdf({
    path: path.join(outputDirectory, 'speed-ad-business-cards-30-concepts.pdf'),
    format: 'A4',
    landscape: true,
    printBackground: true,
    preferCSSPageSize: true
  });

  const metrics = await page.locator('.business-card').evaluateAll((cards) => cards.map((card) => ({
    width: card.getBoundingClientRect().width,
    height: card.getBoundingClientRect().height,
    scrollWidth: card.scrollWidth,
    scrollHeight: card.scrollHeight
  })));

  const overflowCount = metrics.filter((metric) => (
    metric.scrollWidth > metric.width + 1 || metric.scrollHeight > metric.height + 1
  )).length;

  console.log(JSON.stringify({
    setCount,
    cardCount: metrics.length,
    overflowCount
  }));
  await browser.close();
  server.close();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
