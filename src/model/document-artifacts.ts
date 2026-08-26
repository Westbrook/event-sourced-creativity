import type { ImageFocalPoint } from "./focal-point.ts";
import { protectedPresentationScoreContradictions, validatePresentationSourceCoverage, type PresentationSourceContract } from "./presentation-source.ts";

export const DOCUMENT_ARTIFACT_KINDS = ["short_story", "scene", "slides", "storyboard", "video", "audio"] as const;
export type DocumentArtifactKind = typeof DOCUMENT_ARTIFACT_KINDS[number];

export const SLIDE_LAYOUTS = ["cover", "statement", "split", "columns", "metric", "timeline", "closing", "quote", "scorecard", "comparison", "matrix", "architecture", "personas", "roadmap"] as const;
export type SlideLayout = typeof SLIDE_LAYOUTS[number];
export const SLIDE_VISUAL_KINDS = ["hero-type", "metric", "bars", "timeline", "diagram", "color-field", "quote", "scorecard", "comparison", "matrix", "architecture", "personas", "roadmap"] as const;
export type SlideVisualKind = typeof SLIDE_VISUAL_KINDS[number];
export const MAX_SLIDE_VISUAL_DATA_POINTS = 48;

export const SLIDE_STYLE_PRESET_IDS = ["gallery", "editorial", "nocturne", "field-notes"] as const;
export type SlideStylePresetId = typeof SLIDE_STYLE_PRESET_IDS[number];
type SlidePalette = { background: string; foreground: string; accent: string; muted: string; surface: string };
export type SlideStylePreset = {
  id: SlideStylePresetId;
  label: string;
  description: string;
  mode: "light" | "dark";
  palette: SlidePalette;
};

export const SLIDE_STYLE_PRESETS: readonly SlideStylePreset[] = [
  { id:"gallery", label:"Gallery", description:"Warm, quiet, and image-led with generous breathing room.", mode:"light", palette:{background:"#f5f3ee",foreground:"#18201c",accent:"#d66a3d",muted:"#667069",surface:"#ffffff"} },
  { id:"editorial", label:"Editorial", description:"High-contrast hierarchy for arguments, narratives, and pitches.", mode:"light", palette:{background:"#f2efe8",foreground:"#171714",accent:"#b8422f",muted:"#625e56",surface:"#ded8ca"} },
  { id:"nocturne", label:"Nocturne", description:"A cinematic dark treatment for atmospheric and visual work.", mode:"dark", palette:{background:"#121715",foreground:"#f7f5ef",accent:"#e17745",muted:"#aab3ad",surface:"#263029"} },
  { id:"field-notes", label:"Field notes", description:"A cool, structured system for research, evidence, and plans.", mode:"light", palette:{background:"#edf1ef",foreground:"#14211d",accent:"#287260",muted:"#586b64",surface:"#d9e3df"} },
] as const;

export const slideStylePresetDefinition = (id: SlideStylePresetId) => SLIDE_STYLE_PRESETS.find((preset)=>preset.id===id)??SLIDE_STYLE_PRESETS[0]!;
export function isSlideStylePresetId(value: unknown): value is SlideStylePresetId { return SLIDE_STYLE_PRESET_IDS.includes(value as SlideStylePresetId); }

export type SlidePresentation = {
  aspectRatio: "16:9";
  theme: string;
  footerLabel: string;
  fontFamily?: string;
  stylePreset: SlideStylePresetId;
  mode: "light" | "dark";
  palette: SlidePalette;
};

export type SlideCitation = {
  sourceId?: string;
  label: string;
  anchor: string;
  excerpt: string;
};

export type SlideQuote = {
  text: string;
  speaker: string;
  role: string;
  sourceId?: string;
  citation?: string;
};

export type SlideVisualDatum = {
  label: string;
  value: string;
  weight: number;
  exactValue?: string;
  displayValue?: string;
  sourceIds?: string[];
};

export type SlideVisualData = {
  layout: SlideLayout;
  kicker: string;
  bullets: string[];
  quote?: SlideQuote;
  citations?: SlideCitation[];
  sourceIds?: string[];
  section?: string;
  sourceOrder?: number;
  visual: {
    kind: SlideVisualKind;
    label: string;
    value: string;
    exactValue?: string;
    displayValue?: string;
    unit?: string;
    data: SlideVisualDatum[];
  };
};

export type DocumentArtifactDraftItem = { title: string; body: string; notes: string; image_prompt: string; context_group_ids?: string[]; slide: SlideVisualData | null };

export type DocumentArtifactItem = {
  id: string;
  title: string;
  body: string;
  notes: string;
  imagePrompt: string;
  contextGroupIds?: string[];
  mediaUrl: string | null;
  mediaType: string | null;
  sceneId?: string | null;
  narrativeOrder?: number | null;
  generationOrder?: number | null;
  durationSeconds?: number | null;
  width: number | null;
  height: number | null;
  focalPoint: ImageFocalPoint | null;
  slide: SlideVisualData | null;
};

export type DocumentArtifact = {
  id: string;
  documentId: string;
  kind: DocumentArtifactKind;
  title: string;
  titleSource?: "generated" | "authored";
  createdAt?: string;
  summary: string;
  contentRef: string | null;
  inputRef?: string | null;
  itemCount: number;
  items: DocumentArtifactItem[];
  mediaUrl: string | null;
  mediaType: string | null;
  provider: string;
  modelId: string;
  latency: number;
  sequence: number;
  library: boolean;
  sourceEventId: string;
  sourceSurface: string | null;
  settings: Record<string, unknown>;
  presentation: SlidePresentation | null;
};

export type DocumentArtifactDraft = {
  title: string;
  summary: string;
  content_markdown: string;
  presentation: SlidePresentation | null;
  items: DocumentArtifactDraftItem[];
};

export const documentArtifactDefinition = (kind: DocumentArtifactKind) => ({
  short_story: { label: "Short story", description: "A complete narrative shaped by the document’s intent, characters, setting, and constraints." },
  scene: { label: "Scene", description: "A production-readable film or television scene with action and dialogue." },
  slides: { label: "Slides", description: "A concise, presentational sequence with speaker notes and visual direction." },
  storyboard: { label: "Storyboard", description: "A shot-by-shot previz sequence rendered as connected draft frames." },
  video: { label: "Video", description: "A playable motion interpretation rendered by the configured video provider." },
  audio: { label: "Audio", description: "An original, playable soundtrack shaped by the document’s creative direction." },
}[kind]);

export function isDocumentArtifactKind(value: unknown): value is DocumentArtifactKind {
  return DOCUMENT_ARTIFACT_KINDS.includes(value as DocumentArtifactKind);
}

const record = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const contentKey = (value: unknown) => text(value).toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu, " ").trim();
const listText = (value: unknown) => text(value).replace(/^(?:[-*•‣▪◦]|\d+[.)])\s*/, "").trim();
const placeholderText = (value: unknown) => /^(?:point|item|bullet|label|value)(?:\s*(?:#?\d+|[a-z]))?$|^(?:tbd|todo|placeholder|lorem ipsum)$/i.test(contentKey(value));
const COPY_STOP_WORDS = new Set(["a","an","the","and","or","but","of","to","in","on","at","for","with","by","from","as","is","are","was","were","be","been","being","this","that","these","those","it","its","then"]);
const copyTokens = (value: unknown) => contentKey(value).split(" ").filter((token) => token && !COPY_STOP_WORDS.has(token));
const isProseCopy = (value: unknown) => /[\p{L}]/u.test(text(value)) && !/^#[0-9a-f]{3,8}$/i.test(text(value));
const leadingCopySentence = (value: unknown) => {
  const match=/^(.+?)(?:[.!?;:]+(?:\s+|$)|\s+[—–]\s+)/u.exec(text(value));
  if(!match)return null;
  const sentence=contentKey(match[1]);
  return sentence.length>=16&&copyTokens(sentence).length>=3?{sentence,remainder:text(value).slice(match[0].length).trim()}:null;
};
const repeatedCopyLeadIn = (left: unknown, right: unknown) => {
  const first=leadingCopySentence(left),second=leadingCopySentence(right);
  return Boolean(first&&second&&first.sentence===second.sentence||first&&first.sentence===contentKey(right)||second&&second.sentence===contentKey(left));
};
export const slideCopyIsNearDuplicate = (left: unknown, right: unknown) => {
  const leftKey=contentKey(left),rightKey=contentKey(right);if(!leftKey||!rightKey||!isProseCopy(left)||!isProseCopy(right))return false;if(leftKey===rightKey)return true;
  if(repeatedCopyLeadIn(left,right))return true;
  const [shortKey,longKey]=leftKey.length<=rightKey.length?[leftKey,rightKey]:[rightKey,leftKey];if(shortKey.length>=20&&longKey.includes(shortKey))return true;
  const leftTokens=new Set(copyTokens(left)),rightTokens=new Set(copyTokens(right));const smaller=Math.min(leftTokens.size,rightTokens.size),larger=Math.max(leftTokens.size,rightTokens.size);if(smaller<4)return false;
  const shared=[...leftTokens].filter((token)=>rightTokens.has(token)).length;const containment=shared/smaller;const lengthRatio=smaller/Math.max(1,larger);return containment>=.86&&lengthRatio>=.6||smaller>=6&&containment>=.8;
};
const repeatedText = (value: unknown, used: string[]) => used.some((candidate)=>slideCopyIsNearDuplicate(value,candidate));
const distinctText = (value: unknown, used: string[]) => {
  let result=text(value);if(!result||placeholderText(result))return "";
  for(const candidate of used){
    if(!slideCopyIsNearDuplicate(result,candidate))continue;
    const leading=leadingCopySentence(result);
    if(!leading?.remainder||!repeatedCopyLeadIn(result,candidate)||placeholderText(leading.remainder))return "";
    result=leading.remainder;
  }
  if(repeatedText(result,used))return "";
  used.push(result);return result;
};
const uniqueText = (value: unknown): string[] => Array.isArray(value) ? [...new Set(value.map(text).filter(Boolean))] : [];
const color = (value: unknown, fallback: string) => /^#[0-9a-f]{6}$/i.test(text(value)) ? text(value).toLowerCase() : fallback;
const slideLayout = (value: unknown, index = 0): SlideLayout => SLIDE_LAYOUTS.includes(value as SlideLayout) ? value as SlideLayout : index === 0 ? "cover" : "split";
const slideVisualKind = (value: unknown, index = 0): SlideVisualKind => SLIDE_VISUAL_KINDS.includes(value as SlideVisualKind) ? value as SlideVisualKind : SLIDE_VISUAL_KINDS[index % SLIDE_VISUAL_KINDS.length];
const processDerivedSlideLabel = (value: unknown) => /^(?:document[- ]derived editorial|editorial(?: theme)?|generated (?:deck|presentation)|presentation(?: theme)?|slide deck)$/i.test(contentKey(value));

export function normalizeSlidePresentation(value: unknown): SlidePresentation | null {
  const input = record(value); if (!Object.keys(input).length) return null;const requestedPreset=input.stylePreset??input.style_preset;const inferredPreset=input.mode==="dark"?"nocturne":"gallery";const stylePreset=isSlideStylePresetId(requestedPreset)?requestedPreset:inferredPreset;const preset=slideStylePresetDefinition(stylePreset);const palette = record(input.palette);const theme=text(input.theme)||"Document-derived editorial";const requestedFooter=text(input.footerLabel??input.footer_label);const footerCandidate=requestedFooter||theme;const mode=input.mode==="dark"||input.mode==="light"?input.mode:preset.mode;const requestedFont=text(input.fontFamily??input.font_family);const fontFamily=/^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,69}$/u.test(requestedFont)?requestedFont:"";
  return {
    aspectRatio: "16:9",
    theme,
    footerLabel: processDerivedSlideLabel(footerCandidate)?"":footerCandidate,
    ...(fontFamily?{fontFamily}:{}),
    stylePreset,
    mode,
    palette: {
      background: color(palette.background, preset.palette.background),
      foreground: color(palette.foreground, preset.palette.foreground),
      accent: color(palette.accent, preset.palette.accent),
      muted: color(palette.muted, preset.palette.muted),
      surface: color(palette.surface, preset.palette.surface),
    },
  };
}

export function applySlideStylePreset(value: unknown, stylePreset: SlideStylePresetId): SlidePresentation {
  const current=normalizeSlidePresentation(value)??defaultSlidePresentation();const preset=slideStylePresetDefinition(stylePreset);
  return {...current,stylePreset,mode:preset.mode,palette:stylePreset===current.stylePreset?current.palette:{...preset.palette}};
}

const normalizeSlideQuote = (value: unknown): SlideQuote | undefined => {
  const input=record(value),quoteText=text(input.text??input.quote),speaker=text(input.speaker??input.attribution),role=text(input.role??input.speaker_role),sourceId=text(input.sourceId??input.source_id??input.source_key),citation=text(input.citation);
  if(!quoteText)return undefined;
  return{text:quoteText,speaker,role,...(sourceId?{sourceId}:{}),...(citation?{citation}:{})};
};

const normalizeSlideCitation = (value: unknown): SlideCitation | undefined => {
  const input=record(value),sourceId=text(input.sourceId??input.source_id??input.source_key),anchor=text(input.anchor??input.reference),excerpt=text(input.excerpt??input.quote),label=text(input.label??input.source_label??input.title);
  if(!sourceId&&!label&&!anchor&&!excerpt)return undefined;
  return{...(sourceId?{sourceId}:{}),label,anchor,excerpt};
};

const quoteContinuation=(initial:string,continuations:string[])=>continuations.reduce((result,continuation)=>{
  if(!result)return continuation;if(!continuation)return result;
  if(/^[,.;:!?\])}”]/u.test(continuation))return`${result}${continuation}`;
  if(/[,;:—–-]\s*$/u.test(result))return`${result} ${continuation}`;
  const listContinuation=/,\s+(?:and|or)\b/iu.test(continuation)&&/,\s*\p{L}/u.test(result);
  return`${result}${listContinuation?", ":" "}${continuation}`;
},initial).trim();

export function normalizeSlideVisual(value: unknown, item: { title?: unknown; body?: unknown } = {}, index = 0): SlideVisualData {
  const input=record(value),visual=record(input.visual);let rawData=Array.isArray(visual.data)?visual.data:[];
  // Preserve every provider-disclosed reference before malformed visual content is
  // discarded. Validation must still reject a foreign alias hidden in an empty row.
  const rawSourceReferences=(value:unknown)=>{const source=record(value);return[...uniqueText(source.sourceIds),...uniqueText(source.source_ids),text(source.sourceId),text(source.source_id),text(source.source_key)].filter(Boolean);};
  const retainedDatumSourceIds:string[]=[...rawData.flatMap(rawSourceReferences),...rawSourceReferences(input.quote),...(Array.isArray(input.citations)?input.citations:[]).flatMap(rawSourceReferences)];
  let layout=slideLayout(input.layout,index);
  const title=text(item.title),body=text(item.body),used=[title,body].filter(Boolean),bulletSource=Array.isArray(input.bullets)?input.bullets:[],bullets:string[]=[];
  for(const candidate of bulletSource){const bullet=listText(candidate),accepted=distinctText(bullet,used);if(!accepted)continue;bullets.push(accepted);if(bullets.length===24)break;}
  const requestedKicker=text(input.kicker),acceptedKicker=distinctText(requestedKicker,used),kicker=acceptedKicker||(index===0?"Overview":`Chapter ${String(index+1).padStart(2,"0")}`);if(!acceptedKicker)used.push(kicker);
  let quote=normalizeSlideQuote(input.quote);
  const continuations=rawData.filter((datum)=>/^continu(?:ation|ed)$/iu.test(text(record(datum).label)));
  if(!quote&&continuations.length&&text(visual.value)){
    const complete=quoteContinuation(text(visual.value),continuations.map((datum)=>text(record(datum).value)).filter(Boolean));
    const unwrapped=complete.replace(/^[“"]([\s\S]*)[”"]$/u,"$1"),attribution=text(visual.label);
    if(unwrapped&&attribution)quote={text:unwrapped,speaker:attribution,role:attribution};
    if(quote){
      retainedDatumSourceIds.push(...continuations.flatMap((datum)=>uniqueText(record(datum).sourceIds??record(datum).source_ids)));
      rawData=rawData.filter((datum)=>!continuations.includes(datum));
    }
  }
  const citations=(Array.isArray(input.citations)?input.citations:[]).flatMap((entry)=>{const citation=normalizeSlideCitation(entry);return citation?[citation]:[];}),section=text(input.section),requestedSourceOrder=Number(input.sourceOrder??input.source_order),sourceOrder=Number.isSafeInteger(requestedSourceOrder)&&requestedSourceOrder>0?requestedSourceOrder:undefined;
  let kind=quote&&continuations.length?"quote" as SlideVisualKind:slideVisualKind(visual.kind,index);const originalKind=kind;const valueIsVisible=kind==="hero-type"||kind==="metric"||kind==="diagram"||kind==="quote";let visualValue=kind==="quote"&&quote?quote.text:valueIsVisible?distinctText(visual.value,used):placeholderText(visual.value)?"":text(visual.value);const visualLabel=/^(?:visual emphasis|stakeholder perspective)$/iu.test(contentKey(visual.label))?"":distinctText(visual.label,used);const exactValue=text(visual.exactValue??visual.exact_value),displayValue=text(visual.displayValue??visual.display_value),unit=text(visual.unit),data:SlideVisualDatum[]=[];
  for(const datum of rawData){
    const entry=record(datum);let label=text(entry.label),datumValue=text(entry.value)||text(entry.displayValue??entry.display_value)||text(entry.exactValue??entry.exact_value);if(placeholderText(label))label="";if(placeholderText(datumValue))datumValue="";if(!label&&datumValue){label=datumValue;datumValue="";}if(!label)continue;
    const weight=Number(entry.weight),datumExact=text(entry.exactValue??entry.exact_value),datumDisplay=text(entry.displayValue??entry.display_value),sourceIds=[...new Set([...uniqueText(entry.sourceIds),...uniqueText(entry.source_ids)])];
    const candidate={label,value:datumValue,weight:Number.isFinite(weight)?Math.max(0,Math.min(1,weight)):1,...(datumExact?{exactValue:datumExact}:{}),...(datumDisplay?{displayValue:datumDisplay}:{}),...(sourceIds.length?{sourceIds}:{})};
    candidate.weight=authoritativeSlideDatumWeight({kind,unit,value:visualValue},candidate);
    data.push(candidate);
  }
  const quantitativeIntent=Boolean(exactValue||displayValue||/(?:\/\s*100|%)/u.test(unit));
  const qualitativeScorecard=(kind==="scorecard"||kind==="bars")&&!quantitativeIntent&&data.length>=2&&data.every((datum)=>{const value=datum.exactValue??datum.displayValue??datum.value;return/\p{L}/u.test(value)&&preciseNumber(value)===null;});
  if(qualitativeScorecard){kind="comparison";if(layout==="scorecard"||layout==="metric")layout="comparison";}
  // Category-only diagrams have no authored measurements; repeated labels are schema filler, not evidence.
  const categoryKinds:readonly SlideVisualKind[]=["bars","scorecard","comparison","matrix","personas","architecture"];
  const duplicateCategoryRows=data.filter((datum)=>Boolean(datum.value)&&contentKey(datum.value)===contentKey(datum.label));
  const meaningfulCategoryRows=data.filter((datum)=>Boolean(datum.value)&&contentKey(datum.value)!==contentKey(datum.label));
  const quantitativeCategoryEvidence=quantitativeIntent||Boolean(unit)||preciseNumber(visualValue)!==null||data.some((datum)=>Boolean(datum.exactValue||datum.displayValue)||preciseNumber(datum.value)!==null);
  if(categoryKinds.includes(kind)&&layout!=="roadmap"&&layout!=="timeline"&&data.length>=2&&new Set(data.map((datum)=>contentKey(datum.label))).size===data.length&&!quantitativeCategoryEvidence&&duplicateCategoryRows.length>meaningfulCategoryRows.length){
    kind="architecture";layout="architecture";
    for(const datum of duplicateCategoryRows)datum.value="";
  }
  const narrativeKeys=new Set([title,body].map(contentKey).filter(Boolean));
  const narrativeRows=data.filter((datum)=>Boolean(datum.value)&&narrativeKeys.has(contentKey(datum.value)));
  if(["comparison","matrix","personas","architecture"].includes(originalKind)&&data.length>=2&&new Set(data.map((datum)=>contentKey(datum.label))).size===data.length&&!quantitativeCategoryEvidence&&narrativeRows.length>0&&data.every((datum)=>!datum.value||narrativeKeys.has(contentKey(datum.value)))){
    kind="architecture";layout="architecture";
    for(const datum of narrativeRows)datum.value="";
  }
  if(kind==="bars"){const complete=data.filter((datum)=>Boolean(contentKey(datum.value)));data.splice(0,data.length,...complete);}
  if((kind==="bars"||kind==="timeline"||kind==="diagram"||kind==="color-field")&&data.length<2){
    const candidate=data.find((datum)=>Boolean(datum.label)&&!repeatedText(datum.label,used));
    const singular=valueIsVisible?visualValue:distinctText(visualValue,used)||candidate?.label||"";
    if(candidate&&singular===candidate.label)retainedDatumSourceIds.push(...(candidate.sourceIds??[]));
    kind="hero-type";visualValue=singular;data.splice(0,data.length);
  }
  if((kind==="hero-type"||kind==="metric")&&!visualValue){
    const candidate=data.find((datum)=>Boolean(datum.label)&&!repeatedText(datum.label,used));
    visualValue=candidate?.label??"";
    if(candidate)retainedDatumSourceIds.push(...(candidate.sourceIds??[]));
    data.splice(0,data.length);
  }
  const sourceIds=[...new Set([...rawSourceReferences(input),...retainedDatumSourceIds,...(quote?.sourceId?[quote.sourceId]:[]),...citations.flatMap((citation)=>citation.sourceId?[citation.sourceId]:[]),...data.flatMap((datum)=>datum.sourceIds??[])])];
  return{
    layout,kicker,bullets,...(quote?{quote}:{}),...(citations.length?{citations}:{}),...(sourceIds.length?{sourceIds}:{}),...(section?{section}:{}),...(sourceOrder===undefined?{}:{sourceOrder}),
    visual:{kind,label:visualLabel,value:visualValue,...(exactValue?{exactValue}:{}),...(displayValue?{displayValue}:{}),...(unit?{unit}:{}),data},
  };
}

export function normalizeSlideItem(value: unknown,index=0):DocumentArtifactDraftItem {
  const input=record(value);const title=text(input.title);const requestedBody=text(input.body);let body=distinctText(requestedBody,title?[title]:[]);
  const contextGroupIds=Array.isArray(input.context_group_ids)?[...new Set(input.context_group_ids.map(text).filter(Boolean))]:[];
  let slide=input.slide?normalizeSlideVisual(input.slide,{title,body},index):null;
  if(slide&&body&&body.length<=160&&slide.visual.kind==="hero-type"&&!slide.visual.value&&!slide.quote&&!slide.visual.unit&&!slide.visual.exactValue&&!slide.visual.displayValue){
    slide=normalizeSlideVisual({...slide,visual:{...slide.visual,value:body}},{title,body:""},index);
    body="";
  }
  if(slide&&body&&["architecture","diagram"].includes(slide.visual.kind)&&slide.visual.data.length>=2&&!slide.quote&&!slide.visual.unit&&!slide.visual.exactValue&&!slide.visual.displayValue){
    const titleKey=contentKey(title),bodyKey=contentKey(body),narrativeKeys=new Set([titleKey,bodyKey].filter(Boolean));
    const rows=slide.visual.data;
    const narrativeOnly=rows.every((datum)=>narrativeKeys.has(contentKey(datum.label))&&(!datum.value||narrativeKeys.has(contentKey(datum.value)))&&!datum.exactValue&&!datum.displayValue&&preciseNumber(datum.label)===null&&preciseNumber(datum.value)===null);
    if(narrativeOnly&&rows.some((datum)=>contentKey(datum.label)===titleKey)&&rows.some((datum)=>contentKey(datum.label)===bodyKey)){
      const sourceIds=[...new Set([...(slide.sourceIds??[]),...rows.flatMap((datum)=>datum.sourceIds??[])])];
      slide=normalizeSlideVisual({...slide,layout:index===0?"cover":"statement",...(sourceIds.length?{sourceIds}:{}),visual:{kind:"hero-type",label:slide.visual.label,value:body,data:[]}},{title,body:""},index);
      body="";
    }
  }
  return{title,body,notes:text(input.notes),image_prompt:text(input.image_prompt),context_group_ids:contextGroupIds,slide};
}

export type SlideCopyIssue={first:string;second:string;firstPath:string;secondPath:string};
const slideCopyFields=(value:unknown)=>{const item=record(value),slide=record(item.slide),visual=record(slide.visual),quote=record(slide.quote),kind=text(visual.kind);const fields:Array<{path:string;value:string}>=[];const add=(path:string,value:unknown)=>{const copy=text(value);if(copy)fields.push({path,value:copy});};add("title",item.title);add("body",item.body);add("slide.kicker",slide.kicker);if(Array.isArray(slide.bullets))slide.bullets.forEach((bullet,index)=>add(`slide.bullets.${index}`,bullet));add("slide.visual.label",visual.label);if(["hero-type","metric","diagram"].includes(kind))add("slide.visual.value",visual.value);if(quote.text)add("slide.quote.text",quote.text);if(Array.isArray(visual.data))visual.data.forEach((datum,index)=>{const entry=record(datum);add(`slide.visual.data.${index}.label`,entry.label);if(["bars","timeline","scorecard","comparison","matrix","roadmap"].includes(kind))add(`slide.visual.data.${index}.value`,entry.value);});return fields;};
export function slideCopyIssues(value:unknown):SlideCopyIssue[]{
  const fields=slideCopyFields(value),issues:SlideCopyIssue[]=[];
  const visualData=record(record(record(value).slide).visual).data;
  for(let left=0;left<fields.length;left+=1)for(let right=left+1;right<fields.length;right+=1){
    const first=fields[left],second=fields[right];
    if(!first||!second||!slideCopyIsNearDuplicate(first.value,second.value))continue;
    const categoryLabel=first.path==="body"||first.path==="title"?/^slide\.visual\.data\.(\d+)\.label$/u.exec(second.path):null;
    if(categoryLabel&&Array.isArray(visualData)&&visualData.length>=2){
      const label=contentKey(second.value),narrative=contentKey(first.value),labelTokens=copyTokens(second.value);
      if(label.length<=48&&labelTokens.length>=2&&labelTokens.length<=4&&narrative!==label&&(` ${narrative} `).includes(` ${label} `)&&copyTokens(first.value).length>=labelTokens.length+2&&visualData.filter((datum)=>contentKey(record(datum).label)===label).length===1)continue;
    }
    const firstDatum=/^slide\.visual\.data\.(\d+)\.value$/u.exec(first.path),secondDatum=/^slide\.visual\.data\.(\d+)\.value$/u.exec(second.path);
    if(firstDatum&&secondDatum&&firstDatum[1]!==secondDatum[1]&&Array.isArray(visualData)){
      const firstLabel=contentKey(record(visualData[Number(firstDatum[1])]).label),secondLabel=contentKey(record(visualData[Number(secondDatum[1])]).label),firstValue=contentKey(first.value);
      if(firstLabel&&secondLabel&&firstLabel!==secondLabel&&firstValue===contentKey(second.value)&&firstValue.length<=32&&firstValue.split(" ").length<=2)continue;
    }
    issues.push({first:first.value,second:second.value,firstPath:first.path,secondPath:second.path});
  }
  return issues;
}
export const slideCopyIsDistinct=(value:unknown)=>slideCopyIssues(value).length===0;

export type SlideDeckCopyIssue=SlideCopyIssue&{firstSlide:number;secondSlide:number};
const slideNarrativeFields=(value:unknown)=>slideCopyFields(value).filter((field)=>field.path==="title"||field.path==="body"||field.path.startsWith("slide.bullets.")||field.path==="slide.visual.value"||field.path==="slide.quote.text"||field.path.endsWith(".value"));
const crossSlideDuplicate=(left:{path:string;value:string},right:{path:string;value:string})=>{const leftKey=contentKey(left.value),rightKey=contentKey(right.value),exact=leftKey===rightKey;if(exact&&left.path==="title"&&right.path==="title")return true;const shorter=Math.min(leftKey.length,rightKey.length),tokens=Math.min(copyTokens(left.value).length,copyTokens(right.value).length);return exact&&shorter>=12&&tokens>=2||slideCopyIsNearDuplicate(left.value,right.value)&&tokens>=4;};
export function slideDeckCopyIssues(values:unknown[]):SlideDeckCopyIssue[]{
  const slides=values.map(slideNarrativeFields),issues:SlideDeckCopyIssue[]=[];
  for(let firstSlide=0;firstSlide<slides.length;firstSlide+=1)for(let secondSlide=firstSlide+1;secondSlide<slides.length;secondSlide+=1)for(const first of slides[firstSlide]??[])for(const second of slides[secondSlide]??[]){
    if(!crossSlideDuplicate(first,second))continue;
    const firstDatum=/^slide\.visual\.data\.(\d+)\.value$/u.exec(first.path),secondDatum=/^slide\.visual\.data\.(\d+)\.value$/u.exec(second.path);
    if(firstDatum&&secondDatum){
      const firstData=record(record(record(values[firstSlide]).slide).visual).data,secondData=record(record(record(values[secondSlide]).slide).visual).data;
      const firstLabel=Array.isArray(firstData)?contentKey(record(firstData[Number(firstDatum[1])]).label):"",secondLabel=Array.isArray(secondData)?contentKey(record(secondData[Number(secondDatum[1])]).label):"",firstValue=contentKey(first.value);
      if(firstLabel&&secondLabel&&firstLabel!==secondLabel&&firstValue===contentKey(second.value)&&firstValue.length<=32&&firstValue.split(" ").length<=2)continue;
    }
    issues.push({first:first.value,second:second.value,firstPath:first.path,secondPath:second.path,firstSlide,secondSlide});
  }
  return issues;
}
export const slideDeckCopyIsDistinct=(values:unknown[])=>slideDeckCopyIssues(values).length===0;

export function normalizeSlideDeckItems(values:unknown[]):DocumentArtifactDraftItem[]{
  const items=values.map((value,index)=>normalizeSlideItem(value,index)),prior:Array<{path:string;value:string}>=[];
  return items.map((item,index)=>{if(!item.slide){return item;}const repeated=(path:string,value:string)=>Boolean(value)&&prior.some((candidate)=>crossSlideDuplicate(candidate,{path,value}));const body=repeated("body",item.body)?"":item.body;const bullets=item.slide.bullets.filter((bullet)=>!repeated("slide.bullets.0",bullet));const visual={...item.slide.visual,data:item.slide.visual.data.map((datum)=>({...datum}))};if(["hero-type","metric","diagram"].includes(visual.kind)&&repeated("slide.visual.value",visual.value))visual.value="";if(visual.kind==="bars"||visual.kind==="timeline")visual.data=visual.data.map((datum)=>repeated("slide.visual.data.0.value",datum.value)?{...datum,value:""}:datum);const normalized={...item,body,slide:normalizeSlideVisual({...item.slide,bullets,visual},{title:item.title,body},index)};prior.push(...slideNarrativeFields(normalized));return normalized;});
}

export function slideVisualIsComplete(slide:SlideVisualData){
  if(slide.visual.kind==="quote")return Boolean(slide.quote?.text.trim())&&Boolean(slide.quote?.speaker.trim())&&Boolean(slide.quote?.role.trim())&&(!slide.visual.value||slide.visual.value===slide.quote?.text);
  if(slide.visual.kind==="hero-type"||slide.visual.kind==="metric")return Boolean(contentKey(slide.visual.value));
  if(slide.visual.kind==="bars"||slide.visual.kind==="scorecard"||slide.visual.kind==="matrix")return slide.visual.data.length>=2&&slide.visual.data.every((datum)=>Boolean(contentKey(datum.label))&&Boolean(contentKey(datum.value)));
  if(slide.visual.kind==="timeline"||slide.visual.kind==="comparison"||slide.visual.kind==="personas"||slide.visual.kind==="roadmap"){
    if(slide.visual.data.length<2)return false;
    const labels=slide.visual.data.map((datum)=>contentKey(datum.label));
    if(labels.some((label)=>!label)||new Set(labels).size!==labels.length)return false;
    return slide.visual.data.every((datum)=>Boolean(contentKey(datum.value)))||slide.visual.data.every((datum)=>/\p{L}/u.test(datum.label)&&contentKey(datum.label).length>=3);
  }
  return slide.visual.data.length>=2&&slide.visual.data.every((datum)=>Boolean(contentKey(datum.label)));
}

export type DocumentArtifactValidationIssue={code:string;path:string;message:string};

const preciseNumber=(value:unknown):number|null=>{
  const normalized=text(value).replace(/^[£$€]/u,"").replace(/,/g,"").replace(/%$/,"");
  if(!/^[+-]?(?:\d+\.?\d*|\.\d+)$/u.test(normalized))return null;
  const parsed=Number(normalized);return Number.isFinite(parsed)?parsed:null;
};

/** Append units once, and optionally limit them to actual quantitative values. */
export function formatPresentationQuantity(value:string|undefined,unit:string|undefined,options:{numericOnly?:boolean}={}):string{
  const quantity=String(value??"").trim(),measurement=String(unit??"").trim();
  if(!quantity||!measurement||quantity.toLocaleLowerCase().endsWith(measurement.toLocaleLowerCase()))return quantity;
  if(options.numericOnly&&!/^[+-]?(?:\d+(?:[.,]\d+)?|\.\d+)(?:\s*[–—-]\s*[+-]?(?:\d+(?:[.,]\d+)?|\.\d+))?$/u.test(quantity))return quantity;
  return`${quantity} ${measurement}`;
}

/** Percentage-scaled assessment bars derive geometry from the displayed evidence. */
export function authoritativeSlideDatumWeight(visual:Pick<SlideVisualData["visual"],"kind"|"value"|"unit">,datum:SlideVisualDatum){
  const fallback=Number.isFinite(datum.weight)?Math.max(0,Math.min(1,datum.weight)):1;
  if(visual.kind!=="scorecard"&&visual.kind!=="bars")return fallback;
  const raw=datum.exactValue??datum.value??datum.displayValue??"";
  const hundredScale=/^\/\s*100$/u.test(String(visual.unit??"").trim())||/%\s*$/u.test(String(raw))||/\/\s*100\b/u.test(String(visual.value??""));
  if(!hundredScale)return fallback;
  const value=preciseNumber(raw);
  return value!==null&&value>=0&&value<=100?value/100:fallback;
}
const decimalPlaces=(value:unknown)=>{const matched=text(value).replace(/%$/,"").match(/\.(\d+)$/u);return matched?.[1]?.length??0;};
const roundedNumber=(value:number,places:number)=>{const factor=10**places;return Math.sign(value)*Math.round((Math.abs(value)+Number.EPSILON)*factor)/factor;};

/** Preserve provider/source precision instead of trusting a rounded display label. */
export function slidePrecisionIssues(slide:SlideVisualData,path="slide"):DocumentArtifactValidationIssue[]{
  const issues:DocumentArtifactValidationIssue[]=[];
  const checkPair=(exactValue:string|undefined,displayValue:string|undefined,pairPath:string)=>{
    if(!exactValue||!displayValue)return;
    const exact=preciseNumber(exactValue),display=preciseNumber(displayValue);if(exact===null||display===null)return;
    const exactPlaces=decimalPlaces(exactValue),displayPlaces=decimalPlaces(displayValue);
    if(displayPlaces>exactPlaces&&display!==exact){issues.push({code:"reversed_precision_labels",path:pairPath,message:"The exact value must retain source precision; the displayed value cannot contain more precision than its exact source."});return;}
    if(Math.abs(roundedNumber(exact,displayPlaces)-display)>Math.max(Number.EPSILON*8,10**-(displayPlaces+6)))issues.push({code:"inconsistent_display_precision",path:pairPath,message:"The displayed value does not equal the exact value rounded to its displayed precision."});
  };
  checkPair(slide.visual.exactValue,slide.visual.displayValue,`${path}.visual`);
  slide.visual.data.forEach((datum,index)=>{
    checkPair(datum.exactValue,datum.displayValue,`${path}.visual.data.${index}`);
    const expected=authoritativeSlideDatumWeight(slide.visual,datum);
    if(Math.abs(datum.weight-expected)>1e-6)issues.push({code:"inconsistent_scorecard_weight",path:`${path}.visual.data.${index}.weight`,message:"The assessment bar geometry must match its exact protected value on the authored 100-point scale."});
  });
  if((slide.visual.kind==="scorecard"||slide.visual.kind==="bars")&&slide.visual.exactValue&&slide.visual.data.length>=2){
    const exact=preciseNumber(slide.visual.exactValue),values=slide.visual.data.map((datum)=>preciseNumber(datum.exactValue??datum.value));
    if(exact!==null&&values.every((value):value is number=>value!==null)){
      const average=values.reduce((sum,value)=>sum+value,0)/values.length;
      if(Math.abs(average-exact)>Math.max(Number.EPSILON*16,10**-(decimalPlaces(slide.visual.exactValue)+3)))issues.push({code:"inconsistent_scorecard_average",path:`${path}.visual.data`,message:"The exact scorecard average does not equal the equal-weight mean of every visible data point."});
    }
  }
  return issues;
}

/** Every source claim contributing to visible semantics, including nested evidence. */
export function slideSourceIds(value:unknown):string[]{
  const input=record(value),slide=record(input.slide??value),quote=record(slide.quote),citations=Array.isArray(slide.citations)?slide.citations:[],visual=record(slide.visual),data=Array.isArray(visual.data)?visual.data:[];
  return[...new Set([...uniqueText(slide.sourceIds??slide.source_ids),text(quote.sourceId??quote.source_id??quote.source_key),...citations.map((citation)=>{const entry=record(citation);return text(entry.sourceId??entry.source_id??entry.source_key);}),...data.flatMap((datum)=>{const entry=record(datum);return uniqueText(entry.sourceIds??entry.source_ids);})].filter(Boolean))];
}

export type DocumentArtifactContextGroupContract={id:string;alias:string};
export type DocumentArtifactContextGroupResolution={
  rawAssignments:string[][];
  canonicalAssignments:string[][];
  unknownAssignments:string[];
  deterministicallyAssigned:boolean;
};

/**
 * Provider output may refer only to the short-lived aliases exposed in its
 * request. Durable Combined Context IDs are owned by the application and are
 * resolved here rather than delegated to a language model. A one-item artifact
 * (notably video and scene) necessarily receives every current group.
 */
export function resolveDocumentArtifactContextGroups(output:DocumentArtifactDraft|null,contracts:DocumentArtifactContextGroupContract[]):{output:DocumentArtifactDraft|null;receipt:DocumentArtifactContextGroupResolution}{
  const rawAssignments=output?.items.map((item)=>[...new Set(item.context_group_ids??[])])??[];
  if(!output)return{output,receipt:{rawAssignments,canonicalAssignments:[],unknownAssignments:[],deterministicallyAssigned:false} satisfies DocumentArtifactContextGroupResolution};
  const durableByReference=new Map<string,string>();
  for(const contract of contracts)durableByReference.set(contract.alias,contract.id);
  const unknown=new Set<string>();
  const singleItem=output.items.length===1;
  const items=output.items.map((item,index)=>{
    const resolved=singleItem
      ? contracts.map((contract)=>contract.id)
      : rawAssignments[index]!.flatMap((reference)=>{const id=durableByReference.get(reference);if(id)return[id];unknown.add(reference);return[];});
    if(singleItem)for(const reference of rawAssignments[index]!)if(!durableByReference.has(reference))unknown.add(reference);
    return{...item,context_group_ids:[...new Set(resolved)]};
  });
  const canonicalAssignments=items.map((item)=>item.context_group_ids??[]);
  return{output:{...output,items},receipt:{rawAssignments,canonicalAssignments,unknownAssignments:[...unknown],deterministicallyAssigned:singleItem&&contracts.length>0} satisfies DocumentArtifactContextGroupResolution};
}

export type DocumentArtifactValidationOptions={
  itemCount:number;
  contextGroupIds?:string[];
  unknownContextGroupAssignments?:string[];
  rawContextGroupAssignments?:string[][];
  requireSourceGrounding?:boolean;
  sourceContract?:PresentationSourceContract;
  sourcePageStart?:number;
  sourcePageSize?:number;
  requireAllProtectedContent?:boolean;
};

/** Preserve only independently authored visual evidence and an exact opening-to-closing promise. */
function sourceAuthorizedRepeatedPresentationCopy(values:readonly unknown[],duplicate:SlideDeckCopyIssue,contract:PresentationSourceContract,pageStart=0){
  const visualEvidence=duplicate.firstPath==="slide.visual.value"&&/^slide\.visual\.data\.\d+\.value$/u.test(duplicate.secondPath);
  const opening=contract.numberedOutline[0],closing=contract.numberedOutline.at(-1);
  const openingPromise=duplicate.firstPath==="title"
    &&/^(?:body|slide\.visual\.value|slide\.bullets\.\d+)$/u.test(duplicate.secondPath)
    &&opening!==undefined&&closing!==undefined&&opening.number!==closing.number
    &&pageStart+duplicate.firstSlide+1===opening.number&&pageStart+duplicate.secondSlide+1===closing.number
    &&text(duplicate.first)===text(duplicate.second)
    &&contentKey(opening.content.split(/\r?\n/u,1)[0])===contentKey(duplicate.first);
  if(!visualEvidence&&!openingPromise)return false;
  const authoredEvidence=(slideIndex:number,value:string,datumIndex?:number)=>{
    const authored=contract.numberedOutline.find((slide)=>slide.number===pageStart+slideIndex+1);
    const evidenceTokens=copyTokens(value),sourceTokens=copyTokens(authored?.content??"");
    if(!authored||evidenceTokens.length<2||evidenceTokens.length>12||text(value).length>160)return false;
    const contiguous=sourceTokens.some((_token,index)=>evidenceTokens.every((token,offset)=>sourceTokens[index+offset]===token));
    if(!contiguous)return false;
    if(!authored.sourceBlockId)return true;
    const authorizedReferences=new Set([authored.sourceBlockId,...(authored.sourceAlias?[authored.sourceAlias]:[])]);
    const sources=slideSourceIds(values[slideIndex]);
    if(!sources.some((source)=>authorizedReferences.has(source)))return false;
    if(datumIndex===undefined)return true;
    const slide=record(record(values[slideIndex]).slide),visual=record(slide.visual),data=Array.isArray(visual.data)?visual.data:[],datum=record(data[datumIndex]);
    if(!copyTokens(datum.label).length)return false;
    const datumSources=uniqueText(datum.sourceIds??datum.source_ids);
    return!datumSources.length||datumSources.some((source)=>authorizedReferences.has(source));
  };
  const datumIndex=visualEvidence?Number(/^slide\.visual\.data\.(\d+)\.value$/u.exec(duplicate.secondPath)?.[1]):undefined;
  return authoredEvidence(duplicate.firstSlide,duplicate.first)&&authoredEvidence(duplicate.secondSlide,duplicate.second,datumIndex);
}

export function documentArtifactValidationIssues(kind:DocumentArtifactKind,output:DocumentArtifactDraft|null,options:DocumentArtifactValidationOptions):DocumentArtifactValidationIssue[]{
  if(!output)return[{code:"invalid_json",path:"$",message:"The provider response was not a valid artifact object."}];
  const issues:DocumentArtifactValidationIssue[]=[];const add=(code:string,path:string,message:string)=>issues.push({code,path,message});const expectedGroups=options.contextGroupIds??[];const knownGroups=new Set(expectedGroups);const assignedGroups=output.items.flatMap((item)=>item.context_group_ids??[]);
  if(!output.content_markdown.trim())add("missing_content","content_markdown","The durable readable output is empty.");
  if(output.items.length!==options.itemCount)add("wrong_item_count","items",`Expected ${options.itemCount} items but received ${output.items.length}.`);
  if(options.unknownContextGroupAssignments?.length){
    const unknown=new Set(options.unknownContextGroupAssignments);
    const positions=(options.rawContextGroupAssignments??[]).flatMap((references,index)=>references.some((reference)=>unknown.has(reference))?[index]:[]);
    if(positions.length)for(const index of positions)add("unknown_context_group_reference",`items.${index}.context_group_ids`,"This slide references a context alias that was not authorized for this request.");
    else add("unknown_context_group_reference","items.context_group_ids","At least one slide references a context alias that was not authorized for this request.");
  }
  for(const groupId of expectedGroups)if(!assignedGroups.includes(groupId))add("missing_context_group","items.context_group_ids",`Combined Context ${groupId} was not assigned to any item.`);
  for(const groupId of assignedGroups)if(!knownGroups.has(groupId))add("unknown_context_group","items.context_group_ids",`Unknown Combined Context ${groupId} was assigned.`);
  if(kind!=="slides")return issues;
  if(!output.presentation?.footerLabel?.trim())add("missing_footer_label","presentation.footer_label","The deck needs a document-derived footer label.");
  for(const groupId of expectedGroups){const positions=output.items.flatMap((item,index)=>(item.context_group_ids??[]).includes(groupId)?[index]:[]);const reopened=positions.find((position,index)=>index>0&&position!==positions[index-1]!+1);if(reopened!==undefined)add("split_context_group",`items.${reopened}.context_group_ids`,`Combined Context ${groupId} must occupy one slide or a contiguous chapter.`);}
  let previousSourceOrder=0;let previousSection="";const completedSections=new Set<string>();
  output.items.forEach((item,index)=>{
    const path=`items.${index}`;
    if(!item.title.trim())add("missing_title",`${path}.title`,"Every slide needs a title.");
    if(!item.slide){add("missing_slide",`${path}.slide`,"Every slide needs structured visual data.");return;}
    if(!slideVisualIsComplete(item.slide)){
      const kind=item.slide.visual.kind,points=item.slide.visual.data.length,missingValues=item.slide.visual.data.filter((datum)=>!datum.value.trim()).map((datum)=>datum.label).slice(0,4);
      const message=kind==="hero-type"||kind==="metric"
        ? `${kind} visual needs one meaningful, distinct source-authored visual value; none remains after normalization.`
        :kind==="quote"
          ? "Quote visual needs a complete verbatim source-authored quotation with its speaker and role attribution."
          :`${kind} visual needs at least two distinct source-authored points${["scorecard","bars","matrix"].includes(kind)?" with meaningful values":""}; found ${points}${missingValues.length?` and missing values for ${missingValues.join(", ")}`:""}. If only category names are authored, use an architecture visual; never invent evidence.`;
      add("incomplete_visual",`${path}.slide.visual`,message);
    }
    if(item.slide.visual.kind==="quote"&&!item.slide.quote?.text)add("missing_quote",`${path}.slide.quote`,"A quotation slide must retain its complete verbatim stakeholder quotation.");
    if(item.slide.quote&&(!item.slide.quote.speaker.trim()||!item.slide.quote.role.trim()))add("missing_quote_attribution",`${path}.slide.quote`,"Every protected stakeholder quotation must preserve its speaker and role attribution.");
    if(options.requireSourceGrounding&&!slideSourceIds(item.slide).length&&!(item.context_group_ids??[]).length)add("missing_source_grounding",`${path}.slide.source_ids`,"Every generated slide must identify at least one authorized source claim, block, or context group.");
    if(item.slide.sourceOrder!==undefined){if(item.slide.sourceOrder<=previousSourceOrder)add("source_order_mismatch",`${path}.slide.source_order`,"Slides must preserve the increasing order of their authored source outline.");previousSourceOrder=item.slide.sourceOrder;}
    if(item.slide.section&&item.slide.section!==previousSection){if(completedSections.has(item.slide.section))add("split_source_section",`${path}.slide.section`,"An authored source section must remain a contiguous slide chapter.");if(previousSection)completedSections.add(previousSection);previousSection=item.slide.section;}
    issues.push(...slidePrecisionIssues(item.slide,`${path}.slide`));
    if(!item.body.trim()&&!item.slide.bullets.length&&!item.slide.quote?.text&&!item.slide.visual.value.trim()&&!item.slide.visual.data.length)add("missing_visible_claim",path,"The slide has no body, bullets, metric, quotation, or visual claim.");
    for(const duplicate of slideCopyIssues(item))add("duplicate_slide_copy",`${path}.${duplicate.secondPath}`,`This repeats ${path}.${duplicate.firstPath}: “${duplicate.second}”.`);
  });
  for(const duplicate of slideDeckCopyIssues(output.items)){
    if(options.sourceContract&&sourceAuthorizedRepeatedPresentationCopy(output.items,duplicate,options.sourceContract,options.sourcePageStart??0))continue;
    add("duplicate_deck_copy",`items.${duplicate.secondSlide}.${duplicate.secondPath}`,`This repeats items.${duplicate.firstSlide}.${duplicate.firstPath}: “${duplicate.second}”.`);
  }
  if(options.sourceContract)issues.push(...validatePresentationSourceCoverage(output.items,options.sourceContract,{
    pageStart:options.sourcePageStart,
    pageSize:options.sourcePageSize,
    requireEverySlideSource:options.requireSourceGrounding??options.sourceContract.sources.some((source)=>source.sourceKind==="block"),
    ...(options.requireAllProtectedContent===undefined?{}:{requireAllProtectedContent:options.requireAllProtectedContent}),
  }));
  if(options.sourceContract&&options.requireAllProtectedContent===true){
    for(const quote of options.sourceContract.protectedQuotes){
      const namedSpeaker=quote.speaker!==quote.role;
      if(!output.content_markdown.includes(quote.text)||!output.content_markdown.includes(quote.role)||namedSpeaker&&!output.content_markdown.includes(quote.speaker))add("missing_markdown_quote","content_markdown",`The readable Markdown must retain the complete ${quote.role} quotation, named speaker, and attribution.`);
      const index=output.items.findIndex((item)=>item.slide?.quote?.text===quote.text||item.body.includes(quote.text)||(item.slide?.bullets??[]).some((bullet)=>bullet.includes(quote.text))||item.slide?.visual.value.includes(quote.text));
      if(index>=0){const notes=output.items[index]?.notes??"";if(!notes.includes(quote.text)||!notes.includes(quote.role)||namedSpeaker&&!notes.includes(quote.speaker))add("missing_quote_speaker_notes",`items.${index}.notes`,`The complete ${quote.role} quotation, named speaker, and attribution must also remain in speaker notes.`);}
    }
    const checkProtectedScores=(value:string,path:string)=>{for(const mismatch of protectedPresentationScoreContradictions(value,options.sourceContract!))add("mislabeled_narrative_fact",path,`The protected ${mismatch.label} assessment must remain ${mismatch.expected}, not ${mismatch.observed}, in every readable output.`);};
    checkProtectedScores(output.content_markdown,"content_markdown");output.items.forEach((item,index)=>checkProtectedScores(item.notes,`items.${index}.notes`));
    const exactFact=options.sourceContract.protectedFacts.find((fact)=>fact.precision==="exact");
    if(exactFact?.exactValue&&exactFact.displayValue&&exactFact.exactValue!==exactFact.displayValue){
      const escaped=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/gu,"\\$&");
      const reversedExact=new RegExp(`\\b(?:exact|unrounded|precise)\\b[^\\n;.,]{0,64}\\b${escaped(exactFact.displayValue)}(?!\\d|\\.\\d)`,"iu"),reversedDisplay=new RegExp(`\\b(?:display(?:ed)?|rounded)\\b[^\\n;.,]{0,64}\\b${escaped(exactFact.exactValue)}(?!\\d|\\.\\d)`,"iu");
      const checkNarrative=(value:string,path:string)=>{if(reversedExact.test(value)||reversedDisplay.test(value))add("reversed_narrative_precision",path,"The exact source value and rounded displayed value must retain their correct meanings in every readable output.");};
      checkNarrative(output.content_markdown,"content_markdown");output.items.forEach((item,index)=>checkNarrative(item.notes,`items.${index}.notes`));
    }
  }
  return issues;
}

export const defaultSlidePresentation = (stylePreset:SlideStylePresetId="gallery"): SlidePresentation => {
  const preset=slideStylePresetDefinition(stylePreset);return{aspectRatio:"16:9",theme:"Document-derived editorial",footerLabel:"",stylePreset,mode:preset.mode,palette:{...preset.palette}};
};

export function parseDocumentArtifactContent(value: string | undefined): DocumentArtifactDraft | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<DocumentArtifactDraft>;
    if (!parsed || typeof parsed !== "object" || typeof parsed.title !== "string" || typeof parsed.content_markdown !== "string" || !Array.isArray(parsed.items)) return null;
    const presentation=normalizeSlidePresentation(parsed.presentation);if(presentation&&!presentation.footerLabel){const fallback=text(parsed.title);if(fallback&&!processDerivedSlideLabel(fallback))presentation.footerLabel=fallback;}
    return {
      title: parsed.title,
      summary: String(parsed.summary ?? ""),
      content_markdown: parsed.content_markdown,
      presentation,
      items:parsed.items.map((item,index)=>normalizeSlideItem(item,index)),
    };
  } catch { return null; }
}
