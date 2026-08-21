import type { CreativeImageOptions, ImageReference } from "./openai-adapter.ts";

export type IdeogramCandidateProfile={
  campaign:1|2|3|4|5;
  version:`v${number}`;
  promptMode:NonNullable<CreativeImageOptions["ideogramPromptMode"]>;
  expansionModel:NonNullable<CreativeImageOptions["ideogramExpansionModel"]>;
  captionStrategy:NonNullable<CreativeImageOptions["ideogramCaptionStrategy"]>;
  referenceStrengths:{inspiration:number;preserve_composition:number;preserve_subject:number;preserve_style:number;default:number};
  seed:number;
  hypothesis:string;
};

const profile=(campaign:IdeogramCandidateProfile["campaign"],version:IdeogramCandidateProfile["version"],promptMode:IdeogramCandidateProfile["promptMode"],expansionModel:IdeogramCandidateProfile["expansionModel"],captionStrategy:IdeogramCandidateProfile["captionStrategy"],inspiration:number,preserveComposition:number,hypothesis:string):IdeogramCandidateProfile=>({
  campaign,version,promptMode,expansionModel,captionStrategy,
  referenceStrengths:{inspiration,preserve_composition:preserveComposition,preserve_subject:.3,preserve_style:.72,default:.9},
  seed:Number(version.slice(1))*104_729,
  hypothesis,
});

/**
 * Immutable, ordered hypotheses for a bounded paid search. The coordinator
 * stops on the first full-corpus pass and never executes more than ten.
 */
export const IDEOGRAM_CANDIDATE_CAMPAIGNS:Record<1|2|3|4|5,readonly IdeogramCandidateProfile[]>={
1:[
  profile(1,"v11","expanded_plain","Large","balanced",.97,.92,"Use the strongest proven provider expansion at every quality and prevent source subjects from dominating layout-only references."),
  profile(1,"v12","native_caption","Large","balanced",.97,.92,"Give the provider deterministic structured semantics, while retaining its strongest supported expansion."),
  profile(1,"v13","native_caption","Medium","balanced",.97,.92,"Keep structured semantics but reduce expansion-driven invention."),
  profile(1,"v14","expanded_plain","Large","balanced",.97,.92,"Retain v11's successful semantics and reference replacement while respecting the fast endpoint's Medium-only expansion contract."),
  profile(1,"v15","expanded_plain","Medium","balanced",.97,.92,"Reduce expansion-driven invention while retaining concise visual prose."),
  profile(1,"v16","expanded_plain","Large","balanced",1,1,"Treat all layout and inspiration pixels as disposable scaffolding so authored content is fully authoritative."),
  profile(1,"v17","native_caption","Large","balanced",1,1,"Combine deterministic structured semantics with fully disposable reference scaffolding."),
  profile(1,"v18","expanded_plain","Large","balanced",.99,.86,"Retain slightly more source geometry for composition references without restoring their source subjects."),
  profile(1,"v19","native_caption","Medium","balanced",1,.96,"Favor structured semantics and aggressive replacement while limiting expansion."),
  profile(1,"v20","expanded_plain","Large","balanced",.99,.96,"Final bounded expanded-prose candidate with strong authored-content replacement and near-maximal layout freedom."),
],
2:[
  profile(2,"v21","native_caption","None","spatial_material",.99,.96,"Use the documented native JSON contract without re-expansion, with literal bounded spatial and material elements."),
  profile(2,"v22","native_caption","None","spatial_strict",.99,.96,"Prioritize literal bounding boxes and local-only effects while keeping material detail attached to the subject."),
  profile(2,"v23","native_caption","None","material_explicit",.99,.96,"Prioritize distinct visible material objects while retaining native structured composition."),
  profile(2,"v24","native_caption","None","all_facts",.99,.96,"Represent every otherwise-unmapped authored visual fact as an ordered native element."),
  profile(2,"v25","native_caption","None","spatial_material",1,1,"Combine strict native spatial/material semantics with fully disposable reference scaffolding."),
  profile(2,"v26","native_caption","None","balanced",.99,.96,"Measure the corrected native schema without additional element emphasis."),
  profile(2,"v27","native_caption","None","spatial_material",.97,.9,"Retain more composition-reference geometry while keeping strict native spatial/material semantics."),
  profile(2,"v28","expanded_plain","Large","spatial_material",.99,.96,"Retain the best expanded-caption route as a control after the v2 compiler correction."),
  profile(2,"v29","expanded_plain","Medium","spatial_material",.99,.96,"Use the lower-invention expanded route as a second control."),
  profile(2,"v30","expanded_plain","Large","all_facts",.99,.92,"Final expanded candidate retains every authored visible requirement while balancing composition-reference preservation."),
],
3:[
  profile(3,"v31","expanded_plain","Large","literal_contract",.99,.92,"Make subject, setting, composition, and materials a jointly visible acceptance contract, with exact edge-only framing."),
  profile(3,"v32","expanded_plain","Large","composition_lock",.99,.92,"Put literal composition and edge-only framing before scene prose and repeat them after every other requirement."),
  profile(3,"v33","expanded_plain","Large","semantic_checklist",.99,.92,"End the provider input with a numbered visual checklist that must be jointly satisfied."),
  profile(3,"v34","expanded_plain","Large","compact_literal",.99,.92,"Remove lower-authority mood and style prose so subject, setting, composition, palette, and materials dominate expansion."),
  profile(3,"v35","expanded_plain","Large","constraint_first",.99,.92,"Move exclusions ahead of scene detail while retaining a literal final composition check."),
  profile(3,"v36","expanded_plain","Medium","literal_contract",.99,.92,"Test the complete literal contract with lower-invention Medium expansion."),
  profile(3,"v37","expanded_plain","Medium","composition_lock",.99,.92,"Test composition-first framing with lower-invention Medium expansion."),
  profile(3,"v38","expanded_plain","Large","literal_contract",.99,.96,"Retain more layout-reference geometry while keeping the full literal acceptance contract."),
  profile(3,"v39","expanded_plain","Large","semantic_checklist",.97,.9,"Retain slightly more source geometry with a jointly visible semantic checklist."),
  profile(3,"v40","expanded_plain","Large","literal_contract",1,.96,"Final candidate combines the strongest literal contract with fully disposable inspiration pixels and retained composition geometry."),
],
4:[
  profile(4,"v41","expanded_plain","Large","production_director",.99,.92,"Use one explicit success priority, directed geometry, subject occupancy, provable setting state, and a clean unsigned frame."),
  profile(4,"v42","expanded_plain","Large","production_director",.99,.88,"Retain more layout-reference geometry while preserving the complete production-director contract."),
  profile(4,"v43","expanded_plain","Large","shot_plan",.99,.92,"Move directed geometry ahead of scene prose and treat the image as a bounded shot plan."),
  profile(4,"v44","expanded_plain","Large","clean_editorial",.99,.92,"Put constraints and clean-frame requirements first to prevent incidental typography, clutter, and presentation artifacts."),
  profile(4,"v45","expanded_plain","Large","production_director",.97,.92,"Retain slightly more inspiration geometry with the full priority and occupancy contract."),
  profile(4,"v46","expanded_plain","Large","shot_plan",.99,.88,"Combine the shot plan with stronger composition-reference retention."),
  profile(4,"v47","expanded_plain","Large","production_director",.99,.96,"Favor authored replacement where reference content still dominates the requested scene."),
  profile(4,"v48","expanded_plain","Large","clean_editorial",.99,.88,"Combine clean-frame constraints with stronger layout-reference retention."),
  profile(4,"v49","expanded_plain","Medium","production_director",.99,.92,"Measure whether the production-director structure remains reliable with lower-invention expansion."),
  profile(4,"v50","expanded_plain","Large","shot_plan",.97,.96,"Final bounded candidate combines directed shot geometry with aggressive authored replacement."),
],
5:[
  profile(5,"v51","expanded_plain","Large","shot_plan",.99,.88,"Correct capability classification, use the standard endpoint for material studies, and retain the strongest directed-shot contract."),
  profile(5,"v52","expanded_plain","Large","production_director",.99,.88,"Combine corrected capability classification and material routing with the production-director hierarchy."),
  profile(5,"v53","expanded_plain","Large","shot_plan",.99,.92,"Retain slightly more composition-reference geometry after correcting capability and material routing."),
  profile(5,"v54","expanded_plain","Large","clean_editorial",.99,.88,"Apply corrected capability routing with constraints-first clean editorial delivery."),
  profile(5,"v55","expanded_plain","Large","production_director",.99,.92,"Balance corrected material/action handling with the prior reference-strength midpoint."),
  profile(5,"v56","expanded_plain","Large","shot_plan",.97,.88,"Retain more inspiration geometry while preserving corrected per-capability priorities."),
  profile(5,"v57","expanded_plain","Large","clean_editorial",.97,.88,"Test lower inspiration transformation with clean-frame and corrected material action contracts."),
  profile(5,"v58","expanded_plain","Large","production_director",.97,.92,"Pair corrected capability routing with moderate reference retention and strict subject/action evidence."),
  profile(5,"v59","expanded_plain","Large","shot_plan",.99,.96,"Favor authored replacement for preserve-composition references while keeping exact per-capability priorities."),
  profile(5,"v60","expanded_plain","Large","production_director",.99,.96,"Final bounded candidate combines maximum authored replacement with corrected focus and standard material rendering."),
]};
export const IDEOGRAM_CANDIDATE_PROFILES:readonly IdeogramCandidateProfile[]=[
  ...IDEOGRAM_CANDIDATE_CAMPAIGNS[1],...IDEOGRAM_CANDIDATE_CAMPAIGNS[2],...IDEOGRAM_CANDIDATE_CAMPAIGNS[3],...IDEOGRAM_CANDIDATE_CAMPAIGNS[4],...IDEOGRAM_CANDIDATE_CAMPAIGNS[5],
] as const;

export const IDEOGRAM_EVAL_COHORTS={
  micro:[
    "v6-01-observatory-composition",
    "v6-02-tidal-library-typography",
    "v6-04-ceramic-lab-spatial",
    "v6-08-signal-kitchen-material",
    "v6-01-observatory-reference",
    "v6-02-tidal-library-reference",
    "v6-04-ceramic-lab-composition",
  ],
  sentinel:Array.from({length:15},(_,index)=>{
    const group=Math.floor(index/5)+1;const capability=["composition","typography","spatial","material","reference"][index%5];
    return`v6-${String(group).padStart(2,"0")}-${["observatory","tidal-library","night-market"][group-1]}-${capability}`;
  }),
  full:[] as string[],
} as const;

export type IdeogramEvalStage=keyof typeof IDEOGRAM_EVAL_COHORTS;

export function candidateProfile(version:string){return IDEOGRAM_CANDIDATE_PROFILES.find((item)=>item.version===version)??null;}

export function candidateReferenceStrength(profile:IdeogramCandidateProfile,reference:ImageReference|undefined){
  if(!reference)return undefined;
  const mode=reference.mode&&reference.mode in profile.referenceStrengths?reference.mode:"default";
  return profile.referenceStrengths[mode as keyof typeof profile.referenceStrengths];
}

export function candidateOptions(profile:IdeogramCandidateProfile,reference:ImageReference|undefined,quality:CreativeImageOptions["quality"],fastTextToImage=quality==="low"&&!reference):Pick<CreativeImageOptions,"ideogramAdapterVersion"|"ideogramExpansionModel"|"ideogramPromptMode"|"ideogramReferenceStrength"|"ideogramCaptionStrategy"|"ideogramSeed">{
  const expansionModel=fastTextToImage&&profile.expansionModel==="Large"?"Medium":profile.expansionModel;
  return{ideogramAdapterVersion:profile.version,ideogramExpansionModel:expansionModel,ideogramPromptMode:profile.promptMode,ideogramCaptionStrategy:profile.captionStrategy,ideogramReferenceStrength:candidateReferenceStrength(profile,reference),ideogramSeed:profile.seed};
}
