import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import worker from "../dist/server/index.js";
import { foldEvents } from "../src/model/events.ts";
import { performanceRouteFamily } from "../src/performance.ts";
import { consumeSessionBootstrap } from "../src/state/session-bootstrap.ts";

function measuredDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  const calls = [];
  const writes = (sql) => /^\s*(?:INSERT|UPDATE|DELETE|REPLACE)/i.test(sql);

  class PreparedStatement {
    constructor(sql, values = []) { this.sql = sql; this.values = values; }
    bind(...values) {
      assert.ok(values.length <= 100, `Cloudflare D1 permits at most 100 bound parameters; received ${values.length}`);
      return new PreparedStatement(this.sql, values);
    }
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

function htmlAssets(environment) {
  const html = '<!doctype html><html><head><script type="module" src="/assets/main.js"></script><link rel="stylesheet" href="/assets/main.css"></head><body><forma-shell></forma-shell></body></html>';
  const requests = [];
  environment.ASSETS.fetch = async (request) => {
    requests.push(request);
    return new Response(request.method === "HEAD" ? null : html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=3600",
        "content-length": String(new TextEncoder().encode(html).length),
        etag: '"public-shell"',
        "last-modified": "Wed, 21 Aug 2026 12:00:00 GMT",
      },
    });
  };
  return { html, requests };
}

function embeddedSession(html) {
  const match = /<script id="forma-session-bootstrap" type="application\/json" data-server-ms="([\d.]+)">([\s\S]*?)<\/script>/.exec(html);
  return match ? { serverMs: Number(match[1]), session: JSON.parse(match[2]), raw: match[2] } : null;
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

function addActivePromptFan(sqlite) {
  const owner = "dev-local-creative";
  const stream = `creative:${owner}`;
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 86_400_000).toISOString();
  const parent = "active-fan";
  const childIds = Array.from({ length: 4 }, (_, index) => `${parent}-${index}`);
  const insert = sqlite.prepare("INSERT INTO document_jobs(job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,request_json,result_json,error_message,requested_at,completed_at,notified_at,expires_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  for (const [index, child] of childIds.entries()) {
    insert.run(child, owner, stream, "doc-atmosphere", "generate", index ? "queued" : "running", "studio", child, 1,
      JSON.stringify({ documentRevision: "revision-one", promptTechnique: "prose", parentJobId: parent }), null, null, now, null, null, expires, now);
  }
  const members = childIds.map((jobId, index) => ({
    jobId, promptTechnique: "prose", status: index ? "queued" : "running", error: null, moderationPromptRef: null, attemptCount: 0, updatedAt: now,
  }));
  const result = { stage: "running", progressMessage: "0 of 4 prompt approaches finished.", members, completedCount: 0, failedCount: 0, canceledCount: 0, totalCount: 4 };
  insert.run(parent, owner, stream, "doc-atmosphere", "prompt_fan", "running", "studio", parent, 1,
    JSON.stringify({ documentRevision: "revision-one", fanKind: "generate", childJobIds: childIds }), JSON.stringify(result), null, now, null, null, expires, now);
  return { parent, childIds };
}

function addBindingFailureJob(sqlite, { jobId = "binding-failure", correlationId = jobId } = {}) {
  const owner = "dev-local-creative";
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 86_400_000).toISOString();
  sqlite.prepare("INSERT INTO document_jobs(job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,request_json,result_json,error_message,requested_at,completed_at,notified_at,expires_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(jobId, owner, `creative:${owner}`, "doc-atmosphere", "render_document", "failed", "studio", correlationId, 1,
      JSON.stringify({ documentRevision: "revision-one", artifactKind: "slides", snapshot: { retained: "private recovery input" } }),
      JSON.stringify({ artifactKind: "slides", plannerInput: { retained: "private planner checkpoint" } }),
      "Wrong number of parameter bindings", now, now, now, expires, now);
  return { owner, stream: `creative:${owner}`, jobId, correlationId, now };
}

function addCorrelatedTerminal(sqlite, stream, correlationId, now = new Date().toISOString()) {
  const head = Number(sqlite.prepare("SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?").get(stream).head);
  sqlite.prepare("INSERT INTO events(event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,causation_id,compensates_event_id,schema_version,type,payload) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(crypto.randomUUID(), stream, head + 1, now, now, "worker:document", "performance-test", correlationId, null, null, 1,
      "DocumentRenderCompleted", JSON.stringify({ document_id: "doc-atmosphere", artifact_id: "artifact-1" }));
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

test("private app HTML streams a fresh authenticated session before the application shell", async () => {
  const { database, environment, request } = await productionWorker();
  const assets = htmlAssets(environment);
  const response = await request("/projects", { headers: { "if-none-match": '"public-shell"' } });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.match(response.headers.get("vary") ?? "", /Cookie/i);
  assert.match(response.headers.get("vary") ?? "", /oai-authenticated-user-id/i);
  assert.equal(response.headers.has("etag"), false);
  assert.equal(response.headers.has("content-length"), false);
  assert.equal(response.headers.has("last-modified"), false);
  assert.equal(response.headers.get("x-forma-route-family"), "/projects");
  assert.equal(assets.requests[0].headers.has("if-none-match"), false);

  const reader = response.body.getReader();
  const prefix = new TextDecoder().decode((await reader.read()).value);
  assert.match(prefix, /<script type="module" src="\/assets\/main\.js">/);
  assert.match(prefix, /<link rel="stylesheet"/);
  assert.match(prefix, /<body>$/);
  assert.doesNotMatch(prefix, /forma-shell|forma-session-bootstrap/);

  let suffix = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    suffix += new TextDecoder().decode(chunk.value);
  }
  const bootstrap = embeddedSession(suffix);
  assert.ok(bootstrap);
  assert.equal(bootstrap.session.user.userId, "dev-local-creative");
  assert.equal(bootstrap.session.policy.accepted, true);
  assert.equal(bootstrap.session.impersonation, null);
  assert.ok(Number.isFinite(bootstrap.serverMs));
  assert.ok(suffix.indexOf("forma-session-bootstrap") < suffix.indexOf("<forma-shell>"));
  assert.equal(database.calls.length, 3, `expected one authenticated navigation with 3 D1 reads; got ${database.calls.length}`);
  assert.equal(database.writeCount(), 0);
});

test("streamed impersonation preserves fictional identity, actor billing, and cache isolation", async () => {
  const { database, environment, request } = await productionWorker();
  htmlAssets(environment);
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 3_600_000).toISOString();
  database.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
    .run("fictional-user", "fictional@example.com", "Fictional creative", "creator", "pilot-2026-08-10", now, now, now);
  database.sqlite.prepare("INSERT INTO replay_personas(persona_id,session_id,owner_id,fictional_user_id,fictional_stream_id,display_name,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .run("persona-1", "replay-1", "dev-local-creative", "fictional-user", "creative:fictional-user", "Fictional creative", "ready", now, now);
  database.sqlite.prepare("INSERT INTO impersonation_sessions(impersonation_id,actor_user_id,persona_id,fictional_user_id,replay_session_id,status,started_at,expires_at) VALUES(?,?,?,?,?,?,?,?)")
    .run("imp-1", "dev-local-creative", "persona-1", "fictional-user", "replay-1", "active", now, expires);
  database.sqlite.prepare("UPDATE budget_counters SET used_tokens=? WHERE scope=? AND scope_id=?")
    .run(314, "user", "dev-local-creative");
  database.reset();

  const response = await request("/projects", { headers: { cookie: "forma_impersonation=imp-1" } });
  const embedded = embeddedSession(await response.text());
  assert.ok(embedded);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(embedded.session.user.userId, "fictional-user");
  assert.equal(embedded.session.user.billingUserId, "dev-local-creative");
  assert.equal(embedded.session.impersonation.active, true);
  assert.equal(embedded.session.impersonation.actor.userId, "dev-local-creative");
  assert.equal(embedded.session.impersonation.fictionalUser.userId, "fictional-user");
  assert.equal(embedded.session.budgets.user.used, 314);
  assert.equal(embedded.session.canvas.access, false);
  assert.equal(database.calls.length, 4);

  const { matchingAccountSnapshot } = await import("../src/state/account-cache.ts");
  const identity = { userId: "fictional-user", policyVersion: embedded.session.policy.version, accepted: true, impersonating: true };
  const snapshot = { key: `fictional-user:${identity.policyVersion}:v1`, userId: identity.userId, policyVersion: identity.policyVersion, profile: "workspace", head: 1, events: [{}], savedAt: Date.now(), schemaVersion: 1 };
  assert.equal(matchingAccountSnapshot([snapshot], identity, "workspace"), null);
});

test("HTML resource discovery starts while server authentication is still pending", async () => {
  const { environment, request } = await productionWorker();
  htmlAssets(environment);
  const prepare = environment.DB.prepare;
  let resume;
  const gate = new Promise((resolve) => { resume = resolve; });
  environment.DB.prepare = (sql) => {
    const statement = prepare.call(environment.DB, sql);
    if (!/SELECT \* FROM users WHERE user_id=\?/i.test(sql)) return statement;
    return {
      bind(...values) {
        const bound = statement.bind(...values);
        return { async first() { await gate; return bound.first(); } };
      },
    };
  };

  const response = await request("/projects");
  const reader = response.body.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  assert.match(first, /\/assets\/main\.js/);
  assert.match(first, /\/assets\/main\.css/);
  assert.doesNotMatch(first, /forma-session-bootstrap|forma-shell/);

  resume();
  let remaining = "";
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    remaining += new TextDecoder().decode(part.value);
  }
  assert.ok(embeddedSession(remaining));
  assert.match(remaining, /<forma-shell>/);
});

test("public sharing, HEAD requests, and unauthenticated HTML never contain another user's session", async () => {
  const { database, environment, request } = await productionWorker();
  htmlAssets(environment);

  for (const [path, options] of [["/share/public-token", undefined], ["/share", undefined], ["/projects", { method: "HEAD" }]]) {
    database.reset();
    const response = await request(path, options);
    assert.equal(response.headers.get("cache-control"), "public, max-age=3600");
    assert.equal(response.headers.get("etag"), '"public-shell"');
    assert.equal(database.calls.length, 0, `${path} must not access account data`);
    assert.doesNotMatch(await response.text(), /forma-session-bootstrap/);
  }

  database.reset();
  const anonymous = await worker.fetch(new Request("https://anonymous.forma.example/projects"), environment, { waitUntil() {} });
  assert.equal(anonymous.headers.get("cache-control"), "public, max-age=3600");
  assert.equal(database.calls.length, 0);
  assert.doesNotMatch(await anonymous.text(), /forma-session-bootstrap/);
});

test("streamed session JSON escapes hostile account names without losing trusted identity", async () => {
  const { environment, request } = await productionWorker();
  htmlAssets(environment);
  const displayName = '</script><script>alert("private-account")</script>&\u2028';
  const response = await request("/projects", {
    headers: {
      "oai-authenticated-user-id": "dev-local-creative",
      "oai-authenticated-user-email": "creative@local.forma",
      "oai-authenticated-user-full-name": encodeURIComponent(displayName),
      "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
    },
  });
  const html = await response.text();
  const bootstrap = embeddedSession(html);

  assert.ok(bootstrap);
  assert.equal(bootstrap.session.user.displayName, displayName);
  assert.match(bootstrap.raw, /\\u003c\/script\\u003e/);
  assert.match(bootstrap.raw, /\\u0026\\u2028/);
  assert.equal((html.match(/<script\b/g) ?? []).length, 2);
});

test("embedded sessions are consumed once and malformed payloads fail closed", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  const session = {
    user: { userId: "private-account" },
    policy: { version: "pilot-2026-08-10", accepted: false },
    provider: { configured: false },
    budgets: { user: {}, workspace: {} },
    impersonation: null,
  };

  try {
    for (const [source, expected] of [
      [JSON.stringify(session), session],
      ["{broken", null],
      [JSON.stringify({ ...session, user: {} }), null],
      [JSON.stringify({ ...session, policy: { version: session.policy.version } }), null],
      [JSON.stringify({ ...session, budgets: { user: {} } }), null],
    ]) {
      let removed = false;
      const node = { textContent: source, dataset: { serverMs: "143.5" }, remove() { removed = true; } };
      const dataset = {};
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: { querySelector: () => removed ? null : node, documentElement: { dataset } },
      });

      assert.deepEqual(consumeSessionBootstrap(), expected);
      assert.equal(removed, true);
      assert.equal(consumeSessionBootstrap(), null);
      assert.equal(dataset.formaSessionServerMs, expected ? "143.5" : undefined);
    }
  } finally {
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else delete globalThis.document;
  }
});

test("failed embedded authentication preserves the original application shell", async () => {
  const { environment, request } = await productionWorker();
  htmlAssets(environment);
  const prepare = environment.DB.prepare;
  environment.DB.prepare = (sql) => {
    const statement = prepare.call(environment.DB, sql);
    if (!/SELECT \* FROM users WHERE user_id=\?/i.test(sql)) return statement;
    return { bind() { return { async first() { throw new Error("temporary database outage"); } }; } };
  };

  const response = await request("/projects");
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.match(html, /<forma-shell><\/forma-shell>/);
  assert.doesNotMatch(html, /forma-session-bootstrap/);
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

test("active prompt fans reconcile ordered children without N+1 reads or redundant list queries", async () => {
  const { database, request } = await productionWorker();
  const { parent, childIds } = addActivePromptFan(database.sqlite);
  database.reset();

  const response = await request("/api/document-jobs?scope=active");
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body.jobs.find((job) => job.jobId === parent).members.map((member) => member.jobId), childIds);
  assert.ok(database.calls.length <= 4, `expected auth, list, parent, and one child query; received ${database.calls.length}`);
  assert.equal(database.calls.filter((call) => /SELECT \* FROM document_jobs WHERE owner_id=\? AND job_id IN/i.test(call.sql)).length, 1);
  assert.equal(database.writeCount(), 0);
});

test("legacy failed-job repair reads only indexed, owner-scoped correlation receipts", async () => {
  const { database, request } = await productionWorker();
  const failure = addBindingFailureJob(database.sqlite);
  addCorrelatedTerminal(database.sqlite, failure.stream, failure.correlationId, failure.now);
  database.reset();

  const response = await request("/api/document-jobs");
  assert.equal(response.status, 200);
  const stored = database.sqlite.prepare("SELECT status,request_json,result_json FROM document_jobs WHERE job_id=?").get(failure.jobId);
  assert.equal(stored.status, "completed");
  assert.equal(JSON.parse(stored.request_json).snapshot.retained, "private recovery input");
  assert.equal(JSON.parse(stored.result_json).plannerInput.retained, "private planner checkpoint");
  assert.ok(database.calls.some((call) => /INDEXED BY idx_events_correlation/i.test(call.sql)));
  assert.equal(database.calls.filter((call) => /SELECT \* FROM events WHERE stream_id=\? AND sequence>\?/i.test(call.sql)).length, 0);
});

test("failed-job recovery never trusts another account's matching correlation", async () => {
  const { database, request } = await productionWorker();
  const failure = addBindingFailureJob(database.sqlite, { correlationId: "cross-account-correlation" });
  addCorrelatedTerminal(database.sqlite, "creative:another-account", failure.correlationId, failure.now);
  database.reset();

  const response = await request("/api/document-jobs");
  assert.equal(response.status, 200);
  assert.equal(database.sqlite.prepare("SELECT status FROM document_jobs WHERE job_id=?").get(failure.jobId).status, "failed");
  assert.ok(database.calls.length <= 3, `expected auth, visible jobs, and indexed receipts only; received ${database.calls.length}`);
  assert.equal(database.writeCount(), 0);
});

test("job acknowledgments skip unrelated global budget and retention maintenance", async () => {
  const { database, request } = await productionWorker();
  addTerminalPromptFans(database.sqlite, 1);
  database.reset();

  const response = await request("/api/document-jobs/fan-0/ack", { method: "POST" });
  assert.equal(response.status, 200);
  assert.equal(database.calls.some((call) => /FROM events reserved/i.test(call.sql)), false);
  assert.equal(database.calls.some((call) => /UPDATE document_jobs SET request_json='\{\}'/i.test(call.sql)), false);
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

test("large Canvas offline batches respect D1's 100-parameter limit and remain idempotent", async () => {
  const { database, request } = await productionWorker();
  for (const size of [99, 100, 120]) {
    const events = Array.from({ length: size }, (_, index) => ({
      type: "CanvasRegisterSet",
      payload: {
        canvas_id: "canvas-1", item_id: "item-1", client_event_id: `canvas-${size}-${index}`,
        operation: { object: { item_id: "item-1" }, prop: "x", value: index, hlc: { pt: index + 1, c: 0, site: "web:test" } },
      },
    }));
    const body = JSON.stringify({ action: "canvas_sync", events, clientId: "performance-test" });
    database.reset();

    const response = await request("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body });
    const first = await response.json();
    assert.equal(response.status, 200, `${size} Canvas changes failed: ${JSON.stringify(first)}`);
    assert.equal(first.appended.length, size);
    if (size > 99) {
      assert.ok(database.calls.some((call) => call.kind === "batch" && call.statements.length === 2 &&
        call.statements.every((statement) => /FROM event_client_receipts/i.test(statement.sql))));
    }

    const retry = await request("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body });
    const second = await retry.json();
    assert.equal(retry.status, 200);
    assert.deepEqual(second.appended.map((event) => event.eventId), first.appended.map((event) => event.eventId));
  }
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

test("uncached generation readiness folds only the complete workspace projection", async () => {
  const { database, request } = await productionWorker();
  const response = await request("/api/generation-readiness", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "preview", documentId: "doc-atmosphere", documentRevision: "uncached-revision",
      requestKey: "preview:uncached-revision:document:prose", promptTechnique: "prose",
    }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.readiness.status, "blocked");
  assert.equal(body.readiness.cached, false);
  for (const probe of ["application-budget", "provider-health", "image-format", "context-size", "reference-availability"]) {
    assert.ok(body.readiness.probes.some((candidate) => candidate.id === probe), `missing safety probe ${probe}`);
  }
  const queries = database.calls.flatMap((call) => call.kind === "batch" ? call.statements.map((statement) => statement.sql) : [call.sql]);
  assert.ok(queries.some((sql) => /FROM events.*type NOT IN/i.test(sql)), "readiness did not load the bounded workspace projection");
  assert.equal(queries.some((sql) => /SELECT \* FROM events WHERE stream_id=\? AND sequence>\? ORDER BY sequence ASC LIMIT \?/i.test(sql)), false);
});

test("workspace projection preserves complete document state while excluding account telemetry", async () => {
  const { request } = await productionWorker();
  const full = await (await request("/api/events?after=0&limit=2000&content=0")).json();
  const workspace = await (await request("/api/events?after=0&limit=5000&content=0&profile=workspace")).json();
  assert.deepEqual(foldEvents(workspace.events, Number.POSITIVE_INFINITY, "doc-atmosphere"),
    foldEvents(full.events, Number.POSITIVE_INFINITY, "doc-atmosphere"));
});

test("blocked document generation reuses one workspace projection for its forced safety preflight", async () => {
  const { database, environment, request } = await productionWorker();
  environment.OPENAI_API_KEY = "test-only";
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 3_600_000).toISOString();
  database.sqlite.prepare("INSERT INTO provider_health(scope_key,status,scope,message,observed_at,expires_at,retry_after_ms,request_id) VALUES(?,?,?,?,?,?,?,?)")
    .run("openai:default:gpt-image-2", "credits_blocked", "account", "Blocked for regression", now, expires, null, null);
  database.reset();

  const response = await request("/api/document-jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "preview", documentId: "doc-atmosphere", sourceSurface: "performance-test",
      payload: {
        documentRevision: "revision-one", requestKey: "preview:revision-one:document:prose",
        promptTechnique: "prose", snapshot: { facts: [], relationships: [], pins: [], tail: [] },
      },
    }),
  });
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.error, "generation_preflight_blocked");
  assert.equal(body.readiness.status, "blocked");
  assert.equal(body.readiness.probes.find((probe) => probe.id === "provider-health")?.status, "fail");
  assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM document_jobs").get().count, 0);
  assert.deepEqual(database.sqlite.prepare("SELECT type FROM events WHERE json_extract(payload,'$.preflight_id')=? ORDER BY sequence")
    .all(body.readiness.preflightId).map((event) => event.type), [
      "GenerationPreflightRequested", "GenerationPreflightCompleted", "GenerationBlockedBeforeProvider",
    ]);

  const statements = database.calls.flatMap((call) => call.kind === "batch" ? call.statements.map((statement) => statement.sql) : [call.sql]);
  assert.equal(statements.filter((sql) => /FROM events[\s\S]*type\s+NOT\s+IN/i.test(sql)).length, 1);
  assert.equal(statements.some((sql) => /SELECT \* FROM events WHERE stream_id=\? AND sequence>\? ORDER BY sequence ASC LIMIT \?/i.test(sql)), false);
});

test("an unchecked paid request still requires an exact acknowledged safety review", async () => {
  const { database, environment, request } = await productionWorker();
  environment.OPENAI_API_KEY = "test-only";
  const previousFetch = globalThis.fetch;
  let moderationCalls = 0;
  globalThis.fetch = async (input) => {
    assert.equal(String(input), "https://api.openai.com/v1/moderations");
    moderationCalls += 1;
    return Response.json({ model: "omni-moderation-latest", results: [{ flagged: true, categories: { violence: true } }] });
  };

  try {
    const start = async (acknowledged) => request("/api/document-jobs", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "preview", documentId: "doc-atmosphere", sourceSurface: "performance-test",
        payload: {
          documentRevision: "review-revision", requestKey: "preview:review-revision", promptTechnique: "prose",
          snapshot: { facts: [], relationships: [], pins: [], tail: [] }, preflightAcknowledged: acknowledged,
        },
      }),
    });

    const blocked = await start(false);
    const review = await blocked.json();
    assert.equal(blocked.status, 428);
    assert.equal(review.error, "generation_preflight_review_required");
    assert.equal(review.readiness.status, "review");
    assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM document_jobs").get().count, 0);

    const approved = await start(true);
    assert.equal(approved.status, 202);
    assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM document_jobs").get().count, 1);
    assert.equal(moderationCalls, 1, "the unchanged document must reuse its advisory moderation result");
    assert.ok(database.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type='GenerationRiskAcknowledged'").get().count);
  } finally {
    globalThis.fetch = previousFetch;
  }
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
