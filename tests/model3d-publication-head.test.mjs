import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createRequire } from "node:module";
import { model3dPublicationHead, MODEL3D_REFERENCE_HEAD_SQL } from "../worker/output-model3d-publication-head.ts";
import { eventWriteBindings, EVENT_WRITE_STAGE_TRIGGER_SQL, makeEvent } from "../worker/event-write-primitives.ts";
import { guardOutputPrivateWrites } from "../worker/output-private-execution.ts";
import { appendEvents } from "../worker/event-append.ts";
import { OUTPUT_REQUIREMENTS_SCHEMA } from "../worker/output-requirements-schema.ts";
import { model3dNativeCheckpoint } from "../worker/output-model3d-terminal.ts";
import { providerSubmissions, hasUnresolvedProviderSubmission, hasUnsettledProviderSubmission } from "../src/model/provider-submission.ts";
import { fixture, glb, sha } from "./helpers/model3d-native-execution-fixture.mjs";
import { terminalSource } from "./helpers/model3d-terminal-source.mjs";

// Exact source methods + real in-memory SQLite. No HTTP/provider/R2/browser,
// and no claim that the minimal SQL fixture supplies live user authorization.
const ts = createRequire(import.meta.resolve("../worker/runtime.ts"))("typescript");
function database() {
  const sqlite = new DatabaseSync(":memory:"), runtime = fs.readFileSync(new URL(import.meta.resolve("../worker/runtime.ts")), "utf8");
  for (const name of ["events", "event_private_payloads", "event_write_stage", "document_jobs"]) {
    const m = runtime.match(new RegExp("env\\.DB\\.prepare\\(([`\"])((?:CREATE TABLE IF NOT EXISTS " + name + " \\()[\\s\\S]*?)\\1\\)"));
    assert(m, name + " actual schema"); sqlite.exec(m[2]);
  }
  sqlite.exec(EVENT_WRITE_STAGE_TRIGGER_SQL);
  for (const sql of OUTPUT_REQUIREMENTS_SCHEMA) sqlite.exec(sql);
  const prepare = sql => {
    const wrap = bindings => ({ sql, bindings,
      bind(...values) { assert(values.length <= 100, "D1 cap"); return wrap(values); },
      async first(column) { const row = sqlite.prepare(sql).get(...bindings); return column ? row?.[column] ?? null : row ?? null; },
      async all() { return { success: true, results: sqlite.prepare(sql).all(...bindings) }; },
      async run() { const r = sqlite.prepare(sql).run(...bindings); return { success: true, results: [], meta: { changes: Number(r.changes) } }; },
    }); return wrap([]);
  };
  const DB = { prepare, async batch(statements) {
    sqlite.exec("BEGIN");
    try {
      const results = statements.map(statement => {
        const q = sqlite.prepare(statement.sql);
        if (q.columns().length) return { success: true, results: q.all(...statement.bindings) };
        const r = q.run(...statement.bindings); return { success: true, results: [], meta: { changes: Number(r.changes) } };
      }); sqlite.exec("COMMIT"); return results;
    } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } };
  const insert = (table, value) => { const keys = Object.keys(value); sqlite.prepare(`INSERT INTO ${table}(${keys.join(",")}) VALUES(${keys.map(() => "?").join(",")})`).run(...Object.values(value)); };
  return { sqlite, DB, insert };
}
function publication() {
  const original = { jobId: "model3d-original", ownerId: "owner", streamId: "creative:owner", correlationId: "model3d-original:attempt:1" };
  const completion = { jobId: original.jobId, actorUserId: "owner", documentId: "document", artifactId: "artifact" };
  const common = { document_id: "document", project_id: "project" };
  const events = [
    ["worker:renderer", "DocumentRenderCompleted", { ...common, artifact_id: "artifact", artifact_kind: "model3d", source_surface: "outputs", requested_by_user_id: "owner", settings: { production_mode: "manual", output_model3d: completion } }],
    ["worker:policy", "GenerationUsageRecorded", common],
  ].map(([actor, type, payload], index) => makeEvent(original.streamId, index + 1, actor, "server:document-job:render_document", original.correlationId, type, structuredClone(payload)));
  const fence = { sql: MODEL3D_REFERENCE_HEAD_SQL, bindings: [original.streamId, 0] };
  const continuation = model3dPublicationHead(original), completionJson = JSON.stringify(completion);
  const guard = () => continuation.assertions([fence])[0];
  return { original, events, fence, continuation, completionJson, guard };
}
function present(d, assertion) { return Boolean(d.sqlite.prepare(`SELECT (${assertion.sql}) AS current`).get(...assertion.bindings).current); }
async function publish(d, x, n = 2) {
  await appendEvents({ DB: d.DB }, structuredClone(x.events.slice(0, n)), { initialHead: 0, retries: 1 });
}

test("captured actual append allows old head then exact suffix; wrapped actual terminal SQL succeeds", async () => {
  const d = database(), x = publication(), f = await fixture("image");
  try {
    const sourceGuard = { sql: "?=1", bindings: [1], deadlineMs: Date.parse("2099-01-01T00:00:00.000Z") };
    x.continuation.capture(x.events, x.completionJson);
    assert.equal(present(d, x.guard()), true, "unchanged prepublication head");
    assert.equal(x.guard().bindings.length, 7);
    assert.strictEqual(x.continuation.assertions([sourceGuard, x.fence])[0], sourceGuard, "unrelated proof is untouched");
    const env = guardOutputPrivateWrites({ DB: d.DB, MEDIA: {} }, { key: "scope", kind: "personal" }, { slotId: "slot" }, async () => x.continuation.assertions([sourceGuard, x.fence]));
    await appendEvents(env, x.events, { initialHead: 0, retries: 1 });
    assert.equal(present(d, x.fence), false, "old absolute head would now fail");
    assert.equal(present(d, x.guard()), true, "all exact authored and derived envelopes retained");
    const now = new Date().toISOString(), checkpoint = { providerSubmissions: { one: { status: "completed" } }, outputExecution: { slotId: "slot" }, model3dInputReceipt: { preserved: true } };
    d.insert("document_jobs", { job_id: x.original.jobId, owner_id: "owner", stream_id: x.original.streamId, document_id: "document", kind: "render_document", status: "committing", source_surface: "outputs", correlation_id: x.original.correlationId, requested_sequence: 0, requested_at: now, expires_at: "2099-01-01T00:00:00.000Z", updated_at: now, request_json: JSON.stringify(f.payload), result_json: JSON.stringify(checkpoint) });
    const row = d.sqlite.prepare("SELECT * FROM document_jobs").get();
    await terminalSource()(env, { ...row, output_slot_id: "slot" }, "completed", { artifactId: "artifact", stage: "completed" }, null);
    const final = d.sqlite.prepare("SELECT * FROM document_jobs").get();
    assert.equal(final.status, "completed");
    assert.deepEqual(JSON.parse(final.result_json).model3dInputReceipt, checkpoint.model3dInputReceipt);
    assert.equal(d.sqlite.prepare("SELECT COUNT(*) AS n FROM output_atomic_assertions").get().n, 0);
    sourceGuard.bindings[0] = 0;
    await assert.rejects(env.DB.prepare("UPDATE document_jobs SET result_json=? WHERE job_id=?").bind("{}", row.job_id).run(), error=>
      error.code==="output_execution_authority_unverified"&&/CHECK constraint failed/u.test(String(error.cause)));
    assert.deepEqual(d.sqlite.prepare("SELECT * FROM document_jobs").get(), final, "unchanged source guards still roll back");
  } finally { d.sqlite.close(); }
});

test("partial, unrelated, spoof-correlated, changed or redacted suffixes cannot advance reference head", async () => {
  const changes = [
    d => d.sqlite.prepare("DELETE FROM events WHERE sequence=2").run(),
    d => d.sqlite.prepare("UPDATE events SET event_id='replacement' WHERE sequence=2").run(),
    d => d.sqlite.prepare("UPDATE events SET actor='user' WHERE sequence=1").run(),
    d => d.sqlite.prepare("UPDATE events SET type='ReferenceIngested' WHERE sequence=2").run(),
    d => d.sqlite.prepare("UPDATE events SET payload='{}' WHERE sequence=1").run(),
    d => d.sqlite.prepare("UPDATE event_private_payloads SET private_json='{}' WHERE private_event_id=(SELECT event_id FROM events WHERE sequence=1)").run(),
    d => d.sqlite.prepare("UPDATE event_private_payloads SET owner_id='other' WHERE private_event_id=(SELECT event_id FROM events WHERE sequence=1)").run(),
    d => d.sqlite.prepare("UPDATE event_private_payloads SET document_id='other' WHERE private_event_id=(SELECT event_id FROM events WHERE sequence=1)").run(),
    d => d.sqlite.prepare("UPDATE event_private_payloads SET project_id='other' WHERE private_event_id=(SELECT event_id FROM events WHERE sequence=1)").run(),
    d => d.sqlite.prepare("UPDATE event_private_payloads SET created_at='different' WHERE private_event_id=(SELECT event_id FROM events WHERE sequence=1)").run(),
    d => d.sqlite.prepare("UPDATE event_private_payloads SET redacted_at='2026-01-01' WHERE private_event_id=(SELECT event_id FROM events WHERE sequence=1)").run(),
    async (d, x) => appendEvents({ DB: d.DB }, [makeEvent(x.original.streamId, 3, "user", "other", x.original.correlationId, "ReferenceIngested", {})], { initialHead: 2, retries: 1 }),
  ];
  for (const change of changes) { const d = database(), x = publication(); try {
    x.continuation.capture(x.events, x.completionJson); await publish(d, x); await change(d, x);
    assert.equal(present(d, x.guard()), false);
  } finally { d.sqlite.close(); } }
  for (const n of [1]) { const d = database(), x = publication(); try {
    x.continuation.capture(x.events, x.completionJson); await publish(d, x, n); assert.equal(present(d, x.guard()), false);
  } finally { d.sqlite.close(); } }
});

test("capture is immutable, bounded and bound to actual original writer and owned completion", () => {
  for (const alter of [x => { x.events[1].sequence++; }, x => { x.events[0].streamId = "creative:other"; },
    x => { x.events[0].correlationId = "other"; }, x => { x.events[0].clientId = "other"; },
    x => { x.events[0].eventId = x.events[1].eventId; }, x => { x.events[1].type = "ReferenceIngested"; },
    x => { x.events[0].payload.settings.output_model3d.jobId = "other"; },
    x => { x.events[0].payload.large = "x".repeat(1_000_001); }]) {
    const x = publication(); alter(x); assert.throws(() => x.continuation.capture(x.events, x.completionJson), /output_model3d_publication_changed/u);
  }
  const x = publication(); x.continuation.capture(x.events, x.completionJson);
  const before = structuredClone(x.guard()); x.continuation.capture(structuredClone(x.events), x.completionJson);
  x.events[0].payload.later = "mutation";
  assert.deepEqual(x.guard(), before, "caller mutation cannot change captured SQL/body bytes");
  assert.throws(() => x.continuation.capture(x.events, x.completionJson), /output_model3d_publication_changed/u);
  assert.throws(() => x.continuation.assertions([{ ...x.fence, bindings: [x.original.streamId, 2] }]), /output_model3d_publication_changed/u, "no blind refreshed head substitution");
  const unarmed = publication(); unarmed.continuation.capture(unarmed.events, undefined);
  assert.equal(unarmed.continuation.hasPublication(), false);
  const textOnly = [{ sql: "?=1", bindings: [1] }]; assert.deepEqual(x.continuation.assertions(textOnly), textOnly);
});

const jobSource = fs.readFileSync(new URL(import.meta.resolve("../worker/document-jobs-api.ts")), "utf8");
const sourceFile = ts.createSourceFile("job.ts", jobSource, ts.ScriptTarget.Latest, true);
function declaration(name) {
  const found = [];
  function visit(node) { if ((ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) && node.name?.getText(sourceFile) === name) found.push(node); ts.forEachChild(node, visit); }
  visit(sourceFile); assert.equal(found.length, 1, name + " exact actual declaration");
  return found[0];
}
function compile(source, ports, result) {
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return new Function(...Object.keys(ports), js + "\nreturn " + result + ";")(...Object.values(ports));
}
test("actual terminal-result initializer preserves native 3D receipt before actual refresh, not only late SQL", async () => {
  const f = await fixture("image"), calls = { one: { clientRequestId: "one", provider: "fal", operation: "model3d", model: f.preview.model, status: "completed", costMicrousd: 400000 } };
  const previous = { artifact_kind: "model3d", actual_provider_call_count: null, reservation_microusd: 400000, source_transmission_status: "transmitted", provider_request_status: "submitted" };
  const body = { appended: [{ type: "DocumentRenderCompleted", payload: { provider: "fal", model_id: f.preview.model } }, { type: "GenerationUsageRecorded", payload: { cost_reservation_id: "cost", cost_microusd: 400000 } }] };
  const base = { kind: "render_document", job_id: "original", owner_id: "owner", stream_id: "creative:owner", correlation_id: "original:attempt:1", status: "completed", request_json: JSON.stringify(f.payload) };
  const refreshPorts = { providerSubmissions, hasUnresolvedProviderSubmission, hasUnsettledProviderSubmission,
    parseResult: row => JSON.parse(row.result_json), requiresForegroundDocumentExecution: () => true,
    readJob: () => { throw Error("unexpected reread"); }, readCorrelatedEvents: () => { throw Error("unexpected reread"); },
    costBudgetReservation: () => { throw Error("matching settlement must be reused"); } };
  const refresh = compile(declaration("refreshGenerationReceipt").getText(sourceFile), refreshPorts, "refreshGenerationReceipt");
  for (const native of [true, false]) {
    const row = { ...base, request_json: JSON.stringify(native ? f.payload : { artifactKind: "model3d" }) };
    const ports = { durableCheckpoint: {}, outputBinding: {}, readOutputAudioPayload: () => null, model3dNativeCheckpoint,
      parseRequest: row => JSON.parse(row.request_json), row, liveCheckpoint: { providerSubmissions: calls }, acceptedReceipt: previous,
      safeResult: () => ({}), body, followup: null, sceneConfiguration: null, detail: null, response: { ok: true } };
    const terminal = compile("const " + declaration("terminalResult").getText(sourceFile) + ";", ports, "terminalResult");
    assert.equal(Object.hasOwn(terminal, "providerSubmissions"), native, "only closed native 3D is added");
    const latest = await refresh({}, { userId: "owner", streamId: "creative:owner" }, row, body, null, "",
      { ...row, result_json: JSON.stringify(terminal) }, false, { reservation_id: "cost", used_microusd: 400000, reserved_microusd: 400000, status: "completed" });
    assert.equal(JSON.parse(latest.result_json).generationReceipt.actual_provider_call_count, native ? 1 : null);
  }
});

test("actual writer captures before guarded append and live assertions retain every other proof family", () => {
  const source = fs.readFileSync(new URL(import.meta.resolve("../worker/output-execution-control.ts")), "utf8");
  const ast = ts.createSourceFile("control.ts", source, ts.ScriptTarget.Latest, true), selected = {};
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "liveAssertions") selected.live = node.initializer.getText(ast);
    if (ts.isPropertyAssignment(node) && node.name.getText(ast) === "eventWriteSidecars") selected.sidecars = node.initializer.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast); assert(selected.live && selected.sidecars);
  const x = publication(), model3dPublication = x.continuation;
  const other = Array.from({ length: 10 }, (_, index) => ({ sql: "?", bindings: [index] }));
  const ports = { model3dPublication, model3dCompletionJson: x.completionJson, model3dAssertions: [x.fence],
    authority: { assertions: [other[0]] }, sceneAssertions: [other[1]], audioAssertions: [other[2]], storyboardSourceAssertions: [other[3]], sceneEnvelopeAssertions: [other[4]], storyboardCompletionAssertions: [other[5]], projectJobAuthority: other[6], videoLifetimeAssertions: () => [other[7]], videoSourceAssertions: [other[8]], videoCompletionAssertions: [other[9]],
    outputScopeAuthority: () => ({ sql: "scope" }), scope: { kind: "personal" }, job: { job_id: x.original.jobId, owner_id: "owner", stream_id: x.original.streamId, correlation_id: x.original.correlationId, lease_expires_at: "2099-01-01" }, user: { userId: "owner" }, slot: {},
    env: {}, outputAssertionStatements: () => [], settings: { calls: [] }, claimedCalls: new Map(), observedReceipts: new Map(), prepareOutputImageProviderHealth: () => [], prepareOutputNativeProjectPublicationStatements: () => [] };
  const live = compile("const live=" + selected.live + ";", ports, "live");
  const sidecars = compile("const sidecars=" + selected.sidecars + ";", ports, "sidecars");
  assert.equal(model3dPublication.hasPublication(), false); sidecars(x.events); assert.equal(model3dPublication.hasPublication(), true);
  const assertions = live(); for (const original of other) assert(assertions.includes(original));
  assert(assertions.some(value => value.sql.includes("status IN('authorized','active')")), "original grant gate remains");
  assert(assertions.some(value => value.sql.includes("lease_expires_at")), "original job lease gate remains");
  assert(assertions.some(value => value.sql.includes("json_each(?) expected")), "actual live factory uses exact suffix witness");
});

test("actual lost-ACK callback refuses captured but rolled-back events and accepts only durable exact suffix", async () => {
  const source = fs.readFileSync(new URL(import.meta.resolve("../worker/output-execution-control.ts")), "utf8");
  const ast = ts.createSourceFile("control.ts", source, ts.ScriptTarget.Latest, true), found = [];
  function visit(node) { if (ts.isMethodDeclaration(node) && node.name.getText(ast) === "eventAppendCommitted") found.push(node.getText(ast)); ts.forEachChild(node, visit); }
  visit(ast); assert.equal(found.length, 1);
  const { outputAssertionStatements } = await import("../worker/output-command-core.ts");
  const d = database(), x = publication(); let refreshes = 0;
  try {
    x.continuation.capture(x.events, x.completionJson);
    const ports = { env: { DB: d.DB }, job: { stream_id: x.original.streamId, correlation_id: x.original.correlationId },
      model3dPublication: x.continuation, refreshScene: undefined, refreshAudio: undefined,
      refreshModel3d: async () => { refreshes++; throw Error("blind refreshed head is forbidden"); },
      liveAssertions: () => x.continuation.assertions([x.fence]), outputAssertionStatements, eventWriteBindings };
    const recover = compile("const owner={" + found[0] + "};", ports, "owner.eventAppendCommitted");
    assert.equal(await recover(x.events), false, "no write/rolled-back transaction is not an acknowledgement");
    assert.equal(refreshes, 0);
    await publish(d, x);
    assert.equal(await recover(x.events), true);
    d.sqlite.prepare("UPDATE event_private_payloads SET redacted_at='2026-01-01' WHERE private_event_id=?").run(x.events[0].eventId);
    assert.equal(await recover(x.events), false);
    assert.equal(refreshes, 0, "all attempts use exact captured suffix, never a fresh head");
  } finally { d.sqlite.close(); }
});

test("actual execution closure follows producer's two appends and preparation/transmission refresh head40 to42 before final44", async () => {
  const read = path => fs.readFileSync(new URL(import.meta.resolve(path)), "utf8");
  function select(source, predicate) {
    const ast = ts.createSourceFile("source.ts", source, ts.ScriptTarget.Latest, true), matches = [];
    function visit(node) { if (predicate(node, ast)) matches.push(node.getText(ast)); ts.forEachChild(node, visit); }
    visit(ast); assert.equal(matches.length, 1); return matches[0];
  }
  const control = select(read("../worker/output-execution-control.ts"), node => ts.isFunctionDeclaration(node) && node.name?.text === "createOutputEventExecution");
  const appendInitializer = select(read("../worker/events-api.ts"), node => ts.isVariableDeclaration(node) && node.name.getText() === "appendOperationEvents");
  const sourceInitializer = select(read("../worker/output-model3d-source.ts"), node => ts.isVariableDeclaration(node) && node.name.getText() === "sourceAssertions");
  const producer = read("../worker/model3d-render.ts"), producerAst = ts.createSourceFile("producer.ts", producer, ts.ScriptTarget.Latest, true), appendArguments = [];
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(producerAst) === "appendOperationEvents"
      && ["budgeted ? [requestEvent, budgeted] : [requestEvent]", "[completed, usage]"].includes(node.arguments[1]?.getText(producerAst))) appendArguments.push(node.arguments[1].getText(producerAst));
    ts.forEachChild(node, visit);
  }
  visit(producerAst); assert.deepEqual(appendArguments, ["budgeted ? [requestEvent, budgeted] : [requestEvent]", "[completed, usage]"]);
  assert(producer.indexOf("await appendOperationEvents(env, budgeted") < producer.indexOf("await generateFalModel3d"));
  assert.match(producer, /onPrepared: async receipt => \{\s*if \(nativeModel3d\) await execution!\.output!\.model3d!\.prepare\(receipt\)/u);
  assert.match(producer, /onBeforeSourceTransmission: execution\.output\.beforeSourceTransmission/u);
  const { OutputConflictError, outputAssertionStatements } = await import("../worker/output-command-core.ts");
  const { outputDigest } = await import("../worker/output-disclosure-proof.ts");
  const { readOutputModel3dPayload, requireModel3dMiniAppCostApproval, verifyModel3dPreparedReceipt, qualifyOutputModel3dCompletion } = await import("../worker/output-model3d-execution.ts");
  const { projectNativeRetainedModel3d } = await import("../src/model/native-retained-model3d.ts");
  const { captureModel3dComparisonData } = await import("../src/model/output-model3d-offer.ts");
  const d = database(), f = await fixture("image"), now = new Date().toISOString(), period = now.slice(0, 7), scope = { kind: "personal", key: "scope", ownerUserId: "owner", actorUserId: "owner", projectId: "project", documentId: "document", contextId: null };
  const job = { job_id: f.preview.requestId, owner_id: "owner", stream_id: "creative:owner", correlation_id: f.preview.requestId + ":attempt:1", document_id: "document", kind: "render_document", status: "running", lease_expires_at: "2099-01-01T00:00:00.000Z", request_json: JSON.stringify({ ...f.payload, model3dCostConsent: { ...f.preview, confirmed: true, providerTransferConfirmed: true } }), result_json: JSON.stringify({ reservationId: "tokens", costReservationId: "cost", costReservationPeriod: period, costReservationMicrousd: f.preview.maximumMicrousd }) };
  const settings = { kind: "render_document", payload: f.payload, calls: [] }, current = { available: true, settings }, slot = { status: "running", jobId: job.job_id, slotId: "slot", grantId: "grant", attemptOrdinal: 0, previousSlotId: null, costReservationId: "cost", tokenReservationId: "tokens", maximumMicrousd: f.preview.maximumMicrousd, maximumTokens: 1, routeDigest: await outputDigest(current) };
  const sourceEvent = makeEvent(job.stream_id, 40, "user", "fixture", "source", "ReferenceIngested", { owned: "unchanged source bytes" });
  const sourceValues = eventWriteBindings(sourceEvent);
  d.insert("events", Object.fromEntries(["event_id", "stream_id", "sequence", "occurred_at", "recorded_at", "actor", "client_id", "correlation_id", "causation_id", "compensates_event_id", "schema_version", "type", "payload"].map((name, i) => [name, sourceValues[i]])));
  d.insert("event_private_payloads", { private_event_id: sourceEvent.eventId, owner_id: "owner", project_id: null, document_id: null, private_json: sourceValues[16], created_at: sourceEvent.recordedAt });
  d.insert("document_jobs", { ...job, source_surface: "outputs", requested_sequence: 40, requested_at: now, expires_at: "2099-01-01T00:00:00.000Z", updated_at: now });
  d.insert("output_plan_revisions", { scope_key: "scope", scope_kind: "personal", owner_user_id: "owner", project_id: "project", document_id: "document", plan_revision_id: "plan", plan_id: "plan", revision: 1, confirmed_event_id: sourceEvent.eventId, requirements_digest: f.preview.requirementsDigest, source_digest: f.preview.sourceDigest, resolver_version: "controlled-port", source_head: 40, target_count: 1, created_at: now });
  d.insert("output_preflights", { scope_key: "scope", preflight_id: "preflight", plan_revision_id: "plan", actor_user_id: "owner", terms_digest: "a".repeat(64), event_id: sourceEvent.eventId, expires_at: "2099-01-01T00:00:00.000Z", created_at: now });
  d.insert("output_execution_grants", { scope_key: "scope", grant_id: "grant", plan_revision_id: "plan", actor_user_id: "owner", payer_user_id: "owner", preflight_id: "preflight", authorization_event_id: sourceEvent.eventId, maximum_microusd: f.preview.maximumMicrousd, maximum_calls: 1, status: "active", expires_at: "2099-01-01T00:00:00.000Z", created_at: now });
  const sourceGuard = { sql: "EXISTS(SELECT 1 FROM event_private_payloads WHERE private_event_id=? AND private_json=? AND redacted_at IS NULL)", bindings: [sourceEvent.eventId, sourceValues[16]] };
  const proof = { target: { model3d_contract: f.payload.outputModel3d }, targetPreflight: current, assertions: [sourceGuard], sourceEpoch: { head: 40 }, events: [], context: {}, confirmedPlan: {}, sourceDigest: f.preview.sourceDigest, requirementsDigest: f.preview.requirementsDigest };
  const headReads = [], preflightProofs = new WeakMap(), env = { DB: d.DB, MEDIA: {} }, user = { userId: "owner" };
  // This test isolates the connected execution/writer seam. The source loader
  // is a controlled SQL-backed port, not a claim of HTTP/principal admission.
  // Qualification receives a synthetic completed call; no provider is executed.
  const preflight = async () => {
    const head = d.sqlite.prepare("SELECT MAX(sequence) AS head FROM events").get().head; headReads.push(head);
    const actualAssertions = compile("const " + sourceInitializer + ";", { input: { sourceAssertions: [sourceGuard] }, draft: sourceGuard, receiptAssertion: () => sourceGuard, receipt: {}, original: { guard: sourceGuard, head }, principal: { streamId: job.stream_id }, MODEL3D_REFERENCE_HEAD_SQL }, "sourceAssertions");
    preflightProofs.set(current, actualAssertions); return current;
  };
  const bytes = glb(), media = { bytes, sha256: sha(bytes), mimeType: "model/gltf-binary", role: "mesh", format: "glb" }, call = { clientRequestId: "one", provider: "fal", operation: "model3d", model: f.preview.model, status: "completed", providerRequestId: "provider", costMicrousd: f.preview.maximumMicrousd, totalTokens: 0 };
  const ports = { OutputConflictError, preflightOutputNativeTarget: preflight, outputDigest, outputModel3dPreflightAssertions: value => preflightProofs.get(value), documentJobProjectAuthority: () => null,
    model3dPublicationHead, outputScopeAuthority: () => sourceGuard, readOutputModel3dPayload, requireModel3dMiniAppCostApproval, verifyModel3dPreparedReceipt,
    parsed: raw => JSON.parse(raw ?? "{}"), providerSubmissions, guardOutputPrivateWrites, outputAssertionStatements, eventWriteBindings,
    projectNativeRetainedModel3d, captureModel3dComparisonData, prepareOutputImageProviderHealth: () => [], prepareOutputNativeProjectPublicationStatements: () => [],
    qualifyOutputModel3dCompletion: input => qualifyOutputModel3dCompletion({ ...input, calls: [call] }) };
  const create = compile(control.replace(/^export\s+/u, ""), ports, "createOutputEventExecution");
  try {
    const output = await create(env, user, job, { scope, slot, retentionPolicy: null }, proof), execution = { output };
    const append = compile("const " + appendInitializer + ";", { execution, appendEvents }, "appendOperationEvents");
    const requestEvent = makeEvent(job.stream_id, 41, "user", "server:document-job:render_document", job.correlation_id, "DocumentRenderRequested", { artifact_kind: "model3d" });
    const budgeted = makeEvent(job.stream_id, 42, "worker:policy", "server:document-job:render_document", job.correlation_id, "BudgetReserved", {});
    const initial = compile("const value=" + appendArguments[0] + ";", { requestEvent, budgeted }, "value");
    await append(output.guardedEnvironment, initial);
    assert.equal(d.sqlite.prepare("SELECT MAX(sequence) AS head FROM events").get().head, 42);
    await assert.rejects(output.guardedEnvironment.DB.prepare("UPDATE document_jobs SET result_json=result_json WHERE job_id=?").bind(job.job_id).run(), error=>
      error.code==="output_execution_authority_unverified"&&/CHECK constraint failed/u.test(String(error.cause)), "stale head40 cannot silently rebase to42");
    assert.equal(d.sqlite.prepare("SELECT status FROM document_jobs").get().status, "running");
    await output.model3d.prepare(f.receipt);
    await output.beforeSourceTransmission();
    assert.deepEqual(headReads, [40, 40, 42, 42], "actual closure refreshes through real prepare/transmission callbacks");
    const qualified = await output.model3d.qualify(media, "provider");
    const files = [{ url: "/api/media/owned.glb", sha256: media.sha256, fileSize: bytes.byteLength, mimeType: media.mimeType, role: "mesh", format: "glb", fileName: "owned.glb" }];
    const completion = await output.model3d.complete("artifact", files, qualified);
    const completed = makeEvent(job.stream_id, 43, "worker:renderer", "server:document-job:render_document", job.correlation_id, "DocumentRenderCompleted", { artifact_id: "artifact", artifact_kind: "model3d", source_surface: "outputs", requested_by_user_id: "owner", document_id: "document", settings: { production_mode: "manual", output_model3d: completion } });
    const usage = makeEvent(job.stream_id, 44, "worker:policy", "server:document-job:render_document", job.correlation_id, "GenerationUsageRecorded", {});
    const final = compile("const value=" + appendArguments[1] + ";", { completed, usage }, "value");
    await append(output.guardedEnvironment, final);
    assert.equal(d.sqlite.prepare("SELECT MAX(sequence) AS head FROM events").get().head, 44);
    await terminalSource()(output.guardedEnvironment, { ...job, output_slot_id: "slot" }, "completed", { artifactId: "artifact" }, null);
    assert.equal(d.sqlite.prepare("SELECT status FROM document_jobs").get().status, "completed");
    assert.equal(await output.eventAppendCommitted(final), true);
    d.sqlite.prepare("UPDATE event_private_payloads SET redacted_at='withdrawn' WHERE private_event_id=?").run(sourceEvent.eventId);
    assert.equal(await output.eventAppendCommitted(final), false, "original selected source remains live after own publication");
  } finally { d.sqlite.close(); }
});
