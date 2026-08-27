import { audioAdapterContractForModel, normalizeAudioRequestProfile } from "../src/model/audio.ts";
import { creativeContextRightsIssue } from "../src/model/context-health.ts";
import { documentArtifactValidationIssues, parseDocumentArtifactContent } from "../src/model/document-artifacts.ts";
import { hasUnresolvedProviderSubmission, providerSubmissions } from "../src/model/provider-submission.ts";
import { standingConstraints } from "../src/model/taste.ts";
import { authoritativeCreativeContext } from "./context-authority.ts";
import { effectivePilotParticipantSql, effectivePilotReviewerSql } from "./access-policy.ts";
import type { DocumentJobRow } from "./document-jobs-api.ts";
import { recoverAcceptedAudio, verifiedAudioRecoveryQueue, type CreativeAudioPreparedReceipt } from "./fal-audio-adapter.ts";
import { storeGeneratedMedia } from "./media-api.ts";
import { POLICY_VERSION, storePrivateContent, type PilotUser } from "./pilot-policy.ts";
import { readProjectSourceEvents } from "./project-access.ts";
import { ProviderRequestError } from "./provider-errors.ts";
import { LIVE_REPLAY_PRICING_VERSION, hasKnownTextModelPricing, priceTextUsageBreakdownMicrousd } from "./replay-cost.ts";
import { EVENT_WRITE_COLUMNS, eventWriteBindings, makeEvent, readWorkspaceEvents, serializeEvent, streamHead, uuidV7, type EventRow, type WorkerEnv } from "./runtime.ts";

type Guard = { sql: string; bindings: Array<string | number | null> };
type Control = { signal: AbortSignal; beginCommit: () => Promise<void>; progress: (stage: string, message: string, patch?: Record<string, unknown>) => Promise<void> };
type Execution = { projectGuard: Guard; run: <T>(row: DocumentJobRow, operation: (control: Control) => Promise<T>) => Promise<T> };
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const parse = (value: string | null) => { try { return record(JSON.parse(value ?? "{}")); } catch { return {}; } };
const jsonEqual = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const nowSql = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
class RecoveryUnavailable extends Error {}
function requireEvidence(condition: unknown, reason: string): asserts condition { if (!condition) throw new RecoveryUnavailable(reason); }
async function sha256(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
}

/** This narrow eligibility hint grants no authority; the service independently verifies every receipt. */
export function originalSourceAudioRecoveryRequested(row: DocumentJobRow) {
  const request = parse(row.request_json), checkpoint = parse(row.result_json);
  return row.kind === "render_document" && request.artifactKind === "audio"
    && (record(checkpoint.errorDetail).code === "context_source_version_mismatch" || checkpoint.audioOriginalSourceRecovery !== undefined || checkpoint.audioRecoveredOriginalSource === true);
}

/**
 * Retrieve one already-paid manual recording. Historical evidence proves what was
 * purchased; live authorization proves whether it may be retrieved and stored now.
 * This path has no planner, upload, provider POST, reservation, or settlement call.
 */
export async function recoverOriginalSourceAudio(env: WorkerEnv, user: PilotUser, row: DocumentJobRow, projectContextId: string, execution: Execution): Promise<{ job: DocumentJobRow; recovered: true } | { error: string; reason: string; status: number }> {
  const unavailable = (reason: string, status = 409) => ({ error: "audio_original_source_recovery_unavailable", reason, status });
  const request = parse(row.request_json), checkpoint = parse(row.result_json), receipt = record(checkpoint.generationReceipt);
  const scope = user.projectExecution, historyOwner = row.stream_id.replace(/^creative:/u, "");
  const originalInputId = String(receipt.input_ref ?? "");
  const artifactId = String(checkpoint.artifactId ?? ""), providerId = String(checkpoint.providerJobId ?? ""), model = String(checkpoint.providerModel ?? "");
  const audioInput = record(checkpoint.audioInputReceipt), queue = record(audioInput.queue);
  const originalHash = String(receipt.source_snapshot_sha256 ?? "");
  const stagedContent: Array<{ id: string; owner: string; kind: string }> = [];
  let stagedMedia: Awaited<ReturnType<typeof storeGeneratedMedia>> | null = null;
  const correlationId = `${row.job_id}:audio-recovery:${uuidV7()}`;
  let claimed = false;
  let phase = "verifying-original-evidence";
  try {
    requireEvidence(row.owner_id === user.userId && row.stream_id === user.streamId && row.expires_at > new Date().toISOString(), "job_authorization_or_retention");
    if (row.status === "completed" && checkpoint.audioRecoveredOriginalSource === true) return { job: row, recovered: true };
    const marker = record(checkpoint.audioOriginalSourceRecovery);
    const interruptedRecovery = record(checkpoint.errorDetail).code === "execution_interrupted" && marker.version === 1
      && marker.originalSourceSha256 === originalHash && marker.providerJobId === providerId && marker.originalError === "context_source_version_mismatch";
    requireEvidence(row.status === "failed" && row.kind === "render_document" && request.artifactKind === "audio"
      && (record(checkpoint.errorDetail).code === "context_source_version_mismatch" || interruptedRecovery), "recovery_not_applicable");
    requireEvidence(request.paidMediaConfirmed === true && request.productionMode !== "managed" && !request.workflowId && !request.workflowStageId
      && (!request.workflowSources || Array.isArray(request.workflowSources) && request.workflowSources.length === 0) && !request.canvasId && !request.contextSetId && !request.contextRootBlockId
      && !request.audioImageBlockId && !request.audioVideoArtifactId && request.sendAudioVideoToProvider !== true
      && !checkpoint.productionPlan && !hasUnresolvedProviderSubmission(checkpoint), "unsupported_or_uncertain_recovery");
    requireEvidence(artifactId && originalInputId && /^[0-9a-f]{64}$/u.test(originalHash) && checkpoint.audioProviderSubmission === "confirmed"
      && audioInput.provider === "fal" && audioInput.model === model && audioInput.provider_job_id === providerId
      && audioInput.audio_waveform_submitted === false && !audioInput.image_reference && !audioInput.video_reference
      && audioInput.source_audio_treatment === "none" && (!Array.isArray(audioInput.source_audio_block_ids) || audioInput.source_audio_block_ids.length === 0), "accepted_audio_receipt_missing");
    verifiedAudioRecoveryQueue(model, providerId, { providerStatusUrl: String(checkpoint.providerStatusUrl ?? ""), providerResponseUrl: String(checkpoint.providerResponseUrl ?? ""), providerCancelUrl: String(checkpoint.providerCancelUrl ?? "") });
    requireEvidence(queue.status_url === checkpoint.providerStatusUrl && queue.response_url === checkpoint.providerResponseUrl && queue.cancel_url === checkpoint.providerCancelUrl, "queue_receipts_disagree");

    const authorization: Guard = {
      sql: `EXISTS(SELECT 1 FROM users actor WHERE actor.user_id=? AND actor.consent_version=?) AND ${execution.projectGuard.sql}`,
      bindings: [user.userId, POLICY_VERSION, ...execution.projectGuard.bindings],
    };
    if (scope) {
      requireEvidence(scope.actorUserId === user.userId && scope.ownerUserId === historyOwner && projectContextId, "project_identity_mismatch");
      authorization.sql += ` AND EXISTS(SELECT 1 FROM project_context_sessions selection
        JOIN project_resource_scopes resource ON resource.resource_kind='job' AND resource.resource_id=?
          AND resource.project_access_id=selection.project_access_id AND resource.organization_id=selection.organization_id
          AND resource.project_id=? AND resource.owner_user_id=? AND resource.actor_user_id=selection.principal_user_id AND resource.visibility='actor_private'
        JOIN events anchor ON anchor.event_id=resource.source_event_id AND anchor.stream_id=? AND anchor.type='ProjectDocumentJobQueued'
          AND anchor.actor='user:'||resource.actor_user_id AND json_extract(anchor.payload,'$.job_id')=resource.resource_id
          AND json_extract(anchor.payload,'$.organization_id')=resource.organization_id AND json_extract(anchor.payload,'$.project_access_id')=resource.project_access_id
          AND json_extract(anchor.payload,'$.actor_user_id')=resource.actor_user_id
        WHERE selection.context_id=? AND selection.principal_user_id=? AND selection.organization_id=? AND selection.project_access_id=?
          AND selection.revoked_at IS NULL AND selection.expires_at>${nowSql}
          AND ${effectivePilotParticipantSql("selection.organization_id", "selection.principal_user_id")}
          AND NOT ${effectivePilotReviewerSql("selection.organization_id", "selection.principal_user_id")})`;
      authorization.bindings.push(row.job_id, scope.projectId, scope.ownerUserId, row.stream_id, projectContextId, user.userId, scope.organizationId, scope.projectAccessId);
    } else {
      requireEvidence(historyOwner === user.userId, "personal_history_owner_mismatch");
      authorization.sql += " AND NOT EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.resource_kind='job' AND resource.resource_id=?)";
      authorization.bindings.push(row.job_id);
    }
    const authorize = async () => requireEvidence(await env.DB.prepare(`SELECT 1 AS allowed WHERE ${authorization.sql}`).bind(...authorization.bindings).first(), "live_authorization_revoked");
    await authorize();
    const inputScope: Guard = scope ? {
      sql: `EXISTS(SELECT 1 FROM project_resource_scopes resource JOIN private_content_retention_scopes retention
        ON retention.content_id=resource.resource_id AND retention.organization_id=resource.organization_id AND retention.project_access_id=resource.project_access_id
          AND retention.project_id=resource.project_id AND retention.actor_user_id=resource.actor_user_id AND retention.classification='governed-evidence'
          AND retention.assigned_expires_at=content.expires_at
        WHERE resource.resource_kind='content' AND resource.resource_id=content.content_id AND resource.visibility='actor_private'
          AND resource.project_access_id=? AND resource.organization_id=? AND resource.project_id=? AND resource.owner_user_id=? AND resource.actor_user_id=?)`,
      bindings: [scope.projectAccessId, scope.organizationId, scope.projectId, scope.ownerUserId, user.userId],
    } : { sql: "NOT EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.resource_kind='content' AND resource.resource_id=content.content_id)", bindings: [] };
    const source = await env.DB.prepare(`SELECT content.content,content.expires_at FROM private_content content
      WHERE content.content_id=? AND content.owner_id=? AND content.kind='document-artifact-input' AND content.redacted_at IS NULL
        AND content.expires_at>${nowSql} AND json_valid(content.content) AND ${inputScope.sql}`)
      .bind(originalInputId, user.userId, ...inputScope.bindings).first<{ content: string; expires_at: string }>();
    requireEvidence(source, "original_private_input_unavailable");
    const input = parse(source.content), snapshot = record(input.document_snapshot), originalSettings = record(input.request);
    requireEvidence(input.job_id === row.job_id && input.document_id === row.document_id && input.artifact_kind === "audio"
      && record(input.source).snapshot_sha256 === originalHash && await sha256(snapshot) === originalHash
      && jsonEqual(snapshot, request.snapshot) && jsonEqual(input.source_block_versions, request.sourceBlockVersions)
      && !snapshot.canvas && !snapshot.context_scope && !input.production_workflow_snapshot, "original_source_integrity_mismatch");
    const profile = normalizeAudioRequestProfile(originalSettings.audio_profile, snapshot);
    requireEvidence(profile.goal === "music" && profile.destination === "standalone" && originalSettings.audio_provider_model === model
      && jsonEqual(profile, normalizeAudioRequestProfile(request.audioProfile, snapshot)), "original_audio_profile_mismatch");
    const plan = parseDocumentArtifactContent(JSON.stringify(checkpoint.artifactPlan));
    requireEvidence(plan && documentArtifactValidationIssues("audio", plan, { itemCount: Number(originalSettings.item_count ?? 1) }).length === 0, "paid_plan_unavailable");
    let plannerResponseId = String(checkpoint.plannerResponseId ?? "");
    let legacyPlannerResponseId: string | null = null;
    requireEvidence(plannerResponseId && typeof audioInput.submitted_prompt === "string" && audioInput.submitted_prompt.trim(), "paid_planner_or_prompt_missing");

    // The legacy audio producer retained its acceptance in audioInputReceipt, not
    // providerSubmissions.audio. Independently prove the immutable paid event chain.
    const paidRows = await env.DB.prepare(`SELECT event.*,secret.private_json FROM events event
      JOIN event_private_payloads secret ON secret.private_event_id=event.event_id AND secret.owner_id=?
        AND secret.document_id=? AND secret.redacted_at IS NULL AND json_valid(secret.private_json)
      WHERE event.stream_id=? AND (event.correlation_id=? OR event.correlation_id GLOB ?)
        AND event.type IN('DocumentRenderRequested','DocumentRenderFailed','GenerationUsageRecorded') ORDER BY event.sequence`)
      .bind(historyOwner, row.document_id, row.stream_id, row.job_id, `${row.job_id}:attempt:*`).all<Record<string, unknown>>();
    const paidEvents = paidRows.results.map(serializeEvent);
    const failed = paidEvents.find(event => event.type === "DocumentRenderFailed" && event.actor === "worker:renderer"
      && event.payload.artifact_id === artifactId && event.payload.document_id === row.document_id && event.payload.artifact_kind === "audio" && event.payload.provider_job_id === providerId);
    const requested = failed && paidEvents.find(event => event.eventId === failed.causationId && event.type === "DocumentRenderRequested"
      && event.actor === (scope ? `user:${user.userId}` : "user") && event.correlationId === failed.correlationId && event.sequence < failed.sequence
      && event.payload.document_id === row.document_id && event.payload.artifact_id === artifactId && event.payload.artifact_kind === "audio"
      && event.payload.paid_media_confirmed === true && event.payload.resumed_provider_job === false && event.payload.production_mode === "manual");
    const usage = failed && paidEvents.find(event => event.type === "GenerationUsageRecorded" && event.actor === "worker:policy"
      && event.causationId === failed.eventId && event.correlationId === failed.correlationId && event.sequence > failed.sequence
      && event.payload.artifact_id === artifactId && event.payload.document_id === row.document_id && event.payload.artifact_kind === "audio"
      && event.payload.provider_job_id === providerId);
    if (!(requested && failed && usage)) {
      // Diagnose only this already-authorized job. Counts and predicate results
      // cannot replace retained evidence or make a failed verification succeed.
      // No private values, envelope bodies, prompts, or provider URLs are logged.
      try {
        const counts = await env.DB.prepare(`SELECT event.type,COUNT(*) AS event_count,
          SUM(CASE WHEN secret.private_event_id IS NOT NULL THEN 1 ELSE 0 END) AS envelope_count,
          SUM(CASE WHEN secret.owner_id=? THEN 1 ELSE 0 END) AS owner_match_count,
          SUM(CASE WHEN secret.document_id=? THEN 1 ELSE 0 END) AS document_match_count,
          SUM(CASE WHEN secret.redacted_at IS NULL AND json_valid(secret.private_json) THEN 1 ELSE 0 END) AS retained_json_count
          FROM events event LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id
          WHERE event.stream_id=? AND (event.correlation_id=? OR event.correlation_id GLOB ?)
            AND event.type IN('DocumentRenderRequested','DocumentRenderFailed','GenerationUsageRecorded') GROUP BY event.type`)
          .bind(historyOwner, row.document_id, row.stream_id, row.job_id, `${row.job_id}:attempt:*`).all<Record<string, unknown>>();
        const candidates = ["DocumentRenderRequested", "DocumentRenderFailed", "GenerationUsageRecorded"].map(type => ({
          type,
          checks: paidEvents.filter(event => event.type === type).slice(0, 3).map(event => ({
            actor: event.actor === (type === "DocumentRenderRequested" ? scope ? `user:${user.userId}` : "user" : type === "DocumentRenderFailed" ? "worker:renderer" : "worker:policy"),
            artifact: event.payload.artifact_id === artifactId,
            document: event.payload.document_id === row.document_id,
            audio: event.payload.artifact_kind === "audio",
            provider: event.payload.provider_job_id === providerId,
            planner: event.payload.planner_response_id === plannerResponseId,
            consent: event.payload.paid_media_confirmed === true,
            original: event.payload.resumed_provider_job === false,
            manual: event.payload.production_mode === "manual",
            linkedRequest: Boolean(failed && event.eventId === failed.causationId && event.correlationId === failed.correlationId && event.sequence < failed.sequence),
            linkedUsage: Boolean(failed && event.causationId === failed.eventId && event.correlationId === failed.correlationId && event.sequence > failed.sequence),
            interruptedUsage: event.payload.operation === "document-render:audio:interrupted",
          })),
        }));
        console.error("audio_original_source_recovery_chain_diagnostic", { jobId: row.job_id, counts: counts.results, candidates });
      } catch { /* Diagnostics must never change the failed verification result. */ }
    }
    requireEvidence(requested && failed && usage, "original_paid_event_chain_missing");
    if (usage.payload.planner_response_id !== plannerResponseId) {
      // Released progress writers pinned the scalar to the FIRST paid response,
      // even when a bounded repair supplied the final plan. Prove both distinct
      // roles against the immutable final-ID usage; never accept an arbitrary
      // alternative ID or an unverified checkpoint flag.
      const validation = record(record(checkpoint.plannerInput).validation);
      const responseIds = Array.isArray(validation.provider_response_ids) ? validation.provider_response_ids : [];
      const finalResponseId = usage.payload.planner_response_id;
      requireEvidence(typeof finalResponseId === "string" && finalResponseId && responseIds.length === 2
        && responseIds.every(id => typeof id === "string" && id) && new Set(responseIds).size === 2
        && responseIds[0] === plannerResponseId && responseIds[1] === finalResponseId
        && jsonEqual(responseIds, checkpoint.plannerResponseIds)
        && validation.repair_attempted === true && validation.repair_response_id === finalResponseId
        && validation.provider_call_count === 2 && validation.maximum_provider_calls === 2
        && Array.isArray(validation.initial_issues) && validation.initial_issues.length > 0
        && Array.isArray(validation.repair_issues) && validation.repair_issues.length === 0, "original_repaired_planner_identity_mismatch");
      const planning = providerSubmissions(checkpoint).filter(receipt => receipt.operation === "planning");
      const submittedModel = String(record(input.planner).model ?? ""), returnedModel = String(checkpoint.plannerModel ?? "");
      requireEvidence(record(input.planner).provider === "openai" && hasKnownTextModelPricing(submittedModel) && hasKnownTextModelPricing(returnedModel)
        && planning.length === 2 && new Set(planning.map(receipt => receipt.providerRequestId)).size === 2
        && planning.every(receipt => receipt.provider === "openai" && receipt.status === "completed" && receipt.model === submittedModel
          && responseIds.includes(receipt.providerRequestId) && Number.isSafeInteger(receipt.costMicrousd) && Number(receipt.costMicrousd) > 0
          && [receipt.inputTokens, receipt.outputTokens, receipt.totalTokens].every(value => Number.isSafeInteger(value) && Number(value) >= 0)
          && receipt.totalTokens === Number(receipt.inputTokens) + Number(receipt.outputTokens))
        && Array.isArray(usage.payload.model_ids) && usage.payload.model_ids.includes(returnedModel), "original_repaired_planner_receipts_missing");
      const aggregate = planning.reduce((total, receipt) => ({ inputTokens: total.inputTokens + Number(receipt.inputTokens), outputTokens: total.outputTokens + Number(receipt.outputTokens), totalTokens: total.totalTokens + Number(receipt.totalTokens) }), { inputTokens: 0, outputTokens: 0, totalTokens: 0 });
      const retainedUsage = record(checkpoint.plannerUsage);
      requireEvidence(aggregate.inputTokens === usage.payload.input_tokens && aggregate.outputTokens === usage.payload.output_tokens
        && aggregate.totalTokens === usage.payload.total_tokens && aggregate.totalTokens === usage.payload.planner_tokens
        && aggregate.inputTokens === retainedUsage.inputTokens && aggregate.outputTokens === retainedUsage.outputTokens && aggregate.totalTokens === retainedUsage.totalTokens
        && usage.payload.pricing_version === LIVE_REPLAY_PRICING_VERSION
        && planning.every(receipt => receipt.costMicrousd === priceTextUsageBreakdownMicrousd(submittedModel, { inputTokens: Number(receipt.inputTokens), outputTokens: Number(receipt.outputTokens), totalTokens: Number(receipt.totalTokens) }).totalMicrousd)
        && usage.payload.planner_cost_microusd === priceTextUsageBreakdownMicrousd(returnedModel, aggregate).totalMicrousd, "original_repaired_planner_accounting_mismatch");
      legacyPlannerResponseId = plannerResponseId;
      plannerResponseId = finalResponseId;
    }
    requireEvidence(usage.payload.planner_response_id === plannerResponseId, "original_paid_planner_mismatch");
    const costId = String(usage.payload.cost_reservation_id ?? ""), settledCost = Number(usage.payload.cost_microusd ?? 0);
    const audioCost = Number(record(audioInput.parameters).published_cost_microusd ?? 0);
    requireEvidence(Number.isSafeInteger(settledCost) && Number.isSafeInteger(audioCost) && audioCost > 0
      && settledCost === audioCost + Number(usage.payload.planner_cost_microusd ?? -1)
      && audioCost === Number(originalSettings.audio_provider_estimated_cost_microusd) && audioCost === Number(checkpoint.audioEstimatedCostMicrousd), "original_charge_mismatch");
    const settlement: Guard = {
      sql: "EXISTS(SELECT 1 FROM cost_budget_reservations cost WHERE cost.reservation_id=? AND cost.owner_id=? AND cost.stream_id=? AND cost.correlation_id=? AND cost.operation='document-render:audio' AND cost.status='settled' AND cost.used_microusd=?)",
      bindings: [costId, user.billingUserId ?? user.userId, row.stream_id, requested.correlationId, settledCost],
    };
    requireEvidence(await env.DB.prepare(`SELECT 1 AS settled WHERE ${settlement.sql}`).bind(...settlement.bindings).first(), "original_settlement_unavailable");
    const events = scope ? await readProjectSourceEvents(env, scope) : await readWorkspaceEvents(env, user.streamId);
    const projectId = String(requested.payload.project_id ?? "");
    requireEvidence(projectId && (!scope || scope.projectId === projectId), "original_project_mismatch");
    const history = events.filter(event => event.sequence < requested.sequence);
    const historical = authoritativeCreativeContext(history, { documentId: row.document_id, projectId, snapshot, sourceBlockVersions: request.sourceBlockVersions as Array<Record<string, unknown>> });
    requireEvidence(await sha256(historical.snapshot) === originalHash && historical.documentRevision === request.documentRevision, "historical_source_mismatch");
    const originalActiveVersions = historical.projection.blocks.filter(block => block.properties.active !== false && Number(block.properties.weight ?? .5) > 0)
      .map(block => ({ block_id: block.id, version: block.sourceEvents.length }));
    const originallyActive = new Set(originalActiveVersions.map(source => source.block_id));
    requireEvidence(jsonEqual(requested.payload.source_block_versions, originalActiveVersions)
      && Number(requested.payload.item_count) === plan.items.length && String(requested.payload.tone ?? "document-derived") === String(originalSettings.tone)
      && String(requested.payload.audience ?? "general") === String(originalSettings.audience), "original_request_settings_mismatch");
    const document = historical.projection.documents.find(candidate => candidate.id === row.document_id)!;
    const preferences = standingConstraints(history).map(item => ({ preference_id: item.preferenceId, axis: item.axis, value: item.value, polarity: item.polarity, authority: "authored", source_event_refs: item.evidenceRefs, source_claim_ref: item.sourceClaimRef ?? null }));
    const compiledSnapshot = { ...snapshot, document: { id: document.id, title: document.title }, ...(preferences.length ? { standing_constraints: preferences } : {}) };
    const facts = (Array.isArray(snapshot.facts) ? snapshot.facts : []).map(record);
    // No flattening of governed packages or external workflow lineage in this
    // bounded manual-music recovery. Such requests require their own verifier.
    requireEvidence(facts.length && facts.every(fact => !record(fact.properties).organization_context_package_id && !record(fact.properties).organization_context_package_version_id), "unsupported_governed_package_recovery");
    const evidenceIds = new Set<string>([requested.eventId, failed.eventId, usage.eventId]);
    for (const member of [...facts, ...(Array.isArray(snapshot.relationships) ? snapshot.relationships.map(record) : []), ...preferences]) {
      for (const id of Array.isArray(member.source_event_refs) ? member.source_event_refs : []) evidenceIds.add(String(id));
    }
    for (const event of history) if (["DocumentCreated", "DocumentForked", "DocumentRenamed"].includes(event.type) && event.payload.document_id === row.document_id) evidenceIds.add(event.eventId);
    const evidenceRows = await env.DB.prepare(`SELECT event.event_id,secret.private_json FROM json_each(?) wanted
      JOIN events event ON event.event_id=wanted.value AND event.stream_id=?
      JOIN event_private_payloads secret ON secret.private_event_id=event.event_id AND secret.owner_id=? AND secret.redacted_at IS NULL AND json_valid(secret.private_json)`)
      .bind(JSON.stringify([...evidenceIds]), row.stream_id, historyOwner).all<{ event_id: string; private_json: string }>();
    requireEvidence(evidenceRows.results.length === evidenceIds.size, "original_private_history_unavailable");
    const retainedEvidence = JSON.stringify(evidenceRows.results);
    const evidenceGuard: Guard = {
      sql: `NOT EXISTS(SELECT 1 FROM json_each(?) expected LEFT JOIN events event
        ON event.event_id=json_extract(expected.value,'$.event_id') AND event.stream_id=?
        LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id AND secret.owner_id=?
          AND secret.redacted_at IS NULL AND secret.private_json=json_extract(expected.value,'$.private_json')
        WHERE event.event_id IS NULL OR secret.private_event_id IS NULL)`, bindings: [retainedEvidence, row.stream_id, historyOwner],
    };
    const inputGuard: Guard = {
      sql: `EXISTS(SELECT 1 FROM private_content content WHERE content.content_id=? AND content.owner_id=? AND content.kind='document-artifact-input'
        AND content.redacted_at IS NULL AND content.expires_at>${nowSql} AND content.content=? AND ${inputScope.sql})`,
      bindings: [originalInputId, user.userId, source.content, ...inputScope.bindings],
    };
    const durable: Guard = { sql: [authorization.sql, inputGuard.sql, evidenceGuard.sql, settlement.sql].join(" AND "), bindings: [...authorization.bindings, ...inputGuard.bindings, ...evidenceGuard.bindings, ...settlement.bindings] };
    const validateCurrent = async () => {
      requireEvidence(await env.DB.prepare(`SELECT 1 AS verified WHERE ${durable.sql}`).bind(...durable.bindings).first(), "live_evidence_or_authorization_revoked");
      const head = await streamHead(env, user.streamId);
      const current = scope ? await readProjectSourceEvents(env, scope) : await readWorkspaceEvents(env, user.streamId);
      // Only the equality-of-version check is omitted in this separate CURRENT
      // authorization query. Its output is never used as the recording's source.
      const authorized = authoritativeCreativeContext(current, { documentId: row.document_id, projectId, snapshot });
      for (const fact of facts) {
        const block = authorized.projection.blocks.find(candidate => candidate.id === fact.block_id);
        requireEvidence(block && !block.removed && (!originallyActive.has(block.id) || block.properties.active !== false && Number(block.properties.weight ?? .5) > 0)
          && !creativeContextRightsIssue(record(fact.properties)) && !creativeContextRightsIssue(block.properties)
          && !block.properties.organization_context_package_id && !block.properties.organization_context_package_version_id, "original_source_no_longer_authorized");
      }
      requireEvidence(await streamHead(env, user.streamId) === head, "source_changed_during_verification");
      return head;
    };
    await validateCurrent();
    const started = new Date().toISOString();
    // This server-written routing marker survives worker interruption. It never
    // substitutes for acceptance/source/settlement verification on the next run.
    const claimedResult = { ...checkpoint, audioOriginalSourceRecovery: { version: 1, originalSourceSha256: originalHash, providerJobId: providerId, originalError: "context_source_version_mismatch" }, stage: "recovering-audio", progressMessage: "Verifying the original paid recording and its original source. No new generation will be purchased." };
    const claim = await env.DB.prepare(`UPDATE document_jobs SET status='running',correlation_id=?,result_json=?,error_message=NULL,started_at=?,completed_at=NULL,lease_expires_at=?,updated_at=?
      WHERE job_id=? AND owner_id=? AND stream_id=? AND status='failed' AND correlation_id=? AND result_json IS ? AND request_json=? AND expires_at>${nowSql}
        AND NOT EXISTS(SELECT 1 FROM events completed WHERE completed.stream_id=document_jobs.stream_id AND completed.type='DocumentRenderCompleted' AND json_extract(completed.payload,'$.artifact_id')=?)
        AND ${durable.sql}`)
      .bind(correlationId, JSON.stringify(claimedResult), started, new Date(Date.now() + 75_000).toISOString(), started, row.job_id, user.userId, user.streamId, row.correlation_id, row.result_json, row.request_json, artifactId, ...durable.bindings).run();
    requireEvidence(Number(claim.meta.changes ?? 0) === 1, "recovery_conflict");
    claimed = true;
    const running: DocumentJobRow = { ...row, status: "running", correlation_id: correlationId, result_json: JSON.stringify(claimedResult), started_at: started };
    return await execution.run(running, async control => {
      phase = "retrieving-original-recording";
      const prepared: CreativeAudioPreparedReceipt = { provider: "fal", model, submittedPrompt: String(audioInput.submitted_prompt), parameters: record(audioInput.parameters), imageReference: null, sourceAudioTreatment: "none", audioWaveformSubmitted: false };
      const audio = await recoverAcceptedAudio(env, { providerJobId: providerId, providerModel: model, providerStatusUrl: String(queue.status_url), providerResponseUrl: String(queue.response_url), providerCancelUrl: String(queue.cancel_url), retainedReceipt: prepared, profile, signal: control.signal,
        onStage: async (stage, message) => {
          if (stage === "finalizing") phase = "retrieving-original-result";
          else if (stage === "downloading") phase = "downloading-original-recording";
          await authorize(); await control.progress(stage, message);
        } });
      requireEvidence(audio.costMicrousd === audioCost, "provider_original_charge_mismatch");
      phase = "rechecking-current-authority";
      await validateCurrent();
      await control.beginCommit();
      phase = "saving-recovered-audio";
      stagedMedia = await storeGeneratedMedia(env, historyOwner, `${artifactId}-recovery-${uuidV7()}`, audio.bytes, model, audio.mimeType, { artifactRole: "document-audio", artifactId, providerJobId: providerId, provider: "fal", recoveryJobId: row.job_id });
      const accounting = { settled_cost_microusd: settledCost, incremental_cost_microusd: 0, original_cost_reservation_id: costId };
      const recovery = { mode: "original-source-provider-verified", original_job_id: row.job_id, original_input_ref: originalInputId, original_source_revision: String(request.documentRevision), original_source_snapshot_sha256: originalHash,
        original_request_event_id: requested.eventId, original_failure_event_id: failed.eventId, original_usage_event_id: usage.eventId, provider_job_id: providerId, new_generation_requests: 0, provider_retrieval_only: true, current_edits_preserved: true };
      const savedInput = { schema_version: 1, job_id: row.job_id, artifact_id: artifactId, artifact_kind: "audio", document_id: row.document_id, project_id: projectId, captured_at: new Date().toISOString(),
        request: { ...originalSettings, source_surface: row.source_surface }, document_snapshot: compiledSnapshot, original_document_snapshot: snapshot, source_block_versions: originalActiveVersions, admitted_source_block_versions: input.source_block_versions,
        source: { snapshot_sha256: originalHash, document_revision: request.documentRevision }, planner: { ...record(checkpoint.plannerInput), provider: "openai", model: checkpoint.plannerModel, response_id: plannerResponseId, ...(legacyPlannerResponseId ? { legacy_checkpoint_response_id: legacyPlannerResponseId } : {}) }, render: audioInput, accounting, recovery };
      const content = await storePrivateContent(env, historyOwner, "document-artifact", JSON.stringify(plan)); stagedContent.push({ id: content.contentId, owner: historyOwner, kind: "document-artifact" });
      const saved = await storePrivateContent(env, user.userId, "document-artifact-input", JSON.stringify(savedInput), scope); stagedContent.push({ id: saved.contentId, owner: user.userId, kind: "document-artifact-input" });
      const head = await validateCurrent();
      const finishedAt = new Date().toISOString(), contract = audioAdapterContractForModel(model)!;
      const completed = makeEvent(user.streamId, head + 1, "worker:renderer", "server:document-job:render_document", correlationId, "DocumentRenderCompleted", {
        artifact_id: artifactId, artifact_kind: "audio", document_id: row.document_id, project_id: projectId, requested_by_user_id: user.userId, source_block_versions: originalActiveVersions,
        title: plan.title, summary: plan.summary, content_ref: content.contentId, content_expires_at: content.expiresAt, input_ref: saved.contentId, input_expires_at: saved.expiresAt,
        item_count: plan.items.length, items: plan.items.map((item, index) => ({ id: `${artifactId}-item-${index + 1}`, title: item.title, context_group_ids: item.context_group_ids ?? [], media_url: null, media_type: null })), presentation: null,
        media_url: stagedMedia.url, media_type: stagedMedia.mimeType, provider: "fal", provider_job_id: providerId, model_id: model, planner_model_id: checkpoint.plannerModel, planner_response_id: plannerResponseId,
        reference_inputs: [], used_reference_pixels: false, latency_ms: Number(checkpoint.plannerLatencyMs ?? 0) + audio.latencyMs, recovery,
        settings: { ...originalSettings, ...accounting, production_mode: "manual", audio_profile: profile, audio_provider_model: model, source_media_sha256: stagedMedia.contentHash, duration_seconds: stagedMedia.durationSeconds,
          audio_goal: profile.goal, audio_role: profile.role, audio_destination: profile.destination, audio_synthid_watermarked: contract.watermark === "synthid", audio_watermark_basis: contract.watermark === "synthid" ? "provider-disclosed" : null, lyrics: audio.lyrics, recovery }, source_surface: row.source_surface,
      }, { causationId: requested.eventId });
      const recoveredUsage = makeEvent(user.streamId, head + 2, "worker:policy", "server:document-job:render_document", correlationId, "GenerationUsageRecorded", {
        operation: "document-render:audio:recovery", artifact_id: artifactId, artifact_kind: "audio", document_id: row.document_id, project_id: projectId, cost_reservation_id: costId,
        input_tokens: 0, output_tokens: 0, total_tokens: 0, planner_tokens: 0, reserved_tokens: 0, reserved_microusd: 0, cost_microusd: 0, audio_cost_microusd: 0, planner_cost_microusd: 0,
        previously_settled_cost_microusd: settledCost, planner_response_id: plannerResponseId, provider_job_id: providerId, model_ids: [String(checkpoint.plannerModel), model], planner_cost_previously_recorded: true, planner_usage_previously_recorded: true, recovery,
      }, { causationId: completed.eventId });
      const result = { ...checkpoint, plannerResponseId, artifactId, artifactKind: "audio", audioRecoveredOriginalSource: true, recovery,
        generationReceipt: { ...receipt, settled_cost_microusd: settledCost, incremental_cost_microusd: 0, original_input_ref: originalInputId, recovered_input_ref: saved.contentId, provider_request_status: "completed", reservation_status: "settled", recovery },
        head: recoveredUsage.sequence, eventIds: [completed.eventId, recoveredUsage.eventId], stage: "completed", progressMessage: "Recovered the original paid audio with its original source. Newer edits are unchanged; no new generation was purchased." } as Record<string, unknown>;
      delete result.errorDetail; delete result.dismissedAt;
      const jobGuard = "EXISTS(SELECT 1 FROM document_jobs job WHERE job.job_id=? AND job.owner_id=? AND job.stream_id=? AND job.correlation_id=? AND job.status='committing' AND job.request_json=? AND job.expires_at>" + nowSql + ")";
      const jobBindings = [row.job_id, user.userId, user.streamId, correlationId, row.request_json];
      const insert = (event: EventRow, expectedHead: number) => env.DB.prepare(`INSERT INTO event_write_stage (${EVENT_WRITE_COLUMNS}) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
        WHERE (SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=? AND ${jobGuard} AND ${durable.sql}`)
        .bind(...eventWriteBindings(event), user.streamId, expectedHead, ...jobBindings, ...durable.bindings);
      const finish = env.DB.prepare(`UPDATE document_jobs SET status='completed',result_json=?,error_message=NULL,completed_at=?,lease_expires_at=NULL,notified_at=NULL,updated_at=?
        WHERE job_id=? AND owner_id=? AND stream_id=? AND correlation_id=? AND status='committing' AND request_json=?
          AND (SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?
          AND EXISTS(SELECT 1 FROM events WHERE event_id=? AND stream_id=? AND sequence=?)
          AND EXISTS(SELECT 1 FROM events WHERE event_id=? AND stream_id=? AND sequence=?) AND ${durable.sql}`)
        .bind(JSON.stringify(result), finishedAt, finishedAt, ...jobBindings, user.streamId, head + 2, completed.eventId, user.streamId, head + 1, recoveredUsage.eventId, user.streamId, head + 2, ...durable.bindings);
      // Zero-row guarded writes are not SQL errors. This final assertion makes
      // the ENTIRE D1 batch roll back if either event or job completion lost CAS.
      const assertCommit = env.DB.prepare(`SELECT json(CASE WHEN EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND owner_id=? AND stream_id=? AND correlation_id=? AND status='completed'
        AND json_extract(result_json,'$.eventIds[0]')=? AND json_extract(result_json,'$.eventIds[1]')=?) THEN 'true' ELSE 'audio_recovery_commit_conflict' END) AS committed`)
        .bind(row.job_id, user.userId, user.streamId, correlationId, completed.eventId, recoveredUsage.eventId);
      phase = "committing-recovered-audio";
      await env.DB.batch([insert(completed, head), insert(recoveredUsage, head + 1), finish, assertCommit]);
      const finished = await env.DB.prepare("SELECT * FROM document_jobs WHERE job_id=? AND owner_id=? AND stream_id=? AND correlation_id=? AND status='completed'")
        .bind(row.job_id, user.userId, user.streamId, correlationId).first<DocumentJobRow>();
      requireEvidence(finished, "completion_not_verified");
      return { job: finished, recovered: true as const };
    });
  } catch (error) {
    if (claimed) {
      // Only this attempt's new staging may be removed. Never overwrite or
      // delete the original paid artifact, checkpoint, or current document.
      const liveArtifact = await env.DB.prepare("SELECT 1 AS present FROM events WHERE stream_id=? AND type='DocumentRenderCompleted' AND json_extract(payload,'$.artifact_id')=?")
        .bind(row.stream_id, artifactId).first();
      if (!liveArtifact) {
        for (const content of stagedContent) {
          try { await env.DB.prepare(`UPDATE private_content SET content='',redacted_at=? WHERE content_id=? AND owner_id=? AND kind=? AND redacted_at IS NULL
            AND NOT EXISTS(SELECT 1 FROM events completed WHERE completed.stream_id=? AND completed.type='DocumentRenderCompleted'
              AND (json_extract(completed.payload,'$.content_ref')=private_content.content_id OR json_extract(completed.payload,'$.input_ref')=private_content.content_id))
            AND NOT EXISTS(SELECT 1 FROM private_content_retention_scopes scope JOIN organization_retention_policies policy ON policy.organization_id=scope.organization_id AND policy.legal_hold=1 WHERE scope.content_id=private_content.content_id)
            AND NOT EXISTS(SELECT 1 FROM private_content_retention_scopes scope JOIN organization_legal_holds hold ON hold.organization_id=scope.organization_id AND hold.status='active'
              WHERE scope.content_id=private_content.content_id AND (hold.scope_kind='organization' OR hold.scope_kind='project' AND hold.resource_id=scope.project_access_id OR hold.scope_kind='content' AND hold.resource_id=scope.content_id))`)
            .bind(new Date().toISOString(), content.id, content.owner, content.kind, row.stream_id).run(); } catch { /* Preserve staging if cleanup cannot be proven safe. */ }
        }
        if (stagedMedia) {
          const held = scope && await env.DB.prepare("SELECT 1 AS held WHERE EXISTS(SELECT 1 FROM organization_retention_policies WHERE organization_id=? AND legal_hold=1) OR EXISTS(SELECT 1 FROM organization_legal_holds WHERE organization_id=? AND status='active' AND (scope_kind='organization' OR scope_kind='project' AND resource_id=? OR scope_kind='artifact' AND resource_id=? OR scope_kind='content' AND resource_id IN(SELECT value FROM json_each(?))))")
            .bind(scope.organizationId, scope.organizationId, scope.projectAccessId, artifactId, JSON.stringify([originalInputId, ...stagedContent.map(content => content.id)])).first();
          if (!held) try { await env.MEDIA.delete(stagedMedia.key); } catch { /* Attempt-owned private staging can be swept later. */ }
        }
      }
      await env.DB.prepare("UPDATE document_jobs SET status='failed',correlation_id=?,result_json=?,error_message=?,started_at=?,completed_at=?,lease_expires_at=NULL,updated_at=? WHERE job_id=? AND owner_id=? AND stream_id=? AND correlation_id=? AND status IN('running','committing')")
        .bind(row.correlation_id, row.result_json, row.error_message, row.started_at, row.completed_at, new Date().toISOString(), row.job_id, user.userId, user.streamId, correlationId).run();
    }
    const reason = error instanceof RecoveryUnavailable ? error.message : error instanceof ProviderRequestError ? error.detail.code : error instanceof Error && "code" in error ? String(error.code) : "provider_or_storage_verification_failed";
    // Operational identifiers only: never log source text, prompts, credentials,
    // media URLs, private envelopes, or raw provider/database error messages.
    console.error("audio_original_source_recovery_unavailable", { jobId: row.job_id, phase, reason,
      ...(error instanceof ProviderRequestError ? { providerHttpStatus: error.detail.httpStatus, providerFailureCategory: error.detail.category, providerFailureAction: error.detail.action } : {}) });
    return unavailable(reason);
  }
}
