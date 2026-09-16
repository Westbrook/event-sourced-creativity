import { canonicalJson } from "../src/experiences/compiler.ts";
import { providerSubmissions, type PaidProviderSubmission } from "../src/model/provider-submission.ts";
import { MODEL3D_PRIVATE_TRANSFER_MAX_BYTES, RODIN_ADAPTER_VERSION } from "../src/model/model3d.ts";
import type { NativeRetainedModel3dFile } from "../src/model/native-retained-model3d.ts";
import { claimOutputModel3dRecoveryLease } from "./output-model3d-recovery-lease.ts";
import { compactModel3dRecoveryAssertions } from "./output-model3d-recovery-assertions.ts";
import { readOriginalFalModel3d } from "./fal-model3d-original-reader.ts";
import { assertOutputModel3dRecoveryPrimarySize, createOutputModel3dRecoveryAssembly, outputModel3dRecoveryStorage, remainingOutputModel3dRecoveryUsage } from "./output-model3d-recovery-completion.ts";
import { readRetainedOutputModel3d, readRetainedOutputModel3dRecovery } from "./output-model3d-retained.ts";
import { loadOutputJobBinding, reconcileKnownOutputProviderReceipts, prepareOutputJobOutcomeStatements } from "./output-execution-control.ts";
import { resolveOutputModel3dRecoveryAuthority } from "./output-requirements-api.ts";
import { guardOutputPrivateWrites } from "./output-private-execution.ts";
import { outputAssertionStatements, OutputConflictError, type OutputSqlAssertion } from "./output-requirements-ledger.ts";
import { storeGeneratedMedia } from "./media-api.ts";
import { storePrivateContent, type PilotUser } from "./pilot-policy.ts";
import { preparePrivateContent } from "./private-content-storage.ts";
import { makeEvent, appendEvents, type WorkerEnv } from "./runtime.ts";
import type { DocumentJobRow } from "./document-jobs-api.ts";
import type { Model3dGeneratedFile, Model3dProviderArtifactDescriptor } from "./fal-model3d-adapter.ts";

function fail(code = "output_model3d_recovery_unavailable"): never { throw new OutputConflictError(code, 409); }
const object = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : fail();
const parse = (v: string | null) => object(JSON.parse(v ?? "{}"));
const bounded = (v: unknown, maximum = 1048576) => { const raw = JSON.stringify(v); if (new TextEncoder().encode(raw).length > maximum) fail(); return raw; };
const hash = async (v: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", v as Uint8Array<ArrayBuffer>)), x => x.toString(16).padStart(2, "0")).join("");
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
type Lease = Awaited<ReturnType<typeof claimOutputModel3dRecoveryLease>>;
type Stored = { index: number; token: string; storageKey: string; sha256: string; file: NativeRetainedModel3dFile; providerMediaUrl: string };
export type Model3dRecoveryStage = "model3d_binding" | "model3d_authority" | "model3d_lease" | "model3d_retrieve_publish" | "model3d_result_receipt" | "model3d_file_manifest" | "model3d_file_store" | "model3d_file_qualify" | "model3d_assembly" | "model3d_content_store" | "model3d_publish";
function noteStage(options: { onStage?: (stage: Model3dRecoveryStage) => void }, stage: Model3dRecoveryStage) {
  try { options.onStage?.(stage); } catch { /* Diagnostics never alter recovery. */ }
}

/** Explicit read/publication command only. No generator, planner, queue writer,
 * new grant, reservation, provider-call claim, upload or provider POST. */
export async function recoverOutputModel3d(env: WorkerEnv, user: PilotUser, job: DocumentJobRow,
  options: { assertions: OutputSqlAssertion[]; signal?: AbortSignal; request?: Request; onStage?: (stage: Model3dRecoveryStage) => void }) {
  // The whole command has one deadline, including authority reads before the
  // accepted-original lease. D1 cannot be aborted; late continuations must not
  // progress and every later write carries this same SQL expiry assertion.
  const deadline = Math.min(Date.now() + 120000, Date.parse(job.expires_at),
    ...options.assertions.flatMap(a => a.deadlineMs === undefined ? [] : [a.deadlineMs]));
  if (!Number.isFinite(deadline) || deadline <= Date.now()) fail();
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason ?? Error("output_model3d_recovery_aborted"));
  if (options.signal?.aborted) abort(); else options.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(Error("output_model3d_recovery_deadline")), Math.max(0, deadline - Date.now()));
  let rejectStopped: () => void = () => {};
  const stopped = new Promise<never>((_, reject) => {
    rejectStopped = () => reject(controller.signal.reason);
    if (controller.signal.aborted) rejectStopped(); else controller.signal.addEventListener("abort", rejectStopped, { once: true });
  });
  const check = () => { controller.signal.throwIfAborted(); if (Date.now() >= deadline) fail(); };
  const work = async () => {
    noteStage(options,"model3d_binding");
    check(); const binding = await loadOutputJobBinding(env, user, job); check(); if (!binding) fail();
    noteStage(options,"model3d_authority");
    const proof = await resolveOutputModel3dRecoveryAuthority(env, binding.scope, binding.slot, options.request ? {request:options.request,user} : undefined); check();
    const assertions = [...proof.assertions, ...options.assertions, {
      sql: "?>strftime('%Y-%m-%dT%H:%M:%fZ','now')", bindings: [new Date(deadline).toISOString()], deadlineMs: deadline,
    }];
    const expires = Math.min(deadline, ...assertions.flatMap(a => a.deadlineMs === undefined ? [] : [a.deadlineMs]));
    if (!Number.isFinite(expires) || expires <= Date.now()) fail();
    return executeOutputModel3dRecovery(env, user, job, binding, { assertions, signal: controller.signal, onStage: options.onStage,
      current: { sourceDigest: proof.sourceDigest, requirementsDigest: proof.requirementsDigest, retentionExpiresAt: new Date(expires).toISOString() } });
  };
  try { const result = await Promise.race([stopped, work()]); check(); return result; }
  finally {
    clearTimeout(timer); options.signal?.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", rejectStopped); controller.abort();
  }
}

/** Internal actual-function fixture seam. Caller must provide current owner,
 * original-source and private-retention authority, not the old paid deadline. */
export async function executeOutputModel3dRecovery(env: WorkerEnv, user: PilotUser, job: DocumentJobRow,
  binding: NonNullable<Awaited<ReturnType<typeof loadOutputJobBinding>>>, options: {
    assertions: OutputSqlAssertion[]; signal?: AbortSignal; onStage?: (stage: Model3dRecoveryStage) => void;
    current: { sourceDigest: string; requirementsDigest: string; retentionExpiresAt: string };
  }) {
  const { scope, slot } = binding;
  if (scope.kind !== "personal" || scope.actorUserId !== user.userId || !options.assertions.length) fail();
  const original = parse(job.result_json), request = parse(job.request_json), artifactId = original.artifactId;
  if (typeof artifactId !== "string" || !artifactId) fail();
  const currentJob = () => env.DB.prepare("SELECT document_jobs.*,(SELECT relation.slot_id FROM output_operation_slots relation WHERE relation.job_id=document_jobs.job_id AND relation.scope_key=? AND relation.slot_id=?) AS output_slot_id FROM document_jobs WHERE job_id=? AND owner_id=?")
    .bind(scope.key, slot.slotId, job.job_id, scope.actorUserId).first<DocumentJobRow>();
  const completions = async () => {
    // Missing/redacted/foreign private bodies do not become false absence.
    const rows = await env.DB.prepare(`SELECT event.event_id,body.private_json,body.owner_id,body.document_id,body.redacted_at FROM events event
      LEFT JOIN event_private_payloads body ON body.private_event_id=event.event_id
      WHERE event.stream_id=? AND event.correlation_id=? AND event.type='DocumentRenderCompleted' ORDER BY event.sequence LIMIT 2`)
      .bind(job.stream_id, job.correlation_id).all<{ event_id: string; private_json: string; owner_id: string; document_id: string; redacted_at: string | null }>();
    if (rows.success === false || rows.results.length > 1) fail("output_model3d_recovery_duplicate_completion");
    const done = rows.results[0]; if (!done) return null;
    if (done.owner_id !== scope.actorUserId || done.document_id !== scope.documentId || done.redacted_at !== null
      || typeof done.private_json !== "string" || new TextEncoder().encode(done.private_json).length > 1048576
      || parse(done.private_json).artifact_id !== artifactId) fail();
    return done;
  };
  const retainedInput = async (done: NonNullable<Awaited<ReturnType<typeof completions>>>) => {
    const payload = parse(done.private_json); if (typeof payload.content_ref !== "string" || typeof payload.input_ref !== "string") fail();
    const body = await env.DB.prepare(`SELECT content,expires_at FROM private_content WHERE content_id=? AND owner_id=? AND kind='document-artifact'
      AND redacted_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND length(CAST(content AS BLOB))<=1048576
      AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=private_content.content_id)`)
      .bind(payload.content_ref, scope.actorUserId).first<{ content: string; expires_at: string }>();
    if (!body) fail();
    const assertion: OutputSqlAssertion = { sql: "EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND kind='document-artifact' AND content=? AND expires_at=? AND redacted_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=private_content.content_id))",
      bindings: [payload.content_ref, scope.actorUserId, body.content, body.expires_at], deadlineMs: Date.parse(body.expires_at) };
    return { input: { ownerId: scope.actorUserId, completionId: done.event_id, documentId: scope.documentId, projectId: scope.projectId,
      artifactId, contentId: payload.content_ref, inputId: payload.input_ref, rawContent: body.content, contentExpiresAt: body.expires_at,
      completionRaw: done.private_json, signal: options.signal }, assertion };
  };
  const completedRead = async () => {
    options.signal?.throwIfAborted(); const current = await currentJob(); if (current?.status !== "completed") return null;
    const done = await completions(); if (!done) fail(); const retained = await retainedInput(done);
    const read = await readRetainedOutputModel3d(env, retained.input);
    await env.DB.batch([...options.assertions, retained.assertion, ...read.assertions].flatMap(a => outputAssertionStatements(env, a)));
    if (options.signal?.aborted || Date.parse(read.expiresAt) <= Date.now()) fail();
    return { status: "completed" as const, jobId: job.job_id, slotId: slot.slotId, replayed: true };
  };
  if (job.status === "completed") return await completedRead() ?? fail();
  noteStage(options,"model3d_lease");
  const lease = await claimOutputModel3dRecoveryLease(env, scope, slot, job, options), cp = lease.checkpoint;
  noteStage(options,"model3d_retrieve_publish");
  let completionJson: string | undefined;
  const extra: OutputSqlAssertion[] = [], live = () => compactModel3dRecoveryAssertions([...lease.assertions(), ...extra]);
  // Conditional creation prevents even a same-key race from overwriting another
  // object. No existing artifact is deleted or rewritten to make recovery pass.
  const conditionalMedia = new Proxy(env.MEDIA, { get(target, key) {
    if (key === "put") return (key: string, value: Parameters<R2Bucket["put"]>[1], opts?: Parameters<R2Bucket["put"]>[2]) =>
      target.put(key, value, { ...opts, onlyIf: { etagDoesNotMatch: "*" } });
    const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
  } });
  const privateEnv = guardOutputPrivateWrites({ ...env, MEDIA: conditionalMedia }, scope, slot, async () => live(),
    { retentionPolicy: binding.retentionPolicy, model3dCompletionJson: () => completionJson });
  const update = async (patch: Record<string, unknown>) => {
    await lease.assertCurrent();
    await env.DB.batch([...live().flatMap(a => outputAssertionStatements(env, a)), env.DB.prepare("UPDATE document_jobs SET result_json=json_patch(result_json,?) WHERE job_id=? AND owner_id=? AND status='failed'")
      .bind(bounded(patch), job.job_id, scope.actorUserId), ...outputAssertionStatements(env, { sql: "changes()=1" })]);
  };
  const finish = (id: string, ids: string[]) => {
    const now = new Date().toISOString();
    return [env.DB.prepare("UPDATE document_jobs SET status='completed',error_message=NULL,completed_at=?,lease_expires_at=NULL,updated_at=?,result_json=json_patch(result_json,?) WHERE job_id=? AND owner_id=? AND status='failed'")
      .bind(now, now, bounded({ artifactId, artifactKind: "model3d", stage: "completed", errorDetail: null, appendedEventIds: ids,
        outputModel3dRecovery: { status: "completed", completionEventId: id }, generationReceipt: { provider_request_status: "completed" } }), job.job_id, scope.actorUserId),
      ...outputAssertionStatements(env, { sql: "changes()=1" }), ...prepareOutputJobOutcomeStatements(env, job),
      env.DB.prepare("UPDATE output_operation_slots SET outcome_event_id=? WHERE scope_key=? AND slot_id=? AND job_id=? AND status='succeeded'")
        .bind(id, scope.key, slot.slotId, job.job_id), ...outputAssertionStatements(env, { sql: "changes()=1" })];
  };
  const settle = async () => {
    const result = await reconcileKnownOutputProviderReceipts(env, user, { jobId: job.job_id, assertions: live() });
    if (result.status === "uncertain") fail("output_model3d_recovery_settlement_unavailable");
    await lease.assertCurrent();
  };
  try {
    const existing = await completions();
    if (existing) {
      const priorIds = Array.isArray(original.appendedEventIds) ? original.appendedEventIds.filter((id): id is string => typeof id === "string") : [];
      const eventIds = [...new Set([...priorIds, existing.event_id])]; if (eventIds.length > 128) fail();
      await settle(); await update({ appendedEventIds: eventIds, providerJobId: cp.providerRequestId, providerModel: cp.prepared.model });
      const retained = await retainedInput(existing), read = await readRetainedOutputModel3dRecovery(env, retained.input, lease);
      const current = await currentJob(); if (!current) fail(); const calls = providerSubmissions(parse(current.result_json)); if (calls.length !== 1) fail();
      const assembly = createOutputModel3dRecoveryAssembly({ jobId: job.job_id, ownerId: scope.actorUserId, documentId: scope.documentId,
        projectId: scope.projectId, artifactId, execution: cp.execution as Record<string, string>, offer: cp.offer, prepared: cp.prepared,
        submission: calls[0]!, request });
      await readPhysicalFiles(env, lease, scope.actorUserId, artifactId, read.evidence.files, asset => assembly.qualify(asset), options.signal);
      const verified = await assembly.finish(read.evidence.files, String(parse(retained.input.rawContent).title), Number(object(parse(existing.private_json).settings).seed));
      if (!same(verified.completion, read.evidence)) fail();
      // A completed event produced by the normal atomic writer carries its usage
      // pair. Missing/malformed accounting cannot be guessed during finalization.
      const usageRows = await env.DB.prepare(`SELECT event.event_id,body.private_json FROM events event LEFT JOIN event_private_payloads body ON body.private_event_id=event.event_id
        AND body.owner_id=? AND body.redacted_at IS NULL WHERE event.stream_id=? AND event.correlation_id=? AND event.type='GenerationUsageRecorded' ORDER BY event.sequence LIMIT 65`)
        .bind(scope.actorUserId, job.stream_id, job.correlation_id).all<{ event_id: string; private_json: string }>();
      if (usageRows.success === false || usageRows.results.length > 64 || usageRows.results.some(row => typeof row.private_json !== "string")) fail();
      const remaining = remainingOutputModel3dRecoveryUsage({ rows: usageRows.results.map(row => parse(row.private_json)), costMicrousd: cp.offer.preview.maximumMicrousd,
        artifactId, documentId: scope.documentId, reservationId: slot.tokenReservationId!, costReservationId: slot.costReservationId!, providerRequestId: cp.providerRequestId });
      if (remaining.cost_microusd !== 0) fail("output_model3d_recovery_usage_incomplete");
      const usageSnapshot = bounded(usageRows.results);
      extra.push({ sql: `(SELECT COUNT(*) FROM events WHERE stream_id=? AND correlation_id=? AND type='GenerationUsageRecorded')=? AND
        (SELECT COUNT(*) FROM json_each(?) saved JOIN events event ON event.event_id=json_extract(saved.value,'$.event_id') AND event.stream_id=? AND event.correlation_id=? AND event.type='GenerationUsageRecorded'
          JOIN event_private_payloads body ON body.private_event_id=event.event_id AND body.owner_id=? AND body.private_json=json_extract(saved.value,'$.private_json') AND body.redacted_at IS NULL)=?`,
        bindings: [job.stream_id, job.correlation_id, usageRows.results.length, usageSnapshot, job.stream_id, job.correlation_id, scope.actorUserId, usageRows.results.length] });
      await env.DB.batch([...live(), retained.assertion, ...read.assertions].flatMap(a => outputAssertionStatements(env, a))
        .concat(finish(existing.event_id, [...new Set([...eventIds, ...usageRows.results.map(row => row.event_id)])])));
      return await completedRead() ?? fail();
    }
    const files: NativeRetainedModel3dFile[] = [], storage: Stored[] = [];
    let paid: PaidProviderSubmission | undefined, manifest: readonly Model3dProviderArtifactDescriptor[] = [];
    let assembly: ReturnType<typeof createOutputModel3dRecoveryAssembly> | undefined;
    const envelopePhases = new Set<string>();
    const result = await readOriginalFalModel3d(env, { offer: cp.offer, prepared: cp.prepared, submission: cp.submission as PaidProviderSubmission }, {
      signal: options.signal, deadlineMs: lease.deadlineMs,
      beforeRead: async hook => { hook.assertCurrent(); await lease.assertCurrent(); hook.assertCurrent(); },
      onEnvelope: async (value, hook) => {
        hook.assertCurrent(); await lease.assertCurrent();
        const envelope = object(value);
        if (!["status", "result"].includes(String(envelope.phase)) || envelopePhases.has(String(envelope.phase))
          || envelope.clientRequestId !== cp.clientRequestId || envelope.providerRequestId !== cp.providerRequestId || envelope.requestDigest !== cp.requestDigest) fail();
        const raw = bounded(value, 1500000), prepared = await preparePrivateContent(env, scope.actorUserId, "provider-response", raw);
        if (prepared.requiredInserts !== 1) fail();
        hook.assertCurrent(); await lease.assertCurrent();
        const receipt = { token: lease.token, phase: envelope.phase, responseRef: prepared.contentId, sha256: await hash(new TextEncoder().encode(raw)),
          expiresAt: [prepared.expiresAt, job.expires_at].sort()[0] };
        await env.DB.batch([...live(), { sql: "COALESCE((SELECT json_array_length(result_json,'$.outputModel3dRecoveryEnvelopes') FROM document_jobs WHERE job_id=?),0)<64", bindings: [job.job_id] }]
          .flatMap(a => outputAssertionStatements(env, a)).concat(prepared.statements.slice(0, 1), [env.DB.prepare("UPDATE document_jobs SET result_json=json_insert(json_set(result_json,'$.outputModel3dRecoveryEnvelopes',json(COALESCE(json_extract(result_json,'$.outputModel3dRecoveryEnvelopes'),'[]'))),'$.outputModel3dRecoveryEnvelopes[#]',json(?)) WHERE job_id=? AND owner_id=?")
            .bind(bounded(receipt), job.job_id, scope.actorUserId)]));
        extra.push({ sql: "EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND kind='provider-response' AND content=? AND expires_at=? AND redacted_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
          bindings: [prepared.contentId, scope.actorUserId, raw, prepared.expiresAt], deadlineMs: Date.parse(receipt.expiresAt) });
        envelopePhases.add(String(envelope.phase)); hook.assertCurrent();
      },
      onProviderSubmission: async (receipt, hook) => {
        noteStage(options,"model3d_result_receipt");
        hook.assertCurrent(); await lease.assertCurrent();
        if (paid || !envelopePhases.has("result") || receipt.status !== "completed" || receipt.provider !== "fal" || receipt.operation !== "model3d"
          || receipt.model !== cp.prepared.model || receipt.clientRequestId !== cp.clientRequestId || receipt.providerRequestId !== cp.providerRequestId
          || receipt.costMicrousd !== cp.offer.preview.maximumMicrousd || receipt.inputTokens !== 0 || receipt.outputTokens !== 0 || receipt.totalTokens !== 0) fail();
        paid = { ...receipt, requestDigest: cp.requestDigest };
        assembly = createOutputModel3dRecoveryAssembly({ jobId: job.job_id, ownerId: scope.actorUserId, documentId: scope.documentId,
          projectId: scope.projectId, artifactId, execution: cp.execution as Record<string, string>, offer: cp.offer, prepared: cp.prepared, submission: paid, request });
        await update({ providerSubmissions: { [cp.clientRequestId]: paid }, providerJobId: cp.providerRequestId, providerModel: cp.prepared.model, provider: "fal" });
        await settle(); hook.assertCurrent();
      },
      onResultManifest: async (value, hook) => {
        noteStage(options,"model3d_file_manifest");
        hook.assertCurrent(); if (!paid || !value.length || value.length > 64) fail(); manifest = structuredClone(value);
        bounded(manifest, 64000); await update({ model3dProviderFiles: manifest }); hook.assertCurrent();
      },
      onGeneratedFile: async (asset, index, hook) => {
        noteStage(options,"model3d_file_store");
        hook.assertCurrent(); await lease.assertCurrent();
        if (!paid || index !== files.length || index >= manifest.length || asset.providerMediaUrl !== manifest[index]!.providerMediaUrl
          || asset.fileName !== manifest[index]!.fileName || asset.role !== manifest[index]!.role || asset.format !== manifest[index]!.format
          || asset.fileSize !== asset.bytes.byteLength || asset.sha256 !== await hash(asset.bytes)) fail();
        const location = outputModel3dRecoveryStorage(scope.actorUserId, artifactId, lease.token, index, asset);
        if (await env.MEDIA.head(location.storageKey)) fail("output_model3d_recovery_media_changed");
        const file = { url: location.url, mimeType: asset.mimeType, fileName: asset.fileName, fileSize: asset.fileSize, format: asset.format, role: asset.role, sha256: asset.sha256 };
        storage.push({ index, token: lease.token, storageKey: location.storageKey, sha256: asset.sha256, file, providerMediaUrl: asset.providerMediaUrl });
        await update({ outputModel3dRecoveryFiles: storage }); // Exact cleanup protection precedes PUT.
        hook.assertCurrent(); await lease.assertCurrent();
        const stored = await storeGeneratedMedia(privateEnv, scope.actorUserId, location.artifactKey, asset.bytes, cp.prepared.model, asset.mimeType,
          { artifactRole: "document-model3d-" + asset.role, artifactId, documentId: scope.documentId, projectId: scope.projectId,
            actorUserId: scope.actorUserId, provider: "fal", providerJobId: cp.providerRequestId, providerRequestId: cp.providerRequestId,
            providerModel: cp.prepared.model, providerMediaUrl: asset.providerMediaUrl, fileName: asset.fileName, fileSize: String(asset.fileSize),
            ...(asset.format ? { format: asset.format, modelFormat: asset.format } : {}), mediaKind: "model3d" });
        if (stored.key !== location.storageKey || stored.contentHash !== asset.sha256) fail();
        files.push({ ...file, ...(stored.previewSupported === undefined ? {} : { previewSupported: stored.previewSupported }) });
        storage[index]!.file = files[index]!; await update({ outputModel3dRecoveryFiles: storage });
        if (index === 0) { noteStage(options,"model3d_file_qualify"); if (!assembly) fail(); await assembly.qualify(asset); }
        hook.assertCurrent();
      },
    });
    if (result.status === "pending") return { status: "pending" as const, jobId: job.job_id, slotId: slot.slotId, replayed: false };
    if (!paid || !assembly || files.length !== manifest.length || !files.length) fail();
    noteStage(options,"model3d_assembly");
    const assembled = await assembly.finish(files, "3D model", result.seed);
    completionJson = bounded(assembled.completion);
    await lease.assertCurrent();
    noteStage(options,"model3d_content_store");
    const content = await storePrivateContent(privateEnv, scope.actorUserId, "document-artifact", bounded(assembled.content));
    const invocation = await storePrivateContent(privateEnv, scope.actorUserId, "document-artifact-input", bounded(assembled.invocation));
    const complete = makeEvent(job.stream_id, 1, "worker:renderer", "output-model3d-recovery", job.correlation_id, "DocumentRenderCompleted", {
      artifact_id: artifactId, artifact_kind: "model3d", document_id: scope.documentId, project_id: scope.projectId, requested_by_user_id: scope.actorUserId,
      title: assembled.content.title, summary: assembled.content.summary, content_ref: content.contentId, content_expires_at: content.expiresAt,
      input_ref: invocation.contentId, input_expires_at: invocation.expiresAt, item_count: 0, items: [], presentation: null,
      media_url: files[0]!.url, media_type: files[0]!.mimeType, provider: "fal", provider_job_id: cp.providerRequestId, model_id: cp.prepared.model,
      planner_model_id: null, planner_response_id: null, reference_inputs: cp.prepared.referenceInputs, used_reference_pixels: false,
      source_surface: "outputs", recovered: true, settings: { production_mode: "manual", output_model3d: assembled.completion, seed: result.seed,
        model3d: cp.prepared.settings, model3d_settings: cp.prepared.settings, model3d_files: files, adapter_version: RODIN_ADAPTER_VERSION,
        source_media_sha256: files[0]!.sha256, reserved_cost_microusd: cp.offer.preview.maximumMicrousd, settled_cost_microusd: paid.costMicrousd } });
    const previous = await env.DB.prepare(`SELECT event.event_id,body.private_json,body.owner_id,body.redacted_at FROM events event
      LEFT JOIN event_private_payloads body ON body.private_event_id=event.event_id
      WHERE event.stream_id=? AND event.correlation_id=? AND event.type='GenerationUsageRecorded' ORDER BY event.sequence LIMIT 65`)
      .bind(job.stream_id, job.correlation_id).all<{ event_id: string; private_json: string; owner_id: string; redacted_at: string | null }>();
    if (previous.success === false || previous.results.length > 64 || previous.results.some(r => r.owner_id !== scope.actorUserId || r.redacted_at !== null || typeof r.private_json !== "string")) fail();
    const previousRaw = bounded(previous.results);
    const remaining = remainingOutputModel3dRecoveryUsage({ rows: previous.results.map(r => parse(r.private_json)), costMicrousd: cp.offer.preview.maximumMicrousd,
      artifactId, documentId: scope.documentId, reservationId: slot.tokenReservationId!, costReservationId: slot.costReservationId!, providerRequestId: cp.providerRequestId });
    extra.push({ sql: `(SELECT COUNT(*) FROM events WHERE stream_id=? AND correlation_id=? AND type='GenerationUsageRecorded')=?
      AND (SELECT COUNT(*) FROM json_each(?) saved JOIN events event ON event.event_id=json_extract(saved.value,'$.event_id') AND event.stream_id=? AND event.correlation_id=? AND event.type='GenerationUsageRecorded'
        JOIN event_private_payloads body ON body.private_event_id=event.event_id AND body.owner_id=? AND body.private_json=json_extract(saved.value,'$.private_json') AND body.redacted_at IS NULL)=?`,
      bindings: [job.stream_id, job.correlation_id, previous.results.length, previousRaw, job.stream_id, job.correlation_id, scope.actorUserId, previous.results.length] });
    extra.push({ sql: "NOT EXISTS(SELECT 1 FROM events WHERE stream_id=? AND correlation_id=? AND type='DocumentRenderCompleted')", bindings: [job.stream_id, job.correlation_id] });
    const usage = makeEvent(job.stream_id, 2, "worker:policy", "output-model3d-recovery", job.correlation_id, "GenerationUsageRecorded", {
      operation: "document-render:model3d", artifact_id: artifactId, artifact_kind: "model3d", document_id: scope.documentId,
      reservation_id: slot.tokenReservationId, cost_reservation_id: slot.costReservationId, ...remaining, provider_job_id: cp.providerRequestId,
      model_ids: [cp.prepared.model], source_surface: "outputs", recovered: true }, { causationId: complete.eventId });
    await lease.assertCurrent();
    try {
      noteStage(options,"model3d_publish");
      await appendEvents(privateEnv, [complete, usage], { retries: 1, prepareSidecars: () => [
        ...outputAssertionStatements(env, { sql: "(SELECT COUNT(*) FROM events WHERE event_id IN(?,?))=2", bindings: [complete.eventId, usage.eventId] }),
        ...finish(complete.eventId, [complete.eventId, usage.eventId]),
      ] });
    } catch (error) { const committed = await completedRead(); if (committed) return committed; throw error; }
    return await completedRead() ?? fail();
  } finally { await lease.release().catch(() => {}); }
}

/** Internal lost-finalization read verifies all physical original files. No
 * network or mutation, bounded to the existing transfer policy per file. */
async function readPhysicalFiles(env: WorkerEnv, lease: Lease, ownerId: string, artifactId: string, files: readonly NativeRetainedModel3dFile[],
  onPrimary: (asset: Model3dGeneratedFile) => Promise<unknown>, signal?: AbortSignal) {
  if (!files.length || files.length > 64) fail();
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason ?? Error("output_model3d_recovery_read_aborted"));
  if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(Error("output_model3d_recovery_read_expired")), Math.max(0, lease.deadlineMs - Date.now()));
  let retired = false, rejectStopped: (() => void) | undefined;
  const stopped = new Promise<never>((_, reject) => { rejectStopped = () => reject(controller.signal.reason);
    if (controller.signal.aborted) rejectStopped(); else controller.signal.addEventListener("abort", rejectStopped, { once: true }); });
  void stopped.catch(() => undefined);
  const check = () => { controller.signal.throwIfAborted(); if (retired || Date.now() >= lease.deadlineMs) fail(); };
  const race = async <T>(work: Promise<T>) => { check(); const result = await Promise.race([work, stopped]); check(); return result; };
  const cancel = (body: ReadableStream<Uint8Array>) => { try { void body.cancel().catch(() => {}); } catch { /* Preserve the first refusal. */ } };
  try {
    for (let index = 0; index < files.length; index++) {
      const file = files[index]!; if (index === 0) assertOutputModel3dRecoveryPrimarySize(file.fileSize);
      await race(lease.assertCurrent());
      const key = decodeURIComponent(file.url.slice("/api/media/".length));
      const value = await race(env.MEDIA.get(key).then(value => { if (value && (retired || controller.signal.aborted)) cancel(value.body); return value; }));
      const metadata = value?.customMetadata;
      if (!value || !metadata || metadata.ownerId !== ownerId || metadata.artifactId !== artifactId || metadata.sha256 !== file.sha256
        || metadata.providerRequestId !== lease.checkpoint.providerRequestId || value.size !== file.fileSize || value.size > MODEL3D_PRIVATE_TRANSFER_MAX_BYTES) {
        if (value) cancel(value.body); fail();
      }
      const reader = value.body.getReader(), bytes = new Uint8Array(file.fileSize); let length = 0, chunks = 0;
      try {
        for (;;) {
          const next = await race(reader.read()); if (next.done) break;
          if (!(next.value instanceof Uint8Array) || !next.value.length || ++chunks > 65536 || length + next.value.length > bytes.length) fail();
          bytes.set(next.value, length); length += next.value.length;
        }
        if (length !== file.fileSize || await race(hash(bytes)) !== file.sha256) fail();
        await race(lease.assertCurrent());
        if (index === 0) await race(onPrimary({ ...file, bytes, providerMediaUrl: String(metadata.providerMediaUrl ?? "") }));
        await race(lease.assertCurrent());
      } finally {
        // A hostile cancellation promise cannot hold the lease open.
        try { void reader.cancel().catch(() => {}); } catch { /* Preserve refusal. */ }
        reader.releaseLock();
      }
      // The next file is not read until all qualification awaits have retired;
      // no mesh-byte bundle or retained primary reference crosses iterations.
    }
  } finally {
    retired = true; clearTimeout(timer); signal?.removeEventListener("abort", abort);
    if (rejectStopped) controller.signal.removeEventListener("abort", rejectStopped);
    controller.abort();
  }
}
