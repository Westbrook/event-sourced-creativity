import type { OutputNavigationFocusLease } from "../components/output-navigation-focus";
import { copyOutputRequirementCreationEvents } from "../model/output-requirement-copy.ts";
import { OutputRequirementsClient } from "./output-requirements-client";
import type { OutputCommandResponse, OutputRequirementCommand, OutputRequirementsSnapshot } from "../model/output-delivery-contract";
import { isOutputContextBlock } from "../model/output-source-policy";
import { outputRequirementEditableDraft } from "../model/output-requirements";
import { resolvePresentationCountRequest, type SlideCountPolicy } from "../model/presentation-count-policy";
import { Signal } from "signal-polyfill";
import { adaptiveRequestKey, adaptiveJobMatchesRequest } from "../model/adaptive-request";
import { contextConsentAction, contextConsentFailure, type ContextConsentAction } from "../model/context-consent-state";
import type { AvailableConsequentialPreview } from "../../worker/consequential-consent";
import { SignalObject } from "signal-utils/object";
import { foldEvents, type CreativeEvent, type CreativeProjection, type EventInput } from "../model/events";
import type { ImageSample, ReferenceFindingKind } from "../model/extractors";
import { readAttentionPreference, writeAttentionPreference } from "../model/attention";
import { adaptiveSuggestionsForCanvas, blockEffectFor, blockIntentFor, type AdaptiveStructure, type AdaptiveSuggestionSet } from "../model/block-types";
import { documentFocusFromRoute, documentIdFromRoute, documentViewFromRoute, isDocumentViewRoute, withDocumentFocusInRoute, withDocumentInRoute } from "../model/routes";
import { normalizeSpatialScope } from "../model/spatial-scope";
import { CURRENT_FOCAL_POINT_METHOD, normalizeImageFocalPoint } from "../model/focal-point";
import { resolveImageFocalAnalysis } from "../model/image-focus";
import { documentGenerationRequestKey as generationRequestKeyFor, documentGenerationRevision as generationRevisionFor, documentJobCanRecoverPresentation, documentJobFailure, documentJobIsStale, documentJobTerminal, documentJobStopBudgetMessage, documentJobHasNoBudgetHold, planningStopBudget, generationFailureGuidance, type DocumentJob, type DocumentJobKind, type DocumentJobStopBudget } from "../model/document-jobs";
import { effectivePromptPreference, normalizePromptTechnique, type PromptPreferenceScope, type PromptTechnique } from "../model/prompt-structures";
import { canvasIdFromRoute } from "../canvas/routes";
import { canvasDocumentTarget, documentJobMatchesSurface } from "../model/canvas-document-target";
import { canvasProjectId, foldCanvasEvents, type CanvasContextSet, type CanvasProjection } from "../canvas/model";
import type { GenerationReadiness, GenerationReadinessKind, PromptTechniqueSafetyComparison } from "../model/generation-readiness";
import { parseDocumentArtifactContent, type DocumentArtifactKind, type SlidePresentation, type SlideStylePresetId } from "../model/document-artifacts";
import { artifactContextEvents, imageOutputContextEvents } from "../model/output-context";
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
import { clearAccountSnapshots, clearAnalyticsSnapshots, matchingAccountSnapshot, readAccountSnapshots, writeAccountSnapshot, type AccountSnapshotIdentity, type AccountSnapshotProfile } from "./account-cache";
import { canvasOfflineQueue } from "../sync/canvas-offline-queue";
import { consumeSessionBootstrap, consumeSessionPrefetch } from "./session-bootstrap";
import { routeCapabilities } from "./route-capabilities";
import type { FormaCapability } from "../platform/capabilities";
import { applicationIdFromRoute, type ApplicationId } from "../platform/applications";
import { workspaceTransitionAuthorized } from "../platform/workspace-transitions";
import type { PresentationCandidateDetail, PresentationCandidateList, PresentationCandidateSummary, PreservedPresentationCandidateJobs } from "../model/presentation-candidates";

type WorkspaceNavigationOptions = { replace?:boolean; documentFocus?:boolean; current?:()=>boolean; focus?:OutputNavigationFocusLease };
const workspaceNavigationCurrent=(options:WorkspaceNavigationOptions)=>(!options.current||options.current())&&(!options.focus||options.focus.current());
type Listener = () => void;
type HistoryGroup = CreativeEvent[];
export type CanvasSyncResult = { appended:CreativeEvent[]; rejected:Array<{index?:number;type?:string;reason:string}>; head:number; retryable:boolean; error:string };
export type PilotSession = {
  user: { userId: string; email: string; displayName: string; role: "admin" | "creator" | "agent" | "viewer"; consentVersion: string | null; consentedAt: string | null };
  impersonation: { active:true; impersonationId:string; personaId:string; replaySessionId:string; actor:{userId:string;email:string;displayName:string;role:"admin"|"creator"|"agent"|"viewer"}; fictionalUser:{userId:string;email:string;displayName:string;role:"admin"|"creator"|"agent"|"viewer"}; startedAt:string; expiresAt:string } | null;
  policy: { version: string; accepted: boolean; passiveCapture: false; attentionCapture?: { available: boolean; defaultOn: false; retentionDays: number; rawInputCapture: false }; externalAssetsRequireAssertion: true; retentionDays: number; evidenceRetentionDays?:number; sharing: string };
  canvas: { version:string; mode:"internal"|"pilot"; pilotAvailable:boolean; access:boolean; accessReason:"administrator-internal-review"|"pilot-approved"|"pilot-gate-incomplete"|"role-not-eligible"; blockedBy:Array<"trust_safety"|"counsel"|"second_image_adapter">; requirements:Array<{id:"trust_safety"|"counsel"|"second_image_adapter";label:string;summary:string;approved:boolean;approvedBy:string|null;approvedByUserId:string|null;approvedAt:string|null;evidenceRef:string|null;details:Record<string,unknown>}> };
  provider: { name: string; model: string; plannerModel?: string; plannerConfigured?: boolean; configured: boolean; imageProvider?:string; imageProviders?:Array<{provider:string;model:string;previewModel?:string;editModel?:string;configured:boolean}>; videoProvider?:string; videoModel?:string; videoReferenceModel?:string; videoAdapterVersion?:string; videoConfigured?:boolean; videoApiSunset?:string|null; audioProvider?:string; audioModel?:string; audioConfigured?:boolean; audioModels?:Array<{model:string;label:string;capabilities:readonly string[];maximumDurationSeconds:number;pricing:{mode:string;amountMicrousd:number;minimumBillableSeconds?:number}}> };
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
  readonly outputRequirements = new OutputRequirementsClient<OutputRequirementsSnapshot>({
    captureScope: () => {
      const scope = this.captureAuthorizationScope();
      return scope ? { key: scope.key, projectId: this.projection.get().projectId || null } : null;
    },
    scopeActive: (scope) => this.captureAuthorizationScope()?.key === scope.key && (this.projection.get().projectId || null) === scope.projectId,
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
  readonly session = new Signal.State<PilotSession | null>(null);
  readonly content = new Signal.State<Record<string, string>>({});
  readonly shares = new Signal.State<ShareRecord[]>([]);
  readonly projectNotifications = new Signal.State<ProjectNotification[]>([]);
  readonly organizationContextPackages = new Signal.State<OrganizationContextPackage[]>([]);
  readonly organizationContextBindings=new Signal.State<OrganizationContextBinding[]>([]);
  readonly organizationContextVersions=new Signal.State<Record<string,OrganizationContextVersion>>({});
  readonly reviewInbox = new Signal.State<AssignedReviewTask[]>([]);
  readonly documentJobs = new Signal.State<DocumentJob[]>([]);
  readonly generationReadiness = new Signal.State<Record<string,GenerationReadiness>>({});
  readonly adaptiveStructures = new Signal.State<Record<string,AdaptiveStructure>>({});
  readonly planningConsent = new Signal.State<PlanningConsentState|null>(null);
  readonly adaptiveSuggestionSets = new Signal.State<Record<string,AdaptiveSuggestionSet[]>>({});
  readonly canvasPlanningChoices = new Signal.State<Record<string,string>>({});
  readonly canvasPlanningSelection = new Signal.State({scope:"",canvasId:"",itemIds:[] as string[]});
  readonly ui = new SignalObject({ inspectorOpen: false, commandOpen: false, accountOpen: false, shareOpen: false, compareOpen: false, projectRailCollapsed: window.matchMedia?.("(max-width: 75rem), (max-height: 37.5rem)")?.matches ?? false, instrumentation: true, attentionCapture: readAttentionPreference(), attentionPaused: false, impersonationConfirmOpen:false, impersonationAction:"", selectedEventId: "", selectedOutputId: "", comparisonOutputIds: "", focusBlockId: "", focusCollectionId: "", editingBlockId: "", libraryView: "all", libraryOutputScope: "recent", search: "", toast: "" });
  readonly projection = new Signal.Computed<CreativeProjection>(() => {
    const route = this.route.get();
    const canvasId=canvasIdFromRoute(route)??"";
    const events=this.eventView.get();
    return foldEvents(events, this.asOf.get(), isDocumentViewRoute(route) ? documentIdFromRoute(route) ?? "" : "", canvasId?canvasProjectId(events,canvasId):"");
  });
  readonly canvasProjection = new Signal.Computed<CanvasProjection>(() => foldCanvasEvents(this.eventView.get(),this.projection.get().projectId,canvasIdFromRoute(this.route.get())??""));
  readonly replayProjection = new Signal.Computed<CreativeProjection>(() => foldEvents(this.replayEvents.get(), this.replayAsOf.get()));
  #listeners = new Set<Listener>();
  #undo: HistoryGroup[] = [];
  #redo: HistoryGroup[] = [];
  #rememberedClientEventIds = new Set<string>();
  #appendPipeline:Promise<void> = Promise.resolve();
  #navigationCommit:Promise<boolean>|null=null;
  #workspaceTransition=0;
  #workspaceNavigationFocus: { route:string; focus:OutputNavigationFocusLease } | null = null;

  captureWorkspaceNavigationFocus(route:string,expected?:OutputNavigationFocusLease) {
    const owner=this.#workspaceNavigationFocus;
    if(!owner||owner.route!==route||(expected&&owner.focus!==expected))return null;
    return {focus:owner.focus,current:()=>this.#workspaceNavigationFocus===owner&&this.route.get()===route&&owner.focus.current()};
  }
  #loadRevision=0;
  #sessionRevision=0;
  #focalInFlight = new Set<string>();
  #focalAppendQueue: Promise<void> = Promise.resolve();
  #jobPollTimer = 0;
  #collaborationPollTimer = 0;
  #jobsSyncing = false;
  #jobSyncScope = "";
  #jobResyncRequested = false;
  #jobPollFailures = 0;
  #jobPollIssueNotified = false;
  #pendingJobEventRefresh = false;
  #pendingJobSessionRefresh = false;
  #jobsDriving = new Set<string>();
  #presentationRecoveryAttempts = new Set<string>();
  #jobDetails = new Map<string, DocumentJob>();
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
    if(this.planningConsent.get()&&(!this.#scopeStillActive(this.#planningConsentScope)||this.route.get()!==this.#planningConsentRoute))this.#finishPlanningConsent(false);
    this.#listeners.forEach((listener) => listener());
  }
  #publishAppended(events:CreativeEvent[]){
    if(!events.length)return;
    if (events.some((event) => event.type.startsWith("Output") || /^(?:Block|Document|Rights|Artifact|GenerationCompleted)/.test(event.type))) this.outputRequirements.invalidate();
    const session=this.session.get();if(session&&events.some((event)=>event.type==="AttentionSignalsForgotten"))void clearAnalyticsSnapshots(this.#snapshotIdentity(session),true);
    if(session?.projectContext&&events.some((event)=>["ArtifactReviewRequested","ArtifactApproved","ArtifactChangesRequested","DocumentArtifactEdited","DocumentRenderCompleted","BlockCreated","BlockPropertyEdited","BlockRemoved","BlockRestored","BlockRelationAdded","BlockRelationRemoved","RightsAsserted"].includes(event.type))){void this.syncProjectNotifications();void this.syncReviewInbox();}
    else if(session?.projectContext&&events.some((event)=>event.type==="OutputRenamed"))void this.syncReviewInbox();
    window.dispatchEvent(new CustomEvent("forma-events-appended",{detail:{events}}));
    const needsImageMaintenance=events.some((event)=>["GenerationCompleted","IdeationPreviewCompleted","DocumentRenderCompleted","ReferenceIngested","BlockCreated"].includes(event.type));
    if(needsImageMaintenance&&!this.session.get()?.impersonation){
      window.clearTimeout(this.#focalBackfillTimer);
      this.#focalBackfillTimer=window.setTimeout(()=>this.#backfillImageFocalPoints(),3_000);
    }
  }
  #hasFocalPoint(targetKind:"generation"|"reference"|"artifact",targetId:string){const projection=this.projection.get();const point=targetKind==="generation"?(projection.libraryOutputs.find((output)=>output.id===targetId)?.focalPoint??projection.outputs.find((output)=>output.id===targetId)?.focalPoint):targetKind==="artifact"?projection.libraryArtifacts.flatMap((artifact)=>artifact.items).find((item)=>item.id===targetId)?.focalPoint:normalizeImageFocalPoint(projection.libraryBlocks.find((block)=>block.id===targetId)?.properties.focal_point??projection.blocks.find((block)=>block.id===targetId)?.properties.focal_point);return point?.method===CURRENT_FOCAL_POINT_METHOD;}
  #backfillImageFocalPoints(){
    const projection=this.projection.get();const seen=new Set<string>();
    for(const output of [...projection.outputs,...projection.libraryOutputs])if(output.mediaUrl&&String(output.mediaType??"").startsWith("image/")&&output.focalPoint?.method!==CURRENT_FOCAL_POINT_METHOD&&!seen.has(`generation:${output.id}`)){seen.add(`generation:${output.id}`);void this.calculateImageFocalPoint({targetKind:"generation",targetId:output.id,mediaUrl:output.mediaUrl});}
    for(const item of projection.libraryArtifacts.flatMap((artifact)=>artifact.items))if(item.mediaUrl&&String(item.mediaType??"").startsWith("image/")&&item.focalPoint?.method!==CURRENT_FOCAL_POINT_METHOD&&!seen.has(`artifact:${item.id}`)){seen.add(`artifact:${item.id}`);void this.calculateImageFocalPoint({targetKind:"artifact",targetId:item.id,mediaUrl:item.mediaUrl});}
    for(const block of [...projection.blocks,...projection.libraryBlocks]){const mediaUrl=String(block.properties.media_url??"");const sourceMimeType=String(block.properties.source_mime_type??block.properties.media_type??"");if(block.type!=="reference"||!mediaUrl||sourceMimeType&&!sourceMimeType.startsWith("image/")||block.properties.extraction_status==="pending"||normalizeImageFocalPoint(block.properties.focal_point)?.method===CURRENT_FOCAL_POINT_METHOD||seen.has(`reference:${block.id}`))continue;seen.add(`reference:${block.id}`);void this.calculateImageFocalPoint({targetKind:"reference",targetId:block.id,referenceId:String(block.properties.reference_id??""),mediaUrl});}
  }
  #reflectDocumentInRoute() {
    const currentRoute = this.route.get();
    if (!isDocumentViewRoute(currentRoute)) return;
    const projection = this.projection.get();
    const canonicalRoute = withDocumentInRoute(currentRoute, projection.documentId, projection.documentTitle);
    if (projection.documentId && canonicalRoute !== currentRoute) this.setRoute(canonicalRoute, { replace: true });
  }
  #generationContext(documentId=this.projection.get().documentId,contextRootBlockId="",characterOutputKind:"headshot"|"character_sheet"="headshot") {
    const projection=this.projection.get();
    const documentBlocks=projection.libraryBlocks.filter((block)=>block.documentId===documentId);
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
  documentGenerationRevision(){return this.#generationContext().documentRevision;}
  promptTechniquePreference(){const projection=this.projection.get();const filed=projection.membership[projection.documentId];return effectivePromptPreference(projection.preferences,{documentId:projection.documentId,collectionIds:filed?[filed.collectionId]:[],projectId:projection.projectId,accountId:this.session.get()?.user.userId});}
  documentGenerationRequestKey(kind:"preview"|"generate",sourcePreviewId?:string|null,promptTechnique:PromptTechnique=this.promptTechniquePreference().technique,promptFanId?:string|null){return generationRequestKeyFor(kind,this.documentGenerationRevision(),sourcePreviewId,promptTechnique,promptFanId);}
  generationReadinessRequestKey(kind:GenerationReadinessKind,sourcePreviewId?:string|null,promptTechnique:PromptTechnique=this.promptTechniquePreference().technique,productionMode:ProductionMode="manual"){const revision=this.documentGenerationRevision();const base=kind==="preview"?generationRequestKeyFor("preview",revision,null,promptTechnique):kind==="generate"?generationRequestKeyFor("generate",revision,sourcePreviewId,promptTechnique):`prompt-fan:${kind==="preview_fan"?"preview":"generate"}:${revision}:${sourcePreviewId||"document"}`;return productionMode==="managed"?`${base}:managed`:base;}
  productionWorkflowGenerationRequestKey(workflowId:string,workflowStageId:string,workflowSources:ProductionWorkflowSource[],options:{sourcePreviewId?:string|null;promptTechnique?:PromptTechnique;productionMode?:ProductionMode}={}){const standard=this.generationReadinessRequestKey("generate",options.sourcePreviewId,options.promptTechnique??this.promptTechniquePreference().technique,options.productionMode??"manual");return`${standard}:workflow:${generationRevisionFor({workflowId,workflowStageId,sources:productionWorkflowSourceIdentity(workflowSources)})}`;}
  characterGenerationRequestKey(rootBlockId:string,kind:"headshot"|"character_sheet"="headshot"){const context=this.#generationContext(this.projection.get().documentId,rootBlockId,kind);return`${generationRequestKeyFor("generate",context.documentRevision,null,this.promptTechniquePreference().technique)}:character:${rootBlockId}:${kind}`;}
  generationReadinessFor(kind:GenerationReadinessKind,sourcePreviewId?:string|null,promptTechnique:PromptTechnique=this.promptTechniquePreference().technique,productionMode:ProductionMode="manual"){return this.generationReadiness.get()[this.generationReadinessRequestKey(kind,sourcePreviewId,promptTechnique,productionMode)]??null;}
  generationRiskAcknowledged(requestKey:string){return this.#readinessAcknowledgements.has(requestKey);}
  acknowledgeGenerationRisk(requestKey:string){this.#readinessAcknowledgements.add(requestKey);this.notify();}
  async ensureGenerationReadiness(kind:GenerationReadinessKind,options:{sourcePreviewId?:string|null;promptTechnique?:PromptTechnique;productionMode?:ProductionMode;sourceSurface?:string;force?:boolean;requestKey?:string;workflowId?:string;workflowStageId?:string;workflowSources?:ProductionWorkflowSource[];contextRootBlockId?:string;characterOutputKind?:"headshot"|"character_sheet"}={}){const authorization=this.#activeAuthorizationScope();const technique=normalizePromptTechnique(options.promptTechnique??this.promptTechniquePreference().technique);const productionMode=options.productionMode??"manual";const context=this.#generationContext(this.projection.get().documentId,options.contextRootBlockId,options.characterOutputKind);const requestKey=options.requestKey??this.generationReadinessRequestKey(kind,options.sourcePreviewId,technique,productionMode);if(this.#readinessInFlight.has(requestKey))return this.generationReadiness.get()[requestKey]??null;const existing=this.generationReadiness.get()[requestKey];if(existing&&!options.force&&Date.parse(existing.expiresAt)>Date.now())return existing;this.#readinessInFlight.add(requestKey);this.generationReadiness.set({...this.generationReadiness.get(),[requestKey]:existing?{...existing,status:"checking",summary:"Checking current generation readiness…"}:{preflightId:"",requestKey,documentId:context.documentId,documentRevision:context.documentRevision,kind,productionMode,promptTechnique:technique,status:"checking",summary:"Checking current generation readiness…",probes:[],provider:{status:"unknown",scope:"unknown",message:"Checking provider status.",observedAt:new Date().toISOString(),expiresAt:new Date().toISOString(),retryAfterMs:null,requestId:null},estimatedTokens:0,estimatedCostMicrousd:0,estimatedSeconds:0,requiresAcknowledgement:false,checkedAt:new Date().toISOString(),expiresAt:new Date().toISOString(),cached:false,version:"pending"}});this.notify();try{const response=await fetch("/api/generation-readiness",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...context,kind,requestKey,productionMode,sourcePreviewId:options.sourcePreviewId??null,promptTechnique:technique,sourceSurface:options.sourceSurface??"generation-controls",force:Boolean(options.force),...(options.contextRootBlockId?{contextRootBlockId:options.contextRootBlockId,characterOutputKind:options.characterOutputKind??"headshot"}:{}),...(options.workflowId&&options.workflowStageId?{workflowId:options.workflowId,workflowStageId:options.workflowStageId,workflowSources:options.workflowSources??[]}:{})})});this.#assertAuthorizationScope(authorization);const body=await response.json() as {readiness?:GenerationReadiness;error?:string;message?:string};this.#assertAuthorizationScope(authorization);if(!response.ok||!body.readiness)throw new Error(body.message??body.error??"Generation readiness could not be checked");this.generationReadiness.set({...this.generationReadiness.get(),[requestKey]:body.readiness});if(body.readiness.status!=="review")this.#readinessAcknowledgements.delete(requestKey);this.notify();return body.readiness;}catch(error){if(!this.#scopeStillActive(authorization))return null;const failed={...(this.generationReadiness.get()[requestKey]??existing!),status:"unknown" as const,summary:error instanceof Error?error.message:"Generation readiness could not be checked",expiresAt:new Date(Date.now()+30_000).toISOString()};this.generationReadiness.set({...this.generationReadiness.get(),[requestKey]:failed});this.notify();return failed;}finally{if(this.#scopeStillActive(authorization))this.#readinessInFlight.delete(requestKey);}}
  async refreshGenerationProviderStatus(){const authorization=this.#activeAuthorizationScope();try{const response=await this.guardedFetch("/api/generation-readiness/provider/refresh",{method:"POST"},"refresh provider readiness");this.#assertAuthorizationScope(authorization);const body=await response.json() as {error?:string};this.#assertAuthorizationScope(authorization);if(!response.ok)throw new Error(body.error??"Provider status could not be refreshed");this.generationReadiness.set({});this.#readinessAcknowledgements.clear();this.toast("Provider status cleared. Rechecking the current document…");this.notify();return true;}catch(error){if(this.#scopeStillActive(authorization))this.toast(error instanceof Error?error.message:"Provider status could not be refreshed");return false;}}
  async comparePromptTechniqueSafety(job:DocumentJob,failedTechnique:PromptTechnique=job.promptTechnique,failedPrompt=""){
    const authorization=this.#activeAuthorizationScope(),context=this.#generationContext(job.documentId);
    const kind=job.kind==="prompt_fan"?job.fanKind??"generate":job.kind==="preview"?"preview":"generate";
    const response=await this.guardedFetch("/api/generation-readiness/prompt-techniques",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...context,kind,productionMode:job.productionMode??"manual",sourcePreviewId:job.sourcePreviewId,failedTechnique:normalizePromptTechnique(failedTechnique),failedPrompt,sourceSurface:job.sourceSurface||"generation-failure"})},"run a moderation-only prompt comparison");
    this.#assertAuthorizationScope(authorization);
    const body=await response.json() as {comparison?:PromptTechniqueSafetyComparison;error?:string;message?:string};
    this.#assertAuthorizationScope(authorization);
    if(!response.ok||!body.comparison)throw new Error(body.message??body.error??"Prompt structures could not be compared");
    await this.#refreshEvents();
    this.#assertAuthorizationScope(authorization);
    return body.comparison;
  }
  documentGenerationJobs(documentId=this.projection.get().documentId){return this.documentJobs.get().filter((job)=>job.documentId===documentId&&(job.kind==="prompt_fan"||(job.kind==="preview"||job.kind==="generate")&&!job.parentJobId)&&(job.status==="queued"||job.status==="running"||job.status==="committing")).sort((a,b)=>a.requestedAt.localeCompare(b.requestedAt)||a.jobId.localeCompare(b.jobId));}
  documentRenderJobs(documentId=this.projection.get().documentId){return this.documentJobs.get().filter((job)=>job.documentId===documentId&&job.kind==="render_document"&&(job.status==="queued"||job.status==="running"||job.status==="committing")).sort((a,b)=>a.requestedAt.localeCompare(b.requestedAt)||a.jobId.localeCompare(b.jobId));}
  documentJobForRequest(kind:"preview"|"generate",requestKey:string,documentId=this.projection.get().documentId){return this.documentGenerationJobs(documentId).find((job)=>job.kind===kind&&job.requestKey===requestKey);}
  documentJobStarting(requestKey:string){return this.#jobStarts.has(requestKey);}
  documentJobActive(kind?:DocumentJobKind,documentId=this.projection.get().documentId,canvasId?:string|null){return this.documentJobs.get().some((job)=>job.documentId===documentId&&(canvasId===undefined||(job.canvasId??null)===canvasId)&&(!kind||job.kind===kind||job.kind==="prompt_fan"&&job.fanKind===kind)&&(job.status==="queued"||job.status==="running"||job.status==="committing"));}
  setCanvasPlanningSelection(itemIds:readonly string[]){const canvas=this.canvasProjection.get(),scope=this.captureAuthorizationScope()?.key??"",next={scope,canvasId:canvas.selectedCanvasId,itemIds:[...itemIds].sort()};if(JSON.stringify(next)!==JSON.stringify(this.canvasPlanningSelection.get()))this.canvasPlanningSelection.set(next);}
  chooseCanvasPlanningDocument(documentId:string){const canvas=this.canvasProjection.get(),projection=this.projection.get(),scope=this.captureAuthorizationScope()?.key;if(!scope||!canvas.selectedCanvasId||!projection.documents.some((item)=>item.id===documentId&&item.projectId===canvas.projectId))return false;this.canvasPlanningChoices.set({...this.canvasPlanningChoices.get(),[`${scope}:${canvas.selectedCanvasId}`]:documentId});return true;}
  canvasPlanningDocumentId(selectedIds?:readonly string[]){const canvas=this.canvasProjection.get(),scope=this.captureAuthorizationScope()?.key??"",selection=this.canvasPlanningSelection.get();return canvasDocumentTarget(this.projection.get(),canvas,selectedIds??(selection.scope===scope&&selection.canvasId===canvas.selectedCanvasId?selection.itemIds:[]),this.canvasPlanningChoices.get()[`${scope}:${canvas.selectedCanvasId}`]??"");}
  documentPreviewProgress(documentId=this.projection.get().documentId){const job=this.documentJobs.get().find((item)=>item.documentId===documentId&&item.kind==="preview"&&item.status==="running"&&item.result?.partialMediaUrl);if(!job)return null;return{jobId:job.jobId,mediaUrl:String(job.result!.partialMediaUrl),mediaType:String(job.result!.partialMediaType??"image/jpeg"),width:Number(job.result!.partialWidth??816),height:Number(job.result!.partialHeight??816),index:Number(job.result!.partialIndex??0),sourceSurface:job.sourceSurface};}
  adaptiveStructureFor(documentId=this.projection.get().documentId){return this.adaptiveStructures.get()[documentId]??null;}
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
  async #revalidateMissingAdaptivePlans(jobs:DocumentJob[],authorization:string,previous=new Map<string,DocumentJob>()){
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
      if(revision===undefined){this.#clearAdaptivePrivatePresentation(id);return null;}
      const currentRead=()=>this.#planningRecoveryIdentities.get(id)?.revision===revision&&(this.#planningRecoveryIdentities.get(id)?.deliberateReadRevision??0)===deliberateReadRevision&&(this.#planningRecoveryIdentities.get(id)?.withdrawalRevision??0)<=startedAt&&(this.#planningRecoveryIdentities.get(id)?.certifiedReadRevision??0)<=startedAt;
      try{
        const response=await fetch(`/api/document-jobs/${encodeURIComponent(id)}?inspection=1`);
        this.#assertAuthorizationScope(authorization);
        if(!response.ok){if([401,403,404,410].includes(response.status))this.#withdrawAdaptiveRead(id,startedAt);else if(currentRead())this.#clearAdaptivePrivatePresentation(id);return null;}
        const body=await response.json() as {job?:DocumentJob};this.#assertAuthorizationScope(authorization);
        const job=body.job,projection=this.projection.get();
        const matches=Boolean(job&&job.jobId===id&&job.planningExecutionId===id&&job.kind==="structure_adaptive"&&job.documentId===target.documentId&&(job.canvasId??null)===target.canvasId
          &&(target.sourceSurface===undefined||job.sourceSurface===target.sourceSurface)&&(target.requestKey===undefined||job.requestKey===target.requestKey)
          &&(target.planningProjectScope===undefined||job.planningProjectScope===target.planningProjectScope)&&(target.planningLocale===undefined||job.planningLocale===target.planningLocale)
          &&projection.documents.some(document=>document.id===job.documentId&&document.projectId===projection.projectId));
        const withdrawn=matches&&(job?.result?.planningReviewAvailable===false||job?.result?.resultUnavailable===true);
        if(withdrawn){this.#withdrawAdaptiveRead(id,startedAt);return null;}
        if(!currentRead())return null;
        if(!job||!matches||!(job.status==="completed"&&job.result?.structure)&&job.result?.planningReviewAvailable!==true)throw new Error("planning_result_unavailable");
        const current=this.planningConsent.get(),currentId=current?.recoveryExecutionId??(current?.submitted||current?.quote?.status!=="quoted"?current?.quote?.executionId:undefined);
        const quote=job.result?.quote as AvailableConsequentialPreview|undefined;
        if(quote&&(quote.executionId!==id||quote.projectId!==projection.projectId||quote.documentId!==job.documentId||(quote.canvasId??null)!==(job.canvasId??null)||currentId===id&&current?.quote&&quote.bindingHash!==current.quote.bindingHash))throw new Error("planning_result_identity_changed");
        // A later stop/settlement may arrive without changing the privacy read
        // epoch. Do not republish its older status or financial receipt. A
        // genuinely certified completion and explicit withdrawal stay distinct.
        if(job.status!=="completed"&&(this.#planningRecoveryIdentities.get(id)?.terminalRevision??0)!==terminalRevision)return null;
        this.#rememberPlanningRecovery(job);this.#observeAdaptivePlanningJob(job);this.#jobDetails.set(id,job);
        const certified=this.#planningRecoveryIdentities.get(id);if(certified)certified.detailRevision=certified.revision;
        this.#trimDocumentJobDetails();
        return{job,revision:this.#planningRecoveryIdentities.get(id)?.revision,terminalRevision:this.#planningRecoveryIdentities.get(id)?.terminalRevision??0,deliberateReadRevision};
      }catch{if(this.#scopeStillActive(authorization)&&currentRead())this.#clearAdaptivePrivatePresentation(id);return null;}
    }));
    this.#assertAuthorizationScope(authorization);
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
  async #ackJob(jobId:string){if(!this.#canRequestProjectOutputs())return;try{await fetch(`/api/document-jobs/${encodeURIComponent(jobId)}/ack`,{method:"POST"});}catch{/* A later poll can offer the notice again. */}}
  async #hydrateDocumentJobGenerationReceipt(job:DocumentJob,authorization:string){
    const receipt=job.result?.generationReceipt;this.#assertAuthorizationScope(authorization);
    if(this.session.get()?.projectContext){if(receipt!==undefined&&receipt!==null)throw new Error("Actor-private generation receipts are unavailable in shared project views.");return;}
    if(!receipt||typeof receipt!=="object"||Array.isArray(receipt))return;
    const reference=(receipt as Record<string,unknown>).input_ref;if(typeof reference!=="string"||!reference.trim())return;
    let rejected=false;
    const retained=await this.ensurePrivateContent(reference,{validate:(value)=>{
      try{const parsed=JSON.parse(value) as unknown;const valid=Boolean(parsed&&typeof parsed==="object"&&!Array.isArray(parsed)&&(parsed as Record<string,unknown>).job_id===job.jobId&&(parsed as Record<string,unknown>).document_id===job.documentId);if(!valid)rejected=true;return valid;}catch{rejected=true;return false;}
    }});
    this.#assertAuthorizationScope(authorization);
    if(!retained){if(rejected)throw new Error("The private generation receipt does not belong to this authorized job.");return;}
    let parsed:unknown;try{parsed=JSON.parse(retained);}catch{throw new Error("The private generation receipt could not be verified for this authorized job.");}
    if(!parsed||typeof parsed!=="object"||Array.isArray(parsed)||(parsed as Record<string,unknown>).job_id!==job.jobId||(parsed as Record<string,unknown>).document_id!==job.documentId)throw new Error("The private generation receipt does not belong to this authorized job.");
  }
  loadDocumentJobDetail(jobId:string,options:SceneGenerationReceiptReadOptions):Promise<SceneGenerationReceiptInspection>;
  loadDocumentJobDetail(jobId:string):Promise<DocumentJob>;
  async loadDocumentJobDetail(jobId:string,options?:SceneGenerationReceiptReadOptions):Promise<DocumentJob|SceneGenerationReceiptInspection>{
    if(options)return this.loadActorDocumentGenerationReceipt(jobId,options);
    const authorization=this.#activeAuthorizationScope();
    const current=this.documentJobs.get().find((job)=>job.jobId===jobId);
    const cached=this.#jobDetails.get(jobId);
    if(cached&&cached.kind!=="structure_adaptive"&&cached.updatedAt===current?.updatedAt){if(cached.jobId!==jobId||cached.documentId!==current.documentId)throw new Error("The retained generation inputs do not belong to this authorized job.");await this.#hydrateDocumentJobGenerationReceipt(cached,authorization);return cached;}
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
      this.#assertAuthorizationScope(authorization);
      // Access/retention denial is already authoritative in the headers. A
      // broken or empty error body must not preserve private presentation.
      if(adaptive&&!response.ok&&[401,403,404,410].includes(response.status)){
        this.#withdrawAdaptiveRead(jobId,startedAt);
        throw new Error("planning_result_unavailable");
      }
      const body=await response.json() as {job?:DocumentJob;error?:string};
      this.#assertAuthorizationScope(authorization);
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
      this.#assertAuthorizationScope(authorization);
      if(!currentRead()||signed&&!adaptive&&(this.#planningRecoveryIdentities.get(jobId)?.revision??0)>startedAt)throw new Error("planning_result_unavailable");
      if(signed){
        if(job.result?.planningReviewAvailable===false||job.result?.resultUnavailable===true){this.#observeAdaptivePlanningJob(job);throw new Error("planning_result_unavailable");}
        if(!(job.status==="completed"&&job.result?.structure)&&job.result?.planningReviewAvailable!==true)throw new Error("planning_result_unavailable");
        if(job.status!=="completed"&&(this.#planningRecoveryIdentities.get(jobId)?.terminalRevision??0)!==terminalRevision)throw new Error("planning_result_superseded");
        this.#observeAdaptivePlanningJob(job);
      }
      this.#jobDetails.set(jobId,job);
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
        this.#assertAuthorizationScope(authorization);
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
    this.#assertAuthorizationScope(authorization);
    if(!this.session.get()?.projectContext||!response.ok||!body.job)throw new Error(body.error??"The actor-private generation receipt could not be loaded.");
    if(body.job.jobId!==jobId||body.job.documentId!==current.documentId)throw new Error("The retained generation inputs do not belong to this authorized job.");
    const receipt=body.job.result?.generationReceipt;
    const reference=receipt&&typeof receipt==="object"&&!Array.isArray(receipt)?(receipt as Record<string,unknown>).input_ref:null;
    if(typeof reference!=="string"||!reference.trim()||!body.content||Object.keys(body.content).length!==1||typeof body.content[reference]!=="string")throw new Error("The actor-private generation receipt could not be verified.");
    let retained:unknown;try{retained=JSON.parse(body.content[reference]);}catch{throw new Error("The actor-private generation receipt could not be verified.");}
    if(!retained||typeof retained!=="object"||Array.isArray(retained)||(retained as Record<string,unknown>).job_id!==jobId||(retained as Record<string,unknown>).document_id!==current.documentId)throw new Error("The private generation receipt does not belong to this authorized job.");
    this.#assertAuthorizationScope(authorization);
    return{job:body.job,content:{[reference]:body.content[reference]}};
  }
  /** Issue-note bodies remain actor-private and never enter shared job or content caches. */
  async loadActivityIssueNotes(jobId:string):Promise<ActivityIssueNote[]>{
    const authorization=this.#activeAuthorizationScope();
    const current=this.documentJobs.get().find((job)=>job.jobId===jobId);
    if(!current)throw new Error("The issue notes do not belong to this authorized job.");
    const response=await fetch(`/api/document-jobs/${encodeURIComponent(jobId)}/notes`);
    const body=await response.json() as {jobId?:string;documentId?:string;notes?:ActivityIssueNote[];error?:string};
    this.#assertAuthorizationScope(authorization);
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
    const authorization=this.#activeAuthorizationScope();
    if(!documentId||this.projection.get().documentId!==documentId)throw new Error("The preserved presentation drafts do not belong to this authorized document.");
    const response=await fetch(`/api/document-jobs/presentation-candidates?document=${encodeURIComponent(documentId)}`);
    this.#assertAuthorizationScope(authorization);
    const body=await response.json() as Partial<PreservedPresentationCandidateJobs>&{error?:string};
    this.#assertAuthorizationScope(authorization);
    if(!response.ok||body.documentId!==documentId||!Array.isArray(body.jobs))throw new Error(body.error??"The preserved presentation drafts could not be verified.");
    if(body.jobs.some((listing)=>!listing.jobId||listing.documentId!==documentId||!Array.isArray(listing.candidates)
      ||listing.candidates.some((candidate)=>candidate.jobId!==listing.jobId||candidate.documentId!==documentId||candidate.retentionClass!=="governed-evidence")))throw new Error("A preserved presentation draft does not belong to this authorized document.");
    this.#assertPresentationCandidatePayload(body);
    return body as PreservedPresentationCandidateJobs;
  }
  async loadPresentationCandidates(jobId:string,documentId?:string):Promise<PresentationCandidateList>{
    const authorization=this.#activeAuthorizationScope();
    const current=this.documentJobs.get().find((job)=>job.jobId===jobId);
    const authorizedDocument=current?.documentId??documentId;
    if(!authorizedDocument||documentId&&authorizedDocument!==documentId||!current&&authorizedDocument!==this.projection.get().documentId)throw new Error("The private presentation drafts do not belong to this authorized document.");
    const response=await fetch(`/api/document-jobs/${encodeURIComponent(jobId)}/presentation-candidates`);
    this.#assertAuthorizationScope(authorization);
    const body=await response.json() as Partial<PresentationCandidateList>&{error?:string};
    this.#assertAuthorizationScope(authorization);
    if(!response.ok||body.jobId!==jobId||body.documentId!==authorizedDocument||!Array.isArray(body.candidates))throw new Error(body.error??"The private presentation drafts could not be verified.");
    if(body.candidates.some((candidate)=>candidate.jobId!==jobId||candidate.documentId!==authorizedDocument))throw new Error("A private presentation draft does not belong to this authorized document.");
    this.#assertPresentationCandidatePayload(body);
    return body as PresentationCandidateList;
  }
  async loadPresentationCandidate(jobId:string,responseId:string,documentId?:string):Promise<PresentationCandidateDetail>{
    const authorization=this.#activeAuthorizationScope();
    const current=this.documentJobs.get().find((job)=>job.jobId===jobId);
    const authorizedDocument=current?.documentId??documentId;
    if(!authorizedDocument||!responseId||documentId&&authorizedDocument!==documentId||!current&&authorizedDocument!==this.projection.get().documentId)throw new Error("The private presentation draft does not belong to this authorized document.");
    const response=await fetch(`/api/document-jobs/${encodeURIComponent(jobId)}/presentation-candidates/${encodeURIComponent(responseId)}`);
    this.#assertAuthorizationScope(authorization);
    const body=await response.json() as {jobId?:string;documentId?:string;candidate?:PresentationCandidateDetail;error?:string};
    this.#assertAuthorizationScope(authorization);
    if(!response.ok||body.jobId!==jobId||body.documentId!==authorizedDocument||!body.candidate||body.candidate.jobId!==jobId||body.candidate.documentId!==authorizedDocument||body.candidate.responseId!==responseId)throw new Error(body.error??"The private presentation draft could not be verified.");
    this.#assertPresentationCandidatePayload(body);
    return body.candidate;
  }
  async preservePresentationCandidate(jobId:string,responseId:string,documentId?:string):Promise<PresentationCandidateSummary>{
    const authorization=this.#activeAuthorizationScope();
    const current=this.documentJobs.get().find((job)=>job.jobId===jobId);
    const authorizedDocument=current?.documentId??documentId;
    if(!authorizedDocument||!responseId||documentId&&authorizedDocument!==documentId||!current&&authorizedDocument!==this.projection.get().documentId)throw new Error("The private presentation draft does not belong to this authorized document.");
    const response=await this.guardedFetch(`/api/document-jobs/${encodeURIComponent(jobId)}/presentation-candidates/${encodeURIComponent(responseId)}/preserve`,{method:"POST"},"preserve this actor-private presentation draft");
    this.#assertAuthorizationScope(authorization);
    const body=await response.json() as {jobId?:string;documentId?:string;candidate?:PresentationCandidateSummary;error?:string};
    this.#assertAuthorizationScope(authorization);
    if(!response.ok||body.jobId!==jobId||body.documentId!==authorizedDocument||!body.candidate||body.candidate.jobId!==jobId||body.candidate.documentId!==authorizedDocument||body.candidate.responseId!==responseId||body.candidate.retentionClass!=="governed-evidence")throw new Error(body.error??"The private presentation draft could not be safely preserved.");
    this.#assertPresentationCandidatePayload(body);
    return body.candidate;
  }
  #assertPresentationCandidatePayload(value:unknown){
    if(Array.isArray(value)){for(const entry of value)this.#assertPresentationCandidatePayload(entry);return;}
    if(!value||typeof value!=="object")return;
    for(const[key,entry]of Object.entries(value)){
      if(/^(?:raw|candidateRaw|output_text|contentRef|content_ref|source(?:Snapshot|Alias|Id)|source_id|source_ids|compiledSnapshot|image_prompt|providerInput|content_markdown|context_group_ids)$/iu.test(key))throw new Error("The private presentation draft contains disallowed source or provider data.");
      this.#assertPresentationCandidatePayload(entry);
    }
  }
  async dismissDocumentJobFailure(jobId:string){const authorization=this.#activeAuthorizationScope();try{const response=await this.guardedFetch(`/api/document-jobs/${encodeURIComponent(jobId)}/dismiss`,{method:"POST"},"dismiss this generation issue");this.#assertAuthorizationScope(authorization);const body=await response.json() as {job?:DocumentJob;error?:string};this.#assertAuthorizationScope(authorization);if(!response.ok||!body.job)throw new Error(body.error??"Generation issue could not be dismissed");this.documentJobs.set(this.documentJobs.get().map((job)=>job.jobId===jobId?body.job!:job));this.toast(this.session.get()?.projectContext?"Generation notice dismissed. Failure details remain available; generation inputs stay private to their author.":"Generation notice dismissed. Its retained inputs remain in this document’s failure history.");this.notify();return true;}catch(error){if(this.#scopeStillActive(authorization))this.toast(error instanceof Error?error.message:"Generation issue could not be dismissed");return false;}}
  async reconcileDocumentProviderReceipt(jobId:string){
    const authorization=this.#activeAuthorizationScope();
    try{
      const session=this.session.get();
      const original=this.documentJobs.get().find((job)=>job.jobId===jobId);
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
      this.#jobDetails.delete(jobId);
      this.documentJobs.set(this.documentJobs.get().map((job)=>job.jobId===jobId?body.job!:job));
      this.toast(this.#systemNotice("Paid once · replay without another provider call"));
      this.notify();
      return true;
    }catch(error){if(this.#scopeStillActive(authorization))this.toast(error instanceof Error?error.message:"The saved provider render could not be recovered");return false;}
  }
  async recoverDocumentRender(jobId:string){const authorization=this.#activeAuthorizationScope();try{const original=this.documentJobs.get().find((job)=>job.jobId===jobId);const response=await this.guardedFetch(`/api/document-jobs/${encodeURIComponent(jobId)}/retry`,{method:"POST"},"recover this completed provider render");this.#assertAuthorizationScope(authorization);const body=await response.json() as {job?:DocumentJob;error?:string;reason?:string};this.#assertAuthorizationScope(authorization);if(!response.ok||!body.job){const reason=typeof body.reason==="string"&&/^[a-z0-9_]{1,120}$/u.test(body.reason)?` (${body.reason})`:"";throw new Error((body.error??"The saved provider render could not be recovered")+reason);}this.documentJobs.set([body.job,...this.documentJobs.get().filter((job)=>job.jobId!==jobId)]);const medium=original?.result?.artifactKind==="storyboard"?"Storyboard":original?.result?.artifactKind==="audio"?"Audio":"Video";this.toast(medium==="Video"?"Recovering the saved Fal video. No second paid video was submitted.":[this.#systemNotice(medium),this.#systemNotice("Paid once · replay without another provider call")].join(" · "));this.notify();this.#driveDocumentJobs(this.documentJobs.get());this.#scheduleJobPoll(800);return true;}catch(error){if(this.#scopeStillActive(authorization))this.toast(error instanceof Error?error.message:"The saved provider render could not be recovered");return false;}}
  async recoverDocumentPresentation(jobId:string){
    const authorization=this.#activeAuthorizationScope();
    const original=this.documentJobs.get().find((job)=>job.jobId===jobId);
    try{
      if(!original||!documentJobCanRecoverPresentation(original))throw new Error("The saved presentation response could not be recovered");
      const response=await this.guardedFetch(`/api/document-jobs/${encodeURIComponent(jobId)}/recover`,{method:"POST"},"recover this saved presentation without another provider request");
      this.#assertAuthorizationScope(authorization);
      const body=await response.json() as {job?:DocumentJob;error?:string;reason?:string};
      this.#assertAuthorizationScope(authorization);
      if(!response.ok||!body.job)throw new Error(body.reason&&body.error?`${body.error}: ${body.reason}`:body.error??"The saved presentation response could not be recovered");
      if(body.job.jobId!==jobId||body.job.documentId!==original.documentId)throw new Error("The saved presentation response does not belong to this authorized document");
      this.#jobDetails.delete(jobId);
      this.documentJobs.set([body.job,...this.documentJobs.get().filter((job)=>job.jobId!==jobId)]);
      await this.#refreshEvents();
      this.#assertAuthorizationScope(authorization);
      this.toast("Paid once · replay without another provider call");
      this.notify();
      return true;
    }catch(error){if(this.#scopeStillActive(authorization))this.toast(error instanceof Error?error.message:"The saved provider render could not be recovered");return false;}
  }
  async stopDocumentJob(jobId:string,force=false){
    const authorization=this.#activeAuthorizationScope();
    try{
      const response=await this.guardedFetch(`/api/document-jobs/${encodeURIComponent(jobId)}/${force?"force-fail":"cancel"}`,{method:"POST"},force?"force-fail this document operation":"stop this document operation");
      this.#assertAuthorizationScope(authorization);
      const body=await response.json() as {job?:DocumentJob;budget?:DocumentJobStopBudget;stoppedCount?:number;error?:string};
      this.#assertAuthorizationScope(authorization);
      if(!response.ok||!body.job){
        const messages:Record<string,string>={job_finalizing:"This operation is already finalizing and can no longer be stopped.",provider_submission_in_flight:"The provider request is being submitted. Wait until its receipt is confirmed before stopping this generation.",admin_required:"Only an administrator can force-fail an operation."};
        throw new Error(messages[body.error??""]??body.error??"The operation could not be stopped");
      }
      this.documentJobs.set(this.documentJobs.get().map((job)=>job.jobId===jobId?body.job!:job));
      const outcome=body.job.status==="completed"||body.job.status==="partial"||body.stoppedCount===0&&documentJobTerminal(body.job)?"Operation already finished.":body.job.status==="canceled"?"Operation stopped.":body.job.status==="failed"?(force?"Operation force-failed.":"Operation stopped."):"The stop is not yet confirmed.";
      this.toast(this.#systemNotice(outcome)+" "+this.#systemNotice(documentJobStopBudgetMessage(body.budget)));
      await Promise.all([this.syncDocumentJobs(),this.refreshSession()]);this.#assertAuthorizationScope(authorization);
      return documentJobTerminal(body.job);
    }catch(error){if(this.#scopeStillActive(authorization))this.toast(error instanceof Error?error.message:"The operation could not be stopped");return false;}
  }
  #flushPendingJobNotices(){
    if(document.visibilityState!=="visible"||!this.#pendingJobNotices.length)return;
    const jobs=this.#pendingJobNotices.splice(0),locale=currentFormaLocale(),source="{count} background document operations finished.";
    const combined=(locale.messages[formaSystemMessageId(source)]??source).replace("{count}",new Intl.NumberFormat(locale.formatLocale).format(jobs.length));
    this.toast(jobs.length===1?this.#jobNotice(jobs[0]):combined);
    for(const job of jobs)if(!job.canvasId||this.#jobResultVisible(job))void this.#ackJob(job.jobId);
  }
  async #readEventPages(after=0){return this.#readEventStream(after,"full",after===0);}
  async replayAuthoritativeHistory(sequence:number){const authorization=this.#activeAuthorizationScope(),complete=await this.#readEventStream(0,"full",false);this.#assertAuthorizationScope(authorization);this.replayEvents.set(complete.events);this.setReplayAsOf(sequence);}
  async #readEventStream(after:number,profile:AccountSnapshotProfile,includeContent=false){
    const authorization=this.#activeAuthorizationScope();
    this.#assertAuthorizationScope(authorization);
    let cursor=Math.max(0,after),head=cursor,first=true,initialHead=Number.POSITIVE_INFINITY;
    const events:CreativeEvent[]=[];let content:Record<string,string>={};
    for(let page=0;page<500;page+=1){
      const limit=profile==="full"?5000:6500;
      const selection=profile==="full"?"":`&profile=${profile}`;
      const response=await fetch(`/api/events?after=${cursor}&limit=${limit}&content=${first&&includeContent?1:0}${selection}`);
      this.#assertAuthorizationScope(authorization);
      if(!response.ok)throw new Error(`Event stream returned ${response.status}`);
      const body=await response.json() as {events?:CreativeEvent[];content?:Record<string,string>;head?:number;nextAfter?:number;hasMore?:boolean};
      this.#assertAuthorizationScope(authorization);
      const responseHead=Math.max(0,Number(body.head??head));
      head=first?responseHead:Math.max(head,responseHead);
      if(first)initialHead=head;
      const received=(body.events??[]).filter((event)=>event.sequence<=initialHead);events.push(...received);recordEventPage(received.length);
      if(body.content)content={...content,...body.content};
      const next=Math.min(initialHead,Math.max(cursor,Number(body.nextAfter??received.at(-1)?.sequence??cursor)));
      const hasMore=(body.hasMore??next<head)&&next<initialHead;
      if(hasMore&&next<=cursor)throw new Error("Event stream pagination did not advance");
      cursor=next;first=false;
      if(!hasMore){
        if(profile==="full"&&after>0&&events.some((event)=>event.type==="DocumentArtifactEdited"||event.type==="AssistantReasoned"&&event.payload.operation==="creative-chat"&&event.payload.deterministic===false&&Boolean(event.payload.task_id)||Object.entries(event.payload).some(([key,value])=>/(?:^|_)(?:content|prompt|intent|input|response|message|statement|condition|note|output|direction)_ref$/.test(key)&&typeof value==="string"&&!this.content.get()[value]))){
          const hydration=await fetch(`/api/events?after=${head}&limit=1&content=1`);
          this.#assertAuthorizationScope(authorization);
          if(hydration.ok){const hydrated=await hydration.json() as {content?:Record<string,string>};this.#assertAuthorizationScope(authorization);content={...content,...(hydrated.content??{})};}
        }
        this.#assertAuthorizationScope(authorization);
        return{events,content,head:Math.min(head,initialHead)};
      }
    }
    throw new Error("Event stream exceeded the supported pagination window");
  }

  #profileForRoute(path:string):AccountSnapshotProfile{
    return routeCapabilities(path).profile;
  }

  routeDataReady(path=this.route.get()){
    return eventProfileRank(this.#historyProfile)>=eventProfileRank(this.#profileForRoute(path));
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

  async outputRequirementCommand(command: OutputRequirementCommand) {
    const authorization = this.captureAuthorizationScope();
    const result = await this.outputRequirements.command<OutputCommandResponse>(command.documentId, command, "update Output requirements");
    if ((result.status === "saved" || result.status === "conflict") && this.authorizationScopeActive(authorization)) {
      if (result.status === "saved") {
        try { await this.refreshEvents(); }
        catch { /* The mutation receipt is already committed. Hydration must not turn it into a retry. */ }
      }
      if (this.authorizationScopeActive(authorization)) await this.outputRequirements.ensure(command.documentId, { force: true });
    }
    if (!this.authorizationScopeActive(authorization)) return { status: "forbidden" as const, body: null, error: "The active workspace changed. The previous result was discarded." };
    if (this.outputRequirements.resource(command.documentId).accessLost || this.outputRequirements.resource(command.documentId).privateUnavailable) return this.outputRequirements.withholdCommandBody(command.documentId, result, { clientMutationId: command.clientMutationId, action: command.action });
    return result;
  }

  async uploadOutputAsset(documentId: string, file: File, expectedRevision: string, clientMutationId: string, rightsConfirmed: boolean) {
    if (!rightsConfirmed) return { status: "invalid" as const, body: null, error: "Confirm that you own or have permission to use this file." };
    const authorization = this.captureAuthorizationScope();
    const result = await this.outputRequirements.upload<OutputCommandResponse>(documentId, file, {
      "content-type": "application/octet-stream",
      "x-output-filename": encodeURIComponent(file.name),
      "x-output-expected-revision": expectedRevision,
      "x-output-client-mutation-id": clientMutationId,
      "x-output-rights-confirmed": "true",
    });
    if ((result.status === "saved" || result.status === "conflict") && this.authorizationScopeActive(authorization)) {
      if (result.status === "saved") {
        try { await this.refreshEvents(); }
        catch { /* Keep the committed upload receipt; recover the view without uploading a second file. */ }
      }
      if (this.authorizationScopeActive(authorization)) await this.outputRequirements.ensure(documentId, { force: true });
    }
    if (!this.authorizationScopeActive(authorization)) return { status: "forbidden" as const, body: null, error: "The active workspace changed. The previous result was discarded." };
    if (this.outputRequirements.resource(documentId).accessLost || this.outputRequirements.resource(documentId).privateUnavailable) return this.outputRequirements.withholdCommandBody(documentId, result, { clientMutationId, action: "adopt" });
    return result;
  }

  async #upgradeHistory(profile:AccountSnapshotProfile){
    const authorization=this.#activeAuthorizationScope();
    if(eventProfileRank(this.#historyProfile)>=eventProfileRank(profile))return;
    if(this.#historyUpgrade){await this.#historyUpgrade;this.#assertAuthorizationScope(authorization);if(eventProfileRank(this.#historyProfile)>=eventProfileRank(profile))return;}
    const upgrade=(async()=>{
      const incoming=await this.#readEventStream(0,profile,profile==="full"&&routeCapabilities(this.route.get()).privateContent);
      this.#assertAuthorizationScope(authorization);
      const merged=new Map(incoming.events.map((event)=>[event.eventId,event]));
      for(const event of this.events.get())merged.set(event.eventId,event);
      this.events.set([...merged.values()].sort((left,right)=>left.sequence-right.sequence||left.eventId.localeCompare(right.eventId)));
      if(Object.keys(incoming.content).length)this.content.set({...this.content.get(),...incoming.content});
      this.head.set(Math.max(this.head.get(),incoming.head));
      this.#historyProfile=profile;
      recordRouteHistoryProfile(profile);
      if(profile!=="projects")completeBackgroundHydration(this.events.get().length,profile);
      this.notify();
      const session=this.session.get();if(session)void writeAccountSnapshot(this.#snapshotIdentity(session),this.events.get(),this.head.get(),profile);
    })();
    this.#historyUpgrade=upgrade;
    try{await upgrade;}finally{if(this.#historyUpgrade===upgrade)this.#historyUpgrade=undefined;}
  }

  async #hydrateVisiblePrivateContent():Promise<void>{
    const required: "chat"|"memory"|"all"=routeCapabilities(this.route.get()).profile==="memory"?"memory":documentViewFromRoute(this.route.get())==="chat"?"chat":"all";
    if(this.#privateContentScope==="all"||this.#privateContentScope===required){recordPrivateContentState("ready",required);return;}
    const hydrationPath=this.route.get().split(/[?#]/)[0]?.replace(/\/+$/,"")||"/";
    const initialSession=this.session.get(),owner=initialSession?.user.userId,authorization=initialSession?this.#authorizationScope(initialSession):"";
    if(this.#contentHydration){try{await this.#contentHydration;if(String(this.#privateContentScope)!=="all"&&String(this.#privateContentScope)!==required)return this.#hydrateVisiblePrivateContent();if((this.route.get().split(/[?#]/)[0]?.replace(/\/+$/,"")||"/")===hydrationPath)recordPrivateContentState("ready",required);}catch(error){if((this.route.get().split(/[?#]/)[0]?.replace(/\/+$/,"")||"/")===hydrationPath)recordPrivateContentState("unavailable",required);throw error;}return;}
    recordPrivateContentState("pending",required);
    const hydration=(async()=>{
      const response=await fetch(`/api/events?after=${this.head.get()}&limit=1&content=1${required!=="all"?`&contentScope=${required}`:""}`);
      if(!response.ok)throw new Error(`Private content returned ${response.status}`);
      const body=await response.json() as {content?:Record<string,string>};
      const currentSession=this.session.get();
      if(!owner||!currentSession||currentSession.user.userId!==owner||this.#authorizationScope(currentSession)!==authorization)throw new Error("Private content no longer belongs to the active account or project");
      this.#privateContentScope=required;
      if(Object.keys(body.content??{}).length){this.content.set({...this.content.get(),...body.content});this.notify();}
    })();
    this.#contentHydration=hydration;
    let state:"ready"|"unavailable"="unavailable";
    try{await hydration;state="ready";}finally{if((this.route.get().split(/[?#]/)[0]?.replace(/\/+$/,"")||"/")===hydrationPath)recordPrivateContentState(state,required);if(this.#contentHydration===hydration)this.#contentHydration=undefined;}
  }

  async ensurePrivateContent(reference:string,options:{force?:boolean;validate?:(value:string)=>boolean}={}){
    if(!reference)return null;
    const initialSession=this.session.get(),owner=initialSession?.user.userId,authorization=initialSession?this.#authorizationScope(initialSession):"";if(!owner)return null;
    const existing=this.content.get()[reference];if(typeof existing==="string"&&!options.force&&(!options.validate||options.validate(existing)))return existing;
    if(this.#contentHydration){try{await this.#contentHydration;}catch{/* A targeted retry below preserves the exact missing-reference contract. */}const active=this.session.get();if(!active||this.#authorizationScope(active)!==authorization)return null;const hydrated=this.content.get()[reference];if(typeof hydrated==="string"&&!options.force&&(!options.validate||options.validate(hydrated)))return hydrated;}
    try{const response=await fetch(`/api/events?after=${this.head.get()}&limit=1&content=1`);if(!response.ok)return null;const body=await response.json() as {content?:Record<string,string>};const active=this.session.get();if(!active||active.user.userId!==owner||this.#authorizationScope(active)!==authorization)return null;const requested=body.content?.[reference];if(options.validate&&(typeof requested!=="string"||!options.validate(requested)))return null;this.#privateContentScope="all";if(Object.keys(body.content??{}).length){this.content.set({...this.content.get(),...body.content});this.notify();}return this.content.get()[reference]??null;}catch{return null;}
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
    const existing=new Set(this.optimisticEvents.get().map((event)=>String(event.payload.client_event_id??"")));const now=new Date().toISOString();let index=this.optimisticEvents.get().length;
    const staged:CreativeEvent[]=events.filter((event)=>!existing.has(String(event.payload.client_event_id??""))).map((event)=>{const clientEventId=String(event.payload.client_event_id??crypto.randomUUID());return{eventId:`optimistic:${clientEventId}`,streamId:"optimistic:canvas",sequence:this.head.get()+(++index),occurredAt:now,recordedAt:now,actor:"user",clientId:"web:canvas-optimistic",correlationId:String(event.payload.history_action_id??clientEventId),causationId:null,compensatesEventId:event.compensatesEventId??null,schemaVersion:1,type:event.type,payload:{...event.payload,client_event_id:clientEventId}};});
    if(staged.length){this.optimisticEvents.set([...this.optimisticEvents.get(),...staged]);this.notify();}return staged;
  }
  discardOptimisticCanvasEvents(clientEventIds:Iterable<string>){const ids=new Set(clientEventIds);if(!ids.size)return;this.optimisticEvents.set(this.optimisticEvents.get().filter((event)=>!ids.has(String(event.payload.client_event_id??""))));this.notify();}
  async syncCanvasBatch(events:EventInput[],options:{remember?:boolean}={}):Promise<CanvasSyncResult>{
    if(!events.length)return{appended:[],rejected:[],head:this.head.get(),retryable:false,error:""};
    const authorization=this.#activeAuthorizationScope();
    let response:Response;let body:{appended?:CreativeEvent[];rejected?:Array<{index?:number;type?:string;reason:string}>;head?:number;error?:string}={};
    try{response=await this.guardedFetch("/api/events",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"canvas_sync",events,clientId:"web:canvas"})},events.length>1?`apply ${events.length} ordered board changes`:`record ${events[0].type}`);this.#assertAuthorizationScope(authorization);try{body=await response.json() as typeof body;}catch{body={error:`Canvas sync returned HTTP ${response.status} without a readable receipt.`};}this.#assertAuthorizationScope(authorization);}
    catch(error){const message=error instanceof Error?error.message:"The Canvas server could not be reached.";if(this.#scopeStillActive(authorization))this.appendFailure.set(message);return{appended:[],rejected:[],head:this.head.get(),retryable:true,error:message};}
    this.#assertAuthorizationScope(authorization);
    const appended=body.appended??[];if(appended.length)this.#mergeConfirmed(appended,body.head??this.head.get(),options.remember!==false);
    const error=response.ok?"":body.error??`Canvas sync returned HTTP ${response.status}`;const retryable=!response.ok&&(response.status>=500||[408,425,429].includes(response.status)||response.status===409&&body.error==="stale_sequence");
    this.appendFailure.set(error||((body.rejected?.length??0)>0?body.rejected!.map((item)=>item.reason).join("; "):""));this.notify();
    return{appended,rejected:body.rejected??[],head:body.head??this.head.get(),retryable,error};
  }
  async #refreshEvents(){const authorization=this.#activeAuthorizationScope(),previous=this.events.get();const known=new Set(previous.map((event)=>event.eventId));const after=this.#historyProfile==="full"?(previous.at(-1)?.sequence??0):this.head.get();let replace=after===0;let body=await this.#readEventPages(after);this.#assertAuthorizationScope(authorization);if(body.head<after){body=await this.#readEventPages(0);this.#assertAuthorizationScope(authorization);replace=true;this.#historyProfile="full";}if(!replace&&!body.events.length&&body.head===after&&!Object.keys(body.content).length)return false;const complete=replace?body.events:[...previous,...body.events.filter((event)=>!known.has(event.eventId))];this.#assertAuthorizationScope(authorization);this.events.set(complete);const confirmedClientIds=this.#clientEventIds(complete);if(confirmedClientIds.size)this.optimisticEvents.set(this.optimisticEvents.get().filter((event)=>!confirmedClientIds.has(String(event.payload.client_event_id??""))));if(Object.keys(body.content).length)this.content.set({...this.content.get(),...body.content});this.head.set(body.head);this.#publishAppended(complete.filter((event)=>!known.has(event.eventId)));return true;}
  async refreshEvents(){if(await this.#refreshEvents())this.notify();}

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
  #scheduleJobPoll(delay=2_000){window.clearTimeout(this.#jobPollTimer);if(!this.#canReadProjectJobs())return;this.#jobPollTimer=window.setTimeout(()=>{if(document.visibilityState==="visible")void this.syncDocumentJobs();},delay);}
  #syncVisibleJobs(path=this.route.get()){if(path!==this.route.get()||!this.#canReadProjectJobs()){window.clearTimeout(this.#jobPollTimer);this.#pendingPassiveJobPath="";return;}if(routeCapabilities(path).jobHistory||this.documentJobs.get().some((job)=>job.status==="queued"||job.status==="running"||job.status==="committing")){this.#pendingPassiveJobPath="";void this.syncDocumentJobs();return;}window.clearTimeout(this.#jobPollTimer);if(document.documentElement.dataset.formaPhase==="populated"){this.#pendingPassiveJobPath="";this.#scheduleJobPoll(1_200);}else this.#pendingPassiveJobPath=path;}
  #jobScope(path=this.route.get()){const documentId=documentIdFromRoute(path);return documentId?`?document=${encodeURIComponent(documentId)}`:routeCapabilities(path).jobHistory?"":"?scope=active";}
  #driveDocumentJobs(jobs:DocumentJob[]){
    if(!this.#canRequestProjectOutputs())return;
    const projection=this.projection.get(),projectDocuments=new Set(projection.documents
      .filter((document)=>document.projectId===projection.projectId).map((document)=>document.id));
    const next=[...jobs].filter((job)=>job.kind!=="prompt_fan"&&(job.status==="queued"||job.status==="running"||job.status==="committing")
      &&(!projectDocuments.size||projectDocuments.has(job.documentId)))
      .sort((a,b)=>a.requestedAt.localeCompare(b.requestedAt)||a.jobId.localeCompare(b.jobId))[0];
    if(next&&(next.status==="queued"||documentJobIsStale(next))&&!this.#jobsDriving.has(next.jobId))void this.#driveDocumentJob(next);
    const recoverable=jobs.find((job)=>!this.#presentationRecoveryAttempts.has(job.jobId)&&documentJobCanRecoverPresentation(job));
    if(recoverable&&this.session.get()){this.#presentationRecoveryAttempts.add(recoverable.jobId);void this.recoverDocumentPresentation(recoverable.jobId);}
  }
  async #driveDocumentJob(job:DocumentJob){const authorization=this.#activeAuthorizationScope();this.#jobsDriving.add(job.jobId);try{const response=await fetch(`/api/document-jobs/${encodeURIComponent(job.jobId)}/run`,{method:"POST"});this.#assertAuthorizationScope(authorization);const body=await response.json() as {job?:DocumentJob;error?:string};this.#assertAuthorizationScope(authorization);if(!response.ok&&!body.job)throw new Error(body.error??"document_job_runner_failed");}catch{if(this.#scopeStillActive(authorization)&&document.visibilityState==="visible")this.toast("The connection to the background operation ended. The app will recover it safely.");}finally{if(this.#scopeStillActive(authorization)){this.#jobsDriving.delete(job.jobId);this.#scheduleJobPoll(350);}}}
async syncDocumentJobs(){
    if(!this.#canReadProjectJobs()){window.clearTimeout(this.#jobPollTimer);return;}
    const scope=this.#jobScope(),initialSession=this.session.get(),authorization=initialSession?this.#authorizationScope(initialSession):"";
    if(this.#jobsSyncing){if(scope!==this.#jobSyncScope)this.#jobResyncRequested=true;return;}
    this.#jobsSyncing=true;this.#jobSyncScope=scope;
    const feedBeforeRead=this.documentJobs.get();
    const planningReadSequence=this.#planningRecoverySequence;
    try{
      const response=await fetch(`/api/document-jobs${scope}`);
      if(!response.ok)throw new Error(`Job status returned ${response.status}`);
      const body=await response.json() as {jobs?:DocumentJob[]},currentSession=this.session.get();
      if(this.#jobScope()!==scope||!currentSession||this.#authorizationScope(currentSession)!==authorization){this.#jobResyncRequested=true;return;}
      // A newer explicit action may have completed while this list was in transit.
      // Discard that older page; a free resync can observe the new canonical state.
      if(this.documentJobs.get()!==feedBeforeRead){this.#jobResyncRequested=true;return;}
      const previous=new Map(feedBeforeRead.map(job=>[job.jobId,job]));
      const jobs=(body.jobs??[]).map(job=>{
        const detail=this.#jobDetails.get(job.jobId);
        if(detail&&job.kind!=="structure_adaptive"&&detail.updatedAt===job.updatedAt)return{...job,result:detail.result};
        if(detail)this.#jobDetails.delete(job.jobId);return job;
      });
      this.documentJobs.set(jobs);this.#jobPollFailures=0;this.#jobPollIssueNotified=false;
      for(const job of jobs)this.#observeAdaptivePlanningJob(job);
      this.notify();
      const terminalChanges=jobs.filter(job=>documentJobTerminal(job)&&(previous.has(job.jobId)?previous.get(job.jobId)?.status!==job.status:!job.notifiedAt&&!job.parentJobId));
      const fanProgress=jobs.some(job=>job.kind==="prompt_fan"&&previous.has(job.jobId)&&previous.get(job.jobId)?.updatedAt!==job.updatedAt);
      const disappearedActive=[...previous.values()].some(job=>(job.status==="queued"||job.status==="running"||job.status==="committing")&&!jobs.some(current=>current.jobId===job.jobId));
      const completed=terminalChanges.filter(job=>!job.notifiedAt&&!job.parentJobId);
      if(terminalChanges.length||fanProgress||disappearedActive){this.#pendingJobEventRefresh=true;this.#pendingJobSessionRefresh=true;}
      if(this.#pendingJobEventRefresh){await this.#refreshEvents();this.#assertAuthorizationScope(authorization);this.#pendingJobEventRefresh=false;}
      if(this.#pendingJobSessionRefresh){
        try{await this.refreshSession();this.#assertAuthorizationScope(authorization);this.#pendingJobSessionRefresh=false;}
        catch(error){if(!this.#scopeStillActive(authorization))throw error;/* Retry account totals independently of creative recovery. */}
      }
      this.#assertAuthorizationScope(authorization);
      const inspected=await this.#revalidateMissingAdaptivePlans(jobs,authorization,previous);
      this.#assertAuthorizationScope(authorization);
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
        if(job.status==="completed"&&this.#jobResultVisible(job)){void this.#ackJob(job.jobId);continue;}
        if(document.visibilityState==="visible"){this.toast(this.#jobNotice(job));if(!job.canvasId)void this.#ackJob(job.jobId);}else this.#pendingJobNotices.push(job);
      }
      const latest=this.documentJobs.get();this.notify();this.#driveDocumentJobs(latest);
      this.#scheduleJobPoll(latest.some(job=>job.status==="queued"||job.status==="running"||job.status==="committing")?1_500:this.#pendingJobSessionRefresh?5_000:60_000);
    }catch{
      if(this.#scopeStillActive(authorization)){
        this.#jobPollFailures+=1;
        if(this.#jobPollFailures>=3&&!this.#jobPollIssueNotified&&document.visibilityState==="visible"){this.#jobPollIssueNotified=true;this.toast("Background status is temporarily unavailable. Retrying…");}
        this.#scheduleJobPoll(5_000);
      }
    }finally{
      this.#jobsSyncing=false;
      if(this.#scopeStillActive(authorization)&&(this.#jobResyncRequested||this.#jobScope()!==scope)){this.#jobResyncRequested=false;queueMicrotask(()=>void this.syncDocumentJobs());}
    }
  }

  /** Read-only client evidence guard; the server still recertifies private sources and the HttpOnly context. */
  captureSceneCostSource(request:SceneCostRequest){
    const source=()=>{
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
    if(artifactKind==="scene"){const consent=payload.sceneCostConsent as Partial<SceneCostApproval>|undefined;const {confirmed,...preview}=consent??{};if(confirmed!==true||!isSceneCostPreview(preview))throw new Error("scene_cost_confirmation_required");return preview.maximumMicrousd;}
    const audioCost=artifactKind==="audio"?selectAudioAdapterContract(normalizeAudioRequestProfile(payload.audioProfile,payload.snapshot&&typeof payload.snapshot==="object"?payload.snapshot as Record<string,unknown>:{}),payload.audioProviderModel?{preferredModel:String(payload.audioProviderModel)}:{}).estimatedCostMicrousd:0;
    if(payload.productionMode==="managed"&&["short_story","scene","slides","storyboard","video","audio"].includes(artifactKind)){const production=buildManagedProductionPlan(artifactKind as DocumentArtifactKind,payload.snapshot&&typeof payload.snapshot==="object"?payload.snapshot as Record<string,unknown>:{},artifactKind==="video"?{}:{requestedItemCount:Number(payload.itemCount??payload.requestedSlideCount??0),...(artifactKind==="slides"?{requestedSlideCount:Number(payload.requestedSlideCount??payload.itemCount??0)}:{})});return production.estimatedTotalCostMicrousd+(artifactKind==="storyboard"?production.scenes.length*1_000_000:artifactKind==="audio"?audioCost:0);}
    return artifactKind==="video"?normalizeVideoDurationSeconds(payload.videoSeconds)*VIDEO_ADAPTER_CONTRACT.publishedCostPerSecondMicrousd[VIDEO_ADAPTER_CONTRACT.defaultResolution]+1_000_000:artifactKind==="audio"?audioCost+1_000_000:artifactKind==="storyboard"?Math.max(1,Math.floor(Number(payload.itemCount??6)))*1_000_000+1_000_000:1_000_000;
  }
  async #authorizeGenerationBudget(kind:DocumentJobKind,payload:Record<string,unknown>){
    if(!["preview","generate","prompt_fan","render_document","chat","structure_adaptive"].includes(kind))return;
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
    if(gate.level==="blocked")throw new Error(localize("This generation exceeds the remaining {scope} monthly budget.",{scope}));
    if(!gate.requiresAcknowledgement){this.#assertAuthorizationScope(authorization);payload.budgetAcknowledged=acknowledged;payload.budgetWarningSuppressed=suppressed&&gate.level!=="critical";return;}
    const dialog=document.createElement("dialog");dialog.className="modal generation-budget-approval";dialog.lang=locale.locale;dialog.dir=locale.direction;const dialogId=crypto.randomUUID();dialog.setAttribute("aria-labelledby",`generation-budget-title-${dialogId}`);dialog.setAttribute("aria-describedby",`generation-budget-description-${dialogId}`);
    const card=document.createElement("section");card.className="modal-card";
    const heading=document.createElement("h2");heading.id=`generation-budget-title-${dialogId}`;heading.textContent=localize(gate.level==="critical"?"Your monthly generation budget is almost exhausted":"Review your monthly generation budget");
    const message=document.createElement("p");message.id=`generation-budget-description-${dialogId}`;message.textContent=localize("This {scope} budget will be {percent}% used. The generation reserves up to {reserved}; {remaining} remains before it starts.",{scope,percent:new Intl.NumberFormat(locale.formatLocale).format(Math.round(gate.projectedUtilization*100)),reserved:formatGenerationUsd(gate.projectedMicrousd),remaining:formatGenerationUsd(gate.remainingMicrousd)});
    card.append(heading,message);
    let suppression:HTMLInputElement|null=null;
    if(gate.dismissible){const label=document.createElement("label");suppression=document.createElement("input");suppression.type="checkbox";label.append(suppression,document.createTextNode(` ${localize("I no longer want to see this until 95% of the monthly budget is used")}`));card.append(label);}
    const footer=document.createElement("footer"),cancel=document.createElement("button"),continueButton=document.createElement("button");cancel.type="button";cancel.className="button ghost";cancel.textContent=locale.messages["action.cancel"]??"Cancel";continueButton.type="button";continueButton.className="button primary";continueButton.textContent=localize("I understand, continue");footer.append(cancel,continueButton);card.append(footer);dialog.append(card);document.body.append(dialog);
    const accepted=await new Promise<boolean>((resolve)=>{let settled=false;const finish=(requested:boolean)=>{if(settled)return;settled=true;window.removeEventListener("forma-authorization-changed",changed);const value=requested&&this.#scopeStillActive(authorization);if(value&&suppression?.checked)this.#setBudgetPreference(suppressionKey);if(value&&gate.level==="notice")this.#setBudgetPreference(noticeKey);if(dialog.open)dialog.close();dialog.remove();resolve(value);};const changed=()=>finish(false);window.addEventListener("forma-authorization-changed",changed,{once:true});cancel.addEventListener("click",()=>finish(false));continueButton.addEventListener("click",()=>finish(true));dialog.addEventListener("cancel",(event)=>{event.preventDefault();finish(false);});if(!this.#scopeStillActive(authorization)){finish(false);return;}dialog.showModal();});
    this.#assertAuthorizationScope(authorization);
    if(!accepted)throw new Error(localize("Generation canceled before any provider work was started."));
    payload.budgetAcknowledged=true;payload.budgetWarningSuppressed=this.#budgetPreference(suppressionKey)&&gate.level!=="critical";
  }
  async #startDocumentJob(kind:DocumentJobKind,payload:Record<string,unknown>,sourceSurface:string,documentIdOverride?:string,controls:Pick<SceneSubmissionPorts,"current"|"onDispatch">={}):Promise<{job:DocumentJob;reused:boolean;sceneCostExisting?:{requestId:string;preview:SceneCostPreview|null}}>{
    const scene=kind==="render_document"&&payload.artifactKind==="scene";
    const check=()=>{if(scene&&controls.current&&!controls.current())throw new Error("scene_cost_changed");};check();
    if(!payload.locale&&["preview","generate","prompt_fan","render_document"].includes(kind))payload={...payload,locale:typeof document==="undefined"?"en":document.documentElement.lang||"en"};
    const authorization=this.#activeAuthorizationScope();
    if(!this.#canRequestProjectOutputs())throw new Error("Your project role does not permit creating outputs.");
    const documentId=documentIdOverride??this.projection.get().documentId;
    if(kind==="structure_adaptive")payload={...payload,requestKey:await adaptiveRequestKey({projectId:this.projection.get().projectId,documentId,canvasId:payload.canvasId,sourceSurface,projectScope:payload.projectScope,locale:payload.locale,prompt:payload.prompt})};
    const requestKey=String(payload.requestKey??"");
    if(requestKey){
      const active=this.documentJobs.get().find((job)=>job.documentId===documentId&&job.kind===kind&&job.requestKey===requestKey&&["queued","running","committing"].includes(job.status));
      if(active&&kind!=="structure_adaptive"&&!scene)return{job:active,reused:true};
      if(kind==="render_document"&&payload.artifactKind==="slides"&&payload.paidRetryConfirmed!==true){
        const failed=this.documentJobs.get().find((job)=>job.documentId===documentId&&job.kind===kind&&job.requestKey===requestKey&&job.status==="failed"&&job.result?.artifactKind==="slides");
        if(failed&&documentJobCanRecoverPresentation(failed)){
          if(await this.recoverDocumentPresentation(failed.jobId)){const recovered=this.documentJobs.get().find((job)=>job.jobId===failed.jobId);if(recovered)return{job:recovered,reused:true};}
          throw new Error("The already-paid slideshow could not be recovered safely; review its saved draft before approving another paid request.");
        }
      }
    }
    if(requestKey&&this.#jobStarts.has(requestKey))throw new Error(kind==="render_document"?"This exact output request is already being queued.":"This exact image request is already being queued.");
    if(requestKey){this.#jobStarts.add(requestKey);this.notify();}try{const navigation=this.#navigationCommit;await this.#appendPipeline;this.#assertAuthorizationScope(authorization);check();
      if(navigation&&!await navigation)throw new Error("The selected project could not be opened safely.");
      this.#assertAuthorizationScope(authorization);check();await this.#authorizeGenerationBudget(kind,payload);this.#assertAuthorizationScope(authorization);check();
      const action=kind==="preview"?"start a draft image":kind==="generate"?"start a full-quality image":kind==="prompt_fan"?"start a four-image prompt fan":`start ${kind.replaceAll("_"," ")}`;
      const response=await this.guardedFetch("/api/document-jobs",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({kind,documentId,sourceSurface,payload})},action,scene?controls:{});
      this.#assertAuthorizationScope(authorization);check();
      const body=await response.json() as {job?:DocumentJob;error?:string;message?:string;reused?:boolean;readiness?:GenerationReadiness;attemptSubmission?:string;sceneCostExisting?:{requestId:string;preview:SceneCostPreview|null}};
      this.#assertAuthorizationScope(authorization);check();
      if(!response.ok||!body.job)throw Object.assign(new Error(body.message??body.error??"Document operation could not be started"),scene&&body.attemptSubmission==="not-submitted"?{attemptSubmission:"not-submitted"}:{});
      if(scene){
        if(!sceneCostJobMatches(body.job,String(payload.sceneRequestId??""),documentId))throw new Error("scene_cost_unavailable");
        const original=body.sceneCostExisting,session=this.session.get();
        if(original&&(original.requestId!==payload.sceneRequestId||original.preview!==null&&(!isSceneCostPreview(original.preview)
          ||original.preview.requestId!==payload.sceneRequestId||original.preview.actorUserId!==session?.user.userId
          ||original.preview.projectId!==this.projection.get().projectId||original.preview.documentId!==documentId)))throw new Error("scene_cost_unavailable");
      }
      if(kind==="structure_adaptive"&&!adaptiveJobMatchesRequest(body.job,{documentId,canvasId:typeof payload.canvasId==="string"?payload.canvasId:null,sourceSurface,requestKey}))throw new Error(currentFormaLocale().messages["next.exact.unavailable"]??"The exact planning request changed.");
      const activeSession=this.session.get();if(!activeSession||this.#authorizationScope(activeSession)!==authorization)throw new Error("The selected project changed before this request finished.");
      if(body.readiness&&requestKey)this.generationReadiness.set({...this.generationReadiness.get(),[requestKey]:body.readiness});
      const jobs=[body.job,...this.documentJobs.get().filter((job)=>job.jobId!==body.job!.jobId)];
      this.documentJobs.set(jobs);if(requestKey)this.#readinessAcknowledgements.delete(requestKey);this.notify();this.#driveDocumentJobs(jobs);this.#scheduleJobPoll(800);
      return{job:body.job,reused:Boolean(body.reused),...(scene&&body.sceneCostExisting?{sceneCostExisting:body.sceneCostExisting}:{})};
    }finally{if(requestKey&&this.#scopeStillActive(authorization)){this.#jobStarts.delete(requestKey);this.notify();}}
  }
  patchUi(patch: Partial<typeof this.ui>) { Object.assign(this.ui, patch); this.notify(); }
  #systemNotice(source:string,values:Record<string,string|number>={}){const locale=currentFormaLocale();const automatic=formaSystemMessageId(source);const fallback=Object.entries(FORMA_DEFAULT_MESSAGES).find(([,value])=>value===source)?.[0];const message=locale.messages[automatic]??(fallback?locale.messages[fallback]:undefined)??source;return Object.keys(values).length?message.replace(/\{(\w+)\}/g,(_,key:string)=>{const value=values[key];return typeof value==="number"?new Intl.NumberFormat(locale.formatLocale).format(value):String(value??"");}):message;}
  toast(message: string) {
    const localized=this.#systemNotice(message);
    this.ui.toast=localized;
    this.notify();
    window.setTimeout(()=>{if(this.ui.toast===localized){this.ui.toast="";this.notify();}},2800);
  }
  async confirmImpersonatedInteraction(action="change this fictional account"){
    if(!this.session.get()?.impersonation)return true;if(this.#impersonationConfirmation)return false;this.patchUi({impersonationConfirmOpen:true,impersonationAction:action});return new Promise<boolean>((resolve)=>{this.#impersonationConfirmation=resolve;});
  }
  resolveImpersonatedInteraction(confirmed:boolean){const resolve=this.#impersonationConfirmation;this.#impersonationConfirmation=undefined;this.patchUi({impersonationConfirmOpen:false,impersonationAction:""});resolve?.(confirmed);if(!confirmed)this.toast("Canceled. The fictional account was not changed.");}
  async guardedFetch(input:RequestInfo|URL,init:RequestInit={},action="change this fictional account",controls:Pick<SceneSubmissionPorts,"current"|"onDispatch">={}){
    const check=()=>{if(controls.current&&!controls.current())throw new Error("scene_cost_changed");};check();
    const authorization=this.#activeAuthorizationScope(),method=String(init.method??(input instanceof Request?input.method:"GET")).toUpperCase();
    if(!this.session.get()?.impersonation||["GET","HEAD","OPTIONS"].includes(method)){check();const pending=fetch(input,init);try{controls.onDispatch?.();}catch{/* A presentation callback cannot abandon an already-dispatched request. */}const response=await pending;check();if(authorization)this.#assertAuthorizationScope(authorization);return response;}
    const confirmed=await this.confirmImpersonatedInteraction(action);this.#assertAuthorizationScope(authorization);check();if(!confirmed)return Response.json({error:"Action canceled. No changes were made to the fictional account."},{status:409});const headers=new Headers(input instanceof Request?input.headers:undefined);new Headers(init.headers).forEach((value,key)=>headers.set(key,value));headers.set("x-forma-impersonation-confirmation","I understand, continue");check();const pending=fetch(input,{...init,headers});try{controls.onDispatch?.();}catch{/* A presentation callback cannot abandon an already-dispatched request. */}const response=await pending;check();this.#assertAuthorizationScope(authorization);return response;
  }
  async startImpersonating(personaId:string,route="/projects"){
    const response=await fetch("/api/impersonation",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({personaId,confirmation:"I understand, continue"})});const body=await response.json() as {route?:string;error?:string};if(!response.ok)throw new Error(body.error??"The fictional account could not be opened");window.location.assign(body.route??route);
  }
  async stopImpersonating(){const response=await fetch("/api/impersonation",{method:"DELETE"});const body=await response.json() as {route?:string;error?:string};if(!response.ok)throw new Error(body.error??"Your regular account could not be restored");window.location.assign(body.route??"/laboratory/replay");}
  setRoute(path: string, options: WorkspaceNavigationOptions = {}) {
    if(!workspaceNavigationCurrent(options))return;
    const current=applicationIdFromRoute(this.route.get()),destination=applicationIdFromRoute(path);
    if(current!==destination){
      if(!["creative","canvas"].includes(current)||!["creative","canvas"].includes(destination)){location.assign(path);return;}
      void this.transitionWorkspace(path,options);
      return;
    }
    this.#commitRoute(path,options);
  }

  async transitionWorkspace(path:string,options:WorkspaceNavigationOptions={}){
    if(!workspaceNavigationCurrent(options))return false;
    const guarded=Boolean(options.current||options.focus),navigationScope=guarded?this.captureAuthorizationScope():null;
    const source=applicationIdFromRoute(this.route.get()),destination=applicationIdFromRoute(path);
    if(source===destination){this.#commitRoute(path,options);return true;}
    if(!["creative","canvas"].includes(source)||!["creative","canvas"].includes(destination)){location.assign(path);return true;}
    const previous=this.session.get(),attempt=++this.#workspaceTransition;
    try{
      const response=await fetch(`/api/session?audience=${encodeURIComponent(destination)}`,{cache:"no-store",credentials:"same-origin"});
      const ownsHeaders=workspaceNavigationCurrent(options);
      const current=await response.json() as PilotSession&{error?:string};
      const ownsBody=workspaceNavigationCurrent(options);
      if(!response.ok)throw new Error(current.error??"The selected workspace is no longer available.");
      if(attempt!==this.#workspaceTransition||applicationIdFromRoute(this.route.get())!==source)return false;
      // A stale navigation may still retire permissions for its original actor,
      // but must never restore another account or silently move a newer view.
      if(guarded&&!this.authorizationScopeActive(navigationScope))return false;
      if(!workspaceTransitionAuthorized(previous,current,destination)){
        if(previous&&previous.user.userId===current.user.userId)this.#applySession({...current,audience:previous.audience});
        this.toast(destination==="canvas"?"Canvas is no longer available for this account or project.":"Your workspace authorization has changed. Reload your current project.");
        return false;
      }
      this.#applySession({...current,audience:previous?.audience});
      if(!ownsHeaders||!ownsBody||!workspaceNavigationCurrent(options))return false;
      this.#commitRoute(path,options);
      return true;
    }catch(error){if(attempt===this.#workspaceTransition)this.toast(error instanceof Error?error.message:"The selected workspace could not be authorized.");return false;}
  }

  #commitRoute(path:string,options:WorkspaceNavigationOptions={}){
    if(!workspaceNavigationCurrent(options))return;
    const projection = this.projection.get();
    const requestedFocus = options.documentFocus ?? (documentFocusFromRoute(path) || documentFocusFromRoute(this.route.get()));
    const focusAwarePath = isDocumentViewRoute(path) ? withDocumentFocusInRoute(path, requestedFocus) : path;
    const requestedDocumentId = documentIdFromRoute(focusAwarePath);
    const routeDocumentId = requestedDocumentId || projection.documentId;
    const routeDocumentTitle = projection.documents.find((document) => document.id === routeDocumentId)?.title ?? (routeDocumentId === projection.documentId ? projection.documentTitle : "");
    const routedPath = isDocumentViewRoute(focusAwarePath) && routeDocumentId ? withDocumentInRoute(focusAwarePath, routeDocumentId, routeDocumentTitle) : focusAwarePath;
    const current = `${location.pathname}${location.search}${location.hash}`;
    if (current !== routedPath) {
      if (options.replace) history.replaceState({}, "", routedPath);
      else history.pushState({}, "", routedPath);
      if(!this.loading.get()){
        beginRoutePopulation(routedPath);
        recordRouteHistoryProfile(this.#historyProfile);
        const contentScope=routeCapabilities(routedPath).profile==="memory"?"memory":documentViewFromRoute(routedPath)==="chat"?"chat":"all";recordPrivateContentState(routeCapabilities(routedPath).privateContent?(this.#privateContentScope==="all"||this.#privateContentScope===contentScope?"ready":"pending"):"not-required",routeCapabilities(routedPath).privateContent?contentScope:undefined);
        recordPopulationSource("memory",this.events.get().length);
      }
    }
    this.#workspaceNavigationFocus=options.focus?{route:routedPath,focus:options.focus}:null;
    this.route.set(routedPath);if(!this.loading.get()&&!routeCapabilities(routedPath).jobHistory&&!this.documentJobs.get().some((job)=>job.status==="queued"||job.status==="running"||job.status==="committing")){window.clearTimeout(this.#jobPollTimer);this.#pendingPassiveJobPath=routedPath;}this.notify(); window.dispatchEvent(new CustomEvent("forma-route-changed", { detail: { path: routedPath } }));
    const required=this.#profileForRoute(routedPath);
    if(eventProfileRank(this.#historyProfile)<eventProfileRank(required))void this.#upgradeHistory(required).catch((error)=>{console.warn("[forma-performance]",JSON.stringify({phase:"history-upgrade",message:error instanceof Error?error.message:"history_upgrade_failed"}));});
    if(routeCapabilities(routedPath).privateContent&&!this.loading.get())requestAnimationFrame(()=>void this.#hydrateVisiblePrivateContent().catch(()=>undefined));
    if(!this.loading.get()&&(this.#jobScope(current)!==this.#jobScope(routedPath)||!routeCapabilities(routedPath).jobHistory))requestAnimationFrame(()=>this.#syncVisibleJobs(routedPath));
  }

  async syncDocumentFromRoute(path = this.route.get()) {
    if (!isDocumentViewRoute(path) || !this.events.get().length) return;
    const projection = this.projection.get();
    const requestedDocumentId = documentIdFromRoute(path);
    if (!requestedDocumentId) {
      if (projection.documentId) this.setRoute(withDocumentInRoute(path, projection.documentId, projection.documentTitle), { replace: true });
      return;
    }
    const requestedDocument = projection.documents.find((document) => document.id === requestedDocumentId);
    if (!requestedDocument) {
      this.setRoute(withDocumentInRoute(path, projection.documentId, projection.documentTitle), { replace: true });
      this.toast("That document is unavailable; the current document was opened instead.");
      return;
    }
    if (requestedDocumentId !== projection.documentId) {
      const opened = await this.openDocument(requestedDocumentId, path, "shared-document-url");
      if (!opened) this.setRoute(withDocumentInRoute(path, projection.documentId, projection.documentTitle), { replace: true });
    }
    else {
      const canonicalRoute = withDocumentInRoute(path, projection.documentId, projection.documentTitle);
      if (canonicalRoute !== path) this.setRoute(canonicalRoute, { replace: true });
    }
  }
  setAttentionCapture(enabled:boolean){if(this.session.get()?.impersonation){this.patchUi({attentionCapture:false,attentionPaused:true});this.toast("Attention capture stays off while you experience a fictional account.");return;}writeAttentionPreference(enabled,this.session.get()?.user.userId??"anonymous");this.patchUi({attentionCapture:enabled,attentionPaused:false});this.toast(enabled?"Attention signals enabled for this account on this device.":"Attention signals disabled; the current episode was closed.");}
  setAttentionPaused(paused:boolean){this.patchUi({attentionPaused:paused});this.toast(paused?"Attention capture paused on this device.":"Attention capture resumed.");}
  async forgetAttentionSignals(){window.dispatchEvent(new Event("forma-attention-forget"));const session=this.session.get();let appended:CreativeEvent[]=[];if(session?.projectContext){const authorization=this.#authorizationScope(session),response=await fetch("/api/privacy/attention",{method:"POST"}),body=await response.json() as {appended?:CreativeEvent[];error?:string};this.#assertAuthorizationScope(authorization);if(!response.ok){this.toast(body.error??"Your personal attention data could not be forgotten.");return[];}appended=body.appended??[];}else appended=await this.append({type:"AttentionSignalsForgotten",payload:{scope:"all-attention-episodes",before_sequence:this.head.get(),reason:"user-requested",device_ledger_cleared:true}});if(appended.length){const active=this.session.get();if(active)await clearAnalyticsSnapshots(this.#snapshotIdentity(active),true);this.toast("Your personal attention episodes were forgotten and excluded from Scout and Memory.");}return appended;}
  async erasePersonalAuthoredContext(){const session=this.session.get();if(!session||session.projectContext||session.impersonation)return false;const authorization=this.#authorizationScope(session);try{const response=await this.guardedFetch("/api/privacy/events",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"erase-personal-authored-context",confirmation:"ERASE_MY_PERSONAL_AUTHORED_CONTEXT"})},"erase personal authored context");this.#assertAuthorizationScope(authorization);const result=await response.json() as {error?:string;message?:string;erasedAuthoredEventBodies?:number;outputReservationReconciliationPending?:boolean;outputProviderReconciliationPending?:number;outputStorageCleanupPending?:number;outputReconciliationCheckFailed?:boolean};this.#assertAuthorizationScope(authorization);if(!response.ok)throw new Error(result.message??result.error??"Personal authored context could not be erased.");await Promise.all([clearAccountSnapshots(this.#snapshotIdentity(session)),clearAnalyticsSnapshots(this.#snapshotIdentity(session)),canvasOfflineQueue.clearPersonalOwner(session.user.userId).catch(()=>0)]);this.#assertAuthorizationScope(authorization);this.events.set([]);this.optimisticEvents.set([]);this.content.set({});this.head.set(0);await this.#refreshEvents();this.#assertAuthorizationScope(authorization);const outputPending=Boolean(result.outputReservationReconciliationPending||result.outputProviderReconciliationPending||result.outputStorageCleanupPending||result.outputReconciliationCheckFailed);this.toast(this.#systemNotice("{count} personal authored event bodies erased. Finished outputs, shared organization work, uploads, backups, and other devices are not removed.",{count:result.erasedAuthoredEventBodies??0})+(outputPending?" "+this.#systemNotice("Some Output file cleanup or provider accounting is still pending. No new generation was authorized."):""));this.notify();return true;}catch(error){if(this.#scopeStillActive(authorization))this.toast(error instanceof Error?error.message:"Personal authored context could not be erased.");return false;}}
  async migrateHistoricalEventPrivacy(){const session=this.session.get();if(!session||session.user.role!=="admin"||session.projectContext||session.impersonation)return false;const authorization=this.#authorizationScope(session);try{const response=await this.guardedFetch("/api/privacy/events",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"migrate-historical-events",confirmation:"MIGRATE_HISTORICAL_EVENT_CONTENT"})},"migrate historical event privacy");this.#assertAuthorizationScope(authorization);const result=await response.json() as {error?:string;message?:string;migratedEvents?:number};this.#assertAuthorizationScope(authorization);if(!response.ok)throw new Error(result.message??result.error??"Historical event migration failed.");await Promise.all([clearAccountSnapshots(this.#snapshotIdentity(session)),clearAnalyticsSnapshots(this.#snapshotIdentity(session))]);this.toast(this.#systemNotice("{count} historical event bodies moved into erasable owner-scoped storage. Existing backups and other devices still require separate handling.",{count:result.migratedEvents??0}));return true;}catch(error){if(this.#scopeStillActive(authorization))this.toast(error instanceof Error?error.message:"Historical event migration failed.");return false;}}

  async load() {
    const loadRevision=++this.#loadRevision;let loadAuthorization="";
    const ownsLoad=()=>loadRevision===this.#loadRevision&&(!loadAuthorization||this.#scopeStillActive(loadAuthorization));
    const path=this.route.get();const profile=this.#profileForRoute(path);const started=performance.now();
    beginRoutePopulation(path);
    recordRouteHistoryProfile(profile);
    recordPrivateContentState(routeCapabilities(path).privateContent?"pending":"not-required");
    this.loading.set(true); this.notify();
    try {
      // The document's streamed session is verified on this exact request. Cached
      // account data remains invisible until that authoritative identity is known.
      const bootstrap=consumeSessionBootstrap();
      const prefetched=consumeSessionPrefetch();
      const sessionPromise=bootstrap?Promise.resolve(this.#applySession(bootstrap)):this.refreshSession(prefetched);
      const snapshotsPromise=sessionPromise.then((verified)=>readAccountSnapshots(this.#snapshotIdentity(verified)));
      if(documentViewFromRoute(path)==="chat")void sessionPromise.then((verified)=>{if(this.session.get()?.user.userId!==verified.user.userId||this.route.get()!==path)return;return this.#hydrateVisiblePrivateContent();}).catch(()=>undefined);
      const live=snapshotsPromise.then(async(snapshots)=>{
        if(snapshots.length){
          const verified=await sessionPromise;
          const snapshot=matchingAccountSnapshot(snapshots,this.#snapshotIdentity(verified),profile);
          if(snapshot)return this.#readEventStream(snapshot.head,snapshot.profile,false);
        }
        return this.#readEventStream(0,profile,false);
      });
      const [session,snapshots]=await Promise.all([sessionPromise,snapshotsPromise]);
      const authorization=this.#authorizationScope(session);loadAuthorization=authorization;if(!ownsLoad())throw new Error("The active workspace changed before its history finished loading.");this.#assertAuthorizationScope(authorization);
      recordSessionReady(started,bootstrap?"document":prefetched?"prefetch":"request");
      const identity=this.#snapshotIdentity(session);
      const cached=matchingAccountSnapshot(snapshots,identity,profile);
      if(cached){
        this.#assertAuthorizationScope(authorization);
        this.events.set(cached.events);this.head.set(cached.head);this.#historyProfile=cached.profile;
        recordPopulationSource("indexeddb",cached.events.length);
        void live.then(async(current)=>{
          this.#assertAuthorizationScope(authorization);
          if(current.head<cached.head){const restored=await this.#readEventStream(0,profile,false);this.#assertAuthorizationScope(authorization);this.events.set(restored.events);this.content.set({...this.content.get(),...restored.content});this.head.set(restored.head);this.#historyProfile=profile;this.notify();}
          else if(current.head>cached.head){this.#assertAuthorizationScope(authorization);const merged=new Map([...this.events.get(),...current.events].map((event)=>[event.eventId,event]));this.events.set([...merged.values()].sort((left,right)=>left.sequence-right.sequence||left.eventId.localeCompare(right.eventId)));if(Object.keys(current.content).length)this.content.set({...this.content.get(),...current.content});this.head.set(current.head);this.#publishAppended(current.events);this.notify();void writeAccountSnapshot(identity,this.events.get(),this.head.get(),this.#historyProfile);}
        }).catch((error)=>console.warn("[forma-performance]",JSON.stringify({phase:"cache-revalidation",message:error instanceof Error?error.message:"cache_revalidation_failed"})));
      }else{
        const body=await live;
        this.#assertAuthorizationScope(authorization);
        this.events.set(body.events);this.content.set({...this.content.get(),...body.content});this.head.set(body.head);this.#historyProfile=profile;
        recordPopulationSource("miss",body.events.length);
        void writeAccountSnapshot(identity,body.events,body.head,profile);
      }
      while (!this.routeDataReady()) {
        await this.#upgradeHistory(this.#profileForRoute(this.route.get()));
        if (!ownsLoad()) throw new Error("The active workspace changed before its history finished loading.");
      }
      this.#assertAuthorizationScope(authorization);this.error.set("");this.loading.set(false);this.notify();
      requestAnimationFrame(()=>{
        if(!ownsLoad())return;
        void this.syncDocumentFromRoute(this.route.get());
        this.#syncVisibleJobs(this.route.get());
        if(routeCapabilities(this.route.get()).privateContent)void this.#hydrateVisiblePrivateContent().catch(()=>undefined);
      });
    }catch(error){if(ownsLoad())this.error.set(error instanceof Error?error.message:"Unable to load event stream");}
    finally{if(ownsLoad()){this.loading.set(false);this.notify();}}
  }

  #applySession(body:PilotSession,revision?:number){
    if(revision===undefined)this.#sessionRevision+=1;
    const previous=this.session.get(),previousUserId=previous?.user.userId;
    if(previous&&this.#authorizationScope(previous)!==this.#authorizationScope(body)){
      this.events.set([]);this.head.set(0);this.content.set({});this.shares.set([]);this.projectNotifications.set([]);this.organizationContextPackages.set([]);this.organizationContextBindings.set([]);this.organizationContextVersions.set({});this.reviewInbox.set([]);this.optimisticEvents.set([]);
      this.documentJobs.set([]);this.generationReadiness.set({});this.outputRequirements.clear();this.#jobDetails.clear();this.#planningRecoveryIdentities.clear();this.#privateContentScope="none";
      this.#adaptiveStructureJobIds.clear();this.adaptiveStructures.set({});this.adaptiveSuggestionSets.set({});this.replayEvents.set([]);this.replayAsOf.set(0);this.asOf.set(Number.POSITIVE_INFINITY);
      this.#pendingAdaptiveIntents.clear();this.#pendingJobNotices=[];this.#readinessAcknowledgements.clear();this.#dismissedAdaptiveSuggestions.clear();this.#readinessInFlight.clear();this.#jobStarts.clear();this.#jobsDriving.clear();this.#presentationRecoveryAttempts.clear();this.#focalInFlight.clear();
      this.#pendingJobEventRefresh=false;this.#pendingJobSessionRefresh=false;this.#pendingPassiveJobPath="";this.#historyProfile="full";this.#historyUpgrade=undefined;this.#contentHydration=undefined;
      this.ui.shareOpen=false;this.ui.accountOpen=false;this.ui.compareOpen=false;
      this.#undo=[];this.#redo=[];this.#rememberedClientEventIds.clear();window.clearTimeout(this.#jobPollTimer);window.clearTimeout(this.#collaborationPollTimer);window.clearTimeout(this.#focalBackfillTimer);
      window.dispatchEvent(new CustomEvent("forma-authorization-changed",{detail:{previous:this.#authorizationScope(previous),current:this.#authorizationScope(body)}}));
    }
    this.session.set(body);
    if(body.projectContext){void this.syncProjectNotifications();void this.syncOrganizationContextPackages();}else{this.projectNotifications.set([]);this.organizationContextPackages.set([]);this.organizationContextBindings.set([]);this.organizationContextVersions.set({});}
    void this.syncReviewInbox();
    this.#scheduleCollaborationPoll();
    if(body.impersonation){this.ui.attentionCapture=false;this.ui.attentionPaused=true;}
    else if(previousUserId!==body.user.userId){this.ui.attentionCapture=readAttentionPreference(body.user.userId);this.ui.attentionPaused=false;}
    this.notify();return body;
  }

  async refreshSession(prefetched:Promise<Response>|null=null) {
    const revision=++this.#sessionRevision,response=await(prefetched?prefetched.catch(()=>fetch("/api/session")):fetch("/api/session"));
    if(revision!==this.#sessionRevision){const active=this.session.get();if(active)return active;throw new Error("A newer workspace session is already loading.");}
    const body=await response.json() as PilotSession & {error?:string};
    if(revision!==this.#sessionRevision){const active=this.session.get();if(active)return active;throw new Error("A newer workspace session is already loading.");}
    if(!response.ok)throw new Error(body.error??"Authentication required");return this.#applySession(body,revision);
  }

  async syncProjectNotifications(){const session=this.session.get();if(!session?.projectContext){this.projectNotifications.set([]);return;}const authorization=this.#authorizationScope(session);try{const response=await fetch("/api/project-notifications");this.#assertAuthorizationScope(authorization);const body=await response.json() as {notifications?:ProjectNotification[]};this.#assertAuthorizationScope(authorization);if(response.ok){this.projectNotifications.set(body.notifications??[]);this.notify();}}catch{/* Event polling retries project follow-up without blocking the actual work. */}}
  async acknowledgeProjectNotification(id:string){const session=this.session.get();if(!session?.projectContext)return false;const authorization=this.#authorizationScope(session);try{const response=await this.guardedFetch("/api/project-notifications",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({notificationId:id})},"acknowledge this project update");this.#assertAuthorizationScope(authorization);const body=await response.json() as {readAt?:string};this.#assertAuthorizationScope(authorization);if(!response.ok)return false;this.projectNotifications.set(this.projectNotifications.get().map((item)=>item.id===id?{...item,readAt:body.readAt??new Date().toISOString()}:item));this.notify();return true;}catch{return false;}}
  async syncReviewInbox(){const session=this.session.get();if(!session){this.reviewInbox.set([]);return;}const authorization=this.#authorizationScope(session);try{const response=await fetch("/api/workspaces/reviews",{credentials:"same-origin"});this.#assertAuthorizationScope(authorization);const body=await response.json() as {tasks?:AssignedReviewTask[]};this.#assertAuthorizationScope(authorization);if(response.ok){this.reviewInbox.set(body.tasks??[]);this.notify();}}catch{/* Reviewer work is refreshed without exposing stale cross-tenant responses. */}}
  async syncOrganizationContextPackages(){
    const session=this.session.get(),context=session?.projectContext;
    if(!session||!context){this.organizationContextPackages.set([]);this.organizationContextBindings.set([]);this.organizationContextVersions.set({});return;}
    const authorization=this.#authorizationScope(session);
    try{
      const response=await fetch(`/api/workspaces/${encodeURIComponent(context.organizationId)}/context-packages`,{credentials:"same-origin"});
      this.#assertAuthorizationScope(authorization);
      const body=await response.json() as {packages?:OrganizationContextPackage[]};
      this.#assertAuthorizationScope(authorization);
      if(!response.ok)return;
      const packages=body.packages??[];
      const versions:Record<string,OrganizationContextVersion>={};
      const results=await Promise.all(packages.map(async(item)=>{
        const scoped=await fetch(`/api/workspaces/${encodeURIComponent(context.organizationId)}/context-packages/${encodeURIComponent(item.id)}/bindings`,{credentials:"same-origin"});
        this.#assertAuthorizationScope(authorization);
        const rows=await scoped.json() as {bindings?:Array<Record<string,unknown>>};
        this.#assertAuthorizationScope(authorization);
        const bindings=scoped.ok?(rows.bindings??[]):[];
        const requested=new Set([item.versionId,...bindings.flatMap((binding)=>[binding.version_id,binding.pending_version_id])].filter((id):id is string=>typeof id==="string"&&Boolean(id)));
        await Promise.all([...requested].map(async(versionId)=>{
          const published=await fetch(`/api/workspaces/${encodeURIComponent(context.organizationId)}/context-packages/${encodeURIComponent(item.id)}/versions/${encodeURIComponent(versionId)}`,{credentials:"same-origin"});
          this.#assertAuthorizationScope(authorization);
          const detail=await published.json().catch(()=>null) as {versionId?:string;version?:number;snapshot?:Omit<OrganizationContextVersion,"id"|"version">}|null;
          this.#assertAuthorizationScope(authorization);
          if(published.ok&&detail?.versionId&&detail.snapshot)versions[detail.versionId]={...detail.snapshot,id:detail.versionId,version:Number(detail.version??0)};
        }));
        return bindings;
      }));
      this.#assertAuthorizationScope(authorization);
      this.organizationContextPackages.set(packages);
      this.organizationContextBindings.set(results.flat().map((row)=>({id:String(row.binding_id),organizationId:String(row.organization_id),projectAccessId:String(row.project_access_id),documentId:String(row.document_id),packageId:String(row.package_id),versionId:String(row.version_id),pendingVersionId:row.pending_version_id?String(row.pending_version_id):null,updateMode:row.update_mode==="follow-approved"?"follow-approved":"pinned",status:String(row.status)})));
      this.organizationContextVersions.set(versions);
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
        await this.syncOrganizationContextPackages();
        this.toast(this.#systemNotice("Awaiting approval"));
        return true;
      }
      if(!published.ok)throw new Error(result.error??"The organization context version could not be published.");
      await this.syncOrganizationContextPackages();
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
      if(session.projectContext?.organizationId===organizationId)await this.syncOrganizationContextPackages();
      this.toast(this.#systemNotice("Organization context version {version} was published. Following documents must explicitly accept the update.",{version:body.version??1}));
      return true;
    }catch(error){if(this.#scopeStillActive(authorization))this.toast(error instanceof Error?error.message:"Organization context could not be published.");return false;}
  }
  async adoptOrganizationContextPackage(packageId:string,versionId:string,mode:"pinned"|"follow-approved"="pinned"){const session=this.session.get(),context=session?.projectContext,projection=this.projection.get();if(!session||!context||!projection.documentId)return false;const authorization=this.#authorizationScope(session);try{const response=await this.guardedFetch(`/api/workspaces/${encodeURIComponent(context.organizationId)}/context-packages/${encodeURIComponent(packageId)}/adopt`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({projectAccessId:context.projectAccessId,documentId:projection.documentId,versionId,updateMode:mode,expectedProjectHead:this.head.get()})},"adopt this approved organization context into the current document");this.#assertAuthorizationScope(authorization);const body=await response.json() as {error?:string};this.#assertAuthorizationScope(authorization);if(!response.ok)throw new Error(body.error??"Organization context could not be added.");await this.#refreshEvents();await this.syncOrganizationContextPackages();this.toast(mode==="pinned"?"The approved context version is pinned to this document.":"Approved context was added. Future changes always require your acceptance.");return true;}catch(error){if(this.#scopeStillActive(authorization))this.toast(error instanceof Error?error.message:"Organization context could not be added.");return false;}}
  async acceptOrganizationContextPackageUpdate(packageId:string,bindingId:string,versionId:string){
    const session=this.session.get(),context=session?.projectContext;
    if(!session||!context||!packageId||!bindingId||!versionId)return false;
    const authorization=this.#authorizationScope(session);
    try{
      const response=await this.guardedFetch(`/api/workspaces/${encodeURIComponent(context.organizationId)}/context-packages/${encodeURIComponent(packageId)}/bindings/${encodeURIComponent(bindingId)}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({action:"accept",versionId,expectedProjectHead:this.head.get()})},"accept this exact published organization context update");
      this.#assertAuthorizationScope(authorization);
      const result=await response.json() as {error?:string;version?:number};
      this.#assertAuthorizationScope(authorization);
      if(!response.ok)throw new Error(result.error??"This organization context update could not be accepted.");
      await this.#refreshEvents();await this.syncOrganizationContextPackages();
      this.toast(this.#systemNotice("Published organization context version {version} was applied. Review any affected finished outputs again.",{version:result.version??""}));
      return true;
    }catch(error){if(this.#scopeStillActive(authorization))this.toast(error instanceof Error?error.message:"This organization context update could not be accepted.");return false;}
  }
  async setOrganizationContextPackageUpdateMode(packageId:string,bindingId:string,mode:"pinned"|"follow-approved"){
    const session=this.session.get(),context=session?.projectContext;if(!session||!context)return false;
    const authorization=this.#authorizationScope(session);
    try{
      const response=await this.guardedFetch(`/api/workspaces/${encodeURIComponent(context.organizationId)}/context-packages/${encodeURIComponent(packageId)}/bindings/${encodeURIComponent(bindingId)}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({action:"policy",updateMode:mode})},"change this document's context update policy");
      this.#assertAuthorizationScope(authorization);
      if(!response.ok)throw new Error("The context update policy could not be changed.");
      await this.syncOrganizationContextPackages();this.toast(mode==="pinned"?"This document is pinned to its current context version.":"Published context updates will be offered before anything changes.");return true;
    }catch(error){if(this.#scopeStillActive(authorization))this.toast(error instanceof Error?error.message:"The context update policy could not be changed.");return false;}
  }
  async openAssignedReview(task:AssignedReviewTask){const session=this.session.get();if(!session)return false;try{const response=await this.guardedFetch(`/api/workspaces/${encodeURIComponent(task.organizationId)}/projects/${encodeURIComponent(task.projectAccessId)}/context`,{method:"POST"},"open this assigned review in its exact authorized project");const body=await response.json() as {error?:string};if(!response.ok)throw new Error(body.error??"The assigned project is no longer available.");await this.refreshSession();this.setRoute(`/document/${encodeURIComponent(task.documentId)}/assigned-review`);await this.load();requestAnimationFrame(()=>{const artifacts=document.querySelector("forma-document-artifacts") as HTMLElement&{openArtifactById?:(id:string)=>Promise<unknown>};void artifacts?.openArtifactById?.(task.artifactId);});return true;}catch(error){this.toast(error instanceof Error?error.message:"The assigned review could not be opened.");return false;}}

  async leaveProjectContext(){
    if(!this.session.get()?.projectContext)return true;
    try{
      const response=await fetch("/api/workspaces/context",{method:"DELETE",credentials:"same-origin"});
      const body=await response.json() as {error?:string};
      if(!response.ok)throw new Error(body.error??"project_context_exit_failed");
      await this.refreshSession();
      this.patchUi({commandOpen:false,accountOpen:false,shareOpen:false,compareOpen:false});
      this.setRoute("/projects");
      await this.load();
      return true;
    }catch(error){this.toast(error instanceof Error?error.message:"The shared project could not be closed.");return false;}
  }

  async acceptTerms() {
    this.busy.set("consent"); this.notify();
    try {
      const response = await fetch("/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "accept_terms", ownershipConfirmed: true, providerProcessingConfirmed: true }) });
      const body = await response.json() as PilotSession & { error?: string }; if (!response.ok) throw new Error(body.error ?? "Consent could not be recorded");
      this.session.set(body); await this.load(); this.toast("Pilot terms accepted and witnessed in the event stream.");
    } catch (error) { this.toast(error instanceof Error ? error.message : "Consent failed"); }
    finally { this.busy.set(""); this.notify(); }
  }

  async append(event: EventInput, options: { expected?: number; remember?: boolean; rebaseAttempts?: number; silent?: boolean; background?: boolean } = {}) {
    return this.appendBatch([event], options);
  }

  /** Correct the durable deliverable itself without invoking a generation provider. */
  async reviseDocumentArtifact(artifactId:string,input:{markdown:string;items?:Array<{index:number;title?:string;body?:string;notes?:string}>;expectedRevision:number}){
    const authorization=this.#activeAuthorizationScope();
    const edit=async()=>{
      if(!this.#scopeStillActive(authorization))return false;
      this.busy.set("DocumentArtifactEdited");this.notify();
      try{
        const response=await this.guardedFetch(`/api/artifacts/${encodeURIComponent(artifactId)}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify(input)},"save a correction to this finished output");
        this.#assertAuthorizationScope(authorization);
        const result=await response.json() as {appended?:CreativeEvent[];content?:Record<string,string>;head?:number;error?:string;message?:string};
        this.#assertAuthorizationScope(authorization);
        if(!response.ok){if(response.status===409&&result.error==="artifact_revision_conflict")throw new Error("Another collaborator changed this output. Your unsaved correction is preserved; reopen the latest version before saving again.");throw new Error(result.message??result.error??"The finished output could not be saved.");}
        if(result.content)this.content.set({...this.content.get(),...result.content});
        this.#mergeConfirmed(result.appended??[],result.head??this.head.get());
        this.toast("Finished output updated. Request a fresh review before approval.");
        return true;
      }catch(error){if(this.#scopeStillActive(authorization))this.toast(error instanceof Error?error.message:"The finished output could not be saved.");return false;}
      finally{if(this.#scopeStillActive(authorization)){this.busy.set("");this.notify();}}
    };
    const pending=this.#appendPipeline.then(edit,edit);this.#appendPipeline=pending.then(()=>undefined,()=>undefined);return pending;
  }

  /** Revision bodies stay off the general content hydration path and follow the exact current authorization scope. */
  async artifactRevisions(artifactId:string,before?:number){
    const authorization=this.#activeAuthorizationScope();
    try{
      const response=await this.guardedFetch(`/api/artifacts/${encodeURIComponent(artifactId)}/revisions${before===undefined?"":`?before=${before}`}`,{},"inspect finished-output history");
      this.#assertAuthorizationScope(authorization);
      const result=await response.json() as {revisions?:ArtifactRevisionSummary[];currentRevision?:number;nextBefore?:number|null;error?:string};
      this.#assertAuthorizationScope(authorization);
      if(!response.ok)throw new Error(result.error??"The finished-output history could not be loaded.");
      return{revisions:result.revisions??[],currentRevision:Number(result.currentRevision??0),nextBefore:result.nextBefore??null};
    }catch(error){if(this.#scopeStillActive(authorization))this.toast(error instanceof Error?error.message:"The finished-output history could not be loaded.");return null;}
  }

  async artifactRevision(artifactId:string,revision:number){
    const authorization=this.#activeAuthorizationScope();
    try{
      const response=await this.guardedFetch(`/api/artifacts/${encodeURIComponent(artifactId)}/revisions/${revision}`,{},"inspect a finished-output revision");
      this.#assertAuthorizationScope(authorization);
      const result=await response.json() as ArtifactRevisionDetail&{error?:string};
      this.#assertAuthorizationScope(authorization);
      if(!response.ok)throw new Error(result.error??"This finished-output revision is unavailable.");
      return result;
    }catch(error){if(this.#scopeStillActive(authorization))this.toast(error instanceof Error?error.message:"This finished-output revision is unavailable.");return null;}
  }

  /** Restoration creates a fresh output revision; previous approval must be independently renewed. */
  async restoreDocumentArtifact(artifactId:string,revision:number,expectedRevision:number){
    const authorization=this.#activeAuthorizationScope();
    const restore=async()=>{
      if(!this.#scopeStillActive(authorization))return false;
      this.busy.set("DocumentArtifactEdited");this.notify();
      try{
        const response=await this.guardedFetch(`/api/artifacts/${encodeURIComponent(artifactId)}/revisions/${revision}/restore`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({expectedRevision})},"restore an earlier finished output");
        this.#assertAuthorizationScope(authorization);
        const result=await response.json() as {appended?:CreativeEvent[];content?:Record<string,string>;head?:number;error?:string;message?:string};
        this.#assertAuthorizationScope(authorization);
        if(!response.ok)throw new Error(result.error==="artifact_revision_conflict"?"Another collaborator changed this output. Reopen its latest history before restoring.":result.message??result.error??"The earlier finished output could not be restored.");
        if(result.content)this.content.set({...this.content.get(),...result.content});
        this.#mergeConfirmed(result.appended??[],result.head??this.head.get());
        this.toast("Earlier finished output restored. Request a fresh independent review.");
        return true;
      }catch(error){if(this.#scopeStillActive(authorization))this.toast(error instanceof Error?error.message:"The earlier finished output could not be restored.");return false;}
      finally{if(this.#scopeStillActive(authorization)){this.busy.set("");this.notify();}}
    };
    const pending=this.#appendPipeline.then(restore,restore);this.#appendPipeline=pending.then(()=>undefined,()=>undefined);return pending;
  }

  /** Every download is permitted only after its exact actor/resource release receipt commits. */
  async authorizeProjectExport(event:EventInput,expectedScope:CapturedAuthorizationScope|null=this.captureAuthorizationScope()){
    const session=this.session.get(),context=session?.projectContext;
    if(!session||!expectedScope||!this.authorizationScopeActive(expectedScope))return false;
    if(Boolean(context)!==expectedScope.shared)return false;
    const authorization=expectedScope.key,resource=String(event.payload.artifact_id??event.payload.object_id??"");
    if(!resource||!["DocumentArtifactExported","ObjectExported"].includes(event.type))return false;
    const receipts=await this.append(event,{remember:false,silent:true});
    if(!this.#scopeStillActive(authorization))return false;
    const accepted=receipts.some((receipt)=>receipt.type===event.type
      &&receipt.actor===(context?`user:${session.user.userId}`:"user")
      &&(!context||String(receipt.payload.project_id??"")===context.projectId)
      &&String(receipt.payload.artifact_id??receipt.payload.object_id??"")===resource);
    if(!accepted)this.toast("The download was canceled because your project access could not be confirmed.");
    return accepted;
  }

  async appendBatch(events: EventInput[], options: { expected?: number; remember?: boolean; rebaseAttempts?: number; silent?: boolean; background?: boolean } = {}) {
    const authorization=this.#activeAuthorizationScope(),pending=this.#appendPipeline.then(()=>this.#scopeStillActive(authorization)?this.#appendBatchNow(events,options,authorization):[]);this.#appendPipeline=pending.then(()=>undefined,()=>undefined);return pending;
  }

  async #appendBatchNow(events: EventInput[], options: { expected?: number; remember?: boolean; rebaseAttempts?: number; silent?: boolean; background?: boolean } = {},authorization=this.#activeAuthorizationScope()) {
    if(!this.#scopeStillActive(authorization))return[];
    if(!options.background)this.busy.set(events[0]?.type ?? "append"); this.appendFailure.set(""); this.notify();
    try {
      let response:Response;let body:{ appended?: CreativeEvent[]; rejected?: Array<{ index?: number; type?: string; reason: string }>; head?: number; error?: string }={};
      const attempts=options.expected===undefined?Math.max(1,Math.min(6,options.rebaseAttempts??2)):1;
      for(let attempt=0;attempt<attempts;attempt+=1){response=await this.guardedFetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: events.length > 1 ? "batch" : "append", event: events[0], events, expectedSequence: options.expected ?? this.head.get(), clientId: "web:lit" }) },events.length>1?`apply ${events.length} document changes`:`record ${events[0]?.type??"this change"}`);this.#assertAuthorizationScope(authorization);body=await response.json() as typeof body;this.#assertAuthorizationScope(authorization);if(response.status===409&&body.error==="stale_sequence"&&options.expected===undefined&&attempt<attempts-1){await this.#refreshEvents();this.#assertAuthorizationScope(authorization);continue;}if(response.status===409&&(body.error==="context_value_conflict"||body.error==="output_title_conflict")){await this.#refreshEvents();this.#assertAuthorizationScope(authorization);throw new Error(body.error==="output_title_conflict"?"Another collaborator renamed this result. Its latest name is now loaded; review it and try again.":"Another collaborator changed this exact decision. Your change was not saved; review the latest value and try again.");}if(!response.ok)throw new Error(body.error==="stale_sequence"?"The document changed elsewhere. Its latest state is now loaded; try that change again.":body.error??"Append rejected");break;}
      this.#assertAuthorizationScope(authorization);
      const appended = body.appended ?? [];
      this.events.set([...this.events.get(), ...appended]); this.head.set(body.head ?? this.head.get()); this.#publishAppended(appended);
      this.#reflectDocumentInRoute();
      if (options.remember !== false) { const actor=this.session.get()?.projectContext?`user:${this.session.get()?.user.userId}`:"user";const remembered=appended.filter((e) => e.actor === actor && !e.compensatesEventId && inverseEvent(e));if(remembered.length)this.#undo.push(remembered);this.#redo = []; }
      if (body.rejected?.length) {const reasons=[...new Set(body.rejected.map((item)=>`${item.type?`${item.type}: `:""}${item.reason}`))];this.appendFailure.set(reasons.join("; "));this.toast(documentViewFromRoute(this.route.get()) === "editor" ? body.rejected.length===1?this.#systemNotice("{count} change could not be saved; the other changes are safe.",{count:body.rejected.length}):this.#systemNotice("{count} changes could not be saved; the other changes are safe.",{count:body.rejected.length}) : body.rejected.length===1?this.#systemNotice("{count} event rejected; valid events still appended.",{count:body.rejected.length}):this.#systemNotice("{count} events rejected; valid events still appended.",{count:body.rejected.length}));}
      return appended;
    } catch (error) {const message=error instanceof Error?error.message:"Append failed";if(this.#scopeStillActive(authorization)){this.appendFailure.set(message);if(!options.silent)this.toast(message);}return[];}
    finally {if(this.#scopeStillActive(authorization)){if(!options.background)this.busy.set("");this.notify();}}
  }

  async copyLibraryBlockSet(rootBlockId:string,destinationDocumentId=this.projection.get().documentId,sourceSurface="library"){
    const projection=this.projection.get();const available=new Map(projection.libraryBlocks.filter((block)=>!block.removed&&block.projectId===projection.projectId).map((block)=>[block.id,block]));const root=available.get(rootBlockId);
    if(!root){this.toast("That reusable context is no longer available.");return null;}
    const connected=new Set([root.id]);let changed=true;while(changed){changed=false;for(const relation of projection.libraryBlockRelations){if(connected.has(relation.fromBlockId)&&available.has(relation.toBlockId)&&!connected.has(relation.toBlockId)){connected.add(relation.toBlockId);changed=true;}}}
    if([...connected].some((id)=>Boolean(available.get(id)?.properties.organization_context_package_binding_id))){this.toast("Organization context must be adopted through its approved package.");return null;}
    const blocks=[...connected].map((id)=>available.get(id)!).sort((left,right)=>left.id===root.id?-1:right.id===root.id?1:left.position.localeCompare(right.position));const ids=new Map(blocks.map((block)=>[block.id,crypto.randomUUID()]));const contextSetId=crypto.randomUUID();const base=this.head.get()+1;
    const normalized=projection.libraryBlockRelations.some((relation)=>relation.kind===CONTEXT_CONTAINS_RELATION&&connected.has(relation.fromBlockId)&&connected.has(relation.toBlockId));
    const legacyGroups=new Map<string,string>();for(const block of blocks)for(const membership of combinedContextMemberships(block.properties))if(!legacyGroups.has(membership.contextSetId))legacyGroups.set(membership.contextSetId,crypto.randomUUID());
    const groupRole=combinedContextRoleForBlockType(root.type),groupName=String(root.properties.label??root.properties.text??root.handle),groupRelativity=Math.max(.5,Math.min(1,Number(root.properties.weight??.8)));const events:EventInput[]=blocks.map((block,index)=>{const authoredMemberships=combinedContextMemberships(block.properties);return{type:"BlockCreated",payload:{block_id:ids.get(block.id),document_id:destinationDocumentId,type:block.type,handle:`${block.handle}-copy-${String(base+index).padStart(3,"0")}`,position:`z${String(base+index).padStart(6,"0")}`,properties:{...block.properties,...(block.type==="action"?{block_references:normalizeActionBlockReferences(block.properties.block_references).flatMap((reference)=>ids.has(reference.block_id)?[{...reference,block_id:ids.get(reference.block_id)!}]:[])}:{}),authority:"authored",copied_from_block_id:block.id,copied_as_context_set:blocks.length>1,context_set_id:normalized?null:contextSetId,context_set_root_id:ids.get(root.id),combined_context_memberships:authoredMemberships.length?authoredMemberships.map((membership)=>({...membership,contextSetId:normalized?legacyGroups.get(membership.contextSetId)??contextSetId:contextSetId,memberOrder:normalized?membership.memberOrder:index,sourceCanvasId:""})):blocks.length>1&&!normalized?[{contextSetId,name:groupName,role:groupRole,target:groupName,application:"isolate",relativity:groupRelativity,memberOrder:index,sourceCanvasId:""}]:[],semantic_isolation:blocks.length>1,created_from:sourceSurface}}};}).sort((left,right)=>Number(left.payload.type==="action")-Number(right.payload.type==="action"));
    for(const relation of projection.libraryBlockRelations){const from=ids.get(relation.fromBlockId);const to=ids.get(relation.toBlockId);if(!from||!to)continue;const{context_set_id:sourceContextId,...properties}=relation.properties;events.push({type:"BlockRelationAdded",payload:{relation_id:crypto.randomUUID(),project_id:projection.projectId,document_id:destinationDocumentId,from_block_id:from,to_block_id:to,kind:relation.kind,properties:{...properties,copied_from_relation_id:relation.id,...(normalized&&relation.kind===CONTEXT_CONTAINS_RELATION?{}:{context_set_id:normalized?legacyGroups.get(String(sourceContextId??""))??contextSetId:contextSetId})},source_surface:sourceSurface}});}
    const appended=await this.appendBatch(copyOutputRequirementCreationEvents(events,ids));if(!appended.length)return null;const copiedRootId=ids.get(root.id)!;this.patchUi({focusBlockId:copiedRootId});this.toast(blocks.length===1?"Reusable block added to the open document.":this.#systemNotice("{count} connected blocks added as one context set.",{count:blocks.length}));return{rootBlockId:copiedRootId,blockCount:blocks.length,relationCount:events.length-blocks.length};
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
    const root=this.projection.get().libraryBlocks.find((block)=>block.id===blockId);if(!root)return false;
    const events=this.outputInputEvents(blockId,draft,sourceSurface);
    if(!events.length){if(JSON.stringify(outputInputDraft(root))===JSON.stringify(draft)){this.toast("Your input is already up to date.");return true;}this.toast(root.locked?"Unlock this input before editing it.":"Unlock the related storyboard frame before saving these changes.");return false;}
    const appended=await this.appendBatch(events,{rebaseAttempts:6});if(appended.length)this.toast("Your customized input is saved. The original output remains unchanged.");return Boolean(appended.length);
  }

  outputInputEvents(blockId:string,draft:OutputInputDraft,sourceSurface="output-input-editor"){
    const root=this.projection.get().libraryBlocks.find((block)=>block.id===blockId);if(!root)return[];return outputInputEditEvents(root,this.#relatedOutputBlocks(blockId),draft,{sourceSurface});
  }

  async revealOutputInput(blockId:string,destinationDocumentId=this.projection.get().documentId){
    if(!blockId)return false;
    const projection=this.projection.get(),targetDocument=projection.documents.find((item)=>item.id===destinationDocumentId);if(!targetDocument)return false;
    if(!isDocumentViewRoute(this.route.get())||projection.documentId!==destinationDocumentId||documentViewFromRoute(this.route.get())!=="document"){
      const opened=await this.openDocument(destinationDocumentId,withDocumentInRoute("/",destinationDocumentId,targetDocument.title),"output-input");if(!opened)return false;
    }
    this.patchUi({focusBlockId:blockId,editingBlockId:blockId});
    let attempts=0;const focus=()=>{const block=document.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(blockId)}"]`),field=block?.querySelector<HTMLTextAreaElement>("forma-ui-rich-text textarea")??block?.querySelector<HTMLTextAreaElement>("textarea");if(field&&!document.querySelector("dialog[open]")){const reduced=window.matchMedia("(prefers-reduced-motion: reduce)").matches;block?.scrollIntoView({block:"center",behavior:reduced?"instant":"smooth"});field.focus({preventScroll:true});return;}if(attempts++<24)window.requestAnimationFrame(focus);};window.requestAnimationFrame(focus);return true;
  }

  async addArtifactAsContext(artifactId:string,destinationDocumentId=this.projection.get().documentId,sourceSurface="document-artifact-viewer",options:{reveal?:boolean;presentation?:SlidePresentation|null}={}){
    const projection=this.projection.get();const artifact=projection.libraryArtifacts.find((candidate)=>candidate.id===artifactId);
    if(!artifact){this.toast("That output is no longer available.");return null;}
    const document=projection.documents.find((candidate)=>candidate.id===destinationDocumentId);if(!document){this.toast("Choose an available document before adding output context.");return null;}
    const existingBlocks=projection.libraryBlocks.filter((block)=>block.documentId===destinationDocumentId&&block.properties.source_artifact_id===artifact.id);const existingRoot=existingBlocks.find((block)=>!block.properties.source_artifact_item_id);const ownedChildIds=new Set(projection.libraryBlockRelations.filter((relation)=>relation.kind==="artifact_contains"&&relation.fromBlockId===existingRoot?.id).map((relation)=>relation.toBlockId));const existingSourceItemIds=existingBlocks.filter((block)=>ownedChildIds.has(block.id)).map((block)=>String(block.properties.source_artifact_item_id??"")).filter(Boolean);const contextSetId=String(existingRoot?.properties.context_set_id??"")||undefined;
    const availableFrames=artifact.kind==="storyboard"?artifact.items.filter((item)=>Boolean(item.mediaUrl)).length:artifact.kind==="video"?artifact.items.filter((item)=>Boolean(item.mediaUrl)&&String(item.mediaType??"").startsWith("video/")).length:0;
    if(existingRoot&&existingSourceItemIds.length>=availableFrames){if(options.reveal!==false)await this.revealOutputInput(existingRoot.id,destinationDocumentId);return{rootBlockId:existingRoot.id,created:false,blockCount:0,availableMemberCount:1+availableFrames};}
    const retained=artifact.contentRef?await this.ensurePrivateContent(artifact.contentRef):null;let content=parseDocumentArtifactContent(retained??undefined);const existingDraft=existingRoot?outputInputDraft(existingRoot):null;if(content&&existingDraft)content={...content,title:existingDraft.title,summary:existingDraft.summary,content_markdown:existingDraft.markdown,items:existingDraft.items.map((item)=>({title:item.title,body:item.body,notes:item.notes,image_prompt:item.image_prompt,context_group_ids:item.context_group_ids,slide:item.slide??null}))};if(content&&artifact.kind==="slides"&&options.presentation)content={...content,presentation:structuredClone(options.presentation)};
    if(artifact.contentRef&&!content){this.toast("The complete original output is unavailable, so an incomplete copy was not created.");return null;}
    const result=artifactContextEvents(artifact,{documentId:destinationDocumentId,projectId:document.projectId,sourceSurface,content,existingRootBlockId:existingRoot?.id,existingSourceItemIds,contextSetId,positionStart:this.head.get()+1});
    if(!result.blockIds.length){if(existingRoot&&options.reveal!==false)await this.revealOutputInput(existingRoot.id,destinationDocumentId);return{rootBlockId:existingRoot?.id??"",created:false,blockCount:0,availableMemberCount:result.availableMemberCount};}
    const appended=await this.appendBatch(result.events,{rebaseAttempts:6});const created=appended.filter((event)=>event.type==="BlockCreated").length;if(!created)return null;
    const rootBlockId=existingRoot?.id??result.blockIds[0]??"";if(options.reveal!==false)await this.revealOutputInput(rootBlockId,destinationDocumentId);else this.patchUi({focusBlockId:rootBlockId});this.toast(artifact.kind==="storyboard"?this.#systemNotice("{title} is ready to customize, with its finished frames kept in order.",{title:artifact.title}):artifact.kind==="video"?this.#systemNotice("{title} is ready to customize, with its finished motion scenes kept in order.",{title:artifact.title}):this.#systemNotice("{title} is ready to customize.",{title:artifact.title}));return{rootBlockId,created:true,blockCount:created,availableMemberCount:result.availableMemberCount};
  }

  async addStoryboardFramesAsContext(artifactId:string,destinationDocumentId=this.projection.get().documentId,sourceSurface="document-artifact-viewer"){return this.addArtifactAsContext(artifactId,destinationDocumentId,sourceSurface);}

  async addImageOutputAsContext(outputId:string,destinationDocumentId=this.projection.get().documentId,sourceSurface="output-card",options:{reveal?:boolean;contextParentBlockId?:string;identityReference?:boolean}={}){
    const projection=this.projection.get();const output=projection.libraryOutputs.find((candidate)=>candidate.id===outputId);if(!output){this.toast("That generated image is no longer available.");return null;}
    const document=projection.documents.find((candidate)=>candidate.id===destinationDocumentId);if(!document){this.toast("Choose an available document before using this image as input.");return null;}
    const parent=options.contextParentBlockId?projection.libraryBlocks.find((block)=>block.id===options.contextParentBlockId&&block.documentId===destinationDocumentId):undefined;
    if(options.contextParentBlockId&&(!parent||parent.locked))return null;
    const existing=projection.libraryBlocks.find((block)=>block.documentId===destinationDocumentId&&block.properties.source_output_id===output.id);
    if(existing){
      if(parent&&!projection.libraryBlockRelations.some((relation)=>isContextCompositionRelation(relation.kind)&&relation.fromBlockId===parent.id&&relation.toBlockId===existing.id)){
        if(existing.locked)return null;
        const relation={type:"BlockRelationAdded",payload:{relation_id:crypto.randomUUID(),project_id:projection.projectId,document_id:destinationDocumentId,from_block_id:parent.id,to_block_id:existing.id,kind:CONTEXT_CONTAINS_RELATION,properties:{member_order:projection.libraryBlockRelations.filter((item)=>isContextCompositionRelation(item.kind)&&item.fromBlockId===parent.id).length,relation_label:"Identity reference",relativity:1},source_surface:sourceSurface}};
        const protection=options.identityReference?[{type:"BlockPropertyEdited",payload:{block_id:existing.id,property_path:"pixel_reference_mode",old_value:existing.properties.pixel_reference_mode??"context_only",new_value:"context_only",source_surface:sourceSurface}},{type:"BlockPropertyEdited",payload:{block_id:existing.id,property_path:"context_reference_kind",old_value:existing.properties.context_reference_kind??null,new_value:"character_identity",source_surface:sourceSurface}}]:[];
        if(!(await this.appendBatch([...protection,relation],{rebaseAttempts:6})).length)return null;
      }
      if(options.reveal!==false)await this.revealOutputInput(existing.id,destinationDocumentId);return{rootBlockId:existing.id,created:false,blockCount:0};
    }
    const retained=output.contentRef?await this.ensurePrivateContent(output.contentRef):null;let direction:Record<string,unknown>|null=null;if(retained)try{const parsed=JSON.parse(retained) as unknown;if(parsed&&typeof parsed==="object"&&!Array.isArray(parsed))direction=parsed as Record<string,unknown>;}catch{/* Existing image rights and pixels remain usable when optional direction is absent. */}
    const result=imageOutputContextEvents(output,{documentId:destinationDocumentId,projectId:document.projectId,sourceSurface,content:direction,positionStart:this.head.get()+1});if(!result.events.length){this.toast("The generated image has no durable media to use as input.");return null;}
    if(parent&&options.identityReference){const created=result.events.find((event)=>event.type==="BlockCreated");if(created){const properties=created.payload.properties as Record<string,unknown>;created.payload={...created.payload,properties:{...properties,pixel_reference_mode:"context_only",context_reference_kind:"character_identity",likeness_transfer_consent:false}};}}
    if(parent)result.events.push({type:"BlockRelationAdded",payload:{relation_id:crypto.randomUUID(),project_id:projection.projectId,document_id:destinationDocumentId,from_block_id:parent.id,to_block_id:result.blockIds[0],kind:CONTEXT_CONTAINS_RELATION,properties:{member_order:projection.libraryBlockRelations.filter((item)=>isContextCompositionRelation(item.kind)&&item.fromBlockId===parent.id).length,relation_label:options.identityReference?"Identity reference":"Reference",relativity:1},source_surface:sourceSurface}});
    const appended=await this.appendBatch(result.events,{rebaseAttempts:6});const created=appended.filter((event)=>event.type==="BlockCreated").length;if(!created)return null;const rootBlockId=result.blockIds[0]??"";if(options.reveal!==false)await this.revealOutputInput(rootBlockId,destinationDocumentId);else this.patchUi({focusBlockId:rootBlockId});this.toast("The generated image and its editable direction are ready to reuse.");return{rootBlockId,created:true,blockCount:created};
  }

  async hot(event: EventInput, options: { keepalive?: boolean } = {}) {
    if(this.session.get()?.impersonation)return;
    const authorization=this.#activeAuthorizationScope();
    try {
      if(!options.keepalive)await this.#appendPipeline;
      this.#assertAuthorizationScope(authorization);
      const response = await fetch("/api/events/hot", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "hot", event, events: [event], clientId: "web:lit" }), keepalive: options.keepalive });
      this.#assertAuthorizationScope(authorization);
      if (!response.ok) return;
      const body = await response.json() as { appended?: CreativeEvent[]; head?: number };
      this.#assertAuthorizationScope(authorization);
      const appended=body.appended??[];this.events.set([...this.events.get(), ...appended].sort((left,right)=>left.sequence-right.sequence)); this.head.set(Math.max(this.head.get(),body.head??0)); this.#publishAppended(appended);this.notify();
    } catch { /* Engagement instrumentation never blocks the creative action. */ }
  }

  async propose(prompt: string, events: EventInput[], exemplarRefs: Array<Record<string, unknown>> = []) {
    const authorization=this.#activeAuthorizationScope();
    this.busy.set("proposal"); this.notify();
    try {
      const response = await this.guardedFetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "propose", prompt, events, exemplarRefs, expectedSequence: this.head.get(), clientId: "web:lit" }) },"ask the assistant to propose document changes");
      this.#assertAuthorizationScope(authorization);
      if (!response.ok) throw new Error("Proposal could not be recorded");
      const body = await response.json() as { appended: CreativeEvent[]; head: number };
      this.#assertAuthorizationScope(authorization);
      this.events.set([...this.events.get(), ...body.appended]); this.head.set(body.head); this.toast("Proposal recorded — review it before applying.");
      return body.appended[0];
    } finally {if(this.#scopeStillActive(authorization)){this.busy.set("");this.notify();}}
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
    const projection=this.projection.get();const collectionId=projection.membership[projection.documentId]?.collectionId;const scopeId=scope==="document"?projection.documentId:scope==="collection"?collectionId:scope==="project"?projection.projectId:this.session.get()?.user.userId;
    if(!scopeId){this.toast("File this document in a collection before setting a folder preference.");return false;}
    const appended=await this.append({type:"PromptTechniquePreferred",payload:{preference_id:crypto.randomUUID(),preference_kind:"prompt_technique",technique:normalizePromptTechnique(technique),scope,scope_id:scopeId,document_id:projection.documentId,project_id:projection.projectId,source_fan_id:source.fanId??null,source_output_id:source.outputId??null}});
    if(appended.length)this.toast(this.#systemNotice("{technique} prompts preferred for this {scope}.",{technique:this.#systemNotice(normalizePromptTechnique(technique)),scope:this.#systemNotice(scope==="collection"?"folder":scope)}));return Boolean(appended.length);
  }

  async adoptCanvasOutputItems(items:readonly{sourceKind:string;sourceId:string}[],documentId:string,sourceSurface="canvas-generation"){
    const projection=this.projection.get();if(!projection.documents.some((document)=>document.id===documentId)){this.toast("Choose an available document before reusing the selected outputs.");return null;}
    const unique=new Map<string,{sourceKind:string;sourceId:string}>();for(const item of items)if(item.sourceKind==="output"||item.sourceKind==="artifact")unique.set(`${item.sourceKind}:${item.sourceId}`,item);
    for(const item of unique.values()){
      if(item.sourceKind==="output"){const output=projection.libraryOutputs.find((candidate)=>candidate.id===item.sourceId),existing=projection.libraryBlocks.find((block)=>block.documentId===documentId&&block.properties.source_output_id===item.sourceId);if(!output||!existing?.properties.media_url&&!output.mediaUrl){this.toast("A selected generated image is unavailable, so your document was left unchanged.");return null;}continue;}
      const artifact=projection.libraryArtifacts.find((candidate)=>candidate.id===item.sourceId);if(!artifact){this.toast("A selected output is unavailable, so your document was left unchanged.");return null;}
      const existingRoot=projection.libraryBlocks.find((block)=>block.documentId===documentId&&block.properties.source_artifact_id===artifact.id&&!block.properties.source_artifact_item_id);const ownedIds=new Set(projection.libraryBlockRelations.filter((relation)=>relation.kind==="artifact_contains"&&relation.fromBlockId===existingRoot?.id).map((relation)=>relation.toBlockId));const finished=new Set(artifact.items.filter((entry)=>Boolean(entry.mediaUrl)&&(artifact.kind!=="video"||String(entry.mediaType??"").startsWith("video/"))).map((entry)=>entry.id));const available=new Set(projection.libraryBlocks.filter((block)=>ownedIds.has(block.id)&&finished.has(String(block.properties.source_artifact_item_id??""))).map((block)=>String(block.properties.source_artifact_item_id)));if(existingRoot&&((artifact.kind!=="storyboard"&&artifact.kind!=="video")||available.size===finished.size))continue;
      if(artifact.contentRef&&!parseDocumentArtifactContent(await this.ensurePrivateContent(artifact.contentRef)??undefined)){this.toast(this.#systemNotice("{title} is unavailable, so your document was left unchanged.",{title:artifact.title}));return null;}
    }
    const rootIds:string[]=[];for(const item of unique.values()){const result=item.sourceKind==="output"?await this.addImageOutputAsContext(item.sourceId,documentId,`${sourceSurface}-output`,{reveal:false}):await this.addArtifactAsContext(item.sourceId,documentId,`${sourceSurface}-artifact`,{reveal:false});if(!result?.rootBlockId)return null;rootIds.push(result.rootBlockId);}
    return rootIds;
  }

  async generateCanvasContext(kind:"preview"|"generate"|"preview_fan"|"generate_fan",contextSet:CanvasContextSet,sourcePreviewId?:string,destinationDocumentId?:string){
    let projection=this.projection.get();const canvas=this.canvasProjection.get();const itemIds=new Set(contextSet.itemIds);const visitedSets=new Set<string>();const expandSet=(setId:string)=>{if(visitedSets.has(setId))return;visitedSets.add(setId);const nested=canvas.contextSets.find((candidate)=>candidate.id===setId);if(!nested)return;for(const itemId of nested.itemIds){itemIds.add(itemId);const item=canvas.items.find((candidate)=>candidate.id===itemId);if(item?.sourceKind==="context")expandSet(item.sourceId);}};for(const itemId of [...itemIds]){const item=canvas.items.find((candidate)=>candidate.id===itemId);if(item?.sourceKind==="context")expandSet(item.sourceId);}const selectedItems=canvas.items.filter((item)=>itemIds.has(item.id)&&item.sourceKind!=="context");
    const selectedDocumentIds=selectedItems.filter((item)=>item.sourceKind==="document").map((item)=>item.sourceId);const anchorDocumentId=destinationDocumentId??this.canvasPlanningDocumentId();if(!anchorDocumentId||!projection.documents.some((document)=>document.id===anchorDocumentId&&document.projectId===canvas.projectId)||contextSet.canvasId!==canvas.selectedCanvasId){this.toast(currentFormaLocale().messages["next.exact.chooseDocument"]??"Choose a document");return false;}
    const blockIds=new Set(contextSet.blockIds);for(const nestedId of visitedSets){const nested=canvas.contextSets.find((candidate)=>candidate.id===nestedId);for(const blockId of nested?.blockIds??[])blockIds.add(blockId);}
    const roots=await this.adoptCanvasOutputItems(selectedItems,anchorDocumentId);if(!roots)return false;projection=this.projection.get();for(const rootId of roots)blockIds.add(rootId);
    for(const documentId of [...contextSet.documentIds,...selectedDocumentIds])for(const block of projection.libraryBlocks)if(block.documentId===documentId)blockIds.add(block.id);
    let expanded=true;while(expanded){expanded=false;for(const relation of projection.libraryBlockRelations)if((relation.kind==="artifact_contains"||isContextCompositionRelation(relation.kind))&&blockIds.has(relation.fromBlockId)&&!blockIds.has(relation.toBlockId)){blockIds.add(relation.toBlockId);expanded=true;}}
    const blocks=projection.libraryBlocks.filter((block)=>blockIds.has(block.id));const selectedBySource=new Map(selectedItems.map((item)=>[item.sourceId,item]));
    const factBlocks=blocks.filter((block)=>!isOutputContextBlock(block));const factBlockIds=new Set(factBlocks.map((block)=>block.id));
    const facts=factBlocks.map((block)=>{const item=selectedBySource.get(block.id)??selectedBySource.get(String(block.properties.source_output_id??block.properties.source_artifact_id??""));return{block_id:block.id,canvas_id:contextSet.canvasId,context_set_id:contextSet.id,type:block.type,role:block.type,intent:blockIntentFor(block.type,block.properties),handle:block.handle,active:Number(block.properties.weight??.5)>0,effect:blockEffectFor(block.type,block.properties),properties:{...block.properties,spatial_scope:normalizeSpatialScope(block.properties.spatial_scope)},authority:block.properties.authority??"authored",source_event_refs:[...block.sourceEvents,...(item?.sourceEvents??[])]};});const relationships=projection.libraryBlockRelations.filter((relation)=>factBlockIds.has(relation.fromBlockId)&&factBlockIds.has(relation.toBlockId)).map((relation)=>({relation_id:relation.id,from_block_id:relation.fromBlockId,to_block_id:relation.toBlockId,kind:relation.kind,properties:relation.properties,source_event_refs:relation.sourceEvents}));const snapshot={facts,relationships,context_groups:combinedContextGroups({facts,relationships}),pins:[...new Set([...contextSet.outputIds,...selectedItems.filter((item)=>item.sourceKind==="output").map((item)=>item.sourceId),...projection.libraryOutputs.filter((output)=>output.canvasId===contextSet.canvasId&&output.pinned).map((output)=>output.id)])],canvas:{canvas_id:contextSet.canvasId,context_set_id:contextSet.id,item_ids:contextSet.itemIds,formalized_as_of_sequence:contextSet.asOfSequence,spatial_arrangement_is_semantic:false,arrangement_is_context:false,provenance_frames:selectedItems.map((item)=>({item_id:item.id,source_kind:item.sourceKind,source_id:item.sourceId,frame:{x:item.x,y:item.y,w:item.w,h:item.h,rotation:item.rot,z:item.z}}))},tail:[]};
    const context={snapshot,sourceBlockVersions:blocks.map((block)=>({block_id:block.id,version:block.sourceEvents.length})),documentId:anchorDocumentId,canvasId:contextSet.canvasId,contextSetId:contextSet.id};const documentRevision=generationRevisionFor(context);const filed=projection.membership[anchorDocumentId];const technique=effectivePromptPreference(projection.preferences,{documentId:anchorDocumentId,collectionIds:filed?[filed.collectionId]:[],projectId:projection.projectId,accountId:this.session.get()?.user.userId}).technique;const fan=kind.endsWith("_fan");const fanKind=kind.startsWith("preview")?"preview":"generate";const jobKind:"preview"|"generate"|"prompt_fan"=fan?"prompt_fan":fanKind;const promptFanId=fan?crypto.randomUUID():undefined;const requestKey=fan?`canvas:prompt-fan:${fanKind}:${contextSet.id}:${documentRevision}:${sourcePreviewId??"context"}`:`canvas:${kind}:${contextSet.id}:${documentRevision}:${sourcePreviewId??"context"}`;
    try{const {reused}=await this.#startDocumentJob(jobKind,{...context,documentRevision,requestKey,promptTechnique:technique,sourcePreviewId,...(fan?{fanKind,promptFanId}:{})},"canvas",anchorDocumentId);const quality=fanKind==="preview"?"Draft":"Full-quality";this.toast(reused?"This exact Canvas generation is already queued.":fan?this.#systemNotice("{quality} fan queued as one four-image comparison for {name}.",{quality:this.#systemNotice(quality),name:contextSet.name}):this.#systemNotice("{quality} Canvas generation queued from {name}.",{quality:this.#systemNotice(quality),name:contextSet.name}));return true;}catch(error){this.toast(error instanceof Error?error.message:"Canvas generation could not be started.");return false;}
  }

  async promotePromptFanOutputs(promptFanId:string,outputIds:string[]){
    const projection=this.projection.get();const requested=new Set(outputIds);const outputs=projection.outputs.filter((output)=>output.promptFanId===promptFanId&&requested.has(output.id)&&!output.standalone);
    if(!outputs.length){this.toast("Those fan results already stand on their own.");return false;}
    const appended=await this.appendBatch(outputs.map((output)=>({type:"PromptFanOutputPromoted",payload:{object_id:output.id,prompt_fan_id:promptFanId,prompt_technique:output.promptTechnique,document_id:projection.documentId,project_id:projection.projectId,source_surface:"prompt-fan-comparison"}})));
    if(appended.length)this.toast(appended.length===1?this.#systemNotice("{count} fan result now stands alone in the generation history.",{count:appended.length}):this.#systemNotice("{count} fan results now stand alone in the generation history.",{count:appended.length}));return Boolean(appended.length);
  }

  async chat(message:string,livePreview=true,locale=document.documentElement.lang||"en") {
    try{
      const documentId=this.projection.get().documentId;await this.#startDocumentJob("chat",{message,livePreview,documentId,locale,promptTechnique:this.promptTechniquePreference().technique},"chat");return true;
    }catch(error){this.toast(error instanceof Error?error.message:"Forma could not respond");return false;}
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
  async #requestPlanningConsent(action:"quote"|"resume"|ContextConsentAction){
    const state=this.planningConsent.get(),authorization=this.#planningConsentScope,selectionLocaleRevision=this.#planningLocaleRevision;
    if(!state||state.working||!this.#scopeStillActive(authorization)||action==="resume"&&!state.recoveryExecutionId||action!=="quote"&&action!=="resume"&&!state.quote)return;
    const replacing=action==="quote"&&Boolean(state.replaceExecutionId)&&state.quote?.status==="completed";
    const trackedId=state.recoveryExecutionId??state.replaceExecutionId??state.quote?.executionId;
    if(trackedId)this.#rememberPlanningRecovery({jobId:trackedId,kind:"structure_adaptive",planningExecutionId:trackedId,documentId:state.request.documentId,canvasId:state.request.canvasId,sourceSurface:state.request.sourceSurface,requestKey:state.request.requestKey,planningLocale:state.request.locale,planningProjectScope:state.request.projectScope},state.submitted||Boolean(state.recoveryExecutionId)||state.quote?.status!=="quoted");
    const tracked=trackedId?this.#planningRecoveryIdentities.get(trackedId):undefined;
    const startedReadAt=++this.#planningRecoverySequence;
    if(tracked){tracked.revision=startedReadAt;tracked.deliberateReadRevision=startedReadAt;tracked.pendingReadRevision=startedReadAt;delete tracked.preservedReadRevision;delete tracked.terminalReadRevision;
      // This grants presentation eligibility only to the exact approved ID,
      // not access proof, dismissal reversal, or a same-intent unknown winner.
      if(state.request.sourceSurface==="canvas"&&this.#planningConsentResolve&&(action==="execute"||action==="retrieve"))tracked.presentationLocaleRevision=selectionLocaleRevision;
    }
    const readRevision=tracked?.revision??0;
    const privateWithdrawn=()=>trackedId&&(this.#planningRecoveryIdentities.get(trackedId)?.withdrawalRevision??0)>startedReadAt;
    const retainedQuote=()=>this.planningConsent.get()?.quote??(privateWithdrawn()?null:state.quote);
    const failureFor=(quote:AvailableConsequentialPreview|null,outcome:Parameters<typeof contextConsentFailure>[1])=>{
      const result=contextConsentFailure(quote,outcome),id=quote?.executionId??trackedId;
      const job=id?this.documentJobs.get().find(item=>item.jobId===id)??this.#jobDetails.get(id):undefined;
      const budget=planningStopBudget(job?.result);
      // An uncertain network/execution status does not reopen a reservation
      // whose current original receipt already proves settlement or release.
      return result.notice==="uncertain"&&job&&adaptiveJobMatchesRequest(job,state.request)&&documentJobHasNoBudgetHold(budget)?{...result,notice:"failed" as const}:result;
    };
    const update=(patch:Partial<PlanningConsentState>)=>{const current=this.planningConsent.get();if(current?.id!==state.id||!this.#scopeStillActive(authorization))return false;this.planningConsent.set({...current,...patch});this.notify();return true;};
    update({working:true,notice:"",submitted:state.submitted||action==="execute",readRevision:startedReadAt});
    try{
      const response=await this.guardedFetch("/api/document-jobs/adaptive",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...state.request,action,...(action==="resume"?{executionId:state.recoveryExecutionId}:action!=="quote"?{executionId:state.quote!.executionId,approvedBindingHash:state.quote!.bindingHash}:state.replaceExecutionId?{replaceExecutionId:state.replaceExecutionId}:{})})},this.#systemNotice("Review this exact planning request"));
      if(!this.#scopeStillActive(authorization))return;
      if((action==="resume"||action==="retrieve")&&trackedId&&!response.ok&&[401,403,404,410].includes(response.status)){
        this.#withdrawAdaptiveRead(trackedId,startedReadAt);
        return;
      }
      const body=await response.json() as {quote?:AvailableConsequentialPreview;planningRequest?:PlanningConsentRequest;job?:DocumentJob;status?:string;submission?:string;providerAvailable?:boolean;error?:string;executionId?:string;bindingHash?:string;sourceHash?:string;requestKey?:string;reused?:boolean;requestedExecutionId?:string;reusedExecutionId?:string};
      if(!this.#scopeStillActive(authorization))return;
      const requestedId=action==="resume"?state.recoveryExecutionId:state.quote?.executionId;
      const unavailable=!response.ok&&["adaptive_existing_request_unavailable","adaptive_result_unavailable","adaptive_execution_unavailable","adaptive_consent_unavailable","adaptive_read_scope_denied","adaptive_read_authorization_changed"].includes(body.error??"");
      const returnedId=body.quote?.executionId??body.job?.planningExecutionId??(unavailable?requestedId:undefined);
      if(body.quote&&(body.quote.projectId!==state.request.projectId||body.quote.documentId!==state.request.documentId||(body.quote.canvasId??null)!==state.request.canvasId||action!=="quote"&&body.quote.executionId!==requestedId&&(body.requestedExecutionId!==requestedId||body.reusedExecutionId!==body.quote.executionId)))throw new Error("planning_result_identity_changed");
      const original=body.planningRequest;
      if(original&&(original.projectId!==state.request.projectId||original.documentId!==state.request.documentId||(original.canvasId??null)!==state.request.canvasId||original.sourceSurface!==state.request.sourceSurface||original.requestKey!==state.request.requestKey||original.projectScope!==state.request.projectScope||original.locale!==state.request.locale||typeof original.prompt!=="string"||!original.prompt.trim()||original.prompt.length>2_000))throw new Error("planning_result_identity_changed");
      if(original&&await adaptiveRequestKey(original)!==original.requestKey)throw new Error("planning_result_identity_changed");
      if(!this.#scopeStillActive(authorization))return;
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
      if(this.planningConsent.get()?.id!==state.id)return;
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
      const currentWinner=returnedId?this.documentJobs.get().find(job=>job.jobId===returnedId)??this.#jobDetails.get(returnedId):undefined;
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
      if(exactRetainedReceipt){this.#jobDetails.set(job.jobId,job);const proof=this.#planningRecoveryIdentities.get(job.jobId);if(proof)proof.detailRevision=proof.revision;this.#trimDocumentJobDetails();}
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
      const finished=trackedId?this.#planningRecoveryIdentities.get(trackedId):undefined;if(finished?.pendingReadRevision===startedReadAt){delete finished.pendingReadRevision;delete finished.preservedReadRevision;}
    }
  }

  async renderDocumentArtifact(kind:DocumentArtifactKind,options:{documentId?:string;itemCount?:number;audience?:string;tone?:string;sceneMedium?:SceneMedium;videoSeconds?:VideoDurationSeconds;videoSize?:"1280x720"|"720x1280";videoAudioMode?:VideoAudioMode;soundtrackBlockIds?:string[];sendSoundtrackToVideoProvider?:boolean;audioImageBlockId?:string;audioProfile?:AudioRequestProfile;audioProviderModel?:string;audioVideoArtifactId?:string;sendAudioVideoToProvider?:boolean;productionMode?:ProductionMode;paidMediaConfirmed?:boolean;sourceSurface?:string;locale?:string;presentationStyle?:SlideStylePresetId;presentationFidelity?:"faithful"|"creative";requestedSlideCount?:number;slideCountPolicy?:SlideCountPolicy;authoredSlideCount?:number;workflowId?:string;workflowStageId?:string;workflowSources?:ProductionWorkflowSource[];sceneRequestId?:string;sceneCostConsent?:SceneCostApproval;current?:()=>boolean;onDispatch?:()=>void;onResult?:(result:SceneSubmissionResult)=>void}={}){
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
    const documentId=options.documentId??this.projection.get().documentId;const context=this.#generationContext(documentId);const locale=options.locale??(typeof document==="undefined"?"en":document.documentElement.lang||"en");const audience=options.audience?.trim()||undefined,tone=options.tone?.trim()||undefined;const soundtrackBlockIds=[...new Set((options.soundtrackBlockIds??[]).map(String).filter(Boolean))];const slideSettings=kind==="slides"?{presentationStyle:options.presentationStyle,presentationFidelity:options.presentationFidelity,requestedSlideCount,...(options.slideCountPolicy?{slideCountPolicy:options.slideCountPolicy}:{}),authoredSlideCount:options.authoredSlideCount}:{};const presentationIdentity=kind==="slides"?`${options.presentationStyle===undefined?"":`:style:${encodeURIComponent(options.presentationStyle)}`}${options.presentationFidelity===undefined?"":`:fidelity:${encodeURIComponent(options.presentationFidelity)}`}${requestedSlideCount===undefined?"":`:slides:${requestedSlideCount}`}${options.slideCountPolicy?`:policy:${generationRevisionFor(options.slideCountPolicy)}`:""}`:"";const audioIdentity=soundtrackBlockIds.length||options.sendSoundtrackToVideoProvider===true||options.audioImageBlockId||options.audioProfile||options.audioProviderModel||options.audioVideoArtifactId||options.sendAudioVideoToProvider===true?`:audio:${generationRevisionFor({soundtrackBlockIds,sendSoundtrackToVideoProvider:options.sendSoundtrackToVideoProvider===true,audioImageBlockId:options.audioImageBlockId??null,...(options.audioProfile?{audioProfile:options.audioProfile}:{}),...(options.audioProviderModel?{audioProviderModel:options.audioProviderModel}:{}),...(options.audioVideoArtifactId?{audioVideoArtifactId:options.audioVideoArtifactId}:{}),...(options.sendAudioVideoToProvider===true?{sendAudioVideoToProvider:true}:{})})}`:"";const workflow=options.workflowId&&options.workflowStageId?{workflowId:options.workflowId,workflowStageId:options.workflowStageId,workflowSources:options.workflowSources??[]}:null;const workflowIdentity=workflow?`:workflow:${generationRevisionFor({workflowId:workflow.workflowId,workflowStageId:workflow.workflowStageId,sources:productionWorkflowSourceIdentity(workflow.workflowSources)})}`:"";const requestKey=`render:${kind}:${productionMode}:${context.documentRevision}:${itemCount??"default"}:${options.videoSeconds??"none"}:${options.videoSize??"none"}:${options.videoAudioMode??"silent"}:${encodeURIComponent(audience?.toLowerCase()??"general")}:${encodeURIComponent(tone?.toLowerCase()??"document-derived")}:${encodeURIComponent(locale.toLowerCase())}${presentationIdentity}${audioIdentity}${workflowIdentity}`;
    try{const {reused}=await this.#startDocumentJob("render_document",{...context,requestKey,locale,artifactKind:kind,itemCount,audience,tone,videoSeconds:options.videoSeconds,videoSize:options.videoSize,videoAudioMode:options.videoAudioMode,...(soundtrackBlockIds.length?{soundtrackBlockIds}:{}),...(options.sendSoundtrackToVideoProvider===true?{sendSoundtrackToVideoProvider:true}:{}),...(options.audioImageBlockId?{audioImageBlockId:options.audioImageBlockId}:{}),...(options.audioProfile?{audioProfile:options.audioProfile}:{}),...(options.audioProviderModel?{audioProviderModel:options.audioProviderModel}:{}),...(options.audioVideoArtifactId?{audioVideoArtifactId:options.audioVideoArtifactId}:{}),...(options.sendAudioVideoToProvider===true?{sendAudioVideoToProvider:true}:{}),...(workflow??{}),productionMode,paidMediaConfirmed:options.paidMediaConfirmed===true,...slideSettings},options.sourceSurface??"document",documentId);this.toast(reused?this.#systemNotice("This exact {kind} is already in progress.",{kind:this.#systemNotice(kind.replaceAll("_"," "))}):productionMode==="managed"?this.#systemNotice("Your {team} team is working on the complete document.",{team:this.#systemNotice(kind==="video"?"film production":kind==="slides"?"presentation editorial":kind==="storyboard"?"previsualization":kind==="audio"?"audio":"writing")}):this.#systemNotice("{kind} queued. You can keep working while it is prepared.",{kind:this.#systemNotice(kind.replaceAll("_"," "))}));return true;}catch(error){this.toast(error instanceof Error?error.message:this.#systemNotice("The {kind} could not be started.",{kind:this.#systemNotice(kind.replaceAll("_"," "))}));return false;}
  }

  async openProject(projectId:string,destination="/") {
    const projection=this.projection.get();if(!projectId||projectId===projection.projectId){this.setRoute(destination);return true;}
    const target=projection.projects.find((project)=>project.id===projectId);if(!target){this.toast("That project is no longer available.");return false;}
    const previousRoute=this.route.get(),clientEventId=crypto.randomUUID(),now=new Date().toISOString();
    const canvasDestination=destination==="/canvas"||destination.startsWith("/canvas/");
    const input:EventInput={type:"ProjectOpened",payload:{project_id:projectId,previous_project_id:projection.projectId,source_surface:canvasDestination?"canvas-projects":"projects",client_event_id:clientEventId}};
    const optimistic:CreativeEvent={eventId:`optimistic:${clientEventId}`,streamId:"optimistic:project",sequence:this.head.get()+1,occurredAt:now,recordedAt:now,actor:"user",clientId:"web:project-optimistic",correlationId:clientEventId,causationId:null,compensatesEventId:null,schemaVersion:1,type:input.type,payload:input.payload};
    this.optimisticEvents.set([...this.optimisticEvents.get(),optimistic]);
    this.patchUi({focusBlockId:"",focusCollectionId:"",selectedOutputId:"",compareOpen:false});const persisted=this.append(input,{rebaseAttempts:6,silent:true,background:true});const committed=persisted.then((events)=>events.length>0,()=>false);this.#navigationCommit=committed;this.setRoute(destination);
    const appended=await persisted;if(this.#navigationCommit===committed)this.#navigationCommit=null;
    this.optimisticEvents.set(this.optimisticEvents.get().filter((event)=>event.eventId!==optimistic.eventId));
    if(!appended.length){this.setRoute(previousRoute,{replace:true});this.toast("That project could not be opened. Your current workspace was restored.");return false;}
    this.notify();this.toast(this.#systemNotice("{name} opened in {workspace}.",{name:target.name,workspace:this.#systemNotice(canvasDestination?"Canvas":"Creator Workspace")}));return true;
  }

  async openDocument(documentId: string, destination="/", sourceSurface?: string, options:Pick<WorkspaceNavigationOptions,"current"|"focus">={}) {
    if(!workspaceNavigationCurrent(options))return false;
    const projection=this.projection.get();const target=projection.documents.find((document)=>document.id===documentId);const routedDestination = withDocumentInRoute(destination, documentId, target?.title ?? "");
    if(!documentId||documentId===projection.documentId){this.setRoute(routedDestination,options);return true;}
    if(!target){this.toast("That document is no longer available.");return false;}
    if(this.session.get()?.projectContext){this.patchUi({focusBlockId:"",selectedOutputId:"",compareOpen:false});this.setRoute(routedDestination,options);return true;}
    const previousDocumentId=projection.documentId;this.patchUi({focusBlockId:"",selectedOutputId:"",compareOpen:false});
    const persisted=this.append({type:"DocumentOpened",payload:{document_id:documentId,previous_document_id:previousDocumentId,source_surface:sourceSurface??(documentViewFromRoute(destination)==="document"?"studio":"studio-alternative")}},{rebaseAttempts:6,silent:true,background:true});const committed=persisted.then((events)=>events.length>0,()=>false);this.#navigationCommit=committed;this.setRoute(routedDestination,options);
    const appended=await persisted;if(this.#navigationCommit===committed)this.#navigationCommit=null;
    if(appended.length)this.toast("Document opened.");return true;
  }

  async removeDocument(documentId: string) {
    const projection=this.projection.get();const target=projection.documents.find((document)=>document.id===documentId);if(!target){this.toast("That document is no longer available.");return[];}if(projection.documents.length<=1){this.toast("Create another document before removing the project’s final document.");return[];}
    const fallback=projection.documents.find((document)=>document.id!==documentId)!;const wasCurrent=documentId===projection.documentId;
    const appended=await this.append({type:"DocumentRemoved",payload:{document_id:documentId,title:target.title,was_current:wasCurrent,previous_document_id:projection.documentId,fallback_document_id:fallback.id,reason:"removed-by-user"}});
    if(appended.length){this.patchUi({focusBlockId:"",selectedOutputId:"",compareOpen:false});if(wasCurrent&&isDocumentViewRoute(this.route.get()))this.setRoute(withDocumentInRoute(this.route.get(),this.projection.get().documentId,this.projection.get().documentTitle),{replace:true});this.toast(wasCurrent?this.#systemNotice("{title} was removed. {fallback} is now open.",{title:target.title,fallback:fallback.title}):this.#systemNotice("{title} was removed. Undo can restore it.",{title:target.title}));}return appended;
  }

  async evaluateExtractors() {
    const authorization=this.#activeAuthorizationScope();
    this.busy.set("extractor-eval"); this.notify();
    try {
      const response = await this.guardedFetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "evaluate_extractors", expectedSequence: this.head.get(), clientId: "web:system" }) },"run reference extraction");
      this.#assertAuthorizationScope(authorization);
      const body = await response.json() as { appended?: CreativeEvent[]; head?: number; error?: string };
      this.#assertAuthorizationScope(authorization);
      if (!response.ok) throw new Error(body.error === "admin_required" ? "An admin must witness the quality-gate rerun." : body.error ?? "Extractor evaluation failed");
      this.events.set([...this.events.get(), ...(body.appended ?? [])]); this.head.set(body.head ?? this.head.get()); this.toast("Extractor gate passed and the result was appended to the event stream.");
    } catch (error) {if(this.#scopeStillActive(authorization))this.toast(error instanceof Error ? error.message : "Extractor evaluation failed");}
    finally {if(this.#scopeStillActive(authorization)){this.busy.set("");this.notify();}}
  }

  async rebuildIndex() {
    const authorization=this.#activeAuthorizationScope();
    this.busy.set("phase7-index"); this.notify();
    try {
      const response = await this.guardedFetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "rebuild_index", expectedSequence: this.head.get(), clientId: "web:library" }) },"rebuild the fictional account’s library index");
      this.#assertAuthorizationScope(authorization);
      const body = await response.json() as { appended?: CreativeEvent[]; head?: number; error?: string; report?: { indexedItems?: number; exemplars?: number; families?: number } };
      this.#assertAuthorizationScope(authorization);
      if (!response.ok) throw new Error(body.error === "admin_required" ? "An admin must run the derived index." : body.error ?? "Index rebuild failed");
      this.events.set([...this.events.get(), ...(body.appended ?? [])]); this.head.set(body.head ?? this.head.get());
      this.toast(body.appended?.length ? this.#systemNotice("Indexed {objects} objects, {exemplars} exemplars, and {families} families.",{objects:body.report?.indexedItems??0,exemplars:body.report?.exemplars??0,families:body.report?.families??0}) : "The Phase 7 index is already fresh.");
    } catch (error) {if(this.#scopeStillActive(authorization))this.toast(error instanceof Error ? error.message : "Index rebuild failed");}
    finally {if(this.#scopeStillActive(authorization)){this.busy.set("");this.notify();}}
  }

  async extractReference(blockId: string, referenceId: string, sample: ImageSample, findingKinds: ReferenceFindingKind[] = []) {
    try {
      await this.#startDocumentJob("extract_reference",{blockId,referenceId,sample,findingKinds,documentId:this.projection.get().documentId},"reference");this.toast("Reference analysis started and will finish in the background.");
    } catch (error) { this.toast(error instanceof Error ? error.message : "Reference extraction failed"); }
  }

  async calculateImageFocalPoint(input:{targetKind:"generation"|"reference"|"artifact";targetId:string;mediaUrl:string;referenceId?:string;sample?:ImageSample}){
    const authorization=this.#activeAuthorizationScope(),key=`${input.targetKind}:${input.targetId}:${input.mediaUrl}`;if(!input.mediaUrl||this.#focalInFlight.has(key)||this.#hasFocalPoint(input.targetKind,input.targetId))return null;this.#focalInFlight.add(key);
    try{
      const sample=input.sample??(await resolveImageFocalAnalysis(input.mediaUrl)).sample;
      this.#assertAuthorizationScope(authorization);
      let resolved:unknown=null;
      const append=async()=>{this.#assertAuthorizationScope(authorization);if(this.#hasFocalPoint(input.targetKind,input.targetId))return;const response=await this.guardedFetch("/api/events",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"calculate_focal_point",clientId:"web:focal-extractor",targetKind:input.targetKind,targetId:input.targetId,referenceId:input.referenceId,mediaUrl:input.mediaUrl,sample})},"calculate and save this image’s focal point");this.#assertAuthorizationScope(authorization);const body=await response.json() as {appended?:CreativeEvent[];head?:number;focalPoint?:unknown;error?:string};this.#assertAuthorizationScope(authorization);if(!response.ok)throw new Error(body.error??"focal_point_calculation_failed");const appended=body.appended??[];if(appended.length){this.events.set([...this.events.get(),...appended]);this.head.set(body.head??this.head.get());this.#publishAppended(appended);this.notify();}resolved=body.focalPoint??null;};
      const task=this.#focalAppendQueue.then(append);this.#focalAppendQueue=task.catch(()=>{});await task;this.#assertAuthorizationScope(authorization);return normalizeImageFocalPoint(resolved);
    }catch{return null;}finally{if(this.#scopeStillActive(authorization))this.#focalInFlight.delete(key);}
  }

  async closeSession() {
    const authorization=this.#activeAuthorizationScope();
    this.busy.set("close-session"); this.notify();
    try {
      const response = await this.guardedFetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "close_session", expectedSequence: this.head.get(), clientId: "web:sessions" }) },"close this fictional work session");
      this.#assertAuthorizationScope(authorization);
      const body = await response.json() as { appended?: CreativeEvent[]; head?: number; error?: string; eligibility?: { closedSessions?: number; requiredClosedSessions?: number } };
      this.#assertAuthorizationScope(authorization);
      if (!response.ok) throw new Error(body.error === "no_open_session" ? "Open a session before closing it." : body.error ?? "Session could not be closed");
      this.events.set([...this.events.get(), ...(body.appended ?? [])]); this.head.set(body.head ?? this.head.get()); this.toast(this.#systemNotice("Session closed with a state receipt · {closed}/{required} toward brief eligibility.",{closed:body.eligibility?.closedSessions??0,required:body.eligibility?.requiredClosedSessions??3}));
    } catch (error) {if(this.#scopeStillActive(authorization))this.toast(error instanceof Error ? error.message : "Session could not be closed");}
    finally {if(this.#scopeStillActive(authorization)){this.busy.set("");this.notify();}}
  }

  async openSession() {
    const authorization=this.#activeAuthorizationScope();
    this.busy.set("open-session"); this.notify();
    try {
      const response = await this.guardedFetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "open_session", expectedSequence: this.head.get(), clientId: "web:sessions" }) },"open a fictional work session");
      this.#assertAuthorizationScope(authorization);
      const body = await response.json() as { appended?: CreativeEvent[]; head?: number; error?: string; briefComposed?: boolean };
      this.#assertAuthorizationScope(authorization);
      if (!response.ok) throw new Error(body.error === "session_already_open" ? "The current session is already open." : body.error ?? "Session could not be opened");
      this.events.set([...this.events.get(), ...(body.appended ?? [])]); this.head.set(body.head ?? this.head.get()); this.toast(body.briefComposed ? "Session opened with an eligible re-entry brief; every impression was witnessed." : "Session opened. More history is needed before composing a valid brief.");
    } catch (error) {if(this.#scopeStillActive(authorization))this.toast(error instanceof Error ? error.message : "Session could not be opened");}
    finally {if(this.#scopeStillActive(authorization)){this.busy.set("");this.notify();}}
  }

  async composeBrief() {
    const authorization=this.#activeAuthorizationScope();
    this.busy.set("compose-brief"); this.notify();
    try {
      const response = await this.guardedFetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "compose_brief", expectedSequence: this.head.get(), clientId: "web:sessions" }) },"compose a re-entry brief for this fictional account");
      this.#assertAuthorizationScope(authorization);
      const body = await response.json() as { appended?: CreativeEvent[]; head?: number; error?: string; eligibility?: { reasons?: string[] } };
      this.#assertAuthorizationScope(authorization);
      if (!response.ok) throw new Error(body.error === "brief_not_eligible" ? `Brief is not eligible: ${body.eligibility?.reasons?.join(" and ") ?? "more history required"}.` : body.error === "open_session_required" ? "Open a session before composing a brief." : body.error ?? "Brief could not be composed");
      this.events.set([...this.events.get(), ...(body.appended ?? [])]); this.head.set(body.head ?? this.head.get()); this.toast("Re-entry brief composed from the event stream; impressions were witnessed in the same batch.");
    } catch (error) {if(this.#scopeStillActive(authorization))this.toast(error instanceof Error ? error.message : "Brief could not be composed");}
    finally {if(this.#scopeStillActive(authorization)){this.busy.set("");this.notify();}}
  }

  async declareIntent(statement: string, deadline: string | null = null) {
    const authorization=this.#activeAuthorizationScope();
    this.busy.set("declare-intent"); this.notify();
    try {
      const response = await this.guardedFetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "declare_intent", expectedSequence: this.head.get(), clientId: "web:sessions", statement, deadline }) },"record this intent in the fictional account");
      this.#assertAuthorizationScope(authorization);
      const body = await response.json() as { appended?: CreativeEvent[]; head?: number; error?: string };
      this.#assertAuthorizationScope(authorization);
      if (!response.ok) throw new Error(body.error ?? "Intent could not be recorded");
      this.events.set([...this.events.get(), ...(body.appended ?? [])]); this.head.set(body.head ?? this.head.get()); this.toast("Intent recorded privately; the immutable event keeps only its expiring reference.");
    } catch (error) {if(this.#scopeStillActive(authorization))this.toast(error instanceof Error ? error.message : "Intent could not be recorded");}
    finally {if(this.#scopeStillActive(authorization)){this.busy.set("");this.notify();}}
  }

  async runScout(maxObservations: number) {
    const authorization=this.#activeAuthorizationScope();
    this.busy.set("run-scout"); this.notify();
    try {
      const response = await this.guardedFetch("/api/events", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({action:"run_scout",expectedSequence:this.head.get(),clientId:"web:scout",maxObservations}) },"run Scout against the fictional account");
      this.#assertAuthorizationScope(authorization);
      const body = await response.json() as {appended?:CreativeEvent[];head?:number;error?:string};
      this.#assertAuthorizationScope(authorization);
      if(!response.ok) throw new Error(body.error === "phase6_advance_required" ? "Record the Phase 6 advance-with-monitoring decision first." : body.error ?? "Scout run failed");
      this.events.set([...this.events.get(),...(body.appended??[])]);this.head.set(body.head??this.head.get());this.toast("Scout report completed inside its hard planning envelope.");
    } catch(error) {if(this.#scopeStillActive(authorization))this.toast(error instanceof Error?error.message:"Scout run failed");}
    finally {if(this.#scopeStillActive(authorization)){this.busy.set("");this.notify();}}
  }

  async refreshTasteModel() {
    const authorization=this.#activeAuthorizationScope();
    this.busy.set("taste-model");this.notify();
    try {
      const response=await this.guardedFetch("/api/events",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"refresh_taste_model",expectedSequence:this.head.get(),clientId:"web:memory"})},"refresh the fictional account’s taste model");
      this.#assertAuthorizationScope(authorization);
      const body=await response.json() as {appended?:CreativeEvent[];head?:number;error?:string;beliefs?:number};this.#assertAuthorizationScope(authorization);if(!response.ok)throw new Error(body.error === "phase6_advance_required"?"Record the Phase 6 advance-with-monitoring decision first.":body.error??"Taste model refresh failed");
      this.events.set([...this.events.get(),...(body.appended??[])]);this.head.set(body.head??this.head.get());this.toast((body.beliefs??0)===1?this.#systemNotice("Taste model versioned with {count} ranking-only belief.",{count:body.beliefs??0}):this.#systemNotice("Taste model versioned with {count} ranking-only beliefs.",{count:body.beliefs??0}));
    } catch(error){if(this.#scopeStillActive(authorization))this.toast(error instanceof Error?error.message:"Taste model refresh failed");}
    finally{if(this.#scopeStillActive(authorization)){this.busy.set("");this.notify();}}
  }

  async setCondition(condition:string,triggerKind:"generation_count"|"on_date",threshold:number,onDate:string|null){
    const authorization=this.#activeAuthorizationScope();
    this.busy.set("set-condition");this.notify();
    try{const response=await this.guardedFetch("/api/events",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"set_condition",expectedSequence:this.head.get(),clientId:"web:memory",condition,triggerKind,threshold,onDate})},"set a time condition in the fictional account");this.#assertAuthorizationScope(authorization);const body=await response.json() as {appended?:CreativeEvent[];content?:Record<string,string>;head?:number;error?:string};this.#assertAuthorizationScope(authorization);if(!response.ok)throw new Error(body.error??"Condition could not be set");this.events.set([...this.events.get(),...(body.appended??[])]);this.content.set({...this.content.get(),...(body.content??{})});this.head.set(body.head??this.head.get());this.toast("Time policy recorded privately.");return true;}catch(error){if(this.#scopeStillActive(authorization))this.toast(error instanceof Error?error.message:"Condition could not be set");return false;}finally{if(this.#scopeStillActive(authorization)){this.busy.set("");this.notify();}}
  }

  async checkConditions(){
    const authorization=this.#activeAuthorizationScope();
    this.busy.set("check-conditions");this.notify();
    try{const response=await this.guardedFetch("/api/events",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"check_conditions",expectedSequence:this.head.get(),clientId:"web:memory"})},"check time conditions in the fictional account");this.#assertAuthorizationScope(authorization);const body=await response.json() as {appended?:CreativeEvent[];head?:number;error?:string};this.#assertAuthorizationScope(authorization);if(!response.ok)throw new Error(body.error??"Policy check failed");this.events.set([...this.events.get(),...(body.appended??[])]);this.head.set(body.head??this.head.get());this.toast(body.appended?.length?body.appended.length===2?this.#systemNotice("{count} condition resurfaced.",{count:Math.floor(body.appended.length/2)}):this.#systemNotice("{count} conditions resurfaced.",{count:Math.floor(body.appended.length/2)}):"No time policies are due yet.");}catch(error){if(this.#scopeStillActive(authorization))this.toast(error instanceof Error?error.message:"Policy check failed");}finally{if(this.#scopeStillActive(authorization)){this.busy.set("");this.notify();}}
  }

  async critiqueObject(objectId:string,axis:string,polarity:"positive"|"negative",value:string,note:string){
    const authorization=this.#activeAuthorizationScope();
    this.busy.set("critique-object");this.notify();
    try{const response=await this.guardedFetch("/api/events",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"critique_object",expectedSequence:this.head.get(),clientId:"web:studio",objectId,axis,polarity,value,note})},"record this critique in the fictional account");this.#assertAuthorizationScope(authorization);const body=await response.json() as {appended?:CreativeEvent[];content?:Record<string,string>;head?:number;error?:string};this.#assertAuthorizationScope(authorization);if(!response.ok)throw new Error(body.error??"Critique could not be recorded");this.events.set([...this.events.get(),...(body.appended??[])]);this.content.set({...this.content.get(),...(body.content??{})});this.head.set(body.head??this.head.get());this.toast("Axis-specific critique recorded for the taste ledger.");return true;}catch(error){if(this.#scopeStillActive(authorization))this.toast(error instanceof Error?error.message:"Critique could not be recorded");return false;}finally{if(this.#scopeStillActive(authorization)){this.busy.set("");this.notify();}}
  }

  canManageProjectShares(){const session=this.session.get(),context=session?.projectContext;return Boolean(session)&&(!context||context.role==="owner"&&context.ownerUserId===session.user.userId);}
  async loadShares() {
    if(!this.canManageProjectShares()){this.shares.set([]);return;}
    const authorization=this.#activeAuthorizationScope(),response=await fetch("/api/shares");if(!response.ok||!this.#scopeStillActive(authorization))return;const body=await response.json() as {shares:ShareRecord[]};if(!this.#scopeStillActive(authorization))return;this.shares.set(body.shares);this.notify();
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
  #streamCanvasUndoGroup(canvasId:string){const ownerId=this.session.get()?.user.userId??"";if(!ownerId)return null;const actor=this.#principalEventActor(),events=this.events.get();const compensated=new Set(events.map((event)=>event.compensatesEventId).filter(Boolean));const owned=events.filter((event)=>event.actor===actor&&!event.compensatesEventId&&event.payload.history_owner_id===ownerId&&this.#canvasHistoryEvent(event,canvasId));const eligible=owned.filter((event)=>!compensated.has(event.eventId));const latest=eligible.at(-1);if(!latest)return null;const actionId=String(latest.payload.history_action_id??latest.eventId);const action=owned.filter((event)=>String(event.payload.history_action_id??event.eventId)===actionId);return action.some((event)=>event.type==="CanvasArrangementCreated")?action:eligible.filter((event)=>String(event.payload.history_action_id??event.eventId)===actionId);}
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
    const canvasId=canvasIdFromRoute(this.route.get())??"";const source = this.#undoCandidate(canvasId); if (!source?.length) return this.toast(canvasId?"Nothing to undo on this board.":documentViewFromRoute(this.route.get()) === "editor" ? "Nothing to undo." : "Nothing reversible remains in this document history.");
    const inverses=source.toReversed().map((event)=>{const inverse=inverseEvent(event)!;return{...inverse,payload:withoutClientEventId(inverse.payload),compensatesEventId:event.eventId};});
    const appended = await this.appendBatch(inverses, { remember: false });
    if (appended.length===inverses.length) this.#redo.push(source);
  }

  async redo() {
    const canvasId=canvasIdFromRoute(this.route.get())??"";const index=this.#historyIndex(this.#redo,canvasId);const source=index>=0?this.#redo.splice(index,1)[0]:null;if (!source?.length) return this.toast(canvasId?"Nothing to redo on this board.":"Nothing to redo in this session.");
    const appended = await this.appendBatch(source.map(redoEvent), { remember: false });
    const actor=this.#principalEventActor(),redone=appended.filter((event)=>event.actor===actor&&Boolean(inverseEvent(event)));if(redone.length)this.#undo.push(redone);
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
  const pairs: Record<string, string> = { BlockLocked: "BlockUnlocked", BlockUnlocked: "BlockLocked", BlockRemoved: "BlockRestored", BlockRestored: "BlockRemoved", BlockRelationAdded: "BlockRelationRemoved", BlockRelationRemoved: "BlockRelationAdded", DocumentRemoved: "DocumentRestored", DocumentRestored: "DocumentRemoved", ObjectPinned: "ObjectUnpinned", ObjectUnpinned: "ObjectPinned", AddedToLibrary: "RemovedFromLibrary", RemovedFromLibrary: "AddedToLibrary", CanvasItemRemoved:"CanvasItemRestored", CanvasItemRestored:"CanvasItemRemoved", CanvasArrangementRemoved:"CanvasArrangementRestored", CanvasArrangementRestored:"CanvasArrangementRemoved", CanvasRemoved:"CanvasRestored", CanvasRestored:"CanvasRemoved", MembershipAdded:"MembershipRemoved", MembershipRemoved:"MembershipAdded" };
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
