import assert from "node:assert/strict";
import test from "node:test";
import { outputTestDatabase, registerOutputSourceImports } from "./output-execution-test-helpers.mjs";
registerOutputSourceImports();
const { issueOutputGovernanceWitness, readOutputGovernanceWitness } = await import("../worker/output-governance-witness.ts");
const { createOutputAdmissionReads, readOutputAdmissionValue, outputAdmissionGovernanceAssertions } = await import("../worker/output-admission-reads.ts");
const { ensureSchema } = await import("../worker/runtime.ts");
const { outputAssertionStatements } = await import("../worker/output-requirements-ledger.ts");

function identity(env = { DB: {} }) {
  return { env, request: new Request("https://forma.test/api/output-requirements", { method: "POST" }),
    actorUserId: "actor", ownerUserId: "owner", organizationId: "organization", projectAccessId: "access",
    projectId: "project", documentId: "document", contextId: "selection", sourceDigest: "a".repeat(64), contextSnapshotDigest: "b".repeat(64) };
}
const admissionIdentity = ({ request, env, actorUserId, organizationId, projectAccessId, documentId }) =>
  ({ request, env, actorUserId, billingUserId: actorUserId, organizationId, projectAccessId, documentId });
const source = ({ ownerUserId, projectId, contextId, sourceDigest, contextSnapshotDigest }) => ({ ownerUserId, projectId, contextId, sourceDigest, contextSnapshotDigest });
const denied = error => error?.code === "output_source_governance_unavailable";

test("governance witnesses have no wire representation and cannot be forged from a boolean, copied shape or JSON", () => {
  const i = identity(), assertions = [{ sql: "1=1" }], witness = issueOutputGovernanceWitness(i, assertions);
  assert.equal(JSON.stringify(witness), "{}"); assert.deepEqual(Reflect.ownKeys(witness), []);
  assert.deepEqual(readOutputGovernanceWitness(witness, i), assertions);
  for (const forged of [true, false, null, {}, { checked: true }, { ...witness }, structuredClone(witness), JSON.parse(JSON.stringify(witness))]) {
    assert.throws(() => readOutputGovernanceWitness(forged, i), denied);
    assert.throws(() => createOutputAdmissionReads(admissionIdentity(i), { witness: forged, source: source(i) }), denied);
  }
});

test("a witness binds the exact request, database, source snapshot and every scoped identity", () => {
  const i = identity(), witness = issueOutputGovernanceWitness(i, [{ sql: "1=1" }]);
  for (const key of ["actorUserId", "ownerUserId", "organizationId", "projectAccessId", "projectId", "documentId", "contextId", "sourceDigest", "contextSnapshotDigest"]) {
    assert.throws(() => readOutputGovernanceWitness(witness, { ...i, [key]: `${i[key]}-other` }), denied, key);
  }
  assert.throws(() => readOutputGovernanceWitness(witness, { ...i, request: new Request(i.request) }), denied);
  assert.throws(() => readOutputGovernanceWitness(witness, { ...i, env: { ...i.env } }), denied);
  const previous = i.env.DB; i.env.DB = {};
  assert.throws(() => readOutputGovernanceWitness(witness, i), denied, "replacing a binding inside the same environment cannot borrow the proof");
  i.env.DB = previous; assert.deepEqual(readOutputGovernanceWitness(witness, i), [{ sql: "1=1" }]);
});

test("witness assertion copies cannot alter the stored proof or expose it in the request cache object", async () => {
  const i = identity(), original = [{ sql: "EXISTS(SELECT 1 WHERE ?=?)", bindings: ["private proof", "private proof"] }];
  const witness = issueOutputGovernanceWitness(i, original); original[0].sql = "1=1"; original[0].bindings[0] = "changed";
  const expected = [{ sql: "EXISTS(SELECT 1 WHERE ?=?)", bindings: ["private proof", "private proof"] }];
  assert.deepEqual(readOutputGovernanceWitness(witness, i), expected);
  const first = readOutputGovernanceWitness(witness, i); first[0].sql = "1=0"; first[0].bindings.push("changed");
  const cache = createOutputAdmissionReads(admissionIdentity(i), { witness, source: source(i) });
  assert.equal(JSON.stringify(cache), "{}"); assert.deepEqual(outputAdmissionGovernanceAssertions(cache), expected);
  const exported = outputAdmissionGovernanceAssertions(cache); exported[0].bindings[0] = "changed";
  assert.deepEqual(outputAdmissionGovernanceAssertions(cache), expected);
  let oldRightsReads = 0, otherReads = 0;
  assert.equal(await readOutputAdmissionValue(cache, "governed-source-rights", async () => { oldRightsReads++; return false; }), true);
  assert.equal(await readOutputAdmissionValue(cache, "provider-health", async () => { otherReads++; return "healthy"; }), "healthy");
  assert.equal(oldRightsReads, 0); assert.equal(otherReads, 1, "the proof only replaces the already performed governance read");
});

test("without a validated witness the canonical governance read remains required", async () => {
  const i = identity(), cache = createOutputAdmissionReads(admissionIdentity(i)); let reads = 0;
  assert.equal(await readOutputAdmissionValue(cache, "governed-source-rights", async () => { reads++; return false; }), false);
  assert.equal(reads, 1); assert.deepEqual(outputAdmissionGovernanceAssertions(cache), []);
});

test("an admission cache cannot survive a database replacement after the witness was consumed", async () => {
  const i = identity(), witness = issueOutputGovernanceWitness(i, [{ sql: "1=1" }]);
  const cache = createOutputAdmissionReads(admissionIdentity(i), { witness, source: source(i) }); i.env.DB = {};
  assert.throws(() => readOutputAdmissionValue(cache, "governed-source-rights", async () => true), /output_admission_read_scope_mismatch/u);
  assert.throws(() => outputAdmissionGovernanceAssertions(cache), /output_admission_read_scope_mismatch/u);
});

for (const mutation of [null, "revoked", "changed-private-body", "expired"]) test(`retained witness SQL guards the entire later admission transaction: ${mutation ?? "current"}`, async t => {
  const f = outputTestDatabase(); t.after(() => f.sqlite.close()); await ensureSchema(f.env);
  f.sqlite.exec("CREATE TABLE witness_license(id TEXT PRIMARY KEY,active INTEGER,private_body TEXT,expires_at TEXT); CREATE TABLE witness_admissions(id TEXT PRIMARY KEY); CREATE TABLE witness_counter(reserved INTEGER); INSERT INTO witness_counter VALUES(0);");
  f.sqlite.prepare("INSERT INTO witness_license VALUES('license',1,'retained private proof',?)").run(new Date(Date.now() + 60_000).toISOString());
  const checkedAssertions = [{ sql: "EXISTS(SELECT 1 FROM witness_license WHERE id=? AND active=1 AND private_body=? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))", bindings: ["license", "retained private proof"] }];
  // Mirror the server mint point: every assertion has passed a completed read
  // before issuing the request-local witness. These are real SQLite predicates.
  const checked = await f.env.DB.batch(checkedAssertions.map(a => f.env.DB.prepare(`SELECT CASE WHEN (${a.sql}) THEN 1 ELSE 0 END AS current`).bind(...a.bindings)));
  assert.equal(checked.every(result => result.results[0].current === 1), true);
  const i = identity(f.env), witness = issueOutputGovernanceWitness(i, checkedAssertions);
  const cache = createOutputAdmissionReads(admissionIdentity(i), { witness, source: source(i) });
  assert.equal(await readOutputAdmissionValue(cache, "governed-source-rights", async () => { throw new Error("duplicate read must not run"); }), true);
  if (mutation === "revoked") f.sqlite.exec("UPDATE witness_license SET active=0");
  if (mutation === "changed-private-body") f.sqlite.exec("UPDATE witness_license SET private_body='other source'");
  if (mutation === "expired") f.sqlite.prepare("UPDATE witness_license SET expires_at=?").run(new Date(Date.now() - 1).toISOString());
  const commit = () => f.env.DB.batch([f.env.DB.prepare("INSERT INTO witness_admissions VALUES('same-admission')"), f.env.DB.prepare("UPDATE witness_counter SET reserved=128000"),
    ...outputAdmissionGovernanceAssertions(cache).flatMap(a => outputAssertionStatements(f.env, a))]);
  if (mutation) await assert.rejects(commit, /CHECK constraint/u); else await commit();
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM witness_admissions").get().n, mutation ? 0 : 1);
  assert.equal(f.sqlite.prepare("SELECT reserved FROM witness_counter").get().reserved, mutation ? 0 : 128000);
});
