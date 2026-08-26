import { authoritativeSlideDatumWeight, formatPresentationQuantity, type DocumentArtifactDraftItem, type SlidePresentation, type SlideVisualData } from "./document-artifacts.ts";
import { presentationAudienceItem } from "./presentation-delivery.ts";
import { PRESENTATION_CANVAS_HEIGHT, PRESENTATION_CANVAS_WIDTH } from "./presentation-layout.ts";
import { localizedSourceAnchor } from "./source-anchor.ts";

export const WORD_DOCUMENT_MIME="application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const POWERPOINT_DOCUMENT_MIME="application/vnd.openxmlformats-officedocument.presentationml.presentation";
const POWERPOINT_EMUS_PER_CANVAS_PIXEL=12_700;
const POWERPOINT_SLIDE_WIDTH=PRESENTATION_CANVAS_WIDTH*POWERPOINT_EMUS_PER_CANVAS_PIXEL;
const POWERPOINT_SLIDE_HEIGHT=PRESENTATION_CANVAS_HEIGHT*POWERPOINT_EMUS_PER_CANVAS_PIXEL;

const encoder=new TextEncoder();
const XML='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const R="http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG="http://schemas.openxmlformats.org/package/2006/relationships";
const W="http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const A="http://schemas.openxmlformats.org/drawingml/2006/main";
const P="http://schemas.openxmlformats.org/presentationml/2006/main";
type OfficeLocalization={translate?:(source:string,values?:Record<string,string|number>)=>string;number?:(value:number)=>string;fontFamily?:string};
const escapeXml=(value:unknown)=>String(value??"").replace(/[\p{Cc}\ufffe\uffff]/gu,(character)=>character==="\t"||character==="\n"||character==="\r"?character:"")
  .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&apos;");
const color=(value:unknown,fallback:string)=>/^#[0-9a-f]{6}$/i.test(String(value))?String(value).slice(1).toUpperCase():fallback;
const language=(value:unknown)=>/^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/i.test(String(value))?String(value):"en-US";
const relationship=(id:string,type:string,target:string)=>`<Relationship Id="${id}" Type="${R}/${type}" Target="${escapeXml(target)}"/>`;
const relationships=(items:string[])=>`${XML}<Relationships xmlns="${PKG}">${items.join("")}</Relationships>`;
const override=(name:string,type:string)=>`<Override PartName="/${name}" ContentType="${type}"/>`;
const crcTable=Uint32Array.from({length:256},(_,value)=>{let crc=value;for(let bit=0;bit<8;bit+=1)crc=(crc&1)?0xEDB88320^(crc>>>1):crc>>>1;return crc>>>0;});
const crc32=(bytes:Uint8Array)=>{let crc=0xFFFFFFFF;for(const byte of bytes)crc=crcTable[(crc^byte)&0xFF]!^(crc>>>8);return(crc^0xFFFFFFFF)>>>0;};

/** Bounded, dependency-free ZIP STORE archives preserve authored parts and original media bytes. */
export function createOfficeArchive(entries:Array<{name:string;content:string|Uint8Array}>,options:{media?:boolean}={}):Uint8Array{
  if(!entries.length||entries.length>500)throw new Error("invalid_office_archive");
  const maxEntryBytes=options.media?24_000_000:2_000_000,maxArchiveBytes=options.media?96_000_000:5_000_000,seen=new Set<string>();
  const encoded=entries.map(({name,content})=>{
    if(!name||name.startsWith("/")||name.includes("\\")||/\p{Cc}/u.test(name)||name.split("/").some((segment)=>!segment||segment==="."||segment==="..")||seen.has(name))throw new Error("invalid_office_archive_path");
    seen.add(name);
    const filename=encoder.encode(name),body=typeof content==="string"?encoder.encode(content):content;
    if(filename.length>1024||body.length>maxEntryBytes)throw new Error("office_archive_entry_too_large");
    return{filename,body,checksum:crc32(body)};
  });
  const localSize=encoded.reduce((total,item)=>total+30+item.filename.length+item.body.length,0);
  const centralSize=encoded.reduce((total,item)=>total+46+item.filename.length,0);
  const total=localSize+centralSize+22;if(total>maxArchiveBytes)throw new Error("office_archive_too_large");
  const output=new Uint8Array(total),view=new DataView(output.buffer);let local=0,central=localSize;
  for(const item of encoded){
    const start=local;
    view.setUint32(local,0x04034B50,true);view.setUint16(local+4,20,true);view.setUint16(local+6,0x0800,true);
    view.setUint16(local+12,0x21,true);view.setUint32(local+14,item.checksum,true);view.setUint32(local+18,item.body.length,true);
    view.setUint32(local+22,item.body.length,true);view.setUint16(local+26,item.filename.length,true);
    output.set(item.filename,local+30);output.set(item.body,local+30+item.filename.length);local+=30+item.filename.length+item.body.length;
    view.setUint32(central,0x02014B50,true);view.setUint16(central+4,20,true);view.setUint16(central+6,20,true);view.setUint16(central+8,0x0800,true);
    view.setUint16(central+14,0x21,true);view.setUint32(central+16,item.checksum,true);view.setUint32(central+20,item.body.length,true);
    view.setUint32(central+24,item.body.length,true);view.setUint16(central+28,item.filename.length,true);view.setUint32(central+42,start,true);
    output.set(item.filename,central+46);central+=46+item.filename.length;
  }
  view.setUint32(central,0x06054B50,true);view.setUint16(central+8,encoded.length,true);view.setUint16(central+10,encoded.length,true);
  view.setUint32(central+12,centralSize,true);view.setUint32(central+16,localSize,true);
  return output;
}

const coreProperties=(title:string)=>{
  const now=new Date().toISOString();
  return`${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(title)}</dc:title><dc:creator>Forma</dc:creator><cp:lastModifiedBy>Forma</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
};
const appProperties=(presentation=false)=>`${XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Forma</Application>${presentation?"<PresentationFormat>16:9</PresentationFormat>":""}</Properties>`;
const rootRelationships=(target:string)=>relationships([relationship("rId1","officeDocument",target),`<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>`,relationship("rId3","extended-properties","docProps/app.xml")]);
const baseTypes=(items:string[])=>`${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${override("docProps/core.xml","application/vnd.openxmlformats-package.core-properties+xml")}${override("docProps/app.xml","application/vnd.openxmlformats-officedocument.extended-properties+xml")}${items.join("")}</Types>`;

function wordRuns(value:string,locale:string,rtl:boolean){
  const tokens=value.split(/(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`)/g).filter(Boolean);
  return tokens.map((token)=>{
    const bold=token.startsWith("**")&&token.endsWith("**")||token.startsWith("__")&&token.endsWith("__");
    const code=token.startsWith("`")&&token.endsWith("`");
    const text=bold?token.slice(2,-2):code?token.slice(1,-1):token;
    const properties=[bold?"<w:b/>":"",code?'<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>':"",rtl?"<w:rtl/>":"",`<w:lang w:val="${locale}"${rtl?` w:bidi="${locale}"`:""}/>`].join("");
    const style=`<w:rPr>${properties}</w:rPr>`;
    return`<w:r>${style}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
  }).join("")||"<w:r><w:t/></w:r>";
}

/** Emit real editable Word paragraphs, headings, lists, and text runs. */
export function createWordDocument(markdown:string,options:{title?:string;language?:string;direction?:"ltr"|"rtl"}&OfficeLocalization={}):Uint8Array{
  const title=options.title?.trim()||options.translate?.("Forma document")||"Forma document";
  const locale=language(options.language),rtl=options.direction==="rtl",japanese=/^ja(?:-|$)/i.test(locale);
  const paragraphs:string[]=[];
  if(!/^#\s+/.test(markdown.trimStart()))paragraphs.push(`<w:p><w:pPr><w:pStyle w:val="Title"/>${rtl?"<w:bidi/>":""}</w:pPr>${wordRuns(title,locale,rtl)}</w:p>`);
  for(const raw of markdown.replace(/\r\n?/g,"\n").split("\n")){
    const heading=raw.match(/^\s*(#{1,3})\s+(.+)$/),bullet=raw.match(/^\s*[-*+]\s+(.+)$/),ordered=raw.match(/^\s*\d+[.)]\s+(.+)$/),quote=raw.match(/^\s*>\s?(.*)$/);
    const value=heading?.[2]??bullet?.[1]??ordered?.[1]??quote?.[1]??raw;
    const style=heading?`<w:pStyle w:val="Heading${heading[1]!.length}"/>`:bullet||ordered?`<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${ordered?2:1}"/></w:numPr>`:quote?'<w:pStyle w:val="Quote"/>':"";
    const properties=`${style}${rtl?"<w:bidi/>":""}`;
    paragraphs.push(`<w:p>${properties?`<w:pPr>${properties}</w:pPr>`:""}${wordRuns(value,locale,rtl)}</w:p>`);
  }
  const document=`${XML}<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${paragraphs.join("")}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"/></w:sectPr></w:body></w:document>`;
  const styles=`${XML}<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos"${japanese?' w:eastAsia="Yu Gothic"':""}/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="140"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="56"/></w:rPr></w:style>${[1,2,3].map((level)=>`<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="${40-level*4}"/></w:rPr></w:style>`).join("")}<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="480"/></w:pPr><w:rPr><w:i/></w:rPr></w:style></w:styles>`;
  const numbering=`${XML}<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`;
  return createOfficeArchive([
    {name:"[Content_Types].xml",content:baseTypes([override("word/document.xml","application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"),override("word/styles.xml","application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"),override("word/numbering.xml","application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml")])},
    {name:"_rels/.rels",content:rootRelationships("word/document.xml")},
    {name:"docProps/core.xml",content:coreProperties(title)},{name:"docProps/app.xml",content:appProperties()},
    {name:"word/document.xml",content:document},{name:"word/styles.xml",content:styles},{name:"word/numbering.xml",content:numbering},
    {name:"word/_rels/document.xml.rels",content:relationships([relationship("rId1","styles","styles.xml"),relationship("rId2","numbering","numbering.xml")])},
  ]);
}

const group='<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
const colorMap='<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>';
type ShapeOptions={fill?:string;stroke?:string;lineWidth?:number;geometry?:"rect"|"roundRect"|"ellipse";align?:"l"|"ctr"|"r";anchor?:"t"|"ctr";inset?:number;description?:string};
type SlideBox={x:number;y:number;width:number;height:number};
type SlideColors={background:string;foreground:string;accent:string;accentInk:string;muted:string;surface:string;surfaceInk:string};

function localizedOfficeName(source:string,localization:OfficeLocalization){
  const indexed=source.match(/^(.+?)\s+(\d+)$/u);
  if(indexed){const translated=localization.translate?.(indexed[1])??indexed[1];return`${translated} ${localization.number?.(Number(indexed[2]))??indexed[2]}`;}
  return localization.translate?.(source)??source;
}

function localizedOfficeDescription(source:string,localization:OfficeLocalization){
  if(source.startsWith("Score category: "))return`${localization.translate?.("Score category")??"Score category"}: ${source.slice("Score category: ".length)}`;
  const milestone=source.match(/^Milestone (\d+): (.*)$/u);
  if(milestone)return`${localization.translate?.("Milestone")??"Milestone"} ${localization.number?.(Number(milestone[1]))??milestone[1]}: ${milestone[2]}`;
  return["Stakeholder quotation card","Complete verbatim stakeholder quotation","Stakeholder speaker and role","Section divider","Authorized source citation and evidence excerpt"].includes(source)?localization.translate?.(source)??source:source;
}

function shape(id:number,name:string,text:string,x:number,y:number,cx:number,cy:number,foreground:string,size:number,bold=false,locale="en-US",rtl=false,options:ShapeOptions={},localization:OfficeLocalization={}){
  size=Math.max(1200,size);
  const alignment=rtl?"r":options.align;
  const japanese=/^ja(?:-|$)/i.test(locale);
  const visibleSize=text.trim()?Math.max(1200,size):size;
  const paragraphs=text.split(/\r?\n/).map((line)=>`<a:p><a:pPr${rtl?' rtl="1"':""}${alignment?` algn="${alignment}"`:""}/><a:r><a:rPr lang="${locale}" sz="${visibleSize}"${bold?' b="1"':""}><a:solidFill><a:srgbClr val="${foreground}"/></a:solidFill><a:latin typeface="${escapeXml(localization.fontFamily??(bold&&visibleSize>=2800?"Aptos Display":"Aptos"))}"/>${japanese?'<a:ea typeface="Yu Gothic"/>':""}</a:rPr><a:t>${escapeXml(line)}</a:t></a:r><a:endParaRPr lang="${locale}" sz="${visibleSize}"/></a:p>`).join("")||`<a:p><a:endParaRPr lang="${locale}"/></a:p>`;
  const fill=options.fill?`<a:solidFill><a:srgbClr val="${options.fill}"/></a:solidFill>`:"<a:noFill/>";
  const line=options.stroke?`<a:ln w="${options.lineWidth??12700}"><a:solidFill><a:srgbClr val="${options.stroke}"/></a:solidFill></a:ln>`:options.fill?"<a:ln><a:noFill/></a:ln>":"";
  const inset=options.inset??0;
  return`<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${escapeXml(localizedOfficeName(name,localization))}"${options.description?` descr="${escapeXml(localizedOfficeDescription(options.description,localization))}"`:""}/><p:cNvSpPr${options.fill||options.geometry?'':' txBox="1"'}/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${Math.round(x)}" y="${Math.round(y)}"/><a:ext cx="${Math.max(1,Math.round(cx))}" cy="${Math.max(1,Math.round(cy))}"/></a:xfrm><a:prstGeom prst="${options.geometry??"rect"}"><a:avLst/></a:prstGeom>${fill}${line}</p:spPr><p:txBody><a:bodyPr wrap="square" anchor="${options.anchor??"t"}" lIns="${inset}" tIns="${inset}" rIns="${inset}" bIns="${inset}"><a:spAutoFit/></a:bodyPr><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`;
}

function connector(id:number,name:string,x1:number,y1:number,x2:number,y2:number,stroke:string,localization:OfficeLocalization={}){
  const flip=`${x2<x1?' flipH="1"':""}${y2<y1?' flipV="1"':""}`;
  return`<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${id}" name="${escapeXml(localizedOfficeName(name,localization))}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr><a:xfrm${flip}><a:off x="${Math.round(Math.min(x1,x2))}" y="${Math.round(Math.min(y1,y2))}"/><a:ext cx="${Math.max(1,Math.round(Math.abs(x2-x1)))}" cy="${Math.max(1,Math.round(Math.abs(y2-y1)))}"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="19050"><a:solidFill><a:srgbClr val="${stroke}"/></a:solidFill></a:ln></p:spPr></p:cxnSp>`;
}

const relativeLuminance=(hex:string)=>[0,2,4].map((offset)=>Number.parseInt(hex.slice(offset,offset+2),16)/255).map((channel)=>channel<=.04045?channel/12.92:((channel+.055)/1.055)**2.4).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index]!,0);
const contrastRatio=(first:string,second:string)=>{const left=relativeLuminance(first),right=relativeLuminance(second);return(Math.max(left,right)+.05)/(Math.min(left,right)+.05);};
const readableInk=(background:string,preferred:string,minimum=4.5)=>contrastRatio(background,preferred)>=minimum?preferred:contrastRatio(background,"111827")>=contrastRatio(background,"FFFFFF")?"111827":"FFFFFF";
const unitValue=(value:string,unit:string)=>formatPresentationQuantity(value,unit,{numericOnly:true});
const opaqueSourceReference=(value:string)=>/^(?:(?:blk|grp|clm|source|decision)(?:_|-)\d+|context_group_\d+|[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12})$/i.test(value.trim());
const publicSourceLabel=(value:string,fallback="")=>opaqueSourceReference(value)?fallback:value;

function addVisualShapes(shapes:string[],nextId:()=>number,slide:SlideVisualData,box:SlideBox,colors:SlideColors,locale:string,rtl:boolean,localization:OfficeLocalization){
  const visual=slide.visual,kind=String(visual.kind),layout=String(slide.layout),data=visual.data??[],unit=String(visual.unit??"").trim();
  const qualitativeScorecard=(kind==="scorecard"||kind==="bars"||layout==="scorecard")&&!visual.exactValue&&!visual.displayValue&&!/(?:\/\s*100|%)/u.test(unit)&&data.length>=2&&data.every((datum)=>/\p{L}/u.test(String(datum.exactValue??datum.displayValue??datum.value??"")));
  if(qualitativeScorecard){addVisualShapes(shapes,nextId,{...slide,layout:"comparison",visual:{...visual,kind:"comparison"}},box,colors,locale,rtl,localization);return;}
  if(slide.quote?.text&&kind!=="quote"&&layout!=="quote"&&(data.length||visual.value||visual.exactValue||visual.displayValue)){
    const quoteHeight=Math.min(Math.max(650000,box.height-380000),Math.max(860000,Math.min(1450000,Math.round(box.height*.42))));
    const quoteSlide:SlideVisualData={...slide,layout:"quote",visual:{...visual,kind:"quote",value:"",data:[],exactValue:undefined,displayValue:undefined}};
    addVisualShapes(shapes,nextId,quoteSlide,{...box,height:quoteHeight},colors,locale,rtl,localization);
    addVisualShapes(shapes,nextId,{...slide,quote:undefined},{...box,y:box.y+quoteHeight+115000,height:Math.max(240000,box.height-quoteHeight-115000)},colors,locale,rtl,localization);
    return;
  }
  const add=(name:string,text:string,x:number,y:number,width:number,height:number,ink=colors.foreground,size=1400,bold=false,options:ShapeOptions={})=>shapes.push(shape(nextId(),name,text,x,y,width,height,ink,size,bold,locale,rtl,options,localization));
  const summary=[] as Array<{kind:"exact"|"displayed";label:string;value:string}>;
  const showNumericPrecision=kind!=="roadmap"&&kind!=="timeline"&&layout!=="roadmap"&&layout!=="timeline";
  if(showNumericPrecision&&visual.exactValue)summary.push({kind:"exact",label:localization.translate?.("Exact value")??"Exact value",value:String(visual.exactValue)});
  if(showNumericPrecision&&visual.displayValue)summary.push({kind:"displayed",label:localization.translate?.("Rounded display")??"Rounded display",value:String(visual.displayValue)});
  if(summary.length){
    const column=Math.floor(box.width/Math.max(summary.length,1));
    summary.forEach((entry,index)=>{
      const x=box.x+index*column,hasSeparateUnit=Boolean(unit)&&unitValue(entry.value,unit)!==entry.value;
      const valueWidth=hasSeparateUnit?Math.min(column-420000,Math.max(950000,Math.ceil(entry.value.length*220000))):column-120000;
      add(`Editable ${entry.kind} value label`,entry.label,x,box.y,column-120000,195000,colors.muted,1150);
      add(`Editable ${entry.kind} value`,entry.value,x,box.y+210000,valueWidth,350000,colors.accentInk,1900,true);
      if(hasSeparateUnit)add(`Editable ${entry.kind} value unit`,unit,x+valueWidth+40000,box.y+275000,Math.max(200000,column-valueWidth-150000),200000,colors.muted,1250);
    });
    box={...box,y:box.y+630000,height:Math.max(300000,box.height-630000)};
  }

  if(slide.quote?.text||kind==="quote"||layout==="quote"){
    const quotation=slide.quote?.text||visual.value;
    if(!quotation)return;
    add("Editable quotation card","",box.x,box.y,box.width,box.height,colors.surfaceInk,1200,false,{fill:colors.surface,geometry:"roundRect",description:"Stakeholder quotation card"});
    add("Editable quotation accent","",box.x+175000,box.y+180000,42000,Math.max(150000,box.height-360000),colors.accent,1200,false,{fill:colors.accent});
    const attribution=[slide.quote?.speaker,slide.quote?.role].filter((value,index,values)=>value&&values.indexOf(value)===index).join(" · ");
    const quotationHeight=Math.max(320000,box.height-(attribution?800000:400000));
    add("Editable quotation",quotation,box.x+365000,box.y+230000,box.width-625000,quotationHeight,colors.surfaceInk,box.height<1150000?1550:quotation.length>220?1900:2400,true,{description:"Complete verbatim stakeholder quotation"});
    if(attribution)add("Editable quotation attribution",`— ${attribution}`,box.x+380000,box.y+box.height-430000,box.width-650000,250000,readableInk(colors.surface,colors.accent),1450,true,{description:"Stakeholder speaker and role"});
    return;
  }

  if(kind==="bars"||kind==="scorecard"||layout==="scorecard"){
    if(visual.label)add("Editable scorecard heading",visual.label,box.x,box.y,box.width,250000,colors.accentInk,1450,true);
    const top=box.y+(visual.label?340000:0),height=Math.max(200000,box.height-(visual.label?340000:0));
    const includesExactNote=data.some((datum)=>datum.exactValue&&datum.displayValue&&datum.exactValue!==datum.displayValue);
    const minimumRowHeight=includesExactNote?430000:265000,maxRows=Math.max(1,Math.min(8,Math.floor(height/minimumRowHeight)));
    const columns=Math.max(1,Math.ceil(data.length/maxRows)),rows=Math.max(1,Math.ceil(data.length/columns)),gap=200000,columnWidth=Math.max(260000,Math.floor((box.width-gap*(columns-1))/columns)),rowHeight=Math.max(minimumRowHeight,Math.floor(height/rows));
    data.forEach((datum,index)=>{
      const column=Math.floor(index/rows),row=index%rows,x=box.x+column*(columnWidth+gap),y=top+row*rowHeight;
      const value=unitValue(datum.displayValue||datum.value||datum.exactValue||"",unit),valueWidth=Math.min(1350000,Math.max(550000,Math.floor(columnWidth*.26))),labelWidth=Math.max(160000,columnWidth-valueWidth-50000);
      const labelHeight=195000,trackY=y+labelHeight+18000,trackHeight=Math.max(34000,Math.min(65000,rowHeight-labelHeight-36000-(includesExactNote?155000:0)));
      add(`Editable score label ${index+1}`,datum.label,x,y,labelWidth,labelHeight,colors.foreground,1350,false,{description:`Score category: ${datum.label}`});
      add(`Editable score value ${index+1}`,value,x+labelWidth+50000,y,valueWidth,labelHeight,colors.foreground,1400,true,{align:"r",description:`${datum.label}: ${value}`});
      add(`Editable score track ${index+1}`,"",x,trackY,columnWidth,trackHeight,colors.surfaceInk,1100,false,{fill:colors.surface,geometry:"roundRect"});
      const ratio=authoritativeSlideDatumWeight(visual,datum);
      add(`Editable score bar ${index+1}`,"",x,trackY,Math.max(trackHeight,Math.round(columnWidth*ratio)),trackHeight,colors.accent,1100,false,{fill:colors.accent,geometry:"roundRect",description:`${datum.label}: ${value}`});
      if(datum.exactValue&&datum.displayValue&&datum.exactValue!==datum.displayValue)add(`Editable score exact value ${index+1}`,`${localization.translate?.("Exact")??"Exact"}: ${datum.exactValue}`,x,trackY+trackHeight+12000,columnWidth,Math.max(155000,rowHeight-(trackY-y)-trackHeight-18000),colors.muted,1100);
    });
    return;
  }

  if(kind==="matrix"||layout==="matrix"){
    const groups=Math.max(1,Math.ceil(data.length/10)),rows=Math.max(1,Math.ceil(data.length/groups)),groupGap=180000,groupWidth=Math.floor((box.width-groupGap*(groups-1))/groups),rowHeight=Math.max(135000,Math.floor(box.height/(rows+1))),firstWidth=Math.floor(groupWidth*.48);
    for(let groupIndex=0;groupIndex<groups;groupIndex+=1){
      const x=box.x+groupIndex*(groupWidth+groupGap);
      add(`Editable matrix category header ${groupIndex+1}`,visual.label||localization.translate?.("Category")||"Category",x,box.y,firstWidth,rowHeight,colors.surfaceInk,1250,true,{fill:colors.surface,inset:50000,anchor:"ctr"});
      add(`Editable matrix value header ${groupIndex+1}`,visual.value||localization.translate?.("Assessment")||"Assessment",x+firstWidth,box.y,groupWidth-firstWidth,rowHeight,colors.surfaceInk,1250,true,{fill:colors.surface,inset:50000,anchor:"ctr"});
    }
    data.forEach((datum,index)=>{const column=Math.floor(index/rows),row=index%rows,x=box.x+column*(groupWidth+groupGap),y=box.y+(row+1)*rowHeight,value=unitValue(datum.displayValue||datum.value||datum.exactValue||"",unit);add(`Editable matrix label ${index+1}`,datum.label,x,y,firstWidth,rowHeight,colors.foreground,1200,false,{stroke:colors.surface,lineWidth:6350,inset:46000,anchor:"ctr"});add(`Editable matrix value ${index+1}`,value,x+firstWidth,y,groupWidth-firstWidth,rowHeight,colors.foreground,1200,false,{stroke:colors.surface,lineWidth:6350,inset:46000,anchor:"ctr",description:`${datum.label}: ${value}`});});
    return;
  }

  if(kind==="comparison"||kind==="personas"||layout==="comparison"||layout==="personas"||layout==="columns"){
    if(visual.label){add("Editable comparison heading",visual.label,box.x,box.y,box.width,205000,colors.accentInk,1450,true);box={...box,y:box.y+265000,height:Math.max(230000,box.height-265000)};}
    const columns=Math.max(1,Math.min(data.length||1,data.length>6?4:3)),rows=Math.max(1,Math.ceil(data.length/columns)),gap=160000,width=Math.max(180000,Math.floor((box.width-gap*(columns-1))/columns)),height=Math.max(180000,Math.floor((box.height-gap*(rows-1))/rows));
    data.forEach((datum,index)=>{const x=box.x+(index%columns)*(width+gap),y=box.y+Math.floor(index/columns)*(height+gap),value=unitValue(datum.displayValue||datum.value||datum.exactValue||"",unit);add(`Editable comparison card ${index+1}`,"",x,y,width,height,colors.surfaceInk,1100,false,{fill:colors.surface,geometry:"roundRect",description:`${datum.label}: ${value}`});add(`Editable comparison label ${index+1}`,datum.label,x+120000,y+105000,width-240000,Math.min(380000,Math.floor(height*.36)),colors.surfaceInk,1450,true);if(value)add(`Editable comparison value ${index+1}`,value,x+120000,y+Math.min(465000,Math.floor(height*.43)),width-240000,Math.max(110000,height-Math.min(465000,Math.floor(height*.43))-105000),colors.surfaceInk,1300);});
    if(!data.length&&visual.value)add("Editable comparison summary",visual.value,box.x,box.y,box.width,box.height,colors.foreground,1850,true);
    return;
  }

  if(kind==="timeline"||kind==="roadmap"||layout==="timeline"||layout==="roadmap"){
    const duration=unitValue(String(visual.displayValue??visual.exactValue??visual.value??""),unit);
    if(duration){add("Editable roadmap duration",duration,box.x,box.y,box.width,190000,colors.accentInk,1350,true);box={...box,y:box.y+240000,height:Math.max(230000,box.height-240000)};}
    const columns=Math.max(1,Math.min(data.length||1,4)),rows=Math.max(1,Math.ceil(data.length/columns)),columnWidth=Math.floor(box.width/columns),rowHeight=Math.floor(box.height/rows),marker=120000;
    data.forEach((datum,index)=>{const column=index%columns,row=Math.floor(index/columns),x=box.x+column*columnWidth+24000,y=box.y+row*rowHeight+60000,centerX=x+marker/2,centerY=y+marker/2;if(column<columns-1&&index+1<data.length)shapes.push(connector(nextId(),`Editable timeline connector ${index+1}`,centerX+marker/2,centerY,box.x+(column+1)*columnWidth+24000,centerY,colors.accent,localization));add(`Editable timeline milestone ${index+1}`,"",x,y,marker,marker,colors.accent,1100,false,{fill:colors.accent,geometry:"ellipse",description:`Milestone ${index+1}: ${datum.label}`});add(`Editable timeline label ${index+1}`,datum.label,x,y+marker+95000,columnWidth-100000,Math.min(390000,Math.floor(rowHeight*.32)),colors.foreground,1350,true);const value=unitValue(datum.displayValue||datum.value||datum.exactValue||"",unit);if(value)add(`Editable timeline value ${index+1}`,value,x,y+marker+Math.min(505000,Math.floor(rowHeight*.48)),columnWidth-100000,Math.max(130000,rowHeight-marker-Math.min(565000,Math.floor(rowHeight*.55))),colors.muted,1250);});
    return;
  }

  if(kind==="diagram"||kind==="architecture"||layout==="architecture"){
    if(visual.value){add("Editable diagram summary",visual.value,box.x,box.y,box.width,185000,colors.muted,1200);box={...box,y:box.y+235000,height:Math.max(240000,box.height-235000)};}
    const columns=Math.max(1,Math.min(data.length||1,data.length>4?3:2)),rows=Math.max(1,Math.ceil(data.length/columns)),gapX=300000,gapY=220000,width=Math.max(190000,Math.floor((box.width-gapX*(columns-1))/columns)),height=Math.max(160000,Math.floor((box.height-gapY*(rows-1))/rows));
    data.forEach((datum,index)=>{const column=index%columns,row=Math.floor(index/columns),x=box.x+column*(width+gapX),y=box.y+row*(height+gapY),value=unitValue(datum.displayValue||datum.value||datum.exactValue||"",unit);if(column>0)shapes.push(connector(nextId(),`Editable diagram connector ${index}`,x-gapX,y+height/2,x,y+height/2,colors.accent,localization));else if(row>0)shapes.push(connector(nextId(),`Editable diagram connector ${index}`,x+width/2,y-gapY,x+width/2,y,colors.accent,localization));add(`Editable diagram node ${index+1}`,"",x,y,width,height,colors.surfaceInk,1100,false,{fill:colors.surface,stroke:colors.accent,lineWidth:12000,geometry:"roundRect",description:[datum.label,value].filter(Boolean).join(": ")});const labelTop=y+Math.min(65000,Math.max(0,height-340000)),labelHeight=Math.max(180000,Math.min(Math.floor(height*.35),height-160000));add(`Editable diagram label ${index+1}`,datum.label,x+95000,labelTop,width-190000,labelHeight,colors.surfaceInk,1400,true);if(value){const valueTop=Math.max(labelTop+labelHeight+12000,y+Math.floor(height*.56));add(`Editable diagram value ${index+1}`,value,x+95000,valueTop,width-190000,Math.max(155000,height-(valueTop-y)-15000),colors.surfaceInk,1200);}});
    return;
  }

  if(kind==="color-field"&&data.length){
    const gap=130000,width=Math.max(120000,Math.floor((box.width-gap*(data.length-1))/data.length));
    data.forEach((datum,index)=>{const x=box.x+index*(width+gap),fill=color(datum.value,colors.accent);add(`Editable color swatch ${index+1}`,"",x,box.y,width,Math.max(160000,box.height-670000),fill,1100,false,{fill,geometry:"roundRect",description:`${datum.label}: ${datum.value}`});add(`Editable color label ${index+1}`,datum.label,x,box.y+Math.max(170000,box.height-600000),width,270000,colors.foreground,1250,true);if(datum.value)add(`Editable color value ${index+1}`,datum.value,x,box.y+Math.max(390000,box.height-330000),width,230000,colors.muted,1150);});
    return;
  }

  if(visual.label)add("Editable visual label",visual.label,box.x,box.y,box.width,300000,colors.accentInk,1350,true);
  if(visual.value)add("Editable visual value",unitValue(visual.value,unit),box.x,box.y+(visual.label?420000:0),box.width,Math.max(300000,box.height-(visual.label?420000:0)),colors.foreground,kind==="metric"?2850:2200,true);
  data.forEach((datum,index)=>{const y=box.y+Math.floor((index+1)*box.height/(data.length+1));add(`Editable visual datum label ${index+1}`,datum.label,box.x,y,Math.floor(box.width*.6),230000,colors.foreground,1200);if(datum.value)add(`Editable visual datum value ${index+1}`,datum.value,box.x+Math.floor(box.width*.62),y,Math.floor(box.width*.38),230000,colors.foreground,1200,true);});
}
const themeXml=(accent:string,locale="en-US",fontFamily?:string)=>`${XML}<a:theme xmlns:a="${A}" name="Forma"><a:themeElements><a:clrScheme name="Forma"><a:dk1><a:sysClr val="windowText" lastClr="111827"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="273449"/></a:dk2><a:lt2><a:srgbClr val="F4F5F7"/></a:lt2><a:accent1><a:srgbClr val="${accent}"/></a:accent1>${["10B981","F59E0B","EF4444","8B5CF6","06B6D4"].map((shade,index)=>`<a:accent${index+2}><a:srgbClr val="${shade}"/></a:accent${index+2}>`).join("")}<a:hlink><a:srgbClr val="2563EB"/></a:hlink><a:folHlink><a:srgbClr val="7C3AED"/></a:folHlink></a:clrScheme><a:fontScheme name="Forma"><a:majorFont><a:latin typeface="${escapeXml(fontFamily??"Aptos Display")}"/><a:ea typeface="${/^ja(?:-|$)/i.test(locale)?"Yu Gothic":""}"/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="${escapeXml(fontFamily??"Aptos")}"/><a:ea typeface="${/^ja(?:-|$)/i.test(locale)?"Yu Gothic":""}"/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Forma"><a:fillStyleLst>${'<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'.repeat(3)}</a:fillStyleLst><a:lnStyleLst>${'<a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>'.repeat(3)}</a:lnStyleLst><a:effectStyleLst>${"<a:effectStyle><a:effectLst/></a:effectStyle>".repeat(3)}</a:effectStyleLst><a:bgFillStyleLst>${'<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'.repeat(3)}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;

/** Emit audience-safe editable widescreen slides; presenter notes require explicit authorization. */
export function createPowerPointDocument(items:DocumentArtifactDraftItem[],presentation:SlidePresentation,options:{title?:string;showFooterLabel?:boolean;language?:string;direction?:"ltr"|"rtl";includePresenterNotes?:boolean}&OfficeLocalization={}):Uint8Array{
  if(!items.length||items.length>100)throw new Error("invalid_presentation_slide_count");
  const includePresenterNotes=options.includePresenterNotes===true;
  const audienceItems=items.map((item)=>presentationAudienceItem(item,{includePresenterNotes}));
  const requestedFont=String(presentation.fontFamily??"").trim();
  const localization:OfficeLocalization={translate:options.translate,number:options.number,...(/^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,69}$/u.test(requestedFont)?{fontFamily:requestedFont}:{})};
  const translated=(source:string)=>localization.translate?.(source)??source;
  const title=options.title?.trim()||presentation.theme||translated("Forma presentation");
  const background=color(presentation.palette.background,"FFFFFF"),foreground=readableInk(background,color(presentation.palette.foreground,"111827")),accent=color(presentation.palette.accent,"2563EB"),muted=readableInk(background,color(presentation.palette.muted,"667085")),surface=color(presentation.palette.surface,"F4F5F7"),locale=language(options.language),rtl=options.direction==="rtl";
  const colors:SlideColors={background,foreground,accent,accentInk:readableInk(background,accent),muted,surface,surfaceInk:readableInk(surface,foreground)};
  const contentTypes=[override("ppt/presentation.xml","application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"),override("ppt/slideMasters/slideMaster1.xml","application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"),override("ppt/slideLayouts/slideLayout1.xml","application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"),override("ppt/notesMasters/notesMaster1.xml","application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"),override("ppt/theme/theme1.xml","application/vnd.openxmlformats-officedocument.theme+xml")];
  for(let index=0;index<items.length;index+=1){contentTypes.push(override(`ppt/slides/slide${index+1}.xml`,"application/vnd.openxmlformats-officedocument.presentationml.slide+xml"));contentTypes.push(override(`ppt/notesSlides/notesSlide${index+1}.xml`,"application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"));}
  const deck=`${XML}<p:presentation xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:notesMasterIdLst><p:notesMasterId r:id="rId2"/></p:notesMasterIdLst><p:sldIdLst>${items.map((_,index)=>`<p:sldId id="${256+index}" r:id="rId${index+3}"/>`).join("")}</p:sldIdLst><p:sldSz cx="${POWERPOINT_SLIDE_WIDTH}" cy="${POWERPOINT_SLIDE_HEIGHT}" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle/></p:presentation>`;
  const deckRels=[relationship("rId1","slideMaster","slideMasters/slideMaster1.xml"),relationship("rId2","notesMaster","notesMasters/notesMaster1.xml"),...items.map((_,index)=>relationship(`rId${index+3}`,"slide",`slides/slide${index+1}.xml`))];
  const master=`${XML}<p:sldMaster xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}"><p:cSld name="${escapeXml(translated("Forma master"))}"><p:spTree>${group}</p:spTree></p:cSld>${colorMap}<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`;
  const layout=`${XML}<p:sldLayout xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}" type="blank" preserve="1"><p:cSld name="${escapeXml(translated("Forma editable layout"))}"><p:spTree>${group}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
  const notesMaster=`${XML}<p:notesMaster xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}"><p:cSld><p:spTree>${group}</p:spTree></p:cSld>${colorMap}<p:notesStyle/></p:notesMaster>`;
  const entries=[
    {name:"[Content_Types].xml",content:baseTypes(contentTypes)},{name:"_rels/.rels",content:rootRelationships("ppt/presentation.xml")},
    {name:"docProps/core.xml",content:coreProperties(title)},{name:"docProps/app.xml",content:appProperties(true)},
    {name:"ppt/presentation.xml",content:deck},{name:"ppt/_rels/presentation.xml.rels",content:relationships(deckRels)},
    {name:"ppt/slideMasters/slideMaster1.xml",content:master},{name:"ppt/slideMasters/_rels/slideMaster1.xml.rels",content:relationships([relationship("rId1","slideLayout","../slideLayouts/slideLayout1.xml"),relationship("rId2","theme","../theme/theme1.xml")])},
    {name:"ppt/slideLayouts/slideLayout1.xml",content:layout},{name:"ppt/slideLayouts/_rels/slideLayout1.xml.rels",content:relationships([relationship("rId1","slideMaster","../slideMasters/slideMaster1.xml")])},
    {name:"ppt/notesMasters/notesMaster1.xml",content:notesMaster},{name:"ppt/notesMasters/_rels/notesMaster1.xml.rels",content:relationships([relationship("rId1","theme","../theme/theme1.xml")])},
    {name:"ppt/theme/theme1.xml",content:themeXml(accent,locale,localization.fontFamily)},
  ];
  audienceItems.forEach((item,index)=>{
    const slide=item.slide,bulletLines=slide?.bullets?.map((line)=>`• ${line}`)??[],layoutName=String(slide?.layout??"split"),kind=String(slide?.visual?.kind??"");
    const sourceEntries=(slide?.citations??[]).map((citation)=>({visible:[publicSourceLabel(citation.label,translated("Authored source")),localizedSourceAnchor(publicSourceLabel(citation.anchor),localization.translate,localization.number)].filter(Boolean).join(" · "),excerpt:""})).filter((citation)=>citation.visible);
    const quoteCitation=slide?.quote?.citation?publicSourceLabel(slide.quote.citation,translated("Authored source")):"";
    if(quoteCitation&&!sourceEntries.some((citation)=>citation.visible===quoteCitation))sourceEntries.push({visible:quoteCitation,excerpt:""});
    const citationColumns=sourceEntries.length>3?2:1,citationRows=Math.ceil(sourceEntries.length/citationColumns),longestCitation=sourceEntries.reduce((length,citation)=>Math.max(length,citation.visible.length),0),citationRowHeight=Math.min(480000,185000*Math.max(1,Math.ceil(longestCitation/(citationColumns>1?58:118)))),citationHeight=citationRows*citationRowHeight,citationBottom=6230000,citationTop=citationBottom-citationHeight;
    const hasVisual=Boolean(slide&&(slide.quote?.text||slide.visual.value||slide.visual.data.length||slide.visual.exactValue||slide.visual.displayValue));
    const richVisual=hasVisual&&(["quote","scorecard","comparison","matrix","architecture","personas","roadmap","timeline","columns"].includes(layoutName)||["quote","bars","scorecard","comparison","matrix","architecture","personas","roadmap","timeline","diagram"].includes(kind));
    const cover=(layoutName==="cover"||layoutName==="closing")&&!richVisual;
    let id=2;
    const nextId=()=>id++,chapter=[slide?.section,slide?.kicker].filter((value,ordinal,values)=>value&&values.indexOf(value)===ordinal).join(" · ")||`${translated("Slide")} ${localization.number?.(index+1)??index+1}`;
    const shapes=[
      shape(nextId(),"Chapter label",chapter,790000,475000,9460000,320000,colors.accentInk,1350,true,locale,rtl,{},localization),
      shape(nextId(),"Editable slide number",`${String(index+1).padStart(2,"0")} / ${String(items.length).padStart(2,"0")}`,10470000,480000,950000,280000,muted,1200,false,locale,rtl,{align:"r"},localization),
      shape(nextId(),"Editable section rule","",800000,880000,10580000,16000,accent,1100,false,locale,rtl,{fill:accent,description:"Section divider"},localization),
      shape(nextId(),"Editable slide title",item.title,790000,cover?1210000:1050000,10600000,cover?1540000:1000000,foreground,cover?4200:3200,true,locale,rtl,{},localization),
    ];
    if(richVisual){
      let visualY=2180000;
      if(item.body){shapes.push(shape(nextId(),"Editable slide content",item.body,820000,2050000,10400000,460000,foreground,1700,false,locale,rtl,{},localization));visualY=2610000;}
      if(bulletLines.length){
        const columns=bulletLines.length>=5?2:1,gap=240000,width=Math.floor((10350000-gap*(columns-1))/columns),rows=Math.ceil(bulletLines.length/columns);
        const grouped=Array.from({length:columns},(_,column)=>bulletLines.slice(column*rows,(column+1)*rows));
        const charactersPerLine=Math.max(12,Math.floor(width/(14.5*12700*.56)));
        const wrappedRows=Math.max(...grouped.map((lines)=>lines.reduce((total,line)=>total+Math.max(1,Math.ceil(line.length/charactersPerLine)),0)));
        const bulletHeight=Math.max(205000,wrappedRows*205000);
        grouped.forEach((lines,column)=>{if(lines.length)shapes.push(shape(nextId(),column?`Editable supporting points ${column+1}`:"Editable supporting points",lines.join("\n"),840000+column*(width+gap),visualY,width,bulletHeight,foreground,1450,false,locale,rtl,{},localization));});
        visualY+=bulletHeight+110000;
      }
      addVisualShapes(shapes,nextId,slide!,{x:850000,y:visualY,width:10470000,height:Math.max(250000,(sourceEntries.length?citationTop:6100000)-visualY-110000)},colors,locale,rtl,localization);
    }else{
      const contentWidth=hasVisual?7200000:10400000;
      if(item.body)shapes.push(shape(nextId(),"Editable slide content",item.body,820000,cover?2830000:2400000,contentWidth,bulletLines.length?1180000:1990000,foreground,1900,false,locale,rtl,{},localization));
      if(bulletLines.length)shapes.push(shape(nextId(),"Editable supporting points",bulletLines.join("\n"),850000,item.body?cover?4120000:3710000:2420000,contentWidth,1560000,foreground,1650,false,locale,rtl,{},localization));
      if(hasVisual)addVisualShapes(shapes,nextId,slide!,{x:8500000,y:cover?2940000:2610000,width:2850000,height:Math.max(300000,(sourceEntries.length?citationTop:5930000)-(cover?2940000:2610000))},colors,locale,rtl,localization);
    }
    sourceEntries.forEach((citation,ordinal)=>{const row=Math.floor(ordinal/citationColumns),column=ordinal%citationColumns,width=Math.floor(10450000/citationColumns);shapes.push(shape(nextId(),`Editable evidence citation ${ordinal+1}`,`[${ordinal+1}] ${citation.visible}`,850000+column*width,citationTop+row*citationRowHeight,width-90000,citationRowHeight-10000,muted,1050,false,locale,rtl,{description:"Authorized source citation and evidence excerpt"},localization));});
    if(options.showFooterLabel&&presentation.footerLabel)shapes.push(shape(nextId(),"Editable footer",presentation.footerLabel,820000,6340000,9900000,270000,muted,1100,false,locale,rtl,{},localization));
    for(const part of shapes){
      const box=part.match(/<a:off x="(-?\d+)" y="(-?\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/>/u);
      if(!box)throw new Error("office_archive_slide_geometry_invalid");
      const[x,y,width,height]=box.slice(1).map(Number) as [number,number,number,number];
      if(![x,y,width,height].every(Number.isSafeInteger)||x<0||y<0||width<1||height<1||x+width>POWERPOINT_SLIDE_WIDTH||y+height>POWERPOINT_SLIDE_HEIGHT){
        throw new Error("office_archive_slide_layout_overflow");
      }
    }
    const document=`${XML}<p:sld xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}"><p:cSld name="${escapeXml(item.title||`${translated("Slide")} ${localization.number?.(index+1)??index+1}`)}"><p:bg><p:bgPr><a:solidFill><a:srgbClr val="${background}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>${group}${shapes.join("")}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
    const noteLines=includePresenterNotes?String(item.notes??"").split(/\r?\n/):[];
    if(includePresenterNotes){
      const originalSlide=items[index]?.slide;
      if(slide?.quote?.text&&!noteLines.join("\n").includes(slide.quote.text)){noteLines.push("",`[${translated("Stakeholder quotation")}]`,slide.quote.text);const attribution=[slide.quote.speaker,slide.quote.role].filter((value,ordinal,values)=>value&&values.indexOf(value)===ordinal).join(" · ");if(attribution)noteLines.push(`— ${attribution}`);}
      const presenterSources=(originalSlide?.citations??[]).map((citation)=>({visible:[publicSourceLabel(citation.label,translated("Authored source")),localizedSourceAnchor(publicSourceLabel(citation.anchor),localization.translate,localization.number)].filter(Boolean).join(" · "),excerpt:citation.excerpt})).filter((citation)=>citation.visible||citation.excerpt);
      const originalQuoteCitation=originalSlide?.quote?.citation?publicSourceLabel(originalSlide.quote.citation,translated("Authored source")):"";
      if(originalQuoteCitation&&!presenterSources.some((citation)=>citation.visible===originalQuoteCitation))presenterSources.push({visible:originalQuoteCitation,excerpt:""});
      if(presenterSources.length){const sourceHeading=`[${translated("Sources")}]`;if(!noteLines.some((line)=>line.trim()==="[Sources]"||line.trim()===sourceHeading))noteLines.push("",sourceHeading);presenterSources.forEach((citation)=>{const source=[citation.visible,citation.excerpt&&citation.excerpt!==citation.visible?citation.excerpt:""].filter(Boolean).join(": ");if(!noteLines.some((line)=>line.includes(source)))noteLines.push(`- ${source}`);});}
    }
    const notes=`${XML}<p:notes xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}"><p:cSld><p:spTree>${group}<p:sp><p:nvSpPr><p:cNvPr id="2" name="${escapeXml(translated("Slide image"))}"/><p:cNvSpPr/><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="${escapeXml(translated("Editable speaker notes"))}"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${noteLines.map((line)=>`<a:p><a:pPr${rtl?' rtl="1" algn="r"':""}/><a:r><a:rPr lang="${locale}"/><a:t>${escapeXml(line)}</a:t></a:r></a:p>`).join("")||"<a:p/>"}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`;
    entries.push({name:`ppt/slides/slide${index+1}.xml`,content:document},{name:`ppt/slides/_rels/slide${index+1}.xml.rels`,content:relationships([relationship("rId1","slideLayout","../slideLayouts/slideLayout1.xml"),relationship("rId2","notesSlide",`../notesSlides/notesSlide${index+1}.xml`)])},{name:`ppt/notesSlides/notesSlide${index+1}.xml`,content:notes},{name:`ppt/notesSlides/_rels/notesSlide${index+1}.xml.rels`,content:relationships([relationship("rId1","notesMaster","../notesMasters/notesMaster1.xml"),relationship("rId2","slide",`../slides/slide${index+1}.xml`)])});
  });
  return createOfficeArchive(entries);
}
