import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { exportLocalBlobBundle, restoreLocalBlobBundle } from '../localBlobBundle.mjs';
import { sha256Hex, syntheticAttachment } from '../syntheticAttachmentStore.mjs';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wranglerBin = path.join(projectDir, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const workerPath = path.join(projectDir, 'mvpWorker.mjs').replaceAll('\\', '/');
const commandEnvironment = {
  ...process.env,
  WRANGLER_SEND_METRICS: 'false',
  WRANGLER_SEND_ERROR_REPORTS: 'false',
};

function runWrangler(arguments_, cwd) {
  return spawnSync(process.execPath, [wranglerBin, ...arguments_], {
    cwd, env: commandEnvironment, encoding: 'utf8',
  });
}

function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.unref();
    socket.on('error', reject);
    socket.listen(0, '127.0.0.1', () => {
      const { port } = socket.address();
      socket.close(() => resolve(port));
    });
  });
}

async function createLocalProject(root, name) {
  const directory = path.join(root, name);
  const migrations = path.join(directory, 'migrations');
  await mkdir(migrations, { recursive: true });
  await copyFile(path.join(projectDir, 'migrations-mvp', '0001_contact_mvp.sql'),
    path.join(migrations, '0001_contact_mvp.sql'));
  await copyFile(path.join(projectDir, 'migrations-mvp', '0002_wait_management.sql'),
    path.join(migrations, '0002_wait_management.sql'));
  await writeFile(path.join(directory, 'wrangler.jsonc'), JSON.stringify({
    name: `support-contact-${name}`,
    main: workerPath,
    compatibility_date: '2026-09-06',
    send_metrics: false,
    workers_dev: false,
    d1_databases: [{
      binding: 'DB',
      database_name: `support-contact-${name}`,
      database_id: '00000000-0000-0000-0000-000000000000',
      migrations_dir: './migrations',
      remote: false,
    }],
    vars: { MVP_LOCAL_ONLY: 'true', MVP_TIME_ZONE: 'Asia/Tokyo' },
  }, null, 2));
  const migration = runWrangler([
    'd1', 'migrations', 'apply', 'DB', '--local', '--config', 'wrangler.jsonc',
  ], directory);
  assert.equal(migration.status, 0, `${migration.stdout}\n${migration.stderr}`);
  return directory;
}

async function configureRestoredAttachment(directory, restoredBlobs) {
  const configPath = path.join(directory, 'wrangler.jsonc');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const bytes = restoredBlobs.get(syntheticAttachment.objectKey);
  assert.ok(bytes, 'restored attachment blob is required before Worker startup');
  config.vars.MVP_ATTACHMENT_BLOB_BASE64 = Buffer.from(bytes).toString('base64');
  await writeFile(configPath, JSON.stringify(config, null, 2));
}

function executeSql(directory, ...arguments_) {
  const result = runWrangler([
    'd1', 'execute', 'DB', '--local', '--config', 'wrangler.jsonc', '--yes',
    ...arguments_,
  ], directory);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return result;
}

function snapshot(directory) {
  const result = executeSql(directory, '--json', '--command', `
    SELECT * FROM contact_operators ORDER BY email;
    SELECT * FROM contact_cases ORDER BY case_id;
    SELECT * FROM contact_api_requests ORDER BY request_id;
    SELECT * FROM contact_case_events ORDER BY event_id;
    SELECT * FROM contact_attachments ORDER BY attachment_id;
    PRAGMA foreign_key_check;
  `);
  return JSON.parse(result.stdout).map(item => item.results);
}

async function waitForServer(server, baseUrl, output) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Wrangler exited.\n${output.value}`);
    try {
      const response = await fetch(`${baseUrl}/api/cases`, {
        headers: { 'x-mvp-actor': 'operator-a@example.invalid' },
      });
      if (response.ok) return;
    } catch {
      // Local workerd has not opened the socket yet.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for Wrangler.\n${output.value}`);
}

async function stopServer(server) {
  if (!server || server.exitCode !== null) return;
  server.kill();
  await new Promise(resolve => {
    server.once('exit', resolve);
    setTimeout(resolve, 5_000);
  });
}

test('data export plus blob bundle restores into a separate local D1 and replays a receipt', async () => {
  // Leave room for workerd's hashed SQLite filenames on Windows.
  const root = await mkdtemp(path.join(os.tmpdir(), 'r-'));
  let server;
  try {
    const source = await createLocalProject(root, 'restore-source');
    const target = await createLocalProject(root, 'restore-target');
    const actorEmail = 'operator-a@example.invalid';
    const caseId = 'case-mvp-1';
    const requestId = 'restore-note-request';
    const eventId = 'restore-note-event';
    const note = '復元後に再送する合成メモ';
    const createdAt = '2026-09-06T03:00:00.000Z';
    const payloadHash = await sha256Hex(new TextEncoder().encode(
      JSON.stringify([actorEmail, 'note', caseId, 1, note]),
    ));
    const receipt = {
      requestId, eventId, caseId, action: 'note', eventType: 'note_added', actorEmail,
      fromVersion: 1, toVersion: 2, note, changes: {}, createdAt,
    };
    const attachmentSha256 = await sha256Hex(syntheticAttachment.bytes);
    const seed = [
      `INSERT INTO contact_operators (email, display_name, active, created_at, updated_at)
       VALUES (${quote(actorEmail)}, '担当者A', 1, ${quote(createdAt)}, ${quote(createdAt)}),
       ('operator-b@example.invalid', '担当者B', 1, ${quote(createdAt)}, ${quote(createdAt)});`,
      `INSERT INTO contact_cases
       (case_id, received_at, category, subject, customer_name, customer_email, message,
        source_url, user_agent, status, priority, assignee_email, version, created_at, updated_at)
       VALUES (${quote(caseId)}, ${quote(createdAt)}, '操作案内', '復元用合成問い合わせ',
        '合成利用者', 'customer@example.invalid', '合成データです。',
        'https://example.invalid/contact', 'Synthetic-Restore-Agent', '対応中', '中',
        ${quote(actorEmail)}, 2, ${quote(createdAt)}, ${quote(createdAt)});`,
      `INSERT INTO contact_api_requests
       (request_id, actor_email, action, case_id, expected_version, payload_hash,
        response_json, created_at) VALUES (${quote(requestId)}, ${quote(actorEmail)}, 'note',
        ${quote(caseId)}, 1, ${quote(payloadHash)}, ${quote(JSON.stringify(receipt))},
        ${quote(createdAt)});`,
      `UPDATE contact_cases SET last_request_id = ${quote(requestId)} WHERE case_id = ${quote(caseId)};`,
      `INSERT INTO contact_case_events
       (event_id, request_id, case_id, event_type, actor_email, from_version, to_version,
        note, changes_json, created_at) VALUES (${quote(eventId)}, ${quote(requestId)},
        ${quote(caseId)}, 'note_added', ${quote(actorEmail)}, 1, 2, ${quote(note)}, '{}',
        ${quote(createdAt)});`,
      `INSERT INTO contact_attachments
       (attachment_id, case_id, object_key, original_name, mime_type, size_bytes,
        sha256, created_at) VALUES (${quote(syntheticAttachment.attachmentId)},
        ${quote(caseId)}, ${quote(syntheticAttachment.objectKey)},
        ${quote(syntheticAttachment.originalName)}, ${quote(syntheticAttachment.mimeType)},
        ${syntheticAttachment.bytes.byteLength}, ${quote(attachmentSha256)}, ${quote(createdAt)});`,
    ].join('\n');
    const seedPath = path.join(source, 'seed.sql');
    await writeFile(seedPath, seed);
    executeSql(source, '--file', seedPath);

    const sourceSnapshot = snapshot(source);
    const backupSql = path.join(root, 'contact-data.sql');
    const exported = runWrangler([
      'd1', 'export', 'DB', '--local', '--config', 'wrangler.jsonc',
      '--output', backupSql, '--no-schema', '--skip-confirmation',
      '--table', 'contact_operators', '--table', 'contact_cases',
      '--table', 'contact_api_requests', '--table', 'contact_case_events',
      '--table', 'contact_attachments',
    ], source);
    assert.equal(exported.status, 0, `${exported.stdout}\n${exported.stderr}`);

    const sourceBlob = new Map([
      [syntheticAttachment.objectKey, syntheticAttachment.bytes],
    ]);
    const bundleDirectory = path.join(root, 'attachment-bundle');
    const attachmentRows = sourceSnapshot[4];
    await exportLocalBlobBundle(bundleDirectory, attachmentRows,
      async objectKey => sourceBlob.get(objectKey)?.slice() || null);
    const restoredBlobs = await restoreLocalBlobBundle(bundleDirectory, attachmentRows);

    executeSql(target, '--file', backupSql);
    const targetSnapshot = snapshot(target);
    assert.deepEqual(targetSnapshot, sourceSnapshot);
    assert.deepEqual(targetSnapshot.map(rows => rows.length), [2, 1, 1, 1, 1, 0]);
    assert.deepEqual(restoredBlobs.get(syntheticAttachment.objectKey), syntheticAttachment.bytes);

    let port = await getFreePort();
    let baseUrl = `http://127.0.0.1:${port}`;
    let output = { value: '' };
    server = spawn(process.execPath, [
      wranglerBin, 'dev', '--local', '--ip', '127.0.0.1', '--port', String(port),
      '--config', path.join(target, 'wrangler.jsonc'),
      '--show-interactive-dev-session=false',
    ], { cwd: target, env: commandEnvironment, stdio: ['ignore', 'pipe', 'pipe'] });
    const collectMissing = chunk => { output.value = `${output.value}${chunk}`.slice(-20_000); };
    server.stdout.on('data', collectMissing);
    server.stderr.on('data', collectMissing);
    await waitForServer(server, baseUrl, output);
    const dbOnlyAttachment = await fetch(
      `${baseUrl}/api/attachments/${syntheticAttachment.attachmentId}/content`,
      { headers: { 'x-mvp-actor': actorEmail } },
    );
    assert.equal(dbOnlyAttachment.status, 503);
    await stopServer(server);
    server = null;

    await configureRestoredAttachment(target, restoredBlobs);

    port = await getFreePort();
    baseUrl = `http://127.0.0.1:${port}`;
    output = { value: '' };
    server = spawn(process.execPath, [
      wranglerBin, 'dev', '--local', '--ip', '127.0.0.1', '--port', String(port),
      '--config', path.join(target, 'wrangler.jsonc'),
      '--show-interactive-dev-session=false',
    ], { cwd: target, env: commandEnvironment, stdio: ['ignore', 'pipe', 'pipe'] });
    const collect = chunk => { output.value = `${output.value}${chunk}`.slice(-20_000); };
    server.stdout.on('data', collect);
    server.stderr.on('data', collect);
    await waitForServer(server, baseUrl, output);

    const replay = await fetch(`${baseUrl}/api/cases/${caseId}/actions/note`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-mvp-actor': actorEmail },
      body: JSON.stringify({ requestId, expectedVersion: 1, note }),
    });
    assert.equal(replay.status, 200);
    assert.deepEqual(await replay.json(), receipt);
    const restoredAttachment = await fetch(
      `${baseUrl}/api/attachments/${syntheticAttachment.attachmentId}/content`,
      { headers: { 'x-mvp-actor': actorEmail } },
    );
    assert.equal(restoredAttachment.status, 200);
    assert.deepEqual(new Uint8Array(await restoredAttachment.arrayBuffer()),
      restoredBlobs.get(syntheticAttachment.objectKey));

    const afterReplayResponse = await fetch(`${baseUrl}/__test/snapshot`);
    assert.equal(afterReplayResponse.status, 200);
    const afterReplay = await afterReplayResponse.json();
    assert.deepEqual([
      afterReplay.operators,
      afterReplay.cases,
      afterReplay.requests,
      afterReplay.events,
      afterReplay.attachments,
    ], targetSnapshot.slice(0, 5));
  } finally {
    await stopServer(server);
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

async function createBundleFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'contact-blob-bundle-'));
  const directory = path.join(root, 'bundle');
  const sha256 = await sha256Hex(syntheticAttachment.bytes);
  const metadata = [{
    attachment_id: syntheticAttachment.attachmentId,
    case_id: syntheticAttachment.caseId,
    object_key: syntheticAttachment.objectKey,
    size_bytes: syntheticAttachment.bytes.byteLength,
    sha256,
  }];
  await exportLocalBlobBundle(directory, metadata,
    async () => syntheticAttachment.bytes.slice());
  return { root, directory, metadata };
}

test('blob restore rejects a missing attachment file', async () => {
  const fixture = await createBundleFixture();
  try {
    await unlink(path.join(fixture.directory, `${syntheticAttachment.attachmentId}.blob`));
    await assert.rejects(() => restoreLocalBlobBundle(fixture.directory, fixture.metadata),
      /attachment_incomplete/);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('blob restore rejects bytes whose hash no longer matches D1 metadata', async () => {
  const fixture = await createBundleFixture();
  try {
    const blobPath = path.join(fixture.directory, `${syntheticAttachment.attachmentId}.blob`);
    const corrupted = new Uint8Array(await readFile(blobPath));
    corrupted[0] ^= 0xff;
    await writeFile(blobPath, corrupted);
    await assert.rejects(() => restoreLocalBlobBundle(fixture.directory, fixture.metadata),
      /attachment_incomplete/);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('blob restore rejects a manifest that points at a different case or storage key', async () => {
  const fixture = await createBundleFixture();
  try {
    const manifestPath = path.join(fixture.directory, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.entries[0].caseId = 'different-case';
    manifest.entries[0].objectKey = '../outside';
    await writeFile(manifestPath, JSON.stringify(manifest));
    await assert.rejects(() => restoreLocalBlobBundle(fixture.directory, fixture.metadata),
      /blob_manifest_mismatch/);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
