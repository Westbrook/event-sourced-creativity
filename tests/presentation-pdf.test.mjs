import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { deflateSync, inflateSync } from "node:zlib";
import { createPresentationPdf, createPresentationPdfFromRenderedSlides, presentationPdfFilename } from "../src/model/presentation-pdf.ts";

const presentation={aspectRatio:"16:9",theme:"Campaign review",footerLabel:"Autumn campaign",stylePreset:"editorial",mode:"light",palette:{background:"#f2efe8",foreground:"#171714",accent:"#b8422f",muted:"#625e56",surface:"#ded8ca"}};
const items=[
  {title:"The campaign finds its center",body:"A precise visual direction gives the team one shared decision surface.",notes:"Open with the outcome.",image_prompt:"",slide:{layout:"cover",kicker:"Creative direction",bullets:["Protect the human scale","Keep the palette warm"],visual:{kind:"hero-type",label:"North star",value:"One coherent world",data:[]}}},
  {title:"Evidence becomes action",body:"Reusable decisions shorten every later handoff.",notes:"Close on operational value.",image_prompt:"",slide:{layout:"metric",kicker:"Proof",bullets:["Fewer repeated briefs","Clearer next steps"],visual:{kind:"bars",label:"Creative confidence",value:"",data:[{label:"Direction",value:"82%",weight:.82},{label:"Coherence",value:"74%",weight:.74}]}}},
];
const actualText=(source)=>[...source.matchAll(/\/ActualText <(FEFF[0-9A-F]+)>/g)].map((match)=>Buffer.from(match[1],"hex").subarray(2).swap16().toString("utf16le"));

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

test("assembles more than a thousand vector slides with byte-accurate cross-reference offsets",()=>{
  const slideCount=1_120;
  const slides=Array.from({length:slideCount},(_,index)=>({...items[0],title:`Approved vector slide ${index+1}`}));
  const result=createPresentationPdf(slides,presentation,{title:"Large approved presentation"});
  const source=Buffer.from(result.bytes).toString("latin1");

  assert.equal(result.pageCount,slideCount);
  assert.match(source,new RegExp(`\\/Count ${slideCount}(?:\\s|>)`));
  assert.equal((source.match(/\/Type \/Page \/Parent/g)??[]).length,slideCount);

  const xrefOffset=Number(source.match(/startxref\n(\d+)/)?.[1]);
  assert.equal(source.slice(xrefOffset,xrefOffset+4),"xref");
  const offsets=[...source.matchAll(/^(\d{10}) 00000 n $/gm)].map((match)=>Number(match[1]));
  assert.equal(offsets.length,slideCount*2+5);
  offsets.forEach((offset,index)=>assert.equal(source.slice(offset).startsWith(`${index+1} 0 obj\n`),true));
});

test("renders each slide visual caption once without repeating it in the PDF footer",()=>{
  const source=new TextDecoder().decode(createPresentationPdf(items,presentation,{title:"Autumn campaign",showFooterLabel:true}).bytes);

  assert.equal((source.match(/\(North star\) Tj/g)??[]).length,1);
  assert.equal((source.match(/\(Creative confidence\) Tj/g)??[]).length,1);
  assert.equal((source.match(/\(Autumn campaign\) Tj/g)??[]).length,items.length);
});

test("normalizes filenames and still exports an empty retained deck",()=>{
  assert.equal(presentationPdfFilename("  Déjà vu / deck  "),"deja-vu-deck.pdf");
  assert.equal(presentationPdfFilename("東京の企画","ja-JP"),"東京の企画.pdf");
  assert.equal(presentationPdfFilename("データ分析","ja-JP"),"データ分析.pdf");
  const result=createPresentationPdf([],presentation,{title:"Empty deck",showFooterLabel:false});
  const source=new TextDecoder().decode(result.bytes);
  assert.equal(result.pageCount,1);
  assert.match(source,/No slide content was retained/);
  assert.doesNotMatch(source,/Autumn campaign/);
});

test("preserves scorecard precision and compact public research attribution without exposing private evidence",()=>{
  const values=[
    ["Phone","39.75"],
    ["Tablet","53.00"],
    ["Small monitor","67.25"],
    ["Large monitor","68.50"],
    ["Adaptive/accessibility","58.75"],
    ["Governed creative loop","79.50"],
  ];
  const item={
    title:"Six-goal responsive scorecard",
    body:"Each of the six device and governance goals contributes equally.",
    notes:"PRIVATE PRESENTER NOTES - DO NOT EXPORT",
    image_prompt:"",
    context_group_ids:["private-group-uuid"],
    slide:{
      layout:"scorecard",
      kicker:"Independent product assessment",
      bullets:[],
      sourceIds:["private-slide-source-id"],
      citations:[{sourceId:"private-citation-source-id",label:"Responsive strategy research",anchor:"Goal scorecard",excerpt:"Six independent equal-weight goal means."}],
      visual:{
        kind:"scorecard",
        label:"All six assessment values",
        value:"61.13",
        exactValue:"61.125",
        displayValue:"61.13",
        unit:"/ 100",
        data:values.map(([label,value])=>({label,value,weight:Number(value)/100,sourceIds:[`private-row-${label}`]})),
      },
    },
  };
  const result=createPresentationPdf([item],presentation,{title:"Executive responsive scorecard"});
  const source=new TextDecoder().decode(result.bytes);

  for(const [label,value] of values){
    assert.match(source,new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")),`Missing score label ${label}.`);
    assert.match(source,new RegExp(value.replace(".","\\.")),`Missing score value ${value}.`);
  }
  assert.match(source,/\(Exact: 61\.125 \/ 100\) Tj/);
  assert.match(source,/\(Displayed: 61\.13 \/ 100\) Tj/);
  assert.doesNotMatch(source,/\(Exact: 61\.13(?: \/ 100)?\)/);
  assert.doesNotMatch(source,/\(Displayed: 61\.125(?: \/ 100)?\)/);
  assert.match(source,/Responsive strategy research - Goal scorecard/);
  assert.doesNotMatch(source,/Six independent equal-weight goal means/);
  assert.doesNotMatch(source,/private-(?:group|slide|citation|row)/i);
  assert.doesNotMatch(source,/PRIVATE PRESENTER NOTES/);
  assert.equal(actualText(source).some((entry)=>entry.includes("Responsive strategy research - Goal scorecard")),true);
  assert.equal(item.slide.citations[0].excerpt,"Six independent equal-weight goal means.","audience projection never mutates canonical source evidence");
});

test("preserves verbatim attributed quotations on quote cards and mixed roadmap slides",()=>{
  const quote="The differentiator is not that one brief can make five artifacts; it is that every artifact remains traceable, editable, reviewable, and reusable across devices.";
  const stakeholder={text:quote,speaker:"Morgan Lee",role:"Product Owner",sourceId:"private-stakeholder-source-id",citation:"Executive stakeholder interview"};
  const roadmap=[
    {label:"Initial release",value:"4–6 weeks",weight:.35},
    {label:"Comprehensive program",value:"12–16 weeks",weight:.85},
    {label:"Independent review",value:"Before launch",weight:1},
    {label:"Accessible device postures",value:"All four supported",weight:1},
    {label:"Governed reusable outputs",value:"Evidence retained",weight:.9},
    {label:"Release readiness",value:"Every dependency resolved",weight:1},
  ];
  const slides=[
    {
      title:"Protected stakeholder perspective",body:"The exact stakeholder position remains protected.",notes:"Do not publish presenter notes.",image_prompt:"",
      slide:{layout:"quote",kicker:"Voice of the Product Owner",bullets:[],quote:stakeholder,visual:{kind:"quote",label:"Product direction",value:quote,data:[]}},
    },
    {
      title:"Dependency-aware implementation roadmap",body:"Preserve both release planning ranges.",notes:"Another private note.",image_prompt:"",
      slide:{layout:"roadmap",kicker:"Sequenced delivery",bullets:[],quote:stakeholder,visual:{kind:"roadmap",label:"Delivery dependencies",value:"",data:roadmap}},
    },
  ];
  const result=createPresentationPdf(slides,presentation,{title:"Protected quotes and roadmap"});
  const source=new TextDecoder().decode(result.bytes);

  assert.equal(result.pageCount,2);
  assert.equal((source.match(/\/Span << \/ActualText <FEFF/g)??[]).length,4);
  assert.equal((source.match(/\(Morgan Lee - Product Owner\) Tj/g)??[]).length,2);
  for(const datum of roadmap){
    assert.match(source,new RegExp(datum.label.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")),`Missing roadmap phase ${datum.label}.`);
  }
  assert.match(source,/4-6 weeks/);
  assert.match(source,/12-16 weeks/);
  assert.doesNotMatch(source,/private-stakeholder-source-id|private note|presenter notes/i);
  assert.deepEqual(actualText(source),[slides[0].body,quote,slides[1].body,quote]);
});

test("repairs the actual native split quotation into one complete, searchable, attributed quote",()=>{
  const expected="The differentiator is not that one brief can make five artifacts; it is that every artifact remains traceable, editable, reviewable, and reusable across devices.";
  const item={
    title:"The governed creative loop",
    body:"The durable product differentiator remains attributable.",
    notes:"Do not expose source-only speaker notes.",
    image_prompt:"",
    slide:{
      layout:"statement",
      kicker:"Stakeholder evidence",
      bullets:[],
      visual:{
        kind:"hero-type",
        label:"Product Owner",
        value:"“The differentiator is not that one brief can make five artifacts; it is that every artifact remains traceable, editable",
        data:[{label:"Continuation",value:"reviewable, and reusable across devices.”",weight:1}],
      },
    },
  };
  const source=new TextDecoder().decode(createPresentationPdf([item],presentation).bytes);

  assert.deepEqual(actualText(source),[item.body,expected]);
  assert.match(source,/\(Product Owner\) Tj/);
  assert.doesNotMatch(source,/\(Continuation\) Tj/);
  assert.doesNotMatch(source,/source-only speaker notes/);
});

test("suppresses internal provenance while retaining compact genuine public research attribution",()=>{
  const protectedExcerpt="Authorized excerpt refers to blk_001 as authored evidence.";
  const item={
    title:"Authorized source attribution",
    body:"Evidence references stay understandable and authorized.",
    notes:"",
    image_prompt:"",
    slide:{
      layout:"quote",
      kicker:"Evidence",
      bullets:[],
      quote:{text:"The full attributed statement remains public.",speaker:"Lead Designer",role:"Design",citation:"source_001",sourceId:"grp_001"},
      citations:[
        {sourceId:"blk_001",label:"context_group_1",anchor:"df775088-e5e8-48b5-8ef9-f4e41b93137c",excerpt:protectedExcerpt},
        {sourceId:"clm_001",label:"Customer research",anchor:"decision_1",excerpt:"A customer-approved reference."},
        {sourceId:"source_003",label:"source_responsive-strategy",anchor:"published-strategy",excerpt:"An intentionally authored source label."},
      ],
      visual:{kind:"quote",label:"Protected stakeholder",value:"The full attributed statement remains public.",data:[]},
    },
  };
  const source=new TextDecoder().decode(createPresentationPdf([item],presentation).bytes);
  const semantic=actualText(source);

  assert.equal(semantic.some((entry)=>entry.includes("Customer research")),true);
  assert.equal(semantic.some((entry)=>entry.includes("source_responsive-strategy - published-strategy")),true);
  assert.equal(semantic.some((entry)=>entry.includes(protectedExcerpt)),false);
  assert.equal(semantic.some((entry)=>entry.includes("A customer-approved reference.")),false);
  assert.equal(semantic.some((entry)=>entry.includes("An intentionally authored source label.")),false);
  assert.doesNotMatch(source,/context_group_1|df775088-e5e8-48b5-8ef9-f4e41b93137c|decision_1|source_001|grp_001|clm_001/);
  assert.doesNotMatch(source,/Authorized excerpt refers to blk_001 as authored evidence/);
  assert.equal(item.slide.citations[0].excerpt,protectedExcerpt,"complete evidence remains untouched in the canonical artifact");
});

test("keeps complete comparison, architecture, and color-field visual data without fixed-point slicing",()=>{
  const points=Array.from({length:8},(_,index)=>({label:`Destination ${index+1}`,value:`Evidence ${index+1}`,weight:.5+index*.05}));
  for(const kind of ["comparison","matrix","personas","architecture","diagram","color-field","timeline","roadmap","bars","hero-type","metric"]){
    const layout=kind==="bars"?"scorecard":kind==="diagram"||kind==="color-field"?"architecture":kind==="hero-type"?"split":kind;
    const value=["architecture","diagram","hero-type","metric"].includes(kind)?"Core direction":"";
    const slide={
      title:`Complete ${kind} visual`,body:"Every visible visual element remains inspectable.",notes:"",image_prompt:"",
      slide:{layout,kicker:"Visual evidence",bullets:[],visual:{kind,label:"Eight protected destinations",value,data:points}},
    };
    const source=new TextDecoder().decode(createPresentationPdf([slide],presentation).bytes);
    for(const point of points){
      assert.match(source,new RegExp(point.label),`${kind} omitted ${point.label}.`);
    }
  }
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
  assert.equal(result.filename,"cafe-東京-campaign.pdf");
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

test("assembles more than a thousand tagged captured slides with one shared Unicode font dictionary",()=>{
  const slideCount=1_120;
  const pixels=deflateSync(Uint8Array.from([18,23,21]));
  const pages=Array.from({length:slideCount},(_,index)=>{
    const heading=`Captured slide ${index+1}`;
    const evidence=index===slideCount-1?"Approved closing evidence 東京 😀":"Approved visible evidence";
    return{width:1,height:1,bytes:pixels,heading,text:`${heading}\n${evidence}`,structure:[{role:"H1",text:heading},{role:"P",text:evidence}]};
  });
  const result=createPresentationPdfFromRenderedSlides(pages,{title:"Large tagged presentation"});
  const source=Buffer.from(result.bytes).toString("latin1");

  assert.equal(result.pageCount,slideCount);
  assert.match(source,new RegExp(`\\/Count ${slideCount}(?:\\s|>)`));
  assert.match(source,new RegExp(`\\/ParentTreeNextKey ${slideCount}(?:\\s|>)`));
  assert.equal((source.match(/\/Type \/Page \/Parent/g)??[]).length,slideCount);
  assert.equal((source.match(/\/S \/Sect /g)??[]).length,slideCount);
  assert.equal((source.match(/\/Subtype \/Image/g)??[]).length,slideCount);

  const fontReferences=[...source.matchAll(/\/Resources << \/Font (\d+) 0 R/g)].map((match)=>match[1]);
  assert.equal(fontReferences.length,slideCount);
  assert.equal(new Set(fontReferences).size,1,"all pages reuse the same indirect Unicode font dictionary");
  assert.equal((source.match(/\/F1 \d+ 0 R/g)??[]).length,1);

  const lastHeading=Buffer.from(`Captured slide ${slideCount}\n`,"utf16le").swap16().toString("hex").toUpperCase();
  assert.match(source,new RegExp(`\\/ActualText <FEFF${lastHeading}>`));
  assert.match(source,/<[0-9A-F]{2}> <D83DDE00>/);

  const xrefOffset=Number(source.match(/startxref\n(\d+)/)?.[1]);
  assert.equal(source.slice(xrefOffset,xrefOffset+4),"xref");
  const offsets=[...source.matchAll(/^(\d{10}) 00000 n $/gm)].map((match)=>Number(match[1]));
  const size=Number(source.slice(xrefOffset).match(/^xref\n0 (\d+)/)?.[1]);
  assert.equal(offsets.length,size-1);
  offsets.forEach((offset,index)=>assert.equal(source.slice(offset).startsWith(`${index+1} 0 obj\n`),true));
});

test("rejects empty or invalid browser-rendered slide pages",()=>{
  assert.throws(()=>createPresentationPdfFromRenderedSlides([]),/At least one rendered presentation slide/);
  assert.throws(()=>createPresentationPdfFromRenderedSlides([{width:0,height:2,bytes:Uint8Array.from([1])}]),/valid dimensions/);
  assert.throws(()=>createPresentationPdfFromRenderedSlides([{width:2,height:2,bytes:new Uint8Array()}]),/compressed RGB pixels/);
});

test("localizes untitled Japanese PDF filenames, headings, and metadata",()=>{
  const dictionary={Slide:"スライド","Slide deck":"スライドデッキ"};
  const result=createPresentationPdfFromRenderedSlides([{width:1,height:1,bytes:deflateSync(Uint8Array.of(18,23,21))}],{language:"ja-JP",direction:"ltr",translate:(source)=>dictionary[source]??source,number:(value)=>new Intl.NumberFormat("ja-JP").format(value)});
  const source=Buffer.from(result.bytes).toString("latin1");
  assert.equal(result.filename,"スライドデッキ.pdf");
  assert.deepEqual(actualText(source),["スライド 1\n"]);
  assert.match(source,/\/Lang \(ja-JP\)/);
  assert.match(source,/\/Creator \(Forma\)/);
  assert.doesNotMatch(source,/high-fidelity slideshow PDF export/);
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

test("exports genuine tagged multilingual heading, paragraph, and list structures in reading order",(context)=>{
  const pixels=deflateSync(Uint8Array.from([18,23,21]));
  const result=createPresentationPdfFromRenderedSlides([
    {width:1,height:1,bytes:pixels,text:"مرحبا\nسياق فرنسي Café\nالهدف الأول\nالهدف الثاني",heading:"مرحبا",bullets:["الهدف الأول","الهدف الثاني"],language:"ar",direction:"rtl"},
    {width:1,height:1,bytes:pixels,text:"Présentation\nRésumé 東京 😀",heading:"Présentation",language:"fr",direction:"ltr"},
  ],{title:"خطة Forma",language:"ar",direction:"rtl"});
  const source=Buffer.from(result.bytes).toString("latin1");

  assert.match(source,/\/StructTreeRoot \d+ 0 R/);
  assert.match(source,/\/MarkInfo << \/Marked true >> \/Lang \(ar\)/);
  assert.match(source,/\/ViewerPreferences << \/DisplayDocTitle true >>/);
  assert.match(source,/\/ParentTree \d+ 0 R \/ParentTreeNextKey 2/);
  assert.match(source,/\/StructParents 0 \/Tabs \/S/);
  assert.match(source,/\/StructParents 1 \/Tabs \/S/);
  assert.match(source,/\/S \/Document/);
  assert.equal((source.match(/\/S \/Sect/g)??[]).length,2);
  assert.equal((source.match(/\/S \/H1/g)??[]).length,2);
  assert.equal((source.match(/\/S \/P /g)??[]).length,2);
  assert.match(source,/\/S \/L /);
  assert.equal((source.match(/\/S \/LI /g)??[]).length,2);
  assert.equal((source.match(/\/S \/LBody /g)??[]).length,2);
  assert.match(source,/\/WritingMode \/RlTb/);
  assert.match(source,/\/Lang \(fr\)/);
  assert.equal((source.match(/\/Artifact BMC/g)??[]).length,2);
  assert.match(source,/\/H1 << \/MCID 0 \/ActualText </);
  assert.match(source,/\/LBody << \/MCID 2 \/ActualText </);

  const info=spawnSync("pdfinfo",["-"],{input:Buffer.from(result.bytes),encoding:"utf8"});
  if(info.error?.code==="ENOENT"){context.skip("Poppler pdfinfo is unavailable in this environment.");return;}
  assert.equal(info.status,0,info.stderr);
  assert.match(info.stdout,/Tagged:\s+yes/);

  const structure=spawnSync("pdfinfo",["-struct-text","-"],{input:Buffer.from(result.bytes),encoding:"utf8"});
  assert.equal(structure.status,0,structure.stderr);
  assert.match(structure.stdout,/Document[\s\S]*Sect[\s\S]*H1[^\n]*\n\s*"مرحبا"[\s\S]*P[^\n]*\n\s*"سياق فرنسي Café"[\s\S]*L[\s\S]*LI[\s\S]*LBody[^\n]*\n\s*"الهدف الأول"[\s\S]*LI[\s\S]*LBody[^\n]*\n\s*"الهدف الثاني"[\s\S]*Sect[\s\S]*H1[^\n]*\n\s*"Présentation"[\s\S]*P[^\n]*\n\s*"Résumé 東京 😀"/);
});

test("preserves bullet reading order ahead of later chart labels and footer text",(context)=>{
  const pixels=deflateSync(Uint8Array.from([18,23,21]));
  const result=createPresentationPdfFromRenderedSlides([{
    width:1,height:1,bytes:pixels,heading:"Campaign direction",bullets:["First decision","Second decision"],
    text:"Campaign direction\nContext for the review\nFirst decision\nSecond decision\nCreative confidence\n87%\nReview deck",
  }]);
  const structure=spawnSync("pdfinfo",["-struct-text","-"],{input:Buffer.from(result.bytes),encoding:"utf8"});
  if(structure.error?.code==="ENOENT"){context.skip("Poppler pdfinfo is unavailable in this environment.");return;}
  assert.equal(structure.status,0,structure.stderr);
  assert.match(structure.stdout,/"Context for the review"[\s\S]*LBody[^\n]*\n\s*"First decision"[\s\S]*LBody[^\n]*\n\s*"Second decision"[\s\S]*"Creative confidence"[\s\S]*"87%"[\s\S]*"Review deck"/);
});

test("retains complete accessible scorecards, comparison tables, attributed quotes, and citations",(context)=>{
  const quote="The differentiator is not that one brief can make five artifacts; it is that every artifact remains traceable, editable, reviewable, and reusable across devices.";
  const scores=[
    ["Phone","39.75"],
    ["Tablet","53.00"],
    ["Small monitor","67.25"],
    ["Large monitor","68.50"],
    ["Adaptive/accessibility","58.75"],
    ["Governed creative loop","79.50"],
  ];
  const scoreItems=scores.map(([label,value])=>({role:"LI",children:[{role:"LBody",text:`${label}: ${value}`}]}));
  const rows=scores.map(([label,value])=>({role:"TR",children:[{role:"TH",text:label},{role:"TD",text:value}]}));
  const sourceLines=[
    "Six-goal responsive assessment",
    "Exact average: 61.125",
    "Displayed average: 61.13",
    ...scores.map(([label,value])=>`${label}: ${value}`),
    ...scores.map(([label,value])=>`${label}\t${value}`),
    quote,
    "Product Owner",
    "Source: executive responsive strategy",
    "Forma Everywhere",
  ];
  const result=createPresentationPdfFromRenderedSlides([{
    width:1,
    height:1,
    bytes:deflateSync(Uint8Array.from([18,23,21])),
    heading:"Six-goal responsive assessment",
    text:sourceLines.join("\n"),
    structure:[
      {role:"H1",text:"Six-goal responsive assessment"},
      {role:"Figure",children:[
        {role:"Caption",text:"All six equal-weight goal scores"},
        {role:"P",text:"Exact average: 61.125"},
        {role:"P",text:"Displayed average: 61.13"},
        {role:"L",children:scoreItems},
      ]},
      {role:"Table",children:[
        {role:"Caption",text:"Device posture comparison"},
        {role:"THead",children:[{role:"TR",children:[{role:"TH",text:"Posture"},{role:"TH",text:"Score"}]}]},
        {role:"TBody",children:rows},
      ]},
      {role:"Figure",children:[
        {role:"BlockQuote",text:quote},
        {role:"Caption",text:"Product Owner"},
      ]},
      {role:"Note",text:"Source: executive responsive strategy"},
    ],
  }],{title:"Forma executive opportunity"});
  const source=Buffer.from(result.bytes).toString("latin1");

  for(const role of ["Figure","Caption","Table","THead","TBody","TR","TH","TD","BlockQuote","Note"]){
    assert.match(source,new RegExp(`\\/S \\/${role}(?: \\n?|>)`),`Missing PDF semantic role ${role}.`);
  }
  assert.equal((source.match(/\/S \/TD /g)??[]).length,6);
  assert.match(source,/\/A << \/O \/Table \/Scope \/Column >>/);
  assert.match(source,/\/Alt <FEFF/);

  const info=spawnSync("pdfinfo",["-"],{input:Buffer.from(result.bytes),encoding:"utf8"});
  if(info.error?.code==="ENOENT"){context.skip("Poppler pdfinfo is unavailable in this environment.");return;}
  assert.equal(info.status,0,info.stderr);
  assert.match(info.stdout,/Tagged:\s+yes/);

  const structure=spawnSync("pdfinfo",["-struct-text","-"],{input:Buffer.from(result.bytes),encoding:"utf8"});
  assert.equal(structure.status,0,structure.stderr);
  assert.match(structure.stdout,/"Exact average: 61\.125"[\s\S]*"Displayed average: 61\.13"/);
  for(const [label,value] of scores){
    assert.match(structure.stdout,new RegExp(`"${label.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}: ${value}"`));
  }
  assert.match(structure.stdout,/Table[\s\S]*THead[\s\S]*"Posture"[\s\S]*TBody[\s\S]*"Governed creative loop"[\s\S]*"79\.50"/);
  assert.match(structure.stdout,/BlockQuote[^\n]*\n\s*"The differentiator is not that one brief can make five artifacts; it is that every artifact remains traceable, editable, reviewable, and reusable across devices\."[\s\S]*Caption[^\n]*\n\s*"Product Owner"/);
  assert.match(structure.stdout,/Note[^\n]*\n\s*"Source: executive responsive strategy"[\s\S]*"Forma Everywhere"/);

  const extracted=spawnSync("pdftotext",["-","-"],{input:Buffer.from(result.bytes),encoding:"utf8"});
  if(extracted.error?.code==="ENOENT")return;
  assert.equal(extracted.status,0,extracted.stderr);
  assert.match(extracted.stdout,/traceable, editable, reviewable, and reusable across devices/);
  assert.doesNotMatch(extracted.stdout,/private-source-id|Speaker notes/i);
});

test("rejects unsupported structured roles while preserving visible fallback copy",()=>{
  const result=createPresentationPdfFromRenderedSlides([{
    width:1,
    height:1,
    bytes:deflateSync(Uint8Array.from([18,23,21])),
    heading:"Authorized visible slide",
    text:"Authorized visible slide\nPublic evidence",
    structure:[{role:"Artifact",text:"Private hidden speaker notes"}],
  }]);
  const source=Buffer.from(result.bytes).toString("latin1");

  assert.equal((source.match(/\/S \/H1 /g)??[]).length,1);
  assert.equal((source.match(/\/S \/P /g)??[]).length,1);
  assert.doesNotMatch(source,/Private hidden speaker notes/);
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
  assert.match(exporter,/wrapper\.setAttribute\("lang",host\.closest\("forma-ui-locale"\)\?\.getAttribute\("lang"\)\|\|document\.documentElement\.lang\|\|"en"\)/);
  assert.match(exporter,/document\.createElement\("forma-ui-locale"\)/);
  assert.match(exporter,/wrapper\.setAttribute\("dir",inherited\.direction\|\|document\.documentElement\.dir\|\|"ltr"\)/);
  assert.match(exporter,/heading:host\.querySelector<HTMLElement>/);
  assert.match(exporter,/bullets:Array\.from\(host\.querySelectorAll<HTMLElement>/);
  assert.match(exporter,/CompressionStream\("deflate"\)/);
  assert.match(exporter,/EXPORT_SCALE=2/);
  assert.match(deck,/renderPresentationPdf\(items,presentation,options\)/);
  assert.match(deck,/inferPresentationAudienceLocale\(source,this\.i18n\.locale\)/,"presentation language must follow authored content independently of the application chrome");
  assert.match(deck,/const audience=this\.#audienceLocalization\(items\),options=/,"PDF and PowerPoint must share their authored audience-language policy");
  assert.match(deck,/render_mode:"browser-slide-capture"/);
  assert.doesNotMatch(deck,/\bcreatePresentationPdf\s*\(/);
  assert.doesNotMatch(deck,/compatible-vector/);
  assert.match(deck,/presentation\.export\.pdfFailed/,"PDF failures remain accurately and accessibly localized");
  assert.match(deck,/\?selected=\$\{preset\.id===selectedStyle\}/);
});
