import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';
import {registerOutputSourceImports} from './output-execution-test-helpers.mjs';
registerOutputSourceImports();
const {prepareBudgetReservation,prepareCostBudgetReservation,settleBudget,settleCostBudget}=await import('../worker/pilot-policy.ts');

function fixture(){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec(`
 CREATE TABLE budget_counters(scope TEXT,scope_id TEXT,period TEXT,used_tokens INTEGER DEFAULT 0,reserved_tokens INTEGER DEFAULT 0,hard_limit_tokens INTEGER,updated_at TEXT,PRIMARY KEY(scope,scope_id,period));
 CREATE TABLE cost_budget_counters(scope TEXT,scope_id TEXT,period TEXT,used_microusd INTEGER DEFAULT 0,reserved_microusd INTEGER DEFAULT 0,hard_limit_microusd INTEGER,updated_at TEXT,PRIMARY KEY(scope,scope_id,period));
 CREATE TABLE budget_reservations(reservation_id TEXT PRIMARY KEY,owner_id TEXT,stream_id TEXT,correlation_id TEXT,operation TEXT,period TEXT,reserved_tokens INTEGER,used_tokens INTEGER,status TEXT,settlement_reason TEXT,created_at TEXT,settled_at TEXT,updated_at TEXT);
 CREATE TABLE cost_budget_reservations(reservation_id TEXT PRIMARY KEY,owner_id TEXT,workspace_id TEXT,stream_id TEXT,correlation_id TEXT,operation TEXT,period TEXT,reserved_microusd INTEGER,used_microusd INTEGER,status TEXT,allow_user_overage INTEGER,created_at TEXT,settled_at TEXT,updated_at TEXT);
 CREATE TABLE pilot_cohorts(cohort_id TEXT,organization_id TEXT,status TEXT,starts_at TEXT,ends_at TEXT,participant_cap_microusd INTEGER,organization_cap_microusd INTEGER,created_at TEXT,updated_at TEXT);
 CREATE TABLE pilot_participants(participant_id TEXT,cohort_id TEXT,organization_id TEXT,user_id TEXT,role TEXT,status TEXT,revoked_at TEXT);
 CREATE TABLE project_budget_reservation_scopes(reservation_kind TEXT,reservation_id TEXT,organization_id TEXT,project_access_id TEXT,actor_user_id TEXT,workspace_scope_id TEXT,created_at TEXT);
 CREATE TABLE pilot_cost_reservation_scopes(reservation_id TEXT,cohort_id TEXT,organization_id TEXT,actor_user_id TEXT,created_at TEXT);
 CREATE TABLE assertion_guard(passed INTEGER NOT NULL CHECK(passed=1));
 CREATE TABLE job_fixture(id TEXT PRIMARY KEY);
 `);
 class Statement{
  constructor(sql,values=[]){this.sql=sql;this.values=values;}
  bind(...values){assert.ok(values.length<=100,'D1 bound parameter limit');return new Statement(this.sql,values);}
  exec(mode='run'){const stmt=sqlite.prepare(this.sql);if(mode==='first')return stmt.get(...this.values)??null;if(mode==='all')return {results:stmt.all(...this.values),meta:{changes:0},success:true};const result=stmt.run(...this.values);return {results:[],meta:{changes:Number(result.changes)},success:true};}
  async first(){return this.exec('first')} async all(){return this.exec('all')} async run(){return this.exec()}
 }
 const env={DB:{prepare(sql){return new Statement(sql)},async batch(statements){sqlite.exec('BEGIN');try{const results=statements.map(s=>s.exec(/^\s*(SELECT|WITH)/i.test(s.sql)?'all':'run'));sqlite.exec('COMMIT');return results}catch(error){sqlite.exec('ROLLBACK');throw error}}}};
 return {sqlite,env};
}
async function prepare(env,id,amount=1_000_000){
 const context={streamId:'creative:owner',correlationId:id,operation:'image-generation',period:'2026-08'};
 const token=await prepareBudgetReservation(env,'owner',32_000,{...context,reservationId:`token:${id}`});
 const cost=await prepareCostBudgetReservation(env,'owner',amount,{...context,reservationId:`cost:${id}`,maximumMicrousd:amount,allowUserOverage:false});
 assert.equal(token.ok,true);assert.equal(cost.ok,true);
 return {token,cost,statements:[...token.statements,...cost.statements,
  env.DB.prepare(`INSERT INTO assertion_guard SELECT CASE WHEN EXISTS(SELECT 1 FROM budget_reservations WHERE reservation_id=? AND owner_id='owner' AND status='active') AND EXISTS(SELECT 1 FROM cost_budget_reservations WHERE reservation_id=? AND owner_id='owner' AND status='active') THEN 1 ELSE 0 END`).bind(token.reservationId,cost.reservationId)]};
}

test('preparing child statements does not reserve account funds or create jobs',async()=>{
 const {sqlite,env}=fixture();await prepare(env,'one');
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM budget_reservations').get().n,0);
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM cost_budget_reservations').get().n,0);
 assert.equal(sqlite.prepare('SELECT COALESCE(SUM(reserved_microusd),0) AS n FROM cost_budget_counters').get().n,0);
});
test('two children reserve once; grant cap is not a second account debit',async()=>{
 const {sqlite,env}=fixture();const a=await prepare(env,'one'),b=await prepare(env,'two');
 await env.DB.batch([...a.statements,...b.statements,env.DB.prepare("INSERT INTO job_fixture VALUES('one'),('two')")]);
 const counter=sqlite.prepare("SELECT reserved_microusd FROM cost_budget_counters WHERE scope='user' AND period='2026-08'").get();
 assert.equal(counter.reserved_microusd,2_000_000);
 await settleCostBudget(env,'owner',a.cost.reservationId,100_000);
 assert.equal((await settleCostBudget(env,'owner',a.cost.reservationId,100_000)).settled,false);
 assert.deepEqual({...sqlite.prepare("SELECT used_microusd,reserved_microusd FROM cost_budget_counters WHERE scope='user' AND period='2026-08'").get()},{used_microusd:100_000,reserved_microusd:1_000_000});
});
test('late job insertion failure rolls both children and all account counters back',async()=>{
 const {sqlite,env}=fixture();const a=await prepare(env,'one'),b=await prepare(env,'two');
 await assert.rejects(env.DB.batch([...a.statements,...b.statements,env.DB.prepare("INSERT INTO job_fixture VALUES('collision'),('collision')")]),/UNIQUE/);
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM budget_reservations').get().n,0);
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM cost_budget_reservations').get().n,0);
 assert.equal(sqlite.prepare('SELECT COALESCE(SUM(reserved_microusd),0) AS n FROM cost_budget_counters').get().n,0);
});
test('zero-row budget refusal triggers an in-transaction guard and rolls earlier token reservation back',async()=>{
 const {sqlite,env}=fixture();const a=await prepare(env,'one');
 sqlite.prepare("UPDATE cost_budget_counters SET used_microusd=hard_limit_microusd WHERE scope='user'").run();
 await assert.rejects(env.DB.batch([...a.statements,env.DB.prepare("INSERT INTO job_fixture VALUES('one')")]),/CHECK/);
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM budget_reservations').get().n,0);
 assert.equal(sqlite.prepare('SELECT COALESCE(SUM(reserved_tokens),0) AS n FROM budget_counters').get().n,0);
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM job_fixture').get().n,0);
});
test('true cost above estimate is recorded and settlement replay cannot hide or repeat it',async()=>{
 const {sqlite,env}=fixture();const a=await prepare(env,'over');await env.DB.batch(a.statements);
 const settled=await settleCostBudget(env,'owner',a.cost.reservationId,1_200_000);
 assert.equal(settled.usedMicrousd,1_200_000);
 assert.equal((await settleCostBudget(env,'owner',a.cost.reservationId,100_000)).settled,false);
 assert.deepEqual({...sqlite.prepare("SELECT used_microusd,reserved_microusd FROM cost_budget_counters WHERE scope='user' AND period='2026-08'").get()},{used_microusd:1_200_000,reserved_microusd:0});
 await settleBudget(env,'owner',a.token.reservationId,10);
});
