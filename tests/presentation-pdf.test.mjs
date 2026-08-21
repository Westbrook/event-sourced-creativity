import test from "node:test";
import assert from "node:assert/strict";
import { createPresentationPdf, presentationPdfFilename } from "../src/model/presentation-pdf.ts";

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
