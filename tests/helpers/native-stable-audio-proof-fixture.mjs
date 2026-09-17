import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { outputTestDatabase, registerOutputSourceImports } from "../output-server-test-helpers.mjs";

const imports = registerOutputSourceImports();
let ensureSchema, ensureOutputRequirementsSchema, appendEvents, makeEvent, ownerMediaNamespace;
let createAudioOutputContract, captureOutputAudioAttempt, verifyOutputAudioCalls, serializeAudioRequest;
let EXPERIENCE_AUDIO_INTENT, captureExperienceAudioEvidence, verifyExperienceAudioInput;
try {
  ({ ensureSchema, appendEvents, makeEvent } = await import("../../worker/runtime.ts"));
  ({ ensureOutputRequirementsSchema } = await import("../../worker/output-requirements-ledger.ts"));
  ({ ownerMediaNamespace } = await import("../../src/model/media-ownership.ts"));
  ({ createAudioOutputContract } = await import("../../src/model/output-audio-contract.ts"));
  ({ captureOutputAudioAttempt, verifyOutputAudioCalls } = await import("../../worker/output-audio-execution.ts"));
  ({ serializeAudioRequest } = await import("../../worker/audio-adapters/index.ts"));
  ({ EXPERIENCE_AUDIO_INTENT } = await import("../../src/experiences/contracts.ts"));
  ({ captureExperienceAudioEvidence, verifyExperienceAudioInput } = await import("../../src/experiences/audio-native-result.ts"));
} finally { imports.deregister(); }

export const OWNER = "stable-audio-owner";
export const EMAIL = "stable-audio-owner@example.test";
export const PROJECT = "stable-audio-project";
export const DOCUMENT = "stable-audio-document";
export const ARTIFACT = "stable-audio-artifact";
export const CONTENT = "stable-audio-content";
export const INPUT = "stable-audio-completion-input";
export const ADMISSION_INPUT = "stable-audio-admission-input";
export const MODEL = "fal-ai/stable-audio-3/medium/text-to-audio";
export const JOB = `audio-${"9".repeat(64)}`;
export const EXPIRY = "2099-01-01T00:00:00.000Z";
// A declared synthetic source digest: no audio bytes exist in this proof fixture.
export const MEDIA_HASH = "a".repeat(64);
export const SOURCE_PROFILE = "forma.audio.instrumental-20.mp3@1";
export const PROJECTION_POLICY = "selected-output-share-stable-mp3-pcm16-v1";
export const digest = value => createHash("sha256").update(value).digest("hex");

/** Real canonical schema and event writer, synthetic completed Outputs lineage.
 * Only setup/mutation helpers write. The observed environment executes SELECTs
 * only; MEDIA methods and ASSETS.fetch throw. Tests can separately trap global
 * fetch. No media fixture is fetched,
 * synthesized, decoded, or presented as measured provider output. */
export async function fixture(t, { repair = false, mediaSha256 = MEDIA_HASH } = {}) {
  assert.equal(typeof mediaSha256, "string");
  assert.match(mediaSha256, /^[a-f0-9]{64}$/u, "Synthetic native Audio source digest must be lowercase SHA-256");
  const state = outputTestDatabase();
  t.after(() => state.sqlite.close());
  await ensureSchema(state.env); await ensureOutputRequirementsSchema(state.env);
  const capturedAt = new Date(Date.now() - 7_200_000).toISOString();
  const quoteExpiry = new Date(Date.now() - 3_600_000).toISOString();
  const stream = `creative:${OWNER}`, correlation = `${JOB}:attempt:1`;
  const insert = (table, row) => {
    assert.match(table, /^[a-z_]+$/u);
    const names = Object.keys(row); assert.ok(names.every(name => /^[a-z_][a-z0-9_]*$/u.test(name)));
    state.sqlite.prepare(`INSERT INTO ${table}(${names.join(",")}) VALUES(${names.map(() => "?").join(",")})`).run(...Object.values(row));
  };
  insert("users", { user_id: OWNER, email: EMAIL, display_name: "Synthetic Stable Audio owner", role: "creator",
    consent_version: "pilot-2026-08-10", consented_at: capturedAt, created_at: capturedAt, updated_at: capturedAt });
  const source = { draftId: `experience-draft-${"b".repeat(64)}`, draftHash: `sha256:${"c".repeat(64)}`,
    releaseHash: `sha256:${"d".repeat(64)}`, requestHash: `sha256:${"e".repeat(64)}`, sourceBindingHash: `sha256:${"f".repeat(64)}` };
  const contract = createAudioOutputContract(source); assert.ok(contract);
  const reference = { scopeKey: `personal:${OWNER}:${PROJECT}`, grantId: "stable-audio-grant", slotId: "stable-audio-slot",
    planRevisionId: "stable-audio-plan", targetId: "stable-audio-target", targetContractDigest: "1".repeat(64), sourceDigest: "2".repeat(64) };
  const maximumMicrousd = 1_000_000, maximumCalls = 3, maximumTokens = 128000;
  const requirementsDigest = "3".repeat(64), routeDigest = "4".repeat(64), termsDigest = "5".repeat(64);
  const costPreview = { version: "audio-mini-app-cost-v1", requestId: JOB, actorUserId: OWNER, projectId: PROJECT, documentId: DOCUMENT,
    draftId: source.draftId, sourceDigest: reference.sourceDigest, requirementsDigest, expiresAt: quoteExpiry,
    maximumMicrousd, maximumCalls, maximumTokens, planningModel: "gpt-5.6-terra", maximumPlanningCalls: 2, maximumOutputTokens: 3000,
    audioModel: MODEL, maximumAudioCalls: 1, durationSeconds: 20, requireInstrumental: true, sourceFilesTransferred: 0 };
  const paidCalls = [], attempts = [];
  for (const stage of repair ? ["planning:0:initial", "planning:0:repair"] : ["planning:0:initial"]) {
    const isRepair = stage.endsWith(":repair"), clientRequestId = `forma-audio-plan-${isRepair ? "repair" : "initial"}`;
    const wire = JSON.stringify({ model: "gpt-5.6-terra", store: false, max_output_tokens: 3000,
      input: "Synthetic private source direction.", instructions: "Plan one instrumental track.", service_tier: "default",
      prompt_cache_options: { mode: "explicit" }, text: { format: { name: isRepair ? "document_audio_repair" : "document_audio",
        type: "json_schema", strict: true } } });
    const attempt = await captureOutputAudioAttempt(contract, wire, clientRequestId, stage); attempts.push(attempt);
    paidCalls.push({ clientRequestId, provider: "openai", operation: "planning", model: attempt.model, effectiveModel: attempt.model,
      unitId: stage, status: "completed", providerRequestId: `synthetic-response-${isRepair ? "repair" : "initial"}`,
      responseRef: `synthetic-response-content-${isRepair ? "repair" : "initial"}`, requestDigest: attempt.requestDigest,
      costMicrousd: 1000, totalTokens: 100, inputTokens: 80, outputTokens: 20,
      validationStatus: repair && !isRepair ? "invalid" : "valid", completionStatus: "completed" });
  }
  const prompt = "Synthetic instrumental pattern, no vocals.";
  const mediaWire = JSON.stringify(serializeAudioRequest(MODEL, { prompt, profile: EXPERIENCE_AUDIO_INTENT }));
  const mediaAttempt = await captureOutputAudioAttempt(contract, mediaWire, "forma-audio-media-initial", "audio:initial"); attempts.push(mediaAttempt);
  const mediaCall = { clientRequestId: mediaAttempt.clientRequestId, provider: "fal", operation: "audio", model: MODEL,
    unitId: "audio:initial", status: "completed", providerRequestId: "synthetic-stable-audio-provider-request",
    requestDigest: mediaAttempt.requestDigest, costMicrousd: 500000, totalTokens: 0 };
  paidCalls.push(mediaCall);
  const receipt = verifyOutputAudioCalls(paidCalls, contract);
  const usedMicrousd = paidCalls.reduce((sum, call) => sum + call.costMicrousd, 0), usedCalls = paidCalls.length;
  const planner = paidCalls.filter(call => call.operation === "planning").at(-1);
  const mediaKey = `${ownerMediaNamespace(OWNER)}/generated/${ARTIFACT}.mp3`, mediaUrl = `/api/media/${encodeURIComponent(mediaKey)}`;
  const input = { schema_version: 1, artifact_id: ARTIFACT, artifact_kind: "audio", document_id: DOCUMENT, project_id: PROJECT,
    captured_at: capturedAt,
    request: { item_count: 1, source_surface: "outputs", production_mode: "manual", audio_profile: EXPERIENCE_AUDIO_INTENT,
      audio_image_block_id: null, audio_video_artifact_id: null, audio_video_provider_transfer: false,
      soundtrack_provider_transfer: false, soundtrack_block_ids: [] },
    document_snapshot: { document: { id: DOCUMENT }, facts: [] },
    output_audio: contract, output_audio_execution: reference, output_audio_calls: paidCalls,
    output_audio_request: { contract, requestBody: mediaWire, clientRequestId: mediaCall.clientRequestId, requestDigest: mediaCall.requestDigest },
    planner: { provider: "openai", model: "gpt-5.6-terra", response_id: planner.providerRequestId },
    render: { provider: "fal", model: MODEL, provider_job_id: mediaCall.providerRequestId, submitted_prompt: prompt,
      parameters: { provider_parameters: { duration: 20, output_format: "mp3", enable_safety_checker: true, negative_prompt: "singing, vocals, spoken dialogue" },
        goal: "timed_music", destination: "standalone", duration_seconds: 20, image_reference_count: 0,
        audio_waveform_submitted: false, semantic_audio_reference_count: 0 },
      image_reference: null, audio_waveform_submitted: false, source_audio_block_ids: [], source_audio_treatment: "none" } };
  const originalRaw = JSON.stringify({ title: "Synthetic retained Audio", summary: "Synthetic private summary", content_markdown: "Synthetic private direction.",
    presentation: null, items: [{ title: "Track", body: "Instrumental", notes: "", image_prompt: "", slide: null }] });
  const settings = { item_count: 1, production_mode: "manual", output_audio: contract, output_audio_execution: reference,
    output_audio_receipt: receipt, source_media_sha256: mediaSha256, audio_provider_model: MODEL,
    audio_role: "score", audio_goal: "timed_music", audio_destination: "standalone", audio_profile: EXPERIENCE_AUDIO_INTENT,
    audio_synthid_watermarked: false, audio_watermark_basis: null, lyrics: "", duration_seconds: null,
    estimated_duration_seconds: 20, duration_basis: "estimate", duration_media_url: mediaUrl, duration_media_sha256: mediaSha256 };
  const expected = { documentId: DOCUMENT, projectId: PROJECT, artifactId: ARTIFACT, jobId: JOB, plannerResponseId: planner.providerRequestId,
    source, costPreview, usedMicrousd, usedCalls, ...Object.fromEntries(Object.entries(reference).filter(([key]) => key !== "scopeKey")) };
  const evidence = captureExperienceAudioEvidence(settings); assert.ok(evidence);
  assert.equal(await verifyExperienceAudioInput(JSON.stringify(input), evidence, expected), true,
    "Synthetic source must satisfy the unchanged actual Outputs Audio input verifier");

  let seeding = true, seedOrdinal = 0;
  const append = async (type, body, actor = `user:${OWNER}`, client = "server:output-requirements", corr = "stable-audio-authorize") => {
    const event = makeEvent(stream, 0, actor, client, corr, type, { document_id: DOCUMENT, project_id: PROJECT, ...body });
    // The original approval predates its now-expired quote. Later test edits use
    // current event timestamps and the unchanged actual event-write machinery.
    if (seeding) event.occurredAt = event.recordedAt = new Date(Date.parse(capturedAt) + seedOrdinal++).toISOString();
    await appendEvents(state.env, [event]); return event;
  };
  await append("DocumentCreated", { title: "Synthetic Audio Document" });
  const confirmed = await append("OutputPlanConfirmed", { plan_revision_id: reference.planRevisionId, source_digest: reference.sourceDigest });
  const preflight = await append("OutputPreflightCompleted", { preflight_id: "stable-audio-preflight", plan_revision_id: reference.planRevisionId });
  const authorization = await append("OutputExecutionAuthorized", { actor_user_id: OWNER, grant_id: reference.grantId,
    plan_revision_id: reference.planRevisionId, preflight_id: "stable-audio-preflight", source_digest: reference.sourceDigest,
    maximum_microusd: maximumMicrousd, maximum_calls: maximumCalls,
    authorized_targets: [{ target_id: reference.targetId, operation_slot_id: reference.slotId, job_id: JOB, route_digest: routeDigest }],
    output_command_envelope: { action: "authorize", documentId: DOCUMENT, clientMutationId: "stable-audio-authorize",
      preflightId: "stable-audio-preflight", termsDigest, maximumMicrousd, explicitAuthorization: true, expectedRevision: `output:${preflight.sequence}` } });
  const completion = await append("DocumentRenderCompleted", { artifact_id: ARTIFACT, artifact_kind: "audio", requested_by_user_id: OWNER,
    source_block_versions: [],
    title: "Synthetic retained Audio", content_ref: CONTENT, content_expires_at: EXPIRY, input_ref: INPUT, input_expires_at: EXPIRY,
    item_count: 1, items: [{ id: `${ARTIFACT}-item-1`, title: "Track", media_url: null, media_type: null }],
    media_url: mediaUrl, media_type: "audio/mpeg", provider: "fal", provider_job_id: mediaCall.providerRequestId, model_id: MODEL,
    planner_model_id: "gpt-5.6-terra", planner_response_id: planner.providerRequestId, reference_inputs: [], used_reference_pixels: false,
    settings, source_surface: "outputs" }, "worker:renderer", "server:document-job:render_document", correlation);
  insert("output_plan_revisions", { scope_key: reference.scopeKey, scope_kind: "personal", owner_user_id: OWNER, project_id: PROJECT, document_id: DOCUMENT,
    plan_revision_id: reference.planRevisionId, plan_id: "stable-audio-plan-root", revision: 1, confirmed_event_id: confirmed.eventId,
    requirements_digest: requirementsDigest, source_digest: reference.sourceDigest, resolver_version: "synthetic-audio-native",
    source_head: confirmed.sequence, target_count: 1, created_at: capturedAt });
  insert("output_plan_targets", { scope_key: reference.scopeKey, plan_revision_id: reference.planRevisionId, target_id: reference.targetId,
    target_contract_digest: reference.targetContractDigest, media_kind: "audio", required: 1, selected: 1, ordinal: 0 });
  insert("output_preflights", { scope_key: reference.scopeKey, preflight_id: "stable-audio-preflight", plan_revision_id: reference.planRevisionId,
    actor_user_id: OWNER, terms_digest: termsDigest, event_id: preflight.eventId, expires_at: EXPIRY, created_at: capturedAt });
  insert("output_execution_grants", { scope_key: reference.scopeKey, grant_id: reference.grantId, plan_revision_id: reference.planRevisionId,
    actor_user_id: OWNER, payer_user_id: OWNER, preflight_id: "stable-audio-preflight", authorization_event_id: authorization.eventId,
    maximum_microusd: maximumMicrousd, maximum_calls: maximumCalls, status: "completed", expires_at: EXPIRY, created_at: capturedAt });
  insert("output_operation_slots", { scope_key: reference.scopeKey, slot_id: reference.slotId, grant_id: reference.grantId,
    plan_revision_id: reference.planRevisionId, target_id: reference.targetId, target_contract_digest: reference.targetContractDigest,
    source_digest: reference.sourceDigest, provider: "fal", model: MODEL, route_digest: routeDigest, job_id: JOB,
    cost_reservation_id: "stable-audio-cost", token_reservation_id: "stable-audio-tokens", maximum_microusd: maximumMicrousd,
    maximum_calls: maximumCalls, maximum_tokens: maximumTokens, status: "succeeded", outcome_event_id: completion.eventId,
    created_at: capturedAt, updated_at: capturedAt });
  for (const call of paidCalls) {
    insert("output_operation_routes", { scope_key: reference.scopeKey, slot_id: reference.slotId, stage_key: call.unitId,
      provider: call.provider, model: call.model, maximum_calls: 1 });
    insert("output_provider_calls", { scope_key: reference.scopeKey, slot_id: reference.slotId, call_key: call.unitId, stage_key: call.unitId,
      client_request_id: call.clientRequestId, request_digest: call.requestDigest, provider: call.provider, model: call.model,
      reserved_microusd: call.costMicrousd, used_microusd: call.costMicrousd, status: "settled", provider_response_id: call.providerRequestId,
      created_at: capturedAt, settled_at: capturedAt });
  }
  insert("output_native_storage_writes", { scope_key: reference.scopeKey, slot_id: reference.slotId, storage_key: mediaKey,
    content_sha256: mediaSha256, status: "written", write_acknowledged: 1, publication_event_id: completion.eventId,
    created_at: capturedAt, updated_at: capturedAt });
  const admission = { schema_version: 1, job_id: JOB, artifact_kind: "audio", document_id: DOCUMENT, captured_at: capturedAt,
    request: { production_mode: "manual", audio_profile: EXPERIENCE_AUDIO_INTENT },
    planner: { provider: "openai", model: "gpt-5.6-terra", request_status: "not_submitted" },
    source: { scope: "authorized_document_context", status: "not_transmitted" } };
  for (const [contentId, kind, value] of [[CONTENT, "document-artifact", originalRaw], [INPUT, "document-artifact-input", JSON.stringify(input)],
    [ADMISSION_INPUT, "document-artifact-input", JSON.stringify(admission)]]) {
    insert("private_content", { content_id: contentId, owner_id: OWNER, kind, content: value, created_at: capturedAt, expires_at: EXPIRY, redacted_at: null });
  }
  const request = { productionMode: "manual", artifactKind: "audio", itemCount: 1, documentId: DOCUMENT,
    documentRevision: "synthetic-source-revision", requestKey: JOB, sourceBlockVersions: [], snapshot: { document: { id: DOCUMENT }, facts: [] },
    audioProfile: EXPERIENCE_AUDIO_INTENT, audioProviderModel: MODEL, audioEstimatedCostMicrousd: mediaCall.costMicrousd,
    outputTargetInstructions: "One instrumental track", outputAudio: contract, outputExecution: reference,
    audioCostConsent: { ...costPreview, confirmed: true, providerTransferConfirmed: true } };
  const result = { artifactId: ARTIFACT, artifactKind: "audio", appendedEventIds: [completion.eventId], outputExecution: reference,
    artifactPlan: JSON.parse(originalRaw), provider: "fal", providerJobId: mediaCall.providerRequestId, providerModel: MODEL,
    providerSubmissionProtocol: 1, providerSubmissions: Object.fromEntries(paidCalls.map(call => [call.clientRequestId, call])),
    plannerResponseId: planner.providerRequestId, plannerInput: input.planner, audioInputReceipt: input.render,
    outputAudioRequest: input.output_audio_request, generationReceipt: { schema_version: 1, input_ref: ADMISSION_INPUT, input_expires_at: EXPIRY } };
  insert("document_jobs", { job_id: JOB, owner_id: OWNER, stream_id: stream, document_id: DOCUMENT, kind: "render_document",
    status: "completed", source_surface: "outputs", correlation_id: correlation, requested_sequence: authorization.sequence,
    request_json: JSON.stringify(request), result_json: JSON.stringify(result), error_message: null, attempt_count: 1,
    requested_at: capturedAt, started_at: capturedAt, completed_at: capturedAt, expires_at: EXPIRY, updated_at: capturedAt });

  seeding = false;
  const calls = [], forbidden = [], mediaCalls = [];
  let beforeRead = null;
  const executeRead = (prepared, bindings, method) => {
    // The canonical Node SQLite adapter executes synchronously before returning
    // its resolved promise. query_only also blocks a terminal writer after WITH.
    state.sqlite.exec("PRAGMA query_only=ON");
    try { return prepared.bind(...bindings)[method](); }
    finally { state.sqlite.exec("PRAGMA query_only=OFF"); }
  };
  const DB = { prepare(sql) {
    if (!/^\s*(?:WITH|SELECT)\b/iu.test(sql)) { forbidden.push(sql); throw Error("Native Audio proof prepared a writer"); }
    const prepared = state.DB.prepare(sql);
    const statement = bindings => ({ bind: (...values) => statement(values), async first() {
      calls.push(sql); if (beforeRead) await beforeRead(sql, bindings); return executeRead(prepared, bindings, "first");
    }, async all() { calls.push(sql); if (beforeRead) await beforeRead(sql, bindings); return executeRead(prepared, bindings, "all"); } });
    return statement([]);
  }, batch() { forbidden.push("batch"); throw Error("Native Audio proof may not batch or mutate"); } };
  const MEDIA = Object.fromEntries(["get", "head", "put", "delete", "list"].map(method => [method, (...args) => {
    mediaCalls.push({ method, args }); forbidden.push(`MEDIA.${method}`); throw Error("Native Audio source proof must not access media");
  }]));
  const baseEnv = { ...state.env, MEDIA, ASSETS: { fetch() { forbidden.push("fetch"); throw Error("Native Audio source proof must not fetch"); } } };
  const env = { ...baseEnv, DB };
  const identity = Object.freeze({ userId: OWNER, email: EMAIL, source: "openai-workspace" });
  const raw = () => state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(CONTENT).content;
  const select = (revision = 0, overrides = {}) => ({ output: "audio", documentId: DOCUMENT, artifactId: ARTIFACT, revision,
    contentSha256: digest(raw()), mediaSha256, sourceProfile: SOURCE_PROFILE, projectionPolicy: PROJECTION_POLICY, ...overrides });
  const selection = select();
  const replace = value => state.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id=?")
    .run(typeof value === "string" ? value : JSON.stringify(value), CONTENT);
  const privatePayload = (eventId = completion.eventId) => JSON.parse(state.sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=?").get(eventId).private_json);
  const changePrivate = (change, eventId = completion.eventId) => {
    const value = privatePayload(eventId); change(value);
    state.sqlite.prepare("UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?").run(JSON.stringify(value), eventId);
  };
  const rawInput = (contentId = INPUT) => state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(contentId).content;
  const changeInput = (change, contentId = INPUT) => {
    const value = JSON.parse(rawInput(contentId)); change(value);
    state.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id=?").run(JSON.stringify(value), contentId);
  };
  const mutateJob = (column, change) => {
    assert.ok(["request_json", "result_json"].includes(column));
    const value = JSON.parse(state.sqlite.prepare(`SELECT ${column} AS value FROM document_jobs WHERE job_id=?`).get(JOB).value); change(value);
    state.sqlite.prepare(`UPDATE document_jobs SET ${column}=? WHERE job_id=?`).run(JSON.stringify(value), JOB);
  };
  t.after(() => { assert.deepEqual(forbidden, [], "Caught forbidden operations still fail the fixture"); assert.equal(state.media.size, 0); });
  return { state, ...state, baseEnv, env, identity, selection, select, calls, mediaCalls, forbidden, insert, append, replace, raw, originalRaw,
    completion, completed: completion, authorization, confirmed, preflight, reference, source, contract, receipt, evidence, expected,
    paidCalls, attempts, costPreview, input, request, result, jobId: JOB, mediaKey, mediaUrl, key: mediaKey, url: mediaUrl,
    expiry: EXPIRY, inputId: INPUT, admissionInputId: ADMISSION_INPUT, contentId: CONTENT, currentRevision: 0,
    privatePayload, changePrivate, rawInput, changeInput, mutateJob, changeJob: mutateJob,
    setBeforeRead(value) { beforeRead = value; }, changes: () => state.sqlite.prepare("SELECT total_changes() AS n").get().n };
}
