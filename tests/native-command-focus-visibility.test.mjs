import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {stripTypeScriptTypes} from "node:module";
const source=readFileSync(new URL("../src/components/forma-experience-host.ts",import.meta.url),"utf8"),focusSource=readFileSync(new URL("../src/components/output-navigation-focus.ts",import.meta.url),"utf8");
const focusStart=focusSource.indexOf("export function captureOutputNavigationFocus("),focusEnd=focusSource.indexOf("/** Only the actual",focusStart);
const capture=new Function(stripTypeScriptTypes(focusSource.slice(focusStart,focusEnd).replace("export function ","function "))+";return captureOutputNavigationFocus;")();
const method=source.slice(source.indexOf("  #captureCommandFocusVisibility("),source.indexOf("  #snapshotMatches("));
class Element{constructor(host){this.host=host;this.isConnected=true;this.scrolls=[];}closest(){return this.host;}contains(node){return node===this;}getBoundingClientRect(){return this.box;}scrollIntoView(options){this.scrolls.push(options);}focus(){assert.fail("visibility helper must never focus");}}
const Host=new Function("captureOutputNavigationFocus","HTMLElement",stripTypeScriptTypes("class Host {"+method.replaceAll(/#([A-Za-z]\w*)/g,"$1")+"}")+";return Host;")(capture,Element);
function harness(){
 const listeners=new Map(),host=new Host(),binding={},status=new Element(host),control=new Element(host),outside=new Element({});let visible=true,hit=status;
 const owner={activeElement:control,body:{},documentElement:{},defaultView:{innerWidth:1280,innerHeight:900,getComputedStyle:()=>({outlineWidth:"2px",outlineOffset:"2px"})},elementFromPoint:()=>hit,
  addEventListener(type,fn){listeners.set(type,[...(listeners.get(type)??[]),fn]);},removeEventListener(type,fn){listeners.set(type,(listeners.get(type)??[]).filter(x=>x!==fn));},emit(type,target){for(const fn of [...(listeners.get(type)??[])])fn({target});}};
 status.box={left:50,top:150,right:300,bottom:190,width:250,height:40};Object.assign(host,{binding,ownerDocument:owner,navigationEpoch:1,visible:()=>visible,updateComplete:Promise.resolve(),querySelector:()=>status});
 return{host,binding,status,control,outside,owner,setVisible:v=>visible=v,setHit:v=>hit=v,move(node){owner.activeElement=node;owner.emit("focusin",node);},capture:()=>host.captureCommandFocusVisibility(binding),listeners:()=>[...listeners.values()].reduce((n,list)=>n+list.length,0)};
}
test("settled offscreen command status scrolls once without focusing",async()=>{
 const h=harness(),reveal=h.capture();h.move(h.status);h.status.box={...h.status.box,top:-600,bottom:-560};await reveal();assert.deepEqual(h.status.scrolls,[{block:"center",inline:"nearest",behavior:"instant"}]);assert.equal(h.owner.activeElement,h.status);assert.equal(h.listeners(),0);await reveal();assert.equal(h.status.scrolls.length,1);
});
test("fully visible command status never scrolls",async()=>{const h=harness(),reveal=h.capture();h.move(h.status);await reveal();assert.equal(h.status.scrolls.length,0);assert.equal(h.listeners(),0);});
test("outline outside viewport requests one nearest reveal",async()=>{const h=harness(),reveal=h.capture();h.move(h.status);h.status.box={...h.status.box,top:2,bottom:42};await reveal();assert.equal(h.status.scrolls.length,1);});
test("header or clipping occlusion requests one reveal",async()=>{const h=harness(),reveal=h.capture();h.move(h.status);h.setHit(h.outside);await reveal();assert.equal(h.status.scrolls.length,1);});
test("kept focused command control is not scrolled or replaced",async()=>{const h=harness(),reveal=h.capture();await reveal();assert.equal(h.status.scrolls.length,0);assert.equal(h.owner.activeElement,h.control);assert.equal(h.listeners(),0);});
for(const action of ["pointerdown","keydown"])test("new user "+action+" cancels pending visibility ownership",async()=>{const h=harness(),reveal=h.capture();h.move(h.status);h.status.box.top=-100;h.owner.emit(action,h.status);await reveal();assert.equal(h.status.scrolls.length,0);assert.equal(h.listeners(),0);});
test("new outside focus cancels pending visibility ownership",async()=>{const h=harness(),reveal=h.capture();h.move(h.outside);await reveal();assert.equal(h.status.scrolls.length,0);assert.equal(h.owner.activeElement,h.outside);assert.equal(h.listeners(),0);});
for(const mode of ["binding","epoch","hidden","disconnected"])test(mode+" withdrawal blocks settled reveal",async()=>{const h=harness(),reveal=h.capture();h.move(h.status);h.status.box.top=-100;if(mode==="binding")h.host.binding={};if(mode==="epoch")h.host.navigationEpoch++;if(mode==="hidden")h.setVisible(false);if(mode==="disconnected")h.status.isConnected=false;await reveal();assert.equal(h.status.scrolls.length,0);assert.equal(h.listeners(),0);});
test("layout is observed after update completion, not stale pre-render geometry",async()=>{const h=harness();let done;h.host.updateComplete=new Promise(resolve=>done=resolve);const reveal=h.capture();h.move(h.status);const pending=reveal();assert.equal(h.status.scrolls.length,0);h.status.box.top=-500;done();await pending;assert.equal(h.status.scrolls.length,1);});
test("new input during layout settlement prevents later scroll",async()=>{const h=harness();let done;h.host.updateComplete=new Promise(resolve=>done=resolve);const reveal=h.capture();h.move(h.status);const pending=reveal();h.owner.emit("keydown",h.status);h.status.box.top=-500;done();await pending;assert.equal(h.status.scrolls.length,0);});
test("outside/missing source control captures no reveal lease",()=>{const h=harness();for(const active of [h.outside,null]){h.owner.activeElement=active;assert.equal(h.capture(),null);}assert.equal(h.listeners(),0);});
test("rejected layout disposes the original lease",async()=>{const h=harness(),error=Error("layout failed");h.host.updateComplete=Promise.reject(error);const reveal=h.capture();h.move(h.status);await assert.rejects(reveal(),error);assert.equal(h.listeners(),0);});
test("only a user command captures visibility; automatic checks and polling never do",()=>{
 const command=source.slice(source.indexOf("  async #command("),source.indexOf("  #captureCommandFocusVisibility(")),automatic=source.slice(source.indexOf("  async #check()"),source.indexOf("  #scheduleDeadline()"));
 assert.match(command,/this\.#captureCommandFocusVisibility\(binding\)/);assert.doesNotMatch(automatic,/captureCommandFocusVisibility|scrollIntoView/);assert.doesNotMatch(method,/status\.focus\(/);
});
