import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { deflateSync, inflateSync } from "node:zlib";
import { createPresentationPdf, createPresentationPdfFromRenderedSlides, presentationPdfFilename } from "../src/model/presentation-pdf.ts";

const presentation={aspectRatio:"16:9",theme:"Campaign review",footerLabel:"Autumn campaign",stylePreset:"editorial",mode:"light",palette:{background:"#f2efe8",foreground:"#171714",accent:"#b8422f",muted:"#625e56",surface:"#ded8ca"}};
const items=[
  {title:"The campaign finds its center",body:"A precise visual direction gives the team one shared decision surface.",notes:"Open with the outcome.",image_prompt:"",slide:{layout:"cover",kicker:"Creative direction",bullets:["Protect the human scale","Keep the palette warm"],visual:{kind:"hero-type",label:"North star",value:"One coherent world",data:[]}}},
  {title:"Evidence becomes action",body:"Reusable decisions shorten every later handoff.",notes:"Close on operational value.",image_prompt:"",slide:{layout:"metric",kicker:"Proof",bullets:["Fewer repeated briefs","Clearer next steps"],visual:{kind:"bars",label:"Creative confidence",value:"",data:[{label:"Direction",value:"82%",weight:.82},{label:"Coherence",value:"74%",weight:.74}]}}},
];

test("builds a valid multi-page landscape PDF from normalized slide data",()=>{
  const result=createPresentationPdf(items,presentation,{title:"Autumn Campaign — Review",showFooterLabel:true});
  const source=new TextDecoder().decode(result.bytes);
  assert.equal(result.pageCount,2);
  assert.equal(result.filename,"autumn-campaign-review.pdf");
  assert.equal(source.startsWith("%PDF-1.4"),true);
  assert.match(source,/\/MediaBox \[0 0 960 540\]/);
  assert.match(source,/\/Count 2/);
  assert.equal((source.match(/\/Type \/Page \/Parent/g)??[]).length,2);
  assert.match(source,/The campaign finds its/);
  assert.match(source,/\(center\) Tj/);
  assert.match(source,/Evidence becomes action/);
  assert.match(source,/Autumn campaign/);
  const offset=Number(source.match(/startxref\n(\d+)/)?.[1]);
  assert.equal(Number.isFinite(offset),true);
  assert.equal(source.slice(offset,offset+4),"xref");
  assert.equal(source.endsWith("%%EOF\n"),true);
});

test("normalizes filenames and still exports an empty retained deck",()=>{
  assert.equal(presentationPdfFilename("  Déjà vu / deck  "),"deja-vu-deck.pdf");
  const result=createPresentationPdf([],presentation,{title:"Empty deck",showFooterLabel:false});
  const source=new TextDecoder().decode(result.bytes);
  assert.equal(result.pageCount,1);
  assert.match(source,/No slide content was retained/);
  assert.doesNotMatch(source,/Autumn campaign/);
});

test("embeds lossless browser-rendered slide pixels with searchable Unicode text",()=>{
  const firstPixels=Uint8Array.from([242,239,232,184,66,47,23,23,20,255,255,255]);
  const secondPixels=Uint8Array.from([18,23,21,225,119,69,247,245,239,38,48,41]);
  const firstCompressed=deflateSync(firstPixels),secondCompressed=deflateSync(secondPixels);
  const result=createPresentationPdfFromRenderedSlides([
    {width:2,height:2,bytes:firstCompressed,text:"Café 東京 — π\nMacy’s aftermath"},
    {width:2,height:2,bytes:secondCompressed,text:"A different themed slide"},
  ],{title:"Café 東京 — campaign"});
  const source=Buffer.from(result.bytes).toString("latin1");

  assert.equal(result.pageCount,2);
  assert.equal(result.filename,"cafe-campaign.pdf");
  assert.match(source,/\/MediaBox \[0 0 960 540\]/);
  assert.equal((source.match(/\/Subtype \/Image/g)??[]).length,2);
  assert.match(source,/\/Width 2 \/Height 2 \/ColorSpace \/DeviceRGB \/BitsPerComponent 8 \/Filter \/FlateDecode/);
  assert.match(source,/\/ToUnicode \d+ 0 R/);
  assert.match(source,/<[0-9A-F]{2}> <00E9>/);
  assert.match(source,/<[0-9A-F]{2}> <6771>/);
  assert.match(source,/<[0-9A-F]{2}> <4EAC>/);
  assert.match(source,/<[0-9A-F]{2}> <03C0>/);
  assert.match(source,/\/ActualText <FEFF00430061006600E9002067714EAC00202014002003C0000A>/);
  assert.match(source,/\/Title <FEFF00430061006600E9002067714EAC00202014002000630061006D0070006100690067006E>/);
  assert.deepEqual(Uint8Array.from(inflateSync(firstCompressed)),firstPixels);
  assert.deepEqual(Uint8Array.from(inflateSync(secondCompressed)),secondPixels);

  const xrefOffset=Number(source.match(/startxref\n(\d+)/)?.[1]);
  assert.equal(source.slice(xrefOffset,xrefOffset+4),"xref");
  const offsets=[...source.matchAll(/^(\d{10}) 00000 n $/gm)].map((match)=>Number(match[1]));
  offsets.forEach((offset,index)=>assert.equal(source.slice(offset).startsWith(`${index+1} 0 obj\n`),true));
});

test("rejects empty or invalid browser-rendered slide pages",()=>{
  assert.throws(()=>createPresentationPdfFromRenderedSlides([]),/At least one rendered presentation slide/);
  assert.throws(()=>createPresentationPdfFromRenderedSlides([{width:0,height:2,bytes:Uint8Array.from([1])}]),/valid dimensions/);
  assert.throws(()=>createPresentationPdfFromRenderedSlides([{width:2,height:2,bytes:new Uint8Array()}]),/compressed RGB pixels/);
});

test("retains Unicode search mappings beyond one 8-bit font and supports emoji",()=>{
  const multilingual=Array.from({length:300},(_,index)=>String.fromCodePoint(0x0400+index)).join("")+"😀";
  const page={width:1,height:1,bytes:deflateSync(Uint8Array.from([18,23,21])),text:multilingual};
  const source=Buffer.from(createPresentationPdfFromRenderedSlides([page]).bytes).toString("latin1");

  assert.equal((source.match(/\/ToUnicode \d+ 0 R/g)??[]).length,2);
  assert.match(source,/\/F1 \d+ 0 R \/F2 \d+ 0 R/);
  assert.match(source,/<[0-9A-F]{2}> <D83DDE00>/);
  assert.match(source,/\/F2 1 Tf/);
});

test("exports the actual themed slide component instead of reconstructing its layout",async()=>{
  const [exporter,deck]=await Promise.all([
    readFile(new URL("../src/components/presentation-pdf-export.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/components/presentation-deck.ts",import.meta.url),"utf8"),
  ]);

  assert.match(exporter,/document\.createElement\("forma-presentation-slide"\)/);
  assert.match(exporter,/host\.presentation=presentation/);
  assert.match(exporter,/host\.showFooterLabel=options\.showFooterLabel!==false/);
  assert.match(exporter,/host\.compact=false/);
  assert.match(exporter,/document\.fonts\.ready/);
  assert.match(exporter,/document\.styleSheets/);
  assert.match(exporter,/foreignObject/);
  assert.match(exporter,/CompressionStream\("deflate"\)/);
  assert.match(exporter,/EXPORT_SCALE=2/);
  assert.match(deck,/renderPresentationPdf\(items,presentation,options\)/);
  assert.match(deck,/render_mode:highFidelity\?"browser-slide-capture":"compatible-vector"/);
  assert.match(deck,/\?selected=\$\{preset\.id===selectedStyle\}/);
});
