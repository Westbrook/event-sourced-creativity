// Actual routed intake/Worker controls; prepared only. Existing RAM authorization
// rows define the fixture. Date-field interleavings are not elapsed-wall-clock claims.
import assert from "node:assert/strict";
import test from "node:test";
import {createProjectIntakeFixture,captureUnsentIntake,assertComplete} from "./helpers/project-intake-fixture.mjs";
const options={concurrency:false,timeout:45000};
const future="2099-01-01T00:00:00.000Z",past="2000-01-01T00:00:00.000Z";
const eventCount=x=>x.worker.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE stream_id=?").get(x.worker.streamId).count;
const receipts=x=>x.worker.sqlite.prepare("SELECT * FROM event_client_receipts WHERE stream_id=? ORDER BY client_event_id").all(x.worker.streamId);
const complete=(events,result)=>assertComplete({body:{events},status:result.response.status,reply:result.body});
function configure(x,{status="active",participant=true,owner=false,successor=false,breakglass=false}={}){
  const db=x.worker.sqlite,actor=x.worker.owner,email=db.prepare("SELECT email FROM users WHERE user_id=?").get(actor).email;
  const now=new Date().toISOString(),organization="intake-cohort-org",configured="intake-cohort-original";
  db.prepare("UPDATE users SET role='creator' WHERE user_id=?").run(actor);
  db.prepare("INSERT INTO organizations(organization_id,name,owner_user_id,status,created_at,updated_at) VALUES(?,?,?,'active',?,?)")
    .run(organization,"Intake cohort fixture","other-fixture-owner",now,now);
  const cohort=(id,state,ends)=>db.prepare("INSERT INTO pilot_cohorts(cohort_id,organization_id,status,starts_at,ends_at,created_by_user_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
    .run(id,organization,state,past,ends,"other-fixture-owner",now,now);
  cohort(configured,status,status==="closed"?past:future);
  const active=successor?"intake-cohort-successor":configured;if(successor)cohort(active,"active",future);
  if(participant)db.prepare("INSERT INTO pilot_participants(participant_id,cohort_id,organization_id,email_normalized,user_id,role,status,invited_by_user_id,created_at) VALUES(?,?,?,?,?,'member','active',?,?)")
    .run("intake-cohort-participant",active,organization,email,actor,"other-fixture-owner",now);
  if(owner)db.prepare("INSERT INTO organization_memberships(membership_id,organization_id,user_id,role,status,invited_by_user_id,accepted_at,created_at,updated_at) VALUES(?,?,?,'owner','active',?,?,?,?)")
    .run("intake-owner-recovery",organization,actor,actor,now,now,now);
  x.worker.env.FORMA_PILOT_COHORT_ID=configured;
  if(breakglass)x.worker.env.FORMA_ADMIN_EMAILS=email;
  return{actor,email,configured,active,expire(){db.prepare("UPDATE pilot_cohorts SET ends_at=? WHERE cohort_id=?").run(past,active);},
    restore(){db.prepare("UPDATE pilot_cohorts SET ends_at=? WHERE cohort_id=?").run(future,active);}};
}

for(const status of ["active","paused"])test("intake configured named participant remains admitted: "+status,options,async t=>{
  const x=await createProjectIntakeFixture(t),events=await captureUnsentIntake(x);configure(x,{status});
  const result=await x.raw(events);complete(events,result);
  assert.equal(receipts(x).length,4);assert.equal(result.body.appended.length,4);
});

test("intake configured organization admits the actual active successor participant",options,async t=>{
  const x=await createProjectIntakeFixture(t),events=await captureUnsentIntake(x);configure(x,{status:"closed",successor:true});
  const result=await x.raw(events);complete(events,result);assert.equal(receipts(x).length,4);
});

test("intake exact configured owner recovery remains available without a current successor",options,async t=>{
  const x=await createProjectIntakeFixture(t),events=await captureUnsentIntake(x);configure(x,{status:"closed",participant:false,owner:true});
  const result=await x.raw(events);complete(events,result);
  const check=await x.raw(events,"check");complete(events,check);
  assert.deepEqual(check.body.appended,result.body.appended);assert.equal(receipts(x).length,4);
});

test("intake configured explicit breakglass preserves existing entry behavior",options,async t=>{
  const x=await createProjectIntakeFixture(t),events=await captureUnsentIntake(x);configure(x,{status:"closed",participant:false,breakglass:true});
  const result=await x.raw(events);complete(events,result);assert.equal(receipts(x).length,4);
});

test("intake owner recovery cannot bypass a live successor without named enrollment",options,async t=>{
  const x=await createProjectIntakeFixture(t),events=await captureUnsentIntake(x);configure(x,{status:"closed",participant:false,owner:true,successor:true});
  const before=eventCount(x),result=await x.raw(events);
  assert.equal(result.response.status,403);assert.equal(result.body.error,"pilot_participant_required");
  assert.equal(eventCount(x),before);assert.equal(receipts(x).length,0);
});

test("intake configured cohort expiry at the actual append batch aborts all original inserts",options,async t=>{
  const x=await createProjectIntakeFixture(t),events=await captureUnsentIntake(x),cohort=configure(x);
  const before=eventCount(x);let reached=false;
  x.worker.controls.beforeBatch=async statements=>{
    if(!reached&&statements.some(statement=>statement.sql.includes("VALUES(?,?,CASE WHEN")&&statement.sql.includes("event_client_receipts"))){reached=true;cohort.expire();}
  };
  const result=await x.raw(events);x.worker.controls.beforeBatch=null;
  t.diagnostic(JSON.stringify({reached,status:result.response.status,error:result.body.error,eventDelta:eventCount(x)-before,receipts:receipts(x).length}));
  assert.equal(reached,true);assert.equal(result.response.status,403);
  assert.equal(result.body.error,"project_intake_authority_changed");assert.equal(Object.hasOwn(result.body,"appended"),false);
  assert.equal(eventCount(x),before);assert.equal(receipts(x).length,0);
});

test("intake postcommit configured expiry withholds private receipt until a current exact Check",options,async t=>{
  const x=await createProjectIntakeFixture(t),events=await captureUnsentIntake(x),cohort=configure(x);
  const before=eventCount(x);let reads=0;
  x.worker.controls.beforeRead=async statement=>{if(statement.sql.includes("expected.value AS requested_key")&&++reads===2)cohort.expire();};
  const result=await x.raw(events);x.worker.controls.beforeRead=null;
  const original=receipts(x);
  t.diagnostic(JSON.stringify({reads,status:result.response.status,error:result.body.error,eventDelta:eventCount(x)-before,receipts:original.length}));
  assert.equal(reads,2);assert.equal(eventCount(x)-before,4);assert.equal(original.length,4);
  assert.equal(result.response.status,403);assert.equal(result.body.error,"project_intake_authority_changed");
  assert.equal(Object.hasOwn(result.body,"appended"),false);
  const denied=await x.raw(events,"check");assert.equal(denied.response.status,403);assert.equal(denied.body.error,"pilot_participant_required");
  cohort.restore();const current=await x.raw(events,"check");complete(events,current);
  assert.deepEqual(current.body.appended.map(event=>event.eventId),original.map(row=>row.event_id));
  assert.deepEqual(receipts(x),original);assert.equal(eventCount(x)-before,4);
});
