import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const migrationDirectory=new URL("../drizzle/",import.meta.url);
const BASELINE_TAG="0019_authoring_commits";
const ASSISTANT_TABLES=["assistant_turns","assistant_action_proposals","assistant_action_commits","assistant_specialist_tasks","assistant_billing_reconciliations"];
// Exact pre-consent runtime DDL from worker/assistant-api.ts at the 0019 baseline.
// This is only the existing-installation fixture; every upgrade executes real journaled SQL.
const LEGACY_ASSISTANT_DDL=[
  "CREATE TABLE IF NOT EXISTS assistant_turns (turn_id TEXT NOT NULL, actor_user_id TEXT NOT NULL, scope_key TEXT NOT NULL, organization_id TEXT, project_access_id TEXT, project_id TEXT, document_id TEXT, route_family TEXT NOT NULL, user_content_ref TEXT NOT NULL, assistant_content_ref TEXT NOT NULL, proposal_json TEXT, permission_epoch TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT NOT NULL, PRIMARY KEY(actor_user_id,scope_key,turn_id))",
  "CREATE INDEX IF NOT EXISTS idx_assistant_turns_actor_scope ON assistant_turns(actor_user_id,scope_key,created_at)",
  "CREATE TABLE IF NOT EXISTS assistant_action_proposals (proposal_id TEXT PRIMARY KEY NOT NULL,actor_user_id TEXT NOT NULL,scope_key TEXT NOT NULL,turn_id TEXT NOT NULL,organization_id TEXT,project_access_id TEXT,project_id TEXT NOT NULL,document_id TEXT NOT NULL,action_kind TEXT NOT NULL,action_content_ref TEXT NOT NULL,source_versions_json TEXT NOT NULL,expected_head INTEGER NOT NULL,permission_epoch TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,expires_at TEXT NOT NULL,resolved_at TEXT)",
  "CREATE INDEX IF NOT EXISTS idx_assistant_proposals_actor_scope ON assistant_action_proposals(actor_user_id,scope_key,status,created_at)",
  "CREATE TABLE IF NOT EXISTS assistant_action_commits(commit_id TEXT PRIMARY KEY NOT NULL,verified INTEGER NOT NULL CHECK(verified=1),created_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS assistant_specialist_tasks(task_id TEXT PRIMARY KEY NOT NULL,actor_user_id TEXT NOT NULL,scope_key TEXT NOT NULL,turn_id TEXT NOT NULL,organization_id TEXT,project_access_id TEXT,project_id TEXT,document_id TEXT,route_family TEXT NOT NULL,task_kind TEXT NOT NULL,selected_model TEXT NOT NULL,token_reservation_id TEXT NOT NULL,cost_reservation_id TEXT NOT NULL,estimated_microusd INTEGER NOT NULL,maximum_input_tokens INTEGER NOT NULL,maximum_output_tokens INTEGER NOT NULL,locale TEXT NOT NULL,permission_epoch TEXT NOT NULL,status TEXT NOT NULL,error_code TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,started_at TEXT,completed_at TEXT,lease_expires_at TEXT,provider_submitted INTEGER NOT NULL DEFAULT 0,UNIQUE(actor_user_id,scope_key,turn_id,task_kind))",
  "CREATE INDEX IF NOT EXISTS idx_assistant_tasks_actor_scope ON assistant_specialist_tasks(actor_user_id,scope_key,status,created_at)",
  "CREATE TABLE IF NOT EXISTS assistant_billing_reconciliations(reconciliation_id TEXT PRIMARY KEY NOT NULL,task_id TEXT NOT NULL,actor_user_id TEXT NOT NULL,reviewer_user_id TEXT NOT NULL,organization_id TEXT,project_access_id TEXT,evidence_classification TEXT NOT NULL CHECK(evidence_classification='verified-no-provider-charge'),occurred_at TEXT NOT NULL,UNIQUE(task_id,reviewer_user_id))",
  "CREATE INDEX IF NOT EXISTS idx_assistant_billing_reconciliations_actor_scope ON assistant_billing_reconciliations(actor_user_id,organization_id,project_access_id,occurred_at)",
  "CREATE TRIGGER IF NOT EXISTS assistant_billing_reconciliation_block_update BEFORE UPDATE ON assistant_billing_reconciliations BEGIN SELECT RAISE(ABORT,'assistant billing audit is append-only'); END",
  "CREATE TRIGGER IF NOT EXISTS assistant_billing_reconciliation_block_delete BEFORE DELETE ON assistant_billing_reconciliations BEGIN SELECT RAISE(ABORT,'assistant billing audit is append-only'); END"
];

const identifier=value=>'"'+String(value).replaceAll('"','""')+'"';
const normalizeSql=sql=>sql.replace(/["\x60\[\]]/gu,"").replace(/\s+/gu," ").trim();
function actualMigrations(){
 const journal=JSON.parse(readFileSync(new URL("meta/_journal.json",migrationDirectory),"utf8"));
 assert.equal(journal.dialect,"sqlite");assert.ok(Array.isArray(journal.entries));
 const files=readdirSync(migrationDirectory).filter(name=>/^\d+_.+\.sql$/u.test(name)).sort();
 assert.deepEqual(journal.entries.map(entry=>entry.tag+".sql").sort(),files,"Every actual SQL file must be journaled; a snapshot or orphan file is not an applied migration");
 const entries=journal.entries.map((entry,index)=>{
  assert.equal(entry.idx,index,"Migration order is contiguous and follows the real journal");
  const file=entry.tag+".sql";return{...entry,file,sql:readFileSync(new URL(file,migrationDirectory),"utf8")};
 });
 assert.ok(entries.some(entry=>entry.tag===BASELINE_TAG),"The real 0019 baseline must remain present");
 return entries;
}
function consentMigrationPlan(){
 const entries=actualMigrations(),baseline=entries.findIndex(entry=>entry.tag===BASELINE_TAG);
 const declarations=entries.filter(entry=>ASSISTANT_TABLES.every(table=>new RegExp("\\bCREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?"+table+"\\b","iu").test(normalizeSql(entry.sql))));
 assert.equal(declarations.length,1,"Generate and journal the actual five-table legacy assistant declaration migration after 0019");
 const additions=entries.filter(entry=>{
  const sql=normalizeSql(entry.sql);return /\bALTER TABLE assistant_turns ADD (?:COLUMN )?request_json\b/iu.test(sql)&&/\bALTER TABLE assistant_specialist_tasks ADD (?:COLUMN )?result_json\b/iu.test(sql);
 });
 assert.equal(additions.length,1,"Generate and journal the actual nullable request_json/result_json ALTER migration; fixture DDL is not migration evidence");
 const declaration=declarations[0],addition=additions[0];
 assert.ok(declaration.idx>baseline);assert.ok(addition.idx>declaration.idx,"Existing runtime tables must be declared before nullable consent columns are added");
 assert.doesNotMatch(normalizeSql(declaration.sql),/\b(?:request_json|result_json|idx_assistant_single_consented_turn)\b/iu,"The first migration must retain the old runtime shape");
 assert.match(normalizeSql(addition.sql),/\bCREATE UNIQUE INDEX(?: IF NOT EXISTS)? idx_assistant_single_consented_turn\b/iu);
 for(const name of["assistant_billing_reconciliation_block_update","assistant_billing_reconciliation_block_delete"])
  assert.match(normalizeSql(declaration.sql),new RegExp("\\bCREATE TRIGGER IF NOT EXISTS "+name+"\\b","iu"));
 return{entries,baseline,declaration,addition};
}
function replay(sqlite,entries){
 for(const entry of entries)assert.doesNotThrow(()=>sqlite.exec(entry.sql),"Actual migration "+entry.file+" must execute unchanged");
}
function database(){
 const sqlite=new DatabaseSync(":memory:");sqlite.exec("PRAGMA foreign_keys=ON");return sqlite;
}
function baselineDatabase(){
 const sqlite=database(),entries=actualMigrations(),index=entries.findIndex(entry=>entry.tag===BASELINE_TAG);
 replay(sqlite,entries.slice(0,index+1));
 assert.deepEqual(sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name LIKE 'assistant_%'").all(),[]);
 for(const sql of LEGACY_ASSISTANT_DDL)sqlite.exec(sql);
 return sqlite;
}
function insertRow(sqlite,table,row,{ignore=false}={}){
 const entries=Object.entries(row);
 return sqlite.prepare("INSERT "+(ignore?"OR IGNORE ":"")+"INTO "+identifier(table)+"("+entries.map(([column])=>identifier(column)).join(",")+") VALUES("+entries.map(()=>"?").join(",")+")")
  .run(...entries.map(([,value])=>value));
}
function taskRow(id,overrides={}){
 return{task_id:id,actor_user_id:"legacy-owner",scope_key:"organization:org-legacy:access-legacy:doc-legacy",turn_id:"turn-legacy",
  organization_id:"org-legacy",project_access_id:"access-legacy",project_id:"project-legacy",document_id:"doc-legacy",route_family:"document",
  task_kind:"page-guidance",selected_model:"gpt-5.6-luna",token_reservation_id:id+"-tokens",cost_reservation_id:id+"-usd",
  estimated_microusd:4000,maximum_input_tokens:10400,maximum_output_tokens:1600,locale:"ja",permission_epoch:"legacy-epoch",
  status:"queued",error_code:null,created_at:"2026-07-14T12:34:56.000Z",updated_at:"2026-07-14T12:34:56.000Z",
  started_at:null,completed_at:null,lease_expires_at:null,provider_submitted:0,...overrides};
}
function seedLegacyRows(sqlite){
 const timestamp="2026-07-14T12:34:56.000Z",expires="2027-07-14T12:34:56.000Z";
 const turns=[
  {actor:"legacy-owner",scope:"organization:org-legacy:access-legacy:doc-legacy",shared:true},
  {actor:"legacy-owner",scope:"personal:project-legacy:doc-legacy",shared:false},
  {actor:"legacy-editor",scope:"organization:org-legacy:access-legacy:doc-legacy",shared:true}
 ];
 for(const[index,turn]of turns.entries()){
  const userRef="legacy-user-"+index,answerRef="legacy-answer-"+index;
  for(const[contentId,kind,content]of[[userRef,"chat-user","PRIVATE original request "+index+" 日本語"],[answerRef,"chat-assistant","PRIVATE original retained answer "+index]]){
   insertRow(sqlite,"private_content",{content_id:contentId,owner_id:turn.actor,kind,content,created_at:timestamp,expires_at:expires,redacted_at:null});
   if(turn.shared){
    insertRow(sqlite,"project_resource_scopes",{project_access_id:"access-legacy",resource_kind:"content",resource_id:contentId,organization_id:"org-legacy",project_id:"project-legacy",owner_user_id:"legacy-owner",visibility:"actor_private",source_event_id:null,actor_user_id:turn.actor,created_at:timestamp});
    insertRow(sqlite,"private_content_retention_scopes",{content_id:contentId,organization_id:"org-legacy",project_access_id:"access-legacy",project_id:"project-legacy",actor_user_id:turn.actor,classification:"transient-private",policy_version:3,assigned_expires_at:expires,created_at:timestamp});
   }
  }
  insertRow(sqlite,"assistant_turns",{turn_id:"turn-legacy",actor_user_id:turn.actor,scope_key:turn.scope,organization_id:turn.shared?"org-legacy":null,
   project_access_id:turn.shared?"access-legacy":null,project_id:"project-legacy",document_id:"doc-legacy",route_family:"document",
   user_content_ref:userRef,assistant_content_ref:answerRef,proposal_json:index===0?'[{"id":"proposal-legacy","kind":"edit-block"}]':"[]",
   permission_epoch:"legacy-epoch",status:"completed",created_at:timestamp,completed_at:timestamp});
 }
 const tasks=[
  taskRow("legacy-paid",{task_kind:"proposal",selected_model:"gpt-5.6-sol",estimated_microusd:100000,status:"completed",started_at:timestamp,completed_at:timestamp,provider_submitted:1}),
  taskRow("legacy-unknown",{status:"needs-review",error_code:"assistant_provider_submission_unverified",started_at:timestamp,lease_expires_at:timestamp,provider_submitted:1}),
  taskRow("legacy-no-charge",{scope_key:turns[1].scope,organization_id:null,project_access_id:null,status:"reconciled",started_at:timestamp,completed_at:timestamp,provider_submitted:1})
 ];
 for(const row of tasks){
  insertRow(sqlite,"assistant_specialist_tasks",row);
  const paid=row.task_id==="legacy-paid",unknown=row.task_id==="legacy-unknown";
  const common={owner_id:row.actor_user_id,stream_id:"creative:legacy-owner",correlation_id:"assistant-specialist:"+row.actor_user_id+":"+row.turn_id,
   operation:"assistant-specialist:"+row.task_kind+":"+row.selected_model,period:"2026-07",created_at:timestamp,updated_at:timestamp,settled_at:unknown?null:timestamp};
  insertRow(sqlite,"budget_reservations",{reservation_id:row.token_reservation_id,...common,reserved_tokens:12000,used_tokens:paid?1901:0,
   status:paid?"settled":unknown?"active":"released",settlement_reason:paid?"provider_usage_recorded":unknown?null:"verified_no_provider_charge"});
  insertRow(sqlite,"cost_budget_reservations",{reservation_id:row.cost_reservation_id,...common,workspace_id:row.organization_id??"forma",reserved_microusd:row.estimated_microusd,
   used_microusd:paid?19530:0,status:paid?"settled":unknown?"executing":"released",allow_user_overage:0});
  if(row.organization_id)for(const[kind,reservationId]of[["tokens",row.token_reservation_id],["usd",row.cost_reservation_id]])
   insertRow(sqlite,"project_budget_reservation_scopes",{reservation_kind:kind,reservation_id:reservationId,organization_id:row.organization_id,project_access_id:row.project_access_id,actor_user_id:row.actor_user_id,workspace_scope_id:row.organization_id,created_at:timestamp});
 }
 for(const[scope,scopeId]of[["user","legacy-owner"],["workspace","forma"],["workspace","org-legacy"]]){
  insertRow(sqlite,"budget_counters",{scope,scope_id:scopeId,period:"2026-07",used_tokens:1901,reserved_tokens:12000,hard_limit_tokens:10000000,updated_at:timestamp});
  insertRow(sqlite,"cost_budget_counters",{scope,scope_id:scopeId,period:"2026-07",used_microusd:19530,reserved_microusd:4000,hard_limit_microusd:60000000,updated_at:timestamp});
 }
 insertRow(sqlite,"private_content",{content_id:"legacy-action",owner_id:"legacy-owner",kind:"assistant-action",content:'{"kind":"edit-block","targetBlockId":"block-legacy","text":"PRIVATE protected proposal"}',created_at:timestamp,expires_at:expires,redacted_at:null});
 insertRow(sqlite,"assistant_action_proposals",{proposal_id:"proposal-legacy",actor_user_id:"legacy-owner",scope_key:turns[0].scope,turn_id:"turn-legacy",
  organization_id:"org-legacy",project_access_id:"access-legacy",project_id:"project-legacy",document_id:"doc-legacy",action_kind:"edit-block",action_content_ref:"legacy-action",
  source_versions_json:'{"block-legacy":7}',expected_head:41,permission_epoch:"legacy-epoch",status:"accepted",created_at:timestamp,expires_at:expires,resolved_at:timestamp});
 insertRow(sqlite,"assistant_action_commits",{commit_id:"commit-legacy",verified:1,created_at:timestamp});
 insertRow(sqlite,"assistant_billing_reconciliations",{reconciliation_id:"reconciliation-legacy",task_id:"legacy-no-charge",actor_user_id:"legacy-owner",reviewer_user_id:"independent-reviewer",
  organization_id:null,project_access_id:null,evidence_classification:"verified-no-provider-charge",occurred_at:timestamp});
 insertRow(sqlite,"events",{event_id:"event-legacy-reconciliation",stream_id:"creative:legacy-owner",sequence:1,occurred_at:timestamp,recorded_at:timestamp,
  actor:"user:independent-reviewer",client_id:"server:assistant-billing",correlation_id:"assistant-specialist:legacy-owner:turn-legacy",causation_id:null,compensates_event_id:null,schema_version:1,
  type:"AssistantProviderChargeReconciled",payload:'{"task_id":"legacy-no-charge","evidence_classification":"verified-no-provider-charge"}'});
 return{turns,tasks};
}
const protectedTables=[...ASSISTANT_TABLES,"events","private_content","project_resource_scopes","private_content_retention_scopes",
 "budget_reservations","cost_budget_reservations","project_budget_reservation_scopes","budget_counters","cost_budget_counters","consequential_executions","consequential_execution_steps"];
function snapshot(sqlite,{stripConsentColumns=false}={}){
 return Object.fromEntries(protectedTables.map(table=>[table,sqlite.prepare("SELECT rowid AS sqlite_rowid,* FROM "+identifier(table)+" ORDER BY rowid").all().map(row=>{
  const copy={...row};if(stripConsentColumns){if(table==="assistant_turns"){assert.equal(copy.request_json,null);delete copy.request_json;}
   if(table==="assistant_specialist_tasks"){assert.equal(copy.result_json,null);delete copy.result_json;}}
  return copy;
 })]));
}
function tableColumns(sqlite,table){
 return sqlite.prepare("PRAGMA table_info("+identifier(table)+")").all().map(row=>({
  name:row.name,type:String(row.type).toUpperCase(),notnull:row.notnull,pk:row.pk,
  default:row.dflt_value===null?null:String(row.dflt_value).toLowerCase().replace(/^\((.*)\)$/u,"$1").replace(/^false$/u,"0").replace(/^true$/u,"1")
 }));
}
function indexes(sqlite,table){
 return sqlite.prepare("PRAGMA index_list("+identifier(table)+")").all().map(row=>({...row,
  columns:sqlite.prepare("PRAGMA index_info("+identifier(row.name)+")").all().map(column=>column.name)}));
}
function originalObjects(sqlite){
 return sqlite.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE(type='trigger' OR type='index') AND tbl_name IN("+ASSISTANT_TABLES.map(()=>"?").join(",")+") ORDER BY type,name")
  .all(...ASSISTANT_TABLES).map(row=>({...row}));
}
function assertLegacyConstraints(sqlite){
 sqlite.exec("SAVEPOINT constraint_checks");
 try{
  const turn={...sqlite.prepare("SELECT * FROM assistant_turns WHERE actor_user_id='legacy-owner' ORDER BY scope_key LIMIT 1").get()};
  assert.throws(()=>insertRow(sqlite,"assistant_turns",turn),/UNIQUE constraint failed/u);
  assert.doesNotThrow(()=>insertRow(sqlite,"assistant_turns",{...turn,actor_user_id:"distinct-actor"}));
  assert.doesNotThrow(()=>insertRow(sqlite,"assistant_turns",{...turn,scope_key:"distinct-scope"}));
  const paid={...sqlite.prepare("SELECT * FROM assistant_specialist_tasks WHERE task_id='legacy-paid'").get()};
  assert.throws(()=>insertRow(sqlite,"assistant_specialist_tasks",{...paid,task_id:"duplicate-legacy-kind",selected_model:"gpt-5.6-luna"}),/UNIQUE constraint failed/u);
  assert.doesNotThrow(()=>insertRow(sqlite,"assistant_specialist_tasks",{...paid,task_id:"legacy-other-kind",task_kind:"creative-authoring"}));
  assert.throws(()=>insertRow(sqlite,"assistant_specialist_tasks",{...paid,actor_user_id:"another-actor",scope_key:"another-scope"}),/UNIQUE constraint failed/u);
  const proposal={...sqlite.prepare("SELECT * FROM assistant_action_proposals WHERE proposal_id='proposal-legacy'").get()};
  assert.throws(()=>insertRow(sqlite,"assistant_action_proposals",{...proposal,actor_user_id:"another-actor"}),/UNIQUE constraint failed/u);
  assert.throws(()=>insertRow(sqlite,"assistant_action_commits",{commit_id:"commit-legacy",verified:1,created_at:paid.created_at}),/UNIQUE constraint failed/u);
  assert.throws(()=>insertRow(sqlite,"assistant_action_commits",{commit_id:"invalid-commit",verified:0,created_at:paid.created_at}),/CHECK constraint failed/u);
  assert.throws(()=>insertRow(sqlite,"assistant_action_commits",{commit_id:"null-commit",verified:null,created_at:paid.created_at}),/NOT NULL constraint failed/u);
  const audit={...sqlite.prepare("SELECT * FROM assistant_billing_reconciliations").get()};
  assert.throws(()=>insertRow(sqlite,"assistant_billing_reconciliations",{...audit,reconciliation_id:"duplicate-audit"}),/UNIQUE constraint failed/u);
  assert.throws(()=>insertRow(sqlite,"assistant_billing_reconciliations",{...audit,reconciliation_id:"unverified-audit",reviewer_user_id:"other-reviewer",evidence_classification:"unverified"}),/CHECK constraint failed/u);
  assert.doesNotThrow(()=>insertRow(sqlite,"assistant_billing_reconciliations",{...audit,reconciliation_id:"independent-audit",reviewer_user_id:"other-reviewer"}));
  assert.throws(()=>sqlite.prepare("UPDATE assistant_billing_reconciliations SET occurred_at=occurred_at WHERE reconciliation_id=?").run(audit.reconciliation_id),/assistant billing audit is append-only/u);
  assert.throws(()=>sqlite.prepare("DELETE FROM assistant_billing_reconciliations WHERE reconciliation_id=?").run(audit.reconciliation_id),/assistant billing audit is append-only/u);
 }finally{sqlite.exec("ROLLBACK TO constraint_checks; RELEASE constraint_checks");}
}
function assertMigratedShape(sqlite){
 const reference=database();try{
  for(const sql of LEGACY_ASSISTANT_DDL)reference.exec(sql);
  for(const table of ASSISTANT_TABLES){
   const expected=tableColumns(reference,table),actual=tableColumns(sqlite,table);
   assert.deepEqual(actual.filter(column=>!["request_json","result_json"].includes(column.name)).sort((left,right)=>left.name.localeCompare(right.name)),expected.sort((left,right)=>left.name.localeCompare(right.name)),table+" preserves every legacy column/primary-key/default contract");
  }
 }finally{reference.close();}
 for(const[table,name]of[["assistant_turns","request_json"],["assistant_specialist_tasks","result_json"]]){
  const column=tableColumns(sqlite,table).find(column=>column.name===name);
  assert.ok(column,table+"."+name);assert.equal(column.type,"TEXT");assert.equal(column.notnull,0);assert.ok(column.default===null||column.default==="null");assert.equal(column.pk,0);
 }
 const unique=indexes(sqlite,"assistant_specialist_tasks");
 assert.ok(unique.some(index=>index.unique===1&&index.partial===0&&JSON.stringify(index.columns)===JSON.stringify(["actor_user_id","scope_key","turn_id","task_kind"])));
 const signed=unique.find(index=>index.name==="idx_assistant_single_consented_turn");
 assert.ok(signed);assert.equal(signed.unique,1);assert.equal(signed.partial,1);assert.deepEqual(signed.columns,["actor_user_id","scope_key","turn_id"]);
 const definition=normalizeSql(sqlite.prepare("SELECT sql FROM sqlite_schema WHERE type='index' AND name=?").get(signed.name).sql);
 const predicate=definition.slice(definition.toUpperCase().lastIndexOf("WHERE")+5).replace(/[();]/gu,"").replace(/\bassistant_specialist_tasks\./giu,"").replace(/\s+/gu," ").trim().toUpperCase();
 assert.equal(predicate,"RESULT_JSON IS NOT NULL","Every non-null retained result occupies the signed-turn slot, regardless of JSON shape");
 assert.equal(sqlite.prepare("PRAGMA quick_check").get().quick_check,"ok");
 assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_check").all(),[]);
}
function migratedDatabase(mode){
 const plan=consentMigrationPlan(),sqlite=mode==="legacy"?baselineDatabase():database();
 try{
  if(mode==="legacy"){seedLegacyRows(sqlite);replay(sqlite,plan.entries.slice(plan.baseline+1));}
  else{replay(sqlite,plan.entries);seedLegacyRows(sqlite);}
  return{sqlite,plan};
 }catch(error){sqlite.close();throw error;}
}
test("assistant migrations: the actual 0019 baseline and frozen runtime DDL preserve genuine legacy data",()=>{
 const sqlite=baselineDatabase();try{
  seedLegacyRows(sqlite);assert.equal(tableColumns(sqlite,"assistant_turns").some(column=>column.name==="request_json"),false);
  assert.equal(tableColumns(sqlite,"assistant_specialist_tasks").some(column=>column.name==="result_json"),false);
  assert.equal(indexes(sqlite,"assistant_specialist_tasks").some(index=>index.name==="idx_assistant_single_consented_turn"),false);
  assertLegacyConstraints(sqlite);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM assistant_turns WHERE turn_id='turn-legacy'").get().count,3);
  assert.equal(sqlite.prepare("SELECT used_microusd FROM cost_budget_reservations WHERE reservation_id='legacy-paid-usd'").get().used_microusd,19530);
  assert.equal(sqlite.prepare("SELECT status FROM cost_budget_reservations WHERE reservation_id='legacy-unknown-usd'").get().status,"executing");
 }finally{sqlite.close();}
});
test("assistant migrations: actual journaled declarations precede the nullable consent ALTER migration",()=>{
 consentMigrationPlan();
});
for(const mode of["fresh","legacy"])test("assistant migrations: "+mode+" replays all actual migration files and preserves constraints/triggers",()=>{
 const {sqlite}=migratedDatabase(mode);try{assertMigratedShape(sqlite);assertLegacyConstraints(sqlite);}finally{sqlite.close();}
});
test("assistant migrations: upgrading populated legacy runtime tables never adopts, reprices, or rewrites history",()=>{
 const plan=consentMigrationPlan(),sqlite=baselineDatabase();try{
  seedLegacyRows(sqlite);const before=snapshot(sqlite),objects=originalObjects(sqlite);
  replay(sqlite,plan.entries.slice(plan.baseline+1));
  assert.deepEqual(snapshot(sqlite,{stripConsentColumns:true}),before,"Existing rows, rowids, exact private bytes, old-month charges, uncertain holds, and receipts are unchanged");
  const afterObjects=originalObjects(sqlite);
  for(const object of objects)assert.deepEqual(afterObjects.find(after=>after.type===object.type&&after.name===object.name),object,"Preserve existing inline unique indexes and append-only triggers in place");
  for(const table of["assistant_turns","assistant_specialist_tasks"]){
   const field=table==="assistant_turns"?"request_json":"result_json";
   assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM "+identifier(table)+" WHERE "+identifier(field)+" IS NOT NULL").get().count,0);
  }
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM consequential_executions").get().count,0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM consequential_execution_steps").get().count,0);
  assertMigratedShape(sqlite);assertLegacyConstraints(sqlite);
 }finally{sqlite.close();}
});
test("assistant migrations: the actual legacy declaration safely replays around the one-shot additive migration",()=>{
 const plan=consentMigrationPlan(),sqlite=baselineDatabase();try{
  seedLegacyRows(sqlite);const before=snapshot(sqlite),objects=originalObjects(sqlite);
  replay(sqlite,plan.entries.slice(plan.baseline+1,plan.declaration.idx+1));
  replay(sqlite,[plan.declaration,plan.declaration]);
  assert.deepEqual(snapshot(sqlite),before);
  replay(sqlite,plan.entries.slice(plan.declaration.idx+1));
  const migrated=snapshot(sqlite);replay(sqlite,[plan.declaration,plan.declaration]);assert.deepEqual(snapshot(sqlite),migrated);
  for(const object of objects)assert.deepEqual(originalObjects(sqlite).find(after=>after.type===object.type&&after.name===object.name),object);
  assertMigratedShape(sqlite);assertLegacyConstraints(sqlite);
  // SQLite ALTER ADD COLUMN is intentionally applied once by migration history, not rerun after runtime adds it.
 }finally{sqlite.close();}
});
for(const mode of["fresh","legacy"])test("assistant migrations: "+mode+" signed uniqueness crosses kind/model while NULL legacy rows stay unsigned",()=>{
 const {sqlite}=migratedDatabase(mode);try{
  const original=taskRow("signed-original",{turn_id:"turn-signed",task_kind:"page-guidance",result_json:'{"specialistConsentVersion":1,"bindingHash":"retained-binding"}'});
  insertRow(sqlite,"assistant_specialist_tasks",original);
  const duplicate={...original,task_id:"signed-other-kind",task_kind:"proposal",selected_model:"gpt-5.6-sol"};
  assert.throws(()=>insertRow(sqlite,"assistant_specialist_tasks",duplicate),/UNIQUE constraint failed: assistant_specialist_tasks\.actor_user_id, assistant_specialist_tasks\.scope_key, assistant_specialist_tasks\.turn_id/u);
  assert.equal(Number(insertRow(sqlite,"assistant_specialist_tasks",duplicate,{ignore:true}).changes),0);
  insertRow(sqlite,"assistant_specialist_tasks",{...duplicate,task_id:"legacy-null-alongside-signed",result_json:null});
  assert.throws(()=>sqlite.prepare("UPDATE assistant_specialist_tasks SET result_json=? WHERE task_id='legacy-null-alongside-signed'").run("{}"),/UNIQUE constraint failed/u);
  assert.equal(sqlite.prepare("SELECT result_json FROM assistant_specialist_tasks WHERE task_id='legacy-null-alongside-signed'").get().result_json,null);
  assert.doesNotThrow(()=>insertRow(sqlite,"assistant_specialist_tasks",{...duplicate,task_id:"signed-other-actor",actor_user_id:"another-actor"}));
  assert.doesNotThrow(()=>insertRow(sqlite,"assistant_specialist_tasks",{...duplicate,task_id:"signed-other-scope",scope_key:"another-scope"}));
  for(const[index,receipt]of["", "malformed-json", "{}"].entries()){
   const first={...original,task_id:"nonnull-"+index,turn_id:"nonnull-turn-"+index,result_json:receipt};
   insertRow(sqlite,"assistant_specialist_tasks",first);
   assert.throws(()=>insertRow(sqlite,"assistant_specialist_tasks",{...first,task_id:"nonnull-duplicate-"+index,task_kind:"proposal"}),/UNIQUE constraint failed/u);
  }
  const request=JSON.stringify({schema:1,turnId:"turn-legacy",route:"/canvas/original",documentId:null,selectedItemIds:["card-two","card-one"],locale:"ja",message:"元の依頼"});
  sqlite.prepare("UPDATE assistant_turns SET request_json=? WHERE actor_user_id='legacy-owner' AND scope_key='personal:project-legacy:doc-legacy'").run(request);
  assert.equal(sqlite.prepare("SELECT request_json FROM assistant_turns WHERE actor_user_id='legacy-owner' AND scope_key='personal:project-legacy:doc-legacy'").get().request_json,request);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM consequential_executions").get().count,0,"Schema storage is not paid admission");
 }finally{sqlite.close();}
});

// Main170 source-metadata integration only. These hashes describe repository
// files, never evidence that a production database applied a migration.
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from "drizzle-kit/api";

const MAIN170_SOURCE_HISTORY_BASELINE = [
  {
    "idx": 0,
    "version": "6",
    "when": 1786380541541,
    "tag": "0000_lively_owl",
    "breakpoints": true,
    "sqlSha256": "a171936bedddbcd299e13569985486cfbdaa281b973ddcaa23201c92b1016279",
    "snapshotSha256": "d3ecfc84248e424502c78905afc89f32207583280420415781d8abb9a4182ea6"
  },
  {
    "idx": 1,
    "version": "6",
    "when": 1786383935009,
    "tag": "0001_slimy_dragon_lord",
    "breakpoints": true,
    "sqlSha256": "7e9e2d9125b1722f7d3c042290c91a64b4e43cae4387851b4d9a90104f3603cf",
    "snapshotSha256": "10dc7ff74332251232d02c152828ffdefdee6918d1003620b95ad6d8b6e1d5bf"
  },
  {
    "idx": 2,
    "version": "6",
    "when": 1786385722784,
    "tag": "0002_cooing_paladin",
    "breakpoints": true,
    "sqlSha256": "06bb5dd7dc75066c01e8c3a8d7c15e648234f307f056b87f49407234fa6f0ba0",
    "snapshotSha256": "636cfb3eb7dd2c4b589f4f72bb2b5b456d7600ca384f0b2e953d68dcc55fd3c9"
  },
  {
    "idx": 3,
    "version": "6",
    "when": 1786546028259,
    "tag": "0003_skinny_hammerhead",
    "breakpoints": true,
    "sqlSha256": "6f26ae9b89c6c15a674567cf619e503f8fade63da6a35acc8a1ecb5df1d5253f",
    "snapshotSha256": "fec4b4367a8fe897b7689076b24a7c5e2a78e0c197fc290640d4bf0955d3d48c"
  },
  {
    "idx": 4,
    "version": "6",
    "when": 1786547536804,
    "tag": "0004_pink_titanium_man",
    "breakpoints": true,
    "sqlSha256": "0c46e3c06e7e6fe256f385ce49f40c219a1e8bf2251105cc3b1490ae38bd71c9",
    "snapshotSha256": "ee232c3d82c501e189cf93dfe3ab029450b02a4dfa32ab291229a888b83a11fe"
  },
  {
    "idx": 5,
    "version": "6",
    "when": 1786648829555,
    "tag": "0005_large_energizer",
    "breakpoints": true,
    "sqlSha256": "ad0382816b3c63787a9513a4a7c76faf1147bbce2c04053ea4e1e273c4618e1a",
    "snapshotSha256": "d19d2cb6e6101ed4491f87be8cc747c18fb1d040fe8a8af93fe98547e6f6e428"
  },
  {
    "idx": 6,
    "version": "6",
    "when": 1787225185196,
    "tag": "0006_high_talisman",
    "breakpoints": true,
    "sqlSha256": "a6b5ea7d1bb02fd2520e9923afdeb22aa0e6d65b2b0a6bc2b7d29d0244e06a2b",
    "snapshotSha256": "d87b0c616e816fdca8b7eea82bb9fbbb5e1c6ac6ae89a2723d14ae0536cfa7fd"
  },
  {
    "idx": 7,
    "version": "6",
    "when": 1787321219803,
    "tag": "0007_dizzy_bruce_banner",
    "breakpoints": true,
    "sqlSha256": "ca8173b98fbd580deb271eeb1ddd72417ae6e18e4b1dc1c31a11a41829c0428c",
    "snapshotSha256": "83e00d86b7b9acb88b688179d011d2ba59948b9b4f3c172192b1eb14fd9332e0"
  },
  {
    "idx": 8,
    "version": "6",
    "when": 1787336622494,
    "tag": "0008_shocking_joshua_kane",
    "breakpoints": true,
    "sqlSha256": "37c75899f2f63745f7942f7988fb0bae118f1eba4aabd0ca07902950db8feb1e",
    "snapshotSha256": "033b96d41313cb649feb9193d327f05b672d4282f900f31169c52c6f5836bce7"
  },
  {
    "idx": 9,
    "version": "6",
    "when": 1787411496788,
    "tag": "0009_rainy_sir_ram",
    "breakpoints": true,
    "sqlSha256": "ea965294ea9cad9812ac2f08612f0f7545a0064daff4f598b672c851b6c86653",
    "snapshotSha256": "d45f5b0f9586ce10ca1eb4a48eb8f2cbab2b288fd546b05a482fec884fbf40d7"
  },
  {
    "idx": 10,
    "version": "6",
    "when": 1787423798387,
    "tag": "0010_simple_alex_wilder",
    "breakpoints": true,
    "sqlSha256": "7deb564b4467962147c58d86feb5fa6659e4e83d50729f1e6b6d8213664d4fe3",
    "snapshotSha256": "64d7bc003c4ae5b1b2b8fcb74c326aa4147536ef1a6dfbe8bf01d909d3226228"
  },
  {
    "idx": 11,
    "version": "6",
    "when": 1787438499724,
    "tag": "0011_swift_redwing",
    "breakpoints": true,
    "sqlSha256": "1e55294b01bfc6a3fc5de9eb0c96703cde5c6c039279b128c9b64bca993e5aac",
    "snapshotSha256": "22f86836f2e776be454211d2b2cd120db877749359083435ac0a38fef30804bd"
  },
  {
    "idx": 12,
    "version": "6",
    "when": 1787442093396,
    "tag": "0012_green_james_howlett",
    "breakpoints": true,
    "sqlSha256": "f08b6795fcf9a2b48400e119abbb984715d92c80fb46af06073aa74b43b84e9d",
    "snapshotSha256": "82a4124f75ba894ecaf9e6263491d8ecbedd8b9af48c8990ab43093e35b708b8"
  },
  {
    "idx": 13,
    "version": "6",
    "when": 1787452816325,
    "tag": "0013_long_midnight",
    "breakpoints": true,
    "sqlSha256": "a7adb61922ef8224f52258fc1e7881c21c4482f8ade86e1c0d2d5265c9e0e41b",
    "snapshotSha256": "cbffac5ed63c04f34b3a5e904e512311239773f925155b7f0ceae5b7ad61b678"
  },
  {
    "idx": 14,
    "version": "6",
    "when": 1787501364000,
    "tag": "0014_perfect_robbie_robertson",
    "breakpoints": true,
    "sqlSha256": "df3dfd3ff407915cb258ea3a2b05f66b451ff921f1e6a44a26783c097fed44c4",
    "snapshotSha256": "3aa322338d5d6cac9b864aea50ff94d01188f0ec15e9f929260175342c741e2b"
  },
  {
    "idx": 15,
    "version": "6",
    "when": 1787516163127,
    "tag": "0015_true_lila_cheney",
    "breakpoints": true,
    "sqlSha256": "f0d798ba43eddd8236d5c8cde1c8d075b121b211faa9e4e74e10f575a8e5c4c6",
    "snapshotSha256": "39a1ea0c8a31b880a73d5ff4ae7dafbd669c6dc22bb31092991dadc2b1cd4ac9"
  },
  {
    "idx": 16,
    "version": "6",
    "when": 1787522932917,
    "tag": "0016_living_tarantula",
    "breakpoints": true,
    "sqlSha256": "fcf5bcb9b8ac9ff85d09046882cf9ab8ea82723646f38feb6477dffbf7fc64ba",
    "snapshotSha256": "206c29a98f9504a5b12accc32cc570da72865cba265b7d7b39603a027dce1f8e"
  },
  {
    "idx": 17,
    "version": "6",
    "when": 1787530951487,
    "tag": "0017_previous_pixie",
    "breakpoints": true,
    "sqlSha256": "3f1e8bac9cf1216a5a2118055cd2f5c6079f10e29bfd601291588d38e3f69e83",
    "snapshotSha256": "f2b0174b8bc663f23f49e1600761a3bae98107715d2987e1525d4e8f901c7de0"
  },
  {
    "idx": 18,
    "version": "6",
    "when": 1787796904509,
    "tag": "0018_consequential_consent",
    "breakpoints": true,
    "sqlSha256": "a33aeab74dfee37da4e9d79f515efe5cc8c5edffddae8eb10e4f9838e7918e20",
    "snapshotSha256": "a600ef6c341d50845f98470c001a3d472f5027dfec93224f913caf34e0dda7d2"
  },
  {
    "idx": 19,
    "version": "6",
    "when": 1787800209711,
    "tag": "0019_authoring_commits",
    "breakpoints": true,
    "sqlSha256": "502475279915896917dce5137a5d54549eea5e5c32947449de8440cefda88acc",
    "snapshotSha256": "3ca6c3b16f08e3f4854a766bc80d67d728cda8dc89c242a21a3644b809d03b04"
  },
  {
    "idx": 20,
    "version": "6",
    "when": 1787843272923,
    "tag": "0020_assistant_runtime_tables",
    "breakpoints": true,
    "sqlSha256": "9d1240b323c0cbd3f587f0a86192630e2392be77643058110fa4c85645e730e7",
    "snapshotSha256": "5f8ab406c804eb9e0bab272be9db645c08314cb5d2556ddf2225d358631a8960"
  },
  {
    "idx": 21,
    "version": "6",
    "when": 1787843379540,
    "tag": "0021_assistant_specialist_consent",
    "breakpoints": true,
    "sqlSha256": "928e94bf4712edb2fcc848e546830edcbde8f67cb5fac52099affa3f1c7a0a5b",
    "snapshotSha256": "7ead21df30f704dab1329507ce7c8040562f542663b9281c72e45e91d913db82"
  }
];
const MAIN170_OUTPUT_SOURCE_SQL_SHA256 = "6d96ee6c4f496a9b858533711c4c5fccb48b8814bfe3af195e86a6f31d12f5c9";
const MAIN170_OUTPUT_ORIGINAL_SNAPSHOT_ID = "bf24355f-2406-5fad-af45-b45c024f0440";

const main170MetadataHash = value => createHash("sha256").update(value).digest("hex");
const main170MetadataSnapshot = index => JSON.parse(readFileSync(new URL("meta/" + String(index).padStart(4, "0") + "_snapshot.json", migrationDirectory), "utf8"));
const main170MetadataHistory = () => readMigrationFiles({ migrationsFolder: fileURLToPath(migrationDirectory) });
const currentSchemaSnapshot = () => main170MetadataSnapshot(actualMigrations().at(-1).idx);
const main170MetadataOutputNames = () => Object.keys(main170MetadataSnapshot(22).tables).filter(name => name.startsWith("output_")).sort();
const main170MetadataExists = (sqlite, name) => Boolean(sqlite.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(name));
const main170MetadataReceipts = sqlite => sqlite.prepare("SELECT hash,created_at FROM __drizzle_migrations ORDER BY created_at").all().map(row => ({ ...row }));
const main170MetadataExpectedReceipts = entries => entries.map(entry => ({ hash: entry.hash, created_at: entry.folderMillis })).sort((left, right) => left.created_at - right.created_at);

/** Use the installed SQLite migrator's real transaction and history selection.
 * This port is only an isolated Node SQLite test session, not a Sites runner. */
function main170MetadataMigrate(sqlite, entries) {
  const dialect = new SQLiteSyncDialect();
  const session = {
    run(statement) {
      const query = dialect.sqlToQuery(statement);
      if (query.params.length) return sqlite.prepare(query.sql).run(...query.params);
      sqlite.exec(query.sql);
    },
    values(statement) {
      const query = dialect.sqlToQuery(statement);
      return sqlite.prepare(query.sql).all(...query.params).map(row => Object.values(row));
    },
  };
  dialect.migrate(entries, session, { migrationsTable: "__drizzle_migrations" });
}
function main170MetadataExistingRows(sqlite) {
  return Object.fromEntries(protectedTables.filter(table => main170MetadataExists(sqlite, table)).map(table => [
    table, sqlite.prepare("SELECT rowid AS sqlite_rowid,* FROM " + identifier(table) + " ORDER BY rowid").all().map(row => ({ ...row })),
  ]));
}
function main170MetadataOutputShape(sqlite) {
  const generated = currentSchemaSnapshot(), outputNames = main170MetadataOutputNames();
  assert.equal(outputNames.length, 16);
  for (const table of outputNames) {
    assert.ok(main170MetadataExists(sqlite, table), table);
    const description = generated.tables[table], primary = Object.values(description.compositePrimaryKeys)[0]?.columns ?? [];
    const expected = Object.values(description.columns).map(column => ({
      name: column.name, type: column.type.toUpperCase(), notnull: Number(column.notNull),
      pk: primary.includes(column.name) ? primary.indexOf(column.name) + 1 : Number(column.primaryKey),
      default: column.default === undefined ? null : String(column.default).toLowerCase(),
    }));
    assert.deepEqual(tableColumns(sqlite, table), expected, table + " keeps the actual columns/defaults/primary key");
    const actualIndexes = indexes(sqlite, table);
    assert.equal(actualIndexes.filter(index => !index.name.startsWith("sqlite_autoindex_")).length, Object.keys(description.indexes).length);
    for (const index of Object.values(description.indexes)) {
      const actual = actualIndexes.find(candidate => candidate.name === index.name);
      assert.ok(actual, index.name); assert.equal(actual.unique, Number(index.isUnique));
      assert.deepEqual(actual.columns, index.columns.map(column => String(column).replaceAll('"', "").replace(/\s+DESC$/iu, "")));
      const directions = sqlite.prepare("PRAGMA index_xinfo(" + identifier(index.name) + ")").all().filter(row => row.key);
      assert.deepEqual(directions.map(row => row.desc), index.columns.map(column => Number(/\s+DESC$/iu.test(column))));
    }
    const grouped = new Map();
    for (const row of sqlite.prepare("PRAGMA foreign_key_list(" + identifier(table) + ")").all()) {
      const group = grouped.get(row.id) ?? { tableTo: row.table, columnsFrom: [], columnsTo: [], onDelete: row.on_delete.toLowerCase(), onUpdate: row.on_update.toLowerCase() };
      group.columnsFrom[row.seq] = row.from; group.columnsTo[row.seq] = row.to; grouped.set(row.id, group);
    }
    const canonical = rows => rows.map(row => JSON.stringify(row)).sort();
    assert.deepEqual(canonical([...grouped.values()]), canonical(Object.values(description.foreignKeys).map(key => ({
      tableTo: key.tableTo, columnsFrom: key.columnsFrom, columnsTo: key.columnsTo, onDelete: key.onDelete, onUpdate: key.onUpdate,
    }))), table + " keeps every original foreign key");
    const definition = normalizeSql(sqlite.prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name=?").get(table).sql).replace(/\s+/gu, "").toLowerCase();
    for (const check of Object.values(description.checkConstraints)) {
      const expression = normalizeSql(check.value).replace(/\s+/gu, "").toLowerCase();
      assert.ok(definition.includes("check(" + expression + ")"), table + ": " + check.name);
    }
  }
  assert.equal(sqlite.prepare("PRAGMA quick_check").get().quick_check, "ok");
  assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_check").all(), []);
}

test("main170 source metadata: accepted 0–21 SQL and snapshots remain byte-exact while Output keeps its original filename and timestamp", () => {
  const entries = actualMigrations(), journal = JSON.parse(readFileSync(new URL("meta/_journal.json", migrationDirectory), "utf8"));
  for (const original of MAIN170_SOURCE_HISTORY_BASELINE) {
    const { sqlSha256, snapshotSha256, ...entry } = original;
    assert.deepEqual(journal.entries[entry.idx], entry, entry.tag + " original journal metadata");
    assert.equal(main170MetadataHash(readFileSync(new URL(entry.tag + ".sql", migrationDirectory))), sqlSha256, entry.tag + " SQL checksum");
    assert.equal(main170MetadataHash(readFileSync(new URL("meta/" + String(entry.idx).padStart(4, "0") + "_snapshot.json", migrationDirectory))), snapshotSha256, entry.tag + " original snapshot bytes");
  }
  assert.deepEqual(journal.entries[22], { idx: 22, version: "6", when: 1787853600000, tag: "0018_output_requirements", breakpoints: true });
  assert.equal(entries[22].file, "0018_output_requirements.sql");
  assert.equal(main170MetadataHash(entries[22].sql), MAIN170_OUTPUT_SOURCE_SQL_SHA256);
  assert.equal(entries.some(entry => entry.tag === "0022_output_requirements"), false, "No renamed or copied Output migration SQL is invented");
  assert.equal(new Set(journal.entries.map(entry => entry.idx)).size, journal.entries.length);
  assert.equal(new Set(journal.entries.map(entry => entry.tag)).size, journal.entries.length);
});

test("main170 source metadata: snapshot 22 retains the accepted 87-table history and the latest snapshot matches the current schema", async () => {
  const schema = await import("../db/schema.ts"), previous = main170MetadataSnapshot(21), composite = main170MetadataSnapshot(22), current = currentSchemaSnapshot();
  const generated = JSON.parse(JSON.stringify(await generateSQLiteDrizzleJson(schema, current.prevId)));
  assert.equal(composite.version, "6"); assert.equal(composite.dialect, "sqlite");
  assert.equal(composite.prevId, previous.id); assert.match(composite.id, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u);
  assert.notEqual(composite.id, MAIN170_OUTPUT_ORIGINAL_SNAPSHOT_ID);
  assert.notEqual(composite.prevId, MAIN170_OUTPUT_ORIGINAL_SNAPSHOT_ID, "The other branch's source snapshot is not represented as a database receipt or false predecessor");
  for (let index = 0; index < 22; index++) assert.notEqual(composite.id, main170MetadataSnapshot(index).id);
  assert.equal(Object.keys(previous.tables).length, 71); assert.equal(Object.keys(composite.tables).length, 87);
  for (const [name, table] of Object.entries(previous.tables)) assert.deepEqual(composite.tables[name], table, name);
  const { id: _generatedId, ...generatedShape } = generated, { id: _savedId, ...savedShape } = current;
  assert.deepEqual(savedShape, generatedShape, "Saved snapshot comes from the installed generator and actual schema, not a hand-written subset");
  assert.deepEqual(await generateSQLiteMigration(current, generated), [], "The latest snapshot causes no duplicate SQL for the unchanged schema");
});

test("main170 source metadata: the installed loader uses the original SQL bytes and journal order, not the numeric tag prefix", () => {
  const actual = actualMigrations(), loaded = main170MetadataHistory();
  assert.equal(loaded.length, actual.length);
  for (const [index, migration] of loaded.entries()) {
    assert.equal(migration.folderMillis, actual[index].when);
    assert.equal(migration.hash, main170MetadataHash(actual[index].sql));
    assert.equal(migration.bps, actual[index].breakpoints);
    assert.deepEqual(migration.sql, actual[index].sql.split("--> statement-breakpoint"));
  }
  assert.equal(loaded[22].hash, MAIN170_OUTPUT_SOURCE_SQL_SHA256);
  assert.ok(loaded[22].folderMillis > loaded[21].folderMillis);
});

test("main170 source metadata: fresh installed SQLite migration history applies all unchanged files once", () => {
  const sqlite = database(), history = main170MetadataHistory();
  try {
    main170MetadataMigrate(sqlite, history);
    assert.deepEqual(main170MetadataReceipts(sqlite), main170MetadataExpectedReceipts(history));
    assertMigratedShape(sqlite); main170MetadataOutputShape(sqlite);
    seedLegacyRows(sqlite); const before = snapshot(sqlite), receipts = main170MetadataReceipts(sqlite);
    main170MetadataMigrate(sqlite, history);
    assert.deepEqual(snapshot(sqlite), before); assert.deepEqual(main170MetadataReceipts(sqlite), receipts);
    assertLegacyConstraints(sqlite);
  } finally { sqlite.close(); }
});

test("main170 source metadata: original populated 0019 legacy runtime fixture upgrades without adoption, repricing or hold loss", () => {
  const sqlite = database(), history = main170MetadataHistory(), plan = consentMigrationPlan();
  try {
    main170MetadataMigrate(sqlite, history.slice(0, plan.baseline + 1));
    for (const statement of LEGACY_ASSISTANT_DDL) sqlite.exec(statement);
    seedLegacyRows(sqlite);
    const before = snapshot(sqlite), objects = originalObjects(sqlite), receipts = main170MetadataReceipts(sqlite);
    assert.equal(tableColumns(sqlite, "assistant_turns").some(column => column.name === "request_json"), false);
    assert.equal(tableColumns(sqlite, "assistant_specialist_tasks").some(column => column.name === "result_json"), false);
    main170MetadataMigrate(sqlite, history);
    assert.deepEqual(snapshot(sqlite, { stripConsentColumns: true }), before);
    assert.deepEqual(main170MetadataReceipts(sqlite).slice(0, receipts.length), receipts);
    assert.deepEqual(main170MetadataReceipts(sqlite), main170MetadataExpectedReceipts(history));
    for (const object of objects) assert.deepEqual(originalObjects(sqlite).find(current => current.type === object.type && current.name === object.name), object);
    assert.equal(sqlite.prepare("SELECT used_microusd FROM cost_budget_reservations WHERE reservation_id='legacy-paid-usd'").get().used_microusd, 19530);
    assert.equal(sqlite.prepare("SELECT status FROM cost_budget_reservations WHERE reservation_id='legacy-unknown-usd'").get().status, "executing");
    assertMigratedShape(sqlite); assertLegacyConstraints(sqlite); main170MetadataOutputShape(sqlite);
  } finally { sqlite.close(); }
});

test("main170 source metadata is NOT deployment certification: recorded upstream Output timestamp still skips unrecorded accepted 18–21", () => {
  const sqlite = database(), history = main170MetadataHistory(), mainHistory = [...history.slice(0, 18), history[22]];
  try {
    main170MetadataMigrate(sqlite, mainHistory);
    for (const statement of LEGACY_ASSISTANT_DDL) sqlite.exec(statement);
    seedLegacyRows(sqlite);
    const before = main170MetadataExistingRows(sqlite), receipts = main170MetadataReceipts(sqlite);
    const inverseIndex = history.findIndex(entry => entry.sql.some(sql => sql.includes('CREATE TRIGGER memory_derivation_result_consequential_executions_insert')));
    assert.ok(inverseIndex > 22);
    const beforeInverses = history.slice(0, inverseIndex);
    main170MetadataMigrate(sqlite, beforeInverses);
    const later = beforeInverses.filter(entry => entry.folderMillis > receipts.at(-1).created_at);
    assert.deepEqual(main170MetadataReceipts(sqlite), [...receipts, ...main170MetadataExpectedReceipts(later)], "Only later migrations apply; absent accepted predecessors remain absent");
    const partialReceipts = main170MetadataReceipts(sqlite);
    // New source-inverse triggers require the genuine predecessor table. A
    // timestamp-skipped prerequisite must abort, not be fabricated or ignored.
    assert.throws(() => main170MetadataMigrate(sqlite, history), /no such table: main\.consequential_executions/iu);
    assert.deepEqual(main170MetadataReceipts(sqlite), partialReceipts);
    assert.equal(main170MetadataExists(sqlite, 'memory_derivation_results'), false);
    assert.deepEqual(main170MetadataExistingRows(sqlite), before);
    for (const table of ["consequential_executions", "consequential_execution_steps", "authoring_commits"]) assert.equal(main170MetadataExists(sqlite, table), false, table + " is still missing");
    assert.equal(tableColumns(sqlite, "assistant_turns").some(column => column.name === "request_json"), false);
    assert.equal(tableColumns(sqlite, "assistant_specialist_tasks").some(column => column.name === "result_json"), false);
    assert.equal(receipts.length, 19);
    assert.equal(receipts.at(-1).hash, MAIN170_OUTPUT_SOURCE_SQL_SHA256);
  } finally { sqlite.close(); }
});

test("main170 source metadata is NOT deployment certification: a modern schema without a migration ledger still rejects blind replay", () => {
  const sqlite = database(), history = main170MetadataHistory();
  try {
    replay(sqlite, actualMigrations()); seedLegacyRows(sqlite);
    assert.equal(main170MetadataExists(sqlite, "__drizzle_migrations"), false);
    const before = snapshot(sqlite);
    assert.throws(() => main170MetadataMigrate(sqlite, history), /already exists/iu);
    assert.deepEqual(snapshot(sqlite), before);
    assert.deepEqual(main170MetadataReceipts(sqlite), [], "A failed replay cannot manufacture successful migration receipts");
    assertMigratedShape(sqlite); main170MetadataOutputShape(sqlite);
  } finally { sqlite.close(); }
});

test("main170 source metadata is NOT deployment certification: pre-existing consent columns still make unrecorded 21 ALTER fail", () => {
  const sqlite = database(), history = main170MetadataHistory(), plan = consentMigrationPlan();
  try {
    main170MetadataMigrate(sqlite, history.slice(0, plan.addition.idx));
    replay(sqlite, [plan.addition]); seedLegacyRows(sqlite);
    const before = snapshot(sqlite), receipts = main170MetadataReceipts(sqlite);
    assert.throws(() => main170MetadataMigrate(sqlite, history), /duplicate column name/iu);
    assert.deepEqual(snapshot(sqlite), before); assert.deepEqual(main170MetadataReceipts(sqlite), receipts);
    assert.equal(main170MetadataExists(sqlite, "output_operation_slots"), false);
    assertMigratedShape(sqlite); assertLegacyConstraints(sqlite);
  } finally { sqlite.close(); }
});

test("main170 source metadata is NOT deployment certification: recorded history alone does not detect or repair live schema drift", () => {
  const sqlite = database(), history = main170MetadataHistory();
  try {
    main170MetadataMigrate(sqlite, history); seedLegacyRows(sqlite);
    const before = snapshot(sqlite), receipts = main170MetadataReceipts(sqlite);
    sqlite.exec("DROP INDEX idx_assistant_single_consented_turn");
    main170MetadataMigrate(sqlite, history);
    assert.equal(indexes(sqlite, "assistant_specialist_tasks").some(index => index.name === "idx_assistant_single_consented_turn"), false);
    assert.deepEqual(snapshot(sqlite), before); assert.deepEqual(main170MetadataReceipts(sqlite), receipts);
  } finally { sqlite.close(); }
});
