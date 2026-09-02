// Deliberately authored local fixtures. No provider, account or retained user
// bytes are imported. This module is pure and shared by browser and test routes.
export const MODEL_PATH = "/api/media/native3d-model.glb";
export const FIRST_IMAGE_PATH = "/api/media/native3d-backdrop.png";
export const SECOND_IMAGE_PATH = "/api/media/native3d-detail.png";

export function modelBytes() {
  const positions = new Float32Array([
    -1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1,
    -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1,
  ]);
  const indices = new Uint16Array([
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4,
    3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5,
  ]);
  const binary = new Uint8Array(positions.byteLength + indices.byteLength);
  binary.set(new Uint8Array(positions.buffer));
  binary.set(new Uint8Array(indices.buffer), positions.byteLength);
  const document = {
    asset: { version: "2.0", generator: "Forma synthetic native3D qualification" },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.15, 0.4, 0.31, 1], metallicFactor: 0, roughnessFactor: 0.5 } }],
    buffers: [{ byteLength: binary.byteLength }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
      { buffer: 0, byteOffset: positions.byteLength, byteLength: indices.byteLength }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 8, type: "VEC3", min: [-1, -1, -1], max: [1, 1, 1] },
      { bufferView: 1, componentType: 5123, count: indices.length, type: "SCALAR" }],
  };
  const json = new TextEncoder().encode(JSON.stringify(document));
  const jsonSize = Math.ceil(json.length / 4) * 4;
  const output = new Uint8Array(28 + jsonSize + binary.length), view = new DataView(output.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, output.length, true);
  view.setUint32(12, jsonSize, true); view.setUint32(16, 0x4e4f534a, true);
  output.fill(32, 20, 20 + jsonSize); output.set(json, 20);
  view.setUint32(20 + jsonSize, binary.length, true); view.setUint32(24 + jsonSize, 0x004e4942, true);
  output.set(binary, 28 + jsonSize);
  return output;
}

const concat = values => {
  const result = new Uint8Array(values.reduce((sum, item) => sum + item.length, 0));
  let offset = 0;
  for (const item of values) { result.set(item, offset); offset += item.length; }
  return result;
};
function chunk(name, bytes) {
  const payload = concat([new TextEncoder().encode(name), bytes]);
  let crc = 0xffffffff;
  for (const byte of payload) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const result = new Uint8Array(payload.length + 8), view = new DataView(result.buffer);
  view.setUint32(0, bytes.length); result.set(payload, 4); view.setUint32(result.length - 4, (crc ^ 0xffffffff) >>> 0);
  return result;
}
function imageBytes(detail) {
  const width = 128, height = 96, pixels = new Uint8Array(height * (1 + width * 4));
  let offset = 0;
  for (let y = 0; y < height; y++) {
    pixels[offset++] = 0;
    for (let x = 0; x < width; x++) {
      const foreground = detail ? (x - 64) ** 2 + (y - 48) ** 2 < 30 ** 2 : y > 65;
      const color = foreground ? detail ? [46, 107, 85, 255] : [174, 131, 98, 255] : [232, 216, 185, 255];
      pixels.set(color, offset); offset += 4;
    }
  }
  // One uncompressed DEFLATE block (<65536 bytes) plus Adler-32. No codec dependency.
  const zlib = new Uint8Array(pixels.length + 11), zview = new DataView(zlib.buffer);
  zlib.set([0x78, 0x01, 0x01]); zview.setUint16(3, pixels.length, true); zview.setUint16(5, (~pixels.length) & 0xffff, true);
  zlib.set(pixels, 7);
  let a = 1, b = 0;
  for (const byte of pixels) { a = (a + byte) % 65521; b = (b + a) % 65521; }
  zview.setUint32(zlib.length - 4, ((b << 16) | a) >>> 0);
  const header = new Uint8Array(13), view = new DataView(header.buffer);
  view.setUint32(0, width); view.setUint32(4, height); header[8] = 8; header[9] = 6;
  return concat([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", zlib), chunk("IEND", new Uint8Array())]);
}

export function syntheticMedia() {
  return new Map([
    [MODEL_PATH, { mime: "model/gltf-binary", bytes: modelBytes() }],
    [FIRST_IMAGE_PATH, { mime: "image/png", bytes: imageBytes(false) }],
    [SECOND_IMAGE_PATH, { mime: "image/png", bytes: imageBytes(true) }],
  ]);
}
