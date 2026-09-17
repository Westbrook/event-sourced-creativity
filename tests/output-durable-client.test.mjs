import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import ts from 'typescript';
import { hasServerExecutionOwner, readOutputDurableObservation } from '../src/model/output-durable-observation.ts';
const source=fs.readFileSync(new URL('../src/components/forma-experience-host.ts',import.meta.url),'utf8');
const tree=ts.createSourceFile('host.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const host=tree.statements.find(node=>ts.isClassDeclaration(node)&&node.name.text==='FormaExperienceHost');
const names=['#attachObservation','#observationMatches','#resumeObservation','#observationPending','#visibility','#suspendObservation','#pagehide','#pageshow','#scheduleResultRead','#statusLabel','#refreshAndRead','#command','#beginOperation','#extendObservationGrace'];
const body=host.members.filter(node=>names.includes(node.name?.getText(tree))).map(node=>node.getText(tree).replaceAll('#','')).join('\n');
assert.equal(host.members.filter(node=>names.includes(node.name?.getText(tree))).length,names.length);
// Actual host method bodies, deterministic DOM/timer ports. No claim of real
// BFCache, browser suspension, transport, or paid-provider acceptance evidence.
function fixture(){
 const timers=[],checks=[],loads=[];
 const Class=new Function('setTimeout','hasServerExecutionOwner','retainedImageSourceMessage','ExperienceHostOperation',ts.transpile(`class Harness{${body}}`,{target:ts.ScriptTarget.ES2022})+';return Harness;')((callback,delay)=>{timers.push({callback,delay});return timers.length;},hasServerExecutionOwner,()=>"changed",class {constructor(expire){this.expire=expire;}wait(p){return p;}cancel(){} });
 const h=new Class(),binding={client:{identity:{output:'image'},dispose(){},read:async()=>{},command:async()=>({status:'unavailable'})},store:{attentionPublication:{settled:async()=>{}}},plan:{documentId:'doc'}};
 Object.assign(h,{binding,navigationEpoch:0,isConnected:true,ownerDocument:{visibilityState:'visible'},busy:false,loading:false,retired:false,
  captureCommandFocusVisibility:()=>null,finishOperation:()=>true,readable:()=>!h.retired&&h.ownerDocument.visibilityState!=='hidden',visible:()=>true,check:async()=>checks.push('GET'),load:async()=>loads.push('read-only load'),stopResultRead(){h.resultRead=undefined;},
  resetDecision(){},clearResult(){h.result=undefined;},requestUpdate(){},retire(){h.retired=true;h.observationAttachment=undefined;},
  i18n:{system:x=>x,t:(_key,fallback)=>fallback},state:()=>h.currentState,current:()=>true,baseCurrent:()=>true,operationCurrent:()=>true,scheduleDeadline(){},
  store:{refreshEvents:async()=>{},documentGenerationRevision:()=>"revision",experienceDocumentSourceCurrent:()=>true}});
 return{h,binding,timers,checks,loads};
}
const original=()=>({jobId:'job',grantId:'grant',slotId:'slot',jobStatus:'queued',jobExpiresAt:new Date(Date.now()+300000).toISOString(),run:null});
const state=()=>({status:'authorized',current:{source:'verified'},original:original(),permitted:{}});
test('ownership restricts unknown owners and observation decoder rejects unknown fields/phases',()=>{
 assert.equal(hasServerExecutionOwner({executionOwner:'future-runner'}),true);assert.equal(hasServerExecutionOwner({}),false);
 assert.deepEqual(readOutputDurableObservation({version:1,phase:'retaining',revision:3}),{version:1,phase:'retaining',revision:3});
 for(const value of [{version:2,phase:'queued',revision:1},{version:1,phase:'new',revision:1},{version:1,phase:'queued',revision:-1},{version:1,phase:'queued',revision:1,token:'secret'}])assert.equal(readOutputDurableObservation(value),null);
});
test('lost ACK observes before Run commits and after a transient unavailable read with GET only',async()=>{
 const {h,binding,timers,checks}=fixture();h.currentState=state();h.attachObservation(binding,h.currentState,true);
 await h.refreshAndRead(binding,{wait:p=>p});assert.ok(h.observationAttachment,'authorized read does not resolve in-flight Run');
 h.scheduleResultRead();assert.equal(timers.length,1);assert.ok(timers[0].delay<=2000);timers[0].callback();assert.deepEqual(checks,['GET']);
 h.currentState=null;h.scheduleResultRead();assert.equal(timers.length,2);timers[1].callback();assert.deepEqual(checks,['GET','GET']);
 h.observationAttachment={...h.observationAttachment,until:Date.now()-1};h.scheduleResultRead();assert.equal(timers.length,2);
});
test('durable attachment pins original while acknowledged legacy Run permits later replacement',async()=>{
 const {h,binding}=fixture();h.currentState=state();h.attachObservation(binding,h.currentState,true);
 h.currentState.original.run={key:'run',eventId:'event'};await h.refreshAndRead(binding,{wait:p=>p});assert.equal(h.observationAttachment,undefined);
 h.currentState.original.executionOwner='durable';h.currentState.original.observation={version:1,phase:'generating',revision:2};await h.refreshAndRead(binding,{wait:p=>p});assert.ok(h.observationAttachment);
 h.currentState={...h.currentState,original:{...h.currentState.original,jobId:'foreign'}};await assert.rejects(()=>h.refreshAndRead(binding,{wait:p=>p}),/original_changed/);
});
test('visibility/online/BFCache restore observations but real retirement cannot restart',()=>{
 const {h,binding,checks}=fixture();h.attachObservation(binding,state(),true);
 h.ownerDocument.visibilityState='hidden';h.visibility();assert.deepEqual(checks,[]);h.ownerDocument.visibilityState='visible';h.visibility();assert.deepEqual(checks,['GET']);
 h.pagehide({persisted:true});assert.equal(h.retired,false);h.pageshow({persisted:true});assert.deepEqual(checks,['GET','GET']);
 h.pagehide({persisted:false});h.resumeObservation();assert.equal(h.retired,true);assert.deepEqual(checks,['GET','GET']);
});
test('interrupted first read resumes and absent attachment is not a BFCache lifetime',()=>{
 const {h,loads}=fixture();h.binding=undefined;h.loading=true;h.suspendObservation();h.resumeObservation();assert.deepEqual(loads,['read-only load']);
 h.pagehide({persisted:true});assert.equal(h.retired,true);
});
test('retaining and uncertainty use canonical phase rather than stale job labels',()=>{
 const {h}=fixture();for(const [phase,label] of [['retaining','Saving'],['uncertain','Unconfirmed'],['awaiting_provider','Result pending']]){
 const s=state();s.original.executionOwner='durable';s.original.observation={version:1,phase,revision:1};assert.equal(h.statusLabel(s),label);
 }
});

test('actual Run command schedules GET after an unavailable acknowledgment',async()=>{
 const {h,timers}=fixture();h.currentState=state();await h.command('run',h.currentState);
 assert.ok(h.observationAttachment);assert.equal(timers.length,1,'command finally schedules observation without needing another visibility event');
});
test('actual operation timeout resumes observation after clearing its operation owner',()=>{
 const {h,binding,timers}=fixture();h.currentState=state();h.attachObservation(binding,h.currentState,true);
 h.observationAttachment={...h.observationAttachment,until:Date.now()-1};
 const operation=h.beginOperation({action:'run',output:'image'});operation.expire();
 assert.equal(h.operation,undefined);assert.equal(timers.length,1);
});
