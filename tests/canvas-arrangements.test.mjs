import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { enforceD1ExpressionDepth } from "./helpers/d1-expression-depth.mjs";

const root = new URL("../", import.meta.url).href;
const resolution = registerHooks({ resolve(specifier, context, nextResolve) {
  const local = context.parentURL?.startsWith(root) && !context.parentURL.includes("/node_modules/");
  return nextResolve(local && specifier.startsWith(".") && !/\.[a-z0-9]+$/iu.test(specifier) ? specifier + ".ts" : specifier, context);
} });
const [{ default: worker }, { foldEvents }, { foldCanvasEvents }, { outcomeArrangementRevisions },
  { readEvents }, { requireUser }, { readProjectRequestContext, readProjectEventPage }, contract] = await Promise.all([
  import("../worker/index.ts"), import("../src/model/events.ts"),
  import("../src/canvas/model.ts"), import("../src/canvas/outcome-arrangements.ts"),
  import("../worker/runtime.ts"), import("../worker/pilot-policy.ts"), import("../worker/project-access.ts"),
  import("../worker/canvas-arrangement-contract.ts"),
]).finally(() => resolution.deregister());

function database() {
  const sqlite = new DatabaseSync(":memory:");
  const controls = { beforeReceipt: null, beforeAuthoringBatch: null, failEventAt: 0, failReceipt: false,
    loseResponse: false, maxBindings: 0, calls: 0 };
  class Statement {
    constructor(sql, values = []) { this.sql = sql; this.values = values; }
    bind(...values) {
      controls.maxBindings = Math.max(controls.maxBindings, values.length);
      assert.ok(values.length <= 100, "D1 parameter limit: " + values.length);
      return new Statement(this.sql, values);
    }
    execute(kind) {
      controls.calls++;
      if (/^\s*INSERT INTO authoring_commits/iu.test(this.sql)) {
        if (controls.beforeReceipt) { const callback = controls.beforeReceipt; controls.beforeReceipt = null; callback(); }
        if (controls.failReceipt) { controls.failReceipt = false; throw new Error("injected_receipt_failure"); }
      }
      if (controls.failEventAt && /^\s*INSERT INTO event_write_stage/iu.test(this.sql)) {
        controls.failEventAt--;
        if (!controls.failEventAt) throw new Error("injected_event_failure");
      }
      const statement = sqlite.prepare(this.sql);
      if (kind === "first") return statement.get(...this.values) ?? null;
      if (kind === "all") return { results: statement.all(...this.values), success: true, meta: { changes: 0 } };
      return { results: [], success: true, meta: { changes: Number(statement.run(...this.values).changes) } };
    }
    async first() { return this.execute("first"); }
    async all() { return this.execute("all"); }
    async run() { return this.execute("run"); }
  }
  return { sqlite, controls, DB: {
    prepare(sql) { return new Statement(sql); },
    async batch(statements) {
      const authoring = statements.some((statement) => /^\s*INSERT INTO authoring_commits/iu.test(statement.sql));
      if (authoring && controls.beforeAuthoringBatch) { const callback = controls.beforeAuthoringBatch; controls.beforeAuthoringBatch = null; callback(); }
      sqlite.exec("BEGIN");
      let results;
      try {
        results = statements.map((statement) => statement.execute(/^\s*(?:SELECT|WITH)/iu.test(statement.sql) ? "all" : "run"));
        sqlite.exec("COMMIT");
      } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
      if (authoring && controls.loseResponse) { controls.loseResponse = false; throw new Error("response_lost_after_commit"); }
      return results;
    },
  } };
}
const json = (body, headers = {}) => ({ method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) });
const userHeaders = (id) => ({ "oai-authenticated-user-id": id, "oai-authenticated-user-email": id + "@example.test" });
function append(state, entries) {
  let sequence = state.sqlite.prepare("SELECT COALESCE(MAX(sequence),0) AS n FROM events WHERE stream_id=?").get(state.stream).n;
  const now = new Date().toISOString(), insert = state.sqlite.prepare("INSERT INTO events(event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,causation_id,compensates_event_id,schema_version,type,payload) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)");
  for (const [type, payload] of entries) insert.run(crypto.randomUUID(), state.stream, ++sequence, now, now, "user:" + state.ownerId,
    "canvas-arrangement-fixture", crypto.randomUUID(), null, null, 1, type, JSON.stringify(payload));
}
async function fixture(mode = "personal", count = 3) {
  const state = database(), background = [];
  state.env = { DB: state.DB, ASSETS: { fetch: async () => new Response(null, { status: 404 }) }, MEDIA: {} };
  state.request = async (path, init) => {
    const response = await worker.fetch(new Request("http://localhost" + path, init), state.env, { waitUntil(promise) { background.push(promise); } });
    while (background.length) await Promise.all(background.splice(0));
    return response;
  };
  state.ownerId = mode === "personal" ? "dev-local-creative" : "arrangement-owner";
  state.stream = "creative:" + state.ownerId;
  state.projectId = "project-atmosphere";
  state.canvasId = "arrangement-board";
  const owner = mode === "personal" ? {} : userHeaders(state.ownerId);
  assert.equal((await state.request("/api/session", { headers: owner })).status, 200);
  state.sqlite.prepare("UPDATE users SET role='admin',consent_version=? WHERE user_id=?").run("pilot-2026-08-10", state.ownerId);
  assert.equal((await state.request("/api/events?after=0&limit=2000&content=0", { headers: owner })).status, 200);
  state.selectedItemIds = Array.from({ length: count }, (_, index) => "arrangement-item-" + String(index).padStart(3, "0"));
  append(state, [
    ["CanvasCreated", { project_id: state.projectId, canvas_id: state.canvasId, name: "Existing work" }],
    ...state.selectedItemIds.flatMap((itemId, index) => [
      ["BlockCreated", { block_id: "arrangement-source-" + index, project_id: state.projectId, canvas_id: state.canvasId,
        scope: "canvas", type: "direction", handle: "direction/fixture-" + index, position: "c" + index,
        properties: { text: "Existing authored direction " + index, source_rights: "fixture", intent: "include" } }],
      ["CanvasItemPlaced", { item_id: itemId, canvas_id: state.canvasId, project_id: state.projectId, source_kind: "block",
        source_id: "arrangement-source-" + index, title: "Direction " + index, block_type: "direction",
        frame: { x: 80 + index % 5 * 350, y: 120 + Math.floor(index / 5) * 260 + index % 2 * 40, w: 280 + index % 2 * 20, h: 200, rot: 0, z: "a" + index } }],
    ]),
    ["CanvasCreated", { project_id: state.projectId, canvas_id: "arrangement-other-board", name: "Different board" }],
    ["RightsAsserted", { project_id: state.projectId, block_id: "arrangement-source-0", rights_basis: "authored-fixture", rights_confirmed: true }],
  ]);
  state.headers = owner;
  if (mode !== "personal") {
    const created = await state.request("/api/workspaces", json({ name: "Arrangement fixture" }, owner));
    assert.equal(created.status, 201, await created.clone().text());
    state.organizationId = (await created.json()).organizationId;
    const project = await state.request("/api/workspaces/" + state.organizationId + "/projects", json({ projectId: state.projectId }, owner));
    assert.equal(project.status, 201, await project.clone().text());
    state.projectAccessId = (await project.json()).projectAccessId;
    const contextPath = "/api/workspaces/" + state.organizationId + "/projects/" + state.projectAccessId + "/context";
    if (mode === "editor" || mode === "viewer") {
      const member = userHeaders("arrangement-member");
      assert.equal((await state.request("/api/session", { headers: member })).status, 200);
      state.sqlite.prepare("UPDATE users SET role='admin',consent_version=? WHERE user_id='arrangement-member'").run("pilot-2026-08-10");
      const invited = await state.request("/api/workspaces/" + state.organizationId + "/members", json({ email: "arrangement-member@example.test", role: "member" }, owner));
      assert.equal(invited.status, 201);
      const invitation = await invited.json(), token = new URL(invitation.invitationUrl).searchParams.get("token");
      assert.equal((await state.request("/api/workspaces/" + state.organizationId + "/invitations/" + invitation.invitationId + "/accept", json({ token }, member))).status, 200);
      assert.equal((await state.request("/api/workspaces/" + state.organizationId + "/projects/" + state.projectAccessId + "/members",
        json({ userId: "arrangement-member", role: mode }, owner))).status, 201);
      const now = new Date().toISOString();
      state.sqlite.prepare("INSERT INTO capability_grants(grant_id,user_id,capability,scope_type,organization_id,project_access_id,granted_by_user_id,created_at,updated_at,status,revoked_at) VALUES(?,?,?,'project',?,?,?,?,?,'active',NULL)")
        .run(crypto.randomUUID(), "arrangement-member", "project.canvas.use", state.organizationId, state.projectAccessId, state.ownerId, now, now);
      state.headers = member;
    }
    if (mode !== "owner-custody") {
      const opened = await state.request(contextPath, { method: "POST", headers: state.headers });
      assert.equal(opened.status, 200, await opened.clone().text());
      state.headers = { ...state.headers, cookie: opened.headers.get("set-cookie").split(";")[0] };
    }
  }
  state.call = (body) => state.request("/api/canvas/arrangements", json(body, state.headers));
  const depth=enforceD1ExpressionDepth(state),close=state.sqlite.close.bind(state.sqlite);
  state.sqlite.close=()=>{try{depth.assertVerified();}finally{depth.restore();close();}};
  return state;
}
async function projections(state) {
  const request = new Request("http://localhost/api/canvas/arrangements", { headers: state.headers });
  const { user } = await requireUser(request, state.env, "viewer", { account: "principal" });
  assert.ok(user);
  const { context, response } = await readProjectRequestContext(request, state.env, user);
  assert.equal(response, null);
  const events = [];
  if (context) {
    let after = 0;
    for (;;) {
      const page = await readProjectEventPage(state.env, context, after, 5000, false);
      events.push(...page.events.filter((event) => event.type !== "ProjectResourceRestricted"));
      if (!page.hasMore) break;
      after = page.nextAfter;
    }
  } else events.push(...await readEvents(state.env, state.stream));
  return { events, projection: foldEvents(events, Infinity, undefined, state.projectId),
    canvas: foldCanvasEvents(events, state.projectId, state.canvasId) };
}
async function intent(state, extra = {}) {
  const current = await projections(state);
  const selectedItemIds = extra.selectedItemIds ?? state.selectedItemIds;
  const revisions = await outcomeArrangementRevisions(current.projection, current.canvas, selectedItemIds);
  assert.equal(revisions.ok, true, JSON.stringify(revisions));
  return { operationId: crypto.randomUUID(), projectId: state.projectId, canvasId: state.canvasId,
    recipeId: "executive-deck", name: "Arrange existing work", selectedItemIds,
    expectedLayoutRevision: revisions.value.layoutRevision, expectedSourceRevision: revisions.value.sourceRevision, ...extra };
}
async function preview(state, input) {
  const response = await state.call({ ...input, action: input.undoOperationId ? "undo-preview" : "preview" });
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  assert.equal(body.status, "review");
  return body.preview;
}
const apply = (state, input, value, extra = {}) => state.call({ ...input, action: "apply", previewId: value.previewId, approvalHash: value.approvalHash, confirmed: true, ...extra });
const countEvents = (state) => Number(state.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE stream_id=?").get(state.stream).n);
const frames = (canvas, ids) => ids.map((itemId) => { const item = canvas.items.find((entry) => entry.id === itemId); return { itemId, x: item.x, y: item.y, w: item.w, h: item.h }; });
const assertFree = (state) => {
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM budget_reservations").get().n, 0);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM cost_budget_reservations").get().n, 0);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM document_jobs").get().n, 0);
};

test("Canvas arrangement previews for free and applies only one complete geometric operation in every authoring scope", async () => {
  const originalFetch = globalThis.fetch;
  let externalCalls = 0;
  globalThis.fetch = async () => { externalCalls++; throw new Error("external_calls_forbidden"); };
  try {
    for (const mode of ["personal", "selected", "owner-custody", "editor"]) {
      const state = await fixture(mode), input = await intent(state, { name: "Cafe\u0301 ترتيب" }), before = countEvents(state);
      const sourceBefore = state.sqlite.prepare("SELECT event_id,payload FROM events WHERE stream_id=? ORDER BY sequence").all(state.stream);
      const value = await preview(state, input);
      assert.equal(value.providerCalls, 0); assert.equal(value.maximumMicrousd, 0); assert.equal(value.changesSemantics, false);
      assert.equal(countEvents(state), before);
      assert.deepEqual(value.selectedItemIds, input.selectedItemIds); assert.equal(value.name, input.name);
      const saved = await apply(state, input, value);
      assert.equal(saved.status, 200, await saved.clone().text());
      const receipt = await saved.json(); assert.equal(receipt.status, "applied"); assert.equal(receipt.arrangementId, value.arrangementId);
      assert.equal(receipt.projectId, state.projectId); assert.equal(receipt.canvasId, state.canvasId); assert.equal(receipt.operationId, input.operationId);
      assert.equal(countEvents(state) - before, 1 + 2 * state.selectedItemIds.length);
      const all = await readEvents(state.env, state.stream), created = all.slice(before);
      assert.deepEqual(created.map((event) => event.type), ["CanvasArrangementCreated", ...state.selectedItemIds.flatMap(() => ["CanvasRegisterSet", "CanvasRegisterSet"])]);
      assert.ok(created.every((event) => event.payload.history_action_id === input.operationId && event.payload.arrangement_is_context === false));
      assert.equal(contract.validateAtomicCanvasArrangementEvents(created, mode === "editor" ? "arrangement-member" : state.ownerId), null);
      assert.deepEqual(frames(foldCanvasEvents(all, state.projectId, state.canvasId), state.selectedItemIds), value.after);
      assert.deepEqual(state.sqlite.prepare("SELECT event_id,payload FROM events WHERE stream_id=? ORDER BY sequence LIMIT ?").all(state.stream, before), sourceBefore);
      const replay = await apply(state, input, value); assert.equal(replay.status, 200); assert.equal((await replay.json()).arrangementId, receipt.arrangementId);
      assert.equal(countEvents(state) - before, created.length);
      assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM authoring_commits").get().n, 1);
      assert.ok(state.controls.maxBindings <= 100);
      assertFree(state);
      state.sqlite.close();
    }
    assert.equal(externalCalls, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("Canvas arrangement grouped undo restores original positions without changing sources or dimensions", async () => {
  for (const mode of ["personal", "selected"]) {
    const state = await fixture(mode), input = await intent(state), value = await preview(state, input);
    assert.equal((await apply(state, input, value)).status, 200);
    const undoInput = await intent(state, { undoOperationId: input.operationId, name: "Restore previous positions" });
    const inverse = await preview(state, undoInput);
    assert.deepEqual(inverse.before, value.after); assert.deepEqual(inverse.after, value.before);
    const before = countEvents(state);
    assert.equal((await apply(state, undoInput, inverse)).status, 200);
    assert.equal(countEvents(state) - before, 1 + 2 * state.selectedItemIds.length);
    assert.deepEqual(frames((await projections(state)).canvas, state.selectedItemIds), value.before);
    assert.equal((await apply(state, undoInput, inverse)).status, 200);
    assert.equal(countEvents(state) - before, 1 + 2 * state.selectedItemIds.length);
    assertFree(state);
    state.sqlite.close();
  }
});

test("Canvas arrangement stable identity survives concurrent previews, confirmation and lost responses", async () => {
  const state = await fixture(), input = await intent(state), before = countEvents(state);
  const previews = await Promise.all([state.call({ ...input, action: "preview" }), state.call({ ...input, action: "preview" })]);
  const values = await Promise.all(previews.map((response) => response.json()));
  assert.ok(previews.every((response) => response.status === 200), JSON.stringify(values));
  assert.equal(values[0].preview.previewId, values[1].preview.previewId);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM private_content WHERE kind='authoring-preview'").get().n, 1);
  const value = values[0].preview;
  state.controls.loseResponse = true;
  const applied = await Promise.all([apply(state, input, value), apply(state, input, value)]);
  for (const response of applied) assert.ok([200, 202].includes(response.status), await response.clone().text());
  assert.equal(countEvents(state) - before, 1 + 2 * state.selectedItemIds.length);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM authoring_commits").get().n, 1);
  state.sqlite.prepare("UPDATE private_content SET content='',redacted_at=? WHERE kind='authoring-preview'").run(new Date().toISOString());
  const read = await state.call({ action: "retrieve", operationId: input.operationId, projectId: state.projectId, canvasId: state.canvasId });
  assert.equal(read.status, 200); assert.equal((await read.json()).status, "applied");
  assert.equal((await apply(state, input, value)).status, 200);
  assert.equal(countEvents(state) - before, 1 + 2 * state.selectedItemIds.length);
  assertFree(state);
  state.sqlite.close();
});

test("Canvas arrangement rejects selection, scope, source, lock and confirmation changes with zero mutation", async () => {
  for (const fault of ["confirmation", "selection", "wrong-board", "source", "removed-item", "removed-board", "locked", "expiry", "forged-events"]) {
    const state = await fixture(), input = await intent(state), value = await preview(state, input);
    let changed = {};
    if (fault === "confirmation") changed.confirmed = false;
    if (fault === "selection") changed.selectedItemIds = input.selectedItemIds.slice(0, 2);
    if (fault === "wrong-board") changed.canvasId = "arrangement-other-board";
    if (fault === "source") append(state, [["BlockPropertyEdited", { project_id: state.projectId, canvas_id: state.canvasId, block_id: "arrangement-source-0", property_path: "text", new_value: "Changed authored source" }]]);
    if (fault === "removed-item") append(state, [["CanvasItemRemoved", { project_id: state.projectId, canvas_id: state.canvasId, item_id: input.selectedItemIds[0] }]]);
    if (fault === "removed-board") append(state, [["CanvasRemoved", { project_id: state.projectId, canvas_id: state.canvasId }]]);
    if (fault === "locked") append(state, [["CanvasLockAcquired", { project_id: state.projectId, canvas_id: state.canvasId, item_id: input.selectedItemIds[0], holder_id: "other-user:site", lease_ms: 60_000 }]]);
    if (fault === "expiry") state.sqlite.prepare("UPDATE private_content SET expires_at='2000-01-01T00:00:00.000Z' WHERE content_id=?").run(value.previewId);
    if (fault === "forged-events") changed.events = [{ type: "DocumentCreated", payload: { document_id: "forbidden" } }];
    const before = countEvents(state), response = await apply(state, input, value, changed);
    assert.ok(response.status >= 400, fault + ": " + await response.clone().text());
    assert.equal(countEvents(state), before, fault);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM authoring_commits").get().n, 0, fault);
    assertFree(state);
    state.sqlite.close();
  }
});

test("Canvas arrangement rolls back all canonical and private event rows on final receipt and mid-commit races", async () => {
  for (const mode of ["personal", "selected"]) for (const fault of ["event", "receipt", "authority", "board", "removed-selected-item", "retained-selection", "session-expired", "source-bytes", "rights", "custody"]) {
    if (mode === "personal" && ["custody", "session-expired"].includes(fault)) continue;
    const state = await fixture(mode), input = await intent(state), value = await preview(state, input), before = countEvents(state);
    const privateBefore = state.sqlite.prepare("SELECT COUNT(*) AS n FROM event_private_payloads").get().n;
    if (fault === "event") {
      const head = state.sqlite.prepare("SELECT MAX(sequence) AS n FROM events WHERE stream_id=?").get(state.stream).n;
      state.sqlite.exec("CREATE TEMP TRIGGER fail_canvas_arrangement_event BEFORE INSERT ON event_write_stage "
        + "WHEN NEW.type='CanvasRegisterSet' AND NEW.sequence=" + (head + 2) + " BEGIN SELECT RAISE(ABORT,'injected_event_failure'); END");
    }
    if (fault === "receipt") state.controls.failReceipt = true;
    if (fault === "authority") state.controls.beforeReceipt = () => state.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id=?").run(state.ownerId);
    if (fault === "board") state.controls.beforeReceipt = () => append(state, [["CanvasRemoved", { project_id: state.projectId, canvas_id: state.canvasId }]]);
    if (fault === "removed-selected-item") state.controls.beforeReceipt = () => append(state, [["CanvasItemRemoved", {
      project_id: state.projectId, canvas_id: state.canvasId, item_id: input.selectedItemIds[0] }]]);
    if (fault === "retained-selection") state.controls.beforeReceipt = () => state.sqlite.prepare(
      "UPDATE private_content SET content=json_set(content,'$.plan.arrangement.selectedItemIds',json(?)) WHERE content_id=?")
      .run(JSON.stringify(input.selectedItemIds.slice(1)), value.previewId);
    if (fault === "session-expired") state.controls.beforeReceipt = () => state.sqlite.prepare(
      "UPDATE project_context_sessions SET expires_at='2000-01-01T00:00:00.000Z' WHERE principal_user_id=?").run(state.ownerId);
    if (fault === "source-bytes") state.controls.beforeReceipt = () => state.sqlite.prepare("UPDATE events SET payload=json_set(payload,'$.frame.x',999) WHERE stream_id=? AND type='CanvasItemPlaced' AND json_extract(payload,'$.item_id')=?").run(state.stream, input.selectedItemIds[0]);
    if (fault === "rights") state.controls.beforeReceipt = () => state.sqlite.prepare("UPDATE events SET payload=json_set(payload,'$.rights_confirmed',0) WHERE stream_id=? AND type='RightsAsserted'").run(state.stream);
    if (fault === "custody") state.controls.beforeReceipt = () => state.sqlite.prepare("DELETE FROM project_resource_scopes WHERE project_access_id=? AND resource_kind='canvas_item' AND resource_id=?").run(state.projectAccessId, input.selectedItemIds[0]);
    const response = await apply(state, input, value);
    assert.ok(response.status >= 400, mode + "/" + fault + ": " + await response.clone().text());
    assert.equal(countEvents(state), before, mode + "/" + fault);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM event_private_payloads").get().n, privateBefore);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM authoring_commits").get().n, 0);
    assertFree(state);
    state.sqlite.close();
  }
});

test("Canvas arrangement refuses an independently revoked session or viewer role before its batch", async () => {
  for (const fault of ["session", "membership", "canvas-grant"]) {
    const state = await fixture("editor"), input = await intent(state), value = await preview(state, input), before = countEvents(state);
    state.controls.beforeAuthoringBatch = () => {
      if (fault === "session") state.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE principal_user_id='arrangement-member'").run(new Date().toISOString());
      if (fault === "membership") state.sqlite.prepare("UPDATE project_memberships SET role='viewer' WHERE project_access_id=? AND user_id='arrangement-member'").run(state.projectAccessId);
      if (fault === "canvas-grant") state.sqlite.prepare("UPDATE capability_grants SET status='revoked',revoked_at=? WHERE user_id='arrangement-member' AND capability='project.canvas.use'").run(new Date().toISOString());
    };
    const response = await apply(state, input, value);
    assert.ok(response.status >= 400, fault + ": " + await response.clone().text());
    assert.equal(countEvents(state), before); assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM authoring_commits").get().n, 0);
    state.sqlite.close();
  }
  const viewer = await fixture("viewer"), input = await intent(viewer), before = countEvents(viewer);
  const denied = await viewer.call({ ...input, action: "preview" });
  assert.equal(denied.status, 403, await denied.clone().text());
  assert.equal(countEvents(viewer), before);
  viewer.sqlite.close();
});

test("Canvas arrangement clocks dominate previously accepted future clocks and undo rejects intervening moves", async () => {
  const state = await fixture();
  append(state, [["CanvasRegisterSet", { project_id: state.projectId, canvas_id: state.canvasId, item_id: state.selectedItemIds[1],
    operation: { object: { kind: "canvas_item", item_id: state.selectedItemIds[1] }, prop: "x", value: 300,
      hlc: { pt: Date.now() + 86_400_000, c: 0, site: state.ownerId + ":old-device" } } }]]);
  const input = await intent(state), value = await preview(state, input);
  assert.equal((await apply(state, input, value)).status, 200);
  assert.deepEqual(frames((await projections(state)).canvas, state.selectedItemIds), value.after);
  append(state, [["CanvasRegisterSet", { project_id: state.projectId, canvas_id: state.canvasId, item_id: state.selectedItemIds[1],
    operation: { object: { kind: "canvas_item", item_id: state.selectedItemIds[1] }, prop: "x", value: 999,
      hlc: { pt: Date.now() + 2 * 86_400_000, c: 0, site: state.ownerId + ":old-device" } } }]]);
  const undo = await intent(state, { undoOperationId: input.operationId }), before = countEvents(state);
  const denied = await state.call({ ...undo, action: "undo-preview" });
  assert.equal(denied.status, 409, await denied.clone().text());
  assert.equal(countEvents(state), before); assertFree(state);
  state.sqlite.close();
});

test("Canvas arrangement accepts its exact 100-card bound without changing the generic 50-event limit", async () => {
  const state = await fixture("selected", 100), input = await intent(state, { recipeId: "campaign" }), value = await preview(state, input);
  const sqlBefore = state.controls.calls, before = countEvents(state), applied = await apply(state, input, value);
  assert.ok(state.controls.calls - sqlBefore < 200, "The bounded arrangement must stay within the shared SQL request budget");
  assert.equal(applied.status, 200, await applied.clone().text()); assert.equal(countEvents(state) - before, 201);
  const generic = await state.request("/api/events", json({ action: "batch", events: Array.from({ length: 51 }, (_, index) => ({
    type: "CanvasRegisterSet", payload: { project_id: state.projectId, canvas_id: state.canvasId, item_id: state.selectedItemIds[0],
      operation: { object: { kind: "canvas_item", item_id: state.selectedItemIds[0] }, prop: "x", value: index,
        hlc: { pt: Date.now(), c: index, site: state.ownerId + ":ordinary" } } },
  })) }, state.headers));
  assert.equal(generic.status, 400, await generic.clone().text()); assert.equal((await generic.json()).maximum, 50);
  assert.equal(countEvents(state) - before, 201); assertFree(state);
  state.sqlite.close();
});

test("Canvas arrangement rejects oversized selections, invalid geometry and operation-ID reuse", async () => {
  const state = await fixture(), input = await intent(state), value = await preview(state, input), before = countEvents(state);
  for (const changed of [
    { selectedItemIds: [...input.selectedItemIds, input.selectedItemIds[0]] },
    { selectedItemIds: Array.from({ length: 101 }, (_, index) => "item-" + index) },
    { recipeId: "automatic-film-composition" }, { name: "x".repeat(81) }, { operationId: "contains spaces" },
    { expectedLayoutRevision: "changed" },
  ]) {
    const denied = await state.call({ ...input, ...changed, action: "preview" });
    assert.ok(denied.status >= 400); assert.equal(countEvents(state), before);
  }
  const changedName = await state.call({ ...input, name: "Different intent", action: "preview" });
  assert.equal(changedName.status, 409);
  assert.equal((await apply(state, input, value)).status, 200);
  const current = await intent(state, { operationId: input.operationId, recipeId: "campaign" });
  assert.equal((await state.call({ ...current, action: "preview" })).status, 409);
  const malformed = (await readEvents(state.env, state.stream)).slice(before);
  malformed[1].payload.operation.value = Infinity;
  assert.equal(contract.validateAtomicCanvasArrangementEvents(malformed, state.ownerId), "invalid_canvas_arrangement_authoring");
  assertFree(state); state.sqlite.close();
});

test("Canvas arrangement source guard includes current rights while excluding unrelated private provider history", async () => {
  const state = await fixture();
  append(state, [["GenerationRequested", { project_id: "unrelated-private-project", document_id: "unrelated-document",
    prompt: "unrelated private history ".repeat(100_000) }]]);
  const input = await intent(state), value = await preview(state, input), before = countEvents(state);
  assert.equal((await apply(state, input, value)).status, 200);
  assert.equal(countEvents(state) - before, 1 + 2 * state.selectedItemIds.length);
  const second = await intent(state, { recipeId: "campaign" }), secondPreview = await preview(state, second);
  append(state, [["RightsAsserted", { project_id: state.projectId, block_id: "arrangement-source-0", rights_basis: "withdrawn", rights_confirmed: false }]]);
  const changed = countEvents(state), denied = await apply(state, second, secondPreview);
  assert.equal(denied.status, 409, await denied.clone().text());
  assert.equal(countEvents(state), changed);
  assertFree(state); state.sqlite.close();
});

test("Canvas arrangement receipts remain readable under current read rights and Done survives preview erasure", async () => {
  const state = await fixture("editor"), input = await intent(state), value = await preview(state, input);
  assert.equal((await apply(state, input, value)).status, 200);
  const before = countEvents(state);
  state.sqlite.prepare("UPDATE project_memberships SET role='viewer' WHERE project_access_id=? AND user_id='arrangement-member'").run(state.projectAccessId);
  state.sqlite.prepare("UPDATE private_content SET content='',redacted_at=? WHERE content_id=?").run(new Date().toISOString(), value.previewId);
  const response = await state.call({ action: "retrieve", operationId: input.operationId, projectId: state.projectId, canvasId: state.canvasId });
  assert.equal(response.status, 200, await response.clone().text());
  const receipt = await response.json();
  assert.equal(receipt.status, "applied"); assert.equal(receipt.approvalHash, value.approvalHash);
  const done = await state.call({ action: "dismiss", operationId: input.operationId, projectId: state.projectId, canvasId: state.canvasId,
    previewId: receipt.previewId, approvalHash: receipt.approvalHash });
  assert.equal(done.status, 200, await done.clone().text()); assert.equal((await done.json()).dismissed, true);
  const next = await intent(state, { recipeId: "campaign" });
  assert.equal((await state.call({ ...next, action: "preview" })).status, 403);
  assert.equal(countEvents(state), before);
  assertFree(state); state.sqlite.close();
});

test("Canvas arrangement preserves an independent concurrent board/item/source change while committing none of its own events", async () => {
  for (const mode of ["personal", "selected"]) for (const changed of ["board", "item", "source"]) {
    const state = await fixture(mode), input = await intent(state), value = await preview(state, input), before = countEvents(state);
    state.controls.beforeAuthoringBatch = () => append(state, [[
      changed === "board" ? "CanvasRemoved" : changed === "item" ? "CanvasItemRemoved" : "BlockPropertyEdited",
      { project_id: state.projectId, canvas_id: state.canvasId, item_id: input.selectedItemIds[0],
        block_id: "arrangement-source-0", property_path: "text", new_value: "Independent concurrent edit" },
    ]]);
    const response = await apply(state, input, value);
    assert.ok(response.status >= 400, mode + "/" + changed + ": " + await response.clone().text());
    assert.equal(countEvents(state), before + 1);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE stream_id=? AND json_extract(payload,'$.history_action_id')=?").get(state.stream, input.operationId).n, 0);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM authoring_commits").get().n, 0);
    assertFree(state); state.sqlite.close();
  }
});

test("Canvas arrangement router preserves exact routing, method denial, origin and selected-scope authorization",async()=>{
 const state=await fixture(),input=await intent(state),path="/api/canvas/arrangements",before=countEvents(state);
 try{
  for(const method of["GET","HEAD","OPTIONS","PUT","PATCH","DELETE"]){const denied=await state.request(path,{method,headers:state.headers});assert.equal(denied.status,405,method);}
  const suffix=await state.request(path+"/unexpected",json({...input,action:"preview"},state.headers));assert.equal(suffix.status,404);assert.equal((await suffix.json()).error,"not_found");
  const cross=await state.request(path,json({...input,action:"preview"},{...state.headers,origin:"https://foreign.example"}));assert.equal(cross.status,403);assert.equal((await cross.json()).error,"same_origin_required");
  const revoked=await state.request(path,json({...input,action:"preview"},{...state.headers,cookie:"forma_project_context=missing-router-context"}));assert.equal(revoked.status,403);assert.equal((await revoked.json()).error,"project_access_revoked");
  assert.equal(countEvents(state),before,"routing and authorization denial cannot arrange");assertFree(state);
  const accepted=await state.call({...input,action:"preview"});assert.equal(accepted.status,200,await accepted.clone().text());
  assert.equal(accepted.headers.get("x-content-type-options"),"nosniff");assert.match(accepted.headers.get("server-timing"),/app;dur=/u);assert.equal((await accepted.json()).status,"review");
 }finally{state.sqlite.close();}
});
