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
