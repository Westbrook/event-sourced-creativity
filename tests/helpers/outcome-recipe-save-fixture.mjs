import assert from "node:assert/strict";
import { createSceneStoreHost } from "./scene-cost-store-host.mjs";
import { createCalmFullPage, calmFullPageNativePorts, registerCalmFullPageComponents } from "./calm-full-page-fixture.mjs";
import { installOutputNavigationFocusNative } from "./output-navigation-focus-native.mjs";
import { installDBoundNativeDetails } from "./d-native-disclosure.mjs";
import { installDRecipeCardNative } from "./d-recipe-card-native.mjs";
import { buildOutcomeRecipeDraft, outcomeRecipeFileChoices } from "../../src/model/outcome-recipes.ts";
import { outcomeRecipeDraftLabels } from "../../src/components/design-system/locales/outcome-recipe-draft-messages.ts";
import { recipeCardControls } from "./recipe-card-controls.mjs";

/** Actual complete controller/card/Store and Worker SQLite. Only native DOM and HTTP delivery are ports. */
export async function outcomeRecipeSaveFixture(t, { locale = "en", shared = false, initializeActor = null } = {}) {
  const previousFetch = globalThis.fetch, external = [];
  globalThis.fetch = async (...args) => { external.push(args); throw Error("outcome_recipe_no_provider"); };
  t.after(() => { globalThis.fetch = previousFetch; assert.equal(external.length, 0); });
  const h = await createSceneStoreHost({ count: 1, shared, exposeSceneTestAccessors: false });
  // Reuse the intake fixture's finite History port; Store owns route commit.
  const oldHistory = globalThis.history;
  globalThis.history = {
    pushState(_state, _title, route) { const url = new URL(route, "http://localhost"); Object.assign(h.location, { pathname: url.pathname, search: url.search, hash: url.hash, href: url.href }); },
    replaceState(...args) { this.pushState(...args); },
  };
  t.after(() => { globalThis.history = oldHistory; });
  const totals = () => Object.fromEntries(["document_jobs", "budget_reservations", "cost_budget_reservations", "output_execution_grants", "output_operation_slots"]
    .map(table => [table, h.worker.sqlite.prepare("SELECT COUNT(*) AS n FROM " + table).get().n]));
  const financial = () => Object.fromEntries(["budget_counters", "cost_budget_counters", "budget_reservations", "cost_budget_reservations"]
    .map(table => [table, h.worker.sqlite.prepare("SELECT * FROM " + table).all()]));
  let before = null;
  t.after(() => { if (before) { assert.deepEqual(totals(), before.totals); assert.deepEqual(financial(), before.financial); } });
  const actual = { events: h.store.events.get(), head: h.store.head.get(), content: h.store.content.get(), session: h.store.session.get() };
  const f = await createCalmFullPage(t, { locale, storeHost: h });
  h.store.events.set(actual.events); h.store.head.set(actual.head); h.store.content.set(actual.content); h.store.session.set(actual.session);
  h.store.route.set("/document/" + h.worker.documentId + "/recipe-fixture");
  // Register actual conditional Output descendants before synchronous native tree queries.
  await registerCalmFullPageComponents(f, ["forma-output-requirements"]);
  installOutputNavigationFocusNative(t, f, calmFullPageNativePorts);
  await f.settle();
  assert.equal(h.store.events.get().some(event => event.eventId.startsWith("synthetic-study-")), false);
  assert.equal(h.store.sourceOwnershipActive(h.store.captureSourceOwnership()), true);
  const snapshot = () => h.store.outputRequirements.resource(h.worker.documentId).snapshot;
  assert.equal(h.store.outputRequirements.resource(h.worker.documentId).state, "ready"); assert.ok(snapshot());
  assert.equal(snapshot().requirements.length, 0, "no fabricated or pre-saved requirement row");
  const controller = f.components().find(component => component.tag === "forma-output-requirements" && !component.blockId && component.documentId === h.worker.documentId);
  assert.ok(controller);
  installDBoundNativeDetails(t, f, controller, { className: "output-recipe-entry" });
  installDRecipeCardNative(t, f, controller);
  // Only this actual controller's recipe-card descendant grammar is missing
  // from the native query port. Preserve component identity and emitted ancestry.
  const nativeQuery = f.renderer.query;
  f.renderer.query = function(owner, selector) {
    if (owner !== controller || selector !== "[data-output-recipe-draft] forma-output-requirement-card")
      return nativeQuery.call(this, owner, selector);
    const candidates = nativeQuery.call(this, owner, "forma-output-requirement-card");
    const tree = f.tree(), root = tree.nodes.find(node => node.component === controller);
    if (!controller.isConnected || !root) return [];
    return candidates.filter(card => {
      const row = tree.nodes.find(node => node.component === card);
      let inDraft = false;
      for (let parent = row?.parent; parent; parent = parent.parent) {
        if (parent === root) return inDraft;
        if (parent.owner === controller && parent.port?.isConnected && parent.port.hasAttribute("data-output-recipe-draft")) inDraft = true;
      }
      return false;
    });
  };
  t.after(() => { f.renderer.query = nativeQuery; });
  if (initializeActor) {
    // Provision the later actor's real lazy session rows before the original
    // financial baseline, without adopting that actor into the current Store.
    assert.equal(shared, false, "this setup has no project-context cookie");
    const { userId, email } = initializeActor;
    assert.ok(typeof userId === "string" && userId && typeof email === "string" && email);
    const session = h.store.session.get(), authorization = h.store.captureAuthorizationScope(), source = h.store.captureSourceOwnership();
    assert.notEqual(userId, session.user.userId);
    const initialized = await h.worker.request("/api/session", { headers: {
      "oai-authenticated-user-id": userId, "oai-authenticated-user-email": email,
    } });
    assert.equal(initialized.status, 200);
    const body = await initialized.json();
    assert.equal(body.user.userId, userId); assert.equal(body.user.email, email);
    assert.equal(body.budgets.user.used, 0); assert.equal(body.budgets.user.reserved, 0);
    assert.equal(body.costBudgets.user.usedMicrousd, 0); assert.equal(body.costBudgets.user.reservedMicrousd, 0);
    await h.worker.drainBackground();
    assert.equal(h.store.session.get(), session, "initialization must not adopt the later actor");
    assert.equal(h.store.authorizationScopeActive(authorization), true);
    assert.equal(h.store.sourceOwnershipActive(source), true);
  }
  before = { totals: totals(), financial: financial() }; const saves = [];
  let afterSave = null;
  h.intercept = async request => {
    if (request.url !== "/api/output-requirements" || request.init.method !== "POST" || request.body?.action !== "save") return;
    const response = await h.worker.request(request.url, request.init);
    const entry = { request, body: structuredClone(request.body), status: response.status, reply: await response.clone().json() };
    saves.push(entry); await afterSave?.(entry); return response;
  };
  const proposal = (recipeId, choices = outcomeRecipeFileChoices(recipeId).map(choice => choice.key)) => {
    const current = snapshot();
    return buildOutcomeRecipeDraft({ scope: { projectId: current.projectId, documentId: current.documentId, authorizationScopeKey: h.store.captureAuthorizationScope().key },
      expectedRevision: current.revision, sourceRevision: current.sourceRevision, requirementRevision: current.requirementRevision,
      requirementId: crypto.randomUUID(), recipeId, originalText: "  Exact authored outcome\nنص — 元の文章。\n", selectedChoices: choices,
      labels: outcomeRecipeDraftLabels(locale, "Recipe " + recipeId) });
  };
  const { card, nodes, acceptInterpretation: reviewCard, save, observeSave } = recipeCardControls(f, controller);
  // Retry emits the same original Save synchronously through a void click.
  // Only its actual current EventPart opts into the existing Promise observer.
  const nativeAct = f.act;
  f.act = function(...args) {
    const [node, eventName = "click"] = args, activate = () => Reflect.apply(nativeAct, this, args);
    if (eventName !== "click" || node?.tag !== "button" || node.owner !== controller
      || typeof node.handlers.click !== "function" || !String(node.handlers.click).includes("#retryRecipeSave(")) return activate();
    const tree = f.tree(), current = tree.nodes.find(row => row.tag === "button" && row.owner === controller
      && row.port === node.port && row.handlers.click === node.handlers.click);
    const owner = card(), row = tree.nodes.find(candidate => candidate.component === owner);
    if (!current || !owner || !row || current.parent !== row.parent || current.parent?.owner !== controller
      || !Object.hasOwn(current.parent.attributes, "data-output-recipe-draft")) return activate();
    return observeSave(owner, activate).then(count => {
      t.diagnostic(JSON.stringify({ kind: "D280-original-retry-completion", capturedOriginalSaveHandlers: count }));
    });
  };
  t.after(() => { f.act = nativeAct; });
  const open = async value => {
    const result = await controller.stageRecipeDraft(value, { current: () => true, opener: null }); await f.settle();
    assert.equal(result, "opened"); assert.equal(card().snapshot, null); assert.equal(card().newDraft.requirementId, value.requirementId);
    assert.equal(snapshot().requirements.some(row => row.blockId === value.requirementId), false); assert.equal(saves.length, 0);
    return card();
  };
  const acceptInterpretation = async () => {
    await reviewCard(); assert.equal(saves.length, 0, "review is local, not Save");
  };
  const fresh = async () => {
    const response = await h.worker.request("/api/output-requirements?documentId=" + encodeURIComponent(h.worker.documentId));
    assert.equal(response.status, 200); return response.json();
  };
  return { f, h, controller, snapshot, card, nodes, proposal, open, acceptInterpretation, save, saves, fresh,
    afterSave(callback) { afterSave = callback; }, resetAfterSave() { afterSave = null; } };
}
