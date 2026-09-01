import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import { registerHooks } from "node:module";

// Reuse complete host/real catalogs and existing template ports. The session,
// routes and local HTTP/body delivery are finite ports, NOT backend/AT evidence.
const fixtureUrl=new URL("./specialist-guidance-localization.test.mjs",import.meta.url);
const source=fs.readFileSync(fixtureUrl,"utf8"),tree=ts.createSourceFile(fixtureUrl.pathname,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const firstLoop=tree.statements.find(ts.isForOfStatement);assert.ok(firstLoop);
const virtual=new URL(fixtureUrl);virtual.search="?access-ownership-fixture";
const hooks=registerHooks({load(url,context,next){return url===virtual.href?{format:"module",source:source.slice(0,firstLoop.getFullStart())+"\nexport {access,grants,reply,namedButtons};",shortCircuit:true}:next(url,context);}});
let shared;try{shared=await import(virtual.href);}finally{hooks.deregister();}
const {access,grants,reply,namedButtons}=shared;
const defer=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});
const has=(f,key)=>f.visible().includes(f.i18n.t(key));
const writes=f=>f.calls.filter(call=>call.method!=="GET");
const submit=f=>f.renderer.handler(f.host,"form",node=>node.attributes.class==="access-grant-form","submit");
const revoke=f=>{const button=namedButtons(f,"access.revoke")[0];assert.ok(button);return f.renderer.handler(f.host,"button",node=>node.attributes["aria-label"]===button.name());};
const refresh=async f=>{const button=f.buttons().find(button=>button.text===f.i18n.t("access.refresh"));assert.ok(button);assert.equal(button.attributes.disabled,undefined);await button.handlers.click.call(f.host,{preventDefault(){},currentTarget:{}});await f.flush();};
const locked=f=>f.nodes().filter(node=>node.tag==="button"&&(node.attributes.type==="submit"||node.visibleLabel()===f.i18n.t("access.revoke"))).every(node=>node.disabled());
const ownerB=f=>({...f.currentSession,user:{...f.currentSession.user,userId:"operator-B"},permissionEpoch:"scope-B"});
function useRowsB(f){
  f.currentUsers=[{user_id:"person-B",display_name:"B current person",email:"b@example.invalid",role:"creator"}];
  f.currentGrants=[{...grants[0],grant_id:"grant-B/current",user_id:"person-B",display_name:"B current person",email:"b@example.invalid"}];
}
for(const locale of ["en","fr","ar","ja"]){
  test("specialist access "+locale+": loading is not empty; a complete empty pair is",async t=>{
    const people=defer(),list=defer();
    const f=await access(t,locale,{transport:call=>call.url==="/api/admin/users"?people.promise:list.promise});
    assert.ok(has(f,"access.loading"));assert.ok(!has(f,"access.none"));assert.equal(f.renderer.ownNodes(f.host,"form").length,0);
    people.resolve(reply({users:[{user_id:"private-A",display_name:"Not yet published",email:"a@example.invalid",role:"creator"}]}));await f.flush();
    assert.ok(!f.visible().includes("Not yet published"));assert.ok(!has(f,"access.none"));
    list.resolve(reply({grants:[]}));await f.flush();
    assert.ok(has(f,"access.none"));assert.ok(!has(f,"access.loading"));assert.ok(f.visible().includes("Not yet published"));
    assert.deepEqual(writes(f),[]);
  });
  test("specialist access "+locale+": failed read stays distinct from empty and Refresh is read-only",async t=>{
    let failed=true;
    const f=await access(t,locale,{transport:(call,_f,next)=>failed?response({error:"temporary_read_failure"},500):next(call)});
    assert.ok(has(f,"access.loadFailed"));assert.ok(!has(f,"access.none"));assert.equal(f.renderer.ownNodes(f.host,"form").length,0);
    failed=false;await refresh(f);assert.ok(!has(f,"access.loadFailed"));assert.equal(namedButtons(f,"access.revoke").length,grants.length);
    assert.deepEqual(writes(f),[]);
  });
  test("specialist access "+locale+": unavailable status does not render or parse a private list",async t=>{
    let parsed=0;
    const f=await access(t,locale,{transport:()=>({ok:false,status:403,json:async()=>{parsed++;return{grants};}})});
    assert.ok(has(f,"access.unavailable"));assert.ok(!has(f,"access.none"));assert.equal(parsed,0);
    assert.equal(namedButtons(f,"access.revoke").length,0);assert.deepEqual(writes(f),[]);
  });
  for(const kind of ["grant","revoke"])test("specialist access "+locale+": unconfirmed "+kind+" remains read-only after a successful list refresh",async t=>{
    const f=await access(t,locale,{transport:(call,_f,next)=>{
      if(call.method==="POST")throw new Error("Mocked acknowledgement lost");
      if(call.method==="DELETE")return response({error:"mocked_after_write_failure"},500);
      return next(call);
    }});
    const before=structuredClone(f.currentGrants),action=kind==="grant"?submit(f):revoke(f);
    await action();await f.flush();
    assert.equal(writes(f).length,1);assert.ok(has(f,"access.changeUnknown"));assert.ok(has(f,"access.unknownReadOnly"));assert.ok(locked(f));
    await refresh(f);assert.equal(writes(f).length,1);assert.ok(has(f,"access.changeUnknown"));assert.ok(locked(f));
    // Guarded current handlers cannot turn the read-only inspection into another write.
    await (kind==="grant"?submit(f):revoke(f))();await f.flush();assert.equal(writes(f).length,1);
    assert.deepEqual(f.currentGrants,before);
    const calls=structuredClone(f.calls);
    for(const language of ["en","fr","ar","ja"]){f.changeLocale(language);assert.ok(has(f,"access.changeUnknown"));assert.ok(has(f,"access.unknownReadOnly"));assert.ok(locked(f));}
    assert.deepEqual(f.calls,calls);
  });
}
for(const kind of ["grant","revoke"])test("specialist access same-owner "+kind+" admits one exact pending change and consumes its acknowledgement",async t=>{
  const pending=defer();
  const f=await access(t,"en",{transport:(call,_f,next)=>call.method==="GET"?next(call):pending.promise});
  const action=kind==="grant"?submit(f):revoke(f),first=action(),second=action();await f.flush();
  assert.equal(writes(f).length,1);assert.ok(locked(f));assert.ok(has(f,kind==="grant"?"access.grantPending":"access.revokePending"));
  const request=writes(f)[0];
  if(kind==="grant"){assert.equal(request.url,"/api/platform/access");assert.equal(request.body.userId,grants[0].user_id);assert.equal(typeof request.body.capability,"string");}
  else assert.equal(request.url,"/api/platform/access/"+encodeURIComponent(grants[0].grant_id));
  pending.resolve(response(kind==="grant"?{ok:true,grantId:"acknowledged-original"}:{ok:true},kind==="grant"?201:200));
  await Promise.all([first,second]);await f.flush();
  assert.equal(writes(f).length,1);assert.equal(f.calls.filter(call=>call.method==="GET").length,4);
  assert.ok(has(f,kind==="grant"?"access.grantAcknowledged":"access.revokeAcknowledged"));assert.ok(!locked(f));assert.ok(!has(f,"access.changeUnknown"));
});
test("specialist access known refusal refreshes without retry or claiming success",async t=>{
  let actionRefusal=false;
  const f=await access(t,"en",{transport:(call,_f,next)=>call.method==="POST"?response({error:actionRefusal?"self_privilege_escalation_forbidden":"valid_user_and_capability_required"},actionRefusal?403:400):next(call)});
  await submit(f)();await f.flush();assert.equal(writes(f).length,1);assert.ok(has(f,"access.changeRefused"));
  assert.ok(!has(f,"access.grantAcknowledged"));assert.ok(!has(f,"access.changeUnknown"));assert.ok(!locked(f));
  actionRefusal=true;await submit(f)();await f.flush();assert.equal(writes(f).length,2);
  assert.ok(has(f,"access.changeRefused"));assert.ok(!has(f,"access.unavailable"));assert.ok(!locked(f));
});
test("specialist access malformed paired read is unavailable evidence, not an empty grant list",async t=>{
  const f=await access(t,"en",{transport:call=>reply(call.url==="/api/admin/users"?{users:[]}:{grants:[{grant_id:"incomplete"}]})});
  assert.ok(has(f,"access.loadFailed"));assert.ok(!has(f,"access.none"));assert.equal(namedButtons(f,"access.revoke").length,0);assert.deepEqual(writes(f),[]);
});
for(const outcome of ["late-body","late-error"])test("specialist access owner change discards "+outcome+" without mixing or replacing current rows",async t=>{
  const body=defer();let listReads=0;
  const f=await access(t,"en",{transport:(call,_f,next)=>{
    if(call.url==="/api/platform/access"&&call.method==="GET"&&++listReads===1)return{ok:true,status:200,json:()=>body.promise};
    return next(call);
  }});
  assert.ok(has(f,"access.loading"));assert.ok(!f.visible().includes(grants[0].display_name));
  useRowsB(f);f.setSession(ownerB(f));await f.flush();assert.ok(f.visible().includes("B current person"));
  if(outcome==="late-body")body.resolve({grants});else body.reject(new Error("Old private read failure"));
  await f.flush();assert.ok(f.visible().includes("B current person"));assert.ok(!f.visible().includes(grants[0].display_name));
  assert.ok(!has(f,"access.loadFailed"));assert.deepEqual(writes(f),[]);
});
for(const kind of ["grant","revoke"])test("specialist access old "+kind+" completion cannot clear a newer owner's pending change or refresh its list",async t=>{
  const old=defer(),newer=defer();let mutationCalls=0;
  const f=await access(t,"en",{transport:(call,_f,next)=>call.method==="GET"?next(call):++mutationCalls===1?old.promise:newer.promise});
  const first=(kind==="grant"?submit(f):revoke(f))();await f.flush();
  useRowsB(f);f.setSession(ownerB(f));await f.flush();
  const second=(kind==="grant"?submit(f):revoke(f))();await f.flush();const callsBefore=f.calls.length;
  old.resolve(response(kind==="grant"?{ok:true,grantId:"old-A"}:{ok:true}));await first;await f.flush();
  assert.equal(f.calls.length,callsBefore);assert.ok(locked(f));assert.ok(has(f,kind==="grant"?"access.grantPending":"access.revokePending"));
  assert.ok(!f.visible().includes(grants[0].display_name));
  newer.resolve(response(kind==="grant"?{ok:true,grantId:"current-B"}:{ok:true}));await second;await f.flush();
  assert.equal(writes(f).length,2);assert.ok(!locked(f));assert.ok(f.visible().includes("B current person"));
});
for(const boundary of ["route","disconnect"])test("specialist access "+boundary+" retirement prevents old-read resurrection on a new opening",async t=>{
  const old=defer();let first=true;
  const f=await access(t,"en",{transport:(call,_f,next)=>{
    if(call.url==="/api/platform/access"&&first){first=false;return old.promise;}return next(call);
  }});
  if(boundary==="route")f.navigate("/operations/providers");
  else{f.host.disconnectedCallback();f.host.isConnected=false;}
  useRowsB(f);
  if(boundary==="route")f.navigate("/operations/access");
  else{f.host.isConnected=true;f.host.connectedCallback();}
  await f.flush();assert.ok(f.visible().includes("B current person"));
  old.resolve(reply({grants}));await f.flush();assert.ok(f.visible().includes("B current person"));
  assert.ok(!f.visible().includes(grants[0].display_name));assert.deepEqual(writes(f),[]);
});
test("specialist access reset hides current private rows and old current-control handlers cannot dispatch for a replacement owner",async t=>{
  const f=await access(t,"en"),oldSubmit=submit(f),oldRevoke=revoke(f),session=f.currentSession;
  f.setSession(null);await f.flush();assert.ok(has(f,"access.unavailable"));assert.ok(!f.visible().includes(grants[0].display_name));
  const calls=f.calls.length;await oldSubmit();await oldRevoke();assert.equal(f.calls.length,calls);
  useRowsB(f);f.setSession({...session,user:{...session.user,userId:"operator-B"},permissionEpoch:"scope-B"});await f.flush();
  await oldSubmit();await oldRevoke();assert.deepEqual(writes(f),[]);assert.ok(f.visible().includes("B current person"));
});
test("specialist access invalid success acknowledgement never enables an automatic or manual duplicate in the same opening",async t=>{
  const f=await access(t,"en",{transport:(call,_f,next)=>call.method==="POST"?reply({ok:true}):next(call)});
  await submit(f)();await f.flush();assert.ok(has(f,"access.changeUnknown"));assert.ok(locked(f));
  await refresh(f);await submit(f)();assert.equal(writes(f).length,1);assert.ok(has(f,"access.changeUnknown"));
});
