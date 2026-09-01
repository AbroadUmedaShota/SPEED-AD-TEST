import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = path.join(root, 'assets', 'speed-ad-qr.svg');
const targetUrl = 'https://speed-ad.com/';

const svg = await QRCode.toString(targetUrl, {
  type: 'svg',
  errorCorrectionLevel: 'H',
  margin: 4,
  color: { dark: '#031f54', light: '#ffffff' },
});

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, svg, 'utf8');
console.log(`Generated ${path.relative(root, outputPath)} -> ${targetUrl}`);
