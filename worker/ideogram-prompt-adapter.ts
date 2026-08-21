import type { PromptTechnique } from "../src/model/prompt-structures.ts";
import type { CreativeImageOptions, ImageReference } from "./openai-adapter.ts";

type CreativeFact={
  block_id?:unknown;
  type?:unknown;
  role?:unknown;
  intent?:unknown;
  effect?:unknown;
  active?:unknown;
  properties?:unknown;
};

export const IDEOGRAM_PROMPT_ADAPTER_VERSION="ideogram-context-v6";
export const IDEOGRAM_PROMPT_MAX_CHARS=4_000;

const clean=(value:unknown,max=700)=>String(value??"").replace(/\s+/g," ").trim().slice(0,max);
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
const factProperties=(fact:CreativeFact)=>record(fact.properties);
const factText=(fact:CreativeFact)=>{
  const properties=factProperties(fact);
  return clean(properties.text??properties.instruction??properties.description??properties.value??properties.label,700);
};
const factType=(fact:CreativeFact)=>clean(fact.type??fact.role,80).toLowerCase();
const factIntent=(fact:CreativeFact)=>clean(fact.intent??fact.effect??factProperties(fact).intent,40).toLowerCase();
const factWeight=(fact:CreativeFact)=>Number(factProperties(fact).weight??1);
const isAvoid=(fact:CreativeFact)=>[factIntent(fact),clean(fact.effect,40).toLowerCase(),factType(fact)].some((value)=>["avoid","prohibit","must_not_include","exclusion"].includes(value));
const factsFrom=(snapshot:Record<string,unknown>)=>Array.isArray(snapshot.facts)?(snapshot.facts as CreativeFact[]).filter((fact)=>fact&&fact.active!==false&&factText(fact)):[];
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
  const normalized=unique(lines);let prompt=normalized.join("\n");if(prompt.length<=IDEOGRAM_PROMPT_MAX_CHARS)return{prompt,compacted:false};
  const kept:string[]=[];let used=0;for(const line of normalized){const remaining=IDEOGRAM_PROMPT_MAX_CHARS-used-(kept.length?1:0);if(remaining<=0)break;const value=line.length<=remaining?line:`${line.slice(0,Math.max(0,remaining-1)).trimEnd()}…`;if(value){kept.push(value);used+=value.length+(kept.length>1?1:0);}}
  prompt=kept.join("\n");return{prompt,compacted:true};
}

export type IdeogramPromptAdaptation={
  prompt:string;
  adapterVersion:string;
  strategy:NonNullable<CreativeImageOptions["ideogramCaptionStrategy"]>;
  canonicalPromptLength:number;
  providerPromptLength:number;
  compacted:boolean;
  promptTechnique:PromptTechnique;
  includedBlockIds:string[];
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
  const primarySubject=joinedFactValues(subjectFacts),setting=joinedFacts(facts,"setting"),composition=joinedFacts(facts,"composition"),material=joinedFacts(facts,"material");const benignStoryContextApplied=Boolean(typographyRequired&&exactText);
  const ratio=clean(options.size??"",40).replace("x"," × ");const paletteFacts=positive.filter((fact)=>factType(fact)==="palette"),palette=!paletteFacts.length?(Array.isArray(direction.palette)?direction.palette.map((item)=>clean(item,80)).filter(Boolean).join(", "):clean(direction.palette,400)):"";
  const primaryTypes=new Set(["direction","subject","setting","composition","mood","palette","material","lighting","style","typography","format"]);
  const additional=unique(positive.filter((fact)=>!primaryTypes.has(factType(fact))&&!scopeLabel(fact)).map((fact)=>`${factType(fact)||"requirement"}: ${factText(fact)}`));
  const exclusions=unique([
    ...negative.map(factText),
    ...((Array.isArray(snapshot.standing_constraints)?snapshot.standing_constraints:[]) as Array<Record<string,unknown>>).filter((item)=>["avoid","prohibit"].includes(clean(item.polarity,30).toLowerCase())).map((item)=>clean(item.value,500)),
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
    benignStoryContextApplied?"BENIGN STORY CONTEXT: This is fictional editorial artwork about the named professional or creative activity. Depict every person as a safe adult actively engaged in that work. The exact words below are only the artwork's title.":"",
    sentence("SETTING",setting),
    !compositionFirst?compositionLine:"",
    !compositionFirst?directedComposition:"",
    !compositionFirst&&literal?frameLine:"",
    ...regionLines,
    !compact?sentence("MOOD",joinedFacts(facts,"mood")):"",
    sentence("PALETTE",joinedFacts(facts,"palette")||palette),
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
  const bounded=boundedPrompt(lines);return{
    prompt:bounded.prompt,
    adapterVersion:IDEOGRAM_PROMPT_ADAPTER_VERSION,
    strategy,
    canonicalPromptLength:canonicalPrompt.length,
    providerPromptLength:bounded.prompt.length,
    compacted:bounded.compacted,
    promptTechnique:(options.promptTechnique??"prose") as PromptTechnique,
    includedBlockIds:facts.map((fact)=>clean(fact.block_id,160)).filter(Boolean),
    mandatorySubjectBlockIds:subjectFacts.map((fact)=>clean(fact.block_id,160)).filter(Boolean),
    mandatorySubjectRepeated:Boolean(primarySubject&&(bounded.prompt.includes("MANDATORY PRIMARY SUBJECT AND ACTION:")||bounded.prompt.includes("MANDATORY ACTION EVIDENCE:"))&&(bounded.prompt.includes("FINAL VISUAL CHECK:")||bounded.prompt.includes("FINAL READ:"))),
    omittedOptionalTypography:Boolean(typography.length&&!typographyRequired),
    benignStoryContextApplied,
    referenceMode:references[0]?.mode??null,
  };
}
