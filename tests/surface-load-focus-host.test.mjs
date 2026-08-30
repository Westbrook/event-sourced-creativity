// Actual PlatformShell and public-share/SharedView load-lifetime regressions.
// The existing full-class renderer and native focus lease are reused unchanged.
// Session/module delivery and guest HTTP Responses are finite dependency ports;
// these tests do not certify CSS, browser navigation, backend authority or AT.
import assert from "node:assert/strict";
import test from "node:test";
import { calmFullPageNativePorts as ports } from "./helpers/calm-full-page-fixture.mjs";
import { installOutputNavigationFocusNative } from "./helpers/output-navigation-focus-native.mjs";

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const sessionValue=()=>({user:{userId:"fixture-operator",email:"operator@example.invalid",displayName:"Fixture operator",role:"admin"},
  audience:"operations",permissionEpoch:"fixture-epoch",organizations:[],canvas:{access:false},
  capabilities:["platform.identity.manage","platform.policy.manage","platform.provider.configure","platform.release.approve","platform.incident.manage"],
  availableApplications:[{id:"operations",href:"/operations"}]});
const sharedBody=title=>({projection:{projectName:"Synthetic public project",documentTitle:title,blocks:[],outputs:[],artifacts:[]},
  share:{expiresAt:"2030-01-01T00:00:00.000Z"}});
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});

async function hostFixture(t,kind,locale,options={}){
  const f={locale,nativeUrlParts:Boolean(options.nativeUrlParts),trace:[],clipboard:[],listeners:new Map(),changed:new Map(),requested:false,
    resizeTargets:new Map(),frames:new Map(),timers:new Map(),timerSequence:0,storage:new Map(),
    route:kind==="platform"?"/operations/providers":"/share/token-a",
    sessionReads:[],modules:[],reads:[],completions:[],populations:[],renderWaits:[],holdUpdates:false,
    title:"Previous page — Forma",titles:[],assignments:[],session:sessionValue(),sessionListeners:new Set()};
  f.store={route:{get:()=>f.route}}; // URL port only: neither host owns a Creator Store.
  ports.bindFixture(f);
  const undo=[];
  const replace=(object,key,descriptor)=>{
    const before=Object.getOwnPropertyDescriptor(object,key);
    Object.defineProperty(object,key,{configurable:true,...descriptor});
    undo.push(()=>{if(before)Object.defineProperty(object,key,before);else delete object[key];});
  };
  const messages={...ports.FORMA_DEFAULT_MESSAGES,...ports.localeCatalogs[locale]};
  const snapshot={locale,formatLocale:locale,direction:locale==="ar"?"rtl":"ltr",timeZone:"UTC",messages,revision:1};
  f.i18n=new ports.FormaLocaleController({addController(){},requestUpdate(){},
    dispatchEvent(event){event.callback(snapshot,()=>{});return true;}});
  f.i18n.hostConnected();
  // Implement the native Lit controller lifecycle omitted by the reusable port.
  // SharedView's private locale controller and its messages stay production code.
  replace(ports.ElementPort.prototype,"addController",{value(controller){(this.fixtureControllers??=[]).push(controller);}});
  replace(ports.ElementPort.prototype,"connectedCallback",{value(){for(const controller of this.fixtureControllers??[])controller.hostConnected?.();}});
  replace(ports.ElementPort.prototype,"disconnectedCallback",{value(){for(const controller of this.fixtureControllers??[])controller.hostDisconnected?.();}});
  const dispatch=ports.ElementPort.prototype.dispatchEvent;
  replace(ports.ElementPort.prototype,"dispatchEvent",{value(event){
    if(event.type==="context-request"){event.callback(snapshot,()=>{});return true;}
    return dispatch.call(this,event);
  }});
  replace(ports.documentPort,"title",{get:()=>f.title,set:value=>{f.title=String(value);f.titles.push(f.title);}});
  replace(globalThis,"history",{value:{
    pushState(_state,_title,path){f.route=String(path);},
    replaceState(_state,_title,path){f.route=String(path);},
  }});
  replace(globalThis,"fetch",{value(input,init={}){
    const url=new URL(String(input),"https://fixture.invalid");
    assert.equal(kind,"shared","Platform host must use its session/module ports only");
    assert.equal(url.origin,"https://fixture.invalid","no network or providers");
    assert.match(url.pathname,/^\/api\/shared\/token-[abc]$/u);
    assert.equal(init.method??"GET","GET","guest load is read-only");
    const gate=deferred(),row={url:url.pathname,init,gate,settled:false};
    f.reads.push(row);return gate.promise;
  }});
  const sessionPort={get:()=>f.session,subscribe(callback){f.sessionListeners.add(callback);return()=>f.sessionListeners.delete(callback);},
    load(audience){const gate=deferred(),row={audience,gate,settled:false};f.sessionReads.push(row);return gate.promise;}};
  const modulePort={loadRouteComponent(path){const gate=deferred(),row={path,gate,settled:false};f.modules.push(row);return gate.promise;}};
  const moduleEntries=[
    ["src/platform/session-controller.ts",{platformSession:sessionPort}],
    ["src/route-loader.ts",modulePort],
    ["src/performance.ts",{beginRoutePopulation:path=>f.populations.push(path),
      completeRoutePopulation:path=>f.completions.push(path),recordPopulationSource(){}}],
  ];
  const previousModules=moduleEntries.map(([key])=>[key,ports.moduleCache.has(key),ports.moduleCache.get(key)]);
  for(const [key,value]of moduleEntries)ports.moduleCache.set(key,value);
  for(const key of["src/components/forma-platform-shell.ts","src/components/forma-shared-view.ts","src/apps/public-share/entry.ts"])
    ports.moduleCache.delete(key);
  const navigation=await ports.loadActual("src/components/design-system/navigation.ts");
  const language=await ports.loadActual("src/components/design-system/language-picker.ts");
  const registry={"forma-ui-workspace-switcher":navigation.FormaUiWorkspaceSwitcher,
    "forma-ui-audience-navigation":navigation.FormaUiAudienceNavigation,"forma-ui-language-picker":language.FormaUiLanguagePicker};
  let Constructor;
  if(kind==="platform")({FormaPlatformShell:Constructor}=await ports.loadActual("src/components/forma-platform-shell.ts"));
  else{
    const shared=await ports.loadActual("src/components/forma-shared-view.ts");
    registry["forma-shared-view"]=shared.FormaSharedView;
    ({FormaPublicShare:Constructor}=await ports.loadActual("src/apps/public-share/entry.ts"));
  }
  f.renderer=new ports.RendererPort(f,registry);
  f.host=new Constructor();f.host.tag=kind==="platform"?"forma-platform-shell":"forma-public-share";f.host.attributes={};
  f.host.isConnected=true;
  f.draw=()=>{ports.bindFixture(f);if(!f.host.isConnected)return f.renderer.markup;f.requested=false;return f.renderer.draw(f.host);};
  f.tick=async owner=>{
    await Promise.resolve();f.draw();
    if(f.holdUpdates){const gate=deferred();f.renderWaits.push({owner,gate});await gate.promise;}
    return true;
  };
  f.native=installOutputNavigationFocusNative(t,f,ports);
  f.flush=async()=>{for(let i=0;i<8;i++){await Promise.resolve();if(f.requested)f.draw();}await new Promise(setImmediate);if(f.requested)f.draw();};
  f.html=()=>f.renderer.markup;
  f.owner=()=>kind==="platform"?f.host:f.renderer.component("forma-shared-view");
  f.mainFocus=()=>f.native.nativeFocus.filter(row=>row.node.attributes?.id==="main-content");
  f.announcement=()=>f.html().match(/<span class="sr-only" role="status" aria-live="polite" aria-atomic="true">([^<]*)<\/span>/u)?.[1]??"";
  f.language=()=>{const rows=f.renderer.nodes.filter(row=>row.owner?.tag==="forma-ui-language-picker"&&row.tag==="select");assert.equal(rows.length,1);return rows[0];};
  f.act=async(node,eventName="click")=>{
    assert.ok(node?.isConnected);assert.ok(f.renderer.nodes.includes(node),"current rendered control");
    assert.equal(typeof node.handlers[eventName],"function","actual native control callback");
    f.native.emit("pointerdown",node);f.native.focus(node);
    node.handlers[eventName].call(node.owner,{type:eventName,button:0,target:node,currentTarget:node,
      defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){}});
    await f.flush();
  };
  f.navigate=async path=>{
    f.draw();const rows=f.renderer.nodes.filter(row=>row.tag==="a"&&row.owner?.tag==="forma-ui-audience-navigation"&&row.attributes.href===path);
    assert.equal(rows.length,1,"one actual authorized task destination");await f.act(rows[0]);
    assert.equal(f.route,path);
  };
  f.acceptSession=async(index,value=sessionValue())=>{
    const row=f.sessionReads[index];assert.ok(row,"session request exists");row.settled=true;f.session=value;
    for(const listener of [...f.sessionListeners])listener();row.gate.resolve(value);await f.flush();
  };
  f.failSession=async index=>{const row=f.sessionReads[index];row.settled=true;row.gate.reject(new Error("old session failure"));await f.flush();};
  f.acceptModule=async index=>{const row=f.modules[index];assert.ok(row,"module request exists");row.settled=true;row.gate.resolve();await f.flush();};
  f.failModule=async index=>{const row=f.modules[index];row.settled=true;row.gate.reject(new Error("old module failure"));await f.flush();};
  f.reply=async(index,value)=>{const row=f.reads[index];assert.ok(row,"exact guest request exists");row.settled=true;row.gate.resolve(value);await f.flush();};
  f.newToken=async token=>{
    // PublicShare's actual render binds the new token to the same SharedView.
    // This is a host-property/route lifecycle control, not an invented token picker.
    f.route="/share/"+token;f.host.requestUpdate();f.draw();await f.flush();
  };
  f.releaseRender=async()=>{f.holdUpdates=false;const waits=f.renderWaits.splice(0);assert.ok(waits.length,"real host updateComplete was awaited");for(const row of waits)row.gate.resolve();await f.flush();};
  f.disconnect=()=>{
    f.host.isConnected=false;
    for(const {instance}of f.renderer.instances.values())if(instance.isConnected){instance.isConnected=false;instance.disconnectedCallback();}
    f.host.disconnectedCallback();
  };
  f.reconnect=async()=>{f.host.isConnected=true;f.host.connectedCallback();f.draw();await f.flush();};
  t.after(async()=>{
    ports.bindFixture(f);f.disconnect();
    for(const row of f.sessionReads)if(!row.settled){row.settled=true;row.gate.resolve(sessionValue());}
    for(const row of f.modules)if(!row.settled){row.settled=true;row.gate.resolve();}
    for(const row of f.reads)if(!row.settled){row.settled=true;row.gate.resolve(response({error:"fixture teardown"},410));}
    for(const row of f.renderWaits)row.gate.resolve();
    f.holdUpdates=false;await f.flush();f.i18n.hostDisconnected();
    for(const [key,had,value]of previousModules){if(had)ports.moduleCache.set(key,value);else ports.moduleCache.delete(key);}
    for(const restore of undo.reverse())restore();
  });
  f.host.connectedCallback();f.draw();await f.flush();
  return f;
}

for(const locale of["en","ja"]){
  test(locale+" Platform load: healthy current route focuses main and announces once",async t=>{
    const f=await hostFixture(t,"platform",locale);
    await f.acceptSession(0);await f.acceptModule(0);
    assert.equal(f.mainFocus().length,1);assert.equal(f.native.document.activeElement.attributes.id,"main-content");
    assert.deepEqual(f.completions,["/operations/providers"]);assert.ok(f.announcement());assert.match(f.title,/Forma$/u);
    assert.doesNotMatch(f.html(),/old session failure|old module failure/u);assert.equal(f.native.listeners("focusin"),0);
  });
  test(locale+" Platform load: newer current language focus wins during session read",async t=>{
    const f=await hostFixture(t,"platform",locale);const field=f.language();f.native.focus(field);
    await f.acceptSession(0);await f.acceptModule(0);
    assert.equal(f.mainFocus().length,0);assert.equal(f.native.document.activeElement,field);
    assert.deepEqual(f.completions,["/operations/providers"]);assert.ok(f.announcement());
  });
  for(const event of["pointerdown","keydown","focusin"])test(locale+" Platform load: "+event+" during owned update cannot be recertified",async t=>{
    const f=await hostFixture(t,"platform",locale);await f.acceptSession(0);f.holdUpdates=true;
    await f.acceptModule(0);assert.ok(f.renderWaits.length);
    const field=f.language();if(event==="focusin")f.native.focus(field);else f.native.emit(event,field);
    await f.releaseRender();assert.equal(f.mainFocus().length,0);assert.equal(f.native.listeners("focusin"),0);
  });
  test(locale+" Platform load: A-B-A retires earlier session success and errors",async t=>{
    const f=await hostFixture(t,"platform",locale);
    await f.navigate("/operations/access");await f.navigate("/operations/providers");
    assert.equal(f.sessionReads.length,3);
    await f.acceptSession(2);await f.acceptModule(0);
    const title=f.title,announcement=f.announcement(),completed=[...f.completions],focus=f.mainFocus().length;
    await f.failSession(1);await f.acceptSession(0);
    assert.equal(f.modules.length,1,"retired session cannot start a module for the new route");
    assert.equal(f.title,title);assert.equal(f.announcement(),announcement);assert.deepEqual(f.completions,completed);
    assert.equal(f.mainFocus().length,focus);assert.doesNotMatch(f.html(),/old session failure/u);
  });
  test(locale+" Platform load: old module error cannot replace current task or announcement",async t=>{
    const f=await hostFixture(t,"platform",locale);await f.acceptSession(0);
    await f.navigate("/operations/access");await f.acceptSession(1);await f.acceptModule(1);
    const title=f.title,announcement=f.announcement(),completed=[...f.completions],focus=f.mainFocus().length;
    await f.failModule(0);
    assert.equal(f.title,title);assert.equal(f.announcement(),announcement);assert.deepEqual(f.completions,completed);
    assert.equal(f.mainFocus().length,focus);assert.doesNotMatch(f.html(),/old module failure/u);
  });
  for(const stage of["session","module"])test(locale+" Platform load: current "+stage+" error is usable without stale title",async t=>{
    const f=await hostFixture(t,"platform",locale);
    if(stage==="module"){await f.acceptSession(0);await f.failModule(0);}else await f.failSession(0);
    assert.equal(f.mainFocus().length,1);assert.ok(f.html().includes("old "+stage+" failure"));
    assert.equal(f.announcement(),f.i18n.t("shell.accessUnavailable","Workspace unavailable"));
    assert.notEqual(f.title,"Previous page — Forma");
  });
  test(locale+" Platform load: disconnected session response has no host effects",async t=>{
    const f=await hostFixture(t,"platform",locale);f.disconnect();const title=f.title;
    await f.acceptSession(0);assert.equal(f.modules.length,0);assert.equal(f.mainFocus().length,0);
    assert.deepEqual(f.completions,[]);assert.equal(f.title,title);assert.equal(f.native.listeners("focusin"),0);
  });
  test(locale+" Platform load: disconnect-reconnect keeps only the new render completion",async t=>{
    const f=await hostFixture(t,"platform",locale);await f.acceptSession(0);f.holdUpdates=true;await f.acceptModule(0);
    f.disconnect();await f.reconnect();await f.acceptSession(1);await f.acceptModule(1);
    await f.releaseRender();assert.equal(f.mainFocus().length,1);assert.deepEqual(f.completions,["/operations/providers"]);
    assert.equal(f.native.listeners("focusin"),0);
  });

  test(locale+" Public SharedView load: healthy exact token focuses main",async t=>{
    const f=await hostFixture(t,"shared",locale);assert.equal(f.reads.length,1);assert.equal(f.reads[0].url,"/api/shared/token-a");
    await f.reply(0,response(sharedBody("Current public A")));
    assert.equal(f.mainFocus().length,1);assert.ok(f.html().includes("Current public A"));
    assert.deepEqual(f.completions,["/share/token-a"]);assert.equal(f.native.listeners("focusin"),0);
  });
  test(locale+" Public SharedView load: newer mounted language choice wins during fetch",async t=>{
    const f=await hostFixture(t,"shared",locale);const field=f.language();f.native.focus(field);
    await f.reply(0,response(sharedBody("Current public A")));
    assert.equal(f.mainFocus().length,0);assert.equal(f.native.document.activeElement,field);
    assert.ok(f.html().includes("Current public A"));assert.deepEqual(f.completions,["/share/token-a"]);
  });
  test(locale+" Public SharedView load: newer focus during actual body read wins",async t=>{
    const f=await hostFixture(t,"shared",locale),body=deferred(),wire=response(sharedBody("Current public A"));
    const originalJson=wire.json.bind(wire);wire.json=async()=>{await body.promise;return originalJson();};
    await f.reply(0,wire);const field=f.language();f.native.focus(field);body.resolve();await f.flush();
    assert.equal(f.mainFocus().length,0);assert.equal(f.native.document.activeElement,field);assert.ok(f.html().includes("Current public A"));
  });
  test(locale+" Public SharedView load: current key interaction during render wins",async t=>{
    const f=await hostFixture(t,"shared",locale);f.holdUpdates=true;await f.reply(0,response(sharedBody("Current public A")));
    assert.ok(f.renderWaits.length);f.native.emit("keydown",f.language());await f.releaseRender();
    assert.equal(f.mainFocus().length,0);assert.deepEqual(f.completions,["/share/token-a"]);
  });
  test(locale+" Public SharedView load: same mounted A-B-A rejects old success and denial",async t=>{
    const f=await hostFixture(t,"shared",locale),original=f.owner();
    await f.newToken("token-b");await f.newToken("token-a");assert.equal(f.owner(),original);
    assert.deepEqual(f.reads.map(row=>row.url),["/api/shared/token-a","/api/shared/token-b","/api/shared/token-a"]);
    await f.reply(2,response(sharedBody("Newest public A")));
    const title=f.title,completed=[...f.completions],focus=f.mainFocus().length;
    await f.reply(1,response({error:"old shared denial"},403));await f.reply(0,response(sharedBody("Obsolete public A")));
    assert.equal(f.title,title);assert.deepEqual(f.completions,completed);assert.equal(f.mainFocus().length,focus);
    assert.ok(f.html().includes("Newest public A"));assert.doesNotMatch(f.html(),/Obsolete public A|old shared denial/u);
  });
  test(locale+" Public SharedView load: old body cannot overwrite new exact token",async t=>{
    const f=await hostFixture(t,"shared",locale),body=deferred(),wire=response(sharedBody("Obsolete public A"));
    const originalJson=wire.json.bind(wire);wire.json=async()=>{await body.promise;return originalJson();};
    await f.reply(0,wire);await f.newToken("token-b");await f.reply(1,response(sharedBody("Current public B")));
    const title=f.title,completed=[...f.completions];body.resolve();await f.flush();
    assert.equal(f.title,title);assert.deepEqual(f.completions,completed);
    assert.ok(f.html().includes("Current public B"));assert.doesNotMatch(f.html(),/Obsolete public A/u);
  });
  test(locale+" Public SharedView load: disconnected original cannot affect a fresh denied opening",async t=>{
    const f=await hostFixture(t,"shared",locale);f.disconnect();await f.reconnect();
    assert.equal(f.reads.length,2);await f.reply(1,response({error:"current shared denial"},403));
    const title=f.title,completed=[...f.completions],focus=f.mainFocus().length;
    await f.reply(0,response(sharedBody("Obsolete public A")));
    assert.equal(f.title,title);assert.deepEqual(f.completions,completed);assert.equal(f.mainFocus().length,focus);
    assert.equal(focus,1);assert.doesNotMatch(f.html(),/Obsolete public A/u);
  });
  test(locale+" Public SharedView load: same connected token refresh is not invented by ordinary rerender",async t=>{
    const f=await hostFixture(t,"shared",locale);await f.reply(0,response(sharedBody("Current public A")));
    f.host.requestUpdate();f.draw();await f.flush();f.draw();await f.flush();
    assert.equal(f.reads.length,1);assert.equal(f.mainFocus().length,1);assert.ok(f.html().includes("Current public A"));
  });
}

// B1 procurement: current error truth and deliberate same-token read recovery.
// These reuse the complete current public parent/SharedView and finite guest
// Response/native ports above. No endpoint authorization, production private
// row, native-browser, provider, invoice or cancellation proof is asserted.
// No existing fixture, test body, application method or response is replaced.
const sharedReadTruthLocales=["en","fr","ar","ja"];
function sharedReadTruthBody(title){
  const body=sharedBody(title);
  body.projection.blocks=[{id:"truth-source",type:"direction",handle:"direction/truth-source",
    properties:{text:"Private source for "+title}}];
  return body;
}
function sharedReadTruthCopy(f){
  const owner=f.owner();assert.ok(owner?.isConnected,"the actual current guest owner is mounted");
  return owner.markup.replace(/<[^>]*>/gu," ").replace(/\s+/gu," ").trim();
}
function assertSharedReadTruthGeneric(f){
  const copy=sharedReadTruthCopy(f);
  assert.ok(copy.includes(f.i18n.t("shared.unavailable","Link unavailable")),"the current failure remains unavailable");
  assert.equal(copy.includes(f.i18n.t("shared.expired","This view has expired or been revoked.")),false,
    "an unclassified current read cannot certify link expiry or revocation");
  assert.doesNotMatch(copy,/temporary fixture failure|share_expired_or_revoked|shared_document_unavailable|shared_output_approval_expired/u,
    "raw server/transport diagnostics are not the user-facing explanation");
}
function sharedReadTruthRetry(f){
  const owner=f.owner(),rows=f.renderer.nodes.filter(node=>node.owner===owner&&node.tag==="button"
    &&typeof node.handlers.click==="function");
  assert.equal(rows.length,1,"one current explicit read-only Retry belongs to this unavailable view");
  const button=rows[0];assert.ok(button.isConnected);assert.equal(button.attributes.type,"button");
  assert.equal(Object.hasOwn(button.attributes,"disabled"),false);
  const start=owner.markup.indexOf(button.full),end=owner.markup.indexOf("</button>",start+button.full.length);
  assert.ok(start>=0&&end>start,"inspect the actual owned native button's rendered label");
  const label=owner.markup.slice(start+button.full.length,end).replace(/<[^>]*>/gu,"").trim();
  assert.equal(label,f.i18n.t("action.retry","Retry"));
  return button;
}
async function sharedReadTruthFail(f,index,kind){
  if(kind==="transport"){
    const row=f.reads[index];assert.ok(row);row.settled=true;
    row.gate.reject(new Error("temporary fixture failure"));await f.flush();
  }else if(kind==="json"){
    await f.reply(index,new Response("{",{status:200,headers:{"content-type":"application/json"}}));
  }else{
    assert.equal(kind,"service");await f.reply(index,response({error:"temporary fixture failure"},503));
  }
}
async function sharedReadTruthPreviousThenPending(t,locale){
  const f=await hostFixture(t,"shared",locale),previous="Previous A "+locale;
  await f.reply(0,response(sharedReadTruthBody(previous)));
  assert.ok(f.html().includes(previous)&&f.html().includes("Private source for "+previous));
  const original=f.owner();await f.newToken("token-b");assert.equal(f.owner(),original);
  assert.equal(f.html().includes(previous),false,"the previous token's projection is cleared before the next reply");
  assert.deepEqual(f.reads.map(row=>row.url),["/api/shared/token-a","/api/shared/token-b"]);
  return{f,previous};
}

for(const locale of sharedReadTruthLocales)for(const kind of["transport","json","service"]){
  test("B1 shared read truth: "+locale+" current "+kind+" is generic and explicit Retry reads only the same token",async t=>{
    const{f,previous}=await sharedReadTruthPreviousThenPending(t,locale);
    await sharedReadTruthFail(f,1,kind);assertSharedReadTruthGeneric(f);
    assert.equal(f.html().includes(previous),false);
    f.host.requestUpdate();f.draw();await f.flush();
    assert.equal(f.reads.length,2,"ordinary rerender never retries automatically");
    await f.act(sharedReadTruthRetry(f));
    assert.deepEqual(f.reads.map(row=>row.url),["/api/shared/token-a","/api/shared/token-b","/api/shared/token-b"]);
    assert.equal(f.route,"/share/token-b");assert.equal(f.owner().token,"token-b");
    assert.equal(f.html().includes(previous),false,"pending Retry does not restore the old private projection");
    f.host.requestUpdate();f.draw();await f.flush();assert.equal(f.reads.length,3);
    await f.reply(2,response(sharedReadTruthBody("Recovered B "+locale)));
    assert.ok(f.html().includes("Recovered B "+locale)&&f.html().includes("Private source for Recovered B "+locale));
    assert.equal(f.html().includes(previous),false);assert.equal(f.reads.length,3);
    assert.ok(f.reads.every(row=>(row.init.method??"GET")==="GET"),"no token creation, write or provider operation");
  });
}

for(const locale of sharedReadTruthLocales)for(const code of["shared_document_unavailable","shared_output_approval_expired"]){
  test("B1 shared read truth: "+locale+" actual "+code+" 404 is not relabeled as link revocation",async t=>{
    const{f,previous}=await sharedReadTruthPreviousThenPending(t,locale);
    // Exact existing Worker response contracts: shares-api.ts:143-145. The
    // fixture does not invoke that endpoint or manufacture its authority.
    await f.reply(1,response({error:code},404));assertSharedReadTruthGeneric(f);
    assert.equal(f.html().includes(previous),false);assert.equal(f.reads.length,2);
    f.host.requestUpdate();f.draw();await f.flush();assert.equal(f.reads.length,2);
  });
}

for(const locale of sharedReadTruthLocales){
  test("B1 shared read truth: "+locale+" recognized current link denial clears original private state",async t=>{
    const{f,previous}=await sharedReadTruthPreviousThenPending(t,locale);
    // Exact existing Worker response contract: shares-api.ts:141-142.
    await f.reply(1,response({error:"share_expired_or_revoked"},404));
    const copy=sharedReadTruthCopy(f);
    assert.ok(copy.includes(f.i18n.t("shared.unavailable","Link unavailable")));
    assert.equal(f.html().includes(previous),false);assert.equal(f.reads.length,2);
    // Generic wording is also truthful here; stronger expiry/revocation copy
    // is permitted, not required, for this exact status/code pair only.
    assert.equal(copy.includes("share_expired_or_revoked"),false);
    f.host.requestUpdate();f.draw();await f.flush();assert.equal(f.reads.length,2,"a denial does not create a replacement token");
  });
}

for(const locale of["en","ja"])for(const status of[200,503]){
  test("B1 shared read truth: "+locale+" misplaced expiry code at HTTP "+status+" is not expiry proof",async t=>{
    const{f,previous}=await sharedReadTruthPreviousThenPending(t,locale);
    await f.reply(1,response({error:"share_expired_or_revoked"},status));
    assertSharedReadTruthGeneric(f);assert.equal(f.html().includes(previous),false);
    assert.equal(f.reads.length,2);sharedReadTruthRetry(f);
  });
}

for(const locale of["en","ja"])for(const outcome of["success","denial"]){
  test("B1 shared read truth: "+locale+" newer token owns view after old Retry "+outcome,async t=>{
    const f=await hostFixture(t,"shared",locale);
    await sharedReadTruthFail(f,0,"service");assertSharedReadTruthGeneric(f);
    await f.act(sharedReadTruthRetry(f));assert.equal(f.reads.length,2);
    assert.equal(f.reads[1].url,"/api/shared/token-a");
    await f.newToken("token-b");assert.equal(f.reads.length,3);
    await f.reply(2,response(sharedReadTruthBody("Newest B "+locale)));
    const title=f.title,completed=[...f.completions],focus=f.mainFocus().length;
    await f.reply(1,outcome==="success"?response(sharedReadTruthBody("Obsolete retried A"))
      :response({error:"share_expired_or_revoked"},404));
    assert.equal(f.title,title);assert.deepEqual(f.completions,completed);assert.equal(f.mainFocus().length,focus);
    assert.ok(f.html().includes("Newest B "+locale));assert.doesNotMatch(f.html(),/Obsolete retried A|share_expired_or_revoked/u);
    assert.equal(sharedReadTruthCopy(f).includes(f.i18n.t("shared.expired","This view has expired or been revoked.")),false);
    assert.equal(f.route,"/share/token-b");assert.equal(f.owner().token,"token-b");assert.equal(f.reads.length,3);
  });
}

// Full same-document fragment default for the EXISTING current Skip anchor.
// The reusable renderer implements popover defaults, not anchor navigation.
// This finite extension derives the destination from the actual emitted href,
// records native focus, and delivers BOTH popstate and hashchange. It does not
// invoke a private load method or replace any response/result. Root's primary
// HTML Standard check: https://html.spec.whatwg.org/multipage/browsing-the-web.html#fragment-nav
// This is not a physical browser/default-event-order/AT certificate.
function activateCurrentSkipFragment(f) {
  f.draw();
  const links = f.renderer.nodes.filter(node => node.tag === "a"
    && node.owner === f.host && String(node.attributes.class ?? "").split(/\s+/u).includes("skip-link"));
  assert.equal(links.length, 1, "the actual outer host exposes one current Skip link");
  const link = links[0];
  assert.ok(link.isConnected && f.renderer.nodes.includes(link));
  assert.equal(link.attributes.href, "#main-content");
  assert.equal(link.handlers.click, undefined, "Skip retains its native anchor default");
  const targets = f.renderer.nodes.filter(node => node.owner === f.owner()
    && node.attributes.id === "main-content");
  assert.equal(targets.length, 1);
  const target = targets[0];
  assert.ok(target.isConnected);
  assert.equal(String(target.attributes.tabindex), "-1", "the actual target admits fragment focus");
  const before = new URL(f.route, "https://fixture.invalid");
  const next = new URL(link.attributes.href, before);
  assert.equal(next.origin, before.origin);
  assert.equal(next.pathname + next.search, before.pathname + before.search);
  assert.notEqual(next.hash, before.hash, "exercise a real fragment change, not repeated activation");
  f.native.focus(link);
  f.native.emit("keydown", link);
  link.click();
  assert.equal(f.route, before.pathname + before.search + before.hash,
    "the finite renderer has not fabricated an application navigation callback");
  f.route = next.pathname + next.search + next.hash;
  const popstate = [...(f.listeners.get("popstate") ?? [])];
  for (const listener of popstate) listener({ type: "popstate", state: null });
  const hashchange = [...(f.listeners.get("hashchange") ?? [])];
  for (const listener of hashchange) listener({ type: "hashchange", oldURL: before.href, newURL: next.href });
  f.native.focus(target);
  const observation = { href: link.attributes.href, from: before.pathname + before.search + before.hash,
    to: f.route, popstateListeners: popstate.length, hashchangeListeners: hashchange.length,
    targetId: target.attributes.id, target };
  (f.fragmentDefaults ??= []).push(observation);
  return observation;
}
function currentSurfaceMain(f) {
  const rows = f.renderer.nodes.filter(node => node.owner === f.owner() && node.attributes.id === "main-content");
  assert.equal(rows.length, 1);
  return rows[0];
}
function fragmentObservation(f, kind, stage, fragment) {
  return {
    kind, stage, route: f.route, href: fragment?.href ?? null,
    popstateListeners: fragment?.popstateListeners ?? null,
    hashchangeListeners: fragment?.hashchangeListeners ?? null,
    sessionLoadCalls: f.sessionReads.length, moduleLoadCalls: f.modules.length,
    guestRequests: f.reads.map(row => row.url), completions: [...f.completions],
    busy: currentSurfaceMain(f).attributes["aria-busy"] ?? null,
    title: f.title, mainFocusCalls: f.mainFocus().length,
    containsCurrentGuest: f.html().includes("Current fragment review"),
    containsRetiredGuest: f.html().includes("Retired fragment review"),
  };
}
function assertCurrentFragmentReady(f, kind) {
  if (kind === "shared") {
    assert.ok(f.html().includes("Current fragment review"),
      "the current exact-token response must finish after its own Skip fragment");
    assert.ok(!f.html().includes(f.i18n.t("shared.loading", "Opening this shared creative document…")),
      "same-resource Skip must not strand the unchanged read on its loader");
  } else {
    assert.equal(String(currentSurfaceMain(f).attributes["aria-busy"]), "false");
    assert.equal(f.announcement(), f.title.replace(/\s— Forma$/u, ""));
    assert.ok(f.announcement());
  }
}

for (const locale of ["en", "ja"]) {
  for (const stage of ["headers", "body", "owned-render"]) {
    test(locale + " current guest Skip fragment: " + stage + " retains same-token completion and user focus", async t => {
      const f = await hostFixture(t, "shared", locale, { nativeUrlParts: true });
      const owner = f.owner(), title = "Current fragment review " + locale;
      assert.equal(f.reads.length, 1);
      let body;
      if (stage === "body") {
        body = deferred(); let entered = 0;
        const wire = response(sharedBody(title)), originalJson = wire.json.bind(wire);
        wire.json = async () => { entered++; await body.promise; return originalJson(); };
        t.after(() => body.resolve());
        await f.reply(0, wire);
        assert.equal(entered, 1, "the original actual Response body read is pending");
      } else if (stage === "owned-render") {
        f.holdUpdates = true;
        await f.reply(0, response(sharedBody(title)));
        assert.ok(f.renderWaits.length, "the actual load awaits updateComplete");
      }
      const fragment = activateCurrentSkipFragment(f), focused = f.mainFocus().length;
      assert.equal(fragment.popstateListeners, 0, "public guest entry has no account router or replacement load listener");
      assert.equal(fragment.hashchangeListeners, 0);
      if (stage === "headers") await f.reply(0, response(sharedBody(title)));
      else if (stage === "body") { body.resolve(); await f.flush(); }
      else await f.releaseRender();
      t.diagnostic(JSON.stringify(fragmentObservation(f, "shared", stage, fragment)));
      assert.equal(f.owner(), owner, "the same guest host, not a replacement success view");
      assert.equal(f.route, fragment.to);
      assert.equal(f.reads.length, 1, "Skip does not authorize or require another resource read");
      assert.equal(f.mainFocus().length, focused, "late completion cannot steal the explicit Skip focus");
      assert.equal(f.native.document.activeElement, fragment.target);
      assertCurrentFragmentReady(f, "shared");
      assert.deepEqual(f.completions, ["/share/token-a"]);
      assert.equal(f.native.listeners("focusin"), 0);
    });
  }
  test(locale + " guest fragment controls: ordinary completed load still admits its current Skip", async t => {
    const f = await hostFixture(t, "shared", locale, { nativeUrlParts: true });
    await f.reply(0, response(sharedBody("Current fragment review " + locale)));
    assertCurrentFragmentReady(f, "shared");
    const fragment = activateCurrentSkipFragment(f), focused = f.mainFocus().length;
    await f.flush();
    t.diagnostic(JSON.stringify(fragmentObservation(f, "shared", "completed", fragment)));
    assertCurrentFragmentReady(f, "shared");
    assert.equal(f.reads.length, 1);
    assert.equal(f.mainFocus().length, focused);
    assert.equal(f.native.document.activeElement, fragment.target);
  });
  test(locale + " guest fragment controls: full URL port does not change healthy no-fragment loading", async t => {
    const f = await hostFixture(t, "shared", locale, { nativeUrlParts: true });
    await f.reply(0, response(sharedBody("Current fragment review " + locale)));
    assertCurrentFragmentReady(f, "shared");
    assert.equal(f.route, "/share/token-a");
    assert.equal(f.reads.length, 1); assert.equal(f.mainFocus().length, 1);
    assert.deepEqual(f.completions, ["/share/token-a"]);
  });
  test(locale + " guest fragment controls: a real token/path A-B-A still retires the old response", async t => {
    const f = await hostFixture(t, "shared", locale, { nativeUrlParts: true }), owner = f.owner();
    const fragment = activateCurrentSkipFragment(f);
    await f.newToken("token-b"); await f.newToken("token-a");
    assert.equal(f.owner(), owner);
    assert.deepEqual(f.reads.map(row => row.url), ["/api/shared/token-a", "/api/shared/token-b", "/api/shared/token-a"]);
    await f.reply(2, response(sharedBody("Current fragment review " + locale)));
    const completed = [...f.completions], focused = f.mainFocus().length, title = f.title;
    await f.reply(0, response(sharedBody("Retired fragment review " + locale)));
    await f.reply(1, response({ error: "retired other-token denial" }, 403));
    t.diagnostic(JSON.stringify(fragmentObservation(f, "shared", "token-A-B-A", fragment)));
    assertCurrentFragmentReady(f, "shared");
    assert.ok(!f.html().includes("Retired fragment review"));
    assert.equal(f.title, title); assert.equal(f.mainFocus().length, focused);
    assert.deepEqual(f.completions, completed);
  });

  for (const stage of ["session", "module", "owned-render"]) {
    test(locale + " current Platform Skip fragment: " + stage + " preserves its real popstate replacement-load continuation", async t => {
      const f = await hostFixture(t, "platform", locale, { nativeUrlParts: true });
      if (stage !== "session") await f.acceptSession(0);
      if (stage === "owned-render") {
        f.holdUpdates = true; await f.acceptModule(0);
        assert.ok(f.renderWaits.length);
      }
      const fragment = activateCurrentSkipFragment(f), focused = f.mainFocus().length;
      assert.equal(fragment.popstateListeners, 1, "retain PlatformShell's actual existing history listener");
      assert.equal(fragment.hashchangeListeners, 0);
      assert.equal(f.sessionReads.length, 2,
        "this is the finite session-delivery port, not a claim of two HTTP requests; the real singleton coalesces separately");
      if (stage === "session") await f.acceptSession(0);
      await f.acceptSession(1);
      if (stage === "session") await f.acceptModule(0);
      else if (stage === "module") { await f.failModule(0); await f.acceptModule(1); }
      else { await f.acceptModule(1); await f.releaseRender(); }
      t.diagnostic(JSON.stringify(fragmentObservation(f, "platform", stage, fragment)));
      assert.equal(f.route, fragment.to);
      assertCurrentFragmentReady(f, "platform");
      assert.doesNotMatch(f.html(), /old module failure/u);
      assert.equal(f.mainFocus().length, focused, "replacement completion does not override native Skip focus");
      assert.equal(f.native.document.activeElement, fragment.target);
      assert.deepEqual(f.completions, ["/operations/providers"]);
      assert.equal(f.reads.length, 0);
      assert.equal(f.native.listeners("focusin"), 0);
    });
  }
  test(locale + " Platform fragment controls: completed task remains usable after native Skip history delivery", async t => {
    const f = await hostFixture(t, "platform", locale, { nativeUrlParts: true });
    await f.acceptSession(0); await f.acceptModule(0); assertCurrentFragmentReady(f, "platform");
    const fragment = activateCurrentSkipFragment(f), focused = f.mainFocus().length;
    await f.acceptSession(1); await f.acceptModule(1);
    t.diagnostic(JSON.stringify(fragmentObservation(f, "platform", "completed", fragment)));
    assertCurrentFragmentReady(f, "platform");
    assert.equal(f.route, fragment.to); assert.equal(f.mainFocus().length, focused);
    assert.equal(f.native.document.activeElement, fragment.target);
    assert.equal(f.reads.length, 0);
  });
  test(locale + " Platform fragment controls: full URL port preserves healthy no-fragment loading", async t => {
    const f = await hostFixture(t, "platform", locale, { nativeUrlParts: true });
    await f.acceptSession(0); await f.acceptModule(0);
    assertCurrentFragmentReady(f, "platform");
    assert.equal(f.route, "/operations/providers");
    assert.equal(f.sessionReads.length, 1); assert.equal(f.modules.length, 1);
    assert.equal(f.mainFocus().length, 1); assert.equal(f.reads.length, 0);
    assert.deepEqual(f.completions, ["/operations/providers"]);
  });
  test(locale + " Platform fragment controls: native task-path A-B-A still retires old fragment loads", async t => {
    const f = await hostFixture(t, "platform", locale, { nativeUrlParts: true });
    const fragment = activateCurrentSkipFragment(f);
    await f.navigate("/operations/access"); await f.navigate("/operations/providers");
    assert.equal(f.sessionReads.length, 4);
    await f.acceptSession(3); await f.acceptModule(0);
    const title = f.title, announcement = f.announcement(), completed = [...f.completions], focused = f.mainFocus().length;
    await f.failSession(1); await f.acceptSession(0); await f.acceptSession(2);
    t.diagnostic(JSON.stringify(fragmentObservation(f, "platform", "task-A-B-A", fragment)));
    assertCurrentFragmentReady(f, "platform");
    assert.equal(f.title, title); assert.equal(f.announcement(), announcement);
    assert.deepEqual(f.completions, completed); assert.equal(f.mainFocus().length, focused);
    assert.equal(f.modules.length, 1); assert.equal(f.reads.length, 0);
  });
}
