import { prepareOutputImageFinalizationProjectPublicationStatements } from "./output-native-project-publication.ts";
import { createImageFinalizationMediaVerifier, readImageFinalizationProof, imageRecoveryHasNoExplicitStop, imageRecoveryCancellationAssertion, readPublishedImageAcknowledgment, classifyImageRecoveryCandidate, classifyImageRecoveryStage, imageRecoveryDigest, readImageRecoveryPointer, readImageRecoveryStage, type ImageRecoveryProviderCall } from "./image-server-recovery.ts";
import { captureDocumentRenderSettings } from "../src/model/document-render-request.ts";
import { documentRenderGuidance, documentRenderGuidanceProblem } from "../src/model/document-render-guidance.ts";
import { PresentationModelConfigurationError, readFrozenPresentationModelRoutes, resolvePresentationModelRoutes } from "./presentation-model-routing.ts";
import { assertOutputAdmissionRequest, assertOutputAdmissionActor, assertOutputAdmissionBudget, readOutputAdmissionValue, type OutputAdmissionReads } from "./output-admission-reads.ts";
import { OUTPUT_NATIVE_EXECUTION_POLICY, readOutputNativeExecutionPolicy, type OutputNativeExecutionPolicy } from "../src/model/output-execution-policy.ts";
import { outputSchemaIsReady } from "./output-schema-state.ts";
import { loadOutputJobBinding, createOutputEventExecution, synchronizeOutputJobOutcome, prepareOutputJobOutcomeStatements, reconcileKnownOutputProviderReceipts, type OutputExecutionProof, type OutputEventExecution } from "./output-execution-control.ts";
import { retainedOutputBodyAssertions, rememberOutputPrivateBody, type OutputScope, ensureOutputRequirementsSchema, outputAssertionStatements, outputScopeAuthority, OutputConflictError, type OutputSqlAssertion } from "./output-requirements-ledger.ts";
import { resolveOutputImageFinalizationAuthority, resolveOutputImageAcknowledgmentAuthority, resolveOutputExecutionAuthority, prepareOutputExecutionProof, readOutputProofBatch } from "./output-requirements-api.ts";
import { MAX_MANUAL_PRESENTATION_SLIDES, PresentationCountPolicyError, readSlideCountPolicy, resolvePresentationCountRequest, sameSlideCountPolicy, slideCountAccepted, type SlideCountPolicy } from "../src/model/presentation-count-policy.ts";
import { approvedAudioVideoReference, handleEvents, reconstructRetainedImageInput, buildRetainedImagePublication } from "./events-api";
import { DEFAULT_EVIDENCE_RETENTION_DAYS, POLICY_VERSION, adoptLegacyCostReservation, costBudgetReservation, hasCapability, loadPrivateContent, loadPrivateProviderResponse, pilotExecutionAllowance, readAccountBudgets, readCostBudgets, reconcileFailedBudgetReservations, releaseBudgetReservationsForCorrelation, releaseCostReservationsForCorrelation, requireConsent, requireUser, settleInterruptedDocumentJobReservations, settleDocumentGenerationBudgets, storePrivateContent, preparePrivateContent, type PilotUser, type ProjectExecutionScope } from "./pilot-policy";
import { prepareProjectResourceScopeStatement, hasProjectContextCookie, ownerDocumentBudgetScopes, readProjectRequestContext, readProjectSourceEvents, synchronizeProjectScope } from "./project-access";
import { appendAuditEvent, ensureSchema, EVENT_WRITE_COLUMNS, eventWriteBindings, makeEvent, readCorrelatedEvents, readWorkspaceEvents, serializeEvent, StaleSequenceError, streamHead, uuidV7, type EventRow, type WorkerEnv, type WorkerExecutionContext } from "./runtime";
import { foldEvents } from "../src/model/events";
import { adaptiveRequestKey, adaptiveRequestLocale } from "../src/model/adaptive-request";
import { livePlanningBoardGuard, planningBoardCurrent } from "./planning-destination";
import {
  DOCUMENT_JOB_HEARTBEAT_MS,
  DOCUMENT_JOB_LEASE_MS,
  DOCUMENT_JOB_STALE_AFTER_MS,
  documentGenerationRequestKey,
  documentGenerationRevision,
  documentJobIsStale,
  documentJobCanRecoverProviderRender,
  documentJobTerminal,
  documentJobStopBudgetMessage,
  documentJobMaxAttempts,
  type DocumentJobStopBudget,
  type DocumentJobError,
  type DocumentJobKind,
  type DocumentJobStatus,
} from "../src/model/document-jobs";
import { normalizePromptTechnique, PROMPT_TECHNIQUES, type PromptTechnique } from "../src/model/prompt-structures";
import { applicationFailureDetail, classifyProviderFailure, ProviderRequestError, publicFailureDetail, type ProviderFailureDetail } from "./provider-errors";
import { documentJobCompletionBindings } from "./document-job-sql";
import { preflightGeneration } from "./generation-readiness";
import { DEFAULT_REFERENCE_VIDEO_MODEL, normalizeVideoDurationSeconds, VIDEO_ADAPTER_CONTRACT } from "../src/model/video-adapter";
import { AUDIO_ADAPTER_CONTRACT, AudioAdapterSelectionError, audioAuthoringConflict, normalizeAudioRequestProfile } from "../src/model/audio";
import { selectAudioAdapter } from "./audio-selection";
import { audioPreparationConstraints } from "./audio-prompt-adapter";
import { AudioProviderInputError } from "../src/model/audio-provider-contracts";
import { validateModel3dRequest } from "../src/model/model3d.ts";
import { prepareModel3dRequest } from "./model3d-request.ts";
import { falModel3dProviderReceipt } from "./fal-model3d-adapter.ts";
import { clearPresentationServerOwnedCheckpointFields, documentRenderTokenReservation, estimatePlannerOperationMicrousd, generationBudgetGate, presentationServerOwnedCheckpointField } from "../src/model/generation-budget";
import { buildManagedProductionPlan, ManagedPresentationPlanningError, MAX_MANAGED_PRESENTATION_SLIDES, minimumPresentationSlideCount, scoreManagedProductionPlan, type ManagedProductionPlan } from "../src/model/managed-production";
import { productionSystemFor, productionUnitsForPlan } from "../src/model/production-system";
import { buildPresentationSourceContract, inferPresentationSourceOutline, presentationCitationEvidenceChecks } from "../src/model/presentation-source";
import { documentArtifactValidationIssues, isSlideStylePresetId, parseDocumentArtifactContent, type DocumentArtifactDraft } from "../src/model/document-artifacts";
import { combinedContextGroups } from "../src/model/combined-context";
import { applyPresentationCandidateEdits, presentationCandidateEditableFields, presentationCandidateRevisionMarkdown, type PresentationCandidateEdit, type PresentationCandidateRevisionResult, historicalPresentationValidationRejection, presentationCandidateAccounting, presentationCandidateOriginalValidation, safePresentationCandidateIssues, sanitizePresentationCandidateSlides, sanitizePresentationCandidateText, sanitizePresentationCitationChecks, type PresentationCandidateDetail, type PresentationCandidateSummary } from "../src/model/presentation-candidates";
import { interruptedDocumentJobUsage, recordedDocumentPlannerUsage } from "./document-job-reservations";
import { PRINCIPAL_WITH_ACCESS_SQL, principalAccessFromRow } from "./access-policy";
import { authoritativeCreativeContext, authoritativePresentationRecoveryContext, ContextIntegrityError } from "./context-authority";
import { managedPilotSourceClassificationValid } from "./media-api";
import { ProductionWorkflowContextError, resolveProductionWorkflowContext } from "./production-workflow";
import { assessStoredPresentationCandidate, MAX_PROVIDER_ARTIFACT_CANDIDATE_BYTES, PRESENTATION_ADAPTER_VERSION } from "./openai-adapter";
import { governedPackageSourceRightsCurrent } from "./context-package-rights";
import { combinedSceneSnapshot } from "./managed-production";
import { prepareSceneCostConsent, readExistingSceneRequest, requireSceneCostApproval, sceneCostErrorResponse, scenePolicyStopIncomingField, readScenePolicyStopEvidence, sceneRequestExclusion, type PreparedSceneCost } from "./scene-cost-consent.ts";
import { standingConstraints } from "../src/model/taste";
import { productionWorkflowSourceIdentity, type ProductionWorkflowSource } from "../src/model/production-workflow";
import { createSceneConfiguration, isSceneMedium, type SceneConfiguration, type SceneMedium } from "../src/model/scene-configuration";
import { falImageProviderReceipt } from "./fal-image-adapter";
import { PAID_PROVIDER_FINANCIAL_FIELDS, definitiveProviderRejection, hasUnresolvedProviderSubmission, hasUnsettledProviderSubmission, invalidProviderSubmissionSql, mergeProviderSubmissions, providerSubmissions, unresolvedProviderSubmissionSql, unsettledProviderSubmissionSql } from "../src/model/provider-submission";
import { generationExecutionSummary } from "../src/model/generation-execution-evidence.ts";
import { originalSourceAudioRecoveryRequested, recoverOriginalSourceAudio } from "./document-audio-recovery";
import { privateContentScopeGuard } from "./pilot-policy";
import { settleLegacyPresentationReservations } from "./pilot-policy";
import { claimConsequentialExecution, consentHash, executionAdmissionGuard, executionAuthorityCurrent, executionContentCustodyGuard, failConsequentialExecution, reconcileConsequentialUsage, type ConsequentialBinding } from "./consequential-consent";
import { adaptiveExecutionResponse, adaptivePlanningAdmissionGuard, adaptivePlanningReviewAvailable, adaptivePriorExecutionResponse, executeApprovedAdaptivePlanning, handleAdaptivePlanning, readAdaptivePlanningJobResult, type AdaptivePlanningPorts, type AdaptivePlanningPrepared } from "./adaptive-planning";
import type { BudgetReservationGuard } from "./pilot-policy";

export type DocumentJobRow = {
  output_slot_id?:string|null;
  job_id: string; owner_id: string; stream_id: string; document_id: string; kind: DocumentJobKind; status: DocumentJobStatus;
  source_surface: string; correlation_id: string; requested_sequence: number; request_json: string; result_json: string | null;
  error_message: string | null; attempt_count: number; requested_at: string; started_at: string | null; completed_at: string | null;
  lease_expires_at: string | null; notified_at: string | null; expires_at: string; updated_at: string;
};

const KINDS = new Set<DocumentJobKind>(["preview", "generate", "prompt_fan", "chat", "structure_adaptive", "extract_reference", "render_document"]);
const MAX_PAYLOAD_BYTES = 750_000;
const consentedAdaptiveJob=(row:Pick<DocumentJobRow,"kind"|"request_json">)=>row.kind==="structure_adaptive"&&parseRequest(row).adaptiveConsentVersion===1;
const certifiedAdaptiveRows=new WeakSet<DocumentJobRow>();
// Progress/failure writers never drop a raw paid response saved by a concurrent callback.
const PRESERVE_ADAPTIVE_RECEIPT_SQL="json_patch(?,CASE WHEN kind='structure_adaptive' AND json_type(result_json,'$.adaptiveProviderReceipt')='object' THEN json_object('adaptiveProviderReceipt',json(json_extract(result_json,'$.adaptiveProviderReceipt'))) ELSE '{}' END)";
// Resolve execution lanes from immutable document-creation history, never
// client-supplied request snapshots. Older seeded documents inherit the most
// recent project that existed when their creation event was recorded.
const documentJobProjectSql=(alias:"target"|"candidate"|"active"|"document_jobs")=>`COALESCE((
  SELECT COALESCE(NULLIF(json_extract(created.payload,'$.project_id'),''),(
    SELECT NULLIF(json_extract(previous.payload,'$.project_id'),'')
    FROM events previous
    WHERE previous.stream_id=created.stream_id AND previous.sequence<=created.sequence
      AND previous.type IN('ProjectCreated','ProjectOpened')
    ORDER BY previous.sequence DESC LIMIT 1
  )) FROM events created
  WHERE created.stream_id=${alias}.stream_id AND created.type IN('DocumentCreated','DocumentForked')
    AND json_extract(created.payload,'$.document_id')=${alias}.document_id
  ORDER BY created.sequence ASC LIMIT 1
),'')`;
const TOKEN_RESERVATION_HANDOFF_SQL = "UPDATE budget_reservations SET correlation_id=?,updated_at=? WHERE reservation_id=? AND owner_id=? AND stream_id=? AND correlation_id=? AND operation=? AND status='active' AND EXISTS (SELECT 1 FROM cost_budget_reservations paired WHERE paired.reservation_id=? AND paired.owner_id=budget_reservations.owner_id AND paired.stream_id=budget_reservations.stream_id AND paired.correlation_id=budget_reservations.correlation_id AND paired.operation=budget_reservations.operation AND paired.period=budget_reservations.period AND paired.status IN ('active','executing')) AND EXISTS (SELECT 1 FROM document_jobs job WHERE job.job_id=? AND job.owner_id=? AND job.stream_id=budget_reservations.stream_id AND job.correlation_id=? AND job.attempt_count=? AND job.status='running')";
const COST_RESERVATION_HANDOFF_SQL = "UPDATE cost_budget_reservations SET correlation_id=?,status=CASE WHEN operation='document-render:storyboard' AND status='executing' THEN 'executing' ELSE 'active' END,updated_at=? WHERE reservation_id=? AND owner_id=? AND stream_id=? AND correlation_id=? AND operation=? AND status IN ('active','executing') AND EXISTS (SELECT 1 FROM budget_reservations paired WHERE paired.reservation_id=? AND paired.owner_id=cost_budget_reservations.owner_id AND paired.stream_id=cost_budget_reservations.stream_id AND paired.correlation_id=? AND paired.operation=cost_budget_reservations.operation AND paired.period=cost_budget_reservations.period AND paired.status='active') AND EXISTS (SELECT 1 FROM document_jobs job WHERE job.job_id=? AND job.owner_id=? AND job.stream_id=cost_budget_reservations.stream_id AND job.correlation_id=? AND job.attempt_count=? AND job.status='running')";
const UNCERTAIN_PRESENTATION_SUBMISSION_SQL="kind='render_document' AND COALESCE(json_extract(COALESCE(result_json,'{}'),'$.presentationProviderSubmission'),'')='pending'";
const UNCERTAIN_AUDIO_SUBMISSION_SQL="kind='render_document' AND COALESCE(json_extract(request_json,'$.artifactKind'),'')='audio' AND COALESCE(json_extract(COALESCE(result_json,'{}'),'$.audioProviderSubmission'),'')='pending' AND COALESCE(json_extract(COALESCE(result_json,'{}'),'$.providerJobId'),'')=''";
const UNCERTAIN_STORYBOARD_SUBMISSION_SQL="kind='render_document' AND COALESCE(json_extract(request_json,'$.artifactKind'),'')='storyboard' AND COALESCE(json_extract(COALESCE(result_json,'{}'),'$.storyboardProviderSubmission'),'') IN ('pending','confirmed')";
const UNCERTAIN_PRESENTATION_RECEIPT_SQL="json_patch(json_object('provider_request_status','submission_unknown','source_transmission_status',CASE WHEN json_extract(result_json,'$.generationReceipt.source_transmission_status')='transmitted' THEN 'transmitted' ELSE 'unknown' END,'settled_cost_microusd',CASE WHEN COALESCE(CAST(json_extract(result_json,'$.generationReceipt.settled_cost_microusd') AS INTEGER),0)>0 THEN json_extract(result_json,'$.generationReceipt.settled_cost_microusd') ELSE NULL END,'reservation_status','executing'),json_object('actual_provider_call_count',CASE WHEN COALESCE(CAST(json_extract(result_json,'$.generationReceipt.actual_provider_call_count') AS INTEGER),0)>0 THEN CAST(json_extract(result_json,'$.generationReceipt.actual_provider_call_count') AS INTEGER) ELSE NULL END))";
const UNCERTAIN_PRESENTATION_TOMBSTONE_SQL=`json_patch(json_object('presentationProviderSubmission','pending','reservationId',json_extract(result_json,'$.reservationId'),'costReservationId',json_extract(result_json,'$.costReservationId'),'generationReceipt',${UNCERTAIN_PRESENTATION_RECEIPT_SQL}),json_object('presentationProviderClientRequestId',json_extract(result_json,'$.presentationProviderClientRequestId'),'plannerModel',json_extract(result_json,'$.plannerModel'),'plannerResponseId',json_extract(result_json,'$.plannerResponseId'),'plannerResponseIds',json(json_extract(result_json,'$.plannerResponseIds')),'plannerUsage',json(json_extract(result_json,'$.plannerUsage')),'costReservationPeriod',json_extract(result_json,'$.costReservationPeriod'),'costReservationMicrousd',json_extract(result_json,'$.costReservationMicrousd')))`;
const UNCERTAIN_AUDIO_TOMBSTONE_SQL=`json_patch(json_object('audioProviderSubmission','pending','reservationId',json_extract(result_json,'$.reservationId'),'costReservationId',json_extract(result_json,'$.costReservationId'),'generationReceipt',json_patch(${UNCERTAIN_PRESENTATION_RECEIPT_SQL},json_object('artifact_kind','audio','provider','fal','model',COALESCE(json_extract(result_json,'$.providerModel'),json_extract(result_json,'$.generationReceipt.model'))))),json_object('providerModel',json_extract(result_json,'$.providerModel'),'audioEstimatedCostMicrousd',json_extract(result_json,'$.audioEstimatedCostMicrousd'),'plannerModel',json_extract(result_json,'$.plannerModel'),'plannerResponseId',json_extract(result_json,'$.plannerResponseId'),'plannerResponseIds',json(json_extract(result_json,'$.plannerResponseIds')),'plannerUsage',json(json_extract(result_json,'$.plannerUsage')),'costReservationPeriod',json_extract(result_json,'$.costReservationPeriod'),'costReservationMicrousd',json_extract(result_json,'$.costReservationMicrousd')))`;
const UNCERTAIN_STORYBOARD_RECEIPT_SQL="json_object('artifact_kind','storyboard','provider',CASE WHEN COALESCE(json_extract(result_json,'$.providerJobId'),'')<>'' THEN 'fal' ELSE COALESCE(json_extract(result_json,'$.generationReceipt.provider'),'openai') END,'model',COALESCE(json_extract(result_json,'$.providerModel'),json_extract(result_json,'$.generationReceipt.model')),'provider_request_status',CASE WHEN json_extract(result_json,'$.storyboardProviderSubmission')='confirmed' AND COALESCE(json_extract(result_json,'$.providerJobId'),'')<>'' THEN 'submitted' ELSE 'submission_unknown' END,'source_transmission_status',CASE WHEN json_extract(result_json,'$.storyboardProviderSubmission')='confirmed' AND COALESCE(json_extract(result_json,'$.providerJobId'),'')<>'' THEN 'transmitted' ELSE 'unknown' END,'settled_cost_microusd',CASE WHEN COALESCE(CAST(json_extract(result_json,'$.generationReceipt.settled_cost_microusd') AS INTEGER),0)>0 THEN json_extract(result_json,'$.generationReceipt.settled_cost_microusd') ELSE NULL END,'reservation_status','executing')";
const UNCERTAIN_STORYBOARD_TOMBSTONE_SQL=`json_patch(json_object('storyboardProviderSubmission',json_extract(result_json,'$.storyboardProviderSubmission'),'reservationId',json_extract(result_json,'$.reservationId'),'costReservationId',json_extract(result_json,'$.costReservationId'),'generationReceipt',${UNCERTAIN_STORYBOARD_RECEIPT_SQL}),json_object('artifactId',json_extract(result_json,'$.artifactId'),'providerJobId',json_extract(result_json,'$.providerJobId'),'providerRequestId',json_extract(result_json,'$.providerRequestId'),'providerModel',json_extract(result_json,'$.providerModel'),'providerStatusUrl',json_extract(result_json,'$.providerStatusUrl'),'providerResponseUrl',json_extract(result_json,'$.providerResponseUrl'),'providerCancelUrl',json_extract(result_json,'$.providerCancelUrl'),'storyboardProviderRequestedAt',json_extract(result_json,'$.storyboardProviderRequestedAt'),'storyboardProviderAcceptedAt',json_extract(result_json,'$.storyboardProviderAcceptedAt'),'plannerModel',json_extract(result_json,'$.plannerModel'),'plannerResponseId',json_extract(result_json,'$.plannerResponseId'),'plannerResponseIds',json(json_extract(result_json,'$.plannerResponseIds')),'plannerUsage',json(json_extract(result_json,'$.plannerUsage')),'costReservationPeriod',json_extract(result_json,'$.costReservationPeriod'),'costReservationMicrousd',json_extract(result_json,'$.costReservationMicrousd')))`;
// Receipt completion and financial settlement are different durable transitions.
// A crash between them must not make retention erase the only exact tariff evidence.
const PAID_SUBMISSION_HOLD_SQL=`(${unsettledProviderSubmissionSql()} OR
  COALESCE(json_extract(result_json,'$.providerSubmissionProtocol'),0)=1 AND EXISTS(
    SELECT 1 FROM json_each(CASE WHEN json_type(result_json,'$.providerSubmissions')='object' THEN json_extract(result_json,'$.providerSubmissions') ELSE '{}' END))
  AND (EXISTS(SELECT 1 FROM cost_budget_reservations held WHERE held.reservation_id=json_extract(result_json,'$.costReservationId')
      AND held.stream_id=document_jobs.stream_id AND held.correlation_id=document_jobs.correlation_id AND held.status IN('active','executing'))
    OR EXISTS(SELECT 1 FROM budget_reservations held WHERE held.reservation_id=json_extract(result_json,'$.reservationId')
      AND held.stream_id=document_jobs.stream_id AND held.correlation_id=document_jobs.correlation_id AND held.status='active')))`;
// Preserve the allowlisted subtree directly: JSON Merge Patch would erase
// meaningful nested nulls in immutable pricing receipts.
const PAID_SUBMISSION_VALUE_SQL="CASE WHEN paid.type='object' THEN paid.value ELSE '{}' END";
const PAID_SUBMISSION_FINANCIAL_SQL=`(SELECT json_group_object(kept.value,json_extract(${PAID_SUBMISSION_VALUE_SQL},'$.'||kept.value))
  FROM json_each('${JSON.stringify(PAID_PROVIDER_FINANCIAL_FIELDS)}') kept
  WHERE json_type(${PAID_SUBMISSION_VALUE_SQL},'$.'||kept.value) IS NOT NULL AND json_type(${PAID_SUBMISSION_VALUE_SQL},'$.'||kept.value)!='null')`;
const PAID_SUBMISSION_LEGACY_UNKNOWN_SQL=`(${invalidProviderSubmissionSql()} OR COALESCE(json_extract(result_json,'$.providerSubmissionLegacyUncertain'),0)=1
  OR json_extract(result_json,'$.presentationProviderSubmission')='pending' AND NOT EXISTS(
    SELECT 1 FROM json_each(CASE WHEN json_type(result_json,'$.providerSubmissions')='object' THEN json_extract(result_json,'$.providerSubmissions') ELSE '{}' END) current_call
    WHERE current_call.key=json_extract(result_json,'$.presentationProviderClientRequestId') AND current_call.type='object'
      AND json_extract(current_call.value,'$.clientRequestId')=current_call.key AND json_extract(current_call.value,'$.operation')='planning'))`;
const PAID_SUBMISSION_TOMBSTONE_SQL=`json_patch(json_object('providerSubmissionProtocol',1,'providerSubmissionLegacyUncertain',json(CASE WHEN ${PAID_SUBMISSION_LEGACY_UNKNOWN_SQL} THEN 'true' ELSE 'false' END),
  'providerSubmissions',json((SELECT json_group_object(paid.key,json(${PAID_SUBMISSION_FINANCIAL_SQL})) FROM json_each(CASE WHEN json_type(result_json,'$.providerSubmissions')='object' THEN json_extract(result_json,'$.providerSubmissions') ELSE '{}' END) paid)),
  'reservationId',json_extract(result_json,'$.reservationId'),'costReservationId',json_extract(result_json,'$.costReservationId'),'costReservationPeriod',json_extract(result_json,'$.costReservationPeriod'),'costReservationMicrousd',json_extract(result_json,'$.costReservationMicrousd')),
  json_object('presentationProviderSubmission',json_extract(result_json,'$.presentationProviderSubmission'),'presentationProviderClientRequestId',json_extract(result_json,'$.presentationProviderClientRequestId'),
    'plannerModel',json_extract(result_json,'$.plannerModel'),'plannerResponseId',json_extract(result_json,'$.plannerResponseId'),'plannerResponseIds',json(json_extract(result_json,'$.plannerResponseIds')),'plannerUsage',json(json_extract(result_json,'$.plannerUsage')),
    'generationReceipt',json_patch(${UNCERTAIN_PRESENTATION_RECEIPT_SQL},json_object('artifact_kind',json_extract(request_json,'$.artifactKind'),'provider',json_extract(result_json,'$.generationReceipt.provider'),'model',json_extract(result_json,'$.generationReceipt.model'),
      'provider_request_status',CASE WHEN ${unresolvedProviderSubmissionSql()} THEN 'submission_unknown' ELSE 'submitted' END,
      'source_transmission_status',CASE WHEN ${unresolvedProviderSubmissionSql()} AND COALESCE(json_extract(result_json,'$.generationReceipt.source_transmission_status'),'')!='transmitted' THEN 'unknown' ELSE 'transmitted' END))))`;
export const EXPIRED_DOCUMENT_JOB_REDACTION_SQL=`request_json=CASE WHEN ${PAID_SUBMISSION_HOLD_SQL} THEN json_object('artifactKind',json_extract(request_json,'$.artifactKind')) WHEN ${UNCERTAIN_PRESENTATION_SUBMISSION_SQL} THEN json_object('artifactKind','slides') WHEN ${UNCERTAIN_AUDIO_SUBMISSION_SQL} THEN json_object('artifactKind','audio') WHEN ${UNCERTAIN_STORYBOARD_SUBMISSION_SQL} THEN json_object('artifactKind','storyboard') ELSE '{}' END,result_json=CASE WHEN ${PAID_SUBMISSION_HOLD_SQL} THEN ${PAID_SUBMISSION_TOMBSTONE_SQL} WHEN ${UNCERTAIN_PRESENTATION_SUBMISSION_SQL} THEN ${UNCERTAIN_PRESENTATION_TOMBSTONE_SQL} WHEN ${UNCERTAIN_AUDIO_SUBMISSION_SQL} THEN ${UNCERTAIN_AUDIO_TOMBSTONE_SQL} WHEN ${UNCERTAIN_STORYBOARD_SUBMISSION_SQL} THEN ${UNCERTAIN_STORYBOARD_TOMBSTONE_SQL} ELSE NULL END`;
const DOCUMENT_JOB_REDACTION_REQUIRED_SQL=`(request_json!='{}' OR result_json IS NOT NULL) AND NOT (${PAID_SUBMISSION_HOLD_SQL} AND request_json=json_object('artifactKind',json_extract(request_json,'$.artifactKind')) AND result_json=${PAID_SUBMISSION_TOMBSTONE_SQL} OR ${UNCERTAIN_PRESENTATION_SUBMISSION_SQL} AND request_json=json_object('artifactKind','slides') AND result_json=${UNCERTAIN_PRESENTATION_TOMBSTONE_SQL} OR ${UNCERTAIN_AUDIO_SUBMISSION_SQL} AND request_json=json_object('artifactKind','audio') AND result_json=${UNCERTAIN_AUDIO_TOMBSTONE_SQL} OR ${UNCERTAIN_STORYBOARD_SUBMISSION_SQL} AND request_json=json_object('artifactKind','storyboard') AND result_json=${UNCERTAIN_STORYBOARD_TOMBSTONE_SQL})`;

const activeProjectExecutionSql=`EXISTS(SELECT 1 FROM organization_projects project
  JOIN organizations organization ON organization.organization_id=project.organization_id AND organization.status='active'
  JOIN project_migration_states migration ON migration.project_access_id=project.project_access_id AND migration.organization_id=project.organization_id AND migration.status='active'
  JOIN users actor ON actor.user_id=? AND actor.consent_version=?
  JOIN organization_memberships member ON member.organization_id=project.organization_id AND member.user_id=actor.user_id
    AND member.status='active' AND member.accepted_at IS NOT NULL AND member.revoked_at IS NULL
  JOIN organization_memberships owner_member ON owner_member.organization_id=project.organization_id AND owner_member.user_id=project.owner_user_id
    AND owner_member.status='active' AND owner_member.accepted_at IS NOT NULL AND owner_member.revoked_at IS NULL
  LEFT JOIN project_memberships project_member ON project_member.project_access_id=project.project_access_id AND project_member.organization_id=project.organization_id
    AND project_member.project_id=project.project_id AND project_member.user_id=actor.user_id AND project_member.status='active' AND project_member.revoked_at IS NULL
  JOIN project_resource_scopes document ON document.project_access_id=project.project_access_id AND document.organization_id=project.organization_id
    AND document.project_id=project.project_id AND document.owner_user_id=project.owner_user_id AND document.resource_kind='document' AND document.resource_id=?
  WHERE project.project_access_id=? AND project.organization_id=? AND project.project_id=? AND project.owner_user_id=? AND project.status='active'
    AND(project.owner_user_id=actor.user_id OR project_member.role IN('owner','editor')))`;

function projectExecutionBindings(scope:ProjectExecutionScope,documentId:string){
  return[scope.actorUserId,POLICY_VERSION,documentId,scope.projectAccessId,scope.organizationId,scope.projectId,scope.ownerUserId] as const;
}

const DOCUMENT_JOB_COLUMNS="job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,request_json,result_json,error_message,attempt_count,requested_at,started_at,completed_at,lease_expires_at,notified_at,expires_at,updated_at";
function documentJobInsert(env:WorkerEnv,user:PilotUser,documentId:string,values:string,bindings:Array<string|number|null>,idempotency?:{kind:DocumentJobKind;key:string;canvasId?:string;sourceSurface?:string;projectId?:string},guard?:BudgetReservationGuard){
  const scope=user.projectExecution;
  const adaptive=idempotency?.kind==="structure_adaptive";
  const board=adaptive&&idempotency.canvasId?livePlanningBoardGuard(user.streamId,idempotency.projectId??"",idempotency.canvasId):null;
  const conditions=[...(scope?[activeProjectExecutionSql]:[]),...(idempotency?[`NOT EXISTS(SELECT 1 FROM document_jobs existing WHERE existing.owner_id=? AND existing.stream_id=? AND existing.document_id=? AND existing.kind=? AND existing.status IN('queued','running','committing') AND ${adaptive?"existing.source_surface=? AND COALESCE(json_extract(existing.request_json,'$.canvasId'),'')=?":"COALESCE(json_extract(existing.request_json,'$.idempotencyKey'),'')=?"})`]:[])];
  if(board)conditions.push(`(${board.sql})`);
  if(guard)conditions.push(`(${guard.sql})`);
  return env.DB.prepare(`INSERT ${guard?"OR IGNORE ":""}INTO document_jobs (${DOCUMENT_JOB_COLUMNS}) ${conditions.length?`SELECT ${values} WHERE ${conditions.join(" AND ")}`:`VALUES (${values})`}`)
    .bind(...bindings,...(scope?projectExecutionBindings(scope,documentId):[]),...(idempotency?[user.userId,user.streamId,documentId,idempotency.kind,...(adaptive?[idempotency.sourceSurface??"studio",idempotency.canvasId??""]:[idempotency.key])]:[]),...(board?.bindings??[]),...(guard?.bindings??[]));
}

export function documentJobProjectAuthority(user:PilotUser,documentId:string,jobId="",requireAnchor=true):OutputSqlAssertion|null{
  const scope=user.projectExecution;if(!scope)return null;
  if(scope.actorUserId!==user.userId||user.streamId!==`creative:${scope.ownerUserId}`)return{sql:"0"};
  const jobSql=jobId?` AND EXISTS(SELECT 1 FROM project_resource_scopes resource JOIN document_jobs job ON job.job_id=resource.resource_id
    WHERE resource.project_access_id=? AND resource.organization_id=? AND resource.project_id=? AND resource.owner_user_id=?
      AND resource.resource_kind='job' AND resource.resource_id=? AND resource.actor_user_id=?
      AND job.owner_id=? AND job.stream_id=? AND job.document_id=?${requireAnchor?` AND EXISTS(SELECT 1 FROM events anchor WHERE anchor.event_id=resource.source_event_id AND anchor.stream_id=job.stream_id AND anchor.actor='user:'||resource.actor_user_id AND anchor.type='ProjectDocumentJobQueued' AND json_extract(anchor.payload,'$.job_id')=job.job_id AND json_extract(anchor.payload,'$.organization_id')=resource.organization_id AND json_extract(anchor.payload,'$.project_access_id')=resource.project_access_id AND json_extract(anchor.payload,'$.actor_user_id')=resource.actor_user_id)`:""})`:"";
  const bindings=jobId?[...projectExecutionBindings(scope,documentId),scope.projectAccessId,scope.organizationId,scope.projectId,scope.ownerUserId,jobId,scope.actorUserId,user.userId,user.streamId,documentId]:[...projectExecutionBindings(scope,documentId)];
  return {sql:`${activeProjectExecutionSql}${jobSql}`,bindings};
}

async function activeProjectExecution(env:WorkerEnv,user:PilotUser,documentId:string,jobId="",requireAnchor=true){
  const authority=documentJobProjectAuthority(user,documentId,jobId,requireAnchor);
  return !authority||Boolean(await env.DB.prepare(`SELECT 1 AS present WHERE ${authority.sql}`).bind(...(authority.bindings??[])).first());
}

function projectJobResource(env:WorkerEnv,user:PilotUser,jobId:string,documentId:string,createdAt:string,reuse=false){
  const scope=user.projectExecution;if(!scope)return null;
  return env.DB.prepare(`INSERT ${reuse?"OR IGNORE ":""}INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,visibility,source_event_id,actor_user_id,created_at)
    SELECT ?,'job',?,?,?,?,'actor_private',NULL,?,? WHERE EXISTS(SELECT 1 FROM document_jobs job
      WHERE job.job_id=? AND job.owner_id=? AND job.stream_id=? AND job.document_id=?) AND ${activeProjectExecutionSql}`)
    .bind(scope.projectAccessId,jobId,scope.organizationId,scope.projectId,scope.ownerUserId,scope.actorUserId,createdAt,jobId,user.userId,user.streamId,documentId,...projectExecutionBindings(scope,documentId));
}

function projectJobAnchorPayload(scope:ProjectExecutionScope,job:{jobId:string;kind:DocumentJobKind;documentId:string}){
  return{job_id:job.jobId,document_id:job.documentId,kind:job.kind,organization_id:scope.organizationId,project_access_id:scope.projectAccessId,project_id:scope.projectId,history_owner_user_id:scope.ownerUserId,actor_user_id:scope.actorUserId};
}
async function anchorProjectJobs(env:WorkerEnv,user:PilotUser,jobs:Array<{jobId:string;kind:DocumentJobKind;documentId:string}>){
  const scope=user.projectExecution;if(!scope)return;
  try{
    for(const job of jobs){
      if(!await activeProjectExecution(env,user,job.documentId,job.jobId,false))throw new Error("project_access_revoked");
      const event=await appendAuditEvent(env,user.streamId,`user:${user.userId}`,"ProjectDocumentJobQueued",projectJobAnchorPayload(scope,job),job.jobId);
      const anchored=await env.DB.prepare(`UPDATE project_resource_scopes SET source_event_id=? WHERE resource_kind='job' AND resource_id=? AND project_access_id=? AND organization_id=? AND project_id=? AND owner_user_id=? AND actor_user_id=? AND source_event_id IS NULL AND ${activeProjectExecutionSql}`)
        .bind(event.eventId,job.jobId,scope.projectAccessId,scope.organizationId,scope.projectId,scope.ownerUserId,scope.actorUserId,...projectExecutionBindings(scope,job.documentId)).run();
      if(Number(anchored.meta.changes??0)!==1)throw new Error("project_access_revoked");
    }
  }catch(error){
    for(const job of jobs){
      const row=await readJob(env,user.userId,job.jobId);if(!row||row.status!=="queued"&&row.status!=="running")continue;
      const now=new Date().toISOString();
      const changed=await env.DB.prepare(`UPDATE document_jobs SET status='canceled',error_message='project_job_authorization_failed',completed_at=?,lease_expires_at=NULL,notified_at=?,updated_at=? WHERE job_id=? AND owner_id=? AND stream_id=? AND correlation_id=? AND status IN('queued','running') AND NOT (${unsettledProviderSubmissionSql()}) AND NOT EXISTS(SELECT 1 FROM output_operation_slots output_slot JOIN output_provider_calls output_call ON output_call.scope_key=output_slot.scope_key AND output_call.slot_id=output_slot.slot_id WHERE output_slot.job_id=document_jobs.job_id AND output_call.status IN('pending','uncertain'))`)
        .bind(now,now,now,row.job_id,row.owner_id,row.stream_id,row.correlation_id).run();
      if(Number(changed.meta.changes??0)===1){const terminal=await readJob(env,user.userId,row.job_id);if(terminal)await releaseInterruptedAttempt(env,user,terminal,"project_job_authorization_failed");}
    }
    throw error;
  }
}

function safeScopedJob(row:DocumentJobRow,recoveryBlocker:DocumentJobRow|null=null){
  const job=serializeJob(row,recoveryBlocker,false);
  const sensitive=new Set(["scenePolicyStopSummary","providerSubmissions","providerSubmissionProtocol","providerSubmissionLegacyUncertain","plannerInput","providerInput","provider_input","videoInputReceipt","audioInputReceipt","model3dInputReceipt","model3dProviderFiles","model3dPrompt","model3dAdaptation","model3d_adaptation","model3dSettings","model3dReferenceBlockIds","model3d_prompt","model3d_settings","model3d_reference_block_ids","audioProfile","audio_profile","transcript","script","spokenScript","spoken_script","audioVideoArtifactId","videoReferenceId","video_reference_id","artifactPlan","presentationCandidates","presentationRecoveryOnly","providerResponseRef","candidateRaw","contentRef","contentExpiresAt","contentSha256","productionPlan","productionSceneReceipts","productionFrameReceipts","productionAnchor","providerStatusUrl","providerResponseUrl","providerCancelUrl","moderationPromptRef","intentRef","providerJobId","providerRequestId","storyboardSafeRecovery","storyboardRejectedProviderReceipt","generationReceipt","generation_receipt","input_ref","inputRef","input_expires_at","source_snapshot_sha256","snapshot","document_snapshot","sourceAliasMap","sourceAliases","source_alias_map","source_aliases","settings","audience","tone"]);
  const recoverySummary=(value:unknown)=>value&&typeof value==="object"?Object.fromEntries(Object.entries(value).filter(([key,item])=>["mode","original_source_revision","new_generation_requests","provider_retrieval_only","current_edits_preserved"].includes(key)&&["string","number","boolean"].includes(typeof item))):null;
  sensitive.add("audioOriginalSourceRecovery");
  const redact=(value:unknown):unknown=>Array.isArray(value)?value.map(redact):value&&typeof value==="object"?Object.fromEntries(Object.entries(value).filter(([key])=>!sensitive.has(key)).map(([key,item])=>[key,key==="recovery"?recoverySummary(item):redact(item)])):value;
  return{...job,result:job.result?redact(job.result):null,members:job.members.map((member)=>redact(member)),moderationPromptRef:null};
}

function parseResult(row: Pick<DocumentJobRow, "result_json">) {
  try { return row.result_json ? JSON.parse(row.result_json) as Record<string, unknown> : {}; } catch { return {}; }
}

function parseRequest(row: Pick<DocumentJobRow, "request_json">) {
  try { return row.request_json ? JSON.parse(row.request_json) as Record<string, unknown> : {}; } catch { return {}; }
}

function sceneConfigurationFromRequest(request: Record<string, unknown>): SceneConfiguration | null {
  if (request.artifactKind !== "scene") return null;
  const configuration = request.sceneConfiguration;
  if (configuration && typeof configuration === "object" && !Array.isArray(configuration)
    && isSceneMedium((configuration as Partial<SceneConfiguration>).medium)) {
    return configuration as SceneConfiguration;
  }
  return createSceneConfiguration(isSceneMedium(request.sceneMedium) ? request.sceneMedium : "visual");
}

function isPresentationJob(row: Pick<DocumentJobRow, "kind" | "request_json">) {
  return row.kind === "render_document" && parseRequest(row).artifactKind === "slides";
}

/** Paid planning and media can outlive response-detached waitUntil work. */
function requiresForegroundDocumentExecution(row: Pick<DocumentJobRow, "kind">) {
  return row.kind === "preview" || row.kind === "generate" || row.kind === "render_document";
}

function unresolvedPresentationSubmission(row:Pick<DocumentJobRow,"kind"|"request_json"|"result_json">,failure?:ProviderFailureDetail|null){
  if(!isPresentationJob(row)||parseResult(row).presentationProviderSubmission!=="pending")return false;
  return !(failure?.httpStatus&&definitiveProviderRejection(failure.httpStatus));
}

function unresolvedAudioSubmission(row:Pick<DocumentJobRow,"kind"|"request_json"|"result_json">){
  const checkpoint=parseResult(row);
  return row.kind==="render_document"&&parseRequest(row).artifactKind==="audio"&&checkpoint.audioProviderSubmission==="pending"&&!checkpoint.providerJobId;
}

function unresolvedModel3dSubmission(row:Pick<DocumentJobRow,"kind"|"request_json"|"result_json">){
  const checkpoint=parseResult(row);
  return row.kind==="render_document"&&parseRequest(row).artifactKind==="model3d"&&checkpoint.model3dProviderSubmission==="pending"&&!checkpoint.providerJobId&&!model3dRecoveryProviderReceipt(checkpoint);
}

/** Acceptance can be durable before the adapter's convenience URL checkpoint. */
function model3dRecoveryProviderReceipt(checkpoint:Record<string,unknown>){
  const accepted=providerSubmissions(checkpoint).find(receipt=>receipt.provider==="fal"&&receipt.operation==="model3d"&&(receipt.status==="accepted"||receipt.status==="completed")&&receipt.providerRequestId);
  if(!accepted)return null;
  try{return {...falModel3dProviderReceipt(accepted.model,accepted.providerRequestId!),providerModel:accepted.model,model3dProviderSubmission:"confirmed"};}catch{return null;}
}

/** A retrieved 3D result reuses its exact paid ledger pair, even after settlement. */
function model3dRecoveryReservationGuard(user:PilotUser,row:DocumentJobRow,checkpoint:Record<string,unknown>,settledOnly=false):OutputSqlAssertion{
  const receipt=providerSubmissions(checkpoint).find(entry=>entry.provider==="fal"&&entry.operation==="model3d"&&entry.status==="completed"&&entry.providerRequestId===model3dRecoveryProviderReceipt(checkpoint)?.providerJobId);
  const paid=Number(receipt?.costMicrousd??0);
  const completedPaid=Boolean(receipt&&Number.isSafeInteger(paid)&&paid>0);
  return{sql:`EXISTS(SELECT 1 FROM budget_reservations model_token JOIN cost_budget_reservations model_cost
    ON model_cost.owner_id=model_token.owner_id AND model_cost.stream_id=model_token.stream_id
      AND model_cost.correlation_id=model_token.correlation_id AND model_cost.operation=model_token.operation AND model_cost.period=model_token.period
    WHERE model_token.reservation_id=? AND model_cost.reservation_id=? AND model_token.owner_id=? AND model_token.stream_id=?
      AND model_token.correlation_id=? AND model_token.operation='document-render:model3d' AND model_cost.period=?
      AND (${settledOnly?"0":"model_token.status='active' AND model_cost.status IN('active','executing')"}
        OR ?=1 AND model_token.status='released' AND model_token.used_tokens=0 AND model_cost.status='settled' AND model_cost.used_microusd=?))`,
    bindings:[String(checkpoint.reservationId??""),String(checkpoint.costReservationId??""),user.billingUserId??user.userId,row.stream_id,row.correlation_id,String(checkpoint.costReservationPeriod??""),Number(completedPaid),paid]};
}

function unresolvedStoryboardSubmission(row:Pick<DocumentJobRow,"kind"|"request_json"|"result_json">){
  if(row.kind!=="render_document"||parseRequest(row).artifactKind!=="storyboard")return false;
  const checkpoint=parseResult(row);
  return checkpoint.storyboardProviderSubmission==="pending"||checkpoint.storyboardProviderSubmission==="confirmed";
}

function unresolvedVideoSubmission(row:Pick<DocumentJobRow,"kind"|"request_json"|"result_json">){
  if(row.kind!=="render_document"||parseRequest(row).artifactKind!=="video")return false;
  const checkpoint=parseResult(row);
  const receipt=checkpoint.generationReceipt&&typeof checkpoint.generationReceipt==="object"?checkpoint.generationReceipt as Record<string,unknown>:{};
  const scenes=Object.values(checkpoint.productionSceneReceipts&&typeof checkpoint.productionSceneReceipts==="object"?checkpoint.productionSceneReceipts as Record<string,Record<string,unknown>>:{});
  const anchor=checkpoint.productionAnchor&&typeof checkpoint.productionAnchor==="object"&&!Array.isArray(checkpoint.productionAnchor)
    ?checkpoint.productionAnchor as Record<string,unknown>:null;
  const submitted=scenes.filter((scene)=>["submitted","completed"].includes(String(scene.status??"")));
  const status=String(receipt.provider_request_status??"");
  if(status==="submission_unknown")return true;
  if(!checkpoint.providerJobId&&!anchor&&status!=="submitted"&&!submitted.length)return false;
  if(!String(checkpoint.reservationId??"")||!String(checkpoint.costReservationId??""))return true;
  if(status==="submitted"&&!checkpoint.providerJobId&&!anchor&&!submitted.length)return true;
  return submitted.some((scene)=>!String(scene.providerJobId??"")
    ||Number(scene.durationSeconds??0)<=0&&Number(scene.costMicrousd??0)<=0);
}

function trustedStoryboardSafeRecovery(checkpoint:Record<string,unknown>){
  const marker=checkpoint.storyboardSafeRecovery&&typeof checkpoint.storyboardSafeRecovery==="object"&&!Array.isArray(checkpoint.storyboardSafeRecovery)?checkpoint.storyboardSafeRecovery as Record<string,unknown>:null;
  const rejected=checkpoint.storyboardRejectedProviderReceipt&&typeof checkpoint.storyboardRejectedProviderReceipt==="object"&&!Array.isArray(checkpoint.storyboardRejectedProviderReceipt)?checkpoint.storyboardRejectedProviderReceipt as Record<string,unknown>:null;
  const items=Array.isArray(checkpoint.renderedItems)?checkpoint.renderedItems:[];
  const plan=checkpoint.artifactPlan&&typeof checkpoint.artifactPlan==="object"&&!Array.isArray(checkpoint.artifactPlan)?checkpoint.artifactPlan as Record<string,unknown>:null;
  return Boolean(marker&&rejected&&marker.enabled===true&&marker.maxAttempts===1&&Number.isSafeInteger(marker.failedFrameIndex)&&Number(marker.failedFrameIndex)>=1&&Number(marker.failedFrameIndex)===items.length&&Array.isArray(plan?.items)&&items.length<plan.items.length&&typeof marker.rejectedProviderJobId==="string"&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u.test(marker.rejectedProviderJobId)&&rejected.providerJobId===marker.rejectedProviderJobId&&typeof marker.rejectedPromptSha256==="string"&&/^[0-9a-f]{64}$/u.test(marker.rejectedPromptSha256)&&rejected.promptSha256===marker.rejectedPromptSha256&&typeof marker.attemptedAt==="string"&&Number.isFinite(Date.parse(marker.attemptedAt))&&checkpoint.storyboardProviderSubmission==="cleared"&&!checkpoint.providerJobId&&checkpoint.reservationId&&checkpoint.costReservationId);
}

function unsafePresentationRecovery(row:DocumentJobRow):ProviderFailureDetail|null{
  if(!isPresentationJob(row))return null;
  const checkpoint=parseResult(row);const receipt=checkpoint.generationReceipt&&typeof checkpoint.generationReceipt==="object"?checkpoint.generationReceipt as Record<string,unknown>:{};
  const uncertain=checkpoint.presentationProviderSubmission==="pending"||receipt.provider_request_status==="submission_unknown";
  const usage=checkpoint.plannerUsage&&typeof checkpoint.plannerUsage==="object"?checkpoint.plannerUsage as Record<string,unknown>:{};
  const paid=Boolean(checkpoint.plannerResponseId||Array.isArray(checkpoint.plannerResponseIds)&&checkpoint.plannerResponseIds.length||Number(usage.totalTokens??0)>0||receipt.provider_request_status==="submitted");
  const request=parseRequest(row);const expectedCount=Number(request.requestedSlideCount??request.itemCount??0);
  const saved=checkpoint.artifactPlan&&typeof checkpoint.artifactPlan==="object"?parseDocumentArtifactContent(JSON.stringify(checkpoint.artifactPlan)):null;
  const workflow=Boolean(request.workflowId||request.workflowStageId);
  const snapshot=request.snapshot&&typeof request.snapshot==="object"&&!Array.isArray(request.snapshot)?request.snapshot as Record<string,unknown>:{};
  const policyValid=request.slideCountPolicy!==null&&sameSlideCountPolicy(request.slideCountPolicy,receipt.slide_count_policy);
  const slideCountPolicy=policyValid&&request.slideCountPolicy!==undefined?readSlideCountPolicy(request.slideCountPolicy):undefined;
  const sourceContract=workflow?undefined:buildPresentationSourceContract(snapshot,{itemCount:expectedCount,...(slideCountPolicy?{slideCountPolicy}:{requestedSlideCount:expectedCount})});
  // Workflow authority is re-resolved by the executor, which must validate the
  // retained draft against that fresh context and must never resubmit a paid one.
  const resumable=Boolean(policyValid&&saved&&Number.isSafeInteger(expectedCount)&&expectedCount>0&&(workflow?slideCountAccepted(saved.items.length,slideCountPolicy,expectedCount):!documentArtifactValidationIssues("slides",saved,{itemCount:expectedCount,contextGroupIds:combinedContextGroups(snapshot).map((group)=>group.id),sourceContract,requireSourceGrounding:sourceContract?.sources.some((source)=>source.sourceKind==="block"),requireAllProtectedContent:true}).length));
  if(uncertain){
    const candidateRequestId=checkpoint.presentationProviderClientRequestId;
    const requestId=typeof candidateRequestId==="string"&&/^forma-slides-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(candidateRequestId)?candidateRequestId:null;
    const supportReference=requestId?` Support reference: ${requestId}.`:"";
    return{code:"provider_submission_uncertain",category:"network",scope:"network",action:"contact_support",message:`The presentation request may already have reached its provider. Automatic resubmission was stopped to prevent a duplicate charge.${supportReference}`,retryable:false,retryAfterMs:null,requestId,httpStatus:null};
  }
  if(paid&&!resumable)return{code:"presentation_recovery_unavailable",category:"server",scope:"unknown",action:"contact_support",message:"A paid presentation response was recorded before its complete draft was saved. Automatic resubmission was stopped to prevent a duplicate charge.",retryable:false,retryAfterMs:null,requestId:null,httpStatus:null};
  return null;
}

/** A checkpoint may resume paid work, but it may never authorize buying it twice. */
function unsafePaidRecovery(row:DocumentJobRow):ProviderFailureDetail|null{
  const checkpoint=parseResult(row),request=parseRequest(row);
  const submissions=providerSubmissions(checkpoint);
  const pending=submissions.find((receipt)=>receipt.status==="pending");
  const unknownLegacy=requiresForegroundDocumentExecution(row)&&!isPresentationJob(row)&&row.attempt_count>0&&checkpoint.providerSubmissionProtocol!==1
    &&!checkpoint.plannerResponseId&&!checkpoint.artifactPlan&&!checkpoint.providerJobId&&!checkpoint.productionSceneReceipts&&!checkpoint.productionFrameReceipts;
  const legacyScenes=Object.values(checkpoint.productionSceneReceipts&&typeof checkpoint.productionSceneReceipts==="object"?checkpoint.productionSceneReceipts as Record<string,Record<string,unknown>>:{});
  const incompleteLegacyMedia=checkpoint.providerSubmissionProtocol!==1&&row.attempt_count>0&&["storyboard","video"].includes(String(request.artifactKind??""))
    &&!trustedStoryboardSafeRecovery(checkpoint)&&(legacyScenes.some((scene)=>scene.status==="preparing"&&!scene.providerJobId)
      ||!checkpoint.providerJobId&&!legacyScenes.length&&!checkpoint.productionFrameReceipts);
  if(hasUnresolvedProviderSubmission(checkpoint)||unresolvedModel3dSubmission(row)||unknownLegacy||incompleteLegacyMedia)return{code:"provider_submission_uncertain",category:"network",scope:"network",action:"contact_support",message:"A paid request may already have reached its provider. Automatic resubmission was stopped to prevent a duplicate charge.",retryable:false,retryAfterMs:null,requestId:pending?.clientRequestId??null,httpStatus:null};
  const presentationFailure=unsafePresentationRecovery(row);if(presentationFailure)return presentationFailure;
  const unavailable=():ProviderFailureDetail=>({code:"provider_result_recovery_unavailable",category:"server",scope:"unknown",action:"contact_support",message:"Paid provider work was recorded, but its saved recovery data is incomplete. No replacement paid request was submitted.",retryable:false,retryAfterMs:null,requestId:null,httpStatus:null});
  const plannerUsage=checkpoint.plannerUsage&&typeof checkpoint.plannerUsage==="object"?checkpoint.plannerUsage as Record<string,unknown>:{};
  const paidPlan=Boolean(checkpoint.plannerResponseId||Number(plannerUsage.totalTokens??0)>0||submissions.some((entry)=>entry.operation==="planning"&&entry.status==="completed"));
  if(paidPlan&&(!checkpoint.artifactPlan||!parseDocumentArtifactContent(JSON.stringify(checkpoint.artifactPlan))))return unavailable();
  const rendered=Array.isArray(checkpoint.renderedItems)?checkpoint.renderedItems as Record<string,unknown>[]:[];
  const frames=Object.values(checkpoint.productionFrameReceipts&&typeof checkpoint.productionFrameReceipts==="object"?checkpoint.productionFrameReceipts as Record<string,Record<string,unknown>>:{});
  const scenes=Object.values(checkpoint.productionSceneReceipts&&typeof checkpoint.productionSceneReceipts==="object"?checkpoint.productionSceneReceipts as Record<string,Record<string,unknown>>:{});
  const anchor=checkpoint.productionAnchor&&typeof checkpoint.productionAnchor==="object"?checkpoint.productionAnchor as Record<string,unknown>:null;
  const represented=[...rendered,...frames,...scenes,...(anchor?[anchor]:[])];
  for(const receipt of submissions){
    if(receipt.status==="pending"||receipt.status==="rejected"||receipt.operation==="planning")continue;
    if(receipt.operation==="image"||receipt.operation==="video"||receipt.operation==="audio"||receipt.operation==="model3d"){
      const saved=represented.some((item)=>item.providerSubmissionId===receipt.clientRequestId||item.provider_submission_id===receipt.clientRequestId
        ||receipt.providerRequestId&&(item.providerJobId===receipt.providerRequestId||item.provider_request_id===receipt.providerRequestId));
      const resumable=receipt.provider==="fal"&&receipt.providerRequestId===(checkpoint.providerJobId??model3dRecoveryProviderReceipt(checkpoint)?.providerJobId)&&(request.artifactKind==="storyboard"||request.artifactKind==="video"||request.artifactKind==="audio"&&Boolean(checkpoint.audioInputReceipt)||request.artifactKind==="model3d"&&Boolean(checkpoint.model3dInputReceipt));
      const rejected=checkpoint.storyboardRejectedProviderReceipt as Record<string,unknown>|undefined;
      const safeRejected=trustedStoryboardSafeRecovery(checkpoint)&&rejected?.providerJobId===receipt.providerRequestId;
      if(!saved&&!resumable&&!safeRejected)return unavailable();
    }
  }
  return null;
}

function generationRevisionFromRequest(request: Record<string, unknown>, documentId: string) {
  return String(request.documentRevision || documentGenerationRevision({ snapshot: request.snapshot ?? {}, sourceBlockVersions: request.sourceBlockVersions ?? [], documentId }));
}

function generationRequestIdentity(kind: DocumentJobKind, request: Record<string, unknown>, documentId: string) {
  const documentRevision = generationRevisionFromRequest(request, documentId);
  const sourcePreviewId = typeof request.sourcePreviewId === "string" && request.sourcePreviewId ? request.sourcePreviewId : null;
  const promptTechnique = normalizePromptTechnique(request.promptTechnique); const promptFanId = typeof request.promptFanId === "string" && request.promptFanId ? request.promptFanId : null;
  const requestKey = kind === "preview" || kind === "generate" ? String(request.requestKey || documentGenerationRequestKey(kind, documentRevision, sourcePreviewId, promptTechnique, promptFanId)) : kind === "prompt_fan" || kind === "render_document" || kind === "structure_adaptive" ? String(request.requestKey ?? "") : "";
  const workflowIdentity = kind === "generate" && request.workflowId && request.workflowStageId
    ? documentGenerationRevision({ workflowId: request.workflowId, workflowStageId: request.workflowStageId, sources: productionWorkflowSourceIdentity(Array.isArray(request.workflowSources) ? request.workflowSources as ProductionWorkflowSource[] : []) })
    : null;
  return { documentRevision, requestKey, sourcePreviewId, promptTechnique, promptFanId, workflowIdentity };
}

const LOCAL_PERSISTENCE_FAILURE=/\b(?:D1_ERROR|SQLITE_(?:CONSTRAINT|ERROR|BUSY|LOCKED|IOERR|CORRUPT|FULL)|SQLITE_CONSTRAINT_[A-Z_]+|UNIQUE constraint failed|FOREIGN KEY constraint failed|NOT NULL constraint failed|CHECK constraint failed|database is locked|Wrong number of parameter bindings|events\.event_id|event[_ -]store(?:\s+|[_ -])(?:write|persistence|collision|failure))/i;
const SOURCE_FIDELITY_FAILURE=/\b(?:SOURCE_FIDELITY_VALIDATION_FAILED|source[_ -]fidelity[_ -]validation[_ -]failed|protected[_ -](?:quote|fact|claim|source)|(?:required|protected).{0,40}(?:quote|quotation|numerical fact|source attribution).{0,40}(?:missing|truncated|invalid|unresolved))/i;

function classifyDocumentJobFailure(input:unknown,existing:ProviderFailureDetail|null=null,status:number|null=null):ProviderFailureDetail{
  const raw=input instanceof Error?input.message:typeof input==="string"?input:"";
  const evidence=[raw,existing?.code??"",existing?.message??""].filter(Boolean).join(" ");
  if(LOCAL_PERSISTENCE_FAILURE.test(evidence))return{
    code:"local_persistence_failed",category:"server",scope:"unknown",action:"contact_support",
    message:`Forma could not save this generation because a local event or database write failed. No provider outage was reported.${raw?` Technical detail: ${raw}`:""}`,
    retryable:false,retryAfterMs:null,requestId:null,httpStatus:null,
  };
  if(SOURCE_FIDELITY_FAILURE.test(evidence))return{
    code:"source_fidelity_validation_failed",category:"provider",scope:"request",action:"edit_request",
    message:`The generated presentation failed source-fidelity validation. Protected facts, quotations, slide coverage, or authorized source attribution must be corrected before another paid generation.${raw?` Technical detail: ${raw}`:""}`,
    retryable:false,retryAfterMs:null,requestId:existing?.requestId??null,httpStatus:null,...(existing?.validationIssues?.length?{validationIssues:existing.validationIssues}:{}),
  };
  return existing??classifyProviderFailure(input,status!==null?new Response(null,{status}):undefined);
}

function renderRequestIdempotencyKey(request:Record<string,unknown>,documentId:string){
  const sceneConfiguration=sceneConfigurationFromRequest(request);
  const settings={
    documentId,documentRevision:generationRevisionFromRequest(request,documentId),artifactKind:String(request.artifactKind??""),
    productionMode:request.productionMode==="managed"?"managed":"manual",itemCount:request.itemCount??null,
    requestedSlideCount:request.requestedSlideCount??null,...(request.slideCountPolicy?{slideCountPolicy:request.slideCountPolicy}:{}),audience:String(request.audience??"").trim(),tone:String(request.tone??"").trim(),locale:String(request.locale??"en"),
    presentationStyle:request.presentationStyle??null,presentationFidelity:request.presentationFidelity??null,
    videoSeconds:request.videoSeconds??null,videoSize:request.videoSize??null,videoAudioMode:request.videoAudioMode??null,
    soundtrackBlockIds:Array.isArray(request.soundtrackBlockIds)?[...new Set(request.soundtrackBlockIds.map(String))]:[],audioImageBlockId:request.audioImageBlockId??null,sendSoundtrackToVideoProvider:request.sendSoundtrackToVideoProvider===true,
    ...(request.audioProfile?{audioProfile:request.audioProfile}:{}),...(request.audioProviderModel?{audioProviderModel:request.audioProviderModel}:{}),...(request.audioVideoArtifactId?{audioVideoArtifactId:request.audioVideoArtifactId}:{}),...(request.sendAudioVideoToProvider===true?{sendAudioVideoToProvider:true}:{}),
    ...(request.artifactKind==="model3d"?{model3dPrompt:request.model3dPrompt,model3dSettings:request.model3dSettings,model3dReferenceBlockIds:request.model3dReferenceBlockIds,...(request.model3dPromptSource==="document"?{model3dPromptSource:"document",model3dAdaptation:request.model3dAdaptation}:{})}:{}),
    workflowId:typeof request.workflowId==="string"?request.workflowId:null,
    workflowStageId:typeof request.workflowStageId==="string"?request.workflowStageId:null,
    workflowSources:productionWorkflowSourceIdentity(Array.isArray(request.workflowSources)?request.workflowSources as ProductionWorkflowSource[]:[]),
    ...(sceneConfiguration?{sceneMedium:sceneConfiguration.medium,sceneConfiguration}:{}),
  };
  return `${String(request.requestKey??"").trim()||`render:${settings.artifactKind}:${settings.documentRevision}`}:${documentGenerationRevision(settings)}`;
}

async function sourceSnapshotSha256(snapshot:Record<string,unknown>){
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(snapshot)));
  return Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,"0")).join("");
}

async function retainedPresentationContentSha256(content:string){
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(content));
  return Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,"0")).join("");
}

type PrivatePresentationCandidateRow={
  content_id:string;content:string;expires_at:string;created_at:string;
  classification:string;policy_version:number;source_content_id:string;source_content:string;source_expires_at:string;read_expires_at:string;
};
type VerifiedPresentationCandidate={row:PrivatePresentationCandidateRow;envelope:Record<string,unknown>;summary:PresentationCandidateSummary;detail:PresentationCandidateDetail;originalValidation:Record<string,unknown>;accountingEvidence:string};

/** Read paid drafts and their original governed source evidence under one live, actor-private authorization guard. */
function privatePresentationCandidateQuery(user:PilotUser,job:DocumentJobRow,projectContextId:string,responseId=""){
  const now=new Date().toISOString();
  const scope=user.projectExecution;
  const sharedSelect=`content.content_id,content.content,content.expires_at,content.created_at,source.content_id AS source_content_id,source.content AS source_content,source.expires_at AS source_expires_at,MIN(content.expires_at,source.expires_at${scope?",selection.expires_at":""}) AS read_expires_at`;
  if(scope){
    if(!projectContextId||scope.actorUserId!==user.userId)return null;
    return{sql:`SELECT ${sharedSelect},retention.classification,retention.policy_version
      FROM private_content content
      JOIN project_resource_scopes evidence ON evidence.resource_kind='content' AND evidence.resource_id=content.content_id
        AND evidence.visibility='actor_private' AND evidence.project_access_id=? AND evidence.organization_id=? AND evidence.project_id=?
        AND evidence.owner_user_id=? AND evidence.actor_user_id=?
      JOIN private_content_retention_scopes retention ON retention.content_id=content.content_id
        AND retention.organization_id=evidence.organization_id AND retention.project_access_id=evidence.project_access_id
        AND retention.project_id=evidence.project_id AND retention.actor_user_id=evidence.actor_user_id
        AND retention.classification IN('transient-private','governed-evidence') AND retention.assigned_expires_at=content.expires_at
      JOIN project_resource_scopes resource ON resource.resource_kind='job' AND resource.resource_id=?
        AND resource.project_access_id=evidence.project_access_id AND resource.organization_id=evidence.organization_id
        AND resource.project_id=evidence.project_id AND resource.owner_user_id=evidence.owner_user_id AND resource.actor_user_id=evidence.actor_user_id
      JOIN events anchor ON anchor.event_id=resource.source_event_id AND anchor.stream_id=? AND anchor.actor='user:'||resource.actor_user_id
        AND anchor.type='ProjectDocumentJobQueued' AND json_extract(anchor.payload,'$.job_id')=resource.resource_id
        AND json_extract(anchor.payload,'$.organization_id')=resource.organization_id
        AND json_extract(anchor.payload,'$.project_access_id')=resource.project_access_id
        AND json_extract(anchor.payload,'$.actor_user_id')=resource.actor_user_id
      JOIN project_context_sessions selection ON selection.context_id=? AND selection.principal_user_id=?
        AND selection.organization_id=evidence.organization_id AND selection.project_access_id=evidence.project_access_id
        AND selection.revoked_at IS NULL AND selection.expires_at>? AND selection.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      JOIN private_content source ON source.owner_id=content.owner_id AND source.kind='document-artifact-input'
        AND source.redacted_at IS NULL AND source.expires_at>? AND source.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND json_valid(source.content)=1
        AND json_extract(source.content,'$.job_id')=? AND json_extract(source.content,'$.document_id')=?
      JOIN project_resource_scopes source_scope ON source_scope.resource_kind='content' AND source_scope.resource_id=source.content_id
        AND source_scope.visibility='actor_private' AND source_scope.project_access_id=evidence.project_access_id
        AND source_scope.organization_id=evidence.organization_id AND source_scope.project_id=evidence.project_id
        AND source_scope.owner_user_id=evidence.owner_user_id AND source_scope.actor_user_id=evidence.actor_user_id
      JOIN private_content_retention_scopes source_retention ON source_retention.content_id=source.content_id
        AND source_retention.organization_id=evidence.organization_id AND source_retention.project_access_id=evidence.project_access_id
        AND source_retention.project_id=evidence.project_id AND source_retention.actor_user_id=evidence.actor_user_id
        AND source_retention.classification='governed-evidence' AND source_retention.assigned_expires_at=source.expires_at
      WHERE content.owner_id=? AND content.kind='provider-response' AND content.redacted_at IS NULL AND content.expires_at>? AND content.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
        AND json_valid(content.content)=1 AND json_extract(content.content,'$.job_id')=?
        AND json_extract(content.content,'$.stream_id')=? AND json_extract(content.content,'$.document_id')=?
        AND (?='' OR json_extract(content.content,'$.response_id')=?) AND NOT EXISTS(SELECT 1 FROM organization_deletion_jobs deletion WHERE deletion.organization_id=evidence.organization_id AND deletion.status IN('pending','partial','processing','completed')) AND ${activeProjectExecutionSql}
      ORDER BY content.created_at,content.content_id LIMIT 64`,bindings:[scope.projectAccessId,scope.organizationId,scope.projectId,scope.ownerUserId,user.userId,
        job.job_id,user.streamId,projectContextId,user.userId,now,now,job.job_id,job.document_id,
        user.userId,now,job.job_id,user.streamId,job.document_id,responseId,responseId,
        ...projectExecutionBindings(scope,job.document_id)]};
  }
  return{sql:`SELECT ${sharedSelect},CASE WHEN json_extract(content.content,'$.preserved_at') IS NOT NULL THEN 'governed-evidence' ELSE 'transient-private' END AS classification,0 AS policy_version
    FROM private_content content
    JOIN private_content source ON source.owner_id=content.owner_id AND source.kind='document-artifact-input'
      AND source.redacted_at IS NULL AND source.expires_at>? AND source.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND json_valid(source.content)=1
      AND json_extract(source.content,'$.job_id')=? AND json_extract(source.content,'$.document_id')=?
    WHERE content.owner_id=? AND content.kind='provider-response' AND content.redacted_at IS NULL AND content.expires_at>? AND content.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND json_valid(content.content)=1 AND json_extract(content.content,'$.job_id')=?
      AND json_extract(content.content,'$.stream_id')=? AND json_extract(content.content,'$.document_id')=?
      AND (?='' OR json_extract(content.content,'$.response_id')=?)
      AND NOT EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.resource_kind='job' AND resource.resource_id=?)
      AND NOT EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.resource_kind='content' AND resource.resource_id IN(content.content_id,source.content_id))
    ORDER BY content.created_at,content.content_id LIMIT 64`,bindings:[now,job.job_id,job.document_id,user.userId,now,job.job_id,user.streamId,job.document_id,responseId,responseId,job.job_id]};
}

async function privatePresentationCandidateRows(env:WorkerEnv,user:PilotUser,job:DocumentJobRow,projectContextId:string,responseId=""){
  const query=privatePresentationCandidateQuery(user,job,projectContextId,responseId);
  return query?(await env.DB.prepare(query.sql).bind(...query.bindings).all<PrivatePresentationCandidateRow>()).results:[];
}

type PresentationAccountingEvidence={reservations:Record<string,unknown>[];usage:Record<string,unknown>[]};
function presentationAccountingEvidenceQuery(user:PilotUser,job:DocumentJobRow){
  const prefix=job.job_id+":attempt:",scope=user.projectExecution;
  const custody=scope?`EXISTS(SELECT 1 FROM project_budget_reservation_scopes held_scope
    WHERE (held_scope.reservation_kind,held_scope.reservation_id,held_scope.organization_id,held_scope.project_access_id,held_scope.actor_user_id,held_scope.workspace_scope_id)
      =('usd',reservation.reservation_id,?,?,?,reservation.workspace_id))`
    :`NOT EXISTS(SELECT 1 FROM project_budget_reservation_scopes held_scope WHERE held_scope.reservation_kind='usd' AND held_scope.reservation_id=reservation.reservation_id)`;
  return{sql:`SELECT json_object('reservations',json((SELECT json_group_array(json_object(
      'reservation_id',reservation_id,'status',status,'reserved_microusd',reserved_microusd,'used_microusd',used_microusd))
    FROM(SELECT reservation.* FROM cost_budget_reservations reservation
      WHERE reservation.owner_id=? AND reservation.stream_id=? AND reservation.operation='document-render:slides'
        AND(reservation.correlation_id=? OR reservation.correlation_id=? OR substr(reservation.correlation_id,1,?)=?) AND ${custody}
      ORDER BY reservation.reservation_id))),
    'usage',json((SELECT json_group_array(json(payload)) FROM(SELECT payload FROM events
      WHERE stream_id=? AND actor='worker:policy' AND type='GenerationUsageRecorded' AND json_valid(payload)=1
        AND json_extract(payload,'$.document_id')=?
        AND(json_extract(payload,'$.operation')='document-render:slides' OR substr(json_extract(payload,'$.operation'),1,23)='document-render:slides:')
        AND(correlation_id=? OR correlation_id=? OR substr(correlation_id,1,?)=?)
      ORDER BY event_id)))) AS evidence`,
    bindings:[user.billingUserId??user.userId,user.streamId,job.correlation_id,job.job_id,prefix.length,prefix,
      ...(scope?[scope.organizationId,scope.projectAccessId,user.userId]:[]),
      user.streamId,job.document_id,job.correlation_id,job.job_id,prefix.length,prefix] as Array<string|number>};
}

/** Materialize independent proofs instead of nesting deep private-source/ACL expressions.
 * This same final statement certifies reads and the preservation transaction. */
function presentationCandidateDisclosureQuery(user:PilotUser,job:DocumentJobRow,projectContextId:string,responseId:string,accountingEvidence:string){
  const snapshot=user.authorizationSnapshot,source=privatePresentationCandidateQuery(user,job,projectContextId,responseId);
  if(!snapshot||!source)return null;
  const financial=presentationAccountingEvidenceQuery(user,job);
  return{
    ctes:`WITH candidate_principal AS MATERIALIZED(${PRINCIPAL_WITH_ACCESS_SQL}),
      candidate_authority AS MATERIALIZED(SELECT 1 AS authorized FROM candidate_principal principal
        WHERE(principal.user_id,principal.role,principal.updated_at,COALESCE(principal.permission_epoch,''),
          COALESCE(principal.grants_json,'[]'),COALESCE(principal.organizations_json,'[]'),COALESCE(principal.projects_json,'[]'),
          COALESCE(principal.identity_policies_json,'[]'),COALESCE(principal.approved_canvas_requirements,0))=(?,?,?,?,?,?,?,?,?)
          AND principal.consent_version IS ?),
      candidate_custody AS MATERIALIZED(${source.sql}),
      candidate_accounting AS MATERIALIZED(${financial.sql})`,
    from:"candidate_custody CROSS JOIN candidate_authority CROSS JOIN candidate_accounting",
    where:`candidate_authority.authorized=1 AND candidate_accounting.evidence=?
      AND EXISTS(SELECT 1 FROM document_jobs current_job WHERE(current_job.job_id,current_job.owner_id,current_job.stream_id,
        current_job.document_id,current_job.kind,current_job.status,current_job.correlation_id)=(?,?,?,?,?,?,?)
        AND current_job.request_json IS ? AND current_job.result_json IS ?)`,
    bindings:[user.userId,user.userId,user.role,snapshot.updatedAt,snapshot.rawEpoch,snapshot.grants,snapshot.organizations,
      snapshot.projects,snapshot.identityPolicies,snapshot.canvasRequirements,user.consentVersion,...source.bindings,...financial.bindings,
      accountingEvidence,job.job_id,job.owner_id,job.stream_id,job.document_id,job.kind,job.status,job.correlation_id,job.request_json,job.result_json] as Array<string|number|null>,
  };
}

/** Last await before disclosure: audit writes, hashes and assessments happen before this read-only batch.
 * Nothing from these internal SQL proofs or private row copies is serialized to the client. */
async function certifyPresentationCandidateDisclosures(env:WorkerEnv,user:PilotUser,entries:Array<{job:DocumentJobRow;contextId:string;candidates:VerifiedPresentationCandidate[]}>){
  const nonempty=entries.filter(entry=>entry.candidates.length);
  if(!nonempty.length)return true;
  const queries=nonempty.map(({job,contextId,candidates})=>presentationCandidateDisclosureQuery(user,job,contextId,candidates.length===1?candidates[0]!.summary.responseId:"",candidates[0]!.accountingEvidence));
  if(queries.some(query=>!query))return false;
  const statements=queries.map(query=>env.DB.prepare(`${query!.ctes} SELECT candidate_custody.* FROM ${query!.from} WHERE ${query!.where}`).bind(...query!.bindings));
  const current=await env.DB.batch(statements);
  return nonempty.every((entry,index)=>{
    const rows=(current[index]?.results??[]) as PrivatePresentationCandidateRow[];
    return entry.candidates.every(({row})=>rows.some(value=>value.content_id===row.content_id&&value.content===row.content
      &&value.expires_at===row.expires_at&&value.created_at===row.created_at&&value.classification===row.classification
      &&value.policy_version===row.policy_version&&value.source_content_id===row.source_content_id
      &&value.source_content===row.source_content&&value.source_expires_at===row.source_expires_at
      &&Date.parse(value.read_expires_at)>Date.now()));
  });
}

function presentationOriginalValidation(job:DocumentJobRow,row:PrivatePresentationCandidateRow,envelope:Record<string,unknown>,candidate:Record<string,unknown>|undefined,sourceReceiptHash:string){
  const identity={response_id:envelope.response_id,content_sha256:envelope.content_sha256,
    source_snapshot_sha256:envelope.source_snapshot_sha256,source_content_id:row.source_content_id,source_receipt_sha256:sourceReceiptHash};
  if(row.classification==="governed-evidence"&&!Object.hasOwn(envelope,"original_validation"))return{schema_version:1,adapter_version:null,outcome:"unconfirmed",...identity};
  if(Object.hasOwn(envelope,"original_validation")){
    const saved=envelope.original_validation&&typeof envelope.original_validation==="object"&&!Array.isArray(envelope.original_validation)?envelope.original_validation as Record<string,unknown>:{};
    if(saved.schema_version===1&&["rejected","accepted","unconfirmed"].includes(String(saved.outcome))
      &&Object.entries(identity).every(([key,value])=>saved[key]===value)
      &&(saved.adapter_version===null||typeof saved.adapter_version==="string"))return saved;
    return{schema_version:1,adapter_version:null,outcome:"unconfirmed",...identity};
  }
  const checkpoint=parseResult(job);
  const object=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
  const receipt=object(checkpoint.generationReceipt),validation=object(object(checkpoint.plannerInput).validation);
  const reconciliation=object(validation.adapter_reconciliation);
  const responseIds=validation.provider_response_ids;
  // A cached recovery flag can become stale. The original successful selected plan
  // is independent evidence only with its exact original response set, final verdict
  // and source receipt. Current parsing alone cannot invent an original acceptance.
  const originalPlan=candidate?parseDocumentArtifactContent(JSON.stringify(checkpoint.artifactPlan??null)):null;
  const originalPlanAccepted=Boolean(originalPlan&&checkpoint.plannerResponseId===envelope.response_id
    &&Array.isArray(responseIds)&&responseIds.length>0&&responseIds.every(id=>typeof id==="string"&&id)
    &&responseIds.at(-1)===envelope.response_id&&JSON.stringify(responseIds)===JSON.stringify(checkpoint.plannerResponseIds)
    &&reconciliation.final_issue_count===0&&typeof reconciliation.adapter_version==="string"
    &&reconciliation.adapter_version===receipt.presentation_adapter_version
    &&receipt.input_ref===row.source_content_id&&receipt.source_snapshot_sha256===envelope.source_snapshot_sha256);
  return{...presentationCandidateOriginalValidation(checkpoint,candidate?.locallyRecoverable===true||originalPlanAccepted),...identity};
}

async function verifiedPresentationCandidates(env:WorkerEnv,user:PilotUser,job:DocumentJobRow,projectContextId:string,responseId=""):Promise<VerifiedPresentationCandidate[]>{
  if(job.kind!=="render_document"||!["failed","partial","completed"].includes(job.status)||job.owner_id!==user.userId||job.stream_id!==user.streamId)return[];
  const checkpoint=parseResult(job);
  const request=parseRequest(job);
  const checkpointCandidates=Array.isArray(checkpoint.presentationCandidates)?checkpoint.presentationCandidates.filter((value):value is Record<string,unknown>=>Boolean(value)&&typeof value==="object"&&!Array.isArray(value)):[];
  const recordedResponses=new Set([...(Array.isArray(checkpoint.plannerResponseIds)?checkpoint.plannerResponseIds.map(String):[]),String(checkpoint.plannerResponseId??"")].filter(Boolean));
  const retained=await privatePresentationCandidateRows(env,user,job,projectContextId,responseId);
  if(!retained.length)return[];
  const receiptCheckpoint=checkpoint.generationReceipt&&typeof checkpoint.generationReceipt==="object"&&!Array.isArray(checkpoint.generationReceipt)?checkpoint.generationReceipt as Record<string,unknown>:{};
  const financial=presentationAccountingEvidenceQuery(user,job);
  const financialRow=await env.DB.prepare(financial.sql).bind(...financial.bindings).first<{evidence:string}>();
  if(!financialRow)return[];
  const accountingEvidence=financialRow.evidence,accountingState=JSON.parse(accountingEvidence) as PresentationAccountingEvidence;
  const verified:VerifiedPresentationCandidate[]=[];
  for(const [ordinal,row] of retained.entries()){
    let envelope:Record<string,unknown>;let receipt:Record<string,unknown>;
    try{envelope=JSON.parse(row.content) as Record<string,unknown>;receipt=JSON.parse(row.source_content) as Record<string,unknown>;}catch{continue;}
    const snapshot=receipt.document_snapshot&&typeof receipt.document_snapshot==="object"&&!Array.isArray(receipt.document_snapshot)?receipt.document_snapshot as Record<string,unknown>:null;
    const receiptSource=receipt.source&&typeof receipt.source==="object"&&!Array.isArray(receipt.source)?receipt.source as Record<string,unknown>:{};
    const receiptRequest=receipt.request&&typeof receipt.request==="object"&&!Array.isArray(receipt.request)?receipt.request as Record<string,unknown>:{};
    let slideCountPolicy:SlideCountPolicy|undefined;
    try{slideCountPolicy=request.slideCountPolicy===undefined?undefined:readSlideCountPolicy(request.slideCountPolicy);}catch{continue;}
    if(!sameSlideCountPolicy(slideCountPolicy,receiptRequest.slide_count_policy)||!sameSlideCountPolicy(slideCountPolicy,envelope.slide_count_policy))continue;
    const receiptWorkflow=receiptRequest.production_workflow&&typeof receiptRequest.production_workflow==="object"&&!Array.isArray(receiptRequest.production_workflow)?receiptRequest.production_workflow as Record<string,unknown>:null;
    const workflowSnapshot=receipt.production_workflow_snapshot&&typeof receipt.production_workflow_snapshot==="object"&&!Array.isArray(receipt.production_workflow_snapshot)?receipt.production_workflow_snapshot as Record<string,unknown>:null;
    const raw=typeof envelope.output_text==="string"?envelope.output_text:"";
    const candidateResponse=String(envelope.response_id??"");
    const candidate=checkpointCandidates.find((entry)=>entry.responseId===candidateResponse);
    const sourceVersions=Array.isArray(receipt.source_block_versions)?receipt.source_block_versions:[];
    const documentRevision=snapshot?documentGenerationRevision({snapshot,sourceBlockVersions:sourceVersions,documentId:job.document_id}):"";
    const sourceHash=snapshot?await sourceSnapshotSha256(snapshot):"";
    const rawBytes=new TextEncoder().encode(raw).byteLength;
    if(!snapshot||receipt.job_id!==job.job_id||receipt.document_id!==job.document_id||receipt.artifact_kind!=="slides"
      ||!raw||!candidateResponse||rawBytes>MAX_PROVIDER_ARTIFACT_CANDIDATE_BYTES
      ||envelope.job_id!==job.job_id||envelope.stream_id!==job.stream_id||envelope.document_id!==job.document_id
      ||envelope.document_revision!==documentRevision||envelope.source_snapshot_sha256!==sourceHash||receiptSource.snapshot_sha256!==sourceHash
      ||await retainedPresentationContentSha256(raw)!==String(envelope.content_sha256??"")
      ||recordedResponses.size&&!recordedResponses.has(candidateResponse)
      ||!candidate&&row.classification!=="governed-evidence")continue;
    if((request.workflowId||request.workflowStageId)&&(!receiptWorkflow||!workflowSnapshot||receiptWorkflow.id!==request.workflowId||receiptWorkflow.stage_id!==request.workflowStageId||JSON.stringify(productionWorkflowSourceIdentity(Array.isArray(receiptWorkflow.sources)?receiptWorkflow.sources as ProductionWorkflowSource[]:[]))!==JSON.stringify(productionWorkflowSourceIdentity(Array.isArray(request.workflowSources)?request.workflowSources as ProductionWorkflowSource[]:[]))))continue;
    if(candidate&&(candidate.contentRef!==row.content_id||candidate.contentExpiresAt!==row.expires_at||candidate.responseId!==candidateResponse
      ||candidate.documentRevision!==documentRevision||candidate.sourceSnapshotSha256!==sourceHash
      ||candidate.contentSha256!==envelope.content_sha256||Number(candidate.candidateBytes??-1)!==rawBytes
      ||candidate.model!==envelope.model||candidate.compiledSnapshotSha256!==envelope.compiled_snapshot_sha256
      ||candidate.pageIndex!==envelope.page_index||candidate.pageCount!==envelope.page_count||candidate.globalStartIndex!==envelope.global_start_index))continue;
    const originalValidation=presentationOriginalValidation(job,row,envelope,candidate,await retainedPresentationContentSha256(row.source_content));
    const reviewOnlyReason=historicalPresentationValidationRejection(checkpoint,PRESENTATION_ADAPTER_VERSION)
      ||originalValidation.outcome==="rejected"&&originalValidation.adapter_version!==PRESENTATION_ADAPTER_VERSION
      ?"historical-validation-rejection" as const:row.classification==="governed-evidence"&&originalValidation.outcome==="unconfirmed"?"validation-provenance-unavailable" as const:undefined;
    const pageIndex=Number(envelope.page_index??0),pageCount=Number(envelope.page_count??1),globalStartIndex=Number(envelope.global_start_index??0);
    const plannedSlideCount=Number(envelope.planned_slide_count??receiptRequest.predicted_slide_count??receiptRequest.item_count??request.itemCount??0);
    const requestedSlideCount=slideCountPolicy?.kind==="flexible"?null:Number(envelope.requested_slide_count??receiptRequest.requested_slide_count??request.requestedSlideCount??plannedSlideCount);
    const mode=String(envelope.production_mode??receiptRequest.production_mode??request.productionMode??"manual");
    if(!Number.isSafeInteger(plannedSlideCount)||plannedSlideCount<1||plannedSlideCount>MAX_MANAGED_PRESENTATION_SLIDES
      ||requestedSlideCount!==null&&(!Number.isSafeInteger(requestedSlideCount)||requestedSlideCount<1)
      ||!Number.isSafeInteger(pageIndex)||!Number.isSafeInteger(pageCount)||pageIndex<0||pageIndex>=pageCount
      ||!Number.isSafeInteger(globalStartIndex)||globalStartIndex<0
      ||mode==="managed"&&(pageCount!==Math.ceil(plannedSlideCount/8)||globalStartIndex!==pageIndex*8)
      ||mode!=="managed"&&(pageCount!==1||pageIndex!==0||globalStartIndex!==0))continue;
    const documentTitle=typeof envelope.document_title==="string"?envelope.document_title:String((snapshot.document as Record<string,unknown>|undefined)?.title??"Presentation");
    const compiledSnapshot={...(receiptWorkflow?workflowSnapshot??snapshot:snapshot),document:{id:job.document_id,title:documentTitle}};
    const planned=checkpoint.productionPlan&&typeof checkpoint.productionPlan==="object"&&!Array.isArray(checkpoint.productionPlan)
      ?checkpoint.productionPlan as ManagedProductionPlan
      :mode==="managed"?buildManagedProductionPlan("slides",compiledSnapshot,{requestedSlideCount:plannedSlideCount}):null;
    if(planned&&(planned.scenes.length!==plannedSlideCount||planned.providerBatchCount!==pageCount))continue;
    const sceneSlice=planned?.scenes.slice(globalStartIndex,globalStartIndex+Math.min(8,plannedSlideCount-globalStartIndex))??[];
    const sourceSnapshot=planned?combinedSceneSnapshot(compiledSnapshot,sceneSlice):compiledSnapshot;
    const expectedPageCount=planned?sceneSlice.length:Math.min(MAX_MANUAL_PRESENTATION_SLIDES,plannedSlideCount);
    const productionPage=planned?{pageIndex,pageCount,globalStartIndex,totalItems:plannedSlideCount,authoredSlideNumbers:inferPresentationSourceOutline(compiledSnapshot).slides.map((slide)=>slide.number),phase:(pageCount===1?"complete":pageIndex===0?"opening":pageIndex===pageCount-1?"final":"continuation") as "complete"|"opening"|"continuation"|"final",priorSummary:"",priorEnding:"",priorVisibleCopy:[]}:undefined;
    const presentationStyle=typeof request.presentationStyle==="string"&&isSlideStylePresetId(request.presentationStyle)?request.presentationStyle:undefined;
    const assessment=assessStoredPresentationCandidate(raw,sourceSnapshot,{itemCount:expectedPageCount,...(slideCountPolicy?{slideCountPolicy}:{requestedSlideCount:plannedSlideCount}),presentationStyle,presentationFidelity:request.presentationFidelity==="creative"?"creative":"faithful",...(planned?{productionScenes:sceneSlice,productionPage}:{})});
    const candidateOrdinal=checkpointCandidates.findIndex((entry)=>entry.responseId===candidateResponse);
    const samePage=candidateOrdinal>=0
      ?checkpointCandidates.slice(0,candidateOrdinal).filter((entry)=>Number(entry.pageIndex??0)===pageIndex).length
      :retained.slice(0,ordinal).filter((previous)=>{try{return Number((JSON.parse(previous.content) as Record<string,unknown>).page_index??0)===pageIndex;}catch{return false;}}).length;
    const stage: "initial"|"repair"=envelope.attempt_stage==="repair"||envelope.attempt_stage!=="initial"&&samePage%2===1?"repair":"initial";
    const providerAttempt=Number.isSafeInteger(Number(envelope.provider_attempt))&&Number(envelope.provider_attempt)>0?Number(envelope.provider_attempt):candidateOrdinal>=0?candidateOrdinal+1:ordinal+1;
    const issueMetadata={pageIndex,pageCount,globalStartIndex,providerAttempt,stage};
    const groups=combinedContextGroups(compiledSnapshot);
    const labels=new Map(groups.map((group)=>[group.id,group.name]));
    const assignedGroups=new Set(assessment.output?.items.flatMap((item)=>item.context_group_ids??[])??[]);
    const missingContextGroupLabels=groups.filter((group)=>!assignedGroups.has(group.id)).map((group)=>group.name);
    const issues=safePresentationCandidateIssues(assessment.issues,issueMetadata);
    const generatedSlideCount=assessment.output?.items.length??0;
    const summary:PresentationCandidateSummary={
      responseId:candidateResponse,jobId:job.job_id,documentId:job.document_id,model:String(envelope.model??""),
      capturedAt:String(envelope.captured_at??candidate?.capturedAt??row.created_at),expiresAt:row.expires_at,
      retentionClass:row.classification==="governed-evidence"?"governed-evidence":"transient-private",stage,providerAttempt,
      pageIndex,pageCount,globalStartIndex,generatedSlideCount,requestedSlideCount,plannedSlideCount,...(slideCountPolicy?{slideCountPolicy}:{}),
      providerBatchCount:Number(envelope.provider_batch_count??planned?.providerBatchCount??1),
      providerCalls:Math.max(recordedResponses.size,Number(receiptCheckpoint.actual_provider_call_count??0),providerAttempt),
      settledCostMicrousd:null,
      complete:Boolean(originalValidation.outcome==="accepted"&&!reviewOnlyReason&&assessment.output&&issues.length===0&&pageCount===1&&slideCountAccepted(generatedSlideCount,slideCountPolicy,plannedSlideCount)&&(slideCountPolicy?.kind==="flexible"||requestedSlideCount===plannedSlideCount)&&missingContextGroupLabels.length===0),
      ...(reviewOnlyReason?{reviewOnlyReason}:{}),
      missingContextGroupLabels,issues,
    };
    const sourceContract=assessment.sourceContract;
    const privateReferences=[...sourceContract.sources.flatMap((source)=>[source.alias,source.sourceId,source.blockId??"",...source.contextGroupIds]),...groups.map((group)=>group.id)];
    const slides=sanitizePresentationCandidateSlides(assessment.output?.items??[],labels,privateReferences);
    const citationChecks=sanitizePresentationCitationChecks(presentationCitationEvidenceChecks(assessment.output?.items??[],sourceContract,{pageStart:globalStartIndex,pageSize:expectedPageCount}),privateReferences);
    let rawOutput:Record<string,unknown>={};try{rawOutput=JSON.parse(raw) as Record<string,unknown>;}catch{/* Invalid paid JSON remains reviewable as metadata only. */}
    const rawItems=Array.isArray(rawOutput.items)?rawOutput.items:[];
    const normalizationChanges=slides.flatMap((slide,index)=>{
      const original=rawItems[index]&&typeof rawItems[index]==="object"?(rawItems[index] as Record<string,unknown>).slide:null;
      const originalVisual=original&&typeof original==="object"?(original as Record<string,unknown>).visual:null;
      const originalValue=originalVisual&&typeof originalVisual==="object"?sanitizePresentationCandidateText((originalVisual as Record<string,unknown>).value,privateReferences):"";
      const normalizedValue=slide.slide?.visual.value??"";
      return originalValue!==normalizedValue?[{path:`items.${index}.slide.visual.value`,originalValue,normalizedValue,reason:normalizedValue?"Recovered from distinct authorized source evidence.":"Removed because the generated value repeated existing slide copy or was not source-authorized."}]:[];
    });
    const sourcePresentation=assessment.output?.presentation;
    const presentation=sourcePresentation?{...sourcePresentation,theme:sanitizePresentationCandidateText(sourcePresentation.theme,privateReferences),footerLabel:sanitizePresentationCandidateText(sourcePresentation.footerLabel,privateReferences),...(sourcePresentation.fontFamily?{fontFamily:sanitizePresentationCandidateText(sourcePresentation.fontFamily,privateReferences)}:{})}:null;
    const detail:PresentationCandidateDetail={...summary,title:sanitizePresentationCandidateText(assessment.output?.title,privateReferences),summary:sanitizePresentationCandidateText(assessment.output?.summary,privateReferences),presentation,slides,citationChecks,normalizationChanges};
    verified.push({row,envelope,summary,detail,originalValidation,accountingEvidence});
  }
  const accounting=presentationCandidateAccounting(checkpoint,{...accountingState,responseIds:verified.map(candidate=>candidate.summary.responseId),
    minimumAttempt:Math.max(0,...verified.map(candidate=>candidate.summary.providerAttempt)),
    preserved:verified.flatMap(candidate=>{const saved=candidate.envelope.preserved_accounting;
      if(!saved||typeof saved!=="object"||Array.isArray(saved))return[];
      const record=saved as Record<string,unknown>;
      return["response_id","content_sha256","source_snapshot_sha256","source_content_id","source_receipt_sha256"].every(key=>record[key]===candidate.originalValidation[key])?[record]:[];})});
  for(const candidate of verified){
    candidate.summary={...candidate.summary,settledCostMicrousd:accounting.settled_cost_microusd,
      providerCalls:Math.max(candidate.summary.providerAttempt,accounting.actual_provider_call_count??0,accounting.attempted_provider_call_count??0)};
    candidate.detail={...candidate.detail,...candidate.summary,accounting};
    if(responseId&&presentationCandidateRevisionEligible(job,candidate)&&(!user.projectExecution||hasCapability(user,"project.author",{organizationId:user.projectExecution.organizationId,projectAccessId:user.projectExecution.projectAccessId}))){
      const request=parseRequest(job),receipt=JSON.parse(candidate.row.source_content) as Record<string,unknown>;
      const snapshot={...(receipt.document_snapshot as Record<string,unknown>),document:{id:job.document_id,title:String(candidate.envelope.document_title??"Presentation")}};
      const assessed=assessStoredPresentationCandidate(String(candidate.envelope.output_text??""),snapshot,{itemCount:candidate.summary.plannedSlideCount,
        requestedSlideCount:candidate.summary.plannedSlideCount,presentationFidelity:request.presentationFidelity==="creative"?"creative":"faithful"});
      const references=assessed.sourceContract.sources.flatMap(source=>[source.alias,source.sourceId,source.blockId??"",...source.contextGroupIds]);
      references.push(...combinedContextGroups(snapshot).map(group=>group.id));
      const fields=presentationCandidateEditableFields(String(candidate.envelope.output_text??""),references);
      if(fields.length)candidate.detail.revision={token:await presentationCandidateRevisionToken(user,job,projectContextId,candidate),fields};
    }
  }
  return verified.sort((left,right)=>left.summary.providerAttempt-right.summary.providerAttempt
    ||left.summary.pageIndex-right.summary.pageIndex
    ||left.summary.capturedAt.localeCompare(right.summary.capturedAt)
    ||left.summary.responseId.localeCompare(right.summary.responseId));
}

/** Reassess a bounded number of actor-owned paid drafts without exposing their private checkpoints. */
async function freshlyRecoverablePresentationRows(env:WorkerEnv,user:PilotUser,rows:DocumentJobRow[],projectContextId=""){
  const certified=new Map<string,boolean>();
  const candidates=rows.filter((row)=>{
    if(row.status!=="failed"||row.kind!=="render_document"||parseRequest(row).artifactKind!=="slides")return false;
    const checkpoint=parseResult(row);
    return Boolean(checkpoint.costReservationId&&(checkpoint.plannerResponseId||Array.isArray(checkpoint.plannerResponseIds)&&checkpoint.plannerResponseIds.length));
  }).slice(0,4);
  for(const compact of candidates){
    try{
      const retained=await readJob(env,user.userId,compact.job_id);
      if(!retained||retained.owner_id!==user.userId||retained.stream_id!==user.streamId||retained.document_id!==compact.document_id)continue;
      const checkpoint=parseResult(retained);
      if(historicalPresentationValidationRejection(checkpoint,PRESENTATION_ADAPTER_VERSION)){certified.set(compact.job_id,false);continue;}
      const reservationId=String(checkpoint.costReservationId??"");
      const reservation=reservationId?await costBudgetReservation(env,user.billingUserId??user.userId,reservationId):null;
      if(!reservation||reservation.status!=="settled"||reservation.stream_id!==user.streamId||reservation.operation!=="document-render:slides")continue;
      const verified=await verifiedPresentationCandidates(env,user,retained,projectContextId);
      certified.set(compact.job_id,verified.some((candidate)=>candidate.summary.complete));
    }catch{/* Historical or unauthorized drafts fail closed; no provider request is made. */}
  }
  return rows.map((row)=>{
    if(!certified.has(row.job_id))return row;
    return{...row,result_json:JSON.stringify({...parseResult(row),recoverablePresentationCandidate:certified.get(row.job_id)===true})};
  });
}

async function preservePresentationCandidate(env:WorkerEnv,user:PilotUser,job:DocumentJobRow,projectContextId:string,candidate:VerifiedPresentationCandidate){
  if(candidate.summary.retentionClass==="governed-evidence")return await certifyPresentationCandidateDisclosures(env,user,[{job,contextId:projectContextId,candidates:[candidate]}])?candidate.summary:null;
  const now=new Date().toISOString();
  const scope=user.projectExecution;
  const policy=scope?await env.DB.prepare("SELECT evidence_days,version FROM organization_retention_policies WHERE organization_id=?").bind(scope.organizationId).first<{evidence_days:number;version:number}>():null;
  const configuredDays=Number(policy?.evidence_days??env.FORMA_EVIDENCE_RETENTION_DAYS??DEFAULT_EVIDENCE_RETENTION_DAYS);
  const evidenceDays=Math.max(1,Math.min(3650,Number.isFinite(configuredDays)?Math.floor(configuredDays):DEFAULT_EVIDENCE_RETENTION_DAYS));
  const candidateExpiry=Math.max(Date.parse(candidate.row.expires_at),Math.min(Date.parse(candidate.row.source_expires_at),Date.parse(candidate.row.created_at)+evidenceDays*86_400_000));
  if(!Number.isFinite(candidateExpiry)||candidateExpiry<=Date.now())return null;
  const expiresAt=new Date(candidateExpiry).toISOString();
  const envelope={...candidate.envelope,preserved_at:now,preservation_expires_at:expiresAt,retention_class:"governed-evidence",
    original_validation:candidate.originalValidation,preserved_accounting:{...candidate.originalValidation,accounting:candidate.detail.accounting}};
  const checkpoint=parseResult(job);
  if(Array.isArray(checkpoint.presentationCandidates))checkpoint.presentationCandidates=checkpoint.presentationCandidates.map((entry)=>entry&&typeof entry==="object"&&(entry as Record<string,unknown>).responseId===candidate.summary.responseId?{...entry as Record<string,unknown>,contentExpiresAt:expiresAt,retentionClass:"governed-evidence"}:entry);
  const statements=[];
  if(scope){
    if(!projectContextId)return null;
    const policyVersion=Number(policy?.version??0);
    const projectGuard=` AND EXISTS(SELECT 1 FROM project_context_sessions selection WHERE selection.context_id=? AND selection.principal_user_id=?
      AND selection.organization_id=? AND selection.project_access_id=? AND selection.revoked_at IS NULL AND selection.expires_at>?)
      AND((?=0 AND NOT EXISTS(SELECT 1 FROM organization_retention_policies policy WHERE policy.organization_id=?))
        OR EXISTS(SELECT 1 FROM organization_retention_policies policy WHERE policy.organization_id=? AND policy.version=?))
      AND NOT EXISTS(SELECT 1 FROM organization_deletion_jobs deletion WHERE deletion.organization_id=? AND deletion.status IN('pending','partial','processing','completed'))
      AND ${activeProjectExecutionSql}`;
    const guardBindings=[projectContextId,user.userId,scope.organizationId,scope.projectAccessId,now,policyVersion,scope.organizationId,scope.organizationId,policyVersion,scope.organizationId,...projectExecutionBindings(scope,job.document_id)];
    statements.push(env.DB.prepare(`UPDATE private_content SET content=?,expires_at=? WHERE content_id=? AND owner_id=? AND kind='provider-response'
      AND redacted_at IS NULL AND content=? AND expires_at=? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND EXISTS(SELECT 1 FROM private_content_retention_scopes retention
        WHERE retention.content_id=private_content.content_id AND retention.organization_id=? AND retention.project_access_id=?
          AND retention.actor_user_id=? AND retention.classification='transient-private' AND retention.assigned_expires_at=private_content.expires_at)${projectGuard}`)
      .bind(JSON.stringify(envelope),expiresAt,candidate.row.content_id,user.userId,candidate.row.content,candidate.row.expires_at,scope.organizationId,scope.projectAccessId,user.userId,...guardBindings));
    statements.push(env.DB.prepare(`UPDATE private_content_retention_scopes SET classification='governed-evidence',policy_version=?,assigned_expires_at=?
      WHERE content_id=? AND organization_id=? AND project_access_id=? AND project_id=? AND actor_user_id=? AND classification='transient-private'
        AND EXISTS(SELECT 1 FROM private_content content WHERE content.content_id=private_content_retention_scopes.content_id AND content.owner_id=? AND content.kind='provider-response' AND content.expires_at=?)`)
      .bind(policyVersion,expiresAt,candidate.row.content_id,scope.organizationId,scope.projectAccessId,scope.projectId,user.userId,user.userId,expiresAt));
  }else{
    statements.push(env.DB.prepare(`UPDATE private_content SET content=?,expires_at=? WHERE content_id=? AND owner_id=? AND kind='provider-response'
      AND redacted_at IS NULL AND content=? AND expires_at=? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT EXISTS(SELECT 1 FROM project_resource_scopes resource
        WHERE resource.resource_kind='content' AND resource.resource_id=private_content.content_id)`)
      .bind(JSON.stringify(envelope),expiresAt,candidate.row.content_id,user.userId,candidate.row.content,candidate.row.expires_at));
  }
  const checkpointJson=JSON.stringify(checkpoint);
  if(job.result_json!==null)statements.push(env.DB.prepare("UPDATE document_jobs SET result_json=?,updated_at=? WHERE job_id=? AND owner_id=? AND stream_id=? AND result_json=?")
    .bind(checkpointJson,now,job.job_id,user.userId,user.streamId,job.result_json));
  const savedJob={...job,result_json:job.result_json===null?null:checkpointJson};
  const savedCandidate:VerifiedPresentationCandidate={...candidate,row:{...candidate.row,content:JSON.stringify(envelope),expires_at:expiresAt,
    classification:"governed-evidence",policy_version:scope?Number(policy?.version??0):0},envelope,
    summary:{...candidate.summary,retentionClass:"governed-evidence",expiresAt}};
  const proof=presentationCandidateDisclosureQuery(user,savedJob,projectContextId,candidate.summary.responseId,candidate.accountingEvidence);
  if(!proof)return null;
  // Zero-row updates do not abort D1 batches. Exact bytes and the same final live
  // authority/custody/accounting proof must hold or this SELECT rolls the batch back.
  statements.push(env.DB.prepare(`${proof.ctes} SELECT CASE WHEN EXISTS(SELECT 1 FROM ${proof.from} WHERE ${proof.where}
    AND(candidate_custody.content_id,candidate_custody.content,candidate_custody.expires_at,candidate_custody.classification,
      candidate_custody.policy_version,candidate_custody.source_content_id,candidate_custody.source_content,candidate_custody.source_expires_at)=(?,?,?,?,?,?,?,?))
    THEN 1 ELSE json_extract('invalid-presentation-evidence-preservation','$') END AS presentation_preservation_verified`)
    .bind(...proof.bindings,savedCandidate.row.content_id,savedCandidate.row.content,expiresAt,"governed-evidence",savedCandidate.row.policy_version,
      candidate.row.source_content_id,candidate.row.source_content,candidate.row.source_expires_at));
  let results;
  try{results=await env.DB.batch(statements);}catch{return null;}
  if(results.slice(0,-1).some((result)=>Number(result.meta.changes??0)!==1))return null;
  await appendAuditEvent(env,user.streamId,`user:${user.userId}`,"PresentationCandidatePreserved",{job_id:job.job_id,document_id:job.document_id,provider_response_id:candidate.summary.responseId,retention_class:"governed-evidence",expires_at:expiresAt},job.job_id);
  return await certifyPresentationCandidateDisclosures(env,user,[{job:savedJob,contextId:projectContextId,candidates:[savedCandidate]}])?savedCandidate.summary:null;
}


/** Explicit human revision is separate from paid-response recovery; historical recovery guards are unchanged. */
function presentationCandidateRevisionEligible(job:DocumentJobRow,candidate:VerifiedPresentationCandidate){
  const request=parseRequest(job),summary=candidate.summary,accounting=candidate.detail.accounting;
  return request.artifactKind==="slides"&&String(request.productionMode??"manual")==="manual"
    &&request.workflowId===undefined&&request.workflowStageId===undefined&&request.workflowSources===undefined
    &&summary.pageCount===1&&summary.pageIndex===0&&summary.globalStartIndex===0&&summary.providerBatchCount===1
    &&summary.requestedSlideCount===summary.plannedSlideCount&&summary.generatedSlideCount===summary.plannedSlideCount
    &&summary.plannedSlideCount>=1&&summary.plannedSlideCount<=MAX_MANUAL_PRESENTATION_SLIDES
    &&["accepted","rejected"].includes(String(candidate.originalValidation.outcome))
    &&accounting?.settled_cost_complete===true&&accounting.reservation_status==="settled"
    &&accounting.reservation_microusd===0&&accounting.unresolved_provider_call_count===0
    &&accounting.provider_submission_uncertain===false&&accounting.actual_provider_call_count===accounting.attempted_provider_call_count;
}

async function presentationCandidateRevisionToken(user:PilotUser,job:DocumentJobRow,contextId:string,candidate:VerifiedPresentationCandidate){
  return retainedPresentationContentSha256(JSON.stringify({schema:1,adapter:PRESENTATION_ADAPTER_VERSION,
    actor:user.userId,stream:user.streamId,contextId,jobId:job.job_id,responseId:candidate.summary.responseId,
    candidate:candidate.row.content,source:candidate.row.source_content,request:job.request_json,
    checkpoint:job.result_json,accounting:candidate.accountingEvidence}));
}

function presentationCandidateRevisionProof(user:PilotUser,job:DocumentJobRow,contextId:string,candidate:VerifiedPresentationCandidate){
  const proof=presentationCandidateDisclosureQuery(user,job,contextId,candidate.summary.responseId,candidate.accountingEvidence);
  if(!proof)return null;
  const row=candidate.row;
  return{...proof,where:`${proof.where} AND (candidate_custody.content_id,candidate_custody.content,candidate_custody.expires_at,
    candidate_custody.created_at,candidate_custody.classification,candidate_custody.policy_version,
    candidate_custody.source_content_id,candidate_custody.source_content,candidate_custody.source_expires_at)=(?,?,?,?,?,?,?,?,?)`,
    bindings:[...proof.bindings,row.content_id,row.content,row.expires_at,row.created_at,row.classification,row.policy_version,
      row.source_content_id,row.source_content,row.source_expires_at]};
}


/** Source events can lose private bodies without advancing the immutable event head. Bind those exact reads too. */
async function presentationRevisionSourceProofs(env:WorkerEnv,scope:OutputScope,events:EventRow[]):Promise<OutputSqlAssertion[]>{
  const expected=new Map(events.map(event=>[event.eventId,event])),absent:string[]=[];
  for(let offset=0;offset<events.length;offset+=1500){
    const ids=events.slice(offset,offset+1500).map(event=>event.eventId);
    const rows=await env.DB.prepare(`SELECT event.event_id,event.payload,secret.private_json,secret.owner_id,
      secret.project_id,secret.document_id,secret.redacted_at FROM events event
      LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id
      WHERE event.stream_id=? AND event.event_id IN(SELECT value FROM json_each(?))`)
      .bind(`creative:${scope.ownerUserId}`,JSON.stringify(ids)).all<{event_id:string;payload:string;private_json:string|null;owner_id:string|null;project_id:string|null;document_id:string|null;redacted_at:string|null}>();
    if(rows.results.length!==ids.length)throw new OutputConflictError("presentation_revision_source_changed");
    for(const row of rows.results){
      const live=row.private_json!==null&&row.redacted_at===null,raw=live?row.private_json!:row.payload;
      if(JSON.stringify(JSON.parse(raw))!==JSON.stringify(expected.get(row.event_id)?.payload))throw new OutputConflictError("presentation_revision_source_changed");
      if(live){
        if(row.owner_id!==scope.ownerUserId)throw new OutputConflictError("presentation_revision_source_changed");
        rememberOutputPrivateBody(scope,row.event_id,raw,{projectId:row.project_id,documentId:row.document_id});
      }else absent.push(row.event_id);
    }
  }
  const proofs=retainedOutputBodyAssertions(scope);
  for(let offset=0;offset<absent.length;offset+=1500)proofs.push({sql:"NOT EXISTS(SELECT 1 FROM event_private_payloads WHERE private_event_id IN(SELECT value FROM json_each(?)) AND redacted_at IS NULL)",bindings:[JSON.stringify(absent.slice(offset,offset+1500))]});
  return proofs;
}

type PresentationCandidateRevisionOutcome={revision:PresentationCandidateRevisionResult}|{error:string;status:number;issues?:ReturnType<typeof safePresentationCandidateIssues>};

async function reviseRetainedPresentationCandidate(env:WorkerEnv,user:PilotUser,job:DocumentJobRow,contextId:string,candidate:VerifiedPresentationCandidate,input:unknown):Promise<PresentationCandidateRevisionOutcome>{
  const fail=(error="presentation_revision_unavailable",status=409)=>({error,status});
  const body=input&&typeof input==="object"&&!Array.isArray(input)?input as Record<string,unknown>:{};
  if(Object.keys(body).some(key=>!["revisionToken","idempotencyKey","confirmed","edits"].includes(key))
    ||body.confirmed!==true||typeof body.revisionToken!=="string"||!/^[a-f0-9]{64}$/u.test(body.revisionToken)
    ||typeof body.idempotencyKey!=="string"||!/^[A-Za-z0-9][A-Za-z0-9_-]{15,95}$/u.test(body.idempotencyKey))return fail("presentation_revision_request_invalid",400);
  if(!presentationCandidateRevisionEligible(job,candidate))return fail();
  if(body.revisionToken!==await presentationCandidateRevisionToken(user,job,contextId,candidate))return fail("presentation_revision_stale");
  const request=parseRequest(job),checkpoint=parseResult(job),envelope=candidate.envelope;
  const reservationId=String(checkpoint.costReservationId??""),reservation=reservationId?await costBudgetReservation(env,user.billingUserId??user.userId,reservationId):null;
  const plannerResponseId=String(checkpoint.plannerResponseId??"");
  if(!reservation||reservation.status!=="settled"||reservation.stream_id!==user.streamId||reservation.operation!=="document-render:slides"||!plannerResponseId)return fail("presentation_revision_settlement_required");
  if(!await env.DB.prepare("SELECT 1 AS present FROM events WHERE stream_id=? AND actor='worker:policy' AND type='GenerationUsageRecorded' AND json_extract(payload,'$.planner_response_id')=? AND json_extract(payload,'$.document_id')=? AND json_extract(payload,'$.cost_reservation_id')=? LIMIT 1")
    .bind(user.streamId,plannerResponseId,job.document_id,reservationId).first())return fail("presentation_revision_settlement_required");

  const originalHead=await streamHead(env,user.streamId);
  const events=user.projectExecution?await readProjectSourceEvents(env,user.projectExecution):await readWorkspaceEvents(env,user.streamId);
  if(await streamHead(env,user.streamId)!==originalHead)return fail("presentation_revision_source_changed");
  const document=foldEvents(events,Number.POSITIVE_INFINITY,job.document_id,user.projectExecution?.projectId??"").documents.find(value=>value.id===job.document_id);
  if(!document||user.projectExecution&&document.projectId!==user.projectExecution.projectId)return fail();
  const projectScope=user.projectExecution;
  const revisionScope:OutputScope={kind:projectScope?"project":"personal",key:job.job_id,actorUserId:user.userId,
    ownerUserId:projectScope?.ownerUserId??user.userId,projectId:document.projectId,documentId:document.id,
    organizationId:projectScope?.organizationId??null,projectAccessId:projectScope?.projectAccessId??null,contextId:contextId||null};
  let sourceProofs:OutputSqlAssertion[];
  try{sourceProofs=await presentationRevisionSourceProofs(env,revisionScope,events);}
  catch(error){if(error instanceof OutputConflictError)return fail(error.code,error.status);throw error;}
  let trusted:Awaited<ReturnType<typeof authoritativePresentationRecoveryContext>>;
  try{
    trusted=await authoritativePresentationRecoveryContext(events,{documentId:job.document_id,projectId:document.projectId,
      canvasId:typeof request.canvasId==="string"?request.canvasId:undefined,contextSetId:typeof request.contextSetId==="string"?request.contextSetId:undefined,
      snapshot:request.snapshot&&typeof request.snapshot==="object"&&!Array.isArray(request.snapshot)?request.snapshot as Record<string,unknown>:undefined,
      sourceBlockVersions:Array.isArray(request.sourceBlockVersions)?request.sourceBlockVersions as Array<Record<string,unknown>>:undefined,
      documentRevision:String(request.documentRevision??"")},String(envelope.source_snapshot_sha256??""));
  }catch(error){if(error instanceof ContextIntegrityError)return fail("presentation_revision_source_changed");throw error;}
  const authored=standingConstraints(events).map(item=>({preference_id:item.preferenceId,axis:item.axis,value:item.value,polarity:item.polarity,authority:"authored",source_event_refs:item.evidenceRefs,source_claim_ref:item.sourceClaimRef??null}));
  const trustedSnapshot=trusted.snapshot as Record<string,unknown>;
  const supplied=Array.isArray(trustedSnapshot.standing_constraints)?trustedSnapshot.standing_constraints.filter((value):value is Record<string,unknown>=>Boolean(value)&&typeof value==="object"&&!Array.isArray(value)):[];
  const constraints=[...new Map([...supplied,...authored].map(value=>[String(value.preference_id??`${value.polarity}:${value.axis}:${value.value}`),value])).values()];
  const snapshot={...trusted.snapshot,document:{id:document.id,title:document.title},...(constraints.length?{standing_constraints:constraints}:{})};
  if(envelope.compiled_snapshot_sha256!==await sourceSnapshotSha256(snapshot)||envelope.document_revision!==trusted.documentRevision)return fail("presentation_revision_source_changed");
  let count:ReturnType<typeof resolvePresentationCountRequest>;
  try{count=resolvePresentationCountRequest(request);}catch{return fail();}
  if(count.slideCountPolicy?.kind==="flexible"||count.itemCount!==candidate.summary.plannedSlideCount
    ||!sameSlideCountPolicy(count.slideCountPolicy,envelope.slide_count_policy))return fail();
  const options={itemCount:count.itemCount,...(count.slideCountPolicy?{slideCountPolicy:count.slideCountPolicy}:{requestedSlideCount:count.itemCount}),
    presentationStyle:typeof request.presentationStyle==="string"&&isSlideStylePresetId(request.presentationStyle)?request.presentationStyle:undefined,
    presentationFidelity:request.presentationFidelity==="creative"?"creative" as const:"faithful" as const};
  const raw=String(envelope.output_text??""),original=assessStoredPresentationCandidate(raw,snapshot,options);
  const privateReferences=original.sourceContract.sources.flatMap(source=>[source.alias,source.sourceId,source.blockId??"",...source.contextGroupIds]);
  privateReferences.push(...combinedContextGroups(snapshot).map(group=>group.id));
  const edited=applyPresentationCandidateEdits(raw,body.edits,privateReferences);
  if(!edited)return fail("presentation_revision_edits_invalid",400);
  const provisional=parseDocumentArtifactContent(edited.raw);
  if(!provisional)return fail("presentation_revision_edits_invalid",400);
  const editedObject=JSON.parse(edited.raw) as Record<string,unknown>;
  editedObject.content_markdown=presentationCandidateRevisionMarkdown(provisional);
  let assessment=assessStoredPresentationCandidate(JSON.stringify(editedObject),snapshot,options);
  if(assessment.output){
    editedObject.content_markdown=presentationCandidateRevisionMarkdown(assessment.output);
    assessment=assessStoredPresentationCandidate(JSON.stringify(editedObject),snapshot,options);
  }
  if(!assessment.output||assessment.issues.length)return{error:"presentation_revision_validation_failed",status:422,
    issues:safePresentationCandidateIssues(assessment.issues,{pageIndex:0,pageCount:1,globalStartIndex:0,providerAttempt:candidate.summary.providerAttempt,stage:candidate.summary.stage})};
  const plan=assessment.output;
  if(plan.content_markdown!==presentationCandidateRevisionMarkdown(plan))return fail("presentation_revision_validation_failed",422);
  const serialized=JSON.stringify(plan);
  if(new TextEncoder().encode(serialized).byteLength>MAX_PROVIDER_ARTIFACT_CANDIDATE_BYTES)return fail("presentation_revision_too_large",413);
  const scope=user.projectExecution,storageOwnerId=scope?.ownerUserId??user.userId;
  const artifactId=`presentation-revision-${await retainedPresentationContentSha256(JSON.stringify({actor:user.userId,stream:user.streamId,
    project:scope?.projectAccessId??null,job:job.job_id,response:candidate.summary.responseId,key:body.idempotencyKey}))}`;
  const intentHash=await retainedPresentationContentSha256(JSON.stringify({schema:1,token:body.revisionToken,
    edits:(body.edits as PresentationCandidateEdit[]).map(edit=>({path:edit.path,value:edit.value})).sort((a,b)=>a.path.localeCompare(b.path))}));
  const proof=presentationCandidateRevisionProof(user,job,contextId,candidate);
  if(!proof)return fail();
  const readExisting=async()=>env.DB.prepare(`${proof.ctes},
    revision_current AS MATERIALIZED(SELECT 1 FROM ${proof.from} WHERE ${proof.where})
    SELECT existing.payload FROM revision_current
    JOIN events existing ON existing.stream_id=? AND existing.type='DocumentRenderCompleted' AND existing.actor=?
      AND json_extract(existing.payload,'$.artifact_id')=?
    JOIN private_content saved ON saved.content_id=json_extract(existing.payload,'$.content_ref') AND saved.owner_id=?
      AND saved.kind='document-artifact' AND saved.redacted_at IS NULL AND saved.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')`)
    .bind(...proof.bindings,user.streamId,`user:${user.userId}`,artifactId,storageOwnerId).first<{payload:string}>();
  const result=(reused:boolean):PresentationCandidateRevisionOutcome=>({revision:{jobId:job.job_id,documentId:job.document_id,
    responseId:candidate.summary.responseId,artifactId,providerCalls:0,incrementalCostMicrousd:0,approval:"unapproved",reused}});
  const existingResult=(existing:{payload:string}|null):PresentationCandidateRevisionOutcome|null=>{
    if(!existing)return null;
    const payload=JSON.parse(existing.payload) as {request_digest?:string};
    return payload.request_digest===intentHash?result(true):fail("presentation_revision_idempotency_conflict");
  };
  const existing=existingResult(await readExisting());if(existing)return existing;
  const now=new Date().toISOString(),canonicalHash=await retainedPresentationContentSha256(serialized);
  const lineage={schema_version:1,source_job_id:job.job_id,source_response_id:candidate.summary.responseId,
    actor_user_id:user.userId,original_content_sha256:envelope.content_sha256,source_snapshot_sha256:envelope.source_snapshot_sha256,
    source_receipt_sha256:await retainedPresentationContentSha256(candidate.row.source_content),
    edited_content_sha256:await retainedPresentationContentSha256(edited.raw),content_sha256:canonicalHash,
    original_validation:candidate.originalValidation,validation_adapter:PRESENTATION_ADAPTER_VERSION,changed_paths:edited.changedPaths,intent_sha256:intentHash};
  const receipt={schema_version:1,artifact_id:artifactId,artifact_kind:"slides",document_id:document.id,project_id:document.projectId,
    captured_at:now,document_snapshot:trusted.snapshot,source_block_versions:trusted.sourceBlockVersions,
    source:{snapshot_sha256:envelope.source_snapshot_sha256,document_revision:trusted.documentRevision},
    request:{item_count:count.itemCount,requested_slide_count:count.itemCount,...(count.slideCountPolicy?{slide_count_policy:count.slideCountPolicy}:{}),production_mode:"manual",source_surface:job.source_surface},
    planner:{provider:"local",model:"human-revision",provider_call_count:0},
    accounting:{settled_cost_microusd:0,incremental_cost_microusd:0,source_generation_settled_cost_microusd:candidate.detail.accounting!.settled_cost_microusd},
    presentation_revision:lineage};
  const stored=await preparePrivateContent(env,storageOwnerId,"document-artifact",serialized);
  const inputStored=await preparePrivateContent(env,user.userId,"document-artifact-input",JSON.stringify(receipt),scope);
  const completed=makeEvent(user.streamId,originalHead+1,`user:${user.userId}`,"server:presentation-candidate-revision",artifactId,"DocumentRenderCompleted",{
    artifact_id:artifactId,artifact_kind:"slides",document_id:document.id,project_id:document.projectId,
    request_digest:intentHash,content_sha256:canonicalHash,changed_fields:edited.changedPaths,
    source_block_versions:trusted.sourceBlockVersions,requested_by_user_id:user.userId,title:plan.title,summary:plan.summary,
    content_ref:stored.contentId,content_expires_at:stored.expiresAt,input_ref:inputStored.contentId,input_expires_at:inputStored.expiresAt,
    item_count:plan.items.length,items:plan.items.map((item,index)=>({id:`${artifactId}-item-${index+1}`,title:item.title,slide:item.slide??null,
      context_group_ids:item.context_group_ids??[],media_url:null,media_type:null,width:null,height:null})),presentation:plan.presentation??null,
    media_url:null,media_type:null,provider:"local",provider_job_id:null,model_id:"human-revision",planner_model_id:null,planner_response_id:null,
    reference_inputs:[],used_reference_pixels:false,latency_ms:0,
    settings:{item_count:count.itemCount,requested_slide_count:count.itemCount,predicted_slide_count:count.itemCount,production_mode:"manual",
      presentation_style:options.presentationStyle??null,presentation_fidelity:options.presentationFidelity,
      reserved_cost_microusd:0,settled_cost_microusd:0,incremental_cost_microusd:0,
      presentation_revision:{schema_version:1,intent_sha256:intentHash,content_sha256:canonicalHash,validation_adapter:PRESENTATION_ADAPTER_VERSION,
        source_job_id:job.job_id,source_response_id:candidate.summary.responseId,changed_paths:edited.changedPaths,provider_calls:0,approval:"unapproved"}},
    source_surface:job.source_surface},{causationId:null});
  const completedBindings=eventWriteBindings(completed);
  const authority=outputScopeAuthority({kind:scope?"project":"personal",key:artifactId,actorUserId:user.userId,ownerUserId:storageOwnerId,
    projectId:document.projectId,documentId:document.id,organizationId:scope?.organizationId??null,projectAccessId:scope?.projectAccessId??null,contextId:contextId||null},"author");
  const statements=[...outputAssertionStatements(env,authority),...sourceProofs.flatMap(proof=>outputAssertionStatements(env,proof)),
    ...outputAssertionStatements(env,{sql:`EXISTS(${proof.ctes} SELECT 1 FROM ${proof.from} WHERE ${proof.where})`,bindings:proof.bindings}),
    ...outputAssertionStatements(env,{sql:`(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?
      AND NOT EXISTS(SELECT 1 FROM events WHERE stream_id=? AND type='DocumentRenderCompleted' AND json_extract(payload,'$.artifact_id')=?)`,
      bindings:[user.streamId,originalHead,user.streamId,artifactId]}),
    // Only this revision's inserts: do not run preparePrivateContent's unrelated expiry cleanup.
    ...stored.statements.slice(0,stored.requiredInserts),...inputStored.statements.slice(0,inputStored.requiredInserts),
    env.DB.prepare(`INSERT INTO event_write_stage (${EVENT_WRITE_COLUMNS}) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(...completedBindings)];
  if(scope){
    const projectHead=await env.DB.prepare("SELECT COALESCE(MAX(project_sequence),0) AS head FROM project_event_scopes WHERE project_access_id=? AND organization_id=?")
      .bind(scope.projectAccessId,scope.organizationId).first<{head:number}>();
    statements.push(...outputAssertionStatements(env,{sql:"(SELECT COALESCE(MAX(project_sequence),0) FROM project_event_scopes WHERE project_access_id=? AND organization_id=?)=?",bindings:[scope.projectAccessId,scope.organizationId,projectHead?.head??0]}));
    statements.push(env.DB.prepare("INSERT INTO project_event_scopes(event_id,project_access_id,organization_id,project_id,owner_user_id,source_stream_id,source_sequence,project_sequence,actor_user_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .bind(completed.eventId,scope.projectAccessId,scope.organizationId,scope.projectId,scope.ownerUserId,user.streamId,completed.sequence,(projectHead?.head??0)+1,user.userId,now));
    for(const[kind,id]of[["artifact",artifactId],["content",stored.contentId]])statements.push(prepareProjectResourceScopeStatement(env,scope,{kind:kind!,id:id!,visibility:"collaborative_output",sourceEventId:completed.eventId,actorUserId:user.userId},now,true));
    statements.push(env.DB.prepare("UPDATE project_resource_scopes SET source_event_id=? WHERE resource_kind='content' AND resource_id=? AND project_access_id=? AND organization_id=? AND actor_user_id=? AND visibility='actor_private'")
      .bind(completed.eventId,inputStored.contentId,scope.projectAccessId,scope.organizationId,user.userId));
    statements.push(...outputAssertionStatements(env,{sql:`EXISTS(SELECT 1 FROM project_event_scopes WHERE event_id=? AND project_access_id=?)
      AND (SELECT COUNT(*) FROM project_resource_scopes WHERE source_event_id=? AND project_access_id=? AND actor_user_id=?
        AND ((resource_kind='artifact' AND resource_id=? AND visibility='collaborative_output') OR(resource_kind='content' AND resource_id=? AND visibility='collaborative_output') OR(resource_kind='content' AND resource_id=? AND visibility='actor_private')))=3
      AND EXISTS(SELECT 1 FROM private_content_retention_scopes WHERE content_id=? AND project_access_id=? AND actor_user_id=? AND classification='governed-evidence')`,
      bindings:[completed.eventId,scope.projectAccessId,completed.eventId,scope.projectAccessId,user.userId,artifactId,stored.contentId,inputStored.contentId,inputStored.contentId,scope.projectAccessId,user.userId]}));
  }
  statements.push(...outputAssertionStatements(env,{sql:`EXISTS(SELECT 1 FROM events WHERE event_id=? AND stream_id=? AND payload=?)
    AND EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND kind='document-artifact' AND content=? AND redacted_at IS NULL)
    AND EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND kind='document-artifact-input' AND content=? AND redacted_at IS NULL)
    AND EXISTS(SELECT 1 FROM event_private_payloads WHERE private_event_id=? AND owner_id=? AND private_json=? AND redacted_at IS NULL)`,
    bindings:[completed.eventId,user.streamId,completedBindings[12]!,stored.contentId,storageOwnerId,serialized,inputStored.contentId,user.userId,JSON.stringify(receipt),completed.eventId,storageOwnerId,JSON.stringify(completed.payload)]}));
  try{await env.DB.batch(statements);}catch{
    // A concurrent replay may have won. This read repeats private custody and principal authority before disclosure.
    return existingResult(await readExisting())??fail("presentation_revision_conflict");
  }
  return result(false);
}

type PresentationRecoveryResult={job:DocumentJobRow;recovered:true}|{error:string;status:number;reason?:string};

/** Publish the original, fully retained Image without a provider request or a new lease. */
export async function finalizeRetainedImageJob(env:WorkerEnv,current:PilotUser,jobId:string,expectedContextId?:string|null):Promise<{job:DocumentJobRow;finalized:true}|{error:string;status:number}>{
  const unavailable=(error="output_image_finalization_unavailable",status=409)=>({error,status});
  const selectedContextId=expectedContextId;
  try{
    if(requireConsent(current))return unavailable("consent_required",403);
    if(!outputSchemaIsReady(env.DB))return unavailable();
    const found=await env.DB.prepare(`SELECT *, (SELECT slot.slot_id FROM output_operation_slots slot WHERE slot.job_id=document_jobs.job_id) AS output_slot_id
      FROM document_jobs WHERE job_id=? AND owner_id=? AND length(CAST(request_json AS BLOB))<=2000000
        AND length(CAST(COALESCE(result_json,'') AS BLOB))<=2000000`).bind(jobId,current.userId).first<DocumentJobRow>();
    if(!found){
      const present=await env.DB.prepare("SELECT 1 AS present FROM document_jobs WHERE job_id=? AND owner_id=?").bind(jobId,current.userId).first();
      return present?unavailable():unavailable("job_not_found",404);
    }
    if(found.owner_id!==current.userId)return unavailable("job_not_found",404);
    if(found.kind!=="generate"||!found.output_slot_id||!["committing","failed"].includes(found.status))return unavailable();
    const user=await documentJobPrincipal(env,found,current);
    if(!user||user.userId!==found.owner_id)return unavailable("output_image_finalization_authority_unavailable",403);
    const projectAuthority=documentJobProjectAuthority(user,found.document_id,found.job_id);
    if(projectAuthority)await readOutputProofBatch(env,[projectAuthority]);
    const binding=await loadOutputJobBinding(env,user,found);
    if(!binding)return unavailable();
    if(selectedContextId!==undefined&&binding.scope.contextId!==selectedContextId)return unavailable("output_execution_context_changed",403);
    const authority=await resolveOutputImageFinalizationAuthority(env,binding.scope,binding.slot,found,user.billingUserId??user.userId);
    const job=authority.originalJob,scope=authority.scope,slot=authority.slot;
    const mediaVerifier=createImageFinalizationMediaVerifier(env,scope.ownerUserId);
    const proof=await readImageFinalizationProof({env,user,job,scope,slot,mediaVerifier,
      readProofBatch:(assertions,reads)=>readOutputProofBatch(env,assertions,reads),
      reconstructInput:(stage,anchors)=>reconstructRetainedImageInput({env,user,job,authority,stage,anchors,mediaVerifier}),
      authorityAssertions:[...authority.assertions,...(projectAuthority?[projectAuthority]:[])],
      publicationAuthorityAssertions:[...authority.lateAssertions,...(projectAuthority?[projectAuthority]:[])],
    });
    let financial=await proof.readFinancialProof();
    const checkpoint=parseResult(job);
    if(financial.needsSettlement){
      await settleDocumentGenerationBudgets(env,proof.payerUserId,{
        reservationId:String(checkpoint.reservationId),costReservationId:String(checkpoint.costReservationId),
        usedTokens:financial.totals.usedTokens,usedMicrousd:financial.totals.usedMicrousd,reason:"retained_image_finalization",
        assertions:[...proof.settlementAssertions,...financial.assertions],
      });
      // Settlement is a separate durable transition. A later publication loss
      // retains it; replay verifies it rather than charging the counters again.
      financial=await proof.readFinancialProof();
    }
    if(financial.needsSettlement)return unavailable("output_image_finalization_settlement_required");
    const stored=await preparePrivateContent(env,user.userId,"provider-output",proof.stage.planned.raw,user.projectExecution,undefined,undefined,undefined,proof.expiresAt);
    const promptStored=await preparePrivateContent(env,user.userId,"prompt",proof.stage.rendered.image.prompt,user.projectExecution,undefined,undefined,undefined,proof.expiresAt);
    const publication=buildRetainedImagePublication({job,input:proof.input,stage:proof.stage,head:authority.head,stored,promptStored,
      financial:{totals:financial.totals,receipts:proof.receipts}});
    const events=[publication.complete,publication.usage],completedAt=new Date().toISOString();
    const previousReceipt=checkpoint.generationReceipt&&typeof checkpoint.generationReceipt==="object"&&!Array.isArray(checkpoint.generationReceipt)
      ?checkpoint.generationReceipt as Record<string,unknown>:{};
    const generationReceipt:Record<string,unknown>={...previousReceipt,...financial.generationReceipt};
    delete generationReceipt.failure_code;delete generationReceipt.failure_category;delete generationReceipt.failure_stage;
    const result:Record<string,unknown>={...checkpoint,...safeResult({head:authority.head+2,appended:events,promoted:publication.promoted}),
      generationReceipt,stage:"completed",progressMessage:"Completed",imageFinalized:true};
    delete result.errorDetail;delete result.resultUnavailable;
    const resultJson=JSON.stringify(result);
    const projectPublication=await prepareOutputImageFinalizationProjectPublicationStatements(env,{scope,slot,job,
      completionEventId:publication.complete.eventId,expectedGrantStatus:authority.expectedGrantStatus},events);
    const assertions=(items:readonly OutputSqlAssertion[])=>items.flatMap(item=>outputAssertionStatements(env,item));
    const changed=()=>outputAssertionStatements(env,{sql:"changes()=1"});
    const statements=[...assertions([...proof.assertions,...financial.assertions]),
      ...outputAssertionStatements(env,{sql:"(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?",bindings:[job.stream_id,authority.head]})];
    // Only the two original result payloads; unrelated retention cleanup is not
    // part of finalization. Each conditional custody insert must really happen.
    for(const prepared of [stored,promptStored])for(const statement of prepared.statements.slice(0,prepared.requiredInserts))statements.push(statement,...changed());
    for(const event of events)statements.push(env.DB.prepare(`INSERT INTO event_write_stage (${EVENT_WRITE_COLUMNS}) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(...eventWriteBindings(event)),...changed());
    // Recheck late source and retained evidence while the original job still
    // owns this transaction; the source proof permits only our appended events.
    statements.push(...financial.publicationStatements(events),
      env.DB.prepare(`UPDATE document_jobs SET status='completed',result_json=?,error_message=NULL,completed_at=?,lease_expires_at=NULL,updated_at=?
        WHERE job_id=? AND owner_id=? AND stream_id=? AND correlation_id=? AND attempt_count=? AND status=? AND request_json IS ? AND result_json IS ? AND lease_expires_at IS ?`)
        .bind(resultJson,completedAt,completedAt,job.job_id,job.owner_id,job.stream_id,job.correlation_id,job.attempt_count,job.status,job.request_json,job.result_json,job.lease_expires_at),...changed(),
      ...prepareOutputJobOutcomeStatements(env,job),
      ...assertions(authority.publicationAssertions({resultJson,completedAt,completionEventId:publication.complete.eventId})),
      ...projectPublication);
    const committed=await env.DB.batch(statements);
    if(committed.length!==statements.length||statements.some((_,index)=>committed[index]?.success!==true))return unavailable("output_image_finalization_commit_unconfirmed");
    return{job:{...job,status:"completed",result_json:resultJson,error_message:null,completed_at:completedAt,lease_expires_at:null,updated_at:completedAt},finalized:true};
  }catch(error){
    if(error instanceof OutputConflictError)return unavailable(error.code,error.status);
    // A lost CAS, head or late proof never routes to the paid runner or a
    // generic outcome writer. Any already-settled pair remains settled.
    return unavailable();
  }
}

/** Recover a fully paid presentation solely from actor-private retained provider output. */
async function recoverRetainedPresentation(env:WorkerEnv,user:PilotUser,row:DocumentJobRow,projectContextId=""):Promise<PresentationRecoveryResult>{
  const failed=(reason="paid_evidence_unavailable")=>({error:"presentation_recovery_unavailable",status:409,reason} as const);
  const request=parseRequest(row);
  const checkpoint=parseResult(row);
  if(row.status==="completed"&&checkpoint.presentationRecovered===true)return{job:row,recovered:true};
  if(row.kind!=="render_document"||row.status!=="failed"||request.artifactKind!=="slides"||Date.parse(row.expires_at)<=Date.now()||user.projectExecution&&!projectContextId)return failed();
  if(!await activeProjectExecution(env,user,row.document_id,row.job_id))return{error:"job_not_found",status:404};
  const candidates=Array.isArray(checkpoint.presentationCandidates)?checkpoint.presentationCandidates.filter((value):value is Record<string,unknown>=>Boolean(value)&&typeof value==="object"&&!Array.isArray(value)):[];
  const receipt=checkpoint.generationReceipt&&typeof checkpoint.generationReceipt==="object"&&!Array.isArray(checkpoint.generationReceipt)?checkpoint.generationReceipt as Record<string,unknown>:null;
  const originalHash=String(receipt?.source_snapshot_sha256??"");
  const responseIds=new Set(Array.isArray(checkpoint.plannerResponseIds)?checkpoint.plannerResponseIds.map(String).filter(Boolean):[]);
  const plannerResponseId=String(checkpoint.plannerResponseId??"");
  if(plannerResponseId)responseIds.add(plannerResponseId);
  if(!receipt||!originalHash||!plannerResponseId||!candidates.length)return failed("paid_response_receipt_missing");
  if(historicalPresentationValidationRejection(checkpoint,PRESENTATION_ADAPTER_VERSION))return failed("historical_validation_rejection");
  const reservationId=String(checkpoint.costReservationId??"");
  const reservation=reservationId?await costBudgetReservation(env,user.billingUserId??user.userId,reservationId):null;
  if(!reservation||reservation.status!=="settled"||reservation.stream_id!==user.streamId||reservation.operation!=="document-render:slides")return failed("settled_reservation_unavailable");
  const paidReceipt=await env.DB.prepare("SELECT payload FROM events WHERE stream_id=? AND type='GenerationUsageRecorded' AND json_extract(payload,'$.planner_response_id')=? AND json_extract(payload,'$.document_id')=? AND json_extract(payload,'$.cost_reservation_id')=? LIMIT 1")
    .bind(user.streamId,plannerResponseId,row.document_id,reservationId).first<{payload:string}>();
  if(!paidReceipt)return failed("settled_usage_receipt_missing");

  const originalHead=await streamHead(env,user.streamId);
  const events=user.projectExecution?await readProjectSourceEvents(env,user.projectExecution):await readWorkspaceEvents(env,user.streamId);
  if(await streamHead(env,user.streamId)!==originalHead)return{error:"presentation_recovery_source_changed",status:409};
  const projection=foldEvents(events,Number.POSITIVE_INFINITY,row.document_id,user.projectExecution?.projectId??"");
  const document=projection.documents.find((candidate)=>candidate.id===row.document_id);
  if(!document||user.projectExecution&&document.projectId!==user.projectExecution.projectId)return{error:"job_not_found",status:404};
  let trusted:Awaited<ReturnType<typeof authoritativePresentationRecoveryContext>>;
  try{
    trusted=await authoritativePresentationRecoveryContext(events,{documentId:row.document_id,projectId:document.projectId,canvasId:typeof request.canvasId==="string"?request.canvasId:undefined,contextSetId:typeof request.contextSetId==="string"?request.contextSetId:undefined,snapshot:request.snapshot&&typeof request.snapshot==="object"&&!Array.isArray(request.snapshot)?request.snapshot as Record<string,unknown>:undefined,sourceBlockVersions:Array.isArray(request.sourceBlockVersions)?request.sourceBlockVersions as Array<Record<string,unknown>>:undefined,documentRevision:String(request.documentRevision??"")},originalHash);
  }catch(error){return error instanceof ContextIntegrityError?{error:"presentation_recovery_source_changed",status:409}:failed();}
  let effectiveSnapshot:Record<string,unknown>=trusted.snapshot;
  if(request.workflowId!==undefined||request.workflowStageId!==undefined||request.workflowSources!==undefined){
    try{
      let workflowScope=user.projectExecution;
      if(!workflowScope&&!user.fictional&&(user.billingUserId??user.userId)===user.userId){const scopes=await ownerDocumentBudgetScopes(env,user.userId,row.document_id,document.projectId);if(scopes.length>1)return{error:"presentation_recovery_source_changed",status:409};if(scopes[0])workflowScope={organizationId:scopes[0].organizationId,projectAccessId:scopes[0].projectAccessId,projectId:document.projectId,ownerUserId:user.userId,actorUserId:user.userId};}
      const resolved=await resolveProductionWorkflowContext({env,events,documentId:row.document_id,projectId:document.projectId,ownerId:workflowScope?.ownerUserId??user.userId,scope:workflowScope,snapshot:trusted.snapshot,workflowId:request.workflowId,workflowStageId:request.workflowStageId,workflowSources:request.workflowSources,requestedFormat:"slides"});
      effectiveSnapshot=resolved.snapshot;
    }catch(error){if(error instanceof ProductionWorkflowContextError)return{error:"presentation_recovery_source_changed",status:409};throw error;}
  }
  const authoredConstraints=standingConstraints(events).map((item)=>({preference_id:item.preferenceId,axis:item.axis,value:item.value,polarity:item.polarity,authority:"authored",source_event_refs:item.evidenceRefs,source_claim_ref:item.sourceClaimRef??null}));
  const trustedSnapshot=effectiveSnapshot as Record<string,unknown>;
  const suppliedConstraints=Array.isArray(trustedSnapshot.standing_constraints)?trustedSnapshot.standing_constraints.filter((value):value is Record<string,unknown>=>Boolean(value)&&typeof value==="object"&&!Array.isArray(value)):[];
  const mergedConstraints=[...new Map([...suppliedConstraints,...authoredConstraints].map((constraint)=>[String(constraint.preference_id??`${constraint.polarity}:${constraint.axis}:${constraint.value}`),constraint])).values()];
  const snapshot={...effectiveSnapshot,document:{id:document.id,title:document.title},...(mergedConstraints.length?{standing_constraints:mergedConstraints}:{})};
  const compiledHash=await sourceSnapshotSha256(snapshot);
  const itemCount=Number(request.itemCount??request.requestedSlideCount??0);
  const requestedSlideCount=Number(request.requestedSlideCount??itemCount);
  let slideCountPolicy:SlideCountPolicy|undefined;
  try{slideCountPolicy=resolvePresentationCountRequest(request).slideCountPolicy;}catch{return failed("requested_slide_count_changed");}
  if(!sameSlideCountPolicy(slideCountPolicy,receipt.slide_count_policy))return failed("slide_count_policy_changed");
  if(!Number.isSafeInteger(itemCount)||itemCount<1||itemCount>MAX_MANUAL_PRESENTATION_SLIDES||!Number.isSafeInteger(requestedSlideCount)||requestedSlideCount!==itemCount)return failed("requested_slide_count_changed");
  const presentationStyle=typeof request.presentationStyle==="string"&&isSlideStylePresetId(request.presentationStyle)?request.presentationStyle:undefined;
  let production:ManagedProductionPlan|null=null;
  if(request.productionMode==="managed"){
    let current:ManagedProductionPlan;
    try{current=buildManagedProductionPlan("slides",snapshot,{requestedSlideCount});}catch{return failed("authorized_chapter_plan_invalid");}
    const recorded=checkpoint.productionPlan&&typeof checkpoint.productionPlan==="object"&&!Array.isArray(checkpoint.productionPlan)?checkpoint.productionPlan as ManagedProductionPlan:null;
    if(!recorded||current.predictedSlideCount!==itemCount||current.providerBatchCount!==1||current.requestedSlideCount!==requestedSlideCount
      ||recorded.predictedSlideCount!==itemCount||recorded.providerBatchCount!==1||recorded.requestedSlideCount!==requestedSlideCount
      ||recorded.scenes.length!==current.scenes.length)return failed("paid_chapter_plan_mismatch");
    const groups=combinedContextGroups(snapshot);
    const groupsById=new Map(groups.map((group)=>[group.id,group]));
    const sourceFacts=(snapshot as Record<string,unknown>).facts;
    const sourceIds=new Set((Array.isArray(sourceFacts)?sourceFacts:[])
      .filter((fact):fact is Record<string,unknown>=>Boolean(fact)&&typeof fact==="object"&&!Array.isArray(fact))
      .map((fact)=>String(fact.block_id??"")));
    const sameMembers=(left:string[],right:string[])=>{
      if(left.length!==right.length||new Set(left).size!==left.length)return false;
      const expected=[...right].sort();
      return[...left].sort().every((value,index)=>value===expected[index]);
    };
    const assignedSources=new Map<string,Set<string>>();
    for(const [index,scene]of recorded.scenes.entries()){
      const expected=current.scenes[index];
      if(!expected||scene.narrativeOrder!==expected.narrativeOrder
        ||!Array.isArray(scene.sourceBlockIds)||!scene.sourceBlockIds.length
        ||!Array.isArray(scene.contextGroupIds)
        ||!sameMembers(scene.contextGroupIds,expected.contextGroupIds)
        ||scene.sourceBlockIds.some((blockId)=>!sourceIds.has(blockId)))return failed("paid_chapter_assignment_mismatch");
      if(!scene.contextGroupIds.length){
        if(!sameMembers(scene.sourceBlockIds,expected.sourceBlockIds))return failed("paid_chapter_source_mismatch");
        continue;
      }
      for(const groupId of scene.contextGroupIds){
        const group=groupsById.get(groupId);
        if(!group)return failed("paid_chapter_group_unavailable");
        const members=new Set(group.members.map((member)=>member.blockId));
        const assigned=assignedSources.get(groupId)??new Set<string>();
        for(const blockId of scene.sourceBlockIds)if(members.has(blockId))assigned.add(blockId);
        if(!assigned.size)return failed("paid_chapter_group_empty");
        assignedSources.set(groupId,assigned);
      }
      if(scene.sourceBlockIds.some((blockId)=>groups.some((group)=>group.application==="isolate"
        &&group.members.some((member)=>member.blockId===blockId)
        &&!scene.contextGroupIds.includes(group.id))))return failed("paid_chapter_isolation_mismatch");
    }
    if(groups.some((group)=>!assignedSources.has(group.id)
      ||group.members.some((member)=>!assignedSources.get(group.id)?.has(member.blockId))))return failed("paid_chapter_coverage_incomplete");
    // The server-owned paid plan is the provider's immutable chapter contract.
    // Replanning after a compiler upgrade may reorder its authorized members;
    // source, chapter, target, isolation, and complete coverage remain verified.
    production=recorded;
  }
  const assessmentSnapshot=production?combinedSceneSnapshot(snapshot,production.scenes):snapshot;
  let plan:DocumentArtifactDraft|null=null;
  let recoveredResponseId="";
  let candidateRejection="paid_provider_response_unavailable";
  for(const candidate of [...candidates].reverse()){
    const responseId=String(candidate.responseId??"");
    if(!responseIds.has(responseId)||Number(candidate.pageCount??1)!==1||Number(candidate.pageIndex??0)!==0||Number(candidate.globalStartIndex??0)!==0||candidate.candidateTruncated===true||Number(candidate.candidateBytes??0)>MAX_PROVIDER_ARTIFACT_CANDIDATE_BYTES||candidate.documentRevision!==trusted.documentRevision||candidate.sourceSnapshotSha256!==originalHash){candidateRejection="paid_provider_receipt_mismatch";continue;}
    if(candidate.compiledSnapshotSha256!==compiledHash){candidateRejection="compiled_source_receipt_mismatch";continue;}
    const retained=await loadPrivateProviderResponse(env,user.userId,String(candidate.contentRef??""),user.projectExecution);
    if(!retained||retained.expires_at!==String(candidate.contentExpiresAt??"")){candidateRejection="private_provider_response_expired";continue;}
    let envelope:Record<string,unknown>;try{envelope=JSON.parse(retained.content) as Record<string,unknown>;}catch{continue;}
    const raw=typeof envelope.output_text==="string"?envelope.output_text:"";
    if(!raw||new TextEncoder().encode(raw).byteLength!==Number(candidate.candidateBytes??-1)||envelope.job_id!==row.job_id||envelope.stream_id!==row.stream_id||envelope.document_id!==row.document_id||envelope.document_revision!==trusted.documentRevision||envelope.source_snapshot_sha256!==originalHash||envelope.compiled_snapshot_sha256!==compiledHash||envelope.response_id!==responseId||envelope.model!==candidate.model||envelope.page_index!==0||envelope.page_count!==1||envelope.global_start_index!==0
      ||!sameSlideCountPolicy(slideCountPolicy,envelope.slide_count_policy)||Number(envelope.requested_slide_count??requestedSlideCount)!==requestedSlideCount||Number(envelope.planned_slide_count??itemCount)!==itemCount||Number(envelope.provider_batch_count??1)!==1
      ||String(envelope.production_mode??"manual")!==(production?"managed":"manual")
      ||await retainedPresentationContentSha256(raw)!==candidate.contentSha256||envelope.content_sha256!==candidate.contentSha256){candidateRejection="paid_provider_response_integrity_mismatch";continue;}
    const originalRows=await privatePresentationCandidateRows(env,user,row,projectContextId,responseId);
    const originalRow=originalRows.find(original=>original.content_id===String(candidate.contentRef??"")&&original.content===retained.content);
    if(!originalRow){candidateRejection="private_provider_source_unavailable";continue;}
    if(originalRow.classification==="governed-evidence"||Object.hasOwn(envelope,"original_validation")){
      const original=presentationOriginalValidation(row,originalRow,envelope,candidate,await retainedPresentationContentSha256(originalRow.source_content));
      if(original.outcome!=="accepted"){candidateRejection=original.outcome==="rejected"?"historical_validation_rejection":"original_validation_provenance_unavailable";continue;}
    }
    const assessment=assessStoredPresentationCandidate(raw,assessmentSnapshot,{itemCount,...(slideCountPolicy?{slideCountPolicy}:{requestedSlideCount}),presentationStyle,presentationFidelity:request.presentationFidelity==="creative"?"creative":"faithful",...(production?{productionScenes:production.scenes}:{})});
    if(assessment.output&&assessment.issues.length===0){plan=assessment.output;recoveredResponseId=responseId;break;}
    candidateRejection="paid_provider_response_validation_failed";
  }
  if(!plan)return failed(candidateRejection);
  if(!await activeProjectExecution(env,user,row.document_id,row.job_id)||await streamHead(env,user.streamId)!==originalHead)return{error:"presentation_recovery_source_changed",status:409};

  const correlationId=`${row.job_id}:recovery:${uuidV7()}`;
  const startedAt=new Date().toISOString();
  const claim=await env.DB.prepare("UPDATE document_jobs SET status='running',correlation_id=?,error_message=NULL,completed_at=NULL,lease_expires_at=?,result_json=?,updated_at=? WHERE job_id=? AND owner_id=? AND stream_id=? AND status='failed' AND correlation_id=?")
    .bind(correlationId,new Date(Date.now()+DOCUMENT_JOB_LEASE_MS).toISOString(),JSON.stringify({...checkpoint,presentationRecoveryOnly:true,stage:"recovering",progressMessage:"Recovering the privately saved presentation without another provider request."}),startedAt,row.job_id,user.userId,user.streamId,row.correlation_id).run();
  if(Number(claim.meta.changes??0)!==1){const current=await readJob(env,user.userId,row.job_id);return current?.status==="completed"&&parseResult(current).presentationRecovered===true?{job:current,recovered:true}:failed();}
  const running={...row,status:"running" as const,correlation_id:correlationId,completed_at:null,error_message:null,result_json:JSON.stringify({...checkpoint,presentationRecoveryOnly:true}),updated_at:startedAt};
  const stagedContent:Array<{contentId:string;ownerId:string;kind:"document-artifact"|"document-artifact-input"}>=[];
  try{
    await beginJobCommit(env,running,"Recovering the privately saved presentation without another provider request.");
    if(!await activeProjectExecution(env,user,row.document_id,row.job_id))throw new Error("project_access_revoked");
    const ownerId=user.userId,storageOwnerId=user.projectExecution?.ownerUserId??ownerId;
    const artifactId=String(checkpoint.artifactId??uuidV7());
    const settledCost=Number(receipt.settled_cost_microusd??reservation.used_microusd??0);
    const model=String(checkpoint.plannerModel??candidateModelFromResponse(candidates,recoveredResponseId)??env.OPENAI_MODEL??"gpt-5.6-terra");
    const productionSystem=production?productionSystemFor(production.format):null;
    const productionQuality=production?scoreManagedProductionPlan(production):null;
    const workflowLineage=request.workflowId&&request.workflowStageId?{workflow_id:String(request.workflowId),workflow_stage_id:String(request.workflowStageId),workflow_sources:Array.isArray(request.workflowSources)?request.workflowSources as ProductionWorkflowSource[]:[]}:null;
    const workflowSettings=workflowLineage?{production_workflow:{id:workflowLineage.workflow_id,stage_id:workflowLineage.workflow_stage_id,sources:workflowLineage.workflow_sources}}:{};
    const inputReceipt={schema_version:1,artifact_id:artifactId,artifact_kind:"slides",document_id:document.id,project_id:document.projectId,captured_at:new Date().toISOString(),document_snapshot:snapshot,source_block_versions:trusted.sourceBlockVersions,request:{item_count:itemCount,requested_slide_count:slideCountPolicy?.kind==="flexible"?null:itemCount,...(slideCountPolicy?{slide_count_policy:slideCountPolicy}:{}),audience:String(request.audience??"general"),tone:String(request.tone??"document-derived"),production_mode:request.productionMode==="managed"?"managed":"manual",source_surface:row.source_surface,...workflowSettings},planner:{provider:"openai",model,response_id:plannerResponseId,recovered_response_id:recoveredResponseId,recovered_without_provider_request:true},accounting:{settled_cost_microusd:settledCost,incremental_cost_microusd:0},...(production?{production:{team:production.team,system:productionSystem,work_units:productionUnitsForPlan(production),plan:production,quality:productionQuality}}:{})};
    const stored=await storePrivateContent(env,storageOwnerId,"document-artifact",JSON.stringify(plan));
    stagedContent.push({contentId:stored.contentId,ownerId:storageOwnerId,kind:"document-artifact"});
    const inputStored=await storePrivateContent(env,ownerId,"document-artifact-input",JSON.stringify(inputReceipt),user.projectExecution);
    stagedContent.push({contentId:inputStored.contentId,ownerId,kind:"document-artifact-input"});
    const items=plan.items.map((item,index)=>({id:`${artifactId}-item-${index+1}`,title:item.title,slide:item.slide??null,context_group_ids:item.context_group_ids??[],media_url:null,media_type:null,width:null,height:null,...(production?{scene_id:production.scenes[index]?.id??null,narrative_order:index+1,generation_order:production.executionOrder.indexOf(production.scenes[index]?.id??"")+1,duration_seconds:null}:{})}));
    const completed=makeEvent(user.streamId,originalHead+1,"worker:renderer",`server:document-job:${row.kind}`,correlationId,"DocumentRenderCompleted",{artifact_id:artifactId,artifact_kind:"slides",document_id:document.id,project_id:document.projectId,source_block_versions:trusted.sourceBlockVersions,requested_by_user_id:ownerId,title:plan.title,summary:plan.summary,content_ref:stored.contentId,content_expires_at:stored.expiresAt,input_ref:inputStored.contentId,input_expires_at:inputStored.expiresAt,item_count:plan.items.length,items,presentation:plan.presentation??null,media_url:null,media_type:null,provider:"openai",provider_job_id:null,model_id:model,planner_model_id:model,planner_response_id:plannerResponseId,recovered_provider_response_id:recoveredResponseId,recovered_without_provider_request:true,reference_inputs:[],used_reference_pixels:false,latency_ms:Number(checkpoint.plannerLatencyMs??0),settings:{item_count:itemCount,authored_slide_count:request.authoredSlideCount??null,requested_slide_count:slideCountPolicy?.kind==="flexible"?null:itemCount,predicted_slide_count:itemCount,...(slideCountPolicy?{slide_count_policy:slideCountPolicy}:{}),presentation_style:presentationStyle??null,presentation_fidelity:request.presentationFidelity??"faithful",reserved_cost_microusd:Number(receipt.reservation_microusd??0),settled_cost_microusd:settledCost,incremental_cost_microusd:0,audience:String(request.audience??"general"),tone:String(request.tone??"document-derived"),production_mode:request.productionMode==="managed"?"managed":"manual",production_team:production?.team??null,production_system:productionSystem,production_quality:productionQuality,...workflowSettings},...(workflowLineage??{}),source_surface:row.source_surface},{causationId:null});
    const usage=makeEvent(user.streamId,originalHead+2,"worker:policy",`server:document-job:${row.kind}`,correlationId,"GenerationUsageRecorded",{operation:"document-render:slides:recovery",artifact_id:artifactId,artifact_kind:"slides",document_id:document.id,reservation_id:checkpoint.reservationId??null,cost_reservation_id:reservationId,input_tokens:0,output_tokens:0,total_tokens:0,planner_tokens:0,reserved_tokens:0,reserved_microusd:0,model_ids:[model],planner_response_id:plannerResponseId,planner_usage_previously_recorded:true,planner_cost_previously_recorded:true,recovered_provider_response_id:recoveredResponseId,recovered_without_provider_request:true,cost_microusd:0,planner_cost_microusd:0,previously_settled_cost_microusd:settledCost},{causationId:completed.eventId});
    if(!await activeProjectExecution(env,user,row.document_id,row.job_id))throw new Error("project_access_revoked");
    const finishedAt=new Date().toISOString();
    const result:Record<string,unknown>={...checkpoint,presentationRecovered:true,recoveredProviderResponseId:recoveredResponseId,recoverablePresentationCandidate:false,generationReceipt:{...receipt,presentation_adapter_version:PRESENTATION_ADAPTER_VERSION,settled_cost_microusd:settledCost,provider_request_status:"completed",reservation_status:"settled",actual_provider_call_count:responseIds.size,recovered_without_provider_request:true},head:usage.sequence,eventIds:[completed.eventId,usage.eventId],artifactId,artifactKind:"slides",stage:"completed",progressMessage:"The saved presentation was recovered without another provider request."};
    delete result.presentationRecoveryOnly;
    const scope=user.projectExecution;
    const projectGuard=scope?` AND ${activeProjectExecutionSql}
      AND EXISTS(SELECT 1 FROM project_context_sessions selection WHERE selection.context_id=? AND selection.principal_user_id=?
        AND selection.organization_id=? AND selection.project_access_id=? AND selection.revoked_at IS NULL AND selection.expires_at>?)`:"";
    const projectBindings=scope?[...projectExecutionBindings(scope,row.document_id),projectContextId,user.userId,scope.organizationId,scope.projectAccessId,finishedAt]:[];
    const insertRecoveredEvent=(event:typeof completed,expectedHead:number,prerequisiteEventId:string|null=null)=>env.DB.prepare(`INSERT INTO event_write_stage (${EVENT_WRITE_COLUMNS})
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
      WHERE (SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?
        AND EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND owner_id=? AND stream_id=? AND correlation_id=? AND status='committing')
        AND (? IS NULL OR EXISTS(SELECT 1 FROM events prerequisite WHERE prerequisite.event_id=? AND prerequisite.stream_id=?))${projectGuard}`)
      .bind(...eventWriteBindings(event),user.streamId,expectedHead,row.job_id,user.userId,user.streamId,correlationId,prerequisiteEventId,prerequisiteEventId,user.streamId,...projectBindings);
    const completionBindings=documentJobCompletionBindings({status:"completed",result,errorMessage:null,completedAt:finishedAt,parentId:parentJobIdFromRequest(request),jobId:row.job_id,ownerId:user.userId,correlationId});
    const completeJob=env.DB.prepare(`UPDATE document_jobs SET status=?,result_json=?,error_message=?,completed_at=?,lease_expires_at=NULL,notified_at=CASE WHEN ? IS NULL THEN notified_at ELSE ? END,updated_at=? WHERE job_id=? AND owner_id=? AND correlation_id=? AND status='committing'
      AND (SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?
      AND EXISTS(SELECT 1 FROM events completed WHERE completed.event_id=? AND completed.stream_id=? AND completed.sequence=?)
      AND EXISTS(SELECT 1 FROM events usage WHERE usage.event_id=? AND usage.stream_id=? AND usage.sequence=?)${projectGuard}`)
      .bind(...completionBindings,user.streamId,originalHead+2,completed.eventId,user.streamId,originalHead+1,usage.eventId,user.streamId,originalHead+2,...projectBindings);
    const committed=await env.DB.batch([insertRecoveredEvent(completed,originalHead),insertRecoveredEvent(usage,originalHead+1,completed.eventId),completeJob]);
    if(committed.some((entry)=>Number(entry.meta.changes??0)!==1))throw new StaleSequenceError(originalHead,await streamHead(env,user.streamId));
    const finished=await readJob(env,user.userId,row.job_id);
    return finished?.status==="completed"?{job:finished,recovered:true}:failed();
  }catch(error){
    const restoredAt=new Date().toISOString();
    for(const content of stagedContent){
      try{
        await env.DB.prepare(`UPDATE private_content SET content='',redacted_at=? WHERE content_id=? AND owner_id=? AND kind=? AND redacted_at IS NULL
          AND NOT EXISTS(SELECT 1 FROM document_jobs completed WHERE completed.job_id=? AND completed.owner_id=? AND completed.stream_id=? AND completed.status='completed')
          AND NOT EXISTS(SELECT 1 FROM events completed WHERE completed.stream_id=? AND completed.type='DocumentRenderCompleted'
            AND(json_extract(completed.payload,'$.content_ref')=private_content.content_id
              OR json_extract(completed.payload,'$.input_ref')=private_content.content_id))
          AND NOT EXISTS(SELECT 1 FROM private_content_retention_scopes scope JOIN organization_retention_policies policy
            ON policy.organization_id=scope.organization_id AND policy.legal_hold=1
            WHERE scope.content_id=private_content.content_id AND scope.classification='governed-evidence')
          AND NOT EXISTS(SELECT 1 FROM private_content_retention_scopes scope JOIN organization_legal_holds hold
            ON hold.organization_id=scope.organization_id AND hold.status='active'
            WHERE scope.content_id=private_content.content_id
              AND(hold.scope_kind='organization' OR hold.scope_kind='project' AND hold.resource_id=scope.project_access_id OR hold.scope_kind='content' AND hold.resource_id=scope.content_id))`)
          .bind(restoredAt,content.contentId,content.ownerId,content.kind,row.job_id,user.userId,user.streamId,user.streamId).run();
      }catch{/* Keep the failed job recoverable even if its unreferenced local staging cannot be cleaned immediately. */}
    }
    await env.DB.prepare("UPDATE document_jobs SET status='failed',correlation_id=?,error_message=?,completed_at=?,lease_expires_at=NULL,result_json=?,updated_at=? WHERE job_id=? AND owner_id=? AND stream_id=? AND status IN('running','committing') AND correlation_id=?")
      .bind(row.correlation_id,row.error_message,row.completed_at,JSON.stringify(checkpoint),restoredAt,row.job_id,user.userId,user.streamId,correlationId).run();
    return error instanceof StaleSequenceError||error instanceof Error&&error.message==="project_access_revoked"?{error:"presentation_recovery_source_changed",status:409}:failed();
  }
}

function candidateModelFromResponse(candidates:Record<string,unknown>[],responseId:string){return candidates.find((candidate)=>candidate.responseId===responseId)?.model;}

type GenerationReceipt=Record<string,unknown>&{
  provider:string;model:string;reservation_microusd:number;settled_cost_microusd:number|null;
  reservation_status:string;source_transmission_status:string;provider_request_status:string;
};

async function acceptedGenerationReceipt(env:WorkerEnv,user:PilotUser,payload:Record<string,unknown>,documentId:string,jobId:string,estimatedCostMicrousd:number,production:ManagedProductionPlan|null,contentScope:ProjectExecutionScope|undefined,effectiveSnapshot?:Record<string,unknown>,deferredPrivate?:D1PreparedStatement[],admissionReads?:OutputAdmissionReads):Promise<GenerationReceipt>{
  const snapshot=payload.snapshot&&typeof payload.snapshot==="object"&&!Array.isArray(payload.snapshot)?payload.snapshot as Record<string,unknown>:{};
  const artifactKind=String(payload.artifactKind??"");
  const sceneConfiguration=sceneConfigurationFromRequest(payload);
  const isSlides=artifactKind==="slides";
  const isModel3d=artifactKind==="model3d";
  const model3d=isModel3d?validateModel3dRequest({prompt:payload.model3dPrompt,settings:payload.model3dSettings,referenceCount:Array.isArray(payload.model3dReferenceBlockIds)?payload.model3dReferenceBlockIds.length:0}):null;
  // Scene has no downstream media render: the existing planning guard bounds its full cost.
  const applicationSpendingCap=isSlides||artifactKind==="scene";
  const sourceOutline=isSlides?inferPresentationSourceOutline(snapshot):null;
  const slideCountPolicy=isSlides&&payload.slideCountPolicy!==undefined?readSlideCountPolicy(payload.slideCountPolicy):undefined;
  const rawRequestedCount=payload.requestedSlideCount??payload.itemCount;
  const requestedSlideCount=isSlides&&slideCountPolicy?.kind!=="flexible"&&Number.isSafeInteger(Number(rawRequestedCount))&&Number(rawRequestedCount)>0?Number(rawRequestedCount):null;
  const authoredSlideCount=isSlides?production?.authoredSlideCount??sourceOutline?.authoredSlideCount??null:null;
  const predictedSlideCount=isSlides?production?.predictedSlideCount??(slideCountPolicy?resolvePresentationCountRequest(payload).itemCount:requestedSlideCount??7):null;
  const batchCount=production?.providerBatchCount??1;
  const plannedProviderCallCount=production?.providerCallCount??1;
  const maxRepairCallCount=isModel3d?0:production?.maxRepairCallCount??1;
  const maximumProviderCallCount=isModel3d?1:production?.maximumProviderCallCount??2;
  const capturedAt=new Date().toISOString();
  const plannerProvider="openai";
  const modelRoutes=isSlides?resolvePresentationModelRoutes(env):null;
  const plannerModel=modelRoutes?.composition.model??String(env.OPENAI_MODEL??"gpt-5.6-terra");
  const provider=artifactKind==="audio"||isModel3d?"fal":"openai";
  const model=model3d?.model??(artifactKind==="audio"?String(payload.audioProviderModel??env.FAL_AUDIO_MODEL??"fal-ai/lyria3/pro"):plannerModel);
  const audioProfile=artifactKind==="audio"?normalizeAudioRequestProfile(payload.audioProfile,snapshot):null;
  const sourceHash=await sourceSnapshotSha256(snapshot);
  const sceneContext=sceneConfiguration?{
    source_snapshot_sha256:effectiveSnapshot?await sourceSnapshotSha256(effectiveSnapshot):sourceHash,
    authored_snapshot_sha256:sourceHash,
    document_revision:generationRevisionFromRequest(payload,documentId),
    alternate_medium:sceneConfiguration.alternateMedium,
  }:null;
  const requestSettings={
    item_count:predictedSlideCount??(payload.itemCount===undefined?null:Number(payload.itemCount)),
    requested_slide_count:requestedSlideCount,authored_slide_count:authoredSlideCount,predicted_slide_count:predictedSlideCount,
    ...(slideCountPolicy?{slide_count_policy:slideCountPolicy}:{}),
    audience:String(payload.audience??"").trim()||"general",tone:String(payload.tone??"").trim()||"document-derived",
    production_mode:payload.productionMode==="managed"?"managed":"manual",
    presentation_style:typeof payload.presentationStyle==="string"?payload.presentationStyle:null,
    presentation_fidelity:typeof payload.presentationFidelity==="string"?payload.presentationFidelity:null,
    ...(isSlides?{presentation_adapter_version:PRESENTATION_ADAPTER_VERSION,presentation_model_routes:modelRoutes}:{}),
    batch_count:batchCount,planned_provider_call_count:plannedProviderCallCount,max_repair_call_count:maxRepairCallCount,maximum_provider_call_count:maximumProviderCallCount,
    reservation_microusd:estimatedCostMicrousd,
    ...(audioProfile?{audio_goal:audioProfile.goal,audio_role:audioProfile.role,audio_destination:audioProfile.destination,...(audioProfile.durationSeconds?{audio_duration_seconds:audioProfile.durationSeconds}:{}),...(audioProfile.speakerCount?{audio_speaker_count:audioProfile.speakerCount}:{}),audio_provider_model:model,audio_provider_estimated_cost_microusd:Number(payload.audioEstimatedCostMicrousd??0)}:{}),
    ...(model3d?{model3d_settings:model3d.settings,model3d_reference_count:Array.isArray(payload.model3dReferenceBlockIds)?payload.model3dReferenceBlockIds.length:0,model3d_provider_model:model,model3d_provider_estimated_cost_microusd:model3d.estimatedCostMicrousd}:{}),
    ...(sceneConfiguration?{scene_medium:sceneConfiguration.medium,scene_configuration:sceneConfiguration,context_continuity:sceneContext}:{}),
    ...(payload.workflowId&&payload.workflowStageId?{production_workflow:{id:String(payload.workflowId),stage_id:String(payload.workflowStageId),sources:Array.isArray(payload.workflowSources)?payload.workflowSources:[]}}:{}),
  };
  const privateReceipt={
    schema_version:1,job_id:jobId,artifact_kind:artifactKind,document_id:documentId,captured_at:capturedAt,
    ...(sceneConfiguration?{scene_request_id:payload.sceneRequestId,scene_cost_binding_hash:(payload.sceneCostConsent as Record<string,unknown>|undefined)?.bindingHash}:{}),
    ...(sceneConfiguration?{scene_medium:sceneConfiguration.medium,scene_configuration:sceneConfiguration,context_continuity:sceneContext}:{}),
    request:{...requestSettings,editable_settings:captureDocumentRenderSettings(payload),...(audioProfile?{audio_profile:audioProfile,audio_video_artifact_id:typeof payload.audioVideoArtifactId==="string"?payload.audioVideoArtifactId:null,audio_video_provider_transfer:payload.sendAudioVideoToProvider===true}:{}),...(model3d?{model3d_prompt:payload.model3dPrompt,model3d_reference_block_ids:payload.model3dReferenceBlockIds,...(payload.model3dPromptSource==="document"?{model3d_prompt_source:"document",model3d_adaptation:payload.model3dAdaptation}:{})}:{})},document_snapshot:snapshot,...(effectiveSnapshot?{production_workflow_snapshot:effectiveSnapshot}:{}),
    source_block_versions:Array.isArray(payload.sourceBlockVersions)?payload.sourceBlockVersions:[],
    planner:isModel3d?{provider:null,model:null,request_status:"not_applicable"}:{provider:plannerProvider,model:plannerModel,request_status:"not_submitted"},
    source:{scope:isModel3d?(payload.model3dPromptSource==="document"?"adapted_document_and_selected_reference_views":"authored_prompt_and_selected_reference_views"):"authorized_document_context",status:"not_transmitted",snapshot_sha256:sourceHash},
    accounting:{reservation_microusd:estimatedCostMicrousd,settled_cost_microusd:0,reservation_is_provider_hard_cap:false,reservation_is_application_hard_cap:applicationSpendingCap,...(applicationSpendingCap?{maximum_authorized_cost_microusd:estimatedCostMicrousd}:{})},
  };
  const stored=deferredPrivate?await preparePrivateContent(env,user.userId,"document-artifact-input",JSON.stringify(privateReceipt),contentScope,admissionReads):await storePrivateContent(env,user.userId,"document-artifact-input",JSON.stringify(privateReceipt),contentScope);
  if(deferredPrivate&&"statements" in stored){
    deferredPrivate.push(...(stored as Awaited<ReturnType<typeof preparePrivateContent>>).statements,...outputAssertionStatements(env,{sql:"EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND redacted_at IS NULL AND expires_at>?)",bindings:[stored.contentId,user.userId,capturedAt]}));
    if(contentScope)deferredPrivate.push(...outputAssertionStatements(env,{sql:"EXISTS(SELECT 1 FROM project_resource_scopes resource JOIN private_content_retention_scopes retained ON retained.content_id=resource.resource_id AND retained.organization_id=resource.organization_id AND retained.project_access_id=resource.project_access_id WHERE resource.resource_kind='content' AND resource.resource_id=? AND resource.actor_user_id=? AND resource.project_access_id=? AND resource.organization_id=?)",bindings:[stored.contentId,user.userId,contentScope.projectAccessId,contentScope.organizationId]}));
  }
  return{
    schema_version:1,captured_at:capturedAt,artifact_kind:artifactKind,production_mode:requestSettings.production_mode,
    ...(sceneConfiguration?{scene_medium:sceneConfiguration.medium,scene_configuration:sceneConfiguration,context_continuity:sceneContext}:{}),
    provider,model,requested_slide_count:requestedSlideCount,authored_slide_count:authoredSlideCount,predicted_slide_count:predictedSlideCount,
    ...(slideCountPolicy?{slide_count_policy:slideCountPolicy}:{}),
    slide_count_mismatch:isSlides&&authoredSlideCount!==null&&authoredSlideCount>0&&!slideCountAccepted(authoredSlideCount,slideCountPolicy,requestedSlideCount),
    ...(isSlides?{presentation_adapter_version:PRESENTATION_ADAPTER_VERSION}:{}),
    batch_count:batchCount,minimum_provider_call_count:plannedProviderCallCount,planned_provider_call_count:plannedProviderCallCount,actual_provider_call_count:null,max_repair_call_count:maxRepairCallCount,maximum_provider_call_count:maximumProviderCallCount,
    reservation_microusd:estimatedCostMicrousd,settled_cost_microusd:0,reservation_status:"estimated",
    reservation_is_provider_hard_cap:false,reservation_is_application_hard_cap:applicationSpendingCap,...(applicationSpendingCap?{maximum_authorized_cost_microusd:estimatedCostMicrousd}:{}),repair_calls_may_incur_additional_usage:maxRepairCallCount>0,
    source_transmission_scope:isModel3d?(payload.model3dPromptSource==="document"?"adapted_document_and_selected_reference_views":"authored_prompt_and_selected_reference_views"):"authorized_document_context",source_transmission_status:"not_transmitted",provider_request_status:"not_submitted",
    source_fact_count:Array.isArray(snapshot.facts)?snapshot.facts.length:0,source_snapshot_sha256:sourceHash,
    input_ref:stored.contentId,input_expires_at:stored.expiresAt,settings:requestSettings,
  };
}

function parentJobIdFromRequest(request: Record<string, unknown>) {
  return typeof request.parentJobId === "string" && request.parentJobId ? request.parentJobId : null;
}

function fanKindFromRequest(request: Record<string, unknown>): "preview" | "generate" | null {
  return request.fanKind === "preview" || request.fanKind === "generate" ? request.fanKind : null;
}

function errorDetailFromResult(result: Record<string, unknown>): DocumentJobError | null {
  const value = result.errorDetail;
  if (!value || typeof value !== "object") return null;
  const detail = value as Record<string, unknown>;
  const parsed={
    code: String(detail.code ?? "operation_failed"), category: String(detail.category ?? "unknown") as DocumentJobError["category"],
    scope: String(detail.scope ?? "unknown") as DocumentJobError["scope"], action: String(detail.action ?? "none") as DocumentJobError["action"],
    message: String(detail.message ?? "The operation failed."), retryable: Boolean(detail.retryable), retryAfterMs: detail.retryAfterMs === null || detail.retryAfterMs === undefined || !Number.isFinite(Number(detail.retryAfterMs)) ? null : Number(detail.retryAfterMs),
    requestId: detail.requestId ? String(detail.requestId) : null, httpStatus: detail.httpStatus === null || detail.httpStatus === undefined || !Number.isFinite(Number(detail.httpStatus)) ? null : Number(detail.httpStatus),
    riskCategories: Array.isArray(detail.riskCategories) ? detail.riskCategories.map(String) : [], contributingBlockIds: Array.isArray(detail.contributingBlockIds) ? detail.contributingBlockIds.map(String) : [], contributingReferenceIds: Array.isArray(detail.contributingReferenceIds) ? detail.contributingReferenceIds.map(String) : [], probe: detail.probe ? String(detail.probe) : null,
    ...(Array.isArray(detail.validationIssues)?{validationIssues:detail.validationIssues as import("../src/model/presentation-candidates").PresentationCandidateValidationIssue[]}:{}),
  };
  return publicFailureDetail(classifyDocumentJobFailure(parsed.message,{...parsed,probe:parsed.probe??undefined}));
}

function failureProgressMessage(detail: ProviderFailureDetail | DocumentJobError | null) {
  if (!detail) return "The operation failed.";
  if(detail.code==="local_persistence_failed")return "Forma could not save the generation because a local database or event-store write failed. This is not a provider interruption.";
  if(detail.code==="source_fidelity_validation_failed")return "The generated presentation did not preserve its required source facts, quotations, or authorized slide evidence.";
  if(detail.code==="presentation_output_limit_reached")return "The paid presentation response reached its output limit; divide or reduce the request before spending again.";
  if(detail.code==="presentation_provider_refused")return "Provider safety checks rejected this presentation; change the request before another paid attempt.";
  if(detail.code==="presentation_provider_call_cap_reached")return "The presentation reached its approved provider-attempt limit; no additional paid request was submitted.";
  if(detail.code==="presentation_provider_response_incomplete"||detail.code==="presentation_empty_provider_response")return "The provider returned an incomplete paid presentation response; review the saved draft before spending again.";
  if(detail.code==="execution_interrupted")return "Forma lost contact with the generation worker before this operation finished.";
  if(detail.code==="provider_submission_uncertain")return "The presentation provider request could not be confirmed. Automatic resubmission was stopped to prevent a duplicate charge.";
  if(detail.code==="presentation_recovery_unavailable")return "A paid presentation response was recorded, but its complete draft was not saved. Automatic resubmission was stopped to prevent a duplicate charge.";
  if (detail.category === "safety") return detail.riskCategories?.includes("audio-copyright") || /\baudio\b.*\bcopyright\b/i.test(detail.message)
    ? "The provider rejected generated audio. Start a silent video instead of recovering the rejected render."
    : "Safety checks stopped this generation. Change the request or reference before retrying.";
  if (detail.action === "review_budget") return detail.scope === "workspace" ? "The workspace generation budget is exhausted." : "Your generation budget is exhausted.";
  if (detail.category === "quota") return `The OpenAI ${detail.scope === "project" || detail.scope === "organization" ? detail.scope : "account"} limit prevents generation.`;
  if (detail.category === "authentication") return "The configured OpenAI credential was rejected.";
  if (detail.category === "access") return "The configured credential cannot access this OpenAI project or model.";
  if (detail.category === "rate_limit") return "OpenAI remained rate limited after automatic backoff.";
  if (detail.category === "network" || detail.category === "server") return "The provider connection ended before an image was returned.";
  return detail.message || "The operation failed.";
}

async function finishDocumentJob(env: WorkerEnv, row: DocumentJobRow, status: "completed" | "failed", result: Record<string, unknown>, errorMessage: string | null, completedAt = new Date().toISOString(), guardActive = true) {
  const parentId = parentJobIdFromRequest(parseRequest(row));
  const bindings = documentJobCompletionBindings({ status, result, errorMessage, completedAt, parentId, jobId: row.job_id, ownerId: row.owner_id, correlationId: row.correlation_id });
  const resultAssignment=row.output_slot_id?"json_patch(?,json_object('providerSubmissions',json(COALESCE(json_extract(result_json,'$.providerSubmissions'),'{}')),'plannerUsage',json(json_extract(result_json,'$.plannerUsage')),'plannerResponseId',json_extract(result_json,'$.plannerResponseId'),'plannerResponseIds',json(json_extract(result_json,'$.plannerResponseIds')),'plannerModel',json_extract(result_json,'$.plannerModel'),'imageRecovery',json(json_extract(result_json,'$.imageRecovery'))))":PRESERVE_ADAPTIVE_RECEIPT_SQL;
  const statement = guardActive
    ? `UPDATE document_jobs SET status=?,result_json=${resultAssignment},error_message=?,completed_at=?,lease_expires_at=NULL,notified_at=CASE WHEN ? IS NULL THEN notified_at ELSE ? END,updated_at=? WHERE job_id=? AND owner_id=? AND correlation_id=? AND status IN ('running','committing')`
    : `UPDATE document_jobs SET status=?,result_json=${resultAssignment},error_message=?,completed_at=?,lease_expires_at=NULL,notified_at=CASE WHEN ? IS NULL THEN notified_at ELSE ? END,updated_at=? WHERE job_id=? AND owner_id=? AND correlation_id=?`;
  const terminal=env.DB.prepare(statement).bind(...bindings);
  return row.output_slot_id?(await env.DB.batch([terminal,...prepareOutputJobOutcomeStatements(env,row)]))[0]!:terminal.run();
}

function queueRecoveryPresentation(row: DocumentJobRow, recoveryBlocker: DocumentJobRow | null) {
  if (!recoveryBlocker) return null;
  if (row.job_id === recoveryBlocker.job_id) return {
    stage: "recovering",
    progressMessage: "The server is recovering this interrupted operation before continuing the queue.",
  };
  if (row.status === "queued") return {
    stage: "queue-recovery",
    progressMessage: "An earlier operation lost contact. The server is recovering it before this render starts.",
  };
  return null;
}

function serializeJob(row: DocumentJobRow, recoveryBlocker: DocumentJobRow | null = null, detail = true) {
  const parsed = parseResult(row); const result = row.result_json ? parsed : null; const request = parseRequest(row); const identity = generationRequestIdentity(row.kind, request, row.document_id);
  const sceneConfiguration=row.kind==="render_document"?sceneConfigurationFromRequest(request):null;
  const members = Array.isArray(parsed.members) ? parsed.members : [];
  const recovery = queueRecoveryPresentation(row, recoveryBlocker);
  const errorDetail=errorDetailFromResult(parsed);
  const privateCheckpointKeys=new Set(["imageRecovery","scenePolicyStopSummary","providerSubmissions","providerSubmissionProtocol","providerSubmissionLegacyUncertain","presentationCandidates","presentationRecoveryOnly","providerResponseRef","candidateRaw","storyboardSafeRecovery","storyboardRejectedProviderReceipt","adaptiveProviderReceipt","model3dProviderFiles","quote"]);
  const sanitizedResult=result?Object.fromEntries(Object.entries(result).filter(([key])=>!privateCheckpointKeys.has(key)&&(key!=="recoverablePresentationCandidate"||request.artifactKind==="slides"&&row.status==="failed"&&parsed.recoverablePresentationCandidate===true))):null;
  if(sanitizedResult&&request.artifactKind==="model3d")Object.assign(sanitizedResult,model3dRecoveryProviderReceipt(parsed)??{});
  if(sanitizedResult&&consentedAdaptiveJob(row)&&!certifiedAdaptiveRows.has(row)){delete sanitizedResult.structure;delete sanitizedResult.intent;}
  // Present current evidence without changing the stored receipt, checkpoint, or cost hold.
  if(sanitizedResult&&parsed.generationReceipt)sanitizedResult.generationReceipt=generationExecutionSummary(parsed,errorDetail,{jobId:row.job_id,correlationId:row.correlation_id,bindingHash:String((request.sceneCostConsent as Record<string,unknown>|undefined)?.bindingHash??""),attemptCount:row.attempt_count,status:row.status});
  const visibleResult = row.kind === "render_document" && request.artifactKind
    ? { ...(sanitizedResult ?? {}), artifactKind: String(parsed.artifactKind ?? request.artifactKind),...(sceneConfiguration?{sceneMedium:sceneConfiguration.medium,sceneConfiguration}:{}),...(request.artifactKind==="storyboard"&&Number.isSafeInteger(Number(request.itemCount))&&Number(request.itemCount)>0&&Number(request.itemCount)<=100?{requestedItemCount:Number(request.itemCount)}:{}) }
    : sanitizedResult;
  const summarizedResult = detail || !visibleResult ? visibleResult
    : Object.fromEntries(Object.entries(visibleResult).filter(([key]) => !["plannerInput", "videoInputReceipt", "audioInputReceipt", "model3dInputReceipt", "artifactPlan"].includes(key)));
  return {
    jobId: row.job_id, documentId: row.document_id, kind: row.kind, status: row.status, sourceSurface: row.source_surface,
    ...(row.kind==="structure_adaptive"&&typeof request.canvasId==="string"&&request.canvasId?{canvasId:request.canvasId}:{}),
    ...(consentedAdaptiveJob(row)?{planningExecutionId:row.job_id,planningProjectScope:request.projectScope===true,planningLocale:typeof request.locale==="string"?request.locale:"en"}:{}),
    ...(sceneConfiguration?{sceneMedium:sceneConfiguration.medium,sceneConfiguration}:{}),
    requestedSequence: Number(row.requested_sequence), documentRevision: identity.documentRevision, requestKey: identity.requestKey, sourcePreviewId: identity.sourcePreviewId, productionMode:request.productionMode==="managed"?"managed" as const:"manual" as const, promptTechnique: identity.promptTechnique, promptFanId: identity.promptFanId,
    parentJobId: parentJobIdFromRequest(request), fanKind: fanKindFromRequest(request), members, result: summarizedResult, error: row.error_message, errorDetail, moderationPromptRef: parsed.moderationPromptRef ? String(parsed.moderationPromptRef) : null, dismissedAt: parsed.dismissedAt ? String(parsed.dismissedAt) : null, attemptCount: Number(row.attempt_count),
    requestedAt: row.requested_at, startedAt: row.started_at, completedAt: row.completed_at, notifiedAt: row.notified_at,
    leaseExpiresAt: row.lease_expires_at, updatedAt: row.updated_at,
    stage: recovery?.stage ?? String(parsed.stage ?? row.status), progressMessage: recovery?.progressMessage ?? (errorDetail&&["local_persistence_failed","source_fidelity_validation_failed","execution_interrupted","provider_submission_uncertain","presentation_recovery_unavailable"].includes(errorDetail.code)?failureProgressMessage(errorDetail):String(parsed.progressMessage ?? "")),
  };
}

async function reconcilePromptFanParent(env: WorkerEnv, ownerId: string, parentId: string) {
  const parent = await readJob(env, ownerId, parentId); if (!parent || parent.kind !== "prompt_fan") return parent;
  if (parent.status === "canceled" || errorDetailFromResult(parseResult(parent))?.code === "force_failed_by_admin") return parent;
  const request = parseRequest(parent); const childIds = Array.isArray(request.childJobIds) ? request.childJobIds.map(String).filter(Boolean).slice(0, 4) : [];
  const childRows=childIds.length?(await env.DB.prepare(`SELECT * FROM document_jobs WHERE owner_id=? AND job_id IN (${childIds.map(()=>"?").join(",")})`).bind(ownerId,...childIds).all<DocumentJobRow>()).results:[];
  const childrenById=new Map(childRows.map((row)=>[row.job_id,row]));
  const children=childIds.map((jobId)=>childrenById.get(jobId)).filter((row):row is DocumentJobRow=>Boolean(row));
  const members = children.map((child) => {
    const childRequest = parseRequest(child); const childResult = parseResult(child);
    return { jobId: child.job_id, promptTechnique: normalizePromptTechnique(childRequest.promptTechnique), status: child.status, error: errorDetailFromResult(childResult), moderationPromptRef: childResult.moderationPromptRef ? String(childResult.moderationPromptRef) : null, attemptCount: Number(child.attempt_count), updatedAt: child.updated_at };
  });
  const terminal = children.filter((child) => documentJobTerminal(child)); const succeeded = terminal.filter((child) => child.status === "completed").length; const canceled = terminal.filter((child) => child.status === "canceled").length; const failed = terminal.length - succeeded - canceled;
  const status: DocumentJobStatus = terminal.length === childIds.length && childIds.length > 0 ? canceled === childIds.length ? "canceled" : failed + canceled === 0 ? "completed" : succeeded > 0 ? "partial" : "failed" : children.some((child) => child.status === "running" || child.status === "committing") || terminal.length > 0 ? "running" : "queued";
  const now = new Date().toISOString(); const completedAt = documentJobTerminal({ status }) ? parent.completed_at ?? now : null;
  const progressMessage = status === "completed" ? "All four prompt approaches finished." : status === "canceled" ? "The fan generation was stopped." : status === "partial" ? `${succeeded} of 4 images finished; ${failed + canceled} did not finish.` : status === "failed" ? "All four prompt approaches failed or were stopped." : `${terminal.length} of 4 prompt approaches finished.`;
  const result = { ...parseResult(parent), stage: status, progressMessage, members, completedCount: succeeded, failedCount: failed, canceledCount: canceled, totalCount: childIds.length };
  const resultJson = JSON.stringify(result); const errorMessage = status === "partial" ? "prompt_fan_partial_failure" : status === "failed" ? "prompt_fan_failed" : null;
  if (parent.status === status && parent.result_json === resultJson && parent.error_message === errorMessage && parent.completed_at === completedAt) return parent;
  await env.DB.prepare("UPDATE document_jobs SET status=?,result_json=?,error_message=?,completed_at=?,updated_at=? WHERE job_id=? AND owner_id=?").bind(status, resultJson, errorMessage, completedAt, now, parentId, ownerId).run();
  return readJob(env, ownerId, parentId);
}

async function reconcileParentForChild(env: WorkerEnv, row: DocumentJobRow) {
  const parentId = parentJobIdFromRequest(parseRequest(row));
  if (parentId) await reconcilePromptFanParent(env, row.owner_id, parentId);
}

async function readJob(env: WorkerEnv, ownerId: string, jobId: string) {
  return env.DB.prepare(`SELECT *${outputSchemaIsReady(env.DB)?",(SELECT slot.slot_id FROM output_operation_slots slot WHERE slot.job_id=document_jobs.job_id) AS output_slot_id":""} FROM document_jobs WHERE job_id=? AND owner_id=?`).bind(jobId, ownerId).first<DocumentJobRow>();
}

async function refreshGenerationReceipt(env:WorkerEnv,user:PilotUser,row:DocumentJobRow,body:Record<string,unknown>={},failure:ProviderFailureDetail|null=null,interruptedStage="",retainedRow?:DocumentJobRow,persist=true,committedSettlement?:OutputEventExecution["accountSettlement"]){
  if(!requiresForegroundDocumentExecution(row))return row;
  const latest=retainedRow??await readJob(env,user.userId,row.job_id);if(!latest)return row;
  const checkpoint=parseResult(latest);
  const previous=checkpoint.generationReceipt&&typeof checkpoint.generationReceipt==="object"&&!Array.isArray(checkpoint.generationReceipt)?checkpoint.generationReceipt as GenerationReceipt:null;
  if(!previous)return latest;
  const appended=Array.isArray(body.appended)?body.appended.filter((event):event is Record<string,unknown>=>Boolean(event&&typeof event==="object"&&!Array.isArray(event))):[];
  const correlated=appended.length?appended:await readCorrelatedEvents(env,user.streamId,[latest.correlation_id]);
  const payloads=correlated.map((event)=>({type:String(event.type??""),payload:event.payload&&typeof event.payload==="object"&&!Array.isArray(event.payload)?event.payload as Record<string,unknown>:{}}));
  const completed=payloads.find((event)=>["DocumentRenderCompleted","GenerationCompleted","IdeationPreviewCompleted"].includes(event.type))?.payload;
  const budget=payloads.find((event)=>event.type==="BudgetReserved")?.payload;
  const usage=payloads.filter((event)=>event.type==="GenerationUsageRecorded").map((event)=>event.payload);
  const reservationId=String(checkpoint.costReservationId??budget?.cost_reservation_id??usage[0]?.cost_reservation_id??"");
  const reservation=reservationId?(committedSettlement?.reservation_id===reservationId?committedSettlement:await costBudgetReservation(env,user.billingUserId??user.userId,reservationId)):null;
  const plannerResponses=Array.isArray(checkpoint.plannerResponseIds)?checkpoint.plannerResponseIds.filter(Boolean):[];
  const plannerUsage=checkpoint.plannerUsage&&typeof checkpoint.plannerUsage==="object"?checkpoint.plannerUsage as Record<string,unknown>:{};
  const plannerInput=checkpoint.plannerInput&&typeof checkpoint.plannerInput==="object"?checkpoint.plannerInput as Record<string,unknown>:{};
  const plannerValidation=plannerInput.validation&&typeof plannerInput.validation==="object"?plannerInput.validation as Record<string,unknown>:{};
  const recordedPlannerCalls=Math.max(plannerResponses.length,Math.max(0,Number(plannerInput.provider_request_count??plannerValidation.provider_call_count??0)));
  const stopEvidence=previous.artifact_kind==="scene"&&failure?.code==="scene_paid_authority_changed"
    ?await readScenePolicyStopEvidence(env,user,latest as unknown as Record<string,unknown>,checkpoint,user.projectExecution):null;
  const submissions=providerSubmissions(checkpoint).filter(entry=>entry.clientRequestId!==stopEvidence?.stoppedRequestId);
  const provenSceneUnused=stopEvidence?.unused===true&&!completed&&plannerResponses.length===0&&!checkpoint.plannerResponseId
    &&!checkpoint.providerJobId&&recordedPlannerCalls===0&&Number(plannerUsage.totalTokens??0)===0&&usage.length===0;
  // An application HTTP failure, or an earlier response, cannot acknowledge a
  // later pending repair. Generic per-call evidence always wins over this legacy marker.
  const providerResponseReceived=Boolean(checkpoint.presentationProviderSubmission==="pending"&&!hasUnresolvedProviderSubmission(checkpoint)
    &&failure?.scope==="provider"&&failure.code!=="provider_submission_uncertain"&&failure.httpStatus&&definitiveProviderRejection(failure.httpStatus));
  const failedMediaPayload=payloads.find((event)=>event.type==="DocumentRenderFailed")?.payload;
  const unconfirmedMediaSubmission=(previous.artifact_kind==="audio"||previous.artifact_kind==="video"||previous.artifact_kind==="storyboard"||previous.artifact_kind==="model3d")&&Boolean(!checkpoint.providerJobId&&!completed&&(checkpoint.audioProviderSubmission==="pending"||checkpoint.model3dProviderSubmission==="pending"||checkpoint.storyboardProviderSubmission==="pending"||failedMediaPayload?.provider_charge_status==="unconfirmed"));
  const confirmedProviderRequest=Boolean(submissions.some((entry)=>entry.status!=="pending")||completed||checkpoint.plannerResponseId||plannerResponses.length||Number(plannerUsage.totalTokens??0)>0||checkpoint.providerJobId||usage.some((event)=>Boolean(event.planner_response_id)||Number(event.total_tokens??0)>0)||checkpoint.providerSubmissionProtocol!==1&&failure?.requestId&&failure.code!=="provider_submission_uncertain"||!provenSceneUnused&&(previous.provider_request_status==="submitted"||previous.provider_request_status==="completed")||providerResponseReceived);
  const audioSubmissionRejected=checkpoint.audioProviderSubmission==="rejected";
  const storyboardSubmissionRejected=checkpoint.storyboardProviderSubmission==="rejected";
  const model3dSubmissionRejected=checkpoint.model3dProviderSubmission==="rejected";
  const uncertainProviderRequest=!completed&&!provenSceneUnused&&(hasUnresolvedProviderSubmission(checkpoint)||unconfirmedMediaSubmission||checkpoint.presentationProviderSubmission==="pending"&&!providerResponseReceived||previous.provider_request_status==="submission_unknown"&&checkpoint.presentationProviderSubmission!=="confirmed"&&checkpoint.audioProviderSubmission!=="confirmed"&&checkpoint.storyboardProviderSubmission!=="confirmed"&&checkpoint.model3dProviderSubmission!=="confirmed"&&!audioSubmissionRejected&&!storyboardSubmissionRejected&&!model3dSubmissionRejected||checkpoint.providerSubmissionProtocol!==1&&!confirmedProviderRequest&&!audioSubmissionRejected&&!storyboardSubmissionRejected&&!model3dSubmissionRejected&&Boolean(failure&&(failure.category==="network"||failure.category==="rate_limit"||failure.category==="server"&&failure.scope==="provider")));
  const activeSubmission=submissions.find((entry)=>entry.status==="pending")??submissions.find((entry)=>entry.status==="accepted")??submissions.at(-1);
  const provider=String(completed?.provider??body.provider??activeSubmission?.provider??checkpoint.provider??(checkpoint.storyboardProviderSubmission==="confirmed"&&checkpoint.providerJobId?"fal":null)??previous.provider??"openai");
  const model=String(completed?.model_id??activeSubmission?.model??checkpoint.providerModel??checkpoint.plannerModel??previous.model??env.OPENAI_MODEL??"gpt-5.6-terra");
  const settledFromEvents=usage.reduce((total,event)=>total+Math.max(0,Number(event.cost_microusd??0)),0);
  const sourcePreviouslyTransmitted=!provenSceneUnused&&previous.source_transmission_status==="transmitted";
  const failedStage=interruptedStage||String(checkpoint.stage??"");
  const failureStage=failure?.code==="local_persistence_failed"?"local_persistence"
    :failure?.code==="source_fidelity_validation_failed"?"source_fidelity_validation"
      :failure?.code==="provider_submission_uncertain"?"provider"
        :failure?.code==="presentation_recovery_unavailable"?"planning"
          :failure?.code==="execution_interrupted"?["queued","queue-recovery","recovering"].includes(failedStage)?"queue":["preparing","compiling","planning"].includes(failedStage)?"planning":uncertainProviderRequest||confirmedProviderRequest?"provider":"application"
            :failure&&(failure.scope==="provider"||failure.category==="network"||failure.category==="rate_limit")?"provider":"application";
  const verifiedSettledCost=reservation?Number(reservation.used_microusd??0):settledFromEvents;
  const receipt={
    ...previous,provider,model,
    ...(previous.artifact_kind==="slides"&&completed&&Number.isSafeInteger(Number(completed.item_count))?{actual_slide_count:Number(completed.item_count)}:{}),
    actual_provider_call_count:provenSceneUnused?0:Math.max(recordedPlannerCalls,submissions.filter((entry)=>entry.status!=="pending").length)||previous.actual_provider_call_count||null,
    reservation_microusd:Number(reservation?.reserved_microusd??checkpoint.costReservationMicrousd??budget?.reserved_microusd??previous.reservation_microusd),
    settled_cost_microusd:(hasUnsettledProviderSubmission(checkpoint)||uncertainProviderRequest||previous.artifact_kind==="storyboard"&&checkpoint.storyboardProviderSubmission==="confirmed"&&!completed&&reservation?.status==="executing")&&verifiedSettledCost===0?null:verifiedSettledCost,
    reservation_status:reservation?String(reservation.status):latest.status==="failed"&&settledFromEvents===0?"released":String(previous.reservation_status??"unknown"),
    source_transmission_status:confirmedProviderRequest||sourcePreviouslyTransmitted||failure?.code==="safety_preflight_flagged"?"transmitted":uncertainProviderRequest||!provenSceneUnused&&previous.source_transmission_status==="unknown"?"unknown":"not_transmitted",
    provider_request_status:completed?"completed":uncertainProviderRequest?"submission_unknown":confirmedProviderRequest?"submitted":"not_submitted",
    ...(failure?{failure_code:failure.code,failure_category:failure.category,failure_stage:failureStage}:{}),
  };
// A historical execution certificate only; fresh New-request eligibility still re-reads the full canonical proof.
  const scenePolicyStopSummary=stopEvidence?.stoppedRequestId?{version:"scene-policy-stop-summary-v1",job_id:latest.job_id,attempt_correlation_id:latest.correlation_id,
    binding_hash:String((parseRequest(latest).sceneCostConsent as Record<string,unknown>).bindingHash),artifact_id:checkpoint.artifactId,input_ref:previous.input_ref,
    source_snapshot_sha256:previous.source_snapshot_sha256,stopped_client_request_id:stopEvidence.stoppedRequestId,evidence_sha256:await consentHash(stopEvidence.hashInput)}:null;
  const certifiedReceipt=stopEvidence?{...receipt,execution_evidence_version:1,actual_planner_call_count:receipt.actual_provider_call_count,actual_media_call_count:0,
    unresolved_provider_call_count:0,provider_submission_uncertain:false,provider_call_breakdown_complete:true,provider_call_forecast_scope:"planning"}:receipt;
  const updatedAt=new Date().toISOString();
  const result={...checkpoint,...(providerResponseReceived?{presentationProviderSubmission:"confirmed"}:{}),generationReceipt:certifiedReceipt,...(scenePolicyStopSummary?{scenePolicyStopSummary}:{})};

  if(!persist)return {...latest,result_json:JSON.stringify(result),updated_at:updatedAt};
  const updated=await env.DB.prepare("UPDATE document_jobs SET result_json=?,updated_at=? WHERE job_id=? AND owner_id=? AND stream_id=? AND correlation_id=? AND status=? AND result_json IS ?"+(stopEvidence?" AND ("+stopEvidence.guard.sql+")":""))
    .bind(JSON.stringify(result),updatedAt,latest.job_id,user.userId,user.streamId,latest.correlation_id,latest.status,latest.result_json,...(stopEvidence?stopEvidence.guard.bindings:[])).run();
  return Number(updated.meta.changes??0)===1?{...latest,result_json:JSON.stringify(result),updated_at:updatedAt}:await readJob(env,user.userId,row.job_id)??latest;
}

function rowIsStale(row: DocumentJobRow, now = Date.now()) {
  return documentJobIsStale({ status: row.status, leaseExpiresAt: row.lease_expires_at, updatedAt: row.updated_at,...(row.output_slot_id?{sourceSurface:"outputs"}:{}) }, now);
}

async function updateJobProgress(env: WorkerEnv, row: DocumentJobRow, stage: string, progressMessage: string, patch:Record<string,unknown>={},persist=true) {
  const updatedAt = new Date().toISOString(); const previous=parseResult(row);const result:Record<string,unknown> = { ...previous, stage, progressMessage, ...patch,...(patch.providerSubmissions?{providerSubmissions:mergeProviderSubmissions(previous.providerSubmissions,patch.providerSubmissions)}:{}) };
  const paidPlanning=providerSubmissions(result).filter((receipt)=>receipt.operation==="planning"&&receipt.status==="completed");
  if(paidPlanning.length){
    result.plannerUsage=paidPlanning.reduce((total,receipt)=>({inputTokens:total.inputTokens+Number(receipt.inputTokens??0),outputTokens:total.outputTokens+Number(receipt.outputTokens??0),totalTokens:total.totalTokens+Number(receipt.totalTokens??0)}),{inputTokens:0,outputTokens:0,totalTokens:0});
    const paidPlanningIds=paidPlanning.map((receipt)=>receipt.providerRequestId).filter(Boolean);
    result.plannerResponseIds=paidPlanningIds;
    // Keep the adapter's selected response (including a successful repair),
    // while accounting still includes every completed planning request.
    if(!paidPlanningIds.includes(String(result.plannerResponseId??"")))result.plannerResponseId=paidPlanning.at(-1)?.providerRequestId??result.plannerResponseId;
  }
  if((requiresForegroundDocumentExecution(row)||row.kind==="render_document"&&["audio","storyboard"].includes(String(parseRequest(row).artifactKind??"")))&&previous.generationReceipt&&typeof previous.generationReceipt==="object"&&!Array.isArray(previous.generationReceipt)){
    const receipt=previous.generationReceipt as GenerationReceipt;
    if(patch.presentationProviderSubmission==="pending")result.generationReceipt={...receipt,provider_request_status:"submission_unknown",source_transmission_status:receipt.source_transmission_status==="transmitted"?"transmitted":"unknown",settled_cost_microusd:Number(receipt.settled_cost_microusd??0)>0?receipt.settled_cost_microusd:null,reservation_status:"executing"};
    if(patch.presentationProviderSubmission==="confirmed")result.generationReceipt={...receipt,provider_request_status:"submitted",source_transmission_status:"transmitted",...(Array.isArray(patch.plannerResponseIds)?{actual_provider_call_count:patch.plannerResponseIds.length}:{})};
    if(patch.audioProviderSubmission==="pending")result.generationReceipt={...receipt,provider_request_status:"submission_unknown",source_transmission_status:"unknown",settled_cost_microusd:Number(receipt.settled_cost_microusd??0)>0?receipt.settled_cost_microusd:null,reservation_status:"executing"};
    if(patch.audioProviderSubmission==="confirmed")result.generationReceipt={...receipt,provider_request_status:"submitted",source_transmission_status:"transmitted"};
    if(patch.audioProviderSubmission==="rejected"){const plannerSubmitted=Boolean(previous.plannerResponseId||Array.isArray(previous.plannerResponseIds)&&previous.plannerResponseIds.length);result.generationReceipt={...receipt,provider_request_status:plannerSubmitted?"submitted":"not_submitted",source_transmission_status:plannerSubmitted?"transmitted":"not_transmitted"};}
    if(patch.model3dProviderSubmission==="pending")result.generationReceipt={...receipt,provider_request_status:"submission_unknown",source_transmission_status:"unknown",settled_cost_microusd:Number(receipt.settled_cost_microusd??0)>0?receipt.settled_cost_microusd:null,reservation_status:"executing"};
    if(patch.model3dProviderSubmission==="confirmed")result.generationReceipt={...receipt,provider_request_status:"submitted",source_transmission_status:"transmitted",reservation_status:"executing"};
    if(patch.model3dProviderSubmission==="rejected")result.generationReceipt={...receipt,provider_request_status:"submitted",source_transmission_status:"transmitted"};
    if(patch.storyboardProviderSubmission==="pending")result.generationReceipt={...receipt,provider_request_status:"submission_unknown",source_transmission_status:receipt.source_transmission_status==="transmitted"?"transmitted":"unknown",settled_cost_microusd:Number(receipt.settled_cost_microusd??0)>0?receipt.settled_cost_microusd:null,reservation_status:"executing"};
    if(patch.storyboardProviderSubmission==="confirmed")result.generationReceipt={...receipt,provider_request_status:"submitted",source_transmission_status:"transmitted",reservation_status:"executing"};
    if(patch.storyboardProviderSubmission==="rejected"){const plannerSubmitted=Boolean(previous.plannerResponseId||Array.isArray(previous.plannerResponseIds)&&previous.plannerResponseIds.length);result.generationReceipt={...receipt,provider_request_status:plannerSubmitted?"submitted":"not_submitted",source_transmission_status:plannerSubmitted?"transmitted":"not_transmitted"};}
  }
  if(previous.generationReceipt&&typeof previous.generationReceipt==="object"&&["safety-review","provider-wait"].includes(stage))result.generationReceipt={...previous.generationReceipt,source_transmission_status:stage==="provider-wait"||((previous.generationReceipt as GenerationReceipt).source_transmission_status==="transmitted")?"transmitted":"unknown"};
  if(patch.providerSubmissions&&previous.generationReceipt&&typeof previous.generationReceipt==="object"){
    const receipt=(result.generationReceipt??previous.generationReceipt) as GenerationReceipt;
    const submitted=providerSubmissions(result).some((entry)=>entry.status!=="pending");
    const entries=providerSubmissions(result);const active=entries.find((entry)=>entry.status==="pending")??entries.find((entry)=>entry.status==="accepted")??entries.at(-1);
    const unknown=hasUnresolvedProviderSubmission(result);
    result.generationReceipt={...receipt,...(active?{provider:active.provider,model:active.model}:{}),provider_request_status:unknown?"submission_unknown":submitted?"submitted":receipt.provider_request_status,source_transmission_status:submitted||receipt.source_transmission_status==="transmitted"?"transmitted":unknown?"unknown":receipt.source_transmission_status,settled_cost_microusd:hasUnsettledProviderSubmission(result)&&!Number(receipt.settled_cost_microusd)?null:receipt.settled_cost_microusd,reservation_status:"executing"};
  }
  if(!persist){row.result_json=JSON.stringify(result);row.updated_at=updatedAt;return;}
  const persistedResult=row.output_slot_id?"json_patch(?,json_object('providerSubmissions',json(COALESCE(json_extract(result_json,'$.providerSubmissions'),'{}')),'imageRecovery',json(json_extract(result_json,'$.imageRecovery'))))":PRESERVE_ADAPTIVE_RECEIPT_SQL;
  const updated=await env.DB.prepare(`UPDATE document_jobs SET result_json=${persistedResult},updated_at=? WHERE job_id=? AND owner_id=? AND status='running' AND correlation_id=?`).bind(JSON.stringify(result), updatedAt, row.job_id, row.owner_id, row.correlation_id).run();
  if(Number(updated.meta.changes??0)!==1)throw new Error("document_job_canceled");
  row.result_json = JSON.stringify(result); row.updated_at = updatedAt;
}

async function renewJobLease(env: WorkerEnv, row: DocumentJobRow) {
  const now = new Date(); const leaseExpiresAt = row.output_slot_id&&row.lease_expires_at?row.lease_expires_at:new Date(now.getTime() + DOCUMENT_JOB_LEASE_MS).toISOString();
  const result = await env.DB.prepare("UPDATE document_jobs SET lease_expires_at=?,updated_at=? WHERE job_id=? AND owner_id=? AND status IN ('running','committing') AND correlation_id=?").bind(leaseExpiresAt, now.toISOString(), row.job_id, row.owner_id, row.correlation_id).run();
  if (Number(result.meta.changes ?? 0) !== 1) throw new Error("document_job_lease_lost");
  row.lease_expires_at = leaseExpiresAt; row.updated_at = now.toISOString();
}

async function beginJobCommit(env: WorkerEnv, row: DocumentJobRow, progressMessage?:string) {
  const now = new Date().toISOString();
  const checkpoint=progressMessage?{...parseResult(row),stage:"saving",progressMessage}:null;
  const result = checkpoint
    ?await env.DB.prepare("UPDATE document_jobs SET status='committing',result_json=json_patch(COALESCE(result_json,'{}'),?),updated_at=? WHERE job_id=? AND owner_id=? AND correlation_id=? AND status='running'").bind(JSON.stringify({stage:"saving",progressMessage}),now,row.job_id,row.owner_id,row.correlation_id).run()
    :await env.DB.prepare("UPDATE document_jobs SET status='committing',updated_at=? WHERE job_id=? AND owner_id=? AND correlation_id=? AND status='running'").bind(now,row.job_id,row.owner_id,row.correlation_id).run();
  if (Number(result.meta.changes ?? 0) !== 1) throw new Error("document_job_canceled");
  row.status = "committing";row.updated_at=now;if(checkpoint)row.result_json=JSON.stringify(checkpoint);
}

async function runWithHeartbeat<T>(env: WorkerEnv, row: DocumentJobRow,user:PilotUser, operation: (control: { signal: AbortSignal; beginCommit: () => Promise<void>; progress: (stage:string,message:string,patch?:Record<string,unknown>,options?:{financialReceiptPersisted?:true}) => Promise<void> }) => Promise<T>,nativePolicy:OutputNativeExecutionPolicy=OUTPUT_NATIVE_EXECUTION_POLICY) {
  let settled = false; let value: T | undefined; let failure: unknown;
  const native=Boolean(row.output_slot_id),startedMonotonic=performance.now();let renewals=0;
  const controller = new AbortController(); let commitStarted = false;
  // Output's guarded binding includes this exact job/actor/immutable-anchor
  // predicate in every progress, commit, lease-renewal and provider transaction.
  const verify=async()=>{if(!row.output_slot_id&&!await activeProjectExecution(env,user,row.document_id,row.job_id))throw new Error("document_job_canceled");};
  await verify();
  let progressQueue=Promise.resolve();
  const serializedProgress=(stage:string,message:string,patch?:Record<string,unknown>,options?:{financialReceiptPersisted?:true})=>{
    const next=progressQueue.then(async()=>{
      if(commitStarted)return;
      const previous=parseResult(row);
      const changed=Boolean(patch&&Object.entries(patch).some(([key,value])=>JSON.stringify(previous[key])!==JSON.stringify(value)));
      if(row.output_slot_id&&!changed)return;
      await verify();
      // A legacy presentation's atomic response publication and the following
      // candidate checkpoint already cover an identical financial observation.
      // Do not drop changed validation metadata, a new call, or any authority check.
      if(isPresentationJob(row)&&options?.financialReceiptPersisted&&!changed)return;
      await updateJobProgress(env,row,stage,message,patch,!(row.output_slot_id&&options?.financialReceiptPersisted));
    });progressQueue=next.catch(()=>undefined);return next;
  };
  const execution = operation({ signal: controller.signal, beginCommit: async () => { await progressQueue;if (commitStarted) return;await verify();if(requiresForegroundDocumentExecution(row))await beginJobCommit(env,row,"Saving the provider result and its durable receipt.");else{await updateJobProgress(env,row,"saving","Saving the provider result and its durable receipt.");await beginJobCommit(env,row);}commitStarted=true; }, progress: serializedProgress }).then((result) => { value = result; settled = true; }, (error) => { failure = error; settled = true; });
  while (!settled) {
    let timer:ReturnType<typeof setTimeout>|undefined;
    await Promise.race([execution, new Promise<void>((resolve) => {timer=setTimeout(resolve,native?Math.max(1,Math.min(nativePolicy.heartbeatMilliseconds,nativePolicy.maximumMilliseconds-(performance.now()-startedMonotonic))):DOCUMENT_JOB_HEARTBEAT_MS);})]);
    if(timer!==undefined)clearTimeout(timer);
    if(!settled&&native&&(performance.now()-startedMonotonic>=nativePolicy.maximumMilliseconds||renewals>=nativePolicy.maximumRenewals)){
      // Aborting the local wait is not proof that the provider rejected the
      // request. Its durable pending call and reserved allowance remain held.
      controller.abort("output_execution_time_limit");
      failure=new ProviderRequestError({code:"output_execution_time_limit",category:"network",scope:"request",action:"contact_support",message:"The authorized application execution window ended. A provider request may still have been accepted; its allowance is retained until the receipt is reconciled.",retryable:false,retryAfterMs:null,requestId:null,httpStatus:504});
      break;
    }
    if (!settled) try {await verify();await renewJobLease(env, row);renewals++; } catch (error) { controller.abort("document_job_canceled"); failure = error;if(native)break;await execution; }
  }
  if (failure !== undefined) throw failure;
  return value as T;
}

async function restoreLegacyCostReservation(env: WorkerEnv, user: PilotUser, row: DocumentJobRow, events: Awaited<ReturnType<typeof readCorrelatedEvents>>) {
  const checkpoint = parseResult(row);
  const existingId = String(checkpoint.costReservationId ?? "");
  const ownerId = user.billingUserId ?? user.userId;
  if (existingId && await costBudgetReservation(env, ownerId, existingId)) return existingId;
  const evidence = [...events].reverse().find((event) => event.type === "BudgetReserved" && Number(event.payload.reserved_microusd ?? 0) > 0);
  if (!evidence) return "";
  const reservationId = String(evidence.payload.cost_reservation_id ?? checkpoint.costReservationId ?? `legacy-cost:${String(evidence.payload.reservation_id ?? evidence.eventId)}`);
  await adoptLegacyCostReservation(env, ownerId, {
    reservationId,
    amountMicrousd: Number(evidence.payload.reserved_microusd),
    period: String(evidence.payload.period ?? checkpoint.costReservationPeriod ?? evidence.occurredAt.slice(0, 7)),
    streamId: user.streamId,
    correlationId: row.correlation_id,
    operation: String(evidence.payload.operation ?? `document-render:${parseRequest(row).artifactKind ?? "unknown"}`),
  });
  return reservationId;
}

async function releaseInterruptedAttempt(env: WorkerEnv, user: PilotUser, row: DocumentJobRow, reason: string) {
  if(consentedAdaptiveJob(row)){await failConsequentialExecution(env,row.owner_id,row.job_id,reason);await reconcileConsequentialUsage(env,row.owner_id,row.job_id);return;}
  // Historical planning has no exact non-submission boundary: do not release an uncertain legacy hold.
  if(row.kind==="structure_adaptive"&&(row.attempt_count>0||row.started_at))return;
  if(hasUnsettledProviderSubmission(parseResult(row))||unresolvedPresentationSubmission(row)||unresolvedAudioSubmission(row)||unresolvedModel3dSubmission(row)||unresolvedStoryboardSubmission(row))return;
  const checkpoint=parseResult(row);
  const activeSceneReceipts=Object.values(checkpoint.productionSceneReceipts&&typeof checkpoint.productionSceneReceipts==="object"?checkpoint.productionSceneReceipts as Record<string,Record<string,unknown>>:{});
  const activeFrameReceipts=Object.values(checkpoint.productionFrameReceipts&&typeof checkpoint.productionFrameReceipts==="object"?checkpoint.productionFrameReceipts as Record<string,Record<string,unknown>>:{});
  const plannerUsage=checkpoint.plannerUsage&&typeof checkpoint.plannerUsage==="object"?checkpoint.plannerUsage as Record<string,unknown>:{};
  const hasPaidProvider=Boolean(checkpoint.providerJobId||checkpoint.productionAnchor||Number(plannerUsage.totalTokens??0)>0)||providerSubmissions(checkpoint).some(receipt=>receipt.status==="completed")||activeSceneReceipts.some((receipt)=>receipt.status==="submitted"||receipt.status==="completed")||activeFrameReceipts.length>0;
  const events=await readCorrelatedEvents(env,user.streamId,[row.correlation_id]);
  const restoredCostReservationId=await restoreLegacyCostReservation(env,user,row,events);
  let released:Array<{id:string;tokens:number;operation:string}>=[];
  let receiptAwareSettlement=false;
  if(hasPaidProvider&&(checkpoint.reservationId||restoredCostReservationId)){
    const settlement=await settleInterruptedDocumentJobReservations(env,user,row,{costReservationId:restoredCostReservationId||undefined,reason});
    receiptAwareSettlement=settlement.settled;
    if(settlement.settled&&checkpoint.reservationId)released=[{id:String(checkpoint.reservationId),tokens:settlement.releasedTokens,operation:`document-render:${String(parseRequest(row).artifactKind??"unknown")}`}];
  }else{
    released=await releaseBudgetReservationsForCorrelation(env,user,row.correlation_id,reason);
    const settled=events.some((event)=>event.type==="GenerationUsageRecorded");
    if(!hasPaidProvider&&!settled)await releaseCostReservationsForCorrelation(env,user.billingUserId??user.userId,row.correlation_id,user.streamId);
  }
  try {
    await appendAuditEvent(env, user.streamId, "worker:scheduler", "JobAttemptInterrupted", { job_id: row.job_id, document_id: row.document_id, kind: row.kind, attempt: row.attempt_count, reason, released_reservation_count: released.length }, row.correlation_id);
    if(!receiptAwareSettlement)for(const reservation of released)await appendAuditEvent(env,user.streamId,"worker:policy","BudgetReleased",{reservation_id:reservation.id,reserved_tokens:reservation.tokens,reason,operation:reservation.operation,job_id:row.job_id,attempt:row.attempt_count},row.correlation_id);
  } catch (error) { console.error("document_job_interruption_audit_failed", row.job_id, error instanceof Error ? error.message : "unknown"); }
}

async function failStaleJob(env: WorkerEnv, user: PilotUser, row: DocumentJobRow,detail?:ProviderFailureDetail) {
  // Output Image attempts use the durable call ledger and retained-stage handoff.
  // A stale heartbeat or missing checkpoint receipt cannot prove non-submission.
  // Preserve the original slot, grant and holds until its same-job recovery path
  // or source-free financial reconciliation has decisive evidence.
  if(row.kind==="generate"&&await env.DB.prepare(`SELECT 1 FROM output_operation_slots slot
    JOIN document_jobs job ON job.job_id=slot.job_id
    JOIN output_execution_grants grant_row ON grant_row.scope_key=slot.scope_key AND grant_row.grant_id=slot.grant_id
    WHERE job.job_id=? AND job.owner_id=? AND job.stream_id=? AND job.kind='generate' AND grant_row.actor_user_id=job.owner_id`)
    .bind(row.job_id,row.owner_id,row.stream_id).first())return "held" as const;
  if(consentedAdaptiveJob(row)){const recovered=await certifiedAdaptiveJob(env,user,row,true);if(recovered.status==="completed")return;await failConsequentialExecution(env,row.owner_id,row.job_id,"adaptive_execution_interrupted");}
  const observedResult=row.result_json;
  const timestamp=Date.now();const now = new Date(timestamp).toISOString();const staleBefore=new Date(timestamp-DOCUMENT_JOB_STALE_AFTER_MS).toISOString();
  const previousStage=String(parseResult(row).stage??"");
  if(detail?.code==="provider_submission_uncertain"&&!isPresentationJob(row)&&!unresolvedAudioSubmission(row)&&!unresolvedModel3dSubmission(row)&&!unresolvedStoryboardSubmission(row)&&parseResult(row).providerSubmissionProtocol!==1&&!providerSubmissions(parseResult(row)).length)row.result_json=JSON.stringify({...parseResult(row),providerSubmissionLegacyUncertain:true});
  const errorDetail:ProviderFailureDetail = detail??{ code:"execution_interrupted",category:"server",scope:"unknown",action:"contact_support",message:"The server lost contact with this operation before it finished.",retryable:false,retryAfterMs:null,requestId:null,httpStatus:null };
  const parentId = parentJobIdFromRequest(parseRequest(row));
  const result = await env.DB.prepare("UPDATE document_jobs SET status='failed',error_message=?,completed_at=?,lease_expires_at=NULL,result_json=?,notified_at=CASE WHEN ? IS NULL THEN notified_at ELSE ? END,updated_at=? WHERE job_id=? AND owner_id=? AND status IN ('queued','running','committing') AND correlation_id=? AND result_json IS ? AND (status='queued' OR lease_expires_at<=? OR updated_at<=?) AND NOT (kind='render_document' AND COALESCE(json_extract(request_json,'$.artifactKind'),'')='slides' AND EXISTS(SELECT 1 FROM events terminal WHERE terminal.stream_id=document_jobs.stream_id AND terminal.correlation_id=document_jobs.correlation_id AND terminal.type IN('DocumentRenderCompleted','DocumentRenderFailed')))")
    .bind(errorDetail.code,now,JSON.stringify({...parseResult(row),errorDetail,stage:"failed",progressMessage:failureProgressMessage(errorDetail)}),parentId,now,now,row.job_id,user.userId,row.correlation_id,observedResult,now,staleBefore).run();
  if(Number(result.meta.changes??0)!==1){
    if(requiresForegroundDocumentExecution(row)&&operationFinished(await readCorrelatedEvents(env,user.streamId,[row.correlation_id]),row))await runDocumentJob(env,user,row.job_id);
    return;
  }
  if(hasUnsettledProviderSubmission(parseResult(row))||unresolvedPresentationSubmission(row,errorDetail)||unresolvedAudioSubmission(row)||unresolvedModel3dSubmission(row)||unresolvedStoryboardSubmission(row)){
    try{await appendAuditEvent(env,user.streamId,"worker:scheduler","JobAttemptInterrupted",{job_id:row.job_id,document_id:row.document_id,kind:row.kind,attempt:row.attempt_count,reason:errorDetail.code,released_reservation_count:0,provider_submission_status:"submission_unknown"},row.correlation_id);}catch(error){console.error("document_job_interruption_audit_failed",row.job_id,error instanceof Error?error.message:"unknown");}
  }else await releaseInterruptedAttempt(env,user,row,errorDetail.code);
  await refreshGenerationReceipt(env,user,row,{},errorDetail,previousStage);await reconcileParentForChild(env,row);
}

function operationFinished(events: Awaited<ReturnType<typeof readWorkspaceEvents>>, row: DocumentJobRow) {
  const correlated = events.filter((event) => event.correlationId === row.correlation_id);
  const terminalEvents=row.kind==="render_document"&&parseRequest(row).artifactKind==="model3d"?[...correlated].reverse():correlated;
  const terminal = terminalEvents.find((event) => {
    if (row.kind === "preview") return event.type === "IdeationPreviewCompleted" || event.type === "GenerationFailed";
    if (row.kind === "generate") return event.type === "GenerationCompleted" || event.type === "GenerationFailed";
    if (row.kind === "chat") return event.type === "GenerationUsageRecorded" && event.payload.operation === "creative-chat" || event.type === "BudgetReleased" && event.payload.operation === "creative-chat";
    if (row.kind === "structure_adaptive") return event.type === "GenerationUsageRecorded" && event.payload.operation === "adaptive-structure" || event.type === "BudgetReleased" && event.payload.operation === "adaptive-structure";
    if (row.kind === "render_document") return event.type === "DocumentRenderCompleted" || event.type === "DocumentRenderFailed";
    return event.type === "ExtractionCompleted" || event.type === "ExtractionFailed";
  });
  const failed = terminal?.type === "GenerationFailed" || terminal?.type === "ExtractionFailed" || terminal?.type === "DocumentRenderFailed" || terminal?.type === "BudgetReleased";
  return terminal ? { failed, correlated } : null;
}

function correlatedFailureDetail(events: Awaited<ReturnType<typeof readWorkspaceEvents>>) {
  const failureEvent = [...events].reverse().find((event) => event.type === "GenerationFailed" || event.type === "ExtractionFailed" || event.type === "DocumentRenderFailed");
  if (!failureEvent) return null;
  const payload = failureEvent.payload;
  const detail={
    code: String(payload.error_code ?? payload.error_class ?? "operation_failed"), category: String(payload.error_category ?? "unknown") as DocumentJobError["category"],
    scope: String(payload.error_scope ?? "unknown") as DocumentJobError["scope"], action: String(payload.error_action ?? "none") as DocumentJobError["action"],
    message: String(payload.error_message ?? "The operation failed."), retryable: Boolean(payload.retryable),
    retryAfterMs: payload.retry_after_ms === null || payload.retry_after_ms === undefined || !Number.isFinite(Number(payload.retry_after_ms)) ? null : Number(payload.retry_after_ms),
    requestId: payload.provider_request_id ? String(payload.provider_request_id) : null,
    httpStatus: payload.http_status === null || payload.http_status === undefined || !Number.isFinite(Number(payload.http_status)) ? null : Number(payload.http_status),
    riskCategories: Array.isArray(payload.risk_categories) ? payload.risk_categories.map(String) : [], contributingBlockIds: Array.isArray(payload.contributing_block_ids) ? payload.contributing_block_ids.map(String) : [], contributingReferenceIds: Array.isArray(payload.contributing_reference_ids) ? payload.contributing_reference_ids.map(String) : [], probe: payload.preflight_probe ? String(payload.preflight_probe) : null,
    ...(Array.isArray(payload.validation_issues)?{validationIssues:payload.validation_issues as import("../src/model/presentation-candidates").PresentationCandidateValidationIssue[]}:{}),
  } satisfies DocumentJobError;
  return publicFailureDetail(classifyDocumentJobFailure(detail.message,{...detail,probe:detail.probe??undefined}));
}

function correlatedModerationPromptRef(events: Awaited<ReturnType<typeof readWorkspaceEvents>>) {
  const failureEvent=[...events].reverse().find((event)=>(event.type==="GenerationFailed"||event.type==="DocumentRenderFailed")&&event.payload.prompt_ref);
  return failureEvent?.payload.prompt_ref?String(failureEvent.payload.prompt_ref):null;
}

async function repairMisreportedTerminalJob(env: WorkerEnv, row: DocumentJobRow, events: Awaited<ReturnType<typeof readWorkspaceEvents>>) {
  if (row.status !== "failed" || !/Wrong number of parameter bindings/i.test(row.error_message ?? "")) return false;
  const finished = operationFinished(events, row); if (!finished) return false;
  const detail = finished.failed ? correlatedFailureDetail(finished.correlated) : null;
  const status = finished.failed ? "failed" : "completed";
  const moderationPromptRef=finished.failed?correlatedModerationPromptRef(finished.correlated):null;
  const result = { ...parseResult(row), ...(detail ? { errorDetail: detail } : {}), ...(moderationPromptRef?{moderationPromptRef}:{}), stage: status, progressMessage: finished.failed ? failureProgressMessage(detail) : "The operation finished." };
  await finishDocumentJob(env, row, status, result, detail?.message ?? (finished.failed ? "operation_failed" : null), row.completed_at ?? new Date().toISOString(), false);
  return true;
}

function safeResult(body: Record<string, unknown>, correlatedEventIds: string[] = []) {
  const appended = Array.isArray(body.appended) ? body.appended as Array<Record<string, unknown>> : [];
  const adaptiveReasoning = appended.find((event) => event.type === "AssistantReasoned" && (event.payload as Record<string, unknown> | undefined)?.operation === "adaptive-structure");
  const adaptivePayload = adaptiveReasoning?.payload as Record<string, unknown> | undefined;
  const result = {
    head: Number(body.head ?? 0),
    appendedEventIds: appended.map((event) => String(event.eventId ?? "")).filter(Boolean).concat(correlatedEventIds),
    previewed: Boolean(body.previewed), previewQueued: Boolean(body.previewQueued), previewSuppressed: Boolean(body.previewSuppressed), followupJobId: body.followupJobId ? String(body.followupJobId) : undefined, moderationPromptRef: body.moderationPromptRef ? String(body.moderationPromptRef) : undefined, promoted: Boolean(body.promoted), quality: body.quality ? String(body.quality) : undefined,
    artifactId: body.artifactId ? String(body.artifactId) : undefined, artifactKind: body.artifactKind ? String(body.artifactKind) : undefined,
    providerJobId: body.providerJobId ? String(body.providerJobId) : undefined, provider: body.provider ? String(body.provider) : undefined,
    intentRef: adaptivePayload?.intent_ref ? String(adaptivePayload.intent_ref) : undefined,
    structure: body.structure && typeof body.structure === "object" ? body.structure : undefined,
    ...(typeof body.executionId==="string"?{executionId:body.executionId,bindingHash:body.bindingHash,requestKey:body.requestKey,sourceHash:body.sourceHash,sourceStatus:body.sourceStatus,intent:body.intent,billingStatus:body.billingStatus,noAutomaticRetry:true,executionReceipt:body.executionReceipt,plannerModel:body.plannerModel,plannerResponseId:body.plannerResponseId,plannerUsage:body.plannerUsage,recoveredFromPaidReceipt:body.recoveredFromPaidReceipt}:{}),
  };
  return Object.fromEntries(Object.entries(result).filter(([,value])=>value!==undefined));
}

/** Read/recover only retained paid evidence. The proof is never serialized into the job. */
async function certifiedAdaptiveJob(env:WorkerEnv,user:PilotUser,row:DocumentJobRow,persist=false,readOnly=false):Promise<DocumentJobRow>{
  if(!consentedAdaptiveJob(row))return row;
  let saved:Awaited<ReturnType<typeof readAdaptivePlanningJobResult>>;
  try{saved=await readAdaptivePlanningJobResult(env,user,row,{readOnly});}catch{saved=null;}
  const previous=parseResult(row);delete previous.structure;delete previous.intent;delete previous.quote;delete previous.planningReviewAvailable;
  if(!saved)return{...row,result_json:JSON.stringify({...previous,planningStopBudget:await adaptiveStopBudget(env,user,row),planningReviewAvailable:await adaptivePlanningReviewAvailable(env,user,row),...(row.status==="completed"?{resultUnavailable:true,progressMessage:"The paid planning result is no longer available."}:{})})};
  const result:Record<string,unknown>={...previous,...safeResult(saved.result),stage:"completed",progressMessage:"The approved plan is ready. No document or board decisions were applied."};delete result.resultUnavailable;delete result.errorDetail;
  if(persist&&!readOnly&&row.status!=="completed"){
    const now=new Date().toISOString();
    const updated=await env.DB.prepare(`UPDATE document_jobs SET status='completed',result_json=${PRESERVE_ADAPTIVE_RECEIPT_SQL},error_message=NULL,completed_at=COALESCE(completed_at,?),lease_expires_at=NULL,updated_at=?
      WHERE job_id=? AND owner_id=? AND stream_id=? AND correlation_id=? AND status=? AND attempt_count=? AND request_json=? AND result_json IS ? AND ${saved.proof.sql}`)
      .bind(JSON.stringify(result),now,now,row.job_id,row.owner_id,row.stream_id,row.correlation_id,row.status,row.attempt_count,row.request_json,row.result_json,...saved.proof.bindings).run();
    if(Number(updated.meta.changes??0)!==1){const fresh=await readJob(env,user.userId,row.job_id);return fresh?certifiedAdaptiveJob(env,user,fresh,false):{...row,result_json:JSON.stringify({...previous,resultUnavailable:true})};}
    row=await readJob(env,user.userId,row.job_id)??row;
  }
  if(!await env.DB.prepare(`SELECT 1 AS retained WHERE ${saved.proof.sql}`).bind(...saved.proof.bindings).first())return{...row,result_json:JSON.stringify({...previous,resultUnavailable:true})};
  const certified:DocumentJobRow={...row,status:"completed",error_message:null,result_json:JSON.stringify({...result,planningReviewAvailable:true})};certifiedAdaptiveRows.add(certified);return certified;
}
const adaptiveJobActor=(principal:PilotUser,binding:ConsequentialBinding):PilotUser=>({...principal,streamId:binding.streamId,billingUserId:principal.userId,...(binding.scope?{projectExecution:binding.scope}:{})});
async function handleAdaptiveDocumentJobs(request:Request,env:WorkerEnv,context?:WorkerExecutionContext){
  const ports:AdaptivePlanningPorts={
    read:async(principal,binding,id)=>{
      const actor=adaptiveJobActor(principal,binding),row=await readJob(env,principal.userId,id);
      if(!row||row.stream_id!==binding.streamId||row.document_id!==binding.documentId||!consentedAdaptiveJob(row)||row.expires_at<=new Date().toISOString())return null;
      if(binding.scope&&!await env.DB.prepare(`SELECT 1 FROM project_resource_scopes resource JOIN events anchor ON anchor.event_id=resource.source_event_id
        WHERE resource.resource_kind='job' AND resource.resource_id=? AND resource.actor_user_id=? AND resource.owner_user_id=? AND resource.project_access_id=? AND resource.organization_id=? AND resource.project_id=?
          AND anchor.stream_id=? AND anchor.actor='user:'||resource.actor_user_id AND anchor.type='ProjectDocumentJobQueued' AND json_extract(anchor.payload,'$.job_id')=resource.resource_id`).bind(id,principal.userId,binding.scope.ownerUserId,binding.scope.projectAccessId,binding.scope.organizationId,binding.projectId,binding.streamId).first())return null;
      const certified=await certifiedAdaptiveJob(env,actor,row,true);
      const paid=certifiedAdaptiveRows.has(certified)?await readAdaptivePlanningJobResult(env,actor,certified):null;
      if(certifiedAdaptiveRows.has(certified)&&!paid)throw new Error("adaptive_result_unavailable");
      return{job:binding.scope?safeScopedJob(certified):serializeJob(certified),...(paid?{proof:paid.proof}:{})};
    },
    admit:async(prepared:AdaptivePlanningPrepared,id:string,hash:string)=>{
      const{binding}=prepared,actor=adaptiveJobActor(prepared.principal,binding),now=new Date().toISOString();
      const consent=await env.DB.prepare(`SELECT content.content_id,content.content,content.expires_at FROM consequential_executions execution JOIN private_content content ON content.content_id=execution.consent_ref AND content.owner_id=execution.actor_user_id
        WHERE execution.execution_id=? AND execution.actor_user_id=? AND execution.binding_hash=? AND content.kind='execution-consent' AND content.redacted_at IS NULL AND content.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')`).bind(id,actor.userId,hash).first<{content_id:string;content:string;expires_at:string}>();
      if(!consent||await consentHash(JSON.parse(consent.content).binding)!==hash)return Response.json({error:"context_consent_changed",submission:"not-submitted"},{status:409});
      const requestBody={adaptiveConsentVersion:1,executionId:id,bindingHash:hash,projectId:binding.projectId,canvasId:binding.canvasId,requestKey:prepared.requestKey,locale:prepared.settings.locale,projectScope:prepared.settings.projectScope,sourceSurface:prepared.settings.sourceSurface,...(prepared.settings.replaceExecutionId?{replacesExecutionId:prepared.settings.replaceExecutionId}:{})};
      const board=binding.canvasId?livePlanningBoardGuard(binding.streamId,binding.projectId,binding.canvasId):{sql:"1",bindings:[]};
      const custody=executionContentCustodyGuard(binding);
      const admission:BudgetReservationGuard={sql:`EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND kind='execution-consent' AND content=? AND redacted_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND ${custody.sql}) AND (${board.sql})
        AND NOT EXISTS(SELECT 1 FROM document_jobs existing WHERE existing.owner_id=? AND existing.stream_id=? AND existing.document_id=? AND existing.kind='structure_adaptive' AND existing.job_id!=? AND existing.status IN('queued','running','committing') AND existing.source_surface=? AND COALESCE(json_extract(existing.request_json,'$.canvasId'),'')=?)`,bindings:[consent.content_id,actor.userId,consent.content,...custody.bindings,...board.bindings,actor.userId,binding.streamId,binding.documentId,id,prepared.settings.sourceSurface,binding.canvasId??""]};
      const claimedGuard:BudgetReservationGuard={sql:"EXISTS(SELECT 1 FROM consequential_executions WHERE execution_id=? AND actor_user_id=? AND binding_hash=? AND status='reserved')",bindings:[id,actor.userId,hash]};
      const inserted=documentJobInsert(env,actor,binding.documentId,"?,?,?,?,?,'queued',?,?,?,?,?,NULL,0,?,NULL,NULL,NULL,NULL,?,?",[id,actor.userId,binding.streamId,binding.documentId,"structure_adaptive",prepared.settings.sourceSurface,id,prepared.sourceHead,JSON.stringify(requestBody),JSON.stringify({executionId:id,bindingHash:hash,requestKey:prepared.requestKey,stage:"queued",progressMessage:"This exact planning request was approved. No provider call has been made."}),now,consent.expires_at,now],undefined,claimedGuard);
      const resource=projectJobResource(env,actor,id,binding.documentId,now,true);
      const statements=[inserted,...(resource?[resource]:[])];
      if(resource&&binding.scope){
        const scope=binding.scope,anchor=makeEvent(binding.streamId,prepared.sourceHead+1,`user:${actor.userId}`,"server:document-job:structure_adaptive",id,"ProjectDocumentJobQueued",projectJobAnchorPayload(scope,{jobId:id,kind:"structure_adaptive",documentId:binding.documentId}));
        // The same exact-source claim admits the job, resource and canonical anchor atomically.
        statements.push(env.DB.prepare(`INSERT INTO event_write_stage (${EVENT_WRITE_COLUMNS}) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
          WHERE EXISTS(SELECT 1 FROM project_resource_scopes resource JOIN document_jobs job ON job.job_id=resource.resource_id
            WHERE resource.resource_kind='job' AND resource.resource_id=? AND resource.actor_user_id=? AND resource.source_event_id IS NULL
              AND resource.project_access_id=? AND resource.organization_id=? AND resource.project_id=? AND resource.owner_user_id=?
              AND job.owner_id=resource.actor_user_id AND job.stream_id=? AND job.document_id=? AND job.status='queued')`)
          .bind(...eventWriteBindings(anchor),id,actor.userId,scope.projectAccessId,scope.organizationId,scope.projectId,scope.ownerUserId,binding.streamId,binding.documentId));
        statements.push(env.DB.prepare(`UPDATE project_resource_scopes SET source_event_id=? WHERE resource_kind='job' AND resource_id=? AND actor_user_id=? AND source_event_id IS NULL
          AND project_access_id=? AND organization_id=? AND project_id=? AND owner_user_id=? AND EXISTS(SELECT 1 FROM events WHERE event_id=? AND stream_id=?)`)
          .bind(anchor.eventId,id,actor.userId,scope.projectAccessId,scope.organizationId,scope.projectId,scope.ownerUserId,anchor.eventId,binding.streamId));
      }
      const intent=adaptivePlanningAdmissionGuard(prepared,id);
      const claimed=await claimConsequentialExecution(env,prepared.principal,binding,id,hash,prepared.sourceHead,statements,{sql:`(${admission.sql}) AND (${intent.sql})`,bindings:[...admission.bindings,...intent.bindings]});
      if(!claimed.row)return await adaptivePriorExecutionResponse(env,prepared,ports,id)??Response.json({error:claimed.error,submission:"not-submitted"},{status:claimed.status});
      if(claimed.row.execution_id!==id)return adaptiveExecutionResponse(env,prepared,claimed.row.execution_id,ports,id);
      const row=await readJob(env,actor.userId,id);
      if(!row){await failConsequentialExecution(env,actor.userId,id,"adaptive_job_admission_failed");return Response.json({error:"adaptive_job_admission_failed",submission:"not-submitted"},{status:409});}
      if(resource){const anchored=await activeProjectExecution(env,actor,binding.documentId,id);if(!anchored)await anchorProjectJobs(env,actor,[{jobId:id,kind:"structure_adaptive",documentId:binding.documentId}]);}
      context?.waitUntil(driveDocumentQueue(env,actor));
      return adaptiveExecutionResponse(env,prepared,id,ports);
    },
  };
  return handleAdaptivePlanning(request,env,ports);
}

/** Recover the original paid plan from its retained actor-private receipt, never by regenerating. */
async function retainedAdaptiveResult(env:WorkerEnv,user:PilotUser,row:DocumentJobRow,events:Awaited<ReturnType<typeof readCorrelatedEvents>>){
  const reasoned=events.find((event)=>event.type==="AssistantReasoned"&&event.payload.operation==="adaptive-structure");
  const contentRef=String(reasoned?.payload.content_ref??"");
  if(!contentRef)return null;
  const retained=await loadPrivateContent(env,user.userId,"all",user.projectExecution),raw=retained[contentRef];
  if(!raw)return null;
  const binding:ConsequentialBinding={version:"adaptive-result-read-v1",intentHash:"",operation:"adaptive-result-read",actorUserId:user.userId,permissionEpoch:user.access.permissionEpoch,streamId:row.stream_id,projectId:String(reasoned?.payload.project_id??""),documentId:row.document_id,canvasId:null,blockId:"",sourceHash:"",period:"",scope:user.projectExecution??null,contextSessionId:null,pilotCohortId:null,steps:[],publicQuery:"",request:null};
  try{const value=JSON.parse(raw) as Record<string,unknown>;return value&&typeof value==="object"&&!Array.isArray(value)&&typeof value.interpretation==="string"&&value.active_decision&&Array.isArray(value.suggested_blocks)&&Array.isArray(value.hidden_until_later)?{structure:value,contentRef,raw,binding}:null;}catch{return null;}
}

async function queueFollowupPreview(env:WorkerEnv,user:PilotUser,parent:DocumentJobRow,spec:Record<string,unknown>){
  if(spec.kind!=="preview"||String(spec.documentId??"")!==parent.document_id)return null;const payload=spec.payload&&typeof spec.payload==="object"?{...(spec.payload as Record<string,unknown>)}:{};if(!payload.directionRef||JSON.stringify(payload).length>MAX_PAYLOAD_BYTES)return null;
  if(!await activeProjectExecution(env,user,parent.document_id,parent.job_id))return null;
  const organizationRetention=user.projectExecution?await env.DB.prepare("SELECT transient_days FROM organization_retention_policies WHERE organization_id=?").bind(user.projectExecution.organizationId).first<{transient_days:number}>():null;
  const requestedAt=new Date();const now=requestedAt.toISOString();const configuredRetention=Number(organizationRetention?.transient_days??env.FORMA_RETENTION_DAYS??30);const retentionDays=Number.isFinite(configuredRetention)&&configuredRetention>0?configuredRetention:30;const expiresAt=new Date(requestedAt.getTime()+retentionDays*86_400_000).toISOString();const jobId=uuidV7();const sourceSurface=String(spec.sourceSurface??"chat").slice(0,80)||"chat";const requestedSequence=await streamHead(env,user.streamId);
  payload.documentRevision=`chat-${parent.job_id}`;payload.promptTechnique=normalizePromptTechnique(payload.promptTechnique);payload.requestKey=documentGenerationRequestKey("preview",String(payload.documentRevision),null,String(payload.promptTechnique));
  const statements=[env.DB.prepare("UPDATE document_jobs SET status='failed',error_message='superseded_by_newer_chat_preview',completed_at=?,notified_at=?,updated_at=? WHERE owner_id=? AND stream_id=? AND document_id=? AND kind='preview' AND source_surface='chat' AND status='queued'").bind(now,now,now,user.userId,user.streamId,parent.document_id),
    documentJobInsert(env,user,parent.document_id,"?,?,?,?,?,'queued',?,?,?,?,NULL,NULL,0,?,NULL,NULL,NULL,NULL,?,?",[jobId,user.userId,user.streamId,parent.document_id,"preview",sourceSurface,jobId,requestedSequence,JSON.stringify(payload),now,expiresAt,now])];
  const resource=projectJobResource(env,user,jobId,parent.document_id,now);if(resource)statements.push(resource);
  const results=await env.DB.batch(statements);
  if(Number(results[1]?.meta.changes??0)!==1||resource&&Number(results[2]?.meta.changes??0)!==1)return null;
  if(resource)await anchorProjectJobs(env,user,[{jobId,kind:"preview",documentId:parent.document_id}]);
  return readJob(env,user.userId,jobId);
}

export async function runDocumentJob(env: WorkerEnv, user: PilotUser, jobId: string, verifiedRow?:DocumentJobRow) {
  await ensureSchema(env);
  await ensureOutputRequirementsSchema(env);
  let row=verifiedRow&&verifiedRow.job_id===jobId&&verifiedRow.owner_id===user.userId&&verifiedRow.stream_id===user.streamId?verifiedRow:await readJob(env,user.userId,jobId);if(!row)return row;
  if(!row.output_slot_id&&!await activeProjectExecution(env,user,row.document_id,jobId)){
    if(user.projectExecution)await cancelProjectActorJobs(env,user,{organizationId:user.projectExecution.organizationId,projectAccessId:user.projectExecution.projectAccessId,actorUserId:user.userId});
    return null;
  }
  if (row.kind === "prompt_fan") return reconcilePromptFanParent(env, user.userId, row.job_id);
  if(consentedAdaptiveJob(row)){
    const recovered=await certifiedAdaptiveJob(env,user,row,true);
    if(recovered.status==="completed")return recovered;
  }
  if (documentJobTerminal({ status: row.status })) {await synchronizeOutputJobOutcome(env,row);return row;}
  const outputBinding=await loadOutputJobBinding(env,user,row);
  if(outputBinding)row.output_slot_id=outputBinding.slot.slotId;
  if(outputBinding&&!['queued','running'].includes(outputBinding.slot.status))return row;
  let outputAdmissionAssertions:OutputSqlAssertion[]=[];let outputProof:OutputExecutionProof|undefined;let nativeExecutionPolicy:OutputNativeExecutionPolicy=OUTPUT_NATIVE_EXECUTION_POLICY;
  if(outputBinding){
    try{outputProof=prepareOutputExecutionProof(outputBinding.scope,await resolveOutputExecutionAuthority(env,outputBinding.scope,outputBinding.slot));const policy=readOutputNativeExecutionPolicy((outputProof.targetPreflight.settings as Record<string,unknown>).executionPolicy);if(!policy)throw new OutputConflictError("output_execution_policy_invalid",409);nativeExecutionPolicy=policy;const jobAuthority=documentJobProjectAuthority(user,row.document_id,jobId);outputAdmissionAssertions=[...outputProof.assertions,...(jobAuthority?[jobAuthority]:[])];}
    catch(error){
      const detail=classifyDocumentJobFailure(error);
      await finishDocumentJob(env,row,"failed",{...parseResult(row),errorDetail:publicFailureDetail(detail),stage:"failed",progressMessage:"The Output source, requirement, or permission changed. No new provider request was sent."},detail.message,new Date().toISOString(),false);
      const blocked=await readJob(env,user.userId,jobId);
      if(blocked){await releaseInterruptedAttempt(env,user,blocked,"output_authority_changed_before_dispatch");await synchronizeOutputJobOutcome(env,blocked);}
      return readJob(env,user.userId,jobId);
    }
  }
  // A fresh native slot/job was admitted together and has no earlier attempt.
  // Its claim below still compares the exact current row and guards zero calls.
  const freshOutput=Boolean(outputBinding&&row.status==="queued"&&row.attempt_count===0);
  const existingEvents = freshOutput?[]:await readCorrelatedEvents(env, user.streamId, [row.correlation_id]);
  const finished = operationFinished(existingEvents, row);
  const queuedRequest=parseRequest(row);const queuedCheckpoint=parseResult(row);
  const resumeConfirmedStoryboardFailure=Boolean(finished?.failed&&row.status==="queued"&&row.attempt_count>0&&row.kind==="render_document"&&queuedRequest.artifactKind==="storyboard"&&queuedRequest.productionMode==="manual"&&queuedCheckpoint.storyboardProviderSubmission==="confirmed"&&typeof queuedCheckpoint.providerJobId==="string"&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u.test(queuedCheckpoint.providerJobId)&&!["pending","submitted","unknown"].includes(queuedCheckpoint.providerJobId.toLowerCase())&&queuedCheckpoint.artifactPlan&&queuedCheckpoint.reservationId&&queuedCheckpoint.costReservationId);
  const resumeSaferStoryboardFailure=Boolean(finished?.failed&&row.status==="queued"&&row.attempt_count>0&&row.kind==="render_document"&&queuedRequest.artifactKind==="storyboard"&&queuedRequest.productionMode==="manual"&&trustedStoryboardSafeRecovery(queuedCheckpoint));
  const resumeConfirmedModel3dFailure=Boolean(finished?.failed&&row.status==="queued"&&row.attempt_count>0&&row.kind==="render_document"&&queuedRequest.artifactKind==="model3d"&&model3dRecoveryProviderReceipt(queuedCheckpoint)&&queuedCheckpoint.model3dInputReceipt&&queuedCheckpoint.reservationId&&queuedCheckpoint.costReservationId);
  if (finished&&!resumeConfirmedStoryboardFailure&&!resumeSaferStoryboardFailure&&!resumeConfirmedModel3dFailure) {
    const now = new Date().toISOString(); const status: DocumentJobStatus = finished.failed ? "failed" : "completed";let followup:DocumentJobRow|null=null;
    if(!finished.failed&&row.kind==="chat"){const reasoned=finished.correlated.find((event)=>event.type==="AssistantReasoned"&&event.payload.preview_queued&&event.payload.preview_direction_ref);if(reasoned)followup=await queueFollowupPreview(env,user,row,{kind:"preview",documentId:row.document_id,sourceSurface:"chat",payload:{directionRef:reasoned.payload.preview_direction_ref,directionModel:reasoned.payload.model_id,sourceChatTurnId:reasoned.payload.turn_id,locale:parseRequest(row).locale??"en"}});}
    const failureDetail = finished.failed ? correlatedFailureDetail(finished.correlated) : null;const moderationPromptRef=finished.failed?correlatedModerationPromptRef(finished.correlated):null;
    const checkpoint=parseResult(row);
    const sceneConfiguration=row.kind==="render_document"?sceneConfigurationFromRequest(queuedRequest):null;
    const adaptive=row.kind==="structure_adaptive",retained=adaptive&&!finished.failed?await retainedAdaptiveResult(env,user,row,finished.correlated):null,structure=retained?.structure??null;
    if(adaptive){delete checkpoint.structure;if(!finished.failed)delete checkpoint.errorDetail;}
    const result = { ...(finished.failed||adaptive ? checkpoint : {}), ...(checkpoint.generationReceipt?{generationReceipt:checkpoint.generationReceipt}:{}), ...safeResult({ head: await streamHead(env,user.streamId),previewQueued:Boolean(followup),followupJobId:followup?.job_id,moderationPromptRef,...(adaptive?{appended:finished.correlated,structure}: {}) }, adaptive?[]:finished.correlated.map((event) => event.eventId)), ...(sceneConfiguration?{sceneMedium:sceneConfiguration.medium,sceneConfiguration}:{}), ...(failureDetail ? { errorDetail: failureDetail } : {}), ...(adaptive&&!finished.failed&&!structure?{resultUnavailable:true}:{}), stage: status, progressMessage: finished.failed ? failureProgressMessage(failureDetail) : adaptive&&!structure?"The paid operation finished, but its private plan is no longer retained.":"The operation finished." };
    if(adaptive){
      const scope=privateContentScopeGuard(user.userId,user.projectExecution),authority=retained?executionAdmissionGuard(user,retained.binding,null):{sql:"0",bindings:[]};
      const contentCurrent=retained?{sql:`EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND kind='adaptive-structure' AND content=? AND redacted_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND ${scope.sql}) AND ${authority.sql}`,bindings:[retained.contentRef,user.userId,retained.raw,...scope.bindings,...authority.bindings]}:{sql:"0",bindings:[]};
      const unavailable=finished.failed?result:{...result,structure:undefined,resultUnavailable:true,progressMessage:"The paid operation finished, but its private plan is no longer retained."};
      // Both the job snapshot and private retention/authority are checked at the write itself.
      await env.DB.prepare(`UPDATE document_jobs SET status=?,result_json=CASE WHEN ${contentCurrent.sql} THEN ? ELSE ? END,error_message=?,completed_at=?,lease_expires_at=NULL,updated_at=? WHERE job_id=? AND owner_id=? AND stream_id=? AND correlation_id=? AND status=? AND attempt_count=? AND request_json=? AND result_json IS ? AND updated_at=?`)
        .bind(status,...contentCurrent.bindings,JSON.stringify(result),JSON.stringify(unavailable),failureDetail?.message??(finished.failed?"operation_failed":null),now,now,row.job_id,row.owner_id,row.stream_id,row.correlation_id,row.status,row.attempt_count,row.request_json,row.result_json,row.updated_at).run();
      if(retained&&!await executionAuthorityCurrent(env,user,retained.binding,null))return null;
    }else await finishDocumentJob(env, row, status, result, failureDetail?.message ?? (finished.failed ? "operation_failed" : null), now, false);
    await refreshGenerationReceipt(env,user,row,{appended:finished.correlated},failureDetail?{...failureDetail,probe:failureDetail.probe??undefined}:null);
    await reconcileParentForChild(env, row);
    const reconciled=await readJob(env,user.userId,jobId);if(reconciled&&outputBinding)await synchronizeOutputJobOutcome(env,reconciled);
    return reconciled;
  }

  if(row.kind==="structure_adaptive"&&!consentedAdaptiveJob(row)){
    const now=new Date().toISOString(),uncertain=row.attempt_count>0||Boolean(row.started_at)||Boolean(await env.DB.prepare("SELECT 1 FROM cost_budget_reservations WHERE owner_id=? AND correlation_id=? AND status IN('active','executing') LIMIT 1").bind(row.owner_id,row.correlation_id).first());
    const code=uncertain?"provider_submission_uncertain":"adaptive_consent_required";
    const result={...parseResult(row),errorDetail:{...applicationFailureDetail(code,null,409),retryable:false},noAutomaticRetry:true,stage:"failed",progressMessage:uncertain?"This historical planning request may already be billable. It will not be submitted again.":"Review and approve an exact planning request before it runs."};
    await env.DB.prepare("UPDATE document_jobs SET status='failed',result_json=?,error_message=?,completed_at=?,lease_expires_at=NULL,updated_at=? WHERE job_id=? AND owner_id=? AND status=? AND attempt_count=? AND correlation_id=? AND request_json=? AND result_json IS ?")
      .bind(JSON.stringify(result),code,now,now,row.job_id,row.owner_id,row.status,row.attempt_count,row.correlation_id,row.request_json,row.result_json).run();
    return readJob(env,user.userId,jobId);
  }
  if(row.kind==="structure_adaptive"){
    const destination=parseRequest(row),projectId=String(destination.projectId??""),canvasId=String(destination.canvasId??"");
    if((row.source_surface==="canvas"||canvasId)&&!await planningBoardCurrent(env,user.streamId,projectId,canvasId)){
      const board=livePlanningBoardGuard(row.stream_id,projectId,canvasId),now=new Date().toISOString();
      const result={...parseResult(row),errorDetail:applicationFailureDetail("canvas_not_found",null,409),stage:"failed",progressMessage:"The exact planning board is no longer available."};
      // Reject only this never-started snapshot. Paid/running work and restored boards win.
      await env.DB.prepare(`UPDATE document_jobs SET status='failed',result_json=?,error_message='canvas_not_found',completed_at=?,lease_expires_at=NULL,updated_at=?
        WHERE job_id=? AND owner_id=? AND stream_id=? AND document_id=? AND kind='structure_adaptive' AND source_surface=? AND correlation_id=?
          AND status='queued' AND attempt_count=0 AND started_at IS NULL AND request_json=? AND result_json IS ? AND NOT (${board.sql})`)
        .bind(JSON.stringify(result),now,now,row.job_id,row.owner_id,row.stream_id,row.document_id,row.source_surface,row.correlation_id,row.request_json,row.result_json,...board.bindings).run();
      const failed=await readJob(env,user.userId,jobId);if(failed?.status==="failed"&&consentedAdaptiveJob(failed))await releaseInterruptedAttempt(env,user,failed,"canvas_not_found");
      return failed;
    }
  }

  if(row.status==="committing"){
    if(rowIsStale(row))await failStaleJob(env,user,row);
    return readJob(env,user.userId,jobId);
  }

  const independentPresentation=isPresentationJob(row)&&queuedRequest.productionMode==="manual";
  // A manually approved presentation may run alongside a long-lived video in
  // another verified project. Unknown ownership, every same-project job, and
  // every other workload retain the original account-wide serialization.
  const blocker = await env.DB.prepare(`SELECT candidate.job_id FROM document_jobs candidate
    JOIN document_jobs target ON target.job_id=? AND target.owner_id=? AND target.stream_id=?
    WHERE candidate.stream_id=target.stream_id AND candidate.kind!='prompt_fan' AND candidate.status IN ('queued','running','committing')
      AND NOT (candidate.status='queued' AND candidate.kind='render_document' AND COALESCE(json_extract(candidate.request_json,'$.artifactKind'),'')='slides')
      AND NOT EXISTS(SELECT 1 FROM output_operation_slots output_slot WHERE output_slot.job_id=candidate.job_id AND output_slot.status NOT IN('queued','running'))
      AND (candidate.requested_at<? OR (candidate.requested_at=? AND candidate.job_id<?))
      AND NOT (?=1 AND candidate.kind='render_document'
        AND COALESCE(json_extract(candidate.request_json,'$.artifactKind'),'')='video'
        AND ${documentJobProjectSql("target")}<>''
        AND ${documentJobProjectSql("candidate")} NOT IN ('',${documentJobProjectSql("target")}))
    ORDER BY candidate.requested_at ASC,candidate.job_id ASC LIMIT 1`)
    .bind(row.job_id,user.userId,user.streamId,row.requested_at,row.requested_at,row.job_id,Number(independentPresentation))
    .first<{job_id:string}>();
  if (blocker) return row;
  if (row.status === "running" && !rowIsStale(row)) return row;
  const imageRecoveryCalls=outputBinding&&row.kind==="generate"?(await env.DB.prepare("SELECT call_key,stage_key,client_request_id,request_digest,provider,model,status,used_microusd,provider_response_id FROM output_provider_calls WHERE scope_key=? AND slot_id=? ORDER BY call_key")
    .bind(outputBinding.scope.key,outputBinding.slot.slotId).all<ImageRecoveryProviderCall>()).results:null;
  if(imageRecoveryCalls){
    // Native execution owns a fixed lease; an old heartbeat alone is not a takeover boundary.
    if(row.status==="running"&&(!Number.isFinite(Date.parse(String(row.lease_expires_at)))||Date.parse(String(row.lease_expires_at))>Date.now()))return row;
    if(row.attempt_count>=documentJobMaxAttempts(row.kind))return row;
    const recovery=classifyImageRecoveryCandidate(row,imageRecoveryCalls);
    // An initial event append without a retained stage has no resumable anchor
    // handoff. Keep it unresolved; do not create another generation identity.
    const unretainedAnchors=["GenerationRequested","ContextCompiled","BudgetReserved"];
    if(recovery==="undispatched"&&existingEvents.some(event=>unretainedAnchors.includes(event.type)))return row;
    const claimExcludedEvents=["GenerationCompleted","GenerationFailed",...(recovery==="undispatched"?unretainedAnchors:[])];
    // Shape classification is not permission to spend. The execution factory
    // rechecks the exact retained private body and current authority before use.
    if(recovery==="unresolved"||recovery==="observe")return row;
    outputAdmissionAssertions.push({
      sql:`(SELECT COUNT(*) FROM output_provider_calls WHERE scope_key=? AND slot_id=?)=?${imageRecoveryCalls.map(()=>" AND EXISTS(SELECT 1 FROM output_provider_calls WHERE scope_key=? AND slot_id=? AND call_key=? AND stage_key=? AND client_request_id=? AND request_digest=? AND provider=? AND model=? AND status=? AND used_microusd IS ? AND provider_response_id IS ?)").join("")}`,
      bindings:[outputBinding!.scope.key,outputBinding!.slot.slotId,imageRecoveryCalls.length,...imageRecoveryCalls.flatMap(call=>[outputBinding!.scope.key,outputBinding!.slot.slotId,call.call_key,call.stage_key,call.client_request_id,call.request_digest,call.provider,call.model,call.status,call.used_microusd,call.provider_response_id])],
    },{
      sql:"NOT EXISTS(SELECT 1 FROM events WHERE stream_id=? AND correlation_id=? AND type IN(SELECT value FROM json_each(?)))",
      bindings:[row.stream_id,row.correlation_id,JSON.stringify(claimExcludedEvents)],
    });
  }
  if(!imageRecoveryCalls&&(row.status==="running"||row.status==="queued"&&row.attempt_count>0)&&requiresForegroundDocumentExecution(row)){const unsafe=unsafePaidRecovery(row);if(unsafe){await failStaleJob(env,user,row,unsafe);return readJob(env,user.userId,jobId);}}
  if(row.status==="running"&&unresolvedAudioSubmission(row)){await failStaleJob(env,user,row,{code:"provider_submission_uncertain",category:"network",scope:"network",action:"contact_support",message:"The paid music request may already have reached Lyria. Automatic resubmission was stopped to prevent a duplicate charge.",retryable:false,retryAfterMs:null,requestId:null,httpStatus:null});return readJob(env,user.userId,jobId);}
  if(row.status==="running"&&unresolvedStoryboardSubmission(row)){
    const checkpoint=parseResult(row);const confirmed=checkpoint.storyboardProviderSubmission==="confirmed"&&Boolean(checkpoint.providerJobId);
    await failStaleJob(env,user,row,{code:confirmed?"execution_interrupted":"provider_submission_uncertain",category:confirmed?"server":"network",scope:confirmed?"unknown":"network",action:confirmed?"retry":"contact_support",message:confirmed?"The accepted storyboard frame stopped before its result was saved. Resume the same provider request without submitting another paid frame.":"The storyboard frame may already have reached its provider. Automatic resubmission was stopped to prevent a duplicate charge.",retryable:confirmed,retryAfterMs:null,requestId:confirmed?String(checkpoint.providerJobId):null,httpStatus:null});
    return readJob(env,user.userId,jobId);
  }
  if (row.status === "running" && row.attempt_count >= documentJobMaxAttempts(row.kind)) { await failStaleJob(env, user, row); return readJob(env, user.userId, jobId); }

  const previousAttempt = row.attempt_count; const previousRow = { ...row }; const previousCheckpoint:Record<string,unknown> = {...parseResult(previousRow),...(parseRequest(row).artifactKind==="model3d"?model3dRecoveryProviderReceipt(parseResult(previousRow))??{}:{})}; const attempt = previousAttempt + 1;
  const previousSceneReceipts = Object.values(previousCheckpoint.productionSceneReceipts && typeof previousCheckpoint.productionSceneReceipts === "object" ? previousCheckpoint.productionSceneReceipts as Record<string, Record<string, unknown>> : {});
  const previousFrameReceipts = Object.values(previousCheckpoint.productionFrameReceipts && typeof previousCheckpoint.productionFrameReceipts === "object" ? previousCheckpoint.productionFrameReceipts as Record<string, Record<string, unknown>> : {});
  const hasSavedPaidPresentation=row.kind==="render_document"&&Boolean(previousCheckpoint.plannerResponseId)&&Boolean(previousCheckpoint.artifactPlan)&&!unsafePaidRecovery(row);
  const hasPaidProviderCheckpoint = hasSavedPaidPresentation||trustedStoryboardSafeRecovery(previousCheckpoint)||Boolean(previousCheckpoint.providerJobId||previousCheckpoint.productionAnchor)
    || previousSceneReceipts.some((receipt) => Boolean(receipt.providerJobId) && (receipt.status === "submitted" || receipt.status === "completed"))
    || previousFrameReceipts.length > 0;
  const settledModel3dGuard=!outputBinding&&previousAttempt>0&&row.kind==="render_document"&&parseRequest(row).artifactKind==="model3d"&&previousCheckpoint.model3dInputReceipt&&model3dRecoveryProviderReceipt(previousCheckpoint)?model3dRecoveryReservationGuard(user,row,previousCheckpoint,true):null;
  const settledModel3dRecovery=Boolean(settledModel3dGuard&&await env.DB.prepare(`SELECT 1 WHERE ${settledModel3dGuard.sql}`).bind(...(settledModel3dGuard.bindings??[])).first());
  const handoffPaidProviderReservations = !settledModel3dRecovery&&(Boolean(outputBinding) || previousAttempt > 0 && row.kind === "render_document" && hasPaidProviderCheckpoint
    && Boolean(previousCheckpoint.reservationId && previousCheckpoint.costReservationId));
  const now = new Date(); const nowIso = now.toISOString(); const staleBefore = new Date(now.getTime() - DOCUMENT_JOB_STALE_AFTER_MS).toISOString(); const leaseExpiresAt = new Date(now.getTime() + (outputBinding?nativeExecutionPolicy.maximumMilliseconds:DOCUMENT_JOB_LEASE_MS)).toISOString();
  const attemptCorrelationId=settledModel3dRecovery?row.correlation_id:consentedAdaptiveJob(row)?jobId:`${jobId}:attempt:${attempt}`;const foregroundPresentation=isPresentationJob(row);const initialResult={...previousCheckpoint,...(requiresForegroundDocumentExecution(row)?{providerSubmissionProtocol:1}:{}),stage:foregroundPresentation?"compiling":"preparing",progressMessage:foregroundPresentation?attempt>1?"Recovering the interrupted presentation and compiling its authorized document context.":"Compiling the document into the requested presentation.":attempt>1?"Recovering the interrupted operation.":"Preparing the document context."};
  const claimSql=`UPDATE document_jobs SET status='running',attempt_count=attempt_count+1,correlation_id=?,started_at=COALESCE(started_at,?),lease_expires_at=?,result_json=?,updated_at=? WHERE job_id=? AND owner_id=? AND stream_id=? AND (status='queued' OR (status='running' AND (lease_expires_at<?${outputBinding?'':' OR updated_at<?'}))) AND correlation_id=? AND result_json IS ?${imageRecoveryCalls?' AND status=? AND attempt_count=? AND request_json=? AND updated_at=?':''} AND NOT EXISTS(SELECT 1 FROM document_jobs active WHERE active.stream_id=document_jobs.stream_id AND active.job_id<>document_jobs.job_id AND active.kind!='prompt_fan' AND active.status IN('running','committing')
    AND NOT (?=1 AND active.kind='render_document' AND COALESCE(json_extract(active.request_json,'$.artifactKind'),'')='video'
      AND ${documentJobProjectSql("document_jobs")}<>''
      AND ${documentJobProjectSql("active")} NOT IN ('',${documentJobProjectSql("document_jobs")})))`;
  const claimBindings=[attemptCorrelationId,nowIso,leaseExpiresAt,JSON.stringify(initialResult),nowIso,jobId,user.userId,user.streamId,nowIso,...(outputBinding?[]:[staleBefore]),row.correlation_id,row.result_json,...(imageRecoveryCalls?[row.status,row.attempt_count,row.request_json,row.updated_at]:[]),Number(independentPresentation)] as const;
  let claimed;
  if (handoffPaidProviderReservations) {
    const billingOwnerId = user.billingUserId ?? user.userId;
    const tokenReservationId=String(previousCheckpoint.reservationId);
    const costReservationId=String(previousCheckpoint.costReservationId);
    const operation=row.kind==="generate"?"image-generation":`document-render:${String(parseRequest(previousRow).artifactKind??"unknown")}`;
    const claimAttempt=env.DB.prepare(`${claimSql} AND EXISTS (SELECT 1 FROM budget_reservations token JOIN cost_budget_reservations cost ON cost.owner_id=token.owner_id AND cost.stream_id=token.stream_id AND cost.correlation_id=token.correlation_id AND cost.operation=token.operation AND cost.period=token.period WHERE token.reservation_id=? AND cost.reservation_id=? AND token.owner_id=? AND token.stream_id=? AND token.correlation_id=? AND token.operation=? AND token.status='active' AND cost.status IN ('active','executing'))`)
      .bind(...claimBindings,tokenReservationId,costReservationId,billingOwnerId,user.streamId,previousRow.correlation_id,operation);
    const tokenReservationHandoff=env.DB.prepare(TOKEN_RESERVATION_HANDOFF_SQL).bind(attemptCorrelationId,nowIso,tokenReservationId,billingOwnerId,user.streamId,previousRow.correlation_id,operation,costReservationId,jobId,user.userId,attemptCorrelationId,attempt);
    const costReservationHandoff=env.DB.prepare(COST_RESERVATION_HANDOFF_SQL).bind(attemptCorrelationId,nowIso,costReservationId,billingOwnerId,user.streamId,previousRow.correlation_id,operation,tokenReservationId,attemptCorrelationId,jobId,user.userId,attemptCorrelationId,attempt);
    const claims = outputBinding
      ? await env.DB.batch([claimAttempt,...outputAssertionStatements(env,{sql:"changes()=1"}),tokenReservationHandoff,...outputAssertionStatements(env,{sql:"changes()=1"}),costReservationHandoff,...outputAssertionStatements(env,{sql:"changes()=1"}),...outputAdmissionAssertions.flatMap(assertion=>outputAssertionStatements(env,assertion)),...(freshOutput?outputAssertionStatements(env,{sql:"NOT EXISTS(SELECT 1 FROM output_provider_calls WHERE scope_key=? AND slot_id=?)",bindings:[outputBinding.scope.key,outputBinding.slot.slotId]}):[])])
      : await env.DB.batch([claimAttempt, tokenReservationHandoff, costReservationHandoff]);
    claimed = claims[0];
    if(Number(claimed.meta.changes??0)!==1||!outputBinding&&claims.slice(1).some((claim)=>Number(claim.meta.changes??0)!==1)){
      const retained=await readJob(env,user.userId,jobId);
      if(retained&&retained.correlation_id===previousRow.correlation_id&&rowIsStale(retained))await failStaleJob(env,user,retained);
      return readJob(env,user.userId,jobId);
    }
  } else {
    claimed=await env.DB.prepare(claimSql+(settledModel3dRecovery?` AND ${settledModel3dGuard!.sql}`:"")).bind(...claimBindings,...(settledModel3dRecovery?settledModel3dGuard!.bindings??[]:[])).run();
  }
  if (Number(claimed.meta.changes ?? 0) !== 1) return readJob(env, user.userId, jobId);
  if (previousAttempt > 0 && !handoffPaidProviderReservations&&!settledModel3dRecovery) await releaseInterruptedAttempt(env, user, previousRow, "execution_interrupted_retrying");
  if(foregroundPresentation||outputBinding)row={...row,status:"running",attempt_count:attempt,correlation_id:attemptCorrelationId,started_at:row.started_at??nowIso,lease_expires_at:leaseExpiresAt,result_json:JSON.stringify(initialResult),updated_at:nowIso};
  else{row=await readJob(env,user.userId,jobId);if(!row)return null;}
  if(previousAttempt>0&&!handoffPaidProviderReservations&&!hasPaidProviderCheckpoint){
    const checkpoint=parseResult(row);
    for(const key of ["reservationId","costReservationId","costReservationMicrousd","costReservationPeriod"] as const)delete checkpoint[key];
    const updatedAt=new Date().toISOString();
    const cleared=await env.DB.prepare("UPDATE document_jobs SET result_json=?,updated_at=? WHERE job_id=? AND owner_id=? AND stream_id=? AND correlation_id=? AND status='running'")
      .bind(JSON.stringify(checkpoint),updatedAt,row.job_id,user.userId,user.streamId,row.correlation_id).run();
    if(Number(cleared.meta.changes??0)!==1)return readJob(env,user.userId,jobId);
    row.result_json=JSON.stringify(checkpoint);row.updated_at=updatedAt;
  }

  // Capture scalar attempt identity before execution can yield or update the local row.
  // A stale worker may retain monetary evidence, but cannot settle a successor's allowance.
  const outputSettlementAttempt:OutputSqlAssertion={
    sql:"EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND owner_id=? AND stream_id=? AND correlation_id=? AND attempt_count=?)",
    bindings:[row.job_id,row.owner_id,row.stream_id,row.correlation_id,row.attempt_count],
  };
  let persistedForegroundPresentation:DocumentJobRow|null=null;let outputOutcomeSynchronized=false;
  let operationEnvironment=env;let outputOperationExecution:OutputEventExecution|undefined;
  try {
    if(consentedAdaptiveJob(row)){
      const response=await runWithHeartbeat(env,row,user,(control)=>executeApprovedAdaptivePlanning(env,user,row!,control)),body=await response.json() as Record<string,unknown>;
      const latest=await readJob(env,user.userId,row.job_id)??row,recovered=await certifiedAdaptiveJob(env,user,latest,true);
      if(recovered.status==="completed")return recovered;
      const code=String(body.error??"adaptive_result_unavailable"),detail={...applicationFailureDetail(code,null,response.status),retryable:false};
      await releaseInterruptedAttempt(env,user,latest,code);
      await finishDocumentJob(env,latest,"failed",{...parseResult(latest),...safeResult(body),errorDetail:detail,noAutomaticRetry:true,stage:"failed",progressMessage:"This planning result could not be confirmed. Retrieve the same request; no replacement will be purchased automatically."},code);
      return readJob(env,user.userId,row.job_id);
    }
    const payload = JSON.parse(row.request_json) as Record<string, unknown>;
    const sceneConfiguration=row.kind==="render_document"?sceneConfigurationFromRequest(payload):null;
    if(sceneConfiguration){payload.sceneMedium=sceneConfiguration.medium;payload.sceneConfiguration=sceneConfiguration;}
    if(requiresForegroundDocumentExecution(row))clearPresentationServerOwnedCheckpointFields(payload);
    const inputRef = String(payload.jobInputRef ?? "");
    if (inputRef) {
      const privateContent = await loadPrivateContent(env, user.userId, row.kind === "chat" ? "chat" : "all", user.projectExecution); const input = privateContent[inputRef];
      if (typeof input !== "string") throw new Error("job_input_expired");
      if (row.kind === "chat") payload.message = input;
      if (row.kind === "structure_adaptive") payload.prompt = input;
    }
    delete payload.expectedSequence; delete payload.jobInputRef;
    if(requiresForegroundDocumentExecution(row)){
      const checkpoint=parseResult(row);for(const key of ["providerSubmissionProtocol","providerSubmissionLegacyUncertain","providerSubmissions","artifactId","providerJobId","providerRequestId","provider","providerModel","providerStatusUrl","providerResponseUrl","providerCancelUrl","storyboardProviderRequestedAt","storyboardProviderAcceptedAt","storyboardSafeRecovery","storyboardRejectedProviderReceipt","artifactPlan","plannerModel","plannerResponseId","plannerResponseIds","plannerLatencyMs","plannerUsage","plannerInput","renderedItems","videoInputReceipt","audioInputReceipt","audioEstimatedCostMicrousd","model3dInputReceipt","model3dProviderFiles","model3dProviderSubmission","model3dSettings","model3dEstimatedCostMicrousd","productionPlan","productionSceneReceipts","productionFrameReceipts","productionPrepaidSceneIds","productionPrepaidAnchor","prepaidProviderCostMicrousd","productionAnchor","costReservationMicrousd","costReservationId","costReservationPeriod","presentationProviderSubmission","presentationProviderClientRequestId","presentationCandidates","storyboardProviderSubmission"] as const)if(checkpoint[key]!==undefined)payload[key]=checkpoint[key];if((checkpoint.providerJobId||checkpoint.productionSceneReceipts||checkpoint.productionFrameReceipts||checkpoint.productionAnchor||hasSavedPaidPresentation||trustedStoryboardSafeRecovery(checkpoint))&&checkpoint.reservationId)payload.reservationId=checkpoint.reservationId;
    }
    if(row.kind==="render_document"&&payload.artifactKind==="slides"){
      const receipt=parseResult(row).generationReceipt as Record<string,unknown>|undefined;
      const settings=receipt?.settings as Record<string,unknown>|undefined;
      if(settings?.presentation_model_routes)payload.presentationModelRoutes=readFrozenPresentationModelRoutes(settings.presentation_model_routes);
    }
    payload.action = row.kind; payload.documentId = row.document_id; payload.sourceSurface = row.source_surface;
    payload.correlationId = row.correlation_id; payload.clientId = `server:document-job:${row.kind}`;
    const outputExecution=outputBinding?await createOutputEventExecution(env,user,row,outputBinding,outputProof):undefined;
    outputOperationExecution=outputExecution;operationEnvironment=outputExecution?.guardedEnvironment??env;
    if(!foregroundPresentation)await updateJobProgress(operationEnvironment,row,"compiling",row.kind==="preview"||row.kind==="generate"?"Compiling the checked document state for generation.":row.kind==="render_document"?"Compiling the document into the requested artifact.":"Processing the requested document change.");
    const response = await runWithHeartbeat(operationEnvironment, row,user, (control) => handleEvents(new Request("http://document-job.local/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal: control.signal }), env, false, user, outputExecution?{...control,output:outputExecution}:control),nativeExecutionPolicy);
    const body = await response.json() as Record<string, unknown>;let followup:DocumentJobRow|null=null;if(response.ok&&body.followupJob&&typeof body.followupJob==="object")followup=await queueFollowupPreview(env,user,row,body.followupJob as Record<string,unknown>);const completedAt = new Date().toISOString();
    const suppliedFailure=!response.ok?(body.errorDetail&&typeof body.errorDetail==="object"?body.errorDetail as ProviderFailureDetail:applicationFailureDetail(String(body.error??"document_job_failed"),body.scope,response.status)):null;
    const detail=!response.ok?classifyDocumentJobFailure(String(body.error??suppliedFailure?.message??"document_job_failed"),suppliedFailure,response.status):null;
    const latestCheckpoint=parseResult(outputBinding||response.ok&&foregroundPresentation?row:await readJob(env,user.userId,row.job_id)??row);
    const durableCheckpoint = {...(response.ok?{}:parseResult(row)),...(response.ok?{}:latestCheckpoint)};
    const liveCheckpoint=latestCheckpoint;
    const rawReceipt=liveCheckpoint.generationReceipt;
    const livePlannerInput=liveCheckpoint.plannerInput&&typeof liveCheckpoint.plannerInput==="object"?liveCheckpoint.plannerInput as Record<string,unknown>:{};
    const livePlannerValidation=livePlannerInput.validation&&typeof livePlannerInput.validation==="object"?livePlannerInput.validation as Record<string,unknown>:{};
    const observedPlannerCalls=Math.max(Array.isArray(liveCheckpoint.plannerResponseIds)?new Set(liveCheckpoint.plannerResponseIds.map(String).filter(Boolean)).size:0,Math.max(0,Number(livePlannerInput.provider_request_count??livePlannerValidation.provider_call_count??0)));
    const acceptedReceipt=rawReceipt&&typeof rawReceipt==="object"?{...rawReceipt as Record<string,unknown>,...(observedPlannerCalls?{actual_provider_call_count:observedPlannerCalls}:{})}:null;
    let terminalResult = { ...durableCheckpoint, ...(acceptedReceipt?{generationReceipt:acceptedReceipt}:{}), ...safeResult({...body,followupJobId:followup?.job_id}), ...(sceneConfiguration?{sceneMedium:sceneConfiguration.medium,sceneConfiguration}:{}), ...(detail ? { errorDetail: publicFailureDetail(detail) } : {}), stage: response.ok ? "completed" : "failed", progressMessage: response.ok ? "The operation finished." : failureProgressMessage(detail) };
    const recordedNativeFailure=outputBinding&&Array.isArray(body.appended)&&body.appended.some(event=>event&&typeof event==="object"&&["GenerationFailed","DocumentRenderFailed"].includes(String((event as Record<string,unknown>).type)));
    if(outputBinding&&!response.ok&&!recordedNativeFailure)await settleDocumentGenerationBudgets(env,user.billingUserId??user.userId,{reservationId:outputBinding.slot.tokenReservationId,costReservationId:outputBinding.slot.costReservationId,reason:"output_rejected_before_generation",assertions:[outputSettlementAttempt]});
    // Build the final receipt while the lease and source-retention proof are still
    // live, then publish it with the terminal state in the same guarded write.
    const nativeReceiptReady=outputBinding?await refreshGenerationReceipt(operationEnvironment,user,row,body,detail,"",{
      ...row,status:response.ok?"completed":"failed",result_json:JSON.stringify(terminalResult),error_message:response.ok?null:detail?.message??String(body.error??"document_job_failed"),completed_at:completedAt,lease_expires_at:null,updated_at:completedAt,
    },false,outputOperationExecution?.accountSettlement):null;
    if(nativeReceiptReady)terminalResult=parseResult(nativeReceiptReady) as typeof terminalResult;
    const terminalWrite=await finishDocumentJob(operationEnvironment,row,response.ok?"completed":"failed",terminalResult,response.ok?null:detail?.message??String(body.error??"document_job_failed"),completedAt);
    if(nativeReceiptReady&&Number(terminalWrite.meta.changes??0)===1){persistedForegroundPresentation=nativeReceiptReady;outputOutcomeSynchronized=true;}
    if(!outputBinding&&!response.ok&&row.kind==="render_document"){
      const failed=await readJob(env,user.userId,row.job_id);
      if(failed?.status==="failed"){
        if(detail?.code==="local_persistence_failed")await releaseInterruptedAttempt(env,user,failed,"document_render_local_persistence_failure");
        else if(!hasUnsettledProviderSubmission(parseResult(failed))&&!unresolvedPresentationSubmission(failed,detail)&&!unresolvedAudioSubmission(failed)&&!unresolvedModel3dSubmission(failed)&&!unresolvedStoryboardSubmission(failed))await settleInterruptedDocumentJobReservations(env,user,failed,{reason:"document_render_terminal_failure"});
      }
    }else if(!outputBinding&&!response.ok&&user.projectExecution&&row.kind!=="extract_reference"){
      const failed=await readJob(env,user.userId,row.job_id);
      if(failed?.status==="failed")await releaseInterruptedAttempt(env,user,failed,"project_document_job_terminal_failure");
    }
    if(!outputBinding&&response.ok&&foregroundPresentation&&Number(terminalWrite.meta.changes??0)===1){
      const saved:DocumentJobRow={...row,status:"completed",result_json:JSON.stringify(terminalResult),error_message:null,completed_at:completedAt,lease_expires_at:null,notified_at:parentJobIdFromRequest(parseRequest(row))?completedAt:row.notified_at,updated_at:completedAt};
      persistedForegroundPresentation=await refreshGenerationReceipt(operationEnvironment,user,row,body,detail,"",saved);
    }else if(!outputBinding)await refreshGenerationReceipt(operationEnvironment,user,row,body,detail);
  } catch (error) {
    if(consentedAdaptiveJob(row)){
      const latest=await readJob(env,user.userId,row.job_id)??row,recovered=await certifiedAdaptiveJob(env,user,latest,true);if(recovered.status==="completed")return recovered;
      await releaseInterruptedAttempt(env,user,latest,"adaptive_execution_interrupted");
      await finishDocumentJob(env,latest,"failed",{...parseResult(latest),noAutomaticRetry:true,errorDetail:{...applicationFailureDetail("adaptive_execution_interrupted",null,502),retryable:false},stage:"failed",progressMessage:"The original planning request is retained for recovery. It will not be submitted again."},"adaptive_execution_interrupted");
      return readJob(env,user.userId,row.job_id);
    }
    const completedAt = new Date().toISOString(),localDispatchStop=outputOperationExecution?.dispatchStop(error)??null;
    const detail = localDispatchStop??classifyDocumentJobFailure(error);
    if(outputBinding){
      // Monetary evidence may converge independently of erased source bodies.
      // A failed/uncertain settlement leaves its original allowance for the
      // explicit receipt check; it never starts another provider request.
      if(!outputOperationExecution?.accountSettlement)try{await settleDocumentGenerationBudgets(env,user.billingUserId??user.userId,{reservationId:outputBinding.slot.tokenReservationId,costReservationId:outputBinding.slot.costReservationId,reason:"output_execution_stopped",assertions:[outputSettlementAttempt]});}catch{/* The durable call and account reservation remain the source of truth. */}
      const safeFailure={errorDetail:localDispatchStop??{code:detail.code,category:detail.category,scope:"request",action:"none",message:"The Output operation could not finish under its current authorization.",retryable:false},stage:"failed",progressMessage:"The Output operation stopped; inspect its retained receipt before authorizing another attempt."};
      const terminal=env.DB.prepare("UPDATE document_jobs SET status='failed',result_json=json_patch(COALESCE(result_json,'{}'),?),error_message=?,completed_at=?,lease_expires_at=NULL,updated_at=? WHERE job_id=? AND owner_id=? AND stream_id=? AND correlation_id=? AND status IN('queued','running','committing')")
        .bind(JSON.stringify(safeFailure),detail.code,completedAt,completedAt,row.job_id,user.userId,user.streamId,row.correlation_id);
      // Read the canonical result in this same source-free transaction. If the
      // previous completion committed but its acknowledgement was lost, its
      // completed state wins instead of being overwritten with a failure.
      const finalized=await env.DB.batch([terminal,...prepareOutputJobOutcomeStatements(env,row),env.DB.prepare("SELECT * FROM document_jobs WHERE job_id=? AND owner_id=? AND stream_id=? AND correlation_id=?").bind(row.job_id,user.userId,user.streamId,row.correlation_id)]);
      persistedForegroundPresentation=(finalized.at(-1)?.results[0] as unknown as DocumentJobRow|undefined)??null;
      outputOutcomeSynchronized=Boolean(persistedForegroundPresentation);
    }else{
      const durableCheckpoint = parseResult(await readJob(env, user.userId, row.job_id) ?? row);
      await finishDocumentJob(env, row, "failed", { ...durableCheckpoint, errorDetail: publicFailureDetail(detail), stage: "failed", progressMessage: failureProgressMessage(detail) }, detail.message, completedAt);
    }
    if(!outputBinding&&row.kind==="render_document"){
      const failed=await readJob(env,user.userId,row.job_id);
      if(failed?.status==="failed"){
        if(detail.code==="local_persistence_failed")await releaseInterruptedAttempt(env,user,failed,"document_render_local_persistence_failure");
        else if(!hasUnsettledProviderSubmission(parseResult(failed))&&!unresolvedPresentationSubmission(failed,detail)&&!unresolvedAudioSubmission(failed)&&!unresolvedModel3dSubmission(failed)&&!unresolvedStoryboardSubmission(failed))await settleInterruptedDocumentJobReservations(env,user,failed,{reason:"document_render_execution_interrupted"});
      }
    }else if(!outputBinding&&user.projectExecution&&row.kind!=="extract_reference"){
      const failed=await readJob(env,user.userId,row.job_id);
      if(failed?.status==="failed")await releaseInterruptedAttempt(env,user,failed,"project_document_job_execution_interrupted");
    }
    if(!outputBinding)await refreshGenerationReceipt(env,user,row,{},detail);
  }
  const finishedRow=persistedForegroundPresentation??await readJob(env,user.userId,jobId);
  if(finishedRow){
    if(outputBinding&&!outputOutcomeSynchronized)await synchronizeOutputJobOutcome(env,finishedRow);
    await reconcileParentForChild(env,finishedRow);
    // Native sidecars index every committed job publication. A stale project
    // cursor stays stale until an authorized refresh; a failed native job must
    // never reactivate a quarantined migration through the legacy rebuild.
    if(user.projectExecution&&!outputBinding)await synchronizeProjectScope(env,user.projectExecution);
  }
  return finishedRow;
}

async function documentJobPrincipal(env:WorkerEnv,row:DocumentJobRow,current?:PilotUser):Promise<PilotUser|null>{
  const project=await env.DB.prepare("SELECT organization_id,project_access_id,project_id,owner_user_id,actor_user_id,EXISTS(SELECT 1 FROM events anchor WHERE anchor.event_id=resource.source_event_id AND anchor.stream_id='creative:'||resource.owner_user_id AND anchor.actor='user:'||resource.actor_user_id AND anchor.type='ProjectDocumentJobQueued' AND json_extract(anchor.payload,'$.job_id')=resource.resource_id AND json_extract(anchor.payload,'$.organization_id')=resource.organization_id AND json_extract(anchor.payload,'$.project_access_id')=resource.project_access_id) AS anchor_valid FROM project_resource_scopes resource WHERE resource_kind='job' AND resource_id=? AND actor_user_id=? AND owner_user_id=?")
    .bind(row.job_id,row.owner_id,row.stream_id.slice("creative:".length)).first<{organization_id:string;project_access_id:string;project_id:string;owner_user_id:string;actor_user_id:string;anchor_valid:number}>();
  if(project&&!project.anchor_valid)return null;
  if(project&&current&&current.userId===row.owner_id&&current.projectExecution?.projectAccessId===project.project_access_id&&current.projectExecution.organizationId===project.organization_id)return current;
  if(!project&&current&&current.userId===row.owner_id&&!current.projectExecution&&current.streamId===row.stream_id)return current;
  if(!project&&row.owner_id!==row.stream_id.slice("creative:".length))return null;
  const principal=await env.DB.prepare(PRINCIPAL_WITH_ACCESS_SQL).bind(row.owner_id).first<Record<string,unknown>>();
  if(!principal||principal.consent_version!==POLICY_VERSION)return null;
  const role=String(principal.role??"");if(!["admin","creator","agent","viewer"].includes(role))return null;
  if(!project&&role!=="admin"&&role!=="creator")return null;
  const actor:PilotUser={userId:String(principal.user_id),email:String(principal.email??""),displayName:String(principal.display_name??""),role:role as PilotUser["role"],consentVersion:String(principal.consent_version),consentedAt:principal.consented_at?String(principal.consented_at):null,streamId:row.stream_id,access:await principalAccessFromRow(principal,role),billingUserId:row.owner_id,authorizationSnapshot:{updatedAt:String(principal.updated_at??""),rawEpoch:String(principal.permission_epoch??""),grants:String(principal.grants_json??"[]"),organizations:String(principal.organizations_json??"[]"),projects:String(principal.projects_json??"[]"),identityPolicies:String(principal.identity_policies_json??"[]"),canvasRequirements:Number(principal.approved_canvas_requirements??0)},...(project?{projectExecution:{organizationId:project.organization_id,projectAccessId:project.project_access_id,projectId:project.project_id,ownerUserId:project.owner_user_id,actorUserId:project.actor_user_id}}:{})};
  if(project&&(!hasCapability(actor,"project.output.request",{organizationId:project.organization_id,projectAccessId:project.project_access_id})||!await activeProjectExecution(env,actor,row.document_id,row.job_id)))return null;
  return actor;
}

/** Bound both private columns before returning an Image checkpoint to worker code. */
async function readImageAcknowledgmentJob(env:WorkerEnv,ownerId:string,jobId:string){
  return env.DB.prepare(`SELECT *, (SELECT slot.slot_id FROM output_operation_slots slot WHERE slot.job_id=document_jobs.job_id) AS output_slot_id
    FROM document_jobs WHERE job_id=? AND owner_id=? AND kind='generate'
      AND length(CAST(request_json AS BLOB))<=2000000 AND length(CAST(result_json AS BLOB))<=2000000`)
    .bind(jobId,ownerId).first<DocumentJobRow>();
}

/** Bounded metadata routing only; neither result grants execution authority. */
async function readImagePublicationState(env:WorkerEnv,row:DocumentJobRow):Promise<'published'|'unpublished'|'held'>{
  if(!Number.isSafeInteger(row.attempt_count)||row.attempt_count<1||row.attempt_count>2)return 'held';
  const correlations=Array.from({length:row.attempt_count},(_,index)=>`${row.job_id}:attempt:${index+1}`);
  const published=(await env.DB.prepare("SELECT type FROM events WHERE stream_id=? AND correlation_id IN(SELECT value FROM json_each(?)) AND type IN('GenerationCompleted','GenerationUsageRecorded') ORDER BY sequence LIMIT 3")
    .bind(row.stream_id,JSON.stringify(correlations)).all<{type:string}>()).results;
  if(!published.length)return 'unpublished';
  return published.length===2&&published.filter(event=>event.type==='GenerationCompleted').length===1&&published.filter(event=>event.type==='GenerationUsageRecorded').length===1?'published':'held';
}

/** Provider-free acknowledgment shared by the HTTP route and the terminal sweep.
 * expectedContextId is the caller's selected context, or the original grant's
 * retained context for a server tick; the existing proof rechecks it live. */
async function acknowledgeRetainedImageJob(env:WorkerEnv,user:PilotUser,target:DocumentJobRow,expectedContextId:string|null):Promise<{job:DocumentJobRow;acknowledged:true}|{error:string;status:number}>{
  // A single read-only recheck may observe a concurrent successful acknowledgment.
  // It never retries an execution, changes the attempt, or admits provider work.
  for(let observed=target,pass=0;pass<2;pass++){
    try{
      if(!Number.isSafeInteger(observed.attempt_count)||observed.attempt_count<1||observed.attempt_count>2
        ||!imageRecoveryHasNoExplicitStop(observed,parseResult(observed)))throw new OutputConflictError("output_image_acknowledgment_unavailable",409);
      const binding=await loadOutputJobBinding(env,user,observed);
      if(!binding||binding.scope.contextId!==expectedContextId)throw new OutputConflictError("output_execution_context_changed",403);
      const assertions=await resolveOutputImageAcknowledgmentAuthority(env,binding.scope,binding.slot,user.billingUserId??user.userId);
      const projectAuthority=documentJobProjectAuthority(user,observed.document_id,observed.job_id);
      const readProof=(proofs:readonly OutputSqlAssertion[],statements:readonly D1PreparedStatement[]=[])=>readOutputProofBatch(env,proofs,statements);
      const proof=await readPublishedImageAcknowledgment({env,user,job:observed,scope:binding.scope,slot:binding.slot,assertions:[...assertions,...(projectAuthority?[projectAuthority]:[]),imageRecoveryCancellationAssertion(observed)],readProof});
      const guards=proof.assertions.flatMap(assertion=>outputAssertionStatements(env,assertion));
      const read=env.DB.prepare("SELECT * FROM document_jobs WHERE job_id=? AND owner_id=? AND stream_id=? AND correlation_id=? AND length(CAST(request_json AS BLOB))<=2000000 AND length(CAST(result_json AS BLOB))<=2000000").bind(observed.job_id,observed.owner_id,observed.stream_id,observed.correlation_id);
      const writes=observed.status==="completed"?[]:[env.DB.prepare("UPDATE document_jobs SET status='completed',result_json=?,error_message=NULL,completed_at=?,lease_expires_at=NULL,updated_at=? WHERE job_id=? AND owner_id=? AND stream_id=? AND correlation_id=? AND status=? AND attempt_count=? AND result_json IS ?")
        .bind(JSON.stringify(proof.result),proof.completedAt,new Date().toISOString(),observed.job_id,observed.owner_id,observed.stream_id,observed.correlation_id,observed.status,observed.attempt_count,observed.result_json),...outputAssertionStatements(env,{sql:"changes()=1"})];
      const statements=[...guards,...writes,read],result=await env.DB.batch(statements);
      if(result.length!==statements.length||statements.some((_,index)=>result[index]?.success!==true))throw new OutputConflictError("output_image_acknowledgment_commit_unconfirmed",409);
      const acknowledged=result.at(-1)?.results[0] as DocumentJobRow|undefined;
      if(!acknowledged||acknowledged.status!=="completed")throw new OutputConflictError("output_image_acknowledgment_changed",409);
      // Only the job projection changes. Events, grant, slot, storage and settlement remain untouched.
      return {job:acknowledged,acknowledged:true};
    }catch(error){
      const readConvergence=error instanceof OutputConflictError&&error.code==="output_source_changed_during_read"&&observed.status!=="completed";
      if((String(error).includes("constraint failed")||readConvergence)&&pass===0){
        const winner=await readImageAcknowledgmentJob(env,user.userId,target.job_id);
        // A winner may differ only in the six acknowledgment projection fields.
        // Re-enter every live proof; the completed row alone is never success.
        const identityKeys=["output_slot_id","job_id","owner_id","stream_id","document_id","kind","source_surface","correlation_id","requested_sequence","request_json","attempt_count","requested_at","started_at","notified_at","expires_at"] as const;
        if(winner?.status==="completed"&&identityKeys.every(key=>winner[key]===target[key])){observed=winner;continue;}
      }
      if(error instanceof OutputConflictError)return {error:error.code,status:error.status};
      if(String(error).includes("constraint failed"))return {error:"output_execution_authority_revoked",status:403};
      throw error;
    }
  }
  return {error:"output_image_acknowledgment_changed",status:409};
}

/** Conservative read-only triage, not execution authority. The existing runner
 * repeats retained-body, anchor, route, reservation and claim checks at use. */
async function serverImageRecoveryReady(env:WorkerEnv,user:PilotUser,row:DocumentJobRow):Promise<boolean>{
  const binding=await loadOutputJobBinding(env,user,row);
  if(!binding||!['queued','running'].includes(binding.slot.status))return false;
  const {scope,slot}=binding;
  const calls=(await env.DB.prepare("SELECT call_key,stage_key,client_request_id,request_digest,provider,model,status,used_microusd,provider_response_id FROM output_provider_calls WHERE scope_key=? AND slot_id=? ORDER BY call_key LIMIT 3")
    .bind(scope.key,slot.slotId).all<ImageRecoveryProviderCall>()).results;
  const recovery=classifyImageRecoveryCandidate(row,calls);
  if(recovery==='observe'||recovery==='unresolved')return false;
  const excluded=['GenerationCompleted','GenerationFailed',...(recovery==='undispatched'?['GenerationRequested','ContextCompiled','BudgetReserved']:[])];
  if(await env.DB.prepare("SELECT 1 FROM events WHERE stream_id=? AND correlation_id=? AND type IN(SELECT value FROM json_each(?)) LIMIT 1")
    .bind(row.stream_id,row.correlation_id,JSON.stringify(excluded)).first())return false;
  const checkpoint=parseResult(row);
  if(checkpoint.reservationId!==slot.tokenReservationId||checkpoint.costReservationId!==slot.costReservationId||checkpoint.costReservationMicrousd!==slot.maximumMicrousd||checkpoint.costReservationPeriod!==new Date().toISOString().slice(0,7))return false;
  // A missing original reservation is a hold, never permission to reserve again.
  if(!await env.DB.prepare("SELECT 1 FROM budget_reservations token JOIN cost_budget_reservations cost ON cost.owner_id=token.owner_id AND cost.stream_id=token.stream_id AND cost.correlation_id=token.correlation_id AND cost.operation=token.operation AND cost.period=token.period WHERE token.reservation_id=? AND cost.reservation_id=? AND token.owner_id=? AND token.stream_id=? AND token.correlation_id=? AND token.operation='image-generation' AND token.status='active' AND cost.status IN('active','executing') AND cost.period=? LIMIT 1")
    .bind(slot.tokenReservationId,slot.costReservationId,user.billingUserId??user.userId,row.stream_id,row.correlation_id,checkpoint.costReservationPeriod).first())return false;
  if(recovery!=='undispatched'){
    const pointer=readImageRecoveryPointer(checkpoint.imageRecovery);
    if(!pointer)return false;
    const containment=privateContentScopeGuard(user.userId,user.projectExecution);
    // Bound the actual private read as well as the candidate count. Larger or
    // missing evidence stays held for explicit recovery; no clipping or repair.
    const stored=await env.DB.prepare(`SELECT content FROM private_content WHERE content_id=? AND owner_id=? AND kind='provider-output' AND redacted_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND length(CAST(content AS BLOB))<=? AND ${containment.sql}`)
      .bind(pointer.contentId,user.userId,MAX_PAYLOAD_BYTES,...containment.bindings).first<{content:string}>();
    if(!stored||typeof stored.content!=='string')return false;
    const envelope:unknown=JSON.parse(stored.content);
    if(!envelope||typeof envelope!=='object'||Array.isArray(envelope)||JSON.stringify(envelope)!==stored.content||await imageRecoveryDigest(envelope)!==pointer.contentSha256)return false;
    const saved=envelope as Record<string,unknown>;
    const identity={jobId:row.job_id,actorUserId:user.userId,scopeKey:scope.key,slotId:slot.slotId,grantId:slot.grantId,sourceDigest:slot.sourceDigest,routeDigest:slot.routeDigest,inputDigest:pointer.inputDigest};
    if(saved.version!==1||JSON.stringify(saved.identity)!==JSON.stringify(identity))return false;
    const stage=readImageRecoveryStage(saved.stage);
    if(!stage||pointer.stage!==(stage.rendered?'rendered':'planned')||classifyImageRecoveryStage(stage,checkpoint,calls)==='blocked')return false;
    const correlations=Array.from({length:Math.min(row.attempt_count,2)},(_,index)=>`${row.job_id}:attempt:${index+1}`);
    const anchors=[
      {id:stage.requestedEventId,type:'GenerationRequested',projectId:null,documentId:row.document_id},
      {id:stage.compiledEventId,type:'ContextCompiled',projectId:scope.projectId,documentId:row.document_id},
      {id:stage.budgetEventId,type:'BudgetReserved',projectId:null,documentId:null},
    ];
    for(const anchor of anchors){
      const retained=await env.DB.prepare("SELECT event.*,body.private_json FROM events event JOIN event_private_payloads body ON body.private_event_id=event.event_id WHERE event.event_id=? AND event.stream_id=? AND event.type=? AND event.correlation_id IN(SELECT value FROM json_each(?)) AND body.owner_id=? AND body.project_id IS ? AND body.document_id IS ? AND body.redacted_at IS NULL AND length(CAST(body.private_json AS BLOB))<=? AND length(CAST(event.payload AS BLOB))<=? LIMIT 1")
        .bind(anchor.id,row.stream_id,anchor.type,JSON.stringify(correlations),scope.ownerUserId,anchor.projectId,anchor.documentId,MAX_PAYLOAD_BYTES,MAX_PAYLOAD_BYTES).first<Record<string,unknown>>();
      if(!retained||typeof retained.private_json!=='string')return false;
      const event=serializeEvent(retained);
      if(!event.payload||typeof event.payload!=='object'||Array.isArray(event.payload)||!correlations.includes(event.correlationId))return false;
    }
    if(stage.rendered){
      const storageKey=decodeURIComponent(stage.rendered.media.url.slice('/api/media/'.length));
      if(!await env.DB.prepare("SELECT 1 FROM output_native_storage_writes WHERE scope_key=? AND slot_id=? AND storage_key=? AND content_sha256=? AND status='written' LIMIT 1")
        .bind(scope.key,slot.slotId,storageKey,stage.rendered.media.contentHash).first())return false;
    }
  }
  const proof=prepareOutputExecutionProof(scope,await resolveOutputExecutionAuthority(env,scope,slot));
  const settings=proof.targetPreflight.settings as Record<string,unknown>;
  if(settings.kind!=='generate'||!readOutputNativeExecutionPolicy(settings.executionPolicy))return false;
  const project=documentJobProjectAuthority(user,row.document_id,row.job_id);
  const assertions=[...proof.assertions,outputScopeAuthority(scope,'request'),...(project?[project]:[])];
  if(assertions.some(assertion=>assertion.deadlineMs!==undefined&&(!Number.isFinite(assertion.deadlineMs)||assertion.deadlineMs<=Date.now())))return false;
  await readOutputProofBatch(env,assertions);
  return true;
}

/** One bounded server tick over already-started Image grants. No request,
 * browser identity, new grant or replacement job is created. Only the shared
 * runner may claim its normal lease; this sweep never renews one independently. */
export async function recoverServerImageJobs(env:WorkerEnv,options:{candidateLimit?:number;executionLimit?:number}={}):Promise<{inspected:number;attempted:number}>{
  const limit=(value:number|undefined,fallback:number,maximum:number)=>Number.isSafeInteger(value)&&Number(value)>=0?Math.min(Number(value),maximum):fallback;
  const candidateLimit=limit(options.candidateLimit,25,100),executionLimit=limit(options.executionLimit,1,5);
  const counts={inspected:0,attempted:0};
  if(!candidateLimit||!executionLimit)return counts;
  await ensureSchema(env);await ensureOutputRequirementsSchema(env);
  // One durable Image-only traversal row prevents held oldest jobs from owning
  // every tick. It is not a job lease: concurrent execution still uses run's CAS.
  await env.DB.prepare("INSERT OR IGNORE INTO document_job_recovery_scan(cursor_key,last_requested_at,last_job_id,version) VALUES('image-output-v1','','',0)").run();
  type ScanCursor={last_requested_at:string;last_job_id:string;version:number};
  let cursor=await env.DB.prepare("SELECT last_requested_at,last_job_id,version FROM document_job_recovery_scan WHERE cursor_key='image-output-v1'").first<ScanCursor>();
  if(!cursor||typeof cursor.last_requested_at!=='string'||typeof cursor.last_job_id!=='string'||!Number.isSafeInteger(cursor.version)||cursor.version<0||cursor.version>=Number.MAX_SAFE_INTEGER)return counts;
  const advance=async(requestedAt:string,jobId:string):Promise<boolean>=>{
    if(!cursor||cursor.version>=Number.MAX_SAFE_INTEGER)return false;
    const changed=await env.DB.prepare("UPDATE document_job_recovery_scan SET last_requested_at=?,last_job_id=?,version=version+1 WHERE cursor_key='image-output-v1' AND last_requested_at=? AND last_job_id=? AND version=?")
      .bind(requestedAt,jobId,cursor.last_requested_at,cursor.last_job_id,cursor.version).run();
    if(Number(changed.meta.changes??0)!==1)return false;
    cursor={last_requested_at:requestedAt,last_job_id:jobId,version:cursor.version+1};
    return true;
  };
  const now=new Date().toISOString();
  const readCandidates=async()=>(await env.DB.prepare(`SELECT job.*,slot.slot_id AS output_slot_id FROM document_jobs job
    JOIN output_operation_slots slot ON slot.job_id=job.job_id AND slot.status IN('queued','running')
    JOIN output_plan_revisions plan ON plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id
      AND plan.document_id=job.document_id AND job.stream_id='creative:'||plan.owner_user_id
    JOIN output_execution_grants grant_row ON grant_row.scope_key=slot.scope_key AND grant_row.grant_id=slot.grant_id
      AND grant_row.actor_user_id=job.owner_id AND grant_row.status='active' AND julianday(grant_row.expires_at)>julianday(?)
    WHERE job.kind='generate' AND job.status IN('queued','running') AND job.attempt_count>=0 AND job.attempt_count<? AND julianday(job.expires_at)>julianday(?)
      AND (job.status='queued' OR job.status='running' AND julianday(job.lease_expires_at)<julianday(?))
      AND length(CAST(job.request_json AS BLOB))<=? AND (job.result_json IS NULL OR length(CAST(job.result_json AS BLOB))<=?)
      AND (job.requested_at,job.job_id)>(?,?)
    ORDER BY job.requested_at ASC,job.job_id ASC LIMIT ?`)
    .bind(now,documentJobMaxAttempts('generate'),now,now,MAX_PAYLOAD_BYTES,MAX_PAYLOAD_BYTES,cursor!.last_requested_at,cursor!.last_job_id,candidateLimit).all<DocumentJobRow>()).results;
  let candidates=await readCandidates();
  if(!candidates.length&&(cursor.last_requested_at!==''||cursor.last_job_id!=='')){
    if(!await advance('',''))return counts;
    candidates=await readCandidates(); // At most one wrap and two bounded reads.
  }
  for(const row of candidates){
    if(counts.attempted>=executionLimit)break;
    // Advance even for a held row, but only if this tick still owns its exact
    // traversal snapshot. A loser stops; no job, reservation or grant is touched.
    if(!await advance(row.requested_at,row.job_id))return counts;
    counts.inspected++;
    try{
      if(row.status==='running'&&(!Number.isFinite(Date.parse(String(row.lease_expires_at)))||Date.parse(String(row.lease_expires_at))>=Date.now()))continue;
      // Preserve account-stream serialization. A held earlier job in one stream
      // does not spend the allowance for another independently eligible stream.
      const blocker=await env.DB.prepare(`SELECT 1 FROM document_jobs candidate WHERE candidate.stream_id=? AND candidate.job_id<>? AND candidate.kind!='prompt_fan'
        AND (candidate.status IN('running','committing') OR candidate.status='queued' AND NOT(candidate.kind='render_document' AND COALESCE(json_extract(candidate.request_json,'$.artifactKind'),'')='slides')
          AND NOT EXISTS(SELECT 1 FROM output_operation_slots output_slot WHERE output_slot.job_id=candidate.job_id AND output_slot.status NOT IN('queued','running'))
          AND (candidate.requested_at<? OR candidate.requested_at=? AND candidate.job_id<?)) LIMIT 1`)
        .bind(row.stream_id,row.job_id,row.requested_at,row.requested_at,row.job_id).first();
      if(blocker)continue;
      const user=await documentJobPrincipal(env,row);
      if(!user||!await serverImageRecoveryReady(env,user,row))continue;
      counts.attempted++;
      // This is the only execution call. All current authority and exact-row,
      // call-set, lease and original-reservation CAS remain in the shared runner.
      await runDocumentJob(env,user,row.job_id,row);
    }catch{
      // Unavailable/changed evidence stays held. A lost claim still consumed its
      // attempted-execution allowance; this sweep never repairs or retries it.
    }
  }
  return counts;
}

/** Bounded, provider-free completion of original Image attempts. The terminal
 * cursor is independent of the paid runnable sweep and is not an execution lease.
 * Finalization is supplied by the separately reviewed retained-finalization join. */
export async function recoverServerImageTerminalJobs(env:WorkerEnv,options:{candidateLimit?:number;finalizationLimit?:number}={}):Promise<{inspected:number;attempted:number}>{
  const limit=(value:number|undefined,fallback:number,maximum:number)=>Number.isSafeInteger(value)&&Number(value)>=0?Math.min(Number(value),maximum):fallback;
  const candidateLimit=limit(options.candidateLimit,25,100),finalizationLimit=limit(options.finalizationLimit,1,5);
  const counts={inspected:0,attempted:0};
  if(!candidateLimit||!finalizationLimit)return counts;
  await ensureSchema(env);await ensureOutputRequirementsSchema(env);
  await env.DB.prepare("INSERT OR IGNORE INTO document_job_terminal_recovery_scan(cursor_key,last_requested_at,last_job_id,version) VALUES('image-terminal-v1','','',0)").run();
  type TerminalScanCursor={last_requested_at:string;last_job_id:string;version:number};
  let cursor=await env.DB.prepare("SELECT last_requested_at,last_job_id,version FROM document_job_terminal_recovery_scan WHERE cursor_key='image-terminal-v1'").first<TerminalScanCursor>();
  if(!cursor||typeof cursor.last_requested_at!=='string'||typeof cursor.last_job_id!=='string'||!Number.isSafeInteger(cursor.version)||cursor.version<0||cursor.version>=Number.MAX_SAFE_INTEGER)return counts;
  const advance=async(requestedAt:string,jobId:string):Promise<boolean>=>{
    if(!cursor||cursor.version>=Number.MAX_SAFE_INTEGER)return false;
    const changed=await env.DB.prepare("UPDATE document_job_terminal_recovery_scan SET last_requested_at=?,last_job_id=?,version=version+1 WHERE cursor_key='image-terminal-v1' AND last_requested_at=? AND last_job_id=? AND version=?")
      .bind(requestedAt,jobId,cursor.last_requested_at,cursor.last_job_id,cursor.version).run();
    if(Number(changed.meta.changes??0)!==1)return false;
    cursor={last_requested_at:requestedAt,last_job_id:jobId,version:cursor.version+1};
    return true;
  };
  const candidateKeys=['job_id','owner_id','stream_id','document_id','kind','status','correlation_id','attempt_count','requested_at','updated_at','output_slot_id'] as const;
  type TerminalCandidate=Pick<DocumentJobRow,typeof candidateKeys[number]>;
  // Only small identities cross this batch boundary. Private JSON is read for
  // one visited row at a time after traversal CAS, never retained for a page.
  const readCandidates=async()=>(await env.DB.prepare(`SELECT job.job_id,job.owner_id,job.stream_id,job.document_id,job.kind,job.status,
      job.correlation_id,job.attempt_count,job.requested_at,job.updated_at,slot.slot_id AS output_slot_id FROM document_jobs job
    JOIN output_operation_slots slot ON slot.job_id=job.job_id
    JOIN output_plan_revisions plan ON plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id
      AND plan.document_id=job.document_id AND job.stream_id='creative:'||plan.owner_user_id
    JOIN output_execution_grants grant_row ON grant_row.scope_key=slot.scope_key AND grant_row.grant_id=slot.grant_id
      AND grant_row.actor_user_id=job.owner_id
    WHERE job.kind='generate' AND job.status IN('committing','failed') AND job.source_surface='outputs'
      AND typeof(job.attempt_count)='integer' AND typeof(job.job_id)='text' AND typeof(job.requested_at)='text'
      AND length(CAST(job.job_id AS BLOB))<=512 AND length(CAST(job.owner_id AS BLOB))<=512
      AND length(CAST(job.stream_id AS BLOB))<=512 AND length(CAST(job.document_id AS BLOB))<=512
      AND length(CAST(job.correlation_id AS BLOB))<=512 AND length(CAST(slot.slot_id AS BLOB))<=512
      AND length(CAST(job.requested_at AS BLOB))<=64 AND length(CAST(job.updated_at AS BLOB))<=64
      AND (job.requested_at,job.job_id)>(?,?)
    ORDER BY job.requested_at ASC,job.job_id ASC LIMIT ?`)
    .bind(cursor!.last_requested_at,cursor!.last_job_id,candidateLimit).all<TerminalCandidate>()).results;
  let candidates=await readCandidates();
  if(!candidates.length&&(cursor.last_requested_at!==''||cursor.last_job_id!=='')){
    if(!await advance('',''))return counts;
    candidates=await readCandidates();
  }
  for(const candidate of candidates){
    if(counts.attempted>=finalizationLimit)break;
    if(!await advance(candidate.requested_at,candidate.job_id))return counts;
    counts.inspected++;
    try{
      const row=await readImageAcknowledgmentJob(env,candidate.owner_id,candidate.job_id);
      if(!row||candidateKeys.some(key=>row[key]!==candidate[key]))continue;
      if(!Number.isSafeInteger(row.attempt_count)||row.attempt_count<1||row.attempt_count>2)continue;
      if(row.status==='committing'&&(!row.lease_expires_at||!Number.isFinite(Date.parse(row.lease_expires_at))||Date.parse(row.lease_expires_at)>Date.now())
        ||row.status==='failed'&&row.lease_expires_at!==null&&(!Number.isFinite(Date.parse(row.lease_expires_at))||Date.parse(row.lease_expires_at)>Date.now()))continue;
      const request:unknown=JSON.parse(row.request_json),checkpoint:unknown=JSON.parse(row.result_json??'null');
      if(!request||typeof request!=='object'||Array.isArray(request)||!checkpoint||typeof checkpoint!=='object'||Array.isArray(checkpoint))continue;
      const pointer=readImageRecoveryPointer((checkpoint as Record<string,unknown>).imageRecovery);
      if(!pointer||pointer.stage!=='rendered'||!imageRecoveryHasNoExplicitStop(row,checkpoint as Record<string,unknown>))continue;
      const user=await documentJobPrincipal(env,row);
      if(!user)continue;
      const binding=await loadOutputJobBinding(env,user,row);
      if(!binding)continue;
      // Coarse routing only. A partial or duplicate publication is never repaired
      // by this selector. Both actions repeat their complete current proofs/CAS.
      const publication=await readImagePublicationState(env,row);
      if(publication==='held')continue;
      // Count attempted invocations even when authority changes or proof is held.
      // Cursor progress prevents one such row from owning every later tick.
      counts.attempted++;
      if(publication==='published')await acknowledgeRetainedImageJob(env,user,row,binding.scope.contextId);
      else await finalizeRetainedImageJob(env,user,row.job_id,binding.scope.contextId);
    }catch{
      // Keep genuine uncertainty held. Never fall back to paid run, renew a
      // grant, synthesize a completion, or retry this row in the same tick.
    }
  }
  return counts;
}

async function driveDocumentQueue(env: WorkerEnv, user: PilotUser) {
  for (let count = 0; count < 50; count += 1) {
    const running = await env.DB.prepare("SELECT * FROM document_jobs WHERE stream_id=? AND kind!='prompt_fan' AND status IN ('running','committing') ORDER BY requested_at ASC,job_id ASC LIMIT 1").bind(user.streamId).first<DocumentJobRow>();
    if (running) {
      if (!rowIsStale(running)) return;
      const owner=await documentJobPrincipal(env,running,user);
      if(!owner){
        const scope=await env.DB.prepare("SELECT organization_id,project_access_id FROM project_resource_scopes WHERE resource_kind='job' AND resource_id=? AND actor_user_id=?").bind(running.job_id,running.owner_id).first<{organization_id:string;project_access_id:string}>();
        if(scope){await cancelProjectActorJobs(env,user,{organizationId:scope.organization_id,projectAccessId:scope.project_access_id,actorUserId:running.owner_id});continue;}
        return;
      }
      if(requiresForegroundDocumentExecution(running)){if(await failStaleJob(env,owner,running,unsafePaidRecovery(running)??undefined)==="held")return;continue;}
      const recovered = await runDocumentJob(env, owner, running.job_id);
      if (!recovered || recovered.status === "queued" || recovered.status === "running" || recovered.status === "committing") return;
      continue;
    }
    const next = await env.DB.prepare("SELECT * FROM document_jobs WHERE stream_id=? AND kind!='prompt_fan' AND status='queued' AND NOT EXISTS(SELECT 1 FROM output_operation_slots output_slot WHERE output_slot.job_id=document_jobs.job_id AND output_slot.status NOT IN('queued','running')) AND NOT (kind='render_document' AND COALESCE(json_extract(request_json,'$.artifactKind'),'')='slides') ORDER BY requested_at ASC,job_id ASC LIMIT 1").bind(user.streamId).first<DocumentJobRow>();
    if (!next) return;
    if(requiresForegroundDocumentExecution(next))return;
    const owner=await documentJobPrincipal(env,next,user);
    if(!owner){
      const scope=await env.DB.prepare("SELECT organization_id,project_access_id,source_event_id FROM project_resource_scopes WHERE resource_kind='job' AND resource_id=? AND actor_user_id=?").bind(next.job_id,next.owner_id).first<{organization_id:string;project_access_id:string;source_event_id:string|null}>();
      if(scope&&!scope.source_event_id)return;
      if(scope){await cancelProjectActorJobs(env,user,{organizationId:scope.organization_id,projectAccessId:scope.project_access_id,actorUserId:next.owner_id});continue;}
      return;
    }
    const job = await runDocumentJob(env, owner, next.job_id);
    if (!job || job.status === "queued" || job.status === "running") return;
  }
}

/** One read of exact existing ledger rows; never reserves or infers a refund from job status. */
async function adaptiveStopBudget(env:WorkerEnv,user:PilotUser,row:DocumentJobRow):Promise<DocumentJobStopBudget>{
  const unknown:DocumentJobStopBudget={reservationStatus:"unknown",billingStatus:"unknown"};
  const saved=await env.DB.prepare(`SELECT step.status AS step_status,step.verified_tokens,step.verified_microusd,
      tokens.reservation_id AS token_id,tokens.status AS token_status,tokens.used_tokens,
      cost.reservation_id AS cost_id,cost.status AS cost_status,cost.used_microusd
    FROM consequential_executions execution JOIN consequential_execution_steps step ON step.execution_id=execution.execution_id AND step.step_index=0
    LEFT JOIN budget_reservations tokens ON tokens.reservation_id=step.token_reservation_id
    LEFT JOIN cost_budget_reservations cost ON cost.reservation_id=step.cost_reservation_id
    WHERE execution.execution_id=? AND execution.actor_user_id=? AND execution.stream_id=? AND execution.operation='adaptive-structure'
      AND step.token_reservation_id=? AND step.cost_reservation_id=?
      AND (SELECT COUNT(*) FROM consequential_execution_steps all_steps WHERE all_steps.execution_id=execution.execution_id)=1
      AND (tokens.reservation_id IS NULL OR tokens.owner_id=execution.actor_user_id AND tokens.stream_id=execution.stream_id AND tokens.correlation_id=execution.execution_id)
      AND (cost.reservation_id IS NULL OR cost.owner_id=execution.actor_user_id AND cost.stream_id=execution.stream_id AND cost.correlation_id=execution.execution_id)`)
    .bind(row.job_id,user.userId,row.stream_id,`${row.job_id}:tokens:0`,`${row.job_id}:usd:0`).first<{step_status:string;verified_tokens:number|null;verified_microusd:number|null;token_id:string|null;token_status:string|null;used_tokens:number|null;cost_id:string|null;cost_status:string|null;used_microusd:number|null}>();
  if(!saved)return unknown;
  const settled=saved.step_status==="settled"&&saved.token_status==="settled"&&saved.cost_status==="settled"
    &&Number.isSafeInteger(saved.verified_tokens)&&Number.isSafeInteger(saved.verified_microusd)
    &&saved.used_tokens===saved.verified_tokens&&saved.used_microusd===saved.verified_microusd;
  const notIncurred=saved.step_status==="not-submitted"&&Number(saved.used_tokens??0)===0&&Number(saved.used_microusd??0)===0;
  const statuses=[saved.token_status,saved.cost_status],held=statuses.some(status=>status==="active"||status==="executing");
  const billingStatus:DocumentJobStopBudget["billingStatus"]=settled?"settled":notIncurred?"not-incurred":["submitting","uncertain","usage-recorded"].includes(saved.step_status)?"pending":"unknown";
  const reservationStatus:DocumentJobStopBudget["reservationStatus"]=held?"retained":settled?"settled":notIncurred
    ?!saved.token_id&&!saved.cost_id?"not-reserved":statuses.every(status=>status===null||status==="released")?"released":"unknown":"unknown";
  return{reservationStatus,billingStatus};
}

async function stopAdaptivePlanningJob(env:WorkerEnv,user:PilotUser,target:DocumentJobRow,force:boolean){
  const recovered=await certifiedAdaptiveJob(env,user,target,true);
  if(recovered.status==="completed"||documentJobTerminal(target))return{job:recovered,stoppedCount:0,budget:await adaptiveStopBudget(env,user,recovered)};
  // Tombstone the execution first: no reservation can arrive after cancellation becomes visible.
  const code=force?"adaptive_force_failed":"adaptive_canceled";await failConsequentialExecution(env,user.userId,target.job_id,code);
  const budget=await adaptiveStopBudget(env,user,target),now=new Date().toISOString();
  const errorDetail={code,category:"canceled",scope:"request",action:"none",message:"Planning was stopped. "+documentJobStopBudgetMessage(budget),retryable:false,retryAfterMs:null,requestId:null,httpStatus:null};
  const changed=await env.DB.prepare(`UPDATE document_jobs SET status=?,result_json=json_patch(COALESCE(result_json,'{}'),?),error_message=?,completed_at=?,lease_expires_at=NULL,notified_at=?,updated_at=? WHERE job_id=? AND owner_id=? AND stream_id=? AND correlation_id=? AND status IN('queued','running','committing')
    AND NOT EXISTS(SELECT 1 FROM consequential_executions execution WHERE execution.execution_id=document_jobs.job_id AND execution.actor_user_id=document_jobs.owner_id AND execution.result_ref IS NOT NULL)`)
    .bind(force?"failed":"canceled",JSON.stringify({errorDetail,noAutomaticRetry:true,stage:force?"failed":"canceled",progressMessage:errorDetail.message}),code,now,now,now,target.job_id,user.userId,target.stream_id,target.correlation_id).run();
  const row=await readJob(env,user.userId,target.job_id),job=row?await certifiedAdaptiveJob(env,user,row,true):null;
  return{job,stoppedCount:Number(changed.meta.changes??0),budget:await adaptiveStopBudget(env,user,job??target)};
}
async function stopGenerationJob(env: WorkerEnv, user: PilotUser, target: DocumentJobRow, force: boolean) {
  if(consentedAdaptiveJob(target))return stopAdaptivePlanningJob(env,user,target,force);
  await ensureOutputRequirementsSchema(env);
  if(await env.DB.prepare("SELECT 1 FROM output_operation_slots slot JOIN output_provider_calls calls ON calls.scope_key=slot.scope_key AND calls.slot_id=slot.slot_id WHERE slot.job_id=? AND calls.status IN('pending','uncertain') LIMIT 1").bind(target.job_id).first())return{error:"provider_submission_in_flight",status:409} as const;
  if (target.kind !== "preview" && target.kind !== "generate" && target.kind !== "prompt_fan" && target.kind !== "render_document") return { error: "generation_job_required", status: 409 } as const;
  if (target.status === "committing") return { error: "job_finalizing", status: 409 } as const;
  if(hasUnsettledProviderSubmission(parseResult(target))||unresolvedPresentationSubmission(target)||unresolvedAudioSubmission(target)||unresolvedStoryboardSubmission(target)||unresolvedVideoSubmission(target))return{error:"provider_submission_in_flight",status:409} as const;
  if (documentJobTerminal(target)) {await synchronizeOutputJobOutcome(env,target);return { job: target } as const;}
  const request = parseRequest(target); const childIds = target.kind === "prompt_fan" && Array.isArray(request.childJobIds) ? request.childJobIds.map(String).filter(Boolean) : [];
  const children = (await Promise.all(childIds.map((id) => readJob(env, user.userId, id)))).filter((row): row is DocumentJobRow => Boolean(row));
  if (children.some((row) => row.status === "committing")) return { error: "job_finalizing", status: 409 } as const;
  if(children.some((row)=>hasUnsettledProviderSubmission(parseResult(row))))return{error:"provider_submission_in_flight",status:409} as const;
  const targets = target.kind === "prompt_fan" ? [...children, target] : [target]; const stopped: DocumentJobRow[] = [];
  for(const row of targets){
    if(row.status!=="queued"&&row.status!=="running"||row.kind==="render_document")continue;
    const executing=await env.DB.prepare("SELECT 1 AS executing FROM cost_budget_reservations WHERE owner_id=? AND stream_id=? AND correlation_id=? AND status='executing' LIMIT 1")
      .bind(user.billingUserId??user.userId,row.stream_id,row.correlation_id).first();
    if(executing)return{error:"provider_submission_in_flight",status:409} as const;
  }
  for (const row of targets) {
    if (row.status !== "queued" && row.status !== "running") continue;
    if(row.kind!=="render_document"){
      const executing=await env.DB.prepare("SELECT 1 AS executing FROM cost_budget_reservations WHERE owner_id=? AND stream_id=? AND correlation_id=? AND status='executing' LIMIT 1")
        .bind(user.billingUserId??user.userId,row.stream_id,row.correlation_id).first();
      if(executing)return{error:"provider_submission_in_flight",status:409} as const;
    }
    const completedAt = new Date().toISOString();
    const errorDetail: DocumentJobError = { code: force ? "force_failed_by_admin" : "canceled_by_user", category: "canceled", scope: "request", action: "none", message: force ? "An administrator force-failed this generation." : "The user stopped this generation.", retryable: true, retryAfterMs: null, requestId: null, httpStatus: null };
    const result = { errorDetail, stage: force ? "failed" : "canceled", progressMessage: errorDetail.message };
    const updated = await env.DB.prepare(`UPDATE document_jobs SET status=?,result_json=json_patch(COALESCE(result_json,'{}'),?),error_message=?,completed_at=?,lease_expires_at=NULL,notified_at=?,updated_at=? WHERE job_id=? AND owner_id=? AND correlation_id=? AND status IN ('queued','running') AND(kind='render_document' OR NOT EXISTS(SELECT 1 FROM cost_budget_reservations execution WHERE execution.owner_id=? AND execution.stream_id=document_jobs.stream_id AND execution.correlation_id=document_jobs.correlation_id AND execution.status='executing')) AND NOT (kind='render_document' AND (COALESCE(json_extract(request_json,'$.artifactKind'),'')='slides' AND COALESCE(json_extract(COALESCE(result_json,'{}'),'$.presentationProviderSubmission'),'')='pending' OR COALESCE(json_extract(request_json,'$.artifactKind'),'')='audio' AND COALESCE(json_extract(COALESCE(result_json,'{}'),'$.audioProviderSubmission'),'')='pending' AND COALESCE(json_extract(COALESCE(result_json,'{}'),'$.providerJobId'),'')='' OR COALESCE(json_extract(request_json,'$.artifactKind'),'')='storyboard' AND COALESCE(json_extract(COALESCE(result_json,'{}'),'$.storyboardProviderSubmission'),'') IN ('pending','confirmed') OR COALESCE(json_extract(request_json,'$.artifactKind'),'')='video' AND(COALESCE(json_extract(COALESCE(result_json,'{}'),'$.generationReceipt.provider_request_status'),'')='submission_unknown' OR COALESCE(json_extract(COALESCE(result_json,'{}'),'$.generationReceipt.provider_request_status'),'')='submitted' AND COALESCE(json_extract(COALESCE(result_json,'{}'),'$.providerJobId'),'')='' AND COALESCE(json_type(COALESCE(result_json,'{}'),'$.productionAnchor'),'')!='object' AND NOT EXISTS(SELECT 1 FROM json_each(COALESCE(result_json,'{}'),'$.productionSceneReceipts') scene WHERE json_extract(scene.value,'$.status') IN('submitted','completed')) OR(COALESCE(json_extract(COALESCE(result_json,'{}'),'$.providerJobId'),'')!='' OR COALESCE(json_type(COALESCE(result_json,'{}'),'$.productionAnchor'),'')='object' OR COALESCE(json_extract(COALESCE(result_json,'{}'),'$.generationReceipt.provider_request_status'),'')='submitted' OR EXISTS(SELECT 1 FROM json_each(COALESCE(result_json,'{}'),'$.productionSceneReceipts') scene WHERE json_extract(scene.value,'$.status') IN('submitted','completed'))) AND(COALESCE(json_extract(COALESCE(result_json,'{}'),'$.reservationId'),'')='' OR COALESCE(json_extract(COALESCE(result_json,'{}'),'$.costReservationId'),'')='' OR EXISTS(SELECT 1 FROM json_each(COALESCE(result_json,'{}'),'$.productionSceneReceipts') scene WHERE json_extract(scene.value,'$.status') IN('submitted','completed') AND(COALESCE(json_extract(scene.value,'$.providerJobId'),'')='' OR COALESCE(CAST(json_extract(scene.value,'$.durationSeconds') AS REAL),0)<=0 AND COALESCE(CAST(json_extract(scene.value,'$.costMicrousd') AS REAL),0)<=0)))))) AND NOT (${unsettledProviderSubmissionSql()}) AND NOT EXISTS(SELECT 1 FROM output_operation_slots output_slot JOIN output_provider_calls output_call ON output_call.scope_key=output_slot.scope_key AND output_call.slot_id=output_slot.slot_id WHERE output_slot.job_id=document_jobs.job_id AND output_call.status IN('pending','uncertain'))`)
      .bind(force ? "failed" : "canceled", JSON.stringify(result), errorDetail.code, completedAt, force ? null : completedAt, completedAt, row.job_id, user.userId, row.correlation_id,user.billingUserId??user.userId).run();
    if(Number(updated.meta.changes??0)!==1){const retained=await readJob(env,user.userId,row.job_id);
      const raced=row.kind!=="render_document"?await env.DB.prepare("SELECT 1 AS executing FROM cost_budget_reservations WHERE owner_id=? AND stream_id=? AND correlation_id=? AND status='executing' LIMIT 1")
        .bind(user.billingUserId??user.userId,row.stream_id,row.correlation_id).first():null;
      if(raced||retained&&(hasUnsettledProviderSubmission(parseResult(retained))||unresolvedPresentationSubmission(retained)||unresolvedAudioSubmission(retained)||unresolvedStoryboardSubmission(retained)||unresolvedVideoSubmission(retained)))return{error:"provider_submission_in_flight",status:409} as const;continue;}
    stopped.push(row);
    const projected=await readJob(env,user.userId,row.job_id);if(projected)await synchronizeOutputJobOutcome(env,projected);
    const reason=force?"generation_force_failed":"generation_canceled";
    const terminal=await readJob(env,user.userId,row.job_id);
    const checkpoint=parseResult(terminal??row);
    const sceneReceipts=Object.values(checkpoint.productionSceneReceipts&&typeof checkpoint.productionSceneReceipts==="object"?checkpoint.productionSceneReceipts as Record<string,Record<string,unknown>>:{});
    const frameReceipts=Object.values(checkpoint.productionFrameReceipts&&typeof checkpoint.productionFrameReceipts==="object"?checkpoint.productionFrameReceipts as Record<string,Record<string,unknown>>:{});
    const plannerUsage=checkpoint.plannerUsage&&typeof checkpoint.plannerUsage==="object"?checkpoint.plannerUsage as Record<string,unknown>:{};
    const hasIncurredWork=Boolean(checkpoint.providerJobId||checkpoint.productionAnchor||sceneReceipts.length||frameReceipts.length||Number(plannerUsage.totalTokens??0)>0);
    let released:Array<{id:string;tokens:number;operation:string}>=[];
    let receiptAwareSettlement=false;
    const correlated=await readCorrelatedEvents(env,user.streamId,[row.correlation_id]);
    const costReservationId=await restoreLegacyCostReservation(env,user,terminal??row,correlated);
    if(hasIncurredWork&&(checkpoint.reservationId||costReservationId)){
      if(terminal){
        const settlement=await settleInterruptedDocumentJobReservations(env,user,terminal,{costReservationId:costReservationId||undefined,reason});
        receiptAwareSettlement=settlement.settled;
        if(settlement.settled&&checkpoint.reservationId)released=[{id:String(checkpoint.reservationId),tokens:settlement.releasedTokens,operation:`document-render:${String(parseRequest(row).artifactKind??"unknown")}`}];
      }
    }else{
      released=await releaseBudgetReservationsForCorrelation(env,user,row.correlation_id,reason);
      if(!checkpoint.providerJobId&&!correlated.some((event)=>event.type==="GenerationUsageRecorded"))await releaseCostReservationsForCorrelation(env,user.billingUserId??user.userId,row.correlation_id,user.streamId);
    }
    const auditType = force ? "JobForceFailed" : "JobCanceled";
    try {
      await appendAuditEvent(env, user.streamId, "worker:scheduler", auditType, { job_id: row.job_id, document_id: row.document_id, kind: row.kind, previous_status: row.status, requested_by: user.userId, requested_by_role: user.role, released_reservation_count: released.length }, row.correlation_id);
      if(!receiptAwareSettlement)for(const reservation of released)await appendAuditEvent(env,user.streamId,"worker:policy","BudgetReleased",{reservation_id:reservation.id,reserved_tokens:reservation.tokens,reason,operation:reservation.operation,job_id:row.job_id,attempt:row.attempt_count},row.correlation_id);
    } catch (error) { console.error("document_job_stop_audit_failed", row.job_id, error instanceof Error ? error.message : "unknown"); }
  }
  return { job: await readJob(env, user.userId, target.job_id), stoppedCount: stopped.length } as const;
}

/** Revoke actor-owned project jobs without granting their private inputs to the operator. */
export async function projectProviderSubmissionBlockers(env:WorkerEnv,organizationId:string){
  const rows=await env.DB.prepare(`SELECT job.job_id,job.kind,job.request_json,job.result_json FROM project_resource_scopes resource
    JOIN document_jobs job ON job.job_id=resource.resource_id AND job.owner_id=resource.actor_user_id
    WHERE resource.resource_kind='job' AND resource.organization_id=?
      AND job.status IN('queued','running','committing','failed','partial') ORDER BY job.requested_at,job.job_id LIMIT 500`)
    .bind(organizationId).all<Pick<DocumentJobRow,"job_id"|"kind"|"request_json"|"result_json">>();
  return rows.results.filter((row)=>hasUnsettledProviderSubmission(parseResult(row))||unresolvedPresentationSubmission(row)||unresolvedAudioSubmission(row)||unresolvedModel3dSubmission(row)||unresolvedStoryboardSubmission(row)||unresolvedVideoSubmission(row))
    .map((row)=>({jobId:row.job_id,kind:row.kind}));
}

/** Revoke actor-owned project jobs without granting their private inputs to the operator. */
export async function cancelProjectActorJobs(env:WorkerEnv,operator:PilotUser,scope:{organizationId:string;projectAccessId?:string;actorUserId?:string;ownerUserId?:string}){
  await ensureOutputRequirementsSchema(env);
  const clauses=["resource.resource_kind='job'","resource.organization_id=?","job.status IN('queued','running')"];
  const bindings:string[]=[scope.organizationId];
  if(scope.projectAccessId){clauses.push("resource.project_access_id=?");bindings.push(scope.projectAccessId);}
  if(scope.actorUserId){clauses.push("resource.actor_user_id=?");bindings.push(scope.actorUserId);}
  if(scope.ownerUserId){clauses.push("resource.owner_user_id=?");bindings.push(scope.ownerUserId);}
  const jobs=await env.DB.prepare(`SELECT job.*,resource.project_access_id,resource.organization_id,resource.project_id,resource.owner_user_id FROM project_resource_scopes resource JOIN document_jobs job ON job.job_id=resource.resource_id AND job.owner_id=resource.actor_user_id AND job.stream_id='creative:'||resource.owner_user_id WHERE ${clauses.join(" AND ")} ORDER BY job.requested_at,job.job_id LIMIT 500`)
    .bind(...bindings).all<DocumentJobRow&{project_access_id:string;organization_id:string;project_id:string;owner_user_id:string}>();
  for(const row of jobs.results){
    if(consentedAdaptiveJob(row)){
      await failConsequentialExecution(env,row.owner_id,row.job_id,"project_access_revoked");
      const now=new Date().toISOString();await env.DB.prepare(`UPDATE document_jobs SET status='canceled',error_message='project_access_revoked',completed_at=?,lease_expires_at=NULL,notified_at=?,updated_at=? WHERE job_id=? AND owner_id=? AND stream_id=? AND correlation_id=? AND status IN('queued','running') AND NOT EXISTS(SELECT 1 FROM consequential_executions execution WHERE execution.execution_id=document_jobs.job_id AND execution.result_ref IS NOT NULL)`)
        .bind(now,now,now,row.job_id,row.owner_id,row.stream_id,row.correlation_id).run();continue;
    }
    if(hasUnsettledProviderSubmission(parseResult(row))||unresolvedPresentationSubmission(row)||unresolvedAudioSubmission(row)||unresolvedModel3dSubmission(row)||unresolvedStoryboardSubmission(row)||unresolvedVideoSubmission(row))continue;
    if(row.kind!=="render_document"){
      const executing=await env.DB.prepare("SELECT 1 AS executing FROM cost_budget_reservations WHERE owner_id=? AND stream_id=? AND correlation_id=? AND status='executing' LIMIT 1")
        .bind(row.owner_id,row.stream_id,row.correlation_id).first();
      if(executing)continue;
    }
    const now=new Date().toISOString();
    const message="The project permission required for this operation was revoked.";
    const result={errorDetail:{code:"project_access_revoked",category:"canceled",scope:"request",action:"none",message,retryable:false,retryAfterMs:null,requestId:null,httpStatus:null},stage:"canceled",progressMessage:message};
    const changed=await env.DB.prepare(`UPDATE document_jobs SET status='canceled',result_json=json_patch(COALESCE(result_json,'{}'),?),error_message='project_access_revoked',completed_at=?,lease_expires_at=NULL,notified_at=?,updated_at=? WHERE job_id=? AND owner_id=? AND stream_id=? AND correlation_id=? AND status IN('queued','running') AND(kind='render_document' OR NOT EXISTS(SELECT 1 FROM cost_budget_reservations execution WHERE execution.owner_id=document_jobs.owner_id AND execution.stream_id=document_jobs.stream_id AND execution.correlation_id=document_jobs.correlation_id AND execution.status='executing')) AND NOT (${unsettledProviderSubmissionSql()}) AND NOT EXISTS(SELECT 1 FROM output_operation_slots output_slot JOIN output_provider_calls output_call ON output_call.scope_key=output_slot.scope_key AND output_call.slot_id=output_slot.slot_id WHERE output_slot.job_id=document_jobs.job_id AND output_call.status IN('pending','uncertain'))`)
      .bind(JSON.stringify(result),now,now,now,row.job_id,row.owner_id,row.stream_id,row.correlation_id).run();
    if(Number(changed.meta.changes??0)!==1)continue;
    const actor:PilotUser={...operator,userId:row.owner_id,billingUserId:row.owner_id,streamId:row.stream_id,projectExecution:{organizationId:row.organization_id,projectAccessId:row.project_access_id,projectId:row.project_id,ownerUserId:row.owner_user_id,actorUserId:row.owner_id}};
    const terminal=await readJob(env,row.owner_id,row.job_id);
    if(terminal){await releaseInterruptedAttempt(env,actor,terminal,"project_access_revoked");await synchronizeOutputJobOutcome(env,terminal);}
    await reconcileParentForChild(env,terminal??row);
  }
}

export type PreparedOutputDocumentJob = {
  user: PilotUser; documentId: string; kind: "generate" | "render_document";
  jobId: string; payload: Record<string, unknown>; estimatedMicrousd: number;
  maximumTokens: number; maximumCalls: number; initialResult: Record<string, unknown>;
  sourceHead: number; expiresAt: string; createdAt: string;
  queueEvent: { type: string; payload: Record<string, unknown> };
  buildStatements: (event: EventRow, checkpoint: Record<string, unknown>) => ReturnType<WorkerEnv["DB"]["prepare"]>[];
};

type OutputDocumentJobPreparation = {
  readScope?: OutputAdmissionReads;
  jobId: string; outputExecution: Record<string, string>;
  maximumMicrousd: number; maximumTokens: number; maximumCalls: number;
  outputImageRender?: {format:import("../src/model/image-format").ImageFormat;size:`${number}x${number}`};
  compile: (trusted: ReturnType<typeof authoritativeCreativeContext>) => Record<string, unknown> | Promise<Record<string, unknown>>;
  prepared?: PreparedOutputDocumentJob;
};

/** Internal precommit preparation through the same admission validation as ad-hoc jobs.
 * No HTTP dispatch occurs here. Only the caller's guarded transaction may persist
 * the returned job, scope anchor, and its real budget reservations. */
export async function prepareOutputDocumentJob(request: Request, env: WorkerEnv,
  command: { documentId: string; kind: "generate" | "render_document"; payload: Record<string, unknown> },
  preparation: Omit<OutputDocumentJobPreparation,"prepared">,
): Promise<PreparedOutputDocumentJob | Response> {
  assertOutputAdmissionRequest(preparation.readScope, request, env, command.documentId);
  const collector: OutputDocumentJobPreparation = { ...preparation };
  const admissionRequest = new Request(request.url, { method: "POST", headers: request.headers,
    body: JSON.stringify({ ...command, sourceSurface: "outputs" }), signal: request.signal });
  const response = await handleDocumentJobs(admissionRequest,env,"",undefined,collector);
  return collector.prepared ?? response;
}

export async function handleDocumentJobs(request: Request, env: WorkerEnv, path = "", context?: WorkerExecutionContext, outputPreparation?: OutputDocumentJobPreparation): Promise<Response> {
  await ensureSchema(env);
  if(path==="adaptive")return handleAdaptiveDocumentJobs(request,env,context);
  let sceneInspection=false;
  if(request.method==="POST"&&!path){try{const inspected=await request.clone().json() as {kind?:unknown;payload?:Record<string,unknown>};sceneInspection=inspected.kind==="render_document"&&inspected.payload?.artifactKind==="scene"&&inspected.payload.sceneCostPreview===true;}catch{/* The normal admission parser still rejects malformed input. */}}
  if(request.method!=="GET"&&!sceneInspection)await ensureOutputRequirementsSchema(env);
  const scoped=hasProjectContextCookie(request);
  const auth=await readOutputAdmissionValue(outputPreparation?.readScope,"principal",()=>requireUser(request,env,scoped||sceneInspection?"viewer":request.method==="GET"?"viewer":"creator",scoped?{account:"principal"}:{}));
  if(auth.response||!auth.user)return auth.response!;
  const principal=auth.user,selected=scoped?await readOutputAdmissionValue(outputPreparation?.readScope,"project-selection",()=>readProjectRequestContext(request,env,principal)):{context:null,response:null};
  if(selected.response)return selected.response;
  const project=selected.context;
  assertOutputAdmissionActor(outputPreparation?.readScope,env,principal.userId,project?.organizationId??null,project?.projectAccessId??null);
  const canRequestOutputs=!project||hasCapability(principal,"project.output.request",{organizationId:project.organizationId,projectAccessId:project.projectAccessId});
  // A current reader may find their own original planning jobs, but this grants
  // neither queue execution nor other output/recovery mutations.
  const readOnlyPlanning=Boolean(project&&!canRequestOutputs&&request.method==="GET"&&(!path||!path.includes("/"))&&hasCapability(principal,"project.read",{organizationId:project.organizationId,projectAccessId:project.projectAccessId}));
  const readOnlyScene=Boolean(sceneInspection&&project&&hasCapability(principal,"project.read",{organizationId:project.organizationId,projectAccessId:project.projectAccessId}));
  if(!canRequestOutputs&&!readOnlyPlanning&&!readOnlyScene)return Response.json({error:"project_read_only"},{status:403});
  const user:PilotUser=project?{...principal,streamId:`creative:${project.ownerUserId}`,projectExecution:{organizationId:project.organizationId,projectAccessId:project.projectAccessId,projectId:project.projectId,ownerUserId:project.ownerUserId,actorUserId:principal.userId}}:principal;
  if(path==="presentation-candidates"){
    if(request.method!=="GET")return new Response("Method not allowed",{status:405,headers:{"cache-control":"private, no-store"}});
    const documentId=new URL(request.url).searchParams.get("document")?.trim().slice(0,160)??"";
    if(!documentId||project&&!await activeProjectExecution(env,user,documentId))return Response.json({error:"presentation_candidate_not_found"},{status:404,headers:{"cache-control":"private, no-store"}});
    const rows=await env.DB.prepare(`SELECT DISTINCT job.* FROM document_jobs job JOIN private_content content
      ON content.owner_id=job.owner_id AND content.kind='provider-response' AND content.redacted_at IS NULL AND content.expires_at>?
        AND json_valid(content.content)=1 AND json_extract(content.content,'$.job_id')=job.job_id
        AND json_extract(content.content,'$.stream_id')=job.stream_id AND json_extract(content.content,'$.document_id')=job.document_id
        AND json_extract(content.content,'$.retention_class')='governed-evidence'
      WHERE job.owner_id=? AND job.stream_id=? AND job.document_id=? AND job.kind='render_document'
        AND job.status IN('failed','partial','completed') ORDER BY job.requested_at DESC LIMIT 40`)
      .bind(new Date().toISOString(),user.userId,user.streamId,documentId).all<DocumentJobRow>();
    const verified=await Promise.all(rows.results.map(async(row)=>({job:row,contextId:project?.contextId??"",
      candidates:(await verifiedPresentationCandidates(env,user,row,project?.contextId??"")).filter((candidate)=>candidate.summary.retentionClass==="governed-evidence")})));
    if(!await certifyPresentationCandidateDisclosures(env,user,verified))return Response.json({error:"presentation_candidate_not_found"},{status:404,headers:{"cache-control":"private, no-store"}});
    return Response.json({documentId,jobs:verified.filter(listing=>listing.candidates.length).map(listing=>({jobId:listing.job.job_id,documentId:listing.job.document_id,candidates:listing.candidates.map(candidate=>candidate.summary)}))},{headers:{"cache-control":"private, no-store"}});
  }
  const revisionRoute=path.match(/^([^/]+)\/presentation-candidates\/([^/]+)\/revisions$/u);
  if(revisionRoute){
    const headers={"cache-control":"private, no-store"};
    if(request.method!=="POST")return new Response("Method not allowed",{status:405,headers});
    const consent=requireConsent(principal);if(consent)return consent;
    if(project&&!hasCapability(principal,"project.author",{organizationId:project.organizationId,projectAccessId:project.projectAccessId}))return Response.json({error:"project_read_only"},{status:403,headers});
    const origin=request.headers.get("origin");if(origin&&origin!==new URL(request.url).origin)return Response.json({error:"same_origin_required"},{status:403,headers});
    const jobId=decodeURIComponent(revisionRoute[1]!),responseId=decodeURIComponent(revisionRoute[2]!);
    const row=await readJob(env,user.userId,jobId);
    if(!row||row.owner_id!==user.userId||row.stream_id!==user.streamId)return Response.json({error:"presentation_candidate_not_found"},{status:404,headers});
    const candidates=await verifiedPresentationCandidates(env,user,row,project?.contextId??"",responseId);
    if(candidates.length!==1)return Response.json({error:"presentation_candidate_not_found"},{status:404,headers});
    let input:unknown;
    try{const raw=await request.text();if(new TextEncoder().encode(raw).byteLength>70*1024)return Response.json({error:"presentation_revision_too_large"},{status:413,headers});input=JSON.parse(raw);}
    catch{return Response.json({error:"presentation_revision_request_invalid"},{status:400,headers});}
    const outcome=await reviseRetainedPresentationCandidate(env,user,row,project?.contextId??"",candidates[0]!,input);
    if("error"in outcome){
      if(outcome.issues&&!await certifyPresentationCandidateDisclosures(env,user,[{job:row,contextId:project?.contextId??"",candidates:[candidates[0]!]}]))return Response.json({error:"presentation_candidate_not_found"},{status:404,headers});
      return Response.json({error:outcome.error,...(outcome.issues?{issues:outcome.issues}:{})},{status:outcome.status,headers});
    }
    return Response.json(outcome.revision,{status:outcome.revision.reused?200:201,headers});
  }
  const candidateRoute=path.match(/^([^/]+)\/presentation-candidates(?:\/([^/]+)(\/preserve)?)?$/u);
  if(candidateRoute){
    const jobId=decodeURIComponent(candidateRoute[1]!);
    const responseId=candidateRoute[2]?decodeURIComponent(candidateRoute[2]):"";
    const preserve=Boolean(candidateRoute[3]);
    const notFound=()=>Response.json({error:"presentation_candidate_not_found"},{status:404,headers:{"cache-control":"private, no-store"}});
    if(request.method!=="GET"&&request.method!=="POST"||preserve&&request.method!=="POST"||!preserve&&request.method!=="GET"||preserve&&!responseId)return new Response("Method not allowed",{status:405,headers:{"cache-control":"private, no-store"}});
    if(preserve){const consent=requireConsent(principal);if(consent)return consent;}
    const row=await readJob(env,user.userId,jobId);
    if(!row||row.owner_id!==user.userId||row.stream_id!==user.streamId)return notFound();
    const candidates=await verifiedPresentationCandidates(env,user,row,project?.contextId??"",responseId);
    if(responseId&&!candidates.length)return notFound();
    if(preserve){
      const saved=await preservePresentationCandidate(env,user,row,project?.contextId??"",candidates[0]!);
      return saved?Response.json({jobId,documentId:row.document_id,candidate:saved},{headers:{"cache-control":"private, no-store"}}):notFound();
    }
    if(responseId){
      await appendAuditEvent(env,user.streamId,`user:${user.userId}`,"PresentationCandidateReviewed",{job_id:jobId,document_id:row.document_id,provider_response_id:responseId,page_index:candidates[0]!.summary.pageIndex,provider_attempt:candidates[0]!.summary.providerAttempt},jobId);
      if(!await certifyPresentationCandidateDisclosures(env,user,[{job:row,contextId:project?.contextId??"",candidates:[candidates[0]!]}]))return notFound();
      return Response.json({jobId,documentId:row.document_id,candidate:candidates[0]!.detail},{headers:{"cache-control":"private, no-store"}});
    }
    if(!await certifyPresentationCandidateDisclosures(env,user,[{job:row,contextId:project?.contextId??"",candidates}]))return notFound();
    return Response.json({jobId,documentId:row.document_id,candidates:candidates.map((candidate)=>candidate.summary)},{headers:{"cache-control":"private, no-store"}});
  }
  const issueNotesRoute=path.match(/^([^/]+)\/notes$/u);
  if(issueNotesRoute){
    const responseHeaders={"cache-control":"private, no-store"};
    if(request.method!=="GET"&&request.method!=="POST")return new Response("Method not allowed",{status:405,headers:responseHeaders});
    const jobId=decodeURIComponent(issueNotesRoute[1]!);
    const row=await readJob(env,user.userId,jobId);
    const now=new Date().toISOString();
    const notFound=()=>Response.json({error:"job_not_found"},{status:404,headers:responseHeaders});
    if(!row||row.owner_id!==user.userId||row.stream_id!==user.streamId
      ||!["failed","partial"].includes(row.status)||row.expires_at<=now)return notFound();
    if(project){if(!await activeProjectExecution(env,user,row.document_id,jobId))return notFound();}
    else if(await env.DB.prepare("SELECT 1 AS present FROM project_resource_scopes WHERE resource_kind='job' AND resource_id=?")
      .bind(jobId).first())return notFound();

    if(request.method==="POST"){
      const consent=requireConsent(principal);if(consent)return consent;
      const origin=request.headers.get("origin");
      if(origin&&origin!==new URL(request.url).origin)return Response.json({error:"same_origin_required"},{status:403,headers:responseHeaders});
      let input:{body?:unknown};
      try{input=await request.json() as typeof input;}catch{return Response.json({error:"activity_note_required"},{status:400,headers:responseHeaders});}
      const body=typeof input.body==="string"?input.body.trim():"";
      if(!body||body.length>2_000)return Response.json({error:"activity_note_invalid"},{status:400,headers:responseHeaders});
      const privateBody=JSON.stringify({job_id:jobId,document_id:row.document_id,actor_user_id:user.userId,body});
      let stored:Awaited<ReturnType<typeof storePrivateContent>>;
      try{stored=await storePrivateContent(env,user.userId,"activity-issue-note",privateBody,user.projectExecution);}
      catch(error){
        if(error instanceof Error&&error.message==="project_private_content_access_revoked")return notFound();
        throw error;
      }
      try{
        if(project&&!await activeProjectExecution(env,user,row.document_id,jobId))throw new Error("project_access_revoked");
        const event=await appendAuditEvent(env,user.streamId,`user:${user.userId}`,"ActivityIssueNoted",{
          job_id:jobId,document_id:row.document_id,actor_user_id:user.userId,note_ref:stored.contentId,
          content_expires_at:stored.expiresAt,...(project?{organization_id:project.organizationId,
            project_access_id:project.projectAccessId,project_id:project.projectId}:{}),
        },jobId);
        return Response.json({jobId,documentId:row.document_id,note:{id:event.eventId,body,
          createdAt:event.occurredAt,expiresAt:stored.expiresAt}},{status:201,headers:responseHeaders});
      }catch(error){
        await env.DB.prepare("UPDATE private_content SET content='',redacted_at=? WHERE content_id=? AND owner_id=? AND kind='activity-issue-note' AND redacted_at IS NULL")
          .bind(new Date().toISOString(),stored.contentId,user.userId).run();
        if(error instanceof Error&&error.message==="project_access_revoked")return notFound();
        throw error;
      }
    }

    const projectJoin=project?`JOIN project_resource_scopes scope ON scope.resource_kind='content'
        AND scope.resource_id=content.content_id AND scope.project_access_id=? AND scope.organization_id=?
        AND scope.project_id=? AND scope.owner_user_id=? AND scope.actor_user_id=? AND scope.visibility='actor_private'
      JOIN private_content_retention_scopes retention ON retention.content_id=content.content_id
        AND retention.organization_id=scope.organization_id AND retention.project_access_id=scope.project_access_id
        AND retention.project_id=scope.project_id AND retention.actor_user_id=scope.actor_user_id
        AND retention.classification='governed-evidence'
      JOIN project_resource_scopes job_scope ON job_scope.resource_kind='job' AND job_scope.resource_id=?
        AND job_scope.project_access_id=scope.project_access_id AND job_scope.organization_id=scope.organization_id
        AND job_scope.project_id=scope.project_id AND job_scope.owner_user_id=scope.owner_user_id
        AND job_scope.actor_user_id=scope.actor_user_id
      JOIN events anchor ON anchor.event_id=job_scope.source_event_id AND anchor.stream_id=?
        AND anchor.actor='user:'||job_scope.actor_user_id AND anchor.type='ProjectDocumentJobQueued'
        AND json_extract(anchor.payload,'$.job_id')=job_scope.resource_id
        AND json_extract(anchor.payload,'$.organization_id')=job_scope.organization_id
        AND json_extract(anchor.payload,'$.project_access_id')=job_scope.project_access_id
        AND json_extract(anchor.payload,'$.actor_user_id')=job_scope.actor_user_id
      JOIN project_context_sessions selection ON selection.context_id=? AND selection.principal_user_id=?
        AND selection.organization_id=scope.organization_id AND selection.project_access_id=scope.project_access_id
        AND selection.revoked_at IS NULL AND selection.expires_at>?`:"";
    const projectCondition=project?` AND json_extract(event.payload,'$.organization_id')=?
        AND json_extract(event.payload,'$.project_access_id')=? AND json_extract(event.payload,'$.project_id')=?`:
      " AND NOT EXISTS(SELECT 1 FROM project_resource_scopes scoped WHERE scoped.resource_kind='content' AND scoped.resource_id=content.content_id)";
    const bindings:Array<string>=[user.userId,now,
      ...(project?[project.projectAccessId,project.organizationId,project.projectId,project.ownerUserId,user.userId,
        jobId,user.streamId,project.contextId,user.userId,now]:[]),
      user.streamId,jobId,`user:${user.userId}`,jobId,row.document_id,user.userId,
      ...(project?[project.organizationId,project.projectAccessId,project.projectId,
        ...projectExecutionBindings(user.projectExecution!,row.document_id)]:[])];
    const rows=await env.DB.prepare(`SELECT event.event_id,event.occurred_at,content.content,content.expires_at
      FROM events event INDEXED BY idx_events_correlation
      JOIN private_content content ON content.content_id=json_extract(event.payload,'$.note_ref')
        AND content.owner_id=? AND content.kind='activity-issue-note' AND content.redacted_at IS NULL AND content.expires_at>?
      ${projectJoin}
      WHERE event.stream_id=? AND event.correlation_id=? AND event.type='ActivityIssueNoted' AND event.actor=?
        AND json_extract(event.payload,'$.job_id')=? AND json_extract(event.payload,'$.document_id')=?
        AND json_extract(event.payload,'$.actor_user_id')=?${projectCondition}
        ${project?`AND ${activeProjectExecutionSql}`:""}
      ORDER BY event.sequence DESC LIMIT 50`).bind(...bindings)
      .all<{event_id:string;occurred_at:string;content:string;expires_at:string}>();
    const notes=rows.results.flatMap((entry)=>{
      try{
        const value=JSON.parse(entry.content) as Record<string,unknown>;
        return value.job_id===jobId&&value.document_id===row.document_id&&value.actor_user_id===user.userId
          &&typeof value.body==="string"&&value.body.trim()&&value.body.length<=2_000
          ?[{id:entry.event_id,body:value.body,createdAt:entry.occurred_at,expiresAt:entry.expires_at}]:[];
      }catch{return[];}
    });
    return Response.json({jobId,documentId:row.document_id,notes},{headers:responseHeaders});
  }
  const executionRequest=request.method==="POST"&&path.endsWith("/run");let verifiedPathJob:DocumentJobRow|null=null;
  if(!project&&path){
    const targetId=decodeURIComponent(path.replace(/\/(?:cancel|force-fail|ack|dismiss|retry|run|recover|reconcile-provider|reconcile-output|continue-safer-frames)$/,""));
    const personal=await env.DB.prepare(`SELECT ${executionRequest?"job.*,(SELECT slot.slot_id FROM output_operation_slots slot WHERE slot.job_id=job.job_id) AS output_slot_id":"1 AS present"} FROM document_jobs job WHERE job.job_id=? AND job.owner_id=? AND job.stream_id=?
      AND NOT EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.resource_kind='job' AND resource.resource_id=job.job_id)`)
      .bind(targetId,user.userId,user.streamId).first<DocumentJobRow|{present:number}>();
    if(!personal)return Response.json({error:"job_not_found"},{status:404,headers:{"cache-control":"private, no-store"}});
    if(executionRequest)verifiedPathJob=personal as DocumentJobRow;
  }
  if(project&&request.method!=="GET"){const consent=requireConsent(principal);if(consent)return consent;}
  const privateReceiptPath=project&&request.method==="GET"?path.match(/^([^/]+)\/private-receipt$/):null;
  if(project&&privateReceiptPath){
    const jobId=decodeURIComponent(privateReceiptPath[1]!);
    const row=await readJob(env,principal.userId,jobId);
    const now=new Date().toISOString();
    const notFound=()=>Response.json({error:"job_not_found"},{status:404,headers:{"cache-control":"private, no-store"}});
    if(!row||row.kind!=="render_document"||row.owner_id!==principal.userId||row.stream_id!==user.streamId||(!["queued","running","committing"].includes(row.status)&&row.expires_at<=now))return notFound();
    const receipt=parseResult(row).generationReceipt;
    if(!receipt||typeof receipt!=="object"||Array.isArray(receipt))return notFound();
    const reference=(receipt as Record<string,unknown>).input_ref;
    if(typeof reference!=="string"||!reference.trim())return notFound();
    const retained=await env.DB.prepare(`SELECT content.content_id,content.content FROM private_content content
      JOIN project_resource_scopes receipt ON receipt.resource_kind='content' AND receipt.resource_id=content.content_id
        AND receipt.visibility='actor_private' AND receipt.project_access_id=? AND receipt.organization_id=? AND receipt.project_id=?
        AND receipt.owner_user_id=? AND receipt.actor_user_id=?
      JOIN private_content_retention_scopes retention ON retention.content_id=content.content_id
        AND retention.organization_id=receipt.organization_id AND retention.project_access_id=receipt.project_access_id
        AND retention.project_id=receipt.project_id AND retention.actor_user_id=receipt.actor_user_id AND retention.classification='governed-evidence'
      JOIN project_resource_scopes resource ON resource.resource_kind='job' AND resource.resource_id=?
        AND resource.project_access_id=receipt.project_access_id AND resource.organization_id=receipt.organization_id
        AND resource.project_id=receipt.project_id AND resource.owner_user_id=receipt.owner_user_id AND resource.actor_user_id=receipt.actor_user_id
      JOIN events anchor ON anchor.event_id=resource.source_event_id AND anchor.stream_id=? AND anchor.actor='user:'||resource.actor_user_id
        AND anchor.type='ProjectDocumentJobQueued' AND json_extract(anchor.payload,'$.job_id')=resource.resource_id
        AND json_extract(anchor.payload,'$.organization_id')=resource.organization_id
        AND json_extract(anchor.payload,'$.project_access_id')=resource.project_access_id
        AND json_extract(anchor.payload,'$.actor_user_id')=resource.actor_user_id
      JOIN project_context_sessions selection ON selection.context_id=? AND selection.principal_user_id=?
        AND selection.organization_id=receipt.organization_id AND selection.project_access_id=receipt.project_access_id
        AND selection.revoked_at IS NULL AND selection.expires_at>?
      WHERE content.content_id=? AND content.owner_id=? AND content.kind='document-artifact-input'
        AND content.redacted_at IS NULL AND content.expires_at>? AND json_valid(content.content)=1
        AND json_extract(content.content,'$.job_id')=? AND json_extract(content.content,'$.document_id')=?
        AND ${activeProjectExecutionSql}`)
      .bind(project.projectAccessId,project.organizationId,project.projectId,project.ownerUserId,principal.userId,
        jobId,user.streamId,project.contextId,principal.userId,now,reference,principal.userId,now,jobId,row.document_id,
        ...projectExecutionBindings(user.projectExecution!,row.document_id)).first<{content_id:string;content:string}>();
    if(!retained||retained.content_id!==reference)return notFound();
    const safe=safeScopedJob(row);
    return Response.json({job:{...safe,result:{...(safe.result??{}),generationReceipt:receipt}},content:{[reference]:retained.content}},{headers:{"cache-control":"private, no-store"}});
  }
  if(project&&request.method==="GET"){
    const now=new Date().toISOString(),query=new URL(request.url).searchParams,activeOnly=query.get("scope")==="active",document=query.get("document")?.trim().slice(0,160)??"";
    const requestedId=path?decodeURIComponent(path):"";
    const readBinding:ConsequentialBinding={version:"planning-job-read-v1",operation:"adaptive-structure",intentHash:"",sourceHash:"",actorUserId:principal.userId,permissionEpoch:principal.access.permissionEpoch,streamId:user.streamId,projectId:project.projectId,documentId:"",canvasId:null,blockId:"",period:now.slice(0,7),scope:user.projectExecution!,contextSessionId:project.contextId,pilotCohortId:null,steps:[],publicQuery:"",request:{}};
    const readGuard=executionAdmissionGuard(principal,readBinding,null);
    const canvasReadable=hasCapability(principal,"project.canvas.use",{organizationId:project.organizationId,projectAccessId:project.projectAccessId});
    const rows=await env.DB.prepare(`SELECT job.job_id,job.owner_id,job.stream_id,job.document_id,job.kind,job.status,job.source_surface,job.correlation_id,job.requested_sequence,
      json_object('documentRevision',json_extract(job.request_json,'$.documentRevision'),'requestKey',json_extract(job.request_json,'$.requestKey'),
        'sourcePreviewId',json_extract(job.request_json,'$.sourcePreviewId'),'promptTechnique',json_extract(job.request_json,'$.promptTechnique'),
        'promptFanId',json_extract(job.request_json,'$.promptFanId'),'parentJobId',json_extract(job.request_json,'$.parentJobId'),
        'fanKind',json_extract(job.request_json,'$.fanKind'),'artifactKind',json_extract(job.request_json,'$.artifactKind'),'productionMode',json_extract(job.request_json,'$.productionMode'),'itemCount',json_extract(job.request_json,'$.itemCount'),'canvasId',json_extract(job.request_json,'$.canvasId'),
        'sceneMedium',json_extract(job.request_json,'$.sceneMedium'),'sceneConfiguration',json(json_extract(job.request_json,'$.sceneConfiguration'))) AS request_json,
      json_remove(job.result_json,'$.imageRecovery','$.scenePolicyStopSummary','$.providerSubmissions','$.providerSubmissionProtocol','$.providerSubmissionLegacyUncertain','$.plannerInput','$.videoInputReceipt','$.audioInputReceipt','$.model3dInputReceipt','$.model3dProviderFiles','$.artifactPlan','$.presentationCandidates','$.presentationRecoveryOnly','$.productionPlan','$.productionSceneReceipts','$.productionFrameReceipts','$.productionAnchor','$.providerStatusUrl','$.providerResponseUrl','$.providerCancelUrl','$.moderationPromptRef','$.intentRef','$.providerJobId','$.providerRequestId','$.storyboardSafeRecovery','$.storyboardRejectedProviderReceipt','$.generationReceipt','$.generation_receipt','$.input_ref','$.inputRef','$.source_snapshot_sha256') AS result_json,
      job.error_message,job.attempt_count,job.requested_at,job.started_at,job.completed_at,job.lease_expires_at,job.notified_at,job.expires_at,job.updated_at
      FROM document_jobs job JOIN project_resource_scopes resource ON resource.resource_kind='job'
      AND resource.resource_id=job.job_id AND resource.actor_user_id=job.owner_id AND resource.owner_user_id=?
      JOIN project_resource_scopes document_scope ON document_scope.project_access_id=resource.project_access_id AND document_scope.organization_id=resource.organization_id
        AND document_scope.project_id=resource.project_id AND document_scope.owner_user_id=resource.owner_user_id
        AND document_scope.resource_kind='document' AND document_scope.resource_id=job.document_id
      WHERE job.owner_id=? AND job.stream_id=? AND resource.project_access_id=? AND resource.organization_id=? AND resource.project_id=?
        AND (?=0 OR job.kind='structure_adaptive' AND json_extract(job.request_json,'$.adaptiveConsentVersion')=1
          AND resource.visibility='actor_private' AND EXISTS(SELECT 1 FROM events anchor WHERE anchor.event_id=resource.source_event_id
            AND anchor.stream_id=job.stream_id AND anchor.actor='user:'||resource.actor_user_id AND anchor.type='ProjectDocumentJobQueued'
            AND json_extract(anchor.payload,'$.job_id')=job.job_id AND json_extract(anchor.payload,'$.document_id')=job.document_id
            AND json_extract(anchor.payload,'$.organization_id')=resource.organization_id AND json_extract(anchor.payload,'$.project_access_id')=resource.project_access_id
            AND json_extract(anchor.payload,'$.project_id')=resource.project_id AND json_extract(anchor.payload,'$.history_owner_user_id')=resource.owner_user_id
            AND json_extract(anchor.payload,'$.actor_user_id')=resource.actor_user_id))
        AND (job.kind!='structure_adaptive' OR COALESCE(json_extract(job.request_json,'$.canvasId'),'')='' OR ?=1)
        AND (?='' OR job.job_id=?) AND (?=0 OR job.status IN('queued','running','committing') OR job.notified_at IS NULL)
        AND (?='' OR job.status IN('queued','running','committing') OR job.notified_at IS NULL OR job.document_id=?)
        AND (job.status IN('queued','running','committing') OR job.expires_at>?) AND ${readGuard.sql}
        AND (?<>'' OR NOT EXISTS(SELECT 1 FROM output_operation_slots slot WHERE slot.job_id=job.job_id AND slot.status='authorized'))
      ORDER BY CASE WHEN job.status IN('queued','running','committing') THEN 0 ELSE 1 END,job.requested_at DESC LIMIT 120`)
      .bind(project.ownerUserId,principal.userId,user.streamId,project.projectAccessId,project.organizationId,project.projectId,Number(readOnlyPlanning),Number(canvasReadable),requestedId,requestedId,Number(activeOnly),document,document,now,...readGuard.bindings,requestedId).all<DocumentJobRow>();
    if(path&&!rows.results.length)return Response.json({error:"job_not_found"},{status:404});
    const activeBlocker=[...rows.results].filter((row)=>row.kind!=="prompt_fan"&&["running","committing"].includes(row.status)).sort((left,right)=>left.requested_at.localeCompare(right.requested_at)||left.job_id.localeCompare(right.job_id))[0]??null;
    const recoveryBlocker=activeBlocker&&rowIsStale(activeBlocker)?activeBlocker:null;
    const adaptiveCertified=await Promise.all(rows.results.map(async(row)=>row.kind==="structure_adaptive"?certifiedAdaptiveJob(env,user,await readJob(env,user.userId,row.job_id)??row,false,query.get("inspection")==="1"):row));
    const certified=readOnlyPlanning?adaptiveCertified:await freshlyRecoverablePresentationRows(env,user,adaptiveCertified,project.contextId);
    if(!await env.DB.prepare(`SELECT 1 WHERE ${readGuard.sql}`).bind(...readGuard.bindings).first())return Response.json({error:"project_read_access_changed"},{status:403,headers:{"cache-control":"private, no-store"}});
    return Response.json(path?{job:safeScopedJob(certified[0]!,recoveryBlocker)}:{jobs:certified.map((row)=>safeScopedJob(row,recoveryBlocker))},{headers:{"cache-control":"private, no-store"}});
  }
  if(project&&path){
    const targetId=decodeURIComponent(path.replace(/\/(?:cancel|force-fail|ack|dismiss|retry|run|recover|reconcile-provider|reconcile-output|continue-safer-frames)$/,""));
    if(request.method==='POST'&&path.endsWith('/recover')){
      const target=await env.DB.prepare("SELECT document_id FROM document_jobs WHERE job_id=? AND owner_id=?").bind(targetId,user.userId).first<{document_id:string}>();
      if(!target||!await activeProjectExecution(env,user,target.document_id,targetId))return Response.json({error:"job_not_found"},{status:404});
    }else{
      const target=await readJob(env,user.userId,targetId);
      if(!target||!await activeProjectExecution(env,user,target.document_id,targetId))return Response.json({error:"job_not_found"},{status:404});
      if(executionRequest)verifiedPathJob=target;
    }
  }
  type DocumentJobAdmission={kind?:string;documentId?:string;sourceSurface?:string;payload?:Record<string,unknown>&{sceneMedium?:SceneMedium;sceneConfiguration?:SceneConfiguration}};let submittedInput:DocumentJobAdmission|null=null;
  if(request.method==="POST"&&!path){const consent=requireConsent(user);if(consent)return consent;submittedInput=await request.json() as DocumentJobAdmission;if(submittedInput.kind==="structure_adaptive")return Response.json({error:"adaptive_consent_required",submission:"not-submitted"},{status:428});const payload=submittedInput.payload;if(submittedInput.kind==="render_document"&&(payload?.artifactKind==="storyboard"||payload?.artifactKind==="video"||payload?.artifactKind==="audio")&&payload.paidMediaConfirmed!==true)return Response.json({error:"paid_media_confirmation_required",message:"Confirm paid media generation before starting this render."},{status:428});}
  if(request.method==="POST"&&path.endsWith("/retry")){const target=await readJob(env,user.userId,decodeURIComponent(path.slice(0,-6).replace(/\/$/,"")));if(target&&await env.DB.prepare("SELECT 1 FROM output_operation_slots WHERE job_id=?").bind(target.job_id).first())return Response.json({error:"output_retry_requires_new_authorization",message:"Use Output requirements to authorize an alternative. Retained presentation recovery does not create another provider request."},{status:409});if(target?.kind==="render_document"){const payload=parseRequest(target);if((payload.artifactKind==="storyboard"||payload.artifactKind==="video"||payload.artifactKind==="audio"||payload.artifactKind==="model3d")&&payload.paidMediaConfirmed!==true)return Response.json({error:"paid_media_confirmation_required",message:"Confirm paid media generation before recovering this render."},{status:428});}}
  const now = new Date().toISOString();
  // Neither passive polling nor an unauthorized paid request may reconcile or
  // rewrite account history. Maintenance starts only after financial admission.
  if(request.method!=="GET"&&path.endsWith("/retry")&&!project){
    await reconcileFailedBudgetReservations(env,user);
    await env.DB.prepare(`UPDATE document_jobs SET ${EXPIRED_DOCUMENT_JOB_REDACTION_SQL},updated_at=? WHERE owner_id=? AND stream_id=? AND expires_at<=? AND ${DOCUMENT_JOB_REDACTION_REQUIRED_SQL}
      AND NOT EXISTS(SELECT 1 FROM project_resource_scopes resource JOIN organization_retention_policies policy ON policy.organization_id=resource.organization_id AND policy.legal_hold=1
        WHERE (resource.resource_kind='job' AND resource.resource_id=document_jobs.job_id)
          OR (resource.resource_kind='document' AND resource.resource_id=document_jobs.document_id AND resource.owner_user_id=document_jobs.owner_id))`).bind(now,user.userId,user.streamId,now).run();
  }

  if(path.endsWith("/reconcile-output")&&request.method==="POST"){
    const jobId=decodeURIComponent(path.slice(0,-"/reconcile-output".length));
    const target=await readJob(env,user.userId,jobId);
    if(!target)return Response.json({error:"job_not_found"},{status:404,headers:{"cache-control":"private, no-store"}});
    const binding=await loadOutputJobBinding(env,user,target);
    if(!binding)return Response.json({error:"output_native_operation_required"},{status:409});
    if(!documentJobTerminal(target))return Response.json({error:"output_operation_still_running"},{status:409});
    const jobAuthority=documentJobProjectAuthority(user,target.document_id,target.job_id);
    // Financial recovery uses this currently selected, authorized project
    // context; it must not require the original execution session to survive.
    const financialScope={...binding.scope,contextId:project?.contextId??null};
    const assertions=[outputScopeAuthority(financialScope,"request"),...(jobAuthority?[jobAuthority]:[])];
    try{
      const outcome=await reconcileKnownOutputProviderReceipts(env,user,{jobId,assertions});
      const current=await env.DB.batch<Record<string,unknown>>([...assertions.flatMap(assertion=>outputAssertionStatements(env,assertion)),env.DB.prepare(`SELECT job.*,
        EXISTS(SELECT 1 FROM output_provider_calls call WHERE call.scope_key=? AND call.slot_id=? AND call.status IN('pending','uncertain')) AS output_uncertain,
        (SELECT status FROM cost_budget_reservations WHERE reservation_id=? AND owner_id=?) AS output_cost_status
        FROM document_jobs job WHERE job.job_id=? AND job.owner_id=? AND job.stream_id=? AND job.document_id=?`)
        .bind(binding.scope.key,binding.slot.slotId,binding.slot.costReservationId,user.billingUserId??user.userId,jobId,user.userId,user.streamId,target.document_id)]);
      const final=current.at(-1)?.results[0] as (DocumentJobRow&{output_uncertain:number;output_cost_status:string})|undefined;
      if(!final)throw new OutputConflictError("output_job_binding_missing",404);
      const status=final.output_uncertain||["active","executing"].includes(final.output_cost_status)?"uncertain":outcome.status==="not_needed"?"not_needed":"known";
      const checkpoint=parseResult(final),detail=errorDetailFromResult(checkpoint),priorReceipt=checkpoint.generationReceipt&&typeof checkpoint.generationReceipt==="object"?checkpoint.generationReceipt as Record<string,unknown>:{};
      const monetaryKeys=new Set(["artifact_kind","provider","model","actual_provider_call_count","reservation_microusd","settled_cost_microusd","reservation_status","source_transmission_status","provider_request_status","failure_code","failure_category","failure_stage"]);
      const safeReceipt=Object.fromEntries(Object.entries(priorReceipt).filter(([key,value])=>monetaryKeys.has(key)&&["string","number","boolean"].includes(typeof value)));
      const safeDetail=detail?{code:detail.code,category:detail.category,scope:detail.scope,action:detail.action,message:"The Output operation stopped. Inspect its retained financial receipt before authorizing an alternative.",retryable:false,retryAfterMs:null,requestId:detail.requestId,httpStatus:detail.httpStatus}:null;
      const safeRow={...final,request_json:JSON.stringify(final.kind==="render_document"?{artifactKind:"slides"}:{}),result_json:JSON.stringify({artifactKind:final.kind==="render_document"?"slides":"image",stage:final.status,generationReceipt:safeReceipt,...(safeDetail?{errorDetail:safeDetail}:{}),progressMessage:""}),error_message:safeDetail?.code??null};
      return Response.json({job:serializeJob(safeRow),reconciliation:{documentId:target.document_id,grantId:binding.slot.grantId,slotId:binding.slot.slotId,jobId,status,reconciled:outcome.reconciled>0}},{headers:{"cache-control":"private, no-store"}});
    }catch(error){
      if(error instanceof OutputConflictError)return Response.json({error:error.code},{status:error.status,headers:{"cache-control":"private, no-store"}});
      if(String(error).includes("constraint failed"))return Response.json({error:"output_execution_authority_revoked"},{status:403,headers:{"cache-control":"private, no-store"}});
      throw error;
    }
  }

  if ((path.endsWith("/cancel") || path.endsWith("/force-fail")) && request.method === "POST") {
    const force = path.endsWith("/force-fail");
    if (force && user.role !== "admin") return Response.json({ error: "admin_required" }, { status: 403 });
    const suffixLength = force ? 11 : 7; const jobId = decodeURIComponent(path.slice(0, -suffixLength).replace(/\/$/, ""));
    const target = await readJob(env, user.userId, jobId); if (!target) return Response.json({ error: "job_not_found" }, { status: 404 });
    const stopped = await stopGenerationJob(env, user, target, force);
    if ("error" in stopped) return Response.json({ error: stopped.error }, { status: stopped.status });
    if (!stopped.job) return Response.json({ error: "job_not_found" }, { status: 404 });
    context?.waitUntil(driveDocumentQueue(env, user));
    return Response.json({ job:project?safeScopedJob(stopped.job):serializeJob(stopped.job), stoppedCount: stopped.stoppedCount ?? 0, ...("budget" in stopped?{budget:stopped.budget}:{}) });
  }

  if (path.endsWith("/ack") && request.method === "POST") {
    const jobId = decodeURIComponent(path.slice(0, -4).replace(/\/$/, ""));
    const target = await readJob(env, user.userId, jobId); if (!target) return Response.json({ error: "job_not_found" }, { status: 404 });
    const request = parseRequest(target); const childIds = target.kind === "prompt_fan" && Array.isArray(request.childJobIds) ? request.childJobIds.map(String).filter(Boolean) : [];
    const statements = [jobId, ...childIds].map((id) => env.DB.prepare("UPDATE document_jobs SET notified_at=COALESCE(notified_at,?),updated_at=? WHERE job_id=? AND owner_id=?").bind(now, now, id, user.userId));
    const results = await env.DB.batch(statements); const result = results[0];
    return Number(result.meta.changes ?? 0) === 1 ? Response.json({ ok: true }) : Response.json({ error: "job_not_found" }, { status: 404 });
  }

  if (path.endsWith("/dismiss") && request.method === "POST") {
    const jobId = decodeURIComponent(path.slice(0, -8).replace(/\/$/, ""));
    const headers = { "cache-control": "private, no-store" };
    const notFound = () => Response.json({ error: "job_not_found" }, { status: 404, headers });
    const conflict = () => Response.json({ error: "Generation issue could not be dismissed" }, { status: 409, headers });
    const target = await readJob(env, user.userId, jobId);
    if (!target || target.stream_id !== user.streamId) return notFound();
    if (target.status !== "failed" && target.status !== "partial") return Response.json({ error: "terminal_failure_required" }, { status: 409, headers });
    // SQL NULL is an absent checkpoint; malformed or non-object retained data is not.
    const readDismissedAt = (row: DocumentJobRow): string | null | undefined => {
      if (row.result_json === null) return null;
      try {
        const result: unknown = JSON.parse(row.result_json);
        if (!result || typeof result !== "object" || Array.isArray(result)) return undefined;
        const value = (result as Record<string, unknown>).dismissedAt;
        if (value === undefined || value === null) return null;
        if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return undefined;
        return new Date(value).toISOString() === value ? value : undefined;
      } catch { return undefined; }
    };
    const originalDismissal = readDismissedAt(target);
    if (originalDismissal === undefined) return conflict();
    const authority = documentJobProjectAuthority(user, target.document_id, jobId);
    const custodySql = authority?.sql ?? "NOT EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.resource_kind='job' AND resource.resource_id=document_jobs.job_id)";
    const selectionSql = project ? ` AND EXISTS(SELECT 1 FROM project_context_sessions selection WHERE selection.context_id=? AND selection.principal_user_id=?
      AND selection.organization_id=? AND selection.project_access_id=? AND selection.revoked_at IS NULL
      AND selection.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))` : "";
    const scopeBindings = [...(authority?.bindings ?? []), ...(project ? [project.contextId, user.userId, project.organizationId, project.projectAccessId] : [])];
    // Change only dismissal metadata on the exact observed failed attempt.
    const changed = originalDismissal === null ? await env.DB.prepare(`UPDATE document_jobs
      SET result_json=json_set(COALESCE(result_json,'{}'),'$.dismissedAt',strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at=MAX(updated_at,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      WHERE job_id=? AND owner_id=? AND stream_id=? AND document_id=? AND kind=?
        AND correlation_id=? AND attempt_count=? AND status=? AND result_json IS ? AND updated_at=?
        AND CASE WHEN result_json IS NULL THEN 1 WHEN json_valid(result_json) THEN
          json_type(result_json)='object' AND (json_type(result_json,'$.dismissedAt') IS NULL OR json_type(result_json,'$.dismissedAt')='null')
          ELSE 0 END
        AND (${custodySql})${selectionSql}`)
      .bind(jobId, user.userId, user.streamId, target.document_id, target.kind, target.correlation_id, target.attempt_count,
        target.status, target.result_json, target.updated_at, ...scopeBindings).run() : null;
    // Reload under the same current custody/selection predicates, never return the captured body.
    const updated = await env.DB.prepare(`SELECT document_jobs.*${outputSchemaIsReady(env.DB) ? ",(SELECT slot.slot_id FROM output_operation_slots slot WHERE slot.job_id=document_jobs.job_id) AS output_slot_id" : ""},
      CASE WHEN json_valid(result_json) AND json_valid(?) THEN json_type(result_json)='object'
        AND json_remove(result_json,'$.dismissedAt')=json_remove(?,'$.dismissedAt') ELSE 0 END AS dismissal_checkpoint_matches
      FROM document_jobs WHERE job_id=? AND owner_id=? AND stream_id=? AND document_id=? AND kind=?
        AND (${custodySql})${selectionSql}`)
      .bind(target.result_json ?? "{}", target.result_json ?? "{}", jobId, user.userId, user.streamId, target.document_id, target.kind, ...scopeBindings)
      .first<DocumentJobRow & { dismissal_checkpoint_matches: number }>();
    if (!updated) return notFound();
    const currentDismissal = readDismissedAt(updated);
    if (currentDismissal === undefined) return conflict();
    if (Number(changed?.meta.changes ?? 0) !== 1) {
      const sameAttempt = updated.correlation_id === target.correlation_id && updated.attempt_count === target.attempt_count && updated.status === target.status;
      const sameSnapshot = updated.dismissal_checkpoint_matches === 1 && DOCUMENT_JOB_COLUMNS.split(",")
        .filter(column => column !== "result_json" && column !== "updated_at")
        .every(column => updated[column as keyof DocumentJobRow] === target[column as keyof DocumentJobRow]);
      const sameDismissal = typeof currentDismissal === "string" && (originalDismissal !== null
        ? currentDismissal === originalDismissal : sameSnapshot);
      if (!sameAttempt || !sameDismissal) return conflict();
    }
    return Response.json({ job: project ? safeScopedJob(updated) : serializeJob(updated) }, { headers });
  }

  if(path.endsWith("/recover")&&request.method==="POST"){
    const consent=requireConsent(principal);if(consent)return consent;
    const jobId=decodeURIComponent(path.slice(0,-8).replace(/\/$/,""));
    // Discriminate without materializing an Image's private request/checkpoint.
    const nativeImage=outputSchemaIsReady(env.DB)?await env.DB.prepare(`SELECT 1 AS present FROM document_jobs job WHERE job.job_id=? AND job.owner_id=? AND job.kind='generate'
      AND EXISTS(SELECT 1 FROM output_operation_slots slot WHERE slot.job_id=job.job_id)`).bind(jobId,user.userId).first():null;
    if(nativeImage){
      if(auth.impersonation)return Response.json({error:"output_image_acknowledgment_actor_required"},{status:403,headers:{"cache-control":"private, no-store"}});
      const target=await readImageAcknowledgmentJob(env,user.userId,jobId);
      if(!target)return Response.json({error:"output_image_acknowledgment_unavailable"},{status:409,headers:{"cache-control":"private, no-store"}});
      const publication=await readImagePublicationState(env,target);
      if(publication==='held')return Response.json({error:"output_image_publication_incomplete"},{status:409,headers:{"cache-control":"private, no-store"}});
      if(publication==='published'){
        const acknowledged=await acknowledgeRetainedImageJob(env,user,target,project?.contextId??null);
        if("error" in acknowledged)return Response.json({error:acknowledged.error},{status:acknowledged.status,headers:{"cache-control":"private, no-store"}});
        return Response.json({job:project?safeScopedJob(acknowledged.job):serializeJob(acknowledged.job),recovered:true},{headers:{"cache-control":"private, no-store"}});
      }
      const binding=await loadOutputJobBinding(env,user,target);
      if(!binding||binding.scope.contextId!==(project?.contextId??null))return Response.json({error:"output_execution_context_changed"},{status:403,headers:{"cache-control":"private, no-store"}});
      const finalized=await finalizeRetainedImageJob(env,user,jobId,project?.contextId??null);
      if("error" in finalized)return Response.json({error:finalized.error},{status:finalized.status,headers:{"cache-control":"private, no-store"}});
      return Response.json({job:project?safeScopedJob(finalized.job):serializeJob(finalized.job),recovered:true,finalized:true},{headers:{"cache-control":"private, no-store"}});
    }
    // Keep the non-Image classification in the full-row SELECT as well: a
    // newly attached Output slot must not race this fallback into a private read.
    const ready=outputSchemaIsReady(env.DB);
    const target=await env.DB.prepare(`SELECT *${ready?",(SELECT slot.slot_id FROM output_operation_slots slot WHERE slot.job_id=document_jobs.job_id) AS output_slot_id":""}
      FROM document_jobs WHERE job_id=? AND owner_id=?${ready?" AND NOT(kind='generate' AND EXISTS(SELECT 1 FROM output_operation_slots slot WHERE slot.job_id=document_jobs.job_id))":""}`)
      .bind(jobId,user.userId).first<DocumentJobRow>();
    if(!target)return Response.json({error:"job_not_found"},{status:404});
    const recovered=await recoverRetainedPresentation(env,user,target,project?.contextId??"");
    if("error" in recovered)return Response.json({error:recovered.error,...(recovered.reason?{reason:recovered.reason}:{})},{status:recovered.status});
    await synchronizeOutputJobOutcome(env,recovered.job);
    return Response.json({job:project?safeScopedJob(recovered.job):serializeJob(recovered.job),recovered:true},{headers:{"cache-control":"private, no-store"}});
  }

  if(path.endsWith("/reconcile-provider")&&request.method==="POST"){
    const consent=requireConsent(user);if(consent)return consent;
    if(auth.impersonation)return Response.json({error:"provider_reconciliation_owner_required"},{status:403,headers:{"cache-control":"private, no-store"}});
    const jobId=decodeURIComponent(path.slice(0,-19).replace(/\/$/,""));
    const target=await readJob(env,user.userId,jobId);
    if(!target||target.owner_id!==user.userId||target.stream_id!==user.streamId)return Response.json({error:"job_not_found"},{status:404,headers:{"cache-control":"private, no-store"}});
    const original=parseResult(target);const requestPayload=parseRequest(target);
    if(isPresentationJob(target)){
      const headers={"cache-control":"private, no-store"};
      if(target.output_slot_id)return Response.json({error:"output_receipt_reconciliation_required"},{status:409,headers});
      if(!documentJobTerminal(target))return Response.json({error:"presentation_reconciliation_terminal_required"},{status:409,headers});
      const projectAuthority=documentJobProjectAuthority(user,target.document_id,target.job_id);
      const assertions:OutputSqlAssertion[]=[projectAuthority??{
        sql:`EXISTS(SELECT 1 FROM users WHERE user_id=? AND consent_version=? AND role IN('admin','creator'))
          AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='job' AND resource_id=?)`,
        bindings:[user.userId,POLICY_VERSION,target.job_id],
      },...(project?[{sql:`EXISTS(SELECT 1 FROM project_context_sessions WHERE context_id=? AND principal_user_id=? AND organization_id=? AND project_access_id=?
        AND revoked_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,bindings:[project.contextId,user.userId,project.organizationId,project.projectAccessId]}]:[])];
      const authorizedRead=async()=>{
        const rows=await env.DB.batch([...assertions.flatMap(assertion=>outputAssertionStatements(env,assertion)),
          env.DB.prepare("SELECT * FROM document_jobs WHERE job_id=? AND owner_id=? AND stream_id=? AND document_id=? AND correlation_id=?")
            .bind(target.job_id,user.userId,user.streamId,target.document_id,target.correlation_id)]);
        return rows.at(-1)?.results[0] as DocumentJobRow|undefined;
      };
      try{
        await authorizedRead();
        const outcome=await settleLegacyPresentationReservations(env,user,target,{reason:"legacy_presentation_saved_receipt_check",assertions});
        const calls=providerSubmissions(original);
        if(outcome.status==="known"){
          const fingerprint=calls.map(call=>Object.fromEntries(PAID_PROVIDER_FINANCIAL_FIELDS.filter(key=>call[key]!==undefined).map(key=>[key,call[key]])))
            .sort((left,right)=>String(left.clientRequestId).localeCompare(String(right.clientRequestId)));
          const evidenceHash=await retainedPresentationContentSha256(JSON.stringify([target.job_id,target.correlation_id,original.costReservationId,fingerprint,outcome.usedMicrousd,outcome.usedTokens]));
          const priorReconciliation=original.presentationReceiptReconciliation as Record<string,unknown>|undefined;
          if(priorReconciliation?.evidenceSha256!==evidenceHash){
            const previousReceipt=original.generationReceipt&&typeof original.generationReceipt==="object"?original.generationReceipt as Record<string,unknown>:{};
            const previousFailure=errorDetailFromResult(original);
            const resolvedFailure=previousFailure?.code==="provider_submission_uncertain"?{
              ...previousFailure,code:"execution_interrupted",category:"server",scope:"request",action:"contact_support",retryable:false,retryAfterMs:null,httpStatus:null,
              message:"The saved provider receipts and their charges are now verified. This attempt did not finish saving an output; review its retained drafts before authorizing any new generation.",
            }:previousFailure;
            const receipt={...previousReceipt,provider_request_status:target.status==="completed"?"completed":"submitted",source_transmission_status:"transmitted",provider_submission_uncertain:false,
              actual_provider_call_count:calls.length,actual_planner_call_count:calls.length,actual_media_call_count:0,unresolved_provider_call_count:0,provider_call_breakdown_complete:true,
              settled_cost_microusd:outcome.usedMicrousd,reservation_status:outcome.receipt.status,reservation_microusd:outcome.receipt.reserved_microusd,
              ...(previousFailure?.code==="provider_submission_uncertain"?{failure_code:resolvedFailure!.code,failure_category:resolvedFailure!.category,failure_stage:"application"}:{})};
            const reconciled={...original,presentationProviderSubmission:"confirmed",generationReceipt:receipt,
              ...(resolvedFailure?{errorDetail:resolvedFailure}:{}),presentationReceiptReconciliation:{version:1,evidenceSha256:evidenceHash,
                previousFailureCode:previousFailure?.code??null,providerRequestsSubmitted:0,checkedAt:now}};
            const event=makeEvent(user.streamId,0,`user:${user.userId}`,"server:presentation-receipt-check",target.correlation_id,"PresentationProviderReceiptsReconciled",{
              job_id:target.job_id,document_id:target.document_id,evidence_sha256:evidenceHash,provider_requests_submitted:0,provider_call_count:calls.length,
              used_tokens:outcome.usedTokens,used_microusd:outcome.usedMicrousd,previous_failure_code:previousFailure?.code??null,
            });
            event.eventId=`presentation-reconciliation-${evidenceHash}`;
            const bindings=eventWriteBindings(event);
            try{
              await env.DB.batch([...assertions.flatMap(assertion=>outputAssertionStatements(env,assertion)),
                env.DB.prepare(`UPDATE document_jobs SET result_json=?,error_message=?,updated_at=? WHERE job_id=? AND owner_id=? AND stream_id=?
                  AND correlation_id=? AND status=? AND request_json IS ? AND result_json IS ?`)
                  .bind(JSON.stringify(reconciled),resolvedFailure?.message??target.error_message,now,target.job_id,user.userId,user.streamId,target.correlation_id,target.status,target.request_json,target.result_json),
                ...outputAssertionStatements(env,{sql:"changes()=1"}),
                env.DB.prepare(`INSERT INTO event_write_stage (${EVENT_WRITE_COLUMNS}) SELECT ?,?,COALESCE((SELECT MAX(sequence) FROM events WHERE stream_id=?),0)+1,${Array(14).fill("?").join(",")}`)
                  .bind(...bindings.slice(0,2),user.streamId,...bindings.slice(3)),...outputAssertionStatements(env,{sql:"changes()=1"})]);
            }catch{
              const latest=await authorizedRead();
              if(!latest||(parseResult(latest).presentationReceiptReconciliation as Record<string,unknown>|undefined)?.evidenceSha256!==evidenceHash
                ||!await env.DB.prepare("SELECT 1 AS present FROM events WHERE event_id=? AND stream_id=? AND correlation_id=?").bind(event.eventId,user.streamId,target.correlation_id).first())
                return Response.json({error:"presentation_reconciliation_conflict"},{status:409,headers});
            }
          }
        }
        const final=await authorizedRead();
        if(!final)return Response.json({error:"job_not_found"},{status:404,headers});
        const checkpoint=parseResult(final),detail=errorDetailFromResult(checkpoint),summary=generationExecutionSummary(checkpoint,detail);
        const monetaryKeys=new Set(["artifact_kind","provider","model","actual_provider_call_count","actual_planner_call_count","actual_media_call_count","unresolved_provider_call_count","provider_submission_uncertain","provider_call_breakdown_complete","execution_evidence_version","reservation_microusd","settled_cost_microusd","reservation_status","source_transmission_status","provider_request_status","failure_code","failure_category","failure_stage"]);
        const safeReceipt=Object.fromEntries(Object.entries(summary).filter(([key])=>monetaryKeys.has(key)));
        const safeDetail=detail?{code:detail.code,category:detail.category,scope:detail.scope,action:detail.action,retryable:false,retryAfterMs:null,
          requestId:detail.requestId,httpStatus:detail.httpStatus,
          message:outcome.status==="known"?"The saved request receipts and charges are verified. Review the retained draft before any new generation.":"The exact paid request evidence is incomplete. The original reservation remains held; ask support to inspect the original provider request records.",
          ...(detail.validationIssues?{validationIssues:detail.validationIssues.flatMap(issue=>safePresentationCandidateIssues([issue],{
            pageIndex:Number.isSafeInteger(issue.pageIndex)?issue.pageIndex:0,pageCount:Number.isSafeInteger(issue.pageCount)&&issue.pageCount>0?issue.pageCount:1,
            globalStartIndex:0,providerAttempt:Number.isSafeInteger(issue.providerAttempt)&&issue.providerAttempt>0?issue.providerAttempt:1,stage:issue.stage==="repair"?"repair":"initial",
          }))}:{})}:null;
        const presentation=outcome.status==="known"?(await freshlyRecoverablePresentationRows(env,user,[final],project?.contextId??""))[0]!:final;
        const visible=serializeJob(presentation);
        await authorizedRead();
        const reconciliation=outcome.status==="known"?{status:"known",settled:outcome.settled,auditRepaired:outcome.auditRepaired,usedTokens:outcome.usedTokens,usedMicrousd:outcome.usedMicrousd}
          :{status:"operator_required",reason:outcome.reason,reservationRetained:true,
            operatorAction:"Inspect the original provider request and billing records using the attempt and client trace IDs. A retained initial response does not verify a later repair, and a client trace ID is not guaranteed provider idempotency. Do not resubmit an unknown request.",
            attemptCorrelationId:target.correlation_id,currentClientRequestId:typeof original.presentationProviderClientRequestId==="string"?original.presentationProviderClientRequestId:null,
            requests:calls.map(call=>({clientRequestId:call.clientRequestId,unitId:call.unitId??null,model:call.model,status:call.status,submittedAt:call.submittedAt??null,providerResponseId:call.providerRequestId??null,httpRequestId:call.httpRequestId??null}))};
        return Response.json({job:{...visible,members:[],moderationPromptRef:null,progressMessage:safeDetail?.message??"Saved provider receipt check complete.",
          result:{artifactKind:"slides",generationReceipt:safeReceipt,stage:final.status,
            recoverablePresentationCandidate:outcome.status==="known"&&visible.result?.recoverablePresentationCandidate===true},errorDetail:safeDetail,error:safeDetail?.code??null},
          reconciliation:{...reconciliation,jobId:target.job_id,documentId:target.document_id,providerRequestsSubmitted:0}},{headers});
      }catch(error){
        if(String(error).includes("constraint failed"))return Response.json({error:"presentation_reconciliation_authority_changed"},{status:403,headers});
        throw error;
      }
    }
    if(project&&project.ownerUserId!==principal.userId)return Response.json({error:"provider_reconciliation_owner_required"},{status:403,headers:{"cache-control":"private, no-store"}});
    const requestedAt=typeof original.storyboardProviderRequestedAt==="string"?Date.parse(original.storyboardProviderRequestedAt):NaN;
    const tokenReservationId=String(original.reservationId??"");const costReservationId=String(original.costReservationId??"");
    if(target.kind!=="render_document"||target.status!=="failed"||requestPayload.artifactKind!=="storyboard"||requestPayload.productionMode!=="manual"||requestPayload.paidMediaConfirmed!==true||original.storyboardProviderSubmission!=="pending"||original.providerJobId||!original.artifactPlan||!Number.isFinite(requestedAt)||!tokenReservationId||!costReservationId)return Response.json({error:"provider_reconciliation_unavailable",message:"Only an unresolved owner-approved storyboard frame with its original private provider checkpoint can be reconciled."},{status:409,headers:{"cache-control":"private, no-store"}});
    if(!env.FAL_KEY?.trim())return Response.json({error:"provider_reconciliation_unavailable",message:"The original image provider is not configured for a read-only receipt lookup."},{status:503,headers:{"cache-control":"private, no-store"}});
    const billingOwnerId=user.billingUserId??user.userId;
    const owned=await env.DB.prepare("SELECT token.reservation_id AS token_reservation_id,cost.reservation_id AS cost_reservation_id,cost.period AS period FROM budget_reservations token JOIN cost_budget_reservations cost ON cost.owner_id=token.owner_id AND cost.stream_id=token.stream_id AND cost.correlation_id=token.correlation_id AND cost.operation=token.operation AND cost.period=token.period WHERE token.reservation_id=? AND cost.reservation_id=? AND token.owner_id=? AND token.stream_id=? AND token.correlation_id=? AND token.operation='document-render:storyboard' AND token.status='active' AND cost.status='executing'")
      .bind(tokenReservationId,costReservationId,billingOwnerId,user.streamId,target.correlation_id).first<{token_reservation_id:string;cost_reservation_id:string;period:string}>();
    if(!owned||original.costReservationPeriod&&owned.period!==String(original.costReservationPeriod))return Response.json({error:"storyboard_recovery_reservations_unavailable",message:"The original owner-scoped storyboard reservations cannot be verified."},{status:409,headers:{"cache-control":"private, no-store"}});
    let promptRef=typeof original.moderationPromptRef==="string"?original.moderationPromptRef:"";
    if(!promptRef){const event=await env.DB.prepare("SELECT json_extract(payload,'$.prompt_ref') AS prompt_ref FROM events WHERE stream_id=? AND correlation_id=? AND type='DocumentRenderFailed' AND json_extract(payload,'$.document_id')=? AND json_extract(payload,'$.artifact_kind')='storyboard' ORDER BY sequence DESC LIMIT 1").bind(user.streamId,target.correlation_id,target.document_id).first<{prompt_ref:string|null}>();promptRef=String(event?.prompt_ref??"");}
    if(!promptRef)return Response.json({error:"provider_receipt_evidence_unavailable",message:"The exact original provider prompt is no longer privately available."},{status:409,headers:{"cache-control":"private, no-store"}});
    const containment=project?" AND EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.resource_kind='content' AND resource.resource_id=private_content.content_id AND resource.project_access_id=? AND resource.organization_id=? AND resource.project_id=? AND resource.owner_user_id=? AND resource.actor_user_id=? AND resource.visibility='actor_private')":" AND NOT EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.resource_kind='content' AND resource.resource_id=private_content.content_id)";
    const prompt=await env.DB.prepare(`SELECT content FROM private_content WHERE content_id=? AND owner_id=? AND kind='prompt' AND redacted_at IS NULL AND expires_at>?${containment}`)
      .bind(promptRef,user.userId,now,...(project?[project.projectAccessId,project.organizationId,project.projectId,project.ownerUserId,user.userId]:[])).first<{content:string}>();
    if(!prompt||typeof prompt.content!=="string"||!prompt.content)return Response.json({error:"provider_receipt_evidence_unavailable",message:"The exact original provider prompt is no longer privately available."},{status:409,headers:{"cache-control":"private, no-store"}});
    const pendingSubmissions=providerSubmissions(original).filter((entry)=>entry.status==="pending");
    const pending=pendingSubmissions[0];
    const usesSubmissionEvidence=original.providerSubmissionProtocol===1||Object.hasOwn(original,"providerSubmissions");
    if(usesSubmissionEvidence&&(pendingSubmissions.length!==1||pending?.provider!=="fal"||pending.operation!=="image"||pending.unitId!==`frame:${(Array.isArray(original.renderedItems)?original.renderedItems.length:0)+1}`||hasUnresolvedProviderSubmission({...original,providerSubmissions:{...(original.providerSubmissions as Record<string,unknown>),[pending.clientRequestId]:{...pending,status:"accepted"}}})))return Response.json({error:"provider_receipt_evidence_unavailable",message:"The exact unresolved frame submission cannot be uniquely verified. The original reservation remains protected."},{status:409,headers:{"cache-control":"private, no-store"}});
    const model=usesSubmissionEvidence?pending.model:String(env.FAL_IMAGE_PREVIEW_MODEL??"ideogram/v4/fast");
    const historyUrl=new URL("https://api.fal.ai/v1/models/requests/by-endpoint");
    historyUrl.searchParams.set("endpoint_id",model);historyUrl.searchParams.set("start",new Date(requestedAt-120_000).toISOString());historyUrl.searchParams.set("limit","25");historyUrl.searchParams.set("expand","payloads");
    let history:unknown;
    try{const response=await fetch(historyUrl.toString(),{method:"GET",headers:{authorization:`Key ${env.FAL_KEY}`},redirect:"manual"});if(!response.ok)return Response.json({error:"provider_receipt_lookup_failed",providerStatus:response.status,message:"The provider could not confirm its request history. The original reservation remains protected."},{status:502,headers:{"cache-control":"private, no-store"}});history=await response.json();}
    catch(error){const candidateClass=error instanceof Error?error.constructor.name:"UnknownError";const providerErrorClass=/^[A-Za-z][A-Za-z0-9]{0,39}$/u.test(candidateClass)?candidateClass:"UnknownError";const directCode=error&&typeof error==="object"&&"code" in error?(error as {code?:unknown}).code:null;const cause=error&&typeof error==="object"&&"cause" in error?(error as {cause?:unknown}).cause:null;const candidateCode=typeof directCode==="string"?directCode:cause&&typeof cause==="object"&&"code" in cause?(cause as {code?:unknown}).code:null;const detail=[error instanceof Error?error.message:"",cause instanceof Error?cause.message:""].join(" ");const classified=/redirect/iu.test(detail)?"REDIRECT_UNSUPPORTED":/(?:request context|outside.{0,20}request|hanging promise|illegal invocation)/iu.test(detail)?"REQUEST_CONTEXT":/(?:outbound|egress|network access|disallowed|blocked|not allowed)/iu.test(detail)?"EGRESS_BLOCKED":/(?:tls|ssl|certificate)/iu.test(detail)?"TLS_FAILURE":/(?:fetch failed|network|connection|socket|dns)/iu.test(detail)?"NETWORK_FETCH_FAILED":/(?:invalid|unsupported)/iu.test(detail)?"INVALID_REQUEST":"UNKNOWN_FETCH";const providerErrorCode=typeof candidateCode==="string"&&/^[A-Z0-9_]{1,60}$/u.test(candidateCode)?candidateCode:classified;return Response.json({error:"provider_receipt_lookup_failed",providerErrorClass,providerErrorCode,message:"The provider could not confirm its request history. The original reservation remains protected."},{status:502,headers:{"cache-control":"private, no-store"}});}
    const items=history&&typeof history==="object"&&Array.isArray((history as Record<string,unknown>).items)?(history as {items:unknown[]}).items.slice(0,25):[];
    const expectedHash=await retainedPresentationContentSha256(prompt.content);
    const matches:Array<{requestId:string;sentAt:string}>=[];
    for(const entry of items){
      if(!entry||typeof entry!=="object"||Array.isArray(entry))continue;
      const item=entry as Record<string,unknown>;const payload=item.json_input&&typeof item.json_input==="object"&&!Array.isArray(item.json_input)?item.json_input as Record<string,unknown>:null;
      const sentAt=typeof item.sent_at==="string"?Date.parse(item.sent_at):NaN;const statusCode=Number(item.status_code);
      if(item.endpoint_id!==model||!Number.isFinite(sentAt)||Math.abs(sentAt-requestedAt)>120_000||!Number.isSafeInteger(statusCode)||statusCode<200||statusCode>=300||typeof payload?.prompt!=="string"||await retainedPresentationContentSha256(payload.prompt)!==expectedHash)continue;
      const requestId=typeof item.request_id==="string"?item.request_id:"";
      try{falImageProviderReceipt(model,requestId);}catch{continue;}
      if(providerSubmissions(original).some((entry)=>entry.provider==="fal"&&entry.providerRequestId===requestId&&entry.clientRequestId!==pending?.clientRequestId)||(Array.isArray(original.renderedItems)?original.renderedItems:[]).some((frame)=>frame&&typeof frame==="object"&&(frame as Record<string,unknown>).provider_request_id===requestId))continue;
      matches.push({requestId,sentAt:new Date(sentAt).toISOString()});
    }
    if(matches.length!==1)return Response.json({error:matches.length?"provider_receipt_ambiguous":"provider_receipt_not_found",message:matches.length?"More than one provider request matches this storyboard frame. The original reservation remains protected.":"The provider has not confirmed one uniquely matching storyboard frame. The original reservation remains protected."},{status:409,headers:{"cache-control":"private, no-store"}});
    const match=matches[0]!;const receipt=falImageProviderReceipt(model,match.requestId);
    const submissionPatch=usesSubmissionEvidence?{providerSubmissions:mergeProviderSubmissions(original.providerSubmissions,{[pending.clientRequestId]:{...pending,status:"accepted",providerRequestId:receipt.providerRequestId}})}:{};
    const errorDetail:ProviderFailureDetail={code:"execution_interrupted",category:"network",scope:"network",action:"retry",message:"The original paid storyboard request was verified. Resume its existing provider result without submitting another paid frame.",retryable:true,retryAfterMs:null,requestId:receipt.providerRequestId,httpStatus:null};
    const previousReceipt=original.generationReceipt&&typeof original.generationReceipt==="object"&&!Array.isArray(original.generationReceipt)?original.generationReceipt as Record<string,unknown>:{};
    const result={...original,...submissionPatch,storyboardProviderSubmission:"confirmed",provider:"fal",providerJobId:receipt.providerRequestId,providerModel:receipt.model,providerStatusUrl:receipt.providerStatusUrl,providerResponseUrl:receipt.providerResponseUrl,providerCancelUrl:receipt.providerCancelUrl,storyboardProviderAcceptedAt:match.sentAt,errorDetail,stage:"failed",progressMessage:errorDetail.message,generationReceipt:{...previousReceipt,provider:"fal",model:receipt.model,provider_request_status:"submitted",source_transmission_status:"transmitted",settled_cost_microusd:Number(previousReceipt.settled_cost_microusd??0)>0?previousReceipt.settled_cost_microusd:null,reservation_status:"executing",failure_code:errorDetail.code,failure_category:errorDetail.category,failure_stage:"provider"}};
    const updated=await env.DB.prepare("UPDATE document_jobs SET result_json=?,error_message=?,updated_at=? WHERE job_id=? AND owner_id=? AND stream_id=? AND correlation_id=? AND result_json IS ? AND status='failed' AND json_extract(COALESCE(result_json,'{}'),'$.storyboardProviderSubmission')='pending' AND COALESCE(json_extract(COALESCE(result_json,'{}'),'$.providerJobId'),'')='' AND EXISTS(SELECT 1 FROM budget_reservations token JOIN cost_budget_reservations cost ON cost.owner_id=token.owner_id AND cost.stream_id=token.stream_id AND cost.correlation_id=token.correlation_id AND cost.operation=token.operation AND cost.period=token.period WHERE token.reservation_id=? AND cost.reservation_id=? AND token.owner_id=? AND token.stream_id=document_jobs.stream_id AND token.correlation_id=document_jobs.correlation_id AND token.operation='document-render:storyboard' AND token.status='active' AND cost.status='executing')")
      .bind(JSON.stringify(result),errorDetail.message,now,jobId,user.userId,user.streamId,target.correlation_id,target.result_json,tokenReservationId,costReservationId,billingOwnerId).run();
    if(Number(updated.meta.changes??0)!==1)return Response.json({error:"job_reconciliation_conflict"},{status:409,headers:{"cache-control":"private, no-store"}});
    const reconciled=await readJob(env,user.userId,jobId);
    return Response.json({job:project?safeScopedJob(reconciled!):serializeJob(reconciled!),reconciledProviderRequest:true},{headers:{"cache-control":"private, no-store"}});
  }

  if(path.endsWith("/continue-safer-frames")&&request.method==="POST"){
    const consent=requireConsent(user);if(consent)return consent;
    if(auth.impersonation||project&&project.ownerUserId!==principal.userId)return Response.json({error:"storyboard_continuation_owner_required"},{status:403,headers:{"cache-control":"private, no-store"}});
    const jobId=decodeURIComponent(path.slice(0,-22).replace(/\/$/,""));const target=await readJob(env,user.userId,jobId);
    if(!target||target.owner_id!==user.userId||target.stream_id!==user.streamId||!(Date.parse(target.expires_at)>Date.now()))return Response.json({error:"job_not_found"},{status:404,headers:{"cache-control":"private, no-store"}});
    // Legacy one-click recovery did not bind reviewed replacement directions,
    // per-frame source lineage, or mixed-model receipts. Do not consume its
    // one-shot marker, clear rejection evidence, hand off holds, or queue work.
    return Response.json({error:"storyboard_revised_direction_approval_required",message:"Automatic continuation is unavailable. Inspect the saved frames and original plan before approving revised work. No provider request was made and the existing budget hold is unchanged."},{status:409,headers:{"cache-control":"private, no-store"}});
  }

  if (path.endsWith("/retry") && request.method === "POST") {
    const jobId = decodeURIComponent(path.slice(0, -6).replace(/\/$/, "")); const target = await readJob(env, user.userId, jobId);
    if (!target) return Response.json({ error: "job_not_found" }, { status: 404 });
    if(originalSourceAudioRecoveryRequested(target)){
      const consent=requireConsent(user);if(consent)return consent;
      const scope=user.projectExecution;
      const recovered=await recoverOriginalSourceAudio(env,user,target,project?.contextId??"",{
        projectGuard:scope?{sql:activeProjectExecutionSql,bindings:[...projectExecutionBindings(scope,target.document_id)]}:{sql:"1",bindings:[]},
        run:(row,operation)=>runWithHeartbeat(env,row,user,operation),
      });
      if("error" in recovered)return Response.json({...recovered,message:"The original paid audio could not be verified for recovery. No new generation or charge was requested."},{status:recovered.status,headers:{"cache-control":"private, no-store"}});
      return Response.json({job:project?safeScopedJob(recovered.job):serializeJob(recovered.job),reusedProviderRequest:true,recoveredOriginalSource:true,incrementalCostMicrousd:0},{headers:{"cache-control":"private, no-store"}});
    }
    const previous=parseResult(target);
    const billingOwnerId=user.billingUserId??user.userId;
    const previousCostReservationId=String(previous.costReservationId??"");
    const previousCostReservation=previousCostReservationId?await costBudgetReservation(env,billingOwnerId,previousCostReservationId):null;
    const previousAttemptCorrelation=target.attempt_count>1?`${jobId}:attempt:${target.attempt_count-1}`:"";
    const correlations=[...new Set([target.correlation_id,previousCostReservation?.correlation_id??"",previousAttemptCorrelation].filter(Boolean))];
    const retainedEvents=await readCorrelatedEvents(env,user.streamId,correlations);
    const currentEvents=retainedEvents.filter((event)=>event.correlationId === target.correlation_id);
    const correlated=[...currentEvents,...retainedEvents.filter((event)=>event.correlationId!==target.correlation_id)];
    const failure=errorDetailFromResult(previous)??correlatedFailureDetail(correlated);
    const failedEvent = [...correlated].reverse().find((event) => event.type === "DocumentRenderFailed" && event.payload.provider_job_id);
    const requestedEvent = correlated.find((event) => event.type === "DocumentRenderRequested");
    const providerJobId = String(previous.providerJobId ?? model3dRecoveryProviderReceipt(previous)?.providerJobId ?? failedEvent?.payload.provider_job_id ?? "");
    const artifactId = String(previous.artifactId ?? failedEvent?.payload.artifact_id ?? requestedEvent?.payload.artifact_id ?? "");
    const requestPayload = parseRequest(target); const artifactKind = String(requestPayload.artifactKind ?? failedEvent?.payload.artifact_kind ?? "");
    const unsafe=unsafePaidRecovery({...target,result_json:JSON.stringify({...previous,...(providerJobId?{providerJobId}:{})})});if(unsafe)return Response.json({error:unsafe.code,errorDetail:publicFailureDetail(unsafe),message:unsafe.message},{status:409});
    if((artifactKind==="storyboard"||artifactKind==="video"||artifactKind==="audio"||artifactKind==="model3d")&&requestPayload.paidMediaConfirmed!==true)return Response.json({error:"paid_media_confirmation_required",message:"Confirm paid media generation before recovering this render."},{status:428});
    const sceneReceipts=previous.productionSceneReceipts&&typeof previous.productionSceneReceipts==="object"?Object.values(previous.productionSceneReceipts as Record<string,Record<string,unknown>>):[];
    const prepaidSceneIds=sceneReceipts.filter((scene)=>Boolean(scene.providerJobId)&&(scene.status==="submitted"||scene.status==="completed")).map((scene)=>String(scene.sceneId)).filter(Boolean);
    const managedRecovery=prepaidSceneIds.length>0;
    if(!documentJobCanRecoverProviderRender({...serializeJob(target),result:{...previous,...(artifactKind==="model3d"?model3dRecoveryProviderReceipt(previous)??{}:{}),providerJobId,artifactKind,recoverableProductionProviderRequest:managedRecovery},errorDetail:failure}))return Response.json({error:"provider_job_not_retryable",message:"This provider request reached a terminal failure and cannot be resumed. Review the saved inputs and start a changed render.",...(failure?{errorDetail:publicFailureDetail({...failure,probe:failure.probe??undefined})}:{})},{status:409});
    if (target.kind !== "render_document" || target.status !== "failed" || (!providerJobId&&!managedRecovery) || !artifactId) return Response.json({ error: "resumable_provider_job_required" }, { status: 409 });
    if(artifactKind==="model3d"){
      const providerReceipt=model3dRecoveryProviderReceipt(previous);
      if(!providerReceipt||!previous.model3dInputReceipt)return Response.json({error:"model3d_recovery_checkpoint_unavailable",message:"This 3D model has no complete retained provider input and acceptance receipt. No replacement request will be purchased."},{status:409});
      const guard=model3dRecoveryReservationGuard(user,target,previous);
      if(!await env.DB.prepare(`SELECT 1 WHERE ${guard.sql}`).bind(...(guard.bindings??[])).first())return Response.json({error:"model3d_recovery_reservations_unavailable",message:"The original 3D model reservation or its completed payment cannot be verified."},{status:409});
      const result:Record<string,unknown>={...previous,...providerReceipt,artifactId,stage:"queued",progressMessage:"Retrieving the saved 3D model under its original payment. No new generation will be submitted."};
      delete result.errorDetail;delete result.dismissedAt;
      const updated=await env.DB.prepare(`UPDATE document_jobs SET status='queued',result_json=?,error_message=NULL,completed_at=NULL,lease_expires_at=NULL,notified_at=NULL,updated_at=? WHERE job_id=? AND owner_id=? AND stream_id=? AND correlation_id=? AND status='failed' AND result_json IS ? AND ${guard.sql}`)
        .bind(JSON.stringify(result),now,jobId,user.userId,user.streamId,target.correlation_id,target.result_json,...(guard.bindings??[])).run();
      if(Number(updated.meta.changes??0)!==1)return Response.json({error:"job_retry_conflict"},{status:409});
      const queued=await readJob(env,user.userId,jobId);
      return Response.json({job:project?safeScopedJob(queued!):serializeJob(queued!),reusedProviderRequest:true,reusedReservations:true},{status:202,headers:{"cache-control":"private, no-store"}});
    }
    if(artifactKind!=="storyboard"&&hasUnsettledProviderSubmission(previous)){
      const tokenReservationId=String(previous.reservationId??"");
      const owned=await env.DB.prepare("SELECT cost.period FROM budget_reservations token JOIN cost_budget_reservations cost ON cost.owner_id=token.owner_id AND cost.stream_id=token.stream_id AND cost.correlation_id=token.correlation_id AND cost.operation=token.operation AND cost.period=token.period WHERE token.reservation_id=? AND cost.reservation_id=? AND token.owner_id=? AND token.stream_id=? AND token.correlation_id=? AND token.operation=? AND token.status='active' AND cost.status IN('active','executing')")
        .bind(tokenReservationId,previousCostReservationId,billingOwnerId,user.streamId,target.correlation_id,`document-render:${artifactKind}`).first<{period:string}>();
      if(!owned||!previous.artifactPlan||previous.costReservationPeriod&&owned.period!==String(previous.costReservationPeriod))return Response.json({error:"provider_recovery_reservations_unavailable",message:"The original paid request and its owner-scoped reservations cannot be safely resumed."},{status:409});
      const result:Record<string,unknown>={...previous,stage:"queued",progressMessage:"Resuming the saved provider requests under their original reserved budget."};
      delete result.errorDetail;delete result.dismissedAt;
      const updated=await env.DB.prepare(`UPDATE document_jobs SET status='queued',result_json=?,error_message=NULL,completed_at=NULL,lease_expires_at=NULL,notified_at=NULL,updated_at=? WHERE job_id=? AND owner_id=? AND stream_id=? AND correlation_id=? AND status='failed' AND NOT (${unresolvedProviderSubmissionSql()})`)
        .bind(JSON.stringify(result),now,jobId,user.userId,user.streamId,target.correlation_id).run();
      if(Number(updated.meta.changes??0)!==1)return Response.json({error:"job_retry_conflict"},{status:409});
      const queued=await readJob(env,user.userId,jobId);
      return Response.json({job:project?safeScopedJob(queued!):serializeJob(queued!),reusedProviderRequest:true,reusedReservations:true},{status:202});
    }
    if(artifactKind==="storyboard"){
      const tokenReservationId=String(previous.reservationId??"");
      if(previous.storyboardProviderSubmission!=="confirmed"||String(previous.providerJobId??"")!==providerJobId||!previous.artifactPlan||!tokenReservationId||!previousCostReservationId
        ||!String(previous.providerModel??"")||!String(previous.providerStatusUrl??"")||!String(previous.providerResponseUrl??"")||!String(previous.providerCancelUrl??"")){
        return Response.json({error:"storyboard_recovery_checkpoint_unavailable",message:"This storyboard frame has no complete, owner-owned provider receipt and cannot be safely resubmitted."},{status:409});
      }
      const operation="document-render:storyboard";
      const owned=await env.DB.prepare("SELECT token.reservation_id AS token_reservation_id,cost.reservation_id AS cost_reservation_id,cost.period AS period,cost.status AS cost_status FROM budget_reservations token JOIN cost_budget_reservations cost ON cost.owner_id=token.owner_id AND cost.stream_id=token.stream_id AND cost.correlation_id=token.correlation_id AND cost.operation=token.operation AND cost.period=token.period WHERE token.reservation_id=? AND cost.reservation_id=? AND token.owner_id=? AND token.stream_id=? AND token.correlation_id=? AND token.operation=? AND token.status='active' AND cost.status IN('active','executing')")
        .bind(tokenReservationId,previousCostReservationId,billingOwnerId,user.streamId,target.correlation_id,operation).first<{token_reservation_id:string;cost_reservation_id:string;period:string;cost_status:string}>();
      if(!owned||previous.costReservationPeriod&&owned.period!==String(previous.costReservationPeriod))return Response.json({error:"storyboard_recovery_reservations_unavailable",message:"The original owner-scoped storyboard reservations are unavailable. Starting another paid provider request would be unsafe."},{status:409});
      const priorReceipt=previous.generationReceipt&&typeof previous.generationReceipt==="object"&&!Array.isArray(previous.generationReceipt)?previous.generationReceipt as Record<string,unknown>:{};
      const result:Record<string,unknown>={...previous,artifactId,providerJobId,storyboardProviderSubmission:"confirmed",stage:"queued",progressMessage:"Resuming the accepted storyboard frame without submitting another paid provider request.",generationReceipt:{...priorReceipt,provider:"fal",model:String(previous.providerModel),provider_request_status:"submitted",source_transmission_status:"transmitted",settled_cost_microusd:Number(priorReceipt.settled_cost_microusd??0)>0?priorReceipt.settled_cost_microusd:null,reservation_status:owned.cost_status}};
      delete result.errorDetail;delete result.dismissedAt;
      const updated=await env.DB.prepare("UPDATE document_jobs SET status='queued',result_json=?,error_message=NULL,completed_at=NULL,lease_expires_at=NULL,notified_at=NULL,updated_at=? WHERE job_id=? AND owner_id=? AND stream_id=? AND correlation_id=? AND status='failed' AND json_extract(COALESCE(result_json,'{}'),'$.storyboardProviderSubmission')='confirmed' AND json_extract(COALESCE(result_json,'{}'),'$.providerJobId')=? AND EXISTS(SELECT 1 FROM budget_reservations token JOIN cost_budget_reservations cost ON cost.owner_id=token.owner_id AND cost.stream_id=token.stream_id AND cost.correlation_id=token.correlation_id AND cost.operation=token.operation AND cost.period=token.period WHERE token.reservation_id=? AND cost.reservation_id=? AND token.owner_id=? AND token.stream_id=document_jobs.stream_id AND token.correlation_id=document_jobs.correlation_id AND token.operation='document-render:storyboard' AND token.status='active' AND cost.status IN('active','executing'))")
        .bind(JSON.stringify(result),now,jobId,user.userId,user.streamId,target.correlation_id,providerJobId,tokenReservationId,previousCostReservationId,billingOwnerId).run();
      if(Number(updated.meta.changes??0)!==1)return Response.json({error:"job_retry_conflict"},{status:409});
      const queued=await readJob(env,user.userId,jobId);context?.waitUntil(driveDocumentQueue(env,user));
      return Response.json({job:project?safeScopedJob(queued!):serializeJob(queued!),reusedProviderRequest:true,reusedReservations:true},{status:202,headers:{"cache-control":"private, no-store"}});
    }
    const accountingCheckpoint=!managedRecovery&&providerJobId?{...previous,providerJobId}:previous;
    const documentedUsage=interruptedDocumentJobUsage(accountingCheckpoint,requestPayload,{plannerAlreadyRecorded:true});
    const documentedProviderCost=documentedUsage.sceneCostMicrousd+documentedUsage.anchorCostMicrousd+documentedUsage.singleVideoCostMicrousd+documentedUsage.singleAudioCostMicrousd;
    const fullPlannerCost=interruptedDocumentJobUsage(accountingCheckpoint,requestPayload).plannerCostMicrousd;
    const plannerResponseId=String(accountingCheckpoint.plannerResponseId??"");
    const plannerReceiptRows=plannerResponseId?await env.DB.prepare("SELECT payload FROM events WHERE stream_id=? AND type='GenerationUsageRecorded' AND json_extract(payload,'$.planner_response_id')=? AND COALESCE(json_extract(payload,'$.cost_reservation_id'),'')<>'' AND json_extract(payload,'$.cost_reservation_id')<>?")
      .bind(user.streamId,plannerResponseId,previousCostReservationId).all<{payload:string}>():{results:[]};
    const verifiedPlannerReceipts=[] as Array<{payload:Record<string,unknown>}>;
    for(const receipt of plannerReceiptRows.results){
      let payload:Record<string,unknown>;
      try{payload=JSON.parse(receipt.payload) as Record<string,unknown>;}catch{continue;}
      const reservation=await costBudgetReservation(env,billingOwnerId,String(payload.cost_reservation_id??""));
      if(reservation&&reservation.status==="settled"&&reservation.stream_id===user.streamId&&reservation.operation===`document-render:${artifactKind}`
        &&(reservation.correlation_id===jobId||reservation.correlation_id===target.correlation_id||reservation.correlation_id.startsWith(`${jobId}:attempt:`)))verifiedPlannerReceipts.push({payload});
    }
    const outsidePlannerCost=Math.min(fullPlannerCost,recordedDocumentPlannerUsage(verifiedPlannerReceipts,plannerResponseId,fullPlannerCost).recordedCostMicrousd);
    const requiredProviderCoverage=documentedProviderCost+Math.max(0,fullPlannerCost-outsidePlannerCost);
    const ownedPreviousCostReservation=previousCostReservation
      &&previousCostReservation.stream_id===user.streamId
      &&previousCostReservation.operation===`document-render:${artifactKind}`
      &&(previousCostReservation.correlation_id===target.correlation_id||previousCostReservation.correlation_id.startsWith(`${jobId}:attempt:`))
      &&(!previous.costReservationPeriod||previousCostReservation.period===String(previous.costReservationPeriod))
      ?previousCostReservation:null;
    let newlyPrepaidProviderCost=0;
    let paidProviderWorkSettled=false;
    let accountedReservationCost=0;
    if(ownedPreviousCostReservation&&(ownedPreviousCostReservation.status==="active"||ownedPreviousCostReservation.status==="executing")){
      const settlement=await settleInterruptedDocumentJobReservations(env,user,{...target,result_json:JSON.stringify(accountingCheckpoint)},{costReservationId:previousCostReservationId,reason:"document_render_manual_recovery"});
      accountedReservationCost=settlement.settled?settlement.usedMicrousd:0;
      paidProviderWorkSettled=settlement.settled&&documentedProviderCost>0&&settlement.usedMicrousd>=requiredProviderCoverage;
    }else if(ownedPreviousCostReservation?.status==="settled"){
      accountedReservationCost=Number(ownedPreviousCostReservation.used_microusd??0);
      paidProviderWorkSettled=documentedProviderCost>0&&accountedReservationCost>=requiredProviderCoverage;
    }
    const accountedProviderCost=Math.max(0,accountedReservationCost-Math.max(0,fullPlannerCost-outsidePlannerCost));
    if(accountedProviderCost>0&&accountedProviderCost<documentedProviderCost)return Response.json({
      error:"provider_charge_settlement_incomplete",
      message:"This provider request was only partially settled. Recovering it would charge the same provider work twice.",
      accountedProviderCostMicrousd:accountedProviderCost,
      documentedProviderCostMicrousd:documentedProviderCost,
    },{status:409});
    if(paidProviderWorkSettled&&!managedRecovery)newlyPrepaidProviderCost=documentedUsage.singleVideoCostMicrousd+documentedUsage.singleAudioCostMicrousd;
    const retainedPrepaidSceneIds=Array.isArray(previous.productionPrepaidSceneIds)?previous.productionPrepaidSceneIds.map(String):[];
    const confirmedPrepaidSceneIds=[...new Set([...retainedPrepaidSceneIds,...(paidProviderWorkSettled?prepaidSceneIds:[])])];
    const providerModel = String(previous.providerModel ?? (artifactKind === "video" ? env.FAL_REFERENCE_VIDEO_MODEL ?? DEFAULT_REFERENCE_VIDEO_MODEL : ""));
    const result:Record<string,unknown> = { ...previous, artifactId, ...(managedRecovery?{...(confirmedPrepaidSceneIds.length?{productionPrepaidSceneIds:confirmedPrepaidSceneIds}:{}),...(paidProviderWorkSettled&&previous.productionAnchor?{productionPrepaidAnchor:true}:{}),recoverableProductionProviderRequest:true}:{providerJobId,providerModel}),...(newlyPrepaidProviderCost?{prepaidProviderCostMicrousd:Number(previous.prepaidProviderCostMicrousd??0)+newlyPrepaidProviderCost}:{}), stage: "queued", progressMessage: managedRecovery?"Recovering saved production scenes without submitting already-paid Fal requests again.":"Recovering the saved Fal render without submitting a second paid video." };delete result.errorDetail;delete result.dismissedAt;delete result.reservationId;delete result.costReservationMicrousd;delete result.costReservationId;delete result.costReservationPeriod;
    const updated = await env.DB.prepare("UPDATE document_jobs SET status='queued',correlation_id=?,result_json=?,error_message=NULL,completed_at=NULL,lease_expires_at=NULL,notified_at=NULL,updated_at=? WHERE job_id=? AND owner_id=? AND status='failed'").bind(jobId, JSON.stringify(result), now, jobId, user.userId).run();
    if (Number(updated.meta.changes ?? 0) !== 1) return Response.json({ error: "job_retry_conflict" }, { status: 409 });
    const queued=await readJob(env,user.userId,jobId);context?.waitUntil(driveDocumentQueue(env,user));return Response.json({job:project?safeScopedJob(queued!):serializeJob(queued!),reusedProviderRequest:true},{status:202});
  }

  if (path.endsWith("/run") && request.method === "POST") {
    const consent = requireConsent(user); if (consent) return consent;
    const jobId=decodeURIComponent(path.slice(0,-4).replace(/\/$/,""));const existing=verifiedPathJob??await readJob(env,user.userId,jobId);
    if (!existing) return Response.json({ error: "job_not_found" }, { status: 404 });
    if (existing.kind === "prompt_fan") {
      const job = await reconcilePromptFanParent(env, user.userId, jobId); if (!job) return Response.json({ error: "job_not_found" }, { status: 404 });
      context?.waitUntil(driveDocumentQueue(env, user));
      return Response.json({ job:project?safeScopedJob(job):serializeJob(job) }, { status: documentJobTerminal({ status: job.status }) ? 200 : 202 });
    }
    if (context&&!requiresForegroundDocumentExecution(existing)) {
      context.waitUntil(driveDocumentQueue(env, user));
      return Response.json({ job:project?safeScopedJob(existing):serializeJob(existing), accepted: true }, { status: 202 });
    }
    const job=await runDocumentJob(env,user,jobId,existing);if(!job)return Response.json({error:"job_not_found"},{status:404});
    return Response.json({ job:project?safeScopedJob(job):serializeJob(job) }, { status: documentJobTerminal({ status: job.status }) ? 200 : 202 });
  }

  if (request.method === "GET") {
    const requestedJob = path ? await readJob(env, user.userId, decodeURIComponent(path)) : null;
    if(path&&requestedJob&&documentJobTerminal(requestedJob)&&Date.parse(requestedJob.expires_at)<=Date.now())return Response.json({error:"job_not_found"},{status:404});
    const query = new URL(request.url).searchParams;
    // An explicit input inspection must never repair a job, settle a hold, or
    // dispatch any queue work. Shared actor-private receipts use their own route.
    if(path&&query.get("inspection")==="1"){
      if(!requestedJob||requestedJob.owner_id!==user.userId||requestedJob.stream_id!==user.streamId
        ||!(Date.parse(requestedJob.expires_at)>Date.now()))return Response.json({error:"job_not_found"},{status:404,headers:{"cache-control":"private, no-store"}});
      const certified=consentedAdaptiveJob(requestedJob)?await certifiedAdaptiveJob(env,user,requestedJob,false,true):requestedJob;
      return Response.json({job:serializeJob(certified)},{headers:{"cache-control":"private, no-store"}});
    }
    const activeOnly = query.get("scope") === "active";
    const documentScope = query.get("document")?.trim().slice(0, 160) ?? "";
    // Failure checkpoints remain durable, but large provider/planner inputs
    // belong to the explicitly requested detail view, not every idle poll.
    const readVisibleJobs = () => env.DB.prepare(`SELECT job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,
      CASE WHEN json_extract(request_json,'$.documentRevision') IS NULL THEN request_json ELSE json_object(
        'documentRevision',json_extract(request_json,'$.documentRevision'),'requestKey',json_extract(request_json,'$.requestKey'),
        'sourcePreviewId',json_extract(request_json,'$.sourcePreviewId'),'promptTechnique',json_extract(request_json,'$.promptTechnique'),
        'promptFanId',json_extract(request_json,'$.promptFanId'),'parentJobId',json_extract(request_json,'$.parentJobId'),
        'fanKind',json_extract(request_json,'$.fanKind'),'artifactKind',json_extract(request_json,'$.artifactKind'),'productionMode',json_extract(request_json,'$.productionMode'),'itemCount',json_extract(request_json,'$.itemCount'),'canvasId',json_extract(request_json,'$.canvasId'),
        'sceneMedium',json_extract(request_json,'$.sceneMedium'),'sceneConfiguration',json(json_extract(request_json,'$.sceneConfiguration'))
      ) END AS request_json,
      json_remove(result_json,'$.imageRecovery','$.providerSubmissions','$.providerSubmissionProtocol','$.providerSubmissionLegacyUncertain','$.plannerInput','$.videoInputReceipt','$.audioInputReceipt','$.model3dInputReceipt','$.model3dProviderFiles','$.artifactPlan','$.presentationCandidates','$.presentationRecoveryOnly','$.productionPlan','$.productionSceneReceipts','$.productionAnchor') AS result_json,
      error_message,attempt_count,requested_at,started_at,completed_at,lease_expires_at,notified_at,expires_at,updated_at
      FROM document_jobs WHERE owner_id=? AND stream_id=? AND NOT EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.resource_kind='job' AND resource.resource_id=document_jobs.job_id) AND (status IN ('queued','running','committing') OR (notified_at IS NULL AND expires_at>?) OR (kind IN ('preview','generate','prompt_fan','render_document','structure_adaptive') AND (status IN ('failed','partial') OR kind='structure_adaptive') AND expires_at>?))
      AND NOT EXISTS(SELECT 1 FROM output_operation_slots slot WHERE slot.job_id=document_jobs.job_id AND slot.status='authorized')
      AND (?=0 OR status IN ('queued','running','committing') OR notified_at IS NULL)
      AND (?='' OR status IN ('queued','running','committing') OR notified_at IS NULL OR document_id=?)
      ORDER BY CASE WHEN status IN ('queued','running','committing') THEN 0 ELSE 1 END,requested_at DESC LIMIT 120`).bind(user.userId,user.streamId,now,now,Number(activeOnly),documentScope,documentScope).all<DocumentJobRow>();
    let rows = path ? requestedJob ? [requestedJob] : [] : (await readVisibleJobs()).results;
    let reconciled = false;
    const repairCandidates = rows.filter((row) => row.status === "failed" && /Wrong number of parameter bindings/i.test(row.error_message ?? ""));
    if (repairCandidates.length) {
      const events = await readCorrelatedEvents(env,user.streamId,repairCandidates.map((row)=>row.correlation_id));
      for (const row of repairCandidates) {
        if(!operationFinished(events,row))continue;
        const retained = path ? row : await readJob(env, user.userId, row.job_id);
        if (retained && await repairMisreportedTerminalJob(env, retained, events)) reconciled = true;
      }
    }
    const parents = rows.filter((row) => row.kind === "prompt_fan" && ["queued","running","committing"].includes(row.status));
    for(const parent of parents){const updated=await reconcilePromptFanParent(env,user.userId,parent.job_id);if(!updated||updated.status!==parent.status||updated.result_json!==parent.result_json||updated.error_message!==parent.error_message||updated.completed_at!==parent.completed_at)reconciled=true;}
    for (const row of rows) if (rowIsStale(row) && row.attempt_count >= documentJobMaxAttempts(row.kind)) {
      // A compact list row must never replace the retained recovery checkpoint.
      const retained = path ? row : await readJob(env, user.userId, row.job_id);
      if (retained && rowIsStale(retained) && retained.attempt_count >= documentJobMaxAttempts(retained.kind)) {
        if(await failStaleJob(env, user, retained)!=="held")reconciled = true;
      }
    }
    if (reconciled) {
      const refreshed = path ? await readJob(env, user.userId, decodeURIComponent(path)) : null;
      rows = path ? refreshed ? [refreshed] : [] : (await readVisibleJobs()).results;
    }
    const visibleBlocker = [...rows].filter((row)=>row.kind!=="prompt_fan"&&["running","committing"].includes(row.status)).sort((left,right)=>left.requested_at.localeCompare(right.requested_at)||left.job_id.localeCompare(right.job_id))[0]??null;
    const activeBlocker = path
      ? await env.DB.prepare("SELECT * FROM document_jobs WHERE owner_id=? AND stream_id=? AND kind!='prompt_fan' AND status IN ('running','committing') ORDER BY requested_at ASC,job_id ASC LIMIT 1").bind(user.userId, user.streamId).first<DocumentJobRow>()
      : visibleBlocker;
    const recoveryBlocker = activeBlocker && rowIsStale(activeBlocker) ? activeBlocker : null;
    if (recoveryBlocker&&!requiresForegroundDocumentExecution(recoveryBlocker)) context?.waitUntil(driveDocumentQueue(env, user));
    if (path && !rows.length) return Response.json({ error: "job_not_found" }, { status: 404 });
    const adaptiveCertified=await Promise.all(rows.map(async(row)=>row.kind==="structure_adaptive"?certifiedAdaptiveJob(env,user,await readJob(env,user.userId,row.job_id)??row):row));
    const certified=await freshlyRecoverablePresentationRows(env,user,adaptiveCertified);
    return Response.json(path ? { job: serializeJob(certified[0], recoveryBlocker) } : { jobs: certified.map((row) => serializeJob(row, recoveryBlocker, false)) });
  }

  if (path || request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const consent = requireConsent(user); if (consent) return consent;
  const input = submittedInput??await request.json() as DocumentJobAdmission;
  if (!KINDS.has(input.kind as DocumentJobKind)) return Response.json({ error: "unsupported_document_job" }, { status: 400 });
  const kind = input.kind as DocumentJobKind; const payload = input.payload && typeof input.payload === "object" ? { ...input.payload } : {};
  if(kind==="render_document"){
    const guidanceProblem=documentRenderGuidanceProblem({audience:payload.audience,tone:payload.tone});
    if(guidanceProblem)return Response.json(guidanceProblem,{status:400});
    const guidance=documentRenderGuidance({audience:payload.audience,tone:payload.tone});
    if(payload.audience!==undefined)payload.audience=guidance.audience;
    if(payload.tone!==undefined)payload.tone=guidance.tone;
  }
  if(!outputPreparation && ["outputExecution","outputTargetInstructions","outputImageFormat"].some((key)=>Object.hasOwn(payload,key)))
    return Response.json({error:"output_execution_server_owned"},{status:400});
  if(outputPreparation && (kind!=="generate"&&kind!=="render_document" || kind==="render_document"&&payload.artifactKind!=="slides"&&payload.artifactKind!=="model3d" || payload.productionMode==="managed"))
    return Response.json({error:"output_native_route_unsupported"},{status:422});
  let scenePrepared:PreparedSceneCost|null=null;
  const retainedSceneResponse=(existing:NonNullable<Awaited<ReturnType<typeof readExistingSceneRequest>>>)=>{
    const row=existing.row as unknown as DocumentJobRow;
    return Response.json({job:existing.scope?safeScopedJob(row):serializeJob(row),reused:true,sceneCostExisting:{requestId:String(row.job_id),preview:existing.preview,safeUnused:existing.safeUnused}},{status:sceneInspection?200:202,headers:{"cache-control":"private, no-store"}});
  };
  if(payload.sceneCostPreview!==undefined&&!(kind==="render_document"&&payload.artifactKind==="scene"&&payload.sceneCostPreview===true))return Response.json({error:"scene_cost_request_invalid",attemptSubmission:"not-submitted"},{status:400});
  if(kind==="render_document"&&payload.artifactKind==="scene"){
    if(scenePolicyStopIncomingField(payload))return Response.json({error:"scene_policy_stop_server_owned"},{status:400});
    try{
      if(payload.sceneMedium!==undefined&&!isSceneMedium(payload.sceneMedium))return Response.json({error:"scene_medium_invalid",attemptSubmission:"not-submitted"},{status:400});
      if(!payload.sceneRequestId)return Response.json({error:"scene_cost_confirmation_required",attemptSubmission:"not-submitted"},{status:428});
      const documentId=String(input.documentId??"");
      const existing=await readExistingSceneRequest(env,user,documentId,payload.sceneRequestId,project?.contextId??null,{certifyUnused:sceneInspection});
      if(existing)return retainedSceneResponse(existing);
      scenePrepared=await prepareSceneCostConsent(env,user,documentId,payload,project?.contextId??null,{synchronize:!sceneInspection});
      if(sceneInspection)return Response.json({sceneCostPreview:scenePrepared.preview,providerCalls:0,reservations:0},{headers:{"cache-control":"private, no-store"}});
      requireSceneCostApproval(payload.sceneCostConsent,scenePrepared);
    }catch(error){return sceneCostErrorResponse(error);}
  }
  if(kind==="render_document"){
    if(payload.sceneMedium!==undefined&&!isSceneMedium(payload.sceneMedium))return Response.json({error:"scene_medium_invalid",message:"Scene medium must be either visual or audio."},{status:400});
    if(payload.artifactKind==="scene"){
      const sceneConfiguration=createSceneConfiguration(isSceneMedium(payload.sceneMedium)?payload.sceneMedium:"visual");
      payload.sceneMedium=sceneConfiguration.medium;payload.sceneConfiguration=sceneConfiguration;
    }else{delete payload.sceneMedium;delete payload.sceneConfiguration;}
  }
  if(kind==="render_document"&&(payload.artifactKind==="storyboard"||payload.artifactKind==="video"||payload.artifactKind==="audio"||payload.artifactKind==="model3d")&&payload.paidMediaConfirmed!==true)return Response.json({error:"paid_media_confirmation_required",message:"Confirm paid media generation before starting this render."},{status:428});
  if((kind==="preview"||kind==="generate"||kind==="render_document"&&payload.artifactKind!=="slides")&&presentationServerOwnedCheckpointField(payload))return Response.json({error:"media_recovery_state_server_owned",message:"Provider request identifiers, receipts, and recovery accounting can only be restored from an owner-scoped server checkpoint."},{status:400});
  if (kind !== "extract_reference" && !(kind==="render_document"&&payload.artifactKind==="model3d") && !env.OPENAI_API_KEY) return Response.json({ error: "provider_not_configured" }, { status: 503 });
  if(kind==="render_document"&&payload.artifactKind==="audio"&&!env.FAL_KEY)return Response.json({error:"audio_provider_not_configured"},{status:503});
  if(kind==="render_document"&&payload.artifactKind==="model3d"){
    if(!env.FAL_KEY)return Response.json({error:"model3d_provider_not_configured",message:"Configure a server-side Fal key before creating a 3D model."},{status:503});
    if(payload.productionMode==="managed")return Response.json({error:"model3d_production_mode_unsupported",message:"Review one exact prompt and its selected reference views before creating a 3D model."},{status:422});
    payload.productionMode="manual";
  }
  if (JSON.stringify(payload).length > MAX_PAYLOAD_BYTES) return Response.json({ error: "document_job_payload_too_large" }, { status: 413 });
  if(kind==="render_document"&&payload.artifactKind==="slides"){
    if(presentationServerOwnedCheckpointField(payload))return Response.json({error:"presentation_recovery_state_server_owned",message:"Presentation recovery, provider receipts, and budget reservations can only come from an existing server-owned job checkpoint."},{status:400});
    try{resolvePresentationModelRoutes(env);}catch(error){if(error instanceof PresentationModelConfigurationError)return Response.json({error:error.code,field:error.field,message:error.message},{status:503});throw error;}
    const maximum=payload.productionMode==="managed"?MAX_MANAGED_PRESENTATION_SLIDES:MAX_MANUAL_PRESENTATION_SLIDES;
    try{
      const count=resolvePresentationCountRequest(payload);
      if(payload.itemCount!==undefined||payload.requestedSlideCount!==undefined||count.slideCountPolicy)payload.itemCount=count.itemCount;
      if(count.slideCountPolicy){payload.slideCountPolicy=count.slideCountPolicy;if(count.requestedSlideCount!==undefined)payload.requestedSlideCount=count.requestedSlideCount;}
    }catch(error){if(error instanceof PresentationCountPolicyError)return Response.json({error:error.code,message:error.message,supported:{minimum:1,maximum}},{status:error.code==="presentation_slide_count_conflict"?409:400});throw error;}
  }
  if(project&&(!input.documentId||!await readOutputAdmissionValue(outputPreparation?.readScope,"project-execution",()=>activeProjectExecution(env,user,String(input.documentId)))))return Response.json({error:"document_not_found"},{status:404});
  const events=await readOutputAdmissionValue(outputPreparation?.readScope,"source-events",()=>project?readProjectSourceEvents(env,project):readWorkspaceEvents(env,user.streamId));
  const projection=foldEvents(events,Number.POSITIVE_INFINITY,input.documentId,project?.projectId??"");
  const documentId = String(input.documentId ?? projection.documentId); const documentRecord = projection.documents.find((document) => document.id === documentId);
  if (!documentRecord) return Response.json({ error: "document_not_found" }, { status: 404 });
  if(project&&documentRecord.projectId!==project.projectId)return Response.json({error:"document_not_found"},{status:404});
  if(kind==="structure_adaptive"&&(String(input.sourceSurface??payload.sourceSurface??"")==="canvas"||payload.canvasId!==undefined)){
    const canvasId=typeof payload.canvasId==="string"?payload.canvasId.trim():"";
    if(!canvasId||canvasId.length>160||String(input.sourceSurface??payload.sourceSurface??"")!=="canvas"||payload.projectScope!==true)return Response.json({error:"canvas_context_required",message:"Board planning requires its exact authorized Canvas board."},{status:400});
    if(project&&!hasCapability(principal,"project.canvas.use",{organizationId:project.organizationId,projectAccessId:project.projectAccessId}))return Response.json({error:"canvas_access_denied"},{status:403});
    const lifecycle=events.filter((event)=>["CanvasCreated","CanvasRemoved","CanvasRestored"].includes(event.type)&&String(event.payload.canvas_id??"")===canvasId&&String(event.payload.project_id??"")===documentRecord.projectId);
    if(!lifecycle.some((event)=>event.type==="CanvasCreated")||lifecycle.at(-1)?.type==="CanvasRemoved")return Response.json({error:"canvas_not_found"},{status:404});
    payload.canvasId=canvasId;
  }
  if(project&&!await readOutputAdmissionValue(outputPreparation?.readScope,"governed-source-rights",()=>governedPackageSourceRightsCurrent(env,project.organizationId,projection.blocks)))
    return Response.json({error:"context_source_rights_expired",message:"The original rights for an adopted organizational source are no longer valid."},{status:409});
  let workflowPlanningSnapshot:Record<string,unknown>|undefined;
  if(kind==="preview"||kind==="generate"||kind==="prompt_fan"||kind==="render_document"){
    try{
      const trusted=authoritativeCreativeContext(events,{
        documentId,
        projectId:project?.projectId??documentRecord.projectId,
        canvasId:typeof payload.canvasId==="string"?payload.canvasId:undefined,
        contextSetId:typeof payload.contextSetId==="string"?payload.contextSetId:undefined,
        contextRootBlockId:typeof payload.contextRootBlockId==="string"?payload.contextRootBlockId:undefined,
        characterOutputKind:payload.characterOutputKind==="headshot"||payload.characterOutputKind==="character_sheet"?payload.characterOutputKind:undefined,
        snapshot:payload.snapshot&&typeof payload.snapshot==="object"&&!Array.isArray(payload.snapshot)?payload.snapshot as Record<string,unknown>:undefined,
        sourceBlockVersions:Array.isArray(payload.sourceBlockVersions)?payload.sourceBlockVersions as Array<Record<string,unknown>>:undefined,
      });
      payload.snapshot=trusted.snapshot;
      payload.sourceBlockVersions=trusted.sourceBlockVersions;
      payload.documentRevision=trusted.documentRevision;
      if(outputPreparation){
        Object.assign(payload,await outputPreparation.compile(trusted));
        payload.outputExecution=outputPreparation.outputExecution;
      }
      if((kind==="render_document"||kind==="generate")&&(payload.workflowId!==undefined||payload.workflowStageId!==undefined||payload.workflowSources!==undefined)){
        let workflowScope=user.projectExecution;
        if(!workflowScope&&!user.fictional&&(user.billingUserId??user.userId)===user.userId){
          const scopes=await ownerDocumentBudgetScopes(env,user.userId,documentId,documentRecord.projectId);
          if(scopes.length>1)return Response.json({error:"ambiguous_project_budget_scope"},{status:409});
          if(scopes[0])workflowScope={organizationId:scopes[0].organizationId,projectAccessId:scopes[0].projectAccessId,projectId:documentRecord.projectId,ownerUserId:user.userId,actorUserId:user.userId};
        }
        const resolved=await resolveProductionWorkflowContext({env,events,documentId,projectId:project?.projectId??documentRecord.projectId,ownerId:workflowScope?.ownerUserId??project?.ownerUserId??user.userId,scope:workflowScope,snapshot:trusted.snapshot,workflowId:payload.workflowId,workflowStageId:payload.workflowStageId,workflowSources:payload.workflowSources,requestedFormat:kind==="generate"?"image":payload.artifactKind});
        // Persist only the authenticated authored snapshot. Synthetic output context is
        // transient and will be re-resolved under fresh authorization during execution.
        workflowPlanningSnapshot=resolved.snapshot;
        if(!(kind==="render_document"&&payload.artifactKind==="scene"))payload.workflowSources=resolved.sources;
        if(kind==="render_document"&&payload.artifactKind==="scene"&&resolved.sceneConfiguration){
          payload.sceneMedium=resolved.sceneConfiguration.medium;
          payload.sceneConfiguration=resolved.sceneConfiguration;
        }
      }
      if(kind==="render_document"&&payload.artifactKind==="slides"){
        const sourceSnapshot=workflowPlanningSnapshot??trusted.snapshot;
        const outline=inferPresentationSourceOutline(sourceSnapshot);
        const sourceMinimumSlideCount=minimumPresentationSlideCount(sourceSnapshot);
        const supportedMaximum=payload.productionMode==="managed"?MAX_MANAGED_PRESENTATION_SLIDES:MAX_MANUAL_PRESENTATION_SLIDES;
        if(sourceMinimumSlideCount>supportedMaximum)return Response.json({error:"presentation_slide_count_invalid",message:`This presentation requires ${sourceMinimumSlideCount} source-authored slides, exceeding the ${supportedMaximum}-slide ${payload.productionMode==="managed"?"managed":"manual"} limit.`,supported:{minimum:1,maximum:supportedMaximum},sourceMinimumSlideCount},{status:400});
        if(payload.slideCountPolicy)payload.itemCount=resolvePresentationCountRequest(payload,sourceMinimumSlideCount).itemCount;
        const requested=Number(payload.requestedSlideCount??payload.itemCount??0);
        if(requested>0&&requested<sourceMinimumSlideCount)return Response.json({error:"presentation_slide_count_conflict",message:`This presentation requires at least ${sourceMinimumSlideCount} source-authored or independently isolated slides; ${requested} would merge or omit required chapters.`,sourceMinimumSlideCount,authoredSlideCount:outline.authoredSlideCount??sourceMinimumSlideCount,requestedSlideCount:requested,plannedSlideCount:sourceMinimumSlideCount},{status:409});
        const sourceContract=buildPresentationSourceContract(sourceSnapshot,{...(payload.slideCountPolicy?{slideCountPolicy:readSlideCountPolicy(payload.slideCountPolicy),itemCount:Number(payload.itemCount)}:requested>0?{requestedSlideCount:requested}:{})});
        if(sourceContract.sourceIssues?.length)return Response.json({error:"presentation_source_contract_invalid",message:sourceContract.sourceIssues[0]!.message,issues:sourceContract.sourceIssues},{status:422});
        payload.authoredSlideCount=outline.authoredSlideCount;
      }
    }catch(error){
      if(error instanceof PresentationCountPolicyError)return Response.json({error:error.code,message:error.message},{status:error.code==="presentation_slide_count_conflict"?409:400});
      if(error instanceof ContextIntegrityError)return Response.json({error:error.code,message:error.message},{status:error.code==="document_not_found"?404:409});
      if(error instanceof ProductionWorkflowContextError)return Response.json({error:error.code,message:error.message},{status:error.status});
      throw error;
    }
  }
  if(!outputPreparation&&kind==="render_document"&&payload.artifactKind==="slides"&&payload.paidRetryConfirmed!==true){
    const previous=await env.DB.prepare("SELECT * FROM document_jobs WHERE owner_id=? AND stream_id=? AND document_id=? AND kind='render_document' AND status='failed' AND expires_at>? AND json_extract(request_json,'$.artifactKind')='slides' ORDER BY requested_at DESC LIMIT 8")
      .bind(user.userId,user.streamId,documentId,new Date().toISOString()).all<DocumentJobRow>();
    const requestIdentity=renderRequestIdempotencyKey(payload,documentId);
    for(const failed of previous.results){
      if(renderRequestIdempotencyKey(parseRequest(failed),documentId)!==requestIdentity)continue;
      if(project&&!await activeProjectExecution(env,user,failed.document_id,failed.job_id))continue;
      const checkpoint=parseResult(failed),reservationId=String(checkpoint.costReservationId??"");
      const reservation=reservationId?await costBudgetReservation(env,user.billingUserId??user.userId,reservationId):null;
      if(!reservation||reservation.status!=="settled"||reservation.stream_id!==user.streamId||reservation.operation!=="document-render:slides")continue;
      const recovered=await recoverRetainedPresentation(env,user,failed,project?.contextId??"");
      if("job" in recovered)return Response.json({job:project?safeScopedJob(recovered.job):serializeJob(recovered.job),reused:true,recovered:true},{headers:{"cache-control":"private, no-store"}});
      return Response.json({error:"presentation_identical_paid_retry_requires_confirmation",message:"An identical paid presentation already failed. Review its retained draft, change the request, or explicitly confirm another paid attempt before submitting it again."},{status:409});
    }
  }
  if(project&&kind==="extract_reference"){
    const blockId=String(payload.blockId??""),referenceId=String(payload.referenceId??"");
    const governed=await env.DB.prepare(`SELECT 1 AS protected FROM project_context_package_members member
      JOIN project_context_package_bindings binding ON binding.binding_id=member.binding_id
        AND binding.organization_id=member.organization_id AND binding.status='active'
      WHERE binding.project_access_id=? AND binding.organization_id=? AND member.target_block_id=? LIMIT 1`)
      .bind(project.projectAccessId,project.organizationId,blockId).first();
    if(governed)return Response.json({error:"organization_context_package_decision_immutable"},{status:403});
    const block=projection.libraryBlocks.find((candidate)=>candidate.id===blockId&&candidate.documentId===documentId&&candidate.type==="reference"&&String(candidate.properties.reference_id??"")===referenceId);
    const resources=block?await env.DB.prepare("SELECT COUNT(*) AS count FROM project_resource_scopes WHERE project_access_id=? AND organization_id=? AND owner_user_id=? AND ((resource_kind='document' AND resource_id=?) OR (resource_kind='block' AND resource_id=?) OR (resource_kind='reference' AND resource_id=?))")
      .bind(project.projectAccessId,project.organizationId,project.ownerUserId,documentId,blockId,referenceId).first<{count:number}>():null;
    if(Number(resources?.count??0)!==3)return Response.json({error:"project_reference_not_authorized"},{status:403});
  }
  let projectRetentionDays:number|null=null;
  let projectContentScope=user.projectExecution;
  let productionPlan:ManagedProductionPlan|null=null;
  let estimatedGenerationCostMicrousd=0;
  if(kind==="preview"||kind==="generate"||kind==="prompt_fan"||kind==="render_document"||kind==="chat"||kind==="structure_adaptive"){
    const billingUserId=user.billingUserId??user.userId;
    const scopes=user.projectExecution?[{organizationId:user.projectExecution.organizationId,projectAccessId:user.projectExecution.projectAccessId,actorUserId:user.projectExecution.actorUserId}]:!user.fictional&&billingUserId===user.userId?await readOutputAdmissionValue(outputPreparation?.readScope,"budget-scopes",()=>ownerDocumentBudgetScopes(env,user.userId,documentId,documentRecord.projectId)):[];
    if(scopes.length>1)return Response.json({error:"ambiguous_project_budget_scope"},{status:409});
    assertOutputAdmissionBudget(outputPreparation?.readScope,env,billingUserId,new Date().toISOString().slice(0,7),scopes[0]);
    if(kind==="chat"&&scopes[0]&&!project)return Response.json({error:"project_context_required",message:"Open this document in its shared workspace before starting a creative conversation."},{status:409});
    if(scopes[0]){
      if(!project&&!await governedPackageSourceRightsCurrent(env,scopes[0].organizationId,projection.blocks))
        return Response.json({error:"context_source_rights_expired",message:"The original rights for an adopted organizational source are no longer valid."},{status:409});
      projectRetentionDays=(await readOutputAdmissionValue(outputPreparation?.readScope,"project-retention",()=>env.DB.prepare("SELECT transient_days FROM organization_retention_policies WHERE organization_id=?").bind(scopes[0]!.organizationId).first<{transient_days:number}>()))?.transient_days??null;
      projectContentScope??={organizationId:scopes[0].organizationId,projectAccessId:scopes[0].projectAccessId,projectId:documentRecord.projectId,ownerUserId:user.userId,actorUserId:user.userId};
    }
    const pilotAllowance=await pilotExecutionAllowance(env,billingUserId,scopes[0],outputPreparation?.readScope);
    if(!pilotAllowance.allowed)return Response.json({error:"active_pilot_participation_required"},{status:403});
    const trustedSnapshot=workflowPlanningSnapshot??(payload.snapshot&&typeof payload.snapshot==="object"&&!Array.isArray(payload.snapshot)?payload.snapshot as Record<string,unknown>:null);
    const trustedFacts=Array.isArray(trustedSnapshot?.facts)?trustedSnapshot.facts.filter((fact):fact is Record<string,unknown>=>Boolean(fact&&typeof fact==="object"&&!Array.isArray(fact))).map((fact)=>({type:String(fact.type??""),properties:fact.properties&&typeof fact.properties==="object"&&!Array.isArray(fact.properties)?fact.properties as Record<string,unknown>:{}})):null;
    const providerBlocks=kind==="structure_adaptive"&&payload.projectScope===true?projection.libraryBlocks:["preview","generate","prompt_fan","render_document"].includes(kind)&&trustedFacts?trustedFacts:projection.blocks;
    if(pilotAllowance.pilot&&!await readOutputAdmissionValue(outputPreparation?.readScope,"pilot-source-classification",()=>managedPilotSourceClassificationValid(env,project?.ownerUserId??user.userId,pilotAllowance.pilot!.cohort_id,providerBlocks,projectContentScope?.projectAccessId))){
      return Response.json({error:"pilot_non_sensitive_source_confirmation_required",message:"Every existing source in a controlled pilot must be re-uploaded with an explicit non-sensitive, licensed-material confirmation."},{status:428});
    }
    const account=scopes[0]?await readOutputAdmissionValue(outputPreparation?.readScope,"account-budgets",()=>readAccountBudgets(env,billingUserId,scopes[0]!.organizationId)):null;
    const artifactKind=String(payload.artifactKind??"");
    let selectedModel3d:Awaited<ReturnType<typeof prepareModel3dRequest>>|undefined;
    if(kind==="render_document"&&artifactKind==="model3d"){
      try{
        selectedModel3d=await prepareModel3dRequest({env,ownerId:projectContentScope?.ownerUserId??project?.ownerUserId??user.userId,snapshot:trustedSnapshot??{},sourceEvents:events as EventRow[],prompt:payload.model3dPrompt,promptSource:payload.model3dPromptSource,adaptation:payload.model3dAdaptation,settings:payload.model3dSettings,referenceBlockIds:payload.model3dReferenceBlockIds,projectScope:projectContentScope});
        payload.model3dPrompt=selectedModel3d.prompt;payload.model3dSettings=selectedModel3d.settings;payload.model3dEstimatedCostMicrousd=selectedModel3d.estimatedCostMicrousd;
        if(selectedModel3d.adaptation)payload.model3dAdaptation=selectedModel3d.adaptation;
      }catch(error){
        if(error instanceof ProviderRequestError){const detail=error.detail;return Response.json({error:detail.code,message:detail.message,errorDetail:publicFailureDetail(detail),attemptSubmission:"not-submitted"},{status:detail.httpStatus??422});}
        throw error;
      }
    }
    let selectedAudio:ReturnType<typeof selectAudioAdapter>|undefined;
    if(kind==="render_document"&&artifactKind==="audio"){
      try{
        const suppliedProfile=payload.audioProfile&&typeof payload.audioProfile==="object"&&!Array.isArray(payload.audioProfile)?payload.audioProfile as Record<string,unknown>:{};
        let audioProfile=normalizeAudioRequestProfile(suppliedProfile,trustedSnapshot??{});
        const videoGoal=audioProfile.goal==="video_music"||audioProfile.goal==="video_sound_effects";
        if(videoGoal&&(!payload.audioVideoArtifactId||audioProfile.videoReferenceId!==String(payload.audioVideoArtifactId)||payload.sendAudioVideoToProvider!==true)){
          return Response.json({error:"audio_video_reference_consent_required",message:"Choose an approved video and separately authorize sharing its complete contents with the audio provider."},{status:428});
        }
        if(!videoGoal&&(payload.audioVideoArtifactId||payload.sendAudioVideoToProvider===true))return Response.json({error:"audio_video_reference_goal_mismatch"},{status:400});
        selectedAudio=selectAudioAdapter(env,payload.audioProfile,{
          snapshot:trustedSnapshot??{},
          ...(typeof payload.audioProviderModel==="string"?{preferredModel:payload.audioProviderModel}:{}),
          ...(videoGoal?{videoReferenceAvailable:true}:{}),
        });
        audioProfile=selectedAudio.profile;
        if(payload.productionMode==="managed"&&audioProfile.goal!=="music")return Response.json({error:"audio_managed_goal_unsupported",message:"Structured music production is available only for the original-music goal."},{status:422});
        if(payload.audioImageBlockId&&!selectedAudio.contract.maximumImageReferences)return Response.json({error:"audio_image_reference_unsupported"},{status:400});
        if(videoGoal){
          const video=await approvedAudioVideoReference(env,project?.ownerUserId??user.userId,projection,events as EventRow[],String(payload.audioVideoArtifactId),projectContentScope);
          if(audioProfile.goal==="video_music"&&audioProfile.durationSeconds&&audioProfile.durationSeconds>video.durationSeconds)
            return Response.json({error:"audio_duration_exceeds_video",message:"Synchronized music cannot be longer than the approved video clip."},{status:422});
          audioProfile={...audioProfile,durationSeconds:video.durationSeconds,videoReferenceId:video.artifactId};
          selectedAudio=selectAudioAdapter(env,audioProfile,{preferredModel:selectedAudio.model,videoReferenceAvailable:true});
        }
        const conflict=audioAuthoringConflict(trustedSnapshot??{},audioProfile,{tone:payload.tone,audience:payload.audience});
        if(conflict)return Response.json({error:conflict.code,message:conflict.message},{status:422});
        audioPreparationConstraints(trustedSnapshot??{},{profile:audioProfile,model:selectedAudio.model,tone:typeof payload.tone==="string"?payload.tone:undefined,audience:typeof payload.audience==="string"?payload.audience:undefined});
        payload.audioProfile=audioProfile;payload.audioProviderModel=selectedAudio.model;payload.audioEstimatedCostMicrousd=selectedAudio.estimatedCostMicrousd;
      }catch(error){
        if(error instanceof AudioAdapterSelectionError||error instanceof AudioProviderInputError)return Response.json({error:error.code,message:error.message},{status:422});
        if(error instanceof ProviderRequestError){const detail=error.detail;return Response.json({error:detail.code,errorDetail:publicFailureDetail(detail)},{status:detail.httpStatus??400});}
        throw error;
      }
    }
    let production:ManagedProductionPlan|null=null;
    if(kind==="render_document"&&payload.productionMode==="managed"&&["short_story","scene","slides","storyboard","video","audio"].includes(artifactKind)){
      try{
        production=scenePrepared?.production??buildManagedProductionPlan(artifactKind as "short_story"|"scene"|"slides"|"storyboard"|"video"|"audio",workflowPlanningSnapshot??(payload.snapshot&&typeof payload.snapshot==="object"?payload.snapshot as Record<string,unknown>:{}),artifactKind==="video"?{}:{requestedItemCount:Number(payload.itemCount??0),...(artifactKind==="slides"&&payload.requestedSlideCount!==undefined?{requestedSlideCount:Number(payload.requestedSlideCount)}:{}),...(artifactKind==="scene"?{sceneMedium:isSceneMedium(payload.sceneMedium)?payload.sceneMedium:"visual"}:{})});
      }catch(error){
        if(error instanceof ManagedPresentationPlanningError)return Response.json({error:error.code,message:error.message},{status:422});
        throw error;
      }
      if(artifactKind==="slides"&&production.requestedSlideCount!==null&&production.requestedSlideCount!==production.predictedSlideCount){
        return Response.json({error:"presentation_slide_count_conflict",message:`The source contains ${production.authoredSlideCount} explicitly authored slides, but ${production.requestedSlideCount} slides were requested. Choose ${production.predictedSlideCount} slides to preserve every required authored position before generation.`,authoredSlideCount:production.authoredSlideCount,requestedSlideCount:production.requestedSlideCount,plannedSlideCount:production.predictedSlideCount},{status:409});
      }
    }
    const audioProviderCost=selectedAudio?.estimatedCostMicrousd??AUDIO_ADAPTER_CONTRACT.publishedCostMicrousd;
    const estimatedCostMicrousd=selectedModel3d?selectedModel3d.estimatedCostMicrousd:scenePrepared?scenePrepared.preview.maximumMicrousd:production?production.estimatedTotalCostMicrousd+(artifactKind==="storyboard"?production.scenes.length*1_000_000:artifactKind==="audio"?audioProviderCost:0):kind==="chat"||kind==="structure_adaptive"?estimatePlannerOperationMicrousd(env.OPENAI_MODEL??"gpt-5.6-terra",kind):kind==="prompt_fan"?4_000_000:kind==="render_document"&&artifactKind==="video"?normalizeVideoDurationSeconds(payload.videoSeconds)*VIDEO_ADAPTER_CONTRACT.publishedCostPerSecondMicrousd[VIDEO_ADAPTER_CONTRACT.defaultResolution]+1_000_000:kind==="render_document"&&artifactKind==="audio"?audioProviderCost+1_000_000:kind==="render_document"&&artifactKind==="storyboard"?Math.max(1,Math.floor(Number(payload.itemCount??6)))*1_000_000+1_000_000:1_000_000;
    productionPlan=production;estimatedGenerationCostMicrousd=estimatedCostMicrousd;
    if(pilotAllowance.pilot){
      const fixed=await readOutputAdmissionValue(outputPreparation?.readScope,"pilot-budget-counters",()=>env.DB.prepare(`SELECT scope,used_microusd,reserved_microusd,hard_limit_microusd FROM cost_budget_counters
        WHERE period=? AND ((scope='pilot_org' AND scope_id=?) OR (scope='pilot_user' AND scope_id=?))`)
        .bind(`pilot:${pilotAllowance.pilot!.cohort_id}`,pilotAllowance.pilot!.cohort_id,billingUserId)
        .all<{scope:string;used_microusd:number;reserved_microusd:number;hard_limit_microusd:number}>());
      if(fixed.results.length!==2)return Response.json({error:"active_pilot_participation_required"},{status:403});
      const exhausted=fixed.results.find((counter)=>Number(counter.used_microusd)+Number(counter.reserved_microusd)+estimatedCostMicrousd>Number(counter.hard_limit_microusd));
      if(exhausted)return Response.json({error:"pilot_budget_hard_cap_reached",scope:exhausted.scope==="pilot_user"?"user":"workspace"},{status:429});
    }
    const gate=generationBudgetGate(account?.costBudgets??await readOutputAdmissionValue(outputPreparation?.readScope,"cost-budgets",()=>readCostBudgets(env,billingUserId)),{projectedMicrousd:estimatedCostMicrousd,suppressedUntilCritical:payload.budgetWarningSuppressed===true,noticeAcknowledged:payload.budgetAcknowledged===true});
    if(gate.level==="blocked")return Response.json({error:"budget_hard_cap_reached",message:`This generation exceeds the remaining ${gate.scope==="workspace"?"organization":"personal"} monthly budget.`,scope:gate.scope,gate},{status:429});
    if(account){
      const sceneCount=production?.scenes.length??Math.max(1,Math.floor(Number(payload.itemCount??6)));
      const estimatedTokens=kind==="chat"||kind==="structure_adaptive"?12_000:kind==="preview"?24_000:kind==="prompt_fan"?(fanKindFromRequest(payload)==="preview"?96_000:128_000):kind==="render_document"?documentRenderTokenReservation(artifactKind,sceneCount,production?.maximumProviderCallCount):32_000;
      const tokenScope=account.budgets.user.used+account.budgets.user.reserved+estimatedTokens>account.budgets.user.limit?"user":account.budgets.workspace.used+account.budgets.workspace.reserved+estimatedTokens>account.budgets.workspace.limit?"workspace":null;
      if(tokenScope)return Response.json({error:"budget_hard_cap_reached",message:`This generation exceeds the remaining ${tokenScope==="workspace"?"organization":"personal"} monthly token budget.`,scope:tokenScope},{status:429});
    }
    if(gate.requiresAcknowledgement&&payload.budgetAcknowledged!==true)return Response.json({error:"generation_budget_acknowledgement_required",message:`Review your ${Math.round(gate.projectedUtilization*100)}% monthly budget usage before starting this generation.`,gate},{status:428});
    if(kind==="render_document"&&artifactKind==="slides"){
      const authorizedSources=new Set(buildPresentationSourceContract(workflowPlanningSnapshot??payload.snapshot as Record<string,unknown>).sources.filter((source)=>source.sourceKind==="block").map((source)=>source.sourceId));
      if(!authorizedSources.size)return Response.json({error:"presentation_authorized_source_required",message:"Add at least one active, authorized source decision before generating a presentation. Exclusions and disabled decisions cannot become slide content."},{status:422});
      if(production&&production.scenes.some((scene)=>!scene.sourceBlockIds.some((sourceId)=>authorizedSources.has(sourceId))))return Response.json({error:"presentation_authorized_source_required",message:"Every planned slide requires an active, authorized positive source before any budget is reserved or a model is contacted."},{status:422});
    }
  }
  if(!project&&!outputPreparation){
    await reconcileFailedBudgetReservations(env,user);
    await env.DB.prepare(`UPDATE document_jobs SET ${EXPIRED_DOCUMENT_JOB_REDACTION_SQL},updated_at=? WHERE owner_id=? AND stream_id=? AND expires_at<=? AND ${DOCUMENT_JOB_REDACTION_REQUIRED_SQL}
      AND NOT EXISTS(SELECT 1 FROM project_resource_scopes resource JOIN organization_retention_policies policy ON policy.organization_id=resource.organization_id AND policy.legal_hold=1
        WHERE (resource.resource_kind='job' AND resource.resource_id=document_jobs.job_id)
          OR (resource.resource_kind='document' AND resource.resource_id=document_jobs.document_id AND resource.owner_user_id=document_jobs.owner_id))`).bind(now,user.userId,user.streamId,now).run();
  }

  if(kind==="preview"||kind==="generate"||kind==="prompt_fan"){
    const readinessKind=kind==="prompt_fan"?`${fanKindFromRequest(payload)??"generate"}_fan` as const:kind;const readiness=await preflightGeneration(env,user,{kind:readinessKind,documentId,documentRevision:String(payload.documentRevision??""),requestKey:String(payload.requestKey??""),sourcePreviewId:typeof payload.sourcePreviewId==="string"?payload.sourcePreviewId:null,promptTechnique:normalizePromptTechnique(payload.promptTechnique),productionMode:payload.productionMode==="managed"?"managed":"manual",contextRootBlockId:typeof payload.contextRootBlockId==="string"?payload.contextRootBlockId:undefined,characterOutputKind:payload.characterOutputKind==="headshot"||payload.characterOutputKind==="character_sheet"?payload.characterOutputKind:undefined,snapshot:payload.snapshot&&typeof payload.snapshot==="object"?payload.snapshot as Record<string,unknown>:undefined,force:true,sourceSurface:String(input.sourceSurface??"generation-controls"),...(payload.workflowId&&payload.workflowStageId?{workflowId:String(payload.workflowId),workflowStageId:String(payload.workflowStageId),workflowSources:Array.isArray(payload.workflowSources)?payload.workflowSources as ProductionWorkflowSource[]:[]}:{})},{appendEvents:!outputPreparation,allowCache:false,sourceEvents:events,allowProviderCalls:!outputPreparation,persist:!outputPreparation,...(outputPreparation?.readScope?{outputAdmissionReads:outputPreparation.readScope}:{}),...(outputPreparation?.outputImageRender?{outputImageRender:outputPreparation.outputImageRender}:{})});
    if(readiness.status==="blocked"){if(!outputPreparation)await appendAuditEvent(env,user.streamId,"worker:policy","GenerationBlockedBeforeProvider",{preflight_id:readiness.preflightId,document_id:documentId,document_revision:readiness.documentRevision,request_key:readiness.requestKey,kind:readiness.kind,status:readiness.status,blocking_probes:readiness.probes.filter((probe)=>probe.status==="fail").map((probe)=>probe.id),estimated_cost_avoided_microusd:readiness.estimatedCostMicrousd},uuidV7());return Response.json({error:"generation_preflight_blocked",message:readiness.summary,readiness},{status:409});}
    if(readiness.status==="review"&&payload.preflightAcknowledged!==true)return Response.json({error:"generation_preflight_review_required",message:readiness.summary,readiness},{status:428});
    if(readiness.status==="review"&&!outputPreparation)await appendAuditEvent(env,user.streamId,"worker:policy","GenerationRiskAcknowledged",{preflight_id:readiness.preflightId,document_id:documentId,document_revision:readiness.documentRevision,request_key:readiness.requestKey,kind:readiness.kind,warning_probes:readiness.probes.filter((probe)=>probe.status==="warning"||probe.status==="unknown").map((probe)=>probe.id),source_surface:String(input.sourceSurface??"generation-controls")});
    payload.preflightId=readiness.preflightId;payload.preflightVersion=readiness.version;payload.preflightAcknowledged=readiness.status==="review";
  }

  if (kind === "prompt_fan") {
    const fanKind = fanKindFromRequest(payload); if (!fanKind) return Response.json({ error: "prompt_fan_kind_required" }, { status: 400 });
    const promptFanId = typeof payload.promptFanId === "string" && payload.promptFanId ? payload.promptFanId : uuidV7();
    const documentRevision = generationRevisionFromRequest(payload, documentId); const sourcePreviewId = typeof payload.sourcePreviewId === "string" && payload.sourcePreviewId ? payload.sourcePreviewId : null;
    const parentRequestKey = String(payload.requestKey || `prompt-fan:${fanKind}:${documentRevision}:${sourcePreviewId || "document"}`);
    const activeParents=(await env.DB.prepare(`SELECT job.* FROM document_jobs job${project?" JOIN project_resource_scopes resource ON resource.resource_kind='job' AND resource.resource_id=job.job_id AND resource.project_access_id=? AND resource.organization_id=? AND resource.actor_user_id=job.owner_id":""}
      WHERE job.owner_id=? AND job.stream_id=? AND job.document_id=? AND job.kind='prompt_fan' AND job.status IN('queued','running','committing') ORDER BY job.requested_at DESC LIMIT 20`)
      .bind(...(project?[project.projectAccessId,project.organizationId]:[]),user.userId,user.streamId,documentId).all<DocumentJobRow>()).results;
    const duplicate = activeParents.find((candidate) => String(parseRequest(candidate).requestKey ?? "") === parentRequestKey);
    if(duplicate){const retained=await reconcilePromptFanParent(env,user.userId,duplicate.job_id)??duplicate;return Response.json({job:project?safeScopedJob(retained):serializeJob(retained),reused:true},{status:202});}
    const requestedAt = new Date(); const requestedAtIso = requestedAt.toISOString(); const configuredRetention = Number(projectRetentionDays ?? env.FORMA_RETENTION_DAYS ?? 30); const retentionDays = Number.isFinite(configuredRetention) && configuredRetention > 0 ? configuredRetention : 30; const expiresAt = new Date(requestedAt.getTime() + retentionDays * 86_400_000).toISOString();
    const sourceSurface = String(input.sourceSurface ?? payload.sourceSurface ?? "studio").slice(0, 80) || "studio"; const requestedSequence = await streamHead(env, user.streamId); const parentId = uuidV7(); const childIds = PROMPT_TECHNIQUES.map(() => uuidV7());
    const productionMode=payload.productionMode==="managed"?"managed":"manual";
    const shared = { ...payload, productionMode, fanKind: undefined, requestKey: undefined, promptTechnique: undefined, promptFanId, documentRevision, sourcePreviewId };
    const parentRequest = { fanKind, promptFanId, documentRevision, sourcePreviewId, productionMode, requestKey: parentRequestKey, childJobIds: childIds };
    const insert = (jobId: string, jobKind: DocumentJobKind, requestJson: Record<string, unknown>, resultJson: Record<string, unknown> | null = null) => documentJobInsert(env,user,documentId,"?,?,?,?,?,'queued',?,?,?,?,?,NULL,0,?,NULL,NULL,NULL,NULL,?,?",[jobId,user.userId,user.streamId,documentId,jobKind,sourceSurface,jobId,requestedSequence,JSON.stringify(requestJson),resultJson?JSON.stringify(resultJson):null,requestedAtIso,expiresAt,requestedAtIso]);
    const members = PROMPT_TECHNIQUES.map((technique, index) => ({ jobId: childIds[index], promptTechnique: technique, status: "queued", error: null, attemptCount: 0, updatedAt: requestedAtIso }));
    const inserts=[{jobId:parentId,statement:insert(parentId,"prompt_fan",parentRequest,{stage:"queued",progressMessage:"Four prompt approaches are queued as one generation.",members,completedCount:0,failedCount:0,totalCount:4})},
      ...PROMPT_TECHNIQUES.map((technique:PromptTechnique,index:number)=>({jobId:childIds[index]!,statement:insert(childIds[index]!,fanKind,{...shared,parentJobId:parentId,promptTechnique:technique,requestKey:documentGenerationRequestKey(fanKind,documentRevision,sourcePreviewId,technique,promptFanId)})}))];
    const statements=inserts.flatMap((entry)=>{const resource=projectJobResource(env,user,entry.jobId,documentId,requestedAtIso);return resource?[entry.statement,resource]:[entry.statement];});
    const results=await env.DB.batch(statements);if(project&&results.some((result)=>Number(result.meta.changes??0)!==1))return Response.json({error:"project_access_revoked"},{status:403});
    if(project)await anchorProjectJobs(env,user,[{jobId:parentId,kind:"prompt_fan",documentId},...childIds.map((jobId)=>({jobId,kind:fanKind,documentId}))]);
    const parent=await readJob(env,user.userId,parentId);context?.waitUntil(driveDocumentQueue(env,user));
    return Response.json({job:project?safeScopedJob(parent!):serializeJob(parent!),accepted:true},{status:202});
  }

  if(kind==="structure_adaptive"){
    const prompt=String(payload.prompt??"").trim();
    if(!prompt)return Response.json({error:"adaptive_intent_required"},{status:400});
    if(prompt.length>2000)return Response.json({error:"adaptive_intent_too_long"},{status:400});
    const sourceSurface=String(input.sourceSurface??payload.sourceSurface??"studio").slice(0,80)||"studio";
    payload.prompt=prompt;payload.locale=adaptiveRequestLocale(payload.locale);payload.projectId=documentRecord.projectId;
    payload.requestKey=await adaptiveRequestKey({projectId:documentRecord.projectId,documentId,canvasId:payload.canvasId,sourceSurface,projectScope:payload.projectScope,locale:payload.locale,prompt});
    const blocks=(payload.projectScope===true?projection.libraryBlocks:projection.blocks).filter((block)=>block.projectId===documentRecord.projectId&&!block.removed);
    const ids=new Set(blocks.map((block)=>block.id));
    payload.idempotencyKey=await sourceSnapshotSha256({requestKey:payload.requestKey,model:env.OPENAI_MODEL??"gpt-5.6-terra",documentTitle:projection.documentTitle,blocks,relationships:projection.libraryBlockRelations.filter((relation)=>!relation.removed&&ids.has(relation.fromBlockId)&&ids.has(relation.toBlockId))});
  }
  let active:DocumentJobRow|null=null;
  if(kind!=="extract_reference"&&!outputPreparation){
    const candidates=(await env.DB.prepare(`SELECT job.* FROM document_jobs job${project?" JOIN project_resource_scopes resource ON resource.resource_kind='job' AND resource.resource_id=job.job_id AND resource.project_access_id=? AND resource.organization_id=? AND resource.actor_user_id=job.owner_id":""}
      WHERE job.owner_id=? AND job.stream_id=? AND job.document_id=? AND job.kind=? AND job.status IN('queued','running','committing') ORDER BY job.requested_at DESC LIMIT 50`)
      .bind(...(project?[project.projectAccessId,project.organizationId]:[]),user.userId,user.streamId,documentId,kind).all<DocumentJobRow>()).results;
    if(kind==="preview"||kind==="generate"){
      const identity=generationRequestIdentity(kind,payload,documentId);payload.documentRevision=identity.documentRevision;payload.requestKey=identity.requestKey;
      active=candidates.find((candidate)=>{const candidateIdentity=generationRequestIdentity(kind,parseRequest(candidate),documentId);return candidateIdentity.requestKey===identity.requestKey&&candidateIdentity.workflowIdentity===identity.workflowIdentity;})??null;
    }else if(kind==="render_document"){
      const providedRequestKey=String(payload.requestKey??"").trim();
      const sceneConfiguration=sceneConfigurationFromRequest(payload);
      payload.requestKey=providedRequestKey||`render:${String(payload.artifactKind??"unknown")}${sceneConfiguration?`:${sceneConfiguration.medium}`:""}:${payload.productionMode==="managed"?"managed":"manual"}:${generationRevisionFromRequest(payload,documentId)}`;
      const idempotencyKey=scenePrepared?"scene:"+String(payload.sceneRequestId):renderRequestIdempotencyKey(payload,documentId);payload.idempotencyKey=idempotencyKey;
      active=candidates.find((candidate)=>scenePrepared?candidate.job_id===payload.sceneRequestId:renderRequestIdempotencyKey(parseRequest(candidate),documentId)===idempotencyKey)??null;
    }else if(kind==="structure_adaptive"){
      const sourceSurface=String(input.sourceSurface??payload.sourceSurface??"studio").slice(0,80)||"studio";
      const sameSurface=(candidate:DocumentJobRow)=>candidate.source_surface===sourceSurface&&(parseRequest(candidate).canvasId??null)===(payload.canvasId??null);
      active=candidates.find((candidate)=>sameSurface(candidate)&&parseRequest(candidate).idempotencyKey===payload.idempotencyKey)??null;
      if(!active&&candidates.some(sameSurface))return Response.json({error:"adaptive_request_in_progress"},{status:409});
    }else active=candidates[0]??null;
  }
  if(active&&scenePrepared){try{const retained=await readExistingSceneRequest(env,user,documentId,payload.sceneRequestId,project?.contextId??null,{certifyUnused:sceneInspection});if(retained)return retainedSceneResponse(retained);}catch(error){return sceneCostErrorResponse(error);}}
  if(active)return Response.json({job:project?safeScopedJob(active):serializeJob(active),reused:true},{status:202});

  if (kind === "chat" || kind === "structure_adaptive") {
    const field = kind === "chat" ? "message" : "prompt"; const text = String(payload[field] ?? "").trim();
    if (!text) return Response.json({ error: kind === "chat" ? "chat_message_required" : "adaptive_intent_required" }, { status: 400 });
    if (text.length > (kind === "chat" ? 4000 : 2000)) return Response.json({ error: kind === "chat" ? "chat_message_too_long" : "adaptive_intent_too_long" }, { status: 400 });
    const stored = await storePrivateContent(env, user.userId, kind === "chat" ? "chat-user" : "adaptive-intent", text, projectContentScope); payload[field] = undefined; payload.jobInputRef = stored.contentId;
  }

  if(scenePrepared){
    try{
      scenePrepared=await prepareSceneCostConsent(env,user,documentId,payload,project?.contextId??null,{synchronize:true});
      requireSceneCostApproval(payload.sceneCostConsent,scenePrepared);
      productionPlan=scenePrepared.production;estimatedGenerationCostMicrousd=scenePrepared.preview.maximumMicrousd;
    }catch(error){return sceneCostErrorResponse(error);}
  }
  const jobId = outputPreparation?.jobId ?? (scenePrepared?String(payload.sceneRequestId):uuidV7()); const requestedAt = new Date(); const configuredRetention = Number(projectRetentionDays ?? env.FORMA_RETENTION_DAYS ?? 30); const retentionDays = Number.isFinite(configuredRetention) && configuredRetention > 0 ? configuredRetention : 30; const expiresAt = new Date(requestedAt.getTime() + retentionDays * 86_400_000).toISOString();
  const sourceSurface = String(input.sourceSurface ?? payload.sourceSurface ?? "studio").slice(0, 80) || "studio"; const requestedSequence = await readOutputAdmissionValue(outputPreparation?.readScope,"source-head",()=>streamHead(env,user.streamId));
  const createdAt=requestedAt.toISOString();
  // Cookie-free tenant owners retain the same resolved custody as the exact Scene approval.
  const admissionUser=scenePrepared?.scope?{...user,projectExecution:scenePrepared.scope}:user;
  const deferredPrivate=outputPreparation?[] as D1PreparedStatement[]:undefined;
  const receipt=kind==="render_document"?await acceptedGenerationReceipt(env,admissionUser,payload,documentId,jobId,estimatedGenerationCostMicrousd,productionPlan,scenePrepared?.scope??projectContentScope,scenePrepared?.effectiveSnapshot??workflowPlanningSnapshot,deferredPrivate,outputPreparation?.readScope):kind==="preview"||kind==="generate"?{artifact_kind:"image",provider:"openai",model:env.OPENAI_MODEL??"gpt-5.6-terra",reservation_microusd:estimatedGenerationCostMicrousd,settled_cost_microusd:0,reservation_status:"not_reserved",source_transmission_status:"not_transmitted",provider_request_status:"not_submitted"}:null;
  const sceneConfiguration=kind==="render_document"?sceneConfigurationFromRequest(payload):null;
  const initialResult=receipt?{...(scenePrepared||payload.artifactKind==="model3d"?{providerSubmissionProtocol:1,providerSubmissions:{}}:{}),artifactKind:String(payload.artifactKind??""),...(sceneConfiguration?{sceneMedium:sceneConfiguration.medium,sceneConfiguration}:{}),generationReceipt:receipt,stage:"queued",progressMessage:"The accepted generation and its private source receipt are safely recorded."}:null;
  if(outputPreparation){
    if(kind!=="generate"&&kind!=="render_document")return Response.json({error:"output_native_route_unsupported"},{status:422});
    const requiredTokens=kind==="generate"?32_000:documentRenderTokenReservation(String(payload.artifactKind),Math.max(1,Math.floor(Number(payload.itemCount??6))),2);
    if(!Number.isSafeInteger(outputPreparation.maximumMicrousd)||outputPreparation.maximumMicrousd<estimatedGenerationCostMicrousd
      ||!Number.isSafeInteger(outputPreparation.maximumTokens)||outputPreparation.maximumTokens<requiredTokens
      ||outputPreparation.maximumCalls!==(payload.artifactKind==="model3d"?1:2))return Response.json({error:"output_admission_allowance_mismatch"},{status:409});
    const scope=user.projectExecution;
    const queueEvent={type:scope?"ProjectDocumentJobQueued":"OutputOperationJobQueued",payload:{job_id:jobId,document_id:documentId,kind,
      ...(scope?{organization_id:scope.organizationId,project_access_id:scope.projectAccessId,project_id:scope.projectId,history_owner_user_id:scope.ownerUserId,actor_user_id:scope.actorUserId}:{}),
      output_slot_id:outputPreparation.outputExecution.slotId,output_grant_id:outputPreparation.outputExecution.grantId}};
    outputPreparation.prepared={user,documentId,kind,jobId,payload,estimatedMicrousd:estimatedGenerationCostMicrousd,
      maximumTokens:outputPreparation.maximumTokens,maximumCalls:outputPreparation.maximumCalls,
      initialResult:{...(initialResult??{}),providerSubmissionProtocol:1},sourceHead:requestedSequence,expiresAt,createdAt,queueEvent,
      buildStatements:(event,checkpoint)=>{
        if(event.type!==queueEvent.type||event.streamId!==user.streamId||event.payload.job_id!==jobId)throw new Error("output_job_anchor_mismatch");
        const inserted=documentJobInsert(env,user,documentId,"?,?,?,?,?,'queued',?,?,?,?,?,NULL,0,?,NULL,NULL,NULL,NULL,?,?",
          [jobId,user.userId,user.streamId,documentId,kind,sourceSurface,jobId,event.sequence,JSON.stringify(payload),JSON.stringify({...initialResult,...checkpoint,providerSubmissionProtocol:1}),createdAt,expiresAt,createdAt]);
        const resource=scope?env.DB.prepare(`INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,visibility,source_event_id,actor_user_id,created_at)
          SELECT ?,'job',?,?,?,?,'actor_private',?,?,? WHERE EXISTS(SELECT 1 FROM document_jobs job WHERE job.job_id=? AND job.owner_id=? AND job.stream_id=? AND job.document_id=?) AND ${activeProjectExecutionSql}`)
          .bind(scope.projectAccessId,jobId,scope.organizationId,scope.projectId,scope.ownerUserId,event.eventId,scope.actorUserId,createdAt,jobId,user.userId,user.streamId,documentId,...projectExecutionBindings(scope,documentId)):null;
        return [...(deferredPrivate??[]),inserted,...(resource?[resource]:[])];
      }};
    return Response.json({prepared:true},{status:200});
  }
  const inserted=documentJobInsert(env,admissionUser,documentId,"?,?,?,?,?,'queued',?,?,?,?,?,NULL,0,?,NULL,NULL,NULL,NULL,?,?",[jobId,user.userId,user.streamId,documentId,kind,sourceSurface,jobId,requestedSequence,JSON.stringify(payload),initialResult?JSON.stringify(initialResult):null,createdAt,expiresAt,createdAt],kind==="render_document"||kind==="structure_adaptive"?{kind,key:String(payload.idempotencyKey??""),sourceSurface,canvasId:typeof payload.canvasId==="string"?payload.canvasId:"",projectId:documentRecord.projectId}:undefined,scenePrepared?sceneRequestExclusion(jobId,scenePrepared.guard):undefined);
  const resource=projectJobResource(env,admissionUser,jobId,documentId,createdAt,Boolean(scenePrepared));
  let created=false;
  if(resource){const results=await env.DB.batch([inserted,resource]);created=results.every((result)=>Number(result.meta.changes??0)===1);if(!created&&Number(results[0]?.meta.changes??0)!==0)return Response.json({error:"project_access_revoked"},{status:403});}
  else created=Number((await inserted.run()).meta.changes??0)===1;
  if(!created){
    if(scenePrepared){try{const retained=await readExistingSceneRequest(env,user,documentId,payload.sceneRequestId,project?.contextId??null,{certifyUnused:sceneInspection});if(retained)return retainedSceneResponse(retained);}catch(error){return sceneCostErrorResponse(error);}}
    if(kind==="render_document"||kind==="structure_adaptive"){
      const duplicate=await env.DB.prepare(`SELECT * FROM document_jobs WHERE owner_id=? AND stream_id=? AND document_id=? AND kind=? AND status IN('queued','running','committing') AND json_extract(request_json,'$.idempotencyKey')=? ORDER BY requested_at DESC LIMIT 1`)
        .bind(user.userId,user.streamId,documentId,kind,String(payload.idempotencyKey??"")).first<DocumentJobRow>();
      if(duplicate&&(!project||await activeProjectExecution(env,user,duplicate.document_id,duplicate.job_id)))return Response.json({job:project?safeScopedJob(duplicate):serializeJob(duplicate),reused:true},{status:202});
    }
    return Response.json({error:project?"project_access_revoked":"document_job_admission_conflict"},{status:project?403:409});
  }
  if(resource)await anchorProjectJobs(env,admissionUser,[{jobId,kind,documentId}]);
  const job = await readJob(env, user.userId, jobId);
  if(!requiresForegroundDocumentExecution(job!))context?.waitUntil(driveDocumentQueue(env,user));
  return Response.json({job:admissionUser.projectExecution?safeScopedJob(job!):serializeJob(job!),accepted:true},{status:202});
}
