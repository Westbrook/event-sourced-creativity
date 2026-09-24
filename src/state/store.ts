import { imageGenerationProgress } from "../model/image-generation-progress.ts";
import { warmCompletedVideoCovers } from "../media/video-cover.ts";
import { sharedIdeaEdits, independentIdeaEdits, ideaContentEdit } from '../model/shared-idea-edits.ts';
import { chooseSharedIdeaEdit, IdeaEditCanceled } from '../ui/shared-idea-choice.ts';
import { attachIdeaEvents, canAttachProjectIdea, ideaDependencies, ideaDocumentUses, ideasInDocument } from '../model/project-ideas';
import { documentJobCanAcknowledgeSafety } from "../model/document-jobs.ts";
import { hasServerExecutionOwner } from "../model/output-durable-observation.ts";
import { isStandaloneExperienceRoute } from "../experiences/host-route.ts";
import { AttentionPublicationGate } from "./attention-publication.ts";
import { AUDIO_LOCAL_CONVERSION_MEDIA_TYPE, parseAudioTrimOperationRequest, audioTrimOperationFingerprintInput, encodeAudioConversionSource } from "../model/audio-local-conversion.ts";
import { inspectPcmWav, PCM_WAV_EDIT_MAX_BYTES } from "../model/audio-container.ts";
import { captureCurrentGeneratedImageEdit, matchGeneratedImageEditSnapshot, type CurrentGeneratedImageEdit } from "../model/generated-image-edit-current.ts";
import { GENERATED_IMAGE_EDIT_LIMITS } from "../model/generated-image-edit.ts";
import { parseGeneratedImageEditRequest, parseGeneratedImageRevision, generatedImageEditOperationSha256, projectGeneratedImageEdit, type GeneratedImageEditRequest, type GeneratedImageEditSnapshot, type GeneratedImageEditAcknowledgment } from "../model/generated-image-revision.ts";
import { inspectOutputAsset, outputAssetSha256 } from "../model/output-asset-inspection.ts";
import { captureNativeStorySetup, acknowledgedNativeStoryHandle, type NativeStorySetup, type NativeStorySubmission, type NativeStoryHandle, type NativeStoryFailureReason } from "../model/native-short-story-generation.ts";
import { captureNativeImageSetup, captureNativeImageHandle, captureNativeImageSubmission, captureNativeImageRead, joinNativeImageCompletion, nativeImageInspectionPath, NATIVE_IMAGE_LIMITS, type NativeImageSetup, type NativeImageHandle, type NativeImageSubmission, type NativeImageRead } from "../model/native-image-generation.ts";
import { documentJobCanCheckSavedPresentationReceipt, savedPresentationReceiptCheckMessage, savedPresentationReceiptCheckResponse, type PresentationReceiptCheckStatus } from "../model/presentation-receipt-check.ts";
import { documentRenderGuidance, documentRenderGuidanceProblem } from "../model/document-render-guidance.ts";
import { validateModel3dRequest, estimateModel3dCostMicrousd, type Model3dSettings } from "../model/model3d";
import { adaptDocumentToModel3d, model3dAdaptationReceipt, type Model3dDocumentAdaptation } from "../model/model3d-prompt-adapter";
import { validateModel3dAsset, MAX_MODEL3D_UPLOAD_BYTES } from "../model/model3d-assets";
import type { Model3dView } from "../model/model3d-view";
import { referenceCompositionSources, validateReferenceComposition, normalizeReferenceComposition, type ReferenceCompositionRecipe } from "../model/reference-composition";
import { projectIntake, type ProjectIntake } from "../model/project-intake";
import { captureOutputNavigationFocus, outputNavigationOwnedRouteFocus, type OutputNavigationFocusLease } from "../components/output-navigation-focus";
import { copyOutputRequirementCreationEvents } from "../model/output-requirement-copy.ts";
import { OutputRequirementsClient } from "./output-requirements-client";
import type { OutputCommandResponse, OutputRequirementCommand, OutputRequirementsSnapshot } from "../model/output-delivery-contract";
import { isOutputContextBlock } from "../model/output-source-policy";
import { outputRequirementEditableDraft } from "../model/output-requirements";
import { normalizeOutputRequirementCreation } from "../model/output-requirement-creation.ts";
import { resolvePresentationCountRequest, type SlideCountPolicy } from "../model/presentation-count-policy";
import { Signal } from "signal-polyfill";
import { adaptiveRequestKey, adaptiveJobMatchesRequest } from "../model/adaptive-request";
import { contextConsentAction, contextConsentFailure, type ContextConsentAction } from "../model/context-consent-state";
import type { AvailableConsequentialPreview } from "../../worker/consequential-consent";
import { documentCopyKey, documentCopyTargetValid, documentCopyIntent, documentCopySourceRevision, documentCopyRequest, documentCopyOutcome, type DocumentCopyTarget, type DocumentCopyDetails, type DocumentCopyAction, type DocumentCopyReview } from "../model/document-copy-review";
import { SignalObject } from "signal-utils/object";
import { foldEvents, type CreativeEvent, type CreativeProjection, type EventInput } from "../model/events";
import type { ImageSample, ReferenceFindingKind } from "../model/extractors";
import { readAttentionPreference, writeAttentionPreference } from "../model/attention";
import { adaptiveSuggestionsForCanvas, blockEffectFor, blockIntentFor, type AdaptiveStructure, type AdaptiveSuggestionSet } from "../model/block-types";
import { artifactFocusRoute, documentContextBlockRoute, documentFocusFromRoute, documentIdFromRoute, documentViewFromRoute, isDocumentViewRoute, isProjectTaskRoute, projectTaskDocumentIdFromRoute, withProjectTaskDocumentInRoute, withDocumentFocusInRoute, withDocumentInRoute } from "../model/routes";
import { normalizeSpatialScope } from "../model/spatial-scope";
import { CURRENT_FOCAL_POINT_METHOD, normalizeImageFocalPoint } from "../model/focal-point";
import { resolveImageFocalAnalysis } from "../model/image-focus";
import { DOCUMENT_JOB_KINDS, documentJobIsMemory, documentGenerationRequestKey as generationRequestKeyFor, documentGenerationRevision as generationRevisionFor, documentJobCanRecoverPresentation, documentJobFailure, documentJobIsStale, documentJobTerminal, documentJobStopBudgetMessage, documentJobHasNoBudgetHold, planningStopBudget, generationFailureGuidance, type DocumentJob, type DocumentJobKind, type DocumentJobStopBudget } from "../model/document-jobs";
import { effectivePromptPreference, normalizePromptTechnique, type PromptPreferenceScope, type PromptTechnique } from "../model/prompt-structures";
import { canvasIdFromRoute } from "../canvas/routes";
import { isProtectedOutcomeArrangementEvent, outcomeArrangementUndoneActions } from "../canvas/outcome-arrangements";
import { outcomeDeskIntegrationCopy } from "../components/design-system/locales/outcome-desk-integration-messages";
import { OUTCOME_ARRANGEMENT_ENDPOINT, type OutcomeArrangementCommand, type OutcomeArrangementHttp } from "./outcome-desk-controller";
import { canvasDocumentTarget, documentJobMatchesSurface } from "../model/canvas-document-target";
import { canvasProjectId, foldCanvasEvents, type CanvasContextSet, type CanvasProjection } from "../canvas/model";
import type { GenerationReadiness, GenerationReadinessKind, PromptTechniqueSafetyComparison } from "../model/generation-readiness";
import { documentArtifactRevision, isDocumentArtifactKind, parseAudioMediaRevision, parseDocumentArtifactContent, parseVideoMediaRevision, parseVideoTrimEditRequest, videoArtifactMediaItem, model3dArtifactMediaFile, type AudioTrimEditRequest, type AudioTrimEditResult, type DocumentArtifactKind, type SlidePresentation, type SlideStylePresetId, type VideoTrimEditRequest, type VideoTrimEditResult } from "../model/document-artifacts";
import { ownerMediaNamespace } from "../model/media-ownership";
import { parseModel3dScaleEditRequest, type Model3dScaleEditRequest } from "../model/model3d-artifact-revision";
import { parseModel3dMediaRevision, type Model3dScaleEditResult } from "../model/model3d-media-revision";
import { artifactContextEvents, imageOutputContextEvents, model3dArtifactContextReadiness } from "../model/output-context";
import { outputBlockRemovalEvents as ownedOutputBlockRemovalEvents, outputBlockTextEditEvents, outputInputDraft, outputInputEditEvents, type OutputInputDraft } from "../model/output-authoring";
import { combinedContextGroups, combinedContextMemberships, combinedContextRoleForBlockType, CONTEXT_CONTAINS_RELATION, isContextCompositionRelation, normalizeActionBlockReferences } from "../model/combined-context";
import { eventProfileRank } from "../model/event-profiles";
import type { VideoAudioMode, VideoDurationSeconds } from "../model/video-adapter";
import { normalizeVideoDurationSeconds, VIDEO_ADAPTER_CONTRACT } from "../model/video-adapter";
import { normalizeAudioRequestProfile, selectAudioAdapterContract, type AudioRequestProfile } from "../model/audio";
import { isSceneMedium, type SceneMedium } from "../model/scene-configuration";
import { isSceneCostPreview, isSceneSafeUnusedProof, sceneCostApprovalMatches, sceneCostRequestDescription, sceneCostRequestHash, type SceneCostApproval, type SceneCostInspection, type SceneCostPreview, type SceneCostRequest } from "../model/scene-cost-consent";
import { standingConstraints } from "../model/taste";
import { estimatePlannerOperationMicrousd, formatGenerationUsd, generationBudgetGate, generationBudgetPreferenceKey, type GenerationCostBudgets } from "../model/generation-budget";
import { currentFormaLocale, FORMA_DEFAULT_MESSAGES } from "../components/design-system/localization";
import { localizedGenerationFailureGuidance } from "../components/design-system/localized-runtime-copy";
import { formaSystemMessageId } from "../components/design-system/system-message-id";
import { buildManagedProductionPlan, MAX_MANAGED_PRESENTATION_SLIDES, type ProductionMode } from "../model/managed-production";
import { productionWorkflowSourceIdentity, productionWorkflows, productionWorkflowSourcesForStage, productionWorkflowStageStates, type ProductionWorkflowSource } from "../model/production-workflow";
import { beginRoutePopulation, completeBackgroundHydration, recordEventPage, recordPopulationSource, recordPrivateContentState, recordRouteHistoryProfile, recordSessionReady } from "../performance";
import { accountSnapshotFenceCurrent, captureAccountSnapshotFence, clearAccountSnapshots, clearAnalyticsSnapshots, matchingAccountSnapshot, readAccountSnapshots, writeAccountSnapshot, type AccountSnapshotFence, type AccountSnapshotIdentity, type AccountSnapshotProfile } from "./account-cache";
import { canvasOfflineQueue } from "../sync/canvas-offline-queue";
import { consumeSessionBootstrap, consumeSessionPrefetch } from "./session-bootstrap";
import { isRetainedOutputReaderRoute, routeCapabilities } from "./route-capabilities";
import type { FormaCapability } from "../platform/capabilities";
import { applicationIdFromRoute, type ApplicationId } from "../platform/applications";
import { workspaceTransitionAuthorized } from "../platform/workspace-transitions";
import type { PresentationCandidateRevisionRequest, PresentationCandidateRevisionResult, PresentationCandidateValidationIssue, PresentationCandidateDetail, PresentationCandidateList, PresentationCandidateSummary, PreservedPresentationCandidateJobs } from "../model/presentation-candidates";

// State-only cleanup may preserve focus; this never bypasses action/current guards.
type WorkspaceNavigationOptions = { replace?:boolean; preserveFocus?:boolean; documentFocus?:boolean; current?:()=>boolean; focus?:OutputNavigationFocusLease; documentId?:string; onOriginHandoff?:()=>boolean; onDestinationSource?:(source:CapturedSourceOwnership)=>boolean; nativeImageStartup?:NativeImageWorkspaceStartup };
type WorkspaceNavigationOwner = {options:WorkspaceNavigationOptions;handedOff:boolean;revision:number;route:string;browserRoute:string;session:PilotSession|null;sessionRevision:number;sourceGeneration:number;sourceRetired:boolean;authorization:string;shared:boolean;cookieGeneration:number;cookieSessionGeneration:number;startup:NativeImageWorkspaceStartupDispatcher|null};
const workspaceNavigationCurrent=(options:WorkspaceNavigationOptions)=>(!options.current||options.current())&&(!options.focus||options.focus.current());
type DocumentArtifactRenderOptions = {model3dPrompt?:string;model3dPromptSource?:"document";model3dAdaptation?:ReturnType<typeof model3dAdaptationReceipt>;model3dSettings?:Model3dSettings;model3dReferenceBlockIds?:string[];documentId?:string;itemCount?:number;audience?:string;tone?:string;sceneMedium?:SceneMedium;videoSeconds?:VideoDurationSeconds;videoSize?:"1280x720"|"720x1280";videoResolution?:"480p"|"720p";videoAudioMode?:VideoAudioMode;soundtrackBlockIds?:string[];sendSoundtrackToVideoProvider?:boolean;audioImageBlockId?:string;audioProfile?:AudioRequestProfile;audioProviderModel?:string;audioVideoArtifactId?:string;sendAudioVideoToProvider?:boolean;productionMode?:ProductionMode;paidMediaConfirmed?:boolean;sourceSurface?:string;locale?:string;presentationStyle?:SlideStylePresetId;presentationFidelity?:"faithful"|"creative";requestedSlideCount?:number;slideCountPolicy?:SlideCountPolicy;authoredSlideCount?:number;workflowId?:string;workflowStageId?:string;workflowSources?:ProductionWorkflowSource[];sceneRequestId?:string;sceneCostConsent?:SceneCostApproval;current?:()=>boolean;onDispatch?:()=>void;onResult?:(result:SceneSubmissionResult)=>void};
// Internal classification only; legacy callers still receive the same localized Error.message.
class GenerationBudgetAdmissionError extends Error {
  constructor(readonly reason:"budget-blocked"|"user-canceled",message:string){super(message);}
}
type NativeStoryObserver = { current:()=>boolean; onDispatch:()=>void; acknowledged:(handle:NativeStoryHandle,reused:boolean)=>void; failed:(reason:NativeStoryFailureReason)=>void };
type Listener = () => void;
type HistoryGroup = CreativeEvent[];
export type CapturedSourceOwnership = Readonly<{ authorization:CapturedAuthorizationScope; generation:number }>;
export type NativeImageLifetime = Readonly<{
  current:()=>boolean;
  subscribe:(onRetire:()=>void)=>()=>void;
  dispose:()=>void;
}>;
export type NativeImageInitialListReadReceipt = Readonly<{
  /** This read claim's identity, not a navigation commit or authority token. */
  status:"published";intent:Readonly<object>;scope:string;
}> | Readonly<{status:"not-started";reason:"ineligible"}>
  | Readonly<{status:"superseded";dispatched:boolean}>;
/** A single list read, not an I2 operation or a background-job lifetime.
 * Both channels must be observed. Publication does not imply tail success.
 * Notification POSTs, runner/recovery work and later polls are excluded. */
export type NativeImageInitialListReadOperation = Readonly<{
  initial:Promise<NativeImageInitialListReadReceipt>;
  settled:Promise<void>;
}>;
type NativeImageWorkspaceStartupSlot="history"|"private-hydration"|"initial-visible-job-read";
type NativeImageWorkspaceStartupTicketSlot="component-load"|"document-sync"|NativeImageWorkspaceStartupSlot;
type NativeImageWorkspaceStartupEndReason="navigation-ended-before-start"|"host-disconnected";
type NativeImageWorkspaceCommit=Readonly<{intent:Readonly<object>;path:string}>;
/** Opt-in observation only. Neither this frozen observer nor its id grants
 * navigation, source, read or publication authority. The concrete host binds
 * a fresh observer/id per navigation to one accepted startup ticket, without
 * terminal recipients. Reusing a ticket observer across navigations is invalid. */
export type NativeImageWorkspaceStartup=Readonly<{
  id:Readonly<object>;
  commit:(receipt:NativeImageWorkspaceCommit)=>void;
  start:(slot:NativeImageWorkspaceStartupTicketSlot,work:()=>unknown)=>void;
  unnecessary:(slot:NativeImageWorkspaceStartupTicketSlot,reason:string)=>void;
  superseded:(slot:NativeImageWorkspaceStartupTicketSlot)=>void;
  /** Supplemental failure even if this slot was already superseded. The host
   * stores it before its own notification outcome; it never replaces a slot. */
  failed:(slot:NativeImageWorkspaceStartupSlot,reason:unknown)=>void;
  /** Stores both original channels and synchronously installs their observers.
   * No external recipient is invoked before the exact settled channel returns. */
  initial:(operation:NativeImageInitialListReadOperation)=>void;
}>;
type NativeImageWorkspaceStartupFrame={id:number|null};
type NativeImageWorkspaceStartupDispatcher={
  startup:NativeImageWorkspaceStartup;owner:WorkspaceNavigationOwner;armed:boolean;
  commit:NativeImageWorkspaceCommit|null;
  unstarted:Record<NativeImageWorkspaceStartupSlot,boolean>;
  frames:Record<NativeImageWorkspaceStartupSlot,NativeImageWorkspaceStartupFrame|null>;
};
type NativeImageListReadOwner = {
  intent:Readonly<object>;navigation:number;feedRevision:number;route:string;scope:string;
  source:CapturedSourceOwnership|null;session:PilotSession|null;sessionRevision:number;
  cookieGeneration:number;cookieSessionGeneration:number;
};
type NativeImageListReadClaim = {
  owner:NativeImageListReadOwner;operation:NativeImageInitialListReadOperation;
  dispatched:boolean;initialDone:boolean;automatic:boolean;admissionFailed:boolean;
  resolveInitial:(receipt:NativeImageInitialListReadReceipt)=>void;rejectInitial:(reason:unknown)=>void;
  resolveSettled:()=>void;rejectSettled:(reason:unknown)=>void;
  legacyFailure:{reason:unknown}|null;legacy:Promise<void>|null;
  observation:Promise<PromiseSettledResult<unknown>[]>|null;
};
type NativeImageSemanticCohort = {epoch:object;users:number;current:()=>boolean};
type NativeImageLifetimeRecord = {retired:boolean;listeners:Set<()=>void>;release:()=>void};
class NativeImageRetirementError extends AggregateError {
  readonly #originals:readonly unknown[];
  constructor(failures:unknown[]){
    if(failures.length===0)throw new TypeError("native_image_lifetime_failure_required");
    const originals=Object.freeze([...failures]);
    super([...originals],"native_image_lifetime_retirement_failed",{cause:originals[0]});
    this.#originals=originals;
  }
  static is(value:unknown):value is NativeImageRetirementError{return typeof value==="object"&&value!==null&&#originals in value;}
  static originals(error:NativeImageRetirementError):readonly unknown[]{return error.#originals;}
}
function combineNativeImageRetirementFailures(failures:unknown[]):NativeImageRetirementError|null{
  if(!failures.some(error=>NativeImageRetirementError.is(error)))return null;
  return new NativeImageRetirementError(failures.flatMap(error=>NativeImageRetirementError.is(error)?[...NativeImageRetirementError.originals(error)]:[error]));
}
type OwnedDocumentCopyReview = DocumentCopyReview & { sourceOwner:CapturedSourceOwnership|null; commitSubmitted:boolean;
  /** A known refusal is provenance, not permission to edit after a failed read. */
  refusedRevision?:Readonly<{intent:NonNullable<DocumentCopyReview["intent"]>;revisedIntent:NonNullable<DocumentCopyReview["revisedIntent"]>;
    sourceOwner:CapturedSourceOwnership;authorityKey:string}>;
};
export type EventSourceRetirement = Readonly<{ source:CapturedSourceOwnership; generation:number; status:401|403|404 }>;
export type EventWriteOwner = Readonly<{ authorizationKey:string; actorUserId:string; projectId:string|null; sourceGeneration:number }>;
export type CommittedEventIdentity = Readonly<{ eventId:string; type:CreativeEvent["type"]; sequence:number; clientEventId:string|null }>;
export type EventWriteAcknowledgment = Readonly<{ observationId:string; owner:EventWriteOwner; action:"append"|"batch"|"canvas_sync"|"project_intake"; requestedClientEventIds:readonly string[]; committed:readonly CommittedEventIdentity[]; rejectedIndices:readonly number[]; outcome:"not-attempted"|"observed"|"unconfirmed"; observedHead:number|null; privateUnavailable:boolean }>;
export type EventWriteResult = Readonly<{ appended:CreativeEvent[]; acknowledgment:EventWriteAcknowledgment; publication:"published"|"withheld"|"none" }>;
export type WithheldEventWrite = Readonly<{publication:"withheld";acknowledgment:EventWriteAcknowledgment}>;
export type AppendOptions = { current?:()=>boolean; expected?:number; remember?:boolean; rebaseAttempts?:number; silent?:boolean; background?:boolean; onAcknowledgment?:(receipt:EventWriteAcknowledgment)=>void };
export type CanvasSyncResult = { appended:CreativeEvent[]; rejected:Array<{index?:number;type?:string;reason:string}>; head:number; retryable:boolean; error:string; acknowledgment?:EventWriteAcknowledgment; pause?:"source-retired" };
type EventSourceRead = { source:CapturedSourceOwnership; id:number; profile:AccountSnapshotProfile; identity:AccountSnapshotIdentity; cacheFence:AccountSnapshotFence; complete:boolean; from:number; cookieGeneration:number };
type ProjectContextCookieRequest = { ready:Promise<void>; settled:boolean; admitted:boolean; current:()=>boolean; matches:(session:PilotSession|null)=>boolean; reconciliation:Promise<void>|null };
type EventSourcePage = { events:CreativeEvent[]; content:Record<string,string>; head:number; read:EventSourceRead };
type AudioTrimObservation = { artifactId:string; request:AudioTrimEditRequest; contentRef:string; documentId:string; projectId:string; sourceMediaUrl:string; sourceRaw:string; sourceRevision:number };
type VideoTrimObservation = { artifactId:string; request:VideoTrimEditRequest; contentRef:string; documentId:string; projectId:string; route:string; ownerUserId:string;
  sourceMediaUrl:string; sourceMediaType:string; sourceItemId:string; sourceItemsRaw:string; sourceSettingsRaw:string; sourceHashPresent:boolean; sourceMediaSha256:unknown; sourceEventId:string; sourceRaw:string; sourceRevision:number };
type Model3dScaleObservation = { artifactId:string; request:Model3dScaleEditRequest; contentRef:string; documentId:string; projectId:string; route:string; ownerUserId:string;
  sourceMediaUrl:string; sourceMediaSha256:string; sourceMediaByteLength:number; sourceFileRaw:string; sourceRootMediaUrl:unknown; sourceRootMediaType:unknown;
  sourceItemsRaw:string; sourceSettingsRaw:string; sourceEventId:string; sourceRaw:string; sourceRevision:number };
type GeneratedImageWriteObservation = {ownerId:string;projectId:string;documentId:string;outputId:string;route:string;rawJson:string;request:GeneratedImageEditRequest;operationSha256:string;width:number;height:number;output:import("../model/events").CreativeOutput};
type EventWriteObservation = { source:CapturedSourceOwnership|null; read:EventSourceRead|null; receipt:EventWriteAcknowledgment; pending:boolean; delivered:boolean; signature:string|null; attempted:boolean; paused:boolean; streamId:string; actor:string; audioTrim?:AudioTrimObservation; videoTrim?:VideoTrimObservation; imageEdit?:GeneratedImageWriteObservation; model3dScale?:Model3dScaleObservation };
const EVENT_WRITE_SCOPE_CAPACITY=32, EVENT_WRITE_STORE_CAPACITY=128;
export type PilotSession = {
  user: { userId: string; email: string; displayName: string; role: "admin" | "creator" | "agent" | "viewer"; consentVersion: string | null; consentedAt: string | null };
  impersonation: { active:true; impersonationId:string; personaId:string; replaySessionId:string; actor:{userId:string;email:string;displayName:string;role:"admin"|"creator"|"agent"|"viewer"}; fictionalUser:{userId:string;email:string;displayName:string;role:"admin"|"creator"|"agent"|"viewer"}; startedAt:string; expiresAt:string } | null;
  policy: { version: string; accepted: boolean; passiveCapture: false; attentionCapture?: { available: boolean; defaultOn: false; retentionDays: number; rawInputCapture: false }; externalAssetsRequireAssertion: true; retentionDays: number; evidenceRetentionDays?:number; sharing: string };
  canvas: { version:string; mode:"internal"|"pilot"; pilotAvailable:boolean; access:boolean; accessReason:"administrator-internal-review"|"pilot-approved"|"pilot-gate-incomplete"|"role-not-eligible"; blockedBy:Array<"trust_safety"|"counsel"|"second_image_adapter">; requirements:Array<{id:"trust_safety"|"counsel"|"second_image_adapter";label:string;summary:string;approved:boolean;approvedBy:string|null;approvedByUserId:string|null;approvedAt:string|null;evidenceRef:string|null;details:Record<string,unknown>}> };
  provider: { name: string; model: string; plannerModel?: string; plannerConfigured?: boolean; configured: boolean; imageProvider?:string; imageProviders?:Array<{provider:string;model:string;previewModel?:string;editModel?:string;configured:boolean}>; videoProvider?:string; videoModel?:string; videoReferenceModel?:string; videoAdapterVersion?:string; videoConfigured?:boolean; model3dConfigured?:boolean; model3dModel?:string; model3dReferenceModel?:string; videoApiSunset?:string|null; audioProvider?:string; audioModel?:string; audioConfigured?:boolean; audioModels?:Array<{model:string;label:string;capabilities:readonly string[];maximumDurationSeconds:number;pricing:{mode:string;amountMicrousd:number;minimumBillableSeconds?:number}}> };
  budgets: { period: string; user: { used: number; reserved: number; limit: number }; workspace: { used: number; reserved: number; limit: number } };
  costBudgets: GenerationCostBudgets;
  audience?: ApplicationId;
  capabilities?: FormaCapability[];
  permissionEpoch?: string;
  assistant?: {
    enabled: true;
    phase: "read-only" | "actions";
    capabilities: Array<"project.assistant.read" | "project.assistant.propose">;
    models?: Array<{ id: "gpt-5.6-luna" | "gpt-5.6-terra" | "gpt-5.6-sol"; maximumMicrousd: number; premiumApprovalRequired: boolean }>;
  };
  organizations?: Array<{ organizationId: string; name: string; role: string }>;
  projects?: Array<{organizationId:string;projectAccessId:string;projectId:string;projectName:string;role:string}>;
  projectContext?:{organizationId:string;projectAccessId:string;projectId:string;ownerUserId:string;role:string;permissions:FormaCapability[];expiresAt:string;managedPilot?:boolean};
};
export type ShareRecord = { shareId: string; token?: string; resourceKind?: string; resourceId?: string; projectId?: string; expiresAt: string; revokedAt?: string | null; createdAt?: string; active: boolean };
export type CapturedAuthorizationScope = { key:string; shared:boolean };
export type ActivityIssueNote={id:string;body:string;createdAt:string;expiresAt:string};
export type ProjectNotification={id:string;kind:string;artifactId:string|null;documentId:string|null;message:string;createdAt:string;readAt:string|null};
export type OrganizationContextPackage={id:string;name:string;description:string;status:string;versionId:string|null;version:number|null;versionStatus?:string|null;createdByUserId?:string|null;pendingDraftVersionId?:string|null;pendingDraftVersion?:number|null;pendingDraftContentSha256?:string|null;canApprove?:boolean;draftPreview?:Array<{handle:string;type:string;text:string;locked:boolean;intent:string;active:boolean;exactText:string|null;exactPlacements:string[];protectedPhrases:Array<{text:string;placement:string|null}>;relations:Array<{kind:string;targetHandle:string}>;sourceName:string|null;rightsExpiresAt:string|null}>;contentSha256:string|null;publishedAt:string|null;publishedByUserId:string|null;blockCount:number;bindingCount:number;createdAt:string;updatedAt:string};
export type OrganizationContextBinding={id:string;organizationId:string;projectAccessId:string;documentId:string;packageId:string;versionId:string;pendingVersionId:string|null;updateMode:"pinned"|"follow-approved";status:string};
export type OrganizationContextVersion={id:string;version:number;sourceProjectAccessId:string;sourceDocumentId:string;blocks:Array<{sourceBlockId:string;type:string;handle:string;contentSha256:string;locked:boolean;source?:{contentSha256:string;originalName:string}}>;relations:Array<{fromSourceBlockId:string;toSourceBlockId:string;kind:string;properties?:Record<string,unknown>}>};
export type AssignedReviewTask={id:string;organizationId:string;organizationName:string;projectAccessId:string;projectId:string;projectName:string;documentId:string;documentTitle:string;artifactId:string;artifactTitle:string;artifactKind:string;revision:number;contentSha256:string;status:string;dueAt:string|null;createdAt:string;requestedByUserId:string;requestedByName:string};
export type ArtifactRevisionSummary={revision:number;sha256:string;createdByUserId:string;createdAt:string;expiresAt:string;available:boolean;current:boolean};
export type ArtifactRevisionDetail={revision:number;currentRevision:number;createdAt:string;content:{markdown:string;items:Array<{title:string;body:string;notes:string}>}};
export type PlanningConsentRequest={prompt:string;projectId:string;documentId:string;canvasId:string|null;sourceSurface:string;projectScope:boolean;locale:string;requestKey:string};
export type PlanningConsentState={id:string;request:PlanningConsentRequest;quote:AvailableConsequentialPreview|null;working:boolean;notice:""|"failed"|"refresh"|"not-submitted"|"uncertain";submitted:boolean;recoveryExecutionId?:string;replaceExecutionId?:string;recoveredPlan?:AdaptiveStructure;readRevision?:number};
type AdaptiveOriginalProof=Readonly<{source:CapturedSourceOwnership;quote:AvailableConsequentialPreview;structure:AdaptiveStructure;
  identity:PlanningRecoveryIdentity;readRevision:number;certifiedRevision:number}>;
type CachedDocumentJobDetail=DocumentJob&{adaptiveOriginalProof?:AdaptiveOriginalProof};
type PlanningOriginalSourceRead=Readonly<{executionId:string;request:PlanningConsentRequest;source:CapturedSourceOwnership;
  authorization:string;current:()=>boolean}>;

export type SceneSubmissionResult={requestId:string;job:DocumentJob|null;preview:SceneCostPreview|null;reused:boolean;attemptSubmission:"not-submitted"|"submitted"|"unknown"};
export type SceneSubmissionPorts={current?:()=>boolean;onDispatch?:()=>void;onResult?:(result:SceneSubmissionResult)=>void};
export type SceneGenerationReceiptReadOptions={documentId:string;fresh:true;current?:()=>boolean};
export type SceneGenerationReceiptInspection={job:DocumentJob;content:Record<string,string>};
function sceneCostJobMatches(value:unknown,requestId:string,documentId:string):value is DocumentJob{
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  const job=value as DocumentJob;
  return job.jobId===requestId&&job.documentId===documentId&&job.kind==="render_document"
    &&["queued","running","committing","completed","failed","partial","canceled"].includes(job.status);
}

/** An ephemeral navigation handle, never a cached plan, financial receipt, or new request. */
export type PlanningRecoveryIdentity=Pick<DocumentJob,"jobId"|"documentId"|"canvasId"|"planningExecutionId"|"planningProjectScope"|"planningLocale">&{kind:"structure_adaptive";sourceSurface?:string;requestKey?:string};


/** Check transport shape before private certification; business/readiness rules remain in their existing models. */
function outputSnapshotRenderable(value: unknown): value is OutputRequirementsSnapshot {
  const record = (entry: unknown): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry);
  const text = (entry: unknown): entry is string => typeof entry === "string";
  const number = (entry: unknown) => typeof entry === "number" && Number.isFinite(entry);
  const boolean = (entry: unknown) => typeof entry === "boolean";
  const list = (entry: unknown, accepts: (item: unknown) => boolean) => Array.isArray(entry) && entry.every(accepts);
  const texts = (entry: unknown) => list(entry, text);
  const optional = (entry: unknown, accepts: (item: unknown) => boolean) => entry === undefined || entry === null || accepts(entry);
  const fields = (entry: Record<string, unknown>, names: readonly string[], accepts: (item: unknown) => boolean) => names.every(name => accepts(entry[name]));
  const values = (entry: unknown, accepts: (item: unknown) => boolean) => record(entry) && Object.values(entry).every(accepts);
  const issue = (entry: unknown) => record(entry) && fields(entry, ["code", "path", "message"], text);
  const quantity = (entry: unknown) => record(entry) && text(entry.unit) && (entry.kind === "unknown" && optional(entry.reason, text)
    || entry.kind === "exact" && number(entry.value) || entry.kind === "range" && fields(entry, ["min", "max"], number));
  const policy = (entry: unknown) => record(entry) && text(entry.unit) && (entry.kind === "exact" && number(entry.value)
    || entry.kind === "flexible" && fields(entry, ["min", "max"], number) && optional(entry.aim, number));
  const options = (entry: unknown) => record(entry) && optional(entry.selected_optional_ids, texts) && optional(entry.selected_target_ids, texts)
    && optional(entry.count_policies, item => values(item, policy)) && optional(entry.suggested_counts, item => values(item, number));
  const source = (entry: unknown) => record(entry) && (entry.kind === "document" || entry.kind === "blocks" && texts(entry.block_ids)
    || entry.kind === "unknown" && text(entry.reason));
  const coverage = (entry: unknown) => record(entry) && (entry.kind === "document_context" || entry.kind === "document_outline"
    || entry.kind === "topics" && texts(entry.topics) || entry.kind === "unresolved" && text(entry.description));
  const requirement = (entry: unknown) => record(entry) && fields(entry, ["blockId", "subtype", "content"], text) && boolean(entry.locked)
    && text(entry.status) && ["valid", "invalid", "unsupported", "draft"].includes(entry.status)
    // The established editable-draft validator preserves label-only errors. Invalid/unsupported
    // requirements keep their null spec and uninterpreted preserved body for the existing editor.
    && (entry.spec === null || outputRequirementEditableDraft(entry.spec) !== null)
    && list(entry.issues, issue) && optional(entry.planSuggestions, options);
  const target = (entry: unknown) => record(entry)
    && fields(entry, ["id", "requirement_id", "deliverable_id", "obligation_id", "label", "media_kind", "instruction_text", "source_revision", "requirement_revision"], text)
    && fields(entry, ["required", "selected"], boolean) && number(entry.ordinal)
    && fields(entry, ["variant_id", "member_id"], item => optional(item, text)) && quantity(entry.quantity)
    && optional(entry.aspect_ratio, item => record(item) && fields(item, ["width", "height"], number))
    && source(entry.source_scope) && coverage(entry.coverage) && optional(entry.content_quantity, quantity)
    && optional(entry.count_policy, policy) && optional(entry.suggested_count, number) && list(entry.blocking_issues, issue);
  const plan = (entry: unknown) => record(entry) && entry.schema_version === 1 && fields(entry, ["document_id", "source_revision", "requirement_revision"], text)
    && list(entry.groups, item => record(item) && fields(item, ["id", "requirement_id", "label", "media_kind"], text) && boolean(item.required) && texts(item.obligation_ids))
    && list(entry.obligations, item => record(item) && fields(item, ["id", "requirement_id", "deliverable_id", "label", "media_kind", "resolution"], text)
      && fields(item, ["variant_id", "member_id"], child => optional(child, text)) && fields(item, ["required", "selected"], boolean)
      && quantity(item.quantity) && optional(item.quantity_policy, policy) && texts(item.target_ids))
    && list(entry.targets, target)
    && list(entry.unresolved_groups, item => record(item) && fields(item, ["id", "requirement_id", "label"], text)
      && fields(item, ["deliverable_id", "obligation_id"], child => optional(child, text)) && fields(item, ["required", "selected"], boolean) && list(item.issues, issue))
    && list(entry.issues, issue);
  const confirmed = (entry: unknown) => record(entry) && fields(entry, ["id", "revisionId", "confirmedAt", "requirementsDigest", "sourceDigest"], text)
    && number(entry.revision) && plan(entry.plan)
    // These legacy/partial contracts already disable the exact paid/review controls; missing is not a malformed body.
    && optional(entry.targetContractDigests, item => values(item, text)) && optional(entry.confirmationOptions, options);
  const targetState = (entry: unknown) => record(entry)
    && fields(entry, ["target_id", "execution", "checks", "review", "freshness", "availability", "capability", "source_revision", "requirement_revision"], text)
    && boolean(entry.export_available) && optional(entry.result_id, text);
  const summary = (entry: unknown) => record(entry) && fields(entry, ["completion", "headline"], text) && fields(entry, ["scope_known", "delivery_ready"], boolean)
    && fields(entry, ["required_groups", "fulfilled_required_groups", "required_obligations", "optional_obligations", "selected_optional_obligations",
      "fulfilled_required_obligations", "fulfilled_selected_optional_obligations", "required_targets", "optional_targets", "selected_targets", "fulfilled_targets",
      "unresolved_required_groups", "unresolved_selected_optional_groups", "unknown_target_states"], number)
    && texts(entry.reasons) && list(entry.next_actions, item => record(item) && fields(item, ["kind", "label", "reason"], text)
      && optional(item.target_id, text) && optional(item.group_id, text));
  const inspection = (entry: unknown) => record(entry) && text(entry.status) && fields(entry, ["kind", "mimeType", "extension", "sha256"], item => optional(item, text))
    && number(entry.byteLength) && record(entry.facts)
    && fields(entry, ["checks", "limitations", "errors"], texts) && optional(entry.limitationCodes, texts)
    && fields(entry.facts, ["width", "height", "codedWidth", "codedHeight", "durationSeconds", "sampleRate", "channels", "sampleCount", "frameCount",
      "slideCount", "hiddenSlideCount", "slideWidthEmu", "slideHeightEmu", "rotationDegrees", "externalHyperlinkCount"], item => optional(item, number))
    && fields(entry.facts, ["durationBasis", "codec", "audioCodec"], item => optional(item, text));
  const asset = (entry: unknown) => record(entry) && fields(entry, ["id", "name", "mimeType", "mediaKind", "sha256", "sourceDigest", "createdByUserId", "createdAt", "downloadUrl"], text)
    && number(entry.byteLength) && boolean(entry.available) && inspection(entry.inspection);
  const result = (entry: unknown) => record(entry)
    && fields(entry, ["id", "targetId", "planRevisionId", "assetId", "resultRevision", "targetContractDigest", "sourceDigest", "sha256", "checksStatus", "createdByUserId", "createdAt", "review"], text)
    && texts(entry.checks) && texts(entry.problems) && optional(entry.acceptanceId, text)
    && optional(entry.reviewAllowed, boolean) && optional(entry.independentReviewBlocked, boolean);
  // Missing/unknown historical accounting is not zero. Keep primitive values untouched for
  // the existing strict accounting/recovery helpers; never let an arbitrary object render as a receipt.
  const accounting = (entry: Record<string, unknown>) => fields(entry, ["maximumMicrousd", "maximumCalls", "usedMicrousd", "exposedMicrousd", "usedCalls", "pendingCalls"],
    item => item === undefined || item === null || ["number", "string", "boolean"].includes(typeof item));
  const offered = (entry: unknown) => record(entry) && text(entry.targetId) && optional(entry.available, boolean)
    && fields(entry, ["reason", "reasonCode", "transferCode", "provider", "model", "route", "transferDescription"], item => optional(item, text))
    && optional(entry.reasonValues, item => values(item, child => text(child) || number(child))) && optional(entry.settings, record) && accounting(entry);
  const disclosure = (entry: unknown) => record(entry) && list(entry.targets, offered)
    && fields(entry, ["id", "planRevisionId", "termsDigest", "sourceDigest", "requirementsDigest", "expiresAt", "createdAt"], item => optional(item, text))
    && accounting(entry) && optional(entry.operationAttempts, item => values(item, child => record(child) && number(child.ordinal) && optional(child.previousSlotId, text)));
  const grant = (entry: unknown) => record(entry) && fields(entry, ["id", "planRevisionId", "actorUserId", "status"], text)
    && optional(entry.payerUserId, text) && optional(entry.expiresAt, text) && accounting(entry) && optional(entry.disclosure, disclosure)
    && list(entry.operations, item => record(item) && fields(item, ["id", "targetId", "jobId", "status"], text) && optional(item.targetLabel, text) && accounting(item));
  const amendment = (entry: unknown) => record(entry) && fields(entry, ["eventId", "previousPlanRevisionId", "planRevisionId", "actorUserId", "occurredAt", "reason"], text)
    && texts(entry.withdrawnTargetIds) && texts(entry.withdrawnObligationIds);
  return record(value) && value.schemaVersion === 1 && fields(value, ["documentId", "projectId", "revision", "requirementRevision", "sourceRevision"], text)
    && record(value.scope) && text(value.scope.kind) && ["personal", "project"].includes(value.scope.kind) && text(value.scope.actorUserId)
    && fields(value.scope, ["organizationId", "projectAccessId"], item => optional(item, text))
    && record(value.permissions) && fields(value.permissions, ["canAuthor", "canRequest", "canReview", "canDownload", "independentReview"], boolean)
    && record(value.capabilities) && fields(value.capabilities, ["nativeGeneration", "ownedFileAdoption"], boolean)
    && fields(value.capabilities, ["supportedFileExtensions", "limitations"], texts) && optional(value.capabilities.limitationCodes, texts)
    && list(value.requirements, requirement) && (value.confirmedPlan === null || confirmed(value.confirmedPlan))
    && list(value.targetStates, targetState) && (value.summary === null || summary(value.summary))
    && optional(value.requirementSummaries, item => values(item, child => child === null || summary(child)))
    && optional(value.requirementFileCounts, item => values(item, child => child === null || number(child)))
    && list(value.assets, asset) && list(value.results, result) && list(value.grants, grant) && optional(value.scopeAmendments, item => list(item, amendment));
}

export class FormaStore {
  readonly attentionPublication = new AttentionPublicationGate();
  /** A transient request to review existing ledger Undo, not a second history/queue. */
  readonly canvasArrangementUndoRequest = new Signal.State<{ eventId: string; operationId: string; projectId: string; canvasId: string; authorityKey: string } | null>(null);
  readonly outputRequirements = new OutputRequirementsClient<OutputRequirementsSnapshot>({
    captureScope: () => {
      const scope = this.captureAuthorizationScope();
      return scope ? { key: scope.key, projectId: this.#outputSourceProjectId() } : null;
    },
    scopeActive: (scope) => this.captureAuthorizationScope()?.key === scope.key && this.#outputSourceProjectId() === scope.projectId,
    captureSourceOwnership: () => this.captureSourceOwnership(),
    sourceOwnershipActive: (source) => this.sourceOwnershipActive(source),
    sourceOwnershipScopeActive: (source) => this.sourceOwnershipScopeActive(source),
    fetch: (input, init, action) => this.guardedFetch(input, init, action),
    isSnapshot: (value, documentId, scope): value is OutputRequirementsSnapshot => {
      if (!outputSnapshotRenderable(value)) return false;
      const candidate = value;
      return candidate.schemaVersion === 1 && candidate.documentId === documentId && candidate.projectId === scope.projectId
        && typeof candidate.revision === "string" && Array.isArray(candidate.requirements)
        && candidate.scope?.actorUserId === this.session.get()?.user.userId
        && candidate.scope?.projectAccessId === (this.session.get()?.projectContext?.projectAccessId ?? null);
    },
    notify: () => this.notify(),
  });
  readonly events = new Signal.State<CreativeEvent[]>([]);
  readonly optimisticEvents = new Signal.State<CreativeEvent[]>([]);
  readonly eventView = new Signal.Computed<CreativeEvent[]>(() => [...this.events.get(),...this.optimisticEvents.get()]);
  readonly head = new Signal.State(0);
  readonly loading = new Signal.State(true);
  readonly busy = new Signal.State("");
  readonly error = new Signal.State("");
  readonly appendFailure = new Signal.State("");
  readonly asOf = new Signal.State(Number.POSITIVE_INFINITY);
  readonly replayEvents = new Signal.State<CreativeEvent[]>([]);
  readonly replayAsOf = new Signal.State(0);
  readonly route = new Signal.State(`${location.pathname}${location.search}${location.hash}`);
  // This directly constructed State uses its default string comparator. Keep
  // its genuine identity/methods for the narrow post-write exception witness;
  // a replaced Signal or method supplies no such evidence.
  #nativeImageRouteSignal=Object.freeze({signal:this.route,get:this.route.get,set:this.route.set});
  readonly session = new Signal.State<PilotSession | null>(null);
  readonly content = new Signal.State<Record<string, string>>({});
  readonly shares = new Signal.State<ShareRecord[]>([]);
  readonly projectNotifications = new Signal.State<ProjectNotification[]>([]);
  readonly organizationContextPackages = new Signal.State<OrganizationContextPackage[]>([]);
  readonly organizationContextBindings=new Signal.State<OrganizationContextBinding[]>([]);
  readonly organizationContextVersions=new Signal.State<Record<string,OrganizationContextVersion>>({});
  #organizationCatalogReadSequence=0;
  #organizationCatalogDeniedThrough=0;
  #organizationCatalogCompletedRead=0;
  readonly reviewInbox = new Signal.State<AssignedReviewTask[]>([]);
  readonly reviewInboxState = new Signal.State<"idle"|"loading"|"ready"|"error"|"unavailable">("idle");
  #reviewInboxReadSequence=0;
  #reviewInboxCompletedRead=0;
  #reviewInboxDeniedThrough=0;
  readonly documentJobs = new Signal.State<DocumentJob[]>([]);
  readonly generationReadiness = new Signal.State<Record<string,GenerationReadiness>>({});
  readonly adaptiveStructures = new Signal.State<Record<string,AdaptiveStructure>>({});
  readonly planningConsent = new Signal.State<PlanningConsentState|null>(null);
  // Ephemeral UI recovery only: no background copy execution or browser persistence.
  readonly documentCopyReviews = new Signal.State<Record<string,OwnedDocumentCopyReview>>({});
  #documentCopyRequest=0;
  readonly adaptiveSuggestionSets = new Signal.State<Record<string,AdaptiveSuggestionSet[]>>({});
  readonly canvasPlanningChoices = new Signal.State<Record<string,string>>({});
  readonly canvasPlanningSelection = new Signal.State({scope:"",canvasId:"",itemIds:[] as string[]});
  readonly ui = new SignalObject({ inspectorOpen: false, commandOpen: false, accountOpen: false, shareOpen: false, compareOpen: false, projectRailCollapsed: window.matchMedia?.("(max-width: 75rem), (max-height: 37.5rem)")?.matches ?? false, instrumentation: true, attentionCapture: readAttentionPreference(), attentionPaused: false, impersonationConfirmOpen:false, impersonationAction:"", selectedEventId: "", selectedOutputId: "", comparisonOutputIds: "", focusBlockId: "", focusCollectionId: "", editingBlockId: "", libraryView: "all", libraryOutputScope: "recent", search: "", toast: "", toastPresentation: "overlay" as "overlay"|"inline" });
  #toastTimer?:number;
  #toastRevision=0;
  readonly projection = new Signal.Computed<CreativeProjection>(() => {
    const route = this.route.get(), taskDocumentId = projectTaskDocumentIdFromRoute(route);
    const addressedDocumentId=isDocumentViewRoute(route)?documentIdFromRoute(route):null;
    const canvasId = canvasIdFromRoute(route) ?? "", events = this.eventView.get();
    const projection = foldEvents(events, this.asOf.get(), isDocumentViewRoute(route) ? documentIdFromRoute(route) ?? "" : taskDocumentId ?? "", canvasId ? canvasProjectId(events, canvasId) : "");
    if(addressedDocumentId&&projection.documentId!==addressedDocumentId)
      return {...foldEvents([]),projects:projection.projects};
    if (isProjectTaskRoute(route)) {
      const session = this.session.get(), context = session?.projectContext;
      const readable = Boolean(session && (!context || context.projectId === projection.projectId && context.permissions.includes("project.read") && Date.parse(context.expiresAt) > Date.now()));
      // A claimed task Document is a view address, never permission or a reason
      // to substitute another project's history while its source is unavailable.
      if (!readable || taskDocumentId !== null && (!taskDocumentId || projection.documentId !== taskDocumentId))
        return { ...foldEvents([]), projects: readable ? projection.projects : [] };
    }
    return projection;
  });
  readonly canvasProjection = new Signal.Computed<CanvasProjection>(() => foldCanvasEvents(this.eventView.get(),this.projection.get().projectId,canvasIdFromRoute(this.route.get())??""));
  readonly replayProjection = new Signal.Computed<CreativeProjection>(() => foldEvents(this.replayEvents.get(), this.replayAsOf.get()));
  #sourceGeneration=0;
  #sourceRetired=false;
  #retiredSourceProjectId:string|null=null;
  #sourceOwners=new WeakMap<CapturedSourceOwnership,string|null>();
  #sourceReadSequence=0;
  #sourcePublishedRead=0;
  #sourceContentReadIds=new Map<string,number>();
  #sourceCertifiedCoverage=new Map<AccountSnapshotProfile,{id:number;source:CapturedSourceOwnership}>();
  #sourcePausedJobs=new Map<string,string>();
  #eventWriteObservations=new Map<string,EventWriteObservation>();
  #listeners = new Set<Listener>();
  #nativeImageEpoch:object=Object.freeze({});
  #nativeImageAdmissionHolds=0;
  #nativeImageCohort:NativeImageSemanticCohort|null=null;
  #nativeImageLifetimes=new Set<NativeImageLifetimeRecord>();
  #nativeImageRetirements:NativeImageLifetimeRecord[]=[];
  #nativeImageNotificationHolds=0;
  #undo: HistoryGroup[] = [];
  #redo: HistoryGroup[] = [];
  #rememberedClientEventIds = new Set<string>();
  #appendPipeline:Promise<void> = Promise.resolve();
  #navigationCommit:Promise<boolean>|null=null;
  #workspaceNavigationOwners=new WeakMap<WorkspaceNavigationOptions,WorkspaceNavigationOwner>();
  #nativeImageWorkspaceStartup:NativeImageWorkspaceStartupDispatcher|null=null;
  #workspaceTransition=0;
  #projectContextHandshake:Promise<void>|null=null;
  #projectContextLatest:ProjectContextCookieRequest|null=null;
  #projectContextCookieGeneration=0;
  #projectContextSessionGeneration=0;
  #projectTaskExpiry: { timer: number } | null = null;
  #workspaceNavigationFocus: { route:string; focus:OutputNavigationFocusLease; revision:number } | null = null;
  #outputInputReveal:{cancel:()=>void}|null=null;

  captureWorkspaceNavigationFocus(route:string,expected?:OutputNavigationFocusLease) {
    const owner=this.#workspaceNavigationFocus;
    if(!owner||owner.route!==route||(expected&&owner.focus!==expected))return null;
    return {focus:owner.focus,
      routeCurrent:()=>this.#workspaceNavigationFocus===owner&&this.route.get()===route&&this.#workspaceTransition===owner.revision,
      current:()=>this.#workspaceNavigationFocus===owner&&this.route.get()===route&&owner.focus.current()};
  }
  #loadRevision=0;
  #cachedHistoryRevalidation:Promise<void>|undefined;
  #sessionRevision=0;
  #focalInFlight = new Set<string>();
  #focalAppendQueue: Promise<void> = Promise.resolve();
  #jobPollTimer = 0;
  #collaborationPollTimer = 0;
  #jobFeedRevision = 0;
  #initialListReadActive:NativeImageListReadClaim|null=null;
  #initialListReadPending:NativeImageListReadClaim|null=null;
  #initialListReadPump:object|null=null;
  #jobPollFailures = 0;
  #jobPollIssueNotified = false;
  #pendingJobEventRefresh = false;
  #pendingJobSessionRefresh = false;
  #jobsDriving = new Set<string>();
  #presentationRecoveryAttempts = new Set<string>();
  #jobDetails = new Map<string, CachedDocumentJobDetail>();
  #jobStarts = new Set<string>();
  #readinessInFlight = new Set<string>();
  #readinessAcknowledgements = new Set<string>();
  #pendingJobNotices: DocumentJob[] = [];
  #pendingAdaptiveIntents = new Map<string,string>();
  #adaptiveStructureJobIds = new Map<string,string>();
  #planningRecoveryIdentities = new Map<string,{authorization:string;identity:PlanningRecoveryIdentity;revision:number;recoverable:boolean;selectOnCompletion?:boolean;presentationLocaleRevision?:number;deliberateReadRevision?:number;pendingReadRevision?:number;certifiedReadRevision?:number;preservedReadRevision?:number;detailRevision?:number;terminalReadRevision?:number;withdrawalRevision?:number;withdrawalReadRevision?:number;terminalRevision?:number;terminalStatus?:DocumentJob["status"];terminalReceipt?:string}>();
  #planningRecoverySequence=0;
  #planningLocaleRevision=0;
  #planningConsentScope="";
  #planningConsentRoute="";
  #planningConsentResolve?: (accepted:boolean)=>void;
  #dismissedAdaptiveSuggestions = new Set<string>();
  #impersonationConfirmation?: (confirmed:boolean)=>void;
  #historyProfile: AccountSnapshotProfile = "full";
  #historyUpgrade?: Promise<void>;
  #contentHydration?: Promise<void>;
  #privateContentScope:"none"|"chat"|"memory"|"all"="none";
  #pendingPassiveJobPath="";
  #focalBackfillTimer = 0;

  constructor(){
    document.addEventListener("visibilitychange",()=>{if(document.visibilityState!=="visible"||!this.session.get()){window.clearTimeout(this.#collaborationPollTimer);return;}if(this.events.get().length){this.#flushPendingJobNotices();this.#syncVisibleJobs();}this.#scheduleCollaborationPoll(0);});
    document.addEventListener("forma-locale-change",(event)=>{
      if(event.target!==document)return;
      this.#planningLocaleRevision++;
      for(const job of this.documentJobs.get())if(job.kind==="structure_adaptive")this.#dismissedAdaptiveSuggestions.add(job.jobId);
      for(const entry of this.#planningRecoveryIdentities.values()){this.#dismissedAdaptiveSuggestions.add(entry.identity.jobId);delete entry.selectOnCompletion;delete entry.presentationLocaleRevision;}
      const review=this.planningConsent.get();
      for(const id of[review?.quote?.executionId,review?.recoveryExecutionId,review?.replaceExecutionId])if(id)this.#dismissedAdaptiveSuggestions.add(id);
      this.#adaptiveStructureJobIds.clear();this.adaptiveStructures.set({});this.adaptiveSuggestionSets.set({});this.notify();
    });
    window.addEventListener("forma-performance",()=>{if(!this.#pendingPassiveJobPath||this.route.get()!==this.#pendingPassiveJobPath||document.documentElement.dataset.formaPhase!=="populated")return;this.#pendingPassiveJobPath="";this.#scheduleJobPoll(1_200);});
  }

  #scheduleCollaborationPoll(delay=30_000){
    window.clearTimeout(this.#collaborationPollTimer);
    if(!this.session.get()||document.visibilityState==="hidden")return;
    this.#collaborationPollTimer=window.setTimeout(()=>{
      const session=this.session.get();
      if(!session||document.visibilityState==="hidden")return;
      const authorization=this.#authorizationScope(session);
      const refreshes=[this.syncReviewInbox(),...(session.projectContext?[this.refreshEvents(),this.syncProjectNotifications(),this.syncOrganizationContextPackages()]:[])];
      void Promise.allSettled(refreshes).finally(()=>{if(this.#scopeStillActive(authorization))this.#scheduleCollaborationPoll();});
    },delay);
  }

  subscribe(listener: Listener) { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }
  notify() {
    return this.#nativeImageMutation(()=>{
    this.#reconcileNativeImageScopes();
    if(this.planningConsent.get()&&(!this.#scopeStillActive(this.#planningConsentScope)||this.route.get()!==this.#planningConsentRoute))this.#finishPlanningConsent(false);
    this.#listeners.forEach((listener) => listener());
    });
  }
  #publishAppended(events:CreativeEvent[],read?:EventSourceRead,readOnly=false){
    return this.#nativeImageMutation(()=>{
    this.#reconcileNativeImageScopes();
    if(this.#sourceRetired)return;
    if(events.length&&!read)this.#sourcePublishedRead=++this.#sourceReadSequence;
    // Output commands compare the whole owner-stream revision, not only source
    // edits. Even a publication with no fresh event bodies can advance that head.
    // Keep the local source-read fence above the synchronous cache notification.
    this.outputRequirements.invalidate();
    if(!events.length)return;
    const session=this.session.get();if(session&&events.some((event)=>event.type==="AttentionSignalsForgotten"))void clearAnalyticsSnapshots(this.#snapshotIdentity(session),true);
    if(readOnly)return;
    if(!read&&!session?.impersonation)warmCompletedVideoCovers(events);
    if(session?.projectContext&&events.some((event)=>["ArtifactReviewRequested","ArtifactApproved","ArtifactChangesRequested","DocumentArtifactEdited","DocumentRenderCompleted","BlockCreated","BlockPropertyEdited","BlockRemoved","BlockRestored","BlockRelationAdded","BlockRelationRemoved","RightsAsserted"].includes(event.type))){void this.syncProjectNotifications();void this.syncReviewInbox();}
    else if(session?.projectContext&&events.some((event)=>event.type==="OutputRenamed"))void this.syncReviewInbox();
    window.dispatchEvent(new CustomEvent("forma-events-appended",{detail:{events}}));
    const needsImageMaintenance=events.some((event)=>["GenerationCompleted","IdeationPreviewCompleted","DocumentRenderCompleted","ReferenceIngested","BlockCreated"].includes(event.type));
    if(needsImageMaintenance&&!this.session.get()?.impersonation){
      window.clearTimeout(this.#focalBackfillTimer);
      this.#focalBackfillTimer=window.setTimeout(()=>this.#backfillImageFocalPoints(),3_000);
    }
    });
  }
  #hasFocalPoint(targetKind:"generation"|"reference"|"artifact",targetId:string){const projection=this.projection.get();const point=targetKind==="generation"?(projection.libraryOutputs.find((output)=>output.id===targetId)?.focalPoint??projection.outputs.find((output)=>output.id===targetId)?.focalPoint):targetKind==="artifact"?projection.libraryArtifacts.flatMap((artifact)=>artifact.items).find((item)=>item.id===targetId)?.focalPoint:normalizeImageFocalPoint(projection.libraryBlocks.find((block)=>block.id===targetId)?.properties.focal_point??projection.blocks.find((block)=>block.id===targetId)?.properties.focal_point);return point?.method===CURRENT_FOCAL_POINT_METHOD;}
  #backfillImageFocalPoints(){
    const projection=this.projection.get();const seen=new Set<string>();
    for(const output of [...projection.outputs,...projection.libraryOutputs])if(output.mediaUrl&&String(output.mediaType??"").startsWith("image/")&&output.focalPoint?.method!==CURRENT_FOCAL_POINT_METHOD&&!seen.has(`generation:${output.id}`)){seen.add(`generation:${output.id}`);void this.calculateImageFocalPoint({targetKind:"generation",targetId:output.id,mediaUrl:output.mediaUrl});}
    for(const item of projection.libraryArtifacts.flatMap((artifact)=>artifact.items))if(item.mediaUrl&&String(item.mediaType??"").startsWith("image/")&&item.focalPoint?.method!==CURRENT_FOCAL_POINT_METHOD&&!seen.has(`artifact:${item.id}`)){seen.add(`artifact:${item.id}`);void this.calculateImageFocalPoint({targetKind:"artifact",targetId:item.id,mediaUrl:item.mediaUrl});}
    // Reference thumbnail placement is local display state. Background writes to
    // source blocks would invalidate retained drafts and their exact provenance.
  }
  #reflectDocumentInRoute() {
    const currentRoute = this.route.get();
    if (!isDocumentViewRoute(currentRoute)) return;
    const projection = this.projection.get();
    const canonicalRoute = withDocumentInRoute(currentRoute, projection.documentId, projection.documentTitle);
    if (projection.documentId && canonicalRoute !== currentRoute) this.setRoute(canonicalRoute, { replace: true });
  }
  #generationContext(documentId=this.projection.get().documentId,contextRootBlockId="",characterOutputKind:"headshot"|"character_sheet"="headshot",projection=this.projection.get()) {
    const documentBlocks=ideasInDocument(projection,documentId);
    let blocks=documentBlocks;
    if(contextRootBlockId){
      const selected=new Set([contextRootBlockId]),pending=[contextRootBlockId];
      while(pending.length){const parent=pending.pop()!;for(const relation of projection.libraryBlockRelations)if(isContextCompositionRelation(relation.kind)&&relation.fromBlockId===parent&&!selected.has(relation.toBlockId)){selected.add(relation.toBlockId);pending.push(relation.toBlockId);}}
      for(const block of documentBlocks)if(block.type==="exclusion"||blockIntentFor(block.type,block.properties)==="prohibit")selected.add(block.id);
      blocks=documentBlocks.filter((block)=>selected.has(block.id));
    }
    const factBlocks=blocks.filter((block)=>!isOutputContextBlock(block));
    const blockIds=new Set(factBlocks.map((block)=>block.id));const relations=projection.libraryBlockRelations.filter((relation)=>blockIds.has(relation.fromBlockId)&&blockIds.has(relation.toBlockId));const outputs=projection.libraryOutputs.filter((output)=>output.documentId===documentId);
    const facts=factBlocks.map((b)=>({block_id:b.id,document_id:b.documentId,type: b.type,role:b.type,intent: blockIntentFor(b.type, b.properties),handle:b.handle,position:b.position,locked:b.locked,active:Number(b.properties.weight??.5)>0,effect: blockEffectFor(b.type, b.properties),properties:{...b.properties,spatial_scope: normalizeSpatialScope(b.properties.spatial_scope)},authority:b.properties.authority??"authored",source_event_refs:b.sourceEvents}));
    const relationships=relations.map((relation)=>({relation_id:relation.id,from_block_id:relation.fromBlockId,to_block_id:relation.toBlockId,kind:relation.kind,properties:relation.properties,source_event_refs:relation.sourceEvents}));
    const context={
      snapshot:{facts,relationships,context_groups:combinedContextGroups({facts,relationships}),pins:outputs.filter((output)=>output.pinned&&(!contextRootBlockId||blocks.some((block)=>String(block.properties.source_output_id??"")===output.id))).map((output)=>output.id),...(contextRootBlockId?{context_scope:{kind:"character",root_block_id:contextRootBlockId,output_kind:characterOutputKind},character_study:{format:characterOutputKind,instruction:characterOutputKind==="character_sheet"?"Create one cohesive character sheet showing multiple consistent views of exactly this authored character.":"Create one shoulder-up headshot of exactly this authored character; preserve every specified facial and identity detail."}}:{}),tail:[]},
      sourceBlockVersions:blocks.map((b)=>({block_id:b.id,version:b.sourceEvents.length})),documentId,
    };
    return {...context,documentRevision:generationRevisionFor(context)};
  }
  documentJob(kind:DocumentJobKind,documentId=this.projection.get().documentId){return this.documentJobs.get().find((job)=>job.documentId===documentId&&job.kind===kind&&(job.status==="queued"||job.status==="running"||job.status==="committing"));}
  /** Local Source stability only. Native Output admission revalidates server source and custody. */
  experienceDocumentSourceCurrent(documentId:string,expectedRevision:string):boolean{
    const session=this.session.get(),projection=this.projection.get(),source=this.captureSourceOwnership();
    if(!session||session.impersonation||session.projectContext||!session.policy.accepted||!["creator","admin"].includes(session.user.role)
      ||!this.sourceOwnershipActive(source)||this.#projectContextCookieGeneration!==this.#projectContextSessionGeneration
      ||this.#cachedHistoryRevalidation||this.documentRouteState()!=="ready"||!this.routeDataReady()
      ||this.asOf.get()!==Number.POSITIVE_INFINITY||projection.documentId!==documentId)return false;
    const confirmed=foldEvents(this.events.get(),Number.POSITIVE_INFINITY,documentId);
    return this.#generationContext(documentId,"","headshot",confirmed).documentRevision===expectedRevision
      &&this.#generationContext(documentId).documentRevision===expectedRevision&&this.sourceOwnershipActive(source);
  }
  documentGenerationRevision(){return this.#generationContext().documentRevision;}
  documentModel3dAdaptation(documentId=this.projection.get().documentId,referenceCount=0):Model3dDocumentAdaptation{
    return adaptDocumentToModel3d(this.#generationContext(documentId).snapshot,{referenceCount});
  }
  promptTechniquePreference(){const projection=this.projection.get();const filed=projection.membership[projection.documentId];return effectivePromptPreference(projection.preferences,{documentId:projection.documentId,collectionIds:filed?[filed.collectionId]:[],projectId:projection.projectId,accountId:this.session.get()?.user.userId});}
  documentGenerationRequestKey(kind:"preview"|"generate",sourcePreviewId?:string|null,promptTechnique:PromptTechnique=this.promptTechniquePreference().technique,promptFanId?:string|null){return generationRequestKeyFor(kind,this.documentGenerationRevision(),sourcePreviewId,promptTechnique,promptFanId);}
  generationReadinessRequestKey(kind:GenerationReadinessKind,sourcePreviewId?:string|null,promptTechnique:PromptTechnique=this.promptTechniquePreference().technique,productionMode:ProductionMode="manual"){const revision=this.documentGenerationRevision();const base=kind==="preview"?generationRequestKeyFor("preview",revision,null,promptTechnique):kind==="generate"?generationRequestKeyFor("generate",revision,sourcePreviewId,promptTechnique):`prompt-fan:${kind==="preview_fan"?"preview":"generate"}:${revision}:${sourcePreviewId||"document"}`;return productionMode==="managed"?`${base}:managed`:base;}
  productionWorkflowGenerationRequestKey(workflowId:string,workflowStageId:string,workflowSources:ProductionWorkflowSource[],options:{sourcePreviewId?:string|null;promptTechnique?:PromptTechnique;productionMode?:ProductionMode}={}){const standard=this.generationReadinessRequestKey("generate",options.sourcePreviewId,options.promptTechnique??this.promptTechniquePreference().technique,options.productionMode??"manual");return`${standard}:workflow:${generationRevisionFor({workflowId,workflowStageId,sources:productionWorkflowSourceIdentity(workflowSources)})}`;}
  characterGenerationRequestKey(rootBlockId:string,kind:"headshot"|"character_sheet"="headshot"){const context=this.#generationContext(this.projection.get().documentId,rootBlockId,kind);return`${generationRequestKeyFor("generate",context.documentRevision,null,this.promptTechniquePreference().technique)}:character:${rootBlockId}:${kind}`;}
  generationReadinessFor(kind:GenerationReadinessKind,sourcePreviewId?:string|null,promptTechnique:PromptTechnique=this.promptTechniquePreference().technique,productionMode:ProductionMode="manual"){return this.generationReadiness.get()[this.generationReadinessRequestKey(kind,sourcePreviewId,promptTechnique,productionMode)]??null;}
  generationRiskAcknowledged(requestKey:string){return this.#readinessAcknowledgements.has(requestKey);}
  acknowledgeGenerationRisk(requestKey:string){this.#readinessAcknowledgements.add(requestKey);this.notify();}
  async ensureGenerationReadiness(kind:GenerationReadinessKind,options:{sourcePreviewId?:string|null;promptTechnique?:PromptTechnique;productionMode?:ProductionMode;sourceSurface?:string;force?:boolean;requestKey?:string;workflowId?:string;workflowStageId?:string;workflowSources?:ProductionWorkflowSource[];contextRootBlockId?:string;characterOutputKind?:"headshot"|"character_sheet"}={}){
    const sourceOwner=this.captureSourceOwnership();if(!this.sourceOwnershipActive(sourceOwner)){return null;}const authorization=this.#activeAuthorizationScope();const technique=normalizePromptTechnique(options.promptTechnique??this.promptTechniquePreference().technique);const productionMode=options.productionMode??"manual";const context=this.#generationContext(this.projection.get().documentId,options.contextRootBlockId,options.characterOutputKind);const requestKey=options.requestKey??this.generationReadinessRequestKey(kind,options.sourcePreviewId,technique,productionMode);if(this.#readinessInFlight.has(requestKey))return this.generationReadiness.get()[requestKey]??null;const existing=this.generationReadiness.get()[requestKey];if(existing&&!options.force&&Date.parse(existing.expiresAt)>Date.now())return existing;this.#readinessInFlight.add(requestKey);this.generationReadiness.set({...this.generationReadiness.get(),[requestKey]:existing?{...existing,status:"checking",summary:"Checking current generation readiness…"}:{preflightId:"",requestKey,documentId:context.documentId,documentRevision:context.documentRevision,kind,productionMode,promptTechnique:technique,status:"checking",summary:"Checking current generation readiness…",probes:[],provider:{status:"unknown",scope:"unknown",message:"Checking provider status.",observedAt:new Date().toISOString(),expiresAt:new Date().toISOString(),retryAfterMs:null,requestId:null},estimatedTokens:0,estimatedCostMicrousd:0,estimatedSeconds:0,requiresAcknowledgement:false,checkedAt:new Date().toISOString(),expiresAt:new Date().toISOString(),cached:false,version:"pending"}});this.notify();try{const response=await fetch("/api/generation-readiness",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...context,kind,requestKey,productionMode,sourcePreviewId:options.sourcePreviewId??null,promptTechnique:technique,sourceSurface:options.sourceSurface??"generation-controls",force:Boolean(options.force),...(options.contextRootBlockId?{contextRootBlockId:options.contextRootBlockId,characterOutputKind:options.characterOutputKind??"headshot"}:{}),...(options.workflowId&&options.workflowStageId?{workflowId:options.workflowId,workflowStageId:options.workflowStageId,workflowSources:options.workflowSources??[]}:{})})});this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);const body=await response.json() as {readiness?:GenerationReadiness;error?:string;message?:string};this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);if(!response.ok||!body.readiness)throw new Error(body.message??body.error??"Generation readiness could not be checked");this.generationReadiness.set({...this.generationReadiness.get(),[requestKey]:body.readiness});if(body.readiness.status!=="review")this.#readinessAcknowledgements.delete(requestKey);this.notify();return body.readiness;}catch(error){if(!(this.#scopeStillActive(authorization)&&this.sourceOwnershipActive(sourceOwner)))return null;const failed={...(this.generationReadiness.get()[requestKey]??existing!),status:"unknown" as const,summary:error instanceof Error?error.message:"Generation readiness could not be checked",expiresAt:new Date(Date.now()+30_000).toISOString()};this.generationReadiness.set({...this.generationReadiness.get(),[requestKey]:failed});this.notify();return failed;}finally{if((this.#scopeStillActive(authorization)&&this.sourceOwnershipActive(sourceOwner)))this.#readinessInFlight.delete(requestKey);}}
  async refreshGenerationProviderStatus(){
    const sourceOwner=this.captureSourceOwnership();if(!this.sourceOwnershipActive(sourceOwner)){return;}const authorization=this.#activeAuthorizationScope();try{const response=await this.guardedFetch("/api/generation-readiness/provider/refresh",{method:"POST"},"refresh provider readiness");this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);const body=await response.json() as {error?:string};this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);if(!response.ok)throw new Error(body.error??"Provider status could not be refreshed");this.generationReadiness.set({});this.#readinessAcknowledgements.clear();this.toast("Provider status cleared. Rechecking the current document…");this.notify();return true;}catch(error){if((this.#scopeStillActive(authorization)&&this.sourceOwnershipActive(sourceOwner)))this.toast(error instanceof Error?error.message:"Provider status could not be refreshed");return false;}}
  async comparePromptTechniqueSafety(job:DocumentJob,failedTechnique:PromptTechnique=job.promptTechnique,failedPrompt=""){
    const sourceOwner=this.captureSourceOwnership();if(!this.sourceOwnershipActive(sourceOwner)){return null;}
    const authorization=this.#activeAuthorizationScope(),context=this.#generationContext(job.documentId);
    const kind=job.kind==="prompt_fan"?job.fanKind??"generate":job.kind==="preview"?"preview":"generate";
    const response=await this.guardedFetch("/api/generation-readiness/prompt-techniques",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...context,kind,productionMode:job.productionMode??"manual",sourcePreviewId:job.sourcePreviewId,failedTechnique:normalizePromptTechnique(failedTechnique),failedPrompt,sourceSurface:job.sourceSurface||"generation-failure"})},"run a moderation-only prompt comparison");
    this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);
    const body=await response.json() as {comparison?:PromptTechniqueSafetyComparison;error?:string;message?:string};
    this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);
    if(!response.ok||!body.comparison)throw new Error(body.message??body.error??"Prompt structures could not be compared");
    await this.#refreshEvents();
    this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);
    return body.comparison;
  }
  documentGenerationJobs(documentId=this.projection.get().documentId){return this.documentJobs.get().filter((job)=>job.documentId===documentId&&(job.kind==="prompt_fan"||(job.kind==="preview"||job.kind==="generate")&&!job.parentJobId)&&(job.status==="queued"||job.status==="running"||job.status==="committing")).sort((a,b)=>a.requestedAt.localeCompare(b.requestedAt)||a.jobId.localeCompare(b.jobId));}
  documentRenderJobs(documentId=this.projection.get().documentId){return this.documentJobs.get().filter((job)=>job.documentId===documentId&&job.kind==="render_document"&&(job.status==="queued"||job.status==="running"||job.status==="committing")).sort((a,b)=>a.requestedAt.localeCompare(b.requestedAt)||a.jobId.localeCompare(b.jobId));}
  documentJobForRequest(kind:"preview"|"generate",requestKey:string,documentId=this.projection.get().documentId){return this.documentGenerationJobs(documentId).find((job)=>job.kind===kind&&job.requestKey===requestKey);}
  documentJobStarting(requestKey:string){return this.#jobStarts.has(requestKey);}
  documentJobActive(kind?:DocumentJobKind,documentId=this.projection.get().documentId,canvasId?:string|null){return this.documentJobs.get().some((job)=>!documentJobIsMemory(job)&&job.documentId===documentId&&(canvasId===undefined||(job.canvasId??null)===canvasId)&&(!kind||job.kind===kind||job.kind==="prompt_fan"&&job.fanKind===kind)&&(job.status==="queued"||job.status==="running"||job.status==="committing"));}
  setCanvasPlanningSelection(itemIds:readonly string[]){const canvas=this.canvasProjection.get(),scope=this.captureAuthorizationScope()?.key??"",next={scope,canvasId:canvas.selectedCanvasId,itemIds:[...itemIds].sort()};if(JSON.stringify(next)!==JSON.stringify(this.canvasPlanningSelection.get()))this.canvasPlanningSelection.set(next);}
  chooseCanvasPlanningDocument(documentId:string){const canvas=this.canvasProjection.get(),projection=this.projection.get(),scope=this.captureAuthorizationScope()?.key;if(!scope||!canvas.selectedCanvasId||!projection.documents.some((item)=>item.id===documentId&&item.projectId===canvas.projectId))return false;this.canvasPlanningChoices.set({...this.canvasPlanningChoices.get(),[`${scope}:${canvas.selectedCanvasId}`]:documentId});return true;}
  canvasPlanningDocumentId(selectedIds?:readonly string[]){const canvas=this.canvasProjection.get(),scope=this.captureAuthorizationScope()?.key??"",selection=this.canvasPlanningSelection.get();return canvasDocumentTarget(this.projection.get(),canvas,selectedIds??(selection.scope===scope&&selection.canvasId===canvas.selectedCanvasId?selection.itemIds:[]),this.canvasPlanningChoices.get()[`${scope}:${canvas.selectedCanvasId}`]??"");}
  documentPreviewProgress(documentId=this.projection.get().documentId){
    const jobs=this.documentJobs.get().filter(job=>job.documentId===documentId&&(job.kind==="preview"||job.kind==="generate")&&["queued","running","committing"].includes(job.status));
    const job=jobs.sort((a,b)=>b.requestedAt.localeCompare(a.requestedAt)||b.requestedSequence-a.requestedSequence)[0];
    return job?imageGenerationProgress(job,documentId):null;
  }
  adaptiveStructureFor(documentId=this.projection.get().documentId){return this.adaptiveStructures.get()[documentId]??null;}
  /** Exact current-authority identity. Metadata alone supports receipt lookup, never private review or Apply. */
  #immutableAdaptiveOriginal<T>(value:T):T{
    const copy=structuredClone(value);
    const freeze=(item:unknown)=>{if(item&&typeof item==="object"){for(const child of Object.values(item))freeze(child);Object.freeze(item);}};
    freeze(copy);return copy;
  }
  #publicDocumentJobDetail(detail:CachedDocumentJobDetail|undefined):DocumentJob|undefined{
    if(!detail?.adaptiveOriginalProof)return detail;
    const job={...detail};delete job.adaptiveOriginalProof;return job;
  }
  #adaptiveProposalOriginalMatches(detail:CachedDocumentJobDetail|undefined,job:DocumentJob|undefined=detail){
    const original=detail?.adaptiveOriginalProof,session=this.session.get();
    if(!original||!job||!session||!this.sourceOwnershipActive(original.source)
      ||this.#authorizationScope(session)!==original.source.authorization.key)return false;
    const identity=this.#planningRecoveryIdentities.get(job.jobId),expected=original.identity,quote=original.quote,result=job.result;
    const matches=(value:PlanningRecoveryIdentity|DocumentJob)=>value.jobId===expected.jobId&&value.kind==="structure_adaptive"
      &&value.planningExecutionId===expected.jobId&&value.documentId===expected.documentId&&(value.canvasId??null)===(expected.canvasId??null)
      &&value.sourceSurface===expected.sourceSurface&&value.requestKey===expected.requestKey
      &&value.planningLocale===expected.planningLocale&&value.planningProjectScope===expected.planningProjectScope;
    return Boolean(identity&&identity.authorization===original.source.authorization.key&&matches(identity.identity)&&matches(job)
      &&original.certifiedRevision>(identity.withdrawalRevision??0)&&(identity.detailRevision??0)>=original.certifiedRevision
      &&quote.projectId===this.projection.get().projectId&&job.status==="completed"&&result?.planningReviewAvailable===true
      &&result.resultUnavailable!==true&&result.executionId===quote.executionId&&result.bindingHash===quote.bindingHash
      &&result.sourceHash===quote.sourceHash&&result.requestKey===expected.requestKey
      &&JSON.stringify(result.structure)===JSON.stringify(original.structure));
  }
  #cacheDocumentJobDetail(job:DocumentJob){
    const publicJob=this.#publicDocumentJobDetail(job)!;
    const previous=this.#jobDetails.get(job.jobId);
    this.#jobDetails.set(job.jobId,this.#adaptiveProposalOriginalMatches(previous,publicJob)
      ?{...publicJob,adaptiveOriginalProof:previous!.adaptiveOriginalProof}:publicJob);
  }
  #certifyAdaptiveProposalOriginal(job:DocumentJob,quote:AvailableConsequentialPreview|null|undefined,request:PlanningConsentRequest,source:CapturedSourceOwnership|null,readRevision:number,originalJob:DocumentJob|undefined){
    const session=this.session.get(),identity=this.#planningRecoveryIdentities.get(job.jobId),result=job.result,originalResult=originalJob?.result;
    if(!source||!session||!this.sourceOwnershipActive(source)||this.#authorizationScope(session)!==source.authorization.key
      ||!identity||identity.authorization!==source.authorization.key||identity.deliberateReadRevision!==readRevision
      ||identity.revision<=(identity.withdrawalRevision??0)||!quote||quote.operation!=="adaptive-structure"||quote.status!=="completed"
      ||quote.executionId!==job.jobId||quote.projectId!==request.projectId||quote.projectId!==this.projection.get().projectId
      ||quote.documentId!==request.documentId||(quote.canvasId??null)!==request.canvasId||!/^[a-f0-9]{64}$/u.test(quote.bindingHash)
      ||typeof quote.sourceHash!=="string"||!/^[a-f0-9]{64}$/u.test(quote.sourceHash)
      ||job.planningExecutionId!==job.jobId||!adaptiveJobMatchesRequest(job,request)||job.planningLocale!==request.locale
      ||job.planningProjectScope!==request.projectScope||job.status!=="completed"||result?.planningReviewAvailable!==true
      ||result.resultUnavailable===true||result.executionId!==quote.executionId||result.bindingHash!==quote.bindingHash
      ||result.sourceHash!==quote.sourceHash||result.requestKey!==request.requestKey||!result.structure||typeof result.structure!=="object"
      ||Array.isArray(result.structure)||!originalJob||originalJob.jobId!==job.jobId||originalJob.planningExecutionId!==job.jobId
      ||!adaptiveJobMatchesRequest(originalJob,request)||originalJob.planningLocale!==request.locale||originalJob.planningProjectScope!==request.projectScope
      ||originalJob.status!=="completed"||originalResult?.planningReviewAvailable!==true||originalResult.resultUnavailable===true
      ||originalResult.executionId!==quote.executionId||originalResult.bindingHash!==quote.bindingHash||originalResult.sourceHash!==quote.sourceHash
      ||originalResult.requestKey!==request.requestKey||JSON.stringify(originalResult.structure)!==JSON.stringify(result.structure))return false;
    const proof:AdaptiveOriginalProof=Object.freeze({source,quote:this.#immutableAdaptiveOriginal(quote),
      structure:this.#immutableAdaptiveOriginal(originalResult.structure as AdaptiveStructure),
      identity:Object.freeze({...identity.identity}),readRevision,certifiedRevision:identity.revision});
    const publicJob=this.#publicDocumentJobDetail(job)!;
    this.#jobDetails.set(job.jobId,{...publicJob,adaptiveOriginalProof:proof});
    return true;
  }
  /** Explicit original-only read: the existing consent validator owns every response.
   * This descriptor is never published as a native consent or a new operation. */
  async loadAdaptiveProposalOriginal(executionId:string){
    const source=this.captureSourceOwnership(),authorization=source?.authorization.key??"",route=this.route.get(),localeRevision=this.#planningLocaleRevision;
    const known=this.documentJobs.get().find(job=>job.jobId===executionId)??this.#publicDocumentJobDetail(this.#jobDetails.get(executionId))
      ??this.planningRecoveryEntries().find(job=>job.jobId===executionId),projection=this.projection.get();
    if(!source||!this.sourceOwnershipActive(source)||!this.#canReadProjectJobs()||this.planningConsent.get()
      ||!known||known.kind!=="structure_adaptive"||known.planningExecutionId!==executionId||!known.sourceSurface||!known.requestKey
      ||!known.planningLocale||typeof known.planningProjectScope!=="boolean"
      ||!projection.documents.some(document=>document.id===known.documentId&&document.projectId===projection.projectId))throw new Error("planning_result_unavailable");
    const request:PlanningConsentRequest={projectId:projection.projectId,documentId:known.documentId,canvasId:known.canvasId??null,
      sourceSurface:known.sourceSurface,projectScope:known.planningProjectScope,locale:known.planningLocale,requestKey:known.requestKey,prompt:""};
    const current=()=>{
      if(!this.sourceOwnershipActive(source)||!this.#scopeStillActive(authorization)||this.route.get()!==route
        ||this.#planningLocaleRevision!==localeRevision||this.planningConsent.get()||!this.#canReadProjectJobs())return false;
      const view=this.projection.get(),job=this.documentJobs.get().find(item=>item.jobId===executionId)
        ??this.#publicDocumentJobDetail(this.#jobDetails.get(executionId))??this.planningRecoveryEntries().find(item=>item.jobId===executionId);
      return Boolean(view.projectId===request.projectId&&view.documents.some(document=>document.id===request.documentId&&document.projectId===request.projectId)
        &&(request.canvasId?this.canvasProjection.get().selectedCanvasId===request.canvasId&&this.canvasPlanningDocumentId()===request.documentId:view.documentId===request.documentId)
        &&job&&adaptiveJobMatchesRequest(job as DocumentJob,request)&&job.jobId===executionId&&job.planningExecutionId===executionId
        &&job.planningLocale===request.locale&&job.planningProjectScope===request.projectScope);
    };
    if(!current())throw new Error("planning_result_unavailable");
    const completed=await this.#requestPlanningConsent("resume",{executionId,request,source,authorization,current});
    if(completed!==true||!current())throw new Error("planning_result_unavailable");
  }
  /** A cold original read observes the existing revision clock; it never selects or certifies a job. */
  captureAdaptiveProposalRead(){
    const source=this.captureSourceOwnership();if(!source||!this.sourceOwnershipActive(source))return null;
    return Object.freeze({revision:this.#planningRecoverySequence,current:()=>this.sourceOwnershipActive(source)});
  }
  adaptiveProposalSource(documentId=this.projection.get().documentId,canvasId:string|null=null,executionId?:string){
    const session=this.session.get(),projection=this.projection.get();
    if(!session||!this.#canReadProjectJobs()||!projection.documents.some(item=>item.id===documentId&&item.projectId===projection.projectId))return null;
    const id=executionId??(canvasId?undefined:this.#adaptiveStructureJobIds.get(documentId));if(!id)return null;
    const authorization=this.#authorizationScope(session),proof=this.#planningRecoveryIdentities.get(id),known=proof?.identity;
    if(!proof||proof.authorization!==authorization||!known||known.jobId!==id||known.planningExecutionId!==id||known.documentId!==documentId||(known.canvasId??null)!==canvasId
      ||canvasId&&this.canvasProjection.get().selectedCanvasId!==canvasId)return null;
    const current=this.documentJobs.get().find(job=>job.jobId===id),cached=this.#jobDetails.get(id);
    const matches=(job:DocumentJob|PlanningRecoveryIdentity|undefined)=>Boolean(job&&job.jobId===id&&job.kind==="structure_adaptive"&&job.planningExecutionId===id&&job.documentId===documentId
      &&(job.canvasId??null)===canvasId&&job.sourceSurface===known.sourceSurface&&job.requestKey===known.requestKey
      &&job.planningLocale===known.planningLocale&&job.planningProjectScope===known.planningProjectScope);
    if(current&&!matches(current))return null;
    const metadataHash=matches(current)&&current?.status==="completed"&&typeof current.result?.bindingHash==="string"
      &&/^[a-f0-9]{64}$/u.test(current.result.bindingHash)?current.result.bindingHash:null;
    const withdrawn=current?.result?.planningReviewAvailable===false||current?.result?.resultUnavailable===true;
    // The public job/inspection contract intentionally omits private quotes.
    // Only an exact original response can create this private, generation-owned
    // proof. Generic rows can merely confirm the same body; never recertify it.
    const original=cached?.adaptiveOriginalProof;
    const originalMatches=Boolean(original&&this.sourceOwnershipActive(original.source)&&original.source.authorization.key===authorization
      &&original.certifiedRevision>(proof.withdrawalRevision??0)&&(proof.detailRevision??0)>=original.certifiedRevision
      &&matches(original.identity)&&matches(cached)&&cached?.status==="completed"&&cached.result?.planningReviewAvailable===true&&cached.result.resultUnavailable!==true
      &&cached.result.executionId===original.quote.executionId&&cached.result.bindingHash===original.quote.bindingHash
      &&cached.result.sourceHash===original.quote.sourceHash&&cached.result.requestKey===original.identity.requestKey
      &&JSON.stringify(cached.result.structure)===JSON.stringify(original.structure)
      &&(!current?.result?.structure||JSON.stringify(current.result.structure)===JSON.stringify(original.structure))
      &&(current?.result?.sourceHash===undefined||current.result.sourceHash===original.quote.sourceHash));
    const privateCandidate=originalMatches?{...cached!,result:{...cached!.result,quote:original!.quote,structure:original!.structure}}:undefined;
    const candidate=withdrawn?undefined:privateCandidate;
    const quote=candidate?.result?.quote as AvailableConsequentialPreview|undefined;
    const readable=Boolean(quote&&quote.executionId===id&&/^[a-f0-9]{64}$/u.test(quote.bindingHash)&&quote.operation==="adaptive-structure"
      &&quote.status==="completed"&&quote.projectId===projection.projectId&&quote.documentId===documentId&&(quote.canvasId??null)===canvasId&&(!metadataHash||metadataHash===quote.bindingHash));
    return{executionId:id,bindingHash:readable?quote!.bindingHash:metadataHash,structure:readable?structuredClone(original!.structure):null,
      readable,withdrawalRevision:proof.withdrawalRevision??0};
  }
  #clearPendingAdaptiveSelection(documentId:string,replacementId?:string){
    for(const entry of this.#planningRecoveryIdentities.values())if(entry.identity.documentId===documentId&&entry.selectOnCompletion){
      if(entry.identity.jobId!==replacementId)this.#dismissedAdaptiveSuggestions.add(entry.identity.jobId);
      delete entry.selectOnCompletion;
    }
  }
  dismissAdaptiveStructure(documentId=this.projection.get().documentId){const next={...this.adaptiveStructures.get()};delete next[documentId];const id=this.#adaptiveStructureJobIds.get(documentId);if(id)this.#dismissedAdaptiveSuggestions.add(id);this.#clearPendingAdaptiveSelection(documentId);this.#adaptiveStructureJobIds.delete(documentId);this.adaptiveStructures.set(next);this.#trimDocumentJobDetails();this.notify();}
  adaptiveSuggestionSetsFor(documentId=this.projection.get().documentId,canvasId?:string){const suggestions=this.adaptiveSuggestionSets.get()[documentId]??[];return canvasId===undefined?suggestions:adaptiveSuggestionsForCanvas(suggestions,canvasId);}
  dismissAdaptiveSuggestion(documentId:string,suggestionId:string){this.#dismissedAdaptiveSuggestions.add(suggestionId);const identity=this.#planningRecoveryIdentities.get(suggestionId);if(identity)delete identity.presentationLocaleRevision;const next={...this.adaptiveSuggestionSets.get(),[documentId]:this.adaptiveSuggestionSetsFor(documentId).filter((suggestion)=>suggestion.id!==suggestionId)};if(!next[documentId].length)delete next[documentId];this.adaptiveSuggestionSets.set(next);this.#trimDocumentJobDetails();this.notify();}
  #adaptiveIntentForJob(job:DocumentJob){const result=job.result??{};if(typeof result.intent==="string")return result.intent;const directRef=String(result.intentRef??"");if(directRef&&this.content.get()[directRef])return this.content.get()[directRef];const eventIds=new Set(Array.isArray(result.appendedEventIds)?result.appendedEventIds.map(String):[]);const reasoned=this.events.get().find((event)=>eventIds.has(event.eventId)&&event.type==="AssistantReasoned"&&event.payload.operation==="adaptive-structure");const eventRef=String(reasoned?.payload.intent_ref??"");return this.#pendingAdaptiveIntents.get(job.jobId)??this.content.get()[eventRef]??"";}
  #referencedPlanningJobIds(){
    const review=this.planningConsent.get(),referenced=new Set<string>([...this.documentJobs.get().map(item=>item.jobId),...this.#adaptiveStructureJobIds.values(),...Object.values(this.adaptiveSuggestionSets.get()).flatMap(items=>items.map(item=>item.id))]);
    for(const entry of this.#planningRecoveryIdentities.values())if(entry.selectOnCompletion||this.#planningLocaleRevision>0&&entry.presentationLocaleRevision===this.#planningLocaleRevision)referenced.add(entry.identity.jobId);
    for(const id of[review?.recoveryExecutionId,review?.quote?.executionId,review?.replaceExecutionId])if(id)referenced.add(id);
    return referenced;
  }
  #trimDocumentJobDetails(){
    // Bound only history: a full Activity page must not evict the exact proof
    // currently supporting an open review, selected plan, or Canvas card.
    const referenced=this.#referencedPlanningJobIds();
    const historical=[...this.#jobDetails.keys()].filter(id=>!referenced.has(id));
    for(const id of historical.slice(0,Math.max(0,historical.length-24)))this.#jobDetails.delete(id);
  }
  #rememberPlanningRecovery(job:DocumentJob|PlanningRecoveryIdentity,recoverable=true){
    const session=this.session.get(),projection=this.projection.get();
    if(!session||job.kind!=="structure_adaptive"||job.planningExecutionId!==job.jobId||!projection.documents.some(document=>document.id===job.documentId&&document.projectId===projection.projectId))return;
    const identity:PlanningRecoveryIdentity={jobId:job.jobId,documentId:job.documentId,canvasId:job.canvasId??null,kind:"structure_adaptive",planningExecutionId:job.jobId,sourceSurface:job.sourceSurface,requestKey:job.requestKey,planningLocale:job.planningLocale,planningProjectScope:job.planningProjectScope};
    const authorization=this.#authorizationScope(session),previous=this.#planningRecoveryIdentities.get(job.jobId);
    const revision=previous?.authorization===authorization?previous.revision:++this.#planningRecoverySequence;
    this.#planningRecoveryIdentities.delete(job.jobId);this.#planningRecoveryIdentities.set(job.jobId,{...(previous?.authorization===authorization?previous:{}),authorization,identity,revision,recoverable:recoverable||previous?.authorization===authorization&&previous.recoverable===true});
    // The cap is for historical handles, not live read/withdrawal revisions.
    // A supported Activity page can contain 120 jobs: observing it must never
    // evict an open request or the private presentation it is recertifying.
    const review=this.planningConsent.get(),referenced=this.#referencedPlanningJobIds();referenced.add(job.jobId);
    // A response may redirect the open request to a not-yet-selected winner.
    // Its newer withdrawal/terminal barriers outlive history eviction until
    // that potentially affected read settles, including an initial free quote.
    const activeRead=review?.working?review.readRevision:undefined;
    const historical=[...this.#planningRecoveryIdentities].filter(([id,entry])=>!referenced.has(id)&&entry.pendingReadRevision===undefined
      &&!(activeRead!==undefined&&Math.max(entry.withdrawalRevision??0,entry.terminalRevision??0)>activeRead)).map(([id])=>id);
    for(const id of historical.slice(0,Math.max(0,historical.length-24)))this.#planningRecoveryIdentities.delete(id);
  }
  planningRecoveryEntries():PlanningRecoveryIdentity[]{
    const session=this.session.get();if(!session||!this.#canReadProjectJobs())return[];
    const authorization=this.#authorizationScope(session),projection=this.projection.get(),present=new Set(this.documentJobs.get().map(job=>job.jobId));
    return [...this.#planningRecoveryIdentities.values()].filter(entry=>entry.recoverable&&entry.authorization===authorization&&!present.has(entry.identity.jobId)&&projection.documents.some(document=>document.id===entry.identity.documentId&&document.projectId===projection.projectId)).map(entry=>({...entry.identity}));
  }
  #withdrawAdaptiveRead(jobId:string,startedAt:number){
    const identity=this.#planningRecoveryIdentities.get(jobId);
    // Starting a lookup is not new access proof. A successful newer exact
    // read can fence this denial; an unanswered one only keeps its lifecycle.
    if((identity?.certifiedReadRevision??0)>startedAt)return false;
    this.#clearAdaptivePrivatePresentation(jobId,(identity?.pendingReadRevision??0)>startedAt?identity?.pendingReadRevision:undefined,startedAt,true);
    return true;
  }
  #clearAdaptivePrivatePresentation(jobId:string,preservePendingRead?:number,deniedReadAt?:number,revokeSelection=false){
    const review=this.planningConsent.get(),reviewId=review?.recoveryExecutionId??(review?.submitted||review?.quote?.status!=="quoted"?review?.quote?.executionId:undefined);
    const known=this.documentJobs.get().find(job=>job.jobId===jobId)??this.#jobDetails.get(jobId);
    if(known)this.#rememberPlanningRecovery(known);
    else if(review&&reviewId===jobId)this.#rememberPlanningRecovery({jobId,kind:"structure_adaptive",planningExecutionId:jobId,documentId:review.request.documentId,canvasId:review.request.canvasId,sourceSurface:review.request.sourceSurface,requestKey:review.request.requestKey,planningLocale:review.request.locale,planningProjectScope:review.request.projectScope});
    const identity=this.#planningRecoveryIdentities.get(jobId),preserve=preservePendingRead!==undefined&&identity?.pendingReadRevision===preservePendingRead;
    if(identity){const withdrawnAt=++this.#planningRecoverySequence;if(!preserve)identity.revision=withdrawnAt;identity.withdrawalRevision=withdrawnAt;identity.withdrawalReadRevision=Math.max(identity.withdrawalReadRevision??0,deniedReadAt??withdrawnAt);identity.preservedReadRevision=preserve?preservePendingRead:undefined;delete identity.terminalReadRevision;
      // Failure to read private bytes is not cancellation of a content-free
      // delivery intent. Only affirmative withdrawal revokes that ownership.
      if(revokeSelection){if(identity.selectOnCompletion)this.#dismissedAdaptiveSuggestions.add(jobId);delete identity.selectOnCompletion;delete identity.presentationLocaleRevision;}
    }
    const plans={...this.adaptiveStructures.get()};
    // The selected ID is content-free. Clearing its private bytes must not choose
    // a different paid plan merely because that plan's response arrives first.
    for(const[documentId,id]of this.#adaptiveStructureJobIds)if(id===jobId)delete plans[documentId];
    this.adaptiveStructures.set(plans);this.#pendingAdaptiveIntents.delete(jobId);this.#jobDetails.delete(jobId);
    const suggestions:Record<string,AdaptiveSuggestionSet[]>={};
    for(const[documentId,items]of Object.entries(this.adaptiveSuggestionSets.get())){const retained=items.filter(item=>item.id!==jobId);if(retained.length)suggestions[documentId]=retained;}
    this.adaptiveSuggestionSets.set(suggestions);
    this.documentJobs.set(this.documentJobs.get().map(job=>{if(job.jobId!==jobId||job.planningExecutionId!==jobId)return job;const result={...job.result};delete result.structure;delete result.intent;delete result.quote;return{...job,result};}));
    if(review&&reviewId===jobId)this.planningConsent.set({...review,quote:null,recoveredPlan:undefined,replaceExecutionId:undefined,recoveryExecutionId:jobId,submitted:true,working:preserve?review.working:false,request:{...review.request,prompt:""},notice:"failed"});
    this.notify();
  }
  /** Consume authoritative terminal/withdrawal evidence before yielding to another read. */
  #observeAdaptivePlanningJob(job:DocumentJob){
    if(job.kind!=="structure_adaptive"||job.planningExecutionId!==job.jobId)return;
    this.#rememberPlanningRecovery(job);
    const identity=this.#planningRecoveryIdentities.get(job.jobId);
    if(!identity)return;
    if(job.result?.planningReviewAvailable===false||job.result?.resultUnavailable===true){
      this.#clearAdaptivePrivatePresentation(job.jobId,undefined,undefined,true);return;
    }
    if(job.status!=="completed"||!job.result?.structure){
      if(documentJobTerminal(job)){
        if(identity.selectOnCompletion)this.#dismissedAdaptiveSuggestions.add(job.jobId);
        delete identity.selectOnCompletion;delete identity.presentationLocaleRevision;
        const budget=planningStopBudget(job.result);
        const receipt=JSON.stringify([job.status,budget?.reservationStatus??null,budget?.billingStatus??null]);
        // Repeated identical polling is not newer accounting evidence. Keep
        // its epoch stable so an exact read can still finish during polling.
        if(identity.terminalStatus!==job.status||identity.terminalReceipt!==receipt)identity.terminalRevision=++this.#planningRecoverySequence;
        identity.terminalStatus=job.status;identity.terminalReceipt=receipt;
        const review=this.planningConsent.get();
        if(review?.notice==="uncertain"&&(review.recoveryExecutionId??review.quote?.executionId)===job.jobId&&documentJobHasNoBudgetHold(budget)){
          this.planningConsent.set({...review,notice:"failed"});this.notify();
        }
      }
      return;
    }
    const review=this.planningConsent.get(),reviewId=review?.recoveryExecutionId??(review?.submitted||review?.quote?.status!=="quoted"?review?.quote?.executionId:undefined);
    const quote=job.result.quote as AvailableConsequentialPreview|undefined;
    if(quote&&(quote.executionId!==job.jobId||quote.projectId!==this.projection.get().projectId||quote.documentId!==job.documentId||(quote.canvasId??null)!==(job.canvasId??null)||reviewId===job.jobId&&review?.quote&&quote.bindingHash!==review.quote.bindingHash)){
      this.#clearAdaptivePrivatePresentation(job.jobId);return;
    }
    // Re-observing a completed predecessor is not evidence about the separate
    // replacement being prepared. Its actual withdrawal still wins above.
    if(review?.working&&review.replaceExecutionId===job.jobId&&review.quote?.status==="completed")return;
    // A completed proof supersedes pending reads already in flight. Ordinary
    // progress is deliberately not an invalidation and cannot strand a lookup.
    identity.terminalReadRevision??=identity.revision;
    identity.revision=++this.#planningRecoverySequence;
    identity.terminalRevision=identity.revision;identity.terminalStatus=job.status;
    if(job.sourceSurface!=="canvas"&&!this.#dismissedAdaptiveSuggestions.has(job.jobId)){
      const selected=this.#adaptiveStructureJobIds.get(job.documentId);
      if(selected===job.jobId||reviewId===job.jobId||identity.selectOnCompletion){
        if(reviewId===job.jobId||identity.selectOnCompletion)this.#clearPendingAdaptiveSelection(job.documentId,job.jobId);
        this.#adaptiveStructureJobIds.set(job.documentId,job.jobId);this.adaptiveStructures.set({...this.adaptiveStructures.get(),[job.documentId]:job.result.structure as AdaptiveStructure});
      }
    }
    if(job.sourceSurface==="canvas"&&this.#canPresentAdaptivePlanningJob(job)){
      const suggestion:AdaptiveSuggestionSet={id:job.jobId,documentId:job.documentId,canvasId:job.canvasId??null,intent:this.#adaptiveIntentForJob(job),structure:job.result.structure as AdaptiveStructure,requestedAt:job.requestedAt,completedAt:job.completedAt??job.updatedAt};
      const items=[...(this.adaptiveSuggestionSets.get()[job.documentId]??[]).filter(item=>item.id!==job.jobId),suggestion];
      items.sort((left,right)=>left.requestedAt.localeCompare(right.requestedAt)||left.id.localeCompare(right.id));
      this.adaptiveSuggestionSets.set({...this.adaptiveSuggestionSets.get(),[job.documentId]:items});
    }
    if(review&&reviewId===job.jobId)this.planningConsent.set({...review,...(quote?{quote}:{}),recoveryExecutionId:job.jobId,submitted:true,working:false,recoveredPlan:job.result.structure as AdaptiveStructure,request:{...review.request,prompt:typeof job.result.intent==="string"?job.result.intent:review.request.prompt},notice:""});
    this.notify();
  }
  /** Feed omission is not deletion. Recheck the exact private identities still shown elsewhere. */
  async #revalidateMissingAdaptivePlans(jobs:DocumentJob[],authorization:string,previous=new Map<string,DocumentJob>(),feedCurrent=()=>true){
    const sourceOwner=this.captureSourceOwnership();if(!this.sourceOwnershipActive(sourceOwner)||!feedCurrent()){return [];}
    type Target={documentId:string;canvasId:string|null;sourceSurface?:string;requestKey?:string;planningProjectScope?:boolean;planningLocale?:string};
    const targets=new Map<string,Target>(),present=new Set(jobs.map(job=>job.jobId));
    const remember=(id:string,target:Target)=>{if(!id||present.has(id))return;const known=previous.get(id)??this.#jobDetails.get(id),identity=known??{...target,jobId:id,kind:"structure_adaptive" as const,planningExecutionId:id};this.#rememberPlanningRecovery(identity);targets.set(id,{documentId:identity.documentId,canvasId:identity.canvasId??null,sourceSurface:identity.sourceSurface,requestKey:identity.requestKey,planningProjectScope:identity.planningProjectScope,planningLocale:identity.planningLocale});};
    for(const identity of this.planningRecoveryEntries())remember(identity.jobId,{...identity,canvasId:identity.canvasId??null});
    for(const entry of [...this.#planningRecoveryIdentities.values()])if(entry.selectOnCompletion&&entry.authorization===authorization)remember(entry.identity.jobId,{...entry.identity,canvasId:entry.identity.canvasId??null});
    for(const[documentId,id]of this.#adaptiveStructureJobIds)remember(id,{documentId,canvasId:null});
    for(const items of Object.values(this.adaptiveSuggestionSets.get()))for(const item of items)remember(item.id,{documentId:item.documentId,canvasId:item.canvasId??null,sourceSurface:"canvas"});
    const review=this.planningConsent.get(),reviewId=review?.recoveryExecutionId??(review?.submitted||review?.quote?.status!=="quoted"?review?.quote?.executionId:undefined);
    if(review&&reviewId&&(this.#planningRecoveryIdentities.get(reviewId)?.recoverable||review.quote&&review.quote.status!=="quoted"))remember(reviewId,{...review.request,planningProjectScope:review.request.projectScope,planningLocale:review.request.locale});
    const inspected=await Promise.all([...targets].map(async([id,target])=>{
      const revision=this.#planningRecoveryIdentities.get(id)?.revision,terminalRevision=this.#planningRecoveryIdentities.get(id)?.terminalRevision??0;
      const deliberateReadRevision=this.#planningRecoveryIdentities.get(id)?.deliberateReadRevision??0,startedAt=this.#planningRecoverySequence;
      if(!feedCurrent())return null;
      if(revision===undefined){this.#clearAdaptivePrivatePresentation(id);return null;}
      const currentRead=()=>feedCurrent()&&this.#planningRecoveryIdentities.get(id)?.revision===revision&&(this.#planningRecoveryIdentities.get(id)?.deliberateReadRevision??0)===deliberateReadRevision&&(this.#planningRecoveryIdentities.get(id)?.withdrawalRevision??0)<=startedAt&&(this.#planningRecoveryIdentities.get(id)?.certifiedReadRevision??0)<=startedAt;
      try{
        const response=await fetch(`/api/document-jobs/${encodeURIComponent(id)}?inspection=1`);
        this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);
        if(!response.ok){if([401,403,404,410].includes(response.status))this.#withdrawAdaptiveRead(id,startedAt);else if(currentRead())this.#clearAdaptivePrivatePresentation(id);return null;}
        const body=await response.json() as {job?:DocumentJob};this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);
        const job=body.job,projection=this.projection.get();
        const matches=Boolean(job&&job.jobId===id&&job.planningExecutionId===id&&job.kind==="structure_adaptive"&&job.documentId===target.documentId&&(job.canvasId??null)===target.canvasId
          &&(target.sourceSurface===undefined||job.sourceSurface===target.sourceSurface)&&(target.requestKey===undefined||job.requestKey===target.requestKey)
          &&(target.planningProjectScope===undefined||job.planningProjectScope===target.planningProjectScope)&&(target.planningLocale===undefined||job.planningLocale===target.planningLocale)
          &&projection.documents.some(document=>document.id===job.documentId&&document.projectId===projection.projectId));
        const withdrawn=matches&&(job?.result?.planningReviewAvailable===false||job?.result?.resultUnavailable===true);
        if(withdrawn){this.#withdrawAdaptiveRead(id,startedAt);return null;}
        // Exact negative evidence still retires private bytes; route ownership
        // controls only positive feed publication and further work.
        if(!currentRead())return null;
        if(!job||!matches||!(job.status==="completed"&&job.result?.structure)&&job.result?.planningReviewAvailable!==true)throw new Error("planning_result_unavailable");
        const current=this.planningConsent.get(),currentId=current?.recoveryExecutionId??(current?.submitted||current?.quote?.status!=="quoted"?current?.quote?.executionId:undefined);
        const quote=job.result?.quote as AvailableConsequentialPreview|undefined;
        if(quote&&(quote.executionId!==id||quote.projectId!==projection.projectId||quote.documentId!==job.documentId||(quote.canvasId??null)!==(job.canvasId??null)||currentId===id&&current?.quote&&quote.bindingHash!==current.quote.bindingHash))throw new Error("planning_result_identity_changed");
        // A later stop/settlement may arrive without changing the privacy read
        // epoch. Do not republish its older status or financial receipt. A
        // genuinely certified completion and explicit withdrawal stay distinct.
        if(job.status!=="completed"&&(this.#planningRecoveryIdentities.get(id)?.terminalRevision??0)!==terminalRevision)return null;
        this.#rememberPlanningRecovery(job);this.#observeAdaptivePlanningJob(job);if(!feedCurrent())return null;this.#cacheDocumentJobDetail(job);
        const certified=this.#planningRecoveryIdentities.get(id);if(certified)certified.detailRevision=certified.revision;
        this.#trimDocumentJobDetails();
        return{job,revision:this.#planningRecoveryIdentities.get(id)?.revision,terminalRevision:this.#planningRecoveryIdentities.get(id)?.terminalRevision??0,deliberateReadRevision};
      }catch{if((this.#scopeStillActive(authorization)&&this.sourceOwnershipActive(sourceOwner))&&currentRead())this.#clearAdaptivePrivatePresentation(id);return null;}
    }));
    this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);
    if(!feedCurrent())return [];
    return inspected.filter((entry):entry is {job:DocumentJob;revision:number;terminalRevision:number;deliberateReadRevision:number}=>entry!==null&&entry.revision!==undefined&&this.#planningRecoveryIdentities.get(entry.job.jobId)?.revision===entry.revision&&(this.#planningRecoveryIdentities.get(entry.job.jobId)?.terminalRevision??0)===entry.terminalRevision&&(this.#planningRecoveryIdentities.get(entry.job.jobId)?.deliberateReadRevision??0)===entry.deliberateReadRevision);
  }
  #canPresentAdaptivePlanningJob(job:DocumentJob){
    if(this.#dismissedAdaptiveSuggestions.has(job.jobId))return false;
    // Initial hydration preserves existing discovery. After a language change,
    // even a previously unknown reused winner needs a current exact selection.
    // Matching intent is insufficient: a replacement can share its request key.
    if(this.#planningLocaleRevision===0)return true;
    const identity=this.#planningRecoveryIdentities.get(job.jobId);
    return identity?.authorization===this.#activeAuthorizationScope()&&identity.presentationLocaleRevision===this.#planningLocaleRevision;
  }
  #syncAdaptiveSuggestionSets(jobs:DocumentJob[]){
    const next:Record<string,AdaptiveSuggestionSet[]>={};
    for(const job of jobs){
      if(job.kind!=="structure_adaptive")continue;
      if(job.planningExecutionId===job.jobId&&(job.result?.planningReviewAvailable===false||job.result?.resultUnavailable===true)){
        continue;
      }
      if(job.sourceSurface!=="canvas"||job.status!=="completed"||!job.result?.structure||!this.#canPresentAdaptivePlanningJob(job))continue;
      const suggestion:AdaptiveSuggestionSet={id:job.jobId,documentId:job.documentId,canvasId:job.canvasId??null,intent:this.#adaptiveIntentForJob(job),structure:job.result.structure as AdaptiveStructure,requestedAt:job.requestedAt,completedAt:job.completedAt??job.updatedAt};(next[job.documentId]??=[]).push(suggestion);
    }
    for(const suggestions of Object.values(next))suggestions.sort((left,right)=>left.requestedAt.localeCompare(right.requestedAt)||left.id.localeCompare(right.id));this.adaptiveSuggestionSets.set(next);this.#trimDocumentJobDetails();
  }
  #jobResultVisible(job:DocumentJob){
    if(document.visibilityState!=="visible")return false;
    const route=this.route.get(),canvasId=canvasIdFromRoute(route);
    const matches=canvasId?documentJobMatchesSurface(job,{canvasId,documentId:this.canvasPlanningDocumentId()}):isDocumentViewRoute(route)&&documentJobMatchesSurface(job,{canvasId:null,documentId:documentIdFromRoute(route)??"",documentView:documentViewFromRoute(route)});
    if(!matches||job.kind!=="structure_adaptive")return matches;
    if(!job.result?.structure||job.result.planningReviewAvailable===false||job.result.resultUnavailable===true)return false;
    if(canvasId)return this.adaptiveSuggestionSetsFor(job.documentId,canvasId).some(item=>item.id===job.jobId&&Boolean(item.structure));
    const plan=this.adaptiveStructures.get()[job.documentId];
    return Boolean(plan&&(job.planningExecutionId===job.jobId?this.#adaptiveStructureJobIds.get(job.documentId)===job.jobId:plan===job.result.structure));
  }
  #jobNotice(job:DocumentJob){
    const snapshot=currentFormaLocale();
    const interpolate=(source:string,values:Record<string,string|number>={})=>source.replace(/\{(\w+)\}/g,(_,name:string)=>String(values[name]??""));
    const t=(id:string,fallback="",values:Record<string,string|number>={})=>interpolate(snapshot.messages[id]??fallback,values);
    const system=(source:string,values:Record<string,string|number>={})=>interpolate(snapshot.messages[formaSystemMessageId(source)]??source,values);
    const number=(value:number)=>new Intl.NumberFormat(snapshot.formatLocale).format(value);
    const title=this.projection.get().documents.find((document)=>document.id===job.documentId)?.title??system("your document");
    if(job.status==="partial"&&job.kind==="prompt_fan")return t("job.notice.partial","",{title,completed:number(Number(job.result?.completedCount??0)),failed:number(Number(job.result?.failedCount??0))});
    if(job.status==="failed"){
      const detail=documentJobFailure(job),fallback=job.error??"";
      const guidance=localizedGenerationFailureGuidance(generationFailureGuidance(detail,fallback,job),detail,fallback,{locale:snapshot.locale,messages:snapshot.messages,t,number,system});
      const message=t("job.notice.failedDetail","",{kind:t(`job.kind.${job.kind}`),title,guidance:guidance.title,summary:guidance.summary});
      return detail?.requestId?`${message} ${t("job.notice.request","",{request:detail.requestId})}`:message;
    }
    return t(`job.notice.ready.${job.kind}`,"",{title});
  }
  // Check and Edit have no notification-acknowledgment contract. Retained
  // Image notices remain unacknowledged until a separately qualified action.
  async #ackJob(jobId:string,original:DocumentJob){if(documentJobIsMemory(original)||original.jobId!==jobId||original.sourceSurface==="native-image"||!this.#canRequestProjectOutputs())return;try{await fetch(`/api/document-jobs/${encodeURIComponent(jobId)}/ack`,{method:"POST"});}catch{/* A later poll can offer the notice again. */}}
  async #hydrateDocumentJobGenerationReceipt(job:DocumentJob,authorization:string){
    const sourceOwner=this.captureSourceOwnership();this.#assertSourceOwnership(sourceOwner);
    const receipt=job.result?.generationReceipt;this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);
    if(this.session.get()?.projectContext){if(receipt!==undefined&&receipt!==null)throw new Error("Actor-private generation receipts are unavailable in shared project views.");return;}
    if(!receipt||typeof receipt!=="object"||Array.isArray(receipt))return;
    const reference=(receipt as Record<string,unknown>).input_ref;if(typeof reference!=="string"||!reference.trim())return;
    let rejected=false;
    const retained=await this.ensurePrivateContent(reference,{validate:(value)=>{
      try{const parsed=JSON.parse(value) as unknown;const valid=Boolean(parsed&&typeof parsed==="object"&&!Array.isArray(parsed)&&(parsed as Record<string,unknown>).job_id===job.jobId&&(parsed as Record<string,unknown>).document_id===job.documentId);if(!valid)rejected=true;return valid;}catch{rejected=true;return false;}
    }});
    this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);
    if(!retained){if(rejected)throw new Error("The private generation receipt does not belong to this authorized job.");return;}
    let parsed:unknown;try{parsed=JSON.parse(retained);}catch{throw new Error("The private generation receipt could not be verified for this authorized job.");}
    if(!parsed||typeof parsed!=="object"||Array.isArray(parsed)||(parsed as Record<string,unknown>).job_id!==job.jobId||(parsed as Record<string,unknown>).document_id!==job.documentId)throw new Error("The private generation receipt does not belong to this authorized job.");
  }
  loadDocumentJobDetail(jobId:string,options:SceneGenerationReceiptReadOptions):Promise<SceneGenerationReceiptInspection>;
  loadDocumentJobDetail(jobId:string):Promise<DocumentJob>;
  async loadDocumentJobDetail(jobId:string,options?:SceneGenerationReceiptReadOptions):Promise<DocumentJob|SceneGenerationReceiptInspection>{
    const sourceOwner=this.captureSourceOwnership();this.#assertSourceOwnership(sourceOwner);
    if(options)return this.loadActorDocumentGenerationReceipt(jobId,options);
    const authorization=this.#activeAuthorizationScope();
    const current=this.documentJobs.get().find((job)=>job.jobId===jobId);
    const cached=this.#jobDetails.get(jobId);
    if(cached&&cached.kind!=="structure_adaptive"&&cached.updatedAt===current?.updatedAt){if(cached.jobId!==jobId||cached.documentId!==current.documentId)throw new Error("The retained generation inputs do not belong to this authorized job.");await this.#hydrateDocumentJobGenerationReceipt(cached,authorization);return this.#publicDocumentJobDetail(cached)!;}
    const known=current??cached??this.planningRecoveryEntries().find(entry=>entry.jobId===jobId);
    const adaptive=known?.kind==="structure_adaptive"&&known.planningExecutionId===jobId;
    if(adaptive)this.#rememberPlanningRecovery(known);
    const tracked=adaptive?this.#planningRecoveryIdentities.get(jobId):undefined;
    if(tracked){tracked.deliberateReadRevision=++this.#planningRecoverySequence;tracked.pendingReadRevision=tracked.deliberateReadRevision;delete tracked.preservedReadRevision;delete tracked.terminalReadRevision;}
    const revision=this.#planningRecoveryIdentities.get(jobId)?.revision,terminalRevision=this.#planningRecoveryIdentities.get(jobId)?.terminalRevision??0,startedAt=this.#planningRecoverySequence;
    const deliberateReadRevision=tracked?.deliberateReadRevision??0;
    const currentRead=()=>{const observed=this.#planningRecoveryIdentities.get(jobId);return!adaptive||revision!==undefined&&observed?.revision===revision&&(observed.deliberateReadRevision??0)===deliberateReadRevision&&(observed.certifiedReadRevision??0)<=startedAt&&((observed.withdrawalRevision??0)<=startedAt||observed.preservedReadRevision===deliberateReadRevision);};
    try{
      const response=await fetch(`/api/document-jobs/${encodeURIComponent(jobId)}?inspection=1`);
      this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);
      // Access/retention denial is already authoritative in the headers. A
      // broken or empty error body must not preserve private presentation.
      if(adaptive&&!response.ok&&[401,403,404,410].includes(response.status)){
        this.#withdrawAdaptiveRead(jobId,startedAt);
        throw new Error("planning_result_unavailable");
      }
      const body=await response.json() as {job?:DocumentJob;error?:string};
      this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);
      const candidate=body.job;
      const withdrawn=adaptive&&Boolean(candidate&&candidate.jobId===jobId&&candidate.planningExecutionId===jobId&&candidate.kind==="structure_adaptive"
        &&candidate.documentId===known.documentId&&(candidate.canvasId??null)===(known.canvasId??null)&&candidate.sourceSurface===known.sourceSurface
        &&candidate.requestKey===known.requestKey&&candidate.planningProjectScope===known.planningProjectScope&&candidate.planningLocale===known.planningLocale
        &&(candidate.result?.planningReviewAvailable===false||candidate.result?.resultUnavailable===true));
      if(withdrawn){
        this.#withdrawAdaptiveRead(jobId,startedAt);
        throw new Error("planning_result_unavailable");
      }
      if(!currentRead())throw new Error("planning_result_unavailable");
      if(!response.ok||!body.job)throw new Error(body.error??"The retained generation inputs could not be loaded.");
      const job=body.job;
      if(job.jobId!==jobId||current&&job.documentId!==current.documentId)throw new Error("The retained generation inputs do not belong to this authorized job.");
      const signed=job.kind==="structure_adaptive"&&job.planningExecutionId===jobId;
      if(adaptive&&(!signed||job.documentId!==known.documentId||(job.canvasId??null)!==(known.canvasId??null)||job.sourceSurface!==known.sourceSurface||job.requestKey!==known.requestKey||job.planningProjectScope!==known.planningProjectScope||job.planningLocale!==known.planningLocale))throw new Error("planning_result_identity_changed");
      if(signed&&!adaptive&&(this.#planningRecoveryIdentities.get(jobId)?.revision??0)>startedAt)throw new Error("planning_result_unavailable");
      await this.#hydrateDocumentJobGenerationReceipt(job,authorization);
      this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);
      if(!currentRead()||signed&&!adaptive&&(this.#planningRecoveryIdentities.get(jobId)?.revision??0)>startedAt)throw new Error("planning_result_unavailable");
      if(signed){
        if(job.result?.planningReviewAvailable===false||job.result?.resultUnavailable===true){this.#observeAdaptivePlanningJob(job);throw new Error("planning_result_unavailable");}
        if(!(job.status==="completed"&&job.result?.structure)&&job.result?.planningReviewAvailable!==true)throw new Error("planning_result_unavailable");
        if(job.status!=="completed"&&(this.#planningRecoveryIdentities.get(jobId)?.terminalRevision??0)!==terminalRevision)throw new Error("planning_result_superseded");
        this.#observeAdaptivePlanningJob(job);
      }
      this.#cacheDocumentJobDetail(job);
      if(signed){const certified=this.#planningRecoveryIdentities.get(jobId);if(certified){certified.detailRevision=certified.revision;certified.certifiedReadRevision=Math.max(certified.certifiedReadRevision??0,deliberateReadRevision);delete certified.preservedReadRevision;}}
      this.#trimDocumentJobDetails();
      this.documentJobs.set(this.documentJobs.get().map((entry)=>entry.jobId===jobId?job:entry));
      this.notify();return job;
    }catch(error){
      if(adaptive&&this.#scopeStillActive(authorization)&&currentRead()&&!(error instanceof Error&&error.message==="planning_result_superseded"))this.#clearAdaptivePrivatePresentation(jobId);
      throw error;
    }finally{
      const finished=this.#planningRecoveryIdentities.get(jobId);if(finished?.pendingReadRevision===deliberateReadRevision){delete finished.pendingReadRevision;delete finished.preservedReadRevision;}
    }
  }
  /** Explicit actor-only project receipts never enter shared job or content caches. */
  async loadActorDocumentGenerationReceipt(jobId:string,options?:SceneGenerationReceiptReadOptions):Promise<SceneGenerationReceiptInspection>{
    const sourceOwner=this.captureSourceOwnership();this.#assertSourceOwnership(sourceOwner);
    if(options){
      // Scene handoff is response-only. Neither an old feed row nor a late
      // general content hydration can supply its job or retained source bytes.
      const authorization=this.#activeAuthorizationScope(),documentId=options.documentId,current=options.current;
      const shared=Boolean(this.session.get()?.projectContext),route=this.route.get();
      const access=()=>{const session=this.session.get();return JSON.stringify({context:session?.projectContext??null,permissions:session?.projectContext?.permissions??session?.capabilities??[]});};
      const accessKey=access();
      const unavailable=()=>new Error("The retained generation inputs could not be loaded.");
      const mismatch=()=>new Error("The retained generation inputs do not belong to this authorized job.");
      const verifyCurrent=()=>{
        this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);
        const session=this.session.get(),permissions=session?.projectContext?.permissions??session?.capabilities??[];
        if(options.fresh!==true||typeof documentId!=="string"||!documentId.trim()||typeof jobId!=="string"||!jobId.trim()
          ||Boolean(session?.projectContext)!==shared||access()!==accessKey||this.route.get()!==route
          ||!permissions.some(permission=>permission==="project.read"||permission==="project.output.request")
          ||session?.projectContext&&!(Date.parse(session.projectContext.expiresAt)>Date.now())
          ||current!==undefined&&(typeof current!=="function"||!current()))throw unavailable();
      };
      const read=async(url:string)=>{
        verifyCurrent();
        const response=await fetch(url,{cache:"no-store"});
        verifyCurrent();
        // Denial headers are authoritative even if their body never resolves.
        if(!response.ok&&[401,403,404,410].includes(response.status))throw unavailable();
        const body=await response.json() as {job?:DocumentJob;content?:Record<string,unknown>};
        verifyCurrent();
        if(!response.ok||!body||typeof body!=="object"||Array.isArray(body))throw unavailable();
        return body;
      };
      const matches=(job:unknown):job is DocumentJob=>sceneCostJobMatches(job,jobId,documentId)&&(job as DocumentJob).result?.artifactKind==="scene";
      const identity=(job:DocumentJob)=>JSON.stringify([job.jobId,job.documentId,job.kind,job.canvasId??null,job.sourceSurface,job.requestKey,job.documentRevision,job.requestedAt]);
      verifyCurrent();
      const listed=this.documentJobs.get().find(job=>job.jobId===jobId);
      if(listed&&listed.documentId!==documentId)throw mismatch();
      const inspected=await read("/api/document-jobs/"+encodeURIComponent(jobId)+"?inspection=1");
      verifyCurrent();
      if(!matches(inspected.job))throw mismatch();
      let job=inspected.job,content:Record<string,unknown>|undefined;
      if(shared){
        const receipt=await read("/api/document-jobs/"+encodeURIComponent(jobId)+"/private-receipt");
        verifyCurrent();
        if(!matches(receipt.job)||identity(receipt.job)!==identity(job))throw mismatch();
        job=receipt.job;content=receipt.content;
      }
      const receipt=job.result?.generationReceipt;
      const reference=receipt&&typeof receipt==="object"&&!Array.isArray(receipt)?(receipt as Record<string,unknown>).input_ref:null;
      if(typeof reference!=="string"||!reference.trim())throw unavailable();
      if(!shared){
        const retained=await read("/api/events?after="+this.head.get()+"&limit=1&content=1");
        verifyCurrent();content=retained.content;
      }
      if(!content||typeof content!=="object"||Array.isArray(content)||shared&&Object.keys(content).length!==1
        ||!Object.hasOwn(content,reference)||typeof content[reference]!=="string")throw unavailable();
      const raw=content[reference];let retained:unknown;
      try{retained=JSON.parse(raw);}catch{throw unavailable();}
      if(!retained||typeof retained!=="object"||Array.isArray(retained)
        ||(retained as Record<string,unknown>).job_id!==jobId||(retained as Record<string,unknown>).document_id!==documentId)throw mismatch();
      const selected:Record<string,string>={[reference]:raw};
      const prompt=job.moderationPromptRef;
      if(!shared&&typeof prompt==="string"&&prompt.trim()&&prompt!==reference&&Object.hasOwn(content,prompt)&&typeof content[prompt]==="string")selected[prompt]=content[prompt];
      verifyCurrent();
      return{job,content:selected};
    }
    const authorization=this.#activeAuthorizationScope();
    if(!this.session.get()?.projectContext)throw new Error("Actor-private project receipts require an active project context.");
    const current=this.documentJobs.get().find((job)=>job.jobId===jobId);
    if(!current)throw new Error("The retained generation inputs do not belong to this authorized job.");
    const response=await fetch(`/api/document-jobs/${encodeURIComponent(jobId)}/private-receipt`);
    const body=await response.json() as {job?:DocumentJob;content?:Record<string,unknown>;error?:string};
    this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);
    if(!this.session.get()?.projectContext||!response.ok||!body.job)throw new Error(body.error??"The actor-private generation receipt could not be loaded.");
    if(body.job.jobId!==jobId||body.job.documentId!==current.documentId)throw new Error("The retained generation inputs do not belong to this authorized job.");
    const receipt=body.job.result?.generationReceipt;
    const reference=receipt&&typeof receipt==="object"&&!Array.isArray(receipt)?(receipt as Record<string,unknown>).input_ref:null;
    if(typeof reference!=="string"||!reference.trim()||!body.content||Object.keys(body.content).length!==1||typeof body.content[reference]!=="string")throw new Error("The actor-private generation receipt could not be verified.");
    let retained:unknown;try{retained=JSON.parse(body.content[reference]);}catch{throw new Error("The actor-private generation receipt could not be verified.");}
    if(!retained||typeof retained!=="object"||Array.isArray(retained)||(retained as Record<string,unknown>).job_id!==jobId||(retained as Record<string,unknown>).document_id!==current.documentId)throw new Error("The private generation receipt does not belong to this authorized job.");
    this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);
    return{job:body.job,content:{[reference]:body.content[reference]}};
  }
  /** Issue-note bodies remain actor-private and never enter shared job or content caches. */
  async loadActivityIssueNotes(jobId:string):Promise<ActivityIssueNote[]>{
    const sourceOwner=this.captureSourceOwnership();this.#assertSourceOwnership(sourceOwner);
    const authorization=this.#activeAuthorizationScope();
    const current=this.documentJobs.get().find((job)=>job.jobId===jobId);
    if(!current)throw new Error("The issue notes do not belong to this authorized job.");
    const response=await fetch(`/api/document-jobs/${encodeURIComponent(jobId)}/notes`);
    const body=await response.json() as {jobId?:string;documentId?:string;notes?:ActivityIssueNote[];error?:string};
    this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);
    if(!response.ok||body.jobId!==jobId||body.documentId!==current.documentId||!Array.isArray(body.notes)){
      throw new Error(body.error??"The private issue notes could not be loaded.");
    }
    if(body.notes.some((note)=>!note.id||typeof note.body!=="string"||!note.createdAt||!note.expiresAt)){
      throw new Error("The private issue notes could not be verified.");
    }
    return body.notes;
  }
  async saveActivityIssueNote(jobId:string,value:string):Promise<ActivityIssueNote>{
    const authorization=this.#activeAuthorizationScope();
    const current=this.documentJobs.get().find((job)=>job.jobId===jobId);
    const note=value.trim();
    if(!current||!note||note.length>2_000)throw new Error("Add a private issue note of no more than 2,000 characters.");
    const response=await this.guardedFetch(`/api/document-jobs/${encodeURIComponent(jobId)}/notes`,{
      method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({body:note}),
    },"save this private issue note");
    this.#assertAuthorizationScope(authorization);
    const body=await response.json() as {jobId?:string;documentId?:string;note?:ActivityIssueNote;error?:string};
    this.#assertAuthorizationScope(authorization);
    if(!response.ok||body.jobId!==jobId||body.documentId!==current.documentId||!body.note?.id||body.note.body!==note){
      throw new Error(body.error??"The private issue note could not be saved.");
    }
    await this.#refreshEvents();
    this.#assertAuthorizationScope(authorization);
    return body.note;
  }
  /** Rejected provider drafts remain ephemeral actor-private values, never shared job/content state. */
  async loadPreservedPresentationCandidateJobs(documentId:string):Promise<PreservedPresentationCandidateJobs>{
    const sourceOwner=this.captureSourceOwnership();this.#assertSourceOwnership(sourceOwner);
    const authorization=this.#activeAuthorizationScope();
    if(!documentId||this.projection.get().documentId!==documentId)throw new Error("The preserved presentation drafts do not belong to this authorized document.");
    const response=await fetch(`/api/document-jobs/presentation-candidates?document=${encodeURIComponent(documentId)}`);
    this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);
    const body=await response.json() as Partial<PreservedPresentationCandidateJobs>&{error?:string};
    this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);
    if(!response.ok||body.documentId!==documentId||!Array.isArray(body.jobs))throw new Error(body.error??"The preserved presentation drafts could not be verified.");
    if(body.jobs.some((listing)=>!listing.jobId||listing.documentId!==documentId||!Array.isArray(listing.candidates)
      ||listing.candidates.some((candidate)=>candidate.jobId!==listing.jobId||candidate.documentId!==documentId||candidate.retentionClass!=="governed-evidence")))throw new Error("A preserved presentation draft does not belong to this authorized document.");
    this.#assertPresentationCandidatePayload(body);
    return body as PreservedPresentationCandidateJobs;
  }
  async loadPresentationCandidates(jobId:string,documentId?:string):Promise<PresentationCandidateList>{
    const sourceOwner=this.captureSourceOwnership();this.#assertSourceOwnership(sourceOwner);
    const authorization=this.#activeAuthorizationScope();
    const current=this.documentJobs.get().find((job)=>job.jobId===jobId);
    const authorizedDocument=current?.documentId??documentId;
    if(!authorizedDocument||documentId&&authorizedDocument!==documentId||!current&&authorizedDocument!==this.projection.get().documentId)throw new Error("The private presentation drafts do not belong to this authorized document.");
    const response=await fetch(`/api/document-jobs/${encodeURIComponent(jobId)}/presentation-candidates`);
    this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);
    const body=await response.json() as Partial<PresentationCandidateList>&{error?:string};
    this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);
    if(!response.ok||body.jobId!==jobId||body.documentId!==authorizedDocument||!Array.isArray(body.candidates))throw new Error(body.error??"The private presentation drafts could not be verified.");
    if(body.candidates.some((candidate)=>candidate.jobId!==jobId||candidate.documentId!==authorizedDocument))throw new Error("A private presentation draft does not belong to this authorized document.");
    this.#assertPresentationCandidatePayload(body);
    return body as PresentationCandidateList;
  }
  async loadPresentationCandidate(jobId:string,responseId:string,documentId?:string):Promise<PresentationCandidateDetail>{
    const sourceOwner=this.captureSourceOwnership();this.#assertSourceOwnership(sourceOwner);
    const authorization=this.#activeAuthorizationScope();
    const current=this.documentJobs.get().find((job)=>job.jobId===jobId);
    const authorizedDocument=current?.documentId??documentId;
    if(!authorizedDocument||!responseId||documentId&&authorizedDocument!==documentId||!current&&authorizedDocument!==this.projection.get().documentId)throw new Error("The private presentation draft does not belong to this authorized document.");
    const response=await fetch(`/api/document-jobs/${encodeURIComponent(jobId)}/presentation-candidates/${encodeURIComponent(responseId)}`);
    this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);
    const body=await response.json() as {jobId?:string;documentId?:string;candidate?:PresentationCandidateDetail;error?:string};
    this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);
    if(!response.ok||body.jobId!==jobId||body.documentId!==authorizedDocument||!body.candidate||body.candidate.jobId!==jobId||body.candidate.documentId!==authorizedDocument||body.candidate.responseId!==responseId)throw new Error(body.error??"The private presentation draft could not be verified.");
    this.#assertPresentationCandidatePayload(body);
    return body.candidate;
  }
  async preservePresentationCandidate(jobId:string,responseId:string,documentId?:string):Promise<PresentationCandidateSummary>{
    const sourceOwner=this.captureSourceOwnership();this.#assertSourceOwnership(sourceOwner);
    const authorization=this.#activeAuthorizationScope();
    const current=this.documentJobs.get().find((job)=>job.jobId===jobId);
    const authorizedDocument=current?.documentId??documentId;
    if(!authorizedDocument||!responseId||documentId&&authorizedDocument!==documentId||!current&&authorizedDocument!==this.projection.get().documentId)throw new Error("The private presentation draft does not belong to this authorized document.");
    let dispatched=false;
    const response=await this.guardedFetch(`/api/document-jobs/${encodeURIComponent(jobId)}/presentation-candidates/${encodeURIComponent(responseId)}/preserve`,{method:"POST"},"preserve this actor-private presentation draft",{current:()=>dispatched||this.sourceOwnershipActive(sourceOwner),onDispatch:()=>{dispatched=true;}});
    this.#assertAuthorizationScope(authorization);
    const body=await response.json() as {jobId?:string;documentId?:string;candidate?:PresentationCandidateSummary;error?:string};
    this.#assertAuthorizationScope(authorization);
    if(!response.ok||body.jobId!==jobId||body.documentId!==authorizedDocument||!body.candidate||body.candidate.jobId!==jobId||body.candidate.documentId!==authorizedDocument||body.candidate.responseId!==responseId||body.candidate.retentionClass!=="governed-evidence")throw new Error(body.error??"The private presentation draft could not be safely preserved.");
    this.#assertPresentationCandidatePayload(body);
    return body.candidate;
  }
  /** Submit visible patches only; never cache a rejected body or rewrite the original job. */
  async revisePresentationCandidate(jobId:string,responseId:string,input:PresentationCandidateRevisionRequest,documentId?:string):Promise<{revision:PresentationCandidateRevisionResult}|{issues:PresentationCandidateValidationIssue[]}>{
    const sourceOwner=this.captureSourceOwnership();this.#assertSourceOwnership(sourceOwner);
    const authorization=this.#activeAuthorizationScope();
    const current=this.documentJobs.get().find(job=>job.jobId===jobId),authorizedDocument=current?.documentId??documentId;
    if(!authorizedDocument||!responseId||documentId&&authorizedDocument!==documentId||!current&&authorizedDocument!==this.projection.get().documentId)throw new Error("The private presentation draft does not belong to this authorized document.");
    let dispatched=false;
    const response=await this.guardedFetch(`/api/document-jobs/${encodeURIComponent(jobId)}/presentation-candidates/${encodeURIComponent(responseId)}/revisions`,{
      method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(input),
    },"validate and create a separate unapproved presentation draft without a provider call",{
      current:()=>dispatched||this.sourceOwnershipActive(sourceOwner),onDispatch:()=>{dispatched=true;},
    });
    this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);
    const body=await response.json() as Partial<PresentationCandidateRevisionResult>&{error?:string;issues?:PresentationCandidateValidationIssue[]};
    this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);
    this.#assertPresentationCandidatePayload(body);
    if(response.status===422&&body.error==="presentation_revision_validation_failed"&&Array.isArray(body.issues))return{issues:body.issues};
    if(!response.ok||body.jobId!==jobId||body.documentId!==authorizedDocument||body.responseId!==responseId
      ||typeof body.artifactId!=="string"||!/^presentation-revision-[a-f0-9]{64}$/u.test(body.artifactId)
      ||body.providerCalls!==0||body.incrementalCostMicrousd!==0||body.approval!=="unapproved"||typeof body.reused!=="boolean")throw new Error(body.error??"The revised presentation could not be safely saved.");
    return{revision:body as PresentationCandidateRevisionResult};
  }
  #assertPresentationCandidatePayload(value:unknown){
    if(Array.isArray(value)){for(const entry of value)this.#assertPresentationCandidatePayload(entry);return;}
    if(!value||typeof value!=="object")return;
    for(const[key,entry]of Object.entries(value)){
      if(/^(?:raw|candidateRaw|output_text|contentRef|content_ref|source(?:Snapshot|Alias|Id)|source_id|source_ids|compiledSnapshot|image_prompt|providerInput|content_markdown|context_group_ids)$/iu.test(key))throw new Error("The private presentation draft contains disallowed source or provider data.");
      this.#assertPresentationCandidatePayload(entry);
    }
  }
  async dismissDocumentJobFailure(jobId:string){
    const sourceOwner=this.captureSourceOwnership(),authorization=this.#activeAuthorizationScope();
    const original=this.documentJobs.get().find(job=>job.jobId===jobId);
    try{
      const response=await this.guardedFetch(`/api/document-jobs/${encodeURIComponent(jobId)}/dismiss`,{method:"POST"},"dismiss this generation issue");
      this.#assertAuthorizationScope(authorization);
      const body=await response.json() as {job?:DocumentJob;error?:string};this.#assertAuthorizationScope(authorization);
      if(!response.ok||!body.job)throw new Error(body.error??"Generation issue could not be dismissed");
      const updated=this.#sourceOwnedJobResponse(sourceOwner,jobId,body.job,original);
      if(!updated)return true;
      this.documentJobs.set(this.documentJobs.get().map(job=>job.jobId===jobId?updated:job));
      this.toast(!this.sourceOwnershipActive(sourceOwner)?this.#systemNotice("The server acknowledged the original change. Its private view is unavailable."):this.session.get()?.projectContext?"Generation notice dismissed. Failure details remain available; generation inputs stay private to their author.":"Generation notice dismissed. Its retained inputs remain in this document’s failure history.");
      this.notify();return true;
    }catch(error){if(this.#scopeStillActive(authorization)&&this.sourceOwnershipActive(sourceOwner))this.toast(error instanceof Error?error.message:"Generation issue could not be dismissed");return false;}
  }
  #savedPresentationReceiptSequence=0;
  /** Reconcile retained evidence for one legacy slideshow. Never starts provider work or resumes the job. */
  async checkSavedPresentationReceipt(jobId:string,options:{current?:()=>boolean}={}):Promise<PresentationReceiptCheckStatus|null>{
    const sequence=++this.#savedPresentationReceiptSequence,sourceOwner=this.captureSourceOwnership(),authorization=this.#activeAuthorizationScope();
    const original=this.documentJobs.get().find(job=>job.jobId===jobId),route=this.route.get(),projectId=this.projection.get().projectId;
    const navigation=this.#workspaceTransition,cookieGeneration=this.#projectContextCookieGeneration,sessionRevision=this.#sessionRevision;
    const access=()=>JSON.stringify({context:this.session.get()?.projectContext??null,capabilities:this.session.get()?.capabilities??[],impersonating:Boolean(this.session.get()?.impersonation)}),accessKey=access();
    const version=(job:DocumentJob|undefined)=>job?JSON.stringify([job.jobId,job.documentId,job.kind,job.status,job.sourceSurface,job.requestKey,job.requestedAt,job.documentRevision,job.updatedAt,job.attemptCount]):"";
    const originalVersion=version(original);
    const current=()=>sequence===this.#savedPresentationReceiptSequence&&this.#scopeStillActive(authorization)&&this.sourceOwnershipActive(sourceOwner)
      &&navigation===this.#workspaceTransition&&sessionRevision===this.#sessionRevision&&cookieGeneration===this.#projectContextCookieGeneration&&cookieGeneration===this.#projectContextSessionGeneration
      &&this.route.get()===route&&this.projection.get().projectId===projectId&&this.projection.get().documentId===original?.documentId
      &&access()===accessKey&&version(this.documentJobs.get().find(job=>job.jobId===jobId))===originalVersion&&(!options.current||options.current());
    try{
      if(!current())return null;
      if(!original||!this.session.get()||this.session.get()?.impersonation||!documentJobCanCheckSavedPresentationReceipt(original))throw new Error("saved_receipt_unavailable");
      const response=await this.guardedFetch(`/api/document-jobs/${encodeURIComponent(jobId)}/reconcile-provider`,{method:"POST"},"check this saved slideshow receipt without new generation",{current});
      if(!current())return null;
      const body:unknown=await response.json();
      if(!current())return null;
      const checked=savedPresentationReceiptCheckResponse(original,body);
      if(!response.ok||!checked)throw new Error("saved_receipt_unavailable");
      // An inconclusive reply cannot rewrite the job, private detail cache, or any budget display.
      if(checked.status==="known"){
        const updated=this.#sourceOwnedJobResponse(sourceOwner,jobId,checked.job,original);
        if(updated)this.documentJobs.set(this.documentJobs.get().map(job=>job.jobId===jobId?updated:job));
      }
      this.toast(this.#systemNotice(savedPresentationReceiptCheckMessage(checked.status)));this.notify();
      return checked.status;
    }catch{
      if(!current())return null;
      this.toast(this.#systemNotice(savedPresentationReceiptCheckMessage("unavailable")));
      return "unavailable";
    }
  }
  #serverOwnedJob(jobId:string){
    const listed=this.documentJobs.get().find(job=>job.jobId===jobId),detail=this.#jobDetails.get(jobId);
    return Boolean(listed&&hasServerExecutionOwner(listed)||detail&&hasServerExecutionOwner(detail));
  }
  async reconcileDocumentProviderReceipt(jobId:string){
    if(this.#serverOwnedJob(jobId))return false;
    const sourceOwner=this.captureSourceOwnership(),authorization=this.#activeAuthorizationScope();
    try{
      const session=this.session.get();
      const original=this.documentJobs.get().find((job)=>job.jobId===jobId);
      if(original&&hasServerExecutionOwner(original))return false;
      if(!session||session.impersonation||session.projectContext&&session.projectContext.ownerUserId!==session.user.userId||!original||original.kind!=="render_document"||original.status!=="failed"||original.result?.artifactKind!=="storyboard"||original.result.storyboardProviderSubmission!=="pending"||original.result.providerJobId)throw new Error("The saved provider render could not be recovered");
      const response=await this.guardedFetch(`/api/document-jobs/${encodeURIComponent(jobId)}/reconcile-provider`,{method:"POST"},"refresh this saved provider receipt without submitting another paid request");
      this.#assertAuthorizationScope(authorization);
      const body=await response.json() as {job?:DocumentJob;error?:string;reconciledProviderRequest?:boolean;providerStatus?:number;providerErrorClass?:string;providerErrorCode?:string};
      this.#assertAuthorizationScope(authorization);
      if(!response.ok&&body.error==="provider_receipt_lookup_failed"){
        const status=Number.isSafeInteger(body.providerStatus)&&Number(body.providerStatus)>=400&&Number(body.providerStatus)<=599?`HTTP ${body.providerStatus}`:"";
        const errorClass=typeof body.providerErrorClass==="string"&&["TypeError","AbortError","DOMException","Error"].includes(body.providerErrorClass)?body.providerErrorClass:"";
        const errorCode=typeof body.providerErrorCode==="string"&&/^[A-Z][A-Z0-9_]{0,63}$/u.test(body.providerErrorCode)?body.providerErrorCode:"";
        const diagnostic=status||[errorClass,errorCode].filter(Boolean).join(" ");
        throw new Error(diagnostic?`${body.error} (${diagnostic})`:body.error);
      }
      const providerJobId=body.job?.result?.providerJobId;
      if(!response.ok||body.reconciledProviderRequest!==true||!body.job||body.job.jobId!==jobId||body.job.documentId!==original.documentId||body.job.kind!=="render_document"||body.job.status!=="failed"||body.job.result?.artifactKind!=="storyboard"||body.job.result.storyboardProviderSubmission!=="confirmed"||!session.projectContext&&(typeof providerJobId!=="string"||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u.test(providerJobId)||["pending","submitted","unknown"].includes(providerJobId.toLowerCase())))throw new Error(body.error??"The saved provider render could not be recovered");
      const updated=this.#sourceOwnedJobResponse(sourceOwner,jobId,body.job,original);
      if(!updated)return true;
      this.documentJobs.set(this.documentJobs.get().map((job)=>job.jobId===jobId?updated:job));
      this.toast(this.#systemNotice(this.sourceOwnershipActive(sourceOwner)?"Paid once · replay without another provider call":"The server acknowledged the original change. Its private view is unavailable."));
      this.notify();
      return true;
    }catch(error){if(this.#scopeStillActive(authorization)&&this.sourceOwnershipActive(sourceOwner))this.toast(error instanceof Error?error.message:"The saved provider render could not be recovered");return false;}
  }
  readonly safetyDeliveryPending=new Set<string>();
  async acknowledgeGenerationSafety(job:DocumentJob){
    if(!documentJobCanAcknowledgeSafety(job)||this.safetyDeliveryPending.has(job.jobId)||this.#serverOwnedJob(job.jobId))return false;
    const sourceOwner=this.captureSourceOwnership(),authorization=this.#activeAuthorizationScope();
    this.safetyDeliveryPending.add(job.jobId);this.notify();
    try{
      const response=await this.guardedFetch(`/api/document-jobs/${encodeURIComponent(job.jobId)}/acknowledge-safety`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({acknowledged:true,attemptCount:job.attemptCount})},"deliver this reviewed generation request to the model");
      this.#assertAuthorizationScope(authorization);
      const body=await response.json() as {job?:DocumentJob;error?:string;message?:string};this.#assertAuthorizationScope(authorization);
      if(!response.ok||!body.job)throw new Error(body.message??body.error??"Generation delivery could not be confirmed. Refresh status before trying again.");
      const updated=this.#sourceOwnedJobResponse(sourceOwner,job.jobId,body.job,job);
      if(updated){this.documentJobs.set([updated,...this.documentJobs.get().filter(current=>current.jobId!==job.jobId)]);this.notify();}
      if(this.sourceOwnershipActive(sourceOwner)){this.#driveDocumentJobs(this.documentJobs.get());this.#scheduleJobPoll(800);}
      return true;
    }catch(error){if(this.#scopeStillActive(authorization)&&this.sourceOwnershipActive(sourceOwner))this.toast(error instanceof Error?error.message:this.#systemNotice("Generation delivery could not be confirmed."));return false;}
    finally{this.safetyDeliveryPending.delete(job.jobId);this.notify();}
  }
  async recoverDocumentRender(jobId:string){
    if(this.#serverOwnedJob(jobId))return false;
    const sourceOwner=this.captureSourceOwnership(),authorization=this.#activeAuthorizationScope();
    try{
      const original=this.documentJobs.get().find(job=>job.jobId===jobId);
      const response=await this.guardedFetch(`/api/document-jobs/${encodeURIComponent(jobId)}/retry`,{method:"POST"},"recover this completed provider render");
      this.#assertAuthorizationScope(authorization);
      const body=await response.json() as {job?:DocumentJob;error?:string;reason?:string};this.#assertAuthorizationScope(authorization);
      if(!response.ok||!body.job){const reason=typeof body.reason==="string"&&/^[a-z0-9_]{1,120}$/u.test(body.reason)?` (${body.reason})`:"";throw new Error((body.error??"The saved provider render could not be recovered")+reason);}
      const updated=this.#sourceOwnedJobResponse(sourceOwner,jobId,body.job,original);
      if(!updated)return true;
      this.documentJobs.set([updated,...this.documentJobs.get().filter(job=>job.jobId!==jobId)]);
      const medium=original?.result?.artifactKind==="storyboard"?"Storyboard":original?.result?.artifactKind==="audio"?"Audio":"Video";
      this.toast(!this.sourceOwnershipActive(sourceOwner)?this.#systemNotice("The server acknowledged the original change. Its private view is unavailable."):medium==="Video"?"Recovering the saved Fal video. No second paid video was submitted.":[this.#systemNotice(medium),this.#systemNotice("Paid once · replay without another provider call")].join(" · "));
      this.notify();
      if(this.sourceOwnershipActive(sourceOwner)){this.#driveDocumentJobs(this.documentJobs.get());this.#scheduleJobPoll(800);}
      return true;
    }catch(error){if(this.#scopeStillActive(authorization)&&this.sourceOwnershipActive(sourceOwner))this.toast(error instanceof Error?error.message:"The saved provider render could not be recovered");return false;}
  }
  async recoverDocumentPresentation(jobId:string){
    if(this.#serverOwnedJob(jobId))return false;
    const sourceOwner=this.captureSourceOwnership(),authorization=this.#activeAuthorizationScope();
    const original=this.documentJobs.get().find((job)=>job.jobId===jobId);
      if(original&&hasServerExecutionOwner(original))return false;
    try{
      if(!original||!documentJobCanRecoverPresentation(original))throw new Error("The saved presentation response could not be recovered");
      const response=await this.guardedFetch(`/api/document-jobs/${encodeURIComponent(jobId)}/recover`,{method:"POST"},"recover this saved presentation without another provider request");
      this.#assertAuthorizationScope(authorization);
      const body=await response.json() as {job?:DocumentJob;error?:string;reason?:string};
      this.#assertAuthorizationScope(authorization);
      if(!response.ok||!body.job)throw new Error(body.reason&&body.error?`${body.error}: ${body.reason}`:body.error??"The saved presentation response could not be recovered");
      if(body.job.jobId!==jobId||body.job.documentId!==original.documentId)throw new Error("The saved presentation response does not belong to this authorized document");
      const updated=this.#sourceOwnedJobResponse(sourceOwner,jobId,body.job,original);
      if(!updated)return true;
      this.documentJobs.set([updated,...this.documentJobs.get().filter((job)=>job.jobId!==jobId)]);
      // The original server acknowledgement is not undone by a failed view read.
      let viewAvailable=this.sourceOwnershipActive(sourceOwner);
      if(viewAvailable){
        try{await this.#refreshEvents();}catch{viewAvailable=false;}
        this.#assertAuthorizationScope(authorization);
        viewAvailable=viewAvailable&&this.sourceOwnershipActive(sourceOwner);
      }
      this.toast(this.#systemNotice(viewAvailable?"Paid once · replay without another provider call":"The server acknowledged the original change. Its private view is unavailable."));
      this.notify();
      return true;
    }catch(error){if(this.#scopeStillActive(authorization)&&this.sourceOwnershipActive(sourceOwner))this.toast(error instanceof Error?error.message:"The saved provider render could not be recovered");return false;}
  }
  async stopDocumentJob(jobId:string,force=false){
    if(this.#serverOwnedJob(jobId))return false;
    const sourceOwner=this.captureSourceOwnership(),authorization=this.#activeAuthorizationScope();
    const original=this.documentJobs.get().find(job=>job.jobId===jobId);
    try{
      const response=await this.guardedFetch(`/api/document-jobs/${encodeURIComponent(jobId)}/${force?"force-fail":"cancel"}`,{method:"POST"},force?"force-fail this document operation":"stop this document operation");
      this.#assertAuthorizationScope(authorization);
      const body=await response.json() as {job?:DocumentJob;budget?:DocumentJobStopBudget;stoppedCount?:number;error?:string};
      this.#assertAuthorizationScope(authorization);
      if(!response.ok||!body.job){
        const messages:Record<string,string>={job_finalizing:"This operation is already finalizing and can no longer be stopped.",provider_submission_in_flight:"The provider request is being submitted. Wait until its receipt is confirmed before stopping this generation.",admin_required:"Only an administrator can force-fail an operation."};
        throw new Error(messages[body.error??""]??body.error??"The operation could not be stopped");
      }
      const updated=this.#sourceOwnedJobResponse(sourceOwner,jobId,body.job,original);
      if(!updated)return documentJobTerminal(body.job);
      this.documentJobs.set(this.documentJobs.get().map((job)=>job.jobId===jobId?updated:job));
      const outcome=body.job.status==="completed"||body.job.status==="partial"||body.stoppedCount===0&&documentJobTerminal(body.job)?"Operation already finished.":body.job.status==="canceled"?"Operation stopped.":body.job.status==="failed"?(force?"Operation force-failed.":"Operation stopped."):"The stop is not yet confirmed.";
      let viewAvailable=this.sourceOwnershipActive(sourceOwner);
      if(viewAvailable){
        try{await Promise.all([this.syncDocumentJobs(),this.refreshSession()]);}catch{viewAvailable=false;}
        this.#assertAuthorizationScope(authorization);
        viewAvailable=viewAvailable&&this.sourceOwnershipActive(sourceOwner);
      }
      this.toast(this.#systemNotice(outcome)+" "+this.#systemNotice(documentJobStopBudgetMessage(body.budget))
        +(!viewAvailable&&documentJobTerminal(body.job)?" "+this.#systemNotice("The server acknowledged the original change. Its private view is unavailable."):""));
      this.notify();
      return documentJobTerminal(body.job);
    }catch(error){if(this.#scopeStillActive(authorization)&&this.sourceOwnershipActive(sourceOwner))this.toast(error instanceof Error?error.message:"The operation could not be stopped");return false;}
  }
  #flushPendingJobNotices(){
    if(!this.#jobFeedCurrent()||document.visibilityState!=="visible"||!this.#pendingJobNotices.length)return;
    const feedRevision=this.#jobFeedRevision,sourceOwner=this.captureSourceOwnership();
    const jobs=this.#pendingJobNotices.splice(0).filter(job=>!documentJobIsMemory(job)&&job.sourceSurface!=="native-image");
    if(!jobs.length)return;
    const locale=currentFormaLocale(),source="{count} background document operations finished.";
    const combined=(locale.messages[formaSystemMessageId(source)]??source).replace("{count}",new Intl.NumberFormat(locale.formatLocale).format(jobs.length));
    this.toast(jobs.length===1?this.#jobNotice(jobs[0]):combined);
    if(!this.sourceOwnershipActive(sourceOwner))return;
    if(!this.#jobFeedCurrent(feedRevision)){this.#pendingJobNotices.unshift(...jobs);return;}
    for(const job of jobs)if(!job.canvasId||this.#jobResultVisible(job))void this.#ackJob(job.jobId,job);
  }
  #outputSourceProjectId(){return this.#sourceRetired?this.#retiredSourceProjectId:this.projection.get().projectId||null;}
  captureSourceOwnership():CapturedSourceOwnership|null{
    const authorization=this.captureAuthorizationScope();if(!authorization)return null;
    const source=Object.freeze({authorization:Object.freeze({...authorization}),generation:this.#sourceGeneration});
    this.#sourceOwners.set(source,this.session.get()?.projectContext?.expiresAt??null);return source;
  }
  /** Ownership only. This permits bookkeeping for the original request, never private publication. */
  sourceOwnershipScopeActive(source:CapturedSourceOwnership|null):boolean{
    return Boolean(source&&this.#sourceOwners.has(source)&&this.authorizationScopeActive(source.authorization));
  }

  #sourceExpiryValid(expiry:string|null|undefined){return expiry===null||typeof expiry==="string"&&Number.isFinite(Date.parse(expiry))&&Date.parse(expiry)>Date.now();}
  #sourceDeadlineCurrent(source:CapturedSourceOwnership|null){
    return Boolean(source&&this.#sourceExpiryValid(this.#sourceOwners.get(source))
      &&this.#sourceExpiryValid(this.session.get()?.projectContext?.expiresAt??null));
  }
  #sourceReadOwned(read:EventSourceRead){return read.cookieGeneration===this.#projectContextCookieGeneration&&this.sourceOwnershipScopeActive(read.source)&&read.source.generation===this.#sourceGeneration;}

  sourceOwnershipActive(source:CapturedSourceOwnership|null):boolean{
    return Boolean(source&&this.sourceOwnershipScopeActive(source)&&source.generation===this.#sourceGeneration&&!this.#sourceRetired&&this.#sourceDeadlineCurrent(source));
  }
  #assertSourceOwnership(source:CapturedSourceOwnership|null){
    if(this.#projectContextCookieGeneration!==this.#projectContextSessionGeneration||!this.sourceOwnershipActive(source))throw new Error("The current source is unavailable; its private result was withheld.");
  }
  #sourceReadCurrent(read:EventSourceRead){
    return this.#projectContextCookieGeneration===this.#projectContextSessionGeneration
      &&this.#sourceReadOwned(read)&&this.#sourceDeadlineCurrent(read.source)&&this.#sourceExpiryValid(read.identity.accessExpiresAt??null);
  }
  #assertSourceRead(read:EventSourceRead){
    if(!this.#sourceReadCurrent(read))throw new Error("The source read was superseded; its private result was withheld.");
  }
  #beginSourceRead(profile:AccountSnapshotProfile):EventSourceRead{
    if(this.#projectContextCookieGeneration!==this.#projectContextSessionGeneration)throw new Error("The project context session must be reconciled before reading this source.");
    const source=this.captureSourceOwnership(),session=this.session.get();
    if(!source||!session)throw new Error("Authentication is required to read this source.");
    // A denied whole source is restored from a complete fresh stream, never an old incremental base.
    const actual=this.#sourceRetired?"full":profile,identity=this.#snapshotIdentity(session);
    return{source,id:++this.#sourceReadSequence,profile:actual,identity,
      cacheFence:captureAccountSnapshotFence(identity,actual),complete:false,from:0,cookieGeneration:this.#projectContextCookieGeneration};
  }
  #sourceCacheGuard(read:EventSourceRead,complete=false){
    return{fence:read.cacheFence,current:()=>this.#sourceReadCurrent(read)&&accountSnapshotFenceCurrent(read.identity,read.cacheFence)
      &&(!complete||read.complete&&!this.#sourceRetired&&this.#sourcePublishedRead===read.id)};
  }
  #sourceOwnedJobResponse(source:CapturedSourceOwnership|null,jobId:string,job:DocumentJob,original?:Pick<DocumentJob,"documentId"|"kind">):DocumentJob|null{
    if(!job||typeof job!=="object"||Array.isArray(job)||job.jobId!==jobId||typeof job.documentId!=="string"||!job.documentId
      ||!DOCUMENT_JOB_KINDS.includes(job.kind)||!documentJobTerminal(job)&&!["queued","running","committing"].includes(job.status)
      ||original&&(job.documentId!==original.documentId||job.kind!==original.kind))
      throw new Error("The original change is unconfirmed. It has not been resubmitted.");
    if(!this.sourceOwnershipScopeActive(source))throw new Error("The active workspace changed; the previous result was safely discarded.");
    const sourceActive=this.#projectContextCookieGeneration===this.#projectContextSessionGeneration&&this.sourceOwnershipActive(source),reference=this.#privateJobReference(job);
    const cached=this.#jobDetails.get(jobId),current=this.documentJobs.get().find(entry=>entry.jobId===jobId);
    // Exact reads and complete original acknowledgements require their captured Source after the
    // last await. Preserve a later exact read during the same Source as well
    // as after retirement, which clears this cache before any new exact read.
    // A renewed deadline alone, an absent/other detail, or a mere new source
    // read is not this proof. Never copy private fields from the old response.
    if((sourceActive||source!.generation<this.#sourceGeneration&&this.sourceOwnershipActive(this.captureSourceOwnership())
      &&this.#sourcePausedJobs.get(jobId)===source!.authorization.key)
      &&cached&&current&&cached.jobId===jobId&&current.jobId===jobId
      &&cached.documentId===job.documentId&&current.documentId===job.documentId&&cached.kind===job.kind&&current.kind===job.kind
      &&current.result===cached.result&&JSON.stringify(this.#privateJobReference(current))===JSON.stringify(this.#privateJobReference(cached))){
      const incomingVersion=Date.parse(job.updatedAt),currentVersion=Date.parse(current.updatedAt);
      if(JSON.stringify(this.#privateJobReference(current))===JSON.stringify(reference)
        ||Number.isFinite(incomingVersion)&&Number.isFinite(currentVersion)&&currentVersion>incomingVersion)return null;
    }
    if(sourceActive){
      // The same detail cache records an exact acknowledged body, never an
      // arbitrary feed row. Incomplete envelopes still require a fresh detail
      // read; the existing warm reader must validate private input separately.
      const complete=Object.keys(reference).every(key=>key==="canvasId"||Object.hasOwn(job,key))
        &&typeof job.updatedAt==="string"&&Number.isFinite(Date.parse(job.updatedAt))
        &&typeof job.requestedAt==="string"&&Number.isFinite(Date.parse(job.requestedAt))
        &&Array.isArray(job.members)&&(job.result===null||typeof job.result==="object"&&!Array.isArray(job.result));
      if(complete){this.#cacheDocumentJobDetail(job);this.#trimDocumentJobDetails();}
      else this.#jobDetails.delete(jobId);
      return job;
    }
    this.#sourcePausedJobs.set(jobId,source!.authorization.key);this.#jobDetails.delete(jobId);
    return reference;
  }
  #privateJobReference(job:DocumentJob):DocumentJob{
    // Keep only exact original operation identity/status. No copied result,
    // diagnostic, prompt, provider body or hidden extra wire fields survive.
    return{jobId:job.jobId,documentId:job.documentId,canvasId:job.canvasId,
      ...(job.planningExecutionId?{planningExecutionId:job.planningExecutionId}:{}),
      ...(typeof job.planningProjectScope==="boolean"?{planningProjectScope:job.planningProjectScope}:{}),
      ...(typeof job.planningLocale==="string"?{planningLocale:job.planningLocale}:{}),
      kind:job.kind,status:job.status,sourceSurface:job.sourceSurface,requestedSequence:job.requestedSequence,
      documentRevision:job.documentRevision,requestKey:job.requestKey,sourcePreviewId:job.sourcePreviewId,
      productionMode:job.productionMode,promptTechnique:job.promptTechnique,promptFanId:job.promptFanId,
      parentJobId:job.parentJobId,fanKind:job.fanKind,
      members:(Array.isArray(job.members)?job.members:[]).map(member=>({jobId:member.jobId,promptTechnique:member.promptTechnique,
        status:member.status,attemptCount:member.attemptCount,updatedAt:member.updatedAt,error:null,moderationPromptRef:null})),
      result:isDocumentArtifactKind(job.result?.artifactKind)?{artifactKind:job.result!.artifactKind}:null,error:null,errorDetail:null,moderationPromptRef:null,dismissedAt:job.dismissedAt,attemptCount:job.attemptCount,
      requestedAt:job.requestedAt,startedAt:job.startedAt,completedAt:job.completedAt,notifiedAt:job.notifiedAt,
      leaseExpiresAt:job.leaseExpiresAt,updatedAt:job.updatedAt,stage:"",progressMessage:""};
  }
  #retireOwnedSource(read:EventSourceRead,status:401|403|404){
    if(!this.#sourceReadOwned(read))return false;
    const newer=[...this.#sourceCertifiedCoverage].some(([profile,proof])=>proof.id>read.id&&eventProfileRank(profile)>=eventProfileRank(read.profile)&&this.sourceOwnershipActive(proof.source));
    if(newer)return false;
    return this.#nativeImageMutation(()=>{
    const source=read.source,projectId=this.#outputSourceProjectId(),scope=source.authorization.key;
    this.#sourceRetired=true;this.#retiredSourceProjectId=projectId;this.#sourceGeneration+=1;this.#sourceCertifiedCoverage.clear();this.#sourceContentReadIds.clear();
    this.#retireDocumentCopySource(source);
    for(const observation of this.#eventWriteObservations.values())if(this.sourceOwnershipScopeActive(observation.source)){observation.paused=true;observation.imageEdit=undefined;observation.receipt=this.#eventWriteReceipt(observation,{privateUnavailable:true});}
    const session=this.session.get(),context=session?.projectContext,retirementGeneration=this.#sourceGeneration;
    if(session&&projectId){
      const queueScope={ownerId:session.user.userId,projectId,...(context?{historyOwnerId:context.ownerUserId,organizationId:context.organizationId,
        projectAccessId:context.projectAccessId,permissionEpoch:session.permissionEpoch}: {})};
      // This existing queue owner fences immediately even when Canvas is unmounted.
      // Only its own committed transaction can claim a reload-safe private cleanup.
      void canvasOfflineQueue.retireSource(queueScope).catch(()=>{
        if(this.sourceOwnershipScopeActive(source)&&this.#sourceRetired&&this.#sourceGeneration===retirementGeneration)
          this.toast(this.#systemNotice("Canvas sync is paused in this page. Device storage could not confirm removal of private draft bodies or retention of the pause after reload. Do not retry the original changes."));
      });
    }
    // The cache invalidates synchronously; optional local cleanup never delays private retirement.
    void clearAccountSnapshots(read.identity,{scope:"source",fence:read.cacheFence}).catch(()=>undefined);
    if(projectId)this.outputRequirements.withdrawSource({key:scope,projectId},status);
    for(const job of this.documentJobs.get())this.#sourcePausedJobs.set(job.jobId,scope);
    for(const job of this.#jobDetails.values())this.#sourcePausedJobs.set(job.jobId,scope);
    const planningIds=new Set([...this.#planningRecoveryIdentities.keys(),...this.documentJobs.get().filter(job=>job.kind==="structure_adaptive").map(job=>job.jobId)]);
    for(const id of planningIds)this.#clearAdaptivePrivatePresentation(id,undefined,++this.#planningRecoverySequence,true);
    this.documentJobs.set(this.documentJobs.get().map(job=>this.#privateJobReference(job)));this.#jobDetails.clear();
    this.events.set([]);this.optimisticEvents.set([]);this.content.set({});this.replayEvents.set([]);this.head.set(0);
    this.replayAsOf.set(0);this.asOf.set(Number.POSITIVE_INFINITY);
    this.loading.set(false);this.busy.set("");this.error.set("The current source is unavailable. Its saved operation references are retained.");this.appendFailure.set("");this.#retireToast();
    this.generationReadiness.set({});this.adaptiveStructures.set({});this.adaptiveSuggestionSets.set({});
    this.shares.set([]);this.projectNotifications.set([]);this.organizationContextPackages.set([]);this.organizationContextBindings.set([]);this.organizationContextVersions.set({});this.#resetReviewInbox();
    this.#privateContentScope="none";this.#historyProfile="projects";this.#historyUpgrade=undefined;this.#contentHydration=undefined;
    this.#pendingAdaptiveIntents.clear();this.#pendingJobNotices=[];this.#pendingJobEventRefresh=false;this.#pendingJobSessionRefresh=false;this.#pendingPassiveJobPath="";
    this.#readinessAcknowledgements.clear();this.#readinessInFlight.clear();this.#undo=[];this.#redo=[];
    this.ui.shareOpen=false;this.ui.compareOpen=false;this.ui.inspectorOpen=false;this.ui.commandOpen=false;
    this.ui.selectedEventId="";this.ui.selectedOutputId="";this.ui.comparisonOutputIds="";this.ui.focusBlockId="";this.ui.focusCollectionId="";this.ui.editingBlockId="";this.ui.search="";
    window.clearTimeout(this.#jobPollTimer);window.clearTimeout(this.#focalBackfillTimer);this.#outputInputReveal?.cancel();
    const detail:EventSourceRetirement=Object.freeze({source,generation:this.#sourceGeneration,status});
    window.dispatchEvent(new CustomEvent<EventSourceRetirement>("forma-event-source-retired",{detail}));
    this.notify();return true;
    },{fence:true,holdAdmissions:true});
  }
  #observeSourceHeaders(read:EventSourceRead,response:Response,label:string){
    if(!this.#sourceReadOwned(read))throw new Error("The source read no longer belongs to this workspace.");
    if(response.status===401||response.status===403||response.status===404){
      try{this.#retireOwnedSource(read,response.status);}
      catch(error){
        if(NativeImageRetirementError.is(error))
          throw combineNativeImageRetirementFailures([new Error(label+" returned "+response.status),error]);
        throw error;
      }
    }
    if(!response.ok)throw new Error(label+" returned "+response.status);
    this.#assertSourceRead(read);
    if(read.id<this.#sourcePublishedRead)throw new Error("A newer complete source read already owns the current view.");
  }

  #sourceContentReferences(events:readonly CreativeEvent[]){
    const references=new Set<string>(),pending:unknown[]=events.map(event=>event.payload);
    while(pending.length){
      const value=pending.pop();if(!value||typeof value!=="object")continue;
      if(Array.isArray(value)){pending.push(...value);continue;}
      for(const [key,item]of Object.entries(value)){
        if(/(?:_ref|Ref)$/.test(key)&&typeof item==="string")references.add(item);
        else if(/(?:_refs|Refs)$/.test(key)&&Array.isArray(item))for(const ref of item)if(typeof ref==="string")references.add(ref);
        if(item&&typeof item==="object")pending.push(item);
      }
    }
    return references;
  }

  #mergeSourceContent(read:EventSourceRead,incoming:Record<string,string>,replace=false){
    this.#assertSourceRead(read);
    const previous=this.content.get(),next=replace?{...incoming}:{...previous,...incoming};
    const references=replace?this.#sourceContentReferences(this.events.get()):null;
    // A content-only read owns only the exact refs it returned. It cannot
    // certify event coverage or let an absent ref survive a full replacement.
    for(const [reference,id]of this.#sourceContentReadIds){
      if(id<=read.id||typeof previous[reference]!=="string")continue;
      if(!replace||Object.hasOwn(incoming,reference)||references!.has(reference))next[reference]=previous[reference]!;
    }
    for(const reference of this.#sourceContentReadIds.keys())if(!Object.hasOwn(next,reference))this.#sourceContentReadIds.delete(reference);
    for(const reference of Object.keys(incoming)){
      const id=this.#sourceContentReadIds.get(reference)??0;
      if(id<=read.id||next[reference]!==previous[reference])this.#sourceContentReadIds.set(reference,read.id);
    }
    this.content.set(next);
  }

  #publishSourceContent(read:EventSourceRead,publish:()=>void){
    return this.#nativeImageMutation(()=>{
    this.#assertSourceRead(read);this.#assertSourceOwnership(read.source);
    if(read.id<this.#sourcePublishedRead)throw new Error("A newer current source result already owns the private view.");
    publish();this.#assertSourceRead(read);
    });
  }
  #sourceContent(value:unknown):Record<string,string>{
    if(value===undefined)return{};
    if(!value||typeof value!=="object"||Array.isArray(value)||Object.values(value).some(item=>typeof item!=="string"))throw new Error("The private source response was malformed.");
    return value as Record<string,string>;
  }
  #publishSourceRead(page:EventSourcePage,publish:()=>void,coverage:AccountSnapshotProfile=page.read.profile){
    return this.#nativeImageMutation(()=>{
    const read=page.read;this.#assertSourceRead(read);
    if(!read.complete||read.id<this.#sourcePublishedRead)throw new Error("A newer complete source read already owns the current view.");
    if(this.#sourceRetired){this.events.set(page.events);this.#mergeSourceContent(read,page.content,true);this.head.set(page.head);this.#historyProfile=read.profile;this.error.set("");}
    publish();
    this.#assertSourceRead(read);
    this.#sourcePublishedRead=read.id;this.#sourceCertifiedCoverage.set(coverage,{id:read.id,source:read.source});
    this.#sourceRetired=false;this.#retiredSourceProjectId=null;
    });
  }
  async #readEventPages(after=0,read?:EventSourceRead){return this.#readEventStream(after,"full",after===0,read);}
  async replayAuthoritativeHistory(sequence:number){
    const complete=await this.#readEventStream(0,"full",false);
    this.#publishSourceRead(complete,()=>{this.replayEvents.set(complete.events);});
    this.setReplayAsOf(sequence);
  }
  async #readEventStream(after:number,profile:AccountSnapshotProfile,includeContent=false,owned?:EventSourceRead):Promise<EventSourcePage>{
    if(!owned&&this.#projectContextCookieGeneration!==this.#projectContextSessionGeneration)await this.#reconcileProjectContextCookie();
    const read=owned??this.#beginSourceRead(profile);this.#assertSourceRead(read);read.complete=false;
    const restoring=this.#sourceRetired;after=restoring?0:after;profile=read.profile;read.from=Math.max(0,after);
    if(restoring)includeContent=true;
    let cursor=read.from,head=cursor,first=true,initialHead=Number.POSITIVE_INFINITY;
    const events:CreativeEvent[]=[],seen=new Set<string>();let content:Record<string,string>={};
    for(let page=0;page<500;page+=1){
      const limit=profile==="full"?5000:6500,selection=profile==="full"?"":"&profile="+profile;
      const response=await fetch("/api/events?after="+cursor+"&limit="+limit+"&content="+(first&&includeContent?1:0)+selection);
      this.#observeSourceHeaders(read,response,"Event stream");
      const body=await response.json() as {events?:CreativeEvent[];content?:Record<string,string>;head?:number;nextAfter?:number;hasMore?:boolean};
      this.#assertSourceRead(read);
      if(!body||!Array.isArray(body.events)||!Number.isSafeInteger(body.head)||Number(body.head)<0
        ||body.nextAfter!==undefined&&(!Number.isSafeInteger(body.nextAfter)||body.nextAfter<0)
        ||body.hasMore!==undefined&&typeof body.hasMore!=="boolean")throw new Error("The event source response was malformed.");
      const responseHead=body.head!;head=first?responseHead:Math.max(head,responseHead);if(first)initialHead=head;
      if(body.events.some(event=>!event||typeof event.eventId!=="string"||!event.eventId||!Number.isSafeInteger(event.sequence)||event.sequence<1||typeof event.type!=="string"||!event.payload||typeof event.payload!=="object"||Array.isArray(event.payload)))throw new Error("The event source response was malformed.");
      const received=body.events.filter(event=>event.sequence<=initialHead);
      for(const event of received){if(seen.has(event.eventId))throw new Error("The event source repeated a receipt.");seen.add(event.eventId);}
      events.push(...received);recordEventPage(received.length);content={...content,...this.#sourceContent(body.content)};
      const next=Math.min(initialHead,Math.max(cursor,body.nextAfter??received.at(-1)?.sequence??cursor));
      const hasMore=(body.hasMore??next<head)&&next<initialHead;
      if(hasMore&&next<=cursor)throw new Error("Event stream pagination did not advance");
      cursor=next;first=false;
      if(!hasMore){
        if(profile==="full"&&after>0&&events.some(event=>event.type==="DocumentArtifactEdited"||event.type==="AssistantReasoned"&&event.payload.operation==="creative-chat"&&event.payload.deterministic===false&&Boolean(event.payload.task_id)||Object.entries(event.payload).some(([key,value])=>/(?:^|_)(?:content|prompt|intent|input|response|message|statement|condition|note|output|direction)_ref$/.test(key)&&typeof value==="string"&&!this.content.get()[value]))){
          const hydration=await fetch("/api/events?after="+head+"&limit=1&content=1");
          this.#observeSourceHeaders(read,hydration,"Private content");
          const hydrated=await hydration.json() as {content?:Record<string,string>};this.#assertSourceRead(read);
          content={...content,...this.#sourceContent(hydrated?.content)};
        }
        this.#assertSourceRead(read);read.complete=true;
        return{events,content,head:Math.min(head,initialHead),read};
      }
    }
    throw new Error("Event stream exceeded the supported pagination window");
  }

  #profileForRoute(path:string):AccountSnapshotProfile{
    return routeCapabilities(path).profile;
  }

  documentRouteState(path=this.route.get()):"ready"|"pending"|"unavailable"{
    // A retired source cannot be ready merely because the address resolves.
    if(this.#sourceRetired)return this.loading.get()?"pending":"unavailable";
    const addressed=isDocumentViewRoute(path)?documentIdFromRoute(path):null;
    if(!addressed||this.projection.get().documentId===addressed)return "ready";
    return this.loading.get()||this.#cachedHistoryRevalidation?"pending":"unavailable";
  }

  routeDataReady(path=this.route.get()){
    return !this.#sourceRetired&&eventProfileRank(this.#historyProfile)>=eventProfileRank(this.#profileForRoute(path));
  }

  #snapshotIdentity(session:PilotSession):AccountSnapshotIdentity{
    return{
      userId:session.user.userId,
      principalUserId:session.impersonation?.actor.userId??session.user.userId,
      audience:session.audience??"creative",
      organizationId:session.projectContext?.organizationId??null,
      projectAccessId:session.projectContext?.projectAccessId??null,
      permissionEpoch:session.permissionEpoch??"legacy",
      accessExpiresAt:session.projectContext?.expiresAt??null,
      policyVersion:session.policy.version,
      accepted:session.policy.accepted,
      impersonating:Boolean(session.impersonation),
    };
  }

  #authorizationScope(session:PilotSession){
    const identity=this.#snapshotIdentity(session);
    return[identity.principalUserId,identity.userId,identity.audience,identity.organizationId??"personal",identity.projectAccessId??"personal",identity.permissionEpoch,identity.impersonating].join("\u0000");
  }

  #activeAuthorizationScope(){const session=this.session.get();return session?this.#authorizationScope(session):"";}
  #scopeStillActive(scope:string){return Boolean(scope)&&this.#activeAuthorizationScope()===scope;}
  #assertAuthorizationScope(scope:string){if(!this.#scopeStillActive(scope))throw new Error("The active workspace changed; the previous result was safely discarded.");}
  captureAuthorizationScope():CapturedAuthorizationScope|null{const session=this.session.get();return session?{key:this.#authorizationScope(session),shared:Boolean(session.projectContext)}:null;}
  authorizationScopeActive(scope:CapturedAuthorizationScope|null){return Boolean(scope&&this.#scopeStillActive(scope.key)&&Boolean(this.session.get()?.projectContext)===scope.shared);}


  /** Free exact inspection; never hydrates private inputs, changes the recent feed, or drives a job. */
  async inspectOutputNativeJob(documentId: string, jobId: string, current: () => boolean): Promise<
    { status: "found"; job: DocumentJob; current: () => boolean }
    | { status: "unavailable" | "superseded"; job: null }
  > {
    const authorization = this.captureAuthorizationScope(), projectId = this.projection.get().projectId, route = this.route.get();
    const authorityCurrent = () => this.authorizationScopeActive(authorization) && this.projection.get().projectId === projectId;
    const scopeCurrent = () => authorityCurrent() && this.route.get() === route && this.#canReadProjectJobs()
      && (!this.session.get()?.projectContext || this.session.get()!.projectContext!.permissions.includes("project.output.request"))
      && (!this.session.get()?.projectContext || Date.parse(this.session.get()!.projectContext!.expiresAt) > Date.now()) && current();
    const snapshot = this.outputRequirements.resource(documentId).snapshot;
    if (!/^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/u.test(jobId) || !scopeCurrent()
      || snapshot?.documentId !== documentId || snapshot.projectId !== projectId
      || !snapshot.grants.some((grant) => grant.actorUserId === this.session.get()?.user.userId && grant.operations.some((operation) => operation.jobId === jobId)))
      return { status: "unavailable", job: null };
    const read = this.outputRequirements.beginExternalRead(documentId, jobId);
    const active = () => Boolean(read?.current() && scopeCurrent());
    if (!read || !active()) return { status: "superseded", job: null };
    try {
      const response = await fetch(`/api/document-jobs/${encodeURIComponent(jobId)}?inspection=1`, { cache: "no-store" });
      if (!read.scopeCurrent() || !authorityCurrent()) return { status: "superseded", job: null };
      if ([401, 403, 404, 410].includes(response.status)) {
        // A missing original job is private evidence retirement, not project membership revocation.
        return { status: read.withdraw(response.status === 404 ? 410 : response.status) ? "unavailable" : "superseded", job: null };
      }
      if (!active()) return { status: "superseded", job: null };
      const observed = read.observeHeaders();
      const body = await response.json() as { job?: DocumentJob };
      if (!active() || !observed.current()) return { status: "superseded", job: null };
      const job = body?.job;
      if (!response.ok || !job || job.jobId !== jobId || job.documentId !== documentId || job.sourceSurface !== "outputs"
        || !["generate", "render_document"].includes(job.kind) || !["queued", "running", "committing", "completed", "partial", "failed", "canceled"].includes(job.status)
        || typeof job.updatedAt !== "string" || !Number.isFinite(Date.parse(job.updatedAt)))
        return { status: "unavailable", job: null };
      if (!observed.certifyInspection()) return { status: "superseded", job: null };
      return { status: "found", job, current: () => active() && observed.current() };
    } catch { return { status: active() ? "unavailable" : "superseded", job: null }; }
  }

  async reconcileOutputOperationReceipt(documentId: string, grantId: string, slotId: string, jobId: string): Promise<
    { status: "known" | "uncertain" | "not_needed"; reconciled: boolean; refreshed: boolean }
    | { status: "forbidden" | "unavailable" | "invalid"; errorCode: string }
  > {
    const authorization = this.captureAuthorizationScope();
    const projectId = this.projection.get().projectId;
    const active = () => this.authorizationScopeActive(authorization) && this.projection.get().projectId === projectId;
    const forbidden = () => ({ status: "forbidden" as const, errorCode: "output_receipt_scope_changed" });
    const resource = this.outputRequirements.resource(documentId);
    const snapshot = resource.snapshot;
    const grant = snapshot?.grants.find((candidate) => candidate.id === grantId);
    const slot = grant?.operations.find((candidate) => candidate.id === slotId && candidate.jobId === jobId);
    if (!active() || !snapshot || resource.state !== "ready" || snapshot.documentId !== documentId || snapshot.projectId !== projectId
      || !grant || !slot || grant.actorUserId !== this.session.get()?.user.userId || this.session.get()?.impersonation) return forbidden();
    const read = this.outputRequirements.beginExternalRead(documentId);
    const unavailable = () => ({ status: "unavailable" as const, errorCode: "output_receipt_check_failed" });
    if (!read?.current()) return forbidden();
    try {
      const response = await this.guardedFetch(`/api/document-jobs/${encodeURIComponent(jobId)}/reconcile-output`, { method: "POST" }, "check the saved Output operation receipt without a provider request");
      if (!active()) return forbidden();
      if (!response.ok && [401, 403, 404, 410].includes(response.status)) {
        const retired = read.withdraw(response.status);
        return retired && response.status !== 410 ? forbidden() : unavailable();
      }
      if (!read.current()) return unavailable();
      if (!response.ok) {
        return { status: response.status >= 500 ? "unavailable" : "invalid", errorCode: "output_receipt_check_failed" };
      }
      const observed = read.observeHeaders();
      const body = await response.json() as { job?: DocumentJob; reconciliation?: { documentId?: string; grantId?: string; slotId?: string; jobId?: string; status?: string; reconciled?: boolean }; error?: string };
      if (!active()) return forbidden();
      if (!read.current() || !observed.current()) return unavailable();

      const receipt = body.reconciliation;
      if (!body.job || body.job.jobId !== jobId || body.job.documentId !== documentId || !["generate", "render_document"].includes(body.job.kind)
        || !["completed", "partial", "failed", "canceled"].includes(body.job.status)
        || !receipt || receipt.documentId !== documentId || receipt.grantId !== grantId || receipt.slotId !== slotId || receipt.jobId !== jobId
        || !["known", "uncertain", "not_needed"].includes(String(receipt.status)) || typeof receipt.reconciled !== "boolean") return { status: "invalid", errorCode: "output_receipt_response_mismatch" };
      // Refresh only the read-only Output projection. Never invoke the job queue driver or a provider status lookup here.
      const current = await read.refresh();
      if (!active()) return forbidden();
      if (this.outputRequirements.resource(documentId).accessLost) return forbidden();
      if (current?.state === "ready" && read.current() && observed.current()) {
        const currentGrant = current.snapshot?.grants.find((candidate) => candidate.id === grantId);
        if (current.snapshot?.documentId !== documentId || current.snapshot.projectId !== projectId || !currentGrant?.operations.some((candidate) => candidate.id === slotId && candidate.jobId === jobId)) return { status: "invalid", errorCode: "output_receipt_response_mismatch" };
        this.#jobDetails.delete(jobId);
        this.documentJobs.set([body.job, ...this.documentJobs.get().filter((candidate) => candidate.jobId !== jobId)]);
        this.notify();
      }
      return { status: receipt.status as "known" | "uncertain" | "not_needed", reconciled: receipt.reconciled, refreshed: current?.state === "ready" && read.current() };
    } catch { return active() ? { status: "unavailable", errorCode: "output_receipt_check_failed" } : forbidden(); }
  }

  async outputRequirementCommand(command: OutputRequirementCommand, options: { current?: () => boolean } = {}) {
    const sourceOwner = this.captureSourceOwnership(), authorization = this.captureAuthorizationScope();
    const result = await this.outputRequirements.command<OutputCommandResponse>(command.documentId, command, "update Output requirements", options);
    if ((result.status === "saved" || result.status === "conflict") && this.authorizationScopeActive(authorization) && this.sourceOwnershipActive(sourceOwner)) {
      if (result.status === "saved") {
        try { await this.refreshEvents(); }
        catch { /* The mutation receipt is already committed. Hydration must not turn it into a retry. */ }
      }
      if (this.authorizationScopeActive(authorization) && this.sourceOwnershipActive(sourceOwner)) await this.outputRequirements.ensure(command.documentId, { force: true });
    }
    if (!this.authorizationScopeActive(authorization)) return { status: "forbidden" as const, body: null, error: "The active workspace changed. The previous result was discarded." };
    if (!this.sourceOwnershipActive(sourceOwner) || this.outputRequirements.resource(command.documentId).accessLost || this.outputRequirements.resource(command.documentId).privateUnavailable) return this.outputRequirements.withholdCommandBody(command.documentId, result, { clientMutationId: command.clientMutationId, action: command.action });
    return result;
  }

  async uploadOutputAsset(documentId: string, file: File, expectedRevision: string, clientMutationId: string, rightsConfirmed: boolean, options: { current?: () => boolean } = {}) {
    if (!rightsConfirmed) return { status: "invalid" as const, body: null, error: "Confirm that you own or have permission to use this file." };
    const sourceOwner = this.captureSourceOwnership(), authorization = this.captureAuthorizationScope();
    const result = await this.outputRequirements.upload<OutputCommandResponse>(documentId, file, {
      "content-type": "application/octet-stream",
      "x-output-filename": encodeURIComponent(file.name),
      "x-output-expected-revision": expectedRevision,
      "x-output-client-mutation-id": clientMutationId,
      "x-output-rights-confirmed": "true",
    }, options);
    if ((result.status === "saved" || result.status === "conflict") && this.authorizationScopeActive(authorization) && this.sourceOwnershipActive(sourceOwner)) {
      if (result.status === "saved") {
        try { await this.refreshEvents(); }
        catch { /* Keep the committed upload receipt; recover the view without uploading a second file. */ }
      }
      if (this.authorizationScopeActive(authorization) && this.sourceOwnershipActive(sourceOwner)) await this.outputRequirements.ensure(documentId, { force: true });
    }
    if (!this.authorizationScopeActive(authorization)) return { status: "forbidden" as const, body: null, error: "The active workspace changed. The previous result was discarded." };
    if (!this.sourceOwnershipActive(sourceOwner) || this.outputRequirements.resource(documentId).accessLost || this.outputRequirements.resource(documentId).privateUnavailable) return this.outputRequirements.withholdCommandBody(documentId, result, { clientMutationId, action: "adopt" });
    return result;
  }

  async #upgradeHistory(profile:AccountSnapshotProfile,navigation?:WorkspaceNavigationOwner){
    if(navigation&&!this.#workspaceNavigationStable(navigation))return;
    const source=this.captureSourceOwnership();
    if(!this.#sourceRetired&&eventProfileRank(this.#historyProfile)>=eventProfileRank(profile))return;
    if(this.#historyUpgrade){await this.#historyUpgrade;this.#assertSourceOwnership(source);if(navigation&&!this.#workspaceNavigationStable(navigation)||eventProfileRank(this.#historyProfile)>=eventProfileRank(profile))return;}
    const upgrade=(async()=>{
      const incoming=await this.#readEventStream(0,profile,profile==="full"&&routeCapabilities(this.route.get()).privateContent);
      if(navigation&&!this.#workspaceNavigationStable(navigation))return;
      this.#publishSourceRead(incoming,()=>{
        const merged=new Map(incoming.events.map(event=>[event.eventId,event]));
        // Local known events can only be carried forward by this same owned read.
        if(!this.#sourceRetired)for(const event of this.events.get())if(event.sequence>incoming.head)merged.set(event.eventId,event);
        this.events.set([...merged.values()].sort((a,b)=>a.sequence-b.sequence||a.eventId.localeCompare(b.eventId)));
        this.#mergeSourceContent(incoming.read,incoming.content);this.head.set(Math.max(this.head.get(),incoming.head));
        this.#historyProfile=incoming.read.profile;
      });
      if(navigation&&!this.#workspaceNavigationStable(navigation))return;
      recordRouteHistoryProfile(this.#historyProfile);
      if(navigation&&!this.#workspaceNavigationStable(navigation))return;
      if(this.#historyProfile!=="projects")completeBackgroundHydration(this.events.get().length,this.#historyProfile);
      if(navigation&&!this.#workspaceNavigationStable(navigation))return;
      this.notify();
      if(navigation&&!this.#workspaceNavigationStable(navigation))return;
      void writeAccountSnapshot(incoming.read.identity,this.events.get(),this.head.get(),this.#historyProfile,this.#sourceCacheGuard(incoming.read,true));
    })();
    this.#historyUpgrade=upgrade;
    try{await upgrade;}finally{if(this.#historyUpgrade===upgrade)this.#historyUpgrade=undefined;}
  }

  async #hydrateVisiblePrivateContent(navigation?:WorkspaceNavigationOwner):Promise<void>{
    if(navigation&&!this.#workspaceNavigationStable(navigation))return;
    const source=this.captureSourceOwnership();this.#assertSourceOwnership(source);
    const required:"chat"|"memory"|"all"=routeCapabilities(this.route.get()).profile==="memory"?"memory":documentViewFromRoute(this.route.get())==="chat"?"chat":"all";
    if(this.#privateContentScope==="all"||this.#privateContentScope===required){recordPrivateContentState("ready",required);return;}
    const hydrationPath=this.route.get().split(/[?#]/)[0]?.replace(/\/+$/,"")||"/";
    if(this.#contentHydration){
      try{await this.#contentHydration;this.#assertSourceOwnership(source);
        if(navigation&&!this.#workspaceNavigationStable(navigation))return;
        if(String(this.#privateContentScope)!=="all"&&String(this.#privateContentScope)!==required)return this.#hydrateVisiblePrivateContent(navigation);
        if((this.route.get().split(/[?#]/)[0]?.replace(/\/+$/,"")||"/")===hydrationPath)recordPrivateContentState("ready",required);
      }catch(error){if((!navigation||this.#workspaceNavigationStable(navigation))&&this.sourceOwnershipActive(source)&&(this.route.get().split(/[?#]/)[0]?.replace(/\/+$/,"")||"/")===hydrationPath)recordPrivateContentState("unavailable",required);throw error;}return;
    }
    recordPrivateContentState("pending",required);const read=this.#beginSourceRead("full");
    const hydration=(async()=>{
      const response=await fetch("/api/events?after="+this.head.get()+"&limit=1&content=1"+(required!=="all"?"&contentScope="+required:""));
      this.#observeSourceHeaders(read,response,"Private content");
      const body=await response.json() as {content?:Record<string,string>};this.#assertSourceRead(read);this.#assertSourceOwnership(source);
      if(navigation&&!this.#workspaceNavigationStable(navigation))return;
      const content=this.#sourceContent(body?.content);
      // A hydration-only response is not a complete event-source certificate.
      this.#publishSourceContent(read,()=>{this.#privateContentScope=required;if(Object.keys(content).length)this.#mergeSourceContent(read,content);});
      if(Object.keys(content).length)this.notify();
    })();this.#contentHydration=hydration;
    let state:"ready"|"unavailable"="unavailable",primary:{error:unknown}|null=null;
    try{await hydration;state="ready";}catch(error){primary={error};throw error;}finally{
      if(this.#contentHydration===hydration)this.#contentHydration=undefined;
      try{if((!navigation||this.#workspaceNavigationStable(navigation))&&this.sourceOwnershipActive(source)&&(this.route.get().split(/[?#]/)[0]?.replace(/\/+$/,"")||"/")===hydrationPath)recordPrivateContentState(state,required);}
      catch(cleanup){
        const combined=primary?combineNativeImageRetirementFailures([primary.error,cleanup]):null;
        // eslint-disable-next-line no-unsafe-finally -- Cleanup rejection preserves combined Image failures and existing legacy cleanup precedence.
        if(combined)throw combined;throw cleanup;
      }
    }
  }

  async ensurePrivateContent(reference:string,options:{force?:boolean;validate?:(value:string)=>boolean}={}){
    if(!reference)return null;const source=this.captureSourceOwnership();if(!this.sourceOwnershipActive(source))return null;
    const existing=this.content.get()[reference];if(typeof existing==="string"&&!options.force&&(!options.validate||options.validate(existing)))return existing;
    if(this.#contentHydration){try{await this.#contentHydration;}catch(error){if(NativeImageRetirementError.is(error))throw error;/* Only a still-owned targeted read may follow. */}
      if(!this.sourceOwnershipActive(source))return null;const hydrated=this.content.get()[reference];
      if(typeof hydrated==="string"&&!options.force&&(!options.validate||options.validate(hydrated)))return hydrated;
    }
    try{
      const read=this.#beginSourceRead("full"),response=await fetch("/api/events?after="+this.head.get()+"&limit=1&content=1");
      this.#observeSourceHeaders(read,response,"Private content");
      const body=await response.json() as {content?:Record<string,string>};this.#assertSourceRead(read);this.#assertSourceOwnership(source);
      const content=this.#sourceContent(body?.content),requested=content[reference];
      if(options.validate&&(typeof requested!=="string"||!options.validate(requested)))return null;
      this.#publishSourceContent(read,()=>{this.#privateContentScope="all";if(Object.keys(content).length)this.#mergeSourceContent(read,content);});
      if(Object.keys(content).length)this.notify();
      return this.sourceOwnershipActive(source)?this.content.get()[reference]??null:null;
    }catch(error){if(NativeImageRetirementError.is(error))throw error;return null;}
  }
  #clientEventIds(events:CreativeEvent[]){return new Set(events.map((event)=>String(event.payload.client_event_id??"")).filter(Boolean));}
  #principalEventActor(){const session=this.session.get();return session?.projectContext?`user:${session.user.userId}`:"user";}
  #mergeConfirmed(appended:CreativeEvent[],head=this.head.get(),remember=false){
    const known=new Set(this.events.get().map((event)=>event.eventId));const fresh=appended.filter((event)=>!known.has(event.eventId));
    if(fresh.length)this.events.set([...this.events.get(),...fresh].sort((left,right)=>left.sequence-right.sequence||left.eventId.localeCompare(right.eventId)));
    const confirmedClientIds=this.#clientEventIds(appended);if(confirmedClientIds.size)this.optimisticEvents.set(this.optimisticEvents.get().filter((event)=>!confirmedClientIds.has(String(event.payload.client_event_id??""))));
    this.head.set(Math.max(this.head.get(),head,...appended.map((event)=>event.sequence)));
    if(remember){const actor=this.#principalEventActor();const remembered=appended.filter((event)=>{const clientEventId=String(event.payload.client_event_id??"");if(event.actor!==actor||event.compensatesEventId||!inverseEvent(event)||clientEventId&&this.#rememberedClientEventIds.has(clientEventId))return false;if(clientEventId)this.#rememberedClientEventIds.add(clientEventId);return true;});if(remembered.length){this.#undo.push(remembered);this.#redo=[];}}
    this.#publishAppended(fresh);return fresh;
  }
  stageOptimisticCanvasEvents(events:EventInput[]){
    if(!this.sourceOwnershipActive(this.captureSourceOwnership()))return[];
    const existing=new Set(this.optimisticEvents.get().map((event)=>String(event.payload.client_event_id??"")));const now=new Date().toISOString();let index=this.optimisticEvents.get().length;
    const staged:CreativeEvent[]=events.filter((event)=>!existing.has(String(event.payload.client_event_id??""))).map((event)=>{const clientEventId=String(event.payload.client_event_id??crypto.randomUUID());return{eventId:`optimistic:${clientEventId}`,streamId:"optimistic:canvas",sequence:this.head.get()+(++index),occurredAt:now,recordedAt:now,actor:"user",clientId:"web:canvas-optimistic",correlationId:String(event.payload.history_action_id??clientEventId),causationId:null,compensatesEventId:event.compensatesEventId??null,schemaVersion:1,type:event.type,payload:{...event.payload,client_event_id:clientEventId}};});
    if(staged.length){this.optimisticEvents.set([...this.optimisticEvents.get(),...staged]);this.notify();}return staged;
  }
  discardOptimisticCanvasEvents(clientEventIds:Iterable<string>){const ids=new Set(clientEventIds);if(!ids.size)return;this.optimisticEvents.set(this.optimisticEvents.get().filter((event)=>!ids.has(String(event.payload.client_event_id??""))));this.notify();}
  async syncCanvasBatch(events:EventInput[],options:{remember?:boolean}={}):Promise<CanvasSyncResult>{
    if(!events.length)return{appended:[],rejected:[],head:this.head.get(),retryable:false,error:""};
    const retained=JSON.parse(JSON.stringify(events)) as EventInput[];
    const admission=await this.#admitEventWrite(retained,"canvas_sync"),observation=admission.observation;
    const active=()=>this.sourceOwnershipActive(observation.source)&&!observation.paused;
    const paused=(receipt:EventWriteResult):CanvasSyncResult=>({appended:[],rejected:[],head:receipt.acknowledgment.observedHead??0,
      retryable:false,error:"",acknowledgment:receipt.acknowledgment,pause:"source-retired"});
    if(!admission.admitted){
      if(admission.reused)return paused(this.#withheldEventWrite(observation));
      const result=this.#finishEventWrite(observation,{outcome:"not-attempted",privateUnavailable:!active()},[],active()?"none":"withheld",{silent:true});
      if(!admission.capacity&&this.sourceOwnershipScopeActive(observation.source))this.toast(this.#systemNotice("Too many original changes await confirmation. No new change was sent."));
      return paused(result);
    }
    if(!active())return paused(this.#finishEventWrite(observation,{outcome:"not-attempted",privateUnavailable:true},[],"withheld",{silent:true}));
    let dispatched=false;observation.attempted=true;
    try{
      const response=await this.guardedFetch("/api/events",{method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({action:"canvas_sync",events:retained,clientId:"web:canvas"})},
        retained.length>1?"apply "+retained.length+" ordered board changes":"record "+retained[0]!.type,
        {current:()=>dispatched||active(),onDispatch:()=>{dispatched=true;}});
      if([401,403,404].includes(response.status)){
        if(observation.read)this.#retireOwnedSource(observation.read,response.status as 401|403|404);
        const result=this.#finishEventWrite(observation,{outcome:"unconfirmed",privateUnavailable:!active()},[],active()?"none":"withheld",{silent:true});
        return paused(result);
      }
      let body:unknown;try{body=await response.json();}catch{throw new Error("Canvas sync returned no verifiable acknowledgment.");}
      const receipt=response.ok?this.#validateEventWriteBody(body,retained,observation):null;
      if(!active()){
        observation.paused=true;
        return paused(this.#finishEventWrite(observation,{outcome:receipt?.complete?"observed":"unconfirmed",
          ...(receipt?{committed:receipt.committed,rejectedIndices:receipt.rejectedIndices,observedHead:receipt.head}:{}),privateUnavailable:true},[],"withheld",{silent:true}));
      }
      if(receipt){
        this.#mergeConfirmed(receipt.appended,receipt.head,options.remember!==false);
        this.appendFailure.set(receipt.rejected.map(item=>item.reason).join("; "));this.notify();
        this.#finishEventWrite(observation,{outcome:receipt.complete?"observed":"unconfirmed",committed:receipt.committed,
          rejectedIndices:receipt.rejectedIndices,observedHead:receipt.head,privateUnavailable:false},receipt.appended,"published",{silent:true});
        return{appended:receipt.appended,rejected:receipt.rejected,head:receipt.head,retryable:!receipt.complete,error:""};
      }
      const error=body&&typeof body==="object"&&!Array.isArray(body)&&typeof(body as Record<string,unknown>).error==="string"
        ?String((body as Record<string,unknown>).error):"Canvas sync returned no verifiable acknowledgment.";
      this.#finishEventWrite(observation,{outcome:"unconfirmed",privateUnavailable:false},[],"none",{silent:true});
      this.appendFailure.set(error);this.notify();
      return{appended:[],rejected:[],head:this.head.get(),retryable:response.ok||response.status>=500||[408,425,429].includes(response.status)
        ||response.status===409&&error==="stale_sequence",error};
    }catch(error){
      if(!dispatched&&error instanceof Error&&error.message==="scene_cost_changed")observation.attempted=false;
      const result=this.#finishEventWrite(observation,{outcome:observation.attempted?"unconfirmed":"not-attempted",privateUnavailable:!active()},[],active()?"none":"withheld",{silent:true});
      if(!active()){observation.paused=true;return paused(result);}
      const message=error instanceof Error?error.message:"The Canvas server could not be reached.";
      this.appendFailure.set(message);return{appended:[],rejected:[],head:this.head.get(),retryable:true,error:message};
    }
  }
  async #refreshEvents(options:{fromStart?:boolean;readOnly?:boolean;current?:()=>boolean}={}){
    if(options.current&&!options.current())return false;
    if(this.#projectContextCookieGeneration!==this.#projectContextSessionGeneration)await this.#reconcileProjectContextCookie();
    if(options.current&&!options.current())return false;
    const read=this.#beginSourceRead("full");
    const baseProfile=this.#historyProfile,wasRetired=this.#sourceRetired,previous=wasRetired?[]:this.events.get(),known=new Set(previous.map(event=>event.eventId));
    const after=options.fromStart===true||wasRetired?0:this.#historyProfile==="full"?(previous.at(-1)?.sequence??0):this.head.get();
    let replace=after===0,body=await this.#readEventPages(after,read);
    this.#assertSourceRead(body.read);
    if(body.head<after){body=await this.#readEventPages(0,body.read);this.#assertSourceRead(body.read);replace=true;}
    if(body.read.from===0)replace=true;
    const changed=wasRetired||replace||body.events.length>0||body.head!==after||Object.keys(body.content).length>0;
    const complete=replace?body.events:[...previous,...body.events.filter(event=>!known.has(event.eventId))];
    if(options.current&&!options.current())return false;
    this.#publishSourceRead(body,()=>{
      if(changed){this.events.set(complete);const confirmed=this.#clientEventIds(complete);
        if(confirmed.size)this.optimisticEvents.set(this.optimisticEvents.get().filter(event=>!confirmed.has(String(event.payload.client_event_id??""))));
        if(replace||Object.keys(body.content).length)this.#mergeSourceContent(body.read,body.content,replace);
        this.head.set(body.head);if(replace)this.#historyProfile=body.read.profile;}
    },replace?body.read.profile:eventProfileRank(baseProfile)<eventProfileRank(body.read.profile)?baseProfile:body.read.profile);
    if(changed)this.#publishAppended(complete.filter(event=>!known.has(event.eventId)),body.read,options.readOnly);
    return changed;
  }
  async refreshEvents(options:{fromStart?:boolean;readOnly?:boolean;current?:()=>boolean}={}){if(await this.#refreshEvents(options))this.notify();}

  /** One direct receipt-bound transport. Never appendBatch, Canvas queue or optimistic events. */
  async canvasArrangementRequest(command: OutcomeArrangementCommand, controls: { current?: () => boolean; onDispatch?: () => void; onNotDispatchedAtConfirmation?: () => void } = {}): Promise<OutcomeArrangementHttp> {
    const authorization=this.captureAuthorizationScope(),session=this.session.get();
    const permissions=session?.projectContext?.permissions??session?.capabilities??[];
    if(controls.current&&!controls.current()||!authorization||!session||!navigator.onLine||!permissions.includes("project.read")||!permissions.includes("project.canvas.use")
      ||command.projectId!==this.projection.get().projectId||command.canvasId!==canvasIdFromRoute(this.route.get())
      ||session.projectContext&&session.projectContext.projectId!==command.projectId)throw new Error("canvas_arrangement_unavailable");
    const response=await this.guardedFetch(OUTCOME_ARRANGEMENT_ENDPOINT,{
      method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(command),
    },outcomeDeskIntegrationCopy(currentFormaLocale().locale).arrange,controls);
    if(controls.current&&!controls.current()||!this.authorizationScopeActive(authorization)||command.projectId!==this.projection.get().projectId||command.canvasId!==canvasIdFromRoute(this.route.get()))throw new Error("canvas_arrangement_authority_changed");
    const body=await response.json() as Record<string,unknown>;
    if(controls.current&&!controls.current()||!this.authorizationScopeActive(authorization)||command.projectId!==this.projection.get().projectId||command.canvasId!==canvasIdFromRoute(this.route.get()))throw new Error("canvas_arrangement_authority_changed");
    return{ok:response.ok,status:response.status,body};
  }

  #documentCopyFacts(target:DocumentCopyTarget){
    const session=this.session.get(),projection=this.projection.get(),authorization=this.captureAuthorizationScope();
    const sourceOwner=this.captureSourceOwnership();
    const context=session?.projectContext,permissions=context?.permissions??session?.capabilities??[];
    const canRead=Boolean(documentCopyTargetValid(target)&&session?.policy?.accepted&&authorization?.key&&
      this.authorizationScopeActive(authorization)&&this.sourceOwnershipActive(sourceOwner)&&session.user.userId!=="anonymous"&&
      projection.projectId===target.projectId&&permissions.includes("project.read")&&
      (!context||context.projectId===target.projectId&&Number.isFinite(Date.parse(context.expiresAt))&&Date.parse(context.expiresAt)>Date.now()));
    const source=projection.documents.find((document)=>document.id===target.documentId&&document.projectId===target.projectId&&!document.removed);
    const authorityKey=JSON.stringify([authorization?.key,session?.user.role,[...permissions].sort(),session?.policy.version,
      context?.ownerUserId,context?.role,context?.expiresAt]);
    return{authorization,sourceOwner,authorityKey,projection,source,canRead,canAuthor:canRead&&permissions.includes("project.author")};
  }
  #documentCopyLiveCount(){
    return Object.values(this.documentCopyReviews.get()).filter((state)=>state.phase!=="applied"||state.busy||!state.receipt).length;
  }
  documentCopyAccess(target:DocumentCopyTarget){
    const current=this.#documentCopyFacts(target);
    const capacity=current.canRead&&Boolean(current.source)&&!this.documentCopyReviews.get()[documentCopyKey(target)]&&this.#documentCopyLiveCount()>=32;
    return{canRead:current.canRead,canAuthor:current.canAuthor&&Boolean(current.source),issue:capacity?"document_copy_capacity":""};
  }
  documentCopyReview(target:DocumentCopyTarget):OwnedDocumentCopyReview|null{
    const current=this.#documentCopyFacts(target),state=this.documentCopyReviews.get()[documentCopyKey(target)];
    if(!state||!current.canRead||state.scopeKey!==current.authorization?.key)return null;
    if(!this.sourceOwnershipActive(state.sourceOwner)||state.refusedRevision&&
      (!this.sourceOwnershipActive(state.refusedRevision.sourceOwner)||state.refusedRevision.authorityKey!==current.authorityKey)||state.retirement&&
      (state.authorityKey!==current.authorityKey||!current.source))return this.#privateDocumentCopy(state);
    const stale=state.stale||Boolean(state.preview&&!state.receipt&&
      (state.authorityKey!==current.authorityKey||state.sourceRevision!==documentCopySourceRevision(current.projection,target)||
        Date.parse(state.preview.expiresAt)<=Date.now()||!current.source||!current.canAuthor));
    return{...state,stale};
  }
  #saveDocumentCopy(state:OwnedDocumentCopyReview){
    this.documentCopyReviews.set({...this.documentCopyReviews.get(),[documentCopyKey(state.target)]:state});this.notify();
  }
  #privateDocumentCopy(state:OwnedDocumentCopyReview):OwnedDocumentCopyReview{
    // Keep exact recovery/receipt identities, never a private title, plan, or source snapshot.
    return{target:{...state.target},scopeKey:state.scopeKey,authorityKey:"",
      sourceOwner:state.sourceOwner,commitSubmitted:state.commitSubmitted,
      revisedIntent:null,revisionDraft:null,revisedRequestSubmitted:state.revisedRequestSubmitted,retirement:null,
      operationId:state.operationId||state.intent?.operationId||state.receipt?.operationId||"",
      sourceTitle:"",sourceRevision:"",phase:state.receipt?"applied":state.commitSubmitted?"uncertain":"unavailable",
      busy:false,request:state.request,intent:null,preview:null,previewId:state.previewId,approvalHash:state.approvalHash,
      receipt:state.receipt?{documentId:state.receipt.documentId,operationId:state.receipt.operationId}:null,
      destinationDocumentId:state.receipt?.documentId??state.destinationDocumentId,stale:true,issue:"document_copy_unavailable"};
  }
  #retireDocumentCopySource(source:CapturedSourceOwnership){
    const entries={...this.documentCopyReviews.get()};let changed=false;
    for(const[key,state]of Object.entries(entries)){
      if(state.scopeKey!==source.authorization.key)continue;
      const reference=this.#privateDocumentCopy(state);
      // A dispatched commit may still acknowledge its exact original identity.
      // Source ownership fences every old preview; an unsubmitted request also loses its counter.
      if(!state.commitSubmitted)reference.request=++this.#documentCopyRequest;
      entries[key]=reference;changed=true;
    }
    if(changed)this.documentCopyReviews.set(entries);
  }
  #retainDocumentCopyReceipt(target:DocumentCopyTarget,request:number,source:CapturedSourceOwnership,result:unknown,ok:boolean){
    const state=this.documentCopyReviews.get()[documentCopyKey(target)];
    if(!state||state.request!==request||!state.commitSubmitted||!this.sourceOwnershipScopeActive(source))return null;
    let reference=this.#privateDocumentCopy(state);
    if(ok&&result&&typeof result==="object"&&!Array.isArray(result)){
      const body=result as Record<string,unknown>;
      if(body.status==="applied"){
        try{
          // Ignore optional private preview and all extra wire fields. The model
          // still checks the original preview/hash/operation/destination tuple.
          const receipt=documentCopyOutcome(reference,"apply",{status:"applied",previewId:body.previewId,
            approvalHash:body.approvalHash,operationId:body.operationId,documentId:body.documentId},true);
          reference=this.#privateDocumentCopy({...reference,...receipt});
        }catch{/* An unverified reply is still unknown, not a failed or replacement copy. */}
      }
    }
    this.#saveDocumentCopy(reference);
    return this.documentCopyReview(target);
  }
  closeDocumentCopyDraft(target:DocumentCopyTarget){
    const state=this.documentCopyReview(target);
    if(!state||state.busy)return;
    if(state.phase==="applied"&&state.receipt){
      // Keep the chosen receipt, not private preview content or a slot in the live-review limit.
      const unusedCandidate=state.reviewDisposition==="saved-original"&&state.revisedRequestSubmitted&&state.revisedIntent;
      this.#saveDocumentCopy({...state,preview:null,intent:null,
        revisedIntent:unusedCandidate?state.revisedIntent:null,revisionDraft:unusedCandidate?state.revisionDraft:null,
        sourceTitle:"",sourceRevision:""});return;
    }
    if(state.intent||state.previewId||state.receipt||state.phase!=="draft")return;
    const entries={...this.documentCopyReviews.get()};delete entries[documentCopyKey(target)];this.documentCopyReviews.set(entries);this.notify();
  }
  async beginDocumentCopy(target:DocumentCopyTarget){
    const current=this.#documentCopyFacts(target);if(!current.canRead||!current.authorization)return null;
    let state=this.documentCopyReview(target);
    if(!state){
      if(!current.source||this.#documentCopyLiveCount()>=32)return null;
      state={target:{...target},scopeKey:current.authorization.key,authorityKey:current.authorityKey,
        sourceOwner:current.sourceOwner,commitSubmitted:false,operationId:"",
        sourceTitle:current.source.title,sourceRevision:documentCopySourceRevision(current.projection,target),
        phase:"recovering",busy:false,request:0,intent:null,preview:null,previewId:"",approvalHash:"",receipt:null,destinationDocumentId:"",stale:false,issue:""};
      this.#saveDocumentCopy(state);
    }
    if(state.busy||state.phase==="editing"||state.phase==="retired"&&state.retirement)return state;
    return this.checkDocumentCopy(target);
  }
  beginDocumentCopyRevision(target:DocumentCopyTarget,operationId:string){
    const state=this.documentCopyReview(target),current=this.#documentCopyFacts(target);
    if(!state||state.busy||state.phase!=="unavailable"||state.issue!=="document_duplicate_folder_unavailable"||
      state.operationId!==operationId||!state.intent||state.previewId||state.receipt||state.commitSubmitted||
      !this.sourceOwnershipActive(state.sourceOwner)||!current.canAuthor||!current.source)return null;
    // Editing does not abandon or replace the original operation. Only the
    // separate free revise request may prepare a plan; an earlier saved plan wins.
    const intent=state.revisedIntent??state.intent;
    const revisionDraft=state.revisionDraft??Object.freeze({title:intent.title,
      ...(Object.hasOwn(intent,"collectionId")?{collectionId:intent.collectionId}:{})});
    const next={...state,revisionDraft,phase:"editing" as const,stale:false,issue:""};
    this.#saveDocumentCopy(next);return next;
  }
  updateDocumentCopyRevisionDraft(target:DocumentCopyTarget,operationId:string,details:DocumentCopyDetails){
    const state=this.documentCopyReview(target),current=this.#documentCopyFacts(target);
    if(!state||state.busy||state.phase!=="editing"||state.operationId!==operationId||
      !this.sourceOwnershipActive(state.sourceOwner)||!current.canAuthor||!current.source||
      typeof details.title!=="string"||details.title.length>160||
      Object.hasOwn(details,"collectionId")&&details.collectionId!==null&&
        (typeof details.collectionId!=="string"||!/^[a-z0-9][a-z0-9:_-]{0,119}$/iu.test(details.collectionId)))return null;
    const revisionDraft=Object.freeze({title:details.title,...(Object.hasOwn(details,"collectionId")?{collectionId:details.collectionId}:{})});
    this.#saveDocumentCopy({...state,revisionDraft});return revisionDraft;
  }
  async previewDocumentCopy(target:DocumentCopyTarget,details:DocumentCopyDetails){
    const current=this.#documentCopyFacts(target),state=this.documentCopyReview(target);
    if(!current.canAuthor||!current.source||!state||state.busy||!["draft","editing"].includes(state.phase)||
      state.phase==="draft"&&state.intent||state.phase==="editing"&&(!state.intent||!state.operationId||state.previewId||state.receipt||state.commitSubmitted))return null;
    const revise=state.phase==="editing";
    try{
      const intent=documentCopyIntent(target,details,revise?state.operationId!:crypto.randomUUID());
      this.#saveDocumentCopy({...state,...(revise?{revisedIntent:intent,revisedRequestSubmitted:true}:{intent,operationId:intent.operationId}),
        sourceOwner:current.sourceOwner,authorityKey:current.authorityKey,
        sourceRevision:documentCopySourceRevision(current.projection,target),issue:""});
    }catch(error){
      this.#saveDocumentCopy({...state,issue:error instanceof Error?error.message:"document_copy_invalid_target"});return null;
    }
    return this.#requestDocumentCopy(target,revise?"revise":"preview");
  }
  async checkDocumentCopy(target:DocumentCopyTarget,options:{includeRetirement?:boolean}={}){
    const state=this.documentCopyReview(target);if(!state||state.busy||state.phase==="editing")return state;
    if(options.includeRetirement&&state.operationId)return this.#requestDocumentCopy(target,"resume",{includeRetirement:true});
    return this.#requestDocumentCopy(target,state.previewId?"retrieve":state.revisedRequestSubmitted?"resume":state.intent?"preview":"resume");
  }
  async applyDocumentCopy(target:DocumentCopyTarget,previewId:string,approvalHash:string){
    const state=this.documentCopyReview(target),current=this.#documentCopyFacts(target);
    if(!state||state.busy||state.receipt||state.phase!=="review"||state.stale||!this.sourceOwnershipActive(state.sourceOwner)||!current.canAuthor||!current.source||
      !state.preview||state.previewId!==previewId||state.approvalHash!==approvalHash)return null;
    return this.#requestDocumentCopy(target,"apply");
  }
  async dismissDocumentCopy(target:DocumentCopyTarget,previewId:string,approvalHash:string,
    expected?:{operationId:string;request:number;retirement:NonNullable<DocumentCopyReview["retirement"]>}){
    const state=this.documentCopyReview(target);
    if(state?.phase==="retired"){
      const current=this.#documentCopyFacts(target);
      if(state.busy||state.receipt||!state.retirement||!expected||expected.retirement!==state.retirement||
        expected.operationId!==state.operationId||expected.request!==state.request||
        state.previewId!==previewId||state.approvalHash!==approvalHash||
        state.scopeKey!==current.authorization?.key||state.authorityKey!==current.authorityKey||
        !current.canRead||!current.source||!this.sourceOwnershipActive(state.sourceOwner))return null;
      // The server has already irreversibly fenced this exact erased operation.
      // Deliberate local Done releases only this owner; it sends no request or authoring receipt.
      const entries={...this.documentCopyReviews.get()};delete entries[documentCopyKey(target)];
      this.documentCopyReviews.set(entries);this.notify();return{...state,phase:"dismissed" as const};
    }
    if(expected)return null;
    const guardedAvailable=Boolean(state?.guardedDismissAvailable&&["uncertain","unavailable"].includes(state.phase)&&
      !state.intent&&!state.preview&&!state.receipt&&state.operationId&&this.sourceOwnershipActive(state.sourceOwner));
    if(!state||state.busy||!(["review","applied"].includes(state.phase)||state.phase==="unavailable"&&!state.commitSubmitted||guardedAvailable)||
      !state.previewId||state.previewId!==previewId||state.approvalHash!==approvalHash)return null;
    return this.#requestDocumentCopy(target,"dismiss");
  }
  async #requestDocumentCopy(target:DocumentCopyTarget,action:DocumentCopyAction,options:{includeRetirement?:boolean}={}):Promise<OwnedDocumentCopyReview|null>{
    const state=this.documentCopyReview(target),facts=this.#documentCopyFacts(target);
    if(!state||state.busy||!facts.canRead||!facts.authorization||!facts.sourceOwner||
      action==="apply"&&!this.sourceOwnershipActive(state.sourceOwner))return null;
    const authorization=facts.authorization,sourceOwner=facts.sourceOwner,actorUserId=this.session.get()?.user.userId??"",request=++this.#documentCopyRequest;
    const sourceRevision=documentCopySourceRevision(facts.projection,target),authorityKey=facts.authorityKey;
    let body:ReturnType<typeof documentCopyRequest>;
    try{body=documentCopyRequest(state,action,options);}catch{return null;}
    const refused=state.refusedRevision;
    const keepRefusal=Boolean(["resume","retrieve"].includes(action)&&refused&&refused.intent===state.intent&&
      refused.revisedIntent===state.revisedIntent&&refused.intent.operationId===state.operationId&&
      refused.revisedIntent.operationId===state.operationId);
    const pending:OwnedDocumentCopyReview={...state,...(refused&&!keepRefusal?{refusedRevision:undefined}:{}),
      ...(state.guardedDismissAvailable?{guardedDismissAvailable:false}:{}),sourceOwner,request,busy:true,issue:"",
      phase:action==="apply"?"applying":["preview","revise"].includes(action)?"previewing":action==="resume"?"recovering":state.phase};
    this.#saveDocumentCopy(pending);
    const ownsRequest=()=>this.documentCopyReviews.get()[documentCopyKey(target)]?.request===request&&
      this.authorizationScopeActive(authorization)&&this.sourceOwnershipScopeActive(sourceOwner);
    const canReceive=()=>ownsRequest()&&this.sourceOwnershipActive(sourceOwner)&&this.#documentCopyFacts(target).canRead;
    const controller=new AbortController(),timeout=window.setTimeout(()=>controller.abort(),15_000);
    let denied=false,dispatched=false;
    try{
      const response=await this.guardedFetch("/api/documents/duplicate",{method:"POST",credentials:"same-origin",cache:"no-store",
        headers:{"content-type":"application/json"},body:JSON.stringify(body),signal:controller.signal},this.#systemNotice("Duplicate"),{
        current:()=>ownsRequest()&&(dispatched||this.sourceOwnershipActive(sourceOwner)),
        onDispatch:()=>{dispatched=true;if(action==="apply"&&ownsRequest()){
          const current=this.documentCopyReviews.get()[documentCopyKey(target)];
          this.#saveDocumentCopy({...current,commitSubmitted:true});
        }},
      });
      if(!ownsRequest())return null;
      if(!canReceive()){
        if(action==="apply"&&dispatched)return this.#retainDocumentCopyReceipt(target,request,sourceOwner,await response.json(),response.ok);
        return null;
      }
      denied=[401,403,410].includes(response.status);
      if(denied)this.#saveDocumentCopy(this.#privateDocumentCopy(this.documentCopyReviews.get()[documentCopyKey(target)]!));
      const result:unknown=await response.json();
      if(!canReceive()){
        if(action==="apply"&&dispatched)return this.#retainDocumentCopyReceipt(target,request,sourceOwner,result,response.ok);
        return null;
      }
      const original=this.documentCopyReviews.get()[documentCopyKey(target)]!;
      let next:OwnedDocumentCopyReview={...documentCopyOutcome(denied?this.#privateDocumentCopy(original):original,action,result,response.ok,
        action==="resume"&&"includeRetirement"in body&&body.includeRetirement===true?{retirementActorUserId:actorUserId}:{}),
        sourceOwner,commitSubmitted:original.commitSubmitted};
      // Capture only an actual exact revised-request refusal. Read failures may
      // retain this provenance, but never turn it into an actionable issue.
      if(action==="revise"&&response.status===409&&result&&typeof result==="object"&&!Array.isArray(result)&&
        Object.keys(result).length===2&&"status"in result&&result.status==="not-applied"&&
        "error"in result&&result.error==="document_duplicate_folder_unavailable"&&
        "operationId"in body&&body.operationId===state.operationId&&original.operationId===state.operationId&&
        body.projectId===target.projectId&&body.documentId===target.documentId&&
        state.intent&&state.revisedIntent&&original.intent===state.intent&&original.revisedIntent===state.revisedIntent&&
        !original.previewId&&!original.receipt&&!original.commitSubmitted&&
        this.sourceOwnershipActive(sourceOwner)&&authorityKey===this.#documentCopyFacts(target).authorityKey)
        next={...next,refusedRevision:Object.freeze({intent:state.intent,revisedIntent:state.revisedIntent,sourceOwner,authorityKey})};
      const sameOriginalRead=action==="resume"&&"operationId"in body&&Boolean(state.operationId)&&
        body.operationId===state.operationId&&original.operationId===state.operationId;
      if(["resume","retrieve"].includes(action)&&next.issue==="document_duplicate_folder_unavailable")
        next={...next,issue:"document_copy_unavailable"};
      // Only a fresh exact same-original read may restore deliberate correction.
      // Neither retained provenance nor absence authorizes a replacement or Apply.
      if(sameOriginalRead&&response.status===200&&result&&typeof result==="object"&&!Array.isArray(result)&&
        Object.keys(result).length===1&&"status"in result&&result.status==="none"&&
        ["unavailable","uncertain"].includes(state.phase)&&refused&&original.refusedRevision===refused&&
        state.revisedRequestSubmitted&&original.intent===refused.intent&&original.revisedIntent===refused.revisedIntent&&
        refused.intent.operationId===state.operationId&&refused.revisedIntent.operationId===state.operationId&&
        refused.intent.projectId===target.projectId&&refused.intent.documentId===target.documentId&&
        refused.revisedIntent.projectId===target.projectId&&refused.revisedIntent.documentId===target.documentId&&
        refused.authorityKey===authorityKey&&authorityKey===this.#documentCopyFacts(target).authorityKey&&
        !state.previewId&&!original.previewId&&!state.receipt&&!original.receipt&&!state.commitSubmitted&&!original.commitSubmitted&&
        this.sourceOwnershipActive(refused.sourceOwner)&&this.sourceOwnershipActive(state.sourceOwner))
        next={...next,issue:"document_duplicate_folder_unavailable"};
      if(response.ok&&result&&typeof result==="object"&&"status"in result&&result.status==="not-applied")
        next.commitSubmitted=false;
      if(denied||/retention|custody|source_rights|source_evidence/u.test(next.issue)||original.refusedRevision&&
        (!this.sourceOwnershipActive(original.refusedRevision.sourceOwner)||original.refusedRevision.authorityKey!==this.#documentCopyFacts(target).authorityKey))
        next=this.#privateDocumentCopy(next);
      if(next.refusedRevision&&(next.previewId||next.receipt||next.commitSubmitted||["applying","applied","retired","dismissed"].includes(next.phase)))
        next={...next,refusedRevision:undefined};
      // This flag permits asking the existing server adjudicator; it is not a
      // cancellation receipt, an unused-operation proof, or permission to Apply.
      if(sameOriginalRead&&"includeRetirement"in body&&body.includeRetirement===true&&response.status===403&&
        "previewId"in body&&"approvalHash"in body&&Boolean(state.previewId)&&Boolean(state.approvalHash)&&
        body.previewId===state.previewId&&body.approvalHash===state.approvalHash&&
        original.previewId===state.previewId&&original.approvalHash===state.approvalHash&&!original.receipt&&
        result&&typeof result==="object"&&!Array.isArray(result)&&Object.keys(result).length===1&&
        "error"in result&&result.error==="authoring_preview_unavailable"&&this.sourceOwnershipActive(sourceOwner))
        next={...next,guardedDismissAvailable:true};
      if(next.phase==="retired")next={...next,authorityKey};
      if(next.phase==="review"){
        const current=this.#documentCopyFacts(target);
        next={...next,sourceRevision,authorityKey,stale:next.stale||!current.canAuthor||
          authorityKey!==current.authorityKey||sourceRevision!==documentCopySourceRevision(current.projection,target)||
          Boolean(next.preview&&Date.parse(next.preview.expiresAt)<=Date.now())};
      }
      if(next.phase==="dismissed"){
        const entries={...this.documentCopyReviews.get()};delete entries[documentCopyKey(target)];
        this.documentCopyReviews.set(entries);this.notify();return next;
      }
      this.#saveDocumentCopy(next);
      if(next.phase==="applied"){
        // Read only while this exact source still owns private publication.
        this.#saveDocumentCopy({...next,busy:true});
        try{await this.refreshEvents();}
        catch{if(canReceive())this.#saveDocumentCopy({...next,issue:"document_copy_refresh_failed"});return canReceive()?this.documentCopyReview(target):null;}
        if(!canReceive())return null;
        const available=this.projection.get().documents.some((document)=>document.id===next.receipt?.documentId&&document.projectId===target.projectId&&!document.removed);
        this.#saveDocumentCopy({...next,busy:false,issue:available?"":"document_copy_refresh_failed"});
      }
      return this.documentCopyReview(target);
    }catch{
      if(ownsRequest()){
        const current=this.documentCopyReviews.get()[documentCopyKey(target)]!;
        this.#saveDocumentCopy(!canReceive()||denied?this.#privateDocumentCopy(current):{...current,busy:false,
          phase:current.receipt?"applied":"uncertain",issue:current.receipt?"document_copy_refresh_failed":"document_copy_uncertain"});
      }
      return null;
    }finally{
      window.clearTimeout(timeout);
      const remaining=this.documentCopyReviews.get()[documentCopyKey(target)];
      if(ownsRequest()&&remaining?.busy)this.#saveDocumentCopy(!canReceive()?this.#privateDocumentCopy(remaining):
        {...remaining,busy:false,phase:remaining.receipt?"applied":"uncertain",issue:remaining.receipt?"document_copy_refresh_failed":"document_copy_uncertain"});
    }
  }

  /** Recheck only the selected project's existing source index; never hydrate, author, or select another context. */
  async refreshOutputSource(target: { authorization: CapturedAuthorizationScope | null; projectId: string; documentId: string;
    currentDocumentId: string; route: string; organizationId: string | null; projectAccessId: string | null },
    controls: { current?: () => boolean } = {}): Promise<{ status: "refreshed" | "denied" | "unavailable" | "superseded" }> {
    const current = () => {
      const projection = this.projection.get(), context = this.session.get()?.projectContext;
      return this.authorizationScopeActive(target.authorization) && Boolean(context?.permissions.includes("project.read"))
        && context?.organizationId === target.organizationId && context?.projectAccessId === target.projectAccessId
        && context?.projectId === target.projectId && projection.projectId === target.projectId
        && projection.documentId === target.currentDocumentId && this.route.get() === target.route
        && projection.documents.some(document => document.id === target.documentId && document.projectId === target.projectId && !document.removed)
        && (!controls.current || controls.current());
    };
    if (!target.organizationId || !target.projectAccessId || !current()) return { status: "superseded" };
    if (this.outputRequirements.resource(target.documentId).errorCode !== "output_target_source_projection_stale") return { status: "superseded" };
    const after = this.head.get();
    if (!Number.isSafeInteger(after) || after < 0) return { status: "unavailable" };
    const read = this.outputRequirements.beginExternalRead(target.documentId);
    if (!read || !read.current() || !current()) return { status: "superseded" };
    try {
      const response = await this.guardedFetch(`/api/workspaces/${encodeURIComponent(target.organizationId)}/projects/${encodeURIComponent(target.projectAccessId)}/events?after=${after}&limit=1&content=0`,
        { method: "GET", credentials: "same-origin", cache: "no-store" }, "refresh the selected project's source index without authoring or generation",
        { current: () => this.authorizationScopeActive(target.authorization) && read.scopeCurrent() });
      if (!this.authorizationScopeActive(target.authorization) || !read.scopeCurrent()) return { status: "superseded" };
      // A current denial retires this exact cache even if its presentation moved.
      // Successful refresh/handoff still requires the original current view.
      if ([401, 403, 404, 410].includes(response.status)) return { status: read.withdraw(response.status) ? "denied" : "superseded" };
      if (!read.current() || !current()) return { status: "superseded" };
      if (!response.ok) return { status: "unavailable" };
      // The existing route completed its authorized index refresh before headers.
      // Its event bodies are not imported into this recovery operation.
      void response.body?.cancel().catch(() => {});
      const refreshed = await read.refresh();
      if (!current()) return { status: "superseded" };
      if (!refreshed) return { status: "superseded" };
      return { status: refreshed.state === "ready" ? "refreshed" : "unavailable" };
    } catch { return { status: current() && read.current() ? "unavailable" : "superseded" }; }
  }
  #canRequestProjectOutputs(){const session=this.session.get(),permissions=session?.projectContext?.permissions??session?.capabilities??[];return permissions.includes("project.output.request");}
  #canReadProjectJobs(){const session=this.session.get(),permissions=session?.projectContext?.permissions??session?.capabilities??[];return permissions.includes("project.read")||permissions.includes("project.output.request");}
  canPreparePlanning(){const session=this.session.get(),permissions=session?.projectContext?.permissions??session?.capabilities??[];return permissions.includes("project.author")&&permissions.includes("project.output.request");}
  #jobFeedCurrent(revision=this.#jobFeedRevision){return revision===this.#jobFeedRevision&&!isRetainedOutputReaderRoute(this.route.get());}
  #scheduleJobPoll(delay=2_000){window.clearTimeout(this.#jobPollTimer);if(!this.#jobFeedCurrent()||!this.sourceOwnershipActive(this.captureSourceOwnership())||!this.#canReadProjectJobs())return;this.#jobPollTimer=window.setTimeout(()=>{if(document.visibilityState==="visible")void this.syncDocumentJobs();},delay);}
  #syncVisibleJobs(path=this.route.get()){if(path!==this.route.get())return;if(!this.#jobFeedCurrent()||!this.#canReadProjectJobs()){window.clearTimeout(this.#jobPollTimer);this.#pendingPassiveJobPath="";return;}if(routeCapabilities(path).jobHistory||this.documentJobs.get().some((job)=>job.status==="queued"||job.status==="running"||job.status==="committing")){this.#pendingPassiveJobPath="";void this.syncDocumentJobs();return;}window.clearTimeout(this.#jobPollTimer);if(document.documentElement.dataset.formaPhase==="populated"){this.#pendingPassiveJobPath="";this.#scheduleJobPoll(1_200);}else this.#pendingPassiveJobPath=path;}
  #jobScope(path=this.route.get()){const documentId=documentIdFromRoute(path);return documentId?`?document=${encodeURIComponent(documentId)}`:routeCapabilities(path).jobHistory?"":"?scope=active";}
  #driveDocumentJobs(jobs:DocumentJob[]){jobs=jobs.filter(job=>!hasServerExecutionOwner(job)&&!documentJobIsMemory(job));
    if(!this.sourceOwnershipActive(this.captureSourceOwnership())||!this.#canRequestProjectOutputs())return;
    const originalScope=this.#activeAuthorizationScope();jobs=jobs.filter(job=>job.sourceSurface==="native-image"||this.#sourcePausedJobs.get(job.jobId)!==originalScope);
    const projection=this.projection.get(),projectDocuments=new Set(projection.documents
      .filter((document)=>document.projectId===projection.projectId).map((document)=>document.id));
    const next=[...jobs].filter((job)=>job.kind!=="prompt_fan"&&(job.status==="queued"||job.status==="running"||job.status==="committing")
      &&(!projectDocuments.size||projectDocuments.has(job.documentId)))
      .sort((a,b)=>a.requestedAt.localeCompare(b.requestedAt)||a.jobId.localeCompare(b.jobId))[0];
    if(next&&next.sourceSurface!=="native-image"&&(next.status==="queued"||documentJobIsStale(next))&&!this.#jobsDriving.has(next.jobId))void this.#driveDocumentJob(next);
    const recoverable=jobs.find((job)=>job.sourceSurface!=="native-image"&&!this.#presentationRecoveryAttempts.has(job.jobId)&&documentJobCanRecoverPresentation(job));
    if(recoverable&&this.session.get()){this.#presentationRecoveryAttempts.add(recoverable.jobId);void this.recoverDocumentPresentation(recoverable.jobId);}
  }
  async #driveDocumentJob(job:DocumentJob){if(documentJobIsMemory(job)||job.sourceSurface==="native-image"||hasServerExecutionOwner(job))return;const sourceOwner=this.captureSourceOwnership(),authorization=this.#activeAuthorizationScope();if(!this.sourceOwnershipActive(sourceOwner)||this.#sourcePausedJobs.get(job.jobId)===authorization)return;this.#jobsDriving.add(job.jobId);try{const response=await fetch(`/api/document-jobs/${encodeURIComponent(job.jobId)}/run`,{method:"POST"});this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);const body=await response.json() as {job?:DocumentJob;error?:string};this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);if(!response.ok&&!body.job)throw new Error(body.error??"document_job_runner_failed");}catch{if(this.sourceOwnershipActive(sourceOwner)&&this.#scopeStillActive(authorization)&&document.visibilityState==="visible")this.toast("The connection to the background operation ended. The app will recover it safely.");}finally{if(this.sourceOwnershipActive(sourceOwner)&&this.#scopeStillActive(authorization)){this.#jobsDriving.delete(job.jobId);this.#scheduleJobPoll(350);}}}
  #captureInitialListReadOwner():NativeImageListReadOwner{
    return{intent:Object.freeze({}),navigation:this.#workspaceTransition,feedRevision:this.#jobFeedRevision,route:this.route.get(),scope:this.#jobScope(),
      source:this.captureSourceOwnership(),session:this.session.get(),sessionRevision:this.#sessionRevision,
      cookieGeneration:this.#projectContextCookieGeneration,cookieSessionGeneration:this.#projectContextSessionGeneration};
  }
  #initialListReadOwnerCurrent(owner:NativeImageListReadOwner){
    return this.#jobFeedCurrent(owner.feedRevision)&&this.sourceOwnershipActive(owner.source)&&this.#canReadProjectJobs()
      &&this.#workspaceTransition===owner.navigation&&this.route.get()===owner.route&&this.#jobScope()===owner.scope
      &&this.session.get()===owner.session&&this.#sessionRevision===owner.sessionRevision
      &&this.#projectContextCookieGeneration===owner.cookieGeneration&&this.#projectContextSessionGeneration===owner.cookieSessionGeneration
      &&owner.cookieGeneration===owner.cookieSessionGeneration;
  }
  #sameInitialListReadOwner(left:NativeImageListReadOwner,right:NativeImageListReadOwner){
    return left.navigation===right.navigation&&left.feedRevision===right.feedRevision&&left.route===right.route&&left.scope===right.scope
      &&left.session===right.session&&left.sessionRevision===right.sessionRevision
      &&left.source?.generation===right.source?.generation&&left.source?.authorization.key===right.source?.authorization.key
      &&left.source?.authorization.shared===right.source?.authorization.shared
      &&left.cookieGeneration===right.cookieGeneration&&left.cookieSessionGeneration===right.cookieSessionGeneration;
  }
  #newInitialListReadClaim(owner:NativeImageListReadOwner,automatic=false):NativeImageListReadClaim{
    let resolveInitial!:(receipt:NativeImageInitialListReadReceipt)=>void,rejectInitial!:(reason:unknown)=>void;
    let resolveSettled!:()=>void,rejectSettled!:(reason:unknown)=>void;
    const initial=new Promise<NativeImageInitialListReadReceipt>((resolve,reject)=>{resolveInitial=resolve;rejectInitial=reject;});
    const settled=new Promise<void>((resolve,reject)=>{resolveSettled=resolve;rejectSettled=reject;});
    return{owner,operation:Object.freeze({initial,settled}),dispatched:false,initialDone:false,automatic,admissionFailed:false,
      resolveInitial,rejectInitial,resolveSettled,rejectSettled,legacyFailure:null,legacy:null,observation:null};
  }
  #finishInitialListRead(claim:NativeImageListReadClaim,receipt:NativeImageInitialListReadReceipt){
    if(claim.initialDone)return;claim.initialDone=true;claim.resolveInitial(Object.freeze(receipt));
  }
  #failInitialListRead(claim:NativeImageListReadClaim,reason:unknown){
    if(claim.initialDone)return;claim.initialDone=true;claim.rejectInitial(reason);
  }
  #supersedePendingInitialListRead(claim:NativeImageListReadClaim){
    this.#finishInitialListRead(claim,{status:"superseded",dispatched:false});claim.resolveSettled();
  }
  #observeInitialListRead(claim:NativeImageListReadClaim){
    // Fixed, invocation-local observation only. This does not change either
    // original channel or turn a busy compatibility caller into its owner.
    return claim.observation??=Promise.allSettled([claim.operation.initial,claim.operation.settled]);
  }
  #legacyInitialListRead(claim:NativeImageListReadClaim):Promise<void>{
    // The legacy facade consumes both channels, including the duplicate early
    // failure. Its historical retry/escaping-finalizer policy is independent
    // from the explicit producer's complete original failure evidence.
    return claim.legacy??=this.#observeInitialListRead(claim).then(()=>{
      if(claim.legacyFailure!==null)throw claim.legacyFailure.reason;
    });
  }
  #claimInitialListRead(owner=this.#captureInitialListReadOwner(),freshAfterActive=false):NativeImageListReadClaim{
    const active=this.#initialListReadActive,pending=this.#initialListReadPending;
    if(this.#initialListReadOwnerCurrent(owner)){
      if(!freshAfterActive&&active&&this.#sameInitialListReadOwner(active.owner,owner)&&this.#initialListReadOwnerCurrent(active.owner))return active;
      if(pending&&this.#sameInitialListReadOwner(pending.owner,owner)&&this.#initialListReadOwnerCurrent(pending.owner))return pending;
    }
    const claim=this.#newInitialListReadClaim(owner);
    // Install/detach the complete pending state before resolving a displaced
    // caller. Neither an old finalizer nor route ABA can reclaim this handle.
    this.#initialListReadPending=null;
    if(pending)this.#supersedePendingInitialListRead(pending);
    if(!this.#initialListReadOwnerCurrent(owner)){
      try{window.clearTimeout(this.#jobPollTimer);
        this.#finishInitialListRead(claim,{status:"not-started",reason:"ineligible"});claim.resolveSettled();
      }catch(error){claim.admissionFailed=true;this.#failInitialListRead(claim,error);claim.legacyFailure={reason:error};claim.rejectSettled(error);}
      return claim;
    }
    if(active||this.#initialListReadPump){this.#initialListReadPending=claim;return claim;}
    this.#initialListReadActive=claim;
    this.#startInitialListRead(claim);
    return claim;
  }
  #startInitialListRead(claim:NativeImageListReadClaim){
    // This cell is reserved before the worker reaches fetch or a callback.
    // The internal worker's two terminal handlers own its original rejection;
    // the public channels remain independently observable by the caller.
    void this.#runInitialListRead(claim).then(()=>claim.resolveSettled(),reason=>{
      this.#failInitialListRead(claim,reason);claim.rejectSettled(reason);
    });
  }
  #pumpInitialListRead(){
    if(this.#initialListReadActive||this.#initialListReadPump||!this.#initialListReadPending)return;
    const pump={};this.#initialListReadPump=pump;
    try{queueMicrotask(()=>{
      if(this.#initialListReadPump!==pump)return;
      this.#initialListReadPump=null;
      if(this.#initialListReadActive)return;
      const claim=this.#initialListReadPending;this.#initialListReadPending=null;
      if(!claim)return;
      this.#initialListReadActive=claim;this.#startInitialListRead(claim);
    });}catch(error){
      if(this.#initialListReadPump===pump){
        this.#initialListReadPump=null;
        const pending=this.#initialListReadPending;this.#initialListReadPending=null;
        if(pending){
          this.#failInitialListRead(pending,error);
          // A failed pump never dispatched the automatic follow-up. Its
          // scheduling failure escapes through the initiating physical pass,
          // not a second unowned legacy rejection for nonexistent work.
          if(!pending.automatic)pending.legacyFailure={reason:error};
          pending.rejectSettled(error);
        }
      }
      throw error;
    }
  }
  /** Explicitly requests one eligible read. The later startup bridge marks a
   * passive/deferred slot unnecessary before calling; this is not a scheduler. */
  beginNativeImageInitialListRead():NativeImageInitialListReadOperation{return this.#claimInitialListRead().operation;}
  async syncDocumentJobs(options:{freshAfterActive?:boolean}={}):Promise<void>{
    const busy=Boolean(this.#initialListReadActive||this.#initialListReadPump||this.#initialListReadPending);
    // A verified explicit native run needs a page begun after its admission;
    // keep existing pending-owner coalescing and the original read/driver pump.
    const claim=this.#claimInitialListRead(this.#captureInitialListReadOwner(),options.freshAfterActive===true);
    // Admission cleanup preceded the legacy busy check. Its caller-local
    // failure still rejects immediately; this never waits on the active pass.
    if(busy&&!claim.admissionFailed){this.#observeInitialListRead(claim);return;}
    return this.#legacyInitialListRead(claim);
  }
  async #runInitialListRead(claim:NativeImageListReadClaim){
    const {owner}=claim,sourceOwner=owner.source,scope=owner.scope,authorization=owner.source?.authorization.key??"";
    const readCurrent=()=>this.#jobFeedCurrent(owner.feedRevision)&&this.sourceOwnershipActive(sourceOwner)
      &&this.#scopeStillActive(authorization)&&this.#canReadProjectJobs()&&this.#jobScope()===scope
      &&this.#workspaceTransition===owner.navigation&&this.route.get()===owner.route
      &&this.#projectContextCookieGeneration===owner.cookieGeneration&&this.#projectContextSessionGeneration===owner.cookieSessionGeneration;
    const assertReadCurrent=()=>{if(!readCurrent())throw new Error("job_feed_retired");};
    const failures:unknown[]=[];let resync=false;
    try{
      if(!this.#initialListReadOwnerCurrent(owner)){
        this.#finishInitialListRead(claim,{status:"superseded",dispatched:false});return;
      }
      const feedBeforeRead=this.documentJobs.get(),planningReadSequence=this.#planningRecoverySequence;
      claim.dispatched=true;
      const response=await fetch(`/api/document-jobs${scope}`);
      if(!readCurrent()){
        resync=true;this.#finishInitialListRead(claim,{status:"superseded",dispatched:true});
        await response.body?.cancel();return;
      }
      if(!response.ok)throw new Error(`Job status returned ${response.status}`);
      const body=await response.json() as {jobs?:DocumentJob[]},currentSession=this.session.get();
      if(!this.#initialListReadOwnerCurrent(owner)||!currentSession||this.#authorizationScope(currentSession)!==authorization){
        resync=true;this.#finishInitialListRead(claim,{status:"superseded",dispatched:true});return;
      }
      // A newer explicit action may have completed while this list was in transit.
      // Discard that older page; a free resync can observe the new canonical state.
      if(this.documentJobs.get()!==feedBeforeRead){resync=true;this.#finishInitialListRead(claim,{status:"superseded",dispatched:true});return;}
      const previous=new Map(feedBeforeRead.map(job=>[job.jobId,job]));
      // Memory has its own explicit request/read owner. Generic feed polling must
      // not drive, acknowledge, hydrate, notify, or block ordinary chat with it.
      const jobs=(body.jobs??[]).filter(job=>!documentJobIsMemory(job)).map(job=>{
        const detail=this.#jobDetails.get(job.jobId);
        if(detail&&job.kind!=="structure_adaptive"&&detail.updatedAt===job.updatedAt)return{...job,result:detail.result};
        if(detail){
          if(this.#adaptiveProposalOriginalMatches(detail,job))this.#cacheDocumentJobDetail(job);
          else this.#jobDetails.delete(job.jobId);
        }
        return job;
      });
      if(!this.#initialListReadOwnerCurrent(owner)||this.documentJobs.get()!==feedBeforeRead){
        resync=true;this.#finishInitialListRead(claim,{status:"superseded",dispatched:true});return;
      }
      this.documentJobs.set(jobs);this.#jobPollFailures=0;this.#jobPollIssueNotified=false;
      this.#finishInitialListRead(claim,{status:"published",intent:owner.intent,scope});
      for(const job of jobs){assertReadCurrent();this.#observeAdaptivePlanningJob(job);}
      assertReadCurrent();this.notify();assertReadCurrent();
      const terminalChanges=jobs.filter(job=>documentJobTerminal(job)&&(previous.has(job.jobId)?previous.get(job.jobId)?.status!==job.status:!job.notifiedAt&&!job.parentJobId));
      const fanProgress=jobs.some(job=>job.kind==="prompt_fan"&&previous.has(job.jobId)&&previous.get(job.jobId)?.updatedAt!==job.updatedAt);
      const disappearedActive=[...previous.values()].some(job=>(job.status==="queued"||job.status==="running"||job.status==="committing")&&!jobs.some(current=>current.jobId===job.jobId));
      const completed=terminalChanges.filter(job=>job.sourceSurface!=="native-image"&&!job.notifiedAt&&!job.parentJobId);
      if(terminalChanges.length||fanProgress||disappearedActive){this.#pendingJobEventRefresh=true;this.#pendingJobSessionRefresh=true;}
      if(this.#pendingJobEventRefresh){await this.#refreshEvents();this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);assertReadCurrent();this.#pendingJobEventRefresh=false;}
      if(this.#pendingJobSessionRefresh){
        try{await this.refreshSession();this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);assertReadCurrent();this.#pendingJobSessionRefresh=false;}
        catch(error){
          let active:boolean;
          try{active=this.#scopeStillActive(authorization);}catch(guard){failures.push(error);throw guard;}
          if(!active)throw error;
          failures.push(error);/* Retry account totals independently of creative recovery. */
        }
      }
      this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);
      assertReadCurrent();
      const inspected=await this.#revalidateMissingAdaptivePlans(jobs,authorization,previous,readCurrent);
      assertReadCurrent();
      this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);
      // Exact inspections may overlap a newer completion, dismissal, or withdrawal.
      // Reconcile from the current authorized page, never the pre-await snapshot.
      const currentJobs=this.documentJobs.get(),currentIds=new Set(currentJobs.map(job=>job.jobId));
      const acceptedInspections=inspected.filter(entry=>this.#planningRecoveryIdentities.get(entry.job.jobId)?.revision===entry.revision&&(this.#planningRecoveryIdentities.get(entry.job.jobId)?.terminalRevision??0)===entry.terminalRevision&&(this.#planningRecoveryIdentities.get(entry.job.jobId)?.deliberateReadRevision??0)===entry.deliberateReadRevision&&!currentIds.has(entry.job.jobId)).map(entry=>entry.job);
      // A deliberate exact inspection can finish while an omitted-page lookup
      // is pending. Preserve that newly certified live result, not arbitrary
      // historical cache entries and not the older inspection's envelope.
      const freshDetails=[...this.#jobDetails.values()].filter(job=>{const proof=this.#planningRecoveryIdentities.get(job.jobId);return job.kind==="structure_adaptive"&&job.planningExecutionId===job.jobId&&!currentIds.has(job.jobId)
        &&job.status==="completed"&&Boolean(job.result?.structure)&&job.result?.planningReviewAvailable!==false&&job.result?.resultUnavailable!==true
        &&proof?.authorization===authorization&&(proof.detailRevision??0)>planningReadSequence&&(proof.withdrawalRevision??0)<(proof.detailRevision??0);});
      const recovered=new Map([...acceptedInspections,...freshDetails].map(job=>[job.jobId,job]));
      this.#syncAdaptiveSuggestionSets([...currentJobs,...recovered.values()]);
      for(const changed of completed){
        assertReadCurrent();
        const job=this.documentJobs.get().find(current=>current.jobId===changed.jobId);if(!job)continue;
        if(job.kind==="structure_adaptive"&&job.sourceSurface!=="canvas"&&job.status==="completed"&&job.result?.structure
          &&job.result.planningReviewAvailable!==false&&job.result.resultUnavailable!==true&&!this.#dismissedAdaptiveSuggestions.has(job.jobId)){
          const selected=this.#adaptiveStructureJobIds.get(job.documentId);
          const pendingSelection=[...this.#planningRecoveryIdentities.values()].some(entry=>entry.selectOnCompletion&&entry.identity.documentId===job.documentId);
          // Signed planning is selected by an owned handoff or an explicit
          // completed review, never merely by arriving on an empty page.
          if(!selected&&!pendingSelection&&job.planningExecutionId!==job.jobId||selected===job.jobId){
            if(job.planningExecutionId===job.jobId)this.#adaptiveStructureJobIds.set(job.documentId,job.jobId);
            this.adaptiveStructures.set({...this.adaptiveStructures.get(),[job.documentId]:job.result.structure as AdaptiveStructure});
          }
        }
        if(job.status==="completed"&&this.#jobResultVisible(job)){void this.#ackJob(job.jobId,job);continue;}
        if(document.visibilityState==="visible"){this.toast(this.#jobNotice(job));assertReadCurrent();if(!job.canvasId)void this.#ackJob(job.jobId,job);}else this.#pendingJobNotices.push(job);
      }
      const latest=this.documentJobs.get();this.notify();assertReadCurrent();this.#driveDocumentJobs(latest);
      this.#scheduleJobPoll(latest.some(job=>job.status==="queued"||job.status==="running"||job.status==="committing")?1_500:this.#pendingJobSessionRefresh?5_000:60_000);
    }catch(error){
      failures.push(error);this.#failInitialListRead(claim,error);
      try{
        if(readCurrent()){
          this.#jobPollFailures+=1;
          try{
            if(this.#jobPollFailures>=3&&!this.#jobPollIssueNotified&&document.visibilityState==="visible"){
              this.#jobPollIssueNotified=true;this.toast("Background status is temporarily unavailable. Retrying…");
            }
          }catch(reporting){failures.push(reporting);claim.legacyFailure={reason:reporting};}
          // Reporting cannot abandon the already required scheduling attempt.
          // Preserve the legacy catch's first escaping failure independently.
          try{this.#scheduleJobPoll(5_000);}
          catch(scheduling){failures.push(scheduling);claim.legacyFailure??={reason:scheduling};}
        }
      }catch(recovery){failures.push(recovery);claim.legacyFailure??={reason:recovery};}
    }finally{
      try{
        if(this.#initialListReadActive===claim){
          this.#initialListReadActive=null;
          const resumedAfterReader=owner.feedRevision!==this.#jobFeedRevision;
          if(!this.#initialListReadPending&&this.#jobFeedCurrent()&&this.sourceOwnershipActive(this.captureSourceOwnership())
            &&(resumedAfterReader||this.sourceOwnershipActive(sourceOwner)&&this.#scopeStillActive(authorization))
            &&(resync||this.#jobScope()!==scope||resumedAfterReader)){
            const next=this.#newInitialListReadClaim(this.#captureInitialListReadOwner(),true);
            this.#initialListReadPending=next;
            // Existing automatic resynchronization has the legacy consumer;
            // its later work is not part of this pass's finite settlement.
            void this.#legacyInitialListRead(next);
          }
          this.#pumpInitialListRead();
        }
      }catch(cleanup){failures.push(cleanup);claim.legacyFailure={reason:cleanup};}
      // eslint-disable-next-line no-unsafe-finally -- Claim settlement must reject recorded failures after all original cleanup completes.
      if(failures.length===1)throw failures[0];
      // eslint-disable-next-line no-unsafe-finally -- Claim settlement must reject recorded failures after all original cleanup completes.
      if(failures.length>1)throw new AggregateError(failures,"native_image_initial_list_read_failed",{cause:failures[0]});
    }
  }

  /** Read-only client evidence guard; the server still recertifies private sources and the HttpOnly context. */
  captureSceneCostSource(request:SceneCostRequest){
    const ownership=this.captureSourceOwnership();
    const source=()=>{
      if(!this.sourceOwnershipActive(ownership))return null;
      const session=this.session.get(),projection=this.projection.get();
      const document=projection.documents.find(candidate=>candidate.id===request.documentId&&candidate.projectId===projection.projectId&&!candidate.removed);
      const context=session?.projectContext,permissions=context?.permissions??session?.capabilities??[];
      if(!session||!document||!permissions.includes("project.read")||context&&context.projectId!==projection.projectId
        ||context&&!(Date.parse(context.expiresAt)>Date.now()))return null;
      const selected=(request.workflowSources??[]).map(item=>{
        const output=item.outputKind==="image"?projection.libraryOutputs.find(candidate=>candidate.id===item.outputId):projection.libraryArtifacts.find(candidate=>candidate.id===item.outputId);
        return [item,output??null,output?.contentRef?this.content.get()[output.contentRef]??null:null,
          this.eventView.get().filter(event=>String(event.payload.artifact_id??event.payload.object_id??"")===item.outputId)];
      });
      return JSON.stringify([this.#activeAuthorizationScope(),this.route.get(),projection.projectId,document.id,document.title,
        [...permissions].sort(),context?.role??null,context?.expiresAt??null,session.policy.accepted,session.policy.version,
        session.provider.plannerModel??null,session.provider.plannerConfigured??null,new Date().toISOString().slice(0,7),
        this.#generationContext(request.documentId),sceneCostRequestDescription(request),selected,
        request.workflowId?this.eventView.get().filter(event=>event.type==="DocumentProductionWorkflowConfigured"&&event.payload.workflow_id===request.workflowId&&event.payload.document_id===request.documentId):[],
        standingConstraints(this.eventView.get())]);
    };
    const original=source();
    return ()=>original!==null&&source()===original;
  }

  /** A free exact read: no budget modal, job feed reconciliation, polling, retry or provider execution. */
  async previewSceneCost(request:SceneCostRequest,options:{sourceSurface?:string;current?:()=>boolean}={}):Promise<SceneCostInspection>{
    const input=JSON.parse(JSON.stringify(request)) as SceneCostRequest;
    const authorization=this.#activeAuthorizationScope(),session=this.session.get(),projectId=this.projection.get().projectId;
    const sourceCurrent=this.captureSceneCostSource(input);
    const current=()=>Boolean(session&&this.#scopeStillActive(authorization)&&sourceCurrent()&&(!options.current||options.current()));
    const check=()=>{if(!current())throw new Error("scene_cost_changed");};
    check();
    const context=this.#generationContext(input.documentId),navigation=this.#navigationCommit;
    await this.#appendPipeline;check();
    if(navigation){if(!await navigation)throw new Error("scene_cost_changed");check();}
    const requestHash=await sceneCostRequestHash(input);check();
    const {requestId,...settings}=input;
    const payload={...context,...settings,artifactKind:"scene",sceneRequestId:requestId,sceneCostPreview:true};
    const response=await fetch("/api/document-jobs",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({kind:"render_document",documentId:input.documentId,sourceSurface:options.sourceSurface??"document",payload})});
    check();
    if(!response.ok&&[401,403,404,410].includes(response.status))throw new Error("scene_cost_unavailable");
    const body=await response.json() as {sceneCostPreview?:unknown;sceneCostExisting?:{requestId?:unknown;preview?:unknown;safeUnused?:unknown};job?:DocumentJob;providerCalls?:unknown;reservations?:unknown;reused?:unknown;error?:unknown};
    check();
    if(!response.ok)throw new Error(typeof body.error==="string"&&(/^(?:scene_cost_|workflow_source_|context_source_)/u.test(body.error)||body.error==="project_source_index_stale")?body.error:"scene_cost_unavailable");
    if(body.job||body.sceneCostExisting){
      if(body.reused!==true||!sceneCostJobMatches(body.job,input.requestId,input.documentId)
        ||body.sceneCostExisting?.requestId!==input.requestId)throw new Error("scene_cost_unavailable");
      const preview=body.sceneCostExisting.preview;
      if(preview!==null&&(!isSceneCostPreview(preview)||preview.requestId!==input.requestId
        ||preview.actorUserId!==session!.user.userId||preview.projectId!==projectId||preview.documentId!==input.documentId))throw new Error("scene_cost_unavailable");
      const candidate=body.sceneCostExisting.safeUnused,job=body.job;
      // Response-only evidence from this exact free read. Status or a zero-looking receipt is never permission.
      const safeUnused=isSceneSafeUnusedProof(candidate)&&preview!==null
        &&candidate.requestId===input.requestId&&candidate.actorUserId===session!.user.userId
        &&candidate.projectId===projectId&&candidate.documentId===input.documentId
        &&candidate.permissionEpoch===(session!.permissionEpoch??"legacy")
        &&Boolean(candidate.contextSessionId)===Boolean(session!.projectContext)
        &&candidate.bindingHash===preview.bindingHash&&candidate.jobStatus===job.status
        &&candidate.jobUpdatedAt===job.updatedAt&&candidate.attemptCount===job.attemptCount
        &&job.leaseExpiresAt===null&&typeof job.completedAt==="string"
        &&Number.isFinite(Date.parse(job.completedAt))&&Date.parse(job.completedAt)<=Date.parse(candidate.verifiedAt)
        ?candidate:null;
      return{requestId:input.requestId,preview,job,safeUnused};
    }
    const preview=body.sceneCostPreview;
    if(body.providerCalls!==0||body.reservations!==0||!isSceneCostPreview(preview)||preview.requestId!==input.requestId
      ||preview.actorUserId!==session!.user.userId||preview.projectId!==projectId||preview.documentId!==input.documentId
      ||preview.permissionEpoch!==(session!.permissionEpoch??"legacy")||Boolean(preview.contextSessionId)!==Boolean(session!.projectContext)
      ||preview.period!==new Date().toISOString().slice(0,7)||preview.requestHash!==requestHash
      ||session!.provider.plannerModel&&preview.model!==session!.provider.plannerModel)throw new Error("scene_cost_changed");
    return{requestId:input.requestId,preview,job:null,safeUnused:null};
  }

  #budgetPreference(key:string){try{return localStorage.getItem(key)==="true";}catch{return false;}}
  #setBudgetPreference(key:string){try{localStorage.setItem(key,"true");}catch{/* A blocked browser storage policy only affects reminder persistence. */}}
  #generationEstimate(kind:DocumentJobKind,payload:Record<string,unknown>){
    if(kind==="chat"||kind==="structure_adaptive")return estimatePlannerOperationMicrousd(this.session.get()?.provider.plannerModel??"gpt-5.6-terra",kind);
    if(kind==="prompt_fan")return 4_000_000;
    if(kind!=="render_document")return 1_000_000;
    const artifactKind=String(payload.artifactKind??"");
    if(artifactKind==="model3d")return estimateModel3dCostMicrousd(payload.model3dSettings);
    if(artifactKind==="scene"){const consent=payload.sceneCostConsent as Partial<SceneCostApproval>|undefined;const {confirmed,...preview}=consent??{};if(confirmed!==true||!isSceneCostPreview(preview))throw new Error("scene_cost_confirmation_required");return preview.maximumMicrousd;}
    const audioCost=artifactKind==="audio"?selectAudioAdapterContract(normalizeAudioRequestProfile(payload.audioProfile,payload.snapshot&&typeof payload.snapshot==="object"?payload.snapshot as Record<string,unknown>:{}),payload.audioProviderModel?{preferredModel:String(payload.audioProviderModel)}:{}).estimatedCostMicrousd:0;
    if(payload.productionMode==="managed"&&["short_story","scene","slides","storyboard","video","audio"].includes(artifactKind)){const production=buildManagedProductionPlan(artifactKind as DocumentArtifactKind,payload.snapshot&&typeof payload.snapshot==="object"?payload.snapshot as Record<string,unknown>:{},artifactKind==="video"?{}:{requestedItemCount:Number(payload.itemCount??payload.requestedSlideCount??0),...(artifactKind==="slides"?{requestedSlideCount:Number(payload.requestedSlideCount??payload.itemCount??0)}:{})});return production.estimatedTotalCostMicrousd+(artifactKind==="storyboard"?production.scenes.length*1_000_000:artifactKind==="audio"?audioCost:0);}
    return artifactKind==="video"?normalizeVideoDurationSeconds(payload.videoSeconds)*VIDEO_ADAPTER_CONTRACT.publishedCostPerSecondMicrousd[VIDEO_ADAPTER_CONTRACT.defaultResolution]+1_000_000:artifactKind==="audio"?audioCost+1_000_000:artifactKind==="storyboard"?Math.max(1,Math.floor(Number(payload.itemCount??6)))*1_000_000+1_000_000:1_000_000;
  }
  async #authorizeGenerationBudget(kind:DocumentJobKind,payload:Record<string,unknown>){
    if(!["preview","generate","prompt_fan","render_document","chat","structure_adaptive"].includes(kind))return;
    const sourceOwner=this.captureSourceOwnership();this.#assertSourceOwnership(sourceOwner);
    const session=this.session.get();if(!session?.costBudgets)return;
    const authorization=this.#authorizationScope(session);
    const billingUserId=session.impersonation?.actor.userId??session.user.userId;
    const noticeKey=generationBudgetPreferenceKey(billingUserId,session.costBudgets.period,"notice",session.projectContext?.organizationId);
    const suppressionKey=generationBudgetPreferenceKey(billingUserId,session.costBudgets.period,"suppressed",session.projectContext?.organizationId);
    const suppressed=this.#budgetPreference(suppressionKey);
    const acknowledged=this.#budgetPreference(noticeKey);
    const gate=generationBudgetGate(session.costBudgets,{projectedMicrousd:this.#generationEstimate(kind,payload),suppressedUntilCritical:suppressed,noticeAcknowledged:acknowledged});
    const locale=currentFormaLocale();
    const localize=(source:string,values:Record<string,string|number>={})=>(locale.messages[formaSystemMessageId(source)]??source).replace(/\{(\w+)\}/g,(_,name:string)=>String(values[name]??""));
    const scope=localize(gate.scope==="workspace"?"organization":"personal");
    if(gate.level==="blocked")throw new GenerationBudgetAdmissionError("budget-blocked",localize("This generation exceeds the remaining {scope} monthly budget.",{scope}));
    if(!gate.requiresAcknowledgement){this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);payload.budgetAcknowledged=acknowledged;payload.budgetWarningSuppressed=suppressed&&gate.level!=="critical";return;}
    const dialog=document.createElement("dialog");dialog.className="modal generation-budget-approval";dialog.lang=locale.locale;dialog.dir=locale.direction;const dialogId=crypto.randomUUID();dialog.setAttribute("aria-labelledby",`generation-budget-title-${dialogId}`);dialog.setAttribute("aria-describedby",`generation-budget-description-${dialogId}`);
    const card=document.createElement("section");card.className="modal-card";
    const heading=document.createElement("h2");heading.id=`generation-budget-title-${dialogId}`;heading.textContent=localize(gate.level==="critical"?"Your monthly generation budget is almost exhausted":"Review your monthly generation budget");
    const message=document.createElement("p");message.id=`generation-budget-description-${dialogId}`;message.textContent=localize("This {scope} budget will be {percent}% used. The generation reserves up to {reserved}; {remaining} remains before it starts.",{scope,percent:new Intl.NumberFormat(locale.formatLocale).format(Math.round(gate.projectedUtilization*100)),reserved:formatGenerationUsd(gate.projectedMicrousd),remaining:formatGenerationUsd(gate.remainingMicrousd)});
    card.append(heading,message);
    let suppression:HTMLInputElement|null=null;
    if(gate.dismissible){const label=document.createElement("label");suppression=document.createElement("input");suppression.type="checkbox";label.append(suppression,document.createTextNode(` ${localize("I no longer want to see this until 95% of the monthly budget is used")}`));card.append(label);}
    const footer=document.createElement("footer"),cancel=document.createElement("button"),continueButton=document.createElement("button");cancel.type="button";cancel.className="button ghost";cancel.textContent=locale.messages["action.cancel"]??"Cancel";continueButton.type="button";continueButton.className="button primary";continueButton.textContent=localize("I understand, continue");footer.append(cancel,continueButton);card.append(footer);dialog.append(card);document.body.append(dialog);
    const accepted=await new Promise<boolean>((resolve)=>{let settled=false;const finish=(requested:boolean)=>{if(settled)return;settled=true;window.removeEventListener("forma-authorization-changed",changed);window.removeEventListener("forma-event-source-retired",retired);const value=requested&&this.#scopeStillActive(authorization)&&this.sourceOwnershipActive(sourceOwner);if(value&&suppression?.checked)this.#setBudgetPreference(suppressionKey);if(value&&gate.level==="notice")this.#setBudgetPreference(noticeKey);if(dialog.open)dialog.close();dialog.remove();resolve(value);};const changed=()=>finish(false),retired=(event:Event)=>{const detail=(event as CustomEvent<EventSourceRetirement>).detail;if(detail&&this.sourceOwnershipScopeActive(detail.source))finish(false);};window.addEventListener("forma-authorization-changed",changed,{once:true});window.addEventListener("forma-event-source-retired",retired);cancel.addEventListener("click",()=>finish(false));continueButton.addEventListener("click",()=>finish(true));dialog.addEventListener("cancel",(event)=>{event.preventDefault();finish(false);});if(!this.#scopeStillActive(authorization)||!this.sourceOwnershipActive(sourceOwner)){finish(false);return;}dialog.showModal();});
    this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);
    if(!accepted)throw new GenerationBudgetAdmissionError("user-canceled",localize("Generation canceled before any provider work was started."));
    payload.budgetAcknowledged=true;payload.budgetWarningSuppressed=this.#budgetPreference(suppressionKey)&&gate.level!=="critical";
  }
  async #startDocumentJob(kind:DocumentJobKind,payload:Record<string,unknown>,sourceSurface:string,documentIdOverride?:string,controls:Pick<SceneSubmissionPorts,"current"|"onDispatch">&{nativeShortStory?:true;nativeImage?:NativeImageSetup;onInvoke?:()=>void;onAcknowledgment?:(acknowledgment:Extract<NativeImageSubmission,{disposition:"acknowledged"}>)=>void}={}):Promise<{job:DocumentJob;reused:boolean;sceneCostExisting?:{requestId:string;preview:SceneCostPreview|null}}>{
    const sourceOwner=this.captureSourceOwnership(),sourceProjectId=this.projection.get().projectId;
    const scene=kind==="render_document"&&payload.artifactKind==="scene";
    const guarded=scene||kind==="render_document"&&payload.artifactKind==="model3d"||controls.nativeShortStory===true||Boolean(controls.nativeImage);
    const check=()=>{this.#assertSourceOwnership(sourceOwner);if(guarded&&controls.current&&!controls.current())throw new Error("scene_cost_changed");};check();
    if(!payload.locale&&["preview","generate","prompt_fan","render_document"].includes(kind))payload={...payload,locale:typeof document==="undefined"?"en":document.documentElement.lang||"en"};
    const authorization=this.#activeAuthorizationScope();
    if(!this.#canRequestProjectOutputs())throw new Error("Your project role does not permit creating outputs.");
    const documentId=documentIdOverride??this.projection.get().documentId;
    if(kind==="structure_adaptive")payload={...payload,requestKey:await adaptiveRequestKey({projectId:this.projection.get().projectId,documentId,canvasId:payload.canvasId,sourceSurface,projectScope:payload.projectScope,locale:payload.locale,prompt:payload.prompt})};
    const requestKey=String(payload.requestKey??"");
    if(requestKey){
      const active=this.documentJobs.get().find((job)=>job.documentId===documentId&&job.kind===kind&&job.requestKey===requestKey&&["queued","running","committing"].includes(job.status));
      if(active&&kind!=="structure_adaptive"&&!scene){
        if(controls.nativeImage){
          const exact=this.#nativeImageJob(active,controls.nativeImage,true);
          if(!exact)throw new Error("native_image_job_identity_mismatch");
          check();controls.onAcknowledgment?.(exact.acknowledgment);
        }
        return{job:active,reused:true};
      }
      if(kind==="render_document"&&payload.artifactKind==="slides"&&payload.paidRetryConfirmed!==true){
        const failed=this.documentJobs.get().find((job)=>job.documentId===documentId&&job.kind===kind&&job.requestKey===requestKey&&job.status==="failed"&&job.result?.artifactKind==="slides");
        if(failed&&documentJobCanRecoverPresentation(failed)){
          if(await this.recoverDocumentPresentation(failed.jobId)){const recovered=this.documentJobs.get().find((job)=>job.jobId===failed.jobId);if(recovered)return{job:recovered,reused:true};}
          throw new Error("The already-paid slideshow could not be recovered safely; review its saved draft before approving another paid request.");
        }
      }
    }
    if(requestKey&&this.#jobStarts.has(requestKey))throw new Error(kind==="render_document"?"This exact output request is already being queued.":"This exact image request is already being queued.");
    let imagePrimary:{error:unknown}|null=null;
    if(requestKey){this.#jobStarts.add(requestKey);if(!controls.nativeImage)this.notify();}try{if(controls.nativeImage&&requestKey)this.notify();const navigation=this.#navigationCommit;await this.#appendPipeline;this.#assertAuthorizationScope(authorization);check();
      if(navigation&&!await navigation)throw new Error("The selected project could not be opened safely.");
      this.#assertAuthorizationScope(authorization);check();await this.#authorizeGenerationBudget(kind,payload);this.#assertAuthorizationScope(authorization);check();
      const action=kind==="preview"?"start a draft image":kind==="generate"?"start a full-quality image":kind==="prompt_fan"?"start a four-image prompt fan":`start ${kind.replaceAll("_"," ")}`;
      let dispatched=false;
      const response=await this.guardedFetch("/api/document-jobs",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({kind,documentId,sourceSurface,payload})},action,{current:()=>dispatched||this.sourceOwnershipActive(sourceOwner)&&(!guarded||!controls.current||controls.current()),onInvoke:controls.nativeImage?controls.onInvoke:undefined,onDispatch:()=>{dispatched=true;controls.onDispatch?.();}});
      this.#assertAuthorizationScope(authorization);
      const body=await response.json() as {job?:DocumentJob;error?:string;message?:string;reused?:boolean;readiness?:GenerationReadiness;attemptSubmission?:string;sceneCostExisting?:{requestId:string;preview:SceneCostPreview|null}};
      this.#assertAuthorizationScope(authorization);
      if(!response.ok||!body.job)throw Object.assign(new Error(body.message??body.error??"Document operation could not be started"),scene&&body.attemptSubmission==="not-submitted"?{attemptSubmission:"not-submitted"}:{});
      if(scene){
        if(!sceneCostJobMatches(body.job,String(payload.sceneRequestId??""),documentId))throw new Error("scene_cost_unavailable");
        const original=body.sceneCostExisting,session=this.session.get();
        if(original&&(original.requestId!==payload.sceneRequestId||original.preview!==null&&(!isSceneCostPreview(original.preview)
          ||original.preview.requestId!==payload.sceneRequestId||original.preview.actorUserId!==session?.user.userId
          ||original.preview.projectId!==sourceProjectId||original.preview.documentId!==documentId)))throw new Error("scene_cost_unavailable");
      }
      if(kind==="structure_adaptive"&&!adaptiveJobMatchesRequest(body.job,{documentId,canvasId:typeof payload.canvasId==="string"?payload.canvasId:null,sourceSurface,requestKey}))throw new Error(currentFormaLocale().messages["next.exact.unavailable"]??"The exact planning request changed.");
      if(controls.nativeShortStory&&!acknowledgedNativeStoryHandle(body.job,{documentId,documentRevision:payload.documentRevision,requestKey:payload.requestKey}))throw new Error("native_story_job_identity_mismatch");
      if(controls.nativeImage){
        // Fresh Worker ACKs carry accepted:true and omit reused; a present
        // malformed reuse marker remains inadmissible.
        const reused=Object.hasOwn(body,"reused")?body.reused:false;
        const exact=this.#nativeImageJob(body.job,controls.nativeImage,reused);
        if(!exact)throw new Error("native_image_job_identity_mismatch");
        body.job=exact.job;
        // Preserve the exact original ACK before UI/source notification.
        // A callback failure cannot retroactively make this an unused request.
        controls.onAcknowledgment?.(exact.acknowledgment);
      }
      const activeSession=this.session.get();if(!activeSession||this.#authorizationScope(activeSession)!==authorization)throw new Error("The selected project changed before this request finished.");
      let imageCurrent=true;
      if(controls.nativeImage){
        imageCurrent=!controls.current||controls.current();
        // An opening predicate is reentrant. Its answer cannot authorize a write
        // into a session/cookie context it replaced while answering.
        this.#assertAuthorizationScope(authorization);
        if(this.#projectContextCookieGeneration!==this.#projectContextSessionGeneration)throw new Error("native_image_source_changed");
      }
      if(!this.sourceOwnershipActive(sourceOwner)||(controls.nativeImage?!imageCurrent:guarded&&controls.current&&!controls.current())){
        this.#sourcePausedJobs.set(body.job.jobId,authorization);
        const reference=this.#privateJobReference(body.job);
        this.documentJobs.set([reference,...this.documentJobs.get().filter(job=>job.jobId!==reference.jobId)]);this.notify();
        return{job:reference,reused:Boolean(body.reused),...(scene&&body.sceneCostExisting?{sceneCostExisting:{requestId:body.sceneCostExisting.requestId,preview:null}}:{})};
      }
      if(body.readiness&&requestKey)this.generationReadiness.set({...this.generationReadiness.get(),[requestKey]:body.readiness});
      const jobs=[body.job,...this.documentJobs.get().filter((job)=>job.jobId!==body.job!.jobId)];
      this.documentJobs.set(jobs);if(requestKey)this.#readinessAcknowledgements.delete(requestKey);
      if(!controls.nativeImage){this.notify();this.#driveDocumentJobs(jobs);this.#scheduleJobPoll(800);}
      else{
        // This is an immediate post-notification check, never a durable I2
        // operation predicate handed to the inherited background driver.
        const owned=()=>this.#scopeStillActive(authorization)&&this.sourceOwnershipActive(sourceOwner)
          &&this.#projectContextCookieGeneration===this.#projectContextSessionGeneration;
        const active=()=>owned()&&(!controls.current||controls.current())&&owned();
        const original=body.job;
        const pauseOriginal=()=>{
          if(!owned())return;
          // The immutable acknowledged job ID owns the pause even if a newer
          // poll/read replaced its row. Never overwrite that newer presentation.
          this.#sourcePausedJobs.set(original.jobId,authorization);
          const latest=this.documentJobs.get();
          if(latest.includes(original)){
            const reference=this.#privateJobReference(original);
            this.documentJobs.set(latest.map(job=>job===original?reference:job));this.notify();
          }
        };
        try{
          this.notify();
          if(!active())pauseOriginal();
        }catch(error){
          // A throwing listener cannot bypass the pause for a received job.
          // Keep the original failure even when withdrawal notification fails.
          try{pauseOriginal();}catch(cleanup){
            const retirementFailure=combineNativeImageRetirementFailures([error,cleanup]);
            if(retirementFailure)throw retirementFailure;
            throw new AggregateError([error,cleanup],"native_image_notification_cleanup_failed",{cause:error});
          }
          throw error;
        }
      }
      return{job:body.job,reused:Boolean(body.reused),...(scene&&body.sceneCostExisting?{sceneCostExisting:body.sceneCostExisting}:{})};
    }catch(error){imagePrimary={error};throw error;}
    finally{
      try{if(requestKey&&this.#scopeStillActive(authorization)){this.#jobStarts.delete(requestKey);this.notify();}}
      catch(cleanup){
        const retirementFailure=imagePrimary?combineNativeImageRetirementFailures([imagePrimary.error,cleanup]):null;
        // eslint-disable-next-line no-unsafe-finally -- A retirement aggregate retains primary and cleanup failures after the original operation.
        if(retirementFailure)throw retirementFailure;
        // eslint-disable-next-line no-unsafe-finally -- This native submission aggregate retains both original work and cleanup failures.
        if(controls.nativeImage&&imagePrimary)throw new AggregateError([imagePrimary.error,cleanup],"native_image_submission_cleanup_failed",{cause:imagePrimary.error});
        // eslint-disable-next-line no-unsafe-finally -- Keep existing cleanup failure precedence when there is no retained Image aggregate.
        throw cleanup;
      }
    }
  }
  patchUi(patch: Partial<typeof this.ui>) { Object.assign(this.ui, patch); this.notify(); }
  #systemNotice(source:string,values:Record<string,string|number>={}){const locale=currentFormaLocale();const automatic=formaSystemMessageId(source);const fallback=Object.entries(FORMA_DEFAULT_MESSAGES).find(([,value])=>value===source)?.[0];const message=locale.messages[automatic]??(fallback?locale.messages[fallback]:undefined)??source;return Object.keys(values).length?message.replace(/\{(\w+)\}/g,(_,key:string)=>{const value=values[key];return typeof value==="number"?new Intl.NumberFormat(locale.formatLocale).format(value):String(value??"");}):message;}
  #retireToast(){
    const revision=++this.#toastRevision;
    if(this.#toastTimer!==undefined)window.clearTimeout(this.#toastTimer);
    this.#toastTimer=undefined;
    this.ui.toast="";this.ui.toastPresentation="overlay";
    return revision;
  }
  toast(message: string,presentation:"overlay"|"inline"="overlay") {
    return this.#nativeImageMutation(()=>{
    const localized=this.#systemNotice(message);
    const revision=this.#retireToast();
    this.ui.toastPresentation=presentation;this.ui.toast=localized;
    this.#toastTimer=window.setTimeout(()=>{
      if(this.#toastRevision!==revision)return;
      this.#retireToast();this.notify();
    },2800);
    this.notify();
    });
  }
  async confirmImpersonatedInteraction(action="change this fictional account"){
    if(!this.session.get()?.impersonation)return true;if(this.#impersonationConfirmation)return false;this.patchUi({impersonationConfirmOpen:true,impersonationAction:action});return new Promise<boolean>((resolve)=>{this.#impersonationConfirmation=resolve;});
  }
  resolveImpersonatedInteraction(confirmed:boolean){const resolve=this.#impersonationConfirmation;this.#impersonationConfirmation=undefined;this.patchUi({impersonationConfirmOpen:false,impersonationAction:""});resolve?.(confirmed);if(!confirmed)this.toast("Canceled. The fictional account was not changed.");}
  async guardedFetch(input:RequestInfo|URL,init:RequestInit={},action="change this fictional account",controls:Pick<SceneSubmissionPorts,"current"|"onDispatch">&{onNotDispatchedAtConfirmation?:()=>void;onInvoke?:()=>void}={}){
    const check=()=>{if(this.#projectContextCookieGeneration!==this.#projectContextSessionGeneration)throw new Error("The project context session must be reconciled before continuing.");if(controls.current&&!controls.current())throw new Error("scene_cost_changed");};check();
    const authorization=this.#activeAuthorizationScope(),method=String(init.method??(input instanceof Request?input.method:"GET")).toUpperCase();
    if(!this.session.get()?.impersonation||["GET","HEAD","OPTIONS"].includes(method)){check();controls.onInvoke?.();const pending=fetch(input,init);try{controls.onDispatch?.();}catch{/* A presentation callback cannot abandon an already-dispatched request. */}const response=await pending;check();if(authorization)this.#assertAuthorizationScope(authorization);return response;}
    const confirmed=await this.confirmImpersonatedInteraction(action);this.#assertAuthorizationScope(authorization);check();if(!confirmed){try{controls.onNotDispatchedAtConfirmation?.();}catch{/* A presentation callback cannot dispatch this unapproved attempt. */}return Response.json({error:"Action canceled. No changes were made to the fictional account."},{status:409});}const headers=new Headers(input instanceof Request?input.headers:undefined);new Headers(init.headers).forEach((value,key)=>headers.set(key,value));headers.set("x-forma-impersonation-confirmation","I understand, continue");check();controls.onInvoke?.();const pending=fetch(input,{...init,headers});try{controls.onDispatch?.();}catch{/* A presentation callback cannot abandon an already-dispatched request. */}const response=await pending;check();this.#assertAuthorizationScope(authorization);return response;
  }
  async startImpersonating(personaId:string,route="/projects"){
    const response=await fetch("/api/impersonation",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({personaId,confirmation:"I understand, continue"})});const body=await response.json() as {route?:string;error?:string};if(!response.ok)throw new Error(body.error??"The fictional account could not be opened");window.location.assign(body.route??route);
  }
  async stopImpersonating(){const response=await fetch("/api/impersonation",{method:"DELETE"});const body=await response.json() as {route?:string;error?:string};if(!response.ok)throw new Error(body.error??"Your regular account could not be restored");window.location.assign(body.route??"/laboratory/replay");}
  #scheduleProjectTaskExpiry() {
    if (this.#projectTaskExpiry) window.clearTimeout(this.#projectTaskExpiry.timer);
    this.#projectTaskExpiry = null;
    if (!isProjectTaskRoute(this.route.get())) return;
    const session = this.session.get(), context = session?.projectContext;
    if (!session || !context) return;
    const deadline = Date.parse(context.expiresAt);
    if (!Number.isFinite(deadline) || deadline <= Date.now()) {
      // Republish identical signed fields only to invalidate cached projections.
      // This is not a fresh authorization, session refresh, or HTTP operation.
      this.session.set({ ...session }); this.notify(); return;
    }
    // Starting a session read or workspace handoff cannot extend this published deadline.
    const authorization = this.captureAuthorizationScope(), route = this.route.get();
    const owner = { timer: 0 };
    this.#projectTaskExpiry = owner;
    const arm = () => {
      owner.timer = window.setTimeout(() => {
        if (this.#projectTaskExpiry !== owner) return;
        if (this.route.get() !== route
          || this.session.get() !== session
          || !this.authorizationScopeActive(authorization) || this.session.get()?.projectContext?.expiresAt !== context.expiresAt) {
          this.#projectTaskExpiry = null; return;
        }
        if (Date.now() < deadline) { arm(); return; }
        this.#projectTaskExpiry = null;
        this.session.set({ ...session }); this.notify();
      }, Math.min(2_147_483_647, Math.max(1, deadline - Date.now())));
    };
    arm();
  }

  #projectTaskRoute(path: string, options: WorkspaceNavigationOptions = {}) {
    return projectTaskDocumentIdFromRoute(path) !== null ? path
      : withProjectTaskDocumentInRoute(path, options.documentId ?? this.projection.get().documentId, options.documentId === undefined ? this.route.get() : undefined);
  }

  #stopNativeImageWorkspaceStartup(dispatcher:NativeImageWorkspaceStartupDispatcher,disposition:"superseded"|"startup-dispatch-failed"|NativeImageWorkspaceStartupEndReason,retainedFailures?:unknown[]):NativeImageWorkspaceStartupSlot|null{
    if(!dispatcher.armed)return null;
    // Detach every callback and reserve every disposition before cancellation
    // or a ticket method can reenter. Failed cancellation cannot rearm work.
    dispatcher.armed=false;
    if(this.#nativeImageWorkspaceStartup===dispatcher)this.#nativeImageWorkspaceStartup=null;
    const slots:NativeImageWorkspaceStartupSlot[]=["history","private-hydration","initial-visible-job-read"];
    const pending=slots.filter(slot=>dispatcher.unstarted[slot]);
    const frames=slots.map(slot=>({slot,frame:dispatcher.frames[slot]}));
    for(const slot of slots){dispatcher.unstarted[slot]=false;dispatcher.frames[slot]=null;}
    const failures=retainedFailures??[];let firstFailure:NativeImageWorkspaceStartupSlot|null=null;
    for(const {slot,frame} of frames)if(frame&&frame.id!==null){
      try{cancelAnimationFrame(frame.id);}catch(error){firstFailure??=slot;failures.push(error);}
    }
    for(const slot of pending){
      try{
        if(disposition==="superseded")dispatcher.startup.superseded(slot);
        else dispatcher.startup.unnecessary(slot,disposition);
      }catch(error){firstFailure??=slot;failures.push(error);}
    }
    if(!retainedFailures)this.#throwWorkspaceNavigationFailures(failures);
    return firstFailure;
  }

  #failNativeImageWorkspaceStartup(dispatcher:NativeImageWorkspaceStartupDispatcher,slot:NativeImageWorkspaceStartupSlot,primary:unknown){
    const failures:unknown[]=[primary];
    // Stop only this captured dispatcher before cancellation, classification
    // or failure delivery. A successor is never detached by this cleanup.
    this.#stopNativeImageWorkspaceStartup(dispatcher,"startup-dispatch-failed",failures);
    const reason=combineNativeImageRetirementFailures(failures)
      ??(failures.length===1?failures[0]:new AggregateError(failures,"workspace_navigation_failed",{cause:failures[0]}));
    // A current predicate may start B and then throw. Preserve A's error even
    // when B has already superseded A's slots; no slot is replaced or faked.
    dispatcher.startup.failed(slot,reason);
  }

  /** Called after the original Image navigation returned false/rejected, or
   * when its actual host disconnects. Child replacement is not host departure.
   * A pre-admission or already-superseded caller cannot touch another record.
   * The host fills any still-unclaimed ticket slots after this exact cleanup. */
  finishNativeImageStartup(startup:NativeImageWorkspaceStartup,reason:NativeImageWorkspaceStartupEndReason="navigation-ended-before-start"):boolean{
    const dispatcher=this.#nativeImageWorkspaceStartup;
    if(!dispatcher||dispatcher.startup!==startup)return false;
    this.#stopNativeImageWorkspaceStartup(dispatcher,reason);
    return true;
  }

  #startNativeImageWorkspaceSlot(dispatcher:NativeImageWorkspaceStartupDispatcher,slot:NativeImageWorkspaceStartupSlot,work:()=>unknown){
    if(!dispatcher.armed||this.#nativeImageWorkspaceStartup!==dispatcher||!dispatcher.unstarted[slot])return;
    const current=this.#workspaceNavigationCurrent(dispatcher.owner);
    if(!dispatcher.armed||this.#nativeImageWorkspaceStartup!==dispatcher||!dispatcher.unstarted[slot])return;
    if(!current){this.#stopNativeImageWorkspaceStartup(dispatcher,"superseded");return;}
    dispatcher.unstarted[slot]=false;
    // Concrete host start is callback-free until it invokes this exact work.
    // Guard failures are not fabricated helper invocations or read receipts.
    dispatcher.startup.start(slot,work);
  }

  #unnecessaryNativeImageWorkspaceSlot(dispatcher:NativeImageWorkspaceStartupDispatcher,slot:NativeImageWorkspaceStartupSlot,reason:string){
    if(!dispatcher.armed||this.#nativeImageWorkspaceStartup!==dispatcher||!dispatcher.unstarted[slot])return;
    dispatcher.unstarted[slot]=false;
    dispatcher.startup.unnecessary(slot,reason);
  }

  #deferNativeImageWorkspaceSlot(dispatcher:NativeImageWorkspaceStartupDispatcher,slot:NativeImageWorkspaceStartupSlot,work:()=>unknown){
    if(!dispatcher.armed||this.#nativeImageWorkspaceStartup!==dispatcher
      ||!dispatcher.unstarted[slot]||dispatcher.frames[slot])return;
    const frame:NativeImageWorkspaceStartupFrame={id:null};
    dispatcher.frames[slot]=frame;
    try{
      frame.id=requestAnimationFrame(()=>{
        if(dispatcher.frames[slot]!==frame)return;
        dispatcher.frames[slot]=null;
        if(!dispatcher.armed||this.#nativeImageWorkspaceStartup!==dispatcher)return;
        try{this.#startNativeImageWorkspaceSlot(dispatcher,slot,work);}
        catch(reason){this.#failNativeImageWorkspaceStartup(dispatcher,slot,reason);}
      });
    }catch(error){
      // A scheduler may have queued before throwing. This exact callback is
      // permanently inert even when no cancellation id was returned.
      if(dispatcher.frames[slot]===frame)dispatcher.frames[slot]=null;
      throw error;
    }
  }

  #captureWorkspaceNavigation(options:WorkspaceNavigationOptions):WorkspaceNavigationOwner{
    const session=this.session.get();
    const owner:WorkspaceNavigationOwner={options:{},handedOff:false,revision:this.#workspaceTransition,
      route:this.route.get(),browserRoute:`${location.pathname}${location.search}${location.hash}`,
      session,sessionRevision:this.#sessionRevision,sourceGeneration:this.#sourceGeneration,sourceRetired:this.#sourceRetired,
      authorization:session?this.#authorizationScope(session):"",shared:Boolean(session?.projectContext),
      cookieGeneration:this.#projectContextCookieGeneration,cookieSessionGeneration:this.#projectContextSessionGeneration,startup:null};
    owner.options={...options};
    const startup=owner.options.nativeImageStartup;
    if(startup){
      if(!Object.isFrozen(startup)||!startup.id||typeof startup.id!=="object"||!Object.isFrozen(startup.id))
        throw new TypeError("native_image_startup_observer_required");
      owner.startup={startup,owner,armed:true,commit:null,
        unstarted:{history:true,"private-hydration":true,"initial-visible-job-read":true},
        frames:{history:null,"private-hydration":null,"initial-visible-job-read":null}};
    }
    return owner;
  }
  #workspaceNavigationOptions(owner:WorkspaceNavigationOwner):WorkspaceNavigationOptions{
    // Only a fresh Store-created copy may carry this operation through a public
    // navigation port. Reusing the caller's original object starts a new owner.
    const options={...owner.options};this.#workspaceNavigationOwners.set(options,owner);return options;
  }
  #takeWorkspaceNavigation(options:WorkspaceNavigationOptions){
    const owner=this.#workspaceNavigationOwners.get(options);
    if(owner){this.#workspaceNavigationOwners.delete(options);return owner;}
    return this.#captureWorkspaceNavigation(options);
  }
  #workspaceNavigationStable(owner:WorkspaceNavigationOwner){
    const session=this.session.get();
    return owner.revision===this.#workspaceTransition&&owner.route===this.route.get()
      &&owner.browserRoute===`${location.pathname}${location.search}${location.hash}`
      &&owner.session===session&&owner.sessionRevision===this.#sessionRevision
      &&owner.sourceGeneration===this.#sourceGeneration&&owner.sourceRetired===this.#sourceRetired
      &&owner.authorization===(session?this.#authorizationScope(session):"")&&owner.shared===Boolean(session?.projectContext)
      &&owner.cookieGeneration===this.#projectContextCookieGeneration&&owner.cookieSessionGeneration===this.#projectContextSessionGeneration;
  }
  #workspaceNavigationCurrent(owner:WorkspaceNavigationOwner){
    if(!this.#workspaceNavigationStable(owner))return false;
    if(!owner.handedOff&&owner.options.current&&(!owner.options.current()||!this.#workspaceNavigationStable(owner)))return false;
    if(owner.options.focus&&(!owner.options.focus.current()||!this.#workspaceNavigationStable(owner)))return false;
    return this.#workspaceNavigationStable(owner);
  }
  #handoffWorkspaceNavigation(owner:WorkspaceNavigationOwner){
    if(!this.#workspaceNavigationCurrent(owner))return false;
    if(owner.handedOff||!owner.options.onOriginHandoff)return true;
    if(!owner.options.onOriginHandoff())return false;
    owner.handedOff=true;return this.#workspaceNavigationCurrent(owner);
  }
  #advanceWorkspaceNavigation(owner:WorkspaceNavigationOwner){
    if(!this.#workspaceNavigationCurrent(owner))return false;
    owner.revision=++this.#workspaceTransition;
    const previous=this.#nativeImageWorkspaceStartup;
    const next=owner.startup?.armed&&owner.startup.owner===owner?owner.startup:null;
    if(previous!==next){
      this.#nativeImageWorkspaceStartup=next;
      if(previous){
        const failures:unknown[]=[];
        const anchor=this.#stopNativeImageWorkspaceStartup(previous,"superseded",failures);
        if(anchor!==null){
          const reason=combineNativeImageRetirementFailures(failures)
            ??(failures.length===1?failures[0]:new AggregateError(failures,"workspace_navigation_failed",{cause:failures[0]}));
          // The first actual cleanup failure anchors this supplemental record;
          // it does not attribute every aggregate member to that slot. A owns
          // the record before B receives this same original failure object.
          try{previous.startup.failed(anchor,reason);}
          catch(deliveryFailure){this.#throwWorkspaceNavigationFailures([reason,deliveryFailure]);}
          throw reason;
        }
        return this.#workspaceNavigationCurrent(owner);
      }
    }
    return true;
  }
  #assignWorkspaceNavigation(path:string,owner:WorkspaceNavigationOwner){
    if(!this.#handoffWorkspaceNavigation(owner)||!this.#advanceWorkspaceNavigation(owner))return false;
    owner.handedOff=true;
    this.#nativeImageAdmissionHolds+=1;
    try{
      this.#advanceNativeImageFence();
      // A nested half-applied mutation cannot safely deliver its cleanup yet.
      // Cancel this page transfer rather than assign before that cleanup.
      if(this.#nativeImageNotificationHolds!==0)return false;
      this.#finishNativeImageWork(undefined,null,this.#drainNativeImageRetirements());
      if(!this.#workspaceNavigationCurrent(owner))return false;
      location.assign(path);return true;
    }finally{this.#nativeImageAdmissionHolds-=1;}
  }
  setRoute(path:string,options:WorkspaceNavigationOptions={}):boolean|Promise<boolean>{
    const owner=this.#takeWorkspaceNavigation(options);
    if(!this.#workspaceNavigationCurrent(owner))return false;
    path=this.#projectTaskRoute(path,owner.options);
    if(!this.#workspaceNavigationCurrent(owner))return false;
    if(isStandaloneExperienceRoute(path))return this.#assignWorkspaceNavigation(path,owner);
    const source=applicationIdFromRoute(owner.route),destination=applicationIdFromRoute(path);
    if(source!==destination)return !["creative","canvas"].includes(source)||!["creative","canvas"].includes(destination)
      ?this.#assignWorkspaceNavigation(path,owner):this.transitionWorkspace(path,this.#workspaceNavigationOptions(owner));
    return this.#commitRoute(path,owner);
  }

  async transitionWorkspace(path:string,options:WorkspaceNavigationOptions={}){
    const owner=this.#takeWorkspaceNavigation(options),navigationScope=this.captureAuthorizationScope();options=owner.options;
    if(!this.#workspaceNavigationCurrent(owner))return false;
    path=this.#projectTaskRoute(path,options);
    if(!this.#workspaceNavigationCurrent(owner))return false;
    if(isStandaloneExperienceRoute(path))return this.#assignWorkspaceNavigation(path,owner);
    const source=applicationIdFromRoute(owner.route),destination=applicationIdFromRoute(path);
    if(source===destination)return this.#commitRoute(path,owner);
    if(!["creative","canvas"].includes(source)||!["creative","canvas"].includes(destination))return this.#assignWorkspaceNavigation(path,owner);
    const previous=owner.session;
    if(!this.#advanceWorkspaceNavigation(owner))return false;
    const attempt=owner.revision;
    const expectedSession=(session:PilotSession):WorkspaceNavigationOwner=>{
      const authorization=this.#authorizationScope(session),changed=!owner.session||owner.authorization!==authorization;
      return{...owner,session,sessionRevision:owner.sessionRevision+1,sourceGeneration:owner.sourceGeneration+Number(changed),
        sourceRetired:changed?false:owner.sourceRetired,authorization,shared:Boolean(session.projectContext)};
    };
    try{
      const response=await fetch(`/api/session?audience=${encodeURIComponent(destination)}`,{cache:"no-store",credentials:"same-origin"});
      const ownsHeaders=owner.revision===attempt&&this.#workspaceNavigationCurrent(owner);
      const current=await response.json() as PilotSession&{error?:string};
      const ownsBody=owner.revision===attempt&&this.#workspaceNavigationCurrent(owner);
      if(!response.ok)throw new Error(current.error??"The selected workspace is no longer available.");
      if(owner.revision!==attempt||!this.#workspaceNavigationStable(owner))return false;
      if(!this.authorizationScopeActive(navigationScope))return false;
      if(!workspaceTransitionAuthorized(previous,current,destination)){
        // A negative response may retire the original actor's permissions, but
        // cannot release the original view or adopt a positive navigation.
        if(previous&&previous.user.userId===current.user.userId){
          const next={...current,audience:previous.audience},expected=expectedSession(next);
          this.#applySession(next);
          if(!this.#workspaceNavigationStable(expected))return false;
        }
        if(!owner.options.nativeImageStartup)this.toast(destination==="canvas"?"Canvas is no longer available for this account or project.":"Your workspace authorization has changed. Reload your current project.");
        return false;
      }
      if(!ownsHeaders||!ownsBody||owner.revision!==attempt||!this.#handoffWorkspaceNavigation(owner))return false;
      const next={...current,audience:previous?.audience},expected=expectedSession(next);
      if(owner.revision!==attempt||!this.#workspaceNavigationCurrent(owner))return false;
      this.#applySession(next);
      if(owner.revision!==attempt||!this.#workspaceNavigationStable(expected))return false;
      // Only this predicted adoption may refresh snapshots. An extra adoption,
      // source retirement, or away-and-back navigation cannot be recaptured.
      owner.session=expected.session;owner.sessionRevision=expected.sessionRevision;
      owner.sourceGeneration=expected.sourceGeneration;owner.sourceRetired=expected.sourceRetired;
      owner.authorization=expected.authorization;owner.shared=expected.shared;
      if(!this.#workspaceNavigationCurrent(owner))return false;
      if(options.onDestinationSource){
        const adopted=this.captureSourceOwnership();
        if(!adopted||!this.sourceOwnershipActive(adopted)||!this.#workspaceNavigationCurrent(owner))return false;
        if(!options.onDestinationSource(adopted)||!this.#workspaceNavigationCurrent(owner)||!this.sourceOwnershipActive(adopted))return false;
      }
      return this.#commitRoute(path,owner);
    }catch(error){
      if(owner.options.nativeImageStartup||NativeImageRetirementError.is(error))throw error;
      try{
        if(owner.revision===attempt&&this.#workspaceNavigationCurrent(owner))this.toast(error instanceof Error?error.message:"The selected workspace could not be authorized.");
      }catch(cleanup){const combined=combineNativeImageRetirementFailures([error,cleanup]);if(combined)throw combined;throw cleanup;}
      return false;
    }
  }

  #commitRoute(path:string,owner:WorkspaceNavigationOwner):boolean{
    const options=owner.options,startup=owner.startup?.owner===owner?owner.startup:null;
    if(!this.#workspaceNavigationCurrent(owner))return false;
    path=this.#projectTaskRoute(path,options);
    const projection=this.projection.get();
    const requestedFocus=options.documentFocus??(documentFocusFromRoute(path)||documentFocusFromRoute(owner.route));
    const focusAwarePath=isDocumentViewRoute(path)?withDocumentFocusInRoute(path,requestedFocus):path;
    const requestedDocumentId=documentIdFromRoute(focusAwarePath);
    const routeDocumentId=requestedDocumentId||(options.documentId??projection.documentId);
    const routeDocumentTitle=projection.documents.find(document=>document.id===routeDocumentId)?.title??(routeDocumentId===projection.documentId?projection.documentTitle:"");
    const routedPath=isDocumentViewRoute(focusAwarePath)&&routeDocumentId?withDocumentInRoute(focusAwarePath,routeDocumentId,routeDocumentTitle):focusAwarePath;
    const before=owner.browserRoute,target=new URL(routedPath,location.origin+before);
    const expectedBrowserRoute=target.pathname+target.search+target.hash;
    if(!this.#handoffWorkspaceNavigation(owner)||!this.#advanceWorkspaceNavigation(owner))return false;
    // Final route admission has completed even without an explicit handoff
    // hook. Its own fence/route write must not re-test the departed predicate.
    owner.handedOff=true;
    const changed=owner.route!==routedPath||before!==expectedBrowserRoute;
    const committed=this.#nativeImageMutation(()=>{
      if(!this.#workspaceNavigationCurrent(owner))return false;
      if(before!==expectedBrowserRoute){
        if(options.replace)history.replaceState({},"",routedPath);else history.pushState({},"",routedPath);
        owner.browserRoute=expectedBrowserRoute;
        if(!this.#workspaceNavigationCurrent(owner))return false;
        if(!this.loading.get()){
          beginRoutePopulation(routedPath);
          if(!this.#workspaceNavigationCurrent(owner))return false;
          recordRouteHistoryProfile(this.#historyProfile);
          if(!this.#workspaceNavigationCurrent(owner))return false;
          const contentScope=routeCapabilities(routedPath).profile==="memory"?"memory":documentViewFromRoute(routedPath)==="chat"?"chat":"all";
          recordPrivateContentState(routeCapabilities(routedPath).privateContent?(this.#privateContentScope==="all"||this.#privateContentScope===contentScope?"ready":"pending"):"not-required",routeCapabilities(routedPath).privateContent?contentScope:undefined);
          if(!this.#workspaceNavigationCurrent(owner))return false;
          recordPopulationSource("memory",this.events.get().length);
          if(!this.#workspaceNavigationCurrent(owner))return false;
        }
      }
      if(!this.#workspaceNavigationCurrent(owner))return false;
      this.#workspaceNavigationFocus=options.focus?{route:routedPath,focus:options.focus,revision:owner.revision}:null;
      // Retire the feed before route publication, including reentrant native-reader returns.
      if(isRetainedOutputReaderRoute(routedPath)){
        this.#jobFeedRevision+=1;window.clearTimeout(this.#jobPollTimer);this.#pendingPassiveJobPath="";
      }
      if(!startup){this.route.set(routedPath);owner.route=routedPath;return this.#workspaceNavigationCurrent(owner);}
      const recordCommit=()=>{
        owner.route=routedPath;
        // Save historical evidence before delivery. Delivery failure never
        // retries this receipt or retargets its already-captured intent.
        const receipt=Object.freeze({intent:startup.startup.id,path:routedPath});
        startup.commit=receipt;
        startup.startup.commit(receipt);
      };
      const routeSignal=this.route,routeGet=routeSignal.get,routeSet=routeSignal.set;
      const genuine=routeSignal===this.#nativeImageRouteSignal.signal
        &&routeGet===this.#nativeImageRouteSignal.get&&routeSet===this.#nativeImageRouteSignal.set;
      // The qualified State setter may write, then synchronously notify a
      // Watcher that throws. Watcher notification forbids intervening Signal
      // reads/writes. This is not evidence for replaced setters or node hooks.
      const beforeWrite=genuine?routeGet.call(routeSignal):undefined;
      try{routeSet.call(routeSignal,routedPath);}
      catch(error){
        const failures:unknown[]=[error];
        if(genuine){
          try{
            const afterWrite=routeGet.call(routeSignal);
            if(beforeWrite!==routedPath&&afterWrite===routedPath
              &&this.route===routeSignal&&routeSignal.get===routeGet&&routeSignal.set===routeSet)recordCommit();
          }catch(readOrDeliveryFailure){failures.push(readOrDeliveryFailure);}
        }
        // Keep the setter's original Error or undefined before read/delivery
        // failures and the mutation's mandatory cleanup. No success tail runs.
        this.#throwWorkspaceNavigationFailures(failures);throw error;
      }
      recordCommit();
      return this.#workspaceNavigationCurrent(owner);
    },{fence:changed,holdAdmissions:changed});
    if(!committed||!this.#workspaceNavigationCurrent(owner))return false;
    if(!isRetainedOutputReaderRoute(routedPath)&&!this.loading.get()&&!routeCapabilities(routedPath).jobHistory&&!this.documentJobs.get().some(job=>job.status==="queued"||job.status==="running"||job.status==="committing")){
      window.clearTimeout(this.#jobPollTimer);
      if(!this.#workspaceNavigationCurrent(owner))return false;
      this.#pendingPassiveJobPath=routedPath;
    }
    this.notify();
    if(!this.#workspaceNavigationCurrent(owner))return false;
    window.dispatchEvent(new CustomEvent("forma-route-changed",{detail:{path:routedPath,...(options.preserveFocus===true?{preserveFocus:true}:{}),
      ...(startup?.commit?{nativeImageStartup:startup.startup,nativeImageCommit:startup.commit}:{})}}));
    if(!this.#workspaceNavigationCurrent(owner))return false;
    const required=this.#profileForRoute(routedPath);
    if(startup){
      const dispatcher=startup;
      if(eventProfileRank(this.#historyProfile)<eventProfileRank(required))
        this.#startNativeImageWorkspaceSlot(dispatcher,"history",()=>this.#upgradeHistory(required,owner));
      else this.#unnecessaryNativeImageWorkspaceSlot(dispatcher,"history","history-ready");
      if(!this.#workspaceNavigationCurrent(owner))return false;
      if(routeCapabilities(routedPath).privateContent&&!this.loading.get())
        this.#deferNativeImageWorkspaceSlot(dispatcher,"private-hydration",()=>this.#hydrateVisiblePrivateContent(owner));
      else this.#unnecessaryNativeImageWorkspaceSlot(dispatcher,"private-hydration",
        this.loading.get()?"route-loading":"private-content-not-required");
      if(!this.#workspaceNavigationCurrent(owner))return false;
      const immediateRead=!this.loading.get()&&(routeCapabilities(routedPath).jobHistory
        ||this.documentJobs.get().some(job=>job.status==="queued"||job.status==="running"||job.status==="committing"));
      if(immediateRead)this.#deferNativeImageWorkspaceSlot(dispatcher,"initial-visible-job-read",()=>{
        const operation=this.beginNativeImageInitialListRead();
        // The concrete host first stores and observes both originals, without
        // recipients; the ticket then receives this exact settled Promise.
        dispatcher.startup.initial(operation);
        return operation.settled;
      });
      else this.#unnecessaryNativeImageWorkspaceSlot(dispatcher,"initial-visible-job-read",
        this.loading.get()?"route-loading":"passive-job-read");
      if(!this.#workspaceNavigationCurrent(owner))return false;
      if(!immediateRead&&!this.loading.get()&&document.documentElement.dataset.formaPhase==="populated"){
        // Preserve passive background polling without adding it to the finite
        // startup read or implying that recurring polling has settled.
        this.#pendingPassiveJobPath="";
        this.#scheduleJobPoll(1_200);
        if(!this.#workspaceNavigationCurrent(owner))return false;
      }
      this.#scheduleProjectTaskExpiry();
      return this.#workspaceNavigationCurrent(owner);
    }
    if(eventProfileRank(this.#historyProfile)<eventProfileRank(required))void this.#upgradeHistory(required,owner).catch(error=>{
      if(this.#workspaceNavigationStable(owner))console.warn("[forma-performance]",JSON.stringify({phase:"history-upgrade",message:error instanceof Error?error.message:"history_upgrade_failed"}));
    });
    if(!this.#workspaceNavigationCurrent(owner))return false;
    if(routeCapabilities(routedPath).privateContent&&!this.loading.get())requestAnimationFrame(()=>{
      if(this.#workspaceNavigationStable(owner))void this.#hydrateVisiblePrivateContent(owner).catch(()=>undefined);
    });
    if(!this.#workspaceNavigationCurrent(owner))return false;
    if(!this.loading.get()&&(this.#jobScope(before)!==this.#jobScope(routedPath)||!routeCapabilities(routedPath).jobHistory))requestAnimationFrame(()=>{
      if(this.#workspaceNavigationStable(owner))this.#syncVisibleJobs(routedPath);
    });
    if(!this.#workspaceNavigationCurrent(owner))return false;
    this.#scheduleProjectTaskExpiry();
    return this.#workspaceNavigationCurrent(owner);
  }

  async syncDocumentFromRoute(path = this.route.get()) {
    if (path !== this.route.get() || this.loading.get() || !this.routeDataReady(path) || !this.events.get().length) return;
    const pending=this.#cachedHistoryRevalidation;
    if(pending){
      const authorization=this.captureAuthorizationScope(),revision=this.#workspaceTransition,loadRevision=this.#loadRevision;
      try{await pending;}catch(error){if(NativeImageRetirementError.is(error))throw error;return;}
      if(path!==this.route.get()||this.loading.get()||this.#workspaceTransition!==revision||this.#loadRevision!==loadRevision
        ||!this.authorizationScopeActive(authorization)||!this.routeDataReady(path))return;
    }
    const taskDocumentId = projectTaskDocumentIdFromRoute(path);
    if (isProjectTaskRoute(path)) {
      this.#scheduleProjectTaskExpiry();
      const session = this.session.get(), context = session?.projectContext;
      if (!session || context && (!context.permissions.includes("project.read") || !(Date.parse(context.expiresAt) > Date.now()))) return;
      if (taskDocumentId !== null && (this.projection.get().documentId !== taskDocumentId || !taskDocumentId)) {
        this.setRoute(applicationIdFromRoute(path) === "canvas" ? "/canvas/projects" : "/projects", { replace: true });
        this.toast("That document is no longer available.");
      }
      return;
    }
    if (!isDocumentViewRoute(path)) return;
    const projection = this.projection.get(), revision = this.#workspaceTransition, authorization = this.captureAuthorizationScope();
    const current = () => this.authorizationScopeActive(authorization) && this.#workspaceTransition === revision && this.route.get() === path;
    const requestedDocumentId = documentIdFromRoute(path);
    if (!requestedDocumentId) {
      if (projection.documentId) this.setRoute(withDocumentInRoute(path, projection.documentId, projection.documentTitle), { replace: true });
      return;
    }
    const requestedDocument = projection.documents.find((document) => document.id === requestedDocumentId);
    // Absence is not permission to replace an explicit identity. The shell offers
    // Retry at the original address; it does not create or open a substitute.
    if (!requestedDocument) return;
    if (requestedDocumentId !== projection.documentId) {
      const opened = await this.openDocument(requestedDocumentId, path, "shared-document-url", { current });
      if (!opened || !current()) return;
    } else {
      const canonicalRoute = withDocumentInRoute(path, projection.documentId, projection.documentTitle);
      if (canonicalRoute !== path) this.setRoute(canonicalRoute, { replace: true });
    }
  }
  setAttentionCapture(enabled:boolean){if(this.session.get()?.impersonation){this.patchUi({attentionCapture:false,attentionPaused:true});this.toast("Attention capture stays off while you experience a fictional account.");return;}writeAttentionPreference(enabled,this.session.get()?.user.userId??"anonymous");this.patchUi({attentionCapture:enabled,attentionPaused:false});this.toast(enabled?"Attention signals enabled for this account on this device.":"Attention signals disabled; the current episode was closed.");}
  setAttentionPaused(paused:boolean){this.patchUi({attentionPaused:paused});this.toast(paused?"Attention capture paused on this device.":"Attention capture resumed.");}
  async forgetAttentionSignals(){window.dispatchEvent(new Event("forma-attention-forget"));const session=this.session.get();let appended:CreativeEvent[]=[];if(session?.projectContext){const authorization=this.#authorizationScope(session),response=await fetch("/api/privacy/attention",{method:"POST"}),body=await response.json() as {appended?:CreativeEvent[];error?:string};this.#assertAuthorizationScope(authorization);if(!response.ok){this.toast(body.error??"Your personal attention data could not be forgotten.");return[];}appended=body.appended??[];}else appended=await this.append({type:"AttentionSignalsForgotten",payload:{scope:"all-attention-episodes",before_sequence:this.head.get(),reason:"user-requested",device_ledger_cleared:true}});if(appended.length){const active=this.session.get();if(active)await clearAnalyticsSnapshots(this.#snapshotIdentity(active),true);this.toast("Your personal attention episodes were forgotten and excluded from Scout and Memory.");}return appended;}
  async erasePersonalAuthoredContext(){
    const session=this.session.get();if(!session||session.projectContext||session.impersonation)return false;
    const authorization=this.#authorizationScope(session);
    try{
      const response=await this.guardedFetch("/api/privacy/events",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"erase-personal-authored-context",confirmation:"ERASE_MY_PERSONAL_AUTHORED_CONTEXT"})},"erase personal authored context");
      this.#assertAuthorizationScope(authorization);
      const result=await response.json() as {error?:string;message?:string;erasedAuthoredEventBodies?:number;outputReservationReconciliationPending?:boolean;outputProviderReconciliationPending?:number;outputStorageCleanupPending?:number;outputReconciliationCheckFailed?:boolean};
      this.#assertAuthorizationScope(authorization);
      if(!response.ok)throw new Error(result.message??result.error??"Personal authored context could not be erased.");
      // Erasure is already acknowledged. Retire before asynchronous local
      // cleanup; the old authored view cannot admit another Image meanwhile.
      return await this.#nativeImageHeldMutation(async()=>{
        await Promise.all([clearAccountSnapshots(this.#snapshotIdentity(session)),clearAnalyticsSnapshots(this.#snapshotIdentity(session)),canvasOfflineQueue.clearPersonalOwner(session.user.userId).catch(()=>0)]);
        this.#assertAuthorizationScope(authorization);
        this.events.set([]);this.optimisticEvents.set([]);this.content.set({});this.head.set(0);
        await this.#refreshEvents();this.#assertAuthorizationScope(authorization);
        const outputPending=Boolean(result.outputReservationReconciliationPending||result.outputProviderReconciliationPending||result.outputStorageCleanupPending||result.outputReconciliationCheckFailed);
        this.toast(this.#systemNotice("{count} personal authored event bodies erased. Finished outputs, shared organization work, uploads, backups, and other devices are not removed.",{count:result.erasedAuthoredEventBodies??0})+(outputPending?" "+this.#systemNotice("Some Output file cleanup or provider accounting is still pending. No new generation was authorized."):""));
        this.notify();return true;
      });
    }catch(error){
      if(NativeImageRetirementError.is(error))throw error;
      if(this.#scopeStillActive(authorization))this.toast(error instanceof Error?error.message:"Personal authored context could not be erased.");
      return false;
    }
  }
  async migrateHistoricalEventPrivacy(){const session=this.session.get();if(!session||session.user.role!=="admin"||session.projectContext||session.impersonation)return false;const authorization=this.#authorizationScope(session);try{const response=await this.guardedFetch("/api/privacy/events",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"migrate-historical-events",confirmation:"MIGRATE_HISTORICAL_EVENT_CONTENT"})},"migrate historical event privacy");this.#assertAuthorizationScope(authorization);const result=await response.json() as {error?:string;message?:string;migratedEvents?:number};this.#assertAuthorizationScope(authorization);if(!response.ok)throw new Error(result.message??result.error??"Historical event migration failed.");await Promise.all([clearAccountSnapshots(this.#snapshotIdentity(session)),clearAnalyticsSnapshots(this.#snapshotIdentity(session))]);this.#assertAuthorizationScope(authorization);this.toast(this.#systemNotice("{count} historical event bodies moved into erasable owner-scoped storage. Existing backups and other devices still require separate handling.",{count:result.migratedEvents??0}));return true;}catch(error){if(this.#scopeStillActive(authorization))this.toast(error instanceof Error?error.message:"Historical event migration failed.");return false;}}

  async load(options:{routeHandoff?:Promise<void>}={}) {
    const loadRevision=++this.#loadRevision;let loadAuthorization="",loadRead:EventSourceRead|undefined;
    let loadPrimary:{error:unknown}|null=null;
    this.#cachedHistoryRevalidation=undefined;
    const ownsLoad=()=>loadRevision===this.#loadRevision&&(!loadAuthorization||this.#scopeStillActive(loadAuthorization))&&(!loadRead||this.#sourceReadOwned(loadRead));
    const path=this.route.get(),profile=this.#profileForRoute(path),started=performance.now();
    beginRoutePopulation(path);recordRouteHistoryProfile(profile);
    recordPrivateContentState(routeCapabilities(path).privateContent?"pending":"not-required");
    this.loading.set(true);
    try{
      this.notify();
      const bootstrap=consumeSessionBootstrap(),prefetched=consumeSessionPrefetch();
      const sessionPromise=bootstrap&&!this.#projectContextLatest?Promise.resolve(this.#applySession(bootstrap)):this.refreshSession(prefetched);
      const snapshotsPromise=sessionPromise.then(verified=>{
        if(loadRevision!==this.#loadRevision||this.#authorizationScope(verified)!==this.#activeAuthorizationScope())throw new Error("A newer workspace load already owns this source.");
        loadRead=this.#beginSourceRead(profile);
        return readAccountSnapshots(loadRead.identity,this.#sourceCacheGuard(loadRead));
      });
      if(documentViewFromRoute(path)==="chat")void sessionPromise.then(verified=>{
        if(this.session.get()?.user.userId!==verified.user.userId||this.route.get()!==path||this.#sourceRetired)return;
        return this.#hydrateVisiblePrivateContent();
      }).catch(()=>undefined);
      const live=snapshotsPromise.then(snapshots=>{
        const read=loadRead;if(!read||!ownsLoad())throw new Error("The source load was superseded.");
        const snapshot=matchingAccountSnapshot(snapshots,read.identity,read.profile,this.#sourceCacheGuard(read));
        return this.#readEventStream(snapshot?.head??0,read.profile,false,read);
      });
      // Attach a handler immediately; foreground cache publication must never hide an owned denial.
      void live.catch(()=>undefined);
      const [session,snapshots]=await Promise.all([sessionPromise,snapshotsPromise]);
      loadAuthorization=this.#authorizationScope(session);
      if(!loadRead||!ownsLoad())throw new Error("The active workspace changed before its history finished loading.");
      const read=loadRead;this.#assertSourceRead(read);
      recordSessionReady(started,bootstrap?"document":prefetched?"prefetch":"request");
      const cached=matchingAccountSnapshot(snapshots,read.identity,read.profile,this.#sourceCacheGuard(read));
      if(cached){
        this.#assertSourceRead(read);
        if(this.#sourceRetired||read.id<this.#sourcePublishedRead)throw new Error("A newer source read owns the current workspace.");
        // A cache is a provisional view, never a certificate that supersedes another read.
        this.#nativeImageMutation(()=>{
        this.events.set(cached.events);this.head.set(cached.head);this.#historyProfile=cached.profile;
        recordPopulationSource("indexeddb",cached.events.length);
        const revalidation=live.then(async current=>{
          if(!ownsLoad())throw new Error("The source load was superseded.");
          if(current.head<cached.head)current=await this.#readEventStream(0,read.profile,false,read);
          if(!ownsLoad())throw new Error("The source load was superseded.");
          const replace=current.read.from===0,changed=replace||current.head!==cached.head||current.events.length>0||Object.keys(current.content).length>0;
          this.#publishSourceRead(current,()=>{
            if(replace){this.events.set(current.events);this.#mergeSourceContent(current.read,current.content,true);}
            else if(changed){const merged=new Map([...this.events.get(),...current.events].map(event=>[event.eventId,event]));
              this.events.set([...merged.values()].sort((a,b)=>a.sequence-b.sequence||a.eventId.localeCompare(b.eventId)));
              if(Object.keys(current.content).length)this.#mergeSourceContent(current.read,current.content);}
            this.head.set(current.head);this.#historyProfile=read.profile;
          });
          if(changed){this.#publishAppended(current.events,current.read);this.notify();}
          void writeAccountSnapshot(read.identity,this.events.get(),this.head.get(),this.#historyProfile,this.#sourceCacheGuard(read,true));
        });
        this.#cachedHistoryRevalidation=revalidation;
        void revalidation.catch(error=>console.warn("[forma-performance]",JSON.stringify({phase:"cache-revalidation",message:error instanceof Error?error.message:"cache_revalidation_failed"}))).finally(()=>{
          if(this.#cachedHistoryRevalidation===revalidation){this.#cachedHistoryRevalidation=undefined;this.notify();}
        });
        },{fence:true,holdAdmissions:true});
      }else{
        const body=await live;if(!ownsLoad())throw new Error("The source load was superseded.");
        this.#publishSourceRead(body,()=>{
          this.events.set(body.events);this.#mergeSourceContent(body.read,body.content,true);this.head.set(body.head);this.#historyProfile=body.read.profile;
        });
        recordPopulationSource("miss",body.events.length);
        void writeAccountSnapshot(read.identity,body.events,body.head,body.read.profile,this.#sourceCacheGuard(read,true));
      }
      if(!ownsLoad())throw new Error("The source load was superseded.");
      while(!this.routeDataReady()){
        await this.#upgradeHistory(this.#profileForRoute(this.route.get()));
        if(!ownsLoad())throw new Error("The active workspace changed before its history finished loading.");
      }
      this.#assertSourceRead(read);this.error.set("");this.loading.set(false);this.notify();
      requestAnimationFrame(async()=>{
        if(options.routeHandoff)await options.routeHandoff;
        if(!ownsLoad()||!this.sourceOwnershipActive(read.source))return;
        void this.syncDocumentFromRoute(this.route.get());this.#syncVisibleJobs(this.route.get());
        if(routeCapabilities(this.route.get()).privateContent)void this.#hydrateVisiblePrivateContent().catch(()=>undefined);
      });
    }catch(error){
      loadPrimary={error};
      if(ownsLoad())this.error.set(error instanceof Error?error.message:"Unable to load event stream");
      if(NativeImageRetirementError.is(error))throw error;
    }
    finally{
      try{if(ownsLoad()){this.loading.set(false);this.notify();}}
      catch(cleanup){
        const combined=loadPrimary?combineNativeImageRetirementFailures([loadPrimary.error,cleanup]):null;
        // eslint-disable-next-line no-unsafe-finally -- Cleanup rejection preserves combined Image failures and existing legacy cleanup precedence.
        if(combined)throw combined;throw cleanup;
      }
    }
  }

  #applySession(body:PilotSession,revision?:number){
    if(revision===undefined)this.#sessionRevision+=1;
    const previous=this.session.get(),previousUserId=previous?.user.userId;
    const imageAuthorizationChanges=!previous||this.#authorizationScope(previous)!==this.#authorizationScope(body);
    const applicationRevision=this.#sessionRevision,applicationSource=this.#sourceGeneration+(imageAuthorizationChanges?1:0);
    const ownsApplication=(session:PilotSession|null)=>this.#sessionRevision===applicationRevision&&this.#sourceGeneration===applicationSource&&this.session.get()===session;
    const superseded=()=>this.session.get()??body;
    return this.#nativeImageMutation(()=>{
    if(!previous||this.#authorizationScope(previous)!==this.#authorizationScope(body)){
      this.#sourceGeneration+=1;this.#sourceRetired=false;this.#retiredSourceProjectId=null;this.#sourceCertifiedCoverage.clear();this.#sourceContentReadIds.clear();
    }
    if(previous&&this.#authorizationScope(previous)!==this.#authorizationScope(body)){
      this.#cachedHistoryRevalidation=undefined;
      this.documentCopyReviews.set({});this.#documentCopyRequest+=1;
      this.events.set([]);this.head.set(0);this.content.set({});this.shares.set([]);this.projectNotifications.set([]);this.organizationContextPackages.set([]);this.organizationContextBindings.set([]);this.organizationContextVersions.set({});this.#resetReviewInbox();this.optimisticEvents.set([]);
      this.documentJobs.set([]);this.generationReadiness.set({});this.outputRequirements.clear();if(!ownsApplication(previous))return superseded();this.#jobDetails.clear();this.#planningRecoveryIdentities.clear();this.#privateContentScope="none";
      this.#adaptiveStructureJobIds.clear();this.adaptiveStructures.set({});this.adaptiveSuggestionSets.set({});this.replayEvents.set([]);this.replayAsOf.set(0);this.asOf.set(Number.POSITIVE_INFINITY);
      this.#pendingAdaptiveIntents.clear();this.#pendingJobNotices=[];this.#readinessAcknowledgements.clear();this.#dismissedAdaptiveSuggestions.clear();this.#readinessInFlight.clear();this.#jobStarts.clear();this.#jobsDriving.clear();this.#presentationRecoveryAttempts.clear();this.#focalInFlight.clear();
      this.#pendingJobEventRefresh=false;this.#pendingJobSessionRefresh=false;this.#pendingPassiveJobPath="";this.#historyProfile="full";this.#historyUpgrade=undefined;this.#contentHydration=undefined;
      this.ui.shareOpen=false;this.ui.accountOpen=false;this.ui.compareOpen=false;
      this.#undo=[];this.#redo=[];this.#rememberedClientEventIds.clear();window.clearTimeout(this.#jobPollTimer);window.clearTimeout(this.#collaborationPollTimer);window.clearTimeout(this.#focalBackfillTimer);
      window.dispatchEvent(new CustomEvent("forma-authorization-changed",{detail:{previous:this.#authorizationScope(previous),current:this.#authorizationScope(body)}}));
    }
    // A pre-publication listener may complete a newer adoption. Never overwrite
    // that session, including an away-and-back adoption with the same principal.
    if(!ownsApplication(previous))return superseded();
    this.session.set(body);this.#reconcileNativeImageScopes();this.#scheduleProjectTaskExpiry();
    if(!ownsApplication(body))return superseded();
    if(body.projectContext){void this.syncProjectNotifications();void this.syncOrganizationContextPackages();}else{this.projectNotifications.set([]);this.organizationContextPackages.set([]);this.organizationContextBindings.set([]);this.organizationContextVersions.set({});}
    if(!ownsApplication(body))return superseded();
    void this.syncReviewInbox();
    if(!ownsApplication(body))return superseded();
    this.#scheduleCollaborationPoll();
    if(!ownsApplication(body))return superseded();
    if(body.impersonation){this.ui.attentionCapture=false;this.ui.attentionPaused=true;}
    else if(previousUserId!==body.user.userId){this.ui.attentionCapture=readAttentionPreference(body.user.userId);this.ui.attentionPaused=false;}
    this.notify();return body;
    },{fence:imageAuthorizationChanges,holdAdmissions:imageAuthorizationChanges});
  }

  async refreshSession(prefetched:Promise<Response>|null=null) {
    const revision=++this.#sessionRevision,cookieGeneration=this.#projectContextCookieGeneration,owner=this.#projectContextLatest;
    const current=()=>revision===this.#sessionRevision&&cookieGeneration===this.#projectContextCookieGeneration&&owner===this.#projectContextLatest;
    const usePrefetch=cookieGeneration===0?prefetched:null;
    if(prefetched&&!usePrefetch)void prefetched.catch(()=>undefined);
    const response=await(usePrefetch?usePrefetch.catch(()=>fetch("/api/session")):fetch("/api/session",{cache:"no-store",credentials:"same-origin"}));
    if(!current()){const active=this.session.get();if(active)return active;throw new Error("A newer workspace session is already loading.");}
    const body=await response.json() as PilotSession & {error?:string};
    if(!current()){const active=this.session.get();if(active)return active;throw new Error("A newer workspace session is already loading.");}
    if(!response.ok)throw new Error(body.error??"Authentication required");
    // An intermediate cookie cannot cancel a later queued same-principal choice.
    // A genuine different principal still retires the original request normally.
    if(owner&&owner.matches(body)&&cookieGeneration!==this.#projectContextSessionGeneration
      &&(!owner.settled||owner.current()&&!owner.admitted)){
      const active=this.session.get();if(active)return active;throw new Error("A newer project context is already loading.");
    }
    let applied!:PilotSession,retirementFailure:NativeImageRetirementError|null=null;
    try{applied=this.#applySession(body,revision);}
    catch(error){if(!NativeImageRetirementError.is(error))throw error;retirementFailure=error;}
    if(current()&&this.session.get()===body)this.#projectContextSessionGeneration=cookieGeneration;
    if(retirementFailure)throw retirementFailure;
    return applied;
  }

  async #reconcileProjectContextCookie(){
    while(this.#projectContextCookieGeneration!==this.#projectContextSessionGeneration){
      const owner=this.#projectContextLatest;if(!owner)throw new Error("The project context session is unavailable.");
      await owner.ready;
      if(owner!==this.#projectContextLatest)continue;
      if(!owner.matches(this.session.get()))throw new Error("The original project context belongs to a different account.");
      if(this.#projectContextCookieGeneration===this.#projectContextSessionGeneration)return;
      if(owner.current())throw new Error("The selected project context has not completed its current handoff.");
      if(!owner.reconciliation){
        const pending=(async()=>{
          const cookieGeneration=this.#projectContextCookieGeneration,revision=++this.#sessionRevision;
          const current=()=>owner===this.#projectContextLatest&&owner.settled&&owner.matches(this.session.get())
            &&cookieGeneration===this.#projectContextCookieGeneration&&revision===this.#sessionRevision;
          const response=await fetch("/api/session",{cache:"no-store",credentials:"same-origin"});if(!current())return;
          const body=await response.json() as PilotSession&{error?:string};if(!current())return;
          if(!response.ok)throw new Error(body.error??"Authentication required");
          if(!owner.matches(body))throw new Error("The original project context belongs to a different account.");
          // This read certifies only the actual current cookie/Source, never the
          // original context command, its abandoned route, or its focus lease.
          let retirementFailure:NativeImageRetirementError|null=null;
          try{this.#applySession(body,revision);}
          catch(error){if(!NativeImageRetirementError.is(error))throw error;retirementFailure=error;}
          if(current()&&this.session.get()===body)this.#projectContextSessionGeneration=cookieGeneration;
          if(retirementFailure)throw retirementFailure;
        })();
        const reconciliation:Promise<void>=pending.finally(()=>{if(owner.reconciliation===reconciliation)owner.reconciliation=null;});
        owner.reconciliation=reconciliation;
      }
      await owner.reconciliation;
      if(owner===this.#projectContextLatest&&this.#projectContextCookieGeneration!==this.#projectContextSessionGeneration)
        throw new Error("The project context session could not be reconciled.");
    }
  }

  async syncProjectNotifications(){
    const sourceOwner=this.captureSourceOwnership();if(!this.sourceOwnershipActive(sourceOwner)){return;}const session=this.session.get();if(!session?.projectContext){this.projectNotifications.set([]);return;}const authorization=this.#authorizationScope(session);try{const response=await fetch("/api/project-notifications");this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);const body=await response.json() as {notifications?:ProjectNotification[]};this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);if(response.ok){this.projectNotifications.set(body.notifications??[]);this.notify();}}catch{/* Event polling retries project follow-up without blocking the actual work. */}}
  async acknowledgeProjectNotification(id:string){const session=this.session.get();if(!session?.projectContext)return false;const authorization=this.#authorizationScope(session);try{const response=await this.guardedFetch("/api/project-notifications",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({notificationId:id})},"acknowledge this project update");this.#assertAuthorizationScope(authorization);const body=await response.json() as {readAt?:string};this.#assertAuthorizationScope(authorization);if(!response.ok)return false;this.projectNotifications.set(this.projectNotifications.get().map((item)=>item.id===id?{...item,readAt:body.readAt??new Date().toISOString()}:item));this.notify();return true;}catch{return false;}}
  #resetReviewInbox(){
    this.#reviewInboxDeniedThrough=++this.#reviewInboxReadSequence;
    this.#reviewInboxCompletedRead=this.#reviewInboxReadSequence;
    this.reviewInbox.set([]);this.reviewInboxState.set("idle");
  }
  async syncReviewInbox():Promise<boolean>{
    const sourceOwner=this.captureSourceOwnership(),session=this.session.get();
    if(!session||!this.sourceOwnershipActive(sourceOwner)){
      this.#resetReviewInbox();this.notify();return false;
    }
    const authorization=this.#authorizationScope(session),read=++this.#reviewInboxReadSequence;
    const scopeCurrent=()=>this.#scopeStillActive(authorization)&&this.sourceOwnershipActive(sourceOwner);
    const current=()=>scopeCurrent()&&read>this.#reviewInboxDeniedThrough&&read>=this.#reviewInboxCompletedRead;
    this.reviewInboxState.set("loading");this.notify();
    try{
      const response=await fetch("/api/workspaces/reviews",{credentials:"same-origin"});
      if(!current())return false;
      if(response.status===401||response.status===403){
        // A current denial withdraws this inbox, including reads already in flight.
        // Only a later explicit positive read can establish the list again.
        this.#reviewInboxDeniedThrough=this.#reviewInboxReadSequence;
        this.#reviewInboxCompletedRead=Math.max(this.#reviewInboxCompletedRead,read);
        this.reviewInbox.set([]);this.reviewInboxState.set("unavailable");this.notify();return false;
      }
      if(!current())return false;
      if(!response.ok)throw new Error("review_inbox_unavailable");
      const body=await response.json() as {tasks?:AssignedReviewTask[];error?:unknown}|null;
      if(!current())return false;
      if(!body||typeof body!=="object"||Array.isArray(body)||Object.hasOwn(body,"error")||!Array.isArray(body.tasks)
        ||!body.tasks.every(task=>task&&typeof task==="object"&&!Array.isArray(task)&&typeof task.status==="string"))
        throw new Error("review_inbox_unavailable");
      this.#reviewInboxCompletedRead=read;
      this.reviewInbox.set(body.tasks);this.reviewInboxState.set("ready");this.notify();return true;
    }catch{
      if(current()){
        this.#reviewInboxCompletedRead=read;
        this.reviewInbox.set([]);this.reviewInboxState.set("error");this.notify();
      }
      return false;
    }
  }

  async syncOrganizationContextPackages(){
    const sourceOwner=this.captureSourceOwnership();if(!this.sourceOwnershipActive(sourceOwner)){return;}
    const session=this.session.get(),context=session?.projectContext;
    if(!session||!context){this.organizationContextPackages.set([]);this.organizationContextBindings.set([]);this.organizationContextVersions.set({});return;}
    const authorization=this.#authorizationScope(session);
    const read=++this.#organizationCatalogReadSequence,cookieGeneration=this.#projectContextCookieGeneration;
    const assertCurrent=()=>{
      this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);
      if(cookieGeneration!==this.#projectContextCookieGeneration||read<=this.#organizationCatalogDeniedThrough||read<this.#organizationCatalogCompletedRead)
        throw new Error("The organization catalog read was superseded.");
    };
    try{
      const response=await fetch(`/api/workspaces/${encodeURIComponent(context.organizationId)}/context-packages`,{credentials:"same-origin"});
      assertCurrent();
      if(response.status===403){
        // This exact catalog denial withdraws its cache, not the unrelated
        // Document Source. Pending newer reads are not positive certificates.
        this.#organizationCatalogDeniedThrough=this.#organizationCatalogReadSequence;
        this.organizationContextPackages.set([]);this.organizationContextBindings.set([]);this.organizationContextVersions.set({});
        this.notify();return;
      }
      const body=await response.json() as {packages?:OrganizationContextPackage[];error?:unknown}|null;assertCurrent();
      // Certify this root endpoint only from an explicit completed collection;
      // keep the existing row and child interpretation, not a second decoder.
      if(!response.ok||!body||typeof body!=="object"||Array.isArray(body)||Object.hasOwn(body,"error")||!Array.isArray(body.packages))return;
      const packages=body.packages;
      const versions:Record<string,OrganizationContextVersion>={};
      const results=await Promise.all(packages.map(async(item)=>{
        const scoped=await fetch(`/api/workspaces/${encodeURIComponent(context.organizationId)}/context-packages/${encodeURIComponent(item.id)}/bindings`,{credentials:"same-origin"});
        assertCurrent();
        const rows=await scoped.json() as {bindings?:Array<Record<string,unknown>>};
        assertCurrent();
        const bindings=scoped.ok?(rows.bindings??[]):[];
        const requested=new Set([item.versionId,...bindings.flatMap((binding)=>[binding.version_id,binding.pending_version_id])].filter((id):id is string=>typeof id==="string"&&Boolean(id)));
        await Promise.all([...requested].map(async(versionId)=>{
          const published=await fetch(`/api/workspaces/${encodeURIComponent(context.organizationId)}/context-packages/${encodeURIComponent(item.id)}/versions/${encodeURIComponent(versionId)}`,{credentials:"same-origin"});
          assertCurrent();
          const detail=await published.json().catch(()=>null) as {versionId?:string;version?:number;snapshot?:Omit<OrganizationContextVersion,"id"|"version">}|null;
          assertCurrent();
          if(published.ok&&detail?.versionId&&detail.snapshot)versions[detail.versionId]={...detail.snapshot,id:detail.versionId,version:Number(detail.version??0)};
        }));
        return bindings;
      }));
      assertCurrent();
      this.organizationContextPackages.set(packages);
      this.organizationContextBindings.set(results.flat().map((row)=>({id:String(row.binding_id),organizationId:String(row.organization_id),projectAccessId:String(row.project_access_id),documentId:String(row.document_id),packageId:String(row.package_id),versionId:String(row.version_id),pendingVersionId:row.pending_version_id?String(row.pending_version_id):null,updateMode:row.update_mode==="follow-approved"?"follow-approved":"pinned",status:String(row.status)})));
      this.organizationContextVersions.set(versions);
      this.#organizationCatalogCompletedRead=read;
      this.notify();
    }catch{/* Exact organization context remains unavailable until the authorized catalog refreshes. */}
  }
  async #publishOrganizationContext(name:string,description:string,packageId:string,blockIds?:string[],sourceRightsConfirmed=false,sourceNonSensitiveConfirmed=false){
    const session=this.session.get(),context=session?.projectContext,projection=this.projection.get();
    if(!session||!context||!projection.documentId||!packageId&&!name.trim())return false;
    if(!Array.isArray(blockIds)){this.toast("Explicitly choose every context decision and original source before publishing.");return false;}
    const selection=blockIds;
    if(!selection.length||selection.length>128){this.toast(this.#systemNotice("Select between 1 and {value} context decisions for this organization package.",{value:128}));return false;}
    const authorization=this.#authorizationScope(session);
    try{
      const base=`/api/workspaces/${encodeURIComponent(context.organizationId)}/context-packages`;
      const destination=packageId?`${base}/${encodeURIComponent(packageId)}/versions`:base;
      const response=await this.guardedFetch(destination,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...(packageId?{}:{name,description}),sourceProjectAccessId:context.projectAccessId,documentId:projection.documentId,blockIds:selection,expectedSourceHead:this.head.get(),sourceRightsConfirmed,sourceNonSensitiveConfirmed})},"save these exact organization-owned context decisions and explicitly confirmed sources");
      this.#assertAuthorizationScope(authorization);
      const body=await response.json() as {packageId?:string;versionId?:string;version?:number;error?:string;message?:string};
      this.#assertAuthorizationScope(authorization);
      const savedPackageId=body.packageId??packageId;
      if(!response.ok||!savedPackageId||!body.versionId)throw new Error(body.message??body.error??"The organization context version could not be created.");
      const published=await this.guardedFetch(`${base}/${encodeURIComponent(savedPackageId)}/versions/${encodeURIComponent(body.versionId)}/publish`,{method:"POST"},"publish this exact immutable organization context version");
      this.#assertAuthorizationScope(authorization);
      const result=await published.json() as {error?:string;version?:number};
      if(!published.ok&&result.error==="independent_context_approver_required"){
        if(!this.#scopeStillActive(authorization))return true;
        await this.syncOrganizationContextPackages();
        if(!this.#scopeStillActive(authorization))return true;
        this.toast(this.#systemNotice("Awaiting approval"));
        return true;
      }
      if(!published.ok)throw new Error(result.error??"The organization context version could not be published.");
      if(!this.#scopeStillActive(authorization))return true;
      await this.syncOrganizationContextPackages();
      if(!this.#scopeStillActive(authorization))return true;
      this.toast(this.#systemNotice("Organization context version {version} was published. Following documents must explicitly accept the update.",{version:result.version??body.version??1}));
      return true;
    }catch(error){if(this.#scopeStillActive(authorization))this.toast(error instanceof Error?error.message:"Organization context could not be published.");return false;}
  }
  async createOrganizationContextPackage(name:string,description="",blockIds?:string[],sourceRightsConfirmed=false,sourceNonSensitiveConfirmed=false){return this.#publishOrganizationContext(name,description,"",blockIds,sourceRightsConfirmed,sourceNonSensitiveConfirmed);}
  async publishOrganizationContextPackageVersion(packageId:string,blockIds?:string[],sourceRightsConfirmed=false,sourceNonSensitiveConfirmed=false){return this.#publishOrganizationContext("","",packageId,blockIds,sourceRightsConfirmed,sourceNonSensitiveConfirmed);}
  async approveOrganizationContextPackage(packageId:string,versionId:string,organizationId=this.session.get()?.projectContext?.organizationId??""){
    const session=this.session.get();if(!session||!organizationId||!packageId||!versionId)return false;
    const authorization=this.#authorizationScope(session);
    try{
      const response=await this.guardedFetch(`/api/workspaces/${encodeURIComponent(organizationId)}/context-packages/${encodeURIComponent(packageId)}/versions/${encodeURIComponent(versionId)}/publish`,{method:"POST"},"independently approve and publish these exact organization-owned decisions");
      this.#assertAuthorizationScope(authorization);
      const body=await response.json() as {error?:string;message?:string;version?:number};
      if(!response.ok)throw new Error(body.message??body.error??"Organization context could not be published.");
      if(!this.#scopeStillActive(authorization))return true;
      if(session.projectContext?.organizationId===organizationId)await this.syncOrganizationContextPackages();
      if(!this.#scopeStillActive(authorization))return true;
      this.toast(this.#systemNotice("Organization context version {version} was published. Following documents must explicitly accept the update.",{version:body.version??1}));
      return true;
    }catch(error){if(this.#scopeStillActive(authorization))this.toast(error instanceof Error?error.message:"Organization context could not be published.");return false;}
  }
  async adoptOrganizationContextPackage(packageId:string,versionId:string,mode:"pinned"|"follow-approved"="pinned"){
    const session=this.session.get(),context=session?.projectContext,projection=this.projection.get();if(!session||!context||!projection.documentId)return false;
    const authorization=this.#authorizationScope(session),source=this.captureSourceOwnership();
    const current=()=>this.#projectContextCookieGeneration===this.#projectContextSessionGeneration&&this.#scopeStillActive(authorization)&&this.sourceOwnershipActive(source)
      &&this.projection.get().projectId===projection.projectId&&this.projection.get().documentId===projection.documentId;
    let acknowledged=false;
    try{
      const response=await this.guardedFetch(`/api/workspaces/${encodeURIComponent(context.organizationId)}/context-packages/${encodeURIComponent(packageId)}/adopt`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({projectAccessId:context.projectAccessId,documentId:projection.documentId,versionId,updateMode:mode,expectedProjectHead:this.head.get()})},"adopt this approved organization context into the current document");
      this.#assertAuthorizationScope(authorization);const body=await response.json() as {error?:string};
      if(!response.ok)throw new Error(body.error??"Organization context could not be added.");
      acknowledged=true;if(!current())return true;
      await this.#refreshEvents();if(!current())return true;
      await this.syncOrganizationContextPackages();if(!current())return true;
      this.toast(mode==="pinned"?"The approved context version is pinned to this document.":"Approved context was added. Future changes always require your acceptance.");return true;
    }catch(error){if(current())this.toast(error instanceof Error?error.message:"Organization context could not be added.");return acknowledged;}
  }
  async acceptOrganizationContextPackageUpdate(packageId:string,bindingId:string,versionId:string){
    const session=this.session.get(),context=session?.projectContext;
    if(!session||!context||!packageId||!bindingId||!versionId)return false;
    const authorization=this.#authorizationScope(session),source=this.captureSourceOwnership(),projection=this.projection.get();
    const binding=this.organizationContextBindings.get().find((item)=>item.id===bindingId&&item.packageId===packageId&&item.organizationId===context.organizationId&&item.projectAccessId===context.projectAccessId);
    const current=()=>Boolean(binding&&binding.documentId===projection.documentId)&&this.#projectContextCookieGeneration===this.#projectContextSessionGeneration
      &&this.#scopeStillActive(authorization)&&this.sourceOwnershipActive(source)&&this.projection.get().projectId===projection.projectId&&this.projection.get().documentId===projection.documentId;
    let acknowledged=false;
    try{
      const response=await this.guardedFetch(`/api/workspaces/${encodeURIComponent(context.organizationId)}/context-packages/${encodeURIComponent(packageId)}/bindings/${encodeURIComponent(bindingId)}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({action:"accept",versionId,expectedProjectHead:this.head.get()})},"accept this exact published organization context update");
      this.#assertAuthorizationScope(authorization);
      const result=await response.json() as {error?:string;version?:number};
      if(!response.ok)throw new Error(result.error??"This organization context update could not be accepted.");
      acknowledged=true;if(!current())return true;
      await this.#refreshEvents();if(!current())return true;
      await this.syncOrganizationContextPackages();if(!current())return true;
      this.toast(this.#systemNotice("Published organization context version {version} was applied. Review any affected finished outputs again.",{version:result.version??""}));
      return true;
    }catch(error){if(current())this.toast(error instanceof Error?error.message:"This organization context update could not be accepted.");return acknowledged;}
  }
  async setOrganizationContextPackageUpdateMode(packageId:string,bindingId:string,mode:"pinned"|"follow-approved"){
    const session=this.session.get(),context=session?.projectContext;if(!session||!context)return false;
    const authorization=this.#authorizationScope(session),source=this.captureSourceOwnership(),projection=this.projection.get();
    const binding=this.organizationContextBindings.get().find((item)=>item.id===bindingId&&item.packageId===packageId&&item.organizationId===context.organizationId&&item.projectAccessId===context.projectAccessId);
    const current=()=>Boolean(binding&&binding.documentId===projection.documentId)&&this.#projectContextCookieGeneration===this.#projectContextSessionGeneration
      &&this.#scopeStillActive(authorization)&&this.sourceOwnershipActive(source)&&this.projection.get().projectId===projection.projectId&&this.projection.get().documentId===projection.documentId;
    let acknowledged=false;
    try{
      const response=await this.guardedFetch(`/api/workspaces/${encodeURIComponent(context.organizationId)}/context-packages/${encodeURIComponent(packageId)}/bindings/${encodeURIComponent(bindingId)}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({action:"policy",updateMode:mode})},"change this document's context update policy");
      this.#assertAuthorizationScope(authorization);
      if(!response.ok)throw new Error("The context update policy could not be changed.");
      acknowledged=true;if(!current())return true;
      await this.syncOrganizationContextPackages();if(!current())return true;
      this.toast(mode==="pinned"?"This document is pinned to its current context version.":"Published context updates will be offered before anything changes.");return true;
    }catch(error){if(current())this.toast(error instanceof Error?error.message:"The context update policy could not be changed.");return acknowledged;}
  }
  /** One ephemeral owner for a context-cookie mutation, never an authorization grant. */
  beginProjectContextSelection(options:{requireUnexpiredContext?:boolean;current?:()=>boolean}={}){
    const navigation=++this.#workspaceTransition,sourceRoute=this.route.get(),session=this.session.get();
    const authorization=this.captureAuthorizationScope(),sourceGeneration=this.#sourceGeneration;
    const actorId=session?.user.userId,principalId=session?.impersonation?.actor.userId??actorId;
    const impersonationId=session?.impersonation?.impersonationId??null,audience=session?.audience??"creative";
    const matches=(now:PilotSession|null)=>Boolean(session&&now&&now.user.userId===actorId
      &&(now.impersonation?.actor.userId??now.user.userId)===principalId
      &&(now.impersonation?.impersonationId??null)===impersonationId&&(now.audience??"creative")===audience);
    const selectedCurrent=()=>matches(this.session.get())&&this.#workspaceTransition===navigation&&this.route.get()===sourceRoute;
    const current=()=>selectedCurrent()&&(!options.current||options.current());
    const sourceCurrent=()=>current()&&sourceGeneration===this.#sourceGeneration&&this.authorizationScopeActive(authorization)
      &&(!options.requireUnexpiredContext||this.#sourceExpiryValid(session?.projectContext?.expiresAt??null));
    let requested=false,finished=false;let requestedOwner:ProjectContextCookieRequest|null=null;
    let requestedProject:{organizationId:string;projectAccessId:string;projectId?:string}|null=null;
    const reconcile=async()=>{
      const latest=this.#projectContextLatest;
      if(latest?.settled&&!latest.current()&&latest.matches(this.session.get())&&!this.#sourceRetired)
        try{await this.#reconcileProjectContextCookie();}
        catch(error){if(NativeImageRetirementError.is(error))throw error;/* A later explicit session/source read may recover; never retry the context write. */}
    };
    return {current,sourceCurrent,refreshSession:async(onDestinationSource?:(source:CapturedSourceOwnership)=>boolean)=>{
      const owner=requestedOwner;if(!owner||owner!==this.#projectContextLatest||!owner.settled||!sourceCurrent())return null;
      const revision=this.#sessionRevision+1,cookieGeneration=this.#projectContextCookieGeneration;
      owner.admitted=true;const adopted=await this.refreshSession();
      // A superseded refresh may return the active session. Only this exact
      // applied read certifies the selected destination, never that fallback.
      if(owner!==this.#projectContextLatest||revision!==this.#sessionRevision||cookieGeneration!==this.#projectContextCookieGeneration
        ||cookieGeneration!==this.#projectContextSessionGeneration||adopted!==this.session.get()||!selectedCurrent())return null;
      const context=adopted.projectContext;
      if(requestedProject?!context||context.organizationId!==requestedProject.organizationId||context.projectAccessId!==requestedProject.projectAccessId
        ||requestedProject.projectId!==undefined&&context.projectId!==requestedProject.projectId||!context.permissions.includes("project.read"):Boolean(context))return null;
      const source=this.captureSourceOwnership();
      if(!source||!this.sourceOwnershipActive(source)||onDestinationSource&&!onDestinationSource(source)||!current())return null;
      return adopted;
    },finish:async()=>{finished=true;await reconcile();},request:async(project:{organizationId:string;projectAccessId:string;projectId?:string}|null):Promise<Response|null>=>{
      if(requested||!sourceCurrent())return null;requested=true;
      requestedProject=project?{organizationId:project.organizationId,projectAccessId:project.projectAccessId,projectId:project.projectId}:null;
      let ready!:()=>void;
      const owner:ProjectContextCookieRequest={ready:new Promise<void>(resolve=>{ready=resolve;}),settled:false,admitted:false,current:()=>!finished&&sourceCurrent(),matches,reconciliation:null};
      requestedOwner=owner;this.#projectContextLatest=owner;this.#sessionRevision+=1;
      let cookieMayHaveChanged=false,held=false,requestPrimary:{error:unknown}|null=null;
      try{
        // A newer waiter cannot overtake a response which can still install Set-Cookie.
        while(this.#projectContextHandshake){await this.#projectContextHandshake;if(!sourceCurrent())return null;}
        if(!sourceCurrent())return null;
        held=true;
        const heldFailureHistory:unknown[]=[];
        return await this.#nativeImageHeldMutation(async()=>{
        let primary:{error:unknown}|null=null;
        try{
        // Retirement callbacks are outside code; they cannot grant dispatch.
        if(!sourceCurrent())return null;
        const pending=fetch(project?"/api/workspaces/"+encodeURIComponent(project.organizationId)+"/projects/"+encodeURIComponent(project.projectAccessId)+"/context":"/api/workspaces/context",
          {method:project?"POST":"DELETE",credentials:"same-origin"});
        const settled=pending.then(()=>undefined,()=>undefined);this.#projectContextHandshake=settled;
        try{const response=await pending;cookieMayHaveChanged=response.ok;return sourceCurrent()?response:null;}
        catch(error){cookieMayHaveChanged=true;throw error;}
        finally{if(this.#projectContextHandshake===settled)this.#projectContextHandshake=null;}
        }catch(error){heldFailureHistory.push(error);primary={error};throw error;}
        finally{
          try{
            if(cookieMayHaveChanged){this.#projectContextCookieGeneration+=1;this.#sessionRevision+=1;}
            owner.settled=true;ready();await reconcile();
          }catch(cleanup){
            heldFailureHistory.push(cleanup);
            const combined=primary?combineNativeImageRetirementFailures([primary.error,cleanup]):null;
            // eslint-disable-next-line no-unsafe-finally -- Cleanup rejection preserves combined Image failures and existing legacy cleanup precedence.
            if(combined)throw combined;throw cleanup;
          }
        }
        },heldFailureHistory);
      }catch(error){requestPrimary={error};throw error;}
      finally{
        if(!held)try{owner.settled=true;ready();await reconcile();}
        // eslint-disable-next-line no-unsafe-finally -- Cleanup rejection preserves combined Image failures and existing legacy cleanup precedence.
        catch(cleanup){const combined=requestPrimary&&combineNativeImageRetirementFailures([requestPrimary.error,cleanup]);if(combined)throw combined;throw cleanup;}
      }
    }};
  }

  async openAssignedReview(task:AssignedReviewTask,options:Pick<WorkspaceNavigationOptions,"current"|"focus"|"onOriginHandoff"|"onDestinationSource">={}){
    if(!workspaceNavigationCurrent(options))return false;
    const selection=this.beginProjectContextSelection({requireUnexpiredContext:true,current:()=>workspaceNavigationCurrent(options)}),session=this.session.get();
    if(!session||session.impersonation||task.status!=="pending"||!Number.isSafeInteger(task.revision)||task.revision<0||!/^[a-f0-9]{64}$/.test(task.contentSha256))return false;
    const actorId=session.user.userId,ownsNavigation=()=>selection.current()&&workspaceNavigationCurrent(options);
    const originContext=session.projectContext;
    const originDocumentId=originContext&&originContext.organizationId===task.organizationId&&originContext.projectAccessId===task.projectAccessId&&originContext.projectId===task.projectId
      ?projectTaskDocumentIdFromRoute(this.route.get())??documentIdFromRoute(this.route.get())??this.projection.get().documentId:"";
    let finishRouteHandoff!:()=>void;
    const routeHandoff=new Promise<void>(resolve=>{finishRouteHandoff=resolve;});
    const current=()=>{const now=this.session.get(),context=now?.projectContext;return Boolean(ownsNavigation()&&now&&!now.impersonation&&now.user.userId===actorId
      &&context?.organizationId===task.organizationId&&context.projectAccessId===task.projectAccessId
      &&context.projectId===task.projectId&&context.permissions.includes("project.review.approve"));};
    try{
      const response=await selection.request(task);if(!response)return false;
      const body=await response.json() as {error?:string};if(!selection.sourceCurrent())return false;
      if(!response.ok)throw new Error(body.error??"The assigned project is no longer available.");
      if(this.session.get()?.user.userId!==actorId)return false;
      // The original view owns raw work until this positive, still-current
      // context response. Adoption below intentionally retires its old Source.
      if(options.onOriginHandoff&&(!workspaceNavigationCurrent(options)||!options.onOriginHandoff()))return false;
      if(!await selection.refreshSession(options.onDestinationSource)||!current())return false;
      // Only this load waits for its exact task decision; newer loads remain independent.
      await this.load({routeHandoff});if(!current())return false;
      await this.syncReviewInbox();if(!current())return false;
      const pending=this.reviewInbox.get().some(candidate=>candidate.id===task.id&&candidate.status==="pending"
        &&candidate.organizationId===task.organizationId&&candidate.projectAccessId===task.projectAccessId
        &&candidate.documentId===task.documentId&&candidate.artifactId===task.artifactId
        &&candidate.revision===task.revision&&candidate.contentSha256===task.contentSha256);
      if(!pending)throw new Error("The assigned review could not be opened.");
      // A same-project Work return remains useful only while its exact Document
      // exists in the newly loaded source; the old task route may suppress projection.
      const returnDocumentId=originDocumentId&&foldEvents(this.events.get(),Number.POSITIVE_INFINITY,"",task.projectId).documents
        .some(document=>document.id===originDocumentId&&document.projectId===task.projectId&&!document.removed)
        ?originDocumentId:task.documentId;
      this.setRoute(artifactFocusRoute(task.artifactId,task.artifactTitle,{expectedRevision:task.revision,expectedContentSha256:task.contentSha256,intent:"review"}),
        {documentId:returnDocumentId,current,focus:options.focus});
      return true;
    }catch(error){if(ownsNavigation()&&this.session.get()?.user.userId===actorId)this.toast(error instanceof Error?error.message:"The assigned review could not be opened.");return false;}
    finally{finishRouteHandoff();await selection.finish();}
  }

  async leaveProjectContext(options:Pick<WorkspaceNavigationOptions,"current"|"focus"|"onOriginHandoff"|"onDestinationSource">&{destination?:"/projects"|"/activity"}={}){
    if(!workspaceNavigationCurrent(options))return false;
    const selection=this.beginProjectContextSelection({current:()=>workspaceNavigationCurrent(options)});
    if(!this.session.get()?.projectContext&&!this.#projectContextHandshake)return options.destination!=="/activity";
    try{
      const response=await selection.request(null);if(!response)return false;
      const body=await response.json() as {error?:string};if(!selection.sourceCurrent())return false;
      if(!response.ok)throw new Error(body.error??"project_context_exit_failed");
      if(options.onOriginHandoff&&(!workspaceNavigationCurrent(options)||!options.onOriginHandoff()))return false;
      if(!await selection.refreshSession(options.onDestinationSource)||!selection.current())return false;
      this.patchUi({commandOpen:false,accountOpen:false,shareOpen:false,compareOpen:false});
      if(options.destination==="/activity"){
        const source=this.captureSourceOwnership();if(!source||!this.sourceOwnershipActive(source))return false;
        let finishRouteHandoff!:()=>void;
        const routeHandoff=new Promise<void>(resolve=>{finishRouteHandoff=resolve;});
        try{
          // The old shared task address is not a personal Document selection.
          // Load the actual personal source before the one final route commit.
          const loadRevision=this.#loadRevision+1;
          await this.load({routeHandoff});
          if(loadRevision!==this.#loadRevision||this.loading.get()||!selection.current()
            ||!workspaceNavigationCurrent(options)||!this.sourceOwnershipActive(source)
            ||this.session.get()?.projectContext||this.error.get())return false;
          const documentId=foldEvents(this.events.get(),this.asOf.get()).documentId;
          const destination=withProjectTaskDocumentInRoute("/activity",documentId);
          this.setRoute(destination,{documentId,current:()=>selection.current()&&workspaceNavigationCurrent(options),focus:options.focus});
          return this.route.get()===destination&&this.sourceOwnershipActive(source)&&workspaceNavigationCurrent(options);
        }finally{finishRouteHandoff();}
      }
      this.setRoute("/projects",{current:()=>selection.current()&&workspaceNavigationCurrent(options),focus:options.focus});
      const navigation=this.#workspaceTransition,route=this.route.get(),source=this.captureSourceOwnership();
      await this.load();
      return this.#workspaceTransition===navigation&&this.route.get()===route&&this.sourceOwnershipActive(source)&&workspaceNavigationCurrent(options);
    }catch(error){if(selection.current())this.toast(error instanceof Error?error.message:"The shared project could not be closed.");return false;}
    finally{await selection.finish();}
  }

  async acceptTerms() {
    return this.#nativeImagePublisherWork(async()=>{
      this.busy.set("consent"); this.notify();
      const response = await fetch("/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "accept_terms", ownershipConfirmed: true, providerProcessingConfirmed: true }) });
      const body = await response.json() as PilotSession & { error?: string }; if (!response.ok) throw new Error(body.error ?? "Consent could not be recorded");
      this.session.set(body);
      const retirementFailures:unknown[]=[];
      try{this.#nativeImageCheckpoint();}catch(error){if(!NativeImageRetirementError.is(error))throw error;retirementFailures.push(error);}
      // The existing source/cache load is mandatory after consent publication.
      // A listener failure is surfaced only after that continuation settles.
      let primary:{error:unknown}|null=null;
      try{await this.load();}catch(error){primary={error};}
      this.#finishNativeImageWork(undefined,primary,retirementFailures);
      this.toast("Pilot terms accepted and witnessed in the event stream.");
    },()=>{this.busy.set("");this.notify();},error=>{this.toast(error instanceof Error ? error.message : "Consent failed");});
  }


  #eventWriteOwner(source:CapturedSourceOwnership|null):EventWriteOwner{
    const session=this.session.get();
    return Object.freeze({authorizationKey:source?.authorization.key??"",actorUserId:session?.user.userId??"",
      projectId:session?.projectContext?.projectId??this.#outputSourceProjectId(),sourceGeneration:source?.generation??this.#sourceGeneration});
  }
  #sameEventWriteScope(left:EventWriteOwner,right:EventWriteOwner){
    return left.authorizationKey===right.authorizationKey&&left.actorUserId===right.actorUserId&&left.projectId===right.projectId;
  }
  #eventWriteReceipt(observation:EventWriteObservation,patch:Partial<EventWriteAcknowledgment>={}):EventWriteAcknowledgment{
    const value={...observation.receipt,...patch};
    return Object.freeze({...value,owner:Object.freeze({...value.owner}),
      requestedClientEventIds:Object.freeze([...value.requestedClientEventIds]),
      committed:Object.freeze(value.committed.map(row=>Object.freeze({...row}))),
      rejectedIndices:Object.freeze([...value.rejectedIndices])});
  }
  /** Local, content-free observations only. These identifiers are not server recovery keys. */
  eventWriteAcknowledgments(owner:EventWriteOwner):readonly EventWriteAcknowledgment[]{
    const current=this.#eventWriteOwner(this.captureSourceOwnership());
    if(!current.authorizationKey||!this.#sameEventWriteScope(owner,current))return[];
    return [...this.#eventWriteObservations.values()].filter(entry=>this.#sameEventWriteScope(entry.receipt.owner,owner))
      .map(entry=>this.#eventWriteReceipt(entry));
  }
  releaseEventWriteAcknowledgment(observationId:string,owner:EventWriteOwner):boolean{
    const entry=this.#eventWriteObservations.get(observationId),current=this.#eventWriteOwner(this.captureSourceOwnership());
    if(!entry||!current.authorizationKey||!this.#sameEventWriteScope(owner,current)
      ||!this.#sameEventWriteScope(entry.receipt.owner,owner)||entry.pending||!entry.delivered
      ||entry.receipt.outcome==="unconfirmed")return false;
    this.#eventWriteObservations.delete(observationId);return true;
  }
  async #admitEventWrite(events:EventInput[],action:EventWriteAcknowledgment["action"],expected?:number){
    const source=this.captureSourceOwnership(),session=this.session.get(),owner=this.#eventWriteOwner(source);
    const clientIds=events.map(event=>typeof event.payload?.client_event_id==="string"?event.payload.client_event_id:"");
    const completeIds=clientIds.length>0&&clientIds.every(Boolean)&&new Set(clientIds).size===clientIds.length;
    const record:EventWriteObservation={source,read:null,pending:true,delivered:false,signature:null,attempted:false,paused:false,
      streamId:session?.projectContext?"project:"+session.projectContext.projectAccessId:"creative:"+(session?.user.userId??""),actor:source?.authorization.shared?"user:"+owner.actorUserId:"user",
      receipt:Object.freeze({observationId:crypto.randomUUID(),owner,action,requestedClientEventIds:Object.freeze(clientIds.filter(Boolean)),
        committed:Object.freeze([]),rejectedIndices:Object.freeze([]),outcome:"not-attempted",observedHead:null,privateUnavailable:!this.sourceOwnershipActive(source)})};
    const scopeCount=[...this.#eventWriteObservations.values()].filter(entry=>this.#sameEventWriteScope(entry.receipt.owner,owner)).length;
    const capacity=scopeCount<EVENT_WRITE_SCOPE_CAPACITY&&this.#eventWriteObservations.size<EVENT_WRITE_STORE_CAPACITY;
    const admitted=Boolean(events.length&&capacity&&this.sourceOwnershipActive(source));
    // Reserve synchronously, before the digest, append queue or network can yield.
    if(admitted){record.read=this.#beginSourceRead("full");this.#eventWriteObservations.set(record.receipt.observationId,record);}
    try{
      if(completeIds){
        const bytes=new TextEncoder().encode(JSON.stringify({action,events,expected:expected??null}));
        const digest=await crypto.subtle.digest("SHA-256",bytes);
        record.signature=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,"0")).join("");
        const existing=[...this.#eventWriteObservations.values()].find(entry=>entry!==record&&entry.signature===record.signature
          &&entry.receipt.action===action&&this.#sameEventWriteScope(entry.receipt.owner,owner)
          &&entry.receipt.requestedClientEventIds.length===clientIds.length
          &&entry.receipt.requestedClientEventIds.every((id,index)=>id===clientIds[index]));
        if(existing){
          if(admitted)this.#eventWriteObservations.delete(record.receipt.observationId);
          // Keep the normal Canvas same-ID transport retry. A retired original is
          // permanently paused; a later source refresh does not authorize a resend.
          const retry=action==="canvas_sync"&&!existing.pending&&!existing.paused
            &&existing.receipt.outcome==="unconfirmed"&&this.sourceOwnershipActive(existing.source);
          if(retry){existing.pending=true;existing.delivered=false;}
          return{observation:existing,admitted:retry,reused:true,capacity:true};
        }
      }
    }catch{
      if(admitted)this.#eventWriteObservations.delete(record.receipt.observationId);
      record.pending=false;return{observation:record,admitted:false,reused:false,capacity:true};
    }
    if(!admitted)record.pending=false;
    return{observation:record,admitted,reused:false,capacity};
  }
  #withheldEventWrite(observation:EventWriteObservation):EventWriteResult{
    const pending=observation.pending&&!observation.attempted;
    const acknowledgment=this.#eventWriteReceipt(observation,{privateUnavailable:!this.sourceOwnershipActive(observation.source)||observation.paused,
      ...(pending?{outcome:"unconfirmed" as const}:{})});
    return{appended:[],acknowledgment,publication:acknowledgment.privateUnavailable?"withheld":"none"};
  }
  #finishEventWrite(observation:EventWriteObservation,patch:Partial<EventWriteAcknowledgment>,appended:CreativeEvent[],publication:EventWriteResult["publication"],options:AppendOptions={}):EventWriteResult{
    observation.pending=false;observation.receipt=this.#eventWriteReceipt(observation,patch);observation.delivered=true;
    const receipt=observation.receipt;
    const failures:unknown[]=[];let primary:{error:unknown}|null=null;
    try{
    if(this.sourceOwnershipScopeActive(observation.source)){
      try{options.onAcknowledgment?.(receipt);}catch(error){if(NativeImageRetirementError.is(error))failures.push(error);/* The already-observed commit is independent of its UI owner. */}
      if(publication==="withheld"){
        this.appendFailure.set("");
        if(!options.silent)this.toast(this.#systemNotice(receipt.committed.length
          ?receipt.outcome==="observed"?"The server acknowledged the original change. Its private view is unavailable.":"Only part of the original change is acknowledged. It has not been resubmitted."
          :receipt.outcome==="unconfirmed"?"The original change is unconfirmed. It has not been resubmitted."
          :"This invocation was not sent because the source is unavailable."));
      }
    }
    }catch(error){primary={error};}
    finally{
    if(receipt.outcome==="not-attempted"||publication==="published"&&receipt.outcome==="observed")
      this.#eventWriteObservations.delete(receipt.observationId);
    }
    if(primary&&failures.length){failures.push(primary.error);primary=null;}
    return this.#finishNativeImageWork({appended,acknowledgment:receipt,publication},primary,failures);
  }

  #requestedEventObserved(input:EventInput,event:CreativeEvent){
    if(input.type!==event.type||(input.compensatesEventId??null)!==(event.compensatesEventId??null))return false;
    const contains=(expected:unknown,actual:unknown):boolean=>{
      if(expected===null||typeof expected!=="object")return expected===actual;
      if(Array.isArray(expected))return Array.isArray(actual)&&expected.length===actual.length&&expected.every((value,index)=>contains(value,actual[index]));
      if(!actual||typeof actual!=="object"||Array.isArray(actual))return false;
      return Object.entries(expected as Record<string,unknown>).every(([key,value])=>value===undefined||Object.hasOwn(actual,key)&&contains(value,(actual as Record<string,unknown>)[key]));
    };
    const expectedPayload=input.type==="BlockCreated"?normalizeOutputRequirementCreation(input.payload):input.payload;
    return contains(expectedPayload,event.payload);
  }

  #matchedRequestedWrites(inputs:EventInput[],appended:CreativeEvent[],rejected:Set<number>,actor:string){
    const ownerByEvent=new Map<number,number>();
    const assign=(inputIndex:number,seen:Set<number>):boolean=>{
      for(let index=0;index<appended.length;index++){
        const event=appended[index]!;
        if(seen.has(index)||event.actor!==actor||!this.#requestedEventObserved(inputs[inputIndex]!,event))continue;
        seen.add(index);const previous=ownerByEvent.get(index);
        if(previous===undefined||assign(previous,seen)){ownerByEvent.set(index,inputIndex);return true;}
      }
      return false;
    };
    for(let index=0;index<inputs.length;index++)if(!rejected.has(index))assign(index,new Set());
    return new Set(ownerByEvent.values());
  }

  #eventWriteComplete(result:EventWriteResult,inputs:EventInput[]){
    return result.publication==="published"&&result.acknowledgment.outcome==="observed"&&!result.acknowledgment.rejectedIndices.length
      &&inputs.every(input=>result.appended.some(event=>this.#requestedEventObserved(input,event)));
  }
  #withheldWrite(result:EventWriteResult):WithheldEventWrite{return{publication:"withheld",acknowledgment:result.acknowledgment};}

  #validateEventWriteBody(value:unknown,events:EventInput[],observation:EventWriteObservation){
    if(!value||typeof value!=="object"||Array.isArray(value))return null;
    const body=value as Record<string,unknown>;
    if(!Array.isArray(body.appended)||!Number.isSafeInteger(body.head)||Number(body.head)<0
      ||body.rejected!==undefined&&!Array.isArray(body.rejected))return null;
    const rejected:Array<{index:number;type?:string;reason:string}>=[],rejectedIds=new Set<number>();
    for(const item of (body.rejected??[]) as unknown[]){
      if(!item||typeof item!=="object"||Array.isArray(item))return null;
      const row=item as Record<string,unknown>,index=Number(row.index);
      if(!Number.isSafeInteger(row.index)||index<0||index>=events.length||rejectedIds.has(index)||typeof row.reason!=="string"
        ||row.type!==undefined&&(typeof row.type!=="string"||row.type!==events[index]!.type))return null;
      rejectedIds.add(index);rejected.push({index,reason:row.reason,...(typeof row.type==="string"?{type:row.type}:{})});
    }
    const ids=new Set<string>(),sequences=new Set<number>(),clientIds=new Set<string>(),appended:CreativeEvent[]=[],committed:CommittedEventIdentity[]=[];
    const requested=new Map(events.flatMap(event=>typeof event.payload?.client_event_id==="string"&&event.payload.client_event_id?[[event.payload.client_event_id,event] as const]:[]));
    for(const value of body.appended){
      if(!value||typeof value!=="object"||Array.isArray(value))return null;
      const event=value as CreativeEvent;
      if(typeof event.eventId!=="string"||!event.eventId||ids.has(event.eventId)||event.streamId!==observation.streamId
        ||!Number.isSafeInteger(event.sequence)||event.sequence<1||event.sequence>Number(body.head)||sequences.has(event.sequence)
        ||typeof event.type!=="string"||!event.type||!event.payload||typeof event.payload!=="object"||Array.isArray(event.payload)
        ||typeof event.occurredAt!=="string"||typeof event.recordedAt!=="string"||typeof event.clientId!=="string"
        ||typeof event.correlationId!=="string"||!Number.isSafeInteger(event.schemaVersion))return null;
      ids.add(event.eventId);sequences.add(event.sequence);
      if(event.actor==="worker:validator"&&event.type==="ValidationFailed"){appended.push(event);continue;}
      if(event.actor!==observation.actor)return null;
      const clientId=typeof event.payload.client_event_id==="string"&&event.payload.client_event_id?event.payload.client_event_id:null;
      if(clientId&&(clientIds.has(clientId)||!requested.has(clientId)))return null;
      if(clientId)clientIds.add(clientId);
      if(observation.receipt.action==="canvas_sync"){
        const input=clientId?requested.get(clientId):undefined;
        if(!input||event.type!==input.type||event.payload.history_owner_id!==observation.receipt.owner.actorUserId
          ||event.payload.project_id!==input.payload.project_id||event.compensatesEventId!==(input.compensatesEventId??null))return null;
      }
      appended.push(event);committed.push({eventId:event.eventId,type:event.type,sequence:event.sequence,clientEventId:clientId});
    }
    const matched=this.#matchedRequestedWrites(events,appended,rejectedIds,observation.actor);
    const complete=events.every((event,index)=>rejectedIds.has(index)||(observation.receipt.action==="canvas_sync"
      ?clientIds.has(String(event.payload.client_event_id??"")):matched.has(index)));
    return{appended,committed,rejected,rejectedIndices:[...rejectedIds],head:Number(body.head),complete};
  }

  async append(event:EventInput,options:AppendOptions={}):Promise<CreativeEvent[]>{return this.appendBatch([event],options);}

  /** Correct the durable deliverable itself without invoking a generation provider. */
  async reviseDocumentArtifact(artifactId:string,input:AudioTrimEditRequest,convertedSource?:Uint8Array):Promise<AudioTrimEditResult>;
  async reviseDocumentArtifact(artifactId:string,input:VideoTrimEditRequest):Promise<VideoTrimEditResult>;
  async reviseDocumentArtifact(artifactId:string,input:Model3dScaleEditRequest):Promise<Model3dScaleEditResult>;
  async reviseDocumentArtifact(artifactId:string,input:{markdown:string;items?:Array<{index:number;title?:string;body?:string;notes?:string}>;expectedRevision:number}):Promise<boolean>;
  async reviseDocumentArtifact(artifactId:string,input:AudioTrimEditRequest|VideoTrimEditRequest|Model3dScaleEditRequest|{markdown:string;items?:Array<{index:number;title?:string;body?:string;notes?:string}>;expectedRevision:number},convertedSource?:Uint8Array):Promise<AudioTrimEditResult|VideoTrimEditResult|Model3dScaleEditResult|boolean>{
    if ("model3dScale" in input) return this.#reviseModel3dDocumentArtifact(artifactId,input);
    if ("videoTrim" in input) return this.#reviseVideoDocumentArtifact(artifactId,input);
    if (convertedSource !== undefined && (Object.getPrototypeOf(convertedSource) !== Uint8Array.prototype || convertedSource.byteLength > PCM_WAV_EDIT_MAX_BYTES)) return {status:"refused",code:"invalid_range"};
    const convertedBytes = convertedSource ? new Uint8Array(convertedSource) : null;
    try {
    const requestInput=JSON.parse(JSON.stringify(input)) as typeof input;
    const trimRequested = "audioTrim" in requestInput;
    const trimInput = trimRequested ? parseAudioTrimOperationRequest(requestInput) : null;
    if (trimRequested && !trimInput || Boolean(trimInput?.audioTrim.conversion) !== Boolean(convertedBytes)) return {status:"refused",code:"invalid_range"};
    const textInput = "markdown" in requestInput ? requestInput : null;
    const trimFailure = (status: "conflict" | "refused" | "unconfirmed" | "retired", code: "source_changed" | "invalid_range" | "unsupported" | "unavailable" | "access_denied" | "unconfirmed" | "retired") =>
      ({status,code} as AudioTrimEditResult);
    const digestText = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,"0")).join("");
    // Capture the exact current artifact and retained bytes before admission can yield.
    // Only the dedicated server no-op envelope may certify these same bytes later.
    const artifact=this.projection.get().libraryArtifacts.find(candidate=>candidate.id===artifactId);
    const contentRef=artifact?.contentRef??"",retainedBefore=this.content.get()[contentRef];
    const projectId=this.projection.get().projectId,revisionBefore=documentArtifactRevision(this.events.get(),artifactId);
    const retainedDraft = parseDocumentArtifactContent(retainedBefore);
    const unchangedContent=(()=>{
      if (trimInput) return !trimInput.audioTrim.conversion && trimInput.audioTrim.startFrame === 0 && trimInput.audioTrim.endFrame === trimInput.audioTrim.sourceFrameCount
        && trimInput.audioTrim.resultMediaSha256 === trimInput.audioTrim.sourceMediaSha256 && typeof retainedBefore === "string" ? retainedBefore : null;
      if(!artifact||!contentRef||!Number.isSafeInteger(requestInput.expectedRevision)||requestInput.expectedRevision!==revisionBefore
        ||!textInput||typeof textInput.markdown!=="string"||!textInput.markdown.trim())return null;
      const edited=parseDocumentArtifactContent(retainedBefore);if(!edited)return null;
      edited.content_markdown=textInput.markdown;
      if(textInput.items!==undefined){
        if(!Array.isArray(textInput.items))return null;
        for(const candidate of textInput.items){
          if(!candidate||!Number.isSafeInteger(candidate.index)||candidate.index<0||candidate.index>=edited.items.length)return null;
          for(const field of ["title","body","notes"] as const){
            if(candidate[field]===undefined)continue;
            if(typeof candidate[field]!=="string")return null;
            edited.items[candidate.index]![field]=candidate[field];
          }
        }
      }else if(edited.items.length===1&&["short_story","scene"].includes(artifact.kind))edited.items[0]!.body=textInput.markdown;
      // Reuse the same parser normalization as the existing artifact endpoint.
      // Semantically equal text is insufficient when serialized retained bytes differ.
      return JSON.stringify(edited)===retainedBefore?retainedBefore:null;
    })();
    const sourceOwner=this.captureSourceOwnership(),authorization=this.#activeAuthorizationScope();
    const trimRoute = this.route.get();
    const trimSourceCurrent = () => {
      const current = this.projection.get().libraryArtifacts.find(candidate=>candidate.id===artifactId);
      return this.sourceOwnershipActive(sourceOwner) && this.#scopeStillActive(authorization) && this.route.get() === trimRoute && this.projection.get().projectId === projectId
        && current?.documentId === artifact?.documentId && current?.kind === artifact?.kind && current?.contentRef === contentRef
        && current?.mediaUrl === artifact?.mediaUrl && current?.mediaType === artifact?.mediaType
        && current?.settings.source_media_sha256 === artifact?.settings.source_media_sha256
        && documentArtifactRevision(this.events.get(),artifactId) === revisionBefore && this.content.get()[contentRef] === retainedBefore;
    };
    if (trimInput) {
      const trim = trimInput.audioTrim, hash = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
      if (!artifact || artifact.kind !== "audio" || this.session.get()?.projectContext) return trimFailure("refused","unsupported");
      if (!retainedDraft || typeof retainedBefore !== "string" || !contentRef || !artifact.mediaUrl) return trimFailure("refused","unavailable");
      if (!trim || !Number.isSafeInteger(trimInput.expectedRevision) || !hash(trimInput.expectedContentSha256)
        || !hash(trim.sourceMediaSha256) || !hash(trim.resultMediaSha256) || !Number.isSafeInteger(trim.sourceFrameCount)
        || trim.sourceFrameCount < 1 || !Number.isSafeInteger(trim.startFrame) || !Number.isSafeInteger(trim.endFrame)
        || trim.startFrame < 0 || trim.startFrame >= trim.endFrame || trim.endFrame > trim.sourceFrameCount) return trimFailure("refused","invalid_range");
      if (revisionBefore !== trimInput.expectedRevision || artifact.settings.source_media_sha256 !== trim.sourceMediaSha256
        || await digestText(retainedBefore) !== trimInput.expectedContentSha256) return trimFailure("conflict","source_changed");
      if (!trimSourceCurrent()) return trimFailure("retired","retired");
      if (trim.conversion) {
        const info = convertedBytes && inspectPcmWav(convertedBytes);
        if (artifact.mediaType !== "audio/mpeg" || !convertedBytes || !info || convertedBytes.length !== trim.conversion.decodedByteLength
          || info.sampleRate !== trim.conversion.sampleRate || info.channels !== trim.conversion.channels || info.frameCount !== trim.conversion.frameCount) return trimFailure("refused","invalid_range");
        const decodedHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new Uint8Array(convertedBytes))),byte=>byte.toString(16).padStart(2,"0")).join("");
        if (!trimSourceCurrent()) return trimFailure("retired","retired");
        if (decodedHash !== trim.conversion.decodedMediaSha256) return trimFailure("refused","invalid_range");
      }
    }
    const admission=await this.#admitEventWrite([{type:"DocumentArtifactEdited",payload:{artifact_id:artifactId}}],"append"),observation=admission.observation;
    if(!admission.admitted){if(!admission.reused)this.#finishEventWrite(observation,{outcome:"not-attempted",privateUnavailable:!this.sourceOwnershipActive(sourceOwner)},[],this.sourceOwnershipActive(sourceOwner)?"none":"withheld",{silent:true});return trimInput ? trimFailure(this.sourceOwnershipActive(sourceOwner)?"unconfirmed":"retired",this.sourceOwnershipActive(sourceOwner)?"unconfirmed":"retired") : false;}
    if (trimInput) observation.audioTrim = {artifactId,request:trimInput,contentRef,documentId:artifact!.documentId,projectId,
      sourceMediaUrl:artifact!.mediaUrl!,sourceRaw:retainedBefore!,sourceRevision:revisionBefore};
    const edit=async()=>{
      if(!this.sourceOwnershipActive(sourceOwner)||trimInput&&!trimSourceCurrent()){this.#finishEventWrite(observation,{outcome:"not-attempted",privateUnavailable:true},[],"withheld");return trimInput?trimFailure("retired","retired"):false;}
      this.busy.set("DocumentArtifactEdited");this.notify();let dispatched=false;observation.attempted=true;
      try{
        const wire = convertedBytes ? {operation:trimInput,convertedAudioSource:encodeAudioConversionSource(convertedBytes)} : requestInput;
        const response=await this.guardedFetch("/api/artifacts/"+encodeURIComponent(artifactId),{method:"PATCH",headers:{"content-type":convertedBytes?AUDIO_LOCAL_CONVERSION_MEDIA_TYPE:"application/json"},body:JSON.stringify(wire)},"save a correction to this finished output",
          {current:()=>dispatched||(trimInput?trimSourceCurrent():this.sourceOwnershipActive(sourceOwner)),onDispatch:()=>{dispatched=true;}});
        this.#assertAuthorizationScope(authorization);
        const result=await response.json() as {appended?:CreativeEvent[];content?:Record<string,string>;head?:number;revision?:number;error?:string;message?:string};
        this.#assertAuthorizationScope(authorization);
        if(!response.ok){
          if (trimInput) {
            const refused: AudioTrimEditResult | null = response.status === 409 && ["artifact_revision_conflict","audio_trim_source_changed"].includes(result.error??"") ? trimFailure("conflict","source_changed")
              : response.status === 400 && result.error === "audio_trim_invalid_range" ? trimFailure("refused","invalid_range")
              : response.status === 400 && result.error === "audio_trim_unsupported" ? trimFailure("refused","unsupported")
              : response.status === 400 && ["invalid_artifact_revision","artifact_revision_too_large"].includes(result.error??"") ? trimFailure("refused","unavailable")
              : response.status === 404 ? trimFailure("refused","unavailable")
              : response.status === 401 || response.status === 403 ? trimFailure("refused","access_denied") : null;
            if (refused) {
              const current = trimSourceCurrent() && !observation.paused;
              this.#finishEventWrite(observation,{outcome:"observed",committed:[],rejectedIndices:[],observedHead:null,privateUnavailable:!current},[],current?"none":"withheld",{silent:true});
              this.releaseEventWriteAcknowledgment(observation.receipt.observationId,observation.receipt.owner);
              return current ? refused : trimFailure("retired","retired");
            }
            throw new Error("audio_trim_unconfirmed");
          }
          if(response.status===409&&result.error==="artifact_revision_conflict")throw new Error("Another collaborator changed this output. Your unsaved correction is preserved; reopen the latest version before saving again.");throw new Error(result.message??result.error??"The finished output could not be saved.");
        }
        const currentArtifact=this.projection.get().libraryArtifacts.find(candidate=>candidate.id===artifactId);
        const noChange=response.status===200&&unchangedContent!==null&&result&&typeof result==="object"&&!Array.isArray(result)
          &&Object.keys(result).sort().join(",")==="appended,content,revision"
          &&Array.isArray(result.appended)&&result.appended.length===0&&result.revision===requestInput.expectedRevision
          &&result.content&&typeof result.content==="object"&&!Array.isArray(result.content)
          &&Object.keys(result.content).length===1&&Object.hasOwn(result.content,contentRef)&&result.content[contentRef]===unchangedContent
          &&this.sourceOwnershipActive(sourceOwner)&&!observation.paused&&this.projection.get().projectId===projectId
          &&currentArtifact?.documentId===artifact?.documentId&&currentArtifact?.kind===artifact?.kind&&currentArtifact?.contentRef===contentRef
          &&documentArtifactRevision(this.events.get(),artifactId)===revisionBefore&&this.content.get()[contentRef]===unchangedContent&&(!trimInput||trimSourceCurrent());
        if(noChange){
          // Administrative completion of this invocation only: no committed event,
          // source publication, head, hash, or revision is manufactured for a no-op.
          this.#finishEventWrite(observation,{outcome:"observed",committed:[],rejectedIndices:[],observedHead:null,privateUnavailable:false},[],"none",{silent:true});
          this.releaseEventWriteAcknowledgment(observation.receipt.observationId,observation.receipt.owner);
          if (trimInput) return {status:"unchanged",code:"unchanged"} as AudioTrimEditResult;
          this.toast("No changes to this finished output.");return true;
        }
        const receipt=this.#validateEventWriteBody(result,[{type:"DocumentArtifactEdited",payload:{artifact_id:artifactId}}],observation);
        if(!receipt||!receipt.committed.some(event=>event.type==="DocumentArtifactEdited"))throw new Error("The original finished-output change is unconfirmed. It has not been repeated.");
        let audioSaved: Extract<AudioTrimEditResult,{status:"saved"}> | null = null;
        if (trimInput) {
          audioSaved = await this.#validatedAudioTrimSave(observation.audioTrim!, result, receipt.appended);
          if (!audioSaved) throw new Error("audio_trim_unconfirmed");
        }
        const current=this.sourceOwnershipActive(sourceOwner)&&!observation.paused;
        const patch:Partial<EventWriteAcknowledgment>={committed:receipt.committed,rejectedIndices:receipt.rejectedIndices,observedHead:receipt.head,
          outcome:receipt.complete?"observed":"unconfirmed",privateUnavailable:!current};
        if(!current||trimInput&&!trimSourceCurrent()){this.#finishEventWrite(observation,patch,[],"withheld");return trimInput?trimFailure("retired","retired"):false;}
        if(!receipt.complete||receipt.rejected.length){this.#finishEventWrite(observation,patch,[],"none",{silent:true});if(trimInput)return trimFailure("unconfirmed","unconfirmed");this.toast(this.#systemNotice("The original finished-output change is only partly acknowledged. It has not been repeated."));return false;}
        if(result.content)this.content.set({...this.content.get(),...this.#sourceContent(result.content)});
        this.#mergeConfirmed(receipt.appended,receipt.head);
        this.#finishEventWrite(observation,patch,receipt.appended,"published",{silent:true});
        if (audioSaved) return audioSaved;
        this.toast("Finished output updated. Request a fresh review before approval.");return true;
      }catch(error){
        if(!dispatched&&error instanceof Error&&error.message==="scene_cost_changed")observation.attempted=false;
        const current=this.sourceOwnershipActive(sourceOwner)&&!observation.paused;
        this.#finishEventWrite(observation,{outcome:observation.attempted?"unconfirmed":"not-attempted",privateUnavailable:!current},[],current?"none":"withheld",{silent:true});
        if(trimInput)return trimFailure(current?"unconfirmed":"retired",current?"unconfirmed":"retired");
        if(current)this.toast(error instanceof Error?error.message:"The finished output could not be saved.");return false;
      }finally{if(this.sourceOwnershipScopeActive(sourceOwner)){this.busy.set("");this.notify();}}
    };
    const pending=this.#appendPipeline.then(edit,edit);this.#appendPipeline=pending.then(()=>undefined,()=>undefined);return await pending;
    } finally { convertedBytes?.fill(0); }
  }

  #generatedImageOwner(outputId:string,current:()=>boolean=()=>true){
    const source=this.captureSourceOwnership(),authorization=this.captureAuthorizationScope(),route=this.route.get(),state=this.projection.get();
    const output=state.libraryOutputs.find(item=>item.id===outputId),session=this.session.get();
    const ownerId=session?.user.userId??"",documentId=output?.documentId??"",projectId=state.projectId;
    const active=()=>{
      const session=this.session.get(),projection=this.projection.get(),now=projection.libraryOutputs.find(item=>item.id===outputId);
      return Boolean(source&&output&&ownerId&&ownerId!=="anonymous"&&session&&!session.projectContext&&!session.impersonation
        &&session.user.userId===ownerId&&["creator","admin"].includes(session.user.role)&&session.policy.accepted===true
        &&this.sourceOwnershipActive(source)&&this.authorizationScopeActive(authorization)&&this.route.get()===route
        &&this.documentRouteState(route)==="ready"&&!this.#cachedHistoryRevalidation&&this.asOf.get()===Infinity
        &&projection.documentId===documentId&&projection.projectId===projectId
        &&projection.documents.some(item=>item.id===documentId&&item.projectId===projectId&&!item.removed)
        &&now&&!now.discarded&&now.documentId===documentId&&now.sourceEventId===output.sourceEventId
        &&now.generationId===output.generationId&&now.contentRef===output.contentRef&&current());
    };
    return {source,authorization,route,ownerId,projectId,documentId,outputId,active,
      read:()=>active()?{ownerId,projectId,documentId,outputId,events:this.events.get(),content:this.content.get(),head:this.head.get()}:null};
  }

  /** Bound private receipt transport. It never retries a mutation. */
  async #generatedImageHttp(path:string,init:RequestInit,current:()=>boolean,onDispatch?:()=>void){
    const controller=new AbortController(),read=this.#beginSourceRead("full");
    let timer:ReturnType<typeof setTimeout>|undefined,reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
    const chunks:Uint8Array[]=[];let complete=false;
    const cancel=()=>{try{void (reader?.cancel()??Promise.resolve()).catch(()=>{});}catch{/* Observe cancellation without blocking retirement. */}};
    const failure=()=>new Error("generated_image_request_retired");
    let rejectLifetime:(reason:Error)=>void=()=>{};
    const lifetime=new Promise<never>((_,reject)=>{rejectLifetime=reject;timer=setTimeout(()=>{controller.abort();cancel();reject(failure());},30_000);});
    const unsubscribe=this.subscribe(()=>{if(!current()){controller.abort();cancel();rejectLifetime(failure());}});
    const bounded=<T>(promise:Promise<T>)=>Promise.race([promise,lifetime]);
    const active=()=>{if(!current()||controller.signal.aborted)throw failure();};
    try{
      active();const pending=this.guardedFetch(path,{...init,credentials:"same-origin",redirect:"error",cache:"no-store",signal:controller.signal},"save this edited image",{current,onDispatch});
      void pending.then(response=>{if(controller.signal.aborted)void response.body?.cancel().catch(()=>{});}).catch(()=>{});
      const response=await bounded(pending);active();
      if([401,403,404].includes(response.status)){this.#retireOwnedSource(read,response.status as 401|403|404);return{ok:false,status:response.status,body:null};}
      if(!response.body)throw failure();reader=response.body.getReader();let length=0,count=0;
      const typed=Object.getPrototypeOf(Uint8Array.prototype),size=Object.getOwnPropertyDescriptor(typed,"byteLength")!.get!,buffer=Object.getOwnPropertyDescriptor(typed,"buffer")!.get!;
      while(true){const value=await bounded(reader.read());active();if(value.done){complete=true;break;}
        if(!(value.value instanceof Uint8Array)||!(buffer.call(value.value) instanceof ArrayBuffer)||++count>65536)throw failure();
        const bytes=size.call(value.value);if(!Number.isSafeInteger(bytes)||bytes<0||length+bytes>2_097_152)throw failure();
        const copy=new Uint8Array(bytes);Uint8Array.prototype.set.call(copy,value.value);chunks.push(copy);length+=bytes;
      }
      const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
      try{const body:unknown=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));active();return{ok:response.ok,status:response.status,body};}
      finally{bytes.fill(0);}
    }finally{unsubscribe();if(timer!==undefined)clearTimeout(timer);if(!complete){controller.abort();cancel();}for(const chunk of chunks)chunk.fill(0);try{reader?.releaseLock();}catch{/* Pending cancellation retains its own native reader. */}}
  }

  /** Free current output inspection. Missing association stays an explicit UI choice. */
  async loadGeneratedImageEdit(outputId:string,options:{current?:()=>boolean;prepareSource?:boolean}={}):Promise<GeneratedImageEditSnapshot|null>{
    const owner=this.#generatedImageOwner(outputId,options.current);if(!owner.active())return null;
    try{
      // Only an explicit review/open action opts in. Automatic reads remain GET
      // only; preparation reuses an idempotent operational nonce, never a job.
      if(options.prepareSource){
        const prepared=await this.#generatedImageHttp('/api/generated-images/'+encodeURIComponent(outputId),
          {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({operation:'prepare-current-read'})},owner.active);
        if(!owner.active()||!prepared.ok||!prepared.body||typeof prepared.body!=='object'||Array.isArray(prepared.body)
          ||(prepared.body as Record<string,unknown>).status!=='prepared')return null;
      }
      const response=await this.#generatedImageHttp("/api/generated-images/"+encodeURIComponent(outputId),{method:"GET"},owner.active);
      if(!owner.active()||!response.ok||!response.body||typeof response.body!=="object"||Array.isArray(response.body))return null;
      const incoming=response.body as Record<string,unknown>;
      if(typeof incoming.rawJson!=="string"||typeof incoming.contentRef!=="string")return null;
      // Read the committed stream separately; an endpoint DTO does not invent a
      // CreativeOutput or certify a stale local history head.
      await this.refreshEvents({readOnly:true,current:owner.active});if(!owner.active())return null;
      const read=()=>{const value=owner.read();return value?{...value,content:{...value.content,[incoming.contentRef as string]:incoming.rawJson as string}}:null;};
      const match=await matchGeneratedImageEditSnapshot(incoming,read);
      if(!owner.active()||match.status!=="current")return null;
      // Only this exact current source read may hydrate the original raw JSON.
      this.content.set({...this.content.get(),[match.contentRef]:match.rawJson});this.notify();
      return owner.active()?match:null;
    }catch{return null;}
  }

  async captureGeneratedImageEdit(outputId:string,sourceId:string,options:{current?:()=>boolean}={}):Promise<CurrentGeneratedImageEdit|null>{
    const owner=this.#generatedImageOwner(outputId,options.current);if(!owner.active())return null;
    const value=await captureCurrentGeneratedImageEdit(owner.read,sourceId);
    return owner.active()&&value.status==="captured"?value:null;
  }

  #generatedImageSourceCurrent(snapshot:GeneratedImageWriteObservation):boolean{
    const output=this.projection.get().libraryOutputs.find(item=>item.id===snapshot.outputId),edit=output?.imageRevision;
    return Boolean(output&&!output.discarded&&this.route.get()===snapshot.route&&this.projection.get().documentId===snapshot.documentId
      &&this.projection.get().projectId===snapshot.projectId&&this.session.get()?.user.userId===snapshot.ownerId&&!this.session.get()?.projectContext
      &&output.documentId===snapshot.documentId&&output.generationId===snapshot.request.generationId&&output.sourceEventId===snapshot.request.sourceEventId
      &&output.contentRef===snapshot.request.contentRef&&this.content.get()[snapshot.request.contentRef]===snapshot.rawJson
      &&(edit?.revision??0)===snapshot.request.expectedRevision&&(edit?.editEventId??null)===snapshot.request.expectedEditEventId
      &&output.mediaUrl===snapshot.request.sourceMediaUrl&&output.mediaType==="image/png"&&output.width===snapshot.width&&output.height===snapshot.height);
  }

  async #validatedGeneratedImageSave(snapshot:GeneratedImageWriteObservation,body:unknown,appended:CreativeEvent[]):Promise<Extract<GeneratedImageEditAcknowledgment,{status:"saved"}>|null>{
    if(!body||typeof body!=="object"||Array.isArray(body)||appended.length!==1)return null;
    const result=body as Record<string,unknown>,request=snapshot.request,record=parseGeneratedImageRevision(result.imageRevision,snapshot.ownerId),event=appended[0]!;
    if(result.status!=="saved"||result.code!=="saved"||!record||result.operationSha256!==snapshot.operationSha256
      ||record.operationSha256!==snapshot.operationSha256||record.outputId!==snapshot.outputId||record.documentId!==snapshot.documentId
      ||record.generationId!==request.generationId||record.sourceEventId!==request.sourceEventId||record.contentRef!==request.contentRef
      ||record.contentSha256!==request.expectedContentSha256||record.revision!==request.expectedRevision+1||record.editEventId!==event.eventId
      ||record.source.revision!==request.expectedRevision||record.source.eventId!==(request.expectedEditEventId??request.sourceEventId)
      ||record.source.mediaUrl!==request.sourceMediaUrl||record.source.sha256!==request.sourceMediaSha256||record.source.width!==snapshot.width||record.source.height!==snapshot.height
      ||record.media.sha256!==request.resultMediaSha256||record.media.byteLength!==request.resultByteLength||record.sourceId!==request.sourceId
      ||JSON.stringify(record.recipe)!==JSON.stringify(request.recipe)||typeof result.stillCurrent!=="boolean"
      ||!Number.isSafeInteger(result.currentRevision)||Number(result.currentRevision)<record.revision
      ||typeof result.currentEditEventId!=="string"||!result.currentEditEventId
      ||result.stillCurrent!==(result.currentRevision===record.revision&&result.currentEditEventId===record.editEventId))return null;
    const recipeSha=await outputAssetSha256(new TextEncoder().encode(JSON.stringify(request.recipe)));
    if(recipeSha!==record.recipeSha256)return null;
    const p=event.payload;
    const prior={...snapshot.output,imageRevision:snapshot.output.imageRevision};
    const projected=projectGeneratedImageEdit(prior,event,{ownerId:snapshot.ownerId,projectId:snapshot.projectId});
    if(!projected||projected.mediaUrl!==record.media.url||projected.width!==record.media.width||projected.height!==record.media.height
      ||projected.imageRevision?.contentSha256!==record.contentSha256||projected.imageRevision.mediaSha256!==record.media.sha256
      ||projected.imageRevision.byteLength!==record.media.byteLength||projected.imageRevision.operationSha256!==snapshot.operationSha256
      ||p.image_edit_operation_sha256!==snapshot.operationSha256)return null;
    return{status:"saved",code:"saved",imageRevision:record,operationSha256:snapshot.operationSha256,stillCurrent:result.stillCurrent,
      currentRevision:Number(result.currentRevision),currentEditEventId:result.currentEditEventId};
  }

  #generatedImageWrites=new Set<string>();
  async reviseGeneratedImage(outputId:string,input:GeneratedImageEditRequest,png:Uint8Array,options:{current?:()=>boolean}={}):Promise<GeneratedImageEditAcknowledgment>{
    const uncertain:GeneratedImageEditAcknowledgment={status:"unconfirmed",code:"unconfirmed"};
    if(this.#generatedImageWrites.has(outputId))return uncertain;
    const request=parseGeneratedImageEditRequest(input),owner=this.#generatedImageOwner(outputId,options.current);
    let bytes:Uint8Array<ArrayBuffer>|null=null;
    try{const typed=Object.getPrototypeOf(Uint8Array.prototype),size=Object.getOwnPropertyDescriptor(typed,"byteLength")!.get!,buffer=Object.getOwnPropertyDescriptor(typed,"buffer")!.get!;
      if(png instanceof Uint8Array&&buffer.call(png) instanceof ArrayBuffer){const length=size.call(png);if(Number.isSafeInteger(length)&&length>0&&length<=GENERATED_IMAGE_EDIT_LIMITS.pngBytes){bytes=new Uint8Array(length);Uint8Array.prototype.set.call(bytes,png);}}}catch{/* Invalid private bytes are never copied or sent. */}
    if(!request||!bytes||!owner.active()){bytes?.fill(0);return{status:"refused",code:"invalid"};}
    this.#generatedImageWrites.add(outputId);
    let observation:EventWriteObservation|null=null;
    try{
      const captured=await this.captureGeneratedImageEdit(outputId,request.sourceId,options);if(!owner.active()||!captured)return{status:"refused",code:"source_changed"};
      const basis=captured.basis;
      if(basis.revision!==request.expectedRevision||captured.editEventId!==request.expectedEditEventId||basis.contentSha256!==request.expectedContentSha256
        ||basis.media.url!==request.sourceMediaUrl||basis.media.sha256!==request.sourceMediaSha256||basis.generationId!==request.generationId
        ||basis.sourceEventId!==request.sourceEventId||basis.contentRef!==request.contentRef||validateReferenceComposition(request.recipe,captured.sources)!==null)return{status:"refused",code:"source_changed"};
      const inspected=await inspectOutputAsset(bytes,"edited.png",{snapshot:false});
      const operationSha256=await generatedImageEditOperationSha256({ownerId:owner.ownerId,projectId:owner.projectId,documentId:owner.documentId,outputId},request);
      if(!owner.active()||!captured.current())return{status:"refused",code:"source_changed"};
      if(!operationSha256||inspected.status!=="inspected"||inspected.extension!=="png"||inspected.mimeType!=="image/png"||inspected.sha256!==request.resultMediaSha256
        ||bytes.byteLength!==request.resultByteLength||inspected.facts.width!==request.recipe.width||inspected.facts.height!==request.recipe.height)return{status:"refused",code:"invalid"};
      if([...this.#eventWriteObservations.values()].some(item=>item.imageEdit?.operationSha256===operationSha256&&this.sourceOwnershipActive(item.source)))return uncertain;
      const admission=await this.#admitEventWrite([{type:"GeneratedImageEdited",payload:{output_id:outputId,object_id:outputId}}],"append");observation=admission.observation;
      if(!admission.admitted){if(!admission.reused)this.#finishEventWrite(observation,{outcome:"not-attempted",privateUnavailable:!owner.active()},[],"none",{silent:true});return uncertain;}
      const snapshot:GeneratedImageWriteObservation={ownerId:owner.ownerId,projectId:owner.projectId,documentId:owner.documentId,outputId,route:owner.route,
        rawJson:basis.rawJson,request,operationSha256,width:basis.media.width,height:basis.media.height,output:structuredClone(this.projection.get().libraryOutputs.find(item=>item.id===outputId)!)};
      observation.imageEdit=snapshot;
      const active=()=>owner.active()&&!observation!.paused&&this.sourceOwnershipActive(observation!.source);
      const current=()=>active()&&this.#generatedImageSourceCurrent(snapshot)&&captured.current()!==null;
      if(!current()){this.#finishEventWrite(observation,{outcome:"not-attempted",privateUnavailable:true},[],"withheld",{silent:true});return{status:"refused",code:"source_changed"};}
      const form=new FormData();form.set("request",JSON.stringify(request));form.set("png",new File([bytes],"edited.png",{type:"image/png"}));
      let dispatched=false;
      const response=await this.#generatedImageHttp("/api/generated-images/"+encodeURIComponent(outputId),{method:"PATCH",body:form},()=>dispatched?active():current(),()=>{dispatched=true;observation!.attempted=true;});
      if(!active())return{status:"refused",code:"source_changed"};
      const body=response.body as Record<string,unknown>|null;
      if(response.ok&&body?.status==="unchanged"&&body.code==="unchanged"&&Object.keys(body).sort().join(",")==="code,status"
        &&request.resultMediaSha256===request.sourceMediaSha256&&current()){
        this.#finishEventWrite(observation,{outcome:"observed",committed:[],rejectedIndices:[],observedHead:null,privateUnavailable:false},[],"none",{silent:true});
        this.releaseEventWriteAcknowledgment(observation.receipt.observationId,observation.receipt.owner);return{status:"unchanged",code:"unchanged"};
      }
      if(!response.ok&&body?.status==="refused"&&["invalid","source_changed","forbidden","unavailable"].includes(String(body.code))){
        this.#finishEventWrite(observation,{outcome:"observed",committed:[],rejectedIndices:[],observedHead:null,privateUnavailable:false},[],"none",{silent:true});
        this.releaseEventWriteAcknowledgment(observation.receipt.observationId,observation.receipt.owner);return{status:"refused",code:body.code as "invalid"|"source_changed"|"forbidden"|"unavailable"};
      }
      const receipt=this.#validateEventWriteBody(body,[{type:"GeneratedImageEdited",payload:{output_id:outputId,object_id:outputId}}],observation);
      const saved=receipt?.complete&&!receipt.rejected.length?await this.#validatedGeneratedImageSave(snapshot,body,receipt.appended):null;
      if(!active()||!saved||!receipt)throw new Error("generated_image_unconfirmed");
      if(saved.stillCurrent&&current()){this.#mergeConfirmed(receipt.appended,receipt.head);this.notify();this.#finishEventWrite(observation,{outcome:"observed",committed:receipt.committed,rejectedIndices:[],observedHead:receipt.head,privateUnavailable:false},receipt.appended,"published",{silent:true});return saved;}
      this.#finishEventWrite(observation,{outcome:"observed",committed:receipt.committed,rejectedIndices:[],observedHead:receipt.head,privateUnavailable:false},[],"none",{silent:true});
      return{...saved,stillCurrent:false};
    }catch{return uncertain;}
    finally{bytes.fill(0);this.#generatedImageWrites.delete(outputId);if(observation?.pending)this.#finishEventWrite(observation,{outcome:observation.attempted?"unconfirmed":"not-attempted",privateUnavailable:!owner.active()},[],owner.active()?"none":"withheld",{silent:true});}
  }

  /** Read-only observation of the exact admitted operation; no second PNG upload. */
  async checkGeneratedImageEdit(outputId:string,operationSha256:string,options:{current?:()=>boolean}={}):Promise<GeneratedImageEditAcknowledgment>{
    const uncertain:GeneratedImageEditAcknowledgment={status:"unconfirmed",code:"unconfirmed"},owner=this.#generatedImageOwner(outputId,options.current);
    const observation=[...this.#eventWriteObservations.values()].find(item=>item.imageEdit?.outputId===outputId&&item.imageEdit.operationSha256===operationSha256);
    if(!observation?.imageEdit||observation.pending||observation.paused||!owner.active()||!this.sourceOwnershipActive(observation.source))return uncertain;
    const snapshot=observation.imageEdit,active=()=>owner.active()&&!observation.paused&&this.sourceOwnershipActive(observation.source);
    observation.pending=true;
    try{
      const response=await this.#generatedImageHttp(`/api/generated-images/${encodeURIComponent(outputId)}?operationSha256=${operationSha256}`,{method:"GET"},active);
      if(!active()||!response.ok)return uncertain;
      const receipt=this.#validateEventWriteBody(response.body,[{type:"GeneratedImageEdited",payload:{output_id:outputId,object_id:outputId}}],observation);
      const saved=receipt?.complete&&!receipt.rejected.length?await this.#validatedGeneratedImageSave(snapshot,response.body,receipt.appended):null;
      if(!active()||!receipt||!saved)return uncertain;
      const currentOutput=this.projection.get().libraryOutputs.find(item=>item.id===outputId);
      const alreadyCurrent=currentOutput?.imageRevision?.editEventId===saved.imageRevision.editEventId&&currentOutput.mediaUrl===saved.imageRevision.media.url
        &&this.content.get()[snapshot.request.contentRef]===snapshot.rawJson;
      const current=saved.stillCurrent&&(this.#generatedImageSourceCurrent(snapshot)||alreadyCurrent);
      if(current){this.#mergeConfirmed(receipt.appended,receipt.head);this.notify();}
      this.#finishEventWrite(observation,{outcome:"observed",committed:receipt.committed,rejectedIndices:[],observedHead:receipt.head,privateUnavailable:false},current?receipt.appended:[],current?"published":"none",{silent:true});
      return{...saved,stillCurrent:current};
    }catch{return uncertain;}
    finally{if(observation.pending)this.#finishEventWrite(observation,{outcome:"unconfirmed",privateUnavailable:!active()},[],active()?"none":"withheld",{silent:true});}
  }

  async #validatedAudioTrimSave(snapshot:AudioTrimObservation,result:{content?:Record<string,string>;revision?:number},appended:CreativeEvent[]):Promise<Extract<AudioTrimEditResult,{status:"saved"}>|null>{
    const input=snapshot.request,raw=result.content?.[snapshot.contentRef],parsed=parseDocumentArtifactContent(raw),audio=parsed?.audio_revision;
    const original=parseDocumentArtifactContent(snapshot.sourceRaw),event=appended.find(value=>value.type==="DocumentArtifactEdited"&&value.payload.artifact_id===snapshot.artifactId);
    if(typeof raw!=="string"||!parsed||!audio||!original||!event||appended.length!==1||!result.content||Object.keys(result.content).length!==1
      ||result.revision!==snapshot.sourceRevision+1||event.payload.revision!==result.revision
      ||event.payload.document_id!==snapshot.documentId||event.payload.project_id!==snapshot.projectId||event.payload.content_ref!==snapshot.contentRef
      ||JSON.stringify({...parsed,audio_revision:undefined})!==JSON.stringify({...original,audio_revision:undefined})
      ||audio.source.url!==snapshot.sourceMediaUrl||audio.source.sha256!==input.audioTrim.sourceMediaSha256||audio.source.revision!==snapshot.sourceRevision
      ||audio.source.contentSha256!==input.expectedContentSha256||audio.source.frameCount!==input.audioTrim.sourceFrameCount
      ||audio.startFrame!==input.audioTrim.startFrame||audio.endFrame!==input.audioTrim.endFrame||audio.media.sha256!==input.audioTrim.resultMediaSha256
      ||audio.operation!==(input.audioTrim.conversion?"client-converted-trim":"trim")||JSON.stringify(audio.conversion)!==JSON.stringify(input.audioTrim.conversion)
      ||JSON.stringify(parseAudioMediaRevision(event.payload.audio_revision))!==JSON.stringify(audio))return null;
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(raw))),byte=>byte.toString(16).padStart(2,"0")).join("");
    if(event.payload.content_sha256!==digest)return null;
    return{status:"saved",code:"saved",revision:result.revision,contentSha256:digest,audioRevision:audio};
  }

  /** Explicit receipt observation only. This action never resubmits or stages a trim. */
  async checkAudioTrimOperation(artifactId:string,input:AudioTrimEditRequest):Promise<AudioTrimEditResult>{
    const unconfirmed:AudioTrimEditResult={status:"unconfirmed",code:"unconfirmed"},retired:AudioTrimEditResult={status:"retired",code:"retired"};
    let request:AudioTrimEditRequest;
    try{request=JSON.parse(JSON.stringify(input)) as AudioTrimEditRequest;}catch{return unconfirmed;}
    const canonical=(value:AudioTrimEditRequest)=>{const result=audioTrimOperationFingerprintInput(value);if(!result)throw new TypeError("audio_trim_invalid_range");return result;};
    let fingerprintInput:string;
    try{fingerprintInput=canonical(request);}catch{return unconfirmed;}
    const observation=[...this.#eventWriteObservations.values()].find(value=>value.audioTrim?.artifactId===artifactId&&canonical(value.audioTrim.request)===fingerprintInput);
    if(!observation?.audioTrim||observation.pending)return unconfirmed;
    const snapshot=observation.audioTrim,source=this.captureSourceOwnership(),authorization=this.#activeAuthorizationScope(),route=this.route.get();
    const current=()=>this.sourceOwnershipActive(source)&&this.sourceOwnershipActive(observation.source)&&!observation.paused&&this.#scopeStillActive(authorization)
      &&this.route.get()===route&&this.projection.get().projectId===snapshot.projectId&&this.content.get()[snapshot.contentRef]===snapshot.sourceRaw
      &&documentArtifactRevision(this.events.get(),artifactId)===snapshot.sourceRevision;
    if(!current())return retired;
    try{
      const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(fingerprintInput))),byte=>byte.toString(16).padStart(2,"0")).join("");
      if(!current())return retired;
      const response=await this.guardedFetch(`/api/artifacts/${encodeURIComponent(artifactId)}?audioTrimOperation=${fingerprint}&expectedRevision=${request.expectedRevision}`,
        {method:"GET",cache:"no-store"},"check an existing Audio save",{current});
      if(!current())return retired;
      const result=await response.json() as {content?:Record<string,string>;revision?:number;error?:string};
      if(!current())return retired;
      if(!response.ok)return response.status===409&&result.error==="artifact_revision_conflict"?{status:"conflict",code:"source_changed"}:unconfirmed;
      const receipt=this.#validateEventWriteBody(result,[{type:"DocumentArtifactEdited",payload:{artifact_id:artifactId}}],observation);
      if(!receipt||!receipt.complete||receipt.rejected.length)return unconfirmed;
      const saved=await this.#validatedAudioTrimSave(snapshot,result,receipt.appended);
      if(!current())return retired;
      if(!saved||receipt.appended[0]?.payload.audio_trim_request_sha256!==fingerprint)return unconfirmed;
      this.content.set({...this.content.get(),...this.#sourceContent(result.content)});
      this.#mergeConfirmed(receipt.appended,receipt.head);
      this.#finishEventWrite(observation,{outcome:"observed",committed:receipt.committed,rejectedIndices:receipt.rejectedIndices,observedHead:receipt.head,privateUnavailable:false},receipt.appended,"published",{silent:true});
      return saved;
    }catch{return current()?unconfirmed:retired;}
  }

  #videoTrimSourceCurrent(snapshot:VideoTrimObservation):boolean{
    const artifact=this.projection.get().libraryArtifacts.find(candidate=>candidate.id===snapshot.artifactId);
    const item=artifact?videoArtifactMediaItem(artifact):null;
    return !this.session.get()?.projectContext && this.route.get()===snapshot.route && this.projection.get().projectId===snapshot.projectId
      && artifact?.kind==="video" && artifact.documentId===snapshot.documentId && artifact.contentRef===snapshot.contentRef
      && artifact.mediaUrl===snapshot.sourceMediaUrl && artifact.mediaType===snapshot.sourceMediaType && artifact.sourceEventId===snapshot.sourceEventId
      && item?.id===snapshot.sourceItemId && item.mediaUrl===snapshot.sourceMediaUrl && item.mediaType===snapshot.sourceMediaType
      && JSON.stringify(artifact.items)===snapshot.sourceItemsRaw && JSON.stringify(artifact.settings)===snapshot.sourceSettingsRaw
      && Object.hasOwn(artifact.settings,"source_media_sha256")===snapshot.sourceHashPresent && artifact.settings.source_media_sha256===snapshot.sourceMediaSha256
      && this.session.get()?.user.userId===snapshot.ownerUserId
      && documentArtifactRevision(this.events.get(),snapshot.artifactId)===snapshot.sourceRevision && this.content.get()[snapshot.contentRef]===snapshot.sourceRaw;
  }

  #videoTrimWrites=new Set<string>();
  /** One owned Video write; an uncertain acknowledgment is observed separately, never retried here. */
  async #reviseVideoDocumentArtifact(artifactId:string,input:VideoTrimEditRequest):Promise<VideoTrimEditResult>{
    if(this.#videoTrimWrites.has(artifactId))return{status:"unconfirmed",code:"unconfirmed"};
    this.#videoTrimWrites.add(artifactId);
    try{return await this.#performVideoDocumentArtifact(artifactId,input);}
    finally{this.#videoTrimWrites.delete(artifactId);}
  }

  async #performVideoDocumentArtifact(artifactId:string,input:VideoTrimEditRequest):Promise<VideoTrimEditResult>{
    const failure=(status:"conflict"|"refused"|"unconfirmed"|"retired",code:"source_changed"|"invalid_range"|"unsupported"|"unavailable"|"access_denied"|"unconfirmed"|"retired")=>
      ({status,code} as VideoTrimEditResult);
    const request=parseVideoTrimEditRequest(input);
    if(!request)return failure("refused","invalid_range");
    const artifact=this.projection.get().libraryArtifacts.find(candidate=>candidate.id===artifactId);
    if(!artifact||artifact.kind!=="video"||this.session.get()?.projectContext)return failure("refused","unsupported");
    const item=videoArtifactMediaItem(artifact),contentRef=artifact.contentRef??"",sourceRaw=this.content.get()[contentRef];
    const draft=parseDocumentArtifactContent(sourceRaw);
    if(!item||!artifact.mediaUrl||!artifact.mediaType||!contentRef||typeof sourceRaw!=="string"||!draft||draft.audio_revision)return failure("refused","unavailable");
    const snapshot:VideoTrimObservation={artifactId,request,contentRef,documentId:artifact.documentId,projectId:this.projection.get().projectId,route:this.route.get(),ownerUserId:this.session.get()?.user.userId??"",
      sourceMediaUrl:artifact.mediaUrl,sourceMediaType:artifact.mediaType,sourceItemId:item.id,sourceItemsRaw:JSON.stringify(artifact.items),
      sourceSettingsRaw:JSON.stringify(artifact.settings),sourceHashPresent:Object.hasOwn(artifact.settings,"source_media_sha256"),sourceMediaSha256:artifact.settings.source_media_sha256,
      sourceEventId:artifact.sourceEventId,sourceRaw,sourceRevision:documentArtifactRevision(this.events.get(),artifactId)};
    const sourceOwner=this.captureSourceOwnership(),authorization=this.#activeAuthorizationScope();
    const current=()=>this.sourceOwnershipActive(sourceOwner)&&this.#scopeStillActive(authorization)&&this.#videoTrimSourceCurrent(snapshot);
    if(!current())return failure("retired","retired");
    let sourceDigest:string;
    try{sourceDigest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(sourceRaw))),byte=>byte.toString(16).padStart(2,"0")).join("");}
    catch{return current()?failure("unconfirmed","unconfirmed"):failure("retired","retired");}
    if(!current())return failure("retired","retired");
    if(snapshot.sourceRevision!==request.expectedRevision||sourceDigest!==request.expectedContentSha256
      ||snapshot.sourceHashPresent&&snapshot.sourceMediaSha256!==request.videoTrim.sourceMediaSha256)return failure("conflict","source_changed");
    if(draft.video_revision&&(draft.video_revision.media.url!==snapshot.sourceMediaUrl||draft.video_revision.media.mediaType!==snapshot.sourceMediaType
      ||draft.video_revision.source.itemId!==snapshot.sourceItemId||draft.video_revision.media.sha256!==request.videoTrim.sourceMediaSha256))return failure("conflict","source_changed");
    if([...this.#eventWriteObservations.values()].some(value=>value.videoTrim?.artifactId===artifactId&&this.sourceOwnershipActive(value.source)
      &&JSON.stringify(value.videoTrim.request)===JSON.stringify(request)))return failure("unconfirmed","unconfirmed");
    const unchanged=request.videoTrim.endSample===request.videoTrim.sourceSampleCount&&request.videoTrim.resultMediaSha256===request.videoTrim.sourceMediaSha256;
    const admission=await this.#admitEventWrite([{type:"DocumentArtifactEdited",payload:{artifact_id:artifactId}}],"append"),observation=admission.observation;
    if(!admission.admitted){
      if(!admission.reused)this.#finishEventWrite(observation,{outcome:"not-attempted",privateUnavailable:!current()},[],current()?"none":"withheld",{silent:true});
      return current()?failure("unconfirmed","unconfirmed"):failure("retired","retired");
    }
    observation.videoTrim=snapshot;
    const owned=()=>current()&&this.sourceOwnershipActive(observation.source)&&!observation.paused;
    const edit=async():Promise<VideoTrimEditResult>=>{
      if(!owned()){
        this.#finishEventWrite(observation,{outcome:"not-attempted",privateUnavailable:true},[],"withheld");
        return failure("retired","retired");
      }
      this.busy.set("DocumentArtifactEdited");this.notify();let dispatched=false;observation.attempted=true;
      try{
        const response=await this.guardedFetch("/api/artifacts/"+encodeURIComponent(artifactId),
          {method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify(request)},"save a correction to this finished output",
          {current:()=>dispatched||owned(),onDispatch:()=>{dispatched=true;}});
        this.#assertAuthorizationScope(authorization);
        const result=await response.json() as {appended?:CreativeEvent[];content?:Record<string,string>;head?:number;revision?:number;error?:string};
        this.#assertAuthorizationScope(authorization);
        if(!response.ok){
          const refused:VideoTrimEditResult|null=response.status===409&&["artifact_revision_conflict","video_trim_source_changed"].includes(result.error??"")?failure("conflict","source_changed")
            :response.status===400&&result.error==="video_trim_invalid_range"?failure("refused","invalid_range")
            :response.status===400&&result.error==="video_trim_unsupported"?failure("refused","unsupported")
            :response.status===400&&["invalid_artifact_revision","artifact_revision_too_large"].includes(result.error??"")?failure("refused","unavailable")
            :response.status===404?failure("refused","unavailable")
            :response.status===401||response.status===403?failure("refused","access_denied"):null;
          if(refused){
            const active=owned();
            this.#finishEventWrite(observation,{outcome:"observed",committed:[],rejectedIndices:[],observedHead:null,privateUnavailable:!active},[],active?"none":"withheld",{silent:true});
            this.releaseEventWriteAcknowledgment(observation.receipt.observationId,observation.receipt.owner);
            return active?refused:failure("retired","retired");
          }
          throw new Error("video_trim_unconfirmed");
        }
        const noChange=response.status===200&&unchanged&&result&&typeof result==="object"&&!Array.isArray(result)
          &&Object.keys(result).sort().join(",")==="appended,content,revision"
          &&Array.isArray(result.appended)&&result.appended.length===0&&result.revision===request.expectedRevision
          &&result.content&&typeof result.content==="object"&&!Array.isArray(result.content)
          &&Object.keys(result.content).length===1&&Object.hasOwn(result.content,contentRef)&&result.content[contentRef]===sourceRaw&&owned();
        if(noChange){
          this.#finishEventWrite(observation,{outcome:"observed",committed:[],rejectedIndices:[],observedHead:null,privateUnavailable:false},[],"none",{silent:true});
          this.releaseEventWriteAcknowledgment(observation.receipt.observationId,observation.receipt.owner);
          return{status:"unchanged",code:"unchanged"};
        }
        const receipt=this.#validateEventWriteBody(result,[{type:"DocumentArtifactEdited",payload:{artifact_id:artifactId}}],observation);
        if(!receipt||!receipt.committed.some(event=>event.type==="DocumentArtifactEdited"))throw new Error("video_trim_unconfirmed");
        const saved=await this.#validatedVideoTrimSave(snapshot,result,receipt.appended);
        if(!saved)throw new Error("video_trim_unconfirmed");
        const active=owned(),patch:Partial<EventWriteAcknowledgment>={committed:receipt.committed,rejectedIndices:receipt.rejectedIndices,observedHead:receipt.head,
          outcome:receipt.complete?"observed":"unconfirmed",privateUnavailable:!active};
        if(!active){this.#finishEventWrite(observation,patch,[],"withheld");return failure("retired","retired");}
        if(!receipt.complete||receipt.rejected.length){this.#finishEventWrite(observation,patch,[],"none",{silent:true});return failure("unconfirmed","unconfirmed");}
        this.content.set({...this.content.get(),...this.#sourceContent(result.content)});
        this.#mergeConfirmed(receipt.appended,receipt.head);
        this.#finishEventWrite(observation,patch,receipt.appended,"published",{silent:true});
        return saved;
      }catch(error){
        if(!dispatched&&error instanceof Error&&error.message==="scene_cost_changed")observation.attempted=false;
        const active=owned();
        this.#finishEventWrite(observation,{outcome:observation.attempted?"unconfirmed":"not-attempted",privateUnavailable:!active},[],active?"none":"withheld",{silent:true});
        return active?failure("unconfirmed","unconfirmed"):failure("retired","retired");
      }finally{if(this.sourceOwnershipScopeActive(sourceOwner)){this.busy.set("");this.notify();}}
    };
    const pending=this.#appendPipeline.then(edit,edit);this.#appendPipeline=pending.then(()=>undefined,()=>undefined);return pending;
  }

  async #validatedVideoTrimSave(snapshot:VideoTrimObservation,result:{content?:Record<string,string>;revision?:number},appended:CreativeEvent[]):Promise<Extract<VideoTrimEditResult,{status:"saved"}>|null>{
    const input=snapshot.request,raw=result.content?.[snapshot.contentRef],parsed=parseDocumentArtifactContent(raw),video=parsed?.video_revision;
    const original=parseDocumentArtifactContent(snapshot.sourceRaw),event=appended.find(value=>value.type==="DocumentArtifactEdited"&&value.payload.artifact_id===snapshot.artifactId);
    if(typeof raw!=="string"||!parsed||!video||!original||!event||appended.length!==1||!result.content||Array.isArray(result.content)||Object.keys(result.content).length!==1
      ||!Object.hasOwn(result.content,snapshot.contentRef)||result.revision!==snapshot.sourceRevision+1||event.payload.revision!==result.revision
      ||event.payload.artifact_kind!=="video"||event.payload.document_id!==snapshot.documentId||event.payload.project_id!==snapshot.projectId||event.payload.content_ref!==snapshot.contentRef
      ||event.payload.source_surface!=="document-artifact-video-trim"||JSON.stringify(event.payload.changed_fields)!==JSON.stringify(["video_revision"])
      ||event.payload.edited_by_user_id!==snapshot.ownerUserId
      ||video.source.url!==snapshot.sourceMediaUrl||video.source.itemId!==snapshot.sourceItemId||video.source.sha256!==input.videoTrim.sourceMediaSha256
      ||video.source.revision!==snapshot.sourceRevision||video.source.contentSha256!==input.expectedContentSha256||video.source.sampleCount!==input.videoTrim.sourceSampleCount
      ||video.startSample!==input.videoTrim.startSample||video.endSample!==input.videoTrim.endSample||video.media.sha256!==input.videoTrim.resultMediaSha256
      ||JSON.stringify(parseVideoMediaRevision(event.payload.video_revision))!==JSON.stringify(video))return null;
    const unchangedRawFields=(value:string):string|null=>{
      try{
        const object:unknown=JSON.parse(value);
        if(!object||typeof object!=="object"||Array.isArray(object))return null;
        const fields={...object as Record<string,unknown>};delete fields.video_revision;
        return JSON.stringify(fields);
      }catch{return null;}
    };
    const sourceFields=unchangedRawFields(snapshot.sourceRaw);
    if(sourceFields===null||sourceFields!==unchangedRawFields(raw))return null;
    let mediaKey:string;
    try{mediaKey=decodeURIComponent(video.media.url.slice("/api/media/".length));}catch{return null;}
    const mediaPrefix=`${ownerMediaNamespace(snapshot.ownerUserId)}/generated/`;
    if(!mediaKey.startsWith(mediaPrefix)||!/^video-trim-[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.mp4$/u.test(mediaKey.slice(mediaPrefix.length)))return null;
    const digest=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,"0")).join("");
    const [contentSha256,fingerprint]=await Promise.all([digest(raw),digest(JSON.stringify(input))]);
    if(event.payload.content_sha256!==contentSha256||event.payload.video_trim_request_sha256!==fingerprint)return null;
    return{status:"saved",code:"saved",revision:result.revision,contentSha256,videoRevision:video};
  }

  /** Explicit observation of the same original Video operation; this method issues only a GET. */
  async checkVideoTrimOperation(artifactId:string,input:VideoTrimEditRequest):Promise<VideoTrimEditResult>{
    const unconfirmed:VideoTrimEditResult={status:"unconfirmed",code:"unconfirmed"},retired:VideoTrimEditResult={status:"retired",code:"retired"};
    const request=parseVideoTrimEditRequest(input);
    if(!request)return unconfirmed;
    const fingerprintInput=JSON.stringify(request);
    const observation=[...this.#eventWriteObservations.values()].find(value=>value.videoTrim?.artifactId===artifactId&&JSON.stringify(value.videoTrim.request)===fingerprintInput);
    if(!observation?.videoTrim||observation.pending)return unconfirmed;
    const snapshot=observation.videoTrim,source=this.captureSourceOwnership(),authorization=this.#activeAuthorizationScope();
    const current=()=>this.sourceOwnershipActive(source)&&this.sourceOwnershipActive(observation.source)&&!observation.paused
      &&this.#scopeStillActive(authorization)&&this.#videoTrimSourceCurrent(snapshot);
    if(!current())return retired;
    try{
      const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(fingerprintInput))),byte=>byte.toString(16).padStart(2,"0")).join("");
      if(!current())return retired;
      const response=await this.guardedFetch(`/api/artifacts/${encodeURIComponent(artifactId)}?videoTrimOperation=${fingerprint}&expectedRevision=${request.expectedRevision}`,
        {method:"GET",cache:"no-store"},"check an existing Video save",{current});
      if(!current())return retired;
      const result=await response.json() as {content?:Record<string,string>;revision?:number;error?:string};
      if(!current())return retired;
      if(!response.ok)return response.status===409&&result.error==="artifact_revision_conflict"?{status:"conflict",code:"source_changed"}:unconfirmed;
      const receipt=this.#validateEventWriteBody(result,[{type:"DocumentArtifactEdited",payload:{artifact_id:artifactId}}],observation);
      if(!receipt||!receipt.complete||receipt.rejected.length)return unconfirmed;
      const saved=await this.#validatedVideoTrimSave(snapshot,result,receipt.appended);
      if(!current())return retired;
      if(!saved||receipt.appended[0]?.payload.video_trim_request_sha256!==fingerprint)return unconfirmed;
      this.content.set({...this.content.get(),...this.#sourceContent(result.content)});
      this.#mergeConfirmed(receipt.appended,receipt.head);
      this.#finishEventWrite(observation,{outcome:"observed",committed:receipt.committed,rejectedIndices:receipt.rejectedIndices,observedHead:receipt.head,privateUnavailable:false},receipt.appended,"published",{silent:true});
      return saved;
    }catch{return current()?unconfirmed:retired;}
  }

  #model3dScaleSourceCurrent(snapshot:Model3dScaleObservation):boolean{
    const artifact=this.projection.get().libraryArtifacts.find(candidate=>candidate.id===snapshot.artifactId);
    const file=artifact?model3dArtifactMediaFile(artifact):null;
    return !this.session.get()?.projectContext && this.route.get()===snapshot.route && this.projection.get().projectId===snapshot.projectId
      && artifact?.kind==="model3d" && artifact.documentId===snapshot.documentId && artifact.contentRef===snapshot.contentRef
      && artifact.sourceEventId===snapshot.sourceEventId && artifact.mediaUrl===snapshot.sourceRootMediaUrl && artifact.mediaType===snapshot.sourceRootMediaType
      && file?.url===snapshot.sourceMediaUrl && file.sha256===snapshot.sourceMediaSha256 && file.fileSize===snapshot.sourceMediaByteLength
      && JSON.stringify(file)===snapshot.sourceFileRaw && JSON.stringify(artifact.items)===snapshot.sourceItemsRaw
      && JSON.stringify(artifact.settings)===snapshot.sourceSettingsRaw && this.session.get()?.user.userId===snapshot.ownerUserId
      && documentArtifactRevision(this.events.get(),snapshot.artifactId)===snapshot.sourceRevision && this.content.get()[snapshot.contentRef]===snapshot.sourceRaw;
  }

  /** The one-megabyte raw revision may expand when nested as a JSON string in its ACK. */
  async #model3dScaleResponse(input:string,init:RequestInit,action:string,controls:{current:()=>boolean;onDispatch?:()=>void}):Promise<{
    response:Response;result:{appended?:CreativeEvent[];content?:Record<string,string>;head?:number;revision?:number;error?:string}
  }>{
    const controller=new AbortController(),deadline=Date.now()+90_000,maxBytes=8*1024*1024;
    let closed=false,dispatched=false,stop!:(error:Error)=>void;
    const current=()=>!closed&&!controller.signal.aborted&&Date.now()<deadline&&controls.current();
    const check=()=>{if(!current())throw new Error("model3d_scale_unconfirmed");};
    const stopped=new Promise<never>((_resolve,reject)=>{stop=reject;});void stopped.catch(()=>undefined);
    const timer=setTimeout(()=>{closed=true;stop(new Error("model3d_scale_unconfirmed"));controller.abort();},90_000);
    const settle=<T>(operation:Promise<T>)=>Promise.race([operation,stopped]);
    const cancel=(operation:(()=>Promise<unknown>)|undefined)=>{
      // A stalled cancellation or a late response cannot prolong the operation
      // or publish a receipt after this exact request has become unconfirmed.
      try{if(operation)void operation().catch(()=>undefined);}catch{/* Already released. */}
    };
    let response:Response|undefined,reader:ReadableStreamDefaultReader<Uint8Array>|undefined,complete=false;
    try{
      check();
      const request=this.guardedFetch(input,{...init,signal:controller.signal,redirect:"error",cache:"no-store"},action,
        {current:()=>dispatched||current(),onDispatch:()=>{dispatched=true;controls.onDispatch?.();}});
      void request.then(late=>{if(!current())cancel(late.body?()=>late.body!.cancel():undefined);},()=>undefined).catch(()=>undefined);
      response=await settle(request);check();
      if(response.redirected||response.headers.get("content-type")?.split(";",1)[0]?.trim().toLowerCase()!=="application/json")
        throw new Error("model3d_scale_unconfirmed");
      const header=response.headers.get("content-length"),encoding=response.headers.get("content-encoding");
      const identity=encoding===null||encoding.trim().toLowerCase()==="identity";
      if(header!==null&&(!/^(0|[1-9]\d*)$/u.test(header)||!Number.isSafeInteger(Number(header))
        ||identity&&(Number(header)<1||Number(header)>maxBytes)))throw new Error("model3d_scale_unconfirmed");
      reader=response.body?.getReader();if(!reader)throw new Error("model3d_scale_unconfirmed");
      const bytes=new Uint8Array(maxBytes);let size=0,chunks=0;
      for(;;){
        check();const part=await settle(reader.read());check();
        if(part.done)break;
        if(++chunks>65_536||!(part.value instanceof Uint8Array)||!part.value.byteLength||size+part.value.byteLength>maxBytes)
          throw new Error("model3d_scale_unconfirmed");
        bytes.set(part.value,size);size+=part.value.byteLength;
      }
      complete=true;
      if(!size||identity&&header!==null&&size!==Number(header))throw new Error("model3d_scale_unconfirmed");
      const result:unknown=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes.subarray(0,size)));
      check();
      if(!result||typeof result!=="object"||Array.isArray(result))throw new Error("model3d_scale_unconfirmed");
      return{response,result};
    }finally{
      closed=true;clearTimeout(timer);controller.abort();
      if(!complete)cancel(reader?()=>reader!.cancel():response?.body?()=>response!.body!.cancel():undefined);
      try{reader?.releaseLock();}catch{/* A late pending read owns no Store publication. */}
    }
  }

  #model3dScaleWrites=new Set<string>();
  /** One owned Model3D write; an uncertain acknowledgment is observed separately, never retried here. */
  async #reviseModel3dDocumentArtifact(artifactId:string,input:Model3dScaleEditRequest):Promise<Model3dScaleEditResult>{
    if(this.#model3dScaleWrites.has(artifactId))return{status:"unconfirmed",code:"unconfirmed"};
    this.#model3dScaleWrites.add(artifactId);
    try{return await this.#performModel3dDocumentArtifact(artifactId,input);}
    finally{this.#model3dScaleWrites.delete(artifactId);}
  }

  async #performModel3dDocumentArtifact(artifactId:string,input:Model3dScaleEditRequest):Promise<Model3dScaleEditResult>{
    const failure=(status:"conflict"|"refused"|"unconfirmed"|"retired",code:"source_changed"|"invalid_scale"|"unsupported"|"unavailable"|"access_denied"|"unconfirmed"|"retired")=>
      ({status,code} as Model3dScaleEditResult);
    const request=parseModel3dScaleEditRequest(input);
    if(!request)return failure("refused","invalid_scale");
    const artifact=this.projection.get().libraryArtifacts.find(candidate=>candidate.id===artifactId);
    if(!artifact||artifact.kind!=="model3d"||this.session.get()?.projectContext)return failure("refused","unsupported");
    const file=model3dArtifactMediaFile(artifact),contentRef=artifact.contentRef??"",sourceRaw=this.content.get()[contentRef];
    const draft=parseDocumentArtifactContent(sourceRaw),ownerUserId=this.session.get()?.user.userId??"";
    if(!file||file.mimeType!=="model/gltf-binary"||typeof file.sha256!=="string"||!/^[a-f0-9]{64}$/u.test(file.sha256)
      ||typeof file.fileSize!=="number"||!Number.isSafeInteger(file.fileSize)||file.fileSize<1||file.fileSize>MAX_MODEL3D_UPLOAD_BYTES
      ||!contentRef||typeof sourceRaw!=="string"||!draft||draft.audio_revision||draft.video_revision||!ownerUserId)return failure("refused","unavailable");
    let sourceKey:string;
    try{sourceKey=decodeURIComponent(file.url.slice("/api/media/".length));}catch{return failure("refused","unavailable");}
    if(file.url!==`/api/media/${encodeURIComponent(sourceKey)}`||!sourceKey.startsWith(`${ownerMediaNamespace(ownerUserId)}/generated/`)
      ||!sourceKey.endsWith(".glb")||/[\p{Cc}\\]/u.test(sourceKey)||sourceKey.split("/").some(part=>part==="."||part===".."))return failure("refused","unavailable");
    const snapshot:Model3dScaleObservation={artifactId,request,contentRef,documentId:artifact.documentId,projectId:this.projection.get().projectId,
      route:this.route.get(),ownerUserId,sourceMediaUrl:file.url,sourceMediaSha256:file.sha256,sourceMediaByteLength:file.fileSize,
      sourceFileRaw:JSON.stringify(file),sourceRootMediaUrl:artifact.mediaUrl,sourceRootMediaType:artifact.mediaType,
      sourceItemsRaw:JSON.stringify(artifact.items),sourceSettingsRaw:JSON.stringify(artifact.settings),
      sourceEventId:artifact.sourceEventId,sourceRaw,sourceRevision:documentArtifactRevision(this.events.get(),artifactId)};
    const sourceOwner=this.captureSourceOwnership(),authorization=this.#activeAuthorizationScope();
    const current=()=>this.sourceOwnershipActive(sourceOwner)&&this.#scopeStillActive(authorization)&&this.#model3dScaleSourceCurrent(snapshot);
    if(!current())return failure("retired","retired");
    let sourceDigest:string;
    try{sourceDigest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(sourceRaw))),byte=>byte.toString(16).padStart(2,"0")).join("");}
    catch{return current()?failure("unconfirmed","unconfirmed"):failure("retired","retired");}
    if(!current())return failure("retired","retired");
    if(snapshot.sourceRevision!==request.expectedRevision||sourceDigest!==request.expectedContentSha256
      ||snapshot.sourceMediaSha256!==request.model3dScale.sourceMediaSha256)return failure("conflict","source_changed");
    if(draft.model3d_revision&&(draft.model3d_revision.media.url!==snapshot.sourceMediaUrl
      ||draft.model3d_revision.media.byteLength!==snapshot.sourceMediaByteLength
      ||draft.model3d_revision.media.sha256!==snapshot.sourceMediaSha256))return failure("conflict","source_changed");
    if([...this.#eventWriteObservations.values()].some(value=>value.model3dScale?.artifactId===artifactId&&this.sourceOwnershipActive(value.source)
      &&JSON.stringify(value.model3dScale.request)===JSON.stringify(request)))return failure("unconfirmed","unconfirmed");
    const admission=await this.#admitEventWrite([{type:"DocumentArtifactEdited",payload:{artifact_id:artifactId}}],"append"),observation=admission.observation;
    if(!admission.admitted){
      if(!admission.reused)this.#finishEventWrite(observation,{outcome:"not-attempted",privateUnavailable:!current()},[],current()?"none":"withheld",{silent:true});
      return current()?failure("unconfirmed","unconfirmed"):failure("retired","retired");
    }
    observation.model3dScale=snapshot;
    const owned=()=>current()&&this.sourceOwnershipActive(observation.source)&&!observation.paused;
    const edit=async():Promise<Model3dScaleEditResult>=>{
      if(!owned()){
        this.#finishEventWrite(observation,{outcome:"not-attempted",privateUnavailable:true},[],"withheld");
        return failure("retired","retired");
      }
      this.busy.set("DocumentArtifactEdited");this.notify();let dispatched=false;observation.attempted=true;
      try{
        const {response,result}=await this.#model3dScaleResponse("/api/artifacts/"+encodeURIComponent(artifactId),
          {method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify(request)},"save a correction to this finished output",
          {current:()=>dispatched||owned(),onDispatch:()=>{dispatched=true;}});
        this.#assertAuthorizationScope(authorization);
        if(!response.ok){
          const refused:Model3dScaleEditResult|null=response.status===409&&["artifact_revision_conflict","model3d_scale_source_changed"].includes(result.error??"")?failure("conflict","source_changed")
            :response.status===400&&result.error==="model3d_scale_invalid_scale"?failure("refused","invalid_scale")
            :response.status===400&&result.error==="model3d_scale_unsupported"?failure("refused","unsupported")
            :response.status===400&&["invalid_artifact_revision","artifact_revision_too_large"].includes(result.error??"")?failure("refused","unavailable")
            :response.status===404?failure("refused","unavailable")
            :response.status===401||response.status===403?failure("refused","access_denied"):null;
          if(refused){
            const active=owned();
            this.#finishEventWrite(observation,{outcome:"observed",committed:[],rejectedIndices:[],observedHead:null,privateUnavailable:!active},[],active?"none":"withheld",{silent:true});
            this.releaseEventWriteAcknowledgment(observation.receipt.observationId,observation.receipt.owner);
            return active?refused:failure("retired","retired");
          }
          throw new Error("model3d_scale_unconfirmed");
        }
        const receipt=this.#validateEventWriteBody(result,[{type:"DocumentArtifactEdited",payload:{artifact_id:artifactId}}],observation);
        if(!receipt||!receipt.committed.some(event=>event.type==="DocumentArtifactEdited"))throw new Error("model3d_scale_unconfirmed");
        const saved=await this.#validatedModel3dScaleSave(snapshot,result,receipt.appended);
        if(!saved)throw new Error("model3d_scale_unconfirmed");
        const active=owned(),patch:Partial<EventWriteAcknowledgment>={committed:receipt.committed,rejectedIndices:receipt.rejectedIndices,observedHead:receipt.head,
          outcome:receipt.complete?"observed":"unconfirmed",privateUnavailable:!active};
        if(!active){this.#finishEventWrite(observation,patch,[],"withheld");return failure("retired","retired");}
        if(!receipt.complete||receipt.rejected.length){this.#finishEventWrite(observation,patch,[],"none",{silent:true});return failure("unconfirmed","unconfirmed");}
        this.content.set({...this.content.get(),...this.#sourceContent(result.content)});
        this.#mergeConfirmed(receipt.appended,receipt.head);
        this.#finishEventWrite(observation,patch,receipt.appended,"published",{silent:true});
        return saved;
      }catch(error){
        if(!dispatched&&error instanceof Error&&error.message==="scene_cost_changed")observation.attempted=false;
        const active=owned();
        this.#finishEventWrite(observation,{outcome:observation.attempted?"unconfirmed":"not-attempted",privateUnavailable:!active},[],active?"none":"withheld",{silent:true});
        return active?failure("unconfirmed","unconfirmed"):failure("retired","retired");
      }finally{if(this.sourceOwnershipScopeActive(sourceOwner)){this.busy.set("");this.notify();}}
    };
    const pending=this.#appendPipeline.then(edit,edit);this.#appendPipeline=pending.then(()=>undefined,()=>undefined);return pending;
  }

  async #validatedModel3dScaleSave(snapshot:Model3dScaleObservation,result:{content?:Record<string,string>;revision?:number},appended:CreativeEvent[]):Promise<Extract<Model3dScaleEditResult,{status:"saved"}>|null>{
    const input=snapshot.request,raw=result.content?.[snapshot.contentRef],parsed=parseDocumentArtifactContent(raw),model=parsed?.model3d_revision;
    const original=parseDocumentArtifactContent(snapshot.sourceRaw),event=appended.find(value=>value.type==="DocumentArtifactEdited"&&value.payload.artifact_id===snapshot.artifactId);
    if(typeof raw!=="string"||!parsed||!model||!original||parsed.audio_revision||parsed.video_revision||!event||appended.length!==1
      ||!result.content||Array.isArray(result.content)||Object.keys(result.content).length!==1||!Object.hasOwn(result.content,snapshot.contentRef)
      ||result.revision!==snapshot.sourceRevision+1||event.payload.revision!==result.revision
      ||event.payload.artifact_kind!=="model3d"||event.payload.document_id!==snapshot.documentId||event.payload.project_id!==snapshot.projectId||event.payload.content_ref!==snapshot.contentRef
      ||event.payload.source_surface!=="document-artifact-model3d-scale"||JSON.stringify(event.payload.changed_fields)!==JSON.stringify(["model3d_revision"])
      ||event.payload.edited_by_user_id!==snapshot.ownerUserId||model.source.url!==snapshot.sourceMediaUrl
      ||model.source.sha256!==input.model3dScale.sourceMediaSha256||model.source.byteLength!==snapshot.sourceMediaByteLength
      ||model.source.revision!==snapshot.sourceRevision||model.source.contentSha256!==input.expectedContentSha256
      ||model.factor!==input.model3dScale.factor||model.media.sha256!==input.model3dScale.resultMediaSha256||model.media.fileName!=="scaled-model.glb"
      ||JSON.stringify(parseModel3dMediaRevision(event.payload.model3d_revision))!==JSON.stringify(model))return null;
    if(original.model3d_revision&&(JSON.stringify(original.model3d_revision.afterBounds)!==JSON.stringify(model.beforeBounds)
      ||original.model3d_revision.vertexCount!==model.vertexCount||original.model3d_revision.positionAccessorCount!==model.positionAccessorCount))return null;
    const unchangedRawFields=(value:string):string|null=>{
      try{
        const object:unknown=JSON.parse(value);
        if(!object||typeof object!=="object"||Array.isArray(object))return null;
        const fields={...object as Record<string,unknown>};delete fields.model3d_revision;
        return JSON.stringify(fields);
      }catch{return null;}
    };
    const sourceFields=unchangedRawFields(snapshot.sourceRaw);
    if(sourceFields===null||sourceFields!==unchangedRawFields(raw))return null;
    let mediaKey:string;
    try{mediaKey=decodeURIComponent(model.media.url.slice("/api/media/".length));}catch{return null;}
    const mediaPrefix=`${ownerMediaNamespace(snapshot.ownerUserId)}/generated/`;
    if(!mediaKey.startsWith(mediaPrefix)||!/^model3d-scale-[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.glb$/u.test(mediaKey.slice(mediaPrefix.length)))return null;
    const digest=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,"0")).join("");
    const [contentSha256,fingerprint]=await Promise.all([digest(raw),digest(JSON.stringify(input))]);
    if(event.payload.content_sha256!==contentSha256||event.payload.model3d_scale_request_sha256!==fingerprint)return null;
    return{status:"saved",code:"saved",revision:result.revision,contentSha256,model3dRevision:model};
  }

  /** Explicit observation of the same original Model3D operation; this method issues only a GET. */
  async checkModel3dScaleOperation(artifactId:string,input:Model3dScaleEditRequest):Promise<Model3dScaleEditResult>{
    const unconfirmed:Model3dScaleEditResult={status:"unconfirmed",code:"unconfirmed"},retired:Model3dScaleEditResult={status:"retired",code:"retired"};
    const request=parseModel3dScaleEditRequest(input);
    if(!request)return unconfirmed;
    const fingerprintInput=JSON.stringify(request);
    const observation=[...this.#eventWriteObservations.values()].find(value=>value.model3dScale?.artifactId===artifactId&&JSON.stringify(value.model3dScale.request)===fingerprintInput);
    if(!observation?.model3dScale||observation.pending)return unconfirmed;
    const snapshot=observation.model3dScale,source=this.captureSourceOwnership(),authorization=this.#activeAuthorizationScope();
    const current=()=>this.sourceOwnershipActive(source)&&this.sourceOwnershipActive(observation.source)&&!observation.paused
      &&this.#scopeStillActive(authorization)&&this.#model3dScaleSourceCurrent(snapshot);
    if(!current())return retired;
    try{
      const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(fingerprintInput))),byte=>byte.toString(16).padStart(2,"0")).join("");
      if(!current())return retired;
      const {response,result}=await this.#model3dScaleResponse(`/api/artifacts/${encodeURIComponent(artifactId)}?model3dScaleOperation=${fingerprint}&expectedRevision=${request.expectedRevision}`,
        {method:"GET",cache:"no-store"},"check an existing Model3D save",{current});
      if(!current())return retired;
      if(!response.ok)return response.status===409&&result.error==="artifact_revision_conflict"?{status:"conflict",code:"source_changed"}:unconfirmed;
      const receipt=this.#validateEventWriteBody(result,[{type:"DocumentArtifactEdited",payload:{artifact_id:artifactId}}],observation);
      if(!receipt||!receipt.complete||receipt.rejected.length)return unconfirmed;
      const saved=await this.#validatedModel3dScaleSave(snapshot,result,receipt.appended);
      if(!current())return retired;
      if(!saved||receipt.appended[0]?.payload.model3d_scale_request_sha256!==fingerprint)return unconfirmed;
      this.content.set({...this.content.get(),...this.#sourceContent(result.content)});
      this.#mergeConfirmed(receipt.appended,receipt.head);
      this.#finishEventWrite(observation,{outcome:"observed",committed:receipt.committed,rejectedIndices:receipt.rejectedIndices,observedHead:receipt.head,privateUnavailable:false},receipt.appended,"published",{silent:true});
      return saved;
    }catch{return current()?unconfirmed:retired;}
  }

  /** Revision bodies stay off the general content hydration path and follow the exact current authorization scope. */
  async artifactRevisions(artifactId:string,before?:number){
    const sourceOwner=this.captureSourceOwnership();this.#assertSourceOwnership(sourceOwner);
    const authorization=this.#activeAuthorizationScope();
    try{
      const response=await this.guardedFetch(`/api/artifacts/${encodeURIComponent(artifactId)}/revisions${before===undefined?"":`?before=${before}`}`,{},"inspect finished-output history");
      this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);
      const result=await response.json() as {revisions?:ArtifactRevisionSummary[];currentRevision?:number;nextBefore?:number|null;error?:string};
      this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);
      if(!response.ok)throw new Error(result.error??"The finished-output history could not be loaded.");
      return{revisions:result.revisions??[],currentRevision:Number(result.currentRevision??0),nextBefore:result.nextBefore??null};
    }catch(error){if(this.sourceOwnershipActive(sourceOwner)&&this.#scopeStillActive(authorization))this.toast(error instanceof Error?error.message:"The finished-output history could not be loaded.");return null;}
  }

  async artifactRevision(artifactId:string,revision:number){
    const sourceOwner=this.captureSourceOwnership();this.#assertSourceOwnership(sourceOwner);
    const authorization=this.#activeAuthorizationScope();
    try{
      const response=await this.guardedFetch(`/api/artifacts/${encodeURIComponent(artifactId)}/revisions/${revision}`,{},"inspect a finished-output revision");
      this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);
      const result=await response.json() as ArtifactRevisionDetail&{error?:string};
      this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);
      if(!response.ok)throw new Error(result.error??"This finished-output revision is unavailable.");
      return result;
    }catch(error){if(this.sourceOwnershipActive(sourceOwner)&&this.#scopeStillActive(authorization))this.toast(error instanceof Error?error.message:"This finished-output revision is unavailable.");return null;}
  }

  /** Restoration creates a fresh output revision; previous approval must be independently renewed. */
  async restoreDocumentArtifact(artifactId:string,revision:number,expectedRevision:number){
    const sourceOwner=this.captureSourceOwnership(),authorization=this.#activeAuthorizationScope();
    const admission=await this.#admitEventWrite([{type:"DocumentArtifactEdited",payload:{artifact_id:artifactId}}],"append"),observation=admission.observation;
    if(!admission.admitted){if(!admission.reused)this.#finishEventWrite(observation,{outcome:"not-attempted",privateUnavailable:!this.sourceOwnershipActive(sourceOwner)},[],this.sourceOwnershipActive(sourceOwner)?"none":"withheld",{silent:true});return false;}
    const restore=async()=>{
      if(!this.sourceOwnershipActive(sourceOwner)){this.#finishEventWrite(observation,{outcome:"not-attempted",privateUnavailable:true},[],"withheld");return false;}
      this.busy.set("DocumentArtifactEdited");this.notify();let dispatched=false;observation.attempted=true;
      try{
        const response=await this.guardedFetch("/api/artifacts/"+encodeURIComponent(artifactId)+"/revisions/"+revision+"/restore",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({expectedRevision})},"restore an earlier finished output",
          {current:()=>dispatched||this.sourceOwnershipActive(sourceOwner),onDispatch:()=>{dispatched=true;}});
        this.#assertAuthorizationScope(authorization);
        const result=await response.json() as {appended?:CreativeEvent[];content?:Record<string,string>;head?:number;error?:string;message?:string};
        this.#assertAuthorizationScope(authorization);
        if(!response.ok)throw new Error(result.error==="artifact_revision_conflict"?"Another collaborator changed this output. Reopen its latest history before restoring.":result.message??result.error??"The earlier finished output could not be restored.");
        const receipt=this.#validateEventWriteBody(result,[{type:"DocumentArtifactEdited",payload:{artifact_id:artifactId}}],observation);
        if(!receipt||!receipt.committed.some(event=>event.type==="DocumentArtifactEdited"))throw new Error("The original finished-output change is unconfirmed. It has not been repeated.");
        const current=this.sourceOwnershipActive(sourceOwner)&&!observation.paused;
        const patch:Partial<EventWriteAcknowledgment>={committed:receipt.committed,rejectedIndices:receipt.rejectedIndices,observedHead:receipt.head,
          outcome:receipt.complete?"observed":"unconfirmed",privateUnavailable:!current};
        if(!current){this.#finishEventWrite(observation,patch,[],"withheld");return false;}
        if(!receipt.complete||receipt.rejected.length){this.#finishEventWrite(observation,patch,[],"none",{silent:true});this.toast(this.#systemNotice("The original finished-output change is only partly acknowledged. It has not been repeated."));return false;}
        if(result.content)this.content.set({...this.content.get(),...this.#sourceContent(result.content)});
        this.#mergeConfirmed(receipt.appended,receipt.head);
        this.#finishEventWrite(observation,patch,receipt.appended,"published",{silent:true});
        this.toast("Earlier finished output restored. Request a fresh independent review.");return true;
      }catch(error){
        if(!dispatched&&error instanceof Error&&error.message==="scene_cost_changed")observation.attempted=false;
        const current=this.sourceOwnershipActive(sourceOwner)&&!observation.paused;
        this.#finishEventWrite(observation,{outcome:observation.attempted?"unconfirmed":"not-attempted",privateUnavailable:!current},[],current?"none":"withheld",{silent:true});
        if(current)this.toast(error instanceof Error?error.message:"The earlier finished output could not be restored.");return false;
      }finally{if(this.sourceOwnershipScopeActive(sourceOwner)){this.busy.set("");this.notify();}}
    };
    const pending=this.#appendPipeline.then(restore,restore);this.#appendPipeline=pending.then(()=>undefined,()=>undefined);return pending;
  }

  /** Every download is permitted only after its exact actor/resource release receipt commits. */
  async authorizeProjectExport(event:EventInput,expectedScope:CapturedAuthorizationScope|null=this.captureAuthorizationScope()){
    const sourceOwner=this.captureSourceOwnership();if(!this.sourceOwnershipActive(sourceOwner))return false;
    const session=this.session.get(),context=session?.projectContext;
    if(!session||!expectedScope||!this.authorizationScopeActive(expectedScope))return false;
    if(Boolean(context)!==expectedScope.shared)return false;
    const authorization=expectedScope.key,resource=String(event.payload.artifact_id??event.payload.object_id??"");
    if(!resource||!["DocumentArtifactExported","ObjectExported"].includes(event.type))return false;
    const result=await this.appendWithReceipt(event,{remember:false,silent:true});
    if(!this.sourceOwnershipActive(sourceOwner)||result.publication!=="published")return false;
    const receipts=result.appended;
    if(!this.#scopeStillActive(authorization))return false;
    const accepted=receipts.some((receipt)=>receipt.type===event.type
      &&receipt.actor===(context?`user:${session.user.userId}`:"user")
      &&(!context||String(receipt.payload.project_id??"")===context.projectId)
      &&String(receipt.payload.artifact_id??receipt.payload.object_id??"")===resource);
    if(!accepted)this.toast("The download was canceled because your project access could not be confirmed.");
    return accepted;
  }

  /** Explicit intake commands reuse the original event receipt/source owner, not Canvas sync. */
  commitProjectIntake(events:EventInput[],controls:{current?:()=>boolean}={}):Promise<EventWriteResult|null>{
    return this.#projectIntakeRequest(events,"commit",controls);
  }
  checkProjectIntake(events:EventInput[],controls:{current?:()=>boolean}={}):Promise<EventWriteResult|null>{
    return this.#projectIntakeRequest(events,"check",controls);
  }
  async #projectIntakeRequest(inputs:EventInput[],mode:"commit"|"check",controls:{current?:()=>boolean}={}):Promise<EventWriteResult|null>{
    const intake=projectIntake(inputs);
    if(!intake||this.session.get()?.projectContext||controls.current&&!controls.current())return null;
    const admission=await this.#admitEventWrite(intake.events,"project_intake");
    let observation=admission.observation;
    if(!admission.admitted){
      if(!admission.reused||observation.pending||!this.sourceOwnershipScopeActive(observation.source))
        return this.#withheldEventWrite(observation);
      if(!this.sourceOwnershipActive(observation.source)||observation.paused){
        // Only this exact reused intake signature/IDs, still owned by its
        // original authorization scope, may get a deliberate fresh Check or
        // Retry. The private clone never unpauses the generic observation.
        // Unknown is not unused: the atomic server adjudicates the original.
        const source=this.captureSourceOwnership();
        if(!this.sourceOwnershipActive(source))return this.#withheldEventWrite(observation);
        observation={...observation,source,read:this.#beginSourceRead("full"),pending:true,delivered:false,
          receipt:this.#eventWriteReceipt(observation,{owner:this.#eventWriteOwner(source)} )};
      }else{
        if(observation.paused||!this.sourceOwnershipActive(observation.source))return this.#withheldEventWrite(observation);
        observation.pending=true;observation.delivered=false;
      }
    }
    const pending=this.#appendPipeline.then(()=>this.#projectIntakeNow(intake,mode,controls,observation));
    this.#appendPipeline=pending.then(()=>undefined,()=>undefined);
    return pending;
  }
  async #projectIntakeNow(intake:ProjectIntake,mode:"commit"|"check",controls:{current?:()=>boolean},observation:EventWriteObservation):Promise<EventWriteResult>{
    const source=observation.source,sourceCurrent=()=>this.sourceOwnershipActive(source),
      current=()=>sourceCurrent()&&(!controls.current||controls.current());
    const finish=(patch:Partial<EventWriteAcknowledgment>,appended:CreativeEvent[]=[],publication:EventWriteResult["publication"]="none")=>
      this.#finishEventWrite(observation,patch,appended,publication,{silent:true});
    const busy=mode==="check"?"check-project-intake":"project-intake";
    let began=false,knownReceipt:Partial<EventWriteAcknowledgment>|null=null;const failureHistory:unknown[]=[];
    try{
      if(!current())return finish({outcome:observation.attempted?"unconfirmed":"not-attempted",privateUnavailable:!sourceCurrent()},[],"withheld");
      began=true;this.busy.set(busy);this.notify();
      const response=await this.guardedFetch("/api/events",{method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({action:"project_intake",intakeAction:mode,events:intake.events})},
        mode==="check"?"check the original project creation":"create this original project",
        {current,onDispatch:()=>{if(mode==="commit")observation.attempted=true;}});
      if([401,403,404].includes(response.status)){
        if(observation.read)this.#retireOwnedSource(observation.read,response.status as 401|403|404);
        return finish({outcome:"unconfirmed",privateUnavailable:!sourceCurrent()},[],sourceCurrent()?"none":"withheld");
      }
      const body=await response.json() as Record<string,unknown>;
      const exact=Boolean(response.ok&&body&&typeof body==="object"&&!Array.isArray(body)
        &&Object.keys(body).length===6&&Object.keys(body).every(key=>["status","projectId","documentId","appended","rejected","head"].includes(key))
        &&body.status==="complete"&&body.projectId===intake.projectId&&body.documentId===intake.documentId);
      const receipt=exact?this.#validateEventWriteBody(body,intake.events,observation):null;
      const complete=Boolean(receipt?.complete&&!receipt.rejectedIndices.length&&receipt.appended.length===intake.events.length);
      const patch:Partial<EventWriteAcknowledgment>={outcome:complete?"observed":"unconfirmed",
        committed:receipt?.committed??[],rejectedIndices:receipt?.rejectedIndices??[],observedHead:receipt?.head??null,
        privateUnavailable:!sourceCurrent()};
      knownReceipt=patch;
      if(!current())return finish(patch,[],"withheld");
      if(!complete||!receipt)return finish(patch);
      this.#mergeConfirmed(receipt.appended,receipt.head,true);this.#reflectDocumentInRoute();
      return finish(patch,receipt.appended,"published");
    }catch(error){
      failureHistory.push(error);
      let result:EventWriteResult|undefined;
      try{
        if(observation.pending||!observation.delivered)result=finish(knownReceipt??{outcome:observation.attempted?"unconfirmed":"not-attempted",privateUnavailable:!sourceCurrent()},[],sourceCurrent()?"none":"withheld");
      }catch(cleanup){failureHistory.push(cleanup);throw combineNativeImageRetirementFailures(failureHistory)??cleanup;}
      if(NativeImageRetirementError.is(error))throw error;
      return result??this.#withheldEventWrite(observation);
    }finally{
      try{if(began&&this.sourceOwnershipScopeActive(source)&&this.busy.get()===busy){this.busy.set("");this.notify();}}
      // eslint-disable-next-line no-unsafe-finally -- Cleanup rejection preserves combined Image failures and existing legacy cleanup precedence.
      catch(cleanup){throw combineNativeImageRetirementFailures([...failureHistory,cleanup])??cleanup;}
    }
  }

  async appendBatch(events:EventInput[],options:AppendOptions={}):Promise<CreativeEvent[]>{return(await this.appendBatchWithReceipt(events,options)).appended;}
  async appendWithReceipt(event:EventInput,options:AppendOptions={}):Promise<EventWriteResult>{return this.appendBatchWithReceipt([event],options);}
  async appendBatchWithReceipt(events:EventInput[],options:AppendOptions={}):Promise<EventWriteResult>{
    // Copy once: later caller mutations must not change the admitted request/digest.
    let retained:EventInput[];try{retained=JSON.parse(JSON.stringify(events)) as EventInput[];}catch{retained=[];}
    const localDocument=this.projection.get().documentId;
    retained=retained.map(event=>(event.type==='BlockWeightSet'||event.type==='BlockPropertyEdited'&&['position','weight'].includes(String(event.payload.property_path)))&&!event.payload.document_id&&event.payload.scope!=='library'&&!this.route.get().includes('library')?{...event,payload:{...event.payload,document_id:localDocument}}:event);
    retained=retained.map(event=>ideaContentEdit(event)&&event.payload.document_id===undefined?{...event,payload:{...event.payload,document_id:this.route.get().includes('library')?'':localDocument}}:event);
    let editCanceled=false;
    const shared=sharedIdeaEdits(this.projection.get(),retained);
    if(shared.length&&typeof document!=='undefined'){
      const owner=this.captureSourceOwnership(),head=this.head.get(),route=this.route.get();
      const current=()=>this.sourceOwnershipActive(owner)&&this.head.get()===head&&this.route.get()===route&&(!options.current||options.current());
      try{
        const documentId=route.includes('library')?'':localDocument;
        const choice=await chooseSharedIdeaEdit([...new Set(shared.flatMap(x=>x.documents.map(d=>d.title)))],documentId?this.projection.get().documentTitle:'',current,s=>this.#systemNotice(s));
        if(!current())throw new IdeaEditCanceled();
        if(choice==='new')retained=independentIdeaEdits(this.projection.get(),retained,documentId).events;
        options={...options,expected:head};
      }catch(error){if(!(error instanceof IdeaEditCanceled))throw error;editCanceled=true;}
    }
    const admission=await this.#admitEventWrite(retained,retained.length>1?"batch":"append",options.expected),observation=admission.observation;
    if(editCanceled)return this.#finishEventWrite(observation,{outcome:"not-attempted",privateUnavailable:false},[],"none",options);
    if(!admission.admitted){
      if(admission.reused)return this.#withheldEventWrite(observation);
      if(!admission.capacity&&this.sourceOwnershipScopeActive(observation.source))this.toast(this.#systemNotice("Too many original changes await confirmation. No new change was sent."));
      return this.#finishEventWrite(observation,{outcome:"not-attempted",privateUnavailable:!this.sourceOwnershipActive(observation.source)},[],
        this.sourceOwnershipActive(observation.source)?"none":"withheld",options);
    }
    const pending=this.#appendPipeline.then(()=>this.#appendBatchNow(retained,options,observation));
    this.#appendPipeline=pending.then(()=>undefined,()=>undefined);return pending;
  }


  async #appendBatchNow(events:EventInput[],options:AppendOptions,observation:EventWriteObservation):Promise<EventWriteResult>{
    const source=observation.source,active=()=>this.sourceOwnershipActive(source)&&!observation.paused&&(!options.current||options.current());
    let began=false,knownReceipt:Partial<EventWriteAcknowledgment>|null=null;const failureHistory:unknown[]=[];
    try{
      if(!active())return this.#finishEventWrite(observation,{outcome:"not-attempted",privateUnavailable:true},[],"withheld",options);
      began=true;if(!options.background)this.busy.set(events[0]?.type??"append");this.appendFailure.set("");this.notify();
      let response:Response|undefined,body:unknown;
      const attempts=options.expected===undefined?Math.max(1,Math.min(6,options.rebaseAttempts??2)):1;
      for(let attempt=0;attempt<attempts;attempt+=1){
        if(!active())return this.#finishEventWrite(observation,{outcome:observation.attempted?"unconfirmed":"not-attempted",privateUnavailable:true},[],"withheld",options);
        let dispatched=false;observation.attempted=true;
        try{response=await this.guardedFetch("/api/events",{method:"POST",headers:{"content-type":"application/json"},
          body:JSON.stringify({action:observation.receipt.action,event:events[0],events,expectedSequence:options.expected??this.head.get(),clientId:"web:lit"})},
          events.length>1?"apply "+events.length+" document changes":"record "+(events[0]?.type??"this change"),
          {current:()=>dispatched||active(),onDispatch:()=>{dispatched=true;}});
        }catch(error){if(!dispatched&&error instanceof Error&&error.message==="scene_cost_changed")observation.attempted=false;throw error;}
        if([401,403,404].includes(response.status)){
          if(observation.read)this.#retireOwnedSource(observation.read,response.status as 401|403|404);
          return this.#finishEventWrite(observation,{outcome:"unconfirmed",privateUnavailable:!active()},[],active()?"none":"withheld",options);
        }
        body=await response.json();
        const error=body&&typeof body==="object"&&!Array.isArray(body)?String((body as Record<string,unknown>).error??""):"";
        if(!response.ok){
          if(!active())return this.#finishEventWrite(observation,{outcome:"unconfirmed",privateUnavailable:true},[],"withheld",options);
          if(response.status===409&&error==="stale_sequence"&&options.expected===undefined&&attempt<attempts-1){
            await this.#refreshEvents();if(!active())return this.#finishEventWrite(observation,{outcome:"unconfirmed",privateUnavailable:true},[],"withheld",options);continue;
          }
          if(response.status===409&&(error==="context_value_conflict"||error==="output_title_conflict")){
            await this.#refreshEvents();if(!active())return this.#finishEventWrite(observation,{outcome:"unconfirmed",privateUnavailable:true},[],"withheld",options);
            throw new Error(error==="output_title_conflict"?"Another collaborator renamed this result. Its latest name is now loaded; review it and try again."
              :"Another collaborator changed this exact decision. Your change was not saved; review the latest value and try again.");
          }
          throw new Error(error==="stale_sequence"?"The document changed elsewhere. Its latest state is now loaded; try that change again.":error||"Append rejected");
        }
        break;
      }
      const receipt=response?.ok?this.#validateEventWriteBody(body,events,observation):null;
      if(!receipt)throw new Error("The original change returned no verifiable acknowledgment. Its outcome is unconfirmed; it has not been resubmitted.");
      knownReceipt={committed:receipt.committed,rejectedIndices:receipt.rejectedIndices,
        observedHead:receipt.head,outcome:receipt.complete?"observed":"unconfirmed",privateUnavailable:!this.sourceOwnershipActive(source)||observation.paused};
      const patch:Partial<EventWriteAcknowledgment>={...knownReceipt,privateUnavailable:!active()};
      knownReceipt=patch;
      if(!active())return this.#finishEventWrite(observation,patch,[],"withheld",options);
      if(!receipt.complete){
        this.appendFailure.set("");
        if(!options.silent)this.toast(this.#systemNotice(receipt.committed.length
          ?"Only part of the original change is acknowledged. It has not been resubmitted."
          :"The original change is unconfirmed. It has not been resubmitted."));
        return this.#finishEventWrite(observation,patch,[],"none",options);
      }
      // The final synchronous ownership check gates every private continuation.
      this.#mergeConfirmed(receipt.appended,receipt.head,options.remember!==false);
      this.#reflectDocumentInRoute();
      if(receipt.rejected.length){
        const reasons=[...new Set(receipt.rejected.map(item=>(item.type?item.type+": ":"")+item.reason))];
        this.appendFailure.set(reasons.join("; "));
        this.toast(documentViewFromRoute(this.route.get())==="editor"
          ?this.#systemNotice("{count} change could not be saved; the other changes are safe.",{count:receipt.rejected.length})
          :this.#systemNotice("{count} event rejected; valid events still appended.",{count:receipt.rejected.length}));
      }
      return this.#finishEventWrite(observation,patch,receipt.appended,"published",options);
    }catch(error){
      const failures=failureHistory;failures.push(error);let secondary:{error:unknown}|null=null;
      let unavailable=true,result:EventWriteResult|undefined;
      try{unavailable=!active();}catch(cleanup){failures.push(cleanup);secondary={error:cleanup};}
      try{if(!unavailable&&!NativeImageRetirementError.is(error)){const message=error instanceof Error?error.message:"The original change is unconfirmed.";this.appendFailure.set(message);if(!options.silent)this.toast(message);}}
      catch(cleanup){failures.push(cleanup);secondary={error:cleanup};}
      // A retirement callback cannot leave the admitted receipt pending, or
      // erase a server acknowledgment that was validated before publication.
      try{if(observation.pending||!observation.delivered)result=this.#finishEventWrite(observation,knownReceipt??{outcome:observation.attempted?"unconfirmed":"not-attempted",privateUnavailable:unavailable},[],unavailable?"withheld":"none",options);}
      catch(cleanup){failures.push(cleanup);secondary={error:cleanup};}
      const combined=combineNativeImageRetirementFailures(failures);
      if(combined)throw combined;
      if(secondary)throw secondary.error;
      return result??this.#withheldEventWrite(observation);
    }finally{
      try{if(began&&this.sourceOwnershipScopeActive(source)){if(!options.background)this.busy.set("");this.notify();}}
      // eslint-disable-next-line no-unsafe-finally -- Cleanup rejection preserves combined Image failures and existing legacy cleanup precedence.
      catch(cleanup){throw combineNativeImageRetirementFailures([...failureHistory,cleanup])??cleanup;}
    }
  }

  async copyLibraryBlockSet(rootBlockId:string,destinationDocumentId=this.projection.get().documentId,sourceSurface="library",independent=false){
    const sourceOwner=this.captureSourceOwnership();if(!this.sourceOwnershipActive(sourceOwner))return null;
    const projection=this.projection.get();const available=new Map(projection.libraryBlocks.filter((block)=>!block.removed&&block.projectId===projection.projectId).map((block)=>[block.id,block]));const root=available.get(rootBlockId);
    if(!root){this.toast("That reusable context is no longer available.");return null;}
    if(!projection.documents.some(document=>document.id===destinationDocumentId&&document.projectId===root.projectId)){this.toast("Choose a document");return null;}
    if(!independent&&canAttachProjectIdea(root)){
      const events=attachIdeaEvents(root,destinationDocumentId,projection.libraryBlocks,projection.libraryBlockRelations);
      if(events.length){const write=await this.appendBatchWithReceipt(events);if(write.publication!=="published"||!this.sourceOwnershipActive(sourceOwner))return this.#withheldWrite(write);if(!write.appended.length)return null;}
      this.patchUi({focusBlockId:root.id});this.toast("Idea used in the open document. Edits are shared wherever it is used.");
      return {rootBlockId:root.id,blockCount:ideaDependencies([root.id],projection.libraryBlocks,projection.libraryBlockRelations).length,relationCount:0};
    }
    if(ideaDependencies([root.id],projection.libraryBlocks,projection.libraryBlockRelations).some(block=>Object.hasOwn(block.properties,'rich_text_body'))){this.toast('Independent copies of rich Ideas require a compatible reference editor. Use this shared Idea in Still; the source is unchanged.');return null;}
    const connected=new Set([root.id]);let changed=true;while(changed){changed=false;for(const relation of projection.libraryBlockRelations){if(connected.has(relation.fromBlockId)&&available.has(relation.toBlockId)&&!connected.has(relation.toBlockId)){connected.add(relation.toBlockId);changed=true;}}}
    if([...connected].some((id)=>Boolean(available.get(id)?.properties.organization_context_package_binding_id))){this.toast("Organization context must be adopted through its approved package.");return null;}
    const blocks=[...connected].map((id)=>available.get(id)!).sort((left,right)=>left.id===root.id?-1:right.id===root.id?1:left.position.localeCompare(right.position));const ids=new Map(blocks.map((block)=>[block.id,crypto.randomUUID()]));const contextSetId=crypto.randomUUID();const base=this.head.get()+1;
    const normalized=projection.libraryBlockRelations.some((relation)=>relation.kind===CONTEXT_CONTAINS_RELATION&&connected.has(relation.fromBlockId)&&connected.has(relation.toBlockId));
    const legacyGroups=new Map<string,string>();for(const block of blocks)for(const membership of combinedContextMemberships(block.properties))if(!legacyGroups.has(membership.contextSetId))legacyGroups.set(membership.contextSetId,crypto.randomUUID());
    const groupRole=combinedContextRoleForBlockType(root.type),groupName=String(root.properties.label??root.properties.text??root.handle),groupRelativity=Math.max(.5,Math.min(1,Number(root.properties.weight??.8)));const events:EventInput[]=blocks.map((block,index)=>{const authoredMemberships=combinedContextMemberships(block.properties);return{type:"BlockCreated",payload:{block_id:ids.get(block.id),document_id:destinationDocumentId,type:block.type,handle:`${block.handle}-copy-${String(base+index).padStart(3,"0")}`,position:`z${String(base+index).padStart(6,"0")}`,properties:{...block.properties,...(block.type==="action"?{block_references:normalizeActionBlockReferences(block.properties.block_references).flatMap((reference)=>ids.has(reference.block_id)?[{...reference,block_id:ids.get(reference.block_id)!}]:[])}:{}),authority:"authored",copied_from_block_id:block.id,copied_as_context_set:blocks.length>1,context_set_id:normalized?null:contextSetId,context_set_root_id:ids.get(root.id),combined_context_memberships:authoredMemberships.length?authoredMemberships.map((membership)=>({...membership,contextSetId:normalized?legacyGroups.get(membership.contextSetId)??contextSetId:contextSetId,memberOrder:normalized?membership.memberOrder:index,sourceCanvasId:""})):blocks.length>1&&!normalized?[{contextSetId,name:groupName,role:groupRole,target:groupName,application:"isolate",relativity:groupRelativity,memberOrder:index,sourceCanvasId:""}]:[],semantic_isolation:blocks.length>1,created_from:sourceSurface}}};}).sort((left,right)=>Number(left.payload.type==="action")-Number(right.payload.type==="action"));
    for(const relation of projection.libraryBlockRelations){const from=ids.get(relation.fromBlockId);const to=ids.get(relation.toBlockId);if(!from||!to)continue;const{context_set_id:sourceContextId,...properties}=relation.properties;events.push({type:"BlockRelationAdded",payload:{relation_id:crypto.randomUUID(),project_id:projection.projectId,document_id:destinationDocumentId,from_block_id:from,to_block_id:to,kind:relation.kind,properties:{...properties,copied_from_relation_id:relation.id,...(normalized&&relation.kind===CONTEXT_CONTAINS_RELATION?{}:{context_set_id:normalized?legacyGroups.get(String(sourceContextId??""))??contextSetId:contextSetId})},source_surface:sourceSurface}});}
    const write=await this.appendBatchWithReceipt(copyOutputRequirementCreationEvents(events,ids));if(write.publication!=="published"||!this.sourceOwnershipActive(sourceOwner))return this.#withheldWrite(write);if(!write.appended.length)return null;const copiedRootId=ids.get(root.id)!;this.patchUi({focusBlockId:copiedRootId});this.toast(blocks.length===1?"Reusable block added to the open document.":this.#systemNotice("{count} connected blocks added as one context set.",{count:blocks.length}));return{rootBlockId:copiedRootId,blockCount:blocks.length,relationCount:events.length-blocks.length};
  }

  #relatedOutputBlocks(blockId:string){
    const projection=this.projection.get(),target=projection.libraryBlocks.find((block)=>block.id===blockId);if(!target)return[];
    const rootId=target.properties.source_artifact_item_id?projection.libraryBlockRelations.find((relation)=>relation.kind==="artifact_contains"&&relation.toBlockId===target.id)?.fromBlockId??String(target.properties.context_set_root_id??""):target.id;
    const relationIds=new Set(projection.libraryBlockRelations.filter((relation)=>relation.kind==="artifact_contains"&&relation.fromBlockId===rootId).map((relation)=>relation.toBlockId));
    if(relationIds.size)return projection.libraryBlocks.filter((block)=>block.id===rootId||relationIds.has(block.id));
    return projection.libraryBlocks.filter((block)=>block.id===rootId||block.id===target.id||block.properties.context_set_root_id===rootId);
  }

  outputOwnedBlockCount(blockId:string){return this.projection.get().libraryBlockRelations.filter((relation)=>relation.kind==="artifact_contains"&&relation.fromBlockId===blockId).length;}

  outputBlockRemovalEvents(input:EventInput){
    const projection=this.projection.get(),target=projection.libraryBlocks.find((block)=>block.id===String(input.payload.block_id??""));
    if(!target)return[];
    if(target.locked){this.toast("Unlock this input before removing it.");return[];}
    const owner=projection.libraryBlockRelations.find((relation)=>relation.kind==="artifact_contains"&&relation.toBlockId===target.id);
    if(owner){this.toast(target.properties.source_artifact_kind==="video"?"This scene belongs to a video. Remove the complete video to keep every future generation in sync.":"This frame belongs to a storyboard. Remove the complete storyboard to keep every future generation in sync.");return[];}
    const ownedIds=new Set(projection.libraryBlockRelations.filter((relation)=>relation.kind==="artifact_contains"&&relation.fromBlockId===target.id).map((relation)=>relation.toBlockId));
    const owned=projection.libraryBlocks.filter((block)=>ownedIds.has(block.id));
    if(owned.some((block)=>block.locked)){this.toast(target.properties.source_artifact_kind==="video"?"Unlock every linked video scene before removing this input.":"Unlock every linked storyboard frame before removing this input.");return[];}
    if(input.payload.scope!=="library"&&canAttachProjectIdea(target)&&projection.documentId)return [{type:"BlockDocumentDetached",payload:{...input.payload,block_id:target.id,project_id:target.projectId,document_id:projection.documentId,position:ideaDocumentUses(target).find(u=>u.documentId===projection.documentId)?.position??target.position,weight:ideaDocumentUses(target).find(u=>u.documentId===projection.documentId)?.weight}}];
    return ownedOutputBlockRemovalEvents(target,projection.libraryBlocks,projection.libraryBlockRelations,input);
  }

  async removeOutputBlock(input:EventInput){const events=this.outputBlockRemovalEvents(input);if(!events.length)return[];return this.appendBatch(events,{rebaseAttempts:6});}

  outputBlockTextEvents(blockId:string,value:string,sourceSurface="output-context-editor"){
    const block=this.projection.get().libraryBlocks.find((candidate)=>candidate.id===blockId);if(!block)return[];
    return outputBlockTextEditEvents(block,this.#relatedOutputBlocks(blockId),value,sourceSurface);
  }

  async saveBlockText(blockId:string,value:string,sourceSurface="output-context-editor"){
    const events=this.outputBlockTextEvents(blockId,value,sourceSurface);if(!events.length)return[];return this.appendBatch(events,{rebaseAttempts:6});
  }

  async saveOutputInput(blockId:string,draft:OutputInputDraft,sourceSurface="output-input-editor"){
    const sourceOwner=this.captureSourceOwnership();if(!this.sourceOwnershipActive(sourceOwner))return false;
    const root=this.projection.get().libraryBlocks.find((block)=>block.id===blockId);if(!root)return false;
    const events=this.outputInputEvents(blockId,draft,sourceSurface);
    if(!events.length){if(JSON.stringify(outputInputDraft(root))===JSON.stringify(draft)){this.toast("Your input is already up to date.");return true;}this.toast(root.locked?"Unlock this input before editing it.":"Unlock the related storyboard frame before saving these changes.");return false;}
    const result=await this.appendBatchWithReceipt(events,{rebaseAttempts:6});const saved=this.sourceOwnershipActive(sourceOwner)&&this.#eventWriteComplete(result,events);if(saved)this.toast("Your customized input is saved. The original output remains unchanged.");return saved;
  }

  outputInputEvents(blockId:string,draft:OutputInputDraft,sourceSurface="output-input-editor"){
    const root=this.projection.get().libraryBlocks.find((block)=>block.id===blockId);if(!root)return[];return outputInputEditEvents(root,this.#relatedOutputBlocks(blockId),draft,{sourceSurface});
  }

  async revealOutputInput(blockId:string,destinationDocumentId=this.projection.get().documentId,options:Pick<WorkspaceNavigationOptions,"current"|"focus">={}){
    // An explicitly supplied original lease is transferred to this existing
    // reveal lifetime, including early refusal. Never cancel newer work first.
    try{if(!workspaceNavigationCurrent(options)){options.focus?.dispose();return false;}}
    catch{options.focus?.dispose();return false;}
    this.#outputInputReveal?.cancel();
    const projection=this.projection.get(),sourceRoute=this.route.get(),authorization=this.captureAuthorizationScope();
    const targetDocument=projection.documents.find(item=>item.id===destinationDocumentId&&!item.removed);
    const targetBlock=ideasInDocument(projection,destinationDocumentId).find(item=>item.id===blockId&&!item.removed);
    const sessionDetails=()=>{
      const session=this.session.get(),context=session?.projectContext;
      return JSON.stringify([context??null,session?.capabilities??[],session?.impersonation?.expiresAt??null]);
    };
    const authorityDetails=sessionDetails(),projectId=projection.projectId;
    if(!blockId||!authorization||!targetDocument||!targetBlock||targetDocument.projectId!==projectId||targetBlock.projectId!==projectId){options.focus?.dispose();return false;}
    const destination=documentContextBlockRoute(destinationDocumentId,targetDocument.title,blockId);
    const sourceNavigation=this.#workspaceNavigationFocus;
    let navigation:{route:string;focus:OutputNavigationFocusLease}|null=null,transition=this.#workspaceTransition;
    let closed=false,opening=true,requiresNavigation=true,frame=0,timeout=0,attempts=0,sessionWrites=0,linkedSelection=false;
    let expectedFocus=this.ui.focusBlockId,expectedEdit=this.ui.editingBlockId;
    let ownFocus:string|undefined,ownEdit:string|undefined;
    const pendingWorkspace=()=>!navigation&&applicationIdFromRoute(sourceRoute)!==applicationIdFromRoute(destination);
    const cleanups:Array<()=>void>=[];
    const owner={cancel:()=>{
      if(closed)return;closed=true;
      if(frame)window.cancelAnimationFrame(frame);if(timeout)window.clearTimeout(timeout);
      focus?.dispose();for(const cleanup of cleanups.splice(0))cleanup();
      if(this.#outputInputReveal===owner)this.#outputInputReveal=null;
    }};
    this.#outputInputReveal=owner;
    const acceptNavigation=()=>{
      const candidate=this.#workspaceNavigationFocus;
      if(!navigation&&candidate!==sourceNavigation&&candidate?.focus===focus){navigation=candidate;transition=this.#workspaceTransition;linkedSelection=true;}
      return navigation;
    };
    const identityCurrent=()=>{
      const current=this.projection.get(),session=this.session.get(),context=session?.projectContext;
      const permissions=context?.permissions??session?.capabilities??[];
      const document=current.documents.find(item=>item.id===destinationDocumentId&&!item.removed);
      const block=ideasInDocument(current,destinationDocumentId).find(item=>item.id===blockId&&!item.removed);
      return !closed&&this.#outputInputReveal===owner&&this.authorizationScopeActive(authorization)&&sessionDetails()===authorityDetails
        &&permissions.includes("project.read")&&permissions.includes("project.author")
        &&(!context||context.projectId===projectId&&Date.parse(context.expiresAt)>Date.now())
        &&(!session?.impersonation||Date.parse(session.impersonation.expiresAt)>Date.now())
        &&current.projectId===projectId&&document?.projectId===projectId&&block?.projectId===projectId
        &&block.type===targetBlock.type&&block.scope===targetBlock.scope&&!block.locked&&!block.properties.source_evidence_hash;
    };
    const stateCurrent=()=>{
      const arrived=acceptNavigation();
      return identityCurrent()&&this.#workspaceTransition===transition
        &&(arrived?this.#workspaceNavigationFocus===arrived&&this.route.get()===arrived.route
          &&isDocumentViewRoute(arrived.route)&&documentIdFromRoute(arrived.route)===destinationDocumentId
          &&documentViewFromRoute(arrived.route)==="document"&&this.projection.get().documentId===destinationDocumentId
          :this.#workspaceNavigationFocus===sourceNavigation&&this.route.get()===sourceRoute)
        &&this.ui.focusBlockId===expectedFocus&&this.ui.editingBlockId===expectedEdit
        &&!document.querySelector("dialog[open]");
    };
    const current=()=>{
      if(!stateCurrent()||!focus.current()){owner.cancel();return false;}
      sessionWrites=0;return true;
    };
    const focus=options.focus??captureOutputNavigationFocus(document,{
      ownedRouteFocus:outputNavigationOwnedRouteFocus(document,this,{documentId:destinationDocumentId,blockId},stateCurrent),
    });
    // State notifications cannot read or write signals. Watch the existing
    // underlying states, including SignalObject's field states, so ABA writes
    // cannot disappear before a later renderer notification.
    const observe=(read:()=>unknown,changed:()=>void)=>{
      const dependency=new Signal.Computed(read);dependency.get();
      const sources=Signal.subtle.introspectSources(dependency);
      const watcher=new Signal.subtle.Watcher(()=>{changed();if(!closed)watcher.watch();});
      watcher.watch(...sources);cleanups.push(()=>watcher.unwatch(...sources));
    };
    observe(()=>this.route.get(),()=>{
      const candidate=this.#workspaceNavigationFocus;
      if(!navigation&&candidate!==sourceNavigation&&candidate?.focus===focus){navigation=candidate;transition=this.#workspaceTransition;linkedSelection=true;}
      else owner.cancel();
    });
    observe(()=>this.ui.focusBlockId,()=>{
      if(ownFocus!==undefined){expectedFocus=ownFocus;ownFocus=undefined;}
      else if(linkedSelection&&navigation&&this.#workspaceNavigationFocus===navigation){expectedFocus=blockId;linkedSelection=false;}
      else owner.cancel();
    });
    observe(()=>this.ui.editingBlockId,()=>{
      if(ownEdit!==undefined){expectedEdit=ownEdit;ownEdit=undefined;}else owner.cancel();
    });
    observe(()=>this.session.get(),()=>{
      // The existing cross-workspace transition republishes its verified,
      // same-scope session before committing its lease-owned route. Recheck
      // that one write outside notify; two unvalidated writes are an ABA.
      if(!pendingWorkspace()||++sessionWrites>1)owner.cancel();
      else queueMicrotask(()=>{if(!closed)current();});
    });
    observe(()=>this.asOf.get(),()=>owner.cancel());
    cleanups.push(this.subscribe(()=>{if(!closed)current();}));
    if(!current())return false;
    const visible=(element:HTMLElement)=>{
      if(!element.isConnected||!element.getClientRects().length||element.closest("[hidden], [inert], [aria-hidden=\"true\"]"))return false;
      const style=window.getComputedStyle(element);
      return style.display!=="none"&&style.visibility!=="hidden"&&style.visibility!=="collapse";
    };
    const workspaces=[...document.querySelectorAll<HTMLElement&{store:FormaStore}>("forma-workspace")].filter(element=>element.isConnected&&element.store===this);
    const writePanel=workspaces.length===1?workspaces[0].querySelector<HTMLElement>("#document-context-panel"):null;
    requiresNavigation=!isDocumentViewRoute(sourceRoute)||documentViewFromRoute(sourceRoute)!=="document"
      ||projection.documentId!==destinationDocumentId||!writePanel||writePanel.closest<HTMLElement>("forma-workspace")!==workspaces[0]||!visible(writePanel);
    const publishEditing=()=>{
      if(expectedFocus===blockId&&expectedEdit===blockId)return;
      ownFocus=blockId;ownEdit=blockId;
      try{this.patchUi({focusBlockId:blockId,editingBlockId:blockId});}finally{ownFocus=ownEdit=undefined;}
    };
    type InputOwner=HTMLElement&{store:FormaStore;block:CreativeProjection["blocks"][number];surface:string;readOnly:boolean};
    const target=()=>{
      const owners=[...document.querySelectorAll<InputOwner>("forma-context-block")].filter(element=>element.isConnected
        &&element.store===this&&element.block?.id===blockId&&element.block.documentId===destinationDocumentId
        &&element.block.projectId===projectId&&element.surface==="document");
      if(!owners.length)return undefined;
      if(owners.length!==1)return null;
      const element=owners[0];
      if(element.readOnly||element.block.locked||element.block.properties.source_evidence_hash||!visible(element))return null;
      const anchors=[...element.querySelectorAll<HTMLElement>("[data-block-id]")].filter(anchor=>
        anchor.tagName==="ARTICLE"&&anchor.getAttribute("data-block-id")===blockId&&anchor.closest<HTMLElement>("forma-context-block")===element);
      const editors=[...element.querySelectorAll<HTMLElement>(".block-editor")].filter(editor=>editor.closest<HTMLElement>("forma-context-block")===element);
      if(!anchors.length||!editors.length)return undefined;
      if(anchors.length!==1||editors.length!==1||!visible(anchors[0])||!visible(editors[0]))return null;
      const fields=[...editors[0].querySelectorAll<HTMLTextAreaElement>("textarea")].filter(input=>
        input.tagName==="TEXTAREA"&&input.closest<HTMLElement>("forma-context-block")===element&&input.closest(".block-editor")===editors[0]);
      const field=fields.find(input=>input.closest("forma-ui-rich-text"))??fields[0];
      if(!field)return undefined;
      return visible(field)&&!field.disabled&&!field.readOnly&&!field.matches(":disabled")?{anchor:anchors[0],field}:null;
    };
    const schedule=()=>{frame=window.requestAnimationFrame(reveal);};
    const reveal=()=>{
      frame=0;let again=false;
      try{
        if(!current())return;
        if(opening||requiresNavigation&&!navigation){again=true;return;}
        publishEditing();if(!current())return;
        const destination=target();
        if(!destination){again=destination===undefined&&attempts++<24;return;}
        focus.run(destination.field,()=>{
          if(!current()||target()?.field!==destination.field)return false;
          const reduced=window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          destination.anchor.scrollIntoView({block:"center",behavior:reduced?"instant":"smooth"});
          if(!current()||target()?.field!==destination.field)return false;
          destination.field.focus({preventScroll:true});return true;
        });
      }finally{if(again&&!closed)schedule();else owner.cancel();}
    };
    // This bounds presentation ownership even if a navigation/read never
    // completes or animation frames stop in a background document.
    timeout=window.setTimeout(()=>owner.cancel(),10_000);
    schedule();
    try{
      if(!requiresNavigation){
        // Same-document visible Write keeps the original synchronous editor
        // publication and route/history bytes; no navigation slot is forged.
        opening=false;publishEditing();return current();
      }
      // Preserve the existing DocumentOpened/history path. Only the opening
      // gesture and its exact destination are carried through its awaits.
      ownFocus="";
      let pending:Promise<boolean>;
      try{
        pending=this.openDocument(destinationDocumentId,destination,"output-input",{current,focus});
        transition=this.#workspaceTransition;
      }finally{ownFocus=undefined;}
      const opened=await pending;opening=false;
      if(!opened||!current()){owner.cancel();return false;}
      if(navigation)publishEditing();
      return current();
    }catch{owner.cancel();return false;}
  }

  /** Upload only after the originating file picker has recorded its rights confirmation. */
  async uploadModel3dFile(file:File,guard:()=>boolean=()=>true,options:{documentId?:string;rightsConfirmed?:boolean}={}){
    const source=this.captureSourceOwnership(),documentId=options.documentId??this.projection.get().documentId;
    const current=()=>this.sourceOwnershipActive(source)&&this.projection.get().documentId===documentId&&guard();
    try{
      if(!current()||options.rightsConfirmed!==true)return false;
      if(file.size>MAX_MODEL3D_UPLOAD_BYTES)throw new Error("Choose a GLB model smaller than 64 MB.");
      validateModel3dAsset(await file.arrayBuffer());if(!current())return false;
      const form=new FormData();form.append("file",file);form.append("rightsConfirmed","true");form.append("nonSensitiveConfirmed","true");
      const response=await this.guardedFetch("/api/media",{method:"POST",body:form},"upload this licensed 3D model",{current});
      const media=await response.json() as {url?:string;mimeType?:string;contentHash?:string;error?:string};
      if(!current())return false;
      if(!response.ok||!media.url||!media.contentHash)throw new Error(media.error??"The 3D model could not be uploaded.");
      const referenceId=crypto.randomUUID(),blockId=crypto.randomUUID();
      const events:EventInput[]=[
        {type:"ReferenceIngested",payload:{reference_id:referenceId,source_type:"model3d-upload",source_ref:media.url,content_hash:media.contentHash,source_mime_type:media.mimeType,rights_class:"asserted"}},
        {type:"RightsAsserted",payload:{reference_id:referenceId,rights_class:"owned_or_licensed",assertion_method:"explicit-upload-confirmation"}},
        {type:"BlockCreated",payload:{block_id:blockId,document_id:documentId,type:"model3d",handle:`model3d/${blockId}`,position:`z${this.head.get()}`,
          properties:{label:file.name,subtype:"Object",intent:"include",weight:.72,authority:"authored",model_url:media.url,model_mime_type:media.mimeType,
            model_content_hash:media.contentHash,model_reference_id:referenceId,rights_class:"owned_or_licensed",pixel_reference_mode:"context_only"}}}
      ];
      const result=await this.appendBatchWithReceipt(events,{rebaseAttempts:6,current});
      if(result.publication!=="published"||!current()||!result.appended.some(event=>event.type==="BlockCreated"))return false;
      this.patchUi({focusBlockId:blockId,editingBlockId:blockId});return true;
    }catch(error){if(current())this.toast(error instanceof Error?error.message:"The 3D model could not be uploaded.");return false;}
  }

  async saveReferenceComposition(capture:{blob:Blob;recipe:ReferenceCompositionRecipe;label:string;targetBlockId?:string},guard:()=>boolean=()=>true):Promise<boolean>{
    const source=this.captureSourceOwnership(),projection=this.projection.get(),originDocumentId=projection.documentId;
    const target=capture.targetBlockId?projection.libraryBlocks.find(block=>block.id===capture.targetBlockId&&!block.removed&&block.type==="reference"&&block.properties.reference_composition):null;
    if(capture.targetBlockId&&(!target||target.locked))return false;
    const documentId=target?.documentId??originDocumentId;
    const targetFingerprint=target?generationRevisionFor({media:target.properties.media_url,recipe:target.properties.reference_composition}):null;
    const originalComposition=normalizeReferenceComposition(target?.properties.reference_composition);
    const retainedSources=new Set(originalComposition?.sources?.map(item=>item.blockId)??[]);
    const recipe=structuredClone(capture.recipe),label=capture.label.trim()||"Reference composition";
    const current=()=>{const state=this.projection.get(),actual=target?state.libraryBlocks.find(block=>block.id===target.id):null;
      return this.sourceOwnershipActive(source)&&state.documentId===originDocumentId&&guard()
        &&(!target||Boolean(actual&&!actual.locked&&!actual.removed&&actual.type==="reference"&&targetFingerprint===generationRevisionFor({media:actual.properties.media_url,recipe:actual.properties.reference_composition})))
        &&!validateReferenceComposition(recipe,referenceCompositionSources(target?state.libraryBlocks.filter(block=>block.id!==target.id&&block.projectId===target.projectId&&(ideasInDocument(state,documentId).some(b=>b.id===block.id)||retainedSources.has(block.id))):state.blocks,this.events.get()));};
    try{
      if(!current()||capture.blob.type!=="image/png")return false;
      const form=new FormData();form.append("file",new File([capture.blob],"reference-composition.png",{type:"image/png"}));
      form.append("rightsConfirmed","true");form.append("nonSensitiveConfirmed","true");form.append("referenceComposition",JSON.stringify(recipe));
      const response=await this.guardedFetch("/api/media",{method:"POST",body:form},"save this reference composition",{current});
      const media=await response.json() as {url?:string;contentHash?:string;error?:string};if(!current())return false;
      if(!response.ok||!media.url||!media.contentHash)throw new Error(media.error??"The reference composition could not be saved.");
      const referenceId=crypto.randomUUID(),blockId=target?.id??crypto.randomUUID();
      const events:EventInput[]=[
        {type:"ReferenceIngested",payload:{reference_id:referenceId,source_type:"reference-composition",source_ref:media.url,content_hash:media.contentHash,source_mime_type:"image/png",rights_class:"asserted"}},
        {type:"RightsAsserted",payload:{reference_id:referenceId,rights_class:"owned_or_licensed",assertion_method:"explicit-reference-composition"}},
      ];
      const properties:Record<string,unknown>={label,subtype:"Composition",reference_id:referenceId,media_url:media.url,media_type:"image/png",
        source_mime_type:"image/png",source_content_hash:media.contentHash,pixel_reference_mode:"preserve_composition",reference_composition:recipe,extraction_status:"unavailable"};
      if(target)events.push(...Object.entries(properties).map(([key,value])=>({type:"BlockPropertyEdited",payload:{block_id:blockId,document_id:documentId,property_path:key,old_value:target.properties[key]??null,new_value:value,source_surface:"reference-compositor"}})));
      else events.push({type:"BlockCreated",payload:{block_id:blockId,document_id:documentId,type:"reference",handle:`reference/composition-${blockId}`,position:`z${this.head.get()}`,
        properties:{...properties,intent:"include",weight:.8,authority:"authored"}}});
      // The explicit composition action replaces its constituent visual inputs with the reviewed scene.
      for(const id of new Set(recipe.sources.map(item=>item.blockId))){
        const block=(target?projection.libraryBlocks:projection.blocks).find(item=>item.id===id);
        if(block&&block.documentId===documentId&&block.properties.pixel_reference_mode&&block.properties.pixel_reference_mode!=="context_only")events.push({type:"BlockPropertyEdited",payload:{block_id:id,document_id:documentId,property_path:"pixel_reference_mode",old_value:block.properties.pixel_reference_mode,new_value:"context_only",source_surface:"reference-compositor"}});
      }
      const result=await this.appendBatchWithReceipt(events,{rebaseAttempts:1,current});
      if(result.publication!=="published"||!this.sourceOwnershipActive(source)||!result.appended.some(event=>event.type===(target?"BlockPropertyEdited":"BlockCreated")))return false;
      if(guard()&&this.projection.get().documentId===documentId)this.patchUi({focusBlockId:blockId});return true;
    }catch(error){if(current())this.toast(error instanceof Error?error.message:"The reference composition could not be saved.");return false;}
  }

  /** The model identity and chosen image are frozen together before an image is reusable. */
  async saveModel3dView(blockId:string,capture:{blob:Blob;view:Model3dView;src:string},guard:()=>boolean=()=>true):Promise<boolean>{
    const retainedCapture={blob:capture.blob,view:structuredClone(capture.view),src:capture.src};
    const source=this.captureSourceOwnership(),documentId=this.projection.get().documentId;
    const original=this.projection.get().libraryBlocks.find(block=>block.id===blockId&&block.type==="model3d"&&!block.removed);
    if(!original||original.locked||retainedCapture.src!==original.properties.model_url)return false;
    const originalHash=String(original.properties.model_content_hash??""),previousView=original.properties.media_url??null;
    const current=()=>{const block=this.projection.get().libraryBlocks.find(item=>item.id===blockId);return this.sourceOwnershipActive(source)
      &&this.projection.get().documentId===documentId&&guard()&&Boolean(block&&!block.removed&&!block.locked&&block.type==="model3d"
        &&block.properties.model_url===retainedCapture.src&&block.properties.model_content_hash===originalHash&&(block.properties.media_url??null)===previousView);};
    try{
      if(!current()||retainedCapture.blob.type!=="image/png")return false;
      const form=new FormData();form.append("file",new File([retainedCapture.blob],"model-view.png",{type:"image/png"}));
      form.append("rightsConfirmed","true");form.append("nonSensitiveConfirmed","true");form.append("modelUrl",retainedCapture.src);
      form.append("modelContentHash",originalHash);form.append("modelView",JSON.stringify(retainedCapture.view));
      const response=await this.guardedFetch("/api/media",{method:"POST",body:form},"save this 3D model view",{current});
      const media=await response.json() as {url?:string;contentHash?:string;error?:string};if(!current())return false;
      if(!response.ok||!media.url||!media.contentHash)throw new Error(media.error??"The model view could not be saved.");
      const referenceId=crypto.randomUUID();
      const properties:Record<string,unknown>={reference_id:referenceId,media_url:media.url,media_type:"image/png",source_mime_type:"image/png",
        source_content_hash:media.contentHash,model_view:structuredClone(retainedCapture.view),pixel_reference_mode:original.properties.pixel_reference_mode??"context_only"};
      const events:EventInput[]=[
        {type:"ReferenceIngested",payload:{reference_id:referenceId,source_type:"model3d-view",source_ref:media.url,content_hash:media.contentHash,source_mime_type:"image/png",rights_class:"asserted"}},
        {type:"RightsAsserted",payload:{reference_id:referenceId,rights_class:original.properties.rights_class==="account-generated"?"account-generated":"owned_or_licensed",assertion_method:"explicit-model-view-capture"}},
        ...Object.entries(properties).map(([key,value])=>({type:"BlockPropertyEdited",payload:{block_id:blockId,document_id:original.documentId,property_path:key,old_value:original.properties[key]??null,new_value:value,source_surface:"model3d-viewer"}}))
      ];
      const result=await this.appendBatchWithReceipt(events,{rebaseAttempts:1,current});
      return result.publication==="published"&&this.sourceOwnershipActive(source)&&result.appended.some(event=>event.type==="BlockPropertyEdited");
    }catch(error){if(current())this.toast(error instanceof Error?error.message:"The model view could not be saved.");return false;}
  }

  async addArtifactAsContext(artifactId:string,destinationDocumentId=this.projection.get().documentId,sourceSurface="document-artifact-viewer",options:{reveal?:boolean;presentation?:SlidePresentation|null}={}){
    const sourceOwner=this.captureSourceOwnership();if(!this.sourceOwnershipActive(sourceOwner))return null;
    const projection=this.projection.get();const artifact=projection.libraryArtifacts.find((candidate)=>candidate.id===artifactId);
    if(!artifact){this.toast("That output is no longer available.");return null;}
    if(artifact.kind==="model3d"){const readiness=model3dArtifactContextReadiness(artifact);if(!readiness.supported){this.toast(readiness.reason??"This model needs a self-contained GLB before it can be used as context.");return null;}}
    const document=projection.documents.find((candidate)=>candidate.id===destinationDocumentId);if(!document){this.toast("Choose an available document before adding output context.");return null;}
    const existingBlocks=ideasInDocument(projection,destinationDocumentId).filter((block)=>block.properties.source_artifact_id===artifact.id);const existingRoot=existingBlocks.find((block)=>!block.properties.source_artifact_item_id);const ownedChildIds=new Set(projection.libraryBlockRelations.filter((relation)=>relation.kind==="artifact_contains"&&relation.fromBlockId===existingRoot?.id).map((relation)=>relation.toBlockId));const existingSourceItemIds=existingBlocks.filter((block)=>ownedChildIds.has(block.id)).map((block)=>String(block.properties.source_artifact_item_id??"")).filter(Boolean);const contextSetId=String(existingRoot?.properties.context_set_id??"")||undefined;
    const availableFrames=artifact.kind==="storyboard"?artifact.items.filter((item)=>Boolean(item.mediaUrl)).length:artifact.kind==="video"?artifact.items.filter((item)=>Boolean(item.mediaUrl)&&String(item.mediaType??"").startsWith("video/")).length:0;
    if(existingRoot&&existingSourceItemIds.length>=availableFrames){if(options.reveal!==false)await this.revealOutputInput(existingRoot.id,destinationDocumentId);return{rootBlockId:existingRoot.id,created:false,blockCount:0,availableMemberCount:1+availableFrames};}
    const retained=artifact.contentRef?await this.ensurePrivateContent(artifact.contentRef):null;if(!this.sourceOwnershipActive(sourceOwner))return null;let content=parseDocumentArtifactContent(retained??undefined);const existingDraft=existingRoot?outputInputDraft(existingRoot):null;if(content&&existingDraft)content={...content,title:existingDraft.title,summary:existingDraft.summary,content_markdown:existingDraft.markdown,items:existingDraft.items.map((item)=>({title:item.title,body:item.body,notes:item.notes,image_prompt:item.image_prompt,context_group_ids:item.context_group_ids,slide:item.slide??null}))};if(content&&artifact.kind==="slides"&&options.presentation)content={...content,presentation:structuredClone(options.presentation)};
    if(artifact.contentRef&&!content){this.toast("The complete original output is unavailable, so an incomplete copy was not created.");return null;}
    const result=artifactContextEvents(artifact,{documentId:destinationDocumentId,projectId:document.projectId,sourceSurface,content,existingRootBlockId:existingRoot?.id,existingSourceItemIds,contextSetId,positionStart:this.head.get()+1});
    if(!result.blockIds.length){if(existingRoot&&options.reveal!==false)await this.revealOutputInput(existingRoot.id,destinationDocumentId);return{rootBlockId:existingRoot?.id??"",created:false,blockCount:0,availableMemberCount:result.availableMemberCount};}
    const write=await this.appendBatchWithReceipt(result.events,{rebaseAttempts:6});if(write.publication!=="published"||!this.sourceOwnershipActive(sourceOwner))return this.#withheldWrite(write);const created=write.appended.filter((event)=>event.type==="BlockCreated").length;if(!created)return null;
    const rootBlockId=existingRoot?.id??result.blockIds[0]??"";if(options.reveal!==false)await this.revealOutputInput(rootBlockId,destinationDocumentId);else this.patchUi({focusBlockId:rootBlockId});this.toast(artifact.kind==="storyboard"?this.#systemNotice("{title} is ready to customize, with its finished frames kept in order.",{title:artifact.title}):artifact.kind==="video"?this.#systemNotice("{title} is ready to customize, with its finished motion scenes kept in order.",{title:artifact.title}):this.#systemNotice("{title} is ready to customize.",{title:artifact.title}));return{rootBlockId,created:true,blockCount:created,availableMemberCount:result.availableMemberCount};
  }

  async addStoryboardFramesAsContext(artifactId:string,destinationDocumentId=this.projection.get().documentId,sourceSurface="document-artifact-viewer"){return this.addArtifactAsContext(artifactId,destinationDocumentId,sourceSurface);}

  async addImageOutputAsContext(outputId:string,destinationDocumentId=this.projection.get().documentId,sourceSurface="output-card",options:{reveal?:boolean;contextParentBlockId?:string;identityReference?:boolean;current?:()=>boolean}={}){
    const sourceOwner=this.captureSourceOwnership();if(!this.sourceOwnershipActive(sourceOwner))return null;
    const projection=this.projection.get();const output=projection.libraryOutputs.find((candidate)=>candidate.id===outputId);if(!output){this.toast("That generated image is no longer available.");return null;}
    const document=projection.documents.find((candidate)=>candidate.id===destinationDocumentId);if(!document){this.toast("Choose an available document before using this image as input.");return null;}
    const editing=sourceSurface==="generated-image-editor",sourceRoute=this.route.get();
    const sourceTuple=(value:NonNullable<typeof output>)=>JSON.stringify([value.id,value.documentId,value.generationId,value.sourceEventId,value.contentRef,value.mediaUrl,value.mediaType,value.width,value.height,value.imageRevision??null]);
    const originalTuple=sourceTuple(output);
    const imageCurrent=()=>{
      if(!this.sourceOwnershipActive(sourceOwner)||options.current&&!options.current())return false;
      if(!editing)return true;
      const now=this.projection.get().libraryOutputs.find(item=>item.id===output.id),target=this.projection.get().documents.find(item=>item.id===destinationDocumentId);
      return Boolean(now&&!now.discarded&&sourceTuple(now)===originalTuple&&target&&!target.removed&&target.projectId===document.projectId
        &&this.route.get()===sourceRoute&&this.projection.get().documentId===destinationDocumentId&&this.projection.get().projectId===document.projectId);
    };
    if(!imageCurrent())return null;
    const parent=options.contextParentBlockId?ideasInDocument(projection,destinationDocumentId).find((block)=>block.id===options.contextParentBlockId):undefined;
    if(options.contextParentBlockId&&(!parent||parent.locked))return null;
    const currentImageSources=output.imageRevision||sourceSurface==="generated-image-editor"?referenceCompositionSources(ideasInDocument(projection,destinationDocumentId),this.events.get()):null;
    const currentImageHash=output.imageRevision?.mediaSha256??this.events.get().find(event=>event.eventId===output.sourceEventId)?.payload.source_content_hash;
    const existing=ideasInDocument(projection,destinationDocumentId).find((block)=>block.properties.source_output_id===output.id
      &&(!currentImageSources||block.type==="reference"&&!block.removed&&block.properties.source_generation_id===output.generationId
        &&block.properties.source_output_content_ref===output.contentRef&&block.properties.source_document_id===output.documentId
        &&(()=>{const receipt=[...this.events.get()].reverse().find(event=>event.type==="ReferenceIngested"&&event.payload.reference_id===block.properties.reference_id)?.payload;
          return receipt?.source_type==="generated-output"&&receipt.source_output_id===output.id&&receipt.source_generation_id===output.generationId
            &&receipt.source_document_id===output.documentId&&receipt.document_id===destinationDocumentId&&receipt.project_id===document.projectId;})()
        &&currentImageSources.some(source=>source.blockId===block.id&&source.kind==="image"&&!source.requiresUnlock&&source.mediaUrl===output.mediaUrl&&source.contentHash===currentImageHash)));
    if(existing){
      if(parent&&!projection.libraryBlockRelations.some((relation)=>isContextCompositionRelation(relation.kind)&&relation.fromBlockId===parent.id&&relation.toBlockId===existing.id)){
        if(existing.locked)return null;
        const relation={type:"BlockRelationAdded",payload:{relation_id:crypto.randomUUID(),project_id:projection.projectId,document_id:destinationDocumentId,from_block_id:parent.id,to_block_id:existing.id,kind:CONTEXT_CONTAINS_RELATION,properties:{member_order:projection.libraryBlockRelations.filter((item)=>isContextCompositionRelation(item.kind)&&item.fromBlockId===parent.id).length,relation_label:"Identity reference",relativity:1},source_surface:sourceSurface}};
        const protection=options.identityReference?[{type:"BlockPropertyEdited",payload:{block_id:existing.id,property_path:"pixel_reference_mode",old_value:existing.properties.pixel_reference_mode??"context_only",new_value:"context_only",source_surface:sourceSurface}},{type:"BlockPropertyEdited",payload:{block_id:existing.id,property_path:"context_reference_kind",old_value:existing.properties.context_reference_kind??null,new_value:"character_identity",source_surface:sourceSurface}}]:[];
        const write=await this.appendBatchWithReceipt([...protection,relation],{rebaseAttempts:6,current:imageCurrent});if(write.publication!=="published"||!imageCurrent())return this.#withheldWrite(write);if(!this.#eventWriteComplete(write,[...protection,relation]))return null;
      }
      if(options.reveal!==false)await this.revealOutputInput(existing.id,destinationDocumentId);return{rootBlockId:existing.id,created:false,blockCount:0};
    }
    const retained=output.contentRef?await this.ensurePrivateContent(output.contentRef):null;if(!imageCurrent())return null;let direction:Record<string,unknown>|null=null;if(retained)try{const parsed=JSON.parse(retained) as unknown;if(parsed&&typeof parsed==="object"&&!Array.isArray(parsed))direction=parsed as Record<string,unknown>;}catch{/* Existing image rights and pixels remain usable when optional direction is absent. */}
    const contentHash=output.imageRevision?.mediaSha256??this.events.get().find(event=>event.eventId===output.sourceEventId)?.payload.source_content_hash;
    const result=imageOutputContextEvents(output,{documentId:destinationDocumentId,projectId:document.projectId,sourceSurface,content:direction,contentHash:typeof contentHash==="string"?contentHash:null,positionStart:this.head.get()+1});if(!result.events.length){this.toast("The generated image has no durable media to use as input.");return null;}
    if(parent&&options.identityReference){const created=result.events.find((event)=>event.type==="BlockCreated");if(created){const properties=created.payload.properties as Record<string,unknown>;created.payload={...created.payload,properties:{...properties,pixel_reference_mode:"context_only",context_reference_kind:"character_identity",likeness_transfer_consent:false}};}}
    if(parent)result.events.push({type:"BlockRelationAdded",payload:{relation_id:crypto.randomUUID(),project_id:projection.projectId,document_id:destinationDocumentId,from_block_id:parent.id,to_block_id:result.blockIds[0],kind:CONTEXT_CONTAINS_RELATION,properties:{member_order:projection.libraryBlockRelations.filter((item)=>isContextCompositionRelation(item.kind)&&item.fromBlockId===parent.id).length,relation_label:options.identityReference?"Identity reference":"Reference",relativity:1},source_surface:sourceSurface}});
    const write=await this.appendBatchWithReceipt(result.events,{rebaseAttempts:6,current:imageCurrent});if(write.publication!=="published"||!imageCurrent())return this.#withheldWrite(write);const created=write.appended.filter((event)=>event.type==="BlockCreated").length;if(!created)return null;const rootBlockId=result.blockIds[0]??"";if(options.reveal!==false)await this.revealOutputInput(rootBlockId,destinationDocumentId);else this.patchUi({focusBlockId:rootBlockId});this.toast("The generated image and its editable direction are ready to reuse.");return{rootBlockId,created:true,blockCount:created};
  }

  async hot(event: EventInput, options: { keepalive?: boolean; current?: () => boolean } = {}) {
    if(this.session.get()?.impersonation||options.current&&!options.current())return;
    const attention = event.type === "AttentionEpisodeObserved";
    const attentionTicket = this.attentionPublication.ticket();
    if(attention && !this.attentionPublication.current(attentionTicket))return;
    const sourceOwner=this.captureSourceOwnership();if(!this.sourceOwnershipActive(sourceOwner))return;
    const authorization=this.#activeAuthorizationScope();
    try {
      if(!options.keepalive)await this.#appendPipeline;
      this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);
      const publish = async () => {
      if(options.current&&!options.current())return;
      const response = await fetch("/api/events/hot", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "hot", event, events: [event], clientId: "web:lit" }), keepalive: options.keepalive });
      this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);
      if (!response.ok||options.current&&!options.current()) return;
      const body = await response.json() as { appended?: CreativeEvent[]; head?: number };
      this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);
      if(options.current&&!options.current())return;
      const appended=body.appended??[];this.events.set([...this.events.get(), ...appended].sort((left,right)=>left.sequence-right.sequence)); this.head.set(Math.max(this.head.get(),body.head??0)); this.#publishAppended(appended);this.notify();
      };
      if(attention)await this.attentionPublication.publish(attentionTicket,publish);
      else await publish();
    } catch(error) {if(NativeImageRetirementError.is(error))throw error;/* Engagement instrumentation never blocks the creative action. */ }
  }

  async #nativeImagePublisherWork<T>(work:()=>Promise<T>,settle:()=>void,ordinaryFailure?:(error:unknown)=>T):Promise<T>{
    const failures:unknown[]=[];
    try{
      try{return await work();}
      catch(error){
        failures.push(error);
        if(NativeImageRetirementError.is(error)||!ordinaryFailure)throw error;
        try{return ordinaryFailure(error);}
        catch(recovery){failures.push(recovery);throw combineNativeImageRetirementFailures(failures)??recovery;}
      }
    }finally{
      try{settle();}
      // eslint-disable-next-line no-unsafe-finally -- Cleanup rejection preserves combined Image failures and existing legacy cleanup precedence.
      catch(cleanup){failures.push(cleanup);throw combineNativeImageRetirementFailures(failures)??cleanup;}
    }
  }

  async propose(prompt: string, events: EventInput[], exemplarRefs: Array<Record<string, unknown>> = []) {
    const sourceOwner=this.captureSourceOwnership();if(!this.sourceOwnershipActive(sourceOwner)){return;}
    const authorization=this.#activeAuthorizationScope();
    return this.#nativeImagePublisherWork(async()=>{
      this.busy.set("proposal"); this.notify();
      const response = await this.guardedFetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "propose", prompt, events, exemplarRefs, expectedSequence: this.head.get(), clientId: "web:lit" }) },"ask the assistant to propose document changes");
      this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);
      if (!response.ok) throw new Error("Proposal could not be recorded");
      const body = await response.json() as { appended: CreativeEvent[]; head: number };
      this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);
      this.events.set([...this.events.get(), ...body.appended]); this.head.set(body.head); this.toast("Proposal recorded — review it before applying.");
      return body.appended[0];
    },()=>{if((this.#scopeStillActive(authorization)&&this.sourceOwnershipActive(sourceOwner))){this.busy.set("");this.notify();}});
  }

  #nativeImageJob(value:unknown,setup:NativeImageSetup,reused:unknown){
    if(typeof reused!=="boolean"||!value||typeof value!=="object"||Array.isArray(value))return null;
    if(Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)return null;
    // Internal stripped job references have optional undefined fields. Omit only
    // those data values; never execute/strip an accessor to make a job admissible.
    const input:Record<string,unknown>={};
    for(const key of Reflect.ownKeys(value)){
      const field=Object.getOwnPropertyDescriptor(value,key);
      if(typeof key!=="string"||!field||!("value"in field)||!field.enumerable)return null;
      if(field.value!==undefined)Object.defineProperty(input,key,{value:field.value,enumerable:true});
    }
    const captured=captureNativeImageRead({status:"data",data:{inspection:{job:input},events:[],outputs:[]}},()=>true);
    if(captured.status!=="data")return null;
    const job=(captured.data.inspection as {job:DocumentJob}).job;
    if(!["queued","running","committing","completed","partial","failed","canceled"].includes(job.status))return null;
    const acknowledgment=captureNativeImageSubmission({disposition:"acknowledged",handle:job,reused},setup);
    return acknowledgment.disposition==="acknowledged"?{job,acknowledgment}:null;
  }

  #advanceNativeImageFence(){
    // This fence also owns independent submit/inspection scopes. It advances
    // with no UI leases; old operation finalizers cannot touch the new cohort.
    this.#nativeImageEpoch=Object.freeze({});this.#nativeImageCohort=null;
    const retired=[...this.#nativeImageLifetimes];this.#nativeImageLifetimes.clear();
    for(const lifetime of retired){lifetime.retired=true;lifetime.release();}
    this.#nativeImageRetirements.push(...retired);
  }

  #retireNativeImageLifetime(lifetime:NativeImageLifetimeRecord){
    if(lifetime.retired)return;
    lifetime.retired=true;this.#nativeImageLifetimes.delete(lifetime);lifetime.release();
    this.#nativeImageRetirements.push(lifetime);
  }

  #drainNativeImageRetirements(){
    const failures:unknown[]=[];
    if(this.#nativeImageNotificationHolds!==0)return failures;
    while(this.#nativeImageRetirements.length){
      const retired=this.#nativeImageRetirements.splice(0);
      // Detach the complete batch before calling outside code. A new opening
      // created by a callback is not part of the retired opening's cleanup.
      const batches=retired.map(lifetime=>{
        const listeners=[...lifetime.listeners];lifetime.listeners.clear();return listeners;
      });
      for(const listeners of batches)for(const listener of listeners){
        try{listener();}catch(error){failures.push(error);}
      }
    }
    return failures;
  }

  #finishNativeImageWork<T>(value:T,primary:{error:unknown}|null,failures:unknown[]):T{
    const originals=(error:unknown):unknown[]=>NativeImageRetirementError.is(error)?[...NativeImageRetirementError.originals(error)]:[error];
    if(failures.length)throw new NativeImageRetirementError([
      ...(primary?originals(primary.error):[]),...failures.flatMap(originals),
    ]);
    if(primary)throw primary.error;
    return value;
  }

  #nativeImageMutation<T>(work:()=>T,options:{fence?:boolean;holdAdmissions?:boolean}={}):T{
    this.#nativeImageNotificationHolds+=1;
    if(options.holdAdmissions)this.#nativeImageAdmissionHolds+=1;
    if(options.fence)this.#advanceNativeImageFence();
    let value!:T,primary:{error:unknown}|null=null;
    try{value=work();}catch(error){primary={error};}
    finally{
      this.#reconcileNativeImageScopes();this.#nativeImageNotificationHolds-=1;
    }
    let failures:unknown[]=[];
    try{failures=this.#drainNativeImageRetirements();}
    finally{if(options.holdAdmissions)this.#nativeImageAdmissionHolds-=1;}
    return this.#finishNativeImageWork(value,primary,failures);
  }

  async #nativeImageHeldMutation<T>(work:()=>Promise<T>,workFailureHistory?:readonly unknown[]):Promise<T>{
    // Hold new Image admission through an existing cross-await source change.
    // The epoch changes even without UI leases or registered operation users.
    this.#nativeImageAdmissionHolds+=1;this.#advanceNativeImageFence();
    const failures=this.#drainNativeImageRetirements();
    let value!:T,primary:{error:unknown}|null=null;
    try{value=await work();}catch(error){primary={error};}
    finally{this.#nativeImageAdmissionHolds-=1;}
    failures.push(...this.#drainNativeImageRetirements());
    // Nested ordinary cleanup keeps its previous winning error unless a
    // retirement failure makes the complete original work history observable.
    if(failures.length&&workFailureHistory?.length)return this.#finishNativeImageWork(value,null,[...workFailureHistory,...failures]);
    return this.#finishNativeImageWork(value,primary,failures);
  }

  #reconcileNativeImageScopes(){
    const cohort=this.#nativeImageCohort;
    if(!cohort)return;
    let current=false;
    try{current=cohort.epoch===this.#nativeImageEpoch&&cohort.current();}catch{/* A failed semantic read retires this epoch. */}
    if(!current)this.#advanceNativeImageFence();
  }

  #nativeImageCheckpoint(){
    this.#reconcileNativeImageScopes();
    this.#finishNativeImageWork(undefined,null,this.#drainNativeImageRetirements());
  }

  #nativeImageCapture<T>(capture:(current:()=>boolean)=>T,current:()=>boolean):T{
    // I1 correctly treats arbitrary throwing current predicates as stale. Keep
    // that contract, but do not lose our already-completed cleanup failures.
    const failures:NativeImageRetirementError[]=[];
    const guarded=()=>{
      try{return current();}
      catch(error){if(NativeImageRetirementError.is(error))failures.push(error);throw error;}
    };
    let value!:T,primary:{error:unknown}|null=null;
    try{value=capture(guarded);}catch(error){primary={error};}
    if(primary&&failures.some(error=>error===primary!.error))primary=null;
    return this.#finishNativeImageWork(value,primary,failures);
  }

  captureNativeImageLifetime(input:NativeImageSetup):NativeImageLifetime|null{
    const setup=captureNativeImageSetup(input);
    if(!setup||this.#nativeImageAdmissionHolds!==0)return null;
    const scope=this.#nativeImageScope(setup,()=>true);
    // Capture the candidate before draining an older retirement. A callback
    // cannot silently give this same capture a different route or source.
    try{this.#nativeImageCheckpoint();}
    catch(error){scope.dispose();throw error;}
    if(!scope.current()){scope.dispose();this.#nativeImageCheckpoint();return null;}
    const lifetime:NativeImageLifetimeRecord={retired:false,listeners:new Set(),release:scope.dispose};
    this.#nativeImageLifetimes.add(lifetime);
    const current=()=>{
      this.#reconcileNativeImageScopes();
      let value=!lifetime.retired&&scope.current();
      if(!value)this.#retireNativeImageLifetime(lifetime);
      const failures=this.#drainNativeImageRetirements();
      // Retirement listeners can reenter Store before this boolean is returned.
      this.#reconcileNativeImageScopes();
      value=value&&!lifetime.retired&&scope.current();
      if(!value)this.#retireNativeImageLifetime(lifetime);
      failures.push(...this.#drainNativeImageRetirements());
      return this.#finishNativeImageWork(value&&!lifetime.retired,null,failures);
    };
    const dispose=()=>{
      this.#retireNativeImageLifetime(lifetime);
      this.#finishNativeImageWork(undefined,null,this.#drainNativeImageRetirements());
    };
    const subscribe=(onRetire:()=>void)=>{
      if(typeof onRetire!=="function")throw new TypeError("native_image_lifetime_subscriber_required");
      if(lifetime.retired){
        const failures:unknown[]=[];try{onRetire();}catch(error){failures.push(error);}
        this.#finishNativeImageWork(undefined,null,failures);return()=>{};
      }
      lifetime.listeners.add(onRetire);
      try{current();}catch(error){lifetime.listeners.delete(onRetire);throw error;}
      return()=>{lifetime.listeners.delete(onRetire);};
    };
    return Object.freeze({current,subscribe,dispose});
  }

  #nativeImageSemanticScope(setup:NativeImageSetup){
    const epoch=this.#nativeImageEpoch;
    const source=this.captureSourceOwnership(),authorization=this.captureAuthorizationScope(),route=this.route.get();
    const owner=this.session.get()?.user.userId;
    const owned=()=>{
      if(this.#nativeImageAdmissionHolds!==0||this.#nativeImageEpoch!==epoch)return false;
      const session=this.session.get();
      if(!session||!owner||owner==="anonymous"||session.user.userId!==owner||session.projectContext||session.impersonation
        ||!["creator","admin"].includes(session.user.role)||session.policy.accepted!==true||!this.#canRequestProjectOutputs()
        ||this.#projectContextCookieGeneration!==this.#projectContextSessionGeneration||!this.authorizationScopeActive(authorization)
        ||!this.sourceOwnershipActive(source)||this.route.get()!==route||this.documentRouteState(route)!=="ready"
        ||this.#cachedHistoryRevalidation||this.asOf.get()!==Number.POSITIVE_INFINITY||this.projection.get().documentId!==setup.documentId)return false;
      const events=this.events.get();
      if(!events.every(event=>event.streamId===`creative:${owner}`))return false;
      const confirmed=foldEvents(events,Number.POSITIVE_INFINITY,setup.documentId);
      if(!confirmed.documents.some(document=>document.id===setup.documentId&&!document.removed)
        ||confirmed.documentId!==setup.documentId||confirmed.projectId!==this.projection.get().projectId)return false;
      // Saved input identity, not the changing job/event head. Normal unpinned
      // completion hydration leaves this revision unchanged; optimistic inputs do not.
      return this.#generationContext(setup.documentId,"","headshot",confirmed).documentRevision===setup.documentRevision
        &&this.#generationContext(setup.documentId).documentRevision===setup.documentRevision;
    };
    return {epoch,source,authorization,owned};
  }

  #nativeImageScope(setup:NativeImageSetup,openingCurrent:()=>boolean){
    this.#reconcileNativeImageScopes();
    const {epoch,source,authorization,owned}=this.#nativeImageSemanticScope(setup);
    let retired=false,released=false,cohort:NativeImageSemanticCohort|null=null;
    try{
      if(owned()){
        cohort=this.#nativeImageCohort;
        if(!cohort){cohort={epoch,users:0,current:owned};this.#nativeImageCohort=cohort;}
        // Every member passed the original personal source/route/Document and
        // both revision checks in this same epoch. The witness owns no caller
        // predicate or pending operation; it is not a cached revision verdict.
        cohort.users+=1;
      }else retired=true;
    }catch{retired=true;}
    const dispose=()=>{
      if(released)return;released=true;retired=true;
      if(cohort&&this.#nativeImageCohort===cohort&&this.#nativeImageEpoch===epoch){
        cohort.users-=1;
        if(cohort.users===0)this.#nativeImageCohort=null;
      }
      cohort=null;
    };
    return {source,authorization,current:()=>{
      if(retired)return false;
      try{if(!owned()||openingCurrent()!==true||!owned())retired=true;}
      catch(error){retired=true;if(NativeImageRetirementError.is(error)){dispose();throw error;}}
      return!retired;
    },dispose};
  }

  /** One saved-personal Image request, not a new grant, Document, or retry policy. */
  async submitNativeImage(input:NativeImageSetup,controls:{current:()=>boolean;signal?:AbortSignal;onAcknowledgment?:(acknowledgment:Extract<NativeImageSubmission,{disposition:"acknowledged"}>)=>void}):Promise<NativeImageSubmission>{
    const unavailable=()=>Object.freeze({disposition:"not-dispatched",handle:null,reason:"unavailable"} as const);
    const setup=captureNativeImageSetup(input);
    if(!setup)return unavailable();
    const scope=this.#nativeImageScope(setup,controls.current);
    try{
      this.#nativeImageCheckpoint();
      let invoked=false,received:Extract<NativeImageSubmission,{disposition:"acknowledged"}>|null=null;
      try{
        if(!scope.current())return unavailable();
        const confirmed=foldEvents(this.events.get(),Number.POSITIVE_INFINITY,setup.documentId);
        const context=this.#generationContext(setup.documentId,"","headshot",confirmed);
        if(!scope.current())return unavailable();
        const result=await this.#startDocumentJob("generate",{...context,requestKey:setup.requestKey,promptTechnique:setup.promptTechnique,
          productionMode:"manual",sourcePreviewId:null,preflightAcknowledged:this.generationRiskAcknowledged(setup.requestKey)},
          setup.sourceSurface,setup.documentId,{nativeImage:setup,current:scope.current,onInvoke:()=>{invoked=true;},
            onAcknowledgment:acknowledgment=>{received=acknowledgment;controls.onAcknowledgment?.(acknowledgment);},
          });
        // Same-authorization late ACK is historical identity only. The shared start
        // path strips/pauses its job on retirement; it cannot publish private result.
        if(!this.authorizationScopeActive(scope.authorization))throw new Error("native_image_authorization_changed");
        const exact=this.#nativeImageJob(result.job,setup,result.reused);
        if(exact){
          // Capture the immutable original ACK before any reentrant recipient.
          // A later run failure rejects physical settlement, not this identity.
          if(!received||JSON.stringify(received)!==JSON.stringify(exact.acknowledgment))throw new Error("native_image_acknowledgment_changed");
          if(!result.reused&&scope.current()&&exact.job.status==="queued")
            await this.#runNativeImageInitial(exact.job,exact.acknowledgment.handle,scope,controls.signal);
          return exact.acknowledgment;
        }
      }catch(error){
        if(received||NativeImageRetirementError.is(error))throw error;
        try{
          if(!invoked&&scope.current()&&error instanceof GenerationBudgetAdmissionError)
            return Object.freeze({disposition:"not-dispatched",handle:null,reason:error.reason});
        }catch(cleanup){const combined=combineNativeImageRetirementFailures([error,cleanup]);if(combined)throw combined;throw cleanup;}
      }
      return invoked?Object.freeze({disposition:"dispatched-unconfirmed",handle:null}):unavailable();
    }finally{scope.dispose();}
  }

  #nativeImageQueueTurn(original:DocumentJob,handle:NativeImageHandle,current:()=>boolean,deadline:number):"ready"|"waiting"|"retired"{
    if(!current())return "retired";
    if(Date.now()>=deadline)throw new Error("native_image_initial_queue_wait_expired");
    const jobs=this.documentJobs.get(),rows=jobs.filter(job=>job.jobId===handle.jobId);
    if(rows.length>1)throw new Error("native_image_initial_queue_identity_mismatch");
    if(!rows.length)return "waiting";
    const row=rows[0]!,captured=captureNativeImageHandle(row);
    if(!captured||JSON.stringify(captured)!==JSON.stringify(handle)||row.requestedAt!==original.requestedAt)
      throw new Error("native_image_initial_queue_identity_mismatch");
    if(!current())return "retired";
    if(row.status!=="queued")return "retired";
    if(row.attemptCount!==0||row.startedAt!==null||!Number.isFinite(Date.parse(original.requestedAt)))
      throw new Error("native_image_initial_queue_not_unused");
    // Personal Document lists include every active personal job. Saturation or
    // omission cannot prove a turn; only this still-live Create retains intent.
    // Queued Slides are explicitly exempt in the existing server queue query.
    const blocked=jobs.length>=120||jobs.some(job=>job.jobId!==handle.jobId&&job.kind!=="prompt_fan"
      &&(job.status==="running"||job.status==="committing"||job.status==="queued"
        &&!(job.kind==="render_document"&&job.result?.artifactKind==="slides")
        &&(job.requestedAt<original.requestedAt||job.requestedAt===original.requestedAt&&job.jobId<handle.jobId)));
    if(!current())return "retired";
    return blocked||this.documentJobs.get()!==jobs?"waiting":"ready";
  }

  async #waitNativeImageQueueTurn(original:DocumentJob,handle:NativeImageHandle,scope:{current:()=>boolean},deadline:number,signal?:AbortSignal){
    const current=()=>!signal?.aborted&&scope.current();
    const initial=this.#nativeImageQueueTurn(original,handle,current,deadline);
    if(initial!=="waiting")return initial==="ready";
    // This local subscription cannot be recreated by a list/visibility event.
    // It expires instead of retaining a provider-start intent indefinitely.
    return await new Promise<boolean>((resolve,reject)=>{
      // eslint-disable-next-line prefer-const -- Forward cleanup handles stay unset until their subscription and timer registrations complete.
      let done=false,timer:number|undefined,release:(()=>void)|undefined;
      const finish=(ready:boolean,failure?:{error:unknown})=>{
        if(done)return;done=true;
        release?.();if(timer!==undefined)window.clearTimeout(timer);
        signal?.removeEventListener("abort",check);
        if(failure)reject(failure.error);else resolve(ready);
      };
      const check=()=>{
        if(done)return;
        try{const next=this.#nativeImageQueueTurn(original,handle,current,deadline);if(next!=="waiting")finish(next==="ready");}
        catch(error){finish(false,{error});}
      };
      release=this.subscribe(check);signal?.addEventListener("abort",check,{once:true});
      timer=window.setTimeout(()=>{
        check();if(!done)finish(false,{error:new Error("native_image_initial_queue_wait_expired")});
      },Math.max(0,deadline-Date.now()));
      check();
      try{if(!done)this.#scheduleJobPoll(800);}catch(error){finish(false,{error});}
    });
  }

  async #runNativeImageInitial(original:DocumentJob,handle:NativeImageHandle,scope:{authorization:CapturedAuthorizationScope|null;current:()=>boolean},signal?:AbortSignal){
    // Only this fresh acknowledged invocation may start once. Passive reads,
    // visibility changes and a replayed/reused ACK never enter this method.
    const deadline=Date.now()+300_000;
    if(!await this.#waitNativeImageQueueTurn(original,handle,scope,deadline,signal))return;
    const current=()=>!signal?.aborted&&this.#nativeImageQueueTurn(original,handle,scope.current,deadline)==="ready";
    if(!current())return;
    let invoked=false;
    const response=await this.guardedFetch(`/api/document-jobs/${encodeURIComponent(handle.jobId)}/run`,
      {method:"POST"},"start the acknowledged Image request",{
        current:()=>invoked||current(),onInvoke:()=>{invoked=true;},
      });
    // The caller's signal ends only the pre-run wait. Once invoked, the exact
    // physical response stays observed; neither retirement nor abort retries it.
    const body=await this.#nativeImageInspectionBody(response,()=>this.authorizationScopeActive(scope.authorization));
    if(!response.ok||!body||typeof body!=="object")throw new Error("native_image_initial_run_unconfirmed");
    const row=Object.getOwnPropertyDescriptor(body,"job");
    const returned=row&&"value"in row?captureNativeImageHandle(row.value):null;
    if(!returned||JSON.stringify(returned)!==JSON.stringify(handle))throw new Error("native_image_initial_run_identity_mismatch");
    const status=Object.getOwnPropertyDescriptor(row!.value,"status");
    if(!status||!("value"in status)||!["running","committing","completed","partial","failed","canceled"].includes(status.value))
      throw new Error("native_image_initial_run_not_started");
    // Immediate completion must be available to the first explicit Check.
    // Read-only publication excludes action dispatch, focal maintenance and ACK.
    if(status.value==="completed"&&scope.current())await this.refreshEvents({readOnly:true,current:scope.current});
    if(scope.current())this.#scheduleJobPoll(350);
  }

  async #nativeImageInspectionBody(response:Response,current:()=>boolean):Promise<unknown>{
    if(!response.body)return null;
    const reader=response.body.getReader(),chunks:Uint8Array[]=[];
    const failures:unknown[]=[];let length=0,finished=false,discard=false;
    try{
      while(true){
        if(!response.ok||!current()){discard=true;break;}
        const next=await reader.read();
        if(next.done){finished=true;break;}
        if(!(next.value instanceof Uint8Array))throw new Error("native_image_inspection_chunk");
        length+=next.value.byteLength;
        // Consumer byte policy, not a native allocation or wall-clock guarantee.
        if(length>1_048_576||!current()){discard=true;break;}
        if(next.value.byteLength)chunks.push(next.value.slice());
      }
    }catch(error){failures.push(error);}
    let cancellation:Promise<{failed:false}|{failed:true;error:unknown}>|null=null;
    if(!finished){
      try{cancellation=reader.cancel().then(()=>({failed:false as const}),error=>({failed:true as const,error}));}
      catch(error){failures.push(error);}
    }
    let releaseFailure:{error:unknown}|null=null;
    try{reader.releaseLock();}catch(error){releaseFailure={error};}
    // Available lock cleanup is attempted independently before waiting for an
    // uncooperative cancellation. Both original cleanup outcomes are retained.
    if(cancellation){const canceled=await cancellation;if(canceled.failed)failures.push(canceled.error);}
    if(releaseFailure)failures.push(releaseFailure.error);
    const retirementFailure=combineNativeImageRetirementFailures(failures);
    if(retirementFailure)throw retirementFailure;
    if(failures.length===1)throw failures[0];
    if(failures.length>1)throw new AggregateError(failures,"Image inspection read/cleanup failed",{cause:failures[0]});
    if(discard||!current())return null;
    const bytes=new Uint8Array(length);let offset=0;
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    try{return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));}catch{return null;}
  }

  /** Passive personal job inspection plus already-confirmed Store evidence only. */
  async inspectNativeImage(input:NativeImageHandle,controls:{current:()=>boolean;signal:AbortSignal}):Promise<NativeImageRead>{
    const unavailable=()=>Object.freeze({status:"unavailable"} as const),superseded=()=>Object.freeze({status:"superseded"} as const);
    const handle=captureNativeImageHandle(input),path=nativeImageInspectionPath(handle);
    if(!handle||!path)return unavailable();
    const {jobId,requestedSequence,promptFanId,parentJobId,fanKind,members,...setup}=handle;
    const scope=this.#nativeImageScope(setup,controls.current);
    try{
    this.#nativeImageCheckpoint();
    const current=()=>!controls.signal.aborted&&scope.current();
    if(!current())return superseded();
    const response=await fetch(path,{method:"GET",credentials:"same-origin",cache:"no-store",signal:controls.signal});
    const body=await this.#nativeImageInspectionBody(response,current);
    if(!current())return superseded();
    if(!response.ok)return unavailable();
    // Workspace retains the Image receipt/alias/output-state evidence. It is
    // not a census of excluded telemetry or proof of global stream uniqueness.
    if(eventProfileRank(this.#historyProfile)<eventProfileRank("workspace"))return unavailable();
    const captured=this.#nativeImageCapture(guard=>captureNativeImageRead({status:"data",data:{inspection:body,events:[],outputs:[]}},guard),current);
    if(captured.status!=="data")return captured;
    const inspection=captured.data.inspection as {job:DocumentJob},job=inspection.job;
    const preliminary=this.#nativeImageCapture(guard=>joinNativeImageCompletion(handle,captured.data,guard),current);
    if(preliminary.status==="pending"||preliminary.status==="terminal")return captured;
    if(job.status!=="completed")return unavailable();
    const references=job.result?.appendedEventIds;
    if(!Array.isArray(references)||references.length===0||references.length>NATIVE_IMAGE_LIMITS.candidates
      ||!references.every(id=>typeof id==="string")||new Set(references).size!==references.length)return unavailable();
    const confirmed=this.events.get(),referenceIds=new Set(references);
    const snapshotCurrent=()=>this.events.get()===confirmed&&current()&&this.events.get()===confirmed;
    const selected=confirmed.filter(event=>referenceIds.has(event.eventId));
    const generations=new Set(selected.filter(event=>event.type==="GenerationCompleted").map(event=>event.payload.generation_id));
    const objects=new Set(selected.filter(event=>event.type==="GenerationCompleted").flatMap(event=>Array.isArray(event.payload.object_ids)?event.payload.object_ids:[]));
    const produces=(event:CreativeEvent)=>event.type==="GenerationCompleted"||event.type==="IdeationPreviewCompleted";
    const outputIds=(event:CreativeEvent)=>event.type==="GenerationCompleted"?(Array.isArray(event.payload.object_ids)?event.payload.object_ids:[]):[event.payload.object_id];
    const related=confirmed.filter(event=>referenceIds.has(event.eventId)||produces(event)
      &&(generations.has(event.payload.generation_id)||outputIds(event).some(id=>objects.has(id))));
    // Preserve aliases outside appendedEventIds and collisions a Map-based fold
    // could otherwise hide. Never deduplicate records or truncate to the cap.
    const relatedIds=new Set(related.map(event=>event.eventId)),sequences=new Set(related.map(event=>event.sequence));
    const events=confirmed.filter(event=>relatedIds.has(event.eventId)||sequences.has(event.sequence));
    if(events.length>NATIVE_IMAGE_LIMITS.candidates)return unavailable();
    const rawOutputIds=events.filter(produces).flatMap(outputIds);
    if(new Set(rawOutputIds).size!==rawOutputIds.length)return unavailable();
    const outputs=foldEvents(confirmed,Number.POSITIVE_INFINITY,handle.documentId).libraryOutputs
      .filter(output=>generations.has(output.generationId)||objects.has(output.id));
    if(outputs.length>NATIVE_IMAGE_LIMITS.candidates)return unavailable();
    const result=this.#nativeImageCapture(guard=>captureNativeImageRead({status:"data",data:{inspection,events,outputs}},guard),snapshotCurrent);
    if(result.status!=="data")return result;
    const joined=this.#nativeImageCapture(guard=>joinNativeImageCompletion(handle,result.data,guard),snapshotCurrent);
    if(joined.status==="superseded")return superseded();
    return joined.status==="matched"?result:unavailable();
    }finally{scope.dispose();}
  }

  async preview(sourceSurface?: string,promptTechnique?:PromptTechnique,productionMode:ProductionMode="manual") {
    const technique=normalizePromptTechnique(promptTechnique??this.promptTechniquePreference().technique);
    try{const context=this.#generationContext();const baseRequestKey=generationRequestKeyFor("preview",context.documentRevision,null,technique);const requestKey=productionMode==="managed"?`${baseRequestKey}:managed`:baseRequestKey;const {reused}=await this.#startDocumentJob("preview",{...context,requestKey,promptTechnique:technique,productionMode,preflightAcknowledged:this.generationRiskAcknowledged(requestKey)},sourceSurface??"studio");this.toast(reused?"This exact draft is already in the queue.":productionMode==="managed"?"Your image art-direction team is preparing a source-grounded draft.":technique==="prose"?this.#systemNotice("Draft queued. You can keep editing and queue the updated document too."):this.#systemNotice("{technique} draft queued. You can keep editing and queue the updated document too.",{technique:this.#systemNotice(technique)}));}catch(error){this.toast(error instanceof Error?error.message:"Draft generation failed");}
  }

  async generate(options?: string | { sourceSurface?: string; sourcePreviewId?: string; promptTechnique?: PromptTechnique; productionMode?:ProductionMode; workflowId?:string; workflowStageId?:string; workflowSources?:ProductionWorkflowSource[] }) {
    const sourceSurface=typeof options==="string"?options:options?.sourceSurface;const sourcePreviewId=typeof options==="string"?undefined:options?.sourcePreviewId;const technique=normalizePromptTechnique(typeof options==="string"?this.promptTechniquePreference().technique:options?.promptTechnique??this.promptTechniquePreference().technique);
    try {
      const productionMode=typeof options==="string"?"manual":options?.productionMode??"manual";const context=this.#generationContext();const baseRequestKey=generationRequestKeyFor("generate",context.documentRevision,sourcePreviewId,technique);const standardRequestKey=productionMode==="managed"?`${baseRequestKey}:managed`:baseRequestKey;const workflow=typeof options!=="string"&&options?.workflowId&&options.workflowStageId?{workflowId:options.workflowId,workflowStageId:options.workflowStageId,workflowSources:options.workflowSources??[]}:null;const requestKey=workflow?this.productionWorkflowGenerationRequestKey(workflow.workflowId,workflow.workflowStageId,workflow.workflowSources,{sourcePreviewId,promptTechnique:technique,productionMode}):standardRequestKey;const {reused}=await this.#startDocumentJob("generate",{sourcePreviewId,...context,requestKey,promptTechnique:technique,productionMode,preflightAcknowledged:this.generationRiskAcknowledged(requestKey),...(workflow??{})},sourceSurface??"studio");this.toast(reused?"This exact full-quality image is already in the queue.":productionMode==="managed"?"Your image art-direction team is preparing the finished image.":technique==="prose"?this.#systemNotice("Full-quality generation queued. You can keep editing and queue the updated document too."):this.#systemNotice("{technique} full-quality generation queued. You can keep editing and queue the updated document too.",{technique:this.#systemNotice(technique)}));
    } catch (error) { this.toast(error instanceof Error ? error.message : "Generation failed"); }
  }

  /** Paid portrait work is scoped and admitted through the same audited readiness pipeline. */
  async generateCharacterStudy(rootBlockId:string,kind:"headshot"|"character_sheet"="headshot"){
    const projection=this.projection.get();
    if(!projection.blocks.some((block)=>block.id===rootBlockId&&block.type==="subject"))return false;
    const context=this.#generationContext(projection.documentId,rootBlockId,kind),technique=this.promptTechniquePreference().technique;
    const requestKey=this.characterGenerationRequestKey(rootBlockId,kind),sourceSurface=kind==="headshot"?"character-headshot-context":"character-sheet-context";
    const readiness=await this.ensureGenerationReadiness("generate",{sourceSurface,requestKey,promptTechnique:technique,contextRootBlockId:rootBlockId,characterOutputKind:kind});
    if(!readiness||readiness.status!=="ready"&&(readiness.status!=="review"||!this.generationRiskAcknowledged(requestKey))){this.toast(readiness?.summary||"Generation readiness could not be confirmed.");return false;}
    try{const{reused}=await this.#startDocumentJob("generate",{...context,contextRootBlockId:rootBlockId,characterOutputKind:kind,requestKey,promptTechnique:technique,productionMode:"manual",preflightAcknowledged:this.generationRiskAcknowledged(requestKey)},sourceSurface);if(!reused)this.toast("Full-quality generation queued. You can keep editing and queue the updated document too.");return true;}
    catch(error){if(error instanceof Error)this.toast(error.message);return false;}
  }

  async generatePromptFan(kind:"preview"|"generate",options:{sourceSurface?:string;sourcePreviewId?:string;productionMode?:ProductionMode}={}){
    const context=this.#generationContext();const promptFanId=crypto.randomUUID();const productionMode=options.productionMode??"manual";const baseRequestKey=`prompt-fan:${kind}:${context.documentRevision}:${options.sourcePreviewId||"document"}`;const requestKey=productionMode==="managed"?`${baseRequestKey}:managed`:baseRequestKey;
    try{const {reused}=await this.#startDocumentJob("prompt_fan",{...context,fanKind:kind,sourcePreviewId:options.sourcePreviewId,requestKey,promptFanId,productionMode,preflightAcknowledged:this.generationRiskAcknowledged(requestKey)},options.sourceSurface??"studio");this.toast(reused?"This exact fan is already in the queue.":productionMode==="managed"?this.#systemNotice("Your image art-direction team is preparing four {quality} approaches.",{quality:this.#systemNotice(kind==="preview"?"draft":"full-quality")}):this.#systemNotice("{quality} fan accepted as one generation · four prompt processes.",{quality:this.#systemNotice(kind==="preview"?"Draft":"Full-quality")}));}catch(error){this.toast(error instanceof Error?error.message:"The fan generation could not be started.");}
    return promptFanId;
  }

  async retryDocumentGeneration(job:DocumentJob,promptTechnique?:PromptTechnique){
    if(hasServerExecutionOwner(job)||this.#serverOwnedJob(job.jobId))return;
    const technique=normalizePromptTechnique(promptTechnique??job.promptTechnique);const productionMode=job.productionMode??"manual";
    if(job.kind==="generate"&&job.sourceSurface.startsWith("workflow:")){
      const [,workflowId,...stageParts]=job.sourceSurface.split(":");const workflowStageId=stageParts.join(":");const projection=this.projection.get();const workflow=productionWorkflows(this.events.get(),job.documentId,projection.projectId).find((candidate)=>candidate.id===workflowId);const stage=workflow?.stages.find((candidate)=>candidate.id===workflowStageId&&candidate.format==="image"&&candidate.enabled);if(!workflow||!stage){this.toast(this.#systemNotice("Review & change request"));return;}
      const states=productionWorkflowStageStates(workflow,projection,this.events.get());const state=states.find((candidate)=>candidate.stage.id===stage.id);if(!state||!["missing","ready"].includes(state.status)){this.toast(this.#systemNotice("Review & change request"));return;}
      const workflowSources=productionWorkflowSourcesForStage(workflow,stage.id,states);const requestKey=this.productionWorkflowGenerationRequestKey(workflow.id,stage.id,workflowSources,{sourcePreviewId:job.sourcePreviewId,promptTechnique:technique,productionMode});const readiness=await this.ensureGenerationReadiness("generate",{sourcePreviewId:job.sourcePreviewId,promptTechnique:technique,productionMode,sourceSurface:job.sourceSurface,requestKey,workflowId:workflow.id,workflowStageId:stage.id,workflowSources});if(!readiness||readiness.status!=="ready"&&(readiness.status!=="review"||!this.generationRiskAcknowledged(requestKey))){this.toast(this.#systemNotice("Review & change request"));return;}return this.generate({sourceSurface:job.sourceSurface,sourcePreviewId:job.sourcePreviewId??undefined,promptTechnique:technique,productionMode,workflowId:workflow.id,workflowStageId:stage.id,workflowSources});
    }
    if(promptTechnique){const kind=job.kind==="prompt_fan"?job.fanKind??"generate":job.kind==="preview"?"preview":"generate";this.#readinessAcknowledgements.add(this.generationReadinessRequestKey(kind,job.sourcePreviewId,technique,productionMode));}
    if(job.kind==="preview")return this.preview(job.sourceSurface,technique,productionMode);
    if(job.kind==="generate")return this.generate({sourceSurface:job.sourceSurface,sourcePreviewId:job.sourcePreviewId??undefined,promptTechnique:technique,productionMode});
    if(job.kind==="prompt_fan"&&job.fanKind&&promptTechnique)return job.fanKind==="preview"?this.preview(job.sourceSurface,technique,productionMode):this.generate({sourceSurface:job.sourceSurface,sourcePreviewId:job.sourcePreviewId??undefined,promptTechnique:technique,productionMode});
    if(job.kind==="prompt_fan"&&job.fanKind)return this.generatePromptFan(job.fanKind,{sourceSurface:job.sourceSurface,sourcePreviewId:job.sourcePreviewId??undefined,productionMode});
  }

  async preferPromptTechnique(technique:PromptTechnique,scope:PromptPreferenceScope,source:{fanId?:string|null;outputId?:string|null}={}){
    const sourceOwner=this.captureSourceOwnership();if(!this.sourceOwnershipActive(sourceOwner))return false;
    const projection=this.projection.get(),collectionId=projection.membership[projection.documentId]?.collectionId;
    const scopeId=scope==="document"?projection.documentId:scope==="collection"?collectionId:scope==="project"?projection.projectId:this.session.get()?.user.userId;
    if(!scopeId){this.toast("File this document in a collection before setting a folder preference.");return false;}
    const event:EventInput={type:"PromptTechniquePreferred",payload:{preference_id:crypto.randomUUID(),preference_kind:"prompt_technique",technique:normalizePromptTechnique(technique),scope,scope_id:scopeId,document_id:projection.documentId,project_id:projection.projectId,source_fan_id:source.fanId??null,source_output_id:source.outputId??null}};
    const result=await this.appendWithReceipt(event),saved=this.sourceOwnershipActive(sourceOwner)&&this.#eventWriteComplete(result,[event]);
    if(saved)this.toast(this.#systemNotice("{technique} prompts preferred for this {scope}.",{technique:this.#systemNotice(normalizePromptTechnique(technique)),scope:this.#systemNotice(scope==="collection"?"folder":scope)}));return saved;
  }

  async adoptCanvasOutputItems(items:readonly{sourceKind:string;sourceId:string}[],documentId:string,sourceSurface="canvas-generation"){
    const sourceOwner=this.captureSourceOwnership();if(!this.sourceOwnershipActive(sourceOwner))return null;
    const projection=this.projection.get();if(!projection.documents.some((document)=>document.id===documentId)){this.toast("Choose an available document before reusing the selected outputs.");return null;}
    const unique=new Map<string,{sourceKind:string;sourceId:string}>();for(const item of items)if(item.sourceKind==="output"||item.sourceKind==="artifact")unique.set(`${item.sourceKind}:${item.sourceId}`,item);
    for(const item of unique.values()){
      if(item.sourceKind==="output"){const output=projection.libraryOutputs.find((candidate)=>candidate.id===item.sourceId),existing=ideasInDocument(projection,documentId).find((block)=>block.properties.source_output_id===item.sourceId);if(!output||!existing?.properties.media_url&&!output.mediaUrl){this.toast("A selected generated image is unavailable, so your document was left unchanged.");return null;}continue;}
      const artifact=projection.libraryArtifacts.find((candidate)=>candidate.id===item.sourceId);if(!artifact){this.toast("A selected output is unavailable, so your document was left unchanged.");return null;}
      const existingRoot=ideasInDocument(projection,documentId).find((block)=>block.properties.source_artifact_id===artifact.id&&!block.properties.source_artifact_item_id);const ownedIds=new Set(projection.libraryBlockRelations.filter((relation)=>relation.kind==="artifact_contains"&&relation.fromBlockId===existingRoot?.id).map((relation)=>relation.toBlockId));const finished=new Set(artifact.items.filter((entry)=>Boolean(entry.mediaUrl)&&(artifact.kind!=="video"||String(entry.mediaType??"").startsWith("video/"))).map((entry)=>entry.id));const available=new Set(projection.libraryBlocks.filter((block)=>ownedIds.has(block.id)&&finished.has(String(block.properties.source_artifact_item_id??""))).map((block)=>String(block.properties.source_artifact_item_id)));if(existingRoot&&((artifact.kind!=="storyboard"&&artifact.kind!=="video")||available.size===finished.size))continue;
      if(artifact.contentRef&&!parseDocumentArtifactContent(await this.ensurePrivateContent(artifact.contentRef)??undefined)){this.toast(this.#systemNotice("{title} is unavailable, so your document was left unchanged.",{title:artifact.title}));return null;}
    }
    const rootIds:string[]=[];for(const item of unique.values()){const result=item.sourceKind==="output"?await this.addImageOutputAsContext(item.sourceId,documentId,`${sourceSurface}-output`,{reveal:false}):await this.addArtifactAsContext(item.sourceId,documentId,`${sourceSurface}-artifact`,{reveal:false});if(!this.sourceOwnershipActive(sourceOwner)||!result||"publication"in result||!result.rootBlockId)return null;rootIds.push(result.rootBlockId);}
    return rootIds;
  }

  async generateCanvasContext(kind:"preview"|"generate"|"preview_fan"|"generate_fan",contextSet:CanvasContextSet,sourcePreviewId?:string,destinationDocumentId?:string){
    let projection=this.projection.get();const canvas=this.canvasProjection.get();const itemIds=new Set(contextSet.itemIds);const visitedSets=new Set<string>();const expandSet=(setId:string)=>{if(visitedSets.has(setId))return;visitedSets.add(setId);const nested=canvas.contextSets.find((candidate)=>candidate.id===setId);if(!nested)return;for(const itemId of nested.itemIds){itemIds.add(itemId);const item=canvas.items.find((candidate)=>candidate.id===itemId);if(item?.sourceKind==="context")expandSet(item.sourceId);}};for(const itemId of [...itemIds]){const item=canvas.items.find((candidate)=>candidate.id===itemId);if(item?.sourceKind==="context")expandSet(item.sourceId);}const selectedItems=canvas.items.filter((item)=>itemIds.has(item.id)&&item.sourceKind!=="context");
    const selectedDocumentIds=selectedItems.filter((item)=>item.sourceKind==="document").map((item)=>item.sourceId);const anchorDocumentId=destinationDocumentId??this.canvasPlanningDocumentId();if(!anchorDocumentId||!projection.documents.some((document)=>document.id===anchorDocumentId&&document.projectId===canvas.projectId)||contextSet.canvasId!==canvas.selectedCanvasId){this.toast(currentFormaLocale().messages["next.exact.chooseDocument"]??"Choose a document");return false;}
    const blockIds=new Set(contextSet.blockIds);for(const nestedId of visitedSets){const nested=canvas.contextSets.find((candidate)=>candidate.id===nestedId);for(const blockId of nested?.blockIds??[])blockIds.add(blockId);}
    const roots=await this.adoptCanvasOutputItems(selectedItems,anchorDocumentId);if(!roots)return false;projection=this.projection.get();for(const rootId of roots)blockIds.add(rootId);
    for(const documentId of [...contextSet.documentIds,...selectedDocumentIds])for(const block of ideasInDocument(projection,documentId))blockIds.add(block.id);
    let expanded=true;while(expanded){expanded=false;for(const relation of projection.libraryBlockRelations)if((relation.kind==="artifact_contains"||isContextCompositionRelation(relation.kind))&&blockIds.has(relation.fromBlockId)&&!blockIds.has(relation.toBlockId)){blockIds.add(relation.toBlockId);expanded=true;}}
    const blocks=projection.libraryBlocks.filter((block)=>blockIds.has(block.id));const selectedBySource=new Map(selectedItems.map((item)=>[item.sourceId,item]));
    const factBlocks=blocks.filter((block)=>!isOutputContextBlock(block));const factBlockIds=new Set(factBlocks.map((block)=>block.id));
    const facts=factBlocks.map((block)=>{const item=selectedBySource.get(block.id)??selectedBySource.get(String(block.properties.source_output_id??block.properties.source_artifact_id??""));return{block_id:block.id,canvas_id:contextSet.canvasId,context_set_id:contextSet.id,type:block.type,role:block.type,intent:blockIntentFor(block.type,block.properties),handle:block.handle,active:Number(block.properties.weight??.5)>0,effect:blockEffectFor(block.type,block.properties),properties:{...block.properties,spatial_scope:normalizeSpatialScope(block.properties.spatial_scope)},authority:block.properties.authority??"authored",source_event_refs:[...block.sourceEvents,...(item?.sourceEvents??[])]};});const relationships=projection.libraryBlockRelations.filter((relation)=>factBlockIds.has(relation.fromBlockId)&&factBlockIds.has(relation.toBlockId)).map((relation)=>({relation_id:relation.id,from_block_id:relation.fromBlockId,to_block_id:relation.toBlockId,kind:relation.kind,properties:relation.properties,source_event_refs:relation.sourceEvents}));const snapshot={facts,relationships,context_groups:combinedContextGroups({facts,relationships}),pins:[...new Set([...contextSet.outputIds,...selectedItems.filter((item)=>item.sourceKind==="output").map((item)=>item.sourceId),...projection.libraryOutputs.filter((output)=>output.canvasId===contextSet.canvasId&&output.pinned).map((output)=>output.id)])],canvas:{canvas_id:contextSet.canvasId,context_set_id:contextSet.id,item_ids:contextSet.itemIds,formalized_as_of_sequence:contextSet.asOfSequence,spatial_arrangement_is_semantic:false,arrangement_is_context:false,provenance_frames:selectedItems.map((item)=>({item_id:item.id,source_kind:item.sourceKind,source_id:item.sourceId,frame:{x:item.x,y:item.y,w:item.w,h:item.h,rotation:item.rot,z:item.z}}))},tail:[]};
    const context={snapshot,sourceBlockVersions:blocks.map((block)=>({block_id:block.id,version:block.sourceEvents.length})),documentId:anchorDocumentId,canvasId:contextSet.canvasId,contextSetId:contextSet.id};const documentRevision=generationRevisionFor(context);const filed=projection.membership[anchorDocumentId];const technique=effectivePromptPreference(projection.preferences,{documentId:anchorDocumentId,collectionIds:filed?[filed.collectionId]:[],projectId:projection.projectId,accountId:this.session.get()?.user.userId}).technique;const fan=kind.endsWith("_fan");const fanKind=kind.startsWith("preview")?"preview":"generate";const jobKind:"preview"|"generate"|"prompt_fan"=fan?"prompt_fan":fanKind;const promptFanId=fan?crypto.randomUUID():undefined;const requestKey=fan?`canvas:prompt-fan:${fanKind}:${contextSet.id}:${documentRevision}:${sourcePreviewId??"context"}`:`canvas:${kind}:${contextSet.id}:${documentRevision}:${sourcePreviewId??"context"}`;
    try{const {reused}=await this.#startDocumentJob(jobKind,{...context,documentRevision,requestKey,promptTechnique:technique,sourcePreviewId,...(fan?{fanKind,promptFanId}:{})},"canvas",anchorDocumentId);const quality=fanKind==="preview"?"Draft":"Full-quality";this.toast(reused?"This exact Canvas generation is already queued.":fan?this.#systemNotice("{quality} fan queued as one four-image comparison for {name}.",{quality:this.#systemNotice(quality),name:contextSet.name}):this.#systemNotice("{quality} Canvas generation queued from {name}.",{quality:this.#systemNotice(quality),name:contextSet.name}));return true;}catch(error){this.toast(error instanceof Error?error.message:"Canvas generation could not be started.");return false;}
  }

  async promotePromptFanOutputs(promptFanId:string,outputIds:string[]){
    const sourceOwner=this.captureSourceOwnership();if(!this.sourceOwnershipActive(sourceOwner))return false;
    const projection=this.projection.get(),requested=new Set(outputIds),outputs=projection.outputs.filter(output=>output.promptFanId===promptFanId&&requested.has(output.id)&&!output.standalone);
    if(!outputs.length){this.toast("Those fan results already stand on their own.");return false;}
    const events=outputs.map(output=>({type:"PromptFanOutputPromoted",payload:{object_id:output.id,prompt_fan_id:promptFanId,prompt_technique:output.promptTechnique,document_id:projection.documentId,project_id:projection.projectId,source_surface:"prompt-fan-comparison"}}));
    const result=await this.appendBatchWithReceipt(events),saved=this.sourceOwnershipActive(sourceOwner)&&this.#eventWriteComplete(result,events);
    if(saved)this.toast(result.appended.length===1?this.#systemNotice("{count} fan result now stands alone in the generation history.",{count:result.appended.length}):this.#systemNotice("{count} fan results now stand alone in the generation history.",{count:result.appended.length}));return saved;
  }

  async chat(message:string,livePreview=true,locale=document.documentElement.lang||"en") {
    const sourceOwner=this.captureSourceOwnership(),documentId=this.projection.get().documentId,route=this.route.get();
    const current=()=>this.sourceOwnershipActive(sourceOwner)&&this.projection.get().documentId===documentId&&this.route.get()===route;
    try{
      const {reused}=await this.#startDocumentJob("chat",{message,livePreview,documentId,locale,promptTechnique:this.promptTechniquePreference().technique},"chat");
      // An active same-document chat is useful original work, not admission of
      // this message. All composers already preserve their draft on false.
      if(reused){if(current())this.toast(this.#systemNotice("A question is already in progress for this document. No additional question was queued; your draft remains in the message field."));return false;}
      return true;
    }catch(error){if(current())this.toast(error instanceof Error?error.message:"Forma could not respond");return false;}
  }

  async structureAdaptive(prompt:string,options:{documentId?:string;sourceSurface?:string;projectScope?:boolean;canvasId?:string;locale?:string}={}) {
    const authorization=this.#activeAuthorizationScope(),route=this.route.get(),projection=this.projection.get();
    if(!authorization||!prompt.trim()||this.planningConsent.get())return false;
    const request:PlanningConsentRequest={prompt:prompt.trim(),projectId:projection.projectId,documentId:options.documentId??projection.documentId,canvasId:options.canvasId??null,sourceSurface:options.sourceSurface??"adaptive",projectScope:options.projectScope===true,locale:options.locale??document.documentElement.lang??"en",requestKey:""};
    const navigation=this.#navigationCommit;await this.#appendPipeline;
    if(navigation&&!await navigation||!this.#scopeStillActive(authorization)||this.route.get()!==route)return false;
    request.requestKey=await adaptiveRequestKey(request);
    if(!this.#scopeStillActive(authorization)||this.route.get()!==route||this.planningConsent.get())return false;
    this.#planningConsentScope=authorization;this.#planningConsentRoute=route;
    const decision=new Promise<boolean>((resolve)=>{this.#planningConsentResolve=resolve;});
    this.planningConsent.set({id:crypto.randomUUID(),request,quote:null,working:false,notice:"",submitted:false});this.notify();
    void this.previewPlanningConsent();
    return decision;
  }

  #finishPlanningConsent(accepted:boolean){const resolve=this.#planningConsentResolve;this.#planningConsentResolve=undefined;this.planningConsent.set(null);this.#planningConsentScope="";this.#planningConsentRoute="";resolve?.(accepted);}
  closePlanningConsent(){
    const state=this.planningConsent.get(),id=state?.recoveryExecutionId??state?.quote?.executionId;
    if(state?.submitted&&id&&this.#scopeStillActive(this.#planningConsentScope)){
      this.#rememberPlanningRecovery({jobId:id,kind:"structure_adaptive",planningExecutionId:id,documentId:state.request.documentId,canvasId:state.request.canvasId,sourceSurface:state.request.sourceSurface,requestKey:state.request.requestKey,planningLocale:state.request.locale,planningProjectScope:state.request.projectScope});
    }
    this.#finishPlanningConsent(false);this.notify();
  }
  /** Reopen the original queue entry, including after reload or author-to-reader downgrade. */
  async reviewPlanningJob(jobId:string){
    const authorization=this.#activeAuthorizationScope(),job=this.documentJobs.get().find((entry)=>entry.jobId===jobId)??this.planningRecoveryEntries().find(entry=>entry.jobId===jobId),projection=this.projection.get();
    if(!authorization||!this.#canReadProjectJobs()||this.planningConsent.get()||job?.kind!=="structure_adaptive"||job.planningExecutionId!==jobId||!projection.documents.some((item)=>item.id===job.documentId&&item.projectId===projection.projectId))return false;
    this.#rememberPlanningRecovery(job);
    const request:PlanningConsentRequest={projectId:projection.projectId,documentId:job.documentId,canvasId:job.canvasId??null,sourceSurface:job.sourceSurface??(job.canvasId?"canvas":"adaptive"),projectScope:job.planningProjectScope===true,locale:job.planningLocale??"en",requestKey:job.requestKey??"",prompt:""};
    this.#planningConsentScope=authorization;this.#planningConsentRoute=this.route.get();
    this.planningConsent.set({id:crypto.randomUUID(),request,quote:null,working:false,notice:"",submitted:true,recoveryExecutionId:jobId});this.notify();
    await this.#requestPlanningConsent("resume");return true;
  }
  async newPlanningPreview(){
    const state=this.planningConsent.get();if(!state?.quote||state.working||state.quote.status!=="completed"||!state.quote.canPrepareNew||!this.canPreparePlanning())return;
    // Keep the original paid view until a new free preview is actually available.
    this.planningConsent.set({...state,replaceExecutionId:state.quote.executionId,notice:""});this.notify();
    return this.#requestPlanningConsent("quote");
  }
  async previewPlanningConsent(){return this.#requestPlanningConsent(this.planningConsent.get()?.recoveryExecutionId?"resume":"quote");}
  async approvePlanningConsent(){const state=this.planningConsent.get();if(!state?.quote)return;const action=state.submitted||state.recoveryExecutionId?{action:"retrieve" as const,disabled:false}:contextConsentAction(state.quote.status,state.quote.providerAvailable,state.quote.canExecute);if(!action.disabled)return this.#requestPlanningConsent(action.action);}
  async #requestPlanningConsent(action:"quote"|"resume"|ContextConsentAction,originalRead?:PlanningOriginalSourceRead){
    const sourceOwner=originalRead?.source??this.captureSourceOwnership();if(!this.sourceOwnershipActive(sourceOwner))return;
    if(originalRead&&(action!=="resume"||!originalRead.current()))return false;
    let originalCompleted=false;
    // The empty native id is never published or used as an ownership proof.
    // The silent descriptor is owned by the captured Source and existing read revision.
    const state:PlanningConsentState|null=originalRead?{id:"",request:originalRead.request,quote:null,working:false,notice:"",submitted:true,recoveryExecutionId:originalRead.executionId}:this.planningConsent.get();
    const authorization=originalRead?.authorization??this.#planningConsentScope,selectionLocaleRevision=this.#planningLocaleRevision;
    if(!state||state.working||!this.#scopeStillActive(authorization)||!this.sourceOwnershipActive(sourceOwner)||action==="resume"&&!state.recoveryExecutionId||action!=="quote"&&action!=="resume"&&!state.quote)return;
    const replacing=action==="quote"&&Boolean(state.replaceExecutionId)&&state.quote?.status==="completed";
    const trackedId=state.recoveryExecutionId??state.replaceExecutionId??state.quote?.executionId;
    if(trackedId)this.#rememberPlanningRecovery({jobId:trackedId,kind:"structure_adaptive",planningExecutionId:trackedId,documentId:state.request.documentId,canvasId:state.request.canvasId,sourceSurface:state.request.sourceSurface,requestKey:state.request.requestKey,planningLocale:state.request.locale,planningProjectScope:state.request.projectScope},state.submitted||Boolean(state.recoveryExecutionId)||state.quote?.status!=="quoted");
    const priorOriginalProof=originalRead?this.#jobDetails.get(originalRead.executionId)?.adaptiveOriginalProof:undefined;
    const tracked=trackedId?this.#planningRecoveryIdentities.get(trackedId):undefined;
    const startedReadAt=++this.#planningRecoverySequence;
    if(tracked){tracked.revision=startedReadAt;tracked.deliberateReadRevision=startedReadAt;tracked.pendingReadRevision=startedReadAt;delete tracked.preservedReadRevision;delete tracked.terminalReadRevision;
      // This grants presentation eligibility only to the exact approved ID,
      // not access proof, dismissal reversal, or a same-intent unknown winner.
      if(state.request.sourceSurface==="canvas"&&this.#planningConsentResolve&&(action==="execute"||action==="retrieve"))tracked.presentationLocaleRevision=selectionLocaleRevision;
    }
    const readRevision=tracked?.revision??0;
    const privateWithdrawn=()=>trackedId&&(this.#planningRecoveryIdentities.get(trackedId)?.withdrawalRevision??0)>startedReadAt;
    const retainedQuote=()=>originalRead?null:this.planningConsent.get()?.quote??(privateWithdrawn()?null:state.quote);
    const failureFor=(quote:AvailableConsequentialPreview|null,outcome:Parameters<typeof contextConsentFailure>[1])=>{
      const result=contextConsentFailure(quote,outcome),id=quote?.executionId??trackedId;
      const job=id?this.documentJobs.get().find(item=>item.jobId===id)??this.#jobDetails.get(id):undefined;
      const budget=planningStopBudget(job?.result);
      // An uncertain network/execution status does not reopen a reservation
      // whose current original receipt already proves settlement or release.
      return result.notice==="uncertain"&&job&&adaptiveJobMatchesRequest(job,state.request)&&documentJobHasNoBudgetHold(budget)?{...result,notice:"failed" as const}:result;
    };
    const update=(patch:Partial<PlanningConsentState>)=>{if(originalRead)return originalRead.current()&&this.sourceOwnershipActive(sourceOwner);const current=this.planningConsent.get();if(current?.id!==state.id||!this.#scopeStillActive(authorization)||!this.sourceOwnershipActive(sourceOwner))return false;this.planningConsent.set({...current,...patch});this.notify();return true;};
    update({working:true,notice:"",submitted:state.submitted||action==="execute",readRevision:startedReadAt});
    try{
      const response=await this.guardedFetch("/api/document-jobs/adaptive",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...state.request,action,...(action==="resume"?{executionId:state.recoveryExecutionId}:action!=="quote"?{executionId:state.quote!.executionId,approvedBindingHash:state.quote!.bindingHash}:state.replaceExecutionId?{replaceExecutionId:state.replaceExecutionId}:{})})},this.#systemNotice("Review this exact planning request"),originalRead?{current:originalRead.current}:undefined);
      if(!this.#scopeStillActive(authorization)||!this.sourceOwnershipActive(sourceOwner))return;
      if((action==="resume"||action==="retrieve")&&trackedId&&!response.ok&&[401,403,404,410].includes(response.status)){
        this.#withdrawAdaptiveRead(trackedId,startedReadAt);
        return;
      }
      const body=await response.json() as {quote?:AvailableConsequentialPreview;planningRequest?:PlanningConsentRequest;job?:DocumentJob;status?:string;submission?:string;providerAvailable?:boolean;error?:string;executionId?:string;bindingHash?:string;sourceHash?:string;requestKey?:string;reused?:boolean;requestedExecutionId?:string;reusedExecutionId?:string};
      if(!this.#scopeStillActive(authorization)||!this.sourceOwnershipActive(sourceOwner))return;
      const requestedId=action==="resume"?state.recoveryExecutionId:state.quote?.executionId;
      const unavailable=!response.ok&&["adaptive_existing_request_unavailable","adaptive_result_unavailable","adaptive_execution_unavailable","adaptive_consent_unavailable","adaptive_read_scope_denied","adaptive_read_authorization_changed"].includes(body.error??"");
      const returnedId=body.quote?.executionId??body.job?.planningExecutionId??(unavailable?requestedId:undefined);
      if(body.quote&&(body.quote.projectId!==state.request.projectId||body.quote.documentId!==state.request.documentId||(body.quote.canvasId??null)!==state.request.canvasId||action!=="quote"&&body.quote.executionId!==requestedId&&(body.requestedExecutionId!==requestedId||body.reusedExecutionId!==body.quote.executionId)))throw new Error("planning_result_identity_changed");
      const original=body.planningRequest;
      if(original&&(original.projectId!==state.request.projectId||original.documentId!==state.request.documentId||(original.canvasId??null)!==state.request.canvasId||original.sourceSurface!==state.request.sourceSurface||original.requestKey!==state.request.requestKey||original.projectScope!==state.request.projectScope||original.locale!==state.request.locale||typeof original.prompt!=="string"||!original.prompt.trim()||original.prompt.length>2_000))throw new Error("planning_result_identity_changed");
      if(original&&await adaptiveRequestKey(original)!==original.requestKey)throw new Error("planning_result_identity_changed");
      if(!this.#scopeStillActive(authorization)||!this.sourceOwnershipActive(sourceOwner))return;
      if(body.quote&&(body.executionId!==undefined&&body.executionId!==body.quote.executionId||body.bindingHash!==undefined&&body.bindingHash!==body.quote.bindingHash||body.sourceHash!==undefined&&body.sourceHash!==body.quote.sourceHash||body.requestKey!==undefined&&body.requestKey!==(original??state.request).requestKey))throw new Error("planning_result_identity_changed");
      // A replacement must carry its own freshly certified intent after the
      // predecessor was withdrawn. Never approve an empty request or restore
      // private predecessor text from this handler's captured state.
      if(action==="quote"&&privateWithdrawn()&&!original)throw new Error("planning_preview_request_unavailable");
      const effectiveRequest=original??(privateWithdrawn()?{...state.request,prompt:""}:state.request);
      const redirected=(response.ok||response.status===409)&&action!=="quote"&&Boolean(requestedId&&returnedId&&requestedId!==returnedId)
        &&body.requestedExecutionId===requestedId&&body.reusedExecutionId===returnedId&&body.quote?.executionId===returnedId
        &&body.job!==undefined&&body.job.jobId===returnedId&&body.job.planningExecutionId===returnedId&&adaptiveJobMatchesRequest(body.job,effectiveRequest);
      if(action!=="quote"&&returnedId&&returnedId!==requestedId&&!redirected)throw new Error("planning_result_identity_changed");
      const observed=returnedId?this.#planningRecoveryIdentities.get(returnedId):undefined;
      const incomingWithdrawal=Boolean(body.job&&returnedId&&body.job.jobId===returnedId&&body.job.planningExecutionId===returnedId&&adaptiveJobMatchesRequest(body.job,effectiveRequest)
        &&(body.job.result?.planningReviewAvailable===false||body.job.result?.resultUnavailable===true));
      if(returnedId&&(incomingWithdrawal||unavailable)){
        const cleared=this.#withdrawAdaptiveRead(returnedId,startedReadAt);
        if(cleared&&redirected&&(!trackedId||(this.#planningRecoveryIdentities.get(trackedId)?.deliberateReadRevision??0)===startedReadAt))update({quote:null,request:{...effectiveRequest,prompt:""},recoveryExecutionId:returnedId,replaceExecutionId:undefined,recoveredPlan:undefined,submitted:true,working:false,notice:"failed"});
        return;
      }
      if(originalRead?!originalRead.current():this.planningConsent.get()?.id!==state.id)return;
      if(trackedId&&(this.#planningRecoveryIdentities.get(trackedId)?.deliberateReadRevision??0)!==startedReadAt)return;
      // Access proof is independent of the execution outcome: an authorized
      // uncertain receipt (409) and a free lookup reusing paid work both read
      // retained private evidence. An ordinary new quote is not that proof.
      const exactRetainedReceipt=Boolean(original&&body.quote&&body.executionId===body.quote.executionId&&body.bindingHash===body.quote.bindingHash&&body.requestKey===effectiveRequest.requestKey
        &&(response.ok||response.status===409)&&body.job&&body.job.jobId===body.quote.executionId&&body.job.planningExecutionId===body.quote.executionId&&adaptiveJobMatchesRequest(body.job,effectiveRequest)
        &&body.job.result?.planningReviewAvailable===true&&body.job.result?.resultUnavailable!==true&&(body.status===undefined||body.status===body.quote.status)
        &&(body.job.result.executionId===undefined||body.job.result.executionId===body.quote.executionId)&&(body.job.result.bindingHash===undefined||body.job.result.bindingHash===body.quote.bindingHash)
        &&(body.job.result.requestKey===undefined||body.job.result.requestKey===effectiveRequest.requestKey));
      const reusedPaidQuote=Boolean(action==="quote"&&response.ok&&body.reused===true&&original&&body.quote&&body.quote.status!=="quoted"&&body.executionId===body.quote.executionId);
      // A reuse lookup discovers its paid identity only in the response. It can
      // recertify after an older read's denial, but never after newer withdrawal
      // evidence merely because its own response happened to arrive last.
      const recertifiesOlderDenial=Boolean((exactRetainedReceipt||reusedPaidQuote)&&(observed?.withdrawalRevision??0)>startedReadAt&&(observed?.withdrawalReadRevision??Number.POSITIVE_INFINITY)<startedReadAt);
      // General feeds intentionally omit the private quote. An original read
      // that now supplies the same certified completion may enrich its receipt,
      // but may never undo a withdrawal, newer lookup, or terminal progress.
      const completionRead=Boolean(observed?.terminalReadRevision!==undefined)
        &&((observed?.withdrawalRevision??0)<=startedReadAt||observed?.preservedReadRevision===startedReadAt)
        &&(trackedId?returnedId===trackedId&&observed?.terminalReadRevision===readRevision:true);
      const completedReceipt=response.ok&&body.quote?.status==="completed"&&completionRead
        &&(action==="quote"||body.job?.status==="completed"&&Boolean(body.job.result?.structure)&&body.job.result?.planningReviewAvailable!==false&&body.job.result?.resultUnavailable!==true);
      if((trackedId?(this.#planningRecoveryIdentities.get(trackedId)?.revision??0):0)!==readRevision&&!completedReceipt&&!recertifiesOlderDenial)return;
      if(redirected&&(observed?.withdrawalRevision??0)>startedReadAt&&!recertifiesOlderDenial){
        update({quote:null,request:{...effectiveRequest,prompt:""},recoveryExecutionId:returnedId,replaceExecutionId:undefined,recoveredPlan:undefined,submitted:true,working:false,notice:"failed"});
        this.#clearAdaptivePrivatePresentation(returnedId!);return;
      }
      if(returnedId&&(observed?.revision??0)>startedReadAt&&!completedReceipt&&!redirected&&!recertifiesOlderDenial)return;
      if(body.quote&&body.quote.status!=="quoted")this.#rememberPlanningRecovery({jobId:body.quote.executionId,kind:"structure_adaptive",planningExecutionId:body.quote.executionId,documentId:effectiveRequest.documentId,canvasId:effectiveRequest.canvasId,sourceSurface:effectiveRequest.sourceSurface,requestKey:effectiveRequest.requestKey,planningLocale:effectiveRequest.locale,planningProjectScope:effectiveRequest.projectScope});
      if((exactRetainedReceipt||reusedPaidQuote)&&returnedId){const certified=this.#planningRecoveryIdentities.get(returnedId);if(certified){certified.certifiedReadRevision=Math.max(certified.certifiedReadRevision??0,startedReadAt);delete certified.preservedReadRevision;}}
      const currentWinner=returnedId?this.documentJobs.get().find(job=>job.jobId===returnedId)??this.#publicDocumentJobDetail(this.#jobDetails.get(returnedId)):undefined;
      const currentTerminal=currentWinner&&documentJobTerminal(currentWinner)&&adaptiveJobMatchesRequest(currentWinner,effectiveRequest);
      const newerStopped=body.job?.status!=="completed"&&body.quote?.status!=="completed"&&(
        currentTerminal&&currentWinner.status!=="completed"&&body.job&&!documentJobTerminal(body.job)
        ||observed?.terminalStatus&&observed.terminalStatus!=="completed"&&(observed.terminalRevision??0)>startedReadAt);
      if(newerStopped){
        // Access may be certified, but an older reply cannot replace newer
        // lifecycle/accounting evidence, including quote and HTTP409 branches.
        update({quote:null,request:{...effectiveRequest,prompt:""},recoveryExecutionId:returnedId,replaceExecutionId:undefined,recoveredPlan:undefined,submitted:true,working:false,notice:"failed"});
        this.#scheduleJobPoll(800);return;
      }
      if(!response.ok&&!redirected&&!exactRetainedReceipt){
        const unavailable=["adaptive_existing_request_unavailable","adaptive_result_unavailable","adaptive_execution_unavailable","adaptive_consent_unavailable","adaptive_read_scope_denied","adaptive_read_authorization_changed"].includes(body.error??"");
        const originalId=replacing?state.replaceExecutionId:state.recoveryExecutionId??(state.quote?.status!=="quoted"?state.quote?.executionId:undefined);
        if(unavailable&&originalId){this.#clearAdaptivePrivatePresentation(originalId,undefined,undefined,true);update({notice:"failed",replaceExecutionId:undefined});return;}
        if(replacing){update({notice:"failed",replaceExecutionId:undefined});return;}
        const outcome=failureFor(body.quote??retainedQuote(),body);update({quote:outcome.quote,request:effectiveRequest,notice:outcome.notice,...(body.submission==="not-submitted"&&!state.recoveryExecutionId?{submitted:false}:{})});return;
      }
      if(action==="quote"){
        if(!body.quote)throw new Error("planning_preview_missing");
        const newPreview=replacing&&body.quote.status==="quoted"&&body.quote.executionId!==state.quote?.executionId;
        update({quote:body.quote,request:effectiveRequest,notice:["reserved","submitting","uncertain"].includes(body.quote.status)?failureFor(body.quote,{status:body.quote.status}).notice:"",submitted:body.quote.status!=="quoted",...(newPreview?{replaceExecutionId:undefined,recoveryExecutionId:undefined,recoveredPlan:undefined}:replacing?{replaceExecutionId:undefined,...(body.quote.executionId!==state.quote?.executionId?{recoveryExecutionId:body.quote.executionId,recoveredPlan:undefined}:{})}:{})});return;
      }
      if(!body.job){const outcome=failureFor(body.quote??retainedQuote(),body);update({quote:outcome.quote,notice:outcome.notice});return;}
      // The server may reuse a winner another session already discovered. Adopt
      // that exact receipt without downgrading a newer certified completion.
      const job=currentWinner?.status==="completed"&&currentWinner.result?.structure&&currentWinner.result.planningReviewAvailable!==false&&currentWinner.result.resultUnavailable!==true&&adaptiveJobMatchesRequest(currentWinner,effectiveRequest)?currentWinner:body.job,effectiveQuote=body.quote??retainedQuote();
      if(!effectiveQuote||effectiveQuote.executionId!==requestedId&&(body.requestedExecutionId!==requestedId||body.reusedExecutionId!==effectiveQuote.executionId)||effectiveQuote.projectId!==state.request.projectId||effectiveQuote.documentId!==state.request.documentId||(effectiveQuote.canvasId??null)!==state.request.canvasId||job.jobId!==effectiveQuote.executionId||!adaptiveJobMatchesRequest(job,effectiveRequest))throw new Error("planning_result_identity_changed");
      this.#rememberPlanningRecovery(job);
      if(job.result?.planningReviewAvailable===false||job.result?.resultUnavailable===true){this.#clearAdaptivePrivatePresentation(job.jobId,undefined,undefined,true);this.notify();return;}
      const certified=this.#planningRecoveryIdentities.get(job.jobId);if(certified){certified.certifiedReadRevision=Math.max(certified.certifiedReadRevision??0,startedReadAt);delete certified.preservedReadRevision;}
      if(originalRead){
        // A silent source read never borrows another native consent, changes its
        // presentation, or substitutes a different paid execution.
        if(!originalRead.current()||!exactRetainedReceipt||job.jobId!==originalRead.executionId
          ||body.quote?.status!=="completed"||job.status!=="completed"||!job.result?.structure)return false;
        const publicJob=this.#publicDocumentJobDetail(job)!;
        this.documentJobs.set([publicJob,...this.documentJobs.get().filter(existing=>existing.jobId!==publicJob.jobId)]);
        this.#observeAdaptivePlanningJob(publicJob);
        if(!originalRead.current())return false;
        const proof=this.#planningRecoveryIdentities.get(publicJob.jobId);
        if(proof)proof.detailRevision=proof.revision;
        originalCompleted=this.#certifyAdaptiveProposalOriginal(publicJob,body.quote,effectiveRequest,sourceOwner,startedReadAt,body.job);
        this.#trimDocumentJobDetails();
        if(originalCompleted)this.notify();
        return originalCompleted;
      }
      this.#pendingAdaptiveIntents.set(job.jobId,typeof job.result?.intent==="string"?job.result.intent:effectiveRequest.prompt);
      const jobs=[job,...this.documentJobs.get().filter((existing)=>existing.jobId!==job.jobId)];this.documentJobs.set(jobs);
      const selectionLocaleChanged=selectionLocaleRevision!==this.#planningLocaleRevision;
      if(selectionLocaleChanged)this.dismissAdaptiveSuggestion(job.documentId,job.jobId);
      else if(certified&&job.sourceSurface==="canvas"&&(job.status==="completed"&&job.result?.structure||!documentJobTerminal(job)&&this.#planningConsentResolve))certified.presentationLocaleRevision=this.#planningLocaleRevision;
      if(!selectionLocaleChanged&&redirected&&requestedId&&requestedId!==job.jobId){const losing=this.#planningRecoveryIdentities.get(requestedId);if(losing)delete losing.presentationLocaleRevision;}
      // A resultless receipt is accounting/recovery evidence, not a replacement
      // for the user's selected working plan. Select only a usable result below.
      if(!selectionLocaleChanged&&!documentJobTerminal(job)&&this.#planningConsentResolve){
        // A confirmed composer handoff owns the eventual selection. Historical
        // Activity reads do not. Keep the working plan visible until it is ready.
        this.#dismissedAdaptiveSuggestions.delete(job.jobId);
        if(job.sourceSurface!=="canvas"){
          this.#clearPendingAdaptiveSelection(job.documentId,job.jobId);
          const pending=this.#planningRecoveryIdentities.get(job.jobId);if(pending)pending.selectOnCompletion=true;
        }
      }
      if(job.status==="completed"&&job.result?.structure){
        if(!selectionLocaleChanged){
          this.#dismissedAdaptiveSuggestions.delete(job.jobId);
          if(job.sourceSurface!=="canvas")this.#clearPendingAdaptiveSelection(job.documentId,job.jobId);
          if(job.sourceSurface!=="canvas"){if(job.planningExecutionId===job.jobId)this.#adaptiveStructureJobIds.set(job.documentId,job.jobId);this.adaptiveStructures.set({...this.adaptiveStructures.get(),[job.documentId]:job.result.structure as AdaptiveStructure});}
        }
        // An exact receipt is evidence about this target, not a complete list
        // of other still-authorized cards omitted from the current feed.
        this.#observeAdaptivePlanningJob(job);
      }else this.#observeAdaptivePlanningJob(job);
      if(exactRetainedReceipt){this.#cacheDocumentJobDetail(job);const proof=this.#planningRecoveryIdentities.get(job.jobId);if(proof)proof.detailRevision=proof.revision;this.#certifyAdaptiveProposalOriginal(job,body.quote,effectiveRequest,sourceOwner,startedReadAt,body.job);this.#trimDocumentJobDetails();}
      const resultlessTerminal=documentJobTerminal(job)&&!(job.status==="completed"&&job.result?.structure);
      if(state.recoveryExecutionId||redirected||resultlessTerminal||selectionLocaleChanged){
        update({quote:effectiveQuote,request:effectiveRequest,recoveryExecutionId:effectiveQuote.executionId,replaceExecutionId:undefined,submitted:true,working:false,recoveredPlan:!selectionLocaleChanged&&job.status==="completed"&&job.result?.structure?job.result.structure as AdaptiveStructure:undefined,notice:job.status==="completed"?"":failureFor(effectiveQuote,{...body,status:effectiveQuote.status}).notice});
        if(redirected&&!resultlessTerminal&&!selectionLocaleChanged){const resolve=this.#planningConsentResolve;this.#planningConsentResolve=undefined;resolve?.(true);}
        if(redirected||resultlessTerminal||selectionLocaleChanged)this.#scheduleJobPoll(800);
        return;
      }
      this.#finishPlanningConsent(true);this.notify();this.#driveDocumentJobs(jobs);this.#scheduleJobPoll(800);
    }catch{
      if(trackedId&&(this.#planningRecoveryIdentities.get(trackedId)?.deliberateReadRevision??0)!==startedReadAt)return;
      if((trackedId?(this.#planningRecoveryIdentities.get(trackedId)?.revision??0):0)!==readRevision)return;
      if(action==="execute"&&trackedId){const identity=this.#planningRecoveryIdentities.get(trackedId);if(identity)identity.recoverable=true;}
      if(action==="quote"||action==="resume")update({notice:"failed",...(replacing?{replaceExecutionId:undefined}:{})});
      else{const outcome=failureFor(retainedQuote(),{transport:true});update({quote:outcome.quote,notice:outcome.notice});}
    }finally{
      if((trackedId?(this.#planningRecoveryIdentities.get(trackedId)?.revision??0):0)===readRevision)update({working:false});
      if(originalRead&&!originalCompleted&&originalRead.current()
        &&this.#planningRecoveryIdentities.get(originalRead.executionId)?.deliberateReadRevision===startedReadAt){
        const detail=this.#jobDetails.get(originalRead.executionId);
        if(detail?.adaptiveOriginalProof===priorOriginalProof&&detail?.adaptiveOriginalProof)
          this.#jobDetails.set(originalRead.executionId,this.#publicDocumentJobDetail(detail)!);
      }
      const finished=trackedId?this.#planningRecoveryIdentities.get(trackedId):undefined;if(finished?.pendingReadRevision===startedReadAt){delete finished.pendingReadRevision;delete finished.preservedReadRevision;}
    }
  }

  /** One explicit native submission; this surface does not issue Experience/Output authorization. */
  async submitNativeShortStory(input:NativeStorySetup,controls:{current:()=>boolean}):Promise<NativeStorySubmission>{
    const setup=captureNativeStorySetup(input),source=this.captureSourceOwnership();
    let dispatched=false,acknowledged:NativeStorySubmission|null=null,failure:NativeStoryFailureReason="unavailable";
    const current=()=>Boolean(setup&&this.sourceOwnershipActive(source)&&this.projection.get().documentId===setup.documentId
      &&!this.session.get()?.projectContext&&!this.session.get()?.impersonation&&controls.current());
    if(!setup||!current())return Object.freeze({disposition:"not-dispatched",handle:null,reason:"unavailable"});
    // The private observer cannot be supplied through the legacy options object.
    await this.#renderDocumentArtifact("short_story",{...setup,itemCount:1,productionMode:"manual",sourceSurface:"document"},{
      current,onDispatch:()=>{dispatched=true;},acknowledged:(handle,reused)=>{
        acknowledged=Object.freeze({disposition:"acknowledged",handle,reused});
      },failed:(reason)=>{failure=reason;},
    });
    // Even after local withdrawal, a genuine acknowledgment remains a handle,
    // not permission to display. A lost response never manufactures one.
    return acknowledged??(dispatched?Object.freeze({disposition:"dispatched-unconfirmed",handle:null}):Object.freeze({disposition:"not-dispatched",handle:null,reason:failure}));
  }

  async renderDocumentArtifact(kind:DocumentArtifactKind,options:DocumentArtifactRenderOptions={}){
    return this.#renderDocumentArtifact(kind,options);
  }

  async #renderDocumentArtifact(kind:DocumentArtifactKind,options:DocumentArtifactRenderOptions={},nativeStory?:NativeStoryObserver){
    if(kind==="model3d"){
      const source=this.captureSourceOwnership(),documentId=options.documentId??this.projection.get().documentId;
      const projection=this.projection.get(),context=this.#generationContext(documentId);
      const fromDocument=options.model3dPromptSource==="document";
      const current=()=>this.sourceOwnershipActive(source)&&this.projection.get().documentId===documentId
        &&this.#canRequestProjectOutputs()&&(!fromDocument||this.#generationContext(documentId).documentRevision===context.documentRevision)&&(!options.current||options.current());
      try{
        if(!current())return false;
        if(options.model3dPromptSource!==undefined&&!fromDocument||!fromDocument&&options.model3dAdaptation!==undefined)throw new Error("Choose a supported 3D prompt source.");
        if(!this.session.get()?.provider.model3dConfigured)throw new Error("3D generation is not configured for this workspace.");
        if(options.paidMediaConfirmed!==true)throw new Error("Review the 3D generation cost before submitting.");
        const ids=options.model3dReferenceBlockIds??[];
        if(!Array.isArray(ids)||new Set(ids).size!==ids.length)throw new Error("Choose each 3D reference only once.");
        const adaptation=fromDocument?adaptDocumentToModel3d(context.snapshot,{referenceCount:ids.length}):null;
        const adaptationReceipt=adaptation?model3dAdaptationReceipt(adaptation):null;
        if(adaptation&&(!adaptation.valid||options.model3dPrompt!==adaptation.prompt||JSON.stringify(options.model3dAdaptation)!==JSON.stringify(adaptationReceipt)))throw new Error("The document's 3D direction changed. Reopen Render document to review its prepared prompt.");
        const references=ids.map(id=>projection.blocks.find(block=>block.id===id&&!block.removed&&block.properties.active!==false&&(block.type==="reference"||block.type==="model3d")));
        if(references.some(block=>!block||!String(block.properties.media_url??"").startsWith("/api/media/")
          ||block.properties.pixel_reference_mode==="context_only"||!block.properties.pixel_reference_mode
          ||["avoid","prohibit"].includes(blockIntentFor(block.type,block.properties))))throw new Error("Choose active image references with visual use enabled. Save a view for each 3D model first.");
        const validation=validateModel3dRequest({prompt:options.model3dPrompt??"",settings:options.model3dSettings,referenceCount:ids.length,
          referenceMimeTypes:references.map(block=>String(block!.properties.media_type??block!.properties.source_mime_type??""))});
        if(!validation.valid)throw new Error(validation.issues[0]?.message??"Review the 3D request settings.");
        const settings={model3dPrompt:options.model3dPrompt??"",model3dSettings:structuredClone(validation.settings),model3dReferenceBlockIds:[...ids],...(adaptationReceipt?{model3dPromptSource:"document" as const,model3dAdaptation:structuredClone(adaptationReceipt)}:{})};
        const requestKey=`render:model3d:${context.documentRevision}:${generationRevisionFor(settings)}`;
        const result=await this.#startDocumentJob("render_document",{...context,...settings,requestKey,artifactKind:"model3d",productionMode:"manual",
          locale:options.locale??(typeof document==="undefined"?"en":document.documentElement.lang||"en"),paidMediaConfirmed:true,itemCount:1},
          options.sourceSurface??"document",documentId,{current,onDispatch:options.onDispatch});
        if(current())this.toast(result.reused?"This exact 3D request is already in progress.":"3D model queued. You can keep working while it is prepared.","inline");
        return true;
      }catch(error){if(current())this.toast(error instanceof Error?error.message:"The 3D model could not be started.");return false;}
    }
    const guidanceProblem=documentRenderGuidanceProblem(options);
    if(guidanceProblem){if(!nativeStory)this.toast(this.#systemNotice(guidanceProblem.message));return false;}
    const guidance=documentRenderGuidance(options);
    options={...options,audience:guidance.audience||undefined,tone:guidance.tone||undefined};
    if(kind==="scene"){
      const documentId=options.documentId??this.projection.get().documentId,session=this.session.get(),authorization=this.#activeAuthorizationScope();
      const request:SceneCostRequest={documentId,requestId:options.sceneRequestId??"",sceneMedium:isSceneMedium(options.sceneMedium)?options.sceneMedium:"visual",
        productionMode:options.productionMode??"manual",...(options.itemCount===undefined?{}:{itemCount:options.itemCount}),
        audience:options.audience?.trim()??"",tone:options.tone?.trim()??"",locale:options.locale??(typeof document==="undefined"?"en":document.documentElement.lang||"en"),
        ...(options.workflowId&&options.workflowStageId?{workflowId:options.workflowId,workflowStageId:options.workflowStageId,workflowSources:options.workflowSources??[]}:{}),
      };
      const input=JSON.parse(JSON.stringify(request)) as SceneCostRequest;
      const sourceCurrent=this.captureSceneCostSource(input);
      const current=()=>Boolean(session&&this.#scopeStillActive(authorization)&&this.#canRequestProjectOutputs()&&sourceCurrent()&&(!options.current||options.current()));
      let dispatched=false,reported=false;
      const report=(result:SceneSubmissionResult)=>{if(reported)return;reported=true;try{options.onResult?.(result);}catch{/* Presentation failure cannot change the original submission receipt. */}};
      try{
        if(!/^[a-z0-9][a-z0-9:_-]{0,119}$/iu.test(input.requestId)||!current())throw new Error("scene_cost_changed");
        const consent={...options.sceneCostConsent},preview={...consent};delete preview.confirmed;
        if(!isSceneCostPreview(preview)||!sceneCostApprovalMatches(consent,preview)||preview.requestId!==input.requestId
          ||preview.actorUserId!==session!.user.userId||preview.projectId!==this.projection.get().projectId||preview.documentId!==documentId
          ||preview.permissionEpoch!==(session!.permissionEpoch??"legacy")||Boolean(preview.contextSessionId)!==Boolean(session!.projectContext)
          ||preview.period!==new Date().toISOString().slice(0,7)||session!.provider.plannerModel&&preview.model!==session!.provider.plannerModel)throw new Error("scene_cost_changed");
        const requestHash=await sceneCostRequestHash(input);
        if(!current()||requestHash!==preview.requestHash)throw new Error("scene_cost_changed");
        const {requestId,...settings}=input;
        const result=await this.#startDocumentJob("render_document",{...this.#generationContext(documentId),...settings,artifactKind:"scene",
          requestKey:"render:scene:"+requestId,sceneRequestId:requestId,sceneCostConsent:consent},options.sourceSurface??"document",documentId,
          {current,onDispatch:()=>{dispatched=true;options.onDispatch?.();}});
        if(!current())throw new Error("scene_cost_changed");
        const original=result.sceneCostExisting?result.sceneCostExisting.preview:preview;
        report({requestId,job:result.job,preview:original,reused:result.reused,attemptSubmission:"submitted"});
        if(current())this.toast(currentFormaLocale().messages[result.reused?"scene.cost.recorded":"scene.cost.queued"]??(result.reused?"This exact Scene request is already recorded.":"Scene queued. You can keep working while it is prepared."));
        return true;
      }catch(error){
        const attempt=dispatched&&!(error&&typeof error==="object"&&"attemptSubmission" in error&&error.attemptSubmission==="not-submitted")?"unknown":"not-submitted";
        report({requestId:input.requestId,job:null,preview:null,reused:false,attemptSubmission:attempt});
        if(this.#scopeStillActive(authorization)&&(!options.current||options.current()))this.toast(currentFormaLocale().messages["scene.cost.unavailable"]??"The exact Scene request could not be verified. Check its original status before approving paid work.");
        return false;
      }
    }

    const productionMode=options.productionMode??"manual";let requestedSlideCount=kind==="slides"?options.requestedSlideCount??options.itemCount:undefined;let itemCount=kind==="slides"?requestedSlideCount:options.itemCount;
    if(kind==="slides"&&options.slideCountPolicy!==undefined){try{const count=resolvePresentationCountRequest({...options,productionMode});requestedSlideCount=count.requestedSlideCount;itemCount=count.itemCount;}catch(error){this.toast(error instanceof Error?error.message:"Invalid presentation count policy");return false;}}
    if(kind==="slides"){if(options.itemCount!==undefined&&options.requestedSlideCount!==undefined&&options.itemCount!==options.requestedSlideCount){this.toast("The selected slide count does not match the requested presentation size.");return false;}const maximumSlideCount=productionMode==="managed"?MAX_MANAGED_PRESENTATION_SLIDES:15;if(requestedSlideCount!==undefined&&(!Number.isSafeInteger(requestedSlideCount)||requestedSlideCount<1||requestedSlideCount>maximumSlideCount)){this.toast(this.#systemNotice("{mode} presentations support between 1 and {maximum} slides. The request was not started.",{mode:this.#systemNotice(productionMode==="managed"?"Managed":"Manual"),maximum:maximumSlideCount}));return false;}}
    const documentId=options.documentId??this.projection.get().documentId;const context=this.#generationContext(documentId);const locale=options.locale??(typeof document==="undefined"?"en":document.documentElement.lang||"en");const audience=options.audience?.trim()||undefined,tone=options.tone?.trim()||undefined;const soundtrackBlockIds=[...new Set((options.soundtrackBlockIds??[]).map(String).filter(Boolean))];const slideSettings=kind==="slides"?{presentationStyle:options.presentationStyle,presentationFidelity:options.presentationFidelity,requestedSlideCount,...(options.slideCountPolicy?{slideCountPolicy:options.slideCountPolicy}:{}),authoredSlideCount:options.authoredSlideCount}:{};const presentationIdentity=kind==="slides"?`${options.presentationStyle===undefined?"":`:style:${encodeURIComponent(options.presentationStyle)}`}${options.presentationFidelity===undefined?"":`:fidelity:${encodeURIComponent(options.presentationFidelity)}`}${requestedSlideCount===undefined?"":`:slides:${requestedSlideCount}`}${options.slideCountPolicy?`:policy:${generationRevisionFor(options.slideCountPolicy)}`:""}`:"";const audioIdentity=soundtrackBlockIds.length||options.sendSoundtrackToVideoProvider===true||options.audioImageBlockId||options.audioProfile||options.audioProviderModel||options.audioVideoArtifactId||options.sendAudioVideoToProvider===true?`:audio:${generationRevisionFor({soundtrackBlockIds,sendSoundtrackToVideoProvider:options.sendSoundtrackToVideoProvider===true,audioImageBlockId:options.audioImageBlockId??null,...(options.audioProfile?{audioProfile:options.audioProfile}:{}),...(options.audioProviderModel?{audioProviderModel:options.audioProviderModel}:{}),...(options.audioVideoArtifactId?{audioVideoArtifactId:options.audioVideoArtifactId}:{}),...(options.sendAudioVideoToProvider===true?{sendAudioVideoToProvider:true}:{})})}`:"";const workflow=options.workflowId&&options.workflowStageId?{workflowId:options.workflowId,workflowStageId:options.workflowStageId,workflowSources:options.workflowSources??[]}:null;const workflowIdentity=workflow?`:workflow:${generationRevisionFor({workflowId:workflow.workflowId,workflowStageId:workflow.workflowStageId,sources:productionWorkflowSourceIdentity(workflow.workflowSources)})}`:"";const videoIdentity=kind==="video"&&options.videoResolution!==undefined?`:resolution:${options.videoResolution}`:"";const requestKey=`render:${kind}:${productionMode}:${context.documentRevision}:${itemCount??"default"}:${options.videoSeconds??"none"}:${options.videoSize??"none"}:${options.videoAudioMode??"silent"}:${encodeURIComponent(audience?.toLowerCase()??"general")}:${encodeURIComponent(tone?.toLowerCase()??"document-derived")}:${encodeURIComponent(locale.toLowerCase())}${presentationIdentity}${audioIdentity}${workflowIdentity}${videoIdentity}`;
    try{const {job,reused}=await this.#startDocumentJob("render_document",{...context,requestKey,locale,artifactKind:kind,itemCount,audience,tone,videoSeconds:options.videoSeconds,videoSize:options.videoSize,...(options.videoResolution!==undefined?{videoResolution:options.videoResolution}:{}),videoAudioMode:options.videoAudioMode,...(soundtrackBlockIds.length?{soundtrackBlockIds}:{}),...(options.sendSoundtrackToVideoProvider===true?{sendSoundtrackToVideoProvider:true}:{}),...(options.audioImageBlockId?{audioImageBlockId:options.audioImageBlockId}:{}),...(options.audioProfile?{audioProfile:options.audioProfile}:{}),...(options.audioProviderModel?{audioProviderModel:options.audioProviderModel}:{}),...(options.audioVideoArtifactId?{audioVideoArtifactId:options.audioVideoArtifactId}:{}),...(options.sendAudioVideoToProvider===true?{sendAudioVideoToProvider:true}:{}),...(workflow??{}),productionMode,paidMediaConfirmed:options.paidMediaConfirmed===true,...slideSettings},options.sourceSurface??"document",documentId,nativeStory?{current:nativeStory.current,onDispatch:nativeStory.onDispatch,nativeShortStory:true}:undefined);
      if(nativeStory){
        const handle=acknowledgedNativeStoryHandle(job,{documentId,documentRevision:context.documentRevision,requestKey});
        if(!handle)throw new Error("native_story_job_identity_mismatch");
        nativeStory.acknowledged(handle,reused);
      }
      if(!nativeStory)this.toast(reused?this.#systemNotice("This exact {kind} is already in progress.",{kind:this.#systemNotice(kind.replaceAll("_"," "))}):productionMode==="managed"?this.#systemNotice("Your {team} team is working on the complete document.",{team:this.#systemNotice(kind==="video"?"film production":kind==="slides"?"presentation editorial":kind==="storyboard"?"previsualization":kind==="audio"?"audio":"writing")}):this.#systemNotice("{kind} queued. You can keep working while it is prepared.",{kind:this.#systemNotice(kind.replaceAll("_"," "))}),kind==="video"&&productionMode==="manual"?"inline":"overlay");return true;}catch(error){if(nativeStory)nativeStory.failed(error instanceof GenerationBudgetAdmissionError?error.reason:"unavailable");else this.toast(error instanceof Error?error.message:this.#systemNotice("The {kind} could not be started.",{kind:this.#systemNotice(kind.replaceAll("_"," "))}));return false;}
  }

  #observeWorkspaceNavigation<T>(pending:Promise<T>):Promise<PromiseSettledResult<T>>{
    return pending.then(value=>({status:"fulfilled" as const,value}),reason=>({status:"rejected" as const,reason}));
  }
  #observeWorkspaceOpening(pending:boolean|Promise<boolean>):Promise<PromiseSettledResult<boolean>>{
    return typeof pending==="boolean"?Promise.resolve({status:"fulfilled" as const,value:pending}):this.#observeWorkspaceNavigation(pending);
  }
  #throwWorkspaceNavigationFailures(failures:unknown[]):void{
    if(!failures.length)return;
    const combined=combineNativeImageRetirementFailures(failures);if(combined)throw combined;
    if(failures.length===1)throw failures[0];
    throw new AggregateError(failures,"workspace_navigation_failed",{cause:failures[0]});
  }

  async openProject(projectId:string,destination="/",options:WorkspaceNavigationOptions={}){
    const owner=this.#takeWorkspaceNavigation(options),sourceOwner=this.captureSourceOwnership();
    if(!this.sourceOwnershipActive(sourceOwner)||!this.#workspaceNavigationCurrent(owner))return false;
    const projection=this.projection.get(),target=projection.projects.find(project=>project.id===projectId);
    if(!projectId||!target){this.toast("That project is no longer available.");return false;}
    const selected=foldEvents(this.eventView.get(),this.asOf.get(),"",projectId),requestedDocumentId=documentIdFromRoute(destination);
    if(requestedDocumentId!==null&&(!requestedDocumentId||!selected.documents.some(document=>document.id===requestedDocumentId))){
      this.toast("That document is no longer available.");return false;
    }
    const documentId=requestedDocumentId??(projectId===projection.projectId?projection.documentId:selected.documentId);
    const documentTitle=selected.documents.find(document=>document.id===documentId)?.title??"";
    const routedDestination=isDocumentViewRoute(destination)&&documentId
      ?withDocumentInRoute(destination,documentId,documentTitle):withProjectTaskDocumentInRoute(destination,documentId);
    owner.options={...owner.options,documentId};
    if(!this.#handoffWorkspaceNavigation(owner))return false;
    if(projectId===projection.projectId){
      const opening=this.#observeWorkspaceOpening(this.setRoute(routedDestination,this.#workspaceNavigationOptions(owner)));
      const arrived=await opening;if(arrived.status==="rejected")throw arrived.reason;
      return arrived.value&&this.#workspaceNavigationCurrent(owner);
    }
    const previousRoute=this.#projectTaskRoute(owner.route),clientEventId=crypto.randomUUID(),now=new Date().toISOString();
    const canvasDestination=destination==="/canvas"||destination.startsWith("/canvas/");
    const input:EventInput={type:"ProjectOpened",payload:{project_id:projectId,previous_project_id:projection.projectId,
      source_surface:canvasDestination?"canvas-projects":"projects",client_event_id:clientEventId}};
    const optimistic:CreativeEvent={eventId:`optimistic:${clientEventId}`,streamId:"optimistic:project",sequence:this.head.get()+1,
      occurredAt:now,recordedAt:now,actor:"user",clientId:"web:project-optimistic",correlationId:clientEventId,
      causationId:null,compensatesEventId:null,schemaVersion:1,type:input.type,payload:input.payload};
    let optimisticPublished=false,written:Promise<PromiseSettledResult<EventWriteResult>>|null=null;
    let result:PromiseSettledResult<EventWriteResult>|null=null,committed:Promise<boolean>|null=null;
    let opening:Promise<PromiseSettledResult<boolean>>|null=null,arrival:PromiseSettledResult<boolean>|null=null;
    let preparationFailure:{reason:unknown}|null=null;const cleanupFailures:unknown[]=[];
    try{
      // The value is installed before retirement callbacks can throw. Its exact
      // row still belongs to this operation's unconditional cleanup below.
      optimisticPublished=true;
      this.#nativeImageMutation(()=>{this.optimisticEvents.set([...this.optimisticEvents.get(),optimistic]);});
      if(this.#workspaceNavigationCurrent(owner)){
        this.patchUi({focusBlockId:"",focusCollectionId:"",selectedOutputId:"",compareOpen:false});
        if(this.#workspaceNavigationCurrent(owner)){
          written=this.#observeWorkspaceNavigation(this.appendWithReceipt(input,{rebaseAttempts:6,silent:true,background:true}));
          committed=written.then(outcome=>outcome.status==="fulfilled"&&outcome.value.acknowledgment.outcome==="observed"
            &&outcome.value.acknowledgment.committed.some(event=>event.type==="ProjectOpened"&&event.clientEventId===clientEventId));
          try{
            if(this.#workspaceNavigationCurrent(owner)){
              this.#navigationCommit=committed;
              opening=this.#observeWorkspaceOpening(this.setRoute(routedDestination,this.#workspaceNavigationOptions(owner)));
            }
          }catch(reason){arrival={status:"rejected",reason};}
        }
      }
    }catch(reason){preparationFailure={reason};}
    try{if(written)result=await written;}catch(reason){result={status:"rejected",reason};}
    finally{
      if(committed&&this.#navigationCommit===committed)this.#navigationCommit=null;
      if(optimisticPublished)try{
        this.#nativeImageMutation(()=>{this.optimisticEvents.set(this.optimisticEvents.get().filter(event=>event.eventId!==optimistic.eventId));});
      }catch(error){cleanupFailures.push(error);}
    }
    let observed=false,restorationOwner:WorkspaceNavigationOwner|null=null;
    let restoration:Promise<PromiseSettledResult<boolean>>|null=null,restored:PromiseSettledResult<boolean>|null=null,restorationNotice="";
    try{
      if(!preparationFailure&&!cleanupFailures.length&&arrival?.status!=="rejected"&&result?.status==="fulfilled"){
        const receipt=result.value;
        observed=receipt.acknowledgment.outcome==="observed"
          &&receipt.acknowledgment.committed.some(event=>event.type==="ProjectOpened"&&event.clientEventId===clientEventId);
        let restore=false;
        if(receipt.publication!=="published"){
          restore=!observed&&(receipt.acknowledgment.outcome==="unconfirmed"||receipt.acknowledgment.outcome==="not-attempted");
          if(receipt.acknowledgment.outcome==="unconfirmed")restorationNotice=this.#systemNotice("The original change is unconfirmed. It has not been resubmitted.");
        }else if(!receipt.appended.length){
          restore=true;restorationNotice="That project could not be opened. Your current workspace was restored.";
        }
        if(restore&&this.sourceOwnershipActive(sourceOwner)&&this.#workspaceNavigationCurrent(owner)){
          // A separate rollback owner invalidates, rather than rebases, an
          // older cross-audience request still awaiting its original response.
          restorationOwner={...owner,startup:null,options:{replace:true,current:owner.options.current,focus:owner.options.focus}};
          restoration=this.#observeWorkspaceOpening(this.setRoute(previousRoute,this.#workspaceNavigationOptions(restorationOwner)));
        }
      }
    }catch(reason){restored={status:"rejected",reason};}
    finally{
      // Join both original operations even for a false receipt, empty append,
      // rollback, or cleanup failure. Rejected undefined remains an outcome.
      if(opening)arrival=await opening;
      if(restoration)restored=await restoration;
    }
    const failures:unknown[]=[];
    if(result?.status==="rejected")failures.push(result.reason);
    if(preparationFailure)failures.push(preparationFailure.reason);
    if(arrival?.status==="rejected")failures.push(arrival.reason);
    if(restored?.status==="rejected")failures.push(restored.reason);
    failures.push(...cleanupFailures);this.#throwWorkspaceNavigationFailures(failures);
    if(restorationOwner&&restored?.status==="fulfilled"&&restored.value&&restorationNotice&&this.#workspaceNavigationCurrent(restorationOwner))this.toast(restorationNotice);
    if(result?.status!=="fulfilled"||arrival?.status!=="fulfilled")return false;
    const receipt=result.value,arrived=arrival.value&&this.#workspaceNavigationCurrent(owner);
    if(receipt.publication!=="published")return observed&&arrived;
    if(!receipt.appended.length)return false;
    if(arrived&&this.sourceOwnershipActive(sourceOwner)){
      this.notify();
      if(this.#workspaceNavigationCurrent(owner)&&this.sourceOwnershipActive(sourceOwner))
        this.toast(this.#systemNotice("{name} opened in {workspace}.",{name:target.name,workspace:this.#systemNotice(canvasDestination?"Canvas":"Creator Workspace")}));
    }
    return arrived&&this.#workspaceNavigationCurrent(owner);
  }

  async openDocument(documentId:string,destination="/",sourceSurface?:string,options:Pick<WorkspaceNavigationOptions,"current"|"focus"|"onOriginHandoff"|"nativeImageStartup">={}){
    const owner=this.#takeWorkspaceNavigation(options),sourceOwner=this.captureSourceOwnership();
    if(!this.sourceOwnershipActive(sourceOwner)||!this.#workspaceNavigationCurrent(owner))return false;
    const projection=this.projection.get(),target=projection.documents.find(document=>document.id===documentId);
    const routedDestination=withProjectTaskDocumentInRoute(withDocumentInRoute(destination,documentId,target?.title??""),documentId);
    if(!documentId||!target){if(!owner.options.nativeImageStartup)this.toast("That document is no longer available.");return false;}
    if(!this.#handoffWorkspaceNavigation(owner))return false;
    if(documentId===projection.documentId){
      const opening=this.#observeWorkspaceOpening(this.setRoute(routedDestination,this.#workspaceNavigationOptions(owner)));
      const arrived=await opening;if(arrived.status==="rejected")throw arrived.reason;
      return arrived.value&&this.#workspaceNavigationCurrent(owner);
    }
    this.patchUi({focusBlockId:"",selectedOutputId:"",compareOpen:false});
    if(!this.#workspaceNavigationCurrent(owner))return false;
    if(this.session.get()?.projectContext){
      const opening=this.#observeWorkspaceOpening(this.setRoute(routedDestination,this.#workspaceNavigationOptions(owner)));
      const arrived=await opening;if(arrived.status==="rejected")throw arrived.reason;
      return arrived.value&&this.#workspaceNavigationCurrent(owner);
    }
    const written=this.#observeWorkspaceNavigation(this.appendWithReceipt({type:"DocumentOpened",payload:{
      document_id:documentId,previous_document_id:projection.documentId,
      source_surface:sourceSurface??(documentViewFromRoute(destination)==="document"?"studio":"studio-alternative"),
    }},{rebaseAttempts:6,silent:true,background:true}));
    const committed=written.then(result=>result.status==="fulfilled"&&result.value.acknowledgment.outcome==="observed"
      &&result.value.acknowledgment.committed.some(event=>event.type==="DocumentOpened"));
    let opening:Promise<PromiseSettledResult<boolean>>|null=null,arrival:PromiseSettledResult<boolean>|null=null;
    let result:PromiseSettledResult<EventWriteResult>|null=null;
    try{
      if(this.#workspaceNavigationCurrent(owner)){
        this.#navigationCommit=committed;
        opening=this.#observeWorkspaceOpening(this.setRoute(routedDestination,this.#workspaceNavigationOptions(owner)));
      }
    }catch(reason){arrival={status:"rejected",reason};}
    // Clear this exact write marker before joining its separately observed
    // navigation. Neither operation can escape through an early return.
    try{result=await written;}catch(reason){result={status:"rejected",reason};}
    finally{if(this.#navigationCommit===committed)this.#navigationCommit=null;}
    if(opening)arrival=await opening;
    const failures:unknown[]=[];
    if(result?.status==="rejected")failures.push(result.reason);
    if(arrival?.status==="rejected")failures.push(arrival.reason);
    this.#throwWorkspaceNavigationFailures(failures);
    if(result?.status!=="fulfilled"||arrival?.status!=="fulfilled")return false;
    const arrived=arrival.value&&this.#workspaceNavigationCurrent(owner);
    if(arrived&&result.value.publication==="published"&&result.value.appended.length&&this.sourceOwnershipActive(sourceOwner)&&!owner.options.nativeImageStartup)this.toast("Document opened.");
    return arrived&&this.#workspaceNavigationCurrent(owner);
  }

  async removeDocument(documentId: string) {
    const sourceOwner=this.captureSourceOwnership();if(!this.sourceOwnershipActive(sourceOwner))return[];
    const projection=this.projection.get();const target=projection.documents.find((document)=>document.id===documentId);if(!target){this.toast("That document is no longer available.");return[];}if(projection.documents.length<=1){this.toast("Create another document before removing the project’s final document.");return[];}
    const fallback=projection.documents.find((document)=>document.id!==documentId)!;const wasCurrent=documentId===projection.documentId;
    const result=await this.appendWithReceipt({type:"DocumentRemoved",payload:{document_id:documentId,title:target.title,was_current:wasCurrent,previous_document_id:projection.documentId,fallback_document_id:fallback.id,reason:"removed-by-user"}});
    if(!this.sourceOwnershipActive(sourceOwner)||result.publication!=="published")return[];const appended=result.appended;
    if(appended.length){this.patchUi({focusBlockId:"",selectedOutputId:"",compareOpen:false});if(wasCurrent&&isDocumentViewRoute(this.route.get()))this.setRoute(withDocumentInRoute(this.route.get(),this.projection.get().documentId,this.projection.get().documentTitle),{replace:true});this.toast(wasCurrent?this.#systemNotice("{title} was removed. {fallback} is now open.",{title:target.title,fallback:fallback.title}):this.#systemNotice("{title} was removed. Undo can restore it.",{title:target.title}));}return appended;
  }

  async evaluateExtractors() {
    const sourceOwner=this.captureSourceOwnership();if(!this.sourceOwnershipActive(sourceOwner)){return;}
    const authorization=this.#activeAuthorizationScope();
    return this.#nativeImagePublisherWork(async()=>{
      this.busy.set("extractor-eval"); this.notify();
      const response = await this.guardedFetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "evaluate_extractors", expectedSequence: this.head.get(), clientId: "web:system" }) },"run reference extraction");
      this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);
      const body = await response.json() as { appended?: CreativeEvent[]; head?: number; error?: string };
      this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);
      if (!response.ok) throw new Error(body.error === "admin_required" ? "An admin must witness the quality-gate rerun." : body.error ?? "Extractor evaluation failed");
      this.events.set([...this.events.get(), ...(body.appended ?? [])]); this.head.set(body.head ?? this.head.get()); this.toast("Extractor gate passed and the result was appended to the event stream.");
    },()=>{if((this.#scopeStillActive(authorization)&&this.sourceOwnershipActive(sourceOwner))){this.busy.set("");this.notify();}},
    error=>{if((this.#scopeStillActive(authorization)&&this.sourceOwnershipActive(sourceOwner)))this.toast(error instanceof Error ? error.message : "Extractor evaluation failed");});
  }

  async rebuildIndex() {
    const sourceOwner=this.captureSourceOwnership();if(!this.sourceOwnershipActive(sourceOwner)){return;}
    const authorization=this.#activeAuthorizationScope();
    return this.#nativeImagePublisherWork(async()=>{
      this.busy.set("phase7-index"); this.notify();
      const response = await this.guardedFetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "rebuild_index", expectedSequence: this.head.get(), clientId: "web:library" }) },"rebuild the fictional account’s library index");
      this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);
      const body = await response.json() as { appended?: CreativeEvent[]; head?: number; error?: string; report?: { indexedItems?: number; exemplars?: number; families?: number } };
      this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);
      if (!response.ok) throw new Error(body.error === "admin_required" ? "An admin must run the derived index." : body.error ?? "Index rebuild failed");
      this.events.set([...this.events.get(), ...(body.appended ?? [])]); this.head.set(body.head ?? this.head.get());
      this.toast(body.appended?.length ? this.#systemNotice("Indexed {objects} objects, {exemplars} exemplars, and {families} families.",{objects:body.report?.indexedItems??0,exemplars:body.report?.exemplars??0,families:body.report?.families??0}) : "The Phase 7 index is already fresh.");
    },()=>{if((this.#scopeStillActive(authorization)&&this.sourceOwnershipActive(sourceOwner))){this.busy.set("");this.notify();}},
    error=>{if((this.#scopeStillActive(authorization)&&this.sourceOwnershipActive(sourceOwner)))this.toast(error instanceof Error ? error.message : "Index rebuild failed");});
  }

  async extractReference(blockId: string, referenceId: string, sample: ImageSample, findingKinds: ReferenceFindingKind[] = []) {
    try {
      await this.#startDocumentJob("extract_reference",{blockId,referenceId,sample,findingKinds,documentId:this.projection.get().documentId},"reference");this.toast("Reference analysis started and will finish in the background.");
    } catch (error) { this.toast(error instanceof Error ? error.message : "Reference extraction failed"); }
  }

  async calculateImageFocalPoint(input:{targetKind:"generation"|"reference"|"artifact";targetId:string;mediaUrl:string;referenceId?:string;sample?:ImageSample}){
    if(input.targetKind==="reference")return null;
    const sourceOwner=this.captureSourceOwnership();if(!this.sourceOwnershipActive(sourceOwner)){return;}
    const authorization=this.#activeAuthorizationScope(),key=`${input.targetKind}:${input.targetId}:${input.mediaUrl}`;if(!input.mediaUrl||this.#focalInFlight.has(key)||this.#hasFocalPoint(input.targetKind,input.targetId))return null;this.#focalInFlight.add(key);
    try{
      const sample=input.sample??(await resolveImageFocalAnalysis(input.mediaUrl)).sample;
      this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);
      let resolved:unknown=null;
      const append=async()=>{this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);if(this.#hasFocalPoint(input.targetKind,input.targetId))return;const response=await this.guardedFetch("/api/events",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"calculate_focal_point",clientId:"web:focal-extractor",targetKind:input.targetKind,targetId:input.targetId,referenceId:input.referenceId,mediaUrl:input.mediaUrl,sample})},"calculate and save this image’s focal point");this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);const body=await response.json() as {appended?:CreativeEvent[];head?:number;focalPoint?:unknown;error?:string};this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);if(!response.ok)throw new Error(body.error??"focal_point_calculation_failed");const appended=body.appended??[];if(appended.length){this.events.set([...this.events.get(),...appended]);this.head.set(body.head??this.head.get());this.#publishAppended(appended);this.notify();}resolved=body.focalPoint??null;};
      const task=this.#focalAppendQueue.then(append);this.#focalAppendQueue=task.catch(()=>{});await task;this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);return normalizeImageFocalPoint(resolved);
    }catch(error){if(NativeImageRetirementError.is(error))throw error;return null;}finally{if((this.#scopeStillActive(authorization)&&this.sourceOwnershipActive(sourceOwner)))this.#focalInFlight.delete(key);}
  }

  async closeSession() {
    const sourceOwner=this.captureSourceOwnership();if(!this.sourceOwnershipActive(sourceOwner)){return;}
    const authorization=this.#activeAuthorizationScope();
    return this.#nativeImagePublisherWork(async()=>{
      this.busy.set("close-session"); this.notify();
      const response = await this.guardedFetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "close_session", expectedSequence: this.head.get(), clientId: "web:sessions" }) },"close this fictional work session");
      this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);
      const body = await response.json() as { appended?: CreativeEvent[]; head?: number; error?: string; eligibility?: { closedSessions?: number; requiredClosedSessions?: number } };
      this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);
      if (!response.ok) throw new Error(body.error === "no_open_session" ? "Open a session before closing it." : body.error ?? "Session could not be closed");
      this.events.set([...this.events.get(), ...(body.appended ?? [])]); this.head.set(body.head ?? this.head.get()); this.toast(this.#systemNotice("Session closed with a state receipt · {closed}/{required} toward brief eligibility.",{closed:body.eligibility?.closedSessions??0,required:body.eligibility?.requiredClosedSessions??3}));
    },()=>{if((this.#scopeStillActive(authorization)&&this.sourceOwnershipActive(sourceOwner))){this.busy.set("");this.notify();}},
    error=>{if((this.#scopeStillActive(authorization)&&this.sourceOwnershipActive(sourceOwner)))this.toast(error instanceof Error ? error.message : "Session could not be closed");});
  }

  async openSession() {
    const sourceOwner=this.captureSourceOwnership();if(!this.sourceOwnershipActive(sourceOwner)){return;}
    const authorization=this.#activeAuthorizationScope();
    return this.#nativeImagePublisherWork(async()=>{
      this.busy.set("open-session"); this.notify();
      const response = await this.guardedFetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "open_session", expectedSequence: this.head.get(), clientId: "web:sessions" }) },"open a fictional work session");
      this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);
      const body = await response.json() as { appended?: CreativeEvent[]; head?: number; error?: string; briefComposed?: boolean };
      this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);
      if (!response.ok) throw new Error(body.error === "session_already_open" ? "The current session is already open." : body.error ?? "Session could not be opened");
      this.events.set([...this.events.get(), ...(body.appended ?? [])]); this.head.set(body.head ?? this.head.get()); this.toast(body.briefComposed ? "Session opened with an eligible re-entry brief; every impression was witnessed." : "Session opened. More history is needed before composing a valid brief.");
    },()=>{if((this.#scopeStillActive(authorization)&&this.sourceOwnershipActive(sourceOwner))){this.busy.set("");this.notify();}},
    error=>{if((this.#scopeStillActive(authorization)&&this.sourceOwnershipActive(sourceOwner)))this.toast(error instanceof Error ? error.message : "Session could not be opened");});
  }

  async composeBrief() {
    const sourceOwner=this.captureSourceOwnership();if(!this.sourceOwnershipActive(sourceOwner)){return;}
    const authorization=this.#activeAuthorizationScope();
    return this.#nativeImagePublisherWork(async()=>{
      this.busy.set("compose-brief"); this.notify();
      const response = await this.guardedFetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "compose_brief", expectedSequence: this.head.get(), clientId: "web:sessions" }) },"compose a re-entry brief for this fictional account");
      this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);
      const body = await response.json() as { appended?: CreativeEvent[]; head?: number; error?: string; eligibility?: { reasons?: string[] } };
      this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);
      if (!response.ok) throw new Error(body.error === "brief_not_eligible" ? `Brief is not eligible: ${body.eligibility?.reasons?.join(" and ") ?? "more history required"}.` : body.error === "open_session_required" ? "Open a session before composing a brief." : body.error ?? "Brief could not be composed");
      this.events.set([...this.events.get(), ...(body.appended ?? [])]); this.head.set(body.head ?? this.head.get()); this.toast("Re-entry brief composed from the event stream; impressions were witnessed in the same batch.");
    },()=>{if((this.#scopeStillActive(authorization)&&this.sourceOwnershipActive(sourceOwner))){this.busy.set("");this.notify();}},
    error=>{if((this.#scopeStillActive(authorization)&&this.sourceOwnershipActive(sourceOwner)))this.toast(error instanceof Error ? error.message : "Brief could not be composed");});
  }

  async declareIntent(statement: string, deadline: string | null = null): Promise<boolean> {
    const sourceOwner=this.captureSourceOwnership();if(!this.sourceOwnershipActive(sourceOwner)){return false;}
    const authorization=this.#activeAuthorizationScope(),session=this.session.get();
    const expectedSequence=this.head.get(),documentId=this.projection.get().documentId;
    const streamId=session?.projectContext?"project:"+session.projectContext.projectAccessId:"creative:"+(session?.user.userId??"");
    const actor=session?.projectContext?"user:"+session.user.userId:"user";
    return this.#nativeImagePublisherWork<boolean>(async()=>{
      this.busy.set("declare-intent"); this.notify();
      const response = await this.guardedFetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "declare_intent", expectedSequence, clientId: "web:sessions", statement, deadline }) },"record this intent in the fictional account");
      this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);
      const body = await response.json() as { appended?: CreativeEvent[]; rejected?: unknown[]; head?: number; error?: string };
      this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);
      if (!response.ok) throw new Error(body.error ?? "Intent could not be recorded");
      const event=Array.isArray(body.appended)&&body.appended.length===1?body.appended[0]:null;
      if(!event||event.type!=="IntentDeclared"||event.actor!==actor||event.streamId!==streamId||event.clientId!=="web:sessions"
        ||typeof event.eventId!=="string"||!event.eventId||typeof event.correlationId!=="string"||!event.correlationId
        ||event.sequence!==expectedSequence+1||body.head!==event.sequence||!Array.isArray(body.rejected)||body.rejected.length
        ||!event.payload||typeof event.payload!=="object"||Array.isArray(event.payload)
        ||typeof event.payload.statement_ref!=="string"||!event.payload.statement_ref
        ||typeof event.payload.content_expires_at!=="string"||!Number.isFinite(Date.parse(event.payload.content_expires_at))
        ||!this.#requestedEventObserved({type:"IntentDeclared",payload:{scope_ref:documentId,deadline}},event))
        throw new Error(this.#systemNotice("The original change is unconfirmed. It has not been resubmitted."));
      this.#mergeConfirmed([event], event.sequence); this.toast("Intent recorded privately; the immutable event keeps only its expiring reference.");
      return true;
    },()=>{if((this.#scopeStillActive(authorization)&&this.sourceOwnershipActive(sourceOwner))){this.busy.set("");this.notify();}},
    error=>{if((this.#scopeStillActive(authorization)&&this.sourceOwnershipActive(sourceOwner)))this.toast(error instanceof Error ? error.message : "Intent could not be recorded");return false;});
  }

  async runScout(maxObservations: number) {
    const sourceOwner=this.captureSourceOwnership();if(!this.sourceOwnershipActive(sourceOwner)){return;}
    const authorization=this.#activeAuthorizationScope();
    return this.#nativeImagePublisherWork(async()=>{
      this.busy.set("run-scout"); this.notify();
      const response = await this.guardedFetch("/api/events", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({action:"run_scout",expectedSequence:this.head.get(),clientId:"web:scout",maxObservations}) },"run Scout against the fictional account");
      this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);
      const body = await response.json() as {appended?:CreativeEvent[];head?:number;error?:string};
      this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);
      if(!response.ok) throw new Error(body.error === "phase6_advance_required" ? "Record the Phase 6 advance-with-monitoring decision first." : body.error ?? "Scout run failed");
      this.events.set([...this.events.get(),...(body.appended??[])]);this.head.set(body.head??this.head.get());this.toast("Scout report completed inside its hard planning envelope.");
    },()=>{if((this.#scopeStillActive(authorization)&&this.sourceOwnershipActive(sourceOwner))){this.busy.set("");this.notify();}},
    error=>{if((this.#scopeStillActive(authorization)&&this.sourceOwnershipActive(sourceOwner)))this.toast(error instanceof Error?error.message:"Scout run failed");});
  }

  async refreshTasteModel() {
    const sourceOwner=this.captureSourceOwnership();if(!this.sourceOwnershipActive(sourceOwner)){return;}
    const authorization=this.#activeAuthorizationScope();
    return this.#nativeImagePublisherWork(async()=>{
      this.busy.set("taste-model");this.notify();
      const response=await this.guardedFetch("/api/events",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"refresh_taste_model",expectedSequence:this.head.get(),clientId:"web:memory"})},"refresh the fictional account’s taste model");
      this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);
      const body=await response.json() as {appended?:CreativeEvent[];head?:number;error?:string;beliefs?:number};this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);if(!response.ok)throw new Error(body.error === "phase6_advance_required"?"Record the Phase 6 advance-with-monitoring decision first.":body.error??"Taste model refresh failed");
      this.events.set([...this.events.get(),...(body.appended??[])]);this.head.set(body.head??this.head.get());this.toast((body.beliefs??0)===1?this.#systemNotice("Taste model versioned with {count} ranking-only belief.",{count:body.beliefs??0}):this.#systemNotice("Taste model versioned with {count} ranking-only beliefs.",{count:body.beliefs??0}));
    },()=>{if((this.#scopeStillActive(authorization)&&this.sourceOwnershipActive(sourceOwner))){this.busy.set("");this.notify();}},
    error=>{if((this.#scopeStillActive(authorization)&&this.sourceOwnershipActive(sourceOwner)))this.toast(error instanceof Error?error.message:"Taste model refresh failed");});
  }

  async setCondition(condition:string,triggerKind:"generation_count"|"on_date",threshold:number,onDate:string|null){
    const sourceOwner=this.captureSourceOwnership();if(!this.sourceOwnershipActive(sourceOwner)){return;}
    const authorization=this.#activeAuthorizationScope();
    return this.#nativeImagePublisherWork<boolean>(async()=>{
      this.busy.set("set-condition");this.notify();
      const response=await this.guardedFetch("/api/events",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"set_condition",expectedSequence:this.head.get(),clientId:"web:memory",condition,triggerKind,threshold,onDate})},"set a time condition in the fictional account");this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);const body=await response.json() as {appended?:CreativeEvent[];content?:Record<string,string>;head?:number;error?:string};this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);if(!response.ok)throw new Error(body.error??"Condition could not be set");this.events.set([...this.events.get(),...(body.appended??[])]);this.content.set({...this.content.get(),...(body.content??{})});this.head.set(body.head??this.head.get());this.toast("Time policy recorded privately.");return true;
    },()=>{if((this.#scopeStillActive(authorization)&&this.sourceOwnershipActive(sourceOwner))){this.busy.set("");this.notify();}},
    error=>{if((this.#scopeStillActive(authorization)&&this.sourceOwnershipActive(sourceOwner)))this.toast(error instanceof Error?error.message:"Condition could not be set");return false;});
  }

  async checkConditions(){
    const sourceOwner=this.captureSourceOwnership();if(!this.sourceOwnershipActive(sourceOwner)){return;}
    const authorization=this.#activeAuthorizationScope();
    return this.#nativeImagePublisherWork(async()=>{
      this.busy.set("check-conditions");this.notify();
      const response=await this.guardedFetch("/api/events",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"check_conditions",expectedSequence:this.head.get(),clientId:"web:memory"})},"check time conditions in the fictional account");this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);const body=await response.json() as {appended?:CreativeEvent[];head?:number;error?:string};this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);if(!response.ok)throw new Error(body.error??"Policy check failed");this.events.set([...this.events.get(),...(body.appended??[])]);this.head.set(body.head??this.head.get());this.toast(body.appended?.length?body.appended.length===2?this.#systemNotice("{count} condition resurfaced.",{count:Math.floor(body.appended.length/2)}):this.#systemNotice("{count} conditions resurfaced.",{count:Math.floor(body.appended.length/2)}):"No time policies are due yet.");
    },()=>{if((this.#scopeStillActive(authorization)&&this.sourceOwnershipActive(sourceOwner))){this.busy.set("");this.notify();}},
    error=>{if((this.#scopeStillActive(authorization)&&this.sourceOwnershipActive(sourceOwner)))this.toast(error instanceof Error?error.message:"Policy check failed");});
  }

  async critiqueObject(objectId:string,axis:string,polarity:"positive"|"negative",value:string,note:string){
    const sourceOwner=this.captureSourceOwnership();if(!this.sourceOwnershipActive(sourceOwner)){return;}
    const authorization=this.#activeAuthorizationScope();
    return this.#nativeImagePublisherWork<boolean>(async()=>{
      this.busy.set("critique-object");this.notify();
      const response=await this.guardedFetch("/api/events",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"critique_object",expectedSequence:this.head.get(),clientId:"web:studio",objectId,axis,polarity,value,note})},"record this critique in the fictional account");this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);const body=await response.json() as {appended?:CreativeEvent[];content?:Record<string,string>;head?:number;error?:string};this.#assertAuthorizationScope(authorization);this.#assertSourceOwnership(sourceOwner);if(!response.ok)throw new Error(body.error??"Critique could not be recorded");this.events.set([...this.events.get(),...(body.appended??[])]);this.content.set({...this.content.get(),...(body.content??{})});this.head.set(body.head??this.head.get());this.toast("Axis-specific critique recorded for the taste ledger.");return true;
    },()=>{if((this.#scopeStillActive(authorization)&&this.sourceOwnershipActive(sourceOwner))){this.busy.set("");this.notify();}},
    error=>{if((this.#scopeStillActive(authorization)&&this.sourceOwnershipActive(sourceOwner)))this.toast(error instanceof Error?error.message:"Critique could not be recorded");return false;});
  }

  canManageProjectShares(){const session=this.session.get(),context=session?.projectContext;return Boolean(session)&&(!context||context.role==="owner"&&context.ownerUserId===session.user.userId);}
  async loadShares() {
    const sourceOwner=this.captureSourceOwnership();if(!this.sourceOwnershipActive(sourceOwner)){return;}
    if(!this.canManageProjectShares()){this.shares.set([]);return;}
    const authorization=this.#activeAuthorizationScope(),response=await fetch("/api/shares");if(!response.ok||!(this.#scopeStillActive(authorization)&&this.sourceOwnershipActive(sourceOwner)))return;const body=await response.json() as {shares:ShareRecord[]};if(!(this.#scopeStillActive(authorization)&&this.sourceOwnershipActive(sourceOwner)))return;this.shares.set(body.shares);this.notify();
  }

  async createShare(expiresHours: number) {
    if(!this.canManageProjectShares()){this.toast("Only this project's owner can manage its private review links.");return null;}
    const authorization=this.#activeAuthorizationScope(),projection=this.projection.get();if(!projection.documentId||!projection.projectId){this.toast("Open the document you want to share first.");return null;}
    const response=await this.guardedFetch("/api/shares",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({expiresHours,resourceKind:"document",documentId:projection.documentId,projectId:projection.projectId})},"create a share link for this fictional document");this.#assertAuthorizationScope(authorization);const body=await response.json() as {share?:ShareRecord;error?:string};this.#assertAuthorizationScope(authorization);
    if(!response.ok||!body.share){this.toast(body.error??"Share link could not be created");return null;}
    await this.loadShares();this.#assertAuthorizationScope(authorization);if(this.projection.get().documentId!==projection.documentId||this.projection.get().projectId!==projection.projectId)throw new Error("The active document changed before its review link was ready.");this.toast("Private read-only link created.");return body.share;
  }

  async revokeShare(shareId: string) {
    const authorization=this.#activeAuthorizationScope(),response=await this.guardedFetch(`/api/shares/${encodeURIComponent(shareId)}`,{method:"DELETE"},"revoke this fictional document’s share link");this.#assertAuthorizationScope(authorization);const body=await response.json() as {error?:string};this.#assertAuthorizationScope(authorization);
    if(!response.ok)return this.toast(body.error??"Share link could not be revoked");await this.loadShares();this.#assertAuthorizationScope(authorization);this.toast("Share link revoked immediately.");
  }

  #canvasHistoryEvent(event:CreativeEvent,canvasId:string){return String(event.payload.canvas_id??event.payload.source_canvas_id??"")===canvasId&&Boolean(inverseEvent(event));}
  #historyIndex(groups:HistoryGroup[],canvasId=""){for(let index=groups.length-1;index>=0;index-=1)if(groups[index].some((event)=>canvasId?this.#canvasHistoryEvent(event,canvasId):Boolean(inverseEvent(event))))return index;return-1;}
  #streamCanvasUndoGroup(canvasId:string){const ownerId=this.session.get()?.user.userId??"";if(!ownerId)return null;const actor=this.#principalEventActor(),events=this.events.get();const compensated=new Set(events.map((event)=>event.compensatesEventId).filter(Boolean));const undone=outcomeArrangementUndoneActions(events,canvasId,ownerId);const owned=events.filter((event)=>(event.actor===actor||isProtectedOutcomeArrangementEvent(event,ownerId))&&!event.compensatesEventId&&event.payload.history_owner_id===ownerId&&this.#canvasHistoryEvent(event,canvasId));const eligible=owned.filter((event)=>!compensated.has(event.eventId)&&!undone.has(String(event.payload.history_action_id??"")));const latest=eligible.at(-1);if(!latest)return null;const actionId=String(latest.payload.history_action_id??latest.eventId);const action=owned.filter((event)=>String(event.payload.history_action_id??event.eventId)===actionId);return action.some((event)=>event.type==="CanvasArrangementCreated")?action:eligible.filter((event)=>String(event.payload.history_action_id??event.eventId)===actionId);}
  /** Remember only an independently refreshed canonical server edit. A receipt
   * pointer cannot inject text, grant authorship or revive a retired preview.
   * Shared event reads deliberately omit private Chat pointers; the canonical
   * event identity and execution receipt identify the accepted public edit. */
  rememberMemoryAuthoredEdit(receipt:{eventId:string;executionId:string;turnId?:string;jobId?:string;blockId:string;projectId:string;documentId:string}){
    const owner=this.captureSourceOwnership(),projection=this.projection.get();
    if(!this.sourceOwnershipActive(owner)||projection.projectId!==receipt.projectId||projection.documentId!==receipt.documentId)return false;
    const event=this.events.get().find(item=>item.eventId===receipt.eventId),block=projection.blocks.find(item=>item.id===receipt.blockId);
    if(!event||event.actor!==this.#principalEventActor()||event.clientId!=='web:assistant-memory'||event.compensatesEventId
      ||!['BlockCreated','BlockPropertyEdited'].includes(event.type)||event.payload.memory_authored_version!==1
      ||event.payload.request_id!==receipt.executionId||event.payload.block_id!==receipt.blockId
      ||event.payload.project_id!==receipt.projectId||event.payload.document_id!==receipt.documentId
      ||!block||block.removed||block.sourceEvents.at(-1)!==event.eventId
      ||(event.type==='BlockCreated'?typeof (event.payload.properties as Record<string,unknown>)?.text!=='string'
        ||block.properties.text!==(event.payload.properties as Record<string,unknown>).text
        :event.payload.property_path!=='text'||typeof event.payload.old_value!=='string'||typeof event.payload.new_value!=='string'||block.properties.text!==event.payload.new_value)
      ||this.events.get().some(item=>item.compensatesEventId===event.eventId)
      ||this.#undo.some(group=>group.some(item=>item.eventId===event.eventId)))return false;
    this.#mergeConfirmed([event],this.head.get(),true);this.notify();return true;
  }

  canUndo() {
    const canvasId=canvasIdFromRoute(this.route.get())??"";if(this.#historyIndex(this.#undo,canvasId)>=0)return true;if(canvasId)return Boolean(this.#streamCanvasUndoGroup(canvasId));
    const compensated=new Set(this.events.get().map((event)=>event.compensatesEventId).filter(Boolean));
    const actor=this.#principalEventActor();return this.events.get().some((event)=>event.actor===actor&&!event.compensatesEventId&&!compensated.has(event.eventId)&&Boolean(inverseEvent(event)));
  }
  canRedo() { return this.#historyIndex(this.#redo,canvasIdFromRoute(this.route.get())??"")>=0; }
  #undoCandidate(canvasId="") {
    if(canvasId){const streamed=this.#streamCanvasUndoGroup(canvasId);if(streamed?.length){const actionId=String(streamed.at(-1)?.payload.history_action_id??streamed.at(-1)?.eventId??"");const remembered=this.#undo.findLastIndex((group)=>group.some((event)=>String(event.payload.history_action_id??event.eventId)===actionId));if(remembered>=0)this.#undo.splice(remembered,1);return streamed;}return null;}
    const index=this.#historyIndex(this.#undo);if(index>=0)return this.#undo.splice(index,1)[0];
    const compensated=new Set(this.events.get().map((event)=>event.compensatesEventId).filter(Boolean));
    const actor=this.#principalEventActor(),fallback=[...this.events.get()].reverse().find((event)=>event.actor===actor&&!event.compensatesEventId&&!compensated.has(event.eventId)&&Boolean(inverseEvent(event)));return fallback?[fallback]:null;
  }
  async undo() {
    const sourceOwner=this.captureSourceOwnership();if(!this.sourceOwnershipActive(sourceOwner))return;
    const canvasId=canvasIdFromRoute(this.route.get())??"";const source = this.#undoCandidate(canvasId); if (!source?.length) return this.toast(canvasId?"Nothing to undo on this board.":documentViewFromRoute(this.route.get()) === "editor" ? "Nothing to undo." : "Nothing reversible remains in this document history.");
    if(source.some((event)=>isProtectedOutcomeArrangementEvent(event))){
      const ownerId=this.session.get()?.user.userId??"",authorization=this.captureAuthorizationScope();
      const original=source.find((event)=>event.type==="CanvasArrangementCreated"&&isProtectedOutcomeArrangementEvent(event,ownerId));
      if(!original||!authorization||!canvasId||original.payload.canvas_id!==canvasId)return this.toast(this.#systemNotice("This exact action changed or is no longer available. Review the current document."));
      this.canvasArrangementUndoRequest.set({eventId:original.eventId,operationId:String(original.payload.history_action_id),projectId:String(original.payload.project_id),canvasId,authorityKey:authorization.key});
      this.notify();return;
    }
    const inverses=source.toReversed().map((event)=>{const inverse=inverseEvent(event)!;return{...inverse,payload:withoutClientEventId(inverse.payload),compensatesEventId:event.eventId};});
    const result = await this.appendBatchWithReceipt(inverses, { remember: false });
    if(this.sourceOwnershipActive(sourceOwner)&&this.#eventWriteComplete(result,inverses))this.#redo.push(source);
  }

  async redo() {
    const sourceOwner=this.captureSourceOwnership();if(!this.sourceOwnershipActive(sourceOwner))return;
    const canvasId=canvasIdFromRoute(this.route.get())??"";const index=this.#historyIndex(this.#redo,canvasId);const source=index>=0?this.#redo.splice(index,1)[0]:null;if (!source?.length) return this.toast(canvasId?"Nothing to redo on this board.":"Nothing to redo in this session.");
    const inputs=source.map(event=>{
      if(event.payload.memory_authored_version!==1||!['BlockCreated','BlockRestored'].includes(event.type))return redoEvent(event);
      // Recreating an existing shared ID is not restoration authority. Replay
      // the exact same-author removal through the bounded native restore path.
      const removed=this.events.get().findLast(item=>item.type==='BlockRemoved'&&item.compensatesEventId===event.eventId
        &&item.actor===event.actor&&item.payload.block_id===event.payload.block_id);
      if(!removed)return null;
      return {type:'BlockRestored',compensatesEventId:removed.eventId,payload:{block_id:event.payload.block_id,
        project_id:event.payload.project_id,document_id:event.payload.document_id,memory_authored_version:1,request_id:event.payload.request_id}};
    });
    if(inputs.some(input=>input===null)){this.#redo.splice(index,0,source);return this.toast(this.#systemNotice('This exact action changed or is no longer available. Review the current document.'));}
    const result = await this.appendBatchWithReceipt(inputs.filter((input):input is EventInput=>input!==null), { remember: false });
    if(!this.sourceOwnershipActive(sourceOwner)||result.publication!=="published")return;
    const actor=this.#principalEventActor(),redone=result.appended.filter((event)=>event.actor===actor&&Boolean(inverseEvent(event)));if(redone.length)this.#undo.push(redone);
  }

  buildReplay(events: CreativeEvent[]) { this.replayEvents.set(events); this.replayAsOf.set(0); this.notify(); }
  setReplayAsOf(value: number) { this.replayAsOf.set(value); this.notify(); }
}

let historyClock=0;
function historyHlc(event:CreativeEvent,mode:"undo"|"redo"){
  const operation=event.payload.operation&&typeof event.payload.operation==="object"&&!Array.isArray(event.payload.operation)?event.payload.operation as Record<string,unknown>:{};const source=operation.hlc&&typeof operation.hlc==="object"&&!Array.isArray(operation.hlc)?operation.hlc as Record<string,unknown>:{};
  const principal=event.actor.startsWith("user:")?event.actor.slice(5):"";
  historyClock=Math.max(Date.now(),Number(source.pt??0)+1,historyClock+1);return{pt:historyClock,c:0,site:principal?`${principal}:${mode}:${event.clientId}`:`${mode}:${event.clientId}`};
}

function inverseEvent(event: CreativeEvent): EventInput | null {
  const p = event.payload;
  const pairs: Record<string, string> = { BlockLocked: "BlockUnlocked", BlockUnlocked: "BlockLocked", BlockDocumentAttached:"BlockDocumentDetached", BlockDocumentDetached:"BlockDocumentAttached", BlockRemoved: "BlockRestored", BlockRestored: "BlockRemoved", BlockRelationAdded: "BlockRelationRemoved", BlockRelationRemoved: "BlockRelationAdded", DocumentRemoved: "DocumentRestored", DocumentRestored: "DocumentRemoved", ObjectPinned: "ObjectUnpinned", ObjectUnpinned: "ObjectPinned", AddedToLibrary: "RemovedFromLibrary", RemovedFromLibrary: "AddedToLibrary", CanvasItemRemoved:"CanvasItemRestored", CanvasItemRestored:"CanvasItemRemoved", CanvasArrangementRemoved:"CanvasArrangementRestored", CanvasArrangementRestored:"CanvasArrangementRemoved", CanvasRemoved:"CanvasRestored", CanvasRestored:"CanvasRemoved", MembershipAdded:"MembershipRemoved", MembershipRemoved:"MembershipAdded" };
  if (pairs[event.type]) return { type: pairs[event.type], payload: p };
  if (event.type === "BlockCreated") return { type: "BlockRemoved", payload: { block_id: p.block_id, project_id:p.project_id, document_id:p.document_id, canvas_id:p.canvas_id, source_canvas_id:p.source_canvas_id, reason: "undo-created-block" } };
  if (event.type === "DocumentCreated") return { type: "DocumentRemoved", payload: { document_id:p.document_id, project_id:p.project_id, canvas_id:p.canvas_id, source_canvas_id:p.source_canvas_id, was_current:true, reason:"undo-created-document" } };
  if (event.type === "CanvasCreated") return { type: "CanvasRemoved", payload: { canvas_id:p.canvas_id, project_id:p.project_id, reason:"undo-created-canvas" } };
  if (event.type === "CanvasItemPlaced" || event.type === "CanvasReferenceCreated") return { type:"CanvasItemRemoved", payload:{canvas_id:p.canvas_id,project_id:p.project_id,item_id:p.item_id??p.reference_item_id,reason:"undo-placed-item"} };
  if (event.type === "CanvasArrangementCreated") return { type:"CanvasArrangementRemoved", payload:{canvas_id:p.canvas_id,project_id:p.project_id,arrangement_id:p.arrangement_id,reason:"undo-created-arrangement"} };
  if(event.type==="StrokeAdded"){
    const operation=p.operation&&typeof p.operation==="object"&&!Array.isArray(p.operation)?p.operation as Record<string,unknown>:{};const stroke=operation.stroke&&typeof operation.stroke==="object"&&!Array.isArray(operation.stroke)?operation.stroke as Record<string,unknown>:{};
    return{type:"StrokeErased",payload:{canvas_id:p.canvas_id,project_id:p.project_id,item_id:p.item_id,operation:{sketch:operation.sketch??{item_id:p.item_id},target:stroke.id}}};
  }
  if (event.type === "CollectionCreated") return { type: "CollectionRemoved", payload: { collection_id: p.collection_id, reason: "undo-created-collection" } };
  if (event.type === "BlockRenamed") return { type: event.type, payload: { ...p, old_handle: p.new_handle, new_handle: p.old_handle } };
  if (event.type === "CollectionRenamed") return { type: event.type, payload: { ...p, old_handle: p.new_handle, new_handle: p.old_handle } };
  if (event.type === "ProjectRenamed") return { type: event.type, payload: { ...p, old_name: p.new_name, new_name: p.old_name } };
  if (event.type === "ProjectStateChanged") return { type: event.type, payload: { ...p, state: p.previous_state, previous_state: p.state } };
  if (event.type === "ProjectOpened") return { type: event.type, payload: { ...p, project_id: p.previous_project_id, previous_project_id: p.project_id } };
  if (event.type === "DocumentOpened") return { type: event.type, payload: { ...p, document_id: p.previous_document_id, previous_document_id: p.document_id } };
  if (event.type === "CollectionItemAdded") return { type: "CollectionItemRemoved", payload: p };
  if (event.type === "CollectionItemRemoved") return { type: "CollectionItemAdded", payload: p };
  if (event.type === "CollectionItemMoved") return { type: event.type, payload: { ...p, from_collection_id: p.to_collection_id, to_collection_id: p.from_collection_id } };
  if (event.type === "BlockPropertyEdited") return { type: event.type, payload: { ...p, old_value: p.new_value, new_value: p.old_value } };
  if (event.type === "DocumentRenamed") return { type: event.type, payload: { ...p, old_title: p.new_title, new_title: p.old_title } };
  if (event.type === "OutputRenamed") return { type: event.type, payload: { ...p, old_title: p.new_title, new_title: p.old_title } };
  if (event.type === "BlockWeightSet") return { type: event.type, payload: { ...p, weight: p.previous_weight, previous_weight: p.weight } };
  if (event.type === "ChipEdited") return { type: event.type, payload: { ...p, old_value: p.new_value, new_value: p.old_value } };
  if(event.type==="CanvasRegisterSet"){
    const operation=p.operation&&typeof p.operation==="object"&&!Array.isArray(p.operation)?p.operation as Record<string,unknown>:{};if(!Object.hasOwn(p,"previous_value"))return null;
    return{type:event.type,payload:{...p,previous_value:operation.value,operation:{...operation,value:p.previous_value,hlc:historyHlc(event,"undo")}}};
  }
  return null;
}

function redoEvent(event:CreativeEvent):EventInput{
  if(event.type==="StrokeAdded"){
    const payload=withoutClientEventId(event.payload);const operation=payload.operation&&typeof payload.operation==="object"&&!Array.isArray(payload.operation)?payload.operation as Record<string,unknown>:{};const stroke=operation.stroke&&typeof operation.stroke==="object"&&!Array.isArray(operation.stroke)?operation.stroke as Record<string,unknown>:{};
    return{type:event.type,payload:{...payload,operation:{...operation,stroke:{...stroke,id:[`redo:${event.clientId}`,Date.now()]}}}};
  }
  if(event.type!=="CanvasRegisterSet")return{type:event.type,payload:withoutClientEventId(event.payload)};
  const operation=event.payload.operation&&typeof event.payload.operation==="object"&&!Array.isArray(event.payload.operation)?event.payload.operation as Record<string,unknown>:{};
  return{type:event.type,payload:{...withoutClientEventId(event.payload),operation:{...operation,hlc:historyHlc(event,"redo")}}};
}

function withoutClientEventId(payload:Record<string,unknown>){const fresh={...payload};delete fresh.client_event_id;return fresh;}

export const store = new FormaStore();
