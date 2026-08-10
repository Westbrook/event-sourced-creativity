import { SignalArray } from "signal-utils/array";
import type { CreativeEvent } from "./events";

export type ScenarioKey = "creative-loop" | "async-return" | "concurrency" | "promotion" | "taste-time" | "attention-friction";

export const SCENARIOS = [
  { key: "creative-loop" as const, label: "Creative loop", kicker: "Authored wins", summary: "A reference becomes editable context, an authored correction survives compilation, and the resulting output carries critique, library, and export receipts.", actors: ["user", "worker:extractor", "worker:compiler", "worker:generator"] },
  { key: "async-return" as const, label: "Asynchronous return", kicker: "Agency preserved", summary: "A re-entry brief, bounded Scout run, human judgment, and accepted context bridge a session boundary without agents silently editing the document.", actors: ["user", "worker:brief", "worker:scout"] },
  { key: "concurrency" as const, label: "Concurrent pressure", kicker: "Conflicts are explicit", summary: "Views, annotations, and coarse attention evidence keep landing while stale model proposals and version-sensitive generation receive explicit validation outcomes.", actors: ["user", "model:forma-chat", "worker:validator"] },
  { key: "promotion" as const, label: "Family promotion", kicker: "Inference is not authorship", summary: "The index proposes a visual family and anchors its evidence; only a separate accepted proposal creates and organizes a durable user collection.", actors: ["worker:indexer", "model:forma-chat", "user"] },
  { key: "taste-time" as const, label: "Taste & time", kicker: "Memory stays reversible", summary: "An output critique is joined to its compiler inputs, versioned as ranking-only taste, promoted explicitly, resurfaced on a condition, then revoked and forgotten.", actors: ["user", "worker:compiler", "worker:taste", "worker:scheduler"] },
  { key: "attention-friction" as const, label: "Attention & friction", kicker: "Weak signals stay weak", summary: "Visible-page dwell becomes bounded, reviewable evidence around intent, generation, and comparison—then the user can erase the entire attention ledger.", actors: ["user", "worker:attention", "worker:compiler", "worker:generator"] },
];

const baseTypes: Record<ScenarioKey, Array<[string, string]>> = {
  "creative-loop": [["user","ProjectCreated"],["user","DocumentCreated"],["user","EmptyCanvasChosen"],["user","BlockCreated"],["user","ReferenceIngested"],["user","RightsAsserted"],["user","ExtractionRequested"],["worker:extractor","ExtractionCompleted"],["user","ChipEdited"],["user","GenerationRequested"],["worker:compiler","ContextCompiled"],["worker:generator","GenerationCompleted"],["user","ComparisonOpened"],["user","ObjectCritiqued"],["user","ObjectPinned"],["user","AddedToLibrary"],["user","ObjectExported"]],
  "async-return": [["user","SessionClosed"],["worker:brief","BriefComposed"],["user","BriefItemPresented"],["worker:scout","ScoutRunStarted"],["worker:scout","GenerationRequested"],["worker:scout","GenerationCompleted"],["worker:scout","ScoutObserved"],["worker:scout","ScoutRunCompleted"],["user","ObservationJudged"],["user","BriefItemAccepted"],["user","BlockCreated"],["user","SessionOpened"]],
  concurrency: [["model:forma-chat","MutationProposed"],["user","ObjectViewed"],["user","AttentionEpisodeObserved"],["user","AnnotationAdded"],["user","ProposalAccepted"],["user","GenerationRequested"],["worker:validator","ValidationFailed"],["user","BlockPropertyEdited"],["user","ObjectPinned"],["user","ProposalRejected"]],
  promotion: [["worker:indexer","FamilyDeclared"],["worker:indexer","FamilyAnchorSet"],["worker:indexer","FamilyMembershipAsserted"],["model:forma-chat","MutationProposed"],["user","ProposalAccepted"],["user","CollectionCreated"],["user","CollectionItemAdded"],["user","CollectionRenamed"]],
  "taste-time": [["user","DocumentCreated"],["user","BlockCreated"],["user","GenerationRequested"],["worker:compiler","ContextCompiled"],["worker:generator","GenerationCompleted"],["user","ObjectCritiqued"],["worker:taste","TasteModelVersioned"],["user","PreferenceAuthored"],["user","ConditionSet"],["worker:scheduler","ConditionFired"],["worker:scheduler","Resurfaced"],["user","PreferenceRevoked"],["user","FactRetracted"]],
  "attention-friction": [["user","SessionOpened"],["user","DocumentCreated"],["user","IntentDeclared"],["user","AttentionEpisodeObserved"],["user","GenerationRequested"],["worker:compiler","ContextCompiled"],["worker:generator","GenerationCompleted"],["user","ComparisonOpened"],["user","ObjectPinned"],["user","AttentionEpisodeObserved"],["user","AttentionSignalsForgotten"],["user","SessionClosed"]],
};

export const SCENARIO_EVENT_TYPES = [...new Set(Object.values(baseTypes).flat().map(([,type])=>type))];

type ReplayEventStory = { action: string; value: string };
const EVENT_STORIES: Record<string,ReplayEventStory> = {
  ProjectCreated:{action:"The user opened a durable project boundary for the study.",value:"Every later document, generation, and memory receipt can be scoped without relying on a mutable folder name."},
  DocumentCreated:{action:"The user created and named a distinct document in the project.",value:"The document can be opened, renamed, replayed, or removed independently while its history remains intact."},
  EmptyCanvasChosen:{action:"The user explicitly declined suggested re-entry context and chose an empty canvas.",value:"Blankness is witnessed as intent; the app does not silently insert a direction block or mistake absence for missing data."},
  BlockCreated:{action:"The user added authored context to the active document.",value:"The block receives stable identity, type, order, and authority so later compilation can cite the exact version used."},
  ReferenceIngested:{action:"The user attached a visual reference as source material.",value:"The upload becomes addressable evidence rather than an opaque prompt attachment, enabling extraction, preview, and provenance."},
  RightsAsserted:{action:"The user confirmed they may use the uploaded reference.",value:"Generation can proceed with an explicit rights receipt instead of hiding a legal assumption inside UI state."},
  ExtractionRequested:{action:"The application queued structured analysis for the reference block.",value:"Pending work is visible and replayable, separating the user upload from fallible machine-derived properties."},
  ExtractionCompleted:{action:"The extractor proposed palette and lighting chips with confidence.",value:"Derived qualities remain traceable to a worker result and can be corrected without overwriting what the extractor originally saw."},
  ChipEdited:{action:"The user corrected one extracted creative property.",value:"Authored judgment now outranks inference, and every future projection can still explain both the suggestion and the correction."},
  GenerationRequested:{action:"A bounded generation was requested against the current document version.",value:"The request establishes intent and a version checkpoint before any provider work begins."},
  ContextCompiled:{action:"The compiler froze the exact block versions and standing constraints sent to generation.",value:"Outputs can be reproduced, compared, and blamed back to their real inputs instead of an unknowable latest document."},
  GenerationCompleted:{action:"The generator returned an addressable creative object.",value:"Provider, model, latency, generation, and object identity become durable receipts for later comparison and critique."},
  ComparisonOpened:{action:"The user opened alternatives side by side.",value:"The app witnesses a decision context, so a later pin or critique has stronger meaning than an isolated view."},
  ObjectCritiqued:{action:"The user recorded axis-specific taste evidence on an output.",value:"The critique joins through the object and generation to model, adapter, and contributing block versions while remaining reversible."},
  ObjectPinned:{action:"The user kept one output in active working context.",value:"This explicit positive outcome carries more authority than passive attention and can support ranking without deleting alternatives."},
  AddedToLibrary:{action:"The user saved the output into the durable library.",value:"Reuse becomes intentional and reversible; the same object remains linked to its originating document and compile receipt."},
  ObjectExported:{action:"The user exported the selected object for use outside Forma.",value:"A high-intent outcome closes the creative loop and gives evaluation a concrete success signal."},
  SessionClosed:{action:"The user ended a working session with the current head recorded.",value:"Later assistance can reason across a real interruption instead of treating the next visit as a stateless page load."},
  BriefComposed:{action:"The brief worker summarized unresolved work into ranked re-entry items.",value:"The summary is derived report space: useful preparation that cannot mutate the document by itself."},
  BriefItemPresented:{action:"The application showed one brief item to the returning user.",value:"Presentation is witnessed separately from acceptance, making dosage and ignored suggestions measurable."},
  ScoutRunStarted:{action:"The Scout opened a bounded exploration run with a declared envelope.",value:"Budget, capability, and report-only limits are known before exploratory work starts."},
  ScoutObserved:{action:"The Scout reported a falsifiable pattern with confidence and evidence references.",value:"The observation can be judged or rejected without granting the Scout authority to choose a creative direction."},
  ScoutRunCompleted:{action:"The Scout stopped within its declared exploration budget.",value:"Exhaustion is planned and auditable rather than an open-ended background agent loop."},
  ObservationJudged:{action:"The user confirmed, rejected, or marked the Scout observation unclear.",value:"Human verdicts calibrate observation types and confirmed-observations-per-dollar instead of rewarding persuasive prose."},
  BriefItemAccepted:{action:"The user explicitly accepted prepared context from the re-entry brief.",value:"Only this authored bridge lets report-space work influence the live document."},
  SessionOpened:{action:"The user began a new witnessed work session.",value:"The app can measure continuity, re-entry dosage, and time-scoped signals without inferring a session from page presence alone."},
  MutationProposed:{action:"Forma Chat proposed a typed mutation without committing it.",value:"The user can inspect exact consequences; model usefulness never expands into write authority."},
  ObjectViewed:{action:"The user deliberately opened a creative object.",value:"Explicit engagement is recorded as a lightweight signal while remaining weaker than pinning, critique, or export."},
  AttentionEpisodeObserved:{action:"A visible-page attention episode was summarized into active time, idle time, visible references, and its ending action.",value:"Potential friction becomes reviewable low-weight evidence without storing pointer paths, keystrokes, or typed content."},
  AnnotationAdded:{action:"The user attached a comment to a specific creative object or region.",value:"Collaborative meaning stays addressable and commutative even while version-sensitive work is being checked."},
  ProposalAccepted:{action:"The user authorized the valid part of a model proposal.",value:"Authorship is explicit, and accepted events can proceed independently of rejected or stale siblings."},
  ValidationFailed:{action:"The validator rejected an unauthorized or stale event with structured reasons.",value:"The stream preserves the failed attempt as evidence while keeping invalid state out of every projection."},
  BlockPropertyEdited:{action:"The user changed a named property on an existing block version.",value:"Version-sensitive generation can detect the relevant change instead of invalidating unrelated engagement."},
  ProposalRejected:{action:"The user declined the remaining model proposal.",value:"Rejected-path memory prevents the same suggestion from returning as if no decision had been made."},
  FamilyDeclared:{action:"The indexer proposed an aesthetic family from related outputs.",value:"The family is visible as inferred, confidence-bearing, and correctable—not silently filed as user-authored truth."},
  FamilyAnchorSet:{action:"The indexer attached representative anchors and evidence receipts to the family.",value:"A reviewer can inspect what visually grounds the grouping instead of trusting only its label."},
  FamilyMembershipAsserted:{action:"The indexer proposed one output as a family member with confidence.",value:"Individual edges can be corrected without deleting the broader family or rewriting history."},
  CollectionCreated:{action:"The user promoted useful family evidence into a durable collection.",value:"A separate authored event preserves the boundary between machine inference and user organization."},
  CollectionItemAdded:{action:"The user filed a specific document or output into that collection.",value:"Membership is reversible and independently ordered rather than embedded in the asset itself."},
  CollectionRenamed:{action:"The user gave the promoted collection their own language.",value:"The organizational concept now reflects authored meaning while retaining its source-claim receipt."},
  TasteModelVersioned:{action:"The taste worker snapshotted decaying beliefs and a ranking-only policy.",value:"Changes in taste can be compared as-of time; inferred beliefs may reorder candidates but cannot filter them."},
  PreferenceAuthored:{action:"The user promoted a specific claim into a standing preference.",value:"Future compilation may state this preference assertively because authorship and source claim are both witnessed."},
  ConditionSet:{action:"The user asked for a private concern to resurface after a concrete trigger.",value:"Future memory is intentional, scoped, and inspectable instead of a hidden reminder heuristic."},
  ConditionFired:{action:"The scheduler detected that the authored trigger had become due.",value:"Timing logic is witnessed separately from presentation, making premature or late reminders diagnosable."},
  Resurfaced:{action:"The application presented the due condition back to the user.",value:"Evaluation can measure whether the remembered concern was useful at the moment it returned."},
  PreferenceRevoked:{action:"The user revoked a standing preference.",value:"The constraint stops compiling into future generations while its former validity remains historically explainable."},
  FactRetracted:{action:"The user forgot an inferred taste claim.",value:"The claim disappears from current capsules without deleting the evidence trail that explains the retraction."},
  IntentDeclared:{action:"The user stated the goal for the current session.",value:"Attention and generation outcomes can be interpreted against explicit intent rather than guessed from dwell alone."},
  AttentionSignalsForgotten:{action:"The user erased retained coarse attention evidence.",value:"The low-authority signal path remains consent-based, reviewable, and genuinely reversible."},
};

export function explainReplayEvent(event: CreativeEvent) {
  const story=EVENT_STORIES[event.type]??{action:`${event.actor} appended ${event.type}.`,value:"The typed event remains independently inspectable and replayable."};
  return {...story,cause:event.causationId?`Causation points to ${event.causationId}; actor ${event.actor} owns this step.`:`This is the first witnessed step in its scenario; actor ${event.actor} owns it.`};
}

function payloadFor(type: string, i: number, key: ScenarioKey, cycle: number): Record<string, unknown> {
  const documentId=`document-${key}-${cycle}`; const blockId=`block-${key}-${cycle}`; const generationId=`generation-${key}-${cycle}`; const objectId=`object-${key}-${cycle}`; const runId=`run-${key}-${cycle}`; const observationId=`observation-${key}-${cycle}`; const familyId=`family-${cycle}`; const collectionId=`collection-${cycle}`; const preferenceId=`preference-${cycle}`; const conditionId=`condition-${cycle}`;
  if(type==="ProjectCreated")return{project_id:"project-long-horizon",name:"Long horizon study",state:"active"};
  if(type==="DocumentCreated")return{document_id:documentId,title:`Atmosphere study ${cycle+1}`,handle:`atmosphere-${cycle+1}`};
  if(type==="EmptyCanvasChosen")return{document_id:documentId,brief_id:null,explicit_blank:true};
  if(type==="BlockCreated")return{block_id:blockId,document_id:documentId,type:key==="async-return"?"direction":"reference",handle:`study/${key}-${cycle}`,position:`a${String(cycle).padStart(6,"0")}`,properties:{text:"A quiet, warm nocturne",authority:"authored",weight:.8}};
  if(type==="ReferenceIngested")return{reference_id:`reference-${cycle}`,block_id:blockId,document_id:documentId,media_type:"image/jpeg",content_ref:`media-${cycle}`};
  if(type==="RightsAsserted")return{reference_id:`reference-${cycle}`,assertion:"user-owns-or-may-use",scope:"generation"};
  if(type==="ExtractionRequested")return{reference_id:`reference-${cycle}`,block_id:blockId,extractor_name:"palette-light-v2"};
  if(type==="ExtractionCompleted")return{reference_id:`reference-${cycle}`,block_id:blockId,extractor_name:"palette-light-v2",overall_confidence:.86,chips:[{property:"palette",value:"dusk amber",confidence:.88},{property:"lighting",value:"low lateral light",confidence:.84}]};
  if(type==="ChipEdited")return{block_id:blockId,chip_id:`chip-${cycle}`,property:"palette",old_value:"dusk amber",new_value:"restrained amber"};
  if(type==="GenerationRequested")return{generation_id:generationId,document_id:documentId,document_version:i,model_ids:[key==="async-return"?"deterministic-scout-v1":"gpt-5.6-terra"],...(key==="async-return"?{run_id:runId,report_space:"scout"}:{})};
  if(type==="ContextCompiled")return{generation_id:generationId,document_id:documentId,model_id:"gpt-5.6-terra",adapter_version:"openai-responses-v1",compiled_snapshot:{facts:["direction/quiet-nocturne","palette/restrained-amber"],pins:[blockId],standing_constraints:key==="taste-time"?["style/restrained-grain"]:[],tail:[],as_of:{head:i,lag:0}},source_block_versions:[{block_id:blockId,version:cycle+1}]};
  if(type==="GenerationCompleted")return{generation_id:generationId,document_id:documentId,model_id:key==="async-return"?"deterministic-scout-v1":"gpt-5.6-terra",adapter_version:key==="async-return"?"scout-v1":"openai-responses-v1",object_ids:[objectId],latency_ms:key==="async-return"?0:930,variant:cycle%4,simulation:key==="async-return",...(key==="async-return"?{run_id:runId,report_space:"scout",candidate:{kind:"adjacent-palette",colors:["#2f4840","#c88358","#d7e780"]}}:{})};
  if(type==="ComparisonOpened")return{comparison_id:`comparison-${cycle}`,object_ids:[objectId,`object-${key}-${Math.max(0,cycle-1)}`]};
  if(type==="ObjectCritiqued")return{object_id:objectId,axis_ref:key==="taste-time"?"composition":"palette",polarity:key==="taste-time"?"negative":"positive",value:key==="taste-time"?"too centered":"restrained amber"};
  if(type==="ObjectPinned"||type==="ObjectViewed"||type==="ObjectExported"||type==="AddedToLibrary")return{object_id:objectId,view_id:`view-${cycle}`,...(type==="ObjectExported"?{format:"png"}:{})};
  if(type==="SessionClosed")return{session_id:`session-${cycle}`,closed_at_sequence:i,reason:"user-ended",duration_seconds:780};
  if(type==="SessionOpened")return{session_id:`session-${cycle+1}`,intent_ref:`intent-${cycle}`,reentry:true};
  if(type==="BriefComposed")return{brief_id:`brief-${cycle}`,source_session_id:`session-${cycle}`,items:[{item_id:`brief-item-${cycle}`,item_type:"comparison",rank:1,destination:{kind:"document",document_id:documentId}}]};
  if(type==="BriefItemPresented"||type==="BriefItemAccepted")return{brief_id:`brief-${cycle}`,item_id:`brief-item-${cycle}`,destination:{kind:"document",document_id:documentId}};
  if(type==="ScoutRunStarted")return{run_id:runId,envelope:{max_observations:1,max_generations:1,max_cost_usd:.02},report_only:true};
  if(type==="ScoutObserved")return{run_id:runId,observation_id:observationId,type:"adjacency",confidence:.74,evidence_refs:[`trajectory:${cycle}`,objectId],falsifier:"User rejects the adjacent palette as unrelated."};
  if(type==="ScoutRunCompleted")return{run_id:runId,observations:1,generations:1,cost_usd:0,terminal:"envelope-satisfied"};
  if(type==="ObservationJudged")return{run_id:runId,observation_id:observationId,verdict:cycle%3===0?"unclear":"confirmed",note:"Evidence was reviewed by the user."};
  if(type==="MutationProposed")return{proposal_id:`proposal-${cycle}`,content_ref:`proposal-content-${cycle}`,expected_sequence:Math.max(0,i-2),proposed_events:[{type:"BlockPropertyEdited",payload:{block_id:blockId,property_path:"weight",new_value:.9}}]};
  if(type==="AttentionEpisodeObserved")return{episode_id:`attention-${i}`,surface:key==="attention-friction"?"studio":"library",context:key==="attention-friction"?(i%2?"comparison":"generation"):"library-browsing",visible_refs:[objectId,blockId],active_ms:42_000,idle_ms:i%2?4_000:28_000,terminal_type:i%2?"ObjectPinned":"GenerationRequested",outcome_weight:i%2?.25:.08,expires_at:new Date(Date.UTC(2026,0,19)).toISOString()};
  if(type==="AnnotationAdded")return{annotation_id:`annotation-${cycle}`,object_id:objectId,body_ref:`annotation-content-${cycle}`};
  if(type==="ProposalAccepted"||type==="ProposalRejected")return{proposal_id:`proposal-${cycle}`,expected_sequence:Math.max(0,i-2),...(type==="ProposalRejected"?{reason:"not aligned with authored direction"}:{})};
  if(type==="ValidationFailed")return{attempted_type:"GenerationRequested",attempted_by:"model:forma-chat",errors:[{index:0,reason:"stale_sequence",expected:Math.max(0,i-3),actual:i}]};
  if(type==="BlockPropertyEdited")return{block_id:blockId,property_path:"weight",old_value:.8,new_value:.9};
  if(type==="FamilyDeclared")return{family_id:familyId,label:"Warm nocturnes",confidence:.81,evidence_refs:[`object-promotion-${cycle}`],embedding_model_id:"deterministic-visual-v1",source_head:i};
  if(type==="FamilyAnchorSet")return{family_id:familyId,anchor_object_ids:[`object-promotion-${cycle}`],evidence_refs:[`embedding-${cycle}`]};
  if(type==="FamilyMembershipAsserted")return{family_id:familyId,object_id:`object-promotion-${cycle}`,confidence:.77,claim_ref:`family-membership:${familyId}:object-promotion-${cycle}`};
  if(type==="CollectionCreated")return{collection_id:collectionId,handle:`kept-warm-nocturnes-${cycle}`,parent_collection_id:null,source_claim_ref:`family:${familyId}`};
  if(type==="CollectionItemAdded")return{collection_id:collectionId,item_ref:{document_id:documentId},position:"a0"};
  if(type==="CollectionRenamed")return{collection_id:collectionId,new_handle:`night-studies-${cycle}`};
  if(type==="TasteModelVersioned")return{version_id:`taste-version-${cycle}`,beliefs:[{beliefId:`belief-${cycle}`,claimRef:`taste:composition-${cycle}`,axis:"composition",value:"too centered",polarity:"forbid",authority:"inferred",confidence:.67,evidenceCount:3,evidenceRefs:[`theory-taste-time-${i}`],validFrom:new Date(Date.UTC(2026,0,5)).toISOString(),recordedAt:new Date(Date.UTC(2026,0,5)).toISOString(),freshness:1}],ranking_policy:{ranking_only:true,half_life_days:60}};
  if(type==="PreferenceAuthored")return{preference_id:preferenceId,axis:"composition",value:"too centered",polarity:"forbid",scope:"account",source_claim_ref:`taste:composition-${cycle}`};
  if(type==="ConditionSet")return{condition_id:conditionId,condition_ref:`condition-content-${cycle}`,trigger_kind:"generation_count",threshold:3,created_sequence:i};
  if(type==="ConditionFired")return{condition_id:conditionId,trigger_kind:"generation_count",observed_count:3};
  if(type==="Resurfaced")return{condition_id:conditionId,condition_ref:`condition-content-${cycle}`,surface:"memory"};
  if(type==="PreferenceRevoked")return{preference_id:preferenceId,reason:"changed-by-user"};
  if(type==="FactRetracted")return{fact_ref:`taste:composition-${cycle}`,reason:"forgotten-by-user"};
  if(type==="IntentDeclared")return{intent_id:`intent-${cycle}`,statement_ref:`intent-content-${cycle}`,surface:"studio"};
  if(type==="AttentionSignalsForgotten")return{scope:"device",episode_count:2,reason:"user-requested"};
  return {scenario:key,ref_id:`ref-${i}`,scope:"project"};
}

export function buildScenario(key: ScenarioKey, count: number): CreativeEvent[] {
  const list = new SignalArray<CreativeEvent>(); const pattern=baseTypes[key]; const start=Date.UTC(2026,0,5,9);
  for(let i=0;i<count;i++){const [actor,type]=pattern[i%pattern.length];const cycle=Math.floor(i/pattern.length);const at=new Date(start+i*37_000).toISOString();list.push({eventId:`theory-${key}-${i+1}`,streamId:`theory:${key}`,sequence:i+1,occurredAt:at,recordedAt:at,actor,clientId:i%17===0?"web:secondary":"web:primary",correlationId:`corr-${key}-${cycle}`,causationId:i?`theory-${key}-${i}`:null,compensatesEventId:null,schemaVersion:1,type,payload:payloadFor(type,i,key,cycle)});}
  return Array.from(list);
}
