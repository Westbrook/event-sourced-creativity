/** A bounded ZIP STORE writer for delivery packages, independent of Office limits. */
export type OutputDeliveryZipEntry = { name: string; content: Uint8Array };
const encoder = new TextEncoder();
const MAX_ZIP_BYTES = 68 * 1024 * 1024 + 128 * 1024;
const MAX_ZIP_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 66; // 64 files and the JSON/CSV manifests.
const STREAM_CHUNK_BYTES = 64 * 1024;
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ crc >>> 1 : crc >>> 1;
  return crc >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) crc = crcTable[(crc ^ bytes[index]!) & 255]! ^ crc >>> 8;
  return (crc ^ 0xffffffff) >>> 0;
}
type PreparedEntry = { filename: Uint8Array; content: Uint8Array; byteLength: number; crc: number; offset: number };
type PreparedZip = { entries: PreparedEntry[]; localSize: number; centralSize: number; byteLength: number };
function prepareZip(entries: OutputDeliveryZipEntry[]): PreparedZip {
  if (!Array.isArray(entries) || !entries.length || entries.length > MAX_ZIP_ENTRIES) throw new Error("invalid_output_delivery_zip");
  const seen = new Set<string>();
  let localSize = 0, centralSize = 0;
  const prepared = entries.map(({ name, content }) => {
    if (typeof name !== "string" || !name || name.startsWith("/") || name.includes("\\") || /\p{Cc}/u.test(name)
      || name.split("/").some(segment => !segment || segment === "." || segment === "..") || seen.has(name.toLowerCase())) throw new Error("invalid_output_delivery_zip_path");
    const filename = encoder.encode(name);
    if (filename.byteLength > 1024 || !(content instanceof Uint8Array) || content.byteLength > MAX_ZIP_ENTRY_BYTES) throw new Error("output_delivery_zip_entry_too_large");
    seen.add(name.toLowerCase());
    const offset = localSize;
    localSize += 30 + filename.byteLength + content.byteLength;
    centralSize += 46 + filename.byteLength;
    if (localSize + centralSize + 22 > MAX_ZIP_BYTES) throw new Error("output_delivery_archive_too_large");
    return { filename, content, byteLength: content.byteLength, crc: 0, offset };
  });
  // Validate every size and path before reading large payloads for checksums.
  for (const entry of prepared) entry.crc = crc32(entry.content);
  return { entries: prepared, localSize, centralSize, byteLength: localSize + centralSize + 22 };
}
function localHeader(entry: PreparedEntry): Uint8Array {
  const header = new Uint8Array(30 + entry.filename.byteLength), view = new DataView(header.buffer);
  view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x0800, true);
  view.setUint16(12, 0x21, true); view.setUint32(14, entry.crc, true);
  view.setUint32(18, entry.byteLength, true); view.setUint32(22, entry.byteLength, true);
  view.setUint16(26, entry.filename.byteLength, true); header.set(entry.filename, 30);
  return header;
}
function centralHeader(entry: PreparedEntry): Uint8Array {
  const header = new Uint8Array(46 + entry.filename.byteLength), view = new DataView(header.buffer);
  view.setUint32(0, 0x02014b50, true); view.setUint16(4, 20, true); view.setUint16(6, 20, true); view.setUint16(8, 0x0800, true);
  view.setUint16(14, 0x21, true); view.setUint32(16, entry.crc, true);
  view.setUint32(20, entry.byteLength, true); view.setUint32(24, entry.byteLength, true);
  view.setUint16(28, entry.filename.byteLength, true); view.setUint32(42, entry.offset, true);
  header.set(entry.filename, 46);
  return header;
}
function endRecord(zip: PreparedZip): Uint8Array {
  const end = new Uint8Array(22), view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true); view.setUint16(8, zip.entries.length, true); view.setUint16(10, zip.entries.length, true);
  view.setUint32(12, zip.centralSize, true); view.setUint32(16, zip.localSize, true);
  return end;
}

/** Inputs must remain privately owned and immutable until this call returns. */
export function createOutputDeliveryZip(entries: OutputDeliveryZipEntry[]): Uint8Array {
  const zip = prepareZip(entries), bytes = new Uint8Array(zip.byteLength);
  let central = zip.localSize;
  for (const entry of zip.entries) {
    const header = localHeader(entry);
    bytes.set(header, entry.offset); bytes.set(entry.content, entry.offset + header.byteLength);
    const directory = centralHeader(entry); bytes.set(directory, central); central += directory.byteLength;
  }
  bytes.set(endRecord(zip), central);
  return bytes;
}

/**
 * Reads privately owned, immutable inputs with bounded output buffering. No full
 * ZIP buffer is allocated. Chunk copies prevent consumers from mutating an
 * unread portion of an input through a returned chunk's backing ArrayBuffer.
 * Canceling releases the writer's input references without processing more data.
 */
export function streamOutputDeliveryZip(entries: OutputDeliveryZipEntry[]): { stream: ReadableStream<Uint8Array>; byteLength: number } {
  const zip = prepareZip(entries);
  let index = 0, bodyOffset = 0;
  let phase: "local" | "body" | "central" | "end" = "local";
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      // Empty STORE entries have a local header and directory record but no
      // body chunk. Advance in this pull so a pending read cannot be stranded.
      if (phase === "body" && zip.entries[index]!.byteLength === 0) {
        index += 1;
        if (index === zip.entries.length) { index = 0; phase = "central"; } else phase = "local";
      }
      if (phase === "local") {
        const entry = zip.entries[index]!;
        controller.enqueue(localHeader(entry)); phase = "body";
        return;
      }
      if (phase === "body") {
        const entry = zip.entries[index]!, end = Math.min(bodyOffset + STREAM_CHUNK_BYTES, entry.byteLength);
        // Buffer.slice (a Uint8Array subclass) aliases the source. An explicit
        // Uint8Array construction also guarantees copying for that input type.
        if (end > bodyOffset) controller.enqueue(new Uint8Array(entry.content.subarray(bodyOffset, end)));
        bodyOffset = end;
        if (bodyOffset === entry.byteLength) {
          entry.content = new Uint8Array(0); bodyOffset = 0; index += 1;
          if (index === zip.entries.length) { index = 0; phase = "central"; } else phase = "local";
        }
        return;
      }
      if (phase === "central") {
        controller.enqueue(centralHeader(zip.entries[index]!)); index += 1;
        if (index === zip.entries.length) phase = "end";
        return;
      }
      controller.enqueue(endRecord(zip)); controller.close(); zip.entries.length = 0;
    },
    cancel() { zip.entries.length = 0; },
  }, { highWaterMark: 1 });
  return { stream, byteLength: zip.byteLength };
}
