// Actual PlatformShell and public-share/SharedView load-lifetime regressions.
// The existing full-class renderer and native focus lease are reused unchanged.
// Session/module delivery and guest HTTP Responses are finite dependency ports;
// these tests do not certify CSS, browser navigation, backend authority or AT.
import assert from "node:assert/strict";
import test from "node:test";
import { calmFullPageNativePorts as ports, fullPageTree, registerCalmFullPageComponents } from "./helpers/calm-full-page-fixture.mjs";
import { installOutputNavigationFocusNative } from "./helpers/output-navigation-focus-native.mjs";
import { retainDeferredFocusInvokers } from "./helpers/deferred-focus-invokers.mjs";

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
    route:options.connectedLeaf?.path??(kind==="platform"?"/operations/providers":"/share/token-a"),
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
  if(options.connectedLeaf){
    assert.equal(kind,"platform");
    for(const key of["__formaInitialSession","__formaInitialRouteData"])
      replace(globalThis,key,{writable:true,value:undefined});
    f.serviceCalls=[];
    if(options.connectedLeaf.nativeLocation){
      const currentLocation={origin:"https://fixture.invalid",
        get pathname(){return new URL(f.route,this.origin).pathname;},
        get search(){return new URL(f.route,this.origin).search;},
        get hash(){return new URL(f.route,this.origin).hash;}};
      replace(globalThis,"location",{writable:true,value:currentLocation});
      replace(ports.windowPort,"location",{writable:true,value:currentLocation});
    }
  }
  replace(globalThis,"fetch",{value(input,init={}){
    const url=new URL(String(input),"https://fixture.invalid");
    if(options.connectedLeaf){
      assert.equal(url.origin,"https://fixture.invalid","no network or provider transport");
      assert.equal(init.method??"GET","GET","connected leaf coverage never mutates");
      assert.equal(init.credentials??(options.connectedLeaf.defaultFetchCredentials?"same-origin":undefined),"same-origin");
      const gate=deferred(),row={url:url.pathname+url.search,init,gate,settled:false};
      f.serviceCalls.push({url:row.url,method:init.method??"GET"});
      if(url.pathname==="/api/session"){
        assert.equal(url.search,"?audience="+options.connectedLeaf.audience);
        row.audience=url.searchParams.get("audience");f.sessionReads.push(row);
      }else{
        assert.ok(options.connectedLeaf.endpoints.includes(row.url),"only exact approved finite report endpoints");
        f.reads.push(row);
      }
      return gate.promise;
    }
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
  const leafModuleKeys=options.connectedLeaf?["src/apps/operations/entry.ts","src/apps/engineering/entry.ts","src/apps/knowledge/entry.ts",...(options.connectedLeaf.ownerModules??[])]:[];
  const previousLeafModules=leafModuleKeys.map(key=>[key,ports.moduleCache.has(key),ports.moduleCache.get(key)]);
  if(options.connectedLeaf){
    // Reuse the complete actual singleton, not a successful session method.
    // The finite GET queue above delivers its exact Response contract.
    ports.moduleCache.delete("src/platform/session-controller.ts");
    const actualSession=await ports.loadActual("src/platform/session-controller.ts");
    moduleEntries[0][1]=actualSession;f.platformSession=actualSession.platformSession;
    for(const key of leafModuleKeys)ports.moduleCache.delete(key);
  }
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
  if(options.connectedLeaf){
    f.tree=()=>fullPageTree(f);
    f.registerConnectedRoute=async path=>{
      const row=options.connectedLeaf.routes.find(candidate=>candidate.path===path);
      assert.ok(row,"the finite route loader admits only a declared current application leaf");
      const literalDependencies=new Map();
      for(const [specifier,file]of options.connectedLeaf.literalImports??[])
        literalDependencies.set(specifier,await ports.loadActual(file));
      const application=await ports.loadActual(options.connectedLeaf.entry,literalDependencies);
      registry[options.connectedLeaf.tag]=application[options.connectedLeaf.name];
      if(row.initialize){
        assert.equal(options.connectedLeaf.entry,"src/apps/knowledge/entry.ts");
        assert.equal(row.initialize,"loadKnowledgeRoute");assert.equal(path,"/knowledge/landing-pages");
        await application.loadKnowledgeRoute(path);
      }
      if(!row.inline){const leaf=await ports.loadActual(row.file);registry[row.tag]=leaf[row.name];}
      assert.equal(typeof registry[options.connectedLeaf.tag],"function");
      if(!row.inline)assert.equal(typeof registry[row.tag],"function");
      if(options.connectedLeaf.audience==="knowledge"){
        const primitives=await ports.loadActual("src/components/design-primitives.ts");
        registry["forma-ui-badge"]=primitives.FormaUiBadge;
      }
      if(options.connectedLeaf.registerCem){
        // Reuse the root-applied opt-in registration helper, not a second CEM
        // traversal. This does not simulate native shadow/slot distribution.
        await registerCalmFullPageComponents(f,options.connectedLeaf.registerCem);
      }
    };
    f.replyConnectedSession=async(index,value=connectedSpecialistSession(options.connectedLeaf),status=200)=>{
      const row=f.sessionReads[index];assert.ok(row,"actual session fetch exists");
      row.settled=true;row.gate.resolve(response(value,status));await f.flush();
    };
  }
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
  f.acceptModule=async index=>{const row=f.modules[index];assert.ok(row,"module request exists");if(f.registerConnectedRoute)await f.registerConnectedRoute(row.path);row.settled=true;row.gate.resolve();await f.flush();};
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
    f.platformSession?.reset();
    for(const row of f.sessionReads)if(!row.settled){row.settled=true;row.gate.resolve(options.connectedLeaf?response(connectedSpecialistSession(options.connectedLeaf)):sessionValue());}
    for(const row of f.modules)if(!row.settled){row.settled=true;row.gate.resolve();}
    for(const row of f.reads)if(!row.settled){row.settled=true;row.gate.resolve(response({error:"fixture teardown"},410));}
    for(const row of f.renderWaits)row.gate.resolve();
    f.holdUpdates=false;await f.flush();f.i18n.hostDisconnected();
    for(const [key,had,value]of previousModules){if(had)ports.moduleCache.set(key,value);else ports.moduleCache.delete(key);}
    for(const [key,had,value]of previousLeafModules){if(had)ports.moduleCache.set(key,value);else ports.moduleCache.delete(key);}
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
    test(locale + " current Platform Skip fragment: " + stage + " preserves its original resource-load continuation", async t => {
      const f = await hostFixture(t, "platform", locale, { nativeUrlParts: true });
      if (stage !== "session") await f.acceptSession(0);
      if (stage === "owned-render") {
        f.holdUpdates = true; await f.acceptModule(0);
        assert.ok(f.renderWaits.length);
      }
      const fragment = activateCurrentSkipFragment(f), focused = f.mainFocus().length;
      assert.equal(fragment.popstateListeners, 1, "retain PlatformShell's actual existing history listener");
      assert.equal(fragment.hashchangeListeners, 0);
      assert.equal(f.sessionReads.length, 1, "same-resource Skip retains the original session load");
      if (stage === "session") await f.acceptSession(0);
      if (stage === "owned-render") await f.releaseRender();
      else await f.acceptModule(0);
      assert.equal(f.modules.length, 1, "the original resource module is not replaced for a fragment");
      t.diagnostic(JSON.stringify(fragmentObservation(f, "platform", stage, fragment)));
      assert.equal(f.route, fragment.to);
      assertCurrentFragmentReady(f, "platform");
      assert.doesNotMatch(f.html(), /old module failure/u);
      assert.equal(f.mainFocus().length, focused, "original completion does not override native Skip focus");
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
    await f.flush();
    assert.equal(f.sessionReads.length, 1); assert.equal(f.modules.length, 1);
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
    assert.equal(f.sessionReads.length, 3, "only the two actual task departures create replacement loads");
    await f.acceptSession(2); await f.acceptModule(0);
    const title = f.title, announcement = f.announcement(), completed = [...f.completions], focused = f.mainFocus().length;
    await f.failSession(1); await f.acceptSession(0);
    t.diagnostic(JSON.stringify(fragmentObservation(f, "platform", "task-A-B-A", fragment)));
    assertCurrentFragmentReady(f, "platform");
    assert.equal(f.title, title); assert.equal(f.announcement(), announcement);
    assert.deepEqual(f.completions, completed); assert.equal(f.mainFocus().length, focused);
    assert.equal(f.modules.length, 1); assert.equal(f.reads.length, 0);
  });
}

// E healthy host contracts use the existing complete PublicShare/SharedView
// classes and real catalogs. Only guest Responses/modal/native controls are
// finite ports. No CSS geometry, native keyboard, AT or endpoint proof.
function eSharedNodeText(f, node) {
  const markup = f.owner().markup, start = markup.indexOf(node.full);
  const end = markup.indexOf(`</${node.tag}>`, start + node.full.length);
  assert.ok(start >= 0 && end >= start, "inspect the actual owned node's complete text");
  return markup.slice(start + node.full.length, end).replace(/<[^>]*>/gu, "").trim();
}
function eSharedControl(f, className) {
  const rows = f.renderer.nodes.filter(node => node.owner === f.owner() && node.tag === "button"
    && String(node.attributes.class ?? "").split(/\s+/u).includes(className));
  assert.equal(rows.length, 1, "one current native " + className);
  assert.equal(rows[0].attributes.type, "button");
  assert.ok(rows[0].isConnected && typeof rows[0].handlers.click === "function");
  return rows[0];
}
function eSharedSlidesBody(locale) {
  const body = sharedBody("Shared document " + locale);
  body.projection.artifacts = [{ id: "shared-slides-A", documentId: "shared-document-A", kind: "slides",
    title: "Authored slide deck " + locale, titleSource: "authored", summary: "Retained synthetic summary",
    contentRef: null, itemCount: 2, mediaUrl: null, mediaType: null, provider: "synthetic", modelId: "synthetic",
    latency: 0, sequence: 1, library: false, sourceEventId: "shared-artifact-A", sourceSurface: null,
    settings: {}, presentation: null, items: [0, 1].map(index => ({ id: "shared-slide-" + index,
      title: "Authored slide " + (index + 1), body: "Complete shared slide body " + (index + 1), notes: "",
      imagePrompt: "", mediaUrl: null, mediaType: null, width: null, height: null, focalPoint: null, slide: null })) }];
  return body;
}
for (const locale of ["en", "fr", "ar", "ja"]) {
  test("E guest host: " + locale + " exact reading regions keep authored bidi text and independent native locale control", async t => {
    const f = await hostFixture(t, "shared", locale);
    const title = "Authored_" + "LongTitle".repeat(18) + "_عنوان_日本語";
    const project = "مشروع_" + "LongProject".repeat(12) + "_Projet";
    const body = sharedBody(title); body.projection.projectName = project;
    await f.reply(0, response(body));
    const owner = f.owner(), own = f.renderer.nodes.filter(node => node.owner === owner);
    const mains = own.filter(node => node.tag === "main" && node.attributes.id === "main-content");
    assert.equal(mains.length, 1); assert.equal(mains[0].attributes.tabindex, "-1");
    for (const className of ["shared-hero", "shared-grid", "shared-results", "shared-direction"])
      assert.equal(own.filter(node => String(node.attributes.class ?? "").split(/\s+/u).includes(className)).length, 1);
    const titleNode = own.find(node => node.tag === "h1");
    assert.equal(titleNode.attributes.dir, "auto"); assert.equal(eSharedNodeText(f, titleNode), title);
    const projectNode = own.find(node => node.tag === "bdi");
    assert.equal(projectNode.attributes.dir, "auto"); assert.equal(eSharedNodeText(f, projectNode), project);
    const text = owner.markup.replace(/<[^>]*>/gu, " ").replace(/\s+/gu, " ");
    assert.ok(text.includes(f.i18n.t("shared.description")));
    assert.ok(text.includes(f.i18n.t("shared.footer")));
    assert.ok(text.includes(f.i18n.t("shared.expires", undefined, { date: f.i18n.date(new Date(body.share.expiresAt), { dateStyle: "medium", timeStyle: "short" }) }).replace(/\s+/gu, " ")));
    const language = f.language(); assert.ok(language.isConnected); assert.equal(language.tag, "select");
    assert.equal(f.sessionReads.length, 0); assert.equal(f.modules.length, 0);
    assert.deepEqual(f.reads.map(row => row.url), ["/api/shared/token-a"]);
    assert.equal(f.clipboard.length, 0);
  });
  test("E Slides host: " + locale + " shared named dialog retains all native header actions and intentional reading posture", async t => {
    const f = await hostFixture(t, "shared", locale), body = eSharedSlidesBody(locale);
    await f.reply(0, response(body));
    await f.act(eSharedControl(f, "shared-presentation-open"));
    const dialog = () => f.renderer.nodes.find(node => node.owner === f.owner() && node.tag === "dialog"
      && String(node.attributes.class ?? "").split(/\s+/u).includes("shared-presentation-dialog"));
    assert.ok(dialog()); assert.equal(dialog().attributes["aria-labelledby"], "shared-presentation-heading");
    const heading = f.renderer.nodes.find(node => node.owner === f.owner() && node.attributes.id === "shared-presentation-heading");
    assert.equal(heading.attributes.dir, "auto"); assert.equal(eSharedNodeText(f, heading), body.projection.artifacts[0].title);
    assert.equal(eSharedNodeText(f, eSharedControl(f, "shared-presentation-reading-toggle")), f.i18n.system("Read slide"));
    assert.equal(eSharedNodeText(f, eSharedControl(f, "shared-presentation-focus-toggle")), f.i18n.system("Focus view"));
    await f.act(eSharedControl(f, "shared-presentation-focus-toggle"));
    assert.equal(dialog().attributes["data-output-focus"], "true");
    assert.equal(eSharedNodeText(f, eSharedControl(f, "shared-presentation-focus-toggle")), f.i18n.system("Exit focus"));
    await f.act(eSharedControl(f, "shared-presentation-reading-toggle"));
    assert.equal(eSharedNodeText(f, eSharedControl(f, "shared-presentation-reading-toggle")), f.i18n.system("Slide view"));
    const stage = f.renderer.nodes.find(node => node.owner === f.owner() && node.attributes["data-slide-posture"] === "reading");
    assert.ok(stage, "actual bound reading posture, not serialized property-marker text");
    assert.ok(f.owner().markup.includes(body.projection.artifacts[0].items[0].body));
    const close = f.renderer.nodes.filter(node => node.owner === f.owner() && node.tag === "button"
      && eSharedNodeText(f, node) === f.i18n.t("action.close", "Close"));
    assert.equal(close.length, 1); assert.equal(close[0].attributes.type, "button");
    await f.act(close[0]); assert.equal(dialog(), undefined);
    assert.deepEqual(f.reads.map(row => row.url), ["/api/shared/token-a"], "only the original finite guest read; no media or provider operation");
    assert.equal(f.sessionReads.length, 0); assert.equal(f.modules.length, 0); assert.equal(f.clipboard.length, 0);
  });
}

// F: connected specialist leaves, using the original host/native renderer.
// The route-module boundary registers the complete actual classes before its
// successful completion. The session controller, application selectors,
// navigation handlers, report readers, templates and locale providers stay
// actual; HTTP/session grants and module delivery are finite dependency ports.
// No Worker, Creator Store, customer content, SQL, provider or write is used.
// This is not browser navigation, layout/AT, live authorization or redaction
// certification. Existing whole-file test bodies above remain unchanged.
const connectedSpecialistProfiles={
  operations:{audience:"operations",path:"/operations",tag:"forma-operations-application",
    entry:"src/apps/operations/entry.ts",name:"FormaOperationsApplication",
    capabilities:["platform.incident.manage","platform.provider.configure"],
    endpoints:["/api/portfolio/operations/overview","/api/portfolio/operations/providers"],
    routes:[
      {path:"/operations",file:"src/apps/operations/overview.ts",name:"FormaOperationsOverview",tag:"forma-operations-overview",heading:"operations.overview.heading"},
      {path:"/operations/providers",file:"src/apps/operations/providers.ts",name:"FormaOperationsProviders",tag:"forma-operations-providers",heading:"operations.providers.heading"},
    ]},
  engineering:{audience:"engineering",path:"/engineering",tag:"forma-engineering-application",
    entry:"src/apps/engineering/entry.ts",name:"FormaEngineeringApplication",
    capabilities:["engineering.diagnostics.read","engineering.events.read","engineering.sync.read"],
    endpoints:["health","events","sync","jobs"].map(view=>"/api/portfolio/engineering/"+view),
    routes:["health","events","sync","jobs"].map(view=>({path:view==="health"?"/engineering":"/engineering/"+view,
      file:"src/apps/engineering/diagnostics.ts",name:"FormaEngineeringDiagnostics",tag:"forma-engineering-diagnostics",view,heading:"engineering."+view+".heading"}))},
  knowledge:{audience:"knowledge",path:"/knowledge/guidance",tag:"forma-knowledge-application",
    entry:"src/apps/knowledge/entry.ts",name:"FormaKnowledgeApplication",capabilities:["design.docs.read"],endpoints:[],
    routes:["guidance","patterns"].map(view=>({path:"/knowledge/"+view,file:"src/components/forma-design-system-lab.ts",
      name:"FormaDesignSystemLab",tag:"forma-design-system-lab",view,heading:"knowledge."+view+"Heading"}))},
};
function connectedSpecialistSession(profile,suffix="current"){
  return {user:{userId:"fixture-"+profile.audience+"-"+suffix,email:profile.audience+"@example.invalid",
    displayName:"Fictional specialist",role:"viewer"},audience:profile.audience,permissionEpoch:"fixture-"+suffix,
    capabilities:[...profile.capabilities],organizations:[],canvas:{access:false},
    availableApplications:[{id:profile.audience,href:profile.path}]};
}
function connectedSpecialistReport(label){
  return {report:{id:"fixture-connected-"+label,scope:"Bounded fictional "+label,refreshedAt:"2026-08-30T00:00:00.000Z",
    synthetic:false,metrics:[{id:"fixture-measure-"+label,label:"Fixture measure",value:null,detail:"Not a production measure"}],
    evidence:[{id:"fixture-evidence-"+label,label:"Current "+label,status:"pending",detail:"Read-only fixture evidence "+label}]}};
}
function connectedSpecialistComponent(f,tag){
  const rows=[...f.renderer.instances.values()].map(row=>row.instance).filter(instance=>instance.isConnected&&instance.tag===tag);
  assert.equal(rows.length,1,"one connected actual "+tag);return rows[0];
}
function assertConnectedSpecialist(f,profile,path){
  const row=profile.routes.find(candidate=>candidate.path===path);assert.ok(row);
  const tree=f.tree(),application=connectedSpecialistComponent(f,profile.tag),leaf=connectedSpecialistComponent(f,row.tag);
  assert.equal(application.parentElement,f.host);assert.equal(leaf.parentElement,application);
  assert.equal(f.route,path);assert.equal(f.platformSession.get()?.audience,profile.audience);
  assert.equal(f.platformSession.get()?.user.role,"viewer","only explicit finite grants, not admin fallback");
  assert.deepEqual(f.platformSession.get()?.capabilities,profile.capabilities);
  const headings=tree.visible("h1").filter(node=>node.owner===leaf);
  assert.equal(headings.length,1);assert.equal(headings[0].text,f.i18n.t(row.heading));
  if(row.view)assert.equal(leaf.view,row.view);
  const current=tree.visible("a").filter(node=>node.owner?.tag==="forma-ui-audience-navigation"
    &&node.owner.parentElement===f.host&&node.attributes["aria-current"]==="page");
  assert.equal(current.length,1);assert.equal(current[0].attributes.href,path);
  if(profile.audience!=="knowledge")assert.deepEqual(tree.visible("a").filter(node=>node.owner?.tag==="forma-ui-audience-navigation"
    &&node.owner.parentElement===f.host).map(node=>node.attributes.href),profile.routes.map(candidate=>candidate.path));
  assert.equal(String(tree.nodes.find(node=>node.owner===f.host&&node.attributes.id==="main-content")?.attributes["aria-busy"]),"false");
  assert.deepEqual(Object.keys(f.store),["route"],"the existing location-only port is not a Creator Store");
  assert.equal(tree.nodes.some(node=>["forma-shell","forma-workspace","forma-generation-actions","forma-canvas-surface"].includes(node.tag)),false);
  assert.equal(f.serviceCalls.every(call=>call.method==="GET"),true);return leaf;
}
function connectedSpecialistRefresh(f,leaf){
  const tree=f.tree(),buttons=tree.visible("button").filter(node=>node.owner===leaf&&node.text===f.i18n.t("role.refresh","Refresh evidence"));
  assert.equal(buttons.length,1);assert.equal(Object.hasOwn(buttons[0].attributes,"disabled"),false);
  assert.equal(typeof buttons[0].handlers.click,"function");return buttons[0].port;
}
async function openConnectedSpecialist(t,locale,profile){
  const f=await hostFixture(t,"platform",locale,{nativeUrlParts:true,connectedLeaf:profile});
  assert.equal(f.sessionReads.length,1);assert.equal(f.modules.length,0);
  await f.replyConnectedSession(0);await f.acceptModule(0);
  assertConnectedSpecialist(f,profile,profile.path);return f;
}

for(const locale of["en","ja"]){
  test("F connected Operations "+locale+": exact leaf, current denial and deliberate same-owner read recovery",async t=>{
    const profile=connectedSpecialistProfiles.operations,f=await openConnectedSpecialist(t,locale,profile);
    const original=assertConnectedSpecialist(f,profile,"/operations");
    assert.equal(f.reads[0].url,profile.endpoints[0]);await f.reply(0,response(connectedSpecialistReport("overview-A")));
    assert.ok(f.tree().root.text.includes("Read-only fixture evidence overview-A"));
    await f.navigate("/operations/providers");await f.acceptModule(1);
    const current=assertConnectedSpecialist(f,profile,"/operations/providers");assert.equal(original.isConnected,false);
    assert.equal(f.reads[1].url,profile.endpoints[1]);await f.reply(1,response(connectedSpecialistReport("providers-A")));
    await f.act(connectedSpecialistRefresh(f,current));assert.equal(f.reads[2].url,profile.endpoints[1]);
    const body=deferred(),wire=response({error:"fixture-denied"},403);let jsonCalls=0;
    wire.json=async()=>{jsonCalls++;await body.promise;return {error:"fixture-denied"};};t.after(()=>body.resolve());
    await f.reply(2,wire);assert.equal(jsonCalls,0,"known negative status withdraws without reading its body");
    assert.equal(f.tree().root.text.includes("Read-only fixture evidence providers-A"),false);
    assert.equal(f.tree().visible("p").some(node=>node.owner===current&&node.attributes.role==="alert"),true);
    assert.equal(assertConnectedSpecialist(f,profile,"/operations/providers"),current);
    await f.act(connectedSpecialistRefresh(f,current));await f.reply(3,response(connectedSpecialistReport("providers-recovered")));
    assert.equal(assertConnectedSpecialist(f,profile,"/operations/providers"),current);
    assert.ok(f.tree().root.text.includes("Read-only fixture evidence providers-recovered"));
    assert.equal(f.tree().visible("p").some(node=>node.owner===current&&node.attributes.role==="alert"),false);
    assert.deepEqual(f.reads.map(row=>row.url),[profile.endpoints[0],profile.endpoints[1],profile.endpoints[1],profile.endpoints[1]]);
    assert.equal(f.sessionReads.length,1,"the real singleton reuses only its current audience");
  });
  test("F connected Engineering "+locale+": every diagnostic selector and route-away/back reject an older report",async t=>{
    const profile=connectedSpecialistProfiles.engineering,f=await openConnectedSpecialist(t,locale,profile);
    const original=assertConnectedSpecialist(f,profile,"/engineering");
    assert.equal(f.reads[0].url,profile.endpoints[0]);await f.reply(0,response(connectedSpecialistReport("health-A")));
    await f.act(connectedSpecialistRefresh(f,original));assert.equal(f.reads[1].url,profile.endpoints[0]);
    await f.navigate("/engineering/events");await f.acceptModule(1);assert.equal(original.isConnected,false);
    const events=assertConnectedSpecialist(f,profile,"/engineering/events");
    assert.equal(f.reads[2].url,profile.endpoints[1]);await f.reply(2,response(connectedSpecialistReport("events-B")));
    await f.reply(1,response(connectedSpecialistReport("retired-health-A")));
    assert.equal(assertConnectedSpecialist(f,profile,"/engineering/events"),events);
    assert.ok(f.tree().root.text.includes("Read-only fixture evidence events-B"));
    assert.equal(f.tree().root.text.includes("retired-health-A"),false);
    for(const [moduleIndex,view]of [[2,"sync"],[3,"jobs"]]){
      await f.navigate("/engineering/"+view);await f.acceptModule(moduleIndex);
      assertConnectedSpecialist(f,profile,"/engineering/"+view);
      assert.equal(f.reads[moduleIndex+1].url,"/api/portfolio/engineering/"+view);
      await f.reply(moduleIndex+1,response(connectedSpecialistReport(view+"-current")));
      assert.ok(f.tree().root.text.includes("Read-only fixture evidence "+view+"-current"));
    }
    await f.navigate("/engineering");await f.acceptModule(4);
    const reentered=assertConnectedSpecialist(f,profile,"/engineering");assert.notEqual(reentered,original);
    assert.equal(f.reads[5].url,profile.endpoints[0]);await f.reply(5,response(connectedSpecialistReport("health-fresh")));
    assert.ok(f.tree().root.text.includes("Read-only fixture evidence health-fresh"));
    assert.deepEqual(f.reads.map(row=>row.url),[profile.endpoints[0],...profile.endpoints,profile.endpoints[0]]);
    assert.equal(f.sessionReads.length,1);assert.equal(f.serviceCalls.length,7);
  });
  test("F connected Knowledge "+locale+": real guidance-patterns-reentry stays fictional and grant scoped",async t=>{
    const profile=connectedSpecialistProfiles.knowledge,f=await openConnectedSpecialist(t,locale,profile);
    const original=assertConnectedSpecialist(f,profile,profile.path);
    assert.ok(f.tree().root.text.includes(f.i18n.t("lab.syntheticNotice")));
    const navigation=f.tree().visible("a").filter(node=>node.owner?.tag==="forma-ui-audience-navigation"&&node.owner.parentElement===f.host);
    assert.deepEqual(navigation.map(node=>node.attributes.href),["/knowledge/patterns","/knowledge/guidance","/knowledge/landing-pages"]);
    await f.navigate("/knowledge/patterns");await f.acceptModule(1);
    const patterns=assertConnectedSpecialist(f,profile,"/knowledge/patterns");assert.equal(original.isConnected,false);
    assert.equal(f.tree().visible("a").some(node=>node.attributes.href==="/knowledge/focal-points"),false,"docs-only scope is not a catalog grant");
    assert.ok(f.tree().root.text.includes(f.i18n.t("lab.syntheticNotice")));
    await f.navigate(profile.path);await f.acceptModule(2);
    const fresh=assertConnectedSpecialist(f,profile,profile.path);assert.notEqual(fresh,original);assert.equal(patterns.isConnected,false);
    assert.deepEqual(f.reads,[]);assert.deepEqual(f.serviceCalls,[{url:"/api/session?audience=knowledge",method:"GET"}]);
    assert.deepEqual(f.completions,[profile.path,"/knowledge/patterns",profile.path]);
  });
  test("F connected Knowledge "+locale+": denied fresh opening withdraws the leaf; deliberate re-entry uses the new session",async t=>{
    const profile=connectedSpecialistProfiles.knowledge,f=await openConnectedSpecialist(t,locale,profile);
    const original=assertConnectedSpecialist(f,profile,profile.path);
    f.disconnect();f.platformSession.reset();await f.reconnect();
    assert.equal(original.isConnected,false);assert.equal(f.sessionReads.length,2);
    await f.replyConnectedSession(1,{error:"Fixture knowledge session unavailable"},403);
    assert.equal(f.platformSession.get(),null);assert.equal(f.modules.length,1);
    assert.equal(f.tree().nodes.some(node=>node.tag===profile.tag||node.tag==="forma-design-system-lab"),false);
    assert.equal(f.tree().visible("section").some(node=>node.owner===f.host&&node.attributes.role==="alert"),true);
    f.disconnect();await f.reconnect();assert.equal(f.sessionReads.length,3);
    await f.replyConnectedSession(2,connectedSpecialistSession(profile,"fresh"));await f.acceptModule(1);
    const fresh=assertConnectedSpecialist(f,profile,profile.path);assert.notEqual(fresh,original);
    assert.equal(f.platformSession.get().user.userId,"fixture-knowledge-fresh");
    assert.equal(f.tree().root.text.includes("Fixture knowledge session unavailable"),false);
    assert.deepEqual(f.reads,[]);assert.equal(f.serviceCalls.length,3);
    assert.ok(f.serviceCalls.every(call=>call.url==="/api/session?audience=knowledge"&&call.method==="GET"));
  });
}

// F additive successor. R1's eight cases and every older body above are exact.
// These finite class/HTTP/native-lifecycle cases do not establish Worker grants,
// physical shadow distribution, asset decoding, pixel quality or release gates.
const connectedReferenceProfiles={
  access:{audience:"operations",path:"/operations/access",tag:"forma-operations-application",
    entry:"src/apps/operations/entry.ts",name:"FormaOperationsApplication",nativeLocation:true,defaultFetchCredentials:true,
    ownerModules:["src/apps/operations/access-management.ts"],capabilities:["platform.identity.manage","platform.provider.configure"],
    endpoints:["/api/admin/users","/api/platform/access","/api/portfolio/operations/providers"],
    navigation:["/operations/providers","/operations/access"],routes:[
      {path:"/operations/access",file:"src/apps/operations/access-management.ts",name:"FormaAccessManagement",tag:"forma-access-management",heading:"access.heading"},
      connectedSpecialistProfiles.operations.routes[1],
    ]},
  release:{audience:"operations",path:"/operations/canvas",tag:"forma-operations-application",
    entry:"src/apps/operations/entry.ts",name:"FormaOperationsApplication",nativeLocation:true,defaultFetchCredentials:true,
    ownerModules:["src/apps/operations/canvas-governance.ts"],capabilities:["platform.policy.manage"],
    endpoints:["/api/canvas-governance","/api/portfolio/operations/overview"],navigation:["/operations","/operations/canvas"],routes:[
      {path:"/operations/canvas",file:"src/apps/operations/canvas-governance.ts",name:"FormaCanvasGovernance",tag:"forma-canvas-governance",heading:"operations.release.heading"},
      connectedSpecialistProfiles.operations.routes[0],
    ]},
  landing:{audience:"knowledge",path:"/knowledge/landing-pages",tag:"forma-knowledge-application",
    entry:"src/apps/knowledge/entry.ts",name:"FormaKnowledgeApplication",nativeLocation:true,registerCem:["forma-ui-card"],
    literalImports:[["./landing-pages","src/apps/knowledge/landing-pages.ts"]],capabilities:["design.docs.read"],endpoints:[],
    navigation:["/knowledge/patterns","/knowledge/guidance","/knowledge/landing-pages"],routes:[
      {path:"/knowledge/landing-pages",inline:true,initialize:"loadKnowledgeRoute",heading:"knowledge.landing.heading"},
      connectedSpecialistProfiles.knowledge.routes[0],
    ]},
  focal:{audience:"knowledge",path:"/knowledge/focal-points",tag:"forma-knowledge-application",
    entry:"src/apps/knowledge/entry.ts",name:"FormaKnowledgeApplication",nativeLocation:true,defaultFetchCredentials:true,
    capabilities:["design.catalog.read"],endpoints:[1,2,3].map(index=>"/focal-point-lab/children-in-park-0"+index+".png"),
    navigation:["/knowledge/design-system","/knowledge/patterns","/knowledge/landing-pages"],routes:[
      {path:"/knowledge/focal-points",file:"src/components/forma-focal-point-lab.ts",name:"FormaFocalPointLab",tag:"forma-focal-point-lab",heading:"knowledge.focal.heading",navigationPath:"/knowledge/patterns"},
    ]},
};
const referenceClass=(node,name)=>String(node.attributes.class??"").split(/\s+/u).includes(name);
function assertConnectedReference(f,profile,path=profile.path){
  const row=profile.routes.find(candidate=>candidate.path===path);assert.ok(row);
  const tree=f.tree(),application=connectedSpecialistComponent(f,profile.tag);
  const leaf=row.inline?application:connectedSpecialistComponent(f,row.tag);
  assert.equal(application.parentElement,f.host);if(!row.inline)assert.equal(leaf.parentElement,application);
  assert.equal(f.route,path);assert.equal(f.platformSession.get()?.audience,profile.audience);
  assert.equal(f.platformSession.get()?.user.role,"viewer");assert.deepEqual(f.platformSession.get()?.capabilities,profile.capabilities);
  const headings=tree.visible("h1").filter(node=>node.owner===leaf);
  assert.equal(headings.length,1);assert.equal(headings[0].text,f.i18n.t(row.heading));
  if(row.view)assert.equal(leaf.view,row.view);
  const navigation=tree.visible("a").filter(node=>node.owner?.tag==="forma-ui-audience-navigation"&&node.owner.parentElement===f.host);
  assert.deepEqual(navigation.map(node=>node.attributes.href),profile.navigation);
  assert.deepEqual(navigation.filter(node=>node.attributes["aria-current"]==="page").map(node=>node.attributes.href),[row.navigationPath??path]);
  assert.equal(String(tree.nodes.find(node=>node.owner===f.host&&node.attributes.id==="main-content")?.attributes["aria-busy"]),"false");
  assert.deepEqual(Object.keys(f.store),["route"]);
  assert.equal(tree.nodes.some(node=>["forma-shell","forma-workspace","forma-output-requirements","forma-generation-actions","forma-canvas-surface"].includes(node.tag)),false);
  assert.ok(f.serviceCalls.every(call=>call.method==="GET"));return leaf;
}
async function openConnectedReference(t,locale,profile){
  const f=await hostFixture(t,"platform",locale,{nativeUrlParts:true,connectedLeaf:profile});
  assert.equal(f.sessionReads.length,1);await f.replyConnectedSession(0);await f.acceptModule(0);
  assertConnectedReference(f,profile);return f;
}
function referenceButton(f,owner,key,fallback){
  const buttons=f.tree().visible("button").filter(node=>node.owner===owner&&node.text===f.i18n.t(key,fallback));
  assert.equal(buttons.length,1);assert.equal(Object.hasOwn(buttons[0].attributes,"disabled"),false);
  assert.equal(typeof buttons[0].handlers.click,"function");return buttons[0].port;
}
function accessReadPair(label){
  // Existing B3 Access fields/paired envelopes; fictional rows only.
  const user={user_id:"fixture-"+label,email:label+"@example.invalid",display_name:"Fictional "+label,role:"viewer"};
  return {users:{users:[user]},grants:{grants:[{...user,grant_id:"fixture-grant/"+label,
    capability:"design.docs.read",scope_type:"platform",expires_at:null}]}};
}
function releaseReadEnvelope(label){
  // GET envelope of canvas-governance-api; every requirement is unapproved.
  // This is a finite contract fixture, never a deployed approval or provider run.
  const requirements=["trust_safety","counsel","second_image_adapter"].map(id=>({id,label:label+" "+id,
    summary:"Fictional retained requirement "+id,approved:false,approvedBy:null,approvedByUserId:null,
    approvedAt:null,evidenceRef:null,details:{}}));
  return {governance:{version:"fixture-governance",mode:"internal",pilotAvailable:false,access:false,
    accessReason:"pilot-gate-incomplete",requirements,blockedBy:requirements.map(row=>row.id)},
    confirmation:"I understand, record this Canvas approval",adapterCandidate:{configured:false,provider:"fixture",
      adapterId:"fixture-adapter",adapterVersion:"fixture-v1",modelId:"fixture-model",previewModelId:"fixture-preview",editModelId:"fixture-edit",
      capabilityReceiptRef:"fixture-reference",evaluationRequired:true,readiness:{configured:false,fal:false,missing:["Fixture configuration absent"]},
      retryPlan:{corpusVersion:"fixture-corpus",caseCount:2,comparisonAdapter:"fixture-reference",candidateAdapter:"fixture-adapter",
        estimatedProviderCostUsd:{minimum:4,maximum:7},paid:true,requiresExplicitApproval:true,status:"configuration_required"},
      evaluationPlan:{corpusVersion:"fixture-corpus",caseCount:2,adapterId:"fixture-adapter",adapterVersion:"fixture-v1",promptAdapterVersion:"fixture-v1",
        status:"configuration_required",changes:[],acceptanceCriteria:{}},currentEvaluation:null,lastEvaluation:null,retainedEvaluations:[]}};
}

for(const locale of["en","ja"]){
  test("F additional Access "+locale+": connected paired reads deny without partial disclosure and recover by current Refresh",async t=>{
    const profile=connectedReferenceProfiles.access,f=await openConnectedReference(t,locale,profile),owner=assertConnectedReference(f,profile);
    assert.deepEqual(f.reads.map(row=>row.url),profile.endpoints.slice(0,2));
    const original=accessReadPair("original-A");await f.reply(0,response(original.users));
    assert.equal(f.tree().root.text.includes("Fictional original-A"),false,"one verified half is not a publishable access view");
    const denied=response({error:"fixture_denied"},403);let parsed=0;denied.json=async()=>{parsed++;return original.grants;};
    await f.reply(1,denied);assert.equal(parsed,0);assert.equal(f.tree().root.text.includes("Fictional original-A"),false);
    assert.ok(f.tree().root.text.includes(f.i18n.t("access.unavailable")));assert.equal(f.tree().visible("form").filter(node=>node.owner===owner).length,0);
    await f.act(referenceButton(f,owner,"access.refresh"));const recovered=accessReadPair("recovered-B");
    assert.deepEqual(f.reads.slice(2).map(row=>row.url),profile.endpoints.slice(0,2));
    await f.reply(2,response(recovered.users));await f.reply(3,response(recovered.grants));
    assert.equal(assertConnectedReference(f,profile),owner);assert.ok(f.tree().root.text.includes("recovered-B@example.invalid"));
    assert.equal(f.tree().root.text.includes("original-A@example.invalid"),false);
    await f.navigate("/operations/providers");await f.acceptModule(1);assert.equal(owner.isConnected,false);
    assertConnectedReference(f,profile,"/operations/providers");await f.reply(4,response(connectedSpecialistReport("provider-current")));
    await f.navigate(profile.path);await f.acceptModule(2);const fresh=assertConnectedReference(f,profile);assert.notEqual(fresh,owner);
    const current=accessReadPair("reentered-C");await f.reply(5,response(current.users));await f.reply(6,response(current.grants));
    assert.ok(f.tree().root.text.includes("reentered-C@example.invalid"));assert.equal(f.tree().root.text.includes("recovered-B@example.invalid"),false);
    assert.equal(f.serviceCalls.length,8);assert.ok(f.serviceCalls.every(call=>call.method==="GET"),"no grant, revoke or command was activated");
  });
  test("F additional Release "+locale+": denied connected read exposes Retry and recovered policy-only view cannot approve",async t=>{
    const profile=connectedReferenceProfiles.release,f=await openConnectedReference(t,locale,profile),owner=assertConnectedReference(f,profile);
    assert.equal(f.reads[0].url,"/api/canvas-governance");await f.reply(0,response({error:"Fixture governance unavailable"},403));
    assert.equal(f.tree().visible("div").some(node=>node.owner===owner&&node.attributes.role==="alert"),true);
    const retry=f.tree().visible("button").filter(node=>node.owner===owner&&typeof node.handlers.click==="function");
    assert.equal(retry.length,1);assert.equal(Object.hasOwn(retry[0].attributes,"disabled"),false);await f.act(retry[0].port);
    assert.equal(f.reads[1].url,"/api/canvas-governance");const body=releaseReadEnvelope("Governance A");await f.reply(1,response(body));
    assert.equal(assertConnectedReference(f,profile),owner);assert.equal(f.tree().visible("form").filter(node=>node.owner===owner).length,0);
    for(const requirement of body.governance.requirements)assert.ok(f.tree().root.text.includes(requirement.label));
    assert.ok(f.tree().root.text.includes(f.i18n.t("operations.release.readOnly")));
    assert.equal(f.tree().root.text.includes("Fixture governance unavailable"),false);
    await f.navigate("/operations");await f.acceptModule(1);assert.equal(owner.isConnected,false);
    assertConnectedReference(f,profile,"/operations");await f.reply(2,response(connectedSpecialistReport("overview-current")));
    await f.navigate(profile.path);await f.acceptModule(2);const fresh=assertConnectedReference(f,profile);assert.notEqual(fresh,owner);
    await f.reply(3,response(releaseReadEnvelope("Governance B")));assert.ok(f.tree().root.text.includes("Governance B trust_safety"));
    assert.equal(f.tree().root.text.includes("Governance A trust_safety"),false);assert.equal(f.tree().visible("form").filter(node=>node.owner===fresh).length,0);
    assert.equal(f.serviceCalls.length,5);assert.ok(f.serviceCalls.every(call=>call.method==="GET"));
  });
  test("F additional Landing catalog "+locale+": actual lazy entry renders four current public destinations and re-entry",async t=>{
    const profile=connectedReferenceProfiles.landing,f=await openConnectedReference(t,locale,profile);
    const original=assertConnectedReference(f,profile);
    const {marketingPath}=await ports.loadActual("src/marketing/profiles.ts");
    const profiles=["generic","hollywood-filmmakers","marketers","indie-filmmakers"];
    const check=()=>{
      const cards=[...f.renderer.instances.values()].map(row=>row.instance).filter(instance=>instance.isConnected&&instance.tag==="forma-ui-card");
      assert.equal(cards.length,4);assert.ok(cards.every(card=>card.parentElement===assertConnectedReference(f,profile)));
      assert.deepEqual(cards.map(card=>card.value),profiles);
      const tree=f.tree(),images=tree.visible("img");assert.equal(images.length,4);
      assert.ok(images.every(node=>String(node.attributes.src).startsWith("/assets/marketing/")&&node.attributes.loading==="lazy"));
      const localizedLinks=tree.visible("a").filter(node=>node.attributes.lang);assert.equal(localizedLinks.length,16);
      for(const language of["en","fr","ar","ja"])assert.equal(localizedLinks.filter(node=>node.attributes.lang===language).length,4);
      assert.deepEqual(localizedLinks.map(node=>node.attributes.href).sort(),profiles.flatMap(profile=>["en","fr","ar","ja"].map(language=>marketingPath(profile,language))).sort());
      const publicLinks=tree.visible("a").filter(node=>node.attributes.target==="_blank");assert.equal(publicLinks.length,8);
      assert.ok(publicLinks.every(node=>node.attributes.rel==="noopener"&&node.attributes["aria-describedby"]));
      assert.deepEqual(publicLinks.map(node=>node.attributes.href).sort(),profiles.flatMap(profile=>[marketingPath(profile,locale),marketingPath(profile,locale)]).sort());
      assert.equal(f.tree().nodes.some(node=>node.tag==="forma-design-system-lab"||node.tag==="forma-component-catalog"),false);
    };
    check();await f.navigate("/knowledge/guidance");await f.acceptModule(1);assert.equal(original.isConnected,false);
    assertConnectedReference(f,profile,"/knowledge/guidance");await f.navigate(profile.path);await f.acceptModule(2);
    assert.notEqual(assertConnectedReference(f,profile),original);check();
    assert.deepEqual(f.reads,[]);assert.deepEqual(f.serviceCalls,[{url:"/api/session?audience=knowledge",method:"GET"}]);
    assert.deepEqual(f.assignments,[],"public links were inspected, never opened or fetched");
  });
  test("F additional Focal leaf "+locale+": missing supplied image reads stay unresolved and a fresh owner re-enters",async t=>{
    const profile=connectedReferenceProfiles.focal,f=await openConnectedReference(t,locale,profile),owner=assertConnectedReference(f,profile);
    assert.equal(f.reads.length,6,"the actual two algorithms request each of three supplied local images");
    for(const path of profile.endpoints)assert.equal(f.reads.filter(row=>row.url===path).length,2);
    for(let index=0;index<6;index++)await f.reply(index,response({error:"fixture_local_asset_unavailable"},404));
    assert.equal(assertConnectedReference(f,profile),owner);
    assert.equal(f.tree().visible("article").filter(node=>referenceClass(node,"focal-lab-asset")).length,0,"failed reads cannot fabricate calculated results");
    const back=f.tree().visible("a").filter(node=>node.owner===owner&&node.attributes.href==="/knowledge/patterns");
    assert.equal(back.length,1);assert.ok(back[0].text.includes(f.i18n.t("knowledge.focal.return")));
    // Existing finite disconnect/reconnect boundary, not an invented link router.
    f.disconnect();await f.reconnect();await f.acceptModule(1);const fresh=assertConnectedReference(f,profile);assert.notEqual(fresh,owner);
    assert.equal(owner.isConnected,false);assert.equal(f.reads.length,12);
    for(const path of profile.endpoints)assert.equal(f.reads.slice(6).filter(row=>row.url===path).length,2);
    assert.ok(f.serviceCalls.every(call=>call.method==="GET"));assert.equal(f.serviceCalls.length,13);
    assert.equal(f.tree().visible("article").filter(node=>referenceClass(node,"focal-lab-asset")).length,0);
    // Successful bitmap decode / 2D sampling / comparison is explicitly NOT
    // covered: no fake bitmap, image samples, timing or passing result is added.
  });
}

// C additive no-write Platform owner baselines. The existing complete Shell,
// actual application entries/session singleton, GET-only HTTP queue, renderer
// and native focus ports above remain unchanged. These cases never submit a
// grant, approval, estimate, impersonation, archive or paid generation request.
const cPlatformRawProfiles = {
  access: { ...connectedReferenceProfiles.access, locale: "en", ownerTag: "forma-access-management",
    destination: "/operations/providers", destinationTag: "forma-operations-providers",
    destinationHeading: "operations.providers.heading", initialReads: ["/api/admin/users", "/api/platform/access"],
    destinationRead: "/api/portfolio/operations/providers" },
  governance: { ...connectedReferenceProfiles.release, locale: "ja", ownerTag: "forma-canvas-governance",
    capabilities: ["platform.policy.manage", "platform.release.approve"],
    destination: "/operations", destinationTag: "forma-operations-overview",
    destinationHeading: "operations.overview.heading", initialReads: ["/api/canvas-governance"],
    destinationRead: "/api/portfolio/operations/overview" },
  replay: { audience: "product", path: "/product/evaluation/actual", tag: "forma-product-application",
    entry: "src/apps/product/entry.ts", name: "FormaProductApplication", nativeLocation: true,
    defaultFetchCredentials: true, locale: "ar", ownerTag: "forma-actual-replay",
    ownerModules: ["src/apps/product/entry.ts", "src/apps/product/actual-replay.ts", "src/apps/product/insights.ts"],
    capabilities: ["product.analytics.read", "evaluation.actual.run", "evaluation.synthetic.read"],
    endpoints: ["/api/replay-sessions", "/api/portfolio/product/insights"],
    routes: [
      { path: "/product/evaluation/actual", file: "src/apps/product/actual-replay.ts", name: "FormaActualReplay", tag: "forma-actual-replay" },
      { path: "/product/insights", file: "src/apps/product/insights.ts", name: "FormaProductInsights", tag: "forma-product-insights" },
    ],
    destination: "/product/insights", destinationTag: "forma-product-insights",
    destinationHeading: "product.insights.heading", initialReads: ["/api/replay-sessions"],
    destinationRead: "/api/portfolio/product/insights" },
};
const cPlatformWithin = (node, parent) => {
  for (let current = node.parent; current; current = current.parent) if (current === parent) return true;
  return false;
};
function cPlatformRawOwner(f, profile) {
  const owners = [...f.renderer.instances.values()].map(row => row.instance)
    .filter(owner => owner.isConnected && owner.tag === profile.ownerTag);
  assert.ok(owners.length <= 1, "at most one actual current source owner");
  return owners[0] ?? null;
}
function cPlatformRawFields(f, key) {
  const profile = cPlatformRawProfiles[key], owner = cPlatformRawOwner(f, profile);
  assert.ok(owner, "the actual writable source leaf is current");
  assert.equal(owner.parentElement.parentElement, f.host);
  const tree = f.tree();
  let fields, names;
  if (key === "access") {
    const forms = tree.visible("form").filter(node => node.owner === owner && referenceClass(node, "access-grant-form"));
    assert.equal(forms.length, 1);
    fields = tree.visible("select").filter(node => node.owner === owner && cPlatformWithin(node, forms[0]));
    names = ["person", "capability"]; assert.equal(fields.length, 2);
  } else if (key === "governance") {
    const forms = tree.visible("form").filter(node => node.owner === owner && referenceClass(node, "canvas-governance-approval"));
    assert.equal(forms.length, 2, "the two actual unapproved attestation forms are writable, not the old read-only profile");
    fields = forms.map(form => {
      const inputs = tree.visible("input").filter(node => node.owner === owner && cPlatformWithin(node, form));
      assert.equal(inputs.length, 1); assert.ok(Object.hasOwn(inputs[0].attributes, "required")); return inputs[0];
    });
    names = ["trustSafety", "counsel"];
  } else {
    const sections = tree.visible("section").filter(node => node.owner === owner && node.attributes["aria-labelledby"] === "actual-new-heading");
    assert.equal(sections.length, 1, "actual configured Replay preparation is present");
    const forms = tree.visible("form").filter(node => node.owner === owner && cPlatformWithin(node, sections[0]));
    assert.equal(forms.length, 1);
    fields = tree.visible("textarea").filter(node => node.owner === owner && cPlatformWithin(node, forms[0]));
    names = ["seed"]; assert.equal(fields.length, 1);
    const phrase = tree.visible("input").filter(node => cPlatformWithin(node, forms[0]) && node.attributes.name === "phrase");
    const acknowledgements = tree.visible("input").filter(node => cPlatformWithin(node, forms[0]) && node.attributes.name === "acknowledged");
    assert.equal(phrase.length, 1); assert.equal(phrase[0].port.value, "");
    assert.equal(acknowledgements.length, 1); assert.equal(acknowledgements[0].port.checked, false);
    assert.equal(tree.visible("dialog").filter(node => node.port?.open).length, 0);
  }
  for (const field of fields) {
    assert.ok(field.port?.isConnected && f.renderer.nodes.includes(field.port), "current emitted native field");
    assert.equal(field.hiddenBy, null); assert.equal(Object.hasOwn(field.attributes, "disabled"), false);
    assert.equal(Object.hasOwn(field.attributes, "readonly"), false);
    assert.equal(field.port.disabled === true, false);
    assert.equal(field.properties.disabled === true, false);
    assert.equal(typeof field.port.value, "string", "observe the native raw value, not visible text or a presumed default");
    assert.ok(Object.hasOwn(field.properties, "value"), "this actual field has its existing controlled binding");
    for (let parent = field.parent; parent; parent = parent.parent)
      assert.equal(Object.hasOwn(parent.attributes ?? {}, "inert") || parent.tag === "fieldset" && Object.hasOwn(parent.attributes, "disabled"), false);
  }
  const options = Object.fromEntries(fields.map((field, index) => [names[index], field.tag === "select"
    ? tree.nodes.filter(node => node.tag === "option" && cPlatformWithin(node, field)).map(node => ({
      value: String(node.attributes.value ?? node.text), disabled: Object.hasOwn(node.attributes, "disabled"), text: node.text,
    })) : []]));
  return { owner, fields: Object.fromEntries(fields.map((field, index) => [names[index], field])),
    raw: Object.fromEntries(fields.map((field, index) => [names[index], field.port.value])), options };
}
async function cPlatformRawPage(t, key) {
  const profile = cPlatformRawProfiles[key];
  const f = await hostFixture(t, "platform", profile.locale, { nativeUrlParts: true, connectedLeaf: profile });
  // Use the original real singleton's queued session Response, not a patched
  // get/load method. This finite admin/capability projection is not a live grant.
  const session = { ...sessionValue(), audience: profile.audience, capabilities: [...profile.capabilities],
    availableApplications: [{ id: profile.audience, href: profile.path }] };
  assert.equal(f.sessionReads.length, 1); assert.equal(f.modules.length, 0);
  await f.replyConnectedSession(0, session); await f.acceptModule(0);
  assert.equal(f.route, profile.path); assert.equal(f.platformSession.get().user.role, "admin");
  assert.deepEqual(f.platformSession.get().capabilities, profile.capabilities);
  assert.deepEqual(f.reads.map(row => row.url), profile.initialReads);
  if (key === "access") {
    const first = accessReadPair("choice-A"), second = accessReadPair("choice-B");
    await f.reply(0, response({ users: [...first.users.users, ...second.users.users] }));
    await f.reply(1, response(first.grants));
  } else if (key === "governance") {
    await f.reply(0, response(releaseReadEnvelope("Unsubmitted governance")));
  } else {
    // Existing Replay GET schema only. No quote/approval POST is invoked, and
    // the unchanged hostFixture rejects every method except GET.
    await f.reply(0, response({ sessions: [], liveGeneration: {
      enabled: true, configured: true, approvalPhrase: "FINITE_READ_ONLY_NO_APPROVAL",
      confirmationVersion: "finite-read-only-version",
      cost: { estimate: { authorizationMicrousd: 1000000, estimatedMicrousd: 500000, operations: 1 },
        fitsReplayStructure: true, fitsWorkspace: true, requiresUserOverride: false },
    } }));
  }
  await f.flush();
  const current = cPlatformRawFields(f, key);
  assert.equal(f.platformSession.get().audience, profile.audience);
  assert.deepEqual(Object.keys(f.store), ["route"], "no Creator Store or substitute draft manager is introduced");
  assert.equal(f.tree().nodes.some(node => ["forma-platform-assistant", "forma-shell", "forma-canvas-surface"].includes(node.tag)), false);
  assert.equal(f.tree().visible("dialog").filter(node => node.port?.open).length, 0, "the ordinary task is not behind a modal");
  if (key === "access") {
    assert.equal(current.options.person.length, 2); assert.ok(current.options.capability.length > 1);
    assert.equal(current.raw.person, current.options.person[0].value, "the current first eligible person is a clean nonempty loaded choice");
    assert.equal(current.raw.capability, current.options.capability[0].value, "the actual initial capability is clean");
  } else if (key === "governance") {
    assert.deepEqual(current.raw, { trustSafety: "administrator-attestation:2026-08-20", counsel: "counsel-approval-attestation:2026-08-20" },
      "the original app's prefilled nonempty attestations are pristine, not raw B");
  } else assert.deepEqual(current.raw, { seed: "" });
  assert.equal(f.serviceCalls.length, 1 + profile.initialReads.length);
  assert.ok(f.serviceCalls.every(call => call.method === "GET"));
  return { f, profile, originalOwner: current.owner, clean: current.raw, choices: current.options,
    session: f.platformSession.get(), initialCalls: structuredClone(f.serviceCalls) };
}
async function cPlatformWriteRaw(f, key, values) {
  for (const [name, value] of Object.entries(values)) {
    const current = cPlatformRawFields(f, key), field = current.fields[name];
    assert.ok(field, "only the exact declared source field is edited");
    if (current.raw[name] === value) continue;
    if (field.tag === "select") assert.ok(current.options[name].some(option => option.value === value && !option.disabled),
      "only a current emitted eligible choice is selected");
    field.port.value = value;
    await f.act(field.port, field.tag === "select" ? "change" : "input");
    f.draw(); // normal full render observes the actual input handler's state
    assert.equal(cPlatformRawFields(f, key).raw[name], value);
  }
  assert.deepEqual(cPlatformRawFields(f, key).raw, values);
}
async function cPlatformTask(f, profile) {
  f.draw();
  const rows = f.tree().visible("a").filter(node => node.owner?.tag === "forma-ui-audience-navigation"
    && node.owner.parentElement === f.host && node.attributes.href === profile.destination);
  assert.equal(rows.length, 1, "one actual authorized same-app task anchor"); const row = rows[0];
  f.rawDepartureDispatch ??= new WeakSet();
  if (!f.rawDepartureDispatch.has(row.owner)) {
    // Reuse Platform Delivery's native cancelable dispatch-return contract.
    // The actual navigation/Shell handlers run unchanged; no app method/result
    // or common fixture implementation is replaced.
    const dispatch = row.owner.dispatchEvent;
    row.owner.dispatchEvent = function (event) {
      const result = dispatch.call(this, event);
      return event.cancelable && event.defaultPrevented ? false : result;
    };
    f.rawDepartureDispatch.add(row.owner);
  }
  f.native.emit("pointerdown", row.port); f.native.focus(row.port);
  const event = { type: "click", target: row.port, currentTarget: row.port, button: 0,
    metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, composedPath: () => [row.port, row.owner, f.host] };
  assert.equal(typeof row.handlers.click, "function"); row.handlers.click.call(row.owner, event);
  assert.equal(event.defaultPrevented, true, "the actual bound Shell cancels the native same-app anchor default");
  await f.flush();
}
async function cPlatformArrived(f, profile, originalOwner, session, initialCalls) {
  assert.equal(f.route, profile.destination); assert.equal(originalOwner.isConnected, false);
  assert.equal(cPlatformRawOwner(f, profile), null);
  assert.equal(f.sessionReads.length, 1, "the actual singleton reuses the current same-audience session");
  assert.equal(f.modules.length, 2); assert.equal(f.modules[1].path, profile.destination);
  await f.acceptModule(1);
  assert.deepEqual(f.reads.map(row => row.url), [...profile.initialReads, profile.destinationRead]);
  await f.reply(profile.initialReads.length, response(connectedSpecialistReport("current " + profile.destination)));
  const owner = connectedSpecialistComponent(f, profile.destinationTag), tree = f.tree();
  assert.equal(owner.parentElement.parentElement, f.host);
  const headings = tree.visible("h1").filter(node => node.owner === owner);
  assert.equal(headings.length, 1); assert.equal(headings[0].text, f.i18n.t(profile.destinationHeading));
  assert.equal(f.platformSession.get(), session);
  assert.deepEqual(f.serviceCalls, [...initialCalls, { url: profile.destinationRead, method: "GET" }]);
  assert.deepEqual(f.completions, [profile.path, profile.destination]); assert.deepEqual(f.assignments, []);
}

for (const key of ["access", "governance", "replay"]) for (const mode of ["clean", "raw-restore"])
  test("C actual Platform unsent work " + key + " / " + mode, { concurrency: false, timeout: 45000 }, async t => {
    const { f, profile, originalOwner, clean, choices, session, initialCalls } = await cPlatformRawPage(t, key);
    // Observation only: retain the exact existing GET-only dispatcher and every
    // original allowlist assertion. Even an app-caught forbidden attempt is
    // visible here; no response, grant, approval or financial result is supplied.
    const dispatch = globalThis.fetch, attempts = [];
    globalThis.fetch = function (...args) {
      attempts.push({ url: String(args[0]), method: args[1]?.method ?? "GET" });
      return Reflect.apply(dispatch, this, args);
    };
    try {
      if (mode === "raw-restore") {
        const edits = key === "access" ? [
          { ...clean, person: choices.person[1].value },
          { ...clean, capability: choices.capability.find(option => option.value !== clean.capability && !option.disabled).value },
        ] : key === "governance" ? [
          { ...clean, trustSafety: "  Unsubmitted attestation B 文書\nنور  " },
          { ...clean, counsel: "  Unsubmitted counsel evidence B 文書  " },
        ] : [{ seed: "  Unsubmitted fictional direction B 文書\nنور  " }];
        for (const edited of edits) {
          await cPlatformWriteRaw(f, key, edited);
          assert.equal(cPlatformRawOwner(f, profile), originalOwner);
          assert.deepEqual(attempts, [], "authoring only uses the current native field");
          await cPlatformTask(f, profile);
          const retained = cPlatformRawOwner(f, profile);
          t.diagnostic("PLATFORM_UNSENT_DEPARTURE " + JSON.stringify({ surface: key, mode, from: profile.path, route: f.route,
            originalOwnerConnected: originalOwner.isConnected, edited,
            currentRaw: retained === originalOwner ? cPlatformRawFields(f, key).raw : null,
            additionalRequests: attempts, modules: f.modules.length }));
          assert.equal(f.route, profile.path, "ordinary same-app navigation must not discard current unsubmitted work");
          assert.equal(retained, originalOwner); assert.ok(originalOwner.isConnected);
          assert.deepEqual(cPlatformRawFields(f, key).raw, edited);
          assert.deepEqual(attempts, []); assert.deepEqual(f.serviceCalls, initialCalls);
          assert.equal(f.modules.length, 1); assert.equal(f.platformSession.get(), session);
          const tree = f.tree(), notices = tree.visible("p").filter(node => node.owner === f.host && referenceClass(node, "platform-departure-notice"));
          assert.equal(notices.length, 1); assert.equal(notices[0].attributes.role, "status");
          assert.equal(notices[0].text, f.i18n.t("next.lifecycle.currentWorkOpen"));
          assert.equal(tree.visible("dialog").filter(node => node.port?.open).length, 0);
          await cPlatformWriteRaw(f, key, clean);
          assert.deepEqual(cPlatformRawFields(f, key).raw, clean, "explicit current native restoration, not reset by response or navigation");
          assert.deepEqual(attempts, []); assert.deepEqual(f.serviceCalls, initialCalls);
        }
      }
      await cPlatformTask(f, profile);
      await cPlatformArrived(f, profile, originalOwner, session, initialCalls);
      assert.deepEqual(attempts, [{ url: profile.destinationRead, method: "GET" }]);
      t.diagnostic("PLATFORM_UNSENT_HEALTHY " + JSON.stringify({ surface: key, mode, route: f.route,
        clean, originalOwnerConnected: originalOwner.isConnected, attempts }));
    } finally { globalThis.fetch = dispatch; }
  });

// Separate no-write companions: actual contract, approval phrase and checkbox.
// The old six cases and every shared fixture above remain unchanged.
function cPlatformReplayFormLifetime(t, f) {
  // Same exact owner/TemplateResult native-lifetime pattern as the existing
  // image-format-native-lifetime and replay-callback-native ports. Reuse this
  // renderer; do not replace a component, requestUpdate or updateComplete.
  const draw = f.renderer.draw.bind(f.renderer), value = f.renderer.value.bind(f.renderer), collect = f.renderer.collect.bind(f.renderer);
  const NativeFormData = globalThis.FormData, records = new Map(), descriptions = new Map(), seen = new Set();
  let drawing = false;
  const retire = owner => {
    const record = records.get(owner); if (!record) return;
    for (const node of record.nodes.values()) { node.isConnected = false; node.parentElement = null; }
    records.delete(owner);
  };
  f.renderer.value = (part, owner, path, caches) => {
    if (drawing && owner?.tag === "forma-actual-replay" && part?.strings
      && part.strings[0].includes('<section aria-labelledby="actual-new-heading">')) {
      assert.ok(!descriptions.has(owner), "one emitted Replay approval-form template per actual owner");
      descriptions.set(owner, { path, strings: part.strings });
    }
    return value(part, owner, path, caches);
  };
  f.renderer.collect = (markup, owner) => {
    const start = f.renderer.nodes.length; collect(markup, owner);
    const description = descriptions.get(owner);
    if (!drawing || owner?.tag !== "forma-actual-replay" || !description) return;
    const own = f.renderer.nodes.slice(start), forms = own.filter(node => node.tag === "form" && String(node.handlers.submit).includes("#approve"));
    assert.equal(forms.length, 1, "the actual Replay approval handler owns this native form");
    const fields = own.filter(node => ["input", "textarea"].includes(node.tag));
    assert.deepEqual(fields.map(node => node.attributes.name ?? "seed"), ["seed", "phrase", "acknowledged"],
      "this finite no-persona/no-override context has only the three actual emitted fields");
    let record = records.get(owner);
    if (record && (record.path !== description.path || record.strings !== description.strings
      || ![...record.nodes.values()].every(node => node.isConnected))) { retire(owner); record = null; }
    if (!record) { record = { owner, ...description, nodes: new Map(), fields: new Map() }; records.set(owner, record); }
    const keep = (key, fresh, parent) => {
      let node = record.nodes.get(key);
      if (!node) { node = fresh; record.nodes.set(key, node); }
      // Unbound value/checked remain on the exact native node. Controlled seed
      // uses the original renderer's committed PropertyPart result unchanged.
      for (const property of ["full", "handlers", "attributes", "properties", "propertyParts"]) node[property] = fresh[property];
      if (Object.hasOwn(fresh.properties, "value")) { node.value = fresh.value; node.committedValue = fresh.committedValue; }
      if (Object.hasOwn(fresh.properties, "checked")) node.checked = fresh.properties.checked;
      node.disabled = Object.hasOwn(fresh.attributes, "disabled"); node.isConnected = true; node.parentElement = parent;
      const index = f.renderer.nodes.indexOf(fresh); assert.ok(index >= 0); f.renderer.nodes[index] = node;
      if (node !== fresh) fresh.isConnected = false;
      return node;
    };
    record.form = keep("form", forms[0], owner);
    record.fields = new Map(fields.map(fresh => {
      const name = fresh.attributes.name ?? "seed"; return [name, keep("field:" + name, fresh, record.form)];
    }));
    record.form.elements = { namedItem: name => record.fields.get(name) ?? null };
    seen.add(owner);
  };
  f.renderer.draw = (...args) => {
    drawing = true; descriptions.clear(); seen.clear();
    try { return draw(...args); }
    finally {
      drawing = false;
      for (const [owner, record] of records) if (!seen.has(owner) || !owner.isConnected
        || ![...record.nodes.values()].every(node => f.renderer.nodes.includes(node))) retire(owner);
    }
  };
  globalThis.FormData = class extends NativeFormData {
    constructor(form) {
      const record = [...records.values()].find(row => row.form === form);
      if (!record) { super(form); return; }
      super(); assert.ok(form.isConnected && record.owner.isConnected && f.renderer.nodes.includes(form));
      for (const [name, node] of record.fields) {
        assert.ok(node.isConnected && node.parentElement === form);
        if (name === "seed" || node.matches(":disabled") || node.attributes.type === "checkbox" && !node.checked) continue;
        this.append(name, String(node.value));
      }
    }
  };
  t.after(() => { globalThis.FormData = NativeFormData; });
  f.draw();
  return { record: owner => records.get(owner) ?? null };
}
function cPlatformExtraField(f, kind) {
  const key = kind === "contract" ? "governance" : "replay", profile = cPlatformRawProfiles[key], owner = cPlatformRawOwner(f, profile);
  assert.ok(owner?.isConnected); const tree = f.tree();
  const forms = tree.visible("form").filter(node => node.owner === owner && (kind === "contract"
    ? referenceClass(node, "canvas-adapter-approval") : String(node.handlers.submit).includes("#approve")));
  assert.equal(forms.length, 1);
  const fields = tree.visible("input").filter(node => node.owner === owner && cPlatformWithin(node, forms[0]) && (kind === "contract"
    ? node.attributes.placeholder === "fal-entitlement://…" : node.attributes.name === kind));
  assert.equal(fields.length, 1); const field = fields[0];
  assert.ok(field.port?.isConnected && f.renderer.nodes.includes(field.port));
  assert.equal(field.hiddenBy, null); assert.equal(field.port.matches(":disabled"), false);
  assert.equal(Object.hasOwn(field.attributes, "readonly"), false);
  assert.equal(Object.hasOwn(field.properties, "value"), kind === "contract");
  if (kind !== "contract") assert.equal(Object.hasOwn(field.properties, "checked"), false);
  for (let parent = field.parent; parent; parent = parent.parent) assert.equal(Object.hasOwn(parent.attributes ?? {}, "inert"), false);
  return { owner, form: forms[0], field, raw: kind === "acknowledged" ? Boolean(field.port.checked) : field.port.value };
}
async function cPlatformWriteExtra(f, kind, raw) {
  const before = cPlatformExtraField(f, kind), field = before.field;
  if (kind === "acknowledged") field.port.checked = raw; else field.port.value = raw;
  const eventName = kind === "acknowledged" ? "change" : "input";
  if (typeof field.handlers[eventName] === "function") await f.act(field.port, eventName);
  else {
    // Actual unbound native input has no app handler; only its DOM property
    // changes. Deliver the existing native event observation, not a setter.
    f.native.emit(eventName, field.port); await f.flush();
  }
  f.draw(); const after = cPlatformExtraField(f, kind);
  assert.equal(after.raw, raw, "raw input survives a normal full-page redraw before navigation");
  if (kind !== "contract") assert.equal(after.field.port, field.port, "same actual uncontrolled native field, not a copied application draft");
  return after;
}
for (const kind of ["contract", "phrase", "acknowledged"]) for (const mode of ["clean", "raw-restore"])
  test("C actual Platform extra field " + kind + " / " + mode, { concurrency: false, timeout: 45000 }, async t => {
    const key = kind === "contract" ? "governance" : "replay";
    const { f, profile, originalOwner, clean, session, initialCalls } = await cPlatformRawPage(t, key);
    const native = key === "replay" ? cPlatformReplayFormLifetime(t, f) : null;
    const initial = cPlatformExtraField(f, kind), originalField = initial.field.port;
    assert.equal(initial.raw, kind === "acknowledged" ? false : "");
    const dispatch = globalThis.fetch, attempts = [];
    globalThis.fetch = function (...args) { attempts.push({ url: String(args[0]), method: args[1]?.method ?? "GET" }); return Reflect.apply(dispatch, this, args); };
    try {
      if (mode === "raw-restore") {
        const raw = kind === "acknowledged" ? true : kind === "contract" ? "  fal-entitlement://fictional-unsent-B 文書  " : "  incomplete fictional phrase B نور  ";
        await cPlatformWriteExtra(f, kind, raw);
        if (key === "governance") assert.deepEqual(cPlatformRawFields(f, key).raw, clean, "unchanged prefilled attestations cannot mask contract-only work");
        else {
          assert.equal(native.record(originalOwner).fields.get("seed").value, "");
          assert.equal(cPlatformExtraField(f, kind === "phrase" ? "acknowledged" : "phrase").raw, kind === "phrase" ? false : "",
            "only this one native approval field differs");
        }
        assert.deepEqual(attempts, []); await cPlatformTask(f, profile);
        const retained = cPlatformRawOwner(f, profile);
        t.diagnostic("PLATFORM_EXTRA_FIELD " + JSON.stringify({ kind, mode, route: f.route, originalOwnerConnected: originalOwner.isConnected,
          raw: retained === originalOwner ? cPlatformExtraField(f, kind).raw : null, attempts }));
        assert.equal(f.route, profile.path, "ordinary navigation must retain this current unsent native field");
        assert.equal(retained, originalOwner); assert.equal(cPlatformExtraField(f, kind).raw, raw);
        if (native) assert.equal(cPlatformExtraField(f, kind).field.port, originalField);
        assert.deepEqual(attempts, []); assert.deepEqual(f.serviceCalls, initialCalls);
        assert.equal(f.modules.length, 1); assert.equal(f.platformSession.get(), session);
        const tree = f.tree(), notices = tree.visible("p").filter(node => node.owner === f.host && referenceClass(node, "platform-departure-notice"));
        assert.equal(notices.length, 1); assert.equal(notices[0].text, f.i18n.t("next.lifecycle.currentWorkOpen"));
        assert.equal(tree.visible("dialog").filter(node => node.port?.open).length, 0);
        await cPlatformWriteExtra(f, kind, initial.raw);
        assert.deepEqual(attempts, []); assert.deepEqual(cPlatformRawFields(f, key).raw, clean);
      }
      await cPlatformTask(f, profile); await cPlatformArrived(f, profile, originalOwner, session, initialCalls);
      assert.deepEqual(attempts, [{ url: profile.destinationRead, method: "GET" }]);
      if (native) assert.equal(native.record(originalOwner), null, "the original native form retires with its real owner");
      t.diagnostic("PLATFORM_EXTRA_FIELD_HEALTHY " + JSON.stringify({ kind, mode, route: f.route, attempts }));
    } finally { globalThis.fetch = dispatch; }
  });

// Separate exact-original companions. One named finite non-provider request is
// allowed per case; every GET still uses the original hostFixture dispatcher.
function cPlatformOriginalTransport(f, key, expected) {
  const dispatch = globalThis.fetch, attempts = [], path = key === "access" ? "/api/platform/access"
    : key === "governance" ? "/api/canvas-governance" : "/api/replay-sessions/approval";
  let original = null;
  globalThis.fetch = function (input, init = {}) {
    const url = new URL(String(input), "https://fixture.invalid"), method = init.method ?? "GET";
    attempts.push({ url: url.pathname + url.search, method });
    assert.equal(url.origin, "https://fixture.invalid", "no network or provider origin");
    if (method === "GET") return Reflect.apply(dispatch, this, [input, init]);
    assert.equal(method, "POST"); assert.equal(url.pathname + url.search, path, "only this exact original finite request is admitted");
    assert.equal(original, null, "no replacement, retry or second command is permitted");
    assert.deepEqual(init.headers, { "content-type": "application/json" });
    assert.equal(init.credentials, undefined); assert.equal(typeof init.body, "string");
    const payload = JSON.parse(init.body); assert.deepEqual(payload, expected, "complete original command body, not a broad POST allowlist");
    original = { path, body: init.body, payload, gate: deferred(), settled: false, parsed: 0 };
    return original.gate.promise;
  };
  return { attempts, original: () => original, restore() { globalThis.fetch = dispatch; },
    async finish(body, status = 200) {
      assert.ok(original && !original.settled); original.settled = true;
      if (body instanceof Error) original.gate.reject(body);
      else {
        const reply = response(body, status), json = reply.json.bind(reply);
        reply.json = () => { original.parsed++; return json(); }; original.gate.resolve(reply);
      }
      await f.flush();
    },
  };
}
function cPlatformOriginalForm(f, key) {
  const owner = cPlatformRawOwner(f, cPlatformRawProfiles[key]), tree = f.tree(); assert.ok(owner?.isConnected);
  const forms = tree.visible("form").filter(node => node.owner === owner && (key === "access"
    ? referenceClass(node, "access-grant-form") : key === "governance"
      ? referenceClass(node, "canvas-governance-approval") : String(node.handlers.submit).includes("#approve")));
  assert.equal(forms.length, key === "governance" ? 2 : 1);
  const form = forms[0], buttons = tree.visible("button").filter(node => cPlatformWithin(node, form) && node.attributes.type === "submit");
  assert.equal(buttons.length, 1);
  const fields = tree.visible("input").concat(tree.visible("select"), tree.visible("textarea"))
    .filter(node => node.owner === owner && cPlatformWithin(node, form));
  return { owner, form, button: buttons[0], raw: fields.map(node => ({ tag: node.tag, name: node.attributes.name ?? "",
    value: node.port.value, checked: node.attributes.type === "checkbox" ? Boolean(node.port.checked) : undefined })),
    disabled: buttons[0].port.matches(":disabled") };
}
async function cPlatformSubmitOriginal(f, key) {
  const current = cPlatformOriginalForm(f, key); assert.equal(current.disabled, false);
  assert.ok(current.form.port.isConnected && current.button.port.isConnected);
  f.native.emit("pointerdown", current.button.port); f.native.focus(current.button.port);
  const click = { type: "click", isTrusted: true, target: current.button.port, currentTarget: current.button.port,
    button: 0, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} };
  current.button.handlers.click?.call(current.owner, click); assert.equal(click.defaultPrevented, false);
  const submit = { type: "submit", isTrusted: true, target: current.form.port, currentTarget: current.form.port,
    submitter: current.button.port, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} };
  assert.equal(typeof current.form.handlers.submit, "function");
  const completion = current.form.handlers.submit.call(current.owner, submit);
  if (completion?.then) completion.catch(error => { (f.originalCallbackErrors ??= []).push(String(error)); });
  assert.equal(submit.defaultPrevented, true); await f.flush();
  return current;
}
const cPlatformOriginalBody = (key, clean) => key === "access" ? { userId: clean.person, capability: clean.capability }
  : key === "governance" ? { action: "approve", requirement: "trust_safety", confirmation: "I understand, record this Canvas approval",
    evidenceRef: clean.trustSafety, notes: "Administrator accepts the named Trust & Safety owner role for Canvas." }
    : { phrase: "FINITE_READ_ONLY_NO_APPROVAL", costAcknowledged: true, directUserApproval: true,
      confirmationVersion: "finite-read-only-version", seed: "", eventCount: 1000, providerCoverage: "automatic", studyTypes: [],
      initiator: "direct-user", approvedMaximumMicrousd: 1000000, allowUserBudgetOverride: false };
async function cPlatformFinishOriginal(f, key, transport) {
  if (!transport.original() || transport.original().settled) return;
  // Access deliberately remains unknown (no idempotent resend); Governance is
  // definitely refused; Replay is denied before an approval ID can exist.
  if (key === "access") await transport.finish(new Error("finite original Access acknowledgement unavailable"));
  else if (key === "governance") await transport.finish({ error: "finite_approval_declined" }, 422);
  else await transport.finish({ error: "finite_approval_denied" }, 403);
  assert.deepEqual(f.originalCallbackErrors ?? [], []);
}
async function cPlatformReturnToOriginal(f, profile, key) {
  const firstRead = f.reads.length;
  globalThis.history.pushState({ finiteExternalReturn: true }, "", profile.path);
  f.native.emit("popstate", f.host); await f.flush();
  assert.equal(f.route, profile.path); assert.equal(f.modules.length, 3); assert.equal(f.modules[2].path, profile.path);
  await f.acceptModule(2);
  assert.deepEqual(f.reads.slice(firstRead).map(row => row.url), profile.initialReads);
  if (key === "access") {
    const first = accessReadPair("choice-A"), second = accessReadPair("choice-B");
    await f.reply(firstRead, response({ users: [...first.users.users, ...second.users.users] }));
    await f.reply(firstRead + 1, response(first.grants));
  } else if (key === "governance") await f.reply(firstRead, response(releaseReadEnvelope("Unsubmitted governance")));
  else await f.reply(firstRead, response({ sessions: [], liveGeneration: {
    enabled: true, configured: true, approvalPhrase: "FINITE_READ_ONLY_NO_APPROVAL", confirmationVersion: "finite-read-only-version",
    cost: { estimate: { authorizationMicrousd: 1000000, estimatedMicrousd: 500000, operations: 1 },
      fitsReplayStructure: true, fitsWorkspace: true, requiresUserOverride: false },
  } }));
  return cPlatformRawFields(f, key);
}
for (const key of ["access", "governance", "replay"]) for (const mode of ["current", "retired"])
  test("C actual Platform original pending " + key + " / " + mode, { concurrency: false, timeout: 45000 }, async t => {
    const { f, profile, originalOwner, clean, session, initialCalls } = await cPlatformRawPage(t, key);
    const native = key === "replay" ? cPlatformReplayFormLifetime(t, f) : null;
    const expected = cPlatformOriginalBody(key, clean), transport = cPlatformOriginalTransport(f, key, expected);
    try {
      if (key === "replay") {
        await cPlatformWriteExtra(f, "phrase", expected.phrase); await cPlatformWriteExtra(f, "acknowledged", true);
      }
      await cPlatformSubmitOriginal(f, key);
      const original = transport.original(); assert.ok(original && !original.settled, "actual original fetch is held before its response");
      assert.deepEqual(original.payload, expected); assert.equal(original.parsed, 0);
      assert.equal(cPlatformOriginalForm(f, key).disabled, true, "actual pending submit state is reached");
      if (key === "replay") {
        await cPlatformWriteExtra(f, "phrase", ""); await cPlatformWriteExtra(f, "acknowledged", false);
        assert.equal(native.record(originalOwner).fields.get("seed").value, "", "raw controls restored; only original pending ownership can block");
      }
      assert.deepEqual(f.serviceCalls, initialCalls); assert.deepEqual(transport.attempts, [{ url: original.path, method: "POST" }]);
      const pendingRaw = cPlatformOriginalForm(f, key).raw;
      assert.equal(f.tree().visible("dialog").filter(node => node.port?.open).length, 0, "ordinary task is genuinely reachable without a modal");
      if (mode === "current") {
        await cPlatformTask(f, profile);
        t.diagnostic("PLATFORM_PENDING_CURRENT " + JSON.stringify({ key, route: f.route, originalOwnerConnected: originalOwner.isConnected,
          original: original.payload, settled: original.settled, currentRaw: originalOwner.isConnected ? cPlatformOriginalForm(f, key).raw : null,
          attempts: transport.attempts }));
        assert.equal(f.route, profile.path, "an exact current pending request, not nonempty defaults, owns this ordinary departure");
        assert.equal(cPlatformRawOwner(f, profile), originalOwner); assert.deepEqual(cPlatformOriginalForm(f, key).raw, pendingRaw);
        assert.deepEqual(transport.attempts, [{ url: original.path, method: "POST" }]);
        assert.equal(f.modules.length, 1); assert.equal(f.platformSession.get(), session);
        await cPlatformFinishOriginal(f, key, transport);
        if (key === "access") assert.ok(f.tree().root.text.includes(f.i18n.t("access.changeUnknown")), "settled unknown is not called unused or failed");
        if (key === "replay") assert.equal(f.tree().visible("form").filter(node => node.owner === originalOwner).length, 0, "known denial withdraws the private form");
        await cPlatformTask(f, profile); await cPlatformArrived(f, profile, originalOwner, session, initialCalls);
      } else {
        // Genuine external history arrival retires the old view; this does not
        // fabricate admission of the guarded ordinary task while it is pending.
        globalThis.history.pushState({ finiteExternalDeparture: true }, "", profile.destination);
        f.native.emit("popstate", f.host); await f.flush();
        await cPlatformArrived(f, profile, originalOwner, session, initialCalls);
        assert.equal(original.settled, false); if (native) assert.equal(native.record(originalOwner), null);
        const fresh = await cPlatformReturnToOriginal(f, profile, key);
        assert.notEqual(fresh.owner, originalOwner); assert.ok(fresh.owner.isConnected); assert.equal(originalOwner.isConnected, false);
        assert.deepEqual(fresh.raw, clean); assert.equal(original.settled, false);
        assert.equal(cPlatformOriginalForm(f, key).disabled, false, "retired original does not own the new resource opening");
        const callsBefore = structuredClone(f.serviceCalls), readsBefore = f.reads.length;
        await cPlatformTask(f, profile);
        t.diagnostic("PLATFORM_PENDING_RETIRED " + JSON.stringify({ key, route: f.route, originalOwnerConnected: originalOwner.isConnected,
          freshOwnerConnected: fresh.owner.isConnected, oldSettled: original.settled, attempts: transport.attempts }));
        assert.equal(f.route, profile.destination, "a pristine new owner may leave while the old original remains held");
        assert.equal(fresh.owner.isConnected, false); assert.equal(f.modules.length, 4); assert.equal(f.modules[3].path, profile.destination);
        await f.acceptModule(3); assert.equal(f.reads.length, readsBefore + 1); assert.equal(f.reads[readsBefore].url, profile.destinationRead);
        await f.reply(readsBefore, response(connectedSpecialistReport("current " + profile.destination)));
        assert.deepEqual(f.serviceCalls, [...callsBefore, { url: profile.destinationRead, method: "GET" }]);
        assert.deepEqual(f.completions, [profile.path, profile.destination, profile.path, profile.destination]);
        const destinationOwner = connectedSpecialistComponent(f, profile.destinationTag), text = f.tree().root.text,
          focus = f.native.nativeFocus.length, requests = structuredClone(transport.attempts);
        await cPlatformFinishOriginal(f, key, transport);
        assert.equal(connectedSpecialistComponent(f, profile.destinationTag), destinationOwner);
        assert.equal(f.route, profile.destination); assert.equal(f.tree().root.text, text); assert.equal(f.native.nativeFocus.length, focus);
        assert.deepEqual(transport.attempts, requests, "late original cannot cause a new read, retry or replacement command");
      }
      assert.equal(f.platformSession.get(), session); assert.equal(f.sessionReads.length, 1); assert.deepEqual(f.assignments, []);
      assert.deepEqual(transport.attempts.filter(row => row.method !== "GET"), [{ url: original.path, method: "POST" }]);
      assert.equal(transport.attempts.some(row => row.method !== "GET" && row.url === "/api/replay-sessions"), false,
        "no real or finite paid replay dispatch, approval ID, provider adapter or reservation response is supplied");
      assert.deepEqual(original.payload, expected); assert.deepEqual(f.originalCallbackErrors ?? [], []);
    } finally {
      await cPlatformFinishOriginal(f, key, transport); transport.restore();
    }
  });

// Paired-state local-resolution companions to the existing independent clean
// controls. Actual Platform owners and the GET-only fixture remain unchanged.
function cPlatformDiscardControl(t, f, key, fieldName) {
  const profile = cPlatformRawProfiles[key], owner = cPlatformRawOwner(f, profile), tree = f.tree();
  assert.ok(owner?.isConnected);
  let forms = tree.visible("form").filter(node => node.owner === owner);
  if (key === "access") forms = forms.filter(node => referenceClass(node, "access-grant-form"));
  else if (key === "governance") forms = forms.filter(node => referenceClass(node, "canvas-governance-approval"));
  else {
    const sections = tree.visible("section").filter(node => node.owner === owner && node.attributes["aria-labelledby"] === "actual-new-heading");
    assert.equal(sections.length, 1); forms = forms.filter(node => cPlatformWithin(node, sections[0]));
  }
  assert.equal(forms.length, key === "governance" ? 2 : 1);
  if (key === "governance") assert.ok(["trustSafety", "counsel"].includes(fieldName));
  const form = forms[key === "governance" && fieldName === "counsel" ? 1 : 0];
  const label = f.i18n.t("workspace.admin.discardPolicy"), buttons = tree.visible("button")
    .filter(node => node.owner === owner && cPlatformWithin(node, form));
  const controls = buttons.filter(node => node.text === label);
  t.diagnostic("PLATFORM_LOCAL_DISCARD_CONTROL " + JSON.stringify({ surface: key, field: fieldName,
    route: f.route, originalOwnerConnected: owner.isConnected, raw: cPlatformRawFields(f, key).raw,
    expectedLocalizedAction: label, matchingCurrentControls: controls.length,
    actualFormButtons: buttons.map(node => ({ text: node.text, type: node.attributes.type ?? "submit",
      disabled: Object.hasOwn(node.attributes, "disabled") || node.port?.disabled === true })),
    evidence: "actual current writable form after raw refusal; finite GET-only Platform fixture, not Worker/financial proof" }));
  assert.equal(controls.length, 1, "The exact current form exposes a local Discard action instead of requiring remembered defaults");
  const control = controls[0]; assert.ok(control.port.isConnected && f.renderer.nodes.includes(control.port));
  assert.equal(control.hiddenBy, null); assert.equal(control.attributes.type, "button", "Discard cannot implicitly submit an approval or grant");
  assert.equal(Object.hasOwn(control.attributes, "disabled"), false); assert.equal(control.port.disabled === true, false);
  assert.equal(typeof control.handlers.click, "function", "Controlled fields resolve through the actual local handler, not an unbound native reset");
  return control.port;
}

for (const key of ["access", "governance", "replay"])
  test("C actual Platform local Discard resolves controlled unsent work / " + key, { concurrency: false, timeout: 45000 }, async t => {
    const { f, profile, originalOwner, clean, choices, session, initialCalls } = await cPlatformRawPage(t, key);
    const dispatch = globalThis.fetch, attempts = [];
    globalThis.fetch = function (...args) {
      attempts.push({ url: String(args[0]), method: args[1]?.method ?? "GET" });
      return Reflect.apply(dispatch, this, args);
    };
    const stillLocal = expected => {
      assert.equal(f.route, profile.path); assert.equal(cPlatformRawOwner(f, profile), originalOwner);
      assert.ok(originalOwner.isConnected); assert.deepEqual(cPlatformRawFields(f, key).raw, expected);
      assert.deepEqual(attempts, []); assert.deepEqual(f.serviceCalls, initialCalls);
      assert.equal(f.modules.length, 1); assert.equal(f.platformSession.get(), session);
      assert.equal(f.tree().visible("dialog").filter(node => node.port?.open).length, 0);
    };
    try {
      const changedCapability = key === "access"
        ? choices.capability.find(option => option.value !== clean.capability && !option.disabled) : null;
      if (key === "access") assert.ok(changedCapability);
      const edited = key === "access" ? { person: choices.person[1].value, capability: changedCapability.value }
        : key === "governance" ? { trustSafety: "  Unsent local attestation B 文書\nنور  ", counsel: "  Unsent local counsel C 文書  " }
        : { seed: "  Unsent fictional direction B 文書\nنور  " };
      if (key === "governance") assert.ok(clean.trustSafety && clean.counsel,
        "Both exact original nonempty attestations must be restored, not replaced with empty strings");
      if (key === "replay") assert.deepEqual(clean, { seed: "" },
        "This GET-only initial profile does not fabricate a nonempty acknowledged or safe-retry seed");
      await cPlatformWriteRaw(f, key, edited); stillLocal(edited);
      await cPlatformTask(f, profile); stillLocal(edited);
      const notices = f.tree().visible("p").filter(node => node.owner === f.host && referenceClass(node, "platform-departure-notice"));
      assert.equal(notices.length, 1); assert.equal(notices[0].text, f.i18n.t("next.lifecycle.currentWorkOpen"));
      if (key === "access") {
        const current = cPlatformRawFields(f, key);
        assert.ok(current.options.person.some(option => option.value === clean.person && !option.disabled));
        assert.ok(current.options.capability.some(option => option.value === clean.capability && !option.disabled),
          "The observed clean tuple is still a current eligible local choice, not a stale or granted permission");
      }
      const first = cPlatformDiscardControl(t, f, key, key === "governance" ? "trustSafety" : key === "access" ? "choices" : "seed");
      await f.act(first); f.draw(); await f.flush();
      if (key === "governance") {
        const partial = { trustSafety: clean.trustSafety, counsel: edited.counsel };
        stillLocal(partial);
        await cPlatformTask(f, profile); stillLocal(partial);
        const second = cPlatformDiscardControl(t, f, key, "counsel");
        await f.act(second); f.draw(); await f.flush();
      }
      stillLocal(clean);
      // A fresh render and departure prove that the component's controlled
      // state was restored too; merely resetting DOM values is insufficient.
      f.draw(); stillLocal(clean);
      await cPlatformTask(f, profile); await cPlatformArrived(f, profile, originalOwner, session, initialCalls);
      assert.deepEqual(attempts, [{ url: profile.destinationRead, method: "GET" }]);
      t.diagnostic("PLATFORM_LOCAL_DISCARD_RESOLVED " + JSON.stringify({ surface: key, clean,
        route: f.route, originalOwnerConnected: originalOwner.isConnected, attempts,
        localResolutionRequests: 0, governanceSiblingPreserved: key === "governance" ? true : null,
        evidence: "real controlled handlers/current task and exact finite destination GET; no approval, grant, quote, replay or provider dispatch" }));
    } finally { globalThis.fetch = dispatch; }
  });

// The adapter contract has its own current form; the seven server-derived
// sibling fields and the two nonempty attestation forms are not this draft.
test("C actual Platform local Discard resolves only the editable adapter contract", { concurrency: false, timeout: 45000 }, async t => {
  const { f, profile, originalOwner, clean, session, initialCalls } = await cPlatformRawPage(t, "governance");
  const snapshot = () => {
    const current = cPlatformExtraField(f, "contract"), tree = f.tree();
    const forms = tree.visible("form").filter(node => node.owner === originalOwner && referenceClass(node, "canvas-adapter-approval"));
    assert.equal(forms.length, 1);
    const fields = tree.visible("input").filter(node => node.owner === originalOwner && cPlatformWithin(node, forms[0]));
    assert.equal(fields.length, 8); assert.equal(fields.filter(node => !Object.hasOwn(node.attributes, "readonly")).length, 1);
    assert.equal(fields[3].port, current.field.port, "only the exact contract / entitlement input is editable");
    return { tree, form: forms[0], contract: current.raw,
      readonly: fields.filter(node => Object.hasOwn(node.attributes, "readonly")).map(node => node.port.value) };
  };
  const initial = snapshot(); assert.equal(initial.contract, ""); assert.equal(initial.readonly.length, 7);
  const dispatch = globalThis.fetch, attempts = [];
  globalThis.fetch = function (...args) {
    attempts.push({ url: String(args[0]), method: args[1]?.method ?? "GET" });
    return Reflect.apply(dispatch, this, args);
  };
  const local = expected => {
    assert.equal(f.route, profile.path); assert.equal(cPlatformRawOwner(f, profile), originalOwner);
    assert.ok(originalOwner.isConnected); assert.equal(f.platformSession.get(), session);
    assert.equal(f.modules.length, 1); assert.deepEqual(f.serviceCalls, initialCalls); assert.deepEqual(attempts, []);
    assert.deepEqual(cPlatformRawFields(f, "governance").raw, clean, "the original nonempty attestations remain outside this Discard");
    const current = snapshot(); assert.equal(current.contract, expected); assert.deepEqual(current.readonly, initial.readonly);
    return current;
  };
  try {
    const raw = "  fal-entitlement://unsent-contract-B 文書 نور  ";
    await cPlatformWriteExtra(f, "contract", raw); local(raw);
    await cPlatformTask(f, profile); const current = local(raw);
    const notices = current.tree.visible("p").filter(node => node.owner === f.host && referenceClass(node, "platform-departure-notice"));
    assert.equal(notices.length, 1); assert.equal(notices[0].text, f.i18n.t("next.lifecycle.currentWorkOpen"));
    const label = f.i18n.t("workspace.admin.discardPolicy"), buttons = current.tree.visible("button")
      .filter(node => node.owner === originalOwner && cPlatformWithin(node, current.form));
    const discards = buttons.filter(node => node.text === label);
    t.diagnostic("PLATFORM_ADAPTER_DISCARD_CONTROL " + JSON.stringify({ route: f.route, raw: current.contract,
      readonly: current.readonly, attestations: clean, attempts, matchingCurrentControls: discards.length,
      actualFormButtons: buttons.map(node => ({ text: node.text, type: node.attributes.type ?? "submit",
        disabled: Object.hasOwn(node.attributes, "disabled") || node.port?.disabled === true })),
      evidence: "actual current controlled form and finite GET-only Platform contract; no Worker, approval, evaluation or fiscal claim" }));
    assert.equal(discards.length, 1, "The exact current adapter form exposes a no-write local Discard action");
    const control = discards[0]; assert.equal(control.attributes.type, "button"); assert.equal(control.hiddenBy, null);
    assert.ok(control.port?.isConnected && f.renderer.nodes.includes(control.port));
    assert.equal(control.port.matches(":disabled"), false); assert.equal(typeof control.handlers.click, "function");
    await f.act(control.port); f.draw(); await f.flush(); local(initial.contract);
    f.draw(); local(initial.contract);
    await cPlatformTask(f, profile); await cPlatformArrived(f, profile, originalOwner, session, initialCalls);
    assert.deepEqual(attempts, [{ url: profile.destinationRead, method: "GET" }]);
  } finally { globalThis.fetch = dispatch; }
});

// Actual full Platform/Governance render only. The existing finite GET envelope
// supplies three distinct requirement headings; no approval or Discard runs.
for (const locale of ["en", "fr", "ar", "ja"])
  test("C actual Governance Discard names retain each current requirement / " + locale, { concurrency: false, timeout: 45000 }, async t => {
    const profile = cPlatformRawProfiles.governance;
    const f = await hostFixture(t, "platform", locale, { nativeUrlParts: true, connectedLeaf: profile });
    const sessionBody = { ...sessionValue(), audience: profile.audience, capabilities: [...profile.capabilities],
      availableApplications: [{ id: profile.audience, href: profile.path }] };
    assert.equal(f.sessionReads.length, 1); assert.equal(f.modules.length, 0);
    await f.replyConnectedSession(0, sessionBody); await f.acceptModule(0);
    assert.deepEqual(f.reads.map(row => row.url), profile.initialReads);
    const envelope = releaseReadEnvelope("Named governance 文書 نور");
    await f.reply(0, response(envelope)); await f.flush();
    const owner = cPlatformRawOwner(f, profile), session = f.platformSession.get(), calls = structuredClone(f.serviceCalls);
    assert.ok(owner?.isConnected); assert.equal(owner.parentElement.parentElement, f.host);
    assert.equal(f.route, profile.path); assert.equal(f.i18n.locale, locale);
    assert.deepEqual(calls, [{ url: "/api/session?audience=operations", method: "GET" }, { url: "/api/canvas-governance", method: "GET" }]);
    const tree = f.tree(), action = f.i18n.t("workspace.admin.discardPolicy"), observed = [];
    for (const requirement of envelope.governance.requirements) {
      const cards = tree.visible("article").filter(node => node.owner === owner && referenceClass(node, "canvas-governance-card")
        && tree.visible("h2").some(heading => cPlatformWithin(heading, node) && heading.text === requirement.label));
      assert.equal(cards.length, 1, "Use the exact current visible requirement heading, not a guessed row position");
      const forms = tree.visible("form").filter(node => node.owner === owner && cPlatformWithin(node, cards[0]));
      assert.equal(forms.length, 1);
      const controls = tree.visible("button").filter(node => node.owner === owner && cPlatformWithin(node, forms[0]) && node.text === action);
      assert.equal(controls.length, 1); const control = controls[0];
      assert.ok(control.port?.isConnected && f.renderer.nodes.includes(control.port));
      assert.equal(control.hiddenBy, null); assert.equal(control.attributes.type, "button");
      assert.equal(Object.hasOwn(control.attributes, "disabled"), false); assert.equal(control.port.disabled === true, false);
      assert.equal(typeof control.handlers.click, "function");
      observed.push({ requirement: requirement.id, visible: control.text, heading: requirement.label,
        name: control.attributes["aria-label"] ?? control.text,
        expected: f.i18n.t("artifact.delivery.namedAction", "{action} — {name}", {
          action, name: "\u2068" + requirement.label + "\u2069" }) });
    }
    assert.equal(observed.length, 3);
    assert.deepEqual(f.serviceCalls, calls); assert.equal(f.platformSession.get(), session); assert.equal(f.route, profile.path);
    assert.deepEqual(f.assignments, []); assert.equal(f.tree().visible("dialog").filter(node => node.port?.open).length, 0);
    t.diagnostic("GOVERNANCE_DISCARD_NAMES " + JSON.stringify({ locale, observed, requests: calls,
      evidence: "actual emitted native button names/current headings; finite GET-only contract, not AT or backend approval" }));
    assert.equal(new Set(observed.map(row => row.name)).size, 3, "Controls-list names must distinguish the three current local Discard targets");
    assert.deepEqual(observed.map(row => row.name), observed.map(row => row.expected));
    assert.ok(observed.every(row => row.visible === action), "Visible concise Discard wording remains unchanged");
  });

// Separate finite adapter-contract original witness. A coherent retained passing
// read envelope is a fixture contract, not a provider run or real approval.
async function cPlatformContractOriginalPage(t) {
  const profile = cPlatformRawProfiles.governance, f = await hostFixture(t, "platform", profile.locale,
    { nativeUrlParts: true, connectedLeaf: profile });
  const sessionBody = { ...sessionValue(), audience: profile.audience, capabilities: [...profile.capabilities],
    availableApplications: [{ id: profile.audience, href: profile.path }] };
  await f.replyConnectedSession(0, sessionBody); await f.acceptModule(0);
  assert.deepEqual(f.reads.map(row => row.url), ["/api/canvas-governance"]);
  const envelope = releaseReadEnvelope("Unsubmitted governance"), candidate = envelope.adapterCandidate;
  candidate.configured = true; candidate.readiness = { configured: true, fal: true, missing: [] };
  candidate.retryPlan = { ...candidate.retryPlan, caseCount: 50, corpusVersion: "finite-retained-contract-corpus", status: "passing_evidence_ready" };
  candidate.currentEvaluation = { evaluationRef: "finite-retained-passing-report", adapterId: candidate.adapterId,
    adapterVersion: candidate.adapterVersion, status: "passed", passed: true, caseCount: 50, evaluatedPairs: 50,
    openai: { completed: 50, usable: 50 }, fal: { completed: 50, failed: 0, usable: 50 }, reference: { evaluated: 50, falUsable: 50 },
    failedCases: [], finding: "Finite retained metadata only; no provider was called by this case." };
  await f.reply(0, response(envelope));
  const source = cPlatformRawFields(f, "governance"), current = cPlatformExtraField(f, "contract");
  assert.equal(current.raw, ""); assert.equal(current.owner, source.owner); assert.equal(f.route, profile.path);
  assert.deepEqual(f.platformSession.get().capabilities, profile.capabilities);
  assert.equal(f.platformSession.get().user.role, "admin"); assert.deepEqual(Object.keys(f.store), ["route"]);
  assert.equal(f.tree().visible("dialog").filter(node => node.port?.open).length, 0);
  return { f, profile, envelope, clean: source.raw, originalOwner: source.owner, session: f.platformSession.get(),
    initialCalls: structuredClone(f.serviceCalls) };
}
// Explicit replacement of the two historical editable-during-pending ACK pairs.
// C130 and the contract-original baseline remain immutable causal evidence.
function cPlatformGovernanceInputState(f, requirement) {
  const owner = cPlatformRawOwner(f, cPlatformRawProfiles.governance), tree = f.tree(); assert.ok(owner?.isConnected);
  const cards = tree.visible("article").filter(node => node.owner === owner && referenceClass(node, "canvas-governance-card")
    && tree.visible("h2").some(heading => cPlatformWithin(heading, node) && heading.text === "Unsubmitted governance " + requirement));
  assert.equal(cards.length, 1);
  const forms = tree.visible("form").filter(node => node.owner === owner && cPlatformWithin(node, cards[0])); assert.equal(forms.length, 1);
  const fields = tree.visible("input").filter(node => node.owner === owner && cPlatformWithin(node, forms[0])
    && !Object.hasOwn(node.attributes, "readonly")); assert.equal(fields.length, 1);
  assert.ok(fields[0].port?.isConnected && f.renderer.nodes.includes(fields[0].port)); assert.equal(fields[0].hiddenBy, null);
  return { owner, form: forms[0], field: fields[0], value: fields[0].port.value, disabled: fields[0].port.matches(":disabled") };
}
for (const requirement of ["trust_safety", "second_image_adapter"]) for (const mode of ["unchanged-A", "other-form-B"])
  test("C actual Governance pending input lock " + requirement + " / " + mode, { concurrency: false, timeout: 45000 }, async t => {
    const page = requirement === "trust_safety" ? await cPlatformRawPage(t, "governance") : await cPlatformContractOriginalPage(t);
    const { f, profile, clean, originalOwner, session, initialCalls } = page;
    const contractA = "fal-entitlement://finite-original-A", rawB = "  Unsubmitted sibling B 文書\nنور  ";
    if (requirement === "second_image_adapter") await cPlatformWriteExtra(f, "contract", contractA);
    const envelope = page.envelope ?? releaseReadEnvelope("Unsubmitted governance"), candidate = envelope.adapterCandidate;
    const expected = requirement === "trust_safety" ? cPlatformOriginalBody("governance", clean)
      : { action: "approve", requirement, confirmation: "I understand, record this Canvas approval", evidenceRef: "",
        notes: "Second provider contract and paired capability evaluation reviewed.", adapterId: candidate.adapterId,
        modelId: candidate.modelId, contractVersion: candidate.adapterVersion, contractRef: contractA,
        evaluationRef: candidate.currentEvaluation.evaluationRef, corpusVersion: candidate.retryPlan.corpusVersion,
        corpusItemCount: 50, capabilityReceiptRef: candidate.capabilityReceiptRef };
    const originalValue = requirement === "trust_safety" ? clean.trustSafety : contractA;
    const sibling = requirement === "trust_safety" ? "counsel" : "trust_safety";
    const siblingClean = requirement === "trust_safety" ? clean.counsel : clean.trustSafety;
    const transport = cPlatformOriginalTransport(f, "governance", expected);
    try {
      const current = cPlatformGovernanceInputState(f, requirement); assert.equal(current.disabled, false); assert.equal(current.value, originalValue);
      const before = f.tree(), form = before.visible("form").find(node => node.port === current.form.port); assert.ok(form);
      const inputs = before.visible("input").filter(node => cPlatformWithin(node, form));
      assert.equal(inputs.length, requirement === "trust_safety" ? 1 : 8);
      assert.equal(inputs.filter(node => Object.hasOwn(node.attributes, "readonly")).length, requirement === "trust_safety" ? 0 : 7);
      const buttons = before.visible("button").filter(node => cPlatformWithin(node, form) && node.attributes.type === "submit");
      assert.equal(buttons.length, 1); assert.equal(buttons[0].port.matches(":disabled"), false);
      f.native.emit("pointerdown", buttons[0].port); f.native.focus(buttons[0].port);
      const event = { type: "submit", isTrusted: true, target: form.port, currentTarget: form.port, submitter: buttons[0].port,
        defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} };
      form.handlers.submit.call(originalOwner, event); assert.equal(event.defaultPrevented, true); await f.flush();
      const original = transport.original(); assert.ok(original && !original.settled); assert.equal(original.parsed, 0);
      assert.deepEqual(original.payload, expected);
      const locks = ["trust_safety", "counsel", "second_image_adapter"].map(id => {
        const field = cPlatformGovernanceInputState(f, id); return { id, value: field.value, disabled: field.disabled };
      });
      t.diagnostic("GOVERNANCE_PENDING_FIELD_ELIGIBILITY " + JSON.stringify({ requirement, mode, locks,
        originalRequest: original.payload, originalFieldRetyped: false, attempts: transport.attempts }));
      assert.deepEqual(locks.map(({ id, disabled }) => ({ id, disabled })), ["trust_safety", "counsel", "second_image_adapter"]
        .map(id => ({ id, disabled: id === requirement })), "only this pending original field is disabled, never every form");
      assert.equal(cPlatformGovernanceInputState(f, requirement).value, originalValue);
      const other = cPlatformGovernanceInputState(f, sibling); assert.equal(other.disabled, false); assert.equal(other.value, siblingClean);
      if (mode === "other-form-B") {
        other.field.port.value = rawB; await f.act(other.field.port, "input");
        assert.equal(cPlatformGovernanceInputState(f, sibling).value, rawB, "B is genuinely authored in the separate eligible form");
      }
      assert.equal(cPlatformGovernanceInputState(f, requirement).value, originalValue);
      assert.equal(cPlatformGovernanceInputState(f, requirement).disabled, true);
      assert.equal(original.settled, false); assert.equal(cPlatformRawOwner(f, profile), originalOwner);
      assert.deepEqual(f.serviceCalls, initialCalls); assert.deepEqual(transport.attempts, [{ url: "/api/canvas-governance", method: "POST" }]);
      const body = structuredClone(envelope), approved = body.governance.requirements.find(row => row.id === requirement);
      Object.assign(approved, { approved: true, approvedBy: "Fixture operator", approvedByUserId: session.user.userId,
        approvedAt: "2026-08-31T00:00:00.000Z", evidenceRef: requirement === "trust_safety" ? expected.evidenceRef : expected.evaluationRef });
      if (requirement === "second_image_adapter") approved.details = { adapter_id: expected.adapterId, model_id: expected.modelId,
        contract_version: expected.contractVersion, contract_ref: expected.contractRef, evaluation_ref: expected.evaluationRef,
        corpus_version: expected.corpusVersion, corpus_item_count: expected.corpusItemCount,
        capability_receipt_ref: expected.capabilityReceiptRef, evaluation_passed: true };
      body.governance.blockedBy = body.governance.blockedBy.filter(id => id !== requirement);
      if (requirement === "trust_safety") body.governance.version = "finite-original-attestation-A";
      await transport.finish(body, 200); assert.equal(original.parsed, 1);
      assert.equal(cPlatformRawOwner(f, profile), originalOwner); assert.equal(f.platformSession.get(), session); assert.equal(f.route, profile.path);
      assert.deepEqual(f.serviceCalls, initialCalls); assert.deepEqual(transport.attempts, [{ url: "/api/canvas-governance", method: "POST" }]);
      const after = f.tree(), cards = after.visible("article").filter(node => node.owner === originalOwner
        && referenceClass(node, "canvas-governance-card") && after.visible("h2").some(heading => cPlatformWithin(heading, node)
          && heading.text === "Unsubmitted governance " + requirement));
      assert.equal(cards.length, 1); assert.ok(cards[0].text.includes(approved.evidenceRef));
      assert.equal(after.visible("input").filter(node => cPlatformWithin(node, cards[0])).length, 0,
        "the locked unchanged original becomes its receipt; no claim that B was typed into it");
      const retained = cPlatformGovernanceInputState(f, sibling);
      assert.equal(retained.disabled, false); assert.equal(retained.value, mode === "other-form-B" ? rawB : siblingClean);
      t.diagnostic("GOVERNANCE_PENDING_LOCK_ACK " + JSON.stringify({ requirement, mode, request: original.payload, response: approved,
        originalFieldRetyped: false, retainedSibling: { id: sibling, value: retained.value, disabled: retained.disabled }, attempts: transport.attempts }));
      if (mode === "other-form-B") {
        await cPlatformTask(f, profile); assert.equal(f.route, profile.path); assert.equal(cPlatformRawOwner(f, profile), originalOwner);
        assert.equal(cPlatformGovernanceInputState(f, sibling).value, rawB); assert.deepEqual(f.serviceCalls, initialCalls);
        assert.deepEqual(transport.attempts, [{ url: "/api/canvas-governance", method: "POST" }]);
        const restore = cPlatformGovernanceInputState(f, sibling); restore.field.port.value = siblingClean;
        await f.act(restore.field.port, "input"); assert.equal(cPlatformGovernanceInputState(f, sibling).value, siblingClean);
      }
      await cPlatformTask(f, profile); await cPlatformArrived(f, profile, originalOwner, session, initialCalls);
      assert.deepEqual(transport.attempts, [{ url: "/api/canvas-governance", method: "POST" }, { url: profile.destinationRead, method: "GET" }]);
      assert.deepEqual(original.payload, expected); assert.deepEqual(f.originalCallbackErrors ?? [], []);
    } finally { await cPlatformFinishOriginal(f, "governance", transport); transport.restore(); }
  });

// Readiness withdrawal is not a Source/authority departure and is not an ACK.
// These finite GET-only pairs reuse the current real Platform owner and task.
function cPlatformReadinessView(f, key, owner) {
  const tree = f.tree(), fields = tree.nodes.filter(node => node.owner === owner && ["input", "select", "textarea"].includes(node.tag));
  const visible = fields.filter(node => node.hiddenBy === null && node.port?.isConnected);
  const readonly = visible.filter(node => Object.hasOwn(node.attributes, "readonly"));
  const discard = tree.visible("button").filter(node => node.owner === owner && node.text === f.i18n.t("workspace.admin.discardPolicy"));
  const writes = tree.visible("button").filter(node => node.owner === owner && node.text === f.i18n.t(key === "access" ? "access.grant" : "replay.actual.authorize"));
  assert.equal(writes.length, 0, "unavailable readiness cannot expose a grant or paid approval");
  assert.equal(visible.filter(node => !Object.hasOwn(node.attributes, "readonly")).length, 0,
    "old options and native approval inputs are not revived as writable readiness");
  assert.equal(tree.visible("dialog").filter(node => node.port?.open).length, 0);
  return { tree, readonly, discard };
}
async function cPlatformReadinessWithdraw(f, key, profile, owner) {
  const tree = f.tree(), label = f.i18n.t(key === "access" ? "access.refresh" : "role.refresh");
  const controls = tree.visible("button").filter(node => node.owner === owner && node.text === label);
  assert.equal(controls.length, 1); assert.equal(controls[0].port.matches(":disabled"), false);
  const first = f.reads.length; await f.act(controls[0].port);
  assert.deepEqual(f.reads.slice(first).map(row => row.url), profile.initialReads,
    "the actual current Refresh issues only its original declared GET reads");
  if (key === "access") {
    await f.reply(first, response({ error: "finite_access_read_unavailable" }, 503));
    await f.reply(first + 1, response({ error: "finite_access_read_unavailable" }, 503));
    const alerts = f.tree().visible("p").filter(node => node.owner === owner && node.attributes.role === "alert");
    assert.equal(alerts.length, 1); assert.equal(alerts[0].text, f.i18n.t("access.loadFailed"));
  } else {
    await f.reply(first, response({ sessions: [], liveGeneration: {
      enabled: false, configured: false, approvalPhrase: "FINITE_READ_ONLY_NO_APPROVAL",
      confirmationVersion: "finite-read-only-version",
      cost: { estimate: { authorizationMicrousd: 1000000, estimatedMicrousd: 500000, operations: 1 },
        fitsReplayStructure: true, fitsWorkspace: true, requiresUserOverride: false },
    } }));
  }
  await f.flush(); f.draw();
  assert.ok(f.reads.slice(first).every(row => row.settled));
  return { profile: { ...profile, initialReads: f.reads.map(row => row.url) }, calls: structuredClone(f.serviceCalls) };
}

for (const key of ["access", "replay"]) for (const mode of ["clean", "raw-discard"])
  test("C actual Platform readiness withdrawal retains a local escape / " + key + " / " + mode,
    { concurrency: false, timeout: 45000 }, async t => {
      const { f, profile, originalOwner, clean, choices, session, initialCalls } = await cPlatformRawPage(t, key);
      const dispatch = globalThis.fetch, attempts = [];
      globalThis.fetch = function (...args) {
        attempts.push({ url: String(args[0]), method: args[1]?.method ?? "GET" });
        return Reflect.apply(dispatch, this, args);
      };
      try {
        const edited = key === "access" ? { person: choices.person[1].value,
          capability: choices.capability.find(option => option.value !== clean.capability && !option.disabled).value }
          : { seed: "  Retained fictional seed B 文書\nنور  " };
        if (mode === "raw-discard") await cPlatformWriteRaw(f, key, edited);
        assert.deepEqual(attempts, []); assert.deepEqual(f.serviceCalls, initialCalls);
        const refreshed = await cPlatformReadinessWithdraw(f, key, profile, originalOwner);
        const refreshAttempts = profile.initialReads.map(url => ({ url, method: "GET" }));
        assert.deepEqual(attempts, refreshAttempts);
        assert.equal(f.route, profile.path); assert.equal(cPlatformRawOwner(f, profile), originalOwner);
        assert.ok(originalOwner.isConnected); assert.equal(f.platformSession.get(), session); assert.equal(f.modules.length, 1);
        cPlatformReadinessView(f, key, originalOwner);
        if (mode === "raw-discard") {
          await cPlatformTask(f, profile);
          assert.equal(f.route, profile.path, "a failed/unavailable readiness read cannot silently discard authored work");
          assert.equal(cPlatformRawOwner(f, profile), originalOwner); assert.equal(f.platformSession.get(), session);
          assert.deepEqual(attempts, refreshAttempts); assert.deepEqual(f.serviceCalls, refreshed.calls);
          const current = cPlatformReadinessView(f, key, originalOwner);
          t.diagnostic("PLATFORM_READINESS_LOCAL_ESCAPE " + JSON.stringify({ surface: key, mode, route: f.route,
            currentOwnerConnected: originalOwner.isConnected, originalEdited: edited,
            currentReadonly: current.readonly.map(node => node.port.value), discardCount: current.discard.length,
            attempts, evidence: "actual Refresh, current owner and dirty refusal with finite GET responses; no original write, ACK or provider proof" }));
          assert.equal(current.discard.length, 1, "the current retained draft still exposes a no-write Discard after writable readiness withdraws");
          const button = current.discard[0]; assert.equal(button.attributes.type, "button");
          assert.ok(button.port?.isConnected && f.renderer.nodes.includes(button.port));
          assert.equal(button.port.matches(":disabled"), false); assert.equal(typeof button.handlers.click, "function");
          assert.deepEqual(current.readonly.map(node => node.port.value), Object.values(edited),
            "retained raw values stay selectable and inspectable, not a hidden departure veto");
          await f.act(button.port); await f.flush(); f.draw();
          assert.equal(f.route, profile.path); assert.equal(cPlatformRawOwner(f, profile), originalOwner);
          assert.equal(f.platformSession.get(), session); assert.deepEqual(attempts, refreshAttempts);
          assert.deepEqual(f.serviceCalls, refreshed.calls); cPlatformReadinessView(f, key, originalOwner);
        }
        await cPlatformTask(f, profile);
        await cPlatformArrived(f, refreshed.profile, originalOwner, session, refreshed.calls);
        assert.deepEqual(attempts, [...refreshAttempts, { url: profile.destinationRead, method: "GET" }]);
        assert.ok(attempts.every(row => row.method === "GET"));
        t.diagnostic("PLATFORM_READINESS_LOCAL_ESCAPE_HEALTHY " + JSON.stringify({ surface: key, mode, route: f.route,
          attempts, sourceOwnerRetired: !originalOwner.isConnected, localResolutionRequests: 0 }));
      } finally { globalThis.fetch = dispatch; }
    });

// E5: actual SharedView boundary navigation, using the existing public host,
// responses, catalogs, native focus lease and EventPart button lifetime.
// Modal promotion/state is still the declared finite modalPort, not a browser
// or an execution of ensureNativeModalDialog. The retained native55 failure
// establishes the real disabled-button -> BODY behavior; no BODY remapping is
// invented here. No real share, principal, provider, server or DB is used.
const eBoundaryNavSelector=".shared-presentation-stage > nav > button";
const eBoundaryClass=(node,name)=>String(node.attributes?.class??"").split(/\s+/u).includes(name);
async function eSharedBoundaryHost(t,locale="en"){
  const f=await hostFixture(t,"shared",locale),owner=f.owner();
  await registerCalmFullPageComponents(f,["forma-artifact-summary","forma-presentation-slide"]);
  f.tree=()=>fullPageTree(f);
  retainDeferredFocusInvokers(f,new Set([owner]));
  const modalParts=new WeakMap(),modalStates=new WeakSet(),modalWrapped=new WeakSet();
  const collect=f.renderer.collect.bind(f.renderer),ensure=ports.modalPort.ensureModalDialog;
  ports.modalPort.ensureModalDialog=dialog=>{
    const result=ensure(dialog);
    if(result&&dialog?.owner===owner&&dialog.tag==="dialog"&&eBoundaryClass(dialog,"shared-presentation-dialog")&&dialog.open)
      modalStates.add(dialog);
    return result;
  };
  t.after(()=>{ports.modalPort.ensureModalDialog=ensure;});
  f.renderer.collect=(markup,currentOwner)=>{
    const start=f.renderer.nodes.length,result=collect(markup,currentOwner);
    if(currentOwner!==owner||!owner.isConnected)return result;
    const rows=f.renderer.nodes.slice(start).filter(node=>node.owner===owner&&node.tag==="dialog"
      &&eBoundaryClass(node,"shared-presentation-dialog"));
    if(rows.length!==1)return result;
    const fresh=rows[0],token=fresh.full.match(/\s@close=(?:["'])?__bound_(\d+)__(?:["'])?(?=[\s>])/u);
    const binding=token?f.renderer.bindings[Number(token[1])]:null;
    if(binding?.owner!==owner||typeof binding.part!=="string"||typeof binding.value!=="function"
      ||binding.value!==fresh.handlers.close||/\s[.?]?open(?=[\s=>])/u.test(fresh.full))return result;
    modalParts.set(fresh,binding.part);
    const previous=(f.renderer.previousNodes??[]).filter(node=>node.owner===owner&&node.tag==="dialog"
      &&node.isConnected&&modalParts.get(node)===binding.part);
    let node=fresh;
    if(previous.length===1){
      node=previous[0];
      // Same committed close EventPart, not class/ID/data-derived identity.
      // Preserve native open state, listeners and node-bound methods.
      for(const key of["full","attributes","properties","propertyParts","handlers"])node[key]=fresh[key];
      f.renderer.nodes[f.renderer.nodes.indexOf(fresh)]=node;fresh.isConnected=false;
    }
    if(!modalWrapped.has(node)){
      const matches=node.matches.bind(node);
      node.matches=selector=>selector===":modal"?node.isConnected&&node.open&&modalStates.has(node):matches(selector);
      modalWrapped.add(node);
    }
    return result;
  };
  // Forward this one new descendant selector from the actual authored tree.
  // Do not manufacture parents, a desired control or a second query grammar.
  const query=f.renderer.query.bind(f.renderer);
  f.renderer.query=(currentOwner,selector)=>{
    if(currentOwner!==owner||selector!==eBoundaryNavSelector)return query(currentOwner,selector);
    return f.tree().nodes.filter(row=>row.owner===owner&&row.tag==="button"&&row.port?.isConnected
      &&row.parent?.tag==="nav"&&eBoundaryClass(row.parent.parent,"shared-presentation-stage"))
      .map(row=>row.port);
  };
  const body=eSharedSlidesBody(locale);
  await f.reply(0,response(body));
  await f.act(eSharedControl(f,"shared-presentation-open"));
  const dialog=eSharedBoundaryDialog(f),buttons=eSharedBoundaryButtons(f);
  assert.ok(dialog.open&&dialog.matches(":modal"),"actual open handler requested the declared finite modal promotion");
  assert.equal(buttons[0].matches(":disabled"),true);assert.equal(buttons[1].matches(":disabled"),false);
  const summaries=[...f.renderer.instances.values()].map(row=>row.instance).filter(node=>node.isConnected
    &&node.tag==="forma-artifact-summary"&&node.parentElement===owner);
  assert.equal(summaries.length,1);
  const baseline={owner,dialog,buttons,artifact:summaries[0].artifact,artifactJSON:JSON.stringify(summaries[0].artifact),
    payloadJSON:JSON.stringify(body),body,route:f.route,token:owner.token,reads:f.reads.map(row=>row.url)};
  assert.equal(f.native.listeners("focusin"),0);
  return{f,baseline};
}
function eSharedBoundaryDialog(f){
  const rows=f.tree().nodes.filter(row=>row.owner===f.owner()&&row.tag==="dialog"
    &&eBoundaryClass(row,"shared-presentation-dialog"));
  assert.equal(rows.length,1);assert.ok(rows[0].port?.isConnected);return rows[0].port;
}
function eSharedBoundaryButtons(f){
  const rows=f.owner().querySelectorAll(eBoundaryNavSelector);
  assert.equal(rows.length,2);assert.ok(rows.every(node=>node.isConnected&&node.owner===f.owner()));
  assert.deepEqual(rows.map(node=>eSharedNodeText(f,node)),[f.i18n.system("Previous"),f.i18n.system("Next")]);
  assert.ok(rows.every(node=>node.getAttribute("type")==="button"));return rows;
}
function eSharedBoundaryIndex(f,index){
  const rows=f.tree().nodes.filter(row=>row.owner===f.owner()&&row.tag==="span"
    &&row.attributes.role==="status"&&row.parent?.tag==="nav"&&eBoundaryClass(row.parent.parent,"shared-presentation-stage"));
  assert.equal(rows.length,1);
  assert.equal(rows[0].text,f.i18n.system("{count} of {total}",{count:f.i18n.number(index+1),total:f.i18n.number(2)}));
  assert.ok(f.owner().markup.includes("Complete shared slide body "+(index+1)));
}
function eSharedBoundaryCustody(f,b){
  assert.equal(f.owner(),b.owner);assert.ok(b.owner.isConnected);
  assert.equal(f.route,b.route);assert.equal(b.owner.token,b.token);
  assert.equal(eSharedBoundaryDialog(f),b.dialog);
  assert.deepEqual(eSharedBoundaryButtons(f),b.buttons);
  const summaries=[...f.renderer.instances.values()].map(row=>row.instance).filter(node=>node.isConnected
    &&node.tag==="forma-artifact-summary"&&node.parentElement===b.owner);
  assert.equal(summaries.length,1);assert.equal(summaries[0].artifact,b.artifact);
  assert.equal(JSON.stringify(summaries[0].artifact),b.artifactJSON);assert.equal(JSON.stringify(b.body),b.payloadJSON);
  assert.deepEqual(f.reads.map(row=>row.url),b.reads);
  assert.ok(f.reads.every(row=>(row.init.method??"GET")==="GET"));
  assert.equal(f.sessionReads.length,0);assert.equal(f.modules.length,0);assert.equal(f.clipboard.length,0);
}
async function eSharedBoundaryKey(f,button,key){
  assert.ok(button.isConnected);f.native.emit("keydown",button);
  const dialog=eSharedBoundaryDialog(f),event={type:"keydown",key,target:button,currentTarget:dialog,
    isComposing:false,metaKey:false,ctrlKey:false,altKey:false,defaultPrevented:false,
    preventDefault(){this.defaultPrevented=true;},stopPropagation(){}};
  dialog.handlers.keydown.call(f.owner(),event);assert.equal(event.defaultPrevented,true);await f.flush();
}
async function eSharedBoundaryPending(t){
  const p=await eSharedBoundaryHost(t),{f,baseline:b}=p;
  f.holdUpdates=true;await f.act(b.buttons[1]);eSharedBoundaryIndex(f,1);
  assert.equal(eSharedBoundaryDialog(f),b.dialog);assert.deepEqual(eSharedBoundaryButtons(f),b.buttons);
  assert.equal(b.buttons[1].matches(":disabled"),true);assert.equal(b.buttons[0].matches(":disabled"),false);
  assert.equal(f.renderWaits.length,1,"the actual navigation handoff awaits its own updateComplete");
  assert.equal(f.native.listeners("focusin"),1,"one original focus lease is pending, not a fake callback");
  return p;
}
for(const locale of["en","fr","ar","ja"])test("E5 Shared boundary: "+locale+" exact disabled navigation transfers only to its current enabled peer",async t=>{
  const{f,baseline:b}=await eSharedBoundaryHost(t,locale);
  const header=eSharedControl(f,"shared-presentation-focus-toggle");
  f.native.focus(header);let count=f.native.nativeFocus.length;
  await eSharedBoundaryKey(f,header,"End");eSharedBoundaryIndex(f,1);
  assert.equal(f.native.document.activeElement,header);assert.equal(f.native.nativeFocus.length,count);
  await eSharedBoundaryKey(f,header,"Home");eSharedBoundaryIndex(f,0);
  assert.equal(f.native.document.activeElement,header);assert.equal(f.native.nativeFocus.length,count);
  for(const[trigger,peer,index]of[[b.buttons[1],b.buttons[0],1],[b.buttons[0],b.buttons[1],0]]){
    count=f.native.nativeFocus.length;await f.act(trigger);eSharedBoundaryIndex(f,index);
    assert.equal(trigger.matches(":disabled"),true);assert.equal(peer.matches(":disabled"),false);
    eSharedBoundaryCustody(f,b);
    assert.equal(f.native.document.activeElement,peer,"the newly disabled original native button must hand off to the predetermined enabled peer");
    assert.equal(f.native.nativeFocus.length,count+2,"one real activating focus and one current post-update handoff");
    assert.deepEqual(f.native.nativeFocus.at(-1).args,[{preventScroll:true}]);
    assert.equal(f.native.listeners("focusin"),0);
  }
});
test("E5 Shared boundary: newer current header focus wins while navigation rendering is held",async t=>{
  const{f,baseline:b}=await eSharedBoundaryPending(t);
  const header=eSharedControl(f,"shared-presentation-focus-toggle");
  f.native.emit("pointerdown",header);f.native.focus(header);const count=f.native.nativeFocus.length;
  await f.releaseRender();assert.equal(f.native.document.activeElement,header);assert.equal(f.native.nativeFocus.length,count);
  assert.equal(f.native.listeners("focusin"),0);eSharedBoundaryCustody(f,b);
});
test("E5 Shared boundary: a later current navigation keeps the old held handoff retired",async t=>{
  const{f,baseline:b}=await eSharedBoundaryPending(t);
  await f.act(b.buttons[0]);eSharedBoundaryIndex(f,0);
  await f.act(b.buttons[1]);eSharedBoundaryIndex(f,1);
  const count=f.native.nativeFocus.length,old=f.renderWaits.shift();assert.ok(old);
  old.gate.resolve();await f.flush();
  assert.equal(f.native.nativeFocus.length,count,"the old A-B-A continuation cannot focus");
  await f.releaseRender();assert.equal(f.native.document.activeElement,b.buttons[0]);
  assert.equal(f.native.nativeFocus.length,count+1,"only the newest exact opening may complete");
  assert.equal(f.native.listeners("focusin"),0);eSharedBoundaryCustody(f,b);
});
test("E5 Shared boundary: same-artifact close and reopen do not inherit the old handoff",async t=>{
  const{f,baseline:b}=await eSharedBoundaryPending(t);
  const close=f.tree().nodes.filter(row=>row.owner===f.owner()&&row.tag==="button"
    &&row.text===f.i18n.t("action.close","Close"));assert.equal(close.length,1);
  await f.act(close[0].port);
  assert.equal(b.dialog.isConnected,false);assert.equal(b.buttons[0].isConnected,false);
  await f.act(eSharedControl(f,"shared-presentation-open"));
  const count=f.native.nativeFocus.length,old=f.renderWaits.shift();assert.ok(old);
  old.gate.resolve();await f.flush();assert.equal(f.native.nativeFocus.length,count);
  await f.releaseRender();const current=eSharedBoundaryDialog(f);
  assert.notEqual(current,b.dialog);assert.ok(current.matches(":modal"));eSharedBoundaryIndex(f,0);
  assert.equal(f.native.nativeFocus.slice(count).some(row=>b.buttons.includes(row.node)),false);
  assert.equal(f.native.listeners("focusin"),0);assert.equal(JSON.stringify(b.artifact),b.artifactJSON);
  assert.deepEqual(f.reads.map(row=>row.url),b.reads);
});
test("E5 Shared boundary: token A-B-A retires pending navigation before current load focus",async t=>{
  const{f,baseline:b}=await eSharedBoundaryPending(t);
  await f.newToken("token-b");await f.newToken("token-a");
  assert.equal(f.owner(),b.owner);assert.equal(b.owner.token,"token-a");
  const count=f.native.nativeFocus.length,old=f.renderWaits.shift();assert.ok(old);
  old.gate.resolve();await f.flush();assert.equal(f.native.nativeFocus.length,count);
  f.holdUpdates=false;
  await f.reply(2,response(eSharedSlidesBody("current-a")));
  await f.reply(1,response(eSharedSlidesBody("retired-b")));
  assert.equal(f.native.nativeFocus.slice(count).some(row=>b.buttons.includes(row.node)),false);
  assert.ok(f.html().includes("Shared document current-a"));assert.equal(f.html().includes("Shared document retired-b"),false);
  assert.deepEqual(f.reads.map(row=>row.url),["/api/shared/token-a","/api/shared/token-b","/api/shared/token-a"]);
  assert.ok(f.reads.every(row=>(row.init.method??"GET")==="GET"));assert.equal(f.native.listeners("focusin"),0);
  assert.equal(JSON.stringify(b.artifact),b.artifactJSON);
});
test("E5 Shared boundary: disconnected current owner cannot complete an old handoff",async t=>{
  const{f,baseline:b}=await eSharedBoundaryPending(t);
  f.disconnect();const count=f.native.nativeFocus.length;await f.releaseRender();
  assert.equal(b.owner.isConnected,false);assert.equal(f.native.nativeFocus.length,count);
  assert.equal(f.native.listeners("focusin"),0);assert.equal(JSON.stringify(b.artifact),b.artifactJSON);
  assert.deepEqual(f.reads.map(row=>row.url),b.reads);
});
test("E5 Shared boundary: a current peer withdrawn before completion is not focused",async t=>{
  const{f,baseline:b}=await eSharedBoundaryPending(t);
  const peer=eSharedBoundaryButtons(f)[0];
  peer.setAttribute("disabled","");assert.equal(peer.matches(":disabled"),true);
  const count=f.native.nativeFocus.length;await f.releaseRender();
  assert.equal(f.native.nativeFocus.length,count);assert.equal(f.native.listeners("focusin"),0);
  assert.equal(JSON.stringify(b.artifact),b.artifactJSON);assert.deepEqual(f.reads.map(row=>row.url),b.reads);
});
