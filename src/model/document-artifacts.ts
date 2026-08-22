import type { ImageFocalPoint } from "./focal-point.ts";

export const DOCUMENT_ARTIFACT_KINDS = ["short_story", "scene", "slides", "storyboard", "video"] as const;
export type DocumentArtifactKind = typeof DOCUMENT_ARTIFACT_KINDS[number];

export const SLIDE_LAYOUTS = ["cover", "statement", "split", "columns", "metric", "timeline", "closing"] as const;
export type SlideLayout = typeof SLIDE_LAYOUTS[number];
export const SLIDE_VISUAL_KINDS = ["hero-type", "metric", "bars", "timeline", "diagram", "color-field"] as const;
export type SlideVisualKind = typeof SLIDE_VISUAL_KINDS[number];

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
  stylePreset: SlideStylePresetId;
  mode: "light" | "dark";
  palette: SlidePalette;
};

export type SlideVisualData = {
  layout: SlideLayout;
  kicker: string;
  bullets: string[];
  visual: {
    kind: SlideVisualKind;
    label: string;
    value: string;
    data: Array<{ label: string; value: string; weight: number }>;
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
export const slideCopyIsNearDuplicate = (left: unknown, right: unknown) => {
  const leftKey=contentKey(left),rightKey=contentKey(right);if(!leftKey||!rightKey||!isProseCopy(left)||!isProseCopy(right))return false;if(leftKey===rightKey)return true;
  const [shortKey,longKey]=leftKey.length<=rightKey.length?[leftKey,rightKey]:[rightKey,leftKey];if(shortKey.length>=20&&longKey.includes(shortKey))return true;
  const leftTokens=new Set(copyTokens(left)),rightTokens=new Set(copyTokens(right));const smaller=Math.min(leftTokens.size,rightTokens.size),larger=Math.max(leftTokens.size,rightTokens.size);if(smaller<4)return false;
  const shared=[...leftTokens].filter((token)=>rightTokens.has(token)).length;const containment=shared/smaller;const lengthRatio=smaller/Math.max(1,larger);return containment>=.86&&lengthRatio>=.6||smaller>=6&&containment>=.8;
};
const repeatedText = (value: unknown, used: string[]) => used.some((candidate)=>slideCopyIsNearDuplicate(value,candidate));
const distinctText = (value: unknown, used: string[]) => { const result=text(value);if(!result||placeholderText(result)||repeatedText(result,used))return "";used.push(result);return result; };
const color = (value: unknown, fallback: string) => /^#[0-9a-f]{6}$/i.test(text(value)) ? text(value).toLowerCase() : fallback;
const slideLayout = (value: unknown, index = 0): SlideLayout => SLIDE_LAYOUTS.includes(value as SlideLayout) ? value as SlideLayout : index === 0 ? "cover" : "split";
const slideVisualKind = (value: unknown, index = 0): SlideVisualKind => SLIDE_VISUAL_KINDS.includes(value as SlideVisualKind) ? value as SlideVisualKind : SLIDE_VISUAL_KINDS[index % SLIDE_VISUAL_KINDS.length];
const processDerivedSlideLabel = (value: unknown) => /^(?:document[- ]derived editorial|editorial(?: theme)?|generated (?:deck|presentation)|presentation(?: theme)?|slide deck)$/i.test(contentKey(value));

export function normalizeSlidePresentation(value: unknown): SlidePresentation | null {
  const input = record(value); if (!Object.keys(input).length) return null;const requestedPreset=input.stylePreset??input.style_preset;const inferredPreset=input.mode==="dark"?"nocturne":"gallery";const stylePreset=isSlideStylePresetId(requestedPreset)?requestedPreset:inferredPreset;const preset=slideStylePresetDefinition(stylePreset);const palette = record(input.palette);const theme=text(input.theme)||"Document-derived editorial";const requestedFooter=text(input.footerLabel??input.footer_label);const footerCandidate=requestedFooter||theme;const mode=input.mode==="dark"||input.mode==="light"?input.mode:preset.mode;
  return {
    aspectRatio: "16:9",
    theme,
    footerLabel: processDerivedSlideLabel(footerCandidate)?"":footerCandidate,
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

export function normalizeSlideVisual(value: unknown, item: { title?: unknown; body?: unknown } = {}, index = 0): SlideVisualData {
  const input = record(value); const visual = record(input.visual); const rawData = Array.isArray(visual.data) ? visual.data : [];
  const title=text(item.title);const body=text(item.body);const used=[title,body].filter(Boolean);const bulletSource=Array.isArray(input.bullets)?input.bullets:[];const bullets:string[]=[];
  for(const candidate of bulletSource){const bullet=listText(candidate),accepted=distinctText(bullet,used);if(!accepted)continue;bullets.push(accepted);if(bullets.length===5)break;}
  const requestedKicker=text(input.kicker);const acceptedKicker=distinctText(requestedKicker,used);const kicker=acceptedKicker||(index===0?"Overview":`Chapter ${String(index+1).padStart(2,"0")}`);if(!acceptedKicker)used.push(kicker);
  let kind=slideVisualKind(visual.kind,index);const valueIsVisible=kind==="hero-type"||kind==="metric"||kind==="diagram";let visualValue=valueIsVisible?distinctText(visual.value,used):placeholderText(visual.value)?"":text(visual.value);let visualLabel=distinctText(visual.label,used);const data:Array<{label:string;value:string;weight:number}>=[];
  for(const datum of rawData){const entry=record(datum);let label=text(entry.label),datumValue=text(entry.value);if(placeholderText(label))label="";if(placeholderText(datumValue))datumValue="";if(!label&&datumValue){label=datumValue;datumValue="";}label=distinctText(label,used);if(!label)continue;if(datumValue&&repeatedText(datumValue,used))datumValue="";else if(datumValue&&isProseCopy(datumValue))used.push(datumValue);const weight=Number(entry.weight);data.push({label,value:datumValue,weight:Number.isFinite(weight)?Math.max(0,Math.min(1,weight)):1});if(data.length===5)break;}
  if((kind==="bars"||kind==="timeline")){const complete=data.filter((datum)=>Boolean(contentKey(datum.value)));data.splice(0,data.length,...complete);}
  if((kind==="bars"||kind==="timeline"||kind==="diagram"||kind==="color-field")&&data.length<2){const singular=valueIsVisible?visualValue:distinctText(visualValue,used)||data[0]?.label||"";kind="hero-type";visualValue=singular;data.splice(0,data.length);}
  if((kind==="hero-type"||kind==="metric")&&!visualValue){visualValue=data[0]?.label??"";data.splice(0,data.length);}
  if(!visualLabel&&visualValue)visualLabel="Visual emphasis";
  return {
    layout: slideLayout(input.layout, index),
    kicker,
    bullets,
    visual: {
      kind,
      label: visualLabel,
      value: visualValue,
      data,
    },
  };
}

export function normalizeSlideItem(value: unknown,index=0):DocumentArtifactDraftItem {
  const input=record(value);const title=text(input.title);const requestedBody=text(input.body);const body=requestedBody&&!placeholderText(requestedBody)&&!slideCopyIsNearDuplicate(title,requestedBody)?requestedBody:"";
  const contextGroupIds=Array.isArray(input.context_group_ids)?[...new Set(input.context_group_ids.map(text).filter(Boolean))]:[];
  return{title,body,notes:text(input.notes),image_prompt:text(input.image_prompt),context_group_ids:contextGroupIds,slide:input.slide?normalizeSlideVisual(input.slide,{title,body},index):null};
}

export type SlideCopyIssue={first:string;second:string;firstPath:string;secondPath:string};
const slideCopyFields=(value:unknown)=>{const item=record(value),slide=record(item.slide),visual=record(slide.visual),kind=text(visual.kind);const fields:Array<{path:string;value:string}>=[];const add=(path:string,value:unknown)=>{const copy=text(value);if(copy)fields.push({path,value:copy});};add("title",item.title);add("body",item.body);add("slide.kicker",slide.kicker);if(Array.isArray(slide.bullets))slide.bullets.forEach((bullet,index)=>add(`slide.bullets.${index}`,bullet));add("slide.visual.label",visual.label);if(["hero-type","metric","diagram"].includes(kind))add("slide.visual.value",visual.value);if(Array.isArray(visual.data))visual.data.forEach((datum,index)=>{const entry=record(datum);add(`slide.visual.data.${index}.label`,entry.label);if(["bars","timeline"].includes(kind))add(`slide.visual.data.${index}.value`,entry.value);});return fields;};
export function slideCopyIssues(value:unknown):SlideCopyIssue[]{
  const fields=slideCopyFields(value),issues:SlideCopyIssue[]=[];for(let left=0;left<fields.length;left+=1)for(let right=left+1;right<fields.length;right+=1){const first=fields[left],second=fields[right];if(first&&second&&slideCopyIsNearDuplicate(first.value,second.value))issues.push({first:first.value,second:second.value,firstPath:first.path,secondPath:second.path});}return issues;
}
export const slideCopyIsDistinct=(value:unknown)=>slideCopyIssues(value).length===0;

export type SlideDeckCopyIssue=SlideCopyIssue&{firstSlide:number;secondSlide:number};
const slideNarrativeFields=(value:unknown)=>slideCopyFields(value).filter((field)=>field.path==="title"||field.path==="body"||field.path.startsWith("slide.bullets.")||field.path==="slide.visual.value"||field.path.endsWith(".value"));
const crossSlideDuplicate=(left:{path:string;value:string},right:{path:string;value:string})=>{const leftKey=contentKey(left.value),rightKey=contentKey(right.value),exact=leftKey===rightKey;if(exact&&left.path==="title"&&right.path==="title")return true;const shorter=Math.min(leftKey.length,rightKey.length),tokens=Math.min(copyTokens(left.value).length,copyTokens(right.value).length);return exact&&shorter>=12&&tokens>=2||slideCopyIsNearDuplicate(left.value,right.value)&&tokens>=4;};
export function slideDeckCopyIssues(values:unknown[]):SlideDeckCopyIssue[]{
  const slides=values.map(slideNarrativeFields),issues:SlideDeckCopyIssue[]=[];for(let firstSlide=0;firstSlide<slides.length;firstSlide+=1)for(let secondSlide=firstSlide+1;secondSlide<slides.length;secondSlide+=1)for(const first of slides[firstSlide]??[])for(const second of slides[secondSlide]??[])if(crossSlideDuplicate(first,second))issues.push({first:first.value,second:second.value,firstPath:first.path,secondPath:second.path,firstSlide,secondSlide});return issues;
}
export const slideDeckCopyIsDistinct=(values:unknown[])=>slideDeckCopyIssues(values).length===0;

export function normalizeSlideDeckItems(values:unknown[]):DocumentArtifactDraftItem[]{
  const items=values.map((value,index)=>normalizeSlideItem(value,index)),prior:Array<{path:string;value:string}>=[];
  return items.map((item,index)=>{if(!item.slide){return item;}const repeated=(path:string,value:string)=>Boolean(value)&&prior.some((candidate)=>crossSlideDuplicate(candidate,{path,value}));const body=repeated("body",item.body)?"":item.body;const bullets=item.slide.bullets.filter((bullet)=>!repeated("slide.bullets.0",bullet));const visual={...item.slide.visual,data:item.slide.visual.data.map((datum)=>({...datum}))};if(["hero-type","metric","diagram"].includes(visual.kind)&&repeated("slide.visual.value",visual.value))visual.value="";if(visual.kind==="bars"||visual.kind==="timeline")visual.data=visual.data.map((datum)=>repeated("slide.visual.data.0.value",datum.value)?{...datum,value:""}:datum);const normalized={...item,body,slide:normalizeSlideVisual({...item.slide,bullets,visual},{title:item.title,body},index)};prior.push(...slideNarrativeFields(normalized));return normalized;});
}

export function slideVisualIsComplete(slide:SlideVisualData){
  if(slide.visual.kind==="hero-type"||slide.visual.kind==="metric")return Boolean(contentKey(slide.visual.value));
  if(slide.visual.kind==="bars"||slide.visual.kind==="timeline")return slide.visual.data.length>=2&&slide.visual.data.every((datum)=>Boolean(contentKey(datum.label))&&Boolean(contentKey(datum.value)));
  return slide.visual.data.length>=2&&slide.visual.data.every((datum)=>Boolean(contentKey(datum.label)));
}

export type DocumentArtifactValidationIssue={code:string;path:string;message:string};

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
  for(const contract of contracts){durableByReference.set(contract.alias,contract.id);durableByReference.set(contract.id,contract.id);}
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

export function documentArtifactValidationIssues(kind:DocumentArtifactKind,output:DocumentArtifactDraft|null,options:{itemCount:number;contextGroupIds?:string[]}):DocumentArtifactValidationIssue[]{
  if(!output)return[{code:"invalid_json",path:"$",message:"The provider response was not a valid artifact object."}];
  const issues:DocumentArtifactValidationIssue[]=[];const add=(code:string,path:string,message:string)=>issues.push({code,path,message});const expectedGroups=options.contextGroupIds??[];const knownGroups=new Set(expectedGroups);const assignedGroups=output.items.flatMap((item)=>item.context_group_ids??[]);
  if(!output.content_markdown.trim())add("missing_content","content_markdown","The durable readable output is empty.");
  if(output.items.length!==options.itemCount)add("wrong_item_count","items",`Expected ${options.itemCount} items but received ${output.items.length}.`);
  for(const groupId of expectedGroups)if(!assignedGroups.includes(groupId))add("missing_context_group","items.context_group_ids",`Combined Context ${groupId} was not assigned to any item.`);
  for(const groupId of assignedGroups)if(!knownGroups.has(groupId))add("unknown_context_group","items.context_group_ids",`Unknown Combined Context ${groupId} was assigned.`);
  if(kind!=="slides")return issues;
  if(!output.presentation?.footerLabel?.trim())add("missing_footer_label","presentation.footer_label","The deck needs a document-derived footer label.");
  for(const groupId of expectedGroups){const positions=output.items.flatMap((item,index)=>(item.context_group_ids??[]).includes(groupId)?[index]:[]);if(!positions.every((position,index)=>index===0||position===positions[index-1]!+1))add("split_context_group","items.context_group_ids",`Combined Context ${groupId} must occupy one slide or a contiguous chapter.`);}
  output.items.forEach((item,index)=>{
    const path=`items.${index}`;
    if(!item.title.trim())add("missing_title",`${path}.title`,"Every slide needs a title.");
    if(!item.slide){add("missing_slide",`${path}.slide`,"Every slide needs structured visual data.");return;}
    if(!slideVisualIsComplete(item.slide))add("incomplete_visual",`${path}.slide.visual`,"The slide visual group is incomplete or still contains scaffolding.");
    if(!item.body.trim()&&!item.slide.bullets.length&&!item.slide.visual.value.trim()&&!item.slide.visual.data.length)add("missing_visible_claim",path,"The slide has no body, bullets, metric, or visual claim.");
    for(const duplicate of slideCopyIssues(item))add("duplicate_slide_copy",`${path}.${duplicate.secondPath}`,`This repeats ${path}.${duplicate.firstPath}: “${duplicate.second}”.`);
  });
  for(const duplicate of slideDeckCopyIssues(output.items))add("duplicate_deck_copy",`items.${duplicate.secondSlide}.${duplicate.secondPath}`,`This repeats items.${duplicate.firstSlide}.${duplicate.firstPath}: “${duplicate.second}”.`);
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
      items: presentation?normalizeSlideDeckItems(parsed.items):parsed.items.map((item,index)=>normalizeSlideItem(item,index)),
    };
  } catch { return null; }
}
