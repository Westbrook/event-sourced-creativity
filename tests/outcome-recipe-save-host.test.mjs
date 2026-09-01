import assert from "node:assert/strict";
import test from "node:test";
import { outcomeRecipeSaveFixture } from "./helpers/outcome-recipe-save-fixture.mjs";
import { outputRequirementInterpretationNeedsReview } from "../src/model/output-requirements.ts";

for (const locale of ["en", "fr", "ar", "ja"]) for (const recipeId of ["executive-deck", "campaign", "film-continuity"])
  test(`${locale} ${recipeId}: actual unsaved card → deliberate Save → Worker canonical requirement`, { concurrency: false }, async t => {
    const x = await outcomeRecipeSaveFixture(t, { locale }), proposal = x.proposal(recipeId);
    await x.open(proposal); await x.acceptInterpretation(); await x.save();
    assert.equal(x.saves.length, 1); assert.equal(x.saves[0].status, 200); assert.equal(x.saves[0].reply.command.action, "save");
    const current = await x.fresh(), row = current.requirements.find(row => row.blockId === proposal.requirementId);
    assert.ok(row, "the actual Worker created the new typed Output row");
    assert.equal(row.content, proposal.spec.original_text); assert.equal(row.spec.value_origins.recipe_template.text, `forma-recipe:${recipeId}@1`);
    assert.deepEqual(row.spec.deliverables.map(value => value.id), proposal.spec.deliverables.map(value => value.id));
    assert.equal(outputRequirementInterpretationNeedsReview(row.spec), false, "only explicit card review supplied confirmation");
    assert.equal(current.confirmedPlan, null); assert.deepEqual(current.results, []); assert.deepEqual(current.grants, []);
    assert.equal(current.requirementSummaries[row.blockId]?.delivery_ready === true, false);
    assert.equal(x.h.store.outputRequirements.retainedWrite(x.h.worker.documentId).status, "acknowledged");
    assert.equal(x.card().snapshot.requirementId, proposal.requirementId); assert.equal(x.card().newDraft, null);
  });
test("an open recipe keeps its exact draft instead of adopting another recipe or replacement identity", { concurrency: false }, async t => {
  const x = await outcomeRecipeSaveFixture(t), original = x.proposal("campaign", ["campaign-image"]); await x.open(original);
  const next = x.proposal("film-continuity", ["script"]);
  assert.equal(await x.controller.stageRecipeDraft(next, { current: () => true, opener: null }), "existing-draft");
  assert.equal(x.card().newDraft.requirementId, original.requirementId); assert.equal(x.saves.length, 0);
});
test("stale source, Document, actor and calling intent cannot open an unsaved recipe", { concurrency: false }, async t => {
  const x = await outcomeRecipeSaveFixture(t), original = x.proposal("executive-deck");
  for (const changed of [{ sourceRevision: "older" }, { expectedRevision: "output:0" }, { scope: { ...original.scope, documentId: "other" } }, { scope: { ...original.scope, authorizationScopeKey: "other" } }])
    assert.equal(await x.controller.stageRecipeDraft({ ...original, ...changed }, { current: () => true, opener: null }), "stale");
  assert.equal(await x.controller.stageRecipeDraft(original, { current: () => false, opener: null }), "stale");
  assert.equal(x.card(), undefined); assert.equal(x.saves.length, 0);
});

// Two local-completion controls, appended after the original fourteen cases.
// Entry authorship uses emitted native handlers, not proposal()/open(). The
// saved branch deliberately makes one real existing Worker Save; Clear itself
// must change no request, canonical/private row, receipt, or fiscal state.
const RECIPE_INPUT_RAW = "  Keep this exact recipe input.\nنص — 元の文章。  ";
function recipeInputNodes(x, tag) {
  const tree = x.f.tree();
  return tree.visible(tag).filter(node => {
    if (node.owner !== x.controller) return false;
    for (let parent = node.parent; parent; parent = parent.parent)
      if (parent.owner === x.controller && parent.tag === "details" && parent.attributes.class === "output-recipe-entry") return true;
    return false;
  });
}
function recipeInputOne(x, tag, predicate = () => true) {
  const nodes = recipeInputNodes(x, tag).filter(predicate);
  assert.equal(nodes.length, 1, "one actual current recipe-entry " + tag); return nodes[0];
}
function recipeInputEffects(x) {
  const tables = ["events", "event_private_payloads", "private_content", "output_commands", "document_jobs",
    "budget_reservations", "budget_counters", "cost_budget_reservations", "cost_budget_counters", "output_execution_grants", "output_operation_slots"];
  return structuredClone({ requests: x.h.requests.map(request => ({ url: request.url, method: request.init.method ?? "GET", body: request.body })),
    rows: Object.fromEntries(tables.map(table => [table, x.h.worker.sqlite.prepare("SELECT * FROM " + table + " ORDER BY rowid").all()])),
    events: x.h.store.events.get(), head: x.h.store.head.get(), content: x.h.store.content.get(),
    snapshot: x.snapshot(), retained: x.h.store.outputRequirements.retainedWrite(x.h.worker.documentId) });
}
async function authorRecipeInput(x, text = RECIPE_INPUT_RAW) {
  const entry = x.f.find("details", node => node.owner === x.controller && node.attributes.class === "output-recipe-entry");
  entry.port.open = true; await x.f.act(entry, "toggle");
  const select = recipeInputOne(x, "select");
  assert.ok(select.children.some(node => node.tag === "option" && node.attributes.value === "campaign"));
  select.port.value = "campaign"; await x.f.act(select, "change");
  const field = recipeInputOne(x, "textarea"); field.port.value = text; await x.f.act(field, "input");
  const file = recipeInputOne(x, "input", node => node.attributes.type === "checkbox" && node.parent?.text === "Campaign images");
  file.port.checked = true; await x.f.act(file, "change");
  assert.equal(recipeInputOne(x, "select").port.value, "campaign");
  assert.equal(recipeInputOne(x, "textarea").port.value, text);
  assert.deepEqual(recipeInputNodes(x, "input").filter(node => node.port.checked).map(node => node.parent.text), ["Campaign images"]);
}
async function previewAuthoredRecipe(x) {
  const preview = recipeInputOne(x, "button", node => node.attributes.type === "submit");
  await x.f.act(recipeInputOne(x, "form"), "submit", { submitter: preview.port });
  const card = x.card(); assert.ok(card?.isConnected && card.hasOpenDraft); assert.equal(card.snapshot, null);
  assert.equal(card.newDraft.originalText, RECIPE_INPUT_RAW);
  assert.equal(card.newDraft.spec.value_origins.recipe_template.text, "forma-recipe:campaign@1");
  assert.deepEqual(card.newDraft.spec.deliverables.map(value => value.id), [card.newDraft.requirementId + ":campaign-image"]);
  return card.newDraft.requirementId;
}
async function discardAuthoredRecipe(x) {
  await x.f.act(x.f.find("button", node => node.owner === x.card() && node.text === "Cancel"));
  await x.f.act(x.f.find("button", node => node.owner === x.card() && node.text === "Discard changes"));
  assert.equal(x.card(), undefined, "the actual card Discard ends only this proposal");
}
async function clearAuthoredRecipeInput(x, clear) {
  assert.ok(clear.port?.isConnected && !clear.hiddenBy); assert.equal(Object.hasOwn(clear.attributes, "disabled"), false);
  clear.port.focus(); const beforeFocus = x.f.trace.length;
  assert.equal(x.h.document.activeElement, clear.port); assert.equal(typeof clear.handlers.click, "function");
  // Await the actual control, then inspect its current native target BEFORE
  // an unrelated finite redraw retires literal ports. No focus is remapped.
  await clear.handlers.click.call(clear.owner, { target: clear.port, currentTarget: clear.port, preventDefault() {}, stopPropagation() {} });
  const target = recipeInputOne(x, "summary", node => Object.hasOwn(node.attributes, "data-output-recipe-focus-return"));
  assert.ok(target.port.isConnected && x.f.renderer.nodes.includes(target.port)); assert.equal(target.owner, x.controller);
  assert.equal(target.port.closest("forma-output-requirements"), x.controller);
  assert.equal(x.h.document.activeElement, target.port, "Clear returns to this current entry summary");
  assert.equal(x.f.trace.slice(beforeFocus).filter(value => value === "focus:summary").length, 1, "one original native target focus call");
  await x.f.settle();
}
for (const ending of ["discard", "saved-close"]) test(`actual recipe entry → ${ending} → explicit no-write Clear recipe input`, { concurrency: false, timeout: 45000 }, async t => {
  const x = await outcomeRecipeSaveFixture(t), source = x.h.store.captureSourceOwnership(), authorization = x.h.store.captureAuthorizationScope();
  const route = x.h.store.route.get(), original = recipeInputEffects(x);
  const owned = () => {
    assert.ok(x.controller.isConnected && x.f.components().includes(x.controller));
    assert.equal(x.controller.store, x.h.store); assert.equal(x.controller.documentId, x.h.worker.documentId);
    assert.equal(x.h.store.route.get(), route); assert.equal(x.h.store.sourceOwnershipActive(source), true);
    assert.equal(x.h.store.authorizationScopeActive(authorization), true);
  };
  await authorRecipeInput(x); const id = await previewAuthoredRecipe(x); owned();
  assert.deepEqual(recipeInputEffects(x), original, "actual entry authorship and preview are local and perform no request");
  if (ending === "discard") {
    await discardAuthoredRecipe(x); assert.equal(x.saves.length, 0);
    assert.deepEqual(recipeInputEffects(x), original, "Discard changes only the actual local card presentation");
  } else {
    await x.acceptInterpretation(); await x.save();
    assert.equal(x.saves.length, 1); const saved = x.saves[0];
    assert.equal(saved.status, 200); assert.equal(saved.reply.command.action, "save");
    assert.equal(saved.body.documentId, x.h.worker.documentId); assert.equal(saved.body.blockId, id);
    assert.equal(saved.body.spec.original_text, RECIPE_INPUT_RAW); assert.equal(saved.reply.appended.length, 1);
    const event = saved.reply.appended[0]; assert.equal(event.type, "BlockCreated"); assert.equal(event.eventId, saved.reply.command.eventId);
    assert.equal(event.payload.block_id, id); assert.deepEqual(event.payload.properties.output_spec, saved.body.spec);
    const current = x.snapshot(), rows = current.requirements.filter(row => row.blockId === id);
    assert.equal(rows.length, 1); assert.equal(rows[0].content, RECIPE_INPUT_RAW); assert.deepEqual(rows[0].spec, saved.body.spec);
    assert.equal(outputRequirementInterpretationNeedsReview(rows[0].spec), false);
    assert.equal(current.confirmedPlan, null); assert.deepEqual(current.results, []); assert.deepEqual(current.grants, []);
    const events = x.h.worker.sqlite.prepare("SELECT * FROM events ORDER BY rowid").all();
    assert.equal(events.length, original.rows.events.length + 1);
    assert.equal(events.filter(row => row.event_id === event.eventId && row.type === "BlockCreated").length, 1);
    const privateRow = x.h.worker.sqlite.prepare("SELECT * FROM event_private_payloads WHERE private_event_id=?").get(event.eventId);
    assert.ok(privateRow); assert.equal(privateRow.document_id, x.h.worker.documentId); assert.equal(privateRow.redacted_at, null);
    assert.deepEqual(JSON.parse(privateRow.private_json).properties.output_spec, saved.body.spec);
    const receipts = x.h.worker.sqlite.prepare("SELECT * FROM output_commands WHERE command_key=?").all(saved.body.clientMutationId);
    assert.equal(receipts.length, 1); assert.equal(receipts[0].event_id, event.eventId); assert.equal(receipts[0].action, "save");
    const retained = x.h.store.outputRequirements.retainedWrite(x.h.worker.documentId);
    assert.equal(retained.status, "acknowledged"); assert.equal(retained.clientMutationId, saved.body.clientMutationId);
    assert.equal(x.card().snapshot.requirementId, id); assert.equal(x.card().newDraft, null); assert.equal(x.card().hasOpenDraft, false);
    const beforeClose = recipeInputEffects(x);
    for (const table of ["document_jobs", "budget_reservations", "budget_counters", "cost_budget_reservations", "cost_budget_counters", "output_execution_grants", "output_operation_slots"])
      assert.deepEqual(beforeClose.rows[table], original.rows[table], "Save does not generate or reserve: " + table);
    await x.f.act(x.f.find("button", node => node.owner === x.controller && node.text === "Close this saved requirement"));
    assert.equal(x.card(), undefined); assert.deepEqual(recipeInputEffects(x), beforeClose, "Close does not remove the saved requirement or receipt");
  }
  owned(); assert.equal(recipeInputOne(x, "select").port.value, "campaign");
  assert.equal(recipeInputOne(x, "textarea").port.value, RECIPE_INPUT_RAW);
  assert.deepEqual(recipeInputNodes(x, "input").filter(node => node.port.checked).map(node => node.parent.text), ["Campaign images"]);
  assert.equal(x.controller.navigationBlocked, true); assert.equal(x.controller.commandDepartureBlocked, true);
  const beforeClear = recipeInputEffects(x);
  const clear = recipeInputOne(x, "button", node => node.text === "Clear recipe input");
  assert.equal(clear.attributes.type, "button"); assert.equal(Object.hasOwn(clear.attributes, "disabled"), false);
  assert.ok(recipeInputNodes(x, "p").some(node => node.text === "Clears only this entry’s recipe, text and file choices. Saved requirements are unchanged."));
  await clearAuthoredRecipeInput(x, clear); owned();
  assert.deepEqual(recipeInputEffects(x), beforeClear, "Clear makes zero requests and preserves all canonical/private/fiscal rows and the original receipt");
  assert.equal(recipeInputOne(x, "select").port.value, ""); assert.equal(recipeInputOne(x, "textarea").port.value, "");
  assert.equal(recipeInputNodes(x, "input").filter(node => node.attributes.type === "checkbox").length, 0);
  assert.equal(x.f.find("details", node => node.owner === x.controller && node.attributes.class === "output-recipe-entry").port.open, true);
  assert.equal(x.controller.navigationBlocked, false); assert.equal(x.controller.commandDepartureBlocked, false);
  assert.ok(x.f.tree().visible("p").some(node => node.owner === x.controller && node.attributes.role === "status"
    && node.text === "Recipe input cleared. Saved requirements are unchanged."));
  assert.equal(x.saves.length, ending === "discard" ? 0 : 1);
  if (ending === "discard") {
    // The cleared entry remains useful; an open new proposal and IME still
    // protect their own work rather than making Clear an alternate Discard.
    await authorRecipeInput(x); const freshId = await previewAuthoredRecipe(x); assert.notEqual(freshId, id);
    assert.equal(Object.hasOwn(recipeInputOne(x, "button", node => node.text === "Clear recipe input").attributes, "disabled"), true);
    await discardAuthoredRecipe(x);
    await x.f.act(recipeInputOne(x, "form"), "compositionstart");
    assert.equal(Object.hasOwn(recipeInputOne(x, "button", node => node.text === "Clear recipe input").attributes, "disabled"), true);
    assert.equal(recipeInputOne(x, "textarea").port.value, RECIPE_INPUT_RAW);
    await x.f.act(recipeInputOne(x, "form"), "compositionend");
    await clearAuthoredRecipeInput(x, recipeInputOne(x, "button", node => node.text === "Clear recipe input"));
    assert.equal(x.controller.navigationBlocked, false); assert.deepEqual(recipeInputEffects(x), original);
  }
});

// One partial-input control after the original fourteen and the two Clear
// endings. The owned asset is explicit isolated setup, not a Clear effect.
test("actual readable incomplete Output inventory keeps recipe-only input clearable without write eligibility", { concurrency: false, timeout: 45000 }, async t => {
  const { outputTestDatabase } = await import("./output-server-test-helpers.mjs");
  const { png } = await import("./output-asset-fixtures.mjs");
  const x = await outcomeRecipeSaveFixture(t), documentId = x.h.worker.documentId;
  // Reuse the established in-memory MEDIA binding only. Its blank companion
  // database is not the app database and is immediately closed.
  const media = outputTestDatabase(); media.sqlite.close();
  const oldMedia = x.h.worker.env.MEDIA; x.h.worker.env.MEDIA = media.env.MEDIA;
  t.after(() => { x.h.worker.env.MEDIA = oldMedia; media.media.clear(); });
  const originalIntercept = x.h.intercept, uploads = [], reads = [];
  const assetUrl = "/api/output-requirements/assets?documentId=" + encodeURIComponent(documentId);
  const readUrl = "/api/output-requirements?documentId=" + encodeURIComponent(documentId);
  let observeRead = false;
  x.h.intercept = async request => {
    if (request.url === assetUrl && request.init.method === "POST" || observeRead && request.url === readUrl && (request.init.method ?? "GET") === "GET") {
      const response = await x.h.worker.request(request.url, request.init);
      const observed = { request, status: response.status, body: await response.clone().json() };
      (request.url === assetUrl ? uploads : reads).push(observed);
      return response;
    }
    return originalIntercept?.(request);
  };
  t.after(() => { x.h.intercept = originalIntercept; });
  const setupBefore = recipeInputEffects(x), bytes = png({ width: 2, height: 2 });
  const sha256 = Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex");
  const mutationId = crypto.randomUUID(), revision = x.snapshot().revision;
  const result = await x.h.store.uploadOutputAsset(documentId, new File([bytes], "recipe-clear-owned.png", { type: "image/png" }), revision, mutationId, true);
  await x.h.worker.drainBackground(); await x.f.settle();
  assert.equal(result.status, "saved"); assert.equal(uploads.length, 1); assert.equal(uploads[0].status, 200);
  const uploaded = uploads[0], headers = new Headers(uploaded.request.init.headers);
  assert.equal(headers.get("x-output-client-mutation-id"), mutationId); assert.equal(headers.get("x-output-expected-revision"), revision);
  assert.equal(headers.get("x-output-rights-confirmed"), "true");
  assert.equal(headers.get("x-output-filename"), "recipe-clear-owned.png");
  assert.deepEqual(new Uint8Array(await uploaded.request.init.body.arrayBuffer()), bytes);
  assert.equal(uploaded.body.command.action, "adopt"); assert.equal(uploaded.body.appended.length, 1);
  const event = uploaded.body.appended[0], assetId = uploaded.body.command.assetId;
  assert.equal(event.type, "OutputAssetAdopted"); assert.equal(event.eventId, uploaded.body.command.eventId);
  assert.equal(event.payload.document_id, documentId); assert.equal(event.payload.asset_id, assetId);
  assert.equal(event.payload.asset.inspection.sha256, sha256);
  assert.equal(x.h.store.events.get().filter(row => row.eventId === event.eventId && row.type === "OutputAssetAdopted").length, 1);
  const savedAsset = x.h.worker.sqlite.prepare("SELECT * FROM output_assets WHERE asset_id=?").get(assetId);
  assert.ok(savedAsset); assert.equal(savedAsset.document_id, documentId); assert.equal(savedAsset.content_sha256, sha256);
  assert.equal(savedAsset.created_event_id, event.eventId);
  const savedBody = x.h.worker.sqlite.prepare("SELECT * FROM event_private_payloads WHERE private_event_id=?").get(event.eventId);
  assert.ok(savedBody); assert.equal(savedBody.document_id, documentId); assert.equal(savedBody.redacted_at, null);
  assert.deepEqual(JSON.parse(savedBody.private_json).asset, event.payload.asset);
  const command = x.h.worker.sqlite.prepare("SELECT * FROM output_commands WHERE command_key=?").all(mutationId);
  assert.equal(command.length, 1); assert.equal(command[0].action, "adopt"); assert.equal(command[0].event_id, event.eventId);
  const storage = x.h.worker.sqlite.prepare("SELECT * FROM output_asset_storage_writes WHERE asset_id=?").get(assetId);
  assert.equal(storage.status, "written"); assert.equal(storage.write_acknowledged, 1); assert.equal(storage.publication_event_id, event.eventId);
  assert.equal(media.media.size, 1); assert.deepEqual(media.media.get(savedAsset.storage_key).bytes, bytes);
  const transport = x.h.store.outputRequirements.retainedWrite(documentId);
  assert.equal(transport.status, "acknowledged"); assert.equal(transport.clientMutationId, mutationId); assert.equal(transport.action, "adopt");
  assert.equal(x.snapshot().assets.filter(asset => asset.id === assetId && asset.sha256 === sha256 && asset.available).length, 1);
  assert.equal(x.snapshot().permissions.canAuthor, true); assert.deepEqual(x.snapshot().requirements, []);
  assert.equal(x.snapshot().confirmedPlan, null); assert.deepEqual(x.snapshot().results, []); assert.deepEqual(x.snapshot().grants, []);
  const setupAfter = recipeInputEffects(x);
  assert.equal(setupAfter.rows.events.length, setupBefore.rows.events.length + 1);
  for (const table of ["document_jobs", "budget_reservations", "budget_counters", "cost_budget_reservations", "cost_budget_counters", "output_execution_grants", "output_operation_slots"])
    assert.deepEqual(setupAfter.rows[table], setupBefore.rows[table], "isolated owned upload does not generate or reserve: " + table);
  assert.equal(x.saves.length, 0);
  // Observation floor: the one real owned upload and its original hydration
  // have completed. No fixture mutation occurs below this point.
  const retainedState = () => ({ ...recipeInputEffects(x),
    assets: x.h.worker.sqlite.prepare("SELECT * FROM output_assets ORDER BY rowid").all(),
    storage: x.h.worker.sqlite.prepare("SELECT * FROM output_asset_storage_writes ORDER BY rowid").all(),
    media: structuredClone([...media.media]) });
  const floor = retainedState(), source = x.h.store.captureSourceOwnership(), authorization = x.h.store.captureAuthorizationScope();
  const route = x.h.store.route.get(), scope = structuredClone(x.snapshot().scope);
  const owned = () => {
    assert.ok(x.controller.isConnected && x.f.components().includes(x.controller));
    assert.equal(x.controller.store, x.h.store); assert.equal(x.controller.documentId, documentId);
    assert.equal(x.h.store.projection.get().documentId, documentId); assert.equal(x.h.store.route.get(), route);
    assert.equal(x.h.store.sourceOwnershipActive(source), true); assert.equal(x.h.store.authorizationScopeActive(authorization), true);
    assert.deepEqual(x.snapshot().scope, scope); assert.equal(scope.actorUserId, x.h.store.session.get().user.userId);
    const session = x.h.store.session.get(), permissions = session.projectContext?.permissions ?? session.capabilities;
    assert.ok(permissions.includes("project.read") && permissions.includes("project.author"), "the actual author/read authority did not change");
  };
  const entry = x.f.find("details", node => node.owner === x.controller && node.attributes.class === "output-recipe-entry");
  entry.port.open = true; await x.f.act(entry, "toggle");
  const select = recipeInputOne(x, "select");
  assert.ok(select.children.some(node => node.tag === "option" && node.attributes.value === "campaign"));
  select.port.value = "campaign"; await x.f.act(select, "change");
  assert.equal(recipeInputOne(x, "select").port.value, "campaign"); assert.equal(recipeInputOne(x, "textarea").port.value, "");
  assert.equal(recipeInputNodes(x, "input").filter(node => node.port.checked).length, 0);
  assert.equal(x.card(), undefined); assert.equal(x.controller.navigationBlocked, true); assert.equal(x.controller.commandDepartureBlocked, true);
  assert.deepEqual(retainedState(), floor, "recipe-only native preparation is local");
  const originalList = media.env.MEDIA.list, inventoryCalls = [];
  media.env.MEDIA.list = async options => { inventoryCalls.push(structuredClone(options)); throw new Error("recipe-clear-inventory-unavailable"); };
  observeRead = true;
  try { await x.h.store.outputRequirements.ensure(documentId, { force: true }); }
  finally { observeRead = false; media.env.MEDIA.list = originalList; }
  await x.h.worker.drainBackground(); await x.f.settle(); owned();
  assert.equal(reads.length, 1); assert.equal(reads[0].status, 200);
  assert.equal(reads[0].request.url, readUrl); assert.equal(reads[0].request.init.method ?? "GET", "GET");
  assert.equal(inventoryCalls.length, 1); assert.ok(savedAsset.storage_key.startsWith(inventoryCalls[0].prefix));
  assert.equal(inventoryCalls[0].limit, 1000); assert.deepEqual(inventoryCalls[0].include, ["customMetadata", "httpMetadata"]);
  const resource = x.h.store.outputRequirements.resource(documentId);
  assert.equal(resource.state, "ready"); assert.equal(Boolean(resource.accessLost || resource.privateUnavailable), false);
  assert.deepEqual(resource.snapshot, reads[0].body); assert.equal(resource.snapshot.permissions.canAuthor, false);
  assert.equal(resource.snapshot.sourceVerification.status, "verified");
  assert.ok(resource.snapshot.capabilities.limitationCodes.includes("output_custody_inventory_unavailable"));
  assert.equal(resource.snapshot.assets.filter(asset => asset.id === assetId && asset.available === false).length, 1);
  const afterRead = retainedState();
  assert.deepEqual(afterRead.requests, [...floor.requests, { url: readUrl, method: "GET", body: null }]);
  for (const key of ["rows", "events", "head", "content", "retained", "assets", "storage", "media"])
    assert.deepEqual(afterRead[key], floor[key], "the original incomplete inventory read has no canonical/private/receipt/fiscal effect: " + key);
  assert.equal(x.controller.navigationBlocked, true); assert.equal(x.controller.commandDepartureBlocked, true);
  // Desired regression boundary: partial retained input remains reachable even
  // though a complete write model is unavailable. No permission is fabricated.
  const retainedSelect = recipeInputOne(x, "select"); assert.equal(retainedSelect.port.value, "campaign");
  assert.equal(Object.hasOwn(retainedSelect.attributes, "disabled"), true);
  assert.equal(recipeInputOne(x, "textarea").port.value, "");
  assert.equal(Object.hasOwn(recipeInputOne(x, "button", node => node.attributes.type === "submit").attributes, "disabled"), true);
  const clear = recipeInputOne(x, "button", node => node.text === "Clear recipe input");
  assert.equal(clear.attributes.type, "button"); assert.equal(Object.hasOwn(clear.attributes, "disabled"), false);
  clear.port.focus(); const focusStart = x.f.trace.length;
  assert.equal(x.h.document.activeElement, clear.port); assert.equal(typeof clear.handlers.click, "function");
  await clear.handlers.click.call(clear.owner, { target: clear.port, currentTarget: clear.port, preventDefault() {}, stopPropagation() {} });
  const tree = x.f.tree(), notices = tree.visible("p").filter(node => node.owner === x.controller && node.attributes.role === "status"
    && node.text === "Recipe input cleared. Saved requirements are unchanged." && Object.hasOwn(node.attributes, "data-output-plan-focus-return"));
  assert.equal(notices.length, 1); const notice = notices[0];
  assert.equal(notice.attributes.tabindex, "-1"); assert.ok(notice.port.isConnected && x.f.renderer.nodes.includes(notice.port));
  assert.equal(notice.port.closest("forma-output-requirements"), x.controller);
  assert.equal(x.h.document.activeElement, notice.port, "when the read-only entry disappears, Clear focuses its actual current result status");
  assert.equal(x.f.trace.slice(focusStart).filter(value => value === "focus:p").length, 1);
  assert.equal(tree.nodes.filter(node => node.owner === x.controller && node.tag === "details" && node.attributes.class === "output-recipe-entry").length, 0);
  await x.f.settle(); owned();
  assert.deepEqual(retainedState(), afterRead, "Clear performs no request and preserves the original asset, private data, receipt and fiscal state");
  assert.equal(x.controller.navigationBlocked, false); assert.equal(x.controller.commandDepartureBlocked, false);
  assert.equal(x.snapshot().permissions.canAuthor, false); assert.equal(x.card(), undefined); assert.equal(x.saves.length, 0);
});

// D337: reuse the complete existing native entry/card/Store/Worker fixture.
// These four cases author and inspect only; they do not acknowledge the
// interpretation, Save, confirm a plan, invoke a provider or create a receipt.
import { FORMA_OUTPUT_REQUIREMENT_MESSAGES as D_MISSING_BASIS_MESSAGES } from "../src/components/design-system/locales/output-requirement-messages.ts";
import { outcomeRecipeDraftMessage as dMissingBasisDraftMessage } from "../src/components/design-system/locales/outcome-recipe-draft-messages.ts";
import { outputRequirementInterpretationBasis } from "../src/model/output-requirements.ts";

const D_MISSING_BASIS_COPY = [
  ["en", "These requirements have no recorded interpretation basis. The displayed decisions are preserved and need explicit review."],
  ["fr", "Ces exigences ne comportent aucune base d’interprétation enregistrée. Les décisions affichées sont conservées et nécessitent un examen explicite."],
  ["ar", "لا تتضمن هذه المتطلبات أساس تفسير مسجّلًا. تم الاحتفاظ بالقرارات المعروضة وتحتاج إلى مراجعة صريحة."],
  ["ja", "この要件には解釈の基になった文章が記録されていません。表示中の決定内容は保持していますが、明示的な確認が必要です。"],
];
for (const [locale, expected] of D_MISSING_BASIS_COPY)
  test("D newly authored recipe preserves unreviewed decisions without an age claim / " + locale,
    { concurrency: false, timeout: 45000 }, async t => {
      const x = await outcomeRecipeSaveFixture(t, { locale }), copy = D_MISSING_BASIS_MESSAGES[locale];
      const source = x.h.store.captureSourceOwnership(), authorization = x.h.store.captureAuthorizationScope();
      const route = x.h.store.route.get(), original = recipeInputEffects(x);
      const entry = x.f.find("details", node => node.owner === x.controller && node.attributes.class === "output-recipe-entry");
      entry.port.open = true; await x.f.act(entry, "toggle");
      const recipe = recipeInputOne(x, "select");
      assert.ok(recipe.children.some(node => node.tag === "option" && node.attributes.value === "executive-deck"));
      recipe.port.value = "executive-deck"; await x.f.act(recipe, "change");
      const wording = recipeInputOne(x, "textarea");
      wording.port.value = RECIPE_INPUT_RAW; await x.f.act(wording, "input");
      const file = recipeInputOne(x, "input", node => node.attributes.type === "checkbox");
      file.port.checked = true; await x.f.act(file, "change");
      const preview = recipeInputOne(x, "button", node => node.attributes.type === "submit");
      assert.equal(Object.hasOwn(preview.attributes, "disabled"), false);
      await x.f.act(recipeInputOne(x, "form"), "submit", { submitter: preview.port });

      const card = x.card(), ActualCard = x.f.renderer.registry["forma-output-requirement-card"];
      assert.equal(typeof ActualCard, "function");
      assert.ok(card instanceof ActualCard && card.isConnected && card.parentElement === x.controller);
      assert.equal(card.store, x.h.store); assert.equal(card.hasOpenDraft, true);
      assert.equal(card.snapshot, null); assert.equal(card.resourceState, "ready");
      assert.equal(card.originalSaveId, ""); assert.ok(card.newDraft);
      const draft = card.newDraft, id = draft.requirementId, spec = structuredClone(draft.spec);
      assert.ok(typeof id === "string" && id);
      assert.deepEqual(draft.scope, { projectId: x.snapshot().projectId, documentId: x.h.worker.documentId,
        authorizationScopeKey: authorization.key });
      assert.equal(draft.originalText, RECIPE_INPUT_RAW); assert.equal(spec.original_text, RECIPE_INPUT_RAW);
      assert.equal(spec.id, id); assert.equal(spec.value_origins.recipe_template.text, "forma-recipe:executive-deck@1");
      assert.deepEqual(spec.deliverables.map(value => value.id), [id + ":deck"]);
      const deck = spec.deliverables[0];
      assert.equal(deck.media_kind, "slides"); assert.equal(deck.quantity.kind, "unknown");
      assert.equal(deck.content_quantity.kind, "unknown"); assert.equal(deck.source_scope.kind, "unknown");
      assert.equal(deck.coverage.kind, "unresolved"); assert.equal(deck.original_text, RECIPE_INPUT_RAW);
      assert.deepEqual(draft.planSuggestions, { countPolicies: {}, suggestedCounts: {} });
      assert.equal(Object.hasOwn(spec.value_origins, "interpretation_basis"), false);
      assert.equal(outputRequirementInterpretationBasis(spec), null);
      assert.equal(outputRequirementInterpretationNeedsReview(spec), true);
      assert.equal(x.snapshot().requirements.some(row => row.blockId === id), false);
      assert.ok(x.nodes().some(node => node.tag === "span" && !node.hiddenBy
        && node.text === dMissingBasisDraftMessage(locale, "unsaved")));

      // Open only the existing inline decision disclosure. Do not acknowledge
      // its checkbox or activate its acceptance/Save handlers.
      const summaries = x.nodes().filter(node => node.tag === "summary"
        && node.text === copy["output.requirement.reviewRetainedDecisions"]);
      assert.equal(summaries.length, 1); assert.equal(summaries[0].hiddenBy, null);
      assert.equal(summaries[0].parent.tag, "details");
      summaries[0].parent.port.open = true; await x.f.settle();
      const checks = x.nodes().filter(node => node.tag === "input" && node.attributes.type === "checkbox"
        && String(node.attributes["aria-label"]).startsWith(copy["output.requirement.retainedReviewAcknowledgment"]));
      assert.equal(checks.length, 1); assert.equal(checks[0].hiddenBy, null);
      assert.equal(checks[0].port.checked, false); assert.equal(checks[0].port.matches(":disabled"), false);
      const accepts = x.nodes().filter(node => node.tag === "button"
        && node.text === copy["output.requirement.acceptRetainedInterpretation"]);
      assert.equal(accepts.length, 1); assert.equal(accepts[0].hiddenBy, null);
      assert.equal(Object.hasOwn(accepts[0].attributes, "disabled"), true);
      const saves = x.nodes().filter(node => node.tag === "button" && node.attributes.type === "submit");
      assert.equal(saves.length, 1); assert.equal(saves[0].hiddenBy, null);
      assert.equal(Object.hasOwn(saves[0].attributes, "disabled"), true);
      assert.equal(saves[0].port.matches(":disabled"), true);

      // All pre-existing custody/guard/no-effect evidence precedes the intended
      // old-copy failure. A wording correction cannot fabricate interpretation.
      assert.equal(x.card(), card); assert.equal(card.snapshot, null);
      assert.equal(card.newDraft.requirementId, id); assert.deepEqual(card.newDraft.spec, spec);
      assert.equal(recipeInputOne(x, "select").port.value, "executive-deck");
      assert.equal(recipeInputOne(x, "textarea").port.value, RECIPE_INPUT_RAW);
      assert.equal(x.h.store.route.get(), route); assert.equal(x.h.store.sourceOwnershipActive(source), true);
      assert.equal(x.h.store.authorizationScopeActive(authorization), true);
      assert.equal(x.controller.navigationBlocked, true); assert.equal(x.controller.commandDepartureBlocked, true);
      assert.equal(x.saves.length, 0); assert.deepEqual(recipeInputEffects(x), original,
        "native recipe Review sends no request and preserves all canonical/private/fiscal rows and receipts");
      const headings = x.nodes().filter(node => node.tag === "h4"
        && node.text === copy["output.requirement.interpretationNeedsReview"]);
      assert.equal(headings.length, 1); assert.equal(headings[0].hiddenBy, null);
      const warning = headings[0].parent;
      assert.equal(warning.tag, "div");
      assert.ok(String(warning.attributes.class).split(/\s+/u).includes("output-requirement-warning"));
      const paragraphs = warning.children.filter(node => typeof node !== "string" && node.tag === "p");
      assert.equal(paragraphs.length, 2);
      assert.equal(paragraphs[0].text, copy["output.requirement.interpretationWarning"]);
      assert.equal(paragraphs[1].text, copy["output.requirement.interpretationBasisUnknown"],
        "the actual missing-basis branch still uses its existing localized message");
      assert.equal(paragraphs[1].text, expected,
        "a genuinely unsaved recipe is unreviewed, not an older saved requirement");
    });
