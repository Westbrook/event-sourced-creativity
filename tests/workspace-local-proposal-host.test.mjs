import assert from "node:assert/strict";
import test from "node:test";
import fs, { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import ts from "typescript";
import { WorkspaceLocalProposal } from "../src/components/workspace-local-proposal.ts";
import { buildWorkspaceQuickEditPlan, normalizeWorkspaceQuickEditIntent, validWorkspaceQuickEditEvents } from "../src/model/workspace-local-proposal.ts";
import { workspaceLocalProposalCopy } from "../src/components/design-system/localized-workspace-proposal.ts";
import { foldEvents, shortEventType } from "../src/model/events.ts";
import { retrieveFewShotExemplars } from "../src/model/indexing.ts";
import { documentIdFromRoute, documentViewFromRoute, routePathname } from "../src/model/routes.ts";
import { createCalmFullPage, calmFullPageNativePorts } from "./helpers/calm-full-page-fixture.mjs";
import { createSceneStoreHost } from "./helpers/scene-cost-store-host.mjs";
import { setTimeout as quickEditIdentitySetTimeout, clearTimeout as quickEditIdentityClearTimeout } from "node:timers";

// The existing isolated template checks now need the same real naming helper
// and locale controller as the complete Workspace. Their assertions stay intact.
const { contextControlName } = await calmFullPageNativePorts.loadActual("src/components/context-controls.ts");
const { provenanceActorMessage } = await calmFullPageNativePorts.loadActual("src/components/design-system/localization.ts");
function quickEditReviewLocale(locale) {
  const { FormaLocaleController, FORMA_DEFAULT_MESSAGES, localeCatalogs } = calmFullPageNativePorts;
  const messages = { ...FORMA_DEFAULT_MESSAGES, ...localeCatalogs[locale] };
  const i18n = new FormaLocaleController({ addController() {}, requestUpdate() {}, dispatchEvent(event) {
    event.callback({ locale, formatLocale: locale, direction: locale === "ar" ? "rtl" : "ltr", timeZone: "UTC", messages, revision: 1 }, () => {});
    return true;
  } });
  i18n.hostConnected();
  return i18n;
}
// The evaluated original template members close over these real fixture ports.
void { contextControlName, quickEditReviewLocale, provenanceActorMessage };

const source = readFileSync(new URL("../src/components/forma-workspace.ts", import.meta.url), "utf8");
const events = [
  ["ProjectCreated", { project_id: "p", name: "Project" }],
  ["DocumentCreated", { project_id: "p", document_id: "d", title: "Exact 文書" }],
  ["BlockCreated", { project_id: "p", document_id: "d", block_id: "palette-a", type: "palette", handle: "palette/a", properties: { label: "Palette A", temperature: "neutral" } }],
  ["BlockCreated", { project_id: "p", document_id: "d", block_id: "palette-b", type: "palette", handle: "palette/b", properties: { label: "Palette B", temperature: "neutral" } }],
].map(([type, payload], i) => ({ eventId: "e" + i, sequence: i + 1, streamId: "creative:owner", occurredAt: "", recordedAt: "", actor: "user:owner", clientId: "test", correlationId: "fixture", type, payload }));
const projection = () => foldEvents(events, Infinity, "d", "p");
const plan = (request) => buildWorkspaceQuickEditPlan({ projection: projection(), intent: normalizeWorkspaceQuickEditIntent(request), sourceHead: 4, createId: () => "new-decision" });
const makePreview = (request, id = "saved-preview") => { const value = plan(request); return { previewId: id, approvalHash: "a".repeat(64), projectId: "p", documentId: "d", canvasId: null, blockId: "", sourceHash: "source", localReview: value.review, changes: value.changes, events: value.events, blockCount: 1, relationCount: 0, expiresAt: new Date(Date.now() + 600_000).toISOString() }; };
const gate = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const turn = () => new Promise(setImmediate);
function fixture() {
  const calls = [], applied = [], scope = { key: "owner:epoch", projectId: "p", documentId: "d" };
  let active = scope, next = 0, refreshFails = false;
  const host = new WorkspaceLocalProposal({ scope: () => active, createId: () => "operation-" + String(++next).padStart(16, "0"),
    changed() {}, applied: async () => { applied.push(true); if (refreshFails) throw Error("refresh unavailable"); },
    request(body) { const pending = gate(); calls.push({ body, ...pending }); return pending.promise; } });
  return { host, calls, applied, setScope(next) { active = next; }, failRefresh() { refreshFails = true; },
    async reply(call, body, status = 200, afterJson = () => {}) { call.resolve({ ok: status >= 200 && status < 300, status, async json() { afterJson(); return body; } }); await turn(); } };
}
async function open(f, prompt = "  Preserve my exact decision 文書.\n", targetBlockId = null) {
  const pending = f.host.start(prompt, targetBlockId), call = f.calls.at(-1), preview = makePreview(call.body);
  await f.reply(call, { status: "not-applied", preview }); assert.equal(await pending, true); return preview;
}

test("free quick edit grammar requires an explicit exact palette and never mutates protected source evidence", () => {
  const intent = { operationId: "explicit-operation-1234", prompt: "make warmer", targetBlockId: null };
  assert.throws(() => plan(intent), /target_required/);
  const chosen = plan({ ...intent, targetBlockId: "palette-b" });
  assert.equal(chosen.events[1].payload.block_id, "palette-b"); assert.equal(chosen.events[1].payload.old_value, "neutral");
  assert.equal(validWorkspaceQuickEditEvents(chosen.events), true);
  assert.equal(validWorkspaceQuickEditEvents([...chosen.events, chosen.events[1]]), false);
  assert.equal(validWorkspaceQuickEditEvents([{ ...chosen.events[0], payload: { ...chosen.events[0].payload, arbitrary: "forged" } }, chosen.events[1]]), false);
  for (const change of [{ locked: true }, { properties: { source_evidence_hash: "immutable" } }, { properties: { rights_revoked: true } }, { properties: { organization_context_package_id: "governed" } }]) {
    const current = projection(), target = current.libraryBlocks.find(block => block.id === "palette-b");
    Object.assign(target, change);
    assert.throws(() => buildWorkspaceQuickEditPlan({ projection: current, intent: { ...intent, targetBlockId: "palette-b" }, sourceHead: 4 }), /protected/);
  }
  assert.throws(() => plan({ ...intent, targetBlockId: "palette-b", prompt: "warm and cool" }), /temperature_required/);
  assert.throws(() => plan({ ...intent, targetBlockId: "different-project" }), /target_unavailable/);
});

test("free quick edit preserves Unicode and authored intent without a model or invented palette colors", () => {
  for (const prompt of ["  除外しない 文書 🎨\n", "Avoid a noisy backdrop", "Palette for café"]) {
    const proposed = plan({ operationId: "literal-operation-1234", prompt, targetBlockId: null });
    assert.equal(proposed.review.prompt, prompt); assert.equal(proposed.review.origin, "rule-based"); assert.equal(proposed.review.providerCalls, 0);
    assert.equal(proposed.events[0].type, "ProposalAccepted"); assert.equal(proposed.events[1].type, "BlockCreated");
    assert.equal(proposed.events[1].payload.properties.text ?? proposed.events[1].payload.properties.label, prompt);
    assert.equal(proposed.events[1].payload.properties.authority, "authored"); assert.equal(validWorkspaceQuickEditEvents(proposed.events), true);
    if (proposed.events[1].payload.type === "palette") assert.deepEqual(proposed.events[1].payload.properties.colors, []);
  }
});

test("free workspace controller keeps the user draft and target while a lost preview is recovered read-only under its original operation", async () => {
  const f = fixture(), draft = "  make warmer\n", pending = f.host.start(draft, "palette-b"), call = f.calls[0];
  call.reject(Error("missing response")); assert.equal(await pending, true);
  assert.equal(f.host.value.draft, draft); assert.equal(f.host.value.targetBlockId, "palette-b"); assert.equal(f.host.value.uncertain, true);
  f.host.edit("replacement", null); await f.host.preview(true); await f.host.accept(); assert.equal(f.calls.length, 1);
  const check = f.host.check(), read = f.calls[1];
  assert.equal(read.body.action, "resume"); assert.equal(read.body.operationId, call.body.operationId); assert.equal(read.body.prompt, undefined);
  const preview = makePreview(call.body); await f.reply(read, { status: "not-applied", preview }); await check;
  assert.equal(f.host.value.preview.previewId, preview.previewId); assert.equal(f.host.value.draft, draft); assert.equal(f.host.value.uncertain, false);
});

test("free workspace lost acceptance only checks its exact receipt, never rebuilds or sends a second acceptance", async () => {
  const f = fixture(), preview = await open(f), original = f.calls[0].body, saving = f.host.accept(), apply = f.calls[1];
  assert.equal(apply.body.action, "apply"); assert.equal(apply.body.previewId, preview.previewId); assert.equal(apply.body.approvalHash, preview.approvalHash);
  assert.equal(await f.host.start("new draft", null), false);
  await f.host.accept(); assert.equal(f.calls.length, 2);
  apply.reject(Error("lost response")); await saving;
  assert.equal(f.host.value.draft, original.prompt); assert.equal(f.host.value.uncertain, true);
  await f.host.accept(); await f.host.preview(true); assert.equal(f.calls.length, 2);
  const checking = f.host.check(), read = f.calls[2];
  assert.deepEqual(read.body, { action: "retrieve", projectId: "p", documentId: "d", previewId: preview.previewId, approvalHash: preview.approvalHash });
  await f.reply(read, { status: "applied", previewId: preview.previewId, approvalHash: preview.approvalHash, operationId: original.operationId }); await checking;
  assert.equal(f.host.value.applied, true); assert.equal(f.applied.length, 1);
  await f.host.accept(); assert.equal(f.calls.length, 3);
  const done = f.host.dismiss(); await f.reply(f.calls[3], { status: "dismissed" }); await done;
  assert.equal(f.host.value, null);
});

test("free workspace stale source requires explicit fresh preview and retains the exact instruction", async () => {
  const f = fixture(), original = await open(f), first = f.calls[0].body, saving = f.host.accept();
  await f.reply(f.calls[1], { error: "authoring_preview_stale", status: "not-applied" }, 409); await saving;
  assert.equal(f.host.value.stale, true); assert.equal(f.host.value.draft, first.prompt);
  await f.host.accept(); assert.equal(f.calls.length, 2);
  const replacement = f.host.preview(true), request = f.calls[2];
  assert.equal(request.body.prompt, first.prompt); assert.notEqual(request.body.operationId, first.operationId);
  const next = makePreview(request.body, "new-preview"); await f.reply(request, { status: "not-applied", preview: next }); await replacement;
  assert.notEqual(f.host.value.preview.previewId, original.previewId); assert.equal(f.host.value.stale, false);
  assert.equal(f.calls.filter(call => call.body.action === "apply").length, 1, "Fresh preview never auto-accepts");
});

test("free workspace fences delayed HTTP and JSON across actor, permission and document changes", async () => {
  for (const afterJson of [false, true]) {
    const f = fixture(), pending = f.host.start("Literal draft", null), call = f.calls[0], preview = makePreview(call.body);
    if (!afterJson) f.setScope({ key: "different-user", projectId: "p", documentId: "d" });
    await f.reply(call, { status: "not-applied", preview }, 200, () => { if (afterJson) f.setScope({ key: "owner:new-epoch", projectId: "p", documentId: "other-document" }); });
    assert.equal(await pending, false); assert.equal(f.host.value, null); assert.equal(f.applied.length, 0);
  }
});

test("free workspace keeps applied certainty if event refresh fails and rejects malformed or non-confirming outcomes", async () => {
  const f = fixture(), preview = await open(f); f.failRefresh();
  const saving = f.host.accept(); await f.reply(f.calls[1], { status: "applied", previewId: preview.previewId, approvalHash: preview.approvalHash, operationId: f.calls[0].body.operationId }); await saving;
  assert.equal(f.host.value.applied, true); assert.equal(f.host.value.notice, "refresh"); await f.host.accept(); assert.equal(f.calls.length, 2);
  const malformed = fixture(); await open(malformed); const pending = malformed.host.accept(); await malformed.reply(malformed.calls[1], {}); await pending;
  assert.equal(malformed.host.value.uncertain, true);
});

test("free workspace readonly resume survives erased preview through receipt and hides uncertified recovered private text", async () => {
  const f = fixture(), request = { operationId: "server-operation-1234", prompt: "RETAINED_PRIVATE_DRAFT", targetBlockId: null }, preview = makePreview(request);
  const resuming = f.host.resume(); assert.equal(f.calls[0].body.action, "resume"); await f.reply(f.calls[0], { status: "not-applied", preview }); await resuming;
  assert.equal(f.host.value.draft, request.prompt); assert.equal(f.host.value.authoredDraft, false);
  const unavailable = f.host.check(); await f.reply(f.calls[1], { error: "authoring_preview_unavailable" }, 403); await unavailable;
  assert.equal(f.host.value.preview, null); assert.equal(f.host.value.draft, ""); assert.equal(f.host.value.intent.prompt, ""); assert.equal(f.host.value.uncertain, true);
  const recovering = f.host.check(); await f.reply(f.calls[2], { status: "applied", previewId: preview.previewId, approvalHash: preview.approvalHash, operationId: request.operationId }); await recovering;
  assert.equal(f.host.value.applied, true); assert.equal(f.host.value.preview, null);
});

test("actual workspace entry point chooses only focused palette and uses server-owned acceptance; localized review controls are rendered", async () => {
  const syntax = ts.createSourceFile("forma-workspace.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const owner = syntax.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "FormaWorkspace");
  const member = name => { const found = owner.members.find(node => node.name?.getText(syntax) === name); assert.ok(found, name); return found.getText(syntax); };
  assert.doesNotMatch(member("#acceptProposal"), /appendBatch|store\.propose/);
  const calls = [], store = { session: { get: () => ({ capabilities: ["project.author"] }) }, projection: { get: projection }, ui: { focusBlockId: "palette-b" } };
  const workspaceQuickEditNeedsTarget = prompt => /\b(?:warm(?:er)?|cool(?:er)?|temperature)\b/iu.test(prompt);
  assert.equal(workspaceQuickEditNeedsTarget("make warmer"),true);
  const Entry = eval(stripTypeScriptTypes("(class {store=store;#asking=false;#prompt='make warmer';#localProposal={start:(...args)=>{calls.push(args);return true;}};run(){return this.#suggestQuickAction();}" + member("#suggestQuickAction") + "})"));
  await new Entry().run(); assert.deepEqual(calls, [["make warmer", "palette-b"]]);
  store.ui.focusBlockId = "not-a-palette"; await new Entry().run(); assert.equal(calls[1][1], null);
  for (const locale of ["en", "fr", "ar", "ja"]) {
    const f = fixture(); await open(f, "make warmer", "palette-b");
    const handlers = [], nothing = Symbol("nothing"), stringify = value => value === nothing ? "" : Array.isArray(value) ? value.map(stringify).join("") : typeof value === "function" ? "handler:" + (handlers.push(value) - 1) : String(value ?? "");
    const html = (strings, ...values) => strings.reduce((text, part, index) => text + part + (index < values.length ? stringify(values[index]) : ""), "");
    void html; // Evaluated production template closes over this rendering port.
    const Review = eval(stripTypeScriptTypes("(class {store=store;i18n=quickEditReviewLocale(locale);#localProposal=f.host;#quickEditReferenceInspection=null;get #proposal(){return this.#localProposal.value;}#editQuickEdit(){}#acceptProposal(){}#rejectProposal(){}render(){return this.#proposalPreview();}" + member("#proposalPreview") + "})"));
    const rendered = new Review().render(), copy = workspaceLocalProposalCopy(locale);
    assert.ok(rendered.includes(copy.free)); assert.ok(rendered.includes(copy.accept)); assert.ok(rendered.includes(copy.chooseTarget)); assert.match(rendered, /value=palette-b/);
    assert.ok(rendered.includes("make warmer")); assert.doesNotMatch(rendered, /forma-chat|provider receipt|Append batch/);
  }
});

test("free workspace certified expired authoring lease enables only explicit same-approval retry",async()=>{
  const f=fixture(),preview=await open(f),operationId=f.calls[0].body.operationId,saving=f.host.accept();
  f.calls[1].reject(Error("lost writer"));await saving;
  const checking=f.host.check();await f.reply(f.calls[2],{status:"not-applied",preview,retryable:true});await checking;
  assert.equal(f.host.value.uncertain,false);assert.equal(f.host.value.notice,"retryable");assert.equal(f.calls.length,3);
  const retry=f.host.accept();assert.deepEqual(f.calls[3].body,{action:"apply",projectId:"p",documentId:"d",previewId:preview.previewId,approvalHash:preview.approvalHash});
  await f.reply(f.calls[3],{status:"applied",previewId:preview.previewId,approvalHash:preview.approvalHash,operationId});await retry;
  assert.equal(f.host.value.applied,true);
});

for(const ending of["resolve","reject"])test("PREFLIGHT free late A refresh "+ending+" cannot alter new B",async()=>{
 const calls=[],refresh=gate();let active={key:"authority-a",projectId:"p",documentId:"d"},next=0;
 const host=new WorkspaceLocalProposal({scope:()=>active,createId:()=>"preflight-operation-"+(++next),changed(){},applied:()=>refresh.promise,request(body){const pending=gate();calls.push({body,...pending});return pending.promise;}});
 const starting=host.start("A own draft",null),preview=makePreview(calls[0].body);calls[0].resolve(Response.json({status:"not-applied",preview}));await starting;
 const applying=host.accept();calls[1].resolve(Response.json({status:"applied",previewId:preview.previewId,approvalHash:preview.approvalHash,operationId:calls[0].body.operationId}));await turn();assert.equal(host.value.applied,true);
 active={key:"authority-b",projectId:"p",documentId:"d-b"};await host.start("make warmer B",null);const before=JSON.stringify(host.value);
 if(ending==="resolve")refresh.resolve();else refresh.reject(Error("A refresh failed"));await applying;assert.equal(JSON.stringify(host.value),before);assert.equal(calls.length,2);
});
for(const step of["headers","json"])test("PREFLIGHT free late A dismissal after "+step+" cannot clear B",async()=>{
 const f=fixture();await open(f);const dismissing=f.host.dismiss(),call=f.calls[1],body=gate();
 if(step==="json"){call.resolve({ok:true,status:200,json:()=>body.promise});await turn();}
 f.setScope({key:"authority-b",projectId:"p",documentId:"d-b"});await f.host.start("make warmer B",null);const before=JSON.stringify(f.host.value);
 if(step==="json")body.resolve({status:"dismissed"});else call.resolve(Response.json({status:"dismissed"}));await dismissing;assert.equal(JSON.stringify(f.host.value),before);
});
test("PREFLIGHT free actual host offers same-handle explicit retry after exact recovered review",async()=>{
 const f=fixture(),preview=await open(f),intent=f.calls[0].body,saving=f.host.accept();f.calls[1].reject(Error("lost Apply"));await saving;
 const checking=f.host.check();await f.reply(f.calls[2],{status:"not-applied",preview,retryable:true,stale:false});await checking;
 assert.equal(f.host.value.uncertain,false);assert.equal(f.host.value.notice,"retryable");assert.equal(f.calls.length,3);
 const syntax=ts.createSourceFile("forma-workspace.ts",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),owner=syntax.statements.find(node=>ts.isClassDeclaration(node)&&node.name?.text==="FormaWorkspace");
 const method=owner.members.find(node=>node.name?.getText(syntax)==="#acceptProposal").getText(syntax),Host=eval(stripTypeScriptTypes('(class {#localProposal=f.host;accept(){return this.#acceptProposal();}'+method+'})'));
 const retry=new Host().accept();assert.deepEqual(f.calls[3].body,{action:"apply",projectId:"p",documentId:"d",previewId:preview.previewId,approvalHash:preview.approvalHash});
 await f.reply(f.calls[3],{status:"applied",previewId:preview.previewId,approvalHash:preview.approvalHash,operationId:intent.operationId});await retry;
 assert.equal(f.host.value.applied,true);assert.equal(f.calls.filter(call=>call.body.action==="preview").length,1);
});
test("PREFLIGHT free proposal host has no queued native-close dismissal path",()=>{
 const syntax=ts.createSourceFile("forma-workspace.ts",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),owner=syntax.statements.find(node=>ts.isClassDeclaration(node)&&node.name?.text==="FormaWorkspace"),method=owner.members.find(node=>node.name?.getText(syntax)==="#proposalPreview").getText(syntax);
 assert.doesNotMatch(method,/<dialog|@close|@cancel/);assert.match(method,/<div class="proposal-preview"/);
});
for(const denied of[401,403,404,410])test("PREFLIGHT free denied "+denied+" unreadable read clears recovered private review before JSON",async()=>{
 const f=fixture(),request={operationId:"preflight-server-operation",prompt:"RETAINED_PRIVATE_PREFLIGHT_DRAFT",targetBlockId:null},preview=makePreview(request),resuming=f.host.resume();await f.reply(f.calls[0],{status:"not-applied",preview});await resuming;
 const checking=f.host.check(),body=gate();void body.promise.catch(()=>{});f.calls[1].resolve({ok:false,status:denied,json:()=>body.promise});await turn();
 const beforeJson={previewHidden:f.host.value.preview===null,draftHidden:f.host.value.draft==="",sameHandle:f.host.value.previewId===preview.previewId&&f.host.value.approvalHash===preview.approvalHash};
 body.reject(new SyntaxError("unreadable denial"));await checking;
 assert.deepEqual(beforeJson,{previewHidden:true,draftHidden:true,sameHandle:true},"Denial headers are already authoritative before its body can be parsed");
 assert.equal(f.host.value.preview,null);assert.equal(f.host.value.draft,"");assert.equal(f.host.value.intent.operationId,request.operationId);assert.equal(f.host.value.uncertain,true);
});

function renderPreflightFree(f){
 const syntax=ts.createSourceFile("forma-workspace.ts",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),owner=syntax.statements.find(node=>ts.isClassDeclaration(node)&&node.name?.text==="FormaWorkspace");
 const method=owner.members.find(node=>node.name?.getText(syntax)==="#proposalPreview").getText(syntax),store={session:{get:()=>({capabilities:["project.author"]})},projection:{get:projection}};
 const nothing=Symbol("nothing"),stringify=value=>value===nothing?"":Array.isArray(value)?value.map(stringify).join(""):typeof value==="function"?"handler":String(value??"");
 const html=(strings,...values)=>strings.reduce((text,part,index)=>text+part+(index<values.length?stringify(values[index]):""),"");
 const workspaceQuickEditNeedsTarget=prompt=>/\b(?:warm(?:er)?|cool(?:er)?|temperature)\b/iu.test(prompt);
 void{f,store,html,workspaceQuickEditNeedsTarget};const Host=eval(stripTypeScriptTypes('(class {store=store;i18n=quickEditReviewLocale("en");#localProposal=f.host;#quickEditReferenceInspection=null;get #proposal(){return this.#localProposal.value;}#editQuickEdit(){}#acceptProposal(){}#rejectProposal(){}render(){return this.#proposalPreview();}'+method+'})'));
 return new Host().render();
}
test("PREFLIGHT free actual rendered preview hides recovered private text after unreadable 403",async()=>{
 const f=fixture(),request={operationId:"preflight-server-operation",prompt:"RETAINED_PRIVATE_DOM_PREFLIGHT",targetBlockId:null},preview=makePreview(request),resuming=f.host.resume();await f.reply(f.calls[0],{status:"not-applied",preview});await resuming;
 const checking=f.host.check();f.calls[1].resolve({ok:false,status:403,json:async()=>{throw new SyntaxError("broken denied body");}});await checking;
 assert.doesNotMatch(renderPreflightFree(f),/RETAINED_PRIVATE_DOM_PREFLIGHT/);assert.equal(f.host.value.previewId,preview.previewId);assert.equal(f.host.value.approvalHash,preview.approvalHash);
});
test("PREFLIGHT free denied unreadable read preserves owned draft and exact operation but hides preview",async()=>{
 const f=fixture(),draft="MY OWN LITERAL PREFLIGHT DRAFT",preview=await open(f,draft),operationId=f.calls[0].body.operationId,checking=f.host.check();
 f.calls[1].resolve({ok:false,status:403,json:async()=>{throw new SyntaxError("broken denied body");}});await checking;
 assert.equal(f.host.value.draft,draft);assert.equal(f.host.value.intent.operationId,operationId);assert.equal(f.host.value.previewId,preview.previewId);assert.equal(f.host.value.approvalHash,preview.approvalHash);assert.equal(f.host.value.preview,null);
});

for(const ending of["resolve","reject"])test("PREFLIGHT free late A refresh "+ending+" preserves B's in-flight operation lock",async()=>{
 const calls=[],refresh=gate();let active={key:"authority-a",projectId:"p",documentId:"d"},next=0;
 const host=new WorkspaceLocalProposal({scope:()=>active,createId:()=>"preflight-operation-"+(++next),changed(){},applied:()=>refresh.promise,request(body){const pending=gate();calls.push({body,...pending});return pending.promise;}});
 const startingA=host.start("A own draft",null),preview=makePreview(calls[0].body);calls[0].resolve(Response.json({status:"not-applied",preview}));await startingA;
 const applyingA=host.accept();calls[1].resolve(Response.json({status:"applied",previewId:preview.previewId,approvalHash:preview.approvalHash,operationId:calls[0].body.operationId}));await turn();
 active={key:"authority-b",projectId:"p",documentId:"d-b"};const startingB=host.start("B own draft",null),stateB=host.value;assert.equal(stateB.pending,true);
 if(ending==="resolve")refresh.resolve();else refresh.reject(Error("old A refresh failed"));await applyingA;
 assert.equal(host.value,stateB);assert.equal(stateB.pending,true);assert.equal(stateB.draft,"B own draft");assert.equal(calls.length,3);
 calls[2].reject(Error("fixture B response lost"));await startingB;assert.equal(host.value,stateB);assert.equal(stateB.uncertain,true);
});

// Complete actual Shell -> Workspace -> Store -> RAM Worker. Only the existing
// native/HTTP fixtures are ports. These are not browser, layout or AT evidence.
const quickEditIdentityWithin = (node, predicate) => {
  for (let current = node; current; current = current.parent) if (predicate(current)) return true;
  return false;
};
const quickEditIdentityClass = (node, name) => String(node.attributes?.class ?? "").split(/\s+/u).includes(name);
const quickEditIdentityInReview = node => quickEditIdentityWithin(node, parent => quickEditIdentityClass(parent, "proposal-preview"));
const quickEditIdentityComparable = name => String(name).normalize("NFKC").replace(/\p{Cf}/gu, "").replace(/\s+/gu, " ").trim().toLowerCase();

async function quickEditIdentityFullPage(t, locale, duplicate, seedReferences = null, assistant = false, ordinaryCreator = false) {
  const h = await createSceneStoreHost();
  t.after(() => h.close());
  const worker = h.worker, { appendAuditEvent } = await import("../worker/runtime.ts");
  // Reuse the existing two-palette data shape. Seed only synthetic initial RAM
  // source through the same actual append helper used by the existing fixture.
  const seeds = events.filter(event => event.type === "BlockCreated").map((event, index) => ({
    ...event.payload, project_id: worker.projectId, document_id: worker.documentId,
    position: "quick-edit-" + index, scope: "document",
    handle: duplicate ? "palette/shared" : event.payload.handle,
    properties: { ...event.payload.properties, label: duplicate ? "Shared palette — أزرق 日本語" : event.payload.properties.label },
  }));
  assert.equal(seeds.length, 2);
  for (const payload of seeds) await appendAuditEvent(worker.env, worker.streamId, "user", "BlockCreated", payload);
  if(seedReferences)await seedReferences(worker,appendAuditEvent);
  if(ordinaryCreator){
    // Existing RAM ordinary-session setup (data-loading-performance.test.mjs).
    // Do this before mounting/source capture; never fake a capability result.
    worker.sqlite.prepare("UPDATE users SET role='creator' WHERE user_id=?").run(worker.owner);
    const response=await worker.request("/api/session");
    if(response.status!==200)throw Error("ordinary creator session prerequisite failed");
    const session=await response.json();
    if(session.user?.userId!==worker.owner||session.user.role!=="creator"||session.capabilities.includes("engineering.events.read")||!session.capabilities.includes("project.author"))throw Error("actual ordinary creator authorities required");
    h.setSession(session);
  }
  const reading = await worker.request("/api/events?after=0&limit=2000&content=1");
  assert.equal(reading.status, 200);
  const initial = await reading.json();
  assert.ok(Array.isArray(initial.events));
  assert.ok(Number.isSafeInteger(initial.head));
  const f = await createCalmFullPage(t, { locale, storeHost: h, assistant });
  // Initial setup only: restore the actual seeded Worker response after the
  // reused full-page helper's synthetic14 setup, as existing full-host ports do.
  h.store.events.set(initial.events); h.store.head.set(initial.head); h.store.content.set(initial.content ?? {});
  h.store.patchUi({ focusBlockId: "" });
  await f.settle();
  assert.ok(f.components().some(component => component.tag === "forma-workspace" && component.isConnected));
  assert.ok(!h.store.session.get().projectContext);
  assert.ok(h.store.session.get().capabilities.includes("project.author"));
  const palettes = h.store.projection.get().blocks.filter(block => block.type === "palette" && !block.removed);
  assert.deepEqual(palettes.map(block => block.id), ["palette-a", "palette-b"]);
  assert.ok(palettes.every(block => block.documentId === worker.documentId && block.projectId === worker.projectId && !block.locked));
  const start = h.requests.length, responses = [], source = structuredClone(h.store.events.get()), sourceHead = h.store.head.get();
  h.transport = async request => {
    assert.ok((request.init.method ?? "GET") === "GET" || request.url === "/api/workspace/quick-edit"
      && ["resume", "preview"].includes(request.body?.action), "only current reads and explicit free previews after initial setup");
    const response = await worker.request(request.url, request.init);
    if (request.url === "/api/workspace/quick-edit" && request.body?.action === "preview") {
      const body = await response.clone().json();
      responses.push({ request: structuredClone(request.body), status: response.status, body });
    }
    return response;
  };
  // Observe the existing transport promise without replacing its response,
  // changing dispatch, or adding a request. The fallback click returns void.
  const previewTransports = [], actualTransport = h.transport;
  h.transport = request => {
    const promise = actualTransport(request);
    if (request.url === "/api/workspace/quick-edit" && request.body?.action === "preview") {
      const observed = { request, promise, settled: false, rejected: false };
      previewTransports.push(observed);
      void promise.then(() => { observed.settled = true; }, () => { observed.settled = true; observed.rejected = true; });
    }
    return promise;
  };
  t.after(() => {
    assert.deepEqual(h.store.events.get(), source, "no application of the prepared change");
    assert.equal(h.store.head.get(), sourceHead);
    assert.ok(h.requests.slice(start).every(request => (request.init.method ?? "GET") === "GET"
      || request.url === "/api/workspace/quick-edit" && ["resume", "preview"].includes(request.body?.action)));
  });
  const writes = () => h.requests.slice(start).filter(request => (request.init.method ?? "GET") !== "GET"
    && !(request.url === "/api/workspace/quick-edit" && request.body?.action === "resume"));
  return { f, h, palettes, responses, writes, previewTransports };
}

async function quickEditIdentityEnter(x, prompt) {
  const input = x.f.find("textarea", node => node.owner.tag === "forma-workspace" && node.attributes.id === "creative-command");
  input.port.value = prompt;
  await x.f.act(input, "input");
  await x.f.act(x.f.find("button", node => node.owner.tag === "forma-workspace" && node.text === "Quick edit"));
}

async function quickEditIdentityJoinFocusedPreview(x, prompt, expectedId) {
  const readiness = stage => {
    const writes = x.writes(), observed = x.previewTransports[0];
    const tree = x.f.tree(), review = tree.nodes.find(node => quickEditIdentityClass(node, "proposal-preview"));
    const select = tree.visible("select").find(node => node.owner.tag === "forma-workspace" && quickEditIdentityInReview(node));
    return { stage, prompt, focused: true, focusedExactId: x.h.store.ui.focusBlockId,
      routeReady: x.h.store.routeDataReady(), authorizationPresent: Boolean(x.h.store.captureAuthorizationScope()),
      requestLogWrites: writes.length, trackedPreviewRequests: x.previewTransports.length,
      sameRequestObject: Boolean(observed && observed.request === writes[0]),
      trackedTargetId: observed?.request.body?.targetBlockId ?? null,
      transportSettled: observed?.settled ?? false, transportRejected: observed?.rejected ?? false,
      receivedResponses: x.responses.length, boundTargetId: select?.properties.value ?? null,
      reviewBusy: review?.attributes["aria-busy"] ?? null };
  };
  console.log("QUICK_EDIT_IDENTITY_FOCUSED_READINESS " + JSON.stringify(readiness("before-join")));
  assert.equal(x.previewTransports.length, 1, "focused action must already have dispatched one actual preview");
  assert.equal(x.writes().length, 1, "join does not create or retry a request");
  const observed = x.previewTransports[0];
  assert.equal(observed.request, x.writes()[0], "join the exact existing request object");
  assert.equal(observed.request.body.prompt, prompt);
  assert.equal(observed.request.body.targetBlockId, expectedId);
  // Join that already-dispatched real transport, not guessed render ticks.
  // A missing request fails above; a stalled real request fails at this bound.
  let deadline;
  try {
    await Promise.race([observed.promise, new Promise((_, reject) => {
      deadline = quickEditIdentitySetTimeout(() => reject(Error("focused actual preview did not complete within 5000ms")), 5000);
    })]);
  } finally { quickEditIdentityClearTimeout(deadline); }
  await x.f.settle();
  console.log("QUICK_EDIT_IDENTITY_FOCUSED_READINESS " + JSON.stringify(readiness("after-join")));
  assert.equal(observed.settled, true);
  assert.equal(observed.rejected, false);
}

function quickEditIdentityAssertPreview(x, prompt, expectedId) {
  assert.equal(x.responses.length, 1, "one actual Worker response");
  const response = x.responses[0], request = response.request;
  assert.equal(response.status, 200);
  assert.equal(response.body.status, "not-applied");
  assert.equal(request.action, "preview");
  assert.equal(request.prompt, prompt);
  assert.equal(request.targetBlockId, expectedId);
  assert.equal(request.projectId, x.h.store.projection.get().projectId);
  assert.equal(request.documentId, x.h.store.projection.get().documentId);
  const preview = response.body.preview;
  assert.equal(preview.localReview.targetBlockId, expectedId);
  assert.equal(preview.localReview.prompt, prompt);
  assert.equal(preview.localReview.origin, "rule-based");
  assert.equal(preview.localReview.providerCalls, 0);
  assert.equal(validWorkspaceQuickEditEvents(preview.events), true);
  assert.deepEqual(preview.events.filter(event => event.type === "BlockPropertyEdited").map(event => ({
    id: event.payload.block_id, property: event.payload.property_path, before: event.payload.old_value, after: event.payload.new_value,
  })), [{ id: expectedId, property: "temperature", before: "neutral", after: prompt }]);
  assert.deepEqual(x.writes().map(request => [request.url, request.body?.action, request.body?.targetBlockId]),
    [["/api/workspace/quick-edit", "preview", expectedId]]);
}

for (const locale of ["en", "fr", "ar", "ja"]) for (const duplicate of [false, true]) for (const prompt of ["warmer", "cooler"]) {
  test("full Workspace exact palette identity " + JSON.stringify({ locale, duplicate, prompt, focused: false }), async t => {
    const x = await quickEditIdentityFullPage(t, locale, duplicate), { f, h, palettes } = x, copy = workspaceLocalProposalCopy(locale);
    assert.equal(h.store.ui.focusBlockId, "");
    await quickEditIdentityEnter(x, prompt);
    const target = () => f.find("select", node => node.owner.tag === "forma-workspace" && quickEditIdentityInReview(node));
    const preview = () => f.find("button", node => quickEditIdentityInReview(node) && node.text === copy.preview);
    const options = target().children.filter(node => typeof node !== "string" && node.tag === "option");
    assert.deepEqual(options.map(node => node.attributes.value), ["", palettes[0].id, palettes[1].id]);
    assert.equal(options[0].text, copy.chooseTarget);
    assert.equal(target().properties.value, "", "no first-palette default");
    assert.equal(Object.hasOwn(preview().attributes, "disabled"), true);
    assert.equal(x.writes().length, 0, "a missing target does not submit");
    const names = options.slice(1).map(node => node.text);
    for (const [index, name] of names.entries()) assert.ok(name.includes(palettes[index].properties.label), "authored label remains complete");
    const selected = target(); selected.port.value = palettes[1].id;
    await f.act(selected, "change");
    assert.equal(target().properties.value, palettes[1].id, "the current second exact ID remains selected");
    assert.equal(h.store.ui.focusBlockId, "", "the select does not invent a focused decision");
    assert.equal(Object.hasOwn(preview().attributes, "disabled"), false);
    assert.equal(x.writes().length, 0, "choosing a target does not submit");
    await f.act(preview());
    quickEditIdentityAssertPreview(x, prompt, palettes[1].id);
    console.log("QUICK_EDIT_IDENTITY_OBSERVATION " + JSON.stringify({ locale, duplicate, prompt, focused: false,
      exactOptionIds: options.slice(1).map(node => node.attributes.value), uniqueOptionNames: new Set(names.map(quickEditIdentityComparable)).size,
      noDefault: true, selectedExactSecondId: palettes[1].id, previewTargetId: x.responses[0].request.targetBlockId,
      workerStatus: x.responses[0].status, previewRequests: 1, applyRequests: 0 }));
    // Last by design: baseline must first prove all routing/control invariants,
    // then fail only this independent user-visible identity requirement.
    assert.equal(new Set(names.map(quickEditIdentityComparable)).size, 2, "quick_edit_palette_option_names_must_identify_exact_peer");
    if (duplicate) for (const [index, name] of names.entries()) assert.ok(name.includes("\u2068" + palettes[index].id + "\u2069"), "complete isolated ID identifies each duplicate peer");
  });
}
for (const prompt of ["warmer", "cooler"]) {
  test("full Workspace exact palette identity " + JSON.stringify({ locale: "en", duplicate: true, prompt, focused: true }), async t => {
    const x = await quickEditIdentityFullPage(t, "en", true), { f, h, palettes } = x;
    await f.act(f.find("input", node => node.owner.tag === "forma-context-block" && node.owner.block.id === palettes[1].id
      && node.attributes.type === "radio"), "change");
    assert.equal(h.store.ui.focusBlockId, palettes[1].id);
    await quickEditIdentityEnter(x, prompt);
    await quickEditIdentityJoinFocusedPreview(x, prompt, palettes[1].id);
    quickEditIdentityAssertPreview(x, prompt, palettes[1].id);
    console.log("QUICK_EDIT_IDENTITY_OBSERVATION " + JSON.stringify({ locale: "en", duplicate: true, prompt, focused: true,
      focusedExactId: palettes[1].id, previewTargetId: x.responses[0].request.targetBlockId, workerStatus: x.responses[0].status,
      previewRequests: 1, applyRequests: 0 }));
  });
}

// The production template/controller/retrieval are unchanged under evaluation.
// These finite Store/native ports test disclosure ownership, not browser delivery.
async function quickEditReferenceView(locale="en",duplicate=false,referenceKind="accepted-proposal",attribution={}){
  const f=fixture(),history=events.map(event=>({...event,occurredAt:"2026-08-28T10:00:00.000Z"}));
  const content={},ui={},calls=[];let sourceCurrent=true,generation=1,route="/document/d/exact",caps=["project.read","project.author"];
  const add=(type,payload)=>{const item={...history[0],eventId:"reference-event-"+(history.length+1),sequence:history.length+1,type,payload,actor:Object.hasOwn(attribution,"actor")?attribution.actor:history[0].actor};history.push(item);return item;};
  const ids=[];
  for(const [index,projectId] of ["p","p","p","p","foreign-project"].entries()){
    const ref="reference-content-"+index;content[ref]=projectId==="p"?"warmer retained reference "+index:"warmer PRIVATE_FOREIGN_REFERENCE";
    if(referenceKind==="accepted-proposal"){
    const proposed=add("MutationProposed",{project_id:projectId,document_id:projectId==="p"?"d":"foreign-document",content_ref:ref,
      proposed_events:[{type:"BlockPropertyEdited",payload:{block_id:"palette-a",property_path:"temperature",old_value:"neutral",new_value:duplicate?"warmer":"warmer "+index}}]});
    add("ProposalAccepted",{project_id:projectId,document_id:projectId==="p"?"d":"foreign-document",proposal_event_id:proposed.eventId});ids.push(proposed.eventId);
    }else if(referenceKind==="authored-correction"){
      add("ExtractionCompleted",{project_id:projectId,document_id:projectId==="p"?"d":"foreign-document",block_id:"palette-a",chips:[{property:"colors",value:"cool"}]});
      const correction=add("ChipEdited",{project_id:projectId,document_id:projectId==="p"?"d":"foreign-document",block_id:"palette-a",property:"colors",old_value:"cool "+index,new_value:content[ref]});ids.push(correction.eventId);
    }else{
      const generationId="reference-generation-"+index,objectId="reference-output-"+index,documentId=projectId==="p"?"d":"foreign-document";
      add("ContextCompiled",{project_id:projectId,document_id:documentId,generation_id:generationId,compiled_snapshot:{facts:[{type:"direction",properties:{text:content[ref]}}]}});
      const generated=add("GenerationCompleted",{project_id:projectId,document_id:documentId,generation_id:generationId,model_id:"historical-fixture",object_ids:[objectId]});
      add("ObjectSaved",{project_id:projectId,document_id:documentId,object_id:objectId});ids.push(generated.eventId);
    }
  }
  const scope={key:"owner:epoch",projectId:"p",documentId:"d"};
  const store={session:{get:()=>({...attribution.session,capabilities:caps})},events:{get:()=>history},content:{get:()=>content},head:{get:()=>history.at(-1).sequence},
    projection:{get:()=>foldEvents(history,Infinity,"d","p")},route:{get:()=>route},routeDataReady:()=>sourceCurrent,
    captureSourceOwnership:()=>({generation}),sourceOwnershipActive:owner=>sourceCurrent&&owner.generation===generation,
    ui,patchUi(value){calls.push(structuredClone(value));Object.assign(ui,value);}};
  const starting=f.host.start("warmer","palette-b"),request=f.calls[0].body;
  const planned=buildWorkspaceQuickEditPlan({projection:store.projection.get(),intent:normalizeWorkspaceQuickEditIntent(request),sourceHead:store.head.get(),createId:()=>"related-new-decision"});
  const preview={...makePreview(request),changes:planned.changes,events:planned.events,localReview:planned.review};
  await f.reply(f.calls[0],{status:"not-applied",preview});assert.equal(await starting,true);
  const syntax=ts.createSourceFile("forma-workspace.ts",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),owner=syntax.statements.find(node=>ts.isClassDeclaration(node)&&node.name?.text==="FormaWorkspace");
  const member=name=>{const value=owner.members.find(node=>node.name?.getText(syntax)===name);assert.ok(value,name);return value.getText(syntax);};
  const handlers=[],nothing=Symbol("nothing"),stringify=value=>value===nothing?"":Array.isArray(value)?value.map(stringify).join(""):typeof value==="function"?"handler:"+(handlers.push(value)-1):String(value??"");
  const html=(strings,...values)=>strings.reduce((text,part,index)=>text+part+(index<values.length?stringify(values[index]):""),"");
  const icon=()=>nothing,workspaceQuickEditNeedsTarget=prompt=>/\b(?:warm(?:er)?|cool(?:er)?|temperature)\b/iu.test(prompt);
  void{locale,store,html,icon,workspaceQuickEditNeedsTarget,shortEventType,retrieveFewShotExemplars,documentIdFromRoute,documentViewFromRoute,routePathname,provenanceActorMessage};
  const Host=eval(stripTypeScriptTypes('(class {isConnected=true;store=store;i18n=quickEditReviewLocale(locale);#localProposal=f.host;#quickEditReferenceInspection=null;get #proposal(){return this.#localProposal.value;}#editQuickEdit(){}#acceptProposal(){}#rejectProposal(){}render(){return this.#proposalPreview();}inspect(){return this.#inspector();}'+member("#proposalPreview")+member("#inspector")+'})'));
  const host=new Host(),render=()=>String(host.render());
  const buttons=markup=>[...markup.matchAll(/<button[^>]*data-quick-edit-reference=([^\s>]+)[^>]*@click=handler:(\d+)[^>]*>([\s\S]*?)<\/button>/gu)].map(match=>({id:match[1],click:handlers[Number(match[2])],name:match[3].replace(/<[^>]*>/gu,"")}));
  return{f,host,store,history,content,ids,preview,scope,calls,render,buttons,
    withdraw(){sourceCurrent=false;generation++;},permissions(){caps=["project.author"];},route(value){route=value;},
    removeCitation(id){history.splice(history.findIndex(event=>event.eventId===id),1);},
    owner(value){f.setScope(value);},draft:()=>f.host.value?.draft};
}

for(const locale of["en","fr","ar","ja"])for(const duplicate of[false,true])test("related local references remain optional project-scoped and honestly named "+JSON.stringify({locale,duplicate}),async()=>{
  const x=await quickEditReferenceView(locale,duplicate),before=JSON.stringify(x.f.host.value),copy=workspaceLocalProposalCopy(locale),markup=x.render(),buttons=x.buttons(markup);
  assert.match(markup,/<details class="proposal-corpus"><summary>/u);assert.doesNotMatch(markup,/<details class="proposal-corpus"[^>]*\bopen/u);
  assert.ok(markup.includes(copy.related));assert.ok(markup.includes(copy.referenceOnly));assert.ok(markup.includes(copy.free));
  assert.doesNotMatch(markup,/PRIVATE_FOREIGN_REFERENCE/u);assert.equal(buttons.length,3,"the existing retrieval limit remains three");
  const comparable=value=>value.normalize("NFKC").replace(/\p{Cf}/gu,"").replace(/\s+/gu," ").trim().toLowerCase();
  assert.equal(new Set(buttons.map(button=>comparable(button.name))).size,3);
  assert.ok(buttons.every(button=>button.name.includes(copy.inspectReference)));
  buttons[0].click();assert.equal(x.store.ui.inspectorOpen,true);assert.equal(x.store.ui.selectedEventId,buttons[0].id.replace(/^proposal:/u,""));
  const inspection=String(x.host.inspect());assert.ok(inspection.includes(x.host.i18n.t("workspace.provenance.inspector","Creative history")));
  assert.ok(!inspection.includes(copy.referenceUnavailable));assert.equal(JSON.stringify(x.f.host.value),before);
  assert.equal(x.f.calls.length,1,"reference inspection does not preview, apply, retrieve, purchase, or record a proposal");
  assert.deepEqual(x.calls,[{selectedEventId:buttons[0].id.replace(/^proposal:/u,""),inspectorOpen:true}]);
});

for(const change of["source","permission","route","preview","authority","citation","expiry","head"])test("current related-reference disclosure retires on "+change+" without discarding the draft",async()=>{
  const x=await quickEditReferenceView(),button=x.buttons(x.render())[0],draft=x.draft(),copy=workspaceLocalProposalCopy("en");
  button.click();assert.ok(!String(x.host.inspect()).includes(copy.referenceUnavailable));
  if(change==="source")x.withdraw();
  if(change==="permission")x.permissions();
  if(change==="route")x.route("/library");
  if(change==="preview")x.f.host.edit("My revised local draft",null);
  if(change==="authority")x.owner({key:"different-owner",projectId:"p",documentId:"d"});
  if(change==="citation")for(const id of x.ids)x.removeCitation(id);
  if(change==="expiry")x.preview.expiresAt="2000-01-01T00:00:00.000Z";
  if(change==="head")x.history.push({...x.history.at(-1),eventId:"new-head",sequence:x.store.head.get()+1,type:"AnnotationAdded",payload:{project_id:"p",document_id:"d",text:"another current event"}});
  const markup=x.render();assert.doesNotMatch(markup,/proposal-corpus|warmer retained reference/u);
  assert.ok(String(x.host.inspect()).includes(copy.referenceUnavailable),"the former exact inspection never falls back to another event");
  if(change!=="authority")assert.equal(x.draft(),change==="preview"?"My revised local draft":draft);
  assert.equal(x.f.calls.length,1);assert.equal(x.calls.length,1);
});

for(const outcome of["pending","uncertain","stale","denied"])test("related references stay absent while the original preview is "+outcome,async()=>{
  const x=await quickEditReferenceView(),draft=x.draft(),checking=x.f.host.check();
  assert.doesNotMatch(x.render(),/proposal-corpus|warmer retained reference/u);
  if(outcome==="uncertain")x.f.calls[1].reject(Error("read response lost"));
  else await x.f.reply(x.f.calls[1],outcome==="denied"?{error:"authoring_preview_unavailable"}:{status:"not-applied",preview:x.preview,stale:outcome==="stale"},outcome==="denied"?403:200);
  await checking;
  if(outcome==="pending")assert.equal(x.buttons(x.render()).length,3,"a successful original read restores the optional references");
  else assert.doesNotMatch(x.render(),/proposal-corpus|warmer retained reference/u);
  assert.equal(x.draft(),draft);assert.equal(x.f.calls.length,2);assert.equal(x.f.calls[1].body.action,"retrieve");
});

test("an explicit missing reference never means latest history, while generic history still can",async()=>{
  const x=await quickEditReferenceView(),copy=workspaceLocalProposalCopy("en");
  x.store.ui.selectedEventId="missing-exact-id";assert.ok(String(x.host.inspect()).includes(copy.referenceUnavailable));
  x.store.ui.selectedEventId="";assert.ok(!String(x.host.inspect()).includes(copy.referenceUnavailable));
  assert.match(source,/this\.#quickEditReferenceInspection=null;this\.store\.patchUi\(\{ inspectorOpen:true,selectedEventId:"" \}\)/u);
  assert.equal(x.f.calls.length,1);
});

test("a committed local edit hides optional references without weakening its exact receipt",async()=>{
  const x=await quickEditReferenceView(),button=x.buttons(x.render())[0],operationId=x.f.calls[0].body.operationId;
  button.click();const saving=x.f.host.accept();
  assert.doesNotMatch(x.render(),/proposal-corpus|warmer retained reference/u);
  await x.f.reply(x.f.calls[1],{status:"applied",previewId:x.preview.previewId,approvalHash:x.preview.approvalHash,operationId});await saving;
  assert.equal(x.f.host.value.applied,true);assert.equal(x.f.host.value.previewId,x.preview.previewId);assert.equal(x.f.host.value.approvalHash,x.preview.approvalHash);
  assert.doesNotMatch(x.render(),/proposal-corpus|warmer retained reference/u);
  assert.ok(String(x.host.inspect()).includes(workspaceLocalProposalCopy("en").referenceUnavailable));
  assert.equal(x.f.calls.length,2);assert.equal(x.f.calls[1].body.action,"apply");
});

for(const locale of["en","fr","ar","ja"])test("full connected Workspace retains an exact related reference without another request "+locale,async t=>{
  let citation="",contentRef="";
  const x=await quickEditIdentityFullPage(t,locale,false,async(worker,appendAuditEvent)=>{
    const {storePrivateContent}=await import("../worker/pilot-policy.ts");
    const stored=await storePrivateContent(worker.env,worker.owner,"prompt","warmer SAVED_REFERENCE_ONLY");contentRef=stored.contentId;
    const proposed=await appendAuditEvent(worker.env,worker.streamId,"model:forma-chat","MutationProposed",{project_id:worker.projectId,document_id:worker.documentId,content_ref:contentRef,
      proposed_events:[{type:"BlockPropertyEdited",payload:{block_id:"palette-a",property_path:"temperature",old_value:"neutral",new_value:"warmer"}}]});
    citation=proposed.eventId;
    await appendAuditEvent(worker.env,worker.streamId,"user","ProposalAccepted",{project_id:worker.projectId,document_id:worker.documentId,proposal_event_id:citation});
  });
  assert.ok(citation);assert.equal(x.h.store.content.get()[contentRef],"warmer SAVED_REFERENCE_ONLY");
  await quickEditIdentityEnter(x,"warmer");
  const target=x.f.find("select",node=>node.owner.tag==="forma-workspace"&&quickEditIdentityInReview(node));target.port.value="palette-b";await x.f.act(target,"change");
  await x.f.act(x.f.find("button",node=>quickEditIdentityInReview(node)&&node.text===workspaceLocalProposalCopy(locale).preview));
  quickEditIdentityAssertPreview(x,"warmer","palette-b");
  const view=x.f.components().find(component=>component.tag==="forma-workspace"),nodes=x.f.tree().nodes;
  const disclosure=nodes.find(node=>node.owner===view&&node.tag==="details"&&quickEditIdentityClass(node,"proposal-corpus"));
  assert.ok(disclosure,"the actual connected Workspace publishes optional related work");assert.ok(!Object.hasOwn(disclosure.attributes,"open"));
  // Native details disclosure port only: no application callback is substituted.
  disclosure.port.open=true;
  const reference=x.f.find("button",node=>node.owner===view&&node.attributes["data-quick-edit-reference"]==="proposal:"+citation);
  assert.ok(reference);assert.equal(typeof reference.handlers.click,"function");
  const requestCount=x.h.requests.length,draft=x.f.find("textarea",node=>node.owner===view&&quickEditIdentityInReview(node)).properties.value;
  await x.f.act(reference);
  assert.equal(x.h.store.ui.selectedEventId,citation);assert.equal(x.h.store.ui.inspectorOpen,true);
  assert.equal(x.f.find("textarea",node=>node.owner===view&&quickEditIdentityInReview(node)).properties.value,draft);
  assert.equal(x.h.requests.length,requestCount,"reading the reference uses no HTTP at all");
  assert.equal(x.responses.length,1);assert.equal(x.writes().length,1);assert.equal(x.responses[0].body.preview.localReview.providerCalls,0);
});


for(const locale of["en","fr","ar","ja"])for(const kind of["accepted-proposal","authored-correction","kept-generation"])test("related reference inspection identifies the selected readable result "+JSON.stringify({locale,kind}),async()=>{
  const x=await quickEditReferenceView(locale,true,kind),copy=workspaceLocalProposalCopy(locale),markup=x.render(),buttons=x.buttons(markup);
  const items=retrieveFewShotExemplars(x.history,"warmer",x.content,{limit:3,projectId:"p"});
  assert.equal(items.length,3);assert.equal(buttons.length,3);assert.ok(items.every(item=>item.kind===kind));
  assert.equal(new Set(items.map(item=>x.history.find(event=>item.citations.includes(event.eventId)).occurredAt)).size,1,"same-time metadata cannot stand in for selected context");
  const selected=items.find(item=>item.exemplarId===buttons[1].id);assert.ok(selected);
  const eventId=selected.exemplarId.slice(selected.exemplarId.indexOf(":")+1);
  assert.ok(selected.citations.includes(eventId));
  if(kind!=="accepted-proposal")assert.notEqual(eventId,selected.citations[0],"the result has an earlier upstream citation");
  buttons[1].click();const inspection=String(x.host.inspect());
  assert.equal(x.store.ui.selectedEventId,eventId,"inspect the exact selected result, not its upstream extraction/compile");
  assert.ok(inspection.includes(selected.summary));assert.ok(inspection.includes(copy.referenceContext));
  assert.ok(inspection.includes(kind==="accepted-proposal"?copy.referenceAccepted:kind==="authored-correction"?copy.referenceCorrection:copy.referenceKept));
  assert.ok(items.filter(item=>item!==selected).every(item=>!inspection.includes(item.summary)),"a selected reference does not show a same-kind sibling summary");
  assert.doesNotMatch(inspection,/provenance-technical|PRIVATE_FOREIGN_REFERENCE/u);assert.equal(x.f.calls.length,1);
  const draft=x.draft();x.withdraw();const retired=String(x.host.inspect());
  assert.ok(retired.includes(copy.referenceUnavailable));assert.ok(!retired.includes(selected.summary));assert.equal(x.draft(),draft);
});

for(const route of["/library","/activity","/document/other/exact","/document/d/exact/view/board"])test("a fresh reference render cannot claim a nonowning current route "+route,async()=>{
  const x=await quickEditReferenceView(),draft=x.draft();x.route(route);
  assert.equal(x.buttons(x.render()).length,0);assert.doesNotMatch(x.render(),/warmer retained reference/u);
  assert.equal(x.draft(),draft);assert.equal(x.f.calls.length,1);
});
for(const route of["/","/document/d/exact/focus","/creative/create"])test("a current supported Workspace route keeps optional references "+route,async()=>{
  const x=await quickEditReferenceView();x.route(route);assert.equal(x.buttons(x.render()).length,3);assert.equal(x.f.calls.length,1);
});

async function quickEditReferenceAssistantEnter(t,x){
  const {f,h}=x,ports=calmFullPageNativePorts,previous=Object.getOwnPropertyDescriptor(ports.windowPort,"dispatchEvent");
  const pending=new Set(),transport=h.transport;
  h.transport=request=>{const promise=transport(request);pending.add(promise);void promise.then(()=>pending.delete(promise),()=>pending.delete(promise));return promise;};
  // Native window delivery only, as in the existing mounted assistant proof.
  // No production method, request/Response, or resolve callback is substituted.
  Object.defineProperty(ports.windowPort,"dispatchEvent",{configurable:true,value(event){
    for(const listener of [...(f.listeners.get(event.type)??[])])listener.call(ports.windowPort,event);
    return !event.defaultPrevented;
  }});
  t.after(()=>{if(previous)Object.defineProperty(ports.windowPort,"dispatchEvent",previous);else delete ports.windowPort.dispatchEvent;});
  t.mock.method(globalThis,"fetch",(input,init={})=>{
    const url=new URL(String(input),"http://localhost");
    assert.ok(["http://localhost","https://fixture.invalid"].includes(url.origin)&&url.pathname.startsWith("/api/"),"in-memory same-origin application paths only");
    return h.fetch(url.pathname+url.search,init);
  });
  await f.act(f.find("button",node=>quickEditIdentityClass(node,"forma-assistant-launcher")));
  await Promise.all([...pending]);await f.settle();
  await f.act(f.find("button",node=>quickEditIdentityClass(node,"forma-assistant-mode")&&node.text===f.i18n.t("assistant.mode.quickEdit")));
  const field=f.find("textarea",node=>quickEditIdentityClass(node,"forma-assistant-input"));field.port.value="warmer";await f.act(field,"input");
  const form=f.find("form",node=>quickEditIdentityClass(node,"forma-assistant-composer"));
  await f.act(form,"submit");
  assert.ok(f.find("textarea",node=>quickEditIdentityInReview(node)),"the actual assistant action hands off to this same Workspace review");
}

for(const locale of["en","fr","ar","ja"])for(const assistant of[false,true])test("full Workspace references use one document-flow review in both assistant modes "+JSON.stringify({locale,assistant}),async t=>{
  let citation="",contentRef="";const summary="warmer SAVED_REFERENCE_MODE_"+locale;
  const x=await quickEditIdentityFullPage(t,locale,false,async(worker,appendAuditEvent)=>{
    const {storePrivateContent}=await import("../worker/pilot-policy.ts");
    contentRef=(await storePrivateContent(worker.env,worker.owner,"prompt",summary)).contentId;
    citation=(await appendAuditEvent(worker.env,worker.streamId,"model:forma-chat","MutationProposed",{project_id:worker.projectId,document_id:worker.documentId,content_ref:contentRef,
      proposed_events:[{type:"BlockPropertyEdited",payload:{block_id:"palette-a",property_path:"temperature",old_value:"neutral",new_value:"warmer"}}]})).eventId;
    await appendAuditEvent(worker.env,worker.streamId,"user","ProposalAccepted",{project_id:worker.projectId,document_id:worker.documentId,proposal_event_id:citation});
  },assistant,true);
  const {f,h}=x,copy=workspaceLocalProposalCopy(locale),view=f.components().find(component=>component.tag==="forma-workspace");
  assert.ok(view?.isConnected);assert.equal(Boolean(h.store.session.get().assistant?.enabled),assistant);
  assert.equal(h.store.content.get()[contentRef],summary);assert.ok(!h.store.session.get().capabilities.includes("engineering.events.read"));
  if(assistant)await quickEditReferenceAssistantEnter(t,x);
  else{
    await f.act(f.find("button",node=>node.owner===view&&node.attributes["data-workbench-pane"]==="result"));
    await quickEditIdentityEnter(x,"warmer");
    assert.equal(f.tree().nodes.find(node=>node.owner===view&&Object.hasOwn(node.attributes,"data-workbench-mode")).attributes["data-workbench-mode"],"write","the current fallback gesture reveals Write before any late response");
  }
  const target=f.find("select",node=>node.owner===view&&quickEditIdentityInReview(node));target.port.value="palette-b";await f.act(target,"change");
  await f.act(f.find("button",node=>quickEditIdentityInReview(node)&&node.text===copy.preview));
  quickEditIdentityAssertPreview(x,"warmer","palette-b");
  const reviews=f.tree().nodes.filter(node=>node.owner===view&&quickEditIdentityClass(node,"proposal-preview"));
  assert.equal(reviews.length,1,"one actual review, not mirrored into the fixed composer");
  assert.ok(quickEditIdentityWithin(reviews[0],node=>quickEditIdentityClass(node,"document-quick-edit-review")));
  assert.ok(!quickEditIdentityWithin(reviews[0],node=>quickEditIdentityClass(node,"composer-dock")));
  const disclosure=f.tree().nodes.find(node=>node.owner===view&&node.tag==="details"&&quickEditIdentityClass(node,"proposal-corpus"));
  assert.ok(disclosure);assert.ok(!Object.hasOwn(disclosure.attributes,"open"));disclosure.port.open=true;
  const reference=f.find("button",node=>node.owner===view&&node.attributes["data-quick-edit-reference"]==="proposal:"+citation),requestCount=h.requests.length;
  const draft=f.find("textarea",node=>node.owner===view&&quickEditIdentityInReview(node)).properties.value;
  await f.act(reference);
  const inspection=f.tree().nodes.find(node=>node.owner===view&&node.tag==="aside"&&quickEditIdentityClass(node,"inspector-panel"));
  assert.ok(inspection);assert.ok(inspection.text.includes(copy.referenceAccepted));assert.ok(inspection.text.includes(summary));assert.ok(inspection.text.includes(copy.referenceContext));
  assert.ok(!inspection.text.includes(copy.referenceUnavailable));assert.equal(h.store.ui.selectedEventId,citation);assert.equal(h.requests.length,requestCount);
  assert.equal(f.find("textarea",node=>node.owner===view&&quickEditIdentityInReview(node)).properties.value,draft);
  await f.act(f.find("button",node=>node.owner===view&&quickEditIdentityWithin(node,parent=>quickEditIdentityClass(parent,"inspector-panel"))&&node.attributes["aria-label"]===f.i18n.t("workspace.provenance.close","Close creative history")));
  assert.equal(h.store.ui.inspectorOpen,false);assert.equal(f.find("textarea",node=>node.owner===view&&quickEditIdentityInReview(node)).properties.value,draft);
  assert.equal(h.requests.length,requestCount);assert.equal(x.responses.length,1);assert.equal(x.writes().length,1);
});

test("related reference layout uses wrapping document flow rather than the inherited chip strip",()=>{
  const css=fs.readFileSync(new URL("../src/styles.css",import.meta.url),"utf8");
  assert.match(css,/details\.proposal-corpus\s*\{[^}]*display:\s*block/u);
  assert.match(css,/details\.proposal-corpus button\s*\{[^}]*min-block-size:\s*44px;[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere/u);
  assert.doesNotMatch(css,/\.proposal-corpus\s*\{[^}]*overflow-x:\s*auto/u);
  assert.match(css,/\.document-quick-edit-review \.proposal-preview\s*\{[^}]*flex-wrap:\s*wrap/u);
  assert.match(css,/\.provenance-reference-context p\s*\{[^}]*white-space:\s*pre-wrap/u);
});


for(const locale of["fr","ar","ja"])test("an already open exact reference updates only its app-owned labels on en-to-"+locale,async()=>{
  const x=await quickEditReferenceView("en",true),{FormaLocaleController,FORMA_DEFAULT_MESSAGES,localeCatalogs}=calmFullPageNativePorts;
  const snapshot=(language,revision)=>({locale:language,formatLocale:language,direction:language==="ar"?"rtl":"ltr",timeZone:"UTC",messages:{...FORMA_DEFAULT_MESSAGES,...localeCatalogs[language]},revision});
  let publish,updates=0;
  const controller=new FormaLocaleController({addController(){},requestUpdate(){updates++;},dispatchEvent(event){publish=event.callback;publish(snapshot("en",1),()=>{});return true;}});
  controller.hostConnected();x.host.i18n=controller;assert.equal(typeof publish,"function");
  const button=x.buttons(x.render())[1];button.click();
  const selected=x.store.ui.selectedEventId,original=JSON.stringify(x.f.host.value),draft=x.draft(),requestCount=x.f.calls.length,uiCount=x.calls.length;
  const item=retrieveFewShotExemplars(x.history,"warmer",x.content,{limit:3,projectId:"p"}).find(reference=>reference.exemplarId===button.id);assert.ok(item);
  const heading=markup=>markup.match(/<h2>([\s\S]*?)<\/h2>/u)?.[1];
  const initial=String(x.host.inspect());assert.ok(heading(initial).includes(workspaceLocalProposalCopy("en").referenceAccepted));assert.ok(initial.includes(item.summary));
  const beforeUpdates=updates;publish(snapshot(locale,2));
  assert.equal(controller.locale,locale);assert.ok(updates>beforeUpdates,"the actual locale subscriber requests a render");
  // Read the same stored inspection resolver BEFORE rebuilding the preview.
  const current=String(x.host.inspect()),copy=workspaceLocalProposalCopy(locale);
  const expected=controller.t("context.controls.disambiguated","{ordinal} · {name}",{ordinal:controller.number(2),name:copy.referenceAccepted});
  assert.equal(heading(current),expected);assert.ok(!heading(current).includes(workspaceLocalProposalCopy("en").referenceAccepted));
  assert.ok(current.includes(copy.referenceContext));assert.ok(current.includes(item.summary));assert.ok(!current.includes(copy.referenceUnavailable));
  assert.equal(x.store.ui.selectedEventId,selected);assert.equal(x.store.ui.inspectorOpen,true);
  assert.equal(JSON.stringify(x.f.host.value),original);assert.equal(x.draft(),draft);assert.equal(x.f.calls.length,requestCount);assert.equal(x.calls.length,uiCount);
  assert.ok(x.buttons(x.render())[1].name.includes(expected),"the fresh row and retained inspector agree without another selection");
  controller.hostDisconnected();
});


// These are actual inspector members, the real locale controller and real corpus
// retrieval with declared finite Store/session/native ports. They do not certify
// a browser, a cross-account authorization transition or a new canonical commit.
const provenanceAttributionExpected={
  en:{you:"You",human:"User account",assistance:"Model assistance",system:"System process",unknown:"Origin not identified",author:"Recorded actor"},
  fr:{you:"Vous",human:"Compte utilisateur",assistance:"Assistance d’un modèle",system:"Processus système",unknown:"Origine non identifiée",author:"Acteur enregistré"},
  ar:{you:"أنت",human:"حساب مستخدم",assistance:"مساعدة نموذج",system:"عملية نظام",unknown:"المصدر غير محدد",author:"الجهة المسجّلة"},
  ja:{you:"あなた",human:"ユーザーアカウント",assistance:"モデルによる支援",system:"システム処理",unknown:"作成元を特定できません",author:"記録上の実行者"},
};
const provenanceOldApproval={en:"Approved creative assistance",fr:"Assistance créative autorisée",ar:"المساعدة الإبداعية المعتمدة",ja:"承認済みのクリエイティブ支援"};
const provenanceSession=(userId="owner")=>({user:{userId,displayName:"PRIVATE_PERSON_NAME",email:"PRIVATE_PERSON_EMAIL@example.test"},impersonation:null});
const provenanceAuthor=markup=>markup.match(/<dl><dt>[^<]*<\/dt><dd>([^<]*)<\/dd>/u)?.[1];
function standaloneProvenanceInspection(x){
  const text=readFileSync(new URL("../src/components/event-inspector.ts",import.meta.url),"utf8");
  const syntax=ts.createSourceFile("event-inspector.ts",text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  const owner=syntax.statements.find(node=>ts.isClassDeclaration(node)&&node.name?.text==="EventInspector");
  const render=owner?.members.find(node=>node.name?.getText(syntax)==="render");assert.ok(render);
  const store=x.store,i18n=x.host.i18n,nothing=Symbol("nothing");
  const stringify=value=>value===nothing?"":Array.isArray(value)?value.map(stringify).join(""):typeof value==="function"?"handler":String(value??"");
  const html=(strings,...values)=>strings.reduce((text,part,index)=>text+part+(index<values.length?stringify(values[index]):""),"");
  const icon=()=>nothing;void{store,i18n,nothing,html,icon,shortEventType,provenanceActorMessage};
  const Probe=eval(stripTypeScriptTypes('(class {store=store;i18n=i18n;'+render.getText(syntax).replace(/^override /u,"")+'})'));
  return String(new Probe().render());
}
function assertProvenancePrivateIdsAbsent(markup,actor){
  assert.doesNotMatch(markup,/PRIVATE_PERSON_NAME|PRIVATE_PERSON_EMAIL|provenance-technical/u);
  if(typeof actor==="string"&&actor.includes(":"))assert.ok(!markup.includes(actor),"ordinary attribution never prints a raw recorded actor");
}
function openProvenanceCorrection(x){
  const button=x.buttons(x.render())[1];assert.ok(button);
  const item=retrieveFewShotExemplars(x.history,"warmer",x.content,{limit:3,projectId:"p"}).find(item=>item.exemplarId===button.id);assert.ok(item);
  button.click();const selected=x.store.ui.selectedEventId,event=x.history.find(event=>event.eventId===selected);assert.ok(event);
  assert.ok(item.citations.includes(selected));assert.equal(selected,item.exemplarId.slice(item.exemplarId.indexOf(":")+1));
  assert.equal(x.store.ui.inspectorOpen,true);assert.equal(x.f.calls.length,1);
  return{item,event,selected};
}

for(const locale of["en","fr","ar","ja"])test("canonical current human correction has truthful provenance "+locale,async()=>{
  const attribution={session:provenanceSession()},x=await quickEditReferenceView(locale,true,"authored-correction",attribution);
  const original=JSON.stringify(x.f.host.value),{item,event,selected}=openProvenanceCorrection(x),inspection=String(x.host.inspect());
  assert.equal(event.type,"ChipEdited");assert.equal(event.actor,"user:owner");
  assert.equal(event.actor,"user:"+x.store.session.get().user.userId,"the exact canonical actor is the current principal");
  assert.notEqual(selected,item.citations[0],"this is the selected human correction, not upstream model extraction");
  assert.ok(inspection.includes(item.summary));assert.ok(inspection.includes(workspaceLocalProposalCopy(locale).referenceCorrection));
  assert.equal(JSON.stringify(x.f.host.value),original);assert.equal(x.f.calls.length,1);assert.equal(x.calls.length,1);
  assertProvenancePrivateIdsAbsent(inspection,event.actor);
  console.log("PROVENANCE_HUMAN_CAUSAL "+JSON.stringify({locale,selectedHumanCorrection:true,currentPrincipalExact:true,readableExactSummary:true,
    previewRequests:1,inspectionRequests:0,applyRequests:0,draftUnchanged:true,actualCaption:provenanceAuthor(inspection),expectedCaption:provenanceAttributionExpected[locale].you}));
  assert.equal(provenanceAuthor(inspection),provenanceAttributionExpected[locale].you,"canonical_current_human_must_be_you_not_approved_assistance");
  assert.equal(provenanceAuthor(standaloneProvenanceInspection(x)),provenanceAttributionExpected[locale].you);
  assert.ok(inspection.includes("<dt>"+provenanceAttributionExpected[locale].author+"</dt>"));
});

const provenanceActorVariants=[
  {name:"other human",actor:"user:peer-private-id",kind:"authored-correction",label:"human"},
  {name:"legacy human without identity",actor:"user",kind:"authored-correction",label:"human"},
  {name:"model without an approval receipt",actor:"model:unapproved-private-model",kind:"kept-generation",label:"assistance"},
  {name:"worker",actor:"worker:private-worker",kind:"kept-generation",label:"system"},
  {name:"system",actor:"system",kind:"kept-generation",label:"system"},
  {name:"unrecognized recorded origin",actor:"custom:private-actor",kind:"authored-correction",label:"unknown"},
  {name:"empty human identity",actor:"user:",kind:"authored-correction",label:"unknown"},
];
for(const locale of["en","fr","ar","ja"])for(const variant of provenanceActorVariants)test("current provenance is truthful without identity disclosure "+JSON.stringify({locale,variant:variant.name}),async()=>{
  const x=await quickEditReferenceView(locale,true,variant.kind,{actor:variant.actor,session:provenanceSession()});
  const original=JSON.stringify(x.f.host.value),{item,event,selected}=openProvenanceCorrection(x);
  assert.equal(event.actor,variant.actor);assert.equal(x.history.some(event=>event.type==="ProposalAccepted"),false,"saved output/correction is not proof of model approval");
  const inspection=String(x.host.inspect());assert.ok(inspection.includes(item.summary));assert.equal(x.store.ui.selectedEventId,selected);
  for(const markup of[inspection,standaloneProvenanceInspection(x)]){
    assert.equal(provenanceAuthor(markup),provenanceAttributionExpected[locale][variant.label]);
    assert.ok(markup.includes("<dt>"+provenanceAttributionExpected[locale].author+"</dt>"));
    assert.ok(!markup.includes(provenanceOldApproval[locale]));assertProvenancePrivateIdsAbsent(markup,event.actor);
  }
  assert.equal(JSON.stringify(x.f.host.value),original);assert.equal(x.f.calls.length,1);assert.equal(x.calls.length,1);
});

for(const locale of["en","fr","ar","ja"])test("provenance re-derives the current principal without cached identity "+locale,async()=>{
  const attribution={session:provenanceSession()},x=await quickEditReferenceView(locale,true,"authored-correction",attribution);
  const original=JSON.stringify(x.f.host.value),{item,event,selected}=openProvenanceCorrection(x);
  const caption=()=>[String(x.host.inspect()),standaloneProvenanceInspection(x)];
  for(const markup of caption())assert.equal(provenanceAuthor(markup),provenanceAttributionExpected[locale].you);
  attribution.session=provenanceSession("owner-suffix");
  for(const markup of caption())assert.equal(provenanceAuthor(markup),provenanceAttributionExpected[locale].human,"a different current account does not inherit You");
  attribution.session={...provenanceSession("owner"),impersonation:{actor:{userId:"actual-principal-private"},fictionalUser:{userId:"owner"}}};
  for(const markup of caption())assert.equal(provenanceAuthor(markup),provenanceAttributionExpected[locale].human,"effective fictional identity is not the current principal");
  attribution.session={...provenanceSession("fictional-private"),impersonation:{actor:{userId:"owner"},fictionalUser:{userId:"fictional-private"}}};
  for(const markup of caption())assert.equal(provenanceAuthor(markup),provenanceAttributionExpected[locale].you,"an exact current principal match stays exact");
  attribution.session=provenanceSession("");
  for(const markup of caption())assert.equal(provenanceAuthor(markup),provenanceAttributionExpected[locale].human,"an empty principal is never You");
  attribution.session=null;
  for(const markup of caption()){
    assert.equal(provenanceAuthor(markup),provenanceAttributionExpected[locale].human);assertProvenancePrivateIdsAbsent(markup,event.actor);
    assert.doesNotMatch(markup,/actual-principal-private|fictional-private|owner-suffix/u);
  }
  assert.equal(x.store.ui.selectedEventId,selected);assert.equal(JSON.stringify(x.f.host.value),original);assert.equal(x.f.calls.length,1);assert.equal(x.calls.length,1);
  // A principal-label port is not authority: the unchanged source fence still
  // withdraws the exact reference as soon as its owner is retired.
  x.withdraw();const retired=String(x.host.inspect());
  assert.ok(retired.includes(workspaceLocalProposalCopy(locale).referenceUnavailable));assert.ok(!retired.includes(item.summary));
  assert.equal(x.f.calls.length,1);
});

for(const locale of["fr","ar","ja"])test("an open human reference re-localizes provenance without another selection "+locale,async()=>{
  const x=await quickEditReferenceView("en",true,"authored-correction",{session:provenanceSession()});
  const {FormaLocaleController,FORMA_DEFAULT_MESSAGES,localeCatalogs}=calmFullPageNativePorts;let publish;
  const snapshot=(language,revision)=>({locale:language,formatLocale:language,direction:language==="ar"?"rtl":"ltr",timeZone:"UTC",messages:{...FORMA_DEFAULT_MESSAGES,...localeCatalogs[language]},revision});
  const controller=new FormaLocaleController({addController(){},requestUpdate(){},dispatchEvent(event){publish=event.callback;publish(snapshot("en",1),()=>{});return true;}});
  controller.hostConnected();x.host.i18n=controller;
  const {item,event,selected}=openProvenanceCorrection(x),original=JSON.stringify(x.f.host.value),draft=x.draft();
  assert.equal(provenanceAuthor(String(x.host.inspect())),provenanceAttributionExpected.en.you);
  publish(snapshot(locale,2));const inspection=String(x.host.inspect());
  assert.equal(provenanceAuthor(inspection),provenanceAttributionExpected[locale].you);assert.ok(inspection.includes(item.summary));
  assert.equal(provenanceAuthor(standaloneProvenanceInspection(x)),provenanceAttributionExpected[locale].you);
  assertProvenancePrivateIdsAbsent(inspection,event.actor);assert.equal(x.store.ui.selectedEventId,selected);
  assert.equal(JSON.stringify(x.f.host.value),original);assert.equal(x.draft(),draft);assert.equal(x.f.calls.length,1);assert.equal(x.calls.length,1);
  controller.hostDisconnected();
});

for(const locale of["en","fr","ar","ja"])test("a recorded user actor does not assert authorship of assistance text "+locale,async()=>{
  const x=await quickEditReferenceView(locale,true,"authored-correction",{session:provenanceSession()});
  const original=JSON.stringify(x.f.host.value),event={...x.history.at(-1),eventId:"recorded-assistance",sequence:x.store.head.get()+1,actor:"user:owner",type:"AssistantReasoned",
    payload:{project_id:"p",document_id:"d",operation:"creative-chat",message:"PRIVATE_ASSISTANCE_PAYLOAD"}};
  x.history.push(event);x.store.patchUi({selectedEventId:event.eventId,inspectorOpen:true});
  for(const markup of[String(x.host.inspect()),standaloneProvenanceInspection(x)]){
    assert.equal(provenanceAuthor(markup),provenanceAttributionExpected[locale].you);
    assert.ok(markup.includes("<dt>"+provenanceAttributionExpected[locale].author+"</dt>"));
    assert.ok(!markup.includes(provenanceOldApproval[locale]));assert.doesNotMatch(markup,/PRIVATE_ASSISTANCE_PAYLOAD/u);
    assertProvenancePrivateIdsAbsent(markup,event.actor);
  }
  assert.equal(JSON.stringify(x.f.host.value),original);assert.equal(x.f.calls.length,1);assert.equal(x.calls.length,1);
});

test("provenance classification never invents identity from malformed or machine actors",()=>{
  for(const actor of[undefined,null,42,{},""," user:owner","user:","user: ","model:","worker:","system:"])assert.equal(provenanceActorMessage(actor,"owner"),"workspace.provenance.unknown");
  assert.equal(provenanceActorMessage("user:owner-suffix","owner"),"workspace.provenance.human");
  assert.equal(provenanceActorMessage("user:OWNER","owner"),"workspace.provenance.human");
  assert.equal(provenanceActorMessage("user:owner"," owner "),"workspace.provenance.human");
  assert.equal(provenanceActorMessage("model:owner","owner"),"workspace.provenance.assistance");
  assert.equal(provenanceActorMessage("user:owner",null),"workspace.provenance.human");
  assert.equal(provenanceActorMessage("user:",""),"workspace.provenance.unknown");
});
