// Shared H3/H4 outstanding-purchase inventory. Optional preparation schema must match exactly.
import {schemaRows} from './schema-contract.mjs';
const baseGuard=owner=>({sql:`NOT EXISTS(SELECT 1 FROM cost_budget_reservations WHERE owner_id=? AND status IN('authorizing','active','executing') AND reservation_id NOT IN(SELECT lifecycle_reservation_id FROM generation_study_operations WHERE lifecycle_reservation_id IS NOT NULL AND status='completed'))
 AND NOT EXISTS(SELECT 1 FROM budget_reservations WHERE owner_id=? AND status IN('authorizing','active'))
 AND NOT EXISTS(SELECT 1 FROM output_provider_calls c JOIN output_execution_grants g ON g.scope_key=c.scope_key AND g.grant_id=(SELECT grant_id FROM output_operation_slots s WHERE s.scope_key=c.scope_key AND s.slot_id=c.slot_id) WHERE g.payer_user_id=? AND c.status NOT IN('settled','rejected'))
 AND NOT EXISTS(SELECT 1 FROM document_jobs WHERE owner_id=? AND (status IN('queued','running','committing') OR json_extract(result_json,'$.providerSubmissionLegacyUncertain')=1 OR json_extract(result_json,'$.model3dProviderSubmission')='pending' OR EXISTS(SELECT 1 FROM json_each(COALESCE(json_extract(result_json,'$.providerSubmissions'),'{}')) WHERE (json_extract(value,'$.status') IS NULL OR json_extract(value,'$.status') NOT IN('completed','rejected') OR json_extract(value,'$.accountingState')='unknown' OR json_extract(value,'$.status')='completed' AND COALESCE(json_type(value,'$.costMicrousd'),'missing') NOT IN('integer','real'))))) AND NOT EXISTS(SELECT 1 FROM consequential_execution_steps s JOIN consequential_executions e USING(execution_id) WHERE e.actor_user_id=? AND s.status NOT IN('settled','not-submitted'))`,bindings:[owner,owner,owner,owner,owner]});

export async function preparationGuards(db,owner){
 const query="SELECT type,name,tbl_name,sql FROM main.sqlite_schema WHERE name GLOB 'generation_preparation_*' ORDER BY name";
 const r=await db.prepare(query).all();
 if(r.success!==true)throw Error('preparation_schema_unavailable');
 if(r.results.length===0)return {installed:false,identity:[],holds:[]};
 if(JSON.stringify(r.results)!==JSON.stringify(schemaRows))throw Error('preparation_schema_uninstalled');
 return {installed:true,identity:[{sql:`(SELECT json_group_array(json_object('type',type,'name',name,'tbl_name',tbl_name,'sql',sql)) FROM (${query}))=?`,bindings:[JSON.stringify(schemaRows)]}],holds:[{sql:'NOT EXISTS(SELECT 1 FROM generation_preparation_lifecycle_holds WHERE owner_id=?)',bindings:[owner]}]};
}
export async function externalGuard(db,owner,pair=null,strict=false){
 const guard=baseGuard(owner);
 if(pair){
  // Only a server-validated exact pair may name these operations. Admission also proves
  // generation_study_pair_eligible in the same transaction; ordinary callers pass null.
  const cost="SELECT cost_reservation_id FROM generation_study_operations WHERE owner_id=? AND operation_id IN(?,?) UNION SELECT lifecycle_reservation_id FROM generation_study_operations WHERE owner_id=? AND operation_id IN(?,?) AND lifecycle_reservation_id IS NOT NULL";
  const token="SELECT token_reservation_id FROM generation_study_operations WHERE owner_id=? AND operation_id IN(?,?)";
  guard.sql=guard.sql.replace("AND status IN('authorizing','active','executing')",`AND status IN('authorizing','active','executing') AND reservation_id NOT IN(${cost})`).replace("AND status IN('authorizing','active'))",`AND status IN('authorizing','active') AND reservation_id NOT IN(${token}))`);
  guard.bindings=[owner,owner,...pair.ids,owner,...pair.ids,owner,owner,...pair.ids,owner,owner,owner];
 }
 if(strict)guard.sql=guard.sql.replace("status IN('authorizing','active','executing')","status NOT IN('settled','released')");
 const prep=await preparationGuards(db,owner);
 if(prep.installed)guard.sql=guard.sql.replace("AND status='completed'))","AND status='completed' UNION SELECT lifecycle_reservation_id FROM generation_preparation_operations WHERE lifecycle_reservation_id IS NOT NULL AND status='completed'))");
 return guard;
}
