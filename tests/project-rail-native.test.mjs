import assert from "node:assert/strict";
import test from "node:test";
import { createProjectRailNativeFixture } from "./helpers/project-rail-native-fixture.mjs";
import { isOutputFixtureReadOnlyResume } from "./helpers/output-reachability-fixture.mjs";

const hasClass=name=>node=>String(node.attributes.class??"").split(/\s+/u).includes(name);
async function fixture(t,options={}){
  const previous=globalThis.fetch;let external=0;
  globalThis.fetch=async()=>{external++;throw new Error("External/provider calls forbidden in ProjectRail host tests");};
  t.after(()=>{globalThis.fetch=previous;assert.equal(external,0);});
  return createProjectRailNativeFixture(t,options);
}
test("compact Creator Project rail is lazy native-auto navigation with actual full hierarchy and no opening side effects",async t=>{
 const f=await fixture(t),before=f.store.events.get(),requests=f.storeHost.requests.length,originalRoute=f.store.route.get();
 assert.equal(f.shell.getAttribute("data-nav-posture"),"compact");assert.equal(f.panel().attributes.popover,"auto");
 assert.equal(f.toggle().attributes.popovertarget,f.panel().attributes.id);assert.equal(f.toggle().attributes["aria-controls"],f.panel().attributes.id);
 assert.equal(f.toggle().attributes.type,"button","navigation must never become an implicit form submission");
 assert.equal(String(f.toggle().attributes["aria-expanded"]),"false");
 assert.equal(f.components().some(component=>component.tag==="forma-collection-tree"),false,"closed rail does not mount authored collections");
 await f.open();
 assert.equal(String(f.toggle().attributes["aria-expanded"]),"true");assert.equal(f.renderer.openPopovers.has(f.panel().attributes.id),true);
 assert.ok(f.components().some(component=>component.tag==="forma-collection-tree"),"existing actual nested component mounted on demand");
 assert.ok(f.dom.visible("nav").some(node=>node.owner===f.rail&&hasClass("rail-document-links")(node)));
 assert.equal(f.dom.nodes.filter(node=>node.owner===f.rail&&["menu","menuitem","listbox"].includes(node.attributes.role)).length,0);
 assert.equal(f.dom.nodes.filter(node=>node.attributes.id===f.panel().attributes.id).length,1);
 assert.equal(f.store.events.get(),before);assert.equal(f.storeHost.requests.length,requests);assert.equal(f.store.route.get(),originalRoute);assert.deepEqual(f.scrolls,[]);
 await f.dismiss("escape");assert.equal(String(f.toggle().attributes["aria-expanded"]),"false");assert.equal(f.active(),f.toggle().port);
 assert.equal(f.components().some(component=>component.tag==="forma-collection-tree"),false);
});

for(const scenario of [
 {width:360,height:780,posture:"compact",native:true},
 {width:760,height:882,posture:"compact",native:true},
 {width:767.9,height:882,posture:"compact",native:true},
 {width:768,height:882,posture:"rail",native:false},
 {width:790,height:882,posture:"rail",native:false},
 {width:934,height:882,posture:"rail",native:false},
 {width:1280,shellWidth:700,height:882,posture:"compact",native:true},
 {width:844,height:390,posture:"rail",native:false},
 {width:700,height:390,posture:"rail",native:true},
 {width:934,height:882,rootFont:24,posture:"rail",native:true},
 {width:1440,height:900,posture:"expanded",native:false}
]){
 test("actual Shell posture + native CSS-media port uses the overlay OR, not broad compact: "+JSON.stringify(scenario),async t=>{
  const f=await fixture(t,scenario);
  assert.equal(f.shell.getAttribute("data-nav-posture"),scenario.posture);
  assert.equal(f.toggle().attributes.type,"button","native and inline navigation remain non-submit controls");
  assert.equal(Boolean(f.panel()),scenario.native);
  const before=f.storeHost.requests.length,events=f.store.events.get();
  await f.open();
  assert.equal(String(f.toggle().attributes["aria-expanded"]),"true");
  if(scenario.native)assert.equal(f.renderer.openPopovers.has(f.panel().attributes.id),true);
  else{
    assert.equal(f.toggle().attributes.popovertarget,undefined);
    const inline=f.dom.nodes.find(node=>node.owner===f.rail&&hasClass("rail-content")(node));assert.ok(inline);assert.equal(inline.attributes.popover,undefined);
    assert.equal(f.renderer.openPopovers.size,0,"desktop rail does not enter top layer");
  }
  assert.equal(f.storeHost.requests.length,before);assert.equal(f.store.events.get(),events);
 });
}

for(const locale of ["en","fr","ar","ja"]){
 test(locale+" native navigation keeps existing localized labels, current link, nested collection component and bounded positioning",async t=>{
  const f=await fixture(t,{locale,width:700,height:390,safe:20});await f.open();
  const panel=f.panel();assert.ok(panel);
  assert.notEqual(f.toggle().attributes["aria-label"],"");
  assert.equal(f.toggle().attributes.type,"button");
  assert.ok(f.dom.visible("nav").some(node=>node.owner===f.rail&&node.attributes["aria-label"]));
  const current=f.dom.visible("a").find(node=>node.owner===f.rail&&node.attributes["aria-current"]==="page"&&hasClass("rail-document-links")(node.parent));
  assert.ok(current);assert.equal(f.active(),current.port,"owned initial focus follows exact currently active document");
  const style=f.nativeStyles.get(panel.attributes.id);
  assert.ok(Number.parseFloat(style.get("--forma-popover-left"))>=20);
  assert.ok(Number.parseFloat(style.get("--forma-popover-max-width"))<=660);
  assert.ok(Number.parseFloat(style.get("--forma-popover-max-height"))<=350);
  assert.ok(f.dom.visible("button").some(node=>node.owner.tag==="forma-collection-tree"));
  await f.dismiss("escape");assert.equal(f.active(),f.toggle().port);
 });
}

test("native outside dismissal and peer auto-popover opening close the rail without stealing new focus",async t=>{
 const f=await fixture(t);await f.open();
 const outside=f.dom.visible("button").find(node=>node.owner.tag==="forma-shell"&&hasClass("command-trigger")(node));
 assert.ok(outside);outside.port.focus();await f.dismiss("outside");
 assert.equal(String(f.toggle().attributes["aria-expanded"]),"false");assert.equal(f.active(),f.currentNode(outside.port));
 await f.open();
 const account=f.dom.visible("button").find(node=>node.attributes.popovertarget==="account-popover");assert.ok(account);
 await f.dispatch(account);
 assert.equal(f.renderer.openPopovers.has("account-popover"),true);
 assert.equal(f.renderer.openPopovers.has(f.panel().attributes.id),false);
 assert.equal(String(f.toggle().attributes["aria-expanded"]),"false");
});

test("ordinary native closing preserves its focused contents through an intervening render until actual closed toggle",async t=>{
 const f=await fixture(t);await f.open();
 const before={events:f.store.events.get(),requests:f.storeHost.requests.length,route:f.store.route.get()};
 const retained=()=>({text:f.panel().text,links:f.dom.visible("a").filter(node=>node.owner===f.rail).map(node=>({text:node.text,href:node.attributes.href,current:node.attributes["aria-current"]}))});
 const copy=retained(),panel=f.panel(),current=f.dom.visible("a").find(node=>node.owner===f.rail&&node.attributes["aria-current"]==="page"&&hasClass("rail-document-links")(node.parent));
 assert.ok(current);assert.equal(f.active(),current.port);
 await panel.handlers.beforetoggle.call(f.rail,{currentTarget:panel.port,newState:"closed",oldState:"open"});
 f.draw();await f.settle();
 assert.equal(f.renderer.openPopovers.has(f.panel().attributes.id),true,"the native hide operation has not yet retired the panel");
 assert.deepEqual(retained(),copy,"an unrelated render during native beforetoggle must preserve the exact focused navigation subtree");
 assert.ok(f.components().some(component=>component.tag==="forma-collection-tree"),"the actual nested owner stays mounted during native dismissal");
 assert.equal(f.active(),f.currentNode(current.port),"the renderer has not removed the native focused descendant before the browser can restore focus");
 const closing=f.panel();f.renderer.openPopovers.delete(closing.attributes.id);
 await closing.handlers.toggle.call(f.rail,{currentTarget:closing.port,newState:"closed",oldState:"open"});
 await f.settle();
 assert.equal(String(f.toggle().attributes["aria-expanded"]),"false");
 assert.equal(f.components().some(component=>component.tag==="forma-collection-tree"),false,"actual closed toggle retires the lazy subtree");
 assert.equal(f.store.events.get(),before.events);assert.equal(f.storeHost.requests.length,before.requests);assert.equal(f.store.route.get(),before.route);assert.deepEqual(f.scrolls,[]);
 // This ordering regression never simulates invoker restoration; the real-browser Escape journey owns that assertion.
});

test("native close and reopen before a coalesced toggle preserves the newer presentation and outside focus",async t=>{
 const f=await fixture(t);await f.open();const panel=f.panel();
 const before={events:f.store.events.get(),requests:f.storeHost.requests.length,route:f.store.route.get()};
 await panel.handlers.beforetoggle.call(f.rail,{currentTarget:panel.port,newState:"closed",oldState:"open"});
 f.renderer.openPopovers.delete(panel.attributes.id);
 await panel.handlers.beforetoggle.call(f.rail,{currentTarget:panel.port,newState:"open",oldState:"closed",preventDefault(){assert.fail("current native reopen must remain allowed");}});
 f.renderer.openPopovers.add(panel.attributes.id);f.draw();
 const outside=f.dom.visible("button").find(node=>node.owner.tag==="forma-shell"&&hasClass("command-trigger")(node));
 assert.ok(outside);outside.port.focus();const focused=f.trace.filter(item=>item.startsWith("focus:")).length;
 const reopened=f.panel();await reopened.handlers.toggle.call(f.rail,{currentTarget:reopened.port,newState:"closed",oldState:"open"});
 await f.settle();
 assert.equal(f.renderer.openPopovers.has(f.panel().attributes.id),true,"actual reopened state wins over coalesced closed event text");
 assert.equal(String(f.toggle().attributes["aria-expanded"]),"true");
 assert.ok(f.components().some(component=>component.tag==="forma-collection-tree"));
 assert.equal(f.active(),f.currentNode(outside.port));assert.equal(f.trace.filter(item=>item.startsWith("focus:")).length,focused,"coalesced native lifecycle cannot steal a newer outside focus");
 assert.equal(f.store.events.get(),before.events);assert.equal(f.storeHost.requests.length,before.requests);assert.equal(f.store.route.get(),before.route);assert.deepEqual(f.scrolls,[]);
});

test("real native coalesced and old queued toggle events cannot close a newer open presentation",async t=>{
 const f=await fixture(t);await f.open();const old=f.panel();
 await f.dismiss("outside");await f.open();const current=f.panel();
 await current.handlers.toggle.call(f.rail,{currentTarget:current.port,newState:"closed"});
 await f.settle();assert.equal(String(f.toggle().attributes["aria-expanded"]),"true","current native state wins over stale event text");
 await old.handlers.toggle.call(f.rail,{currentTarget:old.port,newState:"closed"});
 await f.settle();assert.equal(String(f.toggle().attributes["aria-expanded"]),"true","detached old panel does not own new presentation");
});

for(const kind of ["route","authority","posture","disconnect"]){
 test("native navigation clears immediately on "+kind+" and stale controls cannot act in the new scope",async t=>{
  const f=await fixture(t);await f.open();const oldLink=f.dom.visible("a").find(node=>node.owner===f.rail&&hasClass("rail-project-overview")(node));
  assert.ok(oldLink);const before=f.store.events.get(),requests=f.storeHost.requests.length;
  if(kind==="route"){f.store.route.set(f.store.route.get()+"?native-other-route");f.emit("forma-route-changed");}
  if(kind==="authority"){f.store.session.set({...f.store.session.get(),permissionEpoch:"native-revoked-epoch"});f.emit("forma-authorization-changed");}
  if(kind==="posture"){f.measure({width:844,shellWidth:844,height:390});}
  if(kind==="disconnect"){f.rail.isConnected=false;f.rail.disconnectedCallback();}
  assert.equal(f.renderer.openPopovers.has(oldLink.port.closest("[popover]").attributes.id),false);
  const route=f.store.route.get();const result=await f.dispatch(oldLink,"click",{}, {settle:false});
  assert.equal(result.prevented,true);assert.equal(f.store.route.get(),route);assert.equal(f.store.events.get(),before);assert.equal(f.storeHost.requests.length,requests);
  if(kind!=="disconnect")await f.settle();
 });
}

test("newer authorized panel stays open when an old captured scope click arrives",async t=>{
 const f=await fixture(t);await f.open();const old=f.dom.visible("a").find(node=>node.owner===f.rail&&hasClass("rail-project-overview")(node));
 f.store.route.set(f.store.route.get()+"?new-presentation");await f.settle();await f.open();
 const panel=f.panel(),route=f.store.route.get();await f.dispatch(old);
 assert.equal(f.store.route.get(),route);assert.equal(f.renderer.openPopovers.has(panel.attributes.id),true);
 assert.equal(String(f.toggle().attributes["aria-expanded"]),"true");
});

for(const kind of ["healthy","route","authority","posture","disconnect","new-presentation","outside-focus"]){
 test("deferred native initial focus remains presentation-owned: "+kind,async t=>{
  const f=await fixture(t);let resolve;const pending=new Promise(done=>{resolve=done;}),tick=f.tick;
  f.tick=()=>pending;
  await f.dispatch(f.toggle(),"click",{}, {settle:false});await f.settle();
  f.tick=tick;
  if(kind==="route"){f.store.route.set(f.store.route.get()+"?focus-owner-changed");await f.settle();}
  if(kind==="authority"){f.store.session.set({...f.store.session.get(),permissionEpoch:"focus-revoked"});await f.settle();}
  if(kind==="posture"){f.measure({width:844,shellWidth:844,height:390});await f.settle();}
  if(kind==="disconnect"){f.rail.isConnected=false;f.rail.disconnectedCallback();}
  if(kind==="new-presentation"){await f.dismiss("outside");await f.open();}
  if(kind==="outside-focus"||kind==="new-presentation"){f.dom.visible("button").find(node=>node.owner.tag==="forma-shell").port.focus();}
  const focused=f.trace.filter(item=>item.startsWith("focus:")).length;
  resolve();await Promise.resolve();await Promise.resolve();
  const after=f.trace.filter(item=>item.startsWith("focus:")).length;
  if(kind==="healthy")assert.equal(after,focused+1,"normal current panel retains its initial-link focus");
  else assert.equal(after,focused,"stale continuation cannot retarget focus");
 });
}

test("desktop inline rail preserves preference and Escape focus without borrowing native popup behavior",async t=>{
 const f=await fixture(t,{width:1440,height:900});assert.equal(f.panel(),null);await f.open();
 assert.equal(f.store.ui.projectRailCollapsed,false);
 const aside=f.dom.nodes.find(node=>node.owner===f.rail&&node.tag==="aside");
 const response=await f.dispatch(aside,"keydown",{key:"Escape"});
 assert.equal(response.prevented,true);assert.equal(f.store.ui.projectRailCollapsed,true);assert.equal(f.active(),f.toggle().port);
 await f.open();assert.equal(f.panel(),null);assert.equal(f.store.ui.projectRailCollapsed,false);
});

test("same synthetic full hierarchy at934/847 exposes real Results contributors;790/718 remains a separate narrow posture",async t=>{
 const f=await fixture(t,{width:790,height:882,studioWidth:718}),narrow=f.dom;
 const results=narrow.nodes.find(node=>node.attributes.id==="document-results-panel");assert.equal(results.hiddenBy,"document-results-panel");
 // E3 replaced the direct view links with one actual native View trigger.
 // Pin its identity and retained destinations before reconciling the count.
 const viewMenus=narrow.nodes.filter(node=>node.tag==="forma-ui-popover"&&hasClass("studio-view-menu")(node));
 assert.equal(viewMenus.length,1);const viewMenu=viewMenus[0];
 assert.equal(viewMenu.owner.tag,"forma-studio-mode-nav");assert.ok(viewMenu.component?.isConnected);
 const viewTriggers=narrow.visible("button").filter(node=>node.owner===viewMenu.component&&hasClass("ui-popover-trigger")(node));
 assert.equal(viewTriggers.length,1);const viewTrigger=viewTriggers[0];
 assert.equal(viewTrigger.text,"Change view · Document");assert.equal(viewTrigger.attributes.type,"button");assert.ok(viewTrigger.port?.isConnected);
 const viewPanel=narrow.nodes.find(node=>node.owner===viewMenu.component&&node.attributes.id===viewTrigger.attributes.popovertarget);
 assert.ok(viewPanel?.port?.isConnected);assert.equal(viewPanel.attributes.popover,"auto");
 assert.equal(viewTrigger.attributes["aria-controls"],viewPanel.attributes.id);assert.equal(String(viewTrigger.attributes["aria-expanded"]),"false");
 assert.equal(f.renderer.openPopovers.has(viewPanel.attributes.id),false);
 const viewKinds=["document","board","guided","layers","adaptive","editor","chat"];
 const documentHref="/document/scene-reuse-document/one-current-authored-direction";
 const viewLinks=narrow.nodes.filter(node=>node.owner===viewMenu.component&&node.attributes["data-studio-view"]);
 assert.deepEqual(viewLinks.map(node=>[node.attributes["data-studio-view"],node.attributes.href,node.attributes["aria-current"]??null,node.hiddenBy]),
   viewKinds.map(kind=>[kind,kind==="document"?documentHref:documentHref+"/view/"+kind,kind==="document"?"page":null,viewPanel.attributes.id+"[closed-popover]"]));
 assert.deepEqual(narrow.visible("button").map(node=>[node.owner.tag,node.attributes["aria-label"]??node.text]),[
   ["forma-shell","Open all Forma projects"],
   ["forma-ui-workspace-switcher","Switch workspace. Current workspace: Creator Workspace"],
   ["forma-shell","Search or run a command"],
   ["forma-shell","Share"],
   ["forma-shell","Account and settings"],
   ["forma-project-rail","Expand project navigation"],
   ["forma-workspace","Rename One current authored direction"],
   ["forma-workspace","Undo"],
   ["forma-workspace","Redo"],
   ["forma-workspace","Compare"],
   ["forma-workspace","Remove"],
   ["forma-ui-popover","Change view · Document"],
   ["forma-studio-mode-nav","Add context"],
   ["forma-studio-mode-nav","Enter focused document view"],
   ["forma-workspace","Write"],
   ["forma-workspace","Creative results"],
   ["forma-workspace","Assigned review"],
   ["forma-workspace","Improve · Attach grounding evidenceAdd a licensed source document, pasted excerpt, or image when evidence is important."],
   ["forma-ui-choice-card","Prepare an outputChoose and review this document’s output settings. Nothing is generated yet."],
   ["forma-workspace","Add context"],
   ["forma-workspace","See spatially"],
   ["forma-workspace","Quick edit"],
   ["forma-workspace","Ask Forma"],
 ],"Every actual narrow native control retains its owner and identity; the View trigger is not a duplicate or substitute");
 assert.deepEqual(narrow.visible("select").map(node=>node.owner.tag),["forma-ui-language-picker"]);
 const before=narrow.controls();assert.deepEqual(before,{button:23,select:1});
 f.measure({width:934,shellWidth:934,studioWidth:847});await f.settle();const wider=f.dom;
 assert.equal(f.shell.getAttribute("data-nav-posture"),"rail");
 assert.equal(wider.nodes.find(node=>node.attributes.id==="document-results-panel").hiddenBy,null,"actual Workspace width ownership removes hidden attribute");
 assert.ok(wider.visible("button").some(node=>node.owner.tag==="forma-document-artifacts"));
 assert.ok(wider.controls().button>before.button);
 assert.equal(f.store.projection.get().blocks.length,14);
 assert.equal(wider.visible("dialog").length,0);
 t.diagnostic("Same synthetic14 data;790/718="+JSON.stringify(before)+";934/847="+JSON.stringify(wider.controls())+". Actual renderer/ResizeObserver ports, not native CSS geometry or production study counts.");
});

test("Document rendered posture and hidden panes agree across scrollbar and rem breakpoints",async t=>{
 const f=await fixture(t,{width:745,height:883,studioWidth:730});
 for(const [studioWidth,rootFont,narrow] of [[730,16,true],[735.99,16,true],[736,16,false],[745,16,false],[730,16,true],[760,16,false],[761,16,false],[768,16,false],[919.99,20,true],[920,20,false]]){
  f.measure({studioWidth,rootFont});await f.settle();
  const section=f.dom.nodes.find(node=>node.attributes["data-workbench"]==="document");
  assert.equal(section.attributes["data-workbench-narrow"],String(narrow),`posture at ${studioWidth}px / ${rootFont}px rem`);
  const context=f.dom.nodes.find(node=>node.attributes.id==="document-context-panel");
  const result=f.dom.nodes.find(node=>node.attributes.id==="document-results-panel");
  assert.equal(context.hiddenBy,null);
  assert.equal(result.hiddenBy,narrow?"document-results-panel":null);
  if(narrow){
   const route=f.store.route.get(),requests=f.storeHost.requests.length;
   for(const pane of ["result","review","write"]){
    await f.dispatch(f.dom.nodes.find(node=>node.attributes["data-workbench-pane"]===pane));
    assert.equal(f.dom.nodes.find(node=>node.attributes["data-workbench"]==="document").attributes["data-workbench-narrow"],"true");
    assert.equal(f.dom.nodes.find(node=>node.attributes.id==="document-context-panel").hiddenBy,pane==="write"?null:"document-context-panel");
    assert.equal(f.dom.nodes.find(node=>node.attributes.id==="document-results-panel").hiddenBy,pane==="write"?"document-results-panel":null);
   }
   assert.equal(f.store.route.get(),route);assert.equal(f.storeHost.requests.length,requests);
  }
 }
});

test("real document anchor keeps modifier/middle navigation native and exact normal navigation closes first",async t=>{
 const f=await fixture(t);await f.open();
 const link=f.dom.visible("a").find(node=>node.owner===f.rail&&node.attributes["aria-current"]==="page"&&hasClass("rail-document-links")(node.parent));
 assert.ok(link);const original=f.store.route.get(),id=f.store.projection.get().documentId,before=f.store.events.get(),requests=f.storeHost.requests.length;
 for(const fields of [{metaKey:true},{ctrlKey:true},{shiftKey:true},{altKey:true},{button:1}]){
  const result=await f.dispatch(link,"click",fields,{settle:false});assert.equal(result.prevented,false);
  assert.equal(f.store.route.get(),original);assert.equal(f.renderer.openPopovers.has(f.panel().attributes.id),true);
 }
 const calls=[],open=f.store.openDocument.bind(f.store);
 f.store.openDocument=(...args)=>{calls.push({args,open:f.renderer.openPopovers.has(f.panel().attributes.id)});return open(...args);};
 const result=await f.dispatch(link,"click",{},{settle:false});await Promise.resolve();
 assert.equal(result.prevented,true);assert.equal(calls.length,1);assert.equal(calls[0].open,false);
 assert.equal(calls[0].args[0],id);assert.equal(calls[0].args[2],"project-rail");
 assert.ok(f.store.route.get().includes(encodeURIComponent(id)));assert.equal(f.store.events.get(),before);
 assert.equal(f.storeHost.requests.length,requests);assert.deepEqual(f.scrolls,[{top:0}]);
});

test("project overview and reusable-block anchors retain actual route/library selection; opening never substitutes a guessed target",async t=>{
 const f=await fixture(t);await f.open();
 const reusable=f.dom.visible("a").find(node=>node.owner===f.rail&&hasClass("rail-primary-action")(node));
 assert.ok(reusable);const expected=reusable.attributes.href;
 const result=await f.dispatch(reusable,"click",{},{settle:false});
 assert.equal(result.prevented,true);assert.equal(f.store.route.get(),expected);
 assert.equal(f.store.ui.libraryView,"blocks");assert.equal(f.store.ui.focusCollectionId,"");
 assert.equal(f.renderer.openPopovers.size,0);assert.deepEqual(f.scrolls,[{top:0}]);
});

test("current reader navigation exposes scoped destinations without authoring controls",async t=>{
 const f=await fixture(t,{reader:true});await f.open();
 assert.ok(f.dom.visible("a").some(node=>node.owner===f.rail&&hasClass("rail-document-links")(node.parent)));
 assert.equal(f.dom.visible("a").filter(hasClass("rail-primary-action")).length,0);
 assert.equal(f.dom.visible("button").filter(node=>hasClass("rail-project-edit")(node)||hasClass("tree-more")(node)||node.attributes["aria-label"]==="Create top-level collection").length,0);
 const collectionNavigation=f.dom.visible("button").filter(node=>node.owner.tag==="forma-collection-tree");
 assert.equal(collectionNavigation.length,f.store.projection.get().collections.length);
 assert.ok(collectionNavigation.every(hasClass("tree-name")),"reader keeps actual collection filtering, not mutation actions");
 assert.equal(f.storeHost.requests.filter(request=>request.init.method==="POST").length,0);
});

test("native collection Create uses the existing mounted editor rather than closing its owner before modal handoff",async t=>{
 const f=await fixture(t);await f.open();
 const create=f.dom.visible("button").find(node=>node.owner.tag==="forma-collection-tree");
 assert.ok(create);const before=f.storeHost.requests.length;
 await f.dispatch(create);
 const dialog=f.dom.visible("dialog").find(node=>node.owner.tag==="forma-collection-tree");assert.ok(dialog,"actual collection modal stays mounted");
 assert.equal(f.storeHost.requests.length,before,"opening native navigation/collection form is read-only");
 assert.equal(f.renderer.openPopovers.has(f.panel().attributes.id),true,"valid child form handoff is not blanket-dismissed by capture guard");
 const old=create;
 const scope={projectId:f.store.projection.get().projectId,documentId:f.store.projection.get().documentId};
 f.store.session.set({...f.store.session.get(),permissionEpoch:"collection-withdrawn"});await f.settle();
 assert.equal(f.dom.visible("dialog").filter(node=>node.owner.tag==="forma-collection-tree").length,0);
 const boundary=f.storeHost.requests.slice(before);
 assert.deepEqual({projectId:f.store.projection.get().projectId,documentId:f.store.projection.get().documentId},scope,"permission refresh retains this exact project and document");
 const resumes=boundary.filter(request=>isOutputFixtureReadOnlyResume(request,scope));
 assert.equal(resumes.length,1,"exactly one scoped free Resume accompanies this permission-epoch refresh");
 assert.deepEqual(resumes[0].body,{action:"resume",projectId:scope.projectId,documentId:scope.documentId},"the captured Store request has only the exact Resume identity");
 assert.equal(boundary.length,2,"only the one Output refresh and the one exact current-document Resume are allowed");
 const refreshed=boundary.filter(request=>request!==resumes[0]);
 assert.equal(refreshed.length,1,"current Output controller refreshes once at the permission-epoch boundary");
 assert.equal(refreshed[0].init.method??"GET","GET");
 assert.equal(refreshed[0].url,"/api/output-requirements?documentId="+encodeURIComponent(f.store.projection.get().documentId));
 const afterAuthorityRefresh=f.storeHost.requests.length;
 const result=await f.dispatch(old,"click",{},{settle:false});assert.equal(result.prevented,true);assert.equal(f.storeHost.requests.length,afterAuthorityRefresh,"the stale collection action makes no request after the current read");
});

test("actual shell posture mutation closes an open wide-browser narrow-shell panel even while media remains wide",async t=>{
 const f=await fixture(t,{width:1280,shellWidth:700});await f.open();const id=f.panel().attributes.id;
 assert.ok(f.mutations.size,"actual ProjectRail registered its bounded attribute observer");
 f.measure({shellWidth:1000});await f.settle();
 assert.equal(f.shell.getAttribute("data-nav-posture"),"rail");assert.equal(f.panel(),null);assert.equal(f.renderer.openPopovers.has(id),false);
 assert.equal(String(f.toggle().attributes["aria-expanded"]),"false","native open state does not overwrite inline collapsed preference");
});

test("Creator-only gate rejects a pre-update opening after actual ancestor application-class withdrawal",async t=>{
 const f=await fixture(t),trigger=f.toggle(),route=f.store.route.get(),before=f.storeHost.requests.length;
 f.shell.setAttribute("class",f.shell.getAttribute("class").replace("application-creative","application-canvas"));
 const result=await f.dispatch(trigger,"click",{},{settle:false});
 assert.equal(result.prevented,true);assert.equal(f.renderer.openPopovers.size,0);
 assert.equal(f.store.route.get(),route);assert.equal(f.storeHost.requests.length,before);
});


test("actual project overview anchor retains its exact navigation destination and normal scroll behavior",async t=>{
 const f=await fixture(t);await f.open();
 const link=f.dom.visible("a").find(node=>node.owner===f.rail&&hasClass("rail-project-overview")(node)),before=f.store.events.get();
 assert.ok(link);const result=await f.dispatch(link,"click",{},{settle:false});
 assert.equal(result.prevented,true);assert.equal(f.store.route.get(),link.attributes.href);
 assert.equal(f.renderer.openPopovers.size,0);assert.deepEqual(f.scrolls,[{top:0}]);assert.equal(f.store.events.get(),before);
});

test("reader collection selection preserves the actual scoped ID and existing collection destination",async t=>{
 const f=await fixture(t,{reader:true});await f.open();
 const name=f.dom.visible("button").find(node=>node.owner.tag==="forma-collection-tree"&&hasClass("tree-name")(node));assert.ok(name);
 const collectionId=name.port.closest("[data-collection-id]").getAttribute("data-collection-id"),before=f.store.events.get();
 await f.dispatch(name,"click",{},{settle:false});
 assert.equal(f.store.ui.focusCollectionId,collectionId);assert.equal(f.store.route.get(),name.owner.destination);
 assert.equal(f.store.events.get(),before);assert.deepEqual(f.scrolls,[{top:0}]);
});
