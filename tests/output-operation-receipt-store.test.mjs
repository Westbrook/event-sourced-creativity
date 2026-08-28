import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sourceRoot = resolve(process.env.FORMA_OUTPUT_RECEIPT_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const projectRequire = createRequire(resolve(process.env.FORMA_OUTPUT_DEPENDENCY_ROOT || sourceRoot, "package.json"));
const ts = projectRequire("typescript");
const source = await readFile(resolve(sourceRoot, "src/state/store.ts"), "utf8");
const parsed = ts.createSourceFile("store.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const declaration = parsed.statements.find((node) => ts.isClassDeclaration(node) && node.name?.text === "FormaStore");
const method = declaration?.members.find((node) => ts.isMethodDeclaration(node) && node.name?.getText(parsed) === "reconcileOutputOperationReceipt");
assert.ok(method, "the real source must contain the receipt method under test");
const compiled = ts.transpileModule(`class ReceiptStore { #jobDetails = new Map(); ${method.getText(parsed)} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const ReceiptStore = new Function(`${compiled}; return ReceiptStore;`)();
const deferred = () => { let resolvePromise; const promise = new Promise((resolveValue) => { resolvePromise = resolveValue; }); return { promise, resolve: resolvePromise }; };

const job = () => ({ jobId: "job", documentId: "doc", kind: "render_document", status: "failed", result: { artifactKind: "slides" } });
const body = (status = "known", reconciled = true) => ({ job: job(), reconciliation: { documentId: "doc", grantId: "grant", slotId: "slot", jobId: "job", status, reconciled } });
const response = (value, status = 200) => ({ ok: status < 400, status, json: async () => value });
function fixture() {
  const request = deferred();
  const state = { scope: "scope-a", projectId: "project", userId: "actor" };
  const snapshot = { documentId: "doc", projectId: "project", scope: { actorUserId: "actor" }, sourceVerification: { status: "unavailable", reasonCodes: ["private_source_expired"] }, grants: [{ id: "grant", actorUserId: "actor", operations: [{ id: "slot", jobId: "job" }] }] };
  const resource = { state: "ready", snapshot, error: null };
  const effects = { requests: [], refreshes: [], jobs: [], notifications: 0 };
  const store = new ReceiptStore();
  Object.assign(store, {
    captureAuthorizationScope: () => ({ key: state.scope, shared: false }),
    authorizationScopeActive: (captured) => captured?.key === state.scope,
    projection: { get: () => ({ projectId: state.projectId }) },
    session: { get: () => ({ user: { userId: state.userId }, impersonation: null }) },
    guardedFetch: (...args) => { effects.requests.push(args); return request.promise; },
    outputRequirements: { resource: () => resource, invalidate: () => {}, ensure: async (...args) => { effects.refreshes.push(args); return resource; } },
    documentJobs: { get: () => effects.jobs, set: (jobs) => { effects.jobs = jobs; } },
    notify: () => { effects.notifications += 1; },
    syncDocumentJobs: () => { throw new Error("receipt inspection must never drive queued jobs"); },
    refreshSession: () => { throw new Error("receipt inspection must never accept terms or mutate an unrelated route"); },
  });
  return { store, state, resource, request, effects, start: () => store.reconcileOutputOperationReceipt("doc", "grant", "slot", "job") };
}

test("actual store method checks existing receipt and refreshes only Output data, even when source content expired", async () => {
  const f = fixture(); const pending = f.start();
  assert.equal(f.effects.requests.length, 1);
  assert.equal(f.effects.requests[0][0], "/api/document-jobs/job/reconcile-output");
  assert.deepEqual(f.effects.requests[0][1], { method: "POST" });
  f.request.resolve(response(body()));
  assert.deepEqual(await pending, { status: "known", reconciled: true, refreshed: true });
  assert.deepEqual(f.effects.refreshes, [["doc", { force: true }]]);
  assert.equal(f.effects.jobs[0].jobId, "job");
});

test("unknown provider acceptance remains uncertain; the wrapper never submits a replacement", async () => {
  const f = fixture(); const pending = f.start();
  f.request.resolve(response(body("uncertain", false)));
  assert.deepEqual(await pending, { status: "uncertain", reconciled: false, refreshed: true });
  assert.equal(f.effects.requests.length, 1);
});

test("wrong actor, job binding or Document never dispatches", async () => {
  for (const mutate of [(f) => { f.state.userId = "other"; }, (f) => { f.resource.snapshot.grants[0].operations[0].jobId = "other"; }, (f) => { f.resource.snapshot.documentId = "other"; }]) {
    const f = fixture(); mutate(f);
    assert.equal((await f.start()).status, "forbidden");
    assert.equal(f.effects.requests.length, 0);
  }
});

test("scope changes before response JSON prevent reading or publishing the old result", async () => {
  const f = fixture(); let reads = 0; const pending = f.start();
  f.state.scope = "scope-b";
  f.request.resolve({ ok: true, status: 200, json: async () => { reads++; return body(); } });
  assert.equal((await pending).status, "forbidden");
  assert.equal(reads, 0); assert.equal(f.effects.refreshes.length, 0); assert.equal(f.effects.jobs.length, 0);
});

test("personal project changes while JSON is pending are also scope changes", async () => {
  const f = fixture(); const json = deferred(); const startedJson = deferred(); const pending = f.start();
  f.request.resolve({ ok: true, status: 200, json: async () => { startedJson.resolve(); return json.promise; } });
  await startedJson.promise; f.state.projectId = "other-project"; json.resolve(body());
  assert.equal((await pending).status, "forbidden");
  assert.equal(f.effects.refreshes.length, 0); assert.equal(f.effects.jobs.length, 0);
});

test("scope changes during the final Output refresh cannot publish a recovered job", async () => {
  const f = fixture(); const refresh = deferred(); const startedRefresh = deferred();
  f.store.outputRequirements.ensure = async () => { startedRefresh.resolve(); return refresh.promise; };
  const pending = f.start(); f.request.resolve(response(body()));
  await startedRefresh.promise; f.state.scope = "scope-b"; refresh.resolve(f.resource);
  assert.equal((await pending).status, "forbidden"); assert.equal(f.effects.jobs.length, 0);
});

test("wrong job, Document, grant or slot in the acknowledgment fails closed", async () => {
  for (const mutate of [(value) => { value.job.jobId = "other"; }, (value) => { value.job.documentId = "other"; }, (value) => { value.reconciliation.grantId = "other"; }, (value) => { value.reconciliation.slotId = "other"; }, (value) => { value.reconciliation.jobId = "other"; }, (value) => { value.reconciliation.documentId = "other"; }]) {
    const f = fixture(); const value = body(); mutate(value); const pending = f.start(); f.request.resolve(response(value));
    assert.equal((await pending).status, "invalid"); assert.equal(f.effects.refreshes.length, 0); assert.equal(f.effects.jobs.length, 0);
  }
});

test("a committed check with unavailable refresh is not reported as a current delivery state", async () => {
  const f = fixture(); f.store.outputRequirements.ensure = async () => ({ state: "unavailable", snapshot: f.resource.snapshot, error: "offline" });
  const pending = f.start(); f.request.resolve(response(body()));
  assert.deepEqual(await pending, { status: "known", reconciled: true, refreshed: false });
  assert.equal(f.effects.jobs.length, 0);
});

test("a nonterminal response cannot enqueue work through the free receipt check", async () => {
  for (const status of ["queued", "running", "committing"]) {
    const f = fixture(); const value = body(); value.job.status = status;
    const pending = f.start(); f.request.resolve(response(value));
    assert.equal((await pending).status, "invalid");
    assert.equal(f.effects.jobs.length, 0); assert.equal(f.effects.refreshes.length, 0);
  }
});

test("loss of access during refresh discards the response even when the local session key is unchanged", async () => {
  const f = fixture(); f.store.outputRequirements.ensure = async () => ({ state: "unavailable", snapshot: null, accessLost: true, error: "forbidden" });
  const pending = f.start(); f.request.resolve(response(body()));
  assert.equal((await pending).status, "forbidden"); assert.equal(f.effects.jobs.length, 0);
});

test("free recovery method contains no queue-driving, legacy reconcile-provider, session POST or provider-fetch hook", () => {
  assert.doesNotMatch(method.getText(parsed), /syncDocumentJobs|#driveDocumentJobs|reconcile-provider|\/api\/session|\/api\/budgets|providerStatusUrl/u);
});
