import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
import { claimCostBudgetReservation, reserveBudget, reserveCostBudget, settleBudget, settleCostBudget, storePrivateContent } from "../worker/pilot-policy.ts";
import { ensureSchema, sweepExpiredPrivateContent } from "../worker/runtime.ts";
import { EXTRACTOR_EVAL_FIXTURES } from "../src/model/extractors.ts";
import { foldCanvasEvents } from "../src/canvas/model.ts";
import { ownerMediaNamespace } from "../src/model/media-ownership.ts";

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

function adaptivePlanningClient(request,headers,body){
  const send=(action,quote)=>request("/api/document-jobs/adaptive",{method:"POST",headers:{...headers,"content-type":"application/json"},body:JSON.stringify({...body,action,...(quote?{executionId:quote.executionId,approvedBindingHash:quote.bindingHash}:{})})});
  return{
    quote:async()=>{const response=await send("quote");assert.equal(response.status,200,JSON.stringify(await response.clone().json()));return(await response.json()).quote;},
    execute:quote=>send("execute",quote),
  };
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

async function enterpriseWorkspaceFixture({ artifact = false } = {}) {
  const fixture = await productionWorker();
  const { database, environment, request } = fixture;
  const owner = await specialistIdentity(database, request, "enterprise-owner");
  const json = (headers, body, method = "POST") => ({ method, headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) });
  const seeded = await (await request("/api/events?after=0&limit=2000&content=0", { headers: owner })).json();
  const projection = foldEvents(seeded.events, Number.POSITIVE_INFINITY, "doc-atmosphere", "project-atmosphere");
  if (artifact) {
    const now = new Date().toISOString();
    const stream = "creative:enterprise-owner";
    const content = JSON.stringify({ title: "Enterprise output", summary: "Approved work", content_markdown: "# Enterprise output\n\nCustomer-ready narrative.", presentation: null, items: [{ title: "Opening", body: "Customer-ready narrative.", notes: "Speaker note", image_prompt: "", context_group_ids: [], slide: null }] });
    database.sqlite.prepare("INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at) VALUES(?,?,?,?,?,'9999-12-31T23:59:59.999Z',NULL)")
      .run("enterprise-output-content", "enterprise-owner", "document-artifact", content, now);
    const sequence = Number(database.sqlite.prepare("SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?").get(stream).head) + 1;
    database.sqlite.prepare("INSERT INTO events(event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,causation_id,compensates_event_id,schema_version,type,payload) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run("enterprise-output-event", stream, sequence, now, now, "worker:renderer", "enterprise-test", crypto.randomUUID(), null, null, 1, "DocumentRenderCompleted", JSON.stringify({ project_id: "project-atmosphere", document_id: "doc-atmosphere", artifact_id: "enterprise-output", artifact_kind: "short_story", title: "Enterprise output", summary: "Approved work", item_count: 1, items: [{ id: "opening", title: "Opening", body: "Receipt" }], content_ref: "enterprise-output-content", source_block_versions: projection.blocks.map((block) => ({ block_id: block.id, version: block.sourceEvents.length })), requested_by_user_id: "enterprise-owner" }));
  }
  const organization = await request("/api/workspaces", json(owner, { name: "Enterprise organization" }));
  assert.equal(organization.status, 201);
  const organizationId = (await organization.json()).organizationId;
  const project = await request(`/api/workspaces/${organizationId}/projects`, json(owner, { projectId: "project-atmosphere" }));
  assert.equal(project.status, 201, JSON.stringify(await project.clone().json()));
  const projectAccessId = (await project.json()).projectAccessId;
  const open = async (headers, access = projectAccessId) => {
    const response = await request(`/api/workspaces/${organizationId}/projects/${access}/context`, { method: "POST", headers });
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    return { ...headers, cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "" };
  };
  return { ...fixture, environment, owner, organizationId, projectAccessId, projection, json, open };
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
    "/studio/project": ["workspace", false, true], "/document/document-1": ["workspace", true, true],
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
  assert.match(store, /fetch\("\/api\/events\?after="\+this\.head\.get\(\)\+"&limit=1&content=1"\+\(required!=="all"\?"&contentScope="\+required:""\)\)/, "chat/memory hydration keeps its exact scope; all-content hydration omits the scope parameter");
  assert.match(store, /profile==="memory"\?"memory"/);
  assert.match(store, /const body=await response\.json\(\) as \{content\?:Record<string,string>\};this\.#assertSourceRead\(read\);this\.#assertSourceOwnership\(source\)/, "private hydration verifies its original read and source ownership after the body await");
  assert.match(store, /this\.#publishSourceContent\(read,\(\)=>\{this\.#privateContentScope=required;if\(Object\.keys\(content\)\.length\)this\.#mergeSourceContent\(read,content\);\}\)/);
  assert.match(store, /const previous=this\.content\.get\(\),next=replace\?\{\.\.\.incoming\}:\{\.\.\.previous,\.\.\.incoming\}/, "owned partial hydration merges retained content instead of replacing it");
  assert.match(store, /this\.content\.set\(next\)/);
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
  assert.equal(batch?.statements.length, 7);
  assert.match(batch.statements[2].sql, /stream_id NOT IN \(SELECT fictional_stream_id/);
  assert.match(batch.statements[2].sql, /SELECT event_id e,stream_id s,sequence q,occurred_at o,actor a,type t,CASE/);
  assert.match(batch.statements[2].sql, /json_remove\(payload,'\$\.compiled_snapshot'\)/);
  assert.doesNotMatch(batch.statements[2].sql, /SELECT \* FROM events/);
  assert.ok(database.calls.length <= 3, `expected admin authentication plus one combined dashboard/live batch and a final access proof, received ${database.calls.length}`);
  assert.equal(database.writeCount(), 0);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  await drainBackground();
  database.reset();
  const synthetic = await request("/api/analytics?days=all&includeSynthetic=true");
  assert.equal(synthetic.status, 200);
  const included = database.calls.find((call) => call.kind === "batch");
  assert.equal(included?.statements.length, 7);
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
  assert.equal(initialBody.report.dimensions.user.some((item)=>item.id===collaborator||item.label==="Original collaborator"),false,"an unrelated creator never enters another principal's analytics");
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
  assert.equal(incremental?.statements.length, 6);
  const delta = incremental.statements[2];
  assert.match(delta.sql, /rowid>\?/);
  assert.match(database.sqlite.prepare(`EXPLAIN QUERY PLAN ${delta.sql}`).all(...delta.values).map((step) => step.detail).join(" "), /INTEGER PRIMARY KEY \(rowid>\?\)/);
  const deltaBytes = JSON.stringify(database.sqlite.prepare(delta.sql).all(...delta.values)).length;
  assert.ok(deltaBytes < coldBytes / 20, `expected meaningful transfer reduction: ${coldBytes} -> ${deltaBytes}`);
  assert.ok(database.calls.length <= 3,`cold analytics should use at most three D1 round trips including the final access proof; observed ${JSON.stringify(database.calls.map((call)=>({kind:call.kind,sql:call.sql.slice(0,160)})))}`);
  assert.equal(database.writeCount(), 0);

  addCorrelatedTerminal(database.sqlite, "creative:dev-local-creative", "analytics-new-event");
  database.sqlite.prepare("UPDATE users SET display_name=? WHERE user_id=?").run("Renamed collaborator", collaborator);
  database.reset();
  const changed = await request("/api/analytics?days=all");
  const changedBody = await changed.json();
  assert.equal(changed.headers.get("x-forma-analytics-cache"), "delta");
  assert.equal(changed.headers.get("x-forma-analytics-source-rows"), "1");
  assert.equal(changedBody.report.source.eventCount, initialBody.report.source.eventCount + 1);
  assert.equal(changedBody.report.dimensions.user.some((item) => item.label === "Renamed collaborator"),false,"renaming an unrelated principal cannot make their activity visible");
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
  await drainBackground();
  database.reset();
  const cold = await coldRequest("/api/analytics?days=all");
  const current = (await cold.json()).report;
  assert.equal(cold.headers.get("x-forma-analytics-cache"), "durable");
  assert.equal(cold.headers.get("x-forma-analytics-source-rows"), "1");
  assert.equal(cold.headers.get("cache-control"), "private, no-store");
  assert.equal(current.source.eventCount, baseline.source.eventCount + 1);
  const batch = database.calls.find((call) => call.kind === "batch");
  assert.equal(batch?.statements.length, 7);
  assert.match(batch.statements[2].sql, /WITH snapshot\(head\) AS MATERIALIZED/);
  const plan = database.sqlite.prepare(`EXPLAIN QUERY PLAN ${batch.statements[2].sql}`).all(...batch.statements[2].values);
  assert.match(plan.map((step) => step.detail).join(" "), /INTEGER PRIMARY KEY \(rowid>\?\)/);
  assert.match(plan.map((step) => step.detail).join(" "), /idx_events_nonphantom_stream_sequence/);
  assert.ok(database.calls.length <= 3,`cold analytics should use at most three D1 round trips including the final access proof; observed ${JSON.stringify(database.calls.map((call)=>({kind:call.kind,sql:call.sql.slice(0,160)})))}`);
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
  assert.ok(!(await initial.json()).report.dimensions.user.some((item) => item.id === fictional),"an unrelated account is never visible before it becomes this principal's explicitly owned fictional persona");
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
  assert.ok(!initialReport.dimensions.user.some((item) => item.id === fictional),"an unrelated account cannot appear merely because it has an event stream");
  database.sqlite.prepare("INSERT INTO replay_personas(persona_id,session_id,owner_id,fictional_user_id,fictional_stream_id,display_name,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").run("analytics-persona", "analytics-replay", "dev-local-creative", fictional, `creative:${fictional}`, "Fictional account", "ready", now, now);

  database.reset();
  const hidden = await request("/api/analytics?days=all");
  assert.equal(hidden.headers.get("x-forma-analytics-cache"), "miss");
  assert.ok(!(await hidden.json()).report.dimensions.user.some((item) => item.id === fictional));

  database.sqlite.prepare("UPDATE replay_personas SET status='preparing' WHERE persona_id=?").run("analytics-persona");
  database.reset();
  const visible = await request("/api/analytics?days=all");
  assert.equal(visible.headers.get("x-forma-analytics-cache"), "miss");
  assert.ok(!(await visible.json()).report.dimensions.user.some((item) => item.id === fictional),"an inactive fictional persona never reclassifies as an authorized real account");

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
  assert.ok(analytics.report.source.eventCount<5_000);assert.match(database.calls.find((call)=>call.kind==="batch")?.statements[2].sql??"",/capture_version/);assert.ok(database.calls.length<=3);assert.equal(database.writeCount(),0);
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

test("anonymous soundtrack views redact unapproved source notes and withdraw embedded transcripts when recording rights end",async()=>{
  const{database,environment,request}=await productionWorker(),owner="dev-local-creative",stream=`creative:${owner}`,now=new Date().toISOString(),namespace=ownerMediaNamespace(owner);environment.MEDIA={get:async()=>({customMetadata:{ownerId:owner}})};
  const originalUrl=`/api/media/${encodeURIComponent(`${namespace}/private-voice.mp3`)}`,generatedUrl=`/api/media/${encodeURIComponent(`${namespace}/generated-score.mp3`)}`,videoUrl=`/api/media/${encodeURIComponent(`${namespace}/private-voice-video.mp4`)}`;
  let sequence=Number(database.sqlite.prepare("SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?").get(stream).head);
  const statement=database.sqlite.prepare("INSERT INTO events(event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,causation_id,compensates_event_id,schema_version,type,payload) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)");
  const append=(type,payload)=>{sequence=Math.max(sequence,Number(database.sqlite.prepare("SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?").get(stream).head));return statement.run(crypto.randomUUID(),stream,++sequence,now,now,"user","soundtrack-share-test",crypto.randomUUID(),null,null,1,type,JSON.stringify(payload));};
  append("BlockCreated",{block_id:"voice-source",document_id:"doc-atmosphere",project_id:"project-atmosphere",type:"audio",handle:"audio/private-voice",position:"z-audio-1",properties:{label:"Patient consultation",media_url:originalUrl,source_mime_type:"audio/mpeg",media_type:"audio/mpeg",rights_class:"owned_or_licensed",include_in_output:true,inform_generation:true}});
  append("BlockCreated",{block_id:"generated-source",document_id:"doc-atmosphere",project_id:"project-atmosphere",type:"audio",handle:"audio/reused-generated",position:"z-audio-2",properties:{label:"Approved accompaniment",media_url:generatedUrl,source_mime_type:"audio/mpeg",media_type:"audio/mpeg",rights_class:"account-generated",include_in_output:true,inform_generation:false,description:"PRIVATE SOURCE DESCRIPTION",text:"PRIVATE SOURCE TEXT",artifact_markdown:"PRIVATE SOURCE MANUSCRIPT",artifact_summary:"PRIVATE SOURCE SUMMARY",artifact_structure:{items:[{body:"PRIVATE SOURCE NOTES"}]}}});
  append("DocumentRenderCompleted",{artifact_id:"voice-video",artifact_kind:"video",document_id:"doc-atmosphere",project_id:"project-atmosphere",title:"Approved video",summary:"Public result",item_count:1,items:[],media_url:videoUrl,media_type:"video/mp4",settings:{soundtrack_assets:[{block_id:"voice-source",label:"Patient consultation",media_url:originalUrl,media_type:"audio/mpeg",inclusion:"provider-soundtrack-reference",provider_audio_transmitted:true,transcript:"MY PRIVATE MEDICAL DIAGNOSIS"}]}});
  append("DocumentRenderCompleted",{artifact_id:"companion-storyboard",artifact_kind:"storyboard",document_id:"doc-atmosphere",project_id:"project-atmosphere",title:"Approved storyboard",summary:"Public frames",item_count:1,items:[],settings:{soundtrack_assets:[{block_id:"generated-source",label:"Approved accompaniment",media_url:generatedUrl,media_type:"audio/mpeg",inclusion:"separate-playback-companion",provider_audio_transmitted:false}]}});
  const created=await request("/api/shares",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({resourceKind:"document",documentId:"doc-atmosphere",projectId:"project-atmosphere",expiresHours:1})});assert.equal(created.status,200,JSON.stringify(await created.clone().json()));const{share}=await created.json();
  let response=await request(`/api/shared/${encodeURIComponent(share.token)}`);assert.equal(response.status,200);let shared=await response.json();let video=shared.projection.artifacts.find((artifact)=>artifact.id==="voice-video");assert.equal(video.settings.soundtrack_transcripts[0].transcript,"MY PRIVATE MEDICAL DIAGNOSIS");assert.doesNotMatch(JSON.stringify(shared.projection.blocks),/PRIVATE SOURCE DESCRIPTION|PRIVATE SOURCE TEXT|PRIVATE SOURCE MANUSCRIPT|PRIVATE SOURCE SUMMARY|PRIVATE SOURCE NOTES/);
  append("BlockPropertyEdited",{block_id:"voice-source",property_path:"rights_revoked",old_value:null,new_value:true});response=await request(`/api/shared/${encodeURIComponent(share.token)}`);assert.equal(response.status,200);shared=await response.json();video=shared.projection.artifacts.find((artifact)=>artifact.id==="voice-video");assert.equal(video.mediaUrl,null);assert.equal(video.settings?.soundtrack_transcripts,undefined);assert.doesNotMatch(JSON.stringify(shared),/MY PRIVATE MEDICAL DIAGNOSIS|Patient consultation/);
  append("BlockPropertyEdited",{block_id:"voice-source",property_path:"rights_revoked",old_value:true,new_value:false});append("BlockPropertyEdited",{block_id:"voice-source",property_path:"license_expires_at",old_value:null,new_value:"2020-01-01T00:00:00.000Z"});response=await request(`/api/shared/${encodeURIComponent(share.token)}`);assert.equal(response.status,200);shared=await response.json();video=shared.projection.artifacts.find((artifact)=>artifact.id==="voice-video");assert.equal(video.mediaUrl,null);assert.equal(video.settings?.soundtrack_transcripts,undefined);assert.doesNotMatch(JSON.stringify(shared),/MY PRIVATE MEDICAL DIAGNOSIS|Patient consultation/);
});

test("anonymous shared presentation endpoints release only audience content, public attribution, and opaque same-context format groups",async()=>{
  const {database,request}=await productionWorker();
  const owner="dev-local-creative",stream=`creative:${owner}`,now=new Date().toISOString(),future=new Date(Date.now()+3_600_000).toISOString();
  const sourceId="PRIVATE_AUTHORIZED_PRESENTATION_SOURCE_7249",claimId="PRIVATE_AUTHORIZED_PRESENTATION_CLAIM_7249",groupId="PRIVATE_AUTHORIZED_PRESENTATION_GROUP_7249";
  const slide={layout:"scorecard",kicker:"Protected source evidence",bullets:[],sourceIds:[sourceId,claimId,groupId],quote:{text:"Customers need complete attributable evidence.",speaker:"Product Owner",role:"Product Owner",citation:"World Health Organization Research",sourceId:claimId,source_key:claimId},citations:[{label:"Narrative brief",anchor:"Slide 1",excerpt:"PRIVATE_ADAPTER_CITATION_EXCERPT_7249",sourceId:groupId},{label:"World Health Organization Research",anchor:"2025 published survey",excerpt:"PRIVATE_LICENSED_RESEARCH_EXCERPT_7249",sourceId:groupId,sourceKey:groupId,claimId}],visual:{kind:"scorecard",label:"Assessment",value:"39.75",data:[{label:"Phone",value:"39.75",sourceIds:[sourceId],sourceAliasMap:{blk_001:sourceId},blockId:sourceId,groupId}]}};
  const content={title:"Shareable executive evidence",summary:"A safe public review view.",content_markdown:"# Shareable executive evidence\n\nPhone: 39.75\n\n[Sources] PRIVATE_SLIDE_MARKDOWN_EVIDENCE_7249\n\nSpeaker notes: PRIVATE_MARKDOWN_PRESENTER_NOTES_7249",presentation:null,items:[{title:"Visible customer evidence",body:"Phone: 39.75",notes:"PRIVATE_PRESENTER_NOTES_7249",image_prompt:"PRIVATE_PRODUCER_PROMPT_7249",context_group_ids:[groupId],slide}]};
  database.sqlite.prepare("INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at) VALUES(?,?,?,?,?,?,NULL)").run("presentation-anonymous-content",owner,"document-artifact",JSON.stringify(content),now,future);
  const sequence=Number(database.sqlite.prepare("SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?").get(stream).head)+1;
  const insertEvent=database.sqlite.prepare("INSERT INTO events(event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,causation_id,compensates_event_id,schema_version,type,payload) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)");
  insertEvent.run(crypto.randomUUID(),stream,sequence,now,now,"user","anonymous-presentation-test",crypto.randomUUID(),null,null,1,"BlockCreated",JSON.stringify({block_id:"public-imported-block",document_id:"doc-atmosphere",project_id:"project-atmosphere",type:"direction",handle:"direction/public-imported-evidence",position:"z7249",properties:{text:"Visible imported customer decision",organization_context_source_block_id:"PRIVATE_IMPORTED_SOURCE_BLOCK_7249",organization_context_package_id:"PRIVATE_IMPORTED_PACKAGE_7249",organization_context_package_version_id:"PRIVATE_IMPORTED_VERSION_7249",organization_context_package_binding_id:"PRIVATE_IMPORTED_BINDING_7249",source_claim_ref:"PRIVATE_IMPORTED_CLAIM_7249",source_event_refs:["PRIVATE_IMPORTED_EVENT_7249"],source_block_versions:[{block_id:"PRIVATE_IMPORTED_VERSION_BLOCK_7249",version:7}],context_fingerprint:"PRIVATE_IMPORTED_FINGERPRINT_7249",combined_context_memberships:[{context_set_id:"PRIVATE_IMPORTED_CONTEXT_GROUP_7249",name:"Visible authored source chapter",role:"slide_chapter"}]}}));
  insertEvent.run(crypto.randomUUID(),stream,sequence+1,now,now,"user","anonymous-presentation-test",crypto.randomUUID(),null,null,1,"BlockCreated",JSON.stringify({block_id:"private-reference-block",document_id:"doc-atmosphere",project_id:"project-atmosphere",type:"reference",handle:"reference/private-licensed-evidence",position:"z7250",properties:{label:"Licensed research reference",source_kind:"text",source_type:"pasted-text",source_mime_type:"text/plain",text:"PRIVATE_LICENSED_SOURCE_PASSAGE_7249",description:"PRIVATE_SOURCE_DESCRIPTION_7249",source_citations:[{label:"Private interview",excerpt:"PRIVATE_CONTEXT_SOURCE_CITATION_7249"}]}}));
  const sourceVersions=[{block_id:"private-reference-block",version:1},{block_id:"public-imported-block",version:1}];
  const sharedRevision={context_revision:"PRIVATE_CONTEXT_REVISION_7249",context_fingerprint:"PRIVATE_CONTEXT_FINGERPRINT_7249",source_block_versions:sourceVersions};
  insertEvent.run(crypto.randomUUID(),stream,sequence+2,now,now,"worker:renderer","anonymous-presentation-test",crypto.randomUUID(),null,null,1,"DocumentRenderCompleted",JSON.stringify({artifact_id:"anonymous-presentation",artifact_kind:"slides",document_id:"doc-atmosphere",project_id:"project-atmosphere",title:content.title,summary:content.summary,content_ref:"presentation-anonymous-content",item_count:1,items:[{id:"anonymous-presentation-slide-1",title:"Visible customer evidence",slide}],...sharedRevision}));
  insertEvent.run(crypto.randomUUID(),stream,sequence+3,now,now,"worker:renderer","anonymous-presentation-test",crypto.randomUUID(),null,null,1,"DocumentRenderCompleted",JSON.stringify({artifact_id:"anonymous-narrative",artifact_kind:"short_story",document_id:"doc-atmosphere",project_id:"project-atmosphere",title:"The same context as a narrative",summary:"One context, another approved medium.",item_count:1,items:[{id:"anonymous-narrative-part-1",title:"Visible customer evidence",body:"Phone: 39.75"}],...sharedRevision}));
  insertEvent.run(crypto.randomUUID(),stream,sequence+4,now,now,"worker:renderer","anonymous-presentation-test",crypto.randomUUID(),null,null,1,"DocumentRenderCompleted",JSON.stringify({artifact_id:"anonymous-stale-narrative",artifact_kind:"scene",document_id:"doc-atmosphere",project_id:"project-atmosphere",title:"An older context revision",summary:"Never grouped with current approved forms.",item_count:1,items:[{id:"anonymous-stale-scene-1",title:"Previous customer evidence"}],context_revision:"PRIVATE_STALE_CONTEXT_REVISION_7249",source_block_versions:[{block_id:"public-imported-block",version:0}]}));
  const created=await request("/api/shares",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({resourceKind:"document",documentId:"doc-atmosphere",projectId:"project-atmosphere",expiresHours:1})});
  assert.equal(created.status,200,JSON.stringify(await created.clone().json()));
  const {share}=await created.json();
  const shared=await request(`/api/shared/${encodeURIComponent(share.token)}`);
  assert.equal(shared.status,200,JSON.stringify(await shared.clone().json()));
  const body=await shared.json();
  const presentation=body.projection.artifacts.find((artifact)=>artifact.id==="anonymous-presentation");
  assert.ok(presentation);
  assert.equal(presentation.items[0].slide.visual.data[0].label,"Phone");
  assert.equal(presentation.items[0].slide.visual.data[0].value,"39.75");
  assert.equal(presentation.items[0].slide.quote.role,"Product Owner");
  assert.equal(presentation.items[0].slide.quote.citation,"World Health Organization Research");
  assert.deepEqual(presentation.items[0].slide.citations,[{label:"World Health Organization Research",anchor:"2025 published survey",excerpt:""}]);
  assert.equal("notes" in presentation.items[0],false,"private presenter notes never enter the anonymous server response");
  assert.equal(presentation.contentMarkdown,null,"private presentation markdown cannot bypass the delivery projection");
  const sameContext=body.projection.artifacts.find((artifact)=>artifact.id==="anonymous-narrative");
  const staleContext=body.projection.artifacts.find((artifact)=>artifact.id==="anonymous-stale-narrative");
  assert.match(presentation.contextRevision,/^revision-\d+$/);
  assert.equal(sameContext.contextRevision,presentation.contextRevision,"only identical trusted source revisions form recipient-selectable alternatives");
  assert.notEqual(staleContext.contextRevision,presentation.contextRevision,"older source revisions cannot masquerade as the same recipient experience");
  const imported=body.projection.blocks.find((block)=>block.id==="public-imported-block");
  assert.equal(imported.properties.text,"Visible imported customer decision");
  assert.equal(imported.properties.combined_context_memberships[0].name,"Visible authored source chapter");
  assert.equal(imported.properties.combined_context_memberships[0].role,"slide_chapter");
  const reference=body.projection.blocks.find((block)=>block.id==="private-reference-block");
  assert.deepEqual(reference.properties,{label:"Licensed research reference",source_kind:"text",source_type:"pasted-text",source_mime_type:"text/plain"});
  assert.doesNotMatch(JSON.stringify(body),/PRIVATE_|Narrative brief|\[Sources\]|Speaker notes|sourceIds|source_ids|sourceId|source_id|sourceKey|source_key|sourceAliasMap|blockId|claimId|groupId|contextGroupIds|context_group_ids|context_set_id|organization_context_(?:package|source)|source_claim_ref|source_event_refs|source_block_versions|context_fingerprint/);
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
    sourceContextHead:Number(database.sqlite.prepare("SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=? AND type IN('ProjectCreated','ProjectRenamed','ProjectStateChanged','DocumentCreated','DocumentForked','DocumentRenamed','DocumentRemoved','DocumentRestored','BlockCreated','BlockRenamed','BlockPropertyEdited','BlockWeightSet','BlockLocked','BlockUnlocked','BlockRemoved','BlockRestored','BlockRelationAdded','BlockRelationRemoved','ReferenceIngested','RightsAsserted','ChipEdited','ObjectPinned','ObjectUnpinned','CanvasCreated','CanvasRenamed','CanvasRemoved','CanvasRestored','CanvasItemPlaced','CanvasReferenceCreated','CanvasItemRemoved','CanvasItemRestored','CanvasTextApplied','CanvasRegisterSet','ContextSetFormalized')").get(`creative:${owner}`).head),
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
  database.reset();const readerPlanningJobs=await request("/api/document-jobs",{headers:scoped});assert.equal(readerPlanningJobs.status,200);assert.deepEqual((await readerPlanningJobs.json()).jobs,[]);assert.equal(database.writeCount(),0,"a reader sees no other actor's planning jobs and polling stays read-only");
  database.reset();assert.equal((await request("/api/shares",{headers:scoped})).status,403);assert.equal(database.writeCount(),0);
  database.reset();assert.equal((await request("/api/document-jobs",json(scoped,{kind:"generate",documentId:"doc-atmosphere",payload:{}}))).status,403);assert.equal(database.writeCount(),0,"readable planning history never grants a new paid request");
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
  assert.equal(database.sqlite.prepare("SELECT event.actor FROM events event JOIN event_private_payloads secret ON secret.private_event_id=event.event_id AND secret.owner_id=? WHERE json_extract(secret.private_json,'$.new_value')=?").get("workspace-owner-a","AUTHORIZED COLLABORATIVE EDIT").actor,"user:workspace-collaborator");
  assert.equal(database.sqlite.prepare("SELECT 1 FROM events WHERE instr(payload,?)>0").get("AUTHORIZED COLLABORATIVE EDIT"),undefined,"authored collaborative prose never appears in immutable event payloads");
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
    {type:"ReferenceIngested",payload:{reference_id:"reference-collaborative",source_type:"upload",source_ref:uploaded.url,content_hash:uploaded.contentHash,rights_class:"asserted"}},
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

test("viewer-only independent review, governed release, source attestation, artifact revision, and revocation work through real worker endpoints",async()=>{
  const {database,environment,request}=await productionWorker();
  const media=new Map();
  environment.MEDIA={
    async put(key,value,options={}){const bytes=value instanceof ArrayBuffer?value:await new Response(value).arrayBuffer();media.set(key,{bytes,metadata:options.customMetadata??{},mime:options.httpMetadata?.contentType??"application/octet-stream"});},
    async get(key){const item=media.get(key);return item?{body:new Response(item.bytes).body,httpEtag:"test-etag",customMetadata:item.metadata,writeHttpMetadata(headers){headers.set("content-type",item.mime);}}:null;},
    async head(key){const item=media.get(key);return item?{httpEtag:"test-etag",customMetadata:item.metadata}:null;},
    async delete(key){media.delete(key);},
    async list(){return{objects:[],truncated:false};},
  };
  const owner=await specialistIdentity(database,request,"governed-review-owner");
  const reviewer=await specialistIdentity(database,request,"governed-review-viewer");
  const json=(headers,body,method="POST")=>({method,headers:{...headers,"content-type":"application/json"},body:JSON.stringify(body)});
  const seeded=await(await request("/api/events?after=0&limit=1000&content=0",{headers:owner})).json();
  const projection=foldEvents(seeded.events,Number.POSITIVE_INFINITY,"doc-atmosphere","project-atmosphere");
  const versions=projection.blocks.map((block)=>({block_id:block.id,version:block.sourceEvents.length}));
  assert.ok(versions.length,"the finished output must bind every actual source decision");
  const timestamp=new Date().toISOString(),expires="9999-12-31T23:59:59.999Z",stream="creative:governed-review-owner";
  const manuscript={title:"Governed deliverable",summary:"A verified customer-ready narrative.",content_markdown:"# Governed deliverable\n\nInitial approved manuscript.",presentation:null,items:[{title:"Opening",body:"Initial approved manuscript.",notes:"Original note",image_prompt:"",context_group_ids:[],slide:null}]};
  database.sqlite.prepare("INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at) VALUES(?,?,?,?,?,?,NULL)").run("governed-output-content","governed-review-owner","document-artifact",JSON.stringify(manuscript),timestamp,expires);
  const head=Number(database.sqlite.prepare("SELECT MAX(sequence) AS head FROM events WHERE stream_id=?").get(stream).head);
  database.sqlite.prepare("INSERT INTO events(event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,causation_id,compensates_event_id,schema_version,type,payload) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run("governed-output-event",stream,head+1,timestamp,timestamp,"worker:renderer","test",crypto.randomUUID(),null,null,1,"DocumentRenderCompleted",JSON.stringify({project_id:"project-atmosphere",document_id:"doc-atmosphere",artifact_id:"governed-output",artifact_kind:"short_story",title:manuscript.title,summary:manuscript.summary,item_count:1,items:[{id:"governed-opening",title:"Opening",body:"Receipt-only summary"}],content_ref:"governed-output-content",source_block_versions:versions,requested_by_user_id:"governed-review-owner"}));
  const organization=await request("/api/workspaces",json(owner,{name:"Governed review organization"}));assert.equal(organization.status,201);const organizationId=(await organization.json()).organizationId;
  const registered=await request(`/api/workspaces/${organizationId}/projects`,json(owner,{projectId:"project-atmosphere"}));assert.equal(registered.status,201,JSON.stringify(await registered.clone().json()));const projectId=(await registered.json()).projectAccessId;
  const invitation=await(await request(`/api/workspaces/${organizationId}/members`,json(owner,{email:"governed-review-viewer@example.test",role:"member"}))).json();
  assert.equal((await request(`/api/workspaces/${organizationId}/invitations/${invitation.invitationId}/accept`,json(reviewer,{token:new URL(invitation.invitationUrl).searchParams.get("token")}))).status,200);
  assert.equal((await request(`/api/workspaces/${organizationId}/projects/${projectId}/members`,json(owner,{userId:"governed-review-viewer",role:"viewer"}))).status,201);
  const membershipId=database.sqlite.prepare("SELECT membership_id FROM project_memberships WHERE project_access_id=? AND user_id=?").get(projectId,"governed-review-viewer").membership_id;
  const memberPath=`/api/workspaces/${organizationId}/projects/${projectId}/members/${membershipId}`;
  const open=async(identity)=>{const opened=await request(`/api/workspaces/${organizationId}/projects/${projectId}/context`,{method:"POST",headers:identity});assert.equal(opened.status,200);return{...identity,cookie:opened.headers.get("set-cookie")?.split(";")[0]??""};};
  let reviewerScope=await open(reviewer);const ownerScope=await open(owner);
  const binding=()=>({artifact_revision:Number(database.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE stream_id=? AND type='DocumentArtifactEdited' AND json_extract(payload,'$.artifact_id')='governed-output'").get(stream).count),content_sha256:createHash("sha256").update(database.sqlite.prepare("SELECT content FROM private_content WHERE content_id='governed-output-content'").get().content).digest("hex")});
  const action=(type)=>({type,payload:{artifact_id:"governed-output",artifact_kind:"short_story",document_id:"doc-atmosphere",...binding(),source_block_versions:versions,...(type==="ArtifactReviewRequested"?{assigned_reviewer_user_id:"governed-review-viewer"}:{})}});
  const append=(identity,event)=>request("/api/events",json(identity,{action:"append",event}));
  const revise=(identity,markdown,expectedRevision)=>request("/api/artifacts/governed-output",json(identity,{markdown,expectedRevision},"PATCH"));
  assert.equal((await append(reviewerScope,action("ArtifactApproved"))).status,403,"viewer has no ambient approval authority");
  assert.equal((await revise(reviewerScope,"Forbidden viewer edit",0)).status,403,"read-only reviewer cannot alter the retained output");
  database.reset();const reviewerPlanningJobs=await request("/api/document-jobs",{headers:reviewerScope});assert.equal(reviewerPlanningJobs.status,200);assert.deepEqual((await reviewerPlanningJobs.json()).jobs,[]);assert.equal(database.writeCount(),0,"review access exposes neither another actor's jobs nor new writes");
  database.reset();assert.equal((await request("/api/document-jobs",json(reviewerScope,{kind:"generate",documentId:"doc-atmosphere",payload:{}}))).status,403);assert.equal(database.writeCount(),0,"review access never grants paid queue admission");
  const unapprovedShare=await request("/api/shares",json(ownerScope,{resourceKind:"document",documentId:"doc-atmosphere",projectId:"project-atmosphere"}));assert.equal(unapprovedShare.status,409,JSON.stringify(await unapprovedShare.json()));
  const unapprovedExport=await append(reviewerScope,{type:"DocumentArtifactExported",payload:{artifact_id:"governed-output",document_id:"doc-atmosphere",format:"markdown"}});assert.equal(unapprovedExport.status,409);
  assert.equal((await request(memberPath,json(owner,{reviewAccess:true},"PATCH"))).status,200,"customer owner can delegate approval directly to a viewer");
  assert.equal((await request(memberPath,json(owner,{reviewAccess:true},"PATCH"))).status,409,"duplicate reviewer grants cannot accumulate");
  const members=await(await request(`/api/workspaces/${organizationId}/projects/${projectId}/members`,{headers:owner})).json();assert.equal(members.members.find((member)=>member.user_id==="governed-review-viewer").review_access,1);assert.equal(members.members.find((member)=>member.user_id==="governed-review-owner").role,"owner");assert.equal(members.members.find((member)=>member.user_id==="governed-review-owner").review_access,1,"an eligible non-contributing project owner remains discoverable for independent teammate review");
  const session=await(await request("/api/session",{headers:reviewerScope})).json();assert.equal(session.projectContext.permissions.includes("project.review.approve"),true);assert.equal(session.projectContext.permissions.includes("project.author"),false);assert.equal(session.projectContext.permissions.includes("project.output.request"),false);
  const unassigned=action("ArtifactReviewRequested");delete unassigned.payload.assigned_reviewer_user_id;
  assert.equal((await append(ownerScope,unassigned)).status,200,"legacy unassigned review remains readable project history");
  assert.equal((await append(reviewerScope,action("ArtifactApproved"))).status,200);
  database.reset();const unassignedRelease=await append(reviewerScope,{type:"DocumentArtifactExported",payload:{artifact_id:"governed-output",document_id:"doc-atmosphere",format:"markdown",...binding()}});
  assert.equal(unassignedRelease.status,409);assert.equal((await unassignedRelease.json()).error,"artifact_approval_required");assert.equal(database.writeCount(),0,"legacy approval without a named reviewer is not exact delivery authorization");
  const submitted=await append(ownerScope,action("ArtifactReviewRequested"));assert.equal(submitted.status,200,JSON.stringify(await submitted.clone().json()));
  assert.equal((await submitted.clone().json()).appended[0].payload.assigned_reviewer_user_id,"governed-review-viewer","the actual owner request names its independent reviewer");
  assert.equal((await append(ownerScope,action("ArtifactApproved"))).status,403,"creator/requester cannot approve their own deliverable");
  const mixed=await request("/api/events",json(ownerScope,{action:"batch",events:[{type:"BlockPropertyEdited",payload:{block_id:versions[0].block_id,property_path:"text",new_value:"Race attempt"}},action("ArtifactApproved")]}));assert.equal(mixed.status,409,"context mutations cannot hide in an approval batch");
  const approved=await append(reviewerScope,action("ArtifactApproved"));assert.equal(approved.status,200,JSON.stringify(await approved.clone().json()));
  const ownerNotifications=await(await request("/api/project-notifications",{headers:ownerScope})).json();assert.ok(ownerNotifications.notifications.some((notification)=>notification.kind==="output_approved"));
  const released=await append(reviewerScope,{type:"DocumentArtifactExported",payload:{artifact_id:"governed-output",document_id:"doc-atmosphere",format:"markdown",...binding()}});assert.equal(released.status,200,JSON.stringify(await released.clone().json()));
  const createdShare=await request("/api/shares",json(ownerScope,{resourceKind:"document",documentId:"doc-atmosphere",projectId:"project-atmosphere"}));assert.equal(createdShare.status,200,JSON.stringify(await createdShare.clone().json()));const share=(await createdShare.json()).share;
  assert.equal((await request(`/api/shared/${encodeURIComponent(share.token)}`)).status,200,"only independently approved governed work reaches an external link");
  const edit=await revise(owner,"# Governed deliverable\n\nOwner-corrected final manuscript.",0);assert.equal(edit.status,200,JSON.stringify(await edit.clone().json()));const revised=await edit.json();assert.equal(revised.revision,1);assert.equal(revised.appended[0].streamId,stream,"an implicit project-owner correction returns the owner's real account event stream");assert.equal(revised.head,Number(database.sqlite.prepare("SELECT MAX(sequence) AS head FROM events WHERE stream_id=?").get(stream).head),"an owner working outside project mode receives the actual account-stream cursor");assert.match(JSON.parse(database.sqlite.prepare("SELECT content FROM private_content WHERE content_id='governed-output-content'").get().content).content_markdown,/Owner-corrected/);
  const revisionHistory=await request("/api/artifacts/governed-output/revisions",{headers:reviewerScope});assert.equal(revisionHistory.status,200);const retainedHistory=await revisionHistory.json();assert.deepEqual(retainedHistory.revisions.map((entry)=>entry.revision),[1,0]);assert.equal(retainedHistory.revisions[0].current,true,"the current corrected body and actual original are independently recoverable");
  assert.equal(retainedHistory.revisions[0].createdByUserId,"governed-review-owner");assert.equal(retainedHistory.revisions[1].createdByUserId,"governed-review-owner","the original revision credits the actual generating user");
  const earlier=await request("/api/artifacts/governed-output/revisions?before=1",{headers:reviewerScope});assert.equal(earlier.status,200);assert.deepEqual((await earlier.json()).revisions.map((entry)=>entry.revision),[0]);assert.equal((await request("/api/artifacts/governed-output/revisions?before=-1",{headers:reviewerScope})).status,400,"history cursors cannot escape their numeric revision boundary");
  database.sqlite.prepare("UPDATE users SET consent_version=NULL WHERE user_id=?").run("governed-review-viewer");database.reset();assert.equal((await request("/api/artifacts/governed-output/revisions",{headers:reviewerScope})).status,428);assert.equal(database.writeCount(),0,"historical finished work cannot be read without current consent");database.sqlite.prepare("UPDATE users SET consent_version=? WHERE user_id=?").run("pilot-2026-08-10","governed-review-viewer");
  const originalRevision=await request("/api/artifacts/governed-output/revisions/0",{headers:reviewerScope});assert.equal(originalRevision.status,200);assert.match((await originalRevision.json()).content.markdown,/Initial approved manuscript/);
  const historical=database.sqlite.prepare("SELECT content_json FROM artifact_revisions WHERE artifact_id='governed-output' AND revision=0").get().content_json;database.sqlite.prepare("UPDATE artifact_revisions SET content_json='CORRUPTED REVISION' WHERE artifact_id='governed-output' AND revision=0").run();database.reset();assert.equal((await request("/api/artifacts/governed-output/revisions/0",{headers:reviewerScope})).status,409);assert.equal((await request("/api/artifacts/governed-output/revisions/0/restore",json(ownerScope,{expectedRevision:1}))).status,409);assert.equal(database.writeCount(),0,"digest-invalid historical work can neither be disclosed nor restored");database.sqlite.prepare("UPDATE artifact_revisions SET content_json=? WHERE artifact_id='governed-output' AND revision=0").run(historical);
  assert.equal((await request("/api/artifacts/governed-output/revisions/0/restore",json(reviewerScope,{expectedRevision:1}))).status,403,"a viewer can inspect prior work without gaining restoration rights");
  assert.equal((await request("/api/artifacts/governed-output/revisions",{headers:reviewer})).status,404,"a personal session cannot read another account's shared-project revision body");
  assert.equal((await revise(ownerScope,"A conflicting stale change",0)).status,409,"a stale output revision never overwrites a collaborator correction");
  assert.equal((await append(reviewerScope,{type:"DocumentArtifactExported",payload:{artifact_id:"governed-output",document_id:"doc-atmosphere",format:"markdown"}})).status,409,"editing immediately closes the distribution gate");
  assert.equal((await request(`/api/shared/${encodeURIComponent(share.token)}`)).status,404,"existing external links stop revealing newly unapproved work");
  const mixedExport=await request("/api/events",json(ownerScope,{action:"batch",events:[{type:"DocumentArtifactExported",payload:{artifact_id:"governed-output",document_id:"doc-atmosphere"}},{type:"BlockWeightSet",payload:{block_id:versions[0].block_id,weight:.4}}]}));assert.equal(mixedExport.status,400,"mixed export-and-mutation batches cannot bypass review policy");
  const restored=await request("/api/artifacts/governed-output/revisions/0/restore",json(ownerScope,{expectedRevision:1}));assert.equal(restored.status,200,JSON.stringify(await restored.clone().json()));const restoredBody=await restored.json();assert.equal(restoredBody.revision,2);assert.match(JSON.parse(database.sqlite.prepare("SELECT content FROM private_content WHERE content_id='governed-output-content'").get().content).content_markdown,/Initial approved manuscript/);assert.equal(restoredBody.appended[0].payload.restored_from_revision,0,"restoration creates a fresh auditable edit rather than overwriting history");
  assert.deepEqual(database.sqlite.prepare("SELECT revision FROM artifact_revisions WHERE artifact_id='governed-output' ORDER BY revision").all().map((entry)=>entry.revision),[0,1,2]);
  assert.equal((await append(reviewerScope,{type:"DocumentArtifactExported",payload:{artifact_id:"governed-output",document_id:"doc-atmosphere",format:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"}})).status,409,"restoration closes every professional-export release gate until independent approval");
  assert.equal((await append(ownerScope,action("ArtifactReviewRequested"))).status,200);
  const staleApproval=action("ArtifactApproved"),staleReviewRequest=action("ArtifactReviewRequested");
  const updatedAgain=await revise(ownerScope,"# Governed deliverable\n\nFinal independently reviewable manuscript.",2);assert.equal(updatedAgain.status,200);assert.equal((await updatedAgain.json()).revision,3);
  database.reset();const outdatedReviewRequest=await append(ownerScope,staleReviewRequest);assert.equal(outdatedReviewRequest.status,409);assert.equal((await outdatedReviewRequest.json()).error,"stale_review_context");assert.equal(database.writeCount(),0,"an earlier output body cannot be resubmitted after a collaborator changes the deliverable");
  assert.equal((await append(ownerScope,action("ArtifactReviewRequested"))).status,200);
  database.reset();const outdatedApproval=await append(reviewerScope,staleApproval);assert.equal(outdatedApproval.status,409);assert.equal((await outdatedApproval.json()).error,"stale_review_context");assert.equal(database.writeCount(),0,"an approval captured for an unseen earlier revision can never approve a later correction");
  assert.equal((await append(reviewerScope,action("ArtifactApproved"))).status,200,"independent viewer can re-approve the exact current corrected revision");
  const staleRevision=database.sqlite.prepare("SELECT content_sha256 FROM artifact_revisions WHERE artifact_id='governed-output' AND revision=1").get().content_sha256;database.reset();const outdatedRelease=await append(reviewerScope,{type:"DocumentArtifactExported",payload:{artifact_id:"governed-output",document_id:"doc-atmosphere",artifact_revision:1,content_sha256:staleRevision,format:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"}});assert.equal(outdatedRelease.status,409);assert.equal((await outdatedRelease.json()).error,"stale_release_context");assert.equal(database.writeCount(),0,"stale approved bytes cannot create a misleading professional-export receipt");
  const staleRestored=database.sqlite.prepare("SELECT content_sha256 FROM artifact_revisions WHERE artifact_id='governed-output' AND revision=2").get().content_sha256;for(const format of ["markdown","application/pdf","application/zip"]){database.reset();const stale=await append(reviewerScope,{type:"DocumentArtifactExported",payload:{artifact_id:"governed-output",document_id:"doc-atmosphere",artifact_revision:2,content_sha256:staleRestored,format}});assert.equal(stale.status,409,format);assert.equal(database.writeCount(),0,`${format} cannot release previously prepared bytes after approval moves to a later revision`);}
  database.reset();const missingBinding=await append(reviewerScope,{type:"DocumentArtifactExported",payload:{artifact_id:"governed-output",document_id:"doc-atmosphere",format:"markdown"}});assert.equal(missingBinding.status,409);assert.equal(database.writeCount(),0,"governed content exports cannot omit exact body custody");
  const approvedRevision=database.sqlite.prepare("SELECT content_sha256 FROM artifact_revisions WHERE artifact_id='governed-output' AND revision=3").get().content_sha256;assert.equal((await append(reviewerScope,{type:"DocumentArtifactExported",payload:{artifact_id:"governed-output",document_id:"doc-atmosphere",artifact_revision:3,content_sha256:approvedRevision,format:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"}})).status,200,"the exact independently approved output revision is eligible for professional distribution");assert.equal((await append(reviewerScope,{type:"DocumentArtifactExported",payload:{artifact_id:"governed-output",document_id:"doc-atmosphere",artifact_revision:3,content_sha256:approvedRevision,format:"application/zip"}})).status,200,"complete media archives use the identical independently approved revision and content-custody gate");
  assert.equal((await request(memberPath,json(owner,{reviewAccess:false},"PATCH"))).status,200,"owner can immediately revoke reviewer authority");
  assert.equal((await request("/api/session",{headers:reviewerScope})).status,403,"revocation invalidates the existing project session");
  reviewerScope=await open(reviewer);
  assert.equal((await append(reviewerScope,action("ArtifactChangesRequested"))).status,403,"revoked viewer cannot request changes");
  assert.equal((await append(reviewerScope,action("ArtifactApproved"))).status,403,"revoked viewer cannot issue a new approval");
  assert.equal((await revise(reviewerScope,"Revoked reviewer edit",1)).status,403,"revocation never exposes author permissions");
  const audit=database.sqlite.prepare("SELECT action FROM organization_audit_events WHERE organization_id=? AND action IN('ProjectReviewAccessGranted','ProjectReviewAccessRevoked') ORDER BY occurred_at").all(organizationId);assert.deepEqual(audit.map((row)=>row.action).sort(),["ProjectReviewAccessGranted","ProjectReviewAccessRevoked"]);
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
  const sharedArtifactContent=JSON.stringify({title:"Shared story",summary:"Approved shared output",content_markdown:"Exact retained shared story.",presentation:null,items:[{title:"Opening",body:"Exact retained shared story.",notes:"",image_prompt:"",context_group_ids:[],slide:null}]});
  const sharedArtifactStored=await storePrivateContent(environment,"canvas-project-owner","document-artifact",sharedArtifactContent);
  const sharedArtifactBinding={artifact_revision:0,content_sha256:createHash("sha256").update(sharedArtifactContent).digest("hex")};
  append("DocumentRenderCompleted",{project_id:"project-atmosphere",document_id:"doc-atmosphere",artifact_id:"shared-artifact",artifact_kind:"short_story",title:"Shared story",summary:"Approved shared output",item_count:1,items:[],content_ref:sharedArtifactStored.contentId});
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
  database.reset();assert.equal((await request("/api/generation-readiness",json(scoped,{documentId:"doc-atmosphere"}))).status,403);assert.equal(database.writeCount(),0,"an explicit output grant cannot elevate a project viewer");
  database.reset();const viewerPlanningJobs=await request("/api/document-jobs",{headers:scoped});assert.equal(viewerPlanningJobs.status,200);assert.deepEqual((await viewerPlanningJobs.json()).jobs,[]);assert.equal(database.writeCount(),0,"the viewer can only discover their own already-approved planning jobs");
  database.reset();assert.equal((await request("/api/document-jobs",json(scoped,{kind:"generate",documentId:"doc-atmosphere",payload:{}}))).status,403);assert.equal(database.writeCount(),0,"an explicit output grant still cannot admit a project viewer's paid request");
  assert.equal((await request("/canvas",{headers:scoped})).status,200);
  const visible=await(await request("/api/events?after=0&limit=5000&content=0",{headers:scoped})).json();assert.ok(visible.events.some((event)=>event.type==="CanvasCreated"&&event.payload.canvas_id==="shared-board"));assert.doesNotMatch(JSON.stringify(visible),/PRIVATE PROJECT CARD|private-board|private-item/);
  database.reset();const unboundExport=await request("/api/events",json(scoped,{action:"append",event:{type:"DocumentArtifactExported",payload:{artifact_id:"shared-artifact",document_id:"doc-atmosphere",format:"markdown"}}}));
  assert.equal(unboundExport.status,409);assert.equal((await unboundExport.json()).error,"stale_release_context");assert.equal(database.writeCount(),0,"a viewer cannot release retained artifact content without its exact revision and digest");
  for(const event of [{type:"ObjectExported",payload:{object_id:"shared-output",destination_class:"download",format:"image/png"}},{type:"DocumentArtifactExported",payload:{artifact_id:"shared-artifact",document_id:"doc-atmosphere",format:"markdown",...sharedArtifactBinding}}]){
    const exported=await request("/api/events",json(scoped,{action:"append",event}));const receipt=await exported.json();assert.equal(exported.status,200,JSON.stringify(receipt));assert.equal(receipt.appended[0].actor,"user:canvas-project-editor","viewer downloads retain an actor-attributed project audit receipt");
  }
  database.reset();assert.equal((await request("/api/events",json(scoped,{action:"append",event:{type:"DocumentArtifactExported",payload:{artifact_id:"private-artifact",document_id:"doc-atmosphere"}}}))).status,403);assert.equal(database.writeCount(),0,"viewer export receipts cannot reference another project");
  const makeEvent=(type,payload,id=crypto.randomUUID())=>({type,payload:{project_id:"project-atmosphere",canvas_id:"shared-board",history_owner_id:"canvas-project-editor",client_event_id:id,...payload}});
  const register=makeEvent("CanvasRegisterSet",{item_id:"shared-item",operation:{object:{item_id:"shared-item"},prop:"x",value:120,hlc:{pt:Date.now(),c:0,site:"canvas-project-editor:device"}}},"first-collaborative-receipt");
  database.reset();assert.equal((await request("/api/events",json(scoped,{action:"canvas_sync",events:[register]}))).status,403);assert.equal(database.writeCount(),0,"Canvas viewers cannot mutate a board");
  database.reset();const isolatedViewerJobs=await request("/api/document-jobs",{headers:scoped});assert.equal(isolatedViewerJobs.status,200);assert.deepEqual((await isolatedViewerJobs.json()).jobs,[]);assert.equal(database.writeCount(),0,"project viewers cannot inspect another actor's output jobs");
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
  const provenance=database.sqlite.prepare("SELECT event.event_id,event.actor,event.type,event.payload FROM project_resource_scopes resource JOIN events event ON event.event_id=resource.source_event_id WHERE resource.resource_kind='job' AND resource.resource_id=?").get(queuedBody.job.jobId);
  assert.equal(provenance.actor,"user:canvas-project-editor");assert.equal(provenance.type,"ProjectDocumentJobQueued");const{_private_ref:privateReference,...operationalProvenance}=JSON.parse(provenance.payload);assert.equal(privateReference,provenance.event_id);assert.deepEqual(operationalProvenance,{job_id:queuedBody.job.jobId,document_id:"doc-atmosphere",kind:"extract_reference",organization_id:organizationId,project_access_id:projectAccessId,project_id:"project-atmosphere",history_owner_user_id:"canvas-project-owner",actor_user_id:"canvas-project-editor"});
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
      const forged=await request("/api/document-jobs",json(scoped,{kind:"render_document",documentId:"doc-atmosphere",sourceSurface:"document",payload:{artifactKind:"storyboard",productionMode:"managed",itemCount:1,paidMediaConfirmed:true,budgetAcknowledged:true,snapshot}}));const rejected=await forged.json();assert.equal(forged.status,409,JSON.stringify(rejected));assert.equal(rejected.error,"context_source_not_authorized");assert.match(String(rejected.message),/not authorized for the selected project/);assert.equal(privatePixelReads,0,"forged owner-owned media is rejected before its private pixels are read");assert.equal(providerCalls,callsBeforeForgery,"cross-project snapshot media never reaches a provider or creates an execution job");
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

test("managed pilots enforce named participants, whole-pilot spending, prospective tenant retention, scheduled receipts, and safe owner removal",async()=>{
  const {database,environment,request}=await productionWorker();
  const owner=await specialistIdentity(database,request,"managed-pilot-owner"),author=await specialistIdentity(database,request,"managed-pilot-author"),reviewer=await specialistIdentity(database,request,"managed-pilot-reviewer"),stranger=await specialistIdentity(database,request,"managed-pilot-stranger");
  const json=(headers,body,method="POST")=>({method,headers:{...headers,"content-type":"application/json"},body:JSON.stringify(body)});
  for(const identity of [owner,author])assert.equal((await request("/api/events?after=0&content=0",{headers:identity})).status,200);
  const organization=await request("/api/workspaces",json(owner,{name:"Controlled product pilot"}));assert.equal(organization.status,201);const organizationId=(await organization.json()).organizationId;
  const invite=async(identity,userId,role="member")=>{const response=await request(`/api/workspaces/${organizationId}/members`,json(owner,{email:`${userId}@example.test`,role}));assert.equal(response.status,201);const invitation=await response.json();const accepted=await request(`/api/workspaces/${organizationId}/invitations/${invitation.invitationId}/accept`,json(identity,{token:new URL(invitation.invitationUrl).searchParams.get("token")}));assert.equal(accepted.status,200);};
  await invite(author,"managed-pilot-author","administrator");await invite(reviewer,"managed-pilot-reviewer");
  const register=async(identity)=>{const response=await request(`/api/workspaces/${organizationId}/projects`,json(identity,{projectId:"project-atmosphere"}));assert.equal(response.status,201,JSON.stringify(await response.clone().json()));return(await response.json()).projectAccessId;};
  const ownerProject=await register(owner),authorProject=await register(author);
  assert.equal((await request(`/api/workspaces/${organizationId}/pilot`,json(author,{maxParticipants:3}))).status,403,"an administrator cannot quietly impose a managed pilot on the organization owner");
  assert.equal((await request(`/api/workspaces/${organizationId}/pilot`,json(owner,{maxParticipants:1}))).status,400,"every cohort preserves enough seats for an independent reviewer");
  for(const [description,schedule] of [["remote decades-long end date",{startsAt:new Date().toISOString(),endsAt:"2099-01-01T00:00:00.000Z"}],["backdated start",{startsAt:new Date(Date.now()-86_400_000).toISOString()}],["future start",{startsAt:new Date(Date.now()+86_400_000).toISOString()}],["custom shorter end",{endsAt:new Date(Date.now()+86_400_000).toISOString()}]]){
    database.reset();const changed=await request(`/api/workspaces/${organizationId}/pilot`,json(owner,{maxParticipants:3,...schedule}));assert.equal(changed.status,400,description);assert.equal((await changed.json()).error,"valid_pilot_configuration_required");assert.equal(database.writeCount(),0,`${description} must not create a controlled cohort`);
  }
  const configured=await request(`/api/workspaces/${organizationId}/pilot`,json(owner,{maxParticipants:3,participantCapMicrousd:2_000_000,organizationCapMicrousd:2_700_000,evidenceDays:40}));assert.equal(configured.status,201,JSON.stringify(await configured.clone().json()));const configuration=await configured.json(),cohortId=configuration.cohortId;assert.equal(new Date(configuration.endsAt).getTime()-new Date(configuration.startsAt).getTime(),30*86_400_000,"the production endpoint fixes every cohort at exactly thirty days");assert.ok(Math.abs(Date.now()-new Date(configuration.startsAt).getTime())<30_000,"a controlled pilot starts immediately");
  assert.equal((await request(`/api/workspaces/${organizationId}/pilot`,{headers:stranger})).status,403,"another tenant never learns cohort membership or spending");
  const authorEnrollment=await request(`/api/workspaces/${organizationId}/pilot/participants`,json(owner,{email:"managed-pilot-author@example.test",role:"member"}));assert.equal(authorEnrollment.status,201);const authorParticipant=(await authorEnrollment.json()).participantId;
  const reviewerEnrollment=await request(`/api/workspaces/${organizationId}/pilot/participants`,json(owner,{email:"managed-pilot-reviewer@example.test",role:"reviewer"}));assert.equal(reviewerEnrollment.status,201);const reviewerParticipant=(await reviewerEnrollment.json()).participantId;
  assert.equal((await request(`/api/workspaces/${organizationId}/pilot/participants`,json(owner,{email:"another-person@example.test"}))).status,409,"the fixed cohort seat count is enforced atomically");
  assert.equal((await request(`/api/workspaces/${organizationId}/projects/${ownerProject}/members`,json(owner,{userId:"managed-pilot-reviewer",role:"viewer"}))).status,201);
  const opened=await request(`/api/workspaces/${organizationId}/projects/${ownerProject}/context`,{method:"POST",headers:reviewer});assert.equal(opened.status,200);const reviewerScope={...reviewer,cookie:opened.headers.get("set-cookie")?.split(";")[0]??""};
  assert.equal((await request("/api/session",{headers:reviewerScope})).status,200,"an enrolled named reviewer can read their exact shared project");
  const ownerContext=await request(`/api/workspaces/${organizationId}/projects/${ownerProject}/context`,{method:"POST",headers:owner});assert.equal(ownerContext.status,200);const ownerUploadScope={...owner,cookie:ownerContext.headers.get("set-cookie")?.split(";")[0]??""};
  let uploadedMetadata=null;const uploadedObjects=new Map();environment.MEDIA={async put(key,value,options){uploadedMetadata=options.customMetadata;uploadedObjects.set(key,{value,metadata:options.customMetadata,contentType:options.httpMetadata.contentType});},async get(key){const object=uploadedObjects.get(key);return object?{customMetadata:object.metadata,httpEtag:"managed-source",writeHttpMetadata(headers){headers.set("content-type",object.contentType);},body:new Blob([object.value]).stream()}:null;},async delete(key){uploadedObjects.delete(key);}};
  const source=()=>{const form=new FormData();form.append("file",new File(["ordinary licensed customer material"],"pilot-reference.png",{type:"image/png"}));form.append("rightsConfirmed","true");return form;};
  database.reset();const unclassified=await request("/api/media",{method:"POST",headers:ownerUploadScope,body:source()});assert.equal(unclassified.status,428);assert.equal((await unclassified.json()).error,"pilot_non_sensitive_source_confirmation_required");assert.equal(database.writeCount(),0,"a controlled source without a non-sensitive attestation creates no customer state");
  const classified=source();classified.append("nonSensitiveConfirmed","true");const acceptedSource=await request("/api/media",{method:"POST",headers:ownerUploadScope,body:classified});assert.equal(acceptedSource.status,200,JSON.stringify(await acceptedSource.clone().json()));const uploadedSource=await acceptedSource.json();assert.equal(uploadedSource.sourceClassification,"non-sensitive-licensed");assert.equal(uploadedMetadata.sourceClassification,"non-sensitive-licensed");assert.equal(uploadedMetadata.pilotCohortId,cohortId);assert.equal((await request(uploadedSource.url,{headers:reviewer})).status,200,"an actively enrolled project reviewer can read its explicitly shared licensed source");
  const appendSource=async(event)=>{const response=await request("/api/events",json(ownerUploadScope,{action:"append",event}));assert.equal(response.status,200,JSON.stringify(await response.clone().json()));};
  await appendSource({type:"ReferenceIngested",payload:{reference_id:"licensed-predecessor-source",document_id:"doc-atmosphere",source_type:"upload",source_ref:uploadedSource.url,content_hash:uploadedSource.contentHash,rights_class:"asserted"}});
  await appendSource({type:"RightsAsserted",payload:{reference_id:"licensed-predecessor-source",rights_class:"owned_or_licensed",assertion_method:"controlled-cohort-upload"}});
  await appendSource({type:"BlockCreated",payload:{block_id:"licensed-predecessor-reference",project_id:"project-atmosphere",document_id:"doc-atmosphere",type:"reference",handle:"reference/licensed-predecessor",position:"z0899",properties:{reference_id:"licensed-predecessor-source",label:"Continuing licensed source",media_url:uploadedSource.url,authority:"authored",weight:.8}}});

  const authorMembership=database.sqlite.prepare("SELECT membership_id FROM organization_memberships WHERE organization_id=? AND user_id=?").get(organizationId,"managed-pilot-author").membership_id;
  database.reset();const forbiddenRemoval=await request(`/api/workspaces/${organizationId}/members/${authorMembership}`,{method:"DELETE",headers:owner});assert.equal(forbiddenRemoval.status,409);assert.equal((await forbiddenRemoval.json()).error,"project_owner_transfer_required");assert.equal(database.writeCount(),0,"owner-removal rejection cannot partially revoke or quarantine active pilot work");
  assert.throws(()=>database.sqlite.prepare("UPDATE organization_memberships SET status='revoked' WHERE membership_id=?").run(authorMembership),/project_owner_transfer_required/,"a database guard also blocks racing owner revocation inside the same transaction");
  assert.throws(()=>database.sqlite.prepare("DELETE FROM organization_memberships WHERE membership_id=?").run(authorMembership),/project_owner_transfer_required/,"hard-deleting a membership cannot strand its active pilot project");
  assert.throws(()=>database.sqlite.prepare("DELETE FROM pilot_participants WHERE participant_id=?").run(authorParticipant),/project_owner_transfer_required/,"hard-deleting an owner participant cannot bypass transfer safeguards");
  assert.throws(()=>database.sqlite.prepare("DELETE FROM pilot_cohorts WHERE cohort_id=?").run(cohortId),/active_pilot_cannot_be_deleted/,"the active control boundary cannot disappear through direct deletion");
  assert.equal((await request(`/api/workspaces/${organizationId}/pilot/participants/${authorParticipant}`,{method:"DELETE",headers:owner})).status,409,"pilot enrollment cannot be revoked while its participant owns an active project");
  assert.equal(database.sqlite.prepare("SELECT status FROM organization_projects WHERE project_access_id=?").get(authorProject).status,"active");

  const ownerScope={organizationId,projectAccessId:ownerProject,actorUserId:"managed-pilot-owner"},authorScope={organizationId,projectAccessId:authorProject,actorUserId:"managed-pilot-author"};
  const options=(userId,reservationId,projectScope,extra={})=>({maximumMicrousd:2_000_000,allowUserOverage:false,reservationId,streamId:`creative:${userId}`,correlationId:reservationId,operation:"synthetic-pilot-verification",projectScope,...extra});
  const reviewerBillingScope={organizationId,projectAccessId:ownerProject,actorUserId:"managed-pilot-reviewer"};assert.deepEqual(await reserveCostBudget(environment,"managed-pilot-reviewer",1,options("managed-pilot-reviewer","reviewer-paid-generation",reviewerBillingScope)),{ok:false,scope:"authorization"},"a named reviewer never gains paid generation merely through cohort membership");
  const roleRace=await reserveCostBudget(environment,"managed-pilot-author",25,options("managed-pilot-author","author-role-race",authorScope));assert.equal(roleRace.ok,true);database.sqlite.prepare("UPDATE pilot_participants SET role='reviewer' WHERE participant_id=?").run(authorParticipant);assert.equal(await claimCostBudgetReservation(environment,"managed-pilot-author",roleRace.reservationId),false,"a newly downgraded reviewer cannot claim an earlier author's provider reservation");assert.equal(database.sqlite.prepare("SELECT reserved_microusd FROM cost_budget_counters WHERE scope='pilot_user' AND scope_id=? AND period=?").get("managed-pilot-author",`pilot:${cohortId}`).reserved_microusd,0,"failed execution claims release every fixed pilot counter");database.sqlite.prepare("UPDATE pilot_participants SET role='member' WHERE participant_id=?").run(authorParticipant);
  assert.deepEqual(await reserveCostBudget(environment,"managed-pilot-owner",1_000,options("managed-pilot-owner","personal-bypass",undefined)),{ok:false,scope:"authorization"},"a named participant cannot move paid work into an unscoped personal account");
  const first=await reserveCostBudget(environment,"managed-pilot-owner",1_000_000,options("managed-pilot-owner","pilot-owner-first",ownerScope));assert.equal(first.ok,true);assert.equal((await settleCostBudget(environment,"managed-pilot-owner",first.reservationId,1_000_000)).settled,true);
  const authorReservation=await reserveCostBudget(environment,"managed-pilot-author",1_000_000,options("managed-pilot-author","pilot-author-first",authorScope));assert.equal(authorReservation.ok,true);
  const rollover=await reserveCostBudget(environment,"managed-pilot-owner",500_000,options("managed-pilot-owner","pilot-owner-next-month",ownerScope,{period:"2099-12"}));assert.equal(rollover.ok,true,"monthly receipts can rotate without resetting the fixed cohort envelope");
  const fixedPeriod=`pilot:${cohortId}`;assert.equal(database.sqlite.prepare("SELECT used_microusd,reserved_microusd FROM cost_budget_counters WHERE scope='pilot_user' AND scope_id=? AND period=?").get("managed-pilot-owner",fixedPeriod).reserved_microusd,500_000);
  const orgOverage=await reserveCostBudget(environment,"managed-pilot-author",400_000,options("managed-pilot-author","pilot-org-over",authorScope));assert.deepEqual(orgOverage,{ok:false,scope:"workspace"},"the whole-pilot organization cap remains tighter than the participant's remaining allowance");
  const participantOverage=await reserveCostBudget(environment,"managed-pilot-owner",1_100_000,options("managed-pilot-owner","pilot-user-over",ownerScope,{allowUserOverage:true}));assert.deepEqual(participantOverage,{ok:false,scope:"user"},"an overage override can never bypass a fixed participant cap");
  assert.equal((await settleCostBudget(environment,"managed-pilot-author",authorReservation.reservationId,1_000_000)).settled,true);
  assert.equal((await settleCostBudget(environment,"managed-pilot-owner",rollover.reservationId,900_000)).settled,true,"unexpected provider overage preserves its real accounted charge");
  assert.equal(database.sqlite.prepare("SELECT status FROM pilot_cohorts WHERE cohort_id=?").get(cohortId).status,"paused","a fixed-envelope overrun immediately pauses further paid work");
  assert.equal(database.sqlite.prepare("SELECT used_microusd,reserved_microusd FROM cost_budget_counters WHERE scope='pilot_org' AND scope_id=? AND period=?").get(cohortId,fixedPeriod).used_microusd,2_900_000,"actual usage is never concealed to make the cap appear satisfied");
  assert.deepEqual(await reserveCostBudget(environment,"managed-pilot-owner",1,options("managed-pilot-owner","paused-operation",ownerScope)),{ok:false,scope:"authorization"});
  assert.equal((await request("/api/session",{headers:reviewerScope})).status,200,"pausing paid work must not prevent participants from reviewing their existing project");
  environment.OPENAI_API_KEY="synthetic-pilot-provider-must-not-be-called";
  for(const [path,body] of [["/api/events",{action:"generate",documentId:"doc-atmosphere",budgetAcknowledged:true}],["/api/document-jobs",{kind:"generate",documentId:"doc-atmosphere",payload:{budgetAcknowledged:true}}]]){
    database.reset();const blocked=await request(path,json(owner,body));assert.equal(blocked.status,403,`${path} refuses paused managed-pilot work before provider execution`);assert.equal(database.writeCount(),0,`${path} refuses paused work before reserving or creating a job`);
  }

  const exactScope={organizationId,projectAccessId:ownerProject,projectId:"project-atmosphere",ownerUserId:"managed-pilot-owner",actorUserId:"managed-pilot-owner"};
  const previous=await storePrivateContent(environment,"managed-pilot-owner","document-artifact-input","EXACT ORIGINAL CUSTOMER EVIDENCE",exactScope);
  const originalExpiry=database.sqlite.prepare("SELECT expires_at FROM private_content WHERE content_id=?").get(previous.contentId).expires_at;
  assert.ok(Date.parse(originalExpiry)-Date.now()>39*86_400_000);
  const retention=await request(`/api/workspaces/${organizationId}/retention`,json(owner,{transientDays:5,evidenceDays:7,revisionDays:14},"PATCH"));assert.equal(retention.status,200);assert.equal((await retention.json()).policy.version,2);
  assert.equal(database.sqlite.prepare("SELECT expires_at FROM private_content WHERE content_id=?").get(previous.contentId).expires_at,originalExpiry,"retention-policy changes never retroactively rewrite existing evidence");
  const next=await storePrivateContent(environment,"managed-pilot-owner","document-artifact-input","EXACT FUTURE CUSTOMER EVIDENCE",exactScope);
  const nextExpiry=Date.parse(database.sqlite.prepare("SELECT expires_at FROM private_content WHERE content_id=?").get(next.contentId).expires_at);assert.ok(nextExpiry-Date.now()<8*86_400_000&&nextExpiry-Date.now()>6*86_400_000);
  const retentionScope=database.sqlite.prepare("SELECT organization_id,project_access_id,classification,policy_version FROM private_content_retention_scopes WHERE content_id=?").get(next.contentId);assert.equal(retentionScope.organization_id,organizationId);assert.equal(retentionScope.project_access_id,ownerProject);assert.equal(retentionScope.classification,"governed-evidence");assert.equal(retentionScope.policy_version,2);
  const expired=new Date(Date.now()-60_000).toISOString();database.sqlite.prepare("UPDATE private_content SET expires_at=? WHERE content_id IN(?,?)").run(expired,previous.contentId,next.contentId);
  const held=await request(`/api/workspaces/${organizationId}/retention`,json(owner,{legalHold:true},"PATCH"));assert.equal(held.status,200);assert.equal((await held.json()).policy.legal_hold,1);
  await storePrivateContent(environment,"managed-pilot-owner","prompt","A separate personal note");
  assert.equal(database.sqlite.prepare("SELECT content,redacted_at FROM private_content WHERE content_id=?").get(previous.contentId).redacted_at,null,"personal account maintenance never erases another organization's held scoped evidence");
  const revisionInsert=database.sqlite.prepare("INSERT INTO artifact_revisions(revision_id,owner_id,organization_id,project_access_id,project_id,document_id,artifact_id,revision,content_json,content_sha256,created_by_user_id,created_at,expires_at,redacted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)");
  revisionInsert.run("held-project-revision","managed-pilot-owner",organizationId,ownerProject,"project-atmosphere","doc-atmosphere","held-output",0,"HELD ORIGINAL OUTPUT","held-digest","managed-pilot-owner",expired,expired);
  revisionInsert.run("expired-personal-revision","managed-pilot-owner",null,null,"project-atmosphere","doc-atmosphere","personal-output",0,"EXPIRED PERSONAL OUTPUT","personal-digest","managed-pilot-owner",expired,expired);
  assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM retention_sweep_runs").get().count,0,"ordinary application traffic never invents scheduled execution receipts");
  assert.equal(await sweepExpiredPrivateContent(environment),1,"traffic-triggered cleanup processes expired recoverable history without impersonating a scheduled run");
  assert.equal(database.sqlite.prepare("SELECT content_json,redacted_at FROM artifact_revisions WHERE revision_id='expired-personal-revision'").get().content_json,"");
  assert.equal(database.sqlite.prepare("SELECT redacted_at FROM artifact_revisions WHERE revision_id='held-project-revision'").get().redacted_at,null,"an organizational legal hold protects existing historical output");
  assert.equal(database.sqlite.prepare("SELECT redacted_at FROM private_content WHERE content_id=?").get(next.contentId).redacted_at,null,"an organizational legal hold protects existing governed evidence");
  assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM retention_sweep_runs").get().count,0,"traffic cleanup never fabricates scheduled maintenance receipts");
  const releasedHold=await request(`/api/workspaces/${organizationId}/retention`,json(owner,{legalHold:false},"PATCH"));assert.equal(releasedHold.status,200);
  await worker.scheduled({},environment);const cleaned=database.sqlite.prepare("SELECT content,redacted_at FROM private_content WHERE content_id=?").get(next.contentId);assert.equal(cleaned.content,"");assert.ok(cleaned.redacted_at);assert.equal(database.sqlite.prepare("SELECT content_json FROM artifact_revisions WHERE revision_id='held-project-revision'").get().content_json,"");const maintenance=database.sqlite.prepare("SELECT trigger_kind,status,processed_count FROM retention_sweep_runs ORDER BY started_at DESC LIMIT 1").get();assert.equal(maintenance.trigger_kind,"scheduled");assert.equal(maintenance.status,"completed");assert.ok(maintenance.processed_count>=3);
  const dashboard=await(await request(`/api/workspaces/${organizationId}/pilot`,{headers:owner})).json();assert.equal(dashboard.maintenance.status,"completed");assert.equal(dashboard.maintenance.scope,"installation");assert.equal("processed_count" in dashboard.maintenance,false,"global retention telemetry never exposes other organizations' record counts");

  assert.equal((await request(`/api/workspaces/${organizationId}/pilot/participants/${reviewerParticipant}`,{method:"DELETE",headers:owner})).status,200);
  database.reset();assert.equal((await request("/api/session",{headers:reviewerScope})).status,403);assert.equal(database.writeCount(),0,"revoked participants cannot recreate a stale project session");
  database.reset();const unscopedSession=await request("/api/session",{headers:reviewer});assert.equal(unscopedSession.status,200);const unscopedIdentity=await unscopedSession.json();assert.ok(!unscopedIdentity.organizations.some((organization)=>organization.organizationId===organizationId),"revoked participants never retain organization names in an unscoped account session");assert.ok(!unscopedIdentity.projects.some((project)=>project.organizationId===organizationId),"revoked participants never retain shared project identifiers without a context cookie");assert.equal(database.writeCount(),0,"hiding withdrawn organization access never rewrites customer data");
  database.reset();assert.equal((await request(uploadedSource.url,{headers:reviewer})).status,403,"removing a project cookie cannot restore withdrawn access to shared source bytes");assert.equal(database.writeCount(),0,"revoked direct source reads cannot create customer data");
  database.sqlite.prepare("UPDATE cost_budget_counters SET used_microusd=123456 WHERE scope='pilot_user' AND scope_id=? AND period=?").run("managed-pilot-reviewer",fixedPeriod);
  const reenrolled=await request(`/api/workspaces/${organizationId}/pilot/participants`,json(owner,{email:"managed-pilot-reviewer@example.test",role:"reviewer"}));assert.equal(reenrolled.status,201,JSON.stringify(await reenrolled.clone().json()));const returned=await reenrolled.json();assert.equal(returned.participantId,reviewerParticipant);assert.equal(returned.reenrolled,true);assert.equal(database.sqlite.prepare("SELECT used_microusd FROM cost_budget_counters WHERE scope='pilot_user' AND scope_id=? AND period=?").get("managed-pilot-reviewer",fixedPeriod).used_microusd,123456,"returning to the same cohort never resets the participant's fixed spending history");
  const reopened=await request(`/api/workspaces/${organizationId}/projects/${ownerProject}/context`,{method:"POST",headers:reviewer});assert.equal(reopened.status,200);assert.equal((await request(`/api/workspaces/${organizationId}/pilot/participants/${reviewerParticipant}`,{method:"DELETE",headers:owner})).status,200);
  environment.FORMA_PILOT_COHORT_ID=cohortId;database.sqlite.prepare("UPDATE pilot_cohorts SET ends_at=? WHERE cohort_id=?").run(new Date(Date.now()-60_000).toISOString(),cohortId);
  assert.equal((await request("/api/session",{headers:owner})).status,200,"the exact existing organization owner can recover an expired dedicated installation");
  assert.equal((await request("/api/session",{headers:author})).status,403,"ordinary participants cannot enter a dedicated installation after its cohort expires");
  assert.equal((await request(`/api/workspaces/${organizationId}/pilot`,json(author,{status:"closed"},"PATCH"))).status,403,"only the organization owner can permanently close a controlled cohort");
  const closed=await request(`/api/workspaces/${organizationId}/pilot`,json(owner,{status:"closed"},"PATCH"));assert.equal(closed.status,200);assert.equal((await closed.json()).status,"closed");assert.deepEqual(await reserveCostBudget(environment,"managed-pilot-owner",1,options("managed-pilot-owner","closed-operation",ownerScope)),{ok:false,scope:"authorization"},"closing the cohort never silently restores unrestricted paid access");
  assert.equal((await request("/api/session",{headers:owner})).status,200,"closed dedicated installations retain narrowly scoped owner recovery");
  assert.equal((await(await request(`/api/workspaces/${organizationId}/pilot`,{headers:owner})).json()).cohort.status,"closed","administrators can see a closed cohort and intentionally replace it");
  const predecessorEvidence=await storePrivateContent(environment,"managed-pilot-owner","document-artifact-input","PREVIOUS COHORT EVIDENCE",exactScope);const predecessorExpiry=database.sqlite.prepare("SELECT expires_at FROM private_content WHERE content_id=?").get(predecessorEvidence.contentId).expires_at;const precedingPolicy=database.sqlite.prepare("SELECT version,transient_days,evidence_days,revision_days,legal_hold FROM organization_retention_policies WHERE organization_id=?").get(organizationId);assert.equal(precedingPolicy.evidence_days,7);
  const replacement=await request(`/api/workspaces/${organizationId}/pilot`,json(owner,{maxParticipants:3,participantCapMicrousd:2_000_000,organizationCapMicrousd:6_000_000,evidenceDays:21}));assert.equal(replacement.status,201,JSON.stringify(await replacement.clone().json()));const replacementId=(await replacement.json()).cohortId;assert.notEqual(replacementId,cohortId);const successorPolicy=database.sqlite.prepare("SELECT version,transient_days,evidence_days,revision_days,legal_hold FROM organization_retention_policies WHERE organization_id=?").get(organizationId);assert.equal(successorPolicy.evidence_days,21,"the replacement's selected evidence-retention interval becomes the actual future tenant policy");assert.equal(successorPolicy.version,precedingPolicy.version+1,"replacement policy changes keep auditable policy versions");assert.equal(successorPolicy.transient_days,precedingPolicy.transient_days);assert.equal(successorPolicy.revision_days,precedingPolicy.revision_days);assert.equal(successorPolicy.legal_hold,precedingPolicy.legal_hold);assert.equal(database.sqlite.prepare("SELECT expires_at FROM private_content WHERE content_id=?").get(predecessorEvidence.contentId).expires_at,predecessorExpiry,"successor policy never rewrites prior evidence expiry");
  const successorCounter=database.sqlite.prepare("SELECT hard_limit_microusd FROM cost_budget_counters WHERE scope='pilot_user' AND scope_id=? AND period=?").get("managed-pilot-owner",`pilot:${replacementId}`);database.sqlite.prepare("UPDATE cost_budget_counters SET used_microusd=? WHERE scope='pilot_user' AND scope_id=? AND period=?").run(successorCounter.hard_limit_microusd,"managed-pilot-owner",`pilot:${replacementId}`);for(const [path,body] of [["/api/events",{action:"generate",documentId:"doc-atmosphere",budgetAcknowledged:true}],["/api/document-jobs",{kind:"generate",documentId:"doc-atmosphere",payload:{budgetAcknowledged:true}}]]){const resumed=await request(path,json(owner,body));assert.equal(resumed.status,429,`${path} accepts the exact predecessor's licensed project source before enforcing the successor spending envelope`);assert.equal((await resumed.json()).error,"pilot_budget_hard_cap_reached");}database.sqlite.prepare("UPDATE cost_budget_counters SET used_microusd=0 WHERE scope='pilot_user' AND scope_id=? AND period=?").run("managed-pilot-owner",`pilot:${replacementId}`);
  assert.equal((await request(`/api/workspaces/${organizationId}/pilot/participants`,json(owner,{email:"managed-pilot-author@example.test",role:"member"}))).status,201,"existing project owners must be explicitly enrolled in the successor cohort");
  assert.equal((await request(`/api/workspaces/${organizationId}/pilot/participants`,json(owner,{email:"managed-pilot-stranger@example.test",role:"reviewer"}))).status,201,"the successor can intentionally admit a different named reviewer");
  await invite(stranger,"managed-pilot-stranger");
  assert.equal((await request(`/api/workspaces/${organizationId}/projects/${ownerProject}/members`,json(owner,{userId:"managed-pilot-stranger",role:"viewer"}))).status,201);
  assert.equal((await request(`/api/workspaces/${organizationId}/projects/${ownerProject}/context`,{method:"POST",headers:stranger})).status,200,"a valid successor supersedes closed predecessor admission without inheriting revoked users");
  assert.equal((await request(`/api/workspaces/${organizationId}/projects/${ownerProject}/context`,{method:"POST",headers:reviewer})).status,403,"a revoked predecessor reviewer never inherits successor admission");
  assert.equal(environment.FORMA_PILOT_COHORT_ID,cohortId,"a dedicated installation follows its authorized successor without mutating deployment configuration");
  database.reset();const rejectedHeaders={"oai-authenticated-user-id":"uninvited-pilot-user","oai-authenticated-user-email":"uninvited-pilot-user@example.test"};assert.equal((await request("/api/session",{headers:rejectedHeaders})).status,403);assert.equal(database.writeCount(),0);assert.equal(database.sqlite.prepare("SELECT user_id FROM users WHERE user_id='uninvited-pilot-user'").get(),undefined,"a dedicated restricted installation rejects unknown identities before creating an account");
});

test("controlled pilot authorization remains atomic when enrollment changes during spending, project edits, or uploads",async()=>{
  const {database,environment,request,drainBackground}=await productionWorker();
  const owner=await specialistIdentity(database,request,"pilot-boundary-owner"),author=await specialistIdentity(database,request,"pilot-boundary-author");
  const json=(headers,body)=>({method:"POST",headers:{...headers,"content-type":"application/json"},body:JSON.stringify(body)});
  for(const identity of [owner,author])assert.equal((await request("/api/events?after=0&content=0",{headers:identity})).status,200);
  const created=await request("/api/workspaces",json(owner,{name:"Transactional pilot boundary"}));assert.equal(created.status,201);const organizationId=(await created.json()).organizationId;
  const invited=await request(`/api/workspaces/${organizationId}/members`,json(owner,{email:"pilot-boundary-author@example.test",role:"member"}));assert.equal(invited.status,201);const invitation=await invited.json();assert.equal((await request(`/api/workspaces/${organizationId}/invitations/${invitation.invitationId}/accept`,json(author,{token:new URL(invitation.invitationUrl).searchParams.get("token")}))).status,200);
  const registered=await request(`/api/workspaces/${organizationId}/projects`,json(owner,{projectId:"project-atmosphere"}));assert.equal(registered.status,201);const projectAccessId=(await registered.json()).projectAccessId;
  assert.equal((await request(`/api/workspaces/${organizationId}/projects/${projectAccessId}/members`,json(owner,{userId:"pilot-boundary-author",role:"editor"}))).status,201);
  const scope={organizationId,projectAccessId,actorUserId:"pilot-boundary-author"};
  const stalePersonal=await reserveCostBudget(environment,"pilot-boundary-author",100,{maximumMicrousd:100,allowUserOverage:false,reservationId:"pre-pilot-personal",streamId:"creative:pilot-boundary-author",correlationId:"pre-pilot-personal",operation:"pre-pilot-personal"});assert.equal(stalePersonal.ok,true);
  const staleOrganization=await reserveCostBudget(environment,"pilot-boundary-author",100,{maximumMicrousd:100,allowUserOverage:false,reservationId:"pre-pilot-organization",streamId:"creative:pilot-boundary-author",correlationId:"pre-pilot-organization",operation:"pre-pilot-organization",projectScope:scope});assert.equal(staleOrganization.ok,true);
  const configured=await request(`/api/workspaces/${organizationId}/pilot`,json(owner,{maxParticipants:2}));assert.equal(configured.status,201);const cohort=await configured.json();
  const enrolled=await request(`/api/workspaces/${organizationId}/pilot/participants`,json(owner,{email:"pilot-boundary-author@example.test",role:"member"}));assert.equal(enrolled.status,201);const participantId=(await enrolled.json()).participantId;
  for(const reservation of [stalePersonal,staleOrganization]){assert.equal(await claimCostBudgetReservation(environment,"pilot-boundary-author",reservation.reservationId),false,"a reservation created before pilot activation cannot avoid the controlled cohort envelope");assert.equal(database.sqlite.prepare("SELECT status FROM cost_budget_reservations WHERE reservation_id=?").get(reservation.reservationId).status,"released");}
  const unrelatedCreated=await request("/api/workspaces",json(author,{name:"Unmanaged separate organization"}));assert.equal(unrelatedCreated.status,201);const unrelatedOrganization=(await unrelatedCreated.json()).organizationId;const unrelatedProject=await request(`/api/workspaces/${unrelatedOrganization}/projects`,json(author,{projectId:"project-atmosphere"}));assert.equal(unrelatedProject.status,201);const unrelatedAccess=(await unrelatedProject.json()).projectAccessId;const unrelated=await reserveCostBudget(environment,"pilot-boundary-author",100,{maximumMicrousd:100,allowUserOverage:false,reservationId:"unmanaged-separate-organization",streamId:"creative:pilot-boundary-author",correlationId:"unmanaged-separate-organization",operation:"unmanaged-separate-organization",projectScope:{organizationId:unrelatedOrganization,projectAccessId:unrelatedAccess,actorUserId:"pilot-boundary-author"}});assert.equal(unrelated.ok,true);assert.equal(await claimCostBudgetReservation(environment,"pilot-boundary-author",unrelated.reservationId),true,"joining one managed organization never blocks legitimate work for an unrelated unmanaged organization");assert.equal((await settleCostBudget(environment,"pilot-boundary-author",unrelated.reservationId,0)).settled,true);
  const raceConditions=[
    {name:"reviewer downgrade",apply:()=>database.sqlite.prepare("UPDATE pilot_participants SET role='reviewer' WHERE participant_id=?").run(participantId),restore:()=>database.sqlite.prepare("UPDATE pilot_participants SET role='member' WHERE participant_id=?").run(participantId)},
    {name:"participant revocation",apply:()=>database.sqlite.prepare("UPDATE pilot_participants SET status='revoked',revoked_at=? WHERE participant_id=?").run(new Date().toISOString(),participantId),restore:()=>database.sqlite.prepare("UPDATE pilot_participants SET status='active',revoked_at=NULL WHERE participant_id=?").run(participantId)},
    {name:"project role downgrade",apply:()=>database.sqlite.prepare("UPDATE project_memberships SET role='viewer' WHERE project_access_id=? AND user_id=?").run(projectAccessId,"pilot-boundary-author"),restore:()=>database.sqlite.prepare("UPDATE project_memberships SET role='editor' WHERE project_access_id=? AND user_id=?").run(projectAccessId,"pilot-boundary-author")},
    {name:"project membership revocation",apply:()=>database.sqlite.prepare("UPDATE project_memberships SET status='revoked',revoked_at=? WHERE project_access_id=? AND user_id=?").run(new Date().toISOString(),projectAccessId,"pilot-boundary-author"),restore:()=>database.sqlite.prepare("UPDATE project_memberships SET status='active',revoked_at=NULL WHERE project_access_id=? AND user_id=?").run(projectAccessId,"pilot-boundary-author")},
    {name:"project migration shutdown",apply:()=>database.sqlite.prepare("UPDATE project_migration_states SET status='quarantine' WHERE project_access_id=?").run(projectAccessId),restore:()=>database.sqlite.prepare("UPDATE project_migration_states SET status='active' WHERE project_access_id=?").run(projectAccessId)},
    {name:"consent withdrawal",apply:()=>database.sqlite.prepare("UPDATE users SET consent_version=NULL WHERE user_id=?").run("pilot-boundary-author"),restore:()=>database.sqlite.prepare("UPDATE users SET consent_version='pilot-2026-08-10' WHERE user_id=?").run("pilot-boundary-author")},
    {name:"cohort pause",apply:()=>database.sqlite.prepare("UPDATE pilot_cohorts SET status='paused' WHERE cohort_id=?").run(cohort.cohortId),restore:()=>database.sqlite.prepare("UPDATE pilot_cohorts SET status='active' WHERE cohort_id=?").run(cohort.cohortId)},
    {name:"cohort expiration",apply:()=>database.sqlite.prepare("UPDATE pilot_cohorts SET ends_at=? WHERE cohort_id=?").run(new Date(Date.now()-1_000).toISOString(),cohort.cohortId),restore:()=>database.sqlite.prepare("UPDATE pilot_cohorts SET ends_at=? WHERE cohort_id=?").run(cohort.endsAt,cohort.cohortId)},
  ];
  for(const [index,condition] of raceConditions.entries()){
    const reservation=await reserveCostBudget(environment,"pilot-boundary-author",100,{maximumMicrousd:100,allowUserOverage:false,reservationId:`interleaved-pilot-claim-${index}`,streamId:"creative:pilot-boundary-author",correlationId:`interleaved-pilot-claim-${index}`,operation:"bounded-pilot-interleaving",projectScope:scope});assert.equal(reservation.ok,true,condition.name);
    const previousPrepare=environment.DB.prepare;let interleaved=false;
    environment.DB.prepare=function(sql){const prepared=previousPrepare.call(this,sql);if(sql.startsWith("UPDATE cost_budget_reservations SET status='executing'")){const previousBind=prepared.bind.bind(prepared);prepared.bind=(...values)=>{const bound=previousBind(...values),previousRun=bound.run.bind(bound);bound.run=async()=>{condition.apply();interleaved=true;return previousRun();};return bound;};}return prepared;};
    try{assert.equal(await claimCostBudgetReservation(environment,"pilot-boundary-author",reservation.reservationId),false,`${condition.name} between scope inspection and execution never reaches the provider`);assert.equal(interleaved,true,condition.name);assert.equal(database.sqlite.prepare("SELECT status FROM cost_budget_reservations WHERE reservation_id=?").get(reservation.reservationId).status,"released",`${condition.name} releases the abandoned claim`);assert.equal(database.sqlite.prepare("SELECT reserved_microusd FROM cost_budget_counters WHERE scope='pilot_user' AND scope_id=? AND period=?").get("pilot-boundary-author",`pilot:${cohort.cohortId}`).reserved_microusd,0,`${condition.name} never strands fixed pilot spending`);}finally{environment.DB.prepare=previousPrepare;condition.restore();}
  }
  environment.OPENAI_API_KEY="synthetic-pilot-no-provider-calls";const originalFetch=globalThis.fetch;let providerCalls=0;globalThis.fetch=async()=>{providerCalls+=1;return Response.json({error:{message:"provider must not receive withdrawn pilot work"}},{status:500});};
  try{for(const [action,body] of [["chat",{action:"chat",documentId:"doc-atmosphere",message:"Can you clarify this direction?",livePreview:false,budgetAcknowledged:true}],["preview",{action:"preview",documentId:"doc-atmosphere",budgetAcknowledged:true}],["generate",{action:"generate",documentId:"doc-atmosphere",budgetAcknowledged:true}]]){const previousPrepare=environment.DB.prepare;let deniedAtExecution=false;environment.DB.prepare=function(sql){const prepared=previousPrepare.call(this,sql);if(sql.startsWith("UPDATE cost_budget_reservations SET status='executing'")){const previousBind=prepared.bind.bind(prepared);prepared.bind=(...values)=>{const bound=previousBind(...values),previousRun=bound.run.bind(bound);bound.run=async()=>{database.sqlite.prepare("UPDATE pilot_cohorts SET status='paused' WHERE cohort_id=?").run(cohort.cohortId);deniedAtExecution=true;return previousRun();};return bound;};}return prepared;};try{const response=await request("/api/events",json(owner,body));assert.equal(deniedAtExecution,true,`${action} attempts a real guarded provider claim`);assert.equal(response.status,403,`${action} stops when its cohort pauses immediately before provider execution`);assert.equal((await response.json()).error,"active_pilot_participation_required");assert.equal(providerCalls,0,`${action} never invokes an external provider after its authorization changes`);assert.equal(database.sqlite.prepare("SELECT reserved_microusd FROM cost_budget_counters WHERE scope='pilot_user' AND scope_id=? AND period=?").get("pilot-boundary-owner",`pilot:${cohort.cohortId}`).reserved_microusd,0,`${action} releases pilot spending`);assert.equal(database.sqlite.prepare("SELECT reserved_tokens FROM budget_counters WHERE scope='user' AND scope_id=?").get("pilot-boundary-owner").reserved_tokens,0,`${action} releases token spending`);}finally{environment.DB.prepare=previousPrepare;database.sqlite.prepare("UPDATE pilot_cohorts SET status='active' WHERE cohort_id=?").run(cohort.cohortId);}}
    const selected=await request(`/api/workspaces/${organizationId}/projects/${projectAccessId}/context`,{method:"POST",headers:owner});
    assert.equal(selected.status,200,JSON.stringify(await selected.clone().json()));
    const ownerScoped={...owner,cookie:selected.headers.get("set-cookie")?.split(";")[0]??""};
    const adaptive=adaptivePlanningClient(request,ownerScoped,{projectId:"project-atmosphere",documentId:"doc-atmosphere",sourceSurface:"adaptive",projectScope:false,prompt:"Clarify the current project decisions.",locale:"en"});
    const quote=await adaptive.quote();assert.equal(quote.canExecute,true);assert.equal(quote.workspaceId,organizationId);
    const previousPrepare=environment.DB.prepare;let deniedAtAdaptiveSubmit=false;
    environment.DB.prepare=function(sql){
      const statement=previousPrepare.call(this,sql);if(!/^\s*UPDATE consequential_execution_steps SET status='submitting'/u.test(sql))return statement;
      const bind=statement.bind.bind(statement);statement.bind=(...values)=>{
        const bound=bind(...values),run=bound.run.bind(bound);bound.run=async()=>{
          assert.equal(deniedAtAdaptiveSubmit,false,"The original approved step has only one submission boundary");
          assert.equal(database.sqlite.prepare("SELECT status FROM cost_budget_reservations WHERE reservation_id=?").get(quote.executionId+":usd:0").status,"executing");
          assert.equal(database.sqlite.prepare("SELECT status FROM budget_reservations WHERE reservation_id=?").get(quote.executionId+":tokens:0").status,"active");
          database.sqlite.prepare("UPDATE pilot_cohorts SET status='paused' WHERE cohort_id=?").run(cohort.cohortId);deniedAtAdaptiveSubmit=true;
          return run();
        };return bound;
      };return statement;
    };
    try{
      const accepted=await adaptive.execute(quote);assert.equal(accepted.status,202,JSON.stringify(await accepted.clone().json()));
      assert.equal((await accepted.json()).job.jobId,quote.executionId);await drainBackground();
      assert.equal(deniedAtAdaptiveSubmit,true,"Adaptive planning reaches the real guarded approved provider step");
      const job=database.sqlite.prepare("SELECT status,correlation_id,error_message FROM document_jobs WHERE job_id=?").get(quote.executionId);
      assert.equal(job.status,"failed");assert.equal(job.correlation_id,quote.executionId);assert.equal(job.error_message,"context_authorization_changed");
      const execution=database.sqlite.prepare("SELECT status FROM consequential_executions WHERE execution_id=?").get(quote.executionId),step=database.sqlite.prepare("SELECT status FROM consequential_execution_steps WHERE execution_id=? AND step_index=0").get(quote.executionId);
      assert.equal(execution.status,"failed");assert.equal(step.status,"not-submitted");
      assert.equal(database.sqlite.prepare("SELECT status FROM budget_reservations WHERE reservation_id=?").get(quote.executionId+":tokens:0").status,"released");
      assert.equal(database.sqlite.prepare("SELECT status FROM cost_budget_reservations WHERE reservation_id=?").get(quote.executionId+":usd:0").status,"released");
      for(const[scope,scopeId]of[["pilot_user","pilot-boundary-owner"],["pilot_org",cohort.cohortId]])assert.equal(database.sqlite.prepare("SELECT reserved_microusd FROM cost_budget_counters WHERE scope=? AND scope_id=? AND period=?").get(scope,scopeId,`pilot:${cohort.cohortId}`).reserved_microusd,0,"Paused adaptive work releases each fixed pilot envelope");
      assert.equal(database.sqlite.prepare("SELECT reserved_tokens FROM budget_counters WHERE scope='user' AND scope_id=? AND period=?").get("pilot-boundary-owner",quote.period).reserved_tokens,0);
      assert.equal(providerCalls,0,"Pausing the cohort at the last SQL boundary never invokes the provider");
    }finally{environment.DB.prepare=previousPrepare;await drainBackground();database.sqlite.prepare("UPDATE pilot_cohorts SET status='active' WHERE cohort_id=?").run(cohort.cohortId);}
}finally{globalThis.fetch=originalFetch;}
  const membershipId=database.sqlite.prepare("SELECT membership_id FROM project_memberships WHERE project_access_id=? AND user_id=?").get(projectAccessId,"pilot-boundary-author").membership_id;
  const reviewPermission=await request(`/api/workspaces/${organizationId}/projects/${projectAccessId}/members/${membershipId}`,{method:"PATCH",headers:{...owner,"content-type":"application/json"},body:JSON.stringify({reviewAccess:true})});assert.equal(reviewPermission.status,200);
  database.sqlite.prepare("UPDATE pilot_participants SET role='reviewer' WHERE participant_id=?").run(participantId);
  const reviewerContext=await request(`/api/workspaces/${organizationId}/projects/${projectAccessId}/context`,{method:"POST",headers:author});assert.equal(reviewerContext.status,200);const reviewerScoped={...author,cookie:reviewerContext.headers.get("set-cookie")?.split(";")[0]??""};const reviewerSession=await(await request("/api/session",{headers:reviewerScoped})).json();assert.equal(reviewerSession.projectContext.role,"viewer","a named reviewer cannot inherit an older editor project assignment");assert.equal(reviewerSession.projectContext.permissions.includes("project.review.approve"),true,"independent approval remains available to a designated reviewer");for(const permission of ["project.author","project.library.manage","project.output.request","project.canvas.use"])assert.equal(reviewerSession.projectContext.permissions.includes(permission),false,permission);
  const deniedReviewerEdit=await request(`/api/workspaces/${organizationId}/projects/${projectAccessId}/events`,json(author,{action:"append",event:{type:"BlockPropertyEdited",payload:{block_id:"block-direction",property_path:"text",new_value:"REVIEWER MAY NOT EDIT"}}}));assert.equal(deniedReviewerEdit.status,403);database.sqlite.prepare("UPDATE pilot_participants SET role='member' WHERE participant_id=?").run(participantId);
  for(const condition of ["participant","reviewer"]){
    const originalBatch=environment.DB.batch;let interruptedEvent=false;const prohibitedCopy=`WITHDRAWN ${condition.toUpperCase()} INTERLEAVING`;
    environment.DB.batch=async function(statements){if(!interruptedEvent&&statements.some((statement)=>statement.sql.includes("INSERT INTO event_write_stage")&&statement.values.some((value)=>typeof value==="string"&&value.includes(prohibitedCopy)))){if(condition==="participant")database.sqlite.prepare("UPDATE pilot_participants SET status='revoked',revoked_at=? WHERE participant_id=?").run(new Date().toISOString(),participantId);else database.sqlite.prepare("UPDATE pilot_participants SET role='reviewer' WHERE participant_id=?").run(participantId);interruptedEvent=true;}return originalBatch.call(this,statements);};
    try{const response=await request(`/api/workspaces/${organizationId}/projects/${projectAccessId}/events`,json(author,{action:"append",event:{type:"BlockPropertyEdited",payload:{block_id:"block-direction",property_path:"text",new_value:prohibitedCopy}}}));assert.equal(interruptedEvent,true,`${condition} changes after the cookieless project endpoint has admitted its actor`);assert.equal(response.status,403);assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE json_extract(payload,'$.new_value')=?").get(prohibitedCopy).count,0,`${condition} changes never append one final project event`);}finally{environment.DB.batch=originalBatch;database.sqlite.prepare("UPDATE pilot_participants SET status='active',revoked_at=NULL,role='member' WHERE participant_id=?").run(participantId);}
  }
  for(const condition of ["participant","reviewer","session"]){
    const opened=await request(`/api/workspaces/${organizationId}/projects/${projectAccessId}/context`,{method:"POST",headers:author});assert.equal(opened.status,200);const scoped={...author,cookie:opened.headers.get("set-cookie")?.split(";")[0]??""};
    let storedKey="",removedKey="";environment.MEDIA={async put(key){storedKey=key;if(condition==="participant")database.sqlite.prepare("UPDATE pilot_participants SET status='revoked',revoked_at=? WHERE participant_id=?").run(new Date().toISOString(),participantId);else if(condition==="reviewer")database.sqlite.prepare("UPDATE pilot_participants SET role='reviewer' WHERE participant_id=?").run(participantId);else database.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE organization_id=? AND principal_user_id=? AND revoked_at IS NULL").run(new Date().toISOString(),organizationId,"pilot-boundary-author");},async delete(key){removedKey=key;}};
    const form=new FormData();form.append("file",new File(["approved non-sensitive example"],"controlled-reference.txt",{type:"text/plain"}));form.append("rightsConfirmed","true");form.append("nonSensitiveConfirmed","true");
    try{const response=await request("/api/media",{method:"POST",headers:scoped,body:form});assert.equal(response.status,403,`${condition} withdrawn during upload never becomes shared project content`);assert.ok(storedKey);assert.equal(removedKey,storedKey,`${condition} withdrawn during upload immediately removes staged object bytes`);assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM project_resource_scopes WHERE resource_kind='media' AND resource_id=?").get(storedKey).count,0);}finally{if(condition==="participant"||condition==="reviewer")database.sqlite.prepare("UPDATE pilot_participants SET status='active',revoked_at=NULL,role='member' WHERE participant_id=?").run(participantId);}
  }
});

test("activating a controlled pilot closes existing legacy shares and excludes previously unattested source material",async()=>{
  const {database,environment,request,drainBackground}=await productionWorker();const owner=await specialistIdentity(database,request,"pilot-transition-owner");
  assert.equal((await request("/api/events?after=0&content=0",{headers:owner})).status,200);
  const json=(headers,body)=>({method:"POST",headers:{...headers,"content-type":"application/json"},body:JSON.stringify(body)});
  const organization=await request("/api/workspaces",json(owner,{name:"Existing customer project"}));assert.equal(organization.status,201);const organizationId=(await organization.json()).organizationId;
  const project=await request(`/api/workspaces/${organizationId}/projects`,json(owner,{projectId:"project-atmosphere"}));assert.equal(project.status,201);const projectAccessId=(await project.json()).projectAccessId;
  const selected=await request(`/api/workspaces/${organizationId}/projects/${projectAccessId}/context`,{method:"POST",headers:owner});assert.equal(selected.status,200);const scoped={...owner,cookie:selected.headers.get("set-cookie")?.split(";")[0]??""};
  const objects=new Map();environment.MEDIA={
    async put(key,value,options={}){const bytes=value instanceof ArrayBuffer?value:await new Response(value).arrayBuffer();objects.set(key,{bytes,metadata:options.customMetadata??{},mime:options.httpMetadata?.contentType??"application/octet-stream"});},
    async get(key){const item=objects.get(key);return item?{body:new Response(item.bytes).body,httpEtag:"legacy-source-etag",customMetadata:item.metadata,writeHttpMetadata(headers){headers.set("content-type",item.mime);}}:null;},
    async head(key){const item=objects.get(key);return item?{customMetadata:item.metadata,httpEtag:"legacy-source-etag"}:null;},
    async delete(key){objects.delete(key);},
  };
  const upload=async(name)=>{const form=new FormData();form.append("file",new File(["existing customer visual source"],name,{type:"image/png"}));form.append("rightsConfirmed","true");const response=await request("/api/media",{method:"POST",headers:scoped,body:form});assert.equal(response.status,200,JSON.stringify(await response.clone().json()));return await response.json();};
  const existing=await upload("existing-source.png"),unattached=await upload("other-existing-source.png"),librarySource=await upload("existing-library-source.png");assert.equal(objects.get(existing.key).metadata.sourceClassification,undefined,"pre-pilot assets truthfully have no pilot material attestation");
  assert.ok(database.sqlite.prepare("SELECT resource_id FROM project_resource_scopes WHERE project_access_id=? AND resource_kind='media' AND resource_id=?").get(projectAccessId,existing.key),"the old uploaded file remains owned by this exact project before reference attachment");assert.equal(objects.get(existing.key).metadata.sha256,existing.contentHash);
  const append=async(event)=>request("/api/events",json(scoped,{action:"append",event}));
  const attachedReference=await append({type:"ReferenceIngested",payload:{reference_id:"existing-pilot-source",document_id:"doc-atmosphere",source_type:"upload",source_ref:existing.url,content_hash:existing.contentHash,rights_class:"asserted"}});assert.equal(attachedReference.status,200,JSON.stringify({body:await attachedReference.clone().json(),scope:database.sqlite.prepare("SELECT project_access_id,organization_id,owner_user_id,source_event_id FROM project_resource_scopes WHERE resource_kind='media' AND resource_id=?").get(existing.key),metadata:objects.get(existing.key).metadata,hash:existing.contentHash}));
  assert.equal((await append({type:"RightsAsserted",payload:{reference_id:"existing-pilot-source",rights_class:"owned_or_licensed",assertion_method:"pre-pilot-upload"}})).status,200);
  assert.equal((await append({type:"BlockCreated",payload:{block_id:"existing-pilot-source-block",project_id:"project-atmosphere",document_id:"doc-atmosphere",type:"reference",handle:"reference/existing-pilot-source",position:"z0001",properties:{reference_id:"existing-pilot-source",label:"Existing customer source",media_url:existing.url,authority:"authored",weight:.8}}})).status,200);
  for(const event of [{type:"ReferenceIngested",payload:{reference_id:"legacy-library-reference",document_id:"doc-atmosphere",source_type:"upload",source_ref:librarySource.url,content_hash:librarySource.contentHash,rights_class:"asserted"}},{type:"RightsAsserted",payload:{reference_id:"legacy-library-reference",rights_class:"owned_or_licensed",assertion_method:"pre-pilot-library"}},{type:"BlockCreated",payload:{block_id:"legacy-library-reference-block",project_id:"project-atmosphere",scope:"library",type:"reference",handle:"reference/legacy-library",position:"z0002",properties:{reference_id:"legacy-library-reference",label:"Existing reusable library source",media_url:librarySource.url,authority:"authored",weight:.8}}}]){const recorded=await append(event);assert.equal(recorded.status,200,JSON.stringify(await recorded.clone().json()));}
  database.sqlite.prepare("UPDATE users SET role='admin' WHERE user_id=?").run("pilot-transition-owner");
  for(const event of [{type:"CanvasCreated",payload:{project_id:"project-atmosphere",canvas_id:"legacy-library-board",name:"Legacy context board"}},{type:"CanvasItemPlaced",payload:{project_id:"project-atmosphere",canvas_id:"legacy-library-board",item_id:"legacy-library-item",source_kind:"block",source_id:"legacy-library-reference-block",title:"Reusable source",frame:{x:0,y:0,w:200,h:150}}},{type:"ContextSetFormalized",payload:{project_id:"project-atmosphere",canvas_id:"legacy-library-board",context_set_id:"legacy-library-context",item_ids:["legacy-library-item"],name:"Existing visual context"}}]){const recorded=await append(event);assert.equal(recorded.status,200,JSON.stringify(await recorded.clone().json()));}
  const now=new Date().toISOString(),stream="creative:pilot-transition-owner",legacy={title:"Earlier output",summary:"Legacy customer work",content_markdown:"Earlier customer output.",presentation:null,items:[{title:"Earlier",body:"Earlier customer output.",notes:"",image_prompt:"",slide:null}]};
  database.sqlite.prepare("INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at) VALUES(?,?,?,?,?,?,NULL)").run("pre-pilot-output-content","pilot-transition-owner","document-artifact",JSON.stringify(legacy),now,"9999-12-31T23:59:59.999Z");
  const head=Number(database.sqlite.prepare("SELECT MAX(sequence) AS head FROM events WHERE stream_id=?").get(stream).head);database.sqlite.prepare("INSERT INTO events(event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,causation_id,compensates_event_id,schema_version,type,payload) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run("pre-pilot-output-event",stream,head+1,now,now,"worker:renderer","test",crypto.randomUUID(),null,null,1,"DocumentRenderCompleted",JSON.stringify({project_id:"project-atmosphere",document_id:"doc-atmosphere",artifact_id:"pre-pilot-output",artifact_kind:"short_story",title:legacy.title,summary:legacy.summary,item_count:1,items:[{id:"legacy-opening",title:"Earlier"}],content_ref:"pre-pilot-output-content",requested_by_user_id:"pilot-transition-owner"}));
  const issued=await request("/api/shares",json(scoped,{resourceKind:"document",documentId:"doc-atmosphere",projectId:"project-atmosphere"}));assert.equal(issued.status,200,JSON.stringify(await issued.clone().json()));const share=(await issued.json()).share;
  const sharedPath=`/api/shared/${encodeURIComponent(share.token)}`,mediaPath=`${sharedPath}/media/${encodeURIComponent(existing.key)}`;assert.equal((await request(sharedPath)).status,200);assert.equal((await request(mediaPath)).status,200,"legacy images share under the old unmanaged project policy");
  const activated=await request(`/api/workspaces/${organizationId}/pilot`,json(owner,{maxParticipants:2}));assert.equal(activated.status,201);const cohortId=(await activated.json()).cohortId;
  assert.equal((await request(sharedPath)).status,404,"an existing external link closes immediately when its legacy unapproved output enters a controlled pilot");assert.equal((await request(mediaPath)).status,404,"existing public media links obey the same upgraded pilot boundary");
  assert.equal((await request("/api/events?after=0&content=0",{headers:scoped})).status,200);
  database.reset();const reused=await append({type:"ReferenceIngested",payload:{reference_id:"another-legacy-source",document_id:"doc-atmosphere",source_type:"upload",source_ref:unattached.url,content_hash:unattached.contentHash,rights_class:"asserted"}});assert.equal(reused.status,403);assert.equal((await reused.json()).error,"pilot_non_sensitive_source_confirmation_required");assert.equal(database.writeCount(),0,"a legacy stored file cannot be newly attached without a cohort-bound source confirmation");
  environment.OPENAI_API_KEY="synthetic-pilot-provider-never-called";const originalFetch=globalThis.fetch;let providerCalls=0;globalThis.fetch=async()=>{providerCalls++;assert.fail("Unattested sources must not reach an external provider");};try{for(const [endpoint,body] of [["/api/events",{action:"generate",documentId:"doc-atmosphere",budgetAcknowledged:true}],["/api/document-jobs",{kind:"generate",documentId:"doc-atmosphere",payload:{budgetAcknowledged:true}}]]){const generated=await request(endpoint,json(endpoint==="/api/events"?owner:scoped,body));assert.equal(generated.status,428,`${endpoint} excludes already-attached pre-pilot source material from paid context`);assert.equal((await generated.json()).error,"pilot_non_sensitive_source_confirmation_required");}
  const removedDocumentSource=await append({type:"BlockRemoved",payload:{block_id:"existing-pilot-source-block",document_id:"doc-atmosphere",reason:"remove unapproved legacy document source"}});assert.equal(removedDocumentSource.status,200,JSON.stringify(await removedDocumentSource.clone().json()));const visible=await(await request("/api/events?after=0&limit=5000&content=0",{headers:scoped})).json();const isolated=foldEvents(visible.events,Number.POSITIVE_INFINITY,"doc-atmosphere","project-atmosphere");assert.ok(!isolated.blocks.some((block)=>block.id==="legacy-library-reference-block"),"the unclassified reusable reference does not exist in the document-only provider context");assert.ok(isolated.libraryBlocks.some((block)=>block.id==="legacy-library-reference-block"),"the selected reusable context remains available in the project library");
  for(const [label,endpoint,identity,body] of [["direct approved board context","/api/events",owner,{action:"generate",documentId:"doc-atmosphere",canvasId:"legacy-library-board",contextSetId:"legacy-library-context",budgetAcknowledged:true}],["queued approved board context","/api/document-jobs",scoped,{kind:"generate",documentId:"doc-atmosphere",payload:{canvasId:"legacy-library-board",contextSetId:"legacy-library-context",budgetAcknowledged:true}}]]){const generated=await request(endpoint,json(identity,body));assert.equal(generated.status,428,`${label} validates its actual provider-facing reusable source blocks`);assert.equal((await generated.json()).error,"pilot_non_sensitive_source_confirmation_required");}

    for(const identity of[owner,scoped]){
      const adaptive=adaptivePlanningClient(request,identity,{projectId:"project-atmosphere",documentId:"doc-atmosphere",sourceSurface:"adaptive",projectScope:true,prompt:"Structure this complete project.",locale:"en"});
      const quote=await adaptive.quote();assert.equal(quote.workspaceId,organizationId);assert.equal(quote.providerAvailable,true);assert.equal(quote.canExecute,false);
      assert.ok(quote.unavailableReasons.includes("adaptive_pilot_source_denied"),"The free quote explains the unattested-source blocker");
      const input=JSON.parse(quote.privateInput.providerRequest.input);
      assert.ok(input.blocks.some(block=>block.id==="legacy-library-reference-block"),"The proposal evaluates the actual project-wide reusable source, not a smaller document-only substitute");
      const denied=await adaptive.execute(quote);assert.equal(denied.status,403,JSON.stringify(await denied.clone().json()));assert.equal((await denied.json()).error,"adaptive_pilot_source_denied");
    }
    for(const[endpoint,identity,body]of[
      ["/api/events",owner,{action:"structure_adaptive",documentId:"doc-atmosphere",projectScope:true,prompt:"Structure this complete project.",budgetAcknowledged:true}],
      ["/api/document-jobs",scoped,{kind:"structure_adaptive",documentId:"doc-atmosphere",payload:{projectScope:true,prompt:"Structure this complete project.",budgetAcknowledged:true}}],
    ]){const denied=await request(endpoint,json(identity,body));assert.equal(denied.status,428);assert.equal((await denied.json()).error,endpoint==="/api/events"?"pilot_non_sensitive_source_confirmation_required":"adaptive_consent_required","A legacy route cannot bypass its earliest source or approval gate");}
    assert.equal(providerCalls,0,"Neither source disclosure nor denied approval contacts a provider");
    assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM budget_reservations").get().count,0,"Unattested sources never reserve tokens");
  assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM cost_budget_reservations WHERE operation!=''").get().count,0,"unclassified legacy context never reserves provider spending");assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM document_jobs").get().count,0,"unclassified legacy context never creates a background provider job");assert.ok(cohortId);
  }finally{await drainBackground();globalThis.fetch=originalFetch;}
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
  const presentationSource=await request("/api/events",json(ownerA,{action:"append",event:{type:"BlockCreated",payload:{project_id:"project-atmosphere",document_id:freshDocument,block_id:"budget-authorized-direction",scope:"document",type:"direction",handle:"direction/budget-source",properties:{text:"Authorized presentation source",weight:1,authority:"authored"}}}}));
  assert.equal(presentationSource.status,200,"managed delivery is admitted for budgeting only after its document has an authorized authored source");
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
  for(const path of ["/api/portfolio/operations/overview","/api/portfolio/engineering/health","/api/portfolio/engineering/jobs"]){database.reset();assert.equal((await request(path)).status,200,path);const batch=database.calls.find((call)=>call.kind==="batch");assert.ok(batch);assert.equal(batch.statements.length,path.endsWith("/health")||path.endsWith("/overview")?3:2,path);assert.equal(batch.statements.some((statement)=>/FROM events/i.test(statement.sql)),false,path);}
  for(const path of ["/api/portfolio/engineering/events","/api/portfolio/engineering/sync"]){database.reset();assert.equal((await request(path)).status,200,path);const batch=database.calls.find((call)=>call.kind==="batch");assert.ok(batch);assert.equal(batch.statements.length,3,path);assert.equal(batch.statements.some((statement)=>/FROM events/i.test(statement.sql)),true,path);}
});

test("organization-owned context publishes immutable versions, isolates tenants, and updates only explicitly following documents",async()=>{
  const {database,request,owner,organizationId,projectAccessId,projection,json,open}=await enterpriseWorkspaceFixture();
  const outsider=await specialistIdentity(database,request,"enterprise-package-outsider");
  const selected=projection.blocks.filter((block)=>block.type!=="reference"&&!block.locked).slice(0,2);
  assert.ok(selected.length>=1,"seeded project provides portable organization decisions");
  const secondaryEvents=[
    {type:"ProjectCreated",payload:{project_id:"enterprise-secondary",name:"Second organizational project",state:"active"}},
    {type:"DocumentCreated",payload:{project_id:"enterprise-secondary",document_id:"enterprise-pinned",title:"Pinned document"}},
    {type:"DocumentCreated",payload:{project_id:"enterprise-secondary",document_id:"enterprise-follow",title:"Following document"}},
  ];
  const authored=await request("/api/events",json(owner,{action:"batch",events:secondaryEvents}));assert.equal(authored.status,200,JSON.stringify(await authored.clone().json()));
  const registration=await request(`/api/workspaces/${organizationId}/projects`,json(owner,{projectId:"enterprise-secondary"}));assert.equal(registration.status,201,JSON.stringify(await registration.clone().json()));
  const destination=(await registration.json()).projectAccessId;
  const draft=await request(`/api/workspaces/${organizationId}/context-packages`,json(owner,{name:"Approved messaging foundation",description:"Audience and direction",sourceProjectAccessId:projectAccessId,documentId:"doc-atmosphere",blockIds:selected.map((block)=>block.id)}));
  assert.equal(draft.status,201,JSON.stringify(await draft.clone().json()));const first=await draft.json();
  database.reset();assert.equal((await request(`/api/workspaces/${organizationId}/context-packages/${first.packageId}`,{headers:outsider})).status,403);assert.equal(database.writeCount(),0);
  assert.equal((await request(`/api/workspaces/${organizationId}/context-packages/${first.packageId}/versions/${first.versionId}/publish`,{method:"POST",headers:owner})).status,200);
  assert.throws(()=>database.sqlite.prepare("UPDATE organization_context_package_versions SET content_sha256='forged' WHERE version_id=?").run(first.versionId),/immutable/);
  assert.throws(()=>database.sqlite.prepare("UPDATE organization_context_package_versions SET status='draft' WHERE version_id=?").run(first.versionId),/immutable/,"a published version cannot be demoted to bypass immutable content guards");
  assert.throws(()=>database.sqlite.prepare("UPDATE organization_context_package_contents SET content_json='forged' WHERE version_id=?").run(first.versionId),/immutable/);
  assert.throws(()=>database.sqlite.prepare("UPDATE organization_context_package_sources SET content_sha256='forged' WHERE version_id=?").run(first.versionId),/immutable/,"published source provenance is independently immutable");
  const pinned=await request(`/api/workspaces/${organizationId}/context-packages/${first.packageId}/adopt`,json(owner,{projectAccessId:destination,documentId:"enterprise-pinned",versionId:first.versionId,updateMode:"pinned"}));
  assert.equal(pinned.status,201,JSON.stringify(await pinned.clone().json()));const pinnedBinding=await pinned.json();
  const following=await request(`/api/workspaces/${organizationId}/context-packages/${first.packageId}/adopt`,json(owner,{projectAccessId:destination,documentId:"enterprise-follow",versionId:first.versionId,updateMode:"follow-approved"}));
  assert.equal(following.status,201,JSON.stringify(await following.clone().json()));const followingBinding=await following.json();
  assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM project_context_package_members WHERE binding_id=?").get(pinnedBinding.bindingId).count,selected.length);
  const sourceScope=await open(owner);
  const oldText=String(selected[0].properties.text??selected[0].properties.label??"");
  const update=await request("/api/events",json(sourceScope,{action:"append",event:{type:"BlockPropertyEdited",payload:{block_id:selected[0].id,property_path:"text",old_value:oldText,new_value:"A materially improved approved organization decision"}}}));
  assert.equal(update.status,200,JSON.stringify(await update.clone().json()));
  const revised=await request(`/api/workspaces/${organizationId}/context-packages/${first.packageId}/versions`,json(owner,{sourceProjectAccessId:projectAccessId,documentId:"doc-atmosphere",blockIds:selected.map((block)=>block.id)}));
  assert.equal(revised.status,201,JSON.stringify(await revised.clone().json()));const second=await revised.json();
  assert.equal((await request(`/api/workspaces/${organizationId}/context-packages/${first.packageId}/versions/${second.versionId}/publish`,{method:"POST",headers:owner})).status,200);
  const pinnedBefore=database.sqlite.prepare("SELECT version_id,pending_version_id FROM project_context_package_bindings WHERE binding_id=?").get(pinnedBinding.bindingId);
  const followBefore=database.sqlite.prepare("SELECT version_id,pending_version_id FROM project_context_package_bindings WHERE binding_id=?").get(followingBinding.bindingId);
  assert.equal(pinnedBefore.version_id,first.versionId);assert.equal(pinnedBefore.pending_version_id,null,"pinned work never sees an automatic version change");
  assert.equal(followBefore.version_id,first.versionId);assert.equal(followBefore.pending_version_id,second.versionId,"following documents require explicit acceptance");
  assert.ok(database.sqlite.prepare("SELECT 1 FROM project_notifications WHERE project_access_id=? AND kind='context_update_available' AND document_id='enterprise-follow'").get(destination),"following editors receive a scoped pending-version notice");
  const accepted=await request(`/api/workspaces/${organizationId}/context-packages/${first.packageId}/bindings/${followingBinding.bindingId}`,json(owner,{action:"accept",versionId:second.versionId},"PATCH"));
  assert.equal(accepted.status,200,JSON.stringify(await accepted.clone().json()));
  assert.equal(database.sqlite.prepare("SELECT version_id FROM project_context_package_bindings WHERE binding_id=?").get(followingBinding.bindingId).version_id,second.versionId);
  assert.equal(database.sqlite.prepare("SELECT version_id FROM project_context_package_bindings WHERE binding_id=?").get(pinnedBinding.bindingId).version_id,first.versionId);
  const affected=database.sqlite.prepare("SELECT target_block_id FROM project_context_package_members WHERE binding_id=? AND source_block_id=?").get(followingBinding.bindingId,selected[0].id).target_block_id;
  assert.ok(database.sqlite.prepare("SELECT 1 FROM project_event_scopes scope JOIN events event ON event.event_id=scope.event_id WHERE scope.project_access_id=? AND event.type='BlockPropertyEdited' AND json_extract(event.payload,'$.block_id')=?").get(destination,affected));
  if(selected.length===2){
    const relationId="organization-semantic-relation";
    const semantics=[
      {type:"BlockPropertyEdited",payload:{block_id:selected[0].id,property_path:"type",old_value:selected[0].type,new_value:"constraint"}},
      {type:"BlockRenamed",payload:{block_id:selected[0].id,old_handle:selected[0].handle,new_handle:"constraint/organization-governed"}},
      {type:"BlockPropertyEdited",payload:{block_id:selected[0].id,property_path:"position",old_value:selected[0].position,new_value:"z9010"}},
      {type:"BlockLocked",payload:{block_id:selected[0].id}},
      {type:"BlockRelationAdded",payload:{document_id:"doc-atmosphere",relation_id:relationId,from_block_id:selected[0].id,to_block_id:selected[1].id,kind:"depends_on",properties:{required:true}}},
    ];
    for(const event of semantics){const changed=await request("/api/events",json(sourceScope,{action:"append",event}));assert.equal(changed.status,200,JSON.stringify(await changed.clone().json()));}
    const next=await request(`/api/workspaces/${organizationId}/context-packages/${first.packageId}/versions`,json(owner,{sourceProjectAccessId:projectAccessId,documentId:"doc-atmosphere",blockIds:selected.map((block)=>block.id)}));assert.equal(next.status,201);const third=await next.json();
    assert.equal((await request(`/api/workspaces/${organizationId}/context-packages/${first.packageId}/versions/${third.versionId}/publish`,{method:"POST",headers:owner})).status,200);
    const adopted=await request(`/api/workspaces/${organizationId}/context-packages/${first.packageId}/bindings/${followingBinding.bindingId}`,json(owner,{action:"accept",versionId:third.versionId},"PATCH"));assert.equal(adopted.status,200,JSON.stringify(await adopted.clone().json()));
    const scoped=await open(owner,destination);const receipt=await(await request("/api/events?after=0&limit=5000&content=1",{headers:scoped})).json();
    const current=foldEvents(receipt.events,Number.POSITIVE_INFINITY,"enterprise-follow","enterprise-secondary");const governed=current.blocks.find((block)=>block.id===affected);
    assert.equal(governed.type,"constraint");assert.equal(governed.handle,"constraint/organization-governed");assert.equal(governed.position,"z9010");assert.equal(governed.locked,true,"approved package boundaries preserve mandatory lock transitions");
    const adjacent=database.sqlite.prepare("SELECT target_block_id FROM project_context_package_members WHERE binding_id=? AND source_block_id=?").get(followingBinding.bindingId,selected[1].id).target_block_id;
    assert.ok(current.blockRelations.some((relation)=>!relation.removed&&relation.fromBlockId===affected&&relation.toBlockId===adjacent&&relation.kind==="depends_on"),"relation-only semantic context changes are actually applied to the target document");
  }
  assert.equal(database.sqlite.prepare("SELECT 1 FROM organization_audit_events WHERE organization_id=? AND instr(detail_json,'materially improved')>0").get(organizationId),undefined,"audit metadata never leaks package prose");
});

test("revoking project access at package adoption never commits bindings without their exact guarded project events",async()=>{
  const {database,environment,request,owner,organizationId,projectAccessId,projection,json}=await enterpriseWorkspaceFixture();
  const editor=await specialistIdentity(database,request,"enterprise-package-editor");
  const invitation=await request(`/api/workspaces/${organizationId}/members`,json(owner,{email:"enterprise-package-editor@example.test",role:"member"}));assert.equal(invitation.status,201);const invited=await invitation.json();
  assert.equal((await request(`/api/workspaces/${organizationId}/invitations/${invited.invitationId}/accept`,{method:"POST",headers:editor})).status,200);
  const granted=await request(`/api/workspaces/${organizationId}/projects/${projectAccessId}/members`,json(owner,{userId:"enterprise-package-editor",role:"editor"}));assert.equal(granted.status,201);
  const selected=projection.blocks.find((block)=>block.type!=="reference"&&!block.locked);assert.ok(selected);
  const prepared=await request(`/api/workspaces/${organizationId}/context-packages`,json(owner,{name:"Atomic adoption boundary",sourceProjectAccessId:projectAccessId,documentId:"doc-atmosphere",blockIds:[selected.id]}));assert.equal(prepared.status,201);const version=await prepared.json();
  assert.equal((await request(`/api/workspaces/${organizationId}/context-packages/${version.packageId}/versions/${version.versionId}/publish`,{method:"POST",headers:owner})).status,200);
  const baseline=database.sqlite.prepare("SELECT COUNT(*) AS count FROM project_event_scopes WHERE project_access_id=?").get(projectAccessId).count;
  const original=environment.DB.batch.bind(environment.DB);let intercepted=false;
  environment.DB.batch=async(statements)=>{
    if(!intercepted&&statements.some((statement)=>statement.sql.includes("INSERT INTO project_context_package_bindings"))){
      intercepted=true;database.sqlite.prepare("UPDATE project_memberships SET status='revoked',revoked_at=?,updated_at=? WHERE project_access_id=? AND user_id=?").run(new Date().toISOString(),new Date().toISOString(),projectAccessId,"enterprise-package-editor");
    }
    return original(statements);
  };
  const denied=await request(`/api/workspaces/${organizationId}/context-packages/${version.packageId}/adopt`,json(editor,{projectAccessId,documentId:"doc-atmosphere",versionId:version.versionId}));
  assert.equal(intercepted,true);assert.equal(denied.status,403);
  assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM project_context_package_bindings WHERE package_id=?").get(version.packageId).count,0);
  assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM project_context_package_members WHERE organization_id=?").get(organizationId).count,0);
  assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM project_event_scopes WHERE project_access_id=?").get(projectAccessId).count,baseline,"revoked adoption commits neither authored history nor unguarded binding sidecars");
  environment.DB.batch=original;
});

test("organization-owned packages preserve independently licensed source bytes, verified citations, and cross-custodian evidence",async()=>{
  const {database,environment,request,owner,organizationId,projectAccessId,projection,json,open}=await enterpriseWorkspaceFixture();
  const objects=new Map();
  environment.MEDIA={
    async put(key,value,options){objects.set(key,{bytes:new Uint8Array(value),metadata:{...options.customMetadata},contentType:options.httpMetadata.contentType});},
    async get(key){const stored=objects.get(key);return stored?{body:new Blob([stored.bytes]).stream(),customMetadata:stored.metadata,httpEtag:"verified",writeHttpMetadata(headers){headers.set("content-type",stored.contentType);}}:null;},
    async head(key){const stored=objects.get(key);return stored?{customMetadata:stored.metadata,writeHttpMetadata(headers){headers.set("content-type",stored.contentType);}}:null;},
    async delete(key){objects.delete(key);},
  };
  const colleague=await specialistIdentity(database,request,"enterprise-source-custodian");
  assert.equal((await request("/api/events?after=0&content=0",{headers:colleague})).status,200);
  const invitation=await request(`/api/workspaces/${organizationId}/members`,json(owner,{email:"enterprise-source-custodian@example.test",role:"administrator"}));assert.equal(invitation.status,201);const invited=await invitation.json();
  assert.equal((await request(`/api/workspaces/${organizationId}/invitations/${invited.invitationId}/accept`,{method:"POST",headers:colleague})).status,200);
  const registered=await request(`/api/workspaces/${organizationId}/projects`,json(colleague,{projectId:"project-atmosphere"}));assert.equal(registered.status,201);const destination=(await registered.json()).projectAccessId;
  const sourceScope=await open(owner);
  const file=new FormData();file.set("file",new File(["Licensed customer briefing.\nUse deliberate, exact context in every deliverable."],"trusted-brief.txt",{type:"text/plain"}));file.set("rightsConfirmed","true");
  const uploadedResponse=await request("/api/media",{method:"POST",headers:sourceScope,body:file});assert.equal(uploadedResponse.status,200,JSON.stringify(await uploadedResponse.clone().json()));const uploaded=await uploadedResponse.json();
  const referenceId="organization-verified-reference",blockId="organization-verified-source";
  const evidence={reference_id:referenceId,label:"Licensed product briefing",media_url:uploaded.url,authority:"authored",weight:.8,source_evidence_hash:uploaded.sourceEvidenceHash,source_content_hash:uploaded.contentHash,source_mime_type:uploaded.mimeType,source_kind:uploaded.extraction.sourceKind,extraction_status:uploaded.extraction.status,text:uploaded.extraction.text,source_citations:uploaded.extraction.segments.map((segment)=>({anchor:segment.anchor,excerpt:segment.text})),source_segment_count:uploaded.extraction.segments.length,source_excerpt_truncated:uploaded.extraction.truncated};
  for(const event of [
    {type:"ReferenceIngested",payload:{reference_id:referenceId,document_id:"doc-atmosphere",source_type:"upload",source_ref:uploaded.url,content_hash:uploaded.contentHash,rights_class:"asserted"}},
    {type:"RightsAsserted",payload:{reference_id:referenceId,rights_class:"owned_or_licensed",assertion_method:"explicit-confirmation"}},
    {type:"BlockCreated",payload:{project_id:"project-atmosphere",document_id:"doc-atmosphere",block_id:blockId,type:"reference",handle:"reference/verified-brief",position:"z9020",properties:evidence}},
  ]){const appended=await request("/api/events",json(sourceScope,{action:"append",event}));assert.equal(appended.status,200,JSON.stringify(await appended.clone().json()));}
  const definition={name:"Evidence-backed organization kit",sourceProjectAccessId:projectAccessId,documentId:"doc-atmosphere",blockIds:[blockId]};
  database.reset();const unconfirmed=await request(`/api/workspaces/${organizationId}/context-packages`,json(owner,definition));assert.equal(unconfirmed.status,428);assert.equal(database.writeCount(),0,"original source custody requires a deliberate organization-wide rights assertion");
  const created=await request(`/api/workspaces/${organizationId}/context-packages`,json(owner,{...definition,sourceRightsConfirmed:true,sourceNonSensitiveConfirmed:true}));assert.equal(created.status,201,JSON.stringify(await created.clone().json()));const draft=await created.json();
  const snapshot=JSON.parse(database.sqlite.prepare("SELECT content_json FROM organization_context_package_contents WHERE version_id=?").get(draft.versionId).content_json);const governed=snapshot.blocks[0].source;
  assert.ok(governed.objectKey.startsWith(`organization-context/${organizationId}/`));assert.equal(objects.get(governed.objectKey).metadata.organizationId,organizationId);assert.equal(objects.get(governed.objectKey).metadata.ownerId,undefined,"organization custody does not depend on the publishing user's private object namespace");assert.equal(governed.contentSha256,uploaded.contentHash);
  assert.equal((await request(`/api/workspaces/${organizationId}/context-packages/${draft.packageId}/versions/${draft.versionId}/publish`,{method:"POST",headers:owner})).status,200);
  objects.delete(uploaded.key);
  const adopted=await request(`/api/workspaces/${organizationId}/context-packages/${draft.packageId}/adopt`,json(colleague,{projectAccessId:destination,documentId:"doc-atmosphere",versionId:draft.versionId,updateMode:"follow-approved"}));assert.equal(adopted.status,201,JSON.stringify(await adopted.clone().json()));const firstBinding=await adopted.json();
  const targetScope=await open(colleague,destination);const targetEvents=await(await request("/api/events?after=0&limit=5000&content=1",{headers:targetScope})).json();
  const target=foldEvents(targetEvents.events,Number.POSITIVE_INFINITY,"doc-atmosphere","project-atmosphere").blocks.find((block)=>block.properties.organization_context_package_id===draft.packageId);
  assert.ok(target);assert.equal(target.type,"reference");assert.equal(target.properties.source_content_hash,uploaded.contentHash);assert.deepEqual(target.properties.source_citations,evidence.source_citations);assert.notEqual(target.properties.reference_id,referenceId);assert.notEqual(target.properties.media_url,uploaded.url);
  const restored=await request(target.properties.media_url,{headers:targetScope});assert.equal(restored.status,200);assert.match(await restored.text(),/Licensed customer briefing/);
  assert.ok(database.sqlite.prepare("SELECT 1 FROM project_resource_scopes WHERE project_access_id=? AND organization_id=? AND resource_kind='reference' AND resource_id=?").get(destination,organizationId,target.properties.reference_id));

  const replacementFile=new FormData();replacementFile.set("file",new File(["Updated licensed evidence.\nThis new approved source supersedes the original briefing."],"updated-brief.txt",{type:"text/plain"}));replacementFile.set("rightsConfirmed","true");
  const replacementUpload=await request("/api/media",{method:"POST",headers:sourceScope,body:replacementFile});assert.equal(replacementUpload.status,200);const replacement=await replacementUpload.json();
  const replacementReference="organization-replacement-reference",replacementBlock="organization-replacement-source";
  const replacementEvidence={reference_id:replacementReference,label:"Updated licensed briefing",media_url:replacement.url,authority:"authored",weight:.8,source_evidence_hash:replacement.sourceEvidenceHash,source_content_hash:replacement.contentHash,source_mime_type:replacement.mimeType,source_kind:replacement.extraction.sourceKind,extraction_status:replacement.extraction.status,text:replacement.extraction.text,source_citations:replacement.extraction.segments.map((segment)=>({anchor:segment.anchor,excerpt:segment.text})),source_segment_count:replacement.extraction.segments.length,source_excerpt_truncated:replacement.extraction.truncated};
  for(const event of [
    {type:"ReferenceIngested",payload:{reference_id:replacementReference,document_id:"doc-atmosphere",source_type:"upload",source_ref:replacement.url,content_hash:replacement.contentHash,rights_class:"asserted"}},
    {type:"RightsAsserted",payload:{reference_id:replacementReference,rights_class:"owned_or_licensed",assertion_method:"explicit-confirmation"}},
    {type:"BlockCreated",payload:{project_id:"project-atmosphere",document_id:"doc-atmosphere",block_id:replacementBlock,type:"reference",handle:"reference/updated-brief",position:"z9021",properties:replacementEvidence}},
  ]){const appended=await request("/api/events",json(sourceScope,{action:"append",event}));assert.equal(appended.status,200,JSON.stringify(await appended.clone().json()));}
  const nextDraft=await request(`/api/workspaces/${organizationId}/context-packages/${draft.packageId}/versions`,json(owner,{sourceProjectAccessId:projectAccessId,documentId:"doc-atmosphere",blockIds:[replacementBlock],sourceRightsConfirmed:true,sourceNonSensitiveConfirmed:true}));assert.equal(nextDraft.status,201,JSON.stringify(await nextDraft.clone().json()));const secondVersion=await nextDraft.json();
  assert.equal((await request(`/api/workspaces/${organizationId}/context-packages/${draft.packageId}/versions/${secondVersion.versionId}/publish`,{method:"POST",headers:owner})).status,200);
  const accepted=await request(`/api/workspaces/${organizationId}/context-packages/${draft.packageId}/bindings/${firstBinding.bindingId}`,json(colleague,{action:"accept",versionId:secondVersion.versionId},"PATCH"));assert.equal(accepted.status,200,JSON.stringify(await accepted.clone().json()));
  const updatedEvents=await(await request("/api/events?after=0&limit=5000&content=1",{headers:targetScope})).json();
  const updatedProjection=foldEvents(updatedEvents.events,Number.POSITIVE_INFINITY,"doc-atmosphere","project-atmosphere");
  const replacementTarget=updatedProjection.blocks.find((block)=>block.properties.organization_context_package_id===draft.packageId&&!block.removed);
  assert.ok(replacementTarget);assert.equal(replacementTarget.properties.source_content_hash,replacement.contentHash);assert.notEqual(replacementTarget.properties.reference_id,target.properties.reference_id);assert.deepEqual(replacementTarget.properties.source_citations,replacementEvidence.source_citations);
  const replacementContent=await request(replacementTarget.properties.media_url,{headers:targetScope});assert.equal(replacementContent.status,200);assert.match(await replacementContent.text(),/Updated licensed evidence/);

  const governedDecision=projection.blocks.find((block)=>block.type!=="reference");assert.ok(governedDecision);
  const plainDraftResponse=await request(`/api/workspaces/${organizationId}/context-packages`,json(owner,{name:"Decision before source",sourceProjectAccessId:projectAccessId,documentId:"doc-atmosphere",blockIds:[governedDecision.id]}));assert.equal(plainDraftResponse.status,201);const plainDraft=await plainDraftResponse.json();
  assert.equal((await request(`/api/workspaces/${organizationId}/context-packages/${plainDraft.packageId}/versions/${plainDraft.versionId}/publish`,{method:"POST",headers:owner})).status,200);
  const plainAdoption=await request(`/api/workspaces/${organizationId}/context-packages/${plainDraft.packageId}/adopt`,json(colleague,{projectAccessId:destination,documentId:"doc-atmosphere",versionId:plainDraft.versionId,updateMode:"follow-approved"}));assert.equal(plainAdoption.status,201,JSON.stringify(await plainAdoption.clone().json()));const plainBinding=await plainAdoption.json();
  const nextPlain=await request(`/api/workspaces/${organizationId}/context-packages/${plainDraft.packageId}/versions`,json(owner,{sourceProjectAccessId:projectAccessId,documentId:"doc-atmosphere",blockIds:[governedDecision.id,replacementBlock],sourceRightsConfirmed:true,sourceNonSensitiveConfirmed:true}));assert.equal(nextPlain.status,201,JSON.stringify(await nextPlain.clone().json()));const addedSourceVersion=await nextPlain.json();
  assert.equal((await request(`/api/workspaces/${organizationId}/context-packages/${plainDraft.packageId}/versions/${addedSourceVersion.versionId}/publish`,{method:"POST",headers:owner})).status,200);
  const sourceAdded=await request(`/api/workspaces/${organizationId}/context-packages/${plainDraft.packageId}/bindings/${plainBinding.bindingId}`,json(colleague,{action:"accept",versionId:addedSourceVersion.versionId},"PATCH"));assert.equal(sourceAdded.status,200,JSON.stringify(await sourceAdded.clone().json()));
  const addedEvents=await(await request("/api/events?after=0&limit=5000&content=1",{headers:targetScope})).json();
  const addedProjection=foldEvents(addedEvents.events,Number.POSITIVE_INFINITY,"doc-atmosphere","project-atmosphere");
  const addedSource=addedProjection.blocks.find((block)=>block.properties.organization_context_package_id===plainDraft.packageId&&block.type==="reference");assert.ok(addedSource);assert.equal(addedSource.properties.source_content_hash,replacement.contentHash);assert.equal((await request(addedSource.properties.media_url,{headers:targetScope})).status,200);
  const protectedDecision=addedProjection.blocks.find((block)=>block.properties.organization_context_package_id===plainDraft.packageId&&block.type!=="reference");assert.ok(protectedDecision);
  database.reset();const weaken=await request("/api/events",json(targetScope,{action:"append",event:{type:"BlockPropertyEdited",payload:{project_id:"project-atmosphere",document_id:"doc-atmosphere",block_id:protectedDecision.id,property_path:"text",old_value:protectedDecision.properties.text??null,new_value:"Weaken approved organization policy"}}}));assert.equal(weaken.status,403,JSON.stringify({body:await weaken.clone().json(),block:protectedDecision.id,destination,checks:database.calls.filter((call)=>call.sql.includes("member.target_block_id")),membership:database.sqlite.prepare("SELECT member.binding_id,member.target_block_id,binding.project_access_id,binding.organization_id,binding.status FROM project_context_package_members member JOIN project_context_package_bindings binding ON binding.binding_id=member.binding_id WHERE member.target_block_id=?").get(protectedDecision.id)}));assert.equal((await weaken.json()).error,"organization_context_package_decision_immutable");assert.equal(database.writeCount(),0,"approved organizational decisions cannot be weakened through ordinary author edits");
  database.reset();const personalBypass=await request("/api/events",json(colleague,{action:"append",event:{type:"BlockPropertyEdited",payload:{project_id:"project-atmosphere",document_id:"doc-atmosphere",block_id:protectedDecision.id,property_path:"text",old_value:protectedDecision.properties.text??null,new_value:"Personal-session governance bypass"}}}));assert.equal(personalBypass.status,403,JSON.stringify(await personalBypass.clone().json()));assert.equal((await personalBypass.json()).error,"organization_context_package_decision_immutable");assert.equal(database.writeCount(),0,"removing the shared-project cookie cannot weaken organization-governed decisions through the owner's personal stream");
  database.reset();const extractionBypass=await request("/api/events",json(colleague,{action:"extract_reference",documentId:"doc-atmosphere",blockId:addedSource.id,referenceId:addedSource.properties.reference_id,sample:{gridWidth:1,gridHeight:1,pixels:[255,255,255,255]}}));assert.equal(extractionBypass.status,403);assert.equal((await extractionBypass.json()).error,"organization_context_package_decision_immutable");assert.equal(database.writeCount(),0,"background extraction cannot mutate approved package source evidence from a personal session");

  const issued=await request("/api/shares",json(targetScope,{resourceKind:"document",documentId:"doc-atmosphere",projectId:"project-atmosphere"}));
  assert.equal(issued.status,200,JSON.stringify(await issued.clone().json()));
  const publicToken=(await issued.json()).share.token,publicPath=`/api/shared/${encodeURIComponent(publicToken)}`;
  assert.equal((await request(publicPath)).status,200,"an existing governed review link is usable while the original upstream license is valid");
  const mediaKey=decodeURIComponent(addedSource.properties.media_url.slice("/api/media/".length));
  const publicMedia=`${publicPath}/media/${encodeURIComponent(mediaKey)}`;
  const visibleMedia=await request(publicMedia);
  assert.equal(visibleMedia.status,200,JSON.stringify({key:mediaKey,status:visibleMedia.status}));

  const revoked=await request("/api/events",json(sourceScope,{action:"append",event:{type:"RightsAsserted",payload:{
    project_id:"project-atmosphere",document_id:"doc-atmosphere",reference_id:replacementReference,rights_class:"revoked",assertion_method:"license-withdrawn",
  }}}));
  assert.equal(revoked.status,200,JSON.stringify(await revoked.clone().json()));
  const countBefore=objects.size,bindingCount=database.sqlite.prepare("SELECT COUNT(*) AS count FROM project_context_package_bindings").get().count;
  const detail=await request(`/api/workspaces/${organizationId}/context-packages/${plainDraft.packageId}/versions/${addedSourceVersion.versionId}`,{headers:colleague});
  assert.equal(detail.status,404,"published immutable versions with subsequently revoked original rights cannot be loaded");
  const forbiddenAdoption=await request(`/api/workspaces/${organizationId}/context-packages/${plainDraft.packageId}/adopt`,json(colleague,{
    projectAccessId:destination,documentId:"doc-atmosphere",versionId:addedSourceVersion.versionId,updateMode:"pinned",
  }));
  assert.equal(forbiddenAdoption.status,404,JSON.stringify(await forbiddenAdoption.clone().json()));
  assert.equal(objects.size,countBefore,"revoked original rights never create a fresh unauthorized object copy");
  assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM project_context_package_bindings").get().count,bindingCount);
  assert.equal((await request(publicPath)).status,404,"previously issued public review links close immediately after upstream license withdrawal");
  assert.equal((await request(publicMedia)).status,404,"previously issued governed public media links close immediately after upstream license withdrawal");
  const replacementShare=await request("/api/shares",json(targetScope,{resourceKind:"document",documentId:"doc-atmosphere",projectId:"project-atmosphere"}));
  assert.equal(replacementShare.status,409);
  assert.equal((await replacementShare.json()).error,"context_source_rights_expired");

  environment.OPENAI_API_KEY="synthetic-revoked-license-never-dispatched";
  const originalFetch=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls+=1;throw new Error("a revoked upstream source can never reach a provider");};
  try{
    const previousEvents=database.sqlite.prepare("SELECT COUNT(*) AS count FROM events").get().count;
    const previousReservations=database.sqlite.prepare("SELECT COUNT(*) AS count FROM cost_budget_reservations").get().count;
    const previousJobs=database.sqlite.prepare("SELECT COUNT(*) AS count FROM document_jobs").get().count;
    const image={action:"generate",documentId:"doc-atmosphere",budgetAcknowledged:true};
    const queued={kind:"generate",documentId:"doc-atmosphere",payload:{budgetAcknowledged:true}};
    for(const [label,path,identity,payload] of [["personal owner direct generation","/api/events",colleague,image],
      ["personal owner queued generation","/api/document-jobs",colleague,queued],
      ["authorized project queued generation","/api/document-jobs",targetScope,queued]]){
      const denied=await request(path,json(identity,payload));
      assert.equal(denied.status,409,`${label}: ${JSON.stringify(await denied.clone().json())}`);
      assert.equal((await denied.json()).error,"context_source_rights_expired",label);
      assert.equal(calls,0,label);
      assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM events").get().count,previousEvents,`${label} records no generation event`);
      assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM cost_budget_reservations").get().count,previousReservations,`${label} creates no financial reservation`);
      assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM document_jobs").get().count,previousJobs,`${label} queues no chargeable work`);
    }
    assert.equal(calls,0,"copied owned-looking downstream receipts never authorize a later revoked original source");
  }finally{globalThis.fetch=originalFetch;delete environment.OPENAI_API_KEY;}
});

test("assigned reviewers receive exact revision-bound inbox tasks, scoped delivery, deterministic reminders, and immediate revocation",async()=>{
  const {database,environment,request,owner,organizationId,projectAccessId,projection,json,open}=await enterpriseWorkspaceFixture({artifact:true});
  const first=await specialistIdentity(database,request,"enterprise-reviewer-first");
  const second=await specialistIdentity(database,request,"enterprise-reviewer-second");
  const enroll=async(headers,userId)=>{
    const invited=await request(`/api/workspaces/${organizationId}/members`,json(owner,{email:`${userId}@example.test`,role:"member"}));assert.equal(invited.status,201);const invitation=await invited.json();
    assert.equal((await request(`/api/workspaces/${organizationId}/invitations/${invitation.invitationId}/accept`,{method:"POST",headers})).status,200);
    assert.equal((await request(`/api/workspaces/${organizationId}/projects/${projectAccessId}/members`,json(owner,{userId,role:"viewer"}))).status,201);
    const membership=database.sqlite.prepare("SELECT membership_id FROM project_memberships WHERE project_access_id=? AND user_id=?").get(projectAccessId,userId).membership_id;
    assert.equal((await request(`/api/workspaces/${organizationId}/projects/${projectAccessId}/members/${membership}`,json(owner,{reviewAccess:true},"PATCH"))).status,200);
    return membership;
  };
  const firstMembership=await enroll(first,"enterprise-reviewer-first");await enroll(second,"enterprise-reviewer-second");
  const ownerScope=await open(owner),firstScope=await open(first),secondScope=await open(second);
  const versions=projection.blocks.map((block)=>({block_id:block.id,version:block.sourceEvents.length}));
  const binding=()=>({artifact_revision:Number(database.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE stream_id='creative:enterprise-owner' AND type='DocumentArtifactEdited' AND json_extract(payload,'$.artifact_id')='enterprise-output'").get().count),content_sha256:createHash("sha256").update(database.sqlite.prepare("SELECT content FROM private_content WHERE content_id='enterprise-output-content'").get().content).digest("hex")});
  const event=(type,assigned)=>({type,payload:{artifact_id:"enterprise-output",document_id:"doc-atmosphere",source_block_versions:versions,...binding(),...(assigned?{assigned_reviewer_user_id:assigned}:{})}});
  const submit=await request("/api/events",json(ownerScope,{action:"append",event:event("ArtifactReviewRequested","enterprise-reviewer-first")}));assert.equal(submit.status,200,JSON.stringify(await submit.clone().json()));
  const inboxFirst=await(await request("/api/workspaces/reviews",{headers:first})).json();const inboxSecond=await(await request("/api/workspaces/reviews",{headers:second})).json();
  assert.equal(inboxFirst.tasks.length,1);assert.equal(inboxFirst.tasks[0].artifactId,"enterprise-output");assert.equal(inboxFirst.tasks[0].revision,0);assert.equal(inboxSecond.tasks.length,0,"another entitled reviewer does not inherit a designated task");
  const noticesFirst=await(await request("/api/project-notifications",{headers:firstScope})).json();const noticesSecond=await(await request("/api/project-notifications",{headers:secondScope})).json();
  assert.equal(noticesFirst.notifications.filter((notice)=>notice.kind==="review_requested").length,1);assert.equal(noticesSecond.notifications.filter((notice)=>notice.kind==="review_requested").length,0);
  database.reset();const wrong=await request("/api/events",json(secondScope,{action:"append",event:event("ArtifactApproved")}));assert.equal(wrong.status,403);assert.equal((await wrong.json()).error,"assigned_artifact_reviewer_required");assert.equal(database.writeCount(),0);
  const taskId=inboxFirst.tasks[0].id;database.sqlite.prepare("UPDATE project_review_tasks SET due_at=? WHERE task_id=?").run(new Date(Date.now()-60_000).toISOString(),taskId);
  await worker.scheduled({},environment);await worker.scheduled({},environment);
  assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM project_automation_outbox WHERE task_id=?").get(taskId).count,1,"replayed scheduler execution is idempotent");
  assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM project_notifications WHERE recipient_user_id=? AND kind='review_due'").get("enterprise-reviewer-first").count,1);
  assert.equal((await request(`/api/workspaces/${organizationId}/projects/${projectAccessId}/members/${firstMembership}`,json(owner,{reviewAccess:false},"PATCH"))).status,200);
  assert.equal((await(await request("/api/workspaces/reviews",{headers:first})).json()).tasks.length,0);
  assert.equal(database.sqlite.prepare("SELECT status FROM project_review_tasks WHERE task_id=?").get(taskId).status,"canceled");
  assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM project_notifications WHERE organization_id=? AND recipient_user_id=? AND kind IN('review_requested','review_due')").get(organizationId,"enterprise-reviewer-first").count,0);
  database.reset();const bypass=await request("/api/events",json(secondScope,{action:"append",event:event("ArtifactApproved")}));assert.equal(bypass.status,403);assert.equal(database.writeCount(),0,"revoking the assigned reviewer cannot silently delegate their exact approval to another reviewer");
  const reassigned=await request("/api/events",json(ownerScope,{action:"append",event:event("ArtifactReviewRequested","enterprise-reviewer-second")}));assert.equal(reassigned.status,200,JSON.stringify(await reassigned.clone().json()));
  assert.equal((await(await request("/api/workspaces/reviews",{headers:second})).json()).tasks.length,1);
  const approved=await request("/api/events",json(secondScope,{action:"append",event:event("ArtifactApproved")}));assert.equal(approved.status,200,JSON.stringify(await approved.clone().json()));
  assert.equal((await(await request("/api/workspaces/reviews",{headers:second})).json()).tasks.length,0,"an exact reviewer decision closes every sibling assignment");
});

test("tenant identity policy enforces honest domain/source restrictions, closes public links, and never claims verified federation",async()=>{
  const {database,request,owner,organizationId,projectAccessId,json,open}=await enterpriseWorkspaceFixture();
  const outsider=await specialistIdentity(database,request,"enterprise-security-outsider");
  const baseline=await(await request(`/api/workspaces/${organizationId}/security`,{headers:owner})).json();
  assert.equal(baseline.domainOwnershipVerified,false);assert.equal(baseline.enterpriseFederationVerified,false);assert.equal(baseline.mfaAttestationAvailable,false);assert.equal(baseline.encryption.externalCustomerManagedKeys,false);
  database.reset();assert.equal((await request(`/api/workspaces/${organizationId}/security`,{headers:outsider})).status,403);assert.equal(database.writeCount(),0);
  database.reset();assert.equal((await request(`/api/workspaces/${organizationId}/security`,json(owner,{allowedEmailDomains:["outside.test"]},"PATCH"))).status,409);assert.equal(database.writeCount(),0,"owner lockout is rejected before writes");
  database.reset();assert.equal((await request(`/api/workspaces/${organizationId}/security`,json(owner,{requireMfa:true},"PATCH"))).status,409);assert.equal(database.writeCount(),0,"unverified MFA cannot be enabled cosmetically");
  database.reset();assert.equal((await request(`/api/workspaces/${organizationId}/security`,json(owner,{encryptionMode:"customer-managed"},"PATCH"))).status,409);assert.equal(database.writeCount(),0,"unsupported customer-managed storage encryption fails closed");
  const selected=await open(owner);
  const saved=await request(`/api/workspaces/${organizationId}/security`,json(owner,{allowedEmailDomains:["example.test"],authenticationSource:"openai-workspace",maxSessionMinutes:120,expectedVersion:0},"PATCH"));
  assert.equal(saved.status,200,JSON.stringify(await saved.clone().json()));assert.match(saved.headers.get("set-cookie")??"",/Max-Age=0/);
  assert.equal((await request("/api/session",{headers:selected})).status,403,"old project context is invalidated immediately");
  const limited=await request(`/api/workspaces/${organizationId}/projects/${projectAccessId}/context`,{method:"POST",headers:owner});
  assert.equal(limited.status,200);assert.match(limited.headers.get("set-cookie")??"",/Max-Age=7200/,"new sessions and cookies honor the exact configured 120-minute policy");
  const protectedScope={...owner,cookie:limited.headers.get("set-cookie")?.split(";")[0]??""};
  database.reset();const publicBypass=await request("/api/shares",json(protectedScope,{resourceKind:"document",documentId:"doc-atmosphere",projectId:"project-atmosphere"}));assert.equal(publicBypass.status,403);assert.equal((await publicBypass.json()).error,"organization_identity_policy_disallows_public_sharing");assert.equal(database.writeCount(),0,"a restricted tenant cannot re-open an unauthenticated public perimeter");
  const forbidden={"oai-authenticated-user-id":"enterprise-owner","oai-authenticated-user-email":"enterprise-owner@outside.test"};database.reset();
  assert.equal((await request("/api/events?after=0&content=1",{headers:forbidden})).status,403);assert.equal(database.writeCount(),0,"identity mismatch cannot update stored identity or expose personally owned organizational history");
  database.reset();assert.equal((await request(`/api/workspaces/${organizationId}/members`,json(owner,{email:"person@outside.test"}))).status,403);assert.equal(database.writeCount(),0);
  const report=await(await request(`/api/workspaces/${organizationId}/assurance`,{headers:owner})).json();assert.equal(report.scheduler.hostingScheduleVerified,false);assert.equal(report.enterpriseReady,false);assert.ok(report.enterpriseBlockers.includes("enterprise-federation"));
  const exported=await(await request(`/api/workspaces/${organizationId}/assurance/export`,{headers:owner})).json();assert.equal(exported.organizationId,organizationId);assert.doesNotMatch(JSON.stringify(exported.audit),/token_hash|allowed_domains_json|private_json|content_markdown/);
  assert.throws(()=>database.sqlite.prepare("UPDATE organization_audit_events SET action='forged' WHERE organization_id=?").run(organizationId),/append-only/);
});

test("encrypted tenant recovery snapshots reject absent keys, tampering, wrong tenants, and preserve integrity across key rotation",async()=>{
  const {database,environment,request,owner,organizationId,json}=await enterpriseWorkspaceFixture({artifact:true});
  const create=()=>request(`/api/workspaces/${organizationId}/recovery`,json(owner,{action:"create",confirmation:"CREATE_ENCRYPTED_ORGANIZATION_RECOVERY_SNAPSHOT"}));
  database.reset();assert.equal((await create()).status,409);assert.equal(database.writeCount(),0,"no plaintext snapshot is emitted when the environment root is absent");
  environment.FORMA_ENCRYPTION_ROOT_KEY="invalid-nonempty-root";
  const invalidPosture=await(await request(`/api/workspaces/${organizationId}/security`,{headers:owner})).json();assert.equal(invalidPosture.encryption.recoverySnapshots,"not-configured","nonempty malformed key material never appears operational");
  database.reset();assert.equal((await create()).status,409);assert.equal(database.writeCount(),0,"invalid root material cannot create a key or optimistic recovery evidence");
  environment.FORMA_ENCRYPTION_ROOT_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const snapshot=await create();assert.equal(snapshot.status,201,JSON.stringify(await snapshot.clone().json()));const saved=await snapshot.json();
  const stored=database.sqlite.prepare("SELECT encrypted_payload,manifest_json,key_id FROM organization_recovery_snapshots WHERE snapshot_id=?").get(saved.snapshotId);
  assert.throws(()=>database.sqlite.prepare("INSERT INTO organization_key_versions(key_id,organization_id,version,algorithm,wrapped_key,status,created_at,retired_at) VALUES(?,?,999,'AES-GCM-256','forged','active',?,NULL)")
    .run("forged-second-active-key",organizationId,new Date().toISOString()),/UNIQUE/,"database uniqueness prevents simultaneous active organization encryption keys");
  assert.doesNotMatch(stored.encrypted_payload,/Customer-ready narrative|Enterprise output|private_json/);
  assert.doesNotMatch(database.sqlite.prepare("SELECT wrapped_key FROM organization_key_versions WHERE key_id=?").get(stored.key_id).wrapped_key,/0123456789abcdef/);
  const verify=()=>request(`/api/workspaces/${organizationId}/recovery`,json(owner,{action:"drill",snapshotId:saved.snapshotId,confirmation:"VERIFY_ENCRYPTED_ORGANIZATION_RECOVERY_SNAPSHOT"}));
  const first=await verify();assert.equal(first.status,200,JSON.stringify(await first.clone().json()));assert.equal((await first.json()).isolatedRestorePerformed,false,"a verification drill is never misrepresented as a restored production tenant");
  database.reset();const unconfirmed=await request(`/api/workspaces/${organizationId}/recovery`,json(owner,{action:"restore",snapshotId:saved.snapshotId}));assert.equal(unconfirmed.status,400);assert.equal(database.writeCount(),0,"an isolated staging exercise requires deliberate exact-tenant confirmation");
  const beforeEvents=database.sqlite.prepare("SELECT COUNT(*) AS count FROM events").get().count,beforeContent=database.sqlite.prepare("SELECT COUNT(*) AS count FROM private_content").get().count;
  const restore=()=>request(`/api/workspaces/${organizationId}/recovery`,json(owner,{action:"restore",snapshotId:saved.snapshotId,organizationId,confirmation:"RESTORE_ORGANIZATION_SNAPSHOT_TO_ISOLATED_ROLLBACK_STAGE"}));
  const staged=await restore();assert.equal(staged.status,200,JSON.stringify(await staged.clone().json()));const exercised=await staged.json();
  assert.equal(exercised.status,"isolated-rollback-verified");assert.equal(exercised.isolatedRestorePerformed,false);assert.equal(exercised.isolatedRollbackRestorePerformed,true);assert.equal(exercised.rollbackVerified,true);assert.equal(exercised.productionTenantMutated,false);assert.equal(exercised.objectStorageRestorePerformed,false);
  assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM events").get().count,beforeEvents+1,"the only committed history is the truthful isolated-drill audit receipt");
  assert.equal(database.sqlite.prepare("SELECT type FROM events ORDER BY rowid DESC LIMIT 1").get().type,"OrganizationRecoveryIsolatedRollbackRestoreVerified");
  assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM private_content").get().count,beforeContent);
  assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE name IN('forma_recovery_rollback_stage','forma_recovery_rollback_guard','forma_recovery_rollback_trigger')").get().count,0,"all staged recovery records and schema disappear in the same automatic rollback");
  assert.ok(database.sqlite.prepare("SELECT 1 FROM organization_audit_events WHERE organization_id=? AND action='OrganizationRecoveryIsolatedRollbackRestoreVerified'").get(organizationId));
  const posture=await(await request(`/api/workspaces/${organizationId}/assurance`,{headers:owner})).json();assert.equal(posture.recovery.isolatedRollbackRestoreVerified,true);assert.equal(posture.recovery.isolatedRestoreVerified,false);assert.equal(posture.recovery.productionTenantRestoreAvailable,false);
  const originalManifest=stored.manifest_json;database.sqlite.prepare("UPDATE organization_recovery_snapshots SET manifest_json=? WHERE snapshot_id=?").run(JSON.stringify({schema:1,organizationId,projectCount:0,counts:{},media:[]}),saved.snapshotId);
  database.reset();assert.equal((await verify()).status,409);assert.equal(database.writeCount(),0,"unauthenticated manifest substitutions cannot produce a successful recovery drill");
  database.reset();assert.equal((await restore()).status,409);assert.equal(database.writeCount(),0,"tampered recovery evidence cannot produce a misleading isolated rollback receipt");
  database.sqlite.prepare("UPDATE organization_recovery_snapshots SET manifest_json=? WHERE snapshot_id=?").run(originalManifest,saved.snapshotId);
  const rotated=await request(`/api/workspaces/${organizationId}/security/keys/rotate`,{method:"POST",headers:owner});assert.equal(rotated.status,200);assert.equal((await verify()).status,200,"retired wrapped keys still decrypt authorized older snapshots");
  const envelope=JSON.parse(stored.encrypted_payload);envelope.ciphertext=envelope.ciphertext.slice(0,-4)+"AAAA";database.sqlite.prepare("UPDATE organization_recovery_snapshots SET encrypted_payload=? WHERE snapshot_id=?").run(JSON.stringify(envelope),saved.snapshotId);
  database.reset();const tampered=await verify();assert.equal(tampered.status,409);assert.equal(database.writeCount(),0,"integrity failure creates no misleading successful restore receipt");
  database.reset();assert.equal((await restore()).status,409);assert.equal(database.writeCount(),0,"tampered ciphertext cannot enter rollback staging or create a success receipt");
});

test("versioned encryption roots preserve historical recovery and refuse rotations that would strand existing snapshots",async()=>{
  const {database,environment,request,owner,organizationId,json}=await enterpriseWorkspaceFixture({artifact:true});
  const previous="0123456789abcdef".repeat(4),current="fedcba9876543210".repeat(4);
  environment.FORMA_ENCRYPTION_ROOT_KEY=previous;
  const create=()=>request(`/api/workspaces/${organizationId}/recovery`,json(owner,{action:"create",confirmation:"CREATE_ENCRYPTED_ORGANIZATION_RECOVERY_SNAPSHOT"}));
  const drill=(snapshotId)=>request(`/api/workspaces/${organizationId}/recovery`,json(owner,{action:"drill",snapshotId,confirmation:"VERIFY_ENCRYPTED_ORGANIZATION_RECOVERY_SNAPSHOT"}));
  const first=await create();assert.equal(first.status,201);const legacy=await first.json();
  environment.FORMA_ENCRYPTION_ROOT_KEYS=JSON.stringify({current});environment.FORMA_ENCRYPTION_ROOT_KEY_VERSION="current";
  assert.equal((await drill(legacy.snapshotId)).status,200,"the still-configured legacy root remains usable during keyring migration");
  assert.equal((await request(`/api/workspaces/${organizationId}/security/keys/rotate`,{method:"POST",headers:owner})).status,200);
  const created=await create();assert.equal(created.status,201);const fresh=await created.json();
  const wrappers=database.sqlite.prepare("SELECT key_id,wrapped_key FROM organization_key_versions WHERE organization_id=?").all(organizationId);
  assert.equal(JSON.parse(wrappers.find((entry)=>entry.key_id===legacy.keyId).wrapped_key).wrapping_root_version,undefined);
  assert.equal(JSON.parse(wrappers.find((entry)=>entry.key_id===fresh.keyId).wrapped_key).wrapping_root_version,"current");
  assert.doesNotMatch(JSON.stringify(wrappers),new RegExp(`${previous}|${current}`));
  assert.equal((await drill(fresh.snapshotId)).status,200);
  delete environment.FORMA_ENCRYPTION_ROOT_KEY;
  database.reset();assert.equal((await drill(legacy.snapshotId)).status,409);assert.equal(database.writeCount(),0);
  assert.equal((await drill(fresh.snapshotId)).status,200);
  database.reset();const unsafe=await request(`/api/workspaces/${organizationId}/security/keys/rotate`,{method:"POST",headers:owner});assert.equal(unsafe.status,409);assert.equal(database.writeCount(),0,"key rotation cannot retire the active tenant key while historical snapshots are undecryptable");
  environment.FORMA_ENCRYPTION_ROOT_KEYS="{";environment.FORMA_ENCRYPTION_ROOT_KEY=previous;
  database.reset();assert.equal((await create()).status,409);assert.equal(database.writeCount(),0,"a malformed versioned keyring never falls back to a legacy root");
});

test("historical organization recovery exercises remain usable after a valid owner succession",async()=>{
  const {database,environment,request}=await productionWorker();
  const former=await specialistIdentity(database,request,"recovery-former-owner"),successor=await specialistIdentity(database,request,"recovery-successor");
  const json=(headers,body)=>({method:"POST",headers:{...headers,"content-type":"application/json"},body:JSON.stringify(body)});
  const established=await request("/api/workspaces",json(former,{name:"Owner succession recovery"}));assert.equal(established.status,201);const organizationId=(await established.json()).organizationId;
  const invited=await request(`/api/workspaces/${organizationId}/members`,json(former,{email:"recovery-successor@example.test",role:"administrator"}));assert.equal(invited.status,201);const invitation=await invited.json();
  const accepted=await request(`/api/workspaces/${organizationId}/invitations/${invitation.invitationId}/accept`,json(successor,{token:new URL(invitation.invitationUrl).searchParams.get("token")}));assert.equal(accepted.status,200,JSON.stringify(await accepted.clone().json()));
  environment.FORMA_ENCRYPTION_ROOT_KEY="0123456789abcdef".repeat(4);
  const created=await request(`/api/workspaces/${organizationId}/recovery`,json(former,{action:"create",confirmation:"CREATE_ENCRYPTED_ORGANIZATION_RECOVERY_SNAPSHOT"}));assert.equal(created.status,201,JSON.stringify(await created.clone().json()));const snapshot=await created.json();
  const transferred=await request(`/api/workspaces/${organizationId}/ownership`,json(former,{targetUserId:"recovery-successor",confirmation:"TRANSFER_ORGANIZATION_OWNERSHIP"}));assert.equal(transferred.status,200,JSON.stringify(await transferred.clone().json()));
  const body={action:"restore",snapshotId:snapshot.snapshotId,organizationId,confirmation:"RESTORE_ORGANIZATION_SNAPSHOT_TO_ISOLATED_ROLLBACK_STAGE"};
  database.reset();assert.equal((await request(`/api/workspaces/${organizationId}/recovery`,json(former,body))).status,403);assert.equal(database.writeCount(),0,"a former owner cannot recover organization evidence after custody transfers");
  const recovered=await request(`/api/workspaces/${organizationId}/recovery`,json(successor,body));assert.equal(recovered.status,200,JSON.stringify(await recovered.clone().json()));assert.equal((await recovered.json()).isolatedRollbackRestorePerformed,true,"the current owner may verify an authentic snapshot created under a valid earlier owner");
});

test("large encrypted tenant recovery snapshots preserve held expired evidence, detect object tampering, and erase every scoped recovery object",async()=>{
  const {database,environment,request,owner,organizationId,projectAccessId,json}=await enterpriseWorkspaceFixture({artifact:true});
  environment.FORMA_ENCRYPTION_ROOT_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const objects=new Map();
  environment.MEDIA={
    async put(key,value,options={}){const bytes=value instanceof ArrayBuffer?new Uint8Array(value):new Uint8Array(await new Response(value).arrayBuffer());objects.set(key,{bytes,metadata:{...options.customMetadata},contentType:options.httpMetadata?.contentType??"application/octet-stream"});},
    async get(key){const item=objects.get(key);return item?{body:new Blob([item.bytes]).stream(),size:item.bytes.byteLength,customMetadata:item.metadata,writeHttpMetadata(headers){headers.set("content-type",item.contentType);}}:null;},
    async head(key){const item=objects.get(key);return item?{size:item.bytes.byteLength,customMetadata:item.metadata}:null;},
    async delete(key){objects.delete(key);},
  };
  const bytes=new Uint8Array(1_250_000).fill(65),contentHash=createHash("sha256").update(bytes).digest("hex");
  const mediaKey="u-656e74657270726973652d6f776e6572/uploads/recoverable-source.pdf";
  await environment.MEDIA.put(mediaKey,bytes.buffer,{httpMetadata:{contentType:"application/pdf"},customMetadata:{ownerId:"enterprise-owner",organizationId,sha256:contentHash}});
  const now=new Date().toISOString(),expired=new Date(Date.now()-60_000).toISOString();
  database.sqlite.prepare("INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,visibility,source_event_id,actor_user_id,created_at) VALUES(?,'media',?,?,?,'enterprise-owner','collaborative_output',NULL,'enterprise-owner',?)")
    .run(projectAccessId,mediaKey,organizationId,"project-atmosphere",now);
  database.sqlite.prepare("UPDATE private_content SET expires_at=? WHERE content_id='enterprise-output-content'").run(expired);
  database.sqlite.prepare("INSERT INTO private_content_retention_scopes(content_id,organization_id,project_access_id,project_id,actor_user_id,classification,policy_version,assigned_expires_at,created_at) VALUES('enterprise-output-content',?,?,?,'enterprise-owner','governed-evidence',0,?,?)")
    .run(organizationId,projectAccessId,"project-atmosphere",expired,now);
  const revisionContent=JSON.stringify({markdown:"Legally held output",items:[]});
  database.sqlite.prepare("INSERT INTO artifact_revisions(revision_id,owner_id,organization_id,project_access_id,project_id,document_id,artifact_id,revision,content_json,content_sha256,created_by_user_id,created_at,expires_at,redacted_at) VALUES(?,'enterprise-owner',?,?,?,'doc-atmosphere','enterprise-output',0,?,?,'enterprise-owner',?,?,NULL)")
    .run("held-output-revision",organizationId,projectAccessId,"project-atmosphere",revisionContent,createHash("sha256").update(revisionContent).digest("hex"),now,expired);
  const heldArtifact=await request(`/api/workspaces/${organizationId}/holds`,json(owner,{scope:"artifact",resourceId:"enterprise-output",reason:"Preserve finished-output revision"}));assert.equal(heldArtifact.status,201,JSON.stringify(await heldArtifact.clone().json()));const artifactHold=(await heldArtifact.json()).holdId;
  const create=await request(`/api/workspaces/${organizationId}/recovery`,json(owner,{action:"create",confirmation:"CREATE_ENCRYPTED_ORGANIZATION_RECOVERY_SNAPSHOT"}));assert.equal(create.status,201,JSON.stringify(await create.clone().json()));const snapshot=await create.json();
  assert.equal(snapshot.snapshotStorage,"tenant-encrypted-object");assert.equal(snapshot.manifest.counts.content,1,"expired customer output protected by a legal hold remains recoverable");assert.equal(snapshot.manifest.counts.revisions,1,"expired held output revisions remain recoverable");assert.equal(snapshot.manifest.counts.retentionScopes,1);
  const pointer=JSON.parse(database.sqlite.prepare("SELECT encrypted_payload FROM organization_recovery_snapshots WHERE snapshot_id=?").get(snapshot.snapshotId).encrypted_payload);
  assert.equal(pointer.storage,"organization-r2");assert.ok(pointer.objectKey.startsWith(`organization-recovery/${organizationId}/`));assert.ok(objects.has(pointer.objectKey));assert.doesNotMatch(new TextDecoder().decode(objects.get(pointer.objectKey).bytes),/Customer-ready narrative|Legally held output/);
  const drill=()=>request(`/api/workspaces/${organizationId}/recovery`,json(owner,{action:"drill",snapshotId:snapshot.snapshotId,confirmation:"VERIFY_ENCRYPTED_ORGANIZATION_RECOVERY_SNAPSHOT"}));
  const pristine=objects.get(pointer.objectKey).bytes.slice();objects.get(pointer.objectKey).bytes[30]^=1;database.reset();assert.equal((await drill()).status,409);assert.equal(database.writeCount(),0,"tampered encrypted object storage cannot create a misleading recovery receipt");objects.get(pointer.objectKey).bytes=pristine;assert.equal((await drill()).status,200);
  const restored=await request(`/api/workspaces/${organizationId}/recovery`,json(owner,{action:"restore",snapshotId:snapshot.snapshotId,organizationId,confirmation:"RESTORE_ORGANIZATION_SNAPSHOT_TO_ISOLATED_ROLLBACK_STAGE"}));assert.equal(restored.status,200,JSON.stringify(await restored.clone().json()));assert.equal((await restored.json()).isolatedRollbackRestorePerformed,true);
  assert.equal((await request(`/api/workspaces/${organizationId}/holds/${artifactHold}`,{method:"DELETE",headers:owner})).status,200);
  const migrated=await request(`/api/workspaces/${organizationId}/recovery`,json(owner,{action:"migrate-privacy",organizationId,confirmation:"MIGRATE_ORGANIZATION_HISTORICAL_EVENT_CONTENT"}));assert.equal(migrated.status,200,JSON.stringify(await migrated.clone().json()));
  const erased=await request(`/api/workspaces/${organizationId}/deletion`,json(owner,{organizationId,confirmation:"DELETE_ORGANIZATION_AND_SCOPED_DATA"}));assert.equal(erased.status,200,JSON.stringify(await erased.clone().json()));assert.equal(objects.has(pointer.objectKey),false,"organization erasure includes encrypted large-recovery objects");assert.equal(objects.has(mediaKey),false);
});

test("ambiguous encrypted-object writes remain tracked and support owner-only verified cleanup without an encryption root",async()=>{
  const {database,environment,request,owner,organizationId,projectAccessId,json}=await enterpriseWorkspaceFixture({artifact:true});
  environment.FORMA_ENCRYPTION_ROOT_KEY="0123456789abcdef".repeat(4);
  const objects=new Map();let rejectRecoveryWrite=true,rejectDeletion=true;
  environment.MEDIA={
    async put(key,value,options={}){const bytes=value instanceof ArrayBuffer?new Uint8Array(value):new Uint8Array(await new Response(value).arrayBuffer());objects.set(key,{bytes,metadata:{...options.customMetadata},contentType:options.httpMetadata?.contentType??"application/octet-stream"});if(key.startsWith("organization-recovery/")&&rejectRecoveryWrite)throw new Error("ambiguous object write");},
    async get(key){const object=objects.get(key);return object?{body:new Blob([object.bytes]).stream(),size:object.bytes.byteLength,customMetadata:object.metadata,writeHttpMetadata(headers){headers.set("content-type",object.contentType);}}:null;},
    async head(key){const object=objects.get(key);return object?{size:object.bytes.byteLength,customMetadata:object.metadata}:null;},
    async delete(key){if(rejectDeletion)throw new Error("temporary object storage failure");objects.delete(key);},
  };
  const bytes=new Uint8Array(1_250_000).fill(65),digest=createHash("sha256").update(bytes).digest("hex"),mediaKey="u-656e74657270726973652d6f776e6572/uploads/cleanup-source.pdf",now=new Date().toISOString();
  await environment.MEDIA.put(mediaKey,bytes.buffer,{httpMetadata:{contentType:"application/pdf"},customMetadata:{ownerId:"enterprise-owner",organizationId,sha256:digest}});
  database.sqlite.prepare("INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,visibility,source_event_id,actor_user_id,created_at) VALUES(?,'media',?,?,?,'enterprise-owner','collaborative_output',NULL,'enterprise-owner',?)")
    .run(projectAccessId,mediaKey,organizationId,"project-atmosphere",now);
  const failed=await request(`/api/workspaces/${organizationId}/recovery`,json(owner,{action:"create",confirmation:"CREATE_ENCRYPTED_ORGANIZATION_RECOVERY_SNAPSHOT"}));assert.equal(failed.status,503,JSON.stringify(await failed.clone().json()));const pending=await failed.json();
  assert.equal(pending.error,"organization_recovery_object_cleanup_pending");assert.equal(pending.retryable,true);
  const tracked=database.sqlite.prepare("SELECT status,encrypted_payload,key_id FROM organization_recovery_snapshots WHERE snapshot_id=?").get(pending.snapshotId);assert.equal(tracked.status,"cleanup-pending");
  const pointer=JSON.parse(tracked.encrypted_payload);assert.ok(objects.has(pointer.objectKey),"an ambiguously uploaded encrypted object always retains a durable tenant-scoped cleanup pointer");
  delete environment.FORMA_ENCRYPTION_ROOT_KEY;
  const cleanup=(overrides={})=>request(`/api/workspaces/${organizationId}/recovery`,json(owner,{action:"cleanup",snapshotId:pending.snapshotId,organizationId,confirmation:"RETRY_ORGANIZATION_RECOVERY_OBJECT_CLEANUP",...overrides}));
  database.reset();assert.equal((await cleanup({confirmation:"wrong"})).status,400);assert.equal(database.writeCount(),0);
  database.reset();assert.equal((await cleanup({organizationId:"foreign-tenant"})).status,400);assert.equal(database.writeCount(),0);
  const legitimate=objects.get(pointer.objectKey).metadata;objects.get(pointer.objectKey).metadata={...legitimate,organizationId:"foreign-tenant"};
  database.reset();assert.equal((await cleanup()).status,409);assert.equal(database.writeCount(),0,"foreign object metadata cannot be erased through a legitimate recovery pointer");objects.get(pointer.objectKey).metadata=legitimate;
  database.reset();const retry=await cleanup();assert.equal(retry.status,503);assert.equal(database.writeCount(),0);assert.equal(database.sqlite.prepare("SELECT status FROM organization_recovery_snapshots WHERE snapshot_id=?").get(pending.snapshotId).status,"cleanup-pending");
  database.sqlite.prepare("UPDATE organization_recovery_snapshots SET status='staging' WHERE snapshot_id=?").run(pending.snapshotId);
  database.reset();assert.equal((await cleanup()).status,404);assert.equal(database.writeCount(),0,"an active object upload cannot be unsafely fenced or orphaned by manual cleanup");
  database.sqlite.prepare("UPDATE organization_recovery_snapshots SET status='cleanup-pending' WHERE snapshot_id=?").run(pending.snapshotId);
  rejectRecoveryWrite=false;rejectDeletion=false;
  const removed=await cleanup();assert.equal(removed.status,200,JSON.stringify(await removed.clone().json()));assert.equal((await removed.json()).objectDeletionVerified,true);
  assert.equal(objects.has(pointer.objectKey),false);assert.equal(database.sqlite.prepare("SELECT 1 FROM organization_recovery_snapshots WHERE snapshot_id=?").get(pending.snapshotId),undefined);
  assert.ok(database.sqlite.prepare("SELECT 1 FROM organization_audit_events WHERE organization_id=? AND action='OrganizationRecoveryObjectCleanupCompleted'").get(organizationId));
  const migrated=await request(`/api/workspaces/${organizationId}/recovery`,json(owner,{action:"migrate-privacy",organizationId,confirmation:"MIGRATE_ORGANIZATION_HISTORICAL_EVENT_CONTENT"}));assert.equal(migrated.status,200);
  const erased=await request(`/api/workspaces/${organizationId}/deletion`,json(owner,{organizationId,confirmation:"DELETE_ORGANIZATION_AND_SCOPED_DATA"}));assert.equal(erased.status,200,JSON.stringify(await erased.clone().json()));assert.equal(objects.size,0);
});

test("failed organization deletion remains isolated, owner-inspectable, and safely resumable",async()=>{
  const {database,environment,request,owner,organizationId,projectAccessId,json}=await enterpriseWorkspaceFixture({artifact:true});
  const objectKey="u-656e74657270726973652d6f776e6572/uploads/deletion-retry.pdf",now=new Date().toISOString();let exists=true,unavailable=true;
  environment.MEDIA={async head(key){return exists&&key===objectKey?{customMetadata:{ownerId:"enterprise-owner",organizationId}}:null;},async delete(key){if(unavailable)throw new Error("temporary storage failure");if(key===objectKey)exists=false;}};
  database.sqlite.prepare("INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,visibility,source_event_id,actor_user_id,created_at) VALUES(?,'media',?,?,?,'enterprise-owner','collaborative_output',NULL,'enterprise-owner',?)")
    .run(projectAccessId,objectKey,organizationId,"project-atmosphere",now);
  const migration=await request(`/api/workspaces/${organizationId}/recovery`,json(owner,{action:"migrate-privacy",organizationId,confirmation:"MIGRATE_ORGANIZATION_HISTORICAL_EVENT_CONTENT"}));assert.equal(migration.status,200);
  const remove=()=>request(`/api/workspaces/${organizationId}/deletion`,json(owner,{organizationId,confirmation:"DELETE_ORGANIZATION_AND_SCOPED_DATA"}));
  const interrupted=await remove();assert.equal(interrupted.status,503,JSON.stringify(await interrupted.clone().json()));assert.equal((await interrupted.json()).status,"partial");
  database.reset();assert.equal((await request(`/api/workspaces/${organizationId}`,{headers:owner})).status,409);assert.equal(database.writeCount(),0,"ordinary workspace capabilities remain frozen during a partial irreversible deletion");
  const status=await request(`/api/workspaces/${organizationId}/deletion`,{headers:owner});assert.equal(status.status,200);assert.equal((await status.json()).job.status,"partial","the exact owner retains a narrow, read-only recovery route");
  const source=await readFile(new URL("../src/components/forma-workspace-settings.ts",import.meta.url),"utf8");
  assert.match(source,/const deletion=await this\.#request[^\n]*\/deletion/);assert.match(source,/#deletionRecoveryControls\(\)/);assert.match(source,/if\(organizationId&&this\.#deletionJob&&\["pending","partial","processing"\]\.includes/);
  assert.match(source,/retryable:body\.retryable===true\|\|body\.status==="partial"/);assert.match(source,/\.retryable\)await this\.#load\(\)/,"a retryable initial failure immediately discovers its exact recovery action without requiring manual navigation");
  unavailable=false;const completed=await remove();assert.equal(completed.status,200,JSON.stringify(await completed.clone().json()));assert.equal(exists,false);assert.equal((await completed.json()).status,"completed");
});

test("scoped content legal holds protect expired evidence from ordinary request-triggered cleanup",async()=>{
  const {database,environment,request,owner,organizationId,projectAccessId,json}=await enterpriseWorkspaceFixture();
  const now=new Date().toISOString(),expired=new Date(Date.now()-120_000).toISOString(),contentId="held-request-cleanup-content";
  database.sqlite.prepare("INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at) VALUES(?,?,?,?,?,?,NULL)")
    .run(contentId,"enterprise-owner","chat-user","Legally protected customer evidence",now,expired);
  database.sqlite.prepare("INSERT INTO private_content_retention_scopes(content_id,organization_id,project_access_id,project_id,actor_user_id,classification,policy_version,assigned_expires_at,created_at) VALUES(?,?,?,?,?,'governed-evidence',0,?,?)")
    .run(contentId,organizationId,projectAccessId,"project-atmosphere","enterprise-owner",expired,now);
  const held=await request(`/api/workspaces/${organizationId}/holds`,json(owner,{scope:"content",resourceId:contentId,reason:"Preserve exact evidence during review"}));assert.equal(held.status,201,JSON.stringify(await held.clone().json()));
  environment.FORMA_ENCRYPTION_ROOT_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  database.reset();const withheld=await request(`/api/workspaces/${organizationId}/recovery`,json(owner,{action:"create",confirmation:"CREATE_ENCRYPTED_ORGANIZATION_RECOVERY_SNAPSHOT"}));assert.equal(withheld.status,409);assert.equal((await withheld.json()).error,"organization_recovery_private_held_evidence_unavailable");assert.equal(database.writeCount(),0,"held actor-private conversations are never exposed to an organization owner or silently omitted from a successful backup");
  const scope={organizationId,projectAccessId,projectId:"project-atmosphere",ownerUserId:"enterprise-owner",actorUserId:"enterprise-owner"};
  await storePrivateContent(environment,"enterprise-owner","chat-user","New ordinary project conversation",scope);
  const preserved=database.sqlite.prepare("SELECT content,redacted_at FROM private_content WHERE content_id=?").get(contentId);assert.equal(preserved.content,"Legally protected customer evidence");assert.equal(preserved.redacted_at,null,"opportunistic per-request cleanup honors the same scoped hold enforced by scheduled cleanup");
  database.reset();const foreign=await request(`/api/workspaces/${organizationId}/holds`,json(owner,{scope:"artifact",resourceId:"missing-foreign-artifact",reason:"Misleading scope"}));assert.equal(foreign.status,403);assert.equal(database.writeCount(),0,"nonexistent resources cannot produce reassuring but ineffective legal holds");
});

test("legally held expired artifact revisions remain inspectable and restore durable finished work",async()=>{
  const {database,request,owner,organizationId,json,open}=await enterpriseWorkspaceFixture({artifact:true});
  const scoped=await open(owner);
  const changed=await request("/api/artifacts/enterprise-output",json(scoped,{markdown:"# Corrected enterprise output\n\nA revised customer-ready narrative.",expectedRevision:0},"PATCH"));assert.equal(changed.status,200,JSON.stringify(await changed.clone().json()));
  const protectedArtifact=await request(`/api/workspaces/${organizationId}/holds`,json(owner,{scope:"artifact",resourceId:"enterprise-output",reason:"Preserve customer deliverable history"}));assert.equal(protectedArtifact.status,201);const hold=(await protectedArtifact.json()).holdId;
  const expired=new Date(Date.now()-120_000).toISOString();
  database.sqlite.prepare("UPDATE private_content SET expires_at=? WHERE content_id='enterprise-output-content'").run(expired);
  database.sqlite.prepare("UPDATE artifact_revisions SET expires_at=? WHERE organization_id=? AND artifact_id='enterprise-output' AND revision=0").run(expired,organizationId);
  const revisions=await request("/api/artifacts/enterprise-output/revisions",{headers:scoped});assert.equal(revisions.status,200,JSON.stringify(await revisions.clone().json()));assert.equal((await revisions.json()).revisions.find((entry)=>entry.revision===0).available,true);
  const earlier=await request("/api/artifacts/enterprise-output/revisions/0",{headers:scoped});assert.equal(earlier.status,200);assert.match((await earlier.json()).content.markdown,/Customer-ready narrative/);
  const restored=await request("/api/artifacts/enterprise-output/revisions/0/restore",json(scoped,{expectedRevision:1}));assert.equal(restored.status,200,JSON.stringify(await restored.clone().json()));assert.equal((await restored.json()).revision,2);
  const current=database.sqlite.prepare("SELECT content,expires_at FROM private_content WHERE content_id='enterprise-output-content'").get();assert.match(current.content,/Customer-ready narrative/);assert.equal(current.expires_at,"9999-12-31T23:59:59.999Z","an explicitly restored customer deliverable regains prospective durable-work retention");
  assert.equal((await request(`/api/workspaces/${organizationId}/holds/${hold}`,{method:"DELETE",headers:owner})).status,200);
  database.reset();const released=await request("/api/artifacts/enterprise-output/revisions/0",{headers:scoped});assert.equal(released.status,404,"expired historical evidence becomes unavailable immediately after its hold is released");
  const expiredHistory=database.sqlite.prepare("SELECT expires_at FROM artifact_revisions WHERE artifact_id='enterprise-output' AND revision=0").get();assert.equal(expiredHistory.expires_at,expired,"releasing the legal hold never silently extends an expired historical revision");
});

test("tenant deletion and first-time retention holds remain mutually exclusive at the database boundary",async()=>{
  const {database,organizationId}=await enterpriseWorkspaceFixture();
  const now=new Date().toISOString();
  database.sqlite.prepare("INSERT INTO organization_deletion_jobs(job_id,organization_id,initiated_by_user_id,status,inventory_json,receipt_json,created_at,updated_at,completed_at) VALUES(? ,?,'enterprise-owner','processing','{}',NULL,?,?,NULL)")
    .run("hold-insert-guard",organizationId,now,now);
  assert.throws(()=>database.sqlite.prepare("INSERT INTO organization_retention_policies(organization_id,transient_days,evidence_days,revision_days,legal_hold,version,updated_by_user_id,updated_at) VALUES(?,30,365,365,1,1,'enterprise-owner',?)")
    .run(organizationId,now),/organization_deletion_in_progress/,"creating the first retention policy cannot bypass the active-deletion legal-hold lease");
});

test("scoped legal holds block tenant erasure and completed deletion preserves unrelated organizations and truthful receipts",async()=>{
  const {database,environment,request,owner,organizationId,projectAccessId,json}=await enterpriseWorkspaceFixture({artifact:true});
  const stranger=await specialistIdentity(database,request,"enterprise-other-owner");
  assert.equal((await request("/api/events?after=0&content=0",{headers:stranger})).status,200);
  const another=await request("/api/workspaces",json(stranger,{name:"Unaffected organization"}));assert.equal(another.status,201);const anotherId=(await another.json()).organizationId;
  const media=new Map();environment.MEDIA={async get(key){const value=media.get(key);return value?{body:new Response(value.bytes).body,httpEtag:"x",customMetadata:value.metadata,writeHttpMetadata(headers){headers.set("content-type","image/png");}}:null;},async head(key){const value=media.get(key);return value?{customMetadata:value.metadata}:null;},async delete(key){media.delete(key);}};
  const key="u-656e74657270726973652d6f776e6572/generated/enterprise.png";media.set(key,{bytes:new Uint8Array([1,2,3]),metadata:{ownerId:"enterprise-owner"}});
  database.sqlite.prepare("INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,visibility,source_event_id,actor_user_id,created_at) VALUES(?,'media',?,?,?,'enterprise-owner','collaborative_output',NULL,'enterprise-owner',?)")
    .run(projectAccessId,key,organizationId,"project-atmosphere",new Date().toISOString());
  const hold=await request(`/api/workspaces/${organizationId}/holds`,json(owner,{scope:"project",resourceId:projectAccessId,reason:"Preserve exact customer evidence"}));assert.equal(hold.status,201);const holdId=(await hold.json()).holdId;
  const erase=()=>request(`/api/workspaces/${organizationId}/deletion`,json(owner,{confirmation:"DELETE_ORGANIZATION_AND_SCOPED_DATA",organizationId}));
  database.reset();assert.equal((await erase()).status,409);assert.equal(database.writeCount(),0);assert.equal(media.has(key),true);
  assert.equal((await request(`/api/workspaces/${organizationId}/holds/${holdId}`,{method:"DELETE",headers:owner})).status,200);
  database.reset();const legacy=await erase();assert.equal(legacy.status,409);assert.equal((await legacy.json()).error,"historical_privacy_migration_required");assert.equal(database.writeCount(),0,"tenant deletion never strands plaintext legacy customer prose in immutable event history");
  const unrelatedBefore=database.sqlite.prepare("SELECT payload FROM events WHERE stream_id=? ORDER BY sequence LIMIT 1").get("creative:enterprise-other-owner")?.payload;
  const migrated=await request(`/api/workspaces/${organizationId}/recovery`,json(owner,{action:"migrate-privacy",organizationId,confirmation:"MIGRATE_ORGANIZATION_HISTORICAL_EVENT_CONTENT"}));assert.equal(migrated.status,200,JSON.stringify(await migrated.clone().json()));assert.ok((await migrated.json()).migratedEvents>0,"the tenant owner can safely prepare their own historical customer content without a global platform administrator");
  assert.equal(database.sqlite.prepare("SELECT payload FROM events WHERE stream_id=? ORDER BY sequence LIMIT 1").get("creative:enterprise-other-owner")?.payload,unrelatedBefore,"a tenant-scoped privacy migration leaves other owners and organizations byte-for-byte unchanged");
  const deleted=await erase();assert.equal(deleted.status,200,JSON.stringify(await deleted.clone().json()));const receipt=(await deleted.json()).receipt;
  assert.equal(receipt.immutableOperationalMetadataRetained,true);assert.equal(receipt.externalBackupsPurged,false);assert.equal(receipt.otherDevicesPurged,false);assert.equal(media.has(key),false);
  assert.equal(database.sqlite.prepare("SELECT status FROM organizations WHERE organization_id=?").get(organizationId).status,"deleted");
  assert.equal(database.sqlite.prepare("SELECT status FROM organizations WHERE organization_id=?").get(anotherId).status,"active");
  assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM project_resource_scopes WHERE organization_id=?").get(organizationId).count,0);
  assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM organization_audit_events WHERE organization_id=?").get(organizationId).count>0,true,"content-free immutable audit receipts remain transparently disclosed");
  const receipts=await(await request("/api/workspaces/deletions",{headers:owner})).json();assert.equal(receipts.deletions[0].status,"completed");
});

test("tenant deletion inspects every historical event page and tenant owners can migrate private evidence without touching another account",async()=>{
  const {database,request,owner,organizationId,json}=await enterpriseWorkspaceFixture();
  const migrate=()=>request(`/api/workspaces/${organizationId}/recovery`,json(owner,{action:"migrate-privacy",organizationId,confirmation:"MIGRATE_ORGANIZATION_HISTORICAL_EVENT_CONTENT"}));
  const first=await migrate();assert.equal(first.status,200,JSON.stringify(await first.clone().json()));
  const now=new Date().toISOString(),stream="creative:enterprise-owner";
  let sequence=Number(database.sqlite.prepare("SELECT MAX(sequence) AS head FROM events WHERE stream_id=?").get(stream).head);
  const insert=database.sqlite.prepare("INSERT INTO events(event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,causation_id,compensates_event_id,schema_version,type,payload) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)");
  for(let index=0;index<1001;index+=1)insert.run(`legacy-public-${String(index).padStart(4,"0")}`,stream,++sequence,now,now,"user:enterprise-owner","pagination-test",crypto.randomUUID(),null,null,1,"BlockLocked",JSON.stringify({project_id:"project-atmosphere",document_id:"doc-atmosphere",block_id:`public-${index}`}));
  insert.run("zzzz-legacy-private-event",stream,++sequence,now,now,"user:enterprise-owner","pagination-test",crypto.randomUUID(),null,null,1,"BlockPropertyEdited",JSON.stringify({project_id:"project-atmosphere",document_id:"doc-atmosphere",block_id:"secret",property_path:"CUSTOMER!SECRET\tVALUE",object_ids:["safe:identifier","LEAK!SECRET"],source_block_versions:[{block_id:"verified-block",version:2},{block_id:"safe-block",version:"CONFIDENTIAL customer acquisition price $42m"},{block_id:"safe-object",version:{hidden:"NESTED SECRET"}}],text:"Sensitive customer requirements beyond the first thousand historical events"}));
  insert.run("zzzz-legacy-spoofed-event",stream,++sequence,now,now,"user:enterprise-owner","pagination-test",crypto.randomUUID(),null,null,1,"BlockPropertyEdited",JSON.stringify({_private_ref:"forged-operational-marker",project_id:"project-atmosphere",document_id:"doc-atmosphere",block_id:"spoofed",text:"CUSTOMER SPOOFED SECRET"}));
  const erase=()=>request(`/api/workspaces/${organizationId}/deletion`,json(owner,{organizationId,confirmation:"DELETE_ORGANIZATION_AND_SCOPED_DATA"}));
  database.reset();const blocked=await erase();assert.equal(blocked.status,409);assert.equal((await blocked.json()).error,"historical_privacy_migration_required");assert.equal(database.writeCount(),0,"customer text on a later historical page is detected before any irreversible write");
  const completed=await migrate();assert.equal(completed.status,200,JSON.stringify(await completed.clone().json()));assert.equal((await completed.json()).migratedEvents,1003);
  const publicEnvelope=database.sqlite.prepare("SELECT payload FROM events WHERE event_id='zzzz-legacy-private-event'").get().payload;
  assert.doesNotMatch(publicEnvelope,/CUSTOMER|SECRET|CONFIDENTIAL|Sensitive customer/,"historical migration never strands punctuation, control characters, or nested customer prose in immutable metadata");
  assert.deepEqual(JSON.parse(publicEnvelope).source_block_versions,[{block_id:"verified-block",version:2}]);
  const spoofedEnvelope=database.sqlite.prepare("SELECT payload FROM events WHERE event_id='zzzz-legacy-spoofed-event'").get().payload;
  assert.doesNotMatch(spoofedEnvelope,/SPOOFED SECRET|forged-operational-marker/,"a forged privacy marker never prevents historical authored content from being migrated");
  assert.equal(JSON.parse(spoofedEnvelope)._private_ref,"zzzz-legacy-spoofed-event");
  assert.match(database.sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id='zzzz-legacy-private-event'").get().private_json,/CUSTOMER!SECRET/);
  const erased=await erase();assert.equal(erased.status,200,JSON.stringify(await erased.clone().json()));
  assert.equal(database.sqlite.prepare("SELECT 1 FROM event_private_payloads WHERE private_event_id='zzzz-legacy-private-event'").get(),undefined);
  assert.equal(database.sqlite.prepare("SELECT 1 FROM event_private_payloads WHERE private_event_id='zzzz-legacy-spoofed-event'").get(),undefined);
});

test("hashed tenant provisioning credentials create bounded local identities and immediately withdraw scoped review authority",async()=>{
  const {database,request,owner,organizationId,json}=await enterpriseWorkspaceFixture();
  const issued=await request(`/api/workspaces/${organizationId}/security/provisioning-credentials`,{method:"POST",headers:owner});assert.equal(issued.status,201);const credential=await issued.json();
  assert.ok(credential.token.startsWith("forma_provision_"));assert.equal(database.sqlite.prepare("SELECT 1 FROM organization_provisioning_credentials WHERE token_hash=?").get(credential.token),undefined,"raw provisioning token never enters durable storage");
  const headers={authorization:`Bearer ${credential.token}`,"content-type":"application/json"};
  database.reset();const ownerAttack=await request(`/api/provisioning/${organizationId}/users`,{method:"POST",headers,body:JSON.stringify({userId:"enterprise-owner",email:"enterprise-owner@example.test",authenticationSource:"local-development"})});assert.equal(ownerAttack.status,409);assert.equal(database.writeCount(),0,"delegated provisioning cannot change or lock out the organization owner");
  const provision=()=>request(`/api/provisioning/${organizationId}/users`,{method:"POST",headers,body:JSON.stringify({userId:"enterprise-provisioned",email:"enterprise-provisioned@example.test",displayName:"Provisioned colleague",authenticationSource:"openai-workspace"})});
  assert.equal((await provision()).status,201);database.reset();assert.equal((await provision()).status,200,"provisioning the same stable subject is idempotent");assert.equal(database.writeCount(),0,"replaying a stable identity performs no writes or duplicate audit events");
  const identity={"oai-authenticated-user-id":"enterprise-provisioned","oai-authenticated-user-email":"enterprise-provisioned@example.test"};
  const session=await(await request("/api/session",{headers:identity})).json();assert.ok(session.organizations.some((organization)=>organization.organizationId===organizationId));
  const foreign=await request(`/api/provisioning/foreign-organization/users`,{method:"POST",headers,body:JSON.stringify({userId:"foreign",email:"foreign@example.test"})});assert.equal(foreign.status,401);
  assert.equal((await request(`/api/provisioning/${organizationId}/users/enterprise-provisioned`,{method:"DELETE",headers})).status,200);
  const departed=await(await request("/api/session",{headers:identity})).json();assert.equal(departed.organizations.some((organization)=>organization.organizationId===organizationId),false);
  const listed=await(await request(`/api/workspaces/${organizationId}/security/provisioning-credentials`,{headers:owner})).json();assert.equal(listed.credentials[0].id,credential.credentialId);assert.doesNotMatch(JSON.stringify(listed),/forma_provision_/);
  assert.equal((await request(`/api/workspaces/${organizationId}/security/provisioning-credentials/${credential.credentialId}`,{method:"DELETE",headers:owner})).status,200);
  database.reset();assert.equal((await provision()).status,401);assert.equal(database.writeCount(),0,"a revoked provisioning bearer loses authority immediately");
  database.reset();const forbidden=await request(`/api/provisioning/${organizationId}/users`,json(owner,{userId:"bad",email:"bad@example.test"}));assert.equal(forbidden.status,401);assert.equal(database.writeCount(),0);
});

test("provisioned group privileges reconcile overlapping memberships, forbid pilot reviewer escalation, and invalidate stale delegated credentials",async()=>{
  const {database,request,owner,organizationId,json}=await enterpriseWorkspaceFixture();
  const issue=async()=>{const response=await request(`/api/workspaces/${organizationId}/security/provisioning-credentials`,{method:"POST",headers:owner});assert.equal(response.status,201,JSON.stringify(await response.clone().json()));return response.json();};
  const originalCredential=await issue();
  const headers={authorization:`Bearer ${originalCredential.token}`,"content-type":"application/json"};
  const createUser=(userId,source="openai-workspace")=>request(`/api/provisioning/${organizationId}/users`,{method:"POST",headers,body:JSON.stringify({userId,email:`${userId}@example.test`,displayName:userId,authenticationSource:source})});
  assert.equal((await createUser("enterprise-group-member")).status,201);
  const group=(externalId,mappedRole,memberUserIds)=>request(`/api/provisioning/${organizationId}/groups`,{method:"POST",headers,body:JSON.stringify({externalId,name:externalId,mappedRole,...(memberUserIds===undefined?{}:{memberUserIds})})});
  assert.equal((await group("group-a","administrator",["enterprise-group-member"])).status,200);
  assert.equal(database.sqlite.prepare("SELECT role FROM organization_memberships WHERE organization_id=? AND user_id=?").get(organizationId,"enterprise-group-member").role,"administrator");
  assert.equal((await group("group-a","member")).status,200,"group mapping changes reconcile existing members even when no membership list is supplied");
  assert.equal(database.sqlite.prepare("SELECT role FROM organization_memberships WHERE organization_id=? AND user_id=?").get(organizationId,"enterprise-group-member").role,"member");
  assert.equal((await group("group-a","administrator",["enterprise-group-member"])).status,200);
  assert.equal((await group("group-b","administrator",["enterprise-group-member"])).status,200);
  assert.equal((await group("group-a","administrator",[])).status,200);
  assert.equal(database.sqlite.prepare("SELECT role FROM organization_memberships WHERE organization_id=? AND user_id=?").get(organizationId,"enterprise-group-member").role,"administrator","an overlapping active administrator mapping still grants the effective role");
  assert.equal((await group("group-b","administrator",[])).status,200);
  assert.equal(database.sqlite.prepare("SELECT role FROM organization_memberships WHERE organization_id=? AND user_id=?").get(organizationId,"enterprise-group-member").role,"member","removing the final privileged group immediately withdraws administrator status");

  const policy=await(await request(`/api/workspaces/${organizationId}/security`,{headers:owner})).json();
  const updated=await request(`/api/workspaces/${organizationId}/security`,json(owner,{authenticationSource:"openai-workspace",allowedEmailDomains:["example.test"],expectedVersion:policy.policy.version},"PATCH"));assert.equal(updated.status,200,JSON.stringify(await updated.clone().json()));
  database.reset();assert.equal((await createUser("enterprise-invalid-after-policy")).status,401);assert.equal(database.writeCount(),0,"security policy changes invalidate every earlier delegated provisioning token");
  const currentCredential=await issue();const freshHeaders={authorization:`Bearer ${currentCredential.token}`,"content-type":"application/json"};
  database.reset();const mismatched=await request(`/api/provisioning/${organizationId}/users`,{method:"POST",headers:freshHeaders,body:JSON.stringify({userId:"enterprise-group-member",email:"enterprise-group-member@example.test",displayName:"enterprise-group-member",authenticationSource:"cloudflare-access"})});assert.equal(mismatched.status,403);assert.equal(database.writeCount(),0,"a delegated identity cannot rewrite a valid member to a forbidden sign-in source");

  const now=new Date().toISOString();
  database.sqlite.prepare("INSERT INTO pilot_cohorts(cohort_id,organization_id,status,starts_at,ends_at,created_by_user_id,created_at,updated_at) VALUES(?,?,'active',?,?,'enterprise-owner',?,?)")
    .run("group-pilot",organizationId,now,"9999-12-31T23:59:59.999Z",now,now);
  for(const [userId,role] of [["enterprise-owner","owner"],["enterprise-group-member","reviewer"]])database.sqlite.prepare("INSERT INTO pilot_participants(participant_id,cohort_id,organization_id,email_normalized,user_id,role,status,invited_by_user_id,created_at,revoked_at) VALUES(?,'group-pilot',?,?,?,?, 'active','enterprise-owner',?,NULL)")
    .run(`pilot-${userId}`,organizationId,`${userId}@example.test`,userId,role,now);
  database.reset();const escalate=await request(`/api/provisioning/${organizationId}/groups`,{method:"POST",headers:freshHeaders,body:JSON.stringify({externalId:"reviewer-admin",name:"Reviewer escalation",mappedRole:"administrator",memberUserIds:["enterprise-group-member"]})});assert.equal(escalate.status,403);assert.equal(database.writeCount(),0);assert.equal(database.sqlite.prepare("SELECT role FROM organization_memberships WHERE organization_id=? AND user_id=?").get(organizationId,"enterprise-group-member").role,"member");
  database.sqlite.prepare("UPDATE pilot_cohorts SET status='closed' WHERE cohort_id='group-pilot'").run();
  database.reset();const closedEscalation=await request(`/api/provisioning/${organizationId}/groups`,{method:"POST",headers:freshHeaders,body:JSON.stringify({externalId:"closed-reviewer-admin",name:"Closed reviewer escalation",mappedRole:"administrator",memberUserIds:["enterprise-group-member"]})});assert.equal(closedEscalation.status,403);assert.equal(database.writeCount(),0,"closing a pilot without an authorized successor never turns its independent reviewer into an administrator");
  const member=database.sqlite.prepare("SELECT membership_id FROM organization_memberships WHERE organization_id=? AND user_id=?").get(organizationId,"enterprise-group-member").membership_id;
  database.reset();const directEscalation=await request(`/api/workspaces/${organizationId}/members/${member}`,json(owner,{role:"administrator"},"PATCH"));assert.equal(directEscalation.status,403);assert.equal(database.writeCount(),0,"direct member editing cannot bypass the same closed-cohort reviewer boundary");
  database.sqlite.prepare("UPDATE organization_provisioning_credentials SET created_at=? WHERE credential_id=?").run(new Date(Date.now()-31*24*60*60*1000).toISOString(),currentCredential.credentialId);
  database.reset();assert.equal((await request(`/api/provisioning/${organizationId}/groups`,{method:"POST",headers:freshHeaders,body:JSON.stringify({externalId:"expired",name:"Expired",mappedRole:"member"})})).status,401);assert.equal(database.writeCount(),0,"delegated provisioning credentials automatically expire after thirty days");
});

test("delegated provisioning checks exact credential liveness inside its authoritative transaction",async()=>{
  const {database,environment,request,owner,organizationId}=await enterpriseWorkspaceFixture();
  const issued=await request(`/api/workspaces/${organizationId}/security/provisioning-credentials`,{method:"POST",headers:owner});assert.equal(issued.status,201);const credential=await issued.json();
  const headers={authorization:`Bearer ${credential.token}`,"content-type":"application/json"};
  const original=environment.DB.batch.bind(environment.DB);
  environment.DB.batch=async(statements)=>{
    if(statements.some((statement)=>statement.sql.includes("INSERT INTO users(user_id,email,display_name"))){
      database.sqlite.prepare("UPDATE organization_provisioning_credentials SET status='revoked',revoked_at=? WHERE credential_id=?")
        .run(new Date().toISOString(),credential.credentialId);
    }
    return original(statements);
  };
  const raced=await request(`/api/provisioning/${organizationId}/users`,{method:"POST",headers,body:JSON.stringify({userId:"enterprise-race-user",email:"enterprise-race-user@example.test",authenticationSource:"openai-workspace"})});assert.equal(raced.status,401,JSON.stringify(await raced.clone().json()));
  assert.equal(database.sqlite.prepare("SELECT 1 FROM users WHERE user_id=?").get("enterprise-race-user"),undefined);
  assert.equal(database.sqlite.prepare("SELECT 1 FROM organization_memberships WHERE organization_id=? AND user_id=?").get(organizationId,"enterprise-race-user"),undefined,"revoking a delegated credential before its transaction cannot leave an orphan user or active membership");
  environment.DB.batch=original;
});

test("delegated provisioning cannot create an orphan identity after named pilot enrollment is revoked",async()=>{
  const {database,environment,request,owner,organizationId}=await enterpriseWorkspaceFixture();
  const issued=await request(`/api/workspaces/${organizationId}/security/provisioning-credentials`,{method:"POST",headers:owner});assert.equal(issued.status,201);const credential=await issued.json();
  const now=new Date().toISOString();
  database.sqlite.prepare("INSERT INTO pilot_cohorts(cohort_id,organization_id,status,starts_at,ends_at,created_by_user_id,created_at,updated_at) VALUES(?,?,'active',?,?,'enterprise-owner',?,?)")
    .run("enrollment-race-pilot",organizationId,now,"9999-12-31T23:59:59.999Z",now,now);
  const participants=database.sqlite.prepare("INSERT INTO pilot_participants(participant_id,cohort_id,organization_id,email_normalized,user_id,role,status,invited_by_user_id,created_at,revoked_at) VALUES(?,'enrollment-race-pilot',?,?,?,?,'active','enterprise-owner',?,NULL)");
  participants.run("enrollment-owner",organizationId,"enterprise-owner@example.test","enterprise-owner","owner",now);
  participants.run("enrollment-target",organizationId,"enterprise-enrollment-race@example.test",null,"member",now);
  const original=environment.DB.batch.bind(environment.DB);let revoked=false;
  environment.DB.batch=async(statements)=>{
    if(!revoked&&statements.some((statement)=>statement.sql.includes("INSERT INTO users(user_id,email,display_name"))){
      revoked=true;database.sqlite.prepare("UPDATE pilot_participants SET status='revoked',revoked_at=? WHERE participant_id='enrollment-target'").run(new Date().toISOString());
    }
    return original(statements);
  };
  const raced=await request(`/api/provisioning/${organizationId}/users`,{method:"POST",headers:{authorization:`Bearer ${credential.token}`,"content-type":"application/json"},body:JSON.stringify({userId:"enterprise-enrollment-race",email:"enterprise-enrollment-race@example.test",authenticationSource:"openai-workspace"})});
  assert.equal(revoked,true);assert.equal(raced.status,403,JSON.stringify(await raced.clone().json()));
  assert.equal(database.sqlite.prepare("SELECT 1 FROM users WHERE user_id='enterprise-enrollment-race'").get(),undefined);
  assert.equal(database.sqlite.prepare("SELECT 1 FROM organization_memberships WHERE organization_id=? AND user_id='enterprise-enrollment-race'").get(organizationId),undefined);
  environment.DB.batch=original;
});

test("cold schema initialization preserves every account's existing finished-output retention deadline",async()=>{
  const {database,environment}=await enterpriseWorkspaceFixture({artifact:true});
  const deadline="2031-04-02T03:04:05.000Z";
  database.sqlite.prepare("UPDATE private_content SET expires_at=? WHERE content_id='enterprise-output-content'").run(deadline);
  const isolated={...environment,DB:{prepare:(statement)=>environment.DB.prepare(statement),batch:(statements)=>environment.DB.batch(statements)}};
  await ensureSchema(isolated);
  assert.equal(database.sqlite.prepare("SELECT expires_at FROM private_content WHERE content_id='enterprise-output-content'").get().expires_at,deadline,"a new worker isolate never silently changes another actor's established retention period");
});

test("capability and delivery migrations safely replay after runtime initialization without altering the schema",async()=>{
  const {database}=await productionWorker();const migrations=await Promise.all(["0011_swift_redwing.sql","0012_green_james_howlett.sql","0013_long_midnight.sql","0014_perfect_robbie_robertson.sql","0015_true_lila_cheney.sql","0016_living_tarantula.sql","0017_previous_pixie.sql","0018_consequential_consent.sql","0019_authoring_commits.sql","0018_output_requirements.sql"].map((name)=>readFile(new URL(`../drizzle/${name}`,import.meta.url),"utf8")));
  const snapshot=()=>database.sqlite.prepare("SELECT type,name,sql FROM sqlite_master WHERE type IN ('table','index') ORDER BY type,name").all();const initial=snapshot();
  for(let attempt=0;attempt<2;attempt+=1)for(const migration of migrations)database.sqlite.exec(migration);
  assert.deepEqual(snapshot(),initial);assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table'").get().count,93);assert.ok(initial.some((item)=>item.name==="output_operation_slots"));assert.ok(initial.some((item)=>item.name==="output_provider_calls"));assert.ok(initial.some((item)=>item.name==="output_native_storage_writes"));assert.ok(initial.some((item)=>item.name==="output_asset_storage_writes"));assert.ok(initial.some((item)=>item.name==="capability_grants"));assert.ok(initial.some((item)=>item.name==="delivery_decisions"));assert.ok(initial.some((item)=>item.name==="project_event_scopes"));assert.ok(initial.some((item)=>item.name==="event_private_payloads"));assert.ok(initial.some((item)=>item.name==="event_write_stage"));assert.ok(initial.some((item)=>item.name==="project_notifications"));assert.ok(initial.some((item)=>item.name==="organization_invitations"));assert.ok(initial.some((item)=>item.name==="route_performance_samples"));assert.ok(initial.some((item)=>item.name==="pilot_cohorts"));assert.ok(initial.some((item)=>item.name==="artifact_revisions"));assert.ok(initial.some((item)=>item.name==="organization_context_packages"));assert.ok(initial.some((item)=>item.name==="project_review_tasks"));assert.ok(initial.some((item)=>item.name==="organization_recovery_snapshots"));
});

test("creator provenance defaults to human-readable history and exposes Engineering handoffs only to exact event specialists",async()=>{
  const sources=await Promise.all(["forma-workspace.ts","event-inspector.ts"].map((name)=>readFile(new URL(`../src/components/${name}`,import.meta.url),"utf8")));
  for(const source of sources){
    assert.match(source,/capabilities\?\.includes\("engineering\.events\.read"\)===true/);
    assert.match(source,/workspace\.provenance\.description/);
    assert.match(source,/import\s*\{[^}]*\bnavigateInApp\b[^}]*\}\s*from\s*"\.\/command-departure";/u);
    const technical=source.match(/\$\{engineering\?html\x60<details class="provenance-technical">[\s\S]*?<\/details>\x60:nothing\}/u);
    assert.ok(technical,"technical details remain collapsed and exact-capability gated");
    assert.match(technical[0],/<button @click=\$\{\(\)\s*=>\s*navigateInApp\(this,navigation=>navigation\.route\("\/engineering\/events"\)\)\}>/u);
    assert.doesNotMatch(source,/setRoute\("\/engineering\/events"\)/);
    assert.doesNotMatch(source,/Open in Operations|setRoute\("\/operations\/events"\)/);
  }
  const [bridge,shell]=await Promise.all(["command-departure.ts","forma-shell.ts"].map(name=>readFile(new URL("../src/components/"+name,import.meta.url),"utf8")));
  const section=(source,start,end)=>{
    const from=source.indexOf(start),to=end?source.indexOf(end,from+start.length):source.length;
    assert.ok(from>=0&&to>from,"the actual navigation declaration is retained: "+start);
    return source.slice(from,to).replace(/\s+/gu,"");
  };
  const forwarding=section(bridge,"export function navigateInApp(");
  assert.ok(forwarding.includes('consthost=origin.closest<InAppNavigationHost>("forma-shell");'));
  assert.ok(forwarding.includes("returnhost?host.navigateFrom(origin,run,context):Promise.resolve(false);"));
  const admission=section(shell,"  async navigateFrom(","  async #runCommand(");
  assert.ok(admission.includes("if(!this.isConnected||!origin.isConnected||!this.contains(origin)||!FormaElement.hasStoreIdentity(origin,this.store)||this.store.ui.commandOpen)returnfalse;"));
  assert.ok(admission.includes("constowner=this.#captureNavigationOpening();if(!owner)returnfalse;"));
  assert.ok(admission.includes("constcaptured=this.#captureNavigation(owner,true,context,presentationCurrent),navigation=captured.navigation,focus=navigation.focus;"));
  // A deliberate positive context handoff replaces the origin authorization
  // check only with its one Store-issued successor, not route equality alone.
  assert.ok(admission.includes("constcurrent=()=>captured.sourceCurrent()&&focus.current();"));
  assert.ok(admission.includes("constoptions={current,focus,onOriginHandoff:()=>navigation.handoff(),onDestinationSource:(source:CapturedSourceOwnership)=>navigation.adoptSource(source)};"));
  // Shared admission still reports the original guarded refusal; its local
  // wrapper forwards only an actually reported reason to the optional caller.
  assert.ok(admission.includes("constreportUnavailable=()=>{constreason=captured.reportUnavailable();if(reason)preferences.onRefusal?.(reason);};"));
  assert.ok(admission.includes("if(!current()){if(captured.refusalCurrent()&&captured.blocked())reportUnavailable();returnfalse;}"));
  // The artifact-opening wrapper retains, rather than replaces, the same
  // guarded route/options/lease. Engineering is a non-artifact pass-through.
  assert.ok(admission.includes('if(!opened||linked?.kind!=="artifact"||route===owner.route)returnopened;'));
  assert.ok(admission.includes('constopened=this.#route(path,{...options,...preferences},false);returntypeofopened==="boolean"?retainArtifactOpening(opened):opened.then(retainArtifactOpening);'));
  assert.ok(admission.includes("constsource=this.store.captureSourceOwnership(),arrival=this.store.captureWorkspaceNavigationFocus(route,focus);"));
  assert.ok(admission.includes("if(!current()||!source||!artifact||!arrival?.current())returnfalse;"));
  assert.ok(admission.includes("constrouteCurrent=()=>captured.sourceCurrent()&&this.store.sourceOwnershipActive(source)"
    +"&&arrival.routeCurrent()&&this.store.route.get()===route&&this.store.projection.get().libraryArtifacts.some(value=>value.id===target.id"
    +"&&value.documentId===target.documentId&&value.sequence===target.sequence&&value.sourceEventId===target.sourceEventId&&value.contentRef===target.contentRef);"));
  assert.ok(admission.includes("this.#commandRouteFocus={route,focus,current:()=>routeCurrent()&&arrival.current()};navigation.retain();returntrue;"));
  const owner=section(shell,"  #captureNavigation(","  /** Deliberate UI navigation only;");
  assert.ok(owner.includes("constoriginScope=()=>this.#commandContextCurrent(owner)&&this.store.route.get()===owner.route&&(!owner.sourceReadable||this.store.sourceOwnershipActive(owner.source));"));
  assert.ok(owner.includes("letdestinationSource:CapturedSourceOwnership|null=null,destinationRoute:{routeCurrent():boolean}|null=null;"));
  assert.ok(owner.includes("if(!this.#commandIntentCurrent(owner)||!handedOff&&!routeHandoff&&(!originScope()||replaces&&!this.#commandOriginsCurrent(owner)||!presentationCurrent()))retired=\"identity\";"));
  assert.ok(owner.includes("if(destinationSource){if(!this.store.sourceOwnershipActive(destinationSource))retired=\"identity\";"
    +"destinationRoute??=this.store.captureWorkspaceNavigationFocus(this.store.route.get(),expectedFocus);"
    +"if(destinationRoute?!destinationRoute.routeCurrent():this.store.route.get()!==owner.route)retired=\"identity\";}"));
  assert.ok(owner.includes("if(retired)returnfalse;if(routeHandoff)handedOff=true;if(!handedOff&&blocked())retired=\"blocked\";return!retired;"));
  assert.ok(owner.includes("handoff:()=>{if(!navigation.current()||!focus.current())returnfalse;handedOff=true;returntrue;},"));
  assert.ok(owner.includes("adoptSource:source=>{if(!handedOff||destinationSource||!navigation.current()||!focus.current()||this.store.route.get()!==owner.route"
    +"||!this.store.sourceOwnershipActive(source))returnfalse;destinationSource=source;returnnavigation.current()&&focus.current();},"));
  assert.ok(owner.includes("sourceCurrent:()=>navigation.current()&&(destinationSource!==null||this.#commandContextCurrent(owner)),"));
  assert.ok(owner.includes("constunsubscribe=this.store.subscribe(()=>{navigation.current();});"));
  const authority=section(shell,"  #commandContextCurrent(","  #commandOriginElements(");
  assert.ok(authority.includes("returnthis.#commandIntentCurrent(owner)&&this.store.captureAuthorizationScope()?.key===owner.authorityKey;"));
  const route=section(shell,"  #route(","  #page()");
  assert.ok(route.includes("if(options&&(!options.current()||!options.focus.current()))returnfalse;"));
  assert.ok(route.includes("this.store.transitionWorkspace(path,options)"));
  assert.ok(route.includes("this.store.setRoute(path,options);returnfinish();"));
  // The same expected native-focus record owns the adopted route revision.
  // Its routeCurrent is intentionally focus-independent to avoid recursion
  // through the existing review wrapper; both outer current/focus guards stay.
  const store=await readFile(new URL("../src/state/store.ts",import.meta.url),"utf8");
  const receipt=section(store,"  captureWorkspaceNavigationFocus(","  #loadRevision=");
  assert.ok(receipt.includes("constowner=this.#workspaceNavigationFocus;if(!owner||owner.route!==route||(expected&&owner.focus!==expected))returnnull;"));
  assert.ok(receipt.includes("routeCurrent:()=>this.#workspaceNavigationFocus===owner&&this.route.get()===route&&this.#workspaceTransition===owner.revision,"));
  assert.ok(receipt.includes("current:()=>this.#workspaceNavigationFocus===owner&&this.route.get()===route&&owner.focus.current()"));
  const commit=section(store,"  #commitRoute(","  async syncDocumentFromRoute(");
  assert.ok(commit.includes("if(!workspaceNavigationCurrent(options))return;path=this.#projectTaskRoute(path,options);if(options.onOriginHandoff&&!options.onOriginHandoff())return;this.#workspaceTransition+=1;"));
  assert.ok(commit.includes("this.#workspaceNavigationFocus=options.focus?{route:routedPath,focus:options.focus,revision:this.#workspaceTransition}:null;this.route.set(routedPath);"));
  const source=section(store,"  captureSourceOwnership(","  #assertSourceOwnership(");
  assert.ok(source.includes("constauthorization=this.captureAuthorizationScope();if(!authorization)returnnull;"
    +"constsource=Object.freeze({authorization:Object.freeze({...authorization}),generation:this.#sourceGeneration});"
    +"this.#sourceOwners.set(source,this.session.get()?.projectContext?.expiresAt??null);returnsource;"));
  assert.ok(source.includes("returnBoolean(source&&this.#sourceOwners.has(source)&&this.authorizationScopeActive(source.authorization));"));
  assert.ok(source.includes("returnBoolean(source&&this.#sourceExpiryValid(this.#sourceOwners.get(source))&&this.#sourceExpiryValid(this.session.get()?.projectContext?.expiresAt??null));"));
  assert.ok(source.includes("returnBoolean(source&&this.sourceOwnershipScopeActive(source)&&source.generation===this.#sourceGeneration&&!this.#sourceRetired&&this.#sourceDeadlineCurrent(source));"));
});

// Live metadata shares the real dashboard batch; these controls keep the
// separate post-snapshot proof and safe-source cache boundary observable.
async function analyticsLiveFixture() {
  const fixture = await productionWorker();
  await fixture.drainBackground();
  fixture.database.reset();
  return fixture;
}

function assertAnalyticsLiveBatchCalls(database, sizes) {
  assert.deepEqual(database.calls.map((call) => call.kind), ["first", ...sizes.map(() => "batch"), "first"]);
  const batches = database.calls.filter((call) => call.kind === "batch");
  assert.deepEqual(batches.map((call) => call.statements.length), sizes);
  for (const batch of batches) {
    assert.match(batch.statements[0].sql, /AS analytics_head/);
    assert.match(batch.statements[1].sql, /FROM replay_personas WHERE owner_id=\?/);
    assert.match(batch.statements[2].sql, /FROM events/);
    if (batch.statements.length === 7) assert.match(batch.statements[3].sql, /^SELECT content FROM external_content WHERE content_id=\? AND owner_id=\?$/);
    const live = batch.statements.slice(-3);
    assert.match(live[0].sql, /^SELECT 1 AS authorized WHERE EXISTS/);
    assert.match(live[1].sql, /FROM cost_budget_reservations WHERE owner_id=\?/);
    assert.match(live[2].sql, /^WITH visible AS/);
    assert.ok(batch.statements.every((statement) => /^\s*(?:SELECT|WITH)/.test(statement.sql)));
    assert.ok(batch.statements.every((statement) => statement.values.length <= 100));
    assert.equal(database.calls.at(-1).sql, live[0].sql, "the final proof is a separate read of the same current-authority guard");
  }
  assert.equal(database.writeCount(), 0, "no foreground analytics D1 writes");
}

function addAnalyticsLiveHold(database, id) {
  const stamp = new Date().toISOString();
  database.sqlite.prepare("INSERT INTO cost_budget_reservations(reservation_id,owner_id,workspace_id,stream_id,correlation_id,operation,period,reserved_microusd,used_microusd,status,allow_user_overage,created_at,settled_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,0,?,NULL,?)")
    .run(id, "dev-local-creative", "forma", "creative:dev-local-creative", id + ":correlation", "document-render:video", "2026-08", 19_644_000, 0, "executing", stamp, stamp);
}

async function analyticsLiveColdRequest(fixture) {
  const binding = { prepare: (sql) => fixture.database.DB.prepare(sql), batch: (statements) => fixture.database.DB.batch(statements) };
  const environment = { ...fixture.environment, DB: binding };
  const request = (path) => worker.fetch(new Request(`http://localhost${path}`), environment, fixture.context);
  assert.equal((await request("/api/session")).status, 200);
  await fixture.drainBackground();
  fixture.database.reset();
  return request;
}

for (const mode of ["cold", "warm", "durable"]) {
  test(`analytics live batch ${mode} discards the entire routed response after post-snapshot revocation`, async () => {
    const fixture = await analyticsLiveFixture();
    const { database, context, drainBackground } = fixture;
    addAnalyticsLiveHold(database, "private-held-" + mode);
    if (mode !== "cold") {
      assert.equal((await fixture.request("/api/analytics?days=all")).status, 200);
      await drainBackground();
    }
    const request = mode === "durable" ? await analyticsLiveColdRequest(fixture) : fixture.request;
    addCorrelatedTerminal(database.sqlite, "creative:dev-local-creative", "revoked-new-event-" + mode);
    const checkpoints = () => database.sqlite.prepare("SELECT content_id,owner_id,content FROM external_content ORDER BY content_id").all();
    const before = checkpoints();
    let scheduled = 0, revoked = false;
    const waitUntil = context.waitUntil;
    context.waitUntil = (promise) => { scheduled += 1; waitUntil(promise); };
    const batch = database.DB.batch;
    database.DB.batch = async (statements) => {
      const rows = await batch(statements);
      if (statements.some((statement) => statement.sql.includes("FROM cost_budget_reservations WHERE owner_id=?"))) {
        assert.equal(revoked, false);
        revoked = true;
        // This is an actual SQLite mutation after the measured transaction's
        // COMMIT, not fabricated guard output or an in-batch revocation.
        database.sqlite.prepare("UPDATE users SET role='creator' WHERE user_id=?").run("dev-local-creative");
      }
      return rows;
    };
    database.reset();
    let response;
    try { response = await request("/api/analytics?days=all"); }
    finally { database.DB.batch = batch; }
    assert.equal(revoked, true);
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "analytics_access_changed" });
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assertAnalyticsLiveBatchCalls(database, [mode === "warm" ? 6 : 7]);
    assert.equal(scheduled, 0, "denied evidence cannot schedule a source checkpoint");
    await drainBackground();
    assert.equal(database.writeCount(), 0);
    assert.deepEqual(checkpoints(), before);

    database.sqlite.prepare("UPDATE users SET role='admin' WHERE user_id=?").run("dev-local-creative");
    database.reset();
    const recovered = await request("/api/analytics?days=all");
    assert.equal(recovered.status, 200);
    assert.equal(recovered.headers.get("x-forma-analytics-cache"), mode === "cold" ? "miss" : mode === "warm" ? "delta" : "durable",
      "the denied batch never publishes a new in-memory source entry");
    if (mode !== "cold") assert.equal(recovered.headers.get("x-forma-analytics-source-rows"), "1");
    assert.equal((await recovered.json()).report.outcomes.live.finance.heldMicrousd, 19_644_000);
    assertAnalyticsLiveBatchCalls(database, [mode === "warm" ? 6 : 7]);
    await drainBackground();
  });
}

test("analytics live batch refreshes the ledger on a routed zero-event delta without caching live evidence", async () => {
  const { database, request, drainBackground } = await analyticsLiveFixture();
  const id = "private-ledger-not-event-evidence";
  addAnalyticsLiveHold(database, id);
  const first = await request("/api/analytics?days=all");
  assert.equal(first.status, 200);
  const initial = (await first.json()).report;
  assert.equal(initial.outcomes.live.finance.heldMicrousd, 19_644_000);
  assertAnalyticsLiveBatchCalls(database, [7]);
  await drainBackground();
  const saved = JSON.parse(database.sqlite.prepare("SELECT content FROM external_content WHERE content_id LIKE 'analytics-source:v1:%'").get().content);
  assert.deepEqual(Object.keys(saved).sort(), ["schema", "outcomeBindings", "owner", "epoch", "synthetic", "pricing", "head", "personas", "count", "payload"].sort());
  const compressed = Uint8Array.from(atob(saved.payload), (value) => value.charCodeAt(0));
  const payload = await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
  assert.equal(payload.includes(id), false);
  assert.equal(saved.live, undefined);
  assert.equal(saved.finance, undefined);
  assert.equal(saved.jobs, undefined);
  database.sqlite.prepare("UPDATE cost_budget_reservations SET status='settled',used_microusd=3000000,settled_at=? WHERE reservation_id=?").run(new Date().toISOString(), id);
  database.reset();
  const second = await request("/api/analytics?days=all");
  assert.equal(second.status, 200);
  assert.equal(second.headers.get("x-forma-analytics-cache"), "delta");
  assert.equal(second.headers.get("x-forma-analytics-source-rows"), "0");
  const current = (await second.json()).report;
  assert.deepEqual(current.source, initial.source);
  assert.deepEqual(current.totals, initial.totals);
  assert.equal(current.outcomes.live.finance.heldMicrousd, 0);
  assert.equal(current.outcomes.live.finance.settledMicrousd, 3_000_000);
  assert.equal(current.outcomes.usage.recordedMicrousd, initial.outcomes.usage.recordedMicrousd);
  assertAnalyticsLiveBatchCalls(database, [6]);
  await drainBackground();
});

test("analytics live batch corrupt-source fallback uses the latest ledger and retention snapshot in four explicit trips", async () => {
  const fixture = await analyticsLiveFixture();
  const { database, drainBackground } = fixture;
  const id = "fallback-live-hold", jobId = "fallback-live-job";
  addAnalyticsLiveHold(database, id);
  const documentId = "fallback-live-document";
  // The legacy seed document has no project_id; create the required personal
  // document anchor through the real public event route, not by repairing it.
  const created = await fixture.request("/api/events", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "append", event: { type: "DocumentCreated", payload: {
      project_id: "project-atmosphere", document_id: documentId, title: "Fallback live snapshot",
    } } }),
  });
  const createdBody = await created.json();
  assert.equal(created.status, 200, JSON.stringify(createdBody));
  assert.deepEqual(createdBody.rejected, []);
  assert.deepEqual(createdBody.appended.map((event) => [event.type, event.payload.document_id, event.payload.project_id]),
    [["DocumentCreated", documentId, "project-atmosphere"]]);
  await drainBackground();
  database.reset();
  const stamp = new Date().toISOString();
  database.sqlite.prepare("INSERT INTO document_jobs(job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,request_json,result_json,attempt_count,requested_at,expires_at,updated_at) VALUES(?,?,?,?,'render_document','completed','test',?,1,'{}',?,1,?,?,?)")
    .run(jobId, "dev-local-creative", "creative:dev-local-creative", documentId, jobId + ":correlation", JSON.stringify({ body: "PRIVATE checkpoint", media_url: "https://private.invalid/media" }), stamp, "2100-01-01T00:00:00.000Z", stamp);
  const first = await fixture.request("/api/analytics?days=all");
  assert.equal(first.status, 200);
  const initial = (await first.json()).report;
  assert.equal(initial.outcomes.live.finance.heldMicrousd, 19_644_000);
  assert.ok(initial.outcomes.live.jobs.retainedCheckpointCount >= 1);
  await drainBackground();
  const saved = database.sqlite.prepare("SELECT content_id,content FROM external_content WHERE content_id LIKE 'analytics-source:v1:%'").get();
  const corrupt = { ...JSON.parse(saved.content), payload: "not-valid-gzip" };
  database.sqlite.prepare("UPDATE external_content SET content=? WHERE content_id=?").run(JSON.stringify(corrupt), saved.content_id);
  const request = await analyticsLiveColdRequest(fixture);
  const batch = database.DB.batch;
  let combined = 0;
  database.DB.batch = async (statements) => {
    const rows = await batch(statements);
    if (statements.some((statement) => statement.sql.includes("FROM cost_budget_reservations WHERE owner_id=?")) && ++combined === 1) {
      database.sqlite.prepare("UPDATE cost_budget_reservations SET status='settled',used_microusd=3000000,settled_at=? WHERE reservation_id=?").run(stamp, id);
      database.sqlite.prepare("UPDATE document_jobs SET expires_at=? WHERE job_id=?").run("2000-01-01T00:00:00.000Z", jobId);
    }
    return rows;
  };
  let response;
  try { response = await request("/api/analytics?days=all"); }
  finally { database.DB.batch = batch; }
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-forma-analytics-cache"), "miss");
  const current = (await response.json()).report;
  assert.deepEqual(current.totals, initial.totals);
  assert.equal(current.outcomes.live.finance.heldMicrousd, 0);
  assert.equal(current.outcomes.live.finance.settledMicrousd, 3_000_000);
  assert.equal(current.outcomes.live.jobs.total, initial.outcomes.live.jobs.total - 1);
  assert.equal(current.outcomes.live.jobs.retainedCheckpointCount, initial.outcomes.live.jobs.retainedCheckpointCount - 1);
  assert.equal(current.outcomes.live.jobs.usableResultCount, null);
  assert.equal(current.outcomes.live.jobs.mediaAvailability, "not-checked");
  assert.ok(!/PRIVATE checkpoint|private.invalid/.test(JSON.stringify(current)));
  assert.equal(combined, 2);
  assertAnalyticsLiveBatchCalls(database, [7, 6]);
  await drainBackground();
});

test("analytics live batch schedules no checkpoint while its separate final proof is pending", { timeout: 30_000 }, async () => {
  const { database, request, context, drainBackground } = await analyticsLiveFixture();
  let enter, release, scheduled = 0;
  const entered = new Promise((resolve) => { enter = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const waitUntil = context.waitUntil;
  context.waitUntil = (promise) => { scheduled += 1; waitUntil(promise); };
  const prepare = database.DB.prepare;
  database.DB.prepare = (sql) => {
    const statement = prepare(sql), bind = statement.bind;
    statement.bind = (...values) => {
      const bound = bind.apply(statement, values);
      if (/^SELECT 1 AS authorized WHERE EXISTS/.test(sql)) {
        const first = bound.first;
        bound.first = async (...args) => { enter(); await gate; return first.apply(bound, args); };
      }
      return bound;
    };
    return statement;
  };
  const pending = request("/api/analytics?days=all");
  try {
    await entered;
    assert.deepEqual(database.calls.map((call) => call.kind), ["first", "batch"]);
    assert.equal(scheduled, 0);
    assert.equal(database.writeCount(), 0);
    assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM external_content WHERE content_id LIKE 'analytics-source:v1:%'").get().count, 0);
  } finally { release(); database.DB.prepare = prepare; }
  const response = await pending;
  assert.equal(response.status, 200);
  assertAnalyticsLiveBatchCalls(database, [7]);
  assert.equal(scheduled, 1);
  await drainBackground();
  assert.equal(database.writeCount(), 1, "only the existing post-response safe-source checkpoint is persisted");
});

test("analytics live batch fails closed without cache publication when the combined native SQL read fails", async () => {
  const { database, request, context, drainBackground } = await analyticsLiveFixture();
  let scheduled = 0;
  const waitUntil = context.waitUntil;
  context.waitUntil = (promise) => { scheduled += 1; waitUntil(promise); };
  database.sqlite.exec("DROP TABLE cost_budget_reservations");
  const response = await request("/api/analytics?days=all");
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "outcome_telemetry_unavailable" });
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(database.calls.map((call) => call.kind), ["first", "batch"]);
  assert.equal(database.calls[1].statements.length, 7);
  assert.equal(database.writeCount(), 0);
  assert.equal(scheduled, 0);
  await drainBackground();
  assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM external_content WHERE content_id LIKE 'analytics-source:v1:%'").get().count, 0);
});
