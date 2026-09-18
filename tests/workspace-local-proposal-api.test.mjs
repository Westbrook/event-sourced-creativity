import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import ts from "typescript";
import { enforceD1ExpressionDepth } from "./helpers/d1-expression-depth.mjs";

// Reuse the actual Worker SQLite transaction fixture, without running unrelated provider tests.
const fixtureUrl = new URL("./workspace-local-proposal-fixture.mjs", import.meta.url).href;
const completeFixture = readFileSync(new URL("./assistant-runtime.test.mjs", import.meta.url), "utf8");
let fixtureSource = completeFixture.split("const adaptiveRegressionRequest =")[0];
assert.ok(fixtureSource.includes("async function sharedProjectFixture"));
fixtureSource = 'import { AsyncLocalStorage } from "node:async_hooks";\nconst localAudit = new AsyncLocalStorage();\n' + fixtureSource;
fixtureSource = fixtureSource.replace("bind(...values) { assert.ok(values.length <= 100);", 'bind(...values) { const audit=localAudit.getStore();if(audit&&values.length>audit.binds){audit.binds=values.length;audit.bindSql=this.sql.replace(/\\s+/gu," ").slice(0,180);} assert.ok(values.length <= 100);');
fixtureSource = fixtureSource.replace("    execute(kind) {\n", '    execute(kind) {\n      const audit=localAudit.getStore(),bytes=new TextEncoder().encode(this.sql).length;if(audit){audit.queries++;if(bytes>audit.bytes){audit.bytes=bytes;audit.sizeSql=this.sql.replace(/\\s+/gu," ").slice(0,180);}assert.ok(audit.queries<=1000,"D1 request query limit");}assert.ok(bytes<=100000,"D1 SQL text limit");\n');
fixtureSource += '\nexport {fixture,sharedProjectFixture,json};\nexport async function measured(run){const metrics={queries:0,binds:0,bytes:0};const result=await localAudit.run(metrics,run);return{result,metrics};}\n';
const fixtureSyntax=ts.createSourceFile("assistant-runtime.test.mjs",completeFixture,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
for(const name of["seedAdaptiveRightsDeadline","seedAdaptiveSeparateProjectGoverned","consequentialDbClock"]){
  const node=fixtureSyntax.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);assert.ok(node,"Existing runtime helper "+name);fixtureSource+="\n"+node.getText(fixtureSyntax);
}
const sourceBody=fixtureSyntax.statements.find(node=>ts.isVariableStatement(node)&&node.declarationList.declarations.some(item=>item.name.getText(fixtureSyntax)==="adaptiveConsentBody"));
assert.ok(sourceBody);fixtureSource+="\n"+sourceBody.getText(fixtureSyntax)+"\nexport{seedAdaptiveRightsDeadline,seedAdaptiveSeparateProjectGoverned,consequentialDbClock};\n";
const hook = registerHooks({
  resolve(specifier, context, next) { if (specifier === fixtureUrl) return { url: fixtureUrl, shortCircuit: true }; return next(specifier, context); },
  load(url, context, next) { if (url === fixtureUrl) return { format: "module", source: fixtureSource, shortCircuit: true }; return next(url, context); },
});
const { fixture: personalFixture, sharedProjectFixture, json, measured, seedAdaptiveRightsDeadline, seedAdaptiveSeparateProjectGoverned, consequentialDbClock } = await import(fixtureUrl).finally(() => hook.deregister());
const runtime = await import("../worker/runtime.ts"), model = await import("../src/model/events.ts");
const { synchronizeProjectScope } = await import("../worker/project-access.ts");
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw Error("A FREE local quick edit must never call a provider"); };
test.after(() => { globalThis.fetch = originalFetch; });
const scope = { projectId: "project-atmosphere", documentId: "local-proposal-document" }, metrics = [];
const ownerIdentity = { "oai-authenticated-user-id": "assistant-owner", "oai-authenticated-user-email": "assistant-owner@example.test" };
const confirm = (preview, action = "apply") => ({ action, previewId: preview.previewId, approvalHash: preview.approvalHash });
const intent = (changes = {}) => ({ action: "preview", operationId: crypto.randomUUID(), prompt: "  Keep the exact authored direction 文書.\n", targetBlockId: null, ...changes });
const body = async (response, expected = 200) => { const value = await response.json(); assert.equal(response.status, expected, JSON.stringify(value)); return value; };
async function fixture(mode = "personal") {
  const state = mode === "personal" ? await personalFixture() : await sharedProjectFixture();
  const ownerId = mode === "personal" ? "dev-local-creative" : "assistant-owner", stream = "creative:" + ownerId;
  let headers = mode === "personal" ? {} : mode === "migrated" ? ownerIdentity : state.owner;
  if (mode === "editor") {
    state.sqlite.prepare("UPDATE project_memberships SET role='editor' WHERE user_id='assistant-viewer'").run();
    const selected = await state.request("/api/workspaces/" + state.organizationId + "/projects/" + state.projectAccessId + "/context", { method: "POST", headers: Object.fromEntries(Object.entries(state.viewer).filter(([key])=>key!=="cookie")) });
    assert.equal(selected.status, 200, JSON.stringify(await selected.clone().json()));
    headers = { ...state.viewer, cookie: selected.headers.get("set-cookie").split(";")[0] };
  }
  const seed = async entries => {
    const head = Number(state.sqlite.prepare("SELECT COALESCE(MAX(sequence),0) AS n FROM events WHERE stream_id=?").get(stream).n);
    await state.env.DB.batch(entries.map(([type, payload], index) => runtime.insertEvent(state.env,
      runtime.makeEvent(stream, head + index + 1, "user:" + ownerId, "local-fixture", crypto.randomUUID(), type, { ...payload, project_id: scope.projectId }))));
    if(mode!=="personal")await synchronizeProjectScope(state.env,{organizationId:state.organizationId,projectAccessId:state.projectAccessId,projectId:scope.projectId,ownerUserId:ownerId});
  };
  await seed([
    ["DocumentCreated", { document_id: scope.documentId, title: "Café 文書 — exact source" }],
    ["BlockCreated", { document_id: scope.documentId, block_id: "local-palette-a", type: "palette", handle: "palette/a", position: "a0", properties: { label: "First palette", temperature: "neutral" } }],
    ["BlockCreated", { document_id: scope.documentId, block_id: "local-palette-b", type: "palette", handle: "palette/b", position: "a1", properties: { label: "Explicit palette", temperature: "neutral" } }],
  ]);
  state.controls.localFailEventAt = 0;
  state.sqlite.function("local_quick_edit_row_gate", () => { if (state.controls.localFailEventAt && --state.controls.localFailEventAt === 0) throw Error("injected_mid_transaction_failure"); return 1; });
  state.sqlite.exec("CREATE TRIGGER local_quick_edit_failure BEFORE INSERT ON event_write_stage WHEN NEW.client_id='web:context-approval' BEGIN SELECT local_quick_edit_row_gate(); END");
  const nativeDepth=enforceD1ExpressionDepth(state);
  const quick = async (request, identity = headers) => {
    const measuredResult = await measured(() => state.request("/api/workspace/quick-edit", json({ ...scope, ...request }, identity)));
    metrics.push({ mode, action: request.action, status: measuredResult.result.status, ...measuredResult.metrics });
    return measuredResult.result;
  };
  return { ...state, ownerId, stream, headers, seed, quick,
    async close() { try { await state.drainBackground(); nativeDepth.assertVerified(); } finally { nativeDepth.restore(); state.sqlite.close(); } } };
}
const preview = async (state, request = intent()) => (await body(await state.quick(request))).preview;
const count = state => ({
  events: state.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE stream_id=?").get(state.stream).n,
  privateEvents: state.sqlite.prepare("SELECT COUNT(*) AS n FROM event_private_payloads").get().n,
  receipts: state.sqlite.prepare("SELECT COUNT(*) AS n FROM authoring_commits").get().n,
  scopes: state.sqlite.prepare("SELECT COUNT(*) AS n FROM project_event_scopes").get().n,
  resources: state.sqlite.prepare("SELECT COUNT(*) AS n FROM project_resource_scopes WHERE resource_kind!='content'").get().n,
  purchases: state.sqlite.prepare("SELECT COUNT(*) AS n FROM cost_budget_reservations").get().n,
});
const projection = async state => model.foldEvents(await runtime.readEvents(state.env, state.stream), Infinity, scope.documentId, scope.projectId);

for (const mode of ["personal", "migrated", "shared", "editor"]) test("free workspace atomic protocol: " + mode + " creates one exact change without model or budget eligibility", async () => {
  const state = await fixture(mode);
  try {
    state.env.OPENAI_API_KEY = ""; state.env.FORMA_ASSISTANT_ALLOWED_MODELS = "none";
    const before = count(state), requested = intent(), proposed = await preview(state, requested);
    assert.deepEqual(count(state), before, "Free preview has no creative or financial effects");
    assert.equal(proposed.localReview.prompt, requested.prompt); assert.equal(proposed.localReview.origin, "rule-based");
    assert.equal(proposed.localReview.providerCalls, 0); assert.equal(proposed.events.length, 2);
    const applied = await body(await state.quick(confirm(proposed)));
    assert.equal(applied.status, "applied"); assert.equal(applied.operationId, requested.operationId);
    assert.equal(count(state).events - before.events, 2); assert.equal(count(state).privateEvents - before.privateEvents, 2); assert.equal(count(state).receipts - before.receipts, 1);
    assert.equal(count(state).purchases, before.purchases);
    const written = (await runtime.readEvents(state.env, state.stream)).filter(event => event.clientId === "web:context-approval");
    assert.deepEqual(written.map(event => event.type), ["ProposalAccepted", "BlockCreated"]);
    assert.ok(written.every(event => event.actor === "user:" + (mode === "editor" ? "assistant-viewer" : state.ownerId)));
    const after = count(state);
    for (const request of [confirm(proposed), confirm(proposed, "retrieve"), { action: "resume", operationId: requested.operationId }, requested]) {
      const repeated = await body(await state.quick(request)); assert.equal(repeated.status, "applied"); assert.equal(repeated.previewId, proposed.previewId);
    }
    assert.deepEqual(count(state), after, "Every retry/recovery is the same canonical receipt");
  } finally { await state.close(); }
});

test("free workspace explicit target changes only the chosen palette and requires new preview after real edits", async () => {
  const state = await fixture();
  try {
    const requested = intent({ prompt: "make warmer", targetBlockId: "local-palette-b" }), proposed = await preview(state, requested);
    assert.equal(proposed.events[1].payload.block_id, "local-palette-b");
    await state.seed([["BlockPropertyEdited", { document_id: scope.documentId, block_id: "local-palette-b", property_path: "temperature", old_value: "neutral", new_value: "cooler" }]]);
    const before = count(state), stale = await body(await state.quick(confirm(proposed)), 409);
    assert.equal(stale.status, "not-applied"); assert.deepEqual(count(state), before);
    const recovered = await body(await state.quick(requested)); assert.equal(recovered.preview.previewId, proposed.previewId); assert.equal(recovered.stale, true);
    const fresh = await preview(state, { ...requested, operationId: crypto.randomUUID() });
    assert.equal(fresh.events[1].payload.old_value, "cooler"); await body(await state.quick(confirm(fresh)));
    const current = await projection(state);
    assert.equal(current.blocks.find(block => block.id === "local-palette-a").properties.temperature, "neutral");
    assert.equal(current.blocks.find(block => block.id === "local-palette-b").properties.temperature, "warmer");
    assert.equal(count(state).receipts, 1);
  } finally { await state.close(); }
});

for (const mode of ["personal", "shared", "editor"]) for (const fault of ["second-event", "receipt", "erased-source", "locked-source", "expired-preview"]) test("free workspace atomic rollback: " + mode + "/" + fault, async () => {
  const state = await fixture(mode);
  try {
    const proposed = await preview(state, intent({ prompt: "make warmer", targetBlockId: "local-palette-b" })), before = count(state);
    if (fault === "second-event") state.controls.localFailEventAt = 2;
    if (fault === "receipt") state.controls.failAuthoringCommit = true;
    if (fault === "erased-source") state.controls.beforeAuthoringCommit = () => state.sqlite.prepare("UPDATE event_private_payloads SET private_json='',redacted_at=? WHERE private_event_id=(SELECT event_id FROM events WHERE stream_id=? AND type='BlockCreated' AND json_extract(payload,'$.block_id')='local-palette-b')").run(new Date().toISOString(), state.stream);
    if (fault === "locked-source") await state.seed([["BlockLocked", { document_id: scope.documentId, block_id: "local-palette-b" }]]);
    if (fault === "expired-preview") state.controls.beforeAuthoringCommit = () => state.sqlite.prepare("UPDATE private_content SET expires_at='2000-01-01T00:00:00.000Z' WHERE content_id=?").run(proposed.previewId);
    const expected = fault === "locked-source" ? count(state) : before;
    const rejected = await body(await state.quick(confirm(proposed)), 409); assert.equal(rejected.status, "not-applied"); assert.deepEqual(count(state), expected);
    if(["erased-source","expired-preview"].includes(fault))assert.match(state.controls.lastDatabaseError,/CHECK constraint failed/u);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE client_id='web:context-approval'").get().n, 0, "No acceptance, mutation or ValidationFailed escapes rollback");
  } finally { await state.close(); }
});

test("free workspace simultaneous preview/confirmation and a missing DB response retain exactly one canonical receipt", async () => {
  const state = await fixture("shared");
  try {
    const requested = intent(), results = await Promise.all([state.quick(requested), state.quick(requested)]), bodies = await Promise.all(results.map(result => body(result)));
    assert.equal(bodies[0].preview.previewId, bodies[1].preview.previewId);
    const proposed = bodies[0].preview;
    const originalBatch = state.env.DB.batch.bind(state.env.DB);
    let lost = false;
    state.env.DB.batch = async statements => { const result = await originalBatch(statements); if (!lost && statements.some(statement => /^\s*INSERT INTO authoring_commits/iu.test(statement.sql))) { lost = true; throw Error("lost committed batch response"); } return result; };
    const applied = await Promise.all([state.quick(confirm(proposed)), state.quick(confirm(proposed))]);
    for (const response of applied) { const result = await response.json(); assert.ok([200, 202].includes(response.status), JSON.stringify(result)); }
    const saved = await body(await state.quick(confirm(proposed, "retrieve"))); assert.equal(saved.status, "applied");
    assert.equal(count(state).receipts, 1); assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE client_id='web:context-approval'").get().n, 2);
  } finally { await state.close(); }
});

test("free workspace rejects client event forgery, target/source mismatch and changed intent for the same operation", async () => {
  const state = await fixture();
  try {
    const requested = intent({ prompt: "make warmer", targetBlockId: "local-palette-b" }), proposed = await preview(state, requested), before = count(state);
    for (const mutation of [{ prompt: "make cooler" }, { targetBlockId: "local-palette-a" }]) {
      const result = await body(await state.quick({ ...requested, ...mutation }), 409); assert.equal(result.error, "workspace_quick_edit_operation_conflict");
    }
    await body(await state.quick({ ...intent(), events: proposed.events }), 400);
    await body(await state.quick(intent({ prompt: "make warmer" })), 409);
    await body(await state.quick(intent({ prompt: "make warmer", targetBlockId: "target-from-another-document" })), 409);
    await body(await state.quick({ ...confirm(proposed), approvalHash: "b".repeat(64) }), 403);
    assert.deepEqual(count(state), before);
  } finally { await state.close(); }
});

test("free workspace retrieval does not release leases; expired lease retry requires explicit acceptance", async () => {
  const state = await fixture();
  try {
    const proposed = await preview(state);
    state.sqlite.prepare("UPDATE private_content SET content=json_set(content,'$.state','applying','$.leaseId','old-lease','$.leaseExpiresAt','2000-01-01T00:00:00.000Z') WHERE content_id=?").run(proposed.previewId);
    const before = count(state), privateBefore = state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(proposed.previewId).content;
    for (const request of [confirm(proposed, "retrieve"), { action: "resume" }]) { const result = await body(await state.quick(request)); assert.equal(result.status, "not-applied"); assert.equal(result.retryable,true); }
    assert.equal(state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(proposed.previewId).content, privateBefore); assert.deepEqual(count(state), before);
    const applied = await body(await state.quick(confirm(proposed))); assert.equal(applied.status, "applied"); assert.equal(count(state).receipts, 1);
  } finally { await state.close(); }
});

test("free workspace receipt survives private erasure, model/budget closure, read-only downgrade and dismissal", async () => {
  const state = await fixture("editor");
  try {
    const requested = intent(), proposed = await preview(state, requested); await body(await state.quick(confirm(proposed)));
    state.sqlite.prepare("UPDATE private_content SET content='',redacted_at=? WHERE content_id=?").run(new Date().toISOString(), proposed.previewId);
    state.sqlite.prepare("UPDATE project_memberships SET role='viewer' WHERE user_id='assistant-viewer'").run();
    const selected = await state.request("/api/workspaces/" + state.organizationId + "/projects/" + state.projectAccessId + "/context", { method: "POST", headers: Object.fromEntries(Object.entries(state.viewer).filter(([key])=>key!=="cookie")) });
    assert.equal(selected.status,200,JSON.stringify(await selected.clone().json()));
    const headers = { ...state.viewer, cookie: selected.headers.get("set-cookie").split(";")[0] };
    const before = count(state);
    const saved = await body(await state.quick({ action: "resume" }, headers));
    assert.equal(saved.status, "applied"); assert.equal(saved.previewId, proposed.previewId); assert.equal(saved.approvalHash, proposed.approvalHash); assert.equal(saved.preview, undefined);
    await body(await state.quick(intent(), headers), 403);
    assert.deepEqual(count(state), before);
    await body(await state.quick(confirm(proposed, "dismiss"), headers));
    assert.equal((await body(await state.quick({ action: "resume" }, headers))).status, "none");
    assert.equal((await body(await state.quick(confirm(proposed, "retrieve"), headers))).status, "applied");
    assert.deepEqual(count(state), before);
  } finally { await state.close(); }
});

for (const change of ["source-rights", "document-removed", "principal-revoked", "session-expired", "resource-custody", "private-owner"]) test("free workspace final guard rejects current " + change + " with zero partial writes", async () => {
  const state = await fixture("editor");
  try {
    const proposed = await preview(state), before = count(state);
    if (change === "source-rights") await state.seed([["BlockPropertyEdited", { document_id: scope.documentId, block_id: "local-palette-a", property_path: "rights_revoked", old_value: null, new_value: true }]]);
    if (change === "document-removed") await state.seed([["DocumentRemoved", { document_id: scope.documentId }]]);
    if (change === "principal-revoked") state.controls.beforeAuthoringCommit = () => state.sqlite.prepare("UPDATE project_memberships SET status='revoked' WHERE user_id='assistant-viewer'").run();
    if (change === "session-expired") state.controls.beforeAuthoringCommit = () => state.sqlite.prepare("UPDATE project_context_sessions SET expires_at='2000-01-01T00:00:00.000Z' WHERE principal_user_id='assistant-viewer'").run();
    if (change === "resource-custody") state.controls.beforeAuthoringCommit = () => state.sqlite.prepare("UPDATE project_resource_scopes SET visibility='private' WHERE resource_id='local-palette-a'").run();
    if (change === "private-owner") state.controls.beforeAuthoringCommit = () => state.sqlite.prepare("UPDATE event_private_payloads SET owner_id='wrong-owner' WHERE private_event_id=(SELECT event_id FROM events WHERE stream_id=? AND type='BlockCreated' AND json_extract(payload,'$.block_id')='local-palette-a')").run(state.stream);
    const expected = ["source-rights", "document-removed"].includes(change) ? count(state) : before;
    const result = await state.quick(confirm(proposed)); assert.equal(result.ok, false, JSON.stringify(await result.clone().json()));
    assert.deepEqual(count(state), expected);
    if(!["source-rights","document-removed"].includes(change))assert.match(state.controls.lastDatabaseError,/CHECK constraint failed/u);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE client_id='web:context-approval'").get().n, 0);
  } finally { await state.close(); }
});


for(const mode of["personal","migrated","shared","editor"])test("free workspace precise palette mutation is atomic for "+mode,async()=>{
  const state=await fixture(mode);
  try{
    const proposed=await preview(state,intent({prompt:"make warmer",targetBlockId:"local-palette-b"})),before=count(state);
    const result=await body(await state.quick(confirm(proposed)));assert.equal(result.status,"applied");
    const current=await projection(state);assert.equal(current.blocks.find(block=>block.id==="local-palette-a").properties.temperature,"neutral");
    assert.equal(current.blocks.find(block=>block.id==="local-palette-b").properties.temperature,"warmer");assert.equal(count(state).events-before.events,2);
  }finally{await state.close();}
});


async function governedFixture(mode="different-owner"){
  const state=await fixture("shared"),later=new Date(Date.now()+300_000).toISOString();
  let upstream;
  if(mode==="same-project"){
    await seedAdaptiveRightsDeadline(state,"governed-upstream",later,later);
    upstream={sourceOwner:state.ownerId,sourceStream:state.stream,sourceProjectId:scope.projectId,sourceProjectAccessId:state.projectAccessId,
      sourceDocumentId:"adaptive-rights-origin",sourceBlockId:"adaptive-rights-upstream",versionId:"adaptive-rights-version"};
  }else upstream=await seedAdaptiveSeparateProjectGoverned(state,{sameOwner:mode==="same-owner"});
  const head=Number(state.sqlite.prepare("SELECT COALESCE(MAX(sequence),0) AS n FROM events WHERE stream_id=?").get(upstream.sourceStream).n);
  const edited=runtime.makeEvent(upstream.sourceStream,head+1,"user:"+upstream.sourceOwner,"local-fixture",crypto.randomUUID(),"BlockPropertyEdited",{
    project_id:upstream.sourceProjectId,document_id:upstream.sourceDocumentId,block_id:upstream.sourceBlockId,property_path:"text",
    old_value:"Original upstream licensed material.",new_value:"PRIVATE_GOVERNED_NATIVE_SOURCE"});
  await state.env.DB.batch([runtime.insertEvent(state.env,edited)]);upstream.privateEventId=edited.eventId;
  await synchronizeProjectScope(state.env,{organizationId:state.organizationId,projectAccessId:upstream.sourceProjectAccessId,projectId:upstream.sourceProjectId,ownerUserId:upstream.sourceOwner});
  await synchronizeProjectScope(state.env,{organizationId:state.organizationId,projectAccessId:state.projectAccessId,projectId:scope.projectId,ownerUserId:state.ownerId});
  return{...state,upstream};
}
for(const mode of["same-project","same-owner","different-owner"])test("free workspace governed source "+mode+" retains exact dependency without own-write false conflict",async()=>{
  const state=await governedFixture(mode);
  try{
    const proposed=await preview(state),before=count(state);
    assert.doesNotMatch(JSON.stringify(proposed),/PRIVATE_GOVERNED_NATIVE_SOURCE|dispatchDependencies|private_owner/u);
    assert.equal((await body(await state.quick(confirm(proposed)))).status,"applied");
    assert.equal(count(state).events-before.events,2);assert.equal(count(state).receipts-before.receipts,1);
    assert.equal(count(state).purchases,before.purchases);
  }finally{await state.close();}
});
for(const change of["private-erased","private-changed","private-owner","event-custody","source-resource","source-owner","package-erased"])test("free workspace governed "+change+" at final receipt rolls back with unchanged upstream head",async()=>{
  const state=await governedFixture(),up=state.upstream;
  try{
    const proposed=await preview(state),before=count(state);let boundary=0,mutated=0;
    state.controls.beforeAuthoringCommit=()=>{
      boundary++;const head=state.sqlite.prepare("SELECT MAX(sequence) AS n FROM events WHERE stream_id=?").get(up.sourceStream).n;
      if(change==="private-erased")mutated=state.sqlite.prepare("UPDATE event_private_payloads SET private_json='',redacted_at=? WHERE private_event_id=?").run(new Date().toISOString(),up.privateEventId).changes;
      if(change==="private-changed")mutated=state.sqlite.prepare("UPDATE event_private_payloads SET private_json=json_set(private_json,'$.new_value','CHANGED_WITHOUT_HEAD') WHERE private_event_id=?").run(up.privateEventId).changes;
      if(change==="private-owner")mutated=state.sqlite.prepare("UPDATE event_private_payloads SET owner_id='wrong-owner' WHERE private_event_id=?").run(up.privateEventId).changes;
      if(change==="event-custody")mutated=state.sqlite.prepare("DELETE FROM project_event_scopes WHERE event_id=?").run(up.privateEventId).changes;
      if(change==="source-resource")mutated=state.sqlite.prepare("UPDATE project_resource_scopes SET visibility='restricted' WHERE project_access_id=? AND resource_kind='block' AND resource_id=?").run(up.sourceProjectAccessId,up.sourceBlockId).changes;
      if(change==="source-owner")mutated=state.sqlite.prepare("UPDATE organization_memberships SET status='revoked',revoked_at=? WHERE organization_id=? AND user_id=?").run(new Date().toISOString(),state.organizationId,up.sourceOwner).changes;
      if(change==="package-erased")mutated=state.sqlite.prepare("UPDATE organization_context_package_contents SET redacted_at=? WHERE version_id=?").run(new Date().toISOString(),up.versionId).changes;
      assert.equal(state.sqlite.prepare("SELECT MAX(sequence) AS n FROM events WHERE stream_id=?").get(up.sourceStream).n,head);
    };
    await body(await state.quick(confirm(proposed)),409);assert.equal(boundary,1);assert.ok(mutated>0);
    assert.match(state.controls.lastDatabaseError,/CHECK constraint failed/u);assert.deepEqual(count(state),before);
  }finally{await state.close();}
});
test("free workspace original native rights expiry is checked at SQLite mutation time",async()=>{
  const state=await fixture(),deadline=new Date(Date.now()+30_000).toISOString();let clock;
  try{
    await state.seed([["BlockPropertyEdited",{document_id:scope.documentId,block_id:"local-palette-b",property_path:"license_expires_at",old_value:null,new_value:deadline}]]);
    const proposed=await preview(state,intent({prompt:"make warmer",targetBlockId:"local-palette-b"})),before=count(state);
    assert.equal(proposed.expiresAt,deadline);clock=consequentialDbClock(state);
    state.controls.beforeAuthoringCommit=()=>clock.set(new Date(Date.parse(deadline)+1).toISOString());
    await body(await state.quick(confirm(proposed)),409);assert.match(state.controls.lastDatabaseError,/CHECK constraint failed/u);assert.deepEqual(count(state),before);
  }finally{clock?.close();await state.close();}
});


test("free workspace DB lease boundary: before expiry remains uncertain, after expiry is read-only retryable and dismissible",async()=>{
  const state=await fixture();let clock;
  try{
    const proposed=await preview(state),expires=new Date(Date.now()+30_000).toISOString();
    state.sqlite.prepare("UPDATE private_content SET content=json_set(content,'$.state','applying','$.leaseId','paused-worker','$.leaseExpiresAt',?) WHERE content_id=?").run(expires,proposed.previewId);
    clock=consequentialDbClock(state);const before=count(state),saved=state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(proposed.previewId).content;
    clock.set(new Date(Date.parse(expires)-1).toISOString());
    const active=await body(await state.quick(confirm(proposed,"retrieve")));assert.equal(active.status,"applying");assert.equal(active.retryable,false);
    clock.set(expires);
    const expired=await body(await state.quick(confirm(proposed,"retrieve")));assert.equal(expired.status,"not-applied");assert.equal(expired.retryable,true);
    assert.equal(state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(proposed.previewId).content,saved);assert.deepEqual(count(state),before);
    await body(await state.quick(confirm(proposed,"dismiss")));assert.equal((await body(await state.quick({action:"resume"}))).status,"none");assert.deepEqual(count(state),before);
  }finally{clock?.close();await state.close();}
});
for(const winner of["retry","dismiss"])test("free workspace expired late worker cannot overwrite the explicit "+winner+" winner",async()=>{
  const state=await fixture("shared"),entered=Promise.withResolvers(),released=Promise.withResolvers();let late;
  try{
    const proposed=await preview(state),before=count(state);
    state.controls.afterAuthoringClaim=async()=>{
      state.sqlite.prepare("UPDATE private_content SET content=json_set(content,'$.leaseExpiresAt','2000-01-01T00:00:00.000Z') WHERE content_id=?").run(proposed.previewId);
      entered.resolve();await released.promise;
    };
    late=state.quick(confirm(proposed));await entered.promise;
    const checked=await body(await state.quick(confirm(proposed,"retrieve")));assert.equal(checked.retryable,true);assert.equal(checked.status,"not-applied");assert.deepEqual(count(state),before);
    const won=await body(await state.quick(confirm(proposed,winner==="retry"?"apply":"dismiss")));
    assert.equal(won.status,winner==="retry"?"applied":"dismissed");released.resolve();
    const old=await late;assert.ok([200,409].includes(old.status),JSON.stringify(await old.clone().json()));
    assert.equal(count(state).events-before.events,winner==="retry"?2:0);assert.equal(count(state).receipts-before.receipts,winner==="retry"?1:0);
    const exact=await body(await state.quick(confirm(proposed,"retrieve")));
    assert.equal(exact.status,winner==="retry"?"applied":"not-applied");if(winner==="dismiss")assert.equal(exact.dismissed,true);
  }finally{released.resolve();await late;await state.close();}
});
test("free workspace read-only expired lease certification cannot ignore a winner that commits after its first SQL snapshot",async()=>{
  const state=await fixture("shared");
  try{
    const proposed=await preview(state);
    state.sqlite.prepare("UPDATE private_content SET content=json_set(content,'$.state','applying','$.leaseId','old','$.leaseExpiresAt','2000-01-01T00:00:00.000Z') WHERE content_id=?").run(proposed.previewId);
    let winner;
    state.controls.afterAuthoringPreviewRead=async()=>{winner=await body(await state.quick(confirm(proposed)));};
    const checked=await body(await state.quick(confirm(proposed,"retrieve")));assert.equal(winner.status,"applied");
    assert.notEqual(checked.retryable,true,"The final existing read query recertifies receipt absence and the identical expired lease");
    assert.equal((await body(await state.quick(confirm(proposed,"retrieve")))).status,"applied");assert.equal(count(state).receipts,1);
  }finally{await state.close();}
});

test.after(() => {
  const groups = new Map();
  for (const row of metrics) { const key = row.mode + "/" + row.action, previous = groups.get(key) ?? { path: key, queries: 0, binds: 0, bytes: 0 };
    for (const field of ["queries", "binds", "bytes"]) previous[field] = Math.max(previous[field], row[field]); groups.set(key, previous); }
  for (const row of groups.values()) { assert.ok(row.queries <= 1000); assert.ok(row.binds <= 100); assert.ok(row.bytes <= 100000); console.log("WORKSPACE_LOCAL_D1 " + JSON.stringify(row)); }
});

const [main170FreeRequirements, main170FreeOutputPlan, main170FreeGuards, main170FreeConsent] = await Promise.all([
  import("../src/model/output-requirements.ts"), import("../src/model/output-plan.ts"), import("../worker/output-requirement-event-guards.ts"),
  import("../worker/consequential-consent.ts"),
]);
async function main170FreeOutput(state) {
  const guarded = main170FreeGuards.prepareOutputRequirementClientEvents([{ type: "BlockCreated", payload: {
    project_id: scope.projectId, document_id: scope.documentId, block_id: "free-current-output", scope: "document", type: "output",
    handle: "output/current", position: "z-output", properties: { text: "One executive summary presentation.", subtype: "Executive summary", authority: "authored" },
  } }], []);
  assert.equal(guarded.ok, true);
  await state.seed(guarded.events.map((event) => [event.type, event.payload]));
}
async function main170FreeLedger(state) {
  const spec = main170FreeRequirements.parseOutputRequirement({ id: "free-ledger-only", type: "output", subtype: "Executive summary",
    content: "1 slideshow with 5-15 slides, one podcast episode, and a series of videos outlining the document." }).spec;
  spec.deliverables = [spec.deliverables[0]]; spec.deliverables[0].quantity = { kind: "exact", unit: "presentation", value: 1000 };
  assert.equal(main170FreeRequirements.inspectOutputRequirement(spec).status, "valid");
  const plan = main170FreeOutputPlan.compileOutputPlan([spec], { document_id: scope.documentId, source_revision: "a".repeat(64), requirement_revision: "b".repeat(64),
    count_policies: { [spec.deliverables[0].id]: { kind: "exact", unit: "slide", value: 5 } }, max_targets: 1000 });
  assert.equal(plan.issues.length, 0); assert.equal(plan.targets.length, 1000); assert.equal(plan.unresolved_groups.length, 0);
  assert.ok(plan.targets.every((target) => target.blocking_issues.length === 0));
  await state.seed([["OutputPlanConfirmed", { document_id: scope.documentId, plan_revision_id: "free-ledger-only",
    confirmed_plan: { id: scope.documentId, revisionId: "free-ledger-only", revision: 1, confirmedAt: new Date().toISOString(),
      requirementsDigest: "b".repeat(64), sourceDigest: "a".repeat(64), plan,
      targetContractDigests: Object.fromEntries(plan.targets.map((target) => [target.id, "c".repeat(64)])), confirmationOptions: {} } }]]);
  const row = state.sqlite.prepare("SELECT event.event_id,secret.private_json FROM events event JOIN event_private_payloads secret ON secret.private_event_id=event.event_id WHERE event.stream_id=? AND event.type='OutputPlanConfirmed' ORDER BY event.sequence DESC LIMIT 1").get(state.stream);
  assert.ok(Buffer.byteLength(row.private_json, "utf8") > 1_000_000); return row.event_id;
}
for (const mode of ["personal", "migrated", "shared", "editor"])
test("main170 FREE exact approval and receipt preserve document-only grammar beside native Output: " + mode, async () => {
  const state = await fixture(mode);
  try {
    await main170FreeOutput(state);
    const before = count(state), request = intent(), proposed = await preview(state, request);
    const retained = JSON.parse(state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(proposed.previewId).content), approvedBytes = JSON.stringify(retained.plan);
    assert.equal(await main170FreeConsent.consentHash(retained.plan), proposed.approvalHash);
    assert.equal(proposed.localReview.origin, "rule-based"); assert.equal(proposed.localReview.providerCalls, 0);
    assert.deepEqual(proposed.events.map((event) => event.type), ["ProposalAccepted", "BlockCreated"]);
    assert.ok(proposed.events.every((event) => !event.payload.canvas_id && !Object.hasOwn(event.payload, "history_owner_id")));
    assert.equal(proposed.events[1].payload.type, "direction"); assert.deepEqual(count(state), before);
    const refused = await body(await state.quick({ ...request, canvasId: "not-a-free-target" }), 400);
    assert.equal(refused.error, "workspace_quick_edit_invalid_request"); assert.deepEqual(count(state), before);
    const applied = await body(await state.quick(confirm(proposed)));
    assert.equal(applied.status, "applied"); assert.equal(count(state).events - before.events, 2);
    const written = (await runtime.readEvents(state.env, state.stream)).filter((event) => event.clientId === "web:context-approval");
    assert.equal(JSON.stringify(written.map((event) => ({ type: event.type, payload: event.payload }))), JSON.stringify(proposed.events));
    assert.ok(written.every((event) => event.actor === "user:" + (mode === "editor" ? "assistant-viewer" : state.ownerId)));
    const after = JSON.parse(state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(proposed.previewId).content);
    assert.equal(JSON.stringify(after.plan), approvedBytes); assert.equal(after.approvalHash, proposed.approvalHash);
    assert.equal((await projection(state)).blocks.find((block) => block.id === "free-current-output").type, "output");
    const frozen = count(state);
    state.sqlite.prepare("UPDATE private_content SET content='',redacted_at=? WHERE content_id=?").run(new Date().toISOString(), proposed.previewId);
    for (const action of ["retrieve", "apply"]) {
      const receipt = await body(await state.quick(confirm(proposed, action)));
      assert.equal(receipt.status, "applied"); assert.equal(receipt.approvalHash, proposed.approvalHash); assert.equal(receipt.previewId, proposed.previewId);
    }
    assert.deepEqual(count(state), frozen); assert.equal(count(state).purchases, before.purchases);
  } finally { await state.close(); }
});
for (const mode of ["personal", "migrated", "shared", "editor"])
test("main170 FREE explicit Output target returns native editor refusal without a first-palette fallback: " + mode, async () => {
  const state = await fixture(mode);
  try {
    await main170FreeOutput(state); const before = count(state), original = await projection(state);
    const response = await state.quick(intent({ prompt: "make warmer", targetBlockId: "free-current-output" })), refused = await body(response, 409);
    assert.equal(refused.error, "output_requirement_endpoint_required"); assert.equal(refused.status, "not-applied"); assert.equal(refused.blockId, "free-current-output");
    assert.equal(Object.hasOwn(refused, "message"), false); assert.deepEqual(count(state), before);
    assert.deepEqual((await projection(state)).blocks, original.blocks);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM private_content WHERE kind='authoring-preview'").get().n, 0);
  } finally { await state.close(); }
});
for (const mode of ["personal", "migrated", "shared"])
test("main170 FREE native proof excludes actual 1000-target nondependency ledger history: " + mode, async () => {
  const state = await fixture(mode);
  try {
    const original = await projection(state), ledgerId = await main170FreeLedger(state), afterLedger = await projection(state);
    assert.deepEqual(afterLedger.libraryBlocks, original.libraryBlocks); assert.deepEqual(afterLedger.documents, original.documents);
    const before = count(state), proposed = await preview(state);
    state.controls.afterAuthoringClaim = async () => {
      state.sqlite.prepare("UPDATE event_private_payloads SET private_json='',redacted_at=? WHERE private_event_id=?").run(new Date().toISOString(), ledgerId);
    };
    const applied = await body(await state.quick(confirm(proposed)));
    assert.equal(applied.status, "applied"); assert.equal(count(state).events - before.events, 2);
    assert.equal(count(state).receipts - before.receipts, 1); assert.equal(count(state).purchases, before.purchases);
    assert.equal(state.sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=?").get(ledgerId).private_json, "");
  } finally { await state.close(); }
});
