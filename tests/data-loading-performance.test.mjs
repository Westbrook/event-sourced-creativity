import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { runInNewContext } from "node:vm";
import worker from "../dist/server/index.js";
import { foldEvents } from "../src/model/events.ts";
import { routePathname } from "../src/model/routes.ts";
import { EVENT_PROFILE_ORDER, SCOPED_EVENT_PROFILES, eventMatchesProfile, eventProfileRank } from "../src/model/event-profiles.ts";
import { buildComprehensiveScenario, SCENARIO_EVENT_TYPES } from "../src/model/scenarios.ts";
import { tasteMetrics } from "../src/model/taste.ts";
import { attentionMetrics } from "../src/model/attention.ts";
import { documentViewWorkflow } from "../src/model/document-view-signals.ts";
import { buildScoutEnvelope, buildScoutTrajectory, scoutPrecisionLedger } from "../src/model/scout.ts";
import { briefEligibility, phase6GateMetrics, sessionContinuityDelta } from "../src/model/brief.ts";
import { unfinishedIntentTrajectories } from "../src/model/intent-trajectories.ts";
import { performanceRouteFamily, performanceRouteSurface } from "../src/performance.ts";
import { matchingAccountSnapshot, matchingAnalyticsSnapshot } from "../src/state/account-cache.ts";
import { routeCapabilities } from "../src/state/route-capabilities.ts";
import { consumeRoutePrefetch, consumeSessionBootstrap, consumeSessionPrefetch } from "../src/state/session-bootstrap.ts";

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
  const background = [];
  const context = { waitUntil(promise) { background.push(promise); } };
  const drainBackground = async () => { while (background.length) await Promise.all(background.splice(0)); };
  const request = (path, init) => worker.fetch(new Request(`http://localhost${path}`, init), environment, context);

  // Warm the isolate schema, authenticated account, budget rows, and seed.
  assert.equal((await request("/api/session")).status, 200);
  database.sqlite.prepare("UPDATE users SET consent_version=?").run("pilot-2026-08-10");
  assert.equal((await request("/api/events?after=0&limit=2000&content=0")).status, 200);
  database.reset();
  return { database, environment, request, context, drainBackground };
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

test("paid storyboard and video work requires strict explicit consent at both server boundaries without side effects",async()=>{
  const {database,environment,request}=await productionWorker();environment.OPENAI_API_KEY="test-only";environment.FAL_KEY="test-only";
  for(const artifactKind of ["storyboard","video"])for(const paidMediaConfirmed of [undefined,false,"true"]){
    for(const [path,body] of [["/api/document-jobs",{kind:"render_document",documentId:"doc-atmosphere",payload:{artifactKind,...(paidMediaConfirmed===undefined?{}:{paidMediaConfirmed})}}],["/api/events",{action:"render_document",documentId:"doc-atmosphere",artifactKind,...(paidMediaConfirmed===undefined?{}:{paidMediaConfirmed})}]]){
      database.reset();const response=await request(path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});assert.equal(response.status,428,`${artifactKind}:${path}:${String(paidMediaConfirmed)}`);assert.equal((await response.json()).error,"paid_media_confirmation_required");assert.equal(database.writeCount(),0,`${artifactKind}:${path} must not reserve budget or create provider work`);
    }
  }
  assert.equal(Number(database.sqlite.prepare("SELECT COUNT(*) AS count FROM document_jobs WHERE kind='render_document'").get().count),0);
});

test("performance isolates operational, laboratory, document, and public entry points", () => {
  const cases = {
    "/operations": "operations-system", "/system": "operations-system", "/operations/analytics": "operations-analytics",
    "/operations/canvas": "operations-canvas-governance", "/operations/events": "operations-event-stream",
    "/operations/events/stream": "operations-event-stream", "/admin/events": "operations-event-stream",
    "/operations/events/permissions": "operations-permissions", "/admin/events/permissions": "operations-permissions",
    "/operations/events/sync": "operations-canvas-sync", "/admin/events/sync": "operations-canvas-sync",
    "/laboratory": "laboratory-replay", "/laboratory/replay": "laboratory-replay", "/admin/events/replay": "laboratory-replay",
    "/laboratory/image-adapters": "laboratory-image-adapters", "/laboratory/focal-points": "laboratory-focal-points",
    "/system/focal-points": "laboratory-focal-points", "/laboratory/design-system": "laboratory-design-system",
    "/document/document-1/title/view/chat": "document-chat", "/document/document-1/title": "document-workspace",
    "/share": "shared-document", "/share/secret-token": "shared-document",
  };
  for (const [path, surface] of Object.entries(cases)) assert.equal(performanceRouteSurface(`${path}?safe=1#view`), surface, path);
  for (const view of ["board", "guided", "layers", "adaptive", "editor", "chat"]) assert.equal(performanceRouteSurface(`/studio/${view}`), `studio-${view}`);
  for (const path of ["/creative", "/operations/analytics", "/operations/canvas", "/operations/events/sync", "/laboratory", "/laboratory/image-adapters", "/laboratory/focal-points", "/laboratory/design-system"]) {
    assert.equal(routePathname(`${path}/?safe=1`), path);
    assert.equal(performanceRouteFamily(`${path}/`), performanceRouteFamily(path));
    assert.equal(performanceRouteSurface(`${path}/`), performanceRouteSurface(path));
    assert.deepEqual(routeCapabilities(`${path}/`), routeCapabilities(path));
  }
});

test("six nested route profiles retain every surface's actual evidence", () => {
  assert.deepEqual(EVENT_PROFILE_ORDER, ["projects", "workspace", "memory", "scout", "sessions", "full"]);
  assert.deepEqual(SCOPED_EVENT_PROFILES, ["projects", "workspace", "memory", "scout", "sessions"]);
  for (const [rank, profile] of EVENT_PROFILE_ORDER.entries()) assert.equal(eventProfileRank(profile), rank);
  for (const type of SCENARIO_EVENT_TYPES) for (let index = 1; index < EVENT_PROFILE_ORDER.length; index += 1) {
    assert.ok(!eventMatchesProfile(EVENT_PROFILE_ORDER[index - 1], type) || eventMatchesProfile(EVENT_PROFILE_ORDER[index], type), `${type} ceases to be nested at ${EVENT_PROFILE_ORDER[index]}`);
  }
  const full = buildComprehensiveScenario();
  const select = (profile) => full.filter((event) => eventMatchesProfile(profile, event.type));
  assert.deepEqual(foldEvents(select("workspace")), foldEvents(full));
  for (const model of [tasteMetrics, attentionMetrics, documentViewWorkflow]) assert.deepEqual(model(select("memory")), model(full), `memory ${model.name}`);
  for (const model of [buildScoutTrajectory, scoutPrecisionLedger, documentViewWorkflow]) assert.deepEqual(model(select("scout")), model(full), `scout ${model.name}`);
  assert.deepEqual(buildScoutEnvelope(select("scout"), 500_000, 3), buildScoutEnvelope(full, 500_000, 3));
  for (const model of [briefEligibility, phase6GateMetrics, sessionContinuityDelta, unfinishedIntentTrajectories]) assert.deepEqual(model(select("sessions")), model(full), `sessions ${model.name}`);
  assert.ok(eventMatchesProfile("sessions", "ValidationFailed"));
  assert.ok(eventMatchesProfile("sessions", "GenerationPreflightCompleted"));
  assert.ok(eventMatchesProfile("scout", "CanvasInteractionRecorded"));
  for (const profile of ["memory", "scout", "sessions"]) assert.ok(eventMatchesProfile(profile, "AttentionSignalsForgotten"));
});

test("nested snapshots downscope without crossing account, consent, policy, or impersonation", () => {
  const identity = { userId: "owner-a", policyVersion: "policy-2", accepted: true, impersonating: false };
  const types = ["ProjectCreated", "DocumentViewVisited", "AttentionEpisodeObserved", "AttentionSignalsForgotten", "CanvasInteractionRecorded", "ObjectViewed", "ComparisonOpened", "GenerationPreflightCompleted", "ValidationFailed", "ApplicationViewVisited", "GenerationPreflightRequested"];
  const snapshot = { key: "owner-a:policy-2:v2", userId: "owner-a", policyVersion: "policy-2", profile: "full", head: types.length, events: types.map((type, index) => ({ type, sequence: index + 1 })), savedAt: Date.now(), schemaVersion: 2 };
  for (const requested of EVENT_PROFILE_ORDER) {
    const found = matchingAccountSnapshot([snapshot], identity, requested);
    assert.equal(found?.profile, requested);
    assert.equal(found?.head, snapshot.head);
    assert.deepEqual(found?.events.map((event) => event.type), types.filter((type) => eventMatchesProfile(requested, type)));
  }
  assert.equal(matchingAccountSnapshot([{ ...snapshot, profile: "workspace" }], identity, "memory"), null);
  assert.equal(matchingAccountSnapshot([snapshot], { ...identity, userId: "owner-b" }, "projects"), null);
  assert.equal(matchingAccountSnapshot([snapshot], { ...identity, policyVersion: "policy-3" }, "projects"), null);
  assert.equal(matchingAccountSnapshot([{ ...snapshot, userId: "owner-b" }], identity, "projects"), null);
  assert.equal(matchingAccountSnapshot([snapshot], { ...identity, accepted: false }, "projects"), null);
  assert.equal(matchingAccountSnapshot([snapshot], { ...identity, impersonating: true }, "projects"), null);
  assert.equal(matchingAccountSnapshot([{ ...snapshot, key: "owner-a:policy-2:v1", schemaVersion: 1 }], identity, "projects"), null);
});

test("same-profile and downscoped snapshots remove timer artifacts without changing raw audit history or stream head",()=>{
  const identity={userId:"owner-a",policyVersion:"policy-2",accepted:true,impersonating:false};
  const phantom={surface:"studio",context:"studio-overview",terminal_type:"idle_timeout",terminal_ref:null,active_ms:30_000,idle_ms:30_000,visible_refs:[],outcome_weight:.013,friction_score:0,capture_version:"attention-v2"};
  const events=[{type:"ProjectCreated",sequence:1,payload:{}},{type:"AttentionEpisodeObserved",sequence:2,payload:phantom},{type:"AttentionEpisodeObserved",sequence:3,payload:{...phantom,visible_refs:["block:real"]}},{type:"AttentionSignalsForgotten",sequence:4,payload:{}}];
  const snapshot={key:"owner-a:policy-2:v2",userId:"owner-a",policyVersion:"policy-2",profile:"full",head:40,events,savedAt:Date.now(),schemaVersion:2};
  for(const profile of ["memory","scout","sessions"]){
    const downscoped=matchingAccountSnapshot([snapshot],identity,profile);
    assert.equal(downscoped?.head,40);assert.deepEqual(downscoped?.events.map((item)=>item.sequence),[1,3,4]);
    const exact=matchingAccountSnapshot([{...snapshot,profile}],identity,profile);
    assert.equal(exact?.head,40);assert.deepEqual(exact?.events.map((item)=>item.sequence),[1,3,4]);
  }
  assert.deepEqual(matchingAccountSnapshot([snapshot],identity,"full")?.events.map((item)=>item.sequence),[1,2,3,4]);
});

test("each route requests only its own evidence, private content, and historical jobs", () => {
  const expected = {
    "/projects": ["projects", false, false], "/memory": ["memory", true, false], "/scout": ["scout", false, false],
    "/sessions": ["sessions", false, false], "/operations/events": ["projects", false, false],
    "/operations/events/stream": ["projects", false, false], "/operations": ["sessions", false, false],
    "/operations/events/sync": ["sessions", false, false], "/operations/analytics": ["projects", false, false],
    "/operations/canvas": ["projects", false, false], "/operations/events/permissions": ["projects", false, false],
    "/laboratory/replay": ["projects", false, false], "/laboratory/image-adapters": ["projects", false, false],
    "/laboratory/focal-points": ["workspace", false, false], "/laboratory/design-system": ["workspace", false, false],
    "/studio/project": ["workspace", false, false], "/document/document-1": ["workspace", true, true],
    "/canvas/canvas-1": ["workspace", true, true], "/library": ["workspace", true, true], "/share/token": ["projects", false, false],
  };
  for (const [path, [profile, privateContent, jobHistory]] of Object.entries(expected)) assert.deepEqual(routeCapabilities(`${path}?safe=1#section`), { profile, privateContent, jobHistory }, path);
  assert.deepEqual(routeCapabilities("/admin/events/replay"), routeCapabilities("/laboratory/replay"));
  assert.deepEqual(routeCapabilities("/admin/events/permissions"), routeCapabilities("/operations/events/permissions"));
});

test("cached Analytics is short-lived, account-exact, and never bypasses current administrator consent", () => {
  const now = Date.now();
  const url = "/api/analytics?days=30&includeSynthetic=false";
  const identity = { userId: "owner-a", policyVersion: "policy-2", accepted: true, impersonating: false, role: "admin" };
  const report = { generatedAt: new Date(now - 500).toISOString(), source: { eventCount: 9 }, totals: { events: 9 } };
  const snapshot = { key: `owner-a:policy-2:analytics:${encodeURIComponent(url)}:v1`, userId: "owner-a", policyVersion: "policy-2", role: "admin", url, report, savedAt: now - 1_000, schemaVersion: 1 };
  assert.equal(matchingAnalyticsSnapshot(snapshot, identity, url, now), snapshot);
  for (const invalid of [
    [{ ...identity, userId: "owner-b" }, url, snapshot],
    [{ ...identity, policyVersion: "policy-3" }, url, snapshot],
    [{ ...identity, role: "creator" }, url, snapshot],
    [{ ...identity, accepted: false }, url, snapshot],
    [{ ...identity, impersonating: true }, url, snapshot],
    [identity, "/api/analytics?days=7&includeSynthetic=false", snapshot],
    [identity, "/api/analytics?days=30&includeSynthetic=true", snapshot],
    [identity, url, { ...snapshot, savedAt: now - 60_001 }],
    [identity, url, { ...snapshot, savedAt: now + 1 }],
    [identity, url, { ...snapshot, role: "creator" }],
    [identity, url, { ...snapshot, report: { ...report, generatedAt: "invalid" } }],
    [identity, url, { ...snapshot, schemaVersion: 2 }],
  ]) assert.equal(matchingAnalyticsSnapshot(invalid[2], invalid[0], invalid[1], now), null);
});

test("static HTML starts one authenticated session immediately without touching public shares", async () => {
  const html = await readFile(new URL("../dist/client/projects/index.html", import.meta.url), "utf8");
  const match = /<script id="forma-static-session-prefetch">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(match);
  assert.ok(match.index < html.indexOf('<script type="module"'));

  for (const [pathname, expected] of [["/projects", 1], ["/document/private-document", 1], ["/share", 0], ["/share/public-token", 0]]) {
    const calls = [];
    const pending = Promise.resolve(new Response("{}"));
    const context = {
      location: { pathname },
      document: { documentElement: { dataset: {} } },
      performance: { now: () => 18.46 },
      window: {},
      fetch(path) { calls.push(path); return pending; },
    };
    runInNewContext(match[1], context);
    assert.equal(calls.length, expected);
    if (expected) {
      assert.equal(calls[0], "/api/session");
      assert.equal(context.window.__formaInitialSession, pending);
      assert.equal(context.document.documentElement.dataset.formaSessionPrefetchStartedMs, "18.5");
    } else {
      assert.equal(context.window.__formaInitialSession, undefined);
    }
  }

  const share = await readFile(new URL("../dist/client/share/index.html", import.meta.url), "utf8");
  assert.doesNotMatch(share, /forma-static-session-prefetch/);
});

test("administrative entries prefetch only their own read-only endpoint after verified authorization", async () => {
  const entries = new Map([
    ["/operations/analytics", "/api/analytics?days=30&includeSynthetic=false"],
    ["/operations/canvas", "/api/canvas-governance"],
    ["/operations/events", "/api/events?audit=1&limit=150"],
    ["/operations/events/stream", "/api/events?audit=1&limit=150"],
    ["/admin/events", "/api/events?audit=1&limit=150"],
    ["/admin/events/stream", "/api/events?audit=1&limit=150"],
    ["/laboratory/image-adapters", "/api/image-adapters"],
  ]);

  for (const [pathname, endpoint] of entries) {
    const html = await readFile(new URL(`../dist/client${pathname}/index.html`, import.meta.url), "utf8");
    const match = /<script id="forma-static-route-prefetch">([\s\S]*?)<\/script>/.exec(html);
    assert.ok(match, pathname);
    assert.ok(match.index < html.indexOf('<script type="module"'), pathname);

    for (const [role, impersonation, expected] of [["admin", null, 1], ["creator", null, 0], ["admin", { personaId: "other" }, 0]]) {
      const calls = [];
      const response = new Response("{}", { status: 200 });
      const context = {
        location: { pathname },
        document: { documentElement: { dataset: {} } },
        performance: { now: () => 26.34 },
        window: { __formaInitialSession: Promise.resolve(Response.json({ user: { role }, impersonation })) },
        fetch(url) { calls.push(url); return Promise.resolve(response); },
      };
      runInNewContext(match[1], context);
      const prefetched = await context.window.__formaInitialRouteData.pending;
      assert.equal(calls.length, expected, `${pathname} ${role} impersonating=${Boolean(impersonation)}`);
      assert.equal(prefetched, expected ? response : null);
      if (expected) {
        assert.deepEqual(calls, [endpoint]);
        assert.equal(context.document.documentElement.dataset.formaRoutePrefetchStartedMs, "26.3");
      }
    }
  }

  for (const pathname of ["/projects", "/share", "/laboratory", "/laboratory/replay", "/admin/events/replay"]) {
    const html = await readFile(new URL(`../dist/client${pathname}/index.html`, import.meta.url), "utf8");
    assert.doesNotMatch(html, /forma-static-route-prefetch/, pathname);
  }
  const root = await readFile(new URL("../dist/client/index.html", import.meta.url), "utf8");
  assert.doesNotMatch(root, /forma-static-route-prefetch/);
});

test("early route data is authorized, route-exact, and consumed once without stale reuse", async () => {
  const previous = Object.fromEntries(["location", "document", "__formaInitialRouteData"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const dataset = {};
  const response = new Response("{}");
  try {
    Object.defineProperty(globalThis, "location", { configurable: true, writable: true, value: { pathname: "/operations/analytics/" } });
    Object.defineProperty(globalThis, "document", { configurable: true, writable: true, value: { documentElement: { dataset } } });
    const put = (path = "/operations/analytics", url = "/api/analytics?days=30&includeSynthetic=false", pending = Promise.resolve(response)) => {
      Object.defineProperty(globalThis, "__formaInitialRouteData", { configurable: true, writable: true, value: { path, url, pending } });
    };

    dataset.formaRoutePrefetchStartedMs = String(Math.max(0.1, performance.now() - 15));
    put();
    const first = consumeRoutePrefetch("/api/analytics?days=30&includeSynthetic=false");
    assert.ok(first);
    assert.equal(consumeRoutePrefetch("/api/analytics?days=30&includeSynthetic=false"), null);
    assert.equal(await first, response);
    assert.equal(dataset.formaRouteDataSource, "prefetch");
    assert.equal(dataset.formaRoutePrefetchPath, "/api/analytics?days=30&includeSynthetic=false");
    assert.ok(Number(dataset.formaRoutePrefetchHeadStartMs) > 0);

    put();
    assert.equal(consumeRoutePrefetch("/api/analytics?days=7&includeSynthetic=false"), null);
    assert.equal(globalThis.__formaInitialRouteData, undefined);
    assert.equal(consumeRoutePrefetch("/api/analytics?days=30&includeSynthetic=false"), null);

    put("/operations/events");
    assert.equal(consumeRoutePrefetch("/api/analytics?days=30&includeSynthetic=false"), null);
    assert.equal(globalThis.__formaInitialRouteData, undefined);

    put();
    assert.equal(consumeRoutePrefetch("/api/analytics?days=30&includeSynthetic=false", { impersonating: true }), null);
    assert.equal(globalThis.__formaInitialRouteData, undefined);

    put("/operations/analytics", "/api/analytics?days=30&includeSynthetic=false", Promise.resolve(null));
    assert.equal(await consumeRoutePrefetch("/api/analytics?days=30&includeSynthetic=false"), null);

    put("/operations/analytics", "/api/analytics?days=30&includeSynthetic=false", {});
    assert.equal(consumeRoutePrefetch("/api/analytics?days=30&includeSynthetic=false"), null);
  } finally {
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});

test("background visits and unrelated job polling begin after meaningful route population", async () => {
  const shell = await readFile(new URL("../src/components/forma-shell.ts", import.meta.url), "utf8");
  const store = await readFile(new URL("../src/state/store.ts", import.meta.url), "utf8");
  const analytics = await readFile(new URL("../src/components/forma-analytics.ts", import.meta.url), "utf8");
  assert.match(shell, /addEventListener\("forma-performance", this\.#populated\)/);
  assert.match(shell, /removeEventListener\("forma-performance", this\.#populated\)/);
  assert.match(shell, /dataset\.formaPhase !== "populated"/);
  assert.doesNotMatch(shell, /completeRoutePopulation\(this\.store\.route\.get\(\)\);this\.#observeApplicationView/);
  assert.match(store, /#syncVisibleJobs\(path=this\.route\.get\(\)\)/);
  assert.match(store, /routeCapabilities\(path\)\.jobHistory/);
  assert.match(store, /#pendingPassiveJobPath/);
  assert.match(store, /addEventListener\("forma-performance"/);
  assert.match(store, /this\.#scheduleJobPoll\(1_200\)/);
  assert.match(store, /documentViewFromRoute\(path\)==="chat"\)void sessionPromise\.then/);
  assert.match(store, /contentScope=\$\{required\}/);
  assert.match(store, /profile==="memory"\?"memory"/);
  assert.match(store, /this\.content\.set\(\{\.\.\.this\.content\.get\(\),\.\.\.body\.content\}\)/);
  assert.match(analytics, /#expandedEvidence=new Set<string>\(\)/);
  assert.match(analytics, /data-evidence-key=\$\{item\.key\}/);
  assert.match(analytics, /\?open=\$\{expanded\} @toggle=\$\{this\.#toggleEvidence\}/);
  assert.match(analytics, /expanded\?html`<div class="analytics-evidence-list"/);
  assert.match(analytics, /readAnalyticsSnapshot\(identity,url\)/);
  assert.match(analytics, /writeAnalyticsSnapshot\(identity,url,body\.report\)/);
  assert.match(analytics, /Refreshing live data/);
  assert.match(analytics, /\[401,403,428\]\.includes\(response\.status\)/);
  assert.match(store, /await clearAnalyticsSnapshots\(this\.#snapshotIdentity\(session\),true\)/);
});

test("the early authenticated session request can only be adopted once", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "__formaInitialSession");
  try {
    const pending = Promise.resolve(new Response("{}"));
    Object.defineProperty(globalThis, "__formaInitialSession", { configurable: true, writable: true, value: pending });
    assert.equal(consumeSessionPrefetch(), pending);
    assert.equal(consumeSessionPrefetch(), null);

    Object.defineProperty(globalThis, "__formaInitialSession", { configurable: true, writable: true, value: {} });
    assert.equal(consumeSessionPrefetch(), null);
  } finally {
    if (previous) Object.defineProperty(globalThis, "__formaInitialSession", previous);
    else delete globalThis.__formaInitialSession;
  }
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
  assert.equal(assets.requests[0].headers.get("accept-encoding"), "identity");

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
  const snapshot = { key: `fictional-user:${identity.policyVersion}:v2`, userId: identity.userId, policyVersion: identity.policyVersion, profile: "workspace", head: 1, events: [{}], savedAt: Date.now(), schemaVersion: 2 };
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

test("personalized navigation requests uncompressed assets and removes redundant static preloads", async () => {
  const { environment, request } = await productionWorker();
  const assets = htmlAssets(environment);
  const original = environment.ASSETS.fetch;
  environment.ASSETS.fetch = async (assetRequest) => {
    if (assetRequest.headers.get("accept-encoding") !== "identity") {
      return new Response("compressed asset", { headers: { "content-type": "text/html", "content-encoding": "gzip" } });
    }
    const asset = await original(assetRequest);
    const headers = new Headers(asset.headers);
    headers.set("link", "</api/session>; rel=preload; as=fetch; crossorigin");
    return new Response(asset.body, { status: asset.status, headers });
  };

  const response = await request("/projects");
  assert.equal(assets.requests[0].headers.get("accept-encoding"), "identity");
  assert.equal(response.headers.has("link"), false);
  assert.ok(embeddedSession(await response.text()));
});

test("personalized streamed HTML removes early static authentication before the head is sent", async () => {
  const { environment, request } = await productionWorker();
  const script='<script id="forma-static-session-prefetch">fetch("/api/session")</script>';
  environment.ASSETS.fetch = async () => new Response(`<!doctype html><html><head>${script}<script type="module" src="/assets/main.js"></script></head><body><forma-shell></forma-shell></body></html>`, {
    headers: { "content-type": "text/html" },
  });

  const response = await request("/projects");
  const reader = response.body.getReader();
  const prefix = new TextDecoder().decode((await reader.read()).value);
  assert.match(prefix, /\/assets\/main\.js/);
  assert.doesNotMatch(prefix, /forma-static-session-prefetch|fetch\("\/api\/session"\)/);
  let remainder = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    remainder += new TextDecoder().decode(chunk.value);
  }
  assert.ok(embeddedSession(remainder));
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

test("every scoped event profile is nested, owner-scoped, paginated, and content-free", async () => {
  const { database, request } = await productionWorker();
  const stream = "creative:dev-local-creative";
  const now = new Date().toISOString();
  let sequence = Number(database.sqlite.prepare("SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?").get(stream).head);
  const insert = database.sqlite.prepare("INSERT INTO events(event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,causation_id,compensates_event_id,schema_version,type,payload) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)");
  for (const type of ["DocumentViewVisited", "AttentionEpisodeObserved", "AttentionSignalsForgotten", "CanvasInteractionRecorded", "ObjectViewed", "ComparisonOpened", "GenerationPreflightCompleted", "ValidationFailed", "GenerationPreflightRequested", "ApplicationViewVisited"]) {
    insert.run(crypto.randomUUID(), stream, ++sequence, now, now, "user", "profile-test", crypto.randomUUID(), null, null, 1, type, "{}");
  }
  insert.run(crypto.randomUUID(), "creative:other-owner", 1, now, now, "user", "profile-test", crypto.randomUUID(), null, null, 1, "ProjectCreated", "{}");
  const full = await (await request("/api/events?after=0&limit=5000&content=0")).json();
  for (const profile of SCOPED_EVENT_PROFILES) {
    let after = 0;
    const actual = [];
    for (let page = 0; page < 200; page += 1) {
      database.reset();
      const response = await request(`/api/events?after=${after}&limit=7&profile=${profile}&content=1`);
      const body = await response.json();
      assert.equal(response.status, 200, profile);
      assert.equal(body.profile, profile);
      assert.equal("content" in body, false, profile);
      assert.equal(body.head, sequence, profile);
      assert.ok(body.events.every((event) => event.streamId === stream && eventMatchesProfile(profile, event.type)), profile);
      assert.ok(database.calls.length <= 2, `${profile}: ${database.calls.length} D1 round trips`);
      assert.equal(database.writeCount(), 0);
      actual.push(...body.events);
      if (!body.hasMore) { assert.equal(body.nextAfter, sequence, profile); break; }
      assert.ok(body.nextAfter > after, profile);
      after = body.nextAfter;
    }
    assert.deepEqual(actual.map((event) => event.eventId), full.events.filter((event) => eventMatchesProfile(profile, event.type)).map((event) => event.eventId), profile);
  }
});

test("analytics excludes fictional streams in SQL and batches all dashboard reads", async () => {
  const { database, request } = await productionWorker();
  const response = await request("/api/analytics?days=all");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(body.report.source.eventCount > 0);
  const batch = database.calls.find((call) => call.kind === "batch");
  assert.equal(batch?.statements.length, 4);
  assert.match(batch.statements[2].sql, /stream_id NOT IN \(SELECT fictional_stream_id/);
  assert.match(batch.statements[2].sql, /SELECT event_id e,stream_id s,sequence q,occurred_at o,actor a,type t,CASE/);
  assert.match(batch.statements[2].sql, /json_remove\(payload,'\$\.compiled_snapshot'\)/);
  assert.doesNotMatch(batch.statements[2].sql, /SELECT \* FROM events/);
  assert.ok(database.calls.length <= 2, `expected admin authentication plus one dashboard batch, received ${database.calls.length}`);
  assert.equal(database.writeCount(), 0);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  database.reset();
  const synthetic = await request("/api/analytics?days=all&includeSynthetic=true");
  assert.equal(synthetic.status, 200);
  const included = database.calls.find((call) => call.kind === "batch");
  assert.equal(included?.statements.length, 4);
  assert.doesNotMatch(included.statements[2].sql, /NOT IN/);
  database.sqlite.prepare("UPDATE users SET role='creator' WHERE user_id=?").run("dev-local-creative");
  database.reset();
  assert.equal((await request("/api/analytics?days=all")).status, 403);
  assert.equal(database.calls.some((call) => call.kind === "batch"), false);
  assert.equal(database.writeCount(), 0);
});

test("analytics reuses immutable account evidence while every fresh report includes new events", async () => {
  const { database, request } = await productionWorker();
  const collaborator="analytics-collaborator";const created=new Date().toISOString();database.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,created_at,updated_at) VALUES (?,?,?,?,?,?)").run(collaborator,"collaborator@example.test","Original collaborator","creator",created,created);addCorrelatedTerminal(database.sqlite,`creative:${collaborator}`,"collaborator-seed",created);
  const initial = await request("/api/analytics?days=all");
  assert.equal(initial.status, 200);
  assert.equal(initial.headers.get("x-forma-analytics-cache"), "miss");
  const initialBody = await initial.json();
  const full = database.calls.find((call) => call.kind === "batch")?.statements[2];
  assert.ok(full);
  const coldBytes = JSON.stringify(database.sqlite.prepare(full.sql).all(...full.values)).length;

  database.reset();
  const unchanged = await request("/api/analytics?days=all");
  const unchangedBody = await unchanged.json();
  assert.equal(unchanged.headers.get("x-forma-analytics-cache"), "delta");
  assert.equal(unchanged.headers.get("x-forma-analytics-source-rows"), "0");
  assert.equal(unchanged.headers.get("cache-control"), "private, no-store");
  assert.match(unchanged.headers.get("server-timing") ?? "", /analytics-db;dur=.*analytics-fold;dur=.*app;dur=/);
  assert.deepEqual(unchangedBody.report.source, initialBody.report.source);
  assert.deepEqual(unchangedBody.report.totals, initialBody.report.totals);
  const incremental = database.calls.find((call) => call.kind === "batch");
  assert.equal(incremental?.statements.length, 3);
  const delta = incremental.statements[2];
  assert.match(delta.sql, /rowid>\?/);
  assert.match(database.sqlite.prepare(`EXPLAIN QUERY PLAN ${delta.sql}`).all(...delta.values).map((step) => step.detail).join(" "), /INTEGER PRIMARY KEY \(rowid>\?\)/);
  const deltaBytes = JSON.stringify(database.sqlite.prepare(delta.sql).all(...delta.values)).length;
  assert.ok(deltaBytes < coldBytes / 20, `expected meaningful transfer reduction: ${coldBytes} -> ${deltaBytes}`);
  assert.ok(database.calls.length <= 2);
  assert.equal(database.writeCount(), 0);

  addCorrelatedTerminal(database.sqlite, "creative:dev-local-creative", "analytics-new-event");
  database.sqlite.prepare("UPDATE users SET display_name=? WHERE user_id=?").run("Renamed collaborator", collaborator);
  database.reset();
  const changed = await request("/api/analytics?days=all");
  const changedBody = await changed.json();
  assert.equal(changed.headers.get("x-forma-analytics-cache"), "delta");
  assert.equal(changed.headers.get("x-forma-analytics-source-rows"), "1");
  assert.equal(changedBody.report.source.eventCount, initialBody.report.source.eventCount + 1);
  assert.ok(changedBody.report.dimensions.user.some((item) => item.label === "Renamed collaborator"));
  assert.equal(database.writeCount(), 0);

  database.sqlite.prepare("UPDATE users SET role='creator' WHERE user_id=?").run("dev-local-creative");
  database.reset();
  assert.equal((await request("/api/analytics?days=all")).status, 403);
  assert.equal(database.calls.some((call) => call.kind === "batch"), false);
});

test("analytics restores exact owner-bound evidence across cold worker instances and folds fresh changes", async () => {
  const { database, environment, request, context, drainBackground } = await productionWorker();
  const first = await request("/api/analytics?days=all");
  const baseline = (await first.json()).report;
  assert.equal(first.headers.get("x-forma-analytics-cache"), "miss");
  assert.equal(database.writeCount(), 0, "checkpoint creation must remain outside the response-critical path");
  await drainBackground();

  const stored = database.sqlite.prepare("SELECT content_id,owner_id,content FROM external_content WHERE content_id LIKE 'analytics-source:v1:%'").all();
  assert.equal(stored.length, 1);
  assert.equal(stored[0].owner_id, "dev-local-creative");
  const checkpoint = JSON.parse(stored[0].content);
  assert.equal(checkpoint.owner, stored[0].owner_id);
  assert.equal(checkpoint.synthetic, false);
  assert.equal(checkpoint.count, Number(first.headers.get("x-forma-analytics-source-rows")));
  assert.ok(checkpoint.count >= baseline.source.eventCount);
  assert.ok(checkpoint.payload.length < 1_500_000);

  addCorrelatedTerminal(database.sqlite, "creative:dev-local-creative", "analytics-durable-new-event");
  const binding = { prepare: (sql) => database.DB.prepare(sql), batch: (statements) => database.DB.batch(statements) };
  const coldEnvironment = { ...environment, DB: binding };
  const coldRequest = (path) => worker.fetch(new Request(`http://localhost${path}`), coldEnvironment, context);
  assert.equal((await coldRequest("/api/session")).status, 200);
  database.reset();
  const cold = await coldRequest("/api/analytics?days=all");
  const current = (await cold.json()).report;
  assert.equal(cold.headers.get("x-forma-analytics-cache"), "durable");
  assert.equal(cold.headers.get("x-forma-analytics-source-rows"), "1");
  assert.equal(cold.headers.get("cache-control"), "private, no-store");
  assert.equal(current.source.eventCount, baseline.source.eventCount + 1);
  const batch = database.calls.find((call) => call.kind === "batch");
  assert.equal(batch?.statements.length, 4);
  assert.match(batch.statements[2].sql, /WITH snapshot\(head\) AS MATERIALIZED/);
  const plan = database.sqlite.prepare(`EXPLAIN QUERY PLAN ${batch.statements[2].sql}`).all(...batch.statements[2].values);
  assert.match(plan.map((step) => step.detail).join(" "), /INTEGER PRIMARY KEY \(rowid>\?\)/);
  assert.match(plan.map((step) => step.detail).join(" "), /idx_events_nonphantom_stream_sequence/);
  assert.ok(database.calls.length <= 2);
  assert.equal(database.writeCount(), 0);

  database.reset();
  const warm = await coldRequest("/api/analytics?days=all");
  assert.equal(warm.headers.get("x-forma-analytics-cache"), "delta");
  assert.equal(warm.headers.get("x-forma-analytics-source-rows"), "0");
  assert.deepEqual((await warm.json()).report.totals, current.totals);

  database.sqlite.prepare("UPDATE users SET role='creator' WHERE user_id=?").run("dev-local-creative");
  database.reset();
  assert.equal((await coldRequest("/api/analytics?days=all")).status, 403);
  assert.equal(database.calls.some((call) => call.kind === "batch"), false);
});

test("analytics safely rebuilds corrupt durable evidence without exposing another account's checkpoint", async () => {
  const { database, environment, request, context, drainBackground } = await productionWorker();
  const initial = await request("/api/analytics?days=all");
  const expected = (await initial.json()).report;
  await drainBackground();
  const checkpoint = database.sqlite.prepare("SELECT content_id,content FROM external_content").get();
  const corrupt = { ...JSON.parse(checkpoint.content), payload: "not-valid-gzip" };
  database.sqlite.prepare("UPDATE external_content SET content=? WHERE content_id=?").run(JSON.stringify(corrupt), checkpoint.content_id);

  const binding = { prepare: (sql) => database.DB.prepare(sql), batch: (statements) => database.DB.batch(statements) };
  const coldEnvironment = { ...environment, DB: binding };
  const coldRequest = (path) => worker.fetch(new Request(`http://localhost${path}`), coldEnvironment, context);
  await coldRequest("/api/session");
  database.reset();
  const recovered = await coldRequest("/api/analytics?days=all");
  assert.equal(recovered.headers.get("x-forma-analytics-cache"), "miss");
  assert.deepEqual((await recovered.json()).report.totals, expected.totals);
  assert.equal(database.calls.filter((call) => call.kind === "batch").length, 2);
  assert.equal(database.writeCount(), 0);
  await drainBackground();
  assert.notEqual(JSON.parse(database.sqlite.prepare("SELECT content FROM external_content WHERE content_id=?").get(checkpoint.content_id).content).payload, corrupt.payload);

  database.sqlite.prepare("UPDATE external_content SET owner_id=? WHERE content_id=?").run("another-account", checkpoint.content_id);
  const isolatedBinding = { prepare: (sql) => database.DB.prepare(sql), batch: (statements) => database.DB.batch(statements) };
  const isolatedEnvironment = { ...environment, DB: isolatedBinding };
  const isolatedRequest = (path) => worker.fetch(new Request(`http://localhost${path}`), isolatedEnvironment, context);
  await isolatedRequest("/api/session");
  database.reset();
  const isolated = await isolatedRequest("/api/analytics?days=all");
  assert.equal(isolated.headers.get("x-forma-analytics-cache"), "miss");
  assert.deepEqual((await isolated.json()).report.totals, expected.totals);
  await drainBackground();
  assert.equal(database.sqlite.prepare("SELECT owner_id FROM external_content WHERE content_id=?").get(checkpoint.content_id).owner_id, "another-account");
});

test("durable analytics evidence is rebuilt when a fictional stream changes visibility without new events", async () => {
  const { database, environment, request, context, drainBackground } = await productionWorker();
  const now = new Date().toISOString(), fictional = "durable-fictional";
  database.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,created_at,updated_at) VALUES (?,?,?,?,?,?)").run(fictional, "durable@example.test", "Durable persona", "creator", now, now);
  addCorrelatedTerminal(database.sqlite, `creative:${fictional}`, "durable-fictional-evidence", now);
  const initial = await request("/api/analytics?days=all");
  assert.ok((await initial.json()).report.dimensions.user.some((item) => item.id === fictional));
  await drainBackground();
  database.sqlite.prepare("INSERT INTO replay_personas(persona_id,session_id,owner_id,fictional_user_id,fictional_stream_id,display_name,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").run("durable-persona", "durable-replay", "dev-local-creative", fictional, `creative:${fictional}`, "Durable persona", "ready", now, now);

  const binding = { prepare: (sql) => database.DB.prepare(sql), batch: (statements) => database.DB.batch(statements) };
  const coldEnvironment = { ...environment, DB: binding };
  const coldRequest = (path) => worker.fetch(new Request(`http://localhost${path}`), coldEnvironment, context);
  await coldRequest("/api/session");
  database.reset();
  const hidden = await coldRequest("/api/analytics?days=all");
  assert.equal(hidden.headers.get("x-forma-analytics-cache"), "miss");
  assert.ok(!(await hidden.json()).report.dimensions.user.some((item) => item.id === fictional));
  assert.equal(database.writeCount(), 0);
  await drainBackground();

  const nextBinding = { prepare: (sql) => database.DB.prepare(sql), batch: (statements) => database.DB.batch(statements) };
  const nextEnvironment = { ...environment, DB: nextBinding };
  await worker.fetch(new Request("http://localhost/api/session"), nextEnvironment, context);
  database.reset();
  const restored = await worker.fetch(new Request("http://localhost/api/analytics?days=all"), nextEnvironment, context);
  assert.equal(restored.headers.get("x-forma-analytics-cache"), "durable");
  assert.ok(!(await restored.json()).report.dimensions.user.some((item) => item.id === fictional));

  const synthetic = await worker.fetch(new Request("http://localhost/api/analytics?days=all&includeSynthetic=true"), nextEnvironment, context);
  assert.equal(synthetic.headers.get("x-forma-analytics-cache"), "miss");
  assert.ok((await synthetic.json()).report.dimensions.user.some((item) => item.id === fictional));
  await drainBackground();
  const checkpoints = database.sqlite.prepare("SELECT content FROM external_content WHERE owner_id=?").all("dev-local-creative").map((row) => JSON.parse(row.content));
  assert.deepEqual(checkpoints.map((row) => row.synthetic).sort(), [false, true]);

  const syntheticBinding = { prepare: (sql) => database.DB.prepare(sql), batch: (statements) => database.DB.batch(statements) };
  const syntheticEnvironment = { ...environment, DB: syntheticBinding };
  await worker.fetch(new Request("http://localhost/api/session"), syntheticEnvironment, context);
  const syntheticRestored = await worker.fetch(new Request("http://localhost/api/analytics?days=all&includeSynthetic=true"), syntheticEnvironment, context);
  assert.equal(syntheticRestored.headers.get("x-forma-analytics-cache"), "durable");
  assert.ok((await syntheticRestored.json()).report.dimensions.user.some((item) => item.id === fictional));
});

test("analytics invalidates cached source when a fictional account becomes hidden or visible", async () => {
  const { database, request } = await productionWorker();
  const now = new Date().toISOString();
  const fictional = "analytics-fictional";
  database.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,created_at,updated_at) VALUES (?,?,?,?,?,?)").run(fictional, "fictional@example.test", "Fictional account", "creator", now, now);
  addCorrelatedTerminal(database.sqlite, `creative:${fictional}`, "fictional-evidence", now);

  const initial = await request("/api/analytics?days=all");
  const initialReport = (await initial.json()).report;
  assert.ok(initialReport.dimensions.user.some((item) => item.id === fictional));
  database.sqlite.prepare("INSERT INTO replay_personas(persona_id,session_id,owner_id,fictional_user_id,fictional_stream_id,display_name,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").run("analytics-persona", "analytics-replay", "dev-local-creative", fictional, `creative:${fictional}`, "Fictional account", "ready", now, now);

  database.reset();
  const hidden = await request("/api/analytics?days=all");
  assert.equal(hidden.headers.get("x-forma-analytics-cache"), "miss");
  assert.ok(!(await hidden.json()).report.dimensions.user.some((item) => item.id === fictional));

  database.sqlite.prepare("UPDATE replay_personas SET status='preparing' WHERE persona_id=?").run("analytics-persona");
  database.reset();
  const visible = await request("/api/analytics?days=all");
  assert.equal(visible.headers.get("x-forma-analytics-cache"), "miss");
  assert.ok((await visible.json()).report.dimensions.user.some((item) => item.id === fictional));

  database.sqlite.prepare("UPDATE replay_personas SET status='ready' WHERE persona_id=?").run("analytics-persona");
  database.reset();
  const synthetic = await request("/api/analytics?days=all&includeSynthetic=true");
  assert.equal(synthetic.headers.get("x-forma-analytics-cache"), "miss");
  assert.ok((await synthetic.json()).report.dimensions.user.some((item) => item.id === fictional));
});

test("chat retrieves only its owner's unexpired conversation content", async () => {
  const { database, request } = await productionWorker();
  const now = new Date().toISOString();
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const insert = database.sqlite.prepare("INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at) VALUES (?,?,?,?,?,?,?)");
  insert.run("chat-user-visible", "dev-local-creative", "chat-user", "Creator message", now, future, null);
  insert.run("chat-assistant-visible", "dev-local-creative", "chat-assistant", "Assistant reply", now, future, null);
  insert.run("condition-visible", "dev-local-creative", "condition", "Remember this project", now, future, null);
  insert.run("other-condition-hidden", "someone-else", "condition", "Another account's condition", now, future, null);
  insert.run("expired-condition-hidden", "dev-local-creative", "condition", "Expired condition", now, new Date(Date.now()-86_400_000).toISOString(), null);
  insert.run("redacted-condition-hidden", "dev-local-creative", "condition", "Redacted condition", now, future, now);
  insert.run("prompt-hidden", "dev-local-creative", "prompt", "x".repeat(24_000), now, future, null);
  insert.run("artifact-hidden", "dev-local-creative", "document-artifact-input", "Private artifact inputs", now, future, null);
  insert.run("other-chat-hidden", "someone-else", "chat-user", "Another account", now, future, null);
  insert.run("redacted-chat-hidden", "dev-local-creative", "chat-user", "Redacted chat", now, future, now);

  database.reset();
  const scopedResponse = await request("/api/events?after=0&limit=1&content=1&contentScope=chat");
  const scoped = await scopedResponse.json();
  assert.equal(scopedResponse.status, 200);
  assert.equal(scoped.content["chat-user-visible"], "Creator message");
  assert.equal(scoped.content["chat-assistant-visible"], "Assistant reply");
  for (const id of ["prompt-hidden", "artifact-hidden", "condition-visible", "other-chat-hidden", "redacted-chat-hidden"]) assert.equal(scoped.content[id], undefined, id);
  assert.equal(database.writeCount(), 0);

  database.reset();
  const memoryResponse=await request("/api/events?after=0&limit=1&content=1&contentScope=memory");
  const memory=await memoryResponse.json();assert.equal(memoryResponse.status,200);assert.equal(memory.content["condition-visible"],"Remember this project");
  for(const id of ["chat-user-visible","chat-assistant-visible","prompt-hidden","artifact-hidden","other-chat-hidden","other-condition-hidden","expired-condition-hidden","redacted-condition-hidden"])assert.equal(memory.content[id],undefined,id);
  assert.equal(database.writeCount(),0);

  database.reset();
  const full = await (await request("/api/events?after=0&limit=1&content=1")).json();
  assert.equal(full.content["prompt-hidden"].length, 24_000);
  assert.equal(full.content["artifact-hidden"], "Private artifact inputs");
  assert.equal(full.content["other-chat-hidden"], undefined);
  assert.ok(JSON.stringify(scoped.content).length < JSON.stringify(full.content).length / 100);
  assert.equal(database.writeCount(), 0);

  database.reset();
  assert.equal((await request("/api/events?after=0&limit=1&content=1&contentScope=everything")).status, 400);
  assert.equal(database.writeCount(), 0);
});

test("production-shaped idle histories collapse to one scoped page while raw audit and genuine attention stay intact",async()=>{
  const {database,request}=await productionWorker();const stream="creative:dev-local-creative";const now=new Date().toISOString();
  const future=new Date(Date.now()+86_400_000).toISOString();
  let sequence=Number(database.sqlite.prepare("SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?").get(stream).head);
  const insert=database.sqlite.prepare("INSERT INTO events(event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,causation_id,compensates_event_id,schema_version,type,payload) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)");
  const phantom={surface:"studio",context:"studio-overview",terminal_type:"idle_timeout",terminal_ref:null,active_ms:30_000,idle_ms:30_000,visible_refs:[],outcome_weight:.013,friction_score:0,capture_version:"attention-v2",expires_at:future};
  const append=(type,payload,owner=stream)=>insert.run(crypto.randomUUID(),owner,owner===stream?++sequence:1,now,now,"user","attention-performance",crypto.randomUUID(),null,null,1,type,JSON.stringify(payload));
  database.sqlite.exec("BEGIN");for(let index=0;index<5_001;index+=1)append("AttentionEpisodeObserved",{...phantom,capture_version:index%2?"attention-v1":"attention-v2"});
  const genuine=[{...phantom,active_ms:30_001},{...phantom,visible_refs:["block:authored"]},{...phantom,context:"writing-direction"},{...phantom,friction_score:.45},{...phantom,outcome_weight:.18},{}];
  for(const payload of genuine)append("AttentionEpisodeObserved",payload);append("AttentionSignalsForgotten",{before_sequence:0});append("ProjectCreated",{project_id:"fast-project",name:"Fast"});append("AttentionEpisodeObserved",phantom,"creative:other-owner");database.sqlite.exec("COMMIT");
  const full=await(await request("/api/events?after=0&limit=5000&content=0")).json();assert.equal(full.events.length,5_000);assert.equal(full.hasMore,true);assert.ok(full.events.some((item)=>item.type==="AttentionEpisodeObserved"&&item.payload.active_ms===30_000));
  for(const profile of ["memory","scout","sessions"]){database.reset();const response=await request(`/api/events?after=0&limit=5000&profile=${profile}&content=0`);const body=await response.json();
    assert.equal(response.status,200,profile);assert.equal(body.head,sequence,profile);assert.equal(body.nextAfter,sequence,profile);assert.equal(body.hasMore,false,profile);assert.ok(body.events.length<5_000,profile);
    assert.equal(body.events.filter((item)=>item.clientId==="attention-performance"&&item.type==="AttentionEpisodeObserved").length,genuine.length,profile);
    assert.ok(body.events.some((item)=>item.type==="AttentionSignalsForgotten"),profile);assert.ok(body.events.some((item)=>item.payload.project_id==="fast-project"),profile);
    assert.ok(body.events.every((item)=>item.streamId===stream),profile);assert.ok(database.calls.length<=2,profile);assert.equal(database.writeCount(),0,profile);
    const statement=database.calls.find((call)=>call.kind==="batch")?.statements[0];const plan=database.sqlite.prepare(`EXPLAIN QUERY PLAN ${statement.sql}`).all(...statement.values);
    assert.match(plan.map((step)=>step.detail).join(" "),/idx_events_nonphantom_stream_sequence/,profile);
  }
  database.reset();const analytics=await(await request("/api/analytics?days=all")).json();
  assert.ok(analytics.report.source.eventCount<5_000);assert.match(database.calls.find((call)=>call.kind==="batch")?.statements[2].sql??"",/capture_version/);assert.ok(database.calls.length<=2);assert.equal(database.writeCount(),0);
  const analyticsStatement=database.calls.find((call)=>call.kind==="batch")?.statements[2];const analyticsPlan=database.sqlite.prepare(`EXPLAIN QUERY PLAN ${analyticsStatement.sql}`).all(...analyticsStatement.values);
  assert.match(analyticsPlan.map((step)=>step.detail).join(" "),/idx_events_nonphantom_stream_sequence/);

  database.reset();const auditResponse=await request("/api/events?audit=1&limit=150&content=1");const audit=await auditResponse.json();
  assert.equal(auditResponse.status,200);assert.equal(audit.events.length,150);assert.equal(audit.head,sequence);assert.equal(audit.total,sequence);assert.equal(audit.matched,sequence);assert.equal(audit.hasOlder,true);assert.equal("content" in audit,false);
  assert.ok(audit.events.some((item)=>item.type==="AttentionEpisodeObserved"&&item.payload.active_ms===30_000));assert.ok(audit.events.every((item)=>item.streamId===stream));
  assert.deepEqual(audit.events.map((item)=>item.sequence),[...audit.events].sort((left,right)=>left.sequence-right.sequence).map((item)=>item.sequence));assert.ok(audit.actors.includes("user"));
  const auditBatch=database.calls.find((call)=>call.kind==="batch");assert.match(auditBatch?.statements[0].sql??"",/ORDER BY sequence DESC LIMIT/);assert.ok(database.calls.length<=2);assert.equal(database.writeCount(),0);

  append("ApplicationViewVisited",{application:"operations",surface:"operations-events",route_family:"operations-events"});
  database.reset();const older=await(await request(`/api/events?audit=1&limit=150&before=${audit.nextBefore}&asOf=${audit.head}`)).json();
  assert.equal(older.events.length,150);assert.ok(older.events.at(-1).sequence<audit.events[0].sequence);assert.equal(older.head,audit.head);assert.equal(older.total,audit.total);assert.ok(database.calls.length<=2);assert.equal(database.writeCount(),0);

  const oldest=database.sqlite.prepare("SELECT event_id,correlation_id FROM events WHERE stream_id=? AND client_id=? AND type=? ORDER BY sequence LIMIT 1").get(stream,"attention-performance","AttentionEpisodeObserved");
  database.reset();const filtered=await(await request(`/api/events?audit=1&type=attentionepisode&correlation=${encodeURIComponent(oldest.correlation_id.slice(0,12))}`)).json();
  assert.equal(filtered.matched,1);assert.equal(filtered.events[0].eventId,oldest.event_id);assert.equal(filtered.total,sequence);assert.ok(database.calls.length<=2);assert.equal(database.writeCount(),0);

  assert.equal((await request("/api/events?audit=1&limit=not-a-number&before=Infinity")).status,200);
  database.sqlite.prepare("UPDATE users SET role='creator' WHERE user_id=?").run("dev-local-creative");database.reset();
  assert.equal((await request("/api/events?audit=1")).status,403);assert.equal(database.calls.some((call)=>call.kind==="batch"),false);assert.equal(database.writeCount(),0);
});

test("scoped sessions remain a single page above 5,000 genuine receipts without widening full audit pages",async()=>{
  const {database,request}=await productionWorker();const stream="creative:dev-local-creative";const now=new Date().toISOString();
  let sequence=Number(database.sqlite.prepare("SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?").get(stream).head);
  const insert=database.sqlite.prepare("INSERT INTO events(event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,causation_id,compensates_event_id,schema_version,type,payload) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)");
  database.sqlite.exec("BEGIN");for(let index=0;index<5_175;index+=1)insert.run(crypto.randomUUID(),stream,++sequence,now,now,"user","session-pagination",crypto.randomUUID(),null,null,1,"CanvasInteractionRecorded",JSON.stringify({interaction_id:"item_selected",document_id:"doc-atmosphere"}));database.sqlite.exec("COMMIT");
  database.reset();const response=await request("/api/events?profile=sessions&after=0&limit=6500&content=0");const scoped=await response.json();
  assert.equal(response.status,200);assert.ok(scoped.events.length>5_000);assert.ok(scoped.events.length<=6_500);assert.equal(scoped.head,sequence);assert.equal(scoped.nextAfter,sequence);assert.equal(scoped.hasMore,false);assert.ok(database.calls.length<=2);assert.equal(database.writeCount(),0);
  const raw=await(await request("/api/events?after=0&limit=6500&content=0")).json();assert.equal(raw.events.length,5_000);assert.equal(raw.hasMore,true);
});

test("saved replay listings reconcile and load their own data in bounded database batches", async () => {
  const { database, request } = await productionWorker();
  const response = await request("/api/replay-sessions");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(Array.isArray(body.sessions));
  assert.ok(body.liveGeneration);
  assert.ok(database.calls.length <= 4, `expected authentication, reconciliation, listing, and budget; received ${database.calls.length}`);
  const batches = database.calls.filter((call) => call.kind === "batch");
  assert.equal(batches.length, 2);
  assert.equal(batches[0].statements.length, 2);
  assert.equal(batches[1].statements.length, 3);
  assert.match(batches[1].statements[0].sql, /CASE WHEN json_valid\(usage_json\)/);
  assert.doesNotMatch(batches[1].statements[0].sql, /SELECT \* FROM replay_sessions/);
  assert.equal(database.writeCount(), 0);
});

test("full inspection uses 5,000-event pages while editing reads only workspace evidence", async () => {
  const { database, request } = await productionWorker();
  const stream = "creative:dev-local-creative";
  const now = new Date().toISOString();
  let sequence = Number(database.sqlite.prepare("SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?").get(stream).head);
  const insert = database.sqlite.prepare("INSERT INTO events(event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,causation_id,compensates_event_id,schema_version,type,payload) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)");
  database.sqlite.exec("BEGIN");
  for (let index = 0; index < 5_001; index += 1) insert.run(crypto.randomUUID(), stream, ++sequence, now, now, "user", "performance-test", crypto.randomUUID(), null, null, 1, "ApplicationViewVisited", "{}");
  database.sqlite.exec("COMMIT");
  const full = await request("/api/events?after=0&limit=5000&content=0");
  assert.equal(full.status, 200);
  const page = await full.json();
  assert.equal(page.events.length, 5_000);
  assert.equal(page.hasMore, true);
  database.reset();
  const edited = await request("/api/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "append", event: { type: "CollectionCreated", payload: { collection_id: "collection-fast", handle: "performance-fast", parent_collection_id: null } } }),
  });
  assert.equal(edited.status, 200);
  const body = await edited.json();
  assert.ok(body.appended.some((event) => event.type === "CollectionCreated"));
  const eventReads = database.calls.filter((call) => call.kind === "batch" && call.statements.some((statement) => /FROM events.*type NOT IN/i.test(statement.sql)));
  assert.equal(eventReads.length, 1);
  assert.equal(database.calls.some((call) => call.kind === "batch" && call.statements.some((statement) => /FROM events WHERE stream_id=\? AND sequence>\? ORDER BY/i.test(statement.sql))), false);
});

test("public shares load only their scoped workspace projection without recipient account access", async () => {
  const { database, request } = await productionWorker();
  const creation = await request("/api/shares", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ resourceKind: "document", documentId: "doc-atmosphere", projectId: "project-atmosphere", expiresHours: 1 }),
  });
  assert.equal(creation.status, 200);
  const { share } = await creation.json();
  assert.ok(share.token);
  database.reset();
  const response = await request(`/api/shared/${encodeURIComponent(share.token)}`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(body.projection.documentTitle);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.ok(database.calls.length <= 2, `expected token scope plus one workspace batch, received ${database.calls.length}`);
  const batch = database.calls.find((call) => call.kind === "batch");
  assert.match(batch?.statements[0].sql ?? "", /type NOT IN/);
  assert.equal(database.calls.some((call) => /SELECT \* FROM users WHERE user_id/i.test(call.sql)), false);
  assert.doesNotMatch(JSON.stringify(body.projection), /"(?:content_ref|contentRef|prompt_ref|promptRef|input_ref|inputRef)"/);
  assert.equal(database.writeCount(), 0);
  assert.equal((await request(`/api/shares/${share.shareId}`, { method: "DELETE" })).status, 200);
  assert.equal((await request(`/api/shared/${encodeURIComponent(share.token)}`)).status, 404);
});

test("public shares disclose complete authored output only from the selected owner's unexpired artifact content",async()=>{
  const {database,request}=await productionWorker();const owner="dev-local-creative",stream=`creative:${owner}`,now=new Date().toISOString(),future=new Date(Date.now()+3_600_000).toISOString(),past=new Date(Date.now()-3_600_000).toISOString();let sequence=Number(database.sqlite.prepare("SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?").get(stream).head);const insertEvent=database.sqlite.prepare("INSERT INTO events(event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,causation_id,compensates_event_id,schema_version,type,payload) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)");
  for(const [artifactId,contentRef] of [["shared-story","shared-story-content"],["expired-story","expired-story-content"]])insertEvent.run(crypto.randomUUID(),stream,++sequence,now,now,"worker:renderer","share-test",crypto.randomUUID(),null,null,1,"DocumentRenderCompleted",JSON.stringify({artifact_id:artifactId,artifact_kind:"short_story",document_id:"doc-atmosphere",project_id:"project-atmosphere",title:artifactId,summary:"An authored narrative",content_ref:contentRef,item_count:1,items:[{id:`${artifactId}-item`,title:"Receipt heading only"}]}));
  const draft=(text)=>JSON.stringify({title:"A complete authored story",summary:"A real summary",content_markdown:text,presentation:null,items:[{title:"The actual opening",body:"The exact story section.",notes:"A private-to-this-document author note.",image_prompt:"A quiet dawn.",slide:null}]});const insertContent=database.sqlite.prepare("INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at) VALUES (?,?,?,?,?,?,NULL)");insertContent.run("shared-story-content",owner,"document-artifact",draft("# The complete story\n\nEvery intentionally written word."),now,future);insertContent.run("expired-story-content",owner,"document-artifact",draft("EXPIRED PRIVATE MANUSCRIPT"),now,past);insertContent.run("unrelated-private-content",owner,"document-artifact",draft("UNRELATED PRIVATE MANUSCRIPT"),now,future);insertContent.run("private-input-receipt",owner,"document-artifact-input","PRIVATE PROVIDER RECEIPT",now,future);
  const creation=await request("/api/shares",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({resourceKind:"document",documentId:"doc-atmosphere",projectId:"project-atmosphere",expiresHours:1})});assert.equal(creation.status,200);const {share}=await creation.json();database.reset();const response=await request(`/api/shared/${encodeURIComponent(share.token)}`);assert.equal(response.status,200);const body=await response.json(),story=body.projection.artifacts.find((artifact)=>artifact.id==="shared-story"),expired=body.projection.artifacts.find((artifact)=>artifact.id==="expired-story");assert.equal(story.contentMarkdown,"# The complete story\n\nEvery intentionally written word.");assert.equal(story.items[0].title,"The actual opening");assert.equal(story.items[0].body,"The exact story section.");assert.equal(story.items[0].notes,"A private-to-this-document author note.");assert.equal(story.items[0].imagePrompt,"A quiet dawn.");assert.equal(expired.contentMarkdown,null);assert.equal(expired.contentAvailable,false);assert.doesNotMatch(JSON.stringify(body),/EXPIRED PRIVATE MANUSCRIPT|UNRELATED PRIVATE MANUSCRIPT|PRIVATE PROVIDER RECEIPT|content_ref|contentRef|input_ref|inputRef/);assert.ok(database.calls.length<=3,`owner-scoped artifact hydration must use one bounded additional batch; received ${database.calls.length}`);const hydration=database.calls.find((call)=>call.kind==="batch"&&call.statements.some((statement)=>/FROM private_content/.test(statement.sql)));assert.ok(hydration);assert.equal(hydration.statements.length,1);assert.match(hydration.statements[0].sql,/owner_id=\? AND kind='document-artifact' AND redacted_at IS NULL AND expires_at>\? AND content_id IN/);assert.equal(database.writeCount(),0);
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
  environment.FORMA_USER_TOKEN_LIMIT = "12000000";
  database.reset();

  const response = await request("/api/session");
  const session = await response.json();
  assert.equal(session.budgets.user.limit, 12000000);
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
