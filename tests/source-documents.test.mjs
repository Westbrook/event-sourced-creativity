import test from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync, deflateSync } from "node:zlib";
import { extractSourceDocument, sourceDocumentEvidence, sourceDocumentEvidenceDigest } from "../src/model/source-documents.ts";
import { localizedSourceAnchor } from "../src/model/source-anchor.ts";
import { formaSystemMessageId } from "../src/components/design-system/system-message-id.ts";
import japaneseMessages from "../src/components/design-system/locales/ja.ts";
import { ownerMediaNamespace } from "../src/model/media-ownership.ts";
import { verifySourceDocumentEvidence } from "../worker/media-api.ts";

const officeTypes = {
  word: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  slides: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  sheets: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

test("localizes extractor-owned source anchors without changing authored evidence or its hash",async()=>{
  const translate=(source,values={})=>(japaneseMessages[formaSystemMessageId(source)]??source).replace(/\{(\w+)\}/g,(_,key)=>String(values[key]??""));
  const number=(value)=>new Intl.NumberFormat("ja-JP").format(value);
  for(const [canonical,localized] of [
    ["Source text","元のテキスト"],
    ["Lines 1–40","1～40行"],
    ["Paragraph 2","段落 2"],
    ["Slide 3","スライド 3"],
    ["Sheet 4 · AA19","シート 4 · AA19"],
    ["Page 5","5ページ"],
    ["Document section 6 · page not verified","ドキュメントのセクション 6 · ページ未確認"],
  ])assert.equal(localizedSourceAnchor(canonical,translate,number),localized);
  assert.equal(localizedSourceAnchor("Page 5 — Approved English section",translate,number),"Page 5 — Approved English section");

  const extraction=await extractSourceDocument(new File(["Approved English quote"],"approved.txt",{type:"text/plain"}));
  const evidence=sourceDocumentEvidence(extraction,"4".repeat(64),"text/plain"),before=await sourceDocumentEvidenceDigest(evidence);
  assert.equal(localizedSourceAnchor(extraction.segments[0].anchor,translate,number),"元のテキスト");
  assert.equal(extraction.segments[0].anchor,"Source text");
  assert.equal(evidence.citations[0].anchor,"Source text");
  assert.equal(await sourceDocumentEvidenceDigest(evidence),before);
});

function officeFile(entries, mime, name = "source.docx") {
  const files = [];
  const directory = [];
  let offset = 0;
  for (const [path, text] of entries) {
    const filename = Buffer.from(path);
    const original = Buffer.from(text);
    const compressed = deflateRawSync(original);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(original.length, 22);
    local.writeUInt16LE(filename.length, 26);
    files.push(local, filename, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(original.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE(offset, 42);
    directory.push(central, filename);
    offset += local.length + filename.length + compressed.length;
  }
  const size = directory.reduce((total, part) => total + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
  return new File([...files, ...directory, end], name, { type: mime });
}

test("digital PDF evidence enters generation context with page-level source anchors", async () => {
  const compressed = deflateSync(Buffer.from("BT (Evidence from the approved brief) Tj (Launch after October) Tj ET"));
  const pdf = new File([Buffer.from("%PDF-1.5\n1 0 obj\n<< /Length 90 /Filter /FlateDecode >>\nstream\n"), compressed, Buffer.from("\nendstream\nendobj\n%%EOF")], "research.pdf", { type: "application/pdf" });
  const extracted = await extractSourceDocument(pdf);
  assert.equal(extracted.status, "ready");
  assert.equal(extracted.sourceKind, "pdf");
  assert.equal(extracted.segments[0].anchor, "Page 1");
  assert.match(extracted.text, /Evidence from the approved brief/);
  assert.match(extracted.text, /Launch after October/);
});

test("Word, PowerPoint, and Excel sources preserve paragraph, slide, and cell citations", async () => {
  const word = officeFile([["word/document.xml", "<w:document><w:body><w:p><w:r><w:t>Approved source &amp; evidence</w:t></w:r></w:p><w:p><w:r><w:t>Never mention private accounts</w:t></w:r></w:p></w:body></w:document>"]], officeTypes.word);
  const doc = await extractSourceDocument(word);
  assert.equal(doc.status, "ready");
  assert.deepEqual(doc.segments.map((segment) => segment.anchor), ["Paragraph 1", "Paragraph 2"]);
  assert.match(doc.text, /Approved source & evidence/);

  const slides = officeFile([
    ["ppt/slides/slide2.xml", "<p:sld><a:t>Budget and approvals</a:t></p:sld>"],
    ["ppt/slides/slide1.xml", "<p:sld><a:t>Executive product thesis</a:t></p:sld>"],
  ], officeTypes.slides, "brief.pptx");
  const deck = await extractSourceDocument(slides);
  assert.equal(deck.status, "ready");
  assert.deepEqual(deck.segments.map((segment) => segment.anchor), ["Slide 1", "Slide 2"]);
  assert.match(deck.text, /Executive product thesis/);

  const sheets = officeFile([
    ["xl/sharedStrings.xml", "<sst><si><t>Revenue goal</t></si></sst>"],
    ["xl/worksheets/sheet1.xml", "<worksheet><sheetData><row><c r=\"A1\" t=\"s\"><v>0</v></c><c r=\"B1\"><v>125000</v></c></row></sheetData></worksheet>"],
  ], officeTypes.sheets, "budget.xlsx");
  const workbook = await extractSourceDocument(sheets);
  assert.equal(workbook.status, "ready");
  assert.deepEqual(workbook.segments.map((segment) => segment.anchor), ["Sheet 1 · A1", "Sheet 1 · B1"]);
  assert.match(workbook.text, /Revenue goal/);
  assert.match(workbook.text, /125000/);
});

test("visible Office evidence respects authored order, excludes hidden content, and preserves chart values", async () => {
  const word=officeFile([["word/document.xml",'<w:document><w:body><w:p><w:r><w:t>VISIBLE approved con</w:t></w:r><w:r><w:t>tract wording &amp;amp;</w:t></w:r><w:r><w:rPr><w:vanish/></w:rPr><w:t>HIDDEN MERGER TARGET</w:t></w:r><w:r><w:rPr><w:rStyle w:val="DerivedConfidential"/></w:rPr><w:t>HIDDEN STYLE SOURCE</w:t></w:r><w:del><w:r><w:t>DELETED CONFIDENTIAL TERMS</w:t></w:r></w:del></w:p><w:p><w:pPr><w:pStyle w:val="DerivedConfidential"/></w:pPr><w:r><w:t>HIDDEN INHERITED LEGAL RESERVE</w:t></w:r></w:p></w:body></w:document>'],
    ["word/styles.xml",'<w:styles><w:style w:type="character" w:styleId="Confidential"><w:rPr><w:vanish/></w:rPr></w:style><w:style w:type="character" w:styleId="DerivedConfidential"><w:basedOn w:val="Confidential"/></w:style></w:styles>']],officeTypes.word);
  const extractedWord=await extractSourceDocument(word);
  assert.match(extractedWord.text,/VISIBLE approved contract wording &amp;/,"formatted runs never invent spaces inside protected words");
  assert.doesNotMatch(extractedWord.text,/HIDDEN MERGER|DELETED CONFIDENTIAL|HIDDEN STYLE SOURCE|HIDDEN INHERITED LEGAL RESERVE/);

  const slides=officeFile([
    ["ppt/presentation.xml",'<p:presentation><p:sldIdLst><p:sldId id="256" r:id="rVisibleFirst"/><p:sldId id="257" r:id="rVisibleSecond"/><p:sldId id="258" r:id="rHidden"/></p:sldIdLst></p:presentation>'],
    ["ppt/_rels/presentation.xml.rels",'<Relationships><Relationship Id="rVisibleFirst" Target="slides/slide2.xml"/><Relationship Id="rVisibleSecond" Target="slides/slide1.xml"/><Relationship Id="rHidden" Target="slides/slide3.xml"/></Relationships>'],
    ["ppt/slides/slide1.xml",'<p:sld><a:t>VISIBLE second slide</a:t></p:sld>'],
    ["ppt/slides/slide2.xml",'<p:sld><a:t>VISIBLE first slide</a:t><p:sp><p:nvSpPr><p:cNvPr hidden="1"/></p:nvSpPr><p:txBody><a:p><a:r><a:t>HIDDEN SHAPE STRATEGY</a:t></a:r></a:p></p:txBody></p:sp><c:chart r:id="rChart"/></p:sld>'],
    ["ppt/slides/slide3.xml",'<p:sld show="0"><a:t>HIDDEN ACQUISITION TARGET</a:t></p:sld>'],
    ["ppt/slides/_rels/slide2.xml.rels",'<Relationships><Relationship Id="rChart" Target="../charts/chart1.xml"/></Relationships>'],
    ["ppt/charts/chart1.xml",'<c:chartSpace><c:chart><c:plotArea><c:ser><c:cat><c:strRef><c:strCache><c:pt idx="0"><c:v>Context quality</c:v></c:pt></c:strCache></c:strRef></c:cat><c:val><c:numRef><c:numCache><c:pt idx="0"><c:v>94.6</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser></c:plotArea></c:chart></c:chartSpace>'],
  ],officeTypes.slides,"ordered.pptx");
  const deck=await extractSourceDocument(slides);
  assert.deepEqual(deck.segments.map((segment)=>segment.anchor),["Slide 1","Slide 2"]);
  assert.match(deck.segments[0].text,/VISIBLE first slide/);
  assert.match(deck.segments[0].text,/Context quality.*94\.6/);
  assert.match(deck.segments[1].text,/VISIBLE second slide/);
  assert.doesNotMatch(deck.text,/HIDDEN ACQUISITION|HIDDEN SHAPE STRATEGY/);

  const sheets=officeFile([
    ["xl/workbook.xml",'<workbook><sheets><sheet name="Executive Compensation" sheetId="1" state="veryHidden" r:id="rHidden"/><sheet name="Quarterly Revenue" sheetId="2" r:id="rVisible"/></sheets></workbook>'],
    ["xl/styles.xml",'<styleSheet><numFmts><numFmt numFmtId="164" formatCode=";;;"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>'],
    ["xl/_rels/workbook.xml.rels",'<Relationships><Relationship Id="rHidden" Target="worksheets/sheet1.xml"/><Relationship Id="rVisible" Target="worksheets/sheet2.xml"/></Relationships>'],
    ["xl/worksheets/sheet1.xml",'<worksheet><sheetData><row><c r="A1"><v>HIDDEN EXECUTIVE SALARY 940000</v></c></row></sheetData></worksheet>'],
    ["xl/worksheets/sheet2.xml",'<worksheet><cols><col min="3" max="4" hidden="1"/><col min="5" max="5" width="0"/></cols><sheetData><row hidden="1"><c r="A1"><v>HIDDEN ROW BONUS</v></c></row><row ht="0"><c r="A2"><v>HIDDEN ZERO HEIGHT ROW</v></c></row><row><c r="B4"><v>125000</v></c><c r="C4"><v>HIDDEN COLUMN MARGIN</v></c><c r="E4"><v>HIDDEN ZERO WIDTH COLUMN</v></c><c r="F4" s="1"><v>HIDDEN CUSTOM FORMAT MERGER COST</v></c></row></sheetData></worksheet>'],
  ],officeTypes.sheets,"budget.xlsx");
  const workbook=await extractSourceDocument(sheets);
  assert.deepEqual(workbook.segments,[{anchor:"Quarterly Revenue · B4",text:"125000"}]);
  assert.doesNotMatch(workbook.text,/HIDDEN EXECUTIVE SALARY|HIDDEN ROW BONUS|HIDDEN COLUMN MARGIN|HIDDEN ZERO HEIGHT|HIDDEN ZERO WIDTH|HIDDEN CUSTOM FORMAT/);
});

test("ambiguous duplicate and noncanonical Office archive parts never become grounded evidence",async()=>{
  for(const [mime,name,path,duplicate] of [
    [officeTypes.word,"shadowed.docx","word/document.xml","WORD/DOCUMENT.XML"],
    [officeTypes.slides,"shadowed.pptx","ppt/slides/slide1.xml","ppt/slides/slide1.xml"],
    [officeTypes.sheets,"shadowed.xlsx","xl/worksheets/sheet1.xml","xl/worksheets/SHEET1.XML"],
  ]){
    const source=officeFile([[path,"<root>SHADOW DUPLICATE PRIVATE STRATEGY</root>"],[duplicate,"<root>Visible public decision</root>"]],mime,name);
    const extracted=await extractSourceDocument(source);
    assert.equal(extracted.status,"unavailable",name);
    assert.equal(extracted.text,"",name);
  }
  for(const path of ["word/./document.xml","word\\document.xml","word//document.xml"]){
    const extracted=await extractSourceDocument(officeFile([[path,"<w:document>PRIVATE NONCANONICAL TEXT</w:document>"]],officeTypes.word));
    assert.equal(extracted.status,"unavailable",path);
    assert.equal(extracted.text,"",path);
  }
});

test("visible presentations with unresolved or uncached chart evidence fail closed",async()=>{
  for(const [description,entries] of [
    ["missing chart relationship",[["ppt/slides/slide1.xml",'<p:sld><a:t>Approved chart</a:t><c:chart r:id="rMissing"/></p:sld>']]],
    ["chart has no cached values",[["ppt/slides/slide1.xml",'<p:sld><a:t>Approved chart</a:t><c:chart r:id="rChart"/></p:sld>'],
      ["ppt/slides/_rels/slide1.xml.rels",'<Relationships><Relationship Id="rChart" Target="../charts/chart1.xml"/></Relationships>'],
      ["ppt/charts/chart1.xml",'<c:chartSpace><c:chart><c:plotArea/></c:chart></c:chartSpace>']]],
  ]){
    const extracted=await extractSourceDocument(officeFile(entries,officeTypes.slides,"unverified-chart.pptx"));
    assert.equal(extracted.status,"unavailable",description);
    assert.match(extracted.message,/chart has no verified embedded values/i,description);
    assert.equal(extracted.text,"",description);
  }
});

test("hidden PowerPoint groups fail closed before nested confidential shapes enter grounded context",async()=>{
  const grouped=officeFile([["ppt/slides/slide1.xml",'<p:sld><a:t>Approved public direction</a:t><p:grpSp><p:nvGrpSpPr><p:cNvPr hidden="1"/></p:nvGrpSpPr><p:sp><p:txBody><a:p><a:r><a:t>HIDDEN GROUP CONFIDENTIAL MERGER</a:t></a:r></a:p></p:txBody></p:sp></p:grpSp></p:sld>']],officeTypes.slides,"grouped.pptx");
  const extracted=await extractSourceDocument(grouped);
  assert.equal(extracted.status,"unavailable");
  assert.match(extracted.message,/hidden grouped content/i);
  assert.equal(extracted.text,"");
});

test("PDFs with unverifiable optional content layers never leak hidden material into context",async()=>{
  const layered="%PDF-1.5\n1 0 obj\n<< /Type /Catalog /OCProperties << /OCGs [5 0 R] /D << /OFF [5 0 R] >> >> >>\nendobj\n"
    +"2 0 obj\n<< /Type /Page /Properties << /Secret 5 0 R >> >>\nstream\nBT (Approved public context) Tj /OC /Secret BDC (HIDDEN OPTIONAL LAYER ACQUISITION PRICE) Tj EMC ET\nendstream\nendobj\n%%EOF";
  const source=await extractSourceDocument(new File([layered],"layered-contract.pdf",{type:"application/pdf"}));
  assert.equal(source.status,"unavailable");
  assert.match(source.message,/optional or hidden content layers/i);
  assert.equal(source.text,"");
});

test("raw and compressed PDFs never ground invisible or clipping-only text rendering modes",async()=>{
  for(const [mode,compressed] of [[3,false],[7,true]]){
    const content=Buffer.from(`BT (Approved public context) Tj ${mode} Tr (HIDDEN EXECUTIVE SALARY AND MERGER PRICE) Tj 0 Tr (Approved footer) Tj ET`);
    const body=compressed?deflateSync(content):content;
    const source=await extractSourceDocument(new File([Buffer.from(`%PDF-1.5\n1 0 obj\n<< /Length ${body.length}${compressed?" /Filter /FlateDecode":""} >>\nstream\n`),body,Buffer.from("\nendstream\nendobj\n%%EOF")],"invisible-contract.pdf",{type:"application/pdf"}));
    assert.equal(source.status,"unavailable",`rendering mode ${mode}`);
    assert.match(source.message,/invisible or clipping-only text/i);
    assert.equal(source.text,"");
  }
});

test("literal source wording, hexadecimal PDF text, Unicode ActualText, and real page order remain exact",async()=>{
  const exact='Literal token: &amp; and &lt;tag&gt;\n{"exact_phrase":"Revenue  growth"}';
  const text=await extractSourceDocument(new File([exact],"exact.txt",{type:"text/plain"}));
  assert.match(text.text,/&amp; and &lt;tag&gt;/);
  assert.match(text.text,/Revenue {2}growth/);

  const semantic='日本の顧客情報を開示しない';
  const utf16='FEFF'+Array.from(semantic,(character)=>character.charCodeAt(0).toString(16).padStart(4,"0")).join("");
  const pdf=new File([
    '%PDF-1.5\n9 0 obj\n<< /Type /Catalog /Pages 8 0 R >>\nendobj\n',
    '8 0 obj\n<< /Type /Pages /Kids [3 0 R 1 0 R] /Count 2 >>\nendobj\n',
    '1 0 obj\n<< /Type /Page /Contents 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Length 40 >>\nstream\nBT [<0048> 20 <0069>] TJ ET\nendstream\nendobj\n',
    '3 0 obj\n<< /Type /Page /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length 160 >>\nstream\n/Span << /ActualText <${utf16}> >> BDC\nBT <01> Tj ET\nEMC\nendstream\nendobj\n%%EOF`,
  ],"ordered.pdf",{type:"application/pdf"});
  const extracted=await extractSourceDocument(pdf);
  assert.equal(extracted.status,"ready");
  assert.deepEqual(extracted.segments.map((segment)=>segment.anchor),["Page 1","Page 2"]);
  assert.equal(extracted.segments.find((segment)=>segment.anchor==="Page 1")?.text,semantic);
  assert.equal(extracted.segments.find((segment)=>segment.anchor==="Page 2")?.text,"Hi");
});

test("encrypted, unreadable, oversized, or highly expanding source files never masquerade as grounded", async () => {
  const encrypted = new File(["%PDF-1.5\n/Encrypt 8 0 R\nstream\n(secret) Tj\nendstream"], "encrypted.pdf", { type: "application/pdf" });
  const unavailable = await extractSourceDocument(encrypted);
  assert.equal(unavailable.status, "unavailable");
  assert.equal(unavailable.text, "");

  const bomb = officeFile([["word/document.xml", "<w:document>" + "a".repeat(800_000) + "</w:document>"]], officeTypes.word);
  const rejected = await extractSourceDocument(bomb);
  assert.equal(rejected.status, "unavailable");
  assert.match(rejected.message, /safe extraction-size limits/);

  const oversized = { size: 12 * 1024 * 1024 + 1, type: "text/plain", async text() { throw new Error("must not read"); }, async arrayBuffer() { throw new Error("must not read"); } };
  assert.equal((await extractSourceDocument(oversized)).status, "unavailable");
});

test("larger ordinary source text remains grounded with locatable line ranges and bounded excerpts", async () => {
  const file = new File([Array.from({ length: 95 }, (_, index) => `Requirement ${index + 1}`).join("\n")], "notes.md", { type: "text/markdown" });
  const extracted = await extractSourceDocument(file);
  assert.equal(extracted.status, "ready");
  assert.deepEqual(extracted.segments.map((segment) => segment.anchor), ["Lines 1–40", "Lines 41–80", "Lines 81–95"]);
  assert.match(extracted.text, /Requirement 95/);
});

test("supported source extensions remain usable when the browser omits a MIME type",async()=>{
  for(const [name,type] of [["brief.md",""],["notes.txt","application/octet-stream"],["facts.csv",""]]){
    const extracted=await extractSourceDocument(new File(["Approved  exact &amp; wording"],name,{type}));
    assert.equal(extracted.status,"ready",name);
    assert.match(extracted.text,/Approved {2}exact &amp; wording/);
  }
  assert.equal((await extractSourceDocument(new File(["unknown"],"evidence.unknown",{type:""}))).status,"unavailable");
});

test("multiple PDF content streams on one page keep their genuine shared page citation", async () => {
  const pdf = new File([
    "%PDF-1.4\n1 0 obj\n<< /Type /Page /Contents [2 0 R 3 0 R] >>\nendobj\n",
    "2 0 obj\n<< /Length 36 >>\nstream\nBT (First part of page one) Tj ET\nendstream\nendobj\n",
    "3 0 obj\n<< /Length 37 >>\nstream\nBT (Second part of page one) Tj ET\nendstream\nendobj\n%%EOF",
  ], "multiple-streams.pdf", { type: "application/pdf" });
  const extracted = await extractSourceDocument(pdf);
  assert.equal(extracted.status, "ready");
  assert.deepEqual(extracted.segments.map((segment) => segment.anchor), ["Page 1"]);
  assert.match(extracted.text, /First part of page one/);
  assert.match(extracted.text, /Second part of page one/);
});

test("sources beyond the supported 4,800-line evidence window disclose truncation", async () => {
  const file = new File([Array.from({ length: 4_801 }, (_, index) => `Requirement ${index + 1}`).join("\n")], "large.txt", { type: "text/plain" });
  const extracted = await extractSourceDocument(file);
  assert.equal(extracted.status, "ready");
  assert.equal(extracted.segments.length, 120);
  assert.equal(extracted.truncated, true);
  assert.match(extracted.text, /Requirement 4800/);
  assert.doesNotMatch(extracted.text, /Requirement 4801/);
});

test("server-owned source receipts reject forged quotations, anchors, hashes, and account ownership", async () => {
  const owner="source-owner";
  const mimeType="text/plain";
  const contentHash="4".repeat(64);
  const extraction=await extractSourceDocument(new File(["Use only the licensed exact customer quote."],"brief.txt",{type:mimeType}));
  const evidence=sourceDocumentEvidence(extraction,contentHash,mimeType);
  const evidenceHash=await sourceDocumentEvidenceDigest(evidence);
  const key=`${ownerMediaNamespace(owner)}/approved-brief.txt`;
  const mediaUrl=`/api/media/${encodeURIComponent(key)}`;
  const env={MEDIA:{async head(candidate){return candidate===key?{customMetadata:{ownerId:owner,sha256:contentHash,mimeType,sourceEvidenceSha256:evidenceHash},httpEtag:"etag"}:null;}}};
  const properties={source_evidence_hash:evidenceHash,source_content_hash:contentHash,source_mime_type:mimeType,source_kind:extraction.sourceKind,extraction_status:extraction.status,text:extraction.text,source_citations:extraction.segments.map((segment)=>({anchor:segment.anchor,excerpt:segment.text})),source_segment_count:extraction.segments.length,source_excerpt_truncated:extraction.truncated};
  assert.equal(await verifySourceDocumentEvidence(env,owner,mediaUrl,properties),true);
  assert.equal(await verifySourceDocumentEvidence(env,owner,mediaUrl,{...properties,text:"A FABRICATED CUSTOMER QUOTE"}),false);
  assert.equal(await verifySourceDocumentEvidence(env,owner,mediaUrl,{...properties,source_citations:[{anchor:"Page 99",excerpt:extraction.segments[0].text}]}),false);
  assert.equal(await verifySourceDocumentEvidence(env,owner,mediaUrl,{...properties,source_content_hash:"5".repeat(64)}),false);
  assert.equal(await verifySourceDocumentEvidence(env,"another-owner",mediaUrl,properties),false);

  const imageEnv={MEDIA:{async head(candidate){return candidate===key?{customMetadata:{ownerId:owner,sha256:"real-image-hash",mimeType:"image/png"},httpEtag:"etag"}:null;}}};
  assert.equal(await verifySourceDocumentEvidence(imageEnv,owner,mediaUrl,{source_mime_type:"image/png",extraction_status:"pending"}),true,"ordinary image references retain their existing safe workflow");
  assert.equal(await verifySourceDocumentEvidence(imageEnv,owner,mediaUrl,{source_mime_type:"application/pdf",source_content_hash:"fabricated-document-hash",source_kind:"pdf",text:"Invented confidential quote",source_citations:[{anchor:"Page 42",excerpt:"Invented confidential quote"}],source_segment_count:1}),false,"an owned image cannot masquerade as verified PDF evidence");
  assert.equal(await verifySourceDocumentEvidence(imageEnv,owner,mediaUrl,{source_mime_type:"image/png",source_citations:[{anchor:"Page 1",excerpt:"Invented"}]}),false,"legacy compatibility never accepts unattested document-provenance fields");
});
