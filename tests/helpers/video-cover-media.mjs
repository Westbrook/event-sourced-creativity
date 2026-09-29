import { createHash } from 'node:crypto';
export function coverMediaFixture() {
  const rows = new Map(), writes = [];
  const object = (key, body = false, range) => {
    const row = rows.get(key); if (!row) return null;
    const bytes=range?row.bytes.slice(range.offset,range.offset+range.length):row.bytes;
    return { key, size: row.bytes.length, customMetadata: structuredClone(row.customMetadata), httpEtag: '"'+createHash('sha256').update(row.bytes).digest('hex')+'"',
      writeHttpMetadata(headers) { headers.set('content-type', row.contentType); },
      ...(body ? { body: new Response(bytes).body } : {}) };
  };
  const MEDIA = { async head(key) { return object(key); }, async get(key,options) { return object(key,true,options?.range); },
    async list({prefix}) { return {objects:[...rows.keys()].filter(key=>key.startsWith(prefix)).map(key=>object(key)),truncated:false}; },
    async put(key, bytes, options) { if (options?.onlyIf?.etagDoesNotMatch === '*' && rows.has(key)) return null;
      writes.push(key); rows.set(key, { bytes: new Uint8Array(bytes), contentType: options.httpMetadata.contentType, customMetadata: options.customMetadata }); return object(key); },
    async delete(key) { rows.delete(key); } };
  return { rows, writes, MEDIA };
}
