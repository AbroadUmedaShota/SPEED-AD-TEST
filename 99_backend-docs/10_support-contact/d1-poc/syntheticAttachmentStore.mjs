const SYNTHETIC_WEBP_BASE64 = 'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v89WAAAAA==';

function decodeBase64(value) {
  return Uint8Array.from(atob(value), character => character.charCodeAt(0));
}

export async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export const syntheticAttachment = Object.freeze({
  attachmentId: 'attachment-mvp-1',
  caseId: 'case-mvp-1',
  objectKey: 'synthetic/case-mvp-1/attachment-mvp-1.webp',
  originalName: '合成プレビュー.webp',
  mimeType: 'image/webp',
  bytes: decodeBase64(SYNTHETIC_WEBP_BASE64),
});

export class SyntheticAttachmentStore {
  constructor(bytes = null) {
    this.reset(bytes);
  }

  reset(bytes = null) {
    this.blobs = new Map();
    if (bytes) this.blobs.set(syntheticAttachment.objectKey, bytes.slice());
  }

  async get(objectKey) {
    const bytes = this.blobs.get(objectKey);
    return bytes ? bytes.slice() : null;
  }

  drop(objectKey) {
    this.blobs.delete(objectKey);
  }

  corrupt(objectKey) {
    const bytes = this.blobs.get(objectKey);
    if (!bytes?.length) return false;
    const corrupted = bytes.slice();
    corrupted[corrupted.length - 1] ^= 0xff;
    this.blobs.set(objectKey, corrupted);
    return true;
  }
}
