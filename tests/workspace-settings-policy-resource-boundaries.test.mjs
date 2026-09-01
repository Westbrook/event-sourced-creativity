// Additive recovery boundaries. Actual complete Settings/Store, native controls
// and installed Lit Parts; explicitly finite nonfinancial HTTP, not a browser.
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { registerHooks } from "node:module";
import { setup, A, B, notice, saved, endpoint, method } from "./helpers/workspace-policy-native-fixture.mjs";

// Reuse only existing finite fixture declarations; register none of its nine
// tests and expose no application method, field or alternate transport.
const base=new URL("../",import.meta.url);
const tsModule=await import(new URL("node_modules/typescript/lib/typescript.js",base)),ts=tsModule.default??tsModule;
const fixtureUrl=new URL("tests/workspace-settings-policy-native-boundaries.test.mjs",base);
const fixtureSource=fs.readFileSync(fixtureUrl,"utf8"),tree=ts.createSourceFile(fixtureUrl.pathname,fixtureSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
assert.equal(tree.parseDiagnostics.length,0);
const prefix=tree.statements.filter(node=>ts.isImportDeclaration(node)||ts.isVariableStatement(node)||ts.isFunctionDeclaration(node))
  .map(node=>node.getFullText(tree)).join("\n")+"\nexport {invitationRefresh,currentInvitation,INVITE,X,raw};\n";
fixtureUrl.search="policy-resource-boundary-declarations-only";
const loader=registerHooks({load(url,context,next){return url===fixtureUrl.href?{format:"module",source:prefix,shortCircuit:true}:next(url,context);}});
let fixture;try{fixture=await import(fixtureUrl.href);}finally{loader.deregister();}
const {invitationRefresh,currentInvitation,INVITE,X,raw}=fixture;
const options={concurrency:false,timeout:30000};
const get=request=>method(request)==="GET";
const unavailable={status:503,body:{error:"finite_retention_read_unavailable"}};
const invited=f=>f.i18n.t("workspace.admin.invited","A private, expiring invitation was created.");
function retries(f){return f.nodes("button").filter(node=>String(node.handlers.click).includes("this.#load()"));}
function retry(f){const controls=retries(f);assert.equal(controls.length,1,"One current explicit whole-collection Retry, not View access");f.click(controls[0]);}
function heldNative(f,native,form,expected){
  f.draw();const record=native.records().find(item=>item.key==="retention");
  assert.ok(record);assert.equal(record.form,form);assert.equal(form.isConnected,true);
  assert.deepEqual(native.values(),expected);
  const node=f.tree().nodes.find(item=>item.tag==="form"&&item.port===form);assert.ok(node);
  assert.ok(node.hiddenBy,"Raw native fields remain mounted but are not presented");
  let inert=false;for(let parent=node;parent;parent=parent.parent)inert ||= Object.hasOwn(parent.attributes??{},"inert");
  assert.equal(inert,true,"The retained subtree cannot admit native user interaction");
  assert.equal(f.tree().visible("form").some(item=>Object.hasOwn(item.attributes,"data-workspace-policy")),false);
  assert.equal(f.nodes("button").some(item=>String(item.handlers.click).includes("#discardPolicy")),false);
  assert.equal(f.nodes("form").some(item=>String(item.handlers.submit).includes("#submitInvite")),false);
  // No hidden handler is invoked and no input port bypasses native eligibility.
}
function safe(state,before,commandUrl,body){
  const {f,service,snapshot}=state;
  assert.equal(service.pending,0);assert.deepEqual(snapshot(),before);
  assert.deepEqual(service.requests.filter(request=>!get(request)).map(request=>({method:method(request),url:request.url,body:request.body})),
    [{method:commandUrl.endsWith("/members")?"POST":"PATCH",url:commandUrl,body}]);
  assert.equal(service.writes.length,1);
  f.assertNoExternal();assert.deepEqual(f.transport.external,[]);
}
async function retainedAfterInvitation(t){
  const state=await invitationRefresh(t,false),{f,service,native,target,snapshot}=state;
  const before=snapshot(),form=native.fill(B).port;
  const gate=service.queue(request=>get(request)&&request.url===target,"body",structuredClone(unavailable));
  f.submit(currentInvitation(f),INVITE);
  try{await gate.seen.promise;await f.flush(12);assert.equal(native.current().port,form);assert.deepEqual(native.values(),B);}
  finally{gate.release.resolve();await f.flush(24);}
  heldNative(f,native,form,B);assert.ok(notice(f).includes(invited(f)));
  assert.equal(service.writes.length,1);assert.equal(service.pending,0);
  return{...state,before,form};
}

test("Policy unavailable retry rejects malformed positive and stays inert through partial current success",options,async t=>{
  const state=await retainedAfterInvitation(t),{f,service,native,target,before,form}=state;
  const start=service.requests.length;
  const malformed=service.queue(request=>get(request)&&request.url===target,"body",
    {status:200,body:{error:"finite_malformed_retention_envelope",policy:null,appliesTo:"new-scoped-content-only"}});
  retry(f);
  try{
    await malformed.seen.promise;await f.flush(12);heldNative(f,native,form,B);
    const controls=retries(f);assert.equal(controls.length,1);assert.equal(Object.hasOwn(controls[0].attributes,"disabled"),true);
  }finally{malformed.release.resolve();await f.flush(24);}
  heldNative(f,native,form,B);assert.ok(f.nodes("p").some(node=>node.attributes.role==="alert"));
  // This fixture has no overview automation projects; hold the actual final
  // required owner resource without fabricating another project or response.
  const last=service.queue(request=>get(request)&&request.url===endpoint("A","/deletion"),"body");
  retry(f);
  try{
    await last.seen.promise;await f.flush(12);heldNative(f,native,form,B);
    assert.equal(last.jsonCalls,1,"Current earlier positive resources do not complete the last pending body");
    const controls=retries(f);assert.equal(controls.length,1);assert.equal(Object.hasOwn(controls[0].attributes,"disabled"),true);
    assert.ok(notice(f).includes(invited(f)));assert.equal(service.writes.length,1);
  }finally{last.release.resolve();await f.flush(24);}
  assert.equal(native.current().port,form);assert.deepEqual(native.values(),B);assert.ok(native.eligibility().every(item=>item.enabled));
  assert.equal(retries(f).length,0);assert.equal(f.nodes("p").some(node=>node.attributes.role==="alert"),false);
  assert.ok(service.requests.slice(start).every(get));safe(state,before,endpoint("A","/members"),INVITE);
});

test("Policy unavailable retained form is withdrawn at current denied headers and never resurrected",options,async t=>{
  const state=await retainedAfterInvitation(t),{f,service,native,target,before,form}=state;
  const fields=[...native.record().fields.values()].map(item=>item.node),start=service.requests.length;
  const denial=service.queue(request=>get(request)&&request.url===target,"body",{status:403,body:{error:"access_denied"}});
  retry(f);
  try{
    await denial.seen.promise;await f.flush(12);
    assert.equal(denial.jsonCalls,0);assert.equal(form.isConnected,false);assert.ok(fields.every(field=>!field.isConnected));
    assert.equal(native.records().some(record=>record.key==="retention"),false);
    assert.equal(f.values().includes(B.transientDays),false);assert.ok(notice(f).includes(invited(f)));
  }finally{denial.release.resolve();await f.flush(12);}
  retry(f);await f.flush(24);
  assert.notEqual(native.current().port,form);assert.deepEqual(native.values(),raw(X));assert.equal(form.isConnected,false);
  assert.equal(native.current().port.getAttribute("data-workspace-policy-dirty"),"false");
  assert.ok(service.requests.slice(start).every(get));safe(state,before,endpoint("A","/members"),INVITE);
});

test("Policy unavailable recovery cannot retain a draft across current positive permission loss",options,async t=>{
  const state=await retainedAfterInvitation(t),{f,service,native,before,form}=state;
  const start=service.requests.length;
  // Existing finite service emits its administrator read-only permission set.
  // This is not a permission command or a claim about a real second actor.
  service.roles.A="administrator";
  retry(f);await f.flush(24);
  assert.equal(form.isConnected,false);assert.equal(native.records().some(record=>record.key==="retention"),false);
  assert.equal(f.values().includes(B.transientDays),false);assert.equal(retries(f).length,0);
  assert.ok(notice(f).includes(invited(f)));assert.equal(service.writes.length,1);
  service.roles.A="owner";f.navigate("B");await f.flush(24);f.navigate("A");await f.flush(24);
  assert.notEqual(native.current().port,form);assert.deepEqual(native.values(),raw(X));
  assert.ok(service.requests.slice(start).every(get));safe(state,before,endpoint("A","/members"),INVITE);
});

test("Policy retained unavailable native values retire on real route and principal departure",options,async t=>{
  const state=await retainedAfterInvitation(t),{f,service,native,before,form}=state;
  const start=service.requests.length;
  f.navigate("B");await f.flush(24);assert.equal(form.isConnected,false);
  f.navigate("A");await f.flush(24);assert.notEqual(native.current().port,form);assert.deepEqual(native.values(),raw(X));
  safe(state,before,endpoint("A","/members"),INVITE);
  const newer=native.fill(B).port;
  await f.refreshAuthority({user:{...service.session.user,userId:"finite-other-policy-principal"}});await f.flush(24);
  assert.equal(newer.isConnected,false);assert.notEqual(native.current().port,newer);assert.deepEqual(native.values(),raw(X));
  assert.equal(form.isConnected,false);assert.ok(service.requests.slice(start).every(get));
  assert.equal(f.store.session.get().user.userId,"finite-other-policy-principal");
  // Store intentionally clears the former principal's private source. Require
  // that clearance, while retaining exact fiscal/credential and request checks.
  safe(state,{...before,events:[],content:{},head:0},endpoint("A","/members"),INVITE);
});

for(const mode of ["unchangedA","newerB"])test("Policy known own A with unavailable collection preserves "+mode+" without a stale-default reset",options,async t=>{
  const state=await setup(t),{f,service,native,target,snapshot}=state,before=snapshot();
  const form=native.fill(A).port,ack=service.queue(request=>method(request)==="PATCH"&&request.url===target,"headers");
  const failure=service.queue(request=>get(request)&&request.url===target,"body",structuredClone(unavailable));
  native.submit();
  try{
    await ack.seen.promise;f.draw();if(mode==="newerB")native.fill(B);
    ack.release.resolve();await failure.seen.promise;await f.flush(12);
    assert.equal(native.current().port,form);assert.deepEqual(native.values(),mode==="newerB"?B:A);
    assert.ok(notice(f).includes(saved(f)),"Known A acknowledgement is separate from its unavailable follow-up read");
  }finally{ack.release.resolve();failure.release.resolve();await f.flush(24);}
  const expected=mode==="newerB"?B:A;
  heldNative(f,native,form,expected);assert.ok(notice(f).includes(saved(f)));
  assert.equal(form.getAttribute("data-workspace-policy-dirty"),mode==="newerB"?"true":"false");
  assert.equal(notice(f).includes(f.i18n.t("workspace.admin.newerFormKept")),mode==="newerB");
  const start=service.requests.length;retry(f);await f.flush(24);
  assert.equal(native.current().port,form);assert.deepEqual(native.values(),expected);assert.equal(retries(f).length,0);
  assert.ok(notice(f).includes(saved(f)));assert.ok(service.requests.slice(start).every(get));
  assert.equal(state.policy().transient_days,Number(A.transientDays));assert.equal(state.policy().legal_hold,0);
  safe(state,before,target,{transientDays:31,evidenceDays:366,revisionDays:120,legalHold:false});
});
