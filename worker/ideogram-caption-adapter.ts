import type { PromptTechnique } from "../src/model/prompt-structures.ts";
import { combinedContextGroups, combinedContextMemberships } from "../src/model/combined-context.ts";
import { partitionContextAdaptationFactScopes, requiredContextAdaptationFacts } from "../src/model/context-adaptation.ts";
import { promptFactIsActive } from "../src/model/prompt-policy.ts";
import type { CreativeImageOptions, ImageReference } from "./openai-adapter.ts";

type CreativeFact={block_id?:unknown;type?:unknown;role?:unknown;intent?:unknown;effect?:unknown;active?:unknown;locked?:unknown;properties?:unknown};
type IdeogramObjectElement={type:"obj";bbox?:[number,number,number,number];desc:string;color_palette?:string[]};
type IdeogramTextElement={type:"text";bbox?:[number,number,number,number];text:string;desc:string;color_palette?:string[]};
export type IdeogramCaption={
  high_level_description:string;
  style_description:{aesthetics:string;lighting:string;photo:string;medium:"photograph";color_palette?:string[]}|{aesthetics:string;lighting:string;medium:string;art_style:string;color_palette?:string[]};
  compositional_deconstruction:{background:string;elements:Array<IdeogramObjectElement|IdeogramTextElement>};
};

export type IdeogramCaptionStrategy=NonNullable<CreativeImageOptions["ideogramCaptionStrategy"]>;
export const IDEOGRAM_CAPTION_ADAPTER_VERSION="ideogram-caption-v2";
export const IDEOGRAM_CAPTION_SCHEMA_VERSION=2;
export const IDEOGRAM_CAPTION_MAX_CHARS=4_000;

const clean=(value:unknown,max=900)=>String(value??"").replace(/\s+/g," ").trim().slice(0,max);
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
const properties=(fact:CreativeFact)=>record(fact.properties);
const factText=(fact:CreativeFact)=>{const values=properties(fact);const structural=values.exact_text??values.lens??values.camera_direction??values.lighting??values.brand_name??values.motion??values.materials??values.palette??values.safe_area??values.font_family;const normalizedStructural=Array.isArray(structural)?structural.join(", "):structural&&typeof structural==="object"?JSON.stringify(structural):structural;const primary=values.text??values.instruction??values.description??values.value??values.label??normalizedStructural;const colors=Array.isArray(values.colors)?values.colors.map((value)=>clean(value,35)).filter(Boolean):[];const palette=Array.isArray(values.palette)?values.palette.map((value)=>clean(value,80)).filter(Boolean):[];return clean([...new Set([primary,...colors,...palette].map((value)=>clean(value)).filter(Boolean))].join(" · "));};
const factType=(fact:CreativeFact)=>clean(fact.type??fact.role,80).toLowerCase();
const factIntent=(fact:CreativeFact)=>clean(fact.intent??fact.effect??properties(fact).intent,40).toLowerCase();
const factWeight=(fact:CreativeFact)=>Number(properties(fact).weight??1);
const isAvoid=(fact:CreativeFact)=>[factIntent(fact),clean(fact.effect,40).toLowerCase(),factType(fact)].some((value)=>["avoid","prohibit","must_not_include","exclusion"].includes(value));
const factsFrom=(snapshot:Record<string,unknown>)=>Array.isArray(snapshot.facts)?(snapshot.facts as CreativeFact[]).filter((fact)=>fact&&promptFactIsActive(fact)&&(factText(fact)||fact.locked===true||properties(fact).locked===true||properties(fact).required===true||properties(fact).authority==="locked")):[];
const unique=(items:string[])=>[...new Set(items.map((item)=>clean(item)).filter(Boolean))];
const joined=(facts:CreativeFact[],type:string)=>unique(facts.filter((fact)=>factType(fact)===type&&!isAvoid(fact)).map(factText)).join("; ");
const scopeFor=(fact:CreativeFact)=>record(properties(fact).spatial_scope);
const hasLocalScope=(fact:CreativeFact)=>{const kind=clean(scopeFor(fact).kind,40).toLowerCase();return Boolean(kind&&kind!=="document");};
const joinedGlobal=(facts:CreativeFact[],type:string)=>unique(facts.filter((fact)=>factType(fact)===type&&!isAvoid(fact)&&!hasLocalScope(fact)&&!combinedContextMemberships(properties(fact)).length).map(factText)).join("; ");
const exactText=(value:string)=>value.match(/[“"]([^”"]{1,180})[”"]/)?.[1]?.trim()??"";

const NAMED_COLORS:Record<string,string>={
  "midnight blue":"#191970","warm brass":"#B08D57","chalk white":"#F5F5E8","ember-orange":"#D95F18",
  "sea green":"#2E8B78",limestone:"#D8D2C4","faded coral":"#D98578","ink black":"#171717",aubergine:"#5B2C4A",
  "tobacco brown":"#7B4B2A","rice-paper cream":"#F2E8CF","signal red":"#D62828",celadon:"#ACE1AF",bone:"#E3DAC9",
  "iron oxide":"#A64B2A",cobalt:"#0047AB","lichen green":"#7A8B58",rust:"#B55233","concrete gray":"#8D918D",
  "safety yellow":"#F4C430",ivory:"#FFFFF0","carbon black":"#1C1C1C",vermilion:"#E34234","muted gold":"#C2A45D",
  "deep leaf green":"#1F5D42","snow blue":"#D7E9F7","warm glass amber":"#D89B45","soft violet":"#A78BB8",
  "tomato red":"#D94A3A","stainless silver":"#BFC3C5",charcoal:"#36454F","herb green":"#4F7942",ochre:"#CC7722",
  ultramarine:"#120A8F","dusty rose":"#C98C8C","uncoated white":"#F4F0E6",navy:"#000080",verdigris:"#43B3AE","fog gray":"#B7BDC2",
};

function paletteColors(value:string){
  const literal=[...value.matchAll(/#[0-9a-f]{6}/gi)].map((match)=>match[0].toUpperCase());
  const named=value.toLowerCase().split(/,|;|\band\b/).map((part)=>part.trim().replace(/^[^a-z]+|[^a-z-]+$/g,"")).map((part)=>NAMED_COLORS[part]).filter(Boolean);
  return unique([...literal,...named]).slice(0,16);
}

function bboxFor(fact:CreativeFact):[number,number,number,number]|undefined{
  const scope=scopeFor(fact);if(clean(scope.kind,40).toLowerCase()!=="aabb")return;
  const box=record(scope.aabb);const x=Math.max(0,Math.min(1,Number(box.x??0))),y=Math.max(0,Math.min(1,Number(box.y??0)));
  const width=Math.max(0,Math.min(1-x,Number(box.width??1))),height=Math.max(0,Math.min(1-y,Number(box.height??1)));
  return[Math.round(y*1000),Math.round(x*1000),Math.round((y+height)*1000),Math.round((x+width)*1000)];
}

function scopeDescription(fact:CreativeFact){
  const scope=scopeFor(fact);const kind=clean(scope.kind,40).toLowerCase();if(!kind||kind==="document")return"";
  if(kind==="aabb"){const box=bboxFor(fact);return box?`Confine this decision to bbox [${box.join(", ")}] in [y_min, x_min, y_max, x_max] coordinates; do not extend it beyond that region.`:"";}
  const label=clean(scope.label??scope.name??scope.region??scope.subject_label,180);
  if(kind==="subject")return label?`Apply this to ${label} and its immediate area.`:"Apply this to the named subject and its immediate area.";
  if(kind==="path"||kind==="clipping_path")return label?`Apply this only inside the ${label} clipping path.`:"Apply this only inside the authored clipping path.";
  return label?`Apply this only within ${label}.`:`Apply this only within the authored ${kind.replaceAll("_"," ")} region.`;
}

function standingAvoids(snapshot:Record<string,unknown>){
  const standing=Array.isArray(snapshot.standing_constraints)?snapshot.standing_constraints as Array<Record<string,unknown>>:[];
  return standing.filter((item)=>["avoid","prohibit","forbid"].includes(clean(item.polarity,30).toLowerCase())).map((item)=>clean(item.value,500));
}

function referenceDescription(reference:ImageReference|undefined){
  if(!reference)return"";
  if(reference.mode==="preserve_subject")return"Use the attached reference pixels only to preserve the recognizable subject and defining physical traits.";
  if(reference.mode==="preserve_style")return"Use the attached reference pixels only for visual treatment, texture, mark-making, and color behavior.";
  if(reference.mode==="preserve_composition")return"Use the attached reference pixels only as a layout guide for framing, balance, depth, and spatial relationships; replace the source content.";
  return"Use the attached reference pixels only as loose inspiration for visual rhythm and balance; authored content remains authoritative.";
}

function captionStyle(facts:CreativeFact[],direction:Record<string,unknown>,canonicalPrompt:string){
  const mood=joinedGlobal(facts,"mood"),paletteFacts=facts.filter((fact)=>factType(fact)==="palette"&&!isAvoid(fact)),palette=joinedGlobal(facts,"palette")||(!paletteFacts.length?(Array.isArray(direction.palette)?direction.palette.join(", "):clean(direction.palette)):"");
  const lighting=joined(facts,"lighting")||`intentional editorial lighting${mood?` supporting ${mood}`:" with controlled contrast"}`;
  const style=joined(facts,"style");const source=`${style} ${clean(direction.scene,500)} ${clean(canonicalPrompt,500)}`;
  const colors=paletteColors(palette);const aesthetics=unique([mood,palette,"resolved, coherent, suitable for professional creative review"]).join(", ");
  if(/\b(photo(?:graph|graphic|realism)?|camera|lens|35mm|50mm|85mm|depth of field)\b/i.test(source)){
    return{aesthetics,lighting,photo:style||"naturalistic editorial photography, deliberate framing, precise focus",medium:"photograph" as const,...(colors.length?{color_palette:colors}:{})};
  }
  return{aesthetics,lighting,medium:"illustration",art_style:style||"polished editorial illustration with precise material rendering and restrained detail",...(colors.length?{color_palette:colors}:{})};
}

function trimCaption(caption:IdeogramCaption){
  let prompt=JSON.stringify(caption);if(prompt.length<=IDEOGRAM_CAPTION_MAX_CHARS)return{caption,prompt,compacted:false};
  const compact=structuredClone(caption);compact.high_level_description=clean(compact.high_level_description,500);compact.style_description.aesthetics=clean(compact.style_description.aesthetics,320);compact.style_description.lighting=clean(compact.style_description.lighting,220);
  compact.compositional_deconstruction.background=clean(compact.compositional_deconstruction.background,520);
  compact.compositional_deconstruction.elements=compact.compositional_deconstruction.elements.map((element)=>({...element,desc:clean(element.desc,520)}));prompt=JSON.stringify(compact);
  if(prompt.length>IDEOGRAM_CAPTION_MAX_CHARS){for(const element of compact.compositional_deconstruction.elements)element.desc=clean(element.desc,280);prompt=JSON.stringify(compact);}
  return{caption:compact,prompt,compacted:true};
}

const sameKeys=(value:Record<string,unknown>,expected:string[])=>Object.keys(value).join("|")===expected.join("|");
export function validateIdeogramCaption(value:unknown){
  const issues:string[]=[];const caption=record(value);
  if(!sameKeys(caption,["high_level_description","style_description","compositional_deconstruction"]))issues.push("caption top-level keys are missing, unknown, or out of order");
  if(!clean(caption.high_level_description))issues.push("high_level_description is required");
  const style=record(caption.style_description);const photo="photo" in style,art="art_style" in style;
  if(photo===art)issues.push("style_description must contain exactly one of photo or art_style");
  const expectedStyle=photo?["aesthetics","lighting","photo","medium",...("color_palette" in style?["color_palette"]:[])]:["aesthetics","lighting","medium","art_style",...("color_palette" in style?["color_palette"]:[])];
  if(!sameKeys(style,expectedStyle))issues.push("style_description keys are missing, unknown, or out of order");
  const composition=record(caption.compositional_deconstruction);if(!sameKeys(composition,["background","elements"]))issues.push("compositional_deconstruction must contain background then elements");
  if(!clean(composition.background))issues.push("compositional_deconstruction.background is required");
  if(!Array.isArray(composition.elements))issues.push("compositional_deconstruction.elements must be an array");
  for(const [index,item] of (Array.isArray(composition.elements)?composition.elements:[]).entries()){
    const element=record(item);const type=element.type;const expected=type==="text"?["type",...("bbox" in element?["bbox"]:[]),"text","desc",...("color_palette" in element?["color_palette"]:[])]:["type",...("bbox" in element?["bbox"]:[]),"desc",...("color_palette" in element?["color_palette"]:[])];
    if(type!=="obj"&&type!=="text")issues.push(`element ${index} has an unsupported type`);if(!sameKeys(element,expected))issues.push(`element ${index} keys are missing, unknown, or out of order`);if(!clean(element.desc))issues.push(`element ${index} desc is required`);if(type==="text"&&!clean(element.text))issues.push(`element ${index} text is required`);
    if("bbox" in element){const box=element.bbox;if(!Array.isArray(box)||box.length!==4||box.some((part)=>!Number.isInteger(part)||part<0||part>1000)||Number(box[0])>=Number(box[2])||Number(box[1])>=Number(box[3]))issues.push(`element ${index} bbox must be ordered integer coordinates from 0 to 1000`);}
    if("color_palette" in element&&(!Array.isArray(element.color_palette)||element.color_palette.some((color)=>!/^#[0-9A-F]{6}$/.test(String(color)))))issues.push(`element ${index} color_palette must use uppercase #RRGGBB values`);
  }
  for(const colors of [style.color_palette])if(colors!==undefined&&(!Array.isArray(colors)||colors.length>16||colors.some((color)=>!/^#[0-9A-F]{6}$/.test(String(color)))))issues.push("style color_palette must contain at most 16 uppercase #RRGGBB values");
  return{valid:issues.length===0,issues};
}

export type IdeogramCaptionAdaptation={prompt:string;caption:IdeogramCaption;adapterVersion:string;schemaVersion:number;strategy:IdeogramCaptionStrategy;canonicalPromptLength:number;providerPromptLength:number;compacted:boolean;promptTechnique:PromptTechnique;includedBlockIds:string[];omittedBlockIds:string[];mandatorySubjectBlockIds:string[];subjectElementCount:number;textElementCount:number;spatialElementCount:number;materialElementCount:number;omittedOptionalTypography:boolean;referenceMode:string|null;valid:boolean;issues:string[]};

export function buildIdeogramCaption(snapshot:Record<string,unknown>,direction:Record<string,unknown>,canonicalPrompt:string,references:ImageReference[],options:Pick<CreativeImageOptions,"quality"|"size"|"promptTechnique"|"ideogramCaptionStrategy">={}):IdeogramCaptionAdaptation{
  const strategy=options.ideogramCaptionStrategy??"balanced";const facts=factsFrom(snapshot),positive=facts.filter((fact)=>!isAvoid(fact)),negative=facts.filter(isAvoid);const subjects=positive.filter((fact)=>factType(fact)==="subject");const settings=joinedGlobal(facts,"setting");const composition=joinedGlobal(facts,"composition");const material=joinedGlobal(facts,"material");const scene=clean(direction.scene,800)||clean(direction.title,300)||clean(canonicalPrompt,800);
  const authoredHardDecisions=requiredContextAdaptationFacts(snapshot);
  const hardDecisionByFact=new Map(authoredHardDecisions.map((decision)=>[decision.fact,decision]));
  const negativeDirection=(fact:CreativeFact)=>hardDecisionByFact.get(fact as Record<string,unknown>)?.direction??factText(fact);
  const subjectDirection=(fact:CreativeFact)=>{const memberships=combinedContextMemberships(properties(fact));return memberships.length?memberships.map((membership)=>`${membership.role.replaceAll("_"," ")} ${membership.target}: ${factText(fact)}`).join("; "):factText(fact);};
  const negativeScopes=partitionContextAdaptationFactScopes(negative);
  const scopedExclusionDirectives=negativeScopes.scoped.flatMap(({fact,memberships})=>memberships.map((membership)=>`Target-scoped exclusion for ${membership.role.replaceAll("_"," ")} ${membership.target}: Exclude ${negativeDirection(fact)} only from ${membership.target}; other targets remain unaffected.`));
  const standingAffirmations=(Array.isArray(snapshot.standing_constraints)?snapshot.standing_constraints as Array<Record<string,unknown>>:[]).filter((item)=>["affirm","include","required"].includes(clean(item.polarity,30).toLowerCase())).map((item)=>`Required ${clean(item.axis??"creative direction",70)}: ${clean(item.value,450)}.`);
  const summary=unique([...standingAffirmations,subjects.length?`Depict ${subjects.map(subjectDirection).join("; ")}${settings?` in ${settings}`:""}.`:"",scene,composition?`Required composition: ${composition}.`:""]).join(" ");const exclusions=unique([...negativeScopes.global.map(negativeDirection),...standingAvoids(snapshot)]);const reference=referenceDescription(references[0]);
  const background=unique([settings||"A coherent environment supporting the named subject and action.",composition?`Required composition: ${composition}.`:"",reference,exclusions.length?`Exclude ${exclusions.join("; ")}.`:""]).join(" ");
  const paletteFacts=positive.filter((fact)=>factType(fact)==="palette"),globalPalette=paletteColors(joinedGlobal(facts,"palette")||(!paletteFacts.length?(Array.isArray(direction.palette)?direction.palette.join(", "):clean(direction.palette)):""));const elements:Array<IdeogramObjectElement|IdeogramTextElement>=subjects.map((fact)=>{
    const bbox=bboxFor(fact);const local=scopeDescription(fact);const desc=unique([`Required primary subject and action: ${subjectDirection(fact)}. Show the complete subject and action, not an object-only substitute.`,material?`Render the named subject with visibly distinct materials: ${material}.`:"",local,exclusions.length?`Do not include ${exclusions.join("; ")}.`:""]).join(" ");return{type:"obj" as const,...(bbox?{bbox}:{}),desc,...(globalPalette.length?{color_palette:globalPalette.slice(0,5)}:{})};
  });
  const scopedFacts=positive.filter((fact)=>hasLocalScope(fact)&&factType(fact)!=="format"&&factType(fact)!=="typography"&&!subjects.includes(fact));for(const fact of scopedFacts){const type=factType(fact)||"decision";const bbox=bboxFor(fact);const localPalette=type==="palette"?paletteColors(factText(fact)):[];const desc=unique([`Required local ${type}: ${factText(fact)}.`,scopeDescription(fact),strategy==="spatial_strict"||strategy==="spatial_material"?"All visible effects of this decision must remain inside the named region; preserve the existing visual treatment outside it.":""]).join(" ");elements.push({type:"obj",...(bbox?{bbox}:{}),desc,...(localPalette.length?{color_palette:localPalette.slice(0,5)}:{})});}
  if(["material_explicit","spatial_material","all_facts"].includes(strategy)&&material)elements.push({type:"obj",desc:`Required material system: ${material}. Every named material must be visibly present, materially distinguishable, and applied to an appropriate authored object rather than reduced to color alone.`});
  if(["spatial_strict","spatial_material","all_facts"].includes(strategy)&&composition)elements.push({type:"obj",desc:`Required compositional structure: ${composition}. Treat named counts, ordering, interruptions, and relative placement as literal visible requirements.`});
  if(strategy==="all_facts"){for(const fact of positive.filter((item)=>!subjects.includes(item)&&!scopedFacts.includes(item)&&!["format","typography","setting","composition","material","palette","mood","lighting","style","direction"].includes(factType(item))))elements.push({type:"obj",desc:`Required ${factType(fact)||"visual decision"}: ${factText(fact)}.`});}
  const typography=positive.filter((fact)=>factType(fact)==="typography");const requiredTypography=typography.filter((fact)=>factIntent(fact)==="include"||factWeight(fact)>=.7);for(const fact of requiredTypography){const text=exactText(factText(fact));if(!text)continue;const bbox=bboxFor(fact);elements.push({type:"text",...(bbox?{bbox}:{}),text,desc:unique([`Render “${text}” exactly once with deliberate, legible placement.`,scopeDescription(fact)]).join(" ")});}
  const hardDecisions=authoredHardDecisions.filter((decision)=>!isAvoid(decision.fact as CreativeFact));const hardExclusions=authoredHardDecisions.filter((decision)=>isAvoid(decision.fact as CreativeFact));for(const decision of hardDecisions){const membership=combinedContextMemberships(decision.properties)[0];elements.push({type:"obj",desc:`Mandatory authored ${decision.type}${membership?` for ${membership.role.replaceAll("_"," ")} ${membership.target}`:""}: ${decision.direction}. Preserve this exact requirement.`});}
  for(const directive of scopedExclusionDirectives)elements.push({type:"obj",desc:directive});
  const factsById=new Map(facts.map((fact)=>[clean(fact.block_id,160),fact]));for(const group of combinedContextGroups(snapshot)){const members=group.members.filter((member)=>!factsById.has(member.blockId)||!isAvoid(factsById.get(member.blockId)!)).map((member)=>`${member.role}: ${factsById.has(member.blockId)?factText(factsById.get(member.blockId)!):clean(member.label,180)}`).join("; ");elements.push({type:"obj",desc:`Combined Context ${group.role.replaceAll("_"," ")} ${group.target}: ${members}. Apply every member only to ${group.target}; ${group.application.replaceAll("_"," ")}; never transfer these decisions to another target.`});}
  if(!elements.some((item)=>item.type==="obj"))elements.push({type:"obj",desc:summary||"The primary authored subject and action."});
  const bounded=trimCaption({high_level_description:summary,style_description:captionStyle(facts,direction,canonicalPrompt),compositional_deconstruction:{background,elements}});const validation=validateIdeogramCaption(bounded.caption);
  if(bounded.prompt.length>IDEOGRAM_CAPTION_MAX_CHARS)validation.issues.push(`serialized caption exceeds ${IDEOGRAM_CAPTION_MAX_CHARS} characters`);
  const readableCaption=[bounded.caption.high_level_description,bounded.caption.style_description.aesthetics,bounded.caption.style_description.lighting,bounded.caption.compositional_deconstruction.background,...bounded.caption.compositional_deconstruction.elements.map((element)=>element.desc)].join("\n");
  for(const decision of hardDecisions)if(!decision.direction||!readableCaption.includes(decision.direction))validation.issues.push(`mandatory ${decision.type} decision ${decision.blockId||"without identifier"} did not survive caption compaction`);
  for(const decision of hardExclusions)if(!decision.direction||!readableCaption.includes(decision.direction))validation.issues.push(`mandatory ${decision.type} exclusion ${decision.blockId||"without identifier"} did not survive caption compaction`);
  for(const affirmation of standingAffirmations)if(!bounded.prompt.includes(affirmation))validation.issues.push("an affirmed standing creative requirement did not survive caption compaction");
  for(const exclusion of exclusions)if(!readableCaption.includes(exclusion))validation.issues.push("a forbidden standing creative requirement did not survive caption compaction");
  for(const exclusion of scopedExclusionDirectives)if(!readableCaption.includes(exclusion))validation.issues.push("a target-scoped forbidden creative requirement did not survive caption compaction");
  const coveredFacts=facts.filter((fact)=>{const value=factText(fact);const quoted=factType(fact)==="typography"?exactText(value):"";return Boolean(value&&readableCaption.includes(value))||Boolean(quoted&&bounded.prompt.includes(quoted));});
  return{prompt:bounded.prompt,caption:bounded.caption,adapterVersion:IDEOGRAM_CAPTION_ADAPTER_VERSION,schemaVersion:IDEOGRAM_CAPTION_SCHEMA_VERSION,strategy,canonicalPromptLength:canonicalPrompt.length,providerPromptLength:bounded.prompt.length,compacted:bounded.compacted,promptTechnique:(options.promptTechnique??"prose") as PromptTechnique,includedBlockIds:coveredFacts.map((fact)=>clean(fact.block_id,160)).filter(Boolean),omittedBlockIds:facts.filter((fact)=>!coveredFacts.includes(fact)).map((fact)=>clean(fact.block_id,160)).filter(Boolean),mandatorySubjectBlockIds:subjects.map((fact)=>clean(fact.block_id,160)).filter(Boolean),subjectElementCount:bounded.caption.compositional_deconstruction.elements.filter((item)=>item.type==="obj").length,textElementCount:bounded.caption.compositional_deconstruction.elements.filter((item)=>item.type==="text").length,spatialElementCount:bounded.caption.compositional_deconstruction.elements.filter((item)=>Boolean(item.bbox)).length,materialElementCount:bounded.caption.compositional_deconstruction.elements.filter((item)=>item.type==="obj"&&/material/i.test(item.desc)).length,omittedOptionalTypography:Boolean(typography.length&&!requiredTypography.length),referenceMode:references[0]?.mode??null,valid:validation.issues.length===0,issues:validation.issues};
}
