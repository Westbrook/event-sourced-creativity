import assert from "node:assert/strict";
import test from "node:test";
import { outcomeRecipeSaveFixture } from "./helpers/outcome-recipe-save-fixture.mjs";
import { sceneDeferred, untilScene } from "./helpers/scene-cost-store-host.mjs";
import { outcomeRecipeDraftMessage } from "../src/components/design-system/locales/outcome-recipe-draft-messages.ts";
import { FORMA_OUTPUT_REQUIREMENT_MESSAGES } from "../src/components/design-system/locales/output-requirement-messages.ts";

// Conditional D2 regressions. Prepared, not executed. The fixture uses the
// complete current Shell/controller/card/Store and actual RAM Worker/SQLite.
// Native rendering and ACK delivery are ports, not browser certification.
// Detached-handler calls below are explicitly synthetic ownership negatives.
const options = { concurrency: false };
const retained = x => x.h.store.outputRequirements.retainedWrite(x.h.worker.documentId);
const saves = x => x.h.requests.filter(request => request.url === "/api/output-requirements" && request.body?.action === "save");
const commands = x => x.h.worker.sqlite.prepare("SELECT * FROM output_commands WHERE action='save' ORDER BY scope_key,actor_user_id,command_key").all();
const retry = x => x.f.tree().visible("button").find(node => node.owner === x.controller && node.text === outcomeRecipeDraftMessage(x.f.locale, "retryOriginal"));
const cardButton = (x, key) => x.nodes().find(node => !node.hiddenBy && node.tag === "button" && node.text === FORMA_OUTPUT_REQUIREMENT_MESSAGES[x.f.locale]["output.requirement." + key]);
const rawText = x => x.nodes().find(node => !node.hiddenBy && node.tag === "textarea" && node.attributes.name === "originalText");
const invokeRetained = async (x, node) => { await node.handlers.click.call(node.owner, { target: node.port, currentTarget: node.port, preventDefault() {}, stopPropagation() {} }); await x.f.settle(); };

async function unknownOriginal(t, config = {}) {
  const x = await outcomeRecipeSaveFixture(t, config), proposal = x.proposal("executive-deck");
  await x.open(proposal); await x.acceptInterpretation();
  let drop = true;
  x.afterSave(entry => { if (drop) { drop = false; assert.equal(entry.status, 200); throw Error("Lost actual original recipe Save ACK"); } });
  await x.save(); await untilScene(() => retained(x)?.status === "unknown", "actual committed Save ACK is unknown"); await x.f.settle();
  assert.equal(x.saves.length, 1); assert.equal(saves(x).length, 1); assert.equal(x.saves[0].status, 200);
  assert.equal((await x.fresh()).requirements.filter(row => row.blockId === proposal.requirementId).length, 1);
  x.resetAfterSave();
  const refresh = x.f.tree().visible("button").find(node => node.owner === x.controller && String(node.handlers.click).includes("#refresh(true)"));
  assert.ok(refresh, "existing deliberate current Output read"); await x.f.act(refresh);
  assert.equal(x.snapshot().requirements.filter(row => row.blockId === proposal.requirementId).length, 1);
  assert.equal(retained(x).status, "unknown", "GET is not a command acknowledgment");
  assert.equal(retained(x).clientMutationId, x.saves[0].body.clientMutationId); assert.equal(saves(x).length, 1);
  assert.ok(retry(x), "same-owner explicit original Save recovery is presented");
  return { ...x, proposal, first: x.saves[0], originalCommands: commands(x) };
}
async function acknowledgeOriginal(x) {
  const button = retry(x); assert.ok(button); assert.equal(Object.hasOwn(button.attributes, "disabled"), false);
  await x.f.act(button); await untilScene(() => retained(x)?.status === "acknowledged", "same original receipt acknowledgment"); await x.f.settle();
  assert.equal(x.saves.length, 2); assert.equal(saves(x).length, 2);
  assert.deepEqual(x.saves[1].body, x.first.body, "no new revision, input, requirement ID or mutation ID");
  assert.equal(x.saves[1].reply.replayed, true); assert.equal(x.saves[1].reply.command.eventId, x.first.reply.command.eventId);
  assert.deepEqual(commands(x), x.originalCommands, "receipt replay creates no second Save event or command row");
  assert.equal((await x.fresh()).requirements.filter(row => row.blockId === x.proposal.requirementId).length, 1);
  assert.equal(retry(x), undefined);
}

test("recipe exact original retry / shared current French host replays one real Save", options, async t => {
  const x = await unknownOriginal(t, { shared: true, locale: "fr" });
  assert.equal(x.card().snapshot.requirementId, x.proposal.requirementId);
  assert.equal(x.card().originalSaveId, x.first.body.clientMutationId);
  await acknowledgeOriginal(x);
  assert.equal(x.card().hasOpenDraft, false); assert.equal(x.card().originalSaveId, "");
});

test("recipe exact original retry / newer Japanese raw edits remain unsubmitted on original ACK", options, async t => {
  const x = await unknownOriginal(t, { locale: "ja" }), card = x.card(), field = rawText(x), newer = "Newer unsent direction — 元の保存とは別の編集。";
  assert.ok(field); assert.equal(Object.hasOwn(field.attributes, "disabled"), false);
  field.port.value = newer; await x.f.act(field, "input");
  assert.equal(rawText(x).port.value, newer); assert.equal(x.card() === card, true);
  const compare = x.nodes().find(node => !node.hiddenBy && node.tag === "summary"
    && node.text === FORMA_OUTPUT_REQUIREMENT_MESSAGES[x.f.locale]["output.requirement.compare"]);
  assert.ok(compare, "the current actual comparison disclosure is available");
  assert.equal(compare.parent?.tag, "details"); assert.equal(compare.parent.owner, card);
  assert.ok(compare.parent.port?.isConnected, "open the exact current native disclosure");
  compare.parent.port.open = true; await x.f.settle();
  const reviewed = x.nodes().find(node => !node.hiddenBy && node.tag === "input" && node.attributes.name === "conflict-reviewed");
  assert.ok(reviewed); reviewed.port.checked = true; await x.f.act(reviewed, "change");
  for (const key of ["save", "cancel", "reloadLatest", "reapply"]) {
    const button = cardButton(x, key); assert.ok(button, key); assert.equal(Object.hasOwn(button.attributes, "disabled"), true, key + " cannot replace the unresolved original");
  }
  assert.equal(saves(x).length, 1); await acknowledgeOriginal(x);
  assert.equal(x.card() === card, true); assert.equal(card.hasOpenDraft, true);
  assert.equal(rawText(x).port.value, newer); assert.equal(card.originalSaveId, "");
  assert.equal((await x.fresh()).requirements.find(row => row.blockId === x.proposal.requirementId).content, x.first.body.spec.original_text);
  assert.equal(saves(x).length, 2, "no implicit rebase or submission of the newer raw wording");
});

test("recipe exact original retry / accepting a newer local interpretation cannot erase the original fingerprint", options, async t => {
  const x = await unknownOriginal(t), field = rawText(x), newer = "Create a 6-slide presentation for the leadership review.";
  assert.ok(field); field.port.value = newer; await x.f.act(field, "input");
  const parse = cardButton(x, "parseProposal"); assert.ok(parse); await x.f.act(parse);
  const replace = cardButton(x, "replaceProposal"); assert.ok(replace, "actual existing interpretation comparison is reached"); await x.f.act(replace);
  assert.equal(rawText(x).port.value, newer); assert.equal(saves(x).length, 1);
  await acknowledgeOriginal(x); assert.equal(x.card().hasOpenDraft, true); assert.equal(rawText(x).port.value, newer);
  assert.equal((await x.fresh()).requirements.find(row => row.blockId === x.proposal.requirementId).content, x.first.body.spec.original_text);
});

test("recipe exact original retry / required current predicate and wrong identity do not consume the retained original", options, async t => {
  const x = await unknownOriginal(t), card = x.card(), id = x.first.body.clientMutationId;
  assert.equal(card.retryOriginalSave("not-the-original", () => true), false);
  assert.equal(card.retryOriginalSave(id, () => false), false);
  assert.equal(card.retryOriginalSave(id, undefined), false, "missing required caller predicate is not authority");
  assert.equal(saves(x).length, 1); assert.equal(retained(x).status, "unknown"); assert.equal(card.hasOpenDraft, true);
  await acknowledgeOriginal(x);
});

test("recipe exact original retry / actual shared context denial retires the private draft and old handler", options, async t => {
  const x = await unknownOriginal(t, { shared: true }), button = retry(x), card = x.card(), share = x.h.worker.sharing;
  assert.ok(share?.contextId);
  const update = x.h.worker.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE context_id=?").run(new Date().toISOString(), share.contextId);
  assert.equal(Number(update.changes), 1);
  const denied = await x.h.worker.request("/api/output-requirements?documentId=" + encodeURIComponent(x.h.worker.documentId)); assert.equal(denied.status, 403);
  await x.h.store.outputRequirements.ensure(x.h.worker.documentId, { force: true }); await x.f.settle();
  assert.equal(x.h.store.outputRequirements.resource(x.h.worker.documentId).accessLost, true);
  assert.equal(x.card(), undefined); assert.equal(retry(x), undefined);
  await invokeRetained(x, button);
  assert.equal(card.retryOriginalSave(x.first.body.clientMutationId, () => true), false);
  assert.equal(saves(x).length, 1); assert.deepEqual(commands(x), x.originalCommands);
});

test("recipe exact original retry / actual Source403 then restoration never revives the old draft body", options, async t => {
  const x = await unknownOriginal(t), button = retry(x), card = x.card(), source = x.h.store.captureSourceOwnership();
  const previous = x.h.worker.env.FORMA_PILOT_COHORT_ID;
  try {
    x.h.worker.env.FORMA_PILOT_COHORT_ID = "synthetic-missing-recipe-recovery-cohort";
    await assert.rejects(x.h.store.refreshEvents(), /403/u); await x.f.settle();
    assert.equal(x.h.store.sourceOwnershipActive(source), false); assert.equal(x.h.store.events.get().length, 0);
  } finally {
    if (previous === undefined) delete x.h.worker.env.FORMA_PILOT_COHORT_ID; else x.h.worker.env.FORMA_PILOT_COHORT_ID = previous;
  }
  await x.h.store.refreshEvents(); await x.f.settle();
  assert.equal(x.h.store.sourceOwnershipActive(source), false); assert.equal(x.h.store.sourceOwnershipActive(x.h.store.captureSourceOwnership()), true);
  await invokeRetained(x, button); assert.equal(card.retryOriginalSave(x.first.body.clientMutationId, () => true), false);
  assert.equal(x.f.components().some(component => component.tag === "forma-output-requirement-card" && component.newDraft), false);
  assert.equal(x.f.tree().visible("button").some(node => node.text === outcomeRecipeDraftMessage("en", "retryOriginal")), false);
  assert.equal(retained(x).clientMutationId, x.first.body.clientMutationId); assert.equal(retained(x).sourceRetired, true);
  assert.equal(saves(x).length, 1); assert.deepEqual(commands(x), x.originalCommands);
});

test("recipe exact original retry / genuine new actor session cannot resend the earlier actor's local body", options, async t => {
  const x = await unknownOriginal(t, { initializeActor: { userId: "recipe-recovery-new-actor", email: "recipe-recovery-new-actor@local.forma" } }), button = retry(x), card = x.card(), authorization = x.h.store.captureAuthorizationScope();
  x.h.worker.setScopedHeaders({ "oai-authenticated-user-id": "recipe-recovery-new-actor", "oai-authenticated-user-email": "recipe-recovery-new-actor@local.forma" });
  await x.h.store.refreshSession(); await x.f.settle();
  assert.equal(x.h.store.session.get().user.userId, "recipe-recovery-new-actor");
  assert.equal(x.h.store.authorizationScopeActive(authorization), false);
  await invokeRetained(x, button); assert.equal(card.retryOriginalSave(x.first.body.clientMutationId, () => true), false);
  assert.equal(x.f.components().some(component => component.tag === "forma-output-requirement-card" && component.newDraft), false);
  assert.equal(saves(x).length, 1); assert.deepEqual(commands(x), x.originalCommands);
});

test("recipe exact original retry / route departure and fresh opening cannot recover a discarded private body from GET", options, async t => {
  const x = await unknownOriginal(t), route = x.h.store.route.get(), button = retry(x), card = x.card();
  x.h.store.setRoute("/library"); await x.f.settle(); x.h.store.setRoute(route); await x.f.settle();
  assert.equal(x.controller.isConnected, false); assert.equal(card.isConnected, false);
  await invokeRetained(x, button);
  assert.equal(x.f.tree().visible("button").some(node => node.text === outcomeRecipeDraftMessage("en", "retryOriginal")), false);
  assert.equal(retained(x).status, "unknown"); assert.equal(retained(x).clientMutationId, x.first.body.clientMutationId);
  assert.equal(saves(x).length, 1); assert.deepEqual(commands(x), x.originalCommands);
  assert.equal((await x.fresh()).requirements.filter(row => row.blockId === x.proposal.requirementId).length, 1);
});

test("recipe exact original retry / pending repeat is fenced and late original ACK cannot reopen a departed owner", options, async t => {
  const x = await unknownOriginal(t), button = retry(x), gate = sceneDeferred(); let entered = false, departedRoute = null;
  t.after(() => gate.resolve());
  x.afterSave(async entry => { assert.equal(entry.reply.replayed, true); entered = true; await gate.promise; });
  const active = x.f.act(button);
  try {
    await untilScene(() => entered, "actual original replay is held after Worker200"); await x.f.flush();
    assert.equal(retained(x).status, "pending"); assert.equal(saves(x).length, 2);
    await button.handlers.click.call(button.owner, { currentTarget: button.port, preventDefault() {}, stopPropagation() {} });
    assert.equal(saves(x).length, 2, "synthetic retained second handler cannot duplicate the pending original");
    x.h.store.setRoute("/library"); await x.f.flush();
    departedRoute = x.h.store.route.get();
    assert.equal(departedRoute, "/library?document=" + encodeURIComponent(x.h.worker.documentId), "the actual initial departure has the exact canonical Library Document address");
    assert.equal(x.controller.isConnected, false);
  } finally { gate.resolve(); await active; }
  await untilScene(() => retained(x)?.status === "acknowledged", "late original content-free receipt is retained"); await x.f.settle();
  assert.equal(x.h.store.route.get(), departedRoute, "late original ACK cannot change the exact departed route"); assert.equal(x.controller.isConnected, false);
  assert.equal(x.f.components().some(component => component.tag === "forma-output-requirement-card" && component.newDraft), false);
  assert.equal(retained(x).clientMutationId, x.first.body.clientMutationId); assert.equal(saves(x).length, 2);
  assert.deepEqual(x.saves[1].body, x.first.body); assert.deepEqual(commands(x), x.originalCommands);
});

test("recipe exact original retry / all four locales distinguish original Save from newer raw edits", () => {
  const labels = [];
  for (const locale of ["en", "fr", "ar", "ja"]) {
    const label = outcomeRecipeDraftMessage(locale, "retryOriginal"), help = outcomeRecipeDraftMessage(locale, "retryOriginalHelp"), unavailable = outcomeRecipeDraftMessage(locale, "retryUnavailable");
    assert.ok(label.length > 0 && help.length > label.length && unavailable.length > label.length); labels.push(label);
  }
  assert.equal(new Set(labels).size, 4); assert.equal(labels[0], "Retry this exact save");
});
