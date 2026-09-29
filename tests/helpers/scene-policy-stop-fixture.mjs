import assert from "node:assert/strict";
import { createPilotSceneFixture, pendingCheckpoint } from "./scene-pilot-fixture.mjs";

/** The same routed queue/claim/observer used in production; this helper never stubs execution or authorization. */
export function policyMutation(f,mutate,{boundary="pending",at=1}={}) {
  const seen=new Set();let changed=false;
  f.controls.beforeRun=async statement=>{
    if(changed||!statement.sql.startsWith("UPDATE document_jobs SET result_json="))return;
    if(boundary==="after-claim"){
      if(f.cost()[0]?.status!=="executing")return;
    }else{
      const pending=pendingCheckpoint(statement)?.entries.find(entry=>entry.status==="pending");if(!pending||seen.has(pending.clientRequestId))return;
      seen.add(pending.clientRequestId);if(seen.size!==at)return;
    }
    changed=true;await mutate();
  };
  return{get changed(){return changed;},get seen(){return seen.size;}};
}
export const policyFinancialSnapshot=f=>Object.fromEntries([
  "budget_reservations","cost_budget_reservations","budget_counters","cost_budget_counters","project_budget_reservation_scopes","pilot_cost_reservation_scopes",
].map(table=>[table,f.sqlite.prepare("SELECT * FROM "+table+" ORDER BY rowid").all()]));
export const policyOriginalRow=f=>f.sqlite.prepare("SELECT * FROM document_jobs WHERE job_id=?").get(f.requestId);
export function policyWitnessRow(f){
  return f.sqlite.prepare("SELECT secret.* FROM event_private_payloads secret JOIN events event ON event.event_id=secret.private_event_id WHERE event.correlation_id=? AND event.type='BudgetReleased'").get(f.requestId+":attempt:1");
}
export function updatePolicyWitness(f,change){
  const row=policyWitnessRow(f),payload=JSON.parse(row.private_json);change(payload);
  f.sqlite.prepare("UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?").run(JSON.stringify(payload),row.private_event_id);
}
export function updatePolicyCheckpoint(f,change){
  const value=f.checkpoint();change(value);f.sqlite.prepare("UPDATE document_jobs SET result_json=? WHERE job_id=?").run(JSON.stringify(value),f.requestId);
}
export const policyFinalRead=statement=>statement.sql.startsWith("SELECT 1 AS current WHERE")&&statement.sql.includes("json_array(job_id,owner_id")
  &&statement.sql.includes("json_group_array(json_array(event_id")&&statement.sql.includes("project_budget_reservation_scopes");
export async function setPolicyCohort(f,status){
  const result=await f.asOwner("/api/workspaces/"+f.sharing.organizationId+"/pilot",{...f.json({status}),method:"PATCH"});
  assert.equal(result.status,200,await result.clone().text());return result;
}
export async function createPolicyStoppedSceneFixture({boundary="pending",at=1,mutate,...options}={}){
  const f=await createPilotSceneFixture(options);
  try{
    const originalPreview=await f.admit();
    const transition=policyMutation(f,()=>mutate?mutate(f):setPolicyCohort(f,"paused"),{boundary,at});
    const stopped=await f.run();f.controls.beforeRun=null;
    assert.equal(transition.changed,true,"the actual claimed/pending checkpoint was reached");
    assert.equal(stopped.body.job.status,"failed",JSON.stringify(stopped.body));
    return Object.assign(f,{originalPreview,stopped,transition});
  }catch(error){f.close();throw error;}
}
