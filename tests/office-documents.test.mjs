import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { defaultSlidePresentation, parseDocumentArtifactContent } from "../src/model/document-artifacts.ts";
import { createOfficeArchive, createPowerPointDocument, createWordDocument, POWERPOINT_DOCUMENT_MIME, WORD_DOCUMENT_MIME } from "../src/model/office-documents.ts";
import { extractSourceDocument } from "../src/model/source-documents.ts";
import japaneseMessages from "../src/components/design-system/locales/ja.ts";

function verifyOfficeArchive(bytes,{binary=false}={}){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),end=bytes.byteLength-22;
  assert.equal(view.getUint32(end,true),0x06054b50,"the ZIP end-of-central-directory record exists");
  const count=view.getUint16(end+10,true),length=view.getUint32(end+12,true);
  let central=view.getUint32(end+16,true);
  assert.equal(central+length,end,"central-directory boundaries match the archive footer");
  const entries=new Map();
  for(let index=0;index<count;index+=1){
    assert.equal(view.getUint32(central,true),0x02014b50,"every advertised central-directory entry exists");
    const nameLength=view.getUint16(central+28,true),extraLength=view.getUint16(central+30,true),commentLength=view.getUint16(central+32,true);
    const name=new TextDecoder().decode(bytes.slice(central+46,central+46+nameLength));
    const local=view.getUint32(central+42,true),size=view.getUint32(central+24,true);
    assert.equal(view.getUint32(local,true),0x04034b50,`${name} has a real local-file header`);
    assert.equal(view.getUint16(local+8,true),0,"the dependency-free archive uses interoperable ZIP STORE parts");
    const offset=local+30+view.getUint16(local+26,true)+view.getUint16(local+28,true);
    const body=bytes.slice(offset,offset+size);
    let crc=0xffffffff;
    for(const byte of body){crc^=byte;for(let bit=0;bit<8;bit+=1)crc=crc&1?0xedb88320^(crc>>>1):crc>>>1;}
    assert.equal((crc^0xffffffff)>>>0,view.getUint32(central+16,true),`${name} has a valid independently calculated CRC-32`);
    assert.equal(size,view.getUint32(local+22,true),`${name} has consistent local and central uncompressed sizes`);
    entries.set(name,binary?body:new TextDecoder().decode(body));
    central+=46+nameLength+extraLength+commentLength;
  }
  assert.equal(central,end);
  for(const [name,xml] of entries){
    if(!name.endsWith(".rels")||typeof xml!=="string")continue;
    const base=name==="_rels/.rels"?"":name.replace(/\/_rels\/[^/]+\.rels$/,"/");
    for(const [,target] of xml.matchAll(/\bTarget="([^"]+)"/g)){
      if(/^[a-z]+:/i.test(target))continue;
      const resolved=path.posix.normalize(path.posix.join(base,target));
      assert.ok(entries.has(resolved),`${name} relationship resolves to existing package part ${resolved}`);
    }
  }
  return entries;
}

function editableShape(xml,name,kind="sp"){
  const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  const expression=new RegExp(`<p:${kind}>(?:(?!<\\/p:${kind}>)[\\s\\S])*?<p:cNvPr id="\\d+" name="${escaped}"(?:(?!<\\/p:${kind}>)[\\s\\S])*?<\\/p:${kind}>`);
  const match=xml.match(expression);
  assert.ok(match,`editable PowerPoint ${kind} exists: ${name}`);
  return match[0];
}

function shapeText(xml,name){
  return [...editableShape(xml,name).matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(([,value])=>value).join("\n");
}

function shapeBox(xml,name){
  const shape=editableShape(xml,name),offset=shape.match(/<a:off x="(\d+)" y="(\d+)"\/>/),extent=shape.match(/<a:ext cx="(\d+)" cy="(\d+)"\/>/);
  assert.ok(offset&&extent,`${name} has an editable PowerPoint bounding box`);
  return{x:Number(offset[1]),y:Number(offset[2]),width:Number(extent[1]),height:Number(extent[2])};
}

test("editable Word exports round-trip real paragraphs, headings, lists, and safe Unicode",async()=>{
  const markdown="# Approved creative brief\n\n## Boundaries\n- Keep the customer's exact words\n- Preserve **licensed evidence** & <creative intent>\n\nA real paragraph with café and 東京.";
  const bytes=createWordDocument(markdown,{title:"Customer & product <brief>"});
  const source=await extractSourceDocument(new File([bytes],"customer-brief.docx",{type:WORD_DOCUMENT_MIME}));
  assert.equal(source.status,"ready");
  assert.equal(source.sourceKind,"word");
  assert.match(source.text,/Approved creative brief/);
  assert.match(source.text,/Keep the customer's exact words/);
  assert.match(source.text,/licensed evidence/);
  assert.match(source.text,/creative intent/);
  assert.match(source.text,/café and 東京/);
  const archive=new TextDecoder().decode(bytes);
  assert.match(archive,/<w:pStyle w:val="Heading1"\/>/);
  assert.match(archive,/<w:numPr>/);
  assert.match(archive,/<w:b\/>/);
  assert.match(archive,/Customer &amp; product &lt;brief&gt;/);
  assert.doesNotMatch(archive,/<creative intent>/);
  verifyOfficeArchive(bytes);
});

test("authorized presenter PowerPoint exports round-trip slides and explicitly include private notes",async()=>{
  const items=[
    {title:"Decision one",body:"Explain the real project boundary.",notes:"Say the private speaker context & <notes>.",image_prompt:"",slide:{layout:"cover",kicker:"Pilot",bullets:["Named participants","Fixed total spend"],visual:{kind:"metric",label:"Controlled cohort",value:"10 people",data:[]}}},
    {title:"Decision two",body:"Show why customer context matters.",notes:"Pause for the procurement concern.",image_prompt:"",slide:null},
  ];
  const presentation={...defaultSlidePresentation("field-notes"),footerLabel:"Forma pilot"};
  const bytes=createPowerPointDocument(items,presentation,{title:"Pilot & product decisions",showFooterLabel:true,includePresenterNotes:true});
  const source=await extractSourceDocument(new File([bytes],"pilot-decisions.pptx",{type:POWERPOINT_DOCUMENT_MIME}));
  assert.equal(source.status,"ready");
  assert.equal(source.sourceKind,"presentation");
  assert.deepEqual(source.segments.map((segment)=>segment.anchor),["Slide 1","Slide 2"]);
  assert.match(source.text,/Decision one/);
  assert.match(source.text,/Fixed total spend/);
  assert.match(source.text,/Decision two/);
  assert.doesNotMatch(source.text,/private speaker context/,"speaker notes are not accidentally merged into visible slide content");
  const archive=new TextDecoder().decode(bytes);
  assert.match(archive,/ppt\/notesSlides\/notesSlide1\.xml/);
  assert.match(archive,/private speaker context &amp; &lt;notes&gt;/);
  assert.match(archive,/<p:sldSz cx="12192000" cy="6858000" type="screen16x9"\/>/);
  assert.match(archive,/<p:cNvPr id="\d+" name="Editable slide title"\/>/);
  assert.match(archive,/Forma pilot/);
  verifyOfficeArchive(bytes);
});

test("professional exports preserve long approved writing, complete speaker notes, intentional repeated warnings, and numbered lists",()=>{
  const lines=Array.from({length:6002},(_,index)=>index===6001?"FINAL CUSTOMER APPROVED LINE 6002":`Approved line ${index+1}`);
  const word=createWordDocument(["1. First exact step","2. Second exact step",...lines].join("\n"),{title:"Complete controlled project"});
  const wordParts=verifyOfficeArchive(word);
  assert.match(wordParts.get("word/document.xml"),/FINAL CUSTOMER APPROVED LINE 6002/,"a valid Word export never silently drops later approved paragraphs");
  assert.match(wordParts.get("word/document.xml"),/<w:numId w:val="2"\/>/,"ordered lists use their own Word numbering definition");
  assert.match(wordParts.get("word/numbering.xml"),/<w:numFmt w:val="decimal"\/>/);

  const warning="Approved recurring customer confidentiality warning";
  const draft=parseDocumentArtifactContent(JSON.stringify({title:"Approved presentation",summary:"",content_markdown:"# Approved presentation",presentation:defaultSlidePresentation(),items:[
    {title:"Decision one",body:Array.from({length:25},(_,index)=>index===24?"FINAL VISIBLE LINE 25":`Visible line ${index+1}`).join("\n"),notes:Array.from({length:101},(_,index)=>index===100?"FINAL SPEAKER NOTE 101":`Speaker note ${index+1}`).join("\n"),image_prompt:"",slide:{layout:"statement",kicker:"One",bullets:[warning],visual:{kind:"metric",label:"Outcome",value:"One",data:[]}}},
    {title:"Decision two",body:"A distinct decision",notes:"The complete presenter context",image_prompt:"",slide:{layout:"statement",kicker:"Two",bullets:[warning],visual:{kind:"metric",label:"Outcome",value:"Two",data:[]}}},
  ]}));
  assert.ok(draft);
  assert.deepEqual(draft.items.map((item)=>item.slide.bullets[0]),[warning,warning],"stored, approved cross-slide copy is never rewritten by provider-draft de-duplication");
  const parts=verifyOfficeArchive(createPowerPointDocument(draft.items,draft.presentation,{title:draft.title,includePresenterNotes:true}));
  assert.match(parts.get("ppt/slides/slide1.xml"),/FINAL VISIBLE LINE 25/);
  assert.match(parts.get("ppt/notesSlides/notesSlide1.xml"),/FINAL SPEAKER NOTE 101/);
  assert.match(parts.get("ppt/slides/slide1.xml"),new RegExp(warning));
  assert.match(parts.get("ppt/slides/slide2.xml"),new RegExp(warning));
});

test("PowerPoint scorecards keep all six independently editable categories and distinguish exact from rounded precision",async()=>{
  const values=[
    ["Phone","39.75"],
    ["Tablet","53.00"],
    ["Small monitor","67.25"],
    ["Large monitor","68.50"],
    ["Adaptive/accessibility","58.75"],
    ["Governed creative loop","79.50"],
  ];
  const item={title:"Six equal-weight responsive assessment scores",body:"Every authored dimension contributes to the equal-weight average.",notes:"Discuss every assessment dimension before the investment decision.",image_prompt:"",context_group_ids:["PRIVATE_CONTEXT_GROUP"],slide:{layout:"scorecard",kicker:"Protected evidence",section:"Assessment",sourceIds:["PRIVATE_SOURCE_ID"],citations:[{sourceId:"PRIVATE_CITATION_ID",label:"Responsive product research",anchor:"Assessment scores",excerpt:"All six dimensions use equal weighting."}],bullets:[],visual:{kind:"scorecard",label:"Assessment dimensions",value:"",exactValue:"61.125",displayValue:"61.13",unit:"/ 100",data:values.map(([label,value],index)=>({label,value,weight:Number(value)/100,sourceIds:[`PRIVATE_DATUM_${index+1}`]}))}}};
  const presentation=defaultSlidePresentation("field-notes");
  const bytes=createPowerPointDocument([item],presentation,{title:"Assessment scorecard",showFooterLabel:true,includePresenterNotes:true});
  const parts=verifyOfficeArchive(bytes),slide=parts.get("ppt/slides/slide1.xml"),notes=parts.get("ppt/notesSlides/notesSlide1.xml");

  assert.equal(shapeText(slide,"Editable exact value label"),"Exact value");
  assert.equal(shapeText(slide,"Editable exact value"),"61.125");
  assert.equal(shapeText(slide,"Editable exact value unit"),"/ 100");
  assert.equal(shapeText(slide,"Editable displayed value label"),"Rounded display");
  assert.equal(shapeText(slide,"Editable displayed value"),"61.13");
  assert.equal(shapeText(slide,"Editable displayed value unit"),"/ 100");
  for(const [[label,value],index] of values.map((entry,index)=>[entry,index])){
    assert.equal(shapeText(slide,`Editable score label ${index+1}`),label);
    assert.equal(shapeText(slide,`Editable score value ${index+1}`),`${value} / 100`);
    assert.match(editableShape(slide,`Editable score track ${index+1}`),/<a:prstGeom prst="roundRect">/);
    assert.match(editableShape(slide,`Editable score bar ${index+1}`),/<a:solidFill><a:srgbClr val="287260"\/><\/a:solidFill>/);
    const labelBox=shapeBox(slide,`Editable score label ${index+1}`),valueBox=shapeBox(slide,`Editable score value ${index+1}`),trackBox=shapeBox(slide,`Editable score track ${index+1}`);
    assert.ok(labelBox.height>=1350/100*12700,`score label ${index+1} fits its declared 13.5pt text`);
    assert.ok(valueBox.height>=1400/100*12700,`score value ${index+1} fits its declared 14pt text`);
    assert.ok(trackBox.y>=labelBox.y+labelBox.height,`score bar ${index+1} cannot strike through its readable label`);
  }
  assert.equal([...slide.matchAll(/name="Editable score bar \d+"/g)].length,6,"all six values have independently editable native PowerPoint geometry");
  assert.match(shapeText(slide,"Editable evidence citation 1"),/Responsive product research · Assessment scores/);
  assert.doesNotMatch(slide,/All six dimensions use equal weighting\./,"full source excerpts stay off audience-facing slide shapes");
  assert.match(notes,/\[Sources\]/);
  assert.match(notes,/All six dimensions use equal weighting\./);
  assert.doesNotMatch(new TextDecoder().decode(bytes),/PRIVATE_(?:CONTEXT|SOURCE|CITATION|DATUM)/,"authorized evidence labels never expose private block, context, or source identifiers");

  const extracted=await extractSourceDocument(new File([bytes],"assessment.pptx",{type:POWERPOINT_DOCUMENT_MIME}));
  for(const [label,value] of values){assert.match(extracted.text,new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")));assert.match(extracted.text,new RegExp(value.replace(".","\\.")));}
  assert.match(extracted.text,/61\.125/);
  assert.match(extracted.text,/61\.13/);
  for(const [,size,text] of slide.matchAll(/<a:rPr\b[^>]*\bsz="(\d+)"[^>]*>[\s\S]*?<a:t>([^<]+)<\/a:t>/g)){
    if(text.trim())assert.ok(Number(size)>=1200,`visible PowerPoint text stays at least 12pt: ${text}`);
  }
});

test("dense architecture bullets reflow without collisions or clipped editable labels",()=>{
  const long="A responsive creative experience must preserve every authored source decision, reviewer boundary, accessibility requirement, reusable evidence relationship, and cross-device continuity checkpoint without hiding the enterprise controls that keep ownership and accountability clear.";
  const bullets=[long,...Array.from({length:7},(_,index)=>`Distinct authored supporting argument ${index+2}`)];
  const item={title:"Responsive architecture",body:"Every essential authored argument remains readable.",notes:"",image_prompt:"",slide:{layout:"architecture",kicker:"Evidence",bullets,visual:{kind:"architecture",label:"Five connected product surfaces",value:"Each surface shares governed continuity.",data:Array.from({length:5},(_,index)=>({label:`Product surface ${index+1}`,value:`Accountable outcome ${index+1}`,weight:.5}))}}};
  const parts=verifyOfficeArchive(createPowerPointDocument([item],defaultSlidePresentation("field-notes"))),slide=parts.get("ppt/slides/slide1.xml");
  const first=shapeBox(slide,"Editable supporting points"),second=shapeBox(slide,"Editable supporting points 2"),summary=shapeBox(slide,"Editable diagram summary");
  assert.ok(first.height>=8*205000,"the exceptionally long authored bullet receives enough wrapped lines");
  assert.equal(second.y,first.y,"dense bullets become two parallel readable columns");
  assert.ok(summary.y>=first.y+first.height,"diagram summary never obscures a supporting argument");
  assert.match(shapeText(slide,"Editable supporting points"),/responsive creative experience must preserve every authored source decision/u);
  for(let index=1;index<=5;index+=1){
    const label=shapeBox(slide,`Editable diagram label ${index}`),value=shapeBox(slide,`Editable diagram value ${index}`),node=shapeBox(slide,`Editable diagram node ${index}`);
    assert.ok(label.height>=1400/100*12700,`diagram label ${index} fits its 14pt text`);
    assert.ok(value.height>=1200/100*12700,`diagram value ${index} fits its 12pt text`);
    assert.ok(value.y>=label.y+label.height,`diagram node ${index} separates label from value`);
    assert.ok(value.y+value.height<=node.y+node.height,`diagram node ${index} contains its visible value`);
  }
  const chapter=shapeBox(slide,"Chapter label"),number=shapeBox(slide,"Editable slide number");
  assert.ok(chapter.x+chapter.width<=number.x,"chapter and page number occupy separate horizontal space");
});

test("editable PowerPoint fails closed before protected architecture shapes leave the canonical slide",()=>{
  const architecture=(count)=>({
    title:"Complete protected source architecture",
    body:"Every approved source claim must remain on the visible page.",
    notes:"Retain all source-authored presenter evidence.",
    image_prompt:"",
    slide:{
      layout:"architecture",
      kicker:"Approved source evidence",
      bullets:[],
      visual:{
        kind:"architecture",
        label:"Source-grounded architecture",
        value:"",
        data:Array.from({length:count},(_,index)=>({label:`Protected category ${index+1}`,value:String(index+1),weight:.5})),
      },
    },
  });
  const excessive=architecture(48),approved=structuredClone(excessive);
  assert.throws(()=>createPowerPointDocument([excessive],defaultSlidePresentation()),/office_archive_slide_layout_overflow/);
  assert.deepEqual(excessive,approved,"an unsafe export never rewrites or drops approved source evidence");
  assert.doesNotThrow(()=>createPowerPointDocument([architecture(24)],defaultSlidePresentation()));
});

test("roadmap duration remains editable and round-trippable exactly once without units on qualitative milestones",async()=>{
  const item={title:"A fully governed program",body:"Deliver independently useful milestones.",notes:"",image_prompt:"",slide:{layout:"roadmap",kicker:"Delivery",bullets:[],visual:{kind:"roadmap",label:"Program milestones",value:"",exactValue:"12–16",displayValue:"12–16 weeks",unit:"weeks",data:[{label:"1",value:"truth/baseline",weight:.25},{label:"2",value:"adaptive shell",weight:.5},{label:"3",value:"secure Activity",weight:.75},{label:"4",value:"phone Work/Chat",weight:1}]}}};
  const bytes=createPowerPointDocument([item],defaultSlidePresentation("field-notes")),slide=verifyOfficeArchive(bytes).get("ppt/slides/slide1.xml");
  assert.equal(shapeText(slide,"Editable roadmap duration"),"12–16 weeks");
  assert.doesNotMatch(slide,/12–16 weeks weeks|secure Activity weeks|adaptive shell weeks/u);
  assert.equal(shapeText(slide,"Editable timeline value 3"),"secure Activity");
  const extracted=await extractSourceDocument(new File([bytes],"governed-roadmap.pptx",{type:POWERPOINT_DOCUMENT_MIME}));
  assert.match(extracted.text,/12–16 weeks/u,"the source importer retains the authored roadmap duration");
});

test("qualitative scorecards export as readable editable comparisons without invented numerical bars",async()=>{
  const rows=[
    ["Project context","Durable shared project context"],
    ["Lenses","Seven lenses"],
    ["Applications","Six genuinely scoped applications"],
    ["Exports","Editable PPTX/DOCX with slide speaker notes; PDF exports"],
    ["Review","Source-aware review and output revisions"],
    ["Controls","Organization retention and spending controls"],
  ];
  const item={title:"Proven assets",body:"The investment builds on durable product capabilities already in hand.",notes:"Inspect all approved qualitative assets.",image_prompt:"",slide:{layout:"scorecard",kicker:"Investment case",bullets:[],visual:{kind:"scorecard",label:"Existing foundation",value:"",data:rows.map(([label,value])=>({label,value,weight:1/6}))}}};
  const bytes=createPowerPointDocument([item],defaultSlidePresentation("editorial")),slide=verifyOfficeArchive(bytes).get("ppt/slides/slide1.xml");
  assert.equal(shapeText(slide,"Editable comparison heading"),"Existing foundation","the authored qualitative visual caption remains visible and editable");
  assert.doesNotMatch(slide,/name="Editable score (?:track|bar) \d+"/u,"qualitative capabilities must not pretend to be measured assessment scores");
  for(const [[label,value],index] of rows.map((entry,index)=>[entry,index])){
    assert.equal(shapeText(slide,`Editable comparison label ${index+1}`),label);
    assert.equal(shapeText(slide,`Editable comparison value ${index+1}`),value);
    const valueBox=shapeBox(slide,`Editable comparison value ${index+1}`);
    const capacity=Math.max(1,Math.floor(valueBox.width/(13*12700*.56)));
    const lines=Math.ceil(value.length/capacity);
    assert.ok(valueBox.height>=lines*13*12700,`qualitative description ${index+1} fits every wrapped 13pt line`);
  }
  const extracted=await extractSourceDocument(new File([bytes],"proven-assets.pptx",{type:POWERPOINT_DOCUMENT_MIME}));
  assert.ok(extracted.text.includes("Existing foundation"),"the authored qualitative caption survives PowerPoint source re-import");
  for(const [label,value] of rows){assert.ok(extracted.text.includes(label));assert.ok(extracted.text.includes(value));}
});

test("PowerPoint quote cards preserve complete verbatim stakeholder quotations, attribution, citations, and independent notes",()=>{
  const quotation="The differentiator is not that one brief can make five artifacts; it is that every artifact remains traceable, editable, reviewable, and reusable across devices.";
  const item={title:"A source-bound creative workbench",body:"The product owner identifies its durable competitive advantage.",notes:"Invite the team to consider cross-device traceability.",image_prompt:"",slide:{layout:"quote",kicker:"Stakeholder voice",quote:{text:quotation,speaker:"Dana",role:"Product Owner",sourceId:"PRIVATE_QUOTE_SOURCE",citation:"Executive narrative · Stakeholder interviews"},citations:[{sourceId:"PRIVATE_CITATION_SOURCE",label:"Executive stakeholder interviews",anchor:"Stakeholder interviews",excerpt:quotation}],bullets:[],visual:{kind:"quote",label:"Product Owner",value:"The differentiator is not that one brief can make five artifacts; it is that every artifact remains traceable, editable,",data:[]}}};
  const parts=verifyOfficeArchive(createPowerPointDocument([item],defaultSlidePresentation("editorial"),{includePresenterNotes:true})),slide=parts.get("ppt/slides/slide1.xml"),notes=parts.get("ppt/notesSlides/notesSlide1.xml");

  editableShape(slide,"Editable quotation card");
  editableShape(slide,"Editable quotation accent");
  assert.equal(shapeText(slide,"Editable quotation"),quotation,"the dedicated quotation field wins over any legacy truncated visual value");
  assert.equal(shapeText(slide,"Editable quotation attribution"),"— Dana · Product Owner");
  assert.match(shapeText(slide,"Editable evidence citation 1"),/Executive stakeholder interviews · Stakeholder interviews/);
  assert.match(notes,new RegExp(quotation.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")));
  assert.match(notes,/— Dana · Product Owner/);
  assert.match(notes,/\[Stakeholder quotation\]/);
  assert.match(notes,/\[Sources\]/);
  assert.doesNotMatch(`${slide}${notes}`,/PRIVATE_(?:QUOTE|CITATION)_SOURCE/);
  assert.match(editableShape(slide,"Editable quotation"),/<a:spAutoFit\/>/,"PowerPoint can fit the complete editable quotation without silent text truncation");
});

test("PowerPoint source footnotes never expose opaque aliases or internal UUIDs disguised as citation labels",()=>{
  const item={title:"An authorized evidence statement",body:"The approved source excerpt remains available.",notes:"Existing presenter language remains unchanged.",image_prompt:"",slide:{layout:"quote",kicker:"Evidence",quote:{text:"A smaller screen is not a smaller product.",speaker:"Lead Designer",role:"Design",sourceId:"decision_1",citation:"df775088-e5e8-48b5-8ef9-f4e41b93137c"},citations:[{sourceId:"blk_001",label:"grp_001",anchor:"context_group_1",excerpt:"Meaningful approved source excerpt containing the incidental phrase decision_1."},{sourceId:"source_002",label:"Published responsive strategy research",anchor:"Responsive product direction",excerpt:"The named authored source remains visible."}],sourceIds:["clm_001"],bullets:[],visual:{kind:"quote",label:"Design evidence",value:"",data:[]}}};
  const parts=verifyOfficeArchive(createPowerPointDocument([item],defaultSlidePresentation(),{includePresenterNotes:true})),slide=parts.get("ppt/slides/slide1.xml"),notes=parts.get("ppt/notesSlides/notesSlide1.xml");

  assert.equal(shapeText(slide,"Editable evidence citation 1"),"[1] Published responsive strategy research · Responsive product direction","genuine public research remains compact and aligned with the browser and PDF");
  assert.doesNotMatch(slide,/Meaningful approved source excerpt|The named authored source remains visible\./,"private provenance excerpts never enter audience slide shapes");
  assert.doesNotMatch(`${slide}${notes}`,/\b(?:grp_001|blk_001|clm_001|context_group_1)\b|df775088-e5e8-48b5-8ef9-f4e41b93137c/);
  assert.match(notes,/Meaningful approved source excerpt containing the incidental phrase decision_1\./,"authored evidence is never silently rewritten when an identifier-looking phrase is incidental");
});

test("comparison matrices, persona cards, architecture diagrams, and roadmaps retain editable semantic geometry",()=>{
  const visual=(kind,data)=>({kind,label:"Responsive product evidence",value:"",data:data.map(([label,value])=>({label,value,weight:.75}))});
  const item=(layout,kind,data)=>({title:`Editable ${layout}`,body:"The approved comparison remains independently editable.",notes:`Presenter context for ${layout}.`,image_prompt:"",slide:{layout,kicker:"Product architecture",bullets:[],visual:visual(kind,data)}});
  const entries=[
    item("matrix","matrix",[["Phone","Focused orientation"],["Tablet","Flexible posture"],["Small monitor","Structured work"],["Large monitor","Connected context"]]),
    item("comparison","comparison",[["Portrait","Task-first composition"],["Landscape","Visible related work"],["Adaptive","Equivalent completion"]]),
    item("personas","personas",[["Lead Designer","Hierarchy and responsive continuity"],["Product Owner","Traceable governed decisions"],["Market Researcher","Actionable global inbox"]]),
    item("architecture","architecture",[["Projects","Owned resources"],["Work","Authored decisions"],["Explore","Creative alternatives"],["Activity","Global attention"],["Deliver","Governed handoff"]]),
    item("roadmap","roadmap",[["Weeks 1–2","Foundation and source evidence"],["Weeks 3–6","Accessible responsive parity"],["Weeks 7–12","Enterprise governance"],["Weeks 13–16","Portfolio-scale delivery"]]),
  ];
  entries[4].slide.quote={text:"An asynchronous job without a global, actionable inbox is just work the customer has to remember to check.",speaker:"Market Researcher",role:"Research stakeholder"};
  const parts=verifyOfficeArchive(createPowerPointDocument(entries,defaultSlidePresentation("nocturne"))),matrix=parts.get("ppt/slides/slide1.xml"),comparison=parts.get("ppt/slides/slide2.xml"),personas=parts.get("ppt/slides/slide3.xml"),architecture=parts.get("ppt/slides/slide4.xml"),roadmap=parts.get("ppt/slides/slide5.xml");

  editableShape(matrix,"Editable matrix category header 1");
  editableShape(matrix,"Editable matrix value header 1");
  assert.equal(shapeText(matrix,"Editable matrix label 4"),"Large monitor");
  assert.equal(shapeText(matrix,"Editable matrix value 4"),"Connected context");
  assert.equal(shapeText(comparison,"Editable comparison label 3"),"Adaptive");
  assert.equal(shapeText(comparison,"Editable comparison value 2"),"Visible related work");
  assert.equal(shapeText(personas,"Editable comparison label 3"),"Market Researcher");
  editableShape(personas,"Editable comparison card 2");
  for(const [index,label] of ["Projects","Work","Explore","Activity","Deliver"].entries()){
    editableShape(architecture,`Editable diagram node ${index+1}`);
    assert.equal(shapeText(architecture,`Editable diagram label ${index+1}`),label);
  }
  assert.ok([...architecture.matchAll(/<p:cxnSp>/g)].length>=4,"information architecture relationships remain native editable connectors");
  editableShape(architecture,"Editable diagram connector 1","cxnSp");
  assert.equal(shapeText(roadmap,"Editable timeline label 2"),"Weeks 3–6");
  assert.equal(shapeText(roadmap,"Editable timeline value 4"),"Portfolio-scale delivery");
  assert.equal(shapeText(roadmap,"Editable quotation"),entries[4].slide.quote.text,"a protected quotation never replaces the roadmap visual sharing its slide");
  assert.equal(shapeText(roadmap,"Editable quotation attribution"),"— Market Researcher · Research stakeholder");
  assert.equal([...roadmap.matchAll(/name="Editable timeline milestone \d+"/g)].length,4);
  assert.equal([...roadmap.matchAll(/<p:cxnSp>/g)].length,3,"roadmap dependencies remain independently editable native connectors");
  assert.match(architecture,/<a:srgbClr val="121715"\/>/,"the authored dark background survives layout-aware export");
  assert.match(parts.get("ppt/theme/theme1.xml"),/<a:latin typeface="Aptos Display"\/>/);
  assert.ok(![...parts.keys()].some((name)=>name.startsWith("ppt/charts/")||name.startsWith("ppt/media/")),"native editable shapes are not misrepresented as embedded chart or image packages");
});

test("a managed 23-slide presentation preserves every slide, citation, editable speaker-note part, and semantic visual",()=>{
  const modes=["scorecard","quote","matrix","architecture","roadmap","comparison"];
  const items=Array.from({length:23},(_,index)=>{
    const kind=modes[index%modes.length],data=kind==="quote"?[]:Array.from({length:kind==="scorecard"?6:4},(_,datum)=>({label:`Slide ${index+1} evidence ${datum+1}`,value:kind==="scorecard"?`${40+datum}.25`:`Approved outcome ${datum+1}`,weight:(datum+2)/8}));
    const quote=kind==="quote"?{text:`Stakeholder statement ${index+1}: every responsive artifact remains traceable, editable, reviewable, and reusable across devices.`,speaker:"Product Owner",role:"Executive sponsor"}:undefined;
    return{title:`Executive decision ${String(index+1).padStart(2,"0")}`,body:`Approved presentation narrative ${index+1}.`,notes:`Complete authorized presenter guidance ${index+1}.`,image_prompt:"",slide:{layout:kind,kicker:`Chapter ${index+1}`,bullets:[],...(quote?{quote}:{}),citations:[{sourceId:`PRIVATE_SOURCE_${index+1}`,label:"Executive customer research",anchor:`Authored slide ${index+1}`,excerpt:`Authorized decision ${index+1}`}],visual:{kind,label:`Evidence ${index+1}`,value:"",...(kind==="scorecard"?{exactValue:"61.125",displayValue:"61.13"}:{}),data}}};
  });
  const parts=verifyOfficeArchive(createPowerPointDocument(items,defaultSlidePresentation("field-notes"),{title:"Managed executive strategy",showFooterLabel:true,includePresenterNotes:true}));
  const slides=[...parts.keys()].filter((name)=>/^ppt\/slides\/slide\d+\.xml$/.test(name));
  const notes=[...parts.keys()].filter((name)=>/^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name));
  assert.equal(slides.length,23);
  assert.equal(notes.length,23);
  assert.match(parts.get("ppt/presentation.xml"),/<p:sldId id="278" r:id="rId25"\/>/);

  let shapeCount=0;
  for(let index=0;index<23;index+=1){
    const slide=parts.get(`ppt/slides/slide${index+1}.xml`),speakerNotes=parts.get(`ppt/notesSlides/notesSlide${index+1}.xml`),ids=[...slide.matchAll(/<p:cNvPr id="(\d+)"/g)].map(([,id])=>id);
    assert.equal(new Set(ids).size,ids.length,`slide ${index+1} has independently addressable unique editable shape identifiers`);
    assert.equal(shapeText(slide,"Editable slide title"),`Executive decision ${String(index+1).padStart(2,"0")}`);
    assert.equal(shapeText(slide,"Editable evidence citation 1"),"[1] Executive customer research");
    assert.doesNotMatch(shapeText(slide,"Editable evidence citation 1"),/Authored slide|Authorized decision/,"structural slide coordinates and private evidence never appear in audience attribution");
    assert.match(speakerNotes,new RegExp(`Complete authorized presenter guidance ${index+1}\\.`));
    assert.match(speakerNotes,/\[Sources\]/,`slide ${index+1} retains authorized sources in presenter notes`);
    assert.doesNotMatch(`${slide}${speakerNotes}`,/PRIVATE_SOURCE_/);
    shapeCount+=[...slide.matchAll(/<p:(?:sp|cxnSp)>/g)].length;
  }
  assert.ok(shapeCount>=350,`${shapeCount} independently editable PowerPoint shapes demonstrate layout-specific visual fidelity`);
});

test("Word and PowerPoint preserve an explicit Arabic language and right-to-left reading direction",()=>{
  const word=verifyOfficeArchive(createWordDocument("# عنوان واضح\n\nنص عربي معتمد",{title:"مستند المشروع",language:"ar-SA",direction:"rtl"}));
  assert.match(word.get("word/document.xml"),/<w:bidi\/>/);
  assert.match(word.get("word/document.xml"),/<w:rtl\/>/);
  assert.match(word.get("word/document.xml"),/<w:lang w:val="ar-SA" w:bidi="ar-SA"\/>/);
  const item={title:"قرار المشروع",body:"نص القرار المعتمد",notes:"ملاحظات المتحدث",image_prompt:"",slide:null};
  const deck=verifyOfficeArchive(createPowerPointDocument([item],defaultSlidePresentation(),{language:"ar-SA",direction:"rtl",includePresenterNotes:true}));
  assert.match(deck.get("ppt/slides/slide1.xml"),/<a:pPr rtl="1" algn="r"\/>/);
  assert.match(deck.get("ppt/slides/slide1.xml"),/lang="ar-SA"/);
  assert.match(deck.get("ppt/notesSlides/notesSlide1.xml"),/<a:pPr rtl="1" algn="r"\/>/);
});

test("authored brand typography remains consistent in editable PowerPoint shapes and the deck theme",()=>{
  const presentation={...defaultSlidePresentation("editorial"),fontFamily:"Helvetica Neue"};
  const item={title:"Protected brand typography",body:"The authored typeface remains consistent.",notes:"Brand direction: Helvetica Neue.",image_prompt:"",slide:null};
  const parts=verifyOfficeArchive(createPowerPointDocument([item],presentation));
  assert.match(parts.get("ppt/slides/slide1.xml"),/<a:latin typeface="Helvetica Neue"\/>/);
  assert.match(parts.get("ppt/theme/theme1.xml"),/<a:majorFont><a:latin typeface="Helvetica Neue"\/>/);
  assert.match(parts.get("ppt/theme/theme1.xml"),/<a:minorFont><a:latin typeface="Helvetica Neue"\/>/);

  const rejected=verifyOfficeArchive(createPowerPointDocument([item],{...presentation,fontFamily:'Helvetica";background:url(private)'}));
  assert.doesNotMatch(rejected.get("ppt/slides/slide1.xml"),/background:url|Helvetica&quot;/);
});

test("Japanese Office exports localize generated copy while preserving authored English evidence",()=>{
  const dictionary={
    "Slide":japaneseMessages["office.label.slide"],
    "Exact value":japaneseMessages["office.label.exactValue"],
    "Rounded display":japaneseMessages["office.label.roundedDisplay"],
    "Exact":japaneseMessages["office.label.exact"],
    "Authored source":japaneseMessages["office.label.authoredSource"],
    "Stakeholder quotation":japaneseMessages["office.label.stakeholderQuotation"],
    "Sources":japaneseMessages["office.label.sources"],
    "Page {number}":japaneseMessages["system.auto.11bl739.13"],
    "Forma master":japaneseMessages["office.metadata.master"],
    "Forma editable layout":japaneseMessages["office.metadata.layout"],
    "Slide image":japaneseMessages["office.metadata.slideImage"],
    "Editable speaker notes":japaneseMessages["office.metadata.speakerNotes"],
    "Editable slide title":japaneseMessages["office.shape.slideTitle"],
    "Editable score label":japaneseMessages["office.shape.scoreLabel"],
    "Editable evidence citation":japaneseMessages["office.shape.evidenceCitation"],
    "Authorized source citation and evidence excerpt":japaneseMessages["office.description.sourceEvidence"],
  };
  const translate=(source)=>dictionary[source]??source;
  const word=verifyOfficeArchive(createWordDocument("# Authored English title\n\n日本語の本文",{title:"Authored English title",language:"ja-JP",direction:"ltr",translate}));
  assert.match(word.get("word/document.xml"),/Authored English title|日本語の本文/);
  assert.match(word.get("word/document.xml"),/w:val="ja-JP"/);
  assert.match(word.get("word/styles.xml"),/w:eastAsia="Yu Gothic"/);

  const quotation="Preserve this approved English quote.";
  const item={title:"Approved English title",body:"Approved English body.",notes:"Approved English notes.",image_prompt:"",slide:{layout:"scorecard",kicker:"",section:"",quote:{text:quotation,speaker:"Dana",role:"Product Owner",citation:"source_1"},citations:[{sourceId:"blk_001",label:"Customer research",anchor:"Page 3",excerpt:"Approved English evidence."}],bullets:[],visual:{kind:"scorecard",label:"Authored English assessment",value:"",exactValue:"61.125",displayValue:"61.13",data:[{label:"Authored English dimension",value:"61.13",weight:.61}]}}};
  const parts=verifyOfficeArchive(createPowerPointDocument([item],defaultSlidePresentation(),{title:"Approved English deck",language:"ja-JP",direction:"ltr",translate,number:(value)=>new Intl.NumberFormat("ja-JP").format(value),includePresenterNotes:true}));
  assert.match(parts.get("docProps/app.xml"),/<PresentationFormat>16:9<\/PresentationFormat>/);
  assert.doesNotMatch(parts.get("docProps/app.xml"),/On-screen Show/);
  const slide=parts.get("ppt/slides/slide1.xml"),notes=parts.get("ppt/notesSlides/notesSlide1.xml");
  assert.match(slide,/<a:t>正確な値<\/a:t>/);
  assert.match(slide,/<a:t>丸めた表示<\/a:t>/);
  assert.match(notes,/作成者によるソース/);
  assert.match(slide,/スライド 1/);
  assert.match(slide,/name="編集可能なスライドのタイトル"/);
  assert.match(slide,/name="編集可能なスコアのラベル 1"/);
  assert.match(slide,/descr="許可された出典の引用と根拠の抜粋"/);
  assert.match(notes,/\[関係者の引用\]/);
  assert.match(notes,/\[出典\]/);
  assert.match(slide,/3ページ/);
  assert.match(notes,/3ページ/);
  assert.doesNotMatch(slide+notes,/Page 3/);
  assert.equal(item.slide.citations[0].anchor,"Page 3");
  assert.match(parts.get("ppt/theme/theme1.xml"),/<a:ea typeface="Yu Gothic"\/>/);
  assert.match(slide,/lang="ja-JP"/);
  assert.doesNotMatch(slide,/rtl="1"/);
  for(const authored of ["Approved English title","Approved English body.","Authored English dimension",quotation])assert.ok(slide.includes(authored),authored);
  assert.doesNotMatch(slide,/Approved English evidence\./,"localized audience slides never expose full provenance excerpts");
  for(const authored of ["Approved English notes.","Approved English evidence.",quotation,"Dana","Product Owner"])assert.ok(notes.includes(authored),authored);
  assert.doesNotMatch(slide+notes,/blk_001|source_1|>Exact value<|>Rounded display<|\[Stakeholder quotation\]|\[Sources\]/);
});

test("professional media archives preserve ordered original binary bytes",()=>{
  const first=Uint8Array.from([0,255,137,80,78,71]),second=Uint8Array.from([0,0,0,24,102,116,121,112]);
  const archive=createOfficeArchive([{name:"README.md",content:"Approved directions"},{name:"frames/frame-001.png",content:first},{name:"frames/frame-002.jpg",content:second}],{media:true});
  const parts=verifyOfficeArchive(archive,{binary:true});
  assert.deepEqual([...parts.keys()],["README.md","frames/frame-001.png","frames/frame-002.jpg"]);
  assert.deepEqual(parts.get("frames/frame-001.png"),first);
  assert.deepEqual(parts.get("frames/frame-002.jpg"),second);
});

test("office archives reject unsafe paths, missing slides, and oversized authored parts",()=>{
  assert.throws(()=>createOfficeArchive([{name:"../private.xml",content:"secret"}]),/invalid_office_archive_path/);
  for(const name of ["frames//private.png","frames/./private.png","frames/../private.png","frames/\u0000private.png"])
    assert.throws(()=>createOfficeArchive([{name,content:new Uint8Array([1])}],{media:true}),/invalid_office_archive_path/);
  assert.throws(()=>createOfficeArchive([{name:"same.xml",content:"first"},{name:"same.xml",content:"second"}]),/invalid_office_archive_path/);
  assert.throws(()=>createOfficeArchive([{name:"word/document.xml",content:"x".repeat(2_000_001)}]),/office_archive_entry_too_large/);
  assert.throws(()=>createOfficeArchive([{name:"frames/oversized.png",content:new Uint8Array(24_000_001)}],{media:true}),/office_archive_entry_too_large/);
  assert.throws(()=>createPowerPointDocument([],defaultSlidePresentation()),/invalid_presentation_slide_count/);
  const item={title:"Within the supported slide boundary",body:"",notes:"",image_prompt:"",slide:null};
  assert.throws(()=>createPowerPointDocument(Array.from({length:101},()=>item),defaultSlidePresentation()),/invalid_presentation_slide_count/);
});
