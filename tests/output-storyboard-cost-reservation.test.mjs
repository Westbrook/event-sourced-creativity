import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
const C=process.env.FORMA_SOURCE_ROOT??fileURLToPath(new URL('../',import.meta.url));
const source=readFileSync(process.env.FORMA_STORYBOARD_COST_BASELINE?C+'/worker/events-api.ts':new URL('../worker/events-api.ts',import.meta.url),'utf8');
const policy=readFileSync(C+'/worker/pilot-policy.ts','utf8');
const a=source.indexOf('      const prepaidSceneIds=new Set('),b=source.indexOf('      const batchPresentationBookkeeping=',a);assert(a>0&&b>a);
const g=source.indexOf('      if(costReservationId){const existing=',b),h=source.indexOf('      if(!costReservationId)',g);assert(g>b&&h>g);
const r=policy.indexOf('export async function costBudgetReservation('),t=policy.indexOf('\n}',r)+2;assert(r>0&&t>r);
const readCost=new Function('outputReservationColumns',stripTypeScriptTypes(policy.slice(r,t).replace('export ',''))+';return costBudgetReservation;')(()=>'');
const calculate=new Function('context','return '+stripTypeScriptTypes(`(async()=>{
 const {body,productionPlan,artifactKind,itemCount,requestedAudioSelection,AUDIO_ADAPTER_CONTRACT,requestedVideoSeconds,VIDEO_ADAPTER_CONTRACT,nativeStoryboard,execution}=context;
 ${source.slice(a,b)}
 return estimatedCostMicrousd;
})();`));
const guard=new Function('context','costBudgetReservation','return '+stripTypeScriptTypes(`(async()=>{
 const {env,billingOwnerId,execution,artifactKind,body,storyboardSafeRecovery,streamId,corr,estimatedCostMicrousd,reservationId,reservationCreated,releaseBudget}=context;
 let {costReservationId,costReservationPeriod}=context;let costReservationMicrousd=0,retainedStoryboardCostClaim=false;
 ${source.slice(g,h)}
 return {costReservationMicrousd,costReservationPeriod};
})();`));
const allowance=3678453; // Exact actual R1a/ui-original-first-r2 authorization, not a changed budget.
function context(native=true){return {body:{itemCount:4,costReservationMicrousd:allowance},productionPlan:null,artifactKind:'storyboard',itemCount:4,requestedAudioSelection:null,AUDIO_ADAPTER_CONTRACT:{publishedCostMicrousd:1},nativeStoryboard:native?{}:null,execution:native?{output:{reservations:{costReservationMicrousd:allowance}}}:null};}
function database(){
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE cost_budget_reservations(reservation_id TEXT,owner_id TEXT,status TEXT,stream_id TEXT,correlation_id TEXT,operation TEXT,reserved_microusd INTEGER,period TEXT)');
 const original={reservation_id:'original-cost',owner_id:'owner',status:'active',stream_id:'creative:owner',correlation_id:'original-job:attempt:1',operation:'document-render:storyboard',reserved_microusd:allowance,period:'2026-09'};
 const put=row=>{db.exec('DELETE FROM cost_budget_reservations');if(row)db.prepare('INSERT INTO cost_budget_reservations VALUES(?,?,?,?,?,?,?,?)').run(...Object.values(row));};put(original);
 const env={DB:{prepare:sql=>({bind:(...bindings)=>({first:async()=>db.prepare(sql).get(...bindings)??null})})}};
 return{db,env,put,original};
}
test('native Storyboard actual downstream cost guard uses the original exact five-stage allowance',async()=>{
 const native=context();const estimated=await calculate(native);assert.equal(estimated,allowance);
 assert.equal(await calculate(context(false)),5000000,'Legacy four-frame estimate remains unchanged');
 native.body={...native.body,prepaidProviderCostMicrousd:9999999,productionPrepaidSceneIds:['forged'],productionSceneReceipts:{forged:{sceneId:'forged',costMicrousd:9999999}},productionAnchor:true};assert.equal(await calculate(native),allowance,'Caller prepaid fields do not discount native authorization');
 const forged=context(false);forged.body.outputStoryboard={forged:true};forged.body.costReservationMicrousd=1;assert.equal(await calculate(forged),5000000,'Raw body marker cannot select native pricing');
 const f=database();try{
  const actual=await guard({...context(),env:f.env,billingOwnerId:'owner',streamId:'creative:owner',corr:'original-job:attempt:1',costReservationId:'original-cost',costReservationPeriod:'2026-09',estimatedCostMicrousd:estimated,storyboardSafeRecovery:null,reservationCreated:false},readCost);
  assert.deepEqual(actual,{costReservationMicrousd:allowance,costReservationPeriod:'2026-09'});
 }finally{f.db.close();}
 assert(source.includes('parseStoryboardOutputContract(execution.output.settings.outputStoryboard)'));
 assert(source.includes('checkpoint:')||source.includes('retainStoryboardFrameRequest'));
});
test('native Storyboard downstream original owner/status/period/correlation/amount and underfunding checks still reject',async()=>{
 const f=database();try{
  for(const mutate of [r=>r.owner_id='foreign',r=>r.status='released',r=>r.status='executing',r=>r.stream_id='foreign',r=>r.correlation_id='foreign',r=>r.operation='document-render:audio',r=>r.period='2026-08',r=>r.reserved_microusd--,r=>r.reserved_microusd++]){
   const row={...f.original};mutate(row);f.put(row);
   const result=await guard({...context(),env:f.env,billingOwnerId:'owner',streamId:'creative:owner',corr:'original-job:attempt:1',costReservationId:'original-cost',costReservationPeriod:'2026-09',estimatedCostMicrousd:allowance,storyboardSafeRecovery:null,reservationCreated:false},readCost);
   assert(result instanceof Response);assert.equal(result.status,409);assert.equal((await result.json()).error,'cost_reservation_invalid_or_expired');
  }
  for(const invalid of [0,-1,NaN,Infinity,1.5]){const c=context();c.execution.output.reservations.costReservationMicrousd=invalid;const result=await calculate(c);assert(result instanceof Response);assert.equal(result.status,409);assert.equal((await result.json()).error,'output_storyboard_admitted_allowance_invalid');}
 }finally{f.db.close();}
});
