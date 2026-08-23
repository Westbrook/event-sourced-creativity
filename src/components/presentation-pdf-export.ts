import {
  createPresentationPdfFromRenderedSlides,
  PRESENTATION_PDF_PAGE_HEIGHT,
  PRESENTATION_PDF_PAGE_WIDTH,
  type PresentationPdfOptions,
  type PresentationPdfRenderedPage,
  type PresentationPdfResult,
} from "../model/presentation-pdf";
import type { DocumentArtifactDraftItem, SlidePresentation } from "../model/document-artifacts";
import type { PresentationSlide } from "./presentation-slide";

const SVG_NAMESPACE="http://www.w3.org/2000/svg";
const HTML_NAMESPACE="http://www.w3.org/1999/xhtml";
const EXPORT_SCALE=2;
const fontStylesheetCache=new Map<string,Promise<string>>();
const fontResourceCache=new Map<string,Promise<string>>();

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
  wrapper.setAttribute("lang",document.documentElement.lang||"en");
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

  const stage=document.createElement("div");
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
        language:options.language||document.documentElement.lang||"en",
        direction:options.direction||(getComputedStyle(host).direction==="rtl"?"rtl":"ltr"),
      });
    }

    return createPresentationPdfFromRenderedSlides(pages,{...options,language:options.language||document.documentElement.lang||"en"});
  }finally{
    stage.remove();
  }
}
