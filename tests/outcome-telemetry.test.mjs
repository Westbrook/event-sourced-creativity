import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test, { afterEach } from "node:test";
import { compileSqliteExpressionDepth } from "./helpers/d1-expression-depth.mjs";
import { registerOutputSourceImports } from "./output-server-test-helpers.mjs";
import { buildOutcomeTelemetry } from "../src/model/outcome-telemetry.ts";
import { buildAnalyticsReport } from "../src/model/analytics.ts";
import { handleAnalytics, projectAnalyticsPayload } from "../worker/analytics-api.ts";
import { readOutcomeTelemetryLiveEvidence } from "../worker/outcome-telemetry.ts";
import { PRINCIPAL_WITH_ACCESS_SQL, principalAccessFromRow } from "../worker/access-policy.ts";
import { ensureSchema, observeScheduledRetention, schedulePrivateContentRetention } from "../worker/runtime.ts";
import { POLICY_VERSION } from "../worker/pilot-policy.ts";

// A worker may catch a SQL failure. Keep the native failure visible to the test.
const nativeDepthFailures = [];
afterEach(() => assert.deepEqual(nativeDepthFailures.splice(0), []));
function verifyNativeDepth(sqlite, sql, bindings) {
  try {
    const result = compileSqliteExpressionDepth(sqlite, sql, { limit: 100, bindings });
    assert.equal(result.limit, 100);
    assert.ok(result.ok, result.error);
  } catch (error) {
    nativeDepthFailures.push({ sql, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

test("native telemetry depth guard rejects an over-depth statement without executing it", () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    const result = compileSqliteExpressionDepth(sqlite, "SELECT 1 WHERE " + Array(110).fill("1").join(" AND "), { limit: 100, bindings: [] });
    assert.equal(result.limit, 100); assert.equal(result.ok, false);
    assert.match(result.error, /Expression tree is too large/);
  } finally { sqlite.close(); }
});

const NOW = Date.parse("2026-08-27T12:00:00.000Z");
const ACTOR = "dev-local-creative";
const STREAM = "creative:" + ACTOR;
const STAMP = "2000-01-01T00:00:00.000Z";
const FUTURE = "2099-01-01T00:00:00.000Z";
const HASH = "a".repeat(64);
const binding = { artifact_id: "artifact-one", document_id: "document-one", artifact_revision: 0, content_sha256: HASH };
const event = (sequence, type, payload = {}, extra = {}) => ({
  eventId: "event-" + sequence, streamId: STREAM, sequence, occurredAt: new Date(NOW - 60_000).toISOString(),
  recordedAt: new Date(NOW - 60_000).toISOString(), actor: "user:" + ACTOR, clientId: "test",
  correlationId: "test-" + sequence, causationId: null, compensatesEventId: null, schemaVersion: 1, type, payload, ...extra,
});
const stream = (events, extra = {}) => ({
  streamId: STREAM, fictional: false, userId: ACTOR, userName: "Test actor",
  organizationId: "personal", organizationName: "Personal", events, ...extra,
});
const summary = (events, options = {}) => buildOutcomeTelemetry([stream(events)], { now: NOW, ...options });

test("receipt counts distinguish rendered, viewed and clicked from approved and export acknowledgments", () => {
  const events = [
    event(1, "DocumentRenderCompleted", binding),
    event(2, "DocumentArtifactViewed", binding),
    event(3, "CanvasInteractionRecorded", { interaction_id: "output_export_clicked", approved: true, delivered: true }),
    event(4, "ArtifactReviewRequested", binding),
    event(5, "ArtifactApproved", binding),
    event(6, "ArtifactApproved", binding),
    event(7, "DocumentArtifactExported", { ...binding, format: "pdf" }),
    event(8, "DocumentArtifactExported", { ...binding, format: "pptx" }),
    event(9, "ObjectExported", { object_id: "source-document" }),
    event(10, "DocumentRenderFailed", { artifact_id: "failed-video", artifact_kind: "video" }),
  ];
  const result = summary(events);
  assert.equal(result.signals.renderCompletionReceipts, 1);
  assert.equal(result.signals.viewReceipts, 1);
  assert.equal(result.signals.canvasInteractionReceipts, 1);
  assert.deepEqual(result.approvals, {
    receiptCount: 2, distinctArtifactCount: 1, exactRevisionReceiptCount: 2, distinctExactRevisionCount: 1,
    unboundReceiptCount: 0, currentlyApprovedArtifactCount: null,
  });
  assert.equal(result.exports.artifactReceiptCount, 2);
  assert.equal(result.exports.distinctExactRevisionCount, 1);
  assert.equal(result.exports.otherResourceReceiptCount, 1);
  assert.equal(result.exports.browserDownloadCount, null);
  assert.equal(result.exports.recipientDeliveryCount, null);
  assert.equal(result.live, null);
});

test("later edits, changes requested and rights changes cannot turn historical approvals into current release proof", () => {
  const result = summary([
    event(1, "ArtifactApproved", binding),
    event(2, "DocumentArtifactEdited", { ...binding, artifact_revision: 1, content_sha256: "b".repeat(64) }),
    event(3, "ArtifactChangesRequested", { ...binding, artifact_revision: 1 }),
    event(4, "RightsAsserted", { status: "expired", artifact_id: binding.artifact_id }),
    event(5, "DocumentArtifactExported", binding),
  ]);
  assert.equal(result.approvals.receiptCount, 1);
  assert.equal(result.approvals.currentlyApprovedArtifactCount, null);
  assert.equal(result.exports.distinctExactRevisionCount, 1);
  assert.equal(result.exports.recipientDeliveryCount, null);
});

test("unbound legacy receipts remain visible without inventing exact source or output revisions", () => {
  const result = summary([
    event(1, "ArtifactApproved", { artifact_id: "legacy" }),
    event(2, "ArtifactApproved", { ...binding, artifact_revision: "0" }),
    event(3, "DocumentArtifactExported", { ...binding, content_sha256: "not-a-digest" }),
    event(4, "DocumentArtifactExported", { ...binding, artifact_revision: -1 }),
    event(5, "DocumentArtifactExported", { ...binding, artifact_revision: 1, content_sha256: "b".repeat(64) }),
  ]);
  assert.equal(result.approvals.unboundReceiptCount, 2);
  assert.equal(result.approvals.distinctExactRevisionCount, 0);
  assert.equal(result.exports.unboundArtifactReceiptCount, 2);
  assert.equal(result.exports.distinctExactRevisionCount, 1);
});

test("stable canonical event IDs deduplicate receipts while stream-scoped artifact identities stay distinct", () => {
  const first = event(1, "ArtifactApproved", binding);
  const second = { ...first, streamId: "creative:another" };
  const result = buildOutcomeTelemetry([
    stream([first, structuredClone(first)]),
    stream([second], { streamId: "creative:another" }),
  ], { now: NOW });
  assert.equal(result.approvals.receiptCount, 2);
  assert.equal(result.approvals.distinctArtifactCount, 2);
  assert.equal(result.coverage.ignoredDuplicateReceipts, 1);
});

test("synthetic, future, out-of-range and mismatched identity evidence cannot inflate observed outcomes", () => {
  const events = [
    event(1, "ArtifactApproved", binding),
    event(2, "ArtifactApproved", { ...binding, synthetic: true }),
    event(3, "ArtifactApproved", binding, { occurredAt: "2099-01-01T00:00:00.000Z" }),
    event(4, "ArtifactApproved", binding, { occurredAt: "2000-01-01T00:00:00.000Z" }),
    event(5, "ArtifactApproved", binding, { streamId: "wrong-stream" }),
    event(6, "ArtifactApproved", binding, { occurredAt: "not-time" }),
  ];
  const options = { now: NOW, rangeStart: "2026-08-26T00:00:00.000Z", truncated: true };
  const result = buildOutcomeTelemetry([stream(events), stream([event(7, "ArtifactApproved", binding)], { fictional: true })], options);
  assert.equal(result.approvals.receiptCount, 1);
  assert.equal(result.coverage.invalidIdentityOrTimeReceipts, 2);
  assert.equal(result.coverage.truncated, true);
  assert.equal(buildOutcomeTelemetry([stream(events)], { ...options, includeSynthetic: true }).approvals.receiptCount, 2);
});

test("recorded zero is exact usage, missing/invalid prices stay unknown, and neither is an invoice", () => {
  const events = [
    event(1, "GenerationUsageRecorded", { cost_microusd: 0, input_tokens: 100 }),
    event(2, "GenerationUsageRecorded", { cost_microusd: 100_000 }),
    event(3, "GenerationUsageRecorded", { input_tokens: 2_000 }),
    event(4, "GenerationUsageRecorded", { cost_microusd: -1 }),
    event(5, "GenerationUsageRecorded", { cost_microusd: "3000000" }),
  ];
  const result = summary(events);
  assert.equal(result.usage.recordedMicrousd, 100_000);
  assert.equal(result.usage.recordedCostReceiptCount, 2);
  assert.equal(result.usage.unpricedReceiptCount, 3);
  assert.equal(result.usage.providerInvoiceReconciled, null);
  const legacyReport = buildAnalyticsReport([stream(events.slice(0, 2))], { now: NOW });
  assert.equal(legacyReport.source.exactCostReceipts, 2, "zero-priced recovery must not become another estimated purchase");
  assert.equal(legacyReport.source.estimatedCostReceipts, 0);
  assert.equal(legacyReport.cost.totalMicrousd, 100_000);
  assert.equal(legacyReport.outcomes.usage.recordedMicrousd, 100_000);
  assert.equal(summary([
    event(6, "GenerationUsageRecorded", { cost_microusd: Number.MAX_SAFE_INTEGER }),
    event(7, "GenerationUsageRecorded", { cost_microusd: 1 }),
  ]).usage.recordedMicrousd, null);
});

async function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  const calls = [];
  let afterBatch = null;
  let nativeDepthReady = false;
  class Statement {
    constructor(sql, values = []) { this.sql = sql; this.values = values; }
    bind(...values) { assert.ok(values.length <= 100); return new Statement(this.sql, values); }
    execute(kind) {
      if (nativeDepthReady) verifyNativeDepth(sqlite, this.sql, this.values);
      const statement = sqlite.prepare(this.sql);
      if (kind === "first") return statement.get(...this.values) ?? null;
      if (kind === "all") return { results: statement.all(...this.values), success: true, meta: { changes: 0 } };
      const result = statement.run(...this.values);
      return { results: [], success: true, meta: { changes: Number(result.changes) } };
    }
    async first(column) { calls.push(this.sql); const row = this.execute("first"); return column ? row?.[column] ?? null : row; }
    async all() { calls.push(this.sql); return this.execute("all"); }
    async run() { calls.push(this.sql); return this.execute("run"); }
  }
  const DB = {
    prepare(sql) { return new Statement(sql); },
    async batch(statements) {
      calls.push(...statements.map((item) => item.sql));
      sqlite.exec("BEGIN");
      let results;
      try {
        results = statements.map((item) => item.execute(/^\s*(?:SELECT|WITH|PRAGMA)/i.test(item.sql) ? "all" : "run"));
        sqlite.exec("COMMIT");
      } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
      if (afterBatch) { const hook = afterBatch; afterBatch = null; hook(); }
      return results;
    },
  };
  const env = { DB, ASSETS: { fetch() { throw new Error("asset network forbidden"); } }, MEDIA: {} };
  await ensureSchema(env);
  nativeDepthReady = true;
  const user = (id, role = "admin") => sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
    .run(id, id === ACTOR ? "creative@local.forma" : id + "@test.invalid", id === ACTOR ? "Local creative" : id, role, POLICY_VERSION, STAMP, STAMP, STAMP);
  user(ACTOR); user("owner", "creator"); user("other", "creator");
  function addEvent(type, payload, streamId = STREAM, actor = "user:" + ACTOR) {
    const sequence = sqlite.prepare("SELECT COALESCE(MAX(sequence),0)+1 AS next FROM events WHERE stream_id=?").get(streamId).next;
    const value = event(sequence, type, payload, { streamId, eventId: streamId + ":event:" + sequence, actor, occurredAt: new Date(Date.now() - 1_000).toISOString() });
    sqlite.prepare("INSERT INTO events(event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,schema_version,type,payload) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
      .run(value.eventId, streamId, sequence, value.occurredAt, value.recordedAt, actor, "test", value.correlationId, 1, type, JSON.stringify(payload));
    return value;
  }
  function document(id = "personal-document", projectId = "personal-project", streamId = STREAM) {
    addEvent("ProjectCreated", { project_id: projectId }, streamId);
    addEvent("DocumentCreated", { project_id: projectId, document_id: id }, streamId);
    return id;
  }
  document();
  function reservation(id, { ownerId = ACTOR, streamId = STREAM, period = "2026-08", status = "executing", reserved = 19_644_000, used = 0 } = {}) {
    sqlite.prepare("INSERT INTO cost_budget_reservations(reservation_id,owner_id,workspace_id,stream_id,correlation_id,operation,period,reserved_microusd,used_microusd,status,allow_user_overage,created_at,settled_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,0,?,?,?)")
      .run(id, ownerId, "forma", streamId, id + ":correlation", "document-render:video", period, reserved, used, status, STAMP, status === "settled" || status === "released" ? STAMP : null, STAMP);
  }
  function job(id, { ownerId = ACTOR, streamId = STREAM, documentId = "personal-document", kind = "render_document", status = "completed", request = {}, result = { artifactId: "artifact", media_url: "https://private.invalid/media", body: "PRIVATE BODY" }, expiresAt = FUTURE } = {}) {
    sqlite.prepare("INSERT INTO document_jobs(job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,request_json,result_json,attempt_count,requested_at,expires_at,updated_at) VALUES(?,?,?,?,?,?,'test',?,1,?,?,1,?,?,?)")
      .run(id, ownerId, streamId, documentId, kind, status, id + ":correlation", JSON.stringify(request), result === null ? null : typeof result === "string" ? result : JSON.stringify(result), STAMP, expiresAt, STAMP);
  }
  function project(id, role = "editor") {
    const organizationId = id + "-org", projectId = id + "-project", ownerId = "owner", documentId = id + "-document";
    sqlite.prepare("INSERT INTO organizations(organization_id,name,owner_user_id,status,created_at,updated_at) VALUES(?,?,?,'active',?,?)").run(organizationId, "Test organization", ownerId, STAMP, STAMP);
    for (const member of [ownerId, ACTOR]) sqlite.prepare("INSERT INTO organization_memberships(membership_id,organization_id,user_id,role,status,invited_by_user_id,accepted_at,created_at,updated_at) VALUES(?,?,?,?, 'active',?,?,?,?)")
      .run(id + ":" + member, organizationId, member, member === ownerId ? "owner" : "member", ownerId, STAMP, STAMP, STAMP);
    sqlite.prepare("INSERT INTO organization_projects(project_access_id,project_id,organization_id,owner_user_id,status,created_at,updated_at) VALUES(?,?,?,?,'active',?,?)").run(id, projectId, organizationId, ownerId, STAMP, STAMP);
    sqlite.prepare("INSERT INTO project_memberships(membership_id,project_access_id,project_id,organization_id,user_id,role,status,granted_by_user_id,created_at,updated_at) VALUES(?,?,?,?,?,?,'active',?,?,?)")
      .run(id + ":membership", id, projectId, organizationId, ACTOR, role, ownerId, STAMP, STAMP);
    sqlite.prepare("INSERT INTO project_migration_states(project_access_id,organization_id,owner_user_id,status,updated_at) VALUES(?,?,?,'active',?)").run(id, organizationId, ownerId, STAMP);
    document(documentId, projectId, "creative:" + ownerId);
    sqlite.prepare("INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,visibility,actor_user_id,created_at) VALUES(?,'document',?,?,?,?,'authored',?,?)")
      .run(id, documentId, organizationId, projectId, ownerId, ownerId, STAMP);
    return { id, projectId, organizationId, ownerId, documentId };
  }
  function sharedJob(id, scope, options = {}) {
    job(id, { ...options, streamId: "creative:" + scope.ownerId, documentId: scope.documentId });
    const actorId = options.ownerId ?? ACTOR;
    const anchor = addEvent("ProjectDocumentJobQueued", {
      job_id: id, document_id: options.badAnchor ? "wrong-document" : scope.documentId,
      organization_id: scope.organizationId, project_access_id: scope.id, project_id: scope.projectId,
      history_owner_user_id: scope.ownerId, actor_user_id: actorId,
    }, "creative:" + scope.ownerId, "user:" + actorId);
    sqlite.prepare("INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,visibility,source_event_id,actor_user_id,created_at) VALUES(?,'job',?,?,?,?,'actor_private',?,?,?)")
      .run(scope.id, id, scope.organizationId, scope.projectId, scope.ownerId, anchor.eventId, actorId, STAMP);
  }
  async function principal() {
    verifyNativeDepth(sqlite, PRINCIPAL_WITH_ACCESS_SQL, [ACTOR]);
    const row = sqlite.prepare(PRINCIPAL_WITH_ACCESS_SQL).get(ACTOR);
    return {
      userId: ACTOR, streamId: STREAM, email: row.email, displayName: row.display_name, role: row.role,
      consentVersion: row.consent_version, consentedAt: row.consented_at,
      access: await principalAccessFromRow(row, row.role, { email: row.email, source: "local-development", subject: ACTOR }),
      authorizationSnapshot: {
        updatedAt: row.updated_at, rawEpoch: row.permission_epoch, grants: row.grants_json,
        organizations: row.organizations_json, projects: row.projects_json,
        identityPolicies: row.identity_policies_json, canvasRequirements: row.approved_canvas_requirements,
      },
    };
  }
  return {
    sqlite, env, calls, document, reservation, job, project, sharedJob, addEvent, principal,
    setAfterBatch(hook) { afterBatch = hook; },
    reset() { calls.length = 0; },
    assertReadOnly() { assert.ok(calls.every((sql) => /^\s*(?:SELECT|WITH)/i.test(sql)), "telemetry uses SELECT only"); },
  };
}

test("real SQL keeps failed-work holds, settled spend and original periods distinct without counter duplication", async () => {
  const f = await fixture();
  f.reservation("rejected-video");
  f.reservation("older-hold", { period: "2026-07", status: "active", reserved: 1_000_000 });
  f.reservation("settled", { status: "settled", reserved: 8_000_000, used: 6_000_000 });
  f.reservation("released", { status: "released", reserved: 9_000_000 });
  f.reservation("foreign", { ownerId: "other", reserved: 50_000_000 });
  f.reservation("own-shared-charge", { streamId: "creative:owner", period: "2026-06", status: "settled", used: 2_000_000 });
  f.sqlite.prepare("INSERT INTO cost_budget_counters(scope,scope_id,period,used_microusd,reserved_microusd,hard_limit_microusd,updated_at) VALUES('user',?,'2026-08',999999999,999999999,1000000000,?)").run(ACTOR, STAMP);
  f.job("rejected-video", { status: "failed", result: { productionCompletedSceneCount: 0, generationReceipt: { provider_request_status: "rejected", settled_cost_microusd: null, reservation_status: "executing" } } });
  const user = await f.principal();
  const before = JSON.stringify(f.sqlite.prepare("SELECT * FROM cost_budget_reservations ORDER BY reservation_id").all());
  f.reset();
  const read = await readOutcomeTelemetryLiveEvidence(f.env, user, NOW);
  assert.equal(read.ok, true);
  const live = read.evidence;
  assert.equal(live.finance.scope, "actor-account");
  assert.equal(live.finance.heldMicrousd, 20_644_000);
  assert.equal(live.finance.settledMicrousd, 8_000_000);
  assert.deepEqual(live.finance.periods.map((row) => row.period), ["2026-06", "2026-07", "2026-08"]);
  assert.equal(live.jobs.failed, 1);
  assert.equal(live.jobs.usableResultCount, null);
  assert.equal(live.jobs.mediaAvailability, "not-checked");
  assert.equal(JSON.stringify(f.sqlite.prepare("SELECT * FROM cost_budget_reservations ORDER BY reservation_id").all()), before);
  f.assertReadOnly();
  const report = summary([], { rangeStart: "2026-08-27T00:00:00.000Z", liveEvidence: live });
  assert.equal(report.live.finance.heldMicrousd, 20_644_000, "event range must not erase a prior-month hold");
  assert.equal(report.approvals.receiptCount, 0);
  assert.equal(report.exports.artifactReceiptCount, 0);
  assert.equal(report.signals.renderCompletionReceipts, 0);
});

test("unknown ledger states, malformed amounts and overflow remain unknown rather than zero", async () => {
  const f = await fixture();
  f.reservation("unknown", { status: "authorizing" });
  const first = await readOutcomeTelemetryLiveEvidence(f.env, await f.principal(), NOW);
  assert.equal(first.ok, true);
  assert.equal(first.evidence.finance.heldMicrousd, null);
  assert.equal(first.evidence.finance.periods[0].unclassifiedCount, 1);
  f.sqlite.prepare("UPDATE cost_budget_reservations SET status='executing',reserved_microusd='invalid' WHERE reservation_id='unknown'").run();
  const malformed = await readOutcomeTelemetryLiveEvidence(f.env, await f.principal(), NOW);
  assert.equal(malformed.evidence.finance.heldMicrousd, null);
  assert.equal(malformed.evidence.finance.periods[0].invalidAmountCount, 1);
  f.sqlite.prepare("UPDATE cost_budget_reservations SET reserved_microusd=?").run(Number.MAX_SAFE_INTEGER);
  f.reservation("overflow", { reserved: 1 });
  const overflow = await readOutcomeTelemetryLiveEvidence(f.env, await f.principal(), NOW);
  assert.equal(overflow.evidence.finance.heldMicrousd, null);
});

test("missing live evidence is unknown; an authorized empty ledger snapshot has measured zero", async () => {
  assert.equal(summary([]).live, null);
  const f = await fixture();
  const read = await readOutcomeTelemetryLiveEvidence(f.env, await f.principal(), NOW);
  assert.equal(read.ok, true);
  assert.equal(read.evidence.finance.heldMicrousd, 0);
  assert.equal(read.evidence.finance.settledMicrousd, 0);
  assert.deepEqual(read.evidence.finance.periods, []);
});

test("real SQL permits only exact actor/project jobs and preserves read-only paid-plan inspection", async () => {
  const f = await fixture();
  f.job("personal");
  const editable = f.project("editable");
  const viewer = f.project("viewer", "viewer");
  f.sharedJob("own-shared", editable);
  f.sharedJob("other-actor", editable, { ownerId: "other" });
  f.sharedJob("bad-anchor", editable, { badAnchor: true });
  f.sharedJob("viewer-render", viewer);
  f.sharedJob("viewer-plan", viewer, { kind: "structure_adaptive", request: { adaptiveConsentVersion: 1 } });
  f.sharedJob("viewer-legacy-plan", viewer, { kind: "structure_adaptive" });
  f.sharedJob("canvas-plan", editable, { kind: "structure_adaptive", request: { adaptiveConsentVersion: 1, canvasId: "board" } });
  const read = await readOutcomeTelemetryLiveEvidence(f.env, await f.principal(), NOW);
  assert.equal(read.ok, true);
  assert.equal(read.evidence.jobs.total, 3, "one personal result, the actor's shared result, and their retained read-only planning job");
  assert.equal(read.evidence.jobs.completed, 3);
  assert.equal(read.evidence.jobs.usableResultCount, null);
  assert.ok(!/PRIVATE BODY|private.invalid|generationReceipt|providerJobId|job_id/.test(JSON.stringify(read.evidence)));
});

test("document custody prevents personal fallback and inactive migration or foreign scope cannot expose jobs", async () => {
  const f = await fixture();
  const governed = f.project("governed");
  f.sharedJob("scoped-job", governed);
  f.sqlite.prepare("UPDATE project_migration_states SET status='pending' WHERE project_access_id=?").run(governed.id);
  const doc = "legacy-governed-document";
  f.document(doc, governed.projectId);
  f.sqlite.prepare("UPDATE organization_projects SET owner_user_id=? WHERE project_access_id=?").run(ACTOR, governed.id);
  f.job("unscoped-governed-job", { documentId: doc });
  const read = await readOutcomeTelemetryLiveEvidence(f.env, await f.principal(), NOW);
  assert.equal(read.ok, true);
  assert.equal(read.evidence.jobs.total, 0);
});

test("revocation while a SQL snapshot returns discards all metadata under the captured authority", async () => {
  const f = await fixture();
  const scope = f.project("revoked");
  f.sharedJob("job", scope);
  f.reservation("hold");
  const user = await f.principal();
  f.reset();
  f.setAfterBatch(() => f.sqlite.prepare("UPDATE project_memberships SET status='revoked',revoked_at=? WHERE project_access_id=? AND user_id=?").run(STAMP, scope.id, ACTOR));
  const read = await readOutcomeTelemetryLiveEvidence(f.env, user, NOW);
  assert.deepEqual(read, { ok: false, code: "analytics_access_changed" });
  f.assertReadOnly();
});

test("missing or stale authority never returns empty success as if all holds or jobs disappeared", async () => {
  const f = await fixture();
  const user = await f.principal();
  f.reset();
  assert.deepEqual(await readOutcomeTelemetryLiveEvidence(f.env, { ...user, authorizationSnapshot: undefined }, NOW), { ok: false, code: "analytics_access_changed" });
  assert.equal(f.calls.length, 0);
  f.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id=?").run(ACTOR);
  assert.deepEqual(await readOutcomeTelemetryLiveEvidence(f.env, user, NOW), { ok: false, code: "analytics_access_changed" });
});

test("completion, checkpoint retention and explicit unavailability do not become media or delivery confirmation", async () => {
  const f = await fixture();
  f.job("retained");
  f.job("unavailable", { kind: "structure_adaptive", result: { resultUnavailable: true, privatePrompt: "PRIVATE PLAN" } });
  f.job("missing", { result: null });
  f.job("malformed", { result: "not-json" });
  f.job("string-flag", { result: { resultUnavailable: "true" } });
  f.job("expired-terminal", { expiresAt: STAMP });
  f.job("expired-active", { status: "running", expiresAt: STAMP });
  const read = await readOutcomeTelemetryLiveEvidence(f.env, await f.principal(), NOW);
  assert.equal(read.ok, true);
  const jobs = read.evidence.jobs;
  assert.equal(jobs.total, 6);
  assert.equal(jobs.completed, 5);
  assert.equal(jobs.completedExplicitlyUnavailable, 1);
  assert.equal(jobs.completedAvailabilityUnknown, 4);
  assert.equal(jobs.retainedCheckpointCount, 3);
  assert.equal(jobs.missingOrInvalidCheckpointCount, 3);
  assert.equal(jobs.usableResultCount, null);
  assert.equal(jobs.mediaAvailability, "not-checked");
  const extended = { ...read.evidence, privatePrompt: "PRIVATE", finance: { ...read.evidence.finance, privateBody: "PRIVATE" }, jobs: { ...jobs, providerKey: "PRIVATE" } };
  const events = [event(1, "ArtifactApproved", binding)];
  const before = JSON.stringify({ events, extended });
  const result = summary(events, { liveEvidence: extended });
  assert.equal(JSON.stringify({ events, extended }), before);
  assert.ok(!/PRIVATE|privateBody|providerKey|privatePrompt/.test(JSON.stringify(result)));
});

test("host analytics projects only exact receipt metadata and refreshes holds on an unchanged event-cache hit", async () => {
  const f = await fixture();
  f.addEvent("ArtifactApproved", { ...binding, review_note: "PRIVATE REVIEW", submitted_prompt: "PRIVATE PROMPT", media_url: "https://private.invalid" });
  f.addEvent("DocumentArtifactExported", binding);
  f.reservation("current-hold");
  const request = () => new Request("http://localhost/api/analytics?days=all");
  f.reset();
  const first = await handleAnalytics(request(), f.env);
  assert.equal(first.status, 200);
  const firstReport = (await first.json()).report;
  assert.equal(firstReport.outcomes.approvals.exactRevisionReceiptCount, 1);
  assert.equal(firstReport.outcomes.exports.exactRevisionReceiptCount, 1);
  assert.equal(firstReport.outcomes.live.finance.heldMicrousd, 19_644_000);
  f.assertReadOnly();
  assert.ok(!/PRIVATE REVIEW|PRIVATE PROMPT|private.invalid/.test(JSON.stringify(firstReport)));
  f.sqlite.prepare("UPDATE cost_budget_reservations SET status='settled',used_microusd=3000000,settled_at=? WHERE reservation_id='current-hold'").run(STAMP);
  f.reset();
  const second = await handleAnalytics(request(), f.env);
  assert.equal(second.status, 200);
  assert.equal(second.headers.get("x-forma-analytics-cache"), "delta");
  assert.equal(second.headers.get("x-forma-analytics-source-rows"), "0");
  const next = (await second.json()).report;
  assert.equal(next.outcomes.live.finance.heldMicrousd, 0);
  assert.equal(next.outcomes.live.finance.settledMicrousd, 3_000_000);
  assert.equal(next.outcomes.usage.recordedMicrousd, 0, "the event measure is not added to or replaced by the independent account ledger");
  f.assertReadOnly();
  assert.deepEqual(projectAnalyticsPayload("ArtifactApproved", { ...binding, content_json: "PRIVATE", review_note: "PRIVATE" }), binding);
});

test("old safe analytics snapshots without receipt-binding projection are rebuilt; new ones retain the existing cache schema", async () => {
  const f = await fixture();
  f.addEvent("ArtifactApproved", binding);
  const pending = [], context = { waitUntil(promise) { pending.push(promise); } };
  const request = () => new Request("http://localhost/api/analytics?days=all");
  assert.equal((await handleAnalytics(request(), f.env, context)).status, 200);
  await Promise.all(pending.splice(0));
  let saved = f.sqlite.prepare("SELECT content_id,content FROM external_content WHERE content_id LIKE 'analytics-source:v1:%'").get();
  const checkpoint = JSON.parse(saved.content);
  assert.equal(checkpoint.schema, 2);
  assert.equal(checkpoint.outcomeBindings, 2);
  delete checkpoint.outcomeBindings;
  f.sqlite.prepare("UPDATE external_content SET content=? WHERE content_id=?").run(JSON.stringify(checkpoint), saved.content_id);
  const freshDB = { prepare: (sql) => f.env.DB.prepare(sql), batch: (statements) => f.env.DB.batch(statements) };
  const cold = await handleAnalytics(request(), { ...f.env, DB: freshDB }, context);
  assert.equal(cold.status, 200);
  assert.equal(cold.headers.get("x-forma-analytics-cache"), "miss");
  assert.equal((await cold.json()).report.outcomes.approvals.exactRevisionReceiptCount, 1);
  await Promise.all(pending.splice(0));
  saved = f.sqlite.prepare("SELECT content FROM external_content WHERE content_id=?").get(saved.content_id);
  assert.equal(JSON.parse(saved.content).outcomeBindings, 2);
});

test("existing traffic cleanup produces no scheduled receipt; explicit scheduled-handler invocation does", async t => {
  // The published Memory cleanup loads TypeScript dependencies lazily in this Node fixture.
  const sourceImports = registerOutputSourceImports();
  t.after(() => sourceImports.deregister());
  const f = await fixture();
  const pending = [];
  schedulePrivateContentRetention(f.env, { waitUntil(promise) { pending.push(promise); } });
  await Promise.all(pending);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS count FROM retention_sweep_runs WHERE trigger_kind='scheduled'").get().count, 0);
  await observeScheduledRetention(f.env, 1000);
  const receipt = f.sqlite.prepare("SELECT trigger_kind,status FROM retention_sweep_runs").get();
  assert.deepEqual({ ...receipt }, { trigger_kind: "scheduled", status: "completed" });
  const source = await readFile(new URL("../worker/enterprise-api.ts", import.meta.url), "utf8");
  assert.match(source, /hostingScheduleVerified:\s*false/);
  assert.match(source, /schedulerConfigured:\s*false/);
  // This is a controlled in-memory handler invocation, not hosted no-traffic evidence.
});

test("safe receipt projection rejects prose disguised as hashes, nonnumeric revisions and unrelated-event fields", () => {
  const projected = projectAnalyticsPayload("ArtifactApproved", { ...binding, content_sha256: "PRIVATE TEXT", artifact_revision: "PRIVATE TEXT" });
  assert.equal(projected.content_sha256, undefined);
  assert.equal(projected.artifact_revision, undefined);
  const unrelated = projectAnalyticsPayload("CanvasInteractionRecorded", { content_sha256: HASH, artifact_revision: 0 });
  assert.deepEqual(unrelated, {});
});

test("ambiguous document custody is not resolved by guessing a matching project", async () => {
  const f = await fixture();
  const scope = f.project("one");
  const other = f.project("two");
  f.sharedJob("job", scope);
  f.sqlite.prepare("INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,visibility,actor_user_id,created_at) VALUES(?,'document',?,?,?,?,'authored',?,?)")
    .run(other.id, scope.documentId, other.organizationId, other.projectId, other.ownerId, other.ownerId, STAMP);
  const result = await readOutcomeTelemetryLiveEvidence(f.env, await f.principal(), NOW);
  assert.equal(result.ok, true);
  assert.equal(result.evidence.jobs.total, 0);
});

test("current Canvas capability is required for board planning metadata and an expired grant cannot be replayed", async () => {
  const f = await fixture();
  const scope = f.project("canvas");
  f.sharedJob("plan", scope, { kind: "structure_adaptive", request: { adaptiveConsentVersion: 1, canvasId: "board" } });
  f.sqlite.prepare("INSERT INTO capability_grants(grant_id,user_id,capability,scope_type,organization_id,project_access_id,project_id,status,granted_by_user_id,created_at,updated_at,expires_at) VALUES('canvas-grant',?,'project.canvas.use','project',?,?,?,'active',?,?,?,?)")
    .run(ACTOR, scope.organizationId, scope.id, scope.projectId, scope.ownerId, STAMP, STAMP, FUTURE);
  const user = await f.principal();
  const allowed = await readOutcomeTelemetryLiveEvidence(f.env, user, NOW);
  assert.equal(allowed.ok, true);
  assert.equal(allowed.evidence.jobs.total, 1);
  f.sqlite.prepare("UPDATE capability_grants SET expires_at=? WHERE grant_id='canvas-grant'").run(STAMP);
  assert.deepEqual(await readOutcomeTelemetryLiveEvidence(f.env, user, NOW), { ok: false, code: "analytics_access_changed" });
  const fresh = await readOutcomeTelemetryLiveEvidence(f.env, await f.principal(), NOW);
  assert.equal(fresh.ok, true);
  assert.equal(fresh.evidence.jobs.total, 0);
});

test("bounded period reads expose truncation and never call a partial total the complete account hold", async () => {
  const f = await fixture();
  f.sqlite.exec("BEGIN");
  for (let index = 0; index < 1201; index++) {
    const year = 1900 + Math.floor(index / 12), month = String(index % 12 + 1).padStart(2, "0");
    f.reservation("period-" + index, { period: year + "-" + month, reserved: 1 });
  }
  f.sqlite.exec("COMMIT");
  const read = await readOutcomeTelemetryLiveEvidence(f.env, await f.principal(), NOW);
  assert.equal(read.ok, true);
  assert.equal(read.evidence.finance.truncated, true);
  assert.equal(read.evidence.finance.periods.length, 1200);
  assert.equal(read.evidence.finance.heldMicrousd, null);
  assert.equal(read.evidence.finance.settledMicrousd, null);
});
