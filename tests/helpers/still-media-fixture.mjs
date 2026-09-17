// In-memory R2 sufficient for the real upload + canonical event ownership checks.
export function memoryMedia() {
  const objects=new Map();
  return {
    async put(key,bytes,options={}) {objects.set(key,{bytes:new Uint8Array(bytes),options});},
    async get(key) {const saved=objects.get(key);if(!saved)return null;return {body:saved.bytes.slice(),size:saved.bytes.length,customMetadata:saved.options.customMetadata,writeHttpMetadata(headers){headers.set('content-type',saved.options.httpMetadata?.contentType??'application/octet-stream');}};},
    async head(key) {return this.get(key);},
  };
}
