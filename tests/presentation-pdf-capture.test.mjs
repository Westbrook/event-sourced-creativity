import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { deflateSync } from "node:zlib";
import { presentationPdfSemanticStructure, renderPresentationPdf } from "../src/components/presentation-pdf-export.ts";
import { createPresentationPdfFromRenderedSlides } from "../src/model/presentation-pdf.ts";

class FixtureText {
  nodeType=3;
  constructor(text){this.textContent=text;}
}

class FixtureElement {
  nodeType=1;
  parentElement=null;
  childNodes=[];

  constructor(name,attributes={},children=[]){
    this.localName=name;
    this.tagName=name.toUpperCase();
    this.attributes=attributes;
    this.computed={display:attributes.display??"block",visibility:attributes.visibility??"visible",contentVisibility:attributes.contentVisibility??"visible"};
    for(const child of children){
      const node=typeof child==="string"?new FixtureText(child):child;
      if(node.nodeType===1)node.parentElement=this;
      this.childNodes.push(node);
    }
  }

  get children(){return this.childNodes.filter((child)=>child.nodeType===1);}
  get textContent(){return this.childNodes.map((child)=>child.textContent).join(" ");}
  get innerText(){
    return this.childNodes.filter((child)=>child.nodeType!==1||!child.hidden()).map((child)=>child.nodeType===1?child.innerText:child.textContent).join(" ").replace(/\s+/gu," ").trim();
  }

  hidden(){return Object.hasOwn(this.attributes,"hidden")||this.computed.display==="none"||this.computed.visibility==="hidden";}
  getAttribute(name){return Object.hasOwn(this.attributes,name)?String(this.attributes[name]):null;}
  contains(element){return this===element||this.children.some((child)=>child.contains(element));}

  matches(selectors){
    return selectors.split(",").some((entry)=>{
      const selector=entry.trim();
      if(selector.startsWith("."))return String(this.attributes.class??"").split(/\s+/u).includes(selector.slice(1));
      const attribute=/^\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]$/u.exec(selector);
      if(attribute)return Object.hasOwn(this.attributes,attribute[1])&&(attribute[2]===undefined||String(this.attributes[attribute[1]])===attribute[2]);
      return this.localName===selector;
    });
  }

  querySelectorAll(selectors){
    const result=[];
    for(const child of this.children){
      if(child.matches(selectors))result.push(child);
      result.push(...child.querySelectorAll(selectors));
    }
    return result;
  }

  querySelector(selectors){return this.querySelectorAll(selectors)[0]??null;}
}

const element=(name,attributes,...children)=>new FixtureElement(name,attributes,children.flat());
const previousComputedStyle=globalThis.getComputedStyle;
globalThis.getComputedStyle=(entry)=>entry.computed;
test.after(()=>{
  if(previousComputedStyle===undefined)delete globalThis.getComputedStyle;
  else globalThis.getComputedStyle=previousComputedStyle;
});

const collect=(nodes,role)=>nodes.flatMap((node)=>[...(node.role===role?[node]:[]),...collect(node.children??[],role)]);

test("captures slides within the requested locale scope while preserving authored content",async()=>{
  const originalDocument=globalThis.document;
  const stop=new Error("stop before pixel capture");
  let stage;
  globalThis.document={
    documentElement:{lang:"en",dir:"ltr"},
    fonts:{ready:Promise.resolve()},
    body:{append(node){stage=node;}},
    createElement(name){
      const node={localName:name,style:{},setAttribute(attribute,value){this[attribute]=String(value);},replaceChildren(child){this.child=child;child.parentElement=this;},remove(){this.removed=true;}};
      if(name==="forma-presentation-slide")Object.defineProperty(node,"updateComplete",{get(){return Promise.reject(stop);}});
      return node;
    },
  };
  try{
    await assert.rejects(renderPresentationPdf([{title:"Authored English title",body:"",notes:"",image_prompt:"",slide:null}],{},{language:"ja-JP",direction:"ltr"}),(error)=>error===stop);
    assert.equal(stage.localName,"forma-ui-locale");
    assert.equal(stage.lang,"ja-JP");
    assert.equal(stage.dir,"ltr");
    assert.equal(stage.child.parentElement,stage);
    assert.equal(stage.child.item.title,"Authored English title");
    assert.equal(globalThis.document.documentElement.lang,"en");
    assert.equal(stage.removed,true);
  }finally{
    if(originalDocument===undefined)delete globalThis.document;
    else globalThis.document=originalDocument;
  }
});

const sixScores=[
  ["Phone","39.75"],
  ["Tablet","53.00"],
  ["Small monitor","67.25"],
  ["Large monitor","68.50"],
  ["Adaptive/accessibility","58.75"],
  ["Governed creative loop","79.50"],
];
const stakeholderQuote="The differentiator is not that one brief can make five artifacts; it is that every artifact remains traceable, editable, reviewable, and reusable across devices.";

const executiveSlide=()=>element("article",{},
  element("header",{},element("span",{},"Executive assessment"),element("small",{},"01 / 12")),
  element("section",{},
    element("h3",{},"Complete responsive assessment"),
    element("p",{},"All six device and governance scores remain attributable."),
    element("ul",{},element("li",{},"Preserve every authored score"),element("li",{},"Protect exact and displayed precision")),
  ),
  element("aside",{},
    element("figure",{class:"presentation-visual-bars"},
      element("figcaption",{},"Equal-weight assessment scorecard"),
      ...sixScores.map(([label,value])=>element("div",{class:"presentation-slide__chart-row"},
        element("span",{class:"presentation-slide__chart-label"},label),
        element("i",{"aria-hidden":"true"},"Decorative bar"),
        element("data",{class:"presentation-slide__chart-value",value},value),
      )),
      element("dl",{},element("dt",{},"Exact"),element("dd",{},"61.125"),element("dt",{},"Displayed"),element("dd",{},"61.13")),
    ),
    element("figure",{class:"presentation-slide__quote-card"},
      element("blockquote",{},element("p",{class:"presentation-slide__quote-text"},stakeholderQuote)),
      element("figcaption",{class:"presentation-slide__quote-attribution"},element("cite",{},"Product Owner"),element("span",{},"Stakeholder")),
    ),
    element("table",{class:"presentation-slide__matrix"},
      element("caption",{},"Device and orientation comparison"),
      element("thead",{},element("tr",{},element("th",{},"Device"),element("th",{},"Orientation"))),
      element("tbody",{},element("tr",{},element("th",{},"Phone"),element("td",{},"Portrait")),element("tr",{},element("th",{},"Tablet"),element("td",{},"Landscape"))),
    ),
  ),
  element("section",{class:"presentation-slide__footnotes"},element("h4",{},"Evidence"),element("ol",{},
    element("li",{class:"presentation-slide__citation"},element("a",{},"Assessment source"),element("span",{},"Executive responsive strategy")),
  )),
  element("section",{"data-speaker-notes":""},"PRIVATE PRESENTER NOTE MUST NEVER LEAK"),
  element("span",{hidden:""},"HIDDEN FACT MUST NEVER LEAK"),
  element("footer",{},element("span",{},"Responsive product strategy")),
);

test("captures all six chart values and exact-versus-displayed precision in tagged reading order",()=>{
  const structure=presentationPdfSemanticStructure(executiveSlide(),"Fallback title");
  assert.deepEqual(structure[0],{role:"H1",text:"Complete responsive assessment"});

  const figures=collect(structure,"Figure");
  const chart=figures.find((figure)=>collect([figure],"Caption").some((caption)=>caption.text==="Equal-weight assessment scorecard"));
  assert.ok(chart,"the scorecard remains a genuine accessible figure");
  const tables=collect([chart],"Table");
  const scores=collect([tables[0]],"TR").map((row)=>row.children.map((cell)=>cell.text));
  assert.deepEqual(scores,sixScores,"no sixth score or trailing precision may disappear");
  assert.deepEqual(collect([tables[1]],"TR").map((row)=>row.children.map((cell)=>cell.text)),[
    ["Exact","61.125"],
    ["Displayed","61.13"],
  ],"exact and displayed averages retain their authored meanings");

  const text=JSON.stringify(structure);
  assert.ok(text.indexOf("Preserve every authored score")<text.indexOf("Equal-weight assessment scorecard"));
  assert.doesNotMatch(text,/PRIVATE PRESENTER NOTE|HIDDEN FACT|Decorative bar/);
});

test("preserves complete attributed quotations, comparison headers, and attributable citation notes",()=>{
  const structure=presentationPdfSemanticStructure(executiveSlide());
  const quotation=collect(structure,"BlockQuote");
  assert.deepEqual(quotation,[{role:"BlockQuote",text:stakeholderQuote}],"the quotation is never split or silently truncated");
  assert.ok(collect(structure,"Caption").some((entry)=>entry.text==="Product Owner Stakeholder"));

  const comparison=collect(structure,"Table").find((table)=>collect([table],"Caption").some((caption)=>caption.text==="Device and orientation comparison"));
  assert.ok(comparison);
  assert.deepEqual(collect([comparison],"TH").map((entry)=>entry.text),["Device","Orientation","Phone","Tablet"]);
  assert.deepEqual(collect([comparison],"TD").map((entry)=>entry.text),["Portrait","Landscape"]);
  assert.deepEqual(collect(structure,"Note"),[{role:"Note",text:"Assessment source Executive responsive strategy"}]);
});

test("keeps captured semantic labels searchable in the resulting tagged browser-slide PDF",(context)=>{
  const structure=presentationPdfSemanticStructure(executiveSlide());
  const result=createPresentationPdfFromRenderedSlides([{
    width:1,
    height:1,
    bytes:deflateSync(Uint8Array.from([18,23,21])),
    heading:"Complete responsive assessment",
    structure,
  }]);
  const source=Buffer.from(result.bytes).toString("latin1");

  assert.match(source,/\/StructTreeRoot \d+ 0 R/);
  assert.match(source,/\/S \/Figure/);
  assert.match(source,/\/S \/Table/);
  assert.match(source,/\/S \/BlockQuote/);
  assert.match(source,/\/S \/Caption/);
  assert.match(source,/\/S \/TH/);
  assert.match(source,/\/S \/TD/);
  assert.match(source,/\/S \/Note/);

  const inspection=spawnSync("pdfinfo",["-struct-text","-"],{input:Buffer.from(result.bytes),encoding:"utf8"});
  if(inspection.error?.code==="ENOENT"){context.skip("Poppler pdfinfo is unavailable in this environment.");return;}
  assert.equal(inspection.status,0,inspection.stderr);
  for(const [label,value] of sixScores){
    assert.match(inspection.stdout,new RegExp(`"${label.replace(/[.*+?^${}()|[\]\\]/gu,"\\$&")}"`));
    assert.match(inspection.stdout,new RegExp(`"${value.replace(".","\\.")}"`));
  }
  assert.match(inspection.stdout,/"Exact"[\s\S]*"61\.125"[\s\S]*"Displayed"[\s\S]*"61\.13"/);
  assert.match(inspection.stdout,/BlockQuote[^\n]*\n\s*"The differentiator is not that one brief can make five artifacts; it is that every artifact remains traceable, editable, reviewable, and reusable across devices\."/);
  assert.match(inspection.stdout,/Caption[^\n]*\n\s*"Product Owner Stakeholder"/);
  assert.match(inspection.stdout,/Note[^\n]*\n\s*"Assessment source Executive responsive strategy"/);
});

test("ignores invisible headings and keeps a deliberate fallback title",()=>{
  const root=element("article",{},
    element("h2",{display:"none"},"An invisible title"),
    element("p",{},"Visible slide material"),
    element("blockquote",{"aria-hidden":"true"},"Decorative hidden quotation"),
  );
  const structure=presentationPdfSemanticStructure(root,"Deliberate presentation title");

  assert.deepEqual(structure,[{role:"H1",text:"Deliberate presentation title"},{role:"P",text:"Visible slide material"}]);
});
