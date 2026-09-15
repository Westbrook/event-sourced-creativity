import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { slidesRenewalNoExecutionAssertion } from "../worker/experience-scene-renewal-proof.ts";
import type { OutputScope } from "../worker/output-command-core.ts";
const scope: OutputScope = { kind: "personal", key: "personal:actor:project", ownerUserId: "actor", actorUserId: "actor",
  documentId: "document", projectId: "project", organizationId: null, projectAccessId: null, contextId: null };
function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE events(event_id TEXT,payload TEXT,stream_id TEXT,type TEXT);
    CREATE TABLE output_commands(scope_key TEXT,action TEXT,event_id TEXT);
    CREATE TABLE output_plan_revisions(scope_key TEXT,plan_revision_id TEXT,document_id TEXT,owner_user_id TEXT,project_id TEXT);
    CREATE TABLE output_execution_grants(scope_key TEXT,plan_revision_id TEXT);
    CREATE TABLE output_operation_slots(scope_key TEXT,slot_id TEXT,plan_revision_id TEXT,job_id TEXT,token_reservation_id TEXT,cost_reservation_id TEXT);
    CREATE TABLE document_jobs(owner_id TEXT,document_id TEXT,job_id TEXT,stream_id TEXT);
    CREATE TABLE budget_reservations(reservation_id TEXT,owner_id TEXT,stream_id TEXT,correlation_id TEXT,operation TEXT,status TEXT);
    CREATE TABLE cost_budget_reservations(reservation_id TEXT,owner_id TEXT,stream_id TEXT,correlation_id TEXT,operation TEXT,status TEXT);
    CREATE TABLE output_provider_calls(scope_key TEXT,slot_id TEXT);`);
  const proof = slidesRenewalNoExecutionAssertion(scope);
  return { db, pass: () => db.prepare(`SELECT CASE WHEN (${proof.sql}) THEN 1 ELSE 0 END AS passed`).get(...proof.bindings!)!.passed === 1 };
}
for (const table of ["budget_reservations", "cost_budget_reservations"]) for (const status of ["active", "settled", "cancelled"]) {
  test(`orphan ${status} ${table} blocks Slides renewal`, () => {
    const { db, pass } = fixture();
    try { assert.equal(pass(), true); db.prepare(`INSERT INTO ${table} VALUES(?,?,?,?,?,?)`).run("r", "actor", "creative:actor", "random-job", "document-render:slides", status); assert.equal(pass(), false); }
    finally { db.close(); }
  });
}
test("only consistent other-Document reservation links are excluded, irrespective settled status", () => {
  const { db, pass } = fixture();
  try {
    db.exec(`INSERT INTO output_plan_revisions VALUES('personal:actor:other-project','p','other-document','actor','other-project');
      INSERT INTO output_operation_slots VALUES('personal:actor:other-project','s','p','job','token','cost');
      INSERT INTO document_jobs VALUES('actor','other-document','job','creative:actor');
      INSERT INTO budget_reservations VALUES('token','actor','creative:actor','job:attempt:1','document-render:slides','settled');
      INSERT INTO cost_budget_reservations VALUES('cost','actor','creative:actor','job:recovery:00000000-0000-4000-8000-000000000001','document-render:slides','settled');`);
    assert.equal(pass(), true);
    for (const sql of ["UPDATE document_jobs SET document_id='wrong'", "UPDATE cost_budget_reservations SET correlation_id='other-job'",
      "UPDATE output_plan_revisions SET owner_user_id='wrong'", "UPDATE output_operation_slots SET token_reservation_id='missing'",
      "UPDATE cost_budget_reservations SET stream_id='wrong'", "DELETE FROM document_jobs", "DELETE FROM output_plan_revisions",
      "UPDATE output_plan_revisions SET document_id=' '", "UPDATE budget_reservations SET correlation_id='job:attempt:'",
      "UPDATE budget_reservations SET correlation_id='job:attempt:abc'", "UPDATE budget_reservations SET correlation_id='job:attempt:0'",
      "UPDATE cost_budget_reservations SET correlation_id='job:recovery:receipt'"]) {
      db.exec("SAVEPOINT mutation"); db.exec(sql); assert.equal(pass(), false, sql); db.exec("ROLLBACK TO mutation; RELEASE mutation");
    }
  } finally { db.close(); }
});
test("current Document financial evidence and orphan indexes block even without receipt history", () => {
  for (const sql of [
    "INSERT INTO document_jobs VALUES('actor','document','job','creative:actor')",
    "INSERT INTO output_execution_grants VALUES('personal:actor:project','missing')",
    "INSERT INTO output_operation_slots VALUES('personal:actor:project','s','missing','job','t','c')",
    "INSERT INTO output_provider_calls VALUES('personal:actor:project','missing')",
    "INSERT INTO output_commands VALUES('personal:actor:project','authorize','missing')",
    "INSERT INTO events VALUES('e','invalid','creative:actor','OutputExecutionAuthorized')",
  ]) { const { db, pass } = fixture(); try { db.exec(sql); assert.equal(pass(), false, sql); } finally { db.close(); } }
});
test("missing evidence table never becomes positive absence", () => {
  const { db, pass } = fixture(); try { db.exec("DROP TABLE cost_budget_reservations"); assert.throws(pass); } finally { db.close(); }
});
