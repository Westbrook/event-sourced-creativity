import assert from "node:assert/strict";
import test from "node:test";
import { createSceneCostFixture } from "./helpers/scene-cost-fixture.mjs";
import { createSceneStoreHost, sceneDeferred } from "./helpers/scene-cost-store-host.mjs";
import { loadActual, settle } from "./helpers/artifact-review-host.mjs";
const { fixture } = await import(new URL("./inactive-generation-dialog-fixture.mjs?artifact-review-full-host", import.meta.url));
const { FormaActivity } = await loadActual("src/components/forma-activity.ts");
const { FormaActivityIssuePanel } = await loadActual("src/components/forma-activity-issue-panel.ts");
const { localizeTemplateResult } = await loadActual("src/components/design-system/localized-template.ts");
const financeTables = ["document_jobs", "budget_reservations", "cost_budget_reservations", "cost_budget_counters"];
const noteA = "Original private note A.", noteB = "Newer unsent private note B.";
async function noteSetup(t, locale) {
  const worker = await createSceneCostFixture(1, "visual", { depth: true });
  const ids = ["current-private-note-job", "unrelated-private-note-job"];
  const now = new Date().toISOString(), expires = new Date(Date.now() + 3600000).toISOString();
  // Explicit failed-job fixture rows, not evidence of a provider execution.
  for (const id of ids) worker.sqlite.prepare("INSERT INTO document_jobs(job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,request_json,result_json,error_message,attempt_count,requested_at,started_at,completed_at,expires_at,updated_at) VALUES(?,?,?,?,?,'failed','activity',?,1,'{}','{}','source_fidelity_validation_failed',1,?,?,?,?,?)")
    .run(id, worker.owner, worker.streamId, worker.documentId, "render_document", id, now, now, now, expires, now);
  const h = await createSceneStoreHost({ workerFixture: worker });
  t.mock.method(globalThis, "fetch", (url, init) => { assert.ok(String(url).startsWith("/api/"), "no external/provider call"); return h.fetch(url, init); });
  await h.store.syncDocumentJobs();
  for (const id of ids) assert.ok(h.store.documentJobs.get().some(row => row.jobId === id && row.status === "failed"));
  const f = fixture("create", { locale });
  f.host.disconnectedCallback(); f.host.isConnected = false; f.store = h.store;
  f.host = new FormaActivity(); f.host.store = h.store; f.host.i18n = f.i18n; f.host.tag = "forma-activity"; f.host.isConnected = true;
  f.renderer.registry["forma-activity-issue-panel"] = FormaActivityIssuePanel;
  const render = f.renderer.value;
  f.renderer.value = function(value, ...rest) { return render.call(this, localizeTemplateResult(value, f.i18n), ...rest); };
  h.store.route.set("/activity?document=" + worker.documentId); f.draw();
  const panel = id => [...f.renderer.instances.values()].map(row => row.instance)
    .find(row => row instanceof FormaActivityIssuePanel && row.isConnected && row.job?.jobId === id);
  assert.ok(panel(ids[0])); assert.ok(panel(ids[1]));
  const own = (id, tag) => f.renderer.ownNodes(panel(id), tag);
  const editor = (id = ids[0]) => own(id, "textarea").find(node => node.handlers.input?.toString().includes("#noteDraft"));
  const type = (id, value) => { const node = editor(id); assert.ok(node?.isConnected && f.renderer.nodes.includes(node)); assert.equal(Object.hasOwn(node.attributes, "disabled"), false); assert.equal(Object.hasOwn(node.attributes, "readonly"), false); node.value = value; node.handlers.input.call(panel(id), { target: node, currentTarget: node }); f.draw(); };
  const detailsPort = own(ids[0], "details").find(node => node.handlers.toggle?.toString().includes("#loadNotes"));
  assert.ok(detailsPort);
  const detailsType = Object.getOwnPropertyDescriptor(globalThis, "HTMLDetailsElement");
  const NativeElement = detailsPort.constructor;
  // The reused native port did not need HTMLDetailsElement before these actual
  // disclosure cases. Supply only its exact native tag/type check and restore it.
  Object.defineProperty(globalThis, "HTMLDetailsElement", { configurable: true, value: class {
    static [Symbol.hasInstance](value) { return value instanceof NativeElement && value.tag === "details"; }
  } });
  t.after(() => { if (detailsType) Object.defineProperty(globalThis, "HTMLDetailsElement", detailsType); else delete globalThis.HTMLDetailsElement; });
  const open = async id => { const details = own(id, "details").find(node => node.handlers.toggle?.toString().includes("#loadNotes")); assert.ok(details); details.open = true; details.handlers.toggle.call(panel(id), { currentTarget: details }); await settle(f, () => !Object.hasOwn(own(id, "button").find(node => node.attributes.type === "submit").attributes, "disabled")); };
  await open(ids[0]); await open(ids[1]);
  const saves = [], originalSave = h.store.saveActivityIssueNote.bind(h.store);
  t.mock.method(h.store, "saveActivityIssueNote", (...args) => { const pending = originalSave(...args); saves.push({ args: structuredClone(args), pending }); return pending; });
  const finance = () => Object.fromEntries(financeTables.map(table => [table, worker.sqlite.prepare("SELECT * FROM " + table + " ORDER BY rowid").all()]));
  const initialFinance = finance();
  t.after(async () => { await Promise.allSettled(saves.map(row => row.pending)); assert.deepEqual(finance(), initialFinance); f.host.isConnected = false; f.host.disconnectedCallback(); for (const row of f.renderer.instances.values()) if (row.instance.isConnected) { row.instance.isConnected = false; row.instance.disconnectedCallback(); } f.i18n.hostDisconnected(); await h.close(); });
  const save = () => { const form = own(ids[0], "form").find(node => node.handlers.submit?.toString().includes("#saveNote")); assert.ok(form?.isConnected); const button = own(ids[0], "button").find(node => node.attributes.type === "submit"); assert.equal(Object.hasOwn(button.attributes, "disabled"), false); form.handlers.submit.call(panel(ids[0]), { currentTarget: form, preventDefault() {} }); };
  return {worker,h,f,ids,own,editor,type,save,saves,panel,finance,initialFinance,expires};
}
for (const locale of ["en", "fr", "ar", "ja"]) for (const scenario of ["unchanged", "new-note", "rejected-unlocks"])
test("private issue note current pending " + locale + "/" + scenario, async t => {
  const release=sceneDeferred(), entered=sceneDeferred();let reply;
  t.after(()=>release.resolve());
  const p = await noteSetup(t, locale), {h,worker,f,ids}=p;
  p.type(ids[0], noteA); p.type(ids[1], "Unrelated private draft.");
  h.intercept=async request=>{
    if(request.url!=="/api/document-jobs/"+ids[0]+"/notes"||request.init.method!=="POST")return undefined;
    if(scenario==="rejected-unlocks")worker.sqlite.prepare("UPDATE document_jobs SET expires_at='2000-01-01T00:00:00.000Z' WHERE job_id=?").run(ids[0]);
    const response=await worker.request(request.url,request.init);
    if(scenario==="rejected-unlocks")worker.sqlite.prepare("UPDATE document_jobs SET expires_at=? WHERE job_id=?").run(p.expires,ids[0]);
    reply={status:response.status,body:await response.clone().json(),request:structuredClone(request.body)};
    entered.resolve();await release.promise;return response;
  };
  p.save();await entered.promise;assert.equal(reply.status,scenario==="rejected-unlocks"?404:201,JSON.stringify(reply));f.draw();
  const locked=Object.hasOwn(p.editor().attributes,"readonly")||Object.hasOwn(p.editor().attributes,"disabled");
  if(scenario==="new-note"&&!locked)p.type(ids[0],noteB);
  const before=p.editor().value;
  release.resolve();const saved=await p.saves[0].pending.catch(error=>error);await settle(f,()=>!Object.hasOwn(p.own(ids[0],"button").find(node=>node.attributes.type==="submit").attributes,"disabled"));
  const after=p.editor().value;
  if(scenario==="rejected-unlocks"){assert.ok(saved instanceof Error);assert.equal(reply.body.error,"job_not_found");}
  else assert.equal(saved.body,noteA);
  assert.equal(reply.request.body,noteA);
  assert.equal(p.editor(ids[1]).value,"Unrelated private draft.");
  const records=worker.sqlite.prepare("SELECT content FROM private_content WHERE kind='activity-issue-note'").all().map(row=>JSON.parse(row.content).body);
  assert.deepEqual(records,scenario==="rejected-unlocks"?[]:[noteA]);assert.equal(h.requests.filter(r=>r.url==="/api/document-jobs/"+ids[0]+"/notes"&&r.init.method==="POST").length,1);
  assert.deepEqual(p.finance(),p.initialFinance);
  t.diagnostic(JSON.stringify({locale,scenario,locked,before,after,realWorkerStatus:reply.status,canonicalNotes:records,externalProviderCalls:0}));
  if(scenario!=="unchanged")assert.equal(locked,true,"the current private-note field explicitly refuses another draft until this save finishes");
  if(scenario==="rejected-unlocks"){assert.equal(after,noteA);assert.equal(Object.hasOwn(p.editor().attributes,"readonly"),false);p.type(ids[0],noteB);assert.equal(p.editor().value,noteB);assert.equal(p.saves.length,1);}
  else assert.equal(after,"");
});
