import {
  createPresentationPdfFromRenderedSlides,
  PRESENTATION_PDF_PAGE_HEIGHT,
  PRESENTATION_PDF_PAGE_WIDTH,
  type PresentationPdfOptions,
  type PresentationPdfRenderedPage,
  type PresentationPdfResult,
  type PresentationPdfSemanticNode,
} from "../model/presentation-pdf.ts";
import type { DocumentArtifactDraftItem, SlidePresentation } from "../model/document-artifacts";
import type { PresentationSlide } from "./presentation-slide";

const SVG_NAMESPACE="http://www.w3.org/2000/svg";
const HTML_NAMESPACE="http://www.w3.org/1999/xhtml";
const EXPORT_SCALE=2;
const fontStylesheetCache=new Map<string,Promise<string>>();
const fontResourceCache=new Map<string,Promise<string>>();
const PRESENTATION_PDF_HIDDEN_SELECTOR="script,style,template,[hidden],[inert],[aria-hidden=\"true\"],[data-speaker-notes],[data-presentation-speaker-notes],.presentation-speaker-notes,.presentation-slide-speaker-notes";
const PRESENTATION_PDF_HEADING_SELECTOR="h1,h2,h3,h4,h5,h6";
const PRESENTATION_PDF_CHART_ROW_SELECTOR=".presentation-slide__chart-row,[data-presentation-chart-row]";

const semanticText=(element:Element)=>String((element as HTMLElement).innerText??element.textContent??"").replace(/\s+/gu," ").trim();

const semanticElementVisible=(element:Element)=>{
  if(element.matches(PRESENTATION_PDF_HIDDEN_SELECTOR))return false;
  const style=getComputedStyle(element);
  return style.display!=="none"&&style.visibility!=="hidden"&&style.visibility!=="collapse"&&style.contentVisibility!=="hidden";
};

const visibleWithin=(element:Element,root:Element)=>{
  for(let current:Element|null=element;current;current=current.parentElement){
    if(!semanticElementVisible(current))return false;
    if(current===root)return true;
  }
  return false;
};

const semanticLeaf=(role:PresentationPdfSemanticNode["role"],element:Element):PresentationPdfSemanticNode[]=>{
  const text=semanticText(element);
  return text?[{role,text}]:[];
};

const semanticCells=(row:Element):PresentationPdfSemanticNode[]=>Array.from(row.children)
  .filter((cell)=>semanticElementVisible(cell)&&cell.matches("th,td"))
  .flatMap((cell)=>semanticLeaf(cell.matches("th")?"TH":"TD",cell));

const semanticTable=(table:Element):PresentationPdfSemanticNode[]=>{
  const children:PresentationPdfSemanticNode[]=[];
  for(const child of Array.from(table.children)){
    if(!semanticElementVisible(child))continue;
    if(child.matches("caption")){children.push(...semanticLeaf("Caption",child));continue;}
    if(child.matches("thead,tbody,tfoot")){
      const rows=Array.from(child.children)
        .filter((row)=>semanticElementVisible(row)&&row.matches("tr"))
        .map((row)=>({role:"TR" as const,children:semanticCells(row)}))
        .filter((row)=>row.children.length);
      if(rows.length)children.push({role:child.matches("thead")?"THead":"TBody",children:rows});
      continue;
    }
    if(child.matches("tr")){
      const cells=semanticCells(child);
      if(cells.length)children.push({role:"TR",children:cells});
    }
  }
  return children.length?[{role:"Table",children}]:semanticLeaf("P",table);
};

const semanticDefinitions=(list:Element):PresentationPdfSemanticNode[]=>{
  const rows:PresentationPdfSemanticNode[]=[];
  let term="";
  for(const child of Array.from(list.children)){
    if(!semanticElementVisible(child))continue;
    if(child.matches("dt")){term=semanticText(child);continue;}
    if(!child.matches("dd"))continue;
    const value=semanticText(child);
    if(!term&&!value)continue;
    rows.push({role:"TR",children:[...(term?[{role:"TH" as const,text:term}]:[]),...(value?[{role:"TD" as const,text:value}]:[])]});
  }
  return rows.length?[{role:"Table",children:[{role:"TBody",children:rows}]}]:semanticLeaf("P",list);
};

const semanticChartRows=(figure:Element):Element[]=>{
  const explicit=Array.from(figure.querySelectorAll(PRESENTATION_PDF_CHART_ROW_SELECTOR)).filter(semanticElementVisible);
  if(explicit.length)return explicit;
  if(!figure.matches(".presentation-visual-bars,.presentation-slide__scorecard,[data-presentation-chart]"))return[];
  return Array.from(figure.children).filter((child)=>semanticElementVisible(child)&&child.matches("div,li")&&!child.matches("figcaption,dl"));
};

const semanticChartTable=(rows:Element[]):PresentationPdfSemanticNode|null=>{
  const records=rows.map((row)=>{
    const label=row.querySelector<HTMLElement>(".presentation-slide__chart-label,[data-presentation-chart-label],span,th");
    const value=row.querySelector<HTMLElement>(".presentation-slide__chart-value,[data-presentation-chart-value],data,small,td");
    const labelText=label&&semanticElementVisible(label)?semanticText(label):"";
    const valueText=value&&semanticElementVisible(value)?semanticText(value):"";
    const children:PresentationPdfSemanticNode[]=[];
    if(labelText)children.push({role:"TH",text:labelText});
    if(valueText)children.push({role:"TD",text:valueText});
    if(!children.length){
      const fallback=semanticText(row);
      if(fallback)children.push({role:"TD",text:fallback});
    }
    return{role:"TR" as const,children};
  }).filter((row)=>row.children.length);
  return records.length?{role:"Table",children:[{role:"TBody",children:records}]}:null;
};

type PresentationPdfExtractionState={heading:Element|null};

const semanticList=(list:Element,state:PresentationPdfExtractionState):PresentationPdfSemanticNode[]=>{
  const items:PresentationPdfSemanticNode[]=[];
  for(const item of Array.from(list.children)){
    if(!semanticElementVisible(item)||!item.matches("li"))continue;
    if(item.matches(".presentation-slide__citation,[data-presentation-citation]")){
      const citation=semanticLeaf("Note",item);
      if(citation.length)items.push({role:"LI",children:citation});
      continue;
    }
    const nested=Array.from(item.children).filter((child)=>semanticElementVisible(child)&&child.matches("ul,ol,table,dl,figure,blockquote"));
    if(!nested.length){
      const body=semanticLeaf("LBody",item);
      if(body.length)items.push({role:"LI",children:body});
      continue;
    }
    const children:PresentationPdfSemanticNode[]=[];
    for(const child of Array.from(item.children)){
      if(!semanticElementVisible(child))continue;
      if(nested.includes(child))children.push(...semanticElement(child,state));
      else children.push(...semanticLeaf("LBody",child));
    }
    if(children.length)items.push({role:"LI",children});
  }
  return items.length?[{role:"L",children:items}]:semanticLeaf("P",list);
};

const semanticFigure=(figure:Element,state:PresentationPdfExtractionState):PresentationPdfSemanticNode[]=>{
  const rows=semanticChartRows(figure);
  const children:PresentationPdfSemanticNode[]=[];
  let chartEmitted=false;
  for(const child of Array.from(figure.children)){
    if(!semanticElementVisible(child))continue;
    const containsChart=rows.includes(child)||rows.some((row)=>child.contains(row));
    if(containsChart){
      if(!chartEmitted){
        const chart=semanticChartTable(rows);
        if(chart)children.push(chart);
        chartEmitted=true;
      }
      continue;
    }
    children.push(...semanticElement(child,state));
  }
  if(rows.length&&!chartEmitted){
    const chart=semanticChartTable(rows);
    if(chart)children.push(chart);
  }
  if(!children.length){
    const text=semanticText(figure);
    if(text)children.push({role:"P",text});
  }
  return children.length?[{role:"Figure",children}]:[];
};

const semanticElement=(element:Element,state:PresentationPdfExtractionState):PresentationPdfSemanticNode[]=>{
  if(!semanticElementVisible(element))return[];
  if(element===state.heading)return[];
  if(element.matches(PRESENTATION_PDF_HEADING_SELECTOR))return semanticLeaf("H2",element);
  if(element.matches("blockquote"))return semanticLeaf("BlockQuote",element);
  if(element.matches("figcaption,caption"))return semanticLeaf("Caption",element);
  if(element.matches("table"))return semanticTable(element);
  if(element.matches("dl"))return semanticDefinitions(element);
  if(element.matches("ul,ol"))return semanticList(element,state);
  if(element.matches("figure,.presentation-visual-bars,.presentation-slide__scorecard,[data-presentation-chart]"))return semanticFigure(element,state);
  if(element.matches(".presentation-slide__citation,[data-presentation-citation]"))return semanticLeaf("Note",element);
  if(element.matches("p,span,strong,small,cite,data,a,th,td,dt,dd"))return semanticLeaf("P",element);
  if(element.matches("img")){
    const alternative=element.getAttribute("alt")?.trim();
    return alternative?[{role:"Figure",children:[{role:"Caption",text:alternative}]}]:[];
  }
  const children:PresentationPdfSemanticNode[]=[];
  for(const child of Array.from(element.childNodes)){
    if(child.nodeType===1)children.push(...semanticElement(child as Element,state));
    else if(child.nodeType===3){
      const text=String(child.textContent??"").replace(/\s+/gu," ").trim();
      if(text)children.push({role:"P",text});
    }
  }
  return children;
};

/** Derive tagged-PDF reading order from the visible, authorized slide DOM. */
export function presentationPdfSemanticStructure(root:HTMLElement,fallbackHeading="Slide"):PresentationPdfSemanticNode[]{
  const heading=Array.from(root.querySelectorAll<HTMLElement>(PRESENTATION_PDF_HEADING_SELECTOR)).find((candidate)=>visibleWithin(candidate,root))??null;
  const title=heading?semanticText(heading):fallbackHeading.trim();
  const state:PresentationPdfExtractionState={heading};
  return[...(title?[{role:"H1" as const,text:title}]:[]),...semanticElement(root,state)];
}

const styleRules=(sheet:CSSStyleSheet,seen:Set<CSSStyleSheet>,imports:Set<string>):string[]=>{
  if(seen.has(sheet))return[];
  seen.add(sheet);
  try{
    return Array.from(sheet.cssRules).flatMap((rule)=>{
      if(rule.type===CSSRule.IMPORT_RULE){
        const imported=rule as CSSImportRule;
        try{
          if(imported.styleSheet){
            // Accessing cssRules itself is what raises for cross-origin imports.
            void imported.styleSheet.cssRules.length;
            return styleRules(imported.styleSheet,seen,imports);
          }
        }catch{
          imports.add(imported.href);
        }
        return[];
      }
      return[rule.cssText];
    });
  }catch{
    // Cross-origin stylesheets are not readable; inherited computed variables
    // and available document fonts still remain part of the capture.
    return[];
  }
};

const normalizedDescriptor=(value:string)=>value.trim().replace(/^['"]|['"]$/g,"").replace(/\s+/g,"").toLocaleLowerCase();

const inlineLoadedFonts=async(imports:Set<string>)=>{
  const loaded=Array.from(document.fonts).filter((face)=>face.status==="loaded");
  if(!loaded.length||!imports.size)return"";
  const faces:string[]=[];

  await Promise.all(Array.from(imports).map(async(href)=>{
    try{
      if(!fontStylesheetCache.has(href))fontStylesheetCache.set(href,fetch(href,{credentials:"omit"}).then(async(response)=>{
        if(!response.ok)throw new Error(`The slide font stylesheet could not be read (${response.status}).`);
        return response.text();
      }));
      const sheet=new CSSStyleSheet();
      sheet.replaceSync(await fontStylesheetCache.get(href)!);

      await Promise.all(Array.from(sheet.cssRules).map(async(rule)=>{
        if(rule.type!==CSSRule.FONT_FACE_RULE)return;
        const font=rule as CSSFontFaceRule;
        const family=normalizedDescriptor(font.style.getPropertyValue("font-family"));
        const weight=normalizedDescriptor(font.style.getPropertyValue("font-weight")||"normal");
        const style=normalizedDescriptor(font.style.getPropertyValue("font-style")||"normal");
        const range=normalizedDescriptor(font.style.getPropertyValue("unicode-range")||"U+0-10FFFF");
        const matching=loaded.some((face)=>normalizedDescriptor(face.family)===family&&normalizedDescriptor(face.weight)===weight&&normalizedDescriptor(face.style)===style&&normalizedDescriptor(face.unicodeRange)===range);
        if(!matching)return;

        const source=font.style.getPropertyValue("src");
        const match=/url\((?:"([^"]+)"|'([^']+)'|([^)]*))\)/i.exec(source);
        const location=match?.[1]??match?.[2]??match?.[3];
        if(!match||!location)return;
        const resource=new URL(location,href).href;
        if(!fontResourceCache.has(resource))fontResourceCache.set(resource,fetch(resource,{credentials:"omit"}).then(async(result)=>{
          if(!result.ok)throw new Error(`The slide font could not be embedded (${result.status}).`);
          return dataUrl(await result.blob());
        }));
        const embedded=await fontResourceCache.get(resource)!;
        faces.push(font.cssText.replace(match[0],`url("${embedded}")`));
      }));
    }catch(error){
      console.warn("A slide font could not be embedded; the browser's available fallback will be used.",error);
    }
  }));

  return faces.join("\n");
};

const documentStyles=async()=>{
  const imports=new Set<string>();
  const seen=new Set<CSSStyleSheet>();
  const rules=Array.from(document.styleSheets).flatMap((sheet)=>styleRules(sheet,seen,imports)).join("\n");
  return`${await inlineLoadedFonts(imports)}\n${rules}`;
};

const waitForImages=async(root:HTMLElement)=>{
  await Promise.all(Array.from(root.querySelectorAll("img")).map(async(image)=>{
    if(image.complete&&image.naturalWidth===0)return;
    try{await image.decode();}catch{/* Preserve the same broken-image state visible in the application. */}
  }));
};

const dataUrl=async(blob:Blob)=>await new Promise<string>((resolve,reject)=>{
  const reader=new FileReader();
  reader.onload=()=>resolve(String(reader.result));
  reader.onerror=()=>reject(reader.error??new Error("The slide image could not be read."));
  reader.readAsDataURL(blob);
});

const inlineImages=async(original:HTMLElement,clone:HTMLElement)=>{
  const source=Array.from(original.querySelectorAll("img"));
  const copies=Array.from(clone.querySelectorAll("img"));
  await Promise.all(source.map(async(image,index)=>{
    const copied=copies[index],url=image.currentSrc||image.src;
    if(!copied||!url||url.startsWith("data:"))return;
    const response=await fetch(url,{credentials:"same-origin"});
    if(!response.ok)throw new Error(`The slide image could not be prepared (${response.status}).`);
    copied.removeAttribute("srcset");
    copied.src=await dataUrl(await response.blob());
  }));
};

const rootVariables=(target:HTMLElement)=>{
  const computed=getComputedStyle(document.documentElement);
  for(let index=0;index<computed.length;index+=1){
    const property=computed.item(index);
    if(property.startsWith("--"))target.style.setProperty(property,computed.getPropertyValue(property));
  }
};

const svgImage=async(host:PresentationSlide,css:string)=>{
  const svg=document.createElementNS(SVG_NAMESPACE,"svg");
  svg.setAttribute("xmlns",SVG_NAMESPACE);
  svg.setAttribute("width",String(PRESENTATION_PDF_PAGE_WIDTH));
  svg.setAttribute("height",String(PRESENTATION_PDF_PAGE_HEIGHT));
  svg.setAttribute("viewBox",`0 0 ${PRESENTATION_PDF_PAGE_WIDTH} ${PRESENTATION_PDF_PAGE_HEIGHT}`);

  const foreignObject=document.createElementNS(SVG_NAMESPACE,"foreignObject");
  foreignObject.setAttribute("width","100%");
  foreignObject.setAttribute("height","100%");

  const wrapper=document.createElementNS(HTML_NAMESPACE,"div");
  wrapper.setAttribute("xmlns",HTML_NAMESPACE);
  wrapper.setAttribute("lang",host.closest("forma-ui-locale")?.getAttribute("lang")||document.documentElement.lang||"en");
  wrapper.style.width=`${PRESENTATION_PDF_PAGE_WIDTH}px`;
  wrapper.style.height=`${PRESENTATION_PDF_PAGE_HEIGHT}px`;
  wrapper.style.overflow="hidden";
  const inherited=getComputedStyle(host);
  wrapper.setAttribute("dir",inherited.direction||document.documentElement.dir||"ltr");
  wrapper.style.direction=inherited.direction;
  wrapper.style.font=inherited.font;
  wrapper.style.fontFamily=inherited.fontFamily;
  const lineHeight=Number.parseFloat(inherited.lineHeight)/Number.parseFloat(inherited.fontSize);
  if(Number.isFinite(lineHeight))wrapper.style.lineHeight=String(lineHeight);
  rootVariables(wrapper);

  const style=document.createElementNS(HTML_NAMESPACE,"style");
  style.textContent=css;
  wrapper.append(style);

  const clone=host.cloneNode(true) as HTMLElement;
  const originalSlide=host.querySelector<HTMLElement>(".presentation-slide");
  const copiedSlide=clone.querySelector<HTMLElement>(".presentation-slide");
  if(originalSlide&&copiedSlide){
    const computed=getComputedStyle(originalSlide);
    // Container-query units used on a container itself resolve against its
    // surrounding viewport. Preserve those resolved values inside the SVG.
    for(const property of ["padding-top","padding-right","padding-bottom","padding-left","row-gap","column-gap"]){
      copiedSlide.style.setProperty(property,computed.getPropertyValue(property));
    }
  }
  await inlineImages(host,clone);
  wrapper.append(clone);
  foreignObject.append(wrapper);
  svg.append(foreignObject);

  const serialized=new XMLSerializer().serializeToString(svg);
  const image=new Image();
  image.decoding="async";
  // SVG foreignObject images loaded through blob: URLs taint Chromium canvases;
  // a self-contained data URL keeps every captured pixel origin-clean.
  image.src=`data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`;
  await image.decode();
  return image;
};

const compressedRgb=async(canvas:HTMLCanvasElement)=>{
  const context=canvas.getContext("2d");
  if(!context)throw new Error("The slide capture surface is unavailable.");
  const rgba=context.getImageData(0,0,canvas.width,canvas.height).data;
  const rgb=new Uint8Array(canvas.width*canvas.height*3);
  for(let source=0,target=0;source<rgba.length;source+=4,target+=3){
    rgb[target]=rgba[source]!;
    rgb[target+1]=rgba[source+1]!;
    rgb[target+2]=rgba[source+2]!;
  }
  const stream=new Blob([rgb]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

const nextFrame=()=>new Promise<void>((resolve)=>requestAnimationFrame(()=>resolve()));

export async function renderPresentationPdf(items:DocumentArtifactDraftItem[],presentation:SlidePresentation,options:PresentationPdfOptions={}):Promise<PresentationPdfResult>{
  if(!items.length)throw new TypeError("At least one presentation slide is required.");
  if(typeof CompressionStream==="undefined")throw new Error("This browser does not support lossless slide capture.");

  const stage=document.createElement("forma-ui-locale");
  stage.lang=options.language||document.documentElement.lang||"en";
  stage.dir=options.direction||document.documentElement.dir||"ltr";
  stage.setAttribute("aria-hidden","true");
  stage.style.cssText=`position:fixed;left:-${PRESENTATION_PDF_PAGE_WIDTH*4}px;top:0;width:${PRESENTATION_PDF_PAGE_WIDTH}px;height:${PRESENTATION_PDF_PAGE_HEIGHT}px;overflow:hidden;pointer-events:none;z-index:-1;`;
  document.body.append(stage);

  try{
    await document.fonts.ready;
    let css="",fontSignature="";
    const pages:PresentationPdfRenderedPage[]=[];

    for(let index=0;index<items.length;index+=1){
      const host=document.createElement("forma-presentation-slide") as PresentationSlide;
      host.style.cssText=`display:block;width:${PRESENTATION_PDF_PAGE_WIDTH}px;height:${PRESENTATION_PDF_PAGE_HEIGHT}px;`;
      host.item=items[index]!;
      host.presentation=presentation;
      host.index=index;
      host.total=items.length;
      host.compact=false;
      host.showFooterLabel=options.showFooterLabel!==false;
      stage.replaceChildren(host);

      await host.updateComplete;
      await waitForImages(host);
      await nextFrame();
      await document.fonts.ready;
      const loadedFonts=Array.from(document.fonts).filter((face)=>face.status==="loaded").map((face)=>`${face.family}:${face.style}:${face.weight}:${face.unicodeRange}`).join("|");
      if(!css||loadedFonts!==fontSignature){
        css=await documentStyles();
        fontSignature=loadedFonts;
      }

      const canvas=document.createElement("canvas");
      canvas.width=PRESENTATION_PDF_PAGE_WIDTH*EXPORT_SCALE;
      canvas.height=PRESENTATION_PDF_PAGE_HEIGHT*EXPORT_SCALE;
      const context=canvas.getContext("2d");
      if(!context)throw new Error("The slide capture surface is unavailable.");
      const image=await svgImage(host,css);
      context.drawImage(image,0,0,canvas.width,canvas.height);

      pages.push({
        width:canvas.width,
        height:canvas.height,
        bytes:await compressedRgb(canvas),
        text:host.innerText,
        heading:host.querySelector<HTMLElement>("h1,h2,h3,h4,h5,h6")?.innerText||items[index]!.title,
        bullets:Array.from(host.querySelectorAll<HTMLElement>("section > ul > li,section > ol > li")).map((item)=>item.innerText.trim()).filter(Boolean),
        structure:presentationPdfSemanticStructure(host,items[index]!.title),
        language:options.language||document.documentElement.lang||"en",
        direction:options.direction||(getComputedStyle(host).direction==="rtl"?"rtl":"ltr"),
      });
    }

    return createPresentationPdfFromRenderedSlides(pages,{...options,language:options.language||document.documentElement.lang||"en"});
  }finally{
    stage.remove();
  }
}
