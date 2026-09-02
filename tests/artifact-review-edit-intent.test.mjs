// Complete production viewer and Store; only existing native-control and HTTP ports.
// Shared review/edit receipts below use the actual Worker with private in-memory SQLite.
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
const root=fileURLToPath(new URL("../",import.meta.url));
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const url=relative=>pathToFileURL(path.join(root,relative));
async function declarations(relative, marker, extraExports) {
  const sourceURL = url(relative), raw = fs.readFileSync(sourceURL, "utf8");
  const boundary = raw.indexOf(marker);
  assert.ok(boundary > 0, "existing declaration boundary " + relative);
  const source = raw.slice(0, boundary) + "\nexport { " + extraExports + " };\n";
  const tree = ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(tree.parseDiagnostics.length, 0);
  sourceURL.search = "?phase5-review-intent-repair-r2";
  const hook = registerHooks({ load(request, context, next) {
    return request === sourceURL.href ? { format: "module", source, shortCircuit: true } : next(request, context);
  } });
  try { return await import(sourceURL.href); } finally { hook.deregister(); }
}
// Reuse declarations only. No registered old tests or production-method edits.
const native = await declarations("tests/inactive-generation-dialog-host.test.mjs", '\ntest("inactive create', "DocumentArtifacts, documentPort, windowPort");
const delivery = await declarations("tests/exact-delivery-backend.test.mjs", '\ntest("exact delivery backend:', "deliveryFixture, body, documentId, projectId, ownerId");
const { createSceneStoreHost, sceneDeferred } = await import(url("tests/helpers/scene-cost-store-host.mjs").href);
const { withDocumentInRoute } = await import(url("src/model/routes.ts").href);
const { documentArtifactRevision }=await import(url("src/model/document-artifacts.ts").href);

const originalFetch = globalThis.fetch;
let activeTransport = null, externalRequests = 0;
globalThis.fetch = async (input, init) => {
  if (typeof input === "string" && input.startsWith("/api/") && activeTransport) return activeTransport(input, init);
  externalRequests++;
  throw new Error("review_intent_proof_external_request_forbidden");
};
test.after(() => { globalThis.fetch = originalFetch; assert.equal(externalRequests, 0); });

const finance = state => Object.fromEntries(["document_jobs", "budget_reservations", "cost_budget_reservations", "cost_budget_counters"]
  .map(table => [table, state.sqlite.prepare("SELECT COUNT(*) AS n FROM " + table).get().n]));
const reviewRequests = h => h.requests.filter(request => request.url === "/api/events" && request.init.method === "POST"
  && ["ArtifactReviewRequested", "ArtifactChangesRequested"].includes(request.body?.event?.type));
const successful = async response => { const body = await response.json(); assert.ok(response.ok, JSON.stringify(body)); return body; };

async function addSecondReviewer(state) {
  const identity = { "oai-authenticated-user-id": "review-intent-r2", "oai-authenticated-user-email": "review-intent-r2@example.test" };
  await successful(await state.request("/api/session", { headers: identity }));
  // Same deterministic principal/consent setup as sharedProjectFixture; real
  // invitation, membership, and explicit review grant routes follow it.
  state.sqlite.prepare("UPDATE users SET consent_version=?,role='viewer' WHERE user_id=?").run("pilot-2026-08-10", identity["oai-authenticated-user-id"]);
  const json = body => ({ method: "POST", headers: { ...state.owner, "content-type": "application/json" }, body: JSON.stringify(body) });
  const invitation = await successful(await state.request(`/api/workspaces/${state.organizationId}/members`, json({ email: identity["oai-authenticated-user-email"], role: "member" })));
  const token = new URL(invitation.invitationUrl).searchParams.get("token");
  await successful(await state.request(`/api/workspaces/${state.organizationId}/invitations/${invitation.invitationId}/accept`, {
    method: "POST", headers: { ...identity, "content-type": "application/json" }, body: JSON.stringify({ token }),
  }));
  await successful(await state.request(`/api/workspaces/${state.organizationId}/projects/${state.projectAccessId}/members`, json({ userId: identity["oai-authenticated-user-id"], role: "viewer" })));
  const membership = state.sqlite.prepare("SELECT membership_id FROM project_memberships WHERE project_access_id=? AND user_id=?").get(state.projectAccessId, identity["oai-authenticated-user-id"]);
  await successful(await state.request(`/api/workspaces/${state.organizationId}/projects/${state.projectAccessId}/members/${membership.membership_id}`, {
    method: "PATCH", headers: { ...state.owner, "content-type": "application/json" }, body: JSON.stringify({ reviewAccess: true }),
  }));
}

function joinNativeEvents(t,h,f){
  const nativeDispatch=h.window.dispatchEvent;
  h.window.dispatchEvent=function(event){const value=nativeDispatch.call(this,event);for(const listener of [...(f.listeners.get(event.type)??[])])listener(event);return value;};
  t.after(()=>{h.window.dispatchEvent=nativeDispatch;});
}

async function setup(t, { assign = false, secondArtifact = false, locale = "en" } = {}) {
  const state = await delivery.deliveryFixture();
  const otherId = "review-intent-artifact-B";
  if (secondArtifact) await state.anotherArtifact(otherId);
  if (assign) await addSecondReviewer(state);
  else {
    await successful(await state.send("ArtifactReviewRequested", { assigned_reviewer_user_id: "assistant-viewer" }));
    if (secondArtifact) await successful(await state.send("ArtifactReviewRequested", { artifact_id: otherId, assigned_reviewer_user_id: "assistant-viewer" }));
  }
  const identity = assign ? state.owner : state.viewer;
  const request = (route, init = {}) => state.request(route, { ...init,
    headers: { ...Object.fromEntries(new Headers(init.headers)), ...identity } });
  const workerFixture = { ...state, documentId: delivery.documentId, projectId: delivery.projectId,
    requestId: "review-intent-no-generation", payload: {}, contentRef: state.contentId, request,
    close() {},
  };
  const h = await createSceneStoreHost({ workerFixture });
  const f = native.fixture("create", { artifact: true, locale });
  f.store = h.store; f.host.store = h.store; f.host.documentId = delivery.documentId; f.state.documentId = delivery.documentId;
  const canonicalRoute = withDocumentInRoute("/document/" + delivery.documentId, delivery.documentId, "Exact delivery");
  h.store.loading.set(false); h.store.route.set(canonicalRoute);
  Object.assign(h.location, { pathname: canonicalRoute, search: "", hash: "" });
  h.store.patchUi({ instrumentation: false });
  activeTransport = h.fetch;
  joinNativeEvents(t,h,f);f.draw();
  const originalAppend = h.store.append.bind(h.store), calls = [], releases = [], toasts = [];
  const originalToast=h.store.toast.bind(h.store);h.store.toast=(...args)=>{toasts.push(args[0]);return originalToast(...args);};
  // Observe the real method's promise; no replacement return value or commit.
  h.store.append = (...args) => {
    const pending = originalAppend(...args); calls.push({ args: structuredClone(args), pending }); return pending;
  };
  const beforeFinance = finance(state);
  const financialRows = () => Object.fromEntries(Object.keys(beforeFinance).map(table => [table, state.sqlite.prepare("SELECT * FROM " + table + " ORDER BY rowid").all()]));
  const beforeFinancialRows = financialRows();
  assert.equal(beforeFinance.budget_reservations, 0, JSON.stringify(beforeFinance));
  assert.equal(beforeFinance.cost_budget_reservations, 0, JSON.stringify(beforeFinance));
  t.after(async () => {
    for(const release of releases)release.resolve();
    await Promise.allSettled(calls.map(call=>call.pending));
    assert.deepEqual(finance(state), beforeFinance, "all financial/job tables remain unchanged");
    assert.deepEqual(financialRows(), beforeFinancialRows, "every financial/job row retains its original values");
    assert.ok(h.requests.filter(request => request.init.method === "POST").every(request => reviewRequests(h).includes(request)), "no generation, paid action, or unrelated POST");
    f.host.disconnectedCallback(); f.host.isConnected = false;
    h.store.append = originalAppend;h.store.toast=originalToast;
    await h.close(); await state.close(); activeTransport = null;
  });
  const view = () => f.renderer.ownNodes(f.host, "dialog").find(node => node.attributes.class === "document-artifact-view");
  const panel = () => f.renderer.ownNodes(f.host, "div").find(node => node.attributes.class === "artifact-review-actions");
  const note = () => f.renderer.ownNodes(f.host, "textarea").find(node => node.attributes.rows === "2");
  const reviewer = () => f.renderer.ownNodes(f.host, "select").find(node => typeof node.handlers.change === "function"
    && node.handlers.change.toString().includes("#selectedReviewerId"));
  const currentButton = type => f.renderer.ownNodes(f.host, "button").find(node => node.handlers.click?.toString().includes('"' + type + '"'));
  const click = node => {
    assert.ok(node && f.renderer.nodes.includes(node) && node.isConnected, "a currently rendered native button");
    assert.equal(Object.hasOwn(node.attributes, "disabled"), false, "current button is enabled");
    assert.ok(view()?.open, "current viewer is open");
    node.click();
  };
  const open = async id => {
    assert.equal(await f.host.openArtifactById(id, { expectedRevision: 0, intent: "review" }), true);
    f.draw();
    assert.ok(view()?.open, "actual viewer opens");
    assert.equal(Object.hasOwn(panel().attributes, "hidden"), false, "actual review panel is visible");
  };
  const close = () => {
    const button = f.renderer.ownNodes(f.host, "button").find(node => node.attributes["aria-label"] === f.i18n.t("action.close", "Close"));
    click(button); f.draw(); assert.equal(view(), undefined, "natural current Close removes viewer");
  };
  const typeNote = value => {
    const node = note(); assert.ok(node && view()?.open && !Object.hasOwn(panel().attributes, "hidden"));
    node.value = value; node.handlers.input.call(f.host, { target: node, currentTarget: node }); f.draw();
    assert.equal(note().value, value, "current native textarea retains typed value before acknowledgment");
  };
  const selectReviewer = value => {
    const node = reviewer(); assert.ok(node && view()?.open && !Object.hasOwn(panel().attributes, "hidden"));
    assert.ok(f.renderer.ownNodes(f.host, "option").some(option => option.attributes.value === value), "real member listing offers reviewer");
    node.value = value; node.handlers.change.call(f.host, { target: node, currentTarget: node }); f.draw();
    assert.equal(reviewer().value, value);
  };
  await open(state.artifactId);
  return { state, h, f, calls, releases, toasts, view, note, reviewer, click, currentButton, open, close, typeNote, selectReviewer, otherId, beforeFinance };
}

function holdActualReviewReply(p, { reject = false } = {}) {
  const entered = sceneDeferred(), release = sceneDeferred();
  p.releases.push(release);
  p.h.intercept = async request => {
    if (request.url !== "/api/events" || request.init.method !== "POST"
      || !["ArtifactReviewRequested", "ArtifactChangesRequested"].includes(request.body?.event?.type)) return undefined;
    p.h.intercept = null;
    if (reject) p.state.sqlite.prepare("UPDATE private_content SET content=content||' ' WHERE content_id=?").run(p.state.contentId);
    const response = await p.h.worker.request(request.url, request.init);
    const body = await response.clone().json();
    entered.resolve({ request: structuredClone(request.body), status: response.status, body,
      durableReviewCount: p.state.counts().reviewed });
    await release.promise;
    return response;
  };
  return { entered, release };
}
async function finished(p) {
  assert.equal(p.calls.length, 1, "one original actual Store.append invocation");
  const appended = await p.calls[0].pending;
  await Promise.resolve(); // Join synchronous caller continuation after that exact promise.
  p.f.draw();
  assert.equal(reviewRequests(p.h).length, 1, "no second review command or replay");
  return appended;
}
function holdNextActualArtifactDigest(t, content) {
  const entered = sceneDeferred(), release = sceneDeferred(), delivered = sceneDeferred();
  const original = crypto.subtle.digest, invoke = original.bind(crypto.subtle);
  let armed = true;
  crypto.subtle.digest = (algorithm, data) => {
    const pending = invoke(algorithm, data);
    if (!armed || new TextDecoder().decode(data) !== content) return pending;
    armed = false;
    const resultPromise = pending.then(async result => {
      assert.equal(Buffer.from(result).toString("hex"), sha(content), "unmodified real SHA-256 result");
      entered.resolve({ byteLength: new TextEncoder().encode(content).byteLength, sha256: sha(content) });
      await release.promise;
      return result;
    });
    resultPromise.then(delivered.resolve,delivered.reject);
    return resultPromise;
  };
  t.after(() => { release.resolve(); crypto.subtle.digest = original; });
  return { entered, release, delivered };
}
function evidence(_name, fields) { assert.equal(fields.financial.document_jobs,0); assert.equal(fields.financial.budget_reservations,0); assert.equal(fields.financial.cost_budget_reservations,0); }

test("unchanged Request changes note A clears only after actual committed acknowledgment", async t => {
  const p = await setup(t), gate = holdActualReviewReply(p);
  p.typeNote("Note A: correct this exact output.");
  p.click(p.currentButton("ArtifactChangesRequested"));
  const dispatched = await gate.entered.promise;
  assert.equal(dispatched.status, 200); assert.equal(p.note().value, dispatched.request.event.payload.review_note);
  gate.release.resolve(); const appended = await finished(p);
  assert.equal(appended.length, 1); assert.equal(p.note().value, "");
  evidence("unchanged-note-control", { dispatched, after: p.note().value, financial: finance(p.state) });
});

test("a genuinely rejected Request changes keeps the original unsaved note", async t => {
  const p = await setup(t), gate = holdActualReviewReply(p, { reject: true }), before = p.state.counts().reviewed;
  p.typeNote("Note A: preserve on rejected output revision.");
  p.click(p.currentButton("ArtifactChangesRequested"));
  const dispatched = await gate.entered.promise;
  assert.equal(dispatched.status, 409); assert.equal(p.state.counts().reviewed, before);
  gate.release.resolve(); assert.equal((await finished(p)).length, 0);
  evidence("failed-note-control", { status: dispatched.status, error: dispatched.body.error, after: p.note().value, financial: finance(p.state) });
  assert.equal(p.note().value, "Note A: preserve on rejected output revision.");
});

test("Request changes A acknowledgment must preserve subsequently typed note B", async t => {
  const p = await setup(t), gate = holdActualReviewReply(p);
  p.typeNote("Note A: original dispatched correction.");
  p.click(p.currentButton("ArtifactChangesRequested"));
  const dispatched = await gate.entered.promise; assert.equal(dispatched.status, 200);
  p.typeNote("Note B: later unsaved correction."); const before = p.note().value;
  gate.release.resolve(); const appended = await finished(p);
  assert.equal(appended[0].payload.review_note, "Note A: original dispatched correction.");
  evidence("new-note-after-dispatch", { before, after: p.note().value, dispatched: dispatched.request.event.payload, financial: finance(p.state) });
  assert.equal(p.note().value, before, "acknowledging original A must not erase newer unsaved B");
});

test("close A and open B naturally: A acknowledgment must preserve B viewer note", async t => {
  const p = await setup(t, { secondArtifact: true }), gate = holdActualReviewReply(p);
  p.typeNote("Note A: original viewer correction."); p.click(p.currentButton("ArtifactChangesRequested"));
  const dispatched = await gate.entered.promise; assert.equal(dispatched.status, 200);
  p.close(); await p.open(p.otherId); p.typeNote("Note B: different viewer draft."); const before = p.note().value;
  gate.release.resolve(); const appended = await finished(p);
  assert.equal(appended[0].payload.artifact_id, p.state.artifactId);
  evidence("new-viewer-after-dispatch", { before, after: p.note().value, currentPanel: p.f.renderer.ownNodes(p.f.host, "div").find(node => node.attributes.class === "artifact-review-actions").attributes.id, dispatched: dispatched.request.event.payload, financial: finance(p.state) });
  assert.equal(p.note().value, before, "old A cannot erase current B's unsaved draft");
});

test("unchanged Assign R1 uses the exact reviewer chosen at activation", async t => {
  const p = await setup(t, { assign: true }), gate = holdActualReviewReply(p);
  p.selectReviewer("assistant-viewer"); p.click(p.currentButton("ArtifactReviewRequested"));
  const dispatched = await gate.entered.promise; assert.equal(dispatched.status, 200);
  gate.release.resolve(); const appended = await finished(p);
  evidence("unchanged-assignment-control", { dispatched: dispatched.request.event.payload, financial: finance(p.state) });
  assert.equal(appended[0].payload.assigned_reviewer_user_id, "assistant-viewer");
});

test("Assign A/R1 must not silently adopt R2 changed during real digest", async t => {
  const p = await setup(t, { assign: true }), reply = holdActualReviewReply(p), digest = holdNextActualArtifactDigest(t, p.state.content);
  p.selectReviewer("assistant-viewer"); p.click(p.currentButton("ArtifactReviewRequested"));
  const hashed = await digest.entered.promise; assert.equal(reviewRequests(p.h).length, 0);
  p.selectReviewer("review-intent-r2"); digest.release.resolve();
  const dispatched = await reply.entered.promise; assert.equal(dispatched.status, 200);
  reply.release.resolve(); const appended = await finished(p);
  evidence("new-reviewer-during-digest", { chosenAtClick: "assistant-viewer", currentReviewer: p.reviewer().value, hashed, dispatched: dispatched.request.event.payload, financial: finance(p.state) });
  assert.equal(appended[0].payload.assigned_reviewer_user_id, "assistant-viewer", "only R1 was explicitly authorized by the original activation");
});

test("Assign A preparation retired by a naturally opened B never dispatches", async t => {
  const p=await setup(t,{assign:true,secondArtifact:true}),digest=holdNextActualArtifactDigest(t,p.state.content),before=p.state.counts();
  p.selectReviewer("assistant-viewer");p.click(p.currentButton("ArtifactReviewRequested"));
  await digest.entered.promise;assert.equal(p.calls.length,0);
  p.close();await p.open(p.otherId);p.selectReviewer("review-intent-r2");digest.release.resolve();
  await digest.delivered.promise;
  // Join the exact digest -> binding -> review promise continuations, not a
  // timer or guessed transport delay. A forbidden Store invocation is observed
  // synchronously even if its own digest has not reached HTTP yet.
  await Promise.resolve();await Promise.resolve();
  assert.equal(p.calls.length,0);assert.equal(reviewRequests(p.h).length,0);
  assert.equal(p.reviewer().value,"review-intent-r2");assert.deepEqual(p.state.counts(),before);
});

test("review note A is captured before hashing and cannot borrow current note B",async t=>{
  const p=await setup(t),reply=holdActualReviewReply(p),digest=holdNextActualArtifactDigest(t,p.state.content);
  p.typeNote("Note A before hashing.");p.click(p.currentButton("ArtifactChangesRequested"));
  await digest.entered.promise;p.typeNote("Note B during hashing.");digest.release.resolve();
  const dispatched=await reply.entered.promise;assert.equal(dispatched.status,200);
  assert.equal(dispatched.request.event.payload.review_note,"Note A before hashing.");
  reply.release.resolve();await finished(p);assert.equal(p.note().value,"Note B during hashing.");
  assert.ok(!p.toasts.includes("Changes requested and recorded for the project."),"A acknowledgment cannot label current B as submitted");
});

test("review note A -> B -> A is newer intent even when its text is equal",async t=>{
  const p=await setup(t),reply=holdActualReviewReply(p);
  p.typeNote("Original note A.");p.click(p.currentButton("ArtifactChangesRequested"));
  const dispatched=await reply.entered.promise;assert.equal(dispatched.status,200);
  p.typeNote("New draft B.");p.typeNote("Original note A.");
  reply.release.resolve();await finished(p);
  assert.equal(p.note().value,"Original note A.","monotonic draft ownership, not equality, controls cleanup");
  assert.ok(!p.toasts.includes("Changes requested and recorded for the project."));
});

test("real source denial during review hashing retires preparation without a command",async t=>{
  const p=await setup(t),digest=holdNextActualArtifactDigest(t,p.state.content),before=p.state.counts();
  p.typeNote("Note A under original source.");p.click(p.currentButton("ArtifactChangesRequested"));await digest.entered.promise;
  p.state.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE project_access_id=? AND principal_user_id=?")
    .run(new Date().toISOString(),p.state.projectAccessId,"assistant-viewer");
  const response=await p.h.worker.request("/api/events?after=0&limit=2000&content=1");assert.equal(response.status,403);
  await assert.rejects(p.h.store.refreshEvents(),/403/);p.f.draw();digest.release.resolve();await digest.delivered.promise;await Promise.resolve();await Promise.resolve();
  assert.equal(p.calls.length,0);assert.equal(reviewRequests(p.h).length,0);assert.deepEqual(p.state.counts(),before);
});

async function editSetup(t,{locale="en",count=1}={}){
  const h=await createSceneStoreHost({count,shared:true}),state=h.worker;

  const f=native.fixture("create",{artifact:true,locale});
  f.store=h.store;f.host.store=h.store;f.host.documentId=state.documentId;f.state.documentId=state.documentId;
  const title=h.store.projection.get().documents.find(item=>item.id===state.documentId).title;
  const route=withDocumentInRoute("/document/"+state.documentId,state.documentId,title);
  h.store.route.set(route);h.store.loading.set(false);h.store.patchUi({instrumentation:false});
  Object.assign(h.location,{pathname:route,search:"",hash:""});activeTransport=h.fetch;joinNativeEvents(t,h,f);f.draw();
  const calls=[],releases=[],observation={afterSaved:null},original=h.store.reviseDocumentArtifact.bind(h.store),beforeFinance=finance(state);
  const rowState=()=>Object.fromEntries(Object.keys(beforeFinance).map(table=>[table,state.sqlite.prepare("SELECT * FROM "+table+" ORDER BY rowid").all()]));
  const beforeRows=rowState();
  h.store.reviseDocumentArtifact=(...args)=>{const pending=original(...args).then(async saved=>{if(observation.afterSaved)await observation.afterSaved(saved);return saved;});calls.push({args:structuredClone(args),pending});return pending;};
  t.after(async()=>{for(const release of releases)release.resolve();await Promise.allSettled(calls.map(call=>call.pending));
    assert.deepEqual(rowState(),beforeRows);assert.equal(externalRequests,0);
    assert.ok(h.requests.filter(request=>["POST","PATCH"].includes(request.init.method)).every(request=>request.init.method==="PATCH"&&request.url.startsWith("/api/artifacts/")),"only explicit finished-output edits are allowed");
    f.host.disconnectedCallback();f.host.isConnected=false;h.store.reviseDocumentArtifact=original;await h.close();activeTransport=null;
  });
  const own=tag=>f.renderer.ownNodes(f.host,tag);
  const view=()=>own("dialog").find(node=>node.attributes.class==="document-artifact-view");
  const editor=()=>own("textarea").find(node=>node.attributes.rows==="12");
  const button=method=>own("button").find(node=>node.handlers.click?.toString().includes(method));
  const click=node=>{assert.ok(node&&f.renderer.nodes.includes(node)&&node.isConnected);assert.equal(Object.hasOwn(node.attributes,"disabled"),false);assert.ok(view()?.open);node.click();};
  const type=(value,field="markdown",index=0)=>{
    const node=field==="markdown"?editor():field==="title"?own("input").filter(node=>node.handlers.input?.toString().includes("item.title"))[index]
      :own("textarea").filter(node=>node.handlers.input?.toString().includes("item."+field))[index];
    assert.ok(node&&f.renderer.nodes.includes(node)&&node.isConnected);assert.equal(Object.hasOwn(node.attributes,"disabled"),false);assert.equal(Object.hasOwn(node.attributes,"readonly"),false);
    node.value=value;node.handlers.input.call(f.host,{target:node,currentTarget:node});f.draw();
  };
  const open=async(id="saved-scene-story")=>{assert.equal(await f.host.openArtifactById(id),true);f.draw();assert.ok(view()?.open);};
  await open();click(button("#startArtifactEdit"));f.draw();
  const finish=async(index=0)=>{const result=await calls[index].pending;await Promise.resolve();f.draw();return result;};
  return{h,state,f,calls,releases,observation,beforeFinance,own,view,editor,button,click,type,open,finish,
    content:()=>JSON.parse(h.store.content.get()[state.contentRef]),
    retained:()=>JSON.parse(state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(state.contentRef).content),
    revision:()=>documentArtifactRevision(h.store.events.get(),"saved-scene-story"),
    patches:()=>h.requests.filter(request=>request.init.method==="PATCH"&&request.url==="/api/artifacts/saved-scene-story")};
}
function holdEditReply(p,{reject=false,beforeRelease=null}={}){
  const entered=sceneDeferred(),release=sceneDeferred();p.releases.push(release);
  p.h.intercept=async request=>{
    if(request.init.method!=="PATCH"||request.url!=="/api/artifacts/saved-scene-story")return undefined;
    p.h.intercept=null;
    const actualBody=reject?{...request.body,expectedRevision:99}:request.body;
    // Rejection control uses a genuine endpoint CAS failure, not a fabricated
    // saved boolean or acknowledgment. It does not rewrite the positive input.
    const response=await p.h.worker.request(request.url,{...request.init,body:JSON.stringify(actualBody)});
    const body=await response.clone().json();entered.resolve({request:structuredClone(request.body),status:response.status,body});
    await release.promise;if(beforeRelease)await beforeRelease();return response;
  };
  return{entered,release};
}

for(const locale of ["en","fr","ar","ja"])test("finished edit "+locale+": unchanged A closes only its own draft after actual acknowledgment",async t=>{
  const p=await editSetup(t,{locale}),reply=holdEditReply(p);p.type("A complete revised manuscript.");
  p.click(p.button("#saveArtifactEdit"));const dispatched=await reply.entered.promise;assert.equal(dispatched.status,200,JSON.stringify(dispatched.body));
  assert.equal(p.editor().value,dispatched.request.markdown);assert.equal(p.calls.length,1);
  reply.release.resolve();assert.equal(await p.finish(),true);assert.equal(p.editor(),undefined);assert.ok(p.view()?.open);
  assert.equal(p.retained().content_markdown,"A complete revised manuscript.");assert.equal(p.revision(),1);assert.equal(p.patches().length,1);
});

for(const field of ["markdown","title","body","notes"])test("finished edit: later "+field+" survives A and needs a separately explicit B Save",async t=>{
  const p=await editSetup(t,{count:field==="markdown"?1:2}),reply=holdEditReply(p),a="A complete revised manuscript.";
  p.type(a);if(field!=="markdown")p.type("Submitted "+field+" A.",field);
  p.click(p.button("#saveArtifactEdit"));const dispatched=await reply.entered.promise;assert.equal(dispatched.status,200,JSON.stringify(dispatched.body));
  p.type("New unsent "+field+" B.",field);reply.release.resolve();assert.equal(await p.finish(),true);
  assert.ok(p.editor(),"newer draft remains in the actual editor");assert.equal(p.patches().length,1,"no automatic B Save");
  assert.deepEqual(p.retained().content_markdown,a);assert.equal(p.revision(),1);
  p.click(p.button("#saveArtifactEdit"));assert.equal(await p.finish(1),true);assert.equal(p.calls[1].args[1].expectedRevision,1);
  assert.equal(p.patches().length,2);assert.equal(p.revision(),2);assert.equal(p.editor(),undefined);
  if(field==="markdown")assert.equal(p.retained().content_markdown,"New unsent markdown B.");
  else assert.equal(p.retained().items[0][field],"New unsent "+field+" B.");
});

for(const field of ["markdown","title","body","notes"])test("finished edit: "+field+" A -> B -> A still owns an unsaved newer revision",async t=>{
  const p=await editSetup(t,{count:field==="markdown"?1:2}),reply=holdEditReply(p),value="Submitted "+field+" A.";
  p.type("A complete revised manuscript.");p.type(value,field);
  p.click(p.button("#saveArtifactEdit"));assert.equal((await reply.entered.promise).status,200);
  p.type("Intermediate "+field+" B.",field);p.type(value,field);
  reply.release.resolve();assert.equal(await p.finish(),true);assert.ok(p.editor(),"text equality cannot erase newer input intent");
  assert.equal(p.patches().length,1);p.type("Separately edited "+field+" C.",field);p.click(p.button("#saveArtifactEdit"));assert.equal(await p.finish(1),true);
  assert.equal(p.calls[1].args[1].expectedRevision,1);assert.equal(p.revision(),2);assert.equal(p.patches().length,2);
});

test("finished edit: actual CAS rejection retains current B and its original base",async t=>{
  const p=await editSetup(t),reply=holdEditReply(p,{reject:true});p.type("Submitted A.");p.click(p.button("#saveArtifactEdit"));
  const dispatched=await reply.entered.promise;assert.equal(dispatched.status,409);assert.equal(dispatched.body.error,"artifact_revision_conflict");
  p.type("Unsent B after rejected A.");reply.release.resolve();assert.equal(await p.finish(),false);
  assert.equal(p.editor().value,"Unsent B after rejected A.");assert.equal(p.revision(),0);assert.equal(p.patches().length,1);
  p.click(p.button("#saveArtifactEdit"));assert.equal(await p.finish(1),true);assert.equal(p.calls[1].args[1].expectedRevision,0);
});


for(const boundary of ["peer-next-revision","different-bytes-at-same-revision"])test("finished edit: "+boundary+" cannot silently rebase B using A's success",async t=>{
  const p=await editSetup(t),entered=sceneDeferred(),release=sceneDeferred();p.releases.push(release);
  p.observation.afterSaved=async saved=>{p.observation.afterSaved=null;assert.equal(saved,true);entered.resolve();await release.promise;};
  p.type("Submitted A with real saved receipt.");p.click(p.button("#saveArtifactEdit"));await entered.promise;
  assert.equal(p.revision(),1);p.type("Newer B must not overwrite peer C.");
  if(boundary==="peer-next-revision"){
    // A second application request under the same real account represents
    // another deliberate tab's write, not multiplayer or a fabricated receipt.
    const old=p.calls[0].args[1],input={...old,markdown:"Peer C is now canonical.",expectedRevision:1,
      items:old.items.map(item=>({...item,body:"Peer C is now canonical."}))};
    const response=await p.h.worker.request("/api/artifacts/saved-scene-story",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify(input)});
    assert.equal(response.status,200,await response.clone().text());
  }else{
    // Explicit corruption negative: revision count alone must never certify
    // current bytes. This is not presented as a normal user edit workflow.
    const content=p.retained();content.content_markdown="Unreceipted different canonical bytes.";
    p.state.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id=?").run(JSON.stringify(content),p.state.contentRef);
  }
  await p.h.store.refreshEvents();await p.h.store.ensurePrivateContent(p.state.contentRef,{force:true});
  assert.equal(p.content().content_markdown,p.retained().content_markdown,"the actual forced private read installs current C before A cleanup");
  release.resolve();assert.equal(await p.finish(),true);
  assert.equal(p.editor().value,"Newer B must not overwrite peer C.");assert.equal(p.calls.length,1);
  p.click(p.button("#saveArtifactEdit"));assert.equal(await p.finish(1),false);
  assert.equal(p.calls[1].args[1].expectedRevision,0,"no unsafe inferred base advancement");
  assert.equal(p.editor().value,"Newer B must not overwrite peer C.");
  assert.equal(p.revision(),boundary==="peer-next-revision"?2:1);
});

test("finished edit: genuine source denial withholds private cleanup but keeps A's exact committed receipt",async t=>{
  const p=await editSetup(t),reply=holdEditReply(p),source=p.h.store.captureSourceOwnership();
  const owner={authorizationKey:source.authorization.key,actorUserId:p.state.owner,projectId:p.state.projectId,sourceGeneration:source.generation};
  p.type("Original A committed before source denial.");p.click(p.button("#saveArtifactEdit"));
  const dispatched=await reply.entered.promise;assert.equal(dispatched.status,200);
  p.type("Private B that must retire on source denial.");
  p.state.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE project_access_id=? AND principal_user_id=?")
    .run(new Date().toISOString(),p.state.sharing.projectAccessId,p.state.owner);
  await assert.rejects(p.h.store.refreshEvents(),/403/);p.f.draw();assert.equal(p.editor(),undefined);assert.equal(p.view(),undefined);
  reply.release.resolve();assert.equal(await p.finish(),false);assert.equal(p.calls.length,1);
  const receipts=p.h.store.eventWriteAcknowledgments(owner);assert.equal(receipts.length,1);assert.equal(receipts[0].outcome,"observed");
  assert.deepEqual(receipts[0].committed.map(row=>row.eventId),dispatched.body.appended.filter(row=>row.actor!=="worker:validator").map(row=>row.eventId));
  assert.equal(JSON.stringify(receipts).includes("Private B"),false);assert.equal(JSON.stringify(receipts).includes("Original A committed"),false);
  assert.equal(p.retained().content_markdown,"Original A committed before source denial.");
  assert.deepEqual(p.h.store.content.get(),{});assert.equal(p.editor(),undefined);
});

test("E4 pending exact correction blocks incidental Close and preserves newer A-to-B-to-A until explicit Cancel",async t=>{
  const p=await editSetup(t,{count:2}),reply=holdEditReply(p),source=p.h.store.captureSourceOwnership();
  const owner={authorizationKey:source.authorization.key,actorUserId:p.state.owner,projectId:p.state.projectId,sourceGeneration:source.generation};
  const rows=()=>Object.fromEntries(Object.keys(p.beforeFinance).map(table=>[table,p.state.sqlite.prepare("SELECT * FROM "+table+" ORDER BY rowid").all()]));
  const beforeRows=rows(),a="A finished correction submitted by this one explicit Save.";
  p.type(a);p.click(p.button("#saveArtifactEdit"));
  const dispatched=await reply.entered.promise;assert.equal(dispatched.status,200,JSON.stringify(dispatched.body));
  p.type("Newer unsubmitted B.");p.type(a);
  assert.equal(p.editor().value,a);assert.equal(Object.hasOwn(p.button("#cancelArtifactEdit").attributes,"disabled"),true);
  const close=p.own("button").find(node=>node.attributes["aria-label"]===p.f.i18n.t("action.close","Close"));
  p.click(close);p.f.draw();
  const pending={open:Boolean(p.view()?.open),raw:p.editor()?.value,toast:p.h.store.ui.toast};
  const beforeAckFocus=p.f.trace.filter(value=>String(value).startsWith("focus:")).length;
  reply.release.resolve();assert.equal(await p.finish(),true);
  const afterAck={open:Boolean(p.view()?.open),raw:p.editor()?.value,
    focusCalls:p.f.trace.filter(value=>String(value).startsWith("focus:")).length};
  let cancelled=false;
  if(p.editor()){
    const cancel=p.button("#cancelArtifactEdit");assert.equal(Object.hasOwn(cancel.attributes,"disabled"),false);
    p.click(cancel);p.f.draw();cancelled=p.editor()===undefined;
  }
  assert.equal(p.calls.length,1);assert.equal(p.patches().length,1);assert.equal(p.revision(),1);
  assert.equal(p.retained().content_markdown,a);assert.deepEqual(rows(),beforeRows);
  // Reuse the existing published-and-pruned oracle, not a retained success ledger.
  const committed=dispatched.body.appended.filter(row=>row.actor!=="worker:validator");
  assert.equal(committed.length,1);assert.equal(committed[0].type,"DocumentArtifactEdited");
  assert.equal(committed[0].actor,"user:"+owner.actorUserId);assert.equal(committed[0].payload.artifact_id,"saved-scene-story");
  assert.equal(committed[0].payload.document_id,p.state.documentId);assert.equal(committed[0].payload.project_id,owner.projectId);
  assert.equal(committed[0].payload.revision,1);assert.equal(committed[0].payload.content_ref,p.state.contentRef);
  for(const event of dispatched.body.appended)assert.deepEqual(p.h.store.events.get().find(row=>row.eventId===event.eventId),event);
  assert.ok(p.h.store.sourceOwnershipActive(source));
  assert.equal(p.h.store.session.get().user.userId,owner.actorUserId);assert.equal(p.h.store.session.get().projectContext.projectId,owner.projectId);
  assert.deepEqual(p.h.store.eventWriteAcknowledgments(owner),[],"the actual observed ACK is published and pruned, not lost or replaced");
  assert.equal(externalRequests,0);
  assert.equal(pending.open,true,"the active Save remains in its original correction owner");
  assert.equal(pending.raw,a);assert.equal(pending.toast,"Wait for the current save to finish before closing this output.");
  assert.equal(afterAck.open,true);assert.equal(afterAck.raw,a,"A-to-B-to-A remains newer input, not an implicit discard");
  assert.equal(afterAck.focusCalls,beforeAckFocus,"ACK cleanup never acquires a fresh user-focus lease");
  assert.equal(cancelled,true);
});

test("E4 an old pending Save does not trap a later read-only opening of the same exact output",async t=>{
  const p=await editSetup(t),reply=holdEditReply(p),source=p.h.store.captureSourceOwnership();
  const owner={authorizationKey:source.authorization.key,actorUserId:p.state.owner,projectId:p.state.projectId,sourceGeneration:source.generation};
  const rows=()=>Object.fromEntries(Object.keys(p.beforeFinance).map(table=>[table,p.state.sqlite.prepare("SELECT * FROM "+table+" ORDER BY rowid").all()]));
  const beforeRows=rows(),a="Original A saved before its presentation retires.";
  const labelOf=node=>{
    assert.ok(node&&node.isConnected&&p.f.renderer.nodes.includes(node));
    const at=p.f.renderer.markup.indexOf(node.full);assert.ok(at>=0);
    return p.f.renderer.markup.slice(at+node.full.length,p.f.renderer.markup.indexOf("</button>",at)).replace(/<[^>]*>/gu,"").replaceAll("&lt;","<").replaceAll("&gt;",">").replaceAll("&amp;","&").trim();
  };
  const originalPrimaryLabel=labelOf(p.button("#showArtifactIntent"));assert.ok(originalPrimaryLabel);
  const originalRaw=p.h.store.content.get()[p.state.contentRef],originalRoute=p.h.store.route.get();
  const originalEventIds=p.h.store.events.get().map(event=>event.eventId);
  p.type(a);p.click(p.button("#saveArtifactEdit"));
  const dispatched=await reply.entered.promise;assert.equal(dispatched.status,200,JSON.stringify(dispatched.body));
  p.view().close();p.f.draw();assert.equal(p.editor(),undefined,"forced native cleanup is not an ordinary dismissal request");
  await p.open();assert.ok(p.view()?.open);assert.equal(p.editor(),undefined);
  const closedby=p.view().attributes.closedby;
  const menu=()=>p.f.renderer.query(p.f.host,"forma-ui-popover").find(value=>String(value.attributes?.class??"").split(/\s+/u).includes("artifact-viewer-actions-popover"));
  assert.ok(menu());menu().querySelector(".ui-popover-trigger").click();await p.f.flush();
  assert.equal(menu().querySelector(".ui-popover-panel").matches(":popover-open"),true);
  const edit=p.button("#startArtifactEdit");assert.ok(edit&&edit.isConnected&&p.f.renderer.nodes.includes(edit));
  const busyDisabled=Object.hasOwn(edit.attributes,"disabled"),busyTitle=edit.attributes.title;
  const offset=p.f.renderer.markup.indexOf(edit.full);assert.ok(offset>=0);
  const busyLabel=p.f.renderer.markup.slice(offset+edit.full.length,p.f.renderer.markup.indexOf("</button>",offset)).replace(/<[^>]*>/gu,"").trim();
  // Reuse the current native disabled-button default; do not remove disabled
  // or force the old handler to create an editor. Then separately challenge
  // the current target's busy admission if the native default kept it current.
  edit.click();p.f.draw();const nativeEntryBlocked=p.editor()===undefined;
  let targetEntryBlocked=false;
  if(nativeEntryBlocked){
    const current=p.button("#startArtifactEdit");assert.ok(current&&current.isConnected&&p.f.renderer.nodes.includes(current));
    await current.handlers.click.call(p.f.host,{target:current,currentTarget:current});p.f.draw();
    targetEntryBlocked=p.editor()===undefined;
  }
  // The same current read-only presentation owns both pending actions. Keep
  // the native disabled default and the existing target refusal distinct.
  const readOnlyState=()=>({open:Boolean(p.view()?.open),editing:Boolean(p.editor()),
    menuOpen:Boolean(menu()?.querySelector(".ui-popover-panel")?.matches(":popover-open")),
    source:p.h.store.sourceOwnershipActive(source),actor:p.h.store.session.get()?.user.userId,
    project:p.h.store.session.get()?.projectContext?.projectId,document:p.f.host.documentId,
    route:p.h.store.route.get(),raw:p.h.store.content.get()[p.state.contentRef],
    eventIds:p.h.store.events.get().map(event=>event.eventId),requests:p.h.requests.length});
  const pendingActions=[];
  for(const method of ["#showArtifactIntent","#addArtifactContext"]){
    const node=p.button(method),label=labelOf(node),before=readOnlyState();
    const presentation={method,disabled:Object.hasOwn(node.attributes,"disabled"),label,
      accessibleName:node.attributes["aria-label"]??label,title:node.attributes.title??null};
    node.click();await p.f.flush();const afterNative=readOnlyState();
    const current=p.button(method);assert.ok(current&&current.isConnected&&p.f.renderer.nodes.includes(current));
    await current.handlers.click.call(p.f.host,{target:current,currentTarget:current});await p.f.flush();
    pendingActions.push({presentation,before,afterNative,afterTarget:readOnlyState()});
  }
  p.click(p.own("button").find(node=>node.attributes["aria-label"]===p.f.i18n.t("action.close","Close")));p.f.draw();
  const closed=!p.view()?.open;
  reply.release.resolve();assert.equal(await p.finish(),true);
  assert.equal(p.calls.length,1);assert.equal(p.patches().length,1);assert.equal(p.revision(),1);
  assert.equal(p.retained().content_markdown,a);assert.deepEqual(rows(),beforeRows);
  // Reuse the existing published-and-pruned oracle, not a retained success ledger.
  const committed=dispatched.body.appended.filter(row=>row.actor!=="worker:validator");
  assert.equal(committed.length,1);assert.equal(committed[0].type,"DocumentArtifactEdited");
  assert.equal(committed[0].actor,"user:"+owner.actorUserId);assert.equal(committed[0].payload.artifact_id,"saved-scene-story");
  assert.equal(committed[0].payload.document_id,p.state.documentId);assert.equal(committed[0].payload.project_id,owner.projectId);
  assert.equal(committed[0].payload.revision,1);assert.equal(committed[0].payload.content_ref,p.state.contentRef);
  for(const event of dispatched.body.appended)assert.deepEqual(p.h.store.events.get().find(row=>row.eventId===event.eventId),event);
  assert.ok(p.h.store.sourceOwnershipActive(source));
  assert.equal(p.h.store.session.get().user.userId,owner.actorUserId);assert.equal(p.h.store.session.get().projectContext.projectId,owner.projectId);
  assert.deepEqual(p.h.store.eventWriteAcknowledgments(owner),[],"the actual observed ACK is published and pruned, not lost or replaced");
  assert.equal(externalRequests,0);
  assert.equal(closedby,"any","old component-wide saving state does not own the newer read-only presentation");
  assert.equal(busyDisabled,true);assert.equal(nativeEntryBlocked,true);assert.equal(targetEntryBlocked,true);
  assert.equal(busyTitle,"A save is still pending. You can keep viewing or close this output.");
  assert.equal(busyLabel,"Edit finished output (save pending)","busy status is visible on the existing action, not only in a hover title");
  assert.equal(closed,true);assert.equal(p.view(),undefined);assert.equal(p.editor(),undefined);
  for(const action of pendingActions){
    assert.equal(action.before.open,true);assert.equal(action.before.editing,false);assert.equal(action.before.menuOpen,true);
    assert.equal(action.before.source,true);assert.equal(action.before.actor,owner.actorUserId);assert.equal(action.before.project,owner.projectId);
    assert.equal(action.before.document,p.state.documentId);assert.equal(action.before.route,originalRoute);assert.equal(action.before.raw,originalRaw);
    assert.deepEqual(action.before.eventIds,originalEventIds);
    assert.deepEqual(action.afterNative,action.before,"native pending activation cannot change the current read-only owner or make a request");
    assert.deepEqual(action.afterTarget,action.before,"the same target's existing pending guard remains authoritative");
  }
  const pendingTitle="A save is still pending. You can keep viewing or close this output.";
  assert.deepEqual(pendingActions.map(action=>action.presentation),[
    {method:"#showArtifactIntent",disabled:true,label:originalPrimaryLabel+" (save pending)",
      accessibleName:originalPrimaryLabel+" (save pending)",title:pendingTitle},
    {method:"#addArtifactContext",disabled:true,label:"Use & edit short story (save pending)",
      accessibleName:"Use short story as input (save pending)",title:pendingTitle},
  ],"both existing actions visibly and accessibly explain the same pending guard");
});
