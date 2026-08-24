import { applySlideStylePreset, authoritativeSlideDatumWeight, defaultSlidePresentation, normalizeSlideItem, normalizeSlidePresentation, normalizeSlideVisual, slideVisualIsComplete, type DocumentArtifactDraftItem, type SlidePresentation, type SlideVisualData } from "./document-artifacts.ts";

export const PRESENTATION_PDF_PAGE_WIDTH=960;
export const PRESENTATION_PDF_PAGE_HEIGHT=540;
const PAGE_WIDTH=PRESENTATION_PDF_PAGE_WIDTH;
const PAGE_HEIGHT=PRESENTATION_PDF_PAGE_HEIGHT;
const TEXT_LEFT=54;
const TEXT_WIDTH=500;
const VISUAL_LEFT=604;
const VISUAL_WIDTH=302;

export type PresentationPdfOptions={title?:string;showFooterLabel?:boolean;language?:string;direction?:"ltr"|"rtl";translate?:(source:string)=>string;number?:(value:number)=>string};
export type PresentationPdfResult={bytes:Uint8Array;filename:string;pageCount:number};
export type PresentationPdfSemanticRole="H1"|"H2"|"P"|"L"|"LI"|"LBody"|"BlockQuote"|"Figure"|"Caption"|"Table"|"THead"|"TBody"|"TR"|"TH"|"TD"|"Note";
export type PresentationPdfSemanticNode={role:PresentationPdfSemanticRole;text?:string;children?:PresentationPdfSemanticNode[]};
export type PresentationPdfRenderedPage={width:number;height:number;bytes:Uint8Array;text?:string;heading?:string;bullets?:string[];structure?:PresentationPdfSemanticNode[];language?:string;direction?:"ltr"|"rtl"};

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

const text=(value:unknown,x:number,y:number,size:number,color:string,options:{bold?:boolean;maxWidth?:number;maxLines?:number;leading?:number;actualText?:string}={})=>{
  const maxWidth=options.maxWidth??500,maxLines=options.maxLines??1,characters=Math.max(4,Math.floor(maxWidth/(size*.53))),lines=wrap(value,characters,maxLines);if(!lines.length)return"";const leading=options.leading??size*1.17;
  const content=`BT\n/${options.bold?"F2":"F1"} ${number(size)} Tf\n${fill(color)}\n1 0 0 1 ${number(x)} ${number(y)} Tm\n${lines.map((entry,index)=>`${index?`0 -${number(leading)} Td\n`:""}(${literal(entry)}) Tj`).join("\n")}\nET`;
  return options.actualText?`/Span << /ActualText <${utf16(options.actualText)}> >> BDC\n${content}\nEMC`:content;
};

const completeText=(value:string,x:number,y:number,width:number,height:number,color:string,options:{preferredSize?:number;minimumSize?:number;bold?:boolean;actualText?:boolean}={})=>{
  const source=ascii(value);if(!source)return{content:"",height:0};
  const preferredSize=options.preferredSize??19,minimumSize=options.minimumSize??10;
  for(let size=preferredSize;size>=minimumSize;size-=.5){
    const leading=size*1.27,characters=Math.max(4,Math.floor(width/(size*.53))),lines=wrap(source,characters,Number.MAX_SAFE_INTEGER);
    if(lines.length*leading>height&&size>minimumSize)continue;
    return{content:text(source,x,y,size,color,{bold:options.bold,maxWidth:width,maxLines:lines.length,leading,...options.actualText?{actualText:value}:{}}),height:lines.length*leading};
  }
  return{content:"",height:0};
};

const precision=(value:string|undefined,unit:string|undefined)=>value?`${value}${unit&&!value.includes(unit)?` ${unit}`:""}`:"";

const attribution=(slide:SlideVisualData)=>{
  const quote=slide.quote;if(!quote)return"";
  return[quote.speaker,quote.role].filter((value,index,values)=>Boolean(value)&&values.indexOf(value)===index).join(" - ");
};

const opaqueSourceReference=(value:string)=>/^(?:(?:blk|grp|clm|source|decision)(?:_|-)\d+|context_group_\d+|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(value.trim());

const publicCitationPart=(value:string|undefined,fallback="")=>{
  const result=value?.trim()??"";
  return result&&opaqueSourceReference(result)?fallback:result;
};

const visual=(slide:SlideVisualData,presentation:SlidePresentation)=>{
  const palette=presentation.palette,visual=slide.visual,ops:string[]=[rect(VISUAL_LEFT,68,VISUAL_WIDTH,392,palette.surface)];
  if(!slideVisualIsComplete(slide))return ops.join("\n");

  if(visual.kind==="quote"&&slide.quote){
    const quote=completeText(slide.quote.text,VISUAL_LEFT+24,403,VISUAL_WIDTH-48,270,palette.foreground,{preferredSize:20,minimumSize:11,bold:true,actualText:true});
    ops.push(text(visual.label,VISUAL_LEFT+24,431,11,palette.muted,{bold:true,maxWidth:VISUAL_WIDTH-48}));
    ops.push(quote.content);
    const baseline=Math.max(106,403-quote.height-24);
    ops.push(text(attribution(slide),VISUAL_LEFT+24,baseline,11,palette.accent,{bold:true,maxWidth:VISUAL_WIDTH-48,maxLines:2}));
    const citation=publicCitationPart(slide.quote.citation);
    if(citation)ops.push(text(citation,VISUAL_LEFT+24,baseline-31,10,palette.muted,{maxWidth:VISUAL_WIDTH-48,maxLines:2}));
    return ops.filter(Boolean).join("\n");
  }

  if(visual.kind==="hero-type"||visual.kind==="metric"){
    const size=visual.value.length>38?30:visual.value.length>20?40:56;
    ops.push(text(visual.value,VISUAL_LEFT+26,330,size,palette.accent,{bold:true,maxWidth:VISUAL_WIDTH-52,maxLines:4,leading:48}));
    const details=[
      ...visual.exactValue?[{label:"Exact",value:precision(visual.exactValue,visual.unit)}]:[],
      ...visual.displayValue?[{label:"Displayed",value:precision(visual.displayValue,visual.unit)}]:[],
      ...visual.data.map((datum)=>({label:datum.label,value:datum.displayValue??datum.value})),
    ];
    const labelBaseline=details.length>4?86:104;
    if(details.length){
      const titleLines=wrap(visual.value,Math.max(4,Math.floor((VISUAL_WIDTH-52)/(size*.53))),4).length;
      const detailTop=Math.min(205,330-(titleLines-1)*48-20),rowStep=details.length>4?12.5:17;
      const maxRows=Math.max(1,Math.floor((detailTop-labelBaseline-13)/rowStep));
      const columns=Math.ceil(details.length/maxRows),rows=Math.ceil(details.length/columns),columnWidth=(VISUAL_WIDTH-52)/columns;
      details.forEach((detail,index)=>{
        const x=VISUAL_LEFT+26+Math.floor(index/rows)*columnWidth,y=detailTop-(index%rows)*rowStep;
        if(columns===1)ops.push(text(`${detail.label}: ${detail.value}`,x,y,10,palette.foreground,{bold:true,maxWidth:columnWidth,maxLines:1}));
        else{
          const valueWidth=Math.max(28,Math.min(columnWidth*.45,detail.value.length*5.5));
          ops.push(text(detail.label,x,y,10,palette.foreground,{bold:true,maxWidth:Math.max(28,columnWidth-valueWidth-4),maxLines:1}));
          ops.push(text(detail.value,x+columnWidth-valueWidth,y,10,palette.foreground,{maxWidth:valueWidth,maxLines:1}));
        }
      });
    }
    ops.push(text(visual.label,VISUAL_LEFT+26,labelBaseline,12,palette.muted,{bold:true,maxWidth:VISUAL_WIDTH-52,maxLines:labelBaseline>=104?2:1}));
    return ops.join("\n");
  }

  const left=VISUAL_LEFT+18,width=VISUAL_WIDTH-36;
  let top=427;
  if(visual.label){ops.push(text(visual.label,left,top,11,palette.muted,{bold:true,maxWidth:width,maxLines:1}));top-=22;}
  if(visual.exactValue){ops.push(text(`Exact: ${precision(visual.exactValue,visual.unit)}`,left,top,10.5,palette.foreground,{bold:true,maxWidth:width}));top-=18;}
  if(visual.displayValue){ops.push(text(`Displayed: ${precision(visual.displayValue,visual.unit)}`,left,top,10.5,palette.foreground,{bold:true,maxWidth:width}));top-=18;}
  const available=Math.max(82,top-88);

  if(visual.kind==="bars"||visual.kind==="scorecard"){
    const minimumRowHeight=visual.data.some((datum)=>datum.exactValue&&datum.exactValue!==(datum.displayValue??datum.value))?39:29;
    const columns=Math.max(1,Math.ceil(visual.data.length/Math.max(1,Math.floor(available/minimumRowHeight))));
    const rows=Math.ceil(visual.data.length/columns),columnWidth=width/columns,rowHeight=Math.min(62,available/Math.max(1,rows));
    visual.data.forEach((datum,index)=>{
      const column=Math.floor(index/rows),row=index%rows,x=left+column*columnWidth,y=top-row*rowHeight;
      const value=datum.displayValue??datum.value;
      const valueWidth=Math.max(31,Math.min(columnWidth*.44,value.length*6));
      ops.push(text(datum.label,x,y,10,palette.foreground,{bold:true,maxWidth:Math.max(32,columnWidth-valueWidth-8),maxLines:1}));
      ops.push(text(value,x+columnWidth-valueWidth,y,10,palette.foreground,{bold:true,maxWidth:valueWidth,maxLines:1}));
      ops.push(rect(x,y-15,columnWidth-8,6,mix(palette.foreground,palette.surface,.86)));
      ops.push(rect(x,y-15,(columnWidth-8)*authoritativeSlideDatumWeight(visual,datum),6,palette.accent));
      if(datum.exactValue&&datum.exactValue!==value&&rowHeight>=39)ops.push(text(`Exact: ${datum.exactValue}`,x,y-29,10,palette.muted,{maxWidth:columnWidth-8,maxLines:1}));
    });
    return ops.join("\n");
  }

  if(visual.kind==="timeline"||visual.kind==="roadmap"){
    const columns=Math.max(1,Math.ceil(visual.data.length/Math.max(1,Math.floor(available/48))));
    const rows=Math.ceil(visual.data.length/columns),columnWidth=width/columns,rowHeight=Math.min(68,available/Math.max(1,rows));
    visual.data.forEach((datum,index)=>{
      const column=Math.floor(index/rows),row=index%rows,x=left+column*columnWidth,y=top-row*rowHeight;
      if(row)ops.push(line(x+7,y+11,x+7,y+rowHeight-12,palette.muted,1));
      ops.push(rect(x+2,y-2,10,10,palette.accent));
      ops.push(text(datum.label,x+20,y+3,10,palette.foreground,{bold:true,maxWidth:columnWidth-23,maxLines:1}));
      ops.push(text(datum.displayValue??datum.value,x+20,y-13,10,palette.muted,{maxWidth:columnWidth-23,maxLines:rowHeight>=46?2:1,leading:12}));
    });
    return ops.join("\n");
  }

  if(visual.kind==="comparison"||visual.kind==="matrix"||visual.kind==="personas"){
    const rows=visual.data.length,rowHeight=Math.min(45,available/Math.max(1,rows));
    visual.data.forEach((datum,index)=>{
      const y=top-index*rowHeight;
      if(index%2===0)ops.push(rect(left-5,y-rowHeight+9,width+10,rowHeight,mix(palette.background,palette.surface,.5)));
      ops.push(text(datum.label,left,y,10,palette.foreground,{bold:true,maxWidth:width*.58,maxLines:rowHeight>=36?2:1,leading:12}));
      ops.push(text(datum.displayValue??datum.value,left+width*.61,y,10,palette.foreground,{maxWidth:width*.39,maxLines:rowHeight>=36?2:1,leading:12}));
      if(datum.exactValue&&datum.exactValue!==(datum.displayValue??datum.value)&&rowHeight>=38)ops.push(text(`Exact: ${datum.exactValue}`,left+width*.61,y-16,10,palette.muted,{maxWidth:width*.39}));
    });
    return ops.join("\n");
  }

  if(visual.kind==="diagram"||visual.kind==="architecture"){
    if(visual.value){
      ops.push(rect(left,top-27,width,31,palette.accent));
      ops.push(text(visual.value,left+9,top-8,10,presentation.mode==="dark"?"#121715":"#ffffff",{bold:true,maxWidth:width-18,maxLines:1}));
      top-=45;
    }
    const columns=visual.data.length>12?3:2,rows=Math.ceil(visual.data.length/columns),rowHeight=Math.min(76,Math.max(24,(top-84)/Math.max(1,rows))),columnWidth=width/columns;
    visual.data.forEach((datum,index)=>{
      const column=index%columns,row=Math.floor(index/columns),x=left+column*columnWidth,y=top-row*rowHeight;
      if(visual.value)ops.push(line(left+width/2,top+11,x+columnWidth/2,y-4,palette.muted,.6));
      ops.push(rect(x+2,y-rowHeight+7,columnWidth-7,Math.max(18,rowHeight-10),palette.background));
      ops.push(text(datum.label,x+8,y-12,10,palette.foreground,{bold:true,maxWidth:columnWidth-18,maxLines:rowHeight>=52?2:1,leading:11}));
      if(datum.value&&rowHeight>=36)ops.push(text(datum.displayValue??datum.value,x+8,y-rowHeight+16,10,palette.muted,{maxWidth:columnWidth-18,maxLines:1}));
    });
    return ops.join("\n");
  }

  const columns=visual.data.length>12?3:2,rows=Math.ceil(visual.data.length/columns),columnWidth=width/columns,rowHeight=Math.min(108,available/Math.max(1,rows));
  visual.data.forEach((datum,index)=>{
    const x=left+(index%columns)*columnWidth,y=top-Math.floor(index/columns)*rowHeight;
    ops.push(rect(x+2,y-rowHeight+8,columnWidth-7,Math.max(16,rowHeight-11),mix(palette.accent,palette.surface,Math.max(.2,.7-(index%6)*.08))));
    ops.push(text(datum.label,x+9,y-17,10,palette.foreground,{bold:true,maxWidth:columnWidth-18,maxLines:rowHeight>=47?2:1,leading:12}));
    if(datum.value&&rowHeight>=39)ops.push(text(datum.displayValue??datum.value,x+9,y-rowHeight+17,10,palette.foreground,{maxWidth:columnWidth-18,maxLines:1}));
  });
  return ops.join("\n");
};

const slidePage=(item:DocumentArtifactDraftItem,presentation:SlidePresentation,index:number,total:number,showFooterLabel:boolean)=>{
  const palette=presentation.palette,slide=item.slide??normalizeSlideVisual(null,item,index),ops:string[]=["q",rect(0,0,PAGE_WIDTH,PAGE_HEIGHT,palette.background)];
  const citations=(slide.citations??[]).map((citation,citationIndex)=>{
    const label=[publicCitationPart(citation.label,"Authored source"),publicCitationPart(citation.anchor)].filter(Boolean).join(" - ");
    return`[${citationIndex+1}] ${[label,citation.excerpt].filter(Boolean).join(": ")}`.trim();
  }).filter(Boolean);
  const citationHeights=citations.map((citation)=>Math.max(14,wrap(citation,Math.floor(TEXT_WIDTH/(10*.53)),Number.MAX_SAFE_INTEGER).length*12+5));
  const citationSpace=citationHeights.reduce((total,height)=>total+height,0);
  const contentFloor=56+citationSpace+(citations.length?18:0);
  if(presentation.stylePreset==="editorial")ops.push(rect(0,0,10,PAGE_HEIGHT,palette.accent));
  if(presentation.stylePreset==="nocturne")for(let x=42;x<PAGE_WIDTH;x+=64)ops.push(line(x,0,x,PAGE_HEIGHT,mix(palette.foreground,palette.background,.94),.5));
  if(presentation.stylePreset==="field-notes")for(let y=36;y<PAGE_HEIGHT;y+=36)ops.push(line(0,y,PAGE_WIDTH,y,mix(palette.foreground,palette.background,.92),.45));
  ops.push(text(slide.kicker.toLocaleUpperCase(),TEXT_LEFT,492,10,palette.muted,{bold:true,maxWidth:360,maxLines:1}));
  ops.push(text(`${String(index+1).padStart(2,"0")} / ${String(total).padStart(2,"0")}`,840,492,10,palette.muted,{bold:true,maxWidth:68,maxLines:1}));
  ops.push(text(item.title,TEXT_LEFT,418,item.title.length>70?29:36,palette.foreground,{bold:true,maxWidth:TEXT_WIDTH,maxLines:3,leading:item.title.length>70?33:40}));
  let bodyY=item.title.length>70?300:306;if(item.body){ops.push(text(item.body,TEXT_LEFT,bodyY,15,palette.muted,{maxWidth:TEXT_WIDTH,maxLines:4,leading:20}));bodyY-=94;}
  if(slide.quote&&slide.visual.kind!=="quote"){
    const available=Math.max(44,Math.min(140,bodyY-contentFloor-slide.bullets.length*22-24));
    const quote=completeText(slide.quote.text,TEXT_LEFT,bodyY,TEXT_WIDTH,available,palette.foreground,{preferredSize:15,minimumSize:10,bold:true,actualText:true});
    ops.push(quote.content);
    bodyY-=quote.height+15;
    ops.push(text(attribution(slide),TEXT_LEFT,bodyY,10,palette.accent,{bold:true,maxWidth:TEXT_WIDTH,maxLines:1}));
    bodyY-=22;
  }
  slide.bullets.forEach((bullet,bulletIndex)=>{
    const remaining=Math.max(1,slide.bullets.length-bulletIndex),rowHeight=Math.max(20,Math.min(bullet.length>82?40:28,(bodyY-contentFloor)/remaining));
    ops.push(rect(TEXT_LEFT,bodyY-4,6,6,palette.accent));
    ops.push(text(bullet,TEXT_LEFT+18,bodyY,rowHeight<24?10:12.5,palette.foreground,{maxWidth:TEXT_WIDTH-18,maxLines:rowHeight>=34?2:1,leading:15}));
    bodyY-=rowHeight;
  });
  ops.push(visual(slide,presentation));
  if(citations.length){
    let citationY=56+citationSpace;
    ops.push(text("Sources",TEXT_LEFT,citationY+12,10,palette.muted,{bold:true,maxWidth:TEXT_WIDTH,maxLines:1}));
    citations.forEach((citation,citationIndex)=>{
      const source=completeText(citation,TEXT_LEFT,citationY,TEXT_WIDTH,citationHeights[citationIndex]??18,palette.muted,{preferredSize:10,minimumSize:10,actualText:true});
      ops.push(source.content);
      citationY-=citationHeights[citationIndex]??18;
    });
  }
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
  const info=add(`<< /Title (${literal(title)}) /Creator (Forma) >>`);
  const header="%PDF-1.4\n%Forma\n";let body=header;const offsets=[0];for(let index=0;index<objects.length;index+=1){offsets.push(byteLength(body));body+=`${index+1} 0 obj\n${objects[index]}\nendobj\n`;}
  const xrefOffset=byteLength(body);body+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map((offset)=>`${String(offset).padStart(10,"0")} 00000 n `).join("\n")}\ntrailer\n<< /Size ${objects.length+1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(body);
};

const pdfLanguage=(value:unknown)=>{
  try{return Intl.getCanonicalLocales(typeof value==="string"?value:"en")[0]??"en";}catch{return"en";}
};

const PDF_SEMANTIC_ROLES=new Set<PresentationPdfSemanticRole>(["H1","H2","P","L","LI","LBody","BlockQuote","Figure","Caption","Table","THead","TBody","TR","TH","TD","Note"]);

const semanticText=(value:unknown)=>typeof value==="string"?value.replace(/\r\n?/g,"\n").trim():"";

const normalizeSemanticNodes=(values:unknown,depth=0):PresentationPdfSemanticNode[]=>{
  if(!Array.isArray(values)||depth>=32)return[];
  return values.flatMap((value):PresentationPdfSemanticNode[]=>{
    if(!value||typeof value!=="object"||Array.isArray(value))return[];
    const entry=value as Partial<PresentationPdfSemanticNode>;
    if(!entry.role||!PDF_SEMANTIC_ROLES.has(entry.role))return[];
    const line=semanticText(entry.text),children=normalizeSemanticNodes(entry.children,depth+1);
    if(!line&&!children.length)return[];
    return[{role:entry.role,...line?{text:line}:{},...children.length?{children}:{}}];
  });
};

const semanticLeaves=(nodes:PresentationPdfSemanticNode[]):string[]=>nodes.flatMap((node)=>[
  ...node.text?[node.text]:[],
  ...node.children?semanticLeaves(node.children):[],
]);

const semanticKey=(value:string)=>value.normalize("NFKC").replace(/\s+/gu," ").trim();

const fallbackSemanticNodes=(source:string[],heading:string,bullets:string[]):PresentationPdfSemanticNode[]=>{
  const remainingBullets=[...bullets],nodes:PresentationPdfSemanticNode[]=[{role:"H1",text:heading}];
  let removedHeading=false;
  for(const line of source){
    if(!removedHeading&&line===heading){removedHeading=true;continue;}
    const bulletIndex=remainingBullets.indexOf(line);
    if(bulletIndex===-1){nodes.push({role:"P",text:line});continue;}
    remainingBullets.splice(bulletIndex,1);
    const item:PresentationPdfSemanticNode={role:"LI",children:[{role:"LBody",text:line}]};
    const previous=nodes.at(-1);
    if(previous?.role==="L")previous.children!.push(item);
    else nodes.push({role:"L",children:[item]});
  }
  if(remainingBullets.length)nodes.push({role:"L",children:remainingBullets.map((line)=>({role:"LI",children:[{role:"LBody",text:line}]}))});
  return nodes;
};

const structuredSemanticNodes=(source:string[],heading:string,bullets:string[],structure:PresentationPdfSemanticNode[]|undefined)=>{
  const normalized=normalizeSemanticNodes(structure);
  if(!normalized.length)return fallbackSemanticNodes(source,heading,bullets);

  let headingRetained=false;
  const demoteExtraHeadings=(nodes:PresentationPdfSemanticNode[]):PresentationPdfSemanticNode[]=>nodes.map((node)=>{
    const isHeading=node.role==="H1";
    const role=isHeading&&headingRetained?"H2":node.role;
    if(isHeading)headingRetained=true;
    const children=node.children?demoteExtraHeadings(node.children):undefined;
    return{...node,role,...children?{children}:{}};
  });
  const nodes=demoteExtraHeadings(normalized);
  if(!headingRetained)nodes.unshift({role:"H1",text:heading});

  // The screenshot and semantic DOM may expose slightly different line breaks
  // (especially table cells). Preserve any remaining visible copy instead of
  // silently dropping chart values, citations, or a late slide footer.
  const covered=semanticLeaves(nodes).map(semanticKey).filter(Boolean);
  const isCovered=(line:string)=>{
    const key=semanticKey(line);
    if(!key)return true;
    if(covered.some((entry)=>entry===key||entry.includes(key)))return true;
    const columns=line.split(/\t+/).map(semanticKey).filter(Boolean);
    return columns.length>1&&columns.every((column)=>covered.some((entry)=>entry===column||entry.includes(column)));
  };
  for(const line of source)if(!isCovered(line)){nodes.push({role:"P",text:line});covered.push(semanticKey(line));}
  return nodes;
};

const renderedPdf=(pages:PresentationPdfRenderedPage[],title:string,options:PresentationPdfOptions)=>{
  const objects:Uint8Array[]=[];
  const add=(value:string|Uint8Array)=>{objects.push(typeof value==="string"?encode(value):value);return objects.length;};
  const catalog=add("");
  add("");
  const structureRoot=add("");
  const documentStructure=add("");
  const parentTree=add("");
  const semanticPages=pages.map((page,index)=>{
    const source=(page.text??"").split(/\r?\n/).map((line)=>line.trim()).filter(Boolean);
    const fallbackHeading=`${options.translate?.("Slide")??"Slide"} ${options.number?.(index+1)??index+1}`;
    const heading=String(page.heading??source[0]??fallbackHeading).trim()||fallbackHeading;
    const bullets=(page.bullets??[]).map((bullet)=>String(bullet).trim()).filter(Boolean);
    const nodes=structuredSemanticNodes(source,heading,bullets,page.structure);
    return{nodes,language:pdfLanguage(page.language??options.language),direction:page.direction??options.direction??"ltr"};
  });
  const lines=semanticPages.map((page)=>semanticLeaves(page.nodes));
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
  const sectionIds:number[]=[];
  const parentEntries:Array<{page:number;leaves:number[]}>=[];

  pages.forEach((page,index)=>{
    if(!Number.isSafeInteger(page.width)||page.width<1||!Number.isSafeInteger(page.height)||page.height<1||!page.bytes.byteLength)throw new TypeError("A rendered presentation page must contain compressed RGB pixels and valid dimensions.");
    const imageName=`Im${index+1}`;
    const image=add(combine([
      encode(`<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Interpolate false /Length ${page.bytes.byteLength} >>\nstream\n`),
      page.bytes,
      encode("\nendstream"),
    ]));

    const content=add("");
    const entry=add("");
    pageIds.push(entry);
    const semanticPage=semanticPages[index]!;
    const section=add("");
    sectionIds.push(section);
    const leaves:number[]=[];
    const semanticLines:Array<{line:string;role:PresentationPdfSemanticRole;id:number}>=[];
    const semanticNode=(node:PresentationPdfSemanticNode,parent:number):number=>{
      const id=add("");
      const contentId=node.text?leaves.length:null;
      if(node.text){leaves.push(id);semanticLines.push({line:node.text,role:node.role,id});}
      const children=(node.children??[]).map((child)=>semanticNode(child,id));
      const kids=[...contentId===null?[]:[String(contentId)],...children.map((child)=>`${child} 0 R`)];
      const value=kids.length===1&&!children.length?kids[0]:`[${kids.join(" ")}]`;
      const alternative=node.role==="Figure"?semanticLeaves([node]).join(" - "):"";
      const attributes=node.role==="TH"?" /A << /O /Table /Scope /Column >>":"";
      const description=alternative?` /Alt <${utf16(alternative)}>`:"";
      objects[id-1]=encode(`<< /Type /StructElem /S /${node.role} /P ${parent} 0 R /Pg ${entry} 0 R${attributes}${description} /K ${value} >>`);
      return id;
    };
    const children=semanticPage.nodes.map((node)=>semanticNode(node,section));
    const direction=semanticPage.direction==="rtl"?" /A << /O /Layout /WritingMode /RlTb >>":"";
    objects[section-1]=encode(`<< /Type /StructElem /S /Sect /P ${documentStructure} 0 R /Lang (${semanticPage.language})${direction} /K [${children.map((id)=>`${id} 0 R`).join(" ")}] >>`);
    parentEntries.push({page:index,leaves});

    // The screenshot is an artifact; every visible label is represented by a
    // Unicode leaf in the tagged Document / Sect / H1 / P / L structure.
    const semantics=semanticLines.map(({line,role},lineIndex)=>{
      const runs:Array<{font:string;codes:string[]}>=[];
      for(const character of line){
        const glyph=glyphs.get(character);
        if(!glyph)continue;
        const previous=runs.at(-1);
        if(previous?.font===glyph.font)previous.codes.push(glyph.code);
        else runs.push({font:glyph.font,codes:[glyph.code]});
      }
      const content=runs.map((run)=>`/${run.font} 1 Tf\n<${run.codes.join("")}> Tj`).join("\n");
      return`/${role} << /MCID ${lineIndex} /ActualText <${utf16(`${line}\n`)}> >> BDC\nBT\n3 Tr\n1 0 0 1 0 ${Math.max(0,PAGE_HEIGHT-lineIndex-1)} Tm\n${content}\nET\nEMC`;
    }).join("\n");
    const stream=`/Artifact BMC\nq\n${PAGE_WIDTH} 0 0 ${PAGE_HEIGHT} 0 0 cm\n/${imageName} Do\nQ\nEMC${semantics?`\n${semantics}`:""}`;
    objects[content-1]=encode(`<< /Length ${byteLength(stream)} >>\nstream\n${stream}\nendstream`);
    objects[entry-1]=encode(`<< /Type /Page /Parent 2 0 R /StructParents ${index} /Tabs /S /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << ${fonts.map((font)=>`/${font.name} ${font.id} 0 R`).join(" ")} >> /XObject << /${imageName} ${image} 0 R >> >> /Contents ${content} 0 R >>`);
  });

  objects[catalog-1]=encode(`<< /Type /Catalog /Pages 2 0 R /StructTreeRoot ${structureRoot} 0 R /MarkInfo << /Marked true >> /Lang (${pdfLanguage(options.language)}) /ViewerPreferences << /DisplayDocTitle true >> >>`);
  objects[1]=encode(`<< /Type /Pages /Kids [${pageIds.map((id)=>`${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
  objects[structureRoot-1]=encode(`<< /Type /StructTreeRoot /K ${documentStructure} 0 R /ParentTree ${parentTree} 0 R /ParentTreeNextKey ${pages.length} >>`);
  objects[documentStructure-1]=encode(`<< /Type /StructElem /S /Document /P ${structureRoot} 0 R /K [${sectionIds.map((id)=>`${id} 0 R`).join(" ")}] >>`);
  objects[parentTree-1]=encode(`<< /Nums [${parentEntries.map((entry)=>`${entry.page} [${entry.leaves.map((id)=>`${id} 0 R`).join(" ")}]`).join(" ")}] >>`);
  const info=add(`<< /Title <${utf16(title)}> /Creator (Forma) >>`);
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

export const presentationPdfFilename=(title:string,locale="en")=>`${String(title).normalize("NFKD").replace(/[\u0300-\u036f]/g,"").normalize("NFKC").toLocaleLowerCase(locale).replace(/[^\p{L}\p{N}]+/gu,"-").replace(/^-|-$/g,"")||"slide-deck"}.pdf`;

export function createPresentationPdfFromRenderedSlides(pages:PresentationPdfRenderedPage[],options:PresentationPdfOptions={}):PresentationPdfResult{
  if(!pages.length)throw new TypeError("At least one rendered presentation slide is required.");
  const title=String(options.title??"").trim()||(options.translate?.("Slide deck")??"Slide deck");
  return{bytes:renderedPdf(pages,title,options),filename:presentationPdfFilename(title,options.language),pageCount:pages.length};
}

export function createPresentationPdf(items:DocumentArtifactDraftItem[],value:SlidePresentation|null,options:PresentationPdfOptions={}):PresentationPdfResult{
  const normalizedItems=items.map((item,index)=>normalizeSlideItem(item,index)),generated=normalizeSlidePresentation(value)??defaultSlidePresentation(),presentation=applySlideStylePreset(generated,generated.stylePreset),title=ascii(options.title)||presentation.footerLabel||normalizedItems[0]?.title||"Slide deck";
  const pages=normalizedItems.map((item,index)=>slidePage(item,presentation,index,normalizedItems.length,options.showFooterLabel!==false));
  return{bytes:pdf(pages.length?pages:[slidePage({title,body:"No slide content was retained.",notes:"",image_prompt:"",slide:null},presentation,0,1,options.showFooterLabel!==false)],title),filename:presentationPdfFilename(title,options.language),pageCount:Math.max(1,pages.length)};
}
