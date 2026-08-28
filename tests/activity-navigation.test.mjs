import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { artifactReviewState } from "../src/model/context-health.ts";
import { formaActivityAttention, formaActivityJobNeedsAttention, formaActivityUnread, scopedFormaActivity } from "../src/model/activity.ts";
import { describeOutputs, imageOutputNamingCandidate } from "../src/model/output-naming.ts";
import { libraryFocusRoute, withProjectTaskDocumentInRoute } from "../src/model/routes.ts";
import { documentJobStopBudgetMessage } from "../src/model/document-jobs.ts";
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
import { captureAccountSnapshotFence, accountSnapshotFenceCurrent } from "../src/state/account-cache.ts";
import { foldEvents } from "../src/model/events.ts";
import { formaSystemMessageId } from "../src/components/design-system/system-message-id.ts";
import frenchMessages from "../src/components/design-system/locales/fr.ts";
import arabicMessages from "../src/components/design-system/locales/ar.ts";
import japaneseMessages from "../src/components/design-system/locales/ja.ts";
import {
  localizedDocumentJobProgress,
  localizedDocumentJobProgressDetail,
  localizedGenerationFailureGuidance,
} from "../src/components/design-system/localized-runtime-copy.ts";

const [storeSource, activitySource, deliverSource, localizationSource] = await Promise.all([
  readFile(new URL("../src/state/store.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/components/forma-activity.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/components/forma-deliver.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/components/design-system/localization.ts", import.meta.url), "utf8"),
]);

const runtimeKey = Symbol.for("forma.activity-navigation-test.runtime");
globalThis[runtimeKey] = {
  formaActivityJobNeedsAttention,
  formaActivityUnread,
  scopedFormaActivity,
  describeOutputs,
  imageOutputNamingCandidate,
  libraryFocusRoute,
  withProjectTaskDocumentInRoute,
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
  captureAccountSnapshotFence,
  accountSnapshotFenceCurrent,
};

function actualMethod(source, className, methodName) {
  const syntax = ts.createSourceFile(`${className}.ts`, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declaration = syntax.statements.find((statement) => ts.isClassDeclaration(statement) && statement.name?.text === className);
  assert.ok(declaration, `the actual ${className} class remains available`);
  const method = declaration.members.find((member) => ts.isMethodDeclaration(member) && member.name.getText(syntax) === methodName);
  assert.ok(method, `the actual ${className}.${methodName} method remains available`);
  return method.getText(syntax);
}

function actualStoreSourceField(name) {
  const syntax = ts.createSourceFile("store.ts", storeSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declaration = syntax.statements.find(statement => ts.isClassDeclaration(statement) && statement.name?.text === "FormaStore");
  const fields = declaration?.members.filter(member => ts.isPropertyDeclaration(member) && member.name?.getText(syntax) === name) ?? [];
  if (fields.length !== 1) throw new Error("Expected one complete Store source field " + name);
  return fields[0].getText(syntax);
}

const harnessSource = `
const {
  formaActivityJobNeedsAttention,
  formaActivityUnread,
  scopedFormaActivity,
  describeOutputs,
  imageOutputNamingCandidate,
  libraryFocusRoute,
  withProjectTaskDocumentInRoute,
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
  captureAccountSnapshotFence,
  accountSnapshotFenceCurrent,
} = globalThis[Symbol.for("forma.activity-navigation-test.runtime")];
const nothing = Symbol("nothing");
const html = (strings, ...values) => ({ strings: [...strings], values });
// Template-only traversal for this childless reduced host. Full-parent tests
// exercise the actual Lit directive and keyed DOM identity separately.
const repeat = (items, ...args) => Array.from(items, args.at(-1));
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
  // Exact production source ownership and publication closure. The existing
  // session/profile/cache I/O ports below remain explicitly simulated.
  ${["#sourceGeneration","#sourceRetired","#retiredSourceProjectId","#sourceOwners","#sourceReadSequence","#sourcePublishedRead","#sourceContentReadIds","#sourceCertifiedCoverage"].map(actualStoreSourceField).join("\n")}
  ${["#activeAuthorizationScope","captureAuthorizationScope","authorizationScopeActive","captureSourceOwnership","sourceOwnershipScopeActive","sourceOwnershipActive","#sourceReadOwned","#sourceExpiryValid","#sourceDeadlineCurrent","#sourceReadCurrent","#assertSourceRead","#beginSourceRead","#sourceCacheGuard","#sourceContentReferences","#mergeSourceContent","#publishSourceRead"].map(name => actualMethod(storeSource, "FormaStore", name)).join("\n")}

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
  ${actualMethod(storeSource, "FormaStore", "#scopeStillActive")}
  #assertAuthorizationScope(scope) { if (!this.#scopeStillActive(scope)) throw new Error("authorization_changed"); }
  #authorizationScope(session) { return session.user.userId; }
  #snapshotIdentity(session) { return { userId: session.user.userId }; }
  #applySession(session) { this.session.set(session); return session; }
  async refreshSession() { return this.session.get(); }
  async #readEventStream(after, profile, _includeContent = false, owned) {
    const read = owned ?? this.#beginSourceRead(profile);
    this.#assertSourceRead(read);
    read.complete = false; read.from = Math.max(0, after); profile = read.profile;
    this.reads.push(profile);
    let page;
    if (profile === "projects") {
      this.#resolveProjectRequest(); page = await this.#projectHistory;
    } else if (profile === "workspace") {
      this.#resolveWorkspaceRequest();
      if (this.#pauseWorkspace) page = await this.#workspaceHistory;
    }
    page ??= { events: [{ eventId: profile, sequence: 2 }], content: {}, head: 2 };
    this.#assertSourceRead(read);
    // Only this completed, whole-profile SIMULATED history is complete. This
    // is not a Worker/server receipt or device-cache revalidation certificate.
    read.complete = true;
    return { ...page, read };
  }
  async #upgradeHistory(profile) {
    this.upgrades.push(profile);
    const incoming = await this.#readEventStream(0, profile);
    this.#publishSourceRead(incoming, () => {
      this.events.set(incoming.events);
      this.head.set(incoming.head);
      this.#historyProfile = profile;
    });
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
      route: { get: () => "/activity" },
      // A neutral absent source token is not an authorization grant.
      captureSourceOwnership: () => null,
      refreshEvents: () => { this.calls.push("events"); return Promise.resolve(); },
      syncReviewInbox: () => { this.calls.push("reviews"); },
      syncProjectNotifications: () => { this.calls.push("notifications"); },
      syncOrganizationContextPackages: () => { this.calls.push("context-packages"); },
      syncDocumentJobs: () => { this.calls.push("jobs"); },
      reviewPlanningJob: (jobId) => { this.calls.push("planning:" + jobId); },
      planningRecoveryEntries: () => [],
      recoverDocumentPresentation: (jobId) => { this.calls.push("presentation:" + jobId); },
      recoverDocumentRender: (jobId) => { this.calls.push("provider:" + jobId); },
      openDocument: (documentId, path) => { this.calls.push("open:" + documentId + ":" + path); },
      dismissDocumentJobFailure: (jobId) => { this.calls.push("dismiss:" + jobId); },
    };
  }
  // No connected child editors exist in this template/lifecycle-only port.
  querySelectorAll() { return []; }
  connectedCallback() { this.calls.push("connected"); }
}

export class ActivityLifecycleHarness extends ActivityBase {
  ${actualMethod(activitySource, "FormaActivity", "connectedCallback")}
  ${actualMethod(activitySource, "FormaActivity", "#open")}
  ${actualMethod(activitySource, "FormaActivity", "#review")}
  ${actualMethod(activitySource, "FormaActivity", "#notification")}
  ${actualMethod(activitySource, "FormaActivity", "#planningRecovery")}
  ${actualMethod(activitySource, "FormaActivity", "#job")}
  ${actualMethod(activitySource, "FormaActivity", "render")}
  renderJob(job, documentName) { return this.#job(job, documentName); }
  renderRecovery(identity, documentName) { return this.#planningRecovery(identity, documentName); }
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

for(const [locale,messages]of[["fr",frenchMessages],["ar",arabicMessages],["ja",japaneseMessages]]){
  test(`Activity stop status: ${locale} preserves retained-hold warnings in the actual card and progress helpers`,()=>{
    const translate=source=>messages[formaSystemMessageId(source)]??source,rawWarnings=[
      documentJobStopBudgetMessage({reservationStatus:"retained",billingStatus:"pending"}),
      "The existing provider request may still be billable; its hold is retained.",
    ];
    for(const force of [false,true])for(const warning of rawWarnings){
      const activity=new ActivityLifecycleHarness({capabilities:[]});
      activity.i18n={...activity.i18n,locale,messages,system:translate,number:value=>new Intl.NumberFormat(locale).format(value),
        t:(id,fallback="",values={})=>(messages[id]??fallback).replace(/\{(\w+)\}/gu,(_,key)=>String(values[key]??""))};
      const raw="Planning was stopped. "+warning,code=force?"adaptive_force_failed":"adaptive_canceled",status=force?"failed":"canceled";
      const job=generationJob({kind:"structure_adaptive",status,stage:status,error:code,result:{noAutomaticRetry:true},
        progressMessage:raw,errorDetail:{code,category:"canceled",scope:"request",action:"none",message:raw,retryable:false,retryAfterMs:null,requestId:null,httpStatus:null}});
      const before=structuredClone(job),expected=translate("Planning was stopped.")+" "+translate(warning);
      assert.notEqual(translate(warning),warning);
      const guidance=localizedGenerationFailureGuidance(generationFailureGuidance(job.errorDetail,job.error,job),job.errorDetail,job.error,activity.i18n);
      assert.equal(guidance.summary,expected);assert.equal(guidance.retryAllowed,false);
      assert.equal(localizedDocumentJobProgress(job,activity.i18n),expected);
      assert.equal(localizedDocumentJobProgressDetail(raw,job,activity.i18n),expected);
      const markup=visibleText(activity.renderJob(job,"AUTHORED_ENGLISH_TITLE"));
      assert.ok(markup.includes(expected),markup);assert.ok(markup.includes("AUTHORED_ENGLISH_TITLE"));
      assert.equal(markup.includes(raw),false);
      assert.equal(markup.includes(translate("No late provider result will be adopted. Start a new request whenever the document is ready.")),false);
      assert.deepEqual(job,before,"Localization does not rewrite the retained receipt or infer new billing state");
    }
    const unknown={code:"adaptive_canceled",category:"canceled",message:"PRIVATE_UNKNOWN_PROVIDER_BYTES"};
    const activity=new ActivityLifecycleHarness({capabilities:[]});activity.i18n={...activity.i18n,locale,messages,system:translate};
    const safe=localizedGenerationFailureGuidance(generationFailureGuidance(unknown,""),unknown,"",activity.i18n);
    assert.equal(safe.summary,translate("Planning was stopped.")+" "+translate(documentJobStopBudgetMessage()));
    assert.doesNotMatch(safe.summary,/PRIVATE_UNKNOWN_PROVIDER_BYTES/u);assert.equal(safe.retryAllowed,false);
  });
}


for (const [locale, messages] of [["fr", frenchMessages], ["ar", arabicMessages], ["ja", japaneseMessages]]) {
  test("Activity late stop billing: " + locale + " presents live settled usage instead of a stale retained-hold receipt", () => {
    const translate = (source) => messages[formaSystemMessageId(source)] ?? source;
    const historicalWarning = documentJobStopBudgetMessage({ reservationStatus: "retained", billingStatus: "pending" });
    const settledWarning = documentJobStopBudgetMessage({ reservationStatus: "settled", billingStatus: "settled" });
    assert.notEqual(translate(settledWarning), settledWarning, "Settled billing copy must exist in " + locale);
    for (const force of [false, true]) {
      const activity = new ActivityLifecycleHarness({ capabilities: [] });
      activity.i18n = { ...activity.i18n, locale, messages, system: translate, number: (value) => new Intl.NumberFormat(locale).format(value),
        t: (id, fallback = "", values = {}) => (messages[id] ?? fallback).replace(/\{(\w+)\}/gu, (_, key) => String(values[key] ?? "")) };
      const raw = "Planning was stopped. " + historicalWarning;
      const code = force ? "adaptive_force_failed" : "adaptive_canceled", status = force ? "failed" : "canceled";
      const job = generationJob({
        kind: "structure_adaptive", planningExecutionId: "job-1", status, stage: status, error: code,
        result: { noAutomaticRetry: true, planningStopBudget: { reservationStatus: "settled", billingStatus: "settled" } },
        progressMessage: raw,
        errorDetail: { code, category: "canceled", scope: "request", action: "none", message: raw, retryable: false, retryAfterMs: null, requestId: null, httpStatus: null },
      });
      const before = structuredClone(job), expected = translate("Planning was stopped.") + " " + translate(settledWarning);
      const guidance = localizedGenerationFailureGuidance(generationFailureGuidance(job.errorDetail, job.error, job), job.errorDetail, job.error, activity.i18n);
      assert.equal(guidance.summary, expected); assert.equal(guidance.retryAllowed, false);
      assert.equal(localizedDocumentJobProgress(job, activity.i18n), expected);
      assert.equal(localizedDocumentJobProgressDetail(raw, job, activity.i18n), expected);
      const markup = visibleText(activity.renderJob(job, "AUTHORED_ENGLISH_TITLE"));
      assert.ok(markup.includes(expected), markup); assert.ok(markup.includes("AUTHORED_ENGLISH_TITLE"));
      assert.equal(markup.includes(raw), false); assert.equal(markup.includes(settledWarning), false);
      assert.equal(markup.includes(translate(historicalWarning)), false, "A historical hold cannot overrule current settled ledgers");
      assert.equal(markup.includes(translate("Unused reserved budget was released.")), false, "Settled usage is not a refund");
      assert.deepEqual(job, before, "Presentation does not rewrite the retained stop receipt or the current server projection");
    }
  });
}
test("Activity full render keeps canceled approved planning visible and resumable for current readers without dismissing it",()=>{
  for(const [locale,messages]of[["fr",frenchMessages],["ar",arabicMessages],["ja",japaneseMessages]])for(const canPurchase of [false,true]){
    const session={user:{userId:"original-actor"},projectContext:{organizationId:"org-1",projectAccessId:"access-1",projectId:"project-1",permissions:["project.read",...(canPurchase?["project.output.request"]:[])]}};
    const activity=new ActivityLifecycleHarness(session),raw="Planning was stopped. "+documentJobStopBudgetMessage({reservationStatus:"retained",billingStatus:"pending"});
    const job=generationJob({kind:"structure_adaptive",planningExecutionId:"job-1",status:"canceled",stage:"canceled",result:{noAutomaticRetry:true},error:"adaptive_canceled",progressMessage:raw,
      errorDetail:{code:"adaptive_canceled",category:"canceled",scope:"request",action:"none",message:raw,retryable:false,retryAfterMs:null,requestId:null,httpStatus:null}});
    const projection={projectId:"project-1",projectName:"AUTHORED_PROJECT",documents:[{id:job.documentId,projectId:"project-1",title:"AUTHORED_DOCUMENT",removed:false}],libraryArtifacts:[],libraryOutputs:[]};
    Object.assign(activity.store,{projection:{get:()=>projection},projectNotifications:{get:()=>[]},reviewInbox:{get:()=>[]},documentJobs:{get:()=>[job]},events:{get:()=>[]}});
    const translate=source=>messages[formaSystemMessageId(source)]??source;
    activity.i18n={...activity.i18n,locale,messages,system:translate,number:value=>new Intl.NumberFormat(locale).format(value),
      t:(id,fallback="",values={})=>(messages[id]??fallback).replace(/\{(\w+)\}/gu,(_,key)=>String(values[key]??""))};
    const scoped=scopedFormaActivity(session,projection,[],[],[job]);assert.equal(scoped.jobs.length,1);assert.equal(formaActivityAttention(scoped),1);
    assert.equal(formaActivityJobNeedsAttention(job),true);assert.equal(formaActivityJobNeedsAttention({...job,planningExecutionId:undefined}),false);
    const rendered=activity.render(),markup=visibleText(rendered);
    assert.ok(markup.includes(messages["activity.needsYou"]));assert.ok(markup.includes(messages["planning.consent.retrieveExisting"]));assert.ok(markup.includes(translate(documentJobStopBudgetMessage({reservationStatus:"retained",billingStatus:"pending"}))));
    assert.equal(markup.includes(translate("Dismiss notice")),false);assert.equal(markup.includes("AUTHORED_DOCUMENT"),true);
    const reopen=actionHandlers(rendered).find(handler=>handler.toString().includes("reviewPlanningJob"));assert.ok(reopen);reopen();
    assert.deepEqual(activity.calls,["planning:job-1"],"Full Activity re-entry addresses only the original execution");
  }
});

function literalActivityMessages(source) {
  const syntax = ts.createSourceFile("localization.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const messages = {};
  function visit(node) {
    if (ts.isPropertyAssignment(node) && ts.isStringLiteralLike(node.name) && ts.isStringLiteralLike(node.initializer)) {
      messages[node.name.text] = node.initializer.text;
    }
    ts.forEachChild(node, visit);
  }
  visit(syntax);
  return messages;
}

// Inspect the actual Activity Lit bindings without claiming browser/AT evidence.
function planningRecoveryControls(rendered) {
  function templates(value) {
    if (Array.isArray(value)) return value.flatMap(templates);
    if (!value || typeof value !== "object" || !Array.isArray(value.strings) || !Array.isArray(value.values)) return [];
    return [value, ...value.values.flatMap(templates)];
  }
  return templates(rendered).filter(template => template.values.some(value => typeof value === "function" && value.toString().includes("reviewPlanningJob"))).map(template => {
    const labelIndex = template.strings.findIndex(part => /\baria-label=\s*$/u.test(part));
    const requestIndex = template.strings.findIndex(part => /\bdata-planning-recovery-id=\s*$/u.test(part));
    const clickIndex = template.strings.findIndex(part => /@click=\s*$/u.test(part));
    const textIndex = template.strings.findIndex((part,index) => index>clickIndex&&/>$/u.test(part));
    assert.ok(labelIndex >= 0, "Each retrieval button needs its own accessible name");
    assert.ok(clickIndex >= 0 && textIndex >= 0, "Keep the existing visible native button and exact request handler");
    assert.ok(requestIndex >= 0, "Both Activity variants expose the same stable request identity for focus return");
    return { requestId: template.values[requestIndex], name: template.values[labelIndex], text: visibleText(template.values[textIndex]), activate: template.values[clickIndex] };
  });
}

const planningRecoveryNameTemplates = {
  en: "{action} — {document} — request {request}",
  fr: "{action} — {document} — demande {request}",
  ar: "{action} — {document} — الطلب {request}",
  ja: "{action} — {document} — リクエスト {request}",
};
for (const [locale, messages] of [["en", literalActivityMessages(localizationSource)], ["fr", frenchMessages], ["ar", arabicMessages], ["ja", japaneseMessages]]) {
  test("Activity omitted planning identity R4: "+locale+" offers only exact free retrieval with unknown current status",()=>{
    const activity=new ActivityLifecycleHarness({user:{userId:"original-actor"},projectContext:{projectId:"project-1",permissions:["project.read"]}});
    activity.i18n={...activity.i18n,locale,messages,t:(id,fallback="",values={})=>{if(id.startsWith("planning."))assert.ok(messages[id],"Recovery copy is explicitly localized");return(messages[id]??fallback).replace(/\{(\w+)\}/gu,(_,key)=>String(values[key]));}};
    const identity={jobId:"12345678-0000-4aaa-8000-123456789abc",planningExecutionId:"12345678-0000-4aaa-8000-123456789abc",documentId:"document-1",kind:"structure_adaptive",sourceSurface:"canvas",canvasId:"board-1",requestKey:"original-key",planningLocale:locale,planningProjectScope:false},before=structuredClone(identity);
    const controls=planningRecoveryControls(activity.renderRecovery(identity,"Plan — 東京 / لينا"));
    assert.equal(controls.length,1);assert.equal(controls[0].text,messages["planning.consent.retrieveExisting"]);assert.ok(controls[0].name.includes(identity.jobId));assert.ok(controls[0].name.includes("Plan — 東京 / لينا"));controls[0].activate();
    assert.equal(controls[0].requestId,identity.jobId,"The outside-feed action binds the complete original ID");
    assert.deepEqual(activity.calls,["planning:"+identity.jobId]);assert.deepEqual(identity,before);assert.ok(messages["planning.recovery.outsideFeed"]);assert.ok(messages["planning.recovery.heading"]);
  });
}
for (const [locale, messages] of [["en", literalActivityMessages(localizationSource)], ["fr", frenchMessages], ["ar", arabicMessages], ["ja", japaneseMessages]]) {
  for (const sameDocument of [false, true]) {
    test("Activity planning recovery names: " + locale + " distinguishes two requests in " + (sameDocument ? "one document" : "different documents"), () => {
      const nameKey = "planning.consent.retrieveNamed", actionKey = "planning.consent.retrieveExisting";
      assert.equal(messages[nameKey], planningRecoveryNameTemplates[locale], "Use the real localized naming template");
      assert.deepEqual([...messages[nameKey].matchAll(/\{(\w+)\}/gu)].map(match => match[1]).sort(), ["action", "document", "request"]);
      assert.ok(messages[actionKey], "Reuse the existing translated visible action");
      const session = { user: { userId: "original-actor" }, projectContext: { organizationId: "org-1", projectAccessId: "access-1", projectId: "project-1", permissions: ["project.read"] } };
      const activity = new ActivityLifecycleHarness(session);
      activity.i18n = { ...activity.i18n, locale, messages, t: (id, fallback = "", values = {}) => {
        if (id === nameKey || id === actionKey) assert.ok(Object.hasOwn(messages, id), locale + ": recovery names must not fall back to English");
        return (messages[id] ?? fallback).replace(/\{(\w+)\}/gu, (_match, key) => {
          assert.ok(Object.hasOwn(values, key), id + ": missing interpolation " + key);
          return String(values[key]);
        });
      } };
      const documents = [
        { id: "document-1", projectId: "project-1", title: "Plan {request} — لينا / 東京", removed: false },
        ...sameDocument ? [] : [{ id: "document-2", projectId: "project-1", title: "Brief «Café» / أسبوع الإطلاق", removed: false }],
      ];
      // Both time and short prefix/suffix collide: only the full identity is distinct.
      const requestIds = ["12345678-0000-4aaa-8000-123456789abc", "12345678-0000-4bbb-8000-123456789abc"];
      const jobs = requestIds.map((jobId, index) => generationJob({ jobId, planningExecutionId: jobId, documentId: documents[sameDocument ? 0 : index].id,
        kind: "structure_adaptive", status: "completed", stage: "completed", result: {}, error: null, errorDetail: null, completedAt: "2026-08-25T15:03:00.000Z" }));
      const before = structuredClone({ documents, jobs });
      let displayedJobs = jobs;
      const projection = { projectId: "project-1", projectName: "AUTHORED_PROJECT", documents, libraryArtifacts: [], libraryOutputs: [] };
      Object.assign(activity.store, { projection: { get: () => projection }, projectNotifications: { get: () => [] }, reviewInbox: { get: () => [] }, documentJobs: { get: () => displayedJobs }, events: { get: () => [] } });
      const controls = planningRecoveryControls(activity.render());
      assert.equal(controls.length, 2, "Current read-only members retain both original request actions");
      for (const [index, control] of controls.entries()) {
        const documentName = documents[sameDocument ? 0 : index].title;
        const expected = messages[nameKey].replace(/\{(\w+)\}/gu, (_match, key) => ({ action: messages[actionKey], document: "\u2068" + documentName + "\u2069", request: "\u2068" + requestIds[index] + "\u2069" })[key]);
        assert.equal(control.text, messages[actionKey], "The visible action stays unchanged");
        assert.equal(control.requestId,requestIds[index],"The in-feed replacement preserves the complete original focus identity");
        assert.equal(control.name, expected, "Name combines the visible action, authored document, and full request identity");
        assert.ok(control.name.startsWith(control.text), "Visible text is contained at the start of the accessible name");
        assert.ok(control.name.includes("\u2068" + documentName + "\u2069"), "Isolate human text without translating or rewriting it");
        assert.ok(control.name.includes("\u2068" + requestIds[index] + "\u2069"), "Isolate the complete request identity for mixed-direction text");
        control.activate();
      }
      assert.equal(new Set(controls.map(control => control.name)).size, 2, "Same-title and same-time requests cannot share a name");
      assert.deepEqual(activity.calls, requestIds.map(jobId => "planning:" + jobId), "Each named control reopens exactly its original request");
      displayedJobs = [...jobs].reverse();
      assert.deepEqual(planningRecoveryControls(activity.render()).map(control => control.name), controls.map(control => control.name).reverse(), "Names stay bound to the request when Activity reorders");
      assert.deepEqual({ documents, jobs }, before, "Naming preserves authored text and immutable receipt data");
    });
  }
}


test("Activity planning focus R5: moving a recovered request keeps its exact binding while a same-title request stays first",()=>{
  const session={user:{userId:"original-actor"},projectContext:{projectId:"project-1",permissions:["project.read"]}},activity=new ActivityLifecycleHarness(session);
  const identities=["original-request","different-request"].map(jobId=>({jobId,planningExecutionId:jobId,documentId:"document-1",kind:"structure_adaptive",sourceSurface:"adaptive",canvasId:null,requestKey:jobId+"-key",planningLocale:"en",planningProjectScope:false}));
  const projection={projectId:"project-1",projectName:"Current project",documents:[{id:"document-1",projectId:"project-1",title:"The same authored title",removed:false}],libraryArtifacts:[],libraryOutputs:[]};
  let jobs=[];
  Object.assign(activity.store,{projection:{get:()=>projection},projectNotifications:{get:()=>[]},reviewInbox:{get:()=>[]},documentJobs:{get:()=>jobs},events:{get:()=>[]},planningRecoveryEntries:()=>identities.filter(identity=>!jobs.some(job=>job.jobId===identity.jobId))});
  const before=planningRecoveryControls(activity.render());assert.deepEqual(before.map(control=>control.requestId),["original-request","different-request"]);
  jobs=[generationJob({...identities[0],status:"completed",stage:"completed",result:{},error:null,errorDetail:null})];
  const after=planningRecoveryControls(activity.render());assert.deepEqual(after.map(control=>control.requestId),["different-request","original-request"]);
  after.find(control=>control.requestId==="original-request").activate();assert.deepEqual(activity.calls,["planning:original-request"]);
});


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

  assert.deepEqual(activity.calls, ["connected", "reviews", "notifications", "context-packages", "jobs"]);
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

test("Activity exposes the exact existing planning job to a current reader without purchase or dismiss actions",()=>{
  const activity=new ActivityLifecycleHarness({user:{userId:"original-actor"},projectContext:{permissions:["project.read"]}});
  const saved=generationJob({kind:"structure_adaptive",planningExecutionId:"job-1",status:"completed",result:{},error:null,errorDetail:null});
  const rendered=activity.renderJob(saved,"Original plan destination");
  assert.match(visibleText(rendered),/Retrieve existing plan/);assert.doesNotMatch(visibleText(rendered),/Dismiss notice|Recover saved render/);
  const handlers=actionHandlers(rendered);handlers[0]();assert.deepEqual(activity.calls,["planning:job-1"]);
  const legacy=activity.renderJob({...saved,planningExecutionId:undefined},"Original destination");assert.doesNotMatch(visibleText(legacy),/Retrieve existing plan/);
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
