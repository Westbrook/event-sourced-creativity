import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";

const root = new URL("../../", import.meta.url).href;
const resolution = registerHooks({ resolve(specifier, context, nextResolve) {
  const local = context.parentURL?.startsWith(root) && !context.parentURL.includes("/node_modules/");
  return nextResolve(local && specifier.startsWith(".") && !/\.[a-z0-9]+$/iu.test(specifier) ? specifier + ".ts" : specifier, context);
} });
const [{ default: worker }, { handleCanvasArrangements }, { foldEvents }, { foldCanvasEvents }, { outcomeArrangementRevisions },
  { readEvents }, { requireUser }, { readProjectRequestContext, readProjectEventPage }, contract] = await Promise.all([
  import("../../worker/index.ts"), import("../../worker/canvas-arrangements.ts"), import("../../src/model/events.ts"),
  import("../../src/canvas/model.ts"), import("../../src/canvas/outcome-arrangements.ts"),
  import("../../worker/runtime.ts"), import("../../worker/pilot-policy.ts"), import("../../worker/project-access.ts"),
  import("../../worker/canvas-arrangement-contract.ts"),
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
  state.call = (body) => handleCanvasArrangements(new Request("http://localhost/api/canvas/arrangements", json(body, state.headers)), state.env);
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

export { fixture, projections, append, countEvents, assertFree, frames, contract, intent, preview, apply };
