import { spawn } from 'node:child_process';

const variant = process.argv[2]?.trim();
if (!variant) {
  throw new Error('Usage: node scripts/build-variant.mjs <variant-name>');
}

const run = args => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    env: { ...process.env, BROCHURE_VARIANT: variant },
    stdio: 'inherit',
  });
  child.once('error', reject);
  child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${args.join(' ')} failed with exit code ${code}`)));
});

await run(['scripts/generate-qr.mjs']);
await run(['scripts/export.mjs']);
await run(['scripts/verify.mjs']);
