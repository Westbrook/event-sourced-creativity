import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { formaActivityAttention, scopedFormaActivity } from "../src/model/activity.ts";
import { documentJobHasNoBudgetHold, documentJobTerminal, planningStopBudget } from "../src/model/document-jobs.ts";
import { documentIdFromRoute } from "../src/model/routes.ts";
import { routeCapabilities } from "../src/state/route-capabilities.ts";

const source = await readFile(new URL("../src/state/store.ts", import.meta.url), "utf8");
const syntax = ts.createSourceFile("store.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const store = syntax.statements.find((entry) => ts.isClassDeclaration(entry) && entry.name?.text === "FormaStore");
function method(name) {
  const member = store?.members.find((entry) => ts.isMethodDeclaration(entry) && entry.name.getText(syntax) === name);
  assert.ok(member, `the actual FormaStore.${name} method remains available`);
  return member.getText(syntax);
}
// The current store separates free job reading from paid output permission.
// Keep its accepted recovery helpers intact in this focused job-history host.
function recoveryHelpers() {
  const present = new Set(["#jobDetails", "#dismissedAdaptiveSuggestions"]);
  // Public ownership calls do not appear as PrivateIdentifier nodes. Seed their
  // actual methods, then retain their private identity, branding and expiry closure.
  const pending = ["captureSourceOwnership", "sourceOwnershipScopeActive", "sourceOwnershipActive",
    "captureAuthorizationScope", "authorizationScopeActive", "#assertSourceOwnership",
    "#canReadProjectJobs", "planningRecoveryEntries", "#observeAdaptivePlanningJob", "#revalidateMissingAdaptivePlans"];
  const copied = [];
  while (pending.length) {
    const name = pending.shift();
    if (present.has(name)) continue;
    present.add(name);
    const member = store?.members.find((entry) => entry.name?.getText(syntax) === name);
    assert.ok(member && (ts.isMethodDeclaration(member) || ts.isPropertyDeclaration(member)), `actual accepted store member ${name}`);
    copied.push(member.getText(syntax));
    const visit = (node) => {
      if (ts.isPrivateIdentifier(node) && !present.has(node.getText(syntax))) pending.push(node.getText(syntax));
      ts.forEachChild(node, visit);
    };
    visit(member);
  }
  return copied.join("\n");
}
const runtimeKey = Symbol.for("forma.project-attention-loading.runtime");
globalThis[runtimeKey] = { documentIdFromRoute, documentJobHasNoBudgetHold, documentJobTerminal, planningStopBudget, routeCapabilities };
const harness = ts.transpileModule(`
const {documentIdFromRoute,documentJobHasNoBudgetHold,documentJobTerminal,planningStopBudget,routeCapabilities}=globalThis[Symbol.for("forma.project-attention-loading.runtime")];
const document={visibilityState:"visible",documentElement:{dataset:{formaPhase:"populated"}}};
const window={clearTimeout:()=>{}};
class State {constructor(value){this.value=value;}get(){return this.value;}set(value){this.value=value;}}
export class JobLoadingStore {
  route=new State("/document/document-a/fixture");
  session=new State({user:{userId:"fixture-actor"},projects:[],capabilities:["project.read"],permissionEpoch:"fixture-epoch",policy:{version:"fixture-policy",accepted:true}});
  projection=new State({projectId:"project-a",documents:[]});
  content=new State({});events=new State([]);
  planningConsent=new State(null);adaptiveSuggestionSets=new State({});
  documentJobs=new State([]);
  adaptiveStructures=new State({});
  schedules=[];writes=[];notifications=0;
  #jobsSyncing=false;#jobSyncScope="";#jobResyncRequested=false;#jobDetails=new Map();
  #jobPollTimer=0;#pendingPassiveJobPath="";#jobPollFailures=0;#jobPollIssueNotified=false;
  #pendingJobEventRefresh=false;#pendingJobSessionRefresh=false;
  #dismissedAdaptiveSuggestions=new Set();#pendingJobNotices=[];
  async #refreshEvents(){throw new Error("existing notified failures must not rewrite history");}
  async refreshSession(){return this.session.get();}
  #syncAdaptiveSuggestionSets(){}
  #jobResultVisible(){return false;}
  #jobNotice(){return "fixture notice";}
  #ackJob(jobId){this.writes.push(jobId);}
  #driveDocumentJobs(){}
  #scheduleJobPoll(delay){this.schedules.push(delay);}
  toast(){}
  notify(){this.notifications+=1;}
  ${recoveryHelpers()}
  ${method("#canRequestProjectOutputs")}
  ${method("#jobScope")}
  ${method("#syncVisibleJobs")}
  ${method("syncDocumentJobs")}
  show(path){this.route.set(path);this.#syncVisibleJobs(path);}
}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
const { JobLoadingStore } = await import(`data:text/javascript,${encodeURIComponent(harness.outputText)}`);
delete globalThis[runtimeKey];

test("real store polling keeps failed jobs when moving from a Document to Project overview", async (context) => {
  const store = new JobLoadingStore();
  const projection = { projectId: "project-a", documents: [
    { id: "document-a", projectId: "project-a", removed: false },
    { id: "document-b", projectId: "project-a", removed: false },
    { id: "foreign-document", projectId: "project-b", removed: false },
  ], libraryArtifacts: [] };
  store.projection.set(projection);
  const failed = { jobId: "failed-slides", documentId: "document-a", kind: "render_document", status: "failed", dismissedAt: null,
    notifiedAt: "2026-08-27T15:30:00.000Z", updatedAt: "2026-08-27T15:29:00.000Z", members: [],
    result: { artifactKind: "slides", generationReceipt: { actual_provider_call_count: 2 } } };
  const retained = [failed,
    { ...failed, jobId: "partial-other-document", documentId: "document-b", status: "partial" },
    { ...failed, jobId: "foreign-failure", documentId: "foreign-document" },
    { ...failed, jobId: "dismissed-failure", dismissedAt: "2026-08-27T15:31:00.000Z" },
    { ...failed, jobId: "completed", status: "completed" },
  ];
  const requests = [];
  context.mock.method(globalThis, "fetch", async (path, options) => {
    assert.equal(options?.method ?? "GET", "GET", "attention loading is read-only");
    const url = new URL(path, "http://fixture.local");
    assert.equal(url.pathname, "/api/document-jobs", "no private receipt or provider endpoint is fetched");
    requests.push(path);
    const active = url.searchParams.get("scope") === "active";
    const documentId = url.searchParams.get("document");
    return Response.json({ jobs: retained.filter((job) => (!active || ["queued", "running", "committing"].includes(job.status))
      && (!documentId || documentId === job.documentId)) });
  });
  const attention = () => formaActivityAttention(scopedFormaActivity(store.session.get(), projection, [], [], store.documentJobs.get()));
  await store.syncDocumentJobs();
  assert.equal(attention(), 1);

  const sync = store.syncDocumentJobs.bind(store);
  let projectSync;
  store.syncDocumentJobs = () => projectSync = sync();
  store.show("/studio/project");
  assert.ok(projectSync, "Project overview loads its required terminal job history immediately");
  await projectSync;
  assert.equal(attention(), 2, "the project counts both of its documents, not foreign, dismissed, or completed jobs");
  assert.deepEqual(requests, ["/api/document-jobs?document=document-a", "/api/document-jobs"]);
  assert.equal(store.documentJobs.get().find((job) => job.jobId === failed.jobId).result.generationReceipt.actual_provider_call_count, 2,
    "two paid responses remain one failed job");
  assert.deepEqual(store.writes, []);
  assert.deepEqual(store.schedules, [60_000, 60_000], "both actual reads finish normally instead of falling into retry recovery");
  assert.equal(projection.libraryArtifacts.length, 0);
  assert.deepEqual(routeCapabilities("/studio/project?collection=fixture#summary"), { profile: "workspace", privateContent: false, jobHistory: true });
});

test("Project overview does not request jobs for a principal without project output permission", async (context) => {
  const store = new JobLoadingStore();
  store.session.set({ user: { userId: "fixture-viewer" }, projectContext: { projectId: "project-a", permissions: [] }, permissionEpoch: "fixture-denied", policy: { version: "fixture-policy", accepted: true } });
  context.mock.method(globalThis, "fetch", async () => { throw new Error("unauthorized job request"); });
  store.show("/studio/project");
  await store.syncDocumentJobs();
  assert.deepEqual(store.documentJobs.get(), []);
  assert.deepEqual(store.schedules, []);
  assert.deepEqual(store.writes, []);
});

function scopedAttentionSession(expiresAt) {
  return {
    user: { userId: "fixture-reader" }, permissionEpoch: "fixture-reader-epoch",
    policy: { version: "fixture-policy", accepted: true }, capabilities: [],
    projectContext: { projectId: "project-a", organizationId: "fixture-organization",
      projectAccessId: "fixture-project-access", ownerUserId: "fixture-owner",
      permissions: ["project.read"], expiresAt },
  };
}

function attentionFailure() {
  return { jobId: "retained-failure", documentId: "document-a", kind: "render_document",
    status: "failed", dismissedAt: null, members: [],
    notifiedAt: "2026-08-27T15:30:00.000Z", updatedAt: "2026-08-27T15:29:00.000Z",
    result: { artifactKind: "slides", generationReceipt: { actual_provider_call_count: 2 },
      privateFixtureText: "only the current owned response may publish this body" } };
}

test("job-history fixture uses the actual Store-instance source ownership brand", () => {
  const store = new JobLoadingStore(), other = new JobLoadingStore();
  const token = store.captureSourceOwnership();
  assert.ok(token);
  assert.equal(Object.isFrozen(token), true);
  assert.equal(Object.isFrozen(token.authorization), true);
  assert.equal(store.sourceOwnershipActive(token), true);
  assert.equal(store.sourceOwnershipScopeActive(token), true);
  assert.equal(store.sourceOwnershipActive({ ...token }), false, "equal fields do not manufacture a Store-owned ticket");
  assert.equal(store.sourceOwnershipScopeActive({ ...token }), false);
  assert.equal(other.sourceOwnershipActive(token), false, "the same actor in another Store cannot own this ticket");
  assert.equal(store.sourceOwnershipActive(other.captureSourceOwnership()), false);
  store.session.set(null);
  assert.equal(store.captureSourceOwnership(), null);
  assert.equal(store.sourceOwnershipScopeActive(token), false);
  assert.equal(store.sourceOwnershipActive(token), false);
});

for (const state of ["current", "expired", "invalid"]) {
  test("project job polling keeps actual selected-source deadline checks: " + state, async (context) => {
    const now = Date.UTC(2026, 7, 28, 12);
    context.mock.method(Date, "now", () => now);
    const store = new JobLoadingStore();
    const expiresAt = state === "invalid" ? "not-an-expiry"
      : new Date(now + (state === "current" ? 60_000 : -1)).toISOString();
    store.session.set(scopedAttentionSession(expiresAt));
    store.route.set("/studio/project");
    const token = store.captureSourceOwnership(), requests = [], failed = attentionFailure();
    context.mock.method(globalThis, "fetch", async (path, options) => {
      assert.equal(options?.method ?? "GET", "GET");
      assert.equal(path, "/api/document-jobs", "only the ordinary free job-history endpoint is read");
      requests.push(path);
      return Response.json({ jobs: [failed] });
    });
    assert.equal(store.session.get().projectContext.permissions.includes("project.output.request"), false);
    assert.equal(store.sourceOwnershipScopeActive(token), true, "original scope bookkeeping is not permission to publish expired content");
    assert.equal(store.sourceOwnershipActive(token), state === "current");
    await store.syncDocumentJobs();
    assert.deepEqual(requests, state === "current" ? ["/api/document-jobs"] : []);
    assert.deepEqual(store.documentJobs.get(), state === "current" ? [failed] : []);
    assert.deepEqual(store.schedules, state === "current" ? [60_000] : []);
    assert.deepEqual(store.writes, []);
  });
}

for (const change of ["none", "captured-expiry-renewed", "current-expiry-shortened", "permission-epoch", "actor", "project-access"]) {
  test("a delayed job page preserves the actual original source owner: " + change, { timeout: 5_000 }, async (context) => {
    let now = Date.UTC(2026, 7, 28, 12);
    context.mock.method(Date, "now", () => now);
    const deadline = now + 1_000, store = new JobLoadingStore();
    const session = scopedAttentionSession(new Date(deadline).toISOString());
    store.session.set(session);
    const token = store.captureSourceOwnership(), failed = attentionFailure(), requests = [];
    const entered = Promise.withResolvers(), release = Promise.withResolvers();
    context.after(() => release.resolve());
    context.mock.method(globalThis, "fetch", async (path, options) => {
      assert.equal(options?.method ?? "GET", "GET");
      assert.equal(path, "/api/document-jobs?document=document-a");
      requests.push(path);
      const response = Response.json({ jobs: [failed] }), read = response.json.bind(response);
      response.json = async () => {
        const body = await read();
        entered.resolve();
        await release.promise;
        return body;
      };
      return response;
    });
    const pending = store.syncDocumentJobs();
    await entered.promise;
    if (change === "captured-expiry-renewed") {
      now = deadline + 1;
      store.session.set({ ...session, projectContext: { ...session.projectContext,
        expiresAt: new Date(now + 60_000).toISOString() } });
      assert.equal(store.captureAuthorizationScope().key, token.authorization.key);
      assert.equal(store.sourceOwnershipActive(store.captureSourceOwnership()), true, "a new healthy capture cannot revive the expired original read");
    } else if (change === "current-expiry-shortened") {
      store.session.set({ ...session, projectContext: { ...session.projectContext,
        expiresAt: new Date(now - 1).toISOString() } });
    } else if (change === "permission-epoch") {
      store.session.set({ ...session, permissionEpoch: "fixture-revoked-epoch",
        projectContext: { ...session.projectContext, permissions: [] } });
    } else if (change === "actor") {
      store.session.set({ ...session, user: { userId: "another-actor" } });
    } else if (change === "project-access") {
      store.session.set({ ...session, projectContext: { ...session.projectContext, projectAccessId: "another-project-access" } });
    }
    assert.equal(store.sourceOwnershipActive(token), change === "none");
    release.resolve();
    await pending;
    assert.deepEqual(requests, ["/api/document-jobs?document=document-a"], "withdrawal never schedules another actor's request");
    assert.deepEqual(store.documentJobs.get(), change === "none" ? [failed] : []);
    assert.deepEqual(store.schedules, change === "none" ? [60_000] : []);
    assert.deepEqual(store.writes, []);
    if (change === "permission-epoch") {
      await store.syncDocumentJobs();
      assert.equal(requests.length, 1, "the new denied principal cannot start a replacement read");
    }
  });
}
