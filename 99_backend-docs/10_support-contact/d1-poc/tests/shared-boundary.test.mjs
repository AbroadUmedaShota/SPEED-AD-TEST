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
  assert.equal(policy.require.length, 1);
  assert.deepEqual(policy.require[0], { login_method: { id: '<GOOGLE_IDP_LOGIN_METHOD_ID>' } });
  assert.equal(JSON.stringify(policy).toLowerCase().includes('bypass'), false);
  assert.equal(JSON.stringify(policy).toLowerCase().includes('everyone'), false);
  assert.equal(JSON.stringify(policy).includes('email_domain'), false);
});

test('Access policy structure rejects an empty or unrelated Require selector and broad access rules', async () => {
  const policy = JSON.parse(await readFile(path.join(root, 'access-policy.shared.example.json'), 'utf8'));
  const isStrictGooglePolicy = candidate => candidate.decision === 'allow'
    && Array.isArray(candidate.include)
    && candidate.include.length > 0
    && candidate.include.every(rule => Object.keys(rule).join() === 'email'
      && typeof rule.email?.email === 'string' && rule.email.email.length > 0)
    && Array.isArray(candidate.require)
    && candidate.require.length === 1
    && Object.keys(candidate.require[0]).join() === 'login_method'
    && candidate.require[0].login_method?.id === '<GOOGLE_IDP_LOGIN_METHOD_ID>'
    && !JSON.stringify(candidate).toLowerCase().includes('bypass');
  assert.equal(isStrictGooglePolicy(policy), true);
  assert.equal(isStrictGooglePolicy({ ...policy, require: [] }), false);
  assert.equal(isStrictGooglePolicy({ ...policy, require: [{ email: { email: 'operator-one@example.invalid' } }] }), false);
  assert.equal(isStrictGooglePolicy({ ...policy, include: [{ email_domain: { domain: 'example.invalid' } }] }), false);
  assert.equal(isStrictGooglePolicy({ ...policy, include: [{ everyone: {} }] }), false);
  assert.equal(isStrictGooglePolicy({ ...policy, require: [{ bypass: {} }] }), false);
});

test('shared and local UIs expose fixed selects and only state-valid fixed actions', async () => {
  const [sharedUi, localUi] = await Promise.all([
    readFile(path.join(root, 'shared-ui', 'app.js'), 'utf8'),
    readFile(path.join(root, 'ui', 'app.js'), 'utf8'),
  ]);
  for (const ui of [sharedUi, localUi]) {
    assert.match(ui, /confirmationTarget/);
    assert.match(ui, /resolutionCode/);
    assert.match(ui, /'CS', '営業', '開発', '管理者', 'その他'/);
    assert.match(ui, /'解決', '案内完了', '対応不要'/);
    assert.match(ui, /\['対応済み', '顧客確認待ち', '引継ぎ待ち', '保留'\]\.includes\(item\.status\)/);
    assert.match(ui, /item\.status === '対応中'/);
  }
  assert.match(sharedUi, /document\.createElement\(type === 'textarea' \? 'textarea' : type === 'select' \? 'select' : 'input'\)/);
  assert.match(localUi, /type: 'select'/);
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
