// Full current Activity/IssuePanel/Store/Worker with existing deterministic native ports.
// No replacement producer, financial authority, browser, or provider behavior.
import fs from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { createRequire, registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { sceneDeferred } from "./scene-cost-store-host.mjs";
import { enforceD1ExpressionDepth } from "./d1-expression-depth.mjs";
const root = fileURLToPath(new URL("../../", import.meta.url)).replace(/\/$/u, "");
// Reuse all current fixture declarations, not old registered tests. Only test
// registrations are removed and exports added; no production method is changed.
const ts = createRequire(root + "/package.json")("typescript");
const path = root + "/tests/artifact-noop-save.test.mjs";
const raw = fs.readFileSync(path, "utf8");
const tree = ts.createSourceFile(path, raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const registered = statement => ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression)
  && ["test", "test.after"].includes(statement.expression.expression.getText(tree));
const source = tree.statements.filter(statement => !registered(statement) && !ts.isForOfStatement(statement))
  .map(statement => statement.getFullText(tree)).join("\n")
  + "\nexport {activitySetup,holdEditReply,native,finishNoopFixture};";
assert.equal(ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS).parseDiagnostics.length, 0);
const virtual = pathToFileURL(path).href + "?r4-actual-parent-read-regroup-proof";
const hook = registerHooks({ load(url, context, next) {
  return url === virtual ? { format: "module", source, shortCircuit: true } : next(url, context);
} });
let activitySetup, holdEditReply, native, finishNoopFixture;
try { ({ activitySetup, holdEditReply, native, finishNoopFixture } = await import(virtual)); }
finally { hook.deregister(); }
test.after(() => assert.equal(finishNoopFixture(), 0, "zero external/provider requests"));
const { FormaActivity } = await native.loadActual("src/components/forma-activity.ts");
const { FormaActivityIssuePanel } = await native.loadActual("src/components/forma-activity-issue-panel.ts");
const tick = () => new Promise(setImmediate);
const financialTables = ["document_jobs", "budget_reservations", "cost_budget_reservations", "cost_budget_counters"];
const aText = "Submitted actual Activity correction A.";
const bText = "Newer unsaved Activity correction B.";



export { activitySetup, holdEditReply, native, FormaActivity, FormaActivityIssuePanel, tick, financialTables, aText, bText, sceneDeferred };

export const correctionGroupProof = { fixtures: 0, queries: new Set(), maximumBindings: 0 };
test.after(() => console.log(JSON.stringify({ evidence: "correction-group-native-SQL", fixtures: correctionGroupProof.fixtures,
  depth: 100, queryShapes: correctionGroupProof.queries.size, maximumBindings: correctionGroupProof.maximumBindings })));

export async function correctionParent(t, { locale = "en" } = {}) {
  const p = await activitySetup(t), { h, state } = p;
  p.f.host.disconnectedCallback(); p.f.host.isConnected = false;
  const f = native.fixture("create", { artifact: true, locale });
  f.host.disconnectedCallback(); f.host.isConnected = false; f.store = h.store;
  f.host = new FormaActivity(); f.host.store = h.store; f.host.i18n = f.i18n;
  f.host.tag = "forma-activity"; f.host.isConnected = true;
  f.renderer.registry["forma-activity-issue-panel"] = FormaActivityIssuePanel;
  h.store.route.set("/activity?document=" + state.documentId);
  const originalHistory = globalThis.history;
  const navigate = value => {
    const url = new URL(String(value), h.location.origin);
    Object.assign(h.location, { pathname: url.pathname, search: url.search, hash: url.hash });
  };
  // Only the existing native history/location transport, never Store routing.
  globalThis.history = { state: null,
    pushState(_state, _unused, value) { navigate(value); },
    replaceState(_state, _unused, value) { navigate(value); } };
  const originalDispatch = h.window.dispatchEvent;
  h.window.dispatchEvent = function(event) {
    const result = originalDispatch.call(this, event);
    for (const listener of [...(f.listeners.get(event.type) ?? [])]) listener(event);
    return result;
  };
  const proof = enforceD1ExpressionDepth({ env: state.env, sqlite: state.sqlite }), originalClose = state.close;
  state.close = () => {
    proof.assertVerified(); correctionGroupProof.fixtures++;
    for (const row of proof.records) correctionGroupProof.queries.add(row.sql);
    correctionGroupProof.maximumBindings = Math.max(correctionGroupProof.maximumBindings, ...state.controls.bindings);
    proof.restore(); originalClose();
  };
  await h.store.syncProjectNotifications();
  const finance = () => Object.fromEntries(financialTables.map(table => [table, state.sqlite.prepare("SELECT * FROM " + table + " ORDER BY rowid").all()]));
  const originalFinance = finance();
  const fixedEvents = () => state.sqlite.prepare("SELECT * FROM events WHERE type!='DocumentArtifactEdited' ORDER BY stream_id,sequence").all();
  const originalFixedEvents = fixedEvents();
  // Original fixture cleanup owns the real Store/Worker close. Check these
  // additional invariants immediately before that same close, never afterwards.
  const checkedClose = state.close;
  state.close = () => { assert.deepEqual(finance(), originalFinance); assert.deepEqual(fixedEvents(), originalFixedEvents); checkedClose(); };
  const draw = () => f.draw();
  const panel = (id = p.ids[0]) => [...f.renderer.instances.values()].map(row => row.instance)
    .find(instance => instance.isConnected && instance.tag === "forma-activity-issue-panel" && instance.notification?.id === id);
  const own = (tag, id = p.ids[0]) => f.renderer.ownNodes(panel(id), tag);
  const editor = (id = p.ids[0]) => own("textarea", id).find(node => node.attributes.rows === "8");
  const field = (name = "markdown", id = p.ids[0]) => name === "markdown" ? editor(id)
    : own(name === "title" ? "input" : "textarea", id).find(node => node.handlers.input?.toString().includes("item." + name));
  const click = node => {
    assert.ok(node?.isConnected && f.renderer.nodes.includes(node), "only a current connected control");
    assert.equal(Object.hasOwn(node.attributes, "disabled"), false); node.click();
  };
  const start = (id = p.ids[0]) => click(own("button", id).find(node => node.handlers.click?.toString().includes("#startCorrection")));
  const open = async (id = p.ids[0]) => {
    start(id);
    for (let turn = 0; turn < 60 && !editor(id); turn++) { await tick(); draw(); }
    assert.ok(editor(id), "a real current correction editor opens"); return panel(id);
  };
  const type = (value, name = "markdown", id = p.ids[0]) => {
    const node = field(name, id); assert.ok(node?.isConnected && f.renderer.nodes.includes(node));
    assert.equal(Object.hasOwn(node.attributes, "disabled"), false); assert.equal(Object.hasOwn(node.attributes, "readonly"), false);
    node.value = value; node.handlers.input.call(panel(id), { target: node, currentTarget: node }); draw();
  };
  const save = (id = p.ids[0]) => {
    const form = own("form", id).find(node => node.handlers.submit?.toString().includes("#saveCorrection"));
    const button = own("button", id).find(node => node.attributes.type === "submit");
    assert.ok(form?.isConnected && f.renderer.nodes.includes(form)); assert.ok(button?.isConnected);
    assert.equal(Object.hasOwn(button.attributes, "disabled"), false);
    form.handlers.submit.call(panel(id), { target: form, currentTarget: form, preventDefault() {} });
  };
  const cancel = (id = p.ids[0]) => {
    click(own("button", id).find(node => node.handlers.click?.toString().includes('this.#editingArtifactId = ""'))); draw();
  };
  const markButton = (id = p.ids[0]) => {
    const child = f.renderer.ownNodes(f.host, "forma-activity-issue-panel").find(node => node.properties.notification?.id === id);
    if (!child) return null;
    const at = f.renderer.markup.indexOf(child.full), from = f.renderer.markup.lastIndexOf("<article", at), to = f.renderer.markup.indexOf("</article>", at);
    return f.renderer.ownNodes(f.host, "button").find(node => {
      if (!node.handlers.click?.toString().includes("acknowledgeProjectNotification")) return false;
      const index = f.renderer.markup.indexOf(node.full, from); return index >= from && index < to;
    }) ?? null;
  };
  const mark = async (id = p.ids[0], fromAnotherTab = false) => {
    if (fromAnotherTab) {
      const response = await state.request("/api/project-notifications", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ notificationId: id }) });
      assert.equal(response.status, 200); assert.equal(typeof (await response.json()).readAt, "string");
    } else {
      const index = p.acknowledgments.length; click(markButton(id)); assert.equal(p.acknowledgments[index].id, id);
      assert.equal(await p.acknowledgments[index].pending, true);
    }
    const start = h.requests.length; await h.store.syncProjectNotifications();
    assert.equal(h.requests.slice(start).filter(row => row.url === "/api/project-notifications" && (row.init.method ?? "GET") === "GET").length, 1);
    draw();
    const actual = state.sqlite.prepare("SELECT read_at FROM project_notifications WHERE notification_id=?").get(id).read_at;
    assert.equal(h.store.projectNotifications.get().find(row => row.id === id)?.readAt, actual, "the complete server readAt is not delayed or falsified");
    assert.equal(typeof actual, "string"); return actual;
  };
  const groups = () => [...f.renderer.instances.values()].map(row => row.instance)
    .filter(instance => instance.isConnected && instance.tag === "forma-activity-issue-panel" && instance.notification)
    .map(instance => ({ id: instance.notification.id, group: instance.getAttribute("data-activity-notification-group") }));
  const assertGroups = (needs, recent) => {
    const rows = groups(); assert.equal(new Set(rows.map(row => row.id)).size, rows.length, "one current row per notification");
    assert.deepEqual(rows.filter(row => row.group === "needs-you").map(row => row.id).sort(), [...needs].sort());
    assert.deepEqual(rows.filter(row => row.group === "recent").map(row => row.id).sort(), [...recent].sort());
    if (needs.length) {
      const heading = f.i18n.t("activity.needsYou", "Needs you"), marker = "<h2>" + heading + "</h2><span>" + needs.length + "</span>";
      assert.ok(f.renderer.markup.includes(marker), "the visible Needs-you count equals its current rows");
    }
  };
  const finish = async (index = 0) => {
    const result = await p.calls[index].pending; await tick();
    for (const row of p.acknowledgments) await row.pending;
    draw(); return result;
  };
  t.after(() => {
    for (const row of f.renderer.instances.values()) if (row.instance.isConnected) { row.instance.isConnected = false; row.instance.disconnectedCallback(); }
    f.host.isConnected = false; f.host.disconnectedCallback(); h.window.dispatchEvent = originalDispatch;
    if (originalHistory === undefined) delete globalThis.history; else globalThis.history = originalHistory;
  });
  draw();
  return { ...p, f, draw, panel, own, editor, field, click, start, open, type, save, cancel, markButton, mark, groups, assertGroups, finish };
}
