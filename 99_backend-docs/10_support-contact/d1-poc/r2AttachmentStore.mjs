export class R2AttachmentStore {
  constructor(bucket) {
    this.bucket = bucket;
  }

  async get(objectKey) {
    const object = await this.bucket.get(objectKey);
    if (!object) return null;
    return {
      bytes: new Uint8Array(await object.arrayBuffer()),
      customMetadata: object.customMetadata || {},
    };
  }
}
