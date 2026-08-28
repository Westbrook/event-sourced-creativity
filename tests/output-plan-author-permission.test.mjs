// Actual controller bodies and real plan compiler with synthetic Lit/store/focus boundaries.
// These assertions do not substitute for DOM, browser scheduling, or server authorization tests.
import assert from "node:assert/strict";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = process.env.FORMA_OUTPUT_REGRESSION_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => import(pathToFileURL(resolve(root, path)).href);
const [{ binding, controllerFixture, deferred, eventHandlers, loadController, region, templates }, domain, requirements] = await Promise.all([
  source("tests/output-ui-source-harness.mjs"), source("src/model/output-plan.ts"), source("src/model/output-requirements.ts"),
]);
const attributes = (value, name) => value.values.flatMap((candidate, index) => value.strings[index].trimEnd().endsWith(`${name}=`) ? [candidate] : []);
const translated = (value, key) => value.values.some((entry) => typeof entry === "string" && entry.includes(`output.delivery.${key}`));
const event = (value = "changed-after-revocation") => ({ preventDefault() {}, stopPropagation() {}, target: { value, checked: true } });

async function openReview() {
  const fixture = await controllerFixture();
  let scopeKey = "fixture-actor:project:1";
  fixture.store.captureAuthorizationScope = () => ({ key: scopeKey, shared: false });
  fixture.store.authorizationScopeActive = (scope) => scope?.key === scopeKey;
  const snapshot = fixture.snapshots.get("doc-a"), row = snapshot.requirements[0];
  const parsed = requirements.parseOutputRequirement({ id: row.blockId, Type: "Output", Subtype: "Executive summary",
    Content: "1 slideshow with 5-15 slides, one podcast episode outlining the document, a series of TikTok style videos outlining the various parts of the document." }).spec;
  assert.ok(parsed);
  parsed.deliverables.push({ id: "fixture-optional-image", label: "SYNTHETIC optional image", media_kind: "image", required: false,
    quantity: { kind: "exact", unit: "image", value: 1 }, source_scope: { kind: "document" }, coverage: { kind: "document_context" },
    original_text: "Optionally one proof image.", value_origins: {} });
  parsed.original_text += " Optionally one proof image.";
  const spec = requirements.confirmOutputRequirementInterpretation(parsed), deck = spec.deliverables.find((group) => group.media_kind === "slides");
  const options = { count_policies: { [`${deck.id}:slide`]: { kind: "flexible", unit: "slide", min: 5, max: 15 } }, suggested_counts: { [deck.id]: 8 }, selected_optional_ids: [] };
  Object.assign(row, { spec, preserved: structuredClone(spec), content: spec.original_text, subtype: spec.label, status: "valid", planSuggestions: options });
  const plan = domain.compileOutputPlan([spec], { document_id: snapshot.documentId, source_revision: snapshot.sourceRevision,
    requirement_revision: snapshot.requirementRevision, ...options });
  snapshot.confirmedPlan = { ...snapshot.confirmedPlan, plan, confirmationOptions: options,
    targetContractDigests: Object.fromEntries(plan.targets.map((target) => [target.id, `fixture-contract-${target.id}`])) };
  snapshot.assets = []; snapshot.results = [];
  snapshot.summary = domain.summarizeOutputPlan(plan, [], { state: "ready", source_revision: snapshot.sourceRevision, requirement_revision: snapshot.requirementRevision });
  snapshot.requirementSummaries = { [row.blockId]: snapshot.summary };
  const focuses = { opener: 0, review: 0, fallback: 0 };
  const opener = { isConnected: true, disabled: false, focus() { focuses.opener++; } };
  class Base {
    constructor() { this.store = fixture.store; this.isConnected = true; this.updateComplete = Promise.resolve(); this.i18n = fixture.controller.i18n; }
    requestUpdate() {}
    connectedCallback() { this.isConnected = true; }
    disconnectedCallback() { this.isConnected = false; }
    querySelector(selector) {
      if (selector === ".output-plan-review") return { focus() { focuses.review++; } };
      if (selector === "[data-output-plan-focus-return]") return { focus() { focuses.fallback++; } };
      return null;
    }
  }
  const Controller = await loadController(Base, { compileOutputPlan: domain.compileOutputPlan });
  const controller = new Controller(); controller.documentId = "doc-a"; controller.surface = "deliver";
  controller.willUpdate(new Map());
  const open = () => {
    const action = eventHandlers(controller.render(), "click").find((handler) => handler.toString().includes("#openPlan(event.currentTarget)"));
    assert.ok(action, "the actual author toolbar exposes a plan opener");
    action.call(controller, { currentTarget: opener });
  };
  open(); await controller.updateComplete;
  const review = () => region(controller.render(), 'class="output-plan-review"');
  const amendment = () => region(review(), '<textarea rows="2"');
  const countEditor = () => templates(review()).find((entry) => entry.strings.some((text) => text.includes("<select .value=")));
  const optional = () => templates(review()).find((entry) => translated(entry, "optionalSelection"));
  const comparison = () => region(review(), 'class="output-plan-comparison"');
  const cancel = () => eventHandlers(review(), "click").find((handler) => handler.toString().includes("#closePlan()"))();
  const publish = (change, update = true) => {
    const latest = structuredClone(fixture.snapshots.get("doc-a")); change(latest); fixture.snapshots.set("doc-a", latest);
    if (update) controller.willUpdate(new Map());
  };
  const author = (allowed, update = true) => publish((latest) => { latest.permissions.canAuthor = allowed; }, update);
  return { fixture, controller, focuses, opener, open, review, amendment, countEditor, optional, comparison, cancel, publish, author,
    changeScope() { scopeKey = "fixture-actor:project:2"; controller.willUpdate(new Map()); } };
}

function assertReadOnly(f) {
  const rendered = f.review();
  assert.equal(binding(rendered, "?disabled"), true, "Confirm is disabled before any attempted submission");
  assert.equal(binding(f.amendment(), "?disabled"), true);
  assert.equal(binding(f.countEditor(), "?disabled"), true, "count controls inherit the disabled fieldset");
  assert.equal(binding(f.optional(), "?disabled"), true);
  assert.ok(JSON.stringify(rendered).includes("output.delivery.planAuthorPermissionLost"));
  assert.ok(JSON.stringify(rendered).includes("Your local choices are retained for inspection"));
  assert.equal(f.fixture.requests.length, 0);
}

test("clean open plan becomes explicitly read-only when current author permission is lost", async () => {
  const f = await openReview(), old = f.review();
  assert.equal(binding(old, "?disabled"), false);
  assert.equal(binding(f.countEditor(), "?disabled"), false);
  assert.equal(binding(f.amendment(), "?disabled"), false);
  f.author(false); assertReadOnly(f);
  const expected = JSON.stringify(f.review());
  for (const kind of ["input", "change"]) for (const handler of eventHandlers(old, kind)) handler(event());
  await eventHandlers(old, "submit")[0].call(f.controller, event());
  assert.equal(JSON.stringify(f.review()), expected, "stale rendered handlers cannot create a local edit after revocation");
  assert.equal(f.fixture.requests.length, 0);
});

test("unfinished exact count, separate aim, optional choices, and amendment survive author loss without further edits", async () => {
  const f = await openReview();
  eventHandlers(f.countEditor(), "change")[0](event("exact"));
  const exact = templates(f.countEditor()).find((entry) => translated(entry, "planExactCount"));
  eventHandlers(exact, "input")[0](event("11e"));
  const aim = templates(f.countEditor()).find((entry) => translated(entry, "suggestedAim"));
  eventHandlers(aim, "input")[0](event("9"));
  eventHandlers(f.optional(), "change")[0](event());
  eventHandlers(f.amendment(), "input")[0](event("Keep this unfinished local amendment."));
  const rawCount = templates(f.countEditor()).flatMap((entry) => attributes(entry, ".value")), rawAmendment = binding(f.amendment(), ".value");
  assert.ok(rawCount.includes("11e"));
  const old = f.review();
  f.author(false); assertReadOnly(f);
  assert.deepEqual(templates(f.countEditor()).flatMap((entry) => attributes(entry, ".value")), rawCount);
  assert.equal(binding(f.amendment(), ".value"), rawAmendment);
  const expected = JSON.stringify(f.review());
  for (const kind of ["input", "change"]) for (const handler of eventHandlers(old, kind)) handler(event());
  for (const handler of eventHandlers(f.comparison(), "change")) handler(event());
  for (const handler of eventHandlers(f.comparison(), "click")) handler();
  await eventHandlers(f.review(), "submit")[0].call(f.controller, event());
  assert.equal(JSON.stringify(f.review()), expected);
  assert.equal(f.fixture.requests.length, 0);
});

test("an acknowledged existing conflict loses its acknowledgment on revocation and cannot be staged or discarded", async () => {
  const f = await openReview();
  eventHandlers(f.amendment(), "input")[0](event("Retain my reviewed proposal."));
  f.publish((latest) => { latest.sourceRevision = "source-collaborator-new"; });
  eventHandlers(f.comparison(), "change")[0](event());
  assert.equal(binding(f.comparison(), ".checked"), true);
  const oldComparison = f.comparison();
  f.author(false); assertReadOnly(f);
  assert.equal(binding(f.comparison(), ".checked"), false);
  assert.ok(attributes(f.comparison(), "?disabled").every((value) => value === true));
  const expected = JSON.stringify(f.review());
  for (const handler of eventHandlers(oldComparison, "change")) handler(event());
  for (const handler of eventHandlers(oldComparison, "click")) handler();
  assert.equal(JSON.stringify(f.review()), expected);
  assert.equal(binding(f.amendment(), ".value"), "Retain my reviewed proposal.");
});

test("latest authority blocks a retained event handler even before the next willUpdate", async () => {
  const f = await openReview(), old = f.review();
  f.author(false, false);
  for (const handler of eventHandlers(old, "input")) handler(event());
  for (const handler of eventHandlers(old, "change")) handler(event());
  await eventHandlers(old, "submit")[0].call(f.controller, event());
  f.controller.willUpdate(new Map()); assertReadOnly(f);
  assert.equal(binding(f.amendment(), ".value"), "");
  assert.equal(binding(f.countEditor(), ".value"), "flexible");
});

test("Cancel retains a revoked-author draft and focuses the same-view heading when its author-only opener was removed", async () => {
  const f = await openReview();
  eventHandlers(f.amendment(), "input")[0](event("Keep after closing."));
  f.author(false); f.opener.isConnected = false;
  assert.ok(templates(f.controller.render()).some((entry) => entry.strings.some((text) => text.includes('tabindex="-1" data-output-plan-focus-return'))));
  f.cancel(); await f.controller.updateComplete;
  assert.equal(f.focuses.fallback, 1); assert.equal(f.focuses.opener, 0);
  assert.ok(!templates(f.controller.render()).some((entry) => entry.strings.some((text) => text.includes('class="output-plan-review"'))));
  f.author(true); f.opener.isConnected = true; f.open(); await f.controller.updateComplete;
  assert.equal(binding(f.amendment(), ".value"), "Keep after closing.");
  assert.equal(binding(f.amendment(), "?disabled"), false);
  assert.equal(f.fixture.requests.length, 0);
});

test("Cancel skips a connected disabled opener and uses the same-view heading", async () => {
  const f = await openReview(); f.opener.disabled = true;
  f.cancel(); await f.controller.updateComplete;
  assert.equal(f.focuses.fallback, 1); assert.equal(f.focuses.opener, 0);
});

test("ordinary Cancel restores the connected enabled opener", async () => {
  const f = await openReview(); f.cancel(); await f.controller.updateComplete;
  assert.equal(f.focuses.opener, 1); assert.equal(f.focuses.fallback, 0);
});

test("a delayed close never restores opener or fallback focus after a Document or authorization-scope change", async () => {
  for (const transition of ["document", "scope"]) {
    const f = await openReview(), update = deferred();
    f.controller.updateComplete = update.promise; f.opener.isConnected = false;
    f.cancel();
    if (transition === "document") { f.controller.documentId = "doc-b"; f.controller.willUpdate(new Map()); }
    else f.changeScope();
    update.resolve(); await update.promise;
    assert.equal(f.focuses.opener, 0, transition); assert.equal(f.focuses.fallback, 0, transition);
  }
});

test("the amendment field describes verbatim JSON/CSV export before confirmation and associates the notice accessibly", async () => {
  const f = await openReview(), field = f.amendment();
  assert.ok(JSON.stringify(field).includes("This exact reason appears in every downloaded JSON and CSV manifest."));
  assert.ok(JSON.stringify(field).includes("safe to share with the recipients"));
  assert.equal(binding(field, "aria-describedby"), "output-amendment-privacy-doc-a");
  assert.equal(binding(field, "aria-invalid"), "false");
  assert.equal(binding(field, "maxlength"), 2000);
  assert.equal(f.fixture.requests.length, 0);
});

for (const [name, raw] of [
  ["bidi formatting character", "Recipient text\u202e"],
  ["zero-width joiner", "Recipient\u200dtext"],
  ["BOM that trim would erase", "\ufeff"],
  ["control character", "Recipient\u0000text"],
  ["overlong reason", "x".repeat(2001)],
]) test(`invalid amendment ${name} remains editable, visible, and uncommitted`, async () => {
  const f = await openReview();
  eventHandlers(f.amendment(), "input")[0](event(raw));
  assert.equal(binding(f.amendment(), ".value"), raw);
  assert.equal(binding(f.amendment(), "aria-invalid"), "true");
  assert.equal(binding(f.amendment(), "aria-describedby"), "output-amendment-privacy-doc-a output-amendment-error-doc-a");
  assert.ok(JSON.stringify(f.amendment()).includes("output.delivery.amendmentReasonInvalid"));
  const confirm = templates(f.review()).find((part) => part.values.some((value) => typeof value === "string" && value.includes("Confirm requirements · no generation")));
  const disabled = attributes(confirm, "?disabled").at(-1);
  assert.equal(disabled, true);
  await eventHandlers(f.review(), "submit")[0].call(f.controller, event());
  assert.equal(f.fixture.requests.length, 0, "even direct submission cannot commit an invalid immutable reason");
  f.cancel(); await f.controller.updateComplete; f.open(); await f.controller.updateComplete;
  assert.equal(binding(f.amendment(), ".value"), raw, "Cancel and reopening preserve the correction draft");
  eventHandlers(f.amendment(), "input")[0](event("Recipient-safe correction."));
  assert.equal(binding(f.amendment(), "aria-invalid"), "false");
  assert.equal(f.fixture.requests.length, 0, "correcting prose does not auto-confirm or generate");
});

test("a valid nonblank amendment reaches Confirm verbatim and survives a failed commit", async () => {
  const f = await openReview(), raw = "  Recipient-safe reason.\n\tKeep the accepted examples.  ";
  eventHandlers(f.amendment(), "input")[0](event(raw));
  assert.equal(binding(f.amendment(), "aria-invalid"), "false");
  const pending = eventHandlers(f.review(), "submit")[0].call(f.controller, event());
  await f.fixture.waitForRequest(pending);
  assert.equal(f.fixture.requests.length, 1);
  assert.equal(f.fixture.requests[0].action, "confirm");
  assert.equal(f.fixture.requests[0].amendmentReason, raw);
  f.fixture.pending.resolve({ status: "conflict", error: "Synthetic owner revision conflict", body: { error: "output_revision_conflict" } });
  await pending;
  assert.equal(binding(f.amendment(), ".value"), raw);
  assert.equal(f.fixture.requests.length, 1, "a failed confirmation never dispatches paid work or retries automatically");
});
