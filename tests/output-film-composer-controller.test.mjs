import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import { loadController, snapshot, templates, binding, region, handler, eventHandlers, submitEvent, deferred, outputFixtureFocusDocument } from "./output-ui-source-harness.mjs";
import { installSourceOwnershipPort } from "./helpers/source-ownership-port.mjs";
import { ownedSocialVideo } from "./output-social-asset-fixtures.mjs";
import { createFilmCompositionDraft, isFilmCompositionDraftAsset } from "../src/model/film-composition-draft.ts";
import { inspectVideoPrefix } from "../src/model/video-container.ts";
import { compileOutputPlan } from "../src/model/output-plan.ts";
import { filmCompositionMessage } from "../src/components/design-system/locales/film-composition-messages.ts";

// NEW unit boundary: the complete actual Output class, real Film view and real
// byte inspector/composer. Base/Store are finite ports, not mounted Lit, native
// focus, Worker authorization, upload acceptance, or browser playback evidence.
const sourceURL = new URL("../src/", import.meta.url).href;
const cssURL = new URL("../src/components/output-film-composer.css", import.meta.url).href;
const imports = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(context.parentURL?.startsWith(sourceURL) && specifier.startsWith(".") && !/\.[a-z0-9]+$/iu.test(specifier)
      ? specifier + ".ts" : specifier, context);
  },
  load(url, context, nextLoad) {
    return url === cssURL ? { format: "module", source: "export default '';", shortCircuit: true } : nextLoad(url, context);
  },
});
let renderOutputFilmComposer;
try { ({ renderOutputFilmComposer } = await import("../src/components/output-film-composer.ts")); }
finally { imports.deregister(); }

const SOURCE = ownedSocialVideo("16:9"), sha = bytes => createHash("sha256").update(bytes).digest("hex");
function filmSnapshot() {
  const value = snapshot("doc-a"), row = value.requirements[0], target = value.confirmedPlan.plan.targets[0];
  value.results = []; value.sourceRevision = "a".repeat(64); value.confirmedPlan.sourceDigest = value.sourceRevision;
  row.subtype = "Video"; row.content = row.spec.original_text = "Compose two owned local abstract clips into a four-second silent film.";
  row.spec.value_origins = { recipe_template: { text: "forma-recipe:film-continuity@1" } };
  const deliverable = row.spec.deliverables[0];
  Object.assign(deliverable, { id: `${row.spec.id}:composed-film`, label: "Local abstract Film", media_kind: "video",
    quantity: { kind: "exact", unit: "video", value: 1 }, content_quantity: { kind: "exact", unit: "second", value: 4 },
    original_text: row.content });
  Object.assign(target, { deliverable_id: deliverable.id, media_kind: "video", label: "Local abstract Film",
    quantity: deliverable.quantity, content_quantity: deliverable.content_quantity, count_policy: deliverable.content_quantity });
  value.capabilities.supportedFileExtensions = ["mp4"];
  value.assets = ["clip:first", "clip:second"].map(id => ({ id, name: `${id}.mp4`, mimeType: "video/mp4", mediaKind: "video",
    byteLength: SOURCE.length, sha256: sha(SOURCE), sourceDigest: value.sourceRevision, createdByUserId: "fixture-actor",
    createdAt: "2026-09-10T00:00:00.000Z", available: true,
    downloadUrl: `/api/output-requirements/assets/${encodeURIComponent(id)}?documentId=doc-a`,
    inspection: { status: "inspected", kind: "video", mimeType: "video/mp4", extension: "mp4", sha256: sha(SOURCE),
      byteLength: SOURCE.length, facts: { durationSeconds: 2 }, checks: [], errors: [], limitations: [], limitationCodes: [] } }));
  return value;
}

let fetchAttempts = 0;
const oldFetch = globalThis.fetch;
test.before(() => { globalThis.fetch = async () => { fetchAttempts++; throw new Error("film_host_network_forbidden"); }; });
test.after(() => { globalThis.fetch = oldFetch; assert.equal(fetchAttempts, 0); });

async function fixture(t, options = {}) {
  const model = filmSnapshot(), state = { route: "/document/doc-a", scope: "fixture-actor:project:1", privateRevision: 0,
    accessLost: false, privateUnavailable: false, resourceState: "ready", retained: null, dialog: false, cardDraft: false,
    resets: 0, updates: 0, ensures: 0, forbidden: 0 };
  const reads = [], uploads = [], commands = [], views = [], renderedViews = [];
  const focusDocument = outputFixtureFocusDocument(); focusDocument.querySelector = () => state.dialog ? {} : null;
  const windowPort = new EventTarget();
  let controller;
  const store = {
    captureAuthorizationScope: () => ({ key: state.scope, shared: false }),
    authorizationScopeActive: scope => scope?.key === state.scope,
    route: { get: () => state.route }, session: { get: () => ({ user: { userId: "fixture-actor" } }) },
    projection: { get: () => ({ projectId: "fixture-project", documentId: controller?.documentId ?? "doc-a",
      documents: [{ id: "doc-a", projectId: "fixture-project", title: "Authored local Film" }], libraryBlocks: [] }) },
    documentJobs: { get: () => [] }, syncDocumentJobs: async () => {},
    outputRequirements: {
      resource: () => ({ state: state.resourceState, snapshot: model, privateRevision: state.privateRevision,
        accessLost: state.accessLost, privateUnavailable: state.privateUnavailable, error: null }),
      retainedWrite: () => state.retained,
      ensure: async () => { state.ensures++; return store.outputRequirements.resource(); },
      download: async (documentId, path, init) => {
        const read = { documentId, path, init }; reads.push(read);
        return options.download ? options.download(read, reads.length) : { status: "saved", body: { blob: new Blob([SOURCE]), filename: "owned.mp4" } };
      },
    },
    uploadOutputAsset: async (documentId, file, revision, mutationId, rights, request) => {
      const entry = { documentId, file, revision, mutationId, rights, request }; uploads.push(entry);
      return options.upload ? options.upload(entry) : { status: "saved", body: null };
    },
    outputRequirementCommand: async command => { commands.push(command); throw new Error("film_host_command_forbidden"); },
  };
  const source = installSourceOwnershipPort(store);
  class Base extends EventTarget {
    constructor() { super();
      this.store = store; this.isConnected = true; this.ownerDocument = focusDocument; this.updateComplete = Promise.resolve();
      this.i18n = { locale: "en", direction: "ltr", number: String, system: String,
        t: (_key, fallback, values = {}) => fallback.replace(/\{(\w+)\}/gu, (_, key) => String(values[key] ?? "")) };
    }
    requestUpdate() { state.updates++; }
    connectedCallback() { this.isConnected = true; }
    disconnectedCallback() { this.isConnected = false; }
    querySelector(selector) { return selector.includes('input[type="file"]') ? { form: { reset() { state.resets++; } } } : null; }
    querySelectorAll(selector) { return selector === "forma-output-requirement-card" && state.cardDraft ? [{ isConnected: true, hasOpenDraft: true }] : []; }
    append() { state.forbidden++; throw new Error("film_host_anchor_forbidden"); }
  }
  const Controller = await loadController(Base, {
    createFilmCompositionDraft, isFilmCompositionDraftAsset, filmCompositionMessage, compileOutputPlan,
    renderOutputFilmComposer(view) { views.push(view); const rendered = renderOutputFilmComposer(view); renderedViews.push(rendered); return rendered; },
    window: windowPort, document: focusDocument,
    HTMLElement: class FiniteElement {},
    URL: { createObjectURL() { state.forbidden++; throw new Error("film_host_blob_url_forbidden"); }, revokeObjectURL() { state.forbidden++; } },
  });
  controller = new Controller(); controller.documentId = "doc-a"; controller.surface = "deliver";
  controller.connectedCallback(); controller.willUpdate(new Map());
  t.after(() => { controller.disconnectedCallback(); assert.equal(commands.length, 0); assert.equal(state.forbidden, 0); });
  const render = () => controller.render();
  const opener = () => templates(render()).find(value => value.strings.some(part => part.includes("data-film-open"))) ?? null;
  const open = async () => { const button = opener(); assert.ok(button, "actual Film opener"); await eventHandlers(button, "click")[0](); render(); return views.at(-1); };
  const view = () => { const before = views.length; render(); return views.length > before ? views.at(-1) : null; };
  const adoption = () => region(render(), 'class="output-adoption"');
  const setUploadRights = checked => {
    const callback = eventHandlers(adoption(), "change").find(candidate => candidate.name !== "#setFile");
    assert.ok(callback); callback.call(controller, { target: { checked } });
  };
  const upload = () => handler(adoption(), "submit", "#upload").call(controller, submitEvent());
  const chooseFile = file => handler(adoption(), "change", "#setFile").call(controller, { target: { files: file ? [file] : [] } });
  const hasStaged = () => templates(adoption()).some(value => binding(value, "?required") === false);
  const stage = async () => { await open(); view().add("clip:first"); view().add("clip:second"); view().rights(true); await view().compose(); };
  return { controller, model, state, store, source, reads, uploads, commands, views, renderedViews, render, opener, open, view,
    adoption, setUploadRights, upload, chooseFile, hasStaged, stage, draw: () => controller.willUpdate(new Map()) };
}

test("actual host offers only the confirmed Film exact-seconds target and current author/source capability", async t => {
  const f = await fixture(t), button = f.opener(); assert.ok(button); assert.equal(binding(button, "?disabled"), false);
  const target = f.model.confirmedPlan.plan.targets[0], original = structuredClone(f.model);
  const restore = () => { for (const key of Object.keys(f.model)) delete f.model[key]; Object.assign(f.model, structuredClone(original)); f.draw(); };
  for (const change of [
    () => { f.model.requirements[0].spec.value_origins.recipe_template.text = "other-recipe"; },
    () => { f.model.confirmedPlan.plan.targets[0].deliverable_id = "other-deliverable"; },
    () => { f.model.confirmedPlan.plan.targets[0].count_policy = { kind: "exact", unit: "frame", value: 4 }; },
    () => { f.model.confirmedPlan.plan.targets[0].count_policy.value = 0; },
  ]) { change(); assert.equal(f.opener(), null); restore(); }
  for (const change of [
    () => { f.model.permissions.canAuthor = false; }, () => { f.model.permissions.canDownload = false; },
    () => { f.model.capabilities.ownedFileAdoption = false; }, () => { f.model.sourceVerification.status = "unavailable"; },
    () => { f.model.confirmedPlan.sourceDigest = "stale"; }, () => { f.model.confirmedPlan.plan.targets[0].blocking_issues.push("blocked"); },
  ]) { change(); await eventHandlers(button, "click")[0](); assert.equal(f.view(), null); restore(); }
  assert.equal(target.id, original.confirmedPlan.plan.targets[0].id); assert.equal(f.reads.length, 0); assert.equal(f.uploads.length, 0);
});

test("real Film renderer stages actual ordered bytes with fresh unchecked upload rights and no automatic write", async t => {
  const f = await fixture(t); await f.stage();
  assert.ok(f.renderedViews.every(value => Array.isArray(value.strings) && Array.isArray(value.values)));
  assert.equal(f.reads.length, 2); assert.deepEqual(f.reads.map(row => row.path), f.model.assets.map(row => row.downloadUrl));
  assert.ok(f.reads.every(row => row.documentId === "doc-a" && row.init.signal instanceof AbortSignal && Object.keys(row.init).join() === "signal"));
  assert.equal(f.view(), null); assert.equal(f.hasStaged(), true); assert.equal(binding(f.adoption(), ".checked"), false);
  await f.upload(); assert.equal(f.uploads.length, 0);
  f.setUploadRights(true); await f.upload(); assert.equal(f.uploads.length, 1);
  const uploaded = f.uploads[0]; assert.equal(uploaded.file.name, "composed-film.mp4"); assert.equal(uploaded.file.type, "video/mp4");
  assert.equal(uploaded.rights, true); assert.equal(uploaded.revision, "1"); assert.match(uploaded.mutationId, /^[0-9a-f-]{36}$/u);
  const info = await inspectVideoPrefix(new Uint8Array(await uploaded.file.arrayBuffer()));
  assert.equal(info.durationSeconds, 4); assert.equal(info.sampleCount, 8); assert.equal(f.hasStaged(), false);
  await f.stage(); f.setUploadRights(true); await f.upload(); assert.equal(f.uploads.length, 2);
  assert.notEqual(f.uploads[1].mutationId, uploaded.mutationId); assert.equal(f.state.ensures, 0);
});

test("mixed asset lists filter through actual eligibility and still render zero or one choice", async t => {
  for (const count of [0, 1]) {
    const f = await fixture(t); f.model.assets.forEach((asset, index) => { if (index >= count) asset.inspection.sha256 = "b".repeat(64); });
    await f.open(); const view = f.view(); assert.ok(view); assert.equal(view.draft.choices.length, count);
    for (const choice of view.draft.choices) view.add(choice.id);
    f.view().rights(true); await f.view().compose(); assert.equal(f.hasStaged(), false); assert.equal(f.reads.length, 0);
  }
});

test("existing selected file, unresolved write and open requirement or plan draft block stale Film open gestures", async t => {
  const f = await fixture(t), open = eventHandlers(f.opener(), "click")[0];
  const originalFile = new File(["ordinary"], "ordinary.mp4", { type: "video/mp4" });
  f.chooseFile(originalFile); await open(); assert.equal(f.view(), null); assert.equal(f.hasStaged(), true);
  f.setUploadRights(true); await f.upload(); assert.equal(f.uploads[0].file === originalFile, true);
  f.state.retained = { status: "pending", clientMutationId: "original-write", action: "adopt", digest: "d".repeat(64) };
  await open(); assert.equal(f.view(), null); f.state.retained = null;
  f.state.cardDraft = true; await open(); assert.equal(f.view(), null); f.state.cardDraft = false;
  const planButton = templates(f.render()).find(value => String(binding(value, "aria-label") ?? "").includes("Review delivery plan") && eventHandlers(value, "click").length);
  assert.ok(planButton); eventHandlers(planButton, "click")[0]({ currentTarget: null });
  await open(); assert.equal(f.view(), null); assert.ok(region(f.render(), 'class="output-plan-review"'));
  assert.equal(f.reads.length, 0);
});

for (const mode of ["source", "route", "privateRevision", "asset", "permission", "rights", "away-back", "disconnect"]) {
  test(`actual in-flight Film read retires on ${mode} and cannot stage or upload`, { timeout: 10000 }, async t => {
    const hold = deferred(), entered = deferred(); let read;
    const f = await fixture(t, { download: async value => { read = value; entered.resolve(); await hold.promise;
      return { status: "saved", body: { blob: new Blob([SOURCE]) } }; } });
    await f.open(); f.view().add("clip:first"); f.view().add("clip:second"); f.view().rights(true);
    const pending = f.view().compose(); t.after(async () => { hold.resolve(); await pending; });
    await Promise.race([entered.promise, pending.then(() => assert.fail("Expected current exact clip read"))]);
    if (mode === "source") f.source.retire();
    if (mode === "route" || mode === "away-back") f.state.route = "/document/elsewhere";
    if (mode === "privateRevision") f.state.privateRevision++;
    if (mode === "asset") f.model.assets[0].sha256 = "b".repeat(64);
    if (mode === "permission") f.model.permissions.canDownload = false;
    if (mode === "rights") f.view().rights(false);
    if (mode === "disconnect") f.controller.disconnectedCallback(); else f.draw();
    if (mode === "away-back") { f.state.route = "/document/doc-a"; f.draw(); }
    assert.equal(read.init.signal.aborted, true);
    hold.resolve(); await pending; assert.equal(f.hasStaged(), false); assert.equal(f.reads.length, 1); assert.equal(f.uploads.length, 0);
    if (mode !== "rights") assert.equal(f.view(), null);
  });
}

test("a staged Film loses upload eligibility before dispatch and cannot be restaged against a changed source", async t => {
  const f = await fixture(t, { upload: async entry => {
    assert.equal(entry.request.current(), true); f.state.privateRevision++;
    assert.equal(entry.request.current(), false); return { status: "not-attempted", body: null };
  } });
  await f.stage(); f.setUploadRights(true); await f.upload(); assert.equal(f.uploads.length, 1);
  f.draw(); assert.equal(f.hasStaged(), false); f.setUploadRights(true); await f.upload(); assert.equal(f.uploads.length, 1);
  assert.equal(f.state.ensures, 0);
  const conflict = await fixture(t, { upload: async () => ({ status: "conflict", body: { error: "output_revision_conflict" } }) });
  await conflict.stage(); conflict.setUploadRights(true); await conflict.upload();
  const restage = handler(conflict.adoption(), "click", "#restageUpload");
  conflict.model.sourceRevision = "b".repeat(64); await restage.call(conflict.controller);
  assert.equal(conflict.state.ensures, 0); conflict.draw(); assert.equal(conflict.hasStaged(), false);
  assert.equal(conflict.uploads.length, 1);
});

test("ordinary owned-file upload retains its existing rights and explicit current callback", async t => {
  const f = await fixture(t, { upload: async entry => { assert.equal(entry.request.current(), true); return { status: "saved", body: null }; } });
  const file = new File(["ordinary file bytes"], "existing.mp4", { type: "video/mp4" });
  f.chooseFile(file); await f.upload(); assert.equal(f.uploads.length, 0);
  f.setUploadRights(true); await f.upload(); assert.equal(f.uploads.length, 1); assert.equal(f.uploads[0].file === file, true);
  assert.equal(f.reads.length, 0); assert.equal(f.hasStaged(), false);
});
