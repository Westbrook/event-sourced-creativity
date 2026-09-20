import { appendNativeDocumentView } from './memory-document-view.ts';
import { presentActorArtifactPage } from './memory-artifact-presentation.ts';
import { appendGovernedArtifactView } from './memory-governed-artifact-view.ts';
import { readStillRoutePage } from './still-route-read.ts';
import { requireGuestImageExecution, type GuestImageExecutionAuthority } from "./experience-guest-image-execution.ts";
import { requireGuestImageJobControl } from "./document-jobs-api.ts";
import { sponsorScenePaidDispatchDeadline, sponsorScenePaidClaimIdentity, requireSponsorScenePaidDispatchCurrent, type SponsorScenePaidClaim } from "./experience-sponsor-scene-paid-claim.ts";
import { sponsorFinancialEventProfile } from "./experience-sponsor-execution.ts";
import { canonicalJson as sponsorEventJson } from "../src/experiences/compiler.ts";
import { parseVideoOutputContract } from "../src/model/output-video-contract.ts";
import { readVideoPlannerExecution } from "./output-video-planner.ts";
import { generateOutputVideo, withOutputVideoHook, outputVideoMediaPrice, OUTPUT_VIDEO_TRANSPORT, type OutputVideoHookLease } from "./output-video-execution.ts";
import { readOutputAudioPayload, verifyOutputAudioCalls, outputAudioHash, outputAudioPlannerCost } from "./output-audio-execution.ts";
import { readOutputScenePayload } from "./output-scene-preflight-contract.ts";
import { parseStoryboardOutputContract } from "../src/model/output-storyboard-contract.ts";
import { captureOutputStoryboardPlan, outputStoryboardFrameDirection } from "./output-storyboard-plan.ts";
import { storyboardFrameHooks } from "./output-storyboard-fal.ts";
import { readStoryboardPlannerExecution } from "./output-storyboard-request.ts";
import { readOutputStoryboardFrameMedia } from "./output-storyboard-media.ts";
import { outputScenePlannerCost, verifyOutputSceneCompletion, readOutputSceneArtifact, sceneContentSha256 } from "./output-scene-completion.ts";
import type { OutputSceneEnvelope } from "./output-scene-adapter.ts";
import { readOutputNarrativePayload, outputNarrativePlannerCost, verifyOutputNarrativeCompletion } from "./output-narrative-execution.ts";
import { outputAssertionStatements } from "./output-requirements-ledger.ts";
import { nativeMemoryAnswerExclusion } from "./memory-native-boundary.ts";
import { appendPersonalArtifactView } from "./memory-artifact-view.ts";
import { preparePersonalSlidesPrivateContentPair } from "./private-content-storage.ts";
import { presentationProviderLabels } from "../src/model/generation-execution-evidence.ts";
import { documentRenderGuidance, documentRenderGuidanceProblem } from "../src/model/document-render-guidance.ts";
import { handleProjectIntake } from "./project-intake.ts";
import { requireGuestImageEventExecution, settleGuestImageExecutionBudgets, type OutputEventExecution } from "./output-execution-control.ts";
import { isOutputContextBlock } from "../src/model/output-source-policy.ts";
import { MAX_MANUAL_PRESENTATION_SLIDES, PresentationCountPolicyError, resolvePresentationCountRequest, slideCountAccepted, type SlideCountPolicy } from "../src/model/presentation-count-policy.ts";
import { assessStoredPresentationCandidate, generateCreativeDirection, generateCreativeVideo, generateDocumentArtifact, PRESENTATION_ADAPTER_VERSION, respondToCreativeChat, validateCreativeVideoAudioReferences, validateCreativeVideoReferences, type CreativeChatMutation, type CreativeVideoPreparedReceipt, type ImageReference, type ProviderResponseReceipt, type VideoAudioReference, type VideoReference } from "./openai-adapter";
import { definitiveProviderRejection, hasUnresolvedProviderSubmission, hasUnsettledProviderSubmission, mergeProviderSubmissions, providerSubmissions } from "../src/model/provider-submission";
import { retainLegacyPresentationFinancialReceipt, retainPresentationCallResponse } from "./presentation-call-evidence.ts";
import { estimateOpenAITextCallMaximumMicrousd, hasCurrentOpenAITextPricing } from "./openai-text-cost.ts";
import { PresentationModelConfigurationError, readFrozenPresentationModelRoutes, resolvePresentationModelRoutes, type PresentationModelRoutes } from "./presentation-model-routing.ts";
import { prepareSceneCostConsent, requireSceneCostApproval, requireSceneCostDeadline, sceneCostErrorResponse, SceneCostConsentError, type PreparedSceneCost } from "./scene-cost-consent.ts";
import { scenePaidDispatchDeadline, requireScenePaidDeadline, ScenePaidPolicyStopError } from "./scene-paid-dispatch.ts";
import { scenePolicyStopIncomingField, type ScenePolicyStopWitness } from "./scene-cost-consent.ts";
import type { ClaimedSceneBudget } from "./pilot-policy.ts";
import { paidProviderObserver } from "./provider-submission";
import { generateCreativeImage, selectImageAdapter } from "./image-adapter";
import type { FalImageProviderReceipt } from "./fal-image-adapter";
import { managedPilotSourceClassificationValid, readGeneratedImageReference, readOwnedAudioReference, readOwnedGeneratedVideoReference, storeGeneratedImage, storeGeneratedMedia, verifySourceDocumentEvidence } from "./media-api";
import { claimCostBudgetReservation, costBudgetReservation, hasCapability, loadPrivateContent, pilotExecutionAllowance, readAccountBudgets, readBudgets, readCostBudgets, releaseBudget, releaseCostBudget, requireConsent, requireUser, preparePrivateContent, reserveBudget, reserveCostBudget, settleBudget, settleCostBudget, settleDocumentGenerationBudgets, settleInterruptedDocumentJobReservations, storePrivateContent, type PilotUser, type ProjectExecutionScope } from "./pilot-policy";
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
import { clearPresentationServerOwnedCheckpointFields, documentPlanningTokenReservation, documentRenderTokenReservation, estimatePlannerOperationMicrousd, generationBudgetGate, presentationServerOwnedCheckpointField } from "../src/model/generation-budget";
import { documentImageFormat, imageFormatEventFields, normalizeImageFormat, providerRenderFormat } from "../src/model/image-format";
import { applicationFailureDetail, classifyProviderFailure, ProviderRequestError, providerFailurePrompt, publicFailureDetail, type ProviderFailureDetail } from "./provider-errors";
import { CANVAS_COMMUTATIVE_EVENT_TYPES, CANVAS_USER_EVENT_TYPES, validateCanvasEvent } from "./realtime/canvas-admission";
import { readCanvasGovernance } from "./canvas-governance-policy";
import { LIVE_REPLAY_PRICING_VERSION, hasKnownTextModelPricing, priceTextUsageBreakdownMicrousd, type ProviderCostBreakdown } from "./replay-cost";
import { audioProviderSubmissionState, frozenPresentationPlannerCost, interruptedDocumentJobUsage, recordedDocumentPlannerUsage, remainingDocumentPlannerCost, validatedStoryboardSafeRecovery } from "./document-job-reservations";
import { observeProviderFailure, observeProviderSuccess } from "./generation-readiness";
import { generationFailureReconciliationEventFields, generationReconciliationEventFields } from "./generation-self-healing";
import { governedPackageSourceRightsCurrent } from "./context-package-rights";
import { documentArtifactValidationIssues, isDocumentArtifactKind, isSlideStylePresetId, parseDocumentArtifactContent, type DocumentArtifactKind, type SlideStylePresetId } from "../src/model/document-artifacts";
import { combinedContextGroups, combinedContextMemberships, isContextCompositionRelation, validateContextCompositionGraph } from "../src/model/combined-context";
import { outputBlockRemovalEvents, outputBlockTextEditEvents } from "../src/model/output-authoring";
import { isVideoAudioMode, isVideoDurationSeconds, normalizeVideoDurationSeconds, VIDEO_ADAPTER_CONTRACT, type VideoAudioMode, type VideoDurationSeconds } from "../src/model/video-adapter";
import { adaptVideoPrompt, resolveVideoAudioPolicy } from "./video-prompt-adapter";
import { AUDIO_ADAPTER_CONTRACT, VIDEO_AUDIO_REFERENCE_CONTRACT, AudioAdapterSelectionError, audioAuthoringConflict, audioDurationMetadata, audioContextFromFact, audioContexts, audioFactProhibited, audioRightsAllowed, normalizeAudioRequestProfile, type AudioRequestProfile } from "../src/model/audio";
import { artifactReviewState } from "../src/model/context-health";
import { selectAudioAdapter, selectRetainedAudioAdapter } from "./audio-selection";
import { boundedAudioExcerpt } from "../src/model/audio-container";
import { adaptAudioPrompt, audioPreparationConstraints } from "./audio-prompt-adapter";
import { AudioProviderInputError } from "../src/model/audio-provider-contracts";
import { generateCreativeAudio, type AudioImageReference, type AudioVideoReference, type CreativeAudioPreparedReceipt } from "./fal-audio-adapter";
import { appendProjectEvents, hasProjectContextCookie, ownerDocumentBudgetScopes, readProjectEventPage, readProjectRequestContext, readProjectSourceEvents } from "./project-access";
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
import { validateModel3dRequest } from "../src/model/model3d.ts";
import { model3dReferenceSelection, prepareModel3dRequest, type PreparedModel3dRequest } from "./model3d-request.ts";
import { handleModel3dRender } from "./model3d-render.ts";
import { validateModel3dAssetEvents } from "./model3d-event-guards.ts";
import { assertDerivedReferenceProvenance } from "./derived-reference-guard.ts";

export type { WorkerEnv } from "./runtime";

import { isOutputContextType } from "../src/model/output-requirements.ts";
import { normalizeOutputRequirementCreation, outputAuthoringBlocksFromEvents, outputRequirementChatNotice, prepareOutputRequirementClientEvents } from "./output-requirement-event-guards.ts";

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
  ...(detail.safetyInputDigest?{safety_input_digest:detail.safetyInputDigest}:{}),
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

const providerCostReceipt=(parts:ProviderCostBreakdown[],labels:ReturnType<typeof presentationProviderLabels>=null)=>{const summed=parts.reduce((total,part)=>({text_input_microusd:total.text_input_microusd+part.textInputMicrousd,text_output_microusd:total.text_output_microusd+part.textOutputMicrousd,image_text_input_microusd:total.image_text_input_microusd+part.imageTextInputMicrousd,image_input_microusd:total.image_input_microusd+part.imageInputMicrousd,image_output_microusd:total.image_output_microusd+part.imageOutputMicrousd}),{text_input_microusd:0,text_output_microusd:0,image_text_input_microusd:0,image_input_microusd:0,image_output_microusd:0});return{pricing_version:LIVE_REPLAY_PRICING_VERSION,cost_microusd:Object.values(summed).reduce((sum,value)=>sum+value,0),cost_breakdown_microusd:summed,cost_precision:"provider-receipt-or-published-rate",...(labels?{pricing_version:labels.pricing_version,pricing_versions:labels.pricing_versions,model_ids:labels.model_ids,requested_model_ids:labels.requested_model_ids,requested_reasoning_efforts:labels.requested_reasoning_efforts,provider_call_labels:labels.provider_call_labels,cost_precision:"frozen-per-call-published-tariff",cost_aggregation:"sum-of-frozen-per-call-costs"}:{})};};
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
function snapshotForProjection(projection:CreativeProjection){const factualBlocks=projection.blocks.filter((block)=>!isOutputContextBlock(block));const factualIds=new Set(factualBlocks.map((block)=>block.id));const facts=factualBlocks.map((block)=>({block_id:block.id,document_id:block.documentId,type:block.type,role:block.type,intent:blockIntentFor(block.type,block.properties),handle:block.handle,position:block.position,locked:block.locked,active:Number(block.properties.weight??.5)>0,effect:blockEffectFor(block.type,block.properties),properties:{...block.properties,spatial_scope:normalizeSpatialScope(block.properties.spatial_scope)},authority:block.properties.authority??"authored",source_event_refs:block.sourceEvents}));const relationships=projection.blockRelations.filter((relation)=>factualIds.has(relation.fromBlockId)&&factualIds.has(relation.toBlockId)).map((relation)=>({relation_id:relation.id,from_block_id:relation.fromBlockId,to_block_id:relation.toBlockId,kind:relation.kind,properties:relation.properties,source_event_refs:relation.sourceEvents}));return{facts,relationships,context_groups:combinedContextGroups({facts,relationships}),pins:projection.outputs.filter((output)=>output.pinned).map((output)=>output.id),tail:[],document:{id:projection.documentId,title:projection.documentTitle}};}
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
  return{bytes:media.bytes,mimeType:media.mimeType,artifactId:artifact.id,referenceId:artifact.id,label:artifact.title,durationSeconds};
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
async function uploadedPixelReferences(env:WorkerEnv,ownerId:string,projection:CreativeProjection,sourceEvents:EventRow[],snapshot?:Record<string,unknown>,projectScope?:ProjectExecutionScope):Promise<ImageReference[]>{
  const references:ImageReference[]=[];
  const authorizedIds=snapshot?new Set((Array.isArray(snapshot.facts)?snapshot.facts:[]).flatMap((fact)=>fact&&typeof fact==="object"?[String((fact as Record<string,unknown>).block_id??"")]:[])):null;
  for(const block of projection.blocks){
    if(!["reference","model3d"].includes(block.type)||authorizedIds&&!authorizedIds.has(block.id)||!promptFactIsActive(block)||!sendsReferencePixels(block.properties.pixel_reference_mode))continue;
    if(block.properties.context_reference_kind==="character_identity"&&block.properties.pixel_reference_mode==="preserve_subject"&&block.properties.likeness_transfer_consent!==true)throw new Error(`character_likeness_consent_required:${block.id}`);
    const referenceId=String(block.properties.reference_id??"");const rightsConfirmed=sourceEvents.some((event)=>event.type==="RightsAsserted"&&String(event.payload.reference_id??"")===referenceId)||sourceEvents.some((event)=>event.type==="ReferenceIngested"&&String(event.payload.reference_id??"")===referenceId&&Boolean(event.payload.rights_class));
    if(!referenceId||!rightsConfirmed)throw new Error(`reference_pixel_rights_required:${block.id}`);
    await assertDerivedReferenceProvenance({env,ownerId,properties:block.properties,blockId:block.id,sourceEvents,projectScope});
    const image=await readGeneratedImageReference(env,ownerId,block.properties.media_url);if(!image)throw new Error(`reference_pixel_input_unavailable:${block.id}`);
    references.push({...image,blockId:block.id,referenceId,label:String(block.properties.label??block.handle),mode:referencePixelMode(block.properties.pixel_reference_mode),source:"uploaded-reference"});
  }
  return references;
}
async function videoPixelReferences(env:WorkerEnv,ownerId:string,snapshot:Record<string,unknown>,sourceEvents:EventRow[],projectScope?:ProjectExecutionScope):Promise<VideoReference[]>{
  const rawFacts=Array.isArray(snapshot.facts)?snapshot.facts:[];const candidates=rawFacts.map((value)=>value&&typeof value==="object"?value as Record<string,unknown>:{}).filter((fact)=>["reference","model3d"].includes(String(fact.type))&&promptFactIsActive(fact)).map((fact)=>{const properties=fact.properties&&typeof fact.properties==="object"?fact.properties as Record<string,unknown>:{};return{fact,properties};}).filter(({properties})=>Number(properties.weight??.5)>0&&sendsReferencePixels(properties.pixel_reference_mode)).sort((left,right)=>{const leftArtifact=String(left.properties.source_artifact_id??""),rightArtifact=String(right.properties.source_artifact_id??"");if(leftArtifact&&leftArtifact===rightArtifact){const delta=Number(left.properties.storyboard_frame_index??Number.POSITIVE_INFINITY)-Number(right.properties.storyboard_frame_index??Number.POSITIVE_INFINITY);if(delta)return delta;}return String(left.fact.position??"").localeCompare(String(right.fact.position??""));});
  const document=snapshot.document&&typeof snapshot.document==="object"?snapshot.document as Record<string,unknown>:null;
  const authoritative=projectScope?foldEvents(sourceEvents,Number.POSITIVE_INFINITY,String(document?.id??""),projectScope.projectId):null;
  const namedGroups=new Map(combinedContextGroups(snapshot).map((group)=>[group.id,group]));
  const references:VideoReference[]=[];
  for(const {fact,properties} of candidates){
    const blockId=String(fact.block_id??""),referenceId=String(properties.reference_id??"");const rightsConfirmed=sourceEvents.some((event)=>event.type==="RightsAsserted"&&String(event.payload.reference_id??"")===referenceId)||sourceEvents.some((event)=>event.type==="ReferenceIngested"&&String(event.payload.reference_id??"")===referenceId&&Boolean(event.payload.rights_class));
    if(!referenceId||!rightsConfirmed)throw new ProviderRequestError({code:"video_reference_rights_required",category:"provider",scope:"request",action:"edit_request",message:`${String(properties.label??fact.handle??"A video reference")} needs usable rights evidence before its pixels can be sent to the video provider.`,retryable:false,retryAfterMs:null,requestId:null,httpStatus:400,contributingBlockIds:[blockId],contributingReferenceIds:referenceId?[referenceId]:[]});
    if(projectScope){
      const actual=authoritative?.blocks.find((block)=>block.id===blockId&&["reference","model3d"].includes(block.type)&&block.projectId===projectScope.projectId&&String(block.properties.reference_id??"")===referenceId);
      const suppliedUrl=String(properties.media_url??"");let mediaKey="";try{mediaKey=suppliedUrl.startsWith("/api/media/")?decodeURIComponent(suppliedUrl.slice("/api/media/".length)):"";}catch{mediaKey="";}
      const matched=actual&&String(actual.properties.media_url??"")===suppliedUrl&&mediaKey?await env.DB.prepare(`SELECT 1 AS present FROM project_resource_scopes media
        JOIN project_resource_scopes block ON block.project_access_id=media.project_access_id AND block.organization_id=media.organization_id AND block.project_id=media.project_id AND block.owner_user_id=media.owner_user_id AND block.resource_kind='block' AND block.resource_id=?
        JOIN project_resource_scopes reference ON reference.project_access_id=media.project_access_id AND reference.organization_id=media.organization_id AND reference.project_id=media.project_id AND reference.owner_user_id=media.owner_user_id AND reference.resource_kind='reference' AND reference.resource_id=?
        WHERE media.project_access_id=? AND media.organization_id=? AND media.project_id=? AND media.owner_user_id=? AND media.resource_kind='media' AND media.resource_id=?`)
        .bind(blockId,referenceId,projectScope.projectAccessId,projectScope.organizationId,projectScope.projectId,projectScope.ownerUserId,mediaKey).first():null;
      if(!matched)throw new ProviderRequestError({code:"video_reference_not_authorized",category:"provider",scope:"request",action:"edit_request",message:"This reference image is not authorized for the selected project and document.",retryable:false,retryAfterMs:null,requestId:null,httpStatus:403,contributingBlockIds:[blockId],contributingReferenceIds:[referenceId]});
    }
    await assertDerivedReferenceProvenance({env,ownerId,properties,blockId,sourceEvents,projectScope});
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
      const creation=normalizeOutputRequirementCreation({block_id:id,document_id:input.projection.documentId,type:mutation.type,handle,position:`z${String(sequence+1).padStart(6,"0")}`,properties});
      const event=makeEvent(input.streamId,++sequence,input.actor??"user",input.client,input.corr,"BlockCreated",creation,{causationId:input.causationId});events.push(event);available.set(id,{id,documentId:input.projection.documentId,canvasId:"",projectId:input.projection.projectId,scope:"document",type:String(creation.type),handle,position:String(sequence),removed:false,locked:false,properties:creation.properties as Record<string,unknown>,sourceEvents:[event.eventId]});continue;
    }
    const target=mutation.target_block_id?available.get(mutation.target_block_id):undefined;if(!target||target.locked||governed(target)||isOutputContextType(target.type))continue;
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

export type EventExecutionControl = { safetyAcknowledgement?: import("./image-safety-acknowledgement.ts").ImageSafetyAcknowledgement; output?: OutputEventExecution; settlePersonalPresentation?:(input:{reservationId:string;costReservationId:string;usedTokens:number;usedMicrousd:number})=>Promise<void>; signal: AbortSignal; beginCommit: () => Promise<void>; progress: (stage:string,message:string,patch?:Record<string,unknown>,options?:{financialReceiptPersisted?:true}) => Promise<void> };

function createOperationEventAppender(execution?:EventExecutionControl){
  return async(environment:WorkerEnv,events:EventRow[],options:Parameters<typeof appendEvents>[2]={})=>{
      if(!execution?.output)return appendEvents(environment,events,options);
      const output=execution.output;
      const appendAndRefresh=async()=>{
      try{const appended=await appendEvents(environment,events,{...options,retries:1,
        initialHead:events.length&&events[0]!.sequence>1?events[0]!.sequence-1:undefined,prepareSidecars:output.eventWriteSidecars,onSidecarsCommitted:output.eventWriteCommitted,
      });
        // Advance the exact Scene source manifest after our own committed events;
        // retain original input/envelope assertions and recheck unchanged consent.
        await output.refreshScene?.();
        return appended;
      }catch(error){
        // A lost write acknowledgement is not permission to duplicate an event
        // or provider request. Recover only these exact committed envelopes and
        // private bodies under current authority, with one bounded read.
        if(!String(error).includes("constraint failed")&&await output.eventAppendCommitted(events))return events;
        throw error;
      }
      };
      // Include append, acknowledgement, refreshed proof, and exact lost-ACK
      // recovery in one boundary. Heartbeats cannot capture a mixed version.
      return execution.output.withSourceTransition
        ?execution.output.withSourceTransition(appendAndRefresh):appendAndRefresh();
    };
}

type NativeImageOperationBody={
  [key:string]:unknown;
  action?:string;documentId?:string;snapshot?:Record<string,unknown>;locale?:string;
  promptTechnique?:string;promptFanId?:string;sourcePreviewId?:string;sourceSurface?:string;
  productionMode?:ProductionMode;workflowId?:string;workflowStageId?:string;workflowSources?:ProductionWorkflowSource[];
  canvasId?:string;contextSetId?:string;preflightId?:string;preflightVersion?:string;preflightAcknowledged?:boolean;
  sourceBlockVersions?:Array<Record<string,unknown>>;
};
type ImageProviderClaimRefusal={operation:string;tokenReservationId:string;costReservationId:string;reservedTokens:number;reservedMicrousd:number;causationId?:string};
type NativeImageOperationInput={
  env:WorkerEnv;body:NativeImageOperationBody;ownerId:string;storageOwnerId:string;billingOwnerId:string;streamId:string;userActor:string;
  executionScope?:ProjectExecutionScope;projectBudgetScope?:NonNullable<Parameters<typeof reserveBudget>[3]>["projectScope"];
  execution?:EventExecutionControl;readEvents:(env:WorkerEnv,streamId:string)=>Promise<EventRow[]>;
  current:number;client:string;corr:string;appendOperationEvents:ReturnType<typeof createOperationEventAppender>;
  settleOperationOutputBudgets:(input:Parameters<typeof settleDocumentGenerationBudgets>[2])=>ReturnType<typeof settleDocumentGenerationBudgets>;
  refuseProviderClaim:(input:ImageProviderClaimRefusal)=>Promise<Response>;
  isAuthorityStop?:(error:unknown)=>boolean;
  settleInterruptedImage:(input:{documentId:string;tokenReservationId:string;costReservationId:string})=>Promise<unknown>;
};

/** One native Image implementation; each caller establishes its own authority
 * before supplying source, original reservations, and guarded native writes. */
async function executeNativeImageOperation(input:NativeImageOperationInput):Promise<Response>{
  const {env,body,ownerId,storageOwnerId,billingOwnerId,streamId,userActor,executionScope,projectBudgetScope,execution,
    readEvents,current,client,corr,appendOperationEvents,settleOperationOutputBudgets,refuseProviderClaim,settleInterruptedImage}=input;
  if(!env.OPENAI_API_KEY)return Response.json({error:"provider_not_configured"},{status:503});
  const promptTechnique=normalizePromptTechnique(body.promptTechnique);const promptFanId=body.promptFanId?String(body.promptFanId):null;
  const sourceEvents=await readEvents(env,streamId);const projection=foldEvents(sourceEvents,Number.POSITIVE_INFINITY,body.documentId);const constraints=standingConstraints(sourceEvents).map(item=>({preference_id:item.preferenceId,axis:item.axis,value:item.value,polarity:item.polarity,authority:"authored",source_event_refs:item.evidenceRefs,source_claim_ref:item.sourceClaimRef??null}));const uploadedReferences=await uploadedPixelReferences(env,storageOwnerId,projection,sourceEvents,body.snapshot,executionScope);
  const reserved=execution?.output?.reservations.maximumTokens??32_000;const reservation=execution?.output?{ok:true as const,reservationId:execution.output.reservations.reservationId,reservedTokens:reserved,period:execution.output.reservations.costReservationPeriod}:await reserveBudget(env,billingOwnerId,reserved,{streamId,correlationId:corr,operation:"image-generation",projectScope:projectBudgetScope});if(!reservation.ok){const denied=makeEvent(streamId,current+1,"worker:policy",client,corr,"BudgetExceeded",{reason:"hard_cap_reached",scope:reservation.scope,reserved_tokens:0,operation:"image-generation"});await insertEvent(env,denied).run();const detail=applicationFailureDetail("budget_hard_cap_reached",reservation.scope,429);return Response.json({error:detail.code,errorDetail:publicFailureDetail(detail),scope:reservation.scope},{status:429});}
  const imageCostReservation=execution?.output?{ok:true as const,reservationId:execution.output.reservations.costReservationId,reservedMicrousd:execution.output.reservations.costReservationMicrousd,period:execution.output.reservations.costReservationPeriod}:await reserveCostBudget(env,billingOwnerId,1_000_000,{maximumMicrousd:1_000_000,allowUserOverage:false,streamId,correlationId:corr,operation:"image-generation",period:reservation.period,projectScope:projectBudgetScope});if(!imageCostReservation.ok){await releaseBudget(env,billingOwnerId,reservation.reservationId,{reason:"image_generation_cost_cap_reached"});const detail=applicationFailureDetail("budget_hard_cap_reached",imageCostReservation.scope,429);return Response.json({error:detail.code,errorDetail:publicFailureDetail(detail),scope:imageCostReservation.scope},{status:429});}
  const id=uuidV7();const plannerModel=env.OPENAI_MODEL??"gpt-5.6-terra";
  let sequence=current;const registryEvents:EventRow[]=[];
  const selectedPreview=body.sourcePreviewId?[...sourceEvents].reverse().find((event)=>event.type==="IdeationPreviewCompleted"&&String(event.payload.document_id??"")===projection.documentId&&previewObjectId(event)===body.sourcePreviewId):undefined;const previewImage=selectedPreview?await readGeneratedImageReference(env,storageOwnerId,selectedPreview.payload.media_url):null;const previewReference:ImageReference|null=previewImage?{...previewImage,label:"Selected ideation preview",source:"ideation-preview"}:null;const imageReferences=[...(previewReference?[previewReference]:[]),...uploadedReferences];const referenceInputs=referenceInputReceipts(imageReferences);const imageSnapshot=body.snapshot??snapshotForProjection(projection);const managedImage=body.productionMode==="managed"?buildManagedProductionPlan("image",{...imageSnapshot,standing_constraints:constraints}):null;const productionFields=managedImageEventFields(managedImage);const compiledSnapshot={...imageSnapshot,document:{id:projection.documentId,title:projection.documentTitle},standing_constraints:constraints,reference_inputs:referenceInputs,...(managedImage?{production_brief:managedImageBrief(managedImage)}:{})};const selectedImageFormat=execution?.output?.imageRender?{format:execution.output.imageRender.format,blockId:null}:documentImageFormat(compiledSnapshot);const fullRender=execution?.output?.imageRender??providerRenderFormat(selectedImageFormat.format,"full");const imageFormatFields={...imageFormatEventFields(selectedImageFormat.format,"full",selectedImageFormat.blockId),...(execution?.output?.imageRender?{provider_render_size:execution.output.imageRender.size,size:execution.output.imageRender.size}:{})};const contextHash=await creativeContextHash(compiledSnapshot);const imageSelection=selectImageAdapter(env,{quality:"high",size:fullRender.size,references:imageReferences,promptTechnique});const imageModel=imageSelection.model;const adapterVersion=`${imageSelection.adapterId}-${imageSelection.adapterVersion}`;if(!sourceEvents.some(event=>event.type==="ModelRegistered"&&event.payload.model_id===imageModel))registryEvents.push(makeEvent(streamId,++sequence,"worker:registry",client,corr,"ModelRegistered",{model_id:imageModel,planner_model_id:plannerModel,provider:imageSelection.providerName,status:"human-gated"}));if(!sourceEvents.some(event=>event.type==="AdapterVersioned"&&event.payload.adapter_id===imageSelection.adapterId&&event.payload.version===imageSelection.adapterVersion))registryEvents.push(makeEvent(streamId,++sequence,"worker:registry",client,corr,"AdapterVersioned",{adapter_id:imageSelection.adapterId,version:imageSelection.adapterVersion,contract_version:7,selection_reason:imageSelection.reason,reference_handoff:imageSelection.capabilities.includes("reference-pixel-input"),multiple_image_input:imageSelection.capabilities.includes("multiple-image-input"),block_level_reference_policy:true,block_level_image_format:true,streaming_previews:imageSelection.capabilities.includes("streaming-previews")}));if(!sourceEvents.some(event=>event.type==="CapabilityDeclared"&&event.payload.model_id===imageModel&&Array.isArray(event.payload.capabilities)&&(event.payload.capabilities as unknown[]).includes("block-level-image-format")))registryEvents.push(makeEvent(streamId,++sequence,"worker:registry",client,corr,"CapabilityDeclared",{model_id:imageModel,capabilities:imageSelection.capabilities}));const priorFanPromotion=promptFanId?[...sourceEvents].reverse().find((event)=>event.type==="IdeationPromoted"&&event.payload.prompt_fan_id===promptFanId):undefined;const promotionId=selectedPreview?(priorFanPromotion?String(priorFanPromotion.payload.promotion_id):uuidV7()):null;const promotionEvents:EventRow[]=[];
  if(selectedPreview&&!priorFanPromotion){const intervening=sourceEvents.filter((event)=>event.sequence>selectedPreview.sequence);const changes=intervening.filter((event)=>/^(BlockCreated|BlockPropertyEdited|BlockWeightSet|BlockRemoved|BlockRestored|ChipEdited|ExtractionCompleted)$/.test(event.type));promotionEvents.push(makeEvent(streamId,++sequence,userActor,client,corr,"IdeationPromoted",{promotion_id:promotionId,document_id:projection.documentId,draft_event_id:selectedPreview.eventId,draft_sequence:selectedPreview.sequence,draft_generation_id:String(selectedPreview.payload.generation_id??""),draft_object_id:previewObjectId(selectedPreview),full_generation_id:id,source_surface:body.sourceSurface??"studio",prompt_fan_id:promptFanId,elapsed_to_intent_ms:Math.max(0,Date.now()-Date.parse(selectedPreview.occurredAt)),intervening_event_count:Math.max(0,current-selectedPreview.sequence),document_change_count:changes.length,conversation_turn_count:intervening.filter((event)=>event.type==="ChatMessageSent").length,context_changed:changes.length>0,intent_weight:1,system_success_pending:true}));}
  const workflowLineage=body.workflowId&&body.workflowStageId?{workflow_id:body.workflowId,workflow_stage_id:body.workflowStageId,workflow_sources:body.workflowSources??[]} : {};
  const requestedAt=makeEvent(streamId,++sequence,userActor,client,corr,"GenerationRequested",{generation_id:id,stream_id:streamId,model_ids:[plannerModel,imageModel],document_id:projection.documentId,...workflowLineage,canvas_id:body.canvasId??null,context_set_id:body.contextSetId??null,document_version:current,requested_output:"image",quality:"high",purpose:"final",...imageFormatFields,...productionFields,source_surface:body.sourceSurface??"studio",promotion_id:promotionId,reference_preview_event_id:selectedPreview?.eventId??null,prompt_technique:promptTechnique,prompt_fan_id:promptFanId,preflight_id:body.preflightId??null,preflight_version:body.preflightVersion??null,preflight_risk_acknowledged:Boolean(body.preflightAcknowledged),reference_input_count:referenceInputs.length,reference_inputs:referenceInputs,used_ideation_preview_pixels:Boolean(previewReference),used_uploaded_reference_pixels:uploadedReferences.length>0},{causationId:promotionEvents[0]?.eventId??priorFanPromotion?.eventId??null});
  const compiled=makeEvent(streamId,++sequence,"worker:compiler",client,corr,"ContextCompiled",{generation_id:id,document_id:projection.documentId,project_id:projection.projectId,...workflowLineage,canvas_id:body.canvasId??null,context_set_id:body.contextSetId??null,model_id:imageModel,planner_model_id:plannerModel,provider:imageSelection.providerName,adapter_version:adapterVersion,adapter_selection_reason:imageSelection.reason,...imageFormatFields,...productionFields,compiled_snapshot:compiledSnapshot,context_hash:contextHash,source_block_versions:body.sourceBlockVersions??[],quality:"high",purpose:"final",source_surface:body.sourceSurface??"studio",promotion_id:promotionId,reference_preview_event_id:selectedPreview?.eventId??null,prompt_technique:promptTechnique,prompt_fan_id:promptFanId,reference_input_count:referenceInputs.length,reference_inputs:referenceInputs,used_ideation_preview_pixels:Boolean(previewReference),used_uploaded_reference_pixels:uploadedReferences.length>0},{causationId:requestedAt.eventId});
  const budgeted=makeEvent(streamId,++sequence,"worker:policy",client,corr,"BudgetReserved",{generation_id:id,reservation_id:reservation.reservationId,cost_reservation_id:imageCostReservation.reservationId,reserved_tokens:reserved,reserved_microusd:imageCostReservation.reservedMicrousd,period:imageCostReservation.period,operation:"image-generation"},{causationId:requestedAt.eventId});
  await appendOperationEvents(env,[...registryEvents,...promotionEvents,requestedAt,compiled,budgeted]);
  const observePaid=paidProviderObserver(body as Record<string,unknown>,execution?.progress,{reservationId:reservation.reservationId,costReservationId:imageCostReservation.reservationId,costReservationPeriod:imageCostReservation.period,costReservationMicrousd:imageCostReservation.reservedMicrousd},execution?.output?.observeProvider);
  try{
    if(selectedPreview&&!previewReference)throw new Error("selected_preview_unavailable");
    const privateContent=promptFanId?await loadPrivateContent(env,ownerId,"all",executionScope):{};const cachedFanEvent=promptFanId?[...sourceEvents].reverse().find((event)=>event.type==="GenerationCompleted"&&event.payload.prompt_fan_id===promptFanId&&event.payload.output_ref):undefined;const cachedFanRaw=cachedFanEvent?privateContent[String(cachedFanEvent.payload.output_ref??"")]:undefined;let planned:Awaited<ReturnType<typeof generateCreativeDirection>>;let planningSource:"fan-cache"|"provider"="provider";await execution?.progress("planning",cachedFanRaw?"Checking the fan for a reusable visual direction.":"Turning the document context into a concrete visual direction.");if(!await claimCostBudgetReservation(env,billingOwnerId,imageCostReservation.reservationId))return refuseProviderClaim({operation:"image-generation",tokenReservationId:reservation.reservationId,costReservationId:imageCostReservation.reservationId,reservedTokens:reserved,reservedMicrousd:imageCostReservation.reservedMicrousd,causationId:budgeted.eventId});if(cachedFanRaw){try{planned={responseId:String(cachedFanEvent?.payload.planner_response_id??""),model:String(cachedFanEvent?.payload.planner_model_id??plannerModel),output:JSON.parse(cachedFanRaw) as Record<string,unknown>,raw:cachedFanRaw,latencyMs:0,usage:{inputTokens:0,outputTokens:0,totalTokens:0}};planningSource="fan-cache";}catch{planned=await generateCreativeDirection(env,ownerId,compiledSnapshot,execution?.signal,body.locale,observePaid,execution?.output?{onBeforeProviderAttempt:execution.output.beforeProviderAttempt,onBeforeProviderDispatch:execution.output.beforeProviderDispatch,outputTargetInstructions:String(execution.output.settings.outputTargetInstructions??"")}:undefined);}}else planned=await generateCreativeDirection(env,ownerId,compiledSnapshot,execution?.signal,body.locale,observePaid,execution?.output?{onBeforeProviderAttempt:execution.output.beforeProviderAttempt,onBeforeProviderDispatch:execution.output.beforeProviderDispatch,outputTargetInstructions:String(execution.output.settings.outputTargetInstructions??"")}:undefined);const image=await generateCreativeImage(env,ownerId,compiledSnapshot,planned.output,{safetyAcknowledgement:execution?.safetyAcknowledgement,quality:"high",size:fullRender.size,references:imageReferences,promptTechnique,signal:execution?.signal,onProviderSubmission:observePaid,onStage:execution?.progress,...(execution?.output?{onBeforeProviderAttempt:execution.output.beforeProviderAttempt,onBeforeProviderDispatch:execution.output.beforeProviderDispatch,onBeforeSourceTransmission:execution.output.beforeSourceTransmission,outputImageFormat:execution.output.imageRender?.format,outputFalImage:execution.output.settings.outputFalImage,onOutputFalRequest:(request,details)=>execution.output!.retainFalImageRequest(request,{generationId:id,planned,planningSource,promptTechnique,...details}),outputTargetInstructions:String(execution.output.settings.outputTargetInstructions??"")}:{})});await execution?.beginCommit();const media=await storeGeneratedImage(env,storageOwnerId,id,image.bytes,image.model,image.mimeType,{provider:image.provider,adapter:`${image.adapterId}-${image.adapterVersion}`,providerRequestId:image.providerRequestId??""});
    const stored=await storePrivateContent(env,ownerId,"provider-output",planned.raw,executionScope);const promptStored=await storePrivateContent(env,ownerId,"prompt",image.prompt,executionScope);const totalTokens=planned.usage.totalTokens+image.usage.totalTokens;if(!execution?.output)await settleBudget(env,billingOwnerId,reservation.reservationId,totalTokens);
    const next=await streamHead(env,streamId);const generatedObjectId=`object-${id.slice(-8)}`;const complete=makeEvent(streamId,next+1,"worker:generator",client,corr,"GenerationCompleted",{generation_id:id,document_id:projection.documentId,...workflowLineage,canvas_id:body.canvasId??null,context_set_id:body.contextSetId??null,model_id:image.model,planner_model_id:planned.model,provider:image.provider,provider_request_id:image.providerRequestId,provider_submission_id:image.providerSubmissionId,planner_response_id:planned.responseId,provider_created_at:image.createdAt,object_id:generatedObjectId,object_ids:[generatedObjectId],title:String(planned.output.title??projection.documentTitle).trim(),output_ref:stored.contentId,prompt_ref:promptStored.contentId,prompt_technique:promptTechnique,prompt_fan_id:promptFanId,content_expires_at:stored.expiresAt,media_url:media.url,media_type:media.mimeType,source_content_hash:media.contentHash,image_width:image.width,image_height:image.height,quality:"high",purpose:"final",...imageFormatFields,...productionFields,source_surface:body.sourceSurface??"studio",promotion_id:promotionId,reference_preview_event_id:selectedPreview?.eventId??null,promoted_from_generation_id:selectedPreview?String(selectedPreview.payload.generation_id??""):null,promoted_from_object_id:selectedPreview?previewObjectId(selectedPreview):null,promotion_outcome:promotionId?"completed":null,context_hash:contextHash,planning_source:planningSource,planning_cache_hit:planningSource==="fan-cache",reference_input_count:referenceInputs.length,reference_inputs:referenceInputs,used_ideation_preview_pixels:Boolean(previewReference),used_uploaded_reference_pixels:uploadedReferences.length>0,latency_ms:planned.latencyMs+image.latencyMs,planning_latency_ms:planned.latencyMs,image_latency_ms:image.latencyMs,adapter_version:`${image.adapterId}-${image.adapterVersion}`,simulation:false},{causationId:compiled.eventId});
    const imageCost={...providerCostReceipt([priceTextUsageBreakdownMicrousd(planned.model,planned.usage),image.costBreakdown]),...("pricingVersion" in image?{image_pricing_version:image.pricingVersion}:{})};if(execution?.output)await settleOperationOutputBudgets({reservationId:reservation.reservationId,costReservationId:imageCostReservation.reservationId,usedTokens:totalTokens,usedMicrousd:imageCost.cost_microusd});else await settleCostBudget(env,billingOwnerId,imageCostReservation.reservationId,imageCost.cost_microusd);const usage=makeEvent(streamId,next+2,"worker:policy",client,corr,"GenerationUsageRecorded",{generation_id:id,document_id:projection.documentId,reservation_id:reservation.reservationId,cost_reservation_id:imageCostReservation.reservationId,...productionFields,input_tokens:planned.usage.inputTokens+image.usage.inputTokens,output_tokens:planned.usage.outputTokens+image.usage.outputTokens,total_tokens:totalTokens,planner_tokens:planned.usage.totalTokens,image_tokens:image.usage.totalTokens,planner_input_tokens:planned.usage.inputTokens,planner_output_tokens:planned.usage.outputTokens,image_text_input_tokens:image.usage.textInputTokens??0,image_input_tokens:image.usage.imageInputTokens??image.usage.inputTokens,image_output_tokens:image.usage.outputTokens,reserved_tokens:reserved,reserved_microusd:imageCostReservation.reservedMicrousd,model_ids:[planned.model,image.model],operation:"image-generation",quality:"high",promotion_id:promotionId,image_cost_precision:image.costPrecision,...imageCost},{causationId:complete.eventId});await appendOperationEvents(env,[complete,usage]);if(!execution?.output)await observeProviderSuccess(env);return Response.json({appended:[...registryEvents,...promotionEvents,requestedAt,compiled,budgeted,complete,usage],content:{[stored.contentId]:planned.raw},rejected:[],head:usage.sequence,simulation:false,promoted:Boolean(promotionId)});
  }catch(error){
    if(input.isAuthorityStop?.(error))throw error;
    if(execution?.signal.aborted||error instanceof Error&&error.message==="document_job_canceled")throw error;
    if(execution?.output?.dispatchStop(error))throw error;
    await execution?.beginCommit();
    let detail=classifyProviderFailure(error);
    if(hasUnresolvedProviderSubmission(body as Record<string,unknown>))detail={...detail,code:"provider_submission_uncertain",category:"network",scope:"network",action:"contact_support",message:"The paid request may already have reached its provider. Its reservation is held; no duplicate request will be submitted automatically.",retryable:false,retryAfterMs:null};
    await observeProviderFailure(env,detail);
    const moderationPrompt=await retainFailurePrompt(env,ownerId,error,executionScope);
    if(execution?.output)await settleOperationOutputBudgets({reservationId:reservation.reservationId,costReservationId:imageCostReservation.reservationId,reason:"generation_failed"});
    else await settleInterruptedImage({documentId:projection.documentId,tokenReservationId:reservation.reservationId,costReservationId:imageCostReservation.reservationId});
    const next=await streamHead(env,streamId);
    const failed=makeEvent(streamId,next+1,"worker:generator",client,corr,"GenerationFailed",{generation_id:id,document_id:projection.documentId,canvas_id:body.canvasId??null,context_set_id:body.contextSetId??null,model_id:imageModel,planner_model_id:plannerModel,quality:"high",purpose:"final",...imageFormatFields,...productionFields,source_surface:body.sourceSurface??"studio",promotion_id:promotionId,promotion_outcome:promotionId?"failed":null,prompt_ref:moderationPrompt?.ref??null,prompt_expires_at:moderationPrompt?.expiresAt??null,prompt_technique:promptTechnique,prompt_fan_id:promptFanId,...failureEventFields(detail)},{causationId:compiled.eventId});
    await appendOperationEvents(env,[failed]);
    return Response.json({error:detail.code,errorDetail:publicFailureDetail(detail),moderationPromptRef:moderationPrompt?.ref??null,appended:[...registryEvents,...promotionEvents,requestedAt,compiled,budgeted,failed],content:moderationPrompt?{[moderationPrompt.ref]:moderationPrompt.prompt}:undefined,head:failed.sequence,promoted:Boolean(promotionId)},{status:detail.httpStatus===429?429:502});
  }
}

/** Dormant genuine-guest Image adapter. Authority and the actual heartbeat
 * control come from private registries; request JSON never supplies execution. */
export async function executeGuestImageEvents(request:Request,env:WorkerEnv,authority:GuestImageExecutionAuthority,control:EventExecutionControl):Promise<Response>{
  const refused=():never=>{throw new Error("guest_image_events_authority_unavailable");};
  requireGuestImageJobControl(request,env,authority,control);
  const output=control.output;
  if(!output)return refused();
  const claimRefusal=new Error("guest_image_provider_claim_unavailable");
  const current=()=>{
    const frame=requireGuestImageExecution(request,env,authority);
    requireGuestImageJobControl(request,env,authority,control);
    requireGuestImageEventExecution(request,env,authority,output);
    frame.assertCurrent();
    if(control.output!==output||control.signal.aborted||frame.identity.actorKind!=="guest"
      ||frame.identity.ownerUserId!==frame.identity.actorUserId||frame.job.kind!=="generate"
      ||frame.job.owner_id!==frame.identity.ownerUserId||frame.job.stream_id!==frame.identity.streamId
      ||frame.job.document_id!==frame.scope.documentId||frame.job.source_surface!=="outputs"
      ||output.financialPayerUserId!==frame.identity.payerUserId||output.sponsorFinancialBinding!==frame.financial
      ||sponsorFinancialEventProfile(frame.financial,env,frame.identity.actorUserId,output.reference)!=="image"
      ||frame.settings.kind!=="generate"||frame.settings.payload.productionMode!=="manual"||!frame.settings.imageRender
      ||frame.settings.calls.length!==2||frame.settings.calls[0]?.stage!=="planning:initial"||frame.settings.calls[1]?.stage!=="image:initial"
      ||frame.settings.calls.some(call=>call.provider!=="openai")||frame.slot.provider!=="openai"
      ||(env.FORMA_IMAGE_PROVIDER??"openai").trim().toLowerCase()!=="openai"
      ||sponsorEventJson(output.settings)!==sponsorEventJson(frame.settings.payload)
      ||sponsorEventJson(output.imageRender)!==sponsorEventJson(frame.settings.imageRender))return refused();
    return frame;
  };
  const frame=current(),original:unknown=JSON.parse(frame.job.request_json);
  if(!original||typeof original!=="object"||Array.isArray(original))return refused();
  const body=original as NativeImageOperationBody;
  // The original bounded recipe has no reference, chat, preview, fan, workflow,
  // or private-input recovery path. Do not read or silently omit such inputs.
  if(["sourcePreviewId","sourceChatTurnId","directionRef","directionModel","promptFanId","workflowId","workflowStageId","workflowSources","jobInputRef","outputFalImage","message","prompt"].some(key=>Object.hasOwn(body,key))
    ||body.productionMode!=="manual"||body.artifactKind!==undefined&&body.artifactKind!=="")return refused();
  clearPresentationServerOwnedCheckpointFields(body);delete body.expectedSequence;delete body.jobInputRef;
  const sourceEvents=[...frame.sourceEvents];
  const trusted=authoritativeCreativeContext(sourceEvents,{documentId:frame.scope.documentId,projectId:frame.scope.projectId,
    canvasId:body.canvasId,contextSetId:body.contextSetId,snapshot:body.snapshot,sourceBlockVersions:body.sourceBlockVersions});
  const facts=Array.isArray(trusted.snapshot.facts)?trusted.snapshot.facts:[];
  if(facts.some(fact=>fact&&typeof fact==="object"&&["reference","model3d","audio"].includes(String((fact as Record<string,unknown>).type)))
    ||sponsorEventJson(trusted.snapshot)!==sponsorEventJson(frame.context.snapshot)
    ||sponsorEventJson(trusted.sourceBlockVersions)!==sponsorEventJson(frame.context.sourceBlockVersions)
    ||trusted.documentRevision!==frame.context.documentRevision)return refused();
  current();await output.assertContext(trusted);current();
  Object.assign(body,frame.settings.payload,output.reservations,{action:"generate",documentId:frame.scope.documentId,
    snapshot:trusted.snapshot,sourceBlockVersions:trusted.sourceBlockVersions,documentRevision:trusted.documentRevision,
    sourceSurface:"outputs",clientId:"server:guest-output",correlationId:frame.job.correlation_id,outputExecution:output.reference});
  const selected=selectImageAdapter(env,{quality:"high",size:frame.settings.imageRender!.size,references:[],promptTechnique:normalizePromptTechnique(body.promptTechnique)});
  if(selected.providerName!=="openai"||selected.model!==frame.slot.model)return refused();
  const settleOperationOutputBudgets=async(input:Parameters<typeof settleDocumentGenerationBudgets>[2])=>{
    current();
    const settled=await settleGuestImageExecutionBudgets(request,env,authority,output,input);
    current();return settled;
  };
  current();
  const response=await executeNativeImageOperation({env:output.guardedEnvironment,body,ownerId:frame.identity.ownerUserId,
    storageOwnerId:frame.identity.ownerUserId,billingOwnerId:frame.identity.payerUserId,streamId:frame.identity.streamId,
    userActor:frame.identity.actorUserId,execution:control,current:output.sourceHead,client:"server:guest-output",corr:frame.job.correlation_id,
    readEvents:async()=>{current();return sourceEvents;},appendOperationEvents:createOperationEventAppender(control),settleOperationOutputBudgets,
    refuseProviderClaim:async()=>{current();throw claimRefusal;},isAuthorityStop:error=>error===claimRefusal,
    settleInterruptedImage:async()=>refused(),
  });
  current();return response;
}

/** Legacy chat must inspect its selected native references before missing or
 * excluded bodies could silently pull older history into the provider window. */
export async function legacyChatMemoryProof(env:WorkerEnv,streamId:string,selected:readonly {eventId:string;contentRef:string}[]){
  return legacyChatMemoryProofBounded(env,streamId,selected,12);
}
async function legacyChatMemoryProofBounded(env:WorkerEnv,streamId:string,selected:readonly {eventId:string;contentRef:string}[],maximum:12|128){
  if(selected.length>maximum)throw new Error("assistant_memory_paid_ancestry_unsupported");
  const exclusion=await nativeMemoryAnswerExclusion(env,{answerAlias:"content"});
  return{sql:`NOT EXISTS(WITH selected AS(SELECT value FROM json_each(?)), refs AS(
      SELECT json_extract(value,'$.contentRef') AS content_id FROM selected UNION
      SELECT json_extract(event.payload,'$.content_ref') FROM selected JOIN events event
        ON event.event_id=json_extract(selected.value,'$.eventId') AND event.stream_id=?),
      contents AS(SELECT refs.content_id,COALESCE(private.kind,'') AS kind FROM refs LEFT JOIN private_content private ON private.content_id=refs.content_id)
    SELECT 1 FROM contents content WHERE NOT (${exclusion.sql}))
    AND NOT EXISTS(SELECT 1 FROM json_each(?) selected JOIN events event ON event.event_id=json_extract(selected.value,'$.eventId')
      AND event.stream_id=? WHERE event.type='AssistantReasoned' AND json_type(event.payload,'$.memory_origin_version') IS NOT NULL)`,
    bindings:[JSON.stringify(selected),streamId,...exclusion.bindings,JSON.stringify(selected),streamId]};
}

export async function handleEvents(request:Request,env:WorkerEnv,hot=false,userOverride?:PilotUser,execution?:EventExecutionControl):Promise<Response>{
  const sponsorEnvironment=env;
  try{
    await ensureSchema(env);if(execution?.output)env=execution.output.guardedEnvironment;
    const appendOperationEvents=createOperationEventAppender(execution);const inspection=request.method==="GET"&&new URL(request.url).searchParams.get("audit")==="1";const hasProjectCookie=hasProjectContextCookie(request);const auth=userOverride?{response:null,user:userOverride}:await requireUser(request,env,inspection?"admin":request.method==="GET"||hasProjectCookie?"viewer":"creator",hasProjectCookie?{account:"principal"}:{});if(auth.response||!auth.user)return auth.response!;
    const selected=hasProjectCookie?await readProjectRequestContext(request,env,auth.user):{context:null,response:null};
    if(selected.response)return selected.response;
    if(selected.context){
      if(inspection)return Response.json({error:"project_operation_unavailable"},{status:403});
      if(request.method==="GET"){
        const url=new URL(request.url);
        return Response.json(await readProjectEventPage(env,selected.context,Number(url.searchParams.get("after")??0),Number(url.searchParams.get("limit")??5000),url.searchParams.get("content")!=="0",undefined,url.searchParams.get("stillDocument")??undefined,url.searchParams.getAll("contentId").slice(0,20)));
      }
      if(request.method!=="POST")return new Response("Method not allowed",{status:405});
      const consent=requireConsent(auth.user);if(consent)return consent;
      const selectedBody=await request.json() as Parameters<typeof appendGovernedArtifactView>[4];
      const selectedEvents=selectedBody.events??(selectedBody.event?[selectedBody.event]:[]);
      if(selectedEvents.some(event=>event.type==='DocumentViewVisited'))return appendNativeDocumentView(request,env,auth.user,selectedBody,selected.context);
      if(selectedEvents.some(event=>event.type==='BlockInspected'))return appendNativeBlockInspection(request,env,auth.user,selectedBody,selected.context);
      if(selectedEvents.some(event=>event.type==='DocumentArtifactViewed'))return appendGovernedArtifactView(request,env,auth.user,selected.context,selectedBody);
      if(hot)return Response.json({error:'project_operation_unavailable'},{status:403});
      return appendProjectEvents(env,selected.context,auth.user,selectedBody);
    }
    let executionScope=auth.user.projectExecution;
    const ownerId=auth.user.userId,storageOwnerId=executionScope?.ownerUserId??ownerId,actorUserId=auth.user.userId,streamId=auth.user.streamId,userActor=executionScope?`user:${auth.user.userId}`:"user";
    const ordinaryBillingOwnerId=auth.user.billingUserId??actorUserId;
    // Native execution supplies the payer resolved from its committed grant and
    // reservations. It never changes the principal that owns creative content.
    const billingOwnerId=execution?.output?execution.output.financialPayerUserId:ordinaryBillingOwnerId;
    if(typeof billingOwnerId!=="string"||!billingOwnerId)return Response.json({error:"output_financial_authority_required"},{status:403});
    const sponsoredOutput=Boolean(execution?.output?.sponsorFinancialBinding);
    if(sponsoredOutput&&(executionScope||auth.user.fictional||ordinaryBillingOwnerId!==actorUserId))return Response.json({error:"sponsor_personal_principal_required"},{status:403});
    await seedIfEmpty(env,streamId);
    const settleOperationOutputBudgets=async(input:Parameters<typeof settleDocumentGenerationBudgets>[2])=>{
      if(execution?.output?.accountSettlement)return {settled:false,status:"known" as const,receipt:execution.output.accountSettlement};
      const settled=await settleDocumentGenerationBudgets(env,billingOwnerId,{...input,assertions:[...(input.assertions??[]),...(execution?.output?.financialAssertions??[])]});
      if(execution?.output&&settled.receipt)execution.output.accountSettlement=settled.receipt;
      return settled;
    };
    if(request.method==="GET"){
      const url=new URL(request.url);const after=Math.max(0,Math.floor(Number(url.searchParams.get("after")??0))||0);
      if(inspection){const page=await readAuditEventPage(env,streamId,{before:Number(url.searchParams.get("before")??0),asOf:Number(url.searchParams.get("asOf")??0),limit:Number(url.searchParams.get("limit")??150),actor:url.searchParams.get("actor")??"",type:url.searchParams.get("type")??"",correlation:url.searchParams.get("correlation")??""});return Response.json({...presentActorArtifactPage(page,auth.user.userId),permissionSchemaVersion:PERMISSION_SCHEMA_VERSION});}
      const routeDocument=url.searchParams.get("stillDocument");
      if(routeDocument!==null)return Response.json(presentActorArtifactPage(await readStillRoutePage(env,streamId,routeDocument.slice(0,180),after,5000),auth.user.userId));
      const profile=url.searchParams.get("profile");
      if(isScopedEventProfile(profile)){
        const limit=Math.max(1,Math.min(SCOPED_EVENT_PAGE_SIZE,Math.floor(Number(url.searchParams.get("limit")??SCOPED_EVENT_PAGE_SIZE))||SCOPED_EVENT_PAGE_SIZE));
        const page=await readProfileEventPage(env,streamId,profile,after,limit);
        return Response.json({...presentActorArtifactPage(page,auth.user.userId),permissionSchemaVersion:PERMISSION_SCHEMA_VERSION});
      }
      const contentScope=url.searchParams.get("contentScope");if(contentScope!==null&&contentScope!=="chat"&&contentScope!=="memory")return Response.json({error:"invalid_content_scope"},{status:400});
      const limit=Math.max(1,Math.min(5000,Math.floor(Number(url.searchParams.get("limit")??5000))||5000));
      const [page,content]=await Promise.all([readEventPageWithHead(env,streamId,after,limit),url.searchParams.get("content")==="0"?Promise.resolve(undefined):loadPrivateContent(env,ownerId,contentScope==="chat"?"chat":contentScope==="memory"?"memory":"all",executionScope,url.searchParams.has("contentId")?url.searchParams.getAll("contentId").slice(0,20):undefined)]);
      return Response.json({...presentActorArtifactPage(page,auth.user.userId),...(content?{content}:{}),permissionSchemaVersion:PERMISSION_SCHEMA_VERSION});
    }
    if(request.method!=="POST")return new Response("Method not allowed",{status:405});
    const consent=requireConsent(auth.user);if(consent)return consent;
    const body=await request.json() as {action?:"append"|"batch"|"canvas_sync"|"propose"|"preview"|"generate"|"chat"|"structure_adaptive"|"render_document"|"hot"|"evaluate_extractors"|"rebuild_index"|"extract_reference"|"calculate_focal_point"|"open_session"|"close_session"|"compose_brief"|"declare_intent"|"run_scout"|"refresh_taste_model"|"set_condition"|"check_conditions"|"critique_object";event?:EventInput;events?:EventInput[];expectedSequence?:number;clientId?:string;correlationId?:string;locale?:string;documentId?:string;documentRevision?:string;canvasId?:string;contextSetId?:string;projectScope?:boolean;prompt?:string;message?:string;livePreview?:boolean;sourceSurface?:string;sourcePreviewId?:string;sourceChatTurnId?:string;directionRef?:string;directionModel?:string;promptTechnique?:string;promptFanId?:string;preflightId?:string;preflightVersion?:string;preflightAcknowledged?:boolean;exemplarRefs?:Array<Record<string,unknown>>;snapshot?:Record<string,unknown>;sourceBlockVersions?:Array<Record<string,unknown>>;blockId?:string;referenceId?:string;targetKind?:"generation"|"reference"|"artifact";targetId?:string;mediaUrl?:string;sample?:ImageSample;findingKinds?:ReferenceFindingKind[];statement?:string;deadline?:string|null;maxObservations?:number;condition?:string;triggerKind?:"generation_count"|"on_date";threshold?:number;onDate?:string;objectId?:string;axis?:string;polarity?:"positive"|"negative";value?:string;note?:string;artifactId?:string;artifactKind?:DocumentArtifactKind;itemCount?:number;audience?:string;tone?:string;sceneMedium?:SceneMedium;sceneConfiguration?:SceneConfiguration;videoSeconds?:VideoDurationSeconds;videoSize?:"1280x720"|"720x1280";videoResolution?:"480p"|"720p";videoAudioMode?:VideoAudioMode;soundtrackBlockIds?:string[];sendSoundtrackToVideoProvider?:boolean;audioImageBlockId?:string;audioProfile?:AudioRequestProfile;audioProviderModel?:string;audioVideoArtifactId?:string;sendAudioVideoToProvider?:boolean;audioEstimatedCostMicrousd?:number;model3dPrompt?:string;model3dPromptSource?:"exact"|"document";model3dAdaptation?:Record<string,unknown>;model3dSettings?:unknown;model3dReferenceBlockIds?:string[];model3dInputReceipt?:Record<string,unknown>;model3dProviderSubmission?:string;paidMediaConfirmed?:boolean;productionMode?:ProductionMode;productionPlan?:ManagedProductionPlan;productionSceneReceipts?:Record<string,ProductionSceneReceipt>;productionFrameReceipts?:Record<string,ProductionFrameReceipt>;productionPrepaidSceneIds?:string[];productionPrepaidAnchor?:boolean;productionAnchor?:Record<string,unknown>;costReservationMicrousd?:number;budgetAcknowledged?:boolean;budgetWarningSuppressed?:boolean;providerJobId?:string;providerModel?:string;providerStatusUrl?:string;providerResponseUrl?:string;providerCancelUrl?:string;reservationId?:string;requestKey?:string;workflowId?:string;workflowStageId?:string;workflowSources?:ProductionWorkflowSource[];artifactPlan?:Record<string,unknown>;plannerModel?:string;plannerResponseId?:string;plannerLatencyMs?:number;plannerUsage?:Record<string,unknown>;plannerInput?:Record<string,unknown>;renderedItems?:Array<Record<string,unknown>>;videoInputReceipt?:Record<string,unknown>;audioInputReceipt?:Record<string,unknown>};
    if(sponsoredOutput){
      const output=execution!.output!,binding=output.sponsorFinancialBinding!;
      const profile=sponsorFinancialEventProfile(binding,sponsorEnvironment,actorUserId,output.reference);
      if(profile==="image"){
        if(body.action!=="generate")return Response.json({error:"sponsor_recipe_unsupported"},{status:403});
      }else if(profile==="short_story"){
        const settings=sponsorEventJson(output.settings),reference=sponsorEventJson(output.reference);
        const narrative=await readOutputNarrativePayload(output.settings);
        if(!narrative||body.action!=="render_document"||body.artifactKind!=="short_story"||body.productionMode!=="manual"||body.itemCount!==3
          ||sponsorEventJson(output.settings)!==settings||sponsorEventJson(output.reference)!==reference
          ||sponsorFinancialEventProfile(binding,sponsorEnvironment,actorUserId,output.reference)!=="short_story")
          return Response.json({error:"sponsor_recipe_unsupported"},{status:403});
      }else if(profile==="scene"){
        const settings=sponsorEventJson(output.settings),reference=sponsorEventJson(output.reference);
        const scene=await readOutputScenePayload(output.settings);
        if(!scene||body.action!=="render_document"||body.artifactKind!=="scene"||body.productionMode!=="manual"||body.itemCount!==1||body.sceneMedium!=="visual"
          ||!output.refreshSponsorSceneDispatch||!output.createSponsorScenePaidClaim||execution!.signal.aborted
          ||sponsorEventJson(output.settings)!==settings||sponsorEventJson(output.reference)!==reference
          ||sponsorFinancialEventProfile(binding,sponsorEnvironment,actorUserId,output.reference)!=="scene")
          return Response.json({error:"sponsor_recipe_unsupported"},{status:403});
      }else if(profile==="audio"){
        const settings=sponsorEventJson(output.settings),reference=sponsorEventJson(output.reference);
        // Native job execution strips this legacy checkpoint field from the
        // transport. Its price remains in the independently proved settings.
        const audio=readOutputAudioPayload(output.settings),supplied=readOutputAudioPayload({...body,audioEstimatedCostMicrousd:output.settings.audioEstimatedCostMicrousd});
        if(!audio||!supplied||sponsorEventJson(audio)!==sponsorEventJson(supplied)||body.action!=="render_document"
          ||!output.refreshSponsorAudioDispatch||!output.requireSponsorAudioDispatchCurrent||execution!.signal.aborted
          ||body.paidMediaConfirmed!==true||body.audioProviderModel!==output.settings.audioProviderModel
          ||body.audioEstimatedCostMicrousd!==undefined&&body.audioEstimatedCostMicrousd!==output.settings.audioEstimatedCostMicrousd
          ||body.audioProfile&&sponsorEventJson(body.audioProfile)!==sponsorEventJson(output.settings.audioProfile)
          ||(body as Record<string,unknown>).outputTargetInstructions!==output.settings.outputTargetInstructions)
          return Response.json({error:"sponsor_recipe_unsupported"},{status:403});
        await output.refreshSponsorAudioDispatch(execution!);
        output.requireSponsorAudioDispatchCurrent(execution!);
        if(sponsorEventJson(output.settings)!==settings||sponsorEventJson(output.reference)!==reference
          ||sponsorFinancialEventProfile(binding,sponsorEnvironment,actorUserId,output.reference)!=="audio")
          return Response.json({error:"sponsor_recipe_unsupported"},{status:403});
      }else if(profile==="slides"){
        const settings=output.settings,supplied=body as Record<string,unknown>,exactFive=sponsorEventJson({kind:"exact",unit:"slide",value:5});
        if(body.action!=="render_document"||body.artifactKind!=="slides"||body.productionMode!=="manual"||body.itemCount!==5
          ||supplied.requestedSlideCount!==5||sponsorEventJson(supplied.slideCountPolicy??null)!==exactFive
          ||settings.artifactKind!=="slides"||settings.productionMode!=="manual"||settings.itemCount!==5||settings.requestedSlideCount!==5
          ||sponsorEventJson(settings.slideCountPolicy??null)!==exactFive||typeof settings.outputTargetInstructions!=="string"
          ||supplied.outputTargetInstructions!==settings.outputTargetInstructions||settings.budgetAcknowledged!==true||settings.preflightAcknowledged!==true)
          return Response.json({error:"sponsor_recipe_unsupported"},{status:403});
      }else return Response.json({error:"sponsor_recipe_unsupported"},{status:403});
    }
    if(body.action==="render_document"&&body.videoResolution!==undefined){
      if(body.artifactKind!=="video"||!VIDEO_ADAPTER_CONTRACT.supportedResolutions.includes(body.videoResolution))return Response.json({error:"video_resolution_unsupported",supported:VIDEO_ADAPTER_CONTRACT.supportedResolutions},{status:400});
      if(body.productionMode==="managed")return Response.json({error:"managed_video_resolution_unsupported"},{status:400});
    }
    if(!execution?.output&&["outputExecution","outputTargetInstructions","outputImageFormat","outputFalImage","outputNarrative","narrativeContractDigest","contractDigest"].some((key)=>Object.hasOwn(body,key)))return Response.json({error:"output_execution_server_owned"},{status:400});
    if((body as {action?:unknown}).action==="project_intake"){
      const user=auth.user;
      return handleProjectIntake(env,{user,principal:"principal" in auth?auth.principal??user:user,impersonation:"impersonation" in auth?auth.impersonation??null:null},body);
    }
    if (body.action === "render_document") {
      if(body.artifactKind==="model3d"&&!execution)return Response.json({error:"model3d_job_required",message:"Start 3D generation through its saved document job so the accepted provider request remains recoverable.",attemptSubmission:"not-submitted"},{status:428});
      if(body.sceneMedium!==undefined&&!isSceneMedium(body.sceneMedium)){
        return Response.json({error:"scene_medium_unsupported",supported:SCENE_MEDIA},{status:400});
      }
      if(body.artifactKind!=="scene"&&(body.sceneMedium!==undefined||body.sceneConfiguration!==undefined)){
        return Response.json({error:"scene_configuration_scene_only"},{status:400});
      }
      if(body.artifactKind==="scene"){
        if(!execution)return Response.json({error:"scene_job_required",message:"Submit or retrieve this Scene through its original document job with the displayed source and cost approval.",attemptSubmission:"not-submitted"},{status:428});
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
      const outputTarget=outputAuthoringBlocksFromEvents(await readWorkspaceEvents(env,streamId)).find((block)=>block.id===target);
      if(outputTarget&&isOutputContextType(outputTarget.type))return Response.json({error:"output_requirement_endpoint_required",message:"Output requirements are authored in their dedicated editor, not replaced by extraction."},{status:409});
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
    const presentationRequest=body as typeof body&{presentationStyle?:SlideStylePresetId;presentationFidelity?:"faithful"|"creative";requestedSlideCount?:number;slideCountPolicy?:SlideCountPolicy;authoredSlideCount?:number};
    if(!execution&&(body.action==="preview"||body.action==="generate"||body.action==="render_document"&&body.artifactKind!=="slides")&&presentationServerOwnedCheckpointField(body as Record<string,unknown>))return Response.json({error:"media_recovery_state_server_owned",message:"Provider recovery state is restored only from an owner-scoped server checkpoint."},{status:400});
    if(body.action==="render_document"&&body.artifactKind==="slides"){
      if(!execution&&presentationServerOwnedCheckpointField(body as Record<string,unknown>))return Response.json({error:"presentation_recovery_state_server_owned",message:"Presentation recovery, provider receipts, and budget reservations can only come from an existing server-owned job checkpoint."},{status:400});
      const maximumSlideCount=body.productionMode==="managed"?MAX_MANAGED_PRESENTATION_SLIDES:MAX_MANUAL_PRESENTATION_SLIDES;
      try{
        const count=resolvePresentationCountRequest(presentationRequest);
        if(body.itemCount!==undefined||presentationRequest.requestedSlideCount!==undefined||count.slideCountPolicy)body.itemCount=count.itemCount;
        if(count.slideCountPolicy){presentationRequest.slideCountPolicy=count.slideCountPolicy;if(count.requestedSlideCount!==undefined)presentationRequest.requestedSlideCount=count.requestedSlideCount;}
      }catch(error){if(error instanceof PresentationCountPolicyError)return Response.json({error:error.code,message:error.message,supported:{minimum:1,maximum:maximumSlideCount}},{status:error.code==="presentation_slide_count_conflict"?409:400});throw error;}
      if(presentationRequest.presentationStyle!==undefined&&!isSlideStylePresetId(presentationRequest.presentationStyle)){
        return Response.json({error:"presentation_style_unsupported"},{status:400});
      }
      if(presentationRequest.presentationFidelity!==undefined&&presentationRequest.presentationFidelity!=="faithful"&&presentationRequest.presentationFidelity!=="creative"){
        return Response.json({error:"presentation_fidelity_unsupported"},{status:400});
      }
    }
    const paidOperation=["preview","generate","chat","structure_adaptive","render_document"].includes(body.action??"");
    const recoveringModel3d=Boolean(execution&&!execution.output&&body.action==="render_document"&&body.artifactKind==="model3d"
      &&body.providerJobId&&body.model3dInputReceipt&&body.snapshot&&!hasUnresolvedProviderSubmission(body as Record<string,unknown>)
      &&providerSubmissions(body as Record<string,unknown>).some((receipt)=>receipt.provider==="fal"&&receipt.operation==="model3d"
        &&receipt.providerRequestId===body.providerJobId&&receipt.model===body.model3dInputReceipt?.model
        &&(receipt.status==="accepted"||receipt.status==="completed")));
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
      paidSourceEvents=execution?.output?.sourceEvents??(executionScope?await readProjectSourceEvents(env,executionScope):await readWorkspaceEvents(env,streamId));
      const projection=foldEvents(paidSourceEvents,Number.POSITIVE_INFINITY,documentId,executionScope?.projectId??"");
      const document=projection.documents.find((candidate)=>candidate.id===(documentId||projection.documentId));
      if(!document)return Response.json({error:"document_not_found"},{status:404});
      if(executionScope&&document.projectId!==executionScope.projectId)return Response.json({error:"document_not_found"},{status:404});
      if(executionScope&&!execution?.output&&!recoveringModel3d&&!await governedPackageSourceRightsCurrent(env,executionScope.organizationId,projection.blocks))
        return Response.json({error:"context_source_rights_expired",message:"The original rights for an adopted organizational source are no longer valid."},{status:409});
      documentId=document.id;projectId=document.projectId;body.documentId=documentId;
      // An accepted Rodin request only retrieves its original result. Preserve
      // its frozen source receipt if a user changes the document while it runs.
      // Current document/project access above still applies; Output retains its
      // stricter source contract for independently authorized delivery.
      if(!recoveringModel3d&&(body.action==="preview"||body.action==="generate"||body.action==="render_document")){
        try{
          const characterScope=body as typeof body&{contextRootBlockId?:unknown;characterOutputKind?:unknown};
          const trusted=authoritativeCreativeContext(paidSourceEvents,{documentId,projectId,canvasId:body.canvasId,contextSetId:body.contextSetId,...(typeof characterScope.contextRootBlockId==="string"?{contextRootBlockId:characterScope.contextRootBlockId}:{}),...(characterScope.characterOutputKind==="headshot"||characterScope.characterOutputKind==="character_sheet"?{characterOutputKind:characterScope.characterOutputKind}:{}),snapshot:body.snapshot,sourceBlockVersions:body.sourceBlockVersions});
          authoritativeSnapshot=trusted.snapshot;body.snapshot=trusted.snapshot;body.sourceBlockVersions=trusted.sourceBlockVersions;body.documentRevision=trusted.documentRevision;
          if(execution?.output){
            await execution.output.assertContext(trusted);
            Object.assign(body,execution.output.settings,execution.output.reservations,{outputExecution:execution.output.reference});
          }
          if((body.action==="render_document"||body.action==="generate")&&(body.workflowId!==undefined||body.workflowStageId!==undefined||body.workflowSources!==undefined)){
            let workflowScope=executionScope;
            if(!workflowScope&&!auth.user.fictional&&ordinaryBillingOwnerId===ownerId){const scopes=await ownerDocumentBudgetScopes(env,ownerId,documentId,projectId);if(scopes.length>1)return Response.json({error:"ambiguous_project_budget_scope"},{status:409});if(scopes[0])workflowScope={organizationId:scopes[0].organizationId,projectAccessId:scopes[0].projectAccessId,projectId,ownerUserId:ownerId,actorUserId:ownerId};}
            const resolved=await resolveProductionWorkflowContext({env,events:paidSourceEvents,documentId,projectId,ownerId:workflowScope?.ownerUserId??ownerId,scope:workflowScope,snapshot:trusted.snapshot,workflowId:body.workflowId,workflowStageId:body.workflowStageId,workflowSources:body.workflowSources,requestedFormat:body.action==="generate"?"image":body.artifactKind});
            body.snapshot=resolved.snapshot;if(!(body.action==="render_document"&&body.artifactKind==="scene"))body.workflowSources=resolved.sources;
            if(body.action==="render_document"&&body.artifactKind==="scene"&&resolved.sceneConfiguration){
              body.sceneConfiguration=resolved.sceneConfiguration;
              body.sceneMedium=resolved.sceneConfiguration.medium;
            }
          }
          if(body.action==="render_document"&&body.artifactKind==="slides"){
            const sourceMinimumSlideCount=minimumPresentationSlideCount(body.snapshot??trusted.snapshot);
            const supportedMaximum=body.productionMode==="managed"?MAX_MANAGED_PRESENTATION_SLIDES:MAX_MANUAL_PRESENTATION_SLIDES;
            if(sourceMinimumSlideCount>supportedMaximum)return Response.json({error:"presentation_slide_count_invalid",message:`This presentation requires ${sourceMinimumSlideCount} source-authored slides, exceeding the ${supportedMaximum}-slide ${body.productionMode==="managed"?"managed":"manual"} limit.`,supported:{minimum:1,maximum:supportedMaximum},sourceMinimumSlideCount},{status:400});
            if(presentationRequest.slideCountPolicy)body.itemCount=resolvePresentationCountRequest(presentationRequest,sourceMinimumSlideCount).itemCount;
            const requested=Number(presentationRequest.requestedSlideCount??body.itemCount??0);
            if(requested>0&&requested<sourceMinimumSlideCount)return Response.json({error:"presentation_slide_count_conflict",message:`This presentation requires at least ${sourceMinimumSlideCount} source-authored or independently isolated slides; ${requested} would merge or omit required chapters.`,sourceMinimumSlideCount,authoredSlideCount:inferPresentationSourceOutline(body.snapshot??trusted.snapshot).authoredSlideCount??sourceMinimumSlideCount,requestedSlideCount:requested,plannedSlideCount:sourceMinimumSlideCount},{status:409});
            const sourceContract=buildPresentationSourceContract(body.snapshot??trusted.snapshot,{...(presentationRequest.slideCountPolicy?{slideCountPolicy:presentationRequest.slideCountPolicy,itemCount:body.itemCount}:requested>0?{requestedSlideCount:requested}:{})});
            if(sourceContract.sourceIssues?.length)return Response.json({error:"presentation_source_contract_invalid",message:sourceContract.sourceIssues[0]!.message,issues:sourceContract.sourceIssues},{status:422});
          }
        }catch(error){
          if(error instanceof PresentationCountPolicyError)return Response.json({error:error.code,message:error.message},{status:error.code==="presentation_slide_count_conflict"?409:400});
          if(error instanceof ContextIntegrityError)return Response.json({error:error.code,message:error.message},{status:error.code==="document_not_found"?404:409});
          if(error instanceof ProductionWorkflowContextError)return Response.json({error:error.code,message:error.message},{status:error.status});
          throw error;
        }
      }
    }
    const budgetScopes=paidOperation&&executionScope?[{organizationId:executionScope.organizationId,projectAccessId:executionScope.projectAccessId,actorUserId:executionScope.actorUserId}]:paidOperation&&!auth.user.fictional&&ordinaryBillingOwnerId===ownerId?await ownerDocumentBudgetScopes(env,ownerId,documentId,projectId):[];
    if(budgetScopes.length>1)return Response.json({error:"ambiguous_project_budget_scope"},{status:409});
    const projectBudgetScope=budgetScopes[0];
    if(sponsoredOutput){
      if(executionScope||projectBudgetScope)return Response.json({error:"sponsor_organization_budget_unsupported"},{status:403});
      const actorAllowance=await pilotExecutionAllowance(env,actorUserId);
      if(!actorAllowance.allowed||actorAllowance.pilot)return Response.json({error:"sponsor_managed_pilot_unsupported"},{status:403});
    }
    if(!executionScope&&projectBudgetScope){
      executionScope={organizationId:projectBudgetScope.organizationId,projectAccessId:projectBudgetScope.projectAccessId,projectId,ownerUserId:ownerId,actorUserId:ownerId};
      const governedProjection=foldEvents(paidSourceEvents!,Number.POSITIVE_INFINITY,documentId,projectId);
      if(!recoveringModel3d&&!await governedPackageSourceRightsCurrent(env,executionScope.organizationId,governedProjection.blocks))
        return Response.json({error:"context_source_rights_expired",message:"The original rights for an adopted organizational source are no longer valid."},{status:409});
    }
    const pilotAllowance=paidOperation?await pilotExecutionAllowance(env,billingOwnerId,projectBudgetScope):null;
    if(sponsoredOutput&&pilotAllowance?.pilot)return Response.json({error:"sponsor_managed_pilot_unsupported"},{status:403});
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
    let requestedModel3d:PreparedModel3dRequest|undefined;
    if(body.action==="render_document"&&body.artifactKind==="model3d"){
      if(!env.FAL_KEY)return Response.json({error:"model3d_provider_not_configured"},{status:503});
      if(body.productionMode==="managed")return Response.json({error:"model3d_production_mode_unsupported",message:"Review the exact 3D prompt and settings in a direct generation request."},{status:422});
      body.productionMode="manual";
      try{
        const referenceBlockIds=model3dReferenceSelection(body.model3dReferenceBlockIds);
        if(body.providerJobId&&body.model3dInputReceipt){
          const receipt=body.model3dInputReceipt;
          const checked=validateModel3dRequest({prompt:body.model3dPrompt,settings:body.model3dSettings,referenceCount:referenceBlockIds.length});
          if(!checked.valid)return Response.json({error:checked.issues[0]!.code,message:checked.issues[0]!.message,issues:checked.issues},{status:422});
          const retainedSettings=validateModel3dRequest({prompt:receipt.submittedPrompt,settings:receipt.settings,referenceCount:referenceBlockIds.length});
          if(receipt.submittedPrompt!==body.model3dPrompt||receipt.model!==checked.model||body.providerModel&&body.providerModel!==checked.model
            ||!retainedSettings.valid||JSON.stringify(retainedSettings.settings)!==JSON.stringify(checked.settings)
            ||!Array.isArray(receipt.referenceInputs)||receipt.referenceInputs.length!==referenceBlockIds.length
            ||receipt.referenceInputs.some((reference,index)=>!reference||typeof reference!=="object"||(reference as Record<string,unknown>).blockId!==referenceBlockIds[index]))return Response.json({error:"model3d_recovery_receipt_mismatch",message:"The retained 3D request does not match its original prompt, settings, and image selection. No replacement request was submitted."},{status:409});
          requestedModel3d={prompt:body.model3dPrompt!,settings:checked.settings,model:checked.model,estimatedCostMicrousd:checked.estimatedCostMicrousd,references:[],referenceBlockIds};
        }else{
          requestedModel3d=await prepareModel3dRequest({env,ownerId:storageOwnerId,snapshot:body.snapshot??{},sourceEvents:paidSourceEvents??[],prompt:body.model3dPrompt,promptSource:body.model3dPromptSource,adaptation:body.model3dAdaptation,settings:body.model3dSettings,referenceBlockIds,projectScope:executionScope});
        }
        body.model3dPrompt=requestedModel3d.prompt;body.model3dSettings=requestedModel3d.settings;
        if(requestedModel3d.adaptation)body.model3dAdaptation=requestedModel3d.adaptation;
      }catch(error){
        if(error instanceof ProviderRequestError)return Response.json({error:error.detail.code,message:error.detail.message,errorDetail:publicFailureDetail(error.detail)},{status:error.detail.httpStatus??422});
        throw error;
      }
    }
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
        const retainedParameters=body.audioInputReceipt?.parameters&&typeof body.audioInputReceipt.parameters==="object"?body.audioInputReceipt.parameters as Record<string,unknown>:{};
        requestedAudioSelection=recoveringAudio?selectRetainedAudioAdapter(pinnedModel,requestedAudioProfile,{submittedPrompt:String(body.audioInputReceipt?.submitted_prompt??""),estimatedCostMicrousd:retainedParameters.published_cost_microusd??body.audioEstimatedCostMicrousd}):selectAudioAdapter(env,body.audioProfile,{
          snapshot:body.snapshot??{},
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
        if(!recoveringAudio)audioPreparationConstraints(body.snapshot??{},{profile:requestedAudioProfile,model:requestedAudioSelection.model,tone:body.tone,audience:body.audience});
      }catch(error){
        if(error instanceof AudioAdapterSelectionError||error instanceof AudioProviderInputError)return Response.json({error:error.code,message:error.message},{status:422});
        if(error instanceof ProviderRequestError){const detail=error.detail;return Response.json({error:detail.code,errorDetail:publicFailureDetail(detail)},{status:detail.httpStatus??400});}
        throw error;
      }
    }
    if(body.action==="render_document"&&(["storyboard","video","audio","model3d"] as string[]).includes(String(body.artifactKind))&&body.paidMediaConfirmed!==true)return Response.json({error:"paid_media_confirmation_required",message:"Confirm paid media generation before starting this render."},{status:428});
    if(!execution&&["preview","generate","chat","structure_adaptive","render_document"].includes(body.action??"")){
      const artifactKind=String(body.artifactKind??"");let managed:ManagedProductionPlan|null=null;
      if(body.action==="render_document"&&body.productionMode==="managed"&&isDocumentArtifactKind(artifactKind)){
        try{managed=buildManagedProductionPlan(artifactKind,body.snapshot??{},artifactKind==="video"?{}:{requestedItemCount:Number(presentationRequest.requestedSlideCount??body.itemCount??0),...(artifactKind==="slides"&&presentationRequest.requestedSlideCount!==undefined?{requestedSlideCount:presentationRequest.requestedSlideCount}:{}),...(artifactKind==="scene"?{sceneMedium:body.sceneConfiguration?.medium??body.sceneMedium}:{})});}
        catch(error){if(error instanceof RangeError&&"code" in error)return Response.json({error:String(error.code),message:error.message},{status:422});throw error;}
        if(artifactKind==="slides"&&managed.requestedSlideCount!==null&&managed.requestedSlideCount!==managed.predictedSlideCount)return Response.json({error:"presentation_slide_count_conflict",message:`The requested ${managed.requestedSlideCount} slides would omit required authored positions. Explicitly choose ${managed.predictedSlideCount} slides before generation.`,authoredSlideCount:managed.authoredSlideCount,requestedSlideCount:managed.requestedSlideCount,plannedSlideCount:managed.predictedSlideCount},{status:409});
      }
      const estimatedAudioCost=requestedAudioSelection?.estimatedCostMicrousd??AUDIO_ADAPTER_CONTRACT.publishedCostMicrousd;
      const estimated=requestedModel3d?.estimatedCostMicrousd??(managed?managed.estimatedTotalCostMicrousd+(artifactKind==="storyboard"?managed.scenes.length*1_000_000:artifactKind==="audio"?estimatedAudioCost:0):body.action==="chat"||body.action==="structure_adaptive"?estimatePlannerOperationMicrousd(env.OPENAI_MODEL??"gpt-5.6-terra",body.action):body.action==="render_document"&&artifactKind==="video"?normalizeVideoDurationSeconds(body.videoSeconds)*VIDEO_ADAPTER_CONTRACT.publishedCostPerSecondMicrousd[VIDEO_ADAPTER_CONTRACT.defaultResolution]+1_000_000:body.action==="render_document"&&artifactKind==="audio"?estimatedAudioCost+1_000_000:body.action==="render_document"&&artifactKind==="storyboard"?Math.max(1,Math.floor(Number(body.itemCount??6)))*1_000_000+1_000_000:1_000_000);
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
    const current=execution?.output?.sourceHead??await streamHead(env,streamId),client=body.clientId||"web:lit",corr=body.correlationId||uuidV7();
    const refuseProviderClaim=async(input:{operation:string;tokenReservationId:string;costReservationId:string;reservedTokens:number;reservedMicrousd:number;causationId?:string})=>{
      await Promise.all([releaseBudget(env,billingOwnerId,input.tokenReservationId,{reason:`${input.operation}_authorization_withdrawn`}),releaseCostBudget(env,billingOwnerId,input.costReservationId)]);
      const head=await streamHead(env,streamId);
      const released=makeEvent(streamId,head+1,"worker:policy",client,corr,"BudgetReleased",{operation:input.operation,reservation_id:input.tokenReservationId,cost_reservation_id:input.costReservationId,reserved_tokens:input.reservedTokens,released_microusd:input.reservedMicrousd,reason:"project_access_revoked"},input.causationId?{causationId:input.causationId}:{});
      await insertEvent(env,released).run();
      return Response.json({error:"active_pilot_participation_required",appended:[released],head:released.sequence},{status:403});
    };
    const requested=body.action==="batch"||body.action==="canvas_sync"||hot?body.events??(body.event?[body.event]:[]):body.event?[body.event]:[];
    if(requested.some(item=>item.type==='BlockInspected')){
      if(execution||body.action==='canvas_sync')return Response.json({error:'block_inspection_isolated_append_required',noAutomaticRetry:true},{status:409});
      return appendNativeBlockInspection(request,env,auth.user,body);
    }
    if(requested.some(item=>item.type==="DocumentArtifactViewed")){
      if(execution||body.action==="canvas_sync"||requested.length!==1||requested[0]?.compensatesEventId
        ||!['append','hot','batch'].includes(body.action??'')
        ||/(?:^|;\s*)forma_impersonation=/.test(request.headers.get('cookie')??''))
        return Response.json({error:"artifact_view_isolated_personal_append_required",noAutomaticRetry:true},{status:409});
      return appendPersonalArtifactView(env,auth.user,requested[0]?.payload,current,client,corr);
    }
    if(requested.some((item)=>["BlockCreated","BlockPropertyEdited","ChipEdited"].includes(String(item.type)))){
      const modelAssets=await validateModel3dAssetEvents({env,ownerId:storageOwnerId,sourceEvents:await readEvents(env,streamId),events:requested,projectAccessId:executionScope?.projectAccessId});
      if(modelAssets)return Response.json({error:modelAssets.error,message:modelAssets.message,blockId:modelAssets.blockId},{status:modelAssets.status});
    }
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
      const livePreview=body.livePreview!==false;const sourceEvents=await readEvents(env,streamId);const projection=foldEvents(sourceEvents,Number.POSITIVE_INFINITY,body.documentId);
      const selectedTurns=new Map<string,{eventId:string;contentRef:string;role:"user"|"assistant"}>();
      for(const event of sourceEvents){
        if(String(event.payload.document_id??"")!==projection.documentId)continue;
        const user=event.type==="ChatMessageSent";if(!user&&!(event.type==="AssistantReasoned"&&event.payload.operation==="creative-chat"))continue;
        const role=user?"user":"assistant";selectedTurns.set(`${String(event.payload.turn_id??event.eventId)}:${role}`,{eventId:event.eventId,contentRef:String(event.payload.content_ref??""),role});
      }
      const selectedHistory=[...selectedTurns.values()].slice(-12),memoryProof=await legacyChatMemoryProof(env,streamId,selectedHistory);
      const requireOrdinaryHistory=async()=>{if(!await env.DB.prepare("SELECT 1 AS no_memory_ancestry WHERE "+memoryProof.sql).bind(...memoryProof.bindings).first())throw new Error("assistant_memory_paid_ancestry_unsupported");};
      try{await requireOrdinaryHistory();}catch{return Response.json({error:"assistant_memory_paid_ancestry_unsupported",noAutomaticRetry:true},{status:409});}
      const privateContent=await loadPrivateContent(env,ownerId,"chat",executionScope);const history=selectedHistory.map(row=>({role:row.role,text:String(privateContent[row.contentRef]??"")})).filter(row=>row.text);
      const reserved=12_000;const reservation=await reserveBudget(env,billingOwnerId,reserved,{streamId,correlationId:corr,operation:"creative-chat",projectScope:projectBudgetScope});
      if(!reservation.ok){const denied=makeEvent(streamId,current+1,"worker:policy",client,corr,"BudgetExceeded",{reason:"hard_cap_reached",scope:reservation.scope,reserved_tokens:0,operation:"creative-chat"});await insertEvent(env,denied).run();const detail=applicationFailureDetail("budget_hard_cap_reached",reservation.scope,429);return Response.json({error:detail.code,errorDetail:publicFailureDetail(detail),scope:reservation.scope},{status:429});}
      const estimatedChatCost=priceTextUsageBreakdownMicrousd(env.OPENAI_MODEL??"gpt-5.6-terra",{inputTokens:10_400,outputTokens:1_600,totalTokens:reserved}).totalMicrousd;
      const chatCostReservation=await reserveCostBudget(env,billingOwnerId,estimatedChatCost,{maximumMicrousd:estimatedChatCost,allowUserOverage:false,streamId,correlationId:corr,operation:"creative-chat",period:reservation.period,projectScope:projectBudgetScope});
      if(!chatCostReservation.ok){await releaseBudget(env,billingOwnerId,reservation.reservationId,{reason:"creative_chat_cost_cap_reached"});const detail=applicationFailureDetail("budget_hard_cap_reached",chatCostReservation.scope,429);return Response.json({error:detail.code,errorDetail:publicFailureDetail(detail),scope:chatCostReservation.scope},{status:429});}
      let userStored:Awaited<ReturnType<typeof storePrivateContent>>|null=null;let budgeted:EventRow|null=null;let userTurn:EventRow|null=null;const turnId=uuidV7();
      try{
        userStored=await storePrivateContent(env,ownerId,"chat-user",message,executionScope);budgeted=makeEvent(streamId,current+1,"worker:policy",client,corr,"BudgetReserved",{operation:"creative-chat",reservation_id:reservation.reservationId,cost_reservation_id:chatCostReservation.reservationId,reserved_tokens:reserved,reserved_microusd:chatCostReservation.reservedMicrousd,period:reservation.period,live_preview:livePreview});userTurn=makeEvent(streamId,current+2,userActor,client,corr,"ChatMessageSent",{turn_id:turnId,document_id:projection.documentId,content_ref:userStored.contentId,content_expires_at:userStored.expiresAt,source_surface:"chat",live_preview:livePreview},{causationId:budgeted.eventId});await env.DB.batch([budgeted,userTurn].map((event)=>insertEvent(env,event)));
        await execution?.progress("planning","Preparing your private creative conversation.");if(!await claimCostBudgetReservation(env,billingOwnerId,chatCostReservation.reservationId))return refuseProviderClaim({operation:"creative-chat",tokenReservationId:reservation.reservationId,costReservationId:chatCostReservation.reservationId,reservedTokens:reserved,reservedMicrousd:chatCostReservation.reservedMicrousd,causationId:userTurn.eventId});const generated=await respondToCreativeChat(env,ownerId,{documentTitle:projection.documentTitle,blocks:projection.blocks.map((block)=>({id:block.id,type:block.type,handle:block.handle,locked:block.locked,properties:block.properties})),relationships:projection.blockRelations.map((relation)=>({from_block_id:relation.fromBlockId,to_block_id:relation.toBlockId,kind:relation.kind,properties:relation.properties})),history,message,locale:typeof (body as {locale?:unknown}).locale==="string"?(body as {locale:string}).locale:"en",signal:execution?.signal,beforeDispatch:requireOrdinaryHistory});await execution?.beginCommit();
        // A submitted call still settles its actual usage if ancestry is withdrawn before materialization.
        try{await requireOrdinaryHistory();}catch(error){const charged=priceTextUsageBreakdownMicrousd(generated.model,generated.usage);await Promise.all([settleBudget(env,billingOwnerId,reservation.reservationId,generated.usage.totalTokens),settleCostBudget(env,billingOwnerId,chatCostReservation.reservationId,charged.totalMicrousd)]);throw error;}
        const outputRequirementMutations=generated.output.mutations.filter((mutation)=>mutation.operation==="create"?isOutputContextType(mutation.type):projection.blocks.some((block)=>block.id===mutation.target_block_id&&isOutputContextType(block.type)));
        const outputRequirementsUnchanged=outputRequirementMutations.some((mutation)=>mutation.operation!=="create");
        const assistantReply=outputRequirementMutations.length?`${generated.output.reply}\n\n${outputRequirementChatNotice(body.locale,outputRequirementsUnchanged)}`:generated.output.reply;
        const assistantStored=await storePrivateContent(env,ownerId,"chat-assistant",assistantReply,executionScope,memoryProof);
        const previewSuppressed=generated.output.preview_worthy&&(!livePreview||outputRequirementMutations.length>0);const previewQueued=livePreview&&generated.output.preview_worthy&&outputRequirementMutations.length===0;let directionStored:null|Awaited<ReturnType<typeof storePrivateContent>>=null;if(previewQueued){const direction={title:projection.documentTitle,rationale:generated.output.reply,scene:generated.output.preview_direction,palette:[],next_moves:[]};directionStored=await storePrivateContent(env,ownerId,"provider-output",JSON.stringify(direction),executionScope);}const next=await streamHead(env,streamId);const referencePixelMutationCount=generated.output.mutations.filter((mutation)=>mutation.reference_pixel_mode!=="unchanged").length;const reasoned=makeEvent(streamId,next+1,"model:forma-chat",client,corr,"AssistantReasoned",{operation:"creative-chat",turn_id:turnId,document_id:projection.documentId,content_ref:assistantStored.contentId,content_expires_at:assistantStored.expiresAt,provider:"openai",provider_response_id:generated.responseId,model_id:generated.model,latency_ms:generated.latencyMs,mutation_count:generated.output.mutations.length,reference_pixel_mutation_count:referencePixelMutationCount,preview_worthy:generated.output.preview_worthy,live_preview_requested:livePreview,preview_queued:previewQueued,preview_direction_ref:directionStored?.contentId??null,preview_suppressed:previewSuppressed},{causationId:userTurn.eventId});
        const mutationResult=creativeChatMutationEvents({mutations:generated.output.mutations,projection,streamId,startSequence:reasoned.sequence,client,corr,causationId:reasoned.eventId,turnId,actor:userActor});const appended:EventRow[]=[reasoned,...mutationResult.events];let sequence=mutationResult.sequence;
        const chatCosts=providerCostReceipt([priceTextUsageBreakdownMicrousd(generated.model,generated.usage)]);await Promise.all([settleBudget(env,billingOwnerId,reservation.reservationId,generated.usage.totalTokens),settleCostBudget(env,billingOwnerId,chatCostReservation.reservationId,chatCosts.cost_microusd)]);const usage=makeEvent(streamId,++sequence,"worker:policy",client,corr,"GenerationUsageRecorded",{operation:"creative-chat",document_id:projection.documentId,reservation_id:reservation.reservationId,cost_reservation_id:chatCostReservation.reservationId,input_tokens:generated.usage.inputTokens,output_tokens:generated.usage.outputTokens,total_tokens:generated.usage.totalTokens,chat_tokens:generated.usage.totalTokens,preview_tokens:0,reserved_tokens:reserved,reserved_microusd:chatCostReservation.reservedMicrousd,model_ids:[generated.model],live_preview_requested:livePreview,preview_generated:false,preview_queued:previewQueued,preview_suppressed:previewSuppressed,...chatCosts},{causationId:reasoned.eventId});appended.push(usage);await env.DB.batch(appended.map((event)=>insertEvent(env,event)));return Response.json({appended:[budgeted,userTurn,...appended],content:{[userStored.contentId]:message,[assistantStored.contentId]:assistantReply},rejected:[],head:usage.sequence,previewed:false,previewQueued,previewSuppressed,followupJob:directionStored?{kind:"preview",documentId:projection.documentId,sourceSurface:"chat",payload:{directionRef:directionStored.contentId,directionModel:generated.model,sourceChatTurnId:turnId,locale:body.locale??"en",promptTechnique:normalizePromptTechnique(body.promptTechnique)}}:null});
      }catch(error){if(execution?.signal.aborted||error instanceof Error&&error.message==="document_job_canceled")throw error;const memoryDenied=error instanceof Error&&error.message==="assistant_memory_paid_ancestry_unsupported";const detail=classifyProviderFailure(error);await Promise.all([releaseBudget(env,billingOwnerId,reservation.reservationId,{reason:"creative_chat_failed"}),releaseCostBudget(env,billingOwnerId,chatCostReservation.reservationId)]);if(memoryDenied)return Response.json({error:"assistant_memory_paid_ancestry_unsupported",noAutomaticRetry:true},{status:409});if(!budgeted||!userTurn||!userStored)return Response.json({error:detail.code,errorDetail:publicFailureDetail(detail)},{status:detail.httpStatus===429?429:502});const next=await streamHead(env,streamId);const released=makeEvent(streamId,next+1,"worker:policy",client,corr,"BudgetReleased",{operation:"creative-chat",reservation_id:reservation.reservationId,cost_reservation_id:chatCostReservation.reservationId,reserved_tokens:reserved,released_microusd:chatCostReservation.reservedMicrousd,reason:"creative_chat_failed"},{causationId:userTurn.eventId});await insertEvent(env,released).run();return Response.json({error:detail.code,errorDetail:publicFailureDetail(detail),appended:[budgeted,userTurn,released],content:{[userStored.contentId]:message},head:released.sequence},{status:detail.httpStatus===429?429:502});}
    }
    if(body.action==="structure_adaptive")return Response.json({error:"adaptive_consent_required",submission:"not-submitted"},{status:428});
    if(body.action==="render_document"&&body.artifactKind==="model3d"){
      if(!requestedModel3d)return Response.json({error:"model3d_request_not_prepared"},{status:422});
      const sourceEvents=await readEvents(env,streamId);
      const projection=foldEvents(sourceEvents,Number.POSITIVE_INFINITY,body.documentId,projectId);
      return handleModel3dRender({env,user:auth.user,body:body as Record<string,unknown>,sourceEvents,projection,ownerId,storageOwnerId,billingOwnerId,streamId,client,corr,userActor,projectBudgetScope,executionScope,execution,appendOperationEvents,settleOperationOutputBudgets,prepared:requestedModel3d});
    }
    if(body.action==="render_document"){
      if(!isDocumentArtifactKind(body.artifactKind))return Response.json({error:"document_artifact_kind_required"},{status:400});
      const artifactKind=body.artifactKind;
      const nativeAudio=execution?.output?readOutputAudioPayload(execution.output.settings):null;
      if((Object.hasOwn(body,"outputAudio")||execution?.output&&artifactKind==="audio")&&(!nativeAudio||!execution?.output?.refreshAudio))return Response.json({error:"output_audio_contract_unsupported"},{status:422});
      if(nativeAudio){await execution!.output!.refreshAudio!();if(body.productionMode!=="manual"||body.itemCount!==1||body.providerJobId||body.audioImageBlockId||body.audioVideoArtifactId||body.sendAudioVideoToProvider)throw new Error("output_audio_original_attempt_required");}
      const nativeScene=execution?.output?await readOutputScenePayload(execution.output.settings):null;
      const sponsoredScene=Boolean(nativeScene&&sponsoredOutput&&sponsorFinancialEventProfile(execution!.output!.sponsorFinancialBinding!,sponsorEnvironment,actorUserId,execution!.output!.reference)==="scene");
      if((Object.hasOwn(body,"outputScene")||execution?.output&&artifactKind==="scene")&&(!nativeScene||!execution?.output?.refreshScene))return Response.json({error:"output_scene_contract_unsupported"},{status:422});
      const nativeNarrative=execution?.output?await readOutputNarrativePayload(execution.output.settings):null;
      if(execution?.output&&(artifactKind==="short_story"||Object.hasOwn(execution.output.settings,"outputNarrative"))&&!nativeNarrative)return Response.json({error:"output_narrative_contract_unsupported"},{status:422});
      const nativeVideo=execution?.output&&artifactKind==="video"?parseVideoOutputContract(execution.output.settings.outputVideo):null;
      const nativeVideoPlanner=nativeVideo?readVideoPlannerExecution(execution!.output!.settings.outputVideoPlanner):null;
      if((Object.hasOwn(body,"outputVideo")||Object.hasOwn(body,"outputVideoPlanner")||execution?.output&&artifactKind==="video")&&(!nativeVideo||!nativeVideoPlanner||body.productionMode!=="manual"||body.itemCount!==1||body.videoSeconds!==4||body.videoResolution!=="480p"||body.videoAudioMode!=="silent"||body.providerJobId||Object.hasOwn(body,"retainedReceipt")||body.sendSoundtrackToVideoProvider))return Response.json({error:"output_video_contract_unsupported"},{status:422});
      const withNativeVideo=<T,>(work:(lease:OutputVideoHookLease)=>T|Promise<T>)=>withOutputVideoHook(execution?.signal,lease=>execution!.output!.withVideoLease(lease,()=>work(lease)));
      const nativeStoryboard=execution?.output&&artifactKind==="storyboard"?parseStoryboardOutputContract(execution.output.settings.outputStoryboard):null;
      if((Object.hasOwn(body,"outputStoryboard")||execution?.output&&artifactKind==="storyboard")&&(!nativeStoryboard||body.productionMode!=="manual"||body.itemCount!==4||Object.hasOwn(body,"storyboardSafeRecovery")||!execution?.output?.retainStoryboardFrameRequest))return Response.json({error:"output_storyboard_contract_unsupported"},{status:422});
      if(artifactKind==="scene"&&(scenePolicyStopIncomingField(body as Record<string,unknown>)||Object.hasOwn(body,"sceneDispatchStop")))return Response.json({error:"scene_policy_stop_server_owned"},{status:400});
      const sceneConfiguration=artifactKind==="scene"
        ?body.sceneConfiguration??createSceneConfiguration(body.sceneMedium??"visual")
        :undefined;
      if((artifactKind==="storyboard"||artifactKind==="video"||artifactKind==="audio")&&body.paidMediaConfirmed!==true)return Response.json({error:"paid_media_confirmation_required",message:"Confirm paid media generation before starting this render."},{status:428});
      if(!env.OPENAI_API_KEY)return Response.json({error:"provider_not_configured"},{status:503});
      const productionMode:ProductionMode=body.productionMode==="managed"?"managed":"manual";
      if((artifactKind==="video"||artifactKind==="audio")&&!env.FAL_KEY)return Response.json({error:artifactKind==="audio"?"audio_provider_not_configured":"video_provider_not_configured"},{status:503});
      if(artifactKind==="video"&&env.FORMA_VIDEO_PROVIDER&&env.FORMA_VIDEO_PROVIDER!=="fal")return Response.json({error:"video_provider_unsupported"},{status:503});
      if(artifactKind==="audio"&&env.FORMA_AUDIO_PROVIDER&&env.FORMA_AUDIO_PROVIDER!=="fal")return Response.json({error:"audio_provider_unsupported"},{status:503});
      let itemCount=Math.max(1,Math.min(artifactKind==="slides"?MAX_MANUAL_PRESENTATION_SLIDES:12,Math.floor(Number(body.itemCount??(artifactKind==="slides"?7:artifactKind==="storyboard"?6:1)))));
      if(artifactKind==="video"&&body.videoSeconds!==undefined&&!isVideoDurationSeconds(body.videoSeconds))return Response.json({error:"video_duration_unsupported",supported:VIDEO_ADAPTER_CONTRACT.supportedDurations},{status:400});
      if(artifactKind==="video"&&body.videoSize!==undefined&&!VIDEO_ADAPTER_CONTRACT.supportedFrameSizes.includes(body.videoSize))return Response.json({error:"video_frame_unsupported",supported:VIDEO_ADAPTER_CONTRACT.supportedFrameSizes},{status:400});
      if(artifactKind==="video"&&body.videoAudioMode!==undefined&&!isVideoAudioMode(body.videoAudioMode))return Response.json({error:"video_audio_mode_unsupported",supported:VIDEO_ADAPTER_CONTRACT.supportedAudioModes},{status:400});
      if(body.sendSoundtrackToVideoProvider===true&&artifactKind!=="video")return Response.json({error:"audio_provider_transfer_video_only"},{status:400});
      if(body.sendSoundtrackToVideoProvider===true&&productionMode==="managed")return Response.json({error:"managed_video_soundtrack_transfer_unsupported",message:"Managed multi-scene videos support separate soundtrack companions; direct provider soundtrack transfer is available for single-render videos."},{status:400});
      if(body.audioImageBlockId&&artifactKind!=="audio")return Response.json({error:"audio_image_reference_audio_only"},{status:400});
      const requestedVideoSeconds=normalizeVideoDurationSeconds(body.videoSeconds);
      const retainedVideoParameters=body.providerJobId&&body.videoInputReceipt?.parameters&&typeof body.videoInputReceipt.parameters==="object"?body.videoInputReceipt.parameters as Record<string,unknown>:null;
      const requestedVideoResolution=retainedVideoParameters?.resolution==="480p"||retainedVideoParameters?.resolution==="720p"?retainedVideoParameters.resolution:body.videoResolution;
      const retainedVideoAudioMode=retainedVideoParameters&&isVideoAudioMode(retainedVideoParameters.native_audio_mode)
        ?retainedVideoParameters.native_audio_mode
        :retainedVideoParameters&&isVideoAudioMode(retainedVideoParameters.audio_mode)
          ?retainedVideoParameters.audio_mode
          :retainedVideoParameters?.soundtrack_mode==="rights-cleared-provider-reference"?"silent"
            :typeof retainedVideoParameters?.generate_audio==="boolean"?retainedVideoParameters.generate_audio?"original_ambient":"silent":undefined;
      const requestedVideoAudioMode:VideoAudioMode=retainedVideoAudioMode??body.videoAudioMode??VIDEO_ADAPTER_CONTRACT.defaultAudioMode;
      let presentationModelRoutes:PresentationModelRoutes|undefined;
      if(artifactKind==="slides"){
        try{presentationModelRoutes=execution&&(body as Record<string,unknown>).presentationModelRoutes?readFrozenPresentationModelRoutes((body as Record<string,unknown>).presentationModelRoutes):resolvePresentationModelRoutes(env);}
        catch(error){if(error instanceof PresentationModelConfigurationError)return Response.json({error:error.code,field:error.field,message:error.message},{status:503});throw error;}
      }
      const guidanceProblem=documentRenderGuidanceProblem(body);
      if(guidanceProblem)return Response.json(guidanceProblem,{status:400});
      const {audience,tone}=documentRenderGuidance(body);
      const sourceEvents=await readEvents(env,streamId);const projection=foldEvents(sourceEvents,Number.POSITIVE_INFINITY,body.documentId);const suppliedSnapshot:Record<string,unknown>=body.snapshot&&Object.keys(body.snapshot).length?body.snapshot:snapshotForProjection(projection);const authoredStandingConstraints=standingConstraints(sourceEvents).map((item)=>({preference_id:item.preferenceId,axis:item.axis,value:item.value,polarity:item.polarity,authority:"authored",source_event_refs:item.evidenceRefs,source_claim_ref:item.sourceClaimRef??null}));const suppliedStandingConstraints=Array.isArray(suppliedSnapshot.standing_constraints)?suppliedSnapshot.standing_constraints.filter((value):value is Record<string,unknown>=>Boolean(value)&&typeof value==="object"&&!Array.isArray(value)):[];const mergedStandingConstraints=[...new Map([...suppliedStandingConstraints,...authoredStandingConstraints].map((constraint)=>[String(constraint.preference_id??`${constraint.polarity}:${constraint.axis}:${constraint.value}`),constraint])).values()];let compiledSnapshot:Record<string,unknown>={...suppliedSnapshot,document:{id:projection.documentId,title:projection.documentTitle},...(mergedStandingConstraints.length?{standing_constraints:mergedStandingConstraints}:{})};
      const sceneBody=body as Record<string,unknown>;
      // Retained, already-paid local finalization is not a new purchase. It never reaches a provider hook.
      const retainedPaidScene=Boolean(!nativeScene&&execution&&artifactKind==="scene"&&body.artifactPlan&&body.plannerResponseId
        &&recordedDocumentPlannerUsage(sourceEvents,String(body.plannerResponseId)).tokensRecorded);
      let scenePrepared:PreparedSceneCost|null=null;
      let scenePaidClaim:ClaimedSceneBudget|null=null;
      let sponsorSceneClaim:SponsorScenePaidClaim|null=null;
      let scenePilotValidUntil:string|null=null;
      let scenePolicyStop:ScenePolicyStopWitness|null=null;
      let scenePendingRequestId:string|null=null;
      const rememberScenePolicyStop=(error:unknown,clientRequestId:string,stage:ScenePolicyStopWitness["stage"])=>{
        if(!(error instanceof ScenePaidPolicyStopError)||!scenePrepared||(!scenePaidClaim&&!sponsorSceneClaim)||!execution)return;
        const approval=scenePrepared.preview,claim=sponsorSceneClaim?{...sponsorScenePaidClaimIdentity(sponsorSceneClaim),projectScope:null,pilotCohortId:null}:scenePaidClaim!;
        scenePolicyStop={version:"scene-policy-stop-v1",code:"scene_paid_authority_changed",stage,
          job_id:approval.requestId,document_id:documentId,project_id:approval.projectId,actor_user_id:claim.actorUserId,attempt_correlation_id:corr,
          provider:"openai",model:approval.model,client_request_id:clientRequestId,artifact_id:artifactId,
          binding_hash:approval.bindingHash,source_hash:approval.sourceHash,request_hash:approval.requestHash,period:claim.period,
          reservation_id:claim.tokenReservationId,cost_reservation_id:claim.costReservationId,reserved_tokens:claim.reservedTokens,reserved_microusd:claim.reservedMicrousd,
          organization_id:claim.projectScope?.organizationId??null,project_access_id:claim.projectScope?.projectAccessId??null,pilot_cohort_id:claim.pilotCohortId,
          stopped_at:new Date().toISOString(),used_tokens:0,used_microusd:0};
      };
      const verifySceneDispatch=async()=>{
        if(artifactKind!=="scene")return;
        if(!scenePrepared)throw new SceneCostConsentError("scene_cost_confirmation_required",428);
        const sponsored=sponsoredScene?await execution!.output!.refreshSponsorSceneDispatch!(execution!):null;
        const latest=sponsored?sponsored.prepared:nativeScene?await execution!.output!.refreshScene!():await prepareSceneCostConsent(env,auth.user!,documentId,{...sceneBody,snapshot:authoritativeSnapshot??body.snapshot},
          scenePrepared.preview.contextSessionId,{synchronize:true});
        if(!nativeScene)requireSceneCostApproval(sceneBody.sceneCostConsent,latest);
        if(sponsored?!sponsorSceneClaim:!scenePaidClaim)throw new ScenePaidPolicyStopError();
        const deadline=sponsored?await sponsorScenePaidDispatchDeadline({claim:sponsorSceneClaim!,prepared:latest,evidence:sponsored.evidence})
          :await scenePaidDispatchDeadline(env,latest,scenePaidClaim!);
        if(sponsorSceneClaim)requireSponsorScenePaidDispatchCurrent(sponsorSceneClaim);
        scenePilotValidUntil=deadline.pilotValidUntil;
        requireScenePaidDeadline(scenePilotValidUntil);
        requireSceneCostDeadline(deadline);
        scenePrepared={...latest,validUntil:deadline.validUntil};
      };
      if(artifactKind==="scene"&&!retainedPaidScene){
        try{
          const approval=sceneBody.sceneCostConsent&&typeof sceneBody.sceneCostConsent==="object"?sceneBody.sceneCostConsent as Record<string,unknown>:{};
          scenePrepared=sponsoredScene?(await execution!.output!.refreshSponsorSceneDispatch!(execution!)).prepared:nativeScene?await execution!.output!.refreshScene!():await prepareSceneCostConsent(env,auth.user!,documentId,{...sceneBody,snapshot:authoritativeSnapshot??body.snapshot},
            typeof approval.contextSessionId==="string"?approval.contextSessionId:null,{synchronize:true});
          if(!nativeScene)requireSceneCostApproval(sceneBody.sceneCostConsent,scenePrepared);
          compiledSnapshot=scenePrepared.effectiveSnapshot;
        }catch(error){return sceneCostErrorResponse(error);}
      }
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
      if(artifactKind==="audio"&&requestedAudioProfile&&requestedAudioSelection&&!(body.providerJobId&&body.audioInputReceipt)){
        try{audioPreparationConstraints(compiledSnapshot,{profile:requestedAudioProfile,model:requestedAudioSelection.model,tone,audience});}
        catch(error){
          if(error instanceof AudioProviderInputError||error instanceof AudioAdapterSelectionError)return Response.json({error:error.code,message:error.message},{status:422});
          throw error;
        }
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
      let productionPlan:ManagedProductionPlan|null=scenePrepared?scenePrepared.production:productionMode==="managed"&&body.productionPlan?.mode==="managed"?body.productionPlan:null;
      if(artifactKind==="video"){
        try{
          resolveVideoAudioPolicy({snapshot:body.providerJobId?undefined:compiledSnapshot,audioMode:requestedVideoAudioMode,providedSoundtrack:preparedAudioReferences.length>0});
          if(!(body.providerJobId&&body.videoInputReceipt)){
            preparedVideoReferences=nativeVideo?[await withNativeVideo(lease=>execution!.output!.readVideoReference(lease))]:await videoPixelReferences(env,storageOwnerId,compiledSnapshot,sourceEvents,executionScope);
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
      const slideCountPolicy=artifactKind==="slides"?presentationRequest.slideCountPolicy:undefined;
      const requestedSlideCount=artifactKind==="slides"&&slideCountPolicy?.kind!=="flexible"?productionPlan?.requestedSlideCount??presentationRequest.requestedSlideCount??body.itemCount??itemCount:undefined;
      const authoredSlideCount=artifactKind==="slides"?productionPlan?.authoredSlideCount??inferPresentationSourceOutline(compiledSnapshot).authoredSlideCount??0:undefined;
      const presentationOptions=artifactKind==="slides"?{presentationModelRoutes,...(presentationStyle?{presentationStyle}:{}),presentationFidelity,requestedSlideCount,...(slideCountPolicy?{slideCountPolicy}:{}),authoredSlideCount}:{};
      const presentationSourceContract=artifactKind==="slides"?buildPresentationSourceContract(compiledSnapshot,{itemCount,requestedSlideCount,...(slideCountPolicy?{slideCountPolicy}:{}),presentationStyle,fidelity:presentationFidelity}):undefined;
      const artifactValidationOptions={itemCount,contextGroupIds:combinedContextGroups(compiledSnapshot).map((group)=>group.id),...(presentationSourceContract?{sourceContract:presentationSourceContract,requireSourceGrounding:presentationSourceContract.sources.some((source)=>source.sourceKind==="block"),requireAllProtectedContent:true}:{})};
      const presentationReceipt=artifactKind==="slides"?{
        presentation_adapter_version:PRESENTATION_ADAPTER_VERSION,
        presentation_style:presentationStyle??null,presentation_fidelity:presentationFidelity,
        authored_slide_count:authoredSlideCount,requested_slide_count:requestedSlideCount??null,predicted_slide_count:itemCount,
        ...(slideCountPolicy?{slide_count_policy:slideCountPolicy}:{}),
        slide_count_mismatch:productionPlan?.slideCountMismatch??Boolean(authoredSlideCount&&!slideCountAccepted(authoredSlideCount,slideCountPolicy,requestedSlideCount)),
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
      if(artifactKind==="scene"&&retainedPaidScene&&!resumablePresentation)return Response.json({error:"scene_paid_result_unavailable",message:"The retained paid Scene is unavailable for local completion. No replacement provider request was submitted."},{status:409});
      const requestedSafeRecovery=(body as Record<string,unknown>).storyboardSafeRecovery;
      const storyboardSafeRecovery=execution&&artifactKind==="storyboard"&&!productionPlan&&!body.providerJobId&&(body as Record<string,unknown>).storyboardProviderSubmission==="cleared"&&body.artifactPlan&&body.plannerResponseId&&body.reservationId&&(body as Record<string,unknown>).costReservationId?validatedStoryboardSafeRecovery(requestedSafeRecovery,(body as Record<string,unknown>).storyboardRejectedProviderReceipt,body.renderedItems,env.FAL_IMAGE_PREVIEW_MODEL??"ideogram/v4/fast"):null;
      if(requestedSafeRecovery&&!storyboardSafeRecovery)return Response.json({error:"storyboard_safe_recovery_invalid",message:"The one-time storyboard recovery does not match its original provider receipt, saved frames, or reserved budget."},{status:409});
      let reservationId=execution?.output?.reservations.reservationId??(body.reservationId&&(resumablePresentation||artifactKind!=="slides"&&((body.providerJobId&&(artifactKind==="storyboard"||body.videoInputReceipt||body.audioInputReceipt))||storyboardSafeRecovery||body.productionSceneReceipts||body.productionFrameReceipts||body.productionAnchor))?body.reservationId:""),reservationCreated=false;let budgeted:EventRow|null=null;let requestedSequence=artifactKind==="slides"?current:await streamHead(env,streamId);const artifactId=body.artifactId||uuidV7();
      const prepaidSceneIds=new Set(Array.isArray(body.productionPrepaidSceneIds)?body.productionPrepaidSceneIds.map(String):[]);const prepaidSceneCost=Object.values(body.productionSceneReceipts??{}).reduce((sum,receipt)=>sum+(prepaidSceneIds.has(receipt.sceneId)?Number(receipt.costMicrousd??receipt.durationSeconds*VIDEO_ADAPTER_CONTRACT.publishedCostPerSecondMicrousd[VIDEO_ADAPTER_CONTRACT.defaultResolution]):0),0);const prepaidProviderCostMicrousd=Math.max(0,Math.floor(Number((body as Record<string,unknown>).prepaidProviderCostMicrousd??0)));const estimatedAudioProviderCost=requestedAudioSelection?.estimatedCostMicrousd??AUDIO_ADAPTER_CONTRACT.publishedCostMicrousd;const grossEstimatedCostMicrousd=productionPlan?productionPlan.estimatedTotalCostMicrousd+(artifactKind==="storyboard"?itemCount*1_000_000:artifactKind==="audio"?estimatedAudioProviderCost:0):artifactKind==="video"?requestedVideoSeconds*VIDEO_ADAPTER_CONTRACT.publishedCostPerSecondMicrousd[VIDEO_ADAPTER_CONTRACT.defaultResolution]+1_000_000:artifactKind==="audio"?estimatedAudioProviderCost+1_000_000:artifactKind==="storyboard"?itemCount*1_000_000+1_000_000:1_000_000;
      // Native Storyboard already reserved its exact five quoted stage caps.
      // The legacy per-frame estimate and caller prepaid fields cannot reprice it.
      const estimatedCostMicrousd=nativeStoryboard||nativeVideo?execution!.output!.reservations.costReservationMicrousd:Math.max(1,grossEstimatedCostMicrousd-prepaidSceneCost-prepaidProviderCostMicrousd-(prepaidSceneIds.size&&body.productionAnchor?500_000:0));
      if((nativeStoryboard||nativeVideo)&&(!Number.isSafeInteger(estimatedCostMicrousd)||estimatedCostMicrousd<=0))return Response.json({error:"output_storyboard_admitted_allowance_invalid"},{status:409});
      const batchPresentationBookkeeping=Boolean(execution&&!execution.output&&artifactKind==="slides");
      let costReservationMicrousd=0;let costReservationId=String((body as Record<string,unknown>).costReservationId??"");let costReservationPeriod=String((body as Record<string,unknown>).costReservationPeriod??"");let tokenReservationPeriod=costReservationPeriod;let costReservationSettled=false;let retainedStoryboardCostClaim=false;
      if(!reservationId){const reservation=await reserveBudget(env,billingOwnerId,reserved,{streamId,correlationId:corr,operation:`document-render:${artifactKind}`,projectScope:projectBudgetScope,batchCounterInitialization:batchPresentationBookkeeping,...(scenePrepared?{reservationAssertions:scenePrepared.assertions}:{})});if(!reservation.ok){const denied=makeEvent(streamId,requestedSequence+1,"worker:policy",client,corr,"BudgetExceeded",{reason:"hard_cap_reached",scope:reservation.scope,reserved_tokens:0,operation:`document-render:${artifactKind}`,artifact_kind:artifactKind});await insertEvent(env,denied).run();const detail=applicationFailureDetail("budget_hard_cap_reached",reservation.scope,429);return Response.json({error:detail.code,errorDetail:publicFailureDetail(detail),scope:reservation.scope},{status:429});}reservationId=reservation.reservationId;tokenReservationPeriod=reservation.period;reservationCreated=true;}
      if(costReservationId){const existing=await costBudgetReservation(env,billingOwnerId,costReservationId);retainedStoryboardCostClaim=Boolean(execution&&artifactKind==="storyboard"&&(((body as Record<string,unknown>).storyboardProviderSubmission==="confirmed"&&body.providerJobId)||storyboardSafeRecovery)&&existing?.status==="executing");if(!existing||existing.status!=="active"&&!retainedStoryboardCostClaim||existing.stream_id!==streamId||existing.correlation_id!==corr||existing.operation!==`document-render:${artifactKind}`||existing.reserved_microusd<estimatedCostMicrousd||(costReservationPeriod&&existing.period!==costReservationPeriod)||(body.costReservationMicrousd&&existing.reserved_microusd!==Math.floor(Number(body.costReservationMicrousd)))){if(reservationCreated)await releaseBudget(env,billingOwnerId,reservationId,{reason:`document_${artifactKind}_cost_reservation_invalid`});return Response.json({error:"cost_reservation_invalid_or_expired"},{status:409});}costReservationMicrousd=existing.reserved_microusd;costReservationPeriod=existing.period;}
      if(!costReservationId){const costReservation=await reserveCostBudget(env,billingOwnerId,estimatedCostMicrousd,{maximumMicrousd:estimatedCostMicrousd,allowUserOverage:false,batchCounterInitialization:batchPresentationBookkeeping,streamId,correlationId:corr,operation:`document-render:${artifactKind}`,...(tokenReservationPeriod?{period:tokenReservationPeriod}:{}),projectScope:projectBudgetScope,...(scenePrepared?{reservationAssertions:scenePrepared.assertions}:{})}).catch(async(error:unknown)=>{if(scenePrepared&&reservationCreated){try{await releaseBudget(env,billingOwnerId,reservationId,{reason:"scene_cost_reservation_failed"});}catch{console.warn("scene_fresh_token_cleanup_failed");}}throw error;});if(!costReservation.ok){if(reservationCreated)await releaseBudget(env,billingOwnerId,reservationId,{reason:`document_${artifactKind}_cost_cap_reached`});const denied=makeEvent(streamId,requestedSequence+1,"worker:policy",client,corr,"BudgetExceeded",{reason:"monthly_cost_cap_reached",scope:costReservation.scope,reserved_tokens:0,estimated_cost_microusd:estimatedCostMicrousd,operation:`document-render:${artifactKind}`,artifact_kind:artifactKind});await insertEvent(env,denied).run();const detail=applicationFailureDetail("budget_hard_cap_reached",costReservation.scope,429);return Response.json({error:detail.code,errorDetail:publicFailureDetail(detail),scope:costReservation.scope},{status:429});}costReservationId=costReservation.reservationId;costReservationMicrousd=costReservation.reservedMicrousd;costReservationPeriod=costReservation.period;}
      if(!retainedStoryboardCostClaim&&!await claimCostBudgetReservation(env,billingOwnerId,costReservationId)){if(reservationCreated)await releaseBudget(env,billingOwnerId,reservationId,{reason:`document_${artifactKind}_cost_reservation_claim_conflict`});return Response.json({error:"cost_reservation_already_in_use"},{status:409});}
      if(scenePrepared&&sponsoredScene){
        const output=execution!.output!;
        sponsorSceneClaim=output.createSponsorScenePaidClaim!({runtimeControl:execution!,originalClaimIdentity:{
          jobId:scenePrepared.preview.requestId,scopeKey:output.reference.scopeKey,grantId:output.reference.grantId,slotId:output.reference.slotId,
          streamId,correlationId:corr,period:costReservationPeriod,tokenReservationId:reservationId,costReservationId,reservedTokens:reserved,reservedMicrousd:costReservationMicrousd}});
      }
      if(scenePrepared&&!sponsoredScene)scenePaidClaim={actorUserId:billingOwnerId,streamId,correlationId:corr,period:costReservationPeriod,
        tokenReservationId:reservationId,costReservationId,reservedTokens:reserved,reservedMicrousd:costReservationMicrousd,
        projectScope:scenePrepared.scope?{...scenePrepared.scope}:null,pilotCohortId:pilotAllowance?.pilot?.cohort_id??null};
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
      const requestEvent=makeEvent(streamId,++requestedSequence,userActor,client,corr,"DocumentRenderRequested",{artifact_id:artifactId,artifact_kind:artifactKind,document_id:projection.documentId,project_id:projection.projectId,...workflowLineage,...sceneReceipt,source_block_versions:sourceBlockVersions,item_count:itemCount,...presentationReceipt,audience:audience||null,tone:tone||null,source_surface:body.sourceSurface??"document",request_key:body.requestKey??null,video_seconds:artifactKind==="video"?(productionPlan?.totalDurationSeconds??requestedVideoSeconds):null,video_size:artifactKind==="video"?body.videoSize??"1280x720":null,...(artifactKind==="video"&&requestedVideoResolution!==undefined?{video_resolution:requestedVideoResolution}:{}),video_audio_mode:artifactKind==="video"?requestedVideoAudioMode:null,paid_media_confirmed:body.paidMediaConfirmed===true,production_mode:productionMode,production_team:productionPlan?.team.id??null,estimated_cost_microusd:estimatedCostMicrousd,resumed_provider_job:Boolean(body.providerJobId||body.productionSceneReceipts)},{causationId:null});if(reservationCreated){budgeted=makeEvent(streamId,++requestedSequence,"worker:policy",client,corr,"BudgetReserved",{operation:`document-render:${artifactKind}`,artifact_id:artifactId,artifact_kind:artifactKind,reservation_id:reservationId,cost_reservation_id:costReservationId,reserved_tokens:reserved,reserved_microusd:costReservationMicrousd,period:costReservationPeriod,resumed_provider_job:Boolean(body.providerJobId||body.productionSceneReceipts)},{causationId:requestEvent.eventId});}await appendOperationEvents(env,budgeted?[requestEvent,budgeted]:[requestEvent]);
      let activeProviderJobId=body.providerJobId??"",activeProviderModel=body.providerModel??String(body.audioInputReceipt?.model??body.videoInputReceipt?.model??""),activeProviderStatusUrl=body.providerStatusUrl??"",activeProviderResponseUrl=body.providerResponseUrl??"",activeProviderCancelUrl=body.providerCancelUrl??"",videoSubmissionAttempted=Boolean(body.providerJobId),storyboardSubmissionAttempted=artifactKind==="storyboard"&&Boolean(body.providerJobId),presentationSubmissionPending=false;let storyboardProviderSubmission:"pending"|"confirmed"|"rejected"|"cleared"|undefined=artifactKind==="storyboard"&&activeProviderJobId&&(body as Record<string,unknown>).storyboardProviderSubmission==="confirmed"?"confirmed":undefined;let storyboardProviderRequestedAt=String((body as Record<string,unknown>).storyboardProviderRequestedAt??"");let storyboardProviderAcceptedAt=String((body as Record<string,unknown>).storyboardProviderAcceptedAt??"");let plannerModel=String(body.plannerModel??nativeNarrative?.model??env.OPENAI_MODEL??"gpt-5.6-terra");let plannerResponseId=String(body.plannerResponseId??"");let plannerResponseIds=Array.isArray((body as Record<string,unknown>).plannerResponseIds)?((body as Record<string,unknown>).plannerResponseIds as unknown[]).map(String).filter(Boolean):[];let plannerLatencyMs=Number(body.plannerLatencyMs??0);let plannerUsage={inputTokens:Number(body.plannerUsage?.inputTokens??0),outputTokens:Number(body.plannerUsage?.outputTokens??0),totalTokens:Number(body.plannerUsage?.totalTokens??0)};let plannerInput=body.plannerInput&&typeof body.plannerInput==="object"?body.plannerInput:{};
      const presentationCandidates=execution&&Array.isArray((body as Record<string,unknown>).presentationCandidates)?[...(body as Record<string,unknown>).presentationCandidates as Record<string,unknown>[]]:[];
      const presentationSourceHash=artifactKind==="slides"||nativeNarrative||nativeStoryboard||nativeAudio?Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(authoritativeSnapshot??body.snapshot??{})))),(value)=>value.toString(16).padStart(2,"0")).join(""):"";
      const presentationCompiledHash=artifactKind==="slides"||nativeNarrative||nativeStoryboard||nativeAudio?Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(compiledSnapshot)))),(value)=>value.toString(16).padStart(2,"0")).join(""):"";
      const presentationPageUsage=new Map<number,{inputTokens:number;outputTokens:number;totalTokens:number}>();
      const presentationIdentity={jobId:corr.replace(/:attempt:\d+$/u,""),ownerId,streamId,correlationId:corr};
      const checkpointPresentationResponse=execution?async(attempt:ProviderResponseReceipt&{pageIndex?:number;pageCount?:number;globalStartIndex?:number})=>{
        const pageIndex=Math.max(0,Number(attempt.pageIndex??0)),pageCount=Math.max(1,Number(attempt.pageCount??1)),globalStartIndex=Math.max(0,Number(attempt.globalStartIndex??0));
        const raw=attempt.candidateRaw??"";
        const contentHash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(raw))),(value)=>value.toString(16).padStart(2,"0")).join("");
        const capturedAt=new Date().toISOString();
        const attemptStage=attempt.call?.routingPhase?.endsWith("repair")||!attempt.call&&attempt.responseIds.length>1?"repair":"initial";
        const knownIds=[...new Set([...plannerResponseIds,...attempt.responseIds])];
        const providerAttempt=Math.max(1,knownIds.indexOf(attempt.responseId)+1);
        // Empty/incomplete/oversized responses still carry paid-call evidence. An
        // absent usable body never means that this provider request was free.
        const ownUsage=attempt.call?{inputTokens:attempt.call.inputTokens??null,outputTokens:attempt.call.outputTokens??null,totalTokens:attempt.call.totalTokens??null}:attempt.usage;
        if(nativeStoryboard&&(!attempt.storyboardEnvelope||new TextEncoder().encode(attempt.storyboardEnvelope).byteLength>1_048_576||!attempt.call?.requestDigest))throw new Error("output_storyboard_envelope_unavailable");
        const envelope=JSON.stringify({schema_version:attempt.call?3:2,artifact_kind:artifactKind,...(nativeAudio?{output_audio:nativeAudio,raw_envelope:attempt.rawEnvelope??null}:{}),...(nativeVideo?{output_video:nativeVideo,raw_envelope:attempt.rawEnvelope??null}:{}),...(nativeStoryboard?{output_storyboard:nativeStoryboard,storyboard_planner:execution.output?.settings.outputStoryboardPlanner,provider_envelope:attempt.storyboardEnvelope}:{}),...(nativeNarrative?{output_narrative:nativeNarrative,narrative_contract_digest:nativeNarrative.contractDigest}:{}),job_id:presentationIdentity.jobId,stream_id:streamId,document_id:projection.documentId,document_title:projection.documentTitle,document_revision:body.documentRevision??null,source_snapshot_sha256:presentationSourceHash,compiled_snapshot_sha256:presentationCompiledHash,response_id:attempt.responseId,model:attempt.model,page_index:pageIndex,page_count:pageCount,global_start_index:globalStartIndex,requested_slide_count:slideCountPolicy?.kind==="flexible"?null:requestedSlideCount??itemCount,...(slideCountPolicy?{slide_count_policy:slideCountPolicy}:{}),planned_slide_count:itemCount,provider_batch_count:productionPlan?.providerBatchCount??1,production_mode:productionMode,attempt_stage:attemptStage,provider_attempt:providerAttempt,captured_at:capturedAt,content_sha256:contentHash,output_text:raw,...(attempt.call?{call:attempt.call,usage:ownUsage,candidate_bytes:attempt.candidateBytes,candidate_truncated:attempt.candidateTruncated,completion_status:attempt.completionStatus??null,incomplete_reason:attempt.incompleteReason??null}:{})});
        let locallyRecoverable=false;
        let candidate:Record<string,unknown>={responseId:attempt.responseId,model:attempt.model,usage:ownUsage,candidateBytes:attempt.candidateBytes,candidateTruncated:attempt.candidateTruncated,pageIndex,pageCount,globalStartIndex,documentRevision:body.documentRevision??null,sourceSnapshotSha256:presentationSourceHash,compiledSnapshotSha256:presentationCompiledHash,contentSha256:contentHash,capturedAt,attemptStage,providerAttempt,locallyRecoverable,...(attempt.call?{clientRequestId:attempt.call.clientRequestId,requestDigest:attempt.call.requestDigest,routingPhase:attempt.call.routingPhase}:{})};
        if(artifactKind==="slides"&&!execution.output&&attempt.call){
          const retained=await retainPresentationCallResponse(env,presentationIdentity,{documentId:projection.documentId,envelope,candidate,call:attempt.call,projectScope:executionScope});
          candidate=retained.candidate;
          (body as Record<string,unknown>).providerSubmissions=retained.checkpoint.providerSubmissions;
        }else{
          const stored=await storePrivateContent(env,ownerId,"provider-response",envelope,executionScope);
          candidate={...candidate,contentRef:stored.contentId,contentExpiresAt:stored.expiresAt};
          if(attempt.call)(body as Record<string,unknown>).providerSubmissions=mergeProviderSubmissions((body as Record<string,unknown>).providerSubmissions,{[attempt.call.clientRequestId]:{...attempt.call,responseRef:stored.contentId}});
        }
        if(!attempt.candidateTruncated&&raw&&artifactKind==="slides"&&pageCount===1&&globalStartIndex===0&&itemCount<=MAX_MANUAL_PRESENTATION_SLIDES&&(slideCountPolicy?.kind==="flexible"||Number(requestedSlideCount??itemCount)===itemCount)&&(!productionPlan||productionPlan.providerBatchCount===1&&productionPlan.scenes.length===itemCount)){
          try{
            const sourceSnapshot=productionPlan?combinedSceneSnapshot(compiledSnapshot,productionPlan.scenes):compiledSnapshot;
            const assessment=assessStoredPresentationCandidate(raw,sourceSnapshot,{itemCount,...(slideCountPolicy?{slideCountPolicy}:{requestedSlideCount:itemCount}),presentationStyle,presentationFidelity,...(productionPlan?{productionScenes:productionPlan.scenes}:{})});
            locallyRecoverable=Boolean(assessment.output&&assessment.issues.length===0);
          }catch{/* Retaining evidence does not certify that it can be recovered. */}
        }
        candidate={...candidate,locallyRecoverable};
        const same=presentationCandidates.findIndex(entry=>entry.contentRef===candidate.contentRef);
        if(same<0)presentationCandidates.push(candidate);
        if(presentationCandidates.length>64)presentationCandidates.splice(0,presentationCandidates.length-64);
        if(attempt.call){
          const planning=providerSubmissions(body as Record<string,unknown>).filter(call=>call.operation==="planning"&&call.status==="completed");
          plannerUsage=planning.reduce((sum,call)=>({inputTokens:sum.inputTokens+Number(call.inputTokens??0),outputTokens:sum.outputTokens+Number(call.outputTokens??0),totalTokens:sum.totalTokens+Number(call.totalTokens??0)}),{inputTokens:0,outputTokens:0,totalTokens:0});
        }else{
          const previous=presentationPageUsage.get(pageIndex)??{inputTokens:0,outputTokens:0,totalTokens:0};
          plannerUsage={inputTokens:plannerUsage.inputTokens+Math.max(0,attempt.usage.inputTokens-previous.inputTokens),outputTokens:plannerUsage.outputTokens+Math.max(0,attempt.usage.outputTokens-previous.outputTokens),totalTokens:plannerUsage.totalTokens+Math.max(0,attempt.usage.totalTokens-previous.totalTokens)};
          presentationPageUsage.set(pageIndex,attempt.usage);
        }
        plannerModel=attempt.model;plannerResponseId=attempt.responseId;plannerResponseIds=knownIds;plannerLatencyMs=attempt.latencyMs;presentationSubmissionPending=false;
        (body as Record<string,unknown>).plannerResponseIds=plannerResponseIds;
        // Legacy Slides persist the derived attempt summary with this candidate;
        // a second onProviderAttempt progress write would repeat the same evidence.
        if(execution.output||artifactKind==="slides")plannerInput=!execution.output&&productionPlan?{...plannerInput,provider_request_count:plannerResponseIds.length}:{...plannerInput,validation:{...((plannerInput as Record<string,unknown>).validation&&typeof (plannerInput as Record<string,unknown>).validation==="object"?(plannerInput as Record<string,unknown>).validation as Record<string,unknown>:{}),provider_call_count:plannerResponseIds.length}};
        await execution.progress("planning",`${plannerResponseIds.length} paid provider response${plannerResponseIds.length===1?"":"s"} privately retained before validation.`,{plannerModel,plannerResponseId,plannerResponseIds,plannerUsage,...(attempt.call?{providerSubmissions:(body as Record<string,unknown>).providerSubmissions}:{}),...(execution.output?{plannerInput}:artifactKind==="slides"?{plannerInput,plannerLatencyMs}:{}),presentationCandidates,recoverablePresentationCandidate:presentationCandidates.some((entry)=>entry.locallyRecoverable===true),reservationId,costReservationId,costReservationPeriod,costReservationMicrousd,...(artifactKind==="slides"?{presentationProviderSubmission:"confirmed"}:{})});
        return{responseRef:String(candidate.contentRef)};
      }:undefined;
      const retainSceneEnvelope=nativeScene?async(received:OutputSceneEnvelope)=>{
        if(!execution?.output||!scenePrepared)throw new Error("output_scene_envelope_unavailable");
        await execution.output.beforeSourceTransmission();
        const envelope=JSON.stringify({version:"output-scene-envelope-v1",jobId:nativeScene.sceneRequestId,documentId,
          actorUserId:nativeScene.outputScene.costPreview.actorUserId,outputExecution:execution.output.reference,
          sceneCostBindingHash:nativeScene.outputScene.costPreview.bindingHash,...received});
        const stored=await storePrivateContent(env,ownerId,"provider-response",envelope,executionScope);
        await execution.progress("planning","Scene response retained",{sceneEnvelopeRef:stored.contentId});
        (body as Record<string,unknown>).sceneEnvelopeRef=stored.contentId;
        return {responseRef:stored.contentId};
      }:undefined;
      const sceneDispatchDeadline=artifactKind==="scene"?(clientRequestId?:string)=>{
        if(!scenePrepared)throw new SceneCostConsentError("scene_cost_confirmation_required",428);
        try{if(sponsorSceneClaim)requireSponsorScenePaidDispatchCurrent(sponsorSceneClaim);requireScenePaidDeadline(scenePilotValidUntil);requireSceneCostDeadline(scenePrepared);if(execution?.output){if(!clientRequestId)throw new Error("output_scene_request_identity_required");execution.output.beforeProviderDispatch(clientRequestId);}}
        catch(error){if(scenePendingRequestId)rememberScenePolicyStop(error,scenePendingRequestId,"after-pending");throw error;}
      }:undefined;
      const retainedObserver=paidProviderObserver(body as Record<string,unknown>,execution?.progress,{artifactId,reservationId,costReservationId,costReservationPeriod,costReservationMicrousd},execution?.output?.observeProvider??(execution&&artifactKind==="slides"?(receipt)=>retainLegacyPresentationFinancialReceipt(env,presentationIdentity,receipt):undefined),{presentation:artifactKind==="slides"});
      const observePaid:typeof retainedObserver=async observation=>{
        await retainedObserver(observation);
        if(artifactKind==="scene"&&observation.operation==="planning"&&observation.status==="pending"){
          scenePendingRequestId=observation.clientRequestId;
          try{await verifySceneDispatch();requireScenePaidDeadline(scenePilotValidUntil);requireSceneCostDeadline(scenePrepared!);}
          catch(error){
            // Native Scene must leave its exact call pending for the adapter's
            // source-free local-stop certificate. The legacy observer would
            // otherwise settle zero before that certificate can bind the call.
            if(!nativeScene){
              await retainedObserver({...observation,status:"rejected",costMicrousd:0});
              rememberScenePolicyStop(error,observation.clientRequestId,"after-pending");
            }
            throw error;
          }
        }
      };
      try{
        type Plan=Awaited<ReturnType<typeof generateDocumentArtifact>>["output"];const cached=body.artifactPlan;let plan:Plan;let nativeStoryboardRequestBody:string|undefined;
        const cachedPlan=cached?(nativeScene?readOutputSceneArtifact(cached):parseDocumentArtifactContent(JSON.stringify(cached))):null;
        if(nativeScene&&providerSubmissions(body as Record<string,unknown>).length&&!cachedPlan)throw new Error("output_scene_original_response_required");
        const plannerCosts=(recorded=0)=>nativeAudio?outputAudioPlannerCost(body as Record<string,unknown>,recorded):nativeScene?outputScenePlannerCost(body as Record<string,unknown>,nativeScene,recorded):nativeNarrative?outputNarrativePlannerCost(body as Record<string,unknown>,nativeNarrative,recorded):artifactKind==="slides"?frozenPresentationPlannerCost(body as Record<string,unknown>,recorded)??remainingDocumentPlannerCost(plannerModel,plannerUsage,recorded):remainingDocumentPlannerCost(plannerModel,plannerUsage,recorded);
        const guardPresentationSpend=artifactKind==="slides"?async(attempt:import("./openai-adapter.ts").ProviderAttemptPreflight)=>{
          const checkpoint=body as Record<string,unknown>;
          const current=providerSubmissions(checkpoint).find(call=>call.clientRequestId===checkpoint.presentationProviderClientRequestId);
          if(hasUnsettledProviderSubmission(checkpoint)||presentationSubmissionPending||checkpoint.presentationProviderSubmission==="pending"&&(!current||!["completed","rejected"].includes(current.status)))throw new ProviderRequestError({code:"provider_submission_uncertain",category:"network",scope:"request",action:"contact_support",message:"The original paid call has unresolved evidence. No new request was submitted.",retryable:false,retryAfterMs:null,requestId:null,httpStatus:409});
          const maximumProviderCallCount=productionPlan?.maximumProviderCallCount??2;
          if(new Set(plannerResponseIds.filter(Boolean)).size>=maximumProviderCallCount)throw new ProviderRequestError({code:"presentation_provider_call_cap_reached",category:"provider",scope:"request",action:"edit_request",message:"The approved presentation provider-attempt limit was reached; no additional paid request was submitted.",retryable:false,retryAfterMs:null,requestId:null,httpStatus:409});
          if(!hasCurrentOpenAITextPricing(attempt.model))throw new ProviderRequestError({code:"presentation_model_pricing_unavailable",category:"quota",scope:"request",action:"review_budget",message:"The configured slideshow model has no verified pricing; no paid request was submitted.",retryable:false,retryAfterMs:null,requestId:null,httpStatus:429});
          if(plannerUsage.totalTokens+attempt.maximumInputTokens+attempt.maximumOutputTokens>reserved)throw new ProviderRequestError({code:"presentation_token_cap_reached",category:"quota",scope:"request",action:"review_budget",message:"The next slideshow provider request could exceed its reserved monthly token budget and was not submitted.",retryable:false,retryAfterMs:null,requestId:null,httpStatus:429});
          const previous=plannerCosts().totalMicrousd;
          const maximum=estimateOpenAITextCallMaximumMicrousd(attempt.model,attempt.maximumInputTokens,attempt.maximumOutputTokens);
          if(previous+maximum>costReservationMicrousd)throw new ProviderRequestError({code:"presentation_spend_cap_reached",category:"quota",scope:"request",action:"review_budget",message:"The next slideshow provider request would exceed its application-enforced spending ceiling and was not submitted.",retryable:false,retryAfterMs:null,requestId:null,httpStatus:429});
          await execution?.output?.beforeProviderAttempt(attempt);
          // The awaited provider observer below persists this exact request plus its pending marker
          // before dispatch. A separate coarse marker adds a write without proving another boundary.
          if(execution)presentationSubmissionPending=true;
        }:undefined;
        const guardDocumentPlanningSpend:(attempt:import("./openai-adapter.ts").ProviderAttemptPreflight,videoLease?:OutputVideoHookLease)=>Promise<void>=guardPresentationSpend??(async(attempt:{model:string;maximumInputTokens:number;maximumOutputTokens:number;clientRequestId:string},videoLease?:OutputVideoHookLease)=>{
          if(artifactKind==="scene"){
            try{await verifySceneDispatch();}catch(error){rememberScenePolicyStop(error,attempt.clientRequestId,"before-pending");throw error;}
            const approved=nativeScene?.outputScene.costPreview??scenePrepared!.preview;
            const submitted=new Set(providerSubmissions(sceneBody).filter(receipt=>receipt.operation==="planning").map(receipt=>receipt.clientRequestId));
            if(attempt.model!==approved.model||Math.max(submitted.size,new Set(plannerResponseIds.filter(Boolean)).size)>=approved.maximumProviderCallCount
              ||costReservationMicrousd>approved.maximumMicrousd)throw new SceneCostConsentError("scene_cost_changed");
          }
          const maximumProviderCallCount=nativeStoryboard||nativeVideo?1:nativeScene?.outputScene.contract.maximumCalls??nativeNarrative?.maximumCalls??productionPlan?.maximumProviderCallCount??2;
          if(new Set(plannerResponseIds.filter(Boolean)).size>=maximumProviderCallCount)throw new ProviderRequestError({code:"document_provider_call_cap_reached",category:"provider",scope:"request",action:"edit_request",message:"The approved generation planning-attempt limit was reached; no additional paid request was submitted.",retryable:false,retryAfterMs:null,requestId:null,httpStatus:409});
          if(!hasKnownTextModelPricing(attempt.model))throw new ProviderRequestError({code:"document_model_pricing_unavailable",category:"quota",scope:"request",action:"review_budget",message:"The configured generation model has no verified pricing; no paid planning request was submitted.",retryable:false,retryAfterMs:null,requestId:null,httpStatus:429});
          const recorded=recordedDocumentPlannerUsage(sourceEvents,plannerResponseId,priceTextUsageBreakdownMicrousd(attempt.model,plannerUsage).totalMicrousd);
          const pendingPlannerTokens=recorded.tokensRecorded?0:plannerUsage.totalTokens;
          const plannerTokenCeiling=Math.min(reserved,documentPlanningTokenReservation(productionPlan?.maximumProviderCallCount));
          if(pendingPlannerTokens+attempt.maximumInputTokens+attempt.maximumOutputTokens>plannerTokenCeiling)throw new ProviderRequestError({code:"document_token_cap_reached",category:"quota",scope:"request",action:"review_budget",message:"The next generation planning request could exceed its reserved planning token budget and was not submitted.",retryable:false,retryAfterMs:null,requestId:null,httpStatus:429});
          const previous=remainingDocumentPlannerCost(attempt.model,plannerUsage,recorded.recordedCostMicrousd).totalMicrousd;
          const maximum=priceTextUsageBreakdownMicrousd(attempt.model,{inputTokens:attempt.maximumInputTokens,outputTokens:attempt.maximumOutputTokens,totalTokens:attempt.maximumInputTokens+attempt.maximumOutputTokens}).totalMicrousd;
          const plannerCostCeiling=nativeVideo?costReservationMicrousd-outputVideoMediaPrice().maximumMicrousd:Math.min(costReservationMicrousd,Math.max(0,productionPlan?.estimatedPlanningCostMicrousd??1_000_000));
          if(previous+maximum>plannerCostCeiling)throw new ProviderRequestError({code:"document_spend_cap_reached",category:"quota",scope:"request",action:"review_budget",message:"The next generation planning request would exceed its approved planning spending ceiling and was not submitted.",retryable:false,retryAfterMs:null,requestId:null,httpStatus:429});
          videoLease?.assertCurrent();await execution?.output?.beforeProviderAttempt(attempt,videoLease);
        });
        if(nativeNarrative&&cachedPlan)await verifyOutputNarrativeCompletion(nativeNarrative,artifactKind,cachedPlan.content_markdown,plannerInput,body as Record<string,unknown>);
        const nativeStoryboardPlanner=nativeStoryboard&&execution?.output?readStoryboardPlannerExecution(execution.output.settings.outputStoryboardPlanner):null;
        if(nativeStoryboard&&(!nativeStoryboardPlanner||JSON.stringify(nativeStoryboardPlanner.contract)!==JSON.stringify(nativeStoryboard)))throw new Error("output_storyboard_planner_unavailable");
        if(nativeStoryboard&&cachedPlan)throw new Error("output_storyboard_recovery_unavailable");
        if(nativeVideo&&cachedPlan)throw new Error("output_video_recovery_unavailable");
        if(cachedPlan&&!documentArtifactValidationIssues(artifactKind,cachedPlan,artifactValidationOptions).length){plan=cachedPlan;}else{
          if(body.plannerResponseId||providerSubmissions(body as Record<string,unknown>).some((entry)=>entry.operation==="planning"&&entry.status==="completed"))throw new ProviderRequestError({code:"provider_result_recovery_unavailable",category:"server",scope:"unknown",action:"contact_support",message:"The paid planning response cannot be safely reconstructed from its saved plan. No second planning request was submitted.",retryable:false,retryAfterMs:null,requestId:null,httpStatus:null});
          if(storyboardSafeRecovery)throw new ProviderRequestError({code:"storyboard_safe_recovery_plan_invalid",category:"provider",scope:"request",action:"contact_support",message:"The original storyboard plan is unavailable or invalid. No replacement image or second planner request was submitted.",retryable:false,retryAfterMs:null,requestId:storyboardSafeRecovery.rejectedProviderJobId,httpStatus:409});
          const planned=productionPlan
            ?await generateManagedArtifactDraft(env,ownerId,artifactKind,{documentTitle:projection.documentTitle,snapshot:compiledSnapshot,production:productionPlan,locale:body.locale,audience:audience||undefined,tone:tone||undefined,...(sceneConfiguration?{sceneMedium:sceneConfiguration.medium,sceneConfiguration}:{}),...presentationOptions,...(execution?.output?{outputTargetInstructions:String(execution.output.settings.outputTargetInstructions??"")}:{}),videoSize:artifactKind==="video"?(body.videoSize==="720x1280"?"720x1280":"1280x720"):undefined,videoAudioMode:artifactKind==="video"?requestedVideoAudioMode:undefined,...(artifactKind==="audio"&&requestedAudioProfile?{audioProfile:requestedAudioProfile,audioProviderModel:requestedAudioSelection?.model}:{}),signal:execution?.signal,progress:execution?.progress,...(checkpointPresentationResponse?{plannerResponse:checkpointPresentationResponse}:{}),onProviderSubmission:observePaid,plannerPreflight:guardDocumentPlanningSpend,...(sceneDispatchDeadline?{plannerDispatchGuard:sceneDispatchDeadline}:{}),plannerAttempt:async(attempt)=>{plannerModel=attempt.model;plannerResponseId=attempt.responseId;plannerResponseIds=attempt.responseIds;plannerLatencyMs=attempt.latencyMs;plannerUsage=attempt.usage;plannerInput={...plannerInput,provider_request_count:attempt.responseIds.length};(body as Record<string,unknown>).plannerResponseIds=attempt.responseIds;if(!execution?.output&&!batchPresentationBookkeeping)await execution?.progress("planning",`${productionPlan.team.label}: ${attempt.responseIds.length} paid provider response${attempt.responseIds.length===1?"":"s"} safely recorded.`,{plannerModel,plannerResponseId,plannerLatencyMs,plannerUsage,plannerInput,plannerResponseIds:attempt.responseIds,reservationId,costReservationId,costReservationPeriod,costReservationMicrousd,productionPlan,...(artifactKind==="slides"?{presentationProviderSubmission:"confirmed"}:{})});presentationSubmissionPending=false;}})
            :await generateDocumentArtifact(env,ownerId,artifactKind,{documentTitle:projection.documentTitle,snapshot:compiledSnapshot,options:{itemCount,...(nativeVideoPlanner?{productionMode:"manual" as const,outputVideoPlanner:nativeVideoPlanner,onVideoPlannerEnvelope:(envelope:import("./output-video-planner-envelope.ts").VideoPlannerRawEnvelope)=>withNativeVideo(lease=>execution!.output!.retainVideoPlannerEnvelope(envelope,lease))}:{}),...(nativeStoryboardPlanner?{productionMode:"manual" as const,outputStoryboard:nativeStoryboardPlanner,onStoryboardEnvelope:execution?.output?.retainStoryboardEnvelope}:{}),...(nativeScene&&retainSceneEnvelope?{productionMode:"manual" as const,onProviderNotDispatched:execution?.output?.providerNotDispatched,outputScene:{intake:nativeScene.outputScene.intake,contract:nativeScene.outputScene.contract,retainEnvelope:retainSceneEnvelope}}:{}),...(nativeNarrative?{outputNarrative:nativeNarrative}:{}),...(nativeAudio?{outputAudio:nativeAudio,productionMode:"manual" as const}:{}),locale:body.locale,audience:audience||undefined,tone:tone||undefined,...(sceneConfiguration?{sceneMedium:sceneConfiguration.medium,sceneConfiguration}:{}),...presentationOptions,...(execution?.output?{outputTargetInstructions:String(execution.output.settings.outputTargetInstructions??"")}:{}),videoSeconds:artifactKind==="video"?requestedVideoSeconds:undefined,videoSize:artifactKind==="video"?(body.videoSize==="720x1280"?"720x1280":"1280x720"):undefined,videoAudioMode:artifactKind==="video"?requestedVideoAudioMode:undefined,...(artifactKind==="audio"&&requestedAudioProfile?{audioProfile:requestedAudioProfile,audioProviderModel:requestedAudioSelection?.model}:{}),signal:execution?.signal,...(checkpointPresentationResponse?{onProviderResponse:nativeVideo?(response)=>withNativeVideo(lease=>{lease.assertCurrent();return checkpointPresentationResponse(response);}):checkpointPresentationResponse}:{}),onProviderSubmission:nativeVideo?(receipt)=>withNativeVideo(lease=>{lease.assertCurrent();return observePaid(receipt);}):observePaid,onBeforeProviderAttempt:nativeVideo?(attempt)=>withNativeVideo(lease=>guardDocumentPlanningSpend(attempt,lease)):guardDocumentPlanningSpend,...(sceneDispatchDeadline?{onBeforeProviderDispatch:sceneDispatchDeadline}:execution?.output?{onBeforeProviderDispatch:execution.output.beforeProviderDispatch}:{}),onProviderAttempt:async(attempt)=>{const recordAttempt=async()=>{plannerModel=attempt.model;plannerResponseId=attempt.responseId;plannerResponseIds=attempt.responseIds;plannerUsage=attempt.usage;plannerLatencyMs=attempt.latencyMs;plannerInput={...plannerInput,validation:{...((plannerInput as Record<string,unknown>).validation&&typeof (plannerInput as Record<string,unknown>).validation==="object"?(plannerInput as Record<string,unknown>).validation as Record<string,unknown>:{}),provider_call_count:attempt.responseIds.length}};(body as Record<string,unknown>).plannerResponseIds=attempt.responseIds;if(!batchPresentationBookkeeping)await execution?.progress("planning",`${attempt.responseIds.length} paid provider response${attempt.responseIds.length===1?"":"s"} safely recorded.`,{plannerModel,plannerResponseId,plannerResponseIds,plannerUsage,plannerInput,reservationId,costReservationId,costReservationPeriod,costReservationMicrousd,...(artifactKind==="slides"?{presentationProviderSubmission:"confirmed"}:{})});presentationSubmissionPending=false;};if(nativeVideo)await withNativeVideo(()=>recordAttempt());else await recordAttempt();}}});
          plan=planned.output;plannerModel=planned.model;plannerResponseId=planned.responseId;plannerLatencyMs=planned.latencyMs;plannerUsage=planned.usage;plannerInput=planned.inputReceipt;
          if(nativeStoryboard&&"storyboardRequestBody" in planned&&typeof planned.storyboardRequestBody==="string")nativeStoryboardRequestBody=planned.storyboardRequestBody;
          await execution?.progress(artifactKind==="storyboard"?"rendering-frames":artifactKind==="video"?"preparing-video":artifactKind==="audio"?"preparing-audio":artifactKind==="slides"?"composing-slides":"writing",productionPlan?`${productionPlan.team.label} planned ${itemCount} distinct ${artifactKind==="video"?"scenes":artifactKind==="storyboard"?"frames":artifactKind==="audio"?"audio segments":"work units"}.`:artifactKind==="storyboard"?`Story structure ready. Rendering ${itemCount} connected frames.`:artifactKind==="video"?"Motion prompt ready. Preparing the provider render.":artifactKind==="audio"?"The requested audio direction is ready. Preparing the selected specialist provider.":artifactKind==="slides"?`The ${itemCount}-slide visual system is composed. Saving its reusable layout data.`:`The ${artifactKind.replaceAll("_"," ")} is written. Saving its durable result.`,{artifactPlan:plan,plannerModel,plannerResponseId,plannerResponseIds,plannerLatencyMs,plannerUsage,plannerInput,reservationId,costReservationId,costReservationPeriod,costReservationMicrousd,...(productionPlan?{productionPlan}:{})});
        }
        const nativeStoryboardPlan=nativeStoryboard?await captureOutputStoryboardPlan(plan,nativeStoryboard,plannerResponseId,nativeStoryboardRequestBody):null;
        if(nativeStoryboardPlan){
          const originalPlanning=providerSubmissions(body as Record<string,unknown>).filter(receipt=>receipt.operation==="planning");
          if(originalPlanning.length!==1||originalPlanning[0]?.status!=="completed"||originalPlanning[0]?.provider!=="openai"
            ||originalPlanning[0]?.providerRequestId!==plannerResponseId||originalPlanning[0]?.model!==plannerModel)throw new Error("output_storyboard_planner_receipt_unavailable");
          plan=nativeStoryboardPlan.plan;
        }
        let sceneCompletionReceipt:Record<string,unknown>|null=null;
        if(nativeScene){
          if(!execution?.output?.readSceneEnvelope)throw new Error("output_scene_envelope_unavailable");
          const calls=providerSubmissions(body as Record<string,unknown>).filter(call=>call.operation==="planning");
          if(calls.length!==1||!calls[0]?.responseRef||calls[0].responseRef!==(body as Record<string,unknown>).sceneEnvelopeRef)throw new Error("output_scene_envelope_unavailable");
          const retained=await execution.output.readSceneEnvelope(calls[0].responseRef);
          const font=await env.ASSETS.fetch(new Request("https://forma.invalid/fonts/dm-mono/DMMono-Regular-55b4c98f.ttf"));
          const fontBytes=font.ok?await font.arrayBuffer():new ArrayBuffer(0);
          const checked=await verifyOutputSceneCompletion(nativeScene,plan,plannerInput as Record<string,unknown>,body as Record<string,unknown>,retained,execution.output.reference,fontBytes);
          plannerInput=checked.inputReceipt;sceneCompletionReceipt=checked.receipt;
          await execution.output.beforeSourceTransmission();
        }
        const narrativeReceipt=nativeNarrative?await verifyOutputNarrativeCompletion(nativeNarrative,artifactKind,plan.content_markdown,plannerInput,body as Record<string,unknown>):null;
        const expectedPlannerCost=plannerCosts().totalMicrousd;const recordedPlanner=recordedDocumentPlannerUsage(sourceEvents,plannerResponseId,expectedPlannerCost);const billablePlannerUsage=recordedPlanner.tokensRecorded?{inputTokens:0,outputTokens:0,totalTokens:0}:plannerUsage;const plannerCost=plannerCosts(recordedPlanner.recordedCostMicrousd);const renderedItems=Array.isArray(body.renderedItems)?body.renderedItems.map((item)=>({...item})):[];const costParts:ProviderCostBreakdown[]=[plannerCost,...(storyboardSafeRecovery?[...storyboardSafeRecovery.completedFrameBreakdowns,storyboardSafeRecovery.rejectedFrameBreakdown]:[])];const rejectedFrameCostMicrousd=storyboardSafeRecovery?.rejectedFrameCostMicrousd??0;let mediaUrl:string|null=null;let mediaType:string|null=null;let generatedMediaHash="";let generatedAudioTiming:ReturnType<typeof audioDurationMetadata>|null=null;let provider="openai";let modelId=plannerModel;let providerJobId=activeProviderJobId;let renderLatencyMs=0;let videoCostMicrousd=0;let audioCostMicrousd=0;let generatedLyrics="";let totalTokens=billablePlannerUsage.totalTokens;let videoInputReceipt:Record<string,unknown>|null=body.videoInputReceipt&&typeof body.videoInputReceipt==="object"?body.videoInputReceipt:null;let audioInputReceipt:Record<string,unknown>|null=body.audioInputReceipt&&typeof body.audioInputReceipt==="object"?body.audioInputReceipt:null;let productionRenderReceipt:Record<string,unknown>|null=null;
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
            const legacyFrameInput=nativeStoryboardPlan?null:storyboardFrameRenderingInput(compiledSnapshot,item);
            const baseFrameInput=nativeStoryboardPlan?{snapshot:compiledSnapshot,direction:outputStoryboardFrameDirection(nativeStoryboardPlan,index),size:"1536x1024" as const,ideogramCaptionStrategy:"production_director" as const}:legacyFrameInput!;
            const safeFrameInput=storyboardSafeRecovery&&legacyFrameInput?storyboardSafeRecoveryRenderingInput(legacyFrameInput,item,index):null;
            const frameInput=safeFrameInput??baseFrameInput;
            if(storyboardSafeRecovery&&safeFrameInput&&index===storyboardSafeRecovery.failedFrameIndex){const safePrompt=storyboardSafeRecoveryProviderPrompt(safeFrameInput);const safePromptSha256=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(safePrompt))),(byte)=>byte.toString(16).padStart(2,"0")).join("");if(safePromptSha256===storyboardSafeRecovery.rejectedPromptSha256)throw new ProviderRequestError({code:"storyboard_safe_recovery_prompt_unchanged",category:"safety",scope:"request",action:"edit_request",message:"The replacement frame still matches its rejected provider prompt. No second image request was submitted.",retryable:false,retryAfterMs:null,requestId:storyboardSafeRecovery.rejectedProviderJobId,httpStatus:409});}
            const retainedReceipt:FalImageProviderReceipt|undefined=activeProviderJobId?{provider:"fal",model:activeProviderModel,providerRequestId:activeProviderJobId,providerStatusUrl:activeProviderStatusUrl,providerResponseUrl:activeProviderResponseUrl,providerCancelUrl:activeProviderCancelUrl}:undefined;
            if(nativeStoryboardPlan&&retainedReceipt)throw new Error("output_storyboard_recovery_unavailable");
            const frameHooks=nativeStoryboardPlan&&execution?.output?storyboardFrameHooks(nativeStoryboardPlan,index,{beforeAttempt:execution.output.beforeProviderAttempt,
              checkpoint:(request,plan,frameIndex)=>execution.output!.retainStoryboardFrameRequest!(request,plan,frameIndex)}):null;
            const imageOptions={onProviderSubmission:(receipt:import("../src/model/provider-submission").PaidProviderSubmission)=>observePaid({...receipt,unitId:`frame:${index+1}`}),quality:nativeStoryboardPlan?"high" as const:"low" as const,size:frameInput.size,ideogramCaptionStrategy:frameInput.ideogramCaptionStrategy,...(nativeStoryboardPlan?{outputFormat:"png" as const}:{outputFormat:"jpeg" as const,outputCompression:78}),signal:execution?.signal,
              ...(frameHooks&&execution?.output?{...frameHooks,outputFalImage:execution.output.settings.outputFalImage,onBeforeProviderDispatch:execution.output.beforeProviderDispatch,onBeforeSourceTransmission:execution.output.beforeSourceTransmission}:{}),
              ...(retainedReceipt?{providerReceipt:retainedReceipt,providerClientRequestId:providerSubmissions(body as Record<string,unknown>).find((entry)=>entry.provider==="fal"&&entry.providerRequestId===retainedReceipt.providerRequestId)?.clientRequestId}:{}),
              onStage:(stage:string,message:string)=>{if(stage==="provider-submit"){storyboardSubmissionAttempted=true;storyboardProviderSubmission="pending";storyboardProviderRequestedAt=new Date().toISOString();storyboardProviderAcceptedAt="";}return execution?.progress(stage,`Frame ${index+1} · ${message}`,checkpoint());},
              onProviderReceipt:async(receipt:FalImageProviderReceipt)=>{if(storyboardSafeRecovery&&receipt.providerRequestId===storyboardSafeRecovery.rejectedProviderJobId)throw new ProviderRequestError({code:"storyboard_safe_recovery_reused_rejected_request",category:"provider",scope:"request",action:"contact_support",message:"The provider returned the already rejected storyboard request. Automatic recovery stopped without replaying its terminal result.",retryable:false,retryAfterMs:null,requestId:receipt.providerRequestId,httpStatus:409});activeProviderJobId=receipt.providerRequestId;activeProviderModel=receipt.model;activeProviderStatusUrl=receipt.providerStatusUrl;activeProviderResponseUrl=receipt.providerResponseUrl;activeProviderCancelUrl=receipt.providerCancelUrl;storyboardSubmissionAttempted=true;storyboardProviderSubmission="confirmed";storyboardProviderAcceptedAt=storyboardProviderAcceptedAt||new Date().toISOString();await execution?.progress("provider-queued",`Frame ${index+1} · Ideogram accepted the original image request; its provider receipt is safely retained.`,{...checkpoint(),provider:receipt.provider});},
            };
            if(retainedReceipt&&selectImageAdapter(env,imageOptions).provider!=="fal-ideogram")throw new ProviderRequestError({code:"fal_provider_receipt_mismatch",category:"provider",scope:"request",action:"contact_support",message:"The saved storyboard frame belongs to a different image provider. A second paid frame was not submitted.",retryable:false,retryAfterMs:null,requestId:retainedReceipt.providerRequestId,httpStatus:409});
            const image=await generateCreativeImage(env,ownerId,frameInput.snapshot,frameInput.direction,imageOptions);
            const media=await storeGeneratedImage(env,storageOwnerId,`${artifactId}-frame-${index+1}`,image.bytes,image.model,image.mimeType,{artifactRole:"storyboard-frame",artifactId,provider:image.provider,providerRequestId:image.providerRequestId??"",...(nativeStoryboardPlan?{providerSubmissionId:image.providerSubmissionId??"",storyboardFrameIndex:String(index),storyboardBindingSha256:nativeStoryboardPlan.bindingSha256}:{})});
            if(nativeStoryboardPlan)await readOutputStoryboardFrameMedia(env,storageOwnerId,artifactId,index,{id:`${artifactId}-frame-${index+1}`,media_url:media.url,media_type:media.mimeType,width:image.width,height:image.height,provider:image.provider,provider_request_id:image.providerRequestId??"",provider_submission_id:image.providerSubmissionId??"",provider_model:image.model,source_content_hash:media.contentHash},nativeStoryboardPlan.bindingSha256,{signal:execution?.signal,deadlineMs:execution?.output?.storyboardMediaDeadlineMs?.()??0});
            const imageAccounting=image as typeof image&{renderingSpeed?:"TURBO"|"BALANCED"|"QUALITY";expansionModel?:"None"|"Medium"|"Large"};
            renderedItems.push({id:`${artifactId}-frame-${index+1}`,title:item.title,media_url:media.url,media_type:media.mimeType,...(nativeStoryboardPlan?{source_content_hash:media.contentHash}:{}),width:image.width,height:image.height,provider:image.provider,provider_request_id:image.providerRequestId,provider_submission_id:image.providerSubmissionId,provider_model:image.model,cost_microusd:image.costBreakdown.totalMicrousd,...(imageAccounting.renderingSpeed?{rendering_speed:imageAccounting.renderingSpeed}:{}),...(imageAccounting.expansionModel?{expansion_model:imageAccounting.expansionModel}:{})});
            modelId=image.model;provider=image.provider;providerJobId=image.providerRequestId??providerJobId;renderLatencyMs+=image.latencyMs;totalTokens+=image.usage.totalTokens;costParts.push(image.costBreakdown);
            storyboardProviderSubmission="cleared";
            await execution?.progress("rendering-frames",`${index+1} of ${plan.items.length} storyboard frames are safely stored.`,{...checkpoint(),provider:image.provider,providerJobId:"",providerModel:"",providerStatusUrl:"",providerResponseUrl:"",providerCancelUrl:"",storyboardProviderRequestedAt:"",storyboardProviderAcceptedAt:""});
            activeProviderJobId="";activeProviderModel="";activeProviderStatusUrl="";activeProviderResponseUrl="";activeProviderCancelUrl="";storyboardProviderRequestedAt="";storyboardProviderAcceptedAt="";storyboardSubmissionAttempted=false;
          }
        }else if(artifactKind==="video"&&productionPlan){
          const managed=await renderManagedVideoProduction(env,storageOwnerId,artifactId,plan,productionPlan,{providerActorId:actorUserId,snapshot:compiledSnapshot,references:preparedVideoReferences,videoSize:body.videoSize==="720x1280"?"720x1280":"1280x720",audioMode:requestedVideoAudioMode,existingItems:renderedItems,existingSceneReceipts:body.productionSceneReceipts,existingAnchor:body.productionAnchor,prepaidSceneIds:[...prepaidSceneIds],prepaidAnchor:body.productionPrepaidAnchor,signal:execution?.signal,onProviderSubmission:observePaid,progress:productionProgress,checkpoint:(checkpoint)=>{if(checkpoint.productionSceneReceipts&&typeof checkpoint.productionSceneReceipts==="object")body.productionSceneReceipts=checkpoint.productionSceneReceipts as Record<string,ProductionSceneReceipt>;if(checkpoint.productionAnchor&&typeof checkpoint.productionAnchor==="object")body.productionAnchor=checkpoint.productionAnchor as Record<string,unknown>;}});
          renderedItems.splice(0,renderedItems.length,...managed.items);costParts.push(...managed.imageCosts);totalTokens+=managed.imageUsage.totalTokens;videoCostMicrousd=managed.videoCostMicrousd;const first=managed.receipts[0];provider="fal";modelId=first?.providerModel??VIDEO_ADAPTER_CONTRACT.model;providerJobId=first?.providerJobId??"";activeProviderJobId=providerJobId;mediaUrl=managed.items[0]?.media_url?String(managed.items[0].media_url):null;mediaType=managed.items[0]?.media_type?String(managed.items[0].media_type):null;productionRenderReceipt={production_mode:"managed",team:productionPlan.team,plan:productionPlan,anchor:managed.anchor,scenes:managed.receipts,assembly:managed.assembly,quality:managed.quality};videoInputReceipt={provider:"fal",model:modelId,production_mode:"managed",reference_inputs:managed.receipts.flatMap((receipt)=>Array.isArray(receipt.videoInputReceipt?.reference_inputs)?receipt.videoInputReceipt.reference_inputs:[]),used_reference_pixels:managed.receipts.some((receipt)=>receipt.videoInputReceipt?.used_reference_pixels===true),scenes:managed.receipts,assembly:managed.assembly};
        }else if(nativeVideo){
          const output=execution!.output!,check=()=>({artifactId,artifactPlan:plan,plannerModel,plannerResponseId,plannerResponseIds,plannerLatencyMs,plannerUsage,plannerInput,videoInputReceipt,reservationId,costReservationId,costReservationPeriod,costReservationMicrousd});
          let clientRequestId="";
          const video=await generateOutputVideo(env,plan.content_markdown,{outputVideo:nativeVideo,seconds:4,size:nativeVideo.frameSize,resolution:"480p",audioMode:"silent",generateAudio:false,
            snapshot:compiledSnapshot,plan,endUserId:ownerId,providerModel:OUTPUT_VIDEO_TRANSPORT.model,references:preparedVideoReferences,audioReferences:[],signal:execution?.signal,
            onBeforeSourceTransmission:lease=>output.withVideoLease(lease,()=>output.beforeSourceTransmission()),
            onBeforeProviderAttempt:(attempt,lease)=>output.withVideoLease(lease,async()=>{clientRequestId=attempt.clientRequestId;await output.beforeProviderAttempt(attempt,lease);}),
            onBeforeProviderDispatch:(id,lease)=>{lease.assertCurrent();output.beforeProviderDispatch(id);videoSubmissionAttempted=true;},
            onProviderSubmission:(receipt,lease)=>output.withVideoLease(lease,()=>observePaid(receipt)),
            onOutputVideoEnvelope:(envelope,lease)=>output.withVideoLease(lease,()=>output.retainVideoMediaEnvelope(envelope,lease)),
            onPrepared:(receipt,lease)=>output.withVideoLease(lease,async()=>{videoInputReceipt={provider:receipt.provider,model:receipt.model,submitted_prompt:receipt.submittedPrompt,parameters:receipt.parameters,reference_inputs:receipt.referenceInputs,used_reference_pixels:receipt.usedReferencePixels,adaptation:receipt.adaptation};await execution!.progress("preparing-video","Video request",check());}),
            onReceipt:(receipt,lease)=>output.withVideoLease(lease,async()=>{activeProviderJobId=receipt.providerJobId;activeProviderModel=receipt.model;activeProviderStatusUrl=receipt.providerStatusUrl;activeProviderResponseUrl=receipt.providerResponseUrl;activeProviderCancelUrl=receipt.providerCancelUrl;await execution!.progress("queued","Video queued",{...check(),...receipt});}),
          });
          providerJobId=video.providerJobId;activeProviderJobId=video.providerJobId;activeProviderModel=video.model;provider=video.provider;modelId=video.model;renderLatencyMs=video.latencyMs;videoCostMicrousd=video.costMicrousd;
          const media=await storeGeneratedMedia(env,storageOwnerId,artifactId,video.bytes,video.model,video.mimeType,{artifactRole:"document-video",artifactId,provider:"fal",providerJobId,providerRequestId:providerJobId,providerSubmissionId:clientRequestId,outputVideoRequestDigest:String(video.providerParameters.request_digest)});
          mediaUrl=media.url;mediaType=media.mimeType;generatedMediaHash=media.contentHash;
          renderedItems.push({id:`${artifactId}-item-1`,media_url:mediaUrl,media_type:mediaType});
          const result={artifactId,mediaUrl,mediaType,sha256:media.contentHash,byteLength:video.bytes.byteLength,clientRequestId,providerRequestId:providerJobId,model:video.model,requestDigest:video.providerParameters.request_digest};
          await execution!.progress("rendering-video","Video saved",{...check(),outputVideoMediaResult:result});
        }else if(artifactKind==="video"){
          const size=body.videoSize==="720x1280"?"720x1280":"1280x720";
          const retainedReceipt:CreativeVideoPreparedReceipt|undefined=body.providerJobId&&videoInputReceipt?{provider:String(videoInputReceipt.provider??"fal"),model:String(videoInputReceipt.model??activeProviderModel),submittedPrompt:String(videoInputReceipt.submitted_prompt??""),parameters:videoInputReceipt.parameters&&typeof videoInputReceipt.parameters==="object"?videoInputReceipt.parameters as Record<string,unknown>:{},referenceInputs:Array.isArray(videoInputReceipt.reference_inputs)?videoInputReceipt.reference_inputs as Array<Record<string,unknown>>:[],usedReferencePixels:videoInputReceipt.used_reference_pixels===true,...(videoInputReceipt.adaptation?{adaptation:videoInputReceipt.adaptation as CreativeVideoPreparedReceipt["adaptation"]}:{})}:undefined;
          const progressCheckpoint=()=>({artifactId,artifactPlan:plan,providerJobId:activeProviderJobId,providerModel:activeProviderModel,providerStatusUrl:activeProviderStatusUrl,providerResponseUrl:activeProviderResponseUrl,providerCancelUrl:activeProviderCancelUrl,reservationId,costReservationId,costReservationPeriod,costReservationMicrousd,plannerModel,plannerResponseId,plannerLatencyMs,plannerUsage,plannerInput,videoInputReceipt});
          const video=await generateCreativeVideo(env,plan.content_markdown,{
            seconds:requestedVideoSeconds,size,resolution:body.videoResolution,audioMode:requestedVideoAudioMode,snapshot:compiledSnapshot,plan,endUserId:ownerId,providerJobId:body.providerJobId,providerModel:activeProviderModel||undefined,providerStatusUrl:activeProviderStatusUrl||undefined,providerResponseUrl:activeProviderResponseUrl||undefined,providerCancelUrl:activeProviderCancelUrl||undefined,references:preparedVideoReferences,audioReferences:preparedAudioReferences,retainedReceipt,signal:execution?.signal,
            onPrepared:(receipt)=>{const previous=body.providerJobId?videoInputReceipt:null;videoInputReceipt={...(previous??{}),provider:receipt.provider,model:receipt.model,provider_job_id:activeProviderJobId||null,submitted_prompt:previous?.submitted_prompt??receipt.submittedPrompt,parameters:previous?.parameters??receipt.parameters,reference_inputs:previous?.reference_inputs??receipt.referenceInputs,used_reference_pixels:previous?.used_reference_pixels??receipt.usedReferencePixels,adaptation:previous?.adaptation??receipt.adaptation};activeProviderModel=receipt.model;return execution?.progress("preparing-video","The complete visual sequence, audio policy, and provider input are validated and retained before submission.",progressCheckpoint());},
            onStage:(stage,message)=>{if(stage==="submitting")videoSubmissionAttempted=true;return execution?.progress(stage,message,progressCheckpoint());},
            onReceipt:(receipt)=>{activeProviderJobId=receipt.providerJobId;activeProviderModel=receipt.model;activeProviderStatusUrl=receipt.providerStatusUrl;activeProviderResponseUrl=receipt.providerResponseUrl;activeProviderCancelUrl=receipt.providerCancelUrl;if(videoInputReceipt)videoInputReceipt={...videoInputReceipt,provider_job_id:receipt.providerJobId,queue:{status_url:receipt.providerStatusUrl,response_url:receipt.providerResponseUrl,cancel_url:receipt.providerCancelUrl}};return execution?.progress("queued","Video accepted by Fal. It will continue safely if this page closes.",{...progressCheckpoint(),...receipt,providerModel:receipt.model});},
          });
          providerJobId=video.providerJobId;activeProviderJobId=video.providerJobId;activeProviderModel=video.model;activeProviderStatusUrl=video.providerStatusUrl;activeProviderResponseUrl=video.providerResponseUrl;activeProviderCancelUrl=video.providerCancelUrl;provider=video.provider;modelId=video.model;renderLatencyMs=video.latencyMs;videoCostMicrousd=Math.max(0,video.costMicrousd-prepaidProviderCostMicrousd);videoInputReceipt={provider:video.provider,model:video.model,provider_job_id:video.providerJobId,submitted_prompt:video.submittedPrompt,parameters:video.providerParameters,reference_inputs:video.referenceInputs,used_reference_pixels:video.usedReferencePixels,adaptation:video.adaptation,queue:{status_url:video.providerStatusUrl,response_url:video.providerResponseUrl,cancel_url:video.providerCancelUrl}};const media=await storeGeneratedMedia(env,storageOwnerId,artifactId,video.bytes,video.model,video.mimeType,{artifactRole:"document-video",artifactId,providerJobId});mediaUrl=media.url;mediaType=media.mimeType;
        }else if(artifactKind==="audio"){
          const selected=requestedAudioSelection!;
          const retainedReceipt:CreativeAudioPreparedReceipt|undefined=body.providerJobId&&audioInputReceipt?{
            provider:"fal",model:String(audioInputReceipt.model??activeProviderModel??selected.model),submittedPrompt:String(audioInputReceipt.submitted_prompt??""),
            parameters:audioInputReceipt.parameters&&typeof audioInputReceipt.parameters==="object"?audioInputReceipt.parameters as Record<string,unknown>:{},
            imageReference:audioInputReceipt.image_reference&&typeof audioInputReceipt.image_reference==="object"?audioInputReceipt.image_reference as Record<string,unknown>:null,
            ...(audioInputReceipt.video_reference&&typeof audioInputReceipt.video_reference==="object"?{videoReference:audioInputReceipt.video_reference as Record<string,unknown>}:{}),
            sourceAudioTreatment:audioInputReceipt.source_audio_treatment==="authored-description-only"?"authored-description-only":"none",audioWaveformSubmitted:false,
          }:undefined;
          // Recovery polls the original paid request. It must not readapt, reprice,
          // or reject that historical input under today's preparation limits.
          let adaptation:ReturnType<typeof adaptAudioPrompt>|null=null;
          if(!retainedReceipt){
            try{adaptation=adaptAudioPrompt(compiledSnapshot,plan,{tone,audience,profile:requestedAudioProfile,model:selected.model});}
            catch(error){
              if(error instanceof AudioProviderInputError||error instanceof AudioAdapterSelectionError)throw new ProviderRequestError({code:error.code,category:"provider",scope:"request",action:"edit_request",message:error.message,retryable:false,retryAfterMs:null,requestId:null,httpStatus:422},plan.content_markdown);
              throw error;
            }
          }
          if(adaptation&&!adaptation.compilation.valid)throw new ProviderRequestError({code:"audio_prompt_requirements_exceed_provider_limit",category:"provider",scope:"request",action:"edit_request",message:`Required audio direction exceeds ${selected.contract.label}'s supported prompt size. Shorten the locked requirements before starting a paid request.`,retryable:false,retryAfterMs:null,requestId:null,httpStatus:400},adaptation.prompt);
          const sourceAudioBlockIds=adaptation?.sourceAudioBlockIds??(Array.isArray(audioInputReceipt?.source_audio_block_ids)?audioInputReceipt.source_audio_block_ids.filter((id):id is string=>typeof id==="string"):[]);
          const progressCheckpoint=()=>({artifactId,artifactPlan:plan,providerJobId:activeProviderJobId,providerModel:activeProviderModel||selected.model,providerStatusUrl:activeProviderStatusUrl,providerResponseUrl:activeProviderResponseUrl,providerCancelUrl:activeProviderCancelUrl,reservationId,costReservationId,costReservationPeriod,costReservationMicrousd,audioEstimatedCostMicrousd:selected.estimatedCostMicrousd,plannerModel,plannerResponseId,plannerLatencyMs,plannerUsage,plannerInput,audioInputReceipt});
          const audio=await generateCreativeAudio(env,retainedReceipt?.submittedPrompt??adaptation!.prompt,{
            ...(nativeAudio?{outputAudio:nativeAudio,onBeforeProviderAttempt:execution!.output!.beforeProviderAttempt,onBeforeProviderDispatch:execution!.output!.beforeProviderDispatch,onBeforeSourceTransmission:execution!.output!.beforeSourceTransmission,onProviderSubmission:observePaid,
              onOutputAudioRequest:async(request:import("./output-audio-execution.ts").OutputAudioAttempt&{clientRequestId:string;requestDigest:string})=>{await execution!.output!.beforeSourceTransmission();(body as Record<string,unknown>).outputAudioRequest=request;await execution!.progress("preparing-audio","Exact original Audio request captured before submission.",{outputAudioRequest:request});}}:{}),
            imageReference:audioImageReference,videoReference:audioVideoReference,profile:requestedAudioProfile,spokenScript:adaptation?.spokenScript,voiceDirection:adaptation?.voiceDirection,
            estimatedCostMicrousd:selected.estimatedCostMicrousd,sourceAudioBlockIds,providerJobId:body.providerJobId,providerModel:activeProviderModel||selected.model,providerStatusUrl:activeProviderStatusUrl||undefined,providerResponseUrl:activeProviderResponseUrl||undefined,providerCancelUrl:activeProviderCancelUrl||undefined,retainedReceipt,signal:execution?.signal,
            onPrepared:(receipt)=>{const previous=body.providerJobId?audioInputReceipt:null;audioInputReceipt={...(previous??{}),provider:receipt.provider,model:receipt.model,provider_job_id:activeProviderJobId||null,submitted_prompt:previous?.submitted_prompt??receipt.submittedPrompt,parameters:previous?.parameters??receipt.parameters,image_reference:previous?.image_reference??receipt.imageReference,...(receipt.videoReference?{video_reference:previous?.video_reference??receipt.videoReference}:{}),source_audio_treatment:receipt.sourceAudioTreatment,audio_waveform_submitted:false,source_audio_block_ids:sourceAudioBlockIds,...(adaptation?{adaptation:{adapter_id:adaptation.adapterId,adapter_version:adaptation.adapterVersion,ordered_cue_count:adaptation.orderedCueCount,prompt_compacted:adaptation.compilation.compacted,omitted_optional_sections:adaptation.compilation.omittedSectionIds,...(adaptation.inputBudget?{input_budget:adaptation.inputBudget}:{})}}:{})};activeProviderModel=receipt.model;body.audioInputReceipt=audioInputReceipt;return execution?.progress("preparing-audio","The approved audio goal, private source permissions, specialist model, and exact provider input are retained before submission.",progressCheckpoint());},
            onStage:(stage,message)=>{if(stage==="submitting")videoSubmissionAttempted=true;return execution?.progress(stage,message,{...progressCheckpoint(),...(stage==="submitting"?{audioProviderSubmission:"pending"}:{})});},
            onReceipt:(receipt)=>{activeProviderJobId=receipt.providerJobId;activeProviderModel=receipt.model;activeProviderStatusUrl=receipt.providerStatusUrl;activeProviderResponseUrl=receipt.providerResponseUrl;activeProviderCancelUrl=receipt.providerCancelUrl;if(audioInputReceipt)audioInputReceipt={...audioInputReceipt,provider_job_id:receipt.providerJobId,queue:{status_url:receipt.providerStatusUrl,response_url:receipt.providerResponseUrl,cancel_url:receipt.providerCancelUrl}};body.audioInputReceipt=audioInputReceipt??undefined;return execution?.progress("queued",`${selected.contract.label} accepted the audio request. Its original request can safely resume if this page closes.`,{...progressCheckpoint(),...receipt,providerModel:receipt.model,audioProviderSubmission:"confirmed"});},
          });
          providerJobId=audio.providerJobId;activeProviderJobId=audio.providerJobId;activeProviderModel=audio.model;activeProviderStatusUrl=audio.providerStatusUrl;activeProviderResponseUrl=audio.providerResponseUrl;activeProviderCancelUrl=audio.providerCancelUrl;provider=audio.provider;modelId=audio.model;renderLatencyMs=audio.latencyMs;audioCostMicrousd=Math.max(0,audio.costMicrousd-prepaidProviderCostMicrousd);generatedLyrics=audio.lyrics;audioInputReceipt={...audioInputReceipt,provider:audio.provider,model:audio.model,provider_job_id:audio.providerJobId,submitted_prompt:audio.submittedPrompt,parameters:audio.preparedReceipt.parameters,image_reference:audio.preparedReceipt.imageReference,...(audio.preparedReceipt.videoReference?{video_reference:audio.preparedReceipt.videoReference}:{}),source_audio_treatment:audio.preparedReceipt.sourceAudioTreatment,audio_waveform_submitted:false,source_audio_block_ids:sourceAudioBlockIds,queue:{status_url:audio.providerStatusUrl,response_url:audio.providerResponseUrl,cancel_url:audio.providerCancelUrl}};
          if(nativeAudio){
            const calls=providerSubmissions(body as Record<string,unknown>);verifyOutputAudioCalls(calls,nativeAudio);
            for(const call of calls.filter(call=>call.operation==="planning")){
              const raw=await execution!.output!.readAudioEnvelope!(call.responseRef!);const envelope=JSON.parse(raw) as Record<string,unknown>,captured=envelope.call as Record<string,unknown>;
              if(envelope.job_id!==presentationIdentity.jobId||envelope.document_id!==documentId||envelope.stream_id!==streamId||JSON.stringify(envelope.output_audio)!==JSON.stringify(nativeAudio)||captured.clientRequestId!==call.clientRequestId||captured.providerRequestId!==call.providerRequestId||typeof envelope.raw_envelope!=="string"||typeof envelope.output_text!=="string"||await outputAudioHash(envelope.output_text)!==envelope.content_sha256)throw new Error("output_audio_envelope_unavailable");
            }
            await execution!.output!.beforeSourceTransmission();
          }
          const media=await storeGeneratedMedia(env,storageOwnerId,artifactId,audio.bytes,audio.model,audio.mimeType,{artifactRole:"document-audio",artifactId,providerJobId,provider:"fal",...(selected.contract.watermark==="synthid"?{watermark:"SynthID-provider-disclosed"}:{})});mediaUrl=media.url;mediaType=media.mimeType;generatedMediaHash=media.contentHash;generatedAudioTiming=audioDurationMetadata(media,requestedAudioProfile?.durationSeconds);
        }
        await execution?.beginCommit();
        const evidence=productionPlan?collectProductionEvidence(productionPlan,{artifactId,draft:plan,sourceContract:presentationSourceContract,sceneReceipts:Array.isArray(productionRenderReceipt?.scenes)?productionRenderReceipt.scenes as ProductionSceneReceipt[]:[],...(artifactKind==="audio"?{audioReceipt:{providerJobId,mediaUrl:mediaUrl??undefined,mediaType:mediaType??undefined}}:{}),assemblyComposed:productionRenderReceipt?.assembly&&typeof productionRenderReceipt.assembly==="object"?(productionRenderReceipt.assembly as Record<string,unknown>).composed===true:false}):null;
        const evidenceScore=evidence?scoreProductionEvidence(evidence):null;
        const productionWorkUnits=productionPlan?productionUnitsForPlan(productionPlan,artifactKind==="audio"?{audioEstimatedCostMicrousd:requestedAudioSelection?.estimatedCostMicrousd}:{}):null;
        const planningReceipt=plannerInput as Record<string,unknown>;
        const presentationLabels=artifactKind==="slides"?presentationProviderLabels(body as Record<string,unknown>,true):null;
        const planningValidation=planningReceipt.validation&&typeof planningReceipt.validation==="object"?planningReceipt.validation as Record<string,unknown>:null;
        const reconciliationEvidence=generationReconciliationEventFields(planningReceipt.adapter_reconciliation??planningValidation?.adapter_reconciliation);
        const inputReceipt={schema_version:1,artifact_id:artifactId,artifact_kind:artifactKind,document_id:projection.documentId,project_id:projection.projectId,captured_at:new Date().toISOString(),request:{item_count:itemCount,...presentationReceipt,...workflowLineage,...sceneReceipt,...(sceneContextContinuity?{scene_context_continuity:sceneContextContinuity}:{}),audience:audience||"general",tone:tone||"document-derived",source_surface:body.sourceSurface??"document",production_mode:productionMode,video_seconds:artifactKind==="video"?(productionPlan?.totalDurationSeconds??requestedVideoSeconds):null,video_size:artifactKind==="video"?body.videoSize??"1280x720":null,...(artifactKind==="video"&&requestedVideoResolution!==undefined?{video_resolution:requestedVideoResolution}:{}),video_audio_mode:artifactKind==="video"?requestedVideoAudioMode:null,soundtrack_block_ids:soundtrackBlockIds,soundtrack_provider_transfer:body.sendSoundtrackToVideoProvider===true,audio_image_block_id:artifactKind==="audio"?body.audioImageBlockId??null:null,...(artifactKind==="audio"&&requestedAudioProfile?{audio_profile:requestedAudioProfile,audio_video_artifact_id:body.audioVideoArtifactId??null,audio_video_provider_transfer:body.sendAudioVideoToProvider===true,audio_provider_estimated_cost_microusd:requestedAudioSelection?.estimatedCostMicrousd??0}:{}),estimated_cost_microusd:estimatedCostMicrousd,reserved_cost_microusd:costReservationMicrousd},document_snapshot:compiledSnapshot,...(nativeAudio?{output_audio:nativeAudio,output_audio_execution:execution!.output!.reference,output_audio_calls:providerSubmissions(body as Record<string,unknown>),output_audio_request:(body as Record<string,unknown>).outputAudioRequest}:{}),planner:{provider:"openai",model:plannerModel,response_id:plannerResponseId,...plannerInput,...(presentationLabels??{}),...sceneReceipt,...(sceneContextContinuity?{scene_context_continuity:sceneContextContinuity}:{}),},render:productionRenderReceipt??audioInputReceipt??videoInputReceipt??(artifactKind==="storyboard"?{provider,model:modelId,items:plan.items.map((item,index)=>({sequence:index+1,title:item.title,direction:item.body,camera_direction:item.notes,frame_prompt:item.image_prompt})),...(storyboardSafeRecovery?{safe_recovery:{rejected_provider_job_id:storyboardSafeRecovery.rejectedProviderJobId,rejected_frame_cost_microusd:rejectedFrameCostMicrousd,rejected_frame_charge_status:"estimated_unconfirmed",replacement_attempt_limit:1,completed_frame_costs_reconstructed:true}}:{})}:{provider:"openai",model:plannerModel}),...(soundtrackAssets.length?{soundtrack_assets:soundtrackAssets}:{}),...(productionPlan?{production:{team:productionPlan.team,system:productionSystemFor(productionPlan.format),work_units:productionWorkUnits,plan:productionPlan,quality:scoreManagedProductionPlan(productionPlan),artifact_evidence:evidence,evidence_score:evidenceScore}}:{})};
        if(nativeStoryboard&&!execution?.output?.verifyStoryboardCompletion)throw new Error("output_storyboard_completion_unavailable");
        const storyboardCompletionReceipt=nativeStoryboard?await execution!.output!.verifyStoryboardCompletion!(artifactId,plan,renderedItems,{signal:execution?.signal,deadlineMs:execution?.output?.storyboardMediaDeadlineMs?.()??0}):null;
        if(storyboardCompletionReceipt)Object.assign(inputReceipt,{output_storyboard:storyboardCompletionReceipt});
        const videoCompletionReceipt=nativeVideo?await execution!.output!.verifyVideoCompletion(artifactId,plan,{signal:execution?.signal,deadlineMs:execution!.output!.videoMediaDeadlineMs()}):null;
        if(videoCompletionReceipt)Object.assign(inputReceipt,{output_video:videoCompletionReceipt});
        let stored:Awaited<ReturnType<typeof storePrivateContent>>,inputStored:Awaited<ReturnType<typeof storePrivateContent>>;
        if(batchPresentationBookkeeping){
          const preparationDb=env.DB;
          const personalSlides=artifactKind==="slides"&&!executionScope&&!projectBudgetScope&&storageOwnerId===ownerId&&!execution?.output;
          const prepared=personalSlides
            ?await preparePersonalSlidesPrivateContentPair(env,ownerId,JSON.stringify(plan),JSON.stringify(inputReceipt))
            :await Promise.all([preparePrivateContent(env,storageOwnerId,"document-artifact",JSON.stringify(plan)),preparePrivateContent(env,ownerId,"document-artifact-input",JSON.stringify(inputReceipt),executionScope)]);
          if(personalSlides&&env.DB!==preparationDb)throw new Error("native_structured_origin_schema_database_changed");
          // Reuse the same custody/retention predicates, but publish both local
          // artifacts together. Ignored inserts or a canceled job abort this batch.
          const statements=outputAssertionStatements(env,{sql:"EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND owner_id=? AND stream_id=? AND correlation_id=? AND status='committing' AND NOT EXISTS(SELECT 1 FROM output_operation_slots WHERE job_id=document_jobs.job_id))",bindings:[presentationIdentity.jobId,ownerId,streamId,corr]});
          for(const content of prepared)for(const [index,statement] of content.statements.entries()){
            statements.push(statement);
            if(index<content.requiredInserts)statements.push(...outputAssertionStatements(env,{sql:"changes()=1"}));
          }
          await env.DB.batch(statements);
          [stored,inputStored]=prepared;
        }else [stored,inputStored]=await Promise.all([storePrivateContent(env,storageOwnerId,"document-artifact",JSON.stringify(plan)),storePrivateContent(env,ownerId,"document-artifact-input",JSON.stringify(inputReceipt),executionScope)]);
        if(sceneCompletionReceipt)sceneCompletionReceipt={...sceneCompletionReceipt,
          scene_content_sha256:await sceneContentSha256(JSON.stringify(plan)),scene_input_sha256:await sceneContentSha256(JSON.stringify(inputReceipt))};
        const storyboardBodyHashes=storyboardCompletionReceipt?{storyboard_content_sha256:await sceneContentSha256(JSON.stringify(plan)),
          storyboard_input_sha256:await sceneContentSha256(JSON.stringify(inputReceipt))}:null;
        const videoBodyHashes=videoCompletionReceipt?{video_content_sha256:await sceneContentSha256(JSON.stringify(plan)),video_input_sha256:await sceneContentSha256(JSON.stringify(inputReceipt))}:null;
        const providerCosts=providerCostReceipt(costParts,presentationLabels);
        const actualCostMicrousd=providerCosts.cost_microusd+videoCostMicrousd+audioCostMicrousd;
        if(execution?.output){const settled=await settleOperationOutputBudgets({reservationId,costReservationId,usedTokens:totalTokens,usedMicrousd:actualCostMicrousd,reason:`document_${artifactKind}_completed`});if(nativeAudio&&(!settled.receipt||settled.receipt.used_microusd!==actualCostMicrousd))throw new Error("output_audio_accounting_unavailable");}else if(artifactKind==="slides"&&!projectBudgetScope&&!executionScope&&execution?.settlePersonalPresentation)await execution.settlePersonalPresentation({reservationId,costReservationId,usedTokens:totalTokens,usedMicrousd:actualCostMicrousd});else await Promise.all([settleBudget(env,billingOwnerId,reservationId,totalTokens,`document_${artifactKind}_completed`),settleCostBudget(env,billingOwnerId,costReservationId,actualCostMicrousd)]);
        costReservationSettled=true;
        const next=artifactKind==="slides"?0:await streamHead(env,streamId);
        const itemReceipts=plan.items.map((item,index)=>{const rendered=renderedItems[index]??{};return{id:String(rendered.id??`${artifactId}-item-${index+1}`),title:item.title,slide:item.slide??null,context_group_ids:item.context_group_ids??[],media_url:rendered.media_url??null,media_type:rendered.media_type??null,width:rendered.width??null,height:rendered.height??null,...(productionPlan?{scene_id:rendered.scene_id??productionPlan.scenes[index]?.id??null,narrative_order:index+1,generation_order:rendered.generation_order??productionPlan.executionOrder.indexOf(productionPlan.scenes[index]?.id??"")+1,duration_seconds:artifactKind==="video"?productionPlan.scenes[index]?.durationSeconds??null:null}:{})};});
        const publicAudioProfile=requestedAudioProfile?{goal:requestedAudioProfile.goal,role:requestedAudioProfile.role,destination:requestedAudioProfile.destination,...(requestedAudioProfile.durationSeconds?{duration_seconds:requestedAudioProfile.durationSeconds}:{}),...(requestedAudioProfile.speakerCount?{speaker_count:requestedAudioProfile.speakerCount}:{}),...(requestedAudioProfile.requireInstrumental?{prefer_instrumental:true}:{})}:null;
        const retainedAnchor=productionRenderReceipt?.anchor&&typeof productionRenderReceipt.anchor==="object"?productionRenderReceipt.anchor as Record<string,unknown>:null;const productionAssets=retainedAnchor&&typeof retainedAnchor.mediaUrl==="string"&&retainedAnchor.mediaUrl.startsWith("/api/media/")?[{role:"production-continuity-anchor",media_url:retainedAnchor.mediaUrl,media_type:String(retainedAnchor.mediaType??"image/jpeg"),rights_class:"account-generated",scene_id:String(retainedAnchor.sceneId??"")}]:[];
        const completed=makeEvent(streamId,next+1,"worker:renderer",client,corr,"DocumentRenderCompleted",{artifact_id:artifactId,artifact_kind:artifactKind,...reconciliationEvidence,document_id:projection.documentId,project_id:projection.projectId,...workflowLineage,...sceneReceipt,source_block_versions:sourceBlockVersions,requested_by_user_id:executionScope?.actorUserId??ownerId,title:plan.title,summary:plan.summary,content_ref:stored.contentId,content_expires_at:stored.expiresAt,input_ref:inputStored.contentId,input_expires_at:inputStored.expiresAt,item_count:plan.items.length,items:itemReceipts,presentation:plan.presentation??null,media_url:mediaUrl,media_type:mediaType,provider,provider_job_id:providerJobId||null,model_id:modelId,planner_model_id:presentationLabels?presentationLabels.model:plannerModel,...(presentationLabels?{planner_model_ids:presentationLabels.model_ids}:{}),planner_response_id:plannerResponseId,reference_inputs:videoInputReceipt?.reference_inputs??[...(audioInputReceipt?.image_reference?[audioInputReceipt.image_reference]:[]),...(audioInputReceipt?.video_reference?[audioInputReceipt.video_reference]:[])],used_reference_pixels:videoInputReceipt?.used_reference_pixels===true||Boolean(audioInputReceipt?.image_reference)||Boolean(audioInputReceipt?.video_reference),...(productionAssets.length?{production_assets:productionAssets}:{}),latency_ms:plannerLatencyMs+renderLatencyMs,settings:{item_count:itemCount,...(videoBodyHashes??{}),...(videoCompletionReceipt?{output_video:videoCompletionReceipt,source_media_sha256:generatedMediaHash}:{}),...(storyboardBodyHashes??{}),...(storyboardCompletionReceipt?{output_storyboard:storyboardCompletionReceipt}:{}),...presentationReceipt,...sceneReceipt,...(narrativeReceipt??{}),...(sceneCompletionReceipt??{}),...(nativeAudio?{output_audio:nativeAudio,output_audio_execution:execution!.output!.reference,output_audio_receipt:verifyOutputAudioCalls(providerSubmissions(body as Record<string,unknown>),nativeAudio)}:{}),...(body.workflowId?{production_workflow:{id:body.workflowId,stage_id:body.workflowStageId,sources:body.workflowSources??[]}}:{}),reserved_cost_microusd:costReservationMicrousd,settled_cost_microusd:actualCostMicrousd,audience:audience||"general",tone:tone||"document-derived",production_mode:productionMode,production_team:productionPlan?.team??null,production_system:productionPlan?productionSystemFor(productionPlan.format):null,production_quality:productionPlan?scoreManagedProductionPlan(productionPlan):null,production_evidence:evidence&&evidenceScore?{basis:evidence.basis,score:evidenceScore.score,measured_weight:evidenceScore.measuredWeight,fully_evaluated:evidenceScore.fullyEvaluated,media_inspected:false}:null,assembly:productionRenderReceipt?.assembly??null,video_seconds:artifactKind==="video"?(productionPlan?.totalDurationSeconds??requestedVideoSeconds):null,video_size:artifactKind==="video"?body.videoSize??"1280x720":null,...(artifactKind==="video"&&requestedVideoResolution!==undefined?{video_resolution:requestedVideoResolution}:{}),video_audio_mode:artifactKind==="video"?requestedVideoAudioMode:null,...(soundtrackAssets.length?{soundtrack_assets:soundtrackAssets}:{}),...(artifactKind==="audio"?{audio_provider_model:modelId,audio_role:requestedAudioProfile?.role??"score",audio_goal:requestedAudioProfile?.goal??"music",audio_destination:requestedAudioProfile?.destination??"standalone",audio_profile:publicAudioProfile,audio_synthid_watermarked:requestedAudioSelection?.contract.watermark==="synthid",audio_watermark_basis:requestedAudioSelection?.contract.watermark==="synthid"?"provider-disclosed":null,source_media_sha256:generatedMediaHash,...generatedAudioTiming,lyrics:generatedLyrics,audio_cues:audioContexts(compiledSnapshot,"inform").flatMap((context)=>context.cues)}:{})},source_surface:body.sourceSurface??"document"},{causationId:requestEvent.eventId});
        const usage=makeEvent(streamId,next+2,"worker:policy",client,corr,"GenerationUsageRecorded",{operation:`document-render:${artifactKind}`,artifact_id:artifactId,artifact_kind:artifactKind,document_id:projection.documentId,reservation_id:reservationId,cost_reservation_id:costReservationId,input_tokens:billablePlannerUsage.inputTokens,output_tokens:billablePlannerUsage.outputTokens,total_tokens:totalTokens,planner_tokens:billablePlannerUsage.totalTokens,reserved_tokens:reserved,reserved_microusd:costReservationMicrousd,budget_period:costReservationPeriod,model_ids:[plannerModel,modelId],planner_response_id:plannerResponseId||null,planner_usage_previously_recorded:recordedPlanner.tokensRecorded,planner_cost_previously_recorded:recordedPlanner.costRecorded,provider_job_id:providerJobId||null,production_mode:productionMode,...providerCosts,planner_cost_microusd:plannerCost.totalMicrousd,...(storyboardSafeRecovery?{rejected_frame_cost_microusd:rejectedFrameCostMicrousd,rejected_frame_charge_status:"estimated_unconfirmed",rejected_frame_cost_precision:"conservative-published-rate",rejected_provider_job_id:storyboardSafeRecovery.rejectedProviderJobId}:{}) ,...(artifactKind==="video"?{cost_microusd:actualCostMicrousd,video_cost_microusd:videoCostMicrousd,cost_precision:"provider-token-and-published-video-rate",video_seconds:productionPlan?.totalDurationSeconds??requestedVideoSeconds,scene_count:productionPlan?.scenes.length??1}:artifactKind==="audio"?{cost_microusd:actualCostMicrousd,audio_cost_microusd:audioCostMicrousd,cost_precision:"provider-token-and-published-audio-rate"}:{})},{causationId:completed.eventId});
        await appendOperationEvents(env,[completed,usage]);if(!execution?.output&&artifactKind!=="video"&&artifactKind!=="audio")await observeProviderSuccess(env);return Response.json({appended:[requestEvent,...(budgeted?[budgeted]:[]),completed,usage],content:{[stored.contentId]:JSON.stringify(plan),[inputStored.contentId]:JSON.stringify(inputReceipt)},artifactId,artifactKind,providerJobId:providerJobId||undefined,provider,head:usage.sequence});
      }catch(error){
        if(execution?.signal.aborted||error instanceof Error&&error.message==="document_job_canceled")throw error;
        if(execution?.output?.dispatchStop(error))throw error;
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
          const presentationStillPending=hasUnresolvedProviderSubmission(body as Record<string,unknown>)||(body as Record<string,unknown>).presentationProviderSubmission==="pending";
          await execution?.progress("planning",`${paidResponseIds.length||error.providerCallCount} paid provider response${(paidResponseIds.length||error.providerCallCount)===1?"":"s"} recorded before generation failed.`,{plannerModel,plannerResponseId,plannerResponseIds:paidResponseIds,plannerUsage,plannerInput,reservationId,costReservationId,costReservationPeriod,costReservationMicrousd,...(productionPlan?{productionPlan}:{}),...(artifactKind==="slides"?{presentationProviderSubmission:presentationStillPending?"pending":"confirmed"}:{})});
        }
        let detail=classifyProviderFailure(error);
        if(artifactKind==="slides"&&presentationSubmissionPending&&!hasUnresolvedProviderSubmission(body as Record<string,unknown>)&&detail.scope==="provider"&&definitiveProviderRejection(Number(detail.httpStatus))){await execution?.progress("planning","The presentation provider returned a confirmed rejection.",{reservationId,costReservationId,costReservationPeriod,costReservationMicrousd,presentationProviderSubmission:"confirmed"});presentationSubmissionPending=false;}
        const audioSubmission=artifactKind==="audio"?audioProviderSubmissionState({attempted:videoSubmissionAttempted,providerJobId:activeProviderJobId,httpStatus:detail.httpStatus}):null;
        if(audioSubmission==="rejected")await execution?.progress("planning",`${requestedAudioSelection?.contract.label??"The audio provider"} returned a confirmed rejection before accepting a paid audio request.`,{reservationId,costReservationId,costReservationPeriod,costReservationMicrousd,audioProviderSubmission:"rejected",providerJobId:""});
        const storyboardSubmission=artifactKind==="storyboard"&&!productionPlan&&storyboardProviderSubmission!=="cleared"?audioProviderSubmissionState({attempted:storyboardSubmissionAttempted,providerJobId:activeProviderJobId,httpStatus:detail.httpStatus}):null;
        if(storyboardSubmission==="rejected"){storyboardProviderSubmission="rejected";storyboardSubmissionAttempted=false;await execution?.progress("planning","Ideogram returned a confirmed rejection before accepting a paid storyboard frame.",{reservationId,costReservationId,costReservationPeriod,costReservationMicrousd,storyboardProviderSubmission:"rejected",providerJobId:""});}
        if(storyboardSubmission==="unknown")detail={...detail,code:"provider_submission_uncertain",category:"network",scope:"network",action:"contact_support",message:"We couldn’t confirm the original request. We haven’t sent it again, to avoid a duplicate charge.",retryable:false,retryAfterMs:null,requestId:null,httpStatus:null};
        else if(storyboardSubmission==="confirmed"&&activeProviderJobId&&!detail.requestId)detail={...detail,requestId:activeProviderJobId};
        if(hasUnresolvedProviderSubmission(body as Record<string,unknown>))detail={...detail,code:"provider_submission_uncertain",category:"network",scope:"network",action:"contact_support",message:"We couldn’t confirm the original request. We haven’t sent it again, to avoid a duplicate charge. The original reservation is held.",retryable:false,retryAfterMs:null};
        const failedReconciliationEvidence=generationFailureReconciliationEventFields(artifactKind,detail.validationIssues,{adapterId:"openai-document",...(artifactKind==="slides"?{adapterVersion:PRESENTATION_ADAPTER_VERSION}:{})});
        await execution?.beginCommit();if(artifactKind!=="video"&&artifactKind!=="audio")await observeProviderFailure(env,detail);const retainedPrompt=await retainFailurePrompt(env,ownerId,error,executionScope);
        if(hasUnsettledProviderSubmission(body as Record<string,unknown>)||artifactKind==="slides"&&presentationSubmissionPending||artifactKind==="audio"&&audioSubmission==="unknown"||artifactKind==="storyboard"&&(storyboardSubmission==="unknown"||storyboardSubmission==="confirmed")){
          const next=await streamHead(env,streamId);const failed=makeEvent(streamId,next+1,"worker:renderer",client,corr,"DocumentRenderFailed",{artifact_id:artifactId,artifact_kind:artifactKind,...failedReconciliationEvidence,document_id:projection.documentId,provider_job_id:activeProviderJobId||null,provider_charge_status:"unconfirmed",prompt_ref:retainedPrompt?.ref??null,prompt_expires_at:retainedPrompt?.expiresAt??null,source_surface:body.sourceSurface??"document",...failureEventFields(detail)},{causationId:requestEvent.eventId});
          await appendOperationEvents(env,[failed]);
          return Response.json({error:detail.code,errorDetail:publicFailureDetail(detail),moderationPromptRef:retainedPrompt?.ref??null,appended:[requestEvent,...(budgeted?[budgeted]:[]),failed],content:retainedPrompt?{[retainedPrompt.ref]:retainedPrompt.prompt}:undefined,artifactId,artifactKind,...(activeProviderJobId?{providerJobId:activeProviderJobId}:{}),head:failed.sequence},{status:502});
        }
        const fullPlannerCost=nativeAudio?outputAudioPlannerCost(body as Record<string,unknown>):nativeScene?outputScenePlannerCost(body as Record<string,unknown>,nativeScene):nativeNarrative&&providerSubmissions(body as Record<string,unknown>).some(call=>call.operation==="planning"&&call.status==="completed")?outputNarrativePlannerCost(body as Record<string,unknown>,nativeNarrative):artifactKind==="slides"?frozenPresentationPlannerCost(body as Record<string,unknown>)??priceTextUsageBreakdownMicrousd(plannerModel,plannerUsage):priceTextUsageBreakdownMicrousd(plannerModel,plannerUsage);const expectedPlannerCost=fullPlannerCost.totalMicrousd;const recordedPlanner=recordedDocumentPlannerUsage(sourceEvents,plannerResponseId,expectedPlannerCost);const failedPlannerCost=nativeAudio?outputAudioPlannerCost(body as Record<string,unknown>,recordedPlanner.recordedCostMicrousd):nativeScene?outputScenePlannerCost(body as Record<string,unknown>,nativeScene,recordedPlanner.recordedCostMicrousd):nativeNarrative&&providerSubmissions(body as Record<string,unknown>).some(call=>call.operation==="planning"&&call.status==="completed")?outputNarrativePlannerCost(body as Record<string,unknown>,nativeNarrative,recordedPlanner.recordedCostMicrousd):artifactKind==="slides"?frozenPresentationPlannerCost(body as Record<string,unknown>,recordedPlanner.recordedCostMicrousd)??remainingDocumentPlannerCost(plannerModel,plannerUsage,recordedPlanner.recordedCostMicrousd):remainingDocumentPlannerCost(plannerModel,plannerUsage,recordedPlanner.recordedCostMicrousd);const frameReceipts=Object.values(body.productionFrameReceipts??{});const paidMediaSubmissionUnconfirmed=artifactKind==="video"&&videoSubmissionAttempted||artifactKind==="storyboard"&&storyboardSubmissionAttempted&&detail.httpStatus===null;const failedUsage=interruptedDocumentJobUsage({...body,plannerModel,plannerResponseId,plannerUsage,...(activeProviderJobId||paidMediaSubmissionUnconfirmed?{providerJobId:activeProviderJobId||"submitted"}:{})},{artifactKind,videoSeconds:requestedVideoSeconds},{plannerTokensAlreadyRecorded:recordedPlanner.tokensRecorded,plannerCostAlreadyRecordedMicrousd:recordedPlanner.recordedCostMicrousd});const failedBillableTokens=failedUsage.totalTokens;
        const productionReceipts=Object.values(body.productionSceneReceipts??{});const failedActualCost=failedUsage.totalCostMicrousd;
        if(execution?.output){await settleOperationOutputBudgets({reservationId,costReservationId,reason:`document_${artifactKind}_failed_after_planning`});costReservationSettled=true;}
        else{if(failedBillableTokens>0)await settleBudget(env,billingOwnerId,reservationId,failedBillableTokens,`document_${artifactKind}_failed_after_planning`);else await releaseBudget(env,billingOwnerId,reservationId,{reason:`document_${artifactKind}_failed`});
          if(!costReservationSettled){if(failedActualCost>0)await settleCostBudget(env,billingOwnerId,costReservationId,failedActualCost);else await releaseCostBudget(env,billingOwnerId,costReservationId);costReservationSettled=true;}}
        const providerChargeStatus=artifactKind!=="storyboard"&&artifactKind!=="video"&&artifactKind!=="audio"?"not_applicable":activeProviderJobId||paidMediaSubmissionUnconfirmed||productionReceipts.some((receipt)=>receipt.status==="submitted"||receipt.status==="completed")?"unconfirmed":"not_submitted";
        const next=await streamHead(env,streamId);const failed=makeEvent(streamId,next+1,"worker:renderer",client,corr,"DocumentRenderFailed",{artifact_id:artifactId,artifact_kind:artifactKind,...failedReconciliationEvidence,document_id:projection.documentId,provider_job_id:activeProviderJobId||null,provider_charge_status:providerChargeStatus,prompt_ref:retainedPrompt?.ref??null,prompt_expires_at:retainedPrompt?.expiresAt??null,source_surface:body.sourceSurface??"document",...failureEventFields(detail)},{causationId:requestEvent.eventId});
        const plannerCharge=(failedBillableTokens>0||failedActualCost>0)?makeEvent(streamId,next+2,"worker:policy",client,corr,"GenerationUsageRecorded",{operation:`document-render:${artifactKind}:failed-plan`,artifact_id:artifactId,artifact_kind:artifactKind,document_id:projection.documentId,reservation_id:reservationId,cost_reservation_id:costReservationId,input_tokens:failedUsage.inputTokens,output_tokens:failedUsage.outputTokens,total_tokens:failedBillableTokens,planner_tokens:failedUsage.plannerUsage.totalTokens,reserved_tokens:reserved,model_ids:[...new Set([plannerModel,...frameReceipts.map((receipt)=>receipt.providerModel)])],planner_response_id:plannerResponseId||null,provider_job_id:activeProviderJobId||null,provider_charge_status:providerChargeStatus,...providerCostReceipt([failedPlannerCost],artifactKind==="slides"?presentationProviderLabels(body as Record<string,unknown>,true):null),cost_microusd:failedActualCost,planner_cost_microusd:Math.min(failedActualCost,failedUsage.plannerCostMicrousd),completed_frame_count:frameReceipts.length},{causationId:failed.eventId}):null;
        const released=makeEvent(streamId,next+(plannerCharge?3:2),"worker:policy",client,corr,"BudgetReleased",{artifact_id:artifactId,artifact_kind:artifactKind,reservation_id:reservationId,reserved_tokens:reserved,used_tokens:failedBillableTokens,released_tokens:Math.max(0,reserved-failedBillableTokens),reason:`document_${artifactKind}_failed`,operation:`document-render:${artifactKind}`,...(scenePolicyStop?{scene_policy_stop:{...(scenePolicyStop as ScenePolicyStopWitness),used_tokens:failedBillableTokens,used_microusd:failedActualCost}}:{})},{causationId:plannerCharge?.eventId??failed.eventId});const failureEvents=[failed,...(plannerCharge?[plannerCharge]:[]),released];await appendOperationEvents(env,failureEvents);return Response.json({error:detail.code,errorDetail:publicFailureDetail(detail),moderationPromptRef:retainedPrompt?.ref??null,appended:[requestEvent,...(budgeted?[budgeted]:[]),...failureEvents],content:retainedPrompt?{[retainedPrompt.ref]:retainedPrompt.prompt}:undefined,artifactId,artifactKind,providerJobId:activeProviderJobId||undefined,head:released.sequence},{status:artifactKind==="scene"&&detail.code==="scene_paid_authority_changed"&&detail.httpStatus===403?403:detail.httpStatus===429?429:502});}
    }
    if(body.action==="preview"){
      if(!env.OPENAI_API_KEY)return Response.json({error:"provider_not_configured"},{status:503});
      const promptTechnique=normalizePromptTechnique(body.promptTechnique);const promptFanId=body.promptFanId?String(body.promptFanId):null;
      const sourceEvents=await readEvents(env,streamId);const projection=foldEvents(sourceEvents,Number.POSITIVE_INFINITY,body.documentId);const constraints=standingConstraints(sourceEvents).map(item=>({preference_id:item.preferenceId,axis:item.axis,value:item.value,polarity:item.polarity,authority:"authored",source_event_refs:item.evidenceRefs,source_claim_ref:item.sourceClaimRef??null}));const uploadedReferences=await uploadedPixelReferences(env,storageOwnerId,projection,sourceEvents,body.snapshot,executionScope);const referenceInputs=referenceInputReceipts(uploadedReferences);const suppliedSnapshot=body.snapshot&&Object.keys(body.snapshot).length?body.snapshot:snapshotForProjection(projection);const managedImage=body.productionMode==="managed"?buildManagedProductionPlan("image",{...suppliedSnapshot,standing_constraints:constraints}):null;const productionFields=managedImageEventFields(managedImage);const compiledSnapshot={...suppliedSnapshot,document:{id:projection.documentId,title:projection.documentTitle},standing_constraints:constraints,reference_inputs:referenceInputs,...(managedImage?{production_brief:managedImageBrief(managedImage)}:{})};const selectedImageFormat=documentImageFormat(compiledSnapshot);const previewRender=providerRenderFormat(selectedImageFormat.format,"preview");const imageFormatFields=imageFormatEventFields(selectedImageFormat.format,"preview",selectedImageFormat.blockId);const contextHash=await creativeContextHash(compiledSnapshot);
      const reserved=24_000;const reservation=await reserveBudget(env,billingOwnerId,reserved,{streamId,correlationId:corr,operation:"image-preview",projectScope:projectBudgetScope});if(!reservation.ok){const denied=makeEvent(streamId,current+1,"worker:policy",client,corr,"BudgetExceeded",{reason:"hard_cap_reached",scope:reservation.scope,reserved_tokens:0,operation:"image-preview"});await insertEvent(env,denied).run();const detail=applicationFailureDetail("budget_hard_cap_reached",reservation.scope,429);return Response.json({error:detail.code,errorDetail:publicFailureDetail(detail),scope:reservation.scope},{status:429});}
      const imageCostReservation=await reserveCostBudget(env,billingOwnerId,1_000_000,{maximumMicrousd:1_000_000,allowUserOverage:false,streamId,correlationId:corr,operation:"image-preview",period:reservation.period,projectScope:projectBudgetScope});if(!imageCostReservation.ok){await releaseBudget(env,billingOwnerId,reservation.reservationId,{reason:"image_preview_cost_cap_reached"});const detail=applicationFailureDetail("budget_hard_cap_reached",imageCostReservation.scope,429);return Response.json({error:detail.code,errorDetail:publicFailureDetail(detail),scope:imageCostReservation.scope},{status:429});}
      const imageSelection=selectImageAdapter(env,{quality:"low",size:previewRender.size,outputFormat:"jpeg",references:uploadedReferences,partialImages:1});const id=uuidV7();const objectId=`draft-${id.slice(-8)}`;const plannerModel=body.directionModel??env.OPENAI_MODEL??"gpt-5.6-terra";const imageModel=imageSelection.model;const adapterVersion=`${imageSelection.adapterId}-${imageSelection.adapterVersion}`;let sequence=current;const registryEvents:EventRow[]=[];
      if(!sourceEvents.some(event=>event.type==="ModelRegistered"&&event.payload.model_id===imageModel))registryEvents.push(makeEvent(streamId,++sequence,"worker:registry",client,corr,"ModelRegistered",{model_id:imageModel,planner_model_id:plannerModel,provider:imageSelection.providerName,status:"human-gated"}));
      if(!sourceEvents.some(event=>event.type==="AdapterVersioned"&&event.payload.adapter_id===imageSelection.adapterId&&event.payload.version===imageSelection.adapterVersion))registryEvents.push(makeEvent(streamId,++sequence,"worker:registry",client,corr,"AdapterVersioned",{adapter_id:imageSelection.adapterId,version:imageSelection.adapterVersion,contract_version:7,selection_reason:imageSelection.reason,reference_handoff:imageSelection.capabilities.includes("reference-pixel-input"),multiple_image_input:imageSelection.capabilities.includes("multiple-image-input"),block_level_reference_policy:true,block_level_image_format:true,streaming_previews:imageSelection.capabilities.includes("streaming-previews"),custom_preview_size:true,compressed_preview_output:true}));
      if(!sourceEvents.some(event=>event.type==="CapabilityDeclared"&&event.payload.model_id===imageModel&&Array.isArray(event.payload.capabilities)&&(event.payload.capabilities as unknown[]).includes("block-level-image-format")))registryEvents.push(makeEvent(streamId,++sequence,"worker:registry",client,corr,"CapabilityDeclared",{model_id:imageModel,capabilities:imageSelection.capabilities}));
      const requestedAt=makeEvent(streamId,++sequence,userActor,client,corr,"GenerationRequested",{generation_id:id,stream_id:streamId,model_ids:[plannerModel,imageModel],document_id:projection.documentId,canvas_id:body.canvasId??null,context_set_id:body.contextSetId??null,document_version:current,requested_output:"image",quality:"low",purpose:"ideate",...imageFormatFields,...productionFields,output_format:"jpeg",output_compression:70,partial_images:1,source_surface:body.sourceSurface??"studio",source_chat_turn_id:body.sourceChatTurnId??null,prompt_technique:promptTechnique,prompt_fan_id:promptFanId,preflight_id:body.preflightId??null,preflight_version:body.preflightVersion??null,preflight_risk_acknowledged:Boolean(body.preflightAcknowledged),reference_input_count:referenceInputs.length,reference_inputs:referenceInputs,used_uploaded_reference_pixels:referenceInputs.length>0});
      const compiled=makeEvent(streamId,++sequence,"worker:compiler",client,corr,"ContextCompiled",{generation_id:id,document_id:projection.documentId,project_id:projection.projectId,canvas_id:body.canvasId??null,context_set_id:body.contextSetId??null,model_id:imageModel,planner_model_id:plannerModel,provider:imageSelection.providerName,adapter_version:adapterVersion,adapter_selection_reason:imageSelection.reason,...imageFormatFields,...productionFields,compiled_snapshot:compiledSnapshot,context_hash:contextHash,source_block_versions:body.sourceBlockVersions??[],quality:"low",purpose:"ideate",source_surface:body.sourceSurface??"studio",source_chat_turn_id:body.sourceChatTurnId??null,prompt_technique:promptTechnique,prompt_fan_id:promptFanId,reference_input_count:referenceInputs.length,reference_inputs:referenceInputs,used_uploaded_reference_pixels:referenceInputs.length>0},{causationId:requestedAt.eventId});
      const budgeted=makeEvent(streamId,++sequence,"worker:policy",client,corr,"BudgetReserved",{generation_id:id,reservation_id:reservation.reservationId,cost_reservation_id:imageCostReservation.reservationId,reserved_tokens:reserved,reserved_microusd:imageCostReservation.reservedMicrousd,period:imageCostReservation.period,operation:"image-preview"},{causationId:requestedAt.eventId});
      await appendOperationEvents(env,[...registryEvents,requestedAt,compiled,budgeted]);
      const observePaid=paidProviderObserver(body as Record<string,unknown>,execution?.progress,{reservationId:reservation.reservationId,costReservationId:imageCostReservation.reservationId,costReservationPeriod:imageCostReservation.period,costReservationMicrousd:imageCostReservation.reservedMicrousd},execution?.output?.observeProvider);
      try{
        const privateContent=await loadPrivateContent(env,ownerId,"all",executionScope);let planningSource:"chat"|"cache"|"provider"="provider";let planned:Awaited<ReturnType<typeof generateCreativeDirection>>|null=null;
        if(body.directionRef){const raw=privateContent[body.directionRef];if(raw){try{planned={responseId:"",model:plannerModel,output:JSON.parse(raw) as Record<string,unknown>,raw,latencyMs:0,usage:{inputTokens:0,outputTokens:0,totalTokens:0}};planningSource="chat";}catch{/* Fall through to the normal planner when retained direction data is invalid. */}}}
        if(!planned){const cachedEvent=[...sourceEvents].reverse().find((event)=>event.type==="IdeationPreviewCompleted"&&event.payload.context_hash===contextHash&&String(event.payload.locale??"en").toLowerCase()===String(body.locale??"en").toLowerCase()&&event.payload.planning_source!=="chat"&&event.payload.output_ref);const cachedRaw=cachedEvent?privateContent[String(cachedEvent.payload.output_ref??"")]:undefined;if(cachedRaw){try{planned={responseId:String(cachedEvent?.payload.planner_response_id??""),model:String(cachedEvent?.payload.planner_model_id??plannerModel),output:JSON.parse(cachedRaw) as Record<string,unknown>,raw:cachedRaw,latencyMs:0,usage:{inputTokens:0,outputTokens:0,totalTokens:0}};planningSource="cache";}catch{/* Expired or malformed cached plans are regenerated. */}}}
        if(!await claimCostBudgetReservation(env,billingOwnerId,imageCostReservation.reservationId))return refuseProviderClaim({operation:"image-preview",tokenReservationId:reservation.reservationId,costReservationId:imageCostReservation.reservationId,reservedTokens:reserved,reservedMicrousd:imageCostReservation.reservedMicrousd,causationId:budgeted.eventId});
        if(!planned){await execution?.progress("planning","Turning the document context into a concrete visual direction.");planned=await generateCreativeDirection(env,ownerId,compiledSnapshot,execution?.signal,body.locale,observePaid);}
        else await execution?.progress("planning","Reusing a compatible visual direction from the current document state.");
        const image=await generateCreativeImage(env,ownerId,compiledSnapshot,planned.output,{safetyAcknowledgement:execution?.safetyAcknowledgement,quality:"low",size:previewRender.size,outputFormat:"jpeg",outputCompression:70,references:uploadedReferences,promptTechnique,partialImages:1,signal:execution?.signal,onProviderSubmission:observePaid,onStage:execution?.progress,onPartial:async(partial)=>{if(execution?.signal.aborted)throw new Error("document_job_canceled");const partialMedia=await storeGeneratedImage(env,storageOwnerId,id,partial.bytes,imageModel,partial.mimeType,{provider:imageSelection.providerName,adapter:adapterVersion});await execution?.progress("rendering","A draft image has arrived; the final draft is still rendering.",{partialMediaUrl:`${partialMedia.url}?partial=${partial.index}`,partialMediaType:partialMedia.mimeType,partialWidth:partial.width,partialHeight:partial.height,partialIndex:partial.index,generationId:id,objectId,quality:"low",promptTechnique,promptFanId});}});await execution?.beginCommit();const media=await storeGeneratedImage(env,storageOwnerId,id,image.bytes,image.model,image.mimeType,{provider:image.provider,adapter:`${image.adapterId}-${image.adapterVersion}`,providerRequestId:image.providerRequestId??""});const stored=planningSource==="chat"&&body.directionRef?{contentId:body.directionRef,expiresAt:null}:await storePrivateContent(env,ownerId,"provider-output",planned.raw,executionScope);const promptStored=await storePrivateContent(env,ownerId,"ideation-prompt",image.prompt,executionScope);const totalTokens=planned.usage.totalTokens+image.usage.totalTokens;await settleBudget(env,billingOwnerId,reservation.reservationId,totalTokens);
        const next=await streamHead(env,streamId);const complete=makeEvent(streamId,next+1,"worker:generator",client,corr,"IdeationPreviewCompleted",{generation_id:id,document_id:projection.documentId,canvas_id:body.canvasId??null,context_set_id:body.contextSetId??null,model_id:image.model,planner_model_id:planned.model,provider:image.provider,provider_request_id:image.providerRequestId,provider_submission_id:image.providerSubmissionId,planner_response_id:planned.responseId,object_id:objectId,object_ids:[objectId],title:String(planned.output.title??projection.documentTitle).trim(),output_ref:stored.contentId,prompt_ref:promptStored.contentId,prompt_technique:promptTechnique,prompt_fan_id:promptFanId,media_url:media.url,media_type:media.mimeType,source_content_hash:media.contentHash,image_width:image.width,image_height:image.height,quality:"low",purpose:"ideate",...imageFormatFields,...productionFields,output_format:image.outputFormat,output_compression:image.outputCompression,partial_images_requested:1,partial_images_received:image.partialCount,source_surface:body.sourceSurface??"studio",source_chat_turn_id:body.sourceChatTurnId??null,locale:body.locale??"en",context_hash:contextHash,planning_source:planningSource,planning_cache_hit:planningSource==="cache",reference_input_count:referenceInputs.length,reference_inputs:referenceInputs,used_uploaded_reference_pixels:referenceInputs.length>0,latency_ms:planned.latencyMs+image.latencyMs,planning_latency_ms:planned.latencyMs,image_latency_ms:image.latencyMs,adapter_version:`${image.adapterId}-${image.adapterVersion}`,simulation:false},{causationId:compiled.eventId});
        const imageCost=providerCostReceipt([priceTextUsageBreakdownMicrousd(planned.model,planned.usage),image.costBreakdown]);await settleCostBudget(env,billingOwnerId,imageCostReservation.reservationId,imageCost.cost_microusd);const usage=makeEvent(streamId,next+2,"worker:policy",client,corr,"GenerationUsageRecorded",{generation_id:id,document_id:projection.documentId,reservation_id:reservation.reservationId,cost_reservation_id:imageCostReservation.reservationId,...productionFields,input_tokens:planned.usage.inputTokens+image.usage.inputTokens,output_tokens:planned.usage.outputTokens+image.usage.outputTokens,total_tokens:totalTokens,planner_tokens:planned.usage.totalTokens,image_tokens:image.usage.totalTokens,planner_input_tokens:planned.usage.inputTokens,planner_output_tokens:planned.usage.outputTokens,image_text_input_tokens:image.usage.textInputTokens??0,image_input_tokens:image.usage.imageInputTokens??image.usage.inputTokens,image_output_tokens:image.usage.outputTokens,reserved_tokens:reserved,reserved_microusd:imageCostReservation.reservedMicrousd,model_ids:[planned.model,image.model],operation:"image-preview",quality:"low",planning_source:planningSource,partial_images:image.partialCount,image_cost_precision:image.costPrecision,...imageCost},{causationId:complete.eventId});await appendOperationEvents(env,[complete,usage]);await observeProviderSuccess(env);return Response.json({appended:[...registryEvents,requestedAt,compiled,budgeted,complete,usage],content:{[stored.contentId]:planned.raw},rejected:[],head:usage.sequence,simulation:false,quality:"low",planningSource});
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
        await appendOperationEvents(env,[failed]);
        return Response.json({error:detail.code,errorDetail:publicFailureDetail(detail),moderationPromptRef:moderationPrompt?.ref??null,appended:[...registryEvents,requestedAt,compiled,budgeted,failed],content:moderationPrompt?{[moderationPrompt.ref]:moderationPrompt.prompt}:undefined,head:failed.sequence},{status:detail.httpStatus===429?429:502});
      }
    }
    if(body.action==="generate")return await executeNativeImageOperation({env,body,ownerId,storageOwnerId,billingOwnerId,streamId,userActor,
      executionScope,projectBudgetScope,execution,readEvents,current,client,corr,appendOperationEvents,settleOperationOutputBudgets,refuseProviderClaim,
      settleInterruptedImage:({documentId,tokenReservationId,costReservationId})=>settleInterruptedDocumentJobReservations(env,{...auth.user,streamId,userId:ownerId,billingUserId:billingOwnerId},
        {job_id:corr.replace(/:attempt:\d+$/u,""),kind:body.action,stream_id:streamId,document_id:documentId,correlation_id:corr,request_json:JSON.stringify(body),result_json:JSON.stringify(body)},
        {tokenReservationId,costReservationId,reason:"generation_failed"}),
    });
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
      if(!["generation","artifact","reference"].includes(body.targetKind))return Response.json({error:"focal_target_kind_invalid"},{status:400});
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
      // Older clients still request automatic reference crop maintenance. Return
      // the display hint without editing source properties or provenance. An
      // explicit extract_reference operation retains its existing event trail.
      if(body.targetKind==="reference")return Response.json({appended:[],rejected:[],head:current,focalPoint,cached:false});
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
    let pending=requested.map((item,index)=>({item,index,clientEventId:receiptIds[index]})).filter(({clientEventId})=>!clientEventId||!received.has(clientEventId));
    let validatedOutputOwnerHead:number|undefined;
    if(pending.some(({item})=>/^(?:Block|Chip|Output)/u.test(String(item.type??""))||item.type==="ExtractionRequested")){
      const outputBlocks=outputAuthoringBlocksFromEvents(await readWorkspaceEvents(env,streamId));
      const guarded=prepareOutputRequirementClientEvents(pending.map(({item})=>item),outputBlocks);
      if(!guarded.ok)return Response.json(guarded,{status:guarded.status});
      if(guarded.events.some((event)=>isOutputContextType(event.payload?.type)
        ||outputBlocks.some((block)=>block.id===String(event.payload?.block_id??"")&&isOutputContextType(block.type))))validatedOutputOwnerHead=current;
      pending=pending.map((entry,index)=>({...entry,item:guarded.events[index]!}));
    }
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
      const userEvents=valid.map(({item})=>makeEvent(streamId,0,userActor,client,corr,item.type!,item.payload!,{compensatesEventId:item.compensatesEventId}));if(userEvents.length)await appendEventsWithClientReceipts(env,userEvents,valid.map(({clientEventId})=>clientEventId),{retries:10,...(validatedOutputOwnerHead===undefined?{}:{expectedHead:validatedOutputOwnerHead})});
      const accepted=await readEventsByClientEventIds(env,streamId,receiptIds);const confirmed=requested.flatMap((_,index)=>{const event=accepted.get(receiptIds[index]);return event?[event]:[]}).sort((left,right)=>left.sequence-right.sequence);const validation=rejected.length?makeEvent(streamId,0,"worker:validator",client,corr,"ValidationFailed",{attempted_type:"canvas_sync",attempted_by:"user",permission_schema_version:PERMISSION_SCHEMA_VERSION,errors:rejected}):null;if(validation)await appendOperationEvents(env,[validation]);const head=await streamHead(env,streamId);return Response.json({appended:[...confirmed,...(validation?[validation]:[])],rejected,head,idempotent:true});
    }
    let sequence=current;const appended=valid.map(({item})=>makeEvent(streamId,++sequence,userActor,client,corr,item.type!,item.payload!,{compensatesEventId:item.compensatesEventId}));if(rejected.length)appended.push(makeEvent(streamId,++sequence,"worker:validator",client,corr,"ValidationFailed",{attempted_type:"emit_events",attempted_by:"user",permission_schema_version:PERMISSION_SCHEMA_VERSION,errors:rejected}));if(appended.length)await appendOperationEvents(env,appended,{...(commutative?{}:{expectedHead:current})});return Response.json({appended,rejected,head:appended.at(-1)?.sequence??current});
  }catch(error){if(execution?.output?.dispatchStop(error))throw error;if(error instanceof StaleSequenceError)return Response.json({error:"stale_sequence",expected:error.expected,head:error.head},{status:409});return Response.json({error:error instanceof Error?error.message:"event_api_failed"},{status:500});}
}

import { AssistantContextReadWitness, assistantStructuredOwnSendOwnerHeadGuard, copyAssistantStructuredOwnSendFootprint,
  type AssistantStructuredOwnSendFootprint } from "./assistant-context-source.ts";
import { canonicalConsent, executionAdmissionGuard, executionContentCustodyGuard, type ConsequentialBinding } from "./consequential-consent.ts";
import { liveMemoryPrincipal } from "./memory-live-authority.ts";
import { configuredPilotAdmissionGuard, type BudgetReservationGuard } from "./pilot-policy.ts";
import { projectSourceProjectionCurrentAssertion, projectStructuredSourceProjectionCurrentAssertion } from "./project-access.ts";
import { publicEventPayload } from "./event-privacy.ts";
import { projectSourceProjectionAssertion } from "./project-source-read.ts";
import { appendNativeBlockInspection } from "./memory-block-inspection.ts";
import { memoryDigest } from "../src/model/scoped-memory.ts";
import { nativeMemoryDescriptor, nativeMemoryGrantDeadline, nativeMemoryPilotDeadline, nativeMemoryPilotQuery,
  nativeMemoryTimestamp, type NativeMemoryQuery } from "./memory-native-deadlines.ts";

/** Trusted server output of document read preparation, not a browser credential or branded authority. */
export type LegacyConversationOriginalPrepared = { principal: PilotUser; binding: ConsequentialBinding; sourceHead: number };
export type LegacyConversationOriginalInterval = { afterSequence: number; throughSequence: number };
export type LegacyConversationOriginalCapture = { readonly method: "native-legacy-originals-v1" | "native-legacy-originals-windows-v2"; readonly validUntil: string };
export type LegacyConversationOriginalReceipt = {
  method: "native-legacy-originals-v1" | "native-legacy-originals-windows-v2"; treatment: "untrusted-historical-evidence";
  scope: { actorUserId: string; ownerUserId: string; streamId: string; projectId: string; documentId: string;
    organizationId: string | null; projectAccessId: string | null };
  /** v1 is one complete interval; v2 lists exact windows, never an implied contiguous range. */
  interval?: LegacyConversationOriginalInterval; intervals?: LegacyConversationOriginalInterval[]; completeFromStart: false;
  originals: { eventId: string; sequence: number; turnId: string; role: "user" | "assistant"; actor: string;
    correlationId: string; causationId: string; contentRef: string; text: string; contentHash: string;
    occurredAt: string; recordedAt: string; expiresAt: string }[];
  /** Original database capture clock, not a refreshed TTL on subsequent replay. */
  checkedAt: string; validUntil: string;
};
type LegacyOriginalRow = Record<string, unknown>;
type LegacyOriginalFrame = { env: WorkerEnv; db: WorkerEnv["DB"]; preparedKey: string; settings: string;
  witness: AssistantContextReadWitness<LegacyConversationOriginalReceipt>; historicalReadOnly: boolean };
const legacyOriginalFrames = new WeakMap<LegacyConversationOriginalCapture, LegacyOriginalFrame>();
const legacyOriginalClock = "SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') AS checked_at";
const legacyOriginalEventColumns = "event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,"
  + "causation_id,compensates_event_id,schema_version,type,CASE WHEN length(CAST(payload AS BLOB))<=65536 THEN payload ELSE NULL END AS payload";
const legacyOriginalId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 240 && value.isWellFormed();
const legacyOriginalSettings = (env: WorkerEnv) => canonicalConsent([env.FORMA_PILOT_COHORT_ID ?? "", env.FORMA_ADMIN_EMAILS ?? ""]);
const legacyOriginalGuardQuery = (guard: BudgetReservationGuard) => nativeMemoryDescriptor(
  "SELECT CASE WHEN (" + guard.sql + ") THEN 1 ELSE 0 END AS allowed", guard.bindings);

function legacyOriginalJson(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string" || value.length > 65_536 || !value.isWellFormed()
    || new TextEncoder().encode(value).byteLength > 65_536) return null;
  try { const parsed: unknown = JSON.parse(value); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null; }
  catch { return null; }
}
function legacyOriginalNative(row: LegacyOriginalRow, payload: Record<string, unknown>): boolean {
  const origin = payload.origin && typeof payload.origin === "object" && !Array.isArray(payload.origin)
    ? payload.origin as Record<string, unknown> : null;
  return typeof row.event_id === "string" && !/^optimistic:/i.test(row.event_id)
    && typeof row.client_id === "string" && !/optimistic/i.test(row.client_id)
    && [payload.simulation, payload.synthetic, origin?.synthetic].every(value => value === undefined || value === null || value === false || value === 0)
    && [payload.mock_data_source, payload.replay_session_id, payload.fictional_user_id].every(value => value === undefined || value === null);
}
function legacyOriginalHistorical(row: LegacyOriginalRow, checked: number): boolean {
  const recorded = nativeMemoryTimestamp(row.recorded_at);
  return recorded !== null && row.occurred_at === row.recorded_at && recorded <= checked;
}
function legacyOriginalEnvelope(row: LegacyOriginalRow, secret: LegacyOriginalRow, owner: string): Record<string, unknown> | null {
  const payload = legacyOriginalJson(secret.private_json);
  if (!payload || !legacyOriginalId(row.event_id) || secret.private_event_id !== row.event_id
    || secret.owner_id !== owner || secret.redacted_at !== null || secret.created_at !== row.recorded_at
    || nativeMemoryTimestamp(secret.created_at) === null || !legacyOriginalNative(row, payload)) return null;
  // Match the actual forced eventWriteBindings producer. A duplicate key or conflicting
  // public/private spelling cannot pass this exact reconstruction after JSON.parse.
  const generated = publicEventPayload(row.event_id, payload, true);
  if (generated.privateJson !== secret.private_json || JSON.stringify(generated.payload) !== row.payload
    || secret.project_id !== (typeof payload.project_id === "string" && payload.project_id ? payload.project_id : null)
    || secret.document_id !== (typeof payload.document_id === "string" && payload.document_id ? payload.document_id : null)) return null;
  return payload;
}
type LegacyOriginalOwnGuard = { guard: BudgetReservationGuard;
  successor: (own: AssistantStructuredOwnSendFootprint) => BudgetReservationGuard;
  ownerHead?: { streamId: string; sourceHead: number } };
async function legacyOriginalRead(env: WorkerEnv, witness: AssistantContextReadWitness<LegacyConversationOriginalReceipt>, queries: NativeMemoryQuery[],
  ownGuards?: readonly (LegacyOriginalOwnGuard | null)[]) {
  const statements = queries.map(query => env.DB.prepare(query.sql).bind(...query.bindings));
  const results = structuredClone(await env.DB.batch<LegacyOriginalRow>(statements));
  if (results.length !== queries.length || results.some(result => result.success !== true || (result as typeof result & {error?:unknown}).error !== undefined || !Array.isArray(result.results)))
    throw new Error("legacy_original_read_unavailable");
  if (ownGuards && ownGuards.length !== queries.length) throw new Error("legacy_original_guard_shape");
  for (const [index, query] of queries.entries()) {
    const own = ownGuards?.[index];
    // Metadata is declared alongside the actual source guard, never inferred
    // from an opaque statement or by changing an SQL substring. The original
    // certificate retains the identical admission predicate and expected true row.
    if (own) witness.requireStructuredOwnGuard(own.guard, own.successor, own.ownerHead);
    else witness.observe([statements[index]!], [results[index]!], [query]);
  }
  return results.map(result => result.results);
}
function legacyOriginalDocumentGuard(prepared: LegacyConversationOriginalPrepared): BudgetReservationGuard {
  const { principal, binding } = prepared, scope = binding.scope;
  // Existing native document containment/current-boundary proof; no hydration, repair,
  // author/output capability, fabricated enrollment or removed-document-history fallback.
  return { sql: `EXISTS(SELECT 1 FROM events created LEFT JOIN event_private_payloads created_scope
      ON created_scope.private_event_id=created.event_id AND created_scope.owner_id=substr(created.stream_id,10)
      WHERE created.stream_id=? AND created.type IN('DocumentCreated','DocumentForked')
      AND created.sequence=(SELECT MAX(origin.sequence) FROM events origin WHERE origin.stream_id=created.stream_id
        AND origin.type IN('DocumentCreated','DocumentForked') AND json_extract(origin.payload,'$.document_id')=json_extract(created.payload,'$.document_id'))
      AND json_extract(created.payload,'$.document_id')=? AND COALESCE(json_extract(created.payload,'$.project_id'),created_scope.project_id,
        (SELECT json_extract(previous.payload,'$.project_id') FROM events previous WHERE previous.stream_id=created.stream_id
          AND previous.sequence<=created.sequence AND previous.type IN('ProjectCreated','ProjectOpened') ORDER BY previous.sequence DESC LIMIT 1))=?)
      AND COALESCE((SELECT boundary.type FROM events boundary WHERE boundary.stream_id=?
        AND json_extract(boundary.payload,'$.document_id')=? AND boundary.type IN('DocumentCreated','DocumentForked','DocumentRemoved','DocumentRestored')
        ORDER BY boundary.sequence DESC LIMIT 1),'DocumentRestored')!='DocumentRemoved'
      ${scope ? `AND EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.resource_kind='document'
        AND (resource.resource_id,resource.project_access_id,resource.organization_id,resource.project_id,resource.owner_user_id)=(?,?,?,?,?)
        AND (resource.visibility='collaborative_output' OR resource.visibility='actor_private' AND resource.actor_user_id=?))` : ""}`,
    bindings: [binding.streamId, binding.documentId, binding.projectId, binding.streamId, binding.documentId,
      ...(scope ? [binding.documentId, scope.projectAccessId, scope.organizationId, scope.projectId, scope.ownerUserId, principal.userId] : [])] };
}

/**
 * Inert read-only capture of an explicit ORIGINAL stream interval. Call only with the
 * actual server-prepared document principal/binding/head; that provenance precondition
 * is not established by this structural type. Current native guards independently close
 * authority. Never call a preparation/synchronization helper here: those may write.
 * All chat events in the interval count toward twelve refs (at most six complete pairs).
 * Mixed-document, ineligible or incomplete intervals deny wholesale, never skip or clip.
 * Persisted native sidecars are current custody authority; this reader does not reconstruct
 * historical job attribution. It checks ordinary ancestry, redaction and native access,
 * not memory enrollment, claim suppression, a semantic ledger or permission to publish.
 */
export async function captureLegacyConversationOriginals(env: WorkerEnv, prepared: LegacyConversationOriginalPrepared,
  interval: LegacyConversationOriginalInterval): Promise<LegacyConversationOriginalCapture | null> {
  return captureLegacyOriginalWindows(env,prepared,[interval],false);
}

/** One bounded native witness for disjoint original windows. Shared authority,
 * schema and custody reads are captured once, not dropped from a repeated-frame
 * budget. Every window still contains at most six WHOLE eligible pairs; unrelated
 * gaps are neither hydrated nor advertised as covered. No rolling rebase. */
export async function captureLegacyConversationOriginalWindows(env: WorkerEnv, prepared: LegacyConversationOriginalPrepared,
  intervals: readonly LegacyConversationOriginalInterval[]): Promise<LegacyConversationOriginalCapture | null> {
  return captureLegacyOriginalWindows(env,prepared,intervals,true);
}
/** Explicit historical read: exact original event/content/document custody is
 * checked below even when an unrelated append leaves the project index behind.
 * No hydration or repair, and this capability cannot derive own-send authority. */
export async function captureLegacyHistoricalOriginalWindows(env: WorkerEnv, prepared: LegacyConversationOriginalPrepared,
  intervals: readonly LegacyConversationOriginalInterval[]): Promise<LegacyConversationOriginalCapture | null> {
  return captureLegacyOriginalWindows(env,prepared,intervals,true,true);
}
async function captureLegacyOriginalWindows(env: WorkerEnv, prepared: LegacyConversationOriginalPrepared,
  intervals: readonly LegacyConversationOriginalInterval[], multiple: boolean, historicalReadOnly = false): Promise<LegacyConversationOriginalCapture | null> {
  try {
    const captured = structuredClone(prepared), windows = structuredClone(intervals), db = env.DB;
    const maximum = multiple ? 128 : 12, maximumPairs = maximum / 2;
    const method = multiple ? "native-legacy-originals-windows-v2" as const : "native-legacy-originals-v1" as const;
    const preparedKey = canonicalConsent(prepared), intervalKey = canonicalConsent(intervals), settings = legacyOriginalSettings(env);
    const started = Date.now(), deadlines = [started + 60_000], { principal, binding } = captured, scope = binding.scope;
    if (!principal || !binding || principal.fictional || !principal.authorizationSnapshot || !legacyOriginalId(principal.userId)
      || principal.userId !== binding.actorUserId || principal.access.permissionEpoch !== binding.permissionEpoch
      || !legacyOriginalId(binding.projectId) || !legacyOriginalId(binding.documentId) || binding.canvasId !== null || binding.blockId !== ""
      || binding.streamId !== "creative:" + (scope?.ownerUserId ?? principal.userId)
      || scope && (scope.actorUserId !== principal.userId || scope.projectId !== binding.projectId)
      || !Number.isSafeInteger(captured.sourceHead) || captured.sourceHead < 1
      || !Array.isArray(windows) || windows.length < 1 || windows.length > (multiple ? 32 : 1)
      || windows.some((window,index) => !window || Object.keys(window).sort().join(",") !== "afterSequence,throughSequence"
        || !Number.isSafeInteger(window.afterSequence) || window.afterSequence < 0
        || !Number.isSafeInteger(window.throughSequence) || window.throughSequence <= window.afterSequence
        || window.throughSequence > captured.sourceHead || index > 0 && window.afterSequence < windows[index-1].throughSequence)) return null;
    const contains = (window: LegacyConversationOriginalInterval, sequence: unknown) => typeof sequence === "number"
      && sequence > window.afterSequence && sequence <= window.throughSequence;
    const fresh = () => env.DB === db && canonicalConsent(prepared) === preparedKey && canonicalConsent(intervals) === intervalKey
      && legacyOriginalSettings(env) === settings && Date.now() < Math.min(...deadlines);
    const bound = (value: string | null | undefined) => {
      if (value === null) return;
      const time = nativeMemoryTimestamp(value);
      if (time === null || time <= started) throw new Error("legacy_original_deadline");
      deadlines.push(time);
    };
    bound(nativeMemoryGrantDeadline(principal, started));
    const current = await liveMemoryPrincipal(env, principal.userId);
    if (!fresh() || !current || canonicalConsent([current.role, current.access, current.authorizationSnapshot])
      !== canonicalConsent([principal.role, principal.access, principal.authorizationSnapshot])
      || !(scope ? hasCapability(current, "project.read", scope) : current.access.capabilities.includes("project.read"))) return null;
    bound(nativeMemoryGrantDeadline(current, started));
    const witness = new AssistantContextReadWitness<LegacyConversationOriginalReceipt>(env);
    const guards = [executionAdmissionGuard(principal, binding, captured.sourceHead), executionAdmissionGuard(current, binding, captured.sourceHead),
      configuredPilotAdmissionGuard(env, current), legacyOriginalDocumentGuard(captured),
      ...(scope ? [historicalReadOnly?projectSourceProjectionAssertion(scope,{sql:'migration.last_owner_sequence BETWEEN 0 AND ?',bindings:[captured.sourceHead]}):projectSourceProjectionCurrentAssertion(scope)] : [])];
    const ownAdmission = (user: PilotUser) => (own: AssistantStructuredOwnSendFootprint): BudgetReservationGuard => {
      const authority = executionAdmissionGuard(user, binding, null);
      const head = assistantStructuredOwnSendOwnerHeadGuard(own, binding.streamId, captured.sourceHead);
      return { sql: `(${authority.sql}) AND (${head.sql})`, bindings: [...authority.bindings, ...head.bindings] };
    };
    const ownHead = { streamId: binding.streamId, sourceHead: captured.sourceHead };
    const ownGuards: (LegacyOriginalOwnGuard | null)[] = [
      { guard: guards[0]!, successor: ownAdmission(principal), ownerHead: ownHead },
      { guard: guards[1]!, successor: ownAdmission(current), ownerHead: ownHead }, null,
      ...(scope ? [{ guard: guards[4]!, successor: (own: AssistantStructuredOwnSendFootprint) =>
        projectStructuredSourceProjectionCurrentAssertion(scope, own) }] : []),
    ];
    // These ordinary guards retain independent results in one observed row; neither gains an own-send exemption.
    const ordinaryAuthorityQuery = nativeMemoryDescriptor("SELECT CASE WHEN (" + guards[2]!.sql + ") THEN 1 ELSE 0 END AS pilot_allowed,"
      + " CASE WHEN (" + guards[3]!.sql + ") THEN 1 ELSE 0 END AS document_allowed", [...guards[2]!.bindings, ...guards[3]!.bindings]);
    const authorityQueries = [legacyOriginalGuardQuery(guards[0]!), legacyOriginalGuardQuery(guards[1]!), ordinaryAuthorityQuery,
      ...(scope ? [legacyOriginalGuardQuery(guards[4]!)] : [])];
    const authorityRows = await legacyOriginalRead(env, witness, authorityQueries, historicalReadOnly?undefined:ownGuards);
    if (!fresh() || authorityRows.some((rows, index) => rows.length !== 1 || (index === 2
      ? Object.keys(rows[0]).length !== 2 || !Object.hasOwn(rows[0], "pilot_allowed") || !Object.hasOwn(rows[0], "document_allowed")
        || rows[0].pilot_allowed !== 1 || rows[0].document_allowed !== 1
      : rows[0].allowed !== 1))) return null;
    const clock = structuredClone(await env.DB.prepare(legacyOriginalClock).first<{ checked_at: string }>());
    const checked = nativeMemoryTimestamp(clock?.checked_at);
    if (!fresh() || checked === null) return null;
    deadlines.push(checked + 60_000);
    const configured = env.FORMA_PILOT_COHORT_ID?.trim() ?? "";
    const breakglass = (env.FORMA_ADMIN_EMAILS ?? "").split(",").map(value => value.trim().toLowerCase()).includes(current.email.toLowerCase());
    if (configured && !breakglass) {
      const [rows] = await legacyOriginalRead(env, witness, [nativeMemoryPilotQuery(configured)]);
      bound(nativeMemoryPilotDeadline(rows, configured, checked));
      if (!fresh()) return null;
    }
    if (binding.contextSessionId) {
      const [rows] = await legacyOriginalRead(env, witness, [nativeMemoryDescriptor(
        "SELECT context_id,principal_user_id,organization_id,project_access_id,expires_at,revoked_at FROM project_context_sessions WHERE context_id=?",
        [binding.contextSessionId])]);
      if (!fresh() || rows.length !== 1 || rows[0].principal_user_id !== principal.userId || rows[0].revoked_at !== null
        || rows[0].organization_id !== scope?.organizationId || rows[0].project_access_id !== scope?.projectAccessId) return null;
      bound(typeof rows[0].expires_at === "string" ? rows[0].expires_at : undefined);
    }
    // The exclusion helper's absent-table branches must not survive additive schema arrival.
    const [schema, events] = await legacyOriginalRead(env, witness, [nativeMemoryDescriptor(
      "SELECT name,sql FROM sqlite_schema WHERE type='table' AND name IN('memory_native_answer_origins','assistant_turns') ORDER BY name", []),
      nativeMemoryDescriptor("SELECT " + legacyOriginalEventColumns + " FROM events WHERE stream_id=?"
        + " AND EXISTS(SELECT 1 FROM json_each(?) window WHERE sequence>json_extract(window.value,'$.afterSequence')"
        + " AND sequence<=json_extract(window.value,'$.throughSequence'))"
        + " AND type IN('ChatMessageSent','AssistantReasoned') ORDER BY sequence LIMIT " + (maximum+1),
      [binding.streamId, JSON.stringify(windows)])]);
    if (!fresh() || schema.length > 2 || events.length < 2 || events.length > maximum || events.length % 2 !== 0
      || windows.some(window => { const count = events.filter(row => contains(window,row.sequence)).length; return count < 2 || count > 12 || count % 2 !== 0; })) return null;
    const seenIds = new Set<string>(), seenSequences = new Set<number>(), seenRoles = new Set<string>();
    const selectedEvents: { row: LegacyOriginalRow; payload: Record<string, unknown>; role: "user" | "assistant" }[] = [];
    for (const row of events) {
      const payload = legacyOriginalJson(row.payload), role = row.type === "ChatMessageSent" ? "user" : "assistant";
      if (!payload || !legacyOriginalId(row.event_id) || seenIds.has(row.event_id) || row.stream_id !== binding.streamId
        || typeof row.sequence !== "number" || !Number.isSafeInteger(row.sequence) || seenSequences.has(row.sequence)
        || !windows.some(window => contains(window,row.sequence))
        || row.schema_version !== 1 || row.compensates_event_id !== null || !legacyOriginalId(row.client_id)
        || !legacyOriginalId(row.correlation_id) || !legacyOriginalId(row.causation_id)
        || !legacyOriginalHistorical(row, checked) || !legacyOriginalNative(row, payload)
        || payload.document_id !== binding.documentId || !legacyOriginalId(payload.turn_id) || !legacyOriginalId(payload.content_ref)
        || payload._private_ref !== row.event_id || Object.hasOwn(payload, "memory_origin_version")
        || row.actor !== (role === "user" ? scope ? `user:${principal.userId}` : "user" : "model:forma-chat")
        || role === "assistant" && payload.operation !== "creative-chat" || role === "user" && payload.source_surface !== "chat") return null;
      const roleKey = canonicalConsent([payload.turn_id, role]);
      if (seenRoles.has(roleKey)) return null;
      seenRoles.add(roleKey); seenIds.add(row.event_id); seenSequences.add(row.sequence); selectedEvents.push({ row, payload, role });
      bound(typeof payload.content_expires_at === "string" ? payload.content_expires_at : undefined);
    }
    for (const entry of selectedEvents) {
      const pair = selectedEvents.filter(other => other.payload.turn_id === entry.payload.turn_id);
      if (pair.length !== 2) return null;
      const user = pair.find(value => value.role === "user"), answer = pair.find(value => value.role === "assistant");
      if (!user || !answer || !windows.some(window => contains(window,user.row.sequence) && contains(window,answer.row.sequence))
        || answer.row.causation_id !== user.row.event_id || answer.row.correlation_id !== user.row.correlation_id
        || answer.row.client_id !== user.row.client_id
        || Number(answer.row.sequence) <= Number(user.row.sequence)
        || Date.parse(String(answer.row.recorded_at)) < Date.parse(String(user.row.recorded_at))) return null;
    }
    const eventIds = selectedEvents.map(entry => String(entry.row.event_id));
    const causeIds = selectedEvents.filter(entry => entry.role === "user").map(entry => String(entry.row.causation_id));
    if (new Set(causeIds).size !== causeIds.length) return null;
    const contentIds = selectedEvents.map(entry => String(entry.payload.content_ref));
    if (new Set(contentIds).size !== contentIds.length) return null;
    const owner = scope?.ownerUserId ?? principal.userId, custody = executionContentCustodyGuard(binding, "private_content");
    const [causes, secrets, contents, eventScopes, resources, retentions] = await legacyOriginalRead(env, witness, [
      nativeMemoryDescriptor("SELECT " + legacyOriginalEventColumns + " FROM events WHERE event_id IN(SELECT value FROM json_each(?)) ORDER BY sequence LIMIT " + (maximumPairs+1), [JSON.stringify(causeIds)]),
      nativeMemoryDescriptor("SELECT private_event_id,owner_id,project_id,document_id,CASE WHEN length(CAST(private_json AS BLOB))<=65536 THEN private_json ELSE NULL END AS private_json,created_at,redacted_at"
        + " FROM event_private_payloads WHERE owner_id=? AND private_event_id IN(SELECT value FROM json_each(?)) ORDER BY private_event_id LIMIT " + (maximum+maximumPairs+1), [owner, JSON.stringify([...eventIds, ...causeIds])]),
      nativeMemoryDescriptor("SELECT content_id,owner_id,kind,CASE WHEN length(CAST(content AS BLOB))<=16384 THEN content ELSE NULL END AS content,"
        + "created_at,expires_at,redacted_at FROM private_content WHERE content_id IN(SELECT value FROM json_each(?)) AND owner_id=? AND (" + custody.sql + ") ORDER BY content_id LIMIT " + (maximum+1), [JSON.stringify(contentIds), principal.userId, ...custody.bindings]),
      nativeMemoryDescriptor("SELECT * FROM project_event_scopes WHERE event_id IN(SELECT value FROM json_each(?)) ORDER BY event_id LIMIT " + (maximum+1), [JSON.stringify(eventIds)]),
      nativeMemoryDescriptor("SELECT * FROM project_resource_scopes WHERE resource_kind='content' AND resource_id IN(SELECT value FROM json_each(?)) ORDER BY project_access_id,resource_id LIMIT 129", [JSON.stringify(contentIds)]),
      nativeMemoryDescriptor("SELECT * FROM private_content_retention_scopes WHERE content_id IN(SELECT value FROM json_each(?)) ORDER BY content_id LIMIT " + (maximum+1), [JSON.stringify(contentIds)]),
    ]);
    if (!fresh() || causes.length !== causeIds.length || secrets.length !== eventIds.length + causeIds.length
      || contents.length !== contentIds.length || resources.length > 128 || retentions.length > maximum
      || (scope ? eventScopes.length !== eventIds.length || retentions.length !== contentIds.length || resources.length !== contentIds.length
        : eventScopes.length !== 0 || retentions.length !== 0 || resources.length !== 0)) return null;
    const bySecret = new Map(secrets.map(row => [row.private_event_id, row])), byContent = new Map(contents.map(row => [row.content_id, row]));
    if (bySecret.size !== secrets.length || byContent.size !== contents.length) return null;
    for (const entry of selectedEvents.filter(value => value.role === "user")) {
      const cause = causes.find(row => row.event_id === entry.row.causation_id), secret = cause && bySecret.get(cause.event_id);
      const payload = cause && secret && legacyOriginalEnvelope(cause, secret, owner);
      if (!cause || !payload || cause.type !== "BudgetReserved" || cause.actor !== "worker:policy" || cause.stream_id !== binding.streamId
        || cause.schema_version !== 1 || cause.causation_id !== null || cause.compensates_event_id !== null || cause.client_id !== entry.row.client_id
        || !legacyOriginalHistorical(cause, checked) || Date.parse(String(cause.recorded_at)) > Date.parse(String(entry.row.recorded_at))
        || cause.correlation_id !== entry.row.correlation_id || payload.operation !== "creative-chat"
        || typeof cause.sequence !== "number" || !Number.isSafeInteger(cause.sequence) || cause.sequence < 1 || cause.sequence + 1 !== entry.row.sequence
        || !legacyOriginalId(payload.reservation_id) || !legacyOriginalId(payload.cost_reservation_id)) return null;
    }
    const originals: LegacyConversationOriginalReceipt["originals"] = [];
    let textBytes = 0;
    for (const entry of selectedEvents) {
      const { row, role } = entry, secret = bySecret.get(row.event_id), content = byContent.get(entry.payload.content_ref);
      const payload = secret && legacyOriginalEnvelope(row, secret, owner);
      if (!payload || !content || payload.document_id !== binding.documentId || payload.turn_id !== entry.payload.turn_id
        || payload.content_ref !== entry.payload.content_ref || payload.content_expires_at !== entry.payload.content_expires_at
        || Object.hasOwn(payload, "memory_origin_version") || content.owner_id !== principal.userId
        || content.kind !== (role === "user" ? "chat-user" : "chat-assistant") || content.redacted_at !== null
        || typeof content.content !== "string" || !content.content.trim() || !content.content.isWellFormed()
        || nativeMemoryTimestamp(content.created_at) === null
        || Date.parse(String(content.created_at)) > Date.parse(String(row.recorded_at))) return null;
      const sourceDeadlines = [Date.parse(String(content.expires_at)), Date.parse(String(payload.content_expires_at))];
      if (scope) {
        const rows = eventScopes.filter(value => value.event_id === row.event_id);
        if (rows.length !== 1 || rows[0].project_access_id !== scope.projectAccessId || rows[0].organization_id !== scope.organizationId
          || rows[0].project_id !== scope.projectId || rows[0].owner_user_id !== scope.ownerUserId || rows[0].actor_user_id !== principal.userId
          || rows[0].source_stream_id !== binding.streamId || rows[0].source_sequence !== row.sequence
          || typeof rows[0].project_sequence !== "number" || !Number.isSafeInteger(rows[0].project_sequence) || rows[0].project_sequence < 1) return null;
        const contentResources = resources.filter(value => value.resource_id === content.content_id);
        const assigned = retentions.filter(value => value.content_id === content.content_id);
        if (contentResources.length !== 1 || assigned.length !== 1) return null;
        const resource = contentResources[0], retention = assigned[0];
        if (resource.resource_kind !== "content" || resource.project_access_id !== scope.projectAccessId
          || resource.organization_id !== scope.organizationId || resource.project_id !== scope.projectId
          || resource.owner_user_id !== scope.ownerUserId || resource.actor_user_id !== principal.userId || resource.visibility !== "actor_private"
          || retention.project_access_id !== scope.projectAccessId || retention.organization_id !== scope.organizationId
          || retention.project_id !== scope.projectId || retention.actor_user_id !== principal.userId || retention.classification !== "transient-private"
          || typeof retention.policy_version !== "number" || !Number.isSafeInteger(retention.policy_version) || retention.policy_version < 0
          || retention.created_at !== content.created_at) return null;
        // Zero is the actual producer's no-organization-policy version. Existing
        // assignment/body/event deadlines may shorten one another, never renew them.
        bound(typeof retention.assigned_expires_at === "string" ? retention.assigned_expires_at : undefined);
        sourceDeadlines.push(Date.parse(String(retention.assigned_expires_at)));
      }
      textBytes += new TextEncoder().encode(content.content).byteLength;
      if (textBytes > (multiple ? 262_144 : 65_536)) return null;
      bound(typeof content.expires_at === "string" ? content.expires_at : undefined);
      const contentHash = await memoryDigest(content.content);
      if (!fresh()) return null;
      originals.push({ eventId: String(row.event_id), sequence: Number(row.sequence), turnId: String(payload.turn_id), role,
        actor: String(row.actor), correlationId: String(row.correlation_id), causationId: String(row.causation_id),
        contentRef: String(payload.content_ref), text: content.content, contentHash, occurredAt: String(row.occurred_at), recordedAt: String(row.recorded_at),
        expiresAt: new Date(Math.min(...sourceDeadlines)).toISOString() });
    }
    const ordinary = await legacyChatMemoryProofBounded(env, binding.streamId, originals.map(value => ({ eventId: value.eventId, contentRef: value.contentRef })), maximum);
    if (!fresh()) return null;
    witness.require(ordinary);
    const validUntil = new Date(Math.min(...deadlines)).toISOString();
    witness.before(validUntil);
    const receipt: LegacyConversationOriginalReceipt = { method, treatment: "untrusted-historical-evidence",
      scope: { actorUserId: principal.userId, ownerUserId: owner, streamId: binding.streamId, projectId: binding.projectId,
        documentId: binding.documentId, organizationId: scope?.organizationId ?? null, projectAccessId: scope?.projectAccessId ?? null },
      ...(multiple ? {intervals: windows} : {interval: windows[0]}), completeFromStart: false, originals, checkedAt: clock!.checked_at, validUntil };
    witness.seal(receipt);
    const statements = witness.statements();
    if (!statements.length || !fresh()) return null;
    const final = structuredClone(await env.DB.batch<LegacyOriginalRow>(statements));
    if (!fresh() || final.length !== statements.length
      || final.some(result => result.success !== true || (result as typeof result & {error?:unknown}).error !== undefined || !Array.isArray(result.results)) || !witness.matches(final)) return null;
    const handle: LegacyConversationOriginalCapture = Object.freeze({ method, validUntil });
    legacyOriginalFrames.set(handle, { env, db, preparedKey, settings, witness, historicalReadOnly });
    return handle;
  } catch { return null; }
}

/** Repeated read-only replay is allowed within the original ceiling; it never creates a new lease.
 * No text is returned until every captured native read/guard and current SQL deadline matches.
 * The result grants neither memory enrollment/persistence nor provider/publication authority. */
export async function replayLegacyConversationOriginals(env: WorkerEnv, prepared: LegacyConversationOriginalPrepared,
  capture: LegacyConversationOriginalCapture): Promise<LegacyConversationOriginalReceipt | null> {
  const frame = legacyOriginalFrames.get(capture);
  if (!frame || frame.env !== env || frame.db !== env.DB) return null;
  try {
    const preparedKey = canonicalConsent(structuredClone(prepared)), settings = legacyOriginalSettings(env);
    if (preparedKey !== frame.preparedKey || settings !== frame.settings || Date.now() >= Date.parse(capture.validUntil)) return null;
    const statements = frame.witness.statements();
    if (!statements.length) return null;
    const results = structuredClone(await env.DB.batch<LegacyOriginalRow>(statements));
    if (env.DB !== frame.db || canonicalConsent(prepared) !== preparedKey || legacyOriginalSettings(env) !== settings || results.length !== statements.length
      || results.some(result => result.success !== true || (result as typeof result & {error?:unknown}).error !== undefined || !Array.isArray(result.results)) || !frame.witness.matches(results)) return null;
    return frame.witness.context();
  } catch { return null; }
}
// S4: an inert server-only bridge from original read receipts to the existing
// atomic assertion helper. This neither persists a ledger nor grants learning.
export type LegacyConversationOriginalsReadBudget = Readonly<{ statements: number; rows: number; bytes: number }>;
export type LegacyConversationOriginalsCommit = Readonly<{
  method: "native-legacy-originals-commit-v1";
  treatment: "untrusted-historical-evidence";
  scope: Readonly<LegacyConversationOriginalReceipt["scope"]>;
  sourceHead: number;
  completeFromStart: false;
  originals: readonly Readonly<LegacyConversationOriginalReceipt["originals"][number]>[];
  validUntil: string;
  /** Complete source read evidence, including guard/deadline rows. The caller's
   * separately measured ledger budget is admitted alongside this, not replaced. */
  budget: LegacyConversationOriginalsReadBudget;
  frameCount: number;
  /** Host-input/deadline check only. Database currentness requires the authentic
   * assertions in the SAME transaction as every consuming read or mutation. */
  isCurrent: () => boolean;
  precommitStatements: () => D1PreparedStatement[];
  precommitGuards: () => BudgetReservationGuard[];
}>;
const legacyOriginalAggregateLimit: LegacyConversationOriginalsReadBudget = Object.freeze({ statements: 32, rows: 8192, bytes: 2 * 1024 * 1024 });
function legacyOriginalBudgetValid(value: LegacyConversationOriginalsReadBudget): boolean {
  return !!value && ["statements", "rows", "bytes"].every(key => {
    const count = value[key as keyof LegacyConversationOriginalsReadBudget];
    return Number.isSafeInteger(count) && count >= 0 && count <= legacyOriginalAggregateLimit[key as keyof LegacyConversationOriginalsReadBudget];
  });
}

/**
 * Prepare a bounded union of genuinely issued S3 captures for this exact server
 * principal, scope and current source head. A persisted digest, caller-supplied
 * receipt or newest interval is never substituted for a retained original.
 *
 * The native store must supply its ACTUAL additional captured-read budget and
 * require this union to cover EVERY retained original dependency in its complete
 * ledger. Coverage of that ledger and current enrollment/learning authority are
 * separate store responsibilities; this bridge cannot certify omitted history.
 * The 32-statement/8192-row/2MiB admission is for the combined evidence read set,
 * not permission to execute an unbounded number of repeated transaction writes.
 *
 * Each frame is replayed here and every original assertion remains tied to that
 * same private witness. Only repetition of the identical issued handle is elided.
 * Independently issued frames keep all proofs, including their earlier deadlines;
 * only exact identical original values are deduplicated in the returned union.
 * Nothing inspects opaque statements, exposes descriptors or grants an own-write
 * exemption. The consuming store runs precommitStatements() before each own
 * INSERT and after its final mutation in the SAME atomic batch, and checks
 * isCurrent() immediately before submitting and after the batch resolves.
 */
export async function prepareLegacyConversationOriginalsCommit(env: WorkerEnv, prepared: LegacyConversationOriginalPrepared,
  captures: readonly LegacyConversationOriginalCapture[], additionalReadBudget: LegacyConversationOriginalsReadBudget): Promise<LegacyConversationOriginalsCommit | null> {
  try {
    if (!Array.isArray(captures) || captures.length < 1 || captures.length > 32 || !legacyOriginalBudgetValid(additionalReadBudget)) return null;
    const inputCaptures = [...captures], inputBudget = structuredClone(additionalReadBudget), capturedPrepared = structuredClone(prepared), db = env.DB;
    const budgetKey = canonicalConsent(inputBudget), preparedKey = canonicalConsent(capturedPrepared);
    const settings = legacyOriginalSettings(env), sourceHead = capturedPrepared.sourceHead;
    const frames: { capture: LegacyConversationOriginalCapture; frame: LegacyOriginalFrame; statements: D1PreparedStatement[] }[] = [];
    const seenHandles = new Set<LegacyConversationOriginalCapture>();
    let deadline = Number.POSITIVE_INFINITY;
    const budget = { statements: 0, rows: 0, bytes: 0 };
    const fits = () => (Object.keys(budget) as (keyof typeof budget)[]).every(key =>
      budget[key] + inputBudget[key] <= legacyOriginalAggregateLimit[key]);
    const current = () => {
      try {
        return env.DB === db && captures.length === inputCaptures.length && inputCaptures.every((capture, index) => captures[index] === capture)
          && canonicalConsent(prepared) === preparedKey && canonicalConsent(additionalReadBudget) === budgetKey
          && legacyOriginalSettings(env) === settings && Date.now() < deadline
          && frames.every(({ capture, frame }) => legacyOriginalFrames.get(capture) === frame && frame.env === env && frame.db === db
            && frame.preparedKey === preparedKey && frame.settings === settings && Date.now() < Date.parse(capture.validUntil));
      } catch { return false; }
    };
    for (const capture of inputCaptures) {
      if (seenHandles.has(capture)) continue;
      seenHandles.add(capture);
      const frame = legacyOriginalFrames.get(capture);
      if (!frame || frame.env !== env || frame.db !== db || frame.preparedKey !== preparedKey || frame.settings !== settings) return null;
      const expires = nativeMemoryTimestamp(capture.validUntil), statements = frame.witness.statements();
      if (expires === null || !statements.length) return null;
      deadline = Math.min(deadline, expires);
      budget.statements += statements.length;
      frames.push({ capture, frame, statements });
      if (!current() || !fits()) return null;
    }
    let scope: LegacyConversationOriginalReceipt["scope"] | null = null;
    const originals = new Map<string, LegacyConversationOriginalReceipt["originals"][number]>();
    const identities = new Map<string, string>();
    for (const { capture, frame, statements } of frames) {
      const results = structuredClone(await env.DB.batch<LegacyOriginalRow>(statements));
      if (!current() || results.length !== statements.length
        || results.some(result => result.success !== true || (result as typeof result & {error?:unknown}).error !== undefined || !Array.isArray(result.results))
        || !frame.witness.matches(results)) return null;
      for (const result of results) {
        budget.rows += result.results.length;
        for (const row of result.results) budget.bytes += new TextEncoder().encode(canonicalConsent(row)).byteLength;
        if (!fits()) return null;
      }
      const receipt = frame.witness.context();
      if (!receipt || receipt.method !== capture.method || receipt.treatment !== "untrusted-historical-evidence"
        || receipt.completeFromStart !== false || receipt.validUntil !== capture.validUntil || receipt.originals.length < 2
        || receipt.originals.length > (receipt.method === "native-legacy-originals-windows-v2" ? 128 : 12)) return null;
      if (scope === null) scope = receipt.scope;
      else if (canonicalConsent(scope) !== canonicalConsent(receipt.scope)) return null;
      for (const original of receipt.originals) {
        const encoded = canonicalConsent(original);
        // Distinct event, content, position and per-turn role identities must all
        // agree; equality of one identifier alone is not equality of originals.
        const keys = ["event:" + original.eventId, "content:" + original.contentRef, "sequence:" + original.sequence,
          "role:" + canonicalConsent([original.turnId, original.role])];
        if (keys.some(key => identities.has(key) && identities.get(key) !== encoded)) return null;
        for (const key of keys) identities.set(key, encoded);
        if (!originals.has(original.eventId)) originals.set(original.eventId, original);
      }
    }
    if (!scope || !originals.size || !current() || !fits()) return null;
    // Materialize once now so unsupported descriptor values fail before an issued
    // bridge is returned; later calls re-materialize only from the SAME witnesses.
    const precommitStatements = () => {
      if (!current() || !fits()) throw new Error("legacy_original_commit_unavailable");
      const statements = frames.flatMap(({ frame }) => frame.witness.precommitStatements());
      if (statements.length !== budget.statements || !current()) throw new Error("legacy_original_commit_unavailable");
      return statements;
    };
    const precommitGuards = () => {
      if (!current() || !fits()) throw new Error("legacy_original_commit_unavailable");
      const guards = frames.flatMap(({ frame }) => frame.witness.precommitGuards());
      if (guards.length !== budget.statements || !current()) throw new Error("legacy_original_commit_unavailable");
      return guards;
    };
    precommitStatements();
    const immutableOriginals = Object.freeze([...originals.values()].sort((left, right) => left.sequence - right.sequence)
      .map(original => Object.freeze({ ...original })));
    const commit: LegacyConversationOriginalsCommit = Object.freeze({ method: "native-legacy-originals-commit-v1", treatment: "untrusted-historical-evidence",
      scope: Object.freeze({ ...scope }), sourceHead, completeFromStart: false, originals: immutableOriginals,
      validUntil: new Date(deadline).toISOString(), budget: Object.freeze({ ...budget }), frameCount: frames.length,
      isCurrent: current, precommitStatements, precommitGuards });
    legacyOriginalCommitFrames.set(commit, { env, db, commit, current, witnesses: frames.map(({ frame }) => frame.witness),
      additionalBudget: Object.freeze({ ...inputBudget }), historicalReadOnly: frames.some(({frame})=>frame.historicalReadOnly),
      intervals: Object.freeze(frames.flatMap(({ frame }) => { const receipt=frame.witness.context()!;
        return (receipt.intervals ?? [receipt.interval!]).map(interval => Object.freeze({...interval})); })) });
    return commit;
  } catch { return null; }
}

// R6: original commits stay strict. A separate private issuance registry permits
// only their genuine captured witnesses to derive an exact own-send successor.
type LegacyOriginalCommitFrame = {
  historicalReadOnly: boolean;
  env: WorkerEnv; db: WorkerEnv["DB"]; commit: LegacyConversationOriginalsCommit; current: () => boolean;
  witnesses: readonly AssistantContextReadWitness<LegacyConversationOriginalReceipt>[];
  additionalBudget: LegacyConversationOriginalsReadBudget;
  intervals: readonly Readonly<LegacyConversationOriginalInterval>[];
};
const legacyOriginalCommitFrames = new WeakMap<LegacyConversationOriginalsCommit, LegacyOriginalCommitFrame>();
export type LegacyConversationOriginalsOwnSend = Readonly<{ method: "native-legacy-originals-own-send-v2"; validUntil: string }>;
type LegacyOriginalOwnSendFrame = {
  source: LegacyOriginalCommitFrame; own: AssistantStructuredOwnSendFootprint; ownKey: string;
  witnesses: readonly AssistantContextReadWitness<LegacyConversationOriginalReceipt>[];
  statementCount: number; current: () => boolean;
};
const legacyOriginalOwnSendFrames = new WeakMap<LegacyConversationOriginalsOwnSend, LegacyOriginalOwnSendFrame>();

/** Genuine interval metadata for the private manifest. This is not a transferable
 * source proof, a fresh read lease, or permission to omit an original dependency. */
export function legacyConversationOriginalsEvidence(env: WorkerEnv, commit: LegacyConversationOriginalsCommit):
  Readonly<{ intervals: readonly Readonly<LegacyConversationOriginalInterval>[] }> | null {
  const frame = legacyOriginalCommitFrames.get(commit);
  if (!frame || frame.env !== env || frame.db !== env.DB || !frame.current()) return null;
  return Object.freeze({ intervals: Object.freeze(frame.intervals.map(interval => Object.freeze({ ...interval }))) });
}

/** Bind one exactly owned two-event send to genuine, still-current S3 captures.
 * Original certificates retain their original guards. Only explicitly registered
 * head callbacks may change in the distinct successor; every other source read,
 * input identity, scope and SQL/host deadline survives unchanged. */
export async function prepareLegacyConversationOriginalsOwnSend(env: WorkerEnv, commit: LegacyConversationOriginalsCommit,
  own: AssistantStructuredOwnSendFootprint): Promise<LegacyConversationOriginalsOwnSend | null> {
  try {
    const source = legacyOriginalCommitFrames.get(commit);
    if (!source || source.historicalReadOnly || source.env !== env || source.db !== env.DB || !source.current()) return null;
    const selected = copyAssistantStructuredOwnSendFootprint(own), ownKey = canonicalConsent(selected), scope = commit.scope;
    if (selected.streamId !== scope.streamId || selected.sourceHead !== commit.sourceHead || selected.actorUserId !== scope.actorUserId
      || selected.projectId !== scope.projectId || selected.documentId !== scope.documentId
      || canonicalConsent(selected.scope) !== canonicalConsent(scope.organizationId === null ? null : {
        organizationId: scope.organizationId, projectAccessId: scope.projectAccessId,
        projectId: scope.projectId, ownerUserId: scope.ownerUserId })) return null;
    const current = () => {
      try { return source.env === env && source.db === env.DB && legacyOriginalCommitFrames.get(commit) === source
        && source.current() && canonicalConsent(copyAssistantStructuredOwnSendFootprint(own)) === ownKey; }
      catch { return false; }
    };
    // Replay the original statements, not recapture/reprepare. No new original
    // deadline or a caller-provided receipt can renew the consumed evidence.
    for (const witness of source.witnesses) {
      const statements = witness.statements();
      if (!statements.length || !current()) return null;
      const results = structuredClone(await source.db.batch<LegacyOriginalRow>(statements));
      if (!current() || results.length !== statements.length
        || results.some(result => result.success !== true || (result as typeof result & {error?:unknown}).error !== undefined || !Array.isArray(result.results))
        || !witness.matches(results)) return null;
    }
    const witnesses = source.witnesses.map(witness => witness.bindStructuredOwnSend(selected));
    let statementCount = 0;
    for (const witness of witnesses) {
      const statements = witness.structuredOwnPrecommitStatements();
      if (!statements.length) return null;
      statementCount += statements.length;
    }
    // The new complete-footprint assertion rows and their bound value are part
    // of admission, alongside the store's original measured additional reads.
    const added = statementCount - commit.budget.statements;
    if (added < witnesses.length || statementCount + source.additionalBudget.statements > legacyOriginalAggregateLimit.statements
      || commit.budget.rows + added + source.additionalBudget.rows > legacyOriginalAggregateLimit.rows
      || commit.budget.bytes + source.additionalBudget.bytes
        + witnesses.length * new TextEncoder().encode(ownKey).byteLength > legacyOriginalAggregateLimit.bytes || !current()) return null;
    const proof: LegacyConversationOriginalsOwnSend = Object.freeze({ method: "native-legacy-originals-own-send-v2", validUntil: commit.validUntil });
    legacyOriginalOwnSendFrames.set(proof, { source, own, ownKey, witnesses, statementCount, current });
    return proof;
  } catch { return null; }
}

/** Complete own-final SQL assertions only. Run after all exact two-event suffix,
 * three bodies, event/private receipts and custody rows in the SAME atomic batch.
 * These abort on mismatch; raw successful SELECT envelopes are not write proof. */
export function legacyConversationOriginalsOwnSendStatements(env: WorkerEnv, proof: LegacyConversationOriginalsOwnSend): D1PreparedStatement[] | null {
  try {
    const frame = legacyOriginalOwnSendFrames.get(proof);
    if (!frame || frame.source.env !== env || frame.source.db !== env.DB || !frame.current()) return null;
    const statements = frame.witnesses.flatMap(witness => witness.structuredOwnPrecommitStatements());
    return statements.length === frame.statementCount && frame.current() ? statements : null;
  } catch { return null; }
}

/** Independent final response certification observes the same consumed proof.
 * Partial insertion, foreign rows or a missing third manifest never certify. */
export async function replayLegacyConversationOriginalsOwnSend(env: WorkerEnv, proof: LegacyConversationOriginalsOwnSend): Promise<boolean> {
  try {
    const frame = legacyOriginalOwnSendFrames.get(proof);
    if (!frame || frame.source.env !== env || frame.source.db !== env.DB || !frame.current()) return false;
    const sets = frame.witnesses.map(witness => witness.statements()), statements = sets.flat();
    if (statements.length !== frame.statementCount || !statements.length) return false;
    const results = structuredClone(await frame.source.db.batch<LegacyOriginalRow>(statements));
    if (!frame.current() || results.length !== statements.length
      || results.some(result => result.success !== true || (result as typeof result & {error?:unknown}).error !== undefined || !Array.isArray(result.results))) return false;
    let offset = 0;
    for (const [index, witness] of frame.witnesses.entries()) {
      const count = sets[index]!.length;
      if (!witness.matches(results.slice(offset, offset + count))) return false;
      offset += count;
    }
    return offset === results.length && frame.current();
  } catch { return false; }
}
