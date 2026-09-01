import test from "node:test";
import assert from "node:assert/strict";
import { createSceneCostFixture } from "./helpers/scene-cost-fixture.mjs";
import { enforceD1ExpressionDepth } from "./helpers/d1-expression-depth.mjs";

const path = "/api/portfolio/product/delivery", stream = "platform:product-delivery";
const input = (extra = {}) => ({ requestId: crypto.randomUUID(), title: "Arbitrary milestone · 日本語", audience: "product", evidence: "Original private evidence", dependencyIds: [], ...extra });
const send = (h, body, headers = {}, method = "POST") => h.request(path, { method, headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) });
const counts = h => Object.fromEntries([
  ["decisions", "SELECT COUNT(*) AS n FROM delivery_decisions"],
  ["events", "SELECT COUNT(*) AS n FROM events WHERE stream_id='platform:product-delivery' AND type='ProductDeliveryDecisionCreated'"],
  ["receipts", "SELECT COUNT(*) AS n FROM event_client_receipts WHERE stream_id='platform:product-delivery'"],
  ["private", "SELECT COUNT(*) AS n FROM event_private_payloads WHERE owner_id='platform:product-delivery'"],
].map(([name, sql]) => [name, h.sqlite.prepare(sql).get().n]));
async function fixture(t) {
  const h = await createSceneCostFixture(1); const financial = h.counts();
  t.after(() => { assert.deepEqual(h.counts(), financial, "Product receipts perform no job, token or cost-budget action"); h.close(); });
  return h;
}
async function manager(h, id = "receipt-manager") {
  const headers = { "oai-authenticated-user-id": id, "oai-authenticated-user-email": id + "@example.test" };
  assert.equal((await h.request("/api/session?audience=product", { headers })).status, 403, "a new real principal has no Product grant yet");
  const now = new Date().toISOString();
  h.sqlite.prepare("INSERT INTO capability_grants(grant_id,user_id,capability,scope_type,organization_id,project_access_id,project_id,status,granted_by_user_id,created_at,updated_at,expires_at,revoked_at) VALUES(?,?,'product.delivery.manage','platform',NULL,NULL,NULL,'active',?,?,?,NULL,NULL)")
    .run(crypto.randomUUID(), id, h.owner, now, now);
  // Match the existing specialist fixture, but deliberately do not add consent.
  h.sqlite.prepare("UPDATE users SET consent_version=NULL,consented_at=NULL WHERE user_id=?").run(id);
  return headers;
}
const createBatch = statements => statements.some(statement => statement.sql.includes("INSERT INTO event_client_receipts") && statement.values.includes(stream));
const receiptRead = statement => statement.sql.includes("AS original_event_exists") && statement.sql.includes("event_client_receipts");
const finalRead = statement => statement.sql.includes("SELECT 1 AS current FROM event_client_receipts receipt");

test("Product create receipt commits one private original and recovers it under actual depth-100 D1 statements", async t => {
  const h = await fixture(t), body = input(), depth = enforceD1ExpressionDepth(h);
  try {
    const response = await send(h, body); assert.equal(response.status, 201, await response.clone().text());
    const first = await response.json(), again = await send(h, body); assert.equal(again.status, 201);
    assert.deepEqual(await again.json(), first); assert.deepEqual(counts(h), { decisions: 1, events: 1, receipts: 1, private: 1 });
    const raw = h.sqlite.prepare("SELECT event.payload,secret.private_json FROM events event JOIN event_private_payloads secret ON secret.private_event_id=event.event_id WHERE event.event_id=?").get(first.receipt.eventId);
    assert.ok(!raw.payload.includes(body.title)); assert.ok(!raw.payload.includes(body.evidence));
    assert.equal(JSON.parse(raw.private_json).create_request.title, body.title);
    assert.equal(first.receipt.requestId, body.requestId); assert.equal(first.receipt.actorUserId, h.owner);
    assert.equal(first.receipt.decisionId, first.decision.decisionId); assert.match(first.receipt.requestDigest, /^[0-9a-f]{64}$/);
    assert.ok(depth.records.some(entry => entry.sql.includes("original_event_exists")));
    assert.ok(depth.records.some(entry => entry.sql.includes("INSERT INTO event_client_receipts"))); depth.assertVerified();
  } finally { depth.restore(); }
});

test("Product concurrent exact creates converge on the one original event and milestone", async t => {
  const h = await fixture(t), body = input();
  const responses = await Promise.all([send(h, body), send(h, body)]);
  for (const response of responses) assert.equal(response.status, 201, await response.clone().text());
  assert.deepEqual(await responses[0].json(), await responses[1].json());
  assert.deepEqual(counts(h), { decisions: 1, events: 1, receipts: 1, private: 1 });
});

test("Product same request ID with different original intent is a conflict, never another milestone", async t => {
  const h = await fixture(t), body = input(); assert.equal((await send(h, body)).status, 201);
  const response = await send(h, { ...body, title: "A changed draft is not the original" });
  assert.equal(response.status, 409); assert.equal((await response.json()).error, "delivery_create_intent_conflict");
  assert.equal(counts(h).decisions, 1); assert.equal(counts(h).events, 1);
});

test("Product same request UUID is isolated by real principal and adds no Creator consent prerequisite", async t => {
  const h = await fixture(t), a = await manager(h, "receipt-a"), b = await manager(h, "receipt-b"), body = input();
  const first = await send(h, body, a), second = await send(h, body, b);
  assert.equal(first.status, 201, await first.clone().text()); assert.equal(second.status, 201, await second.clone().text());
  const aa = await first.json(), bb = await second.json();
  assert.notEqual(aa.decision.decisionId, bb.decision.decisionId); assert.equal(aa.receipt.actorUserId, "receipt-a"); assert.equal(bb.receipt.actorUserId, "receipt-b");
  assert.equal(counts(h).receipts, 2); assert.equal(counts(h).events, 2);
});

test("Product receipt creates preserve arbitrary initial lifecycle values and cannot manufacture approval", async t => {
  const h = await fixture(t);
  for (const status of ["planned", "running", "failed", "active"]) {
    const response = await send(h, input({ status })); assert.equal(response.status, 201);
    assert.equal((await response.json()).decision.status, status === "active" ? "running" : status);
  }
  const before = counts(h);
  for (const status of ["passed", "approval_required", "approved", "revoked", "superseded"]) {
    const response = await send(h, input({ status })); assert.equal(response.status, 409);
    assert.equal((await response.json()).error, "invalid_initial_delivery_status");
  }
  assert.deepEqual(counts(h), before);
});

test("Product create recovery returns the immutable original after a real PATCH and owner eligibility change", async t => {
  const h = await fixture(t); await manager(h, "original-owner"); const body = input({ ownerUserId: "original-owner" });
  const created = await send(h, body); assert.equal(created.status, 201); const original = await created.json();
  const edited = await send(h, { decisionId: original.decision.decisionId, title: "Later edited row", evidence: "Later evidence",
    ownerUserId: h.owner, status: "running", expectedUpdatedAt: original.decision.updatedAt }, {}, "PATCH");
  assert.equal(edited.status, 200); assert.equal((await edited.json()).decision.title, "Later edited row");
  h.sqlite.prepare("UPDATE capability_grants SET status='revoked',revoked_at=? WHERE user_id='original-owner'").run(new Date().toISOString());
  const recovered = await send(h, body); assert.equal(recovered.status, 201); assert.deepEqual(await recovered.json(), original);
  assert.equal(h.sqlite.prepare("SELECT title FROM delivery_decisions").get().title, "Later edited row");
  assert.equal((await send(h, { ...body, requestId: crypto.randomUUID() })).status, 403, "new intent still needs an eligible owner");
  assert.equal(counts(h).decisions, 1); assert.equal(counts(h).events, 1);
});

for (const fault of ["redacted", "missing private", "corrupt private", "missing receipt", "wrong receipt event"]) test(`Product ${fault} original fails closed without creating again`, async t => {
  const h = await fixture(t), body = input(), created = await send(h, body); assert.equal(created.status, 201);
  const original = await created.json(), eventId = original.receipt.eventId;
  if (fault === "redacted") h.sqlite.prepare("UPDATE event_private_payloads SET redacted_at=? WHERE private_event_id=?").run(new Date().toISOString(), eventId);
  if (fault === "missing private") h.sqlite.prepare("DELETE FROM event_private_payloads WHERE private_event_id=?").run(eventId);
  if (fault === "corrupt private") h.sqlite.prepare("UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?").run("{", eventId);
  if (fault === "missing receipt") h.sqlite.prepare("DELETE FROM event_client_receipts WHERE event_id=?").run(eventId);
  if (fault === "wrong receipt event") h.sqlite.prepare("UPDATE event_client_receipts SET event_id=? WHERE event_id=?").run("absent-event", eventId);
  const before = counts(h), response = await send(h, body); assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "delivery_create_receipt_unavailable"); assert.deepEqual(counts(h), before);
});

for (const table of ["event_write_stage", "delivery_decisions", "event_client_receipts"]) test(`Product ${table} write failure rolls back the whole creation batch`, async t => {
  const h = await fixture(t), body = input(), before = counts(h);
  h.sqlite.exec(`CREATE TRIGGER reject_delivery_test BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'injected_delivery_failure'); END;`);
  const failed = await send(h, body); assert.equal(failed.status, 503); assert.equal((await failed.json()).error, "delivery_create_unknown");
  assert.deepEqual(counts(h), before, "no event/private/row/receipt orphan survives");
  h.sqlite.exec("DROP TRIGGER reject_delivery_test");
  const retry = await send(h, body); assert.equal(retry.status, 201); assert.equal(counts(h).decisions, 1); assert.equal(counts(h).events, 1);
});

for (const boundary of ["transaction", "final private read"]) test(`Product live capability revocation at ${boundary} withholds protected acknowledgment`, async t => {
  const h = await fixture(t), headers = await manager(h), body = input(); let entered = 0;
  const revoke = () => { entered++; h.sqlite.prepare("UPDATE capability_grants SET status='revoked',revoked_at=? WHERE user_id='receipt-manager'").run(new Date().toISOString()); };
  if (boundary === "transaction") h.controls.beforeBatch = async statements => { if (!entered && createBatch(statements)) revoke(); };
  else h.controls.beforeRead = async statement => { if (!entered && finalRead(statement)) revoke(); };
  const response = await send(h, body, headers); assert.equal(entered, 1);
  assert.equal(response.ok, false); assert.equal((await response.json()).decision, undefined);
  assert.equal(counts(h).decisions, boundary === "transaction" ? 0 : 1);
  assert.equal(counts(h).events, boundary === "transaction" ? 0 : 1);
});

for (const fault of ["owner", "dependency"]) test(`Product current ${fault} changes inside the create transaction boundary abort all side effects`, async t => {
  const h = await fixture(t); let body = input();
  if (fault === "owner") { await manager(h, "revoked-owner"); body = input({ ownerUserId: "revoked-owner" }); }
  else { const response = await send(h, input()); assert.equal(response.status, 201); body = input({ dependencyIds: [(await response.json()).decision.decisionId] }); }
  const before = counts(h); let entered = 0;
  h.controls.beforeBatch = async statements => { if (entered || !createBatch(statements)) return; entered++;
    if (fault === "owner") h.sqlite.prepare("UPDATE capability_grants SET status='revoked',revoked_at=? WHERE user_id='revoked-owner'").run(new Date().toISOString());
    else h.sqlite.prepare("DELETE FROM delivery_decisions WHERE decision_id=?").run(body.dependencyIds[0]);
  };
  const response = await send(h, body); assert.equal(entered, 1); assert.equal(response.status, 503);
  assert.equal(counts(h).decisions, before.decisions - (fault === "dependency" ? 1 : 0));
  assert.equal(counts(h).events, before.events); assert.equal(counts(h).receipts, before.receipts); assert.equal(counts(h).private, before.private);
});

test("Product a valid receipt followed by private redaction during its digest await is not published", async t => {
  const h = await fixture(t), body = input(); assert.equal((await send(h, body)).status, 201); const before = counts(h); let entered = 0;
  h.controls.afterRead = async (statement, row) => { if (!entered && receiptRead(statement) && row?.private_json) {
    entered++; h.sqlite.prepare("UPDATE event_private_payloads SET redacted_at=? WHERE private_event_id=?").run(new Date().toISOString(), row.event_id);
  } };
  const response = await send(h, body); assert.equal(entered, 1); assert.equal(response.status, 409);
  assert.equal((await response.json()).decision, undefined); assert.deepEqual(counts(h), before);
});

for (const boundary of ["transaction", "final private read"]) test(`Product principal-only impersonation activation at ${boundary} blocks publication`, async t => {
  const h = await fixture(t), now = new Date().toISOString();
  h.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES('delivery-fiction','fiction@example.test','Fiction','creator',NULL,NULL,?,?)").run(now, now);
  h.sqlite.prepare("INSERT INTO replay_personas(persona_id,session_id,owner_id,fictional_user_id,fictional_stream_id,display_name,status,created_at,updated_at) VALUES('delivery-persona','delivery-replay',?,'delivery-fiction','creative:delivery-fiction','Fiction','ready',?,?)").run(h.owner, now, now);
  h.sqlite.prepare("INSERT INTO impersonation_sessions(impersonation_id,actor_user_id,persona_id,fictional_user_id,replay_session_id,status,started_at,expires_at) VALUES('delivery-acting',?,'delivery-persona','delivery-fiction','delivery-replay','ended',?,'2099-01-01T00:00:00.000Z')").run(h.owner, now);
  let entered = 0;
  const activate = () => { entered++; h.sqlite.prepare("UPDATE impersonation_sessions SET status='active' WHERE impersonation_id='delivery-acting'").run(); };
  if (boundary === "transaction") h.controls.beforeBatch = async statements => { if (!entered && createBatch(statements)) activate(); };
  else h.controls.beforeRead = async statement => { if (!entered && finalRead(statement)) activate(); };
  const response = await send(h, input(), { cookie: "forma_impersonation=delivery-acting" }); assert.equal(entered, 1);
  assert.equal(response.ok, false); assert.equal((await response.json()).decision, undefined);
  assert.equal(counts(h).decisions, boundary === "transaction" ? 0 : 1); assert.equal(counts(h).receipts, boundary === "transaction" ? 0 : 1);
});

async function configuredParticipant(h, { owner = false, successor = false } = {}) {
  const id = "cohort-manager", headers = await manager(h, id), now = new Date().toISOString(), start = "2000-01-01T00:00:00.000Z", end = "2099-01-01T00:00:00.000Z";
  h.sqlite.prepare("INSERT INTO organizations(organization_id,name,owner_user_id,status,created_at,updated_at) VALUES('delivery-cohort-org','Delivery cohort',?,'active',?,?)").run(owner ? id : h.owner, now, now);
  if (owner) h.sqlite.prepare("INSERT INTO organization_memberships(membership_id,organization_id,user_id,role,status,invited_by_user_id,accepted_at,created_at,updated_at,revoked_at) VALUES('delivery-owner-member','delivery-cohort-org',?,'owner','active',?,?,?,?,NULL)").run(id, h.owner, now, now, now);
  const insert = h.sqlite.prepare("INSERT INTO pilot_cohorts(cohort_id,organization_id,status,starts_at,ends_at,created_by_user_id,created_at,updated_at) VALUES(?,'delivery-cohort-org',?,?,?,?,?,?)");
  insert.run("configured-delivery-cohort", successor ? "closed" : "active", start, successor ? "2001-01-01T00:00:00.000Z" : end, h.owner, now, now);
  if (successor) insert.run("successor-delivery-cohort", "active", start, end, h.owner, now, now);
  const currentId = successor ? "successor-delivery-cohort" : "configured-delivery-cohort";
  h.sqlite.prepare("INSERT INTO pilot_participants(participant_id,cohort_id,organization_id,email_normalized,user_id,role,status,invited_by_user_id,created_at,revoked_at) VALUES('delivery-participant',?,'delivery-cohort-org',?,?,'member','active',?,?,NULL)").run(currentId, id + "@example.test", id, h.owner, now);
  h.env.FORMA_PILOT_COHORT_ID = "configured-delivery-cohort";
  return { id, headers, currentId };
}

for (const boundary of ["transaction", "final private read"]) test(`Product configured-cohort clock expiry at ${boundary} matches fresh requireUser without deleting the receipt`, async t => {
  const h = await fixture(t), member = await configuredParticipant(h), body = input(); let entered = 0;
  const expire = () => { entered++; h.sqlite.prepare("UPDATE pilot_cohorts SET ends_at='2001-01-01T00:00:00.000Z' WHERE cohort_id=?").run(member.currentId); };
  if (boundary === "transaction") h.controls.beforeBatch = async statements => { if (!entered && createBatch(statements)) expire(); };
  else h.controls.beforeRead = async statement => { if (!entered && finalRead(statement)) expire(); };
  const response = await send(h, body, member.headers); assert.equal(entered, 1); assert.equal(response.ok, false); assert.equal((await response.json()).decision, undefined);
  assert.equal((await h.request("/api/session?audience=product", { headers: member.headers })).status, 403);
  assert.equal(counts(h).decisions, boundary === "transaction" ? 0 : 1); assert.equal(counts(h).receipts, boundary === "transaction" ? 0 : 1);
});

for (const mode of ["successor participant", "expired owner recovery", "explicit breakglass"]) test(`Product configured admission preserves ${mode} at commit and exact receipt recovery`, async t => {
  const h = await fixture(t), member = await configuredParticipant(h, { owner: mode === "expired owner recovery", successor: mode === "successor participant" });
  if (mode !== "successor participant") h.sqlite.prepare("UPDATE pilot_cohorts SET ends_at='2001-01-01T00:00:00.000Z' WHERE cohort_id=?").run(member.currentId);
  if (mode === "explicit breakglass") h.env.FORMA_ADMIN_EMAILS = member.id + "@example.test";
  const body = input(), created = await send(h, body, member.headers); assert.equal(created.status, 201, await created.clone().text());
  const original = await created.json(), recovered = await send(h, body, member.headers); assert.equal(recovered.status, 201);
  assert.deepEqual(await recovered.json(), original); assert.equal(counts(h).decisions, 1);
});

test("Product a configured owner without successor enrollment cannot use the recovery exception", async t => {
  const h = await fixture(t), member = await configuredParticipant(h, { owner: true, successor: true });
  h.sqlite.prepare("UPDATE pilot_participants SET status='revoked',revoked_at=? WHERE participant_id='delivery-participant'").run(new Date().toISOString());
  const before = counts(h), response = await send(h, input(), member.headers);
  assert.equal(response.status, 403); assert.equal((await response.json()).error, "pilot_participant_required"); assert.deepEqual(counts(h), before);
});

test("Product configured expiry can occur by the real SQLite clock alone before the transaction", async t => {
  const h = await fixture(t), member = await configuredParticipant(h); let entered = 0, pinned;
  h.controls.beforeBatch = async statements => {
    if (entered || !createBatch(statements)) return; entered++;
    const deadline = new Date(Date.now() + 80).toISOString();
    h.sqlite.prepare("UPDATE pilot_cohorts SET ends_at=? WHERE cohort_id=?").run(deadline, member.currentId);
    pinned = h.sqlite.prepare("SELECT * FROM pilot_cohorts WHERE cohort_id=?").get(member.currentId);
    await new Promise(resolve => setTimeout(resolve, Math.max(1, Date.parse(deadline) - Date.now() + 10)));
    assert.deepEqual(h.sqlite.prepare("SELECT * FROM pilot_cohorts WHERE cohort_id=?").get(member.currentId), pinned, "the whole cohort row remains unchanged while time passes");
  };
  const response = await send(h, input(), member.headers); assert.equal(entered, 1); assert.equal(response.ok, false);
  assert.equal(counts(h).decisions, 0); assert.equal(counts(h).receipts, 0);
});
