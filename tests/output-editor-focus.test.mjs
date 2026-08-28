import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { registerHooks } from "node:module";
import { installOutputNavigationFocusNative } from "./helpers/output-navigation-focus-native.mjs";

// Reuse the existing complete ContextIntelligence/Output-card fixture. Only
// old test registration is omitted; all production methods remain untouched.
const fixtureURL=new URL("./output-editor-handoff.test.mjs",import.meta.url),source=fs.readFileSync(fixtureURL,"utf8");
const boundary=source.indexOf('for(const locale of["en","fr","ar","ja"])test(');assert.ok(boundary>0);
const moduleURL=fixtureURL.href+"?opening-focus-fixture";
const loader=registerHooks({load(url,context,next){return url===moduleURL?{format:"module",source:source.slice(0,boundary)+"\nexport {handoffFixture,documentPort,windowPort,ElementPort};",shortCircuit:true}:next(url,context);}});
const {handoffFixture,documentPort,windowPort,ElementPort}=await import(moduleURL).finally(()=>loader.deregister());
const ports={documentPort,windowPort,ElementPort};
for(const locale of["en","fr","ar","ja"])for(const event of["none","focus","pointerdown","keydown"])
test("actual "+locale+" existing Edit handoff waits for its own focus: "+event,async t=>{
 const f=await handoffFixture(t,{locale});await f.reject();
 const native=installOutputNavigationFocusNative(t,f,ports),original=JSON.stringify(f.state.events),review=JSON.stringify(f.preview),requests=f.state.requests.length;
 const label=f.i18n.t("output.requirement.edit");await f.click(label);assert.ok(f.frames.length,"actual existing handoff is waiting for native frame");
 const field=f.contextButtons().find(button=>button.node?.isConnected&&!button.node.disabled).node;assert.ok(field);
 if(event==="focus")native.focus(field);else if(event!=="none")native.emit(event,field);
 await f.drain();
 if(event==="none"){assert.ok(f.trace.includes("native-focus:requirement-A:"+label));assert.equal(native.nativeFocus.at(-1)?.node.owner===f.card,true);}
 else{assert.equal(native.nativeFocus.some(row=>row.node.owner===f.card),false);assert.equal(native.nativeScroll.some(row=>row.node.owner===f.card),false);if(event==="focus")assert.equal(documentPort.activeElement===field,true);}
 assert.equal(f.opened.length,1);assert.equal(f.state.requests.length,requests);assert.equal(JSON.stringify(f.state.events),original);assert.equal(JSON.stringify(f.preview),review);
 assert.equal(native.listeners("focusin"),0);f.noWork();
});
for(const event of["focus","pointerdown","keydown"])test("actual existing Edit pending openDocument yields to newer "+event,async t=>{
 const f=await handoffFixture(t);await f.reject();const native=installOutputNavigationFocusNative(t,f,ports),requests=f.state.requests.length;
 let resolve;f.navigationGate={promise:new Promise(yes=>{resolve=yes;})};
 await f.click(f.i18n.t("output.requirement.edit"));
 const field=f.contextButtons().find(button=>button.node?.isConnected&&!button.node.disabled).node;assert.ok(field);
 if(event==="focus")native.focus(field);else native.emit(event,field);
 resolve(true);await f.flush();await f.drain();
 assert.equal(native.nativeFocus.some(row=>row.node.owner===f.card),false);assert.equal(native.nativeScroll.some(row=>row.node.owner===f.card),false);
 if(event==="focus")assert.equal(documentPort.activeElement===field,true);
 assert.equal(f.state.requests.length,requests);assert.equal(native.listeners("focusin"),0);f.noWork();
});

for(const locale of["en","fr","ar","ja"])for(const boundary of["openDocument","frame"])for(const moved of[false,true])
test("actual "+locale+" Review plan "+boundary+" "+(moved?"newer focus":"control"),async t=>{
 const f=await handoffFixture(t,{locale});await f.reject();
 const native=installOutputNavigationFocusNative(t,f,ports),original=JSON.stringify(f.state.events),retained=JSON.stringify(f.preview),requests=f.state.requests.length;
 let release;
 if(boundary==="openDocument")f.navigationGate={promise:new Promise(resolve=>{release=resolve;})};
 await f.click(f.i18n.t("output.requirement.edit"));
 if(boundary==="frame")assert.ok(f.frames.length,"actual route handoff is waiting for its RAF");
 const field=f.card.querySelectorAll(".output-requirement-header button").find(button=>button.textContent?.trim()===f.i18n.t("output.requirement.reviewPlan"));
 assert.ok(field&&!field.disabled&&field.isConnected,"the existing native Review plan control is connected and enabled");
 const route=f.state.route,authority=f.state.authorization,snapshot=JSON.stringify(f.output);
 if(moved)native.focus(field);
 release?.(true);await f.flush();await f.drain();
 assert.equal(f.state.route,route);assert.equal(f.state.authorization,authority);assert.equal(JSON.stringify(f.output),snapshot);
 assert.equal(field.isConnected,true,"newer native focus did not disappear");
 if(moved){
  assert.equal(documentPort.activeElement===field,true,"later connected Review plan focus wins");
  assert.equal(native.nativeScroll.some(row=>row.node.textContent?.trim()===f.i18n.t("output.requirement.edit")),false,"no late Edit scroll after newer focus");
 }else assert.equal(documentPort.activeElement?.textContent?.trim(),f.i18n.t("output.requirement.edit"));
 assert.equal(f.state.requests.length,requests);assert.equal(JSON.stringify(f.state.events),original);assert.equal(JSON.stringify(f.preview),retained);
 assert.equal(f.opened.length,1);assert.equal(native.listeners("focusin"),0);f.noWork();
});
