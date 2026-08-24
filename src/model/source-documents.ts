const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
const MAX_ENTRY_BYTES = 2 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 5 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 2_000;
const MAX_SOURCE_CHARACTERS = 120_000;
const MAX_SOURCE_SEGMENTS = 120;

export type SourceDocumentSegment = { anchor: string; text: string };
export type SourceDocumentExtraction = {
  status: "ready" | "unavailable";
  text: string;
  segments: SourceDocumentSegment[];
  sourceKind: "text" | "pdf" | "word" | "presentation" | "spreadsheet" | "unsupported";
  truncated: boolean;
  message: string;
};

/** Canonical, server-issued evidence bound to the exact uploaded source. */
export type SourceDocumentEvidence = {
  version: 1;
  contentHash: string;
  mimeType: string;
  status: SourceDocumentExtraction["status"];
  sourceKind: SourceDocumentExtraction["sourceKind"];
  text: string;
  citations: Array<{ anchor: string; excerpt: string }>;
  segmentCount: number;
  truncated: boolean;
};

export function sourceDocumentEvidence(extraction: SourceDocumentExtraction, contentHash: string, mimeType: string): SourceDocumentEvidence {
  return {
    version: 1,
    contentHash,
    mimeType,
    status: extraction.status,
    sourceKind: extraction.sourceKind,
    text: extraction.text,
    citations: extraction.segments.map((segment) => ({ anchor: segment.anchor, excerpt: segment.text })),
    segmentCount: extraction.segments.length,
    truncated: extraction.truncated,
  };
}

export function sourceDocumentEvidenceFromProperties(properties: Record<string, unknown>, contentHash: string, mimeType: string): SourceDocumentEvidence {
  const citations = Array.isArray(properties.source_citations)
    ? properties.source_citations.map((candidate) => {
      const item = candidate && typeof candidate === "object" ? candidate as Record<string, unknown> : {};
      return { anchor: String(item.anchor ?? ""), excerpt: String(item.excerpt ?? "") };
    })
    : [];
  return {
    version: 1,
    contentHash,
    mimeType,
    status: properties.extraction_status === "ready" ? "ready" : "unavailable",
    sourceKind: String(properties.source_kind ?? "unsupported") as SourceDocumentEvidence["sourceKind"],
    text: String(properties.text ?? ""),
    citations,
    segmentCount: Number(properties.source_segment_count ?? 0),
    truncated: Boolean(properties.source_excerpt_truncated),
  };
}

export async function sourceDocumentEvidenceDigest(evidence: SourceDocumentEvidence): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(evidence)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const utf8 = new TextDecoder();
const decodeXml = (value: string) => value
  .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Math.min(0x10ffff, Number.parseInt(code, 16))))
  .replace(/&#([0-9]+);/g, (_, code: string) => String.fromCodePoint(Math.min(0x10ffff, Number.parseInt(code, 10))))
  .replace(/&(amp|lt|gt|quot|apos);/g, (_, entity: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[entity] ?? "");
const normalizeText = (value: string) => decodeXml(value).replaceAll(String.fromCharCode(0), "").replace(/[\t ]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

function result(kind: SourceDocumentExtraction["sourceKind"], segments: SourceDocumentSegment[], unavailable: string, knownTruncated = false): SourceDocumentExtraction {
  const cleaned = segments.map((segment) => ({ anchor: segment.anchor, text: normalizeText(segment.text) })).filter((segment) => segment.text);
  if (!cleaned.length) return { status: "unavailable", text: "", segments: [], sourceKind: kind, truncated: false, message: unavailable };
  const selected = cleaned.slice(0, MAX_SOURCE_SEGMENTS);
  const assembled = selected.map((segment) => `[${segment.anchor}] ${segment.text}`).join("\n\n");
  const truncated = knownTruncated || assembled.length > MAX_SOURCE_CHARACTERS || cleaned.length > MAX_SOURCE_SEGMENTS;
  return {
    status: "ready",
    text: assembled.slice(0, MAX_SOURCE_CHARACTERS),
    segments: selected.map((segment) => ({ anchor: segment.anchor, text: segment.text.slice(0, 1_200) })),
    sourceKind: kind,
    truncated,
    message: `${selected.length} cited ${kind === "presentation" ? "slides" : kind === "spreadsheet" ? "cells" : kind === "pdf" ? "pages" : "sections"} extracted${truncated ? "; the grounded context was safely limited to 120,000 characters" : ""}.`,
  };
}

async function inflate(bytes: Uint8Array, format: "deflate" | "deflate-raw", limit = MAX_ENTRY_BYTES): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream(format));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > limit) { await reader.cancel(); throw new Error("source_expansion_limit_exceeded"); }
    chunks.push(next.value);
  }
  const output = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) { output.set(chunk, cursor); cursor += chunk.length; }
  return output;
}

type ZipEntry = { name: string; offset: number; compressed: number; expanded: number; method: number; flags: number };

function zipEntries(bytes: Uint8Array): ZipEntry[] {
  if (bytes.length < 22) throw new Error("invalid_office_document");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) { end = offset; break; }
  }
  if (end < 0 || view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 6, true) !== 0) throw new Error("invalid_office_document");
  const count = view.getUint16(end + 10, true);
  const directorySize = view.getUint32(end + 12, true);
  let cursor = view.getUint32(end + 16, true);
  if (count > MAX_ZIP_ENTRIES || cursor + directorySize > end) throw new Error("source_expansion_limit_exceeded");
  const entries: ZipEntry[] = [];
  let expandedTotal = 0;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== 0x02014b50) throw new Error("invalid_office_document");
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const compressed = view.getUint32(cursor + 20, true);
    const expanded = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const offset = view.getUint32(cursor + 42, true);
    if (cursor + 46 + nameLength + extraLength + commentLength > bytes.length || expanded > MAX_ENTRY_BYTES || compressed > MAX_SOURCE_BYTES || flags & 1 || ![0, 8].includes(method)) throw new Error("invalid_or_encrypted_office_document");
    const name = utf8.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    if (name.includes("..") || name.startsWith("/")) throw new Error("invalid_office_document");
    expandedTotal += expanded;
    if (expandedTotal > MAX_EXPANDED_BYTES || expanded > 0 && compressed > 0 && expanded / compressed > 200) throw new Error("source_expansion_limit_exceeded");
    entries.push({ name, offset, compressed, expanded, method, flags });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function readZipEntry(bytes: Uint8Array, entry: ZipEntry): Promise<string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (entry.offset + 30 > bytes.length || view.getUint32(entry.offset, true) !== 0x04034b50) throw new Error("invalid_office_document");
  const nameLength = view.getUint16(entry.offset + 26, true);
  const extraLength = view.getUint16(entry.offset + 28, true);
  const start = entry.offset + 30 + nameLength + extraLength;
  if (start + entry.compressed > bytes.length) throw new Error("invalid_office_document");
  const compressed = bytes.subarray(start, start + entry.compressed);
  const expanded = entry.method === 8 ? await inflate(compressed, "deflate-raw") : compressed;
  if (expanded.length !== entry.expanded) throw new Error("invalid_office_document");
  return utf8.decode(expanded);
}

const xmlRuns = (xml: string, prefix: string) => [...xml.matchAll(new RegExp(`<${prefix}:t(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${prefix}:t>`, "g"))].map((match) => decodeXml(match[1] ?? "")).join(" ");

async function extractOffice(bytes: Uint8Array, mime: string): Promise<SourceDocumentExtraction> {
  const entries = zipEntries(bytes);
  if (mime.includes("wordprocessingml")) {
    const document = entries.find((entry) => entry.name === "word/document.xml");
    if (!document) throw new Error("invalid_word_document");
    const xml = await readZipEntry(bytes, document);
    const paragraphs = [...xml.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)].map((match, index) => ({ anchor: `Paragraph ${index + 1}`, text: xmlRuns(match[1] ?? "", "w") }));
    return result("word", paragraphs, "This Word document contains no selectable paragraph text.");
  }
  if (mime.includes("presentationml")) {
    const slides = entries.filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry.name)).sort((left, right) => Number(left.name.match(/slide(\d+)/)?.[1] ?? 0) - Number(right.name.match(/slide(\d+)/)?.[1] ?? 0));
    const segments: SourceDocumentSegment[] = [];
    for (const slide of slides.slice(0, MAX_SOURCE_SEGMENTS)) segments.push({ anchor: `Slide ${slide.name.match(/slide(\d+)/)?.[1] ?? segments.length + 1}`, text: xmlRuns(await readZipEntry(bytes, slide), "a") });
    return result("presentation", segments, "This presentation contains no selectable slide text.", slides.length > MAX_SOURCE_SEGMENTS);
  }
  if (mime.includes("spreadsheetml")) {
    const sharedEntry = entries.find((entry) => entry.name === "xl/sharedStrings.xml");
    const shared = sharedEntry ? [...(await readZipEntry(bytes, sharedEntry)).matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map((match) => [...(match[1] ?? "").matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((part) => decodeXml(part[1] ?? "")).join(" ")) : [];
    const sheets = entries.filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/.test(entry.name)).sort((left, right) => Number(left.name.match(/sheet(\d+)/)?.[1] ?? 0) - Number(right.name.match(/sheet(\d+)/)?.[1] ?? 0));
    const segments: SourceDocumentSegment[] = [];
    let clipped=sheets.length>20;
    for (const sheet of sheets.slice(0, 20)) {
      const xml = await readZipEntry(bytes, sheet);
      for (const cell of xml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
        const attributes = cell[1] ?? "";
        const address = attributes.match(/\br="([A-Z]+\d+)"/)?.[1] ?? "";
        const raw = (cell[2] ?? "").match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? (cell[2] ?? "").match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/)?.[1] ?? "";
        const value = /\bt="s"/.test(attributes) ? shared[Number(raw)] ?? "" : decodeXml(raw);
        if (address && value.trim()) segments.push({ anchor: `Sheet ${sheet.name.match(/sheet(\d+)/)?.[1] ?? "1"} · ${address}`, text: value });
        if (segments.length >= MAX_SOURCE_SEGMENTS) { clipped=true; break; }
      }
      if (segments.length >= MAX_SOURCE_SEGMENTS) break;
    }
    return result("spreadsheet", segments, "This spreadsheet contains no readable cell values.", clipped);
  }
  return result("unsupported", [], "This document format cannot be safely extracted.");
}

function decodePdfLiteral(value: string): string {
  return value.replace(/\\([0-7]{1,3}|[nrtbf()\\]|\r?\n)/g, (_, escaped: string) => {
    if (/^[0-7]+$/.test(escaped)) return String.fromCharCode(Number.parseInt(escaped, 8));
    return ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\", "\n": "", "\r\n": "" } as Record<string, string>)[escaped] ?? escaped;
  });
}

function pdfText(stream: string): string {
  const values: string[] = [];
  for (const operation of stream.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj|\[([\s\S]*?)\]\s*TJ|<([0-9a-f\s]+)>\s*Tj/gi)) {
    if (operation[1] !== undefined) values.push(decodePdfLiteral(operation[1]));
    else if (operation[2] !== undefined) values.push([...operation[2].matchAll(/\(((?:\\.|[^\\)])*)\)/g)].map((part) => decodePdfLiteral(part[1] ?? "")).join(""));
    else if (operation[3] !== undefined) {
      const hex = operation[3].replace(/\s+/g, "");
      const bytes = new Uint8Array((hex.length / 2) | 0);
      for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
      values.push(bytes[0] === 0xfe && bytes[1] === 0xff ? new TextDecoder("utf-16be").decode(bytes.subarray(2)) : utf8.decode(bytes));
    }
  }
  return values.join(" ");
}

async function extractPdf(bytes: Uint8Array): Promise<SourceDocumentExtraction> {
  const latin = new TextDecoder("latin1").decode(bytes);
  if (!latin.startsWith("%PDF-") || /\/Encrypt\b/.test(latin)) return result("pdf", [], "This PDF is encrypted, damaged, or unavailable for safe text extraction.");
  const segments: SourceDocumentSegment[] = [];
  const objects=[...latin.matchAll(/(\d+)\s+\d+\s+obj\b([\s\S]*?)endobj/g)];
  const pages=objects.filter((object)=>/\/Type\s*\/Page\b(?!s)/.test(object[2]??""));
  const streamPages=new Map<string,number>();
  for(const [index,page] of pages.entries()){
    streamPages.set(page[1]??"",index+1);
    const content=page[2]?.match(/\/Contents\s*(\[[\s\S]*?\]|\d+\s+\d+\s+R)/)?.[1]??"";
    for(const reference of content.matchAll(/(\d+)\s+\d+\s+R/g))streamPages.set(reference[1]??"",index+1);
  }
  const streamPattern = /\bstream\r?\n/g;
  let candidate: RegExpExecArray | null;
  let page = 0;
  let expanded = 0;
  while ((candidate = streamPattern.exec(latin)) && segments.length < MAX_SOURCE_SEGMENTS) {
    const start = streamPattern.lastIndex;
    const end = latin.indexOf("endstream", start);
    if (end < 0) break;
    const dictionary = latin.slice(Math.max(0, candidate.index - 800), candidate.index);
    if (/\/Subtype\s*\/Image\b/.test(dictionary.slice(-350))) { streamPattern.lastIndex = end + 9; continue; }
    let content = bytes.subarray(start, latin.charCodeAt(end - 1) === 10 ? (latin.charCodeAt(end - 2) === 13 ? end - 2 : end - 1) : end);
    try { if (/\/Filter\s*(?:\[\s*)?\/FlateDecode\b/.test(dictionary.slice(-350))) content = await inflate(content, "deflate"); }
    catch { streamPattern.lastIndex = end + 9; continue; }
    expanded += content.length;
    if (expanded > MAX_EXPANDED_BYTES) throw new Error("source_expansion_limit_exceeded");
    const extracted = pdfText(new TextDecoder("latin1").decode(content));
    if(extracted.trim()){
      const preceding=latin.slice(0,candidate.index);
      const object=[...preceding.matchAll(/(\d+)\s+\d+\s+obj\b/g)].at(-1)?.[1]??"";
      const actualPage=streamPages.get(object)??(pages.length===1?1:pages.length?null:++page);
      const anchor=actualPage===null?`Document section ${segments.length+1} · page not verified`:`Page ${actualPage}`;
      const prior=segments.find((segment)=>segment.anchor===anchor);
      if(prior)prior.text+=`\n${extracted}`;else segments.push({anchor,text:extracted});
    }
    streamPattern.lastIndex = end + 9;
  }
  return result("pdf", segments, "This PDF contains no selectable text. Scanned pages require OCR, which is not currently available.",pages.length>MAX_SOURCE_SEGMENTS);
}

/** Extract bounded, cited source evidence locally; document bytes never leave Forma. */
export async function extractSourceDocument(file: Pick<File, "type" | "size" | "arrayBuffer" | "text">): Promise<SourceDocumentExtraction> {
  if (file.size > MAX_SOURCE_BYTES) return result("unsupported", [], "This source exceeds the 12 MB upload limit.");
  const mime = file.type.toLowerCase();
  if (["text/plain", "text/markdown", "text/csv", "application/json"].includes(mime)) {
    const text = await file.text();
    const lines = text.split(/\r?\n/);
    const segments: SourceDocumentSegment[] = [];
    for (let index = 0; index < lines.length && segments.length < MAX_SOURCE_SEGMENTS; index += 40) segments.push({ anchor: lines.length <= 40 ? "Source text" : `Lines ${index + 1}–${Math.min(lines.length, index + 40)}`, text: lines.slice(index, index + 40).join("\n") });
    return result("text", segments, "This source document contains no readable text.",lines.length>MAX_SOURCE_SEGMENTS*40);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    if (mime === "application/pdf") return await extractPdf(bytes);
    if (mime.includes("officedocument")) return await extractOffice(bytes, mime);
  } catch (error) {
    return result(mime.includes("presentationml") ? "presentation" : mime.includes("spreadsheetml") ? "spreadsheet" : mime.includes("wordprocessingml") ? "word" : "pdf", [], error instanceof Error && error.message === "source_expansion_limit_exceeded" ? "This document exceeds the safe extraction-size limits." : "This document is damaged, encrypted, or uses an unsupported safe-extraction feature.");
  }
  return result("unsupported", [], "This document format cannot be safely extracted.");
}
