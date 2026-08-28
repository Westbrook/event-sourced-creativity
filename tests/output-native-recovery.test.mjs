import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
import { createSceneStoreHost, sceneDeferred, untilScene } from "./helpers/scene-cost-store-host.mjs";

// Reuse the actual native execution fixture and full component renderer. Only
// test registration is omitted. These are deterministic HTTP/DOM ports, not
// browser, assistive-technology, provider, or content-quality certification.
const nativeUrl = new URL("./output-native-execution.test.mjs", import.meta.url);
const nativeSource = fs.readFileSync(nativeUrl, "utf8");
const nativeTree = ts.createSourceFile(nativeUrl.pathname, nativeSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
let nativeModule = nativeSource.slice(0, nativeSource.indexOf("\ntest("))
  + "\n" + nativeTree.statements.filter(node => ts.isFunctionDeclaration(node) && ["png", "saveImages"].includes(node.name?.text)).map(node => node.getText(nativeTree)).join("\n");
function absoluteImports(source, url) {
  return source.replace(/(from\s+|import\s*\()(["'])([^"']+)\2/gu, (_all, prefix, _quote, specifier) =>
    prefix + JSON.stringify(specifier.startsWith(".") ? new URL(specifier, url).href : specifier.startsWith("node:") ? specifier : import.meta.resolve(specifier)));
}
nativeModule = absoluteImports(nativeModule, nativeUrl)
  + "\nexport {fixture,saveDeck,saveImages,authorize,png,outputFor,handleSession,handleDocumentJobs,handleEvents,handleOutputRequirements,outputDocumentExecutionBridge,handleWorkspaces,POLICY_VERSION};";
const native = await import("data:text/javascript;base64," + Buffer.from(nativeModule).toString("base64"));
const rendererUrl = new URL("./presentation-guidance-accessibility.test.mjs", import.meta.url);
const rendererSource = fs.readFileSync(rendererUrl, "utf8");
const rendererTree = ts.createSourceFile(rendererUrl.pathname, rendererSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
let rendererModule = rendererTree.statements.filter(node => ts.isImportDeclaration(node) || ts.isVariableStatement(node) || ts.isClassDeclaration(node) || ts.isFunctionDeclaration(node)
  || ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(rendererTree) === "registerHooks").map(node => node.getFullText(rendererTree)).join("\n");
rendererModule = absoluteImports(rendererModule, rendererUrl)
  .replaceAll('import.meta.resolve("vite")', JSON.stringify(import.meta.resolve("vite"))).replaceAll("import.meta.url", JSON.stringify(rendererUrl.href))
  .replace("await import(specifier)", "await import(specifier===\"lit/directives/live.js\"?" + JSON.stringify(import.meta.resolve("lit/directives/live.js")) + ":specifier)")
  + "\nexport {fixture,loadActual};";
const full = await import("data:text/javascript;base64," + Buffer.from(rendererModule).toString("base64"));
const { FormaOutputRequirements } = await full.loadActual("src/components/forma-output-requirements.ts");
const { FormaOutputRequirementCard } = await full.loadActual("src/components/forma-output-requirement-card.ts");
const { outputCompletedNativeChoices, outputMissingNativeResults, outputNativeResultContext } = await import("../src/components/output-controller-recovery.ts");
const { FORMA_OUTPUT_DELIVERY_MESSAGES } = await import("../src/components/design-system/locales/output-delivery-messages.ts");
const BASE = "/api/output-requirements";

async function recoveryFixture(t, { shared = false, medium = "slides", locale = "en", sharedEditor = false } = {}) {
  let providerCalls = 0;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    providerCalls += 1;
    if (String(url).endsWith("/moderations")) return Response.json({ id: "recovery-safety", results: [{ flagged: false, categories: {} }] });
    if (String(url).endsWith("/images/generations")) {
      const [width, height] = JSON.parse(init.body).size.split("x").map(Number);
      return Response.json({ data: [{ b64_json: native.png(width, height).toString("base64") }], usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200, input_tokens_details: { text_tokens: 120, image_tokens: 0 } } }, { headers: { "x-request-id": "recovery-image" } });
    }
    assert.equal(String(url), "https://api.openai.com/v1/responses");
    const draft = medium === "slides" ? native.outputFor() : { title: "Sheltered orchard", rationale: "Protect mature roots", scene: "Pear trees beside a sheltered orchard path", palette: ["green", "ochre"], next_moves: ["Review tree spacing"] };
    return Response.json({ id: "recovery-original-" + providerCalls, model: "gpt-5.6-terra", output_text: JSON.stringify(draft), usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 } });
  });
  const worker = await native.fixture(undefined, { shared });
  if (sharedEditor) {
    assert.equal(shared, true);
    const actor = "native-original-editor", email = "native-original-editor@local.forma", now = new Date().toISOString();
    const owner = worker.sqlite.prepare("SELECT owner_user_id FROM organizations WHERE organization_id=?").get(worker.organizationId).owner_user_id;
    // Actual membership schema, as in output-published-package-fixture; the job
    // and its Output grant below are still created only by production handlers.
    worker.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,'creator',?,?,?,?)").run(actor,email,"Original editor",native.POLICY_VERSION,now,now,now);
    worker.sqlite.prepare("INSERT INTO organization_memberships(membership_id,organization_id,user_id,role,status,invited_by_user_id,accepted_at,created_at,updated_at) VALUES(?,?,?,'member','active',?,?,?,?)").run("native-original-org",worker.organizationId,actor,owner,now,now,now);
    worker.sqlite.prepare("INSERT INTO project_memberships(membership_id,organization_id,project_access_id,project_id,user_id,role,status,granted_by_user_id,created_at,updated_at) VALUES(?,?,?,?,?,'editor','active',?,?,?)").run("native-original-project",worker.organizationId,worker.projectAccessId,"project-atmosphere",actor,owner,now,now);
    const identity = { "oai-authenticated-user-id": actor, "oai-authenticated-user-email": email };
    const parts = [worker.organizationId,"projects",worker.projectAccessId,"context"];
    const selected = await native.handleWorkspaces(new Request("http://localhost/api/workspaces/" + parts.join("/"), { method: "POST", headers: identity }), worker.env, parts);
    assert.equal(selected.status, 200, await selected.clone().text());
    Object.assign(worker.headers, identity, { cookie: selected.headers.get("set-cookie").split(";")[0] });
    worker.contextId = decodeURIComponent(worker.headers.cookie.split("=").slice(1).join("="));
    const events = await native.handleEvents(new Request("http://localhost/api/events", { headers: worker.headers }), worker.env);
    assert.equal(events.status, 200);
  }
  const plan = medium === "slides" ? await native.saveDeck(worker) : await native.saveImages(worker);
  const targetId = plan.targetId ?? plan.targetIds[0];
  const authorized = await native.authorize(worker, plan.planId, [targetId]);
  await worker.ok(await worker.startAndDrive({ action: "run", grantId: authorized.grantId }));
  const original = worker.sqlite.prepare("SELECT * FROM document_jobs").get();
  assert.equal(original.status, "completed", JSON.stringify(original));
  const operation = worker.sqlite.prepare("SELECT * FROM output_operation_slots WHERE job_id=?").get(original.job_id);
  assert.equal(operation.status, "succeeded");
  const paid = providerCalls;
  const applicationRequest = async (url, init = {}) => {
    const parsed = new URL(url, "http://localhost"), headers = new Headers(worker.headers);
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    const request = new Request(parsed, { ...init, headers });
    if (parsed.pathname === "/api/session") return native.handleSession(request, worker.env);
    if (parsed.pathname === "/api/events") return native.handleEvents(request, worker.env);
    if (parsed.pathname.startsWith("/api/document-jobs")) return native.handleDocumentJobs(request, worker.env, parsed.pathname.slice("/api/document-jobs".length).replace(/^\//u, ""));
    assert.ok(parsed.pathname.startsWith(BASE), "Only existing application routes");
    return native.handleOutputRequirements(request, worker.env, parsed.pathname, { waitUntil() { assert.fail("No detached work"); } }, native.outputDocumentExecutionBridge);
  };
  const adapter = { ...worker, request: applicationRequest, requestId: original.job_id, payload: { workflowSources: [] }, close: () => worker.sqlite.close() };
  const host = await createSceneStoreHost({ shared, workerFixture: adapter });
  t.after(() => host.close());
  await host.store.outputRequirements.ensure(worker.documentId, { force: true });
  const fresh = () => host.store.outputRequirements.resource(worker.documentId).snapshot;
  const current = fresh();
  assert.equal(current.confirmedPlan.revisionId, plan.planId);
  const exact = await applicationRequest("/api/document-jobs/" + original.job_id + "?inspection=1");
  assert.equal(exact.status, 200);
  const job = (await exact.json()).job;
  assert.equal(job.jobId, original.job_id);
  assert.equal(job.status, "completed");
  host.store.documentJobs.set([]); // Omit only the original from the page, never alter its canonical record.
  const ui = full.fixture(t, { locale, facts: [] });
  ui.host.disconnectedCallback();
  ui.store = host.store;
  ui.renderer.registry = { "forma-output-requirement-card": FormaOutputRequirementCard };
  ui.host = new FormaOutputRequirements();
  ui.host.store = host.store;
  ui.host.documentId = worker.documentId;
  ui.host.documentName = "Community stewardship";
  ui.host.surface = "deliver";
  ui.host.isConnected = true;
  ui.host.connectedCallback();
  ui.draw();
  const inspect = () => ui.renderer.ownNodes(ui.host, "button").filter(node => node.attributes["data-output-native-inspect"] === original.job_id);
  const form = () => ui.renderer.ownNodes(ui.host, "form").find(node => node.attributes.class === "output-native-bind-form");
  const clickInspect = async () => {
    ui.draw();
    const button = inspect()[0]; assert.ok(button, "Actual original-result inspection button");
    assert.equal(Object.hasOwn(button.attributes, "disabled"), false);
    const pending = button.handlers.click.call(ui.host, { currentTarget: button, preventDefault() {} });
    ui.draw();
    return pending;
  };
  const bind = async () => {
    ui.draw();
    const node = form(); assert.ok(node, "Actual completed-result match form");
    const originalFormData = globalThis.FormData;
    try {
      globalThis.FormData = class { get(key) { return key === "nativeJobId" ? job.jobId : null; } };
      await node.handlers.submit.call(ui.host, { currentTarget: node, preventDefault() {} });
    } finally { globalThis.FormData = originalFormData; }
    ui.draw();
  };
  const business = () => ({
    jobs: worker.sqlite.prepare("SELECT * FROM document_jobs ORDER BY job_id").all(),
    slots: worker.sqlite.prepare("SELECT * FROM output_operation_slots ORDER BY slot_id").all(),
    calls: worker.sqlite.prepare("SELECT * FROM output_provider_calls ORDER BY scope_key,slot_id,call_key").all(),
    tokens: worker.sqlite.prepare("SELECT * FROM budget_reservations ORDER BY reservation_id").all(),
    costs: worker.sqlite.prepare("SELECT * FROM cost_budget_reservations ORDER BY reservation_id").all(),
    tokenCounters: worker.sqlite.prepare("SELECT * FROM budget_counters ORDER BY scope,scope_id,period").all(),
    costCounters: worker.sqlite.prepare("SELECT * FROM cost_budget_counters ORDER BY scope,scope_id,period").all(),
  });
  const noNewWork = (expectedFeed = []) => {
    assert.equal(providerCalls, paid, "No additional provider calls");
    assert.equal(host.requests.some(request => /\/(?:run|retry|recover|ack|reconcile-output|reconcile-provider)(?:\?|$)/u.test(request.url)), false);
    assert.deepEqual(host.store.documentJobs.get(), expectedFeed, "Exact inspection never fabricates or overwrites a recent-feed row");
  };
  return { worker, host, ui, fresh, targetId, plan, job, operation, inspect, form, clickInspect, bind, applicationRequest, business, noNewWork, get providerCalls() { return providerCalls; }, paid };
}

for (const shared of [false, true]) for (const medium of ["slides", "image"]) test("Output native omission recovery: actual Worker + Store + full controller " + medium + "/" + (shared ? "shared" : "personal"), async t => {
  const f = await recoveryFixture(t, { shared, medium });
  const before = f.business(), target = f.fresh().confirmedPlan.plan.targets.find(target => target.id === f.targetId);
  assert.equal(outputCompletedNativeChoices(f.fresh(), [], target).length, 0);
  assert.equal(f.form(), undefined, "The original is genuinely missing from the recent list");
  await f.clickInspect(); await f.ui.flush();
  assert.ok(f.form(), "Free exact read makes the original an explicit Match candidate");
  assert.deepEqual(f.business(), before, "Inspection changes no canonical job, provider, or ledger state");
  assert.equal(f.fresh().results.length, 0, "Inspection must not match or approve automatically");
  assert.equal(f.host.requests.filter(request => request.url === "/api/document-jobs/" + f.job.jobId + "?inspection=1").length, 1);
  await f.bind(); await f.ui.flush();
  const result = f.fresh().results.find(result => result.targetId === f.targetId);
  assert.ok(result, "Existing Match/check command remains reachable after omission");
  assert.equal(result.checksStatus, "passed");
  assert.equal(result.review, "pending", "Human review remains a separate explicit action");
  assert.equal(f.host.requests.filter(request => request.body?.action === "bind").length, 1);
  assert.equal(f.host.requests.some(request => ["authorize", "run", "preflight", "review", "export"].includes(request.body?.action)), false);
  f.noNewWork();
});

for (const locale of ["en", "fr", "ar", "ja"]) test("Output native omission recovery: original action and separate Match are localized " + locale, async t => {
  const f = await recoveryFixture(t, { locale });
  const messages = FORMA_OUTPUT_DELIVERY_MESSAGES[locale];
  for (const key of ["nativeHistoryOmitted", "inspectNativeAttempt", "nativeInspecting", "nativeInspected", "nativeInspectionUnavailable", "nativeInspectionReadOnly"]) {
    assert.ok(messages["output.delivery." + key], key);
    assert.doesNotMatch(messages["output.delivery." + key], /output\.delivery\./u);
  }
  assert.ok(f.ui.visible().includes(messages["output.delivery.nativeHistoryOmitted"]));
  await f.clickInspect(); await f.ui.flush();
  assert.ok(f.ui.visible().includes(messages["output.delivery.nativeInspected"]));
  assert.ok(f.ui.visible().includes(messages["output.delivery.checkNativeResult"]));
  assert.equal(f.fresh().results.length, 0);
  f.noNewWork();
});

for (const change of ["failed", "partial", "running", "canceled", "wrong-document", "wrong-kind", "wrong-media"]) test("Output native omission recovery: present contradictory " + change + " is not an omitted original", async t => {
  const f = await recoveryFixture(t);
  const bad = { ...f.job };
  if (["failed", "partial", "running", "canceled"].includes(change)) bad.status = change;
  if (change === "wrong-document") bad.documentId = "another-document";
  if (change === "wrong-kind") bad.kind = "chat";
  if (change === "wrong-media") bad.result = { ...bad.result, artifactKind: "scene" };
  f.host.store.documentJobs.set([bad]); f.ui.draw();
  const target = f.fresh().confirmedPlan.plan.targets.find(target => target.id === f.targetId);
  assert.deepEqual(outputMissingNativeResults(f.fresh(), [bad], target), []);
  assert.deepEqual(outputCompletedNativeChoices(f.fresh(), [bad], target, f.job), [], "Fresh inspection cannot override a contradictory present identity");
  assert.equal(f.inspect().length, 0); assert.equal(f.form(), undefined);
  assert.equal(f.host.requests.filter(request => request.url.includes("?inspection=1")).length, 0);
  f.noNewWork([bad]);
});

for (const shared of [false, true]) for (const change of ["route", "document", "authority", "source", "plan", "contract", "target", "disconnect"]) test("Output native original read ignores late " + change + "/" + shared, async t => {
  const f = await recoveryFixture(t, { shared }), gate = sceneDeferred();
  let reads = 0;
  f.host.intercept = request => request.url.endsWith("?inspection=1") ? (reads += 1, gate.promise) : undefined;
  const pending = f.clickInspect(); await untilScene(() => reads === 1);
  if (change === "route") f.host.store.route.set("/activity");
  if (change === "document") f.ui.host.documentId = "other-document";
  if (change === "authority") f.host.setSession({ permissionEpoch: "a-new-current-epoch" });
  if (change === "source") f.fresh().sourceRevision = "a-new-source";
  if (change === "plan") f.fresh().confirmedPlan.revisionId = "a-new-plan";
  if (change === "contract") f.fresh().confirmedPlan.targetContractDigests[f.targetId] = "a-new-target-contract";
  if (change === "target") f.fresh().confirmedPlan.plan.targets = [];
  if (change === "disconnect") { f.ui.host.isConnected = false; f.ui.host.disconnectedCallback(); }
  else f.ui.draw();
  gate.resolve(Response.json({ job: f.job })); await pending;
  if (change === "disconnect") { f.ui.host.isConnected = true; f.ui.host.connectedCallback(); }
  f.ui.draw();
  assert.equal(f.form(), undefined, "A stale response cannot restore Match controls");
  assert.equal(f.host.requests.some(request => request.body?.action === "bind"), false);
  f.noNewWork();
});

for (const shared of [false, true]) for (const oldStatus of [200, 403]) test("Output native late old " + oldStatus + " cannot replace a newer opening/" + shared, async t => {
  const f = await recoveryFixture(t, { shared }), older = sceneDeferred(); let count = 0, oldBodyReads = 0;
  f.host.intercept = request => {
    if (!request.url.endsWith("?inspection=1")) return;
    count += 1;
    if (count === 1) return older.promise;
    return Response.json({ job: f.job });
  };
  const a = f.clickInspect(); await untilScene(() => count === 1);
  const route = f.host.store.route.get(); f.host.store.route.set("/activity"); f.ui.draw(); f.host.store.route.set(route); f.ui.draw();
  await f.clickInspect(); await f.ui.flush(); assert.ok(f.form(), "B has its own fresh proof");
  older.resolve({ status: oldStatus, ok: oldStatus === 200, json: async () => { oldBodyReads += 1; return { job: f.job }; } });
  await a; await f.ui.flush();
  assert.equal(oldBodyReads, 0, "A is rejected before its body is read");
  assert.ok(f.form()); assert.equal(f.host.store.outputRequirements.resource(f.worker.documentId).state, "ready");
  f.noNewWork();
});

for (const shared of [false, true]) test("Output native old body cannot return after a newer exact denial/" + shared, async t => {
  const f = await recoveryFixture(t, { shared }), body = sceneDeferred(); let count = 0, bodyEntered = false;
  f.host.intercept = request => {
    if (!request.url.endsWith("?inspection=1")) return;
    count += 1;
    if (count === 1) return { status: 200, ok: true, json: () => { bodyEntered = true; return body.promise; } };
    return { status: 403, ok: false, json: () => assert.fail("Denial headers must retire before reading the body") };
  };
  const a = f.clickInspect(); await untilScene(() => bodyEntered);
  const route = f.host.store.route.get(); f.host.store.route.set("/activity"); f.ui.draw(); f.host.store.route.set(route); f.ui.draw();
  await f.clickInspect(); f.ui.draw();
  assert.equal(f.host.store.outputRequirements.resource(f.worker.documentId).snapshot, null);
  body.resolve({ job: f.job }); await a; f.ui.draw();
  assert.equal(f.form(), undefined); assert.equal(f.host.store.outputRequirements.resource(f.worker.documentId).snapshot, null);
  f.noNewWork();
});

for (const shared of [false, true]) for (const status of [401, 403, 404, 410]) test("Output native warm inspection retires at denial headers " + status + "/" + shared, async t => {
  const f = await recoveryFixture(t, { shared }); await f.clickInspect(); await f.ui.flush(); assert.ok(f.form());
  let bodyReads = 0;
  f.host.intercept = request => request.url.endsWith("?inspection=1") ? { status, ok: false, json: () => { bodyReads += 1; return new Promise(() => {}); } } : undefined;
  await f.clickInspect(); f.ui.draw();
  const resource = f.host.store.outputRequirements.resource(f.worker.documentId);
  assert.equal(bodyReads, 0); assert.equal(resource.snapshot, null); assert.equal(resource.privateUnavailable, true);
  assert.equal(resource.accessLost, status === 401 || status === 403, "Missing job 404 retires evidence; it is not project membership revocation");
  assert.equal(f.form(), undefined);
  assert.equal(f.worker.sqlite.prepare("SELECT job_id FROM document_jobs").get().job_id, f.job.jobId, "Original ID stays canonical");
  f.noNewWork();
});

for (const shared of [false, true]) test("Output native real expired-job 404 defeats a warm cache and recovers only through explicit reads/" + shared, async t => {
  const f = await recoveryFixture(t, { shared }); await f.clickInspect(); await f.ui.flush(); assert.ok(f.form());
  // Warm the old generic job cache as an additional adversarial input, without
  // using it as the new inspection's source or inserting a feed row.
  const detail = await f.host.store.loadDocumentJobDetail(f.job.jobId); assert.equal(detail.jobId, f.job.jobId);
  const expiry = f.worker.sqlite.prepare("SELECT expires_at FROM document_jobs WHERE job_id=?").get(f.job.jobId).expires_at;
  f.worker.sqlite.prepare("UPDATE document_jobs SET expires_at='2000-01-01T00:00:00.000Z' WHERE job_id=?").run(f.job.jobId);
  const exact = await f.applicationRequest("/api/document-jobs/" + f.job.jobId + "?inspection=1"); assert.equal(exact.status, 404);
  await f.clickInspect(); f.ui.draw();
  const denied = f.host.store.outputRequirements.resource(f.worker.documentId);
  assert.equal(denied.snapshot, null); assert.equal(denied.privateUnavailable, true); assert.equal(denied.accessLost, false); assert.equal(f.form(), undefined);
  f.worker.sqlite.prepare("UPDATE document_jobs SET expires_at=? WHERE job_id=?").run(expiry, f.job.jobId);
  await f.host.store.outputRequirements.ensure(f.worker.documentId, { force: true }); f.ui.draw();
  assert.equal(f.form(), undefined, "Refreshing Output does not silently repeat the exact inspection");
  await f.clickInspect(); await f.ui.flush(); assert.ok(f.form());
  f.noNewWork();
});

for (const fault of ["wrong-job", "wrong-document", "wrong-surface", "wrong-kind", "wrong-media", "partial", "bad-json", "transport", "server-error"]) test("Output native exact read never turns " + fault + " into a completed Match candidate", async t => {
  const f = await recoveryFixture(t), originalId = f.job.jobId;
  f.host.intercept = request => {
    if (!request.url.endsWith("?inspection=1")) return;
    if (fault === "transport") throw new Error("connection lost");
    if (fault === "bad-json") return new Response("not json", { status: 200 });
    if (fault === "server-error") return new Response("not json", { status: 500 });
    const job = { ...f.job };
    if (fault === "wrong-job") job.jobId = "another-job";
    if (fault === "wrong-document") job.documentId = "another-document";
    if (fault === "wrong-surface") job.sourceSurface = "document";
    if (fault === "wrong-kind") job.kind = "chat";
    if (fault === "wrong-media") job.result = { ...job.result, artifactKind: "scene" };
    if (fault === "partial") job.status = "partial";
    return Response.json({ job });
  };
  await f.clickInspect(); await f.ui.flush();
  assert.equal(f.form(), undefined); assert.ok(f.fresh(), "Nonauthoritative failure does not claim project access was revoked");
  assert.ok(f.ui.visible().includes(FORMA_OUTPUT_DELIVERY_MESSAGES.en["output.delivery.nativeInspectionUnavailable"]));
  f.host.intercept = null;
  await f.clickInspect(); await f.ui.flush(); assert.ok(f.form());
  assert.ok(f.host.requests.filter(request => request.url.endsWith("?inspection=1")).every(request => request.url.includes(originalId)));
  f.noNewWork();
});

test("Output native exact read port rejects wrong identity and withdrawn read authority before HTTP", async t => {
  const f = await recoveryFixture(t), before = f.host.requests.length;
  for (const [documentId, jobId, current] of [[f.worker.documentId, "not-an-operation", () => true], ["other-document", f.job.jobId, () => true], [f.worker.documentId, f.job.jobId, () => false]]) {
    const result = await f.host.store.inspectOutputNativeJob(documentId, jobId, current); assert.notEqual(result.status, "found");
  }
  f.host.setSession({ capabilities: [] });
  const denied = await f.host.store.inspectOutputNativeJob(f.worker.documentId, f.job.jobId, () => true);
  assert.notEqual(denied.status, "found"); assert.equal(f.host.requests.length, before);
  f.noNewWork();
});

test("Output native inspection is read-only when current author and paid controls are unavailable", async t => {
  const f = await recoveryFixture(t);
  f.host.setSession({ capabilities: ["project.read"] });
  f.fresh().permissions = { ...f.fresh().permissions, canAuthor: false, canRequest: false, canReview: false };
  f.worker.env.OPENAI_API_KEY = ""; f.ui.draw();
  await f.clickInspect(); await f.ui.flush();
  assert.ok(f.ui.visible().includes(FORMA_OUTPUT_DELIVERY_MESSAGES.en["output.delivery.nativeInspected"]));
  assert.equal(f.form(), undefined, "A read-only inspector cannot match or approve");
  assert.equal(f.host.requests.some(request => request.init.method === "POST"), false);
  f.noNewWork();
});

test("Output native old rendered Match cannot retarget a changed exact contract", async t => {
  const f = await recoveryFixture(t); await f.clickInspect(); await f.ui.flush();
  const node = f.form(); assert.ok(node);
  f.fresh().confirmedPlan.targetContractDigests[f.targetId] = "replacement-contract"; f.ui.draw();
  const originalFormData = globalThis.FormData;
  try {
    globalThis.FormData = class { get(key) { return key === "nativeJobId" ? f.job.jobId : null; } };
    await node.handlers.submit.call(f.ui.host, { currentTarget: node, preventDefault() {} });
  } finally { globalThis.FormData = originalFormData; }
  assert.equal(f.host.requests.some(request => request.body?.action === "bind"), false);
  assert.equal(f.fresh().results.length, 0); f.noNewWork();
});

for (const change of ["route", "target"]) for (const status of [403, 404]) test("Output native denial retires the original resource after presentation-only " + change + "/" + status, async t => {
  const f = await recoveryFixture(t), gate = sceneDeferred(); let requested = false, bodyReads = 0;
  f.host.intercept = request => request.url.endsWith("?inspection=1") ? (requested = true, gate.promise) : undefined;
  const pending = f.clickInspect(); await untilScene(() => requested);
  if (change === "route") f.host.store.route.set("/activity");
  else f.fresh().confirmedPlan.targetContractDigests[f.targetId] = "changed-target-without-a-new-read";
  f.ui.draw();
  gate.resolve({ status, ok: false, json: () => { bodyReads += 1; return new Promise(() => {}); } });
  await pending; f.ui.draw();
  const resource = f.host.store.outputRequirements.resource(f.worker.documentId);
  assert.equal(resource.snapshot, null, "An owned authoritative denial is not neutralized by closing or changing the target");
  assert.equal(resource.privateUnavailable, true); assert.equal(resource.accessLost, status === 403); assert.equal(bodyReads, 0);
  assert.equal(f.form(), undefined); f.noNewWork();
});
for (const status of [403, 404]) test("Output native old denial cannot retire a newer scoped Output read/" + status, async t => {
  const f = await recoveryFixture(t), gate = sceneDeferred(); let requested = false;
  f.host.intercept = request => request.url.endsWith("?inspection=1") ? (requested = true, gate.promise) : undefined;
  const pending = f.clickInspect(); await untilScene(() => requested);
  const refreshed = await f.host.store.outputRequirements.ensure(f.worker.documentId, { force: true });
  assert.equal(refreshed.state, "ready"); f.ui.draw();
  gate.resolve({ status, ok: false, json: () => assert.fail("Older denied response body remains unread") });
  await pending; f.ui.draw();
  assert.equal(f.host.store.outputRequirements.resource(f.worker.documentId), refreshed);
  assert.equal(refreshed.privateUnavailable, undefined); assert.equal(f.form(), undefined); f.noNewWork();
});

for (const shared of [false, true]) test("Output native Store direct old body returns no private job after a newer denial/" + shared, async t => {
  const f = await recoveryFixture(t, { shared }), body = sceneDeferred(); let entered = false, reads = 0;
  f.host.intercept = request => {
    if (!request.url.endsWith("?inspection=1")) return;
    if (++reads === 1) return { status: 200, ok: true, json: () => { entered = true; return body.promise; } };
    return { status: 403, ok: false, json: () => assert.fail("Exact denial body is not read") };
  };
  const a = f.host.store.inspectOutputNativeJob(f.worker.documentId, f.job.jobId, () => true);
  await untilScene(() => entered);
  const b = await f.host.store.inspectOutputNativeJob(f.worker.documentId, f.job.jobId, () => true);
  assert.deepEqual(b, { status: "unavailable", job: null });
  body.resolve({ job: f.job });
  assert.deepEqual(await a, { status: "superseded", job: null }, "Store return itself is fenced, independent of a controller callback");
  const resource = f.host.store.outputRequirements.resource(f.worker.documentId);
  assert.equal(resource.snapshot, null); assert.equal(resource.privateUnavailable, true); assert.equal(resource.accessLost, true);
  f.noNewWork();
});
for (const shared of [false, true]) test("Output native Store direct newer exact proof owns an older denial/" + shared, async t => {
  const f = await recoveryFixture(t, { shared }), headers = sceneDeferred(); let reads = 0;
  f.host.intercept = request => {
    if (!request.url.endsWith("?inspection=1")) return;
    if (++reads === 1) return headers.promise;
    return undefined; // The newer exact inspection uses the actual Worker.
  };
  const a = f.host.store.inspectOutputNativeJob(f.worker.documentId, f.job.jobId, () => true);
  await untilScene(() => reads === 1);
  const b = await f.host.store.inspectOutputNativeJob(f.worker.documentId, f.job.jobId, () => true);
  assert.equal(b.status, "found"); assert.equal(b.job.jobId, f.job.jobId); assert.equal(b.current(), true);
  const owned = f.host.store.outputRequirements.resource(f.worker.documentId);
  headers.resolve({ status: 403, ok: false, json: () => assert.fail("Old denial body is not read") });
  assert.deepEqual(await a, { status: "superseded", job: null });
  assert.equal(b.current(), true); assert.equal(f.host.store.outputRequirements.resource(f.worker.documentId), owned);
  assert.equal(owned.state, "ready"); assert.equal(owned.privateUnavailable, undefined); f.noNewWork();
});
for (const shared of [false, true]) test("Output native present valid original retains the existing Match without an extra lookup/" + shared, async t => {
  const f = await recoveryFixture(t, { shared }); f.host.store.documentJobs.set([f.job]); f.ui.draw();
  assert.equal(f.inspect().length, 0); assert.ok(f.form());
  await f.bind(); await f.ui.flush();
  assert.equal(f.host.requests.filter(request => request.url.endsWith("?inspection=1")).length, 0);
  const result = f.fresh().results.find(result => result.targetId === f.targetId);
  assert.equal(result.checksStatus, "passed"); assert.equal(result.review, "pending"); f.noNewWork([f.job]);
});
test("Output native actual revoked shared context retires old exact evidence without changing original work", async t => {
  const f = await recoveryFixture(t, { shared: true }); await f.clickInspect(); await f.ui.flush(); assert.ok(f.form());
  const before = f.business();
  f.worker.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE context_id=?").run(new Date().toISOString(), f.worker.contextId);
  const exact = await f.applicationRequest("/api/document-jobs/" + f.job.jobId + "?inspection=1");
  assert.equal(exact.status, 403);
  await f.clickInspect(); f.ui.draw();
  const resource = f.host.store.outputRequirements.resource(f.worker.documentId);
  assert.equal(resource.snapshot, null); assert.equal(resource.accessLost, true); assert.equal(resource.privateUnavailable, true);
  assert.equal(f.form(), undefined); assert.deepEqual(f.business(), before); f.noNewWork();
});

test("Output native exact-target context ignores unrelated grants without truncating relevant operations", async t => {
  const f = await recoveryFixture(t), snapshot = f.fresh(), target = snapshot.confirmedPlan.plan.targets.find(entry => entry.id === f.targetId);
  const expected = outputNativeResultContext(snapshot, target), many = structuredClone(snapshot), template = many.grants[0];
  for (let index = 0; index < 256; index++) {
    const otherId = "other-target-" + index;
    many.confirmedPlan.plan.targets.push({ ...target, id: otherId });
    many.grants.push({ ...structuredClone(template), id: "unrelated-grant-" + index,
      operations: template.operations.map(operation => ({ ...operation, id: "unrelated-operation-" + index, targetId: otherId })) });
  }
  assert.equal(outputNativeResultContext(many, target), expected, "Other targets add no empty-grant context or invalidation");
  const operations = Array.from({ length: 64 }, (_, index) => ({ ...template.operations[0], id: "relevant-operation-" + index, jobId: "relevant-job-" + index }));
  many.grants.push({ ...structuredClone(template), id: "relevant-grant", operations });
  const current = outputNativeResultContext(many, target);
  assert.notEqual(current, expected);
  assert.deepEqual(JSON.parse(current).at(-1).find(row => row[0] === "relevant-grant")[2], operations, "Every complete relevant operation is retained, with no cap");
  operations.at(-1).pendingCalls += 1;
  assert.notEqual(outputNativeResultContext(many, target), current, "Even the last relevant operation still invalidates");
  f.noNewWork();
});

for (const locale of ["en", "fr", "ar", "ja"]) test("Output native actual shared editor downgrade keeps Output reading without offering a forbidden native lookup/" + locale, async t => {
  const f = await recoveryFixture(t, { shared: true, sharedEditor: true, locale });
  const priorSession = f.host.store.session.get(); assert.equal(priorSession.projectContext.role, "editor");
  const oldButton = f.inspect()[0]; assert.ok(oldButton);
  await f.clickInspect(); await f.ui.flush(); assert.ok(f.form());
  const before = f.business();
  f.worker.sqlite.prepare("UPDATE project_memberships SET role='viewer',updated_at=? WHERE membership_id='native-original-project'").run(new Date().toISOString());
  const response = await f.applicationRequest("/api/session"); assert.equal(response.status, 200);
  const session = await response.json(); assert.equal(session.projectContext.role, "viewer");
  assert.ok(session.projectContext.permissions.includes("project.read"));
  assert.equal(session.projectContext.permissions.includes("project.output.request"), false);
  const exact = await f.applicationRequest("/api/document-jobs/" + f.job.jobId + "?inspection=1");
  assert.equal(exact.status, 404, "Existing read-only-planning route does not grant native job reading");
  f.host.store.session.set(session);
  const refreshed = await f.host.store.outputRequirements.ensure(f.worker.documentId, { force: true });
  assert.equal(refreshed.state, "ready"); assert.equal(refreshed.snapshot.scope.actorUserId, session.user.userId);
  assert.equal(refreshed.snapshot.permissions.canAuthor, false);
  f.ui.draw(); const button = f.inspect()[0]; assert.ok(button, "Original ID remains reachable as a disabled control");
  assert.equal(Object.hasOwn(button.attributes, "disabled"), true);
  assert.ok(f.ui.visible().includes(FORMA_OUTPUT_DELIVERY_MESSAGES[locale]["output.delivery.nativeInspectionReadOnly"]));
  assert.equal(f.form(), undefined);
  const requests = f.host.requests.length;
  await oldButton.handlers.click.call(f.ui.host, { currentTarget: oldButton, preventDefault() {} });
  const blocked = await f.host.store.inspectOutputNativeJob(f.worker.documentId, f.job.jobId, () => true);
  assert.notEqual(blocked.status, "found"); assert.equal(f.host.requests.length, requests, "Known native-read policy blocks before HTTP");
  assert.equal(f.host.store.outputRequirements.resource(f.worker.documentId).snapshot, refreshed.snapshot);
  assert.equal(refreshed.accessLost, undefined); assert.equal(refreshed.privateUnavailable, undefined);
  assert.deepEqual(f.business(), before); f.noNewWork();
  f.worker.sqlite.prepare("UPDATE project_memberships SET role='editor',updated_at=? WHERE membership_id='native-original-project'").run(new Date().toISOString());
  const restoredResponse = await f.applicationRequest("/api/session"); assert.equal(restoredResponse.status, 200);
  f.host.store.session.set(await restoredResponse.json());
  const restored = await f.host.store.outputRequirements.ensure(f.worker.documentId, { force: true });
  assert.equal(restored.state, "ready"); f.ui.draw(); assert.equal(f.form(), undefined, "Restored permission is not a new exact inspection");
  assert.equal(Object.hasOwn(f.inspect()[0].attributes, "disabled"), false);
  await f.clickInspect(); await f.ui.flush(); assert.ok(f.form());
  assert.equal(f.fresh().results.length, 0); assert.deepEqual(f.business(), before); f.noNewWork();
});
