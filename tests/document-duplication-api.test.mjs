import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { compileSqliteExpressionDepth, enforceD1ExpressionDepth } from "./helpers/d1-expression-depth.mjs";

const root = new URL("../", import.meta.url).href;
const resolution = registerHooks({ resolve(specifier, context, nextResolve) {
  const local = typeof context.parentURL === "string" && context.parentURL.startsWith(root) && !context.parentURL.includes("/node_modules/");
  return nextResolve(local && specifier.startsWith(".") && !/\.[a-z0-9]+$/iu.test(specifier) ? specifier + ".ts" : specifier, context);
} });
const [{ default: worker }, runtime, model, sourceDocuments, ownership, copyProof, requirements, outputPlan, consent, contextAuthority, derivedReferences] = await Promise.all([
  import("../worker/index.ts"), import("../worker/runtime.ts"),
  import("../src/model/events.ts"), import("../src/model/source-documents.ts"), import("../src/model/media-ownership.ts"),
  import("../worker/authoring-event-proof.ts"), import("../src/model/output-requirements.ts"), import("../src/model/output-plan.ts"),
  import("../worker/consequential-consent.ts"), import("../worker/context-authoring-authority.ts"),
  import("../worker/derived-reference-guard.ts"),
]).finally(() => resolution.deregister());

const json = (body, headers = {}) => ({ method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) });
const scope = { projectId: "project-atmosphere", documentId: "duplicate-source" };
const ownerIdentity = { "oai-authenticated-user-id": "assistant-owner", "oai-authenticated-user-email": "assistant-owner@example.test" };
const editorIdentity = { "oai-authenticated-user-id": "assistant-viewer", "oai-authenticated-user-email": "assistant-viewer@example.test" };

function database() {
  const sqlite = new DatabaseSync(":memory:");
  const controls = { queries:0,queryLimit:0,maxBatch:0,maxBinds:0,maxSqlBytes:0,maxValueBytes:0,failEventAt:0,skipEventAt:0,failReceipt: false, afterClaim: null, beforeWrite: null, beforeReceipt: null, loseBatchResponse: false, lastDatabaseError: "" };
  class Statement {
    constructor(sql, values = []) { this.sql = sql; this.values = values; }
    bind(...values) {
      assert.ok(values.length <= 100, `D1 bind limit: ${values.length}`); controls.maxBinds=Math.max(controls.maxBinds,values.length);
      for(const value of values)if(typeof value==="string"){const bytes=new TextEncoder().encode(value).length;assert.ok(bytes<=2_000_000,"D1 value limit");controls.maxValueBytes=Math.max(controls.maxValueBytes,bytes);}
      return new Statement(this.sql, values);
    }
    execute(kind) {
      controls.queries++;
      if(controls.queryLimit&&controls.queries>controls.queryLimit)throw new Error("injected_d1_request_query_limit");
      const sqlBytes=new TextEncoder().encode(this.sql).length;assert.ok(sqlBytes<=100_000,"D1 SQL text limit");controls.maxSqlBytes=Math.max(controls.maxSqlBytes,sqlBytes);
      if (controls.beforeWrite && /\bINSERT INTO event_write_stage\(/iu.test(this.sql)) {
        const before = controls.beforeWrite; controls.beforeWrite = null; before(this);
      }
      if (/^\s*INSERT INTO authoring_commits/iu.test(this.sql)) {
        if (controls.beforeReceipt) { const before = controls.beforeReceipt; controls.beforeReceipt = null; before(this); }
        if (controls.failReceipt) { controls.failReceipt = false; throw new Error("injected_copy_receipt_failure"); }
      }
      const statement = sqlite.prepare(this.sql);
      if (kind === "first") return statement.get(...this.values) ?? null;
      if (kind === "all") return { results: statement.all(...this.values), success: true, meta: { changes: 0 } };
      return { results: [], success: true, meta: { changes: Number(statement.run(...this.values).changes ?? 0) } };
    }
    async first() { return this.execute("first"); }
    async all() { return this.execute("all"); }
    async run() {
      const result = this.execute("run");
      if (controls.afterClaim && /^\s*UPDATE private_content SET content=json_set\(content,'\$\.state','applying'/iu.test(this.sql)
        && result.meta.changes === 1) {
        const after = controls.afterClaim; controls.afterClaim = null; await after();
      }
      return result;
    }
  }
  return { sqlite, controls, DB: {
    prepare(sql) { return new Statement(sql); },
    async batch(statements) {
      controls.maxBatch=Math.max(controls.maxBatch,statements.length);
      sqlite.exec("BEGIN");
      let results;
      try { results = statements.map((item) => item.execute(/^\s*(?:SELECT|WITH)/iu.test(item.sql) ? "all" : "run")); sqlite.exec("COMMIT"); }
      catch (error) { controls.lastDatabaseError=error instanceof Error?error.message:String(error);sqlite.exec("ROLLBACK"); throw error; }
      if (controls.loseBatchResponse && statements.some((item) => /^\s*INSERT INTO authoring_commits/iu.test(item.sql))) {
        controls.loseBatchResponse = false; throw new Error("injected_lost_batch_response");
      }
      return results;
    },
  } };
}

async function fixture({ mode = "personal", count = 3, rich = false, relations = 0, folder = true } = {}) {
  const db = database(), background = [], media = new Map();
  const env = { DB: db.DB, ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
    MEDIA: { async head(key) { return media.get(key) ?? null; }, async get(key) { return media.get(key) ?? null; } } };
  const execution = { waitUntil(promise) { background.push(promise); } };
  const request = (path, init) => worker.fetch(new Request("http://localhost" + path, init), env, execution);
  const owner = mode === "personal" ? {} : ownerIdentity;
  assert.equal((await request("/api/session", { headers: owner })).status, 200);
  db.sqlite.prepare("UPDATE users SET consent_version=?").run("pilot-2026-08-10");
  assert.equal((await request("/api/events?after=0&limit=2000&content=0", { headers: owner })).status, 200);
  db.sqlite.function("copy_test_event_gate",()=>{
    if(db.controls.failEventAt&&--db.controls.failEventAt===0)throw new Error("injected_copy_event_failure");
    if(db.controls.skipEventAt&&--db.controls.skipEventAt===0)return 0;
    return 1;
  });
  db.sqlite.exec("CREATE TRIGGER copy_test_before_event BEFORE INSERT ON event_write_stage WHEN NEW.client_id='web:context-approval' BEGIN SELECT CASE WHEN copy_test_event_gate()=0 THEN RAISE(IGNORE) END; END");
  const ownerId = mode === "personal" ? "dev-local-creative" : "assistant-owner", stream = "creative:" + ownerId;
  const seed = async (entries) => {
    const head = Number(db.sqlite.prepare("SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?").get(stream).head);
    await env.DB.batch(entries.map(([type, payload], index) => runtime.insertEvent(env,
      runtime.makeEvent(stream, head + index + 1, "user:" + ownerId, "copy-fixture", crypto.randomUUID(), type, payload))));
  };
  const entries = [["DocumentCreated", { project_id: scope.projectId, document_id: scope.documentId, title: "Original exact source", handle: "original-exact-source" }]];
  if (folder) entries.push(
    ["CollectionCreated", { project_id: scope.projectId, collection_id: "duplicate-folder", handle: "Café / 企画", position: "a0" }],
    ["CollectionItemAdded", { project_id: scope.projectId, collection_id: "duplicate-folder", item_ref: { document_id: scope.documentId }, position: "a1" }],
  );
  for (let i = 0; i < count; i++) {
    const action = rich && i % 5 === 0;
    entries.push(["BlockCreated", { project_id: scope.projectId, document_id: scope.documentId, block_id: "copy-source-" + i,
      type: action ? "action" : "direction", handle: "decision/" + i, position: "a" + String(i).padStart(3, "0"),
      properties: { text: "PRIVATE_SOURCE_" + i, label: "Decision " + i, weight: .8, intent: i === 1 ? "prohibit" : "include",
        ...(rich && [1, 2].includes(i) ? { context_set_id: "copy-group", context_set_root_id: "copy-source-1",
          combined_context_memberships: [{ contextSetId: "copy-group", context_set_id: "copy-group", memberOrder: i - 1,
            name: "Exact group", role: "message", target: "Two decisions", application: "ordered", relativity: .8, sourceCanvasId: "" }] } : {}),
        authority: "authored", ...(action ? { block_references: [{ block_id: "copy-source-" + ((i + 1) % count), handle: "decision/" + ((i + 1) % count), role: "target" }] } : {}) } }]);
  }
  for (let i = 0; i < relations; i++) entries.push(["BlockRelationAdded", {
    project_id: scope.projectId, document_id: scope.documentId, relation_id: "copy-source-relation-" + i,
    from_block_id: "copy-source-" + (Math.floor(i / (count - 1)) % count),
    to_block_id: "copy-source-" + ((Math.floor(i / (count - 1)) + i % (count - 1) + 1) % count),
    kind: rich && i === 0 ? "action_participant" : rich && i === 99 ? "context_contains" : "visual_evidence",
    properties: { weight: .6, evidence_label: "Private relationship " + i,
      ...(rich && i === 0 ? { participant_role: "target", handle: "decision/1" } : {}),
      ...(rich && i === 99 ? { context_set_id: "copy-group", member_order: 0 } : {}) },
  }]);
  if (rich) for (let i = 0; i < count; i++) entries.push(["BlockLocked", { project_id: scope.projectId, document_id: scope.documentId, block_id: "copy-source-" + i }]);
  entries.push(["DocumentRenderCompleted", { project_id: scope.projectId, document_id: scope.documentId,
    artifact_id: "source-output", artifact_kind: "slides", title: "Do not duplicate this output", item_count: 1, items: [{ id: "source-slide", title: "Original", body: "Output only" }] }]);
  await seed(entries);
  let headers = owner, organizationId = "", projectAccessId = "";
  if (mode !== "personal") {
    const organization = await request("/api/workspaces", json({ name: "Copy organization" }, owner));
    assert.equal(organization.status, 201, JSON.stringify(await organization.clone().json()));
    organizationId = (await organization.json()).organizationId;
    const project = await request(`/api/workspaces/${organizationId}/projects`, json({ projectId: scope.projectId }, owner));
    assert.equal(project.status, 201, JSON.stringify(await project.clone().json())); projectAccessId = (await project.json()).projectAccessId;
    const open = async (identity) => {
      const selected = await request(`/api/workspaces/${organizationId}/projects/${projectAccessId}/context`, { method: "POST", headers: identity });
      assert.equal(selected.status, 200);
      return { ...identity, cookie: selected.headers.get("set-cookie").split(";")[0] };
    };
    if (mode === "editor") {
      assert.equal((await request("/api/session", { headers: editorIdentity })).status, 200);
      db.sqlite.prepare("UPDATE users SET consent_version=?,role='viewer' WHERE user_id='assistant-viewer'").run("pilot-2026-08-10");
      const invited = await request(`/api/workspaces/${organizationId}/members`, json({ email: "assistant-viewer@example.test", role: "member" }, owner));
      assert.equal(invited.status, 201); const invitation = await invited.json();
      assert.equal((await request(`/api/workspaces/${organizationId}/invitations/${invitation.invitationId}/accept`,
        json({ token: new URL(invitation.invitationUrl).searchParams.get("token") }, editorIdentity))).status, 200);
      assert.equal((await request(`/api/workspaces/${organizationId}/projects/${projectAccessId}/members`, json({ userId: "assistant-viewer", role: "editor" }, owner))).status, 201);
      headers = await open(editorIdentity);
    } else if (mode === "shared") headers = await open(owner);
  }
  const copy = (body, identity = headers) => request("/api/documents/duplicate", json({ ...scope, ...body }, identity));
  const depth=enforceD1ExpressionDepth({sqlite:db.sqlite,env});
  return { ...db, env, request, copy, seed, media, headers, ownerId, stream, organizationId, projectAccessId,
    async close() { try{while (background.length) await Promise.all(background.splice(0));depth.assertVerified();}finally{depth.restore();db.sqlite.close();} } };
}
const operation = (changes = {}) => ({ action: "preview", operationId: crypto.randomUUID(), title: "Independent copy", ...changes });
const confirm = (preview, action = "apply") => ({ action, previewId: preview.previewId, approvalHash: preview.approvalHash });
const inspect = async (response, status = 200) => { const body = await response.json(); assert.equal(response.status, status, JSON.stringify(body)); return body; };
const preview = async (state, request = operation()) => (await inspect(await state.copy(request))).preview;
function counts(state) {
  return {
    events: state.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE stream_id=?").get(state.stream).n,
    privateEvents: state.sqlite.prepare("SELECT COUNT(*) AS n FROM event_private_payloads WHERE owner_id=?").get(state.ownerId).n,
    receipts: state.sqlite.prepare("SELECT COUNT(*) AS n FROM authoring_commits").get().n,
    projectEvents: state.sqlite.prepare("SELECT COUNT(*) AS n FROM project_event_scopes WHERE owner_user_id=?").get(state.ownerId).n,
    copyResources: state.sqlite.prepare("SELECT COUNT(*) AS n FROM project_resource_scopes WHERE resource_kind!='content' AND source_event_id IN(SELECT event_id FROM events WHERE client_id='web:context-approval')").get().n,
  };
}
const projection = async (state, documentId = scope.documentId) => model.foldEvents(await runtime.readEvents(state.env, state.stream), Infinity, documentId, scope.projectId);

test("server-owned copy commits all 100 rich decisions and exactly 512 events in every supported custody mode", async () => {
  for (const mode of ["personal", "migrated", "shared", "editor"]) {
    const state = await fixture({ mode, count: 100, rich: true, relations: 290 });
    try {
      const before = counts(state), original = await projection(state), proposed = await preview(state);
      assert.equal(proposed.blockCount, 100); assert.equal(proposed.events.length, 512);
      assert.equal(proposed.duplication.collectionId, "duplicate-folder");
      assert.deepEqual(proposed.duplication.collectionPath, ["Café / 企画"]);
      assert.deepEqual(counts(state), before, "free preview adds no canonical effects");
      const applied = await inspect(await state.copy(confirm(proposed)));
      const copied = await projection(state, applied.documentId);
      assert.equal(copied.blocks.length, 100); assert.equal(copied.blockRelations.length, 290); assert.equal(copied.artifacts.length, 0);
      assert.ok(copied.blocks.every((block) => block.locked));
      assert.equal(copied.blocks[1].properties.intent, "prohibit");
      assert.equal(copied.blockRelations.filter((relation) => relation.kind === "action_participant").length, 1);
      assert.equal(copied.blockRelations.filter((relation) => relation.kind === "context_contains").length, 1);
      const copiedGroup = copied.blocks[1].properties.context_set_id;
      assert.notEqual(copiedGroup, "copy-group");
      assert.equal(copied.blocks[2].properties.combined_context_memberships[0].contextSetId, copiedGroup);
      assert.equal(copied.blocks[2].properties.context_set_root_id, copied.blocks[1].id);
      assert.equal(copied.blockRelations.find((relation) => relation.kind === "context_contains").properties.context_set_id, copiedGroup);
      assert.equal(copied.membership[applied.documentId].collectionId, "duplicate-folder");
      const originals = new Set(original.blocks.map((block) => block.id));
      assert.ok(copied.blocks.every((block) => !originals.has(block.id)));
      assert.ok(copied.blocks.filter((block) => block.type === "action").every((block) =>
        block.properties.block_references.every((reference) => copied.blocks.some((item) => item.id === reference.block_id))));
      assert.equal(counts(state).events - before.events, 512); assert.equal(counts(state).receipts, 1);
      assert.equal(counts(state).privateEvents - before.privateEvents, 512);
      const source = await projection(state);
      assert.deepEqual(source.blocks, original.blocks); assert.deepEqual(source.blockRelations, original.blockRelations);
      assert.equal(source.artifacts.length, 1);
      const raw = state.sqlite.prepare("SELECT payload FROM events WHERE stream_id=? AND client_id='web:context-approval'").all(state.stream);
      assert.ok(raw.every((item) => !item.payload.includes("PRIVATE_SOURCE_")));
      if (mode !== "personal") assert.equal(counts(state).projectEvents - before.projectEvents, 512);
    } finally { await state.close(); }
  }
});

test("101 decisions and a 513-event copy are rejected without changing the generic 50-event shared batch ceiling", async () => {
  for (const options of [{ count: 101 }, { count: 100, rich: true, relations: 291 }]) {
    const state = await fixture(options);
    try { const before = counts(state); const failed = await inspect(await state.copy(operation()), 409);
      assert.equal(failed.error, "document_duplicate_too_large"); assert.deepEqual(counts(state), before);
    } finally { await state.close(); }
  }
  const shared = await fixture({ mode: "shared" });
  try {
    const before = counts(shared);
    const result = await inspect(await shared.request("/api/events", json({ action: "batch",
      events: Array.from({ length: 51 }, (_, i) => ({ type: "DocumentCreated", payload: { project_id: scope.projectId, document_id: "generic-" + i, title: "Generic " + i } })),
    }, shared.headers)), 400);
    assert.equal(result.maximum, 50); assert.deepEqual(counts(shared), before);
  } finally { await shared.close(); }
});

test("mid-commit failures and failed receipt verification roll back events, private payloads and shared resources", async () => {
  for (const mode of ["personal", "migrated", "shared", "editor"]) for (const fault of ["event", "receipt", "source-erasure", "preview-retention"]) {
    const state = await fixture({ mode, count: 100, rich: true, relations: 290 });
    try {
      const proposed = await preview(state), before = counts(state);
      if (fault === "event") state.controls.failEventAt = 257;
      else if (fault === "receipt") state.controls.failReceipt = true;
      else if (fault === "source-erasure") state.controls.beforeReceipt = () => state.sqlite.prepare("UPDATE event_private_payloads SET private_json='',redacted_at=? WHERE private_event_id=(SELECT event_id FROM events WHERE stream_id=? AND type='BlockCreated' AND json_extract(payload,'$.block_id')='copy-source-0')").run(new Date().toISOString(), state.stream);
      else state.controls.beforeReceipt = () => state.sqlite.prepare("UPDATE private_content SET expires_at='2000-01-01T00:00:00.000Z' WHERE content_id=?").run(proposed.previewId);
      const failed = await inspect(await state.copy(confirm(proposed)), 409);
      assert.equal(failed.status, "not-applied"); assert.deepEqual(counts(state), before, mode + "/" + fault);
      const recovered = await inspect(await state.copy(confirm(proposed, "retrieve")));
      assert.equal(recovered.status, "not-applied");
      await inspect(await state.copy(confirm(proposed)));
      assert.equal(counts(state).events - before.events, 512, "retry after a proved rollback commits the complete copy");
      assert.equal(counts(state).receipts, 1);
    } finally { await state.close(); }
  }
});

test("concurrent previews and confirmations plus lost responses reuse one operation and one complete copy", async () => {
  const state = await fixture({ mode: "shared", count: 100, rich: true, relations: 290 });
  try {
    const intent = operation(), before = counts(state);
    const [left, right] = await Promise.all([state.copy(intent).then(inspect), state.copy(intent).then(inspect)]);
    assert.equal(left.preview.previewId, right.preview.previewId); assert.equal(left.preview.approvalHash, right.preview.approvalHash);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM private_content WHERE kind='authoring-preview'").get().n, 1);
    state.controls.loseBatchResponse = true;
    const confirmations = await Promise.all([state.copy(confirm(left.preview)), state.copy(confirm(right.preview))]);
    for (const result of confirmations) assert.ok([200, 202].includes(result.status), JSON.stringify(await result.clone().json()));
    assert.equal(counts(state).events - before.events, 512); assert.equal(counts(state).receipts, 1);
    for (const body of [confirm(left.preview, "retrieve"), { action: "resume" }, intent, confirm(left.preview)]) {
      const recovered = await inspect(await state.copy(body)); assert.equal(recovered.status, "applied"); assert.equal(recovered.documentId, left.preview.events[0].payload.document_id);
    }
    assert.equal(counts(state).events - before.events, 512);
    state.sqlite.prepare("UPDATE private_content SET content='',redacted_at=? WHERE content_id=?").run(new Date().toISOString(), left.preview.previewId);
    assert.equal((await inspect(await state.copy(intent))).status, "applied", "receipt survives private preview erasure");
    assert.equal((await inspect(await state.copy({ ...intent, title: "A changed title" }), 409)).error, "document_duplicate_intent_changed");
    const erased = await inspect(await state.copy({ action: "resume" }));
    assert.equal(erased.status, "applied"); assert.equal(erased.preview, undefined);
    assert.equal(erased.approvalHash, left.preview.approvalHash, "fresh clients can acknowledge an exact recovered receipt");
    assert.equal((await inspect(await state.copy(confirm(erased, "dismiss")))).status, "dismissed");
    assert.equal((await inspect(await state.copy({ action: "resume" }))).status, "none");
    assert.equal((await inspect(await state.copy(confirm(left.preview, "retrieve")))).status, "applied");
    assert.equal(counts(state).events - before.events, 512);
  } finally { await state.close(); }
});

test("titles and destination folders bind a stable intent; no request can supply events or widen its approval", async () => {
  const state = await fixture();
  try {
    const intent = operation({ title: "  Cafe\u0301 企画 🧭  ", collectionId: null });
    const proposed = await preview(state, intent), before = counts(state);
    assert.equal(proposed.duplication.title, "Café 企画 🧭"); assert.equal(proposed.duplication.collectionId, null);
    assert.ok(proposed.events.every((event) => event.type !== "CollectionItemAdded"));
    for (const changed of [{ ...intent, title: "Different" }, { ...intent, collectionId: "duplicate-folder" }]) {
      assert.equal((await inspect(await state.copy(changed), 409)).error, "document_duplicate_intent_changed");
    }
    assert.equal((await state.copy({ ...confirm(proposed), title: "Changed" })).status, 400);
    assert.equal((await state.copy({ ...intent, events: [] })).status, 400);
    assert.equal((await state.copy(operation({ title: "🧭".repeat(81) }))).status, 400);
    assert.equal((await state.copy(operation({ title: "Invisible\u0000title" }))).status, 400);
    await preview(state, operation({ title: "🧭".repeat(80), collectionId: null }));
    assert.deepEqual(counts(state), before);
    await state.seed([["CollectionRenamed", { project_id: scope.projectId, collection_id: "duplicate-folder", new_handle: "Moved after review" }]]);
    const stale = await inspect(await state.copy(confirm(proposed, "retrieve"))); assert.equal(stale.stale, true);
    const afterChange = counts(state); assert.equal((await state.copy(confirm(proposed))).status, 409); assert.deepEqual(counts(state), afterChange);
  } finally { await state.close(); }
});

test("recovery and dismissal remain free with read permission but no new authoring, model, or budget eligibility", async () => {
  const state = await fixture({ mode: "editor" });
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new Error("copy_must_not_call_a_provider"); };
    const intent = operation(), proposed = await preview(state, intent), before = counts(state);
    state.sqlite.prepare("UPDATE project_memberships SET role='viewer' WHERE user_id='assistant-viewer'").run();
    state.sqlite.prepare("UPDATE capability_grants SET status='revoked',revoked_at=? WHERE user_id='assistant-viewer' AND capability!='project.read'").run(new Date().toISOString());
    state.env.FORMA_USER_COST_LIMIT_USD = "0"; state.env.FORMA_USER_TOKEN_LIMIT = "0";
    for (const body of [confirm(proposed, "retrieve"), { action: "resume" }, intent]) {
      const retained = await inspect(await state.copy(body)); assert.equal(retained.preview.previewId, proposed.previewId); assert.equal(retained.stale, true);
    }
    assert.equal((await state.copy(operation())).status, 403);
    assert.equal((await state.copy(confirm(proposed))).status, 403);
    assert.equal((await inspect(await state.copy(confirm(proposed, "dismiss")))).status, "dismissed");
    assert.equal((await inspect(await state.copy({ action: "resume" }))).status, "none");
    assert.deepEqual(counts(state), before);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM cost_budget_reservations").get().n, 0);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM document_jobs").get().n, 0);
  } finally { globalThis.fetch = originalFetch; await state.close(); }
});

test("current actor, selected session DB expiry, tenant custody, and retention policy gate the transaction", async () => {
  for (const fault of ["actor", "author-grant", "session", "resource", "preview-custody", "retention-policy"]) {
    const state = await fixture({ mode: "editor" });
    try {
      if (fault === "author-grant") {
        const now = new Date().toISOString();
        state.sqlite.prepare("INSERT INTO capability_grants(grant_id,user_id,capability,scope_type,organization_id,project_access_id,project_id,status,granted_by_user_id,created_at,updated_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
          .run(crypto.randomUUID(), "assistant-viewer", "project.author", "project", state.organizationId, state.projectAccessId,
            scope.projectId, "active", state.ownerId, now, now, new Date(Date.now() + 86_400_000).toISOString());
      }
      const proposed = await preview(state), before = counts(state);
      state.controls.beforeReceipt = () => {
        if (fault === "actor") state.sqlite.prepare("UPDATE users SET updated_at='changed-at-commit' WHERE user_id='assistant-viewer'").run();
        else if (fault === "author-grant") state.sqlite.prepare("UPDATE capability_grants SET expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id='assistant-viewer' AND capability='project.author'").run();
        else if (fault === "session") state.sqlite.prepare("UPDATE project_context_sessions SET expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE principal_user_id='assistant-viewer'").run();
        else if (fault === "resource") state.sqlite.prepare("UPDATE project_resource_scopes SET project_id='foreign' WHERE project_access_id=? AND resource_kind='block' AND resource_id='copy-source-0'").run(state.projectAccessId);
        else if (fault === "preview-custody") state.sqlite.prepare("UPDATE private_content_retention_scopes SET project_access_id='foreign' WHERE content_id=?").run(proposed.previewId);
        else state.sqlite.prepare("UPDATE private_content_retention_scopes SET policy_version=policy_version+1 WHERE content_id=?").run(proposed.previewId);
      };
      assert.equal((await state.copy(confirm(proposed))).status, 409, fault); assert.deepEqual(counts(state), before, fault);
    } finally { await state.close(); }
  }
});

test("external action participants, incomplete groups, unsupported context routes, and foreign folders never truncate a copy", async () => {
  for (const fault of ["participant", "group", "route", "folder", "relation"]) {
    const state = await fixture();
    try {
      await state.seed([["BlockCreated", { project_id: scope.projectId, scope: "library", block_id: "external", type: "direction", properties: { text: "External context", context_set_id: "external-group" } }]]);
      if (fault === "participant") await state.seed([
        ["BlockPropertyEdited", { project_id: scope.projectId, document_id: scope.documentId, block_id: "copy-source-0", property_path: "type", new_value: "action" }],
        ["BlockPropertyEdited", { project_id: scope.projectId, document_id: scope.documentId, block_id: "copy-source-0", property_path: "block_references", new_value: [{ block_id: "external", handle: "direction/external", role: "target" }] }],
      ]);
      else if (fault === "group" || fault === "route") await state.seed([["BlockPropertyEdited", {
        project_id: scope.projectId, document_id: scope.documentId, block_id: "copy-source-0",
        property_path: fault === "group" ? "context_set_id" : "context_set_root_id", new_value: fault === "group" ? "external-group" : "external",
      }]]);
      else if (fault === "relation") await state.seed([["BlockRelationAdded", {
        project_id: scope.projectId, document_id: scope.documentId, relation_id: "external-relation",
        from_block_id: "copy-source-0", to_block_id: "external", kind: "visual_evidence", properties: {},
      }]]);
      const before = counts(state); const failed = await inspect(await state.copy(operation(fault === "folder" ? { collectionId: "foreign" } : {})), 409);
      assert.match(failed.error, /^document_duplicate_/u); assert.deepEqual(counts(state), before);
    } finally { await state.close(); }
  }
});

test("copy preserves immutable source evidence and rights, and changed or expired rights cannot be approved", async () => {
  for (const mode of ["personal", "migrated", "shared"]) {
    const state = await fixture({ mode });
    try {
      const contentHash = "4".repeat(64), mimeType = "text/plain";
      const extraction = await sourceDocuments.extractSourceDocument(new File(["Approved customer words, unchanged."], "source.txt", { type: mimeType }));
      const evidenceHash = await sourceDocuments.sourceDocumentEvidenceDigest(sourceDocuments.sourceDocumentEvidence(extraction, contentHash, mimeType));
      const key = ownership.ownerMediaNamespace(state.ownerId) + "/source.txt", mediaUrl = "/api/media/" + encodeURIComponent(key);
      state.media.set(key, { customMetadata: { ownerId: state.ownerId, sha256: contentHash, mimeType, sourceEvidenceSha256: evidenceHash } });
      const properties = { text: extraction.text, reference_id: "copy-source-reference", media_url: mediaUrl,
        source_evidence_hash: evidenceHash, source_content_hash: contentHash, source_mime_type: mimeType,
        source_kind: extraction.sourceKind, extraction_status: extraction.status,
        source_citations: extraction.segments.map((segment) => ({ anchor: segment.anchor, excerpt: segment.text })),
        source_segment_count: extraction.segments.length, source_excerpt_truncated: extraction.truncated, rights_class: "owned_or_licensed" };
      await state.seed([
        ["ReferenceIngested", { project_id: scope.projectId, reference_id: "copy-source-reference", source_ref: mediaUrl, content_hash: contentHash, rights_class: "owned_or_licensed" }],
        ["BlockCreated", { project_id: scope.projectId, document_id: scope.documentId, block_id: "copy-evidence", type: "reference", handle: "source/words", position: "z1", properties }],
        ["BlockLocked", { project_id: scope.projectId, document_id: scope.documentId, block_id: "copy-evidence" }],
      ]);
      const proposed = await preview(state), applied = await inspect(await state.copy(confirm(proposed)));
      const copied = (await projection(state, applied.documentId)).blocks.find((block) => block.type === "reference");
      assert.deepEqual(copied.properties, properties); assert.equal(copied.locked, true);
      const pending = await preview(state);
      await state.seed([["RightsAsserted", { project_id: scope.projectId, reference_id: "copy-source-reference", rights_class: "revoked" }]]);
      assert.equal((await inspect(await state.copy(confirm(pending, "retrieve")))).stale, true);
      const before = counts(state);
      assert.equal((await state.copy(confirm(pending))).status, 409);
      assert.equal((await state.copy(operation())).status, 409); assert.deepEqual(counts(state), before);
    } finally { await state.close(); }
  }
});

async function seedModel3dContext(state, { savedView = true } = {}) {
  const modelKey = ownership.ownerMediaNamespace(state.ownerId) + "/models/source.glb";
  const viewKey = ownership.ownerMediaNamespace(state.ownerId) + "/models/source-view.png";
  const modelUrl = "/api/media/" + encodeURIComponent(modelKey), viewUrl = "/api/media/" + encodeURIComponent(viewKey);
  const modelHash = "a".repeat(64), viewHash = "b".repeat(64);
  const view = { version: 1, position: [0, 0, 6.4], target: [0, 0, 0], fov: 35, background: "#ffffff" };
  const object = (mimeType, metadata) => ({ size: 256, customMetadata: { ownerId: state.ownerId, mimeType, rights: "asserted", ...metadata },
    writeHttpMetadata(headers) { headers.set("content-type", mimeType); } });
  state.media.set(modelKey, object("model/gltf-binary", { modelFormat: "glb", sha256: modelHash }));
  if (savedView) state.media.set(viewKey, object("image/png", { sha256: viewHash, modelSourceKey: modelKey, modelSourceSha256: modelHash, modelView: JSON.stringify(view) }));
  const properties = { text: "Ceramic vessel", model_url: modelUrl, model_mime_type: "model/gltf-binary", model_content_hash: modelHash,
    model_reference_id: "copy-model-original", rights_class: "owned_or_licensed", ...(savedView ? {
      media_url: viewUrl, media_type: "image/png", source_mime_type: "image/png", source_content_hash: viewHash,
      reference_id: "copy-model-view", model_view: view, pixel_reference_mode: "subject",
    } : {}) };
  await state.seed([
    ["ReferenceIngested", { project_id: scope.projectId, reference_id: properties.model_reference_id, source_ref: modelUrl, content_hash: modelHash, rights_class: "owned_or_licensed" }],
    ...(savedView ? [["ReferenceIngested", { project_id: scope.projectId, reference_id: properties.reference_id, source_ref: viewUrl, content_hash: viewHash, rights_class: "owned_or_licensed" }]] : []),
    ["BlockCreated", { project_id: scope.projectId, document_id: scope.documentId, block_id: "copy-model", type: "model3d", handle: "model/vessel", position: "z1", properties }],
  ]);
  return { properties, modelKey, viewKey };
}

test("3D document copies retain both original mesh and saved image custody with their independent rights", async () => {
  for (const mode of ["personal", "migrated", "shared", "editor"]) {
    const state = await fixture({ mode });
    try {
      const source = await seedModel3dContext(state), proposed = await preview(state);
      const applied = await inspect(await state.copy(confirm(proposed)));
      const copied = (await projection(state, applied.documentId)).blocks.find((block) => block.type === "model3d");
      assert.deepEqual(copied.properties, source.properties);
      assert.notEqual(copied.id, "copy-model");
      if (mode === "shared" || mode === "editor") {
        for (const key of [source.modelKey, source.viewKey]) {
          const row = state.sqlite.prepare("SELECT event.payload FROM project_resource_scopes resource JOIN events event ON event.event_id=resource.source_event_id WHERE resource.project_access_id=? AND resource.resource_kind='media' AND resource.resource_id=?").get(state.projectAccessId, key);
          assert.equal(JSON.parse(row.payload).block_id, copied.id, "each asset stays anchored to the complete copied context");
        }
      }
      const pending = await preview(state);
      await state.seed([["RightsAsserted", { project_id: scope.projectId, reference_id: source.properties.model_reference_id, rights_class: "revoked" }]]);
      assert.equal((await state.copy(confirm(pending))).status, 409);
      assert.equal((await state.copy(operation())).status, 409, "a retained saved view does not replace original mesh rights");
    } finally { await state.close(); }
  }
});

test("3D copying supports a mesh before a view is saved and rejects changed original or camera evidence", async () => {
  for (const fault of ["none", "missing-model", "changed-model-hash", "changed-camera", "missing-model-rights", "wrong-model-receipt"]) {
    const state = await fixture();
    try {
      const source = await seedModel3dContext(state, { savedView: fault !== "none" });
      if (fault === "missing-model") state.media.delete(source.modelKey);
      if (fault === "changed-model-hash") state.media.get(source.modelKey).customMetadata.sha256 = "c".repeat(64);
      if (fault === "changed-camera") state.media.get(source.viewKey).customMetadata.modelView = JSON.stringify({ ...source.properties.model_view, position: [6.4, 0, 0] });
      if (fault === "missing-model-rights") await state.seed([["RightsAsserted", { project_id: scope.projectId, reference_id: source.properties.model_reference_id, rights_class: "unknown" }]]);
      if (fault === "wrong-model-receipt") await state.seed([["ReferenceIngested", { project_id: scope.projectId, reference_id: source.properties.model_reference_id, source_ref: source.properties.model_url, content_hash: "d".repeat(64), rights_class: "owned_or_licensed" }]]);
      if (fault === "none") {
        const proposed = await preview(state), applied = await inspect(await state.copy(confirm(proposed)));
        const copied = (await projection(state, applied.documentId)).blocks.find((block) => block.type === "model3d");
        assert.deepEqual(copied.properties, source.properties); assert.equal(copied.properties.media_url, undefined);
      } else {
        const before = counts(state), failed = await inspect(await state.copy(operation()), 409);
        assert.match(failed.error, /^document_duplicate_source_/u); assert.deepEqual(counts(state), before);
      }
    } finally { await state.close(); }
  }
});

test("shared 3D edits validate the final camera and image together before recording the batch", async () => {
  const state = await fixture({ mode: "shared" });
  try {
    const source = await seedModel3dContext(state);
    await preview(state); // Synchronize model and view custody before the direct authoring request.
    const edit = (property, value) => ({ type: "BlockPropertyEdited", payload: {
      project_id: scope.projectId, document_id: scope.documentId, block_id: "copy-model", property_path: property, new_value: value,
    } });
    const submit = events => state.request("/api/events", json({ action: "batch", events }, state.headers));
    const view = { ...source.properties.model_view, position: [6.4, 0, 0] };
    const before = counts(state);
    const refused = await inspect(await submit([edit("model_view", view)]), 403);
    assert.equal(refused.error, "model3d_asset_not_verified"); assert.deepEqual(counts(state), before);
    const nextKey = ownership.ownerMediaNamespace(state.ownerId) + "/models/right.png", nextUrl = "/api/media/" + encodeURIComponent(nextKey), nextHash = "c".repeat(64);
    state.media.set(nextKey, { size: 256, customMetadata: { ...state.media.get(source.viewKey).customMetadata, sha256: nextHash, modelView: JSON.stringify(view), projectAccessId: state.projectAccessId },
      writeHttpMetadata(headers) { headers.set("content-type", "image/png"); } });
    state.sqlite.prepare("INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,visibility,source_event_id,actor_user_id,created_at) VALUES(?,'media',?,?,?,?, 'collaborative_output',NULL,?,?)")
      .run(state.projectAccessId, nextKey, state.organizationId, scope.projectId, state.ownerId, state.ownerId, new Date().toISOString());
    await inspect(await submit([
      { type: "ReferenceIngested", payload: { project_id: scope.projectId, reference_id: "copy-model-right-view", source_ref: nextUrl, content_hash: nextHash, rights_class: "owned_or_licensed" } },
      edit("model_view", view), edit("media_url", nextUrl), edit("source_content_hash", nextHash), edit("reference_id", "copy-model-right-view"),
    ]));
    const model = (await projection(state)).blocks.find(block => block.id === "copy-model");
    assert.equal(model.properties.model_url, source.properties.model_url);
    assert.equal(model.properties.media_url, nextUrl); assert.deepEqual(model.properties.model_view, view);
  } finally { await state.close(); }
});

test("composition document copies preserve the PNG receipt and original 3D view lineage with live rights", async () => {
  for (const mode of ["personal", "shared"]) {
    const state = await fixture({ mode });
    try {
      const source = await seedModel3dContext(state), key = ownership.ownerMediaNamespace(state.ownerId) + "/models/composition.png";
      const recipe = { version: 1, aspect: "1:1", width: 1536, height: 1536, background: "#ffffff",
        sources: [{ id: "copy-model:view", blockId: "copy-model", label: "Vessel view", mediaUrl: source.properties.media_url, contentHash: source.properties.source_content_hash, kind: "model-view" }],
        layers: [{ id: "layer-one", sourceId: "copy-model:view", x: 50, y: 50, scale: 70, opacity: 100 }] };
      const recipeDigest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(recipe)))), byte => byte.toString(16).padStart(2, "0")).join("");
      const properties = { text: "Vessel layout", reference_id: "copy-composition-reference", media_url: "/api/media/" + encodeURIComponent(key), media_type: "image/png",
        source_mime_type: "image/png", source_content_hash: "e".repeat(64), reference_composition: recipe, pixel_reference_mode: "preserve_composition", rights_class: "owned_or_licensed" };
      state.media.set(key, { size: 256, customMetadata: { ownerId: state.ownerId, mimeType: "image/png", rights: "asserted", sha256: properties.source_content_hash,
        referenceCompositionVersion: "1", referenceCompositionSha256: recipeDigest }, writeHttpMetadata(headers) { headers.set("content-type", "image/png"); } });
      await state.seed([
        ["ReferenceIngested", { project_id: scope.projectId, reference_id: properties.reference_id, source_ref: properties.media_url, content_hash: properties.source_content_hash, rights_class: "owned_or_licensed" }],
        ["BlockCreated", { project_id: scope.projectId, document_id: scope.documentId, block_id: "copy-composition", type: "reference", handle: "reference/composition", position: "z2", properties }],
        ["BlockRehomed", { project_id: scope.projectId, block_id: "copy-model", scope: "library" }],
      ]);
      const proposed = await preview(state), applied = await inspect(await state.copy(confirm(proposed)));
      const copied = (await projection(state, applied.documentId)).blocks.find(block => block.properties.reference_composition);
      assert.deepEqual(copied.properties, properties);
      const assertCurrent = () => runtime.readEvents(state.env, state.stream).then(sourceEvents => derivedReferences.assertDerivedReferenceProvenance({
        env: state.env, ownerId: state.ownerId, properties: copied.properties, blockId: copied.id, sourceEvents,
        ...(mode === "shared" ? { projectScope: { organizationId: state.organizationId, projectAccessId: state.projectAccessId, projectId: scope.projectId, ownerUserId: state.ownerId, actorUserId: state.ownerId } } : {}),
      }));
      await assertCurrent();
      await state.seed([["RightsAsserted", { project_id: scope.projectId, reference_id: source.properties.model_reference_id, rights_class: "revoked" }]]);
      await assert.rejects(assertCurrent, /rights|license/i);
      await inspect(await state.request("/api/events?after=0&limit=2000&content=0", { headers: state.headers }));
      const before = counts(state);
      assert.equal((await state.copy(operation())).status, 409); assert.deepEqual(counts(state), before);
    } finally { await state.close(); }
  }
});

test("expired preview and private source erasure never become a new plan under the same operation ID", async () => {
  const state = await fixture();
  try {
    const intent = operation(), proposed = await preview(state, intent), before = counts(state);
    state.sqlite.prepare("UPDATE private_content SET expires_at='2000-01-01T00:00:00.000Z' WHERE content_id=?").run(proposed.previewId);
    assert.equal((await state.copy(confirm(proposed))).status, 403);
    assert.equal((await state.copy(intent)).status, 403, "an expired retained intent is not silently replanned");
    state.sqlite.prepare("UPDATE event_private_payloads SET private_json='',redacted_at=? WHERE private_event_id=(SELECT event_id FROM events WHERE stream_id=? AND type='BlockCreated' AND json_extract(payload,'$.block_id')='copy-source-0')").run(new Date().toISOString(), state.stream);
    assert.equal((await state.copy(operation())).status, 409); assert.deepEqual(counts(state), before);
  } finally { await state.close(); }
});

test("an expired apply lease is fenced before retry and dismissal cannot claim that an active save stopped", async () => {
  const state = await fixture({ mode: "shared" });
  let started, release;
  const claimed = new Promise((resolve) => { started = resolve; }), barrier = new Promise((resolve) => { release = resolve; });
  try {
    const proposed = await preview(state), before = counts(state);
    state.controls.afterClaim = async () => { started(); await barrier; };
    const first = state.copy(confirm(proposed)); await claimed;
    assert.equal((await inspect(await state.copy({ action: "resume" }))).status, "applying");
    assert.equal((await state.copy(confirm(proposed, "dismiss"))).status, 409);
    assert.equal((await state.copy(confirm(proposed))).status, 202);
    state.sqlite.prepare("UPDATE private_content SET content=json_set(content,'$.leaseExpiresAt','2000-01-01T00:00:00.000Z') WHERE content_id=?").run(proposed.previewId);
    assert.equal((await inspect(await state.copy({ action: "resume" }))).status, "not-applied");
    release(); await inspect(await first, 409); assert.deepEqual(counts(state), before);
    await inspect(await state.copy(confirm(proposed))); assert.equal(counts(state).receipts, 1);
  } finally { release(); await state.close(); }
});

test("source locks and document identity changes stale an unconfirmed copy, but do not erase its exact saved receipt", async () => {
  const state = await fixture({ mode: "shared" });
  try {
    const intent = operation(), proposed = await preview(state, intent);
    await state.seed([["BlockLocked", { project_id: scope.projectId, document_id: scope.documentId, block_id: "copy-source-0" }]]);
    assert.equal((await inspect(await state.copy(intent))).preview.previewId, proposed.previewId);
    assert.equal((await state.copy(confirm(proposed))).status, 409);
    await inspect(await state.copy(confirm(proposed, "dismiss")));
    const next = await preview(state), applied = await inspect(await state.copy(confirm(next))), before = counts(state);
    await state.seed([["DocumentRemoved", { project_id: scope.projectId, document_id: scope.documentId }]]);
    const recovered = await inspect(await state.copy(confirm(next, "retrieve")));
    assert.equal(recovered.status, "applied"); assert.equal(recovered.documentId, applied.documentId);
    const otherDocument = await state.copy({ ...confirm(next, "retrieve"), documentId: "doc-atmosphere" });
    assert.equal(otherDocument.status, 403);
    assert.equal(counts(state).events, before.events + 1);
  } finally { await state.close(); }
});

test("a source rights deadline is still checked against database time at the final mutation", async () => {
  const state = await fixture();
  try {
    const now = Date.now(), deadline = new Date(now + 60_000).toISOString();
    await state.seed([["BlockPropertyEdited", { project_id: scope.projectId, document_id: scope.documentId,
      block_id: "copy-source-0", property_path: "rights_expires_at", new_value: deadline }]]);
    const proposed = await preview(state), before = counts(state);
    assert.equal(proposed.expiresAt, deadline);
    state.controls.beforeReceipt = () => state.sqlite.function("strftime", (format, value) => {
      assert.equal(format, "%Y-%m-%dT%H:%M:%fZ"); assert.equal(value, "now"); return new Date(now + 70_000).toISOString();
    });
    assert.equal((await state.copy(confirm(proposed))).status, 409);
    assert.deepEqual(counts(state), before);
  } finally { await state.close(); }
});

test("an empty document creates one independent root-level document with no invented decisions or outputs", async () => {
  const state = await fixture({ count: 0, folder: false });
  try {
    const proposed = await preview(state, operation({ title: "空のコピー", collectionId: null })), before = counts(state);
    assert.equal(proposed.blockCount, 0); assert.equal(proposed.relationCount, 0); assert.equal(proposed.events.length, 1);
    const applied = await inspect(await state.copy(confirm(proposed))), copied = await projection(state, applied.documentId);
    assert.equal(copied.documentTitle, "空のコピー"); assert.equal(copied.blocks.length, 0); assert.equal(copied.artifacts.length, 0);
    assert.equal(copied.membership[applied.documentId], undefined); assert.equal(counts(state).events - before.events, 1);
  } finally { await state.close(); }
});

test("the rich 100-decision copy stays below 200 actual SQL statements per request and D1 query/bind/value limits", async () => {
  for(const mode of ["personal","migrated","shared","editor"]){
    const state=await fixture({mode,count:100,rich:true,relations:290});
    try{
      state.controls.queries=0;state.controls.queryLimit=199;state.controls.maxBatch=0;
      const proposed=await preview(state),previewQueries=state.controls.queries;
      assert.ok(previewQueries<200,mode+" preview queries "+previewQueries);
      state.controls.queries=0;state.controls.maxBatch=0;
      await inspect(await state.copy(confirm(proposed)));
      assert.ok(state.controls.queries<200,mode+" confirmation queries "+state.controls.queries);
      assert.ok(state.controls.maxBatch<50,mode+" transaction statement count "+state.controls.maxBatch);
      assert.ok(state.controls.maxBinds<=100);assert.ok(state.controls.maxSqlBytes<=100_000);assert.ok(state.controls.maxValueBytes<=2_000_000);
      assert.equal(counts(state).receipts,1);state.controls.queryLimit=0;
    }finally{state.controls.queryLimit=0;await state.close();}
  }
});

test("ignored event rows and missing new sidecars cannot pass the bulk transaction receipt", async()=>{
  for(const mode of ["personal","shared"])for(const fault of ["ignored-event","private-payload",...(mode==="shared"?["project-scope","resource-scope"]:[])]){
    const state=await fixture({mode,count:100,rich:true,relations:290});
    try{
      const proposed=await preview(state),before=counts(state);
      if(fault==="ignored-event")state.controls.skipEventAt=257;
      else state.controls.beforeReceipt=()=>{
        const copied=state.sqlite.prepare("SELECT event_id FROM events WHERE stream_id=? AND client_id='web:context-approval' AND type='BlockCreated' ORDER BY sequence DESC LIMIT 1").get(state.stream).event_id;
        if(fault==="private-payload")state.sqlite.prepare("UPDATE event_private_payloads SET private_json='',redacted_at=? WHERE private_event_id=?").run(new Date().toISOString(),copied);
        else if(fault==="project-scope")state.sqlite.prepare("DELETE FROM project_event_scopes WHERE event_id=?").run(copied);
        else state.sqlite.prepare("DELETE FROM project_resource_scopes WHERE resource_kind='block' AND source_event_id=?").run(copied);
      };
      await inspect(await state.copy(confirm(proposed)),409);assert.deepEqual(counts(state),before,mode+"/"+fault);
    }finally{await state.close();}
  }
});


test("materialized final receipt proof denials and NULLs always trigger CHECK rollback, never a zero-row receipt",async()=>{
 for(const mode of["personal","shared"])for(const part of["admission","source","writes","tail"])for(const denied of["0","NULL"]){
  const state=await fixture({mode});let inspected=false;
  try{
   const proposed=await preview(state),before=counts(state);
   state.controls.beforeReceipt=statement=>{
    inspected=true;
    const start=statement.sql.indexOf("receipt_"+part+"(verified) AS MATERIALIZED(");
    const following={admission:",\n    receipt_source(",source:",\n    receipt_writes(",writes:",\n    receipt_tail(",tail:"\n    SELECT receipt_input"};
    const end=statement.sql.indexOf(following[part],start);
    assert.ok(start>=0&&end>start,"actual final INSERT has the intended single-row proof");
    const current=statement.sql.slice(start,end),forced=current.replace(/ THEN 1 ELSE 0 END\)$/u," THEN "+denied+" ELSE "+denied+" END)");
    assert.notEqual(forced,current);
    // Keep every real proof expression and every bound value. Only its CASE result is faulted.
    statement.sql=statement.sql.slice(0,start)+forced+statement.sql.slice(end);
    const compiled=compileSqliteExpressionDepth(state.sqlite,statement.sql,{bindings:statement.values});
    assert.ok(compiled.ok,compiled.error);
   };
   await inspect(await state.copy(confirm(proposed)),409);assert.ok(inspected);assert.match(state.controls.lastDatabaseError,/CHECK constraint failed/);assert.deepEqual(counts(state),before,mode+" "+part+" "+denied);
   const saved=await inspect(await state.copy(confirm(proposed,"retrieve")));
   assert.equal(saved.status,"not-applied");
   await inspect(await state.copy(confirm(proposed)));assert.equal(counts(state).receipts,before.receipts+1,"the same preview remains explicitly retryable");
  }finally{await state.close();}
 }
});

test("materialized receipt equals the original full SQL predicate at current and independently tampered transaction snapshots",async()=>{
 for(const mode of["personal","shared"]){
  const state=await fixture({mode}),proposed=await preview(state);let checked=false;
  try{
   state.controls.beforeReceipt=statement=>{
    checked=true;
    const following={admission:",\n    receipt_source(",source:",\n    receipt_writes(",writes:",\n    receipt_tail(",tail:"\n    SELECT receipt_input"};
    const parts=["admission","source","writes","tail"].map(part=>{
     const marker="receipt_"+part+"(verified) AS MATERIALIZED(SELECT CASE WHEN",start=statement.sql.indexOf(marker)+marker.length;
     const end=statement.sql.indexOf(following[part],start),text=statement.sql.slice(start,end),suffix=" THEN 1 ELSE 0 END)";
     assert.ok(start>=marker.length&&end>start&&text.endsWith(suffix));
     return text.slice(0,-suffix.length);
    });
    // Reconstruct the original flat predicate from the actual unchanged SQL atoms,
    // and bind the exact same real receipt values (excluding only identity/time columns).
    const previous=state.sqlite.prepare("SELECT CASE WHEN "+parts[0]+" AND "+parts[1]+" AND ("+parts[2]+") AND "+parts[3]+" THEN 1 ELSE 0 END AS verified");
    const currentSql=statement.sql.slice(statement.sql.indexOf("WITH receipt_input")),current=state.sqlite.prepare(currentSql);
    const columns=current.columns();assert.equal(columns.length,14);assert.equal(columns[0].name,"preview_id");
    const verifiedColumn=columns[12].name;
    const compare=(name,expected)=>{
     const before=previous.get(...statement.values.slice(12,-1)).verified,after=current.get(...statement.values)[verifiedColumn];
     assert.equal(after,before,name+" same old/new truth");assert.equal(after,expected,name);
    };
    compare("current authorized transaction",1);
    const compiled=compileSqliteExpressionDepth(state.sqlite,currentSql,{bindings:statement.values});assert.ok(compiled.ok,compiled.error);
    const mutations=[
     ["lease state",()=>state.sqlite.prepare("UPDATE private_content SET content=json_set(content,'$.state','review') WHERE content_id=?").run(proposed.previewId)],
     ["lease identity",()=>state.sqlite.prepare("UPDATE private_content SET content=json_set(content,'$.leaseId','different-lease') WHERE content_id=?").run(proposed.previewId)],
     ["expired lease",()=>state.sqlite.prepare("UPDATE private_content SET content=json_set(content,'$.leaseExpiresAt','2000-01-01T00:00:00.000Z') WHERE content_id=?").run(proposed.previewId)],
     ["NULL approval",()=>state.sqlite.prepare("UPDATE private_content SET content=json_set(content,'$.approvalHash',NULL) WHERE content_id=?").run(proposed.previewId)],
     ["changed exact plan",()=>state.sqlite.prepare("UPDATE private_content SET content=json_set(content,'$.plan.sourceHead',-1) WHERE content_id=?").run(proposed.previewId)],
     ["expired retained preview",()=>state.sqlite.prepare("UPDATE private_content SET expires_at='2000-01-01T00:00:00.000Z' WHERE content_id=?").run(proposed.previewId)],
     ["withdrawn consent",()=>state.sqlite.prepare("UPDATE users SET consent_version='withdrawn' WHERE user_id=?").run(state.ownerId)],
     ["erased source private bytes",()=>state.sqlite.prepare("UPDATE event_private_payloads SET private_json='',redacted_at=? WHERE private_event_id=(SELECT event_id FROM events WHERE stream_id=? AND type='BlockCreated' AND json_extract(payload,'$.block_id')='copy-source-0')").run(new Date().toISOString(),state.stream)],
     ["erased copied private bytes",()=>state.sqlite.prepare("UPDATE event_private_payloads SET private_json='',redacted_at=? WHERE private_event_id=(SELECT event_id FROM events WHERE stream_id=? AND client_id='web:context-approval' AND type='BlockCreated' ORDER BY sequence DESC LIMIT 1)").run(new Date().toISOString(),state.stream)],
     ["unexpected owner head",()=>{
      const head=state.sqlite.prepare("SELECT MAX(sequence) AS n FROM events WHERE stream_id=?").get(state.stream).n;
      const event=runtime.makeEvent(state.stream,Number(head)+1,"user:"+state.ownerId,"receipt-oracle",crypto.randomUUID(),"DocumentCreated",{project_id:scope.projectId,document_id:"unexpected-during-receipt",title:"Unexpected additional document"});
      state.sqlite.prepare("INSERT INTO event_write_stage("+runtime.EVENT_WRITE_COLUMNS+") VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(...runtime.eventWriteBindings(event));
     }],
     ...(mode==="shared"?[
      ["expired selected session",()=>state.sqlite.prepare("UPDATE project_context_sessions SET expires_at='2000-01-01T00:00:00.000Z' WHERE principal_user_id=?").run(state.ownerId)],
      ["missing copied project custody",()=>state.sqlite.prepare("DELETE FROM project_event_scopes WHERE event_id=(SELECT event_id FROM events WHERE stream_id=? AND client_id='web:context-approval' AND type='BlockCreated' ORDER BY sequence DESC LIMIT 1)").run(state.stream)],
      ["missing preview custody",()=>state.sqlite.prepare("DELETE FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=?").run(proposed.previewId)],
     ]:[]),
    ];
    for(const[name,mutate]of mutations){
     state.sqlite.exec("SAVEPOINT receipt_equivalence");
     try{mutate();compare(name,0);}finally{state.sqlite.exec("ROLLBACK TO receipt_equivalence");state.sqlite.exec("RELEASE receipt_equivalence");}
     compare(name+" rollback",1);
    }
   };
   await inspect(await state.copy(confirm(proposed)));assert.ok(checked);assert.equal(counts(state).receipts,1);
  }finally{await state.close();}
 }
});


test("document copy router preserves exact routing, method denial, origin and selected-scope authorization",async()=>{
 const state=await fixture();
 try{
  const path="/api/documents/duplicate",before=counts(state);
  for(const method of["GET","HEAD","OPTIONS","PUT","PATCH","DELETE"]){const denied=await state.request(path,{method,headers:state.headers});assert.equal(denied.status,405,method);}
  const suffix=await state.request(path+"/unexpected",json({...scope,...operation()},state.headers));assert.equal(suffix.status,404);assert.equal((await suffix.json()).error,"not_found");
  const cross=await state.copy(operation(),{...state.headers,origin:"https://foreign.example"});assert.equal(cross.status,403);assert.equal((await cross.json()).error,"same_origin_required");
  const revoked=await state.copy(operation(),{...state.headers,cookie:"forma_project_context=missing-router-context"});assert.equal(revoked.status,403);assert.equal((await revoked.json()).error,"project_access_revoked");
  assert.deepEqual(counts(state),before,"routing and authorization denial cannot author");
  const accepted=await state.copy(operation());assert.equal(accepted.status,200,await accepted.clone().text());
  assert.equal(accepted.headers.get("x-content-type-options"),"nosniff");assert.match(accepted.headers.get("server-timing"),/app;dur=/u);assert.equal((await accepted.json()).status,"not-applied");
 }finally{await state.close();}
});


// Main170 forward contracts: these exercise the actual public Worker and retained SQL state.
const main170OutputIds = (spec) => [spec.id, ...spec.deliverables.flatMap((item) => [
  item.id, ...(item.format_variants ?? []).map((variant) => variant.id), ...(item.series?.members ?? []).map((member) => member.id),
])];
async function main170CopyOutput(state, { opaque = false, external = false } = {}) {
  const blockId = "copy-output-requirement";
  const spec = opaque ? { schema_version: 19, id: "opaque-original", unknown_constraint: "Preserve unknown authored intent exactly" }
    : requirements.parseOutputRequirement({ id: blockId, type: "Output", subtype: "Executive summary",
      content: "1 slideshow with 5-15 slides, one podcast episode outlining the document, a series of TikTok style videos outlining the various parts of the document." }).spec;
  if (!opaque) {
    spec.deliverables[0].source_scope = { kind: "blocks", block_ids: ["copy-source-0", external ? "outside-this-document" : "copy-source-1"] };
    spec.deliverables[2].series = { state: "resolved", description: "Agreed topics", members: [{
      id: "copy-series-original", label: "Findings", required: true,
      source_scope: { kind: "blocks", block_ids: ["copy-source-1"] }, coverage: { kind: "topics", topics: ["Findings"] },
      quantity: { kind: "exact", unit: "video", value: 1 }, original_text: "Findings", value_origins: {},
    }] };
    assert.equal(requirements.inspectOutputRequirement(spec).status, "valid");
  }
  const properties = { text: opaque ? "Future intent" : spec.original_text, subtype: "Executive summary", output_spec: spec,
    output_grant_id: "original-grant", output_acceptance_id: "original-acceptance", output_status: "accepted",
    grant_id: "original-grant", acceptance_id: "original-acceptance", weight: 1, intent: "include", authority: "authored" };
  await state.seed([["BlockCreated", { ...{ project_id: scope.projectId, document_id: scope.documentId },
    block_id: blockId, type: "OUtput", handle: "outputs/request", position: "y1", properties }]]);
  return { blockId, spec, properties };
}
function main170CopyLedgers(state) {
  const names = state.sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all()
    .map((row) => row.name).filter((name) => /^(?:output_|generation_|budget_|usage_|assistant_executions$)/u.test(name));
  return Object.fromEntries(names.map((name) => [name, state.sqlite.prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '"').all()]));
}
async function main170RetainedCopyLedger(state) {
  const spec = requirements.parseOutputRequirement({ id: "copy-ledger-only", type: "output", subtype: "Executive summary",
    content: "1 slideshow with 5-15 slides, one podcast episode, and a series of videos outlining the document." }).spec;
  spec.deliverables = [spec.deliverables[0]];
  spec.deliverables[0].quantity = { kind: "exact", unit: "presentation", value: 1000 };
  assert.equal(requirements.inspectOutputRequirement(spec).status, "valid");
  const plan = outputPlan.compileOutputPlan([spec], { document_id: scope.documentId, source_revision: "a".repeat(64),
    requirement_revision: "b".repeat(64), count_policies: { [spec.deliverables[0].id]: { kind: "exact", unit: "slide", value: 5 } }, max_targets: 1000 });
  assert.equal(plan.issues.length, 0); assert.equal(plan.targets.length, 1000); assert.equal(plan.unresolved_groups.length, 0);
  assert.ok(plan.targets.every((target) => target.blocking_issues.length === 0));
  const payload = { project_id: scope.projectId, document_id: scope.documentId, plan_revision_id: "copy-ledger-only",
    confirmed_plan: { id: scope.documentId, revisionId: "copy-ledger-only", revision: 1, confirmedAt: new Date().toISOString(),
      requirementsDigest: "b".repeat(64), sourceDigest: "a".repeat(64), plan,
      targetContractDigests: Object.fromEntries(plan.targets.map((target) => [target.id, "c".repeat(64)])), confirmationOptions: {} } };
  await state.seed([["OutputPlanConfirmed", payload]]);
  const row = state.sqlite.prepare("SELECT event.event_id,secret.private_json FROM events event JOIN event_private_payloads secret ON secret.private_event_id=event.event_id WHERE event.stream_id=? AND event.type='OutputPlanConfirmed' ORDER BY event.sequence DESC LIMIT 1").get(state.stream);
  assert.ok(Buffer.byteLength(row.private_json, "utf8") > 1_000_000, "actual compiled 1000-target retained plan, not padding");
  return row.event_id;
}
for (const mode of ["personal", "migrated", "shared", "editor"]) test("main170 copy remaps Output drafts before approval without copying plans, grants, acceptance or spending: " + mode, async () => {
  const state = await fixture({ mode });
  try {
    const original = await main170CopyOutput(state);
    await state.seed([["OutputTargetAccepted", { project_id: scope.projectId, document_id: scope.documentId,
      acceptance_id: "original-acceptance", target_id: "original-target", accepted_at: new Date().toISOString() }]]);
    await main170RefreshCopySource(state);
    const before = counts(state), ledgers = main170CopyLedgers(state), source = await projection(state);
    const proposed = await preview(state), copied = proposed.events.find((event) => event.type === "BlockCreated" && event.payload.type === "output");
    assert.ok(copied); assert.equal(proposed.blockCount, 4);
    const spec = copied.payload.properties.output_spec;
    assert.equal(spec.id, copied.payload.block_id); assert.equal(requirements.inspectOutputRequirement(spec).status, "valid");
    assert.ok(main170OutputIds(spec).every((id) => !main170OutputIds(original.spec).includes(id)));
    const destinations = new Map(proposed.events.filter((event) => event.type === "BlockCreated").map((event) => [event.payload.copied_from_block_id, event.payload.block_id]));
    assert.deepEqual(spec.deliverables[0].source_scope, { kind: "blocks", block_ids: [destinations.get("copy-source-0"), destinations.get("copy-source-1")] });
    assert.deepEqual(spec.deliverables[1].source_scope, { kind: "document" });
    assert.deepEqual(spec.deliverables[2].series.members[0].source_scope, { kind: "blocks", block_ids: [destinations.get("copy-source-1")] });
    assert.deepEqual(spec.deliverables.map((item) => item.quantity), original.spec.deliverables.map((item) => item.quantity));
    for (const key of ["output_grant_id", "output_acceptance_id", "output_status", "grant_id", "acceptance_id", "weight", "intent"]) {
      assert.equal(Object.hasOwn(copied.payload.properties, key), false, key);
    }
    assert.ok(proposed.events.every((event) => !event.type.startsWith("Output") && event.type !== "DocumentRenderCompleted"));
    assert.deepEqual(counts(state), before); assert.deepEqual(main170CopyLedgers(state), ledgers);
    const retainedBefore = JSON.parse(state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(proposed.previewId).content);
    assert.equal(await consent.consentHash(retainedBefore.plan), proposed.approvalHash);
    const approvedBytes = JSON.stringify(retainedBefore.plan);
    const result = await inspect(await state.copy(confirm(proposed)));
    assert.equal(result.status, "applied");
    const appended = (await runtime.readEvents(state.env, state.stream)).filter((event) => event.clientId === "web:context-approval");
    assert.equal(JSON.stringify(appended.map((event) => ({ type: event.type, payload: event.payload }))), JSON.stringify(proposed.events));
    const retainedAfter = JSON.parse(state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(proposed.previewId).content);
    assert.equal(JSON.stringify(retainedAfter.plan), approvedBytes); assert.equal(retainedAfter.approvalHash, proposed.approvalHash);
    assert.equal(state.sqlite.prepare("SELECT approval_hash FROM authoring_commits WHERE preview_id=?").get(proposed.previewId).approval_hash, proposed.approvalHash);
    assert.deepEqual((await projection(state)).blocks, source.blocks, "the original Output and its authored source stay unchanged");
    const destination = await projection(state, result.documentId);
    assert.deepEqual(destination.blocks.find((block) => block.type === "output").properties.output_spec, spec);
    assert.equal(destination.artifacts.length, 0); assert.equal(destination.outputs.length, 0);
    assert.deepEqual(main170CopyLedgers(state), ledgers);
    assert.equal((await inspect(await state.copy(confirm(proposed, "retrieve")))).documentId, result.documentId);
  } finally { await state.close(); }
});
for (const opaque of [false, true]) test("main170 copy preserves " + (opaque ? "opaque future Output intent" : "complete unavailable Output scope without silently narrowing"), async () => {
  const state = await fixture({ mode: "shared" });
  try {
    const original = await main170CopyOutput(state, { opaque, external: true });
    const proposed = await preview(state), copied = proposed.events.find((event) => event.type === "BlockCreated" && event.payload.type === "output");
    if (opaque) {
      assert.deepEqual(copied.payload.properties.output_spec, original.spec);
      assert.equal(requirements.inspectOutputRequirement(copied.payload.properties.output_spec).status, "unsupported");
    } else assert.equal(copied.payload.properties.output_spec.deliverables[0].source_scope.kind, "unknown");
    const result = await inspect(await state.copy(confirm(proposed)));
    assert.equal(result.status, "applied");
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE stream_id=? AND client_id='web:context-approval' AND type LIKE 'Output%'").get(state.stream).n, 0);
  } finally { await state.close(); }
});
for (const mode of ["personal", "migrated", "shared"]) test("main170 copy refuses an already-approved legacy Output plan instead of silently normalizing it: " + mode, async () => {
  const state = await fixture({ mode });
  try {
    await main170CopyOutput(state);
    const proposed = await preview(state);
    const retained = JSON.parse(state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(proposed.previewId).content);
    const created = retained.plan.events.find((event) => event.type === "BlockCreated" && event.payload.type === "output");
    created.payload.properties.weight = .6; // A retained pre-normalization plan can never be repaired after approval.
    retained.approvalHash = await consent.consentHash(retained.plan);
    state.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id=?").run(JSON.stringify(retained), proposed.previewId);
    const oldApproval = { ...proposed, approvalHash: retained.approvalHash }, before = counts(state), bytes = JSON.stringify(retained.plan);
    const denied = await inspect(await state.copy(confirm(oldApproval)), 409);
    assert.equal(denied.error, "authoring_preview_stale"); assert.equal(denied.status, "not-applied"); assert.deepEqual(counts(state), before);
    const after = JSON.parse(state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(proposed.previewId).content);
    assert.equal(JSON.stringify(after.plan), bytes); assert.equal(after.approvalHash, oldApproval.approvalHash);
  } finally { await state.close(); }
});
for (const mode of ["personal", "migrated", "shared"]) test("main170 copy detects erasure of another Document actually included in contextSourceHash at the final receipt: " + mode, async () => {
  const state = await fixture({ mode });
  try {
    await state.seed([
      ["DocumentCreated", { project_id: scope.projectId, document_id: "copy-context-other", title: "Context dependency" }],
      ["BlockCreated", { project_id: scope.projectId, document_id: "copy-context-other", block_id: "copy-context-other-block",
        type: "direction", position: "a0", properties: { text: "PRIVATE_CONTEXT_HASH_DEPENDENCY" } }],
    ]);
    const proposed = await preview(state), before = counts(state);
    assert.ok(proposed.events.every((event) => event.payload.copied_from_block_id !== "copy-context-other-block"));
    const sourceId = state.sqlite.prepare("SELECT event_id FROM events WHERE stream_id=? AND type='BlockCreated' AND json_extract(payload,'$.block_id')='copy-context-other-block'").get(state.stream).event_id;
    state.controls.afterClaim = () => state.sqlite.prepare("UPDATE event_private_payloads SET private_json='',redacted_at=? WHERE private_event_id=?").run(new Date().toISOString(), sourceId);
    const denied = await inspect(await state.copy(confirm(proposed)), 409);
    assert.equal(denied.status, "not-applied"); assert.deepEqual(counts(state), before);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM authoring_commits WHERE preview_id=?").get(proposed.previewId).n, 0);
  } finally { await state.close(); }
});
for (const mode of ["personal", "migrated", "shared"]) test("main170 copy retains full source proof with an unrelated 1000-target Output ledger larger than one MB: " + mode, async () => {
  const state = await fixture({ mode });
  try {
    await main170CopyOutput(state);
    const request = () => new Request("http://localhost/api/documents/duplicate", json(scope, state.headers));
    const initial = await contextAuthority.prepareDocumentAuthority(request(), state.env, scope, "author"); assert.ok(!(initial instanceof Response));
    const ledgerId = await main170RetainedCopyLedger(state);
    const current = await contextAuthority.prepareDocumentAuthority(request(), state.env, scope, "author"); assert.ok(!(current instanceof Response));
    assert.ok(current.events.some((event) => event.eventId === ledgerId));
    assert.equal(current.binding.sourceHash, initial.binding.sourceHash, "same real hash; no ledger-history truncation or new source definition");
    const proposed = await preview(state), before = counts(state);
    state.controls.afterClaim = () => state.sqlite.prepare("UPDATE event_private_payloads SET private_json='',redacted_at=? WHERE private_event_id=?").run(new Date().toISOString(), ledgerId);
    const result = await inspect(await state.copy(confirm(proposed)));
    assert.equal(result.status, "applied"); assert.equal(counts(state).events - before.events, proposed.events.length);
    assert.equal(counts(state).receipts, before.receipts + 1);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE stream_id=? AND client_id='web:context-approval' AND type LIKE 'Output%'").get(state.stream).n, 0);
  } finally { await state.close(); }
});
for (const mode of ["personal", "shared"]) test("main170 copy keeps dedicated Output draft edits authoritative and refuses the stale approval: " + mode, async () => {
  const state = await fixture({ mode });
  try {
    const original = await main170CopyOutput(state);
    const proposed = await preview(state), originalBytes = state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(proposed.previewId).content;
    const snapshot = await inspect(await state.request("/api/output-requirements?documentId=" + scope.documentId, { headers: state.headers }));
    const changed = structuredClone(original.spec); changed.original_text += " Preserve current authored scope.";
    const result = await inspect(await state.request("/api/output-requirements", json({ action: "save", documentId: scope.documentId,
      blockId: original.blockId, spec: changed, expectedRevision: snapshot.revision, clientMutationId: crypto.randomUUID() }, state.headers)));
    assert.ok(result.appended.some((event) => event.type === "BlockPropertyEdited" && event.payload.property_path === "output_spec"));
    const before = counts(state), denied = await inspect(await state.copy(confirm(proposed)), 409);
    assert.equal(denied.status, "not-applied"); assert.deepEqual(counts(state), before);
    const retained = JSON.parse(state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(proposed.previewId).content);
    assert.deepEqual(retained.plan, JSON.parse(originalBytes).plan); assert.equal(retained.approvalHash, proposed.approvalHash);
    const read = await inspect(await state.copy(confirm(proposed, "retrieve"))); assert.equal(read.stale, true);
    const fresh = await preview(state);
    assert.notEqual(fresh.approvalHash, proposed.approvalHash);
    assert.equal(fresh.events.find((event) => event.type === "BlockCreated" && event.payload.type === "output").payload.properties.output_spec.original_text, changed.original_text);
  } finally { await state.close(); }
});


const main170LegacyEventProof = (rows, absent = false, direct = false) => {
  const columns = [...copyProof.AUTHORING_EVENT_COLUMNS.map((column) => "event." + column),
    "secret.owner_id", "secret.project_id", "secret.document_id", "secret.private_json"];
  const join = absent ? "LEFT JOIN" : "JOIN";
  return direct ? {
    sql: "EXISTS(SELECT 1 FROM events event " + join + " event_private_payloads secret ON secret.private_event_id=event.event_id WHERE "
      + columns.map((column) => column + " IS ?").join(" AND ") + " AND secret.redacted_at IS NULL)", bindings: rows[0],
  } : {
    sql: "NOT EXISTS(SELECT 1 FROM json_each(?) expected WHERE NOT EXISTS(SELECT 1 FROM events event " + join
      + " event_private_payloads secret ON secret.private_event_id=event.event_id WHERE "
      + columns.map((column, index) => column + " IS json_extract(expected.value,'$[" + index + "]')").join(" AND ")
      + " AND secret.redacted_at IS NULL))", bindings: [JSON.stringify(rows)],
  };
};
const main170LegacySidecarProof = (table, rows) => ({
  sql: "NOT EXISTS(SELECT 1 FROM json_each(?) expected WHERE NOT EXISTS(SELECT 1 FROM " + table + " stored WHERE "
    + copyProof.AUTHORING_SIDECAR_COLUMNS[table].map((column, index) => "stored." + column + " IS json_extract(expected.value,'$[" + index + "]')").join(" AND ") + "))",
  bindings: [JSON.stringify(rows)],
});
const main170ProofValue = async (state, proof) => Number((await state.env.DB.prepare("SELECT CASE WHEN " + proof.sql + " THEN 1 ELSE 0 END AS verified").bind(...proof.bindings).first()).verified);
const main170DifferentProofValue = (value) => typeof value === "number" ? value + 1 : typeof value === "string" ? value + "-different" : "not-null";
test("main170 pure event proof row IS is equivalent for every canonical/private column, NULL, missing row, redaction and direct large binding", async () => {
  const state = await fixture();
  try {
    const row = state.sqlite.prepare("SELECT event.*,secret.owner_id,secret.project_id,secret.document_id,secret.private_json FROM events event JOIN event_private_payloads secret ON secret.private_event_id=event.event_id WHERE event.stream_id=? AND event.type='BlockCreated' AND json_extract(event.payload,'$.block_id')='copy-source-0'").get(state.stream);
    const values = [...copyProof.AUTHORING_EVENT_COLUMNS.map((column) => row[column] ?? null), row.owner_id, row.project_id, row.document_id, row.private_json];
    let comparisons = 0;
    const compare = async (rows, expected, absent = false, direct = false) => {
      const legacy = await main170ProofValue(state, main170LegacyEventProof(rows, absent, direct));
      const current = await main170ProofValue(state, copyProof.authoringEventRowsProof(rows, absent));
      assert.equal(current, legacy); assert.equal(current, expected); comparisons++;
    };
    await compare([values], 1);
    for (let index = 0; index < values.length; index++) {
      const unequal = [...values]; unequal[index] = main170DifferentProofValue(values[index]); await compare([unequal], 0);
      const nullValue = [...values]; nullValue[index] = null; await compare([nullValue], values[index] === null ? 1 : 0);
      await compare([values], 1);
    }
    const pages = Array.from({ length: 129 }, () => [...values]);
    assert.equal(copyProof.authoringEventRowsProof(pages).bindings.length, 2, "same 128-row chunks, no dropped history");
    await compare(pages, 1); pages[128][16] += "changed"; await compare(pages, 0);
    state.sqlite.exec("SAVEPOINT exact_proof");
    state.sqlite.prepare("UPDATE event_private_payloads SET redacted_at='2026-01-01T00:00:00.000Z' WHERE private_event_id=?").run(row.event_id);
    await compare([values], 0);
    state.sqlite.exec("ROLLBACK TO exact_proof"); state.sqlite.exec("RELEASE exact_proof");
    state.sqlite.exec("SAVEPOINT exact_proof");
    state.sqlite.prepare("DELETE FROM event_private_payloads WHERE private_event_id=?").run(row.event_id);
    await compare([values], 0);
    const absentValues = [...values.slice(0, 13), null, null, null, null];
    await compare([absentValues], 0); await compare([absentValues], 1, true);
    state.sqlite.exec("ROLLBACK TO exact_proof"); state.sqlite.exec("RELEASE exact_proof");
    state.sqlite.exec("SAVEPOINT exact_proof");
    assert.throws(() => state.sqlite.prepare("DELETE FROM events WHERE event_id=?").run(row.event_id), /events are append-only/u);
    const missingEvent = [...values]; missingEvent[0] = "not-an-allocated-event"; await compare([missingEvent], 0);
    state.sqlite.exec("ROLLBACK TO exact_proof"); state.sqlite.exec("RELEASE exact_proof");
    const large = JSON.stringify({ text: "\n".repeat(700_000) }), largeValues = [...values.slice(0, 16), large];
    assert.ok(Buffer.byteLength(large, "utf8") < 2_000_000); assert.ok(Buffer.byteLength(JSON.stringify(largeValues), "utf8") > 1_900_000);
    state.sqlite.prepare("UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?").run(large, row.event_id);
    const direct = copyProof.authoringEventRowsProof([largeValues]);
    assert.equal(direct.bindings.length, 17, "same direct-binding fallback, not another serialized copy");
    await compare([largeValues], 1, false, true);
    const wrongLarge = [...largeValues]; wrongLarge[16] += " ";
    await compare([wrongLarge], 0, false, true);
    assert.equal(comparisons, 61);
  } finally { await state.close(); }
});
for (const table of ["project_event_scopes", "project_resource_scopes"]) test("main170 pure sidecar row IS preserves all ten exact fields and NULL/missing-row denials: " + table, async () => {
  const state = await fixture({ mode: "shared" });
  try {
    await preview(state);
    const row = state.sqlite.prepare("SELECT rowid AS fixture_rowid,* FROM " + table + " WHERE project_access_id=? LIMIT 1").get(state.projectAccessId);
    assert.ok(row);
    const values = copyProof.AUTHORING_SIDECAR_COLUMNS[table].map((column) => row[column] ?? null);
    const compare = async (expected, truth) => {
      const legacy = await main170ProofValue(state, main170LegacySidecarProof(table, [expected]));
      const current = await main170ProofValue(state, copyProof.authoringSidecarProof(table, [expected]));
      assert.equal(current, legacy); assert.equal(current, truth);
    };
    await compare(values, 1);
    for (let index = 0; index < values.length; index++) {
      const unequal = [...values]; unequal[index] = main170DifferentProofValue(values[index]); await compare(unequal, 0);
      const nullable = [...values]; nullable[index] = null; await compare(nullable, values[index] === null ? 1 : 0);
      await compare(values, 1);
    }
    state.sqlite.exec("SAVEPOINT sidecar_proof");
    state.sqlite.prepare("DELETE FROM " + table + " WHERE rowid=?").run(row.fixture_rowid); await compare(values, 0);
    state.sqlite.exec("ROLLBACK TO sidecar_proof"); state.sqlite.exec("RELEASE sidecar_proof");
  } finally { await state.close(); }
});
async function main170CopyMedia(state) {
  const contentHash = "4".repeat(64), mimeType = "text/plain";
  const extraction = await sourceDocuments.extractSourceDocument(new File(["Approved words remain unchanged."], "source.txt", { type: mimeType }));
  const evidenceHash = await sourceDocuments.sourceDocumentEvidenceDigest(sourceDocuments.sourceDocumentEvidence(extraction, contentHash, mimeType));
  const key = ownership.ownerMediaNamespace(state.ownerId) + "/main170-source.txt", mediaUrl = "/api/media/" + encodeURIComponent(key);
  state.media.set(key, { customMetadata: { ownerId: state.ownerId, sha256: contentHash, mimeType, sourceEvidenceSha256: evidenceHash } });
  const properties = { text: extraction.text, reference_id: "main170-copy-reference", media_url: mediaUrl,
    source_evidence_hash: evidenceHash, source_content_hash: contentHash, source_mime_type: mimeType, source_kind: extraction.sourceKind,
    extraction_status: extraction.status, source_citations: extraction.segments.map((segment) => ({ anchor: segment.anchor, excerpt: segment.text })),
    source_segment_count: extraction.segments.length, source_excerpt_truncated: extraction.truncated, rights_class: "owned_or_licensed" };
  await state.seed([
    ["ReferenceIngested", { project_id: scope.projectId, reference_id: "main170-copy-reference", source_ref: mediaUrl, content_hash: contentHash, rights_class: "owned_or_licensed" }],
    ["BlockCreated", { project_id: scope.projectId, document_id: scope.documentId, block_id: "main170-copy-evidence", type: "reference", position: "z1", handle: "source/words", properties }],
    ["BlockLocked", { project_id: scope.projectId, document_id: scope.documentId, block_id: "main170-copy-evidence" }],
  ]);
  return { key, properties };
}
for (const mode of ["migrated", "shared"]) test("main170 copy media custody moves only to its exact allocated copied-block event: " + mode, async () => {
  const state = await fixture({ mode });
  try {
    const media = await main170CopyMedia(state), proposed = await preview(state);
    const before = state.sqlite.prepare("SELECT * FROM project_resource_scopes WHERE project_access_id=? AND resource_kind='media' AND resource_id=?").get(state.projectAccessId, media.key);
    assert.ok(before);
    const result = await inspect(await state.copy(confirm(proposed)));
    assert.equal(result.status, "applied");
    const after = state.sqlite.prepare("SELECT * FROM project_resource_scopes WHERE project_access_id=? AND resource_kind='media' AND resource_id=?").get(state.projectAccessId, media.key);
    const copied = (await runtime.readEvents(state.env, state.stream)).find((event) => event.clientId === "web:context-approval" && event.type === "BlockCreated" && event.payload.copied_from_block_id === "main170-copy-evidence");
    assert.ok(copied); assert.equal(after.source_event_id, copied.eventId); assert.notEqual(after.source_event_id, before.source_event_id);
    for (const column of copyProof.AUTHORING_SIDECAR_COLUMNS.project_resource_scopes.filter((column) => column !== "source_event_id")) assert.equal(after[column], before[column], column);
    assert.deepEqual((await projection(state, result.documentId)).blocks.find((block) => block.id === copied.payload.block_id).properties, media.properties);
    assert.equal(state.sqlite.prepare("SELECT approval_hash FROM authoring_commits WHERE preview_id=?").get(proposed.previewId).approval_hash, proposed.approvalHash);
  } finally { await state.close(); }
});
for (const mode of ["migrated", "shared"]) for (const boundary of ["afterClaim", "beforeWrite"]) test("main170 copy rejects a competing media pointer and every other custody field at the same-transaction write boundary: " + mode + "/" + boundary, async () => {
  const state = await fixture({ mode });
  try {
    const media = await main170CopyMedia(state), proposed = await preview(state), before = counts(state);
    const row = state.sqlite.prepare("SELECT rowid AS fixture_rowid,* FROM project_resource_scopes WHERE project_access_id=? AND resource_kind='media' AND resource_id=?").get(state.projectAccessId, media.key);
    const columns = ["source_event_id", ...copyProof.AUTHORING_SIDECAR_COLUMNS.project_resource_scopes.filter((column) => column !== "source_event_id")];
    let calls = 0;
    for (const column of columns) {
      state.controls[boundary] = () => {
        calls++; state.sqlite.prepare("UPDATE project_resource_scopes SET " + column + "=? WHERE rowid=?")
          .run(main170DifferentProofValue(row[column]), row.fixture_rowid);
      };
      const denied = await inspect(await state.copy(confirm(proposed)), 409);
      assert.equal(denied.status, "not-applied", column); assert.deepEqual(counts(state), before, column);
      assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM authoring_commits WHERE preview_id=?").get(proposed.previewId).n, 0);
      if (boundary === "beforeWrite") {
        const current = state.sqlite.prepare("SELECT * FROM project_resource_scopes WHERE rowid=?").get(row.fixture_rowid);
        assert.equal(current[column], row[column], "the injected transaction-local change rolls back with all writes: " + column);
      } else state.sqlite.prepare("UPDATE project_resource_scopes SET " + column + "=? WHERE rowid=?").run(row[column], row.fixture_rowid);
    }
    assert.equal(calls, 10);
    const recovered = await inspect(await state.copy(confirm(proposed)));
    assert.equal(recovered.status, "applied", "the original exact intent can be explicitly retried once original custody is restored");
    assert.equal(counts(state).receipts, before.receipts + 1);
  } finally { await state.close(); }
});
for (const mutation of ["source-body", "private-owner", "private-erasure", "event-custody"]) test("main170 copy media transition never masks a changed source or custody: " + mutation, async () => {
  const state = await fixture({ mode: "shared" });
  try {
    await main170CopyMedia(state);
    const proposed = await preview(state), before = counts(state);
    const sourceId = state.sqlite.prepare("SELECT event_id FROM events WHERE stream_id=? AND type='BlockCreated' AND json_extract(payload,'$.block_id')='main170-copy-evidence'").get(state.stream).event_id;
    state.controls.afterClaim = () => {
      if (mutation === "source-body") state.sqlite.prepare("UPDATE event_private_payloads SET private_json=json_set(private_json,'$.properties.text','Changed after verification') WHERE private_event_id=?").run(sourceId);
      else if (mutation === "private-owner") state.sqlite.prepare("UPDATE event_private_payloads SET owner_id='unrelated-owner' WHERE private_event_id=?").run(sourceId);
      else if (mutation === "private-erasure") state.sqlite.prepare("UPDATE event_private_payloads SET private_json='',redacted_at=? WHERE private_event_id=?").run(new Date().toISOString(), sourceId);
      else state.sqlite.prepare("UPDATE project_event_scopes SET actor_user_id='unrelated-actor' WHERE event_id=?").run(sourceId);
    };
    const denied = await inspect(await state.copy(confirm(proposed)), 409);
    assert.equal(denied.status, "not-applied"); assert.deepEqual(counts(state), mutation === "private-owner" ? { ...before, privateEvents: before.privateEvents - 1 } : before);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM event_private_payloads").get().n, before.privateEvents, "the injected owner change creates no private payload");
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM authoring_commits WHERE preview_id=?").get(proposed.previewId).n, 0);
  } finally { await state.close(); }
});

async function main170RefreshCopySource(state) {
  if (!state.projectAccessId) return;
  // Fixture-only legacy seeding precedes this real authorized index refresh.
  // A cookie-free copy still runs without the temporary selected reader cookie.
  let headers = state.headers;
  if (!headers.cookie) {
    const selected = await state.request("/api/workspaces/" + state.organizationId + "/projects/" + state.projectAccessId + "/context", { method: "POST", headers: ownerIdentity });
    assert.equal(selected.status, 200);
    headers = { ...ownerIdentity, cookie: selected.headers.get("set-cookie").split(";")[0] };
  }
  assert.equal((await state.request("/api/events?after=0&limit=2000&content=0", { headers })).status, 200);
}


test("main170 repeated 100-decision copies retain full SQL proofs within the real per-request D1 limits", async () => {
  for (const mode of ["personal", "migrated", "shared", "editor"]) {
    const state = await fixture({ mode, count: 100, rich: true, relations: 290 });
    try {
      const profiles = [];
      const measured = async (name, action) => {
        Object.assign(state.controls, { queries: 0, queryLimit: 199, maxBinds: 0, maxSqlBytes: 0, maxValueBytes: 0, maxBatch: 0 });
        const result = await action();
        profiles.push({ mode, name, queries: state.controls.queries, binds: state.controls.maxBinds, sqlBytes: state.controls.maxSqlBytes,
          valueBytes: state.controls.maxValueBytes, batch: state.controls.maxBatch });
        assert.ok(state.controls.queries < 200, mode + "/" + name);
        assert.ok(state.controls.maxBinds <= 100); assert.ok(state.controls.maxSqlBytes <= 100_000);
        assert.ok(state.controls.maxValueBytes <= 2_000_000); assert.ok(state.controls.maxBatch < 50);
        return result;
      };
      const first = await measured("preview-first", () => preview(state));
      const firstResult = await measured("apply-first", async () => inspect(await state.copy(confirm(first))));
      assert.equal(firstResult.status, "applied");
      const second = await measured("preview-second", () => preview(state));
      const secondResult = await measured("apply-second", async () => inspect(await state.copy(confirm(second))));
      assert.equal(secondResult.status, "applied"); assert.notEqual(secondResult.documentId, firstResult.documentId);
      const recovered = await measured("retrieve-original", async () => inspect(await state.copy(confirm(first, "retrieve"))));
      assert.equal(recovered.documentId, firstResult.documentId); assert.equal(counts(state).receipts, 2);
      assert.equal(first.events.length, 512); assert.equal(second.events.length, 512);
      state.controls.queryLimit = 0;
      // Profile output is synthetic fixture metadata only; no private body or real provider is involved.
      console.log("MAIN170_COPY_D1", JSON.stringify(profiles));
    } finally { state.controls.queryLimit = 0; await state.close(); }
  }
});

for(const mode of ['personal','shared','editor'])test('native document duplication retains authored Memory attribution without private support '+mode,async()=>{
 const state=await fixture({mode});
 try{
  await state.seed([['BlockPropertyEdited',{project_id:scope.projectId,document_id:scope.documentId,block_id:'copy-source-0',property_path:'text',old_value:'PRIVATE_SOURCE_0',new_value:'Accepted Memory text',memory_authored_version:1}]]);
  const proposed=await preview(state),marked=proposed.events.filter(event=>event.type==='BlockCreated'&&event.payload.memory_authored_version===1);
  assert.equal(marked.length,1);assert.equal(marked[0].payload.copied_from_block_id,'copy-source-0');
  assert.equal(Object.hasOwn(marked[0].payload,'source_chat_turn_id'),false);
  const applied=await inspect(await state.copy(confirm(proposed))),events=await runtime.readEvents(state.env,state.stream);
  const created=events.find(event=>event.type==='BlockCreated'&&event.payload.document_id===applied.documentId&&event.payload.copied_from_block_id==='copy-source-0');
  assert.equal(created.payload.memory_authored_version,1);assert.equal(created.payload.properties.text,'Accepted Memory text');
  const {memoryAuthoredEventIds}=await import('../src/model/memory-authorship.ts');assert.equal(memoryAuthoredEventIds(events).has(created.eventId),true);
  // Already authored copies are not disposable private Memory descendants.
  assert.equal(created.payload.memory_origin_version,undefined);
 }finally{await state.close();}
});
