import assert from "node:assert/strict";
import test from "node:test";
import { selectedOutputShareMediaFixture as fixture, OWNER, DOCUMENT, EXPIRY } from "./helpers/selected-output-share-media-fixture.mjs";
import { retainAuthoredMedia, retainOriginalMediaRestore } from "./helpers/native-media-custody-fixture.mjs";
import { registerOutputSourceImports } from "./output-server-test-helpers.mjs";
import { selectedShareProofStatement } from "../worker/selected-output-share-proof.ts";
const imports = registerOutputSourceImports();
let api, SPONSOR_ENTITLEMENT_SCHEMA, SPONSOR_INTAKE_SCHEMA;
try {
  api = await import("../worker/selected-output-share-authority.ts");
  ({ SPONSOR_ENTITLEMENT_SCHEMA } = await import("../worker/experience-sponsor-entitlement.ts"));
  ({ SPONSOR_INTAKE_SCHEMA } = await import("../worker/experience-sponsor-intake.ts"));
} finally { imports.deregister(); }
const unavailable = /selected_output_share_authority_unavailable/u;
const evaluate = async (f, proof) => {
  const statement = selectedShareProofStatement(api.selectedOutputShareAuthorityAssertion(proof, f.env));
  return (await f.env.DB.prepare(`${statement.withSql} SELECT 1 AS admitted WHERE ${statement.sql}`).bind(...statement.bindings).first())?.admitted ?? 0;
};
for (const output of ["audio", "video", "model3d"]) test(`ordinary ${output} original authority performs no writes or media reads`, async t => {
  const f = await fixture(t, output, { editable: output === "video" });
  const before = f.changes(), proof = await f.authority();
  assert.equal(await evaluate(f, proof), 1);
  assert.equal(f.changes(), before); assert.equal(f.mediaCalls.length, 0);
  assert.equal(api.selectedOutputShareAuthoritySnapshot(proof, f.env).jobId, f.jobId);
});
for (const output of ["audio", "video", "model3d"]) test(`ordinary ${output} current edit is not replaced with its original`, async t => {
  const f = await fixture(t, output, { editable: output === "video" });
  const original = await f.authority(), edit = await retainAuthoredMedia(f), current = await f.authority(edit.selection);
  assert.equal(await evaluate(f, original), 0); assert.equal(await evaluate(f, current), 1);
  const restored = await retainOriginalMediaRestore(f), proof = await f.authority(restored.selection);
  assert.equal(await evaluate(f, current), 0); assert.equal(await evaluate(f, proof), 1);
});
test("slotted Audio original, authored trim and restore retain paid personal provenance", async t => {
  const f = await fixture(t, "audio", { slot: true });
  assert.equal(await evaluate(f, await f.authority()), 1);
  const edit = await retainAuthoredMedia(f); assert.equal(await evaluate(f, await f.authority(edit.selection)), 1);
  const restore = await retainOriginalMediaRestore(f); assert.equal(await evaluate(f, await f.authority(restore.selection)), 1);
  assert.equal(f.mediaCalls.length, 0);
});
for (const key of ["payer_user_id", "actor_user_id", "context_id"]) test(`slotted Audio refuses changed ${key}`, async t => {
  const f = await fixture(t, "audio", { slot: true });
  const custody = await f.readCustody();
  f.sqlite.prepare(`UPDATE output_execution_grants SET ${key}='different'`).run();
  await assert.rejects(api.readSelectedOutputShareMediaAuthority(f.env, custody), unavailable);
});
for (const output of ["video", "model3d"]) test(`slotted ${output} requires the actual original receipt bridge`, async t => {
  const f = await fixture(t, output, { slot: true });
  await assert.rejects(f.authority(), output === "video" ? /output_video_retained_unavailable/u : unavailable);
});
for (const column of ["request_json", "result_json"]) for (const value of [undefined, null, {}, { bad: "reference" }]) test(`Audio ${column} output reference ${JSON.stringify(value)} refuses`, async t => {
  const f = await fixture(t, "audio", { slot: true }), row = JSON.parse(f.job()[column]);
  if (value === undefined) delete row.outputExecution; else row.outputExecution = value;
  f.updateJob({ [column]: JSON.stringify(row) }); await assert.rejects(f.authority(), unavailable);
});
for (const key of ["outputVideoRecovery", "outputModel3dRecovery", "recovered", "workflowLineage", "sponsor_entitlement", "replacement"]) test(`private-only ${key} completion lineage refuses`, async t => {
  const f = await fixture(t, "audio"); f.changePrivate(body => { body[key] = false; });
  await assert.rejects(f.authority(), unavailable);
});
test("effective native source expiry bounds authored media authority", async t => {
  const f = await fixture(t, "video", { editable: true }), expiry = new Date(Date.now() + 3600000).toISOString();
  const edit = await retainAuthoredMedia(f, { sourceExpiresAt: expiry });
  assert.equal(api.selectedOutputShareAuthoritySnapshot(await f.authority(edit.selection), f.env).expiresAt, expiry);
});
test("source mutation before the final sibling proof refuses issuance", async t => {
  const f = await fixture(t, "audio"), custody = await f.readCustody();
  f.setBeforeRead(sql => { if (sql.startsWith("WITH selected_share_proof_0")) f.updateJob({ status: "failed" }); });
  await assert.rejects(api.readSelectedOutputShareMediaAuthority(f.env, custody), unavailable);
});
test("late paid-payer mutation invalidates the exact exported assertion", async t => {
  const f = await fixture(t, "audio", { slot: true }), proof = await f.authority();
  f.sqlite.prepare("UPDATE output_execution_grants SET payer_user_id='sponsor'").run();
  assert.equal(await evaluate(f, proof), 0);
});
test("media capability and authority reject forgery, copied object, other env and cancellation", async t => {
  const f = await fixture(t, "audio"), controller = new AbortController(), custody = await f.readCustody(f.select(), controller.signal);
  for (const fake of [{}, { ...custody }, new Proxy(custody, {})]) await assert.rejects(api.readSelectedOutputShareMediaAuthority(f.env, fake), unavailable);
  const proof = await api.readSelectedOutputShareMediaAuthority(f.env, custody);
  for (const fake of [{}, { ...proof }, new Proxy(proof, {})]) assert.throws(() => api.selectedOutputShareAuthoritySnapshot(fake, f.env), unavailable);
  assert.throws(() => api.selectedOutputShareAuthoritySnapshot(proof, { ...f.env }), unavailable);
  const assertion = api.selectedOutputShareAuthorityAssertion(proof, f.env); assert.equal(assertion.length, 4);
  assert.ok(Object.isFrozen(assertion)); assert.deepEqual(Reflect.ownKeys(proof), []);
  controller.abort(); assert.throws(() => api.selectedOutputShareAuthoritySnapshot(proof, f.env), /retained_story_unavailable/u);
});
const tables = [
  ["experience_sponsor_consumptions", SPONSOR_ENTITLEMENT_SCHEMA, "job_id"],
  ["experience_sponsor_active_jobs", SPONSOR_ENTITLEMENT_SCHEMA, "job_id"],
  ["experience_sponsor_intakes", SPONSOR_INTAKE_SCHEMA, "document_id"],
];
for (const [name, ddl, linked] of tables) test(`optional ${name} absence and later schema appearance are both witnessed`, async t => {
  const f = await fixture(t, "audio"), proof = await f.authority();
  f.sqlite.exec(ddl.find(sql => sql.startsWith(`CREATE TABLE ${name}(`)));
  assert.equal(await evaluate(f, proof), 0);
  assert.equal(await evaluate(f, await f.authority()), 1);
  // The exact schema is real; use defaults from each table's current columns
  // only to seed a contradictory imported association, without sponsorship APIs.
  f.sqlite.exec("PRAGMA foreign_keys=OFF");
  try {
    const columns = f.sqlite.prepare(`PRAGMA table_info(${name})`).all();
    const record = Object.fromEntries(columns.filter(c => c.notnull || c.pk || c.name === linked).map(c => [c.name,
      c.name === linked ? linked === "job_id" ? f.jobId : DOCUMENT : c.name === "actor_user_id" ? OWNER
        : /INT/iu.test(c.type) ? 1 : c.name === "expires_at" ? EXPIRY : "synthetic"]));
    f.insert(name, record);
  } finally { f.sqlite.exec("PRAGMA foreign_keys=ON"); }
  await assert.rejects(f.authority(), unavailable);
});
