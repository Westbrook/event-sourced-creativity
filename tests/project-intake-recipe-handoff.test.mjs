// Prepared for root execution. Full Projects/Shell/Output/card/Store and routed
// Worker SQLite; finite native and transport delivery only. No provider or
// generated answer. An observed Response clone is awaited before forwarding
// the same Response, so this fixture does not claim zero observation latency.
import assert from "node:assert/strict";
import test from "node:test";
import { AUTHORED, createProjectIntakeFixture, assertComplete, intendedIds, readWorkspaceEvents, sceneDeferred, untilScene } from "./helpers/project-intake-fixture.mjs";
import { recipeCardControls } from "./helpers/recipe-card-controls.mjs";
import { outcomeRecipeSaveFixture } from "./helpers/outcome-recipe-save-fixture.mjs";
import { registerOutputSourceImports } from "./output-server-test-helpers.mjs";
import { documentIdFromRoute } from "../src/model/routes.ts";
import { projectIntakeMessage } from "../src/components/design-system/locales/project-intake-messages.ts";
import { outcomeRecipeDraftMessage } from "../src/components/design-system/locales/outcome-recipe-draft-messages.ts";
import { outputRequirementInterpretationNeedsReview } from "../src/model/output-requirements.ts";
import { financial } from "./helpers/event-source-retirement-fixture.mjs";
import { observeActualSceneResumeReads } from "./helpers/actual-scene-resume-read.mjs";
import { registerCalmFullPageComponents } from "./helpers/calm-full-page-fixture.mjs";
const focusImports = registerOutputSourceImports();
const { captureOutputNavigationFocus } = await import("../src/components/output-navigation-focus.ts");
focusImports.deregister();
const options = { concurrency: false, timeout: 45000 };
const RAW = "  Explain the retained original intent.\nنص أصلي — 元の文章。  ";
const recipes = { "executive-deck": ["deck"], campaign: ["campaign-image", "campaign-audio"], "film-continuity": ["script", "composed-film"] };
const copy = (x, key) => projectIntakeMessage(x.f.locale, key);
const button = (x, key) => x.f.find("button", node => node.owner === x.owner && node.text === copy(x, key));
async function disclosure(x, key) {
  const details = x.f.find("summary", node => node.owner === x.owner && node.text === copy(x, key)).parent;
  details.port.open = true; await x.f.act(details, "toggle");
}
async function input(x, node, value) { node.port.value = value; await x.f.act(node, "input"); }
async function renderedIntakeAction(x, node, eventName, event = {}) {
  // The real handoff waits for native animation frames. f.act joins its
  // handler before flushing frames, so deliver this current visible control
  // with the same finite port and drive only the fixture's normal render work
  // while that real handler is pending. No callback or response is replaced.
  assert.ok(!node.hiddenBy && node.port?.isConnected); assert.equal(Object.hasOwn(node.attributes, "disabled"), false);
  const handler = node.handlers[eventName]; assert.equal(typeof handler, "function");
  let completed = false, failure = null;
  const pending = Promise.resolve(handler.call(node.owner, { target: node.port, currentTarget: node.port,
    preventDefault() {}, stopPropagation() {}, type: eventName, ...event })).catch(error => { failure = error; }).finally(() => { completed = true; });
  for (let turn = 0; turn < 120 && !completed; turn++) { await new Promise(setImmediate); await x.f.flush(); }
  assert.equal(completed, true, "The original current control completes within bounded native render turns");
  await pending; if (failure) throw failure; await x.f.settle();
}
async function fixture(t, locale = "en") {
  const x = await createProjectIntakeFixture(t, { locale, prepare: false }), prior = x.h.intercept, saves = [], reads = [];
  let outputRead = null;
  x.h.intercept = async request => {
    const url = new URL(request.url, "http://localhost"), method = request.init.method ?? "GET";
    if (url.pathname === "/api/output-requirements" && method === "GET") {
      const row = { request, documentId: url.searchParams.get("documentId"), response: null }; reads.push(row);
      if (outputRead) { const result = await outputRead(row); if (result !== undefined) return result; }
    }
    if (url.pathname === "/api/output-requirements" && method === "POST") {
      assert.equal(request.body?.action, "save", "Only a later explicit card Save may mutate Outputs");
      const response = await x.worker.request(request.url, request.init);
      saves.push({ request, body: structuredClone(request.body), status: response.status, reply: await response.clone().json() });
      return response;
    }
    return prior(request);
  };
  const original = () => { assert.ok(x.dispatches.length); return intendedIds(x.dispatches[0].body.events); };
  const controller = () => {
    const id = original().documentId;
    const found = x.f.components().filter(component => component.tag === "forma-output-requirements" && !component.blockId && component.surface === "document" && component.documentId === id);
    assert.equal(found.length, 1, "Only the exact original Document controller is used"); return found[0];
  };
  const controls = () => recipeCardControls(x.f, controller());
  const fresh = async () => {
    const response = await x.worker.request("/api/output-requirements?documentId=" + encodeURIComponent(original().documentId));
    assert.equal(response.status, 200); return response.json();
  };
  const open = async () => x.f.act(x.f.find("button", node => node.owner?.tag === "forma-ui-button" && node.owner.parentElement === x.owner && node.owner.label === x.f.i18n.t("projects.new", "New project")));
  const choose = async (id, choices = recipes[id]) => {
    await disclosure(x, "recipe");
    const select = x.f.find("select", node => node.owner === x.owner && Object.hasOwn(node.attributes, "data-intake-recipe-choice"));
    select.port.value = id; await x.f.act(select, "change");
    assert.equal(x.f.tree().visible("input").filter(node => node.owner === x.owner && Object.hasOwn(node.attributes, "data-intake-recipe-file") && node.properties.checked).length, 0,
      "Choosing a recipe cannot silently choose its file types");
    for (const key of choices) { const node = x.f.find("input", node => node.owner === x.owner && node.attributes["data-intake-recipe-file"] === key); node.port.checked = true; await x.f.act(node, "change"); }
  };
  const prepare = async id => {
    await open(); await input(x, x.objective(), RAW); if (id) await choose(id);
    const next = button(x, "continue"); assert.equal(Object.hasOwn(next.attributes, "disabled"), false);
    await x.f.act(x.form(), "submit", { submitter: next.port }); await disclosure(x, "details");
    await input(x, x.field(x.f.i18n.t("projects.projectName", "Project name")), AUTHORED.name);
    await input(x, x.field(x.f.i18n.system("Document name")), AUTHORED.documentTitle);
    assert.equal(x.dispatches.length, 0); assert.equal(saves.length, 0);
  };
  return Object.assign(x, { saves, reads, original, controller, controls, fresh, open, choose, prepare,
    async submit() { const button = x.submitButton(); await renderedIntakeAction(x, x.form(), "submit", { submitter: button.port }); },
    async check() { const current = x.f.find("button", node => node.owner === x.owner && node.text === x.f.i18n.t("projects.checkOriginal", "Check original")); await renderedIntakeAction(x, current, "click"); },
    outputRead(callback) { outputRead = callback; } });
}
async function assertUnsaved(x, recipeId, text = RAW) {
  const original = x.original(); assert.equal(documentIdFromRoute(x.h.store.route.get()), original.documentId);
  assert.equal(x.h.store.projection.get().projectId, original.projectId);
  const card = x.controls().card(); assert.ok(card?.isConnected); assert.equal(card.snapshot, null);
  assert.equal(card.newDraft.originalText, text); assert.equal(card.newDraft.scope.documentId, original.documentId);
  assert.equal(card.newDraft.spec.value_origins.recipe_template.text, "forma-recipe:" + recipeId + "@1");
  assert.equal(x.saves.length, 0); assert.equal((await x.fresh()).requirements.length, 0);
  return card.newDraft.requirementId;
}
async function saveAndVerify(x, id, recipeId, text = RAW) {
  const controls = x.controls(); await controls.acceptInterpretation(); assert.equal(x.saves.length, 0); await controls.save();
  assert.equal(x.saves.length, 1); assert.equal(x.saves[0].status, 200, JSON.stringify(x.saves[0].reply));
  assert.equal(x.saves[0].body.blockId, id); assert.equal(x.saves[0].body.documentId, x.original().documentId);
  const snapshot = await x.fresh(), row = snapshot.requirements.find(value => value.blockId === id); assert.ok(row);
  assert.equal(row.content, text); assert.equal(row.spec.original_text, text);
  assert.equal(row.spec.value_origins.recipe_template.text, "forma-recipe:" + recipeId + "@1");
  assert.equal(outputRequirementInterpretationNeedsReview(row.spec), false);
  assert.equal(snapshot.confirmedPlan, null); assert.deepEqual(snapshot.results, []); assert.deepEqual(snapshot.grants, []);
  assert.equal(snapshot.requirementSummaries[id]?.delivery_ready === true, false);
  assert.equal(controls.card().newDraft, null); assert.equal(controls.card().snapshot.requirementId, id);
}
for (const locale of ["en", "ja"]) for (const recipeId of Object.keys(recipes)) test(`${locale} intake ${recipeId} → exact unsaved Output → deliberate real Save`, options, async t => {
  const x = await fixture(t, locale); await x.prepare(recipeId); await x.submit();
  assert.equal(x.dispatches.length, 1); assert.equal(x.dispatches[0].status, 200); assert.equal(x.dispatches[0].reply.status, "complete");
  const id = await assertUnsaved(x, recipeId), spec = x.controls().card().newDraft.spec;
  assert.deepEqual(spec.deliverables.map(value => value.id), recipes[recipeId].map(key => id + ":" + key));
  assert.ok(spec.deliverables.every(value => value.quantity.kind === "unknown" && value.source_scope.kind === "unknown" && value.coverage.kind === "unresolved"));
  if (recipeId === "film-continuity") assert.ok(spec.deliverables.every(value => value.value_origins.delivery_limitation?.kind === "suggested"));
  await saveAndVerify(x, id, recipeId);
  assert.equal(x.h.requests.filter(row => row.body?.action === "project_intake" && row.body.intakeAction === "commit").length, 1);
});
for (const locale of ["en", "fr", "ar", "ja"]) test(`${locale} explicit blank retains recipe choices through Back/Close but applies no recipe`, options, async t => {
  const x = await fixture(t, locale); await x.prepare("campaign");
  await x.f.act(button(x, "back")); await x.f.act(x.f.find("button", node => node.owner === x.owner && node.text === x.f.i18n.t("action.cancel", "Cancel"))); await x.open();
  assert.equal(x.objective().port.value, RAW); await disclosure(x, "recipe");
  const select = x.f.find("select", node => node.owner === x.owner && Object.hasOwn(node.attributes, "data-intake-recipe-choice")); assert.equal(select.port.value, "campaign");
  assert.deepEqual(x.f.tree().visible("input").filter(node => node.owner === x.owner && node.properties.checked && Object.hasOwn(node.attributes, "data-intake-recipe-file")).map(node => node.attributes["data-intake-recipe-file"]), recipes.campaign);
  await x.f.act(button(x, "blank")); await x.submit();
  assert.equal(x.dispatches.length, 1); assert.deepEqual(x.dispatches[0].body.events.map(event => event.type), ["ProjectCreated", "DocumentCreated", "EmptyCanvasChosen"]);
  assert.equal(x.saves.length, 0); assert.equal((await x.fresh()).requirements.length, 0);
  assert.equal(x.f.components().some(component => component.tag === "forma-output-requirement-card" && component.newDraft), false);
});
for (const locale of ["en", "ja"]) test(`${locale} failed exact Output read retains local recipe; Refresh alone does not stage`, options, async t => {
  const x = await fixture(t, locale); await x.prepare("campaign");
  x.outputRead(async () => Response.json({ error: "fixture_output_read_unavailable" }, { status: 503 }));
  await x.submit(); const controller = x.controller();
  assert.equal(x.saves.length, 0); assert.equal(x.controls().card(), undefined);
  assert.equal(controller.querySelector(".output-recipe-entry textarea").value, RAW);
  assert.ok(x.f.tree().visible("p").some(node => node.owner === controller && node.text === outcomeRecipeDraftMessage(locale, "intakeRetained")));
  x.outputRead(null);
  const refresh = x.f.find("button", node => node.owner === controller && node.text === x.f.i18n.t("output.delivery.refresh", "Refresh outputs"));
  await x.f.act(refresh); assert.equal(x.controls().card(), undefined, "A successful read is not a new staging gesture");
  const form = x.f.find("form", node => node.owner === controller && node.parent?.attributes.class === "output-recipe-entry");
  const preview = x.f.find("button", node => node.owner === controller && node.text === outcomeRecipeDraftMessage(locale, "preview"));
  await x.f.act(form, "submit", { submitter: preview.port });
  const id = await assertUnsaved(x, "campaign"); await saveAndVerify(x, id, "campaign");
});
test("lost successful intake ACK keeps original IDs and recipe until exact original Check", options, async t => {
  const x = await fixture(t); await x.prepare("film-continuity"); let lost = false;
  x.setBehavior(async stage => { if (stage === "after-worker" && !lost) { lost = true; throw Error("Synthetic loss after actual intake200"); } });
  await x.submit(); assert.equal(x.dispatches.length, 1); assert.equal(x.dispatches[0].status, 200);
  const first = x.dispatches[0], original = x.original(); assert.equal(x.h.store.route.get(), "/projects"); assert.equal(x.saves.length, 0);
  x.setBehavior(async () => {}); await x.check();
  assert.equal(x.dispatches.length, 2); assert.equal(x.dispatches[1].body.intakeAction, "check");
  assert.deepEqual(x.dispatches[1].body.events, first.body.events); assert.deepEqual(x.dispatches[1].reply.appended.map(event => event.eventId), first.reply.appended.map(event => event.eventId));
  assert.equal((await x.canonical()).projects.length, 1); assert.equal(x.original().documentId, original.documentId);
  await assertUnsaved(x, "film-continuity");
});
// Public controller boundary uses a genuinely existing exact resource and one
// captured gesture. It is not a fabricated saved requirement or handoff result.
function incoming(x) {
  const snapshot = x.snapshot();
  return { input: { recipeId: "campaign", originalText: RAW, selectedChoices: recipes.campaign },
    source: { projectId: snapshot.projectId, documentId: snapshot.documentId, actorUserId: snapshot.scope.actorUserId,
      authorizationScopeKey: x.h.store.captureAuthorizationScope().key, head: x.h.store.head.get() } };
}
test("the existing Output entry requires an explicit file choice even for a one-file recipe", options, async t => {
  const x = await outcomeRecipeSaveFixture(t);
  const disclosure = x.f.find("summary", node => node.owner === x.controller && node.text === outcomeRecipeDraftMessage("en", "heading")).parent;
  disclosure.port.open = true; await x.f.act(disclosure, "toggle");
  const select = x.f.find("select", node => node.owner === x.controller && node.parent?.tag === "label" && node.parent.parent?.tag === "form");
  select.port.value = "executive-deck"; await x.f.act(select, "change");
  const chosen = () => x.f.find("input", node => node.owner === x.controller && node.attributes.type === "checkbox" && node.parent?.parent?.tag === "fieldset");
  assert.equal(Boolean(chosen().properties.checked), false);
  const preview = () => x.f.find("button", node => node.owner === x.controller && node.text === outcomeRecipeDraftMessage("en", "preview"));
  const field = x.f.find("textarea", node => node.owner === x.controller && node.attributes.maxlength === "12000");
  field.port.value = RAW; await x.f.act(field, "input");
  assert.equal(Object.hasOwn(preview().attributes, "disabled"), true); assert.equal(x.card(), undefined); assert.equal(x.saves.length, 0);
  const currentChoice = chosen(); currentChoice.port.checked = true; await x.f.act(currentChoice, "change");
  assert.equal(Object.hasOwn(preview().attributes, "disabled"), false);
  const form = x.f.find("form", node => node.owner === x.controller && node.parent?.attributes.class === "output-recipe-entry");
  await x.f.act(form, "submit", { submitter: preview().port });
  assert.ok(x.card()?.newDraft); assert.deepEqual(x.card().newDraft.spec.deliverables.map(value => value.media_kind), ["slides"]);
  assert.equal(x.saves.length, 0); assert.equal((await x.fresh()).requirements.length, 0);
});
test("incoming recipe cannot overwrite an existing dirty card or an unresolved actual Save", options, async t => {
  const x = await outcomeRecipeSaveFixture(t), a = x.proposal("executive-deck"); await x.open(a); const data = incoming(x);
  const receive = async () => {
    const focus = captureOutputNavigationFocus(x.controller.ownerDocument);
    try { return await x.controller.receiveIntakeRecipe(data.input, data.source, { current: () => true, opener: null, focus }); }
    finally { focus.dispose(); }
  };
  assert.equal(await receive(), "existing-draft"); assert.equal(x.card().newDraft.requirementId, a.requirementId);
  await x.acceptInterpretation(); x.afterSave(async () => { throw Error("Synthetic loss after actual Output Save200"); }); await x.save();
  assert.equal(x.saves.length, 1); assert.equal(x.saves[0].status, 200); assert.equal(x.h.store.outputRequirements.retainedWrite(x.h.worker.documentId).status, "unknown");
  data.source.head = x.h.store.head.get(); assert.equal(await receive(), "existing-draft"); assert.equal(x.saves.length, 1);
  assert.equal((await x.fresh()).requirements.filter(row => row.blockId === a.requirementId).length, 1);
  // No retry/receipt repair is implemented or asserted here. Root separately
  // adjudicates the existing lost-positive-ACK baseline and recovery controls.
});
test("wrong incoming Document/actor/source head/authorization never adopts raw recipe input", options, async t => {
  const x = await outcomeRecipeSaveFixture(t), data = incoming(x);
  for (const change of [{ documentId: "another-document" }, { actorUserId: "another-actor" }, { authorizationScopeKey: "another-scope" }, { head: data.source.head + 1 }]) {
    const focus = captureOutputNavigationFocus(x.controller.ownerDocument);
    try { assert.equal(await x.controller.receiveIntakeRecipe(data.input, { ...data.source, ...change }, { current: () => true, opener: null, focus }), "stale"); }
    finally { focus.dispose(); }
  }
  assert.equal(x.card(), undefined); assert.equal(x.controller.querySelector(".output-recipe-entry textarea").value, ""); assert.equal(x.saves.length, 0);
});
for (const interruption of ["draft", "focus", "route"]) test(`new ${interruption} intent wins a delayed incoming recipe read`, options, async t => {
  const x = await outcomeRecipeSaveFixture(t), data = incoming(x), entered = sceneDeferred(), release = sceneDeferred(), prior = x.h.intercept;
  let held = false;
  x.h.intercept = async request => {
    if (!held && request.url.startsWith("/api/output-requirements?") && (request.init.method ?? "GET") === "GET") {
      held = true; const response = await x.h.worker.request(request.url, request.init); assert.equal(response.status, 200); entered.resolve(); await release.promise; return response;
    }
    return prior(request);
  };
  t.after(() => release.resolve());
  x.h.store.outputRequirements.invalidate(x.h.worker.documentId);
  const focus = captureOutputNavigationFocus(x.controller.ownerDocument);
  const pending = x.controller.receiveIntakeRecipe(data.input, data.source, { current: () => true, opener: null, focus });
  await untilScene(() => held, "original exact read started"); await entered.promise; await x.f.flush();
  const field = x.f.find("textarea", node => node.owner === x.controller && node.attributes.maxlength === "12000");
  if (interruption === "draft") {
    const value = RAW + " Newer human decision."; field.port.value = value;
    assert.equal(Object.hasOwn(field.attributes, "disabled"), false); assert.ok(field.port.isConnected);
    // Deliver the current visible native input without joining f.act's pending
    // Output read. No removed handler or private method is called.
    await field.handlers.input.call(field.owner, { target: field.port, currentTarget: field.port }); await x.f.flush();
  } else if (interruption === "focus") {
    const current = x.f.find("select", node => node.owner?.tag === "forma-ui-language-picker"); current.port.focus();
  } else {
    const route = x.h.store.route.get(); x.h.store.setRoute("/library"); await x.f.flush(); x.h.store.setRoute(route); await x.f.flush();
  }
  release.resolve(); const result = await pending; await x.f.settle();
  assert.notEqual(result, "opened"); assert.equal(x.f.components().some(component => component.tag === "forma-output-requirement-card" && component.newDraft), false); assert.equal(x.saves.length, 0);
  if (interruption !== "route") assert.equal(x.controller.querySelector(".output-recipe-entry textarea").value, interruption === "draft" ? RAW + " Newer human decision." : RAW);
  else {
    const current = x.f.components().find(component => component.tag === "forma-output-requirements" && !component.blockId && component.documentId === data.source.documentId);
    assert.ok(current); assert.equal(current.querySelector(".output-recipe-entry textarea").value, "", "No old private entry revives on the later route opening");
  }
});
test("actual shared Output denial clears local recipe choices without replacing the original source", options, async t => {
  const x = await outcomeRecipeSaveFixture(t, { shared: true }), data = incoming(x), focus = captureOutputNavigationFocus(x.controller.ownerDocument);
  focus.dispose(); // Local current input can be retained without a renewed focus/staging gesture.
  assert.equal(await x.controller.receiveIntakeRecipe(data.input, data.source, { current: () => true, opener: null, focus }), "retained");
  await x.f.settle(); assert.equal(x.controller.querySelector(".output-recipe-entry textarea").value, RAW); assert.equal(x.card(), undefined);
  const share = x.h.worker.sharing; assert.ok(share?.contextId);
  const changed = x.h.worker.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE context_id=?").run(new Date().toISOString(), share.contextId);
  assert.equal(Number(changed.changes), 1, "Only the existing RAM fixture's exact project context is revoked");
  const response = await x.h.worker.request("/api/output-requirements?documentId=" + encodeURIComponent(data.source.documentId)); assert.equal(response.status, 403);
  await x.h.store.outputRequirements.ensure(data.source.documentId, { force: true }); await x.f.settle();
  assert.equal(x.h.store.outputRequirements.resource(data.source.documentId).accessLost, true);
  assert.equal(x.controller.querySelector(".output-recipe-entry textarea"), null); assert.equal(x.card(), undefined); assert.equal(x.saves.length, 0);
  assert.equal(x.f.tree().visible("p").some(node => node.owner === x.controller && node.text === outcomeRecipeDraftMessage("en", "intakeRetained")), false,
    "Withdrawal cannot continue claiming the removed input is retained");
});

// One first-D custody control. Existing intake/card helpers and old cases stay
// unchanged. Native Assistant input is never submitted to an assistant service.
const dIntakeSiblingRaw = "  Keep my unsent Projects question — 保留 / سؤال  ";
const dIntakeSiblingClassed = (node, name) => String(node?.attributes?.class ?? "").split(/\s+/u).includes(name);
const dIntakeSiblingInside = (node, ancestor) => { for (let at = node; at; at = at.parent) if (at === ancestor) return true; return false; };
function dIntakeSiblingFind(tree, tag, predicate) {
  const found = tree.visible(tag).filter(predicate);
  assert.equal(found.length, 1, "one exact current visible " + tag); return found[0];
}
function dIntakeSiblingRows(x) {
  const db = x.worker.sqlite, stream = x.worker.streamId;
  // Same read-only original stream/private-receipt accounting as the existing
  // intake retry-history family. No grant, projection or event is seeded here.
  return {
    events: db.prepare("SELECT * FROM events WHERE stream_id=? ORDER BY sequence").all(stream),
    privatePayloads: db.prepare("SELECT secret.* FROM event_private_payloads secret JOIN events event ON event.event_id=secret.private_event_id WHERE event.stream_id=? ORDER BY secret.private_event_id").all(stream),
    receipts: db.prepare("SELECT * FROM event_client_receipts WHERE stream_id=? ORDER BY client_event_id").all(stream),
    financial: financial(x.worker),
  };
}
async function dIntakeSiblingPage(t) {
  const x = await fixture(t), { f, h, native } = x, reads = [];
  const session = h.store.session.get();
  assert.equal(session.assistant?.enabled, true); assert.equal(session.policy.accepted, true);
  assert.ok(session.capabilities.includes("project.author"));
  assert.equal(h.transport, null, "reuse the fixture's genuine Worker transport");
  h.transport = request => {
    const method = request.init.method ?? "GET", projection = h.store.projection.get();
    const resume = request.url === "/api/workspace/quick-edit" && method === "POST"
      && request.body?.action === "resume" && request.body.projectId === projection.projectId
      && request.body.documentId === projection.documentId
      && JSON.stringify(Object.keys(request.body).sort()) === JSON.stringify(["action", "documentId", "projectId"]);
    // Original intake POSTs still use the unchanged fixture interceptor first.
    assert.ok(method === "GET" || resume, "only original intake, genuine reads and exact free Resume are allowed");
    return x.worker.request(request.url, request.init).then(response => {
      reads.push({ path: request.url, method, status: response.status }); return response;
    });
  };
  const resume = observeActualSceneResumeReads(h); t.after(() => resume.restore());
  t.mock.method(globalThis, "fetch", (input, init = {}) => {
    const url = new URL(String(input), "http://localhost");
    assert.ok(["http://localhost", "https://fixture.invalid"].includes(url.origin)
      && url.pathname === "/api/assistant" && (init.method ?? "GET") === "GET",
    "the actual Assistant may only read its current context; no Send/provider/global network");
    return h.fetch(url.pathname + url.search, init);
  });
  // Existing lifecycle full-host event bridge: deliver the original event to
  // actual mounted listeners, without replacing Source or navigation behavior.
  const dispatch = h.window.dispatchEvent;
  h.window.dispatchEvent = function (event) {
    const result = dispatch.call(this, event);
    for (const handler of [...(f.listeners.get(event.type) ?? [])]) handler(event);
    return result;
  };
  t.after(() => { h.window.dispatchEvent = dispatch; });
  await registerCalmFullPageComponents(f, ["forma-creative-assistant"]);
  const settle = async () => { for (let step = 0; step < 4; step++) { await resume.settleOriginalRequests(); await f.settle(); } };
  await settle();
  const assistants = f.components().filter(owner => owner.tag === "forma-creative-assistant");
  assert.equal(assistants.length, 1); const assistant = assistants[0];
  const panels = f.components().filter(owner => owner.tag === "forma-assistant-panel" && owner.parentElement === assistant);
  assert.equal(panels.length, 1); const panel = panels[0];
  assert.ok(assistant instanceof f.modules.get("src/components/forma-creative-assistant.ts").FormaCreativeAssistant);
  assert.ok(panel instanceof f.modules.get("src/components/design-system/assistant-panel.ts").FormaAssistantPanel);
  assert.strictEqual(assistant.store, h.store);
  assert.strictEqual(assistant.closest("forma-shell"), f.host); assert.ok(assistant.isConnected && panel.isConnected);
  const activate = async node => {
    assert.ok(node.port?.isConnected && !node.hiddenBy && !node.port.matches(":disabled"));
    native.emit("pointerdown", node.port); native.focus(node.port); await f.act(node, "click", { button: 0 }); await settle();
  };
  const toggle = async open => {
    assert.notEqual(panel.open, open);
    await activate(f.find("button", node => node.owner === panel
      && dIntakeSiblingClassed(node, open ? "forma-assistant-launcher" : "forma-assistant-close")));
    assert.equal(panel.open, open); assert.ok(panel.isConnected && assistant.isConnected);
  };
  const field = () => {
    // Ancestry uses exactly one current tree, not wrappers from another draw.
    const tree = f.tree();
    const form = dIntakeSiblingFind(tree, "form", node => node.owner === panel && dIntakeSiblingClassed(node, "forma-assistant-composer"));
    const composer = dIntakeSiblingFind(tree, "forma-ui-conversation-composer", node => node.owner === panel
      && dIntakeSiblingInside(node, form) && dIntakeSiblingClassed(node, "forma-assistant-shared-composer"));
    assert.ok(composer.component?.isConnected && composer.component.closest("forma-assistant-panel") === panel);
    const current = dIntakeSiblingFind(tree, "textarea", node => node.owner === composer.component
      && dIntakeSiblingInside(node, composer) && dIntakeSiblingClassed(node, "forma-assistant-input"));
    assert.ok(form.port.isConnected && current.port.isConnected && !current.port.matches(":disabled")); return current;
  };
  const type = async value => {
    const node = field(); native.emit("keydown", node.port); native.focus(node.port);
    node.port.value = value; await f.act(node, "input"); await settle(); assert.equal(field().port.value, value);
  };
  const submit = async () => {
    const node = x.submitButton(); assert.ok(node?.port.isConnected && !node.port.matches(":disabled"));
    native.emit("pointerdown", node.port); native.focus(node.port); await x.submit(); await settle();
  };
  return Object.assign(x, { assistant, panel, reads, resume, settle, activate, toggle, assistantField: field, typeAssistant: type, submitNative: submit });
}
test("first D intake preserves a collapsed Assistant draft before creation; clear then creates one exact unsaved recipe", options, async t => {
  const x = await dIntakeSiblingPage(t), { h, f, panel } = x;
  const before = { route: h.store.route.get(), projectId: h.store.projection.get().projectId, documentId: h.store.projection.get().documentId,
    source: h.store.captureSourceOwnership(), authority: h.store.captureAuthorizationScope(), rows: dIntakeSiblingRows(x),
    events: await readWorkspaceEvents(x.worker.env, x.worker.streamId), requests: h.requests.length };
  assert.equal(before.route, "/projects"); assert.equal(panel.open, false);
  await x.toggle(true);
  assert.ok(x.reads.some(row => row.path.startsWith("/api/assistant?") && row.status === 200), "actual authorized free context GET completed");
  await x.typeAssistant(dIntakeSiblingRaw); assert.equal(panel.commandDepartureBlocked, true);
  const scope = panel.conversationScope; await x.toggle(false); assert.equal(panel.commandDepartureBlocked, true);
  await x.prepare("executive-deck"); await x.settle();
  assert.equal(panel.open, false); assert.equal(panel.commandDepartureBlocked, true); assert.equal(panel.conversationScope, scope);
  assert.deepEqual(dIntakeSiblingRows(x), before.rows); assert.deepEqual(await readWorkspaceEvents(x.worker.env, x.worker.streamId), before.events);
  const intakeText = () => f.find("textarea", node => node.owner === x.owner && Object.hasOwn(node.attributes, "data-intake-outcome-edit"));
  assert.equal(intakeText().port.value, RAW); assert.equal(x.visible().editable, true);
  await x.submitNative(); await x.worker.drainBackground(); await x.settle();
  // Account for any erroneous ORIGINAL creation before the desired refusal.
  // A repaired path has no row here. Never require a positive first response,
  // hide its canonical effects, replace the response, or retry its IDs.
  const firstRows = [...x.dispatches], appended = [];
  for (const row of firstRows) {
    assert.ok(Number.isInteger(row.status), "join the actual first Worker response, not an unresolved request");
    if (row.status === 200 && row.reply?.status === "complete") assertComplete(row);
    assert.equal(row.body.intakeAction, "commit");
    assert.equal(row.body.events.find(event => event.type === "BlockCreated").payload.properties.text, RAW.trim());
    appended.push(...(Array.isArray(row.reply?.appended) ? row.reply.appended : []));
  }
  const after = dIntakeSiblingRows(x), history = await readWorkspaceEvents(x.worker.env, x.worker.streamId);
  const oldIds = new Set(before.events.map(event => event.eventId)), newIds = new Set(appended.map(event => event.eventId));
  assert.deepEqual(history.filter(event => !oldIds.has(event.eventId)).map(event => event.eventId), appended.map(event => event.eventId));
  assert.deepEqual(history.filter(event => oldIds.has(event.eventId)), before.events);
  assert.deepEqual(after.events.filter(row => !newIds.has(row.event_id)), before.rows.events);
  assert.deepEqual(after.privatePayloads.filter(row => !newIds.has(row.private_event_id)), before.rows.privatePayloads);
  assert.equal(after.privatePayloads.length - before.rows.privatePayloads.length, appended.length);
  assert.deepEqual(after.receipts.filter(row => !newIds.has(row.event_id)), before.rows.receipts);
  assert.equal(after.receipts.length - before.rows.receipts.length, appended.length);
  assert.deepEqual(after.financial, before.rows.financial); assert.equal(x.saves.length, 0);
  assert.deepEqual(h.requests.slice(before.requests).filter(row => (row.init.method ?? "GET") !== "GET"
    && !firstRows.some(original => original.request === row) && !x.resume.isReadOnlyResume(row)), [],
  "only observed original intake requests or independently certified free Resume occurred");
  const currentTree = f.tree(), currentPanels = f.components().filter(owner => owner.tag === "forma-assistant-panel"
    && owner.parentElement === x.assistant), currentFields = currentTree.nodes.filter(node => !node.hiddenBy
    && ["input", "textarea"].includes(node.tag) && (node.owner === x.owner || node.owner.parentElement === x.owner));
  t.diagnostic(JSON.stringify({ firstIntakeRequests: firstRows.length, originalStatuses: firstRows.map(row => row.status),
    originalAppendedEvents: appended.length, currentRoute: h.store.route.get(), originalRoute: before.route,
    originalProjectId: before.projectId, currentProjectId: h.store.projection.get().projectId,
    originalDocumentId: before.documentId, currentDocumentId: h.store.projection.get().documentId,
    originalPanelConnected: panel.isConnected, sameAssistantScope: panel.conversationScope === scope,
    sameActualPanel: currentPanels.length === 1 && currentPanels[0] === panel,
    originalAssistantScope: scope, currentAssistantScope: panel.conversationScope,
    collapsedDraftBlocked: panel.commandDepartureBlocked, collapsedNativeFieldPresent: currentTree.visible("textarea").some(node => dIntakeSiblingClassed(node, "forma-assistant-input")),
    intakeOwnerConnected: x.owner.isConnected, intakeFields: currentFields.map(node => ({ tag: node.tag,
      label: node.owner.label ?? null, originalOutcome: node.port.value === RAW,
      originalProjectName: node.port.value === AUTHORED.name, originalDocumentTitle: node.port.value === AUTHORED.documentTitle })),
    intakeControlLabels: currentTree.visible("button").filter(node => node.owner === x.owner).map(node => node.text), outputSaves: x.saves.length }));
  assert.equal(firstRows.length, 0, "pre-existing sibling work must be admitted before creation can publish a new current project");
  assert.equal(h.store.route.get(), before.route); assert.equal(h.store.projection.get().projectId, before.projectId);
  assert.equal(h.store.projection.get().documentId, before.documentId); assert.equal(panel.conversationScope, scope);
  assert.equal(panel.commandDepartureBlocked, true); assert.equal(panel.open, false);
  assert.ok(h.store.sourceOwnershipActive(before.source) && h.store.authorizationScopeActive(before.authority));
  assert.ok(x.owner.isConnected && x.visible().modal); assert.equal(x.visible().editable, true, "a never-sent refusal is not a locked original request");
  assert.equal(intakeText().port.value, RAW); assert.equal(x.field(f.i18n.t("projects.projectName", "Project name")).port.value, AUTHORED.name);
  assert.equal(x.field(f.i18n.system("Document name")).port.value, AUTHORED.documentTitle);
  const expectedNotice = f.i18n.t("next.lifecycle.assistantOwnsWork");
  assert.equal(h.store.ui.toast, expectedNotice, "refusal explains the existing sibling's usable local resolution");
  const notice = dIntakeSiblingFind(f.tree(), "div", node => node.owner === f.host
    && dIntakeSiblingClassed(node, "toast") && node.attributes.role === "status");
  assert.ok(notice.port.isConnected); assert.equal(notice.attributes["aria-live"], "polite"); assert.equal(notice.text, expectedNotice);
  // Existing visible local resolution, not a private clear or a new draft.
  await x.activate(f.find("button", node => node.owner === x.owner && node.text === f.i18n.t("action.cancel", "Cancel")));
  assert.equal(x.visible().modal, false); await x.toggle(true); assert.equal(x.assistantField().port.value, dIntakeSiblingRaw);
  await x.typeAssistant(""); assert.equal(panel.commandDepartureBlocked, false); await x.toggle(false);
  await x.activate(f.find("button", node => node.owner.tag === "forma-ui-button" && node.owner.parentElement === x.owner
    && node.owner.label === f.i18n.t("projects.new", "New project")));
  assert.equal(x.visible().editable, true); assert.equal(intakeText().port.value, RAW);
  assert.equal(x.field(f.i18n.t("projects.projectName", "Project name")).port.value, AUTHORED.name);
  assert.equal(x.field(f.i18n.system("Document name")).port.value, AUTHORED.documentTitle);
  assert.equal(x.dispatches.length, 0); assert.deepEqual(dIntakeSiblingRows(x), before.rows);
  await x.submitNative(); await x.worker.drainBackground(); await x.settle();
  assert.equal(x.dispatches.length, 1); const original = assertComplete(x.dispatches[0]);
  assert.equal(x.dispatches[0].body.intakeAction, "commit");
  assert.equal(x.dispatches[0].body.events.find(event => event.type === "BlockCreated").payload.properties.text, RAW.trim());
  const canonical = await x.canonical(); assert.equal(canonical.projects.length, 1); assert.equal(canonical.documents.length, 1);
  assert.equal(canonical.projects[0].projectId, original.projectId); assert.equal(canonical.documents[0].documentId, original.documentId);
  assert.deepEqual(canonical.delta.map(row => row.eventId), x.dispatches[0].reply.appended.map(event => event.eventId));
  assert.equal(canonical.eventClientReceipts - before.rows.receipts.length, 4);
  const requirementId = await assertUnsaved(x, "executive-deck"), card = x.controls().card();
  assert.deepEqual(card.newDraft.spec.deliverables.map(value => value.id), [requirementId + ":deck"]);
  assert.equal(card.newDraft.spec.original_text, RAW); assert.equal(card.snapshot, null);
  assert.deepEqual(financial(x.worker), before.rows.financial); assert.equal(x.saves.length, 0);
  assert.deepEqual(h.requests.slice(before.requests).filter(row => (row.init.method ?? "GET") !== "GET"
    && row !== x.dispatches[0].request && !x.resume.isReadOnlyResume(row)), [],
  "clear and fresh Create cannot duplicate creation, Save an Output, send an Assistant message or start provider work");
});

// Two retained-original continuations, not another initial-Create case.
// The first original is made by the real native form and RAM Worker200, then
// only its positive response delivery is lost. No receipt or event is seeded.
for (const action of ["retry", "check"]) test(`first D retained intake ${action}: sibling draft blocks; clear recovers the exact original`, options, async t => {
  const x = await dIntakeSiblingPage(t), { h, f, panel, native } = x;
  const before = { route: h.store.route.get(), projectId: h.store.projection.get().projectId,
    documentId: h.store.projection.get().documentId, source: h.store.captureSourceOwnership(),
    authority: h.store.captureAuthorizationScope(), rows: dIntakeSiblingRows(x), requests: h.requests.length };
  assert.equal(before.route, "/projects"); assert.equal(panel.commandDepartureBlocked, false);
  await x.prepare("executive-deck");
  let lost = null;
  x.setBehavior(async (stage, row) => {
    if (stage === "after-worker" && !lost) {
      assert.equal(row.body.intakeAction, "commit"); assertComplete(row);
      lost = row; row.dropped = true;
      throw Error("Synthetic loss after this actual original intake200");
    }
  });
  try { await x.submitNative(); } finally { x.setBehavior(async () => {}); }
  await x.worker.drainBackground(); await x.settle();
  assert.ok(lost); assert.strictEqual(lost, x.dispatches[0]); assert.equal(x.dispatches.length, 1);
  const original = assertComplete(lost), originalBody = structuredClone(lost.body);
  const rows = dIntakeSiblingRows(x), history = await readWorkspaceEvents(x.worker.env, x.worker.streamId);
  const canonical = await x.canonical(), originalEventIds = lost.reply.appended.map(event => event.eventId);
  assert.equal(canonical.projects.length, 1); assert.equal(canonical.documents.length, 1);
  assert.equal(canonical.projects[0].projectId, original.projectId);
  assert.equal(canonical.documents[0].documentId, original.documentId);
  assert.deepEqual(canonical.delta.map(event => event.eventId), originalEventIds);
  assert.equal(canonical.eventClientReceipts - before.rows.receipts.length, 4);
  assert.deepEqual(rows.financial, before.rows.financial); assert.equal(x.saves.length, 0);
  const retainedFields = () => {
    assert.ok(x.owner.isConnected && f.components().includes(x.owner));
    assert.equal(h.store.route.get(), before.route); assert.equal(x.visible().modal, true);
    assert.equal(x.visible().editable, false, "An already-dispatched original stays read-only, not a fresh draft");
    assert.equal(f.find("textarea", node => node.owner === x.owner && Object.hasOwn(node.attributes, "data-intake-outcome-edit")).port.value, RAW);
    assert.equal(x.field(f.i18n.t("projects.projectName", "Project name")).port.value, AUTHORED.name);
    assert.equal(x.field(f.i18n.system("Document name")).port.value, AUTHORED.documentTitle);
    assert.ok(h.store.sourceOwnershipActive(before.source) && h.store.authorizationScopeActive(before.authority));
    assert.equal(x.submitButton().text, f.i18n.t("projects.retryOriginal", "Retry same creation"));
  };
  const closeIntake = async () => {
    const close = dIntakeSiblingFind(f.tree(), "button", node => node.owner === x.owner
      && node.attributes.type === "button" && node.text === f.i18n.t("action.close", "Close"));
    await x.activate(close); assert.equal(x.visible().modal, false);
  };
  const resumeIntake = async () => {
    const resume = dIntakeSiblingFind(f.tree(), "button", node => node.owner.tag === "forma-ui-button"
      && node.owner.parentElement === x.owner
      && node.owner.label === f.i18n.system("Resume {title}", { title: "\u2068" + AUTHORED.name + "\u2069" }));
    await x.activate(resume); retainedFields();
  };
  const recover = async () => {
    if (action === "retry") {
      assert.equal(x.submitButton().text, f.i18n.t("projects.retryOriginal", "Retry same creation"));
      await x.submitNative();
    } else {
      const check = dIntakeSiblingFind(f.tree(), "button", node => node.owner === x.owner
        && Object.hasOwn(node.attributes, "data-intake-original")
        && node.text === f.i18n.t("projects.checkOriginal", "Check original"));
      assert.ok(check.port.isConnected && !check.port.matches(":disabled"));
      native.emit("pointerdown", check.port); native.focus(check.port);
      await x.check(); await x.settle();
    }
    await x.worker.drainBackground(); await x.settle();
  };
  retainedFields();
  await closeIntake(); await x.toggle(true);
  assert.ok(x.reads.some(row => row.path.startsWith("/api/assistant?") && row.status === 200));
  await x.typeAssistant(dIntakeSiblingRaw); const assistantScope = panel.conversationScope;
  await x.toggle(false); assert.equal(panel.commandDepartureBlocked, true);
  await resumeIntake();
  assert.equal(x.dispatches.length, 1, "Close, authoring a sibling draft and Resume never retry or Check");
  assert.deepEqual(dIntakeSiblingRows(x), rows); assert.deepEqual(await readWorkspaceEvents(x.worker.env, x.worker.streamId), history);
  await recover();
  // If the unpatched handler dispatches, account for its actual same-original
  // response before the desired refusal; replay is not a second creation.
  const attempted = x.dispatches.slice(1);
  for (const row of attempted) {
    assertComplete(row); assert.equal(row.body.intakeAction, action === "retry" ? "commit" : "check");
    assert.deepEqual(row.body.events, originalBody.events);
    assert.deepEqual(row.body, { ...originalBody, intakeAction: action === "retry" ? "commit" : "check" });
    assert.deepEqual(row.reply.appended.map(event => event.eventId), originalEventIds);
  }
  assert.deepEqual(dIntakeSiblingRows(x), rows); assert.deepEqual(await readWorkspaceEvents(x.worker.env, x.worker.streamId), history);
  assert.equal(x.saves.length, 0);
  assert.deepEqual(h.requests.slice(before.requests).filter(row => (row.init.method ?? "GET") !== "GET"
    && !x.dispatches.some(original => original.request === row) && !x.resume.isReadOnlyResume(row)), []);
  t.diagnostic(JSON.stringify({ action, originalStatus: lost.status, originalProjectId: original.projectId,
    originalDocumentId: original.documentId, initialCommittedEvents: originalEventIds.length,
    additionalRecoveryRequests: attempted.length, additionalStatuses: attempted.map(row => row.status),
    originalRoute: before.route, currentRoute: h.store.route.get(), sameAssistantScope: panel.conversationScope === assistantScope,
    originalPanelConnected: panel.isConnected, siblingDraftBlocked: panel.commandDepartureBlocked,
    intakeOwnerConnected: x.owner.isConnected, exactOriginalRowsRetained: true, outputSaves: x.saves.length }));
  assert.equal(attempted.length, 0, "A sibling draft must block this native recovery before its original operation is dispatched");
  retainedFields();
  assert.equal(h.store.projection.get().projectId, before.projectId); assert.equal(h.store.projection.get().documentId, before.documentId);
  assert.equal(panel.open, false); assert.equal(panel.commandDepartureBlocked, true); assert.equal(panel.conversationScope, assistantScope);
  assert.ok(panel.isConnected && f.components().includes(panel));
  const expectedNotice = f.i18n.t("next.lifecycle.assistantOwnsWork");
  assert.equal(h.store.ui.toast, expectedNotice);
  const notice = dIntakeSiblingFind(f.tree(), "div", node => node.owner === f.host
    && dIntakeSiblingClassed(node, "toast") && node.attributes.role === "status");
  assert.ok(notice.port.isConnected); assert.equal(notice.attributes["aria-live"], "polite"); assert.equal(notice.text, expectedNotice);
  // Resolve only the current sibling's actual native input; the retained
  // original remains locked and is resumed through its own visible control.
  await closeIntake(); await x.toggle(true); assert.equal(x.assistantField().port.value, dIntakeSiblingRaw);
  await x.typeAssistant(""); assert.equal(panel.commandDepartureBlocked, false); await x.toggle(false);
  await resumeIntake(); assert.equal(x.dispatches.length, 1); assert.deepEqual(dIntakeSiblingRows(x), rows);
  await recover();
  assert.equal(x.dispatches.length, 2); const recovered = x.dispatches[1]; assertComplete(recovered);
  assert.equal(recovered.body.intakeAction, action === "retry" ? "commit" : "check");
  assert.deepEqual(recovered.body.events, originalBody.events);
  assert.deepEqual(recovered.body, { ...originalBody, intakeAction: action === "retry" ? "commit" : "check" });
  assert.deepEqual(recovered.reply.appended.map(event => event.eventId), originalEventIds);
  assert.deepEqual(await x.canonical(), canonical); assert.deepEqual(dIntakeSiblingRows(x), rows);
  assert.deepEqual(await readWorkspaceEvents(x.worker.env, x.worker.streamId), history);
  assert.equal(documentIdFromRoute(h.store.route.get()), original.documentId); assert.equal(h.store.projection.get().projectId, original.projectId);
  const requirementId = await assertUnsaved(x, "executive-deck"), card = x.controls().card();
  assert.equal(card.snapshot, null); assert.equal(card.newDraft.spec.original_text, RAW);
  assert.deepEqual(card.newDraft.spec.deliverables.map(value => value.id), [requirementId + ":deck"]);
  assert.equal(x.saves.length, 0); assert.deepEqual(financial(x.worker), before.rows.financial);
  assert.deepEqual(h.requests.slice(before.requests).filter(row => (row.init.method ?? "GET") !== "GET"
    && !x.dispatches.some(original => original.request === row) && !x.resume.isReadOnlyResume(row)), [],
  "Only the initial original and this deliberate same-original recovery occurred; no Assistant Send, Output Save or paid work");
});

// This reuses the existing actual intake/Worker fixture. It checks the emitted
// native option bindings after a genuine posture remount, not browser select
// insertion timing; root's separately observed physical regression must replay.
test("en recipe review Back retains owned raw input and binds the exact remounted option", options, async t => {
  const x = await fixture(t);
  const rawSource = "  Owned source passage.\nنص مرخّص — 保持した出典。  ";
  const source = x.h.store.captureSourceOwnership(), authorization = x.h.store.captureAuthorizationScope();
  assert.ok(source && authorization);
  const projection = x.h.store.projection.get();
  const before = { route: x.h.store.route.get(), head: x.h.store.head.get(), projectId: projection.projectId,
    documentId: projection.documentId, requests: x.h.requests.length, money: financial(x.worker),
    events: await readWorkspaceEvents(x.worker.env, x.worker.streamId) };
  const own = (tag, predicate) => x.f.find(tag, node => node.owner === x.owner && predicate(node));
  const sourceField = () => own("textarea", node => node.attributes.maxlength === "5000"
    && node.parent?.tag === "label" && node.parent.text.startsWith(x.f.i18n.system("Owned or licensed source excerpt")));
  const rights = () => own("input", node => node.attributes.type === "checkbox" && node.parent?.attributes.class === "rights-check");
  const recipeView = () => {
    const tree = x.f.tree(), selects = tree.visible("select").filter(node => node.owner === x.owner
      && Object.hasOwn(node.attributes, "data-intake-recipe-choice"));
    assert.equal(selects.length, 1);
    const select = selects[0], choices = tree.nodes.filter(node => node.tag === "option" && node.parent === select);
    assert.ok(select.port?.isConnected && x.f.renderer.nodes.includes(select.port));
    assert.equal(Object.hasOwn(select.attributes, "disabled"), false);
    assert.ok(choices.length > 1); assert.equal(new Set(choices.map(node => node.attributes.value)).size, choices.length);
    for (const choice of choices) assert.ok(choice.owner === x.owner && choice.port?.isConnected
      && x.f.renderer.nodes.includes(choice.port) && !choice.hiddenBy);
    return { select, choices };
  };
  const noEffects = async () => {
    assert.equal(before.route, "/projects"); assert.equal(x.h.store.route.get(), before.route);
    assert.ok(x.owner.isConnected && x.f.components().includes(x.owner)); assert.equal(x.owner.store, x.h.store);
    assert.deepEqual(x.f.components().filter(component => component.tag === "forma-projects"), [x.owner]);
    assert.equal(x.h.store.head.get(), before.head);
    assert.equal(x.h.store.projection.get().projectId, before.projectId);
    assert.equal(x.h.store.projection.get().documentId, before.documentId);
    assert.equal(x.h.store.sourceOwnershipActive(source), true);
    assert.equal(x.h.store.captureAuthorizationScope()?.key, authorization.key);
    assert.equal(x.dispatches.length, 0); assert.equal(x.saves.length, 0);
    assert.deepEqual(x.h.requests.slice(before.requests).filter(row => (row.init.method ?? "GET") !== "GET"), []);
    assert.deepEqual(await readWorkspaceEvents(x.worker.env, x.worker.streamId), before.events);
    assert.deepEqual(financial(x.worker), before.money);
  };
  await x.open(); await input(x, x.objective(), RAW); await disclosure(x, "addSource");
  await input(x, sourceField(), rawSource);
  assert.equal(Object.hasOwn(button(x, "continue").attributes, "disabled"), true, "Owned source still requires the user's rights assertion");
  const permission = rights(); permission.port.checked = true; await x.f.act(permission, "change");
  await x.choose("executive-deck"); // Existing helper proves no file type was preselected, then explicitly checks Slides.
  const original = recipeView(), optionValues = original.choices.map(node => node.attributes.value);
  const originalRecipe = original.choices.filter(node => node.attributes.value === "executive-deck");
  assert.equal(originalRecipe.length, 1);
  const recipeLabel = originalRecipe[0].text;
  assert.equal(original.select.properties.value, "executive-deck");
  const next = button(x, "continue"); assert.equal(Object.hasOwn(next.attributes, "disabled"), false);
  await x.f.act(x.form(), "submit", { submitter: next.port });
  const reviewTree = x.f.tree(), reviews = reviewTree.visible("section").filter(node => node.owner === x.owner
    && Object.hasOwn(node.attributes, "data-intake-recipe-review"));
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].children.find(node => node?.tag === "h3")?.text, recipeLabel);
  assert.equal(reviewTree.visible("select").filter(node => node.owner === x.owner
    && Object.hasOwn(node.attributes, "data-intake-recipe-choice")).length, 0);
  assert.equal(original.select.port.isConnected, false, "Review genuinely removes this intent selector");
  await x.f.act(button(x, "back"));
  const returned = recipeView();
  assert.notEqual(returned.select.port, original.select.port);
  assert.equal(returned.select.properties.value, "executive-deck", "The actual rendered application value is retained; finite .value is not browser timing evidence");
  assert.deepEqual(returned.choices.map(node => node.attributes.value), optionValues);
  assert.equal(x.objective().port.value, RAW); assert.equal(sourceField().port.value, rawSource);
  assert.equal(rights().port.checked, true);
  const slides = own("input", node => node.attributes["data-intake-recipe-file"] === "deck");
  assert.equal(slides.port.checked, true); assert.equal(slides.properties.checked, true);
  assert.equal(Object.hasOwn(button(x, "continue").attributes, "disabled"), false);
  await noEffects();
  // Intended old-source failure comes only after raw/rights/current-Source/
  // owner/no-mutation checks. No fixture supplies option.selected or a fallback.
  assert.deepEqual(returned.choices.filter(node => Object.hasOwn(node.attributes, "selected")).map(node => node.attributes.value),
    ["executive-deck"], "The remounted native options explicitly bind exactly the retained recipe, not No recipe");
  for (const choice of returned.choices) {
    const tokens = [...choice.port.full.matchAll(/\?selected=__bound_(\d+)__/gu)];
    assert.equal(tokens.length, 1, "Each actual native option has one selected BooleanAttributePart");
    const binding = x.f.renderer.bindings[Number(tokens[0][1])];
    assert.equal(binding.owner, x.owner); assert.equal(typeof binding.value, "boolean");
    assert.equal(binding.value, choice.attributes.value === "executive-deck");
  }
  returned.select.port.value = ""; await x.f.act(returned.select, "change");
  const cleared = recipeView();
  assert.equal(cleared.select.properties.value, "");
  assert.deepEqual(cleared.choices.filter(node => Object.hasOwn(node.attributes, "selected")).map(node => node.attributes.value), [""]);
  assert.equal(x.f.tree().visible("input").filter(node => node.owner === x.owner
    && Object.hasOwn(node.attributes, "data-intake-recipe-file")).length, 0);
  assert.equal(x.objective().port.value, RAW); assert.equal(sourceField().port.value, rawSource); assert.equal(rights().port.checked, true);
  await noEffects();
});
