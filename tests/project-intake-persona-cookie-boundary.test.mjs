// Actual form-built intake + routed RAM Worker. The persona/authorization rows
// are explicit existing fixture setup, not a synthetic authorization response.
// Empty/decode-error context cookies must follow the same effective-account
// path as absence; a nonempty selected-context cookie remains incompatible.
import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import test from "node:test";
import { AUTHORED, createProjectIntakeFixture, captureUnsentIntake, assertComplete } from "./helpers/project-intake-fixture.mjs";
import { financial } from "./helpers/event-source-retirement-fixture.mjs";

const options = { concurrency: false, timeout: 45_000 };
const cookies = [
  { name: "absent", value: null },
  { name: "empty", value: "forma_project_context=" },
  { name: "malformed-percent", value: "forma_project_context=%E0%A4%A" },
];
const rows = (x, table) => x.worker.sqlite.prepare('SELECT * FROM "' + table + '" ORDER BY rowid').all();
const optionalRows = (x, table) => x.worker.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)
  ? rows(x, table) : null;
function snapshot(x) {
  return { events: rows(x, "events"), privatePayloads: rows(x, "event_private_payloads"),
    privateContent: rows(x, "private_content"), receipts: rows(x, "event_client_receipts"),
    resourceScopes: optionalRows(x, "project_resource_scopes"), retentionScopes: optionalRows(x, "private_content_retention_scopes"),
    users: rows(x, "users"), personas: rows(x, "replay_personas"), impersonations: rows(x, "impersonation_sessions"),
    financial: financial(x.worker), executionSteps: optionalRows(x, "consequential_execution_steps") };
}
function principalRows(x, state) {
  return { events: state.events.filter(row => row.stream_id === x.worker.streamId),
    privatePayloads: state.privatePayloads.filter(row => row.owner_id === x.worker.owner),
    privateContent: state.privateContent.filter(row => row.owner_id === x.worker.owner),
    receipts: state.receipts.filter(row => row.stream_id === x.worker.streamId) };
}
function unchangedFinancial(before, after) {
  assert.deepEqual(after.financial, before.financial, "original jobs/reservations/counters/provider/execution rows remain unchanged");
  assert.deepEqual(after.executionSteps, before.executionSteps, "current consequential execution steps remain unchanged");
}
function complete(events, result) {
  return assertComplete({ body: { events }, status: result.response.status, reply: result.body });
}
async function personaFixture(t) {
  const x = await createProjectIntakeFixture(t), events = await captureUnsentIntake(x), now = new Date().toISOString();
  const actor = x.worker.owner, fictional = "intake-cookie-fictional", persona = "intake-cookie-persona", acting = "intake-cookie-impersonation";
  assert.equal(x.worker.sqlite.prepare("SELECT role FROM users WHERE user_id=?").get(actor).role, "admin",
    "the existing actual personal fixture has an authorized real principal");
  x.worker.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
    .run(fictional, "intake-cookie-fictional@example.test", "Fictional intake cookie control", "creator", "pilot-2026-08-10", now, now, now);
  x.worker.sqlite.prepare("INSERT INTO replay_personas(persona_id,session_id,owner_id,fictional_user_id,fictional_stream_id,display_name,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .run(persona, "intake-cookie-replay", actor, fictional, "creative:" + fictional, "Fictional intake cookie control", "ready", now, now);
  x.worker.sqlite.prepare("INSERT INTO impersonation_sessions(impersonation_id,actor_user_id,persona_id,fictional_user_id,replay_session_id,status,started_at,expires_at) VALUES(?,?,?,?,?,?,?,?)")
    .run(acting, actor, persona, fictional, "intake-cookie-replay", "active", now, new Date(Date.now() + 3_600_000).toISOString());
  const headers = (contextCookie, confirmed) => ({
    cookie: "forma_impersonation=" + acting + (contextCookie === null ? "" : "; " + contextCookie),
    "content-type": "application/json", ...(confirmed ? { "x-forma-impersonation-confirmation": "I understand, continue" } : {}),
  });
  // Warm the ordinary effective stream through its actual GET before protected
  // snapshots. Existing seed-simulation records are not a new media outcome.
  const principalBeforeWarm = principalRows(x, snapshot(x));
  const warm = await x.worker.request("/api/events?content=0", { method: "GET", headers: headers(null, false) });
  assert.equal(warm.status, 200); await warm.json();
  assert.deepEqual(principalRows(x, snapshot(x)), principalBeforeWarm, "warming the persona never seeds the real principal again");
  const send = async (intakeAction, contextCookie = null, confirmed = true) => {
    const response = await x.worker.request("/api/events", { method: "POST", headers: headers(contextCookie, confirmed),
      body: JSON.stringify({ action: "project_intake", intakeAction, events }) });
    return { response, body: await response.json() };
  };
  return { x, events, fictional, streamId: "creative:" + fictional, send };
}
function observe(t, state, before, after, result, detail) {
  unchangedFinancial(before, after);
  const evidence = { ...detail, status: result.response.status, error: result.body.error ?? null,
    appended: Array.isArray(result.body.appended) ? result.body.appended.length : 0,
    returnedStreams: [...new Set((result.body.appended ?? []).map(event => event.streamId))],
    eventDelta: after.events.length - before.events.length, receiptDelta: after.receipts.length - before.receipts.length,
    privatePayloadDelta: after.privatePayloads.length - before.privatePayloads.length,
    principalUnchanged: isDeepStrictEqual(principalRows(state.x, after), principalRows(state.x, before)),
    allProtectedRowsUnchanged: isDeepStrictEqual(after, before) };
  t.diagnostic(JSON.stringify(evidence));
  assert.equal(evidence.principalUnchanged, true, "an active effective persona never changes the real principal's original stream/private rows");
  return evidence;
}

for (const cookie of cookies) test("B2 active persona still requires per-interaction confirmation " + cookie.name, options, async t => {
  const state = await personaFixture(t), before = snapshot(state.x);
  const result = await state.send("commit", cookie.value, false), after = snapshot(state.x);
  const evidence = observe(t, state, before, after, result, { cookie: cookie.name, confirmed: false });
  assert.equal(evidence.allProtectedRowsUnchanged, true);
  assert.equal(Object.values(AUTHORED).some(value => JSON.stringify(result.body).includes(value)), false);
  assert.deepEqual({ status: result.response.status, error: result.body.error },
    { status: 428, error: "impersonation_confirmation_required" },
    "no decoded selected context means ordinary effective-persona confirmation, not a principal-only refusal or mutation");
});

for (const cookie of cookies) test("B2 confirmed effective-persona intake retains its exact original custody " + cookie.name, options, async t => {
  const state = await personaFixture(t), before = snapshot(state.x);
  const result = await state.send("commit", cookie.value), after = snapshot(state.x);
  observe(t, state, before, after, result, { cookie: cookie.name, confirmed: true });
  complete(state.events, result);
  assert.equal(result.body.appended.every(event => event.streamId === state.streamId), true);
  assert.equal(after.events.length - before.events.length, 4);
  assert.equal(after.privatePayloads.length - before.privatePayloads.length, 4);
  assert.equal(after.receipts.length - before.receipts.length, 4);
  const newIds = new Set(result.body.appended.map(event => event.eventId));
  assert.deepEqual(after.events.filter(row => !newIds.has(row.event_id)), before.events);
  assert.deepEqual(after.privatePayloads.filter(row => !newIds.has(row.private_event_id)), before.privatePayloads);
  assert.equal(after.privatePayloads.filter(row => newIds.has(row.private_event_id)).every(row => row.owner_id === state.fictional), true);
  assert.equal(after.receipts.filter(row => newIds.has(row.event_id)).every(row => row.stream_id === state.streamId), true);
  assert.deepEqual(after.privateContent, before.privateContent);
  assert.deepEqual(after.resourceScopes, before.resourceScopes); assert.deepEqual(after.retentionScopes, before.retentionScopes);
  assert.deepEqual(after.users, before.users); assert.deepEqual(after.personas, before.personas); assert.deepEqual(after.impersonations, before.impersonations);
  const check = await state.send("check", cookie.value); complete(state.events, check);
  assert.deepEqual(check.body.appended, result.body.appended);
  assert.deepEqual(snapshot(state.x), after, "same exact persona Check neither creates a second original nor alters any receipt or financial row");
});

for (const cookie of cookies.filter(value => value.value !== null)) test("B2 effective-persona original remains recoverable after context-cookie shape changes " + cookie.name, options, async t => {
  const state = await personaFixture(t), original = await state.send("commit"); complete(state.events, original);
  const before = snapshot(state.x), check = await state.send("check", cookie.value), after = snapshot(state.x);
  const evidence = observe(t, state, before, after, check, { cookie: cookie.name, action: "check", originalAlreadyCommitted: true });
  assert.equal(evidence.allProtectedRowsUnchanged, true);
  complete(state.events, check); assert.deepEqual(check.body.appended, original.body.appended);
  assert.equal(check.body.appended.every(event => event.streamId === state.streamId), true);
});

for (const confirmed of [false, true]) test("B2 nonempty selected-context cookie stays incompatible with an active persona " + confirmed, options, async t => {
  const state = await personaFixture(t), before = snapshot(state.x);
  const result = await state.send("commit", "forma_project_context=unissued-intake-context", confirmed), after = snapshot(state.x);
  const evidence = observe(t, state, before, after, result, { cookie: "nonempty-unissued", confirmed });
  assert.equal(evidence.allProtectedRowsUnchanged, true);
  assert.equal(Object.hasOwn(result.body, "appended"), false);
  assert.deepEqual({ status: result.response.status, error: result.body.error },
    { status: 409, error: "return_to_principal_before_internal_access" },
    "principal-only access rejects the actual active persona before attempting selected-project or personal intake");
});
