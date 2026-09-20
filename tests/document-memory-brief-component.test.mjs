import {documentViewFromRoute,documentContextBlockFromRoute} from '../src/model/routes.ts';
// Actual component class and real Lit templates, finite Store/visibility/lease
// ports. Browser rendering is separately exercised by forma-memory-purposes.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {html,nothing} from 'lit';
import {createMemoryElapsed} from '../src/model/memory-lifetime.ts';
import {parseMemoryCustody} from '../src/model/memory-custody.ts';
import {personalMemoryMessage} from '../src/components/design-system/locales/personal-memory-messages.ts';
const source=ts.createSourceFile('document-memory-brief.ts',readFileSync(new URL('../src/components/document-memory-brief.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
const declaration=source.statements.find(node=>ts.isClassDeclaration(node)&&node.name?.text==='DocumentMemoryBrief');assert.ok(declaration);
const compiled=ts.transpileModule(declaration.getText(source).replace(/^export /u,''),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,useDefineForClassFields:false}}).outputText;
const savedSource=ts.createSourceFile('memory-assistant-context.ts',readFileSync(new URL('../src/components/memory-assistant-context.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
const savedDeclaration=savedSource.statements.find(node=>ts.isClassDeclaration(node)&&node.name?.text==='MemoryAssistantContext');assert.ok(savedDeclaration);
const savedCompiled=ts.transpileModule(savedDeclaration.getText(savedSource).replace(/^export /u,''),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,useDefineForClassFields:false}}).outputText;
const flatten=value=>typeof value==='string'?value:Array.isArray(value)?value.map(flatten).join(''):value?.strings?value.strings.map((part,i)=>part+flatten(value.values[i])).join(''):'';
const flush=async()=>{for(let i=0;i<4;i++)await Promise.resolve();};
function fixture(t,{deferred=false,shared=false,saved=false,profile=false}={}){
  let privacyPending=false;
  const window=new EventTarget(),document=new EventTarget();document.visibilityState='visible';document.activeElement=null;
  let session={user:{userId:'actor'},projects:[],impersonation:null},route='/document/doc/doc',authorization='auth',generation=1,sourceActive=true;
  let projection={projectId:'project',documentId:'doc',documents:[{id:'doc',projectId:'project',createdSequence:1,sourceEvents:['original']}]};
  if(shared){session.projectContext={organizationId:'org',projectId:'project',projectAccessId:'access',ownerUserId:'owner'};session.projects=[{...session.projectContext}];}
  const store={session:{get:()=>session},projection:{get:()=>projection},route:{get:()=>route},captureAuthorizationScope:()=>({key:authorization}),authorizationScopeActive:scope=>scope.key===authorization,
    captureSourceOwnership:()=>({generation}),sourceOwnershipActive:source=>sourceActive&&source.generation===generation,guardedFetch:()=>{throw Error('No HTTP in component-port fixture');}};
  let focused=0;const refresh={focus:()=>{focused++;}};const timers=new Map();let nextTimer=0;
  class Base {store=store;i18n={locale:'en'};isConnected=true;ownerDocument=document;updateComplete=Promise.resolve();updates=0;
    connectedCallback(){}disconnectedCallback(){}requestUpdate(){this.updates++;}contains(node){return node?.inside===true;}querySelector(){return refresh;}}
  const calls=[];const capture=(selection,transport,current,signal)=>new Promise(resolve=>{let retired=false;
    const value={projectId:'project',documentId:'doc',validUntil:new Date(Date.now()+45000).toISOString(),completeHistory:false,independentEvidence:false,
      sections:[{purpose:'rolling-summary',jobId:'job',corrections:[],items:[{text:'Private native candidate',citationStatus:'support-cited',supports:[{text:'Original quotation'}],counterevidence:[]}]}]};
    if(profile)value.sections=[{purpose:'profile',jobId:null,corrections:[],retainedProfile:{results:16,complete:false,nextAfter:'a'.repeat(64),historicalPage:Boolean(selection.profileAfter)},items:Array.from({length:256},(_,index)=>({text:'Profile note '+index,citationStatus:'support-cited',supports:[],counterevidence:[],profileOrigin:{jobId:'result-'+Math.floor(index/16),state:index<16?'latest':'historical',repeatedIn:1,sharedEvidence:false,interpretation:index<16?'current':'revised',newerInterpretationJobId:index<16?null:'result-0',counterevidence:index%2===0}}))}];
    const lease={current:()=>!retired&&current()?value:null,retire:()=>{retired=true;}};calls.push({selection,current,signal,resolve:()=>resolve(lease),retired:()=>retired});if(!deferred)resolve(lease);});
  const savedClient=()=>({read:(scope,signal)=>new Promise(resolve=>{calls.push({scope,signal,resolve:()=>resolve({validUntil:new Date(Date.now()+25000).toISOString(),context:{state:'accepted',source:{documentId:'doc',zoom:'document'}},presentation:{items:[{text:'Private native candidate'}]}})});if(!deferred)calls.at(-1).resolve();})});
  const Component=saved?new Function('memoryPrivacyMutationActive','FormaElement','html','nothing','createAssistantMemoryContextClient','parseMemoryCustody','personalMemoryMessage','createMemoryElapsed','window','setTimeout','clearTimeout',savedCompiled+'\nreturn MemoryAssistantContext;')(()=>privacyPending,Base,html,nothing,savedClient,parseMemoryCustody,personalMemoryMessage,createMemoryElapsed,window,callback=>{const id=++nextTimer;timers.set(id,callback);return id;},id=>timers.delete(id)):new Function('documentViewFromRoute','documentContextBlockFromRoute','memoryPrivacyMutationActive','FormaElement','html','nothing','readDocumentMemoryBrief','parseMemoryCustody','personalMemoryMessage','window','setTimeout','clearTimeout',compiled+'\nreturn DocumentMemoryBrief;')(
    documentViewFromRoute,documentContextBlockFromRoute,()=>privacyPending,Base,html,nothing,capture,parseMemoryCustody,personalMemoryMessage,window,callback=>{const id=++nextTimer;timers.set(id,callback);return id;},id=>timers.delete(id));
  const element=new Component();element.connectedCallback();element.updated();t.after(()=>{element.isConnected=false;element.disconnectedCallback();});
  return {click:(label)=>{const visit=value=>{if(Array.isArray(value))return value.some(visit);if(!value?.values)return false;if(value.values.includes(label)){const action=value.values.find(v=>typeof v==='function');if(action){action();return true;}}return value.values.some(visit);};assert.ok(visit(element.render()),'Button exists: '+label);},privacy:(value)=>{privacyPending=value;window.dispatchEvent(new Event('forma-memory-privacy-mutation'));},element,calls,document,window,timers,refresh,text:()=>flatten(element.render()),focused:()=>focused,
    change:(kind)=>{if(kind==='route')route='/elsewhere';if(kind==='actor')session={...session,user:{userId:'another'}};
      if(kind==='auth')authorization='changed';if(kind==='source')generation++;if(kind==='retired-source')sourceActive=false;
      if(kind==='impersonation')session={...session,impersonation:{userId:'other'}};if(kind==='locale')element.i18n.locale='ar';
      if(kind==='document')projection={...projection,documentId:'other'};if(kind==='revision')projection.documents[0].sourceEvents.push('edit');
      if(kind==='custody')session={...session,projects:[{projectId:'project',organizationId:'unselected',projectAccessId:'other'}]};
      if(kind==='store')element.store={...store};if(kind==='disconnect'){element.isConnected=false;element.disconnectedCallback();}}};
}
for(const shared of [false,true])test('automatic brief component begins only a scope-bound read shared='+shared,async t=>{
  const f=fixture(t,{shared});await flush();assert.equal(f.calls.length,1);assert.match(f.text(),/Private native candidate/);
  assert.equal(f.calls[0].selection.custody.kind,shared?'organization':'personal');f.element.updated();assert.equal(f.calls.length,1);
});
for(const boundary of ['route','actor','auth','source','retired-source','impersonation','locale','document','revision','custody','store','disconnect'])test('automatic brief component retires rendering across '+boundary,async t=>{
  const f=fixture(t);await flush();assert.match(f.text(),/Private native candidate/);f.change(boundary);assert.doesNotMatch(f.text(),/Private native candidate/);
  f.element.updated();assert.equal(f.calls[0].signal.aborted,true);
});
for(const event of ['blur','pagehide','visibilitychange'])test('automatic brief clears private DOM on '+event,async t=>{
  const f=fixture(t);await flush();if(event==='visibilitychange'){f.document.visibilityState='hidden';f.document.dispatchEvent(new Event(event));}else f.window.dispatchEvent(new Event(event));
  assert.doesNotMatch(f.text(),/Private native candidate/);assert.equal(f.calls[0].signal.aborted,true);assert.equal(f.calls[0].retired(),true);assert.equal(f.timers.size,0);
});
test('automatic brief never publishes a late old-scope response',async t=>{
  const f=fixture(t,{deferred:true});f.change('route');f.element.updated();assert.equal(f.calls.length,2);f.calls[0].resolve();await flush();assert.doesNotMatch(f.text(),/Private native candidate/);assert.equal(f.calls[0].retired(),true);
  f.calls[1].resolve();await flush();assert.match(f.text(),/Private native candidate/);
});
test('brief expiry clears quotes, restores in-card focus to Refresh and does not poll',async t=>{
  const f=fixture(t);await flush();f.document.activeElement={inside:true};[...f.timers.values()][0]();await flush();
  assert.doesNotMatch(f.text(),/Private native candidate|Original quotation/);assert.match(f.text(),/Private notes cleared/);assert.equal(f.focused(),1);
  f.element.updated();assert.equal(f.calls.length,1);
});
test('a stale expiry callback cannot clear a new document lease or steal focus',async t=>{
  const f=fixture(t);await flush();const expire=[...f.timers.values()][0];f.change('route');f.element.updated();await flush();expire();await flush();
  assert.match(f.text(),/Private native candidate/);assert.equal(f.focused(),0);
});

for(const boundary of ['route','actor','auth','source','retired-source','impersonation','locale','document','revision','custody','store','disconnect'])test('saved semantic context component retires across '+boundary,async t=>{
 const f=fixture(t,{saved:true});await flush();assert.match(f.text(),/Private native candidate/);f.change(boundary);assert.doesNotMatch(f.text(),/Private native candidate/);
 f.element.updated();assert.equal(f.calls[0].signal.aborted,true);
});
for(const event of ['blur','pagehide','visibilitychange'])test('saved semantic context clears private presentation on '+event,async t=>{
 const f=fixture(t,{saved:true});await flush();if(event==='visibilitychange'){f.document.visibilityState='hidden';f.document.dispatchEvent(new Event(event));}else f.window.dispatchEvent(new Event(event));
 assert.doesNotMatch(f.text(),/Private native candidate/);assert.equal(f.calls[0].signal.aborted,true);assert.equal(f.timers.size,0);
});
test('saved semantic context rejects late old-scope data and retires on expiry without polling',async t=>{
 const f=fixture(t,{saved:true,deferred:true});f.change('route');f.element.updated();f.calls[0].resolve();await flush();assert.doesNotMatch(f.text(),/Private native candidate/);
 f.calls[1].resolve();await flush();assert.match(f.text(),/Private native candidate/);f.document.activeElement={inside:true};[...f.timers.values()][0]();await flush();
 assert.doesNotMatch(f.text(),/Private native candidate/);assert.equal(f.focused(),1);f.element.updated();assert.equal(f.calls.length,2);
});

for(const saved of [false,true])test('privacy mutation clears displayed notes and reads only after settlement saved='+saved,async t=>{
 const f=fixture(t,{saved});await flush();assert.match(f.text(),/Private native candidate/);
 f.privacy(true);assert.doesNotMatch(f.text(),/Private native candidate/);assert.equal(f.calls[0].signal.aborted,true);assert.equal(f.timers.size,0);
 f.element.updated();f.window.dispatchEvent(new Event('focus'));assert.equal(f.calls.length,1);
 f.privacy(false);await flush();assert.equal(f.calls.length,2);assert.match(f.text(),/Private native candidate/);
});
for(const saved of [false,true])test('privacy mutation rejects a late read and cannot reopen a hidden consumer saved='+saved,async t=>{
 const f=fixture(t,{saved,deferred:true});f.privacy(true);f.calls[0].resolve();await flush();assert.doesNotMatch(f.text(),/Private native candidate/);
 f.window.dispatchEvent(new Event('blur'));f.privacy(false);f.element.updated();assert.equal(f.calls.length,1);
 f.window.dispatchEvent(new Event('focus'));assert.equal(f.calls.length,2);f.calls[1].resolve();await flush();assert.match(f.text(),/Private native candidate/);
});

test('retained profile mounts one reference control per source result, not one per repeated claim',async t=>{
 const f=fixture(t,{profile:true});await flush();
 assert.equal((f.text().match(/<forma-memory-assistant-context /gu)??[]).length,16);
 for(const i of [0,15,16,31,32,47,48,63,127,255])assert.match(f.text(),new RegExp('Profile note '+i));
});

for(const locale of ['en','fr','ar','ja'])test('profile change and counterevidence disclosure remains localized '+locale,async t=>{
 const f=fixture(t,{profile:true});f.element.i18n.locale=locale;f.element.updated();await flush();
 assert.ok(f.text().includes(personalMemoryMessage(locale,'memory.live.profileRevised')));
 assert.ok(f.text().includes(personalMemoryMessage(locale,'memory.live.profileCitedConflict')));
 assert.doesNotMatch(f.text(),/memory.live.profile(?:Revised|CitedConflict)/);
 f.privacy(true);assert.doesNotMatch(f.text(),/Profile note/);
});


test('explicit older-profile navigation discards the old lease and resets on privacy or scope changes',async t=>{
 const f=fixture(t,{profile:true});await flush();
 f.click(personalMemoryMessage('en','memory.live.profileOlder'));await flush();
 assert.equal(f.calls.length,2);assert.equal(f.calls[0].signal.aborted,true);assert.equal(f.calls[0].retired(),true);
 assert.equal(f.calls[1].selection.profileAfter,'a'.repeat(64));
 assert.ok(f.text().includes(personalMemoryMessage('en','memory.live.profileHistoryPage')));
 f.click(personalMemoryMessage('en','memory.live.briefRefresh'));await flush();assert.equal(f.calls[2].selection.profileAfter,null);
 f.click(personalMemoryMessage('en','memory.live.profileOlder'));await flush();
 f.change('locale');f.element.updated();await flush();assert.equal(f.calls.at(-1).selection.profileAfter,null);
 f.privacy(true);assert.doesNotMatch(f.text(),/Profile note/);
 f.privacy(false);await flush();assert.equal(f.calls.at(-1).selection.profileAfter,null);
});
