// Additive pair only; reuse the already installed two-policy finite fixture and
// actual current invitation/GET path. No private application loader or command.
import assert from "node:assert/strict";
import test, { after } from "node:test";
import fs from "node:fs";
import { registerHooks } from "node:module";
import { endpoint, method } from "./helpers/workspace-policy-native-fixture.mjs";

const base=new URL("../",import.meta.url);
const tsModule=await import(new URL("node_modules/typescript/lib/typescript.js",base)),ts=tsModule.default??tsModule;
const fixtureUrl=new URL("tests/workspace-settings-policy-cross-surface.test.mjs",base);
const fixtureSource=fs.readFileSync(fixtureUrl,"utf8"),tree=ts.createSourceFile(fixtureUrl.pathname,fixtureSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
assert.equal(tree.parseDiagnostics.length,0);
const declarations=tree.statements.filter(node=>ts.isImportDeclaration(node)||ts.isVariableStatement(node)||ts.isFunctionDeclaration(node));
const prefix=declarations.map(node=>node.getFullText(tree)).join("\n")
  +"\nexport {automationFixture,currentInvitation,INVITE,FIRST,SECOND,key,RAW,noPolicyWrites};\n";
fixtureUrl.search="policy-automation-resource-declarations-only";
const loader=registerHooks({load(url,context,next){return url===fixtureUrl.href?{format:"module",source:prefix,shortCircuit:true}:next(url,context);}});
let fixture;try{fixture=await import(fixtureUrl.href);}finally{loader.deregister();}
const {automationFixture,currentInvitation,INVITE,FIRST,SECOND,key,RAW,noPolicyWrites}=fixture;
const observations=[];
after(()=>console.log("AUTOMATION_RESOURCE_CASES "+JSON.stringify({expected:2,observations:observations.length,originalCrossSurfaceTestsRegistered:0})));

function observed(f,native,originals){
  f.draw();const all=f.tree().nodes;
  return Object.fromEntries([FIRST,SECOND].map(id=>{
    const current=native.records().find(record=>record.key===key(id)),node=current&&all.find(item=>item.tag==="form"&&item.port===current.form);
    let inert=false;for(let item=node;item;item=item.parent)inert ||= Object.hasOwn(item.attributes??{},"inert");
    return[id,{mounted:Boolean(current?.form.isConnected),sameForm:current?.form===originals.get(id),
      oldConnected:originals.get(id).isConnected,hidden:Boolean(node?.hiddenBy),inert,
      values:current?native.values(key(id)):null}];
  }));
}

for(const mode of ["healthy200","temporary503"])test("Policy automation same-owner current resource "+mode+" retains exact native drafts",{concurrency:false,timeout:30000},async t=>{
  const {f,service,native,snapshot,inviteUrl}=await automationFixture(t,"reorder"),reply=service.reply;
  const target=endpoint("A","/projects/"+FIRST+"/automation"),delivered=[];let first=true;
  service.reply=request=>{
    const result=reply(request);
    if(method(request)==="GET"&&request.url===target){
      const original=structuredClone(result),initial=first;first=false;
      assert.equal(result.status,200,"The existing finite current policy itself is unchanged and readable");
      const value=initial&&mode==="temporary503"?{status:503,body:{error:"finite_automation_read_unavailable"}}:result;
      delivered.push({original,delivered:structuredClone(value)});return value;
    }
    return result;
  };
  const before=snapshot(),route=f.store.route.get(),scope=f.store.captureAuthorizationScope(),originals=new Map();
  for(const id of [FIRST,SECOND])originals.set(id,native.fill(RAW[id],key(id)).port);
  f.draw();const gate=service.queue(request=>method(request)==="GET"&&request.url===target,"body");
  f.submit(currentInvitation(f),INVITE);
  try{
    await gate.seen.promise;await f.flush(12);
    for(const id of [FIRST,SECOND]){assert.equal(native.current(key(id)).port,originals.get(id));assert.deepEqual(native.values(key(id)),RAW[id]);}
    assert.equal(service.writes.length,1);
  }finally{gate.release.resolve();await f.flush(24);}
  const settled=observed(f,native,originals),alerts=f.nodes("p").filter(node=>node.attributes.role==="alert").map(node=>node.text);
  const retries=f.nodes("button").filter(node=>String(node.handlers.click).includes("this.#load()"));
  let retryRequests=0;
  if(retries.length){
    assert.equal(retries.length,1);const requestStart=service.requests.length;
    f.click(retries[0]);await f.flush(24);retryRequests=service.requests.length-requestStart;
    assert.ok(retryRequests>0);assert.ok(service.requests.slice(requestStart).every(request=>method(request)==="GET"));
  }
  const recovered=observed(f,native,originals);
  assert.equal(service.pending,0);assert.equal(f.store.route.get(),route);assert.equal(f.store.authorizationScopeActive(scope),true);
  assert.deepEqual(snapshot(),before);noPolicyWrites(f,service,1);
  assert.deepEqual(service.writes.map(write=>({method:write.method,url:write.url,body:write.body})),[{method:"POST",url:inviteUrl,body:INVITE}]);
  assert.ok(delivered.length>=1);assert.equal(delivered[0].delivered.status,mode==="healthy200"?200:503);
  for(const item of delivered.slice(1))assert.deepEqual(item.delivered,item.original);
  const observation={mode,settled,recovered,alerts,retryControls:retries.length,retryRequests,
    deliveredStatuses:delivered.map(item=>item.delivered.status),invitationWrites:1,automationWrites:0,budgetWrites:0,
    providerAttempts:0,sourceAndFiscalUnchanged:true,
    evidence:"Complete actual Settings/Store/Lit native forms; existing finite authorized two-project report + one current invitation ACK; only one automation503 delivery is substituted. No real automation, permission, email, finance or browser claim."};
  observations.push(observation);console.log("AUTOMATION_RESOURCE_OBSERVATION "+JSON.stringify(observation));
  // Record the current old-source omission and available controls before any
  // desired assertion; the candidate can use only a real current Retry.
  if(mode==="temporary503"){
    assert.equal(retries.length,1,"A temporary exact policy failure needs explicit current-read recovery, not silent row deletion");
    for(const id of [FIRST,SECOND]){assert.equal(settled[id].mounted,true);assert.equal(settled[id].hidden&&settled[id].inert,true);}
  }else assert.equal(retries.length,0);
  for(const id of [FIRST,SECOND]){
    assert.equal(recovered[id].sameForm,true,"Each original native project policy form retains its own raw values");
    assert.deepEqual(recovered[id].values,RAW[id]);assert.equal(recovered[id].hidden||recovered[id].inert,false);
  }
});
