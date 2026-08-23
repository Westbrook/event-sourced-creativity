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
import { IMAGE_ADAPTER_V52_EVALUATION_EVIDENCE } from "../worker/image-adapter-evaluation-evidence.ts";
import { reserveBudget, reserveCostBudget, settleBudget, settleCostBudget } from "../worker/pilot-policy.ts";
import { EXTRACTOR_EVAL_FIXTURES } from "../src/model/extractors.ts";
import { foldCanvasEvents } from "../src/canvas/model.ts";

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

async function specialistIdentity(database,request,userId,capabilities=[]){
  const headers={"oai-authenticated-user-id":userId,"oai-authenticated-user-email":`${userId}@example.test`};
  assert.equal((await request("/api/session",{headers})).status,200);
  database.sqlite.prepare("UPDATE users SET consent_version=? WHERE user_id=?").run("pilot-2026-08-10",userId);
  const now=new Date().toISOString();
  const insert=database.sqlite.prepare("INSERT INTO capability_grants(grant_id,user_id,capability,scope_type,organization_id,project_access_id,project_id,status,granted_by_user_id,created_at,updated_at,expires_at,revoked_at) VALUES(?,?,?, ?,NULL,NULL,NULL,'active',?,?,?,NULL,NULL)");
  for(const capability of capabilities)insert.run(crypto.randomUUID(),userId,capability,capability.startsWith("evaluation.synthetic.")||capability.startsWith("design.")?"synthetic":"platform","dev-local-creative",now,now);
  database.reset();
  return headers;
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

test("route timing correctly attributes Canvas proposals and legacy aliases to their actual persona owners", () => {
  assert.equal(performanceRouteFamily("/canvas/proposals"), "canvas-proposals");
  assert.equal(performanceRouteFamily("/canvas/proposals/proposal-1"), "canvas-proposals");
  assert.equal(performanceRouteFamily("/canvas/canvas-1"), "canvas-workspace");
  assert.equal(performanceRouteFamily("/canvas/projects"), "canvas-projects");
  assert.equal(performanceRouteFamily("/canvas/projects/project-1"), "canvas-projects");
  assert.equal(performanceRouteFamily("/canvas/library"), "canvas-library");
  assert.equal(performanceRouteFamily("/canvas/library/output/output-1"), "canvas-library");
  assert.equal(performanceRouteSurface("/canvas/projects"), "canvas-projects");
  assert.equal(performanceRouteSurface("/canvas/library/output/output-1"), "canvas-library");
  assert.equal(performanceRouteFamily("/system/focal-points"), "knowledge");
  assert.equal(performanceRouteFamily("/admin/events/replay"), "product");
  assert.equal(performanceRouteFamily("/admin/events/permissions"), "engineering");
  assert.equal(performanceRouteFamily("/laboratory/image-adapters"), "product");
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
    "/operations": "operations-system", "/system": "operations-system", "/operations/analytics": "product-insights",
    "/operations/canvas": "operations-canvas-governance", "/operations/events": "engineering-events",
    "/operations/events/stream": "engineering-events", "/admin/events": "engineering-events",
    "/operations/events/permissions": "engineering-events", "/admin/events/permissions": "engineering-events",
    "/operations/events/sync": "engineering-sync", "/admin/events/sync": "engineering-sync",
    "/laboratory": "product-evaluation", "/laboratory/replay": "product-replay", "/admin/events/replay": "product-actual-replay",
    "/laboratory/image-adapters": "product-adapters", "/laboratory/focal-points": "knowledge-focal-points",
    "/system/focal-points": "knowledge-focal-points", "/laboratory/design-system": "knowledge-design-system",
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
  const snapshot = { key: "owner-a:owner-a:creative:personal:personal:legacy:policy-2:v3", userId: "owner-a",principalUserId:"owner-a",audience:"creative",organizationId:"personal",projectAccessId:"personal",permissionEpoch:"legacy", policyVersion: "policy-2", profile: "full", head: types.length, events: types.map((type, index) => ({ type, sequence: index + 1 })), savedAt: Date.now(), schemaVersion: 3 };
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
  assert.equal(matchingAccountSnapshot([snapshot],{...identity,organizationId:"organization-b"},"projects"),null);
  assert.equal(matchingAccountSnapshot([snapshot],{...identity,projectAccessId:"project-b"},"projects"),null);
  assert.equal(matchingAccountSnapshot([snapshot],{...identity,permissionEpoch:"revoked"},"projects"),null);
  assert.equal(matchingAccountSnapshot([snapshot],{...identity,principalUserId:"different-principal"},"projects"),null);
  assert.equal(matchingAccountSnapshot([{ ...snapshot, key: "owner-a:policy-2:v1", schemaVersion: 1 }], identity, "projects"), null);
});

test("same-profile and downscoped snapshots remove timer artifacts without changing raw audit history or stream head",()=>{
  const identity={userId:"owner-a",policyVersion:"policy-2",accepted:true,impersonating:false};
  const phantom={surface:"studio",context:"studio-overview",terminal_type:"idle_timeout",terminal_ref:null,active_ms:30_000,idle_ms:30_000,visible_refs:[],outcome_weight:.013,friction_score:0,capture_version:"attention-v2"};
  const events=[{type:"ProjectCreated",sequence:1,payload:{}},{type:"AttentionEpisodeObserved",sequence:2,payload:phantom},{type:"AttentionEpisodeObserved",sequence:3,payload:{...phantom,visible_refs:["block:real"]}},{type:"AttentionSignalsForgotten",sequence:4,payload:{}}];
  const snapshot={key:"owner-a:owner-a:creative:personal:personal:legacy:policy-2:v3",userId:"owner-a",principalUserId:"owner-a",audience:"creative",organizationId:"personal",projectAccessId:"personal",permissionEpoch:"legacy",policyVersion:"policy-2",profile:"full",head:40,events,savedAt:Date.now(),schemaVersion:3};
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
    "/sessions": ["sessions", false, false], "/settings": ["sessions", false, false], "/operations/events": ["projects", false, false],
    "/operations/events/stream": ["projects", false, false], "/operations": ["sessions", false, false],
    "/operations/events/sync": ["sessions", false, false], "/operations/analytics": ["projects", false, false],
    "/operations/canvas": ["projects", false, false], "/operations/events/permissions": ["projects", false, false],
    "/laboratory/replay": ["projects", false, false], "/laboratory/image-adapters": ["projects", false, false],
    "/laboratory/focal-points": ["workspace", false, false], "/laboratory/design-system": ["workspace", false, false],
    "/studio/project": ["workspace", false, false], "/document/document-1": ["workspace", true, true],
    "/canvas/canvas-1": ["workspace", true, true], "/canvas/projects": ["projects", false, false], "/canvas/projects/project-1": ["projects", false, false], "/canvas/library": ["workspace", true, true], "/canvas/library/output/output-1": ["workspace", true, true], "/library": ["workspace", true, true], "/share/token": ["projects", false, false],
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

test("persona entries prefetch only their exact authorized, audience-specific read-only endpoint", async () => {
  const entries = new Map([
    ["/operations",{endpoint:"/api/portfolio/operations/overview",capability:"platform.policy.manage"}],
    ["/operations/analytics",{endpoint:"/api/portfolio/product/insights",capability:"product.analytics.read"}],
    ["/operations/canvas",{endpoint:"/api/canvas-governance",capability:"platform.release.approve"}],
    ["/operations/events",{endpoint:"/api/portfolio/engineering/events",capability:"engineering.events.read"}],
    ["/operations/events/stream",{endpoint:"/api/portfolio/engineering/events",capability:"engineering.events.read"}],
    ["/admin/events",{endpoint:"/api/portfolio/engineering/events",capability:"engineering.events.read"}],
    ["/admin/events/stream",{endpoint:"/api/portfolio/engineering/events",capability:"engineering.events.read"}],
    ["/laboratory/image-adapters",{endpoint:"/api/portfolio/product/evaluation",capability:"evaluation.qualification.read"}],
    ["/admin/events/replay",{endpoint:"/api/replay-sessions",capability:"evaluation.actual.run",administratorOnly:true}],
  ]);

  for (const [pathname, {endpoint,capability,administratorOnly=false}] of entries) {
    const html = await readFile(new URL(`../dist/client${pathname}/index.html`, import.meta.url), "utf8");
    const match = /<script id="forma-static-route-prefetch">([\s\S]*?)<\/script>/.exec(html);
    assert.ok(match, pathname);
    assert.ok(match.index < html.indexOf('<script type="module"'), pathname);

    for (const [role, capabilities, impersonation, expected] of [["admin",[capability],null,1],["creator",[capability],null,administratorOnly?0:1],["admin",["design.docs.read"],null,0],["admin",[capability],{personaId:"other"},0]]) {
      const calls = [];
      const response = new Response("{}", { status: 200 });
      const context = {
        location: { pathname },
        document: { documentElement: { dataset: {} } },
        performance: { now: () => 26.34 },
        window: { __formaInitialSession: Promise.resolve(Response.json({ user: { role }, capabilities, impersonation })) },
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

  for (const pathname of ["/projects", "/share", "/laboratory/replay"]) {
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
  assert.match(shell, /addEventListener\("forma-performance",\s*this\.#populated\)/);
  assert.match(shell, /removeEventListener\("forma-performance",\s*this\.#populated\)/);
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
  assert.match(store, /const active=this\.session\.get\(\);if\(active\)await clearAnalyticsSnapshots\(this\.#snapshotIdentity\(active\),true\)/);
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

test("internal application HTML, compatibility routes, and protected bundles reject creators before asset delivery", async () => {
  const { database, environment, request } = await productionWorker();
  const assets = htmlAssets(environment);
  database.sqlite.prepare("UPDATE users SET role='creator' WHERE user_id=?").run("dev-local-creative");

  for (const path of ["/operations", "/operations/analytics", "/operations.html", "/operations/index.html", "/operations/analytics.html", "/system", "/system.html", "/admin/events", "/admin/events.html", "/laboratory/replay", "/laboratory/replay.html", "/admin/events/replay", "/admin/events/replay.html", "/protected-assets/internal-test.js"]) {
    const before = assets.requests.length;
    const response = await request(path);
    assert.equal(response.status, 403, path);
    assert.equal(assets.requests.length, before, `${path} must deny before protected HTML or module bytes`);
    assert.equal(response.headers.has("x-forma-application"), false);
    const body = await response.text();
    assert.doesNotMatch(body, /forma-shell|forma-session-bootstrap|provider|costBudgets/);
  }

  database.sqlite.prepare("UPDATE users SET role='admin' WHERE user_id=?").run("dev-local-creative");
  assert.equal((await request("/operations")).status, 200);
  const internalAlias=await request("/operations.html");
  assert.equal(internalAlias.status,200);
  assert.equal(internalAlias.headers.get("cache-control"),"private, no-store");
  const protectedAsset = await request("/protected-assets/internal-test.js");
  assert.equal(protectedAsset.status, 200);
  assert.equal(protectedAsset.headers.get("cache-control"), "private, no-store");
  assert.match(protectedAsset.headers.get("vary") ?? "", /oai-authenticated-user-id/i);
});

test("hosted first-user provisioning never overrides an explicit administrator allowlist", async () => {
  const database = measuredDatabase();
  const environment = {
    DB: database.DB,
    ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
    MEDIA: {},
    FORMA_ADMIN_EMAILS: "approved-admin@example.test",
  };
  const context = { waitUntil() {} };
  const request = (id, email) => worker.fetch(new Request("https://forma.example.test/api/session", {
    headers: { "oai-authenticated-user-id": id, "oai-authenticated-user-email": email },
  }), environment, context);

  const visitor = await request("first-visitor", "first-visitor@example.test");
  assert.equal(visitor.status, 200);
  assert.equal((await visitor.json()).user.role, "creator");

  const administrator = await request("approved-admin", "approved-admin@example.test");
  assert.equal(administrator.status, 200);
  assert.equal((await administrator.json()).user.role, "admin");
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
  assert.deepEqual(embedded.session.organizations,[]);
  assert.equal(embedded.session.capabilities.some((capability)=>/^(platform|product|evaluation|design|engineering)\./.test(capability)),false);
  assert.equal(embedded.session.budgets.user.used, 314);
  assert.equal(embedded.session.canvas.access, false);
  assert.equal(database.calls.length, 4);

  for(const path of ["/api/session?audience=product","/api/portfolio/product/insights","/api/platform/access","/api/analytics","/api/replay-sessions","/api/workspaces","/operations/access","/product/evaluation/actual"]){
    const denied=await request(path,{headers:{cookie:"forma_impersonation=imp-1"}});
    assert.equal(denied.status,409,`${path} must require a return to the principal account`);
  }

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

  for (const [path, options] of [["/share/public-token", undefined], ["/share", undefined], ["/share.html", undefined], ["/share/index.html", {method:"HEAD"}], ["/projects", { method: "HEAD" }]]) {
    database.reset();
    const response = await request(path, options);
    assert.equal(response.headers.get("cache-control"),path.startsWith("/share")?"private, no-store":"public, max-age=3600");
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
  const { database, request, drainBackground } = await productionWorker();
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
  await drainBackground();
  database.reset();
  const synthetic = await request("/api/analytics?days=all&includeSynthetic=true");
  assert.equal(synthetic.status, 200);
  const included = database.calls.find((call) => call.kind === "batch");
  assert.equal(included?.statements.length, 4);
  assert.doesNotMatch(included.statements[2].sql, /NOT IN/);
  await drainBackground();
  database.sqlite.prepare("UPDATE users SET role='creator' WHERE user_id=?").run("dev-local-creative");
  database.reset();
  assert.equal((await request("/api/analytics?days=all")).status, 403);
  assert.equal(database.calls.some((call) => call.kind === "batch"), false);
  assert.equal(database.writeCount(), 0);
});

test("analytics reuses immutable account evidence while every fresh report includes new events", async () => {
  const { database, request, drainBackground } = await productionWorker();
  const collaborator="analytics-collaborator";const created=new Date().toISOString();database.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,created_at,updated_at) VALUES (?,?,?,?,?,?)").run(collaborator,"collaborator@example.test","Original collaborator","creator",created,created);addCorrelatedTerminal(database.sqlite,`creative:${collaborator}`,"collaborator-seed",created);
  const initial = await request("/api/analytics?days=all");
  assert.equal(initial.status, 200);
  assert.equal(initial.headers.get("x-forma-analytics-cache"), "miss");
  const initialBody = await initial.json();
  const full = database.calls.find((call) => call.kind === "batch")?.statements[2];
  assert.ok(full);
  const coldBytes = JSON.stringify(database.sqlite.prepare(full.sql).all(...full.values)).length;

  await drainBackground();
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
  const {database,request,drainBackground}=await productionWorker();const stream="creative:dev-local-creative";const now=new Date().toISOString();
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

  await drainBackground();
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
  const creation=await request("/api/shares",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({resourceKind:"document",documentId:"doc-atmosphere",projectId:"project-atmosphere",expiresHours:1})});assert.equal(creation.status,200);const {share}=await creation.json();database.reset();const response=await request(`/api/shared/${encodeURIComponent(share.token)}`);assert.equal(response.status,200);const body=await response.json(),story=body.projection.artifacts.find((artifact)=>artifact.id==="shared-story"),expired=body.projection.artifacts.find((artifact)=>artifact.id==="expired-story");assert.equal(story.contentMarkdown,"# The complete story\n\nEvery intentionally written word.");assert.equal(story.items[0].title,"The actual opening");assert.equal(story.items[0].body,"The exact story section.");assert.equal(story.items[0].notes,"A private-to-this-document author note.");assert.equal("imagePrompt" in story.items[0],false);assert.equal("contextGroupIds" in story.items[0],false);assert.equal("provider" in story,false);assert.equal("modelId" in story,false);assert.equal(expired.contentMarkdown,null);assert.equal(expired.contentAvailable,false);assert.doesNotMatch(JSON.stringify(body),/A quiet dawn\.|EXPIRED PRIVATE MANUSCRIPT|UNRELATED PRIVATE MANUSCRIPT|PRIVATE PROVIDER RECEIPT|content_ref|contentRef|input_ref|inputRef|imagePrompt|image_prompt|contextGroupIds/);assert.ok(database.calls.length<=3,`owner-scoped artifact hydration must use one bounded additional batch; received ${database.calls.length}`);const hydration=database.calls.find((call)=>call.kind==="batch"&&call.statements.some((statement)=>/FROM private_content/.test(statement.sql)));assert.ok(hydration);assert.equal(hydration.statements.length,1);assert.match(hydration.statements[0].sql,/owner_id=\? AND kind='document-artifact' AND redacted_at IS NULL AND expires_at>\? AND content_id IN/);assert.equal(database.writeCount(),0);
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
        canvas_id: "canvas-1", project_id: "project-atmosphere", history_owner_id: "dev-local-creative", item_id: "item-1", client_event_id: `canvas-${size}-${index}`,
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

test("Canvas synchronization refuses a different account's offline events before accepting them", async () => {
  const { database, request } = await productionWorker();
  const event = {
    type: "CanvasRegisterSet",
    payload: {
      canvas_id: "canvas-1", project_id: "another-project", history_owner_id: "different-account", client_event_id: "foreign-canvas-change", item_id: "item-1",
      operation: { object: { item_id: "item-1" }, prop: "x", value: 12, hlc: { pt: 1, c: 0, site: "web:foreign" } },
    },
  };
  const response = await request("/api/events", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "canvas_sync", events: [event], clientId: "ownership-test" }),
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body.rejected, [{ index: 0, type: "CanvasRegisterSet", reason: "canvas_account_mismatch" }]);
  assert.ok(body.appended.every((item) => item.type !== "CanvasRegisterSet"));
  assert.equal(Number(database.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE stream_id=? AND type='CanvasRegisterSet' AND json_extract(payload,'$.client_event_id')=?").get("creative:dev-local-creative", "foreign-canvas-change").count), 0);
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

test("specialist sessions expose only the selected audience's grants while preserving safe authorized workspace switching",async()=>{
  const {database,request}=await productionWorker();
  const headers=await specialistIdentity(database,request,"mixed-specialist",["product.delivery.read","evaluation.synthetic.run","engineering.sync.read","design.docs.read"]);
  const expected={product:["product.delivery.read","evaluation.synthetic.run"],engineering:["engineering.sync.read"],knowledge:["design.docs.read"]};
  for(const [audience,capabilities] of Object.entries(expected)){
    const response=await request(`/api/session?audience=${audience}`,{headers});assert.equal(response.status,200,audience);
    const session=await response.json();assert.deepEqual([...session.capabilities].sort(),[...capabilities].sort(),audience);assert.deepEqual(session.organizations,[]);assert.equal(session.provider,undefined);assert.equal(session.budgets,undefined);assert.equal(session.costBudgets,undefined);
    assert.deepEqual(session.availableApplications,[{id:"creative",href:"/projects"},{id:"product",href:"/product/delivery"},{id:"knowledge",href:"/knowledge/patterns"},{id:"engineering",href:"/engineering/sync"}]);
  }
  assert.equal((await request("/api/session?audience=operations",{headers})).status,403);
});

test("active-access reporting excludes expired and revoked grants while retaining current and unbounded privileges",async()=>{
  const {database,request}=await productionWorker();
  const subject=await specialistIdentity(database,request,"grant-subject",["product.delivery.read","evaluation.synthetic.run","engineering.sync.read"]);
  await specialistIdentity(database,request,"unbounded-subject",["design.docs.read"]);
  const past=new Date(Date.now()-60_000).toISOString();const future=new Date(Date.now()+60_000).toISOString();
  database.sqlite.prepare("UPDATE capability_grants SET expires_at=? WHERE user_id=? AND capability=?").run(past,"grant-subject","product.delivery.read");
  database.sqlite.prepare("UPDATE capability_grants SET expires_at=? WHERE user_id=? AND capability=?").run(future,"grant-subject","evaluation.synthetic.run");
  database.sqlite.prepare("UPDATE capability_grants SET status='revoked',revoked_at=? WHERE user_id=? AND capability=?").run(past,"grant-subject","engineering.sync.read");
  database.reset();const response=await request("/api/platform/access");assert.equal(response.status,200);assert.equal(database.writeCount(),0);
  const {grants}=await response.json();assert.deepEqual(grants.map((grant)=>`${grant.user_id}:${grant.capability}`).sort(),["grant-subject:evaluation.synthetic.run","unbounded-subject:design.docs.read"]);
  assert.equal(grants.find((grant)=>grant.user_id==="grant-subject")?.expires_at,future);
  const product=await request("/api/session?audience=product",{headers:subject});assert.equal(product.status,200);assert.deepEqual((await product.json()).capabilities,["evaluation.synthetic.run"]);
  assert.equal((await request("/api/session?audience=engineering",{headers:subject})).status,403);
});

test("customer workspace administration enforces verified invitations, exact project ACLs, private-content isolation, and immediate revocation",async()=>{
  const {database,environment,request}=await productionWorker();
  const ownerA=await specialistIdentity(database,request,"workspace-owner-a");
  const ownerB=await specialistIdentity(database,request,"workspace-owner-b");
  const collaborator=await specialistIdentity(database,request,"workspace-collaborator");
  const outsider=await specialistIdentity(database,request,"workspace-outsider");
  database.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id=?").run("workspace-collaborator");
  const json=(headers,body,method="POST")=>({method,headers:{...headers,"content-type":"application/json"},body:JSON.stringify(body)});
  for(const headers of [ownerA,ownerB])assert.equal((await request("/api/events?after=0&limit=2000&content=0",{headers})).status,200);

  const key="workspace-owner-a/generated/collaborative-slides.pdf",secretKey="workspace-owner-a/generated/private-orphan.pdf",referenceKey="workspace-owner-a/reference-existing.png";
  const media=new Map([[key,{ownerId:"workspace-owner-a"}],[secretKey,{ownerId:"workspace-owner-a"}],[referenceKey,{ownerId:"workspace-owner-a"}]]);
  environment.MEDIA={
    get:async(candidate)=>media.has(candidate)?{customMetadata:media.get(candidate),httpEtag:"test-media",writeHttpMetadata(headers){headers.set("content-type",candidate.endsWith(".png")?"image/png":"application/pdf");},body:new Blob([candidate===key?"shared artifact":candidate===secretKey?"PRIVATE ORPHAN":"reference image"]).stream()}:null,
    put:async(candidate,_value,options)=>{media.set(candidate,options.customMetadata);},
    delete:async(candidate)=>{media.delete(candidate);},
  };
  const stream="creative:workspace-owner-a";let sequence=Number(database.sqlite.prepare("SELECT MAX(sequence) AS value FROM events WHERE stream_id=?").get(stream).value);
  const now=new Date().toISOString(),expires=new Date(Date.now()+86_400_000).toISOString();
  const content=database.sqlite.prepare("INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at) VALUES(?,?,?,?,?,?,NULL)");
  content.run("shared-artifact-content","workspace-owner-a","document-artifact","PROJECT A SHARED RESULT",now,expires);
  content.run("secret-orphan-content","workspace-owner-a","document-artifact","PRIVATE ORPHAN CONTENT",now,expires);
  content.run("private-owner-prompt","workspace-owner-a","document-artifact-input","PRIVATE OWNER PROMPT",now,expires);
  const insertEvent=database.sqlite.prepare("INSERT INTO events(event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,causation_id,compensates_event_id,schema_version,type,payload) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)");
  const addOwnerEvent=(type,payload,actor="user")=>insertEvent.run(crypto.randomUUID(),stream,++sequence,now,now,actor,"server:test",crypto.randomUUID(),null,null,1,type,JSON.stringify(payload));
  addOwnerEvent("BlockCreated",{project_id:"project-atmosphere",document_id:"doc-atmosphere",block_id:"block-sensitive-removed",scope:"document",type:"direction",handle:"direction/confidential",properties:{text:"REMOVED DOCUMENT INLINE SECRET"}});
  addOwnerEvent("ContextCompiled",{project_id:"project-atmosphere",document_id:"doc-atmosphere",generation_id:"generation-shared",compiled_snapshot:{facts:[],standing_constraints:[{preference_id:"owner-private-preference",value:"OWNER ACCOUNT PRIVATE TASTE",source_event_refs:["private-account-event"]}]}});
  addOwnerEvent("DocumentRenderCompleted",{artifact_id:"shared-artifact",artifact_kind:"slides",document_id:"doc-atmosphere",title:"Shared result",content_ref:"shared-artifact-content",input_ref:"private-owner-prompt",media_url:`/api/media/${encodeURIComponent(key)}`,items:[{id:"slide-private-removed",title:"REMOVED DOCUMENT SLIDE TITLE",body:"REMOVED DOCUMENT SLIDE BODY",notes:"REMOVED DOCUMENT SPEAKER NOTES"}]},"worker:renderer");
  addOwnerEvent("ProjectCreated",{project_id:"project-secret",name:"Private project"});
  addOwnerEvent("DocumentCreated",{project_id:"project-secret",document_id:"doc-secret",title:"Private document"});
  addOwnerEvent("CollectionCreated",{project_id:"project-secret",collection_id:"foreign-collection",handle:"private-collection"});
  addOwnerEvent("DocumentRenderCompleted",{project_id:"project-secret",document_id:"missing-secret-doc",artifact_id:"secret-orphan",artifact_kind:"slides",title:"Private orphan",content_ref:"secret-orphan-content",media_url:`/api/media/${encodeURIComponent(secretKey)}`,items:[{media_url:`/api/media/${encodeURIComponent(secretKey)}`}]},"worker:renderer");
  addOwnerEvent("ReferenceIngested",{project_id:"project-atmosphere",reference_id:"reference-existing",source_type:"upload",source_ref:`/api/media/${encodeURIComponent(referenceKey)}`,content_hash:referenceKey,rights_class:"owned"});
  addOwnerEvent("BlockCreated",{project_id:"project-atmosphere",block_id:"block-reference-existing",scope:"library",type:"reference",handle:"reference/existing",properties:{reference_id:"reference-existing",media_url:`/api/media/${encodeURIComponent(referenceKey)}`}});

  const create=async(headers,name)=>{const response=await request("/api/workspaces",json(headers,{name}));assert.equal(response.status,201);return(await response.json()).organizationId;};
  const organizationA=await create(ownerA,"Organization A"),organizationB=await create(ownerB,"Organization B");
  const register=async(headers,organizationId)=>{const response=await request(`/api/workspaces/${organizationId}/projects`,json(headers,{projectId:"project-atmosphere"}));assert.equal(response.status,201);const project=await response.json();assert.ok(project.eventCount>0);return project.projectAccessId;};
  const projectA=await register(ownerA,organizationA),projectB=await register(ownerB,organizationB);
  assert.notEqual(projectA,projectB,"duplicate bare project IDs in different accounts require distinct opaque ACL IDs");
  assert.deepEqual(database.sqlite.prepare("SELECT resource_kind,resource_id FROM project_resource_scopes WHERE project_access_id=? AND resource_id IN(?,?,?)").all(projectA,"secret-orphan","secret-orphan-content",secretKey),[],"unknown-document assets can never enter another project manifest");

  database.sqlite.prepare("UPDATE users SET consent_version=NULL WHERE user_id=?").run("workspace-owner-a");
  for(const [path,options] of [["/api/workspaces",json(ownerA,{name:"Unconsented organization"})],[`/api/workspaces/${organizationA}/policy`,json(ownerA,{tokenLimit:100,microusdLimit:100},"PATCH")],[`/api/workspaces/${organizationA}/members/unavailable`,{method:"DELETE",headers:ownerA}]]){
    database.reset();assert.equal((await request(path,options)).status,428,path);assert.equal(database.writeCount(),0,"withdrawn consent blocks all customer-administration mutations before writes");
  }
  database.sqlite.prepare("UPDATE users SET consent_version=? WHERE user_id=?").run("pilot-2026-08-10","workspace-owner-a");

  database.reset();assert.equal((await request(`/api/workspaces/${organizationA}`,{headers:outsider})).status,403);assert.equal(database.writeCount(),0);
  database.reset();assert.equal((await request(`/api/workspaces/${organizationA}/projects/${projectA}/events`,{headers:ownerB})).status,403);assert.equal(database.writeCount(),0);
  const unknownInvite=await request(`/api/workspaces/${organizationA}/members`,json(ownerA,{email:"future-collaborator@example.test",role:"member"}));assert.equal(unknownInvite.status,201);const future=await unknownInvite.json();
  const pending=await(await request(`/api/workspaces/${organizationA}/members`,{headers:ownerA})).json();assert.ok(pending.invitations.some((item)=>item.invitation_id===future.invitationId));assert.doesNotMatch(JSON.stringify(pending),/token_hash|token=/);
  database.reset();assert.equal((await request(`/api/workspaces/${organizationA}/invitations/${future.invitationId}`,{method:"DELETE",headers:outsider})).status,403);assert.equal(database.writeCount(),0);
  assert.equal((await request(`/api/workspaces/${organizationA}/invitations/${future.invitationId}`,{method:"DELETE",headers:ownerA})).status,200);
  const futureIdentity=await specialistIdentity(database,request,"future-collaborator");database.reset();assert.equal((await request(`/api/workspaces/${organizationA}/invitations/${future.invitationId}/accept`,{method:"POST",headers:futureIdentity})).status,403);assert.equal(database.writeCount(),0);
  const invited=await request(`/api/workspaces/${organizationA}/members`,json(ownerA,{email:"workspace-collaborator@example.test",role:"member"}));assert.equal(invited.status,201);const invitation=await invited.json();assert.ok(invitation.invitationUrl.includes("token="));
  const inbox=await(await request("/api/workspaces",{headers:collaborator})).json();assert.equal(inbox.invitations.length,1);assert.equal(inbox.invitations[0].organization_id,organizationA);assert.deepEqual(inbox.projects,[]);
  database.reset();assert.equal((await request(`/api/workspaces/${organizationA}/invitations/${invitation.invitationId}/accept`,{method:"POST",headers:outsider})).status,403);assert.equal(database.writeCount(),0);
  database.reset();assert.equal((await request(`/api/workspaces/${organizationA}/invitations/${invitation.invitationId}/accept`,json(collaborator,{token:"forged-invitation-token"}))).status,403);assert.equal(database.writeCount(),0);
  const invitationToken=new URL(invitation.invitationUrl).searchParams.get("token");assert.equal((await request(`/api/workspaces/${organizationA}/invitations/${invitation.invitationId}/accept`,json(collaborator,{token:invitationToken}))).status,200);
  assert.equal((await request(`/api/workspaces/${organizationA}/invitations/${invitation.invitationId}/accept`,{method:"POST",headers:collaborator})).status,403,"invitations are consumed exactly once");
  assert.equal((await request(`/api/workspaces/${organizationA}/projects/${projectA}/context`,{method:"POST",headers:collaborator})).status,403,"accepted membership alone never grants project access");

  const granted=await request(`/api/workspaces/${organizationA}/projects/${projectA}/members`,json(ownerA,{userId:"workspace-collaborator",role:"viewer"}));assert.equal(granted.status,201);
  const opened=await request(`/api/workspaces/${organizationA}/projects/${projectA}/context`,{method:"POST",headers:collaborator});assert.equal(opened.status,200);
  const cookie=opened.headers.get("set-cookie")?.split(";")[0];assert.ok(cookie);
  let scoped={...collaborator,cookie};
  const session=await(await request("/api/session",{headers:scoped})).json();assert.equal(session.projectContext.projectAccessId,projectA);assert.equal(session.capabilities.includes("project.author"),false);
  assert.equal(session.costBudgets.workspace.limitMicrousd,session.costBudgets.user.limitMicrousd,"a project-only viewer never receives organization-wide financial totals");
  assert.match(session.permissionEpoch,/^[a-f0-9]{64}$/,"permission topology is reduced to an opaque fixed-length digest");
  assert.equal(session.canvas.access,false);assert.equal(session.projects.find((project)=>project.projectAccessId===projectA)?.projectName,"Studio launch");
  const ownerProjects=await(await request(`/api/workspaces/${organizationA}/projects`,{headers:ownerA})).json();assert.equal(ownerProjects.projects.find((project)=>project.project_access_id===projectA)?.project_name,"Studio launch");
  const response=await request("/api/events?after=0&limit=2000&content=1",{headers:scoped});assert.equal(response.status,200);const page=await response.json();
  assert.match(response.headers.get("cache-control")??"",/private,\s*no-store/);
  assert.doesNotMatch(JSON.stringify(page),/OWNER ACCOUNT PRIVATE TASTE|owner-private-preference|private-account-event/,"account-global taste and its evidence never leak into a shared project snapshot");
  assert.ok(page.events.length>0);assert.ok(page.events.every((event)=>event.streamId===`project:${projectA}`));assert.deepEqual(page.events.map((event)=>event.sequence),Array.from({length:page.events.length},(_,index)=>index+1));
  assert.equal(page.content["shared-artifact-content"],"PROJECT A SHARED RESULT");assert.equal(page.content["private-owner-prompt"],undefined);assert.equal(page.content["secret-orphan-content"],undefined);assert.doesNotMatch(JSON.stringify(page),/PRIVATE OWNER PROMPT|PRIVATE ORPHAN|secret-orphan|creative:workspace-owner-a|"input_ref"/);
  assert.equal((await request(`/api/media/${encodeURIComponent(key)}`,{headers:scoped})).status,200);
  assert.equal((await request(`/api/media/${encodeURIComponent(referenceKey)}`,{headers:scoped})).status,200,"existing owner references remain available inside their exact shared project");
  assert.equal((await request(`/api/media/${encodeURIComponent(secretKey)}`,{headers:scoped})).status,403);
  assert.equal((await request(`/api/workspaces/${organizationB}/projects/${projectB}/events`,{headers:scoped})).status,403);
  for(const path of ["/api/document-jobs","/api/shares"]){database.reset();assert.equal((await request(path,{headers:scoped})).status,403,path);assert.equal(database.writeCount(),0,path);}
  database.reset();assert.equal((await request("/api/generation-readiness",json(scoped,{documentId:"doc-atmosphere"}))).status,403);assert.equal(database.writeCount(),0);
  for(const path of ["/api/generation-readiness/provider/refresh","/api/generation-readiness/prompt-techniques"]){
    database.reset();assert.equal((await request(path,json(scoped,{documentId:"doc-atmosphere"}))).status,403,path);
    assert.equal(database.writeCount(),0,"selected project access never mutates global provider readiness through an unscoped subroute");
  }
  database.reset();assert.equal((await request("/api/events",json(scoped,{action:"append",event:{type:"BlockPropertyEdited",payload:{block_id:"block-direction",property_path:"text",new_value:"viewer attempt"}}}))).status,403);assert.equal(database.writeCount(),0);

  const membershipId=database.sqlite.prepare("SELECT membership_id FROM project_memberships WHERE project_access_id=? AND user_id=?").get(projectA,"workspace-collaborator").membership_id;
  assert.equal((await request(`/api/workspaces/${organizationA}/projects/${projectA}/members/${membershipId}`,json(ownerA,{role:"editor"},"PATCH"))).status,200);
  database.sqlite.prepare("UPDATE users SET consent_version=NULL WHERE user_id=?").run("workspace-collaborator");
  const withdrawn={action:"append",event:{type:"BlockPropertyEdited",payload:{block_id:"block-direction",property_path:"text",new_value:"WITHDRAWN CONSENT"}}};
  for(const path of ["/api/events",`/api/workspaces/${organizationA}/projects/${projectA}/events`]){
    database.reset();assert.equal((await request(path,json(scoped,withdrawn))).status,428,path);assert.equal(database.writeCount(),0,"direct workspace aliases cannot bypass current collaborator consent");
  }
  database.sqlite.prepare("UPDATE users SET consent_version=? WHERE user_id=?").run("pilot-2026-08-10","workspace-collaborator");
  const alternateProject=await request(`/api/workspaces/${organizationA}/projects`,json(ownerA,{projectId:"project-secret"}));assert.equal(alternateProject.status,201);const alternateProjectId=(await alternateProject.json()).projectAccessId;
  assert.equal((await request(`/api/workspaces/${organizationA}/projects/${alternateProjectId}/members`,json(ownerA,{userId:"workspace-collaborator",role:"editor"}))).status,201);
  for(const [path,options] of [[`/api/workspaces/${organizationA}/projects/${alternateProjectId}/events`,{headers:scoped}],[`/api/workspaces/${organizationA}/projects/${alternateProjectId}/events`,json(scoped,withdrawn)]]){
    database.reset();assert.equal((await request(path,options)).status,403,"an active project-A cookie cannot be used as a confused deputy for separately granted project B");assert.equal(database.writeCount(),0);
  }
  const edit=await request("/api/events",json(scoped,{action:"append",event:{type:"BlockPropertyEdited",payload:{block_id:"block-direction",property_path:"text",new_value:"AUTHORIZED COLLABORATIVE EDIT"}}}));assert.equal(edit.status,200);const receipt=await edit.json();assert.equal(receipt.appended[0].actor,"user:workspace-collaborator");
  assert.equal(database.sqlite.prepare("SELECT actor FROM events WHERE json_extract(payload,'$.new_value')=?").get("AUTHORIZED COLLABORATIVE EDIT").actor,"user:workspace-collaborator");
  database.reset();assert.equal((await request("/api/events",json(scoped,{action:"append",event:{type:"BlockPropertyEdited",payload:{block_id:"foreign-block",property_path:"text",new_value:"forbidden"}}}))).status,403);assert.equal(database.writeCount(),0);
  for(const event of [
    {type:"EmptyCanvasChosen",payload:{}},
    {type:"BlockPropertyEdited",payload:{block_id:"block-direction",property_path:"media_url",new_value:`/api/media/${encodeURIComponent(secretKey)}`}},
    {type:"ChipEdited",payload:{block_id:"block-direction",property:"media_url",new_value:`/api/media/${encodeURIComponent(secretKey)}`}},
    {type:"BlockPropertyEdited",payload:{block_id:"block-direction",property_path:"reference_id",new_value:"foreign-reference"}},
    {type:"DocumentRenamed",payload:{new_title:"Hijack the owner’s active private document"}},
    {type:"DocumentCreated",payload:{document_id:"doc-secret",title:"Duplicate private identifier"}},
    {type:"CollectionCreated",payload:{collection_id:"evil-child",handle:"Child",parent_collection_id:"foreign-collection"}},
    {type:"CollectionItemAdded",payload:{collection_id:"collection-studio",item_ref:{collection_id:"foreign-collection"}}},
    {type:"CollectionItemMoved",payload:{from_collection_id:"collection-studio",to_collection_id:"collection-client",item_ref:{collection_id:"foreign-collection"}}},
    {type:"CollectionItemAdded",payload:{collection_id:"collection-studio",item_ref:{document_id:"doc-atmosphere",collection_id:"foreign-collection"}}},
  ]){database.reset();assert.equal((await request("/api/events",json(scoped,{action:"append",event}))).status,403,event.type);assert.equal(database.writeCount(),0,event.type);}
  const events=[
    {type:"DocumentCreated",payload:{document_id:"doc-collaborative-batch",title:"Collaborative draft"}},
    {type:"BlockCreated",payload:{document_id:"doc-collaborative-batch",block_id:"block-collaborative-a",scope:"document",type:"direction",handle:"direction/a",properties:{text:"first"}}},
    {type:"BlockCreated",payload:{document_id:"doc-collaborative-batch",block_id:"block-collaborative-b",scope:"document",type:"direction",handle:"direction/b",properties:{text:"second"}}},
    {type:"BlockPropertyEdited",payload:{block_id:"block-collaborative-a",property_path:"text",new_value:"ready"}},
    {type:"CollectionCreated",payload:{collection_id:"collection-collaborative",handle:"collaborative",parent_collection_id:"collection-studio"}},
    {type:"CollectionItemAdded",payload:{collection_id:"collection-collaborative",item_ref:{document_id:"doc-collaborative-batch"}}},
    {type:"BlockRelationAdded",payload:{document_id:"doc-collaborative-batch",relation_id:"relation-collaborative",from_block_id:"block-collaborative-a",to_block_id:"block-collaborative-b",kind:"related"}},
  ];
  const batched=await request("/api/events",json(scoped,{action:"batch",events}));assert.equal(batched.status,200,JSON.stringify(await batched.clone().json()));const batchReceipt=await batched.json();assert.equal(batchReceipt.appended.length,events.length);assert.ok(batchReceipt.appended.every((event)=>event.actor==="user:workspace-collaborator"));
  assert.deepEqual(database.sqlite.prepare("SELECT resource_kind,resource_id FROM project_resource_scopes WHERE project_access_id=? AND resource_id IN(?,?,?,?) ORDER BY resource_kind,resource_id").all(projectA,"doc-collaborative-batch","block-collaborative-a","collection-collaborative","relation-collaborative").map((row)=>({...row})),[{resource_kind:"block",resource_id:"block-collaborative-a"},{resource_kind:"collection",resource_id:"collection-collaborative"},{resource_kind:"document",resource_id:"doc-collaborative-batch"},{resource_kind:"relation",resource_id:"relation-collaborative"}]);
  database.reset();const poisoned=[{type:"DocumentCreated",payload:{document_id:"doc-poisoned",title:"Poisoned"}},{type:"CollectionItemAdded",payload:{collection_id:"collection-studio",item_ref:{collection_id:"foreign-collection"}}}];assert.equal((await request("/api/events",json(scoped,{action:"batch",events:poisoned}))).status,403);assert.equal(database.writeCount(),0);assert.equal(database.sqlite.prepare("SELECT 1 FROM project_resource_scopes WHERE resource_id='doc-poisoned'").get(),undefined);

  const uploadForm=new FormData();uploadForm.set("file",new File(["reference"],"collaborative-reference.png",{type:"image/png"}));uploadForm.set("rightsConfirmed","true");
  const upload=await request("/api/media",{method:"POST",headers:scoped,body:uploadForm});assert.equal(upload.status,200);const uploaded=await upload.json();
  const referenceEvents=[
    {type:"ReferenceIngested",payload:{reference_id:"reference-collaborative",source_type:"upload",source_ref:uploaded.url,content_hash:uploaded.key,rights_class:"asserted"}},
    {type:"RightsAsserted",payload:{reference_id:"reference-collaborative",rights_class:"owned_or_licensed",assertion_method:"explicit-confirmation"}},
    {type:"BlockCreated",payload:{block_id:"block-reference-collaborative",scope:"library",type:"reference",handle:"reference/collaborative",properties:{reference_id:"reference-collaborative",media_url:uploaded.url}}},
  ];
  const referenceBatch=await request("/api/events",json(scoped,{action:"batch",events:referenceEvents}));assert.equal(referenceBatch.status,200,JSON.stringify(await referenceBatch.clone().json()));
  assert.ok(database.sqlite.prepare("SELECT source_event_id FROM project_resource_scopes WHERE project_access_id=? AND resource_kind='media' AND resource_id=?").get(projectA,uploaded.key).source_event_id);
  assert.equal((await request(`/api/media/${encodeURIComponent(uploaded.key)}`,{headers:scoped})).status,200);
  const removal=await request("/api/events",json(scoped,{action:"append",event:{type:"BlockRemoved",payload:{block_id:"block-reference-collaborative"}}}));assert.equal(removal.status,200);
  assert.equal((await request(`/api/media/${encodeURIComponent(uploaded.key)}`,{headers:scoped})).status,403,"removing a shared reference revokes its attached media immediately");
  const removedDocument=await request("/api/events",json(scoped,{action:"append",event:{type:"DocumentRemoved",payload:{document_id:"doc-atmosphere",title:"REMOVED DOCUMENT CONFIDENTIAL TITLE"}}}));assert.equal(removedDocument.status,200);
  assert.equal((await request(`/api/media/${encodeURIComponent(key)}`,{headers:scoped})).status,403,"document removal revokes generated-media access immediately");
  const removedPage=await(await request("/api/events?after=0&limit=2000&content=1",{headers:scoped})).json();assert.ok(removedPage.events.some((event)=>event.type==="DocumentRemoved"&&event.payload.document_id==="doc-atmosphere"));assert.equal(removedPage.content["shared-artifact-content"],undefined);assert.doesNotMatch(JSON.stringify(removedPage),/REMOVED DOCUMENT INLINE SECRET|REMOVED DOCUMENT SLIDE TITLE|REMOVED DOCUMENT SLIDE BODY|REMOVED DOCUMENT SPEAKER NOTES|REMOVED DOCUMENT CONFIDENTIAL TITLE|shared-artifact-content|collaborative-slides\.pdf/,"historical project events are tombstoned immediately when their document is removed");

  const exit=await request("/api/workspaces/context",{method:"DELETE",headers:scoped});assert.equal(exit.status,200);assert.match(exit.headers.get("set-cookie")??"",/Max-Age=0/);assert.equal((await(await request("/api/session",{headers:collaborator})).json()).projectContext,undefined);
  const reopened=await request(`/api/workspaces/${organizationA}/projects/${projectA}/context`,{method:"POST",headers:collaborator});assert.equal(reopened.status,200);scoped={...collaborator,cookie:reopened.headers.get("set-cookie")?.split(";")[0]??""};

  assert.equal((await request(`/api/workspaces/${organizationA}/projects/${projectA}/members/${membershipId}`,{method:"DELETE",headers:ownerA})).status,200);
  assert.equal((await request("/api/events?after=0&content=1",{headers:scoped})).status,403);
  assert.equal((await request(`/api/media/${encodeURIComponent(key)}`,{headers:scoped})).status,403);
  assert.equal((await request(`/api/workspaces/${organizationA}/projects/${projectA}/members`,json(ownerA,{userId:"workspace-collaborator",role:"viewer"}))).status,201,"revoked project members can be safely regranted");

  const organizationMember=database.sqlite.prepare("SELECT membership_id FROM organization_memberships WHERE organization_id=? AND user_id=?").get(organizationA,"workspace-collaborator").membership_id;
  assert.equal((await request(`/api/workspaces/${organizationA}/members/${organizationMember}`,{method:"DELETE",headers:ownerA})).status,200);
  assert.equal((await request(`/api/workspaces/${organizationA}/projects/${projectA}/events`,{headers:collaborator})).status,403);
  const reinvited=await request(`/api/workspaces/${organizationA}/members`,json(ownerA,{email:"workspace-collaborator@example.test",role:"member"}));assert.equal(reinvited.status,201);const fresh=await reinvited.json();assert.notEqual(fresh.invitationId,invitation.invitationId);
  assert.equal((await request(`/api/workspaces/${organizationA}/invitations/${invitation.invitationId}/accept`,{method:"POST",headers:collaborator})).status,403);
  assert.equal((await request(`/api/workspaces/${organizationA}/invitations/${fresh.invitationId}/accept`,{method:"POST",headers:collaborator})).status,200);
  assert.deepEqual((await(await request("/api/workspaces",{headers:collaborator})).json()).projects,[],"reinvitation never resurrects prior project access");
});

test("shared Canvas permissions, actor-isolated outputs, removal, restoration, and long-history receipts stay tenant-safe",async()=>{
  const {database,environment,request,drainBackground}=await productionWorker();
  htmlAssets(environment);
  const owner=await specialistIdentity(database,request,"canvas-project-owner");
  const collaborator=await specialistIdentity(database,request,"canvas-project-editor",["product.analytics.read"]);
  const teammate=await specialistIdentity(database,request,"canvas-project-teammate");
  database.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id=?").run("canvas-project-editor");
  database.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id=?").run("canvas-project-teammate");
  assert.equal((await request("/api/events?after=0&limit=1000&content=0",{headers:owner})).status,200);
  const stream="creative:canvas-project-owner",timestamp=new Date().toISOString();
  let ownerSequence=Number(database.sqlite.prepare("SELECT MAX(sequence) AS head FROM events WHERE stream_id=?").get(stream).head);
  const insertEvent=database.sqlite.prepare("INSERT INTO events(event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,causation_id,compensates_event_id,schema_version,type,payload) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)");
  const append=(type,payload)=>{const id=crypto.randomUUID();insertEvent.run(id,stream,++ownerSequence,timestamp,timestamp,"user","server:canvas-test",crypto.randomUUID(),null,null,1,type,JSON.stringify(payload));return id;};
  append("GenerationCompleted",{project_id:"project-atmosphere",document_id:"doc-atmosphere",generation_id:"shared-generation",object_ids:["shared-output"],quality:"high"});
  append("DocumentRenderCompleted",{project_id:"project-atmosphere",document_id:"doc-atmosphere",artifact_id:"shared-artifact",artifact_kind:"short_story",title:"Shared story",summary:"Approved shared output",item_count:1,items:[]});
  append("CanvasCreated",{project_id:"project-atmosphere",canvas_id:"shared-board",name:"Shared board",slug:"shared-board"});
  append("CanvasItemPlaced",{project_id:"project-atmosphere",canvas_id:"shared-board",item_id:"shared-item",source_kind:"document",source_id:"doc-atmosphere",title:"PRIVATE BOARD CARD TITLE",frame:{x:10,y:20,w:320,h:220,z:"a1"}});
  append("ProjectCreated",{project_id:"private-project",name:"Private project"});
  append("DocumentCreated",{project_id:"private-project",document_id:"private-document",title:"Private document"});
  append("ReferenceIngested",{project_id:"private-project",document_id:"private-document",reference_id:"private-reference",source_type:"upload",source_ref:"private://reference",content_hash:"private-reference",rights_class:"owned"});
  append("BlockCreated",{project_id:"private-project",document_id:"private-document",block_id:"private-reference-block",type:"reference",handle:"reference/private",properties:{reference_id:"private-reference",label:"Private reference"},position:"z1"});
  append("CanvasCreated",{project_id:"private-project",canvas_id:"private-board",name:"Private board"});
  append("CanvasItemPlaced",{project_id:"private-project",canvas_id:"private-board",item_id:"private-item",source_kind:"document",source_id:"private-document",title:"PRIVATE PROJECT CARD",frame:{x:10,y:20,w:320,h:220,z:"a1"}});
  append("CanvasArrangementCreated",{project_id:"private-project",canvas_id:"private-board",arrangement_id:"private-arrangement",kind:"row",item_ids:["private-item"],frames:[{item_id:"private-item",x:1,y:1,w:100,h:100}]});
  append("ContextSetFormalized",{project_id:"private-project",canvas_id:"private-board",context_set_id:"private-context",item_ids:["private-item"],name:"Private context"});
  const json=(headers,body,method="POST")=>({method,headers:{...headers,"content-type":"application/json"},body:JSON.stringify(body)});
  const legacyCreation=await request("/api/shares",json(owner,{resourceKind:"document",documentId:"doc-atmosphere",projectId:"project-atmosphere"}));assert.equal(legacyCreation.status,200);const legacyShare=(await legacyCreation.json()).share;
  assert.equal((await request(`/api/shared/${encodeURIComponent(legacyShare.token)}`)).status,200,"personal review links work until their project enters tenant custody");
  const created=await request("/api/workspaces",json(owner,{name:"Canvas collaboration organization"}));assert.equal(created.status,201);const organizationId=(await created.json()).organizationId;
  const registration=await request(`/api/workspaces/${organizationId}/projects`,json(owner,{projectId:"project-atmosphere"}));assert.equal(registration.status,201);const projectAccessId=(await registration.json()).projectAccessId;
  assert.equal((await request(`/api/shared/${encodeURIComponent(legacyShare.token)}`)).status,404,"legacy personal review links close immediately when a project enters an organization");
  database.reset();assert.equal((await request("/api/shares",json(owner,{resourceKind:"document",documentId:"doc-atmosphere",projectId:"project-atmosphere"}))).status,403);assert.equal(database.writeCount(),0,"registered projects cannot create an unscoped owner review link");
  const invitation=await(await request(`/api/workspaces/${organizationId}/members`,json(owner,{email:"canvas-project-editor@example.test",role:"member"}))).json();
  assert.equal((await request(`/api/workspaces/${organizationId}/invitations/${invitation.invitationId}/accept`,json(collaborator,{token:new URL(invitation.invitationUrl).searchParams.get("token")}))).status,200);
  assert.equal((await request(`/api/workspaces/${organizationId}/projects/${projectAccessId}/members`,json(owner,{userId:"canvas-project-editor",role:"viewer"}))).status,201);
  const teammateInvite=await(await request(`/api/workspaces/${organizationId}/members`,json(owner,{email:"canvas-project-teammate@example.test",role:"member"}))).json();
  assert.equal((await request(`/api/workspaces/${organizationId}/invitations/${teammateInvite.invitationId}/accept`,json(teammate,{token:new URL(teammateInvite.invitationUrl).searchParams.get("token")}))).status,200);
  assert.equal((await request(`/api/workspaces/${organizationId}/projects/${projectAccessId}/members`,json(owner,{userId:"canvas-project-teammate",role:"editor"}))).status,201);
  const membershipId=database.sqlite.prepare("SELECT membership_id FROM project_memberships WHERE project_access_id=? AND user_id=?").get(projectAccessId,"canvas-project-editor").membership_id;
  const teammateMembershipId=database.sqlite.prepare("SELECT membership_id FROM project_memberships WHERE project_access_id=? AND user_id=?").get(projectAccessId,"canvas-project-teammate").membership_id;
  const evidence=IMAGE_ADAPTER_V52_EVALUATION_EVIDENCE;
  const approval=database.sqlite.prepare("INSERT INTO canvas_governance_requirements(requirement_id,status,evidence_ref,details_json,updated_at) VALUES(?,?,?,?,?)");
  approval.run("trust_safety","approved","review/trust-safety","{}",timestamp);
  approval.run("counsel","approved","review/counsel","{}",timestamp);
  approval.run("second_image_adapter","approved",evidence.evaluationRef,JSON.stringify({adapter_id:evidence.adapterId,contract_version:evidence.adapterVersion,corpus_version:evidence.corpusVersion,evaluation_ref:evidence.evaluationRef,evaluation_passed:true}),timestamp);
  const open=async(identity=collaborator)=>{const response=await request(`/api/workspaces/${organizationId}/projects/${projectAccessId}/context`,{method:"POST",headers:identity});assert.equal(response.status,200);return{...identity,cookie:response.headers.get("set-cookie")?.split(";")[0]??""};};
  let scoped=await open();
  assert.equal((await request("/canvas",{headers:scoped})).status,403,"project membership never silently grants Canvas");
  const restricted=await(await request("/api/events?after=0&limit=5000&content=0",{headers:scoped})).json();
  assert.ok(restricted.events.some((event)=>event.type==="ProjectResourceRestricted"));
  const permissionPath=`/api/workspaces/${organizationId}/projects/${projectAccessId}/members/${membershipId}`;
  assert.equal((await request(permissionPath,json(owner,{canvasAccess:true},"PATCH"))).status,200);
  database.sqlite.prepare("INSERT INTO capability_grants(grant_id,user_id,capability,scope_type,organization_id,project_access_id,project_id,status,granted_by_user_id,created_at,updated_at,expires_at,revoked_at) VALUES(?,?,?,'project',?,?,?,'active',?,?,?,NULL,NULL)")
    .run(crypto.randomUUID(),"canvas-project-editor","project.output.request",organizationId,projectAccessId,"project-atmosphere","canvas-project-owner",timestamp,timestamp);
  const viewerSession=await(await request("/api/session",{headers:scoped})).json();assert.equal(viewerSession.canvas.access,true);assert.equal(viewerSession.projectContext.permissions.includes("project.canvas.use"),true);
  assert.equal(viewerSession.projectContext.permissions.includes("project.output.request"),false,"viewer membership remains a hard ceiling even after a separately supplied output grant");
  for(const path of ["/api/generation-readiness","/api/document-jobs"]){database.reset();assert.equal((await request(path,{method:path==="/api/generation-readiness"?"POST":"GET",headers:scoped})).status,403);assert.equal(database.writeCount(),0,"an explicit output grant cannot elevate a project viewer");}
  assert.equal((await request("/canvas",{headers:scoped})).status,200);
  const visible=await(await request("/api/events?after=0&limit=5000&content=0",{headers:scoped})).json();assert.ok(visible.events.some((event)=>event.type==="CanvasCreated"&&event.payload.canvas_id==="shared-board"));assert.doesNotMatch(JSON.stringify(visible),/PRIVATE PROJECT CARD|private-board|private-item/);
  for(const event of [{type:"ObjectExported",payload:{object_id:"shared-output",destination_class:"download",format:"image/png"}},{type:"DocumentArtifactExported",payload:{artifact_id:"shared-artifact",document_id:"doc-atmosphere",format:"markdown"}}]){
    const exported=await request("/api/events",json(scoped,{action:"append",event}));const receipt=await exported.json();assert.equal(exported.status,200,JSON.stringify(receipt));assert.equal(receipt.appended[0].actor,"user:canvas-project-editor","viewer downloads retain an actor-attributed project audit receipt");
  }
  database.reset();assert.equal((await request("/api/events",json(scoped,{action:"append",event:{type:"DocumentArtifactExported",payload:{artifact_id:"private-artifact",document_id:"doc-atmosphere"}}}))).status,403);assert.equal(database.writeCount(),0,"viewer export receipts cannot reference another project");
  const makeEvent=(type,payload,id=crypto.randomUUID())=>({type,payload:{project_id:"project-atmosphere",canvas_id:"shared-board",history_owner_id:"canvas-project-editor",client_event_id:id,...payload}});
  const register=makeEvent("CanvasRegisterSet",{item_id:"shared-item",operation:{object:{item_id:"shared-item"},prop:"x",value:120,hlc:{pt:Date.now(),c:0,site:"canvas-project-editor:device"}}},"first-collaborative-receipt");
  database.reset();assert.equal((await request("/api/events",json(scoped,{action:"canvas_sync",events:[register]}))).status,403);assert.equal(database.writeCount(),0,"Canvas viewers cannot mutate a board");
  database.reset();assert.equal((await request("/api/document-jobs",{headers:scoped})).status,403);assert.equal(database.writeCount(),0,"project viewers cannot inspect another actor's output jobs");
  assert.equal((await request("/api/portfolio/product/insights",{headers:collaborator})).status,200,"the collaborator has real principal reporting access outside the selected project");
  database.sqlite.prepare("UPDATE users SET role='admin' WHERE user_id=?").run("canvas-project-editor");
  assert.equal((await request("/api/analytics",{headers:collaborator})).status,200,"an authorized principal can use account analytics outside the selected project");
  await drainBackground();
  for(const path of ["/api/analytics","/api/portfolio/product/insights"]){database.reset();assert.equal((await request(path,{headers:scoped})).status,403,`selected projects never open account-wide reporting: ${path}`);assert.equal(database.writeCount(),0);}
  database.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id=?").run("canvas-project-editor");
  assert.equal((await request(permissionPath,json(owner,{role:"editor"},"PATCH"))).status,200);
  const first=await request("/api/events",json(scoped,{action:"canvas_sync",events:[register]}));const firstBody=await first.json();assert.equal(first.status,200,JSON.stringify(firstBody));assert.equal(firstBody.appended.length,1);assert.equal(firstBody.appended[0].actor,"user:canvas-project-editor");
  const firstEventId=firstBody.appended[0].eventId;
  assert.equal(database.sqlite.prepare("SELECT actor FROM events WHERE event_id=?").get(firstEventId).actor,"user:canvas-project-editor");
  assert.equal(database.sqlite.prepare("SELECT actor_user_id FROM project_event_scopes WHERE event_id=?").get(firstEventId).actor_user_id,"canvas-project-editor");
  const undoRegister={...makeEvent("CanvasRegisterSet",{item_id:"shared-item",previous_value:120,operation:{object:{item_id:"shared-item"},prop:"x",value:10,hlc:{pt:Date.now()+1,c:0,site:"canvas-project-editor:undo:web:lit"}}}),compensatesEventId:firstEventId};
  const undone=await request("/api/events",json(scoped,{action:"canvas_sync",events:[undoRegister]}));assert.equal(undone.status,200,JSON.stringify(await undone.clone().json()));
  const redoRegister=makeEvent("CanvasRegisterSet",{item_id:"shared-item",previous_value:10,operation:{object:{item_id:"shared-item"},prop:"x",value:120,hlc:{pt:Date.now()+2,c:0,site:"canvas-project-editor:redo:web:lit"}}});
  const redone=await request("/api/events",json(scoped,{action:"canvas_sync",events:[redoRegister]}));assert.equal(redone.status,200,JSON.stringify(await redone.clone().json()));
  for(const event of [
    makeEvent("CanvasRegisterSet",{canvas_id:"private-board",item_id:"private-item",operation:{object:{item_id:"private-item"},prop:"x",value:1,hlc:{pt:Date.now(),c:0,site:"canvas-project-editor:device"}}}),
    makeEvent("CanvasRegisterSet",{item_id:"private-item",operation:{object:{item_id:"private-item"},prop:"x",value:1,hlc:{pt:Date.now(),c:0,site:"canvas-project-editor:device"}}}),
    makeEvent("CanvasRegisterSet",{item_id:"shared-item",operation:{object:{item_id:"shared-item"},prop:"x",value:1,hlc:{pt:Date.now(),c:0,site:"another-person:device"}}}),
    makeEvent("CanvasItemPlaced",{item_id:"private-item",source_kind:"document",source_id:"doc-atmosphere",frame:{x:1,y:1,w:120,h:120}}),
    makeEvent("CanvasArrangementCreated",{arrangement_id:"private-arrangement",kind:"row",item_ids:["shared-item"],frames:[{item_id:"shared-item",x:1,y:1,w:120,h:120}]}),
    makeEvent("ContextSetFormalized",{context_set_id:"private-context",name:"Override",item_ids:["shared-item"]}),
  ]){database.reset();const rejected=await request("/api/events",json(scoped,{action:"canvas_sync",events:[event]}));assert.equal(rejected.status,403,`${event.type}: ${JSON.stringify(await rejected.json())}`);assert.equal(database.writeCount(),0,`${event.type} cannot alter owner-private resources`);}
  const extraction={kind:"extract_reference",documentId:"doc-atmosphere",sourceSurface:"document",payload:{blockId:"block-reference",referenceId:"ref-window-light",sample:EXTRACTOR_EVAL_FIXTURES[0].sample}};
  for(const forged of [{blockId:"private-reference-block",referenceId:"private-reference"},{blockId:"block-reference",referenceId:"private-reference"},{blockId:"block-direction",referenceId:"ref-window-light"}]){
    database.reset();const rejected=await request("/api/document-jobs",json(scoped,{...extraction,payload:{...extraction.payload,...forged}}));assert.equal(rejected.status,403,JSON.stringify(await rejected.json()));assert.equal(database.writeCount(),0,"scoped extraction cannot alter another project or a mismatched reference");
  }
  const queued=await request("/api/document-jobs",json(scoped,extraction));const queuedBody=await queued.json();assert.equal(queued.status,202,JSON.stringify(queuedBody));
  assert.equal(database.sqlite.prepare("SELECT owner_id,stream_id FROM document_jobs WHERE job_id=?").get(queuedBody.job.jobId).owner_id,"canvas-project-editor");
  assert.deepEqual({...database.sqlite.prepare("SELECT owner_user_id,actor_user_id,visibility FROM project_resource_scopes WHERE resource_kind='job' AND resource_id=?").get(queuedBody.job.jobId)},{owner_user_id:"canvas-project-owner",actor_user_id:"canvas-project-editor",visibility:"actor_private"});
  const provenance=database.sqlite.prepare("SELECT event.actor,event.type,event.payload FROM project_resource_scopes resource JOIN events event ON event.event_id=resource.source_event_id WHERE resource.resource_kind='job' AND resource.resource_id=?").get(queuedBody.job.jobId);
  assert.equal(provenance.actor,"user:canvas-project-editor");assert.equal(provenance.type,"ProjectDocumentJobQueued");assert.deepEqual(JSON.parse(provenance.payload),{job_id:queuedBody.job.jobId,document_id:"doc-atmosphere",kind:"extract_reference",organization_id:organizationId,project_access_id:projectAccessId,project_id:"project-atmosphere",history_owner_user_id:"canvas-project-owner",actor_user_id:"canvas-project-editor"});
  await drainBackground();
  database.reset();assert.equal((await request(`/api/document-jobs/${queuedBody.job.jobId}`,{headers:collaborator})).status,404);assert.equal(database.writeCount(),0,"removing project context cannot expose an actor's tenant-owned job");
  database.sqlite.prepare("UPDATE users SET role='creator' WHERE user_id=?").run("canvas-project-editor");
  for(const action of ["ack","dismiss","cancel","retry","run"]){database.reset();assert.equal((await request(`/api/document-jobs/${queuedBody.job.jobId}/${action}`,{method:"POST",headers:collaborator})).status,404,action);assert.equal(database.writeCount(),0,`personal ${action} cannot alter an exact project job`);}
  database.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id=?").run("canvas-project-editor");
  database.reset();const jobList=await request("/api/document-jobs",{headers:scoped});assert.equal(jobList.status,200);assert.equal(database.writeCount(),0,"shared status polling is read-only");assert.ok((await jobList.json()).jobs.some((job)=>job.jobId===queuedBody.job.jobId));
  assert.equal((await request(`/api/document-jobs/${queuedBody.job.jobId}`,{headers:owner})).status,404,"the owner's private job list never exposes collaborator inputs");
  const completed=await(await request(`/api/document-jobs/${queuedBody.job.jobId}`,{headers:scoped})).json();assert.equal(completed.job.status,"completed",JSON.stringify(completed));
  const teammateScope=await open(teammate);
  const ownerScope=await open(owner);
  for(const identity of [scoped,teammateScope]){database.reset();assert.equal((await request("/api/shares",{headers:identity})).status,403);assert.equal(database.writeCount(),0,"review links remain exclusive to the exact project owner");}
  const share=await request("/api/shares",json(ownerScope,{resourceKind:"document",documentId:"doc-atmosphere",projectId:"project-atmosphere"}));const shared=await share.json();assert.equal(share.status,200,JSON.stringify(shared));
  assert.equal(database.sqlite.prepare("SELECT organization_id,project_access_id,owner_user_id,actor_user_id FROM project_resource_scopes WHERE resource_kind='share' AND resource_id=?").get(shared.share.shareId).organization_id,organizationId);
  assert.equal((await request(`/api/shared/${encodeURIComponent(shared.share.token)}`)).status,200,"the owner can issue an exact-project read-only review link");
  assert.equal((await request("/api/shares",json(ownerScope,{resourceKind:"document",documentId:"private-document",projectId:"private-project"}))).status,404);
  const scopedShares=await(await request("/api/shares",{headers:ownerScope})).json();assert.ok(scopedShares.shares.some((item)=>item.shareId===shared.share.shareId));
  const ownerHeadBeforePrivacy=Number(database.sqlite.prepare("SELECT MAX(sequence) AS head FROM events WHERE stream_id=?").get(stream).head);
  const forgotten=await request("/api/privacy/attention",{method:"POST",headers:scoped});assert.equal(forgotten.status,200,JSON.stringify(await forgotten.clone().json()));
  assert.equal(Number(database.sqlite.prepare("SELECT MAX(sequence) AS head FROM events WHERE stream_id=?").get(stream).head),ownerHeadBeforePrivacy,"personal privacy controls never alter the shared owner's history");
  assert.equal(database.sqlite.prepare("SELECT type FROM events WHERE stream_id=? ORDER BY sequence DESC LIMIT 1").get("creative:canvas-project-editor").type,"AttentionSignalsForgotten");
  assert.equal((await request("/api/session",{headers:scoped})).status,200,"all exact personal, organization, and platform budget rows are initialized");
  const readBudget=(table,column,scope,id)=>Number(database.sqlite.prepare(`SELECT ${column} AS amount FROM ${table} WHERE scope=? AND scope_id=?`).get(scope,id)?.amount??0);
  const baseline={actorTokens:readBudget("budget_counters","used_tokens","user","canvas-project-editor"),ownerTokens:readBudget("budget_counters","used_tokens","user","canvas-project-owner"),organizationTokens:readBudget("budget_counters","used_tokens","workspace",organizationId),platformTokens:readBudget("budget_counters","used_tokens","workspace","forma"),actorCost:readBudget("cost_budget_counters","used_microusd","user","canvas-project-editor"),ownerCost:readBudget("cost_budget_counters","used_microusd","user","canvas-project-owner"),organizationCost:readBudget("cost_budget_counters","used_microusd","workspace",organizationId),platformCost:readBudget("cost_budget_counters","used_microusd","workspace","forma")};
  assert.equal((await request("/api/events?after=0&limit=5000&content=0",{headers:scoped})).status,200,"existing owner history is indexed before testing read-only budget admission");
  const previousFetch=globalThis.fetch;environment.OPENAI_API_KEY="local-mocked-provider-only";let providerCalls=0;
  try{
    globalThis.fetch=async(input)=>{providerCalls+=1;assert.equal(String(input),"https://api.openai.com/v1/responses");return Response.json({id:"response-private-collaborator-chat",model:"gpt-5.6-terra",output_text:JSON.stringify({reply:"PRIVATE COLLABORATOR ASSISTANT REPLY",mutations:[],preview_worthy:false,preview_direction:""}),usage:{input_tokens:1000,output_tokens:200,total_tokens:1200}});};
    for(const [table,used,limit] of [["budget_counters","used_tokens","hard_limit_tokens"],["cost_budget_counters","used_microusd","hard_limit_microusd"]]){
      const original=database.sqlite.prepare(`SELECT ${used} AS used FROM ${table} WHERE scope='workspace' AND scope_id='forma'`).get().used;
      database.sqlite.prepare(`UPDATE ${table} SET ${used}=${limit} WHERE scope='workspace' AND scope_id='forma'`).run();
      const durableCounts=()=>Object.fromEntries(["document_jobs","events","budget_reservations","cost_budget_reservations"].map((name)=>[name,Number(database.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${name}`).get().count)])),before=durableCounts();
      database.reset();const blocked=await request("/api/document-jobs",json(scoped,{kind:"chat",documentId:"doc-atmosphere",sourceSurface:"chat",payload:{message:"GLOBAL BUDGET EXHAUSTED",livePreview:false}}));const rejected=await blocked.json();
      assert.equal(blocked.status,429,JSON.stringify(rejected));assert.equal(rejected.scope,"workspace",`${table} enforces the platform ceiling on organization work`);assert.deepEqual(durableCounts(),before,"an exhausted platform budget cannot create jobs, events, or reservations");assert.equal(providerCalls,0,"exhausted platform limits never contact a provider");
      database.sqlite.prepare(`UPDATE ${table} SET ${used}=? WHERE scope='workspace' AND scope_id='forma'`).run(original);
    }
    const chat=await request("/api/document-jobs",json(scoped,{kind:"chat",documentId:"doc-atmosphere",sourceSurface:"chat",payload:{message:"PRIVATE COLLABORATOR CHAT MESSAGE",livePreview:false}}));const accepted=await chat.json();assert.equal(chat.status,202,JSON.stringify(accepted));
    await drainBackground();
    const terminal=database.sqlite.prepare("SELECT status,error_message FROM document_jobs WHERE job_id=?").get(accepted.job.jobId);assert.equal(terminal.status,"completed",JSON.stringify(terminal));
    database.reset();const actorPage=await(await request("/api/events?after=0&limit=5000&content=1",{headers:scoped})).json();assert.match(JSON.stringify(actorPage.content),/PRIVATE COLLABORATOR CHAT MESSAGE/);assert.match(JSON.stringify(actorPage.content),/PRIVATE COLLABORATOR ASSISTANT REPLY/);
    const contentBatch=database.calls.find((call)=>call.kind==="batch"&&call.statements.some((statement)=>statement.sql.includes("CROSS JOIN private_content"))),contentStatement=contentBatch?.statements.find((statement)=>statement.sql.includes("CROSS JOIN private_content"));assert.ok(contentStatement,"actor-private hydration begins from exact project resource custody");
    const contentPlan=database.sqlite.prepare(`EXPLAIN QUERY PLAN ${contentStatement.sql}`).all(...contentStatement.values).map((row)=>row.detail).join("\n");assert.match(contentPlan,/SEARCH scope USING INDEX sqlite_autoindex_project_resource_scopes_1 \(project_access_id=\? AND resource_kind=\?\)/);assert.doesNotMatch(contentPlan,/SEARCH content USING INDEX idx_private_content_owner_expiry/);
    for(const identity of [teammateScope,ownerScope,collaborator,owner]){const forbidden=await(await request("/api/events?after=0&limit=5000&content=1",{headers:identity})).json();assert.doesNotMatch(JSON.stringify(forbidden),/PRIVATE COLLABORATOR CHAT MESSAGE|PRIVATE COLLABORATOR ASSISTANT REPLY/,"conversation inputs and replies remain actor-private in both project and personal views");}
    assert.ok(database.sqlite.prepare("SELECT COUNT(*) AS total FROM project_resource_scopes WHERE project_access_id=? AND organization_id=? AND resource_kind='content' AND visibility='actor_private' AND actor_user_id=?").get(projectAccessId,organizationId,"canvas-project-editor").total>=2);
    for(const [scope,id,key] of [["user","canvas-project-editor","actorTokens"],["workspace",organizationId,"organizationTokens"],["workspace","forma","platformTokens"]])assert.equal(readBudget("budget_counters","used_tokens",scope,id),baseline[key]+1200,`${scope}:${id} settles the exact collaborator token receipt`);
    assert.equal(readBudget("budget_counters","used_tokens","user","canvas-project-owner"),baseline.ownerTokens,"the project owner never pays another actor's personal token balance");
    for(const [scope,id,key] of [["user","canvas-project-editor","actorCost"],["workspace",organizationId,"organizationCost"],["workspace","forma","platformCost"]])assert.equal(readBudget("cost_budget_counters","used_microusd",scope,id),baseline[key]+4_400,`${scope}:${id} settles the exact $0.004400 collaborator cost receipt`);
    assert.equal(readBudget("cost_budget_counters","used_microusd","user","canvas-project-owner"),baseline.ownerCost,"the project owner never pays another actor's personal dollar balance");
    for(const table of ["budget_reservations","cost_budget_reservations"])assert.equal(database.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE owner_id=? AND status IN('authorizing','active','executing')`).get("canvas-project-editor").count,0,"completed paid work leaves no active or orphaned reservation");
    const privateMediaKey="canvas-project-owner/generated/another-private-project.png",privateMediaUrl=`/api/media/${encodeURIComponent(privateMediaKey)}`,previousMedia=environment.MEDIA;let privatePixelReads=0;
    environment.MEDIA={get:async(key)=>{if(key!==privateMediaKey)return null;privatePixelReads+=1;return{customMetadata:{ownerId:"canvas-project-owner"},writeHttpMetadata(headers){headers.set("content-type","image/png");},body:new Blob(["PRIVATE OTHER PROJECT PIXELS"]).stream()};}};
    try{
      const callsBeforeForgery=providerCalls,snapshot={facts:[{block_id:"block-reference",document_id:"doc-atmosphere",type:"reference",active:true,position:"a",properties:{reference_id:"ref-window-light",label:"Forged private reference",weight:1,pixel_reference_mode:"preserve_composition",media_url:privateMediaUrl}}]};
      const forged=await request("/api/document-jobs",json(scoped,{kind:"render_document",documentId:"doc-atmosphere",sourceSurface:"document",payload:{artifactKind:"storyboard",productionMode:"managed",itemCount:1,paidMediaConfirmed:true,budgetAcknowledged:true,snapshot}}));const admitted=await forged.json();assert.equal(forged.status,202,JSON.stringify(admitted));await drainBackground();
      const rejected=database.sqlite.prepare("SELECT status,error_message FROM document_jobs WHERE job_id=?").get(admitted.job.jobId);assert.equal(rejected.status,"failed",JSON.stringify(rejected));assert.match(String(rejected.error_message),/not authorized for the selected project/);assert.equal(privatePixelReads,0,"forged owner-owned media is rejected before its private pixels are read");assert.equal(providerCalls,callsBeforeForgery,"cross-project snapshot media never reaches a provider");
    }finally{environment.MEDIA=previousMedia;}
  }finally{globalThis.fetch=previousFetch;delete environment.OPENAI_API_KEY;}
  assert.equal((await request(`/api/shares/${encodeURIComponent(shared.share.shareId)}`,{method:"DELETE",headers:ownerScope})).status,200);
  assert.equal((await request(`/api/shared/${encodeURIComponent(shared.share.token)}`)).status,404,"tenant review links stop immediately after revocation");
  const concurrent=await Promise.all([request("/api/document-jobs",json(scoped,extraction)),request("/api/document-jobs",json(teammateScope,extraction))]);
  const concurrentJobs=await Promise.all(concurrent.map(async(response)=>{const body=await response.json();assert.equal(response.status,202,JSON.stringify(body));return body.job;}));
  await drainBackground();
  for(const job of concurrentJobs)assert.equal(database.sqlite.prepare("SELECT status FROM document_jobs WHERE job_id=?").get(job.jobId).status,"completed","the shared owner stream advances across independently authenticated collaborators");
  const ownJobs=await(await request("/api/document-jobs",{headers:scoped})).json(),teamJobs=await(await request("/api/document-jobs",{headers:teammateScope})).json();
  assert.ok(ownJobs.jobs.some((job)=>job.jobId===concurrentJobs[0].jobId));assert.ok(!ownJobs.jobs.some((job)=>job.jobId===concurrentJobs[1].jobId));assert.ok(teamJobs.jobs.some((job)=>job.jobId===concurrentJobs[1].jobId));assert.ok(!teamJobs.jobs.some((job)=>job.jobId===concurrentJobs[0].jobId));
  database.sqlite.prepare("UPDATE document_jobs SET status='running',lease_expires_at=?,completed_at=NULL WHERE job_id=?").run(new Date(Date.now()+60_000).toISOString(),concurrentJobs[0].jobId);
  const awaiting=await request("/api/document-jobs",json(teammateScope,extraction));const awaitingBody=await awaiting.json();assert.equal(awaiting.status,202);
  assert.equal(database.sqlite.prepare("SELECT status FROM document_jobs WHERE job_id=?").get(awaitingBody.job.jobId).status,"queued");
  const revokeTeammate=await request(`/api/workspaces/${organizationId}/projects/${projectAccessId}/members/${teammateMembershipId}`,{method:"DELETE",headers:owner});assert.equal(revokeTeammate.status,200);
  database.sqlite.prepare("UPDATE document_jobs SET status='completed',completed_at=?,lease_expires_at=NULL WHERE job_id=?").run(new Date().toISOString(),concurrentJobs[0].jobId);
  await drainBackground();
  const canceled=database.sqlite.prepare("SELECT status,error_message FROM document_jobs WHERE job_id=?").get(awaitingBody.job.jobId);assert.equal(canceled.status,"canceled");assert.equal(canceled.error_message,"project_access_revoked");
  assert.equal((await request(`/api/document-jobs/${awaitingBody.job.jobId}`,{headers:teammateScope})).status,403);
  const ownerQueue=await request("/api/document-jobs",json(owner,extraction));const ownerQueued=await ownerQueue.json();assert.equal(ownerQueue.status,202,JSON.stringify(ownerQueued));await drainBackground();assert.equal(database.sqlite.prepare("SELECT status FROM document_jobs WHERE job_id=?").get(ownerQueued.job.jobId).status,"completed","a revoked actor never strands the project owner's queue");
  const removed=makeEvent("CanvasItemRemoved",{item_id:"shared-item"},"remove-shared-item");const removal=await request("/api/events",json(scoped,{action:"canvas_sync",events:[removed]}));assert.equal(removal.status,200,JSON.stringify(await removal.clone().json()));
  const removedPage=await(await request("/api/events?after=0&limit=5000&content=0",{headers:scoped})).json();assert.ok(removedPage.events.some((event)=>event.type==="CanvasItemRemoved"&&event.payload.item_id==="shared-item"));assert.doesNotMatch(JSON.stringify(removedPage),/PRIVATE BOARD CARD TITLE/);assert.equal(foldCanvasEvents(removedPage.events,"project-atmosphere","shared-board").items.length,0);
  const removedRetry=await request("/api/events",json(scoped,{action:"canvas_sync",events:[register]}));const removedReceipt=await removedRetry.json();assert.equal(removedRetry.status,200);assert.equal(removedReceipt.appended[0].eventId,firstEventId);assert.equal(removedReceipt.appended[0].payload.client_event_id,"first-collaborative-receipt","actor-only receipts retain their device acknowledgment after resource removal");
  const restored=await request("/api/events",json(scoped,{action:"canvas_sync",events:[makeEvent("CanvasItemRestored",{item_id:"shared-item"})]}));assert.equal(restored.status,200,JSON.stringify(await restored.clone().json()));
  const restoredPage=await(await request("/api/events?after=0&limit=5000&content=0",{headers:scoped})).json();assert.equal(foldCanvasEvents(restoredPage.events,"project-atmosphere","shared-board").items.length,1);
  const boardRemoval=await request("/api/events",json(scoped,{action:"canvas_sync",events:[makeEvent("CanvasRemoved",{})]}));assert.equal(boardRemoval.status,200,JSON.stringify(await boardRemoval.clone().json()));
  const boardRemovedPage=await(await request("/api/events?after=0&limit=5000&content=0",{headers:scoped})).json();assert.ok(boardRemovedPage.events.some((event)=>event.type==="CanvasRemoved"&&event.payload.canvas_id==="shared-board"));assert.doesNotMatch(JSON.stringify(boardRemovedPage),/PRIVATE BOARD CARD TITLE/);assert.equal(foldCanvasEvents(boardRemovedPage.events,"project-atmosphere").canvases.length,0);
  const boardRestore=await request("/api/events",json(scoped,{action:"canvas_sync",events:[makeEvent("CanvasRestored",{})]}));assert.equal(boardRestore.status,200,JSON.stringify(await boardRestore.clone().json()));
  const sidecar=database.sqlite.prepare("INSERT INTO project_event_scopes(event_id,project_access_id,organization_id,project_id,owner_user_id,source_stream_id,source_sequence,project_sequence,actor_user_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)");
  let projectSequence=Number(database.sqlite.prepare("SELECT MAX(project_sequence) AS head FROM project_event_scopes WHERE project_access_id=?").get(projectAccessId).head);
  ownerSequence=Number(database.sqlite.prepare("SELECT MAX(sequence) AS head FROM events WHERE stream_id=?").get(stream).head);
  database.sqlite.exec("BEGIN");try{for(let index=0;index<5_050;index+=1){const id=crypto.randomUUID();insertEvent.run(id,stream,++ownerSequence,timestamp,timestamp,"user:canvas-project-editor","server:canvas-history",crypto.randomUUID(),null,null,1,"BlockPropertyEdited",JSON.stringify({project_id:"project-atmosphere",block_id:"block-direction",property_path:"text",new_value:`History ${index}`}));sidecar.run(id,projectAccessId,organizationId,"project-atmosphere","canvas-project-owner",stream,ownerSequence,++projectSequence,"canvas-project-editor",timestamp);}database.sqlite.prepare("UPDATE project_migration_states SET last_owner_sequence=? WHERE project_access_id=?").run(ownerSequence,projectAccessId);database.sqlite.exec("COMMIT");}catch(error){database.sqlite.exec("ROLLBACK");throw error;}
  database.reset();const longRetry=await request("/api/events",json(scoped,{action:"canvas_sync",events:[register]}));const longReceipt=await longRetry.json();assert.equal(longRetry.status,200,JSON.stringify(longReceipt));assert.equal(longReceipt.appended[0].eventId,firstEventId);assert.equal(database.writeCount(),0,"old exact receipts remain idempotent beyond the first 5,000 project events");
  assert.equal((await request(permissionPath,json(owner,{canvasAccess:false},"PATCH"))).status,200);
  database.reset();assert.equal((await request("/canvas",{headers:scoped})).status,403);assert.equal(database.writeCount(),0);
  database.reset();assert.equal((await request("/api/events",json(scoped,{action:"canvas_sync",events:[register]}))).status,403);assert.equal(database.writeCount(),0,"grant revocation stops stale queued board edits immediately");
});

test("revoking a project-owning organization administrator quarantines their project and immediately closes collaborator access",async()=>{
  const {database,environment,request}=await productionWorker();
  const owner=await specialistIdentity(database,request,"revocation-org-owner");
  const projectOwner=await specialistIdentity(database,request,"revocation-project-owner");
  const collaborator=await specialistIdentity(database,request,"revocation-collaborator");
  const json=(headers,body,method="POST")=>({method,headers:{...headers,"content-type":"application/json"},body:JSON.stringify(body)});
  for(const headers of [owner,projectOwner])assert.equal((await request("/api/events?after=0&content=0",{headers})).status,200);
  const media=new Map();
  environment.MEDIA={put:async(key,_value,options)=>{media.set(key,options.customMetadata);},get:async(key)=>media.has(key)?{customMetadata:media.get(key),httpEtag:"reference",writeHttpMetadata(headers){headers.set("content-type","image/png");},body:new Blob(["shared reference"]).stream()}:null,delete:async(key)=>{media.delete(key);}};
  const created=await request("/api/workspaces",json(owner,{name:"Owner revocation boundary"}));assert.equal(created.status,201);const organizationId=(await created.json()).organizationId;
  const invite=async(headers,userId,role)=>{const response=await request(`/api/workspaces/${organizationId}/members`,json(headers,{email:`${userId}@example.test`,role}));assert.equal(response.status,201);const invitation=await response.json();const accepted=await request(`/api/workspaces/${organizationId}/invitations/${invitation.invitationId}/accept`,json(userId==="revocation-project-owner"?projectOwner:collaborator,{token:new URL(invitation.invitationUrl).searchParams.get("token")}));assert.equal(accepted.status,200);};
  await invite(owner,"revocation-project-owner","administrator");
  await invite(owner,"revocation-collaborator","member");
  const register=async(headers)=>{const response=await request(`/api/workspaces/${organizationId}/projects`,json(headers,{projectId:"project-atmosphere"}));assert.equal(response.status,201);return(await response.json()).projectAccessId;};
  const unaffected=await register(owner),quarantined=await register(projectOwner);
  assert.notEqual(unaffected,quarantined);
  const ownerOpened=await request(`/api/workspaces/${organizationId}/projects/${quarantined}/context`,{method:"POST",headers:projectOwner});assert.equal(ownerOpened.status,200);const ownerScoped={...projectOwner,cookie:ownerOpened.headers.get("set-cookie")?.split(";")[0]??""};
  const ownerLink=await request("/api/shares",json(ownerScoped,{resourceKind:"document",documentId:"doc-atmosphere",projectId:"project-atmosphere"}));assert.equal(ownerLink.status,200,JSON.stringify(await ownerLink.clone().json()));const quarantineShare=(await ownerLink.json()).share;assert.equal((await request(`/api/shared/${encodeURIComponent(quarantineShare.token)}`)).status,200);
  const granted=await request(`/api/workspaces/${organizationId}/projects/${quarantined}/members`,json(projectOwner,{userId:"revocation-collaborator",role:"editor"}));assert.equal(granted.status,201);
  const opened=await request(`/api/workspaces/${organizationId}/projects/${quarantined}/context`,{method:"POST",headers:collaborator});assert.equal(opened.status,200);const scoped={...collaborator,cookie:opened.headers.get("set-cookie")?.split(";")[0]??""};
  assert.equal((await request("/api/events?after=0&content=1",{headers:scoped})).status,200);
  const form=new FormData();form.set("file",new File(["reference"],"owner-shared-reference.png",{type:"image/png"}));form.set("rightsConfirmed","true");const upload=await request("/api/media",{method:"POST",headers:scoped,body:form});assert.equal(upload.status,200);const uploaded=await upload.json();assert.equal((await request(`/api/media/${encodeURIComponent(uploaded.key)}`,{headers:scoped})).status,200);
  const administratorMembership=database.sqlite.prepare("SELECT membership_id FROM organization_memberships WHERE organization_id=? AND user_id=?").get(organizationId,"revocation-project-owner").membership_id;
  const revoke=await request(`/api/workspaces/${organizationId}/members/${administratorMembership}`,{method:"DELETE",headers:owner});assert.equal(revoke.status,200);
  assert.equal((await request(`/api/shared/${encodeURIComponent(quarantineShare.token)}`)).status,404,"quarantining a registered project immediately closes its owner's public review link");
  assert.equal(database.sqlite.prepare("SELECT status FROM organization_projects WHERE project_access_id=?").get(quarantined).status,"quarantine");
  assert.equal(database.sqlite.prepare("SELECT status FROM project_migration_states WHERE project_access_id=?").get(quarantined).status,"quarantine");
  assert.equal(database.sqlite.prepare("SELECT status FROM organization_projects WHERE project_access_id=?").get(unaffected).status,"active","another owner's project remains available");
  assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM project_memberships WHERE project_access_id=? AND status='active'").get(quarantined).count,0);
  assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM project_context_sessions WHERE project_access_id=? AND revoked_at IS NULL").get(quarantined).count,0);
  for(const [path,options] of [["/api/events?after=0&content=1",{headers:scoped}],[`/api/workspaces/${organizationId}/projects/${quarantined}/events`,{headers:collaborator}],[`/api/workspaces/${organizationId}/projects/${quarantined}/events`,{headers:scoped}],[`/api/media/${encodeURIComponent(uploaded.key)}`,{headers:scoped}],[`/api/workspaces/${organizationId}/projects/${quarantined}/events`,json(collaborator,{action:"append",event:{type:"BlockPropertyEdited",payload:{block_id:"block-direction",property_path:"text",new_value:"REVOKED OWNER"}}})]]){
    database.reset();assert.equal((await request(path,options)).status,403,path);assert.equal(database.writeCount(),0,"revoked owner access cannot mutate history or recreate a project session");
  }
  const audit=await(await request(`/api/workspaces/${organizationId}/audit`,{headers:owner})).json();assert.ok(audit.audit.some((entry)=>entry.action==="OrganizationMembershipRevoked"));
});

test("workspace settings HTML and usage policies require exact organization-scoped server capability",async()=>{
  const {database,environment,request}=await productionWorker();const owner=await specialistIdentity(database,request,"tenant-owner");const stranger=await specialistIdentity(database,request,"tenant-stranger");htmlAssets(environment);
  const created=await request("/api/workspaces",{method:"POST",headers:{...owner,"content-type":"application/json"},body:JSON.stringify({name:"Bounded organization"})});assert.equal(created.status,201);const organizationId=(await created.json()).organizationId;
  for(const path of [`/settings/workspaces/${organizationId}/overview`,`/settings/workspaces/${organizationId}/members`,`/settings/workspaces/${organizationId}/projects`,`/settings/workspaces/${organizationId}/usage`,`/settings/workspaces/${organizationId}/activity`]){
    assert.equal((await request(path,{headers:owner})).status,200,path);
    database.reset();assert.equal((await request(path,{headers:stranger})).status,403,path);assert.equal(database.writeCount(),0,path);
  }
  assert.equal((await request("/settings/workspaces/invitations",{headers:stranger})).status,200);
  const usage=await request(`/api/workspaces/${organizationId}/usage`,{headers:owner});assert.equal(usage.status,200);const report=await usage.json();assert.equal(report.policy.microusd_limit,1_000_000_000);assert.equal(report.cost,null,"new tenant usage never imports historical global charges");
  assert.equal((await request(`/api/workspaces/${organizationId}/usage`,{headers:stranger})).status,403);
  const updated=await request(`/api/workspaces/${organizationId}/policy`,{method:"PATCH",headers:{...owner,"content-type":"application/json"},body:JSON.stringify({tokenLimit:500,microusdLimit:25_000_000})});assert.equal(updated.status,200);assert.equal((await updated.json()).policy.microusd_limit,25_000_000);
  assert.equal(database.sqlite.prepare("SELECT used_microusd FROM cost_budget_counters WHERE scope='user' AND scope_id='dev-local-creative'").get().used_microusd,0,"customer administration must not rebuild a manually reset personal budget");
});

test("organization budgets enforce exact tenant, actor, personal, and global caps without corrupting personal history",async()=>{
  const {database,environment,request}=await productionWorker();
  const ownerA=await specialistIdentity(database,request,"budget-owner-a"),ownerB=await specialistIdentity(database,request,"budget-owner-b");
  const json=(headers,body,method="POST")=>({method,headers:{...headers,"content-type":"application/json"},body:JSON.stringify(body)});
  for(const headers of [ownerA,ownerB])assert.equal((await request("/api/events?after=0&content=0",{headers})).status,200);
  const create=async(headers,name,tokenLimit,microusdLimit)=>{
    const organization=await request("/api/workspaces",json(headers,{name}));assert.equal(organization.status,201);const organizationId=(await organization.json()).organizationId;
    const registered=await request(`/api/workspaces/${organizationId}/projects`,json(headers,{projectId:"project-atmosphere"}));assert.equal(registered.status,201);const projectAccessId=(await registered.json()).projectAccessId;
    const policy=await request(`/api/workspaces/${organizationId}/policy`,json(headers,{tokenLimit,microusdLimit},"PATCH"));assert.equal(policy.status,200);
    return{organizationId,projectAccessId};
  };
  const tenantA=await create(ownerA,"Budget A",100,2_000_000),tenantB=await create(ownerB,"Budget B",200,3_000_000);
  const scopeA={...tenantA,actorUserId:"budget-owner-a"},scopeB={...tenantB,actorUserId:"budget-owner-b"};
  const tokenOptions={streamId:"creative:budget-owner-a",correlationId:"tenant-operation",operation:"tenant-test",reservationId:"tenant-tokens-a",projectScope:scopeA};
  const tokenA=await reserveBudget(environment,"budget-owner-a",60,tokenOptions);assert.equal(tokenA.ok,true);
  assert.equal((await reserveBudget(environment,"budget-owner-a",60,tokenOptions)).reused,true,"exact retries never reserve the same tenant amount twice");
  assert.equal((await reserveBudget(environment,"budget-owner-a",50,{...tokenOptions,reservationId:"tenant-over-token"})).ok,false,"an exact tenant cap below the platform default is binding");
  const tokenB=await reserveBudget(environment,"budget-owner-b",150,{streamId:"creative:budget-owner-b",correlationId:"tenant-b",operation:"tenant-test",reservationId:"tenant-tokens-b",projectScope:scopeB});assert.equal(tokenB.ok,true,"tenant B cannot consume tenant A's limit");
  assert.equal((await reserveBudget(environment,"budget-owner-b",1,{projectScope:scopeA})).ok,false,"the billed actor must own the accepted exact project grant");
  const costOptions={maximumMicrousd:2_000_000,allowUserOverage:false,reservationId:"tenant-cost-a",streamId:"creative:budget-owner-a",correlationId:"tenant-operation",operation:"tenant-test",projectScope:scopeA};
  const costA=await reserveCostBudget(environment,"budget-owner-a",1_250_000,costOptions);assert.equal(costA.ok,true);
  assert.equal((await reserveCostBudget(environment,"budget-owner-a",1_250_000,costOptions)).reused,true);
  assert.equal((await reserveCostBudget(environment,"budget-owner-a",800_000,{...costOptions,reservationId:"tenant-cost-over",correlationId:"tenant-over"})).ok,false);
  const current=(await request(`/api/workspaces/${tenantA.organizationId}/usage`,{headers:ownerA}));assert.equal(current.status,200);const usage=await current.json();assert.equal(usage.tokens.reserved_tokens,60);assert.equal(usage.cost.reserved_microusd,1_250_000);assert.equal(usage.cost.hard_limit_microusd,2_000_000);
  const selected=await request(`/api/workspaces/${tenantA.organizationId}/projects/${tenantA.projectAccessId}/context`,{method:"POST",headers:ownerA});assert.equal(selected.status,200);const cookie=selected.headers.get("set-cookie")?.split(";")[0]??"";
  const scopedSession=await(await request("/api/session",{headers:{...ownerA,cookie}})).json();assert.equal(scopedSession.budgets.workspace.limit,100);assert.equal(scopedSession.costBudgets.workspace.limitMicrousd,2_000_000);assert.equal(scopedSession.costBudgets.workspace.reservedMicrousd,1_250_000);
  assert.equal((await settleBudget(environment,"budget-owner-a",tokenA.reservationId,35)).settled,true);assert.equal((await settleBudget(environment,"budget-owner-a",tokenA.reservationId,80)).settled,false);
  assert.equal((await settleCostBudget(environment,"budget-owner-a",costA.reservationId,750_000)).settled,true);assert.equal((await settleCostBudget(environment,"budget-owner-a",costA.reservationId,1_900_000)).settled,false);
  const settled=await(await request(`/api/workspaces/${tenantA.organizationId}/usage`,{headers:ownerA})).json();assert.equal(settled.tokens.used_tokens,35);assert.equal(settled.tokens.reserved_tokens,0);assert.equal(settled.cost.used_microusd,750_000);assert.equal(settled.cost.reserved_microusd,0);
  const lower=await request(`/api/workspaces/${tenantA.organizationId}/policy`,json(ownerA,{tokenLimit:34,microusdLimit:749_999},"PATCH"));assert.equal(lower.status,409);assert.equal(database.sqlite.prepare("SELECT token_limit,microusd_limit FROM budget_scope_policies WHERE scope_id=?").get(tenantA.organizationId).token_limit,100);
  environment.OPENAI_API_KEY="tenant-budget-provider-must-not-be-called";
  for(const documentId of ["doc-atmosphere",undefined]){
    database.reset();
    const generated=await request("/api/events",json(ownerA,{action:"generate",...(documentId?{documentId}:{}),sourceSurface:"document",budgetAcknowledged:true}));
    assert.equal(generated.status,429,"direct generation resolves its actual registered document before organization token enforcement");
    assert.equal((await generated.json()).scope,"workspace");
    assert.equal(database.writeCount(),0,"an over-limit direct generation must not reserve, append, or contact a provider");
    database.reset();
    const queued=await request("/api/document-jobs",json(ownerA,{kind:"generate",...(documentId?{documentId}:{}),payload:{budgetAcknowledged:true}}));
    assert.equal(queued.status,429,"the actual queued generation workflow enforces the exact organization token limit before admission");
    assert.equal((await queued.json()).scope,"workspace");
    assert.equal(database.writeCount(),0,"an over-limit queued request must not reconcile, reserve, or create a job");
  }
  database.reset();
  const forged=await request("/api/events",json(ownerA,{action:"generate",documentId:"foreign-unregistered-document",budgetAcknowledged:true}));
  assert.equal(forged.status,404,"an invented document cannot fall back to the current registered project or bypass its budget");
  assert.equal(database.writeCount(),0);
  const freshDocument="doc-registered-after-sharing";
  const created=await request("/api/events",json(ownerA,{action:"append",event:{type:"DocumentCreated",payload:{project_id:"project-atmosphere",document_id:freshDocument,title:"Fresh registered document"}}}));
  assert.equal(created.status,200);
  assert.equal(database.sqlite.prepare("SELECT 1 FROM project_resource_scopes WHERE project_access_id=? AND resource_kind='document' AND resource_id=?").get(tenantA.projectAccessId,freshDocument),undefined,"the owner's direct document write has not yet refreshed the collaborator manifest");
  for(const [path,body] of [["/api/events",{action:"generate",documentId:freshDocument,budgetAcknowledged:true}],["/api/document-jobs",{kind:"generate",documentId:freshDocument,payload:{budgetAcknowledged:true}}]]){
    database.reset();const response=await request(path,json(ownerA,body));assert.equal(response.status,429,`${path} derives the tenant from the authoritative owner document instead of a stale sharing manifest`);assert.equal((await response.json()).scope,"workspace");assert.equal(database.writeCount(),0);
  }
  for(const [artifactKind,tokenLimit,itemCount] of [["video",55_000,undefined],["slides",63_000,12],["storyboard",70_000,3]]){
    const configured=await request(`/api/workspaces/${tenantA.organizationId}/policy`,json(ownerA,{tokenLimit,microusdLimit:100_000_000},"PATCH"));assert.equal(configured.status,200);
    const payload={artifactKind,productionMode:"managed",paidMediaConfirmed:true,budgetAcknowledged:true,...(itemCount?{itemCount}:{}),snapshot:{}};
    for(const [path,body] of [["/api/events",{action:"render_document",documentId:freshDocument,...payload}],["/api/document-jobs",{kind:"render_document",documentId:freshDocument,payload}]]){
      database.reset();const denied=await request(path,json(ownerA,body));assert.equal(denied.status,429,`${path} estimates the exact managed ${artifactKind} scene plan before queue/provider admission`);assert.equal((await denied.json()).scope,"workspace");assert.equal(database.writeCount(),0,"managed production cannot create a doomed job or reservation");
    }
  }
  const costPolicy=await request(`/api/workspaces/${tenantA.organizationId}/policy`,json(ownerA,{tokenLimit:100_000,microusdLimit:1_200_000},"PATCH"));assert.equal(costPolicy.status,200);
  database.reset();const overCost=await request("/api/document-jobs",json(ownerA,{kind:"generate",documentId:freshDocument,payload:{budgetAcknowledged:true}}));assert.equal(overCost.status,429);assert.equal((await overCost.json()).scope,"workspace");assert.equal(database.writeCount(),0,"organization dollar caps are enforced before queue admission as well");
  assert.equal(Number(database.sqlite.prepare("SELECT COUNT(*) AS count FROM document_jobs WHERE owner_id=?").get("budget-owner-a").count),0,"no denied operation creates a document job");
  assert.equal(database.sqlite.prepare("SELECT used_microusd,reserved_microusd FROM cost_budget_counters WHERE scope='workspace' AND scope_id=?").get(tenantA.organizationId).used_microusd,750_000);
  assert.equal(database.sqlite.prepare("SELECT used_microusd FROM cost_budget_counters WHERE scope='workspace' AND scope_id=?").get(tenantB.organizationId)?.used_microusd??0,0,"another tenant remains financially untouched");
  assert.equal(database.sqlite.prepare("SELECT used_microusd FROM cost_budget_counters WHERE scope='user' AND scope_id='dev-local-creative'").get().used_microusd,0,"never overwrite the user's explicitly reset personal budget");
});

test("delivery decisions enforce canonical evidence gates, scoped ownership, immutable dependencies, and independent release approval",async()=>{
  const {database,environment,request}=await productionWorker();htmlAssets(environment);
  const reader=await specialistIdentity(database,request,"delivery-reader",["product.delivery.read"]);
  const releaseReader=await specialistIdentity(database,request,"delivery-release-reader",["product.release.read"]);
  const manager=await specialistIdentity(database,request,"delivery-manager",["product.delivery.manage"]);
  await specialistIdentity(database,request,"delivery-alternate",["product.delivery.manage"]);
  const approver=await specialistIdentity(database,request,"delivery-approver",["product.delivery.manage","platform.release.approve"]);
  const json=(headers,body,method="POST")=>({method,headers:{...headers,"content-type":"application/json"},body:JSON.stringify(body)});
  const initial=await(await request("/api/portfolio/product/delivery",{headers:reader})).json();assert.equal(initial.report.metrics.find((metric)=>metric.id==="openReleaseGates").value,3);
  assert.equal((await request("/product/delivery",{headers:releaseReader})).status,200);
  const releaseSession=await(await request("/api/session?audience=product",{headers:releaseReader})).json();assert.deepEqual(releaseSession.capabilities,["product.release.read"]);
  const releaseReport=await(await request("/api/portfolio/product/delivery",{headers:releaseReader})).json();assert.equal(releaseReport.report.decisions,undefined);assert.equal(releaseReport.report.owners,undefined);assert.equal(releaseReport.report.approvalAuthority,undefined);
  database.reset();assert.equal((await request("/api/portfolio/product/delivery",json(reader,{title:"Forbidden",audience:"product"}))).status,403);assert.equal(database.writeCount(),0);
  database.reset();assert.equal((await request("/api/portfolio/product/delivery",json(releaseReader,{title:"Forbidden",audience:"product"}))).status,403);assert.equal(database.writeCount(),0);
  const managerReport=await(await request("/api/portfolio/product/delivery",{headers:manager})).json();assert.equal(managerReport.report.approvalAuthority,false);assert.ok(managerReport.report.owners.some((owner)=>owner.userId==="delivery-alternate"));
  database.reset();assert.equal((await request("/api/portfolio/product/delivery",json(manager,{title:"Invalid owner",audience:"product",ownerUserId:"foreign-user"}))).status,403);assert.equal(database.writeCount(),0);
  assert.equal((await request("/api/portfolio/product/delivery",json(manager,{title:"Forged display",audience:"product",owner:"forged owner"}))).status,400);
  assert.equal((await request("/api/portfolio/product/delivery",json(approver,{title:"Direct approval",audience:"product",status:"approved",evidence:"bypassed review"}))).status,409);
  const created=await request("/api/portfolio/product/delivery",json(manager,{title:"Establish audience-specific launch criteria",audience:"product",status:"active",evidence:"Acceptance checklist retained"}));assert.equal(created.status,201);let first=(await created.json()).decision;
  assert.equal(first.owner,"delivery-manager");assert.equal(first.status,"running");assert.equal(first.ownerUserId,"delivery-manager");
  const reassigned=await request("/api/portfolio/product/delivery",json(manager,{decisionId:first.decisionId,title:"Assigned audience-specific launch criteria",status:"running",evidence:"Acceptance checklist retained",ownerUserId:"delivery-alternate",expectedUpdatedAt:first.updatedAt},"PATCH"));assert.equal(reassigned.status,200);first=(await reassigned.json()).decision;assert.equal(first.ownerUserId,"delivery-alternate");
  const dependency=await request("/api/portfolio/product/delivery",json(manager,{title:"Verify release evidence",audience:"operations",dependencyIds:[first.decisionId]}));assert.equal(dependency.status,201);let dependent=(await dependency.json()).decision;assert.deepEqual(dependent.dependencyIds,[first.decisionId]);
  const unknown=await request("/api/portfolio/product/delivery",json(manager,{title:"Unknown dependency",audience:"product",dependencyIds:["missing-decision"]}));assert.equal(unknown.status,409);
  const revise=(decision,status,evidence=decision.evidence,headers=manager)=>request("/api/portfolio/product/delivery",json(headers,{decisionId:decision.decisionId,title:decision.title,status,evidence,ownerUserId:decision.ownerUserId,expectedUpdatedAt:decision.updatedAt},"PATCH"));
  let transition=await revise(dependent,"running");assert.equal(transition.status,200);dependent=(await transition.json()).decision;
  transition=await revise(dependent,"passed","Dependency evidence");assert.equal(transition.status,409);assert.equal((await transition.json()).error,"delivery_dependencies_incomplete");
  transition=await revise(first,"passed","");assert.equal(transition.status,409);assert.equal((await transition.json()).error,"delivery_evidence_required");
  transition=await revise(first,"approval_required","Skipped evidence checkpoint");assert.equal(transition.status,409);
  transition=await revise(first,"completed","Reviewed by delivery");assert.equal(transition.status,200);const stale=first;first=(await transition.json()).decision;assert.equal(first.status,"passed");
  assert.equal((await revise(stale,"passed","Reviewed again")).status,409);
  assert.equal((await request("/api/portfolio/product/delivery",json(manager,{decisionId:first.decisionId,title:first.title,status:"passed",evidence:first.evidence,expectedUpdatedAt:first.updatedAt,dependencyIds:[]},"PATCH"))).status,400);
  transition=await revise(dependent,"passed","Dependency evidence");assert.equal(transition.status,200);dependent=(await transition.json()).decision;
  transition=await revise(dependent,"approval_required","Ready for independent approval");assert.equal(transition.status,200);dependent=(await transition.json()).decision;
  const aggregateOnly=await(await request("/api/portfolio/product/delivery",{headers:releaseReader})).json();assert.equal(aggregateOnly.report.evidence.find((item)=>item.id==="decisionOwnership").status,"passed","release readers see truthful aggregate ownership without individual decision disclosure");
  database.reset();transition=await revise(dependent,"approved","Approved without authority");assert.equal(transition.status,403);assert.equal(database.writeCount(),0);
  const personal=await request("/api/portfolio/product/delivery",json(approver,{title:"Decision owned by the release approver",audience:"product",status:"running",evidence:"Initial independent-review candidate"}));assert.equal(personal.status,201);let owned=(await personal.json()).decision;
  transition=await revise(owned,"passed","Release evidence is complete",approver);assert.equal(transition.status,200);owned=(await transition.json()).decision;
  transition=await revise(owned,"approval_required","Awaiting a different approver",approver);assert.equal(transition.status,200);owned=(await transition.json()).decision;
  database.reset();transition=await revise(owned,"approved","Self-approved",approver);assert.equal(transition.status,403);assert.equal((await transition.json()).error,"independent_release_approver_required");assert.equal(database.writeCount(),0,"dual authority never bypasses distinct-person release review");
  transition=await revise(dependent,"approved","Independently approved",approver);assert.equal(transition.status,200);dependent=(await transition.json()).decision;
  database.reset();transition=await revise(dependent,"superseded","Unauthorized approval bypass");assert.equal(transition.status,403);assert.equal(database.writeCount(),0);
  transition=await revise(dependent,"revoked","Approval explicitly revoked",approver);assert.equal(transition.status,200);dependent=(await transition.json()).decision;assert.equal(dependent.status,"revoked");
  assert.ok((await(await request("/api/portfolio/product/delivery",{headers:approver})).json()).report.approvalAuthority);
  const readerReport=await(await request("/api/portfolio/product/delivery",{headers:reader})).json();assert.ok(readerReport.report.decisions.every((decision)=>!("ownerUserId" in decision)));assert.equal(readerReport.report.owners,undefined);
  const final=await(await request("/api/portfolio/product/delivery",{headers:reader})).json();assert.equal(final.report.decisions.length,3);assert.ok(database.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE stream_id='platform:product-delivery'").get().count>=3);
});

test("release reporting counts absent and stale approvals, and only release approvers can mutate governance",async()=>{
  const {database,request}=await productionWorker();
  const policy=await specialistIdentity(database,request,"release-policy",["platform.policy.manage"]);
  const approver=await specialistIdentity(database,request,"release-approver",["platform.release.approve"]);
  const report=async(path,headers)=>{const response=await request(path,{headers});assert.equal(response.status,200);return(await response.json()).report.metrics.find((metric)=>metric.id==="openReleaseGates")?.value;};
  assert.equal(await report("/api/portfolio/product/delivery",undefined),3);assert.equal(await report("/api/portfolio/operations/overview",policy),3);assert.equal(await report("/api/portfolio/engineering/health",undefined),3);
  const approval={action:"approve",requirement:"trust_safety",confirmation:"I understand, record this Canvas approval",evidenceRef:"review/trust-safety"};
  database.reset();assert.equal((await request("/api/canvas-governance",{method:"POST",headers:{...policy,"content-type":"application/json"},body:JSON.stringify(approval)})).status,403);assert.equal(database.writeCount(),0);
  assert.equal((await request("/api/canvas-governance",{method:"POST",headers:{...approver,"content-type":"application/json"},body:JSON.stringify(approval)})).status,200);assert.equal(await report("/api/portfolio/product/delivery",undefined),2);
  const now=new Date().toISOString();database.sqlite.prepare("INSERT INTO canvas_governance_requirements(requirement_id,status,details_json,updated_at) VALUES(?,?,?,?)").run("counsel","approved","{}",now);
  database.sqlite.prepare("INSERT INTO canvas_governance_requirements(requirement_id,status,evidence_ref,details_json,updated_at) VALUES(?,?,?,?,?)").run("second_image_adapter","approved","obsolete-evidence",JSON.stringify({adapter_id:"stale-adapter"}),now);
  assert.equal(await report("/api/portfolio/product/delivery",undefined),1);assert.equal(await report("/api/portfolio/operations/overview",policy),1);
  const evidence=IMAGE_ADAPTER_V52_EVALUATION_EVIDENCE;const details={adapter_id:evidence.adapterId,contract_version:evidence.adapterVersion,corpus_version:evidence.corpusVersion,evaluation_ref:evidence.evaluationRef,evaluation_passed:true};
  database.sqlite.prepare("UPDATE canvas_governance_requirements SET evidence_ref=?,details_json=? WHERE requirement_id='second_image_adapter'").run(evidence.evaluationRef,JSON.stringify(details));
  assert.equal(await report("/api/portfolio/product/delivery",undefined),0);assert.equal(await report("/api/portfolio/operations/overview",policy),0);
  const qualification=(await(await request("/api/portfolio/product/evaluation")).json()).report.qualification;assert.equal(qualification.productionApproved,true);
});

test("qualification readers cannot simulate, qualification runners cannot inspect retained provider evidence, and previews cannot spend",async()=>{
  const {database,environment,request}=await productionWorker();environment.FAL_KEY="DO_NOT_DISCLOSE_FAL_SECRET";environment.OPENAI_API_KEY="DO_NOT_DISCLOSE_OPENAI_SECRET";
  const reader=await specialistIdentity(database,request,"qualification-reader",["evaluation.qualification.read"]);
  const runner=await specialistIdentity(database,request,"qualification-runner",["evaluation.qualification.run"]);
  const synthetic=await specialistIdentity(database,request,"synthetic-reader",["evaluation.synthetic.read"]);
  const reportFor=async(headers)=>(await(await request("/api/portfolio/product/evaluation",{headers})).json()).report;
  const retained=await reportFor(reader);assert.equal(retained.qualification.adapterVersion,"v52");assert.equal(retained.qualification.reports.find((item)=>item.adapterVersion==="v52")?.candidateUsable,43);
  assert.equal((await reportFor(runner)).qualification,undefined);assert.equal((await reportFor(synthetic)).qualification,undefined);
  const input={provider:"fal-ideogram",quality:"high",size:"1024x1024",outputFormat:"jpeg",referenceCount:1,prompt:"PRIVATE_GENERATION_PROMPT"};const send=(headers)=>request("/api/portfolio/product/adapter-preview",{method:"POST",headers:{...headers,"content-type":"application/json"},body:JSON.stringify(input)});
  database.reset();assert.equal((await send(reader)).status,403);assert.equal(database.writeCount(),0);assert.equal((await send(synthetic)).status,403);
  database.reset();const simulated=await send(runner);assert.equal(simulated.status,200);const preview=await simulated.json();assert.equal(preview.dryRun,true);assert.equal(preview.providerCall,false);assert.equal(preview.pixelsTransmitted,false);assert.equal(preview.selection.provider,"fal-ideogram");assert.equal(preview.request.referenceCount,1);assert.equal(database.writeCount(),0);assert.doesNotMatch(JSON.stringify(preview),/DO_NOT_DISCLOSE|PRIVATE_GENERATION_PROMPT|providerRequestId|costBudgets|configuredProvider/);
  assert.equal((await request("/api/image-adapters",{headers:reader})).status,403);assert.equal((await request("/api/image-adapters",{headers:runner})).status,403);assert.equal((await request("/api/image-adapters")).status,200);
});

test("seeded and simulated activity never defeats the three-real-creator product privacy threshold",async()=>{
  const {database,request}=await productionWorker();
  const second=await specialistIdentity(database,request,"real-creator-two");const third=await specialistIdentity(database,request,"real-creator-three");
  assert.equal((await request("/api/events?after=0&limit=2000&content=0",{headers:second})).status,200);assert.equal((await request("/api/events?after=0&limit=2000&content=0",{headers:third})).status,200);
  const insights=async()=>{const response=await request("/api/portfolio/product/insights");assert.equal(response.status,200);return(await response.json()).report;};
  assert.equal((await insights()).metrics.find((metric)=>metric.id==="activeCreators").value,null,"seed-only accounts must never count as real activity");
  const add=(owner,payload={},type="BlockCreated",occurredAt=new Date().toISOString())=>{const stream=`creative:${owner}`;const sequence=Number(database.sqlite.prepare("SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?").get(stream).head)+1;database.sqlite.prepare("INSERT INTO events(event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,causation_id,compensates_event_id,schema_version,type,payload) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").run(crypto.randomUUID(),stream,sequence,occurredAt,occurredAt,"user","actual-user-action",crypto.randomUUID(),null,null,1,type,JSON.stringify(payload));};
  add("dev-local-creative");add("real-creator-two");add("real-creator-three",{simulation:true});assert.equal((await insights()).metrics.find((metric)=>metric.id==="activeCreators").value,null,"two real creators plus simulation must remain suppressed");
  add("real-creator-three");let report=await insights();assert.equal(report.metrics.find((metric)=>metric.id==="activeCreators").value,3);assert.equal(report.metrics.find((metric)=>metric.id==="activationRate").value,null,"activation is independently suppressed below three completed creator outcomes");assert.equal(report.evidence.find((item)=>item.id==="minimumCohort").status,"passed");assert.doesNotMatch(JSON.stringify(report),/real-creator|actual-user-action/);
  const old=new Date(Date.now()-31*86_400_000).toISOString();
  for(const owner of ["dev-local-creative","real-creator-two","real-creator-three"]){
    add(owner,{document_id:"doc-atmosphere",object_ids:[`historical-${owner}`]},"GenerationCompleted",old);
    add(owner,{document_id:"doc-atmosphere",object_ids:[`retained-${owner}`]},"GenerationCompleted");
    add(owner,{document_id:"doc-atmosphere",cost_microusd:1_000_000},"GenerationUsageRecorded");
    add(owner,{document_id:"doc-atmosphere",source_block_versions:[{block_id:`block-${owner}`,version:1}]},"ContextCompiled");
    add(owner,{document_id:"doc-atmosphere",source_block_versions:[{block_id:`block-${owner}`,version:2}]},"ContextCompiled");
  }
  report=await insights();assert.equal(report.metrics.find((metric)=>metric.id==="activationRate").value,null,"completion alone never demonstrates human retention");assert.equal(report.metrics.find((metric)=>metric.id==="retainedOutcomes").value,null);assert.equal(report.metrics.find((metric)=>metric.id==="costPerRetainedOutcome").value,null);
  for(const owner of ["dev-local-creative","real-creator-two","real-creator-three"]){
    add(owner,{object_id:`historical-${owner}`},"ObjectSaved",old);
    add(owner,{object_id:`retained-${owner}`},"ObjectSaved");
  }
  add("dev-local-creative",{object_id:"retained-dev-local-creative"},"ObjectExported");
  report=await insights();assert.equal(report.metrics.find((metric)=>metric.id==="activationRate").value,"100%");assert.equal(report.metrics.find((metric)=>metric.id==="retainedOutcomes").value,3);assert.equal(report.metrics.find((metric)=>metric.id==="contextReuseRate").value,"100%");assert.equal(report.metrics.find((metric)=>metric.id==="costPerRetainedOutcome").value,"$1.00");assert.equal(report.evidence.find((item)=>item.id==="longitudinal30").status,"passed");assert.equal(report.evidence.find((item)=>item.id==="longitudinal60").status,"pending");assert.equal(report.evidence.find((item)=>item.id==="longitudinal90").status,"pending");
  add("real-creator-three",{object_id:"retained-real-creator-three"},"ObjectDiscarded");report=await insights();assert.equal(report.metrics.find((metric)=>metric.id==="activeCreators").value,3);assert.equal(report.metrics.find((metric)=>metric.id==="retainedOutcomes").value,null,"discarding an outcome below its independent three-creator cohort suppresses the entire measure");
});

test("product insights exclude expired, phantom, forgotten, and low-friction personal attention",async()=>{
  const {database,request}=await productionWorker();
  const owners=["dev-local-creative","attention-creator-two","attention-creator-three"];
  for(const userId of owners.slice(1)){const identity=await specialistIdentity(database,request,userId);assert.equal((await request("/api/events?after=0&content=0",{headers:identity})).status,200);}
  const now=new Date().toISOString(),future=new Date(Date.now()+3_600_000).toISOString(),expired=new Date(Date.now()-60_000).toISOString();
  const append=(owner,type,payload)=>{const stream=`creative:${owner}`,sequence=Number(database.sqlite.prepare("SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?").get(stream).head)+1;database.sqlite.prepare("INSERT INTO events(event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,causation_id,compensates_event_id,schema_version,type,payload) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").run(crypto.randomUUID(),stream,sequence,now,now,"user","actual-attention",crypto.randomUUID(),null,null,1,type,JSON.stringify(payload));};
  const genuine={surface:"studio",context:"writing-direction",terminal_type:"ObjectSaved",terminal_ref:"object:real",active_ms:48_000,idle_ms:5_000,visible_refs:["object:real"],outcome_weight:.2,friction_score:.72,capture_version:"attention-v2",expires_at:future};
  const phantom={surface:"studio",context:"studio-overview",terminal_type:"idle_timeout",terminal_ref:null,active_ms:30_000,idle_ms:30_000,visible_refs:[],outcome_weight:.013,friction_score:0,capture_version:"attention-v2",expires_at:future};
  const insights=async()=>{const response=await request("/api/portfolio/product/insights");assert.equal(response.status,200);return(await response.json()).report;};
  append(owners[0],"AttentionEpisodeObserved",{...genuine,expires_at:expired});append(owners[1],"AttentionEpisodeObserved",phantom);append(owners[2],"AttentionEpisodeObserved",genuine);append(owners[2],"AttentionSignalsForgotten",{});
  let report=await insights();assert.equal(report.metrics.find((metric)=>metric.id==="activeCreators").value,null,"expired, phantom, and explicitly forgotten signals never create an identifiable cohort");assert.equal(report.evidence.find((item)=>item.id==="recentFriction").status,"pending");
  for(const owner of owners)append(owner,"AttentionEpisodeObserved",{...genuine,active_ms:180_000,friction_score:.12});
  report=await insights();assert.equal(report.metrics.find((metric)=>metric.id==="activeCreators").value,3);assert.equal(report.evidence.find((item)=>item.id==="recentFriction").status,"pending","a long successful episode is not product friction");
  for(const owner of owners)append(owner,"AttentionEpisodeObserved",{...genuine,active_ms:48_000,friction_score:.72});
  report=await insights();assert.equal(report.evidence.find((item)=>item.id==="recentFriction").status,"passed","three real short, unexpired, genuinely high-friction episodes produce only a safe aggregate");
});

test("anonymous route telemetry rejects forged audiences and reports genuine bounded engineering percentiles",async()=>{
  const {database,environment,request,context}=await productionWorker();
  const creator=await specialistIdentity(database,request,"performance-creator");
  const body={audience:"creative",routeFamily:"projects",routeSurface:"projects",cacheClass:"miss",routeLatencyMs:120,lcpMs:200,inpMs:30,clsMicrounits:100};
  const post=(headers,payload)=>request("/api/performance",{method:"POST",headers:{...headers,"content-type":"application/json"},body:JSON.stringify(payload)});
  database.reset();const anonymous=await worker.fetch(new Request("https://forma.example/api/performance",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}),environment,context);assert.equal(anonymous.status,401);assert.equal(database.writeCount(),0);
  database.sqlite.prepare("UPDATE users SET consent_version=NULL WHERE user_id=?").run("performance-creator");database.reset();assert.equal((await post(creator,body)).status,428);assert.equal(database.writeCount(),0,"route telemetry requires current participant consent");database.sqlite.prepare("UPDATE users SET consent_version=? WHERE user_id=?").run("pilot-2026-08-10","performance-creator");
  database.reset();assert.equal((await post(creator,{...body,padding:"x".repeat(2100)})).status,413);assert.equal(database.writeCount(),0);
  for(const payload of [
    {...body,audience:"product",routeFamily:"product",routeSurface:"product-delivery"},
    {...body,routeFamily:"share",routeSurface:"shared-document"},
    {...body,routeFamily:"knowledge",routeSurface:"knowledge-patterns"},
    {...body,audience:"product"},
    {...body,userId:"private-account"},
    {...body,routeLatencyMs:-1},
  ]){database.reset();assert.ok([400,403].includes((await post(creator,payload)).status));assert.equal(database.writeCount(),0);}
  const before=database.sqlite.prepare("SELECT COUNT(*) AS count FROM events").get().count;
  assert.equal((await post(creator,body)).status,202);
  assert.equal((await post(creator,body)).status,202);assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM route_performance_samples").get().count,1,"replayed samples are ignored without storing a creator identifier");
  let health=(await(await request("/api/portfolio/engineering/health")).json()).report;assert.equal(health.metrics.find((metric)=>metric.id==="routeLatencyP75").value,null);assert.equal(health.evidence.find((item)=>item.id==="fleetLatency").status,"pending");
  assert.equal((await post(creator,{...body,routeLatencyMs:300,lcpMs:500,inpMs:90,clsMicrounits:300})).status,202);
  assert.equal((await post(creator,{...body,routeLatencyMs:180,lcpMs:350,inpMs:60,clsMicrounits:200})).status,202);
  database.reset();health=(await(await request("/api/portfolio/engineering/health")).json()).report;assert.equal(health.metrics.find((metric)=>metric.id==="routeLatencyP75").value,300);assert.equal(health.metrics.find((metric)=>metric.id==="largestPaintP75").value,500);assert.equal(health.metrics.find((metric)=>metric.id==="interactionP75").value,90);assert.equal(health.metrics.find((metric)=>metric.id==="layoutShiftP75").value,300);assert.equal(health.evidence.find((item)=>item.id==="fleetLatency").status,"passed");
  const batch=database.calls.find((call)=>call.kind==="batch");assert.equal(batch.statements.length,3);assert.equal(batch.statements.some((statement)=>/FROM events/i.test(statement.sql)),false);
  assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM events").get().count,before,"telemetry never appends creator history");
  assert.deepEqual(database.sqlite.prepare("PRAGMA table_info(route_performance_samples)").all().map((column)=>column.name),["sample_id","audience","route_family","route_surface","cache_class","route_latency_ms","lcp_ms","inp_ms","cls_microunits","recorded_at"]);
  assert.doesNotMatch(JSON.stringify(health),/performance-creator|"user_id"|"organization_id"|"project_id"|user_agent/);
  for(const family of ["canvas-projects","canvas-library"]){
    const sample={...body,audience:"canvas",routeFamily:family,routeSurface:family};
    database.reset();assert.equal((await post(creator,sample)).status,403,"a creator without current Canvas approval cannot forge its telemetry");assert.equal(database.writeCount(),0);
    assert.equal((await post({},sample)).status,202,"an entitled Canvas workspace records its own bounded route family");
    assert.equal(database.sqlite.prepare("SELECT audience,route_surface FROM route_performance_samples WHERE route_family=?").get(family).route_surface,family);
  }
});

test("overview and health projections never scan global events; event and synchronization projections do",async()=>{
  const {database,request}=await productionWorker();
  for(const path of ["/api/portfolio/operations/overview","/api/portfolio/engineering/health","/api/portfolio/engineering/jobs"]){database.reset();assert.equal((await request(path)).status,200,path);const batch=database.calls.find((call)=>call.kind==="batch");assert.ok(batch);assert.equal(batch.statements.length,path.endsWith("/health")?3:2,path);assert.equal(batch.statements.some((statement)=>/FROM events/i.test(statement.sql)),false,path);}
  for(const path of ["/api/portfolio/engineering/events","/api/portfolio/engineering/sync"]){database.reset();assert.equal((await request(path)).status,200,path);const batch=database.calls.find((call)=>call.kind==="batch");assert.ok(batch);assert.equal(batch.statements.length,3,path);assert.equal(batch.statements.some((statement)=>/FROM events/i.test(statement.sql)),true,path);}
});

test("capability and delivery migrations safely replay after runtime initialization without altering the schema",async()=>{
  const {database}=await productionWorker();const migrations=await Promise.all(["0011_swift_redwing.sql","0012_green_james_howlett.sql","0013_long_midnight.sql","0014_perfect_robbie_robertson.sql"].map((name)=>readFile(new URL(`../drizzle/${name}`,import.meta.url),"utf8")));
  const snapshot=()=>database.sqlite.prepare("SELECT type,name,sql FROM sqlite_master WHERE type IN ('table','index') ORDER BY type,name").all();const initial=snapshot();
  for(let attempt=0;attempt<2;attempt+=1)for(const migration of migrations)database.sqlite.exec(migration);
  assert.deepEqual(snapshot(),initial);assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table'").get().count,42);assert.ok(initial.some((item)=>item.name==="capability_grants"));assert.ok(initial.some((item)=>item.name==="delivery_decisions"));assert.ok(initial.some((item)=>item.name==="project_event_scopes"));assert.ok(initial.some((item)=>item.name==="organization_invitations"));assert.ok(initial.some((item)=>item.name==="route_performance_samples"));
});

test("creator provenance defaults to human-readable history and exposes Engineering handoffs only to exact event specialists",async()=>{
  const sources=await Promise.all(["forma-workspace.ts","event-inspector.ts"].map((name)=>readFile(new URL(`../src/components/${name}`,import.meta.url),"utf8")));
  for(const source of sources){assert.match(source,/capabilities\?\.includes\("engineering\.events\.read"\)===true/);assert.match(source,/\$\{engineering\?html`<details class="provenance-technical"/);assert.match(source,/workspace\.provenance\.description/);assert.match(source,/setRoute\("\/engineering\/events"\)/);assert.doesNotMatch(source,/Open in Operations|setRoute\("\/operations\/events"\)/);}
});
