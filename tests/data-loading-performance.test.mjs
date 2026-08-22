import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import worker from "../dist/server/index.js";
import { foldEvents } from "../src/model/events.ts";
import { performanceRouteFamily } from "../src/performance.ts";

function measuredDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  const calls = [];
  const writes = (sql) => /^\s*(?:INSERT|UPDATE|DELETE|REPLACE)/i.test(sql);

  class PreparedStatement {
    constructor(sql, values = []) { this.sql = sql; this.values = values; }
    bind(...values) { return new PreparedStatement(this.sql, values); }
    execute(kind) {
      const statement = sqlite.prepare(this.sql);
      if (kind === "first") return statement.get(...this.values) ?? null;
      if (kind === "all") return { results: statement.all(...this.values), success: true, meta: { changes: 0 } };
      const result = statement.run(...this.values);
      return { results: [], success: true, meta: { changes: Number(result.changes ?? 0) } };
    }
    async first() { calls.push({ sql: this.sql, kind: "first", writes: 0 }); return this.execute("first"); }
    async all() { calls.push({ sql: this.sql, kind: "all", writes: 0 }); return this.execute("all"); }
    async run() { calls.push({ sql: this.sql, kind: "run", writes: Number(writes(this.sql)) }); return this.execute("run"); }
  }

  const DB = {
    prepare(sql) { return new PreparedStatement(sql); },
    async batch(statements) {
      calls.push({ sql: "BATCH", kind: "batch", statements, writes: statements.filter((statement) => writes(statement.sql)).length });
      sqlite.exec("BEGIN");
      try {
        const result = statements.map((statement) => statement.execute(/^\s*(?:SELECT|WITH)/i.test(statement.sql) ? "all" : "run"));
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };

  return {
    sqlite,
    DB,
    calls,
    reset() { calls.length = 0; },
    writeCount() { return calls.reduce((total, call) => total + call.writes, 0); },
  };
}

async function productionWorker() {
  const database = measuredDatabase();
  const environment = {
    DB: database.DB,
    ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
    MEDIA: {},
  };
  const context = { waitUntil() {} };
  const request = (path, init) => worker.fetch(new Request(`http://localhost${path}`, init), environment, context);

  // Warm the isolate schema, authenticated account, budget rows, and seed.
  assert.equal((await request("/api/session")).status, 200);
  database.sqlite.prepare("UPDATE users SET consent_version=?").run("pilot-2026-08-10");
  assert.equal((await request("/api/events?after=0&limit=2000&content=0")).status, 200);
  database.reset();
  return { database, environment, request };
}

function addTerminalPromptFans(sqlite, count = 2) {
  const owner = "dev-local-creative";
  const stream = `creative:${owner}`;
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 86_400_000).toISOString();
  const insert = sqlite.prepare("INSERT INTO document_jobs(job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,request_json,result_json,error_message,requested_at,completed_at,notified_at,expires_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");

  for (let index = 0; index < count; index += 1) {
    const parent = `fan-${index}`;
    const childIds = Array.from({ length: 4 }, (_, child) => `${parent}-${child}`);
    for (const child of childIds) {
      insert.run(child, owner, stream, "doc-atmosphere", "generate", "failed", "studio", child, 1, JSON.stringify({ promptTechnique: "prose" }), null, "child_failed", now, now, now, expires, now);
    }
    const members = childIds.map((jobId) => ({ jobId, promptTechnique: "prose", status: "failed", error: null, moderationPromptRef: null, attemptCount: 0, updatedAt: now }));
    const result = { stage: "failed", members, completedCount: 0, failedCount: 4, canceledCount: 0, totalCount: 4 };
    insert.run(parent, owner, stream, "doc-atmosphere", "prompt_fan", "failed", "studio", parent, 1, JSON.stringify({ childJobIds: childIds }), JSON.stringify(result), "prompt_fan_failed", now, now, now, expires, now);
  }
}

test("route timing correctly classifies Canvas proposals and Laboratory aliases", () => {
  assert.equal(performanceRouteFamily("/canvas/proposals"), "canvas-proposals");
  assert.equal(performanceRouteFamily("/canvas/proposals/proposal-1"), "canvas-proposals");
  assert.equal(performanceRouteFamily("/canvas/canvas-1"), "canvas-workspace");
  assert.equal(performanceRouteFamily("/system/focal-points"), "laboratory");
  assert.equal(performanceRouteFamily("/admin/events/replay"), "laboratory");
  assert.equal(performanceRouteFamily("/admin/events/permissions"), "operations");
});

test("steady-state account sessions use three read-only D1 calls", async () => {
  const { database, request } = await productionWorker();
  const response = await request("/api/session");
  assert.equal(response.status, 200);
  assert.ok(database.calls.length <= 3, `expected ≤3 D1 round trips, received ${database.calls.length}`);
  assert.equal(database.writeCount(), 0);
  assert.match(response.headers.get("server-timing") ?? "", /app;dur=/);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("route-specific projects are complete, private, and fetched in one D1 batch", async () => {
  const { database, request } = await productionWorker();
  const full = await (await request("/api/events?after=0&limit=2000&content=0")).json();
  database.reset();

  const response = await request("/api/events?after=0&limit=5000&profile=projects&content=0");
  const profile = await response.json();
  assert.equal(response.status, 200);
  assert.equal(profile.profile, "projects");
  assert.equal("content" in profile, false);
  assert.ok(profile.events.length < full.events.length);
  assert.deepEqual(foldEvents(profile.events).projects, foldEvents(full.events).projects);
  assert.ok(database.calls.length <= 2, `expected auth + one D1 batch, received ${database.calls.length}`);
  assert.equal(database.writeCount(), 0);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("full event pages and their heads share one consistent D1 round trip", async () => {
  const { database, request } = await productionWorker();
  const response = await request("/api/events?after=0&limit=1&content=0");
  const page = await response.json();
  assert.equal(response.status, 200);
  assert.equal(page.events.length, 1);
  assert.equal(page.nextAfter, page.events[0].sequence);
  assert.equal(page.hasMore, true);
  assert.ok(database.calls.length <= 2, `expected auth + one consistent D1 batch, received ${database.calls.length}`);
  const batch = database.calls.find((call) => call.kind === "batch");
  assert.equal(batch?.statements.length, 2);
  assert.match(batch.statements[0].sql, /SELECT \* FROM events/);
  assert.match(batch.statements[1].sql, /MAX\(sequence\)/);
  assert.equal(database.writeCount(), 0);
});

test("idle job polling neither rewrites data nor rechecks terminal prompt fans", async () => {
  const { database, request } = await productionWorker();
  addTerminalPromptFans(database.sqlite);
  database.reset();

  const response = await request("/api/document-jobs");
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.ok(body.jobs.some((job) => job.kind === "prompt_fan"));
  assert.ok(database.calls.length <= 2, `expected auth + one jobs query, received ${database.calls.length}`);
  assert.equal(database.writeCount(), 0);
});

test("projects ignore acknowledged failures while preserving active and unnotified jobs", async () => {
  const { database, request } = await productionWorker();
  addTerminalPromptFans(database.sqlite);
  database.reset();

  const response = await request("/api/document-jobs?scope=active");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { jobs: [] });
  assert.ok(database.calls.length <= 2, `expected auth + one scoped jobs query, received ${database.calls.length}`);
  assert.equal(database.writeCount(), 0);

  database.sqlite.prepare("UPDATE document_jobs SET notified_at=NULL WHERE job_id=?").run("fan-0");
  database.reset();
  const pending = await (await request("/api/document-jobs?scope=active")).json();
  assert.deepEqual(pending.jobs.map((job) => job.jobId), ["fan-0"]);
  assert.equal(database.writeCount(), 0);
});

test("idle polling summarizes large recovery checkpoints while explicit inspection preserves them", async () => {
  const { database, request } = await productionWorker();
  const owner = "dev-local-creative";
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 86_400_000).toISOString();
  const result = {
    artifactKind: "video",
    providerJobId: "existing-provider-job",
    plannerInput: { context: "p".repeat(24_000) },
    videoInputReceipt: { submitted_prompt: "v".repeat(18_000) },
    artifactPlan: { description: "a".repeat(12_000) },
    stage: "failed",
  };
  database.sqlite.prepare("INSERT INTO document_jobs(job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,request_json,result_json,error_message,requested_at,completed_at,notified_at,expires_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run("retained-video-job", owner, `creative:${owner}`, "doc-atmosphere", "render_document", "failed", "studio", "retained-video-job", 1, JSON.stringify({ documentRevision: "revision-one", requestKey: "render-video", artifactKind: "video", snapshot: { private: "s".repeat(16_000) } }), JSON.stringify(result), "failed", now, now, now, expires, now);
  database.reset();

  const summaryResponse = await request("/api/document-jobs?document=doc-atmosphere");
  const summaryText = await summaryResponse.text();
  const summary = JSON.parse(summaryText).jobs.find((job) => job.jobId === "retained-video-job");
  assert.equal(summary.result.artifactKind, "video");
  assert.equal(summary.result.providerJobId, "existing-provider-job");
  assert.equal("plannerInput" in summary.result, false);
  assert.equal("videoInputReceipt" in summary.result, false);
  assert.equal("artifactPlan" in summary.result, false);
  assert.ok(summaryText.length < 2_000, `summarized polling response unexpectedly used ${summaryText.length} bytes`);
  assert.match(database.calls.find((call) => call.kind === "all")?.sql ?? "", /json_remove\(result_json/);
  assert.equal(database.writeCount(), 0);

  database.reset();
  const detailResponse = await request("/api/document-jobs/retained-video-job");
  const detail = (await detailResponse.json()).job;
  assert.deepEqual(detail.result.plannerInput, result.plannerInput);
  assert.deepEqual(detail.result.videoInputReceipt, result.videoInputReceipt);
  assert.deepEqual(detail.result.artifactPlan, result.artifactPlan);
  assert.equal(database.writeCount(), 0);

  const unrelated = await (await request("/api/document-jobs?document=different-document")).json();
  assert.equal(unrelated.jobs.some((job) => job.jobId === "retained-video-job"), false);
});

test("recovering a stale summarized job never destroys its retained provider inputs", async () => {
  const { database, request } = await productionWorker();
  const owner = "dev-local-creative";
  const stale = new Date(Date.now() - 120_000).toISOString();
  const expires = new Date(Date.now() + 86_400_000).toISOString();
  const checkpoint = {
    artifactKind: "video",
    providerJobId: "paid-provider-job",
    plannerInput: { instructions: "retained planner input" },
    videoInputReceipt: { submitted_prompt: "retained provider prompt" },
    artifactPlan: { title: "retained artifact plan" },
  };
  database.sqlite.prepare("INSERT INTO document_jobs(job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,request_json,result_json,error_message,attempt_count,requested_at,started_at,lease_expires_at,notified_at,expires_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run("stale-video-job", owner, `creative:${owner}`, "doc-atmosphere", "render_document", "running", "studio", "stale-video-job", 1, JSON.stringify({ documentRevision: "revision-one", requestKey: "render-video", artifactKind: "video", snapshot: { private: "retained snapshot" } }), JSON.stringify(checkpoint), null, 8, stale, stale, stale, null, expires, stale);

  const response = await request("/api/document-jobs");
  assert.equal(response.status, 200);
  const stored = database.sqlite.prepare("SELECT status,result_json,request_json FROM document_jobs WHERE job_id=?").get("stale-video-job");
  assert.equal(stored.status, "failed");
  const result = JSON.parse(stored.result_json);
  assert.deepEqual(result.plannerInput, checkpoint.plannerInput);
  assert.deepEqual(result.videoInputReceipt, checkpoint.videoInputReceipt);
  assert.deepEqual(result.artifactPlan, checkpoint.artifactPlan);
  assert.equal(JSON.parse(stored.request_json).snapshot.private, "retained snapshot");
});

test("expired completed jobs never disclose retained private inputs on read", async () => {
  const { database, request } = await productionWorker();
  const owner = "dev-local-creative";
  const past = new Date(Date.now() - 60_000).toISOString();
  database.sqlite.prepare("INSERT INTO document_jobs(job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,request_json,result_json,error_message,requested_at,completed_at,notified_at,expires_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run("expired-private-job", owner, `creative:${owner}`, "doc-atmosphere", "generate", "failed", "studio", "expired-private-job", 1, JSON.stringify({ prompt: "private expired input" }), JSON.stringify({ private: "private expired output" }), "expired", past, past, null, past, past);
  database.reset();

  const list = await request("/api/document-jobs");
  assert.equal(list.status, 200);
  assert.equal((await list.json()).jobs.some((job) => job.jobId === "expired-private-job"), false);
  assert.equal(database.writeCount(), 0);

  database.reset();
  const detail = await request("/api/document-jobs/expired-private-job");
  assert.equal(detail.status, 404);
  assert.deepEqual(await detail.json(), { error: "job_not_found" });
  assert.equal(database.writeCount(), 0);
});

test("fast interaction receipts never replay the complete account history", async () => {
  const { database, request } = await productionWorker();
  const event = { type: "ApplicationViewVisited", payload: { application: "creative", surface: "projects" } };
  const response = await request("/api/events/hot", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "hot", event, events: [event], clientId: "performance-test" }),
  });
  assert.equal(response.status, 200);
  assert.equal(database.calls.filter((call) => /SELECT \* FROM events WHERE stream_id=\? AND sequence>\?/i.test(call.sql)).length, 0);
  assert.ok(database.calls.length <= 4, `expected ≤4 hot-path D1 round trips, received ${database.calls.length}`);
});

test("budget limit changes preserve previously recorded spending", async () => {
  const { database, environment, request } = await productionWorker();
  const owner = "dev-local-creative";
  database.sqlite.prepare("UPDATE budget_counters SET used_tokens=?,reserved_tokens=? WHERE scope='user' AND scope_id=?").run(117, 42, owner);
  environment.FORMA_USER_TOKEN_LIMIT = "750000";
  database.reset();

  const response = await request("/api/session");
  const session = await response.json();
  assert.equal(session.budgets.user.limit, 750000);
  assert.equal(session.budgets.user.used, 117);
  assert.equal(session.budgets.user.reserved, 42);
  assert.ok(database.calls.some((call) => call.kind === "batch"));
});

test("cached generation readiness avoids replaying the entire creative stream", async () => {
  const { database, request } = await productionWorker();
  const owner = "dev-local-creative";
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 60_000).toISOString();
  const cached = {
    preflightId: "ready-1",
    requestKey: "preview:revision-one:document:prose",
    documentId: "doc-atmosphere",
    documentRevision: "revision-one",
    kind: "preview",
    promptTechnique: "prose",
    status: "ready",
    expiresAt: expires,
  };
  database.sqlite.prepare("INSERT INTO generation_preflights(preflight_id,owner_id,stream_id,document_id,request_key,status,result_json,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .run("ready-1", owner, `creative:${owner}`, cached.documentId, `generation-readiness-v1:${cached.requestKey}`, "ready", JSON.stringify(cached), now, expires);
  database.reset();

  const response = await request("/api/generation-readiness", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: cached.kind, documentId: cached.documentId, documentRevision: cached.documentRevision, requestKey: cached.requestKey, promptTechnique: cached.promptTechnique }),
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.readiness.cached, true);
  assert.ok(database.calls.length <= 2, `expected auth + one cached preflight query, received ${database.calls.length}`);
  assert.equal(database.calls.filter((call) => /SELECT \* FROM events WHERE stream_id=\?/i.test(call.sql)).length, 0);
  assert.equal(database.writeCount(), 0);
});
