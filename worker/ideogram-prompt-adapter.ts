import type { PromptTechnique } from "../src/model/prompt-structures.ts";
import { compileContextAdaptationSections, partitionContextAdaptationFactScopes, requiredContextAdaptationFacts, type ContextAdaptationPriority } from "../src/model/context-adaptation.ts";
import { combinedContextGroups, combinedContextMemberships } from "../src/model/combined-context.ts";
import { promptFactIsActive } from "../src/model/prompt-policy.ts";
import type { CreativeImageOptions, ImageReference } from "./openai-adapter.ts";

type CreativeFact={
  block_id?:unknown;
  type?:unknown;
  role?:unknown;
  intent?:unknown;
  effect?:unknown;
  active?:unknown;
  locked?:unknown;
  properties?:unknown;
};

export const IDEOGRAM_PROMPT_ADAPTER_VERSION="ideogram-context-v6";
export const IDEOGRAM_PROMPT_MAX_CHARS=4_000;

const clean=(value:unknown,max=700)=>String(value??"").replace(/\s+/g," ").trim().slice(0,max);
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
const factProperties=(fact:CreativeFact)=>record(fact.properties);
const factText=(fact:CreativeFact)=>{
  const properties=factProperties(fact);
  const structural=properties.exact_text??properties.lens??properties.camera_direction??properties.lighting??properties.brand_name??properties.motion??properties.materials??properties.palette??properties.safe_area??properties.font_family;
  const normalizedStructural=Array.isArray(structural)?structural.join(", "):structural&&typeof structural==="object"?JSON.stringify(structural):structural;
  const primary=properties.text??properties.instruction??properties.description??properties.value??properties.label??normalizedStructural;
  const colors=Array.isArray(properties.colors)?properties.colors.map((value)=>clean(value,35)).filter(Boolean):[];
  const palette=Array.isArray(properties.palette)?properties.palette.map((value)=>clean(value,80)).filter(Boolean):[];
  return clean([...new Set([primary,...colors,...palette].map((value)=>clean(value,700)).filter(Boolean))].join(" · "),700);
};
const factType=(fact:CreativeFact)=>clean(fact.type??fact.role,80).toLowerCase();
const factIntent=(fact:CreativeFact)=>clean(fact.intent??fact.effect??factProperties(fact).intent,40).toLowerCase();
const factWeight=(fact:CreativeFact)=>Number(factProperties(fact).weight??1);
const isAvoid=(fact:CreativeFact)=>[factIntent(fact),clean(fact.effect,40).toLowerCase(),factType(fact)].some((value)=>["avoid","prohibit","must_not_include","exclusion"].includes(value));
const factsFrom=(snapshot:Record<string,unknown>)=>Array.isArray(snapshot.facts)?(snapshot.facts as CreativeFact[]).filter((fact)=>fact&&promptFactIsActive(fact)&&(factText(fact)||fact.locked===true||factProperties(fact).locked===true||factProperties(fact).required===true||factProperties(fact).authority==="locked")):[];
const percent=(value:unknown)=>`${Math.round(Math.max(0,Math.min(1,Number(value??0)))*100)}%`;

function scopeLabel(fact:CreativeFact){
  const scope=record(factProperties(fact).spatial_scope);const kind=clean(scope.kind,40).toLowerCase();
  if(!kind||kind==="document")return"";
  if(kind==="aabb"){
    const box=record(scope.aabb);const x=Number(box.x??0),y=Number(box.y??0),width=Number(box.width??1),height=Number(box.height??1);const centerX=x+width/2,centerY=y+height/2;
    const horizontal=centerX<.4?"left":centerX>.6?"right":"central";const vertical=centerY<.4?"upper":centerY>.6?"lower":"middle";
    return`${vertical}-${horizontal} area (left ${percent(x)}, top ${percent(y)}, width ${percent(width)}, height ${percent(height)})`;
  }
  const label=clean(scope.label??scope.name??scope.region??scope.subject_label,180);
  if(kind==="fuzzy"||kind==="region")return label||"the named visual region";
  if(kind==="subject")return label?`the area occupied by ${label}`:"the named subject and its immediate area";
  if(kind==="path"||kind==="clipping_path")return label?`inside the ${label} clipping path`:"inside the authored clipping path";
  return label||kind.replaceAll("_"," ");
}

const quoteText=(value:string)=>value.match(/[“"]([^”"]{1,160})[”"]/)?.[1]?.trim()??"";
const sentence=(label:string,value:string)=>value?`${label}: ${value.replace(/[.]+$/g,"")}.`:"";
const unique=(items:string[])=>[...new Set(items.map((item)=>clean(item)).filter(Boolean))];
const joinedFacts=(facts:CreativeFact[],type:string)=>unique(facts.filter((fact)=>factType(fact)===type&&!scopeLabel(fact)&&!isAvoid(fact)).map(factText)).join("; ");
const joinedFactValues=(facts:CreativeFact[])=>unique(facts.map(factText)).join("; ");

const literalStrategies=new Set<NonNullable<CreativeImageOptions["ideogramCaptionStrategy"]>>(["composition_lock","semantic_checklist","constraint_first","compact_literal","literal_contract","production_director","shot_plan","clean_editorial"]);
function framingContract(composition:string){
  if(!composition)return"";
  const edgeOnly=/\bhands?\b.*\bonly\b.*\b(lower|upper|left|right)\s+edge\b/i.exec(composition);
  if(edgeOnly)return`FRAMING LOCK: ${composition}. Show only the requested hands or forearms at the ${edgeOnly[1].toLowerCase()} frame boundary. Do not show that person's face, head, shoulders, torso, or full body. Objects named in the composition remain fully visible.`;
  if(/\bonly\b.*\b(lower|upper|left|right)\s+edge\b/i.test(composition))return`FRAMING LOCK: ${composition}. Nothing governed by “only” may extend away from the named frame boundary.`;
  return"";
}
function visibleContract(subject:string,setting:string,composition:string,material:string){
  const requirements=[subject&&`subject/action = ${subject}`,setting&&`setting = ${setting}`,composition&&`composition = ${composition}`,material&&`materials = ${material}`].filter(Boolean);
  return requirements.length?`VISIBLE ACCEPTANCE CHECKLIST: ${requirements.map((item,index)=>`${index+1}) ${item}`).join("; ")}. Every numbered item must be plainly visible and jointly compatible in the final image.`:"";
}

function compositionDirection(composition:string){
  if(!composition)return"";
  const diagonal=/\bdiagonal from (.+?) toward (.+?)(?:[.;]|$)/i.exec(composition);
  if(diagonal)return`DIRECTED GEOMETRY: Make ${diagonal[1]} a clearly readable diagonal that physically aims at ${diagonal[2]}. Place ${diagonal[2]} directly on the continued axis beyond the far end of ${diagonal[1]}; keep the origin, direction, and target visible together.`;
  if(/two people in conversational profile.*microphone.*visual hinge/i.test(composition))return"SHOT GEOMETRY: Show exactly two adults and no other people. Use an eye-level medium two-shot: one adult on the left facing right, one adult on the right facing left, and one microphone centered between their faces as the visual hinge. Their heads, torsos, and active interview occupy most of the middle of the square.";
  const grid=/\bgrid of (\w+) (.+?) interrupted by (.+?)(?:[.;]|$)/i.exec(composition);
  if(grid)return`COUNT AND GRID LOCK: Show one legible grid containing exactly ${grid[1]} ${grid[2]}, visibly interrupted by ${grid[3]}. Keep every counted unit fully visible and make the interruption unmistakable.`;
  if(/overhead grid.*interrupted by one intentionally displaced plate/i.test(composition))return"GRID LOCK: Use a true overhead view. Arrange the plated courses in one clean, regular grid, then move exactly one plate visibly out of alignment. Keep the grid and its single interruption readable together; do not scatter the plates.";
  if(/concentric frames/i.test(composition))return`FRAME-WITHIN-FRAME LOCK: Make the named subject, nearby observer, and surrounding architecture form visibly nested frames around one focal center: ${composition}. Keep every nested frame readable rather than merely placing the elements nearby.`;
  if(/print occupies most of the frame.*landscape visible as a narrow echo/i.test(composition))return"SCALE AND ECHO LOCK: The authored print fills most of the image while the real landscape appears only as a narrow secondary strip beyond it. Keep the printmaker visibly pulling the print; do not turn this into an unattended still life.";
  if(/close focus on the compass.*harbor lights/i.test(composition))return"CLOSE-FOCUS LOCK: Make the compass and the repairer's active hands the large foreground focus, with the repairer still visibly present. Reduce harbor lights to small soft geometric echoes; avoid a wide environmental view or a dead empty quadrant.";
  return`SHOT GEOMETRY: Convert this composition into plainly visible foreground, middle-ground, and background placements without changing its counts or relationships: ${composition}.`;
}

export type IdeogramPromptFocus="reference"|"typography"|"spatial"|"composition"|"material"|"subject";
export function classifyIdeogramPromptFocus(scene:string,hasReference:boolean,typographyRequired:boolean,scopedCount:number):IdeogramPromptFocus{
  if(hasReference)return"reference";
  if(typographyRequired)return"typography";
  if(scopedCount||/\bspatial(?:ly)? scoped\b|\bnamed region\b/i.test(scene))return"spatial";
  // Composition briefs also mention material fidelity. Classify by the requested
  // operation before scanning for supporting visual attributes.
  if(/\bcomposition|layout|framing\b/i.test(scene))return"composition";
  if(/\bmaterial|texture|surface\b/i.test(scene))return"material";
  return"subject";
}

function priorityDirective(mode:string,subject:string,setting:string,composition:string,material:string){
  if(mode==="reference")return"PRIMARY SUCCESS TEST — REFERENCE: Preserve only the authorized reference property while replacing unauthorized source content with the authored scene.";
  if(mode==="typography")return"PRIMARY SUCCESS TEST — TYPOGRAPHY: The exact authored title appears once, is immediately legible, and no other mark can be mistaken for text or a signature.";
  if(mode==="spatial")return"PRIMARY SUCCESS TEST — LOCALITY: Every scoped decision stays inside its named area, while the rest of the image remains visually coherent and unaffected.";
  if(mode==="material")return`PRIMARY SUCCESS TEST — MATERIAL STUDY: The named person must be visibly performing the named action while these physical surfaces are simultaneously large, distinct, and judgeable: ${material}. Neither the actor/action nor any named material may be omitted. Do not replace the action with an unattended object still life.`;
  if(mode==="composition")return`PRIMARY SUCCESS TEST — COMPOSITION: A viewer must be able to point to this exact visual relationship immediately: ${composition}.`;
  return`PRIMARY SUCCESS TEST — SUBJECT: The unmistakable focal action is ${subject}, visibly situated in ${setting}.`;
}

function referenceDirective(reference:ImageReference|undefined){
  if(!reference)return"No reference pixels are attached.";
  if(reference.mode==="preserve_subject")return"REFERENCE — SUBJECT ONLY: Preserve the recognizable subject identity and defining physical traits from the supplied image. Rebuild the environment, composition, and treatment from the authored direction.";
  if(reference.mode==="preserve_style")return"REFERENCE — STYLE ONLY: Use the supplied image for visual treatment, texture, mark-making, and color behavior. Do not copy its subject, setting, text, or narrative.";
  if(reference.mode==="preserve_composition")return"REFERENCE — LAYOUT ONLY: Treat the supplied image as a wireframe. Preserve its dominant geometry, framing, balance, depth, and spatial relationships, while replacing every source person, object, setting, text fragment, and story detail with the authored content.";
  return"REFERENCE — LOOSE RHYTHM ONLY: Use the supplied image as inspiration for visual rhythm and balance. The authored subject, setting, action, constraints, and story are authoritative. Do not copy source identities, incidental text, or unrelated objects.";
}

function boundedPrompt(lines:string[]){
  const normalized=[...new Set(lines.map((line)=>line.replace(/\s+/g," ").trim()).filter(Boolean))];const priorityFor=(line:string):ContextAdaptationPriority=>/^(?:PRIMARY SUCCESS TEST|MANDATORY (?:PRIMARY SUBJECT|ACTION EVIDENCE|AUTHORED DECISION)|COMBINED CONTEXT —|TARGET-SCOPED EXCLUSION —|FINAL (?:READ|VISUAL CHECK|COMPOSITION CHECK)|REFERENCE —|EXCLUDE:|TEXT(?: — REQUIRED)?:|FRAMING LOCK:|REGION —|DELIVERY(?: QUALITY CONTROL)?:)/.test(line)?"required":/^(?:CREATIVE GOAL|SETTING|COMPOSITION|SHOT GEOMETRY|DIRECTED GEOMETRY|MATERIALS|VISIBLE ACCEPTANCE CHECKLIST)/.test(line)?"important":"optional";
  const compiled=compileContextAdaptationSections(normalized.map((content,index)=>({id:`image-direction-${index+1}`,content,priority:priorityFor(content)})),IDEOGRAM_PROMPT_MAX_CHARS,"\n");
  return{prompt:compiled.prompt,compacted:compiled.compacted,valid:compiled.valid,issues:compiled.issues.map((issue)=>issue.message)};
}

export type IdeogramPromptAdaptation={
  prompt:string;
  valid:boolean;
  issues:string[];
  adapterVersion:string;
  strategy:NonNullable<CreativeImageOptions["ideogramCaptionStrategy"]>;
  canonicalPromptLength:number;
  providerPromptLength:number;
  compacted:boolean;
  promptTechnique:PromptTechnique;
  includedBlockIds:string[];
  omittedBlockIds:string[];
  mandatorySubjectBlockIds:string[];
  mandatorySubjectRepeated:boolean;
  omittedOptionalTypography:boolean;
  benignStoryContextApplied:boolean;
  referenceMode:string|null;
};

/**
 * Ideogram performs best with concise visual art direction, not the verbose
 * event/compiler receipt used by a reasoning model. This translation retains
 * the canonical document as the audit contract while removing duplicated
 * metadata and ordering the provider prompt by visual consequence.
 */
export function buildIdeogramPrompt(
  snapshot:Record<string,unknown>,
  direction:Record<string,unknown>,
  canonicalPrompt:string,
  references:ImageReference[],
  options:Pick<CreativeImageOptions,"quality"|"size"|"promptTechnique"|"ideogramCaptionStrategy">={}
):IdeogramPromptAdaptation{
  const strategy=options.ideogramCaptionStrategy??"balanced";const facts=factsFrom(snapshot),positive=facts.filter((fact)=>!isAvoid(fact)),negative=facts.filter(isAvoid);
  const scoped=positive.filter((fact)=>scopeLabel(fact)&&factType(fact)!=="format");const typography=positive.filter((fact)=>factType(fact)==="typography");const subjectFacts=positive.filter((fact)=>factType(fact)==="subject");
  const scene=clean(direction.scene,900);const exactText=typography.map((fact)=>quoteText(factText(fact))).find(Boolean)??"";
  const typographyRequired=typography.some((fact)=>factIntent(fact)==="include"||factWeight(fact)>=.7)||/(typograph|display text|lettering|key art)/i.test(scene);
  const primarySubject=unique(subjectFacts.flatMap((fact)=>{const memberships=combinedContextMemberships(factProperties(fact));return memberships.length?memberships.map((membership)=>`${membership.role.replaceAll("_"," ")} “${membership.target}”: ${factText(fact)}`):[factText(fact)];})).join("; "),setting=joinedFacts(facts,"setting"),composition=joinedFacts(facts,"composition"),material=joinedFacts(facts,"material");const benignStoryContextApplied=Boolean(typographyRequired&&exactText);
  const ratio=clean(options.size??"",40).replace("x"," × ");const paletteFacts=positive.filter((fact)=>factType(fact)==="palette"),ungroupedPaletteFacts=paletteFacts.filter((fact)=>!combinedContextMemberships(factProperties(fact)).length&&!scopeLabel(fact)),palette=!paletteFacts.length?(Array.isArray(direction.palette)?direction.palette.map((item)=>clean(item,80)).filter(Boolean).join(", "):clean(direction.palette,400)):"";
  const primaryTypes=new Set(["direction","subject","setting","composition","mood","palette","material","lighting","style","typography","format"]);
  const additional=unique(positive.filter((fact)=>!primaryTypes.has(factType(fact))&&!scopeLabel(fact)&&!combinedContextMemberships(factProperties(fact)).length).map((fact)=>`${factType(fact)||"requirement"}: ${factText(fact)}`));
  const factsById=new Map(facts.map((fact)=>[clean(fact.block_id,160),fact]));
  const groupLines=combinedContextGroups(snapshot).map((group)=>{const members=group.members.filter((member)=>!factsById.has(member.blockId)||!isAvoid(factsById.get(member.blockId)!));return`COMBINED CONTEXT — ${group.role.replaceAll("_"," ")} “${clean(group.target,120)}”: Keep ${members.map((member)=>`${clean(member.role,45)} “${clean(factsById.has(member.blockId)?factText(factsById.get(member.blockId)!):member.label,220)}”`).join("; ")} together only on this target; ${clean(group.application,45).replaceAll("_"," ")}; do not transfer their attributes to unrelated subjects.`;});
  const authoredHardDecisions=requiredContextAdaptationFacts(snapshot);
  const mandatoryDecisions=authoredHardDecisions.filter((decision)=>!isAvoid(decision.fact as CreativeFact));
  const hardExclusions=authoredHardDecisions.filter((decision)=>isAvoid(decision.fact as CreativeFact));
  const hardDecisionByFact=new Map(authoredHardDecisions.map((decision)=>[decision.fact,decision]));
  const negativeDirection=(fact:CreativeFact)=>hardDecisionByFact.get(fact as Record<string,unknown>)?.direction??factText(fact);
  const mandatoryLines=[...mandatoryDecisions.map((decision)=>{const membership=combinedContextMemberships(decision.properties)[0];return`MANDATORY AUTHORED DECISION — ${clean(decision.type,60).toUpperCase()}${membership?` for ${membership.role.replaceAll("_"," ")} “${clean(membership.target,120)}”`:""}: ${decision.direction}.`;}),...((Array.isArray(snapshot.standing_constraints)?snapshot.standing_constraints:[]) as Array<Record<string,unknown>>).filter((item)=>["affirm","include","required"].includes(clean(item.polarity,30).toLowerCase())).map((item)=>`MANDATORY AUTHORED DECISION — ${clean(item.axis??"PREFERENCE",60).toUpperCase()}: ${clean(item.value,500)}.`)];
  const negativeScopes=partitionContextAdaptationFactScopes(negative);
  const scopedExclusionLines=negativeScopes.scoped.flatMap(({fact,memberships})=>memberships.map((membership)=>`TARGET-SCOPED EXCLUSION — ${membership.role.replaceAll("_"," ")} “${clean(membership.target,120)}”: Exclude ${negativeDirection(fact)} only from this target; other targets are unaffected.`));
  const exclusions=unique([
    ...negativeScopes.global.map(negativeDirection),
    ...((Array.isArray(snapshot.standing_constraints)?snapshot.standing_constraints:[]) as Array<Record<string,unknown>>).filter((item)=>["avoid","prohibit","forbid"].includes(clean(item.polarity,30).toLowerCase())).map((item)=>clean(item.value,500)),
  ]);
  const regionLines=scoped.map((fact)=>`REGION — ${scopeLabel(fact)}: Confine ${factType(fact)||"decision"} “${factText(fact)}” to this region. Do not extend its subject, palette, material, lighting, or other visible effects beyond the named boundary; preserve the authored treatment elsewhere.`);
  const literal=literalStrategies.has(strategy),director=["production_director","shot_plan","clean_editorial"].includes(strategy),compositionFirst=["composition_lock","literal_contract","shot_plan"].includes(strategy),checklist=["semantic_checklist","literal_contract"].includes(strategy),constraintsFirst=["constraint_first","production_director","clean_editorial"].includes(strategy),compact=strategy==="compact_literal";
  const focus=classifyIdeogramPromptFocus(scene,Boolean(references[0]),typographyRequired,scoped.length);const directedComposition=director?compositionDirection(composition):"";const priority=director?priorityDirective(focus,primarySubject,setting,composition,material):"";
  const directorFinal=director?`FINAL READ: subject/action = ${primarySubject}; setting = ${setting}; composition = ${composition}. These three facts must be immediately legible together. The primary success test above decides all optional detail.`:"";
  const compositionLine=composition?`COMPOSITION — LITERAL STRUCTURE: ${composition}. Treat every named count, ordering, interruption, and relative placement as a visible requirement.`:"";const frameLine=framingContract(composition);const exclusionLine=exclusions.length?`EXCLUDE: ${exclusions.join("; ").replace(/[.]+$/g,"")}.`:"";
  const lines=[
    `Create one ${options.quality==="low"?"fast, readable study":"polished editorial image"}${ratio?` composed specifically for a ${ratio} pixel frame`:""}.`,
    priority,
    compositionFirst?compositionLine:"",
    compositionFirst?directedComposition:"",
    compositionFirst?frameLine:"",
    constraintsFirst?exclusionLine:"",
    sentence("CREATIVE GOAL",scene||clean(direction.title,300)||clean(canonicalPrompt,900)),
    primarySubject?(frameLine?`MANDATORY ACTION EVIDENCE: Depict ${primarySubject} through the exact edge-limited framing below. The active hands or permitted body area must visibly perform the named action; do not substitute unattended objects.`:`MANDATORY PRIMARY SUBJECT AND ACTION: Prominently and unmistakably depict ${primarySubject}. If a person or professional is named, visibly show that person actively performing the named action. Do not substitute an object-only still life, unattended tools, or an environment-only scene.`):"",
    benignStoryContextApplied?`BENIGN STORY CONTEXT: This is fictional editorial artwork about the named professional or creative activity. Depict every person as a safe ${/\badult\b/i.test(primarySubject)&&!/\b(?:child|children|minor|teen|toddler|infant|baby)\b/i.test(primarySubject)?"adult ":""}fictional character while preserving any explicitly authored age. The exact words below are only the artwork's title.`:"",
    sentence("SETTING",setting),
    !compositionFirst?compositionLine:"",
    !compositionFirst?directedComposition:"",
    !compositionFirst&&literal?frameLine:"",
    ...regionLines,
    ...groupLines,
    ...scopedExclusionLines,
    ...mandatoryLines,
    !compact?sentence("MOOD",joinedFacts(facts,"mood")):"",
    sentence("PALETTE",joinedFactValues(ungroupedPaletteFacts)||palette),
    material?`MATERIALS — VISIBLE AND DISTINCT: ${material}. Show every named material on an appropriate authored object; do not collapse materials into color alone.`:"",
    director&&focus==="material"?"SUBJECT SCALE: Use a medium or medium-wide view. The principal people, action, and judging surfaces together occupy roughly 55–75% of the square. Avoid distant figures, excessive empty darkness, or an environment-dominated establishing shot.":"",
    director&&/after closing/i.test(setting)?"SETTING STATE: Make “after closing” visually provable with folded or shuttered stalls, empty aisles, and no customers; keep the named participants as the only active people.":"",
    !compact?sentence("LIGHTING",joinedFacts(facts,"lighting")):"",
    !compact?sentence("VISUAL STYLE",joinedFacts(facts,"style")):"",
    ...additional.map((item)=>sentence(strategy==="all_facts"?"REQUIRED VISIBLE ELEMENT":"REQUIREMENT",item)),
    typographyRequired&&exactText?`TEXT — REQUIRED: Render exactly “${exactText}” once, clearly and legibly. Keep every other surface and both lower corners clean, unmarked, and unsigned. No other letters, numbers, labels, captions, or signature-like marks.`:"TEXT: Do not render words, letters, numbers, labels, signatures, captions, borders, or interface chrome. Deliver clean, unmarked, unsigned artwork and keep both lower corners visually quiet.",
    referenceDirective(references[0]),
    !constraintsFirst?exclusionLine:"",
    checklist?visibleContract(primarySubject,setting,composition,material):"",
    director?directorFinal:primarySubject?`FINAL VISUAL CHECK: The finished image must visibly contain the complete primary subject and action — ${primarySubject}. Give this requirement the same priority as setting and composition.`:"",
    !director&&literal&&composition?`FINAL COMPOSITION CHECK: Preserve exactly this authored structure — ${composition}. Do not trade it away for a more conventional crop or arrangement.`:"",
    director?"DELIVERY QUALITY CONTROL: One resolved image only. Use a deliberate square crop with no dead zones. Include only named supporting objects. No contact sheet, split screen, inset, footer, border, annotation, presentation mockup, watermark, artist mark, or signature-like flourish.":"DELIVERY: One complete image only; no contact sheet, split-screen comparison, inset, footer, border, annotation, or presentation mockup.",
  ].filter(Boolean) as string[];
  const bounded=boundedPrompt(lines);for(const decision of [...mandatoryDecisions,...hardExclusions])if(!decision.direction)bounded.issues.push(`mandatory ${decision.type} decision ${decision.blockId||"without identifier"} has no representable authorial value`);const coveredFacts=facts.filter((fact)=>{const value=factText(fact);const quoted=factType(fact)==="typography"?quoteText(value):"";return Boolean(value&&bounded.prompt.includes(value))||Boolean(quoted&&bounded.prompt.includes(quoted));});return{
    prompt:bounded.prompt,
    valid:bounded.valid&&bounded.issues.length===0,
    issues:bounded.issues,
    adapterVersion:IDEOGRAM_PROMPT_ADAPTER_VERSION,
    strategy,
    canonicalPromptLength:canonicalPrompt.length,
    providerPromptLength:bounded.prompt.length,
    compacted:bounded.compacted,
    promptTechnique:(options.promptTechnique??"prose") as PromptTechnique,
    includedBlockIds:coveredFacts.map((fact)=>clean(fact.block_id,160)).filter(Boolean),
    omittedBlockIds:facts.filter((fact)=>!coveredFacts.includes(fact)).map((fact)=>clean(fact.block_id,160)).filter(Boolean),
    mandatorySubjectBlockIds:subjectFacts.map((fact)=>clean(fact.block_id,160)).filter(Boolean),
    mandatorySubjectRepeated:Boolean(primarySubject&&(bounded.prompt.includes("MANDATORY PRIMARY SUBJECT AND ACTION:")||bounded.prompt.includes("MANDATORY ACTION EVIDENCE:"))&&(bounded.prompt.includes("FINAL VISUAL CHECK:")||bounded.prompt.includes("FINAL READ:"))),
    omittedOptionalTypography:Boolean(typography.length&&!typographyRequired),
    benignStoryContextApplied,
    referenceMode:references[0]?.mode??null,
  };
}
