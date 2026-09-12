import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { sha256Hex } from './syntheticAttachmentStore.mjs';

const ID_PATTERN = /^[a-zA-Z0-9_-]{1,80}$/;

function validMetadata(row) {
  return row && ID_PATTERN.test(row.attachment_id)
    && ID_PATTERN.test(row.case_id)
    && typeof row.object_key === 'string' && row.object_key.length > 0
    && Number.isSafeInteger(row.size_bytes) && row.size_bytes >= 0
    && /^[a-f0-9]{64}$/.test(row.sha256);
}

export async function exportLocalBlobBundle(directory, metadataRows, readBlob) {
  if (!Array.isArray(metadataRows) || typeof readBlob !== 'function'
    || metadataRows.some(row => !validMetadata(row))
    || new Set(metadataRows.map(row => row.attachment_id)).size !== metadataRows.length
    || new Set(metadataRows.map(row => row.object_key)).size !== metadataRows.length) {
    throw new Error('invalid_attachment_metadata');
  }
  await mkdir(directory, { recursive: false });
  const entries = [];
  for (const row of metadataRows) {
    const bytes = await readBlob(row.object_key);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== row.size_bytes
      || await sha256Hex(bytes) !== row.sha256) {
      throw new Error(`attachment_incomplete:${row.attachment_id}`);
    }
    const filename = `${row.attachment_id}.blob`;
    await writeFile(path.join(directory, filename), bytes, { flag: 'wx' });
    entries.push({
      attachmentId: row.attachment_id,
      caseId: row.case_id,
      objectKey: row.object_key,
      filename,
      sizeBytes: row.size_bytes,
      sha256: row.sha256,
    });
  }
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify({
    format: 'support-contact-local-blob-bundle-v1',
    entries,
  }, null, 2), { flag: 'wx' });
}

export async function restoreLocalBlobBundle(directory, metadataRows) {
  if (!Array.isArray(metadataRows) || metadataRows.some(row => !validMetadata(row))
    || new Set(metadataRows.map(row => row.attachment_id)).size !== metadataRows.length
    || new Set(metadataRows.map(row => row.object_key)).size !== metadataRows.length) {
    throw new Error('invalid_attachment_metadata');
  }
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  } catch {
    throw new Error('invalid_blob_manifest');
  }
  if (manifest?.format !== 'support-contact-local-blob-bundle-v1'
    || !Array.isArray(manifest.entries)
    || manifest.entries.length !== metadataRows.length) {
    throw new Error('invalid_blob_manifest');
  }
  const metadata = new Map(metadataRows.map(row => [row.attachment_id, row]));
  const restored = new Map();
  for (const entry of manifest.entries) {
    const row = metadata.get(entry.attachmentId);
    const expectedFilename = `${entry.attachmentId}.blob`;
    if (!row || !ID_PATTERN.test(entry.attachmentId)
      || entry.caseId !== row.case_id || entry.objectKey !== row.object_key
      || entry.filename !== expectedFilename || entry.sizeBytes !== row.size_bytes
      || entry.sha256 !== row.sha256) {
      throw new Error('blob_manifest_mismatch');
    }
    let bytes;
    try {
      bytes = new Uint8Array(await readFile(path.join(directory, expectedFilename)));
    } catch {
      throw new Error(`attachment_incomplete:${entry.attachmentId}`);
    }
    if (bytes.byteLength !== row.size_bytes || await sha256Hex(bytes) !== row.sha256) {
      throw new Error(`attachment_incomplete:${entry.attachmentId}`);
    }
    restored.set(row.object_key, bytes);
    metadata.delete(entry.attachmentId);
  }
  if (metadata.size) throw new Error('blob_manifest_mismatch');
  return restored;
}
