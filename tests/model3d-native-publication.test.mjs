import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { guardOutputPrivateWrites } from "../worker/output-private-execution.ts";
import { OUTPUT_REQUIREMENTS_SCHEMA } from "../worker/output-requirements-schema.ts";
import { fixture, glb, sha } from "./helpers/model3d-native-execution-fixture.mjs";
import { qualifyOutputModel3dCompletion } from "../worker/output-model3d-execution.ts";
import { readRetainedOutputModel3d } from "../worker/output-model3d-retained.ts";
import { MODEL3D_PRIVATE_CHECKPOINT_KEYS, model3dPublicResultSql } from "../worker/output-model3d-terminal.ts";
import { terminalSource, serializeTerminalSource, emittedModel3dCompletionSource } from "./helpers/model3d-terminal-source.mjs";
import { RODIN_ADAPTER_VERSION } from "../src/model/model3d.ts";

// Actual source SQL on node:sqlite. This isolates the private-write/publication
// wrapper, not the full handler's authentication, queue, provider or R2 protocol.
function database() {
  const sqlite = new DatabaseSync(":memory:"); sqlite.exec("PRAGMA foreign_keys=ON");
  const runtime = fs.readFileSync(new URL(import.meta.resolve("../worker/runtime.ts")), "utf8");
  for (const table of ["events", "event_private_payloads", "document_jobs", "private_content", "project_resource_scopes"]) {
    const match = runtime.match(new RegExp("env\\.DB\\.prepare\\(([`\"])((?:CREATE TABLE IF NOT EXISTS " + table + " \\()[\\s\\S]*?)\\1\\)"));
    assert(match, table + " actual DDL"); sqlite.exec(match[2]);
  }
  for (const sql of OUTPUT_REQUIREMENTS_SCHEMA) sqlite.exec(sql);
  const prepare = sql => {
    const wrap = bindings => ({
      bind(...values) { assert(values.length <= 100, "D1 binding cap"); return wrap(values); },
      run() { const r = sqlite.prepare(sql).run(...bindings); return Promise.resolve({ success: true, results: [], meta: { changes: Number(r.changes) } }); },
      first(column) { const r = sqlite.prepare(sql).get(...bindings); return Promise.resolve(column ? r?.[column] ?? null : r ?? null); },
      all() { return Promise.resolve({ success: true, results: sqlite.prepare(sql).all(...bindings) }); },
      sql, bindings,
    });
    return wrap([]);
  };
  const DB = { prepare, async batch(statements) {
    sqlite.exec("BEGIN");
    try { const rows = []; for (const statement of statements) {
      const q = sqlite.prepare(statement.sql);
      if (q.columns().length) rows.push({ success: true, results: q.all(...statement.bindings) });
      else { const r = q.run(...statement.bindings); rows.push({ success: true, results: [], meta: { changes: Number(r.changes) } }); }
    } sqlite.exec("COMMIT"); return rows; } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } };
  return { sqlite, DB, insert(table, value) {
    const keys = Object.keys(value); sqlite.prepare("INSERT INTO " + table + "(" + keys.join(",") + ") VALUES(" + keys.map(() => "?").join(",") + ")").run(...Object.values(value));
  } };
}
async function setup() {
  const f = await fixture("image"), p = f.preview, bytes = glb(), hash = sha(bytes), d = database(), now = new Date().toISOString();
  const scope = { kind: "personal", key: "personal:owner:project", actorUserId: "owner", ownerUserId: "owner", documentId: "document",
    projectId: "project", organizationId: null, projectAccessId: null, contextId: null };
  const reference = { scopeKey: scope.key, slotId: "slot", grantId: "grant", planRevisionId: "plan", targetId: "target",
    sourceDigest: p.sourceDigest, targetContractDigest: "e".repeat(64) };
  const event = (id, sequence, type = "OutputPlanConfirmed") => ({ event_id: id, stream_id: "creative:owner", sequence, occurred_at: now, recorded_at: now,
    actor: "worker:renderer", client_id: "test", correlation_id: "correlation", schema_version: 1, type, payload: "{}" });
  for (const [i, id] of ["confirmed", "preflight", "authorized"].entries()) d.insert("events", event(id, i + 1));
  d.insert("output_plan_revisions", { scope_key: scope.key, scope_kind: "personal", owner_user_id: "owner", project_id: "project", document_id: "document",
    plan_revision_id: "plan", plan_id: "plan", revision: 1, confirmed_event_id: "confirmed", requirements_digest: p.requirementsDigest,
    source_digest: p.sourceDigest, resolver_version: "test", source_head: 3, target_count: 1, created_at: now });
  d.insert("output_plan_targets", { scope_key: scope.key, plan_revision_id: "plan", target_id: "target", target_contract_digest: reference.targetContractDigest,
    media_kind: "model3d", required: 1, selected: 1, ordinal: 0 });
  d.insert("output_preflights", { scope_key: scope.key, preflight_id: "preflight", plan_revision_id: "plan", actor_user_id: "owner",
    terms_digest: "a".repeat(64), event_id: "preflight", expires_at: p.expiresAt, created_at: now });
  d.insert("output_execution_grants", { scope_key: scope.key, grant_id: "grant", plan_revision_id: "plan", actor_user_id: "owner", payer_user_id: "owner",
    preflight_id: "preflight", authorization_event_id: "authorized", maximum_microusd: p.maximumMicrousd, maximum_calls: 1, status: "active", expires_at: p.expiresAt, created_at: now });
  d.insert("output_operation_slots", { scope_key: scope.key, slot_id: "slot", grant_id: "grant", plan_revision_id: "plan", target_id: "target",
    target_contract_digest: reference.targetContractDigest, source_digest: p.sourceDigest, provider: "fal", model: p.model,
    route_digest: "1".repeat(64), job_id: p.requestId, cost_reservation_id: "cost", token_reservation_id: "tokens",
    maximum_microusd: p.maximumMicrousd, maximum_calls: 1, maximum_tokens: 1, status: "running", created_at: now, updated_at: now });
  d.insert("output_operation_routes", { scope_key: scope.key, slot_id: "slot", stage_key: "model3d:initial", provider: "fal", model: p.model, maximum_calls: 1 });
  d.insert("output_provider_calls", { scope_key: scope.key, slot_id: "slot", call_key: "model3d:initial", client_request_id: "forma-model3d-original",
    request_digest: f.receipt.requestDigest, stage_key: "model3d:initial", provider: "fal", model: p.model, reserved_microusd: p.maximumMicrousd,
    used_microusd: p.maximumMicrousd, status: "settled", provider_response_id: "provider-original", created_at: now, settled_at: now });
  d.insert("document_jobs", { job_id: p.requestId, owner_id: "owner", stream_id: "creative:owner", document_id: "document", kind: "render_document",
    status: "committing", source_surface: "outputs", correlation_id: "correlation", requested_sequence: 4, requested_at: now, expires_at: p.expiresAt, updated_at: now,
    request_json: JSON.stringify({ ...f.payload, outputExecution: reference, model3dCostConsent: { ...p, confirmed: true, providerTransferConfirmed: true } }),
    result_json: JSON.stringify({ artifactId: "artifact" }) });
  const call = { clientRequestId: "forma-model3d-original", provider: "fal", operation: "model3d", model: p.model, status: "completed",
    providerRequestId: "provider-original", costMicrousd: p.maximumMicrousd, totalTokens: 0 };
  const receipt = await qualifyOutputModel3dCompletion({ offer: f.offer, prepared: f.receipt, calls: [call], providerRequestId: "provider-original",
    primary: { bytes, sha256: hash, mimeType: "model/gltf-binary", role: "mesh", format: "glb" } });
  const storageKey = "owner/model.glb", files = [{ url: "/api/media/" + encodeURIComponent(storageKey), sha256: hash, fileSize: bytes.byteLength,
    mimeType: "model/gltf-binary", fileName: "model.glb", role: "mesh", format: "glb", previewSupported: true }];
  const completion = { schemaVersion: 1, jobId: p.requestId, actorUserId: "owner", documentId: "document", projectId: "project", artifactId: "artifact",
    execution: reference, contract: f.offer.contract, costPreview: p, receipt, files };
  let ownedCompletion = JSON.stringify(completion), proof = true, puts = 0;
  const wrapped = guardOutputPrivateWrites({ DB: d.DB, MEDIA: { async put() { puts++; return { key: storageKey }; } } }, scope,
    { ...reference, jobId: p.requestId }, async () => [{ sql: "?", bindings: [Number(proof)] }], { model3dCompletionJson: () => ownedCompletion });
  await wrapped.MEDIA.put(storageKey, bytes); assert.equal(puts, 1);
  // Execute the real emitted-body expression. In particular this fixture must
  // not supply production_mode itself and hide a missing producer marker.
  const emitPorts = { sourceReceipt: { document_id: "document", project_id: "project" }, workflowLineage: {}, artifactId: "artifact", executionScope: undefined, ownerId: "owner",
    plan: { title: "Kettle <literal>", summary: f.payload.model3dPrompt }, stored: { contentId: "content", expiresAt: p.expiresAt }, inputStored: { contentId: "input", expiresAt: p.expiresAt },
    primary: files[0], generated: { providerJobId: "provider-original", model: p.model, latencyMs: 1, seed: null }, preparedReceipt: f.receipt,
    sourceSurface: "outputs", prepared: { settings: f.payload.model3dSettings }, files, nativeCompletion: completion, RODIN_ADAPTER_VERSION,
    costReservationMicrousd: p.maximumMicrousd, actualCostMicrousd: p.maximumMicrousd, body: {} };
  const payload = emittedModel3dCompletionSource(emitPorts);
  const rawContent = JSON.stringify({ title: "Kettle <literal>", content_markdown: f.payload.model3dPrompt, presentation: null, items: [] });
  const originalInput = { schema_version: 1, artifact_kind: "model3d", artifact_id: "artifact", document_id: "document", project_id: "project",
    output_model3d: completion, model3d_preparation: f.payload.model3dPreparation,
    request: { source_surface: "outputs", model3d_prompt: f.payload.model3dPrompt, model3d_prompt_source: "document", model3d_settings: f.payload.model3dSettings,
      model3d_adaptation: null, model3d_reference_block_ids: f.payload.model3dReferenceBlockIds }, render: { ...f.receipt, providerJobId: "provider-original" } };
  d.insert("private_content", { content_id: "input", owner_id: "owner", kind: "document-artifact-input", content: JSON.stringify(originalInput), created_at: now, expires_at: p.expiresAt });
  const checkpoint = { artifactId: "artifact", artifactKind: "model3d", outputExecution: reference, model3dInputReceipt: f.receipt,
    model3dSettings: f.payload.model3dSettings, model3dProviderFiles: files, model3dEstimatedCostMicrousd: p.maximumMicrousd,
    providerSubmissionProtocol: 1, providerSubmissions: { [call.clientRequestId]: call }, provider: "fal", providerModel: p.model,
    providerJobId: "provider-original", model3dProviderSubmission: "confirmed", providerCancelUrl: null };
  d.sqlite.prepare("UPDATE document_jobs SET result_json=? WHERE job_id=?").run(JSON.stringify(checkpoint), p.requestId);
  const publish = async body => wrapped.DB.batch([
    wrapped.DB.prepare("INSERT INTO events(event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,schema_version,type,payload) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
      .bind("completed", "creative:owner", 4, now, now, "worker:renderer", "test", "correlation", 1, "DocumentRenderCompleted", "{}"),
    wrapped.DB.prepare("INSERT INTO event_private_payloads(private_event_id,owner_id,project_id,document_id,private_json,created_at) VALUES(?,?,?,?,?,?)")
      .bind("completed", "owner", "project", "document", JSON.stringify(body), now),
  ]);
  const row = () => ({ ...d.sqlite.prepare("SELECT * FROM document_jobs WHERE job_id=?").get(p.requestId), output_slot_id: "slot" });
  const retainedInput = { ownerId: "owner", completionId: "completed", documentId: "document", projectId: "project", artifactId: "artifact", contentId: "content",
    inputId: "input", rawContent, contentExpiresAt: p.expiresAt, completionRaw: JSON.stringify(payload) };
  return { d, payload, emitPorts, publish, p, completion, checkpoint, row, retainedInput, noOwner() { ownedCompletion = undefined; }, withdraw() { proof = false; } };
}
test("actual native-storage wrapper publishes only its exact original model3d receipt on SQLite", async () => {
  const x = await setup(); try {
    assert.equal(x.d.sqlite.prepare("SELECT write_acknowledged FROM output_native_storage_writes").get().write_acknowledged, 1);
    await x.publish(x.payload);
    assert.equal(x.d.sqlite.prepare("SELECT publication_event_id FROM output_native_storage_writes").get().publication_event_id, "completed");
    assert.equal(x.d.sqlite.prepare("SELECT COUNT(*) AS n FROM output_provider_calls").get().n, 1);
    assert.equal(x.d.sqlite.prepare("SELECT COUNT(*) AS n FROM output_atomic_assertions").get().n, 0);
  } finally { x.d.sqlite.close(); }
});
test("actual terminal SQL preserves the private original and joins strict retained read; the old assignment refuses", async () => {
  for (const withoutModel3dPreservation of [true, false]) {
    const x = await setup(); try {
      // Exercise presence, not only omission: recovery capabilities and their
      // history/manifests must survive terminal persistence but never a feed.
      Object.assign(x.checkpoint, {
        outputModel3dRecovery: { version: "output-model3d-recovery-v1", token: "private-token" },
        outputModel3dRecoveryHistory: [{ providerRequestId: "private-original" }],
        outputModel3dRecoveryEnvelopes: [{ contentRef: "private-provider-response" }],
        outputModel3dRecoveryFiles: [{ storageKey: "private-owned-model", sha256: "1".repeat(64) }],
      });
      x.d.sqlite.prepare("UPDATE document_jobs SET result_json=?").run(JSON.stringify(x.checkpoint));
      await x.publish(x.payload);
      await terminalSource({ withoutModel3dPreservation })({ DB: x.d.DB }, x.row(), "completed",
        { artifactId: "artifact", artifactKind: "model3d", appendedEventIds: ["completed"], stage: "completed" }, null);
      assert.equal(x.row().status, "completed");
      assert.equal(x.d.sqlite.prepare("SELECT status FROM output_operation_slots").get().status, "succeeded");
      assert.equal(x.d.sqlite.prepare("SELECT status FROM output_execution_grants").get().status, "completed");
      if (withoutModel3dPreservation) {
        assert.equal(Object.hasOwn(JSON.parse(x.row().result_json), "outputExecution"), false);
        await assert.rejects(readRetainedOutputModel3d({ DB: x.d.DB }, x.retainedInput), /unavailable/);
      } else {
        const stored = JSON.parse(x.row().result_json);
        for (const key of MODEL3D_PRIVATE_CHECKPOINT_KEYS) {
          assert.deepEqual(stored[key], x.checkpoint[key], key);
          assert.equal(Object.hasOwn(stored, key), Object.hasOwn(x.checkpoint, key), key + " missing/null distinction");
        }
        const read = await readRetainedOutputModel3d({ DB: x.d.DB }, x.retainedInput);
        const final = await x.d.DB.prepare("WITH model3d_witness AS (SELECT ? AS bindings) SELECT 1 AS admitted WHERE " + read.witness.sql).bind(read.witness.json).first();
        assert.equal(final.admitted, 1);
        const publicResult = serializeTerminalSource(x.row()).result;
        assert.equal(publicResult.artifactId, "artifact");
        for (const key of MODEL3D_PRIVATE_CHECKPOINT_KEYS) assert.equal(Object.hasOwn(publicResult, key), false, key);
        for (const alias of ["", "job"]) {
          const projected = JSON.parse(x.d.sqlite.prepare("SELECT " + model3dPublicResultSql(alias) + " AS value FROM document_jobs" + (alias ? " job" : "")).get().value);
          assert.equal(projected.artifactId, "artifact");
          for (const key of MODEL3D_PRIVATE_CHECKPOINT_KEYS) assert.equal(Object.hasOwn(projected, key), false, "SQL projection " + key);
        }
        x.d.sqlite.exec("UPDATE output_provider_calls SET used_microusd=0");
        assert.equal(await x.d.DB.prepare("WITH model3d_witness AS (SELECT ? AS bindings) SELECT 1 AS admitted WHERE " + read.witness.sql).bind(read.witness.json).first(), null);
        await assert.rejects(readRetainedOutputModel3d({ DB: x.d.DB }, x.retainedInput), /unavailable/);
      }
    } finally { x.d.sqlite.close(); }
  }
});
test("actual emitted native manual marker reaches strict read; missing marker refuses while general assets stay unchanged", async () => {
  const x = await setup(); try {
    assert.equal(x.payload.settings.production_mode, "manual");
    const general = emittedModel3dCompletionSource({ ...x.emitPorts, nativeCompletion: null });
    assert.equal(Object.hasOwn(general.settings, "production_mode"), false);
    assert.equal(Object.hasOwn(general.settings, "output_model3d"), false);
    assert.deepEqual(general.settings.model3d_files, x.payload.settings.model3d_files);
    await x.publish(x.payload);
    await terminalSource()({ DB: x.d.DB }, x.row(), "completed", { artifactId: "artifact", artifactKind: "model3d", appendedEventIds: ["completed"] }, null);
    const read = await readRetainedOutputModel3d({ DB: x.d.DB }, x.retainedInput); assert(read);
    const old = emittedModel3dCompletionSource(x.emitPorts, { omitNativeMode: true });
    await assert.rejects(readRetainedOutputModel3d({ DB: x.d.DB }, { ...x.retainedInput, completionRaw: JSON.stringify(old) }), /unavailable/);
  } finally { x.d.sqlite.close(); }
});
test("completed original refuses changed execution, input, publication, principal or source; cancellation leaves no read", async () => {
  for (const change of ["execution", "input", "publication", "correlation", "owner", "source", "aborted"]) {
    const x = await setup(); try {
      await x.publish(x.payload);
      await terminalSource()({ DB: x.d.DB }, x.row(), "completed", { artifactId: "artifact", artifactKind: "model3d", appendedEventIds: ["completed"] }, null);
      if (change === "execution") x.d.sqlite.exec("UPDATE document_jobs SET result_json=json_set(result_json,'$.outputExecution.sourceDigest','different')");
      if (change === "input") x.d.sqlite.exec("UPDATE private_content SET content=json_set(content,'$.render.providerJobId','different')");
      if (change === "publication") x.d.sqlite.exec("UPDATE output_native_storage_writes SET publication_event_id=NULL");
      if (change === "correlation") x.d.sqlite.exec("UPDATE events SET correlation_id='different' WHERE event_id='completed'");
      if (change === "owner") x.retainedInput.ownerId = "other";
      if (change === "source") x.retainedInput.rawContent = JSON.stringify({ title: "Kettle", content_markdown: "changed", presentation: null, items: [] });
      if (change === "aborted") x.retainedInput.signal = AbortSignal.abort();
      await assert.rejects(readRetainedOutputModel3d({ DB: x.d.DB }, x.retainedInput));
    } finally { x.d.sqlite.close(); }
  }
});
test("self-described or mutated original receipt cannot publish; failed current proof rolls back exact writes", async () => {
  for (const action of ["no-owner", "provider-id", "source", "hash", "unsettled", "cost", "consent", "withdrawn"]) {
    const x = await setup(); try {
      if (action === "no-owner") x.noOwner();
      if (action === "provider-id") x.payload.provider_job_id = "different";
      if (action === "source") x.payload.settings.output_model3d.execution.sourceDigest = "0".repeat(64);
      if (action === "hash") x.payload.settings.output_model3d.files[0].sha256 = "0".repeat(64);
      if (action === "unsettled") x.d.sqlite.exec("UPDATE output_provider_calls SET status='uncertain',used_microusd=NULL");
      if (action === "cost") x.d.sqlite.exec("UPDATE output_provider_calls SET used_microusd=0");
      if (action === "consent") x.d.sqlite.exec("UPDATE document_jobs SET request_json=json_set(request_json,'$.model3dCostConsent.confirmed',json('false'))");
      if (action === "withdrawn") { x.withdraw(); await assert.rejects(x.publish(x.payload)); assert.equal(x.d.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE event_id='completed'").get().n, 0); }
      else await x.publish(x.payload);
      assert.equal(x.d.sqlite.prepare("SELECT publication_event_id FROM output_native_storage_writes").get().publication_event_id, null, action);
    } finally { x.d.sqlite.close(); }
  }
});
