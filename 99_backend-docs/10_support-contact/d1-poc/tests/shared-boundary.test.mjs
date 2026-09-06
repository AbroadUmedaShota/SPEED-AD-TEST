import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const sharedFiles = [
  'sharedWorker.mjs', 'sharedCaseActions.mjs', 'accessPrincipalResolver.mjs',
  'r2AttachmentStore.mjs',
];

test('shared dependency graph and UI exclude local test capabilities', async () => {
  const ui = await readdir(path.join(root, 'shared-ui'));
  const content = (await Promise.all([...sharedFiles, ...ui.map(file => `shared-ui/${file}`)]
    .map(file => readFile(path.join(root, file), 'utf8')))).join('\n');
  for (const forbidden of ['/__test', 'x-mvp-actor', 'case-mvp-1', 'operator-a@example.invalid',
    'operator-b@example.invalid', 'MVP_SYNTHETIC_ATTACHMENT_MODE', 'MVP_ATTACHMENT_BLOB_BASE64',
    'afterPreflight', 'failEventInsert']) {
    assert.equal(content.includes(forbidden), false, `shared files contain ${forbidden}`);
  }
  assert.equal(content.includes('actor-select'), false);
});

test('shared deployment placeholders are fail-closed and prohibit Access bypass', async () => {
  const config = JSON.parse((await readFile(path.join(root, 'wrangler.shared.example.jsonc'), 'utf8'))
    .replace(/^\s*\/\/.*$/gm, ''));
  const policy = JSON.parse(await readFile(path.join(root, 'access-policy.shared.example.json'), 'utf8'));
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.equal(config.routes.length, 1);
  assert.equal(config.vars.TRIAL_ENABLED, 'false');
  assert.equal(config.vars.TRIAL_ATTACHMENTS_ENABLED, 'false');
  assert.equal(policy.decision, 'allow');
  assert.ok(policy.include.every(rule => Object.keys(rule).join() === 'email'));
  assert.equal(JSON.stringify(policy).toLowerCase().includes('bypass'), false);
  assert.equal(JSON.stringify(policy).toLowerCase().includes('everyone'), false);
  assert.equal(JSON.stringify(policy).includes('email_domain'), false);
});

test('generated shared Worker bundle excludes local-only capabilities', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'contact-shared-build-'));
  try {
    const wrangler = path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
    const result = spawnSync(process.execPath, [wrangler,
      'deploy', '--dry-run', '--config', 'wrangler.shared.example.jsonc', '--outdir', output,
    ], { cwd: root, encoding: 'utf8', env: {
      ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_SEND_ERROR_REPORTS: 'false',
    } });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const bundle = await readFile(path.join(output, 'sharedWorker.js'), 'utf8');
    for (const forbidden of ['/__test', 'x-mvp-actor', 'case-mvp-1',
      'operator-a@example.invalid', 'MVP_ATTACHMENT_BLOB_BASE64', 'afterPreflight',
      'failEventInsert']) {
      assert.equal(bundle.includes(forbidden), false, `generated bundle contains ${forbidden}`);
    }
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
