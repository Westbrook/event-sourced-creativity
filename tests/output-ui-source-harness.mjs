// Unit-boundary harness: execute the actual application class/method bodies.
// Synthetic Lit templates and store inputs are not DOM, browser, or API authority tests.
import assert from "node:assert/strict";
import { installSourceOwnershipPort } from "./helpers/source-ownership-port.mjs";
import { readFile } from "node:fs/promises";
import { createRequire, registerHooks } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const sourceRoot = resolve(process.env.FORMA_OUTPUT_REGRESSION_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const projectRequire = createRequire(resolve(sourceRoot, "package.json"));
const ts = projectRequire("typescript");

export const deferred = () => {
  let resolvePromise;
  const promise = new Promise((resolveValue) => { resolvePromise = resolveValue; });
  return { promise, resolve: resolvePromise };
};
export const template = (strings, ...values) => ({ strings: [...strings], values });

// Only the native event surface used by the actual focus lease in the two
// existing planning units. Full mounted focus tests remain separate evidence.
export function outputFixtureFocusDocument() {
  const listeners = new Map();
  return { activeElement: null,
    addEventListener(type, listener) { const entries = listeners.get(type) ?? new Set(); entries.add(listener); listeners.set(type, entries); },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    focus(target) { this.activeElement = target;
      for (const listener of [...(listeners.get("focusin") ?? [])]) listener({ type: "focusin", target, currentTarget: this }); },
  };
}

function transpile(source, name) {
  return ts.transpileModule(source, { fileName: name, compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, useDefineForClassFields: false,
  } }).outputText;
}

async function classSource(path, name, methods) {
  const source = await readFile(resolve(sourceRoot, path), "utf8");
  const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declaration = parsed.statements.find((node) => ts.isClassDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, `actual ${name} class must exist`);
  if (!methods) return declaration.getText(parsed).replace(/^export\s+/u, "");
  const selected = methods.map((method) => {
    const node = declaration.members.find((member) => ts.isMethodDeclaration(member) && member.name?.getText(parsed) === method);
    assert.ok(node, `actual ${name}.${method} method must exist`);
    return node.getText(parsed);
  });
  return `class ${name} { ${selected.join("\n")} }`;
}

export async function loadStoreMethods() {
  const source = await classSource("src/state/store.ts", "FormaStore", ["outputRequirementCommand", "uploadOutputAsset"]);
  return new Function(`${transpile(source, "store-methods.ts")}; return FormaStore;`)().prototype;
}

export async function loadController(Base, bindings = {}) {
  const source = await classSource("src/components/forma-output-requirements.ts", "FormaOutputRequirements");
  const { OutputRequirementsClient } = await import(pathToFileURL(resolve(sourceRoot, "src/state/output-requirements-client.ts")).href);
  const deliveryMessages = await import(pathToFileURL(resolve(sourceRoot, "src/components/design-system/locales/output-delivery-messages.ts")).href);
  const recovery = await import(pathToFileURL(resolve(sourceRoot, "src/components/output-controller-recovery.ts")).href);
  const planning = await import(pathToFileURL(resolve(sourceRoot, "src/components/output-plan-proposal-state.ts")).href);
  // The actual focus module has a bundler-style local routes import. Resolve
  // only source-relative extensionless dependencies during this import, using
  // the same native module hook as the existing document-copy unit fixture.
  const sourceURL = pathToFileURL(resolve(sourceRoot, "src") + "/").href;
  const focusImports = registerHooks({ resolve(specifier, context, nextResolve) {
    return nextResolve(context.parentURL?.startsWith(sourceURL) && specifier.startsWith(".")
      && !/\.[a-z0-9]+$/iu.test(specifier) ? specifier + ".ts" : specifier, context);
  } });
  const navigationFocus = await import(pathToFileURL(resolve(sourceRoot, "src/components/output-navigation-focus.ts")).href)
    .finally(() => focusImports.deregister());
  const operationReceipts = await import(pathToFileURL(resolve(sourceRoot, "src/components/output-operation-support-receipt.ts")).href);
  const clipboard = await import(pathToFileURL(resolve(sourceRoot, "src/components/design-system/clipboard.ts")).href);
  const readiness = await import(pathToFileURL(resolve(sourceRoot, "src/components/output-source-readiness.ts")).href);
  const executionPolicy = await import(pathToFileURL(resolve(sourceRoot, "src/model/output-execution-policy.ts")).href);
  const deliveryContract = await import(pathToFileURL(resolve(sourceRoot, "src/model/output-delivery-contract.ts")).href);
  const scopeAmendment = await import(pathToFileURL(resolve(sourceRoot, "src/model/output-scope-amendment.ts")).href);
  const runtimeMessages = await import(pathToFileURL(resolve(sourceRoot, "src/components/design-system/locales/output-delivery-runtime-messages.ts")).href);
  let activation = {};
  try { activation = await import(pathToFileURL(resolve(sourceRoot, "src/components/output-direct-activation.ts")).href); }
  catch (error) { if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error; }
  class SourceOwnerBase extends Base { constructor(...args) { super(...args); if (this.store && !this.store.captureSourceOwnership) installSourceOwnershipPort(this.store);
    // This partial Store fixture has no transport owner. Full Store/client tests
    // below exercise the real retainedWrite; never replace an existing method.
    if (this.store?.outputRequirements && !this.store.outputRequirements.retainedWrite) this.store.outputRequirements.retainedWrite = () => null;
    if (this.store?.outputRequirements && !this.store.outputRequirements.withholdCommandBody) {
      const store = this.store;
      // This synthetic resource facade has no canonical snapshot/transport owner.
      // Reuse actual receipt validation; never fabricate an acknowledgment or POST.
      const receipts = new OutputRequirementsClient({
        captureScope: () => {
          const authorization = store.captureAuthorizationScope();
          return authorization ? { key: authorization.key, projectId: store.projection?.get()?.projectId ?? null } : null;
        },
        scopeActive: scope => {
          const authorization = store.captureAuthorizationScope();
          return Boolean(authorization && authorization.key === scope.key && store.authorizationScopeActive(authorization)
            && (store.projection?.get()?.projectId ?? null) === scope.projectId);
        },
        isSnapshot: () => false,
        fetch: () => { throw new Error("synthetic_resource_receipt_port_must_not_dispatch"); },
        notify() {},
      });
      store.outputRequirements.withholdCommandBody = receipts.withholdCommandBody.bind(receipts);
    }
  } }
  const globals = {
    FormaElement: SourceOwnerBase, html: template, nothing: null,
    repeat: (rows, _key, render) => [...rows].map(render),
    compileOutputPlan: () => { throw new Error("This boundary test must not compile a second fake output plan."); },
    customElements: { get: () => true },
    window: { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} },
    ...deliveryMessages,
    ...recovery,
    ...planning,
    ...navigationFocus,
    ...operationReceipts,
    ...clipboard,
    ...readiness,
    ...executionPolicy,
    ...deliveryContract,
    ...scopeAmendment,
    ...runtimeMessages,
    ...activation,
    ...bindings,
  };
  return new Function(...Object.keys(globals), `${transpile(source, "output-controller.ts")}; return FormaOutputRequirements;`)(...Object.values(globals));
}

export function templates(value) {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(templates);
  if (!Array.isArray(value.strings) || !Array.isArray(value.values)) return [];
  return [value, ...value.values.flatMap(templates)];
}

export function binding(value, name) {
  for (let index = 0; index < value.values.length; index += 1) {
    if (value.strings[index].trimEnd().endsWith(`${name}=`)) return value.values[index];
  }
  return undefined;
}

export function eventHandlers(value, eventName) {
  return templates(value).flatMap((entry) => entry.values.flatMap((candidate, index) =>
    typeof candidate === "function" && entry.strings[index].trimEnd().endsWith(`@${eventName}=`) ? [candidate] : []));
}

export function handler(value, eventName, methodName) {
  const result = eventHandlers(value, eventName).find((candidate) => candidate.name === methodName);
  assert.ok(result, `${eventName} must expose actual ${methodName} handler`);
  return result;
}

export function region(value, marker) {
  const result = templates(value).find((entry) => entry.strings.some((part) => part.includes(marker)));
  assert.ok(result, `actual ${marker} region must be rendered`);
  return result;
}

export function cardEditorState(controller) {
  return binding(region(controller.render(), "<forma-output-requirement-card"), ".editorState");
}

export function snapshot(documentId, revision = "1") {
  const requirementId = `requirement-${documentId}`;
  const deliverableId = `deliverable-${documentId}`;
  const targetId = `target-${documentId}`;
  const planRevisionId = `plan-${documentId}`;
  const spec = {
    schema_version: 1, id: requirementId, label: `Requirement ${documentId}`, original_text: "One owned image.", value_origins: {},
    deliverables: [{ id: deliverableId, label: `Image ${documentId}`, media_kind: "image", required: true,
      quantity: { kind: "exact", unit: "image", value: 1 }, source_scope: { kind: "document" },
      coverage: { kind: "document_context" }, original_text: "One owned image.", value_origins: {} }],
  };
  const summary = { scope_known: true, completion: "partial", required_groups: 1, fulfilled_required_groups: 0,
    required_obligations: 1, fulfilled_required_obligations: 0, unresolved_required_groups: 0,
    fulfilled_targets: 0, delivery_ready: false };
  return {
    schemaVersion: 1, scope: { actorUserId: "fixture-actor", projectAccessId: null },
    documentId, projectId: "fixture-project", revision, requirementRevision: revision, sourceRevision: "source-1",
    sourceVerification: { status: "verified", reasonCodes: [], capacity: { referenceCount: 0, distinctObjectCount: 0, countsComplete: true, ownedReadLimit: 4, nativeLimit: 1, sources: [], sourcesComplete: true } },
    requirements: [{ blockId: requirementId, subtype: "Image", content: spec.original_text, status: "valid", locked: false, spec, preserved: spec, issues: [] }],
    confirmedPlan: { revisionId: planRevisionId, confirmationOptions: {}, sourceDigest: "source-1", requirementsDigest: revision,
      targetContractDigests: { [targetId]: `contract-${documentId}` }, plan: { targets: [{
      id: targetId, requirement_id: requirementId, deliverable_id: deliverableId, label: `Target ${documentId}`,
      required: true, selected: true, media_kind: "image", blocking_issues: [],
      quantity: { kind: "exact", unit: "image", value: 1 }, content_quantity: null, count_policy: null, suggested_count: null,
      source_scope: { kind: "document" }, coverage: { kind: "document_context" },
    }] } },
    results: [{ id: `result-${documentId}`, targetId, assetId: `asset-${documentId}`, planRevisionId,
      resultRevision: "result-1", createdByUserId: "fixture-producer", checksStatus: "passed", review: "pending", problems: [] }],
    assets: [{ id: `asset-${documentId}`, name: `Owned ${documentId}.png`, mediaKind: "image", mimeType: "image/png",
      byteLength: 3, sha256: "a".repeat(64), available: true,
      inspection: { status: "inspected", facts: {}, checks: [], limitations: [] },
      downloadUrl: `/api/output-requirements/assets/a?documentId=${documentId}` }],
    grants: [], targetStates: [], summary, requirementSummaries: { [requirementId]: summary },
    permissions: { canAuthor: true, canRequest: true, canReview: false, canDownload: true, independentReview: false },
    capabilities: { ownedFileAdoption: true, supportedFileExtensions: ["png"], limitations: [] },
  };
}

export async function controllerFixture(overrides = {}) {
  const pending = deferred();
  const requests = [], requestEntries = new Set();
  const recordRequest = request => { requests.push(request); for (const entered of requestEntries) entered(); };
  const waitForRequest = async (pending, previousCount = 0) => {
    if (requests.length > previousCount) return;
    let entered;
    const entry = new Promise(resolve => { entered = () => { if (requests.length > previousCount) resolve(); }; requestEntries.add(entered); entered(); });
    // A legitimate no-dispatch terminal also releases the wait. The caller's
    // unchanged count assertion then fails instead of hanging on a nonexistent POST.
    try { await Promise.race([entry, Promise.resolve(pending)]); }
    finally { requestEntries.delete(entered); }
  };
  const snapshots = new Map(["doc-a", "doc-b"].map((id) => [id, snapshot(id)]));
  const effects = { uploadResets: 0, downloads: 0, revoked: [], notices: [] };
  const resources = {
    resource: (id) => ({ state: "ready", snapshot: snapshots.get(id), error: null }),
    ensure: async (id) => resources.resource(id),
    download: (documentId, path) => { recordRequest({ kind: "download", documentId, path }); return pending.promise; },
  };
  const store = {
    captureAuthorizationScope: () => ({ key: "fixture-actor:project:1", shared: false }),
    authorizationScopeActive: () => true,
    outputRequirements: resources,
    outputRequirementCommand: (command) => { recordRequest({ kind: "command", ...command }); return pending.promise; },
    uploadOutputAsset: (documentId, file, revision, mutationId, rights) => { recordRequest({ kind: "upload", documentId, file, revision, mutationId, rights }); return pending.promise; },
    syncDocumentJobs: async () => {},
    documentJobs: { get: () => [] },
    projection: { get: () => ({ projectId: "fixture-project", documentId: controller.documentId, documents: [...snapshots.keys()].map(id => ({ id, projectId: "fixture-project", title: id })), libraryBlocks: [] }) },
    route: { get: () => "/document/" + controller.documentId },
    session: { get: () => ({ user: { userId: "fixture-actor" } }) },
    ...overrides,
  };
  class Base {
    constructor() {
      this.store = store; this.isConnected = true; this.updateComplete = Promise.resolve();
      this.i18n = { locale: "en", direction: "ltr", number: String, system: String, t: (key, fallback, values = {}) =>
        `${key} ${fallback.replace(/\{(\w+)\}/gu, (_, name) => String(values[name] ?? ""))}` };
    }
    requestUpdate() {}
    connectedCallback() { this.isConnected = true; }
    disconnectedCallback() { this.isConnected = false; }
    querySelector(selector) {
      return selector.includes('input[type="file"]') ? { form: { reset() { effects.uploadResets += 1; } } } : null;
    }
    append() {}
  }
  const Controller = await loadController(Base, {
    URL: { createObjectURL: () => "blob:fixture", revokeObjectURL: (url) => effects.revoked.push(url) },
    document: { createElement: () => ({ click() { effects.downloads += 1; }, remove() {} }) },
  });
  const controller = new Controller();
  controller.documentId = "doc-a"; controller.surface = "deliver";
  controller.willUpdate(new Map());
  return { controller, store, pending, requests, snapshots, effects, waitForRequest };
}

export const submitEvent = () => ({ preventDefault() {}, stopPropagation() {} });
export function changeDocument(controller, documentId) { controller.documentId = documentId; controller.willUpdate(new Map()); }

export function startPreflight(fixture) {
  return handler(fixture.controller.render(), "submit", "#inspectRun").call(fixture.controller, submitEvent());
}
export function startSave(fixture) {
  const { controller } = fixture;
  const model = fixture.store.outputRequirements.resource(controller.documentId).snapshot;
  const row = model.requirements[0];
  return handler(controller.render(), "forma-output-save", "#save").call(controller, {
    ...submitEvent(), detail: { scope: { documentId: model.documentId, authorizationScopeKey: fixture.store.captureAuthorizationScope().key },
      requirementId: row.blockId, expectedRevision: model.revision, clientMutationId: "fixture-save-operation", draft: row.spec,
      planSuggestions: { countPolicies: {}, suggestedCounts: {} } },
  });
}
export function selectUpload(fixture, filename = "fixture.png") {
  const { controller } = fixture;
  const adoption = region(controller.render(), "output-adoption");
  const selectedFile = new File(["png"], filename, { type: "image/png" });
  handler(adoption, "change", "#setFile").call(controller, { target: { files: [selectedFile] } });
  const rights = eventHandlers(adoption, "change").find((candidate) => candidate.name !== "#setFile");
  assert.ok(rights, "actual file adoption rights control must be available");
  rights.call(controller, { target: { checked: true } });
}
export function startUpload(fixture) {
  selectUpload(fixture);
  return handler(fixture.controller.render(), "submit", "#upload").call(fixture.controller, submitEvent());
}
export function startDownload(fixture) {
  const button = eventHandlers(region(fixture.controller.render(), 'class="output-result"'), "click")[0];
  assert.ok(button, "actual exact-file review button must be available");
  return button.call(fixture.controller, {});
}
