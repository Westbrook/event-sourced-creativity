import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { outputTestDatabase, registerOutputSourceImports } from "../output-server-test-helpers.mjs";
const imports = registerOutputSourceImports();
let ensureSchema, ensureOutputRequirementsSchema, appendEvents, makeEvent, videoRetainedFixture;
let modelFixture, glb, qualifyOutputModel3dCompletion, emittedModel3dCompletionSource, RODIN_ADAPTER_VERSION, readOutputVideoCompletion;
let readNativeRetainedMediaCustody, ownerMediaNamespace, videoPolicy, modelPolicy;
let scaleModel3dGeometry, parseModel3dMediaRevision, parseModel3dScaleEditRequest;
try {
  ({ ensureSchema, appendEvents, makeEvent } = await import("../../worker/runtime.ts"));
  ({ ensureOutputRequirementsSchema } = await import("../../worker/output-requirements-ledger.ts"));
  ({ videoRetainedFixture } = await import("../output-video-retained-fixture.mjs"));
  ({ readOutputVideoCompletion } = await import("../../worker/output-video-completion.ts"));
  ({ fixture: modelFixture, glb } = await import("./model3d-native-execution-fixture.mjs"));
  ({ qualifyOutputModel3dCompletion } = await import("../../worker/output-model3d-execution.ts"));
  ({ emittedModel3dCompletionSource } = await import("./model3d-terminal-source.mjs"));
  ({ RODIN_ADAPTER_VERSION } = await import("../../src/model/model3d.ts"));
  ({ ownerMediaNamespace } = await import("../../src/model/media-ownership.ts"));
  ({ scaleModel3dGeometry } = await import("../../src/model/model3d-geometry-edit.ts"));
  ({ parseModel3dMediaRevision } = await import("../../src/model/model3d-media-revision.ts"));
  ({ parseModel3dScaleEditRequest } = await import("../../src/model/model3d-artifact-revision.ts"));
  ({ readNativeRetainedMediaCustody } = await import("../../worker/native-retained-media-custody.ts"));
  ({ SELECTED_OUTPUT_SHARE_VIDEO_POLICY: videoPolicy } = await import("../../src/model/selected-output-share-video.ts"));
  ({ SELECTED_OUTPUT_SHARE_MODEL3D_POLICY: modelPolicy } = await import("../../src/model/selected-output-share-model3d.ts"));
} finally { imports.deregister(); }
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const OWNER = "owner", PROJECT = "project", EMAIL = "owner@example.test";

/** Original synthetic paid receipts enter the actual runtime schema. The native
 * reader and authorization reader are real; no proof or DB response is mocked.
 * Video reuses its accepted local donor. GLB qualifies a new tiny triangle and
 * uses the actual emitted completion expression. No remote service is invoked. */
export async function originalOutputsMediaFixture(t, output, options = {}) {
  assert.ok(["video", "model3d"].includes(output));
  const g = outputTestDatabase(), now = new Date().toISOString();
  let donor, expectedBytes;
  t.after(() => { donor?.sqlite.close(); g.sqlite.close(); });
  await ensureSchema(g.env); await ensureOutputRequirementsSchema(g.env);
  const insert = (table, row) => {
    const keys = Object.keys(row);
    g.sqlite.prepare(`INSERT INTO ${table}(${keys.join(",")}) VALUES(${keys.map(() => "?").join(",")})`).run(...Object.values(row));
  };
  insert("users", { user_id: OWNER, email: EMAIL, display_name: "Synthetic media owner", role: "creator",
    consent_version: "pilot-2026-08-10", consented_at: now, created_at: now, updated_at: now });
  let documentId, artifactId, rawContent, payload, job, reference, expiry, mediaHash, model, maximumMicrousd, maximumCalls, requirementsDigest;
  const rows = {};
  if (output === "video") {
    donor = await videoRetainedFixture();
    expectedBytes = new Uint8Array(donor.bytes);
    // The old reduced donor uses "corr". Re-observe the actual completed receipt
    // with the production attempt correlation before constructing private events.
    donor.job.correlation_id = `${donor.job.job_id}:attempt:1`;
    donor.sqlite.prepare("UPDATE document_jobs SET correlation_id=?").run(donor.job.correlation_id);
    const observed = await readOutputVideoCompletion(donor.env, donor.scope, donor.slot, donor.job, donor.settings,
      donor.artifactId, donor.artifact, donor.lease);
    donor.payload.settings.output_video = observed.receipt;
    const input = JSON.parse(donor.sqlite.prepare("SELECT content FROM private_content WHERE content_id='input'").get().content);
    input.output_video = observed.receipt;
    const rawInput = JSON.stringify(input);
    donor.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id='input'").run(rawInput);
    donor.payload.settings.video_input_sha256 = hash(rawInput);
    documentId = "doc"; artifactId = donor.artifactId; rawContent = donor.input.rawContent; payload = donor.payload;
    job = { ...donor.sqlite.prepare("SELECT * FROM document_jobs").get() };
    reference = JSON.parse(job.result_json).outputExecution;
    expiry = job.expires_at; mediaHash = hash(donor.bytes); model = donor.mediaAttempt.model;
    maximumMicrousd = 2210000; maximumCalls = 2; requirementsDigest = "fixture-requirements";
    for (const table of ["output_provider_calls", "output_native_storage_writes", "private_content"])
      rows[table] = donor.sqlite.prepare(`SELECT * FROM ${table}`).all();
  } else {
    const f = await modelFixture("image"), p = f.preview, bytes = glb();
    expectedBytes = new Uint8Array(bytes);
    documentId = "document"; artifactId = "artifact"; expiry = p.expiresAt; mediaHash = hash(bytes); model = p.model;
    maximumMicrousd = p.maximumMicrousd; maximumCalls = 1; requirementsDigest = p.requirementsDigest;
    reference = { scopeKey: "personal:owner:project", slotId: "slot", grantId: "grant", planRevisionId: "plan", targetId: "target",
      sourceDigest: p.sourceDigest, targetContractDigest: "e".repeat(64) };
    const call = { clientRequestId: "forma-model3d-original", provider: "fal", operation: "model3d", model,
      status: "completed", providerRequestId: "provider-original", costMicrousd: maximumMicrousd, totalTokens: 0 };
    const receipt = await qualifyOutputModel3dCompletion({ offer: f.offer, prepared: f.receipt, calls: [call], providerRequestId: call.providerRequestId,
      primary: { bytes, sha256: mediaHash, mimeType: "model/gltf-binary", role: "mesh", format: "glb" } });
    const key = `${ownerMediaNamespace(OWNER)}/generated/${options.model3dStorageToken
      ? `${artifactId}-recovery-${options.model3dStorageToken}` : "model"}.glb`;
    if (options.mediaBytes === true) g.media.set(key, { bytes: new Uint8Array(bytes), contentType: "model/gltf-binary", metadata: {
      ownerId: OWNER, artifactId, source: "provider-generated-media", model, sha256: mediaHash, mimeType: "model/gltf-binary",
      modelFormat: "glb", modelPreviewSafe: "true",
    } });
    const files = [{ url: "/api/media/" + encodeURIComponent(key), sha256: mediaHash, fileSize: bytes.byteLength,
      mimeType: "model/gltf-binary", fileName: "model.glb", role: "mesh", format: "glb", previewSupported: true }];
    if (options.secondaryModel3d === true) {
      const alternate = glb({ asset: { version: "2.0", generator: "synthetic-alternate" } }), alternateKey = `${ownerMediaNamespace(OWNER)}/generated/alternate.glb`;
      if (options.selectSecondaryModel3d === true) expectedBytes = new Uint8Array(alternate);
      files.push({ url: "/api/media/" + encodeURIComponent(alternateKey), sha256: hash(alternate), fileSize: alternate.byteLength,
        mimeType: "model/gltf-binary", fileName: "alternate.glb", role: "mesh", format: "glb", previewSupported: true });
      if (options.mediaBytes === true) g.media.set(alternateKey, { bytes: new Uint8Array(alternate), contentType: "model/gltf-binary", metadata: {
        ownerId: OWNER, artifactId, source: "provider-generated-media", model, sha256: hash(alternate), mimeType: "model/gltf-binary",
        modelFormat: "glb", modelPreviewSafe: "true",
      } });
    }
    const completion = { schemaVersion: 1, jobId: p.requestId, actorUserId: OWNER, documentId, projectId: PROJECT, artifactId,
      execution: reference, contract: f.offer.contract, costPreview: p, receipt, files };
    payload = emittedModel3dCompletionSource({ sourceReceipt: { document_id: documentId, project_id: PROJECT }, workflowLineage: {},
      artifactId, executionScope: undefined, ownerId: OWNER, plan: { title: "Synthetic kettle", summary: f.payload.model3dPrompt },
      stored: { contentId: "content", expiresAt: expiry }, inputStored: { contentId: "input", expiresAt: expiry }, primary: options.selectSecondaryModel3d === true ? files[1] : files[0],
      generated: { providerJobId: call.providerRequestId, model, latencyMs: 1, seed: null }, preparedReceipt: f.receipt,
      sourceSurface: "outputs", prepared: { settings: f.payload.model3dSettings }, files, nativeCompletion: completion, RODIN_ADAPTER_VERSION,
      costReservationMicrousd: maximumMicrousd, actualCostMicrousd: maximumMicrousd, body: {} });
    rawContent = JSON.stringify({ title: "Synthetic kettle", content_markdown: f.payload.model3dPrompt, presentation: null, items: [] });
    const input = { schema_version: 1, artifact_kind: "model3d", artifact_id: artifactId, document_id: documentId, project_id: PROJECT,
      output_model3d: completion, model3d_preparation: f.payload.model3dPreparation,
      request: { source_surface: "outputs", model3d_prompt: f.payload.model3dPrompt, model3d_prompt_source: "document",
        model3d_settings: f.payload.model3dSettings, model3d_adaptation: null, model3d_reference_block_ids: f.payload.model3dReferenceBlockIds },
      render: { ...f.receipt, providerJobId: call.providerRequestId } };
    const result = { artifactId, artifactKind: "model3d", outputExecution: reference, model3dInputReceipt: f.receipt,
      model3dSettings: f.payload.model3dSettings, model3dProviderFiles: files, model3dEstimatedCostMicrousd: maximumMicrousd,
      providerSubmissionProtocol: 1, providerSubmissions: { [call.clientRequestId]: call }, provider: "fal", providerModel: model,
      providerJobId: call.providerRequestId, model3dProviderSubmission: "confirmed", providerCancelUrl: null };
    job = { job_id: p.requestId, owner_id: OWNER, stream_id: `creative:${OWNER}`, document_id: documentId, kind: "render_document",
      request_json: JSON.stringify({ ...f.payload, outputExecution: reference, model3dCostConsent: { ...p, confirmed: true, providerTransferConfirmed: true } }),
      result_json: JSON.stringify(result) };
    rows.private_content = [{ content_id: "input", owner_id: OWNER, kind: "document-artifact-input", content: JSON.stringify(input), created_at: now, expires_at: expiry, redacted_at: null }];
    rows.output_provider_calls = [{ scope_key: reference.scopeKey, slot_id: reference.slotId, call_key: "model3d:initial", stage_key: "model3d:initial",
      client_request_id: call.clientRequestId, request_digest: f.receipt.requestDigest, provider: "fal", model,
      reserved_microusd: maximumMicrousd, used_microusd: maximumMicrousd, status: "settled", provider_response_id: call.providerRequestId }];
    rows.output_native_storage_writes = files.map(file => ({ scope_key: reference.scopeKey, slot_id: reference.slotId,
      storage_key: decodeURIComponent(file.url.slice("/api/media/".length)), content_sha256: file.sha256, status: "written", write_acknowledged: 1 }));
  }
  const stream = `creative:${OWNER}`, correlation = `${job.job_id}:attempt:1`, routeDigest = donor?.slot.routeDigest ?? "fixture-native-route", termsDigest = "fixture-native-terms";
  const append = async (type, body, actor = `user:${OWNER}`, client = "server:output-requirements", corr = "fixture-authorize") => {
    const event = makeEvent(stream, 0, actor, client, corr, type, { document_id: documentId, project_id: PROJECT, ...body });
    await appendEvents(g.env, [event]); return event;
  };
  await append("DocumentCreated", { title: "Synthetic original media" });
  const confirmed = await append("OutputPlanConfirmed", { plan_revision_id: reference.planRevisionId, source_digest: reference.sourceDigest });
  const preflight = await append("OutputPreflightCompleted", { preflight_id: "preflight", plan_revision_id: reference.planRevisionId });
  const authorization = await append("OutputExecutionAuthorized", { actor_user_id: OWNER, grant_id: reference.grantId,
    plan_revision_id: reference.planRevisionId, preflight_id: "preflight", source_digest: reference.sourceDigest,
    maximum_microusd: maximumMicrousd, maximum_calls: maximumCalls,
    authorized_targets: [{ target_id: reference.targetId, operation_slot_id: reference.slotId, job_id: job.job_id, route_digest: routeDigest }],
    output_command_envelope: { action: "authorize", documentId, clientMutationId: "fixture-authorize", preflightId: "preflight",
      termsDigest, maximumMicrousd, explicitAuthorization: true, expectedRevision: `output:${preflight.sequence}` } });
  const completed = await append("DocumentRenderCompleted", { ...payload, ...options.completionPayload }, "worker:renderer", options.completionClientId ?? "server:document-job:render_document", correlation);
  const result = { ...JSON.parse(job.result_json), appendedEventIds: [completed.eventId] };
  Object.assign(job, { status: "completed", source_surface: "outputs", correlation_id: correlation, requested_sequence: authorization.sequence,
    requested_at: now, started_at: now, completed_at: now, error_message: null, attempt_count: 1,
    expires_at: expiry, updated_at: now, result_json: JSON.stringify(result) });
  delete job.output_slot_id;
  insert("output_plan_revisions", { scope_key: reference.scopeKey, scope_kind: "personal", owner_user_id: OWNER, project_id: PROJECT, document_id: documentId,
    plan_revision_id: reference.planRevisionId, plan_id: "fixture-plan", revision: 1, confirmed_event_id: confirmed.eventId, requirements_digest: requirementsDigest,
    source_digest: reference.sourceDigest, resolver_version: "synthetic-native", source_head: confirmed.sequence, target_count: 1, created_at: now });
  insert("output_plan_targets", { scope_key: reference.scopeKey, plan_revision_id: reference.planRevisionId, target_id: reference.targetId,
    target_contract_digest: reference.targetContractDigest, media_kind: output, required: 1, selected: 1, ordinal: 0 });
  insert("output_preflights", { scope_key: reference.scopeKey, preflight_id: "preflight", plan_revision_id: reference.planRevisionId,
    actor_user_id: OWNER, terms_digest: termsDigest, event_id: preflight.eventId, expires_at: expiry, created_at: now });
  insert("output_execution_grants", { scope_key: reference.scopeKey, grant_id: reference.grantId, plan_revision_id: reference.planRevisionId,
    actor_user_id: OWNER, payer_user_id: OWNER, preflight_id: "preflight", authorization_event_id: authorization.eventId,
    maximum_microusd: maximumMicrousd, maximum_calls: maximumCalls, status: "completed", expires_at: expiry, created_at: now });
  insert("output_operation_slots", { scope_key: reference.scopeKey, slot_id: reference.slotId, grant_id: reference.grantId,
    plan_revision_id: reference.planRevisionId, target_id: reference.targetId, target_contract_digest: reference.targetContractDigest,
    source_digest: reference.sourceDigest, provider: "fal", model, route_digest: routeDigest, job_id: job.job_id,
    cost_reservation_id: "fixture-cost", token_reservation_id: "fixture-tokens", maximum_microusd: maximumMicrousd,
    maximum_calls: maximumCalls, maximum_tokens: output === "video" ? 100000 : 1, status: "succeeded",
    outcome_event_id: completed.eventId, created_at: now, updated_at: now });
  for (const call of rows.output_provider_calls) {
    insert("output_operation_routes", { scope_key: reference.scopeKey, slot_id: reference.slotId,
      stage_key: call.stage_key, provider: call.provider, model: call.model, maximum_calls: 1 });
    insert("output_provider_calls", { reserved_microusd: maximumMicrousd, created_at: now, settled_at: now, ...call });
  }
  for (const row of rows.output_native_storage_writes) insert("output_native_storage_writes", { ...row, publication_event_id: completed.eventId, created_at: now, updated_at: now });
  for (const row of rows.private_content) insert("private_content", row);
  insert("private_content", { content_id: "content", owner_id: OWNER, kind: "document-artifact", content: rawContent, created_at: now, expires_at: expiry, redacted_at: null });
  insert("document_jobs", job);
  assert.equal(g.sqlite.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
  assert.deepEqual(g.sqlite.prepare("PRAGMA foreign_key_check").all(), []);
  const stats = { gets: 0, heads: 0, writes: 0 }, statements = []; let beforeRead = null;
  const env = { ...g.env, DB: { prepare(sql) {
    assert.match(sql, /^\s*(?:SELECT|WITH)\b/u); assert.ok(Buffer.byteLength(sql) <= 100000);
    const wrap = bindings => ({ bind(...values) { assert.ok(values.length <= 100); return wrap(values); },
      async first() { statements.push({ sql, bindings: [...bindings] }); await beforeRead?.(sql, bindings); return g.DB.prepare(sql).bind(...bindings).first(); },
      async all() { statements.push({ sql, bindings: [...bindings] }); await beforeRead?.(sql, bindings); return g.DB.prepare(sql).bind(...bindings).all(); },
      run() { stats.writes++; throw Error("authority must not write"); } });
    return wrap([]);
  }, batch() { stats.writes++; throw Error("authority must not write"); } }, MEDIA: {
    async get(key) { stats.gets++; if (!donor && options.mediaBytes !== true) throw Error("GLB custody must not fetch bytes"); return (donor?.env.MEDIA ?? g.env.MEDIA).get(key); },
    head() { stats.heads++; throw Error("unexpected media head"); }, put() { stats.writes++; throw Error("unexpected media write"); }, delete() { stats.writes++; throw Error("unexpected media delete"); },
  } };
  const identity = { userId: OWNER, email: EMAIL, source: "openai-workspace" }, controller = new AbortController();
  const selection = { output, documentId, artifactId, revision: 0, contentSha256: hash(rawContent), mediaSha256: options.selectSecondaryModel3d === true ? payload.settings.model3d_files[1].sha256 : mediaHash, policy: output === "video" ? videoPolicy : modelPolicy };
  return { ...g, env, identity, selection, stats, statements, completed, authorization, reference, jobId: job.job_id, controller,
    expectedBytes: new Uint8Array(expectedBytes), originalRaw: rawContent, originalUrl: payload.media_url, expiry,
    appendSynthetic: append,
    read: (selected = selection) => readNativeRetainedMediaCustody(env, identity, selected, controller.signal), insert,
    changes: () => g.sqlite.prepare("SELECT total_changes() AS n").get().n,
    setBeforeRead(fn) { beforeRead = fn; },
    mutateJob(column, change) { const row = g.sqlite.prepare(`SELECT ${column} AS value FROM document_jobs WHERE job_id=?`).get(job.job_id);
      const value = JSON.parse(row.value); change(value); g.sqlite.prepare(`UPDATE document_jobs SET ${column}=? WHERE job_id=?`).run(JSON.stringify(value), job.job_id); },
    mutateAuthorization(change) { const value = JSON.parse(g.sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=?").get(authorization.eventId).private_json);
      change(value); g.sqlite.prepare("UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?").run(JSON.stringify(value), authorization.eventId); },
  };
}

/** Seed the closed records for an actual local GLB scale and a later explicit
 * original restore. Native selection/receipt readers validate every record.
 * This fixture operation does not call an edit endpoint or a provider. */
export async function retainOriginalOutputsModel3dRevision(f, action) {
  assert.equal(f.selection.output, "model3d"); assert.ok(["scale", "restore"].includes(action));
  const prior = f.sqlite.prepare("SELECT content FROM private_content WHERE content_id='content'").get().content;
  const revision = f.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='DocumentArtifactEdited'").get().n + 1;
  assert.ok(action === "scale" ? revision === 1 : revision === 2, "bounded scale then original restore fixture");
  f.insert("artifact_revisions", { revision_id: `original-glb-snapshot-${revision - 1}`, owner_id: OWNER, project_id: PROJECT,
    document_id: f.selection.documentId, artifact_id: f.selection.artifactId, revision: revision - 1,
    content_json: prior, content_sha256: hash(prior), created_by_user_id: OWNER, created_at: new Date().toISOString(), expires_at: f.expiry });
  let record = null, mediaSha256 = f.selection.mediaSha256;
  if (action === "scale") {
    const result = scaleModel3dGeometry(f.expectedBytes, 2); assert.ok(result.changed);
    const fileName = "original-output-derived.glb", key = `${ownerMediaNamespace(OWNER)}/generated/${fileName}`;
    mediaSha256 = hash(result.bytes);
    record = parseModel3dMediaRevision({ schemaVersion: 1, operation: "uniform-scale",
      media: { url: "/api/media/" + encodeURIComponent(key), mediaType: "model/gltf-binary", sha256: mediaSha256, byteLength: result.bytes.length, fileName },
      source: { url: f.originalUrl, sha256: f.selection.mediaSha256, byteLength: f.expectedBytes.length, revision: 0, contentSha256: hash(prior) },
      factor: result.factor, beforeBounds: result.beforeBounds, afterBounds: result.afterBounds,
      vertexCount: result.vertexCount, positionAccessorCount: result.positionAccessorCount });
    assert.ok(record);
    const request = parseModel3dScaleEditRequest({ expectedRevision: 0, expectedContentSha256: hash(prior),
      model3dScale: { sourceMediaSha256: f.selection.mediaSha256, factor: result.factor, resultMediaSha256: mediaSha256 } });
    assert.ok(request);
    f.media.set(key, { bytes: new Uint8Array(result.bytes), contentType: "model/gltf-binary", metadata: {
      ownerId: OWNER, artifactId: f.selection.artifactId, source: "authored-model3d-edit", sha256: mediaSha256, mimeType: "model/gltf-binary",
      sourceMediaSha256: f.selection.mediaSha256, sourceRevision: "0", requestSha256: hash(JSON.stringify(request)),
      modelFormat: "glb", modelPreviewSafe: "true", fileName,
    } });
  }
  const content = action === "scale" ? JSON.stringify({ ...JSON.parse(prior), model3d_revision: record }) : f.originalRaw;
  f.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id='content'").run(content);
  const event = await f.appendSynthetic("DocumentArtifactEdited", { artifact_id: f.selection.artifactId, artifact_kind: "model3d", content_ref: "content",
    revision, content_sha256: hash(content), edited_by_user_id: OWNER, model3d_revision: record,
    ...(action === "scale" ? { source_surface: "document-artifact-model3d-scale", changed_fields: ["model3d_revision"] }
      : { revision_action: "restore", restored_from_revision: 0, source_surface: "document-artifact-history" }) });
  return { event, record, selection: { ...f.selection, revision, contentSha256: hash(content), mediaSha256 } };
}
