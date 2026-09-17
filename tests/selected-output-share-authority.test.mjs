import assert from "node:assert/strict";
import test from "node:test";
import { registerOutputSourceImports } from "./output-server-test-helpers.mjs";
import { selectedOutputShareFixture, OWNER, EMAIL, DOCUMENT, PROJECT, ARTIFACT, JOB, EXPIRY } from "./helpers/selected-output-share-fixture.mjs";
import { selectedShareProofStatement } from "../worker/selected-output-share-proof.ts";

const imports = registerOutputSourceImports();
let readNativeRetainedTextCustody, readSelectedOutputShareAuthority, selectedOutputShareAuthoritySnapshot;
let selectedOutputShareAuthorityAssertion, SPONSOR_ENTITLEMENT_SCHEMA, SPONSOR_INTAKE_SCHEMA;
try {
  ({ readNativeRetainedTextCustody } = await import("../worker/native-retained-text-custody.ts"));
  ({ readSelectedOutputShareAuthority, selectedOutputShareAuthoritySnapshot, selectedOutputShareAuthorityAssertion }
    = await import("../worker/selected-output-share-authority.ts"));
  ({ SPONSOR_ENTITLEMENT_SCHEMA } = await import("../worker/experience-sponsor-entitlement.ts"));
  ({ SPONSOR_INTAKE_SCHEMA } = await import("../worker/experience-sponsor-intake.ts"));
} finally { imports.deregister(); }

const fixture = (t, options = {}) => selectedOutputShareFixture(t, { installShareSchema: false, ...options });
const unavailable = /selected_output_share_authority_unavailable/u;
const custody = f => readNativeRetainedTextCustody(f.env, f.identity, f.selection());
const authority = async f => readSelectedOutputShareAuthority(f.env, await custody(f));
const evaluate = async (f, proof) => {
  const statement = selectedShareProofStatement(selectedOutputShareAuthorityAssertion(proof, f.env));
  return (await f.env.DB.prepare(`${statement.withSql} SELECT 1 AS admitted WHERE ${statement.sql}`)
    .bind(...statement.bindings).first())?.admitted ?? 0;
};

test("bounded slot JSON preserves the original exact bytes, key order and every NULL field", async t => {
  const columns = ["scope_key", "slot_id", "grant_id", "plan_revision_id", "target_id", "target_contract_digest", "source_digest",
    "job_id", "route_digest", "attempt_ordinal", "previous_slot_id", "status", "outcome_event_id", "provider", "model",
    "cost_reservation_id", "token_reservation_id", "maximum_microusd", "maximum_calls", "maximum_tokens"];
  const keys = ["scopeKey", "slotId", "grantId", "planRevisionId", "targetId", "targetContractDigest", "sourceDigest",
    "jobId", "routeDigest", "attemptOrdinal", "previousSlotId", "status", "outcomeEventId", "provider", "model",
    "costReservationId", "tokenReservationId", "maximumMicrousd", "maximumCalls", "maximumTokens"];
  const original = `json_object(${keys.flatMap((key, index) => [`'${key}'`, `slot.${columns[index]}`]).join(",")})`;
  for (const slot of [undefined, "actor"]) await t.test(slot ?? "legacy NULL slot", async child => {
    const f = await fixture(child, { slot });
    await authority(f);
    const statement = f.statements.find(value => value.sql.startsWith("WITH selected_share_jobs AS ("));
    assert.ok(statement, "execute the actual complete provenance query");
    const originalSql = statement.sql.replace(/json_set\(json_object\('scopeKey',[\s\S]*?slot\.maximum_tokens\)/u, original);
    assert.notEqual(originalSql, statement.sql, "compare the bounded expression to its original 40-argument representation");
    const current = f.sqlite.prepare(statement.sql).get(...statement.bindings).witness;
    assert.equal(current, f.sqlite.prepare(originalSql).get(...statement.bindings).witness);
    const projected = JSON.parse(current).slot;
    assert.deepEqual(Object.keys(projected), keys);
    assert.equal(projected.previousSlotId, null);
    if (!slot) assert.ok(Object.values(projected).every(value => value === null));
  });
});
const mutateJson = (f, column, mutate) => {
  const value = JSON.parse(f.job()[column]);
  mutate(value);
  f.updateJob({ [column]: JSON.stringify(value) });
};
const mutateAuthorization = (f, mutate) => {
  const row = f.sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=?").get(f.authorization.eventId);
  const value = JSON.parse(row.private_json);
  mutate(value);
  f.sqlite.prepare("UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?")
    .run(JSON.stringify(value), f.authorization.eventId);
};

// Install the exact optional table DDL, not a mock query response. These tests
// intentionally seed contradictory imported records under FK OFF, then restore
// FK enforcement; no sponsor admission or entitlement operation is exercised.
const optionalTables = {
  experience_sponsor_consumptions: SPONSOR_ENTITLEMENT_SCHEMA.find(sql => sql.startsWith("CREATE TABLE experience_sponsor_consumptions(")),
  experience_sponsor_active_jobs: SPONSOR_ENTITLEMENT_SCHEMA.find(sql => sql.startsWith("CREATE TABLE experience_sponsor_active_jobs(")),
  experience_sponsor_intakes: SPONSOR_INTAKE_SCHEMA.find(sql => sql.startsWith("CREATE TABLE experience_sponsor_intakes(")),
};
function installOptional(f, name) { f.sqlite.exec(optionalTables[name]); }
function insertOptional(f, name, linked = true) {
  f.sqlite.exec("PRAGMA foreign_keys=OFF");
  try {
    if (name === "experience_sponsor_consumptions") f.insert(name, {
      consumption_id: "synthetic-consumption", grant_id: "synthetic-sponsor-grant", campaign_id: "synthetic-campaign",
      actor_user_id: OWNER, session_digest: "synthetic-session", intent_key: "synthetic-intent", envelope_digest: "synthetic-envelope",
      job_id: linked ? JOB : "unrelated-job", maximum_microusd: 1, admitted_at_ms: 1,
    });
    else if (name === "experience_sponsor_active_jobs") f.insert(name, {
      actor_user_id: OWNER, consumption_id: "synthetic-consumption", job_id: linked ? JOB : "unrelated-job",
    });
    else f.insert(name, {
      receipt_id: "synthetic-intake", resource_id: "synthetic-resource", campaign_id: "synthetic-campaign",
      policy_digest: "synthetic-policy", limits_digest: "synthetic-limits", actor_user_id: OWNER,
      session_digest: "synthetic-session", native_intent_id: "synthetic-intent", draft_id: "synthetic-draft",
      project_id: PROJECT, document_id: linked ? DOCUMENT : "unrelated-document", draft_hash: "synthetic-draft-hash",
      body_digest: "synthetic-body", content_digest: "synthetic-content", source_digest: "synthetic-source",
      content_bytes: 1, expires_at: EXPIRY, recorded_at_ms: 1,
    });
  } finally { f.sqlite.exec("PRAGMA foreign_keys=ON"); }
}

test("native text sharing authority accepts retained legacy and personal actor-paid completions without writes", async t => {
  for (const kind of ["short_story", "scene", "slides"]) for (const slot of [undefined, "actor"]) {
    await t.test(`${kind} / ${slot ?? "legacy"}`, async child => {
      const f = await fixture(child, { kind, slot });
      const before = f.changes(), proof = await authority(f);
      assert.deepEqual(Object.keys(proof), []);
      assert.equal(Object.isFrozen(proof), true);
      assert.deepEqual(selectedOutputShareAuthoritySnapshot(proof, f.env), {
        jobId: JOB, completionId: f.completion.eventId, expiresAt: EXPIRY,
      });
      assert.equal(await evaluate(f, proof), 1);
      assert.equal(f.changes(), before);
      assert.equal(f.calls.every(sql => /^\s*(?:SELECT|WITH)\b/iu.test(sql)), true);
    });
  }
});

test("the native job must exactly identify one completed selected-output lineage", async t => {
  const cases = {
    "missing job": f => f.sqlite.prepare("DELETE FROM document_jobs WHERE job_id=?").run(JOB),
    "different owner": f => f.updateJob({ owner_id: "another-owner" }),
    "different stream": f => f.updateJob({ stream_id: "creative:another-owner" }),
    "different document": f => f.updateJob({ document_id: "another-document" }),
    "wrong job kind": f => f.updateJob({ kind: "generate_image" }),
    "unfinished job": f => f.updateJob({ status: "running" }),
    "wrong native surface": f => f.updateJob({ source_surface: "untrusted-surface" }),
    "different correlation": f => f.updateJob({ correlation_id: "another-correlation" }),
    "expired retention": f => f.updateJob({ expires_at: "2020-01-01T00:00:00.000Z" }),
    "invalid expiry": f => f.updateJob({ expires_at: "tomorrow" }),
    "malformed request": f => f.updateJob({ request_json: "{" }),
    "malformed result": f => f.updateJob({ result_json: "{" }),
    "request kind differs": f => mutateJson(f, "request_json", value => { value.artifactKind = "scene"; }),
    "non-manual production": f => mutateJson(f, "request_json", value => { value.productionMode = "workflow"; }),
    "workflow marker including null": f => mutateJson(f, "request_json", value => { value.workflowId = null; }),
    "result kind differs": f => mutateJson(f, "result_json", value => { value.artifactKind = "scene"; }),
    "result artifact differs": f => mutateJson(f, "result_json", value => { value.artifactId = "another-artifact"; }),
    "completion absent from result": f => mutateJson(f, "result_json", value => { value.appendedEventIds = []; }),
    "completion duplicated in result": f => mutateJson(f, "result_json", value => { value.appendedEventIds.push(f.completion.eventId); }),
    "request above byte cap": f => mutateJson(f, "request_json", value => { value.untrusted = "x".repeat(131072); }),
    "result above byte cap": f => mutateJson(f, "result_json", value => { value.untrusted = "x".repeat(131072); }),
    "ambiguous native job": f => f.insert("document_jobs", { ...f.job(), job_id: "duplicate-native-job" }),
  };
  for (const [name, mutate] of Object.entries(cases)) await t.test(name, async child => {
    const f = await fixture(child), source = await custody(f);
    mutate(f);
    const before = f.changes();
    await assert.rejects(readSelectedOutputShareAuthority(f.env, source), unavailable);
    assert.equal(f.changes(), before);
  });
});

test("a current output without a proven native renderer completion is unavailable", async t => {
  for (const [field, value] of [["completionActor", "user:forged"], ["completionClientId", "untrusted-client"]]) await t.test(field, async child => {
    const f = await fixture(child, { [field]: value }), source = await custody(f);
    await assert.rejects(readSelectedOutputShareAuthority(f.env, source), unavailable);
  });
});

test("dynamic origin requires a completed personal actor-paid grant and exact succeeded slot", async t => {
  const cases = {
    "slot missing": f => f.sqlite.prepare("DELETE FROM output_operation_slots").run(),
    "slot job contradicts reference": f => f.sqlite.prepare("UPDATE output_operation_slots SET job_id='different-job'").run(),
    "unfinished slot": f => f.sqlite.prepare("UPDATE output_operation_slots SET status='running'").run(),
    "slot completion differs": f => f.sqlite.prepare("UPDATE output_operation_slots SET outcome_event_id='different-completion'").run(),
    "different plan owner": f => f.sqlite.prepare("UPDATE output_plan_revisions SET owner_user_id='another-owner'").run(),
    "different plan document": f => f.sqlite.prepare("UPDATE output_plan_revisions SET document_id='another-document'").run(),
    "different plan project": f => f.sqlite.prepare("UPDATE output_plan_revisions SET project_id='another-project'").run(),
    "governed project plan": f => f.sqlite.prepare("UPDATE output_plan_revisions SET scope_kind='project',organization_id='organization',project_access_id='access'").run(),
    "different actor": f => f.sqlite.prepare("UPDATE output_execution_grants SET actor_user_id='another-actor'").run(),
    "different payer": f => f.sqlite.prepare("UPDATE output_execution_grants SET payer_user_id='sponsor-payer'").run(),
    "selected project context": f => f.sqlite.prepare("UPDATE output_execution_grants SET context_id='selected-context'").run(),
    "unfinished grant": f => f.sqlite.prepare("UPDATE output_execution_grants SET status='active'").run(),
    "grant was revoked": f => f.sqlite.prepare("UPDATE output_execution_grants SET status='revoked'").run(),
    "source digest contradicts plan": f => f.sqlite.prepare("UPDATE output_operation_slots SET source_digest=?").run(`sha256:${"a".repeat(64)}`),
    "native surface contradicts slot": f => f.updateJob({ source_surface: "document" }),
  };
  for (const [name, mutate] of Object.entries(cases)) await t.test(name, async child => {
    const f = await fixture(child, { slot: "actor" }), source = await custody(f);
    mutate(f);
    await assert.rejects(readSelectedOutputShareAuthority(f.env, source), unavailable);
  });
});

test("both stored job references must bind the exact dynamic slot with bounded closed fields", async t => {
  for (const column of ["request_json", "result_json"]) for (const [name, mutate] of [
    ["missing", value => { delete value.outputExecution; }],
    ["null", value => { value.outputExecution = null; }],
    ["wrong slot", value => { value.outputExecution.slotId = "other-slot"; }],
    ["wrong target", value => { value.outputExecution.targetId = "other-target"; }],
    ["extra field", value => { value.outputExecution.sponsor = false; }],
    ["unbounded identity", value => { value.outputExecution.scopeKey = "x".repeat(1024); }],
  ]) await t.test(`${column} / ${name}`, async child => {
    const f = await fixture(child, { slot: "actor" }), source = await custody(f);
    mutateJson(f, column, mutate);
    await assert.rejects(readSelectedOutputShareAuthority(f.env, source), unavailable);
  });
});

test("Slides provenance preserves the native maximum of fifteen requested slides", async t => {
  const f = await fixture(t, { kind: "slides", request: { itemCount: 16 } }), source = await custody(f);
  await assert.rejects(readSelectedOutputShareAuthority(f.env, source), unavailable);
});

test("an oversized second slot authorization cannot disappear from the unique native-job witness", async t => {
  const f = await fixture(t, { slot: "actor" }), source = await custody(f);
  const proof = await readSelectedOutputShareAuthority(f.env, source);
  // Simulate corrupt/imported storage beyond the normal uniqueness guard.
  // The first valid slot must not survive as apparently unique after the second
  // row is removed by its private-body byte bound.
  f.sqlite.exec("DROP INDEX idx_output_operation_slots_unique_3");
  const authorization = await f.append("OutputExecutionAuthorized", { untrusted: "x".repeat(131072) });
  const preflight = f.sqlite.prepare("SELECT * FROM output_preflights").get();
  f.insert("output_preflights", { ...preflight, preflight_id: "duplicate-slot-preflight" });
  const grant = f.sqlite.prepare("SELECT * FROM output_execution_grants").get();
  f.insert("output_execution_grants", { ...grant, grant_id: "duplicate-slot-grant", preflight_id: "duplicate-slot-preflight",
    authorization_event_id: authorization.eventId });
  const target = f.sqlite.prepare("SELECT * FROM output_plan_targets").get();
  f.insert("output_plan_targets", { ...target, target_id: "duplicate-slot-target" });
  const slot = f.sqlite.prepare("SELECT * FROM output_operation_slots").get();
  f.insert("output_operation_slots", { ...slot, slot_id: "duplicate-slot", grant_id: "duplicate-slot-grant", target_id: "duplicate-slot-target",
    cost_reservation_id: "duplicate-cost-reservation", token_reservation_id: "duplicate-token-reservation" });
  assert.equal(await evaluate(f, proof), 0);
  await assert.rejects(readSelectedOutputShareAuthority(f.env, source), unavailable);
});

test("the exact unredacted native authorization envelope proves absence of sponsor authority", async t => {
  const cases = {
    "sponsor marker object": f => mutateAuthorization(f, value => { value.output_command_envelope.sponsor_entitlement = {}; }),
    "sponsor marker null": f => mutateAuthorization(f, value => { value.output_command_envelope.sponsor_entitlement = null; }),
    "sponsor marker false": f => mutateAuthorization(f, value => { value.output_command_envelope.sponsor_entitlement = false; }),
    "missing envelope": f => mutateAuthorization(f, value => { delete value.output_command_envelope; }),
    "empty envelope": f => mutateAuthorization(f, value => { value.output_command_envelope = {}; }),
    "null envelope": f => mutateAuthorization(f, value => { value.output_command_envelope = null; }),
    "array envelope": f => mutateAuthorization(f, value => { value.output_command_envelope = []; }),
    "wrong authorization action": f => mutateAuthorization(f, value => { value.output_command_envelope.action = "preflight"; }),
    "wrong authorization document": f => mutateAuthorization(f, value => { value.output_command_envelope.documentId = "another-document"; }),
    "missing command identity": f => mutateAuthorization(f, value => { delete value.output_command_envelope.clientMutationId; }),
    "different command identity": f => mutateAuthorization(f, value => { value.output_command_envelope.clientMutationId = "another-command"; }),
    "wrong envelope preflight": f => mutateAuthorization(f, value => { value.output_command_envelope.preflightId = "another-preflight"; }),
    "wrong envelope terms": f => mutateAuthorization(f, value => { value.output_command_envelope.termsDigest = `sha256:${"a".repeat(64)}`; }),
    "wrong authorized maximum": f => mutateAuthorization(f, value => { value.output_command_envelope.maximumMicrousd = 2000; }),
    "explicit authorization false": f => mutateAuthorization(f, value => { value.output_command_envelope.explicitAuthorization = false; }),
    "explicit authorization absent": f => mutateAuthorization(f, value => { delete value.output_command_envelope.explicitAuthorization; }),
    "invalid source revision": f => mutateAuthorization(f, value => { value.output_command_envelope.expectedRevision = "untrusted"; }),
    "source revision after authorization": f => mutateAuthorization(f, value => { value.output_command_envelope.expectedRevision = `output:${f.authorization.sequence + 1}`; }),
    "preflight actor differs": f => f.sqlite.prepare("UPDATE output_preflights SET actor_user_id='another-actor'").run(),
    "preflight terms differ": f => f.sqlite.prepare("UPDATE output_preflights SET terms_digest=?").run(`sha256:${"a".repeat(64)}`),
    "preflight plan differs": f => {
      const plan = f.sqlite.prepare("SELECT * FROM output_plan_revisions").get();
      f.insert("output_plan_revisions", { ...plan, plan_revision_id: "different-plan-revision", plan_id: "different-plan" });
      f.sqlite.prepare("UPDATE output_preflights SET plan_revision_id='different-plan-revision'").run();
    },
    "different authorized grant": f => mutateAuthorization(f, value => { value.grant_id = "different-grant"; }),
    "different authorized job": f => mutateAuthorization(f, value => { value.authorized_targets[0].job_id = "different-job"; }),
    "different authorized route": f => mutateAuthorization(f, value => { value.authorized_targets[0].route_digest = `sha256:${"a".repeat(64)}`; }),
    "redacted authorization": f => f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at=? WHERE private_event_id=?").run(new Date().toISOString(), f.authorization.eventId),
    "different private owner": f => f.sqlite.prepare("UPDATE event_private_payloads SET owner_id='another-owner' WHERE private_event_id=?").run(f.authorization.eventId),
    "wrong authorization actor": () => {},
    "wrong authorization client": () => {},
    "authorization above byte cap": f => mutateAuthorization(f, value => { value.untrusted = "x".repeat(131072); }),
  };
  for (const [name, mutate] of Object.entries(cases)) await t.test(name, async child => {
    const f = await fixture(child, { slot: "actor",
      ...(name === "wrong authorization actor" ? { authorizationActor: "user:another-owner" } : {}),
      ...(name === "wrong authorization client" ? { authorizationClientId: "untrusted-client" } : {}),
    }), source = await custody(f);
    mutate(f);
    await assert.rejects(readSelectedOutputShareAuthority(f.env, source), unavailable);
  });
});

test("native job retention limits publication authority independently of source retention", async t => {
  const jobExpiry = new Date(Date.now() + 3_600_000).toISOString();
  const f = await fixture(t, { slot: "actor", jobExpiresAt: jobExpiry });
  const proof = await authority(f);
  assert.equal(selectedOutputShareAuthoritySnapshot(proof, f.env).expiresAt, jobExpiry);
});

test("expired generation authorization does not erase a completed actor-paid output's retained provenance", async t => {
  const f = await fixture(t, { slot: "actor" });
  f.sqlite.prepare("UPDATE output_execution_grants SET expires_at='2020-01-01T00:00:00.000Z'").run();
  const proof = await authority(f);
  assert.equal(await evaluate(f, proof), 1);
  assert.equal(selectedOutputShareAuthoritySnapshot(proof, f.env).expiresAt, EXPIRY);
});

test("authority objects cannot be forged, copied or moved between environment/database identities", async t => {
  const f = await fixture(t), source = await custody(f), proof = await readSelectedOutputShareAuthority(f.env, source);
  await assert.rejects(readSelectedOutputShareAuthority(f.env, {}), /unavailable/u);
  for (const forged of [{}, { ...proof }, Object.freeze({})]) {
    assert.throws(() => selectedOutputShareAuthoritySnapshot(forged, f.env), unavailable);
    assert.throws(() => selectedOutputShareAuthorityAssertion(forged, f.env), unavailable);
  }
  assert.throws(() => selectedOutputShareAuthoritySnapshot(proof, { ...f.env }), unavailable);
  const prior = f.env.DB;
  f.env.DB = f.DB;
  try { assert.throws(() => selectedOutputShareAuthorityAssertion(proof, f.env), unavailable); }
  finally { f.env.DB = prior; }
  const assertion = selectedOutputShareAuthorityAssertion(proof, f.env);
  assert.throws(() => assertion[0].bindings.fill("mutated-caller-copy"), TypeError);
  assert.throws(() => assertion[0].sql = "SELECT 1 AS admitted", TypeError);
  assert.throws(() => assertion.pop(), TypeError);
  assert.equal(await evaluate(f, proof), 1);
});

test("optional sponsor tables are read only when present and reject associated records", async t => {
  for (const name of Object.keys(optionalTables)) for (const linked of [false, true]) await t.test(`${name} / ${linked ? "linked" : "unrelated"}`, async child => {
    const f = await fixture(child, { slot: "actor" });
    installOptional(f, name);
    insertOptional(f, name, linked);
    const before = f.changes();
    if (linked) await assert.rejects(authority(f), unavailable);
    else assert.equal(await evaluate(f, await authority(f)), 1);
    assert.equal(f.changes(), before);
  });
});

test("final authority witness refuses optional schema activation after observation", async t => {
  for (const name of Object.keys(optionalTables)) await t.test(name, async child => {
    const f = await fixture(child), proof = await authority(f);
    assert.equal(await evaluate(f, proof), 1);
    installOptional(f, name);
    assert.equal(await evaluate(f, proof), 0, "absence must be rechecked before share issuance or read");
  });
});

test("final authority witness rechecks sponsor association and optional table definition", async t => {
  for (const name of Object.keys(optionalTables)) await t.test(name, async child => {
    const f = await fixture(child, { slot: "actor" });
    installOptional(f, name);
    const proof = await authority(f);
    insertOptional(f, name);
    assert.equal(await evaluate(f, proof), 0);
  });
  await t.test("definition changed", async child => {
    const f = await fixture(child);
    installOptional(f, "experience_sponsor_consumptions");
    const proof = await authority(f);
    f.sqlite.exec("ALTER TABLE experience_sponsor_consumptions ADD COLUMN another_witness TEXT");
    assert.equal(await evaluate(f, proof), 0);
  });
});

test("final authority witness rejects changed job, completion, slot, grant and authorization snapshots", async t => {
  const cases = {
    "job replaced": f => mutateJson(f, "result_json", value => { value.extra = "after observation"; }),
    "job no longer completed": f => f.updateJob({ status: "running" }),
    "selected completion becomes ambiguous": f => f.append("DocumentRenderCompleted", {
      artifact_id: ARTIFACT, artifact_kind: "short_story", requested_by_user_id: OWNER,
      content_ref: "competing-content", item_count: 1,
    }),
    "slot changed": f => f.sqlite.prepare("UPDATE output_operation_slots SET model='changed-after-observation'").run(),
    "grant payer changed": f => f.sqlite.prepare("UPDATE output_execution_grants SET payer_user_id='changed-after-observation'").run(),
    "authorization body changed": f => mutateAuthorization(f, value => { value.extra = "after observation"; }),
    "preflight terms changed": f => f.sqlite.prepare("UPDATE output_preflights SET terms_digest=?").run(`sha256:${"a".repeat(64)}`),
    "private authorization redacted": f => f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at=? WHERE private_event_id=?").run(new Date().toISOString(), f.authorization.eventId),
    "native text custody erased": f => f.sqlite.prepare("UPDATE private_content SET redacted_at=?").run(new Date().toISOString()),
  };
  for (const [name, mutate] of Object.entries(cases)) await t.test(name, async child => {
    const f = await fixture(child, { slot: "actor" }), proof = await authority(f);
    await mutate(f);
    assert.equal(await evaluate(f, proof), 0);
  });
});

test("legacy jobs cannot hide dynamic provenance by deleting their request reference", async t => {
  const f = await fixture(t, { slot: "actor" }), source = await custody(f);
  f.updateJob({ source_surface: "document", request_json: JSON.stringify({ artifactKind: "short_story", productionMode: "manual", itemCount: 1 }),
    result_json: JSON.stringify({ artifactKind: "short_story", artifactId: ARTIFACT, appendedEventIds: [f.completion.eventId] }) });
  await assert.rejects(readSelectedOutputShareAuthority(f.env, source), unavailable);
});

function addPilotCohort(f, pilot, { id, status = "paused", startsAt = "2020-01-01T00:00:00.000Z", endsAt,
  email = EMAIL, userId = OWNER, participant = true }) {
  const cohort = f.sqlite.prepare("SELECT * FROM pilot_cohorts WHERE cohort_id=?").get(pilot.cohortId);
  f.insert("pilot_cohorts", { ...cohort, cohort_id: id, status, starts_at: startsAt, ends_at: endsAt });
  if (participant) {
    const enrolled = f.sqlite.prepare("SELECT * FROM pilot_participants WHERE participant_id=?").get(pilot.participantId);
    f.insert("pilot_participants", { ...enrolled, participant_id: `${id}-participant`, cohort_id: id,
      email_normalized: email, user_id: userId });
  }
  return id;
}

function grantPilotOwnerFallback(f, pilot) {
  const now = new Date().toISOString();
  f.sqlite.prepare("UPDATE organizations SET owner_user_id=? WHERE organization_id=?").run(OWNER, pilot.organizationId);
  f.insert("organization_memberships", { membership_id: "selected-share-pilot-owner", organization_id: pilot.organizationId,
    user_id: OWNER, role: "owner", status: "active", invited_by_user_id: OWNER, accepted_at: now, created_at: now, updated_at: now });
}

test("overlapping bound pilot cohorts use the latest applicable current admission deadline", async t => {
  const f = await fixture(t), now = Date.now();
  const shortEnd = new Date(now + 60_000).toISOString(), longEnd = new Date(now + 120_000).toISOString();
  const pilot = f.installPilot({ endsAt: shortEnd });
  addPilotCohort(f, pilot, { id: "longer-paused-cohort", status: "paused", endsAt: longEnd });
  addPilotCohort(f, pilot, { id: "unrelated-longer-cohort", endsAt: new Date(now + 240_000).toISOString(),
    email: "another-participant@example.test", userId: "another-participant" });
  const proof = await authority(f);
  assert.equal(selectedOutputShareAuthoritySnapshot(proof, f.env).expiresAt, longEnd);
  assert.equal(await evaluate(f, proof), 1);
  f.sqlite.prepare("UPDATE pilot_cohorts SET ends_at='2020-01-02T00:00:00.000Z' WHERE cohort_id=?").run(pilot.cohortId);
  assert.equal(await evaluate(f, proof), 1, "an unrelated shorter admission ending must not expire the surviving bound admission");
});

test("closed or expired pilot owner fallback retains source/job lifetime without an active successor", async t => {
  for (const status of ["closed", "expired"]) await t.test(status, async child => {
    const f = await fixture(child, { jobExpiresAt: new Date(Date.now() + 300_000).toISOString() });
    const pilot = f.installPilot({ endsAt: status === "expired" ? "2020-01-02T00:00:00.000Z" : new Date(Date.now() + 60_000).toISOString() });
    if (status === "closed") f.sqlite.prepare("UPDATE pilot_cohorts SET status='closed' WHERE cohort_id=?").run(pilot.cohortId);
    grantPilotOwnerFallback(f, pilot);
    const proof = await authority(f);
    assert.equal(selectedOutputShareAuthoritySnapshot(proof, f.env).expiresAt, f.job().expires_at);
    assert.equal(await evaluate(f, proof), 1);
  });
});

test("scheduled active or paused successors cap owner fallback and end its native admission when active", async t => {
  for (const status of ["active", "paused"]) await t.test(status, async child => {
    const f = await fixture(child), pilot = f.installPilot({ endsAt: "2020-01-02T00:00:00.000Z" });
    f.sqlite.prepare("UPDATE pilot_cohorts SET status='closed' WHERE cohort_id=?").run(pilot.cohortId);
    grantPilotOwnerFallback(f, pilot);
    const startsAt = new Date(Date.now() + 60_000).toISOString();
    const successor = addPilotCohort(f, pilot, { id: `scheduled-owner-${status}`, status, startsAt,
      endsAt: new Date(Date.now() + 120_000).toISOString(), participant: false });
    const proof = await authority(f);
    assert.equal(selectedOutputShareAuthoritySnapshot(proof, f.env).expiresAt, startsAt);
    assert.equal(await evaluate(f, proof), 1);
    // Advance this real stored schedule into the native SQL policy's active
    // window. No predicate or authorization result is mocked.
    f.sqlite.prepare("UPDATE pilot_cohorts SET starts_at='2020-01-01T00:00:00.000Z' WHERE cohort_id=?").run(successor);
    assert.equal(await evaluate(f, proof), 0);
    await assert.rejects(authority(f), /unavailable|access_denied/u);
  });
});

test("future unbound matching-email enrollment caps otherwise current bound participant admission", async t => {
  for (const status of ["active", "paused"]) await t.test(status, async child => {
    const f = await fixture(child), pilot = f.installPilot(), startsAt = new Date(Date.now() + 60_000).toISOString();
    f.sqlite.prepare("UPDATE pilot_cohorts SET status='paused' WHERE cohort_id=?").run(pilot.cohortId);
    const future = addPilotCohort(f, pilot, { id: `future-unbound-${status}`, status, startsAt,
      endsAt: new Date(Date.now() + 120_000).toISOString(), userId: null });
    const proof = await authority(f);
    assert.equal(selectedOutputShareAuthoritySnapshot(proof, f.env).expiresAt, startsAt);
    assert.equal(await evaluate(f, proof), 1);
    f.sqlite.prepare("UPDATE pilot_cohorts SET starts_at='2020-01-01T00:00:00.000Z' WHERE cohort_id=?").run(future);
    assert.equal(await evaluate(f, proof), 0);
    await assert.rejects(authority(f), /unavailable|access_denied/u);
  });
});

test("unrelated future email or another bound principal does not shorten participant admission", async t => {
  for (const person of ["other-email", "other-bound-principal"]) await t.test(person, async child => {
    const f = await fixture(child), endsAt = new Date(Date.now() + 180_000).toISOString();
    const pilot = f.installPilot({ endsAt });
    const future = addPilotCohort(f, pilot, { id: `irrelevant-future-${person}`, startsAt: new Date(Date.now() + 60_000).toISOString(),
      endsAt: new Date(Date.now() + 120_000).toISOString(),
      email: person === "other-email" ? "unrelated@example.test" : EMAIL,
      userId: person === "other-email" ? null : "another-principal" });
    const proof = await authority(f);
    assert.equal(selectedOutputShareAuthoritySnapshot(proof, f.env).expiresAt, endsAt);
    assert.equal(await evaluate(f, proof), 1);
    f.sqlite.prepare("UPDATE pilot_cohorts SET starts_at='2020-01-01T00:00:00.000Z' WHERE cohort_id=?").run(future);
    assert.equal(await evaluate(f, proof), 1);
  });
});

test("explicit administrator-email breakglass preserves native lifetime despite expired configured cohorts", async t => {
  const f = await fixture(t), pilot = f.installPilot({ endsAt: "2020-01-02T00:00:00.000Z" });
  addPilotCohort(f, pilot, { id: "future-unbound-breakglass", startsAt: new Date(Date.now() + 60_000).toISOString(),
    endsAt: new Date(Date.now() + 120_000).toISOString(), userId: null });
  f.env.FORMA_ADMIN_EMAILS = `other-admin@example.test, ${EMAIL.toUpperCase()} `;
  const proof = await authority(f);
  assert.equal(selectedOutputShareAuthoritySnapshot(proof, f.env).expiresAt, EXPIRY);
  assert.equal(await evaluate(f, proof), 1);
});

test("crossing a scheduled policy boundary after the final SQLite read refuses the authority proof", async t => {
  const f = await fixture(t), pilot = f.installPilot(), startsAt = new Date(Date.now() + 60_000).toISOString();
  addPilotCohort(f, pilot, { id: "post-await-unbound", status: "paused", startsAt,
    endsAt: new Date(Date.now() + 120_000).toISOString(), userId: null });
  const source = await custody(f);
  let crossed = false;
  f.setAfterStatement(sql => {
    if (!sql.startsWith("WITH selected_share_proof_") || !sql.includes(" SELECT 1 AS admitted WHERE ") || !sql.includes("bounded_selected_share_jobs")) return;
    f.setAfterStatement(null);
    crossed = true;
    t.mock.method(Date, "now", () => Date.parse(startsAt));
  });
  await assert.rejects(readSelectedOutputShareAuthority(f.env, source), unavailable);
  assert.equal(crossed, true);
});

test("captured native custody cannot be reused after cohort or breakglass configuration changes", async t => {
  for (const field of ["cohort", "administrators"]) await t.test(field, async child => {
    const f = await fixture(child), pilot = f.installPilot();
    const alternate = addPilotCohort(f, pilot, { id: "alternate-admitted-cohort", endsAt: pilot.endsAt });
    const source = await custody(f);
    if (field === "cohort") f.env.FORMA_PILOT_COHORT_ID = alternate;
    else f.env.FORMA_ADMIN_EMAILS = EMAIL;
    await assert.rejects(readSelectedOutputShareAuthority(f.env, source), unavailable);
  });
});
