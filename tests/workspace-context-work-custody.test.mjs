// Complete current Shell/Workspace/ContextBlock and original Store/RAM Worker.
// Adopted image/story properties below are explicit synthetic source fixtures,
// not generated media. Native ports are functional evidence, not browser/IME QA.
import assert from "node:assert/strict";
import test from "node:test";
import { createSceneCostFixture } from "./helpers/scene-cost-fixture.mjs";
import { createSceneStoreHost, sceneDeferred } from "./helpers/scene-cost-store-host.mjs";
import { createCalmFullPage, registerCalmFullPageComponents, calmFullPageNativePorts as ports } from "./helpers/calm-full-page-fixture.mjs";
import { installOutputNavigationFocusNative } from "./helpers/output-navigation-focus-native.mjs";
import { observeActualSceneResumeReads } from "./helpers/actual-scene-resume-read.mjs";
import { financial } from "./helpers/event-source-retirement-fixture.mjs";
import { appendAuditEvent, readWorkspaceEvents } from "../worker/runtime.ts";
import { withDocumentInRoute, withProjectTaskDocumentInRoute } from "../src/model/routes.ts";
import { outputInputDraft } from "../src/model/output-authoring.ts";

const OPTIONS = { concurrency: false, timeout: 45_000 };
const BLOCK = "scene-reuse-direction";
const RAW = "  A current unsent context revision — 文書\nسؤال جديد  ";
const classed = (node, value) => String(node?.attributes?.class ?? "").split(/\s+/u).includes(value);
const inside = (node, parent) => { for (let at = node; at; at = at.parent) if (at === parent) return true; return false; };
const dialogs = f => f.tree().visible("dialog").filter(node => node.port?.open);

async function settle(x, count = 8) {
  for (let attempt = 0; attempt < count; attempt++) {
    await x.f.settle();
    for (const [id, timer] of [...x.h.timers]) if (timer.delay === 16) { x.h.timers.delete(id); timer.callback(0); }
    await x.resume.settleOriginalRequests(); await new Promise(setImmediate);
  }
  await x.f.settle(); await x.worker.drainBackground();
}
async function reached(x, predicate, label) {
  for (let attempt = 0; attempt < 32; attempt++) { await settle(x, 1); if (predicate()) return; }
  assert.ok(predicate(), label);
}
async function page(t, kind = "text") {
  t.mock.method(globalThis, "fetch", async () => assert.fail("No external/provider transport in context custody"));
  const worker = await createSceneCostFixture(1, "visual");
  const properties = kind === "structured" ? {
    source_artifact_id: "context-custody-saved-story", source_artifact_kind: "short_story",
    label: "Original story title", text: "Original manuscript", artifact_markdown: "Original manuscript",
    artifact_summary: "Original structured summary", artifact_structure: { items: [] },
  } : kind === "image" ? { source_output_id: "context-custody-image", label: "Original image title",
    text: "Original image direction", image_caption: "Original image title", output_palette: ["#123456", "#abcdef"], palette: ["#123456", "#abcdef"] } : {};
  for (const [property, value] of Object.entries(properties)) await appendAuditEvent(worker.env, worker.streamId,
    "user:" + worker.owner, "BlockPropertyEdited", { project_id: worker.projectId, document_id: worker.documentId,
      block_id: BLOCK, property_path: property, new_value: value });
  const h = await createSceneStoreHost({ workerFixture: worker, exposeSceneTestAccessors: false });
  h.store.loading.set(false);
  const original = { events: h.store.events.get(), head: h.store.head.get(), content: h.store.content.get() };
  const resume = observeActualSceneResumeReads(h); t.after(() => resume.restore());
  const previousHistory = globalThis.history;
  globalThis.history = { pushState(_state, _title, route) { const url = new URL(route, "http://localhost");
    Object.assign(h.location, { pathname: url.pathname, search: url.search, hash: url.hash }); },
  replaceState(...args) { this.pushState(...args); } };
  t.after(() => { globalThis.history = previousHistory; });
  const f = await createCalmFullPage(t, { storeHost: h, locale: "en", assistant: false });
  // Restore the actual Worker Source, not the helper's fourteen-block study.
  h.store.events.set(original.events); h.store.head.set(original.head); h.store.content.set(original.content);
  const projection = h.store.projection.get();
  h.store.setRoute(withDocumentInRoute("/", worker.documentId, projection.documentTitle));
  await registerCalmFullPageComponents(f, ["forma-workspace", "forma-activity"]);
  f.nativeHistoryLocation = h.location; f.native = installOutputNavigationFocusNative(t, f, ports);
  const x = { f, h, worker, resume, kind };
  await settle(x);
  x.workspace = f.components().find(owner => owner.tag === "forma-workspace");
  x.block = f.components().find(owner => owner.tag === "forma-context-block" && owner.block?.id === BLOCK);
  assert.ok(x.workspace?.isConnected && x.block?.isConnected);
  assert.equal(x.workspace.store, h.store); assert.equal(x.block.store, h.store);
  assert.equal(x.block.block.documentId, worker.documentId); assert.equal(x.block.block.projectId, worker.projectId);
  assert.equal(h.store.projection.get().documentId, worker.documentId);
  assert.ok(h.store.projection.get().blocks.some(block => block.id === BLOCK && !block.locked));
  assert.equal(f.find("textarea", node => node.owner === x.workspace && node.attributes.id === "creative-command").port.value, "");
  assert.equal(resume.pendingOriginalCount(), 0);
  const requests = h.requests.length; await settle(x, 2); assert.equal(h.requests.length, requests, "Original setup reads are settled before a new gesture");
  return x;
}
async function controls(x, open) {
  const { f, block } = x;
  if (f.store.ui.focusBlockId !== BLOCK) await f.act(f.find("input", node => node.owner === block && node.attributes.type === "radio"), "change");
  const toggle = f.find("button", node => node.owner === block && classed(node, "context-controls-toggle"));
  if (toggle.attributes["aria-expanded"] !== String(open)) await f.act(toggle, "click", { button: 0 });
  assert.equal(f.find("button", node => node.owner === block && classed(node, "context-controls-toggle")).attributes["aria-expanded"], String(open));
  assert.ok(block.isConnected); await settle(x, 1);
}
async function typeText(x, raw) {
  const field = x.f.find("textarea", node => node.owner === x.block && node.attributes.id === "block-copy-" + BLOCK);
  assert.equal(field.port.matches(":disabled"), false); field.port.value = raw; await x.f.act(field, "input");
  assert.equal(x.f.find("textarea", node => node.owner === x.block && node.attributes.id === "block-copy-" + BLOCK).port.value, raw);
}
const structured = x => {
  const owners = x.f.components().filter(owner => owner.tag === "forma-output-input-editor" && owner.block?.id === BLOCK);
  assert.equal(owners.length, 1); return owners[0];
};
async function typeSummary(x, raw) {
  const editor = structured(x), field = x.f.find("textarea", node => node.owner === editor);
  assert.equal(field.port.matches(":disabled"), false); field.port.value = raw; await x.f.act(field, "input");
  assert.equal(editor.draft.summary, raw); return editor;
}
async function cancel(x) {
  await controls(x, true);
  const tree = x.f.tree(), forms = tree.visible("form").filter(node => node.owner === x.block && classed(node, "block-editor"));
  assert.equal(forms.length, 1);
  const buttons = tree.visible("button").filter(node => node.owner === x.block && inside(node, forms[0]) && node.text === x.f.i18n.system("Cancel"));
  assert.equal(buttons.length, 1); await x.f.act(buttons[0], "click", { button: 0 }); await settle(x);
}
const receipts = worker => worker.sqlite.prepare("SELECT * FROM event_client_receipts ORDER BY stream_id,client_event_id").all();
async function before(x) {
  await settle(x);
  return { route: x.h.store.route.get(), events: JSON.stringify(x.h.store.events.get()), head: x.h.store.head.get(),
    session: JSON.stringify(x.h.store.session.get()), source: x.h.store.captureSourceOwnership(), authorization: x.h.store.captureAuthorizationScope(),
    history: await readWorkspaceEvents(x.worker.env, x.worker.streamId), receipts: receipts(x.worker), money: financial(x.worker), requests: x.h.requests.length };
}
async function unchanged(x, original, { refusal = false } = {}) {
  await settle(x);
  assert.deepEqual(await readWorkspaceEvents(x.worker.env, x.worker.streamId), original.history);
  assert.deepEqual(receipts(x.worker), original.receipts); assert.deepEqual(financial(x.worker), original.money);
  assert.equal(JSON.stringify(x.h.store.events.get()), original.events); assert.equal(x.h.store.head.get(), original.head);
  assert.equal(JSON.stringify(x.h.store.session.get()), original.session);
  assert.ok(x.h.store.sourceOwnershipActive(original.source) && x.h.store.authorizationScopeActive(original.authorization));
  const requests = x.h.requests.slice(original.requests);
  assert.deepEqual(requests.filter(row => (row.init.method ?? "GET") !== "GET" && !x.resume.isReadOnlyResume(row)), [],
    "No attributable authoring, approval or paid request; only the separately certified actual original Resume read may use POST");
  if (refusal) assert.equal(requests.length, 0, "Refusal starts no attributable destination transport");
  assert.equal(x.resume.pendingOriginalCount(), 0);
}
async function command(x) {
  const { f } = x, trigger = f.find("button", node => node.owner === f.host && classed(node, "command-trigger"));
  f.native.emit("pointerdown", trigger.port); f.native.focus(trigger.port); await f.act(trigger, "click", { button: 0 });
  const label = f.i18n.t("command.openNavigation", "Open {name}", { name: f.i18n.t("shell.navigation.activity", "Activity") });
  const search = f.find("input", node => node.owner === f.host && node.attributes.id === "command-search");
  search.port.value = label; await f.act(search, "input");
  const tree = f.tree(), menus = tree.visible("dialog").filter(node => node.owner === f.host && classed(node, "command-dialog") && node.port.open);
  assert.equal(menus.length, 1);
  const choices = tree.visible("button").filter(node => node.owner === f.host && inside(node, menus[0]) && node.attributes.role === "option"
    && node.children.some(child => typeof child !== "string" && child.tag === "span" && child.text === label));
  assert.equal(choices.length, 1); assert.ok(choices[0].port.isConnected); assert.equal(choices[0].port.matches(":disabled"), false);
  f.native.emit("pointerdown", choices[0].port); f.native.focus(choices[0].port);
  const focusStart = f.native.nativeFocus.length; await f.act(choices[0], "click", { button: 0 }); await settle(x);
  return focusStart;
}
async function card(x) {
  const tree = x.f.tree(), groups = tree.visible("aside").filter(node => node.owner === x.workspace && classed(node, "exact-next-actions"));
  assert.equal(groups.length, 1);
  const buttons = tree.visible("button").filter(node => inside(node, groups[0]) && node.attributes["data-choice-value"] === "configure-output");
  assert.equal(buttons.length, 1); assert.ok(buttons[0].port.isConnected); assert.equal(buttons[0].port.matches(":disabled"), false);
  x.f.native.emit("pointerdown", buttons[0].port); x.f.native.focus(buttons[0].port);
  const focusStart = x.f.native.nativeFocus.length; await x.f.act(buttons[0], "click", { button: 0 }); await settle(x);
  return focusStart;
}
function refused(t, x, original, path, focusStart) {
  t.diagnostic("WORKSPACE_CONTEXT_CUSTODY " + JSON.stringify({ kind: x.kind, path, route: x.h.store.route.get(), expectedRoute: original.route,
    sameWorkspace: x.workspace.isConnected, sameBlock: x.block.isConnected, dialogs: dialogs(x.f).map(node => node.attributes.class),
    laterFocusOwners: x.f.native.nativeFocus.slice(focusStart).map(row => row.node.owner?.tag ?? null),
    evidence: "actual mounted controls/Store/RAM Worker; finite native ports, not physical browser or IME certification" }));
  assert.equal(x.h.store.route.get(), original.route, "A shared child draft owns both command and rendered next-step admission");
  assert.ok(x.workspace.isConnected && x.block.isConnected); assert.ok(x.f.components().includes(x.block));
  assert.equal(dialogs(x.f).length, 0, "No competing destination or replacement modal is promoted");
  assert.equal(x.h.store.ui.toast, x.f.i18n.t("next.lifecycle.currentWorkOpen"));
  assert.equal(x.f.native.nativeFocus.slice(focusStart).some(row => row.node.owner?.tag === "forma-activity"), false);
}
function departed(x, original) {
  assert.equal(x.h.store.route.get(), withProjectTaskDocumentInRoute("/activity", x.worker.documentId, original.route));
  assert.equal(x.workspace.isConnected, false); assert.ok(x.f.components().some(owner => owner.tag === "forma-activity" && owner.isConnected));
  assert.equal(dialogs(x.f).length, 0);
}

test("Workspace context custody / pristine nonempty inline context does not block a command", OPTIONS, async t => {
  const x = await page(t); await controls(x, true);
  const originalText = String(x.block.block.properties.text);
  assert.ok(originalText.length > 0);
  assert.equal(x.f.find("textarea", node => node.owner === x.block && node.attributes.id === "block-copy-" + BLOCK).port.value, originalText);
  const original = await before(x); await command(x); departed(x, original); await unchanged(x, original);
});

test("Workspace context custody / inline raw text protects rendered next step and Cancel permits a fresh card", OPTIONS, async t => {
  const x = await page(t); await controls(x, true); await typeText(x, RAW);
  const original = await before(x), focus = await card(x); refused(t, x, original, "card", focus); await unchanged(x, original, { refusal: true });
  assert.equal(x.f.find("textarea", node => node.owner === x.block && node.attributes.id === "block-copy-" + BLOCK).port.value, RAW);
  await cancel(x); const resolved = await before(x); await card(x);
  assert.ok(x.workspace.isConnected); assert.equal(x.h.store.route.get(), resolved.route);
  const opened = dialogs(x.f); assert.equal(opened.length, 1); assert.ok(classed(opened[0], "next-format-dialog"));
  await unchanged(x, resolved);
});

test("Workspace context custody / hidden raw text protects command and explicit Cancel permits departure", OPTIONS, async t => {
  const x = await page(t); await controls(x, true); await typeText(x, RAW); await controls(x, false);
  assert.ok(x.f.tree().visible("small").some(node => node.owner === x.block && classed(node, "context-draft-note")));
  const original = await before(x), focus = await command(x); refused(t, x, original, "hidden-command", focus); await unchanged(x, original, { refusal: true });
  await controls(x, true); assert.equal(x.f.find("textarea", node => node.owner === x.block && node.attributes.id === "block-copy-" + BLOCK).port.value, RAW);
  await cancel(x); const resolved = await before(x); await command(x); departed(x, resolved); await unchanged(x, resolved);
});

test("Workspace context custody / image palette raw edit protects the rendered next step", OPTIONS, async t => {
  const x = await page(t, "image"); await controls(x, true);
  const field = x.f.find("input", node => node.owner === x.block && node.properties.value === "#123456" && typeof node.handlers.input === "function");
  field.port.value = "  #445566  "; await x.f.act(field, "input");
  const original = await before(x), focus = await card(x); refused(t, x, original, "image-card", focus); await unchanged(x, original, { refusal: true });
  assert.equal(x.f.find("input", node => node.owner === x.block && node.properties.value === "  #445566  ").port.value, "  #445566  ");
});

test("Workspace context custody / retained structured child protects a command after controls close", OPTIONS, async t => {
  const x = await page(t, "structured"); await controls(x, true); const editor = await typeSummary(x, RAW);
  await controls(x, false); assert.equal(editor.draft.summary, RAW);
  const original = await before(x), focus = await command(x); refused(t, x, original, "structured-hidden-command", focus); await unchanged(x, original, { refusal: true });
  await controls(x, true); assert.equal(structured(x), editor); assert.equal(editor.draft.summary, RAW);
});

test("Workspace context custody / closed structured pending save blocks even when the newer draft equals current Source", OPTIONS, async t => {
  const x = await page(t, "structured"); await controls(x, true);
  const editor = structured(x), originalDraft = outputInputDraft(x.block.block); assert.ok(originalDraft);
  const submittedSummary = "  Exact submitted structured B  "; await typeSummary(x, submittedSummary);
  const release = sceneDeferred(), originalFetch = x.h.intercept, writes = []; let held = false;
  x.h.intercept = async request => {
    if (request.url !== "/api/events" || request.init.method !== "POST") return originalFetch?.(request);
    const inputs = request.body?.events ?? [request.body?.event];
    assert.ok(inputs.length > 0 && inputs.every(input => input?.payload?.block_id === BLOCK));
    const response = await x.worker.request(request.url, request.init), body = await response.clone().json();
    assert.equal(response.status, 200); assert.ok(Array.isArray(body.appended) && body.appended.length > 0);
    assert.ok(body.appended.some(event => event.payload.property_path === "artifact_summary" && event.payload.new_value === submittedSummary));
    writes.push({ request, body }); held = true; await release.promise; return response;
  };
  try {
    const form = x.f.find("form", node => node.owner === x.block && classed(node, "block-editor"));
    await x.f.act(form, "submit"); await reached(x, () => held, "The original real Worker response is held after its actual write");
    assert.equal(writes.length, 1);
    // Current source is still A while the original exact B response is held.
    // Edit back to A: only the real pending owner, not raw inequality, can block.
    await typeSummary(x, originalDraft.summary); assert.deepEqual(editor.draft, originalDraft);
    assert.deepEqual(outputInputDraft(x.block.block), originalDraft);
    await controls(x, false); assert.deepEqual(editor.draft, originalDraft);
    const original = await before(x), focus = await command(x); refused(t, x, original, "closed-pending-command", focus);
    await unchanged(x, original, { refusal: true }); assert.equal(writes.length, 1);
    release.resolve(); await reached(x, () => x.h.store.projection.get().blocks.find(block => block.id === BLOCK)?.properties.artifact_summary === submittedSummary,
      "Only delivery of the same genuine response publishes the exact original B");
    await controls(x, true); assert.equal(structured(x), editor); assert.deepEqual(editor.draft, originalDraft, "The late original response does not reset newer A-shaped raw work");
    await cancel(x); const resolved = await before(x); await command(x); departed(x, resolved); await unchanged(x, resolved); assert.equal(writes.length, 1);
  } finally { release.resolve(); x.h.intercept = originalFetch; await settle(x); }
});

// Two separate post-Cancel controls. Only the same original free Worker Save
// responses are held; no private pending field or permission is replaced.
function postCancelForm(x, pending) {
  const tree = x.f.tree(), forms = tree.visible("form").filter(node => node.owner === x.block && classed(node, "block-editor"));
  assert.equal(forms.length, 1); const form = forms[0];
  assert.ok(form.port.isConnected && x.f.renderer.nodes.includes(form.port)); assert.equal(typeof form.handlers.submit, "function");
  const buttons = tree.visible("button").filter(node => node.owner === x.block && inside(node, form));
  const saves = buttons.filter(node => node.attributes.type === "submit"), cancels = buttons.filter(node => node.attributes.type === "button");
  assert.equal(saves.length, 1); assert.equal(cancels.length, 1);
  assert.equal(saves[0].text, x.f.i18n.system("Save input")); assert.equal(saves[0].port.matches(":disabled"), pending);
  assert.equal(cancels[0].port.matches(":disabled"), false);
  const cancelLabel = pending ? x.f.i18n.t("context.controls.discardLocal", "Discard local edits") : x.f.i18n.system("Cancel");
  const help = pending ? x.f.i18n.t("context.controls.saveRequestedHelp", "A save was already requested and may still finish. Discarding these local edits does not cancel it.") : x.f.i18n.t("context.controls.shortcut", "⌘/Ctrl + Enter to save · Esc to close controls");
  assert.equal(cancels[0].text, cancelLabel);
  const hints = tree.visible("small").filter(node => node.owner === x.block && inside(node, form));
  assert.equal(hints.length, 1); assert.equal(hints[0].text, help);
  return { form, save: saves[0], cancel: cancels[0] };
}
async function postCancelSubmit(x) {
  const current = postCancelForm(x, false);
  x.f.native.emit("pointerdown", current.save.port); x.f.native.focus(current.save.port);
  // The finite port dispatches the actual current form's submit listener;
  // it does not invent a browser default click or invoke a private Save method.
  await x.f.act(current.form, "submit"); await settle(x, 1); postCancelForm(x, true);
}
async function postCancelDiscard(x) {
  const current = postCancelForm(x, true);
  x.f.native.emit("pointerdown", current.cancel.port); x.f.native.focus(current.cancel.port);
  await x.f.act(current.cancel, "click", { button: 0 }); await settle(x);
  assert.equal(x.f.tree().visible("form").filter(node => node.owner === x.block && classed(node, "block-editor")).length, 0);
}
async function postCancelImageValue(x, from, value) {
  const field = x.f.find("input", node => node.owner === x.block && node.properties.value === from && typeof node.handlers.input === "function");
  assert.equal(field.port.matches(":disabled"), false);
  x.f.native.emit("pointerdown", field.port); x.f.native.focus(field.port); field.port.value = value;
  await x.f.act(field, "input"); await settle(x, 1);
  assert.equal(x.f.find("input", node => node.owner === x.block && node.properties.value === value).port.value, value);
}
function postCancelOriginals(x, initial, expected) {
  const prior = x.h.intercept, gates = expected.map(() => sceneDeferred()), records = [];
  x.h.intercept = request => {
    if (request.url !== "/api/events" || request.init.method !== "POST") return prior?.(request);
    const index = records.length, wanted = expected[index]; assert.ok(wanted, "Only the deliberately submitted original A/B may write");
    const record = { request, bytes: request.init.body, ready: false, returned: false, error: null, response: null, body: null, receiptRows: null };
    records.push(record);
    record.pending = (async () => {
      assert.ok(x.h.store.sourceOwnershipActive(initial.source) && x.h.store.authorizationScopeActive(initial.authorization));
      assert.equal(JSON.stringify(x.h.store.session.get()), initial.session);
      const input = request.body, events = input.events;
      assert.deepEqual(Object.keys(input).sort(), ["action", "clientId", "event", "events", "expectedSequence"]);
      assert.ok(Array.isArray(events) && events.length > 0); assert.deepEqual(input.event, events[0]);
      assert.equal(input.action, events.length > 1 ? "batch" : "append"); assert.equal(input.clientId, "web:lit");
      assert.ok(events.every(event => event.type === "BlockPropertyEdited" && event.payload.block_id === BLOCK
        && event.payload.source_surface === wanted.source));
      const selected = events.filter(event => event.payload.property_path === wanted.property);
      assert.equal(selected.length, 1); assert.deepEqual(selected[0].payload.new_value, wanted.value);
      if (wanted.properties) assert.deepEqual(events.map(event => event.payload.property_path).sort(), [...wanted.properties].sort());
      const history = [...initial.history, ...records.slice(0, index).flatMap(value => value.body.appended)];
      assert.deepEqual(await readWorkspaceEvents(x.worker.env, x.worker.streamId), history);
      assert.equal(input.expectedSequence, history.at(-1).sequence);
      const response = await x.worker.request(request.url, request.init), body = await response.clone().json();
      assert.equal(response.status, 200); assert.deepEqual(Object.keys(body).sort(), ["appended", "head", "rejected"]);
      assert.deepEqual(body.rejected, []); assert.equal(body.appended.length, events.length);
      for (const [position, event] of body.appended.entries()) {
        assert.equal(event.type, events[position].type); assert.equal(event.sequence, input.expectedSequence + position + 1);
        for (const [key, value] of Object.entries(events[position].payload)) assert.deepEqual(event.payload[key], value);
      }
      assert.equal(body.head, body.appended.at(-1).sequence);
      assert.deepEqual(await readWorkspaceEvents(x.worker.env, x.worker.streamId), [...history, ...body.appended]);
      assert.deepEqual(financial(x.worker), initial.money);
      record.response = response; record.body = body; record.receiptRows = receipts(x.worker); record.ready = true;
      await gates[index].promise;
      assert.equal(response.bodyUsed, false); assert.equal(request.init.body, record.bytes); assert.equal(JSON.stringify(request.body), record.bytes);
      record.returned = true; return response;
    })();
    record.pending.catch(error => { record.error = error; }); return record.pending;
  };
  return {
    records,
    release(index) { gates[index].resolve(); },
    async wait(index) {
      await reached(x, () => Boolean(records[index]?.ready || records[index]?.error), "The same original Save reaches its genuine Worker commit");
      if (records[index].error) throw records[index].error; return records[index];
    },
    async exact(count) {
      await settle(x); assert.equal(records.length, count); assert.ok(records.every(record => record.ready));
      assert.deepEqual(await readWorkspaceEvents(x.worker.env, x.worker.streamId), [...initial.history, ...records.flatMap(record => record.body.appended)]);
      assert.deepEqual(receipts(x.worker), records.at(-1).receiptRows); assert.deepEqual(financial(x.worker), initial.money);
      assert.equal(JSON.stringify(x.h.store.session.get()), initial.session);
      assert.ok(x.h.store.sourceOwnershipActive(initial.source) && x.h.store.authorizationScopeActive(initial.authorization));
      assert.deepEqual(x.h.requests.slice(initial.requests).filter(request => (request.init.method ?? "GET") !== "GET"
        && !records.some(record => record.request === request && request.init.body === record.bytes) && !x.resume.isReadOnlyResume(request)), []);
      assert.equal(x.h.requests.filter(request => records.some(record => record.request === request)).length, count);
    },
    async close() {
      for (const gate of gates) gate.resolve();
      try {
        await Promise.allSettled(records.map(record => record.pending)); await settle(x);
        await Promise.allSettled(records.map(record => record.pending)); await settle(x);
      } finally { x.h.intercept = prior; }
    },
  };
}

test("Workspace context post-Cancel / fresh departure while original free Save remains pending", OPTIONS, async t => {
  const x = await page(t, "structured"); await controls(x, true);
  const originalDraft = outputInputDraft(x.block.block), summary = "Exact original free Save A";
  await typeSummary(x, summary); const initial = await before(x);
  const original = postCancelOriginals(x, initial, [{ property: "artifact_summary", value: summary, source: "document-output-input-editor" }]);
  try {
    await postCancelSubmit(x); const a = await original.wait(0);
    assert.equal(a.returned, false); assert.deepEqual(outputInputDraft(x.block.block), originalDraft);
    await postCancelDiscard(x); assert.equal(a.returned, false);
    const discarded = await before(x); await command(x); departed(x, discarded); await unchanged(x, discarded);
    assert.equal(a.returned, false, "Fresh deliberate departure neither cancels nor settles the original Save");
    const route = x.h.store.route.get(), focus = x.f.native.nativeFocus.length, scroll = x.f.native.nativeScroll.length;
    original.release(0);
    await reached(x, () => x.h.store.projection.get().blocks.find(block => block.id === BLOCK)?.properties.artifact_summary === summary,
      "Only the same genuine original response publishes A after departure");
    await original.exact(1);
    assert.equal(a.returned, true); assert.equal(x.h.store.route.get(), route);
    assert.equal(x.workspace.isConnected, false); assert.equal(x.block.isConnected, false);
    assert.equal(x.f.native.nativeFocus.length, focus); assert.equal(x.f.native.nativeScroll.length, scroll);
    assert.equal(dialogs(x.f).length, 0);
    assert.deepEqual(x.h.store.events.get(), [...JSON.parse(initial.events), ...a.body.appended]); assert.equal(x.h.store.head.get(), a.body.head);
    t.diagnostic(JSON.stringify({ kind: "Context-post-Cancel", path: "depart", originalSaves: 1, originalReturned: a.returned,
      route, appendedIds: a.body.appended.map(event => event.eventId), oldOwnerConnected: x.block.isConnected, lateFocusCalls: 0,
      evidence: "actual current controls, Store queue and original RAM Worker response; no physical focus or provider claim" }));
  } finally { await original.close(); }
});

test("Workspace context post-Cancel / old A response cannot clear newer B pending Save", OPTIONS, async t => {
  const x = await page(t, "image"); await controls(x, true);
  const title = "Exact image title A", palette = ["#445566", "#abcdef"];
  await postCancelImageValue(x, "Original image title", title); const initial = await before(x);
  const original = postCancelOriginals(x, initial, [
    { property: "label", value: title, source: "document-context-block", properties: ["label", "image_caption"] },
    { property: "output_palette", value: palette, source: "document-context-block", properties: ["output_palette", "palette"] },
  ]);
  try {
    await postCancelSubmit(x); const a = await original.wait(0); await postCancelDiscard(x);
    const reopen = x.f.find("button", node => node.owner === x.block && classed(node, "block-copy"));
    x.f.native.emit("pointerdown", reopen.port); x.f.native.focus(reopen.port); await x.f.act(reopen); await settle(x);
    await postCancelImageValue(x, "#123456", palette[0]); await postCancelSubmit(x);
    assert.equal(original.records.length, 1, "The real Store queue has not dispatched B through the held A");
    assert.equal(a.returned, false); postCancelForm(x, true);
    const focus = x.f.native.nativeFocus.length, scroll = x.f.native.nativeScroll.length;
    original.release(0); const b = await original.wait(1);
    assert.equal(a.returned, true); assert.equal(b.returned, false);
    assert.equal(x.h.store.projection.get().blocks.find(block => block.id === BLOCK)?.properties.label, title);
    postCancelForm(x, true);
    assert.equal(x.f.find("input", node => node.owner === x.block && node.properties.value === palette[0]).port.value, palette[0]);
    assert.equal(x.f.find("input", node => node.owner === x.block && node.properties.value === "Original image title").port.value, "Original image title");
    assert.equal(x.f.native.nativeFocus.length, focus); assert.equal(x.f.native.nativeScroll.length, scroll);
    assert.equal(x.h.store.route.get(), initial.route); assert.ok(x.workspace.isConnected && x.block.isConnected); assert.equal(dialogs(x.f).length, 0);
    await original.exact(2);
    assert.deepEqual(x.h.store.events.get(), [...JSON.parse(initial.events), ...a.body.appended]); assert.equal(x.h.store.head.get(), a.body.head);
    original.release(1);
    await reached(x, () => JSON.stringify(x.h.store.projection.get().blocks.find(block => block.id === BLOCK)?.properties.output_palette) === JSON.stringify(palette),
      "Only deliberate B's own original response publishes its separate palette");
    await original.exact(2);
    assert.equal(b.returned, true);
    assert.deepEqual(x.h.store.events.get(), [...JSON.parse(initial.events), ...a.body.appended, ...b.body.appended]); assert.equal(x.h.store.head.get(), b.body.head);
    assert.equal(x.h.store.projection.get().blocks.find(block => block.id === BLOCK)?.properties.label, title);
    assert.equal(x.f.tree().visible("form").filter(node => node.owner === x.block && classed(node, "block-editor")).length, 0);
    t.diagnostic(JSON.stringify({ kind: "Context-post-Cancel", path: "newer-pending-B", explicitSaves: 2,
      aIds: a.body.appended.map(event => event.eventId), bIds: b.body.appended.map(event => event.eventId),
      disjointProperties: original.records.map(record => record.body.appended.map(event => event.payload.property_path)),
      evidence: "actual enabled Save gestures and Store queue; pending B is observed via disabled native Save, raw fields and hint, never a private getter" }));
  } finally { await original.close(); }
});

// One current ContextBlock Kind change on the existing RAM direction. Unlike
// the blank Library/Guided choices, this handler immediately commits one event.
// Preserve that exact original write before testing emitted option identity.
test("Workspace context Kind / acknowledged catalog choice retains its emitted option identity", OPTIONS, async t => {
  const x = await page(t, "text"), { f, h, worker, block } = x;
  await controls(x, true);
  const { blockTypeDefinition } = await import("../src/model/block-types.ts");
  const initialBlock = structuredClone(block.block), catalog = blockTypeDefinition("direction").subtypes;
  assert.equal(initialBlock.id, BLOCK); assert.equal(initialBlock.type, "direction");
  assert.equal(initialBlock.documentId, worker.documentId); assert.equal(initialBlock.projectId, worker.projectId);
  assert.equal(initialBlock.properties.subtype, undefined, "The existing source has no explicit subtype; no extra seed is added");
  assert.equal(initialBlock.properties.text, "The keeper checks the harbor.");
  assert.equal(initialBlock.locked, false); assert.equal(block.readOnly, false); assert.equal(block.surface, "document");
  const originalValue = "Campaign goal", chosenValue = "Emotional outcome";
  assert.equal(catalog[0], originalValue); assert.ok(catalog.includes(chosenValue));
  const view = () => {
    const tree = f.tree(), forms = tree.visible("form").filter(node => node.owner === block && classed(node, "block-classifiers"));
    assert.equal(forms.length, 1); const form = forms[0];
    const labels = tree.visible("label").filter(node => node.owner === block && classed(node, "block-subtype") && inside(node, form));
    assert.equal(labels.length, 1); assert.equal(labels[0].children.filter(node => typeof node !== "string" && node.tag === "span")[0]?.text, f.i18n.system("Kind"));
    const selects = tree.visible("select").filter(node => node.owner === block && inside(node, labels[0]));
    assert.equal(selects.length, 1); const select = selects[0];
    assert.ok(form.port.isConnected && select.port.isConnected && f.renderer.nodes.includes(select.port));
    assert.equal(select.port.closest("forma-context-block"), block); assert.equal(block.closest("forma-shell"), f.host);
    assert.equal(select.port.matches(":disabled"), false); assert.equal(select.port.handlers.change, select.handlers.change);
    assert.equal(typeof select.handlers.change, "function"); assert.equal(select.attributes["aria-label"], f.i18n.system("{readableType} subtype", { readableType: f.i18n.system("Direction") }));
    const fields = tree.visible("textarea").filter(node => node.owner === block && node.attributes.id === "block-copy-" + BLOCK);
    assert.equal(fields.length, 1);
    const options = tree.nodes.filter(node => node.tag === "option" && node.owner === block && inside(node, select));
    return { select, field: fields[0], options, values: options.map(node => String(node.attributes.value ?? node.text)) };
  };
  const optionBinding = (current, value) => {
    const rows = current.options.filter(node => String(node.attributes.value ?? node.text) === value);
    assert.equal(rows.length, 1); const option = rows[0]; assert.ok(option.port.isConnected);
    // Same emitted AttributePart observation as the existing Guided/Library
    // controls. No native selectedIndex, selectedness or DOM lifetime is added.
    const token = option.port.full.match(/\svalue=(?:["'])?__bound_(\d+)__(?:["'])?(?=[\s>])/u); assert.ok(token);
    const binding = f.renderer.bindings[Number(token[1])];
    assert.equal(binding.owner, block); assert.equal(binding.value, value); assert.equal(typeof binding.part, "string");
    return { option, part: binding.part };
  };
  const privateRows = () => ({ content: worker.sqlite.prepare("SELECT * FROM private_content ORDER BY content_id").all(),
    payloads: worker.sqlite.prepare("SELECT * FROM event_private_payloads ORDER BY private_event_id").all() });
  const initial = await before(x), privateBefore = privateRows(), contentBefore = JSON.stringify(h.store.content.get());
  assert.ok(h.store.sourceOwnershipActive(initial.source) && h.store.authorizationScopeActive(initial.authorization));
  const acknowledgementOwner = { authorizationKey: initial.authorization.key, actorUserId: h.store.session.get().user.userId,
    projectId: worker.projectId, sourceGeneration: initial.source.generation };
  const acknowledgementsBefore = h.store.eventWriteAcknowledgments(acknowledgementOwner);
  const current = view(), chosen = optionBinding(current, chosenValue), sourceChoice = optionBinding(current, originalValue);
  assert.equal(current.select.port.value, originalValue); assert.equal(current.field.port.value, initialBlock.properties.text);
  assert.deepEqual(current.values, catalog); assert.equal(new Set(current.values).size, current.values.length);
  const selectPart = current.select.port.propertyParts.value; assert.equal(typeof selectPart, "string");
  await unchanged(x, initial);
  const stable = view(); assert.equal(optionBinding(stable, chosenValue).part, chosen.part);
  assert.equal(optionBinding(stable, originalValue).part, sourceChoice.part, "An unchanged current render retains the healthy source option binding");
  assert.equal(stable.select.port.propertyParts.value, selectPart);
  const expected = { type: "BlockPropertyEdited", payload: { block_id: BLOCK, property_path: "subtype",
    old_value: "", new_value: chosenValue, source_surface: "context-block" } };
  // Keep the existing original-response observer. Its prior intercept rejects
  // any other non-GET before dispatch; only exact original free Resume may pass
  // to the existing transport and must still receive its independent proof.
  const priorIntercept = h.intercept;
  h.intercept = request => {
    if ((request.init.method ?? "GET") !== "GET") {
      assert.equal(request.url, "/api/workspace/quick-edit"); assert.equal(request.init.method, "POST");
      assert.deepEqual(request.body, { action: "resume", projectId: worker.projectId, documentId: worker.documentId });
      assert.ok(h.store.sourceOwnershipActive(initial.source) && h.store.authorizationScopeActive(initial.authorization));
    }
    return priorIntercept?.(request);
  };
  const original = postCancelOriginals(x, initial, [{ property: "subtype", value: chosenValue, source: "context-block", properties: ["subtype"] }]);
  try {
    const target = view().select;
    f.native.emit("pointerdown", target.port); f.native.focus(target.port); target.port.value = chosenValue;
    await f.act(target, "change");
    const record = await original.wait(0);
    assert.equal(record.returned, false); assert.equal(record.response.bodyUsed, false);
    assert.deepEqual(record.request.body.event, expected); assert.deepEqual(record.request.body.events, [expected]);
    assert.equal(record.request.body.expectedSequence, initial.head); assert.equal(record.request.body.action, "append");
    assert.equal(record.request.init.body, record.bytes);
    assert.deepEqual(h.store.projection.get().blocks.find(value => value.id === BLOCK), initialBlock,
      "The positive original response has not yet published to the actual Store");
    const committed = record.body.appended[0];
    assert.equal(record.body.appended.length, 1); assert.equal(committed.type, expected.type); assert.deepEqual(committed.payload, expected.payload);
    assert.equal(committed.sequence, initial.head + 1); assert.equal(record.body.head, committed.sequence);
    assert.equal(committed.actor, "user"); assert.equal(committed.clientId, "web:lit"); assert.equal(committed.streamId, worker.streamId);
    assert.equal(committed.compensatesEventId, null); assert.equal(committed.payload.client_event_id, undefined);
    original.release(0);
    await reached(x, () => record.returned && !h.store.busy.get()
      && h.store.projection.get().blocks.find(value => value.id === BLOCK)?.properties.subtype === chosenValue,
    "Only the same original Worker response publishes the selected Kind");
    const exact = async () => {
      await original.exact(1);
      assert.equal(record.response.status, 200); assert.equal(record.response.bodyUsed, true);
      assert.equal(record.request.init.body, record.bytes); assert.equal(JSON.stringify(record.request.body), record.bytes);
      assert.deepEqual(h.store.events.get(), [...JSON.parse(initial.events), committed]); assert.equal(h.store.head.get(), committed.sequence);
      assert.deepEqual(await readWorkspaceEvents(worker.env, worker.streamId), [...initial.history, committed]);
      const privateAfter = privateRows(); assert.deepEqual(privateAfter.content, privateBefore.content);
      assert.deepEqual(privateAfter.payloads.filter(row => row.private_event_id !== committed.eventId), privateBefore.payloads);
      const appendedPrivate = privateAfter.payloads.filter(row => row.private_event_id === committed.eventId);
      assert.equal(appendedPrivate.length, 1); assert.equal(appendedPrivate[0].redacted_at, null);
      assert.deepEqual(JSON.parse(appendedPrivate[0].private_json), expected.payload);
      assert.deepEqual(receipts(worker), initial.receipts, "This existing append does not invent a durable client receipt key");
      assert.deepEqual(financial(worker), initial.money); assert.equal(JSON.stringify(h.store.content.get()), contentBefore);
      assert.equal(JSON.stringify(h.store.session.get()), initial.session); assert.equal(h.store.route.get(), initial.route);
      assert.ok(h.store.sourceOwnershipActive(initial.source) && h.store.authorizationScopeActive(initial.authorization));
      assert.equal(h.store.projection.get().projectId, worker.projectId); assert.equal(h.store.projection.get().documentId, worker.documentId);
      assert.ok(x.workspace.isConnected && block.isConnected); assert.equal(block.store, h.store);
      assert.equal(f.components().find(value => value.tag === "forma-context-block" && value.block?.id === BLOCK), block);
      assert.deepEqual(block.block, { ...initialBlock, properties: { ...initialBlock.properties, subtype: chosenValue },
        sourceEvents: [...initialBlock.sourceEvents, committed.eventId] });
      assert.equal(h.store.ui.focusBlockId, BLOCK); assert.equal(dialogs(f).length, 0);
      // Successful published observations are intentionally released by
      // #finishEventWrite. This is only the unresolved registry, not the ACK.
      assert.deepEqual(h.store.eventWriteAcknowledgments(acknowledgementOwner), acknowledgementsBefore,
        "The consumed original publication leaves no new unresolved write or fabricated retained receipt");
      assert.deepEqual(h.requests.slice(initial.requests).filter(request => (request.init.method ?? "GET") !== "GET"
        && !x.resume.isReadOnlyResume(request)), [record.request], "Exactly this one Kind write; no Save, second change, proposal or provider action");
      assert.equal(x.resume.pendingOriginalCount(), 0); assert.equal(globalThis.fetch.mock.callCount(), 0);
    };
    await exact(); // All original write/private/receipt/fiscal evidence precedes the desired binding assertion.
    const selected = view(), selectedBinding = optionBinding(selected, chosenValue);
    assert.equal(selected.select.port.propertyParts.value, selectPart, "The same current classifier PropertyPart owns the value before and after the ACK");
    assert.equal(selected.select.port.value, chosenValue); assert.equal(selected.select.properties.value, chosenValue);
    assert.equal(selected.field.port.value, initialBlock.properties.text);
    assert.deepEqual([...selected.values].sort(), [...catalog].sort()); assert.equal(new Set(selected.values).size, selected.values.length);
    t.diagnostic("CONTEXT_KIND_ORIGINAL_CATALOG_CHOICE " + JSON.stringify({ blockId: BLOCK, projectId: worker.projectId, documentId: worker.documentId,
      oldStoredSubtype: "", originalDisplayedSubtype: originalValue, chosenSubtype: chosenValue, originalWorkerStatus: record.response.status,
      originalEventId: committed.eventId, originalResponseConsumed: record.response.bodyUsed, originalEventCount: 1,
      currentReportedValue: selected.select.port.value, sameSelectPropertyPart: true,
      chosenEmittedOptionPartRetained: selectedBinding.part === chosen.part,
      selectedIndex: typeof selected.select.port.selectedIndex === "number" ? selected.select.port.selectedIndex : null,
      nativeOptionSelected: typeof selectedBinding.option.port.selected === "boolean" ? selectedBinding.option.port.selected : null,
      originalHistoryPrivatePayloadReceiptAndFiscalVerified: true,
      boundary: "actual ContextBlock change and original RAM Worker ACK, then emitted AttributePart identity; no select IDL/DOM lifetime or physical browser claim" }));
    assert.equal(selectedBinding.part, chosen.part,
      "The acknowledged catalog Kind must retain its own emitted option value part, not another value's reused list position");
    await settle(x, 2); await exact();
    const retained = view(); assert.equal(retained.select.port.value, chosenValue); assert.equal(retained.field.port.value, initialBlock.properties.text);
    assert.equal(optionBinding(retained, chosenValue).part, chosen.part);
  } finally {
    try { await original.close(); }
    finally { h.intercept = priorIntercept; assert.equal(globalThis.fetch.mock.callCount(), 0, "No swallowed external/provider request"); }
  }
});
