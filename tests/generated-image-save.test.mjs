import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { outputTestDatabase, registerOutputSourceImports } from "./output-server-test-helpers.mjs";
import {readLocalMigrations,migrateLocalDatabase} from "../scripts/lib/local-migrations.mjs";
import { png } from "./output-asset-fixtures.mjs";

// Actual SQLite transactions/triggers and owned RAM object bytes. The PNGs are
// declared synthetic supplied compositions, not renderer/provider output proof.
const imports = registerOutputSourceImports();
let handleGeneratedImageEdit, handleEvents, runtime, foldEvents, imageOutputContextEvents, composition, revision, ownerMediaNamespace;
try {
  ({ handleGeneratedImageEdit } = await import("../worker/generated-image-api.ts"));
  ({ handleEvents } = await import("../worker/events-api.ts"));
  runtime = await import("../worker/runtime.ts");
  ({ foldEvents } = await import("../src/model/events.ts"));
  ({ imageOutputContextEvents } = await import("../src/model/output-context.ts"));
  composition = await import("../src/model/reference-composition.ts");
  revision = await import("../src/model/generated-image-revision.ts");
  ({ ownerMediaNamespace } = await import("../src/model/media-ownership.ts"));
} finally { imports.deregister(); }

const OWNER = "generated-image-save-owner", EMAIL = "generated-image-save@example.test";
const PROJECT = "generated-image-save-project", DOCUMENT = "generated-image-save-document";
const OUTPUT = "generated-image-save-output", CONTENT = "generated-image-save-content", GENERATION = "generated-image-save-generation";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const headers = { "oai-authenticated-user-id": OWNER, "oai-authenticated-user-email": EMAIL };
const internalKey = "generated-image/" + Buffer.from(OUTPUT).toString("hex");
const WIDTH = 1536, HEIGHT = 864;
function syntheticPng(channel) {
  const stride = WIDTH * 4 + 1, raw = new Uint8Array(stride * HEIGHT);
  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
    const offset = y * stride + 1 + x * 4;
    raw[offset + channel] = x < WIDTH / 2 ? 180 : 75; raw[offset + 3] = 255;
  }
  return png({ width: WIDTH, height: HEIGHT, raw });
}
const ORIGINAL = syntheticPng(0), EDITED = syntheticPng(1), NEXT = syntheticPng(2);
const rows = (f, sql, ...args) => f.sqlite.prepare(sql).all(...args).map(row => ({ ...row }));
const mediaState = f => [...f.media].map(([key, value]) => ({ key, sha256: hash(value.bytes), metadata: structuredClone(value.metadata), contentType: value.contentType }));
const edits = f => rows(f, "SELECT e.*,p.private_json,p.owner_id private_owner,p.project_id private_project,p.document_id private_document,p.redacted_at private_redacted FROM events e JOIN event_private_payloads p ON p.private_event_id=e.event_id WHERE e.stream_id=? AND e.type='GeneratedImageEdited' ORDER BY e.sequence", f.streamId);
const history = f => rows(f, "SELECT * FROM artifact_revisions WHERE owner_id=? AND artifact_id=? ORDER BY revision", OWNER, internalKey);
const spend = f => rows(f, "SELECT scope,scope_id,period,used_microusd,reserved_microusd FROM cost_budget_counters ORDER BY scope,scope_id,period");
const paidOperations = f => Object.fromEntries(["document_jobs", "budget_reservations", "cost_budget_reservations", "output_execution_grants", "output_operation_slots", "output_provider_calls"].map(table => [table, f.sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n]));
function owned(f) {
  return { edits: edits(f), history: history(f), media: mediaState(f), raw: f.rawNow(),
    completion: f.sqlite.prepare("SELECT * FROM event_private_payloads WHERE private_event_id=?").get(f.completion.eventId),
    stage: rows(f, "SELECT event_id FROM event_write_stage WHERE stream_id=?", f.streamId) };
}
async function body(response, expected = 200) {
  const value = await response.json(); assert.equal(response.status, expected, JSON.stringify(value)); return value;
}
async function fixture(t) {
  let externalAttempts = 0;
  t.mock.method(globalThis, "fetch", async () => { externalAttempts++; assert.fail("No provider or external request belongs to generated Image Save"); });
  const f = outputTestDatabase();
  migrateLocalDatabase(f.sqlite,{migrations:readLocalMigrations(new URL('../drizzle/',import.meta.url))});
  await runtime.ensureSchema(f.env);
  const now = new Date().toISOString(); f.streamId = "creative:" + OWNER;
  f.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
    .run(OWNER, EMAIL, "Generated Image Save fixture", "creator", "pilot-2026-08-10", now, now, now);
  f.raw = JSON.stringify({ title: "Harbor image", scene: "A declared synthetic retained still", rationale: "Original direction remains immutable." });
  f.rawNow = () => f.sqlite.prepare("SELECT content FROM private_content WHERE content_id=? AND owner_id=?").get(CONTENT, OWNER)?.content;
  f.events = [];
  f.seed = async (type, payload, actor = "user") => {
    const event = await runtime.appendAuditEvent(f.env, f.streamId, actor, type, payload); f.events.push(event); return event;
  };
  await f.seed("ProjectCreated", { project_id: PROJECT, name: "Generated Image Save" });
  await f.seed("DocumentCreated", { project_id: PROJECT, document_id: DOCUMENT, title: "Harbor image" });
  f.sqlite.prepare("INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at) VALUES(?,?,?,?,?,?,NULL)")
    .run(CONTENT, OWNER, "provider-output", f.raw, now, "2099-01-01T00:00:00.000Z");
  f.originalKey = ownerMediaNamespace(OWNER) + "/generated/" + GENERATION + ".png";
  f.originalUrl = "/api/media/" + encodeURIComponent(f.originalKey);
  await f.env.MEDIA.put(f.originalKey, ORIGINAL, { httpMetadata: { contentType: "image/png" }, customMetadata: { ownerId: OWNER, sha256: hash(ORIGINAL), mimeType: "image/png" } });
  f.completion = await f.seed("GenerationCompleted", { project_id: PROJECT, document_id: DOCUMENT, object_id: OUTPUT, object_ids: [OUTPUT], generation_id: GENERATION,
    output_ref: CONTENT, media_url: f.originalUrl, media_type: "image/png", source_content_hash: hash(ORIGINAL), image_width: WIDTH, image_height: HEIGHT,
    quality: "high", purpose: "final", simulation: false, content_expires_at: "2099-01-01T00:00:00.000Z" }, "worker:generator");
  const output = foldEvents(f.events, Infinity, DOCUMENT, PROJECT).libraryOutputs.find(value => value.id === OUTPUT); assert(output);
  f.associate = async (media, suffix = "initial") => {
    const ids = ["image-save-reference-" + suffix, "image-save-receipt-" + suffix];
    const result = imageOutputContextEvents({ ...output, mediaUrl: media.url, mediaType: "image/png", width: WIDTH, height: HEIGHT },
      { documentId: DOCUMENT, projectId: PROJECT, sourceSurface: "declared-local-test-adoption", contentHash: media.sha256, idFactory: () => ids.shift() });
    assert.equal(result.events.length, 2);
    for (const event of result.events) await f.seed(event.type, event.payload);
    return result.blockIds[0];
  };
  f.blockId = await f.associate({ url: f.originalUrl, sha256: hash(ORIGINAL) });
  assert.deepEqual(await body(await handleGeneratedImageEdit(new Request("https://forma.test/api/generated-images/"+OUTPUT,
    {method:"POST",headers:{...headers,"content-type":"application/json",origin:"https://forma.test"},
      body:JSON.stringify({operation:"prepare-current-read"})}),f.env,OUTPUT)),{status:"prepared"});
  f.read = (operation, auth = headers) => handleGeneratedImageEdit(new Request("https://forma.test/api/generated-images/" + OUTPUT + (operation ? "?operationSha256=" + operation : ""), { headers: auth }), f.env, OUTPUT);
  f.save = async (request, bytes = EDITED, options = {}) => {
    const form = new FormData(); form.append("request", JSON.stringify(request)); form.append("png", new File([bytes], "declared-composition.png", { type: "image/png" }));
    if (options.extra) form.append("extra", "not allowed");
    // Dispatch the genuine finite HTTP multipart bytes. Early Origin refusal
    // must not leave Node's asynchronous FormData encoder writing to a cancelled
    // request stream after the case has ended; server parsing remains real.
    const encoded = new Response(form), contentType = encoded.headers.get("content-type"), wire = await encoded.arrayBuffer();
    return handleGeneratedImageEdit(new Request("https://forma.test/api/generated-images/" + OUTPUT, { method: "PATCH", headers: { ...headers, "content-type": contentType, origin: "https://forma.test", ...options.headers }, body: wire, ...(options.signal ? { signal: options.signal } : {}) }), f.env, OUTPUT);
  };
  f.input = async (bytes = EDITED) => {
    const snapshot = await body(await f.read()); assert.equal(snapshot.status, "current");
    const source = snapshot.sources.find(value => snapshot.sourceIds.includes(value.id)); assert(source, "a genuine current generated-output reference is required");
    const recipe = composition.addReferenceCompositionLayer(composition.createReferenceComposition("16:9"), source, "declared-layer");
    const value = { expectedRevision: snapshot.revision, expectedEditEventId: snapshot.editEventId, expectedContentSha256: snapshot.contentSha256,
      generationId: snapshot.generationId, sourceEventId: snapshot.sourceEventId, contentRef: snapshot.contentRef,
      sourceMediaUrl: snapshot.media.url, sourceMediaSha256: snapshot.media.sha256, sourceId: source.id, recipe,
      resultMediaSha256: hash(bytes), resultByteLength: bytes.length };
    assert(revision.parseGeneratedImageEditRequest(value)); return value;
  };
  f.puts = []; const put = f.env.MEDIA.put.bind(f.env.MEDIA);
  f.env.MEDIA.put = async (key, bytes, options) => {
    assert.deepEqual(options.onlyIf, { etagDoesNotMatch: "*" }); assert.equal(f.media.has(key), false, "the derivative key is immutable and new");
    f.puts.push({ key, sha256: hash(new Uint8Array(bytes)), options: structuredClone(options) }); return put(key, bytes, options);
  };
  const amounts = values => ({ used: values.reduce((total, value) => total + value.used_microusd, 0), reserved: values.reduce((total, value) => total + value.reserved_microusd, 0) });
  const baselineSpend = amounts(spend(f)), baselinePaid = paidOperations(f);
  t.after(() => {
    try {
      assert.deepEqual(amounts(spend(f)), baselineSpend, "actual used/reserved amounts stay unchanged, independently of account row count");
      assert(spend(f).every(value => value.used_microusd === 0 && value.reserved_microusd === 0));
      assert.deepEqual(paidOperations(f), baselinePaid); assert.equal(externalAttempts, 0);
    } finally { f.sqlite.close(); f.media.clear(); }
  });
  return f;
}

// Reuse the accepted real-trigger accounting adapter. Database writes stay real;
// fault cases alter only the returned ACK or insert one explicitly named race.
function observeD1(t, f, { beforeBatch, mapResults = results => results } = {}) {
  const original = f.env.DB.batch, batch = original.bind(f.env.DB), observed = [];
  f.env.DB.batch = async statements => {
    const offset=statements.findIndex(statement=>statement.sql.includes("INSERT INTO event_write_stage")&&statement.sql.includes("private_content"));
    if(offset<0)return batch(statements);
    if (beforeBatch) await beforeBatch();
    const originals = statements.map(statement => statement.execute), metrics = []; observed.push(metrics);
    statements.forEach((statement, index) => { statement.execute = function(kind) {
      const before = f.sqlite.prepare("SELECT total_changes() n").get().n;
      const result = originals[index].call(this, kind), changes = f.sqlite.prepare("SELECT total_changes() n").get().n - before;
      if(index>=offset)metrics.push({ success: result.success, directChanges: result.meta.changes, changes });
      return { ...result, meta: { ...result.meta, changes } };
    }; });
    try { const result=await batch(statements);return [...result.slice(0,offset),...mapResults(result.slice(offset))]; }
    finally { statements.forEach((statement, index) => { statement.execute = originals[index]; }); }
  };
  t.after(() => { f.env.DB.batch = original; }); return observed;
}
async function assertSaved(f, response, request, bytes = EDITED, number = 1) {
  const ack = await body(response); assert.equal(ack.status, "saved"); assert.equal(ack.code, "saved");
  assert.equal(ack.stillCurrent, true); assert.equal(ack.currentRevision, number); assert.equal(ack.imageRevision.revision, number);
  const actualEdits = edits(f), actualHistory = history(f), event = actualEdits.at(-1), full = JSON.parse(event.private_json);
  assert.equal(actualEdits.length, number); assert.equal(actualHistory.length, number + 1);
  assert.equal(ack.appended.length, 1); assert.equal(ack.appended[0].eventId, event.event_id); assert.equal(ack.head, event.sequence);
  assert.equal(ack.currentEditEventId, event.event_id); assert.equal(ack.imageRevision.editEventId, event.event_id);
  assert.equal(ack.appended[0].type, "GeneratedImageEdited"); assert.deepEqual(ack.appended[0].payload, full);
  assert.equal(event.private_owner, OWNER); assert.equal(event.private_project, PROJECT); assert.equal(event.private_document, DOCUMENT); assert.equal(event.private_redacted, null);
  const operation = await revision.generatedImageEditOperationSha256({ ownerId: OWNER, projectId: PROJECT, documentId: DOCUMENT, outputId: OUTPUT }, request);
  assert.equal(ack.operationSha256, operation); assert.equal(full.image_edit_operation_sha256, operation);
  assert.equal(full.previous_revision, number - 1); assert.equal(full.previous_edit_event_id, request.expectedEditEventId);
  assert.equal(f.rawNow(), f.raw); assert.equal(ack.imageRevision.media.sha256, hash(bytes));
  for (const row of actualHistory) {
    assert.equal(row.owner_id, OWNER); assert.equal(row.organization_id, null); assert.equal(row.project_access_id, null);
    assert.equal(row.project_id, PROJECT); assert.equal(row.document_id, DOCUMENT); assert.equal(row.content_sha256, hash(row.content_json));
    const envelope = JSON.parse(row.content_json); assert.equal(envelope.kind, "generated-image"); assert.equal(envelope.schemaVersion, 1);
    assert.equal(envelope.origin.contentSha256, hash(f.raw)); assert.equal(envelope.initialMedia.sha256, hash(ORIGINAL));
    assert.equal(envelope.initialMedia.byteLength, ORIGINAL.length);
    if (row.revision === 0) { assert.equal(envelope.request, null); assert.equal(envelope.imageRevision, null); }
  }
  assert.deepEqual(JSON.parse(actualHistory.at(-1).content_json).imageRevision, ack.imageRevision);
  const key = decodeURIComponent(ack.imageRevision.media.url.slice("/api/media/".length));
  assert.deepEqual(f.media.get(key).bytes, bytes); assert.equal(f.media.get(key).metadata.ownerId, OWNER);
  assert.equal(f.media.get(key).metadata.operationSha256, operation); assert.equal(f.media.get(key).metadata.sha256, hash(bytes));
  assert.deepEqual(f.media.get(f.originalKey).bytes, ORIGINAL); assert.equal(f.media.size, number + 1);
  assert.deepEqual(rows(f, "SELECT event_id FROM event_write_stage WHERE stream_id=?", f.streamId), []);
  return ack;
}

test("generated Image Save commits one immutable PNG, complete private ACK/history and exact read-only Check", async t => {
  const f = await fixture(t), request = await f.input(), before = owned(f), metrics = observeD1(t, f);
  const ack = await assertSaved(f, await f.save(request), request);
  assert.equal(f.puts.length, 1); assert.equal(metrics.length, 1); assert.equal(metrics[0].length, 3);
  assert.equal(metrics[0][0].directChanges, 1); assert(metrics[0][0].changes > 1); assert(metrics[0].every(value => value.success && value.changes > 0));
  assert.deepEqual(owned(f).completion, before.completion);
  const after = owned(f), current = await body(await f.read());
  assert.equal(current.revision, 1); assert.equal(current.editEventId, ack.imageRevision.editEventId); assert.deepEqual(current.media, ack.imageRevision.media);
  const projected = foldEvents(await runtime.readWorkspaceEvents(f.env, f.streamId), Infinity, DOCUMENT, PROJECT).libraryOutputs.find(value => value.id === OUTPUT);
  assert(projected); assert.equal(projected.id, OUTPUT); assert.equal(projected.generationId, GENERATION);
  assert.equal(projected.sourceEventId, f.completion.eventId); assert.equal(projected.contentRef, CONTENT); assert.equal(projected.sequence, f.completion.sequence);
  assert.equal(projected.mediaUrl, ack.imageRevision.media.url); assert.equal(projected.width, WIDTH); assert.equal(projected.height, HEIGHT);
  assert.equal(projected.imageRevision.revision, 1); assert.equal(projected.imageRevision.editEventId, ack.imageRevision.editEventId);
  assert.equal(projected.imageRevision.operationSha256, ack.operationSha256); assert.equal(projected.imageRevision.mediaSha256, hash(EDITED));
  assert.equal(projected.imageRevision.contentSha256, hash(f.raw)); assert.equal(projected.imageRevision.byteLength, EDITED.length);
  assert.equal(projected.focalPoint, null, "the old pixel focal point cannot label the new pixels");
  assert.equal(current.rawJson, f.raw); assert.deepEqual(current.sourceIds, [], "original reference remains intact; a fresh explicit association is required for another edit");
  assert.deepEqual(await body(await f.read(ack.operationSha256)), ack);
  assert.deepEqual(await body(await f.save(request)), ack); assert.deepEqual(owned(f), after); assert.equal(f.puts.length, 1);
  if (process.env.FORMA_GENERATED_IMAGE_SAVE_ARTIFACTS) {
    const directory = process.env.FORMA_GENERATED_IMAGE_SAVE_ARTIFACTS; await mkdir(directory, { recursive: true });
    const savedKey = decodeURIComponent(ack.imageRevision.media.url.slice("/api/media/".length));
    for (const [name, bytes] of [["first-original.png", f.media.get(f.originalKey).bytes], ["first-saved.png", f.media.get(savedKey).bytes], ["first-ack.json", JSON.stringify(ack, null, 2) + "\n"], ["first-history.json", JSON.stringify(history(f), null, 2) + "\n"]])
      await writeFile(join(directory, name), bytes, { flag: "wx" });
  }
});

test('complete history exceeding old raw-array cap still validates, saves, and preserves terminal head through incremental consumption',async t=>{
  const f=await fixture(t),head=f.sqlite.prepare('SELECT MAX(sequence) n FROM events WHERE stream_id=?').get(f.streamId).n;
  const payload=JSON.stringify({text:'x'.repeat(1000)});
  f.sqlite.prepare(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<17000)
    INSERT INTO events(event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,type,payload)
    SELECT 'image-large-'||x,?,?+x,'now','now','user','fixture','fixture','UnusedHistory',? FROM n`).run(f.streamId,head,payload);
  const snapshot=await body(await f.read());assert.equal(snapshot.head,head+17000);
  const input=await f.input();await assertSaved(f,await f.save(input),input);
  assert.equal((await body(await f.read())).head,head+17001);
});

test("same exact PNG is unchanged and does not allocate an event, history row or object", async t => {
  const f = await fixture(t), request = await f.input(ORIGINAL), before = owned(f);
  assert.deepEqual(await body(await f.save(request, ORIGINAL)), { status: "unchanged", code: "unchanged" });
  assert.deepEqual(owned(f), before); assert.equal(f.puts.length, 0);
});

test("stale source tuples, malformed multipart and unowned result bytes refuse before a write", async t => {
  for (const [name, mutate, bytes, options] of [
    ["stale generation", value => ({ ...value, generationId: "stale-generation" })],
    ["stale content", value => ({ ...value, expectedContentSha256: "f".repeat(64) })],
    ["stale media", value => ({ ...value, sourceMediaSha256: "e".repeat(64) })],
    ["foreign source id", value => ({ ...value, sourceId: "unowned:image" })],
    ["result byte mismatch", value => value, NEXT],
    ["extra multipart entry", value => value, undefined, { extra: true }],
    ["foreign origin", value => value, undefined, { headers: { origin: "https://foreign.test" } }],
  ]) await t.test(name, async s => {
    const f = await fixture(s), request = mutate(await f.input()), before = owned(f), response = await f.save(request, bytes, options);
    assert(response.status >= 400); assert.equal((await response.json()).status, "refused"); assert.deepEqual(owned(f), before); assert.equal(f.puts.length, 0);
  });
});

test("withdrawn rights, completion privacy and principal authority refuse the retained source", async t => {
  for (const [name, revoke] of [
    ["rights", f => f.seed("RightsAsserted", { reference_id: "image-save-receipt-initial", rights_class: "unavailable" })],
    ["removed reference", f => f.seed("BlockRemoved", { block_id: f.blockId, document_id: DOCUMENT, project_id: PROJECT })],
    ["private completion withdrawn", f => f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at=? WHERE private_event_id=?").run(new Date().toISOString(), f.completion.eventId)],
    ["private raw withdrawn", f => f.sqlite.prepare("UPDATE private_content SET redacted_at=? WHERE content_id=?").run(new Date().toISOString(), CONTENT)],
    ["viewer downgrade", f => f.sqlite.prepare("UPDATE users SET role='viewer',updated_at=? WHERE user_id=?").run("2026-09-10T12:34:56.000Z", OWNER)],
    ["foreign object owner", f => { f.media.get(f.originalKey).metadata.ownerId = "foreign-owner"; }],
  ]) await t.test(name, async s => {
    const f = await fixture(s), request = await f.input(); await revoke(f); const before = owned(f);
    const response = await f.save(request); assert(response.status >= 400); assert.equal((await response.json()).status, "refused");
    assert.deepEqual(owned(f), before); assert.equal(f.puts.length, 0);
  });
});

test("foreign principal and manual GeneratedImageEdited ingress cannot acquire the owner revision", async t => {
  const f = await fixture(t), now = new Date().toISOString();
  f.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
    .run("foreign-image-owner", "foreign-image@example.test", "Foreign fixture", "creator", "pilot-2026-08-10", now, now, now);
  const before = owned(f), denied = await f.read(undefined, { "oai-authenticated-user-id": "foreign-image-owner", "oai-authenticated-user-email": "foreign-image@example.test" });
  assert(denied.status >= 400); assert.deepEqual(owned(f), before);
  const request = await f.input();
  const response = await handleEvents(new Request("https://forma.test/api/events", { method: "POST", headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ action: "append", expectedSequence: f.events.at(-1).sequence, event: { type: "GeneratedImageEdited", payload: { output_id: OUTPUT, object_id: OUTPUT, document_id: DOCUMENT, project_id: PROJECT, revision: 1, source_surface: "generated-image-editor", media_url: f.originalUrl, source_content_hash: hash(ORIGINAL) } } }) }), f.env);
  const result = await body(response); assert(result.rejected.some(value => value.type === "GeneratedImageEdited" && value.reason === "event_not_permitted_for_user"));
  assert.equal(result.appended.filter(value => value.type === "GeneratedImageEdited").length, 0);
  assert.deepEqual(owned(f), before, "only the ordinary ValidationFailed audit may be appended; no image state changes");
  assert.equal(request.expectedRevision, 0);
});

test("uncertain committed ACK retains exact object and resolves through Check without another write", async t => {
  for (const [name, mapResults] of [
    ["missing result", results => { const result = results.slice(); delete result[1]; return result; }],
    ["zero changes", results => results.map((value, index) => index === 1 ? { ...value, meta: { changes: 0 } } : value)],
    ["missing metadata", results => results.map((value, index) => index === 2 ? { success: value.success } : value)],
    ["lost batch response", () => { throw new Error("declared post-commit acknowledgement loss"); }],
  ]) await t.test(name, async s => {
    const f = await fixture(s), request = await f.input(); observeD1(s, f, { mapResults });
    assert.deepEqual(await body(await f.save(request)), { status: "unconfirmed", code: "unconfirmed" });
    assert.equal(edits(f).length, 1); assert.equal(history(f).length, 2); assert.equal(f.puts.length, 1);
    const operation = await revision.generatedImageEditOperationSha256({ ownerId: OWNER, projectId: PROJECT, documentId: DOCUMENT, outputId: OUTPUT }, request);
    const before = owned(f); await assertSaved(f, await f.read(operation), request); assert.deepEqual(owned(f), before); assert.equal(f.puts.length, 1);
  });
});

test("a private witness withdrawal at the real batch boundary cannot publish an admitted immutable upload", async t => {
  const f = await fixture(t), request = await f.input();
  const metrics = observeD1(t, f, { beforeBatch: () => f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at=? WHERE private_event_id=?").run(new Date().toISOString(), f.completion.eventId) });
  assert.deepEqual(await body(await f.save(request)), { status: "unconfirmed", code: "unconfirmed" });
  assert.equal(f.puts.length, 1); assert.equal(f.media.size, 2, "uncertain admitted object is retained, never rolled back or reused");
  assert.equal(edits(f).length, 0); assert.equal(history(f).length, 0); assert(metrics[0].every(value => value.changes === 0));
  assert.deepEqual(f.media.get(f.originalKey).bytes, ORIGINAL); assert.equal(f.rawNow(), f.raw);
});

test("both Check and exact PATCH replay revalidate missing or altered committed PNG bytes", async t => {
  for (const fault of ["missing", "altered bytes", "foreign owner"]) await t.test(fault, async s => {
    const f = await fixture(s), request = await f.input(); observeD1(s, f);
    const ack = await assertSaved(f, await f.save(request), request), key = decodeURIComponent(ack.imageRevision.media.url.slice("/api/media/".length));
    if (fault === "missing") f.media.delete(key);
    else if (fault === "altered bytes") f.media.get(key).bytes = NEXT.slice();
    else f.media.get(key).metadata.ownerId = "foreign-owner";
    const before = owned(f);
    for (const response of [await f.read(ack.operationSha256), await f.save(request)]) {
      assert(response.status >= 400); assert.equal((await response.json()).status, "refused");
    }
    assert.deepEqual(owned(f), before); assert.equal(f.puts.length, 1);
  });
});

test("historical operation Check identifies old custody and never rebases a repeated Save", async t => {
  const f = await fixture(t), first = await f.input(); observeD1(t, f);
  const ack1 = await assertSaved(f, await f.save(first), first);
  const previousBlock = await f.associate(ack1.imageRevision.media, "revision-1");
  const second = await f.input(NEXT), ack2 = await assertSaved(f, await f.save(second, NEXT), second, NEXT, 2), before = owned(f);
  const historical = await body(await f.read(ack1.operationSha256));
  assert.equal(historical.stillCurrent, false); assert.equal(historical.imageRevision.revision, 1); assert.equal(historical.currentRevision, 2);
  assert.equal(historical.currentEditEventId, ack2.imageRevision.editEventId); assert.equal(historical.appended[0].eventId, ack1.imageRevision.editEventId);
  assert.deepEqual(await body(await f.save(first)), historical); assert.deepEqual(owned(f), before); assert.equal(f.puts.length, 2);
  // Expose the historical-media admission regression: the selected old PNG is
  // neither initial nor current, and no active reference contributes its URL.
  await f.seed("BlockRemoved", { block_id: previousBlock, document_id: DOCUMENT, project_id: PROJECT });
  const snapshot = await body(await f.read());
  assert(snapshot.sources.every(source => source.mediaUrl !== ack1.imageRevision.media.url));
  f.sqlite.prepare("INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,visibility,source_event_id,actor_user_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .run("historical-image-project-access", "media", ack1.imageRevision.media.url, "historical-image-organization", "different-governed-project", OWNER,
      "collaborative_output", ack1.imageRevision.editEventId, OWNER, new Date().toISOString());
  const scoped = owned(f);
  for (const response of [await f.read(ack1.operationSha256), await f.save(first)]) {
    assert(response.status >= 400); assert.equal((await response.json()).status, "refused");
  }
  assert.deepEqual(owned(f), scoped); assert.equal(f.puts.length, 2);
});
