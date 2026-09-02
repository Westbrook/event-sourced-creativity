/** Self-contained glTF binary assets are the only model input supported by the viewer. */
export const MODEL3D_MIME_TYPE = "model/gltf-binary" as const;
export const MAX_MODEL3D_UPLOAD_BYTES = 64 * 1024 * 1024;
export const MAX_MODEL3D_JSON_BYTES = 2 * 1024 * 1024;
const MAX_MODEL3D_VERTICES = 2_000_000;
const MAX_MODEL3D_ACCESSOR_ELEMENTS = 6_000_000;
const MAX_MODEL3D_COMPONENT_READS = 32_000_000;
const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const DECODER_EXTENSIONS = new Set(["KHR_draco_mesh_compression", "EXT_meshopt_compression", "KHR_texture_basisu"]);
const SUPPORTED_REQUIRED_EXTENSIONS = new Set([
  "KHR_lights_punctual", "KHR_materials_unlit", "KHR_materials_clearcoat", "KHR_materials_sheen",
  "KHR_materials_transmission", "KHR_materials_volume", "KHR_materials_ior", "KHR_materials_specular",
  "KHR_materials_iridescence", "KHR_materials_anisotropy", "KHR_materials_emissive_strength",
  "KHR_mesh_quantization", "KHR_texture_transform", "EXT_texture_webp", "EXT_mesh_gpu_instancing",
]);

export function model3dMimeType(file: { name: string; type: string }): typeof MODEL3D_MIME_TYPE | null {
  const mime = String(file.type ?? "").split(";")[0]!.trim().toLowerCase();
  if (mime === MODEL3D_MIME_TYPE) return MODEL3D_MIME_TYPE;
  return (!mime || mime === "application/octet-stream") && /\.glb$/i.test(file.name) ? MODEL3D_MIME_TYPE : null;
}

const record = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const integer = (value: unknown, minimum = 0): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
const fail = (message: string): never => { throw new Error(message); };
const malformed = () => fail("This file is not a valid GLB 2.0 model. Export it again as a self-contained GLB.");

function embeddedData(uri: string): Uint8Array {
  let decoded: string;
  try { decoded = atob(uri.slice(uri.indexOf(",") + 1)); } catch { return malformed(); }
  return Uint8Array.from(decoded, character => character.charCodeAt(0));
}

/** Check image framing without claiming pixel decoding or visual correctness. */
function validateEmbeddedImage(bytes: Uint8Array, mimeType: string): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const signature = (offset: number, value: string) => offset + value.length <= bytes.length
    && [...value].every((character, index) => bytes[offset + index] === character.charCodeAt(0));
  let pixels = 0;
  const dimensions = (width: number, height: number) => {
    if (!integer(width, 1) || !integer(height, 1) || width > 16_384 || height > 16_384 || width * height > 64_000_000) {
      fail("This model contains an oversized texture. Resize its textures before exporting the GLB.");
    }
    pixels = Math.max(pixels, width * height);
  };
  if (mimeType === "image/png") {
    if (bytes.length < 57 || !signature(0, "\x89PNG\r\n\x1a\n")) malformed();
    let at = 8, chunks = 0, dataLength = 0, seenData = false, endedData = false, ended = false;
    while (at + 12 <= bytes.length) {
      if (++chunks > 4096) malformed();
      const length = view.getUint32(at), end = at + 12 + length;
      if (end > bytes.length || !/^[A-Za-z]{4}$/.test(String.fromCharCode(...bytes.subarray(at + 4, at + 8)))) malformed();
      if (chunks === 1) {
        if (!signature(at + 4, "IHDR") || length !== 13) malformed();
        dimensions(view.getUint32(at + 8), view.getUint32(at + 12));
        const depths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
        if (!depths[bytes[at + 17]!]?.includes(bytes[at + 16]!) || bytes[at + 18] !== 0 || bytes[at + 19] !== 0 || bytes[at + 20]! > 1) malformed();
      } else if (signature(at + 4, "IHDR")) malformed();
      if (signature(at + 4, "IDAT")) {
        if (endedData) malformed();
        seenData = true;
        dataLength += length;
      } else if (seenData) endedData = true;
      if (signature(at + 4, "IEND")) {
        if (length || !dataLength || end !== bytes.length) malformed();
        ended = true;
        break;
      }
      at = end;
    }
    if (!ended) malformed();
    return pixels;
  }
  if (mimeType === "image/jpeg") {
    if (!signature(0, "\xff\xd8")) malformed();
    let at = 2, markers = 0, frameComponents = 0, scan = false, ended = false;
    while (at < bytes.length) {
      if (++markers > 4096 || bytes[at++] !== 255) malformed();
      while (bytes[at] === 255) at += 1;
      if (at >= bytes.length) malformed();
      const marker = bytes[at++]!;
      if (marker === 0xd9) { if (!frameComponents || !scan || at !== bytes.length) malformed(); ended = true; break; }
      if (!marker || marker === 0xd8 || marker === 1 || marker >= 0xd0 && marker <= 0xd7 || at + 2 > bytes.length) malformed();
      const length = view.getUint16(at), end = at + length;
      if (length < 2 || end > bytes.length) malformed();
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        if (frameComponents || length < 11) malformed();
        dimensions(view.getUint16(at + 5), view.getUint16(at + 3));
        if (length !== 8 + 3 * bytes[at + 7]!) malformed();
        frameComponents = bytes[at + 7]!;
      }
      if (marker === 0xda && (!frameComponents || length < 8 || !bytes[at + 2] || bytes[at + 2]! > frameComponents || length !== 6 + 2 * bytes[at + 2]!)) malformed();
      at = end;
      if (marker === 0xda) {
        scan = true;
        let entropyBytes = 0;
        while (at < bytes.length) {
          if (bytes[at] !== 255) { at += 1; entropyBytes += 1; continue; }
          const start = at;
          while (bytes[at] === 255) at += 1;
          if (at >= bytes.length) malformed();
          const next = bytes[at]!;
          if (next === 0 || next >= 0xd0 && next <= 0xd7) { at += 1; entropyBytes += next === 0 ? 1 : 0; continue; }
          at = start;
          break;
        }
        if (!entropyBytes) malformed();
      }
    }
    if (!ended) malformed();
    return pixels;
  }
  if (mimeType === "image/webp") {
    if (bytes.length < 20 || !signature(0, "RIFF") || !signature(8, "WEBP") || view.getUint32(4, true) !== bytes.length - 8) malformed();
    let at = 12, chunks = 0, image = false, canvasWidth = 0, canvasHeight = 0;
    while (at + 8 <= bytes.length) {
      if (++chunks > 4096) malformed();
      const size = view.getUint32(at + 4, true), start = at + 8, end = start + size + size % 2;
      if (end > bytes.length) malformed();
      if (signature(at, "VP8 ")) {
        if (image || size < 10 || bytes[start]! & 1 || !signature(start + 3, "\x9d\x01\x2a")) malformed();
        const width = view.getUint16(start + 6, true) & 0x3fff, height = view.getUint16(start + 8, true) & 0x3fff;
        dimensions(width, height);
        if (canvasWidth && (width !== canvasWidth || height !== canvasHeight)) malformed();
        image = true;
      } else if (signature(at, "VP8L")) {
        if (image || size < 5 || bytes[start] !== 0x2f || bytes[start + 4]! >> 5) malformed();
        const sizeBits = view.getUint32(start + 1, true);
        const width = (sizeBits & 0x3fff) + 1, height = (sizeBits >>> 14 & 0x3fff) + 1;
        dimensions(width, height);
        if (canvasWidth && (width !== canvasWidth || height !== canvasHeight)) malformed();
        image = true;
      } else if (signature(at, "VP8X")) {
        if (chunks !== 1 || size !== 10 || bytes[start]! & 2) fail("Animated model textures are not supported. Export a GLB with still PNG, JPEG, or WebP textures.");
        if (bytes[start]! & 0xc1 || bytes[start + 1] || bytes[start + 2] || bytes[start + 3]) malformed();
        canvasWidth = 1 + bytes[start + 4]! + (bytes[start + 5]! << 8) + (bytes[start + 6]! << 16);
        canvasHeight = 1 + bytes[start + 7]! + (bytes[start + 8]! << 8) + (bytes[start + 9]! << 16);
        dimensions(canvasWidth, canvasHeight);
      } else if (signature(at, "ANIM") || signature(at, "ANMF")) fail("Animated model textures are not supported. Export a GLB with still PNG, JPEG, or WebP textures.");
      at = end;
    }
    if (!image || at !== bytes.length) malformed();
    return pixels;
  }
  return malformed();
}

export type Model3dContainer = {
  mimeType: typeof MODEL3D_MIME_TYPE; format: "glb"; json: Record<string, unknown>; byteLength: number;
};

function parseModel3dContainer(input: Uint8Array | ArrayBuffer): { asset: Model3dContainer; binBytes: Uint8Array | null } {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength > MAX_MODEL3D_UPLOAD_BYTES) fail("Choose a GLB model smaller than 64 MB.");
  if (bytes.byteLength < 20) malformed();
  const binary = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (binary.getUint32(0, true) !== GLB_MAGIC || binary.getUint32(4, true) !== 2 || binary.getUint32(8, true) !== bytes.byteLength) malformed();
  let offset = 12, jsonBytes: Uint8Array | null = null, binBytes: Uint8Array | null = null;
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) malformed();
    const length = binary.getUint32(offset, true), type = binary.getUint32(offset + 4, true);
    if (!length || length % 4 || offset + 8 + length > bytes.byteLength) malformed();
    if (type === JSON_CHUNK && offset === 12 && !jsonBytes) {
      if (length > MAX_MODEL3D_JSON_BYTES) fail("This model contains too much embedded metadata. Export a GLB with embedded binary textures and less than 2 MB of JSON metadata.");
      jsonBytes = bytes.subarray(offset + 8, offset + 8 + length);
    } else if (type === BIN_CHUNK && jsonBytes && !binBytes) binBytes = bytes.subarray(offset + 8, offset + 8 + length);
    else malformed();
    offset += length + 8;
  }
  if (!jsonBytes) malformed();
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(jsonBytes!).trim()); }
  catch { malformed(); }
  const json = record(parsed);
  if (!json || record(json.asset)?.version !== "2.0" || (record(json.asset)?.minVersion !== undefined && record(json.asset)?.minVersion !== "2.0")) malformed();
  return { asset: { mimeType: MODEL3D_MIME_TYPE, format: "glb", json: json!, byteLength: bytes.byteLength }, binBytes };
}

/**
 * Check bounded GLB 2 framing and its JSON asset version for retained exports.
 * This does not establish self-contained resources, valid geometry, or viewer
 * compatibility. Use validateModel3dAsset before loading an interactive preview.
 */
export function validateModel3dContainer(input: Uint8Array | ArrayBuffer): Model3dContainer {
  return parseModel3dContainer(input).asset;
}

/** Parse bounded, self-contained GLB bytes before any viewer or provider touches their contents. */
export function validateModel3dAsset(input: Uint8Array | ArrayBuffer, mimeType: unknown = MODEL3D_MIME_TYPE): Model3dContainer {
  if (String(mimeType).split(";")[0]!.trim().toLowerCase() !== MODEL3D_MIME_TYPE) fail("Choose a self-contained GLB (.glb) model.");
  const { asset, binBytes } = parseModel3dContainer(input), model = asset.json;
  // A bounded walk catches URLs hidden in extensions as well as standard textures/buffers.
  let entries = 0;
  const walk = (value: unknown, depth: number, metadata = false) => {
    if (++entries > 200_000 || depth > 64) fail("This model is too complex to inspect safely. Simplify it and export another GLB.");
    if (typeof value === "number" && !Number.isFinite(value)) malformed();
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (!metadata && key === "extensions" && (!record(child) || !Object.values(child as Record<string, unknown>).every(extension => Boolean(record(extension))))) malformed();
      if (!metadata && DECODER_EXTENSIONS.has(key)) fail("This model requires a compressed-mesh or texture decoder. Export an uncompressed GLB with PNG, JPEG, or WebP textures.");
      if (!metadata && /^(?:uri|url)$/i.test(key)) {
        if (typeof child !== "string" || !/^data:(?:image\/(?:png|jpeg|webp)|application\/(?:octet-stream|gltf-buffer));base64,[A-Za-z0-9+/]*={0,2}$/.test(child)) {
          fail("This model links to external files. Embed every texture and buffer, then export a self-contained GLB.");
        }
        const encoded = child.slice(child.indexOf(",") + 1);
        if (!encoded.length || encoded.length % 4) malformed();
      }
      walk(child, depth + 1, metadata || key === "extras");
    }
  };
  walk(model, 0);
  for (const property of ["extensionsUsed", "extensionsRequired"] as const) {
    if (model[property] !== undefined && (!Array.isArray(model[property]) || !(model[property] as unknown[]).every((item) => typeof item === "string"))) malformed();
    const extensions = (model[property] ?? []) as string[];
    if (new Set(extensions).size !== extensions.length) malformed();
    for (const extension of extensions) {
      if (DECODER_EXTENSIONS.has(extension)) fail("This model requires a compressed-mesh or texture decoder. Export an uncompressed GLB with PNG, JPEG, or WebP textures.");
      if (property === "extensionsRequired" && !(model.extensionsUsed as string[] | undefined)?.includes(extension)) malformed();
      if (property === "extensionsRequired" && !SUPPORTED_REQUIRED_EXTENSIONS.has(extension)) fail("This model requires an unsupported glTF extension. Export a standard GLB with embedded textures.");
    }
  }
  const array = (key: string): Record<string, unknown>[] => {
    if (model[key] === undefined) return [];
    if (!Array.isArray(model[key]) || !(model[key] as unknown[]).every((value) => Boolean(record(value)))) malformed();
    return model[key] as Record<string, unknown>[];
  };
  const buffers = array("buffers"), views = array("bufferViews"), accessors = array("accessors"), meshes = array("meshes"), nodes = array("nodes"), scenes = array("scenes");
  if (buffers.length > 1 || meshes.length > 10_000 || nodes.length > 20_000 || accessors.length > 50_000) fail("This model is too complex to preview. Simplify its geometry and export another GLB.");
  const buffer = buffers[0];
  let bufferBytes: Uint8Array = new Uint8Array(0);
  if (buffer) {
    if (!integer(buffer.byteLength, 1)) malformed();
    if (buffer.uri !== undefined) {
      if (binBytes || typeof buffer.uri !== "string" || !buffer.uri.startsWith("data:application/")) malformed();
      bufferBytes = embeddedData(String(buffer.uri));
      if (bufferBytes.length !== buffer.byteLength) malformed();
    } else {
      if (!binBytes || binBytes.length < Number(buffer.byteLength) || binBytes.length - Number(buffer.byteLength) > 3) malformed();
      for (let at = Number(buffer.byteLength); at < binBytes!.length; at += 1) if (binBytes![at] !== 0) malformed();
      bufferBytes = binBytes!.subarray(0, Number(buffer.byteLength));
    }
  } else if (binBytes || views.length) malformed();
  const bufferData = new DataView(bufferBytes.buffer, bufferBytes.byteOffset, bufferBytes.byteLength);
  for (const view of views) {
    if (view.buffer !== 0 || !integer(view.byteLength, 1) || !integer(view.byteOffset ?? 0) || Number(view.byteOffset ?? 0) + Number(view.byteLength) > Number(buffer?.byteLength ?? 0)) malformed();
    if (view.byteStride !== undefined && (!integer(view.byteStride, 4) || view.byteStride > 252 || view.byteStride % 4)) malformed();
    if (view.target !== undefined && view.target !== 34962 && view.target !== 34963) malformed();
  }
  const components: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
  const widths: Record<string, number> = { "5120": 1, "5121": 1, "5122": 2, "5123": 2, "5125": 4, "5126": 4 };
  type AccessorLayout = { start: number; stride: number; width: number; count: number; matrixSize: number; columnStride: number; present: boolean };
  const layouts: AccessorLayout[] = [];
  let decodedAccessorBytes = 0;
  for (const accessor of accessors) {
    if (!integer(accessor.count, 1) || accessor.count > MAX_MODEL3D_ACCESSOR_ELEMENTS || !components[String(accessor.type)] || !integer(accessor.componentType) || !widths[String(accessor.componentType)] || !integer(accessor.byteOffset ?? 0)) malformed();
    const width = widths[String(accessor.componentType)]!, componentCount = components[String(accessor.type)]!;
    decodedAccessorBytes += Number(accessor.count) * componentCount * width;
    if (decodedAccessorBytes > MAX_MODEL3D_UPLOAD_BYTES) fail("This model expands into too much vertex data. Simplify its geometry and export another GLB.");
    const matrixSize = /^MAT[234]$/.test(String(accessor.type)) ? Number(String(accessor.type).slice(3)) : 0;
    const columnStride = matrixSize ? Math.ceil(matrixSize * width / 4) * 4 : 0;
    const size = matrixSize ? matrixSize * columnStride : componentCount * width;
    // Padding after the final matrix column may be omitted at the end of a view.
    const occupiedSize = matrixSize ? (matrixSize - 1) * columnStride + matrixSize * width : size;
    let start = 0, stride = size;
    if (accessor.normalized !== undefined && typeof accessor.normalized !== "boolean") malformed();
    if (accessor.normalized === true && ![5120, 5121, 5122, 5123].includes(Number(accessor.componentType))) malformed();
    if (Number(accessor.byteOffset ?? 0) % width) malformed();
    if (accessor.bufferView !== undefined) {
      if (!integer(accessor.bufferView) || !views[accessor.bufferView]) malformed();
      const view = views[Number(accessor.bufferView)]!;
      stride = Number(view.byteStride ?? size);
      start = Number(view.byteOffset ?? 0) + Number(accessor.byteOffset ?? 0);
      if (start % width || matrixSize && start % 4 || stride < size || Number(accessor.byteOffset ?? 0) + (Number(accessor.count) - 1) * stride + occupiedSize > Number(view.byteLength)) malformed();
    } else if (accessor.byteOffset !== undefined) malformed();
    for (const bound of [accessor.min, accessor.max]) {
      if (bound !== undefined && (!Array.isArray(bound) || bound.length !== componentCount || !bound.every(value => typeof value === "number" && Number.isFinite(value)))) malformed();
    }
    if (Array.isArray(accessor.min) && Array.isArray(accessor.max) && accessor.min.some((value, index) => value > (accessor.max as number[])[index]!)) malformed();
    layouts.push({ start, stride, width, count: componentCount, matrixSize, columnStride, present: accessor.bufferView !== undefined });
    // Sparse accessor handling adds unbounded expansion paths; ordinary exporters can materialize them.
    if (accessor.sparse !== undefined) fail("This model uses sparse geometry. Export a GLB with fully materialized vertex buffers.");
  }
  let componentReads = 0;
  const readComponent = (accessorIndex: number, element: number, component: number) => {
    if (++componentReads > MAX_MODEL3D_COMPONENT_READS) fail("This model is too complex to inspect safely. Simplify it and export another GLB.");
    const accessor = accessors[accessorIndex]!, layout = layouts[accessorIndex]!;
    if (!layout.present) return 0;
    const componentOffset = layout.matrixSize ? Math.floor(component / layout.matrixSize) * layout.columnStride + component % layout.matrixSize * layout.width : component * layout.width;
    const at = layout.start + element * layout.stride + componentOffset;
    switch (accessor.componentType) {
      case 5120: return bufferData.getInt8(at);
      case 5121: return bufferData.getUint8(at);
      case 5122: return bufferData.getInt16(at, true);
      case 5123: return bufferData.getUint16(at, true);
      case 5125: return bufferData.getUint32(at, true);
      case 5126: { const value = bufferData.getFloat32(at, true); if (!Number.isFinite(value)) malformed(); return value; }
      default: return malformed();
    }
  };
  const checkedAccessors = new Set<number>();
  const checkNumericAccessor = (index: number) => {
    if (checkedAccessors.has(index)) return;
    checkedAccessors.add(index);
    const accessor = accessors[index]!;
    if (accessor.componentType !== 5126) return;
    for (let element = 0; element < Number(accessor.count); element += 1) {
      for (let component = 0; component < layouts[index]!.count; component += 1) readComponent(index, element, component);
    }
  };
  let vertices = 0;
  const materials = array("materials"), textures = array("textures"), images = array("images"), samplers = array("samplers"), animations = array("animations"), skins = array("skins"), cameras = array("cameras");
  const validReference = (value: unknown, target: unknown[]) => integer(value) && value < target.length;
  const quantized = (model.extensionsUsed as string[] | undefined)?.includes("KHR_mesh_quantization") ?? false;
  for (const mesh of meshes) {
    if (!Array.isArray(mesh.primitives) || !mesh.primitives.length) malformed();
    for (const value of mesh.primitives as unknown[]) {
      const primitive = record(value), attributes = record(primitive?.attributes), position = attributes?.POSITION;
      if (!primitive || !attributes || !validReference(position, accessors) || accessors[Number(position)]!.type !== "VEC3") malformed();
      const positionAccessor = accessors[Number(position)]!, vertexCount = Number(positionAccessor.count);
      if (!Array.isArray(positionAccessor.min) || !Array.isArray(positionAccessor.max) || positionAccessor.componentType !== 5126 && !(quantized && [5120, 5121, 5122, 5123].includes(Number(positionAccessor.componentType)))) malformed();
      if (vertexCount > MAX_MODEL3D_VERTICES) fail("Choose a GLB containing visible mesh geometry with at most 2 million vertices.");
      vertices += vertexCount;
      for (const [semantic, index] of Object.entries(attributes!)) {
        if (!validReference(index, accessors)) malformed();
        const accessor = accessors[Number(index)]!, layout = layouts[Number(index)]!, view = views[Number(accessor.bufferView)];
        if (accessor.count !== vertexCount || layout.start % 4 || layout.stride % 4 || view?.target === 34963 || accessor.componentType === 5125) malformed();
        const expected = semantic === "POSITION" || semantic === "NORMAL" ? ["VEC3"] : semantic === "TANGENT" || /^(?:JOINTS|WEIGHTS)_[0-9]+$/.test(semantic) ? ["VEC4"] : /^TEXCOORD_[0-9]+$/.test(semantic) ? ["VEC2"] : /^COLOR_[0-9]+$/.test(semantic) ? ["VEC3", "VEC4"] : null;
        if (expected ? !expected.includes(String(accessor.type)) : !semantic.startsWith("_")) malformed();
        checkNumericAccessor(Number(index));
      }
      if (primitive!.material !== undefined && !validReference(primitive!.material, materials)) malformed();
      const mode = primitive!.mode ?? 4;
      if (!integer(mode) || mode > 6) malformed();
      let drawnVertices = vertexCount;
      if (primitive!.indices !== undefined) {
        if (!validReference(primitive!.indices, accessors)) malformed();
        const index = Number(primitive!.indices), accessor = accessors[index]!, view = views[Number(accessor.bufferView)];
        if (accessor.type !== "SCALAR" || ![5121, 5123, 5125].includes(Number(accessor.componentType)) || accessor.normalized === true || view?.byteStride !== undefined || view?.target === 34962) malformed();
        drawnVertices = Number(accessor.count);
        for (let at = 0; at < drawnVertices; at += 1) if (readComponent(index, at, 0) >= vertexCount) malformed();
      }
      if (mode === 1 && drawnVertices % 2 || mode === 4 && drawnVertices % 3 || [2, 3].includes(Number(mode)) && drawnVertices < 2 || [5, 6].includes(Number(mode)) && drawnVertices < 3) malformed();
      if (primitive!.targets !== undefined) {
        if (!Array.isArray(primitive!.targets)) malformed();
        for (const target of primitive!.targets as unknown[]) {
          if (!record(target)) malformed();
          for (const index of Object.values(target as Record<string, unknown>)) {
            if (!validReference(index, accessors) || accessors[Number(index)]!.count !== vertexCount) malformed();
            checkNumericAccessor(Number(index));
          }
        }
      }
    }
  }
  if (!meshes.length || vertices > MAX_MODEL3D_VERTICES) fail("Choose a GLB containing visible mesh geometry with at most 2 million vertices.");
  let decodedImagePixels = 0;
  for (const image of images) {
    let imageBytes: Uint8Array, mime: string;
    if (image.uri !== undefined) {
      if (image.bufferView !== undefined || typeof image.uri !== "string" || !image.uri.startsWith("data:image/")) malformed();
      const uri = String(image.uri);
      mime = uri.slice(5, uri.indexOf(";"));
      if (image.mimeType !== undefined && image.mimeType !== mime) malformed();
      imageBytes = embeddedData(uri);
    } else {
      if (!integer(image.bufferView) || !views[image.bufferView] || !["image/png", "image/jpeg", "image/webp"].includes(String(image.mimeType))) malformed();
      const view = views[Number(image.bufferView)]!;
      if (view.byteStride !== undefined || view.target !== undefined) malformed();
      imageBytes = bufferBytes.subarray(Number(view.byteOffset ?? 0), Number(view.byteOffset ?? 0) + Number(view.byteLength));
      mime = String(image.mimeType);
    }
    decodedImagePixels += validateEmbeddedImage(imageBytes, mime);
    if (decodedImagePixels > 128_000_000) fail("This model expands into too much texture data. Resize its textures before exporting the GLB.");
  }
  for (const texture of textures) {
    const webpSource = record(record(texture.extensions)?.EXT_texture_webp)?.source;
    if (texture.source !== undefined && !validReference(texture.source, images) || webpSource !== undefined && !validReference(webpSource, images) || texture.source === undefined && webpSource === undefined) malformed();
    if (texture.sampler !== undefined && !validReference(texture.sampler, samplers)) malformed();
  }
  for (const sampler of samplers) {
    if (sampler.magFilter !== undefined && ![9728, 9729].includes(sampler.magFilter as number) || sampler.minFilter !== undefined && ![9728, 9729, 9984, 9985, 9986, 9987].includes(sampler.minFilter as number)) malformed();
    for (const wrap of [sampler.wrapS, sampler.wrapT]) if (wrap !== undefined && ![33071, 33648, 10497].includes(wrap as number)) malformed();
  }
  const materialTextures = (value: unknown) => {
    if (!record(value)) return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (/Texture$/.test(key)) {
        const texture = record(child);
        if (!texture || !validReference(texture.index, textures) || texture.texCoord !== undefined && !integer(texture.texCoord)) malformed();
      } else materialTextures(child);
    }
  };
  materials.forEach(materialTextures);
  const lighting = record(record(model.extensions)?.KHR_lights_punctual);
  if (lighting && (!Array.isArray(lighting.lights) || !lighting.lights.length || !lighting.lights.every(value => Boolean(record(value))))) malformed();
  const lights = (lighting?.lights ?? []) as Record<string, unknown>[];
  for (const light of lights) {
    if (!["directional", "point", "spot"].includes(String(light.type))) malformed();
    if (light.color !== undefined && (!Array.isArray(light.color) || light.color.length !== 3 || !light.color.every(value => typeof value === "number" && value >= 0 && value <= 1))) malformed();
    if (light.intensity !== undefined && (typeof light.intensity !== "number" || light.intensity < 0) || light.range !== undefined && (typeof light.range !== "number" || light.range <= 0)) malformed();
    if (light.type === "spot") {
      const spot = record(light.spot);
      if (light.spot !== undefined && !spot) malformed();
      const inner = spot?.innerConeAngle ?? 0, outer = spot?.outerConeAngle ?? Math.PI / 4;
      if (typeof inner !== "number" || typeof outer !== "number" || inner < 0 || outer > Math.PI / 2 || inner >= outer) malformed();
    }
  }
  // Cyclic or multiply parented node trees would recurse indefinitely in a scene loader.
  const parents = new Set<number>();
  let instanceMatrixBytes = 0;
  for (const node of nodes) {
    if (node.mesh !== undefined && (!integer(node.mesh) || !meshes[node.mesh])) malformed();
    if (node.skin !== undefined && (!validReference(node.skin, skins) || node.mesh === undefined) || node.camera !== undefined && !validReference(node.camera, cameras)) malformed();
    if (node.matrix !== undefined && (node.translation !== undefined || node.rotation !== undefined || node.scale !== undefined)) malformed();
    for (const [key, length] of [["matrix", 16], ["translation", 3], ["rotation", 4], ["scale", 3]] as const) {
      const value = node[key];
      if (value !== undefined && (!Array.isArray(value) || value.length !== length || !value.every(component => typeof component === "number" && Number.isFinite(component)))) malformed();
    }
    const instancing = record(record(node.extensions)?.EXT_mesh_gpu_instancing);
    if (instancing) {
      const attributes = record(instancing.attributes);
      if (!attributes || !Object.keys(attributes).length || !validReference(node.mesh, meshes)) malformed();
      let count = 0;
      for (const [semantic, index] of Object.entries(attributes!)) {
        if (!validReference(index, accessors)) malformed();
        const accessor = accessors[Number(index)]!;
        if (count && count !== accessor.count) malformed();
        if (semantic === "TRANSLATION" || semantic === "SCALE") {
          if (accessor.type !== "VEC3" || accessor.componentType !== 5126) malformed();
        } else if (semantic === "ROTATION") {
          if (accessor.type !== "VEC4" || accessor.componentType !== 5126 && !([5120, 5122].includes(Number(accessor.componentType)) && accessor.normalized === true)) malformed();
        } else if (!semantic.startsWith("_")) malformed();
        count = Number(accessor.count);
        checkNumericAccessor(Number(index));
      }
      instanceMatrixBytes += count * 16 * 4 * (meshes[Number(node.mesh)]!.primitives as unknown[]).length;
      if (instanceMatrixBytes > MAX_MODEL3D_UPLOAD_BYTES) fail("This model expands into too many mesh instances. Reduce its instances and export another GLB.");
    }
    const light = record(record(node.extensions)?.KHR_lights_punctual);
    if (light && !validReference(light.light, lights)) malformed();
    if (node.children !== undefined && !Array.isArray(node.children)) malformed();
    for (const child of (node.children ?? []) as unknown[]) {
      if (!integer(child) || !nodes[child] || parents.has(child)) malformed();
      parents.add(Number(child));
    }
  }
  const visiting = new Set<number>(), visited = new Set<number>();
  const visit = (index: number, depth: number) => {
    if (depth > 128 || visiting.has(index)) malformed();
    if (visited.has(index)) return;
    visiting.add(index);
    for (const child of (nodes[index]?.children ?? []) as number[]) visit(child, depth + 1);
    visiting.delete(index); visited.add(index);
  };
  nodes.forEach((_, index) => visit(index, 0));
  for (const scene of scenes) {
    const roots = scene.nodes ?? [];
    if (!Array.isArray(roots) || new Set(roots).size !== roots.length || !(roots as unknown[]).every((index) => integer(index) && Boolean(nodes[index]) && !parents.has(index))) malformed();
  }
  if (model.scene !== undefined && (!integer(model.scene) || !scenes[model.scene])) malformed();
  for (const skin of skins) {
    if (!Array.isArray(skin.joints) || !skin.joints.length || new Set(skin.joints).size !== skin.joints.length || !skin.joints.every(index => validReference(index, nodes))) malformed();
    if (skin.skeleton !== undefined && !validReference(skin.skeleton, nodes)) malformed();
    if (skin.inverseBindMatrices !== undefined) {
      if (!validReference(skin.inverseBindMatrices, accessors)) malformed();
      const accessor = accessors[Number(skin.inverseBindMatrices)]!;
      if (accessor.type !== "MAT4" || accessor.componentType !== 5126 || Number(accessor.count) < (skin.joints as unknown[]).length) malformed();
      checkNumericAccessor(Number(skin.inverseBindMatrices));
    }
  }
  for (const animation of animations) {
    if (!Array.isArray(animation.samplers) || !animation.samplers.length || !Array.isArray(animation.channels) || !animation.channels.length) malformed();
    const animationSamplers = animation.samplers as unknown[];
    for (const value of animationSamplers) {
      const sampler = record(value);
      if (!sampler || !validReference(sampler.input, accessors) || !validReference(sampler.output, accessors) || !["LINEAR", "STEP", "CUBICSPLINE"].includes(String(sampler.interpolation ?? "LINEAR"))) malformed();
      const input = accessors[Number(sampler!.input)]!, output = accessors[Number(sampler!.output)]!;
      if (input.type !== "SCALAR" || input.componentType !== 5126 || output.componentType !== 5126) malformed();
      let previous = -1;
      for (let at = 0; at < Number(input.count); at += 1) {
        const time = readComponent(Number(sampler!.input), at, 0);
        if (time < 0 || time <= previous) malformed();
        previous = time;
      }
      checkNumericAccessor(Number(sampler!.output));
    }
    for (const value of animation.channels as unknown[]) {
      const channel = record(value), target = record(channel?.target);
      if (!channel || !validReference(channel.sampler, animationSamplers) || !target || target.node !== undefined && !validReference(target.node, nodes) || !["translation", "rotation", "scale", "weights"].includes(String(target?.path))) malformed();
      const sampler = record(animationSamplers[Number(channel!.sampler)])!;
      const input = accessors[Number(sampler.input)]!, output = accessors[Number(sampler.output)]!;
      const multiplier = sampler.interpolation === "CUBICSPLINE" ? 3 : 1;
      if (target!.path === "weights") {
        if (output.type !== "SCALAR" || Number(output.count) % (Number(input.count) * multiplier)) malformed();
      } else if (output.type !== (target!.path === "rotation" ? "VEC4" : "VEC3") || output.count !== Number(input.count) * multiplier) malformed();
    }
  }
  for (const camera of cameras) {
    if (camera.type !== "perspective" && camera.type !== "orthographic") malformed();
    const settings = record(camera[String(camera.type)]);
    if (!settings) malformed();
    const positive = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0;
    if (camera.type === "perspective") {
      if (!positive(settings!.znear) || !positive(settings!.yfov) || Number(settings!.yfov) >= Math.PI || settings!.zfar !== undefined && (!positive(settings!.zfar) || Number(settings!.zfar) <= Number(settings!.znear)) || settings!.aspectRatio !== undefined && !positive(settings!.aspectRatio)) malformed();
    } else if (!positive(settings!.xmag) || !positive(settings!.ymag) || !positive(settings!.zfar) || typeof settings!.znear !== "number" || settings!.znear < 0 || Number(settings!.znear) >= Number(settings!.zfar)) malformed();
  }
  return asset;
}
