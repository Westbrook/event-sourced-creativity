import { applySlideStylePreset, defaultSlidePresentation, normalizeSlideDeckItems, normalizeSlidePresentation, normalizeSlideVisual, slideVisualIsComplete, type DocumentArtifactDraftItem, type SlidePresentation, type SlideVisualData } from "./document-artifacts.ts";

export const PRESENTATION_PDF_PAGE_WIDTH=960;
export const PRESENTATION_PDF_PAGE_HEIGHT=540;
const PAGE_WIDTH=PRESENTATION_PDF_PAGE_WIDTH;
const PAGE_HEIGHT=PRESENTATION_PDF_PAGE_HEIGHT;
const TEXT_LEFT=54;
const TEXT_WIDTH=500;
const VISUAL_LEFT=604;
const VISUAL_WIDTH=302;

export type PresentationPdfOptions={title?:string;showFooterLabel?:boolean};
export type PresentationPdfResult={bytes:Uint8Array;filename:string;pageCount:number};
export type PresentationPdfRenderedPage={width:number;height:number;bytes:Uint8Array;text?:string};

const replacements:Record<string,string>={"\u2018":"'","\u2019":"'","\u201a":",","\u201c":"\"","\u201d":"\"","\u2013":"-","\u2014":"-","\u2026":"...","\u2022":"-","\u00b7":"-","\u00a0":" ","\u00ae":"(R)","\u00a9":"(C)","\u2122":"TM"};
const ascii=(value:unknown)=>String(value??"").normalize("NFKD").replace(/[\u2018\u2019\u201a\u201c\u201d\u2013\u2014\u2026\u2022\u00b7\u00a0\u00ae\u00a9\u2122]/g,(character)=>replacements[character]??"").replace(/[\u0300-\u036f]/g,"").replace(/[^\x20-\x7e\n]/g,"").replace(/[ \t]+/g," ").trim();
const literal=(value:unknown)=>ascii(value).replaceAll("\\","\\\\").replaceAll("(","\\(").replaceAll(")","\\)");
const number=(value:number)=>Number(value.toFixed(3)).toString();
const byteLength=(value:string)=>new TextEncoder().encode(value).byteLength;
const encode=(value:string)=>new TextEncoder().encode(value);
const combine=(parts:readonly Uint8Array[])=>{const result=new Uint8Array(parts.reduce((total,part)=>total+part.byteLength,0));let offset=0;for(const part of parts){result.set(part,offset);offset+=part.byteLength;}return result;};
const utf16=(value:string)=>`FEFF${Array.from({length:value.length},(_,index)=>value.charCodeAt(index).toString(16).padStart(4,"0")).join("").toUpperCase()}`;
const hex=(value:string)=>/^#[0-9a-f]{6}$/i.test(value)?value:"#000000";
const rgb=(value:string)=>{const color=hex(value);return[1,3,5].map((index)=>Number.parseInt(color.slice(index,index+2),16)/255) as [number,number,number];};
const mix=(left:string,right:string,weight:number)=>{const a=rgb(left),b=rgb(right),ratio=Math.max(0,Math.min(1,weight));return`#${a.map((channel,index)=>Math.round((channel*(1-ratio)+(b[index]??0)*ratio)*255).toString(16).padStart(2,"0")).join("")}`;};
const fill=(color:string)=>`${rgb(color).map(number).join(" ")} rg`;
const stroke=(color:string)=>`${rgb(color).map(number).join(" ")} RG`;
const rect=(x:number,y:number,width:number,height:number,color:string)=>`${fill(color)}\n${number(x)} ${number(y)} ${number(width)} ${number(height)} re f`;
const line=(x1:number,y1:number,x2:number,y2:number,color:string,width=1)=>`${stroke(color)}\n${number(width)} w\n${number(x1)} ${number(y1)} m ${number(x2)} ${number(y2)} l S`;

const wrap=(value:unknown,maxCharacters:number,maxLines:number)=>{
  const words=ascii(value).replaceAll("\n"," \n ").split(/\s+/).filter(Boolean),lines:string[]=[];let current="";
  const commit=()=>{if(current){lines.push(current);current="";}};
  for(const word of words){if(lines.length>=maxLines)break;if(word==="\n"){commit();continue;}const pieces=word.length>maxCharacters?word.match(new RegExp(`.{1,${maxCharacters}}`,"g"))??[word]:[word];for(const piece of pieces){const candidate=current?`${current} ${piece}`:piece;if(candidate.length>maxCharacters){commit();if(lines.length>=maxLines)break;current=piece;}else current=candidate;}}
  if(lines.length<maxLines)commit();if(lines.length===maxLines&&words.length&&lines[maxLines-1]){const last=lines[maxLines-1]!;if(ascii(value).length>lines.join(" ").length)lines[maxLines-1]=`${last.slice(0,Math.max(0,maxCharacters-3)).trimEnd()}...`;}
  return lines;
};

const text=(value:unknown,x:number,y:number,size:number,color:string,options:{bold?:boolean;maxWidth?:number;maxLines?:number;leading?:number}={})=>{
  const maxWidth=options.maxWidth??500,maxLines=options.maxLines??1,characters=Math.max(4,Math.floor(maxWidth/(size*.53))),lines=wrap(value,characters,maxLines);if(!lines.length)return"";const leading=options.leading??size*1.17;
  return`BT\n/${options.bold?"F2":"F1"} ${number(size)} Tf\n${fill(color)}\n1 0 0 1 ${number(x)} ${number(y)} Tm\n${lines.map((entry,index)=>`${index?`0 -${number(leading)} Td\n`:""}(${literal(entry)}) Tj`).join("\n")}\nET`;
};

const visual=(slide:SlideVisualData,presentation:SlidePresentation)=>{
  const palette=presentation.palette,visual=slide.visual,ops:string[]=[rect(VISUAL_LEFT,68,VISUAL_WIDTH,392,palette.surface)];
  if(!slideVisualIsComplete(slide))return ops.join("\n");
  if(visual.kind==="hero-type"||visual.kind==="metric"){
    ops.push(text(visual.value,VISUAL_LEFT+26,330,visual.value.length>38?30:visual.value.length>20?40:56,palette.accent,{bold:true,maxWidth:VISUAL_WIDTH-52,maxLines:4,leading:48}));
    ops.push(text(visual.label,VISUAL_LEFT+26,104,12,palette.muted,{bold:true,maxWidth:VISUAL_WIDTH-52,maxLines:2}));
    return ops.join("\n");
  }
  if(visual.kind==="bars"){
    let y=385;for(const datum of visual.data.slice(0,4)){ops.push(text(datum.label,VISUAL_LEFT+24,y,12,palette.foreground,{bold:true,maxWidth:VISUAL_WIDTH-48,maxLines:1}));ops.push(rect(VISUAL_LEFT+24,y-22,VISUAL_WIDTH-48,8,mix(palette.foreground,palette.surface,.86)));ops.push(rect(VISUAL_LEFT+24,y-22,(VISUAL_WIDTH-48)*datum.weight,8,palette.accent));ops.push(text(datum.value,VISUAL_LEFT+24,y-43,10,palette.muted,{maxWidth:VISUAL_WIDTH-48,maxLines:1}));y-=78;}return ops.join("\n");
  }
  if(visual.kind==="timeline"){
    let y=388;visual.data.slice(0,4).forEach((datum,index)=>{if(index)ops.push(line(VISUAL_LEFT+36,y+16,VISUAL_LEFT+36,y+54,palette.muted,1));ops.push(rect(VISUAL_LEFT+30,y+5,12,12,palette.accent));ops.push(text(datum.label,VISUAL_LEFT+56,y+12,12,palette.foreground,{bold:true,maxWidth:VISUAL_WIDTH-82,maxLines:1}));ops.push(text(datum.value,VISUAL_LEFT+56,y-7,10,palette.muted,{maxWidth:VISUAL_WIDTH-82,maxLines:2}));y-=78;});return ops.join("\n");
  }
  if(visual.kind==="diagram"){
    ops.push(rect(VISUAL_LEFT+88,250,126,62,palette.accent));ops.push(text(visual.value,VISUAL_LEFT+98,282,12,presentation.mode==="dark"?"#121715":"#ffffff",{bold:true,maxWidth:106,maxLines:2,leading:14}));
    visual.data.slice(0,4).forEach((datum,index)=>{const x=VISUAL_LEFT+24+(index%2)*152,y=376-Math.floor(index/2)*238;ops.push(line(VISUAL_LEFT+151,281,x+62,y-5,palette.muted,1));ops.push(rect(x,y-25,124,48,palette.background));ops.push(text(datum.label,x+10,y-2,10,palette.foreground,{bold:true,maxWidth:104,maxLines:2,leading:12}));});return ops.join("\n");
  }
  visual.data.slice(0,5).forEach((datum,index)=>{const width=118+(datum.weight*30),height=64+(datum.weight*22),x=VISUAL_LEFT+24+(index%2)*140,y=370-Math.floor(index/2)*112;ops.push(rect(x,y-height,width,height,mix(palette.accent,palette.surface,.68-index*.08)));ops.push(text(datum.label,x+10,y-22,10,palette.foreground,{bold:true,maxWidth:width-20,maxLines:3,leading:12}));});return ops.join("\n");
};

const slidePage=(item:DocumentArtifactDraftItem,presentation:SlidePresentation,index:number,total:number,showFooterLabel:boolean)=>{
  const palette=presentation.palette,slide=item.slide??normalizeSlideVisual(null,item,index),ops:string[]=["q",rect(0,0,PAGE_WIDTH,PAGE_HEIGHT,palette.background)];
  if(presentation.stylePreset==="editorial")ops.push(rect(0,0,10,PAGE_HEIGHT,palette.accent));
  if(presentation.stylePreset==="nocturne")for(let x=42;x<PAGE_WIDTH;x+=64)ops.push(line(x,0,x,PAGE_HEIGHT,mix(palette.foreground,palette.background,.94),.5));
  if(presentation.stylePreset==="field-notes")for(let y=36;y<PAGE_HEIGHT;y+=36)ops.push(line(0,y,PAGE_WIDTH,y,mix(palette.foreground,palette.background,.92),.45));
  ops.push(text(slide.kicker.toLocaleUpperCase(),TEXT_LEFT,492,10,palette.muted,{bold:true,maxWidth:360,maxLines:1}));
  ops.push(text(`${String(index+1).padStart(2,"0")} / ${String(total).padStart(2,"0")}`,840,492,10,palette.muted,{bold:true,maxWidth:68,maxLines:1}));
  ops.push(text(item.title,TEXT_LEFT,418,item.title.length>70?29:36,palette.foreground,{bold:true,maxWidth:TEXT_WIDTH,maxLines:3,leading:item.title.length>70?33:40}));
  let bodyY=item.title.length>70?300:306;if(item.body){ops.push(text(item.body,TEXT_LEFT,bodyY,15,palette.muted,{maxWidth:TEXT_WIDTH,maxLines:4,leading:20}));bodyY-=94;}
  slide.bullets.slice(0,5).forEach((bullet)=>{ops.push(rect(TEXT_LEFT,bodyY-4,6,6,palette.accent));ops.push(text(bullet,TEXT_LEFT+18,bodyY,12.5,palette.foreground,{maxWidth:TEXT_WIDTH-18,maxLines:2,leading:15}));bodyY-=bullet.length>82?40:28;});
  ops.push(visual(slide,presentation));
  if(showFooterLabel&&presentation.footerLabel)ops.push(text(presentation.footerLabel,TEXT_LEFT,32,9,palette.muted,{bold:true,maxWidth:560,maxLines:1}));
  if(slideVisualIsComplete(slide))ops.push(text(slide.visual.label,760,32,9,palette.muted,{bold:true,maxWidth:146,maxLines:1}));
  ops.push("Q");return ops.filter(Boolean).join("\n");
};

const pdf=(pages:string[],title:string)=>{
  const objects:string[]=[];const add=(value:string)=>{objects.push(value);return objects.length;};
  const catalog=add("<< /Type /Catalog /Pages 2 0 R >>");
  add("");
  const regular=add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const bold=add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const pageIds:number[]=[];
  for(const stream of pages){const content=add(`<< /Length ${byteLength(stream)} >>\nstream\n${stream}\nendstream`);const page=add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >> >> /Contents ${content} 0 R >>`);pageIds.push(page);}
  objects[1]=`<< /Type /Pages /Kids [${pageIds.map((id)=>`${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  const info=add(`<< /Title (${literal(title)}) /Creator (Forma slideshow PDF export) >>`);
  const header="%PDF-1.4\n%Forma\n";let body=header;const offsets=[0];for(let index=0;index<objects.length;index+=1){offsets.push(byteLength(body));body+=`${index+1} 0 obj\n${objects[index]}\nendobj\n`;}
  const xrefOffset=byteLength(body);body+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map((offset)=>`${String(offset).padStart(10,"0")} 00000 n `).join("\n")}\ntrailer\n<< /Size ${objects.length+1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(body);
};

const renderedPdf=(pages:PresentationPdfRenderedPage[],title:string)=>{
  const objects:Uint8Array[]=[];
  const add=(value:string|Uint8Array)=>{objects.push(typeof value==="string"?encode(value):value);return objects.length;};
  const catalog=add("<< /Type /Catalog /Pages 2 0 R /MarkInfo << /Marked true >> >>");
  add("");
  const lines=pages.map((page)=>(page.text??"").split(/\r?\n/).map((line)=>line.trim()).filter(Boolean));
  const characters=[...new Set(lines.flatMap((entries)=>entries.flatMap((entry)=>Array.from(entry))))];
  const groups=Array.from({length:Math.max(1,Math.ceil(characters.length/255))},(_,index)=>characters.slice(index*255,(index+1)*255));
  const glyphs=new Map<string,{font:string;code:string}>();
  const fonts=groups.map((entries,index)=>{
    const name=`F${index+1}`;
    const mappings=entries.map((character,position)=>{
      const code=(position+1).toString(16).padStart(2,"0").toUpperCase();
      glyphs.set(character,{font:name,code});
      return`<${code}> <${utf16(character).slice(4)}>`;
    });
    const ranges=Array.from({length:Math.ceil(mappings.length/100)},(_,position)=>mappings.slice(position*100,(position+1)*100)).map((group)=>`${group.length} beginbfchar\n${group.join("\n")}\nendbfchar`).join("\n");
    const cmap=`/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /FormaUnicode${index+1} def\n/CMapType 2 def\n1 begincodespacerange\n<00> <FF>\nendcodespacerange${ranges?`\n${ranges}`:""}\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`;
    const unicode=add(`<< /Length ${byteLength(cmap)} >>\nstream\n${cmap}\nendstream`);
    const id=add(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding /ToUnicode ${unicode} 0 R >>`);
    return{name,id};
  });
  const pageIds:number[]=[];

  pages.forEach((page,index)=>{
    if(!Number.isSafeInteger(page.width)||page.width<1||!Number.isSafeInteger(page.height)||page.height<1||!page.bytes.byteLength)throw new TypeError("A rendered presentation page must contain compressed RGB pixels and valid dimensions.");
    const imageName=`Im${index+1}`;
    const image=add(combine([
      encode(`<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Interpolate false /Length ${page.bytes.byteLength} >>\nstream\n`),
      page.bytes,
      encode("\nendstream"),
    ]));

    // Lossless pixels preserve appearance; invisible text keeps search and
    // copy useful. Explicit ToUnicode maps retain accents, CJK, and emoji even
    // in PDF readers that ignore marked-content ActualText.
    const semantics=lines[index]!.map((line,lineIndex)=>{
      const runs:Array<{font:string;codes:string[]}>=[];
      for(const character of line){
        const glyph=glyphs.get(character);
        if(!glyph)continue;
        const previous=runs.at(-1);
        if(previous?.font===glyph.font)previous.codes.push(glyph.code);
        else runs.push({font:glyph.font,codes:[glyph.code]});
      }
      const content=runs.map((run)=>`/${run.font} 1 Tf\n<${run.codes.join("")}> Tj`).join("\n");
      return`/Span << /ActualText <${utf16(`${line}\n`)}> >> BDC\nBT\n3 Tr\n1 0 0 1 0 ${Math.max(0,PAGE_HEIGHT-lineIndex-1)} Tm\n${content}\nET\nEMC`;
    }).join("\n");
    const stream=`q\n${PAGE_WIDTH} 0 0 ${PAGE_HEIGHT} 0 0 cm\n/${imageName} Do\nQ${semantics?`\n${semantics}`:""}`;
    const content=add(`<< /Length ${byteLength(stream)} >>\nstream\n${stream}\nendstream`);
    const entry=add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << ${fonts.map((font)=>`/${font.name} ${font.id} 0 R`).join(" ")} >> /XObject << /${imageName} ${image} 0 R >> >> /Contents ${content} 0 R >>`);
    pageIds.push(entry);
  });

  objects[1]=encode(`<< /Type /Pages /Kids [${pageIds.map((id)=>`${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
  const info=add(`<< /Title <${utf16(title)}> /Creator (Forma high-fidelity slideshow PDF export) >>`);
  const parts:Uint8Array[]=[encode("%PDF-1.4\n%Forma\n")];
  const offsets=[0];
  let offset=parts[0]!.byteLength;

  objects.forEach((object,index)=>{
    offsets.push(offset);
    const header=encode(`${index+1} 0 obj\n`),footer=encode("\nendobj\n");
    parts.push(header,object,footer);
    offset+=header.byteLength+object.byteLength+footer.byteLength;
  });

  const xrefOffset=offset;
  parts.push(encode(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map((entry)=>`${String(entry).padStart(10,"0")} 00000 n `).join("\n")}\ntrailer\n<< /Size ${objects.length+1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`));
  return combine(parts);
};

export const presentationPdfFilename=(title:string)=>`${ascii(title).toLocaleLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")||"slide-deck"}.pdf`;

export function createPresentationPdfFromRenderedSlides(pages:PresentationPdfRenderedPage[],options:PresentationPdfOptions={}):PresentationPdfResult{
  if(!pages.length)throw new TypeError("At least one rendered presentation slide is required.");
  const title=String(options.title??"").trim()||"Slide deck";
  return{bytes:renderedPdf(pages,title),filename:presentationPdfFilename(title),pageCount:pages.length};
}

export function createPresentationPdf(items:DocumentArtifactDraftItem[],value:SlidePresentation|null,options:PresentationPdfOptions={}):PresentationPdfResult{
  const normalizedItems=normalizeSlideDeckItems(items),generated=normalizeSlidePresentation(value)??defaultSlidePresentation(),presentation=applySlideStylePreset(generated,generated.stylePreset),title=ascii(options.title)||presentation.footerLabel||normalizedItems[0]?.title||"Slide deck";
  const pages=normalizedItems.map((item,index)=>slidePage(item,presentation,index,normalizedItems.length,options.showFooterLabel!==false));
  return{bytes:pdf(pages.length?pages:[slidePage({title,body:"No slide content was retained.",notes:"",image_prompt:"",slide:null},presentation,0,1,options.showFooterLabel!==false)],title),filename:presentationPdfFilename(title),pageCount:Math.max(1,pages.length)};
}
