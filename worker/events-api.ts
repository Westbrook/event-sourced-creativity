import { assessStoredPresentationCandidate, generateCreativeDirection, generateCreativeVideo, generateDocumentArtifact, PRESENTATION_ADAPTER_VERSION, respondToCreativeChat, structureAdaptiveContext, validateCreativeVideoAudioReferences, validateCreativeVideoReferences, type CreativeChatMutation, type CreativeVideoPreparedReceipt, type ImageReference, type ProviderResponseReceipt, type VideoAudioReference, type VideoReference } from "./openai-adapter";
import { definitiveProviderRejection, hasUnresolvedProviderSubmission, hasUnsettledProviderSubmission, providerSubmissions } from "../src/model/provider-submission";
import { paidProviderObserver } from "./provider-submission";
import { generateCreativeImage, selectImageAdapter } from "./image-adapter";
import type { FalImageProviderReceipt } from "./fal-image-adapter";
import { managedPilotSourceClassificationValid, readGeneratedImageReference, readOwnedAudioReference, readOwnedGeneratedVideoReference, storeGeneratedImage, storeGeneratedMedia, verifySourceDocumentEvidence } from "./media-api";
import { claimCostBudgetReservation, costBudgetReservation, hasCapability, loadPrivateContent, pilotExecutionAllowance, readAccountBudgets, readBudgets, readCostBudgets, releaseBudget, releaseCostBudget, requireConsent, requireUser, reserveBudget, reserveCostBudget, settleBudget, settleCostBudget, settleInterruptedDocumentJobReservations, storePrivateContent, type PilotUser, type ProjectExecutionScope } from "./pilot-policy";
import { appendEvents, appendEventsWithClientReceipts, ensureSchema, insertEvent, makeEvent, readAuditEventPage, readEventPageWithHead, readEventsByClientEventIds, readIntelligenceEvents, readProfileEventPage, readWorkspaceEvents, SCOPED_EVENT_PAGE_SIZE, StaleSequenceError, streamHead, uuidV7, type EventRow, type WorkerEnv } from "./runtime";
import { analyzeImageSample, runExtractorEvaluation, type ImageSample, type ReferenceFindingKind } from "../src/model/extractors";
import { briefEligibility, composeReentryBrief } from "../src/model/brief";
import { foldEvents, type CreativeEvent, type CreativeProjection } from "../src/model/events";
import { isScopedEventProfile } from "../src/model/event-profiles";
import { BLOCK_TYPES, blockEffectFor, blockIntentFor, isBlockKind, referencePixelMode, sendsReferencePixels } from "../src/model/block-types";
import { normalizeSpatialScope } from "../src/model/spatial-scope";
import { buildPhase7Index } from "../src/model/indexing";
import { buildScoutEnvelope, buildScoutTrajectory } from "../src/model/scout";
import { CREATOR_AXES, inferTasteBeliefs, standingConstraints } from "../src/model/taste";
import { ATTENTION_ACTION_TERMINALS, buildAttentionEpisode } from "../src/model/attention";
import { calculateImageFocalPoint, CURRENT_FOCAL_POINT_METHOD } from "../src/model/focal-point";
import { DOCUMENT_VIEWS, documentViewWorkflow } from "../src/model/document-view-signals";
import { normalizePromptTechnique } from "../src/model/prompt-structures";
import { promptFactIsActive } from "../src/model/prompt-policy";
import { documentPlanningTokenReservation, documentRenderTokenReservation, estimatePlannerOperationMicrousd, generationBudgetGate, presentationServerOwnedCheckpointField } from "../src/model/generation-budget";
import { documentImageFormat, imageFormatEventFields, normalizeImageFormat, providerRenderFormat } from "../src/model/image-format";
import { applicationFailureDetail, classifyProviderFailure, ProviderRequestError, providerFailurePrompt, publicFailureDetail, type ProviderFailureDetail } from "./provider-errors";
import { CANVAS_COMMUTATIVE_EVENT_TYPES, CANVAS_USER_EVENT_TYPES, validateCanvasEvent } from "./realtime/canvas-admission";
import { readCanvasGovernance } from "./canvas-governance-policy";
import { LIVE_REPLAY_PRICING_VERSION, hasKnownTextModelPricing, priceTextUsageBreakdownMicrousd, type ProviderCostBreakdown } from "./replay-cost";
import { audioProviderSubmissionState, interruptedDocumentJobUsage, recordedDocumentPlannerUsage, remainingDocumentPlannerCost, validatedStoryboardSafeRecovery } from "./document-job-reservations";
import { observeProviderFailure, observeProviderSuccess } from "./generation-readiness";
import { generationFailureReconciliationEventFields, generationReconciliationEventFields } from "./generation-self-healing";
import { governedPackageSourceRightsCurrent } from "./context-package-rights";
import { documentArtifactValidationIssues, isDocumentArtifactKind, isSlideStylePresetId, parseDocumentArtifactContent, type DocumentArtifactKind, type SlideStylePresetId } from "../src/model/document-artifacts";
import { combinedContextGroups, combinedContextMemberships, isContextCompositionRelation, validateContextCompositionGraph } from "../src/model/combined-context";
import { outputBlockRemovalEvents, outputBlockTextEditEvents } from "../src/model/output-authoring";
import { isVideoAudioMode, isVideoDurationSeconds, normalizeVideoDurationSeconds, VIDEO_ADAPTER_CONTRACT, type VideoAudioMode, type VideoDurationSeconds } from "../src/model/video-adapter";
import { adaptVideoPrompt, resolveVideoAudioPolicy } from "./video-prompt-adapter";
import { AUDIO_ADAPTER_CONTRACT, VIDEO_AUDIO_REFERENCE_CONTRACT, AudioAdapterSelectionError, audioAuthoringConflict, audioContextFromFact, audioContexts, audioFactProhibited, audioRightsAllowed, normalizeAudioRequestProfile, type AudioRequestProfile } from "../src/model/audio";
import { artifactReviewState } from "../src/model/context-health";
import { selectAudioAdapter } from "./audio-selection";
import { boundedAudioExcerpt } from "../src/model/audio-container";
import { adaptAudioPrompt } from "./audio-prompt-adapter";
import { generateCreativeAudio, type AudioImageReference, type AudioVideoReference, type CreativeAudioPreparedReceipt } from "./fal-audio-adapter";
import { appendProjectEvents, ownerDocumentBudgetScopes, readProjectEventPage, readProjectRequestContext, readProjectSourceEvents } from "./project-access";
import { authoritativeCreativeContext, ContextIntegrityError } from "./context-authority";
import { ARTIFACT_REVIEW_EVENT_TYPES, validateArtifactReview } from "./artifact-review";
import { buildManagedProductionPlan, MAX_MANAGED_PRESENTATION_SLIDES, minimumPresentationSlideCount, productionSceneSnapshot, productionTeamFor, providerFacingProductionContinuity, providerFacingProductionTargets, scoreManagedProductionPlan, type ManagedProductionPlan, type ProductionMode } from "../src/model/managed-production";
import { collectProductionEvidence, scoreProductionEvidence } from "../src/model/production-evidence";
import { productionSystemFor, productionUnitsForPlan } from "../src/model/production-system";
import { productionWorkflowIssues, type ProductionWorkflow, type ProductionWorkflowSource } from "../src/model/production-workflow";
import { createSceneConfiguration, isSceneMedium, SCENE_MEDIA, type SceneConfiguration, type SceneMedium } from "../src/model/scene-configuration";
import { ProductionWorkflowContextError, resolveProductionWorkflowContext } from "./production-workflow";
import { buildPresentationSourceContract, inferPresentationSourceOutline } from "../src/model/presentation-source";
import { combinedSceneSnapshot, generateManagedArtifactDraft, renderManagedStoryboardProduction, renderManagedVideoProduction, type ProductionFrameReceipt, type ProductionSceneReceipt } from "./managed-production";
import { storyboardSafeRecoveryProviderPrompt, storyboardSafeRecoveryRenderingInput } from "./storyboard-safe-recovery";

export type { WorkerEnv } from "./runtime";

type EventInput = { type?: string; payload?: Record<string, unknown>; compensatesEventId?: string | null };

const USER_EVENTS = new Set([
  "ProjectCreated","ProjectOpened","ProjectRenamed","ProjectStateChanged","DocumentCreated","DocumentRenamed","DocumentForked","DocumentOpened","DocumentRemoved","DocumentRestored","DocumentProductionWorkflowConfigured","ApplicationViewVisited","DocumentViewVisited","BlockCreated","BlockRenamed","BlockPropertyEdited","BlockWeightSet","BlockLocked","BlockUnlocked","BlockRemoved","BlockRestored","BlockRelationAdded","BlockRelationRemoved","ReferenceIngested","RegionPromoted","ExtractionRequested","ChipEdited","GenerationRequested","IdeationPromoted","DocumentRenderRequested","DocumentArtifactViewed","DocumentArtifactEdited","DocumentArtifactExported","ArtifactReviewRequested","ArtifactApproved","ArtifactChangesRequested","ChatMessageSent","ObjectViewed","OutputRenamed","ObjectSaved","ObjectDiscarded","ObjectPinned","ObjectUnpinned","ObjectRegenerated","ObjectExported","SessionOpened","SessionClosed","BriefItemPresented","BriefItemAccepted","BriefItemIgnored","BriefDismissed","EmptyCanvasChosen","PhaseGateReviewed","ComparisonOpened","ProposalAccepted","ProposalRejected","ProposalDeclined","AnnotationAdded","AnnotationRetracted","PreferenceAuthored","PreferenceRevoked","PromptTechniquePreferred","PromptTechniquePreferenceRevoked","PromptFanOutputPromoted","ObservationJudged","AddedToLibrary","RemovedFromLibrary","CollectionCreated","CollectionRenamed","CollectionRemoved","CollectionRestored","CollectionItemAdded","CollectionItemRemoved","CollectionItemMoved","FactRetracted","ClaimSuperseded","RightsAsserted","AttentionEpisodeObserved","AttentionSignalsForgotten",
  "CanvasCreated","MembershipAdded","CanvasItemPlaced","CanvasReferenceCreated","CanvasTextApplied","CanvasArrangementCreated","CanvasArrangementRemoved","CanvasArrangementRestored","CanvasRegisterSet","CanvasLockAcquired","CanvasLockReleased","StrokeAdded","StrokeErased","ContextSetFormalized","CanvasInteractionRecorded","VoteCast","ProposalRestored","BlockRehomed","CanvasItemRemoved","CanvasItemRestored","CanvasRenamed","MembershipRemoved","CanvasRemoved","CanvasRestored","ReplayPersonaImpersonationStarted","ReplayPersonaImpersonationEnded",
]);
const PRODUCER_EVENTS: Record<string, Set<string>> = {
  "worker:compiler": new Set(["ContextCompiled"]),
  "worker:generator": new Set(["GenerationCompleted","GenerationFailed","IdeationPreviewCompleted"]),
  "worker:renderer": new Set(["DocumentRenderCompleted","DocumentRenderFailed"]),
  "worker:extractor": new Set(["ExtractionCompleted","ExtractionFailed","ExtractionSuperseded","ExtractorEvaluationCompleted","ImageFocalPointCalculated"]),
  "worker:brief": new Set(["BriefComposed"]),
  "worker:taste": new Set(["TasteModelVersioned"]),
  "worker:validator": new Set(["ValidationFailed"]),
  "worker:registry": new Set(["ModelRegistered","AdapterVersioned","CapabilityDeclared"]),
  "worker:indexer": new Set(["FamilyDeclared","FamilyAnchorSet","FamilyMembershipAsserted"]),
  "worker:scheduler": new Set(["BranchAbandoned","ConditionFired","Resurfaced","JobAttemptInterrupted","JobCanceled","JobForceFailed"]),
  "worker:attribution": new Set(["AttributionComputed"]),
  "worker:annotator": new Set(["AnnotationAdded","AnnotationRetracted"]),
  "worker:policy": new Set(["BudgetReserved","BudgetReleased","BudgetExceeded","GenerationUsageRecorded","RetentionSweepCompleted","GenerationPreflightRequested","GenerationPreflightCompleted","GenerationPreflightInvalidated","GenerationBlockedBeforeProvider","GenerationRiskAcknowledged","GenerationRemediationApplied","ProviderHealthObserved"]),
  "worker:scout": new Set(["ScoutRunStarted","ScoutObserved","ScoutRunCompleted","ScoutBudgetExhausted","GenerationRequested","GenerationCompleted","GenerationFailed"]),
  "worker:arranger": new Set(["ProposalIssued","CanvasLockOverridden"]),
  "worker:replay-fixture": new Set(["ProjectCreated","DocumentCreated","EmptyCanvasChosen","CanvasCreated","MembershipAdded","BlockCreated","ReferenceIngested","RightsAsserted","ExtractionCompleted","BlockRelationAdded","ContextCompiled","IdeationPreviewCompleted","GenerationCompleted","CollectionCreated","CollectionItemAdded","CanvasReferenceCreated","CanvasItemPlaced","ContextSetFormalized","ProjectOpened","DocumentOpened","ReplayPersonaProjectMaterialized","ReplayPersonaPrepared"]),
  "model:forma-chat": new Set(["MutationProposed","AssistantReasoned"]),
};
const COMMUTATIVE = new Set(["AnnotationAdded","AnnotationRetracted","ComparisonOpened","ObjectViewed","ObjectSaved","ObjectDiscarded","ObjectPinned","ObjectUnpinned","ObjectRegenerated","ObjectCritiqued","ObjectExported","DocumentArtifactViewed","DocumentArtifactExported","AddedToLibrary","RemovedFromLibrary","PromptFanOutputPromoted","ScoutObserved","FamilyMembershipAsserted","AttentionEpisodeObserved","ApplicationViewVisited","DocumentViewVisited","CanvasInteractionRecorded",...CANVAS_COMMUTATIVE_EVENT_TYPES]);
const HOT_EVENTS = new Set(["AnnotationAdded","ComparisonOpened","ObjectViewed","ObjectPinned","DocumentArtifactViewed","AttentionEpisodeObserved","ApplicationViewVisited","DocumentViewVisited","CanvasInteractionRecorded"]);
const PERMISSION_SCHEMA_VERSION = 1;
const failureEventFields = (detail: ProviderFailureDetail) => ({
  error_class: detail.category, error_code: detail.code, error_category: detail.category, error_scope: detail.scope, error_action: detail.action,
  error_message: detail.message, retryable: detail.retryable, retry_after_ms: detail.retryAfterMs, provider_request_id: detail.requestId, http_status: detail.httpStatus,
  risk_categories: detail.riskCategories??[], contributing_block_ids: detail.contributingBlockIds??[], contributing_reference_ids: detail.contributingReferenceIds??[], preflight_probe: detail.probe??null,
  ...(detail.validationIssues?.length?{validation_issues:detail.validationIssues}:{}),
});

const STORYBOARD_VISUAL_FACT_TYPES = new Set([
  "subject", "environment", "action", "setting", "composition", "emotion", "mood", "palette", "material", "lighting", "style",
]);
const STORYBOARD_OPERATIONAL_DIRECTION = /\b(?:providers?|paid|payments?|charges?|billing|settle(?:d|ment)?|failed|failures?|errors?|retries|retry|requests?|submi(?:t|ssion)|server|idempoten\w*|receipts?|reconcil\w*|budgets?|tokens?|private|identif\w*|credentials?|secrets?|pixels?|human\s+review|generations?|render(?:ed|ing)?|recover(?:ed|y)?|unsupported\s+success|metrics?|consum(?:e|er|ing|ption)|claims?|precharge)\b/i;

function storyboardVisualClauses(value: unknown, options: { exclude?: boolean } = {}) {
  const text = String(value ?? "")
    .replace(/[“"][^”"]*[”"]/g, "")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "")
    .replace(/\bhttps?:\/\/\S+/gi, "")
    .replace(/\.[a-z][a-z0-9]{1,7}\b/gi, "")
    .replace(/\b\d+\s*\/\s*\d+\b/g, "")
    .replace(/\bP[0-9]+\b/gi, "")
    .replace(/\borganized\s+into\s*(?:,\s*)+(?:and\s*)?columns\b/gi, "organized into three unlabeled columns")
    .replace(/\b(?:1024\s*[x×]\s*1024|\d+\s*:\s*\d+)\b/g, "3:2")
    .replace(/\bsquare\b/gi, "landscape")
    .replace(/\bCreate\s+output\b/gi, "primary action button")
    .replace(/\bprimary\s+primary\s+action\s+button\s+action\b/gi, "primary action button")
    .replace(/\b(?:clearly\s+)?(?:labeled|labelled|marked)\b/gi, "unlabeled")
    .replace(/\b(?:reads?|says?|states?|displays?)\s+exactly\s*:?/gi, "")
    .replace(/\bText\s+Below\s+it\b/gi, "")
    .replace(/\b(?:readable|legible|exact|visible)\s+(?:text|labels?|lettering|captions?|scores?|words?)\b/gi, "abstract visual shapes")
    .replace(/\b(?:scorecard|score\s*card)\b/gi, "unlabeled visual indicators")
    .replace(/\ba\s+abstract\b/gi, "an abstract");

  return text.split(/(?<=[.!?])\s+|\s*;\s*|\s*,\s*/g)
    .map((clause) => clause
      .replace(/^[\s.,:—–-]+|[\s.,:—–-]+$/g, "")
      .replace(/^(?:and|or|then)\s+/i, "")
      .replace(/\s+(?:reading|reads?|says?|stating|states?|displaying|displays?)$/i, "")
      .replace(/\s+/g, " ").trim())
    .filter((clause) => clause.length > 2 && !STORYBOARD_OPERATIONAL_DIRECTION.test(clause.replace(/[_-]+/g, " ")))
    .filter((clause) => clause.length > 2 && !/^(?:and|or|then|with|text|below it|exactly|organized into|columns|exact[\s-]+phrase protection)$/i.test(clause))
    .slice(0, options.exclude ? 12 : 18);
}

function storyboardVisualFact(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !promptFactIsActive(value)) return null;
  const fact = value as Record<string, unknown>;
  const type = String(fact.type ?? fact.role ?? "").trim().toLowerCase();
  const properties = fact.properties && typeof fact.properties === "object" && !Array.isArray(fact.properties)
    ? fact.properties as Record<string, unknown> : {};
  const negative = type === "exclusion" || [fact.intent, fact.effect, properties.intent]
    .some((intent) => ["avoid", "prohibit", "must_not_include"].includes(String(intent ?? "").toLowerCase()));
  if (!negative && !STORYBOARD_VISUAL_FACT_TYPES.has(type)) return null;

  const rawText = properties.text ?? properties.instruction ?? properties.description ?? properties.value ?? properties.label;
  const clauses = storyboardVisualClauses(rawText, { exclude: negative });
  if (rawText !== undefined && !clauses.length) return null;
  const visualProperties: Record<string, unknown> = {
    ...(clauses.length ? { text: clauses.join("; ") } : {}),
    ...(typeof properties.weight === "number" ? { weight: properties.weight } : {}),
    ...(typeof properties.authority === "string" ? { authority: properties.authority } : {}),
    ...(properties.locked === true ? { locked: true } : {}),
    ...(properties.required === true ? { required: true } : {}),
    ...(Array.isArray(properties.colors) ? { colors: properties.colors.filter((color) => typeof color === "string") } : {}),
    ...(Array.isArray(properties.palette) ? { palette: properties.palette.filter((color) => typeof color === "string") } : {}),
    ...(properties.spatial_scope && typeof properties.spatial_scope === "object" ? { spatial_scope: properties.spatial_scope } : {}),
  };
  return {
    ...(typeof fact.block_id === "string" ? { block_id: fact.block_id } : {}),
    type,
    ...(typeof fact.role === "string" ? { role: fact.role } : {}),
    ...(typeof fact.intent === "string" ? { intent: fact.intent } : {}),
    ...(typeof fact.effect === "string" ? { effect: fact.effect } : {}),
    ...(fact.locked === true ? { locked: true } : {}),
    active: true,
    properties: visualProperties,
  };
}

/** Project authored story meaning into an image-only frame without exposing its research or execution history. */
export function storyboardFrameRenderingInput(
  snapshot: Record<string, unknown>,
  frame: { title: string; image_prompt: string; notes?: string },
) {
  const facts = (Array.isArray(snapshot.facts) ? snapshot.facts : []).map(storyboardVisualFact)
    .filter((fact): fact is NonNullable<typeof fact> => fact !== null);
  const standingConstraints = (Array.isArray(snapshot.standing_constraints) ? snapshot.standing_constraints : [])
    .flatMap((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const constraint = value as Record<string, unknown>;
      const clauses = storyboardVisualClauses(constraint.value, { exclude: true });
      if (!clauses.length) return [];
      return [{
        ...(typeof constraint.axis === "string" ? { axis: constraint.axis } : {}),
        ...(typeof constraint.polarity === "string" ? { polarity: constraint.polarity } : {}),
        value: clauses.join("; "),
      }];
    });
  const scene = storyboardVisualClauses(frame.image_prompt).join(". ") || "A calm, clear product-design scene with distinct abstract cards and visual pathways";
  const title = storyboardVisualClauses(frame.title).join(". ") || "Editorial storyboard scene";

  return {
    snapshot: { facts, ...(standingConstraints.length ? { standing_constraints: standingConstraints } : {}) },
    direction: {
      title,
      rationale: "Frame-specific visual composition; keep all captions outside the artwork.",
      scene: `${scene}. Use abstract shapes and blank, unmarked surfaces. Communicate every idea visually without words, letters, numbers, labels, captions, or interface text.`,
      palette: [] as string[],
      next_moves: [] as string[],
    },
    size: "1536x1024" as const,
    ideogramCaptionStrategy: "compact_literal" as const,
  };
}

const providerCostReceipt=(parts:ProviderCostBreakdown[])=>{const summed=parts.reduce((total,part)=>({text_input_microusd:total.text_input_microusd+part.textInputMicrousd,text_output_microusd:total.text_output_microusd+part.textOutputMicrousd,image_text_input_microusd:total.image_text_input_microusd+part.imageTextInputMicrousd,image_input_microusd:total.image_input_microusd+part.imageInputMicrousd,image_output_microusd:total.image_output_microusd+part.imageOutputMicrousd}),{text_input_microusd:0,text_output_microusd:0,image_text_input_microusd:0,image_input_microusd:0,image_output_microusd:0});return{pricing_version:LIVE_REPLAY_PRICING_VERSION,cost_microusd:Object.values(summed).reduce((sum,value)=>sum+value,0),cost_breakdown_microusd:summed,cost_precision:"provider-receipt-or-published-rate"};};
async function retainFailurePrompt(env:WorkerEnv,ownerId:string,error:unknown,projectScope?:ProjectExecutionScope){
  const prompt=providerFailurePrompt(error)?.trim()??"";if(!prompt)return null;
  const stored=await storePrivateContent(env,ownerId,"prompt",prompt,projectScope);return{prompt,ref:stored.contentId,expiresAt:stored.expiresAt};
}

const canAppend = (actor: string, type: string) => actor === "user" ? USER_EVENTS.has(type) : PRODUCER_EVENTS[actor]?.has(type) ?? false;
const seededStreams = new WeakMap<D1Database, Set<string>>();
async function seedIfEmpty(env:WorkerEnv,streamId:string) {
  let known = seededStreams.get(env.DB);
  if (!known) { known = new Set<string>(); seededStreams.set(env.DB, known); }
  if (known.has(streamId)) return;
  if(await streamHead(env,streamId)>0){known.add(streamId);return;} const corr=uuidV7(); const client="seed:lit-studio";
  const specs:Array<[string,string,Record<string,unknown>]> = [
    ["user","ProjectCreated",{project_id:"project-atmosphere",name:"Studio launch",state:"active"}],
    ["user","DocumentCreated",{document_id:"doc-atmosphere",handle:"atmosphere-studies",title:"Atmosphere studies"}],
    ["worker:registry","ModelRegistered",{model_id:"gpt-image-2",planner_model_id:"gpt-5.6-terra",provider:"openai",status:"human-gated"}],
    ["worker:registry","AdapterVersioned",{adapter_id:"openai-image",version:"v1",contract_version:3}],
    ["worker:registry","CapabilityDeclared",{model_id:"gpt-image-2",capabilities:["image-generation","private-asset-output","context-snapshot"]}],
    ["user","SessionOpened",{session_id:"session-today",snapshot_ref:null}],
    ["user","BlockCreated",{block_id:"block-direction",type:"direction",handle:"direction/nocturne",properties:{text:"A quiet interior that feels held between dusk and night.",weight:.92,authority:"authored"},position:"a0"}],
    ["user","ReferenceIngested",{reference_id:"ref-window-light",source_type:"upload",source_ref:"seed://window-light",content_hash:"seed-window-light",rights_class:"owned"}],
    ["user","BlockCreated",{block_id:"block-reference",type:"reference",handle:"reference/window-light",properties:{reference_id:"ref-window-light",label:"Window light",weight:.78,authority:"authored"},position:"a1"}],
    ["user","BlockCreated",{block_id:"block-palette",type:"palette",handle:"palette/dusk-warm",properties:{colors:["#27252B","#E9A073","#E8D7BD","#8A6571"],weight:.84,authority:"inferred",confidence:.86},position:"a2"}],
    ["worker:extractor","ExtractionCompleted",{block_id:"block-palette",extractor_name:"palette-kmeans-v1",chips:[{chip_id:"chip-palette",property:"colors",value:["#27252B","#E9A073","#E8D7BD","#8A6571"],confidence:.86}]}],
    ["user","CollectionCreated",{collection_id:"collection-studio",handle:"studio-launch",parent_collection_id:null,source_claim_ref:null,position:"a0"}],
    ["user","CollectionCreated",{collection_id:"collection-client",handle:"client-work",parent_collection_id:null,source_claim_ref:null,position:"a1"}],
    ["user","CollectionCreated",{collection_id:"collection-acme",handle:"acme",parent_collection_id:"collection-client",source_claim_ref:null,position:"a0"}],
    ["user","CollectionItemAdded",{collection_id:"collection-studio",item_ref:{document_id:"doc-atmosphere"},position:"a0"}],
    ["worker:indexer","FamilyDeclared",{family_id:"family-warm-nocturnes",label:"Warm nocturnes",confidence:.81,evidence_refs:["event:11"]}],
    ["worker:compiler","ContextCompiled",{generation_id:"generation-01",model_id:"seed-simulation-v1",adapter_version:"seed-v1",compiled_snapshot:{facts:["direction/nocturne","reference/window-light","palette/dusk-warm"],pins:["block-direction"],tail:[],as_of:{head:16,lag:0}},source_block_versions:[{block_id:"block-direction",version:1},{block_id:"block-reference",version:1},{block_id:"block-palette",version:1}]}],
    ["worker:generator","GenerationCompleted",{generation_id:"generation-01",model_id:"seed-simulation-v1",provider:"simulation",object_ids:["object-nocturne-01"],latency_ms:1820,variant:0,simulation:true}],
    ["worker:compiler","ContextCompiled",{generation_id:"generation-02",model_id:"seed-simulation-v1",adapter_version:"seed-v1",compiled_snapshot:{facts:["direction/nocturne","reference/window-light","palette/dusk-warm"],pins:["block-direction"],tail:[],as_of:{head:18,lag:0}},source_block_versions:[{block_id:"block-direction",version:1},{block_id:"block-reference",version:1},{block_id:"block-palette",version:1}]}],
    ["worker:generator","GenerationCompleted",{generation_id:"generation-02",model_id:"seed-simulation-v1",provider:"simulation",object_ids:["object-nocturne-02"],latency_ms:1450,variant:1,simulation:true}],
    ["user","ObjectPinned",{object_id:"object-nocturne-01",scope:"project"}],
    ["user","ComparisonOpened",{object_ids:["object-nocturne-01","object-nocturne-02"],source_surface:"studio"}],
    ["user","ConditionSet",{condition_id:"condition-palette-3",condition_ref:"three-new-generations",scope:"project"}],
  ];
  const rows=specs.map(([actor,type,payload],i)=>makeEvent(streamId,i+1,actor,client,corr,type,payload)); await env.DB.batch(rows.map(e=>insertEvent(env,e)));known.add(streamId);
}

type CollectionState={parents:Map<string,string|null>;handles:Map<string,{handle:string;removed:boolean}>;membership:Map<string,string>};
function collectionState(events:EventRow[]):CollectionState{const parents=new Map<string,string|null>(),handles=new Map<string,{handle:string;removed:boolean}>(),membership=new Map<string,string>();for(const e of events){const p=e.payload;if(e.type==="CollectionCreated"){const id=String(p.collection_id);parents.set(id,p.parent_collection_id?String(p.parent_collection_id):null);handles.set(id,{handle:String(p.handle??""),removed:false});}else if(e.type==="CollectionRenamed"){const c=handles.get(String(p.collection_id));if(c)c.handle=String(p.new_handle??c.handle);}else if(e.type==="CollectionRemoved"||e.type==="CollectionRestored"){const c=handles.get(String(p.collection_id));if(c)c.removed=e.type==="CollectionRemoved";}else if(e.type==="CollectionItemAdded"||e.type==="CollectionItemMoved"){const ref=(p.item_ref??{}) as Record<string,unknown>;const id=String(ref.document_id??ref.block_id??ref.collection_id??ref.object_id??"");const target=String(e.type==="CollectionItemMoved"?p.to_collection_id:p.collection_id);if(id)membership.set(id,target);if(ref.collection_id)parents.set(String(ref.collection_id),target);}else if(e.type==="CollectionItemRemoved"){const ref=(p.item_ref??{}) as Record<string,unknown>;const id=String(ref.document_id??ref.block_id??ref.collection_id??ref.object_id??"");membership.delete(id);if(ref.collection_id)parents.set(String(ref.collection_id),null);}}return{parents,handles,membership};}
function cycle(id:string,target:string,parents:Map<string,string|null>){let cursor:string|null|undefined=target;const seen=new Set<string>();while(cursor){if(cursor===id||seen.has(cursor))return true;seen.add(cursor);cursor=parents.get(cursor);}return false;}
function validateCollection(item:EventInput,state:CollectionState){const p=item.payload??{};if(item.type==="CollectionCreated"){const id=String(p.collection_id??""),handle=String(p.handle??"").trim(),parent=p.parent_collection_id?String(p.parent_collection_id):null;if(!id||!handle)return"collection_id_and_handle_required";if(state.handles.has(id))return"collection_id_exists";if(parent&&!state.handles.has(parent))return"parent_not_found";if([...state.handles].some(([eid,v])=>eid!==id&&!v.removed&&v.handle===handle&&state.parents.get(eid)===parent))return"sibling_handle_collision";state.parents.set(id,parent);state.handles.set(id,{handle,removed:false});}if(item.type==="CollectionItemAdded"||item.type==="CollectionItemMoved"){const ref=(p.item_ref??{}) as Record<string,unknown>;const id=String(ref.document_id??ref.block_id??ref.collection_id??ref.object_id??""),target=String(item.type==="CollectionItemMoved"?p.to_collection_id:p.collection_id);if(!id||!target||!state.handles.has(target))return"valid_item_and_target_required";if(item.type==="CollectionItemAdded"&&state.membership.has(id))return"item_already_filed";if(ref.collection_id&&cycle(id,target,state.parents))return"collection_cycle";state.membership.set(id,target);if(ref.collection_id)state.parents.set(id,target);}return null;}
const ATTENTION_SURFACES=new Set(["studio","library","sessions","scout","memory","system","event-admin"]);const ATTENTION_CONTEXTS=new Set(["studio-overview","studio-context","writing-direction","generation","comparison","library-overview","library-browsing","sessions-overview","scout-overview","memory-overview","system-overview","event-admin-overview"]);const ATTENTION_TERMINALS=new Set<string>([...ATTENTION_ACTION_TERMINALS,"route_changed","page_hidden","idle_timeout"]);const SAFE_ATTENTION_REF=/^[a-z0-9][a-z0-9:_-]{0,127}$/i;
const DOCUMENT_VIEW_SET=new Set<string>(DOCUMENT_VIEWS);
const APPLICATIONS=new Set(["creative","canvas","operations","laboratory"]);const APPLICATION_SURFACES=new Set(["document","operations-events","operations-analytics","operations-system","laboratory-replay","laboratory-home","canvas-workspace","canvas-home","library","sessions","scout","memory","projects","creative-workspace"]);
function normalizeDocumentView(item:EventInput){const p=item.payload??{};const documentId=String(p.document_id??""),projectId=String(p.project_id??""),view=String(p.view??"");if(!SAFE_ATTENTION_REF.test(documentId)||!DOCUMENT_VIEW_SET.has(view))return null;return{document_id:documentId,project_id:SAFE_ATTENTION_REF.test(projectId)?projectId:null,view,focused:Boolean(p.focused),route_family:"document",source_surface:"document-view-navigation"};}
function normalizeApplicationView(item:EventInput){const p=item.payload??{};const application=String(p.application??""),surface=String(p.surface??""),documentId=String(p.document_id??""),projectId=String(p.project_id??""),documentView=String(p.document_view??"");if(!APPLICATIONS.has(application)||!APPLICATION_SURFACES.has(surface))return null;return{application,surface,route_family:surface,document_id:SAFE_ATTENTION_REF.test(documentId)?documentId:null,project_id:SAFE_ATTENTION_REF.test(projectId)?projectId:null,document_view:DOCUMENT_VIEW_SET.has(documentView)?documentView:null,focused:Boolean(p.focused)};}
function normalizeAttention(item:EventInput){const p=item.payload??{};const surface=String(p.surface??""),context=String(p.context??""),terminal=String(p.terminal_type??"");const startedAt=String(p.started_at??""),endedAt=String(p.ended_at??"");const started=Date.parse(startedAt),ended=Date.parse(endedAt),now=Date.now();const active=Math.max(0,Math.min(300_000,Math.round(Number(p.active_ms??0)))),idle=Math.max(0,Math.min(300_000,Math.round(Number(p.idle_ms??0))));if(!ATTENTION_SURFACES.has(surface)||!ATTENTION_CONTEXTS.has(context)||!ATTENTION_TERMINALS.has(terminal)||!Number.isFinite(started)||!Number.isFinite(ended)||ended<started||ended>now+300_000||ended<now-86_400_000||active+idle<1_500)return null;const visibleRefs=(Array.isArray(p.visible_refs)?p.visible_refs:[]).map(String).filter((value)=>SAFE_ATTENTION_REF.test(value)).slice(0,8);const requestedRef=p.terminal_ref?String(p.terminal_ref):null;const documentView=DOCUMENT_VIEW_SET.has(String(p.document_view??""))?String(p.document_view):undefined;const documentId=SAFE_ATTENTION_REF.test(String(p.document_id??""))?String(p.document_id):undefined;return buildAttentionEpisode({episode_id:SAFE_ATTENTION_REF.test(String(p.episode_id??""))?String(p.episode_id):uuidV7(),surface,context,document_view:documentView,document_id:documentId,focused:documentView?Boolean(p.focused):undefined,started_at:new Date(started).toISOString(),ended_at:new Date(ended).toISOString(),active_ms:active,idle_ms:idle,visible_refs:visibleRefs,terminal_type:terminal,terminal_ref:requestedRef&&SAFE_ATTENTION_REF.test(requestedRef)?requestedRef:null});}

const slug=(value:string,id="")=>value.normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"").slice(0,42)||(id?`decision-${id.slice(0,8)}`:"decision");
function snapshotForProjection(projection:CreativeProjection){const facts=projection.blocks.map((block)=>({block_id:block.id,document_id:block.documentId,type:block.type,role:block.type,intent:blockIntentFor(block.type,block.properties),handle:block.handle,position:block.position,locked:block.locked,active:Number(block.properties.weight??.5)>0,effect:blockEffectFor(block.type,block.properties),properties:{...block.properties,spatial_scope:normalizeSpatialScope(block.properties.spatial_scope)},authority:block.properties.authority??"authored",source_event_refs:block.sourceEvents}));const relationships=projection.blockRelations.map((relation)=>({relation_id:relation.id,from_block_id:relation.fromBlockId,to_block_id:relation.toBlockId,kind:relation.kind,properties:relation.properties,source_event_refs:relation.sourceEvents}));return{facts,relationships,context_groups:combinedContextGroups({facts,relationships}),pins:projection.outputs.filter((output)=>output.pinned).map((output)=>output.id),tail:[],document:{id:projection.documentId,title:projection.documentTitle}};}
const previewObjectId=(event:EventRow)=>String(event.payload.object_id??(Array.isArray(event.payload.object_ids)?event.payload.object_ids[0]:"")??"")||`draft-${String(event.payload.generation_id??event.eventId)}`;
const stableJson=(value:unknown):string=>Array.isArray(value)?`[${value.map(stableJson).join(",")}]`:value&&typeof value==="object"?`{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b,"en-US")).map(([key,item])=>`${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`:JSON.stringify(value);
async function creativeContextHash(value:unknown){const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(stableJson(value)));return Array.from(new Uint8Array(bytes),(byte)=>byte.toString(16).padStart(2,"0")).join("");}
function audioVideoReferenceError(code:string,message:string,status=400):never{
  throw new ProviderRequestError({code,category:"provider",scope:"request",action:"edit_request",message,retryable:false,retryAfterMs:null,requestId:null,httpStatus:status});
}
export async function approvedAudioVideoReference(env:WorkerEnv,ownerId:string,projection:CreativeProjection,events:EventRow[],artifactId:string,scope?:ProjectExecutionScope):Promise<AudioVideoReference>{
  const artifact=projection.artifacts.find((candidate)=>candidate.id===artifactId&&candidate.kind==="video"&&candidate.documentId===projection.documentId);
  if(!artifact||!artifact.mediaUrl||artifact.mediaType!=="video/mp4")audioVideoReferenceError("audio_video_reference_not_found","Choose an approved video created in this same document.",404);
  const completed=events.find((event)=>event.eventId===artifact.sourceEventId&&event.type==="DocumentRenderCompleted"&&String(event.payload.artifact_id??"")===artifact.id&&String(event.payload.document_id??"")===projection.documentId&&String(event.payload.project_id??projection.projectId)===projection.projectId);
  if(!completed||String(completed.payload.media_url??"")!==artifact.mediaUrl)audioVideoReferenceError("audio_video_reference_integrity_mismatch","The selected video no longer matches its original generation receipt.",409);
  if(artifactReviewState(artifact,projection.blocks,events).status!=="approved")audioVideoReferenceError("audio_video_reference_approval_required","The selected video must be reviewed, approved, and current before its contents can be shared.",409);
  const items=Array.isArray(completed.payload.items)?completed.payload.items.filter((value):value is Record<string,unknown>=>Boolean(value)&&typeof value==="object"&&!Array.isArray(value)):[];
  const matched=items.find((item)=>String(item.media_url??"")===artifact.mediaUrl);
  const settings=completed.payload.settings&&typeof completed.payload.settings==="object"?completed.payload.settings as Record<string,unknown>:{};
  const assembly=settings.assembly&&typeof settings.assembly==="object"?settings.assembly as Record<string,unknown>:null;
  if(items.length>1&&assembly?.composed!==true)audioVideoReferenceError("audio_video_reference_assembly_unsupported","Choose one approved playable video clip; an unassembled multi-scene reel cannot be synchronized as one video.",409);
  if(Array.isArray(settings.soundtrack_assets)&&settings.soundtrack_assets.length)audioVideoReferenceError("audio_video_reference_embedded_soundtrack_unsupported","Videos containing an externally supplied soundtrack cannot be sent to another audio provider.",403);
  const durationSeconds=Number(items.length>1?settings.video_seconds:matched?.duration_seconds??settings.video_seconds??0);
  if(!Number.isFinite(durationSeconds)||durationSeconds<=0||durationSeconds>180)audioVideoReferenceError("audio_video_reference_duration_unsupported","An approved synchronization video must have a verified duration between 1 and 180 seconds.",422);
  const media=await readOwnedGeneratedVideoReference(env,ownerId,artifact.id,artifact.mediaUrl);
  if(!media)audioVideoReferenceError("audio_video_reference_unavailable","The approved video must be an owner-controlled generated MP4 no larger than 25 MB.",403);
  if(scope){
    const authorized=await env.DB.prepare(`SELECT 1 AS present FROM project_resource_scopes media
      JOIN project_resource_scopes artifact ON artifact.project_access_id=media.project_access_id AND artifact.organization_id=media.organization_id
      AND artifact.project_id=media.project_id AND artifact.owner_user_id=media.owner_user_id AND artifact.resource_kind='artifact' AND artifact.resource_id=?
      WHERE media.project_access_id=? AND media.organization_id=? AND media.project_id=? AND media.owner_user_id=? AND media.resource_kind='media' AND media.resource_id=?`)
      .bind(artifact.id,scope.projectAccessId,scope.organizationId,scope.projectId,scope.ownerUserId,media.key).first<{present:number}>();
    if(!authorized)audioVideoReferenceError("audio_video_reference_project_scope_invalid","The approved video does not belong to this project's authorized artifact and media scope.",403);
  }
  return{bytes:media.bytes,mimeType:media.mimeType,artifactId:artifact.id,referenceId:artifact.id,label:artifact.title,durationSeconds:Math.ceil(durationSeconds)};
}
const referenceInputReceipts=(references:ImageReference[])=>references.map((reference)=>({source:reference.source,block_id:reference.blockId??null,reference_id:reference.referenceId??null,label:reference.label??null,mode:reference.mode??null}));
const managedImageBrief=(plan:ManagedProductionPlan)=>({
  team:productionTeamFor("image").specialists.map((role)=>({role:role.label,responsibility:role.responsibility})),
  continuity_bible:providerFacingProductionContinuity({claims:plan.claims.filter((claim)=>!claim.contextGroupIds.length)}),
  required_source_coverage:plan.claims.filter((claim)=>!claim.negative&&!claim.contextGroupIds.length).map((claim)=>claim.text),
  scoped_targets:providerFacingProductionTargets(plan),
});
const managedImageEventFields=(plan:ManagedProductionPlan|null)=>plan?{
  production_mode:"managed" as const,
  production_team:plan.team.id,
  production_team_version:plan.team.version,
  production_required_claim_count:plan.claims.filter((claim)=>!claim.negative).length,
  production_quality:scoreManagedProductionPlan(plan),
}:{};
async function uploadedPixelReferences(env:WorkerEnv,ownerId:string,projection:CreativeProjection,sourceEvents:EventRow[],snapshot?:Record<string,unknown>):Promise<ImageReference[]>{
  const references:ImageReference[]=[];
  const authorizedIds=snapshot?new Set((Array.isArray(snapshot.facts)?snapshot.facts:[]).flatMap((fact)=>fact&&typeof fact==="object"?[String((fact as Record<string,unknown>).block_id??"")]:[])):null;
  for(const block of projection.blocks){
    if(block.type!=="reference"||authorizedIds&&!authorizedIds.has(block.id)||Number(block.properties.weight??.5)<=0||!sendsReferencePixels(block.properties.pixel_reference_mode))continue;
    if(block.properties.context_reference_kind==="character_identity"&&block.properties.pixel_reference_mode==="preserve_subject"&&block.properties.likeness_transfer_consent!==true)throw new Error(`character_likeness_consent_required:${block.id}`);
    const referenceId=String(block.properties.reference_id??"");const rightsConfirmed=sourceEvents.some((event)=>event.type==="RightsAsserted"&&String(event.payload.reference_id??"")===referenceId)||sourceEvents.some((event)=>event.type==="ReferenceIngested"&&String(event.payload.reference_id??"")===referenceId&&Boolean(event.payload.rights_class));
    if(!referenceId||!rightsConfirmed)throw new Error(`reference_pixel_rights_required:${block.id}`);
    const image=await readGeneratedImageReference(env,ownerId,block.properties.media_url);if(!image)throw new Error(`reference_pixel_input_unavailable:${block.id}`);
    references.push({...image,blockId:block.id,referenceId,label:String(block.properties.label??block.handle),mode:referencePixelMode(block.properties.pixel_reference_mode),source:"uploaded-reference"});
  }
  return references;
}
async function videoPixelReferences(env:WorkerEnv,ownerId:string,snapshot:Record<string,unknown>,sourceEvents:EventRow[],projectScope?:ProjectExecutionScope):Promise<VideoReference[]>{
  const rawFacts=Array.isArray(snapshot.facts)?snapshot.facts:[];const candidates=rawFacts.map((value)=>value&&typeof value==="object"?value as Record<string,unknown>:{}).filter((fact)=>fact.type==="reference"&&fact.active!==false).map((fact)=>{const properties=fact.properties&&typeof fact.properties==="object"?fact.properties as Record<string,unknown>:{};return{fact,properties};}).filter(({properties})=>Number(properties.weight??.5)>0&&sendsReferencePixels(properties.pixel_reference_mode)).sort((left,right)=>{const leftArtifact=String(left.properties.source_artifact_id??""),rightArtifact=String(right.properties.source_artifact_id??"");if(leftArtifact&&leftArtifact===rightArtifact){const delta=Number(left.properties.storyboard_frame_index??Number.POSITIVE_INFINITY)-Number(right.properties.storyboard_frame_index??Number.POSITIVE_INFINITY);if(delta)return delta;}return String(left.fact.position??"").localeCompare(String(right.fact.position??""));});
  const document=snapshot.document&&typeof snapshot.document==="object"?snapshot.document as Record<string,unknown>:null;
  const authoritative=projectScope?foldEvents(sourceEvents,Number.POSITIVE_INFINITY,String(document?.id??""),projectScope.projectId):null;
  const namedGroups=new Map(combinedContextGroups(snapshot).map((group)=>[group.id,group]));
  const references:VideoReference[]=[];
  for(const {fact,properties} of candidates){
    const blockId=String(fact.block_id??""),referenceId=String(properties.reference_id??"");const rightsConfirmed=sourceEvents.some((event)=>event.type==="RightsAsserted"&&String(event.payload.reference_id??"")===referenceId)||sourceEvents.some((event)=>event.type==="ReferenceIngested"&&String(event.payload.reference_id??"")===referenceId&&Boolean(event.payload.rights_class));
    if(!referenceId||!rightsConfirmed)throw new ProviderRequestError({code:"video_reference_rights_required",category:"provider",scope:"request",action:"edit_request",message:`${String(properties.label??fact.handle??"A video reference")} needs usable rights evidence before its pixels can be sent to the video provider.`,retryable:false,retryAfterMs:null,requestId:null,httpStatus:400,contributingBlockIds:[blockId],contributingReferenceIds:referenceId?[referenceId]:[]});
    if(projectScope){
      const actual=authoritative?.blocks.find((block)=>block.id===blockId&&block.type==="reference"&&block.projectId===projectScope.projectId&&String(block.properties.reference_id??"")===referenceId);
      const suppliedUrl=String(properties.media_url??"");let mediaKey="";try{mediaKey=suppliedUrl.startsWith("/api/media/")?decodeURIComponent(suppliedUrl.slice("/api/media/".length)):"";}catch{mediaKey="";}
      const matched=actual&&String(actual.properties.media_url??"")===suppliedUrl&&mediaKey?await env.DB.prepare(`SELECT 1 AS present FROM project_resource_scopes media
        JOIN project_resource_scopes block ON block.project_access_id=media.project_access_id AND block.organization_id=media.organization_id AND block.project_id=media.project_id AND block.owner_user_id=media.owner_user_id AND block.resource_kind='block' AND block.resource_id=?
        JOIN project_resource_scopes reference ON reference.project_access_id=media.project_access_id AND reference.organization_id=media.organization_id AND reference.project_id=media.project_id AND reference.owner_user_id=media.owner_user_id AND reference.resource_kind='reference' AND reference.resource_id=?
        WHERE media.project_access_id=? AND media.organization_id=? AND media.project_id=? AND media.owner_user_id=? AND media.resource_kind='media' AND media.resource_id=?`)
        .bind(blockId,referenceId,projectScope.projectAccessId,projectScope.organizationId,projectScope.projectId,projectScope.ownerUserId,mediaKey).first():null;
      if(!matched)throw new ProviderRequestError({code:"video_reference_not_authorized",category:"provider",scope:"request",action:"edit_request",message:"This reference image is not authorized for the selected project and document.",retryable:false,retryAfterMs:null,requestId:null,httpStatus:403,contributingBlockIds:[blockId],contributingReferenceIds:[referenceId]});
    }
    const image=await readGeneratedImageReference(env,ownerId,properties.media_url);if(!image)throw new ProviderRequestError({code:"video_reference_input_unavailable",category:"provider",scope:"request",action:"edit_request",message:`${String(properties.label??fact.handle??"A video reference")} is configured to send pixels, but its source image is unavailable. Replace or re-upload that reference before rendering.`,retryable:false,retryAfterMs:null,requestId:null,httpStatus:400,contributingBlockIds:[blockId],contributingReferenceIds:referenceId?[referenceId]:[]});
    const sequence=Number(properties.storyboard_frame_index);const contextGroups=combinedContextMemberships(properties).map((membership)=>({id:membership.contextSetId,name:membership.name,target:membership.target,role:membership.role,application:membership.application,relativity:membership.relativity}));for(const value of Array.isArray(properties.context_group_ids)?properties.context_group_ids:[]){const groupId=String(value);if(!groupId||contextGroups.some((group)=>group.id===groupId))continue;const group=namedGroups.get(groupId);contextGroups.push(group?{id:group.id,name:group.name,target:group.target,role:group.role,application:group.application,relativity:group.relativity}:{id:groupId,name:"Scoped authored subject",target:"its authored subject",role:"character",application:"isolate",relativity:1});}references.push({bytes:image.bytes,mimeType:image.mimeType,blockId,referenceId,label:String(properties.label??fact.handle??"Reference image"),mode:referencePixelMode(properties.pixel_reference_mode),sequence:Number.isFinite(sequence)&&sequence>0?sequence:null,shotDirection:String(properties.storyboard_shot_direction??properties.text??""),cameraDirection:String(properties.storyboard_camera_direction??""),framePrompt:String(properties.storyboard_frame_prompt??""),sourceArtifactId:properties.source_artifact_id?String(properties.source_artifact_id):null,sourceArtifactItemId:properties.source_artifact_item_id?String(properties.source_artifact_item_id):null,sourceArtifactKind:properties.source_artifact_kind?String(properties.source_artifact_kind):null,storyboardTitle:String(properties.storyboard_title??""),contextGroups,provider:image.provider,providerModel:image.providerModel,providerRequestId:image.providerRequestId,providerMediaUrl:image.providerMediaUrl});
  }
  return references;
}

type ApprovedAudioAsset = {
  block_id: string;
  reference_id: string;
  label: string;
  media_url: string;
  media_type: string;
  duration_seconds: number | null;
  rights_class: string;
  inclusion: "separate-playback-companion" | "provider-soundtrack-reference";
  provider_audio_transmitted: boolean;
  role: string;
  mood: string;
  transcript?:string;
  cues: Array<{ start_seconds: number; end_seconds: number | null; target_kind: string; target_id: string; label: string; emotional_intent: string }>;
  excerpt_start_seconds?: number;
  excerpt_duration_seconds?: number;
};

/** Selection, attachment, and provider transmission remain separately authorized. */
async function approvedSoundtrackAssets(
  env: WorkerEnv,
  ownerId: string,
  snapshot: Record<string, unknown>,
  sourceEvents: EventRow[],
  selectedBlockIds: string[],
  sendToProvider: boolean,
  projectScope?: ProjectExecutionScope,
): Promise<{ assets: ApprovedAudioAsset[]; providerReferences: VideoAudioReference[] }> {
  if (!selectedBlockIds.length) return { assets: [], providerReferences: [] };
  if(selectedBlockIds.length>(sendToProvider?VIDEO_AUDIO_REFERENCE_CONTRACT.maximumReferences:12))throw new ProviderRequestError({code:"audio_output_selection_limit_exceeded",category:"provider",scope:"request",action:"edit_request",message:sendToProvider?"Choose at most three approved soundtrack clips for the video provider.":"Choose at most twelve optional soundtrack companions.",retryable:false,retryAfterMs:null,requestId:null,httpStatus:400});
  const document = snapshot.document && typeof snapshot.document === "object" ? snapshot.document as Record<string, unknown> : null;
  const authoritative = projectScope ? foldEvents(sourceEvents, Number.POSITIVE_INFINITY, String(document?.id ?? ""), projectScope.projectId) : null;
  const facts = Array.isArray(snapshot.facts) ? snapshot.facts : [];
  const assets: ApprovedAudioAsset[] = [];
  const providerReferences: VideoAudioReference[] = [];
  const fail = (code: string, message: string, blockId: string, referenceId = "", status = 400) => {
    throw new ProviderRequestError({ code, category: "provider", scope: "request", action: "edit_request", message, retryable: false, retryAfterMs: null, requestId: null, httpStatus: status, contributingBlockIds: [blockId], contributingReferenceIds: referenceId ? [referenceId] : [] });
  };
  for (const blockId of selectedBlockIds) {
    const fact = facts.find((value) => value && typeof value === "object" && String((value as Record<string, unknown>).block_id ?? (value as Record<string, unknown>).id ?? "") === blockId);
    const context = audioContextFromFact(fact);
    const properties = fact && typeof fact === "object" && (fact as Record<string, unknown>).properties && typeof (fact as Record<string, unknown>).properties === "object" ? (fact as { properties: Record<string, unknown> }).properties : {};
    const referenceId = String(properties.reference_id ?? "").trim();
    if(audioFactProhibited(fact))fail("audio_output_prohibited","This recording is explicitly marked as a prohibited creative element and cannot accompany or be sent with an output.",blockId,referenceId);
    if (!context || !context.usage.includeInOutput) fail("audio_output_inclusion_not_authorized", "Select an active audio block explicitly approved for inclusion in this output.", blockId, referenceId);
    if (sendToProvider && !context!.usage.allowProviderAudioTransfer) fail("audio_provider_transfer_not_authorized", "This soundtrack has not been separately approved for transfer to the video provider.", blockId, referenceId);
    if (!referenceId) fail("audio_reference_provenance_missing", "This soundtrack needs a durable, rights-backed reference before it can accompany an output.", blockId);
    const rightsEvents=sourceEvents.filter((event)=>(event.type==="RightsAsserted"||event.type==="ReferenceIngested")&&String(event.payload.reference_id??"")===referenceId);
    const usableRights=rightsEvents.find((event)=>audioRightsAllowed(event.payload.rights_class));
    if(!usableRights)fail("audio_reference_rights_required","Confirm valid owned, licensed, or account-generated soundtrack rights before adding this recording.",blockId,referenceId);
    const expires=Date.parse(String(properties.license_expires_at??properties.rights_expires_at??""));
    if(Number.isFinite(expires)&&expires<=Date.now()||properties.rights_revoked===true)fail("audio_reference_rights_expired","This soundtrack’s recording rights have expired or were revoked.",blockId,referenceId);
    const recording=await readOwnedAudioReference(env,ownerId,context!.mediaUrl,{metadataOnly:!sendToProvider});
    if (!recording) fail("audio_reference_input_unavailable", "This soundtrack is no longer available in the selected private project.", blockId, referenceId, 403);
    const owned = recording!;
    const storedHash=String(owned.metadata.sha256??"");
    const ingested=rightsEvents.find((event)=>event.type==="ReferenceIngested"&&String(event.payload.source_ref??event.payload.media_url??"")===context!.mediaUrl);
    if(!storedHash||!ingested||String(ingested.payload.content_hash??"")!==storedHash||String(properties.source_content_hash??"")!==storedHash)fail("audio_reference_integrity_mismatch","This soundtrack’s reference, rights receipt, and private recording must resolve to the same verified content hash.",blockId,referenceId,403);
    if (projectScope) {
      const actual = authoritative?.blocks.find((block) => block.id === blockId && block.type === "audio" && block.projectId === projectScope.projectId && String(block.properties.reference_id ?? "") === referenceId);
      const matched = actual && String(actual.properties.media_url ?? "") === context!.mediaUrl ? await env.DB.prepare(`SELECT 1 AS present FROM project_resource_scopes media
        JOIN project_resource_scopes block ON block.project_access_id=media.project_access_id AND block.organization_id=media.organization_id AND block.project_id=media.project_id AND block.owner_user_id=media.owner_user_id AND block.resource_kind='block' AND block.resource_id=?
        JOIN project_resource_scopes reference ON reference.project_access_id=media.project_access_id AND reference.organization_id=media.organization_id AND reference.project_id=media.project_id AND reference.owner_user_id=media.owner_user_id AND reference.resource_kind='reference' AND reference.resource_id=?
        WHERE media.project_access_id=? AND media.organization_id=? AND media.project_id=? AND media.owner_user_id=? AND media.resource_kind='media' AND media.resource_id=?`)
        .bind(blockId, referenceId, projectScope.projectAccessId, projectScope.organizationId, projectScope.projectId, projectScope.ownerUserId, owned.key).first() : null;
      if (!matched) fail("audio_reference_not_authorized", "This soundtrack is not authorized for the selected project and document.", blockId, referenceId, 403);
    }
    const rightsClass=String(properties.rights_class??usableRights!.payload.rights_class??"").trim();
    if(!audioRightsAllowed(rightsClass))fail("audio_reference_rights_required","The soundtrack is missing confirmed recording rights.",blockId,referenceId);
    const asset:ApprovedAudioAsset={block_id:blockId,reference_id:referenceId,label:context!.label,media_url:context!.mediaUrl!,media_type:owned.mimeType,duration_seconds:owned.durationSeconds,rights_class:rightsClass,inclusion:sendToProvider?"provider-soundtrack-reference":"separate-playback-companion",provider_audio_transmitted:sendToProvider,role:context!.role,mood:context!.mood,...(context!.transcript?{transcript:context!.transcript}:{}),cues:context!.cues.map((cue)=>({start_seconds:cue.startSeconds,end_seconds:cue.endSeconds,target_kind:cue.targetKind,target_id:cue.targetId,label:cue.label,emotional_intent:cue.emotionalIntent}))};
    if(sendToProvider){if(!owned.durationSeconds)fail("video_audio_reference_duration_required","This recording has no server-verified MP3 or WAV duration and cannot be transferred to the video provider.",blockId,referenceId);let bytes=owned.bytes,duration=owned.durationSeconds!;if(duration>VIDEO_AUDIO_REFERENCE_CONTRACT.maximumCombinedDurationSeconds){const excerpt=boundedAudioExcerpt(bytes,owned.mimeType,0,VIDEO_AUDIO_REFERENCE_CONTRACT.maximumCombinedDurationSeconds);if(!excerpt)fail("video_audio_excerpt_unavailable","Forma could not safely derive the approved first-15-second soundtrack excerpt from this recording.",blockId,referenceId);bytes=excerpt!.bytes;duration=excerpt!.durationSeconds;asset.excerpt_start_seconds=excerpt!.startSeconds;asset.excerpt_duration_seconds=duration;}providerReferences.push({bytes,mimeType:owned.mimeType,blockId,referenceId,label:context!.label,durationSeconds:duration,rightsClass});}
    assets.push(asset);
  }
  return { assets, providerReferences };
}
export function creativeChatMutationEvents(input:{mutations:CreativeChatMutation[];projection:CreativeProjection;streamId:string;startSequence:number;client:string;corr:string;causationId:string;turnId:string;actor?:string}){
  const available=new Map(input.projection.blocks.map((block)=>[block.id,{...block}]));const events:EventRow[]=[];let sequence=input.startSequence;
  const governed=(block:{properties:Record<string,unknown>}|undefined)=>Boolean(block?.properties.organization_context_package_binding_id||block?.properties.organization_context_package_id);
  for(const mutation of input.mutations.slice(0,8)){
    if(mutation.operation==="create"){
      if(!isBlockKind(mutation.type)||mutation.type==="reference"||!mutation.instruction.trim())continue;const id=uuidV7();const definition=BLOCK_TYPES.find((item)=>item.type===mutation.type);const subtype=mutation.subtype.trim()||definition?.subtypes[0]||"General";const handle=`${mutation.type}/${slug(mutation.handle||mutation.instruction,id)}`;
      const imageFormat=mutation.type==="format"&&mutation.image_format?normalizeImageFormat({dimensions:{width:mutation.image_format.width,height:mutation.image_format.height}}):null;const properties={text:mutation.instruction.trim(),subtype,weight:.7,authority:"authored",created_from:"creative-chat",source_chat_turn_id:input.turnId,...(mutation.type==="audio"?{audio_role:subtype.toLowerCase().replace(/\s+/g,"_"),inform_generation:false,include_in_output:false,allow_provider_audio_transfer:false}:{}),...(imageFormat?{image_format:imageFormat}:{})};
      const event=makeEvent(input.streamId,++sequence,input.actor??"user",input.client,input.corr,"BlockCreated",{block_id:id,document_id:input.projection.documentId,type:mutation.type,handle,position:`z${String(sequence).padStart(6,"0")}`,properties},{causationId:input.causationId});events.push(event);available.set(id,{id,documentId:input.projection.documentId,canvasId:"",projectId:input.projection.projectId,scope:"document",type:mutation.type,handle,position:String(sequence),removed:false,locked:false,properties,sourceEvents:[event.eventId]});continue;
    }
    const target=mutation.target_block_id?available.get(mutation.target_block_id):undefined;if(!target||target.locked||governed(target))continue;
    if(mutation.operation==="remove"){const removals=outputBlockRemovalEvents(target,[...available.values()],input.projection.blockRelations,{type:"BlockRemoved",payload:{block_id:target.id,document_id:input.projection.documentId,reason:"removed-through-creative-chat",source_surface:"chat",source_chat_turn_id:input.turnId}});if(removals.some((removal)=>governed(available.get(String(removal.payload.block_id??"")))))continue;for(const removal of removals){events.push(makeEvent(input.streamId,++sequence,input.actor??"user",input.client,input.corr,removal.type,removal.payload,{causationId:input.causationId}));available.delete(String(removal.payload.block_id));}continue;}
    if(mutation.operation==="edit"){
      if(target.type==="format"&&mutation.image_format){const oldFormat=normalizeImageFormat(target.properties.image_format);const newFormat=normalizeImageFormat({dimensions:{width:mutation.image_format.width,height:mutation.image_format.height}});if(JSON.stringify(oldFormat)!==JSON.stringify(newFormat)){events.push(makeEvent(input.streamId,++sequence,input.actor??"user",input.client,input.corr,"BlockPropertyEdited",{block_id:target.id,document_id:input.projection.documentId,property_path:"image_format",old_value:oldFormat,new_value:newFormat,source_surface:"chat",source_chat_turn_id:input.turnId},{causationId:input.causationId}));target.properties={...target.properties,image_format:newFormat};}}
      if(target.type==="reference"&&mutation.reference_pixel_mode!=="unchanged"){
        const oldMode=referencePixelMode(target.properties.pixel_reference_mode);const newMode=referencePixelMode(mutation.reference_pixel_mode);if(oldMode!==newMode){events.push(makeEvent(input.streamId,++sequence,input.actor??"user",input.client,input.corr,"BlockPropertyEdited",{block_id:target.id,document_id:input.projection.documentId,property_path:"pixel_reference_mode",old_value:oldMode,new_value:newMode,source_surface:"chat",source_chat_turn_id:input.turnId},{causationId:input.causationId}));target.properties={...target.properties,pixel_reference_mode:newMode};}
      }
      if(mutation.instruction.trim()){
        const relation=input.projection.blockRelations.find((candidate)=>candidate.kind==="artifact_contains"&&candidate.toBlockId===target.id);const rootId=target.properties.source_artifact_item_id?relation?.fromBlockId??String(target.properties.context_set_root_id??""):target.id;const ownedIds=new Set(input.projection.blockRelations.filter((candidate)=>candidate.kind==="artifact_contains"&&candidate.fromBlockId===rootId).map((candidate)=>candidate.toBlockId));const related=[...available.values()].filter((block)=>block.id===rootId||ownedIds.has(block.id)||block.id===target.id);
        for(const change of outputBlockTextEditEvents(target,related,mutation.instruction.trim(),"chat")){
          if(governed(available.get(String(change.payload.block_id??""))))continue;
          const row=makeEvent(input.streamId,++sequence,input.actor??"user",input.client,input.corr,change.type,{...change.payload,document_id:input.projection.documentId,source_surface:"chat",source_chat_turn_id:input.turnId},{causationId:input.causationId});events.push(row);
          const edited=available.get(String(change.payload.block_id??""));if(edited&&change.payload.property_path)edited.properties={...edited.properties,[String(change.payload.property_path)]:change.payload.new_value};
        }
      }
    }
  }
  return{events,sequence};
}

export type EventExecutionControl = { signal: AbortSignal; beginCommit: () => Promise<void>; progress: (stage:string,message:string,patch?:Record<string,unknown>) => Promise<void> };

export async function handleEvents(request:Request,env:WorkerEnv,hot=false,userOverride?:PilotUser,execution?:EventExecutionControl):Promise<Response>{
  try{
    await ensureSchema(env);const inspection=request.method==="GET"&&new URL(request.url).searchParams.get("audit")==="1";const hasProjectCookie=/(?:^|;\s*)forma_project_context=/.test(request.headers.get("cookie")??"");const auth=userOverride?{response:null,user:userOverride}:await requireUser(request,env,inspection?"admin":request.method==="GET"||hasProjectCookie?"viewer":"creator",hasProjectCookie?{account:"principal"}:{});if(auth.response||!auth.user)return auth.response!;
    const selected=hasProjectCookie?await readProjectRequestContext(request,env,auth.user):{context:null,response:null};
    if(selected.response)return selected.response;
    if(selected.context){
      if(inspection||hot)return Response.json({error:"project_operation_unavailable"},{status:403});
      if(request.method==="GET"){
        const url=new URL(request.url);
        return Response.json(await readProjectEventPage(env,selected.context,Number(url.searchParams.get("after")??0),Number(url.searchParams.get("limit")??5000),url.searchParams.get("content")!=="0"));
      }
      if(request.method!=="POST")return new Response("Method not allowed",{status:405});
      const consent=requireConsent(auth.user);if(consent)return consent;
      return appendProjectEvents(env,selected.context,auth.user,await request.json());
    }
    let executionScope=auth.user.projectExecution;
    const ownerId=auth.user.userId,storageOwnerId=executionScope?.ownerUserId??ownerId,actorUserId=auth.user.userId,streamId=auth.user.streamId,userActor=executionScope?`user:${auth.user.userId}`:"user";
    const billingOwnerId=auth.user.billingUserId??actorUserId;await seedIfEmpty(env,streamId);
    if(request.method==="GET"){
      const url=new URL(request.url);const after=Math.max(0,Math.floor(Number(url.searchParams.get("after")??0))||0);
      if(inspection){const page=await readAuditEventPage(env,streamId,{before:Number(url.searchParams.get("before")??0),asOf:Number(url.searchParams.get("asOf")??0),limit:Number(url.searchParams.get("limit")??150),actor:url.searchParams.get("actor")??"",type:url.searchParams.get("type")??"",correlation:url.searchParams.get("correlation")??""});return Response.json({...page,permissionSchemaVersion:PERMISSION_SCHEMA_VERSION});}
      const profile=url.searchParams.get("profile");
      if(isScopedEventProfile(profile)){
        const limit=Math.max(1,Math.min(SCOPED_EVENT_PAGE_SIZE,Math.floor(Number(url.searchParams.get("limit")??SCOPED_EVENT_PAGE_SIZE))||SCOPED_EVENT_PAGE_SIZE));
        const page=await readProfileEventPage(env,streamId,profile,after,limit);
        return Response.json({...page,permissionSchemaVersion:PERMISSION_SCHEMA_VERSION});
      }
      const contentScope=url.searchParams.get("contentScope");if(contentScope!==null&&contentScope!=="chat"&&contentScope!=="memory")return Response.json({error:"invalid_content_scope"},{status:400});
      const limit=Math.max(1,Math.min(5000,Math.floor(Number(url.searchParams.get("limit")??5000))||5000));
      const [page,content]=await Promise.all([readEventPageWithHead(env,streamId,after,limit),url.searchParams.get("content")==="0"?Promise.resolve(undefined):loadPrivateContent(env,ownerId,contentScope==="chat"?"chat":contentScope==="memory"?"memory":"all",executionScope)]);
      return Response.json({...page,...(content?{content}:{}),permissionSchemaVersion:PERMISSION_SCHEMA_VERSION});
    }
    if(request.method!=="POST")return new Response("Method not allowed",{status:405});
    const consent=requireConsent(auth.user);if(consent)return consent;
    const body=await request.json() as {action?:"append"|"batch"|"canvas_sync"|"propose"|"preview"|"generate"|"chat"|"structure_adaptive"|"render_document"|"hot"|"evaluate_extractors"|"rebuild_index"|"extract_reference"|"calculate_focal_point"|"open_session"|"close_session"|"compose_brief"|"declare_intent"|"run_scout"|"refresh_taste_model"|"set_condition"|"check_conditions"|"critique_object";event?:EventInput;events?:EventInput[];expectedSequence?:number;clientId?:string;correlationId?:string;locale?:string;documentId?:string;documentRevision?:string;canvasId?:string;contextSetId?:string;projectScope?:boolean;prompt?:string;message?:string;livePreview?:boolean;sourceSurface?:string;sourcePreviewId?:string;sourceChatTurnId?:string;directionRef?:string;directionModel?:string;promptTechnique?:string;promptFanId?:string;preflightId?:string;preflightVersion?:string;preflightAcknowledged?:boolean;exemplarRefs?:Array<Record<string,unknown>>;snapshot?:Record<string,unknown>;sourceBlockVersions?:Array<Record<string,unknown>>;blockId?:string;referenceId?:string;targetKind?:"generation"|"reference"|"artifact";targetId?:string;mediaUrl?:string;sample?:ImageSample;findingKinds?:ReferenceFindingKind[];statement?:string;deadline?:string|null;maxObservations?:number;condition?:string;triggerKind?:"generation_count"|"on_date";threshold?:number;onDate?:string;objectId?:string;axis?:string;polarity?:"positive"|"negative";value?:string;note?:string;artifactId?:string;artifactKind?:DocumentArtifactKind;itemCount?:number;audience?:string;tone?:string;sceneMedium?:SceneMedium;sceneConfiguration?:SceneConfiguration;videoSeconds?:VideoDurationSeconds;videoSize?:"1280x720"|"720x1280";videoAudioMode?:VideoAudioMode;soundtrackBlockIds?:string[];sendSoundtrackToVideoProvider?:boolean;audioImageBlockId?:string;audioProfile?:AudioRequestProfile;audioProviderModel?:string;audioVideoArtifactId?:string;sendAudioVideoToProvider?:boolean;audioEstimatedCostMicrousd?:number;paidMediaConfirmed?:boolean;productionMode?:ProductionMode;productionPlan?:ManagedProductionPlan;productionSceneReceipts?:Record<string,ProductionSceneReceipt>;productionFrameReceipts?:Record<string,ProductionFrameReceipt>;productionPrepaidSceneIds?:string[];productionPrepaidAnchor?:boolean;productionAnchor?:Record<string,unknown>;costReservationMicrousd?:number;budgetAcknowledged?:boolean;budgetWarningSuppressed?:boolean;providerJobId?:string;providerModel?:string;providerStatusUrl?:string;providerResponseUrl?:string;providerCancelUrl?:string;reservationId?:string;requestKey?:string;workflowId?:string;workflowStageId?:string;workflowSources?:ProductionWorkflowSource[];artifactPlan?:Record<string,unknown>;plannerModel?:string;plannerResponseId?:string;plannerLatencyMs?:number;plannerUsage?:Record<string,unknown>;plannerInput?:Record<string,unknown>;renderedItems?:Array<Record<string,unknown>>;videoInputReceipt?:Record<string,unknown>;audioInputReceipt?:Record<string,unknown>};
    if (body.action === "render_document") {
      if(body.sceneMedium!==undefined&&!isSceneMedium(body.sceneMedium)){
        return Response.json({error:"scene_medium_unsupported",supported:SCENE_MEDIA},{status:400});
      }
      if(body.artifactKind!=="scene"&&(body.sceneMedium!==undefined||body.sceneConfiguration!==undefined)){
        return Response.json({error:"scene_configuration_scene_only"},{status:400});
      }
      if(body.artifactKind==="scene"){
        // Client configuration is descriptive only: rebuild every trusted field from the requested medium.
        body.sceneConfiguration=createSceneConfiguration(body.sceneMedium??"visual");
        body.sceneMedium=body.sceneConfiguration.medium;
      }
    }
    const directEvents=Array.isArray(body.events)?body.events:body.event?[body.event]:[];
    const reservedProvenance=(value:unknown)=>Boolean(value&&typeof value==="object"&&Object.keys(value as Record<string,unknown>)
      .some((key)=>key.startsWith("organization_context_package_")||key==="organization_context_source_block_id"));
    if(directEvents.some((event)=>event.type==="BlockCreated"&&reservedProvenance(event.payload?.properties)
      ||["BlockPropertyEdited","ChipEdited"].includes(String(event.type??""))
        &&reservedProvenance({[String(event.type==="BlockPropertyEdited"?event.payload?.property_path:event.payload?.property)]:true})))
      return Response.json({error:"organization_context_provenance_reserved"},{status:403});
    for(const event of directEvents){
      const type=String(event.type??"");
      if(/^(?:Block|Chip)/.test(type)||type==="ExtractionRequested"){
        const candidates=[event.payload?.block_id,event.payload?.from_block_id,event.payload?.to_block_id].filter(Boolean).map(String);
        if(type==="BlockRelationRemoved"){
          const relation=await env.DB.prepare(`SELECT COALESCE(private_body.private_json,source.payload) AS payload
            FROM project_resource_scopes scoped JOIN organization_projects project
              ON project.project_access_id=scoped.project_access_id AND project.organization_id=scoped.organization_id
            JOIN events source ON source.event_id=scoped.source_event_id
            LEFT JOIN event_private_payloads private_body ON private_body.private_event_id=source.event_id
              AND private_body.owner_id=? AND private_body.redacted_at IS NULL
            WHERE project.owner_user_id=? AND project.status='active' AND scoped.resource_kind='relation' AND scoped.resource_id=? LIMIT 1`)
            .bind(storageOwnerId,storageOwnerId,String(event.payload?.relation_id??"")).first<{payload:string}>();
          if(relation)try{const parsed=JSON.parse(relation.payload) as Record<string,unknown>;for(const id of [parsed.from_block_id,parsed.to_block_id])if(id)candidates.push(String(id));}catch{return Response.json({error:"organization_context_package_decision_immutable"},{status:403});}
        }
        if(candidates.length){
          const governed=await env.DB.prepare(`SELECT 1 AS protected FROM project_context_package_members member
            JOIN project_context_package_bindings binding ON binding.binding_id=member.binding_id
              AND binding.organization_id=member.organization_id AND binding.status='active'
            JOIN organization_projects project ON project.project_access_id=binding.project_access_id
              AND project.organization_id=binding.organization_id AND project.owner_user_id=? AND project.status='active'
            WHERE member.target_block_id IN(${candidates.map(()=>"?").join(",")}) LIMIT 1`)
            .bind(storageOwnerId,...candidates).first();
          if(governed)return Response.json({error:"organization_context_package_decision_immutable",message:"Governed organization decisions cannot be altered from a personal owner session."},{status:403});
        }
      }
      if(["DocumentArtifactExported","ObjectExported","OutputRenamed"].includes(type)){
        const target=String(event.payload?.output_id??event.payload?.artifact_id??event.payload?.object_id??event.payload?.document_id??"");
        const governed=await env.DB.prepare(`SELECT 1 AS protected FROM organization_projects project
          JOIN project_resource_scopes scoped ON scoped.project_access_id=project.project_access_id
            AND scoped.organization_id=project.organization_id AND scoped.resource_kind IN('artifact','output','document')
          WHERE project.owner_user_id=? AND project.status='active' AND(scoped.resource_id=? OR project.project_id=?) LIMIT 1`)
          .bind(storageOwnerId,target,target).first();
        if(governed)return Response.json({error:"organization_project_context_required",message:type==="OutputRenamed"?"Rename organization work from its authorized project.":"Release organization work from its authorized project so its exact independent approval can be verified."},{status:403});
      }
    }
    if(["extract_reference","calculate_focal_point"].includes(String(body.action??""))){
      const target=String(body.blockId??body.targetId??"");
      if(target){
        const governed=await env.DB.prepare(`SELECT 1 AS protected FROM project_context_package_members member
          JOIN project_context_package_bindings binding ON binding.binding_id=member.binding_id
            AND binding.organization_id=member.organization_id AND binding.status='active'
          JOIN organization_projects project ON project.project_access_id=binding.project_access_id
            AND project.organization_id=binding.organization_id AND project.owner_user_id=? AND project.status='active'
          WHERE member.target_block_id=? LIMIT 1`).bind(storageOwnerId,target).first();
        if(governed)return Response.json({error:"organization_context_package_decision_immutable"},{status:403});
      }
    }
    const presentationRequest=body as typeof body&{presentationStyle?:SlideStylePresetId;presentationFidelity?:"faithful"|"creative";requestedSlideCount?:number;authoredSlideCount?:number};
    if(!execution&&(body.action==="preview"||body.action==="generate"||body.action==="render_document"&&body.artifactKind!=="slides")&&presentationServerOwnedCheckpointField(body as Record<string,unknown>))return Response.json({error:"media_recovery_state_server_owned",message:"Provider recovery state is restored only from an owner-scoped server checkpoint."},{status:400});
    if(body.action==="render_document"&&body.artifactKind==="slides"){
      if(!execution&&presentationServerOwnedCheckpointField(body as Record<string,unknown>))return Response.json({error:"presentation_recovery_state_server_owned",message:"Presentation recovery, provider receipts, and budget reservations can only come from an existing server-owned job checkpoint."},{status:400});
      const maximumSlideCount=body.productionMode==="managed"?MAX_MANAGED_PRESENTATION_SLIDES:12;
      for(const requestedCount of [body.itemCount,presentationRequest.requestedSlideCount]){
        if(requestedCount!==undefined&&(!Number.isSafeInteger(requestedCount)||requestedCount<1||requestedCount>maximumSlideCount)){
          return Response.json({error:"presentation_slide_count_invalid",supported:{minimum:1,maximum:maximumSlideCount}},{status:400});
        }
      }
      if(body.itemCount!==undefined&&presentationRequest.requestedSlideCount!==undefined&&body.itemCount!==presentationRequest.requestedSlideCount){
        return Response.json({error:"presentation_slide_count_conflict"},{status:409});
      }
      if(presentationRequest.presentationStyle!==undefined&&!isSlideStylePresetId(presentationRequest.presentationStyle)){
        return Response.json({error:"presentation_style_unsupported"},{status:400});
      }
      if(presentationRequest.presentationFidelity!==undefined&&presentationRequest.presentationFidelity!=="faithful"&&presentationRequest.presentationFidelity!=="creative"){
        return Response.json({error:"presentation_fidelity_unsupported"},{status:400});
      }
    }
    const paidOperation=["preview","generate","chat","structure_adaptive","render_document"].includes(body.action??"");
    const suppliedDocumentId=String(body.documentId??"").trim();
    const snapshotDocumentId=String(body.snapshot?.document&&typeof body.snapshot.document==="object"?(body.snapshot.document as Record<string,unknown>).id??"":"").trim();
    if(paidOperation&&suppliedDocumentId&&snapshotDocumentId&&suppliedDocumentId!==snapshotDocumentId)return Response.json({error:"document_scope_mismatch"},{status:409});
    let paidSourceEvents:CreativeEvent[]|undefined;
    let authoritativeSnapshot:Record<string,unknown>|undefined;
    let projectId="";
    let documentId=suppliedDocumentId||snapshotDocumentId;
    if(executionScope&&body.action==="extract_reference"){
      paidSourceEvents=await readProjectSourceEvents(env,executionScope);
      const projection=foldEvents(paidSourceEvents,Number.POSITIVE_INFINITY,suppliedDocumentId,executionScope.projectId);
      const blockId=String(body.blockId??""),referenceId=String(body.referenceId??"");
      const scopedProjectId=executionScope.projectId;
      const document=projection.documents.find((candidate)=>candidate.id===suppliedDocumentId&&candidate.projectId===scopedProjectId);
      const block=document&&projection.libraryBlocks.find((candidate)=>candidate.id===blockId&&candidate.documentId===document.id&&candidate.type==="reference"&&String(candidate.properties.reference_id??"")===referenceId);
      const resources=block?await env.DB.prepare("SELECT COUNT(*) AS count FROM project_resource_scopes WHERE project_access_id=? AND organization_id=? AND owner_user_id=? AND ((resource_kind='document' AND resource_id=?) OR (resource_kind='block' AND resource_id=?) OR (resource_kind='reference' AND resource_id=?))")
        .bind(executionScope.projectAccessId,executionScope.organizationId,executionScope.ownerUserId,suppliedDocumentId,blockId,referenceId).first<{count:number}>():null;
      if(Number(resources?.count??0)!==3)return Response.json({error:"project_reference_not_authorized"},{status:403});
      documentId=suppliedDocumentId;projectId=executionScope.projectId;body.documentId=documentId;
    }
    if(paidOperation){
      paidSourceEvents=executionScope?await readProjectSourceEvents(env,executionScope):await readWorkspaceEvents(env,streamId);
      const projection=foldEvents(paidSourceEvents,Number.POSITIVE_INFINITY,documentId,executionScope?.projectId??"");
      const document=projection.documents.find((candidate)=>candidate.id===(documentId||projection.documentId));
      if(!document)return Response.json({error:"document_not_found"},{status:404});
      if(executionScope&&document.projectId!==executionScope.projectId)return Response.json({error:"document_not_found"},{status:404});
      if(executionScope&&!await governedPackageSourceRightsCurrent(env,executionScope.organizationId,projection.blocks))
        return Response.json({error:"context_source_rights_expired",message:"The original rights for an adopted organizational source are no longer valid."},{status:409});
      documentId=document.id;projectId=document.projectId;body.documentId=documentId;
      if(body.action==="preview"||body.action==="generate"||body.action==="render_document"){
        try{
          const characterScope=body as typeof body&{contextRootBlockId?:unknown;characterOutputKind?:unknown};
          const trusted=authoritativeCreativeContext(paidSourceEvents,{documentId,projectId,canvasId:body.canvasId,contextSetId:body.contextSetId,...(typeof characterScope.contextRootBlockId==="string"?{contextRootBlockId:characterScope.contextRootBlockId}:{}),...(characterScope.characterOutputKind==="headshot"||characterScope.characterOutputKind==="character_sheet"?{characterOutputKind:characterScope.characterOutputKind}:{}),snapshot:body.snapshot,sourceBlockVersions:body.sourceBlockVersions});
          authoritativeSnapshot=trusted.snapshot;body.snapshot=trusted.snapshot;body.sourceBlockVersions=trusted.sourceBlockVersions;body.documentRevision=trusted.documentRevision;
          if((body.action==="render_document"||body.action==="generate")&&(body.workflowId!==undefined||body.workflowStageId!==undefined||body.workflowSources!==undefined)){
            let workflowScope=executionScope;
            if(!workflowScope&&!auth.user.fictional&&billingOwnerId===ownerId){const scopes=await ownerDocumentBudgetScopes(env,ownerId,documentId,projectId);if(scopes.length>1)return Response.json({error:"ambiguous_project_budget_scope"},{status:409});if(scopes[0])workflowScope={organizationId:scopes[0].organizationId,projectAccessId:scopes[0].projectAccessId,projectId,ownerUserId:ownerId,actorUserId:ownerId};}
            const resolved=await resolveProductionWorkflowContext({env,events:paidSourceEvents,documentId,projectId,ownerId:workflowScope?.ownerUserId??ownerId,scope:workflowScope,snapshot:trusted.snapshot,workflowId:body.workflowId,workflowStageId:body.workflowStageId,workflowSources:body.workflowSources,requestedFormat:body.action==="generate"?"image":body.artifactKind});
            body.snapshot=resolved.snapshot;body.workflowSources=resolved.sources;
            if(body.action==="render_document"&&body.artifactKind==="scene"&&resolved.sceneConfiguration){
              body.sceneConfiguration=resolved.sceneConfiguration;
              body.sceneMedium=resolved.sceneConfiguration.medium;
            }
          }
          if(body.action==="render_document"&&body.artifactKind==="slides"){
            const sourceMinimumSlideCount=minimumPresentationSlideCount(body.snapshot??trusted.snapshot);
            const supportedMaximum=body.productionMode==="managed"?MAX_MANAGED_PRESENTATION_SLIDES:12;
            if(sourceMinimumSlideCount>supportedMaximum)return Response.json({error:"presentation_slide_count_invalid",message:`This presentation requires ${sourceMinimumSlideCount} source-authored slides, exceeding the ${supportedMaximum}-slide ${body.productionMode==="managed"?"managed":"manual"} limit.`,supported:{minimum:1,maximum:supportedMaximum},sourceMinimumSlideCount},{status:400});
            const requested=Number(presentationRequest.requestedSlideCount??body.itemCount??0);
            if(requested>0&&requested<sourceMinimumSlideCount)return Response.json({error:"presentation_slide_count_conflict",message:`This presentation requires at least ${sourceMinimumSlideCount} source-authored or independently isolated slides; ${requested} would merge or omit required chapters.`,sourceMinimumSlideCount,authoredSlideCount:inferPresentationSourceOutline(body.snapshot??trusted.snapshot).authoredSlideCount??sourceMinimumSlideCount,requestedSlideCount:requested,plannedSlideCount:sourceMinimumSlideCount},{status:409});
          }
        }catch(error){
          if(error instanceof ContextIntegrityError)return Response.json({error:error.code,message:error.message},{status:error.code==="document_not_found"?404:409});
          if(error instanceof ProductionWorkflowContextError)return Response.json({error:error.code,message:error.message},{status:error.status});
          throw error;
        }
      }
    }
    const budgetScopes=paidOperation&&executionScope?[{organizationId:executionScope.organizationId,projectAccessId:executionScope.projectAccessId,actorUserId:executionScope.actorUserId}]:paidOperation&&!auth.user.fictional&&billingOwnerId===ownerId?await ownerDocumentBudgetScopes(env,ownerId,documentId,projectId):[];
    if(budgetScopes.length>1)return Response.json({error:"ambiguous_project_budget_scope"},{status:409});
    const projectBudgetScope=budgetScopes[0];
    if(!executionScope&&projectBudgetScope){
      executionScope={organizationId:projectBudgetScope.organizationId,projectAccessId:projectBudgetScope.projectAccessId,projectId,ownerUserId:ownerId,actorUserId:ownerId};
      const governedProjection=foldEvents(paidSourceEvents!,Number.POSITIVE_INFINITY,documentId,projectId);
      if(!await governedPackageSourceRightsCurrent(env,executionScope.organizationId,governedProjection.blocks))
        return Response.json({error:"context_source_rights_expired",message:"The original rights for an adopted organizational source are no longer valid."},{status:409});
    }
    const pilotAllowance=paidOperation?await pilotExecutionAllowance(env,billingOwnerId,projectBudgetScope):null;
    if(pilotAllowance&&!pilotAllowance.allowed)return Response.json({error:"active_pilot_participation_required"},{status:403});
    if(pilotAllowance?.pilot&&paidSourceEvents){
      const scopedProjection=foldEvents(paidSourceEvents,Number.POSITIVE_INFINITY,documentId,projectId);
      const trustedFacts=Array.isArray(body.snapshot?.facts)?body.snapshot.facts.filter((fact):fact is Record<string,unknown>=>Boolean(fact&&typeof fact==="object"&&!Array.isArray(fact))).map((fact)=>({type:String(fact.type??""),properties:fact.properties&&typeof fact.properties==="object"&&!Array.isArray(fact.properties)?fact.properties as Record<string,unknown>:{}})):null;
      const providerBlocks=body.action==="structure_adaptive"&&body.projectScope?scopedProjection.libraryBlocks:["preview","generate","render_document"].includes(body.action??"")&&trustedFacts?trustedFacts:scopedProjection.blocks;
      if(!await managedPilotSourceClassificationValid(env,executionScope?.ownerUserId??ownerId,pilotAllowance.pilot.cohort_id,providerBlocks,executionScope?.projectAccessId)){
        return Response.json({error:"pilot_non_sensitive_source_confirmation_required",message:"Every existing source in a controlled pilot must be re-uploaded with an explicit non-sensitive, licensed-material confirmation."},{status:428});
      }
    }
    let requestedAudioProfile:AudioRequestProfile|undefined;
    let requestedAudioSelection:ReturnType<typeof selectAudioAdapter>|undefined;
    let requestedAudioVideoReference:AudioVideoReference|undefined;
    if(body.action==="render_document"&&body.artifactKind==="audio"){
      try{
        requestedAudioProfile=normalizeAudioRequestProfile(body.audioProfile,body.snapshot??{});
        const recoveringAudio=Boolean(body.providerJobId&&body.audioInputReceipt);
        const videoGoal=requestedAudioProfile.goal==="video_music"||requestedAudioProfile.goal==="video_sound_effects";
        if(videoGoal&&!recoveringAudio&&(!body.audioVideoArtifactId||requestedAudioProfile.videoReferenceId!==body.audioVideoArtifactId||body.sendAudioVideoToProvider!==true)){
          return Response.json({error:"audio_video_reference_consent_required",message:"Choose an approved video and separately authorize sending its complete contents to the audio provider."},{status:428});
        }
        if(!videoGoal&&(body.audioVideoArtifactId||body.sendAudioVideoToProvider===true))return Response.json({error:"audio_video_reference_goal_mismatch"},{status:400});
        const pinnedModel=recoveringAudio?String(body.audioInputReceipt?.model??body.providerModel??""):"";
        if(recoveringAudio&&(body.providerModel&&body.providerModel!==pinnedModel||body.audioProviderModel&&body.audioProviderModel!==pinnedModel))return Response.json({error:"audio_provider_model_mismatch"},{status:409});
        requestedAudioSelection=selectAudioAdapter(env,{...requestedAudioProfile,...body.audioProfile},{
          ...(pinnedModel?{preferredModel:pinnedModel}:body.audioProviderModel?{preferredModel:body.audioProviderModel}:{}),
          ...(videoGoal?{videoReferenceAvailable:true}:{}),
        });
        requestedAudioProfile=requestedAudioSelection.profile;
        if(body.productionMode==="managed"&&requestedAudioProfile.goal!=="music")return Response.json({error:"audio_managed_goal_unsupported",message:"Structured music production is available only for the original-music goal."},{status:422});
        if(videoGoal&&!recoveringAudio){
          const audioProjection=foldEvents(paidSourceEvents!,Number.POSITIVE_INFINITY,documentId,projectId);
          requestedAudioVideoReference=await approvedAudioVideoReference(env,storageOwnerId,audioProjection,paidSourceEvents! as EventRow[],String(body.audioVideoArtifactId??""),executionScope);
          if(requestedAudioProfile.goal==="video_music"&&requestedAudioProfile.durationSeconds&&requestedAudioProfile.durationSeconds>requestedAudioVideoReference.durationSeconds)
            audioVideoReferenceError("audio_duration_exceeds_video","Synchronized music cannot be longer than the approved video clip.",422);
          requestedAudioProfile={
            ...requestedAudioProfile,
            durationSeconds:requestedAudioVideoReference.durationSeconds,
            videoReferenceId:requestedAudioVideoReference.artifactId,
          };
          requestedAudioSelection=selectAudioAdapter(env,requestedAudioProfile,{preferredModel:requestedAudioSelection.model,videoReferenceAvailable:true});
        }
      }catch(error){
        if(error instanceof AudioAdapterSelectionError)return Response.json({error:error.code,message:error.message},{status:422});
        if(error instanceof ProviderRequestError){const detail=error.detail;return Response.json({error:detail.code,errorDetail:publicFailureDetail(detail)},{status:detail.httpStatus??400});}
        throw error;
      }
    }
    if(body.action==="render_document"&&(body.artifactKind==="storyboard"||body.artifactKind==="video"||body.artifactKind==="audio")&&body.paidMediaConfirmed!==true)return Response.json({error:"paid_media_confirmation_required",message:"Confirm paid media generation before starting this render."},{status:428});
    if(!execution&&["preview","generate","chat","structure_adaptive","render_document"].includes(body.action??"")){
      const artifactKind=String(body.artifactKind??"");let managed:ManagedProductionPlan|null=null;
      if(body.action==="render_document"&&body.productionMode==="managed"&&isDocumentArtifactKind(artifactKind)){
        try{managed=buildManagedProductionPlan(artifactKind,body.snapshot??{},artifactKind==="video"?{}:{requestedItemCount:Number(presentationRequest.requestedSlideCount??body.itemCount??0),...(artifactKind==="slides"&&presentationRequest.requestedSlideCount!==undefined?{requestedSlideCount:presentationRequest.requestedSlideCount}:{}),...(artifactKind==="scene"?{sceneMedium:body.sceneConfiguration?.medium??body.sceneMedium}:{})});}
        catch(error){if(error instanceof RangeError&&"code" in error)return Response.json({error:String(error.code),message:error.message},{status:422});throw error;}
        if(artifactKind==="slides"&&managed.requestedSlideCount!==null&&managed.requestedSlideCount!==managed.predictedSlideCount)return Response.json({error:"presentation_slide_count_conflict",message:`The requested ${managed.requestedSlideCount} slides would omit required authored positions. Explicitly choose ${managed.predictedSlideCount} slides before generation.`,authoredSlideCount:managed.authoredSlideCount,requestedSlideCount:managed.requestedSlideCount,plannedSlideCount:managed.predictedSlideCount},{status:409});
      }
      const estimatedAudioCost=requestedAudioSelection?.estimatedCostMicrousd??AUDIO_ADAPTER_CONTRACT.publishedCostMicrousd;
      const estimated=managed?managed.estimatedTotalCostMicrousd+(artifactKind==="storyboard"?managed.scenes.length*1_000_000:artifactKind==="audio"?estimatedAudioCost:0):body.action==="chat"||body.action==="structure_adaptive"?estimatePlannerOperationMicrousd(env.OPENAI_MODEL??"gpt-5.6-terra",body.action):body.action==="render_document"&&artifactKind==="video"?normalizeVideoDurationSeconds(body.videoSeconds)*VIDEO_ADAPTER_CONTRACT.publishedCostPerSecondMicrousd[VIDEO_ADAPTER_CONTRACT.defaultResolution]+1_000_000:body.action==="render_document"&&artifactKind==="audio"?estimatedAudioCost+1_000_000:body.action==="render_document"&&artifactKind==="storyboard"?Math.max(1,Math.floor(Number(body.itemCount??6)))*1_000_000+1_000_000:1_000_000;
      if(pilotAllowance?.pilot){
        const fixed=await env.DB.prepare(`SELECT scope,used_microusd,reserved_microusd,hard_limit_microusd FROM cost_budget_counters WHERE period=?
          AND ((scope='pilot_org' AND scope_id=?) OR (scope='pilot_user' AND scope_id=?))`)
          .bind(`pilot:${pilotAllowance.pilot.cohort_id}`,pilotAllowance.pilot.cohort_id,billingOwnerId)
          .all<{scope:string;used_microusd:number;reserved_microusd:number;hard_limit_microusd:number}>();
        if(fixed.results.length!==2)return Response.json({error:"active_pilot_participation_required"},{status:403});
        const exceeded=fixed.results.find((counter)=>Number(counter.used_microusd)+Number(counter.reserved_microusd)+estimated>Number(counter.hard_limit_microusd));
        if(exceeded)return Response.json({error:"pilot_budget_hard_cap_reached",scope:exceeded.scope==="pilot_user"?"user":"workspace"},{status:429});
      }
      const account=projectBudgetScope?await readAccountBudgets(env,billingOwnerId,projectBudgetScope.organizationId):null;
      const gate=generationBudgetGate(account?.costBudgets??await readCostBudgets(env,billingOwnerId),{projectedMicrousd:estimated,suppressedUntilCritical:body.budgetWarningSuppressed===true,noticeAcknowledged:body.budgetAcknowledged===true});
      if(gate.level==="blocked")return Response.json({error:"budget_hard_cap_reached",scope:gate.scope,gate},{status:429});
      if(account){
        const sceneCount=managed?.scenes.length??Math.max(1,Math.floor(Number(body.itemCount??6)));
        const estimatedTokens=body.action==="chat"||body.action==="structure_adaptive"?12_000:body.action==="preview"?24_000:body.action==="render_document"?documentRenderTokenReservation(artifactKind,sceneCount,managed?.maximumProviderCallCount):32_000;
        const tokenScope=account.budgets.user.used+account.budgets.user.reserved+estimatedTokens>account.budgets.user.limit?"user":account.budgets.workspace.used+account.budgets.workspace.reserved+estimatedTokens>account.budgets.workspace.limit?"workspace":null;
        if(tokenScope)return Response.json({error:"budget_hard_cap_reached",scope:tokenScope},{status:429});
      }
      if(gate.requiresAcknowledgement&&body.budgetAcknowledged!==true)return Response.json({error:"generation_budget_acknowledgement_required",gate},{status:428});
    }
    if(body.action==="render_document"&&body.artifactKind==="slides"&&!buildPresentationSourceContract(body.snapshot??{}).sources.some((source)=>source.sourceKind==="block"))return Response.json({error:"presentation_authorized_source_required",message:"Add at least one active, authorized source decision before generating a presentation. Exclusions and disabled decisions cannot become slide content."},{status:422});
    const readEvents=["rebuild_index","close_session","open_session","compose_brief","run_scout","refresh_taste_model"].includes(body.action??"")?readIntelligenceEvents:paidSourceEvents?async()=>paidSourceEvents!:readWorkspaceEvents;
    const current=await streamHead(env,streamId),client=body.clientId||"web:lit",corr=body.correlationId||uuidV7();
    const refuseProviderClaim=async(input:{operation:string;tokenReservationId:string;costReservationId:string;reservedTokens:number;reservedMicrousd:number;causationId?:string})=>{
      await Promise.all([releaseBudget(env,billingOwnerId,input.tokenReservationId,{reason:`${input.operation}_authorization_withdrawn`}),releaseCostBudget(env,billingOwnerId,input.costReservationId)]);
      const head=await streamHead(env,streamId);
      const released=makeEvent(streamId,head+1,"worker:policy",client,corr,"BudgetReleased",{operation:input.operation,reservation_id:input.tokenReservationId,cost_reservation_id:input.costReservationId,reserved_tokens:input.reservedTokens,released_microusd:input.reservedMicrousd,reason:"project_access_revoked"},input.causationId?{causationId:input.causationId}:{});
      await insertEvent(env,released).run();
      return Response.json({error:"active_pilot_participation_required",appended:[released],head:released.sequence},{status:403});
    };
    const requested=body.action==="batch"||body.action==="canvas_sync"||hot?body.events??(body.event?[body.event]:[]):body.event?[body.event]:[];
    const pendingVerifiedSourceBlocks=new Set(requested.filter((item)=>item.type==="BlockCreated"&&item.payload?.properties&&typeof item.payload.properties==="object"&&Boolean((item.payload.properties as Record<string,unknown>).source_evidence_hash)).map((item)=>String(item.payload?.block_id??"")));
    for(const item of requested){
      if(item.type==="BlockCreated"){
        const properties=item.payload?.properties&&typeof item.payload.properties==="object"?item.payload.properties as Record<string,unknown>:{};
        const declaredAudio=[properties.source_mime_type,properties.media_type].some((mime)=>String(mime??"").toLowerCase().startsWith("audio/"));
        if(String(item.payload?.type??"")!=="audio"&&(declaredAudio||properties.media_url&&await readOwnedAudioReference(env,storageOwnerId,properties.media_url,{metadataOnly:true})))return Response.json({error:"audio_media_requires_audio_block"},{status:403});
      }
      if(item.type==="BlockCreated"&&String(item.payload?.type??"")==="reference"){
        const properties=item.payload?.properties&&typeof item.payload.properties==="object"?item.payload.properties as Record<string,unknown>:{};
        if(properties.media_url&&!await verifySourceDocumentEvidence(env,storageOwnerId,properties.media_url,properties))return Response.json({error:"source_evidence_not_verified"},{status:403});
        continue;
      }
      const property=item.type==="BlockPropertyEdited"?String(item.payload?.property_path??""):item.type==="ChipEdited"?String(item.payload?.property??""):"";
      if(property==="type"&&String(item.payload?.new_value??"")==="reference")return Response.json({error:"reference_type_transition_forbidden"},{status:403});
      if(property==="type"){
        const blockId=String(item.payload?.block_id??"");
        const previous=await env.DB.prepare(`SELECT COALESCE(secret.private_json,event.payload) AS payload FROM events event LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id AND secret.owner_id=? AND secret.redacted_at IS NULL WHERE event.stream_id=? AND event.type='BlockCreated' AND json_extract(event.payload,'$.block_id')=? ORDER BY event.sequence DESC LIMIT 1`).bind(storageOwnerId,streamId,blockId).first<{payload:string}>();
        if(previous)try{const original=JSON.parse(previous.payload) as {type?:unknown;properties?:Record<string,unknown>};const properties=original.properties??{};if((original.type==="audio"||[properties.source_mime_type,properties.media_type].some((mime)=>String(mime??"").toLowerCase().startsWith("audio/")))&&properties.media_url&&String(item.payload?.new_value??"")!=="audio")return Response.json({error:"audio_media_type_transition_forbidden"},{status:403});}catch{return Response.json({error:"audio_media_type_transition_forbidden"},{status:403});}
      }
      if(!["text","source_citations","source_segment_count","source_excerpt_truncated","source_kind","source_content_hash","source_evidence_hash","source_mime_type","media_url","extraction_status"].includes(property))continue;
      const blockId=String(item.payload?.block_id??"");
      if(pendingVerifiedSourceBlocks.has(blockId))return Response.json({error:"verified_source_evidence_immutable"},{status:403});
      const creation=await env.DB.prepare(`SELECT COALESCE(secret.private_json,event.payload) AS payload FROM events event
        LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id AND secret.owner_id=? AND secret.redacted_at IS NULL
        WHERE event.stream_id=? AND event.type='BlockCreated' AND json_extract(event.payload,'$.block_id')=? ORDER BY event.sequence DESC LIMIT 1`)
        .bind(storageOwnerId,streamId,blockId).first<{payload:string}>();
      if(creation)try{const authored=JSON.parse(creation.payload) as {properties?:{source_evidence_hash?:unknown}};if(authored.properties?.source_evidence_hash)return Response.json({error:"verified_source_evidence_immutable"},{status:403});}catch{return Response.json({error:"source_evidence_not_verified"},{status:403});}
    }
    const canvasAttempt=Boolean(body.canvasId)||String(body.sourceSurface??"").startsWith("canvas")||requested.some((item)=>CANVAS_USER_EVENT_TYPES.includes(String(item.type??"") as typeof CANVAS_USER_EVENT_TYPES[number]));
    if(canvasAttempt){const governance=await readCanvasGovernance(env,auth.user.role);if(!governance.access)return Response.json({error:"canvas_governance_gate_incomplete",governance},{status:403});}
    if(hot&&!requested.every(e=>HOT_EVENTS.has(e.type??"")))return Response.json({error:"hot_path_accepts_commutative_engagement_only"},{status:400});
    const commutative=requested.length>0&&requested.every(e=>COMMUTATIVE.has(e.type??""));
    if(typeof body.expectedSequence==="number"&&body.expectedSequence!==current&&body.action!=="propose"&&body.action!=="canvas_sync"&&!commutative)return Response.json({error:"stale_sequence",expected:body.expectedSequence,head:current},{status:409});
    if(body.action==="propose"){
      const stored=await storePrivateContent(env,ownerId,"prompt",body.prompt??"",executionScope);
      const proposal=makeEvent(streamId,current+1,"model:forma-chat",client,corr,"MutationProposed",{content_ref:stored.contentId,content_expires_at:stored.expiresAt,proposed_events:body.events??[],exemplar_refs:body.exemplarRefs??[],expected_sequence:current});await insertEvent(env,proposal).run();return Response.json({appended:[proposal],rejected:[],head:proposal.sequence});
    }
    if(body.action==="chat"){
      if(!env.OPENAI_API_KEY)return Response.json({error:"provider_not_configured"},{status:503});const message=body.message?.trim();if(!message||message.length>4000)return Response.json({error:"chat_message_required"},{status:400});
      const livePreview=body.livePreview!==false;const sourceEvents=await readEvents(env,streamId);const projection=foldEvents(sourceEvents,Number.POSITIVE_INFINITY,body.documentId);const privateContent=await loadPrivateContent(env,ownerId,"chat",executionScope);const reserved=12_000;const reservation=await reserveBudget(env,billingOwnerId,reserved,{streamId,correlationId:corr,operation:"creative-chat",projectScope:projectBudgetScope});
      if(!reservation.ok){const denied=makeEvent(streamId,current+1,"worker:policy",client,corr,"BudgetExceeded",{reason:"hard_cap_reached",scope:reservation.scope,reserved_tokens:0,operation:"creative-chat"});await insertEvent(env,denied).run();const detail=applicationFailureDetail("budget_hard_cap_reached",reservation.scope,429);return Response.json({error:detail.code,errorDetail:publicFailureDetail(detail),scope:reservation.scope},{status:429});}
      const estimatedChatCost=priceTextUsageBreakdownMicrousd(env.OPENAI_MODEL??"gpt-5.6-terra",{inputTokens:10_400,outputTokens:1_600,totalTokens:reserved}).totalMicrousd;
      const chatCostReservation=await reserveCostBudget(env,billingOwnerId,estimatedChatCost,{maximumMicrousd:estimatedChatCost,allowUserOverage:false,streamId,correlationId:corr,operation:"creative-chat",period:reservation.period,projectScope:projectBudgetScope});
      if(!chatCostReservation.ok){await releaseBudget(env,billingOwnerId,reservation.reservationId,{reason:"creative_chat_cost_cap_reached"});const detail=applicationFailureDetail("budget_hard_cap_reached",chatCostReservation.scope,429);return Response.json({error:detail.code,errorDetail:publicFailureDetail(detail),scope:chatCostReservation.scope},{status:429});}
      let userStored:Awaited<ReturnType<typeof storePrivateContent>>|null=null;let budgeted:EventRow|null=null;let userTurn:EventRow|null=null;const turnId=uuidV7();
      try{
        userStored=await storePrivateContent(env,ownerId,"chat-user",message,executionScope);budgeted=makeEvent(streamId,current+1,"worker:policy",client,corr,"BudgetReserved",{operation:"creative-chat",reservation_id:reservation.reservationId,cost_reservation_id:chatCostReservation.reservationId,reserved_tokens:reserved,reserved_microusd:chatCostReservation.reservedMicrousd,period:reservation.period,live_preview:livePreview});userTurn=makeEvent(streamId,current+2,userActor,client,corr,"ChatMessageSent",{turn_id:turnId,document_id:projection.documentId,content_ref:userStored.contentId,content_expires_at:userStored.expiresAt,source_surface:"chat",live_preview:livePreview},{causationId:budgeted.eventId});await env.DB.batch([budgeted,userTurn].map((event)=>insertEvent(env,event)));
        const conversation=new Map<string,{role:"user"|"assistant";text:string}>();
        for(const event of sourceEvents){
          if(String(event.payload.document_id??"")!==projection.documentId)continue;
          const user=event.type==="ChatMessageSent";
          if(!user&&!(event.type==="AssistantReasoned"&&event.payload.operation==="creative-chat"))continue;
          const text=String(privateContent[String(event.payload.content_ref??"")]??"");
          if(!text)continue;
          const role=user?"user":"assistant";
          conversation.set(`${String(event.payload.turn_id??event.eventId)}:${role}`,{role,text});
        }
        const history=[...conversation.values()].slice(-12);
        await execution?.progress("planning","Preparing your private creative conversation.");if(!await claimCostBudgetReservation(env,billingOwnerId,chatCostReservation.reservationId))return refuseProviderClaim({operation:"creative-chat",tokenReservationId:reservation.reservationId,costReservationId:chatCostReservation.reservationId,reservedTokens:reserved,reservedMicrousd:chatCostReservation.reservedMicrousd,causationId:userTurn.eventId});const generated=await respondToCreativeChat(env,ownerId,{documentTitle:projection.documentTitle,blocks:projection.blocks.map((block)=>({id:block.id,type:block.type,handle:block.handle,locked:block.locked,properties:block.properties})),relationships:projection.blockRelations.map((relation)=>({from_block_id:relation.fromBlockId,to_block_id:relation.toBlockId,kind:relation.kind,properties:relation.properties})),history,message,locale:typeof (body as {locale?:unknown}).locale==="string"?(body as {locale:string}).locale:"en",signal:execution?.signal});await execution?.beginCommit();const assistantStored=await storePrivateContent(env,ownerId,"chat-assistant",generated.output.reply,executionScope);
        const previewSuppressed=generated.output.preview_worthy&&!livePreview;const previewQueued=livePreview&&generated.output.preview_worthy;let directionStored:null|Awaited<ReturnType<typeof storePrivateContent>>=null;if(previewQueued){const direction={title:projection.documentTitle,rationale:generated.output.reply,scene:generated.output.preview_direction,palette:[],next_moves:[]};directionStored=await storePrivateContent(env,ownerId,"provider-output",JSON.stringify(direction),executionScope);}const next=await streamHead(env,streamId);const referencePixelMutationCount=generated.output.mutations.filter((mutation)=>mutation.reference_pixel_mode!=="unchanged").length;const reasoned=makeEvent(streamId,next+1,"model:forma-chat",client,corr,"AssistantReasoned",{operation:"creative-chat",turn_id:turnId,document_id:projection.documentId,content_ref:assistantStored.contentId,content_expires_at:assistantStored.expiresAt,provider:"openai",provider_response_id:generated.responseId,model_id:generated.model,latency_ms:generated.latencyMs,mutation_count:generated.output.mutations.length,reference_pixel_mutation_count:referencePixelMutationCount,preview_worthy:generated.output.preview_worthy,live_preview_requested:livePreview,preview_queued:previewQueued,preview_direction_ref:directionStored?.contentId??null,preview_suppressed:previewSuppressed},{causationId:userTurn.eventId});
        const mutationResult=creativeChatMutationEvents({mutations:generated.output.mutations,projection,streamId,startSequence:reasoned.sequence,client,corr,causationId:reasoned.eventId,turnId,actor:userActor});const appended:EventRow[]=[reasoned,...mutationResult.events];let sequence=mutationResult.sequence;
        const chatCosts=providerCostReceipt([priceTextUsageBreakdownMicrousd(generated.model,generated.usage)]);await Promise.all([settleBudget(env,billingOwnerId,reservation.reservationId,generated.usage.totalTokens),settleCostBudget(env,billingOwnerId,chatCostReservation.reservationId,chatCosts.cost_microusd)]);const usage=makeEvent(streamId,++sequence,"worker:policy",client,corr,"GenerationUsageRecorded",{operation:"creative-chat",document_id:projection.documentId,reservation_id:reservation.reservationId,cost_reservation_id:chatCostReservation.reservationId,input_tokens:generated.usage.inputTokens,output_tokens:generated.usage.outputTokens,total_tokens:generated.usage.totalTokens,chat_tokens:generated.usage.totalTokens,preview_tokens:0,reserved_tokens:reserved,reserved_microusd:chatCostReservation.reservedMicrousd,model_ids:[generated.model],live_preview_requested:livePreview,preview_generated:false,preview_queued:previewQueued,preview_suppressed:previewSuppressed,...chatCosts},{causationId:reasoned.eventId});appended.push(usage);await env.DB.batch(appended.map((event)=>insertEvent(env,event)));return Response.json({appended:[budgeted,userTurn,...appended],content:{[userStored.contentId]:message,[assistantStored.contentId]:generated.output.reply},rejected:[],head:usage.sequence,previewed:false,previewQueued,previewSuppressed,followupJob:directionStored?{kind:"preview",documentId:projection.documentId,sourceSurface:"chat",payload:{directionRef:directionStored.contentId,directionModel:generated.model,sourceChatTurnId:turnId,locale:body.locale??"en",promptTechnique:normalizePromptTechnique(body.promptTechnique)}}:null});
      }catch(error){if(execution?.signal.aborted||error instanceof Error&&error.message==="document_job_canceled")throw error;const detail=classifyProviderFailure(error);await Promise.all([releaseBudget(env,billingOwnerId,reservation.reservationId,{reason:"creative_chat_failed"}),releaseCostBudget(env,billingOwnerId,chatCostReservation.reservationId)]);if(!budgeted||!userTurn||!userStored)return Response.json({error:detail.code,errorDetail:publicFailureDetail(detail)},{status:detail.httpStatus===429?429:502});const next=await streamHead(env,streamId);const released=makeEvent(streamId,next+1,"worker:policy",client,corr,"BudgetReleased",{operation:"creative-chat",reservation_id:reservation.reservationId,cost_reservation_id:chatCostReservation.reservationId,reserved_tokens:reserved,released_microusd:chatCostReservation.reservedMicrousd,reason:"creative_chat_failed"},{causationId:userTurn.eventId});await insertEvent(env,released).run();return Response.json({error:detail.code,errorDetail:publicFailureDetail(detail),appended:[budgeted,userTurn,released],content:{[userStored.contentId]:message},head:released.sequence},{status:detail.httpStatus===429?429:502});}
    }
    if(body.action==="structure_adaptive"){
      if(!env.OPENAI_API_KEY)return Response.json({error:"provider_not_configured"},{status:503});const prompt=body.prompt?.trim();if(!prompt||prompt.length>2000)return Response.json({error:"adaptive_intent_required"},{status:400});
      const projection=foldEvents(await readEvents(env,streamId),Number.POSITIVE_INFINITY,body.documentId);const reserved=12_000;const reservation=await reserveBudget(env,billingOwnerId,reserved,{streamId,correlationId:corr,operation:"adaptive-structure",projectScope:projectBudgetScope});if(!reservation.ok){const denied=makeEvent(streamId,current+1,"worker:policy",client,corr,"BudgetExceeded",{reason:"hard_cap_reached",scope:reservation.scope,reserved_tokens:0,operation:"adaptive-structure"});await insertEvent(env,denied).run();const detail=applicationFailureDetail("budget_hard_cap_reached",reservation.scope,429);return Response.json({error:detail.code,errorDetail:publicFailureDetail(detail),scope:reservation.scope},{status:429});}
      const estimatedAdaptiveCost=priceTextUsageBreakdownMicrousd(env.OPENAI_MODEL??"gpt-5.6-terra",{inputTokens:10_600,outputTokens:1_400,totalTokens:reserved}).totalMicrousd;
      const adaptiveCostReservation=await reserveCostBudget(env,billingOwnerId,estimatedAdaptiveCost,{maximumMicrousd:estimatedAdaptiveCost,allowUserOverage:false,streamId,correlationId:corr,operation:"adaptive-structure",period:reservation.period,projectScope:projectBudgetScope});
      if(!adaptiveCostReservation.ok){await releaseBudget(env,billingOwnerId,reservation.reservationId,{reason:"adaptive_structure_cost_cap_reached"});const detail=applicationFailureDetail("budget_hard_cap_reached",adaptiveCostReservation.scope,429);return Response.json({error:detail.code,errorDetail:publicFailureDetail(detail),scope:adaptiveCostReservation.scope},{status:429});}
      let budgeted:EventRow|null=null;
      try{const promptStored=await storePrivateContent(env,ownerId,"adaptive-intent",prompt,executionScope);budgeted=makeEvent(streamId,current+1,"worker:policy",client,corr,"BudgetReserved",{operation:"adaptive-structure",reservation_id:reservation.reservationId,cost_reservation_id:adaptiveCostReservation.reservationId,reserved_tokens:reserved,reserved_microusd:adaptiveCostReservation.reservedMicrousd,period:reservation.period});await insertEvent(env,budgeted).run();const adaptiveBlocks=body.projectScope?projection.libraryBlocks:projection.blocks;const adaptiveRelations=body.projectScope?projection.libraryBlockRelations:projection.blockRelations;await execution?.progress("planning","Preparing your private project structure.");if(!await claimCostBudgetReservation(env,billingOwnerId,adaptiveCostReservation.reservationId))return refuseProviderClaim({operation:"adaptive-structure",tokenReservationId:reservation.reservationId,costReservationId:adaptiveCostReservation.reservationId,reservedTokens:reserved,reservedMicrousd:adaptiveCostReservation.reservedMicrousd,causationId:budgeted.eventId});const generated=await structureAdaptiveContext(env,ownerId,{intent:prompt,locale:typeof (body as {locale?:unknown}).locale==="string"?(body as {locale:string}).locale:"en",documentTitle:body.projectScope?`${projection.projectName} project`:projection.documentTitle,blocks:adaptiveBlocks.map((block)=>({id:block.id,document_id:block.documentId,type:block.type,handle:block.handle,properties:block.properties,source_event_refs:block.sourceEvents})),relationships:adaptiveRelations.map((relation)=>({from_block_id:relation.fromBlockId,to_block_id:relation.toBlockId,kind:relation.kind,properties:relation.properties})),signal:execution?.signal});await execution?.beginCommit();const outputStored=await storePrivateContent(env,ownerId,"adaptive-structure",generated.raw,executionScope);const adaptiveCosts=providerCostReceipt([priceTextUsageBreakdownMicrousd(generated.model,generated.usage)]);await Promise.all([settleBudget(env,billingOwnerId,reservation.reservationId,generated.usage.totalTokens),settleCostBudget(env,billingOwnerId,adaptiveCostReservation.reservationId,adaptiveCosts.cost_microusd)]);const next=await streamHead(env,streamId);const reasoned=makeEvent(streamId,next+1,"model:forma-chat",client,corr,"AssistantReasoned",{operation:"adaptive-structure",scope:body.projectScope?"project":"document",project_id:projection.projectId,intent_ref:promptStored.contentId,intent_expires_at:promptStored.expiresAt,content_ref:outputStored.contentId,content_expires_at:outputStored.expiresAt,provider:"openai",provider_response_id:generated.responseId,model_id:generated.model,latency_ms:generated.latencyMs,active_decision_type:generated.output.active_decision.type,suggested_block_types:generated.output.suggested_blocks.map((item)=>item.type)},{causationId:budgeted.eventId});const usage=makeEvent(streamId,next+2,"worker:policy",client,corr,"GenerationUsageRecorded",{operation:"adaptive-structure",document_id:projection.documentId,project_id:projection.projectId,scope:body.projectScope?"project":"document",reservation_id:reservation.reservationId,cost_reservation_id:adaptiveCostReservation.reservationId,input_tokens:generated.usage.inputTokens,output_tokens:generated.usage.outputTokens,total_tokens:generated.usage.totalTokens,reserved_tokens:reserved,reserved_microusd:adaptiveCostReservation.reservedMicrousd,model_id:generated.model,...adaptiveCosts},{causationId:reasoned.eventId});await env.DB.batch([reasoned,usage].map((event)=>insertEvent(env,event)));return Response.json({appended:[budgeted,reasoned,usage],content:{[promptStored.contentId]:prompt,[outputStored.contentId]:generated.raw},structure:generated.output,rejected:[],head:usage.sequence});}
      catch(error){if(execution?.signal.aborted||error instanceof Error&&error.message==="document_job_canceled")throw error;const detail=classifyProviderFailure(error);await Promise.all([releaseBudget(env,billingOwnerId,reservation.reservationId,{reason:"adaptive_structure_failed"}),releaseCostBudget(env,billingOwnerId,adaptiveCostReservation.reservationId)]);if(!budgeted)return Response.json({error:detail.code,errorDetail:publicFailureDetail(detail)},{status:detail.httpStatus===429?429:502});const next=await streamHead(env,streamId);const released=makeEvent(streamId,next+1,"worker:policy",client,corr,"BudgetReleased",{operation:"adaptive-structure",reservation_id:reservation.reservationId,cost_reservation_id:adaptiveCostReservation.reservationId,reserved_tokens:reserved,released_microusd:adaptiveCostReservation.reservedMicrousd,reason:"adaptive_structure_failed"},{causationId:budgeted.eventId});await insertEvent(env,released).run();return Response.json({error:detail.code,errorDetail:publicFailureDetail(detail),appended:[budgeted,released],head:released.sequence},{status:detail.httpStatus===429?429:502});}
    }
    if(body.action==="render_document"){
      if(!isDocumentArtifactKind(body.artifactKind))return Response.json({error:"document_artifact_kind_required"},{status:400});
      const artifactKind=body.artifactKind;
      const sceneConfiguration=artifactKind==="scene"
        ?body.sceneConfiguration??createSceneConfiguration(body.sceneMedium??"visual")
        :undefined;
      if((artifactKind==="storyboard"||artifactKind==="video"||artifactKind==="audio")&&body.paidMediaConfirmed!==true)return Response.json({error:"paid_media_confirmation_required",message:"Confirm paid media generation before starting this render."},{status:428});
      if(!env.OPENAI_API_KEY)return Response.json({error:"provider_not_configured"},{status:503});
      const productionMode:ProductionMode=body.productionMode==="managed"?"managed":"manual";
      if((artifactKind==="video"||artifactKind==="audio")&&!env.FAL_KEY)return Response.json({error:artifactKind==="audio"?"audio_provider_not_configured":"video_provider_not_configured"},{status:503});
      if(artifactKind==="video"&&env.FORMA_VIDEO_PROVIDER&&env.FORMA_VIDEO_PROVIDER!=="fal")return Response.json({error:"video_provider_unsupported"},{status:503});
      if(artifactKind==="audio"&&env.FORMA_AUDIO_PROVIDER&&env.FORMA_AUDIO_PROVIDER!=="fal")return Response.json({error:"audio_provider_unsupported"},{status:503});
      let itemCount=Math.max(1,Math.min(12,Math.floor(Number(body.itemCount??(artifactKind==="slides"?7:artifactKind==="storyboard"?6:1)))));
      if(artifactKind==="video"&&body.videoSeconds!==undefined&&!isVideoDurationSeconds(body.videoSeconds))return Response.json({error:"video_duration_unsupported",supported:VIDEO_ADAPTER_CONTRACT.supportedDurations},{status:400});
      if(artifactKind==="video"&&body.videoSize!==undefined&&!VIDEO_ADAPTER_CONTRACT.supportedFrameSizes.includes(body.videoSize))return Response.json({error:"video_frame_unsupported",supported:VIDEO_ADAPTER_CONTRACT.supportedFrameSizes},{status:400});
      if(artifactKind==="video"&&body.videoAudioMode!==undefined&&!isVideoAudioMode(body.videoAudioMode))return Response.json({error:"video_audio_mode_unsupported",supported:VIDEO_ADAPTER_CONTRACT.supportedAudioModes},{status:400});
      if(body.sendSoundtrackToVideoProvider===true&&artifactKind!=="video")return Response.json({error:"audio_provider_transfer_video_only"},{status:400});
      if(body.sendSoundtrackToVideoProvider===true&&productionMode==="managed")return Response.json({error:"managed_video_soundtrack_transfer_unsupported",message:"Managed multi-scene videos support separate soundtrack companions; direct provider soundtrack transfer is available for single-render videos."},{status:400});
      if(body.audioImageBlockId&&artifactKind!=="audio")return Response.json({error:"audio_image_reference_audio_only"},{status:400});
      const requestedVideoSeconds=normalizeVideoDurationSeconds(body.videoSeconds);
      const retainedVideoParameters=body.providerJobId&&body.videoInputReceipt?.parameters&&typeof body.videoInputReceipt.parameters==="object"?body.videoInputReceipt.parameters as Record<string,unknown>:null;
      const retainedVideoAudioMode=retainedVideoParameters&&isVideoAudioMode(retainedVideoParameters.native_audio_mode)
        ?retainedVideoParameters.native_audio_mode
        :retainedVideoParameters&&isVideoAudioMode(retainedVideoParameters.audio_mode)
          ?retainedVideoParameters.audio_mode
          :retainedVideoParameters?.soundtrack_mode==="rights-cleared-provider-reference"?"silent"
            :typeof retainedVideoParameters?.generate_audio==="boolean"?retainedVideoParameters.generate_audio?"original_ambient":"silent":undefined;
      const requestedVideoAudioMode:VideoAudioMode=retainedVideoAudioMode??body.videoAudioMode??VIDEO_ADAPTER_CONTRACT.defaultAudioMode;
      const audience=String(body.audience??"").trim(),tone=String(body.tone??"").trim();
      if(audience.length>120||tone.length>120)return Response.json({error:"document_render_guidance_too_long"},{status:400});
      const sourceEvents=await readEvents(env,streamId);const projection=foldEvents(sourceEvents,Number.POSITIVE_INFINITY,body.documentId);const suppliedSnapshot:Record<string,unknown>=body.snapshot&&Object.keys(body.snapshot).length?body.snapshot:snapshotForProjection(projection);const authoredStandingConstraints=standingConstraints(sourceEvents).map((item)=>({preference_id:item.preferenceId,axis:item.axis,value:item.value,polarity:item.polarity,authority:"authored",source_event_refs:item.evidenceRefs,source_claim_ref:item.sourceClaimRef??null}));const suppliedStandingConstraints=Array.isArray(suppliedSnapshot.standing_constraints)?suppliedSnapshot.standing_constraints.filter((value):value is Record<string,unknown>=>Boolean(value)&&typeof value==="object"&&!Array.isArray(value)):[];const mergedStandingConstraints=[...new Map([...suppliedStandingConstraints,...authoredStandingConstraints].map((constraint)=>[String(constraint.preference_id??`${constraint.polarity}:${constraint.axis}:${constraint.value}`),constraint])).values()];const compiledSnapshot={...suppliedSnapshot,document:{id:projection.documentId,title:projection.documentTitle},...(mergedStandingConstraints.length?{standing_constraints:mergedStandingConstraints}:{})};
      let preparedVideoReferences:VideoReference[]=[];
      let soundtrackAssets:ApprovedAudioAsset[]=[];
      let preparedAudioReferences:VideoAudioReference[]=[];
      let audioImageReference:AudioImageReference|undefined;
      let audioVideoReference:AudioVideoReference|undefined;
      const soundtrackBlockIds=[...new Set(Array.isArray(body.soundtrackBlockIds)?body.soundtrackBlockIds.map(String).filter(Boolean):[])];
      if(soundtrackBlockIds.length&&!["slides","storyboard","video"].includes(artifactKind))return Response.json({error:"audio_output_pairing_unsupported"},{status:400});
      if(body.sendSoundtrackToVideoProvider===true&&!soundtrackBlockIds.length)return Response.json({error:"audio_provider_transfer_selection_required"},{status:400});
      if(artifactKind==="audio"||soundtrackBlockIds.length){
        const conflict=audioAuthoringConflict(compiledSnapshot,artifactKind==="audio"?requestedAudioProfile:undefined,artifactKind==="audio"?{tone,audience}:undefined);
        if(conflict)return Response.json({error:conflict.code,message:conflict.message},{status:422});
      }
      try{
        ({assets:soundtrackAssets,providerReferences:preparedAudioReferences}=await approvedSoundtrackAssets(env,storageOwnerId,compiledSnapshot,sourceEvents,soundtrackBlockIds,body.sendSoundtrackToVideoProvider===true,executionScope));
        if(artifactKind==="audio"&&requestedAudioSelection?.contract.supportsVideoReference&&!body.providerJobId)audioVideoReference=requestedAudioVideoReference;
        if(artifactKind==="audio"&&body.audioImageBlockId&&!requestedAudioSelection?.contract.maximumImageReferences)
          audioVideoReferenceError("audio_image_reference_unsupported","Only the original-music specialist supports an approved image reference.");
        if(artifactKind==="audio"&&requestedAudioProfile&&requestedAudioSelection){
          body.audioProfile=requestedAudioProfile;
          body.audioEstimatedCostMicrousd=requestedAudioSelection.estimatedCostMicrousd;
          body.audioProviderModel=requestedAudioSelection.model;
        }
        if(artifactKind==="audio"&&body.audioImageBlockId&&!body.providerJobId){
          const snapshotFacts=(compiledSnapshot as Record<string,unknown>).facts;
          const filteredFacts=(Array.isArray(snapshotFacts)?snapshotFacts:[]).filter((fact:unknown)=>fact&&typeof fact==="object"&&String((fact as Record<string,unknown>).block_id??"")===body.audioImageBlockId);
          const approvedImages=await videoPixelReferences(env,storageOwnerId,{...compiledSnapshot,facts:filteredFacts},sourceEvents,executionScope);
          if(approvedImages.length!==1)throw new ProviderRequestError({code:"audio_image_reference_not_authorized",category:"provider",scope:"request",action:"edit_request",message:"Choose one active image reference with confirmed rights and explicit provider pixel authorization.",retryable:false,retryAfterMs:null,requestId:null,httpStatus:400});
          const image=approvedImages[0]!;
          const rights=sourceEvents.filter((event)=>(event.type==="RightsAsserted"||event.type==="ReferenceIngested")&&String(event.payload.reference_id??"")===image.referenceId);
          if(!rights.some((event)=>audioRightsAllowed(event.payload.rights_class)))throw new ProviderRequestError({code:"audio_image_reference_rights_required",category:"provider",scope:"request",action:"edit_request",message:"An image sent to the music provider requires confirmed owned, licensed, or account-generated source rights.",retryable:false,retryAfterMs:null,requestId:null,httpStatus:403,contributingBlockIds:[image.blockId],contributingReferenceIds:[image.referenceId]});
          const fact=filteredFacts[0] as Record<string,unknown>,properties=fact?.properties&&typeof fact.properties==="object"?fact.properties as Record<string,unknown>:{};
          const ingested=rights.find((event)=>event.type==="ReferenceIngested"&&String(event.payload.source_ref??event.payload.media_url??"")===String(properties.media_url??""));
          const claimedBlockHash=String(properties.source_content_hash??""),claimedIngestedHash=String(ingested?.payload.content_hash??"");
          if(claimedBlockHash||claimedIngestedHash){
            const actualHash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new Uint8Array(image.bytes).buffer)),(value)=>value.toString(16).padStart(2,"0")).join("");
            if(!ingested||claimedBlockHash!==actualHash||claimedIngestedHash!==actualHash)throw new ProviderRequestError({code:"audio_image_reference_integrity_mismatch",category:"provider",scope:"request",action:"edit_request",message:"The selected image, rights receipt, and original uploaded bytes must match the same verified content hash.",retryable:false,retryAfterMs:null,requestId:null,httpStatus:403,contributingBlockIds:[image.blockId],contributingReferenceIds:[image.referenceId]});
          }
          audioImageReference=image;
        }
      }catch(error){const detail=classifyProviderFailure(error);return Response.json({error:detail.code,errorDetail:publicFailureDetail(detail)},{status:detail.httpStatus&&detail.httpStatus>=400&&detail.httpStatus<500?detail.httpStatus:400});}
      let productionPlan:ManagedProductionPlan|null=productionMode==="managed"&&body.productionPlan?.mode==="managed"?body.productionPlan:null;
      if(artifactKind==="video"){
        try{
          resolveVideoAudioPolicy({snapshot:body.providerJobId?undefined:compiledSnapshot,audioMode:requestedVideoAudioMode,providedSoundtrack:preparedAudioReferences.length>0});
          if(!(body.providerJobId&&body.videoInputReceipt)){
            preparedVideoReferences=await videoPixelReferences(env,storageOwnerId,compiledSnapshot,sourceEvents,executionScope);
            if(productionMode==="managed"){
              productionPlan??=buildManagedProductionPlan("video",compiledSnapshot,{references:preparedVideoReferences.map((reference)=>({referenceId:reference.referenceId,blockId:reference.blockId,sequence:reference.sequence,contextGroupIds:(reference.contextGroups??[]).filter((group)=>group.role!=="sequence"&&group.role!=="slide_chapter").map((group)=>group.id),label:reference.label}))});
              const managedProviderModel=body.providerModel||env.FAL_REFERENCE_VIDEO_MODEL||VIDEO_ADAPTER_CONTRACT.model;
              for(const scene of productionPlan.scenes){const references=preparedVideoReferences.filter((reference)=>scene.referenceIds.includes(reference.referenceId)).slice(0,VIDEO_ADAPTER_CONTRACT.maxReferenceImages);const selectedModel=validateCreativeVideoReferences(env,references,managedProviderModel,requestedVideoAudioMode);adaptVideoPrompt(scene.action,{snapshot:productionSceneSnapshot(compiledSnapshot,scene),references,seconds:scene.durationSeconds,size:body.videoSize==="720x1280"?"720x1280":"1280x720",model:selectedModel,promptProfile:selectedModel===VIDEO_ADAPTER_CONTRACT.model?"positive-only":"standard",audioMode:requestedVideoAudioMode});}
            }else{
              const selectedModel=validateCreativeVideoReferences(env,preparedVideoReferences,body.providerModel||undefined,requestedVideoAudioMode);
              validateCreativeVideoAudioReferences(selectedModel,preparedVideoReferences,preparedAudioReferences,compiledSnapshot);
              if(!body.providerJobId)adaptVideoPrompt("Preserve the complete authored visual direction.",{
                snapshot:compiledSnapshot,references:preparedVideoReferences,seconds:requestedVideoSeconds,
                size:body.videoSize==="720x1280"?"720x1280":"1280x720",model:selectedModel,
                promptProfile:selectedModel===VIDEO_ADAPTER_CONTRACT.model?"positive-only":"standard",audioMode:requestedVideoAudioMode,providedSoundtrack:preparedAudioReferences.length>0,
              });
            }
          }
        }catch(error){const detail=classifyProviderFailure(error);return Response.json({error:detail.code,errorDetail:publicFailureDetail(detail)},{status:detail.httpStatus&&detail.httpStatus>=400&&detail.httpStatus<500?detail.httpStatus:400});}
      }
      if(artifactKind==="storyboard"&&productionMode==="managed"){
        try{preparedVideoReferences=await videoPixelReferences(env,storageOwnerId,compiledSnapshot,sourceEvents,executionScope);}
        catch(error){const detail=classifyProviderFailure(error);return Response.json({error:detail.code,errorDetail:publicFailureDetail(detail)},{status:detail.httpStatus&&detail.httpStatus>=400&&detail.httpStatus<500?detail.httpStatus:400});}
      }
      if(productionMode==="managed"&&!productionPlan){
        try{productionPlan=buildManagedProductionPlan(artifactKind,compiledSnapshot,{requestedItemCount:artifactKind==="video"?undefined:presentationRequest.requestedSlideCount??body.itemCount,...(artifactKind==="slides"&&presentationRequest.requestedSlideCount!==undefined?{requestedSlideCount:presentationRequest.requestedSlideCount}:{}),...(sceneConfiguration?{sceneMedium:sceneConfiguration.medium}:{}),references:preparedVideoReferences.map((reference)=>({referenceId:reference.referenceId,blockId:reference.blockId,sequence:reference.sequence,contextGroupIds:(reference.contextGroups??[]).filter((group)=>group.role!=="sequence"&&group.role!=="slide_chapter").map((group)=>group.id),label:reference.label}))});}
        catch(error){if(error instanceof RangeError&&"code" in error)return Response.json({error:String(error.code),message:error.message},{status:422});throw error;}
      }
      if(artifactKind==="slides"&&productionPlan&&productionPlan.requestedSlideCount!==null&&productionPlan.requestedSlideCount!==productionPlan.predictedSlideCount)return Response.json({error:"presentation_slide_count_conflict",message:`The requested ${productionPlan.requestedSlideCount} slides would omit required authored positions. Explicitly choose ${productionPlan.predictedSlideCount} slides before generation.`,authoredSlideCount:productionPlan.authoredSlideCount,requestedSlideCount:productionPlan.requestedSlideCount,plannedSlideCount:productionPlan.predictedSlideCount},{status:409});
      if(artifactKind==="slides"&&productionPlan){const authorizedSources=new Set(buildPresentationSourceContract(compiledSnapshot).sources.filter((source)=>source.sourceKind==="block").map((source)=>source.sourceId));if(productionPlan.scenes.some((scene)=>!scene.sourceBlockIds.some((sourceId)=>authorizedSources.has(sourceId))))return Response.json({error:"presentation_authorized_source_required",message:"Every planned slide requires an active, authorized positive source before any budget is reserved or a model is contacted."},{status:422});}
      if(productionPlan)itemCount=productionPlan.scenes.length;
      const presentationStyle=artifactKind==="slides"?presentationRequest.presentationStyle:undefined;
      const presentationFidelity=artifactKind==="slides"?presentationRequest.presentationFidelity??"faithful":undefined;
      const requestedSlideCount=artifactKind==="slides"?productionPlan?.requestedSlideCount??presentationRequest.requestedSlideCount??body.itemCount??itemCount:undefined;
      const authoredSlideCount=artifactKind==="slides"?productionPlan?.authoredSlideCount??inferPresentationSourceOutline(compiledSnapshot).authoredSlideCount??0:undefined;
      const presentationOptions=artifactKind==="slides"?{...(presentationStyle?{presentationStyle}:{}),presentationFidelity,requestedSlideCount,authoredSlideCount}:{};
      const presentationSourceContract=artifactKind==="slides"?buildPresentationSourceContract(compiledSnapshot,{itemCount,requestedSlideCount,presentationStyle,fidelity:presentationFidelity}):undefined;
      const artifactValidationOptions={itemCount,contextGroupIds:combinedContextGroups(compiledSnapshot).map((group)=>group.id),...(presentationSourceContract?{sourceContract:presentationSourceContract,requireSourceGrounding:presentationSourceContract.sources.some((source)=>source.sourceKind==="block"),requireAllProtectedContent:true}:{})};
      const presentationReceipt=artifactKind==="slides"?{
        presentation_adapter_version:PRESENTATION_ADAPTER_VERSION,
        presentation_style:presentationStyle??null,presentation_fidelity:presentationFidelity,
        authored_slide_count:authoredSlideCount,requested_slide_count:requestedSlideCount,predicted_slide_count:itemCount,
        slide_count_mismatch:productionPlan?.slideCountMismatch??Boolean(authoredSlideCount&&requestedSlideCount!==authoredSlideCount),
        provider_batch_count:productionPlan?.providerBatchCount??1,
        minimum_provider_call_count:productionPlan?.providerCallCount??1,
        maximum_provider_call_count:productionPlan?.maximumProviderCallCount??2,
        source_transmission:"authorized-active-document-context",
      }:{};
      const prepaidProviderRecovery=(artifactKind==="video"||artifactKind==="audio")&&Boolean(body.providerJobId&&body.artifactPlan&&body.plannerResponseId)&&recordedDocumentPlannerUsage(sourceEvents,String(body.plannerResponseId??"")).tokensRecorded;const reserved=prepaidProviderRecovery?1:documentRenderTokenReservation(artifactKind,itemCount,productionPlan?.maximumProviderCallCount);
      const retainedPresentationDraft=execution&&body.artifactPlan&&body.plannerResponseId?parseDocumentArtifactContent(JSON.stringify(body.artifactPlan)):null;
      const resumablePresentation=Boolean(retainedPresentationDraft&&!documentArtifactValidationIssues(artifactKind,retainedPresentationDraft,artifactValidationOptions).length);
      if(artifactKind==="slides"&&execution&&(body.plannerResponseId||Array.isArray((body as Record<string,unknown>).plannerResponseIds)&&((body as Record<string,unknown>).plannerResponseIds as unknown[]).length)&&(body as Record<string,unknown>).presentationProviderSubmission==="confirmed"&&!resumablePresentation){
        const detail={code:"presentation_recovery_unavailable",category:"server" as const,scope:"request" as const,action:"contact_support" as const,message:"The retained paid presentation did not pass the current authorized source review. No new provider request was submitted; review or recover the saved candidate before starting a new generation.",retryable:false,retryAfterMs:null,requestId:null,httpStatus:null};
        return Response.json({error:detail.code,errorDetail:publicFailureDetail(detail)},{status:409});
      }
      const requestedSafeRecovery=(body as Record<string,unknown>).storyboardSafeRecovery;
      const storyboardSafeRecovery=execution&&artifactKind==="storyboard"&&!productionPlan&&!body.providerJobId&&(body as Record<string,unknown>).storyboardProviderSubmission==="cleared"&&body.artifactPlan&&body.plannerResponseId&&body.reservationId&&(body as Record<string,unknown>).costReservationId?validatedStoryboardSafeRecovery(requestedSafeRecovery,(body as Record<string,unknown>).storyboardRejectedProviderReceipt,body.renderedItems,env.FAL_IMAGE_PREVIEW_MODEL??"ideogram/v4/fast"):null;
      if(requestedSafeRecovery&&!storyboardSafeRecovery)return Response.json({error:"storyboard_safe_recovery_invalid",message:"The one-time storyboard recovery does not match its original provider receipt, saved frames, or reserved budget."},{status:409});
      let reservationId=body.reservationId&&(resumablePresentation||artifactKind!=="slides"&&((body.providerJobId&&(artifactKind==="storyboard"||body.videoInputReceipt||body.audioInputReceipt))||storyboardSafeRecovery||body.productionSceneReceipts||body.productionFrameReceipts||body.productionAnchor))?body.reservationId:"",reservationCreated=false;let budgeted:EventRow|null=null;let requestedSequence=artifactKind==="slides"?current:await streamHead(env,streamId);const artifactId=body.artifactId||uuidV7();
      const prepaidSceneIds=new Set(Array.isArray(body.productionPrepaidSceneIds)?body.productionPrepaidSceneIds.map(String):[]);const prepaidSceneCost=Object.values(body.productionSceneReceipts??{}).reduce((sum,receipt)=>sum+(prepaidSceneIds.has(receipt.sceneId)?Number(receipt.costMicrousd??receipt.durationSeconds*VIDEO_ADAPTER_CONTRACT.publishedCostPerSecondMicrousd[VIDEO_ADAPTER_CONTRACT.defaultResolution]):0),0);const prepaidProviderCostMicrousd=Math.max(0,Math.floor(Number((body as Record<string,unknown>).prepaidProviderCostMicrousd??0)));const estimatedAudioProviderCost=requestedAudioSelection?.estimatedCostMicrousd??AUDIO_ADAPTER_CONTRACT.publishedCostMicrousd;const grossEstimatedCostMicrousd=productionPlan?productionPlan.estimatedTotalCostMicrousd+(artifactKind==="storyboard"?itemCount*1_000_000:artifactKind==="audio"?estimatedAudioProviderCost:0):artifactKind==="video"?requestedVideoSeconds*VIDEO_ADAPTER_CONTRACT.publishedCostPerSecondMicrousd[VIDEO_ADAPTER_CONTRACT.defaultResolution]+1_000_000:artifactKind==="audio"?estimatedAudioProviderCost+1_000_000:artifactKind==="storyboard"?itemCount*1_000_000+1_000_000:1_000_000;const estimatedCostMicrousd=Math.max(1,grossEstimatedCostMicrousd-prepaidSceneCost-prepaidProviderCostMicrousd-(prepaidSceneIds.size&&body.productionAnchor?500_000:0));
      let costReservationMicrousd=0;let costReservationId=String((body as Record<string,unknown>).costReservationId??"");let costReservationPeriod=String((body as Record<string,unknown>).costReservationPeriod??"");let tokenReservationPeriod=costReservationPeriod;let costReservationSettled=false;let retainedStoryboardCostClaim=false;
      if(!reservationId){const reservation=await reserveBudget(env,billingOwnerId,reserved,{streamId,correlationId:corr,operation:`document-render:${artifactKind}`,projectScope:projectBudgetScope});if(!reservation.ok){const denied=makeEvent(streamId,requestedSequence+1,"worker:policy",client,corr,"BudgetExceeded",{reason:"hard_cap_reached",scope:reservation.scope,reserved_tokens:0,operation:`document-render:${artifactKind}`,artifact_kind:artifactKind});await insertEvent(env,denied).run();const detail=applicationFailureDetail("budget_hard_cap_reached",reservation.scope,429);return Response.json({error:detail.code,errorDetail:publicFailureDetail(detail),scope:reservation.scope},{status:429});}reservationId=reservation.reservationId;tokenReservationPeriod=reservation.period;reservationCreated=true;}
      if(costReservationId){const existing=await costBudgetReservation(env,billingOwnerId,costReservationId);retainedStoryboardCostClaim=Boolean(execution&&artifactKind==="storyboard"&&(((body as Record<string,unknown>).storyboardProviderSubmission==="confirmed"&&body.providerJobId)||storyboardSafeRecovery)&&existing?.status==="executing");if(!existing||existing.status!=="active"&&!retainedStoryboardCostClaim||existing.stream_id!==streamId||existing.correlation_id!==corr||existing.operation!==`document-render:${artifactKind}`||existing.reserved_microusd<estimatedCostMicrousd||(costReservationPeriod&&existing.period!==costReservationPeriod)||(body.costReservationMicrousd&&existing.reserved_microusd!==Math.floor(Number(body.costReservationMicrousd)))){if(reservationCreated)await releaseBudget(env,billingOwnerId,reservationId,{reason:`document_${artifactKind}_cost_reservation_invalid`});return Response.json({error:"cost_reservation_invalid_or_expired"},{status:409});}costReservationMicrousd=existing.reserved_microusd;costReservationPeriod=existing.period;}
      if(!costReservationId){const costReservation=await reserveCostBudget(env,billingOwnerId,estimatedCostMicrousd,{maximumMicrousd:estimatedCostMicrousd,allowUserOverage:false,streamId,correlationId:corr,operation:`document-render:${artifactKind}`,...(tokenReservationPeriod?{period:tokenReservationPeriod}:{}),projectScope:projectBudgetScope});if(!costReservation.ok){if(reservationCreated)await releaseBudget(env,billingOwnerId,reservationId,{reason:`document_${artifactKind}_cost_cap_reached`});const denied=makeEvent(streamId,requestedSequence+1,"worker:policy",client,corr,"BudgetExceeded",{reason:"monthly_cost_cap_reached",scope:costReservation.scope,reserved_tokens:0,estimated_cost_microusd:estimatedCostMicrousd,operation:`document-render:${artifactKind}`,artifact_kind:artifactKind});await insertEvent(env,denied).run();const detail=applicationFailureDetail("budget_hard_cap_reached",costReservation.scope,429);return Response.json({error:detail.code,errorDetail:publicFailureDetail(detail),scope:costReservation.scope},{status:429});}costReservationId=costReservation.reservationId;costReservationMicrousd=costReservation.reservedMicrousd;costReservationPeriod=costReservation.period;}
      if(!retainedStoryboardCostClaim&&!await claimCostBudgetReservation(env,billingOwnerId,costReservationId)){if(reservationCreated)await releaseBudget(env,billingOwnerId,reservationId,{reason:`document_${artifactKind}_cost_reservation_claim_conflict`});return Response.json({error:"cost_reservation_already_in_use"},{status:409});}
      const sourceBlockVersions=projection.blocks.filter((block)=>block.properties.active!==false&&Number(block.properties.weight??.5)>0).map((block)=>({block_id:block.id,version:block.sourceEvents.length}));
      const workflowLineage=body.workflowId&&body.workflowStageId?{workflow_id:body.workflowId,workflow_stage_id:body.workflowStageId,workflow_sources:body.workflowSources??[]} : {};
      const sceneContextLineage=sceneConfiguration?{
        document_id:projection.documentId,
        project_id:projection.projectId,
        source_block_ids:sourceBlockVersions.map((source)=>source.block_id),
        ...(body.documentRevision?{context_revision:body.documentRevision}:{}),
        ...(body.workflowId&&body.workflowStageId?{
          workflow_id:body.workflowId,
          workflow_stage_id:body.workflowStageId,
          source_artifact_ids:(body.workflowSources??[]).filter((source)=>source.outputKind==="artifact").map((source)=>source.outputId),
          source_output_ids:(body.workflowSources??[]).filter((source)=>source.outputKind==="image").map((source)=>source.outputId),
        }:{}),
      }:undefined;
      const sceneContextContinuity=sceneContextLineage?{
        ...sceneContextLineage,
        source_snapshot_sha256:await creativeContextHash(compiledSnapshot),
      }:undefined;
      const sceneReceipt=sceneConfiguration?{
        scene_medium:sceneConfiguration.medium,
        scene_configuration:sceneConfiguration,
        scene_context_lineage:sceneContextLineage,
        scene_context_fingerprint:sceneContextContinuity?.source_snapshot_sha256,
      }:{};
      if(reservationCreated)await execution?.progress("planning",`Structuring the ${sceneConfiguration?`${sceneConfiguration.medium} `:""}${artifactKind.replaceAll("_"," ")} from the current document.`,{artifactId,reservationId,costReservationId,costReservationPeriod,costReservationMicrousd,...(artifactKind==="audio"&&requestedAudioSelection?{providerModel:requestedAudioSelection.model,audioEstimatedCostMicrousd:requestedAudioSelection.estimatedCostMicrousd}:{}),...(productionPlan?{productionPlan}:{}),...(sceneConfiguration?{sceneMedium:sceneConfiguration.medium,sceneConfiguration}:{})});
      const requestEvent=makeEvent(streamId,++requestedSequence,userActor,client,corr,"DocumentRenderRequested",{artifact_id:artifactId,artifact_kind:artifactKind,document_id:projection.documentId,project_id:projection.projectId,...workflowLineage,...sceneReceipt,source_block_versions:sourceBlockVersions,item_count:itemCount,...presentationReceipt,audience:audience||null,tone:tone||null,source_surface:body.sourceSurface??"document",request_key:body.requestKey??null,video_seconds:artifactKind==="video"?(productionPlan?.totalDurationSeconds??requestedVideoSeconds):null,video_size:artifactKind==="video"?body.videoSize??"1280x720":null,video_audio_mode:artifactKind==="video"?requestedVideoAudioMode:null,paid_media_confirmed:body.paidMediaConfirmed===true,production_mode:productionMode,production_team:productionPlan?.team.id??null,estimated_cost_microusd:estimatedCostMicrousd,resumed_provider_job:Boolean(body.providerJobId||body.productionSceneReceipts)},{causationId:null});if(reservationCreated){budgeted=makeEvent(streamId,++requestedSequence,"worker:policy",client,corr,"BudgetReserved",{operation:`document-render:${artifactKind}`,artifact_id:artifactId,artifact_kind:artifactKind,reservation_id:reservationId,cost_reservation_id:costReservationId,reserved_tokens:reserved,reserved_microusd:costReservationMicrousd,period:costReservationPeriod,resumed_provider_job:Boolean(body.providerJobId||body.productionSceneReceipts)},{causationId:requestEvent.eventId});}await appendEvents(env,budgeted?[requestEvent,budgeted]:[requestEvent]);
      let activeProviderJobId=body.providerJobId??"",activeProviderModel=body.providerModel??String(body.audioInputReceipt?.model??body.videoInputReceipt?.model??""),activeProviderStatusUrl=body.providerStatusUrl??"",activeProviderResponseUrl=body.providerResponseUrl??"",activeProviderCancelUrl=body.providerCancelUrl??"",videoSubmissionAttempted=Boolean(body.providerJobId),storyboardSubmissionAttempted=artifactKind==="storyboard"&&Boolean(body.providerJobId),presentationSubmissionPending=false;let storyboardProviderSubmission:"pending"|"confirmed"|"rejected"|"cleared"|undefined=artifactKind==="storyboard"&&activeProviderJobId&&(body as Record<string,unknown>).storyboardProviderSubmission==="confirmed"?"confirmed":undefined;let storyboardProviderRequestedAt=String((body as Record<string,unknown>).storyboardProviderRequestedAt??"");let storyboardProviderAcceptedAt=String((body as Record<string,unknown>).storyboardProviderAcceptedAt??"");let plannerModel=String(body.plannerModel??env.OPENAI_MODEL??"gpt-5.6-terra");let plannerResponseId=String(body.plannerResponseId??"");let plannerResponseIds=Array.isArray((body as Record<string,unknown>).plannerResponseIds)?((body as Record<string,unknown>).plannerResponseIds as unknown[]).map(String).filter(Boolean):[];let plannerLatencyMs=Number(body.plannerLatencyMs??0);let plannerUsage={inputTokens:Number(body.plannerUsage?.inputTokens??0),outputTokens:Number(body.plannerUsage?.outputTokens??0),totalTokens:Number(body.plannerUsage?.totalTokens??0)};let plannerInput=body.plannerInput&&typeof body.plannerInput==="object"?body.plannerInput:{};
      const presentationCandidates=execution&&Array.isArray((body as Record<string,unknown>).presentationCandidates)?[...(body as Record<string,unknown>).presentationCandidates as Record<string,unknown>[]]:[];
      const presentationSourceHash=artifactKind==="slides"?Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(authoritativeSnapshot??body.snapshot??{})))),(value)=>value.toString(16).padStart(2,"0")).join(""):"";
      const presentationCompiledHash=artifactKind==="slides"?Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(compiledSnapshot)))),(value)=>value.toString(16).padStart(2,"0")).join(""):"";
      const presentationPageUsage=new Map<number,{inputTokens:number;outputTokens:number;totalTokens:number}>();
      const checkpointPresentationResponse=execution?async(attempt:ProviderResponseReceipt&{pageIndex?:number;pageCount?:number;globalStartIndex?:number})=>{
        const pageIndex=Math.max(0,Number(attempt.pageIndex??0));
        const pageCount=Math.max(1,Number(attempt.pageCount??1));
        const globalStartIndex=Math.max(0,Number(attempt.globalStartIndex??0));
        const previousPageUsage=presentationPageUsage.get(pageIndex)??{inputTokens:0,outputTokens:0,totalTokens:0};
        plannerUsage={inputTokens:plannerUsage.inputTokens+Math.max(0,attempt.usage.inputTokens-previousPageUsage.inputTokens),outputTokens:plannerUsage.outputTokens+Math.max(0,attempt.usage.outputTokens-previousPageUsage.outputTokens),totalTokens:plannerUsage.totalTokens+Math.max(0,attempt.usage.totalTokens-previousPageUsage.totalTokens)};
        presentationPageUsage.set(pageIndex,attempt.usage);
        plannerModel=attempt.model;plannerResponseId=attempt.responseId;plannerResponseIds=[...new Set([...plannerResponseIds,...attempt.responseIds])];plannerLatencyMs=attempt.latencyMs;presentationSubmissionPending=false;
        (body as Record<string,unknown>).plannerResponseIds=plannerResponseIds;
        if(attempt.candidateTruncated||!attempt.candidateRaw||!attempt.responseId)return;
        const contentHash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(attempt.candidateRaw))),(value)=>value.toString(16).padStart(2,"0")).join("");
        const jobId=corr.replace(/:attempt:\d+$/u,"");
        const capturedAt=new Date().toISOString();
        const attemptStage=attempt.responseIds.length>1?"repair":"initial";
        const providerAttempt=Math.max(1,plannerResponseIds.indexOf(attempt.responseId)+1);
        const envelope=JSON.stringify({schema_version:2,artifact_kind:artifactKind,job_id:jobId,stream_id:streamId,document_id:projection.documentId,document_title:projection.documentTitle,document_revision:body.documentRevision??null,source_snapshot_sha256:presentationSourceHash,compiled_snapshot_sha256:presentationCompiledHash,response_id:attempt.responseId,model:attempt.model,page_index:pageIndex,page_count:pageCount,global_start_index:globalStartIndex,requested_slide_count:requestedSlideCount??itemCount,planned_slide_count:itemCount,provider_batch_count:productionPlan?.providerBatchCount??1,production_mode:productionMode,attempt_stage:attemptStage,provider_attempt:providerAttempt,captured_at:capturedAt,content_sha256:contentHash,output_text:attempt.candidateRaw});
        const stored=await storePrivateContent(env,ownerId,"provider-response",envelope,executionScope);
        let locallyRecoverable=false;
        if(artifactKind==="slides"&&pageCount===1&&globalStartIndex===0&&itemCount<=12&&Number(requestedSlideCount??itemCount)===itemCount&&(!productionPlan||productionPlan.providerBatchCount===1&&productionPlan.scenes.length===itemCount)){
          try{
            const sourceSnapshot=productionPlan?combinedSceneSnapshot(compiledSnapshot,productionPlan.scenes):compiledSnapshot;
            const assessment=assessStoredPresentationCandidate(attempt.candidateRaw,sourceSnapshot,{itemCount,requestedSlideCount:itemCount,presentationStyle,presentationFidelity,...(productionPlan?{productionScenes:productionPlan.scenes}:{})});
            locallyRecoverable=Boolean(assessment.output&&assessment.issues.length===0);
          }catch{/* A paid response still remains privately inspectable if its local reassessment cannot establish recovery eligibility. */}
        }
        const candidate={contentRef:stored.contentId,contentExpiresAt:stored.expiresAt,responseId:attempt.responseId,model:attempt.model,usage:attempt.usage,candidateBytes:attempt.candidateBytes,candidateTruncated:false,pageIndex,pageCount,globalStartIndex,documentRevision:body.documentRevision??null,sourceSnapshotSha256:presentationSourceHash,compiledSnapshotSha256:presentationCompiledHash,contentSha256:contentHash,capturedAt,attemptStage,providerAttempt,locallyRecoverable};
        presentationCandidates.push(candidate);
        if(presentationCandidates.length>64)presentationCandidates.splice(0,presentationCandidates.length-64);
        await execution.progress("planning",`${plannerResponseIds.length} paid provider response${plannerResponseIds.length===1?"":"s"} privately retained before validation.`,{plannerModel,plannerResponseId,plannerResponseIds,plannerUsage,presentationCandidates,recoverablePresentationCandidate:presentationCandidates.some((entry)=>entry.locallyRecoverable===true),reservationId,costReservationId,costReservationPeriod,costReservationMicrousd,...(artifactKind==="slides"?{presentationProviderSubmission:"confirmed"}:{})});
      }:undefined;
      const observePaid=paidProviderObserver(body as Record<string,unknown>,execution?.progress,{artifactId,reservationId,costReservationId,costReservationPeriod,costReservationMicrousd});
      try{
        type Plan=Awaited<ReturnType<typeof generateDocumentArtifact>>["output"];const cached=body.artifactPlan;let plan:Plan;
        const cachedPlan=cached?parseDocumentArtifactContent(JSON.stringify(cached)):null;
        const guardPresentationSpend=artifactKind==="slides"?async(attempt:{model:string;maximumInputTokens:number;maximumOutputTokens:number;clientRequestId:string})=>{
          const maximumProviderCallCount=productionPlan?.maximumProviderCallCount??2;
          if(new Set(plannerResponseIds.filter(Boolean)).size>=maximumProviderCallCount)throw new ProviderRequestError({code:"presentation_provider_call_cap_reached",category:"provider",scope:"request",action:"edit_request",message:"The approved presentation provider-attempt limit was reached; no additional paid request was submitted.",retryable:false,retryAfterMs:null,requestId:null,httpStatus:409});
          if(!hasKnownTextModelPricing(attempt.model))throw new ProviderRequestError({code:"presentation_model_pricing_unavailable",category:"quota",scope:"request",action:"review_budget",message:"The configured slideshow model has no verified pricing; no paid request was submitted.",retryable:false,retryAfterMs:null,requestId:null,httpStatus:429});
          if(plannerUsage.totalTokens+attempt.maximumInputTokens+attempt.maximumOutputTokens>reserved)throw new ProviderRequestError({code:"presentation_token_cap_reached",category:"quota",scope:"request",action:"review_budget",message:"The next slideshow provider request could exceed its reserved monthly token budget and was not submitted.",retryable:false,retryAfterMs:null,requestId:null,httpStatus:429});
          const previous=priceTextUsageBreakdownMicrousd(attempt.model,plannerUsage).totalMicrousd;
          const maximum=priceTextUsageBreakdownMicrousd(attempt.model,{inputTokens:attempt.maximumInputTokens,outputTokens:attempt.maximumOutputTokens,totalTokens:attempt.maximumInputTokens+attempt.maximumOutputTokens}).totalMicrousd;
          if(previous+maximum>costReservationMicrousd)throw new ProviderRequestError({code:"presentation_spend_cap_reached",category:"quota",scope:"request",action:"review_budget",message:"The next slideshow provider request would exceed its application-enforced spending ceiling and was not submitted.",retryable:false,retryAfterMs:null,requestId:null,httpStatus:429});
          if(execution){await execution.progress("submitting","Submitting the approved presentation request to its provider.",{artifactId,reservationId,costReservationId,costReservationPeriod,costReservationMicrousd,presentationProviderSubmission:"pending",presentationProviderClientRequestId:attempt.clientRequestId});presentationSubmissionPending=true;}
        }:undefined;
        const guardDocumentPlanningSpend=guardPresentationSpend??(async(attempt:{model:string;maximumInputTokens:number;maximumOutputTokens:number;clientRequestId:string})=>{
          const maximumProviderCallCount=productionPlan?.maximumProviderCallCount??2;
          if(new Set(plannerResponseIds.filter(Boolean)).size>=maximumProviderCallCount)throw new ProviderRequestError({code:"document_provider_call_cap_reached",category:"provider",scope:"request",action:"edit_request",message:"The approved generation planning-attempt limit was reached; no additional paid request was submitted.",retryable:false,retryAfterMs:null,requestId:null,httpStatus:409});
          if(!hasKnownTextModelPricing(attempt.model))throw new ProviderRequestError({code:"document_model_pricing_unavailable",category:"quota",scope:"request",action:"review_budget",message:"The configured generation model has no verified pricing; no paid planning request was submitted.",retryable:false,retryAfterMs:null,requestId:null,httpStatus:429});
          const recorded=recordedDocumentPlannerUsage(sourceEvents,plannerResponseId,priceTextUsageBreakdownMicrousd(attempt.model,plannerUsage).totalMicrousd);
          const pendingPlannerTokens=recorded.tokensRecorded?0:plannerUsage.totalTokens;
          const plannerTokenCeiling=Math.min(reserved,documentPlanningTokenReservation(productionPlan?.maximumProviderCallCount));
          if(pendingPlannerTokens+attempt.maximumInputTokens+attempt.maximumOutputTokens>plannerTokenCeiling)throw new ProviderRequestError({code:"document_token_cap_reached",category:"quota",scope:"request",action:"review_budget",message:"The next generation planning request could exceed its reserved planning token budget and was not submitted.",retryable:false,retryAfterMs:null,requestId:null,httpStatus:429});
          const previous=remainingDocumentPlannerCost(attempt.model,plannerUsage,recorded.recordedCostMicrousd).totalMicrousd;
          const maximum=priceTextUsageBreakdownMicrousd(attempt.model,{inputTokens:attempt.maximumInputTokens,outputTokens:attempt.maximumOutputTokens,totalTokens:attempt.maximumInputTokens+attempt.maximumOutputTokens}).totalMicrousd;
          const plannerCostCeiling=Math.min(costReservationMicrousd,Math.max(0,productionPlan?.estimatedPlanningCostMicrousd??1_000_000));
          if(previous+maximum>plannerCostCeiling)throw new ProviderRequestError({code:"document_spend_cap_reached",category:"quota",scope:"request",action:"review_budget",message:"The next generation planning request would exceed its approved planning spending ceiling and was not submitted.",retryable:false,retryAfterMs:null,requestId:null,httpStatus:429});
        });
        if(cachedPlan&&!documentArtifactValidationIssues(artifactKind,cachedPlan,artifactValidationOptions).length){plan=cachedPlan;}else{
          if(body.plannerResponseId||providerSubmissions(body as Record<string,unknown>).some((entry)=>entry.operation==="planning"&&entry.status==="completed"))throw new ProviderRequestError({code:"provider_result_recovery_unavailable",category:"server",scope:"unknown",action:"contact_support",message:"The paid planning response cannot be safely reconstructed from its saved plan. No second planning request was submitted.",retryable:false,retryAfterMs:null,requestId:null,httpStatus:null});
          if(storyboardSafeRecovery)throw new ProviderRequestError({code:"storyboard_safe_recovery_plan_invalid",category:"provider",scope:"request",action:"contact_support",message:"The original storyboard plan is unavailable or invalid. No replacement image or second planner request was submitted.",retryable:false,retryAfterMs:null,requestId:storyboardSafeRecovery.rejectedProviderJobId,httpStatus:409});
          const planned=productionPlan
            ?await generateManagedArtifactDraft(env,ownerId,artifactKind,{documentTitle:projection.documentTitle,snapshot:compiledSnapshot,production:productionPlan,locale:body.locale,audience:audience||undefined,tone:tone||undefined,...(sceneConfiguration?{sceneMedium:sceneConfiguration.medium,sceneConfiguration}:{}),...presentationOptions,videoSize:artifactKind==="video"?(body.videoSize==="720x1280"?"720x1280":"1280x720"):undefined,videoAudioMode:artifactKind==="video"?requestedVideoAudioMode:undefined,...(artifactKind==="audio"&&requestedAudioProfile?{audioProfile:requestedAudioProfile}:{}),signal:execution?.signal,progress:execution?.progress,...(checkpointPresentationResponse?{plannerResponse:checkpointPresentationResponse}:{}),onProviderSubmission:observePaid,plannerPreflight:guardDocumentPlanningSpend,plannerAttempt:async(attempt)=>{plannerModel=attempt.model;plannerResponseId=attempt.responseId;plannerResponseIds=attempt.responseIds;plannerLatencyMs=attempt.latencyMs;plannerUsage=attempt.usage;plannerInput={...plannerInput,provider_request_count:attempt.responseIds.length};(body as Record<string,unknown>).plannerResponseIds=attempt.responseIds;await execution?.progress("planning",`${productionPlan.team.label}: ${attempt.responseIds.length} paid provider response${attempt.responseIds.length===1?"":"s"} safely recorded.`,{plannerModel,plannerResponseId,plannerLatencyMs,plannerUsage,plannerInput,plannerResponseIds:attempt.responseIds,reservationId,costReservationId,costReservationPeriod,costReservationMicrousd,productionPlan,...(artifactKind==="slides"?{presentationProviderSubmission:"confirmed"}:{})});presentationSubmissionPending=false;}})
            :await generateDocumentArtifact(env,ownerId,artifactKind,{documentTitle:projection.documentTitle,snapshot:compiledSnapshot,options:{itemCount,locale:body.locale,audience:audience||undefined,tone:tone||undefined,...(sceneConfiguration?{sceneMedium:sceneConfiguration.medium,sceneConfiguration}:{}),...presentationOptions,videoSeconds:artifactKind==="video"?requestedVideoSeconds:undefined,videoSize:artifactKind==="video"?(body.videoSize==="720x1280"?"720x1280":"1280x720"):undefined,videoAudioMode:artifactKind==="video"?requestedVideoAudioMode:undefined,...(artifactKind==="audio"&&requestedAudioProfile?{audioProfile:requestedAudioProfile}:{}),signal:execution?.signal,...(checkpointPresentationResponse?{onProviderResponse:checkpointPresentationResponse}:{}),onProviderSubmission:observePaid,onBeforeProviderAttempt:guardDocumentPlanningSpend,onProviderAttempt:async(attempt)=>{plannerModel=attempt.model;plannerResponseId=attempt.responseId;plannerResponseIds=attempt.responseIds;plannerUsage=attempt.usage;plannerLatencyMs=attempt.latencyMs;plannerInput={...plannerInput,validation:{...((plannerInput as Record<string,unknown>).validation&&typeof (plannerInput as Record<string,unknown>).validation==="object"?(plannerInput as Record<string,unknown>).validation as Record<string,unknown>:{}),provider_call_count:attempt.responseIds.length}};(body as Record<string,unknown>).plannerResponseIds=attempt.responseIds;await execution?.progress("planning",`${attempt.responseIds.length} paid provider response${attempt.responseIds.length===1?"":"s"} safely recorded.`,{plannerModel,plannerResponseId,plannerResponseIds,plannerUsage,plannerInput,reservationId,costReservationId,costReservationPeriod,costReservationMicrousd,...(artifactKind==="slides"?{presentationProviderSubmission:"confirmed"}:{})});presentationSubmissionPending=false;}}});
          plan=planned.output;plannerModel=planned.model;plannerResponseId=planned.responseId;plannerLatencyMs=planned.latencyMs;plannerUsage=planned.usage;plannerInput=planned.inputReceipt;
          await execution?.progress(artifactKind==="storyboard"?"rendering-frames":artifactKind==="video"?"preparing-video":artifactKind==="audio"?"preparing-audio":artifactKind==="slides"?"composing-slides":"writing",productionPlan?`${productionPlan.team.label} planned ${itemCount} distinct ${artifactKind==="video"?"scenes":artifactKind==="storyboard"?"frames":artifactKind==="audio"?"audio segments":"work units"}.`:artifactKind==="storyboard"?`Story structure ready. Rendering ${itemCount} connected frames.`:artifactKind==="video"?"Motion prompt ready. Preparing the provider render.":artifactKind==="audio"?"The requested audio direction is ready. Preparing the selected specialist provider.":artifactKind==="slides"?`The ${itemCount}-slide visual system is composed. Saving its reusable layout data.`:`The ${artifactKind.replaceAll("_"," ")} is written. Saving its durable result.`,{artifactPlan:plan,plannerModel,plannerResponseId,plannerResponseIds,plannerLatencyMs,plannerUsage,plannerInput,reservationId,costReservationId,costReservationPeriod,costReservationMicrousd,...(productionPlan?{productionPlan}:{})});
        }
        const expectedPlannerCost=priceTextUsageBreakdownMicrousd(plannerModel,plannerUsage).totalMicrousd;const recordedPlanner=recordedDocumentPlannerUsage(sourceEvents,plannerResponseId,expectedPlannerCost);const billablePlannerUsage=recordedPlanner.tokensRecorded?{inputTokens:0,outputTokens:0,totalTokens:0}:plannerUsage;const plannerCost=remainingDocumentPlannerCost(plannerModel,plannerUsage,recordedPlanner.recordedCostMicrousd);const renderedItems=Array.isArray(body.renderedItems)?body.renderedItems.map((item)=>({...item})):[];const costParts:ProviderCostBreakdown[]=[plannerCost,...(storyboardSafeRecovery?[...storyboardSafeRecovery.completedFrameBreakdowns,storyboardSafeRecovery.rejectedFrameBreakdown]:[])];const rejectedFrameCostMicrousd=storyboardSafeRecovery?.rejectedFrameCostMicrousd??0;let mediaUrl:string|null=null;let mediaType:string|null=null;let generatedMediaHash="";let generatedAudioDuration:number|null=null;let provider="openai";let modelId=plannerModel;let providerJobId=activeProviderJobId;let renderLatencyMs=0;let videoCostMicrousd=0;let audioCostMicrousd=0;let generatedLyrics="";let totalTokens=billablePlannerUsage.totalTokens;let videoInputReceipt:Record<string,unknown>|null=body.videoInputReceipt&&typeof body.videoInputReceipt==="object"?body.videoInputReceipt:null;let audioInputReceipt:Record<string,unknown>|null=body.audioInputReceipt&&typeof body.audioInputReceipt==="object"?body.audioInputReceipt:null;let productionRenderReceipt:Record<string,unknown>|null=null;
        if(storyboardSafeRecovery&&costParts.reduce((total,part)=>total+part.totalMicrousd,0)+(plan.items.length-renderedItems.length)*storyboardSafeRecovery.rejectedFrameCostMicrousd>costReservationMicrousd)throw new ProviderRequestError({code:"storyboard_safe_recovery_spend_cap_reached",category:"quota",scope:"request",action:"review_budget",message:"The saved storyboard, its possibly charged rejected frame, and remaining images would exceed the original approved reservation. No replacement image was submitted.",retryable:false,retryAfterMs:null,requestId:storyboardSafeRecovery.rejectedProviderJobId,httpStatus:429});
        const productionProgress=(stage:string,message:string,checkpoint:Record<string,unknown>={})=>execution?.progress(stage,message,{artifactId,artifactPlan:plan,plannerModel,plannerResponseId,plannerLatencyMs,plannerUsage,plannerInput,reservationId,costReservationId,costReservationPeriod,costReservationMicrousd,...checkpoint});
        if(artifactKind==="storyboard"&&productionPlan){
          const managed=await renderManagedStoryboardProduction(env,storageOwnerId,artifactId,plan,productionPlan,{providerActorId:actorUserId,snapshot:compiledSnapshot,references:preparedVideoReferences,existingFrameReceipts:body.productionFrameReceipts,existingItems:renderedItems,signal:execution?.signal,onProviderSubmission:observePaid,progress:productionProgress,checkpoint:(checkpoint)=>{if(checkpoint.productionFrameReceipts&&typeof checkpoint.productionFrameReceipts==="object")body.productionFrameReceipts=checkpoint.productionFrameReceipts as Record<string,ProductionFrameReceipt>;}});
          renderedItems.splice(0,renderedItems.length,...managed.items);totalTokens+=managed.usage.totalTokens;costParts.push(...managed.costs);modelId=managed.model||modelId;provider=managed.provider||provider;providerJobId=managed.providerJobId||providerJobId;productionRenderReceipt={production_mode:"managed",team:productionPlan.team,plan:productionPlan,quality:managed.quality,scenes:managed.receipts,generation_order:productionPlan.executionOrder,narrative_order:productionPlan.narrativeOrder};videoInputReceipt={provider,model:modelId,production_mode:"managed",reference_inputs:managed.receipts.flatMap((receipt)=>receipt.referenceInputs),used_reference_pixels:managed.receipts.some((receipt)=>receipt.referenceInputs.length>0),scenes:managed.receipts};
        }else if(artifactKind==="storyboard"){
          if(!storyboardSafeRecovery){
            for(const frame of renderedItems){
              const receipt=providerSubmissions(body as Record<string,unknown>).find((entry)=>entry.status==="completed"&&(entry.clientRequestId===frame.provider_submission_id||entry.providerRequestId&&entry.providerRequestId===frame.provider_request_id));
              const cost=Number(receipt?.costMicrousd??frame.cost_microusd);
              if(!Number.isFinite(cost)||cost<0)throw new ProviderRequestError({code:"storyboard_retained_cost_unknown",category:"server",scope:"unknown",action:"contact_support",message:"A saved storyboard frame has no verified cost receipt. No additional paid frame was submitted.",retryable:false,retryAfterMs:null,requestId:null,httpStatus:null});
              costParts.push({textInputMicrousd:0,textOutputMicrousd:0,imageTextInputMicrousd:0,imageInputMicrousd:0,imageOutputMicrousd:cost,totalMicrousd:cost});
              totalTokens+=Number(receipt?.totalTokens??0);
            }
          }
          for(let index=renderedItems.length;index<plan.items.length;index+=1){
            const item=plan.items[index];
            const checkpoint=()=>({artifactId,artifactPlan:plan,renderedItems,reservationId,costReservationId,costReservationPeriod,costReservationMicrousd,plannerModel,plannerResponseId,plannerResponseIds,plannerLatencyMs,plannerUsage,plannerInput,providerJobId:activeProviderJobId,providerModel:activeProviderModel,providerStatusUrl:activeProviderStatusUrl,providerResponseUrl:activeProviderResponseUrl,providerCancelUrl:activeProviderCancelUrl,...(storyboardProviderSubmission?{storyboardProviderSubmission}:{}),...(storyboardProviderRequestedAt?{storyboardProviderRequestedAt}:{}),...(storyboardProviderAcceptedAt?{storyboardProviderAcceptedAt}:{}),...(storyboardSafeRecovery?{storyboardSafeRecovery:requestedSafeRecovery,storyboardRejectedProviderReceipt:(body as Record<string,unknown>).storyboardRejectedProviderReceipt,rejectedFrameCostMicrousd}:{})});
            await execution?.progress("rendering-frames",`Rendering storyboard frame ${index+1} of ${plan.items.length}.`,checkpoint());
            const baseFrameInput=storyboardFrameRenderingInput(compiledSnapshot,item);
            const safeFrameInput=storyboardSafeRecovery?storyboardSafeRecoveryRenderingInput(baseFrameInput,item,index):null;
            const frameInput=safeFrameInput??baseFrameInput;
            if(storyboardSafeRecovery&&safeFrameInput&&index===storyboardSafeRecovery.failedFrameIndex){const safePrompt=storyboardSafeRecoveryProviderPrompt(safeFrameInput);const safePromptSha256=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(safePrompt))),(byte)=>byte.toString(16).padStart(2,"0")).join("");if(safePromptSha256===storyboardSafeRecovery.rejectedPromptSha256)throw new ProviderRequestError({code:"storyboard_safe_recovery_prompt_unchanged",category:"safety",scope:"request",action:"edit_request",message:"The replacement frame still matches its rejected provider prompt. No second image request was submitted.",retryable:false,retryAfterMs:null,requestId:storyboardSafeRecovery.rejectedProviderJobId,httpStatus:409});}
            const retainedReceipt:FalImageProviderReceipt|undefined=activeProviderJobId?{provider:"fal",model:activeProviderModel,providerRequestId:activeProviderJobId,providerStatusUrl:activeProviderStatusUrl,providerResponseUrl:activeProviderResponseUrl,providerCancelUrl:activeProviderCancelUrl}:undefined;
            const imageOptions={onProviderSubmission:(receipt:import("../src/model/provider-submission").PaidProviderSubmission)=>observePaid({...receipt,unitId:`frame:${index+1}`}),quality:"low" as const,size:frameInput.size,ideogramCaptionStrategy:frameInput.ideogramCaptionStrategy,outputFormat:"jpeg" as const,outputCompression:78,signal:execution?.signal,...(retainedReceipt?{providerReceipt:retainedReceipt,providerClientRequestId:providerSubmissions(body as Record<string,unknown>).find((entry)=>entry.provider==="fal"&&entry.providerRequestId===retainedReceipt.providerRequestId)?.clientRequestId}:{}),
              onStage:(stage:string,message:string)=>{if(stage==="provider-submit"){storyboardSubmissionAttempted=true;storyboardProviderSubmission="pending";storyboardProviderRequestedAt=new Date().toISOString();storyboardProviderAcceptedAt="";}return execution?.progress(stage,`Frame ${index+1} · ${message}`,checkpoint());},
              onProviderReceipt:async(receipt:FalImageProviderReceipt)=>{if(storyboardSafeRecovery&&receipt.providerRequestId===storyboardSafeRecovery.rejectedProviderJobId)throw new ProviderRequestError({code:"storyboard_safe_recovery_reused_rejected_request",category:"provider",scope:"request",action:"contact_support",message:"The provider returned the already rejected storyboard request. Automatic recovery stopped without replaying its terminal result.",retryable:false,retryAfterMs:null,requestId:receipt.providerRequestId,httpStatus:409});activeProviderJobId=receipt.providerRequestId;activeProviderModel=receipt.model;activeProviderStatusUrl=receipt.providerStatusUrl;activeProviderResponseUrl=receipt.providerResponseUrl;activeProviderCancelUrl=receipt.providerCancelUrl;storyboardSubmissionAttempted=true;storyboardProviderSubmission="confirmed";storyboardProviderAcceptedAt=storyboardProviderAcceptedAt||new Date().toISOString();await execution?.progress("provider-queued",`Frame ${index+1} · Ideogram accepted the original image request; its provider receipt is safely retained.`,{...checkpoint(),provider:receipt.provider});},
            };
            if(retainedReceipt&&selectImageAdapter(env,imageOptions).provider!=="fal-ideogram")throw new ProviderRequestError({code:"fal_provider_receipt_mismatch",category:"provider",scope:"request",action:"contact_support",message:"The saved storyboard frame belongs to a different image provider. A second paid frame was not submitted.",retryable:false,retryAfterMs:null,requestId:retainedReceipt.providerRequestId,httpStatus:409});
            const image=await generateCreativeImage(env,ownerId,frameInput.snapshot,frameInput.direction,imageOptions);
            const media=await storeGeneratedImage(env,storageOwnerId,`${artifactId}-frame-${index+1}`,image.bytes,image.model,image.mimeType,{artifactRole:"storyboard-frame",artifactId,provider:image.provider,providerRequestId:image.providerRequestId??""});
            const imageAccounting=image as typeof image&{renderingSpeed?:"TURBO"|"BALANCED"|"QUALITY";expansionModel?:"None"|"Medium"|"Large"};
            renderedItems.push({id:`${artifactId}-frame-${index+1}`,title:item.title,media_url:media.url,media_type:media.mimeType,width:image.width,height:image.height,provider:image.provider,provider_request_id:image.providerRequestId,provider_submission_id:image.providerSubmissionId,provider_model:image.model,cost_microusd:image.costBreakdown.totalMicrousd,...(imageAccounting.renderingSpeed?{rendering_speed:imageAccounting.renderingSpeed}:{}),...(imageAccounting.expansionModel?{expansion_model:imageAccounting.expansionModel}:{})});
            modelId=image.model;provider=image.provider;providerJobId=image.providerRequestId??providerJobId;renderLatencyMs+=image.latencyMs;totalTokens+=image.usage.totalTokens;costParts.push(image.costBreakdown);
            storyboardProviderSubmission="cleared";
            await execution?.progress("rendering-frames",`${index+1} of ${plan.items.length} storyboard frames are safely stored.`,{...checkpoint(),provider:image.provider,providerJobId:"",providerModel:"",providerStatusUrl:"",providerResponseUrl:"",providerCancelUrl:"",storyboardProviderRequestedAt:"",storyboardProviderAcceptedAt:""});
            activeProviderJobId="";activeProviderModel="";activeProviderStatusUrl="";activeProviderResponseUrl="";activeProviderCancelUrl="";storyboardProviderRequestedAt="";storyboardProviderAcceptedAt="";storyboardSubmissionAttempted=false;
          }
        }else if(artifactKind==="video"&&productionPlan){
          const managed=await renderManagedVideoProduction(env,storageOwnerId,artifactId,plan,productionPlan,{providerActorId:actorUserId,snapshot:compiledSnapshot,references:preparedVideoReferences,videoSize:body.videoSize==="720x1280"?"720x1280":"1280x720",audioMode:requestedVideoAudioMode,existingItems:renderedItems,existingSceneReceipts:body.productionSceneReceipts,existingAnchor:body.productionAnchor,prepaidSceneIds:[...prepaidSceneIds],prepaidAnchor:body.productionPrepaidAnchor,signal:execution?.signal,onProviderSubmission:observePaid,progress:productionProgress,checkpoint:(checkpoint)=>{if(checkpoint.productionSceneReceipts&&typeof checkpoint.productionSceneReceipts==="object")body.productionSceneReceipts=checkpoint.productionSceneReceipts as Record<string,ProductionSceneReceipt>;if(checkpoint.productionAnchor&&typeof checkpoint.productionAnchor==="object")body.productionAnchor=checkpoint.productionAnchor as Record<string,unknown>;}});
          renderedItems.splice(0,renderedItems.length,...managed.items);costParts.push(...managed.imageCosts);totalTokens+=managed.imageUsage.totalTokens;videoCostMicrousd=managed.videoCostMicrousd;const first=managed.receipts[0];provider="fal";modelId=first?.providerModel??VIDEO_ADAPTER_CONTRACT.model;providerJobId=first?.providerJobId??"";activeProviderJobId=providerJobId;mediaUrl=managed.items[0]?.media_url?String(managed.items[0].media_url):null;mediaType=managed.items[0]?.media_type?String(managed.items[0].media_type):null;productionRenderReceipt={production_mode:"managed",team:productionPlan.team,plan:productionPlan,anchor:managed.anchor,scenes:managed.receipts,assembly:managed.assembly,quality:managed.quality};videoInputReceipt={provider:"fal",model:modelId,production_mode:"managed",reference_inputs:managed.receipts.flatMap((receipt)=>Array.isArray(receipt.videoInputReceipt?.reference_inputs)?receipt.videoInputReceipt.reference_inputs:[]),used_reference_pixels:managed.receipts.some((receipt)=>receipt.videoInputReceipt?.used_reference_pixels===true),scenes:managed.receipts,assembly:managed.assembly};
        }else if(artifactKind==="video"){
          const size=body.videoSize==="720x1280"?"720x1280":"1280x720";
          const retainedReceipt:CreativeVideoPreparedReceipt|undefined=body.providerJobId&&videoInputReceipt?{provider:String(videoInputReceipt.provider??"fal"),model:String(videoInputReceipt.model??activeProviderModel),submittedPrompt:String(videoInputReceipt.submitted_prompt??""),parameters:videoInputReceipt.parameters&&typeof videoInputReceipt.parameters==="object"?videoInputReceipt.parameters as Record<string,unknown>:{},referenceInputs:Array.isArray(videoInputReceipt.reference_inputs)?videoInputReceipt.reference_inputs as Array<Record<string,unknown>>:[],usedReferencePixels:videoInputReceipt.used_reference_pixels===true,...(videoInputReceipt.adaptation?{adaptation:videoInputReceipt.adaptation as CreativeVideoPreparedReceipt["adaptation"]}:{})}:undefined;
          const progressCheckpoint=()=>({artifactId,artifactPlan:plan,providerJobId:activeProviderJobId,providerModel:activeProviderModel,providerStatusUrl:activeProviderStatusUrl,providerResponseUrl:activeProviderResponseUrl,providerCancelUrl:activeProviderCancelUrl,reservationId,costReservationId,costReservationPeriod,costReservationMicrousd,plannerModel,plannerResponseId,plannerLatencyMs,plannerUsage,plannerInput,videoInputReceipt});
          const video=await generateCreativeVideo(env,plan.content_markdown,{
            seconds:requestedVideoSeconds,size,audioMode:requestedVideoAudioMode,snapshot:compiledSnapshot,plan,endUserId:ownerId,providerJobId:body.providerJobId,providerModel:activeProviderModel||undefined,providerStatusUrl:activeProviderStatusUrl||undefined,providerResponseUrl:activeProviderResponseUrl||undefined,providerCancelUrl:activeProviderCancelUrl||undefined,references:preparedVideoReferences,audioReferences:preparedAudioReferences,retainedReceipt,signal:execution?.signal,
            onPrepared:(receipt)=>{const previous=body.providerJobId?videoInputReceipt:null;videoInputReceipt={...(previous??{}),provider:receipt.provider,model:receipt.model,provider_job_id:activeProviderJobId||null,submitted_prompt:previous?.submitted_prompt??receipt.submittedPrompt,parameters:previous?.parameters??receipt.parameters,reference_inputs:previous?.reference_inputs??receipt.referenceInputs,used_reference_pixels:previous?.used_reference_pixels??receipt.usedReferencePixels,adaptation:previous?.adaptation??receipt.adaptation};activeProviderModel=receipt.model;return execution?.progress("preparing-video","The complete visual sequence, audio policy, and provider input are validated and retained before submission.",progressCheckpoint());},
            onStage:(stage,message)=>{if(stage==="submitting")videoSubmissionAttempted=true;return execution?.progress(stage,message,progressCheckpoint());},
            onReceipt:(receipt)=>{activeProviderJobId=receipt.providerJobId;activeProviderModel=receipt.model;activeProviderStatusUrl=receipt.providerStatusUrl;activeProviderResponseUrl=receipt.providerResponseUrl;activeProviderCancelUrl=receipt.providerCancelUrl;if(videoInputReceipt)videoInputReceipt={...videoInputReceipt,provider_job_id:receipt.providerJobId,queue:{status_url:receipt.providerStatusUrl,response_url:receipt.providerResponseUrl,cancel_url:receipt.providerCancelUrl}};return execution?.progress("queued","Video accepted by Fal. It will continue safely if this page closes.",{...progressCheckpoint(),...receipt,providerModel:receipt.model});},
          });
          providerJobId=video.providerJobId;activeProviderJobId=video.providerJobId;activeProviderModel=video.model;activeProviderStatusUrl=video.providerStatusUrl;activeProviderResponseUrl=video.providerResponseUrl;activeProviderCancelUrl=video.providerCancelUrl;provider=video.provider;modelId=video.model;renderLatencyMs=video.latencyMs;videoCostMicrousd=Math.max(0,video.costMicrousd-prepaidProviderCostMicrousd);videoInputReceipt={provider:video.provider,model:video.model,provider_job_id:video.providerJobId,submitted_prompt:video.submittedPrompt,parameters:video.providerParameters,reference_inputs:video.referenceInputs,used_reference_pixels:video.usedReferencePixels,adaptation:video.adaptation,queue:{status_url:video.providerStatusUrl,response_url:video.providerResponseUrl,cancel_url:video.providerCancelUrl}};const media=await storeGeneratedMedia(env,storageOwnerId,artifactId,video.bytes,video.model,video.mimeType,{artifactRole:"document-video",artifactId,providerJobId});mediaUrl=media.url;mediaType=media.mimeType;
        }else if(artifactKind==="audio"){
          const selected=requestedAudioSelection!;
          const adaptation=adaptAudioPrompt(compiledSnapshot,plan,{tone,audience,profile:requestedAudioProfile,model:selected.model});
          if(!adaptation.compilation.valid)throw new ProviderRequestError({code:"audio_prompt_requirements_exceed_provider_limit",category:"provider",scope:"request",action:"edit_request",message:`Required audio direction exceeds ${selected.contract.label}'s supported prompt size. Shorten the locked requirements before starting a paid request.`,retryable:false,retryAfterMs:null,requestId:null,httpStatus:400},adaptation.prompt);
          const retainedReceipt:CreativeAudioPreparedReceipt|undefined=body.providerJobId&&audioInputReceipt?{
            provider:"fal",model:String(audioInputReceipt.model??activeProviderModel??selected.model),submittedPrompt:String(audioInputReceipt.submitted_prompt??""),
            parameters:audioInputReceipt.parameters&&typeof audioInputReceipt.parameters==="object"?audioInputReceipt.parameters as Record<string,unknown>:{},
            imageReference:audioInputReceipt.image_reference&&typeof audioInputReceipt.image_reference==="object"?audioInputReceipt.image_reference as Record<string,unknown>:null,
            ...(audioInputReceipt.video_reference&&typeof audioInputReceipt.video_reference==="object"?{videoReference:audioInputReceipt.video_reference as Record<string,unknown>}:{}),
            sourceAudioTreatment:audioInputReceipt.source_audio_treatment==="authored-description-only"?"authored-description-only":"none",audioWaveformSubmitted:false,
          }:undefined;
          const progressCheckpoint=()=>({artifactId,artifactPlan:plan,providerJobId:activeProviderJobId,providerModel:activeProviderModel||selected.model,providerStatusUrl:activeProviderStatusUrl,providerResponseUrl:activeProviderResponseUrl,providerCancelUrl:activeProviderCancelUrl,reservationId,costReservationId,costReservationPeriod,costReservationMicrousd,audioEstimatedCostMicrousd:selected.estimatedCostMicrousd,plannerModel,plannerResponseId,plannerLatencyMs,plannerUsage,plannerInput,audioInputReceipt});
          const audio=await generateCreativeAudio(env,adaptation.prompt,{
            imageReference:audioImageReference,videoReference:audioVideoReference,profile:requestedAudioProfile,spokenScript:adaptation.spokenScript,voiceDirection:adaptation.voiceDirection,
            estimatedCostMicrousd:selected.estimatedCostMicrousd,sourceAudioBlockIds:adaptation.sourceAudioBlockIds,providerJobId:body.providerJobId,providerModel:activeProviderModel||selected.model,providerStatusUrl:activeProviderStatusUrl||undefined,providerResponseUrl:activeProviderResponseUrl||undefined,providerCancelUrl:activeProviderCancelUrl||undefined,retainedReceipt,signal:execution?.signal,
            onPrepared:(receipt)=>{const previous=body.providerJobId?audioInputReceipt:null;audioInputReceipt={...(previous??{}),provider:receipt.provider,model:receipt.model,provider_job_id:activeProviderJobId||null,submitted_prompt:previous?.submitted_prompt??receipt.submittedPrompt,parameters:previous?.parameters??receipt.parameters,image_reference:previous?.image_reference??receipt.imageReference,...(receipt.videoReference?{video_reference:previous?.video_reference??receipt.videoReference}:{}),source_audio_treatment:receipt.sourceAudioTreatment,audio_waveform_submitted:false,source_audio_block_ids:adaptation.sourceAudioBlockIds,adaptation:{adapter_id:adaptation.adapterId,adapter_version:adaptation.adapterVersion,ordered_cue_count:adaptation.orderedCueCount,prompt_compacted:adaptation.compilation.compacted,omitted_optional_sections:adaptation.compilation.omittedSectionIds}};activeProviderModel=receipt.model;body.audioInputReceipt=audioInputReceipt;return execution?.progress("preparing-audio","The approved audio goal, private source permissions, specialist model, and exact provider input are retained before submission.",progressCheckpoint());},
            onStage:(stage,message)=>{if(stage==="submitting")videoSubmissionAttempted=true;return execution?.progress(stage,message,{...progressCheckpoint(),...(stage==="submitting"?{audioProviderSubmission:"pending"}:{})});},
            onReceipt:(receipt)=>{activeProviderJobId=receipt.providerJobId;activeProviderModel=receipt.model;activeProviderStatusUrl=receipt.providerStatusUrl;activeProviderResponseUrl=receipt.providerResponseUrl;activeProviderCancelUrl=receipt.providerCancelUrl;if(audioInputReceipt)audioInputReceipt={...audioInputReceipt,provider_job_id:receipt.providerJobId,queue:{status_url:receipt.providerStatusUrl,response_url:receipt.providerResponseUrl,cancel_url:receipt.providerCancelUrl}};body.audioInputReceipt=audioInputReceipt??undefined;return execution?.progress("queued",`${selected.contract.label} accepted the audio request. Its original request can safely resume if this page closes.`,{...progressCheckpoint(),...receipt,providerModel:receipt.model,audioProviderSubmission:"confirmed"});},
          });
          providerJobId=audio.providerJobId;activeProviderJobId=audio.providerJobId;activeProviderModel=audio.model;activeProviderStatusUrl=audio.providerStatusUrl;activeProviderResponseUrl=audio.providerResponseUrl;activeProviderCancelUrl=audio.providerCancelUrl;provider=audio.provider;modelId=audio.model;renderLatencyMs=audio.latencyMs;audioCostMicrousd=Math.max(0,audio.costMicrousd-prepaidProviderCostMicrousd);generatedLyrics=audio.lyrics;audioInputReceipt={...audioInputReceipt,provider:audio.provider,model:audio.model,provider_job_id:audio.providerJobId,submitted_prompt:audio.submittedPrompt,parameters:audio.preparedReceipt.parameters,image_reference:audio.preparedReceipt.imageReference,...(audio.preparedReceipt.videoReference?{video_reference:audio.preparedReceipt.videoReference}:{}),source_audio_treatment:audio.preparedReceipt.sourceAudioTreatment,audio_waveform_submitted:false,source_audio_block_ids:adaptation.sourceAudioBlockIds,queue:{status_url:audio.providerStatusUrl,response_url:audio.providerResponseUrl,cancel_url:audio.providerCancelUrl}};
          const media=await storeGeneratedMedia(env,storageOwnerId,artifactId,audio.bytes,audio.model,audio.mimeType,{artifactRole:"document-audio",artifactId,providerJobId,provider:"fal",...(selected.contract.watermark==="synthid"?{watermark:"SynthID-provider-disclosed"}:{})});mediaUrl=media.url;mediaType=media.mimeType;generatedMediaHash=media.contentHash;generatedAudioDuration=media.durationSeconds??(selected.contract.supportsExactDuration||requestedAudioProfile?.goal==="video_sound_effects"?requestedAudioProfile?.durationSeconds??null:null);
        }
        await execution?.beginCommit();
        const evidence=productionPlan?collectProductionEvidence(productionPlan,{artifactId,draft:plan,sourceContract:presentationSourceContract,sceneReceipts:Array.isArray(productionRenderReceipt?.scenes)?productionRenderReceipt.scenes as ProductionSceneReceipt[]:[],...(artifactKind==="audio"?{audioReceipt:{providerJobId,mediaUrl:mediaUrl??undefined,mediaType:mediaType??undefined}}:{}),assemblyComposed:productionRenderReceipt?.assembly&&typeof productionRenderReceipt.assembly==="object"?(productionRenderReceipt.assembly as Record<string,unknown>).composed===true:false}):null;
        const evidenceScore=evidence?scoreProductionEvidence(evidence):null;
        const productionWorkUnits=productionPlan?productionUnitsForPlan(productionPlan,artifactKind==="audio"?{audioEstimatedCostMicrousd:requestedAudioSelection?.estimatedCostMicrousd}:{}):null;
        const planningReceipt=plannerInput as Record<string,unknown>;
        const planningValidation=planningReceipt.validation&&typeof planningReceipt.validation==="object"?planningReceipt.validation as Record<string,unknown>:null;
        const reconciliationEvidence=generationReconciliationEventFields(planningReceipt.adapter_reconciliation??planningValidation?.adapter_reconciliation);
        const inputReceipt={schema_version:1,artifact_id:artifactId,artifact_kind:artifactKind,document_id:projection.documentId,project_id:projection.projectId,captured_at:new Date().toISOString(),request:{item_count:itemCount,...presentationReceipt,...workflowLineage,...sceneReceipt,...(sceneContextContinuity?{scene_context_continuity:sceneContextContinuity}:{}),audience:audience||"general",tone:tone||"document-derived",source_surface:body.sourceSurface??"document",production_mode:productionMode,video_seconds:artifactKind==="video"?(productionPlan?.totalDurationSeconds??requestedVideoSeconds):null,video_size:artifactKind==="video"?body.videoSize??"1280x720":null,video_audio_mode:artifactKind==="video"?requestedVideoAudioMode:null,soundtrack_block_ids:soundtrackBlockIds,soundtrack_provider_transfer:body.sendSoundtrackToVideoProvider===true,audio_image_block_id:artifactKind==="audio"?body.audioImageBlockId??null:null,...(artifactKind==="audio"&&requestedAudioProfile?{audio_profile:requestedAudioProfile,audio_video_artifact_id:body.audioVideoArtifactId??null,audio_video_provider_transfer:body.sendAudioVideoToProvider===true,audio_provider_estimated_cost_microusd:requestedAudioSelection?.estimatedCostMicrousd??0}:{}),estimated_cost_microusd:estimatedCostMicrousd,reserved_cost_microusd:costReservationMicrousd},document_snapshot:compiledSnapshot,planner:{provider:"openai",model:plannerModel,response_id:plannerResponseId,...plannerInput,...sceneReceipt,...(sceneContextContinuity?{scene_context_continuity:sceneContextContinuity}:{}),},render:productionRenderReceipt??audioInputReceipt??videoInputReceipt??(artifactKind==="storyboard"?{provider,model:modelId,items:plan.items.map((item,index)=>({sequence:index+1,title:item.title,direction:item.body,camera_direction:item.notes,frame_prompt:item.image_prompt})),...(storyboardSafeRecovery?{safe_recovery:{rejected_provider_job_id:storyboardSafeRecovery.rejectedProviderJobId,rejected_frame_cost_microusd:rejectedFrameCostMicrousd,rejected_frame_charge_status:"estimated_unconfirmed",replacement_attempt_limit:1,completed_frame_costs_reconstructed:true}}:{})}:{provider:"openai",model:plannerModel}),...(soundtrackAssets.length?{soundtrack_assets:soundtrackAssets}:{}),...(productionPlan?{production:{team:productionPlan.team,system:productionSystemFor(productionPlan.format),work_units:productionWorkUnits,plan:productionPlan,quality:scoreManagedProductionPlan(productionPlan),artifact_evidence:evidence,evidence_score:evidenceScore}}:{})};
        const [stored,inputStored]=await Promise.all([storePrivateContent(env,storageOwnerId,"document-artifact",JSON.stringify(plan)),storePrivateContent(env,ownerId,"document-artifact-input",JSON.stringify(inputReceipt),executionScope)]);
        const providerCosts=providerCostReceipt(costParts);
        const actualCostMicrousd=providerCosts.cost_microusd+videoCostMicrousd+audioCostMicrousd;
        await Promise.all([settleBudget(env,billingOwnerId,reservationId,totalTokens,`document_${artifactKind}_completed`),settleCostBudget(env,billingOwnerId,costReservationId,actualCostMicrousd)]);
        costReservationSettled=true;
        const next=artifactKind==="slides"?0:await streamHead(env,streamId);
        const itemReceipts=plan.items.map((item,index)=>{const rendered=renderedItems[index]??{};return{id:String(rendered.id??`${artifactId}-item-${index+1}`),title:item.title,slide:item.slide??null,context_group_ids:item.context_group_ids??[],media_url:rendered.media_url??null,media_type:rendered.media_type??null,width:rendered.width??null,height:rendered.height??null,...(productionPlan?{scene_id:rendered.scene_id??productionPlan.scenes[index]?.id??null,narrative_order:index+1,generation_order:rendered.generation_order??productionPlan.executionOrder.indexOf(productionPlan.scenes[index]?.id??"")+1,duration_seconds:artifactKind==="video"?productionPlan.scenes[index]?.durationSeconds??null:null}:{})};});
        const publicAudioProfile=requestedAudioProfile?{goal:requestedAudioProfile.goal,role:requestedAudioProfile.role,destination:requestedAudioProfile.destination,...(requestedAudioProfile.durationSeconds?{duration_seconds:requestedAudioProfile.durationSeconds}:{}),...(requestedAudioProfile.speakerCount?{speaker_count:requestedAudioProfile.speakerCount}:{}),...(requestedAudioProfile.requireInstrumental?{prefer_instrumental:true}:{})}:null;
        const retainedAnchor=productionRenderReceipt?.anchor&&typeof productionRenderReceipt.anchor==="object"?productionRenderReceipt.anchor as Record<string,unknown>:null;const productionAssets=retainedAnchor&&typeof retainedAnchor.mediaUrl==="string"&&retainedAnchor.mediaUrl.startsWith("/api/media/")?[{role:"production-continuity-anchor",media_url:retainedAnchor.mediaUrl,media_type:String(retainedAnchor.mediaType??"image/jpeg"),rights_class:"account-generated",scene_id:String(retainedAnchor.sceneId??"")}]:[];
        const completed=makeEvent(streamId,next+1,"worker:renderer",client,corr,"DocumentRenderCompleted",{artifact_id:artifactId,artifact_kind:artifactKind,...reconciliationEvidence,document_id:projection.documentId,project_id:projection.projectId,...workflowLineage,...sceneReceipt,source_block_versions:sourceBlockVersions,requested_by_user_id:executionScope?.actorUserId??ownerId,title:plan.title,summary:plan.summary,content_ref:stored.contentId,content_expires_at:stored.expiresAt,input_ref:inputStored.contentId,input_expires_at:inputStored.expiresAt,item_count:plan.items.length,items:itemReceipts,presentation:plan.presentation??null,media_url:mediaUrl,media_type:mediaType,provider,provider_job_id:providerJobId||null,model_id:modelId,planner_model_id:plannerModel,planner_response_id:plannerResponseId,reference_inputs:videoInputReceipt?.reference_inputs??[...(audioInputReceipt?.image_reference?[audioInputReceipt.image_reference]:[]),...(audioInputReceipt?.video_reference?[audioInputReceipt.video_reference]:[])],used_reference_pixels:videoInputReceipt?.used_reference_pixels===true||Boolean(audioInputReceipt?.image_reference)||Boolean(audioInputReceipt?.video_reference),...(productionAssets.length?{production_assets:productionAssets}:{}),latency_ms:plannerLatencyMs+renderLatencyMs,settings:{item_count:itemCount,...presentationReceipt,...sceneReceipt,...(body.workflowId?{production_workflow:{id:body.workflowId,stage_id:body.workflowStageId,sources:body.workflowSources??[]}}:{}),reserved_cost_microusd:costReservationMicrousd,settled_cost_microusd:actualCostMicrousd,audience:audience||"general",tone:tone||"document-derived",production_mode:productionMode,production_team:productionPlan?.team??null,production_system:productionPlan?productionSystemFor(productionPlan.format):null,production_quality:productionPlan?scoreManagedProductionPlan(productionPlan):null,production_evidence:evidence&&evidenceScore?{basis:evidence.basis,score:evidenceScore.score,measured_weight:evidenceScore.measuredWeight,fully_evaluated:evidenceScore.fullyEvaluated,media_inspected:false}:null,assembly:productionRenderReceipt?.assembly??null,video_seconds:artifactKind==="video"?(productionPlan?.totalDurationSeconds??requestedVideoSeconds):null,video_size:artifactKind==="video"?body.videoSize??"1280x720":null,video_audio_mode:artifactKind==="video"?requestedVideoAudioMode:null,...(soundtrackAssets.length?{soundtrack_assets:soundtrackAssets}:{}),...(artifactKind==="audio"?{audio_provider_model:modelId,audio_role:requestedAudioProfile?.role??"score",audio_goal:requestedAudioProfile?.goal??"music",audio_destination:requestedAudioProfile?.destination??"standalone",audio_profile:publicAudioProfile,audio_synthid_watermarked:requestedAudioSelection?.contract.watermark==="synthid",audio_watermark_basis:requestedAudioSelection?.contract.watermark==="synthid"?"provider-disclosed":null,source_media_sha256:generatedMediaHash,duration_seconds:generatedAudioDuration,lyrics:generatedLyrics,audio_cues:audioContexts(compiledSnapshot,"inform").flatMap((context)=>context.cues)}:{})},source_surface:body.sourceSurface??"document"},{causationId:requestEvent.eventId});
        const usage=makeEvent(streamId,next+2,"worker:policy",client,corr,"GenerationUsageRecorded",{operation:`document-render:${artifactKind}`,artifact_id:artifactId,artifact_kind:artifactKind,document_id:projection.documentId,reservation_id:reservationId,cost_reservation_id:costReservationId,input_tokens:billablePlannerUsage.inputTokens,output_tokens:billablePlannerUsage.outputTokens,total_tokens:totalTokens,planner_tokens:billablePlannerUsage.totalTokens,reserved_tokens:reserved,reserved_microusd:costReservationMicrousd,budget_period:costReservationPeriod,model_ids:[plannerModel,modelId],planner_response_id:plannerResponseId||null,planner_usage_previously_recorded:recordedPlanner.tokensRecorded,planner_cost_previously_recorded:recordedPlanner.costRecorded,provider_job_id:providerJobId||null,production_mode:productionMode,...providerCosts,planner_cost_microusd:plannerCost.totalMicrousd,...(storyboardSafeRecovery?{rejected_frame_cost_microusd:rejectedFrameCostMicrousd,rejected_frame_charge_status:"estimated_unconfirmed",rejected_frame_cost_precision:"conservative-published-rate",rejected_provider_job_id:storyboardSafeRecovery.rejectedProviderJobId}:{}) ,...(artifactKind==="video"?{cost_microusd:actualCostMicrousd,video_cost_microusd:videoCostMicrousd,cost_precision:"provider-token-and-published-video-rate",video_seconds:productionPlan?.totalDurationSeconds??requestedVideoSeconds,scene_count:productionPlan?.scenes.length??1}:artifactKind==="audio"?{cost_microusd:actualCostMicrousd,audio_cost_microusd:audioCostMicrousd,cost_precision:"provider-token-and-published-audio-rate"}:{})},{causationId:completed.eventId});
        await appendEvents(env,[completed,usage]);if(artifactKind!=="video"&&artifactKind!=="audio")await observeProviderSuccess(env);return Response.json({appended:[requestEvent,...(budgeted?[budgeted]:[]),completed,usage],content:{[stored.contentId]:JSON.stringify(plan),[inputStored.contentId]:JSON.stringify(inputReceipt)},artifactId,artifactKind,providerJobId:providerJobId||undefined,provider,head:usage.sequence});
      }catch(error){
        if(execution?.signal.aborted||error instanceof Error&&error.message==="document_job_canceled")throw error;
        if(error instanceof ProviderRequestError&&error.providerCallCount){
          const priorResponseIds=plannerResponseIds;
          const paidResponseIds=[...new Set([...priorResponseIds,...error.providerResponseIds??[]])];
          const unrecordedResponses=(error.providerResponseIds??[]).some((responseId)=>!priorResponseIds.includes(responseId));
          if(unrecordedResponses||!priorResponseIds.length)plannerUsage={inputTokens:plannerUsage.inputTokens+Number(error.providerUsage?.inputTokens??0),outputTokens:plannerUsage.outputTokens+Number(error.providerUsage?.outputTokens??0),totalTokens:plannerUsage.totalTokens+Number(error.providerUsage?.totalTokens??0)};
          plannerModel=error.providerModel??plannerModel;
          plannerResponseId=error.providerResponseIds?.at(-1)??plannerResponseId;
          const previousCallCount=Number((plannerInput as Record<string,unknown>).provider_request_count??((plannerInput as Record<string,unknown>).validation&&typeof (plannerInput as Record<string,unknown>).validation==="object"?((plannerInput as Record<string,unknown>).validation as Record<string,unknown>).provider_call_count:0)??priorResponseIds.length);
          const actualCallCount=Math.max(paidResponseIds.length,Number.isFinite(previousCallCount)?previousCallCount:0,unrecordedResponses?Math.max(0,previousCallCount)+error.providerCallCount:error.providerCallCount);
          plannerInput={...plannerInput,provider_request_count:actualCallCount,validation:{...((plannerInput as Record<string,unknown>).validation&&typeof (plannerInput as Record<string,unknown>).validation==="object"?(plannerInput as Record<string,unknown>).validation as Record<string,unknown>:{}),provider_call_count:actualCallCount}};
          plannerResponseIds=paidResponseIds;
          (body as Record<string,unknown>).plannerResponseIds=paidResponseIds;
          await execution?.progress("planning",`${paidResponseIds.length||error.providerCallCount} paid provider response${(paidResponseIds.length||error.providerCallCount)===1?"":"s"} recorded before generation failed.`,{plannerModel,plannerResponseId,plannerResponseIds:paidResponseIds,plannerUsage,plannerInput,reservationId,costReservationId,costReservationPeriod,costReservationMicrousd,...(productionPlan?{productionPlan}:{}),...(artifactKind==="slides"?{presentationProviderSubmission:"confirmed"}:{})});
        }
        let detail=classifyProviderFailure(error);
        if(artifactKind==="slides"&&presentationSubmissionPending&&definitiveProviderRejection(Number(detail.httpStatus))){await execution?.progress("planning","The presentation provider returned a confirmed rejection.",{reservationId,costReservationId,costReservationPeriod,costReservationMicrousd,presentationProviderSubmission:"confirmed"});presentationSubmissionPending=false;}
        const audioSubmission=artifactKind==="audio"?audioProviderSubmissionState({attempted:videoSubmissionAttempted,providerJobId:activeProviderJobId,httpStatus:detail.httpStatus}):null;
        if(audioSubmission==="rejected")await execution?.progress("planning",`${requestedAudioSelection?.contract.label??"The audio provider"} returned a confirmed rejection before accepting a paid audio request.`,{reservationId,costReservationId,costReservationPeriod,costReservationMicrousd,audioProviderSubmission:"rejected",providerJobId:""});
        const storyboardSubmission=artifactKind==="storyboard"&&!productionPlan&&storyboardProviderSubmission!=="cleared"?audioProviderSubmissionState({attempted:storyboardSubmissionAttempted,providerJobId:activeProviderJobId,httpStatus:detail.httpStatus}):null;
        if(storyboardSubmission==="rejected"){storyboardProviderSubmission="rejected";storyboardSubmissionAttempted=false;await execution?.progress("planning","Ideogram returned a confirmed rejection before accepting a paid storyboard frame.",{reservationId,costReservationId,costReservationPeriod,costReservationMicrousd,storyboardProviderSubmission:"rejected",providerJobId:""});}
        if(storyboardSubmission==="unknown")detail={...detail,code:"provider_submission_uncertain",category:"network",scope:"network",action:"contact_support",message:"The storyboard frame request may already have reached Ideogram, but no durable provider request identifier was returned. Automatic resubmission was stopped to prevent a duplicate charge.",retryable:false,retryAfterMs:null,requestId:null,httpStatus:null};
        else if(storyboardSubmission==="confirmed"&&activeProviderJobId&&!detail.requestId)detail={...detail,requestId:activeProviderJobId};
        if(hasUnresolvedProviderSubmission(body as Record<string,unknown>))detail={...detail,code:"provider_submission_uncertain",category:"network",scope:"network",action:"contact_support",message:"A paid provider request may have been accepted, but its receipt is incomplete. The original reservation is held and automatic resubmission is stopped.",retryable:false,retryAfterMs:null};
        const failedReconciliationEvidence=generationFailureReconciliationEventFields(artifactKind,detail.validationIssues,{adapterId:"openai-document",...(artifactKind==="slides"?{adapterVersion:PRESENTATION_ADAPTER_VERSION}:{})});
        await execution?.beginCommit();if(artifactKind!=="video"&&artifactKind!=="audio")await observeProviderFailure(env,detail);const retainedPrompt=await retainFailurePrompt(env,ownerId,error,executionScope);
        if(hasUnsettledProviderSubmission(body as Record<string,unknown>)||artifactKind==="slides"&&presentationSubmissionPending||artifactKind==="audio"&&audioSubmission==="unknown"||artifactKind==="storyboard"&&(storyboardSubmission==="unknown"||storyboardSubmission==="confirmed")){
          const next=await streamHead(env,streamId);const failed=makeEvent(streamId,next+1,"worker:renderer",client,corr,"DocumentRenderFailed",{artifact_id:artifactId,artifact_kind:artifactKind,...failedReconciliationEvidence,document_id:projection.documentId,provider_job_id:activeProviderJobId||null,provider_charge_status:"unconfirmed",prompt_ref:retainedPrompt?.ref??null,prompt_expires_at:retainedPrompt?.expiresAt??null,source_surface:body.sourceSurface??"document",...failureEventFields(detail)},{causationId:requestEvent.eventId});
          await appendEvents(env,[failed]);
          return Response.json({error:detail.code,errorDetail:publicFailureDetail(detail),moderationPromptRef:retainedPrompt?.ref??null,appended:[requestEvent,...(budgeted?[budgeted]:[]),failed],content:retainedPrompt?{[retainedPrompt.ref]:retainedPrompt.prompt}:undefined,artifactId,artifactKind,...(activeProviderJobId?{providerJobId:activeProviderJobId}:{}),head:failed.sequence},{status:502});
        }
        const expectedPlannerCost=priceTextUsageBreakdownMicrousd(plannerModel,plannerUsage).totalMicrousd;const recordedPlanner=recordedDocumentPlannerUsage(sourceEvents,plannerResponseId,expectedPlannerCost);const failedPlannerCost=remainingDocumentPlannerCost(plannerModel,plannerUsage,recordedPlanner.recordedCostMicrousd);const frameReceipts=Object.values(body.productionFrameReceipts??{});const paidMediaSubmissionUnconfirmed=artifactKind==="video"&&videoSubmissionAttempted||artifactKind==="storyboard"&&storyboardSubmissionAttempted&&detail.httpStatus===null;const failedUsage=interruptedDocumentJobUsage({...body,plannerModel,plannerResponseId,plannerUsage,...(activeProviderJobId||paidMediaSubmissionUnconfirmed?{providerJobId:activeProviderJobId||"submitted"}:{})},{artifactKind,videoSeconds:requestedVideoSeconds},{plannerTokensAlreadyRecorded:recordedPlanner.tokensRecorded,plannerCostAlreadyRecordedMicrousd:recordedPlanner.recordedCostMicrousd});const failedBillableTokens=failedUsage.totalTokens;
        if(failedBillableTokens>0)await settleBudget(env,billingOwnerId,reservationId,failedBillableTokens,`document_${artifactKind}_failed_after_planning`);else await releaseBudget(env,billingOwnerId,reservationId,{reason:`document_${artifactKind}_failed`});
        const productionReceipts=Object.values(body.productionSceneReceipts??{});const failedActualCost=failedUsage.totalCostMicrousd;if(!costReservationSettled){if(failedActualCost>0)await settleCostBudget(env,billingOwnerId,costReservationId,failedActualCost);else await releaseCostBudget(env,billingOwnerId,costReservationId);costReservationSettled=true;}
        const providerChargeStatus=artifactKind!=="storyboard"&&artifactKind!=="video"&&artifactKind!=="audio"?"not_applicable":activeProviderJobId||paidMediaSubmissionUnconfirmed||productionReceipts.some((receipt)=>receipt.status==="submitted"||receipt.status==="completed")?"unconfirmed":"not_submitted";
        const next=await streamHead(env,streamId);const failed=makeEvent(streamId,next+1,"worker:renderer",client,corr,"DocumentRenderFailed",{artifact_id:artifactId,artifact_kind:artifactKind,...failedReconciliationEvidence,document_id:projection.documentId,provider_job_id:activeProviderJobId||null,provider_charge_status:providerChargeStatus,prompt_ref:retainedPrompt?.ref??null,prompt_expires_at:retainedPrompt?.expiresAt??null,source_surface:body.sourceSurface??"document",...failureEventFields(detail)},{causationId:requestEvent.eventId});
        const plannerCharge=(failedBillableTokens>0||failedActualCost>0)?makeEvent(streamId,next+2,"worker:policy",client,corr,"GenerationUsageRecorded",{operation:`document-render:${artifactKind}:failed-plan`,artifact_id:artifactId,artifact_kind:artifactKind,document_id:projection.documentId,reservation_id:reservationId,cost_reservation_id:costReservationId,input_tokens:failedUsage.inputTokens,output_tokens:failedUsage.outputTokens,total_tokens:failedBillableTokens,planner_tokens:failedUsage.plannerUsage.totalTokens,reserved_tokens:reserved,model_ids:[...new Set([plannerModel,...frameReceipts.map((receipt)=>receipt.providerModel)])],planner_response_id:plannerResponseId||null,provider_job_id:activeProviderJobId||null,provider_charge_status:providerChargeStatus,...providerCostReceipt([failedPlannerCost]),cost_microusd:failedActualCost,planner_cost_microusd:Math.min(failedActualCost,failedUsage.plannerCostMicrousd),completed_frame_count:frameReceipts.length},{causationId:failed.eventId}):null;
        const released=makeEvent(streamId,next+(plannerCharge?3:2),"worker:policy",client,corr,"BudgetReleased",{artifact_id:artifactId,artifact_kind:artifactKind,reservation_id:reservationId,reserved_tokens:reserved,used_tokens:failedBillableTokens,released_tokens:Math.max(0,reserved-failedBillableTokens),reason:`document_${artifactKind}_failed`,operation:`document-render:${artifactKind}`},{causationId:plannerCharge?.eventId??failed.eventId});const failureEvents=[failed,...(plannerCharge?[plannerCharge]:[]),released];await appendEvents(env,failureEvents);return Response.json({error:detail.code,errorDetail:publicFailureDetail(detail),moderationPromptRef:retainedPrompt?.ref??null,appended:[requestEvent,...(budgeted?[budgeted]:[]),...failureEvents],content:retainedPrompt?{[retainedPrompt.ref]:retainedPrompt.prompt}:undefined,artifactId,artifactKind,providerJobId:activeProviderJobId||undefined,head:released.sequence},{status:detail.httpStatus===429?429:502});}
    }
    if(body.action==="preview"){
      if(!env.OPENAI_API_KEY)return Response.json({error:"provider_not_configured"},{status:503});
      const promptTechnique=normalizePromptTechnique(body.promptTechnique);const promptFanId=body.promptFanId?String(body.promptFanId):null;
      const sourceEvents=await readEvents(env,streamId);const projection=foldEvents(sourceEvents,Number.POSITIVE_INFINITY,body.documentId);const constraints=standingConstraints(sourceEvents).map(item=>({preference_id:item.preferenceId,axis:item.axis,value:item.value,polarity:item.polarity,authority:"authored",source_event_refs:item.evidenceRefs,source_claim_ref:item.sourceClaimRef??null}));const uploadedReferences=await uploadedPixelReferences(env,storageOwnerId,projection,sourceEvents,body.snapshot);const referenceInputs=referenceInputReceipts(uploadedReferences);const suppliedSnapshot=body.snapshot&&Object.keys(body.snapshot).length?body.snapshot:snapshotForProjection(projection);const managedImage=body.productionMode==="managed"?buildManagedProductionPlan("image",{...suppliedSnapshot,standing_constraints:constraints}):null;const productionFields=managedImageEventFields(managedImage);const compiledSnapshot={...suppliedSnapshot,document:{id:projection.documentId,title:projection.documentTitle},standing_constraints:constraints,reference_inputs:referenceInputs,...(managedImage?{production_brief:managedImageBrief(managedImage)}:{})};const selectedImageFormat=documentImageFormat(compiledSnapshot);const previewRender=providerRenderFormat(selectedImageFormat.format,"preview");const imageFormatFields=imageFormatEventFields(selectedImageFormat.format,"preview",selectedImageFormat.blockId);const contextHash=await creativeContextHash(compiledSnapshot);
      const reserved=24_000;const reservation=await reserveBudget(env,billingOwnerId,reserved,{streamId,correlationId:corr,operation:"image-preview",projectScope:projectBudgetScope});if(!reservation.ok){const denied=makeEvent(streamId,current+1,"worker:policy",client,corr,"BudgetExceeded",{reason:"hard_cap_reached",scope:reservation.scope,reserved_tokens:0,operation:"image-preview"});await insertEvent(env,denied).run();const detail=applicationFailureDetail("budget_hard_cap_reached",reservation.scope,429);return Response.json({error:detail.code,errorDetail:publicFailureDetail(detail),scope:reservation.scope},{status:429});}
      const imageCostReservation=await reserveCostBudget(env,billingOwnerId,1_000_000,{maximumMicrousd:1_000_000,allowUserOverage:false,streamId,correlationId:corr,operation:"image-preview",period:reservation.period,projectScope:projectBudgetScope});if(!imageCostReservation.ok){await releaseBudget(env,billingOwnerId,reservation.reservationId,{reason:"image_preview_cost_cap_reached"});const detail=applicationFailureDetail("budget_hard_cap_reached",imageCostReservation.scope,429);return Response.json({error:detail.code,errorDetail:publicFailureDetail(detail),scope:imageCostReservation.scope},{status:429});}
      const imageSelection=selectImageAdapter(env,{quality:"low",size:previewRender.size,outputFormat:"jpeg",references:uploadedReferences,partialImages:1});const id=uuidV7();const objectId=`draft-${id.slice(-8)}`;const plannerModel=body.directionModel??env.OPENAI_MODEL??"gpt-5.6-terra";const imageModel=imageSelection.model;const adapterVersion=`${imageSelection.adapterId}-${imageSelection.adapterVersion}`;let sequence=current;const registryEvents:EventRow[]=[];
      if(!sourceEvents.some(event=>event.type==="ModelRegistered"&&event.payload.model_id===imageModel))registryEvents.push(makeEvent(streamId,++sequence,"worker:registry",client,corr,"ModelRegistered",{model_id:imageModel,planner_model_id:plannerModel,provider:imageSelection.providerName,status:"human-gated"}));
      if(!sourceEvents.some(event=>event.type==="AdapterVersioned"&&event.payload.adapter_id===imageSelection.adapterId&&event.payload.version===imageSelection.adapterVersion))registryEvents.push(makeEvent(streamId,++sequence,"worker:registry",client,corr,"AdapterVersioned",{adapter_id:imageSelection.adapterId,version:imageSelection.adapterVersion,contract_version:7,selection_reason:imageSelection.reason,reference_handoff:imageSelection.capabilities.includes("reference-pixel-input"),multiple_image_input:imageSelection.capabilities.includes("multiple-image-input"),block_level_reference_policy:true,block_level_image_format:true,streaming_previews:imageSelection.capabilities.includes("streaming-previews"),custom_preview_size:true,compressed_preview_output:true}));
      if(!sourceEvents.some(event=>event.type==="CapabilityDeclared"&&event.payload.model_id===imageModel&&Array.isArray(event.payload.capabilities)&&(event.payload.capabilities as unknown[]).includes("block-level-image-format")))registryEvents.push(makeEvent(streamId,++sequence,"worker:registry",client,corr,"CapabilityDeclared",{model_id:imageModel,capabilities:imageSelection.capabilities}));
      const requestedAt=makeEvent(streamId,++sequence,userActor,client,corr,"GenerationRequested",{generation_id:id,stream_id:streamId,model_ids:[plannerModel,imageModel],document_id:projection.documentId,canvas_id:body.canvasId??null,context_set_id:body.contextSetId??null,document_version:current,requested_output:"image",quality:"low",purpose:"ideate",...imageFormatFields,...productionFields,output_format:"jpeg",output_compression:70,partial_images:1,source_surface:body.sourceSurface??"studio",source_chat_turn_id:body.sourceChatTurnId??null,prompt_technique:promptTechnique,prompt_fan_id:promptFanId,preflight_id:body.preflightId??null,preflight_version:body.preflightVersion??null,preflight_risk_acknowledged:Boolean(body.preflightAcknowledged),reference_input_count:referenceInputs.length,reference_inputs:referenceInputs,used_uploaded_reference_pixels:referenceInputs.length>0});
      const compiled=makeEvent(streamId,++sequence,"worker:compiler",client,corr,"ContextCompiled",{generation_id:id,document_id:projection.documentId,project_id:projection.projectId,canvas_id:body.canvasId??null,context_set_id:body.contextSetId??null,model_id:imageModel,planner_model_id:plannerModel,provider:imageSelection.providerName,adapter_version:adapterVersion,adapter_selection_reason:imageSelection.reason,...imageFormatFields,...productionFields,compiled_snapshot:compiledSnapshot,context_hash:contextHash,source_block_versions:body.sourceBlockVersions??[],quality:"low",purpose:"ideate",source_surface:body.sourceSurface??"studio",source_chat_turn_id:body.sourceChatTurnId??null,prompt_technique:promptTechnique,prompt_fan_id:promptFanId,reference_input_count:referenceInputs.length,reference_inputs:referenceInputs,used_uploaded_reference_pixels:referenceInputs.length>0},{causationId:requestedAt.eventId});
      const budgeted=makeEvent(streamId,++sequence,"worker:policy",client,corr,"BudgetReserved",{generation_id:id,reservation_id:reservation.reservationId,cost_reservation_id:imageCostReservation.reservationId,reserved_tokens:reserved,reserved_microusd:imageCostReservation.reservedMicrousd,period:imageCostReservation.period,operation:"image-preview"},{causationId:requestedAt.eventId});
      await appendEvents(env,[...registryEvents,requestedAt,compiled,budgeted]);
      const observePaid=paidProviderObserver(body as Record<string,unknown>,execution?.progress,{reservationId:reservation.reservationId,costReservationId:imageCostReservation.reservationId,costReservationPeriod:imageCostReservation.period,costReservationMicrousd:imageCostReservation.reservedMicrousd});
      try{
        const privateContent=await loadPrivateContent(env,ownerId,"all",executionScope);let planningSource:"chat"|"cache"|"provider"="provider";let planned:Awaited<ReturnType<typeof generateCreativeDirection>>|null=null;
        if(body.directionRef){const raw=privateContent[body.directionRef];if(raw){try{planned={responseId:"",model:plannerModel,output:JSON.parse(raw) as Record<string,unknown>,raw,latencyMs:0,usage:{inputTokens:0,outputTokens:0,totalTokens:0}};planningSource="chat";}catch{/* Fall through to the normal planner when retained direction data is invalid. */}}}
        if(!planned){const cachedEvent=[...sourceEvents].reverse().find((event)=>event.type==="IdeationPreviewCompleted"&&event.payload.context_hash===contextHash&&String(event.payload.locale??"en").toLowerCase()===String(body.locale??"en").toLowerCase()&&event.payload.planning_source!=="chat"&&event.payload.output_ref);const cachedRaw=cachedEvent?privateContent[String(cachedEvent.payload.output_ref??"")]:undefined;if(cachedRaw){try{planned={responseId:String(cachedEvent?.payload.planner_response_id??""),model:String(cachedEvent?.payload.planner_model_id??plannerModel),output:JSON.parse(cachedRaw) as Record<string,unknown>,raw:cachedRaw,latencyMs:0,usage:{inputTokens:0,outputTokens:0,totalTokens:0}};planningSource="cache";}catch{/* Expired or malformed cached plans are regenerated. */}}}
        if(!await claimCostBudgetReservation(env,billingOwnerId,imageCostReservation.reservationId))return refuseProviderClaim({operation:"image-preview",tokenReservationId:reservation.reservationId,costReservationId:imageCostReservation.reservationId,reservedTokens:reserved,reservedMicrousd:imageCostReservation.reservedMicrousd,causationId:budgeted.eventId});
        if(!planned){await execution?.progress("planning","Turning the document context into a concrete visual direction.");planned=await generateCreativeDirection(env,ownerId,compiledSnapshot,execution?.signal,body.locale,observePaid);}
        else await execution?.progress("planning","Reusing a compatible visual direction from the current document state.");
        const image=await generateCreativeImage(env,ownerId,compiledSnapshot,planned.output,{quality:"low",size:previewRender.size,outputFormat:"jpeg",outputCompression:70,references:uploadedReferences,promptTechnique,partialImages:1,signal:execution?.signal,onProviderSubmission:observePaid,onStage:execution?.progress,onPartial:async(partial)=>{if(execution?.signal.aborted)throw new Error("document_job_canceled");const partialMedia=await storeGeneratedImage(env,storageOwnerId,id,partial.bytes,imageModel,partial.mimeType,{provider:imageSelection.providerName,adapter:adapterVersion});await execution?.progress("rendering","A draft image has arrived; the final draft is still rendering.",{partialMediaUrl:`${partialMedia.url}?partial=${partial.index}`,partialMediaType:partialMedia.mimeType,partialWidth:partial.width,partialHeight:partial.height,partialIndex:partial.index,generationId:id,objectId,quality:"low",promptTechnique,promptFanId});}});await execution?.beginCommit();const media=await storeGeneratedImage(env,storageOwnerId,id,image.bytes,image.model,image.mimeType,{provider:image.provider,adapter:`${image.adapterId}-${image.adapterVersion}`,providerRequestId:image.providerRequestId??""});const stored=planningSource==="chat"&&body.directionRef?{contentId:body.directionRef,expiresAt:null}:await storePrivateContent(env,ownerId,"provider-output",planned.raw,executionScope);const promptStored=await storePrivateContent(env,ownerId,"ideation-prompt",image.prompt,executionScope);const totalTokens=planned.usage.totalTokens+image.usage.totalTokens;await settleBudget(env,billingOwnerId,reservation.reservationId,totalTokens);
        const next=await streamHead(env,streamId);const complete=makeEvent(streamId,next+1,"worker:generator",client,corr,"IdeationPreviewCompleted",{generation_id:id,document_id:projection.documentId,canvas_id:body.canvasId??null,context_set_id:body.contextSetId??null,model_id:image.model,planner_model_id:planned.model,provider:image.provider,provider_request_id:image.providerRequestId,provider_submission_id:image.providerSubmissionId,planner_response_id:planned.responseId,object_id:objectId,object_ids:[objectId],title:String(planned.output.title??projection.documentTitle).trim(),output_ref:stored.contentId,prompt_ref:promptStored.contentId,prompt_technique:promptTechnique,prompt_fan_id:promptFanId,media_url:media.url,media_type:media.mimeType,image_width:image.width,image_height:image.height,quality:"low",purpose:"ideate",...imageFormatFields,...productionFields,output_format:image.outputFormat,output_compression:image.outputCompression,partial_images_requested:1,partial_images_received:image.partialCount,source_surface:body.sourceSurface??"studio",source_chat_turn_id:body.sourceChatTurnId??null,locale:body.locale??"en",context_hash:contextHash,planning_source:planningSource,planning_cache_hit:planningSource==="cache",reference_input_count:referenceInputs.length,reference_inputs:referenceInputs,used_uploaded_reference_pixels:referenceInputs.length>0,latency_ms:planned.latencyMs+image.latencyMs,planning_latency_ms:planned.latencyMs,image_latency_ms:image.latencyMs,adapter_version:`${image.adapterId}-${image.adapterVersion}`,simulation:false},{causationId:compiled.eventId});
        const imageCost=providerCostReceipt([priceTextUsageBreakdownMicrousd(planned.model,planned.usage),image.costBreakdown]);await settleCostBudget(env,billingOwnerId,imageCostReservation.reservationId,imageCost.cost_microusd);const usage=makeEvent(streamId,next+2,"worker:policy",client,corr,"GenerationUsageRecorded",{generation_id:id,document_id:projection.documentId,reservation_id:reservation.reservationId,cost_reservation_id:imageCostReservation.reservationId,...productionFields,input_tokens:planned.usage.inputTokens+image.usage.inputTokens,output_tokens:planned.usage.outputTokens+image.usage.outputTokens,total_tokens:totalTokens,planner_tokens:planned.usage.totalTokens,image_tokens:image.usage.totalTokens,planner_input_tokens:planned.usage.inputTokens,planner_output_tokens:planned.usage.outputTokens,image_text_input_tokens:image.usage.textInputTokens??0,image_input_tokens:image.usage.imageInputTokens??image.usage.inputTokens,image_output_tokens:image.usage.outputTokens,reserved_tokens:reserved,reserved_microusd:imageCostReservation.reservedMicrousd,model_ids:[planned.model,image.model],operation:"image-preview",quality:"low",planning_source:planningSource,partial_images:image.partialCount,image_cost_precision:image.costPrecision,...imageCost},{causationId:complete.eventId});await appendEvents(env,[complete,usage]);await observeProviderSuccess(env);return Response.json({appended:[...registryEvents,requestedAt,compiled,budgeted,complete,usage],content:{[stored.contentId]:planned.raw},rejected:[],head:usage.sequence,simulation:false,quality:"low",planningSource});
      }catch(error){
        if(execution?.signal.aborted||error instanceof Error&&error.message==="document_job_canceled")throw error;
        await execution?.beginCommit();
        let detail=classifyProviderFailure(error);
        if(hasUnresolvedProviderSubmission(body as Record<string,unknown>))detail={...detail,code:"provider_submission_uncertain",category:"network",scope:"network",action:"contact_support",message:"The paid request may already have reached its provider. Its reservation is held; no duplicate request will be submitted automatically.",retryable:false,retryAfterMs:null};
        await observeProviderFailure(env,detail);
        const moderationPrompt=await retainFailurePrompt(env,ownerId,error,executionScope);
        await settleInterruptedDocumentJobReservations(env,{...auth.user,streamId,userId:ownerId,billingUserId:billingOwnerId},{job_id:corr.replace(/:attempt:\d+$/u,""),kind:body.action,stream_id:streamId,document_id:projection.documentId,correlation_id:corr,request_json:JSON.stringify(body),result_json:JSON.stringify(body)},{tokenReservationId:reservation.reservationId,costReservationId:imageCostReservation.reservationId,reason:"preview_failed"});
        const next=await streamHead(env,streamId);
        const failed=makeEvent(streamId,next+1,"worker:generator",client,corr,"GenerationFailed",{generation_id:id,document_id:projection.documentId,canvas_id:body.canvasId??null,context_set_id:body.contextSetId??null,model_id:imageModel,planner_model_id:plannerModel,quality:"low",purpose:"ideate",...imageFormatFields,...productionFields,source_surface:body.sourceSurface??"studio",prompt_ref:moderationPrompt?.ref??null,prompt_expires_at:moderationPrompt?.expiresAt??null,prompt_technique:promptTechnique,prompt_fan_id:promptFanId,...failureEventFields(detail)},{causationId:compiled.eventId});
        await appendEvents(env,[failed]);
        return Response.json({error:detail.code,errorDetail:publicFailureDetail(detail),moderationPromptRef:moderationPrompt?.ref??null,appended:[...registryEvents,requestedAt,compiled,budgeted,failed],content:moderationPrompt?{[moderationPrompt.ref]:moderationPrompt.prompt}:undefined,head:failed.sequence},{status:detail.httpStatus===429?429:502});
      }
    }
    if(body.action==="generate"){
      if(!env.OPENAI_API_KEY)return Response.json({error:"provider_not_configured"},{status:503});
      const promptTechnique=normalizePromptTechnique(body.promptTechnique);const promptFanId=body.promptFanId?String(body.promptFanId):null;
      const sourceEvents=await readEvents(env,streamId);const projection=foldEvents(sourceEvents,Number.POSITIVE_INFINITY,body.documentId);const constraints=standingConstraints(sourceEvents).map(item=>({preference_id:item.preferenceId,axis:item.axis,value:item.value,polarity:item.polarity,authority:"authored",source_event_refs:item.evidenceRefs,source_claim_ref:item.sourceClaimRef??null}));const uploadedReferences=await uploadedPixelReferences(env,storageOwnerId,projection,sourceEvents,body.snapshot);
      const reserved=32_000;const reservation=await reserveBudget(env,billingOwnerId,reserved,{streamId,correlationId:corr,operation:"image-generation",projectScope:projectBudgetScope});if(!reservation.ok){const denied=makeEvent(streamId,current+1,"worker:policy",client,corr,"BudgetExceeded",{reason:"hard_cap_reached",scope:reservation.scope,reserved_tokens:0,operation:"image-generation"});await insertEvent(env,denied).run();const detail=applicationFailureDetail("budget_hard_cap_reached",reservation.scope,429);return Response.json({error:detail.code,errorDetail:publicFailureDetail(detail),scope:reservation.scope},{status:429});}
      const imageCostReservation=await reserveCostBudget(env,billingOwnerId,1_000_000,{maximumMicrousd:1_000_000,allowUserOverage:false,streamId,correlationId:corr,operation:"image-generation",period:reservation.period,projectScope:projectBudgetScope});if(!imageCostReservation.ok){await releaseBudget(env,billingOwnerId,reservation.reservationId,{reason:"image_generation_cost_cap_reached"});const detail=applicationFailureDetail("budget_hard_cap_reached",imageCostReservation.scope,429);return Response.json({error:detail.code,errorDetail:publicFailureDetail(detail),scope:imageCostReservation.scope},{status:429});}
      const id=uuidV7();const plannerModel=env.OPENAI_MODEL??"gpt-5.6-terra";
      let sequence=current;const registryEvents:EventRow[]=[];
      const selectedPreview=body.sourcePreviewId?[...sourceEvents].reverse().find((event)=>event.type==="IdeationPreviewCompleted"&&String(event.payload.document_id??"")===projection.documentId&&previewObjectId(event)===body.sourcePreviewId):undefined;const previewImage=selectedPreview?await readGeneratedImageReference(env,storageOwnerId,selectedPreview.payload.media_url):null;const previewReference:ImageReference|null=previewImage?{...previewImage,label:"Selected ideation preview",source:"ideation-preview"}:null;const imageReferences=[...(previewReference?[previewReference]:[]),...uploadedReferences];const referenceInputs=referenceInputReceipts(imageReferences);const imageSnapshot=body.snapshot??snapshotForProjection(projection);const managedImage=body.productionMode==="managed"?buildManagedProductionPlan("image",{...imageSnapshot,standing_constraints:constraints}):null;const productionFields=managedImageEventFields(managedImage);const compiledSnapshot={...imageSnapshot,document:{id:projection.documentId,title:projection.documentTitle},standing_constraints:constraints,reference_inputs:referenceInputs,...(managedImage?{production_brief:managedImageBrief(managedImage)}:{})};const selectedImageFormat=documentImageFormat(compiledSnapshot);const fullRender=providerRenderFormat(selectedImageFormat.format,"full");const imageFormatFields=imageFormatEventFields(selectedImageFormat.format,"full",selectedImageFormat.blockId);const contextHash=await creativeContextHash(compiledSnapshot);const imageSelection=selectImageAdapter(env,{quality:"high",size:fullRender.size,references:imageReferences,promptTechnique});const imageModel=imageSelection.model;const adapterVersion=`${imageSelection.adapterId}-${imageSelection.adapterVersion}`;if(!sourceEvents.some(event=>event.type==="ModelRegistered"&&event.payload.model_id===imageModel))registryEvents.push(makeEvent(streamId,++sequence,"worker:registry",client,corr,"ModelRegistered",{model_id:imageModel,planner_model_id:plannerModel,provider:imageSelection.providerName,status:"human-gated"}));if(!sourceEvents.some(event=>event.type==="AdapterVersioned"&&event.payload.adapter_id===imageSelection.adapterId&&event.payload.version===imageSelection.adapterVersion))registryEvents.push(makeEvent(streamId,++sequence,"worker:registry",client,corr,"AdapterVersioned",{adapter_id:imageSelection.adapterId,version:imageSelection.adapterVersion,contract_version:7,selection_reason:imageSelection.reason,reference_handoff:imageSelection.capabilities.includes("reference-pixel-input"),multiple_image_input:imageSelection.capabilities.includes("multiple-image-input"),block_level_reference_policy:true,block_level_image_format:true,streaming_previews:imageSelection.capabilities.includes("streaming-previews")}));if(!sourceEvents.some(event=>event.type==="CapabilityDeclared"&&event.payload.model_id===imageModel&&Array.isArray(event.payload.capabilities)&&(event.payload.capabilities as unknown[]).includes("block-level-image-format")))registryEvents.push(makeEvent(streamId,++sequence,"worker:registry",client,corr,"CapabilityDeclared",{model_id:imageModel,capabilities:imageSelection.capabilities}));const priorFanPromotion=promptFanId?[...sourceEvents].reverse().find((event)=>event.type==="IdeationPromoted"&&event.payload.prompt_fan_id===promptFanId):undefined;const promotionId=selectedPreview?(priorFanPromotion?String(priorFanPromotion.payload.promotion_id):uuidV7()):null;const promotionEvents:EventRow[]=[];
      if(selectedPreview&&!priorFanPromotion){const intervening=sourceEvents.filter((event)=>event.sequence>selectedPreview.sequence);const changes=intervening.filter((event)=>/^(BlockCreated|BlockPropertyEdited|BlockWeightSet|BlockRemoved|BlockRestored|ChipEdited|ExtractionCompleted)$/.test(event.type));promotionEvents.push(makeEvent(streamId,++sequence,userActor,client,corr,"IdeationPromoted",{promotion_id:promotionId,document_id:projection.documentId,draft_event_id:selectedPreview.eventId,draft_sequence:selectedPreview.sequence,draft_generation_id:String(selectedPreview.payload.generation_id??""),draft_object_id:previewObjectId(selectedPreview),full_generation_id:id,source_surface:body.sourceSurface??"studio",prompt_fan_id:promptFanId,elapsed_to_intent_ms:Math.max(0,Date.now()-Date.parse(selectedPreview.occurredAt)),intervening_event_count:Math.max(0,current-selectedPreview.sequence),document_change_count:changes.length,conversation_turn_count:intervening.filter((event)=>event.type==="ChatMessageSent").length,context_changed:changes.length>0,intent_weight:1,system_success_pending:true}));}
      const workflowLineage=body.workflowId&&body.workflowStageId?{workflow_id:body.workflowId,workflow_stage_id:body.workflowStageId,workflow_sources:body.workflowSources??[]} : {};
      const requestedAt=makeEvent(streamId,++sequence,userActor,client,corr,"GenerationRequested",{generation_id:id,stream_id:streamId,model_ids:[plannerModel,imageModel],document_id:projection.documentId,...workflowLineage,canvas_id:body.canvasId??null,context_set_id:body.contextSetId??null,document_version:current,requested_output:"image",quality:"high",purpose:"final",...imageFormatFields,...productionFields,source_surface:body.sourceSurface??"studio",promotion_id:promotionId,reference_preview_event_id:selectedPreview?.eventId??null,prompt_technique:promptTechnique,prompt_fan_id:promptFanId,preflight_id:body.preflightId??null,preflight_version:body.preflightVersion??null,preflight_risk_acknowledged:Boolean(body.preflightAcknowledged),reference_input_count:referenceInputs.length,reference_inputs:referenceInputs,used_ideation_preview_pixels:Boolean(previewReference),used_uploaded_reference_pixels:uploadedReferences.length>0},{causationId:promotionEvents[0]?.eventId??priorFanPromotion?.eventId??null});
      const compiled=makeEvent(streamId,++sequence,"worker:compiler",client,corr,"ContextCompiled",{generation_id:id,document_id:projection.documentId,project_id:projection.projectId,...workflowLineage,canvas_id:body.canvasId??null,context_set_id:body.contextSetId??null,model_id:imageModel,planner_model_id:plannerModel,provider:imageSelection.providerName,adapter_version:adapterVersion,adapter_selection_reason:imageSelection.reason,...imageFormatFields,...productionFields,compiled_snapshot:compiledSnapshot,context_hash:contextHash,source_block_versions:body.sourceBlockVersions??[],quality:"high",purpose:"final",source_surface:body.sourceSurface??"studio",promotion_id:promotionId,reference_preview_event_id:selectedPreview?.eventId??null,prompt_technique:promptTechnique,prompt_fan_id:promptFanId,reference_input_count:referenceInputs.length,reference_inputs:referenceInputs,used_ideation_preview_pixels:Boolean(previewReference),used_uploaded_reference_pixels:uploadedReferences.length>0},{causationId:requestedAt.eventId});
      const budgeted=makeEvent(streamId,++sequence,"worker:policy",client,corr,"BudgetReserved",{generation_id:id,reservation_id:reservation.reservationId,cost_reservation_id:imageCostReservation.reservationId,reserved_tokens:reserved,reserved_microusd:imageCostReservation.reservedMicrousd,period:imageCostReservation.period,operation:"image-generation"},{causationId:requestedAt.eventId});
      await appendEvents(env,[...registryEvents,...promotionEvents,requestedAt,compiled,budgeted]);
      const observePaid=paidProviderObserver(body as Record<string,unknown>,execution?.progress,{reservationId:reservation.reservationId,costReservationId:imageCostReservation.reservationId,costReservationPeriod:imageCostReservation.period,costReservationMicrousd:imageCostReservation.reservedMicrousd});
      try{
        if(selectedPreview&&!previewReference)throw new Error("selected_preview_unavailable");
        const privateContent=await loadPrivateContent(env,ownerId,"all",executionScope);const cachedFanEvent=promptFanId?[...sourceEvents].reverse().find((event)=>event.type==="GenerationCompleted"&&event.payload.prompt_fan_id===promptFanId&&event.payload.output_ref):undefined;const cachedFanRaw=cachedFanEvent?privateContent[String(cachedFanEvent.payload.output_ref??"")]:undefined;let planned:Awaited<ReturnType<typeof generateCreativeDirection>>;let planningSource:"fan-cache"|"provider"="provider";await execution?.progress("planning",cachedFanRaw?"Checking the fan for a reusable visual direction.":"Turning the document context into a concrete visual direction.");if(!await claimCostBudgetReservation(env,billingOwnerId,imageCostReservation.reservationId))return refuseProviderClaim({operation:"image-generation",tokenReservationId:reservation.reservationId,costReservationId:imageCostReservation.reservationId,reservedTokens:reserved,reservedMicrousd:imageCostReservation.reservedMicrousd,causationId:budgeted.eventId});if(cachedFanRaw){try{planned={responseId:String(cachedFanEvent?.payload.planner_response_id??""),model:String(cachedFanEvent?.payload.planner_model_id??plannerModel),output:JSON.parse(cachedFanRaw) as Record<string,unknown>,raw:cachedFanRaw,latencyMs:0,usage:{inputTokens:0,outputTokens:0,totalTokens:0}};planningSource="fan-cache";}catch{planned=await generateCreativeDirection(env,ownerId,compiledSnapshot,execution?.signal,body.locale,observePaid);}}else planned=await generateCreativeDirection(env,ownerId,compiledSnapshot,execution?.signal,body.locale,observePaid);const image=await generateCreativeImage(env,ownerId,compiledSnapshot,planned.output,{quality:"high",size:fullRender.size,references:imageReferences,promptTechnique,signal:execution?.signal,onProviderSubmission:observePaid,onStage:execution?.progress});await execution?.beginCommit();const media=await storeGeneratedImage(env,storageOwnerId,id,image.bytes,image.model,image.mimeType,{provider:image.provider,adapter:`${image.adapterId}-${image.adapterVersion}`,providerRequestId:image.providerRequestId??""});
        const stored=await storePrivateContent(env,ownerId,"provider-output",planned.raw,executionScope);const promptStored=await storePrivateContent(env,ownerId,"prompt",image.prompt,executionScope);const totalTokens=planned.usage.totalTokens+image.usage.totalTokens;await settleBudget(env,billingOwnerId,reservation.reservationId,totalTokens);
        const next=await streamHead(env,streamId);const generatedObjectId=`object-${id.slice(-8)}`;const complete=makeEvent(streamId,next+1,"worker:generator",client,corr,"GenerationCompleted",{generation_id:id,document_id:projection.documentId,...workflowLineage,canvas_id:body.canvasId??null,context_set_id:body.contextSetId??null,model_id:image.model,planner_model_id:planned.model,provider:image.provider,provider_request_id:image.providerRequestId,provider_submission_id:image.providerSubmissionId,planner_response_id:planned.responseId,provider_created_at:image.createdAt,object_id:generatedObjectId,object_ids:[generatedObjectId],title:String(planned.output.title??projection.documentTitle).trim(),output_ref:stored.contentId,prompt_ref:promptStored.contentId,prompt_technique:promptTechnique,prompt_fan_id:promptFanId,content_expires_at:stored.expiresAt,media_url:media.url,media_type:media.mimeType,image_width:image.width,image_height:image.height,quality:"high",purpose:"final",...imageFormatFields,...productionFields,source_surface:body.sourceSurface??"studio",promotion_id:promotionId,reference_preview_event_id:selectedPreview?.eventId??null,promoted_from_generation_id:selectedPreview?String(selectedPreview.payload.generation_id??""):null,promoted_from_object_id:selectedPreview?previewObjectId(selectedPreview):null,promotion_outcome:promotionId?"completed":null,context_hash:contextHash,planning_source:planningSource,planning_cache_hit:planningSource==="fan-cache",reference_input_count:referenceInputs.length,reference_inputs:referenceInputs,used_ideation_preview_pixels:Boolean(previewReference),used_uploaded_reference_pixels:uploadedReferences.length>0,latency_ms:planned.latencyMs+image.latencyMs,planning_latency_ms:planned.latencyMs,image_latency_ms:image.latencyMs,adapter_version:`${image.adapterId}-${image.adapterVersion}`,simulation:false},{causationId:compiled.eventId});
        const imageCost=providerCostReceipt([priceTextUsageBreakdownMicrousd(planned.model,planned.usage),image.costBreakdown]);await settleCostBudget(env,billingOwnerId,imageCostReservation.reservationId,imageCost.cost_microusd);const usage=makeEvent(streamId,next+2,"worker:policy",client,corr,"GenerationUsageRecorded",{generation_id:id,document_id:projection.documentId,reservation_id:reservation.reservationId,cost_reservation_id:imageCostReservation.reservationId,...productionFields,input_tokens:planned.usage.inputTokens+image.usage.inputTokens,output_tokens:planned.usage.outputTokens+image.usage.outputTokens,total_tokens:totalTokens,planner_tokens:planned.usage.totalTokens,image_tokens:image.usage.totalTokens,planner_input_tokens:planned.usage.inputTokens,planner_output_tokens:planned.usage.outputTokens,image_text_input_tokens:image.usage.textInputTokens??0,image_input_tokens:image.usage.imageInputTokens??image.usage.inputTokens,image_output_tokens:image.usage.outputTokens,reserved_tokens:reserved,reserved_microusd:imageCostReservation.reservedMicrousd,model_ids:[planned.model,image.model],operation:"image-generation",quality:"high",promotion_id:promotionId,image_cost_precision:image.costPrecision,...imageCost},{causationId:complete.eventId});await appendEvents(env,[complete,usage]);await observeProviderSuccess(env);return Response.json({appended:[...registryEvents,...promotionEvents,requestedAt,compiled,budgeted,complete,usage],content:{[stored.contentId]:planned.raw},rejected:[],head:usage.sequence,simulation:false,promoted:Boolean(promotionId)});
      }catch(error){
        if(execution?.signal.aborted||error instanceof Error&&error.message==="document_job_canceled")throw error;
        await execution?.beginCommit();
        let detail=classifyProviderFailure(error);
        if(hasUnresolvedProviderSubmission(body as Record<string,unknown>))detail={...detail,code:"provider_submission_uncertain",category:"network",scope:"network",action:"contact_support",message:"The paid request may already have reached its provider. Its reservation is held; no duplicate request will be submitted automatically.",retryable:false,retryAfterMs:null};
        await observeProviderFailure(env,detail);
        const moderationPrompt=await retainFailurePrompt(env,ownerId,error,executionScope);
        await settleInterruptedDocumentJobReservations(env,{...auth.user,streamId,userId:ownerId,billingUserId:billingOwnerId},{job_id:corr.replace(/:attempt:\d+$/u,""),kind:body.action,stream_id:streamId,document_id:projection.documentId,correlation_id:corr,request_json:JSON.stringify(body),result_json:JSON.stringify(body)},{tokenReservationId:reservation.reservationId,costReservationId:imageCostReservation.reservationId,reason:"generation_failed"});
        const next=await streamHead(env,streamId);
        const failed=makeEvent(streamId,next+1,"worker:generator",client,corr,"GenerationFailed",{generation_id:id,document_id:projection.documentId,canvas_id:body.canvasId??null,context_set_id:body.contextSetId??null,model_id:imageModel,planner_model_id:plannerModel,quality:"high",purpose:"final",...imageFormatFields,...productionFields,source_surface:body.sourceSurface??"studio",promotion_id:promotionId,promotion_outcome:promotionId?"failed":null,prompt_ref:moderationPrompt?.ref??null,prompt_expires_at:moderationPrompt?.expiresAt??null,prompt_technique:promptTechnique,prompt_fan_id:promptFanId,...failureEventFields(detail)},{causationId:compiled.eventId});
        await appendEvents(env,[failed]);
        return Response.json({error:detail.code,errorDetail:publicFailureDetail(detail),moderationPromptRef:moderationPrompt?.ref??null,appended:[...registryEvents,...promotionEvents,requestedAt,compiled,budgeted,failed],content:moderationPrompt?{[moderationPrompt.ref]:moderationPrompt.prompt}:undefined,head:failed.sequence,promoted:Boolean(promotionId)},{status:detail.httpStatus===429?429:502});
      }
    }
    if(body.action==="evaluate_extractors"){
      if(auth.user.role!=="admin")return Response.json({error:"admin_required"},{status:403});
      const report=runExtractorEvaluation();
      const completed=makeEvent(streamId,current+1,"worker:extractor",client,corr,"ExtractorEvaluationCompleted",{...report,evaluated_at:new Date().toISOString(),gate:"phase-3-a5"});
      await insertEvent(env,completed).run();return Response.json({appended:[completed],rejected:[],head:completed.sequence,report});
    }
    if(body.action==="rebuild_index"){
      if(auth.user.role!=="admin")return Response.json({error:"admin_required"},{status:403});
      const events=await readEvents(env,streamId);const report=buildPhase7Index(events,await loadPrivateContent(env,ownerId,"all",executionScope));
      const signatures=new Set(events.filter(event=>event.type==="FamilyDeclared").map(event=>String(event.payload.index_signature??"")));
      const corrected=new Set(events.filter(event=>event.type==="ClaimSuperseded").map(event=>String(event.payload.claim_ref??"")));
      const appended:EventRow[]=[];let sequence=current;
      for(const family of report.families.filter(item=>!signatures.has(item.indexSignature))){
        const declared=makeEvent(streamId,++sequence,"worker:indexer",client,corr,"FamilyDeclared",{family_id:family.familyId,label:family.label,confidence:family.confidence,evidence_refs:family.evidenceRefs,embedding_model_id:report.embeddingModelId,embedding_version:report.embeddingVersion,source_head:family.sourceHead,index_signature:family.indexSignature});appended.push(declared);
        appended.push(makeEvent(streamId,++sequence,"worker:indexer",client,corr,"FamilyAnchorSet",{family_id:family.familyId,object_id:family.anchorObjectId,evidence_refs:family.evidenceRefs.slice(0,4),index_signature:family.indexSignature},{causationId:declared.eventId}));
        for(const member of family.members.filter(item=>!corrected.has(item.claimRef)))appended.push(makeEvent(streamId,++sequence,"worker:indexer",client,corr,"FamilyMembershipAsserted",{family_id:family.familyId,object_id:member.objectId,confidence:member.confidence,evidence_refs:member.evidenceRefs,claim_ref:member.claimRef,index_signature:family.indexSignature},{causationId:declared.eventId}));
      }
      if(appended.length)await env.DB.batch(appended.map(event=>insertEvent(env,event)));return Response.json({appended,rejected:[],head:sequence,report:{embeddingModelId:report.embeddingModelId,embeddingVersion:report.embeddingVersion,sourceHead:report.sourceHead,indexedItems:report.items.length,exemplars:report.exemplars.length,families:report.families.length}});
    }
    if(body.action==="extract_reference"){
      if(!body.blockId||!body.referenceId||!body.sample)return Response.json({error:"block_reference_and_sample_required"},{status:400});
      const facts=analyzeImageSample(body.sample);
      const focalPoint=calculateImageFocalPoint(body.sample);
      const findingKinds=Array.isArray(body.findingKinds)?body.findingKinds:[];
      const requestedAt=makeEvent(streamId,current+1,userActor,client,corr,"ExtractionRequested",{block_id:body.blockId,reference_id:body.referenceId,extractors:["dimensions-v1","palette-kmeans-v1","dominant-edges-v1","image-character-v1"],requested_findings:findingKinds});
      const completed=makeEvent(streamId,current+2,"worker:extractor",client,corr,"ExtractionCompleted",{block_id:body.blockId,reference_id:body.referenceId,extractor_name:"deterministic-image-suite-v2",extractor_versions:["dimensions-v1","palette-kmeans-v1","dominant-edges-v1","image-character-v1"],chips:[{chip_id:`chip-${body.blockId}-dimensions`,property:"dimensions",value:facts.dimensions,confidence:facts.confidence.dimensions},{chip_id:`chip-${body.blockId}-palette`,property:"colors",value:facts.palette,confidence:facts.confidence.palette},{chip_id:`chip-${body.blockId}-edges`,property:"dominant_edges",value:facts.dominantEdges,confidence:facts.confidence.dominantEdges},{chip_id:`chip-${body.blockId}-findings`,property:"reference_findings",value:facts.findings,confidence:facts.confidence.findings}],overall_confidence:facts.confidence.overall,sample_grid:{width:body.sample.gridWidth,height:body.sample.gridHeight},requested_findings:findingKinds},{causationId:requestedAt.eventId});
      const focal=makeEvent(streamId,current+3,"worker:extractor",client,corr,"ImageFocalPointCalculated",{target_kind:"reference",target_id:body.blockId,block_id:body.blockId,reference_id:body.referenceId,document_id:body.documentId??foldEvents(await readEvents(env,streamId)).documentId,focal_point:focalPoint,sample_grid:{width:body.sample.gridWidth,height:body.sample.gridHeight},extractor_name:CURRENT_FOCAL_POINT_METHOD,cost_class:"local-free"},{causationId:completed.eventId});
      await execution?.beginCommit();
      await env.DB.batch([requestedAt,completed,focal].map(event=>insertEvent(env,event)));return Response.json({appended:[requestedAt,completed,focal],rejected:[],head:focal.sequence});
    }
    if(body.action==="calculate_focal_point"){
      if(!body.targetKind||!body.targetId||!body.mediaUrl||!body.sample)return Response.json({error:"focal_target_media_and_sample_required"},{status:400});
      const events=await readEvents(env,streamId);const projection=foldEvents(events);let blockId:string|null=null;let referenceId:string|null=null;let documentId="";let causationId:string|null=null;
      if(body.targetKind==="generation"){
        const output=projection.libraryOutputs.find((item)=>item.id===body.targetId);if(!output||output.mediaUrl!==body.mediaUrl)return Response.json({error:"generation_media_target_not_found"},{status:404});documentId=output.documentId;causationId=output.sourceEventId;
      }else if(body.targetKind==="artifact"){
        const artifact=projection.libraryArtifacts.find((candidate)=>candidate.items.some((item)=>item.id===body.targetId&&item.mediaUrl===body.mediaUrl));const item=artifact?.items.find((candidate)=>candidate.id===body.targetId);if(!artifact||!item)return Response.json({error:"artifact_media_target_not_found"},{status:404});documentId=artifact.documentId;causationId=artifact.sourceEventId;
      }else{
        const block=projection.libraryBlocks.find((item)=>item.id===body.targetId&&item.type==="reference");if(!block||String(block.properties.media_url??"")!==body.mediaUrl)return Response.json({error:"reference_media_target_not_found"},{status:404});blockId=block.id;referenceId=String(block.properties.reference_id??body.referenceId??"")||null;documentId=block.documentId;causationId=block.sourceEvents.at(-1)??null;
      }
      const existing=events.findLast((event)=>event.type==="ImageFocalPointCalculated"&&event.payload.target_kind===body.targetKind&&String(event.payload.target_id??"")===body.targetId&&String(event.payload.media_url??body.mediaUrl)===body.mediaUrl&&(event.payload.focal_point as {method?:unknown}|undefined)?.method===CURRENT_FOCAL_POINT_METHOD);
      if(existing)return Response.json({appended:[],rejected:[],head:current,focalPoint:existing.payload.focal_point,cached:true});
      const focalPoint=calculateImageFocalPoint(body.sample);const focal=makeEvent(streamId,current+1,"worker:extractor",client,corr,"ImageFocalPointCalculated",{target_kind:body.targetKind,target_id:body.targetId,block_id:blockId,reference_id:referenceId,document_id:documentId,media_url:body.mediaUrl,focal_point:focalPoint,sample_grid:{width:body.sample.gridWidth,height:body.sample.gridHeight},extractor_name:CURRENT_FOCAL_POINT_METHOD,cost_class:"local-free"},{causationId});
      await insertEvent(env,focal).run();return Response.json({appended:[focal],rejected:[],head:focal.sequence,focalPoint,cached:false});
    }
    if(body.action==="close_session"){
      const events=await readEvents(env,streamId);const projection=foldEvents(events);
      if(!projection.sessionOpen)return Response.json({error:"no_open_session"},{status:409});
      const workflow=documentViewWorkflow(events,projection.documentId);const closed=makeEvent(streamId,current+1,userActor,client,corr,"SessionClosed",{session_id:projection.currentSessionId,snapshot_ref:{head:current,project_id:projection.projectId,document_id:projection.documentId,document_view:workflow.lastView?.view??"document",view_usage:{preferred:workflow.preferredView?.view??null,last:workflow.lastView?.view??null,used:workflow.rows.filter(row=>row.visits||row.edits||row.generationRequests||row.outcomes).map(row=>row.view),transitions:workflow.transitions},block_versions:projection.blocks.map(block=>({block_id:block.id,version:block.sourceEvents.length})),output_ids:projection.outputs.map(output=>output.id),collection_ids:projection.collections.map(collection=>collection.id)}});
      await insertEvent(env,closed).run();return Response.json({appended:[closed],rejected:[],head:closed.sequence,eligibility:briefEligibility([...events,closed])});
    }
    if(body.action==="open_session"){
      const events=await readEvents(env,streamId);const projection=foldEvents(events);
      if(projection.sessionOpen)return Response.json({error:"session_already_open"},{status:409});
      const sessionId=uuidV7();const opened=makeEvent(streamId,current+1,userActor,client,corr,"SessionOpened",{session_id:sessionId,snapshot_ref:projection.lastSession?.snapshot_ref??null});const streamWithOpen=[...events,opened];const briefId=uuidV7();const composition=composeReentryBrief(streamWithOpen,briefId);const appended:EventRow[]=[opened];
      if(composition.eligible&&composition.payload){const brief=makeEvent(streamId,current+2,"worker:brief",client,corr,"BriefComposed",composition.payload,{causationId:opened.eventId});appended.push(brief);for(const item of composition.payload.items){appended.push(makeEvent(streamId,current+appended.length+1,userActor,client,corr,"BriefItemPresented",{brief_id:briefId,item_id:item.item_id,rank:item.rank,brief_size:composition.payload.items.length,presentation_mode:"rendered-or-reading-order",destination:item.destination,document_view:item.destination.document_view??null},{causationId:brief.eventId}));}}
      await env.DB.batch(appended.map(event=>insertEvent(env,event)));return Response.json({appended,rejected:[],head:appended.at(-1)?.sequence??current,eligibility:composition.eligibility,briefComposed:composition.eligible});
    }
    if(body.action==="compose_brief"){
      const events=await readEvents(env,streamId);const projection=foldEvents(events);if(!projection.sessionOpen)return Response.json({error:"open_session_required"},{status:409});const briefId=uuidV7();const composition=composeReentryBrief(events,briefId);if(!composition.eligible||!composition.payload)return Response.json({error:"brief_not_eligible",eligibility:composition.eligibility},{status:409});
      const brief=makeEvent(streamId,current+1,"worker:brief",client,corr,"BriefComposed",composition.payload);const appended:EventRow[]=[brief];for(const item of composition.payload.items)appended.push(makeEvent(streamId,current+appended.length+1,userActor,client,corr,"BriefItemPresented",{brief_id:briefId,item_id:item.item_id,rank:item.rank,brief_size:composition.payload.items.length,presentation_mode:"rendered-or-reading-order",destination:item.destination,document_view:item.destination.document_view??null},{causationId:brief.eventId}));await env.DB.batch(appended.map(event=>insertEvent(env,event)));return Response.json({appended,rejected:[],head:appended.at(-1)?.sequence??current,eligibility:composition.eligibility,briefComposed:true});
    }
    if(body.action==="declare_intent"){
      const statement=body.statement?.trim();if(!statement||statement.length>500)return Response.json({error:"intent_statement_required"},{status:400});const stored=await storePrivateContent(env,ownerId,"intent",statement,executionScope);const intent=makeEvent(streamId,current+1,userActor,client,corr,"IntentDeclared",{scope_ref:foldEvents(await readEvents(env,streamId)).documentId,statement_ref:stored.contentId,content_expires_at:stored.expiresAt,deadline:body.deadline??null});await insertEvent(env,intent).run();return Response.json({appended:[intent],rejected:[],head:intent.sequence});
    }
    if(body.action==="run_scout"){
      const events=await readEvents(env,streamId);const phase6=[...events].reverse().find(event=>event.type==="PhaseGateReviewed"&&Number(event.payload.phase)===6);if(phase6?.payload.decision!=="advance")return Response.json({error:"phase6_advance_required"},{status:409});
      const maxObservations=Math.max(1,Math.min(4,Math.floor(Number(body.maxObservations??3))));const budgets=await readBudgets(env,billingOwnerId);const remaining=Math.max(0,Math.min(budgets.user.limit-budgets.user.used-budgets.user.reserved,budgets.workspace.limit-budgets.workspace.used-budgets.workspace.reserved));const envelope=buildScoutEnvelope(events,remaining,maxObservations);const workflow=documentViewWorkflow(events);const runId=uuidV7();let sequence=current;const started=makeEvent(streamId,++sequence,"worker:scout",client,corr,"ScoutRunStarted",{run_id:runId,budget:{token_ceiling:envelope.requestedTokens,max_observations:maxObservations,max_variants:envelope.plannedVariants},envelope,substrate_version:"trajectory-v2",workflow_receipt:{preferred_view:workflow.preferredView?.view??null,last_view:workflow.lastView?.view??null,used_views:workflow.usedViews,transitions:workflow.transitions},report_space:"scout"});const appended:EventRow[]=[started];
      if(!envelope.fits){appended.push(makeEvent(streamId,++sequence,"worker:scout",client,corr,"ScoutBudgetExhausted",{run_id:runId,budget_type:"tokens",budget_used:0,threshold:envelope.requestedTokens,remaining_tokens:envelope.remainingTokens,planned_terminal:true},{causationId:started.eventId}));}
      else {
        const slices=buildScoutTrajectory(events).slice(0,maxObservations);
        for(const slice of slices){let candidateObjectId:string|null=null;if(slice.candidate){const generationId=uuidV7();candidateObjectId=`scout-candidate-${generationId.slice(-8)}`;const requestedAt=makeEvent(streamId,++sequence,"worker:scout",client,corr,"GenerationRequested",{generation_id:generationId,run_id:runId,model_ids:["deterministic-scout-v1"],report_space:"scout",candidate_kind:slice.candidate.kind},{causationId:started.eventId});appended.push(requestedAt);appended.push(makeEvent(streamId,++sequence,"worker:scout",client,corr,"GenerationCompleted",{generation_id:generationId,run_id:runId,model_id:"deterministic-scout-v1",object_ids:[candidateObjectId],report_space:"scout",candidate:slice.candidate,latency_ms:0,simulation:true},{causationId:requestedAt.eventId}));}
          const observationId=uuidV7();appended.push(makeEvent(streamId,++sequence,"worker:scout",client,corr,"ScoutObserved",{run_id:runId,observation_id:observationId,type:slice.type,label:slice.label,summary:slice.summary,confidence:slice.confidence,evidence_refs:[`slice:${slice.sliceId}`,...slice.evidenceRefs],evidence_metrics:slice.metrics,signature:slice.signature,candidate_object_id:candidateObjectId,candidate:slice.candidate??null,substrate_version:"trajectory-v2"},{causationId:started.eventId}));
        }
        appended.push(makeEvent(streamId,++sequence,"worker:scout",client,corr,"ScoutRunCompleted",{run_id:runId,observations_count:slices.length,budget_used_tokens:0,cost_usd:0,planned_variants:envelope.plannedVariants,substrate_slices:slices.map(slice=>slice.sliceId),report_space:"scout"},{causationId:started.eventId}));
      }
      await env.DB.batch(appended.map(event=>insertEvent(env,event)));return Response.json({appended,rejected:[],head:sequence,envelope});
    }
    if(body.action==="refresh_taste_model"){
      const events=await readEvents(env,streamId);const phase6=[...events].reverse().find(event=>event.type==="PhaseGateReviewed"&&Number(event.payload.phase)===6);if(phase6?.payload.decision!=="advance")return Response.json({error:"phase6_advance_required"},{status:409});const now=new Date();const beliefs=inferTasteBeliefs(events,now);const workflow=documentViewWorkflow(events);const previous=events.filter(event=>event.type==="TasteModelVersioned").at(-1);const version=makeEvent(streamId,current+1,"worker:taste",client,corr,"TasteModelVersioned",{version_id:uuidV7(),valid_time_range:{from:previous?.occurredAt??events[0]?.occurredAt??now.toISOString(),to:null},computed_at:now.toISOString(),source_head:current,decay_params:{kind:"exponential",half_life_days:60,pilot_setting:true},ranking_policy:{ranking_only:true,filters_options:false},workflow_policy:{ui_routing_only:true,generation_input:false,attention_authority:"capped-supplemental"},workflow_model:{preferred_view:workflow.preferredView?.view??null,last_view:workflow.lastView?.view??null,used_views:workflow.usedViews,transitions:workflow.transitions,rows:workflow.rows.filter(row=>row.visits||row.edits||row.generationRequests||row.outcomes||row.activeMinutes).map(row=>({view:row.view,visits:row.visits,edits:row.edits,generation_requests:row.generationRequests,outcomes:row.outcomes,active_minutes:row.activeMinutes,confidence:row.confidence}))},beliefs});await insertEvent(env,version).run();return Response.json({appended:[version],rejected:[],head:version.sequence,beliefs:beliefs.length});
    }
    if(body.action==="set_condition"){
      const condition=body.condition?.trim();if(!condition||condition.length>300)return Response.json({error:"condition_required"},{status:400});const triggerKind=body.triggerKind==="on_date"?"on_date":"generation_count";const threshold=triggerKind==="generation_count"?Math.max(1,Math.min(100,Math.floor(Number(body.threshold??3)))):null;if(triggerKind==="on_date"&&(!body.onDate||Number.isNaN(Date.parse(body.onDate))))return Response.json({error:"valid_condition_date_required"},{status:400});const stored=await storePrivateContent(env,ownerId,"condition",condition,executionScope);const conditionId=uuidV7();const projection=foldEvents(await readEvents(env,streamId));const deferred=makeEvent(streamId,current+1,userActor,client,corr,"Deferred",{object_ref:projection.documentId,condition_id:conditionId,condition_ref:stored.contentId,trigger_kind:triggerKind,threshold,fire_on:triggerKind==="on_date"?body.onDate:null});const set=makeEvent(streamId,current+2,userActor,client,corr,"ConditionSet",{condition_id:conditionId,condition_ref:stored.contentId,content_expires_at:stored.expiresAt,scope:"project",target_ref:projection.documentId,trigger_kind:triggerKind,threshold,fire_on:triggerKind==="on_date"?body.onDate:null,created_sequence:current+2},{causationId:deferred.eventId});await env.DB.batch([deferred,set].map(event=>insertEvent(env,event)));return Response.json({appended:[deferred,set],content:{[stored.contentId]:condition},rejected:[],head:set.sequence});
    }
    if(body.action==="check_conditions"){
      const events=await readEvents(env,streamId);const projection=foldEvents(events);let sequence=current;const appended:EventRow[]=[];
      for(const condition of projection.conditions.filter(item=>!item.fired)){const conditionId=String(condition.condition_id);const set=events.find(event=>event.type==="ConditionSet"&&String(event.payload.condition_id)===conditionId);const since=Number(condition.created_sequence??set?.sequence??0);const trigger=String(condition.trigger_kind??(condition.condition_ref==="three-new-generations"?"generation_count":"manual"));const generations=events.filter(event=>event.sequence>since&&event.type==="GenerationCompleted"&&event.payload.report_space!=="scout").length;const due=trigger==="generation_count"?generations>=Number(condition.threshold??3):trigger==="on_date"?Date.now()>=Date.parse(String(condition.fire_on)):false;if(!due)continue;const fired=makeEvent(streamId,++sequence,"worker:scheduler",client,corr,"ConditionFired",{condition_id:conditionId,trigger_kind:trigger,witness:{generations_since_set:generations,checked_at:new Date().toISOString()},source_condition_event_id:set?.eventId??null});appended.push(fired);appended.push(makeEvent(streamId,++sequence,"worker:scheduler",client,corr,"Resurfaced",{condition_id:conditionId,target_ref:condition.condition_ref,source_condition_event_id:set?.eventId??null},{causationId:fired.eventId}));}
      if(appended.length)await env.DB.batch(appended.map(event=>insertEvent(env,event)));return Response.json({appended,rejected:[],head:sequence,checked:projection.conditions.filter(item=>!item.fired).length});
    }
    if(body.action==="critique_object"){
      if(!body.objectId||!CREATOR_AXES.includes(body.axis as typeof CREATOR_AXES[number])||!body.value?.trim())return Response.json({error:"object_axis_and_value_required"},{status:400});const stored=body.note?.trim()?await storePrivateContent(env,ownerId,"critique",body.note.trim(),executionScope):null;const critique=makeEvent(streamId,current+1,userActor,client,corr,"ObjectCritiqued",{object_id:body.objectId,axis_ref:body.axis,polarity:body.polarity==="positive"?"positive":"negative",value:body.value.trim().slice(0,120),note_ref:stored?.contentId??null,content_expires_at:stored?.expiresAt??null});await insertEvent(env,critique).run();return Response.json({appended:[critique],content:stored?{[stored.contentId]:body.note?.trim()}:undefined,rejected:[],head:critique.sequence});
    }
    if(body.action!=="append"&&body.action!=="batch"&&body.action!=="canvas_sync"&&body.action!=="hot"&&!hot)return Response.json({error:"unsupported_action"},{status:400});
    if(requested.some((event)=>event.type==="OutputRenamed")){
      const history=await readWorkspaceEvents(env,streamId);
      const pendingNames=new Map<string,string>();
      for(const candidate of requested.filter((event)=>event.type==="OutputRenamed")){
        const payload=candidate.payload??{},kind=payload.output_kind,id=String(payload.output_id??"");
        const documentId=String(payload.document_id??""),projectId=String(payload.project_id??"");
        const title=typeof payload.new_title==="string"?payload.new_title.normalize("NFC").trim():"";
        if(kind!=="image"&&kind!=="artifact"||!id||!documentId||!projectId
          ||String(kind==="image"?payload.object_id??"":payload.artifact_id??"")!==id
          ||Boolean(kind==="image"?payload.artifact_id:payload.object_id))return Response.json({error:"invalid_output_identity"},{status:400});
        if(!title||Array.from(title).length>120||/\p{Cc}/u.test(title))return Response.json({error:"invalid_output_title"},{status:400});
        const projection=foldEvents(history,Number.POSITIVE_INFINITY,documentId,projectId);
        if(!projection.documents.some((document)=>document.id===documentId&&document.projectId===projectId))return Response.json({error:"document_not_found"},{status:404});
        const target=kind==="image"?projection.libraryOutputs.find((output)=>output.id===id&&!output.discarded):projection.libraryArtifacts.find((artifact)=>artifact.id===id);
        if(!target||target.documentId!==documentId||kind==="artifact"&&payload.artifact_kind!==undefined&&"kind" in target&&target.kind!==payload.artifact_kind)return Response.json({error:"output_not_found"},{status:404});
        const current=pendingNames.get(`${kind}:${id}`)??target.title;
        if(current&&Object.hasOwn(payload,"old_title")&&String(payload.old_title??"")!==current)return Response.json({error:"output_title_conflict"},{status:409});
        payload.new_title=title;candidate.payload=payload;pendingNames.set(`${kind}:${id}`,title);
      }
    }
    if(requested.some((event)=>event.type==="DocumentProductionWorkflowConfigured")){
      const history=await readWorkspaceEvents(env,streamId);
      for(const candidate of requested.filter((event)=>event.type==="DocumentProductionWorkflowConfigured")){
        const payload=candidate.payload??{};const workflow=payload.workflow as ProductionWorkflow|undefined;
        if(!workflow||typeof workflow!=="object"||Array.isArray(workflow)||productionWorkflowIssues(workflow).length||workflow.id!==payload.workflow_id||workflow.documentId!==payload.document_id||workflow.projectId!==payload.project_id||workflow.target!==payload.target_kind)return Response.json({error:"production_workflow_invalid"},{status:400});
        const projection=foldEvents(history,Number.POSITIVE_INFINITY,workflow.documentId,workflow.projectId);
        if(!projection.documents.some((document)=>document.id===workflow.documentId&&document.projectId===workflow.projectId))return Response.json({error:"document_not_found"},{status:404});
        if(!auth.user.fictional){
          const scopes=await ownerDocumentBudgetScopes(env,ownerId,workflow.documentId,workflow.projectId);
          if(scopes.length>1)return Response.json({error:"ambiguous_project_budget_scope"},{status:409});
          if(scopes[0]){workflow.approvalRequired=true;for(const stage of workflow.stages){if(stage.final||stage.format==="image")continue;stage.approvalRequired=true;if(stage.source)stage.source.approvalRequired=true;}}
        }
        for(const stage of workflow.stages){if(!stage.source)continue;const authorized=stage.source.outputKind==="image"?projection.libraryOutputs.some((output)=>output.id===stage.source!.outputId&&output.documentId===workflow.documentId&&!output.discarded):projection.libraryArtifacts.some((artifact)=>artifact.id===stage.source!.outputId&&artifact.documentId===workflow.documentId&&artifact.kind===stage.source!.format);if(!authorized)return Response.json({error:"workflow_source_unauthorized"},{status:403});}
      }
    }
    if(requested.some((event)=>ARTIFACT_REVIEW_EVENT_TYPES.has(String(event.type??"")))){
      if(requested.some((event)=>!ARTIFACT_REVIEW_EVENT_TYPES.has(String(event.type??""))))return Response.json({error:"artifact_review_batch_must_be_isolated",message:"Source-context mutations cannot be combined with an independent artifact review decision."},{status:409});
      const history=await readWorkspaceEvents(env,streamId);
      for(const candidate of requested.filter((event)=>ARTIFACT_REVIEW_EVENT_TYPES.has(String(event.type??"")))){
        const documentId=String(candidate.payload?.document_id??"");const projection=foldEvents(history,Number.POSITIVE_INFINITY,documentId);
        const scopes=await ownerDocumentBudgetScopes(env,ownerId,documentId,projection.projectId);
        if(scopes.length>1)return Response.json({error:"ambiguous_project_review_scope"},{status:409});
        const scope=scopes[0];const authorized=!scope||hasCapability(auth.user,"project.review.approve",{organizationId:scope.organizationId,projectAccessId:scope.projectAccessId});
        const validation=validateArtifactReview({type:String(candidate.type),payload:candidate.payload??{},events:history,actorUserId:ownerId,projectId:projection.projectId,canApprove:authorized,independentReviewer:Boolean(scope)});
        if(!validation.ok)return Response.json({error:validation.code,message:validation.message},{status:validation.status});
        candidate.payload=validation.payload;
      }
    }
    const rejected:Array<{index:number;type:string;reason:string}>=[];
    const requiresCollectionState=requested.some((item)=>String(item.type??"").startsWith("Collection"));
    const state=requiresCollectionState?collectionState(await readEvents(env,streamId)):collectionState([]);
    const receiptIds=requested.map((item)=>String(item.payload?.client_event_id??""));
    const received=body.action==="canvas_sync"?await readEventsByClientEventIds(env,streamId,receiptIds):new Map<string,EventRow>();
    const pending=requested.map((item,index)=>({item,index,clientEventId:receiptIds[index]})).filter(({clientEventId})=>!clientEventId||!received.has(clientEventId));
    if(pending.some(({item})=>item.type==="BlockRelationRemoved"||item.type==="BlockRelationAdded"&&isContextCompositionRelation(item.payload?.kind))){
      // The account's most recently opened project can differ from the project
      // whose document is being edited in another browser tab. Validate the
      // relationship against its explicit scope, never that unrelated project.
      const graphScope=pending.find(({item})=>item.type==="BlockRelationAdded"&&isContextCompositionRelation(item.payload?.kind))?.item.payload
        ??pending.find(({item})=>item.payload?.project_id||item.payload?.document_id)?.item.payload;
      const projection=foldEvents(await readWorkspaceEvents(env,streamId),Number.POSITIVE_INFINITY,
        String(graphScope?.document_id??""),String(graphScope?.project_id??""));
      const issue=validateContextCompositionGraph({blocks:projection.libraryBlocks,relations:projection.libraryBlockRelations,events:pending.map(({item})=>item)});
      if(issue)return Response.json({error:issue.code,message:issue.message,index:pending[issue.index]?.index??issue.index},{status:409});
    }
    const valid=pending.filter(({item,index})=>{
      const type=item.type??"";
      if(!type||!canAppend("user",type)){rejected.push({index,type,reason:"event_not_permitted_for_user"});return false;}
      if(type==="DocumentArtifactEdited"){rejected.push({index,type,reason:"artifact_edit_endpoint_required"});return false;}
      if(!item.payload||typeof item.payload!=="object"){rejected.push({index,type,reason:"payload_must_be_object"});return false;}
      if(body.action==="canvas_sync"&&!receiptIds[index]){rejected.push({index,type,reason:"client_event_id_required"});return false;}
      if(body.action==="canvas_sync"&&String(item.payload.history_owner_id??"")!==ownerId){rejected.push({index,type,reason:"canvas_account_mismatch"});return false;}
      if(body.action==="canvas_sync"&&!String(item.payload.project_id??"").trim()){rejected.push({index,type,reason:"canvas_project_required"});return false;}
      if((type==="MembershipAdded"||type==="MembershipRemoved")&&auth.user.role!=="admin"){rejected.push({index,type,reason:"project_owner_role_required"});return false;}
      const canvasReason=validateCanvasEvent(item);if(canvasReason){rejected.push({index,type,reason:canvasReason});return false;}
      if(type==="AttentionEpisodeObserved"){const normalized=normalizeAttention(item);if(!normalized){rejected.push({index,type,reason:"invalid_attention_episode"});return false;}item.payload=normalized;}
      if(type==="ApplicationViewVisited"){const normalized=normalizeApplicationView(item);if(!normalized){rejected.push({index,type,reason:"invalid_application_view_visit"});return false;}item.payload=normalized;}
      if(type==="DocumentViewVisited"){const normalized=normalizeDocumentView(item);if(!normalized){rejected.push({index,type,reason:"invalid_document_view_visit"});return false;}item.payload=normalized;}
      if(type.startsWith("Collection")){const reason=validateCollection(item,state);if(reason){rejected.push({index,type,reason});return false;}}
      return true;
    });
    if(body.action==="canvas_sync"){
      const userEvents=valid.map(({item})=>makeEvent(streamId,0,userActor,client,corr,item.type!,item.payload!,{compensatesEventId:item.compensatesEventId}));if(userEvents.length)await appendEventsWithClientReceipts(env,userEvents,valid.map(({clientEventId})=>clientEventId),{retries:10});
      const accepted=await readEventsByClientEventIds(env,streamId,receiptIds);const confirmed=requested.flatMap((_,index)=>{const event=accepted.get(receiptIds[index]);return event?[event]:[]}).sort((left,right)=>left.sequence-right.sequence);const validation=rejected.length?makeEvent(streamId,0,"worker:validator",client,corr,"ValidationFailed",{attempted_type:"canvas_sync",attempted_by:"user",permission_schema_version:PERMISSION_SCHEMA_VERSION,errors:rejected}):null;if(validation)await appendEvents(env,[validation]);const head=await streamHead(env,streamId);return Response.json({appended:[...confirmed,...(validation?[validation]:[])],rejected,head,idempotent:true});
    }
    let sequence=current;const appended=valid.map(({item})=>makeEvent(streamId,++sequence,userActor,client,corr,item.type!,item.payload!,{compensatesEventId:item.compensatesEventId}));if(rejected.length)appended.push(makeEvent(streamId,++sequence,"worker:validator",client,corr,"ValidationFailed",{attempted_type:"emit_events",attempted_by:"user",permission_schema_version:PERMISSION_SCHEMA_VERSION,errors:rejected}));if(appended.length)await appendEvents(env,appended,{...(commutative?{}:{expectedHead:current})});return Response.json({appended,rejected,head:appended.at(-1)?.sequence??current});
  }catch(error){if(error instanceof StaleSequenceError)return Response.json({error:"stale_sequence",expected:error.expected,head:error.head},{status:409});return Response.json({error:error instanceof Error?error.message:"event_api_failed"},{status:500});}
}
