const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
const MAX_ENTRY_BYTES = 2 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 5 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 2_000;
const MAX_SOURCE_CHARACTERS = 120_000;
const MAX_SOURCE_SEGMENTS = 120;

const SOURCE_MIME_BY_EXTENSION:Record<string,string>={
  txt:"text/plain",
  md:"text/markdown",
  markdown:"text/markdown",
  csv:"text/csv",
  json:"application/json",
  pdf:"application/pdf",
  docx:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx:"application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/** Recover only an explicitly advertised source type when the browser omits useful MIME metadata. */
export function canonicalSourceDocumentMime(file:Pick<File,"type">&Partial<Pick<File,"name">>):string{
  const declared=file.type.toLowerCase().trim();
  if(declared&&declared!=="application/octet-stream")return declared;
  const extension=(file.name??"").split(".").at(-1)?.toLowerCase()??"";
  return SOURCE_MIME_BY_EXTENSION[extension]??declared;
}

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
// XML entities are decoded only while reading XML text nodes. Plaintext, JSON,
// CSV, and authored multi-space contractual language must remain exact.
const normalizeText = (value: string) => value.replaceAll(String.fromCharCode(0), "").replace(/\r\n?/g, "\n").trim();

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
  const uniqueNames=new Set<string>();
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
    if(!name||name.startsWith("/")||name.includes("\\")||Array.from(name).some((character)=>{const code=character.codePointAt(0)??0;return code<32||code===127;})
      ||name.split("/").some((segment)=>!segment||segment==="."||segment===".."))throw new Error("invalid_office_document");
    const canonical=name.normalize("NFC").toLocaleLowerCase("en-US");
    if(uniqueNames.has(canonical))throw new Error("invalid_office_document");
    uniqueNames.add(canonical);
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

const xmlRuns=(xml:string,prefix:string)=>{
  let text="",previous=-1;
  for(const match of xml.matchAll(new RegExp(`<${prefix}:t(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${prefix}:t>`,"g"))){
    const gap=previous<0?"":xml.slice(previous,match.index);
    if(/<(?:w:br|w:cr)\b|<\/(?:a:p|p:sp|p:graphicFrame)>/i.test(gap))text+="\n";
    else if(/<w:tab\b/i.test(gap))text+="\t";
    text+=decodeXml(match[1]??"");
    previous=(match.index??0)+match[0].length;
  }
  return text;
};

const xmlAttribute=(tag:string,name:string)=>{
  const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  const match=tag.match(new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(["'])([\\s\\S]*?)\\1`,"i"));
  return match?decodeXml(match[2]??""):"";
};

async function officeRelationships(bytes:Uint8Array,entries:ZipEntry[],relationshipPath:string,base:string){
  const item=entries.find((entry)=>entry.name===relationshipPath);
  const relationships=new Map<string,string>();
  if(!item)return relationships;
  const xml=await readZipEntry(bytes,item);
  for(const match of xml.matchAll(/<Relationship\b[^>]*\/?\s*>/gi)){
    const tag=match[0],id=xmlAttribute(tag,"Id"),target=xmlAttribute(tag,"Target");
    if(!id||!target||xmlAttribute(tag,"TargetMode").toLowerCase()==="external"||/^[a-z][a-z0-9+.-]*:/i.test(target))continue;
    try{
      const resolved=new URL(target,`https://office.invalid/${base}`);
      if(resolved.origin!=="https://office.invalid")continue;
      const path=resolved.pathname.replace(/^\/+/,"");
      if(entries.some((entry)=>entry.name===path))relationships.set(id,path);
    }catch{/* Unsupported or external relationships never become source evidence. */}
  }
  return relationships;
}

function visibleWordRuns(xml:string,hiddenStyles:Set<string>){
  const paragraphProperties=xml.match(/<w:pPr(?:\s[^>]*)?>([\s\S]*?)<\/w:pPr>/i)?.[1]??"";
  const style=paragraphProperties.match(/<w:pStyle\b[^>]*>/i)?.[0]??"";
  if(/<w:(?:vanish|specVanish)\b/i.test(paragraphProperties)||hiddenStyles.has(xmlAttribute(style,"w:val")))return"";
  const visible=xml
    .replace(/<w:(?:del|moveFrom)(?:\s[^>]*)?>[\s\S]*?<\/w:(?:del|moveFrom)>/gi,"")
    .replace(/<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/gi,(full:string,body:string)=>{
      const runStyle=body.match(/<w:rStyle\b[^>]*>/i)?.[0]??"";
      return /<w:(?:vanish|specVanish)\b/i.test(body)||hiddenStyles.has(xmlAttribute(runStyle,"w:val"))?"":full;
    });
  return xmlRuns(visible,"w");
}

async function presentationChartText(bytes:Uint8Array,entries:ZipEntry[],slide:ZipEntry,xml:string){
  const filename=slide.name.split("/").at(-1)??"";
  const relations=await officeRelationships(bytes,entries,`ppt/slides/_rels/${filename}.rels`,"ppt/slides/");
  const values:string[]=[];
  for(const chart of xml.matchAll(/<c:chart\b[^>]*>/gi)){
    const target=relations.get(xmlAttribute(chart[0],"r:id"));
    if(!target||!target.startsWith("ppt/charts/"))throw new Error("presentation_chart_evidence_unavailable");
    const entry=entries.find((candidate)=>candidate.name===target);
    if(!entry)throw new Error("presentation_chart_evidence_unavailable");
    const source=await readZipEntry(bytes,entry);
    const cached=[...source.matchAll(/<c:v(?:\s[^>]*)?>([\s\S]*?)<\/c:v>/gi)].map((value)=>decodeXml(value[1]??""));
    if(!cached.some((value)=>value.trim()))throw new Error("presentation_chart_evidence_unavailable");
    values.push(...cached.filter((value)=>value.trim()));
  }
  return values.join(" ");
}

async function extractOffice(bytes: Uint8Array, mime: string): Promise<SourceDocumentExtraction> {
  const entries = zipEntries(bytes);
  if (mime.includes("wordprocessingml")) {
    const document = entries.find((entry) => entry.name === "word/document.xml");
    if (!document) throw new Error("invalid_word_document");
    const styleEntry=entries.find((entry)=>entry.name==="word/styles.xml");
    const hiddenStyles=new Set<string>();
    if(styleEntry){
      const styles=await readZipEntry(bytes,styleEntry);
      const defaults=styles.match(/<w:docDefaults(?:\s[^>]*)?>([\s\S]*?)<\/w:docDefaults>/i)?.[1]??"";
      if(/<w:(?:vanish|specVanish)\b/i.test(defaults))throw new Error("word_style_visibility_unverified");
      const definitions=new Map<string,{hidden:boolean;parent:string}>();
      for(const style of styles.matchAll(/<w:style\b([^>]*)>([\s\S]*?)<\/w:style>/gi)){
        const id=xmlAttribute(style[0],"w:styleId"),body=style[2]??"";
        if(id)definitions.set(id,{hidden:/<w:(?:vanish|specVanish)\b/i.test(body),parent:xmlAttribute(body.match(/<w:basedOn\b[^>]*>/i)?.[0]??"","w:val")});
      }
      const checking=new Set<string>();
      const hidden=(id:string):boolean=>{
        if(hiddenStyles.has(id))return true;
        const style=definitions.get(id);if(!style)return false;
        if(checking.has(id))throw new Error("word_style_visibility_unverified");
        checking.add(id);
        const concealed=style.hidden||Boolean(style.parent&&hidden(style.parent));
        checking.delete(id);
        if(concealed)hiddenStyles.add(id);
        return concealed;
      };
      for(const id of definitions.keys())hidden(id);
    }
    const xml = await readZipEntry(bytes, document);
    const paragraphs = [...xml.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)].map((match, index) => ({ anchor: `Paragraph ${index + 1}`, text: visibleWordRuns(match[1] ?? "",hiddenStyles) }));
    return result("word", paragraphs, "This Word document contains no selectable paragraph text.");
  }
  if (mime.includes("presentationml")) {
    const numbered=entries.filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry.name)).sort((left, right) => Number(left.name.match(/slide(\d+)/)?.[1] ?? 0) - Number(right.name.match(/slide(\d+)/)?.[1] ?? 0));
    const manifest=entries.find((entry)=>entry.name==="ppt/presentation.xml");
    let slides=numbered;
    if(manifest){
      const relationships=await officeRelationships(bytes,entries,"ppt/_rels/presentation.xml.rels","ppt/");
      const presentation=await readZipEntry(bytes,manifest);
      const ordered=[...presentation.matchAll(/<p:sldId\b[^>]*\/?\s*>/gi)]
        .map((item)=>relationships.get(xmlAttribute(item[0],"r:id")))
        .flatMap((path)=>{const entry=numbered.find((candidate)=>candidate.name===path);return entry?[entry]:[];});
      if(ordered.length)slides=ordered;
    }
    const segments: SourceDocumentSegment[] = [];
    let visible=0;
    for (const slide of slides){
      const xml=await readZipEntry(bytes,slide);
      const root=xml.match(/<p:sld\b[^>]*>/i)?.[0]??"";
      if(["0","false"].includes(xmlAttribute(root,"show").toLowerCase()))continue;
      for(const grouped of xml.matchAll(/<p:grpSp\b[^>]*>[\s\S]*?<p:nvGrpSpPr\b[^>]*>([\s\S]*?)<\/p:nvGrpSpPr>/gi)){
        const groupProperties=(grouped[1]??"").match(/<p:cNvPr\b[^>]*>/i)?.[0]??"";
        if(["1","true"].includes(xmlAttribute(groupProperties,"hidden").toLowerCase()))throw new Error("presentation_hidden_group_unavailable");
      }
      visible+=1;
      if(segments.length>=MAX_SOURCE_SEGMENTS)continue;
      const visibleShapes=xml.replace(/<p:(sp|pic|graphicFrame)(?:\s[^>]*)?>([\s\S]*?)<\/p:\1>/gi,(full:string,_kind:string,body:string)=>{
        const properties=body.match(/<p:cNvPr\b[^>]*>/i)?.[0]??"";
        return ["1","true"].includes(xmlAttribute(properties,"hidden").toLowerCase())?"":full;
      });
      const charts=await presentationChartText(bytes,entries,slide,visibleShapes);
      segments.push({anchor:`Slide ${visible}`,text:[xmlRuns(visibleShapes,"a"),charts].filter(Boolean).join(" ")});
    }
    return result("presentation", segments, "This presentation contains no selectable slide text.", visible > MAX_SOURCE_SEGMENTS);
  }
  if (mime.includes("spreadsheetml")) {
    const sharedEntry = entries.find((entry) => entry.name === "xl/sharedStrings.xml");
    const shared = sharedEntry ? [...(await readZipEntry(bytes, sharedEntry)).matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map((match) => [...(match[1] ?? "").matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((part) => decodeXml(part[1] ?? "")).join("")) : [];
    const hiddenCellStyles=new Set<number>();
    const styleEntry=entries.find((entry)=>entry.name==="xl/styles.xml");
    if(styleEntry){
      const styles=await readZipEntry(bytes,styleEntry),hiddenFormats=new Set<string>();
      for(const format of styles.matchAll(/<numFmt\b[^>]*\/?\s*>/gi))if(xmlAttribute(format[0],"formatCode").replace(/\s/g,"")===";;;")hiddenFormats.add(xmlAttribute(format[0],"numFmtId"));
      const formats=styles.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/i)?.[1]??"";
      [...formats.matchAll(/<xf\b[^>]*\/?\s*>/gi)].forEach((format,index)=>{if(hiddenFormats.has(xmlAttribute(format[0],"numFmtId")))hiddenCellStyles.add(index);});
    }
    const numbered=entries.filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/.test(entry.name)).sort((left, right) => Number(left.name.match(/sheet(\d+)/)?.[1] ?? 0) - Number(right.name.match(/sheet(\d+)/)?.[1] ?? 0));
    let sheets=numbered.map((entry)=>({entry,name:`Sheet ${entry.name.match(/sheet(\d+)/)?.[1]??"1"}`}));
    const workbook=entries.find((entry)=>entry.name==="xl/workbook.xml");
    if(workbook){
      const relationships=await officeRelationships(bytes,entries,"xl/_rels/workbook.xml.rels","xl/");
      const manifest=await readZipEntry(bytes,workbook);
      const ordered=[...manifest.matchAll(/<sheet\b[^>]*\/?\s*>/gi)]
        .filter((item)=>!["hidden","veryhidden"].includes(xmlAttribute(item[0],"state").toLowerCase()))
        .flatMap((item)=>{const path=relationships.get(xmlAttribute(item[0],"r:id"));const entry=numbered.find((candidate)=>candidate.name===path);return entry?[{entry,name:xmlAttribute(item[0],"name")||`Sheet ${entry.name.match(/sheet(\d+)/)?.[1]??"1"}`}]:[];});
      if(ordered.length||/<sheet\b/i.test(manifest))sheets=ordered;
    }
    const segments: SourceDocumentSegment[] = [];
    let clipped=sheets.length>20;
    for (const sheet of sheets.slice(0, 20)) {
      const xml = await readZipEntry(bytes, sheet.entry);
      const hiddenColumns:Array<[number,number]>=[];
      for(const column of xml.matchAll(/<col\b[^>]*\/?\s*>/gi))if(["1","true"].includes(xmlAttribute(column[0],"hidden").toLowerCase())
        ||xmlAttribute(column[0],"width")==="0"){
        hiddenColumns.push([Number(xmlAttribute(column[0],"min")),Number(xmlAttribute(column[0],"max"))]);
      }
      const defaults=xml.match(/<sheetFormatPr\b[^>]*>/i)?.[0]??"";
      const defaultHidden=["1","true"].includes(xmlAttribute(defaults,"zeroHeight").toLowerCase());
      const visibleRows=[...xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/gi)]
        .filter((row)=>{const opening=`<row ${row[1]??""}>`,hidden=xmlAttribute(opening,"hidden").toLowerCase();
          return!["1","true"].includes(hidden)&&xmlAttribute(opening,"ht")!=="0"&&(!defaultHidden||["0","false"].includes(hidden));})
        .map((row)=>row[2]??"").join("\n");
      for (const cell of visibleRows.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
        const attributes = cell[1] ?? "";
        const address = attributes.match(/\br="([A-Z]+\d+)"/)?.[1] ?? "";
        const style=xmlAttribute(`<c ${attributes}>`,"s");
        if(style&&hiddenCellStyles.has(Number(style)))continue;
        const letters=address.match(/^([A-Z]+)/)?.[1]??"";
        const column=[...letters].reduce((index,letter)=>index*26+letter.charCodeAt(0)-64,0);
        if(hiddenColumns.some(([first,last])=>column>=first&&column<=last))continue;
        const raw = (cell[2] ?? "").match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? (cell[2] ?? "").match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/)?.[1] ?? "";
        const value = /\bt="s"/.test(attributes) ? shared[Number(raw)] ?? "" : decodeXml(raw);
        if (address && value.trim()) segments.push({ anchor: `${sheet.name} · ${address}`, text: value });
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

function decodePdfHex(value:string):string{
  const hex=value.replace(/\s+/g,"");
  if(!hex.length)return"";
  const padded=hex.length%2?`${hex}0`:hex;
  const bytes=new Uint8Array(padded.length/2);
  for(let index=0;index<bytes.length;index+=1)bytes[index]=Number.parseInt(padded.slice(index*2,index*2+2),16);
  if(bytes[0]===0xfe&&bytes[1]===0xff)return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  if(bytes[0]===0xff&&bytes[1]===0xfe)return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if(bytes.length%2===0&&bytes.some((byte,index)=>index%2===0&&byte===0))return new TextDecoder("utf-16be").decode(bytes);
  try{return new TextDecoder("utf-8",{fatal:true}).decode(bytes);}catch{
    return bytes.length%2===0?new TextDecoder("utf-16be").decode(bytes):new TextDecoder("latin1").decode(bytes);
  }
}

function pdfText(stream: string): string {
  const semantic=stream.replace(/\/ActualText\s*(?:<([0-9a-f\s]+)>|\(((?:\\.|[^\\)])*)\))[\s\S]{0,200}?BDC[\s\S]*?EMC/gi,
    (_full:string,hex:string|undefined,literal:string|undefined)=>`(${(hex?decodePdfHex(hex):decodePdfLiteral(literal??"")).replaceAll("\\","\\\\").replaceAll("(","\\(").replaceAll(")","\\)")}) Tj`);
  const values: string[] = [];
  for (const operation of semantic.matchAll(/\(((?:\\.|[^\\)])*)\)\s*(?:Tj|'|")|\[([\s\S]*?)\]\s*TJ|<([0-9a-f\s]+)>\s*(?:Tj|'|")/gi)) {
    if (operation[1] !== undefined) values.push(decodePdfLiteral(operation[1]));
    else if (operation[2] !== undefined) values.push([...operation[2].matchAll(/\(((?:\\.|[^\\)])*)\)|<([0-9a-f\s]+)>/gi)].map((part)=>part[1]===undefined?decodePdfHex(part[2]??""):decodePdfLiteral(part[1])).join(""));
    else if (operation[3] !== undefined) values.push(decodePdfHex(operation[3]));
  }
  return values.join(" ");
}

async function extractPdf(bytes: Uint8Array): Promise<SourceDocumentExtraction> {
  const latin = new TextDecoder("latin1").decode(bytes);
  if (!latin.startsWith("%PDF-") || /\/Encrypt\b/.test(latin)) return result("pdf", [], "This PDF is encrypted, damaged, or unavailable for safe text extraction.");
  if(/\/OCProperties\b|\/OCGs\b|\/OC\s+(?:\/[A-Za-z0-9_.-]+|<<)/.test(latin))
    return result("pdf",[],"This PDF contains optional or hidden content layers whose visibility cannot be verified safely.");
  const segments: SourceDocumentSegment[] = [];
  const objects=[...latin.matchAll(/(\d+)\s+\d+\s+obj\b([\s\S]*?)endobj/g)];
  const indexedObjects=new Map(objects.map((object)=>[object[1]??"",object]));
  const physicalPages=objects.filter((object)=>/\/Type\s*\/Page\b(?!s)/.test(object[2]??""));
  const catalog=objects.find((object)=>/\/Type\s*\/Catalog\b/.test(object[2]??""));
  const root=catalog?.[2]?.match(/\/Pages\s+(\d+)\s+\d+\s+R/)?.[1]??"";
  const orderedPages:RegExpMatchArray[]=[];
  const visited=new Set<string>();
  const visit=(id:string)=>{
    if(!id||visited.has(id)||visited.size>=MAX_SOURCE_SEGMENTS*4)return;
    visited.add(id);
    const object=indexedObjects.get(id);if(!object)return;
    const body=object[2]??"";
    if(/\/Type\s*\/Page\b(?!s)/.test(body)){orderedPages.push(object);return;}
    const kids=body.match(/\/Kids\s*\[([\s\S]*?)\]/)?.[1]??"";
    for(const child of kids.matchAll(/(\d+)\s+\d+\s+R/g))visit(child[1]??"");
  };
  if(root)visit(root);
  const pages=orderedPages.length?orderedPages:physicalPages;
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
    const decoded=new TextDecoder("latin1").decode(content);
    if(/(?:^|\s)(?:3|7)\s+Tr(?:\s|$)/.test(decoded))
      return result("pdf",[],"This PDF contains invisible or clipping-only text that cannot be safely separated from visible evidence.");
    const extracted=pdfText(decoded);
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
  const orderedSegments=segments.map((segment,index)=>({segment,index,page:Number(segment.anchor.match(/^Page (\d+)$/)?.[1]??Number.POSITIVE_INFINITY)}))
    .sort((left,right)=>left.page-right.page||left.index-right.index).map((item)=>item.segment);
  return result("pdf", orderedSegments, "This PDF contains no safely decodable selectable text; scanned pages require OCR, which is not currently available.",pages.length>MAX_SOURCE_SEGMENTS);
}

/** Extract bounded, cited source evidence locally; document bytes never leave Forma. */
export async function extractSourceDocument(file: Pick<File, "type" | "size" | "arrayBuffer" | "text">&Partial<Pick<File,"name">>): Promise<SourceDocumentExtraction> {
  if (file.size > MAX_SOURCE_BYTES) return result("unsupported", [], "This source exceeds the 12 MB upload limit.");
  const mime = canonicalSourceDocumentMime(file);
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
    const detail=error instanceof Error&&error.message==="source_expansion_limit_exceeded"?"This document exceeds the safe extraction-size limits."
      :error instanceof Error&&error.message==="presentation_chart_evidence_unavailable"?"A visible presentation chart has no verified embedded values; its evidence cannot be safely used."
      :error instanceof Error&&error.message==="presentation_hidden_group_unavailable"?"This presentation contains hidden grouped content that cannot be safely separated from visible evidence."
      :error instanceof Error&&error.message==="word_style_visibility_unverified"?"This Word document uses hidden or cyclic inherited styles whose visibility cannot be verified safely."
      :"This document is damaged, encrypted, or uses an unsupported safe-extraction feature.";
    return result(mime.includes("presentationml") ? "presentation" : mime.includes("spreadsheetml") ? "spreadsheet" : mime.includes("wordprocessingml") ? "word" : "pdf", [],detail);
  }
  return result("unsupported", [], "This document format cannot be safely extracted.");
}
