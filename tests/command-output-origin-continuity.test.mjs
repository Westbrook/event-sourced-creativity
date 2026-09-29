import assert from "node:assert/strict";
import test from "node:test";
import { createOutputReachabilityPage } from "./helpers/output-reachability-fixture.mjs";
import { FIXTURE_DOCUMENT_IDS } from "./output-controller-fixture-model.mjs";
import { calmFullPageNativePorts as ports, registerCalmFullPageComponents } from "./helpers/calm-full-page-fixture.mjs";
import { installOutputNavigationFocusNative } from "./helpers/output-navigation-focus-native.mjs";
import { sceneDeferred, untilScene } from "./helpers/scene-cost-store-host.mjs";
import { documentIdFromRoute, projectTaskDocumentIdFromRoute, withProjectTaskDocumentInRoute } from "../src/model/routes.ts";

// Complete current Shell/Store/Output controller/client and actual Output domain
// functions. Session, HTTP, native DOM and Resume are finite fixture ports, NOT
// durable Worker authority, SQL/fiscal, provider, browser geometry or AT proof.
// Only the explicitly submitted free Confirm may mutate the finite domain.
const cOutputCommandOptions = { concurrency: false, timeout: 60000 };
const cOutputCommandClass = (node, name) => String(node.attributes.class ?? "").split(/\s+/u).includes(name);
const cOutputCommandInside = (node, parent) => { for (let at = node; at; at = at.parent) if (at === parent) return true; return false; };
const cOutputCommandSnapshots = f => FIXTURE_DOCUMENT_IDS.map(id => f.adapter.snapshot(id));
const cOutputCommandButton = (f, owner, key) => f.find("button", node => node.owner === owner && node.text === f.i18n.t(key));
const cOutputCommandRetained = f => f.store.outputRequirements.retainedWrite(FIXTURE_DOCUMENT_IDS[0]);
const cOutputCommandReview = (f, tree = f.tree()) => tree.visible("section").filter(node => node.owner === f.commandOutputOwner && cOutputCommandClass(node, "output-plan-review"));

async function cOutputCommandDrain(f) {
  for (let step = 0; step < 8; step++) {
    await f.settle();
    for (const [id, timer] of [...f.storeHost.timers]) if (timer.delay === 16) { f.storeHost.timers.delete(id); timer.callback(0); }
    await new Promise(setImmediate);
  }
  await f.settle();
}
async function cOutputCommandPage(t, locale = "en") {
  const f = await createOutputReachabilityPage(t, { state: "confirmed", surface: "document", locale, authoredSource: true });
  await registerCalmFullPageComponents(f, ["forma-activity"]);
  const previousHistory = Object.getOwnPropertyDescriptor(globalThis, "history");
  Object.defineProperty(globalThis, "history", { configurable: true, writable: true, value: {
    pushState(_state, _title, path) { const next = new URL(path, "http://localhost"); Object.assign(f.storeHost.location, { pathname: next.pathname, search: next.search, hash: next.hash }); },
    replaceState(...args) { this.pushState(...args); },
  } });
  t.after(() => { if (previousHistory) Object.defineProperty(globalThis, "history", previousHistory); else delete globalThis.history; });
  f.nativeHistoryLocation = f.storeHost.location;
  f.native = installOutputNavigationFocusNative(t, f, ports);
  // The reusable fixture seeds route through its signal. Join its existing
  // native location through the public Store route API before any observation.
  f.store.setRoute(f.store.route.get(), { replace: true }); await cOutputCommandDrain(f);
  const owners = f.outputControllers().filter(value => !value.blockId && value.documentId === FIXTURE_DOCUMENT_IDS[0]);
  assert.equal(owners.length, 1); f.commandOutputOwner = owners[0];
  assert.ok(f.host.isConnected && f.commandOutputOwner.isConnected);
  assert.equal(f.host.tag, "forma-shell"); assert.equal(f.commandOutputOwner.store, f.store);
  assert.equal(documentIdFromRoute(f.store.route.get()), FIXTURE_DOCUMENT_IDS[0]);
  assert.equal(f.store.projection.get().documentId, FIXTURE_DOCUMENT_IDS[0]);
  assert.equal(f.store.outputRequirements.resource(FIXTURE_DOCUMENT_IDS[0]).state, "ready");
  assert.equal(cOutputCommandRetained(f), null);
  const requests = f.storeHost.requests.length; await cOutputCommandDrain(f);
  assert.equal(f.storeHost.requests.length, requests, "Initial actual reads settle before accounting");
  const source = f.store.captureSourceOwnership(), authorization = f.store.captureAuthorizationScope();
  assert.ok(f.store.sourceOwnershipActive(source) && f.store.authorizationScopeActive(authorization));
  f.commandBefore = { route: f.store.route.get(), projectId: f.store.projection.get().projectId, source, authorization,
    events: structuredClone(f.store.events.get()), backingEvents: structuredClone(f.storeHost.worker.events), head: f.store.head.get(),
    session: structuredClone(f.store.session.get()), snapshots: cOutputCommandSnapshots(f), jobs: structuredClone(f.store.documentJobs.get()),
    requests, commits: f.outputRecords.filter(row => row.type === "fixture-commit").length };
  return f;
}
async function cOutputCommandInvariants(f, original = null) {
  await cOutputCommandDrain(f); const before = f.commandBefore;
  assert.deepEqual(f.storeHost.worker.events, before.backingEvents, "No backing Source event is appended");
  assert.deepEqual(f.store.events.get(), before.events); assert.equal(f.store.head.get(), before.head);
  assert.deepEqual(f.store.session.get(), before.session, "Synthetic authority and budget fixtures stay unchanged");
  assert.deepEqual(f.store.documentJobs.get(), before.jobs);
  assert.ok(f.store.sourceOwnershipActive(before.source) && f.store.authorizationScopeActive(before.authorization));
  assert.equal(f.store.projection.get().projectId, before.projectId); assert.equal(f.store.projection.get().documentId, FIXTURE_DOCUMENT_IDS[0]);
  const actual = cOutputCommandSnapshots(f), expected = original?.snapshots ?? before.snapshots;
  assert.deepEqual(actual, expected, "Command search, navigation and local resolution do not mutate the finite domain");
  for (let index = 0; index < actual.length; index++) for (const key of ["grants", "assets", "results"])
    assert.deepEqual(actual[index][key], before.snapshots[index][key], "No fictional " + key + " changed; this is not SQL evidence");
  const writes = f.storeHost.requests.slice(before.requests).filter(row => (row.init.method ?? "GET") !== "GET" && !f.isReadOnlyResume(row));
  assert.deepEqual(writes, original ? [original.request] : [], "Only the exact original free Confirm; no resend, save, preflight, grant, run or event POST");
  const commits = f.outputRecords.filter(row => row.type === "fixture-commit").slice(before.commits);
  if (!original) { assert.deepEqual(commits, []); return; }
  assert.equal(original.request.init, original.init); assert.equal(original.init.body, original.bytes);
  assert.equal(original.request.body.clientMutationId, original.body.clientMutationId);
  assert.equal(commits.length, 1); assert.deepEqual(commits[0].detail, {
    documentId: FIXTURE_DOCUMENT_IDS[0], action: "confirm", revision: original.response.snapshot.revision,
    clientMutationId: original.body.clientMutationId,
  });
}
async function cOutputCommandOpenPlan(f) {
  await f.act(cOutputCommandButton(f, f.commandOutputOwner, "output.delivery.reviewPlan"));
  assert.equal(cOutputCommandReview(f).length, 1);
}
async function cOutputCommandClosePlan(f) {
  await f.act(cOutputCommandButton(f, f.commandOutputOwner, "output.delivery.cancel")); await cOutputCommandDrain(f);
  assert.equal(cOutputCommandReview(f).length, 0);
  assert.equal(f.tree().visible("form").filter(node => cOutputCommandClass(node, "output-requirement-form")).length, 0);
}
async function cOutputCommandHeldConfirm(f) {
  await cOutputCommandOpenPlan(f);
  const confirm = cOutputCommandButton(f, f.commandOutputOwner, "output.delivery.confirm");
  assert.equal(confirm.port.matches(":disabled"), false, "The real current free Confirm submitter is enabled");
  const tree = f.tree(), review = cOutputCommandReview(f, tree)[0];
  const forms = tree.visible("form").filter(node => node.owner === f.commandOutputOwner && cOutputCommandInside(node, review));
  assert.equal(forms.length, 1);
  const gate = sceneDeferred(), fetchFixture = f.adapter.fetch; let original = null;
  f.adapter.fetch = async (path, init = {}) => {
    const response = await fetchFixture(path, init);
    if (path === "/api/output-requirements" && init.method === "POST" && JSON.parse(init.body).action === "confirm") {
      assert.equal(original, null, "One original Confirm delivery is held"); assert.equal(response.status, 200);
      const body = JSON.parse(init.body), reply = await response.clone().json();
      assert.equal(body.documentId, FIXTURE_DOCUMENT_IDS[0]); assert.equal(reply.ok, true); assert.equal(reply.replayed, false);
      assert.equal(reply.command.action, "confirm"); assert.equal(reply.snapshot.documentId, body.documentId); assert.deepEqual(reply.appended, []);
      const requests = f.storeHost.requests.filter(row => row.init === init); assert.equal(requests.length, 1);
      original = { request: requests[0], init, bytes: init.body, body, response: reply, snapshots: cOutputCommandSnapshots(f) };
      await gate.promise; throw new Error("Finite committed original Confirm response delivery lost");
    }
    return response;
  };
  const sending = f.act(forms[0], "submit");
  const release = async () => { gate.resolve(); try { await sending; } finally { f.adapter.fetch = fetchFixture; } await cOutputCommandDrain(f); };
  try {
    await untilScene(() => original !== null, "The actual finite-domain original Confirm commits before delivery is held");
    await cOutputCommandDrain(f);
    const pending = cOutputCommandRetained(f); assert.equal(pending?.status, "pending");
    assert.equal(pending.action, "confirm"); assert.equal(pending.clientMutationId, original.body.clientMutationId);
    assert.equal(pending.expectedRevision, original.body.expectedRevision); assert.ok(pending.digest);
    await cOutputCommandInvariants(f, original);
    return { original, pending, release };
  } catch (error) { await release(); throw error; }
}
async function cOutputCommandUnknown(f) {
  const held = await cOutputCommandHeldConfirm(f); await held.release();
  const write = cOutputCommandRetained(f);
  assert.deepEqual(write, { ...held.pending, status: "unknown" }, "Only delivered-receipt status changes; no read manufactures an ACK");
  return { ...held, write };
}
async function cOutputCommandActivity(f) {
  const route = f.store.route.get(), requestStart = f.storeHost.requests.length;
  const trigger = f.find("button", node => node.owner === f.host && cOutputCommandClass(node, "command-trigger"));
  assert.ok(trigger.port.isConnected); assert.equal(trigger.port.matches(":disabled"), false);
  f.native.emit("pointerdown", trigger.port); f.native.focus(trigger.port); await f.act(trigger, "click", { button: 0 });
  const label = f.i18n.t("command.openNavigation", "Open {name}", { name: f.i18n.t("shell.navigation.activity", "Activity") });
  const search = f.find("input", node => node.owner === f.host && node.attributes.id === "command-search");
  search.port.value = label; await f.act(search, "input");
  const tree = f.tree(), dialogs = tree.visible("dialog").filter(node => node.owner === f.host && cOutputCommandClass(node, "command-dialog"));
  assert.equal(dialogs.length, 1); assert.equal(dialogs[0].port.open, true);
  const rows = tree.visible("button").filter(node => node.owner === f.host && node.attributes.role === "option" && cOutputCommandInside(node, dialogs[0])
    && node.children.some(child => typeof child !== "string" && child.tag === "span" && child.text === label));
  assert.equal(rows.length, 1, "One actual localized Open Activity command, not a supplied callback");
  assert.ok(rows[0].port.isConnected); assert.equal(rows[0].port.matches(":disabled"), false);
  assert.equal(f.store.route.get(), route); assert.equal(f.storeHost.requests.length, requestStart, "Search itself is local");
  f.native.emit("pointerdown", rows[0].port); f.native.focus(rows[0].port);
  const focus = f.native.nativeFocus.length, scroll = f.native.nativeScroll.length;
  await f.act(rows[0], "click", { button: 0 }); await cOutputCommandDrain(f);
  return { label, requestStart, focus, scroll };
}
function cOutputCommandObserve(t, f, kind, gesture) {
  t.diagnostic("C_OUTPUT_COMMAND_ORIGIN " + JSON.stringify({ kind, locale: f.i18n.locale, command: gesture.label,
    documentId: FIXTURE_DOCUMENT_IDS[0], route: f.store.route.get(), originRoute: f.commandBefore.route,
    originalOwnerConnected: f.commandOutputOwner.isConnected, retainedWrite: cOutputCommandRetained(f),
    finiteCommits: f.outputRecords.filter(row => row.type === "fixture-commit").slice(f.commandBefore.commits).map(row => row.detail),
    evidence: "actual classes/current native controls and finite Output-domain response; synthetic session/Resume/budgets, no Worker/SQL/provider certificate" }));
}
function cOutputCommandDeparted(f) {
  assert.equal(f.store.route.get(), withProjectTaskDocumentInRoute("/activity", FIXTURE_DOCUMENT_IDS[0], f.commandBefore.route));
  assert.equal(projectTaskDocumentIdFromRoute(f.store.route.get()), FIXTURE_DOCUMENT_IDS[0]);
  assert.equal(f.commandOutputOwner.isConnected, false, "The original Document Output owner was really left");
  const activities = f.tree().nodes.filter(node => node.tag === "forma-activity" && node.component?.isConnected && !node.hiddenBy);
  assert.equal(activities.length, 1); assert.equal(activities[0].component.store, f.store);
}
function cOutputCommandRefused(f, gesture) {
  assert.equal(f.store.route.get(), f.commandBefore.route, "Pending or newer local work prevents the actual command departure");
  assert.ok(f.commandOutputOwner.isConnected && f.outputControllers().includes(f.commandOutputOwner));
  assert.equal(f.storeHost.requests.length, gesture.requestStart, "Refusal starts no destination read or second command");
  assert.equal(f.native.nativeFocus.slice(gesture.focus).some(row => row.node.owner?.tag === "forma-activity"), false);
  assert.equal(f.native.nativeScroll.length, gesture.scroll);
}
async function cOutputCommandCloseMenu(f) {
  const dialogs = f.tree().visible("dialog").filter(node => node.owner === f.host && cOutputCommandClass(node, "command-dialog"));
  assert.ok(dialogs.length <= 1); if (dialogs.length) await f.act(dialogs[0], "cancel", { cancelable: true });
  await cOutputCommandDrain(f);
}

test("C Output command origin / quiet ready current Document departs without a command", cOutputCommandOptions, async t => {
  const f = await cOutputCommandPage(t); assert.equal(f.commandOutputOwner.navigationBlocked, false);
  const gesture = await cOutputCommandActivity(f); await cOutputCommandInvariants(f);
  cOutputCommandObserve(t, f, "quiet-ready", gesture); cOutputCommandDeparted(f); assert.equal(cOutputCommandRetained(f), null);
});

test("C Output command origin / settled unchanged unknown Confirm permits deliberate departure after Cancel", cOutputCommandOptions, async t => {
  const f = await cOutputCommandPage(t), original = await cOutputCommandUnknown(f);
  await cOutputCommandClosePlan(f);
  assert.equal(f.commandOutputOwner.navigationBlocked, true, "Existing preparation guard remains conservative; no new facade API is assumed");
  const gesture = await cOutputCommandActivity(f); await cOutputCommandInvariants(f, original.original);
  assert.deepEqual(cOutputCommandRetained(f), original.write, "Departure does not acknowledge, replace or discard the original transport identity");
  cOutputCommandObserve(t, f, "settled-unknown-clean", gesture); cOutputCommandDeparted(f);
});

test("C Output command origin / newer closed raw plan blocks until explicit local Discard / ja", cOutputCommandOptions, async t => {
  const f = await cOutputCommandPage(t, "ja"), original = await cOutputCommandUnknown(f), raw = " \t保留する未送信の計画 B\n  ";
  const amendment = () => f.find("textarea", node => node.owner === f.commandOutputOwner && node.attributes.rows === "2");
  const field = amendment(); assert.equal(field.port.matches(":disabled"), false); field.port.value = raw; await f.act(field, "input");
  assert.equal(amendment().port.value, raw); await cOutputCommandClosePlan(f);
  const gesture = await cOutputCommandActivity(f); await cOutputCommandInvariants(f, original.original);
  assert.deepEqual(cOutputCommandRetained(f), original.write); cOutputCommandObserve(t, f, "closed-newer-plan", gesture);
  cOutputCommandRefused(f, gesture); await cOutputCommandCloseMenu(f); await cOutputCommandOpenPlan(f);
  assert.equal(amendment().port.value, raw, "Cancel only hid B; the same current owner retains exact raw whitespace");
  const discard = cOutputCommandButton(f, f.commandOutputOwner, "output.delivery.planDiscard");
  assert.equal(discard.port.matches(":disabled"), false); await f.act(discard);
  assert.equal(amendment().port.value, ""); await cOutputCommandClosePlan(f);
  assert.equal(f.commandOutputOwner.navigationBlocked, true, "Unknown metadata still protects preparation, not settled departure");
  const fresh = await cOutputCommandActivity(f); await cOutputCommandInvariants(f, original.original);
  assert.deepEqual(cOutputCommandRetained(f), original.write); cOutputCommandObserve(t, f, "explicit-discard-then-fresh-command", fresh); cOutputCommandDeparted(f);
});

test("C Output command origin / Cancel cannot turn a pending Confirm into settled metadata", cOutputCommandOptions, async t => {
  const f = await cOutputCommandPage(t), held = await cOutputCommandHeldConfirm(f);
  try {
    await cOutputCommandClosePlan(f); assert.equal(cOutputCommandRetained(f)?.status, "pending");
    const gesture = await cOutputCommandActivity(f); await cOutputCommandInvariants(f, held.original);
    assert.deepEqual(cOutputCommandRetained(f), held.pending); cOutputCommandObserve(t, f, "pending-after-cancel", gesture); cOutputCommandRefused(f, gesture);
  } finally { await held.release(); }
  const unknown = { ...held.pending, status: "unknown" }; assert.deepEqual(cOutputCommandRetained(f), unknown);
  await cOutputCommandCloseMenu(f); const fresh = await cOutputCommandActivity(f);
  await cOutputCommandInvariants(f, held.original); assert.deepEqual(cOutputCommandRetained(f), unknown);
  cOutputCommandObserve(t, f, "settled-after-pending-refusal", fresh); cOutputCommandDeparted(f);
});

test("C recovery lifetime copy / Output retains exact unknown status, original technical receipt and budget hint / en", cOutputCommandOptions, async t => {
  const f = await cOutputCommandPage(t), original = await cOutputCommandUnknown(f);
  const hint = "Copy the technical receipt before leaving this view. Returning may not restore its local retry controls. Leaving does not cancel the request, confirm success, or release reserved budget.";
  const oldStatus = f.i18n.t("output.delivery.message.responseLost");
  assert.equal(oldStatus, "The response was not confirmed. Keep this draft and recover the same operation ID before starting another request.");
  await cOutputCommandClosePlan(f); await cOutputCommandInvariants(f, original.original);
  const write = cOutputCommandRetained(f); assert.deepEqual(write, original.write); assert.equal(write.status, "unknown");
  const requests = f.storeHost.requests.length, tree = f.tree(), owner = f.commandOutputOwner;
  const receipts = tree.visible("details").filter(node => node.owner === owner && cOutputCommandClass(node, "output-transport-receipt"));
  assert.equal(receipts.length, 1); assert.ok(receipts[0].open && receipts[0].port.isConnected);
  const status = tree.visible("p").filter(node => node.owner === owner && node.attributes.role === "status" && cOutputCommandInside(node, receipts[0]));
  assert.equal(status.length, 1);
  const fields = tree.visible("textarea").filter(node => node.owner === owner && cOutputCommandInside(node, receipts[0]));
  assert.equal(fields.length, 1); assert.ok(fields[0].port.isConnected && Object.hasOwn(fields[0].attributes, "readonly"));
  assert.equal(fields[0].port.value, JSON.stringify({ documentId: FIXTURE_DOCUMENT_IDS[0], ...write }, null, 2),
    "The actual native property retains the entire original technical record, not copy-reconstructed IDs");
  const copy = tree.visible("button").filter(node => node.owner === owner && cOutputCommandInside(node, receipts[0])
    && node.text === f.i18n.t("output.delivery.copyOperationReceipt", "Copy technical receipt"));
  assert.equal(copy.length, 1); assert.ok(copy[0].port.isConnected); assert.equal(copy[0].port.matches(":disabled"), false);
  assert.equal(write.clientMutationId, original.original.body.clientMutationId);
  assert.equal(write.expectedRevision, original.original.body.expectedRevision); assert.ok(write.digest);
  await cOutputCommandInvariants(f, original.original); assert.equal(f.storeHost.requests.length, requests);
  assert.deepEqual(cOutputCommandRetained(f), write); assert.equal(f.store.route.get(), f.commandBefore.route);
  t.diagnostic("C_RECOVERY_LIFETIME_OUTPUT " + JSON.stringify({ locale: "en", retainedStatus: write.status,
    exactTechnicalReceipt: true, originalFreeConfirms: 1, automaticRetryRequests: 0, status: status[0].text,
    evidence: "actual Output classes/client + finite domain Confirm; synthetic scope/budgets, not Worker/SQL/provider evidence" }));
  assert.equal(status[0].text, oldStatus + " " + hint, "Exact original uncertainty and local-retry/cost lifetime warning stay together");
  assert.equal(f.i18n.t("next.output.recoveryLifetime"), hint);
});
