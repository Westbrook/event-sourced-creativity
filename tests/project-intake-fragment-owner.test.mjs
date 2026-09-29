// Current full Shell/Projects/Store + actual routed Worker/RAM SQLite.
// The only added browser port is independent native location plus default
// anchor/history event delivery. No private method, response, source owner,
// receipt, Store method or application success result is replaced.
import assert from "node:assert/strict";
import test from "node:test";
import {documentIdFromRoute} from "../src/model/routes.ts";
import {calmFullPageNativePorts as ports} from "./helpers/calm-full-page-fixture.mjs";
import {installDBoundNativeDetails} from "./helpers/d-native-disclosure.mjs";
import {AUTHORED,createProjectIntakeFixture,assertComplete,intendedIds,reviewProjectIntake} from "./helpers/project-intake-fixture.mjs";
const options={concurrency:false,timeout:45000};
const locales=["en","ja"];
const modes=["none","skip","path-departure","query-departure"];
const owner=x=>{
  const rows=x.f.components().filter(value=>value.tag==="forma-projects");
  assert.equal(rows.length,1,"One current actual Projects owner");return rows[0];
};
const field=(x,current,label)=>x.f.find("input",node=>node.owner.tag==="forma-ui-field"&&node.owner.parentElement===current&&node.owner.label===label);
const objective=(x,current)=>x.f.find("textarea",node=>node.owner===current&&node.attributes.maxlength==="1200");
const draft=(x,current)=>({
  name:field(x,current,x.f.i18n.t("projects.projectName","Project name")).port.value,
  documentTitle:field(x,current,x.f.i18n.system("Document name")).port.value,
  objective:objective(x,current).port.value,
});
const headers=(x,current)=>x.f.tree().visible("button").filter(node=>node.owner.tag==="forma-ui-button"&&node.owner.parentElement===current);
const resumeLabel=x=>x.f.i18n.system("Resume {title}",{title:"\u2068"+AUTHORED.name+"\u2069"});
const postCount=x=>x.h.requests.filter(row=>row.url==="/api/events"&&(row.init.method??"GET")==="POST").length;
function footer(x,current){
  return x.f.tree().visible("button").filter(node=>{
    if(node.owner!==current)return false;
    let found=false;
    for(let parent=node.parent;parent;parent=parent.parent){
      if(parent.tag==="footer")found=true;
      if(parent.tag==="form"&&String(parent.attributes.class).split(/\s+/u).includes("project-intake"))return found;
    }return false;
  });
}
async function typeRaw(x,locale){
  const raw={name:"  "+AUTHORED.name+"  ",documentTitle:"  Original document "+locale+" 文書  ",
    objective:"  "+AUTHORED.objective+"\nPrivate raw "+locale+" نص 文書  "};
  for(const [label,value] of [[x.f.i18n.t("projects.projectName","Project name"),raw.name],[x.f.i18n.system("Document name"),raw.documentTitle]]){
    const node=field(x,x.owner,label);node.port.value=value;await x.f.act(node,"input");
  }
  const node=objective(x,x.owner);node.port.value=raw.objective;await x.f.act(node,"input");
  assert.deepEqual(draft(x,x.owner),raw);return raw;
}
async function loseAck(x){
  let first=null;
  x.setBehavior(async(stage,row)=>{
    if(stage==="after-worker"&&!first){
      assertComplete(row);first=row;row.dropped=true;
      throw Error("Synthetic lost ACK only after the actual original creation committed");
    }
  });
  await x.submit();assert.ok(first);assert.equal(x.dispatches.length,1);assertComplete(first);
  x.setBehavior(async()=>{});return first;
}
async function closeCurrent(x,attempted){
  const candidates=footer(x,x.owner).filter(node=>node.attributes.class==="button ghost"
    &&node.text===x.f.i18n.t(attempted?"action.close":"action.cancel",attempted?"Close":"Cancel"));
  assert.equal(candidates.length,1);
  assert.equal(candidates[0].text,x.f.i18n.t(attempted?"action.close":"action.cancel",attempted?"Close":"Cancel"));
  await x.f.act(candidates[0]);
  assert.equal(x.f.tree().visible("dialog").filter(node=>node.owner===x.owner).length,0);
  assert.equal(x.f.tree().visible("textarea").filter(node=>node.owner===x.owner).length,0,"Closed raw text is not rendered");
  assert.equal(headers(x,x.owner).filter(node=>node.owner.label===(attempted?resumeLabel(x):x.f.i18n.t("projects.new","New project"))).length,1);
}
function emit(x,type,extra={}){
  ports.bindFixture(x.f);
  const callbacks=[...(x.f.listeners.get(type)??[])];
  const target=Object.hasOwn(extra,"target")?extra.target:ports.documentPort.activeElement;
  for(const listener of callbacks)listener({type,target,preventDefault(){},stopPropagation(){},composedPath:()=>target?[target,ports.documentPort]:[ports.documentPort],...extra});
  return callbacks.length;
}
function nativeFocus(x,node){
  assert.ok(node?.isConnected);ports.documentPort.activeElement=node;node.focus();
  emit(x,"focusin",{target:node});
}
async function historyDelivery(x,destination,{skip=false}={}){
  const old=new URL(x.h.location.href),next=new URL(destination,old),beforeRoute=x.h.store.route.get();
  let main;
  if(skip){
    const anchor=x.f.find("a",node=>node.owner===x.f.host&&String(node.attributes.class??"").split(/\s+/u).includes("skip-link"));
    assert.equal(anchor.attributes.href,"#main-content");
    assert.equal(destination,anchor.attributes.href,"The destination comes from the current actual Skip anchor");
    assert.equal(anchor.handlers.click,undefined,"No application handler replaces the anchor default");
    assert.ok(anchor.port.isConnected&&x.f.renderer.nodes.includes(anchor.port));
    main=x.f.find("main",node=>node.owner===x.f.host&&node.attributes.id==="main-content");
    assert.equal(main.attributes.tabindex,"-1");
    assert.equal(next.pathname+next.search,old.pathname+old.search,"Only fragment changes in the desired continuation");
    assert.notEqual(next.hash,old.hash);
    nativeFocus(x,anchor.port);emit(x,"keydown",{target:anchor.port,key:"Enter"});
    anchor.port.click();
    assert.equal(x.h.store.route.get(),beforeRoute,"The existing renderer has no fabricated anchor routing callback");
  }
  // Finite browser-default/history port: update independent native Location,
  // then deliver real registered Shell popstate and hashchange listeners.
  // pushState here is only the existing finite History setter; it does NOT
  // claim pushState itself emits popstate. Those browser events are explicit.
  globalThis.history.pushState({}, "",next.pathname+next.search+next.hash);
  assert.equal(x.h.store.route.get(),beforeRoute,"Native history update does not directly set the Store route");
  const popstate=emit(x,"popstate",{state:null});
  assert.equal(popstate,1,"The mounted actual Shell owns its normal popstate handler");
  const hashchange=old.hash===next.hash?0:emit(x,"hashchange",{oldURL:old.href,newURL:next.href});
  if(main)nativeFocus(x,main.port);
  await x.f.settle();
  assert.equal(x.h.store.route.get(),next.pathname+next.search+next.hash,"The actual Shell #pop and Store commit handled the location");
  return{from:old.pathname+old.search+old.hash,to:x.h.store.route.get(),popstate,hashchange,
    anchorHref:skip?"#main-content":null,focusTarget:main?.attributes.id??null,port:"finite default/history; not physical browser"};
}

for(const locale of locales)for(const attempted of [false,true])for(const mode of modes){
  test("B2 Projects original custody across native history "+JSON.stringify({locale,attempted,mode}),options,async t=>{
    const x=await createProjectIntakeFixture(t,{locale});
    // Opt in only this scenario to the existing Store host's independent
    // native Location; leave every previous fixture default unchanged.
    x.f.nativeHistoryLocation=x.h.location;
    assert.equal(x.h.location.pathname+x.h.location.search+x.h.location.hash,x.h.store.route.get());
    const shell=x.f.modules.get("src/components/forma-shell.ts")?.FormaShell;
    assert.equal(typeof shell,"function");assert.equal(x.f.host instanceof shell,true);
    const raw=await typeRaw(x,locale),first=attempted?await loseAck(x):null;
    const canonical=await x.canonical(),posts=postCount(x),requests=x.dispatches.length;
    await closeCurrent(x,attempted);
    const traversals=[];
    if(mode==="skip")traversals.push(await historyDelivery(x,"#main-content",{skip:true}));
    else if(mode==="path-departure"){
      traversals.push(await historyDelivery(x,"/settings"));
      traversals.push(await historyDelivery(x,"/projects"));
    }else if(mode==="query-departure"){
      traversals.push(await historyDelivery(x,"/projects?sort=recent"));
      traversals.push(await historyDelivery(x,"/projects"));
    }else await x.f.settle();
    const current=owner(x),sameResource=mode==="skip"||mode==="none",labels=headers(x,current).map(node=>node.owner.label);
    assert.equal(postCount(x),posts,"Closing, history delivery and restoration never automatically append or check");
    assert.equal(x.dispatches.length,requests);
    assert.deepEqual(await x.canonical(),canonical,"All actual original events and private client receipt identities remain unchanged");
    assert.equal(x.f.tree().visible("dialog").filter(node=>node.owner===current).length,0);
    t.diagnostic(JSON.stringify({locale,attempted,mode,traversals,sameOwner:current===x.owner,headerLabels:labels,
      original:first?intendedIds(first.body.events):null,canonicalEventIds:canonical.delta.map(row=>row.eventId),
      eventPostsBefore:posts,eventPostsAfter:postCount(x),noAutomaticIntake:true}));
    if(sameResource){
      const expected=attempted?resumeLabel(x):x.f.i18n.t("projects.new","New project");
      const open=headers(x,current).filter(node=>node.owner.label===expected);
      assert.equal(open.length,1,attempted?"Enabled exact Resume must survive same-resource Skip":"The current unsubmitted draft remains reachable");
      assert.equal(Object.hasOwn(open[0].attributes,"disabled"),false);
      await x.f.act(open[0]);
      assert.deepEqual(draft(x,current),raw,"Same-resource navigation must preserve every raw authored field");
      assert.equal(current,x.owner,"Same-resource continuation retains the same private draft owner");
      assert.equal(Object.hasOwn(field(x,current,x.f.i18n.t("projects.projectName","Project name")).attributes,"disabled"),attempted);
      assert.equal(postCount(x),posts,"Explicit reopening does not automatically retry or Check");
      if(attempted){
        const checks=footer(x,current).filter(node=>node.text===x.f.i18n.t("projects.checkOriginal","Check original"));
        assert.equal(checks.length,1);assert.equal(Object.hasOwn(checks[0].attributes,"disabled"),false);
        await x.f.act(checks[0]);assert.equal(x.dispatches.length,requests+1);
        const last=x.dispatches.at(-1);
        assert.equal(last.body.intakeAction,"check");assertComplete(last);
        assert.deepEqual(last.body.events,first.body.events);
        assert.deepEqual(last.reply.appended.map(event=>event.eventId),first.reply.appended.map(event=>event.eventId));
        assert.equal(documentIdFromRoute(x.h.store.route.get()),first.reply.documentId);
        assert.deepEqual(await x.canonical(),canonical,"Explicit same-original Check is read-only recovery");
      }else assert.equal(footer(x,current).some(node=>node.text===x.f.i18n.t("projects.checkOriginal","Check original")),false);
    }else{
      assert.equal(labels.includes(resumeLabel(x)),false,"Actual pathname/query departure must still retire the old intake");
      const open=headers(x,current).filter(node=>node.owner.label===x.f.i18n.t("projects.new","New project"));
      assert.equal(open.length,1);await x.f.act(open[0]);
      const emptyOutcome=objective(x,current).port.value;
      assert.equal(emptyOutcome,"","The genuinely fresh outcome contains no older private draft");
      installDBoundNativeDetails(t,x.f,current);
      await reviewProjectIntake(x.f,current,{blank:true});
      assert.deepEqual({name:field(x,current,x.f.i18n.t("projects.projectName","Project name")).port.value,
        documentTitle:field(x,current,x.f.i18n.system("Document name")).port.value,objective:emptyOutcome},
        {name:"",documentTitle:"",objective:""},"No older private draft is inherited after actual departure");
      assert.equal(footer(x,current).some(node=>node.text===x.f.i18n.t("projects.checkOriginal","Check original")),false);
      assert.equal(postCount(x),posts);assert.deepEqual(await x.canonical(),canonical);
    }
  });
}
