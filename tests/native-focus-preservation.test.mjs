import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {stripTypeScriptTypes} from "node:module";
const source=readFileSync(new URL("../src/components/forma-experience-host.ts",import.meta.url),"utf8");
const focusSource=readFileSync(new URL("../src/components/output-navigation-focus.ts",import.meta.url),"utf8");
const start=focusSource.indexOf("export function captureOutputNavigationFocus("),end=focusSource.indexOf("/** Only the actual",start);
const capture=new Function(stripTypeScriptTypes(focusSource.slice(start,end).replace("export function ","function "))+";return captureOutputNavigationFocus;")();
const helpers=source.slice(source.indexOf("  #focusOut ="),source.indexOf("  protected override willUpdate()"));
const render=source.slice(source.indexOf("  override render()"),source.lastIndexOf("\n}\nif ("));
const stop=source.slice(source.indexOf("  async #stopVideo("),source.indexOf("  async #command("));
const reveal=source.slice(source.indexOf("  #captureCommandFocusVisibility("),source.indexOf("  #snapshotMatches("));
const compiled=stripTypeScriptTypes("class Host {\n"+(helpers+render+stop+reveal).replace("override render()", "render()").replaceAll(/#([A-Za-z]\w*)/g,"$1")+"\n}")+";return Host;";
const html=(strings,...values)=>({strings,values}), nothing=Symbol("nothing");
function text(value){
 if(value===nothing||value===null||value===undefined)return "";
 if(typeof value==="function")return "[handler]";
 if(Array.isArray(value))return value.map(text).join("");
 if(value?.strings)return value.strings.reduce((all,part,index)=>all+part+text(value.values[index]),"");
 return String(value);
}
class Element {
 constructor(host,key,{action,tag="BUTTON",status=false}={}){
  this.host=host;this.dataset={...(key?{experienceControl:key}:{}),...(action?{experienceAction:action}:{})};
  this.tagName=tag;this.isConnected=true;this.status=status;this.moves=0;
 }
 closest(selector){return selector==="forma-experience-host"?this.host:selector==="form[data-experience-action]"?this.form??null:null;}
 focus(){this.moves++;this.host.ownerDocument.activeElement=this;this.host.ownerDocument.emit("focusin",this);}
}
class Button extends Element{}
class Input extends Element{}
const Host=new Function("captureOutputNavigationFocus","HTMLElement","HTMLButtonElement","HTMLInputElement","html","nothing","keyed",compiled)(capture,Element,Button,Input,html,nothing,(_key,value)=>value);
function harness(action="run"){
 const host=new Host(),listeners=new Map();
 const body={},outside={},document={activeElement:body,body,documentElement:{},
  addEventListener(type,fn){listeners.set(type,[...(listeners.get(type)??[]),fn]);},
  removeEventListener(type,fn){listeners.set(type,(listeners.get(type)??[]).filter(item=>item!==fn));},
  emit(type,target){for(const fn of [...(listeners.get(type)??[])])fn({target});}};
 const binding={selection:{output:"image"}};
 let state={status:"authorized",output:"image",permitted:{[action]:true}},readable=true,visible=true;
 Object.assign(host,{ownerDocument:document,binding,busy:false,loading:false,confirmed:true,approval:true,sceneApproval:false,
  state:()=>state,readable:()=>readable,visible:()=>visible,
  paidDecision:key=>host.busy||!state?.permitted[key]?null:{action:key},
  model3dText:value=>value,i18n:{system:value=>value},imageFormat:()=>null,terms:()=>null,imageReady:()=>true,
  status:"Authorized",requestUpdate(){host.updates=(host.updates??0)+1;},
  navigate(){assert.fail("no navigation from disabled control");},edit(){assert.fail("no Edit from disabled control");},exit(){assert.fail("no exit from disabled control");},
 });
 const status=new Element(host,null,{tag:"P",status:true}),form=new Element(host,null,{action,tag:"FORM"});
 host.querySelector=selector=>{assert.equal(selector,"[data-experience-status]");return status;};
 const button=new Button(host,action,{tag:"BUTTON"});button.form=form;document.activeElement=button;
 return {host,document,button,form,status,outside,
  setState:value=>{state=value;},setReadable:value=>{readable=value;},setVisible:value=>{visible=value;},
  listeners:()=>[...listeners.values()].reduce((n,a)=>n+a.length,0),
  markup:()=>text(host.render()),control:key=>new Button(host,key),input:()=>{const field=new Input(host,null,{tag:"INPUT"});field.form=form;return field;}};
}
function buttonMarkup(h,key){const button=h.markup().match(new RegExp('<button[^>]*data-experience-control="'+key+'"[^>]*>'));assert.ok(button,key);return button[0];}
for(const key of ["prepare","authorize","run","resumeRun","recoverResult","check","exit"])test("focused busy "+key+" stays natively focusable but unavailable",()=>{
 const h=harness(key);
 if(key==="check"||key==="exit"){h.button.form=undefined;h.button.dataset.experienceControl=key;}
 if(key==="recoverResult")h.button.dataset.experienceAction=key;
 h.host.busy=true;h.host.preserveFocus();
 assert.equal(h.document.activeElement,h.button);assert.equal(h.status.moves,0);
 assert.equal(h.host.buttonDisabled(true,key),false);
 assert.match(buttonMarkup(h,key),/aria-disabled=true/);assert.match(buttonMarkup(h,key),/\?disabled=false/);
 h.document.activeElement=h.outside;h.host.focusOut();
 assert.equal(h.host.buttonDisabled(true,key),true);assert.ok(h.host.updates>0);
 assert.match(buttonMarkup(h,key),/\?disabled=true/);
});
test("other busy buttons remain natively disabled",()=>{
 const h=harness();h.host.busy=true;
 assert.equal(h.host.buttonDisabled(true,"check"),true);assert.equal(h.host.buttonDisabled(true,"exit"),true);
});
for(const action of ["prepare","authorize","run","resumeRun","recoverResult"])test("withdrawn focused "+action+" moves synchronously to stable status before its form disappears",()=>{
 const h=harness(action);if(action==="recoverResult")h.button.dataset.experienceAction=action;
 h.setState({status:"succeeded",output:"image",permitted:{}});
 h.host.preserveFocus();
 assert.equal(h.document.activeElement,h.status);assert.equal(h.status.moves,1);assert.equal(h.listeners(),0);
 h.host.preserveFocus();assert.equal(h.status.moves,1);
});
test("unknown submission retains a focus destination while retiring paid controls",()=>{
 const h=harness();h.setState(null);h.host.preserveFocus();assert.equal(h.document.activeElement,h.status);
});
test("reset confirmation cannot leave focused Check cost disabled",()=>{
 const h=harness("prepare");h.host.confirmed=false;h.host.preserveFocus();assert.equal(h.document.activeElement,h.status);
});
test("cleared approval cannot leave a focused Authorize disabled",()=>{
 const h=harness("authorize");h.host.paidDecision=()=>null;h.host.preserveFocus();assert.equal(h.document.activeElement,h.status);
});
test("a focused checkbox hands off before a command disables it",()=>{
 const h=harness("authorize"),input=h.input();h.document.activeElement=input;h.host.busy=true;
 h.host.preserveFocus();assert.equal(h.document.activeElement,h.status);assert.equal(h.listeners(),0);
});
for(const key of ["check","exit"])test("automatic result arrival does not move focused "+key,()=>{
 const h=harness(),control=h.control(key);h.document.activeElement=control;
 h.setState({status:"succeeded",output:"image",permitted:{}});h.host.result={output:"image",image:{media:{}}};
 h.host.preserveFocus();assert.equal(h.document.activeElement,control);assert.equal(h.status.moves,0);
});
test("mount, outside focus and arbitrary content do not autofocus",()=>{
 const h=harness();h.setState({status:"succeeded",output:"image",permitted:{}});
 for(const element of [h.document.body,h.outside,new Element(h.host,null,{tag:"SUMMARY"})]){
  h.document.activeElement=element;h.host.preserveFocus();assert.equal(h.document.activeElement,element);
 }
 assert.equal(h.status.moves,0);
});
test("hidden/disconnected/retired custody does not restore focus",()=>{
 const h=harness();h.setState(null);h.setReadable(false);h.host.preserveFocus();assert.equal(h.status.moves,0);
 h.setReadable(true);h.button.isConnected=false;h.host.preserveFocus();assert.equal(h.status.moves,0);
});
test("newer focus before lease run prevents handoff",()=>{
 const h=harness();h.setState(null);const add=h.document.addEventListener;
 h.document.addEventListener=(type,fn)=>{add(type,fn);h.document.activeElement=h.outside;};
 h.host.preserveFocus();assert.equal(h.document.activeElement,h.outside);assert.equal(h.status.moves,0);assert.equal(h.listeners(),0);
});
test("passive busy exit click cannot start navigation",()=>{
 const h=harness();h.host.busy=true;const rendered=h.host.render();
 rendered.values.at(-2)();assert.equal(h.document.activeElement,h.button);
});
test("stable status stays outside conditional result/forms and uses global focus-visible styles",()=>{
 const h=harness();assert.match(h.markup(),/<p data-experience-status(?: class=[^ >]*)? tabindex="-1" role="status" aria-live="polite">/);
 assert(source.slice(source.indexOf("  protected override willUpdate()"),source.indexOf("  #model3dText(")).includes("this.#preserveFocus();"));
 assert.match(source,/addEventListener\("focusout", this\.#focusOut\)/);
 assert.match(source,/removeEventListener\("focusout", this\.#focusOut\)/);
 // Actual authority guards are unchanged; aria-disabled never becomes permission.
 for(const guard of ["|| this.#busy || shown !== this.#state()", "|| !this.#visible() || this.#busy", "|| this.#busy || !state.permitted[action]", "if (this.#loading || this.#busy) return;"])assert.ok(source.includes(guard),guard);
});

test('held Video Stop stays focusable, blocks duplicate activation, and transfers/reveals only command-owned focus',async()=>{
 for(const moveAway of [false,true]){
  const h=harness('stop');h.button.form=undefined;h.host.binding.selection.output='video';
  h.setState({output:'video',status:'running',original:{jobId:'original',jobStatus:'running'},permitted:{}});
  let resolveStop,calls=0,reveals=0,active=true;
  const held=new Promise(resolve=>{resolveStop=resolve;}),operation={wait:p=>p};
  Object.assign(h.host,{navigationEpoch:1,updateComplete:Promise.resolve(),baseCurrent:()=>true,beginOperation:()=>operation,operationCurrent:()=>active,
   finishOperation:()=>{active=false;return true;},resetDecision(){},store:{stopDocumentJob(id){assert.equal(id,'original');calls++;return held;}},
   async refreshAndRead(){h.setState({output:'video',status:'cancelled',original:{jobId:'original',jobStatus:'canceled'},permitted:{}});h.host.preserveFocus();},
  });
  h.document.defaultView={innerHeight:400,innerWidth:400,getComputedStyle:()=>({outlineWidth:'2',outlineOffset:'2'})};h.document.elementFromPoint=()=>null;
  h.status.getBoundingClientRect=()=>({width:200,height:30,left:0,right:200,top:500,bottom:530});h.status.contains=e=>e===h.status;h.status.scrollIntoView=()=>{reveals++;};
  const pending=h.host.stopVideo({isTrusted:true});await Promise.resolve();
  assert.equal(h.host.busy,true);assert.equal(h.host.buttonDisabled(true,'stop'),false);assert.match(buttonMarkup(h,'stop'),/aria-disabled=true/);assert.match(buttonMarkup(h,'stop'),/\?disabled=false/);
  await h.host.stopVideo({isTrusted:true});assert.equal(calls,1);
  if(moveAway){h.document.activeElement=h.outside;h.document.emit('focusin',h.outside);}
  resolveStop(true);await pending;
  assert.equal(h.host.busy,false);assert.equal(h.host.status,'Stopped · Charges retained');
  assert.equal(h.document.activeElement,moveAway?h.outside:h.status);assert.equal(reveals,moveAway?0:1);assert.equal(h.listeners(),0);
  assert(!h.markup().includes('data-experience-control="stop"'));
 }
});
