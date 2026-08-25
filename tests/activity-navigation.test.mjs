import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { artifactReviewState } from "../src/model/context-health.ts";
import { documentArtifactDefinition, isDocumentArtifactKind } from "../src/model/document-artifacts.ts";
import {
  authorizedGenerationFailureRemediation,
  documentJobCanRecoverPresentation,
  documentJobCanRecoverProviderRender,
  documentJobFailure,
  documentJobProgress,
  generationFailureGuidance,
} from "../src/model/document-jobs.ts";
import { eventMatchesProfile } from "../src/model/event-profiles.ts";
import { foldEvents } from "../src/model/events.ts";
import {
  localizedDocumentJobProgress,
  localizedDocumentJobProgressDetail,
  localizedGenerationFailureGuidance,
} from "../src/components/design-system/localized-runtime-copy.ts";

const [storeSource, activitySource, deliverSource] = await Promise.all([
  readFile(new URL("../src/state/store.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/components/forma-activity.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/components/forma-deliver.ts", import.meta.url), "utf8"),
]);

const runtimeKey = Symbol.for("forma.activity-navigation-test.runtime");
globalThis[runtimeKey] = {
  authorizedGenerationFailureRemediation,
  documentArtifactDefinition,
  documentJobCanRecoverPresentation,
  documentJobCanRecoverProviderRender,
  documentJobFailure,
  documentJobProgress,
  generationFailureGuidance,
  isDocumentArtifactKind,
  localizedDocumentJobProgress,
  localizedDocumentJobProgressDetail,
  localizedGenerationFailureGuidance,
};

function actualMethod(source, className, methodName) {
  const syntax = ts.createSourceFile(`${className}.ts`, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declaration = syntax.statements.find((statement) => ts.isClassDeclaration(statement) && statement.name?.text === className);
  assert.ok(declaration, `the actual ${className} class remains available`);
  const method = declaration.members.find((member) => ts.isMethodDeclaration(member) && member.name.getText(syntax) === methodName);
  assert.ok(method, `the actual ${className}.${methodName} method remains available`);
  return method.getText(syntax);
}

const harnessSource = `
const {
  authorizedGenerationFailureRemediation,
  documentArtifactDefinition,
  documentJobCanRecoverPresentation,
  documentJobCanRecoverProviderRender,
  documentJobFailure,
  documentJobProgress,
  generationFailureGuidance,
  isDocumentArtifactKind,
  localizedDocumentJobProgress,
  localizedDocumentJobProgressDetail,
  localizedGenerationFailureGuidance,
} = globalThis[Symbol.for("forma.activity-navigation-test.runtime")];
const nothing = Symbol("nothing");
const html = (strings, ...values) => ({ strings: [...strings], values });
const icon = (name) => name;
const jobLabels = { render_document: "Document rendering", generate: "Image generation" };
const profiles = ["projects", "workspace", "memory", "scout", "sessions", "full"];
const eventProfileRank = (profile) => profiles.indexOf(profile);
const routeCapabilities = (path) => ({
  profile: path.startsWith("/projects") ? "projects" : path.startsWith("/memory") ? "memory" : "workspace",
  privateContent: path.startsWith("/memory"),
});
const beginRoutePopulation = () => {};
const recordRouteHistoryProfile = () => {};
const recordPrivateContentState = () => {};
const recordPopulationSource = () => {};
const recordSessionReady = () => {};
const consumeSessionBootstrap = () => null;
const consumeSessionPrefetch = () => null;
const readAccountSnapshots = async () => [];
const matchingAccountSnapshot = () => undefined;
const writeAccountSnapshot = async () => {};
const documentViewFromRoute = () => undefined;
const performance = { now: () => 0 };
const requestAnimationFrame = (callback) => callback();

class State {
  constructor(value) { this.value = value; }
  get() { return this.value; }
  set(value) { this.value = value; }
}

export class RouteStoreHarness {
  reads = [];
  upgrades = [];
  notifications = 0;
  route = new State("/projects");
  session = new State({ user: { userId: "authorized-user" } });
  events = new State([]);
  content = new State({});
  head = new State(0);
  error = new State("");
  loading = new State(true);
  projectRequested;
  workspaceRequested;
  #loadRevision = 0;
  #historyProfile = "full";
  #projectHistory;
  #workspaceHistory;
  #resolveProjectRequest = () => {};
  #resolveWorkspaceRequest = () => {};
  #resolveProjectHistory = () => {};
  #resolveWorkspaceHistory = () => {};
  #pauseWorkspace = false;

  constructor() {
    this.projectRequested = new Promise((resolve) => { this.#resolveProjectRequest = resolve; });
    this.workspaceRequested = new Promise((resolve) => { this.#resolveWorkspaceRequest = resolve; });
    this.#projectHistory = new Promise((resolve) => { this.#resolveProjectHistory = resolve; });
    this.#workspaceHistory = new Promise((resolve) => { this.#resolveWorkspaceHistory = resolve; });
  }

  pauseWorkspace() { this.#pauseWorkspace = true; }
  releaseProjects() { this.#resolveProjectHistory({ events: [{ eventId: "project", sequence: 1 }], content: {}, head: 1 }); }
  releaseWorkspace() { this.#resolveWorkspaceHistory({ events: [{ eventId: "workspace", sequence: 2 }], content: {}, head: 2 }); }
  #profileForRoute(path) { return routeCapabilities(path).profile; }
  routeDataReady(path = this.route.get()) { return eventProfileRank(this.#historyProfile) >= eventProfileRank(this.#profileForRoute(path)); }
  #scopeStillActive(scope) { return scope === "authorized-user"; }
  #assertAuthorizationScope(scope) { if (!this.#scopeStillActive(scope)) throw new Error("authorization_changed"); }
  #authorizationScope(session) { return session.user.userId; }
  #snapshotIdentity(session) { return { userId: session.user.userId }; }
  #applySession(session) { this.session.set(session); return session; }
  async refreshSession() { return this.session.get(); }
  async #readEventStream(_after, profile) {
    this.reads.push(profile);
    if (profile === "projects") { this.#resolveProjectRequest(); return this.#projectHistory; }
    if (profile === "workspace") {
      this.#resolveWorkspaceRequest();
      if (this.#pauseWorkspace) return this.#workspaceHistory;
    }
    return { events: [{ eventId: profile, sequence: 2 }], content: {}, head: 2 };
  }
  async #upgradeHistory(profile) {
    this.upgrades.push(profile);
    const incoming = await this.#readEventStream(0, profile);
    this.events.set(incoming.events);
    this.head.set(incoming.head);
    this.#historyProfile = profile;
  }
  #publishAppended() {}
  async syncDocumentFromRoute() {}
  #syncVisibleJobs() {}
  async #hydrateVisiblePrivateContent() {}
  notify() { this.notifications += 1; }

  ${actualMethod(storeSource, "FormaStore", "load")}
}

class ActivityBase {
  constructor(session) {
    this.calls = [];
    this.i18n = {
      locale: "en-US",
      messages: {},
      number: (value) => String(value),
      system: (value) => value,
      t: (_key, fallback = "") => fallback,
      date: (value) => value.toISOString(),
    };
    this.store = {
      session: { get: () => session },
      refreshEvents: () => { this.calls.push("events"); return Promise.resolve(); },
      syncReviewInbox: () => { this.calls.push("reviews"); },
      syncProjectNotifications: () => { this.calls.push("notifications"); },
      syncDocumentJobs: () => { this.calls.push("jobs"); },
      recoverDocumentPresentation: (jobId) => { this.calls.push("presentation:" + jobId); },
      recoverDocumentRender: (jobId) => { this.calls.push("provider:" + jobId); },
      openDocument: (documentId, path) => { this.calls.push("open:" + documentId + ":" + path); },
      dismissDocumentJobFailure: (jobId) => { this.calls.push("dismiss:" + jobId); },
    };
  }
  connectedCallback() { this.calls.push("connected"); }
}

export class ActivityLifecycleHarness extends ActivityBase {
  ${actualMethod(activitySource, "FormaActivity", "connectedCallback")}
  ${actualMethod(activitySource, "FormaActivity", "#job")}
  renderJob(job, documentName) { return this.#job(job, documentName); }
}

export class DeliverLifecycleHarness extends ActivityBase {
  ${actualMethod(deliverSource, "FormaDeliver", "connectedCallback")}
}
`;

const { outputText } = ts.transpileModule(harnessSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  fileName: "activity-navigation-harness.ts",
});
const { RouteStoreHarness, ActivityLifecycleHarness, DeliverLifecycleHarness } = await import(`data:text/javascript,${encodeURIComponent(outputText)}`);
delete globalThis[runtimeKey];

function visibleText(value) {
  if (value === null || value === undefined || typeof value === "symbol" || typeof value === "function") return "";
  if (Array.isArray(value)) return value.map(visibleText).join("");
  if (typeof value === "object" && Array.isArray(value.strings) && Array.isArray(value.values)) {
    return value.strings.map((part, index) => part + visibleText(value.values[index])).join("");
  }
  return String(value);
}

function actionHandlers(value) {
  if (typeof value === "function") return [value];
  if (Array.isArray(value)) return value.flatMap(actionHandlers);
  if (value && typeof value === "object" && Array.isArray(value.values)) return value.values.flatMap(actionHandlers);
  return [];
}

function generationJob(overrides = {}) {
  return {
    jobId: "job-1",
    documentId: "document-1",
    kind: "render_document",
    status: "failed",
    result: { artifactKind: "slides" },
    error: "private provider diagnostics should never be rendered",
    errorDetail: {
      code: "source_fidelity_validation_failed",
      category: "provider",
      scope: "request",
      action: "edit_request",
      message: "sensitive provider response should remain private",
      retryable: false,
      retryAfterMs: null,
      requestId: "req_private",
      httpStatus: 422,
    },
    members: [],
    requestedAt: "2026-08-25T15:00:00.000Z",
    updatedAt: "2026-08-25T15:03:00.000Z",
    completedAt: null,
    stage: "rendering",
    progressMessage: "",
    ...overrides,
  };
}

test("Activity upgrades the active route when navigation interrupts an initial Projects load", async () => {
  const store = new RouteStoreHarness();
  const loading = store.load();

  await store.projectRequested;
  store.route.set("/activity");
  store.releaseProjects();
  await loading;

  assert.deepEqual(store.reads, ["projects", "workspace"]);
  assert.deepEqual(store.upgrades, ["workspace"]);
  assert.equal(store.routeDataReady(), true);
  assert.equal(store.loading.get(), false);
  assert.equal(store.error.get(), "");
});

test("Deliver upgrades the active route when navigation interrupts an initial Projects load", async () => {
  const store = new RouteStoreHarness();
  const loading = store.load();

  await store.projectRequested;
  store.route.set("/deliver");
  store.releaseProjects();
  await loading;

  assert.deepEqual(store.reads, ["projects", "workspace"]);
  assert.deepEqual(store.upgrades, ["workspace"]);
  assert.equal(store.routeDataReady(), true);
  assert.equal(store.loading.get(), false);
  assert.equal(store.error.get(), "");
});

test("Deliver stays hydrated when navigation changes during an in-flight Activity upgrade", async () => {
  const store = new RouteStoreHarness();
  store.pauseWorkspace();
  const loading = store.load();

  await store.projectRequested;
  store.route.set("/activity");
  store.releaseProjects();
  await store.workspaceRequested;
  store.route.set("/deliver");
  store.releaseWorkspace();
  await loading;

  assert.deepEqual(store.reads, ["projects", "workspace"]);
  assert.deepEqual(store.upgrades, ["workspace"]);
  assert.equal(store.route.get(), "/deliver");
  assert.equal(store.routeDataReady(), true);
  assert.equal(store.loading.get(), false);
});

test("Deliver requires workspace history to invalidate an approval after its source changes", () => {
  const event = (sequence, type, payload) => ({
    eventId: `event-${sequence}`,
    sequence,
    type,
    payload,
    actor: "independent-reviewer",
    occurredAt: "2026-08-25T12:00:00.000Z",
  });
  const events = [
    event(1, "ProjectCreated", { project_id: "project-a", name: "Project A" }),
    event(2, "DocumentCreated", { project_id: "project-a", document_id: "document-a", title: "Study" }),
    event(3, "BlockCreated", { project_id: "project-a", document_id: "document-a", block_id: "source-a", type: "direction", properties: { text: "Original" } }),
    event(4, "DocumentRenderCompleted", { project_id: "project-a", document_id: "document-a", artifact_id: "artifact-a", artifact_kind: "slides", title: "Presentation", source_block_versions: [{ block_id: "source-a", version: 1 }], items: [] }),
    event(5, "ArtifactApproved", { artifact_id: "artifact-a" }),
    event(6, "BlockPropertyEdited", { block_id: "source-a", property_path: "text", new_value: "Changed after approval" }),
  ];
  const projectEvents = events.filter(({ type, payload }) => eventMatchesProfile("projects", type, payload));
  const workspaceEvents = events.filter(({ type, payload }) => eventMatchesProfile("workspace", type, payload));
  const projects = foldEvents(projectEvents);
  const workspace = foldEvents(workspaceEvents);

  assert.equal(projects.libraryBlocks[0].sourceEvents.length, 1);
  assert.equal(workspace.libraryBlocks[0].sourceEvents.length, 2);
  assert.equal(artifactReviewState(projects.libraryArtifacts[0], projects.libraryBlocks, projectEvents).status, "approved");
  assert.equal(artifactReviewState(workspace.libraryArtifacts[0], workspace.libraryBlocks, workspaceEvents).status, "stale");
});

test("initial loading follows a second navigation that occurs during a history upgrade", async () => {
  const store = new RouteStoreHarness();
  store.pauseWorkspace();
  const loading = store.load();

  await store.projectRequested;
  store.route.set("/activity");
  store.releaseProjects();
  await store.workspaceRequested;
  store.route.set("/memory");
  store.releaseWorkspace();
  await loading;

  assert.deepEqual(store.reads, ["projects", "workspace", "memory"]);
  assert.deepEqual(store.upgrades, ["workspace", "memory"]);
  assert.equal(store.routeDataReady(), true);
  assert.equal(store.loading.get(), false);
});

test("Activity refreshes actor-private reviews and jobs whenever its route connects", () => {
  const activity = new ActivityLifecycleHarness({ user: { userId: "authorized-user" } });

  activity.connectedCallback();

  assert.deepEqual(activity.calls, ["connected", "reviews", "jobs"]);
});

test("Activity refreshes project notifications only within the current shared-project context", () => {
  const activity = new ActivityLifecycleHarness({ user: { userId: "authorized-user" }, projectContext: { projectId: "project-a" } });

  activity.connectedCallback();

  assert.deepEqual(activity.calls, ["connected", "reviews", "notifications", "jobs"]);
});

test("Activity cannot request private feeds before an authenticated session exists", () => {
  const activity = new ActivityLifecycleHarness(null);

  activity.connectedCallback();

  assert.deepEqual(activity.calls, ["connected"]);
});

test("Deliver refreshes current project outputs whenever its route connects", () => {
  const deliver = new DeliverLifecycleHarness({ user: { userId: "authorized-user" } });

  deliver.connectedCallback();

  assert.deepEqual(deliver.calls, ["connected", "events"]);
});

test("Deliver refreshes shared-project history without requesting private job or review feeds", () => {
  const deliver = new DeliverLifecycleHarness({ user: { userId: "authorized-user" }, projectContext: { projectId: "project-a" } });

  deliver.connectedCallback();

  assert.deepEqual(deliver.calls, ["connected", "events"]);
});

test("Deliver cannot refresh project history before an authenticated session exists", () => {
  const deliver = new DeliverLifecycleHarness(null);

  deliver.connectedCallback();

  assert.deepEqual(deliver.calls, ["connected"]);
});

test("Deliver tolerates a temporary event-refresh failure without exposing an unhandled rejection", async () => {
  const deliver = new DeliverLifecycleHarness({ user: { userId: "authorized-user" } });
  deliver.store.refreshEvents = () => { deliver.calls.push("events"); return Promise.reject(new Error("temporary event failure")); };

  deliver.connectedCallback();
  await Promise.resolve();

  assert.deepEqual(deliver.calls, ["connected", "events"]);
});

test("Activity explains the actual failed output and safe correction without exposing provider diagnostics", () => {
  const activity = new ActivityLifecycleHarness({ capabilities: [] });
  const markup = visibleText(activity.renderJob(generationJob(), "All of them?"));

  assert.match(markup, /Your private operation[\s\S]*Slides/);
  assert.match(markup, /The presentation did not preserve its source/);
  assert.match(markup, /failed source-fidelity validation and was not accepted/);
  assert.match(markup, /All of them\?/);
  assert.match(markup, /2026-08-25T15:03:00\.000Z/);
  assert.match(markup, /Open document/);
  assert.match(markup, /Dismiss notice/);
  assert.doesNotMatch(markup, /private provider diagnostics|sensitive provider response|req_private/);
});

test("Activity safely recovers a previously paid presentation without starting another generation", () => {
  const activity = new ActivityLifecycleHarness({ capabilities: [] });
  const result = activity.renderJob(generationJob({ result: { artifactKind: "slides", recoverablePresentationCandidate: true } }), "Investor deck");
  const handlers = actionHandlers(result);

  assert.match(visibleText(result), /Paid once · replay without another provider call/);
  assert.match(visibleText(result), /Recover saved render/);
  handlers[0]();
  handlers[1]();
  handlers[2]();

  assert.deepEqual(activity.calls, ["presentation:job-1", "open:document-1:/", "dismiss:job-1"]);
});

test("Activity never promises free slideshow recovery for a source-invalid retained response",()=>{
  const activity=new ActivityLifecycleHarness({capabilities:[]});
  const result=activity.renderJob(generationJob({
    result:{artifactKind:"slides",recoverablePresentationCandidate:true},
    errorDetail:{...generationJob().errorDetail,validationIssues:[{code:"unknown_source_reference",path:"items.0.slide.source_ids",category:"authorization",blocking:true,overridable:false,pageIndex:0,pageCount:1,globalSlideIndex:1,providerAttempt:2,stage:"repair"}]},
  }),"Investor deck");

  assert.doesNotMatch(visibleText(result),/Paid once · replay without another provider call|Recover saved render/);
  assert.match(visibleText(result),/Open document/);
});

test("Activity resumes an existing provider video instead of creating a duplicate paid request", () => {
  const activity = new ActivityLifecycleHarness({ capabilities: [] });
  const job = generationJob({
    result: { artifactKind: "video", providerJobId: "provider-job-1" },
    errorDetail: {
      code: "fal_status_response_invalid",
      category: "network",
      scope: "provider",
      action: "retry",
      message: "upstream transport receipt",
      retryable: true,
      retryAfterMs: null,
      requestId: "req_private",
      httpStatus: 503,
    },
  });
  const result = activity.renderJob(job, "Campaign launch");

  assert.match(visibleText(result), /Fal returned an incomplete video update/);
  assert.match(visibleText(result), /Recover saved render/);
  actionHandlers(result)[0]();

  assert.deepEqual(activity.calls, ["provider:job-1"]);
});

test("Activity exposes billing remediation only to the authorized, nonimpersonating platform principal", () => {
  const job = generationJob({
    kind: "generate",
    result: null,
    errorDetail: {
      code: "insufficient_quota",
      category: "quota",
      scope: "organization",
      action: "add_credits",
      message: "private billing receipt",
      retryable: false,
      retryAfterMs: null,
      requestId: null,
      httpStatus: 429,
    },
  });
  const unauthorized = new ActivityLifecycleHarness({ capabilities: [] });
  const administrator = new ActivityLifecycleHarness({ capabilities: ["platform.policy.manage"] });
  const impersonating = new ActivityLifecycleHarness({ capabilities: ["platform.policy.manage"], impersonation: { userId: "other" } });

  assert.doesNotMatch(visibleText(unauthorized.renderJob(job, "Visual direction")), /Open billing settings|platform\.openai\.com/);
  assert.match(visibleText(administrator.renderJob(job, "Visual direction")), /Open billing settings/);
  assert.match(visibleText(administrator.renderJob(job, "Visual direction")), /noopener noreferrer/);
  assert.doesNotMatch(visibleText(impersonating.renderJob(job, "Visual direction")), /Open billing settings|platform\.openai\.com/);
});

test("Activity reports meaningful live generation progress without inventing a completion time", () => {
  const activity = new ActivityLifecycleHarness({ capabilities: [] });
  const result = activity.renderJob(generationJob({
    status: "running",
    result: { artifactKind: "storyboard" },
    error: null,
    errorDetail: null,
    stage: "rendering-frames",
    progressMessage: "Rendering frame 2 of 4",
  }), "Launch storyboard");
  const markup = visibleText(result);

  assert.match(markup, /Storyboard/);
  assert.match(markup, /Rendering frame 2 of 4/);
  assert.match(markup, /2 of 4 frames stored/);
  assert.doesNotMatch(markup, /Dismiss notice|Recover saved render/);
  assert.equal(actionHandlers(result).length, 1);
});
