import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { SITE_ROUTE_ENTRIES } from "../src/platform/applications.ts";

const root = new URL("../", import.meta.url).href;
const resolution = registerHooks({ resolve(specifier, context, nextResolve) {
  const source = typeof context.parentURL === "string" && context.parentURL.startsWith(root) && !context.parentURL.includes("/node_modules/");
  return nextResolve(source && specifier.startsWith(".") && !/\.[a-z0-9]+$/iu.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
const [{ default: worker }, { PLATFORM_PRINCIPAL_WITH_ACCESS_SQL,PRINCIPAL_WITH_ACCESS_SQL }, {requireUser,reconcileFailedBudgetReservations,reserveBudget,reserveCostBudget,settleBudget,settleCostBudget,claimCostBudgetReservation}, {runDocumentJob}, consequential] = await Promise.all([
  import("../worker/index.ts"),
  import("../worker/access-policy.ts"),
  import("../worker/pilot-policy.ts"),
  import("../worker/document-jobs-api.ts"),
  import("../worker/consequential-consent.ts"),
]).finally(() => resolution.deregister());

function database() {
  const sqlite = new DatabaseSync(":memory:");
  const controls = { failAssistantTurnInsert: false, failAssistantActionCommit: false, failAssistantBillingAudit: false,
    failAssistantBillingCostSettlement: false, failPlatformAssistantCommit: false, forbidCreatorContentReads: false,
    failPlatformPrivacyErase: false, beforePlatformCommit: null, beforeDeletionClaim: null, beforeConsequentialClaim:null, beforeConsequentialSubmit:null,beforeConsequentialResultRead:null,failAfterConsequentialComplete:false,failNextConsequentialPrincipalRead:false, beforeAuthoringCommit:null,failAuthoringCommit:false,failAuthoringEventAt:0, skipAssistantTaskClaimOnce: false, lastDatabaseError: "" };
  class Statement {
    constructor(sql, values = []) { this.sql = sql; this.values = values; }
    bind(...values) { assert.ok(values.length <= 100); return new Statement(this.sql, values); }
    execute(kind) {
      if(/^\s*INSERT INTO authoring_commits/iu.test(this.sql)){
        if(controls.beforeAuthoringCommit){const callback=controls.beforeAuthoringCommit;controls.beforeAuthoringCommit=null;callback();}
        if(controls.failAuthoringCommit){controls.failAuthoringCommit=false;throw new Error("injected_authoring_receipt_failure");}
      }
      if(controls.failAuthoringEventAt&&/^\s*INSERT INTO event_write_stage/iu.test(this.sql)&&this.values.includes("web:context-approval")){
        controls.failAuthoringEventAt--;if(!controls.failAuthoringEventAt)throw new Error("injected_authoring_event_failure");
      }
      if(controls.failNextConsequentialPrincipalRead&&this.sql===PRINCIPAL_WITH_ACCESS_SQL){controls.failNextConsequentialPrincipalRead=false;throw new Error("injected_post_complete_read_failure");}
      if(controls.failAfterConsequentialComplete&&/^\s*UPDATE consequential_executions SET status='completed'/iu.test(this.sql)){controls.failAfterConsequentialComplete=false;controls.failNextConsequentialPrincipalRead=true;}
      for(const [key,pattern] of [["beforeConsequentialClaim",/^\s*UPDATE consequential_executions SET status='reserved'/iu],["beforeConsequentialSubmit",/^\s*UPDATE consequential_execution_steps SET status='submitting'/iu],["beforeConsequentialResultRead",/^\s*SELECT content FROM private_content WHERE .*kind='context-proposal'/iu]]){
        if(controls[key]&&pattern.test(this.sql)){const callback=controls[key];controls[key]=null;callback();}
      }
      if (controls.failAssistantTurnInsert && /^\s*INSERT INTO assistant_turns\b/iu.test(this.sql)) {
        controls.failAssistantTurnInsert = false;
        throw new Error("injected_assistant_turn_failure");
      }
      if (controls.failAssistantActionCommit && /^\s*INSERT INTO assistant_action_commits\b/iu.test(this.sql)) {
        controls.failAssistantActionCommit = false;
        throw new Error("injected_assistant_action_failure");
      }
      if (controls.failAssistantBillingAudit && /^\s*INSERT OR IGNORE INTO assistant_billing_reconciliations\b/iu.test(this.sql)) {
        controls.failAssistantBillingAudit = false;
        throw new Error("injected_assistant_billing_audit_failure");
      }
      if (controls.failAssistantBillingCostSettlement && /^\s*UPDATE cost_budget_reservations SET used_microusd=/iu.test(this.sql)) {
        controls.failAssistantBillingCostSettlement = false;
        throw new Error("injected_assistant_billing_settlement_failure");
      }
      if (controls.failPlatformAssistantCommit && /^\s*INSERT INTO platform_assistant_commits\b/iu.test(this.sql)) {
        controls.failPlatformAssistantCommit = false;
        throw new Error("CHECK constraint failed: platform_assistant_commits");
      }
      if (controls.beforePlatformCommit && /^\s*INSERT INTO platform_assistant_commits\b/iu.test(this.sql)) {
        const beforeCommit = controls.beforePlatformCommit;
        controls.beforePlatformCommit = null;
        beforeCommit();
      }
      if(controls.beforeDeletionClaim&&/^\s*INSERT INTO organization_deletion_jobs\b/iu.test(this.sql)){
        const beforeClaim=controls.beforeDeletionClaim;
        controls.beforeDeletionClaim=null;
        beforeClaim();
      }
      if (controls.failPlatformPrivacyErase && /^\s*UPDATE platform_assistant_private_content SET content='',redacted_at=\?/iu.test(this.sql)) {
        controls.failPlatformPrivacyErase = false;
        throw new Error("injected_platform_privacy_erasure_failure");
      }
      if (controls.forbidCreatorContentReads && /\b(?:FROM|JOIN|UPDATE|INTO)\s+(?:events|event_private_payloads|private_content|project_event_scopes|document_jobs)\b/iu.test(this.sql)) {
        throw new Error("platform_assistant_read_creator_content");
      }
      if (controls.skipAssistantTaskClaimOnce && /^\s*UPDATE assistant_specialist_tasks SET status='running'/iu.test(this.sql)) {
        controls.skipAssistantTaskClaimOnce = false;
        return { results: [], success: true, meta: { changes: 0 } };
      }
      try {
        const statement = sqlite.prepare(this.sql);
        if (kind === "first") return statement.get(...this.values) ?? null;
        if (kind === "all") return { results: statement.all(...this.values), success: true, meta: { changes: 0 } };
        return { results: [], success: true, meta: { changes: Number(statement.run(...this.values).changes ?? 0) } };
      } catch (error) {
        controls.lastDatabaseError = error instanceof Error ? error.message : String(error);
        throw error;
      }
    }
    async first() {
      const authoringState=/^\s*SELECT saved.content AS preview_content,receipt.result_json AS receipt_result_json/iu.test(this.sql);
      if(authoringState&&controls.beforeAuthoringStateRead){const callback=controls.beforeAuthoringStateRead;controls.beforeAuthoringStateRead=null;await callback();}
      const result=this.execute("first");
      if(authoringState&&result?.preview_content&&controls.afterAuthoringPreviewRead){
        const callback=controls.afterAuthoringPreviewRead;controls.afterAuthoringPreviewRead=null;await callback();
      }
      return result;
    }
    async all() { return this.execute("all"); }
    async run() {
      if(controls.beforeAdaptiveInsert&&/^\s*INSERT INTO document_jobs/iu.test(this.sql)&&this.values.includes("structure_adaptive")){
        const callback=controls.beforeAdaptiveInsert;controls.beforeAdaptiveInsert=null;await callback();
      }
      const result=this.execute("run");
      if(controls.afterAdaptiveCostClaim&&/^\s*UPDATE cost_budget_reservations SET status='executing'/iu.test(this.sql)&&Number(result.meta.changes)===1){
        const reservation=sqlite.prepare("SELECT * FROM cost_budget_reservations WHERE reservation_id=?").get(this.values[1]);
        if(reservation?.operation==="adaptive-structure"){const callback=controls.afterAdaptiveCostClaim;controls.afterAdaptiveCostClaim=null;await callback(reservation);}
      }
      if(controls.afterAuthoringClaim&&/^\s*UPDATE private_content SET content=json_set\(content,'\$\.state','applying'/iu.test(this.sql)){
        const callback=controls.afterAuthoringClaim;controls.afterAuthoringClaim=null;await callback();
      }
      return result;
    }
  }
  return {
    sqlite,
    controls,
    DB: {
      prepare(sql) { return new Statement(sql); },
      async batch(statements) {
        sqlite.exec("BEGIN");
        try {
          const results = statements.map((statement) => statement.execute(/^\s*(?:SELECT|WITH)/iu.test(statement.sql) ? "all" : "run"));
          sqlite.exec("COMMIT");
          return results;
        } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
      },
    },
  };
}

async function fixture({ enabled = true, actions = false, provider = false, models, solUsers } = {}) {
  const db = database();
  const background = [];
  const env = {
    DB: db.DB,
    ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
    MEDIA: {},
    ...(enabled ? { FORMA_ASSISTANT_INTERNAL_USER_IDS: "dev-local-creative,assistant-owner,assistant-viewer" } : {}),
    ...(actions ? { FORMA_ASSISTANT_ACTION_USER_IDS: "dev-local-creative,assistant-owner,assistant-viewer" } : {}),
    ...(provider ? { OPENAI_API_KEY: "fixture-provider-key", FORMA_ASSISTANT_PROVIDER_USER_IDS: "dev-local-creative,assistant-owner,assistant-viewer" } : {}),
    ...(models ? { FORMA_ASSISTANT_ALLOWED_MODELS: models } : {}),
    ...(solUsers ? { FORMA_ASSISTANT_SOL_USER_IDS: solUsers } : {}),
  };
  const context = { waitUntil(promise) { background.push(promise); } };
  const request = (path, init) => worker.fetch(new Request(`http://localhost${path}`, init), env, context);
  const approvedContextRequest=async(path,init)=>{
    const body=JSON.parse(init.body),quoted=await request(path,{...init,body:JSON.stringify({...body,action:"quote"})});
    if(!quoted.ok)return quoted;
    const {quote}=await quoted.json();
    return request(path,{...init,body:JSON.stringify({...body,action:"execute",executionId:quote.executionId,approvedBindingHash:quote.bindingHash})});
  };
  assert.equal((await request("/api/session")).status, 200);
  db.sqlite.prepare("UPDATE users SET consent_version=?").run("pilot-2026-08-10");
  assert.equal((await request("/api/events?after=0&limit=2000&content=0")).status, 200);
  const drainBackground = async () => {
    while (background.length) await Promise.all(background.splice(0));
  };
  return { ...db, env, request, approvedContextRequest, background, drainBackground };
}

const json = (body, headers = {}) => ({ method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) });
const endpoint = (route = "/document/doc-atmosphere", project = "project-atmosphere") => `/api/assistant?route=${encodeURIComponent(route)}${project ? `&projectId=${encodeURIComponent(project)}` : ""}`;
const proposalEndpoint = (id, action = "accept", route = "/document/doc-atmosphere", project = "project-atmosphere") =>
  endpoint(route, project).replace("/api/assistant?", `/api/assistant/proposals/${encodeURIComponent(id)}/${action}?`);
const taskEndpoint = (id, action, route = "/document/doc-atmosphere", project = "project-atmosphere") =>
  endpoint(route, project).replace("/api/assistant?", `/api/assistant/tasks/${encodeURIComponent(id)}/${action}?`);
const platformEndpoint = (route) => `/api/platform/assistant?route=${encodeURIComponent(route)}`;

async function platformHeaders(state, audience, identity = {}) {
  const response = await state.request(`/api/session?audience=${encodeURIComponent(audience)}`, { headers: identity });
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const session = await response.json();
  return { ...identity, "x-forma-assistant-audience": audience, "x-forma-platform-permission-epoch": session.permissionEpoch };
}

async function platformSpecialist(state, userId, grants) {
  const identity = { "oai-authenticated-user-id": userId, "oai-authenticated-user-email": `${userId}@example.test` };
  assert.equal((await state.request("/api/session", { headers: identity })).status, 200);
  state.sqlite.prepare("UPDATE users SET consent_version=? WHERE user_id=?").run("pilot-2026-08-10", userId);
  state.env.FORMA_ASSISTANT_INTERNAL_USER_IDS += `,${userId}`;
  const now = new Date().toISOString();
  const insert = state.sqlite.prepare("INSERT INTO capability_grants(grant_id,user_id,capability,scope_type,organization_id,project_access_id,project_id,status,granted_by_user_id,created_at,updated_at,expires_at,revoked_at) VALUES(?,?,?,?,NULL,NULL,NULL,'active',?,?,?,NULL,NULL)");
  for (const capability of grants) {
    const scope = capability.startsWith("design.") || capability.startsWith("evaluation.synthetic.") ? "synthetic" : "platform";
    insert.run(crypto.randomUUID(), userId, capability, scope, "dev-local-creative", now, now);
  }
  return identity;
}

function appendFixtureEvents(sqlite, stream, entries) {
  let sequence = Number(sqlite.prepare("SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?").get(stream).head);
  const now = new Date().toISOString();
  const insert = sqlite.prepare("INSERT INTO events(event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,causation_id,compensates_event_id,schema_version,type,payload) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)");
  for (const [type, payload] of entries) insert.run(crypto.randomUUID(), stream, ++sequence, now, now, "user", "assistant-semantic-regression", crypto.randomUUID(), null, null, 1, type, JSON.stringify(payload));
}

async function sharedProjectFixture(options = {}) {
  const state = await fixture(options);
  const owner = { "oai-authenticated-user-id": "assistant-owner", "oai-authenticated-user-email": "assistant-owner@example.test" };
  const viewer = { "oai-authenticated-user-id": "assistant-viewer", "oai-authenticated-user-email": "assistant-viewer@example.test" };
  for (const identity of [owner, viewer]) {
    assert.equal((await state.request("/api/session", { headers: identity })).status, 200);
    state.sqlite.prepare("UPDATE users SET consent_version=? WHERE user_id=?").run("pilot-2026-08-10", identity["oai-authenticated-user-id"]);
  }
  state.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id=?").run("assistant-viewer");
  assert.equal((await state.request("/api/events?after=0&limit=2000&content=0", { headers: owner })).status, 200);
  if (options.legacyConversation) {
    const now = new Date().toISOString();
    const expires = new Date(Date.now() + 86_400_000).toISOString();
    const stream = "creative:assistant-owner";
    const turn = crypto.randomUUID();
    const correlation = crypto.randomUUID();
    const userContent = crypto.randomUUID();
    const assistantContent = crypto.randomUUID();
    const insertContent = state.sqlite.prepare("INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at) VALUES(?,?,?,?,?,?,NULL)");
    insertContent.run(userContent, "assistant-owner", "chat-user", "LEGACY PERSONAL CREATIVE QUESTION", now, expires);
    insertContent.run(assistantContent, "assistant-owner", "chat-assistant", "LEGACY PERSONAL CREATIVE ANSWER", now, expires);
    const insertEvent = state.sqlite.prepare("INSERT INTO events(event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,causation_id,compensates_event_id,schema_version,type,payload) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)");
    let sequence = Number(state.sqlite.prepare("SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?").get(stream).head);
    const authored = crypto.randomUUID();
    insertEvent.run(authored, stream, ++sequence, now, now, "user:assistant-owner", "web:chat", correlation, null, null, 1, "ChatMessageSent",
      JSON.stringify({ project_id: "project-atmosphere", document_id: "doc-atmosphere", actor_user_id: "assistant-owner", turn_id: turn, content_ref: userContent }));
    insertEvent.run(crypto.randomUUID(), stream, ++sequence, now, now, "model:forma-chat", "web:chat", correlation, authored, null, 1, "AssistantReasoned",
      JSON.stringify({ operation: "creative-chat", project_id: "project-atmosphere", document_id: "doc-atmosphere", actor_user_id: "assistant-owner", turn_id: turn, content_ref: assistantContent }));
  }
  const organizationResponse = await state.request("/api/workspaces", json({ name: "Assistant organization" }, owner));
  assert.equal(organizationResponse.status, 201);
  const organizationId = (await organizationResponse.json()).organizationId;
  const projectResponse = await state.request(`/api/workspaces/${organizationId}/projects`, json({ projectId: "project-atmosphere" }, owner));
  assert.equal(projectResponse.status, 201, JSON.stringify(await projectResponse.clone().json()));
  const projectAccessId = (await projectResponse.json()).projectAccessId;
  const invited = await state.request(`/api/workspaces/${organizationId}/members`, json({ email: "assistant-viewer@example.test", role: "member" }, owner));
  assert.equal(invited.status, 201);
  const invitation = await invited.json();
  const invitationToken = new URL(invitation.invitationUrl).searchParams.get("token");
  assert.equal((await state.request(`/api/workspaces/${organizationId}/invitations/${invitation.invitationId}/accept`, json({ token: invitationToken }, viewer))).status, 200);
  assert.equal((await state.request(`/api/workspaces/${organizationId}/projects/${projectAccessId}/members`, json({ userId: "assistant-viewer", role: "viewer" }, owner))).status, 201);
  async function open(headers) {
    const response = await state.request(`/api/workspaces/${organizationId}/projects/${projectAccessId}/context`, { method: "POST", headers });
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    return { ...headers, cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "" };
  }
  return { ...state, owner: await open(owner), viewer: await open(viewer), organizationId, projectAccessId };
}

const adaptiveRegressionRequest = {
  projectId: "project-atmosphere", documentId: "doc-atmosphere", canvasId: null,
  sourceSurface: "adaptive", projectScope: false, locale: "en", prompt: "Plan my next move.",
};
async function adaptiveRegressionFixture(shared = false) {
  const state = shared ? await sharedProjectFixture({ provider: true }) : await fixture({ provider: true });
  const originalFetch = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://api.openai.com/v1/responses"); assert.equal(init.method, "POST");
    const request = JSON.parse(init.body); calls.push(request);
    return Response.json({ id: "adaptive-regression-provider-response", model: request.model,
      output_text: JSON.stringify({ interpretation: "PRIVATE_ADAPTIVE_REGRESSION_PLAN",
        active_decision: { type: "subject", label: "Subject", prompt: "Choose", why: "Focus" },
        suggested_blocks: Array.from({ length: 2 }, () => ({ type: "subject", subtype: "Person", label: "Subject", instruction: "Choose", reason: "Focus", relationship_to: "" })), hidden_until_later: [] }),
      usage: { input_tokens: 80, output_tokens: 20, total_tokens: 100 } });
  };
  return { ...state, adaptiveCalls: calls, async closeAdaptiveRegression() { try { await state.drainBackground(); } finally { globalThis.fetch = originalFetch; } } };
}
async function quoteAdaptiveRegression(state) {
  const response = await state.request("/api/document-jobs/adaptive", json({ ...adaptiveRegressionRequest, action: "quote" }, state.owner ?? {}));
  const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body));
  assert.ok(body.quote?.executionId); assert.match(body.quote.bindingHash, /^[a-f0-9]{64}$/u); return body.quote;
}
async function executeAdaptiveRegression(state, quote) {
  const response = await state.request("/api/document-jobs/adaptive", json({ ...adaptiveRegressionRequest, action: "execute", executionId: quote.executionId, approvedBindingHash: quote.bindingHash }, state.owner ?? {}));
  assert.equal(response.ok, true, JSON.stringify(await response.clone().json())); await state.drainBackground();
  return state.sqlite.prepare("SELECT * FROM document_jobs WHERE job_id=?").get(quote.executionId);
}
function retrieveAdaptiveRegression(state, quote) {
  return state.request("/api/document-jobs/adaptive", json({ ...adaptiveRegressionRequest, action: "retrieve", executionId: quote.executionId, approvedBindingHash: quote.bindingHash }, state.owner ?? {}));
}
// R15: reuse the actual SQL-boundary zero-POST regressions; no live provider or ledger is involved.

for(const phase of["released","not-reserved"])test("adaptive no-hold receipt R15 worker: "+phase+" native zero-POST receipt is not-incurred and remains unchanged by reads",{timeout:15000},async()=>{
 const state=await fixture({provider:true}),originalFetch=globalThis.fetch;let calls=0,restore,gate,heldBody;
 try{
  state.sqlite.prepare("UPDATE users SET role='admin' WHERE user_id='dev-local-creative'").run();
  globalThis.fetch=async()=>{calls++;throw new Error("This known-unused fixture must never contact a provider");};
  const quote=await quoteAdaptiveConsent(state),path="/api/document-jobs/"+quote.executionId;
  const request={action:"resume",executionId:quote.executionId,projectId:adaptiveConsentBody.projectId,documentId:adaptiveConsentBody.documentId,canvasId:null};
  if(phase==="released"){
   restore=interceptConsequentialDb(state,"run",/^\s*UPDATE consequential_execution_steps SET status='submitting'/u,async()=>{
    const stopped=await state.request(path+"/force-fail",json({})),stop=await stopped.json();
    assert.equal(stopped.status,200);assert.deepEqual(stop.budget,{reservationStatus:"retained",billingStatus:"pending"});
    const resumed=await state.request("/api/document-jobs/adaptive",json(request));heldBody=await resumed.json();
    assert.equal(resumed.status,409);assert.equal(heldBody.quote.status,"uncertain");
    assert.deepEqual(heldBody.job.result.planningStopBudget,{reservationStatus:"retained",billingStatus:"pending"});
    assert.equal(calls,0);
   },"after");
  }else gate=gateConsequentialDb(state,"run",/^\s*UPDATE consequential_execution_steps SET status='reserved'/u);
  const accepted=await executeAdaptiveConsent(state,quote);assert.equal(accepted.status,202);
  if(gate){
   await gate.entered;
   const stopped=await state.request(path+"/force-fail",json({})),stop=await stopped.json();
   assert.equal(stopped.status,200);assert.deepEqual(stop.budget,{reservationStatus:"not-reserved",billingStatus:"not-incurred"});
   gate.release();
  }
  await state.drainBackground();restore?.();restore=null;gate?.restore();gate=null;
  const snapshot=consequentialReceipt(state,quote.executionId);
  assert.equal(snapshot.execution.status,"failed");assert.equal(snapshot.steps[0].status,"not-submitted");
  assert.deepEqual(snapshot.balances,{tokens:{used:0,reserved:0},cost:{used:0,reserved:0}});
  const detail=await state.request(path+"?inspection=1"),detailBody=await detail.json();
  assert.equal(detail.status,200);assert.equal(detailBody.job.status,"failed");
  assert.deepEqual(detailBody.job.result.planningStopBudget,{reservationStatus:phase,billingStatus:"not-incurred"});
  const resumed=await state.request("/api/document-jobs/adaptive",json(request)),body=await resumed.json();
  assert.equal(resumed.status,409);assert.equal(body.quote.status,"failed");assert.equal(body.job.status,"failed");
  assert.equal(body.job.result.planningReviewAvailable,true);
  assert.deepEqual(body.job.result.planningStopBudget,{reservationStatus:phase,billingStatus:"not-incurred"});
  assert.equal(body.billingStatus,"settled");
  assert.deepEqual(consequentialReceipt(state,quote.executionId),snapshot);
  assert.equal(calls,0);
 }finally{restore?.();gate?.release();gate?.restore();await state.drainBackground();globalThis.fetch=originalFetch;}
});

test("adaptive no-hold receipt R15 worker: known non-submission can still have genuine retained reservations pending release", {timeout: 15000}, async () => {
  const state = await fixture({provider: true}), originalFetch = globalThis.fetch;
  let gate, restore, calls = 0, inspected = 0;
  try {
    state.sqlite.prepare("UPDATE users SET role='admin' WHERE user_id='dev-local-creative'").run();
    globalThis.fetch = async () => {calls++; throw new Error("Known-unused receipt fixture must never dispatch");};
    const quote = await quoteAdaptiveConsent(state), path = "/api/document-jobs/" + quote.executionId;
    gate = gateConsequentialDb(state, "run", /^\s*UPDATE consequential_execution_steps SET status='submitting'/u);
    const accepted = await executeAdaptiveConsent(state, quote);
    assert.equal(accepted.status, 202);
    await gate.entered;
    restore = interceptConsequentialDb(state, "batch", /^\s*UPDATE budget_reservations SET used_tokens=/u, async () => {
      inspected++;
      const before = consequentialReceipt(state, quote.executionId);
      assert.equal(before.steps[0].status, "not-submitted");
      assert.equal(before.tokens[0].status, "active");
      assert.ok(["active", "executing"].includes(before.cost[0].status));
      assert.ok(before.balances.tokens.reserved > 0);
      assert.ok(before.balances.cost.reserved > 0);
      const response = await state.request(path + "?inspection=1"), body = await response.json();
      assert.equal(response.status, 200);
      assert.deepEqual(body.job.result.planningStopBudget, {reservationStatus: "retained", billingStatus: "not-incurred"});
      assert.deepEqual(consequentialReceipt(state, quote.executionId), before,
        "Read-only inspection must not finish the pending release on the reviewer's behalf");
      assert.equal(calls, 0);
    });
    const stopped = await state.request(path + "/force-fail", json({})), stop = await stopped.json();
    assert.equal(stopped.status, 200);
    assert.deepEqual(stop.budget, {reservationStatus: "released", billingStatus: "not-incurred"});
    restore(); restore = null;
    gate.release();
    await state.drainBackground();
    assert.equal(inspected, 1);
    assert.equal(calls, 0);
    assert.deepEqual(consequentialBalances(state), {tokens: {used: 0, reserved: 0}, cost: {used: 0, reserved: 0}});
  } finally {
    restore?.();
    gate?.release();
    gate?.restore();
    await state.drainBackground();
    globalThis.fetch = originalFetch;
  }
});

// R14 real routed wire evidence: capture the old uncertain receipt before
// the original already-in-flight provider response settles. No second POST.
for (const force of [false, true]) {
  test("adaptive terminal receipt order R14 worker: " + (force ? "failed" : "canceled") + " held409 and later settled409 belong to one original request", {timeout: 15000}, async () => {
    const state = await fixture({provider: true}), originalFetch = globalThis.fetch;
    const entered = Promise.withResolvers(), released = Promise.withResolvers();
    let calls = 0;
    try {
      if (force) state.sqlite.prepare("UPDATE users SET role='admin' WHERE user_id='dev-local-creative'").run();
      const quote = await quoteAdaptiveConsent(state);
      globalThis.fetch = async (url, init) => {
        assert.equal(String(url), "https://api.openai.com/v1/responses");
        assert.equal(init.method, "POST");
        calls++;
        entered.resolve();
        await released.promise;
        return adaptiveFixtureResponse(JSON.parse(init.body), {outputText: "{"});
      };
      const accepted = await executeAdaptiveConsent(state, quote);
      assert.equal(accepted.status, 202);
      await entered.promise;
      const path = "/api/document-jobs/" + quote.executionId, status = force ? "failed" : "canceled";
      const stopped = await state.request(path + (force ? "/force-fail" : "/cancel"), json({}));
      const stop = await stopped.json();
      assert.equal(stopped.status, 200);
      assert.equal(stop.job.status, status);
      assert.deepEqual(stop.budget, {reservationStatus: "retained", billingStatus: "pending"});
      const request = {action: "resume", executionId: quote.executionId,
        projectId: adaptiveConsentBody.projectId, documentId: adaptiveConsentBody.documentId, canvasId: null};
      const older = await state.request("/api/document-jobs/adaptive", json(request)), oldBody = await older.json();
      assert.equal(older.status, 409);
      assert.equal(oldBody.error, force ? "adaptive_force_failed" : "adaptive_canceled");
      assert.equal(oldBody.executionId, quote.executionId);
      assert.equal(oldBody.quote.status, "uncertain");
      assert.equal(oldBody.billingStatus, "pending");
      assert.equal(oldBody.job.status, status);
      assert.equal(oldBody.job.result.planningReviewAvailable, true);
      assert.deepEqual(oldBody.job.result.planningStopBudget, {reservationStatus: "retained", billingStatus: "pending"});
      released.resolve();
      await state.drainBackground();
      const settled = consequentialReceipt(state, quote.executionId);
      assert.equal(settled.execution.result_ref, null, "Paid malformed output is not a completed plan");
      assert.equal(settled.steps[0].status, "settled");
      assert.deepEqual(settled.balances, {tokens: {used: 1300, reserved: 0}, cost: {used: 5600, reserved: 0}});
      const inspected = await state.request(path + "?inspection=1"), detail = await inspected.json();
      assert.equal(inspected.status, 200);
      assert.equal(detail.job.status, status);
      assert.deepEqual(detail.job.result.planningStopBudget, {reservationStatus: "settled", billingStatus: "settled"});
      const newer = await state.request("/api/document-jobs/adaptive", json(request)), newBody = await newer.json();
      assert.equal(newer.status, 409);
      assert.equal(newBody.executionId, oldBody.executionId);
      assert.equal(newBody.quote.bindingHash, oldBody.quote.bindingHash);
      assert.equal(newBody.quote.status, "failed");
      assert.equal(newBody.billingStatus, "settled");
      assert.equal(newBody.job.status, status);
      assert.deepEqual(newBody.job.result.planningStopBudget, {reservationStatus: "settled", billingStatus: "settled"});
      assert.deepEqual(consequentialReceipt(state, quote.executionId), settled);
      assert.deepEqual(adaptiveLedgerCounts(state), {token: 1, cost: 1});
      assert.equal(calls, 1);
    } finally {
      released.resolve();
      await state.drainBackground();
      globalThis.fetch = originalFetch;
    }
  });
}

// Real routed source/receipt shape behind the R13 host ordering regressions.
// One in-memory mocked provider response lacks usage; original-ID reads must
// expose the retained disclosure without inferring zero charge or buying again.
for (const shared of [false, true]) {
  test("adaptive uncertain receipt certification R13 worker: " + (shared ? "shared" : "personal") + " original 409 has current private proof and keeps the original held ledgers", {timeout: 15000}, async () => {
    const state = await adaptiveRegressionFixture(shared), mockFetch = globalThis.fetch;
    try {
      globalThis.fetch = async (...args) => {
        const response = await mockFetch(...args), body = await response.json();
        delete body.usage;
        return Response.json(body);
      };
      const quote = await quoteAdaptiveRegression(state);
      const job = await executeAdaptiveRegression(state, quote);
      assert.equal(job.status, "failed");
      assert.equal(state.sqlite.prepare("SELECT status FROM consequential_executions WHERE execution_id=?").get(quote.executionId).status, "uncertain");
      const before = adaptiveReentryFinancialState(state);
      const response = await state.request("/api/document-jobs/adaptive", json(adaptiveReentryResumeBody(quote.executionId), state.owner ?? {}));
      const body = await response.json();
      assert.equal(response.status, 409, JSON.stringify(body));
      assert.equal(body.error, "adaptive_provider_usage_unverified");
      assert.equal(body.executionId, quote.executionId);
      assert.equal(body.bindingHash, quote.bindingHash);
      assert.equal(body.requestKey, body.planningRequest.requestKey);
      assert.equal(body.planningRequest.prompt, adaptiveRegressionRequest.prompt);
      assert.equal(body.planningRequest.documentId, adaptiveRegressionRequest.documentId);
      assert.equal(body.quote.executionId, quote.executionId);
      assert.equal(body.quote.bindingHash, quote.bindingHash);
      assert.equal(body.quote.status, "uncertain");
      assert.deepEqual(body.quote.privateInput, quote.privateInput);
      assert.equal(body.job.jobId, quote.executionId);
      assert.equal(body.job.planningExecutionId, quote.executionId);
      assert.equal(body.job.requestKey, body.requestKey);
      assert.equal(body.job.status, "failed");
      assert.equal(body.job.result.planningReviewAvailable, true);
      assert.notEqual(body.job.result.resultUnavailable, true);
      assert.deepEqual(body.job.result.planningStopBudget, {reservationStatus: "retained", billingStatus: "pending"});
      assert.equal(body.billingStatus, "pending");
      assert.equal(body.noAutomaticRetry, true);
      assert.equal(state.adaptiveCalls.length, 1);
      assert.deepEqual(adaptiveReentryFinancialState(state), before);
    } finally {
      await state.closeAdaptiveRegression();
    }
  });
}

for(const shared of[false,true])for(const withdrawn of[false,true])test(`adaptive pending certification R4: ${shared?"shared":"personal"} pending review is ${withdrawn?"withdrawn only after confirmed private erasure":"readable before any generated structure exists"}`,async()=>{
  const state=await adaptiveRegressionFixture(shared),mockFetch=globalThis.fetch,entered=Promise.withResolvers(),release=Promise.withResolvers();
  globalThis.fetch=async(...args)=>{entered.resolve();await release.promise;return mockFetch(...args);};
  try{
    const quote=await quoteAdaptiveRegression(state);
    const executed=await state.request("/api/document-jobs/adaptive",json({...adaptiveRegressionRequest,action:"execute",executionId:quote.executionId,approvedBindingHash:quote.bindingHash},state.owner??{}));
    assert.equal(executed.status,202,JSON.stringify(await executed.clone().json()));await entered.promise;
    const execution=await executed.json();assert.equal(execution.job.result.planningReviewAvailable,true);assert.equal(execution.job.result.structure,undefined);
    if(withdrawn){const reference=state.sqlite.prepare("SELECT consent_ref FROM consequential_executions WHERE execution_id=?").get(quote.executionId).consent_ref;state.sqlite.prepare("UPDATE private_content SET content='',redacted_at=? WHERE content_id=?").run(new Date().toISOString(),reference);}
    const before=adaptiveReentryFinancialState(state);
    for(const url of["/api/document-jobs/"+quote.executionId+"?inspection=1","/api/document-jobs"]){
      const response=await state.request(url,{headers:state.owner??{}}),body=await response.json();assert.equal(response.status,200,JSON.stringify(body));
      const job=body.job??body.jobs.find(job=>job.jobId===quote.executionId);assert.ok(job);assert.equal(job.result.planningReviewAvailable,!withdrawn);assert.equal(job.result.structure,undefined);assert.equal(job.result.intent,undefined);assert.equal(job.result.quote,undefined);assert.ok(["queued","running"].includes(job.status));
    }
    const resumed=await state.request("/api/document-jobs/adaptive",json(adaptiveReentryResumeBody(quote.executionId),state.owner??{})),body=await resumed.json();
    if(withdrawn){assert.equal(resumed.status,404);assert.equal(body.error,"adaptive_execution_unavailable");}
    else{assert.equal(resumed.status,202);assert.equal(body.job.result.planningReviewAvailable,true);assert.equal(body.quote.executionId,quote.executionId);assert.equal(body.planningRequest.prompt,adaptiveRegressionRequest.prompt);assert.equal(body.job.result.structure,undefined);}
    assert.deepEqual(adaptiveReentryFinancialState(state),before);assert.equal(state.adaptiveCalls.length,0,"The one mocked request is still pending; reads do not start another");
  }finally{release.resolve();await state.closeAdaptiveRegression();}
});
/** Mutates only the in-memory fixture at the actual SQL seam. */
function interceptAdaptiveRegressionSql(state, matches, method, before) {
  const originalPrepare = state.env.DB.prepare; let fired = false;
  state.env.DB.prepare = (sql) => {
    const statement = originalPrepare.call(state.env.DB, sql); if (!matches(sql, new Error().stack ?? "")) return statement;
    const bind = statement.bind.bind(statement);
    statement.bind = (...values) => { const bound = bind(...values), invoke = bound[method].bind(bound); bound[method] = async () => { if (!fired) { fired = true; await before(sql, values); } return invoke(); }; return bound; };
    return statement;
  };
  return { get fired() { return fired; }, restore() { state.env.DB.prepare = originalPrepare; } };
}
/** Legitimate crash window after raw receipt/usage, before final private materialization. */
function retainOnlyAdaptiveRawRegression(state, executionId) {
  const execution = state.sqlite.prepare("SELECT result_ref FROM consequential_executions WHERE execution_id=?").get(executionId); assert.ok(execution.result_ref);
  state.sqlite.prepare("UPDATE private_content SET content='',redacted_at=? WHERE content_id=?").run(new Date().toISOString(), execution.result_ref);
  state.sqlite.prepare("UPDATE consequential_executions SET result_ref=NULL,status='uncertain',error_code=NULL WHERE execution_id=?").run(executionId);
  state.sqlite.prepare("UPDATE document_jobs SET status='failed',result_json=json_remove(result_json,'$.structure','$.intent','$.quote') WHERE job_id=?").run(executionId);
  assert.ok(state.sqlite.prepare("SELECT json_extract(result_json,'$.adaptiveProviderReceipt.contentRef') AS ref FROM document_jobs WHERE job_id=?").get(executionId).ref);
}


// R13: use the actual routed free-quote producer for both output surfaces and
// custody modes. A complete returned request is independent proof for B; the
// client regression separately exercises the legacy omission of that field.
for(const shared of[false,true])for(const canvas of[false,true])for(const intent of["same-intent","different-intent"]){
  test("adaptive replacement wire R13: "+(shared?"shared":"personal")+" "+(canvas?"Canvas":"Document")+" "+intent+" carries an executable independent B request",{timeout:10000},async()=>{
    const state=await adaptiveRegressionFixture(shared);
    try{
      const {adaptiveRequestKey}=await import("../src/model/adaptive-request.ts");
      if(shared&&canvas){
        // Reuse the existing shared-Canvas fixture's synthetic governance
        // readiness. Do not promote the owner or widen scoped permissions.
        const {IMAGE_ADAPTER_V52_EVALUATION_EVIDENCE:evidence}=await import("../worker/image-adapter-evaluation-evidence.ts");
        const now=new Date().toISOString(),approval=state.sqlite.prepare("INSERT INTO canvas_governance_requirements(requirement_id,status,evidence_ref,details_json,updated_at) VALUES(?,?,?,?,?)");
        approval.run("trust_safety","approved","fixture/trust-safety","{}",now);
        approval.run("counsel","approved","fixture/counsel","{}",now);
        approval.run("second_image_adapter","approved",evidence.evaluationRef,JSON.stringify({
          adapter_id:evidence.adapterId,contract_version:evidence.adapterVersion,corpus_version:evidence.corpusVersion,
          evaluation_ref:evidence.evaluationRef,evaluation_passed:true,
        }),now);
        const context=await state.request("/api/workspaces/"+state.organizationId+"/projects/"+state.projectAccessId+"/context",{method:"POST",headers:state.owner});
        assert.equal(context.status,200);state.owner={...state.owner,cookie:context.headers.get("set-cookie")?.split(";")[0]??""};
      }
      const ownerId=state.owner?.["oai-authenticated-user-id"]??"dev-local-creative";
      const streamId="creative:"+ownerId,canvasId=canvas?"replacement-intent-board-r13":null;
      if(canvas)appendFixtureEvents(state.sqlite,streamId,[["CanvasCreated",{
        canvas_id:canvasId,project_id:adaptiveRegressionRequest.projectId,
        name:"Replacement intent board",slug:"replacement-intent-board",
      }]]);
      const originalRequest={...adaptiveRegressionRequest,canvasId,sourceSurface:canvas?"canvas":"adaptive",projectScope:canvas};
      originalRequest.requestKey=await adaptiveRequestKey(originalRequest);
      const firstResponse=await state.request("/api/document-jobs/adaptive",json({...originalRequest,action:"quote"},state.owner??{}));
      const first=await firstResponse.json();assert.equal(firstResponse.status,200,JSON.stringify(first));
      const started=await state.request("/api/document-jobs/adaptive",json({...originalRequest,action:"execute",
        executionId:first.quote.executionId,approvedBindingHash:first.quote.bindingHash},state.owner??{}));
      assert.ok(started.ok,JSON.stringify(await started.clone().json()));await state.drainBackground();
      const originalRow=state.sqlite.prepare("SELECT * FROM document_jobs WHERE job_id=?").get(first.quote.executionId);
      assert.equal(originalRow.status,"completed");assert.equal(state.adaptiveCalls.length,1);
      if(intent==="same-intent")editAdaptiveReentrySource(state,originalRow.stream_id);
      const nextRequest={...originalRequest,prompt:intent==="same-intent"?originalRequest.prompt:"Create a genuinely different launch checklist R13."};
      nextRequest.requestKey=await adaptiveRequestKey(nextRequest);
      const financial=adaptiveReentryFinancialState(state);
      const quoted=await state.request("/api/document-jobs/adaptive",json({...nextRequest,action:"quote",
        ...(intent==="same-intent"?{replaceExecutionId:first.quote.executionId}:{})},state.owner??{}));
      const wire=await quoted.json();
      assert.equal(quoted.status,200,JSON.stringify(wire));assert.equal(wire.quote.status,"quoted");
      assert.equal(wire.quote.canExecute,true);assert.notEqual(wire.quote.executionId,first.quote.executionId);
      assert.deepEqual(wire.planningRequest,nextRequest,"A fresh free quote must return its independently prepared complete request");
      assert.equal(wire.quote.privateInput.requestKey,await adaptiveRequestKey(wire.planningRequest));
      assert.deepEqual(adaptiveReentryFinancialState(state),financial);assert.equal(state.adaptiveCalls.length,1);
      if(intent==="same-intent")assert.equal(wire.planningRequest.requestKey,originalRequest.requestKey);
      else assert.notEqual(wire.planningRequest.requestKey,originalRequest.requestKey);
      // Consume the server-returned B request rather than a private A capture.
      const accepted=await state.request("/api/document-jobs/adaptive",json({...wire.planningRequest,action:"execute",
        executionId:wire.quote.executionId,approvedBindingHash:wire.quote.bindingHash},state.owner??{}));
      const acceptance=await accepted.json();assert.ok(accepted.ok,JSON.stringify(acceptance));await state.drainBackground();
      assert.equal(state.sqlite.prepare("SELECT status FROM document_jobs WHERE job_id=?").get(wire.quote.executionId).status,"completed");
      assert.equal(state.adaptiveCalls.length,2,"Each separately approved plan dispatches exactly once");
      assert.ok(JSON.stringify(state.adaptiveCalls[1]).includes(nextRequest.prompt),"B dispatch retains its exact nonempty intent");
      const afterPaid=adaptiveReentryFinancialState(state);
      for(const [executionId,expected]of[[first.quote.executionId,originalRequest],[wire.quote.executionId,nextRequest]]){
        const response=await state.request("/api/document-jobs/adaptive",json({projectId:expected.projectId,
          documentId:expected.documentId,canvasId:expected.canvasId,action:"resume",executionId},state.owner??{}));
        const recovered=await response.json();assert.equal(response.status,200,JSON.stringify(recovered));
        assert.equal(recovered.quote.executionId,executionId);assert.deepEqual(recovered.planningRequest,expected);
      }
      assert.deepEqual(adaptiveReentryFinancialState(state),afterPaid);assert.equal(state.adaptiveCalls.length,2);
    }finally{await state.closeAdaptiveRegression();}
  });
}

// Routed re-entry regressions: reuse existing paid work after navigation or capability changes.
function adaptiveReentryFinancialState(state) {
  return {
    tokens: state.sqlite.prepare("SELECT reservation_id,owner_id,stream_id,correlation_id,operation,period,status,reserved_tokens,used_tokens FROM budget_reservations ORDER BY reservation_id").all(),
    costs: state.sqlite.prepare("SELECT reservation_id,owner_id,stream_id,correlation_id,operation,period,status,reserved_microusd,used_microusd FROM cost_budget_reservations ORDER BY reservation_id").all(),
    tokenCounters: state.sqlite.prepare("SELECT scope,scope_id,period,used_tokens,reserved_tokens,hard_limit_tokens FROM budget_counters ORDER BY scope,scope_id,period").all(),
    costCounters: state.sqlite.prepare("SELECT scope,scope_id,period,used_microusd,reserved_microusd,hard_limit_microusd FROM cost_budget_counters ORDER BY scope,scope_id,period").all(),
  };
}
function adaptiveReentryCounts(state) {
  return {
    jobs: state.sqlite.prepare("SELECT COUNT(*) AS n FROM document_jobs").get().n,
    executions: state.sqlite.prepare("SELECT COUNT(*) AS n FROM consequential_executions").get().n,
    calls: state.adaptiveCalls.length,
  };
}
function editAdaptiveReentrySource(state, streamId = "creative:dev-local-creative") {
  appendFixtureEvents(state.sqlite, streamId, [["BlockPropertyEdited", {
    project_id: adaptiveRegressionRequest.projectId, document_id: adaptiveRegressionRequest.documentId,
    block_id: "block-direction", property_path: "text", new_value: "A materially changed direction after the original paid plan.",
  }]]);
}
function adaptiveReentryResumeBody(executionId) {
  return {
    action: "resume", executionId, projectId: adaptiveRegressionRequest.projectId,
    documentId: adaptiveRegressionRequest.documentId, canvasId: null,
  };
}
function assertOriginalAdaptiveReentry(body, quote) {
  assert.equal(body.executionId, quote.executionId);
  assert.equal(body.quote.executionId, quote.executionId);
  assert.equal(body.quote.bindingHash, quote.bindingHash);
  assert.equal(body.quote.sourceHash, quote.sourceHash);
  assert.equal(body.quote.period, quote.period);
  assert.deepEqual(body.quote.models, quote.models);
  assert.deepEqual(body.quote.privateInput, quote.privateInput);
  assert.deepEqual(body.planningRequest, {
    ...adaptiveRegressionRequest, requestKey: quote.privateInput.requestKey,
  });
  assert.equal(body.structure.interpretation, "PRIVATE_ADAPTIVE_REGRESSION_PLAN");
  assert.equal(body.sourceStatus, "original-approved-source");
}
/** Use the actual membership/context routes; an explicit grant never widens a viewer's ceiling. */
async function adaptiveReentryMember(state) {
  const administrator = state.owner, { cookie: _cookie, ...identity } = state.viewer;
  const memberId = state.sqlite.prepare("SELECT membership_id FROM project_memberships WHERE project_access_id=? AND user_id=?")
    .get(state.projectAccessId, "assistant-viewer").membership_id;
  const url = "/api/workspaces/" + state.organizationId + "/projects/" + state.projectAccessId + "/members/" + memberId;
  const setRole = async (role) => {
    const changed = await state.request(url, { ...json({ role }, administrator), method: "PATCH" });
    assert.equal(changed.status, 200, JSON.stringify(await changed.clone().json()));
    const opened = await state.request("/api/workspaces/" + state.organizationId + "/projects/" + state.projectAccessId + "/context",
      { method: "POST", headers: identity });
    assert.equal(opened.status, 200, JSON.stringify(await opened.clone().json()));
    state.owner = { ...identity, cookie: opened.headers.get("set-cookie").split(";")[0] };
  };
  await setRole("editor");
  return { setRole, administrator };
}

test("adaptive personal reader R3: a previous creator with an unrelated viewer membership recovers the original plan without permission to replace it",{timeout:15_000},async()=>{
  const unrelated=await sharedProjectFixture({provider:false}),state=await adaptiveRegressionFixture();
  try{
    const quote=await quoteAdaptiveRegression(state);assert.equal((await executeAdaptiveRegression(state,quote)).status,"completed");editAdaptiveReentrySource(state);
    // All rows come from another real in-memory fixture. The personal plan stays
    // outside that organization's custody; only an unrelated viewer membership is added.
    for(const table of["users","organizations","organization_memberships","organization_projects","project_memberships"]){
      for(const row of unrelated.sqlite.prepare("SELECT * FROM "+table).all()){
        if(table==="users"&&row.user_id==="dev-local-creative")continue;
        const columns=Object.keys(row);state.sqlite.prepare("INSERT OR IGNORE INTO "+table+"("+columns.join(",")+") VALUES("+columns.map(()=>"?").join(",")+")").run(...columns.map(key=>row[key]));
      }
    }
    for(const table of["organization_memberships","project_memberships"]){
      const row=unrelated.sqlite.prepare("SELECT * FROM "+table+" WHERE user_id='assistant-viewer'").get();assert.ok(row);row.user_id="dev-local-creative";row.membership_id="personal-reader-"+table;
      const columns=Object.keys(row);state.sqlite.prepare("INSERT INTO "+table+"("+columns.join(",")+") VALUES("+columns.map(()=>"?").join(",")+")").run(...columns.map(key=>row[key]));
    }
    state.sqlite.prepare("UPDATE users SET role='viewer',updated_at=? WHERE user_id='dev-local-creative'").run(new Date().toISOString());
    const sessionResponse=await state.request("/api/session"),session=await sessionResponse.json();assert.equal(sessionResponse.status,200);assert.equal(session.user.role,"viewer");assert.equal(session.projectContext??null,null);assert.ok(session.capabilities.includes("project.read"));assert.ok(!session.capabilities.includes("project.author"));assert.ok(!session.capabilities.includes("project.output.request"));
    const financial=adaptiveReentryFinancialState(state),counts=adaptiveReentryCounts(state);
    for(const input of[adaptiveReentryResumeBody(quote.executionId),{...adaptiveRegressionRequest,action:"quote"}]){
      const response=await state.request("/api/document-jobs/adaptive",json(input)),body=await response.json();assert.equal(response.status,200,JSON.stringify(body));assertOriginalAdaptiveReentry(body,quote);assert.equal(body.quote.canPrepareNew,false,"Settled billing is not permission to create a new plan");assert.equal(body.quote.status,"completed","A completed receipt is retrieval, never a quoted purchase");
      if(input.action==="resume")assert.equal(body.job.jobId,quote.executionId);
      assert.deepEqual(adaptiveReentryFinancialState(state),financial);assert.deepEqual(adaptiveReentryCounts(state),counts);
    }
    const replacement=await state.request("/api/document-jobs/adaptive",json({...adaptiveRegressionRequest,action:"quote",replaceExecutionId:quote.executionId})),denied=await replacement.json();assert.equal(replacement.status,403,JSON.stringify(denied));assert.equal(denied.quote,undefined);assert.deepEqual(adaptiveReentryFinancialState(state),financial);assert.deepEqual(adaptiveReentryCounts(state),counts);assert.equal(state.adaptiveCalls.length,1,"Recovery and denied preparation cannot POST again");
  }finally{await state.closeAdaptiveRegression();await unrelated.drainBackground();}
});

test("adaptive reentry: changed source and unavailable model/key reopen the original paid plan before new preparation", async () => {
  const state = await adaptiveRegressionFixture();
  try {
    const quote = await quoteAdaptiveRegression(state);
    assert.equal((await executeAdaptiveRegression(state, quote)).status, "completed");
    editAdaptiveReentrySource(state);
    delete state.env.OPENAI_API_KEY; state.env.OPENAI_MODEL = "unpriced-reentry-model";
    const financial = adaptiveReentryFinancialState(state), counts = adaptiveReentryCounts(state);
    const response = await state.request("/api/document-jobs/adaptive", json({ ...adaptiveRegressionRequest, action: "quote" }));
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body)); assert.equal(body.reused, true);
    assertOriginalAdaptiveReentry(body, quote);
    assert.equal(body.quote.providerAvailable, false); assert.equal(body.quote.canExecute, false);
    assert.deepEqual(adaptiveReentryFinancialState(state), financial); assert.deepEqual(adaptiveReentryCounts(state), counts);
    const resumed = await state.request("/api/document-jobs/adaptive", json(adaptiveReentryResumeBody(quote.executionId)));
    const recovered = await resumed.json();
    assert.equal(resumed.status, 200, JSON.stringify(recovered)); assertOriginalAdaptiveReentry(recovered, quote);
    assert.equal(recovered.job.jobId, quote.executionId); assert.equal(recovered.job.status, "completed");
    assert.deepEqual(adaptiveReentryFinancialState(state), financial); assert.deepEqual(adaptiveReentryCounts(state), counts);
  } finally { await state.closeAdaptiveRegression(); }
});

test("adaptive reentry: Activity list/detail and hash-free resume let the current reader recover only their own paid document plan", async () => {
  const state = await adaptiveRegressionFixture(true);
  try {
    const otherActorQuote = await quoteAdaptiveRegression(state);
    assert.equal((await executeAdaptiveRegression(state, otherActorQuote)).status, "completed");
    const member = await adaptiveReentryMember(state), quote = await quoteAdaptiveRegression(state);
    assert.equal((await executeAdaptiveRegression(state, quote)).status, "completed");
    await member.setRole("viewer"); delete state.env.OPENAI_API_KEY;
    state.env.OPENAI_MODEL = "unpriced-reader-reentry-model";
    const financial = adaptiveReentryFinancialState(state), counts = adaptiveReentryCounts(state);
    for (const suffix of ["", "?document=" + adaptiveRegressionRequest.documentId, "?scope=active&document=" + adaptiveRegressionRequest.documentId]) {
      const listed = await state.request("/api/document-jobs" + suffix, { headers: state.owner }), body = await listed.json();
      assert.equal(listed.status, 200, JSON.stringify(body));
      assert.deepEqual(body.jobs.map((job) => job.jobId), [quote.executionId]);
      assert.equal(body.jobs[0].kind, "structure_adaptive"); assert.equal(body.jobs[0].canvasId ?? null, null);
      assert.equal(body.jobs[0].status, "completed");
      assert.equal(body.jobs[0].result.structure.interpretation, "PRIVATE_ADAPTIVE_REGRESSION_PLAN");
      assert.equal(JSON.stringify(body).includes("adaptiveProviderReceipt"), false);
    }
    const detail = await state.request("/api/document-jobs/" + quote.executionId, { headers: state.owner }), viewed = await detail.json();
    assert.equal(detail.status, 200, JSON.stringify(viewed)); assert.equal(viewed.job.jobId, quote.executionId);
    const resumeRequest = adaptiveReentryResumeBody(viewed.job.jobId);
    assert.equal(Object.hasOwn(resumeRequest, "approvedBindingHash"), false);
    assert.equal(Object.hasOwn(resumeRequest, "prompt"), false);
    const resumed = await state.request("/api/document-jobs/adaptive", json(resumeRequest, state.owner)), recovered = await resumed.json();
    assert.equal(resumed.status, 200, JSON.stringify(recovered)); assertOriginalAdaptiveReentry(recovered, quote);
    assert.equal(recovered.job.jobId, quote.executionId); assert.equal(recovered.job.status, "completed");
    assert.equal(recovered.quote.providerAvailable, false);
    const foreign = await state.request("/api/document-jobs/" + otherActorQuote.executionId, { headers: state.owner });
    assert.equal(foreign.status, 404); assert.doesNotMatch(await foreign.text(), /PRIVATE_ADAPTIVE_REGRESSION_PLAN/u);
    const foreignResume = await state.request("/api/document-jobs/adaptive", json(adaptiveReentryResumeBody(otherActorQuote.executionId), state.owner));
    assert.ok([403, 404].includes(foreignResume.status)); assert.doesNotMatch(await foreignResume.text(), /PRIVATE_ADAPTIVE_REGRESSION_PLAN/u);
    for (const action of ["run", "cancel"]) {
      const denied = await state.request("/api/document-jobs/" + quote.executionId + "/" + action, json({}, state.owner));
      assert.equal(denied.status, 403, "Read access must not grant " + action);
    }
    const fresh = await state.request("/api/document-jobs/adaptive", json({
      ...adaptiveRegressionRequest, action: "quote", prompt: "A genuinely new purchase, not my saved intent.",
    }, state.owner));
    assert.equal(fresh.status, 403, "Read access must not grant a new paid-planning preparation");
    assert.deepEqual(adaptiveReentryFinancialState(state), financial); assert.deepEqual(adaptiveReentryCounts(state), counts);
  } finally { await state.closeAdaptiveRegression(); }
});

for (const withdrawal of ["erased", "expired", "resource-detached", "retention-detached"]) {
  test("adaptive reentry: " + withdrawal + " paid consent is unavailable, never a replacement quote", async () => {
    const state = await adaptiveRegressionFixture(true);
    try {
      const quote = await quoteAdaptiveRegression(state);
      assert.equal((await executeAdaptiveRegression(state, quote)).status, "completed");
      editAdaptiveReentrySource(state, "creative:assistant-owner");
      const ref = state.sqlite.prepare("SELECT consent_ref FROM consequential_executions WHERE execution_id=?").get(quote.executionId).consent_ref;
      if (withdrawal === "erased") state.sqlite.prepare("UPDATE private_content SET content='',redacted_at=? WHERE content_id=?").run(new Date().toISOString(), ref);
      else if (withdrawal === "expired") state.sqlite.prepare("UPDATE private_content SET expires_at='2000-01-01T00:00:00.000Z' WHERE content_id=?").run(ref);
      else if (withdrawal === "resource-detached") assert.equal(Number(state.sqlite.prepare("DELETE FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=?").run(ref).changes), 1);
      else assert.equal(Number(state.sqlite.prepare("DELETE FROM private_content_retention_scopes WHERE content_id=?").run(ref).changes), 1);
      const financial = adaptiveReentryFinancialState(state), counts = adaptiveReentryCounts(state);
      for (const request of [
        { ...adaptiveRegressionRequest, action: "quote" },
        adaptiveReentryResumeBody(quote.executionId),
        { ...adaptiveRegressionRequest, action: "quote", replaceExecutionId: quote.executionId },
      ]) {
        const response = await state.request("/api/document-jobs/adaptive", json(request, state.owner)), body = await response.json();
        assert.ok([403, 404, 409, 410].includes(response.status), JSON.stringify(body));
        assert.equal(body.quote, undefined); assert.equal(body.structure, undefined); assert.equal(body.planningRequest, undefined);
        assert.equal(body.noAutomaticRetry, true);
        assert.doesNotMatch(JSON.stringify(body), /PRIVATE_ADAPTIVE_REGRESSION_PLAN/u);
        assert.deepEqual(adaptiveReentryFinancialState(state), financial); assert.deepEqual(adaptiveReentryCounts(state), counts);
      }
      if (withdrawal === "erased") assert.equal(state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(ref).content, "");
      if (withdrawal === "resource-detached") assert.equal(state.sqlite.prepare("SELECT 1 FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=?").get(ref), undefined);
      if (withdrawal === "retention-detached") assert.equal(state.sqlite.prepare("SELECT 1 FROM private_content_retention_scopes WHERE content_id=?").get(ref), undefined);
    } finally { await state.closeAdaptiveRegression(); }
  });
}


for(const withdrawal of["consent","result"])test("adaptive withdrawn preview R4: erased "+withdrawal+" makes the real replacement quote unavailable without new spend",async()=>{
  const state=await adaptiveRegressionFixture(true);
  try{
    const quote=await quoteAdaptiveRegression(state);
    assert.equal((await executeAdaptiveRegression(state,quote)).status,"completed");
    const original=await state.request("/api/document-jobs/adaptive",json(adaptiveReentryResumeBody(quote.executionId),state.owner)),visible=await original.json();
    assert.equal(original.status,200);assert.match(JSON.stringify(visible),/PRIVATE_ADAPTIVE_REGRESSION_PLAN/u);
    editAdaptiveReentrySource(state,"creative:assistant-owner");
    const refs=state.sqlite.prepare("SELECT consent_ref,result_ref FROM consequential_executions WHERE execution_id=?").get(quote.executionId),ref=withdrawal==="consent"?refs.consent_ref:refs.result_ref;
    assert.ok(ref);
    assert.equal(Number(state.sqlite.prepare("UPDATE private_content SET content='',redacted_at=? WHERE content_id=?").run(new Date().toISOString(),ref).changes),1);
    const financial=adaptiveReentryFinancialState(state),counts=adaptiveReentryCounts(state);
    const response=await state.request("/api/document-jobs/adaptive",json({...adaptiveRegressionRequest,action:"quote",replaceExecutionId:quote.executionId},state.owner)),body=await response.json();
    assert.equal(response.status,409);
    assert.deepEqual(body,{error:withdrawal==="consent"?"adaptive_existing_request_unavailable":"adaptive_result_unavailable",noAutomaticRetry:true});
    assert.doesNotMatch(JSON.stringify(body),/PRIVATE_ADAPTIVE_REGRESSION_PLAN/u);
    assert.deepEqual(adaptiveReentryFinancialState(state),financial);assert.deepEqual(adaptiveReentryCounts(state),counts);
    assert.equal(state.adaptiveCalls.length,1);
    assert.equal(state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(ref).content,"");
    assert.equal(state.sqlite.prepare("SELECT status FROM document_jobs WHERE job_id=?").get(quote.executionId).status,"completed","Private withdrawal must not rewrite the paid execution outcome");
  }finally{await state.closeAdaptiveRegression();}
});

test("adaptive reentry: an explicit replacement previews changed source only after settled completion and never dispatches", async () => {
  const state = await adaptiveRegressionFixture();
  try {
    const quote = await quoteAdaptiveRegression(state);
    assert.equal((await executeAdaptiveRegression(state, quote)).status, "completed");
    const financial = adaptiveReentryFinancialState(state), counts = adaptiveReentryCounts(state);
    const replacement = { ...adaptiveRegressionRequest, action: "quote", replaceExecutionId: quote.executionId };
    const unchanged = await state.request("/api/document-jobs/adaptive", json(replacement)), same = await unchanged.json();
    assert.equal(unchanged.status, 200, JSON.stringify(same)); assert.equal(same.quote.executionId, quote.executionId);
    assert.deepEqual(adaptiveReentryCounts(state), counts);
    editAdaptiveReentrySource(state);
    const reopened = await state.request("/api/document-jobs/adaptive", json({ ...adaptiveRegressionRequest, action: "quote" })), original = await reopened.json();
    assert.equal(reopened.status, 200, JSON.stringify(original)); assert.equal(original.quote.executionId, quote.executionId);
    const changed = await state.request("/api/document-jobs/adaptive", json(replacement)), next = await changed.json();
    assert.equal(changed.status, 200, JSON.stringify(next)); assert.equal(next.quote.status, "quoted");
    assert.notEqual(next.quote.executionId, quote.executionId); assert.notEqual(next.quote.sourceHash, quote.sourceHash);
    assert.equal(next.quote.privateInput.requestKey, quote.privateInput.requestKey);
    assert.equal(next.quote.canExecute, true); assert.equal(next.job, undefined);
    assert.equal(state.sqlite.prepare("SELECT status FROM consequential_execution_steps WHERE execution_id=?").get(next.quote.executionId).status, "quoted");
    assert.deepEqual(adaptiveReentryFinancialState(state), financial);
    assert.deepEqual(adaptiveReentryCounts(state), { ...counts, executions: counts.executions + 1 });
    const originalStillSaved = await state.request("/api/document-jobs/adaptive", json(adaptiveReentryResumeBody(quote.executionId)));
    const saved = await originalStillSaved.json(); assert.equal(originalStillSaved.status, 200); assertOriginalAdaptiveReentry(saved, quote);
    assert.deepEqual(adaptiveReentryFinancialState(state), financial);
    assert.equal(state.adaptiveCalls.length, 1);
  } finally { await state.closeAdaptiveRegression(); }
});

test("adaptive reentry: an unknown submitted request cannot be replaced even after source edits", async () => {
  const state = await adaptiveRegressionFixture();
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), "https://api.openai.com/v1/responses"); assert.equal(init.method, "POST");
      state.adaptiveCalls.push(JSON.parse(init.body)); throw new Error("Lost provider response after submission");
    };
    const quote = await quoteAdaptiveRegression(state);
    assert.equal((await executeAdaptiveRegression(state, quote)).status, "failed");
    assert.equal(state.sqlite.prepare("SELECT status FROM consequential_executions WHERE execution_id=?").get(quote.executionId).status, "uncertain");
    assert.equal(state.sqlite.prepare("SELECT status FROM consequential_execution_steps WHERE execution_id=?").get(quote.executionId).status, "uncertain");
    const financial = adaptiveReentryFinancialState(state), counts = adaptiveReentryCounts(state);
    assert.equal(financial.costs[0].status, "executing"); assert.ok(financial.costs[0].reserved_microusd > 0);
    editAdaptiveReentrySource(state); delete state.env.OPENAI_API_KEY; state.env.OPENAI_MODEL = "unpriced-unknown-reentry-model";
    const response = await state.request("/api/document-jobs/adaptive", json({
      ...adaptiveRegressionRequest, action: "quote", replaceExecutionId: quote.executionId,
    })), body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body)); assert.equal(body.reused, true);
    assert.equal(body.quote.executionId, quote.executionId); assert.equal(body.quote.bindingHash, quote.bindingHash);
    assert.equal(body.quote.status, "uncertain"); assert.equal(body.quote.canExecute, false);
    assert.deepEqual(body.planningRequest, { ...adaptiveRegressionRequest, requestKey: quote.privateInput.requestKey });
    const resumed = await state.request("/api/document-jobs/adaptive", json(adaptiveReentryResumeBody(quote.executionId))), recovered = await resumed.json();
    assert.equal(resumed.status, 409, JSON.stringify(recovered));
    assert.equal(recovered.executionId, quote.executionId); assert.equal(recovered.status, "uncertain");
    assert.equal(recovered.noAutomaticRetry, true); assert.equal(recovered.structure, undefined);
    assert.deepEqual(adaptiveReentryFinancialState(state), financial); assert.deepEqual(adaptiveReentryCounts(state), counts);
  } finally { await state.closeAdaptiveRegression(); }
});

for (const surface of ["resume", "activity-list", "activity-detail"]) {
  test("adaptive reentry: final-read session revocation withholds " + surface + " private planning evidence", async () => {
    const state = await adaptiveRegressionFixture(true); let intercept;
    try {
      const member = await adaptiveReentryMember(state), quote = await quoteAdaptiveRegression(state);
      assert.equal((await executeAdaptiveRegression(state, quote)).status, "completed");
      await member.setRole("viewer");
      const financial = adaptiveReentryFinancialState(state), counts = adaptiveReentryCounts(state);
      intercept = interceptAdaptiveRegressionSql(state, (sql, stack) => surface === "resume"
        ? sql.startsWith("SELECT 1 AS retained WHERE") && /^\s+at retrieve \(/mu.test(stack)
        : sql.startsWith("SELECT 1 WHERE") && sql.includes("project_context_sessions selected_session")
          && /^\s+at handleDocumentJobs \(/mu.test(stack), "first", () => {
        const revoked = state.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE principal_user_id=? AND project_access_id=? AND revoked_at IS NULL")
          .run(new Date().toISOString(), "assistant-viewer", state.projectAccessId);
        assert.ok(Number(revoked.changes) > 0);
      });
      const response = surface === "resume"
        ? await state.request("/api/document-jobs/adaptive", json(adaptiveReentryResumeBody(quote.executionId), state.owner))
        : await state.request("/api/document-jobs" + (surface === "activity-detail" ? "/" + quote.executionId : "?document=" + adaptiveRegressionRequest.documentId), { headers: state.owner });
      const body = await response.json(); assert.equal(intercept.fired, true, "The final HTTP-read proof must run");
      assert.ok([403, 404, 409, 410].includes(response.status), JSON.stringify(body));
      assert.doesNotMatch(JSON.stringify(body), /PRIVATE_ADAPTIVE_REGRESSION_PLAN/u);
      assert.equal(body.quote, undefined); assert.equal(body.planningRequest, undefined); assert.equal(body.structure, undefined);
      assert.equal(body.job, undefined); assert.equal(body.jobs, undefined);
      assert.deepEqual(adaptiveReentryFinancialState(state), financial); assert.deepEqual(adaptiveReentryCounts(state), counts);
    } finally { intercept?.restore(); await state.closeAdaptiveRegression(); }
  });
}
test("adaptive regression: a new free preview never reuses withdrawn private consent custody", async () => {
  for(const detached of ["resource","retention"]){
    const state=await adaptiveRegressionFixture(true);
    try{
      const original=await quoteAdaptiveRegression(state),ref=state.sqlite.prepare("SELECT consent_ref FROM consequential_executions WHERE execution_id=?").get(original.executionId).consent_ref;
      const removed=detached==="resource"?state.sqlite.prepare("DELETE FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=?").run(ref):state.sqlite.prepare("DELETE FROM private_content_retention_scopes WHERE content_id=?").run(ref);
      assert.equal(Number(removed.changes),1);assert.equal((await retrieveAdaptiveRegression(state,original)).status,404);
      const fresh=await quoteAdaptiveRegression(state);assert.notEqual(fresh.executionId,original.executionId);assert.equal(fresh.bindingHash,original.bindingHash);assert.equal(fresh.status,"quoted");
      assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM document_jobs").get().count,0);assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM budget_reservations").get().count,0);assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM cost_budget_reservations").get().count,0);assert.equal(state.adaptiveCalls.length,0);
    }finally{await state.closeAdaptiveRegression();}
  }
});
test("adaptive regression: an exact free preview survives zero budget and a closed pilot", async () => {
  for (const mode of ["budget", "pilot", "both"]) {
    const state = await adaptiveRegressionFixture(true);
    try {
      if (mode !== "pilot") state.sqlite.prepare("UPDATE budget_scope_policies SET token_limit=0,microusd_limit=0 WHERE organization_id=?").run(state.organizationId);
      if (mode !== "budget") {
        const now = new Date().toISOString();
        state.sqlite.prepare("INSERT INTO pilot_cohorts(cohort_id,organization_id,status,starts_at,ends_at,created_by_user_id,created_at,updated_at) VALUES(?,?,'closed',?,?,?,?,?)")
          .run("adaptive-free-preview-cohort", state.organizationId, new Date(Date.now() - 86_400_000).toISOString(), new Date(Date.now() - 60_000).toISOString(), "assistant-owner", now, now);
        state.sqlite.prepare("INSERT INTO pilot_participants(participant_id,cohort_id,organization_id,email_normalized,user_id,role,status,invited_by_user_id,created_at,revoked_at) VALUES(?,?,?,?,?,'member','active',?,?,NULL)")
          .run("adaptive-free-preview-member", "adaptive-free-preview-cohort", state.organizationId, "assistant-owner@example.test", "assistant-owner", "assistant-owner", now);
      }
      const quote = await quoteAdaptiveRegression(state);
      assert.equal(quote.canExecute, false, mode); assert.equal(quote.providerAvailable, true);
      assert.ok(quote.privateInput.providerRequest); assert.ok(quote.maximumMicrousd > 0);
      if (mode !== "pilot") { assert.equal(quote.budgetAvailable, false); assert.equal(quote.availableMicrousd, 0); }
      if (mode !== "budget") assert.ok(quote.unavailableReasons.includes("adaptive_pilot_denied"));
      for (const table of ["document_jobs", "budget_reservations", "cost_budget_reservations"]) {
        assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM " + table).get().count, 0, mode + "/" + table);
      }
      assert.equal(state.adaptiveCalls.length, 0);
    } finally { await state.closeAdaptiveRegression(); }
  }
});

test("adaptive regression: the original actor can recover a paid raw receipt as a reader next month without a provider or spend eligibility", async () => {
  const state = await adaptiveRegressionFixture(true), RealDate = globalThis.Date;
  try {
    const admin = state.owner, { cookie: _cookie, ...identity } = state.viewer;
    const memberId = state.sqlite.prepare("SELECT membership_id FROM project_memberships WHERE project_access_id=? AND user_id=?").get(state.projectAccessId, "assistant-viewer").membership_id;
    const memberUrl = "/api/workspaces/" + state.organizationId + "/projects/" + state.projectAccessId + "/members/" + memberId;
    const setRole = async (role) => {
      const response = await state.request(memberUrl, { ...json({ role }, admin), method: "PATCH" });
      assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    };
    const openContext = async () => {
      const response = await state.request("/api/workspaces/" + state.organizationId + "/projects/" + state.projectAccessId + "/context", { method: "POST", headers: identity });
      assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
      state.owner = { ...identity, cookie: response.headers.get("set-cookie").split(";")[0] };
    };
    await setRole("editor"); await openContext();
    const quote = await quoteAdaptiveRegression(state), job = await executeAdaptiveRegression(state, quote);
    assert.equal(job.status, "completed", job.error_message); retainOnlyAdaptiveRawRegression(state, quote.executionId);
    await setRole("viewer");
    const current = new RealDate(), nextMonth = RealDate.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 1, 1);
    globalThis.Date = class extends RealDate {
      constructor(...args) { super(...(args.length ? args : [nextMonth])); }
      static now() { return nextMonth; }
    };
    await openContext(); delete state.env.OPENAI_API_KEY;
    state.sqlite.prepare("DELETE FROM budget_scope_policies WHERE organization_id=?").run(state.organizationId);
    state.sqlite.prepare("UPDATE cost_budget_counters SET used_microusd=hard_limit_microusd-reserved_microusd").run();
    state.sqlite.prepare("UPDATE budget_counters SET used_tokens=hard_limit_tokens-reserved_tokens").run();
    // Reconciliation may touch timestamps, but must not reserve, re-charge, or open a new accounting period.
    const financialState = () => ({
      tokens: state.sqlite.prepare("SELECT * FROM budget_reservations ORDER BY reservation_id").all(),
      costs: state.sqlite.prepare("SELECT * FROM cost_budget_reservations ORDER BY reservation_id").all(),
      tokenCounters: state.sqlite.prepare("SELECT scope,scope_id,period,used_tokens,reserved_tokens,hard_limit_tokens FROM budget_counters ORDER BY scope,scope_id,period").all(),
      costCounters: state.sqlite.prepare("SELECT scope,scope_id,period,used_microusd,reserved_microusd,hard_limit_microusd FROM cost_budget_counters ORDER BY scope,scope_id,period").all(),
    });
    const before = financialState();
    assert.notEqual(new Date().toISOString().slice(0, 7), quote.period); assert.ok(quote.expiresAt < new Date().toISOString());
    const originalPreview = await state.request("/api/document-jobs/adaptive", json({ ...adaptiveRegressionRequest, action: "quote" }, state.owner));
    assert.equal(originalPreview.status, 200); assert.equal((await originalPreview.json()).quote.executionId, quote.executionId, "same intent returns the paid request, not a new purchase");
    const denied = await state.request("/api/document-jobs/adaptive", json({ ...adaptiveRegressionRequest, prompt: "A genuinely new planning intent", action: "quote" }, state.owner));
    assert.equal(denied.status, 403, "reader has no new authoring/purchase entitlement");
    const response = await retrieveAdaptiveRegression(state, quote), body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body)); assert.equal(body.structure.interpretation, "PRIVATE_ADAPTIVE_REGRESSION_PLAN");
    assert.equal(body.recoveredFromPaidReceipt, true); assert.equal(body.quote.providerAvailable, false); assert.equal(body.job.status, "completed");
    assert.equal(body.executionId, quote.executionId); assert.equal(body.bindingHash, quote.bindingHash);
    assert.equal(body.quote.period, quote.period); assert.deepEqual(body.quote.privateInput, quote.privateInput);
    assert.equal(JSON.stringify(body).includes("adaptiveProviderReceipt"), false);
    assert.deepEqual(financialState(), before); assert.equal(state.adaptiveCalls.length, 1);
  } finally { globalThis.Date = RealDate; await state.closeAdaptiveRegression(); }
});

test("adaptive regression: detached or mismatched retention alone blocks final and raw private reads", async () => {
  for (const kind of ["final", "raw"]) for (const mode of ["detached", "wrong-actor", "wrong-project"]) {
    const state = await adaptiveRegressionFixture(true); let intercept;
    try {
      const quote = await quoteAdaptiveRegression(state); assert.equal((await executeAdaptiveRegression(state, quote)).status, "completed");
      if (kind === "raw") retainOnlyAdaptiveRawRegression(state, quote.executionId);
      const ref = kind === "raw"
        ? state.sqlite.prepare("SELECT json_extract(result_json,'$.adaptiveProviderReceipt.contentRef') AS ref FROM document_jobs WHERE job_id=?").get(quote.executionId).ref
        : state.sqlite.prepare("SELECT result_ref AS ref FROM consequential_executions WHERE execution_id=?").get(quote.executionId).ref;
      assert.ok(ref);
      const resource = state.sqlite.prepare("SELECT * FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=?").get(ref); assert.ok(resource);
      // Inject after source synchronization: neither resource removal nor content erasure can explain this denial.
      intercept = interceptAdaptiveRegressionSql(state, (sql) => kind === "raw"
        ? sql.startsWith("SELECT job.result_json,raw.content_id,raw.content FROM document_jobs job JOIN private_content raw")
        : sql.startsWith("SELECT content FROM private_content WHERE") && sql.includes("kind='context-proposal'"), "first", () => {
        const changed = mode === "detached"
          ? state.sqlite.prepare("DELETE FROM private_content_retention_scopes WHERE content_id=?").run(ref)
          : mode === "wrong-actor"
            ? state.sqlite.prepare("UPDATE private_content_retention_scopes SET actor_user_id='assistant-viewer' WHERE content_id=?").run(ref)
            : state.sqlite.prepare("UPDATE private_content_retention_scopes SET project_id='wrong-project' WHERE content_id=?").run(ref);
        assert.equal(Number(changed.changes), 1);
      });
      const response = await retrieveAdaptiveRegression(state, quote), body = await response.json();
      assert.equal(intercept.fired, true); assert.ok([403, 404, 409, 410].includes(response.status), kind + "/" + mode + ": " + JSON.stringify(body));
      assert.equal(JSON.stringify(body).includes("PRIVATE_ADAPTIVE_REGRESSION_PLAN"), false); assert.equal(JSON.stringify(body).includes("adaptiveProviderReceipt"), false);
      assert.deepEqual(state.sqlite.prepare("SELECT * FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=?").get(ref), resource);
      const privateRow = state.sqlite.prepare("SELECT content,redacted_at FROM private_content WHERE content_id=?").get(ref);
      assert.ok(privateRow.content); assert.equal(privateRow.redacted_at, null); assert.equal(state.adaptiveCalls.length, 1);
    } finally { intercept?.restore(); await state.closeAdaptiveRegression(); }
  }
});

test("adaptive regression: lost shared admission preserves one anchored job recoverable under its original approval", async () => {
  const state = await adaptiveRegressionFixture(true), originalBatch = state.env.DB.batch; let lost = false;
  try {
    const quote = await quoteAdaptiveRegression(state);
    state.env.DB.batch = async (statements) => {
      const results = await originalBatch.call(state.env.DB, statements);
      if (!lost && statements.some((statement) => /^\s*UPDATE consequential_executions SET status='reserved'/u.test(statement.sql))
        && statements.some((statement) => /^\s*INSERT (?:OR IGNORE )?INTO document_jobs/u.test(statement.sql))) {
        lost = true; throw new Error("injected_adaptive_admission_response_lost");
      }
      return results;
    };
    const interrupted = await state.request("/api/document-jobs/adaptive", json({ ...adaptiveRegressionRequest, action: "execute", executionId: quote.executionId, approvedBindingHash: quote.bindingHash }, state.owner));
    state.env.DB.batch = originalBatch;
    assert.equal(lost, true); assert.equal(interrupted.ok, false); await state.drainBackground(); assert.equal(state.adaptiveCalls.length, 0);
    const job = state.sqlite.prepare("SELECT * FROM document_jobs WHERE job_id=?").get(quote.executionId);
    assert.equal(job.status, "queued"); assert.equal(job.correlation_id, quote.executionId);
    const anchored = state.sqlite.prepare("SELECT resource.*,event.type,event.actor,event.stream_id,event.correlation_id,event.payload FROM project_resource_scopes resource JOIN events event ON event.event_id=resource.source_event_id WHERE resource.resource_kind='job' AND resource.resource_id=?").get(quote.executionId);
    assert.ok(anchored); assert.equal(anchored.type, "ProjectDocumentJobQueued"); assert.equal(anchored.actor, "user:assistant-owner");
    assert.equal(anchored.stream_id, "creative:assistant-owner"); assert.equal(anchored.correlation_id, quote.executionId);
    const payload = JSON.parse(anchored.payload);
    for (const [field, expected] of Object.entries({ job_id: quote.executionId, document_id: "doc-atmosphere", organization_id: state.organizationId, project_access_id: state.projectAccessId, project_id: "project-atmosphere", actor_user_id: "assistant-owner", history_owner_user_id: "assistant-owner" })) assert.equal(payload[field], expected, field);
    const pending = await retrieveAdaptiveRegression(state, quote), pendingBody = await pending.json();
    assert.equal(pending.status, 202, JSON.stringify(pendingBody)); assert.equal(pendingBody.executionId, quote.executionId);
    assert.equal(pendingBody.job.jobId, quote.executionId); assert.equal(pendingBody.job.status, "queued"); assert.equal(state.adaptiveCalls.length, 0);
    for (const table of ["budget_reservations", "cost_budget_reservations"]) assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM " + table).get().count, 0);
    const resumed = await state.request("/api/document-jobs/" + quote.executionId + "/run", json({}, state.owner));
    assert.equal(resumed.status, 202, JSON.stringify(await resumed.clone().json())); await state.drainBackground();
    const recovered = await retrieveAdaptiveRegression(state, quote), body = await recovered.json();
    assert.equal(recovered.status, 200, JSON.stringify(body)); assert.equal(body.job.status, "completed");
    assert.equal(body.job.jobId, quote.executionId); assert.equal(body.executionId, quote.executionId); assert.equal(body.bindingHash, quote.bindingHash);
    assert.deepEqual(state.adaptiveCalls, [quote.privateInput.providerRequest]);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM document_jobs WHERE kind='structure_adaptive'").get().count, 1);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type='ProjectDocumentJobQueued' AND json_extract(payload,'$.job_id')=?").get(quote.executionId).count, 1);
    for (const table of ["budget_reservations", "cost_budget_reservations"]) assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM " + table).get().count, 1);
  } finally { state.env.DB.batch = originalBatch; await state.closeAdaptiveRegression(); }
});

test("adaptive regression: quotes and dispatches the same complete shared source", async () => {
  const state = await adaptiveRegressionFixture(true);
  try {
    appendFixtureEvents(state.sqlite, "creative:assistant-owner", [["BlockCreated", { project_id: "project-atmosphere", document_id: "doc-atmosphere", block_id: "adaptive-full-source", type: "text", handle: "full-source", properties: { text: "Preserve this authored direction.", prompt: "FULL_AUTHORED_PROMPT_MUST_NOT_DISAPPEAR" } }]]);
    const quote = await quoteAdaptiveRegression(state);
    assert.ok(JSON.stringify(quote.privateInput).includes("FULL_AUTHORED_PROMPT_MUST_NOT_DISAPPEAR"));
    const job = await executeAdaptiveRegression(state, quote); assert.equal(job.status, "completed", job.error_message); assert.equal(state.adaptiveCalls.length, 1);
    assert.ok(JSON.stringify(state.adaptiveCalls[0]).includes("FULL_AUTHORED_PROMPT_MUST_NOT_DISAPPEAR")); assert.deepEqual(state.adaptiveCalls[0], quote.privateInput.providerRequest);
  } finally { await state.closeAdaptiveRegression(); }
});
test("adaptive regression: submission rechecks exact shared job custody at the submitting CAS", async () => {
  const state = await adaptiveRegressionFixture(true);
  try {
    const quote = await quoteAdaptiveRegression(state); let removed = 0;
    state.controls.beforeConsequentialSubmit = () => { removed = Number(state.sqlite.prepare("DELETE FROM project_resource_scopes WHERE resource_kind='job' AND resource_id=?").run(quote.executionId).changes); };
    const job = await executeAdaptiveRegression(state, quote); assert.equal(removed, 1); assert.equal(state.adaptiveCalls.length, 0); assert.notEqual(job.status, "completed");
    const execution = state.sqlite.prepare("SELECT status,result_ref FROM consequential_executions WHERE execution_id=?").get(quote.executionId); assert.notEqual(execution.status, "completed"); assert.equal(execution.result_ref, null);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM consequential_execution_steps WHERE execution_id=? AND status IN('submitting','usage-recorded','settled')").get(quote.executionId).count, 0);
  } finally { await state.closeAdaptiveRegression(); }
});
test("adaptive regression: cached final result is not leaked after recovery CAS loses to erasure", async () => {
  const state = await adaptiveRegressionFixture(); let intercept;
  try {
    const quote = await quoteAdaptiveRegression(state); assert.equal((await executeAdaptiveRegression(state, quote)).status, "completed");
    state.sqlite.prepare("UPDATE document_jobs SET status='failed' WHERE job_id=?").run(quote.executionId);
    intercept = interceptAdaptiveRegressionSql(state, (sql) => /UPDATE document_jobs SET status='completed',result_json=/u.test(sql) && sql.includes("result_json IS ?"), "run", () => {
      state.sqlite.prepare("UPDATE private_content SET content='',redacted_at=? WHERE content_id=(SELECT result_ref FROM consequential_executions WHERE execution_id=?)").run(new Date().toISOString(), quote.executionId);
    });
    const response = await retrieveAdaptiveRegression(state, quote), body = await response.json(); assert.equal(intercept.fired, true);
    assert.ok([403, 404, 409, 410].includes(response.status), JSON.stringify(body)); assert.equal(JSON.stringify(body).includes("PRIVATE_ADAPTIVE_REGRESSION_PLAN"), false);
    assert.equal(state.sqlite.prepare("SELECT status FROM document_jobs WHERE job_id=?").get(quote.executionId).status, "failed"); assert.equal(state.adaptiveCalls.length, 1);
  } finally { intercept?.restore(); await state.closeAdaptiveRegression(); }
});
test("adaptive regression: raw-only recovery keeps private proof through the final HTTP response", async () => {
  const state = await adaptiveRegressionFixture(); let intercept;
  try {
    const quote = await quoteAdaptiveRegression(state); assert.equal((await executeAdaptiveRegression(state, quote)).status, "completed"); retainOnlyAdaptiveRawRegression(state, quote.executionId);
    intercept = interceptAdaptiveRegressionSql(state, (sql, stack) => sql.startsWith("SELECT 1 AS retained WHERE") && /^\s+at retrieve \(/mu.test(stack), "first", () => {
      state.sqlite.prepare("UPDATE private_content SET content='',redacted_at=? WHERE content_id=(SELECT json_extract(result_json,'$.adaptiveProviderReceipt.contentRef') FROM document_jobs WHERE job_id=?)").run(new Date().toISOString(), quote.executionId);
    });
    const response = await retrieveAdaptiveRegression(state, quote), body = await response.json(); assert.equal(intercept.fired, true);
    assert.ok([403, 404, 409, 410].includes(response.status), JSON.stringify(body)); assert.equal(JSON.stringify(body).includes("PRIVATE_ADAPTIVE_REGRESSION_PLAN"), false);
    assert.equal(JSON.stringify(body).includes("adaptiveProviderReceipt"), false); assert.equal(state.adaptiveCalls.length, 1);
  } finally { intercept?.restore(); await state.closeAdaptiveRegression(); }
});
test("adaptive regression: retained results require original organization-private content custody", async () => {
  const state = await adaptiveRegressionFixture(true);
  try {
    const quote = await quoteAdaptiveRegression(state); assert.equal((await executeAdaptiveRegression(state, quote)).status, "completed");
    const ref = state.sqlite.prepare("SELECT result_ref FROM consequential_executions WHERE execution_id=?").get(quote.executionId).result_ref; assert.ok(ref);
    assert.equal(Number(state.sqlite.prepare("DELETE FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=?").run(ref).changes), 1);
    const response = await retrieveAdaptiveRegression(state, quote), body = await response.json(); assert.ok([403, 404, 409, 410].includes(response.status), JSON.stringify(body));
    assert.equal(JSON.stringify(body).includes("PRIVATE_ADAPTIVE_REGRESSION_PLAN"), false);
    assert.equal(state.sqlite.prepare("SELECT 1 FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=?").get(ref), undefined); assert.equal(state.adaptiveCalls.length, 1);
  } finally { await state.closeAdaptiveRegression(); }
});
test("adaptive regression: retrieving a raced unused quote discovers its paid winner", { timeout: 10_000 }, async () => {
  const state = await adaptiveRegressionFixture(), originalPrepare = state.env.DB.prepare;
  try {
    let arrivals = 0, release; const barrier = new Promise((resolve) => { release = resolve; });
    state.env.DB.prepare = (sql) => {
      const statement = originalPrepare.call(state.env.DB, sql); if (!sql.includes("SELECT execution.status,content.content FROM consequential_executions")) return statement;
      const bind = statement.bind.bind(statement);
      statement.bind = (...values) => { const bound = bind(...values), first = bound.first.bind(bound); bound.first = async () => { const result = await first(); if (!result) { arrivals += 1; if (arrivals === 2) release(); await barrier; } return result; }; return bound; }; return statement;
    };
    const [winner, unused] = await Promise.all([quoteAdaptiveRegression(state), quoteAdaptiveRegression(state)]); state.env.DB.prepare = originalPrepare;
    assert.notEqual(winner.executionId, unused.executionId); assert.equal(winner.bindingHash, unused.bindingHash);
    assert.equal((await executeAdaptiveRegression(state, winner)).status, "completed");
    const response = await retrieveAdaptiveRegression(state, unused), body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.executionId, winner.executionId); assert.equal(body.bindingHash, winner.bindingHash); assert.equal(body.requestedExecutionId, unused.executionId); assert.equal(body.reusedExecutionId, winner.executionId);
    assert.equal(body.quote.executionId, winner.executionId); assert.equal(body.quote.bindingHash, winner.bindingHash); assert.equal(body.job.jobId, winner.executionId); assert.equal(body.job.status, "completed");
    assert.equal(body.structure.interpretation, "PRIVATE_ADAPTIVE_REGRESSION_PLAN"); assert.equal(state.adaptiveCalls.length, 1);
  } finally { state.env.DB.prepare = originalPrepare; await state.closeAdaptiveRegression(); }
});

test("assistant is available by default to every consented user without widening project access", async () => {
  const state = await fixture({ enabled: false });
  const session = await (await state.request("/api/session")).json();
  assert.deepEqual(session.assistant, { enabled: true, phase: "read-only", capabilities: ["project.assistant.read", "project.assistant.propose"] });
  assert.equal((await state.request(endpoint())).status, 200);

  const other = { "oai-authenticated-user-id": "another-user", "oai-authenticated-user-email": "another-user@example.test" };
  const otherSession = await (await state.request("/api/session", { headers: other })).json();
  assert.deepEqual(otherSession.assistant, { enabled: true, phase: "read-only", capabilities: ["project.assistant.read", "project.assistant.propose"] });
  assert.equal((await state.request(endpoint("/projects", ""), { headers: other })).status, 428, "terms remain mandatory");
  state.sqlite.prepare("UPDATE users SET consent_version=? WHERE user_id=?").run("pilot-2026-08-10", "another-user");
  assert.equal((await state.request(endpoint("/projects", ""), { headers: other })).status, 200);
  assert.equal((await state.request(endpoint(), { headers: other })).status, 403, "another user's project remains inaccessible");
});

test("planner-only accounts retain paid creative chat when their selected image adapter is unavailable",async()=>{
  const state=await fixture({provider:true});
  state.env.FORMA_IMAGE_PROVIDER="fal-ideogram";
  delete state.env.FAL_KEY;
  const session=await(await state.request("/api/session")).json();
  assert.equal(session.provider.plannerConfigured,true);
  assert.equal(session.provider.configured,false);
  const originalFetch=globalThis.fetch;
  let calls=0;
  globalThis.fetch=async(_url,init)=>{
    calls+=1;
    const body=JSON.parse(init.body);
    return Response.json({id:"planner-only-creative-chat",model:body.model,
      output_text:JSON.stringify({reply:"Your text-only creative plan is updated.",mutations:[],preview_worthy:false,preview_direction:""}),
      usage:{input_tokens:80,output_tokens:20,total_tokens:100}});
  };
  try{
    const accepted=await state.request("/api/document-jobs",json({kind:"chat",documentId:"doc-atmosphere",sourceSurface:"chat",payload:{message:"Clarify the creative direction without an image.",livePreview:false}}));
    assert.equal(accepted.status,202,JSON.stringify(await accepted.clone().json()));
    const queued=await accepted.json();
    await state.drainBackground();
    assert.equal(calls,1);
    assert.equal(state.sqlite.prepare("SELECT status FROM document_jobs WHERE job_id=?").get(queued.job.jobId).status,"completed");
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM document_jobs WHERE kind='preview'").get().count,0);
  }finally{globalThis.fetch=originalFetch;}
});

test("board planning reuses only identical approved requests and atomically separates board destinations",{timeout:15_000},async()=>{
  const state=await fixture({provider:true}),stream="creative:dev-local-creative";
  appendFixtureEvents(state.sqlite,stream,["dedup-a","dedup-b"].map(id=>["CanvasCreated",{canvas_id:id,project_id:"project-atmosphere",name:id,slug:id}]));
  const released=Promise.withResolvers(),originalFetch=globalThis.fetch;let calls=0;
  const body=(canvasId,prompt)=>({...adaptiveConsentBody,canvasId,sourceSurface:"canvas",projectScope:true,prompt});
  globalThis.fetch=async(_url,init)=>{calls++;await released.promise;return adaptiveFixtureResponse(JSON.parse(init.body));};
  try{
    const aBody=body("dedup-a","Keep the moonlit courtyard."),aQuote=await quoteAdaptiveConsent(state,aBody),first=await executeAdaptiveConsent(state,aQuote,aBody);
    assert.equal(first.status,202,JSON.stringify(await first.clone().json()));const a=await first.json();
    const sameBody=body("dedup-a","  Keep the moonlit courtyard.  "),sameQuote=await quoteAdaptiveConsent(state,sameBody);
    assert.equal(sameQuote.executionId,aQuote.executionId);assert.equal(sameQuote.bindingHash,aQuote.bindingHash);
    const sameResponse=await executeAdaptiveConsent(state,sameQuote,sameBody),same=await sameResponse.json();
    assert.equal(sameResponse.status,202);assert.equal(same.job.jobId,a.job.jobId);assert.equal(same.executionId,aQuote.executionId);
    const changedBody=body("dedup-a","A sunny mountain instead."),changedQuote=await quoteAdaptiveConsent(state,changedBody),changed=await executeAdaptiveConsent(state,changedQuote,changedBody);
    assert.equal(changed.status,409);assert.equal((await changed.json()).error,"context_consent_changed");
    assert.equal(adaptiveJob(state,changedQuote.executionId),undefined,"A different request cannot take the active exact destination");
    for(const prompt of ["","x".repeat(2001)]){
      const invalid=await state.request(adaptiveConsentPath,json({...body("dedup-a",prompt),action:"quote"}));
      assert.equal(invalid.status,409);assert.equal((await invalid.json()).error,"adaptive_intent_required");
    }
    const forged=await state.request(adaptiveConsentPath,json({...aBody,action:"quote",requestKey:"untrusted",idempotencyKey:"untrusted"}));
    assert.equal(forged.status,409);assert.equal((await forged.json()).error,"adaptive_request_changed");
    const bBody=body("dedup-b",aBody.prompt),bQuote=await quoteAdaptiveConsent(state,bBody),second=await executeAdaptiveConsent(state,bQuote,bBody),b=await second.json();
    assert.equal(second.status,202,JSON.stringify(b));assert.notEqual(b.job.jobId,a.job.jobId);assert.equal(b.job.canvasId,"dedup-b");assert.notEqual(a.job.requestKey,b.job.requestKey);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM document_jobs").get().n,2);
    released.resolve();await state.drainBackground();
    for(const quote of [aQuote,bQuote]){const row=adaptiveJob(state,quote.executionId);assert.equal(row.status,"completed");assert.equal(row.job_id,row.correlation_id);assert.equal(row.attempt_count,1);}
    assert.equal(calls,2);assert.deepEqual(adaptiveLedgerCounts(state),{token:2,cost:2});
  }finally{released.resolve();await state.drainBackground();globalThis.fetch=originalFetch;}
});

test("identical approved board requests racing at admission recover one canonical job and one provider submission",{timeout:15_000},async()=>{
  const state=await adaptiveCanvasFixture(),released=Promise.withResolvers(),quotesReady=Promise.withResolvers(),originalFetch=globalThis.fetch,originalPrepare=state.env.DB.prepare;
  let calls=0,arrivals=0,races=0,restore;
  globalThis.fetch=async(_url,init)=>{calls++;await released.promise;return adaptiveFixtureResponse(JSON.parse(init.body));};
  try{
    // Both requests observe no reusable quote before either inserts its private consent.
    state.env.DB.prepare=sql=>{
      const statement=originalPrepare.call(state.env.DB,sql);if(!sql.includes("SELECT execution.status,content.content FROM consequential_executions"))return statement;
      const bind=statement.bind.bind(statement);statement.bind=(...values)=>{const bound=bind(...values),first=bound.first.bind(bound);bound.first=async()=>{const result=await first();if(!result){if(++arrivals===2)quotesReady.resolve();await quotesReady.promise;}return result;};return bound;};return statement;
    };
    const [winner,loser]=await Promise.all([quoteAdaptiveConsent(state,state.body),quoteAdaptiveConsent(state,state.body)]);state.env.DB.prepare=originalPrepare;
    assert.notEqual(winner.executionId,loser.executionId);assert.equal(winner.bindingHash,loser.bindingHash);
    let won;
    restore=interceptConsequentialDb(state,"batch",/^\s*UPDATE consequential_executions SET status='reserved'/u,async()=>{
      races++;const response=await executeAdaptiveConsent(state,winner,state.body);assert.equal(response.status,202,JSON.stringify(await response.clone().json()));won=await response.json();
    });
    const raced=await executeAdaptiveConsent(state,loser,state.body),result=await raced.json();restore();restore=null;
    assert.equal(races,1,"The second admission must win at the first request's actual atomic claim boundary");
    assert.equal(raced.status,202,JSON.stringify(result));assert.equal(result.job.jobId,won.job.jobId);assert.equal(result.executionId,winner.executionId);assert.equal(result.requestedExecutionId,loser.executionId);assert.equal(result.reused,true);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM document_jobs").get().n,1);assert.equal(adaptiveJob(state,loser.executionId),undefined);
    assert.equal(state.sqlite.prepare("SELECT status FROM consequential_executions WHERE execution_id=?").get(loser.executionId).status,"quoted");
    released.resolve();await state.drainBackground();
    const retained=await retrieveAdaptiveConsent(state,loser,state.body),paid=await retained.json();assert.equal(retained.status,200,JSON.stringify(paid));assert.equal(paid.executionId,winner.executionId);assert.equal(paid.job.status,"completed");assert.deepEqual(paid.structure,adaptiveFixtureStructure);
    assert.equal(calls,1);assert.deepEqual(adaptiveLedgerCounts(state),{token:1,cost:1});assert.equal(adaptiveJob(state,winner.executionId).correlation_id,winner.executionId);
  }finally{restore?.();state.env.DB.prepare=originalPrepare;quotesReady.resolve();released.resolve();await state.drainBackground();globalThis.fetch=originalFetch;}
});

test("board planning authorizes exact live boards and retains board identity in quoted, accepted, listed, and completed jobs",{timeout:15_000},async()=>{
  const state=await fixture({provider:true}),stream="creative:dev-local-creative",originalFetch=globalThis.fetch;let calls=0;
  appendFixtureEvents(state.sqlite,stream,[
    ["CanvasCreated",{canvas_id:"assistant-board-a",project_id:"project-atmosphere",name:"Board A",slug:"board-a"}],
    ["CanvasCreated",{canvas_id:"assistant-board-b",project_id:"project-atmosphere",name:"Board B",slug:"board-b"}],
    ["CanvasCreated",{canvas_id:"assistant-foreign-board",project_id:"foreign-project",name:"Foreign board",slug:"foreign"}],
  ]);
  const body=canvasId=>({...adaptiveConsentBody,sourceSurface:"canvas",projectScope:true,prompt:"Review this board without changing it.",...(canvasId?{canvasId}:{})});
  const structure={...adaptiveFixtureStructure,interpretation:"Board A can explore a clearer subject."};
  globalThis.fetch=async(_url,init)=>{calls++;return adaptiveFixtureResponse(JSON.parse(init.body),{outputText:JSON.stringify(structure)});};
  try{
    for(const[canvasId,error]of[["","canvas_context_required"],["assistant-foreign-board","context_canvas_unavailable"]]){
      const denied=await state.request(adaptiveConsentPath,json({...body(canvasId),action:"quote"}));assert.equal(denied.status,409,JSON.stringify({canvasId,reply:await denied.clone().json()}));assert.equal((await denied.json()).error,error);
    }
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM document_jobs").get().n,0);assert.deepEqual(adaptiveLedgerCounts(state),{token:0,cost:0});assert.equal(calls,0);
    const approvedBody=body("assistant-board-a"),quote=await quoteAdaptiveConsent(state,approvedBody);assert.equal(quote.canvasId,"assistant-board-a");
    const accepted=await executeAdaptiveConsent(state,quote,approvedBody);assert.equal(accepted.status,202,JSON.stringify(await accepted.clone().json()));const queued=await accepted.json();assert.equal(queued.job.canvasId,"assistant-board-a");
    await state.drainBackground();
    const listing=await(await state.request("/api/document-jobs")).json(),completed=listing.jobs.find(job=>job.jobId===quote.executionId);
    assert.equal(completed.status,"completed");assert.equal(completed.canvasId,"assistant-board-a");assert.equal(completed.result.structure.interpretation,structure.interpretation);
    const detail=await(await state.request("/api/document-jobs/"+quote.executionId)).json();assert.equal(detail.job.canvasId,"assistant-board-a");
    appendFixtureEvents(state.sqlite,stream,[["CanvasRemoved",{canvas_id:"assistant-board-a",project_id:"project-atmosphere"}]]);
    const reopened=await state.request(adaptiveConsentPath,json({...approvedBody,action:"quote"}));assert.equal(reopened.status,200);const original=await reopened.json();assert.equal(original.quote.executionId,quote.executionId);assert.equal(original.quote.canExecute,false);
    const denied=await state.request(adaptiveConsentPath,json({...approvedBody,action:"quote",replaceExecutionId:quote.executionId}));assert.equal(denied.status,409);assert.equal((await denied.json()).error,"context_canvas_unavailable");
    const retained=await retrieveAdaptiveConsent(state,quote,approvedBody);assert.equal(retained.status,200,JSON.stringify(await retained.clone().json()));assert.deepEqual((await retained.json()).structure,structure);
    assert.equal(calls,1);assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM document_jobs").get().n,1);
  }finally{await state.drainBackground();globalThis.fetch=originalFetch;}
});

for(const seam of ["claim","dispatch"])for(const restored of [false,true]){
  test(`exact board ${restored?"restoration":"removal"} at ${seam} stops stale admission until explicit re-approval`,{timeout:15_000},async()=>{
    const state=await adaptiveCanvasFixture(),stream="creative:dev-local-creative",body=state.body,originalFetch=globalThis.fetch;let mutations=0,calls=0,restore;
    globalThis.fetch=async(_url,init)=>{calls++;return adaptiveFixtureResponse(JSON.parse(init.body));};
    try{
      const quote=await quoteAdaptiveConsent(state,body);
      const mutate=()=>{
        mutations++;
        if(seam==="dispatch"){const running=adaptiveJob(state,quote.executionId);assert.equal(running.status,"running");assert.equal(JSON.parse(running.request_json).canvasId,body.canvasId);assert.equal(consequentialReceipt(state,quote.executionId).cost[0].status,"executing");}
        else assert.equal(adaptiveJob(state,quote.executionId),undefined);
        appendFixtureEvents(state.sqlite,stream,[["CanvasRemoved",{canvas_id:body.canvasId,project_id:body.projectId}],...(restored?[["CanvasRestored",{canvas_id:body.canvasId,project_id:body.projectId}]]:[])]);
      };
      if(seam==="claim")restore=interceptConsequentialDb(state,"batch",/^\s*UPDATE consequential_executions SET status='reserved'/u,mutate);
      else state.controls.beforeConsequentialSubmit=mutate;
      const response=await executeAdaptiveConsent(state,quote,body),result=await response.json();await state.drainBackground();restore?.();restore=null;
      assert.equal(mutations,1,"The captured-source SQL race boundary must execute");assert.equal(calls,0,"Even restoration cannot validate the stale source-head snapshot");
      if(seam==="claim"){assert.equal(response.status,409,JSON.stringify(result));assert.equal(adaptiveJob(state,quote.executionId),undefined);assert.deepEqual(adaptiveLedgerCounts(state),{token:0,cost:0});}
      else{assert.equal(response.status,202,JSON.stringify(result));assert.equal(result.job.canvasId,body.canvasId);assert.equal(adaptiveJob(state,quote.executionId).status,"failed");assert.equal(consequentialReceipt(state,quote.executionId).steps[0].status,"not-submitted");}
      assert.deepEqual(consequentialBalances(state),{tokens:{used:0,reserved:0},cost:{used:0,reserved:0}});
      if(!restored){
        const removed=await state.request(adaptiveConsentPath,json({...body,action:"quote"}));assert.equal(removed.status,409);assert.equal((await removed.json()).error,"context_canvas_unavailable");
        appendFixtureEvents(state.sqlite,stream,[["CanvasRestored",{canvas_id:body.canvasId,project_id:body.projectId}]]);
      }
      // Reuse identical unsubmitted consent where possible; only a new explicit approval may run.
      const fresh=await quoteAdaptiveConsent(state,body);assert.equal(fresh.canvasId,body.canvasId);assert.equal(fresh.status,"quoted");assert.equal(calls,0);
      if(seam==="dispatch")assert.notEqual(fresh.executionId,quote.executionId,"A stopped execution is not silently resurrected");
      const approved=await executeAdaptiveConsent(state,fresh,body);assert.equal(approved.status,202,JSON.stringify(await approved.clone().json()));await state.drainBackground();
      assert.equal(adaptiveJob(state,fresh.executionId).status,"completed");assert.equal(adaptiveJob(state,fresh.executionId).correlation_id,fresh.executionId);assert.equal(calls,1);
      assert.deepEqual(consequentialBalances(state),{tokens:{used:1300,reserved:0},cost:{used:5600,reserved:0}});
      if(seam==="dispatch"){assert.equal(adaptiveJob(state,quote.executionId).status,"failed");assert.equal(consequentialReceipt(state,quote.executionId).steps[0].status,"not-submitted");}
    }finally{restore?.();state.controls.beforeConsequentialSubmit=null;await state.drainBackground();globalThis.fetch=originalFetch;}
  });
}

async function seedLegacyPaidAdaptiveJob(state, {canvasId, plan, jobId="legacy-paid-adaptive", owner="dev-local-creative", stream="creative:dev-local-creative"}){
  const now=new Date().toISOString(),expiresAt=new Date(Date.now()+86400000).toISOString(),correlationId=`${jobId}:attempt:1`,intentRef=`${jobId}:intent`,contentRef=`${jobId}:plan`;
  const payload={canvasId,projectId:"project-atmosphere",projectScope:true,prompt:"Plan this original board.",locale:"en"};
  const token=await reserveBudget(state.env,owner,12000,{reservationId:`${jobId}:legacy-token`,streamId:stream,correlationId,operation:"adaptive-structure"});
  assert.equal(token.ok,true);
  const cost=await reserveCostBudget(state.env,owner,38000,{reservationId:`${jobId}:legacy-cost`,maximumMicrousd:38000,allowUserOverage:false,streamId:stream,correlationId,operation:"adaptive-structure",period:token.period});
  assert.equal(cost.ok,true);
  assert.equal((await settleBudget(state.env,owner,token.reservationId,110)).settled,true);
  assert.equal((await settleCostBudget(state.env,owner,cost.reservationId,520)).settled,true);
  for(const [contentId,kind,content]of[[intentRef,"adaptive-intent",payload.prompt],[contentRef,"adaptive-structure",JSON.stringify(plan)]])
    state.sqlite.prepare("INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at)VALUES(?,?,?,?,?,?,NULL)").run(contentId,owner,kind,content,now,expiresAt);
  let head=Number(state.sqlite.prepare("SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?").get(stream).head);
  const event=state.sqlite.prepare("INSERT INTO events(event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,causation_id,compensates_event_id,schema_version,type,payload)VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)");
  for(const [type,body]of[
    ["AssistantReasoned",{operation:"adaptive-structure",project_id:"project-atmosphere",document_id:"doc-atmosphere",intent_ref:intentRef,content_ref:contentRef,model_id:"gpt-5.6-terra"}],
    ["GenerationUsageRecorded",{operation:"adaptive-structure",project_id:"project-atmosphere",document_id:"doc-atmosphere",reservation_id:token.reservationId,cost_reservation_id:cost.reservationId,model_id:"gpt-5.6-terra",input_tokens:80,output_tokens:30,total_tokens:110,used_microusd:520}]
  ])event.run(crypto.randomUUID(),stream,++head,now,now,"worker:planner","legacy-paid-fixture",correlationId,null,null,1,type,JSON.stringify(body));
  state.sqlite.prepare("INSERT INTO document_jobs(job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,request_json,result_json,attempt_count,requested_at,started_at,completed_at,expires_at,updated_at)VALUES(?,?,?,'doc-atmosphere','structure_adaptive','completed','canvas',?,?,?,?,1,?,?,?,?,?)")
    .run(jobId,owner,stream,correlationId,head,JSON.stringify(payload),JSON.stringify({stage:"completed",structure:plan,intentRef}),now,now,now,expiresAt,now);
  return{jobId};
}
for(const retention of ["retained","expired-before-read","expired-after-read","redacted-after-read","replaced-after-read","access-revoked-after-read"])test(`paid board completion survives a final-row crash and board removal (${retention})`,{timeout:15_000},async()=>{
  const expired=retention!=="retained";
  const state=await fixture(),stream="creative:dev-local-creative",owner="dev-local-creative",canvasId="paid-completion-board";
  const plan={interpretation:"Retained original paid plan",active_decision:{type:"subject",label:"Subject",prompt:"Choose",why:"Focus"},suggested_blocks:[],hidden_until_later:[]};
  appendFixtureEvents(state.sqlite,stream,[["CanvasCreated",{canvas_id:canvasId,project_id:"project-atmosphere",name:"Original board",slug:"original-board"}]]);
  let calls=0;const originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>{calls++;assert.fail("Recovery must not submit a historical paid planning request");};
  try{
    const job=await seedLegacyPaidAdaptiveJob(state,{canvasId,plan});
    const readJob=()=>state.sqlite.prepare("SELECT * FROM document_jobs WHERE job_id=?").get(job.jobId),original=readJob();assert.equal(original.status,"completed");assert.deepEqual(JSON.parse(original.result_json).structure,plan);assert.equal(calls,0);
    const receipts=()=>state.sqlite.prepare("SELECT * FROM events WHERE stream_id=? AND correlation_id=? AND type IN('AssistantReasoned','GenerationUsageRecorded') ORDER BY sequence").all(stream,original.correlation_id);
    const ledgers=()=>({tokens:state.sqlite.prepare("SELECT * FROM budget_reservations WHERE owner_id=? AND correlation_id=? ORDER BY reservation_id").all(owner,original.correlation_id),costs:state.sqlite.prepare("SELECT * FROM cost_budget_reservations WHERE owner_id=? AND correlation_id=? ORDER BY reservation_id").all(owner,original.correlation_id)});
    const originalReceipts=receipts(),originalLedgers=ledgers();assert.equal(originalReceipts.filter(e=>e.type==="GenerationUsageRecorded").length,1);assert.equal(originalLedgers.costs.length,1);assert.equal(originalLedgers.costs[0].status,"settled");assert.ok(originalLedgers.costs[0].used_microusd>0);
    state.sqlite.prepare("UPDATE document_jobs SET status='committing',completed_at=NULL,lease_expires_at=?,updated_at=?,result_json=? WHERE job_id=?").run("2000-01-01T00:00:00.000Z","2000-01-01T00:00:00.000Z",JSON.stringify({stage:"saving",progressMessage:"Saving the provider result and its durable receipt."}),job.jobId);
    appendFixtureEvents(state.sqlite,stream,[["CanvasRemoved",{canvas_id:canvasId,project_id:"project-atmosphere"}]]);
    if(retention==="expired-before-read")state.sqlite.prepare("UPDATE private_content SET expires_at='2000-01-01T00:00:00.000Z' WHERE owner_id=? AND kind='adaptive-structure'").run(owner);
    let retentionRace=false;
    if(retention.endsWith("after-read")){
      const prepare=state.env.DB.prepare.bind(state.env.DB);
      state.env.DB.prepare=sql=>{const statement=prepare(sql),bind=statement.bind.bind(statement);statement.bind=(...values)=>{const bound=bind(...values);if(sql.startsWith("SELECT content_id,content FROM private_content")){const all=bound.all.bind(bound);bound.all=async()=>{const result=await all();const original=result.results.find(item=>item.content===JSON.stringify(plan));if(!retentionRace&&original){retentionRace=true;if(retention==="expired-after-read")state.sqlite.prepare("UPDATE private_content SET expires_at='2000-01-01T00:00:00.000Z' WHERE content_id=?").run(original.content_id);else if(retention==="redacted-after-read")state.sqlite.prepare("UPDATE private_content SET content='',redacted_at=? WHERE content_id=?").run(new Date().toISOString(),original.content_id);else if(retention==="access-revoked-after-read")state.sqlite.prepare("UPDATE users SET role='viewer',updated_at=? WHERE user_id=?").run(new Date().toISOString(),owner);else state.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id=?").run(JSON.stringify({...plan,interpretation:"A different retained body"}),original.content_id);}return result;};}return bound;};return statement;};
    }
    for(let attempt=0;attempt<(retention==="access-revoked-after-read"?1:2);attempt++){
      const response=await state.request(`/api/document-jobs/${job.jobId}/run`,json({}));assert.ok([200,202].includes(response.status));await state.drainBackground();const recovered=readJob();assert.equal(recovered.status,"completed");assert.equal(recovered.error_message,null);assert.equal(recovered.correlation_id,original.correlation_id);assert.equal(recovered.attempt_count,original.attempt_count);assert.equal(recovered.request_json,original.request_json);
      const result=JSON.parse(recovered.result_json);if(expired){assert.equal(result.structure,undefined);assert.equal(result.resultUnavailable,true);}else{assert.deepEqual(result.structure,plan);assert.ok(result.intentRef);}
      assert.deepEqual(receipts(),originalReceipts);assert.deepEqual(ledgers(),originalLedgers);assert.equal(calls,0,"Recovery must reuse the original paid response");
    }
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM document_jobs").get().n,1);
    if(retention.endsWith("after-read"))assert.equal(retentionRace,true,"The private read-to-write race must execute");
  }finally{await state.drainBackground();globalThis.fetch=originalFetch;}
});

test("late removed-board runner cannot overwrite concurrently completed approved paid work",{timeout:15_000},async()=>{
  const state=await adaptiveCanvasFixture(),stream="creative:dev-local-creative",originalFetch=globalThis.fetch,entered=Promise.withResolvers(),released=Promise.withResolvers();let calls=0,checked=0,restore,completedBeforeLateCheck;
  const read=id=>state.sqlite.prepare("SELECT status,result_json,error_message,completed_at,correlation_id,attempt_count FROM document_jobs WHERE job_id=?").get(id);
  globalThis.fetch=async(_url,init)=>{calls++;entered.resolve();await released.promise;return adaptiveFixtureResponse(JSON.parse(init.body));};
  try{
    const quote=await quoteAdaptiveConsent(state,state.body),accepted=await executeAdaptiveConsent(state,quote,state.body);assert.equal(accepted.status,202,JSON.stringify(await accepted.clone().json()));await entered.promise;
    const originalWork=Promise.all([...state.background]);
    appendFixtureEvents(state.sqlite,stream,[["CanvasRemoved",{canvas_id:state.body.canvasId,project_id:state.body.projectId}]]);
    state.sqlite.prepare("UPDATE document_jobs SET lease_expires_at='2000-01-01T00:00:00.000Z',updated_at='2000-01-01T00:00:00.000Z' WHERE job_id=?").run(quote.executionId);
    restore=interceptConsequentialDb(state,"first",/^SELECT 1 AS live_canvas /u,async()=>{
      checked++;released.resolve();await originalWork;completedBeforeLateCheck=read(quote.executionId);assert.equal(completedBeforeLateCheck.status,"completed");assert.deepEqual(JSON.parse(completedBeforeLateCheck.result_json).structure,adaptiveFixtureStructure);
    },"after");
    const auth=await requireUser(new Request("http://localhost/api/session"),state.env);assert.ok(auth.user);
    await runDocumentJob(state.env,auth.user,quote.executionId);restore();restore=null;
    assert.equal(checked,1,"The late board-read interleaving must execute");assert.deepEqual(read(quote.executionId),completedBeforeLateCheck);
    const receipt=consequentialReceipt(state,quote.executionId);assert.equal(receipt.execution.status,"completed");assert.equal(receipt.steps[0].status,"settled");assert.equal(receipt.tokens[0].status,"settled");assert.equal(receipt.cost[0].status,"settled");
    assert.deepEqual(receipt.balances,{tokens:{used:1300,reserved:0},cost:{used:5600,reserved:0}});
    const retrieved=await retrieveAdaptiveConsent(state,quote,state.body);assert.equal(retrieved.status,200);assert.deepEqual((await retrieved.json()).structure,adaptiveFixtureStructure);assert.deepEqual(read(quote.executionId),completedBeforeLateCheck);assert.equal(calls,1);assert.deepEqual(adaptiveLedgerCounts(state),{token:1,cost:1});
  }finally{restore?.();released.resolve();await state.drainBackground();globalThis.fetch=originalFetch;}
});

for(const started of [false,true])test(`legacy unsigned board job is parked without releasing uncertain holds (${started?"started":"queued"})`,{timeout:15_000},async()=>{
  const state=await fixture(),stream="creative:dev-local-creative",owner="dev-local-creative",canvasId="queued-board-cas",jobId="queued-board-job",now=new Date().toISOString(),correlationId=`${jobId}:attempt:1`;
  appendFixtureEvents(state.sqlite,stream,[["CanvasCreated",{canvas_id:canvasId,project_id:"project-atmosphere",name:"Queued board",slug:"queued-board"}],["CanvasRemoved",{canvas_id:canvasId,project_id:"project-atmosphere"}]]);
  const payload={canvasId,projectId:"project-atmosphere",projectScope:true,prompt:"One exact historical plan."};
  state.sqlite.prepare("INSERT INTO document_jobs(job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,request_json,result_json,attempt_count,requested_at,started_at,lease_expires_at,expires_at,updated_at)VALUES(?,?,?,'doc-atmosphere','structure_adaptive',?,'canvas',?,0,?,NULL,?,?,?,?,?,?)")
    .run(jobId,owner,stream,started?"running":"queued",started?correlationId:jobId,JSON.stringify(payload),started?1:0,now,started?now:null,started?"2000-01-01T00:00:00.000Z":null,new Date(Date.now()+86400000).toISOString(),now);
  const token=await reserveBudget(state.env,owner,100,{streamId:stream,correlationId,operation:"adaptive-structure"});assert.equal(token.ok,true);
  const cost=await reserveCostBudget(state.env,owner,1000,{maximumMicrousd:1000,allowUserOverage:false,streamId:stream,correlationId,operation:"adaptive-structure",period:token.period});assert.equal(cost.ok,true);
  if(started)assert.equal(await claimCostBudgetReservation(state.env,owner,cost.reservationId),true);
  const ledger=()=>({tokens:state.sqlite.prepare("SELECT * FROM budget_reservations").all(),costs:state.sqlite.prepare("SELECT * FROM cost_budget_reservations").all(),tokenCounters:state.sqlite.prepare("SELECT * FROM budget_counters ORDER BY scope,scope_id,period").all(),costCounters:state.sqlite.prepare("SELECT * FROM cost_budget_counters ORDER BY scope,scope_id,period").all()}),beforeLedger=ledger(),original=adaptiveJob(state,jobId),auth=await requireUser(new Request("http://localhost/api/session"),state.env),originalFetch=globalThis.fetch;let calls=0;
  assert.ok(auth.user);globalThis.fetch=async()=>{calls++;assert.fail("Unsigned historical work must never dispatch");};
  try{
    const parked=await runDocumentJob(state.env,auth.user,jobId);assert.equal(parked.status,"failed");assert.equal(parked.error_message,started?"provider_submission_uncertain":"adaptive_consent_required");
    assert.equal(JSON.parse(parked.result_json).noAutomaticRetry,true);assert.equal(JSON.parse(parked.result_json).errorDetail.retryable,false);
    for(const key of ["job_id","owner_id","stream_id","document_id","correlation_id","attempt_count","request_json"])assert.equal(parked[key],original[key]);
    assert.deepEqual(ledger(),beforeLedger,"No exact non-submission proof exists for these original holds");
    appendFixtureEvents(state.sqlite,stream,[["CanvasRestored",{canvas_id:canvasId,project_id:"project-atmosphere"}]]);
    assert.deepEqual(await runDocumentJob(state.env,auth.user,jobId),parked,"Restoration is not retroactive approval");assert.deepEqual(adaptiveJob(state,jobId),parked);assert.deepEqual(ledger(),beforeLedger);
    const sweep=await reconcileFailedBudgetReservations(state.env,auth.user,Date.now()+600_000);
    assert.deepEqual(sweep,{releasedTokens:0,reservationCount:0,releasedMicrousd:0,costReservationCount:0});
    assert.deepEqual(ledger(),beforeLedger,"The orphan sweep cannot reinterpret an unsigned original attempt as unused");
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE stream_id=? AND type='BudgetReleased'").get(stream).n,0);

    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM document_jobs").get().n,1);assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM consequential_executions").get().n,0);assert.equal(calls,0);
  }finally{globalThis.fetch=originalFetch;}
});

test("shared project owners cannot enqueue private paid chat outside their active project context",async()=>{
  const state=await sharedProjectFixture({provider:true});
  const {cookie,...personal}=state.owner;
  assert.ok(cookie);
  const before=state.sqlite.prepare("SELECT COUNT(*) AS count FROM document_jobs").get().count;
  const response=await state.request("/api/document-jobs",json({kind:"chat",documentId:"doc-atmosphere",sourceSurface:"chat",payload:{message:"This must not cross scopes.",livePreview:false}},personal));
  assert.equal(response.status,409,JSON.stringify(await response.clone().json()));
  assert.equal((await response.json()).error,"project_context_required");
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM document_jobs").get().count,before);
});

test("controlled-pilot creators retain free scoped guidance without paid or authoring entitlements",async()=>{
  const state=await sharedProjectFixture();
  delete state.env.FORMA_ASSISTANT_INTERNAL_USER_IDS;
  const now=new Date().toISOString(),past=new Date(Date.now()-60_000).toISOString(),future=new Date(Date.now()+60_000).toISOString();
  state.sqlite.prepare("INSERT INTO pilot_cohorts(cohort_id,organization_id,status,starts_at,ends_at,created_by_user_id,created_at,updated_at) VALUES(?,?,'active',?,?,?,?,?)")
    .run("strict-named-cohort",state.organizationId,past,future,"assistant-owner",now,now);
  state.sqlite.prepare("INSERT INTO pilot_participants(participant_id,cohort_id,organization_id,email_normalized,user_id,role,status,invited_by_user_id,created_at,revoked_at) VALUES(?,?,?,?,?,'member','active',?,?,NULL)")
    .run("strict-named-participant","strict-named-cohort",state.organizationId,"assistant-owner@example.test","assistant-owner","assistant-owner",now);
  const sessionResponse=await state.request("/api/session",{headers:state.owner});
  assert.equal(sessionResponse.status,200,JSON.stringify(await sessionResponse.clone().json()));
  const session=await sessionResponse.json();
  assert.equal(session.assistant.enabled,true);
  assert.equal(session.assistant.phase,"read-only","cohort admission never grants independent write authority");
  assert.equal(session.assistant.models,undefined,"cohort admission never grants paid provider access");
  const guidance=await state.request(endpoint(),json({turnId:crypto.randomUUID(),message:"What can I do with this project?"},state.owner));
  assert.equal(guidance.status,201,JSON.stringify(await guidance.clone().json()));
  assert.equal((await guidance.json()).task,undefined,"named participants receive free in-product guidance only");
  state.sqlite.prepare("UPDATE pilot_cohorts SET status='paused',updated_at=? WHERE cohort_id=?").run(new Date().toISOString(),"strict-named-cohort");
  const paused=await state.request(endpoint(),{headers:state.owner});
  assert.equal(paused.status,200,`paused participants retain free, permission-scoped guidance: ${paused.status}`);
});

test("hosted identity rejects unverified Access email and every cross-origin API mutation fails closed", async () => {
  const state = await fixture();
  const usersBefore = state.sqlite.prepare("SELECT COUNT(*) AS count FROM users").get().count;
  const forged = await worker.fetch(new Request("https://forma.example/api/session", {
    headers: { "cf-access-authenticated-user-email": "unverified@example.test" },
  }), state.env, { waitUntil() {} });
  assert.equal(forged.status, 401);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM users").get().count, usersBefore);

  const originalConsent = state.sqlite.prepare("SELECT consent_version FROM users WHERE user_id=?").get("dev-local-creative").consent_version;
  const denied = await state.request("/api/session", {
    ...json({ action: "accept_terms", ownershipConfirmed: true, providerProcessingConfirmed: true }),
    headers: { "content-type": "application/json", origin: "https://another-origin.invalid" },
  });
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).error, "same_origin_required");
  assert.equal(state.sqlite.prepare("SELECT consent_version FROM users WHERE user_id=?").get("dev-local-creative").consent_version, originalConsent);

  const assistant = await state.request(endpoint(), {
    ...json({ turnId: crypto.randomUUID(), message: "Change the approved direction" }),
    headers: { "content-type": "application/json", origin: "https://another-origin.invalid" },
  });
  assert.equal(assistant.status, 403);
  assert.equal((await assistant.json()).error, "same_origin_required");
});

test("shared context rejects stale same-field edits while preserving independent collaborative changes",async()=>{
  const state=await sharedProjectFixture();
  const current=await(await state.request("/api/events?after=0&limit=2000&content=0",{headers:state.owner})).json();
  const blockId=crypto.randomUUID();
  const creation=await state.request("/api/events",json({action:"append",event:{type:"BlockCreated",payload:{project_id:"project-atmosphere",
    document_id:"doc-atmosphere",block_id:blockId,type:"direction",handle:"Shared controlled decision",position:"strict-a0",properties:{}}},expectedSequence:current.head},state.owner));
  assert.equal(creation.status,200,JSON.stringify(await creation.clone().json()));
  const created=await creation.json();
  const payload={project_id:"project-atmosphere",document_id:"doc-atmosphere",block_id:blockId,
    property_path:"strict_collaboration_note",old_value:null,new_value:"First editor preserved"};
  const first=await state.request("/api/events",json({action:"append",event:{type:"BlockPropertyEdited",payload},expectedSequence:created.head},state.owner));
  assert.equal(first.status,200,JSON.stringify(await first.clone().json()));
  const accepted=await first.json();
  const stale=await state.request("/api/events",json({action:"append",event:{type:"BlockPropertyEdited",payload:{...payload,new_value:"Second editor must not overwrite"}},expectedSequence:accepted.head},state.owner));
  assert.equal(stale.status,409,JSON.stringify(await stale.clone().json()));
  assert.equal((await stale.json()).error,"context_value_conflict");
  const independent=await state.request("/api/events",json({action:"append",event:{type:"BlockPropertyEdited",payload:{...payload,property_path:"independent_editor_note",old_value:null,new_value:"Independent decision preserved"}},expectedSequence:accepted.head},state.owner));
  assert.equal(independent.status,200,JSON.stringify(await independent.clone().json()));
  const independentResult=await independent.json();
  const defaults=await state.request("/api/events",json({action:"batch",events:[
    {type:"BlockPropertyEdited",payload:{...payload,property_path:"intent",old_value:"include",new_value:"avoid"}},
    {type:"BlockWeightSet",payload:{project_id:"project-atmosphere",document_id:"doc-atmosphere",block_id:blockId,previous_weight:.5,weight:.8}},
  ],expectedSequence:independentResult.head},state.owner));
  assert.equal(defaults.status,200,JSON.stringify(await defaults.clone().json()),"the first edit of effective UI defaults succeeds when no durable value existed");
  const updates=state.sqlite.prepare("SELECT event.payload,secret.private_json FROM events event LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id WHERE event.type='BlockPropertyEdited'").all()
    .map((event)=>({...JSON.parse(event.payload),...JSON.parse(event.private_json??"{}") })).filter((event)=>event.block_id===payload.block_id);
  assert.equal(updates.some((event)=>event.new_value==="First editor preserved"),true);
  assert.equal(updates.some((event)=>event.new_value==="Second editor must not overwrite"),false);
  assert.equal(updates.some((event)=>event.new_value==="Independent decision preserved"),true);
});

test("older unread review assignments remain visible ahead of newer acknowledged notices",async()=>{
  const state=await sharedProjectFixture();
  const insert=state.sqlite.prepare("INSERT INTO project_notifications(notification_id,project_access_id,organization_id,project_id,recipient_user_id,event_id,kind,artifact_id,document_id,message,created_at,expires_at,read_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)");
  const expires=new Date(Date.now()+86_400_000).toISOString();
  for(let index=0;index<111;index+=1){
    const created=new Date(Date.now()-60_000+index*100).toISOString();
    insert.run(`strict-notification-${index}`,state.projectAccessId,state.organizationId,"project-atmosphere","assistant-owner",`strict-event-${index}`,
      index<56?"review_requested":"output_ready",null,"doc-atmosphere",index<56?"Independent review still needed":"Previously read update",created,expires,index<56?null:created);
  }
  const response=await state.request("/api/project-notifications",{headers:state.owner});
  assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
  const notifications=await response.json();
  assert.equal(notifications.notifications.length,111,"every bounded recipient notice remains reachable without a hidden unimplemented second page");
  assert.equal(notifications.notifications[0].kind,"review_requested","the oldest unread assignment cannot be buried under recent read notices");
  assert.equal(notifications.notifications.filter((notice)=>notice.readAt===null).length,56,"more than fifty independent review assignments remain visible");
  assert.equal(notifications.unreadCount,56);
  assert.equal(notifications.totalCount,111);
});

test("notification retention preserves each recipient's oldest unread work without quadratic cross-recipient cleanup",async()=>{
  const state=await sharedProjectFixture();
  const insert=state.sqlite.prepare("INSERT INTO project_notifications(notification_id,project_access_id,organization_id,project_id,recipient_user_id,event_id,kind,artifact_id,document_id,message,created_at,expires_at,read_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)");
  const expires=new Date(Date.now()+86_400_000).toISOString();
  for(const recipient of ["assistant-owner","assistant-viewer"])for(let index=0;index<1_001;index+=1){
    const created=new Date(Date.now()-120_000+index).toISOString();
    insert.run(`bounded-${recipient}-${index}`,state.projectAccessId,state.organizationId,"project-atmosphere",recipient,`bounded-${recipient}-event-${index}`,
      index===0?"review_requested":"output_ready",null,"doc-atmosphere",index===0?"Preserve the oldest unread review":"Previously acknowledged update",created,expires,index===0?null:created);
  }
  const changed=await state.request("/api/events",json({action:"append",event:{type:"BlockCreated",payload:{project_id:"project-atmosphere",document_id:"doc-atmosphere",
    block_id:"notification-retention-decision",type:"direction",handle:"direction/retention",position:"z999",properties:{text:"Retain each person's independent review."}}}},state.owner));
  assert.equal(changed.status,200,JSON.stringify(await changed.clone().json()));
  for(const recipient of ["assistant-owner","assistant-viewer"]){
    const count=state.sqlite.prepare("SELECT COUNT(*) AS count FROM project_notifications WHERE project_access_id=? AND recipient_user_id=?")
      .get(state.projectAccessId,recipient).count;
    assert.equal(count,1_000,recipient);
    const preserved=state.sqlite.prepare("SELECT read_at FROM project_notifications WHERE notification_id=?").get(`bounded-${recipient}-0`);
    assert.ok(preserved,`${recipient}'s oldest actionable assignment survives newer acknowledged traffic`);
    assert.equal(preserved.read_at,null);
  }
});

test("organization usage exposes buyer-safe measured outcomes without another tenant's work or actor identities",async()=>{
  const state=await sharedProjectFixture();
  const now=new Date().toISOString(),earlier=new Date(Date.now()-30*60_000).toISOString();
  const insert=state.sqlite.prepare("INSERT INTO project_review_tasks(task_id,project_access_id,organization_id,project_id,artifact_id,document_id,request_event_id,requested_by_user_id,assigned_user_id,artifact_revision,content_sha256,status,created_at,resolved_at,resolved_by_user_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,'approved',?,?,?)");
  insert.run("strict-approved",state.projectAccessId,state.organizationId,"project-atmosphere","strict-deliverable","doc-atmosphere","strict-request","assistant-owner","assistant-viewer",0,"safe-digest",earlier,now,"assistant-viewer");
  insert.run("foreign-approved","foreign-project-access","foreign-organization","foreign-project","private-foreign-deliverable","foreign-document","foreign-request","foreign-owner","foreign-reviewer",0,"foreign-digest",earlier,now,"foreign-reviewer");
  const usage=await state.request(`/api/workspaces/${state.organizationId}/usage`,{headers:state.owner});
  assert.equal(usage.status,200,JSON.stringify(await usage.clone().json()));
  const report=await usage.json();
  assert.equal(report.outcomes.approvedDeliverables,1);
  assert.equal(report.outcomes.averageReviewMinutes,30);
  assert.equal(report.outcomes.pendingReviews,0);
  assert.equal(report.outcomes.settledCostPerApprovedDeliverableMicrousd,0);
  assert.doesNotMatch(JSON.stringify(report.outcomes),/foreign|assistant-owner|assistant-viewer|strict-deliverable/,"aggregate outcomes never expose people, private content, or other tenants");
});

test("managed organization context requires a distinct live administrator and rejects source changes before approval",async()=>{
  const state=await sharedProjectFixture();
  state.sqlite.prepare("UPDATE organization_memberships SET role='administrator' WHERE organization_id=? AND user_id=?")
    .run(state.organizationId,"assistant-viewer");
  state.sqlite.prepare("UPDATE project_memberships SET role='editor' WHERE project_access_id=? AND user_id=?")
    .run(state.projectAccessId,"assistant-viewer");
  const blockId=crypto.randomUUID();
  const created=await state.request("/api/events",json({action:"append",event:{type:"BlockCreated",payload:{project_id:"project-atmosphere",
    document_id:"doc-atmosphere",block_id:blockId,type:"direction",handle:"Approved controlled direction",position:"managed-a0",properties:{text:"Approved controlled context"}}}},state.owner));
  assert.equal(created.status,200,JSON.stringify(await created.clone().json()));
  const now=new Date().toISOString(),past=new Date(Date.now()-60_000).toISOString(),future=new Date(Date.now()+86_400_000).toISOString();
  state.sqlite.prepare("INSERT INTO pilot_cohorts(cohort_id,organization_id,status,starts_at,ends_at,created_by_user_id,created_at,updated_at) VALUES(?,?,'active',?,?,?,?,?)")
    .run("managed-package-cohort",state.organizationId,past,future,"assistant-owner",now,now);
  const participants=state.sqlite.prepare("INSERT INTO pilot_participants(participant_id,cohort_id,organization_id,email_normalized,user_id,role,status,invited_by_user_id,created_at,revoked_at) VALUES(?,?,?,?,?,'member','active',?,?,NULL)");
  for(const actor of ["assistant-owner","assistant-viewer"])participants.run(`managed-${actor}`,"managed-package-cohort",state.organizationId,`${actor}@example.test`,actor,"assistant-owner",now);
  const destination=`/api/workspaces/${state.organizationId}/context-packages`;
  const body={name:"Controlled pilot messaging",sourceProjectAccessId:state.projectAccessId,documentId:"doc-atmosphere",blockIds:[blockId]};
  const drafted=await state.request(destination,json(body,state.owner));
  assert.equal(drafted.status,201,JSON.stringify(await drafted.clone().json()));
  const version=await drafted.json();
  const publish=`${destination}/${version.packageId}/versions/${version.versionId}/publish`;
  const self=await state.request(publish,{method:"POST",headers:state.owner});
  assert.equal(self.status,403,JSON.stringify(await self.clone().json()));
  assert.equal((await self.json()).error,"independent_context_approver_required");
  state.sqlite.prepare("UPDATE pilot_cohorts SET status='paused' WHERE cohort_id=?").run("managed-package-cohort");
  const pausedSelf=await state.request(publish,{method:"POST",headers:state.owner});
  assert.equal(pausedSelf.status,403,JSON.stringify(await pausedSelf.clone().json()));
  assert.equal((await pausedSelf.json()).error,"independent_context_approver_required","pausing a governed cohort never enables author self-approval");
  const authorCatalog=await(await state.request(destination,{headers:state.owner})).json();
  const reviewerCatalog=await(await state.request(destination,{headers:state.viewer})).json();
  assert.equal(authorCatalog.packages[0].versionStatus,"draft");
  assert.equal(authorCatalog.packages[0].versionId,null);
  assert.equal(authorCatalog.packages[0].pendingDraftVersionId,version.versionId);
  assert.equal(authorCatalog.packages[0].canApprove,false);
  assert.equal(reviewerCatalog.packages[0].versionStatus,"draft");
  assert.equal(reviewerCatalog.packages[0].canApprove,true,"an independently entitled administrator can find the pending draft");
  assert.equal(reviewerCatalog.packages[0].draftPreview[0].text,"Approved controlled context","an independent reviewer can inspect the exact proposed decision before approving");
  const approved=await state.request(publish,{method:"POST",headers:state.viewer});
  assert.equal(approved.status,200,JSON.stringify(await approved.clone().json()));
  const immutable=state.sqlite.prepare("SELECT created_by_user_id,approved_by_user_id,status FROM organization_context_package_versions WHERE version_id=?").get(version.versionId);
  assert.equal(immutable.created_by_user_id,"assistant-owner");
  assert.equal(immutable.approved_by_user_id,"assistant-viewer");
  assert.equal(immutable.status,"published");

  const second=await state.request(`${destination}/${version.packageId}/versions`,json(body,state.owner));
  assert.equal(second.status,201,JSON.stringify(await second.clone().json()));
  const draft=await second.json();
  const both=await(await state.request(destination,{headers:state.viewer})).json();
  assert.equal(both.packages[0].versionId,version.versionId,"a pending update never displaces the currently usable published context");
  assert.equal(both.packages[0].pendingDraftVersionId,draft.versionId,"the next version remains independently reviewable");
  const changed=await state.request("/api/events",json({action:"append",event:{type:"BlockPropertyEdited",payload:{project_id:"project-atmosphere",document_id:"doc-atmosphere",block_id:blockId,property_path:"text",old_value:"Approved controlled context",new_value:"Changed after independent capture"}}},state.owner));
  assert.equal(changed.status,200,JSON.stringify(await changed.clone().json()));
  const stale=await state.request(`${destination}/${version.packageId}/versions/${draft.versionId}/publish`,{method:"POST",headers:state.viewer});
  assert.equal(stale.status,409,JSON.stringify(await stale.clone().json()));
  assert.equal((await stale.json()).error,"context_package_source_changed");
  state.sqlite.prepare("UPDATE pilot_cohorts SET status='closed' WHERE cohort_id=?").run("managed-package-cohort");
  const closedSelf=await state.request(`${destination}/${version.packageId}/versions/${draft.versionId}/publish`,{method:"POST",headers:state.owner});
  assert.equal(closedSelf.status,403,"closing a cohort never disables its existing organizational dual-control obligations");
});

test("a two-person controlled pilot supports informed source-project Viewer approval without granting authorship",async()=>{
  const state=await sharedProjectFixture();
  const membership=state.sqlite.prepare("SELECT membership_id FROM project_memberships WHERE project_access_id=? AND user_id=?")
    .get(state.projectAccessId,"assistant-viewer").membership_id;
  const granted=await state.request(`/api/workspaces/${state.organizationId}/projects/${state.projectAccessId}/members/${membership}`,{
    method:"PATCH",headers:{...state.owner,"content-type":"application/json"},body:JSON.stringify({reviewAccess:true}),
  });
  assert.equal(granted.status,200,JSON.stringify(await granted.clone().json()));
  const root=crypto.randomUUID(),related=crypto.randomUUID(),exact="Revenue  growth\nnever fabricate proof";
  const longDecision=`${"Verified contractual context ".repeat(20)}CRITICAL TAIL AFTER FOUR HUNDRED CHARACTERS`;
  const authored=await state.request("/api/events",json({action:"batch",events:[
    {type:"BlockCreated",payload:{project_id:"project-atmosphere",document_id:"doc-atmosphere",block_id:root,type:"direction",handle:"Protected contractual restriction",position:"governed-a",properties:{text:longDecision,intent:"prohibit",weight:.8,exact_text:exact,exact_placements:["opening","closing"],protected_phrases:[{text:exact,placement:"opening_and_closing"}]}}},
    {type:"BlockCreated",payload:{project_id:"project-atmosphere",document_id:"doc-atmosphere",block_id:related,type:"message",handle:"Related authored obligation",position:"governed-b",properties:{text:"Related obligation",active:false,weight:.8}}},
    {type:"BlockRelationAdded",payload:{project_id:"project-atmosphere",document_id:"doc-atmosphere",relation_id:crypto.randomUUID(),from_block_id:root,to_block_id:related,kind:"context_contains",properties:{}}},
  ]},state.owner));
  assert.equal(authored.status,200,JSON.stringify(await authored.clone().json()));
  const configured=await state.request(`/api/workspaces/${state.organizationId}/pilot`,json({maxParticipants:2,participantCapMicrousd:1000000,organizationCapMicrousd:2000000},state.owner));
  assert.equal(configured.status,201,JSON.stringify(await configured.clone().json()));
  const enrolled=await state.request(`/api/workspaces/${state.organizationId}/pilot/participants`,json({email:"assistant-viewer@example.test",role:"reviewer"},state.owner));
  assert.equal(enrolled.status,201,JSON.stringify(await enrolled.clone().json()));
  const reviewerSession=await(await state.request("/api/session",{headers:state.viewer})).json();
  assert.equal(reviewerSession.projectContext.role,"viewer");
  assert.ok(reviewerSession.capabilities.includes("project.review.approve"));
  assert.ok(!reviewerSession.capabilities.includes("workspace.policy.manage"));
  assert.ok(!reviewerSession.capabilities.includes("project.author"));

  const destination=`/api/workspaces/${state.organizationId}/context-packages`;
  const body={name:"Precisely reviewed creative decisions",sourceProjectAccessId:state.projectAccessId,documentId:"doc-atmosphere",blockIds:[root]};
  const draftResponse=await state.request(destination,json(body,state.owner));
  assert.equal(draftResponse.status,201,JSON.stringify(await draftResponse.clone().json()));
  const draft=await draftResponse.json(),publish=`${destination}/${draft.packageId}/versions/${draft.versionId}/publish`;
  const author=await(await state.request(destination,{headers:state.owner})).json();
  assert.equal(author.packages[0].pendingDraftVersionId,draft.versionId);
  assert.equal(author.packages[0].canApprove,false,"the author retains durable pending visibility but cannot approve their own context");
  const reviewer=await(await state.request(destination,{headers:state.viewer})).json();
  const proposed=reviewer.packages[0];
  assert.equal(proposed.versionId,null,"a first draft remains visible before any published version exists");
  assert.equal(proposed.pendingDraftVersionId,draft.versionId);
  assert.equal(proposed.canApprove,true,"the exact viewer's project-scoped review grant is sufficient for independent approval");
  const protectedDecision=proposed.draftPreview.find((decision)=>decision.handle==="Protected contractual restriction");
  assert.equal(protectedDecision.text,longDecision,"independent reviewers receive complete bounded text, including its legally material tail");
  assert.ok(protectedDecision.text.length>400);
  assert.equal(protectedDecision.intent,"prohibit");
  assert.equal(protectedDecision.active,true);
  assert.equal(protectedDecision.exactText,exact);
  assert.deepEqual(protectedDecision.exactPlacements,["opening","closing"]);
  assert.deepEqual(protectedDecision.protectedPhrases,[{text:exact,placement:"opening_and_closing"}]);
  assert.deepEqual(protectedDecision.relations,[{kind:"context_contains",targetHandle:"Related authored obligation"}]);
  assert.equal(proposed.draftPreview.find((decision)=>decision.handle==="Related authored obligation").active,false);
  const denied=await state.request(destination,json(body,state.viewer));
  assert.equal(denied.status,403,"review authority never becomes package authorship or workspace administration");
  const approved=await state.request(publish,{method:"POST",headers:state.viewer});
  assert.equal(approved.status,200,JSON.stringify(await approved.clone().json()));
  assert.equal(state.sqlite.prepare("SELECT created_by_user_id,approved_by_user_id FROM organization_context_package_versions WHERE version_id=?")
    .get(draft.versionId).approved_by_user_id,"assistant-viewer");
  const adopted=await state.request(`${destination}/${draft.packageId}/adopt`,json({projectAccessId:state.projectAccessId,documentId:"doc-atmosphere",versionId:draft.versionId,updateMode:"pinned"},state.owner));
  assert.equal(adopted.status,201,JSON.stringify(await adopted.clone().json()));
  assert.equal(state.sqlite.prepare("SELECT role FROM project_memberships WHERE project_access_id=? AND user_id=?")
    .get(state.projectAccessId,"assistant-viewer").role,"viewer","approving organizational context never upgrades the reviewer to editor");
});

test("server-owned package adoption supports more than fifty guarded events without expanding ordinary user batches",async()=>{
  const state=await sharedProjectFixture();
  const ids=Array.from({length:26},()=>crypto.randomUUID());
  const authored=ids.flatMap((id,index)=>[
    {type:"BlockCreated",payload:{project_id:"project-atmosphere",document_id:"doc-atmosphere",block_id:id,type:"direction",handle:`Locked reusable decision ${index+1}`,position:`strict-${String(index).padStart(3,"0")}`,properties:{text:`Protected licensed-free decision ${index+1}`}}},
    {type:"BlockLocked",payload:{project_id:"project-atmosphere",document_id:"doc-atmosphere",block_id:id}},
  ]);
  const tooMany=await state.request("/api/events",json({action:"batch",events:authored.slice(0,51)},state.owner));
  assert.equal(tooMany.status,400);
  assert.equal((await tooMany.json()).error,"invalid_project_event_batch");
  for(const chunk of [authored.slice(0,26),authored.slice(26)]){
    const saved=await state.request("/api/events",json({action:"batch",events:chunk},state.owner));
    assert.equal(saved.status,200,JSON.stringify(await saved.clone().json()));
  }
  const endpoint=`/api/workspaces/${state.organizationId}/context-packages`;
  const drafted=await state.request(endpoint,json({name:"Twenty-six independently protected decisions",sourceProjectAccessId:state.projectAccessId,documentId:"doc-atmosphere",blockIds:ids},state.owner));
  assert.equal(drafted.status,201,JSON.stringify(await drafted.clone().json()));
  const version=await drafted.json();
  assert.equal((await state.request(`${endpoint}/${version.packageId}/versions/${version.versionId}/publish`,{method:"POST",headers:state.owner})).status,200);
  const adopted=await state.request(`${endpoint}/${version.packageId}/adopt`,json({projectAccessId:state.projectAccessId,documentId:"doc-atmosphere",versionId:version.versionId,updateMode:"pinned"},state.owner));
  assert.equal(adopted.status,201,JSON.stringify(await adopted.clone().json()));
  const saved=await adopted.json();
  assert.equal(saved.appended.length,52,"twenty-six creates and twenty-six locks commit as one server-owned governed adoption");
});

test("privileged assistants are available by default, separately session-scoped, and consent-gated", async () => {
  const state = await fixture({ enabled: false });
  const session = await (await state.request("/api/session?audience=operations")).json();
  assert.deepEqual(session.assistant, { enabled: true, host: "platform", phase: "read-only" });
  assert.equal(session.organizations.length, 0);
  assert.equal(session.projects, undefined);
  const headers = await platformHeaders(state, "operations");
  assert.equal((await state.request(platformEndpoint("/operations/providers"), { headers })).status, 200);
  assert.equal((await state.request(endpoint("/operations/providers"), { headers })).status, 403);
  state.sqlite.prepare("UPDATE users SET consent_version=NULL WHERE user_id=?").run("dev-local-creative");
  assert.equal((await (await state.request("/api/session?audience=operations")).json()).assistant, undefined);
  assert.equal((await state.request(platformEndpoint("/operations/providers"), { headers })).status, 428);
});

test("all 38 privileged pages use isolated, bounded, event-sourced guidance without querying any Creator content", async () => {
  const state = await fixture({ provider: true });
  const privileged = SITE_ROUTE_ENTRIES.filter((entry) => !["creative", "canvas"].includes(entry.application));
  assert.equal(privileged.length, 38);
  assert.doesNotMatch(PLATFORM_PRINCIPAL_WITH_ACCESS_SQL, /\b(?:events|event_private_payloads|private_content|project_event_scopes)\b/iu);
  const headers = Object.fromEntries(await Promise.all(["operations", "product", "knowledge", "engineering"]
    .map(async (audience) => [audience, await platformHeaders(state, audience)])));
  const before = {
    events: state.sqlite.prepare("SELECT COUNT(*) AS count FROM events").get().count,
    content: state.sqlite.prepare("SELECT COUNT(*) AS count FROM private_content").get().count,
    jobs: state.sqlite.prepare("SELECT COUNT(*) AS count FROM document_jobs").get().count,
    tokens: state.sqlite.prepare("SELECT COUNT(*) AS count FROM budget_reservations").get().count,
    cost: state.sqlite.prepare("SELECT COUNT(*) AS count FROM cost_budget_reservations").get().count,
  };
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async () => { providerCalls += 1; throw new Error("platform_assistant_must_not_call_provider"); };
  state.controls.forbidCreatorContentReads = true;
  try {
    for (const [index, entry] of privileged.entries()) {
      const current = headers[entry.application];
      const loaded = await state.request(platformEndpoint(entry.path), { headers: current });
      assert.equal(loaded.status, 200, `${entry.path}: ${JSON.stringify(await loaded.clone().json())}`);
      const payload = await loaded.json();
      assert.equal(payload.context.surface.application, entry.application, entry.path);
      assert.equal(payload.context.surface.canonicalFamily, entry.path, entry.path);
      assert.equal(payload.context.scope.projectId, null, entry.path);
      assert.equal(payload.context.scope.documentId, null, entry.path);
      assert.deepEqual(payload.context.decisionAtoms, [], entry.path);
      assert.deepEqual(payload.context.availableOutputs, [], entry.path);
      assert.ok(payload.context.playbook.length >= 3, entry.path);
      const written = await state.request(platformEndpoint(entry.path), json({ turnId: crypto.randomUUID(),
        message: `PRIVATE_PLATFORM_REQUEST_${index}: What is useful on this page?`, locale: "en" }, current));
      assert.equal(written.status, 201, `${entry.path}: ${JSON.stringify(await written.clone().json())}`);
      const turn = (await written.json()).turn;
      assert.match(turn.reply.key, /^assistant\.platform\./u, entry.path);
      assert.equal(turn.proposal === null || turn.proposal.kind === "navigate", true, entry.path);
      assert.equal(turn.task, undefined, entry.path);
    }
  } finally { state.controls.forbidCreatorContentReads = false; globalThis.fetch = originalFetch; }
  assert.deepEqual({
    events: state.sqlite.prepare("SELECT COUNT(*) AS count FROM events").get().count,
    content: state.sqlite.prepare("SELECT COUNT(*) AS count FROM private_content").get().count,
    jobs: state.sqlite.prepare("SELECT COUNT(*) AS count FROM document_jobs").get().count,
    tokens: state.sqlite.prepare("SELECT COUNT(*) AS count FROM budget_reservations").get().count,
    cost: state.sqlite.prepare("SELECT COUNT(*) AS count FROM cost_budget_reservations").get().count,
  }, before);
  assert.equal(providerCalls, 0);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM platform_assistant_events WHERE event_type='PlatformChatMessageSent'").get().count, 38);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM platform_assistant_events WHERE event_type='PlatformAssistantReasoned'").get().count, 38);
  const publicMetadata = state.sqlite.prepare("SELECT reply_key,proposal_json FROM platform_assistant_events").all();
  assert.doesNotMatch(JSON.stringify(publicMetadata), /PRIVATE_PLATFORM_REQUEST_/u);
});

test("platform conversations enforce exact route grants, actor/audience/route/epoch isolation, and administrator-only replay", async () => {
  const state = await fixture();
  const first = await platformSpecialist(state, "platform-specialist-a", ["product.delivery.read", "evaluation.actual.run"]);
  const second = await platformSpecialist(state, "platform-specialist-b", ["product.delivery.read"]);
  const firstHeaders = await platformHeaders(state, "product", first);
  const secondHeaders = await platformHeaders(state, "product", second);
  const route = platformEndpoint("/product/delivery");
  const sharedTurnId = crypto.randomUUID();
  const firstResponse = await state.request(route, json({ turnId: sharedTurnId, message: "PRIVATE_SPECIALIST_A release analysis" }, firstHeaders));
  assert.equal(firstResponse.status, 201, JSON.stringify(await firstResponse.clone().json()));
  const secondResponse = await state.request(route, json({ turnId: sharedTurnId, message: "PRIVATE_SPECIALIST_B release analysis" }, secondHeaders));
  assert.equal(secondResponse.status, 201, JSON.stringify(await secondResponse.clone().json()));
  const firstHistory = await (await state.request(route, { headers: firstHeaders })).json();
  const secondHistory = await (await state.request(route, { headers: secondHeaders })).json();
  assert.match(JSON.stringify(firstHistory.turns), /PRIVATE_SPECIALIST_A/u);
  assert.doesNotMatch(JSON.stringify(firstHistory.turns), /PRIVATE_SPECIALIST_B/u);
  assert.match(JSON.stringify(secondHistory.turns), /PRIVATE_SPECIALIST_B/u);
  assert.doesNotMatch(JSON.stringify(secondHistory.turns), /PRIVATE_SPECIALIST_A/u);
  assert.equal((await state.request(platformEndpoint("/product/insights"), { headers: firstHeaders })).status, 403);
  assert.equal((await state.request(platformEndpoint("/product/evaluation/actual"), { headers: firstHeaders })).status, 403);
  assert.equal((await state.request(platformEndpoint("/admin/events/replay"), { headers: firstHeaders })).status, 403);
  assert.equal((await state.request(platformEndpoint("/operations/providers"), { headers: firstHeaders })).status, 403);
  assert.equal((await state.request(`${route}&projectId=foreign`, { headers: firstHeaders })).status, 400);
  assert.equal((await state.request(platformEndpoint("/document/doc-atmosphere"), { headers: firstHeaders })).status, 404);
  assert.equal((await state.request(platformEndpoint("/share/secret"), { headers: firstHeaders })).status, 404);
  assert.equal((await state.request(route, { headers: { ...firstHeaders, "x-forma-assistant-audience": "knowledge" } })).status, 403);
  assert.equal((await state.request(route, { headers: { ...firstHeaders, "x-forma-platform-permission-epoch": "f".repeat(64) } })).status, 403);
  assert.equal((await state.request(route, { headers: { ...firstHeaders, cookie: "forma_impersonation=forbidden" } })).status, 409);
  assert.equal((await state.request(route, json({ turnId: crypto.randomUUID(), message: "Attempt a paid operation", model: "gpt-5.6-sol" }, firstHeaders))).status, 400);
  state.sqlite.prepare("UPDATE capability_grants SET status='revoked',revoked_at=? WHERE user_id=? AND capability=?")
    .run(new Date().toISOString(), "platform-specialist-a", "product.delivery.read");
  assert.equal((await state.request(route, { headers: firstHeaders })).status, 403);
  assert.equal((await state.request(route, { headers: secondHeaders })).status, 200);
});

test("platform conversation writes are atomic, append-only, idempotent, localized, and recent-history bounded", async () => {
  const state = await fixture();
  const headers = await platformHeaders(state, "knowledge");
  const route = platformEndpoint("/knowledge/guidance");
  assert.equal((await state.request(route, { headers })).status, 200);
  const before = {
    content: state.sqlite.prepare("SELECT COUNT(*) AS count FROM platform_assistant_private_content").get().count,
    events: state.sqlite.prepare("SELECT COUNT(*) AS count FROM platform_assistant_events").get().count,
  };
  state.controls.failPlatformAssistantCommit = true;
  const failed = await state.request(route, json({ turnId: crypto.randomUUID(), message: "ROLLBACK PRIVATE PLATFORM TEXT" }, headers));
  assert.equal(failed.status, 403);
  assert.deepEqual({
    content: state.sqlite.prepare("SELECT COUNT(*) AS count FROM platform_assistant_private_content").get().count,
    events: state.sqlite.prepare("SELECT COUNT(*) AS count FROM platform_assistant_events").get().count,
  }, before);
  const turn = crypto.randomUUID();
  const accepted = await state.request(route, json({ turnId: turn, message: "レビューのガイダンスを説明してください", locale: "ja" }, headers));
  assert.equal(accepted.status, 201, JSON.stringify(await accepted.clone().json()));
  const exact = await state.request(route, json({ turnId: turn, message: "レビューのガイダンスを説明してください", locale: "ja" }, headers));
  assert.equal(exact.status, 200);
  assert.equal((await state.request(route, json({ turnId: turn, message: "Forged replacement" }, headers))).status, 409);
  assert.match(state.sqlite.prepare("SELECT content FROM platform_assistant_private_content WHERE kind='platform-chat-assistant'").get().content, /アクセシビリティ/u);
  const firstEvent = state.sqlite.prepare("SELECT event_id FROM platform_assistant_events LIMIT 1").get().event_id;
  assert.throws(() => state.sqlite.prepare("UPDATE platform_assistant_events SET reply_key='tampered' WHERE event_id=?").run(firstEvent), /append-only/u);
  assert.throws(() => state.sqlite.prepare("DELETE FROM platform_assistant_events WHERE event_id=?").run(firstEvent), /append-only/u);
  for (let index = 0; index < 9; index += 1) {
    assert.equal((await state.request(route, json({ turnId: crypto.randomUUID(), message: `Recent platform question ${index}` }, headers))).status, 201);
  }
  const history = await (await state.request(route, { headers })).json();
  assert.equal(history.turns.length, 6);
  assert.equal(history.context.recentTurns.length, 6);
  assert.doesNotMatch(JSON.stringify(history.turns), /レビューのガイダンス/u);
});

test("privileged guidance answers the actual question from isolated activity and only the current page's safe operational signals", async () => {
  const state = await fixture();
  const operations = await platformHeaders(state, "operations");
  const product = await platformHeaders(state, "product");
  const now = new Date().toISOString();
  const future = new Date(Date.now() + 60_000).toISOString();
  const past = new Date(Date.now() - 60_000).toISOString();
  const provider = state.sqlite.prepare("INSERT INTO provider_health(scope_key,status,scope,message,observed_at,expires_at,retry_after_ms,request_id) VALUES(?,?,?,?,?,?,NULL,?)");
  provider.run("PRIVATE_PROVIDER_SCOPE_A", "healthy", "private-provider-a", "PRIVATE_PROVIDER_MESSAGE_A", now, future, "PRIVATE_REQUEST_A");
  provider.run("PRIVATE_PROVIDER_SCOPE_B", "degraded", "private-provider-b", "PRIVATE_PROVIDER_MESSAGE_B", now, future, "PRIVATE_REQUEST_B");
  provider.run("PRIVATE_PROVIDER_SCOPE_EXPIRED", "expired", "private-provider-c", "PRIVATE_EXPIRED_PROVIDER_MESSAGE", now, past, "PRIVATE_REQUEST_C");
  state.sqlite.prepare("INSERT INTO canvas_governance_requirements(requirement_id,status,details_json,updated_at) VALUES(?,?,?,?)")
    .run("provider-page-must-not-read-canvas", "blocked", "{}", now);
  state.sqlite.prepare("INSERT INTO delivery_decisions(decision_id,title,audience,status,owner_user_id,owner_display_name,evidence,dependency_ids_json,created_by_user_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'[]',?,?,?)")
    .run("private-delivery", "PRIVATE_RELEASE_TITLE", "product", "blocked", "dev-local-creative", "PRIVATE_OWNER", "PRIVATE_EVIDENCE", "dev-local-creative", now, now);
  state.controls.forbidCreatorContentReads = true;
  const ask = async (route, headers, message, locale = "en") => {
    const turnId = crypto.randomUUID();
    const result = await state.request(platformEndpoint(route), json({ turnId, message, locale }, headers));
    assert.equal(result.status, 201, `${message}: ${JSON.stringify(await result.clone().json())}`);
    return await result.json();
  };
  try {
    const page = await ask("/operations/providers", operations, "Which providers are available on this page?");
    assert.equal(page.turn.reply.key, "assistant.platform.providers");
    assert.equal(page.turn.proposal, null);
    assert.deepEqual(page.context.platformSignals, [
      { kind: "provider-health", status: "degraded", count: 1 },
      { kind: "provider-health", status: "healthy", count: 1 },
    ]);
    assert.doesNotMatch(JSON.stringify(page.context), /PRIVATE_PROVIDER_|PRIVATE_REQUEST_|governance-requirement/u);

    const permissions = await ask("/operations/providers", operations, "Explain my permissions and navigate to access");
    assert.equal(permissions.turn.reply.key, "assistant.platform.answer.permissions");
    assert.equal(permissions.turn.reply.values.capabilities, 1);
    assert.equal(permissions.turn.proposal.route, "/operations/access");

    const history = await ask("/operations/providers", operations, "What actions have I recently taken?");
    assert.equal(history.turn.reply.key, "assistant.platform.answer.history");
    assert.equal(history.turn.reply.values.actions, 1);
    assert.equal(history.context.recentActions[0].type, "PlatformNavigationProposed");
    assert.equal(history.turn.proposal, null);

    const status = await ask("/operations/providers", operations, "What is the current provider status?");
    assert.equal(status.turn.reply.key, "assistant.platform.answer.status");
    assert.deepEqual(status.turn.reply.values, { signals: 2, actions: 1 });
    assert.equal(status.turn.proposal, null);

    const audio = await ask("/operations/providers", operations, "Is audio supported today?");
    assert.equal(audio.turn.reply.key, "assistant.platform.answer.audio");
    assert.deepEqual(audio.context.availableOutputKinds, ["image", "short_story", "scene", "slides", "storyboard", "video", "audio"]);
    assert.equal(audio.turn.proposal, null);

    for (const [locale, message, expected] of [
      ["fr", "Quel est l’état actuel ?", "assistant.platform.answer.status"],
      ["ar", "ما هي الحالة الحالية؟", "assistant.platform.answer.status"],
      ["ja", "最近の履歴を確認してください", "assistant.platform.answer.history"],
    ]) {
      const localized = await ask("/operations/providers", operations, message, locale);
      assert.equal(localized.turn.reply.key, expected, locale);
      assert.ok(localized.turn.reply.values, locale);
      const stored = state.sqlite.prepare("SELECT content.content FROM platform_assistant_events event JOIN platform_assistant_private_content content ON content.content_id=event.content_id WHERE event.turn_id=? AND event.event_type='PlatformAssistantReasoned'")
        .get(localized.turn.id).content;
      assert.doesNotMatch(stored, /\{(?:signals|actions|turns|capabilities|steps)\}/u, locale);
    }

    const delivery = await ask("/product/delivery", product, "What is the release status?");
    assert.deepEqual(delivery.context.platformSignals, [{ kind: "release-decision", status: "blocked", count: 1 }]);
    assert.doesNotMatch(JSON.stringify(delivery.context), /PRIVATE_RELEASE_TITLE|PRIVATE_OWNER|PRIVATE_EVIDENCE|provider-health/u);
  } finally { state.controls.forbidCreatorContentReads = false; }
});

test("platform assistants propose exact authorized deep pages and cross-application handoffs without exposing restricted destinations", async () => {
  const state = await fixture();
  const headers = Object.fromEntries(await Promise.all(["operations", "product", "knowledge", "engineering"]
    .map(async (audience) => [audience, await platformHeaders(state, audience)])));
  const limitedIdentity = await platformSpecialist(state, "platform-limited-navigator", ["evaluation.synthetic.read", "evaluation.qualification.read"]);
  const limited = await platformHeaders(state, "product", limitedIdentity);
  state.controls.forbidCreatorContentReads = true;
  try {
    for (const { audience, route, message, destination, summary } of [
      { audience: "operations", route: "/operations/providers", message: "Open Product Insights", destination: "/product/insights" },
      { audience: "operations", route: "/operations/providers", message: "Open engineering jobs", destination: "/engineering/jobs" },
      { audience: "product", route: "/product/evaluation", message: "Open adapter qualification", destination: "/product/evaluation/adapters", summary: "assistant.platform.page.adapters" },
      { audience: "product", route: "/product/evaluation", message: "Open actual replay", destination: "/product/evaluation/actual", summary: "assistant.platform.page.actual" },
      { audience: "knowledge", route: "/knowledge/guidance", message: "Open focal points", destination: "/knowledge/focal-points", summary: "assistant.platform.page.focal" },
      { audience: "engineering", route: "/engineering/events", message: "Open event permissions", destination: "/operations/events/permissions", summary: "assistant.platform.page.permissions" },
    ]) {
      const response = await state.request(platformEndpoint(route), json({ turnId: crypto.randomUUID(), message }, headers[audience]));
      assert.equal(response.status, 201, `${message}: ${JSON.stringify(await response.clone().json())}`);
      const turn = (await response.json()).turn;
      assert.equal(turn.proposal.route, destination, message);
      if (summary) assert.equal(turn.proposal.summaryKey, summary, message);
    }

    for (const message of ["Open actual replay", "Open engineering jobs"]) {
      const response = await state.request(platformEndpoint("/product/evaluation"), json({ turnId: crypto.randomUUID(), message }, limited));
      assert.equal(response.status, 201);
      assert.equal((await response.json()).turn.proposal, null, message);
    }
    assert.equal((await state.request(platformEndpoint("/product/evaluation/actual"), { headers: limited })).status, 403);
  } finally { state.controls.forbidCreatorContentReads = false; }
});

test("explicit personal erasure transactionally scrubs only the exact actor's privileged conversations and preserves immutable events", async () => {
  const state = await fixture();
  const first = await platformSpecialist(state, "platform-privacy-a", ["product.delivery.read"]);
  const second = await platformSpecialist(state, "platform-privacy-b", ["product.delivery.read"]);
  const firstHeaders = await platformHeaders(state, "product", first);
  const secondHeaders = await platformHeaders(state, "product", second);
  const route = platformEndpoint("/product/delivery");
  for (const [identity, message] of [[firstHeaders, "PRIVATE ACTOR A PLATFORM HISTORY"], [secondHeaders, "PRIVATE ACTOR B PLATFORM HISTORY"]]) {
    const response = await state.request(route, json({ turnId: crypto.randomUUID(), message }, identity));
    assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
  }
  const now = new Date().toISOString();
  const future = new Date(Date.now() + 60_000).toISOString();
  state.sqlite.prepare("INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at) VALUES(?,?,?,?,?,?,NULL)")
    .run("platform-erasure-rollback", "platform-privacy-a", "prompt", "PRIVATE PERSONAL CONTENT A", now, future);
  state.sqlite.prepare("INSERT INTO external_content(content_id,owner_id,content,created_at) VALUES(?,?,?,?)")
    .run("platform-erasure-external", "platform-privacy-a", "PRIVATE DERIVED CONTENT A", now);
  const beforeEvents = state.sqlite.prepare("SELECT actor_user_id,event_id,event_type FROM platform_assistant_events ORDER BY event_id").all();
  const body = { action: "erase-personal-authored-context", confirmation: "ERASE_MY_PERSONAL_AUTHORED_CONTEXT" };

  state.controls.failPlatformPrivacyErase = true;
  await assert.rejects(state.request("/api/privacy/events", json(body, first)), /injected_platform_privacy_erasure_failure/u);
  assert.equal(state.sqlite.prepare("SELECT content,redacted_at FROM private_content WHERE content_id=?").get("platform-erasure-rollback").content, "PRIVATE PERSONAL CONTENT A");
  assert.ok(state.sqlite.prepare("SELECT content_id FROM external_content WHERE content_id=?").get("platform-erasure-external"));
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM platform_assistant_private_content WHERE actor_user_id=? AND redacted_at IS NULL").get("platform-privacy-a").count, 2);

  const erased = await state.request("/api/privacy/events", json(body, first));
  assert.equal(erased.status, 200, JSON.stringify(await erased.clone().json()));
  assert.equal((await erased.json()).erasedPlatformConversations, 2);
  const own = state.sqlite.prepare("SELECT content,redacted_at FROM platform_assistant_private_content WHERE actor_user_id=?").all("platform-privacy-a");
  assert.equal(own.length, 2);
  assert.ok(own.every((row) => row.content === "" && row.redacted_at));
  const other = state.sqlite.prepare("SELECT content,redacted_at FROM platform_assistant_private_content WHERE actor_user_id=?").all("platform-privacy-b");
  assert.ok(other.every((row) => row.content !== "" && row.redacted_at === null));
  assert.deepEqual(state.sqlite.prepare("SELECT actor_user_id,event_id,event_type FROM platform_assistant_events ORDER BY event_id").all(), beforeEvents);
  assert.deepEqual((await (await state.request(route, { headers: firstHeaders })).json()).turns, []);
  assert.match(JSON.stringify((await (await state.request(route, { headers: secondHeaders })).json()).turns), /PRIVATE ACTOR B PLATFORM HISTORY/u);

  const absent = await fixture({ enabled: false });
  const newIdentity = { "oai-authenticated-user-id": "platform-privacy-without-schema", "oai-authenticated-user-email": "platform-privacy-without-schema@example.test" };
  assert.equal((await absent.request("/api/session", { headers: newIdentity })).status, 200);
  absent.sqlite.prepare("UPDATE users SET consent_version=? WHERE user_id=?").run("pilot-2026-08-10", "platform-privacy-without-schema");
  assert.equal(absent.sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='platform_assistant_private_content'").get(), undefined);
  const withoutSchema = await absent.request("/api/privacy/events", json(body, newIdentity));
  assert.equal(withoutSchema.status, 200, JSON.stringify(await withoutSchema.clone().json()));
  assert.equal((await withoutSchema.json()).erasedPlatformConversations, 0);
});

test("actual scheduled retention physically erases expired privileged conversation text and records truthful maintenance counts", async () => {
  const state = await fixture();
  const headers = await platformHeaders(state, "operations");
  const route = platformEndpoint("/operations/providers");
  const expiredTurn = crypto.randomUUID();
  const activeTurn = crypto.randomUUID();
  for (const [turnId, message] of [[expiredTurn, "EXPIRED PRIVATE PLATFORM HISTORY"], [activeTurn, "ACTIVE PRIVATE PLATFORM HISTORY"]]) {
    const response = await state.request(route, json({ turnId, message }, headers));
    assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
  }
  await state.drainBackground();
  const expired = new Date(Date.now() - 60_000).toISOString();
  state.sqlite.prepare("UPDATE platform_assistant_private_content SET expires_at=? WHERE content_id IN(SELECT content_id FROM platform_assistant_events WHERE turn_id=? AND content_id IS NOT NULL)")
    .run(expired, expiredTurn);
  const metadataBefore = state.sqlite.prepare("SELECT event_id FROM platform_assistant_events ORDER BY event_id").all();
  await worker.scheduled({}, state.env);

  const removed = state.sqlite.prepare("SELECT content,redacted_at FROM platform_assistant_private_content WHERE content_id IN(SELECT content_id FROM platform_assistant_events WHERE turn_id=? AND content_id IS NOT NULL)")
    .all(expiredTurn);
  assert.equal(removed.length, 2);
  assert.ok(removed.every((row) => row.content === "" && row.redacted_at));
  const retained = state.sqlite.prepare("SELECT content,redacted_at FROM platform_assistant_private_content WHERE content_id IN(SELECT content_id FROM platform_assistant_events WHERE turn_id=? AND content_id IS NOT NULL)")
    .all(activeTurn);
  assert.ok(retained.every((row) => row.content !== "" && row.redacted_at === null));
  assert.deepEqual(state.sqlite.prepare("SELECT event_id FROM platform_assistant_events ORDER BY event_id").all(), metadataBefore);
  const receipt = state.sqlite.prepare("SELECT trigger_kind,status,processed_count,remaining_count FROM retention_sweep_runs ORDER BY started_at DESC LIMIT 1").get();
  assert.deepEqual({ ...receipt }, { trigger_kind: "scheduled", status: "completed", processed_count: 2, remaining_count: 0 });
  const history = await (await state.request(route, { headers })).json();
  assert.deepEqual(history.turns.map((turn) => turn.id), [activeTurn]);
});

test("commit-time privileged chat authorization rejects capability, security-policy, and identity-binding races atomically", async () => {
  const state = await sharedProjectFixture();
  const identity = await platformSpecialist(state, "assistant-owner", ["product.delivery.read"]);
  const now = new Date().toISOString();
  state.sqlite.prepare("INSERT OR IGNORE INTO organization_security_policies(organization_id,authentication_source,allowed_domains_json,require_mfa,encryption_mode,max_session_minutes,version,updated_by_user_id,updated_at) VALUES(?,'any','[]',0,'platform-unverified',480,1,?,?)")
    .run(state.organizationId, "assistant-owner", now);
  state.sqlite.prepare("INSERT INTO organization_identity_bindings(binding_id,organization_id,user_id,authentication_source,subject,status,created_at,updated_at,revoked_at) VALUES(?,?,?,'openai-workspace',?,'active',?,?,NULL)")
    .run("platform-race-owner-binding", state.organizationId, "assistant-owner", "assistant-owner", now, now);
  const headers = await platformHeaders(state, "product", identity);
  state.controls.forbidCreatorContentReads = true;
  try {
    for (const [name, mutation] of [
      ["revoked exact capability", () => state.sqlite.prepare("UPDATE capability_grants SET status='revoked',revoked_at=? WHERE user_id=? AND capability=?")
        .run(new Date().toISOString(), "assistant-owner", "product.delivery.read")],
      ["expired exact capability", () => state.sqlite.prepare("UPDATE capability_grants SET expires_at=? WHERE user_id=? AND capability=?")
        .run(new Date(Date.now() - 60_000).toISOString(), "assistant-owner", "product.delivery.read")],
      ["changed organization identity policy", () => state.sqlite.prepare("UPDATE organization_security_policies SET version=version+1,require_mfa=1 WHERE organization_id=?")
        .run(state.organizationId)],
      ["revoked identity binding", () => state.sqlite.prepare("UPDATE organization_identity_bindings SET status='revoked',revoked_at=? WHERE binding_id=?")
        .run(new Date().toISOString(), "platform-race-owner-binding")],
    ]) {
      state.controls.beforePlatformCommit = mutation;
      const denied = await state.request(platformEndpoint("/product/delivery"), json({ turnId: crypto.randomUUID(), message: `Protect this ${name}` }, headers));
      assert.equal(denied.status, 403, `${name}: ${JSON.stringify(await denied.clone().json())}`);
      assert.equal((await denied.json()).error, "assistant_authorization_changed", name);
      for (const table of ["platform_assistant_private_content", "platform_assistant_events", "platform_assistant_commits"]) {
        assert.equal(state.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0, `${name}: ${table}`);
      }
    }
  } finally { state.controls.forbidCreatorContentReads = false; }
});

test("restricted pilot enrollment is independently reverified at the privileged conversation transaction boundary", async () => {
  const state = await sharedProjectFixture();
  const identity = await platformSpecialist(state, "platform-cohort-specialist", ["product.delivery.read"]);
  const now = new Date().toISOString();
  const past = new Date(Date.now() - 60_000).toISOString();
  const future = new Date(Date.now() + 60_000).toISOString();
  state.sqlite.prepare("INSERT INTO pilot_cohorts(cohort_id,organization_id,status,starts_at,ends_at,created_by_user_id,created_at,updated_at) VALUES(?,?,'active',?,?,?, ?,?)")
    .run("platform-commit-cohort", state.organizationId, past, future, "assistant-owner", now, now);
  state.sqlite.prepare("INSERT INTO pilot_participants(participant_id,cohort_id,organization_id,email_normalized,user_id,role,status,invited_by_user_id,created_at,revoked_at) VALUES(?,?,?,?,?,'member','active',?,?,NULL)")
    .run("platform-commit-participant", "platform-commit-cohort", state.organizationId,
      "platform-cohort-specialist@example.test", "platform-cohort-specialist", "assistant-owner", now);
  state.env.FORMA_PILOT_COHORT_ID = "platform-commit-cohort";
  const headers = await platformHeaders(state, "product", identity);
  state.controls.forbidCreatorContentReads = true;
  state.controls.beforePlatformCommit = () => state.sqlite.prepare("UPDATE pilot_participants SET status='revoked',revoked_at=? WHERE participant_id=?")
    .run(new Date().toISOString(), "platform-commit-participant");
  try {
    const denied = await state.request(platformEndpoint("/product/delivery"), json({ turnId: crypto.randomUUID(), message: "Cohort access must remain active" }, headers));
    assert.equal(denied.status, 403, JSON.stringify(await denied.clone().json()));
    assert.equal((await denied.json()).error, "assistant_authorization_changed");
    for (const table of ["platform_assistant_private_content", "platform_assistant_events", "platform_assistant_commits"]) {
      assert.equal(state.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0, table);
    }
    assert.equal(state.sqlite.prepare("SELECT status FROM pilot_participants WHERE participant_id=?").get("platform-commit-participant").status, "active");
  } finally { state.controls.forbidCreatorContentReads = false; }
});

test("reads actual current-document decisions without making a provider call or changing content", async () => {
  const { request, sqlite } = await fixture();
  const beforeBlocks = sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type LIKE 'Block%'").get().count;
  const beforeJobs = sqlite.prepare("SELECT COUNT(*) AS count FROM document_jobs").get().count;
  const response = await request(endpoint());
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  assert.match(response.headers.get("cache-control"), /private, no-store/u);
  const result = await response.json();
  assert.equal(result.context.scope.documentId, "doc-atmosphere");
  assert.equal(result.context.scope.actorUserId, "dev-local-creative");
  assert.ok(result.context.decisionAtoms.length > 0);
  assert.ok(result.context.availableOutputKinds.includes("audio"));
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type LIKE 'Block%'").get().count, beforeBlocks);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM document_jobs").get().count, beforeJobs);
});

test("logs actor-private independent turns and never mutates blocks or starts paid work", async () => {
  const { request, sqlite } = await fixture();
  const beforeBlocks = sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type LIKE 'Block%'").get().count;
  const beforeJobs = sqlite.prepare("SELECT COUNT(*) AS count FROM document_jobs").get().count;
  const firstId = crypto.randomUUID();
  const secondId = crypto.randomUUID();
  const first = await request(endpoint(), json({ turnId: firstId, message: "What audio is available?" }));
  assert.equal(first.status, 201, JSON.stringify(await first.clone().json()));
  const reply = await first.json();
  assert.equal(reply.turn.reply.key, "assistant.response.output");
  assert.equal(reply.turn.reply.values.kind, "audio");
  assert.equal(reply.turn.proposal.kind, "navigate");
  const second = await request(endpoint(), json({ turnId: secondId, message: "Explain the direction" }));
  assert.equal(second.status, 201, JSON.stringify(await second.clone().json()));
  const repeat = await request(endpoint(), json({ turnId: firstId, message: "What audio is available?" }));
  assert.equal(repeat.status, 200);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM assistant_turns").get().count, 2);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type LIKE 'Block%'").get().count, beforeBlocks);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM document_jobs").get().count, beforeJobs);
  const payloads = sqlite.prepare("SELECT payload FROM events WHERE correlation_id IN (?,?)").all(`dev-local-creative:${firstId}`, `dev-local-creative:${secondId}`).map((row) => row.payload).join("\n");
  assert.equal(payloads.split("\n").length, 4);
  assert.doesNotMatch(payloads, /What audio is available|Explain the direction/u);
  const replies = sqlite.prepare("SELECT content FROM private_content WHERE owner_id=? AND kind='chat-assistant' ORDER BY created_at").all("dev-local-creative");
  assert.ok(replies.every((item) => !item.content.startsWith("{")), "existing document chat must display readable replies, never internal JSON");
  assert.match(replies.map((item) => item.content).join("\n"), /audio/u);
  const history = await (await request(endpoint())).json();
  assert.deepEqual(history.turns.map((turn) => turn.id), [firstId, secondId]);
});

test("authorized changes become separately reviewable actor-private proposals without mutating work", async () => {
  const { request, sqlite } = await fixture({ actions: true });
  const beforeBlocks = sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type LIKE 'Block%'").get().count;
  const turnId = crypto.randomUUID();
  const message = "Add audience: PRIVATE urban gardeners; Add palette: PRIVATE forest green; Add audio: PRIVATE warm analog score";
  const response = await request(endpoint(), json({ turnId, message }));
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
  const result = await response.json();
  assert.deepEqual(result.turn.proposals.map((item) => item.kind), ["context.create", "context.create", "context.create"]);
  assert.deepEqual(result.turn.proposals.map((item) => item.summary), ["Add audience: PRIVATE urban gardeners", "Add palette: PRIVATE forest green", "Add audio: PRIVATE warm analog score"]);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type LIKE 'Block%'").get().count, beforeBlocks);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM assistant_action_proposals WHERE status='pending'").get().count, 3);
  const envelopes = sqlite.prepare("SELECT payload FROM events WHERE correlation_id=?").all(`dev-local-creative:${turnId}`).map((row) => row.payload).join("\n");
  assert.doesNotMatch(envelopes, /PRIVATE urban|PRIVATE forest|PRIVATE warm/u);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type='MutationProposed' AND correlation_id=?").get(`dev-local-creative:${turnId}`).count, 3);
  const persisted = sqlite.prepare("SELECT proposal_json FROM assistant_turns WHERE actor_user_id=? AND turn_id=?").get("dev-local-creative", turnId).proposal_json;
  assert.doesNotMatch(persisted, /PRIVATE urban|PRIVATE forest|PRIVATE warm/u);
  const history = await (await request(endpoint())).json();
  assert.deepEqual(history.turns.find((item) => item.id === turnId).proposals.map((item) => item.summary), result.turn.proposals.map((item) => item.summary));
});

test("shared pending changes remain private and viewers cannot acquire authoring by feature enrollment", async () => {
  const { request, sqlite, owner, viewer, projectAccessId } = await sharedProjectFixture({ actions: true });
  const turnId = crypto.randomUUID();
  const own = await request(endpoint(), json({ turnId, message: "Add palette: OWNER PRIVATE cobalt" }, owner));
  assert.equal(own.status, 201, JSON.stringify(await own.clone().json()));
  const proposal = (await own.json()).turn.proposal;
  assert.equal(proposal.kind, "context.create");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM assistant_action_proposals WHERE project_access_id=?").get(projectAccessId).count, 1);
  const read = await request(endpoint(), { headers: viewer });
  assert.equal(read.status, 200);
  assert.doesNotMatch(JSON.stringify(await read.json()), /OWNER PRIVATE cobalt/u);
  const ask = await request(endpoint(), json({ turnId: crypto.randomUUID(), message: "Add palette: VIEWER MUST NOT AUTHOR" }, viewer));
  assert.equal(ask.status, 201);
  assert.equal((await ask.json()).turn.proposal, null);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM assistant_action_proposals WHERE project_access_id=?").get(projectAccessId).count, 1);
});

test("paid specialists never dispatch missing or revoked rights, incomplete protected wording, or unsupported document synthesis",async()=>{
  const scope={project_id:"project-atmosphere",document_id:"doc-atmosphere"};
  const source=(referenceId)=>["BlockCreated",{...scope,block_id:`source-${referenceId}`,type:"reference",handle:`reference/${referenceId}`,
    position:"z901",properties:{text:"Licensed source must remain protected.",reference_id:referenceId,rights_class:"owned_or_licensed",weight:.8}}];
  const cases=[
    {name:"missing source-rights receipt",events:[source("missing-receipt")],reason:"rights"},
    {name:"revoked source-rights receipt",events:[source("revoked-receipt"),["RightsAsserted",{...scope,reference_id:"revoked-receipt",rights_class:"revoked"}]],reason:"rights"},
    {name:"expired source-rights boundary",events:[["BlockCreated",{...scope,block_id:"expired-message",type:"message",handle:"message/expired",position:"z902",
      properties:{text:"Expired campaign claim",rights_expires_at:new Date(Date.now()-60_000).toISOString(),weight:.8}}]],reason:"rights"},
    {name:"truncated mandatory exact wording",events:[["BlockCreated",{...scope,block_id:"required-long",type:"message",handle:"message/exact",position:"z903",
      properties:{text:"必".repeat(340),exact_text:"必".repeat(340),weight:.8}}]],reason:"protected"},
    {name:"protected multilingual context exceeds its safe payload budget",events:Array.from({length:16},(_,index)=>["BlockCreated",{
      ...scope,block_id:`required-${index}`,type:"exclusion",handle:`exclusion/required-${index}`,position:`z${String(index).padStart(3,"0")}`,
      properties:{text:"必".repeat(320),intent:"prohibit",weight:.8},
    }]),reason:"coverage"},
    {name:"unsupported cross-document synthesis",events:[],message:"Compare the context across documents",reason:"scope"},
  ];
  const originalFetch=globalThis.fetch;
  let calls=0;
  globalThis.fetch=async()=>{calls+=1;throw new Error("unsafe assistant context must never reach a paid provider");};
  try{
    for(const scenario of cases){
      const state=await fixture({provider:true});
      appendFixtureEvents(state.sqlite,"creative:dev-local-creative",scenario.events);
      const response=await state.request(endpoint(),json({turnId:crypto.randomUUID(),message:scenario.message??"Explain the approved creative context"}));
      assert.equal(response.status,201,`${scenario.name}: ${JSON.stringify(await response.clone().json())}`);
      const result=await response.json();
      assert.equal(result.task,undefined,`${scenario.name} never creates a chargeable specialist task`);
      if(scenario.reason==="rights")assert.ok(result.context.totals.unsafeRightsDecisions>0,scenario.name);
      if(scenario.reason==="protected")assert.ok(result.context.totals.truncatedProtectedDecisions>0,scenario.name);
      if(scenario.reason==="coverage")assert.ok(result.context.decisionAtoms.filter((decision)=>decision.providerEligible&&decision.protected).length
        <result.context.totals.protectedDecisions,scenario.name);
      assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM assistant_specialist_tasks").get().count,0,scenario.name);
      await state.drainBackground();
      assert.equal(calls,0,scenario.name);
    }
  }finally{globalThis.fetch=originalFetch;}
});

test("Luna specialist runs asynchronously against bounded page-aware views and settles exact usage", async () => {
  const state = await fixture({ provider: true });
  const originalFetch = globalThis.fetch;
  const submissions = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://api.openai.com/v1/responses");
    const body = JSON.parse(init.body);
    submissions.push(body);
    return Response.json({
      id: "assistant-provider-luna",
      model: body.model,
      output_text: JSON.stringify({ reply: "This document already supports audio and other current output formats.", actions: [] }),
      usage: { input_tokens: 1000, output_tokens: 200, total_tokens: 1200 },
    });
  };
  try {
    const response = await state.request(endpoint(), json({ turnId: crypto.randomUUID(), message: "What outputs are available now?", locale: "en" }));
    assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
    const accepted = await response.json();
    assert.ok(accepted.task, `The provider-enabled message did not receive a durable specialist: ${state.controls.lastDatabaseError}`);
    assert.equal(accepted.task.model, "gpt-5.6-luna");
    assert.equal(accepted.task.estimatedMicrousd, 4000);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM assistant_specialist_tasks").get().count, 1);
    await state.drainBackground();
    assert.equal(submissions.length, 1);
    assert.equal(submissions[0].model, "gpt-5.6-luna");
    assert.equal(submissions[0].store, false);
    assert.equal(submissions[0].max_output_tokens, 1600);
    const delivered = JSON.parse(submissions[0].input);
    assert.equal(delivered.page, "document");
    assert.equal(delivered.available_formats.includes("audio"), true);
    assert.doesNotMatch(submissions[0].input, /dev-local-creative|project-atmosphere|doc-atmosphere|content_ref|allow_provider_audio_transfer/u);
    assert.equal(state.sqlite.prepare("SELECT status FROM assistant_specialist_tasks").get().status, "completed");
    assert.equal(state.sqlite.prepare("SELECT used_microusd,reserved_microusd FROM cost_budget_counters WHERE scope='user' AND scope_id=?").get("dev-local-creative").used_microusd, 440);
    assert.equal(state.sqlite.prepare("SELECT used_tokens,reserved_tokens FROM budget_counters WHERE scope='user' AND scope_id=?").get("dev-local-creative").used_tokens, 1200);
    const updated = await (await state.request(endpoint())).json();
    assert.match(updated.turns.at(-1).reply.text, /already supports audio/u);
    assert.equal(updated.tasks[0].status, "completed");

    let creativeProviderInput;
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(init.body);
      creativeProviderInput = JSON.parse(body.input);
      return Response.json({ id: "direct-follow-up", model: body.model,
        output_text: JSON.stringify({ reply: "Direct creative follow-up succeeded.", mutations: [], preview_worthy: false, preview_direction: "" }),
        usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } });
    };
    const direct = await state.request("/api/document-jobs", json({ kind: "chat", documentId: "doc-atmosphere", sourceSurface: "chat",
      payload: { message: "Use what you explained", livePreview: false } }));
    assert.equal(direct.status, 202, JSON.stringify(await direct.clone().json()));
    await state.drainBackground();
    assert.ok(creativeProviderInput);
    assert.equal(creativeProviderInput.history.filter((item) => item.role === "assistant" && item.text.includes("already supports audio")).length,
      1, JSON.stringify(creativeProviderInput.history));
  } finally { globalThis.fetch = originalFetch; }
});

test("Terra suggestions remain separate private proposals and cannot create content until approved", async () => {
  const state = await fixture({ provider: true, actions: true });
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (_url, init) => {
    const submitted = JSON.parse(init.body);
    requests.push(submitted);
    return Response.json({
      id: "assistant-terra-proposal",
      model: submitted.model,
      output_text: JSON.stringify({ reply: "I prepared independent palette and emotional-direction suggestions.", actions: [{
        kind: "context.create",
        block_type: "emotion",
        target_block_id: null,
        from_block_id: null,
        to_block_id: null,
        relation_kind: "",
        intent: "include",
        text: "A calm, welcoming neighborhood atmosphere",
      }] }),
      usage: { input_tokens: 900, output_tokens: 120, total_tokens: 1020 },
    });
  };
  try {
    const before = state.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type='BlockCreated'").get().count;
    const response = await state.request(endpoint(), json({ turnId: crypto.randomUUID(), message: "Add palette: twilight cobalt" }));
    assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
    const accepted = await response.json();
    assert.equal(accepted.task.model, "gpt-5.6-terra");
    assert.equal(accepted.task.estimatedMicrousd, 40_000);
    await state.drainBackground();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].model, "gpt-5.6-terra");
    assert.equal(state.sqlite.prepare("SELECT status FROM assistant_specialist_tasks").get().status, "completed");
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type='BlockCreated'").get().count, before);
    const history = await (await state.request(endpoint())).json();
    assert.deepEqual(history.turns.at(-1).proposals.map((item) => item.summary), ["Add palette: twilight cobalt", "A calm, welcoming neighborhood atmosphere"]);
    const immutable = state.sqlite.prepare("SELECT payload FROM events WHERE correlation_id=?").all(`assistant-specialist:dev-local-creative:${accepted.turn.id}`).map((row) => row.payload).join("\n");
    assert.doesNotMatch(immutable, /calm, welcoming|twilight cobalt/u);
    assert.equal(state.sqlite.prepare("SELECT used_microusd FROM cost_budget_counters WHERE scope='user' AND scope_id=?").get("dev-local-creative").used_microusd, 3240);
  } finally { globalThis.fetch = originalFetch; }
});

test("two independent specialists run concurrently, the composer stays open, and queued cancellation releases exact budgets", async () => {
  const state = await fixture({ provider: true });
  const originalFetch = globalThis.fetch;
  const gates = [];
  const bothStarted = Promise.withResolvers();
  globalThis.fetch = async (_url, init) => {
    const payload = JSON.parse(init.body);
    const gate = Promise.withResolvers();
    gates.push(gate);
    if (gates.length === 2) bothStarted.resolve();
    await gate.promise;
    return Response.json({ id: `assistant-concurrent-${gates.length}`, model: payload.model,
      output_text: JSON.stringify({ reply: "A focused answer is ready.", actions: [] }),
      usage: { input_tokens: 100, output_tokens: 30, total_tokens: 130 } });
  };
  try {
    const first = await state.request(endpoint(), json({ turnId: crypto.randomUUID(), message: "Explain the current direction" }));
    assert.equal(first.status, 201);
    const second = await state.request(endpoint(), json({ turnId: crypto.randomUUID(), message: "What results already exist?" }));
    assert.equal(second.status, 201);
    await bothStarted.promise;
    const thirdResponse = await state.request(endpoint(), json({ turnId: crypto.randomUUID(), message: "What is a useful next step?" }));
    assert.equal(thirdResponse.status, 201);
    const third = (await thirdResponse.json()).task;
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM assistant_specialist_tasks WHERE status='running'").get().count, 2);
    assert.equal(state.sqlite.prepare("SELECT status FROM assistant_specialist_tasks WHERE task_id=?").get(third.id).status, "queued");
    const canceled = await state.request(endpoint().replace("/api/assistant?", `/api/assistant/tasks/${encodeURIComponent(third.id)}/cancel?`), { method: "POST" });
    assert.equal(canceled.status, 200, JSON.stringify(await canceled.clone().json()));
    assert.equal(state.sqlite.prepare("SELECT status FROM assistant_specialist_tasks WHERE task_id=?").get(third.id).status, "canceled");
    assert.equal(gates.length, 2);
    for (const gate of gates) gate.resolve();
    await state.drainBackground();
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM assistant_specialist_tasks WHERE status='completed'").get().count, 2);
    assert.equal(state.sqlite.prepare("SELECT reserved_microusd FROM cost_budget_counters WHERE scope='user' AND scope_id=?").get("dev-local-creative").reserved_microusd, 0);
    assert.equal(state.sqlite.prepare("SELECT reserved_tokens FROM budget_counters WHERE scope='user' AND scope_id=?").get("dev-local-creative").reserved_tokens, 0);
  } finally {
    for (const gate of gates) gate.resolve();
    await state.drainBackground();
    globalThis.fetch = originalFetch;
  }
});

test("premium Sol requires exact model policy, administrator enrollment, and explicit approval", async () => {
  const state = await fixture({ provider: true, models: "gpt-5.6-luna,gpt-5.6-terra,gpt-5.6-sol", solUsers: "dev-local-creative" });
  const session = await (await state.request("/api/session")).json();
  assert.deepEqual(session.assistant.models, [
    { id: "gpt-5.6-luna", maximumMicrousd: 4000, premiumApprovalRequired: false },
    { id: "gpt-5.6-terra", maximumMicrousd: 40_000, premiumApprovalRequired: false },
    { id: "gpt-5.6-sol", maximumMicrousd: 100_000, premiumApprovalRequired: true },
  ]);
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (_url, init) => {
    const payload = JSON.parse(init.body);
    requests.push(payload);
    return Response.json({ id: "assistant-sol", model: payload.model,
      output_text: JSON.stringify({ reply: "The relevant governance decisions are ready for your review.", actions: [] }),
      usage: { input_tokens: 200, output_tokens: 40, total_tokens: 240 } });
  };
  try {
    const blocked = await state.request(endpoint(), json({ turnId: crypto.randomUUID(), message: "Review governance and compliance policy", model: "gpt-5.6-sol" }));
    assert.equal(blocked.status, 201);
    assert.equal((await blocked.json()).task, undefined);
    assert.equal(requests.length, 0);
    const downgraded = await state.request(endpoint(), json({ turnId: crypto.randomUUID(), message: "Review governance and compliance policy", model: "gpt-5.6-luna", premiumApproval: true }));
    assert.equal(downgraded.status, 201);
    assert.equal((await downgraded.json()).task, undefined);
    const approved = await state.request(endpoint(), json({ turnId: crypto.randomUUID(), message: "Review governance and compliance policy", model: "gpt-5.6-sol", premiumApproval: true }));
    assert.equal(approved.status, 201);
    assert.equal((await approved.json()).task.model, "gpt-5.6-sol");
    await state.drainBackground();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].model, "gpt-5.6-sol");
    assert.equal(state.sqlite.prepare("SELECT used_microusd FROM cost_budget_counters WHERE scope='user' AND scope_id=?").get("dev-local-creative").used_microusd, 2200);
  } finally { globalThis.fetch = originalFetch; }
});

test("definitive provider rejections visibly fail and release both reserved budgets without retrying", async () => {
  const state = await fixture({ provider: true });
  const originalFetch = globalThis.fetch;
  let submissions = 0;
  globalThis.fetch = async () => { submissions += 1; return new Response("Temporarily unavailable", { status: 503 }); };
  try {
    const response = await state.request(endpoint(), json({ turnId: crypto.randomUUID(), message: "What should I review?" }));
    assert.equal(response.status, 201);
    const task = (await response.json()).task;
    await state.drainBackground();
    assert.deepEqual({ ...state.sqlite.prepare("SELECT status,error_code FROM assistant_specialist_tasks WHERE task_id=?").get(task.id) },
      { status: "failed", error_code: "assistant_provider_http_503" });
    assert.equal(state.sqlite.prepare("SELECT reserved_microusd FROM cost_budget_counters WHERE scope='user' AND scope_id=?").get("dev-local-creative").reserved_microusd, 0);
    assert.equal(state.sqlite.prepare("SELECT reserved_tokens FROM budget_counters WHERE scope='user' AND scope_id=?").get("dev-local-creative").reserved_tokens, 0);
    assert.equal((await (await state.request(endpoint())).json()).tasks.find((item) => item.id === task.id).status, "failed");
    assert.equal(submissions, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test("ambiguous provider submission remains reserved and cannot be self-reconciled by its administrator", async () => {
  const state = await fixture({ provider: true });
  const originalFetch = globalThis.fetch;
  let submissions = 0;
  globalThis.fetch = async () => { submissions += 1; throw new TypeError("network disconnected after submission"); };
  try {
    const response = await state.request(endpoint(), json({ turnId: crypto.randomUUID(), message: "What is the current direction?" }));
    const task = (await response.json()).task;
    await state.drainBackground();
    assert.equal(state.sqlite.prepare("SELECT status FROM assistant_specialist_tasks WHERE task_id=?").get(task.id).status, "needs-review");
    assert.equal(state.sqlite.prepare("SELECT reserved_microusd FROM cost_budget_counters WHERE scope='user' AND scope_id=?").get("dev-local-creative").reserved_microusd, 4000);
    assert.equal(state.sqlite.prepare("SELECT reserved_tokens FROM budget_counters WHERE scope='user' AND scope_id=?").get("dev-local-creative").reserved_tokens, 12_000);
    assert.equal((await (await state.request(endpoint())).json()).tasks.find((item) => item.id === task.id).status, "needs-review");
    assert.equal((await state.request(taskEndpoint(task.id, "cancel"), { method: "POST" })).status, 409);
    assert.equal((await state.request(taskEndpoint(task.id, "reconcile"), { method: "POST" })).status, 400);
    assert.equal((await state.request(taskEndpoint(task.id, "reconcile"), json({ confirmedNoProviderCharge: false }))).status, 400);
    const denied = await state.request(taskEndpoint(task.id, "reconcile"), json({ confirmedNoProviderCharge: true }));
    assert.equal(denied.status, 403, JSON.stringify(await denied.clone().json()));
    assert.equal((await denied.json()).error, "assistant_independent_reviewer_required");
    assert.equal(state.sqlite.prepare("SELECT status FROM assistant_specialist_tasks WHERE task_id=?").get(task.id).status, "needs-review");
    assert.equal(state.sqlite.prepare("SELECT reserved_microusd FROM cost_budget_counters WHERE scope='user' AND scope_id=?").get("dev-local-creative").reserved_microusd, 4000);
    assert.equal(state.sqlite.prepare("SELECT reserved_tokens FROM budget_counters WHERE scope='user' AND scope_id=?").get("dev-local-creative").reserved_tokens, 12_000);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM assistant_billing_reconciliations WHERE task_id=?").get(task.id).count, 0);
    assert.equal(submissions, 1, "an uncertain paid request must never be submitted to its provider twice");
  } finally { globalThis.fetch = originalFetch; }
});

test("an exact authorized organization administrator can reconcile a different shared creator without accessing private conversation", async () => {
  const state = await sharedProjectFixture({ provider: true });
  const ownerSession = await (await state.request("/api/session", { headers: state.owner })).json();
  assert.equal(ownerSession.user.role, "creator", "the actor reproducing the failure must be a real nonadministrator creator");
  const adminSession = await (await state.request("/api/session")).json();
  assert.equal(adminSession.user.role, "admin");
  assert.notEqual(ownerSession.user.userId, adminSession.user.userId);
  const originalFetch = globalThis.fetch;
  let submissions = 0;
  globalThis.fetch = async () => { submissions += 1; throw new TypeError("provider submission could not be verified"); };
  try {
    const userMessage = "PRIVATE SHARED CREATOR STRATEGY must never reach the administrator";
    const started = await state.request(endpoint(), json({ turnId: crypto.randomUUID(), message: userMessage }, state.owner));
    assert.equal(started.status, 201, JSON.stringify(await started.clone().json()));
    const task = (await started.json()).task;
    await state.drainBackground();
    assert.equal(state.sqlite.prepare("SELECT status FROM assistant_specialist_tasks WHERE task_id=?").get(task.id).status, "needs-review");
    const billingUrl = `/api/platform/assistant/billing/${encodeURIComponent(task.id)}/reconcile`;
    const confirmation = { actorUserId: "assistant-owner", organizationId: state.organizationId,
      projectAccessId: state.projectAccessId, confirmedNoProviderCharge: true };

    assert.equal((await state.request(taskEndpoint(task.id, "reconcile"), json({ confirmedNoProviderCharge: true }, state.owner))).status, 403);
    assert.equal((await state.request(billingUrl, json(confirmation, state.owner))).status, 403);
    assert.equal((await state.request(billingUrl, json(confirmation, state.viewer))).status, 403);
    assert.equal((await state.request(billingUrl, json(confirmation))).status, 403, "a platform admin from another tenant must not recover this tenant's budget");
    assert.equal((await state.request("/api/platform/assistant/billing")).status, 404, "there must be no generic cross-tenant task enumeration endpoint");

    const invited = await state.request(`/api/workspaces/${state.organizationId}/members`,
      json({ email: adminSession.user.email, role: "administrator" }, state.owner));
    assert.equal(invited.status, 201, JSON.stringify(await invited.clone().json()));
    const invitation = await invited.json();
    const token = new URL(invitation.invitationUrl).searchParams.get("token");
    assert.equal((await state.request(`/api/workspaces/${state.organizationId}/invitations/${invitation.invitationId}/accept`, json({ token }))).status, 200);
    assert.equal((await state.request(billingUrl, json(confirmation))).status, 403,
      "organization administration alone must not cross into a project without its own active authoring authority");
    const membership = await state.request(`/api/workspaces/${state.organizationId}/projects/${state.projectAccessId}/members`,
      json({ userId: adminSession.user.userId, role: "editor" }, state.owner));
    assert.equal(membership.status, 201, JSON.stringify(await membership.clone().json()));

    assert.equal((await state.request(billingUrl, json({ ...confirmation, actorUserId: "assistant-viewer" }))).status, 403);
    assert.equal((await state.request(billingUrl, json({ ...confirmation, confirmedNoProviderCharge: false }))).status, 400);
    assert.equal((await state.request(billingUrl, json({ ...confirmation, projectAccessId: "wrong-project" }))).status, 403);
    state.sqlite.prepare("UPDATE project_memberships SET status='revoked',revoked_at=? WHERE project_access_id=? AND user_id=?")
      .run(new Date().toISOString(), state.projectAccessId, adminSession.user.userId);
    assert.equal((await state.request(billingUrl, json(confirmation))).status, 403, "revoked project membership must immediately terminate billing access");
    state.sqlite.prepare("UPDATE project_memberships SET status='active',revoked_at=NULL WHERE project_access_id=? AND user_id=?")
      .run(state.projectAccessId, adminSession.user.userId);
    state.sqlite.prepare("UPDATE organization_memberships SET role='member' WHERE organization_id=? AND user_id=?")
      .run(state.organizationId, adminSession.user.userId);
    assert.equal((await state.request(billingUrl, json(confirmation))).status, 403, "project editors without organization budget authority must not reconcile another actor");
    state.sqlite.prepare("UPDATE organization_memberships SET role='administrator' WHERE organization_id=? AND user_id=?")
      .run(state.organizationId, adminSession.user.userId);

    state.controls.failAssistantBillingAudit = true;
    assert.equal((await state.request(billingUrl, json(confirmation))).status, 409);
    assert.equal(state.sqlite.prepare("SELECT status FROM assistant_specialist_tasks WHERE task_id=?").get(task.id).status, "needs-review");
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM assistant_billing_reconciliations WHERE task_id=?").get(task.id).count, 0);
    assert.equal(state.sqlite.prepare("SELECT reserved_microusd FROM cost_budget_counters WHERE scope='user' AND scope_id=?").get("assistant-owner").reserved_microusd, 4000);

    state.controls.failAssistantBillingCostSettlement = true;
    assert.equal((await state.request(billingUrl, json(confirmation))).status, 409);
    assert.equal(state.sqlite.prepare("SELECT status FROM assistant_specialist_tasks WHERE task_id=?").get(task.id).status, "reconciling",
      "an interrupted audited release must remain truthful and explicitly resumable");
    assert.equal((await (await state.request(endpoint(), { headers: state.owner })).json()).tasks.find((item) => item.id === task.id).status, "reconciling",
      "the real creator interface must retain the exact recoverable task and its private administrator review reference");
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM assistant_billing_reconciliations WHERE task_id=?").get(task.id).count, 1);
    assert.equal(state.sqlite.prepare("SELECT reserved_microusd FROM cost_budget_counters WHERE scope='user' AND scope_id=?").get("assistant-owner").reserved_microusd, 4000);
    const result = await state.request(billingUrl, json(confirmation));
    assert.equal(result.status, 200, JSON.stringify(await result.clone().json()));
    assert.deepEqual(await result.json(), { taskId: task.id, status: "reconciled" });
    assert.equal(state.sqlite.prepare("SELECT reserved_microusd FROM cost_budget_counters WHERE scope='user' AND scope_id=?").get("assistant-owner").reserved_microusd, 0);
    assert.equal(state.sqlite.prepare("SELECT reserved_tokens FROM budget_counters WHERE scope='user' AND scope_id=?").get("assistant-owner").reserved_tokens, 0);
    assert.equal(state.sqlite.prepare("SELECT reserved_microusd FROM cost_budget_counters WHERE scope='workspace' AND scope_id=?").get(state.organizationId).reserved_microusd, 0);
    assert.equal(state.sqlite.prepare("SELECT reserved_tokens FROM budget_counters WHERE scope='workspace' AND scope_id=?").get(state.organizationId).reserved_tokens, 0);
    const audit = state.sqlite.prepare("SELECT task_id,actor_user_id,reviewer_user_id,organization_id,project_access_id,evidence_classification FROM assistant_billing_reconciliations WHERE task_id=?")
      .get(task.id);
    assert.deepEqual({ ...audit }, { task_id: task.id, actor_user_id: "assistant-owner", reviewer_user_id: adminSession.user.userId,
      organization_id: state.organizationId, project_access_id: state.projectAccessId, evidence_classification: "verified-no-provider-charge" });
    const organizationAudit = state.sqlite.prepare("SELECT action,actor_user_id,detail_json FROM organization_audit_events WHERE organization_id=? AND resource_id=? AND action='AssistantProviderChargeReconciled'")
      .get(state.organizationId, task.id);
    assert.equal(organizationAudit.actor_user_id, adminSession.user.userId);
    assert.doesNotMatch(JSON.stringify(audit) + organizationAudit.detail_json, /PRIVATE SHARED|CREATOR STRATEGY|source|document|prompt|content_ref/iu);
    assert.throws(() => state.sqlite.prepare("UPDATE assistant_billing_reconciliations SET evidence_classification='changed' WHERE task_id=?").run(task.id), /append-only/u);
    assert.throws(() => state.sqlite.prepare("DELETE FROM assistant_billing_reconciliations WHERE task_id=?").run(task.id), /append-only/u);
    const repeated = await state.request(billingUrl, json(confirmation));
    assert.equal(repeated.status, 200);
    assert.equal((await repeated.json()).idempotent, true);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM assistant_billing_reconciliations WHERE task_id=?").get(task.id).count, 1);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM organization_audit_events WHERE action='AssistantProviderChargeReconciled' AND resource_id=?").get(task.id).count, 1);
    assert.equal(submissions, 1, "administrative reconciliation must never retry an ambiguous paid submission");
  } finally { globalThis.fetch = originalFetch; }
});

test("tenant deletion refuses an independently unresolved organization-scoped assistant submission",async()=>{
  const state=await sharedProjectFixture({provider:true});
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>{throw new TypeError("provider completion could not be confirmed");};
  try{
    const started=await state.request(endpoint(),json({turnId:crypto.randomUUID(),message:"Explain the approved source context"},state.owner));
    assert.equal(started.status,201,JSON.stringify(await started.clone().json()));
    const task=(await started.json()).task;
    await state.drainBackground();
    const removed=await state.request(`/api/workspaces/${state.organizationId}/deletion`,json({confirmation:"DELETE_ORGANIZATION_AND_SCOPED_DATA",organizationId:state.organizationId},state.owner));
    assert.equal(removed.status,409,JSON.stringify(await removed.clone().json()));
    const response=await removed.json();
    assert.equal(response.error,"provider_submission_in_flight");
    assert.equal(response.assistantTasks[0].taskId,task.id);
    assert.equal(state.sqlite.prepare("SELECT status FROM organizations WHERE organization_id=?").get(state.organizationId).status,"active");
    assert.equal(state.sqlite.prepare("SELECT status FROM assistant_specialist_tasks WHERE task_id=?").get(task.id).status,"needs-review");
  }finally{globalThis.fetch=originalFetch;}
});

test("tenant deletion preserves unresolved scoped video recovery and any executing image reservation",async()=>{
  for(const scenario of ["video","image"]){
    const state=await sharedProjectFixture();
    const now=new Date().toISOString();
    if(scenario==="video"){
      state.sqlite.prepare("INSERT INTO document_jobs(job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,request_json,result_json,attempt_count,requested_at,expires_at,updated_at) VALUES(?,?,?,?,?,'running',?,?,?, ?,?,1,?,?,?)")
        .run("strict-unresolved-video","assistant-owner","creative:assistant-owner","doc-atmosphere","render_document","project","strict-video-attempt",1,
          JSON.stringify({artifactKind:"video"}),JSON.stringify({providerJobId:"private-provider-video",productionSceneReceipts:{one:{status:"submitted"}}}),now,new Date(Date.now()+86_400_000).toISOString(),now);
      const anchor=crypto.randomUUID(),sequence=Number(state.sqlite.prepare("SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?").get("creative:assistant-owner").head)+1;
      state.sqlite.prepare("INSERT INTO events(event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,causation_id,compensates_event_id,schema_version,type,payload) VALUES(?,?,?,?,?,?,?,?,NULL,NULL,1,?,?)")
        .run(anchor,"creative:assistant-owner",sequence,now,now,"user:assistant-owner","strict-video","strict-video-attempt","ProjectDocumentJobQueued",
          JSON.stringify({job_id:"strict-unresolved-video",organization_id:state.organizationId,project_access_id:state.projectAccessId,actor_user_id:"assistant-owner"}));
      state.sqlite.prepare("INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,visibility,source_event_id,actor_user_id,created_at) VALUES(?,'job',?,?,?,?,'actor_private',?,?,?)")
        .run(state.projectAccessId,"strict-unresolved-video",state.organizationId,"project-atmosphere","assistant-owner",anchor,"assistant-owner",now);
      const canceled=await state.request("/api/document-jobs/strict-unresolved-video/cancel",{method:"POST",headers:state.owner});
      assert.equal(canceled.status,409,JSON.stringify(await canceled.clone().json()));
      assert.equal((await canceled.json()).error,"provider_submission_in_flight","direct cancellation cannot erase recoverable paid video evidence");
    }else{
      state.sqlite.prepare("INSERT INTO document_jobs(job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,request_json,result_json,attempt_count,requested_at,expires_at,updated_at) VALUES(?,?,?,?,?,'running',?,?,?, ?,?,1,?,?,?)")
        .run("strict-running-image","assistant-owner","creative:assistant-owner","doc-atmosphere","generate","project","strict-image-attempt",1,
          JSON.stringify({}),JSON.stringify({}),now,new Date(Date.now()+86_400_000).toISOString(),now);
      const anchor=crypto.randomUUID(),sequence=Number(state.sqlite.prepare("SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?").get("creative:assistant-owner").head)+1;
      state.sqlite.prepare("INSERT INTO events(event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,causation_id,compensates_event_id,schema_version,type,payload) VALUES(?,?,?,?,?,?,?,?,NULL,NULL,1,?,?)")
        .run(anchor,"creative:assistant-owner",sequence,now,now,"user:assistant-owner","strict-image","strict-image-attempt","ProjectDocumentJobQueued",
          JSON.stringify({job_id:"strict-running-image",organization_id:state.organizationId,project_access_id:state.projectAccessId,actor_user_id:"assistant-owner"}));
      state.sqlite.prepare("INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,visibility,source_event_id,actor_user_id,created_at) VALUES(?,'job',?,?,?,?,'actor_private',?,?,?)")
        .run(state.projectAccessId,"strict-running-image",state.organizationId,"project-atmosphere","assistant-owner",anchor,"assistant-owner",now);
      state.sqlite.prepare("INSERT INTO cost_budget_reservations(reservation_id,owner_id,workspace_id,stream_id,correlation_id,operation,period,reserved_microusd,used_microusd,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,0,'executing',?,?)")
        .run("strict-executing-image","assistant-owner",state.organizationId,"creative:assistant-owner","strict-image-attempt","generate",now.slice(0,7),25_000,now,now);
      state.sqlite.prepare("INSERT INTO project_budget_reservation_scopes(reservation_kind,reservation_id,organization_id,project_access_id,actor_user_id,workspace_scope_id,created_at) VALUES('usd',?,?,?,?,?,?)")
        .run("strict-executing-image",state.organizationId,state.projectAccessId,"assistant-owner",state.organizationId,now);
      const canceled=await state.request("/api/document-jobs/strict-running-image/cancel",{method:"POST",headers:state.owner});
      assert.equal(canceled.status,409,JSON.stringify(await canceled.clone().json()));
      assert.equal((await canceled.json()).error,"provider_submission_in_flight","direct cancellation cannot erase an executing image reservation");
      assert.equal(state.sqlite.prepare("SELECT status FROM document_jobs WHERE job_id=?").get("strict-running-image").status,"running");
      assert.equal(state.sqlite.prepare("SELECT status FROM cost_budget_reservations WHERE reservation_id=?").get("strict-executing-image").status,"executing");
    }
    const removed=await state.request(`/api/workspaces/${state.organizationId}/deletion`,json({confirmation:"DELETE_ORGANIZATION_AND_SCOPED_DATA",organizationId:state.organizationId},state.owner));
    assert.equal(removed.status,409,`${scenario}: ${JSON.stringify(await removed.clone().json())}`);
    const blocked=await removed.json();
    assert.equal(blocked.error,"provider_submission_in_flight",scenario);
    assert.equal(scenario==="video"?blocked.documentJobs[0].jobId:blocked.costReservations[0].reservationId,
      scenario==="video"?"strict-unresolved-video":"strict-executing-image",scenario);
    assert.equal(state.sqlite.prepare("SELECT status FROM organizations WHERE organization_id=?").get(state.organizationId).status,"active",scenario);
  }
});

test("tenant deletion atomically rejects a provider submission that races its final destructive claim",async()=>{
  const state=await sharedProjectFixture({provider:true});
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>{throw new Error("the deletion race fixture must not contact a provider");};
  try{
    state.controls.skipAssistantTaskClaimOnce=true;
    const started=await state.request(endpoint(),json({turnId:crypto.randomUUID(),message:"Explain the approved source context"},state.owner));
    assert.equal(started.status,201,JSON.stringify(await started.clone().json()));
    const task=(await started.json()).task;
    await state.drainBackground();
    state.controls.beforeDeletionClaim=()=>state.sqlite.prepare("UPDATE assistant_specialist_tasks SET status='running',provider_submitted=1 WHERE task_id=?")
      .run(task.id);
    const removed=await state.request(`/api/workspaces/${state.organizationId}/deletion`,json({confirmation:"DELETE_ORGANIZATION_AND_SCOPED_DATA",organizationId:state.organizationId},state.owner));
    assert.equal(removed.status,409,JSON.stringify(await removed.clone().json()));
    assert.equal((await removed.json()).error,"provider_submission_in_flight");
    assert.equal(state.sqlite.prepare("SELECT status FROM organizations WHERE organization_id=?").get(state.organizationId).status,"active");
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM organization_deletion_jobs WHERE organization_id=?").get(state.organizationId).count,0);
    assert.equal(state.sqlite.prepare("SELECT status,provider_submitted FROM assistant_specialist_tasks WHERE task_id=?").get(task.id).provider_submitted,1);
  }finally{globalThis.fetch=originalFetch;}
});

test("tenant deletion cancels never-submitted assistant work and erases its mutable organization records",async()=>{
  const state=await sharedProjectFixture({provider:true,actions:true});
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>{throw new Error("a never-submitted task must not call a provider");};
  try{
    state.controls.skipAssistantTaskClaimOnce=true;
    const started=await state.request(endpoint(),json({turnId:crypto.randomUUID(),message:"Explain the approved source context"},state.owner));
    assert.equal(started.status,201,JSON.stringify(await started.clone().json()));
    const task=(await started.json()).task;
    await state.drainBackground();
    assert.equal(state.sqlite.prepare("SELECT status FROM assistant_specialist_tasks WHERE task_id=?").get(task.id).status,"queued");
    const removed=await state.request(`/api/workspaces/${state.organizationId}/deletion`,json({confirmation:"DELETE_ORGANIZATION_AND_SCOPED_DATA",organizationId:state.organizationId},state.owner));
    assert.equal(removed.status,200,JSON.stringify(await removed.clone().json()));
    assert.equal((await removed.json()).status,"completed");
    for(const table of ["assistant_turns","assistant_action_proposals","assistant_specialist_tasks"]){
      assert.equal(state.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE organization_id=?`).get(state.organizationId).count,0,table);
    }
    assert.equal(state.sqlite.prepare("SELECT reserved_microusd FROM cost_budget_counters WHERE scope='user' AND scope_id=?").get("assistant-owner").reserved_microusd,0);
    assert.equal(state.sqlite.prepare("SELECT reserved_tokens FROM budget_counters WHERE scope='user' AND scope_id=?").get("assistant-owner").reserved_tokens,0);
  }finally{globalThis.fetch=originalFetch;}
});

test("a successful-looking provider response without an authoritative usage receipt never masquerades as free", async () => {
  const state = await fixture({ provider: true, actions: true });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ model: "gpt-5.6-luna", output_text: JSON.stringify({ reply: "UNVERIFIED COMPLETION", actions: [] }) });
  try {
    const response = await state.request(endpoint(), json({ turnId: crypto.randomUUID(), message: "What should I inspect?" }));
    const task = (await response.json()).task;
    await state.drainBackground();
    assert.deepEqual({ ...state.sqlite.prepare("SELECT status,error_code FROM assistant_specialist_tasks WHERE task_id=?").get(task.id) },
      { status: "needs-review", error_code: "assistant_provider_usage_unverified" });
    assert.equal(state.sqlite.prepare("SELECT reserved_microusd FROM cost_budget_counters WHERE scope='user' AND scope_id=?").get("dev-local-creative").reserved_microusd, 4000);
    assert.doesNotMatch(JSON.stringify((await (await state.request(endpoint())).json()).turns), /UNVERIFIED COMPLETION/u);
  } finally { globalThis.fetch = originalFetch; }
});

test("actor-scoped polling resumes a durable queued task after its original background dispatch was lost", async () => {
  const state = await fixture({ provider: true });
  const originalFetch = globalThis.fetch;
  let submissions = 0;
  globalThis.fetch = async (_url, init) => {
    submissions += 1;
    return Response.json({ id: "recovered-queued", model: JSON.parse(init.body).model,
      output_text: JSON.stringify({ reply: "Your interrupted request has completed.", actions: [] }),
      usage: { input_tokens: 120, output_tokens: 30, total_tokens: 150 } });
  };
  try {
    state.controls.skipAssistantTaskClaimOnce = true;
    const response = await state.request(endpoint(), json({ turnId: crypto.randomUUID(), message: "Explain this page" }));
    const task = (await response.json()).task;
    await state.drainBackground();
    assert.equal(state.sqlite.prepare("SELECT status FROM assistant_specialist_tasks WHERE task_id=?").get(task.id).status, "queued");
    assert.equal(submissions, 0);
    assert.equal((await state.request(endpoint())).status, 200);
    await state.drainBackground();
    assert.equal(state.sqlite.prepare("SELECT status FROM assistant_specialist_tasks WHERE task_id=?").get(task.id).status, "completed");
    assert.equal(submissions, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test("expired specialist leases recover only before dispatch and never replay an uncertain paid submission", async () => {
  for (const submitted of [false, true]) {
    const state = await fixture({ provider: true });
    const originalFetch = globalThis.fetch;
    let submissions = 0;
    globalThis.fetch = async (_url, init) => {
      submissions += 1;
      return Response.json({ id: "recovered-lease", model: JSON.parse(init.body).model,
        output_text: JSON.stringify({ reply: "The safely recoverable request has completed.", actions: [] }),
        usage: { input_tokens: 120, output_tokens: 30, total_tokens: 150 } });
    };
    try {
      state.controls.skipAssistantTaskClaimOnce = true;
      const response = await state.request(endpoint(), json({ turnId: crypto.randomUUID(), message: "Explain the current page" }));
      const task = (await response.json()).task;
      await state.drainBackground();
      const stored = state.sqlite.prepare("SELECT cost_reservation_id FROM assistant_specialist_tasks WHERE task_id=?").get(task.id);
      state.sqlite.prepare("UPDATE assistant_specialist_tasks SET status='running',lease_expires_at=?,provider_submitted=? WHERE task_id=?")
        .run("2000-01-01T00:00:00.000Z", submitted ? 1 : 0, task.id);
      state.sqlite.prepare("UPDATE cost_budget_reservations SET status='executing' WHERE reservation_id=?").run(stored.cost_reservation_id);
      assert.equal((await state.request(endpoint())).status, 200);
      await state.drainBackground();
      assert.equal(state.sqlite.prepare("SELECT status FROM assistant_specialist_tasks WHERE task_id=?").get(task.id).status,
        submitted ? "needs-review" : "completed");
      assert.equal(submissions, submitted ? 0 : 1);
      assert.equal(state.sqlite.prepare("SELECT reserved_microusd FROM cost_budget_counters WHERE scope='user' AND scope_id=?").get("dev-local-creative").reserved_microusd,
        submitted ? 4000 : 0);
    } finally { globalThis.fetch = originalFetch; }
  }
});

test("provider model mismatch records truthful spend, fails closed, and never commits generated suggestions", async () => {
  const state = await fixture({ provider: true, actions: true });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ id: "wrong-model", model: "gpt-5.6-sol",
    output_text: JSON.stringify({ reply: "This must never be delivered.", actions: [] }),
    usage: { input_tokens: 20, output_tokens: 5, total_tokens: 25 } });
  try {
    const response = await state.request(endpoint(), json({ turnId: crypto.randomUUID(), message: "What should I do next?" }));
    const accepted = await response.json();
    assert.equal(accepted.task.model, "gpt-5.6-luna");
    await state.drainBackground();
    const task = state.sqlite.prepare("SELECT status,error_code FROM assistant_specialist_tasks").get();
    assert.equal(task.status, "failed");
    assert.equal(task.error_code, "assistant_provider_model_mismatch");
    assert.equal(state.sqlite.prepare("SELECT used_microusd FROM cost_budget_counters WHERE scope='user' AND scope_id=?").get("dev-local-creative").used_microusd, 250);
    const history = await (await state.request(endpoint())).json();
    assert.doesNotMatch(JSON.stringify(history.turns), /must never be delivered/u);
  } finally { globalThis.fetch = originalFetch; }
});

test("shared viewers never incur specialist charges while enrolled owners remain scoped to their tenant", async () => {
  const state = await sharedProjectFixture({ provider: true });
  assert.equal((await (await state.request("/api/session", { headers: state.viewer })).json()).assistant.models, undefined);
  assert.deepEqual((await (await state.request("/api/session", { headers: state.owner })).json()).assistant.models.map((model) => model.id),
    ["gpt-5.6-luna", "gpt-5.6-terra"]);
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls += 1;
    const payload = JSON.parse(init.body);
    return Response.json({ id: "shared-luna", model: payload.model, output_text: JSON.stringify({ reply: "This shared work remains inside its approved project.", actions: [] }),
      usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } });
  };
  try {
    const viewer = await state.request(endpoint(), json({ turnId: crypto.randomUUID(), message: "What can I review?" }, state.viewer));
    assert.equal(viewer.status, 201);
    assert.equal((await viewer.json()).task, undefined);
    await state.drainBackground();
    assert.equal(calls, 0);
    const owner = await state.request(endpoint(), json({ turnId: crypto.randomUUID(), message: "What current results should I review?" }, state.owner));
    assert.equal(owner.status, 201, JSON.stringify(await owner.clone().json()));
    assert.equal((await owner.json()).task.model, "gpt-5.6-luna");
    await state.drainBackground();
    assert.equal(calls, 1);
    const billing = state.sqlite.prepare("SELECT organization_id,project_access_id,actor_user_id FROM project_budget_reservation_scopes WHERE reservation_kind='usd'").get();
    assert.deepEqual({ ...billing }, { organization_id: state.organizationId, project_access_id: state.projectAccessId, actor_user_id: "assistant-owner" });
  } finally { globalThis.fetch = originalFetch; }
});

test("each approved personal proposal commits exactly one typed change and rejection commits none", async () => {
  const { request, sqlite } = await fixture({ actions: true });
  const response = await request(endpoint(), json({ turnId: crypto.randomUUID(), message: "Add audience: independent gardeners; Add palette: evergreen; Add audio: analog score" }));
  const proposals = (await response.json()).turn.proposals;
  const before = sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type='BlockCreated'").get().count;
  const accepted = await request(proposalEndpoint(proposals[0].id), { method: "POST" });
  assert.equal(accepted.status, 200, JSON.stringify(await accepted.clone().json()));
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type='BlockCreated'").get().count, before + 1);
  const timeline = sqlite.prepare("SELECT type FROM events WHERE correlation_id=? ORDER BY sequence").all(`assistant-accepted:dev-local-creative:${proposals[0].id}`);
  assert.deepEqual(timeline.map((item) => item.type), ["ProposalAccepted", "BlockCreated"]);
  const replay = await request(proposalEndpoint(proposals[0].id), { method: "POST" });
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).idempotent, true);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type='BlockCreated'").get().count, before + 1);
  const audio = await request(proposalEndpoint(proposals[2].id), { method: "POST" });
  assert.equal(audio.status, 200, JSON.stringify(await audio.clone().json()));
  const created = await (await request(endpoint())).json();
  assert.equal(created.context.decisionAtoms.some((item) => item.type === "audio" && item.text.includes("analog score")), true);
  const audioEvent = sqlite.prepare("SELECT secret.private_json FROM events event JOIN event_private_payloads secret ON secret.private_event_id=event.event_id WHERE event.correlation_id=? AND event.type='BlockCreated'").get(`assistant-accepted:dev-local-creative:${proposals[2].id}`);
  const properties = JSON.parse(audioEvent.private_json).properties;
  assert.equal(properties.inform_generation, false);
  assert.equal(properties.include_in_output, false);
  assert.equal(properties.allow_provider_audio_transfer, false);
  const rejected = await request(proposalEndpoint(proposals[1].id, "reject"), { method: "POST" });
  assert.equal(rejected.status, 200);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type='BlockCreated'").get().count, before + 2);
  assert.equal(sqlite.prepare("SELECT status FROM assistant_action_proposals WHERE proposal_id=?").get(proposals[1].id).status, "rejected");
  const final = await (await request(endpoint())).json();
  assert.equal(final.turns.some((turn) => turn.proposal), false);
});

test("approved edits reconstruct the complete authoritative previous value and preserve label-only property paths", async () => {
  const state = await fixture({ actions: true });
  const longValue = "The original creative direction must remain perfectly reversible. ".repeat(9);
  const scope = { project_id: "project-atmosphere", document_id: "doc-atmosphere" };
  appendFixtureEvents(state.sqlite, "creative:dev-local-creative", [
    ["BlockCreated", { ...scope, block_id: "long-direction", type: "direction", handle: "Long direction", position: "x1", properties: { text: longValue } }],
    ["BlockCreated", { ...scope, block_id: "label-palette", type: "palette", handle: "Label palette", position: "x2", properties: { label: "Original label-only palette" } }],
  ]);
  const initial = await (await state.request(endpoint())).json();
  assert.equal(initial.context.decisionAtoms.find((item) => item.id === "long-direction").text.length, 320,
    "the model-facing view must stay bounded even when the authoritative value is longer");

  for (const [blockId, expectedPath, oldValue] of [
    ["long-direction", "text", longValue],
    ["label-palette", "label", "Original label-only palette"],
  ]) {
    const response = await state.request(endpoint(), json({ turnId: crypto.randomUUID(), message: `Update ${blockId} to a focused approved creative decision` }));
    const proposal = (await response.json()).turn.proposal;
    assert.equal(proposal.kind, "context.edit");
    const accepted = await state.request(proposalEndpoint(proposal.id), { method: "POST" });
    assert.equal(accepted.status, 200, JSON.stringify(await accepted.clone().json()));
    const stored = state.sqlite.prepare("SELECT secret.private_json FROM events event JOIN event_private_payloads secret ON secret.private_event_id=event.event_id WHERE event.correlation_id=? AND event.type='BlockPropertyEdited'")
      .get(`assistant-accepted:dev-local-creative:${proposal.id}`);
    const payload = JSON.parse(stored.private_json);
    assert.equal(payload.block_id, blockId);
    assert.equal(payload.property_path, expectedPath);
    assert.equal(payload.old_value, oldValue, "undo needs the exact authoritative previous value, not a clipped model view");
  }
});

test("derived output families, verified evidence, and governed context remain immutable in personal and shared projects", async () => {
  for (const shared of [false, true]) {
    const state = shared ? await sharedProjectFixture({ actions: true }) : await fixture({ actions: true });
    const userId = shared ? "assistant-owner" : "dev-local-creative";
    const headers = shared ? state.owner : {};
    const scope = { project_id: "project-atmosphere", document_id: "doc-atmosphere" };
    appendFixtureEvents(state.sqlite, `creative:${userId}`, [
      ["BlockCreated", { ...scope, block_id: "verified-source", type: "reference", handle: "Verified source", position: "z1", properties: { text: "Verified licensed source", source_evidence_hash: "verified-evidence" } }],
      ["BlockCreated", { ...scope, block_id: "governed-decision", type: "direction", handle: "Governed direction", position: "z2", properties: { text: "Organization-approved direction", organization_context_package_binding_id: "governed-binding" } }],
      ["BlockCreated", { ...scope, block_id: "derived-root", type: "direction", handle: "Generated output root", position: "z3", properties: { text: "Generated output direction", source_artifact_id: "artifact-owned" } }],
      ["BlockCreated", { ...scope, block_id: "derived-child", type: "direction", handle: "Generated output frame", position: "z4", properties: { text: "Generated output frame", source_artifact_id: "artifact-owned", source_artifact_item_id: "frame-owned", context_set_root_id: "derived-root" } }],
      ["BlockRelationAdded", { ...scope, relation_id: "derived-family", from_block_id: "derived-root", to_block_id: "derived-child", kind: "artifact_contains", properties: {} }],
    ]);
    const initial = await state.request(endpoint(), { headers });
    assert.equal(initial.status, 200, `shared=${shared}: ${JSON.stringify(await initial.clone().json())}`);
    const context = (await initial.json()).context;
    for (const id of ["verified-source", "governed-decision", "derived-root", "derived-child"]) {
      assert.equal(context.decisionAtoms.find((item) => item.id === id)?.immutable, true, `shared=${shared}, block=${id}`);
      const requested = await state.request(endpoint(), json({ turnId: crypto.randomUUID(), message: `Remove ${id}` }, headers));
      assert.equal(requested.status, 201, `shared=${shared}, block=${id}`);
      assert.notEqual((await requested.json()).turn.proposal?.kind, "context.remove");
    }

    const pending = await state.request(endpoint(), json({ turnId: crypto.randomUUID(), message: "Add palette: independently reviewable" }, headers));
    const proposal = (await pending.json()).turn.proposal;
    const stored = state.sqlite.prepare("SELECT action_content_ref FROM assistant_action_proposals WHERE proposal_id=?").get(proposal.id);
    state.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id=? AND owner_id=?")
      .run(JSON.stringify({ kind: "context.remove", targetBlockId: "derived-root" }), stored.action_content_ref, userId);
    state.sqlite.prepare("UPDATE assistant_action_proposals SET action_kind=?,source_versions_json=? WHERE proposal_id=?")
      .run("context.remove", JSON.stringify([{ blockId: "derived-root", version: context.decisionAtoms.find((item) => item.id === "derived-root").version }]), proposal.id);
    const denied = await state.request(proposalEndpoint(proposal.id), { method: "POST", headers });
    assert.equal(denied.status, 409, `shared=${shared}: ${JSON.stringify(await denied.clone().json())}`);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type='BlockRemoved' AND correlation_id=?")
      .get(`assistant-accepted:${userId}:${proposal.id}`).count, 0);
  }
});

test("document composition validates the requested project when another project is active", async () => {
  const state = await fixture();
  const original = { project_id: "project-atmosphere", document_id: "doc-atmosphere" };
  const other = { project_id: "project-composition-background", document_id: "doc-composition-background" };
  appendFixtureEvents(state.sqlite, "creative:dev-local-creative", [
    ["ProjectCreated", { project_id: other.project_id, name: "Other open project" }],
    ["DocumentCreated", { ...other, title: "Other open document" }],
    ["BlockCreated", { ...other, block_id: "background-decision", type: "direction", handle: "direction/background", position: "a0", properties: { text: "Separate project decision" } }],
    ["ProjectOpened", { project_id: other.project_id }],
    ["DocumentOpened", { ...other }],
  ]);

  const accepted = await state.request("/api/events", json({ action: "batch", events: [
    { type: "BlockPropertyEdited", payload: { ...original, block_id: "block-direction", property_path: "context_group", old_value: null,
      new_value: { name: "Original direction", target: "Original direction", role: "custom", application: "isolate", relativity: .8 } } },
    { type: "BlockCreated", payload: { ...original, block_id: "decomposed-decision", scope: "document", type: "message", handle: "message/focused-decision",
      position: "z0001", properties: { text: "A focused authored decision", source_block_id: "block-direction", context_detail: true } } },
    { type: "BlockRelationAdded", payload: { ...original, relation_id: "decomposed-relation", from_block_id: "block-direction",
      to_block_id: "decomposed-decision", kind: "context_contains", properties: { member_order: 0 } } },
  ] }));
  assert.equal(accepted.status, 200, JSON.stringify(await accepted.clone().json()));
  assert.equal((await accepted.json()).appended.length, 3,
    "a different open project must not hide an existing parent in the requested document");

  const foreign = await state.request("/api/events", json({ action: "append", event: {
    type: "BlockRelationAdded", payload: { ...original, relation_id: "cross-project-relation", from_block_id: "block-direction",
      to_block_id: "background-decision", kind: "context_contains", properties: { member_order: 1 } },
  } }));
  assert.equal(foreign.status, 409, JSON.stringify(await foreign.clone().json()));
  assert.equal((await foreign.json()).error, "context_composition_endpoint_missing",
    "selecting the requested project must never admit another project's private endpoint");
});

test("approved relations preserve the user's requested direction and reject cycles hidden outside the bounded chat view", async () => {
  const state = await fixture({ actions: true });
  const scope = { project_id: "project-atmosphere", document_id: "doc-atmosphere" };
  const blockIds = Array.from({ length: 10 }, (_, index) => `graph-${String.fromCharCode(97 + index)}`);
  appendFixtureEvents(state.sqlite, "creative:dev-local-creative", [
    ...blockIds.map((blockId, index) => ["BlockCreated", { ...scope, block_id: blockId, type: "direction", handle: blockId, position: `z${index}`, properties: { text: `Decision ${index + 1}` } }]),
    ...blockIds.slice(0, -1).map((blockId, index) => ["BlockRelationAdded", { ...scope, relation_id: `graph-edge-${index}`, from_block_id: blockId, to_block_id: blockIds[index + 1], kind: "context_contains", properties: {} }]),
  ]);
  const initial = (await (await state.request(endpoint())).json()).context;
  assert.equal(initial.relationships.length, 8, "the ninth authoritative edge must be outside the bounded LLM view");
  assert.ok(initial.decisionAtoms.some((item) => item.id === "graph-a"));
  assert.ok(initial.decisionAtoms.some((item) => item.id === "graph-j"));
  const reverse = await state.request(endpoint(), json({ turnId: crypto.randomUUID(), message: "Connect graph-j to graph-a" }));
  const cycle = (await reverse.json()).turn.proposal;
  assert.equal(cycle.kind, "context.relation.add");
  const denied = await state.request(proposalEndpoint(cycle.id), { method: "POST" });
  assert.equal(denied.status, 409, JSON.stringify(await denied.clone().json()));
  assert.equal((await denied.json()).error, "context_composition_cycle");

  const fresh = await fixture({ actions: true });
  const choices = (await (await fresh.request(endpoint())).json()).context.decisionAtoms.filter((item) => !item.locked && !item.immutable);
  assert.ok(choices.length >= 2);
  const relationResponse = await fresh.request(endpoint(), json({ turnId: crypto.randomUUID(), message: `Connect ${choices[1].id} to ${choices[0].id}` }));
  const relation = (await relationResponse.json()).turn.proposal;
  assert.equal(relation.kind, "context.relation.add");
  const accepted = await fresh.request(proposalEndpoint(relation.id), { method: "POST" });
  assert.equal(accepted.status, 200, JSON.stringify(await accepted.clone().json()));
  const stored = fresh.sqlite.prepare("SELECT secret.private_json FROM events event JOIN event_private_payloads secret ON secret.private_event_id=event.event_id WHERE event.correlation_id=? AND event.type='BlockRelationAdded'")
    .get(`assistant-accepted:dev-local-creative:${relation.id}`);
  const payload = JSON.parse(stored.private_json);
  assert.equal(payload.from_block_id, choices[1].id);
  assert.equal(payload.to_block_id, choices[0].id);
});

test("approved shared proposals remain collaborative, singular, authenticated, and server reconstructed", async () => {
  const { request, sqlite, owner, viewer, projectAccessId } = await sharedProjectFixture({ actions: true });
  const response = await request(endpoint(), json({ turnId: crypto.randomUUID(), message: "Add palette: collaboration-approved cobalt" }, owner));
  const proposal = (await response.json()).turn.proposal;
  const viewerAttempt = await request(proposalEndpoint(proposal.id), { method: "POST", headers: viewer });
  assert.equal(viewerAttempt.status, 403);
  const forged = await request(proposalEndpoint(proposal.id), json({ events: [{ type: "BlockRemoved", payload: { block_id: "foreign" } }] }, owner));
  assert.equal(forged.status, 400);
  const genericForgery = await request("/api/events", json({ action: "append", event: { type: "ProposalAccepted", payload: { proposal_id: proposal.id } } }, owner));
  assert.equal(genericForgery.status, 403);
  const beforeBlocks = sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type='BlockCreated'").get().count;
  const accepted = await request(proposalEndpoint(proposal.id), { method: "POST", headers: owner });
  assert.equal(accepted.status, 200, JSON.stringify(await accepted.clone().json()));
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type='BlockCreated'").get().count, beforeBlocks + 1);
  const scoped = sqlite.prepare("SELECT event.type FROM project_event_scopes scope JOIN events event ON event.event_id=scope.event_id WHERE scope.project_access_id=? AND event.correlation_id=? ORDER BY scope.project_sequence")
    .all(projectAccessId, `assistant-accepted:assistant-owner:${proposal.id}`);
  assert.deepEqual(scoped.map((item) => item.type), ["ProposalAccepted", "BlockCreated"]);
  const collaborator = await request(endpoint(), { headers: viewer });
  assert.equal(collaborator.status, 200);
  const state = await collaborator.json();
  assert.equal(state.context.decisionAtoms.some((item) => item.text.includes("collaboration-approved cobalt")), true);
  assert.equal(state.turns.length, 0);
});

test("stale, expired, changed-permission, wrong-scope, and revoked proposals never change context", async () => {
  const { request, sqlite } = await fixture({ actions: true });
  const create = async () => {
    const response = await request(endpoint(), json({ turnId: crypto.randomUUID(), message: "Add palette: guarded proposal" }));
    return (await response.json()).turn.proposal;
  };
  const expired = await create();
  sqlite.prepare("UPDATE assistant_action_proposals SET expires_at=? WHERE proposal_id=?").run("2000-01-01T00:00:00.000Z", expired.id);
  assert.equal((await request(proposalEndpoint(expired.id), { method: "POST" })).status, 410);
  const stale = await create();
  sqlite.prepare("UPDATE assistant_action_proposals SET source_versions_json=? WHERE proposal_id=?").run(JSON.stringify([{ blockId: "not-a-real-source", version: 8 }]), stale.id);
  assert.equal((await request(proposalEndpoint(stale.id), { method: "POST" })).status, 409);
  const epoch = await create();
  sqlite.prepare("UPDATE assistant_action_proposals SET permission_epoch=? WHERE proposal_id=?").run("revoked-epoch", epoch.id);
  assert.equal((await request(proposalEndpoint(epoch.id), { method: "POST" })).status, 403);
  const scoped = await create();
  assert.equal((await request(proposalEndpoint(scoped.id, "accept", "/activity"), { method: "POST" })).status, 404);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type='ProposalAccepted'").get().count, 0);
  const shared = await sharedProjectFixture({ actions: true });
  const pending = await shared.request(endpoint(), json({ turnId: crypto.randomUUID(), message: "Add palette: revoke access first" }, shared.owner));
  const proposal = (await pending.json()).turn.proposal;
  shared.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE project_access_id=? AND principal_user_id=?")
    .run(new Date().toISOString(), shared.projectAccessId, "assistant-owner");
  assert.equal((await shared.request(proposalEndpoint(proposal.id), { method: "POST", headers: shared.owner })).status, 403);
});

test("a failed final approval sentinel rolls back personal and shared events, resources, and status", async () => {
  for (const shared of [false, true]) {
    const state = shared ? await sharedProjectFixture({ actions: true }) : await fixture({ actions: true });
    const headers = shared ? state.owner : {};
    const response = await state.request(endpoint(), json({ turnId: crypto.randomUUID(), message: "Add audience: should fully roll back" }, headers));
    const proposal = (await response.json()).turn.proposal;
    const before = {
      events: state.sqlite.prepare("SELECT COUNT(*) AS count FROM events").get().count,
      resources: state.sqlite.prepare("SELECT COUNT(*) AS count FROM project_resource_scopes").get().count,
      accepted: state.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type='ProposalAccepted'").get().count,
    };
    state.controls.failAssistantActionCommit = true;
    const failed = await state.request(proposalEndpoint(proposal.id), { method: "POST", headers });
    assert.equal(failed.status, 409, `shared=${shared}: ${JSON.stringify(await failed.clone().json())}`);
    assert.equal(state.sqlite.prepare("SELECT status FROM assistant_action_proposals WHERE proposal_id=?").get(proposal.id).status, "pending");
    assert.deepEqual({
      events: state.sqlite.prepare("SELECT COUNT(*) AS count FROM events").get().count,
      resources: state.sqlite.prepare("SELECT COUNT(*) AS count FROM project_resource_scopes").get().count,
      accepted: state.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type='ProposalAccepted'").get().count,
    }, before, `shared=${shared}`);
  }
});

test("exact semantic event views preserve legacy unscoped decisions and pending audio beyond long interaction histories", async () => {
  const { request, sqlite } = await fixture();
  const initial = await (await request(endpoint())).json();
  assert.ok(initial.context.decisionAtoms.length > 0);
  const stream = "creative:dev-local-creative";
  let sequence = sqlite.prepare("SELECT MAX(sequence) AS head FROM events WHERE stream_id=?").get(stream).head;
  const now = new Date().toISOString();
  const insert = sqlite.prepare("INSERT INTO events(event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,causation_id,compensates_event_id,schema_version,type,payload) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)");
  const add = (type, payload, actor = "user") => insert.run(crypto.randomUUID(), stream, ++sequence, now, now, actor, "assistant-long-history", crypto.randomUUID(), null, null, 1, type, JSON.stringify(payload));
  add("DocumentRenderRequested", { project_id: "project-atmosphere", document_id: "doc-atmosphere", artifact_id: "pending-audio", artifact_kind: "audio" });
  for (let index = 0; index < 320; index += 1) add("ApplicationViewVisited", { project_id: "project-atmosphere", document_id: "doc-atmosphere", view: "document" });
  const response = await request(endpoint());
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const mature = await response.json();
  assert.equal(mature.context.documentTitle, initial.context.documentTitle);
  assert.deepEqual(mature.context.decisionAtoms.map((item) => item.id).sort(), initial.context.decisionAtoms.map((item) => item.id).sort());
  assert.equal(mature.context.unfinishedIntents.find((intent) => intent.id === "pending-audio")?.kind, "audio");
});

test("a document and selected board created between large history windows remain accurately grounded", async () => {
  const { request, sqlite } = await fixture();
  const stream = "creative:dev-local-creative";
  let sequence = sqlite.prepare("SELECT MAX(sequence) AS head FROM events WHERE stream_id=?").get(stream).head;
  const now = new Date().toISOString();
  const insert = sqlite.prepare("INSERT INTO events(event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,causation_id,compensates_event_id,schema_version,type,payload) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)");
  const add = (type, payload) => insert.run(crypto.randomUUID(), stream, ++sequence, now, now, "user", "assistant-middle", crypto.randomUUID(), null, null, 1, type, JSON.stringify(payload));
  for (let index = 0; index < 90; index += 1) add("DocumentCreated", { project_id: "project-atmosphere", document_id: `old-${index}`, title: `Earlier ${index}` });
  add("DocumentCreated", { project_id: "project-atmosphere", document_id: "middle-document", title: "Exact middle document" });
  add("BlockCreated", { project_id: "project-atmosphere", document_id: "middle-document", block_id: "middle-decision", type: "direction", handle: "Middle decision", position: "a0", properties: { text: "Keep the durable middle decision" } });
  add("CanvasCreated", { project_id: "project-atmosphere", canvas_id: "middle-board", name: "Exact middle board" });
  add("CanvasItemPlaced", { project_id: "project-atmosphere", canvas_id: "middle-board", item_id: "middle-selection", source_kind: "document", source_id: "middle-document", title: "Exact middle selection", frame: { x: 0, y: 0, w: 240, h: 160, z: "a0" } });
  for (let index = 0; index < 320; index += 1) add("ApplicationViewVisited", { project_id: "project-atmosphere", document_id: "middle-document", view: "document" });
  const document = await (await request(endpoint("/document/middle-document"))).json();
  assert.equal(document.context.documentTitle, "Exact middle document");
  assert.ok(document.context.decisionAtoms.some((atom) => atom.id === "middle-decision"));
  const board = await (await request(`${endpoint("/canvas/middle-board/exact")}&selected=middle-selection`)).json();
  assert.deepEqual(board.context.selectedItems.map((item) => item.title), ["Exact middle selection"]);
});

test("personal project views never disclose another project's document or output titles", async () => {
  const { request, sqlite } = await fixture();
  const stream = "creative:dev-local-creative";
  let sequence = sqlite.prepare("SELECT MAX(sequence) AS head FROM events WHERE stream_id=?").get(stream).head;
  const now = new Date().toISOString();
  const insert = sqlite.prepare("INSERT INTO events(event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,causation_id,compensates_event_id,schema_version,type,payload) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)");
  for (const [type, payload] of [
    ["ProjectCreated", { project_id: "private-project", name: "PRIVATE PROJECT NAME" }],
    ["DocumentCreated", { project_id: "private-project", document_id: "private-document", title: "PRIVATE DOCUMENT NAME" }],
    ["DocumentRenderCompleted", { project_id: "private-project", document_id: "private-document", artifact_id: "private-slides", artifact_kind: "slides", title: "CONFIDENTIAL OTHER PROJECT TITLE", items: [] }],
  ]) insert.run(crypto.randomUUID(), stream, ++sequence, now, now, type === "DocumentRenderCompleted" ? "worker:renderer" : "user", "assistant-isolation", crypto.randomUUID(), null, null, 1, type, JSON.stringify(payload));
  const result = await (await request(endpoint("/deliver"))).json();
  assert.equal(result.context.scope.projectId, "project-atmosphere");
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE PROJECT NAME|PRIVATE DOCUMENT NAME|CONFIDENTIAL OTHER PROJECT TITLE|private-slides/u);
});

test("rejects anonymous, public-share, privileged-platform, foreign-project, and foreign-document contexts", async () => {
  const { request, env } = await fixture();
  const anonymous = await worker.fetch(new Request("https://forma.example/api/assistant?route=%2Fprojects"), env, { waitUntil() {} });
  assert.equal(anonymous.status, 401);
  assert.equal((await request(endpoint("/share/secret-token"))).status, 403);
  assert.equal((await request(endpoint("/operations/providers"))).status, 403);
  assert.equal((await request(endpoint("/document/foreign-document"))).status, 403);
  assert.equal((await request(endpoint("/document/doc-atmosphere", "foreign-project"))).status, 403);
  assert.equal((await request("/api/assistant?route=https%3A%2F%2Fevil.example")).status, 400);
  assert.equal((await request(endpoint(), json({ turnId: "short", message: "hello" }))).status, 400);
  assert.equal((await request(endpoint(), json({ turnId: crypto.randomUUID(), message: "x".repeat(1201) }))).status, 400);
});

test("project and activity pages stay in place and never choose a stale document", async () => {
  const { request } = await fixture();
  for (const route of ["/projects", "/activity", "/deliver"]) {
    const response = await request(endpoint(route));
    assert.equal(response.status, 200, route);
    const result = await response.json();
    assert.equal(result.context.scope.documentId, null, route);
    assert.equal(result.context.surface.route, route);
    assert.ok(result.context.recentActions.length <= 12);
  }
});

test("Canvas assistant grounds its answer in real selected identities and rejects foreign items", async () => {
  const { request, sqlite } = await fixture();
  const stream = "creative:dev-local-creative";
  let sequence = sqlite.prepare("SELECT MAX(sequence) AS head FROM events WHERE stream_id=?").get(stream).head;
  const now = new Date().toISOString();
  const insert = sqlite.prepare("INSERT INTO events(event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,causation_id,compensates_event_id,schema_version,type,payload) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)");
  for (const [type, payload] of [
    ["CanvasCreated", { project_id: "project-atmosphere", canvas_id: "canvas-a", name: "Actual board" }],
    ["CanvasItemPlaced", { project_id: "project-atmosphere", canvas_id: "canvas-a", item_id: "selected-a", source_kind: "document", source_id: "doc-atmosphere", title: "Selected launch document", frame: { x: 0, y: 0, w: 240, h: 160, z: "a0" } }],
  ]) insert.run(crypto.randomUUID(), stream, ++sequence, now, now, "user", "assistant-test", crypto.randomUUID(), null, null, 1, type, JSON.stringify(payload));
  const url = `${endpoint("/canvas/canvas-a/actual-board")}&selected=selected-a&selected=foreign-item`;
  const contextResponse = await request(url);
  assert.equal(contextResponse.status, 200, JSON.stringify(await contextResponse.clone().json()));
  const context = await contextResponse.json();
  assert.deepEqual(context.context.selectedItems.map((item) => item.id), ["selected-a"]);
  assert.equal(context.context.selectedItems[0].title, "Selected launch document");
  assert.equal(context.context.scope.documentId, null);
  const answer = await request(url, json({ turnId: crypto.randomUUID(), message: "What is selected?" }));
  assert.equal(answer.status, 201);
  const result = await answer.json();
  assert.equal(result.turn.reply.key, "assistant.response.canvasSelection");
  assert.equal(result.turn.reply.values.title, "Selected launch document");
  assert.equal(result.turn.proposal.route, "/document/doc-atmosphere");
});

test("distinct rapid messages remain independent and exact retries stay idempotent", async () => {
  const { request, sqlite } = await fixture();
  const turnIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  const responses = await Promise.all(turnIds.map((turnId, index) => request(endpoint(), json({ turnId, message: `Independent request ${index + 1}` }))));
  for (const response of responses) assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM assistant_turns").get().count, turnIds.length);
  const receiptCount = sqlite.prepare("SELECT COUNT(*) AS count FROM event_client_receipts WHERE client_event_id LIKE 'assistant:%'").get().count;
  assert.equal(receiptCount, turnIds.length * 2);
});

test("old exact retries remain idempotent and conflicting replay never creates private rows", async () => {
  const { request, sqlite } = await fixture();
  const first = crypto.randomUUID();
  assert.equal((await request(endpoint(), json({ turnId: first, message: "Original private request" }))).status, 201);
  for (let index = 0; index < 8; index += 1) assert.equal((await request(endpoint(), json({ turnId: crypto.randomUUID(), message: `Later private request ${index}` }))).status, 201);
  const before = sqlite.prepare("SELECT COUNT(*) AS count FROM private_content WHERE kind IN('chat-user','chat-assistant')").get().count;
  assert.equal((await request(endpoint(), json({ turnId: first, message: "Original private request" }))).status, 200);
  const conflict = await request(endpoint(), json({ turnId: first, message: "Forged replacement request" }));
  assert.equal(conflict.status, 409);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM private_content WHERE kind IN('chat-user','chat-assistant')").get().count, before);
});

test("injected persistence failure atomically rolls back private content, events, receipts, and turns", async () => {
  const { request, sqlite, controls } = await fixture();
  assert.equal((await request(endpoint())).status, 200);
  const before = {
    content: sqlite.prepare("SELECT COUNT(*) AS count FROM private_content WHERE kind IN('chat-user','chat-assistant')").get().count,
    events: sqlite.prepare("SELECT COUNT(*) AS count FROM events").get().count,
    receipts: sqlite.prepare("SELECT COUNT(*) AS count FROM event_client_receipts").get().count,
    turns: sqlite.prepare("SELECT COUNT(*) AS count FROM assistant_turns").get().count,
  };
  controls.failAssistantTurnInsert = true;
  const failed = await request(endpoint(), json({ turnId: crypto.randomUUID(), message: "This turn must roll back completely" }));
  assert.equal(failed.status, 503);
  assert.deepEqual({
    content: sqlite.prepare("SELECT COUNT(*) AS count FROM private_content WHERE kind IN('chat-user','chat-assistant')").get().count,
    events: sqlite.prepare("SELECT COUNT(*) AS count FROM events").get().count,
    receipts: sqlite.prepare("SELECT COUNT(*) AS count FROM event_client_receipts").get().count,
    turns: sqlite.prepare("SELECT COUNT(*) AS count FROM assistant_turns").get().count,
  }, before);
});

test("unenrolled shared-project viewers can ask privately without authoring, paid work, or collaborator leakage", async () => {
  const { request, sqlite, viewer, owner, organizationId, projectAccessId } = await sharedProjectFixture({ enabled: false });
  const session = await (await request("/api/session", { headers: viewer })).json();
  assert.deepEqual(session.assistant.capabilities, ["project.assistant.read"]);
  assert.equal(session.projectContext.permissions.includes("project.author"), false);
  const beforeBlocks = sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type LIKE 'Block%'").get().count;
  const beforeJobs = sqlite.prepare("SELECT COUNT(*) AS count FROM document_jobs").get().count;
  const response = await request(endpoint(), json({ turnId: crypto.randomUUID(), message: "VIEWER PRIVATE SOUNDTRACK QUESTION" }, viewer));
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
  const answer = await response.json();
  assert.equal(answer.turn.proposal, null);
  assert.equal(answer.context.scope.organizationId, organizationId);
  assert.equal(answer.context.scope.projectAccessId, projectAccessId);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type LIKE 'Block%'").get().count, beforeBlocks);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM document_jobs").get().count, beforeJobs);
  const retained = sqlite.prepare("SELECT resource.actor_user_id,content.content FROM project_resource_scopes resource JOIN private_content content ON content.content_id=resource.resource_id WHERE resource.project_access_id=? AND resource.actor_user_id=? AND content.kind='chat-user'").all(projectAccessId, "assistant-viewer");
  assert.equal(retained.length, 1);
  assert.equal(retained[0].content, "VIEWER PRIVATE SOUNDTRACK QUESTION");
  const ownerHistory = await request(endpoint(), { headers: owner });
  assert.equal(ownerHistory.status, 200, JSON.stringify(await ownerHistory.clone().json()));
  assert.doesNotMatch(JSON.stringify(await ownerHistory.json()), /VIEWER PRIVATE SOUNDTRACK QUESTION/u);
  const sharedEvents = await request("/api/events?after=0&limit=2000&content=1", { headers: owner });
  assert.equal(sharedEvents.status, 200);
  assert.doesNotMatch(JSON.stringify(await sharedEvents.json()), /VIEWER PRIVATE SOUNDTRACK QUESTION/u);
});

test("collaborators may reuse the same turn ID without collisions or private-content poisoning", async () => {
  const { request, sqlite, owner, viewer, projectAccessId } = await sharedProjectFixture();
  const turnId = "same-turn-actor-01";
  const owners = await request(endpoint(), json({ turnId, message: "Owner-only request" }, owner));
  assert.equal(owners.status, 201, JSON.stringify(await owners.clone().json()));
  const viewers = await request(endpoint(), json({ turnId, message: "Viewer-only request" }, viewer));
  assert.equal(viewers.status, 201, JSON.stringify(await viewers.clone().json()));
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM assistant_turns WHERE turn_id=? AND project_access_id=?").get(turnId, projectAccessId).count, 2);
  const ownerHistory = await (await request(endpoint(), { headers: owner })).json();
  const viewerHistory = await (await request(endpoint(), { headers: viewer })).json();
  assert.match(JSON.stringify(ownerHistory), /Owner-only request/u);
  assert.doesNotMatch(JSON.stringify(ownerHistory), /Viewer-only request/u);
  assert.match(JSON.stringify(viewerHistory), /Viewer-only request/u);
  assert.doesNotMatch(JSON.stringify(viewerHistory), /Owner-only request/u);
});

test("owner conversations remain distinct across personal and shared contexts before and after migration", async () => {
  const { request, owner } = await sharedProjectFixture({ legacyConversation: true });
  const { cookie: _cookie, ...personal } = owner;
  const sharedMessage = "SHARED ORGANIZATION CREATIVE QUESTION";
  const personalMessage = "PERSONAL OWNER CREATIVE QUESTION";

  const shared = await request(endpoint(), json({ turnId: crypto.randomUUID(), message: sharedMessage }, owner));
  assert.equal(shared.status, 201, JSON.stringify(await shared.clone().json()));
  const individual = await request(endpoint(), json({ turnId: crypto.randomUUID(), message: personalMessage }, personal));
  assert.equal(individual.status, 201, JSON.stringify(await individual.clone().json()));

  const personalHistory = await (await request(endpoint(), { headers: personal })).json();
  assert.match(JSON.stringify(personalHistory), /LEGACY PERSONAL CREATIVE QUESTION/u);
  assert.match(JSON.stringify(personalHistory), /PERSONAL OWNER CREATIVE QUESTION/u);
  assert.doesNotMatch(JSON.stringify(personalHistory), /SHARED ORGANIZATION CREATIVE QUESTION/u);

  const sharedHistory = await (await request(endpoint(), { headers: owner })).json();
  assert.match(JSON.stringify(sharedHistory), /SHARED ORGANIZATION CREATIVE QUESTION/u);
  assert.doesNotMatch(JSON.stringify(sharedHistory), /LEGACY PERSONAL CREATIVE QUESTION|PERSONAL OWNER CREATIVE QUESTION/u);

  const sharedContent = await (await request("/api/events?after=0&limit=2000&content=1", { headers: owner })).json();
  assert.match(JSON.stringify(sharedContent.content), /SHARED ORGANIZATION CREATIVE QUESTION/u);
  assert.doesNotMatch(JSON.stringify(sharedContent.content), /LEGACY PERSONAL CREATIVE QUESTION|PERSONAL OWNER CREATIVE QUESTION/u);

  const personalContent = await (await request("/api/events?after=0&limit=2000&content=1", { headers: personal })).json();
  assert.match(JSON.stringify(personalContent.content), /LEGACY PERSONAL CREATIVE QUESTION|PERSONAL OWNER CREATIVE QUESTION/u);
  assert.doesNotMatch(JSON.stringify(personalContent.content), /SHARED ORGANIZATION CREATIVE QUESTION/u);

  const reopened = await (await request(endpoint(), { headers: personal })).json();
  assert.match(JSON.stringify(reopened), /LEGACY PERSONAL CREATIVE QUESTION|PERSONAL OWNER CREATIVE QUESTION/u);
  assert.doesNotMatch(JSON.stringify(reopened), /SHARED ORGANIZATION CREATIVE QUESTION/u);
});

test("workspace conversations never cross organizations or independent workspace sections", async () => {
  const { request, owner, organizationId } = await sharedProjectFixture();
  const members = `/settings/workspaces/${organizationId}/members`;
  const usage = `/settings/workspaces/${organizationId}/usage`;
  const posted = await request(endpoint(members), json({ turnId: crypto.randomUUID(), message: "MEMBERS SECTION ONLY" }, owner));
  assert.equal(posted.status, 201, JSON.stringify(await posted.clone().json()));
  assert.match(JSON.stringify(await (await request(endpoint(members), { headers: owner })).json()), /MEMBERS SECTION ONLY/u);
  assert.doesNotMatch(JSON.stringify(await (await request(endpoint(usage), { headers: owner })).json()), /MEMBERS SECTION ONLY/u);

  const second = await request("/api/workspaces", json({ name: "Another private organization" }, owner));
  assert.equal(second.status, 201, JSON.stringify(await second.clone().json()));
  const secondOrganization = (await second.json()).organizationId;
  const denied = await request(endpoint(`/settings/workspaces/${secondOrganization}/members`), { headers: owner });
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).error, "assistant_workspace_project_mismatch");
});

test("French, Arabic, and Japanese audio requests recognize audio as an existing capability", async () => {
  const { request } = await fixture();
  for (const [locale, message] of [["fr", "Quelle musique est disponible ?"], ["ar", "ما الموسيقى المتاحة؟"], ["ja", "音楽はありますか？"]]) {
    const response = await request(endpoint(), json({ turnId: crypto.randomUUID(), message, locale }));
    assert.equal(response.status, 201, locale);
    const result = await response.json();
    assert.equal(result.turn.reply.key, "assistant.response.output", locale);
    assert.equal(result.turn.reply.values.kind, "audio", locale);
    if(locale==="ar")assert.equal(result.turn.reply.values.label,"صوت");
    if(locale==="ja")assert.equal(result.turn.reply.values.label,"音声");
  }
});

test("context intelligence uses grounded web evidence, user-selected addendum types, and exact paid usage",async()=>{
  const state=await fixture({provider:true});
  appendFixtureEvents(state.sqlite,"creative:dev-local-creative",[["BlockCreated",{block_id:"secret-audio",document_id:"doc-atmosphere",project_id:"project-atmosphere",type:"audio",handle:"audio/secret",position:"z1",properties:{text:"PRIVATE_OPTED_OUT_AUDIO",inform_generation:false,weight:1}}]]);
  const original=globalThis.fetch,calls=[];
  try{
    globalThis.fetch=async(url,init)=>{
      const address=String(url);calls.push(address);
      if(address.startsWith("https://commons.wikimedia.org/w/api.php"))return Response.json({query:{pages:{1:{title:"File:Dog.jpg",imageinfo:[{thumburl:"https://upload.wikimedia.org/dog.jpg",descriptionurl:"https://commons.wikimedia.org/wiki/File:Dog.jpg",mime:"image/jpeg",extmetadata:{LicenseShortName:{value:"CC BY 4.0"},Artist:{value:"<b>Photographer</b>"}}}]}}}});
      assert.equal(address,"https://api.openai.com/v1/responses");
      const payload=JSON.parse(init.body);
      if(payload.tools){assert.equal(payload.input,"dog");assert.doesNotMatch(JSON.stringify(payload),/PRIVATE_OPTED_OUT_AUDIO|block-direction|project-atmosphere|doc-atmosphere|quiet/iu);return Response.json({model:payload.model,output:[{type:"web_search_call",action:{sources:[{url:"https://en.wikipedia.org/wiki/Dog"}]}},{type:"message",content:[{type:"output_text",text:"A public visual reference",annotations:[{type:"url_citation",url:"https://en.wikipedia.org/wiki/Dog"}]}]}],usage:{input_tokens:1000,output_tokens:300,total_tokens:1300}});}
      const facts=JSON.parse(payload.input),research=Boolean(facts.target);assert.equal(payload.tools,undefined);
      assert.doesNotMatch(payload.input,/PRIVATE_OPTED_OUT_AUDIO|block-direction|project-atmosphere|doc-atmosphere/u);
      const urls=["https://en.wikipedia.org/wiki/Dog","http://localhost/private"];
      const data=research?{inferred:[{existing_alias:"decision_1",reason:"Existing scene context"},{existing_alias:"foreign-account-alias",reason:"Must be rejected"}],related:[],learned:[{type:"subject",subtype:"Supporting subject",text:"Newly discovered visual detail",reason:"Public reference",source_url:urls[0]},{type:"subject",subtype:"Supporting subject",text:"Unsafe private citation",reason:"Must be rejected",source_url:urls[1]},{type:"subject",subtype:"Supporting subject",text:"Uncited fabricated detail",reason:"Must be rejected",source_url:"https://example.test/not-cited"}],image_query:"dog"}:{proposals:[{type:facts.source.type==="environment"?"environment":"emotion",subtype:facts.source.type==="environment"?"Interior":"Primary affect",label:facts.source.type==="environment"?"Bar":"Quiet",text:facts.source.type==="environment"?"Bar":"Quiet",source_excerpt:facts.source.type==="environment"?"bar":"quiet",participants:[]}]};
      const message={type:"message",content:[{type:"output_text",text:JSON.stringify(data),annotations:research?urls.map((url)=>({type:"url_citation",url})):[]}]};
      return Response.json({model:payload.model,output:[message],usage:{input_tokens:1000,output_tokens:300,total_tokens:1300}});
    };
    const body={projectId:"project-atmosphere",documentId:"doc-atmosphere",blockId:"block-direction"};
    const research=await state.approvedContextRequest("/api/context/research",json({...body,publicQuery:"dog"}));assert.equal(research.status,200,JSON.stringify(await research.clone().json()));
    const report=(await research.json()).report;
    assert.equal(report.searchedWeb,true);assert.equal(report.learned.length,2);assert.equal(report.learned[0].sourceUrl,"https://en.wikipedia.org/wiki/Dog");assert.equal(report.learned[1].type,"reference");assert.equal(report.learned[1].subtype,"Pixel");assert.equal(report.learned[1].license,"CC BY 4.0");assert.equal(report.learned[1].attribution,"Photographer");
    const decomposed=await state.approvedContextRequest("/api/context/decompose",json(body));assert.equal(decomposed.status,200);assert.equal((await decomposed.json()).plan.proposals[0].text,"Quiet");
    const addendum=await state.approvedContextRequest("/api/context/decompose",json({...body,addedText:"A bar",addedType:"environment"}));assert.equal(addendum.status,200);assert.equal((await addendum.json()).plan.proposals[0].type,"environment");
    const invalidAddition=await state.approvedContextRequest("/api/context/decompose",json({...body,addedText:"A bar"}));assert.equal(invalidAddition.status,400);assert.equal((await invalidAddition.json()).error,"context_added_block_type_invalid");
    const denied=await state.approvedContextRequest("/api/context/research",json({...body,blockId:"secret-audio"}));assert.equal(denied.status,403);assert.equal((await denied.json()).error,"context_block_protected");
    const tokens=state.sqlite.prepare("SELECT used_tokens,reserved_tokens FROM budget_counters WHERE scope=? AND scope_id=?").get("user","dev-local-creative");
    const costs=state.sqlite.prepare("SELECT used_microusd,reserved_microusd FROM cost_budget_counters WHERE scope=? AND scope_id=?").get("user","dev-local-creative");
    assert.deepEqual({...tokens},{used_tokens:5200,reserved_tokens:0});assert.deepEqual({...costs},{used_microusd:32400,reserved_microusd:0});assert.equal(calls.length,5);
  }finally{globalThis.fetch=original;}
});

test("decomposes rich authored context while preserving research, addendum, and protected-source limits",async()=>{
  const state=await fixture({provider:true});
  const source="quiet ".repeat(790).trim();
  appendFixtureEvents(state.sqlite,"creative:dev-local-creative",[
    ["BlockPropertyEdited",{project_id:"project-atmosphere",document_id:"doc-atmosphere",block_id:"block-direction",property_path:"text",new_value:source}],
  ]);
  const original=globalThis.fetch;let calls=0;
  try{
    globalThis.fetch=async(url,init)=>{
      calls+=1;
      assert.equal(String(url),"https://api.openai.com/v1/responses");
      const payload=JSON.parse(init.body);
      assert.equal(JSON.parse(payload.input).source.text,source);
      return Response.json({model:payload.model,output:[{type:"message",content:[{type:"output_text",text:'{"proposals":[]}'}]}],usage:{input_tokens:1000,output_tokens:300,total_tokens:1300}});
    };
    const body={projectId:"project-atmosphere",documentId:"doc-atmosphere",blockId:"block-direction"};
    const decomposed=await state.approvedContextRequest("/api/context/decompose",json(body));
    assert.equal(decomposed.status,200,JSON.stringify(await decomposed.clone().json()));
    assert.equal((await decomposed.json()).plan.sourceText,source);

    const research=await state.approvedContextRequest("/api/context/research",json(body));
    assert.equal(research.status,413);
    assert.equal((await research.json()).error,"context_source_too_large");

    const addition=await state.approvedContextRequest("/api/context/decompose",json({...body,addedType:"direction",addedText:"x".repeat(1801)}));
    assert.equal(addition.status,413);
    assert.equal((await addition.json()).error,"context_source_too_large");

    appendFixtureEvents(state.sqlite,"creative:dev-local-creative",[
      ["BlockPropertyEdited",{project_id:"project-atmosphere",document_id:"doc-atmosphere",block_id:"block-direction",property_path:"text",old_value:source,new_value:"x".repeat(6001)}],
    ]);
    const oversized=await state.approvedContextRequest("/api/context/decompose",json(body));
    assert.equal(oversized.status,413);
    assert.equal((await oversized.json()).error,"context_source_too_large");
    assert.equal(calls,1,"rejected sources must never submit a paid provider request");
  }finally{globalThis.fetch=original;}
});

test("context intelligence rejects paid provider access for users outside the existing enrollment",async()=>{
  const state=await fixture({provider:true});delete state.env.FORMA_ASSISTANT_PROVIDER_USER_IDS;
  const original=globalThis.fetch;let calls=0;
  try{
    globalThis.fetch=async()=>{calls+=1;throw new Error("paid dispatch must not occur");};
    const body={projectId:"project-atmosphere",documentId:"doc-atmosphere",blockId:"block-direction"};
    for(const operation of ["decompose","research"]){const result=await state.approvedContextRequest(`/api/context/${operation}`,json(body));assert.equal(result.status,403);assert.equal((await result.json()).error,"context_provider_denied");}
    assert.equal(calls,0);
  }finally{globalThis.fetch=original;}
});

test("Action research retains participant roles without proposing an already-complete relationship",async()=>{
  const state=await fixture({provider:true});
  appendFixtureEvents(state.sqlite,"creative:dev-local-creative",[
    ["BlockCreated",{block_id:"context-action-person",document_id:"doc-atmosphere",project_id:"project-atmosphere",type:"subject",handle:"subject/ilya",position:"z1",properties:{text:"Ilya",subtype:"Hero subject"}}],
    ["BlockCreated",{block_id:"context-riding-action",document_id:"doc-atmosphere",project_id:"project-atmosphere",type:"action",handle:"action/riding",position:"z2",properties:{text:"Rides with @Ilya",subtype:"Interaction",block_references:[{block_id:"context-action-person",handle:"subject/ilya",role:"actor"}]}}],
    ["BlockRelationAdded",{relation_id:"context-action-actor",document_id:"doc-atmosphere",project_id:"project-atmosphere",from_block_id:"context-riding-action",to_block_id:"context-action-person",kind:"action_participant",properties:{participant_role:"actor",handle:"subject/ilya"}}],
  ]);
  const original=globalThis.fetch;
  try{
    globalThis.fetch=async(_url,init)=>{
      const payload=JSON.parse(init.body),facts=JSON.parse(payload.input),participant=facts.document_blocks.find((candidate)=>candidate.handle==="subject/ilya");
      assert.ok(participant);assert.ok(facts.relationships.some((relation)=>relation.from==="target"&&relation.to===participant.alias&&relation.kind==="action_participant"&&relation.participant_role==="actor"));
      const proposal={inferred:[{existing_alias:participant.alias,reason:"Already participating"}],related:[],learned:[],image_query:""};
      return Response.json({model:payload.model,output:[{type:"message",content:[{type:"output_text",text:JSON.stringify(proposal),annotations:[]}]}],usage:{input_tokens:1000,output_tokens:300,total_tokens:1300}});
    };
    const result=await state.approvedContextRequest("/api/context/research",json({projectId:"project-atmosphere",documentId:"doc-atmosphere",blockId:"context-riding-action"}));
    assert.equal(result.status,200,JSON.stringify(await result.clone().json()));assert.deepEqual((await result.json()).report.inferred,[]);
  }finally{globalThis.fetch=original;}
});

test("context intelligence truthfully charges verified provider usage beyond its reservation",async()=>{
  const state=await fixture({provider:true,models:"gpt-5.6-terra"}),original=globalThis.fetch;
  try{
    globalThis.fetch=async(_url,init)=>{const payload=JSON.parse(init.body);return Response.json({model:payload.model,output:[{type:"message",content:[{type:"output_text",text:'{"proposals":[]}'}]}],usage:{input_tokens:200000,output_tokens:1800,total_tokens:201800}});};
    const result=await state.approvedContextRequest("/api/context/decompose",json({projectId:"project-atmosphere",documentId:"doc-atmosphere",blockId:"block-direction"}));
    assert.equal(result.status,502);assert.equal((await result.json()).error,"context_provider_budget_exceeded");
    const tokens=state.sqlite.prepare("SELECT used_tokens,reserved_tokens FROM budget_counters WHERE scope=? AND scope_id=?").get("user","dev-local-creative");
    const costs=state.sqlite.prepare("SELECT used_microusd,reserved_microusd FROM cost_budget_counters WHERE scope=? AND scope_id=?").get("user","dev-local-creative");
    assert.deepEqual({...tokens},{used_tokens:201800,reserved_tokens:0});assert.deepEqual({...costs},{used_microusd:421600,reserved_microusd:0});
  }finally{globalThis.fetch=original;}
});

test("context intelligence never retries an ambiguous paid research submission",async()=>{
  const state=await fixture({provider:true}),original=globalThis.fetch;let calls=0;
  try{
    globalThis.fetch=async()=>{calls+=1;throw new Error("synthetic network interruption");};
    const result=await state.approvedContextRequest("/api/context/research",json({projectId:"project-atmosphere",documentId:"doc-atmosphere",blockId:"block-direction"}));
    assert.equal(result.status,502);assert.equal(calls,1);
    const tokens=state.sqlite.prepare("SELECT used_tokens,reserved_tokens FROM budget_counters WHERE scope=? AND scope_id=?").get("user","dev-local-creative");
    const costs=state.sqlite.prepare("SELECT used_microusd,reserved_microusd FROM cost_budget_counters WHERE scope=? AND scope_id=?").get("user","dev-local-creative");
    assert.equal(tokens.used_tokens,0);assert.ok(tokens.reserved_tokens>0);assert.equal(costs.used_microusd,0);assert.ok(costs.reserved_microusd>0);
  }finally{globalThis.fetch=original;}
});

test("shared context intelligence reconstructs older decisions and rejects forged Action participant ownership",async()=>{
  const state=await sharedProjectFixture({provider:true}),body={projectId:"project-atmosphere",documentId:"doc-atmosphere",blockId:"block-direction"};
  const events=Array.from({length:390},(_,index)=>["BlockPropertyEdited",{project_id:"project-atmosphere",document_id:"doc-atmosphere",block_id:"block-direction",property_path:"text",old_value:null,new_value:`A current direction ${index}`}]);
  appendFixtureEvents(state.sqlite,"creative:assistant-owner",events);
  const original=globalThis.fetch;
  try{
    globalThis.fetch=async(_url,init)=>{const payload=JSON.parse(init.body),source=JSON.parse(payload.input).source;assert.equal(source.text,"A current direction 389");return Response.json({model:payload.model,output:[{type:"message",content:[{type:"output_text",text:JSON.stringify({proposals:[{type:"direction",subtype:"Campaign goal",label:"current direction",text:"current direction",source_excerpt:"current direction",participants:[]}]})}]}],usage:{input_tokens:1000,output_tokens:300,total_tokens:1300}});};
    const owner=await state.approvedContextRequest("/api/context/decompose",json(body,state.owner));assert.equal(owner.status,200,JSON.stringify(await owner.clone().json()));assert.equal((await owner.json()).plan.sourceText,"A current direction 389");
    const viewer=await state.approvedContextRequest("/api/context/decompose",json(body,state.viewer));assert.equal(viewer.status,403);
    const validId=crypto.randomUUID(),validEvents=[{type:"BlockCreated",payload:{block_id:validId,project_id:"project-atmosphere",document_id:"doc-atmosphere",scope:"document",type:"action",handle:"action/valid",position:"z8",properties:{text:"Relates to the existing direction",subtype:"Interaction",block_references:[{block_id:"block-direction",handle:"direction/nocturne",role:"target"}]} }},{type:"BlockRelationAdded",payload:{relation_id:crypto.randomUUID(),project_id:"project-atmosphere",document_id:"doc-atmosphere",from_block_id:validId,to_block_id:"block-direction",kind:"action_participant",properties:{participant_role:"target",handle:"direction/nocturne"}}}];
    const valid=await state.request("/api/events",json({action:"batch",events:validEvents},state.owner));assert.equal(valid.status,200,JSON.stringify(await valid.clone().json()));
    const forgedEvent={type:"BlockCreated",payload:{block_id:crypto.randomUUID(),project_id:"project-atmosphere",document_id:"doc-atmosphere",scope:"document",type:"action",handle:"action/forged",position:"z9",properties:{label:"Forged action",text:"Forged action",subtype:"Interaction",block_references:[{block_id:"FOREIGN_ACCOUNT_PRIVATE_BLOCK",handle:"foreign-private-person",role:"actor"}]}}};
    const forged=await state.request("/api/events",json({action:"append",event:forgedEvent},state.owner));
    assert.equal(forged.status,403);assert.equal((await forged.json()).error,"foreign_block_resource");
    const crossedEvent={...forgedEvent,payload:{...forgedEvent.payload,block_id:crypto.randomUUID(),document_id:"",scope:"library",properties:{...forgedEvent.payload.properties,block_references:[{block_id:"block-direction",handle:"direction/current",role:"actor"}]}}};
    const crossed=await state.request("/api/events",json({action:"append",event:crossedEvent},state.owner));
    assert.equal(crossed.status,403);assert.equal((await crossed.json()).error,"cross_scene_action_reference");
  }finally{globalThis.fetch=original;}
});

const contextBody={projectId:"project-atmosphere",documentId:"doc-atmosphere",blockId:"block-direction"};
const contextResult=(payload)=>Response.json({id:"response-fixture",model:payload.model,service_tier:"default",output:[{type:"message",content:[{type:"output_text",text:'{"proposals":[]}'}]}],usage:{input_tokens:1000,output_tokens:300,total_tokens:1300}});
const quoteContext=async(state,body=contextBody,headers={})=>{
  const result=await state.request("/api/context/decompose",json({...body,action:"quote"},headers));
  assert.equal(result.status,200,JSON.stringify(await result.clone().json()));return(await result.json()).quote;
};
const executeContext=(state,quote,body=contextBody,headers={})=>state.request("/api/context/decompose",json({...body,action:"execute",executionId:quote.executionId,approvedBindingHash:quote.bindingHash},headers));
const retrieveContext=(state,quote,body=contextBody,headers={})=>state.request("/api/context/decompose",json({...body,action:"retrieve",executionId:quote.executionId,approvedBindingHash:quote.bindingHash},headers));

function interceptConsequentialDb(state,kind,pattern,effect,phase="before"){
  const prepare=state.env.DB.prepare,batch=state.env.DB.batch;let fired=false;
  const invoke=async(operation,statements,run)=>{const matched=!fired&&operation===kind&&statements.some((statement)=>pattern.test(statement.sql));if(matched){fired=true;if(phase==="before")await effect(statements);}const result=await run();if(matched&&phase==="after")await effect(statements);return result;};
  const wrap=(statement)=>{const bind=statement.bind;statement.bind=(...values)=>wrap(bind.call(statement,...values));for(const method of["run","first","all"]){const original=statement[method];statement[method]=()=>invoke(method,[statement],()=>original.call(statement));}return statement;};
  state.env.DB.prepare=(sql)=>wrap(prepare.call(state.env.DB,sql));state.env.DB.batch=(statements)=>invoke("batch",statements,()=>batch.call(state.env.DB,statements));
  return()=>{state.env.DB.prepare=prepare;state.env.DB.batch=batch;};
}
function gateConsequentialDb(state,kind,pattern){const entered=Promise.withResolvers(),released=Promise.withResolvers();const restore=interceptConsequentialDb(state,kind,pattern,async()=>{entered.resolve();await released.promise;});return{entered:entered.promise,release:released.resolve,restore};}
function consequentialDbClock(state){
  const native=new DatabaseSync(":memory:");let now=new Date().toISOString();
  state.sqlite.function("strftime",{varargs:true},(...args)=>{const values=args.map((value,index)=>index===1&&value==="now"?now:value);return native.prepare("SELECT strftime("+values.map(()=>"?").join(",")+") AS value").get(...values).value;});
  return{set(value){now=value;},close(){native.close();}};
}
async function consequentialContractFixture({claim=true,reserve=false}={}){
  const state=await fixture({provider:true}),quote=await quoteContext(state),row=state.sqlite.prepare("SELECT execution.*,content.content FROM consequential_executions execution JOIN private_content content ON content.content_id=execution.consent_ref WHERE execution.execution_id=?").get(quote.executionId);
  const{binding}=JSON.parse(row.content),auth=await requireUser(new Request("http://localhost/api/session"),state.env,"viewer",{account:"principal"});assert.ok(auth.user);
  const sourceHead=Number(state.sqlite.prepare("SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?").get(binding.streamId).head);Object.assign(state,{quote,binding,user:auth.user,sourceHead,executionId:quote.executionId});
  if(claim){const claimed=await consequential.claimConsequentialExecution(state.env,state.user,binding,quote.executionId,quote.bindingHash,sourceHead);assert.equal(claimed.reused,false,JSON.stringify(claimed));}
  if(reserve)await consequential.reserveConsequentialSteps(state.env,state.user,binding,quote.executionId);return state;
}
function consequentialBalances(state,userId="dev-local-creative"){
  const tokens=state.sqlite.prepare("SELECT COALESCE(SUM(used_tokens),0) AS used,COALESCE(SUM(reserved_tokens),0) AS reserved FROM budget_counters WHERE scope='user' AND scope_id=?").get(userId),cost=state.sqlite.prepare("SELECT COALESCE(SUM(used_microusd),0) AS used,COALESCE(SUM(reserved_microusd),0) AS reserved FROM cost_budget_counters WHERE scope='user' AND scope_id=?").get(userId);
  return{tokens:{...tokens},cost:{...cost}};
}
function consequentialReceipt(state,id){return{execution:{...state.sqlite.prepare("SELECT status,result_ref,error_code FROM consequential_executions WHERE execution_id=?").get(id)},steps:state.sqlite.prepare("SELECT step_index,status,verified_tokens,verified_microusd,provider_request_id FROM consequential_execution_steps WHERE execution_id=? ORDER BY step_index").all(id).map((row)=>({...row})),tokens:state.sqlite.prepare("SELECT reservation_id,status,reserved_tokens,used_tokens,period FROM budget_reservations WHERE correlation_id=? ORDER BY reservation_id").all(id).map((row)=>({...row})),cost:state.sqlite.prepare("SELECT reservation_id,status,reserved_microusd,used_microusd,period FROM cost_budget_reservations WHERE correlation_id=? ORDER BY reservation_id").all(id).map((row)=>({...row})),balances:consequentialBalances(state)};}

for(const[seam,kind,pattern]of[["step claim","run",/^\s*UPDATE consequential_execution_steps SET status='reserved'/u],["token INSERT","batch",/^\s*INSERT OR IGNORE INTO budget_reservations\b/u],["cost INSERT","batch",/^\s*INSERT OR IGNORE INTO cost_budget_reservations\b/u],["begin","run",/^\s*UPDATE consequential_execution_steps SET status='submitting'/u]]){
  test("consequential races: cancellation before "+seam+" admits no late hold or POST",{timeout:15_000},async()=>{
    const original=globalThis.fetch;let calls=0,gate;
    try{globalThis.fetch=async()=>{calls++;throw new Error("unexpected paid dispatch");};const state=await consequentialContractFixture({reserve:seam==="begin"}),id=state.executionId;gate=gateConsequentialDb(state,kind,pattern);
      const work=seam==="begin"?consequential.beginConsequentialStep(state.env,state.user,state.binding,id,0,state.sourceHead):consequential.reserveConsequentialSteps(state.env,state.user,state.binding,id),rejected=assert.rejects(work,/context_execution_not_active|context_authorization_changed/u);
      await gate.entered;assert.equal(await consequential.failConsequentialExecution(state.env,state.user.userId,id,"context_canceled"),false);gate.release();await rejected;
      const receipt=consequentialReceipt(state,id);assert.equal(receipt.execution.status,"failed");assert.equal(receipt.execution.result_ref,null);assert.deepEqual(receipt.steps.map((step)=>step.status),["not-submitted"]);assert.equal(receipt.tokens.length,seam==="cost INSERT"||seam==="begin"?1:0);assert.equal(receipt.cost.length,seam==="begin"?1:0);assert.ok(receipt.tokens.every((row)=>row.status==="released"));assert.ok(receipt.cost.every((row)=>row.status==="released"));assert.deepEqual(receipt.balances,{tokens:{used:0,reserved:0},cost:{used:0,reserved:0}});
      await assert.rejects(consequential.beginConsequentialStep(state.env,state.user,state.binding,id,0,state.sourceHead),/context_authorization_changed/u);assert.equal(calls,0);
    }finally{gate?.release();gate?.restore();globalThis.fetch=original;}
  });
}
test("consequential races: a tombstone committed before a crash is cleaned up by free reconciliation",{timeout:15_000},async()=>{
  const state=await consequentialContractFixture({reserve:true}),id=state.executionId,before=consequentialBalances(state),restore=interceptConsequentialDb(state,"batch",/^\s*UPDATE consequential_execution_steps SET status='not-submitted'/u,()=>{throw new Error("injected_after_tombstone_commit");},"after");
  try{await assert.rejects(consequential.failConsequentialExecution(state.env,state.user.userId,id,"context_canceled"),/injected_after_tombstone_commit/u);}finally{restore();}
  let receipt=consequentialReceipt(state,id);assert.equal(receipt.execution.status,"failed");assert.equal(receipt.steps[0].status,"not-submitted");assert.deepEqual(receipt.balances,before);assert.equal(receipt.tokens[0].status,"active");assert.equal(receipt.cost[0].status,"executing");
  await consequential.reconcileConsequentialUsage(state.env,state.user.userId,id);receipt=consequentialReceipt(state,id);assert.equal(receipt.tokens[0].status,"released");assert.equal(receipt.cost[0].status,"released");assert.deepEqual(receipt.balances,{tokens:{used:0,reserved:0},cost:{used:0,reserved:0}});await consequential.reconcileConsequentialUsage(state.env,state.user.userId,id);assert.deepEqual(consequentialReceipt(state,id),receipt);
});
test("consequential races: a submitted winner stays held until its late verified response completes",{timeout:15_000},async()=>{
  const state=await fixture({provider:true}),original=globalThis.fetch,entered=Promise.withResolvers(),released=Promise.withResolvers();let calls=0;
  try{globalThis.fetch=async(_url,init)=>{calls++;entered.resolve();await released.promise;return contextResult(JSON.parse(init.body));};const quote=await quoteContext(state),work=executeContext(state,quote);await entered.promise;
    const before=consequentialBalances(state);assert.ok(before.tokens.reserved>0);assert.ok(before.cost.reserved>0);assert.equal(await consequential.failConsequentialExecution(state.env,"dev-local-creative",quote.executionId,"context_canceled"),true);assert.equal(consequentialReceipt(state,quote.executionId).steps[0].status,"uncertain");await consequential.reconcileConsequentialUsage(state.env,"dev-local-creative",quote.executionId);assert.deepEqual(consequentialBalances(state),before);
    released.resolve();const completed=await work;assert.equal(completed.status,200,JSON.stringify(await completed.clone().json()));const receipt=consequentialReceipt(state,quote.executionId);assert.equal(receipt.execution.status,"completed");assert.ok(receipt.execution.result_ref);assert.equal(receipt.steps[0].status,"settled");assert.equal(receipt.steps[0].provider_request_id,"response-fixture");assert.deepEqual(receipt.balances,{tokens:{used:1300,reserved:0},cost:{used:5600,reserved:0}});
    assert.equal((await retrieveContext(state,quote)).status,200);assert.equal((await executeContext(state,quote)).status,200);assert.deepEqual(consequentialReceipt(state,quote.executionId),receipt);assert.equal(calls,1);
  }finally{released.resolve();globalThis.fetch=original;}
});
test("consequential races: completion winning before the failure transaction cannot regress",{timeout:15_000},async()=>{
  const state=await fixture({provider:true}),original=globalThis.fetch,entered=Promise.withResolvers(),released=Promise.withResolvers();let calls=0,gate;
  try{globalThis.fetch=async(_url,init)=>{calls++;entered.resolve();await released.promise;return contextResult(JSON.parse(init.body));};const quote=await quoteContext(state),work=executeContext(state,quote);await entered.promise;gate=gateConsequentialDb(state,"batch",/^\s*UPDATE consequential_execution_steps SET status='not-submitted'/u);
    const failure=consequential.failConsequentialExecution(state.env,"dev-local-creative",quote.executionId,"context_late_failure");await gate.entered;released.resolve();const completed=await work;assert.equal(completed.status,200,JSON.stringify(await completed.clone().json()));const receipt=consequentialReceipt(state,quote.executionId);assert.equal(receipt.execution.status,"completed");assert.ok(receipt.execution.result_ref);gate.release();assert.equal(await failure,false);assert.deepEqual(consequentialReceipt(state,quote.executionId),receipt);assert.equal((await retrieveContext(state,quote)).status,200);assert.equal(calls,1);
  }finally{released.resolve();gate?.release();gate?.restore();globalThis.fetch=original;}
});
for(const[seam,kind,pattern]of[["private INSERT","batch",/^\s*INSERT INTO private_content\s*\(/u],["completion UPDATE","run",/^\s*UPDATE consequential_executions SET status='completed'/u]])for(const withdrawal of["proof","authority"]){
  test("consequential proof: "+withdrawal+" withdrawn before "+seam+" cannot publish a paid result",{timeout:15_000},async()=>{
    const state=await consequentialContractFixture({reserve:true}),id=state.executionId;await consequential.beginConsequentialStep(state.env,state.user,state.binding,id,0,state.sourceHead);await consequential.settleConsequentialStep(state.env,state.user.userId,id,0,1300,5600,"response-proof");
    const before=consequentialBalances(state),consentRef=state.sqlite.prepare("SELECT consent_ref FROM consequential_executions WHERE execution_id=?").get(id).consent_ref,proof={sql:"EXISTS(SELECT 1 FROM private_content evidence WHERE evidence.content_id=? AND evidence.owner_id=? AND evidence.redacted_at IS NULL AND evidence.content!='')",bindings:[consentRef,state.user.userId]};
    const restore=interceptConsequentialDb(state,kind,pattern,()=>{if(withdrawal==="proof")state.sqlite.prepare("UPDATE private_content SET content='',redacted_at=? WHERE content_id=?").run(new Date().toISOString(),consentRef);else state.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id=?").run(state.user.userId);});
    try{await assert.rejects(consequential.completeConsequentialExecution(state.env,state.user,state.binding,id,{executionId:id,plan:{proposals:[]}},proof),/project_private_content_access_revoked|context_result_not_retained/u);}finally{restore();}
    const receipt=consequentialReceipt(state,id);assert.notEqual(receipt.execution.status,"completed");assert.equal(receipt.execution.result_ref,null);assert.equal(receipt.steps[0].status,"settled");assert.deepEqual(receipt.balances,before);if(seam==="private INSERT")assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM private_content WHERE kind='context-proposal'").get().n,0);
  });
}
test("consequential proof: erased retained bytes cannot be attached at the completion boundary",{timeout:15_000},async()=>{
  const state=await consequentialContractFixture({reserve:true}),id=state.executionId;await consequential.beginConsequentialStep(state.env,state.user,state.binding,id,0,state.sourceHead);await consequential.settleConsequentialStep(state.env,state.user.userId,id,0,1300,5600,"response-proof");const before=consequentialBalances(state);
  const restore=interceptConsequentialDb(state,"run",/^\s*UPDATE consequential_executions SET status='completed'/u,()=>{state.sqlite.prepare("UPDATE private_content SET content='',redacted_at=? WHERE owner_id=? AND kind='context-proposal'").run(new Date().toISOString(),state.user.userId);});
  try{await assert.rejects(consequential.completeConsequentialExecution(state.env,state.user,state.binding,id,{executionId:id,plan:{proposals:[]}}),/context_result_not_retained/u);}finally{restore();}assert.equal(consequentialReceipt(state,id).execution.result_ref,null);assert.deepEqual(consequentialBalances(state),before);
});
for(const boundary of["claim","begin"])for(const change of["expiry","month"]){
  test("consequential clock: SQLite "+change+" changing at "+boundary+" rejects a stale JS admission",{timeout:15_000},async()=>{
    const state=await consequentialContractFixture({claim:boundary!=="claim",reserve:boundary==="begin"}),id=state.executionId,clock=consequentialDbClock(state),expiresAt=state.sqlite.prepare("SELECT expires_at FROM consequential_executions WHERE execution_id=?").get(id).expires_at,nextMonth=new Date(Date.UTC(Number(state.binding.period.slice(0,4)),Number(state.binding.period.slice(5,7)),1)),later=change==="expiry"?new Date(Date.parse(expiresAt)+1).toISOString():nextMonth.toISOString();
    if(change==="month")state.sqlite.prepare("UPDATE consequential_executions SET expires_at=? WHERE execution_id=?").run(new Date(nextMonth.getTime()+86_400_000).toISOString(),id);
    const pattern=boundary==="claim"?/^\s*UPDATE consequential_executions SET status='reserved'/u:/^\s*UPDATE consequential_execution_steps SET status='submitting'/u,restore=interceptConsequentialDb(state,"run",pattern,()=>clock.set(later));
    try{if(boundary==="claim"){const result=await consequential.claimConsequentialExecution(state.env,state.user,state.binding,id,state.quote.bindingHash,state.sourceHead);assert.equal(result.status,409);assert.ok(result.error);assert.equal(consequentialReceipt(state,id).execution.status,"quoted");assert.equal(consequentialReceipt(state,id).tokens.length,0);assert.equal(consequentialReceipt(state,id).cost.length,0);}else{await assert.rejects(consequential.beginConsequentialStep(state.env,state.user,state.binding,id,0,state.sourceHead),/context_authorization_changed/u);assert.equal(await consequential.failConsequentialExecution(state.env,state.user.userId,id,"context_consent_expired"),false);assert.equal(consequentialReceipt(state,id).steps[0].status,"not-submitted");}assert.deepEqual(consequentialBalances(state),{tokens:{used:0,reserved:0},cost:{used:0,reserved:0}});}finally{restore();clock.close();}
  });
}

const adaptiveConsentPath="/api/document-jobs/adaptive";
const adaptiveConsentBody={projectId:"project-atmosphere",documentId:"doc-atmosphere",sourceSurface:"studio",projectScope:false,prompt:"Help me choose the next meaningful creative decision.",locale:"en"};
const adaptiveFixtureStructure={interpretation:"A private proposal, not an authored change.",active_decision:{type:"subject",label:"Choose a subject",prompt:"Which subject matters most?",why:"Focus the next decision."},suggested_blocks:[{type:"subject",subtype:"Hero subject",label:"Subject",instruction:"Choose one focal subject.",reason:"Give the work a clear focus.",relationship_to:"Current direction"},{type:"environment",subtype:"Setting",label:"Setting",instruction:"Place the subject in a quiet courtyard.",reason:"Make the setting concrete.",relationship_to:"Subject"}],hidden_until_later:["Fine lighting choices"]};
const adaptiveFixtureResponse=(payload,{status=200,usage={input_tokens:1000,output_tokens:300,total_tokens:1300},outputText=JSON.stringify(adaptiveFixtureStructure)}={})=>Response.json({id:"adaptive-consent-response",model:payload.model,service_tier:"default",output_text:outputText,...(usage?{usage}:{})},{status});
const quoteAdaptiveConsent=async(state,body=adaptiveConsentBody,headers={})=>{const result=await state.request(adaptiveConsentPath,json({...body,action:"quote"},headers));assert.equal(result.status,200,JSON.stringify(await result.clone().json()));return(await result.json()).quote;};
const executeAdaptiveConsent=(state,quote,body=adaptiveConsentBody,headers={})=>state.request(adaptiveConsentPath,json({...body,action:"execute",executionId:quote.executionId,approvedBindingHash:quote.bindingHash},headers));
const retrieveAdaptiveConsent=(state,quote,body=adaptiveConsentBody,headers={})=>state.request(adaptiveConsentPath,json({...body,action:"retrieve",executionId:quote.executionId,approvedBindingHash:quote.bindingHash},headers));
const adaptiveJob=(state,id)=>state.sqlite.prepare("SELECT * FROM document_jobs WHERE job_id=?").get(id);
const adaptiveAuthoredCount=(state,stream="creative:dev-local-creative")=>state.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE stream_id=? AND type IN('BlockCreated','BlockPropertyEdited','BlockRemoved','BlockLocked','BlockUnlocked','BlockRelationAdded','BlockRelationRemoved','CanvasItemPlaced','CanvasItemMoved','CanvasItemRemoved')").get(stream).n;
const adaptiveLedgerCounts=(state)=>({token:state.sqlite.prepare("SELECT COUNT(*) AS n FROM budget_reservations").get().n,cost:state.sqlite.prepare("SELECT COUNT(*) AS n FROM cost_budget_reservations").get().n});
async function adaptiveCanvasFixture({provider=true}={}){const state=await fixture({provider}),canvasId="adaptive-consent-board";appendFixtureEvents(state.sqlite,"creative:dev-local-creative",[["CanvasCreated",{canvas_id:canvasId,project_id:"project-atmosphere",name:"Reusable consent board",slug:"reusable-consent-board"}]]);return{...state,body:{...adaptiveConsentBody,canvasId,sourceSurface:"canvas",projectScope:true}};}
function changeAdaptiveAuthority(state,change,body=state.body??adaptiveConsentBody){if(change==="permission")state.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id='dev-local-creative'").run();else appendFixtureEvents(state.sqlite,"creative:dev-local-creative",[change==="board"?["CanvasRemoved",{canvas_id:body.canvasId,project_id:body.projectId}]:["BlockPropertyEdited",{project_id:body.projectId,document_id:body.documentId,block_id:"block-direction",property_path:"text",new_value:"A materially different creative direction."}]]);}

async function seedAdaptiveRightsDeadline(state,source,validUntil,later,origin=null){
  const governed=source.startsWith("governed-"),owner=governed?"assistant-owner":"dev-local-creative",stream="creative:"+owner,blockId="adaptive-license-boundary";
  const body={...adaptiveConsentBody},headers=governed?state.owner:{},text="Retain this complete licensed source, including its protected contractual tail.";
  if(!governed){
    const referenceId="adaptive-license-reference";
    appendFixtureEvents(state.sqlite,stream,[
      ["ReferenceIngested",{project_id:body.projectId,document_id:body.documentId,reference_id:referenceId,source_type:"text",source_ref:"",rights_class:source}],
      ["RightsAsserted",{project_id:body.projectId,document_id:body.documentId,reference_id:referenceId,rights_class:source,assertion_method:"licensed-fixture"}],
      ["BlockCreated",{block_id:blockId,project_id:body.projectId,document_id:body.documentId,type:"reference",handle:"Licensed exact source",position:"z-rights",properties:{reference_id:referenceId,text,rights_class:source,source_expires_at:later,license_expires_at:validUntil,rights_expires_at:later,intent:"prohibit"}}],
    ]);
  }else{
    const sourceDocumentId=origin?.documentId??"adaptive-rights-origin",sourceBlockId=origin?.blockId??"adaptive-rights-upstream",packageId="adaptive-rights-package",versionId="adaptive-rights-version",snapshotExpiry=source==="governed-snapshot"?validUntil:later,upstreamExpiry=source==="governed-upstream"?validUntil:later;
    appendFixtureEvents(state.sqlite,stream,[
      ...(!origin?[
        ["DocumentCreated",{document_id:sourceDocumentId,project_id:body.projectId,title:"Licensed upstream source",slug:"licensed-upstream-source"}],
        ["BlockCreated",{block_id:sourceBlockId,project_id:body.projectId,document_id:sourceDocumentId,type:"message",handle:"Original license",position:"z-origin",properties:{text:"Original upstream licensed material.",rights_class:"owned_or_licensed",license_expires_at:upstreamExpiry}}],
      ]:[]),
      ["BlockCreated",{block_id:blockId,project_id:body.projectId,document_id:body.documentId,type:"message",handle:"Published governed source",position:"z-rights",properties:{text,rights_class:"owned_or_licensed",license_expires_at:later,organization_context_package_id:packageId,organization_context_package_version_id:versionId}}],
    ]);
    // An already-reviewed immutable version: real scope/schema and byte-for-byte digest.
    const snapshot={schema:1,organizationId:state.organizationId,sourceProjectAccessId:state.projectAccessId,sourceDocumentId,blocks:[{sourceBlockId,type:"message",properties:{text,rights_class:"owned_or_licensed",license_expires_at:later},rightsExpiresAt:snapshotExpiry}]},serialized=JSON.stringify(snapshot),digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(serialized))),byte=>byte.toString(16).padStart(2,"0")).join(""),now=new Date().toISOString();
    state.sqlite.prepare("INSERT INTO organization_context_packages(package_id,organization_id,name,description,status,created_by_user_id,created_at,updated_at)VALUES(?,?,'Licensed package','','active',?,?,?)").run(packageId,state.organizationId,owner,now,now);
    state.sqlite.prepare("INSERT INTO organization_context_package_versions(version_id,package_id,organization_id,version,content_sha256,source_project_access_id,source_document_id,status,created_by_user_id,approved_by_user_id,published_at,created_at,redacted_at)VALUES(?,?,?,1,?,?,?,'published',?,'assistant-viewer',?,?,NULL)").run(versionId,packageId,state.organizationId,digest,state.projectAccessId,sourceDocumentId,owner,now,now);
    state.sqlite.prepare("INSERT INTO organization_context_package_contents(version_id,organization_id,content_json,created_at,redacted_at)VALUES(?,?,?,?,NULL)").run(versionId,state.organizationId,serialized,now);
    state.sqlite.prepare("INSERT INTO organization_context_package_sources(version_id,organization_id,source_project_access_id,source_block_id,source_kind,content_sha256,rights_expires_at,position)VALUES(?,?,?,?,'message',?,?,0)").run(versionId,state.organizationId,state.projectAccessId,sourceBlockId,digest,snapshotExpiry);
  }
  return{body,headers,blockId,text,owner};
}


for (const source of ["owned", "owned_or_licensed", "governed-upstream", "governed-snapshot"]) {
  test("adaptive post-CAS deadline: " + source + " expires after successful begin without dispatch", { timeout: 15_000 }, async () => {
    const NativeDate = globalThis.Date, originalFetch = globalThis.fetch;
    let state, clock, restore, calls = 0, interleavings = 0;
    const wall = new NativeDate(), frozen = NativeDate.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), 1);
    let now = frozen;
    try {
      globalThis.fetch = async () => { calls++; throw new Error("An expired source must never reach the provider"); };
      state = source.startsWith("governed-") ? await sharedProjectFixture({ provider: true }) : await fixture({ provider: true });
      globalThis.Date = class extends NativeDate {
        constructor(...args) { super(...(args.length ? args : [now])); }
        static now() { return now; }
      };
      clock = consequentialDbClock(state);
      const validUntil = new NativeDate(frozen + 1_000).toISOString(), later = new NativeDate(frozen + 300_000).toISOString();
      const input = await seedAdaptiveRightsDeadline(state, source, validUntil, later);
      const quote = await quoteAdaptiveConsent(state, input.body, input.headers);
      assert.equal(quote.canExecute, true); assert.equal(quote.privateInput.sourceRightsValidUntil, validUntil);
      const exactInput = JSON.parse(quote.privateInput.providerRequest.input);
      assert.equal(exactInput.blocks.find(block => block.id === input.blockId)?.properties.text, input.text);
      restore = interceptConsequentialDb(state, "run", /^\s*UPDATE consequential_execution_steps SET status='submitting'/u, statements => {
        interleavings++;
        assert.ok(statements.some(statement => statement.values.includes(validUntil)));
        const submitted = consequentialReceipt(state, quote.executionId);
        assert.equal(submitted.steps[0].status, "submitting", "The real CAS has already succeeded while the source is valid");
        assert.equal(submitted.tokens[0].status, "active"); assert.equal(submitted.cost[0].status, "executing");
        assert.equal(calls, 0); assert.ok(now < NativeDate.parse(validUntil));
        now = NativeDate.parse(validUntil) + 40; clock.set(new NativeDate(now).toISOString());
        assert.ok(now < NativeDate.parse(quote.expiresAt), "The quote itself is still live");
        assert.equal(new NativeDate(now).toISOString().slice(0, 7), quote.period);
        assert.ok(now < NativeDate.parse(adaptiveJob(state, quote.executionId).lease_expires_at), "This isolates source expiry, not lease expiry");
      }, "after");
      const accepted = await executeAdaptiveConsent(state, quote, input.body, input.headers);
      assert.equal(accepted.status, 202, JSON.stringify(await accepted.clone().json()));
      await state.drainBackground(); restore(); restore = null;
      assert.equal(interleavings, 1); assert.equal(calls, 0);
      const receipt = consequentialReceipt(state, quote.executionId);
      assert.equal(receipt.execution.status, "failed"); assert.equal(receipt.execution.result_ref, null);
      assert.equal(receipt.steps[0].status, "not-submitted");
      assert.equal(receipt.steps[0].provider_request_id, null);
      assert.equal(receipt.steps[0].verified_tokens, null); assert.equal(receipt.steps[0].verified_microusd, null);
      assert.deepEqual(receipt.tokens.map(row => [row.status, row.used_tokens]), [["released", 0]]);
      assert.deepEqual(receipt.cost.map(row => [row.status, row.used_microusd]), [["released", 0]]);
      assert.deepEqual(consequentialBalances(state, input.owner), { tokens: { used: 0, reserved: 0 }, cost: { used: 0, reserved: 0 } });
      assert.equal(adaptiveJob(state, quote.executionId).status, "failed");
      const originalLedgers = adaptiveReentryFinancialState(state);
      await consequential.reconcileConsequentialUsage(state.env, input.owner, quote.executionId);
      assert.deepEqual(consequentialReceipt(state, quote.executionId), receipt);
      assert.deepEqual(adaptiveReentryFinancialState(state), originalLedgers); assert.equal(calls, 0);
    } finally {
      restore?.(); await state?.drainBackground(); clock?.close();
      globalThis.Date = NativeDate; globalThis.fetch = originalFetch;
    }
  });
}

for (const force of [false, true]) {
  test("adaptive post-CAS cancellation: " + (force ? "force-stop" : "cancel") + " before the successful SQL response prevents dispatch", { timeout: 15_000 }, async () => {
    const state = await fixture({ provider: true }), originalFetch = globalThis.fetch;
    let calls = 0, interleavings = 0, restore;
    try {
      if (force) state.sqlite.prepare("UPDATE users SET role='admin' WHERE user_id='dev-local-creative'").run();
      globalThis.fetch = async (_url, init) => { calls++; return adaptiveFixtureResponse(JSON.parse(init.body)); };
      const quote = await quoteAdaptiveConsent(state), path = "/api/document-jobs/" + quote.executionId + (force ? "/force-fail" : "/cancel");
      restore = interceptConsequentialDb(state, "run", /^\s*UPDATE consequential_execution_steps SET status='submitting'/u, async () => {
        interleavings++;
        const submitted = consequentialReceipt(state, quote.executionId);
        assert.equal(submitted.steps[0].status, "submitting"); assert.equal(calls, 0);
        assert.equal(submitted.tokens[0].status, "active"); assert.equal(submitted.cost[0].status, "executing");
        const held = adaptiveReentryFinancialState(state);
        const stopped = await state.request(path, json({})), stop = await stopped.json();
        assert.equal(stopped.status, 200, JSON.stringify(stop));
        assert.equal(stop.job.status, force ? "failed" : "canceled");
        assert.deepEqual(stop.budget, { reservationStatus: "retained", billingStatus: "pending" }, "Until the winning executor proves no fetch, cancellation must retain the uncertain hold");
        assert.deepEqual(adaptiveReentryFinancialState(state), held);
        assert.equal(consequentialReceipt(state, quote.executionId).steps[0].status, "uncertain");
        assert.equal(calls, 0);
      }, "after");
      const accepted = await executeAdaptiveConsent(state, quote);
      assert.equal(accepted.status, 202, JSON.stringify(await accepted.clone().json()));
      await state.drainBackground(); restore(); restore = null;
      assert.equal(interleavings, 1); assert.equal(calls, 0, "A stopped job cannot initiate its first paid POST after cancellation");
      const receipt = consequentialReceipt(state, quote.executionId);
      assert.equal(receipt.execution.status, "failed"); assert.equal(receipt.execution.result_ref, null);
      assert.equal(receipt.steps[0].status, "not-submitted"); assert.equal(receipt.steps[0].provider_request_id, null);
      assert.deepEqual(receipt.tokens.map(row => [row.status, row.used_tokens]), [["released", 0]]);
      assert.deepEqual(receipt.cost.map(row => [row.status, row.used_microusd]), [["released", 0]]);
      assert.deepEqual(receipt.balances, { tokens: { used: 0, reserved: 0 }, cost: { used: 0, reserved: 0 } });
      assert.equal(adaptiveJob(state, quote.executionId).status, force ? "failed" : "canceled");
      const repeated = await state.request(path, json({})); assert.equal(repeated.status, 200);
      assert.deepEqual((await repeated.json()).budget, { reservationStatus: "released", billingStatus: "not-incurred" });
      assert.deepEqual(consequentialReceipt(state, quote.executionId), receipt);
      await consequential.reconcileConsequentialUsage(state.env, "dev-local-creative", quote.executionId);
      assert.deepEqual(consequentialReceipt(state, quote.executionId), receipt); assert.equal(calls, 0);
    } finally { restore?.(); await state.drainBackground(); globalThis.fetch = originalFetch; }
  });
}

function postCasExactReceipt(state, id) {
  return {
    execution: { ...state.sqlite.prepare("SELECT * FROM consequential_executions WHERE execution_id=?").get(id) },
    steps: state.sqlite.prepare("SELECT * FROM consequential_execution_steps WHERE execution_id=? ORDER BY step_index").all(id).map(row => ({ ...row })),
    finances: adaptiveReentryFinancialState(state),
  };
}

for (const status of ["submitting", "uncertain"]) {
  test("adaptive post-CAS non-submission proof: matching " + status + " winner releases only through normal failure", { timeout: 15_000 }, async () => {
    const originalFetch = globalThis.fetch; let calls = 0;
    try {
      globalThis.fetch = async () => { calls++; throw new Error("No provider request belongs in the proof fixture"); };
      const state = await consequentialContractFixture({ reserve: true }), id = state.executionId;
      await consequential.beginConsequentialStep(state.env, state.user, state.binding, id, 0, state.sourceHead);
      if (status === "uncertain") assert.equal(await consequential.failConsequentialExecution(state.env, state.user.userId, id, "context_canceled"), true);
      assert.equal(consequentialReceipt(state, id).steps[0].status, status);
      const held = adaptiveReentryFinancialState(state);
      await consequential.proveConsequentialStepNotSubmitted(state.env, state.user.userId, id, 0, state.quote.bindingHash);
      const proven = consequentialReceipt(state, id);
      assert.equal(proven.steps[0].status, "not-submitted");
      assert.equal(proven.steps[0].provider_request_id, null);
      assert.equal(proven.steps[0].verified_tokens, null); assert.equal(proven.steps[0].verified_microusd, null);
      assert.deepEqual(adaptiveReentryFinancialState(state), held, "The proof itself must not settle, debit, or release either ledger");
      assert.equal(await consequential.failConsequentialExecution(state.env, state.user.userId, id, "adaptive_source_rights_unavailable"), false);
      const released = consequentialReceipt(state, id);
      assert.equal(released.execution.status, "failed"); assert.equal(released.execution.result_ref, null);
      assert.deepEqual(released.tokens.map(row => [row.status, row.used_tokens]), [["released", 0]]);
      assert.deepEqual(released.cost.map(row => [row.status, row.used_microusd]), [["released", 0]]);
      assert.deepEqual(released.balances, { tokens: { used: 0, reserved: 0 }, cost: { used: 0, reserved: 0 } });
      await consequential.reconcileConsequentialUsage(state.env, state.user.userId, id);
      assert.deepEqual(consequentialReceipt(state, id), released); assert.equal(calls, 0);
    } finally { globalThis.fetch = originalFetch; }
  });
}

for (const status of ["submitting", "uncertain"]) for (const guard of [
  "verified-zero-tokens", "verified-zero-cost", "provider-id", "completed", "result-ref", "other-actor", "other-hash", "other-step",
]) {
  test("adaptive post-CAS non-submission proof: " + status + " preserves " + guard, { timeout: 15_000 }, async () => {
    const originalFetch = globalThis.fetch; let calls = 0;
    try {
      globalThis.fetch = async () => { calls++; throw new Error("Proof guards must never dispatch"); };
      const state = await consequentialContractFixture({ reserve: true }), id = state.executionId;
      await consequential.beginConsequentialStep(state.env, state.user, state.binding, id, 0, state.sourceHead);
      if (status === "uncertain") assert.equal(await consequential.failConsequentialExecution(state.env, state.user.userId, id, "context_canceled"), true);
      // Isolate each guard, including zero as real evidence rather than a falsy absence.
      if (guard === "verified-zero-tokens") state.sqlite.prepare("UPDATE consequential_execution_steps SET verified_tokens=0 WHERE execution_id=?").run(id);
      if (guard === "verified-zero-cost") state.sqlite.prepare("UPDATE consequential_execution_steps SET verified_microusd=0 WHERE execution_id=?").run(id);
      if (guard === "provider-id") state.sqlite.prepare("UPDATE consequential_execution_steps SET provider_request_id='accepted-provider-proof' WHERE execution_id=?").run(id);
      if (guard === "completed") state.sqlite.prepare("UPDATE consequential_executions SET status='completed' WHERE execution_id=?").run(id);
      if (guard === "result-ref") state.sqlite.prepare("UPDATE consequential_executions SET result_ref='retained-result-proof' WHERE execution_id=?").run(id);
      const before = postCasExactReceipt(state, id);
      await consequential.proveConsequentialStepNotSubmitted(
        state.env, guard === "other-actor" ? "other-actor" : state.user.userId, id,
        guard === "other-step" ? 1 : 0, guard === "other-hash" ? "0".repeat(64) : state.quote.bindingHash,
      );
      assert.deepEqual(postCasExactReceipt(state, id), before, "No status, evidence, timestamp, hold, or counter may change");
      assert.equal(calls, 0);
    } finally { globalThis.fetch = originalFetch; }
  });
}

test("adaptive post-CAS non-submission proof: an actual settled completion wins before the stale proof SQL", { timeout: 15_000 }, async () => {
  const originalFetch = globalThis.fetch; let gate, calls = 0;
  try {
    globalThis.fetch = async () => { calls++; throw new Error("This race reuses already verified usage"); };
    const state = await consequentialContractFixture({ reserve: true }), id = state.executionId;
    await consequential.beginConsequentialStep(state.env, state.user, state.binding, id, 0, state.sourceHead);
    gate = gateConsequentialDb(state, "run", /^\s*UPDATE consequential_execution_steps SET status='not-submitted',updated_at=/u);
    const staleProof = consequential.proveConsequentialStepNotSubmitted(state.env, state.user.userId, id, 0, state.quote.bindingHash);
    await gate.entered;
    await consequential.settleConsequentialStep(state.env, state.user.userId, id, 0, 1300, 5600, "verified-completed-response");
    await consequential.completeConsequentialExecution(state.env, state.user, state.binding, id, { executionId: id, plan: { proposals: [] } });
    const completed = postCasExactReceipt(state, id), resultRef = completed.execution.result_ref;
    assert.equal(completed.execution.status, "completed"); assert.ok(resultRef);
    assert.equal(completed.steps[0].status, "settled"); assert.equal(completed.steps[0].provider_request_id, "verified-completed-response");
    const privateResult = { ...state.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(resultRef) };
    assert.deepEqual(consequentialBalances(state), { tokens: { used: 1300, reserved: 0 }, cost: { used: 5600, reserved: 0 } });
    gate.release(); await staleProof; gate.restore(); gate = null;
    assert.deepEqual(postCasExactReceipt(state, id), completed);
    assert.equal(await consequential.failConsequentialExecution(state.env, state.user.userId, id, "late_unsubmitted_claim"), false);
    await consequential.reconcileConsequentialUsage(state.env, state.user.userId, id);
    assert.deepEqual(postCasExactReceipt(state, id), completed);
    assert.deepEqual({ ...state.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(resultRef) }, privateResult);
    assert.equal(calls, 0);
  } finally { gate?.release(); gate?.restore(); globalThis.fetch = originalFetch; }
});


for(const source of["owned","owned_or_licensed","governed-upstream","governed-snapshot"])for(const[seam,kind,pattern]of[
  ["step claim","run",/^\s*UPDATE consequential_execution_steps SET status='reserved'/u],
  ["token INSERT","batch",/^\s*INSERT OR IGNORE INTO budget_reservations\b/u],
  ["cost INSERT","batch",/^\s*INSERT OR IGNORE INTO cost_budget_reservations\b/u],
  ["begin","run",/^\s*UPDATE consequential_execution_steps SET status='submitting'/u],
]){
  test("adaptive rights deadline: "+source+" expires at "+seam+" without dispatch or stranded holds",{timeout:15_000},async()=>{
    const NativeDate=globalThis.Date,originalFetch=globalThis.fetch;let state,clock,restore,calls=0,interleavings=0;
    try{
      globalThis.fetch=async()=>{calls++;throw new Error("Expired source must never reach the provider");};
      state=source.startsWith("governed-")?await sharedProjectFixture({provider:true}):await fixture({provider:true});
      // Keep JavaScript's preparation clock unchanged while SQLite reaches the deadline.
      // The month's start makes consent/month/lease validity independent of wall-clock test time.
      const wall=new NativeDate(),frozen=NativeDate.UTC(wall.getUTCFullYear(),wall.getUTCMonth(),1),validUntil=new NativeDate(frozen+60_000).toISOString(),later=new NativeDate(frozen+300_000).toISOString();
      globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[frozen]));}static now(){return frozen;}};
      clock=consequentialDbClock(state);
      const input=await seedAdaptiveRightsDeadline(state,source,validUntil,later),quote=await quoteAdaptiveConsent(state,input.body,input.headers),providerInput=JSON.parse(quote.privateInput.providerRequest.input);
      assert.equal(quote.canExecute,true);assert.equal(quote.privateInput.sourceRightsValidUntil,validUntil);assert.equal(providerInput.blocks.find(block=>block.id===input.blockId)?.properties.text,input.text,"Every licensed source remains in the exact approved input");
      if(source.startsWith("governed-"))assert.equal(providerInput.blocks.some(block=>block.id==="adaptive-rights-upstream"),false,"A current upstream deadline must be checked even when that source block is outside the provider request");
      const retained=state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=(SELECT consent_ref FROM consequential_executions WHERE execution_id=?)").get(quote.executionId);
      assert.equal(JSON.parse(retained.content).binding.request.sourceRightsValidUntil,validUntil);
      restore=interceptConsequentialDb(state,kind,pattern,statements=>{
        interleavings++;assert.ok(statements.some(statement=>statement.values.includes(validUntil)),"The actual mutation must carry the normalized source deadline");
        assert.ok(Date.now()<NativeDate.parse(validUntil));clock.set(validUntil);
        const live=state.sqlite.prepare("SELECT ?>strftime('%Y-%m-%dT%H:%M:%fZ','now') AS quote_live,?=strftime('%Y-%m','now') AS month_live").get(quote.expiresAt,quote.period);
        assert.equal(live.quote_live,1);assert.equal(live.month_live,1,"No unrelated consent/month expiry may cause the rejection");
      });
      const accepted=await executeAdaptiveConsent(state,quote,input.body,input.headers);assert.equal(accepted.status,202,JSON.stringify(await accepted.clone().json()));await state.drainBackground();restore();restore=null;
      assert.equal(interleavings,1);assert.equal(calls,0);
      const receipt=consequentialReceipt(state,quote.executionId);assert.equal(receipt.execution.status,"failed");assert.equal(receipt.execution.result_ref,null);assert.equal(receipt.steps[0].status,"not-submitted");assert.equal(receipt.steps[0].provider_request_id,null);
      assert.equal(receipt.tokens.length,seam==="cost INSERT"||seam==="begin"?1:0);assert.equal(receipt.cost.length,seam==="begin"?1:0);
      assert.ok(receipt.tokens.every(row=>row.status==="released"&&row.used_tokens===0));assert.ok(receipt.cost.every(row=>row.status==="released"&&row.used_microusd===0));
      assert.deepEqual(consequentialBalances(state,input.owner),{tokens:{used:0,reserved:0},cost:{used:0,reserved:0}});assert.equal(adaptiveJob(state,quote.executionId).status,"failed");
      await consequential.reconcileConsequentialUsage(state.env,input.owner,quote.executionId);assert.deepEqual(consequentialReceipt(state,quote.executionId),receipt);assert.equal(calls,0);
    }finally{restore?.();await state?.drainBackground();clock?.close();globalThis.Date=NativeDate;globalThis.fetch=originalFetch;}
  });
}
for(const source of["owned_or_licensed","governed-upstream"])test("adaptive rights deadline: paid "+source+" receipts remain retrievable after license expiry",{timeout:15_000},async()=>{
  const NativeDate=globalThis.Date,originalFetch=globalThis.fetch;let state,clock,calls=0;
  try{
    globalThis.fetch=async(_url,init)=>{calls++;return adaptiveFixtureResponse(JSON.parse(init.body));};
    state=source.startsWith("governed-")?await sharedProjectFixture({provider:true}):await fixture({provider:true});
    const wall=new NativeDate();let now=NativeDate.UTC(wall.getUTCFullYear(),wall.getUTCMonth(),1);
    const validUntil=new NativeDate(now+60_000).toISOString(),later=new NativeDate(now+300_000).toISOString();
    globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
    clock=consequentialDbClock(state);const input=await seedAdaptiveRightsDeadline(state,source,validUntil,later),quote=await quoteAdaptiveConsent(state,input.body,input.headers);
    assert.equal(quote.privateInput.sourceRightsValidUntil,validUntil);const accepted=await executeAdaptiveConsent(state,quote,input.body,input.headers);assert.equal(accepted.status,202,JSON.stringify(await accepted.clone().json()));await state.drainBackground();
    assert.equal(adaptiveJob(state,quote.executionId).status,"completed");const before=consequentialReceipt(state,quote.executionId),balances=consequentialBalances(state,input.owner);
    now=NativeDate.parse(validUntil);clock.set(validUntil);delete state.env.OPENAI_API_KEY;
    const retained=await retrieveAdaptiveConsent(state,quote,input.body,input.headers);assert.equal(retained.status,200,JSON.stringify(await retained.clone().json()));assert.deepEqual((await retained.json()).structure,adaptiveFixtureStructure);
    assert.deepEqual(consequentialReceipt(state,quote.executionId),before);assert.deepEqual(consequentialBalances(state,input.owner),balances);assert.equal(calls,1);
  }finally{await state?.drainBackground();clock?.close();globalThis.Date=NativeDate;globalThis.fetch=originalFetch;}
});


async function seedAdaptiveSeparateProjectGoverned(state,{sameOwner=false}={}){
  const later=new Date(Date.now()+300_000).toISOString();
  const sourceOwner=sameOwner?"assistant-owner":"dev-local-creative",sourceHeaders=sameOwner?state.owner:{},sourceStream="creative:"+sourceOwner,sourceProjectId="adaptive-upstream-project",sourceDocumentId="adaptive-separate-rights-origin",sourceBlockId="adaptive-separate-rights-upstream";
  if(!sameOwner){
    const email=state.sqlite.prepare("SELECT email FROM users WHERE user_id=?").get(sourceOwner).email;
    const invited=await state.request("/api/workspaces/"+state.organizationId+"/members",json({email,role:"administrator"},state.owner));
    assert.equal(invited.status,201,JSON.stringify(await invited.clone().json()));const invitation=await invited.json(),token=new URL(invitation.invitationUrl).searchParams.get("token");
    const accepted=await state.request("/api/workspaces/"+state.organizationId+"/invitations/"+invitation.invitationId+"/accept",json({token}));
    assert.equal(accepted.status,200,JSON.stringify(await accepted.clone().json()));
  }
  appendFixtureEvents(state.sqlite,sourceStream,[
    ["ProjectCreated",{project_id:sourceProjectId,name:"Separate licensed-source project",slug:"separate-licensed-source-project"}],
    ["DocumentCreated",{project_id:sourceProjectId,document_id:sourceDocumentId,title:"Original licensed source",slug:"original-licensed-source"}],
    ["BlockCreated",{project_id:sourceProjectId,document_id:sourceDocumentId,block_id:sourceBlockId,type:"message",handle:"Cross-owner license",position:"a",properties:{text:"Original upstream licensed material.",rights_class:"owned_or_licensed",license_expires_at:later}}],
  ]);
  const registered=await state.request("/api/workspaces/"+state.organizationId+"/projects",json({projectId:sourceProjectId},sourceHeaders));
  assert.equal(registered.status,201,JSON.stringify(await registered.clone().json()));const sourceProjectAccessId=(await registered.json()).projectAccessId;
  const input=await seedAdaptiveRightsDeadline({...state,projectAccessId:sourceProjectAccessId},"governed-upstream",later,later,{documentId:sourceDocumentId,blockId:sourceBlockId}),packageId="adaptive-rights-package",versionId="adaptive-rights-version";
  const {synchronizeProjectScope}=await import("../worker/project-access.ts");
  await synchronizeProjectScope(state.env,{organizationId:state.organizationId,projectAccessId:sourceProjectAccessId,projectId:sourceProjectId,ownerUserId:sourceOwner});
  const {governedPackageSourceRightsValidity}=await import("../worker/context-package-rights.ts");
  const rights=()=>governedPackageSourceRightsValidity(state.env,state.organizationId,[{properties:{organization_context_package_id:packageId,organization_context_package_version_id:versionId}}]);
  assert.equal((await rights()).current,true);assert.equal(sourceOwner===input.owner,sameOwner);assert.notEqual(sourceProjectAccessId,state.projectAccessId);
  return{...input,sourceOwner,sourceStream,sourceProjectId,sourceProjectAccessId,sourceDocumentId,sourceBlockId,packageId,versionId,rights};
}
for(const mutation of["upstream revoked","package redacted"])test("adaptive governed dispatch: "+mutation+" at submitting CAS cannot dispatch old approved bytes",{timeout:15_000},async()=>{
  const originalFetch=globalThis.fetch;let state,restore,calls=0,interleavings=0,mutations=0;
  try{
    globalThis.fetch=async(_url,init)=>{calls++;return adaptiveFixtureResponse(JSON.parse(init.body));};
    state=await sharedProjectFixture({provider:true});const input=await seedAdaptiveSeparateProjectGoverned(state),quote=await quoteAdaptiveConsent(state,input.body,input.headers);
    assert.equal(quote.canExecute,true);assert.equal(JSON.parse(quote.privateInput.providerRequest.input).blocks.find(block=>block.id===input.blockId)?.properties.text,input.text);
    assert.equal(/dispatchDependencies|sourceRightsDispatchProof/u.test(JSON.stringify(quote)),false,"Upstream byte custody is server-only, not consent or provider content");
    restore=interceptConsequentialDb(state,"run",/^\s*UPDATE consequential_execution_steps SET status='submitting'/u,async statements=>{
      interleavings++;const targetStream="creative:"+input.owner,head=()=>Number(state.sqlite.prepare("SELECT COALESCE(MAX(sequence),0) AS n FROM events WHERE stream_id=?").get(targetStream).n),before=head();
      assert.equal((await input.rights()).current,true,"The source license is current immediately before the actual submitting mutation");
      if(mutation==="upstream revoked"){
        appendFixtureEvents(state.sqlite,input.sourceStream,[["BlockPropertyEdited",{project_id:input.sourceProjectId,document_id:input.sourceDocumentId,block_id:input.sourceBlockId,property_path:"rights_revoked",new_value:true}]]);
        const {synchronizeProjectScope}=await import("../worker/project-access.ts");
        await synchronizeProjectScope(state.env,{organizationId:state.organizationId,projectAccessId:input.sourceProjectAccessId,projectId:input.sourceProjectId,ownerUserId:input.sourceOwner});
      }else state.sqlite.prepare("UPDATE organization_context_package_contents SET redacted_at=? WHERE version_id=?").run(new Date().toISOString(),input.versionId);
      assert.equal(head(),before,"Neither upstream-only change may alter target sourceHead");
      assert.equal((await input.rights()).current,false,"The exact same live validator now rejects the source");
      assert.equal(statements.length,1);mutations++;
    });
    const accepted=await executeAdaptiveConsent(state,quote,input.body,input.headers);assert.equal(accepted.status,202,JSON.stringify(await accepted.clone().json()));await state.drainBackground();restore();restore=null;
    const receipt=consequentialReceipt(state,quote.executionId);
    assert.equal(interleavings,1);assert.equal(mutations,1,"The intended concurrent mutation must actually commit");assert.equal(calls,0);
    assert.equal(receipt.execution.status,"failed");assert.equal(receipt.execution.error_code,"context_authorization_changed");assert.equal(receipt.execution.result_ref,null);assert.equal(receipt.steps[0].status,"not-submitted");assert.equal(receipt.steps[0].provider_request_id,null);
    assert.equal(receipt.tokens.length,1);assert.equal(receipt.cost.length,1);assert.equal(receipt.tokens[0].status,"released");assert.equal(receipt.cost[0].status,"released");
    assert.deepEqual(consequentialBalances(state,input.owner),{tokens:{used:0,reserved:0},cost:{used:0,reserved:0}});
  }finally{restore?.();await state?.drainBackground();globalThis.fetch=originalFetch;}
});

test("adaptive governed dispatch: a same-owner source in another project refreshes its index and completes once",{timeout:15_000},async()=>{
  const originalFetch=globalThis.fetch;let state,restore,calls=0,reservationChecks=0,sourceBehindAtReservation=false;
  try{
    globalThis.fetch=async(_url,init)=>{calls++;return adaptiveFixtureResponse(JSON.parse(init.body));};
    state=await sharedProjectFixture({provider:true});const input=await seedAdaptiveSeparateProjectGoverned(state,{sameOwner:true}),authoredBefore=adaptiveAuthoredCount(state,input.sourceStream),quote=await quoteAdaptiveConsent(state,input.body,input.headers);
    assert.equal(quote.canExecute,true);assert.equal(JSON.parse(quote.privateInput.providerRequest.input).blocks.find(block=>block.id===input.blockId)?.properties.text,input.text);
    const index=()=>state.sqlite.prepare("SELECT migration.last_owner_sequence AS indexed,(SELECT MAX(sequence) FROM events WHERE stream_id=?) AS live FROM project_migration_states migration WHERE migration.project_access_id=?").get(input.sourceStream,input.sourceProjectAccessId);
    assert.equal(index().indexed,index().live,"The source index is current at quote; only the later target job anchor advances the shared stream");
    restore=interceptConsequentialDb(state,"run",/^\s*UPDATE consequential_execution_steps SET status='reserved'/u,()=>{
      reservationChecks++;const current=index();sourceBehindAtReservation=current.indexed<current.live;
      assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE stream_id=? AND type='ProjectDocumentJobQueued' AND json_extract(payload,'$.job_id')=?").get(input.sourceStream,quote.executionId).n,1);
    });
    const accepted=await executeAdaptiveConsent(state,quote,input.body,input.headers);assert.equal(accepted.status,202,JSON.stringify(await accepted.clone().json()));await state.drainBackground();restore();restore=null;
    const receipt=consequentialReceipt(state,quote.executionId);
    assert.equal(calls,1,"A target-only job anchor must not prevent this unchanged licensed source from running");
    assert.equal(reservationChecks,1);assert.equal(sourceBehindAtReservation,false,"The source derived index must catch up before the guarded reservation");
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM project_event_scopes scope JOIN events event ON event.event_id=scope.event_id WHERE scope.project_access_id=? AND event.type=\'ProjectDocumentJobQueued\' AND json_extract(event.payload,\'$.job_id\')=?").get(input.sourceProjectAccessId,quote.executionId).n,0,"Refreshing the source must not scope another project\'s job anchor into it");
    assert.equal(adaptiveJob(state,quote.executionId).status,"completed");assert.equal(receipt.execution.status,"completed");assert.equal(receipt.steps[0].status,"settled");
    assert.deepEqual(consequentialBalances(state,input.owner),{tokens:{used:1300,reserved:0},cost:{used:5600,reserved:0}});
    assert.equal(adaptiveAuthoredCount(state,input.sourceStream),authoredBefore,"Refreshing a derived index must not author or remove source decisions");
    for(let repeat=0;repeat<2;repeat++){const retained=await retrieveAdaptiveConsent(state,quote,input.body,input.headers);assert.equal(retained.status,200,JSON.stringify(await retained.clone().json()));assert.deepEqual((await retained.json()).structure,adaptiveFixtureStructure);}
    assert.equal(calls,1);assert.deepEqual(consequentialReceipt(state,quote.executionId),receipt);
    const {governedPackageSourceRightsValidity,sourceRightsDispatchGuard}=await import("../worker/context-package-rights.ts"),{synchronizeProjectScope}=await import("../worker/project-access.ts");
    let refreshes=0;const refresh=source=>{refreshes++;return synchronizeProjectScope(state.env,source);},blocks=[{properties:{organization_context_package_id:input.packageId,organization_context_package_version_id:input.versionId}}],eventCount=state.sqlite.prepare("SELECT COUNT(*) AS n FROM events").get().n;
    assert.equal((await governedPackageSourceRightsValidity(state.env,state.organizationId,blocks,refresh)).current,true);
    refreshes=0;const stable=await governedPackageSourceRightsValidity(state.env,state.organizationId,blocks,refresh),guard=sourceRightsDispatchGuard(stable);
    assert.equal(stable.current,true);assert.equal(refreshes,0,"An already-current source is a read-only no-op, not another derived-index rebuild");
    assert.ok(state.sqlite.prepare("SELECT 1 AS current WHERE "+guard.sql).get(...guard.bindings));
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM events").get().n,eventCount,"Rights/index refreshes never append authored or job events");
    assert.deepEqual(consequentialReceipt(state,quote.executionId),receipt);assert.equal(calls,1);
  }finally{restore?.();await state?.drainBackground();globalThis.fetch=originalFetch;}
});



// Separate immutable deployment configurations share the same real-worker fixture DB.
// No test mutates an approved binding, private receipt, or authored source history.
function adaptivePreissuedModelPort(state, model) {
  const env = { ...state.env, OPENAI_MODEL: model };
  const context = { waitUntil(promise) { state.background.push(promise); } };
  return (body) => worker.fetch(new Request("http://localhost/api/document-jobs/adaptive", json(body)), env, context);
}
async function adaptivePreissuedQuote(port, request = adaptiveConsentBody, extra = {}) {
  const response = await port({ ...request, ...extra, action: "quote" }), body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.ok(body.quote?.executionId); assert.equal(body.quote.status, "quoted");
  return body.quote;
}
function adaptivePreissuedExecute(port, quote, request = adaptiveConsentBody) {
  // Match native approval: exact saved identity, with no caller-supplied replacement override.
  return port({ ...request, action: "execute", executionId: quote.executionId, approvedBindingHash: quote.bindingHash });
}
function adaptivePreissuedAccounting(state, id) {
  const { balances: _aggregate, ...receipt } = consequentialReceipt(state, id);
  return receipt;
}
function assertAdaptivePreissuedUnused(state, quote) {
  assert.equal(adaptiveJob(state, quote.executionId), undefined, "A blocked pre-issued quote must not create a second job");
  const receipt = consequentialReceipt(state, quote.executionId);
  assert.equal(receipt.execution.status, "quoted");
  assert.equal(receipt.steps[0].status, "quoted");
  assert.equal(receipt.tokens.length, 0); assert.equal(receipt.cost.length, 0);
}
async function assertAdaptivePreissuedBlocked(response, winnerId) {
  const body = await response.json();
  assert.equal(response.status, 409, JSON.stringify(body));
  if (body.job) assert.equal(body.job.jobId, winnerId, "A recovery response may expose only the existing request");
}

test("adaptive pre-issued approval: a different-model quote cannot replace the same request key after an unknown POST", { timeout: 15_000 }, async () => {
  const state = await fixture({ provider: true }), originalFetch = globalThis.fetch, calls = [];
  const terra = adaptivePreissuedModelPort(state, "gpt-5.6-terra"), luna = adaptivePreissuedModelPort(state, "gpt-5.6-luna");
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), "https://api.openai.com/v1/responses"); assert.equal(init.method, "POST");
      const payload = JSON.parse(init.body); calls.push(payload.model);
      if (payload.model === "gpt-5.6-terra") throw new Error("Fixture lost original provider response after POST");
      return adaptiveFixtureResponse(payload);
    };
    const first = await adaptivePreissuedQuote(terra), preissued = await adaptivePreissuedQuote(luna);
    assert.notEqual(first.executionId, preissued.executionId); assert.notEqual(first.bindingHash, preissued.bindingHash);
    assert.equal(first.privateInput.requestKey, preissued.privateInput.requestKey);
    assert.equal((await adaptivePreissuedExecute(terra, first)).status, 202); await state.drainBackground();
    const original = consequentialReceipt(state, first.executionId), authored = adaptiveAuthoredCount(state);
    assert.equal(original.execution.status, "uncertain"); assert.equal(original.steps[0].status, "uncertain");
    assert.equal(original.cost[0].status, "executing"); assert.ok(original.balances.cost.reserved > 0);
    const freshResponse = await luna({ ...adaptiveConsentBody, action: "quote" }), fresh = await freshResponse.json();
    assert.equal(freshResponse.status, 200); assert.equal(fresh.quote.executionId, first.executionId);
    assert.equal(fresh.quote.status, "uncertain"); assert.equal(fresh.quote.canExecute, false);
    const blocked = await adaptivePreissuedExecute(luna, preissued); await state.drainBackground();
    assert.deepEqual(calls, ["gpt-5.6-terra"], "An earlier free review is not permission to replace an unknown original request");
    await assertAdaptivePreissuedBlocked(blocked, first.executionId); assertAdaptivePreissuedUnused(state, preissued);
    assert.deepEqual(consequentialReceipt(state, first.executionId), original);
    assert.deepEqual(adaptiveLedgerCounts(state), { token: 1, cost: 1 }); assert.equal(adaptiveAuthoredCount(state), authored);
  } finally { await state.drainBackground(); globalThis.fetch = originalFetch; }
});

test("adaptive pre-issued approval: a different-model claimant loses atomically when the same-key winner becomes unknown at its claim boundary", { timeout: 15_000 }, async () => {
  const state = await fixture({ provider: true }), originalFetch = globalThis.fetch, calls = [];
  const terra = adaptivePreissuedModelPort(state, "gpt-5.6-terra"), luna = adaptivePreissuedModelPort(state, "gpt-5.6-luna");
  let restore, seams = 0, original;
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), "https://api.openai.com/v1/responses"); assert.equal(init.method, "POST");
      const payload = JSON.parse(init.body); calls.push(payload.model);
      if (payload.model === "gpt-5.6-terra") throw new Error("Fixture winner response lost after POST");
      return adaptiveFixtureResponse(payload);
    };
    const winner = await adaptivePreissuedQuote(terra), loser = await adaptivePreissuedQuote(luna);
    assert.equal(winner.privateInput.requestKey, loser.privateInput.requestKey);
    restore = interceptConsequentialDb(state, "batch", /^\s*UPDATE consequential_executions SET status='reserved'/u, async (statements) => {
      seams++; assert.ok(statements.some((statement) => statement.values.includes(loser.executionId)));
      assert.equal((await adaptivePreissuedExecute(terra, winner)).status, 202); await state.drainBackground();
      original = consequentialReceipt(state, winner.executionId);
      assert.equal(original.execution.status, "uncertain"); assert.equal(original.cost[0].status, "executing");
    });
    const blocked = await adaptivePreissuedExecute(luna, loser); restore(); restore = null;
    await state.drainBackground(); assert.equal(seams, 1, "The actual SQL claim seam must run");
    assert.deepEqual(calls, ["gpt-5.6-terra"], "A pre-claim JS check is insufficient after another request wins");
    await assertAdaptivePreissuedBlocked(blocked, winner.executionId); assertAdaptivePreissuedUnused(state, loser);
    assert.deepEqual(consequentialReceipt(state, winner.executionId), original);
    assert.deepEqual(adaptiveLedgerCounts(state), { token: 1, cost: 1 });
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM document_jobs").get().n, 1);
  } finally { restore?.(); await state.drainBackground(); globalThis.fetch = originalFetch; }
});

test("adaptive replacement approval: the retained contract binds its exact completed settled predecessor and valid changed work still runs once", { timeout: 15_000 }, async () => {
  const state = await fixture({ provider: true }), originalFetch = globalThis.fetch, calls = [];
  const port = adaptivePreissuedModelPort(state, "gpt-5.6-terra");
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), "https://api.openai.com/v1/responses"); assert.equal(init.method, "POST");
      calls.push(JSON.parse(init.body)); return adaptiveFixtureResponse(calls.at(-1));
    };
    const first = await adaptivePreissuedQuote(port);
    assert.equal((await adaptivePreissuedExecute(port, first)).status, 202); await state.drainBackground();
    const original = adaptivePreissuedAccounting(state, first.executionId);
    assert.equal(original.execution.status, "completed"); assert.equal(original.steps[0].status, "settled");
    editAdaptiveReentrySource(state);
    const incorrect = await port({ ...adaptiveConsentBody, action: "quote", replaceExecutionId: "not-the-approved-predecessor" }), incorrectBody = await incorrect.json();
    if (incorrect.ok) assert.equal(incorrectBody.quote.executionId, first.executionId);
    else assert.equal(incorrect.status, 409);
    assert.deepEqual(adaptiveLedgerCounts(state), { token: 1, cost: 1 });
    const replacement = await adaptivePreissuedQuote(port, adaptiveConsentBody, { replaceExecutionId: first.executionId });
    assert.notEqual(replacement.executionId, first.executionId); assert.notEqual(replacement.sourceHash, first.sourceHash);
    assert.equal(replacement.privateInput.requestKey, first.privateInput.requestKey);
    const retained = state.sqlite.prepare("SELECT content.content FROM consequential_executions execution JOIN private_content content ON content.content_id=execution.consent_ref WHERE execution.execution_id=?").get(replacement.executionId);
    const binding = JSON.parse(retained.content).binding;
    assert.equal(binding.request.replaceExecutionId, first.executionId, "Replacement authority must be inside the hash-bound retained request, not only the quote HTTP body");
    assert.equal(await consequential.consentHash(binding), replacement.bindingHash);
    assert.deepEqual(adaptiveLedgerCounts(state), { token: 1, cost: 1 }, "Review alone is free");
    assert.equal((await adaptivePreissuedExecute(port, replacement)).status, 202); await state.drainBackground();
    assert.equal(adaptiveJob(state, replacement.executionId).status, "completed");
    assert.equal(consequentialReceipt(state, replacement.executionId).steps[0].status, "settled");
    assert.deepEqual(adaptivePreissuedAccounting(state, first.executionId), original);
    assert.equal(calls.length, 2); assert.deepEqual(adaptiveLedgerCounts(state), { token: 2, cost: 2 });
  } finally { await state.drainBackground(); globalThis.fetch = originalFetch; }
});

test("adaptive replacement approval: an older replacement cannot pass a newer same-key uncertain request", { timeout: 15_000 }, async () => {
  const state = await fixture({ provider: true }), originalFetch = globalThis.fetch, calls = [];
  const terra = adaptivePreissuedModelPort(state, "gpt-5.6-terra"), luna = adaptivePreissuedModelPort(state, "gpt-5.6-luna");
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), "https://api.openai.com/v1/responses"); assert.equal(init.method, "POST");
      const payload = JSON.parse(init.body); calls.push(payload.model);
      if (calls.length === 2) throw new Error("Fixture newer replacement response lost after POST");
      return adaptiveFixtureResponse(payload);
    };
    const first = await adaptivePreissuedQuote(terra);
    assert.equal((await adaptivePreissuedExecute(terra, first)).status, 202); await state.drainBackground();
    const settledOriginal = adaptivePreissuedAccounting(state, first.executionId);
    editAdaptiveReentrySource(state);
    const newer = await adaptivePreissuedQuote(terra, adaptiveConsentBody, { replaceExecutionId: first.executionId });
    const stale = await adaptivePreissuedQuote(luna, adaptiveConsentBody, { replaceExecutionId: first.executionId });
    assert.equal(newer.privateInput.requestKey, stale.privateInput.requestKey); assert.notEqual(newer.bindingHash, stale.bindingHash);
    assert.equal((await adaptivePreissuedExecute(terra, newer)).status, 202); await state.drainBackground();
    const uncertain = consequentialReceipt(state, newer.executionId);
    assert.equal(uncertain.execution.status, "uncertain"); assert.equal(uncertain.cost[0].status, "executing");
    const blocked = await adaptivePreissuedExecute(luna, stale); await state.drainBackground();
    assert.deepEqual(calls, ["gpt-5.6-terra", "gpt-5.6-terra"], "A settled older predecessor cannot authorize replacement of newer unknown work");
    await assertAdaptivePreissuedBlocked(blocked, newer.executionId); assertAdaptivePreissuedUnused(state, stale);
    assert.deepEqual(consequentialReceipt(state, newer.executionId), uncertain);
    assert.deepEqual(adaptivePreissuedAccounting(state, first.executionId), settledOriginal);
    assert.deepEqual(adaptiveLedgerCounts(state), { token: 2, cost: 2 });
  } finally { await state.drainBackground(); globalThis.fetch = originalFetch; }
});

test("adaptive pre-issued approval: a genuinely different intent remains authorized while the original request is uncertain", { timeout: 15_000 }, async () => {
  const state = await fixture({ provider: true }), originalFetch = globalThis.fetch, calls = [];
  const port = adaptivePreissuedModelPort(state, "gpt-5.6-terra"), different = { ...adaptiveConsentBody, prompt: "Plan a separate product-launch checklist, keeping the original creative request untouched." };
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), "https://api.openai.com/v1/responses"); assert.equal(init.method, "POST");
      const payload = JSON.parse(init.body); calls.push(payload);
      if (calls.length === 1) throw new Error("Fixture original response lost after POST");
      return adaptiveFixtureResponse(payload);
    };
    const first = await adaptivePreissuedQuote(port);
    assert.equal((await adaptivePreissuedExecute(port, first)).status, 202); await state.drainBackground();
    const original = adaptivePreissuedAccounting(state, first.executionId);
    assert.equal(original.execution.status, "uncertain"); assert.equal(original.cost[0].status, "executing");
    const next = await adaptivePreissuedQuote(port, different);
    assert.notEqual(next.privateInput.requestKey, first.privateInput.requestKey);
    assert.equal((await adaptivePreissuedExecute(port, next, different)).status, 202); await state.drainBackground();
    assert.equal(adaptiveJob(state, next.executionId).status, "completed");
    assert.equal(consequentialReceipt(state, next.executionId).steps[0].status, "settled");
    assert.deepEqual(adaptivePreissuedAccounting(state, first.executionId), original);
    assert.equal(calls.length, 2); assert.deepEqual(adaptiveLedgerCounts(state), { token: 2, cost: 2 });
    const settled = consequentialReceipt(state, next.executionId);
    assert.equal(settled.balances.cost.reserved, original.cost[0].reserved_microusd);
    assert.equal(settled.balances.tokens.reserved, original.tokens[0].reserved_tokens);
  } finally { await state.drainBackground(); globalThis.fetch = originalFetch; }
});


for (const shared of [false, true]) {
  test("adaptive replacement lineage: three completed generations preserve every predecessor receipt (" + (shared ? "shared" : "personal") + ")", { timeout: 15_000 }, async () => {
    const state = shared ? await sharedProjectFixture({ provider: true }) : await fixture({ provider: true });
    const originalFetch = globalThis.fetch, headers = shared ? state.owner : {};
    const owner = shared ? "assistant-owner" : "dev-local-creative", stream = "creative:" + owner;
    const calls = [], quotes = [], originals = new Map();
    const evidence = (id) => ({
      execution: state.sqlite.prepare("SELECT * FROM consequential_executions WHERE execution_id=?").get(id),
      steps: state.sqlite.prepare("SELECT * FROM consequential_execution_steps WHERE execution_id=? ORDER BY step_index").all(id),
      tokens: state.sqlite.prepare("SELECT * FROM budget_reservations WHERE owner_id=? AND correlation_id=? ORDER BY reservation_id").all(owner, id),
      cost: state.sqlite.prepare("SELECT * FROM cost_budget_reservations WHERE owner_id=? AND correlation_id=? ORDER BY reservation_id").all(owner, id),
      job: state.sqlite.prepare("SELECT * FROM document_jobs WHERE job_id=?").get(id),
      content: state.sqlite.prepare("SELECT * FROM private_content WHERE content_id IN(SELECT consent_ref FROM consequential_executions WHERE execution_id=? UNION SELECT result_ref FROM consequential_executions WHERE execution_id=? UNION SELECT json_extract(result_json,'$.adaptiveProviderReceipt.contentRef') FROM document_jobs WHERE job_id=?) ORDER BY content_id").all(id, id, id),
    });
    try {
      globalThis.fetch = async (url, init) => {
        assert.equal(String(url), "https://api.openai.com/v1/responses"); assert.equal(init.method, "POST");
        const payload = JSON.parse(init.body); calls.push({ executionId: init.headers["X-Client-Request-Id"], payload });
        const body = await adaptiveFixtureResponse(payload).json();
        return Response.json({ ...body, id: "adaptive-replacement-chain-response-" + calls.length });
      };
      for (let generation = 0; generation < 3; generation++) {
        const previous = quotes.at(-1);
        if (previous) appendFixtureEvents(state.sqlite, stream, [["BlockPropertyEdited", {
          project_id: adaptiveConsentBody.projectId, document_id: adaptiveConsentBody.documentId,
          block_id: "block-direction", property_path: "text",
          new_value: "Explicitly revised creative direction for approved replacement generation " + generation + ".",
        }]]);
        const authored = adaptiveAuthoredCount(state, stream);
        const response = await state.request(adaptiveConsentPath, json({
          ...adaptiveConsentBody, action: "quote", ...(previous ? { replaceExecutionId: previous.executionId } : {}),
        }, headers)), body = await response.json();
        assert.equal(response.status, 200, JSON.stringify(body));
        const quote = body.quote; assert.ok(quote?.executionId); assert.equal(quote.status, "quoted");
        assert.equal(calls.length, generation, "Preparing a replacement never contacts the provider");
        if (previous) {
          assert.notEqual(quote.executionId, previous.executionId); assert.notEqual(quote.sourceHash, previous.sourceHash);
          assert.equal(quote.privateInput.requestKey, quotes[0].privateInput.requestKey);
        }
        const consent = state.sqlite.prepare("SELECT content.content FROM consequential_executions execution JOIN private_content content ON content.content_id=execution.consent_ref WHERE execution.execution_id=?").get(quote.executionId);
        const binding = JSON.parse(consent.content).binding;
        assert.equal(binding.request.replaceExecutionId ?? null, previous?.executionId ?? null);
        assert.equal(await consequential.consentHash(binding), quote.bindingHash);
        const admitted = await executeAdaptiveConsent(state, quote, adaptiveConsentBody, headers);
        assert.equal(admitted.status, 202, JSON.stringify(await admitted.clone().json())); await state.drainBackground();
        const current = evidence(quote.executionId);
        assert.equal(current.job.status, "completed", current.job.error_message);
        assert.equal(current.execution.status, "completed"); assert.ok(current.execution.result_ref);
        assert.equal(current.steps.length, 1); assert.equal(current.steps[0].status, "settled");
        assert.equal(current.tokens[0].status, "settled"); assert.equal(current.tokens[0].used_tokens, 1300);
        assert.equal(current.cost[0].status, "settled"); assert.equal(current.cost[0].used_microusd, 5600);
        assert.equal(current.job.correlation_id, quote.executionId); assert.equal(current.job.attempt_count, 1);
        assert.equal(JSON.parse(current.job.request_json).replacesExecutionId ?? null, previous?.executionId ?? null);
        assert.equal(calls.length, generation + 1); assert.equal(calls.at(-1).executionId, quote.executionId);
        assert.deepEqual(calls.at(-1).payload, quote.privateInput.providerRequest);
        assert.equal(adaptiveAuthoredCount(state, stream), authored, "Approved planning never applies source decisions");
        if (shared) {
          const resource = state.sqlite.prepare("SELECT * FROM project_resource_scopes WHERE resource_kind='job' AND resource_id=?").get(quote.executionId);
          assert.equal(resource.actor_user_id, owner); assert.equal(resource.owner_user_id, owner);
          assert.equal(resource.project_access_id, state.projectAccessId); assert.equal(resource.organization_id, state.organizationId);
          assert.ok(resource.source_event_id);
          assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='ProjectDocumentJobQueued' AND json_extract(payload,'$.job_id')=?").get(quote.executionId).n, 1);
        }
        for (const [id, original] of originals) assert.deepEqual(evidence(id), original, "A later replacement must not rewrite its ancestor's receipt or accounting");
        quotes.push(quote); originals.set(quote.executionId, current);
      }
      assert.equal(new Set(quotes.map(quote => quote.executionId)).size, 3);
      assert.deepEqual(adaptiveLedgerCounts(state), { token: 3, cost: 3 });
      assert.deepEqual(consequentialBalances(state, owner), { tokens: { used: 3900, reserved: 0 }, cost: { used: 16800, reserved: 0 } });
      for (const quote of quotes) {
        const retrieved = await retrieveAdaptiveConsent(state, quote, adaptiveConsentBody, headers), body = await retrieved.json();
        assert.equal(retrieved.status, 200, JSON.stringify(body)); assert.equal(body.executionId, quote.executionId);
        assert.equal(body.bindingHash, quote.bindingHash); assert.equal(body.sourceHash, quote.sourceHash);
        assert.deepEqual(body.structure, adaptiveFixtureStructure);
        assert.deepEqual(evidence(quote.executionId), originals.get(quote.executionId));
      }
      assert.equal(calls.length, 3, "Retrieving any ancestor never purchases a fourth plan");
    } finally { await state.drainBackground(); globalThis.fetch = originalFetch; }
  });
}

test("adaptive consent API: a complete quote works without a provider and creates no job or hold",async()=>{
  const state=await fixture(),original=globalThis.fetch;let calls=0;
  try{globalThis.fetch=async()=>{calls++;throw new Error("free quote must not contact provider");};const before=adaptiveAuthoredCount(state),quote=await quoteAdaptiveConsent(state),same=await quoteAdaptiveConsent(state);
    assert.equal(same.executionId,quote.executionId);assert.equal(quote.providerAvailable,false);assert.equal(quote.providerCalls,1);assert.equal(quote.searchCalls,0);assert.ok(quote.maximumMicrousd>0);assert.equal(quote.blockId,"");assert.equal(quote.canvasId,null);assert.equal(quote.privateInput.scope,"document");assert.ok(quote.privateInput.providerRequest.input);assert.equal(quote.privateInput.providerRequest.truncation,"disabled");assert.equal(quote.privateInput.providerRequest.store,false);assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM document_jobs").get().n,0);assert.deepEqual(adaptiveLedgerCounts(state),{token:0,cost:0});
    const missing=await executeAdaptiveConsent(state,quote);assert.equal(missing.status,503);assert.equal((await missing.json()).submission,"not-submitted");const read=await retrieveAdaptiveConsent(state,quote);assert.equal(read.status,409);assert.equal((await read.json()).submission,"not-submitted");assert.equal(adaptiveAuthoredCount(state),before);assert.equal(calls,0);assert.deepEqual(adaptiveLedgerCounts(state),{token:0,cost:0});
  }finally{globalThis.fetch=original;}
});
test("adaptive consent API: legacy and missing-approval entry points cannot reserve or dispatch",async()=>{
  const state=await fixture({provider:true}),original=globalThis.fetch;let calls=0;
  try{globalThis.fetch=async()=>{calls++;throw new Error("unsigned planner request");};for(const body of[{...adaptiveConsentBody},{...adaptiveConsentBody,action:"execute"},{...adaptiveConsentBody,action:"retrieve"}]){const result=await state.request(adaptiveConsentPath,json(body));assert.equal(result.status,428,JSON.stringify(await result.clone().json()));}
    for(const[path,body]of[["/api/events",{...adaptiveConsentBody,action:"structure_adaptive"}],["/api/document-jobs",{kind:"structure_adaptive",documentId:"doc-atmosphere",sourceSurface:"studio",payload:{prompt:adaptiveConsentBody.prompt,projectScope:false,locale:"en"}}]]){const result=await state.request(path,json(body));assert.equal(result.status,428,JSON.stringify(await result.clone().json()));}
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM document_jobs").get().n,0);assert.deepEqual(adaptiveLedgerCounts(state),{token:0,cost:0});assert.equal(calls,0);
  }finally{globalThis.fetch=original;}
});
test("adaptive consent API: concurrent clicks and a lost response reuse the exact job, contract, and POST",{timeout:15_000},async()=>{
  const state=await adaptiveCanvasFixture(),original=globalThis.fetch,entered=Promise.withResolvers(),released=Promise.withResolvers();let calls=0;
  try{const before=adaptiveAuthoredCount(state),quote=await quoteAdaptiveConsent(state,state.body);
    globalThis.fetch=async(url,init)=>{calls++;assert.equal(url,"https://api.openai.com/v1/responses");assert.equal(init.method,"POST");assert.equal(init.headers["X-Client-Request-Id"],quote.executionId);assert.equal(init.body,JSON.stringify(quote.privateInput.providerRequest));entered.resolve();await released.promise;return adaptiveFixtureResponse(JSON.parse(init.body));};
    const first=await executeAdaptiveConsent(state,quote,state.body);assert.equal(first.status,202,JSON.stringify(await first.clone().json()));assert.equal((await first.json()).job.jobId,quote.executionId);await entered.promise;
    const second=await executeAdaptiveConsent(state,quote,state.body);assert.equal(second.status,202);assert.equal((await second.json()).executionId,quote.executionId);const pending=await retrieveAdaptiveConsent(state,quote,state.body);assert.equal(pending.status,202);assert.equal((await pending.json()).job.jobId,quote.executionId);
    const row=adaptiveJob(state,quote.executionId),payload=JSON.parse(row.request_json);assert.equal(row.correlation_id,quote.executionId);assert.equal(row.source_surface,"canvas");assert.equal(payload.adaptiveConsentVersion,1);assert.equal(payload.executionId,quote.executionId);assert.equal(payload.bindingHash,quote.bindingHash);assert.equal(payload.canvasId,state.body.canvasId);assert.equal(payload.requestKey,quote.privateInput.requestKey);assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM document_jobs").get().n,1);
    released.resolve();await state.drainBackground();const recovered=await retrieveAdaptiveConsent(state,quote,state.body);assert.equal(recovered.status,200,JSON.stringify(await recovered.clone().json()));const result=await recovered.json();assert.deepEqual(result.structure,adaptiveFixtureStructure);assert.equal(result.executionId,quote.executionId);assert.equal(result.bindingHash,quote.bindingHash);assert.equal(result.sourceHash,quote.sourceHash);assert.equal(result.executionReceipt.actualProviderCallCount,1);assert.equal(adaptiveJob(state,quote.executionId).correlation_id,quote.executionId);assert.equal(adaptiveJob(state,quote.executionId).status,"completed");
    const receipt=consequentialReceipt(state,quote.executionId);assert.equal(receipt.tokens[0].reservation_id,quote.executionId+":tokens:0");assert.equal(receipt.cost[0].reservation_id,quote.executionId+":usd:0");assert.deepEqual(receipt.balances,{tokens:{used:1300,reserved:0},cost:{used:5600,reserved:0}});assert.equal((await executeAdaptiveConsent(state,quote,state.body)).status,200);assert.equal((await quoteAdaptiveConsent(state,state.body)).executionId,quote.executionId);assert.equal(adaptiveAuthoredCount(state),before);assert.equal(calls,1);assert.deepEqual(adaptiveLedgerCounts(state),{token:1,cost:1});
  }finally{released.resolve();await state.drainBackground();globalThis.fetch=original;}
});
test("adaptive consent API: a committed admission with a lost response can be run without a new execution",{timeout:15_000},async()=>{
  const state=await fixture({provider:true}),original=globalThis.fetch,entered=Promise.withResolvers(),released=Promise.withResolvers();let calls=0,mutations=0,restore;
  try{globalThis.fetch=async(_url,init)=>{calls++;entered.resolve();await released.promise;return adaptiveFixtureResponse(JSON.parse(init.body));};const quote=await quoteAdaptiveConsent(state);restore=interceptConsequentialDb(state,"batch",/^\s*UPDATE consequential_executions SET status='reserved'/u,()=>{mutations++;throw new Error("injected_lost_adaptive_admission_response");},"after");
    await executeAdaptiveConsent(state,quote);restore();restore=null;assert.equal(mutations,1);assert.equal(adaptiveJob(state,quote.executionId).job_id,quote.executionId);assert.equal(adaptiveJob(state,quote.executionId).correlation_id,quote.executionId);assert.equal(state.sqlite.prepare("SELECT status FROM consequential_executions WHERE execution_id=?").get(quote.executionId).status,"reserved");
    const read=await retrieveAdaptiveConsent(state,quote);assert.equal(read.status,202);assert.equal((await read.json()).job.jobId,quote.executionId);const run=await state.request("/api/document-jobs/"+quote.executionId+"/run",json({}));assert.ok(run.status===200||run.status===202);await entered.promise;released.resolve();await state.drainBackground();const completed=await retrieveAdaptiveConsent(state,quote);assert.equal(completed.status,200,JSON.stringify(await completed.clone().json()));assert.deepEqual((await completed.json()).structure,adaptiveFixtureStructure);assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM consequential_executions").get().n,1);assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM document_jobs").get().n,1);assert.deepEqual(adaptiveLedgerCounts(state),{token:1,cost:1});assert.equal(calls,1);
  }finally{restore?.();released.resolve();await state.drainBackground();globalThis.fetch=original;}
});
async function adaptiveSourceCountFixture({provider=false}={}){
  const state=await fixture({provider}),projectId="adaptive-source-project",documentId="adaptive-source-document",canvasId="adaptive-source-canvas";
  const sources=[{id:"source-document",scope:"document",type:"direction",text:"Document: preserve “Mara” exactly.\n61.125 is not 61.13."},{id:"source-library",scope:"library",type:"subject",text:"Library: reuse the original blue ceramic bowl."},{id:"source-canvas",scope:"canvas",type:"exclusion",text:"Canvas: never crop the handwritten signature."}];
  appendFixtureEvents(state.sqlite,"creative:dev-local-creative",[["ProjectCreated",{project_id:projectId,name:"Exact source-count project"}],["DocumentCreated",{document_id:documentId,project_id:projectId,title:"Original document"}],["CanvasCreated",{canvas_id:canvasId,project_id:projectId,name:"Original board",slug:"original-board"}],...sources.flatMap((source)=>[["BlockCreated",{block_id:source.id,project_id:projectId,scope:source.scope,...(source.scope==="document"?{document_id:documentId}:source.scope==="canvas"?{canvas_id:canvasId}:{}),type:source.type,handle:source.id,position:source.id,properties:{text:source.text,weight:1,intent:source.scope==="canvas"?"prohibit":"include"}}],["BlockLocked",{block_id:source.id,project_id:projectId}]])]);
  return{...state,sources,body:{...adaptiveConsentBody,projectId,documentId,canvasId,sourceSurface:"canvas",projectScope:true}};
}
for(const provider of[false,true])test("adaptive consent API: source counts distinguish one document, Library, and Canvas; provider="+provider,{timeout:15_000},async()=>{
  const state=await adaptiveSourceCountFixture({provider}),original=globalThis.fetch;let calls=0;
  try{
    globalThis.fetch=async()=>{calls++;throw new Error("source-count preview must be free");};
    const before=adaptiveAuthoredCount(state),quote=await quoteAdaptiveConsent(state,state.body),input=JSON.parse(quote.privateInput.providerRequest.input);
    assert.equal(quote.privateInput.scope,"whole-project");assert.equal(quote.privateInput.documentCount,1);assert.equal(quote.privateInput.blockCount,3);assert.equal(quote.privateInput.libraryBlockCount,1);assert.equal(quote.privateInput.canvasBlockCount,1);assert.equal(quote.privateInput.protectedBlockCount,3);assert.equal(quote.providerAvailable,provider);
    assert.equal(input.blocks.length,3);for(const source of state.sources){const block=input.blocks.find((item)=>item.id===source.id);assert.ok(block,source.id);assert.equal(block.properties.text,source.text);assert.equal(block.scope,source.scope);assert.equal(block.locked,true);}
    assert.equal(input.blocks.find((block)=>block.id==="source-canvas").intent,"prohibit");assert.equal(calls,0);assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM document_jobs").get().n,0);assert.deepEqual(adaptiveLedgerCounts(state),{token:0,cost:0});assert.equal(adaptiveAuthoredCount(state),before);
    if(provider){
      globalThis.fetch=async(url,init)=>{calls++;assert.equal(url,"https://api.openai.com/v1/responses");assert.equal(init.method,"POST");assert.equal(init.body,JSON.stringify(quote.privateInput.providerRequest));const sent=JSON.parse(init.body);assert.deepEqual(JSON.parse(sent.input).blocks,input.blocks);return adaptiveFixtureResponse(sent);};
      const admitted=await executeAdaptiveConsent(state,quote,state.body);assert.equal(admitted.status,202,JSON.stringify(await admitted.clone().json()));await state.drainBackground();assert.equal((await retrieveAdaptiveConsent(state,quote,state.body)).status,200);assert.equal(calls,1);assert.equal(adaptiveAuthoredCount(state),before);
    }
  }finally{await state.drainBackground();globalThis.fetch=original;}
});
test("adaptive consent API: Library and Canvas inputs alone do not invent a source document",async()=>{
  const state=await adaptiveSourceCountFixture(),original=globalThis.fetch;let calls=0;
  appendFixtureEvents(state.sqlite,"creative:dev-local-creative",[["BlockRehomed",{block_id:"source-document",project_id:state.body.projectId,scope:"library"}]]);
  try{globalThis.fetch=async()=>{calls++;throw new Error("source-count preview must be free");};const quote=await quoteAdaptiveConsent(state,state.body),input=JSON.parse(quote.privateInput.providerRequest.input);assert.equal(quote.privateInput.documentCount,0);assert.equal(quote.privateInput.blockCount,3);assert.equal(quote.privateInput.libraryBlockCount,2);assert.equal(quote.privateInput.canvasBlockCount,1);assert.equal(input.blocks.length,3);for(const source of state.sources)assert.equal(input.blocks.find((block)=>block.id===source.id).properties.text,source.text);assert.equal(calls,0);assert.deepEqual(adaptiveLedgerCounts(state),{token:0,cost:0});}finally{globalThis.fetch=original;}
});

test("adaptive consent API: whole-project quote and dispatch retain full protected instructions and locks",{timeout:15_000},async()=>{
  const state=await adaptiveCanvasFixture(),original=globalThis.fetch;let calls=0;const full="Protected contractual context ".repeat(30)+"CRITICAL TAIL MUST REMAIN VERBATIM",exact="Revenue  growth\nnever fabricate proof";
  appendFixtureEvents(state.sqlite,"creative:dev-local-creative",[["BlockCreated",{block_id:"adaptive-protected",project_id:"project-atmosphere",document_id:"doc-atmosphere",type:"direction",handle:"Protected direction",position:"z1",properties:{text:full,intent:"prohibit",weight:.8,exact_text:exact,exact_placements:["opening","closing"],protected_phrases:[{text:exact,placement:"opening_and_closing"}]}}],["BlockLocked",{block_id:"adaptive-protected",project_id:"project-atmosphere",document_id:"doc-atmosphere"}],["DocumentCreated",{document_id:"adaptive-second-document",project_id:"project-atmosphere",title:"Second authorized document",slug:"second-authorized-document"}],["BlockCreated",{block_id:"adaptive-second-fact",project_id:"project-atmosphere",document_id:"adaptive-second-document",type:"subject",handle:"Second-document subject",position:"z2",properties:{text:"An authorized fact from the other document."}}],["BlockCreated",{block_id:"adaptive-inactive",project_id:"project-atmosphere",document_id:"doc-atmosphere",type:"direction",handle:"Inactive",position:"z3",properties:{text:"INACTIVE_FACT_MUST_NOT_BE_SENT",active:false}}],["BlockCreated",{block_id:"adaptive-foreign",project_id:"foreign-project",document_id:"foreign-document",type:"direction",handle:"Foreign",position:"z4",properties:{text:"FOREIGN_PROJECT_MUST_NOT_BE_SENT"}}]]);
  try{const before=adaptiveAuthoredCount(state),body={...state.body,locale:"ja"},quote=await quoteAdaptiveConsent(state,body),input=JSON.parse(quote.privateInput.providerRequest.input),block=input.blocks.find((item)=>item.id==="adaptive-protected");assert.ok(block);assert.equal(block.properties.text,full);assert.equal(block.properties.exact_text,exact);assert.deepEqual(block.properties.exact_placements,["opening","closing"]);assert.deepEqual(block.properties.protected_phrases,[{text:exact,placement:"opening_and_closing"}]);assert.equal(block.locked,true);assert.equal(block.intent,"prohibit");assert.ok(input.blocks.some((item)=>item.id==="adaptive-second-fact"));assert.doesNotMatch(quote.privateInput.providerRequest.input,/INACTIVE_FACT_MUST_NOT_BE_SENT|FOREIGN_PROJECT_MUST_NOT_BE_SENT/u);assert.equal(quote.privateInput.scope,"whole-project");assert.equal(quote.privateInput.documentCount,2);assert.ok(quote.privateInput.protectedBlockCount>=1);assert.equal(quote.privateInput.inactiveBlockCount,1);assert.match(quote.privateInput.providerRequest.instructions,/\(ja\)/u);
    globalThis.fetch=async(_url,init)=>{calls++;assert.equal(init.body,JSON.stringify(quote.privateInput.providerRequest));return adaptiveFixtureResponse(JSON.parse(init.body));};const admitted=await executeAdaptiveConsent(state,quote,body);assert.equal(admitted.status,202,JSON.stringify(await admitted.clone().json()));await state.drainBackground();assert.equal((await retrieveAdaptiveConsent(state,quote,body)).status,200);assert.equal(adaptiveAuthoredCount(state),before);assert.equal(calls,1);
  }finally{await state.drainBackground();globalThis.fetch=original;}
});
for(const problem of["oversized","unlicensed"])test("adaptive consent API: "+problem+" active source is rejected rather than silently omitted",async()=>{
  const state=await fixture({provider:true}),original=globalThis.fetch;let calls=0;appendFixtureEvents(state.sqlite,"creative:dev-local-creative",[["BlockCreated",{block_id:"adaptive-invalid-source",project_id:"project-atmosphere",document_id:"doc-atmosphere",type:"direction",handle:"Required source",position:"z1",properties:problem==="oversized"?{text:"x".repeat(130_000),intent:"prohibit"}:{text:"Required but unlicensed source.",rights_class:"unlicensed"}}],["BlockLocked",{block_id:"adaptive-invalid-source",project_id:"project-atmosphere",document_id:"doc-atmosphere"}]]);
  try{globalThis.fetch=async()=>{calls++;throw new Error("source rejection must be free");};const result=await state.request(adaptiveConsentPath,json({...adaptiveConsentBody,action:"quote"}));assert.equal(result.status,problem==="oversized"?413:403,JSON.stringify(await result.clone().json()));assert.equal((await result.json()).error,problem==="oversized"?"adaptive_source_too_large":"adaptive_source_rights_unavailable");assert.deepEqual(adaptiveLedgerCounts(state),{token:0,cost:0});assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM document_jobs").get().n,0);assert.equal(calls,0);}finally{globalThis.fetch=original;}
});
for(const change of["source","board","permission"])test("adaptive consent API: changed "+change+" cannot consume an earlier quote",async()=>{
  const state=await adaptiveCanvasFixture(),original=globalThis.fetch;let calls=0;try{globalThis.fetch=async()=>{calls++;throw new Error("stale approval must not dispatch");};const quote=await quoteAdaptiveConsent(state,state.body);changeAdaptiveAuthority(state,change);const result=await executeAdaptiveConsent(state,quote,state.body);assert.equal(result.status,change==="permission"?403:409,JSON.stringify(await result.clone().json()));assert.deepEqual(adaptiveLedgerCounts(state),{token:0,cost:0});assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM document_jobs").get().n,0);assert.equal(calls,0);}finally{globalThis.fetch=original;}
});
for(const boundary of["claim","dispatch"])for(const change of["source","board","permission"])test("adaptive consent API: "+change+" changing at "+boundary+" fails closed at the SQL boundary",{timeout:15_000},async()=>{
  const state=await adaptiveCanvasFixture(),original=globalThis.fetch;let calls=0,mutations=0,restore;try{globalThis.fetch=async()=>{calls++;throw new Error("stale boundary must not dispatch");};const quote=await quoteAdaptiveConsent(state,state.body);restore=interceptConsequentialDb(state,boundary==="claim"?"batch":"run",boundary==="claim"?/^\s*UPDATE consequential_executions SET status='reserved'/u:/^\s*UPDATE consequential_execution_steps SET status='submitting'/u,()=>{mutations++;changeAdaptiveAuthority(state,change);});const result=await executeAdaptiveConsent(state,quote,state.body);if(boundary==="claim")assert.equal(result.ok,false);else assert.equal(result.status,202,JSON.stringify(await result.clone().json()));await state.drainBackground();assert.equal(mutations,1);assert.equal(calls,0);if(boundary==="claim"){assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM document_jobs").get().n,0);assert.deepEqual(adaptiveLedgerCounts(state),{token:0,cost:0});}else{const receipt=consequentialReceipt(state,quote.executionId);assert.equal(receipt.steps[0].status,"not-submitted");assert.deepEqual(receipt.balances,{tokens:{used:0,reserved:0},cost:{used:0,reserved:0}});assert.equal(adaptiveJob(state,quote.executionId).status,"failed");}}finally{restore?.();await state.drainBackground();globalThis.fetch=original;}
});
for(const mode of["non-ok-verified","malformed-output","missing-usage","malformed-http-json"])test("adaptive consent API: "+mode+" retains truthful billing and never retries a POST",{timeout:15_000},async()=>{
  const state=await fixture({provider:true}),original=globalThis.fetch;let calls=0;const verified=mode==="non-ok-verified"||mode==="malformed-output";
  try{globalThis.fetch=async(_url,init)=>{calls++;const payload=JSON.parse(init.body);if(mode==="malformed-http-json")return new Response("{",{status:200,headers:{"content-type":"application/json","x-request-id":"adaptive-unparseable-response"}});return adaptiveFixtureResponse(payload,{status:mode==="non-ok-verified"?503:200,usage:mode==="missing-usage"?null:undefined,outputText:mode==="malformed-output"?"{":undefined});};
    const quote=await quoteAdaptiveConsent(state),accepted=await executeAdaptiveConsent(state,quote);assert.equal(accepted.status,202,JSON.stringify(await accepted.clone().json()));await state.drainBackground();const receipt=consequentialReceipt(state,quote.executionId);assert.equal(receipt.execution.status,verified?"failed":"uncertain");assert.equal(receipt.steps[0].status,verified?"settled":"uncertain");assert.equal(receipt.execution.result_ref,null);assert.equal(receipt.tokens.length,1);assert.equal(receipt.cost.length,1);if(verified)assert.deepEqual(receipt.balances,{tokens:{used:1300,reserved:0},cost:{used:5600,reserved:0}});else{assert.equal(receipt.balances.tokens.used,0);assert.equal(receipt.balances.cost.used,0);assert.ok(receipt.balances.tokens.reserved>0);assert.ok(receipt.balances.cost.reserved>0);}
    const current=await retrieveAdaptiveConsent(state,quote);assert.equal(current.status,409);assert.equal((await current.json()).status,verified?"failed":"uncertain");assert.equal((await executeAdaptiveConsent(state,quote)).status,409);const auth=await requireUser(new Request("http://localhost/api/session"),state.env,"viewer",{account:"principal"});await reconcileFailedBudgetReservations(state.env,auth.user,Date.now()+40*86_400_000);assert.deepEqual(consequentialReceipt(state,quote.executionId),receipt);assert.deepEqual(adaptiveLedgerCounts(state),{token:1,cost:1});assert.equal(calls,1);
  }finally{await state.drainBackground();globalThis.fetch=original;}
});
for(const force of [false,true])for(const phase of ["not-reserved","released","retained"]){
  test(`adaptive stop budget: ${force?"force-stop":"stop"} reports ${phase} from exact ledgers`,{timeout:15_000},async()=>{
    const state=await fixture({provider:true}),original=globalThis.fetch,entered=Promise.withResolvers(),released=Promise.withResolvers();let calls=0,gate;
    try{
      if(force)state.sqlite.prepare("UPDATE users SET role='admin' WHERE user_id='dev-local-creative'").run();
      const quote=await quoteAdaptiveConsent(state),path="/api/document-jobs/"+quote.executionId+(force?"/force-fail":"/cancel");
      globalThis.fetch=async(url,init)=>{calls++;assert.equal(String(url),"https://api.openai.com/v1/responses");assert.equal(init.method,"POST");entered.resolve();await released.promise;return adaptiveFixtureResponse(JSON.parse(init.body));};
      if(phase!=="retained")gate=gateConsequentialDb(state,"run",phase==="not-reserved"?/^\s*UPDATE consequential_execution_steps SET status='reserved'/u:/^\s*UPDATE consequential_execution_steps SET status='submitting'/u);
      const admitted=await executeAdaptiveConsent(state,quote);assert.equal(admitted.status,202,JSON.stringify(await admitted.clone().json()));
      await(gate?.entered??entered.promise);const before=consequentialBalances(state);
      const stopped=await state.request(path,json({})),body=await stopped.json();assert.equal(stopped.status,200,JSON.stringify(body));
      assert.equal(body.job.status,force?"failed":"canceled");assert.deepEqual(body.budget,{reservationStatus:phase,billingStatus:phase==="retained"?"pending":"not-incurred"});
      if(phase==="retained"){
        assert.deepEqual(consequentialBalances(state),before);assert.match(body.job.progressMessage,/hold is retained/u);assert.doesNotMatch(body.job.progressMessage,/released|before provider submission/u);
      }else{
        assert.deepEqual(consequentialBalances(state),{tokens:{used:0,reserved:0},cost:{used:0,reserved:0}});
        assert.equal(consequentialReceipt(state,quote.executionId).steps[0].status,"not-submitted");
        assert.deepEqual(adaptiveLedgerCounts(state),phase==="released"?{token:1,cost:1}:{token:0,cost:0});
      }
      const repeated=await state.request(path,json({}));assert.equal(repeated.status,200);assert.deepEqual((await repeated.json()).budget,body.budget);
      assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='BudgetReleased'").get().n,0);
      gate?.release();released.resolve();await state.drainBackground();
      assert.equal(calls,phase==="retained"?1:0);
      if(phase==="retained"){
        const completed=await state.request(path,json({})),settled=await completed.json();assert.equal(completed.status,200,JSON.stringify(settled));
        assert.equal(settled.job.status,"completed");assert.equal(settled.stoppedCount,0);assert.deepEqual(settled.budget,{reservationStatus:"settled",billingStatus:"settled"});
        assert.deepEqual(consequentialBalances(state),{tokens:{used:1300,reserved:0},cost:{used:5600,reserved:0}});assert.equal(calls,1);
      }
    }finally{gate?.release();gate?.restore();released.resolve();await state.drainBackground();globalThis.fetch=original;}
  });
}


// R9 routed proof for the terminal winner shapes consumed by the actual-host
// regressions. All providers and data are in-memory fixtures. Capturing a valid
// A-to-B progress reply before a later stop models ordinary response delivery
// reordering; no approved private contract or canonical source is rewritten.
for(const force of[false,true])for(const phase of["released","retained","settled"]){
  test("adaptive terminal winner R9 routes: "+(force?"failed":"canceled")+" / "+phase+" follows an earlier valid reuse receipt",{timeout:15000},async()=>{
    const state=await fixture({provider:true}),oldFetch=globalThis.fetch,entered=Promise.withResolvers(),released=Promise.withResolvers();
    let gate,calls=0;
    try{
      if(force)state.sqlite.prepare("UPDATE users SET role='admin' WHERE user_id='dev-local-creative'").run();
      const winnerPort=adaptivePreissuedModelPort(state,"gpt-5.6-terra"),loserPort=adaptivePreissuedModelPort(state,"gpt-5.6-luna");
      globalThis.fetch=async(url,init)=>{
        calls++;assert.equal(String(url),"https://api.openai.com/v1/responses");assert.equal(init.method,"POST");
        entered.resolve();await released.promise;
        // Known usage with malformed output must settle without inventing a plan.
        return adaptiveFixtureResponse(JSON.parse(init.body),{outputText:"{"});
      };
      const winner=await adaptivePreissuedQuote(winnerPort),loser=await adaptivePreissuedQuote(loserPort);
      assert.notEqual(winner.executionId,loser.executionId);assert.equal(winner.privateInput.requestKey,loser.privateInput.requestKey);
      if(phase==="released")gate=gateConsequentialDb(state,"run",/^\s*UPDATE consequential_execution_steps SET status='submitting'/u);
      assert.equal((await adaptivePreissuedExecute(winnerPort,winner)).status,202);
      await(gate?.entered??entered.promise);
      const delayed=await adaptivePreissuedExecute(loserPort,loser),oldBody=await delayed.json();
      assert.equal(delayed.status,202);assert.equal(oldBody.requestedExecutionId,loser.executionId);assert.equal(oldBody.reusedExecutionId,winner.executionId);
      assert.equal(oldBody.job.jobId,winner.executionId);assert.equal(oldBody.job.status,"running");assert.equal(oldBody.quote.status,"reserved");
      assert.deepEqual(oldBody.quote.privateInput,winner.privateInput);assert.equal(oldBody.quote.maximumMicrousd,winner.maximumMicrousd);
      const stop=await state.request("/api/document-jobs/"+winner.executionId+(force?"/force-fail":"/cancel"),json({}));assert.equal(stop.status,200);
      if(phase==="settled"){released.resolve();await state.drainBackground();}
      const before=consequentialReceipt(state,winner.executionId);
      const page=await state.request("/api/document-jobs");assert.equal(page.status,200);
      const terminal=(await page.json()).jobs.find(job=>job.jobId===winner.executionId);assert.ok(terminal);
      assert.equal(terminal.status,force?"failed":"canceled");assert.equal(terminal.result.planningReviewAvailable,true);
      assert.deepEqual(terminal.result.planningStopBudget,{reservationStatus:phase,billingStatus:phase==="released"?"not-incurred":phase==="retained"?"pending":"settled"});
      assert.equal(terminal.result.structure,undefined);assert.equal(Object.hasOwn(terminal.result,"quote"),false);
      assert.deepEqual(consequentialReceipt(state,winner.executionId),before,"Reading terminal progress must not create a second charge");
      assertAdaptivePreissuedUnused(state,loser);assert.equal(calls,phase==="released"?0:1);
      assert.deepEqual(adaptiveLedgerCounts(state),{token:1,cost:1});
    }finally{gate?.release();gate?.restore();released.resolve();await state.drainBackground();globalThis.fetch=oldFetch;state.sqlite.close();}
  });
}

// R14 routed provenance for fresh 409 accounting adoption. The same terminal
// job legitimately moves held -> settled after its one mocked provider reply;
// no new plan, provider POST, reservation, or authored decision is created.
for(const force of[false,true])for(const action of["resume","retrieve"]){
  test("adaptive current billing receipt R14 routes: "+(force?"failed":"canceled")+" fresh "+action+" returns settled 409 proof",{timeout:15000},async()=>{
    const state=await fixture({provider:true}),oldFetch=globalThis.fetch,entered=Promise.withResolvers(),released=Promise.withResolvers();let calls=0;
    try{
      if(force)state.sqlite.prepare("UPDATE users SET role='admin' WHERE user_id='dev-local-creative'").run();
      globalThis.fetch=async(url,init)=>{
        calls++;assert.equal(String(url),"https://api.openai.com/v1/responses");assert.equal(init.method,"POST");
        entered.resolve();await released.promise;
        return adaptiveFixtureResponse(JSON.parse(init.body),{outputText:"{"});
      };
      const quote=await quoteAdaptiveConsent(state);
      assert.equal((await executeAdaptiveConsent(state,quote)).status,202);await entered.promise;
      const stop=await state.request("/api/document-jobs/"+quote.executionId+(force?"/force-fail":"/cancel"),json({}));
      assert.equal(stop.status,200);const held=await stop.json();
      assert.equal(held.job.status,force?"failed":"canceled");
      assert.deepEqual(held.job.result.planningStopBudget,{reservationStatus:"retained",billingStatus:"pending"});
      released.resolve();await state.drainBackground();
      const before=consequentialReceipt(state,quote.executionId),authored=adaptiveAuthoredCount(state);
      const response=await state.request("/api/document-jobs/adaptive",json({...adaptiveConsentBody,action,executionId:quote.executionId,
        ...(action==="retrieve"?{approvedBindingHash:quote.bindingHash}:{})}));
      const body=await response.json();assert.equal(response.status,409);
      assert.equal(body.error,"provider_returned_invalid_json");assert.equal(body.status,"failed");assert.equal(body.quote.status,"failed");
      assert.equal(body.executionId,quote.executionId);assert.equal(body.bindingHash,quote.bindingHash);
      assert.equal(body.requestKey,body.planningRequest.requestKey);assert.equal(body.planningRequest.prompt,adaptiveConsentBody.prompt);
      assert.deepEqual(body.quote.privateInput,quote.privateInput);
      assert.equal(body.job.jobId,quote.executionId);assert.equal(body.job.planningExecutionId,quote.executionId);
      assert.equal(body.job.status,force?"failed":"canceled");assert.equal(body.job.result.planningReviewAvailable,true);
      assert.deepEqual(body.job.result.planningStopBudget,{reservationStatus:"settled",billingStatus:"settled"});
      assert.equal(body.job.result.structure,undefined);assert.equal(body.billingStatus,"settled");assert.equal(body.noAutomaticRetry,true);
      assert.deepEqual(consequentialReceipt(state,quote.executionId),before);assert.equal(adaptiveAuthoredCount(state),authored);
      assert.equal(calls,1);assert.deepEqual(adaptiveLedgerCounts(state),{token:1,cost:1});
    }finally{released.resolve();await state.drainBackground();globalThis.fetch=oldFetch;state.sqlite.close();}
  });
}

for (const force of [false, true]) {
  test("adaptive late stop billing: " + (force ? "force-stop" : "cancel") + " exposes current settled ledgers without rewriting the retained stop receipt", { timeout: 15_000 }, async () => {
    const state = await fixture({ provider: true }), originalFetch = globalThis.fetch;
    const entered = Promise.withResolvers(), released = Promise.withResolvers(); let calls = 0;
    try {
      if (force) state.sqlite.prepare("UPDATE users SET role='admin' WHERE user_id='dev-local-creative'").run();
      const quote = await quoteAdaptiveConsent(state);
      globalThis.fetch = async (url, init) => {
        assert.equal(String(url), "https://api.openai.com/v1/responses"); assert.equal(init.method, "POST");
        calls++; entered.resolve(); await released.promise;
        return adaptiveFixtureResponse(JSON.parse(init.body), { outputText: "{" });
      };
      const accepted = await executeAdaptiveConsent(state, quote);
      assert.equal(accepted.status, 202, JSON.stringify(await accepted.clone().json())); await entered.promise;
      const path = "/api/document-jobs/" + quote.executionId, status = force ? "failed" : "canceled";
      const stopped = await state.request(path + (force ? "/force-fail" : "/cancel"), json({})), stop = await stopped.json();
      assert.equal(stopped.status, 200, JSON.stringify(stop)); assert.equal(stop.job.status, status);
      assert.deepEqual(stop.budget, { reservationStatus: "retained", billingStatus: "pending" });
      const stored = () => state.sqlite.prepare("SELECT status,result_json,error_message FROM document_jobs WHERE job_id=?").get(quote.executionId);
      const historical = JSON.parse(stored().result_json);
      assert.match(historical.errorDetail.message, /hold is retained/u);
      released.resolve(); await state.drainBackground();
      const settled = consequentialReceipt(state, quote.executionId), afterDelivery = stored(), raw = JSON.parse(afterDelivery.result_json);
      assert.equal(settled.execution.result_ref, null, "Malformed output must not become a saved plan");
      assert.equal(settled.steps[0].status, "settled");
      assert.equal(settled.tokens[0].status, "settled"); assert.equal(settled.cost[0].status, "settled");
      assert.deepEqual(settled.balances, { tokens: { used: 1300, reserved: 0 }, cost: { used: 5600, reserved: 0 } });
      assert.equal(afterDelivery.status, status); assert.deepEqual(raw.errorDetail, historical.errorDetail);
      assert.equal(raw.progressMessage, historical.progressMessage); assert.equal(raw.structure, undefined);
      assert.equal(Object.hasOwn(raw, "planningStopBudget"), false, "Live budget status is response-only, never a new stored receipt");
      const assertLive = (job) => {
        assert.equal(job.jobId, quote.executionId); assert.equal(job.status, status);
        assert.deepEqual(job.result.planningStopBudget, { reservationStatus: "settled", billingStatus: "settled" });
        assert.equal(job.result.structure, undefined); assert.equal(job.result.noAutomaticRetry, true);
      };
      for (let attempt = 0; attempt < 2; attempt++) {
        const detail = await state.request(path), detailBody = await detail.json();
        assert.equal(detail.status, 200, JSON.stringify(detailBody)); assertLive(detailBody.job);
        for (const suffix of ["", "?document=" + adaptiveConsentBody.documentId]) {
          const listed = await state.request("/api/document-jobs" + suffix), listBody = await listed.json();
          assert.equal(listed.status, 200, JSON.stringify(listBody));
          const match = listBody.jobs.find((job) => job.jobId === quote.executionId); assert.ok(match); assertLive(match);
        }
        const resumed = await state.request("/api/document-jobs/adaptive", json({
          action: "resume", executionId: quote.executionId, projectId: adaptiveConsentBody.projectId,
          documentId: adaptiveConsentBody.documentId, canvasId: null,
        })), resumeBody = await resumed.json();
        assert.equal(resumed.status, 409, JSON.stringify(resumeBody)); assertLive(resumeBody.job);
        assert.equal(resumeBody.executionId, quote.executionId); assert.equal(resumeBody.structure, undefined);
        assert.deepEqual(consequentialReceipt(state, quote.executionId), settled, "Reads cannot reserve, release, or charge again");
        assert.deepEqual(stored(), afterDelivery, "Reads leave the exact historical stop message and raw receipt untouched");
        assert.deepEqual(adaptiveLedgerCounts(state), { token: 1, cost: 1 }); assert.equal(calls, 1);
      }
    } finally { released.resolve(); await state.drainBackground(); globalThis.fetch = originalFetch; }
  });
}
test("adaptive consent API: cancellation after POST keeps the hold and recovers its late paid proposal",{timeout:15_000},async()=>{
  const state=await fixture({provider:true}),original=globalThis.fetch,entered=Promise.withResolvers(),released=Promise.withResolvers();let calls=0;
  try{globalThis.fetch=async(_url,init)=>{calls++;entered.resolve();await released.promise;return adaptiveFixtureResponse(JSON.parse(init.body));};const quote=await quoteAdaptiveConsent(state),accepted=await executeAdaptiveConsent(state,quote);assert.equal(accepted.status,202,JSON.stringify(await accepted.clone().json()));await entered.promise;const before=consequentialBalances(state);const stopped=await state.request("/api/document-jobs/"+quote.executionId+"/cancel",json({}));assert.equal(stopped.status,200,JSON.stringify(await stopped.clone().json()));assert.deepEqual(consequentialBalances(state),before);assert.equal(consequentialReceipt(state,quote.executionId).steps[0].status,"uncertain");released.resolve();await state.drainBackground();const read=await retrieveAdaptiveConsent(state,quote);assert.equal(read.status,200,JSON.stringify(await read.clone().json()));const result=await read.json();assert.deepEqual(result.structure,adaptiveFixtureStructure);assert.equal(result.executionId,quote.executionId);assert.equal(result.status,"completed");assert.equal((await executeAdaptiveConsent(state,quote)).status,200);assert.deepEqual(consequentialBalances(state),{tokens:{used:1300,reserved:0},cost:{used:5600,reserved:0}});assert.equal(calls,1);assert.deepEqual(adaptiveLedgerCounts(state),{token:1,cost:1});}finally{released.resolve();await state.drainBackground();globalThis.fetch=original;}
});
test("adaptive consent API: removing the source board after dispatch retains the original paid proposal",{timeout:15_000},async()=>{
  const state=await adaptiveCanvasFixture(),original=globalThis.fetch,entered=Promise.withResolvers(),released=Promise.withResolvers();let calls=0;
  try{globalThis.fetch=async(_url,init)=>{calls++;entered.resolve();await released.promise;return adaptiveFixtureResponse(JSON.parse(init.body));};const quote=await quoteAdaptiveConsent(state,state.body),accepted=await executeAdaptiveConsent(state,quote,state.body);assert.equal(accepted.status,202,JSON.stringify(await accepted.clone().json()));await entered.promise;changeAdaptiveAuthority(state,"board");released.resolve();await state.drainBackground();const read=await retrieveAdaptiveConsent(state,quote,state.body);assert.equal(read.status,200,JSON.stringify(await read.clone().json()));const result=await read.json();assert.equal(result.sourceHash,quote.sourceHash);assert.equal(result.sourceStatus,"original-approved-source");assert.deepEqual(result.structure,adaptiveFixtureStructure);assert.equal(calls,1);assert.deepEqual(consequentialBalances(state),{tokens:{used:1300,reserved:0},cost:{used:5600,reserved:0}});}finally{released.resolve();await state.drainBackground();globalThis.fetch=original;}
});
test("adaptive consent API: retained retrieval ignores new-spend budget, key, model, source, and month",{timeout:30_000},async()=>{
  for(const status of["completed","uncertain"])for(const unavailable of["budget","key","model","source","month"]){
    const state=await fixture({provider:true}),original=globalThis.fetch;let calls=0,clock,restore;
    try{globalThis.fetch=async(_url,init)=>{calls++;if(status==="uncertain")throw new Error("provider response lost");return adaptiveFixtureResponse(JSON.parse(init.body));};const quote=await quoteAdaptiveConsent(state),accepted=await executeAdaptiveConsent(state,quote);assert.equal(accepted.status,202,JSON.stringify(await accepted.clone().json()));await state.drainBackground();
      if(unavailable==="budget")state.sqlite.prepare("UPDATE cost_budget_counters SET used_microusd=hard_limit_microusd-reserved_microusd WHERE scope='user'").run();if(unavailable==="key")delete state.env.OPENAI_API_KEY;if(unavailable==="model")state.env.OPENAI_MODEL="unpriced-new-model";if(unavailable==="source")changeAdaptiveAuthority(state,"source",adaptiveConsentBody);if(unavailable==="month"){clock=consequentialDbClock(state);clock.set(new Date(Date.now()+40*86_400_000).toISOString());}
      const before=consequentialReceipt(state,quote.executionId);restore=interceptConsequentialDb(state,"batch",/^\s*INSERT OR IGNORE INTO (?:cost_)?budget_reservations\b/u,()=>{throw new Error("retrieval attempted a fresh reservation");});const read=await retrieveAdaptiveConsent(state,quote);assert.equal(read.status,status==="completed"?200:409,status+"/"+unavailable+" "+JSON.stringify(await read.clone().json()));const result=await read.json();assert.equal(result.executionId,quote.executionId);assert.equal(result.quote.period,quote.period);if(status==="completed")assert.deepEqual(result.structure,adaptiveFixtureStructure);else assert.equal(result.status,"uncertain");assert.deepEqual(consequentialReceipt(state,quote.executionId),before);assert.deepEqual(adaptiveLedgerCounts(state),{token:1,cost:1});assert.equal(calls,1);
    }finally{restore?.();clock?.close();await state.drainBackground();globalThis.fetch=original;}
  }
});
test("adaptive consent API: owner custody without a selected cookie atomically binds job and billing resources",{timeout:15_000},async()=>{
  const state=await sharedProjectFixture({provider:true}),{cookie:_cookie,...owner}=state.owner,original=globalThis.fetch;let calls=0;
  try{globalThis.fetch=async(_url,init)=>{calls++;return adaptiveFixtureResponse(JSON.parse(init.body));};const quote=await quoteAdaptiveConsent(state,adaptiveConsentBody,owner);assert.equal(quote.workspaceId,state.organizationId);const accepted=await executeAdaptiveConsent(state,quote,adaptiveConsentBody,owner);assert.equal(accepted.status,202,JSON.stringify(await accepted.clone().json()));await state.drainBackground();const completed=await retrieveAdaptiveConsent(state,quote,adaptiveConsentBody,owner);assert.equal(completed.status,200,JSON.stringify(await completed.clone().json()));assert.deepEqual((await completed.json()).structure,adaptiveFixtureStructure);const row=adaptiveJob(state,quote.executionId);assert.equal(row.owner_id,"assistant-owner");assert.equal(row.stream_id,"creative:assistant-owner");assert.equal(row.correlation_id,quote.executionId);
    const resource=state.sqlite.prepare("SELECT organization_id,project_access_id,project_id,owner_user_id,actor_user_id FROM project_resource_scopes WHERE resource_kind='job' AND resource_id=?").get(quote.executionId);assert.deepEqual({...resource},{organization_id:state.organizationId,project_access_id:state.projectAccessId,project_id:"project-atmosphere",owner_user_id:"assistant-owner",actor_user_id:"assistant-owner"});assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM project_budget_reservation_scopes WHERE organization_id=? AND project_access_id=? AND actor_user_id='assistant-owner'").get(state.organizationId,state.projectAccessId).n,2);assert.equal(state.sqlite.prepare("SELECT workspace_id FROM cost_budget_reservations WHERE reservation_id=?").get(quote.executionId+":usd:0").workspace_id,state.organizationId);
    const viewer=await retrieveAdaptiveConsent(state,quote,adaptiveConsentBody,state.viewer);assert.ok(viewer.status===403||viewer.status===404);assert.doesNotMatch(await viewer.text(),/private proposal|Which subject|quiet courtyard/u);assert.equal(calls,1);
  }finally{await state.drainBackground();globalThis.fetch=original;}
});

test("consequential consent previews are free and missing approval cannot reserve or dispatch",async()=>{
  const state=await fixture({provider:true}),original=globalThis.fetch;let calls=0;
  try{
    globalThis.fetch=async()=>{calls++;throw new Error("must not dispatch");};
    const quote=await quoteContext(state),same=await quoteContext(state);
    assert.equal(same.executionId,quote.executionId);assert.equal(quote.providerCalls,1);assert.equal(quote.searchCalls,0);assert.ok(quote.maximumMicrousd>0);
    assert.equal((await state.request("/api/context/decompose",json(contextBody))).status,428);
    assert.equal((await executeContext(state,{...quote,bindingHash:"altered"})).status,409);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM budget_reservations").get().n,0);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM cost_budget_reservations").get().n,0);assert.equal(calls,0);
  }finally{globalThis.fetch=original;}
});

test("consequential consent concurrent clicks and lost responses reuse exactly one paid execution",async()=>{
  const state=await fixture({provider:true}),original=globalThis.fetch;let calls=0,release,entered;
  const gate=new Promise((resolve)=>{release=resolve;}),started=new Promise((resolve)=>{entered=resolve;});
  try{
    globalThis.fetch=async(_url,init)=>{calls++;entered();await gate;return contextResult(JSON.parse(init.body));};
    const quote=await quoteContext(state),first=executeContext(state,quote);await started;
    const second=await executeContext(state,quote);assert.equal(second.status,202);assert.equal(calls,1);
    release();const completed=await first;assert.equal(completed.status,200,JSON.stringify(await completed.clone().json()));
    const retry=await executeContext(state,quote);assert.equal(retry.status,200);const {quote:receipt,...recovered}=await retry.json();assert.deepEqual(recovered,await completed.json());assert.equal(receipt.executionId,quote.executionId);assert.equal(calls,1);
    assert.equal((await quoteContext(state)).executionId,quote.executionId);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM cost_budget_reservations").get().n,1);
  }finally{release();globalThis.fetch=original;}
});

test("consequential consent rejects changed source, operation inputs, expiry and execution-time revocation",async()=>{
  for(const change of ["source","addition","expiry","permission-race"]){
    const state=await fixture({provider:true}),original=globalThis.fetch;let calls=0;
    try{
      globalThis.fetch=async()=>{calls++;throw new Error("must not dispatch");};const quote=await quoteContext(state);let body=contextBody;
      if(change==="source")appendFixtureEvents(state.sqlite,"creative:dev-local-creative",[["BlockPropertyEdited",{project_id:"project-atmosphere",document_id:"doc-atmosphere",block_id:"block-direction",property_path:"text",new_value:"Changed source"}]]);
      if(change==="addition")body={...contextBody,addedText:"New source",addedType:"subject"};
      if(change==="expiry")state.sqlite.prepare("UPDATE consequential_executions SET expires_at='2000-01-01T00:00:00.000Z'").run();
      if(change==="permission-race")state.controls.beforeConsequentialClaim=()=>state.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id='dev-local-creative'").run();
      assert.equal((await executeContext(state,quote,body)).status,409,change);assert.equal(calls,0,change);
      assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM budget_reservations").get().n,0,change);
    }finally{globalThis.fetch=original;}
  }
});


// R14: a fresh private quote is still an authorization-sensitive disclosure.
// These use the real adaptive route and only in-memory SQLite interleavings;
// no quote test calls execute, reserves a budget, or contacts a provider.
function adaptiveQuoteMoneyR14(state){
  return{
    tokenReservations:state.sqlite.prepare("SELECT COUNT(*) AS n FROM budget_reservations").get().n,
    costReservations:state.sqlite.prepare("SELECT COUNT(*) AS n FROM cost_budget_reservations").get().n,
    tokens:state.sqlite.prepare("SELECT COALESCE(SUM(used_tokens),0) AS used,COALESCE(SUM(reserved_tokens),0) AS reserved FROM budget_counters").get(),
    costs:state.sqlite.prepare("SELECT COALESCE(SUM(used_microusd),0) AS used,COALESCE(SUM(reserved_microusd),0) AS reserved FROM cost_budget_counters").get(),
  };
}
function withdrawAdaptiveQuoteAuthorityR14(state,change){
  if(change==="control")return;
  const now=new Date().toISOString();let changed;
  if(change==="selected-session")changed=state.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE principal_user_id=? AND project_access_id=? AND revoked_at IS NULL")
    .run(now,"assistant-viewer",state.projectAccessId).changes;
  else if(change==="membership")changed=state.sqlite.prepare("UPDATE project_memberships SET status='revoked',revoked_at=?,updated_at=? WHERE project_access_id=? AND user_id=? AND status='active'")
    .run(now,now,state.projectAccessId,"assistant-viewer").changes;
  else if(change==="project-custody")changed=state.sqlite.prepare("UPDATE organization_projects SET status='archived',updated_at=? WHERE project_access_id=? AND status='active'")
    .run(now,state.projectAccessId).changes;
  else{
    // Erasure/detachment only runs after the new consent has actually been
    // stored (or after an existing quoted consent was read), never on a fake ref.
    const retained=state.sqlite.prepare("SELECT content_id FROM private_content WHERE owner_id=? AND kind='execution-consent' AND redacted_at IS NULL")
      .all("assistant-viewer");
    assert.equal(retained.length,1,"Use the actual actor-private quote source");
    if(change==="consent-erased")changed=state.sqlite.prepare("UPDATE private_content SET content='',redacted_at=? WHERE content_id=?")
      .run(now,retained[0].content_id).changes;
    else if(change==="consent-custody")changed=state.sqlite.prepare("DELETE FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=? AND project_access_id=?")
      .run(retained[0].content_id,state.projectAccessId).changes;
    else assert.fail("Unknown authority change: "+change);
  }
  assert.ok(Number(changed)>0,"The requested authoritative state change must take effect");
}
const adaptiveQuoteBoundariesR14=[
  {name:"authorization-check",kind:"first",pattern:/^SELECT 1 AS authorized WHERE/u,phase:"before"},
  {name:"private-storage",kind:"batch",pattern:/^\s*INSERT INTO private_content\s*\(/u,phase:"before"},
  {name:"quote-admission",kind:"batch",pattern:/^INSERT INTO consequential_executions\(/u,phase:"before"},
  {name:"quote-return",kind:"batch",pattern:/^INSERT INTO consequential_executions\(/u,phase:"after"},
];
function assertAdaptiveQuoteNotPurchasedR14(state,before){
  assert.deepEqual(adaptiveQuoteMoneyR14(state),before,"Quote disclosure must not reserve, settle, release, or change used money/tokens");
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM document_jobs").get().n,0);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM consequential_executions WHERE status!='quoted'").get().n,0);
  assert.equal(state.adaptiveCalls.length,0,"No provider call is permitted in this test");
}
function assertAdaptiveQuoteDeniedR14(response,body){
  assert.ok([403,404,409,410].includes(response.status),"Withdrawn authority/retention must deny disclosure, not merely disable approval: "+response.status);
  for(const key of["quote","planningRequest","privateInput","providerRequest","structure","job"])assert.equal(body[key],undefined,key+" must not leave the revoked read");
  assert.equal(body.canExecute,undefined);
}
for(const boundary of adaptiveQuoteBoundariesR14)for(const change of["control","selected-session","membership","project-custody",
  ...(["quote-admission","quote-return"].includes(boundary.name)?["consent-erased","consent-custody"]:[])]){
  test("adaptive quote final authority R14: "+change+" at "+boundary.name+" gates the complete fresh disclosure",{timeout:10000},async()=>{
    const state=await adaptiveRegressionFixture(true);let restore;
    try{
      await adaptiveReentryMember(state);
      const before=adaptiveQuoteMoneyR14(state);let fired=false;
      restore=interceptConsequentialDb(state,boundary.kind,boundary.pattern,()=>{
        fired=true;withdrawAdaptiveQuoteAuthorityR14(state,change);
      },boundary.phase);
      const response=await state.request("/api/document-jobs/adaptive",json({...adaptiveRegressionRequest,action:"quote"},state.owner));
      const body=await response.json();
      assert.equal(fired,true,"The test must reach the actual "+boundary.name+" SQL boundary");
      assertAdaptiveQuoteNotPurchasedR14(state,before);
      if(change==="control"){
        assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.quote.status,"quoted");assert.equal(body.quote.canExecute,true);
        assert.deepEqual(body.planningRequest,{...adaptiveRegressionRequest,requestKey:body.quote.privateInput.requestKey});
        assert.ok(body.quote.privateInput.providerRequest,"The allowed control still has the complete exact preview");
      }else assertAdaptiveQuoteDeniedR14(response,body);
    }finally{restore?.();await state.closeAdaptiveRegression();}
  });
}
// The helper has a distinct existing-quoted-content return before its fresh
// INSERT path. Revoke AFTER its guarded SELECT returns, while the HTTP response
// has not yet disclosed any bytes. Every fresh-disclosure exit needs final proof.
for(const change of["control","selected-session","membership","project-custody","consent-erased","consent-custody"]){
  test("adaptive quote final authority R14: "+change+" after existing quoted-content lookup cannot disclose captured private bytes",{timeout:10000},async()=>{
    const state=await adaptiveRegressionFixture(true);let restore;
    try{
      await adaptiveReentryMember(state);
      const first=await quoteAdaptiveRegression(state),before=adaptiveQuoteMoneyR14(state);let fired=false;
      restore=interceptConsequentialDb(state,"first",/^SELECT execution\.status,content\.content FROM consequential_executions execution JOIN private_content content/u,()=>{
        fired=true;withdrawAdaptiveQuoteAuthorityR14(state,change);
      },"after");
      const response=await state.request("/api/document-jobs/adaptive",json({...adaptiveRegressionRequest,action:"quote"},state.owner)),body=await response.json();
      assert.equal(fired,true,"Exercise the existing quote's separate private-content return");
      assertAdaptiveQuoteNotPurchasedR14(state,before);
      if(change==="control"){
        assert.equal(response.status,200,JSON.stringify(body));
        assert.equal(body.quote.executionId,first.executionId);assert.equal(body.quote.bindingHash,first.bindingHash);
        assert.deepEqual(body.quote.privateInput,first.privateInput);
        assert.deepEqual(body.planningRequest,{...adaptiveRegressionRequest,requestKey:first.privateInput.requestKey});
      }else assertAdaptiveQuoteDeniedR14(response,body);
    }finally{restore?.();await state.closeAdaptiveRegression();}
  });
}


// A real routed read can capture an early reserved quote and later observe that
// the winner's final private result was erased. That is not a fresh purchase.
for(const shared of[false,true])test("adaptive routed withdrawal R9: "+(shared?"shared":"personal")+" early reserved quote accompanies a newly unavailable winner without another charge",{timeout:15000},async t=>{
  const state=shared?await sharedProjectFixture({provider:true}):await fixture({provider:true}),headers=state.owner??{},originalFetch=globalThis.fetch;
  const providerEntered=Promise.withResolvers(),providerRelease=Promise.withResolvers(),readEntered=Promise.withResolvers(),readRelease=Promise.withResolvers();
  const calls=[];let intercept,redirect;
  const port=model=>{
    const env={...state.env,OPENAI_MODEL:model},context={waitUntil(promise){state.background.push(promise);}};
    return body=>worker.fetch(new Request("http://localhost"+adaptiveConsentPath,json(body,headers)),env,context);
  };
  t.after(()=>{providerRelease.resolve();readRelease.resolve();});
  try{
    globalThis.fetch=async(url,init)=>{
      assert.equal(String(url),"https://api.openai.com/v1/responses");assert.equal(init.method,"POST");
      const payload=JSON.parse(init.body);calls.push(payload.model);providerEntered.resolve();await providerRelease.promise;
      return adaptiveFixtureResponse(payload);
    };
    const winnerPort=port("gpt-5.6-terra"),requestedPort=port("gpt-5.6-luna");
    const winner=await adaptivePreissuedQuote(winnerPort),requested=await adaptivePreissuedQuote(requestedPort);
    assert.notEqual(winner.executionId,requested.executionId);assert.equal(winner.privateInput.requestKey,requested.privateInput.requestKey);
    assert.equal((await adaptivePreissuedExecute(winnerPort,winner)).status,202);await providerEntered.promise;
    // readResult's own job query is not readJob. Pause only ports.read, after
    // retrieve has retained the early execution/quote and before certification.
    intercept=interceptAdaptiveRegressionSql(state,(sql,stack)=>sql==="SELECT * FROM document_jobs WHERE job_id=? AND owner_id=?"&&/\bat Object\.read\b/u.test(stack),"first",async()=>{readEntered.resolve();await readRelease.promise;});
    redirect=adaptivePreissuedExecute(requestedPort,requested);await readEntered.promise;
    assert.deepEqual({...state.sqlite.prepare("SELECT status,result_ref FROM consequential_executions WHERE execution_id=?").get(winner.executionId)},{status:"reserved",result_ref:null});
    providerRelease.resolve();await state.drainBackground();
    const inspection=await state.request("/api/document-jobs/"+winner.executionId+"?inspection=1",{headers}),certified=await inspection.json();
    assert.equal(inspection.status,200);assert.equal(certified.job.status,"completed");assert.ok(certified.job.result.structure);
    assert.equal(certified.job.result.quote,undefined,"Use the actual privacy-preserving serializer");
    const finances=adaptiveReentryFinancialState(state),receipt=adaptivePreissuedAccounting(state,winner.executionId);
    assert.equal(receipt.steps[0].verified_tokens,1300);assert.equal(receipt.cost[0].used_microusd,5600);
    const reference=state.sqlite.prepare("SELECT result_ref FROM consequential_executions WHERE execution_id=?").get(winner.executionId).result_ref;assert.ok(reference);
    assert.equal(Number(state.sqlite.prepare("UPDATE private_content SET content='',redacted_at=? WHERE content_id=?").run(new Date().toISOString(),reference).changes),1);
    readRelease.resolve();const response=await redirect,body=await response.json();
    assert.equal(response.status,202,JSON.stringify(body));
    assert.equal(body.requestedExecutionId,requested.executionId);assert.equal(body.reusedExecutionId,winner.executionId);
    assert.equal(body.quote.executionId,winner.executionId);assert.equal(body.quote.status,"reserved");
    assert.equal(body.quote.bindingHash,winner.bindingHash);assert.deepEqual(body.quote.privateInput,winner.privateInput);
    assert.equal(body.job.jobId,winner.executionId);assert.equal(body.job.status,"completed");
    assert.equal(body.job.result.planningReviewAvailable,false);assert.equal(body.job.result.resultUnavailable,true);
    assert.equal(body.job.result.structure,undefined);assert.equal(body.job.result.intent,undefined);assert.equal(body.job.result.quote,undefined);
    assert.deepEqual(adaptiveReentryFinancialState(state),finances);assert.deepEqual(adaptivePreissuedAccounting(state,winner.executionId),receipt);
    assertAdaptivePreissuedUnused(state,requested);assert.deepEqual(adaptiveLedgerCounts(state),{token:1,cost:1});
    const reread=await state.request(adaptiveConsentPath,json({...adaptiveConsentBody,action:"resume",executionId:winner.executionId},headers));
    assert.equal(reread.ok,false);assert.equal((await reread.json()).error,"adaptive_result_unavailable");
    assert.deepEqual(calls,["gpt-5.6-terra"]);assert.deepEqual(adaptiveReentryFinancialState(state),finances);
    assert.deepEqual(adaptivePreissuedAccounting(state,winner.executionId),receipt);assertAdaptivePreissuedUnused(state,requested);
  }finally{
    providerRelease.resolve();readRelease.resolve();intercept?.restore();
    if(redirect)await redirect.catch(()=>{});await state.drainBackground();globalThis.fetch=originalFetch;
  }
});

test("consequential consent atomically reuses identical pre-issued cross-session quotes and lost redirects",async()=>{
  for(const status of ["reserved","uncertain","completed"]){
    const state=await sharedProjectFixture({provider:true}),{cookie:_cookie,...noCookie}=state.owner,original=globalThis.fetch;let calls=0,release,entered;
    const gate=new Promise((resolve)=>{release=resolve;}),started=new Promise((resolve)=>{entered=resolve;});
    try{
      globalThis.fetch=async(_url,init)=>{calls++;entered();if(status==="reserved")await gate;if(status==="uncertain")throw new Error("lost provider response");return contextResult(JSON.parse(init.body));};
      const selected=await quoteContext(state,contextBody,state.owner),owner=await quoteContext(state,contextBody,noCookie);
      assert.notEqual(selected.bindingHash,owner.bindingHash);assert.equal(selected.sourceHash,owner.sourceHash);
      assert.equal(state.sqlite.prepare("SELECT COUNT(DISTINCT intent_hash) AS n FROM consequential_executions").get().n,1);
      const first=executeContext(state,selected,contextBody,state.owner);if(status==="reserved")await started;else await first;
      const second=await executeContext(state,owner,contextBody,noCookie),reused=await second.json();
      assert.equal(second.status,status==="reserved"?202:status==="uncertain"?409:200,JSON.stringify(reused));
      assert.equal(reused.executionId,selected.executionId);assert.equal(reused.bindingHash,selected.bindingHash);assert.equal(calls,1);
      // Losing the redirect response still retrieves from the original second quote; it never purchases again.
      const recovered=await retrieveContext(state,owner,contextBody,noCookie);assert.equal((await recovered.json()).executionId,selected.executionId);
      assert.equal((await executeContext(state,{...owner,bindingHash:"forged"},contextBody,noCookie)).status,409);
      assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM cost_budget_reservations").get().n,1);assert.equal(calls,1);
      release();await first;
      if(status==="completed"){
        delete state.env.OPENAI_API_KEY;
        assert.equal((await executeContext(state,owner,contextBody,noCookie)).status,200);assert.equal(calls,1);
      }
    }finally{release();globalThis.fetch=original;}
  }
});

test("consequential consent intent exclusion remains atomic when a different session wins at the SQL claim boundary",async()=>{
  const state=await sharedProjectFixture({provider:true}),{cookie:_cookie,...noCookie}=state.owner,original=globalThis.fetch;let calls=0;
  try{
    globalThis.fetch=async()=>{calls++;throw new Error("must not dispatch");};
    const selected=await quoteContext(state,contextBody,state.owner),owner=await quoteContext(state,contextBody,noCookie);
    state.controls.beforeConsequentialClaim=()=>state.sqlite.prepare("UPDATE consequential_executions SET status='reserved' WHERE execution_id=?").run(selected.executionId);
    const second=await executeContext(state,owner,contextBody,noCookie);assert.equal(second.status,202);assert.equal((await second.json()).executionId,selected.executionId);
    assert.equal(state.sqlite.prepare("SELECT status FROM consequential_executions WHERE execution_id=?").get(owner.executionId).status,"quoted");
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM cost_budget_reservations").get().n,0);assert.equal(calls,0);
  }finally{globalThis.fetch=original;}
});

test("consequential consent redirected reuse returns the complete original contract instead of losing-quote metadata",async()=>{
  const state=await sharedProjectFixture({provider:true}),{cookie:_cookie,...noCookie}=state.owner,original=globalThis.fetch;let calls=0,release,entered;
  const gate=new Promise((resolve)=>{release=resolve;}),started=new Promise((resolve)=>{entered=resolve;});
  try{
    globalThis.fetch=async(_url,init)=>{calls++;entered();await gate;return contextResult(JSON.parse(init.body));};
    const selected=await quoteContext(state,contextBody,state.owner),other=await quoteContext(state,contextBody,noCookie);
    // A retained old contract can outlive a pricing/model/account-period change. Simulate that historical quote in this private fixture only.
    const ref=state.sqlite.prepare("SELECT consent_ref FROM consequential_executions WHERE execution_id=?").get(other.executionId).consent_ref;
    const data=JSON.parse(state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(ref).content);
    Object.assign(data.preview,{models:["historical-model"],maximumMicrousd:123456,period:"2001-02",expiresAt:"2001-03-01T00:00:00.000Z",privateInput:{historical:true}});
    state.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id=?").run(JSON.stringify(data),ref);
    const first=executeContext(state,selected,contextBody,state.owner);await started;
    const response=await executeContext(state,other,contextBody,noCookie);assert.equal(response.status,202);const result=await response.json();
    assert.deepEqual(result.quote,{...selected,status:"reserved"});assert.notDeepEqual(result.quote.models,data.preview.models);
    assert.equal(result.quote.maximumMicrousd,selected.maximumMicrousd);assert.equal(result.quote.period,selected.period);assert.equal(calls,1);
    release();assert.equal((await first).status,200);
    const read=await retrieveContext(state,other,contextBody,noCookie);assert.deepEqual((await read.json()).quote,{...selected,status:"completed"});assert.equal(calls,1);
  }finally{release();globalThis.fetch=original;}
});

test("consequential consent keeps unconfirmed submissions held through retries and orphan reconciliation",async()=>{
  const state=await fixture({provider:true}),original=globalThis.fetch;let calls=0;
  try{
    globalThis.fetch=async()=>{calls++;return new Response("provider or gateway rejected",{status:422});};
    const quote=await quoteContext(state),failed=await executeContext(state,quote);assert.equal(failed.status,502);assert.equal((await failed.json()).status,"uncertain");
    const before={...state.sqlite.prepare("SELECT used_microusd,reserved_microusd FROM cost_budget_counters WHERE scope='user' AND scope_id='dev-local-creative'").get()};
    assert.equal(before.used_microusd,0);assert.ok(before.reserved_microusd>0);
    assert.equal((await executeContext(state,quote)).status,409);assert.equal((await quoteContext(state)).executionId,quote.executionId);assert.equal(calls,1);
    const {user}=await requireUser(new Request("http://localhost/api/session"),state.env,"viewer",{account:"principal"});
    const reconciliation=await reconcileFailedBudgetReservations(state.env,user,Date.now()+40*86_400_000);
    assert.equal(reconciliation.releasedTokens,0);assert.equal(reconciliation.releasedMicrousd,0);
    assert.deepEqual({...state.sqlite.prepare("SELECT used_microusd,reserved_microusd FROM cost_budget_counters WHERE scope='user' AND scope_id='dev-local-creative'").get()},before);
    assert.equal(state.sqlite.prepare("SELECT status FROM consequential_execution_steps").get().status,"uncertain");
  }finally{globalThis.fetch=original;}
});

test("consequential consent uses tenant custody without a selected cookie and rejects inactive custody",async()=>{
  for(const change of ["valid","one-micro-cap","migration","missing-policy","migration-owner","dispatch-race"]){
    const state=await sharedProjectFixture({provider:true}),{cookie:_cookie,...owner}=state.owner,original=globalThis.fetch;let calls=0;
    try{
      globalThis.fetch=async(_url,init)=>{calls++;return contextResult(JSON.parse(init.body));};
      if(change==="one-micro-cap")state.sqlite.prepare("UPDATE budget_scope_policies SET microusd_limit=1 WHERE organization_id=?").run(state.organizationId);
      if(change==="migration")state.sqlite.prepare("UPDATE project_migration_states SET status='failed' WHERE project_access_id=?").run(state.projectAccessId);
      if(change==="missing-policy")state.sqlite.prepare("DELETE FROM budget_scope_policies WHERE organization_id=?").run(state.organizationId);
      if(change==="migration-owner")state.sqlite.prepare("UPDATE project_migration_states SET owner_user_id='wrong-owner' WHERE project_access_id=?").run(state.projectAccessId);
      const preview=await state.request("/api/context/decompose",json({...contextBody,action:"quote"},owner));
      if(["migration","missing-policy","migration-owner"].includes(change)){assert.equal(preview.status,403,change);assert.equal(calls,0);continue;}
      if(change==="one-micro-cap"){assert.equal(preview.status,429);assert.equal(calls,0);continue;}
      assert.equal(preview.status,200,JSON.stringify(await preview.clone().json()));const {quote}=await preview.json();assert.equal(quote.workspaceId,state.organizationId);
      if(change==="dispatch-race")state.controls.beforeConsequentialSubmit=()=>state.sqlite.prepare("UPDATE project_migration_states SET status='failed' WHERE project_access_id=?").run(state.projectAccessId);
      const executed=await executeContext(state,quote,contextBody,owner);
      if(change==="dispatch-race"){assert.equal(executed.status,502);assert.equal(calls,0);assert.equal(state.sqlite.prepare("SELECT SUM(reserved_microusd) AS n FROM cost_budget_counters").get().n,0);continue;}
      assert.equal(executed.status,200,JSON.stringify(await executed.clone().json()));assert.equal(calls,1);
      const reservations=state.sqlite.prepare("SELECT workspace_id,owner_id FROM cost_budget_reservations").all();
      assert.deepEqual(reservations.map((row)=>({...row})),[{workspace_id:state.organizationId,owner_id:"assistant-owner"}]);
      assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM project_budget_reservation_scopes WHERE organization_id=?").get(state.organizationId).n,2);
    }finally{globalThis.fetch=original;}
  }
});

test("consequential consent free retrieval ignores new-spend headroom and provider availability",async()=>{
  for(const status of ["completed","uncertain"])for(const unavailable of ["budget","key","enrollment","model"]){
    const state=await fixture({provider:true}),original=globalThis.fetch;let calls=0;
    try{
      globalThis.fetch=async(_url,init)=>{calls++;if(status==="uncertain")throw new Error("lost provider response");return contextResult(JSON.parse(init.body));};
      const quote=await quoteContext(state),first=await executeContext(state,quote);assert.equal(first.status,status==="completed"?200:502);
      if(unavailable==="budget")state.sqlite.prepare("UPDATE cost_budget_counters SET used_microusd=hard_limit_microusd-reserved_microusd WHERE scope='user'").run();
      if(unavailable==="key")delete state.env.OPENAI_API_KEY;
      if(unavailable==="enrollment")state.env.FORMA_ASSISTANT_PROVIDER_USER_IDS="";
      if(unavailable==="model")state.env.FORMA_ASSISTANT_ALLOWED_MODELS="gpt-5.6-luna";
      const reopened=await quoteContext(state);assert.equal(reopened.executionId,quote.executionId,`${status}/${unavailable}`);assert.equal(reopened.status,status);
      const read=await retrieveContext(state,reopened);assert.equal(read.status,status==="completed"?200:409,JSON.stringify(await read.clone().json()));
      assert.equal(calls,1);assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM cost_budget_reservations").get().n,1);
      if(status==="completed")assert.ok((await read.json()).plan);else assert.equal((await read.json()).status,"uncertain");
    }finally{globalThis.fetch=original;}
  }
});

test("consequential consent retrieval cannot consume an unused quote after transport loss",async()=>{
  const state=await fixture({provider:true}),original=globalThis.fetch;let calls=0;
  try{
    globalThis.fetch=async()=>{calls++;throw new Error("must not dispatch");};const quote=await quoteContext(state),read=await retrieveContext(state,quote);
    assert.equal(read.status,409);assert.equal((await read.json()).submission,"not-submitted");assert.equal(calls,0);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM budget_reservations").get().n,0);
    assert.equal(state.sqlite.prepare("SELECT status FROM consequential_executions").get().status,"quoted");
  }finally{globalThis.fetch=original;}
});

test("consequential consent session revocation at dispatch and cached-result reads fails closed",async()=>{
  for(const stage of ["dispatch","result-read"]){
    const state=await sharedProjectFixture({provider:true}),original=globalThis.fetch;let calls=0;
    try{
      globalThis.fetch=async(_url,init)=>{calls++;return contextResult(JSON.parse(init.body));};
      const quote=await quoteContext(state,contextBody,state.owner);
      const revoke=()=>state.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE principal_user_id='assistant-owner'").run(new Date().toISOString());
      if(stage==="dispatch")state.controls.beforeConsequentialSubmit=revoke;
      const first=await executeContext(state,quote,contextBody,state.owner);
      if(stage==="dispatch"){
        assert.equal(first.status,502);assert.equal(calls,0);assert.equal(state.sqlite.prepare("SELECT SUM(reserved_microusd) AS n FROM cost_budget_counters").get().n,0);
      }else{
        assert.equal(first.status,200);state.controls.beforeConsequentialResultRead=revoke;
        const read=await retrieveContext(state,quote,contextBody,state.owner);assert.equal(read.status,403);assert.doesNotMatch(await read.text(),/quiet interior|sourceText/u);assert.equal(calls,1);
      }
    }finally{globalThis.fetch=original;}
  }
});

test("consequential consent finishes a saved verified ledger settlement exactly once without repurchase",async()=>{
  const state=await fixture({provider:true}),original=globalThis.fetch;let calls=0;
  try{
    globalThis.fetch=async(_url,init)=>{calls++;return contextResult(JSON.parse(init.body));};const quote=await quoteContext(state);
    state.controls.failAssistantBillingCostSettlement=true;
    const first=await executeContext(state,quote);assert.equal(first.status,200,JSON.stringify(await first.clone().json()));assert.equal((await first.json()).billingStatus,"pending");
    assert.equal(state.sqlite.prepare("SELECT status FROM consequential_execution_steps").get().status,"usage-recorded");
    for(let attempt=0;attempt<2;attempt++){
      const read=await retrieveContext(state,quote);assert.equal(read.status,200);assert.equal((await read.json()).billingStatus,"settled");
      assert.deepEqual({...state.sqlite.prepare("SELECT used_microusd,reserved_microusd FROM cost_budget_counters WHERE scope='user' AND scope_id='dev-local-creative'").get()},{used_microusd:5600,reserved_microusd:0});
      assert.deepEqual({...state.sqlite.prepare("SELECT used_tokens,reserved_tokens FROM budget_counters WHERE scope='user' AND scope_id='dev-local-creative'").get()},{used_tokens:1300,reserved_tokens:0});
    }
    assert.equal(calls,1);
  }finally{globalThis.fetch=original;}
});

test("consequential consent preserves paid results when concurrent retrieval wins either ledger settlement",async()=>{
  for(const ledger of ["budget_reservations","cost_budget_reservations"]){
    const state=await fixture({provider:true}),original=globalThis.fetch;let calls=0,release,entered,paused=false;
    const gate=new Promise((resolve)=>{release=resolve;}),started=new Promise((resolve)=>{entered=resolve;});
    const prepare=state.env.DB.prepare.bind(state.env.DB);
    try{
      globalThis.fetch=async(_url,init)=>{calls++;return contextResult(JSON.parse(init.body));};const quote=await quoteContext(state);
      state.env.DB.prepare=(sql)=>{
        const statement=prepare(sql),bind=statement.bind.bind(statement);
        statement.bind=(...values)=>{
          const bound=bind(...values),first=bound.first.bind(bound);
          bound.first=async()=>{
            const result=await first();
            if(!paused&&sql===`SELECT * FROM ${ledger} WHERE reservation_id=? AND owner_id=?`&&["active","executing"].includes(result?.status)
              &&state.sqlite.prepare("SELECT 1 FROM consequential_execution_steps WHERE status='usage-recorded'").get()){
              paused=true;entered();await gate;
            }
            return result;
          };return bound;
        };return statement;
      };
      const first=executeContext(state,quote);await started;
      const concurrent=await retrieveContext(state,quote);assert.equal(concurrent.status,202);assert.equal(state.sqlite.prepare("SELECT status FROM consequential_execution_steps").get().status,"settled");
      release();const completed=await first;assert.equal(completed.status,200,JSON.stringify(await completed.clone().json()));assert.equal((await completed.json()).executionId,quote.executionId);
      assert.equal(state.sqlite.prepare("SELECT status FROM consequential_executions").get().status,"completed");
      assert.ok(state.sqlite.prepare("SELECT result_ref FROM consequential_executions").get().result_ref);
      assert.equal((await quoteContext(state)).executionId,quote.executionId);assert.equal((await retrieveContext(state,quote)).status,200);assert.equal(calls,1);
      assert.deepEqual({...state.sqlite.prepare("SELECT used_microusd,reserved_microusd FROM cost_budget_counters WHERE scope='user' AND scope_id='dev-local-creative'").get()},{used_microusd:5600,reserved_microusd:0});
      assert.deepEqual({...state.sqlite.prepare("SELECT used_tokens,reserved_tokens FROM budget_counters WHERE scope='user' AND scope_id='dev-local-creative'").get()},{used_tokens:1300,reserved_tokens:0});
    }finally{release();state.env.DB.prepare=prepare;globalThis.fetch=original;}
  }
});

test("consequential consent never regresses a saved result after a late authorization-read failure",async()=>{
  const state=await fixture({provider:true}),original=globalThis.fetch;let calls=0;
  try{
    globalThis.fetch=async(_url,init)=>{calls++;return contextResult(JSON.parse(init.body));};const quote=await quoteContext(state);
    state.controls.failAfterConsequentialComplete=true;
    const first=await executeContext(state,quote);assert.equal(first.status,502);assert.equal((await first.json()).status,"completed");
    const row=state.sqlite.prepare("SELECT status,result_ref FROM consequential_executions").get();assert.equal(row.status,"completed");assert.ok(row.result_ref);
    const reopened=await quoteContext(state);assert.equal(reopened.executionId,quote.executionId);
    assert.equal((await retrieveContext(state,reopened)).status,200);assert.equal(calls,1);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM consequential_executions").get().n,1);
  }finally{globalThis.fetch=original;}
});

test("consequential consent retained results survive a billing-month rollover without new approval or spend",async()=>{
  const state=await fixture({provider:true}),original=globalThis.fetch,NativeDate=Date,clock=consequentialDbClock(state);let calls=0;
  try{
    const past=Date.now()-40*86_400_000;clock.set(new NativeDate(past).toISOString());
    globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[past]));}static now(){return past;}};
    globalThis.fetch=async(_url,init)=>{calls++;return contextResult(JSON.parse(init.body));};const quote=await quoteContext(state);
    assert.equal((await executeContext(state,quote)).status,200);globalThis.Date=NativeDate;clock.set(new NativeDate().toISOString());
    const reopened=await quoteContext(state);assert.equal(reopened.executionId,quote.executionId);assert.equal(reopened.period,quote.period);
    assert.equal((await retrieveContext(state,reopened)).status,200);assert.equal(calls,1);
    assert.equal(state.sqlite.prepare("SELECT period FROM cost_budget_reservations").get().period,quote.period);
  }finally{globalThis.Date=NativeDate;globalThis.fetch=original;clock.close();}
});

test("consequential consent never replaces an unknown request when its private preview expires",async()=>{
  const state=await fixture({provider:true}),original=globalThis.fetch;let calls=0;
  try{
    globalThis.fetch=async()=>{calls++;throw new Error("lost response");};const quote=await quoteContext(state);assert.equal((await executeContext(state,quote)).status,502);
    state.sqlite.prepare("UPDATE private_content SET expires_at='2000-01-01T00:00:00.000Z' WHERE kind='execution-consent'").run();
    const next=await state.request("/api/context/decompose",json({...contextBody,action:"quote"}));assert.equal(next.status,409);assert.equal((await next.json()).error,"context_existing_request_unavailable");
    assert.equal(calls,1);assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM consequential_executions").get().n,1);
    assert.ok(state.sqlite.prepare("SELECT reserved_microusd FROM cost_budget_counters WHERE scope='user'").get().reserved_microusd>0);
  }finally{globalThis.fetch=original;}
});

const contextProposalResponse=(payload)=>Response.json({id:"context-proposals-fixture",model:payload.model,output:[{type:"message",content:[{type:"output_text",text:JSON.stringify({proposals:[
  {type:"emotion",subtype:"Primary affect",label:"Quiet",text:"quiet",source_excerpt:"quiet",participants:[]},
  {type:"environment",subtype:"Interior",label:"Interior",text:"interior",source_excerpt:"interior",participants:[]},
]})}]}],usage:{input_tokens:1000,output_tokens:300,total_tokens:1300}});
const previewContextChanges=(state,selections,headers={},body=contextBody)=>state.request("/api/context/apply",json({...body,action:"preview",selections},headers));
const applyContextChanges=(state,preview,headers={},action="apply",body=contextBody)=>state.request("/api/context/apply",json({...body,action,previewId:preview.previewId,approvalHash:preview.approvalHash},headers));
const proposalSelection=(result,index=0,edit)=>({executionId:result.executionId,bindingHash:result.bindingHash,proposalId:result.plan.proposals[index].id,...(edit?{edit}:{})});
const contextEventCount=(state,stream="creative:dev-local-creative")=>state.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE stream_id=?").get(stream).n;

test("human context approval previews exact selected edits for free and atomically applies once across owner access paths",async()=>{
  for(const mode of ["personal","selected","owner-custody"]){
    const state=mode==="personal"?await fixture({provider:true}):await sharedProjectFixture({provider:true}),original=globalThis.fetch;let calls=0;
    const headers=mode==="personal"?{}:mode==="selected"?state.owner:Object.fromEntries(Object.entries(state.owner).filter(([key])=>key!=="cookie"));
    const stream=mode==="personal"?"creative:dev-local-creative":"creative:assistant-owner";
    try{
      globalThis.fetch=async(_url,init)=>{calls++;return contextProposalResponse(JSON.parse(init.body));};
      const quote=await quoteContext(state,contextBody,headers),analysis=await executeContext(state,quote,contextBody,headers),result=await analysis.json();assert.equal(analysis.status,200);assert.equal(result.plan.proposals.length,2);
      const before=contextEventCount(state,stream),costCount=state.sqlite.prepare("SELECT COUNT(*) AS n FROM cost_budget_reservations").get().n;
      delete state.env.OPENAI_API_KEY;delete state.env.FORMA_ASSISTANT_PROVIDER_USER_IDS;
      const response=await previewContextChanges(state,[proposalSelection(result,0,{text:"A deliberate human edit",label:"My mood"})],headers);assert.equal(response.status,200,JSON.stringify(await response.clone().json()));const {preview}=await response.json();
      assert.equal(preview.blockCount,1);assert.equal(preview.relationCount,1);assert.equal(preview.changes.filter((item)=>item.kind==="create")[0].text,"A deliberate human edit");assert.ok(preview.changes.some((item)=>item.kind==="group"));
      assert.equal(contextEventCount(state,stream),before);assert.equal(calls,1);assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM cost_budget_reservations").get().n,costCount);
      assert.equal((await applyContextChanges(state,preview,headers,"retrieve")).status,200);assert.equal(contextEventCount(state,stream),before);
      const applied=await applyContextChanges(state,preview,headers);assert.equal(applied.status,200,JSON.stringify(await applied.clone().json()));const first=await applied.json();assert.equal(first.status,"applied");
      const after=contextEventCount(state,stream);assert.equal(after-before,3);assert.equal(first.blockIds.length,1);
      const replay=await applyContextChanges(state,preview,headers);assert.equal(replay.status,200);assert.deepEqual((await replay.json()).blockIds,first.blockIds);assert.equal(contextEventCount(state,stream),after);
      const saved=state.sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=(SELECT last_event_id FROM authoring_commits WHERE preview_id=?)").get(preview.previewId);assert.ok(saved);
      assert.equal(calls,1);assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM authoring_commits").get().n,1);
    }finally{globalThis.fetch=original;}
  }
});

test("human context approval rejects forged selections, missing confirmation and source changes before any authored mutation",async()=>{
  const state=await fixture({provider:true}),original=globalThis.fetch;
  try{
    globalThis.fetch=async(_url,init)=>contextProposalResponse(JSON.parse(init.body));const quote=await quoteContext(state),result=await(await executeContext(state,quote)).json(),selection=proposalSelection(result);
    const before=contextEventCount(state);
    for(const selections of [[{...selection,proposalId:"forged"}],[{...selection,bindingHash:"wrong"}],[selection,{...proposalSelection(result,1),bindingHash:"wrong"}],[{...selection,edit:{authority:"model"}}],[selection,selection]]){
      assert.notEqual((await previewContextChanges(state,selections)).status,200);assert.equal(contextEventCount(state),before);
    }
    assert.equal((await state.request("/api/context/apply",json({...contextBody,action:"apply"}))).status,428);
    const {preview}=await(await previewContextChanges(state,[selection])).json();
    assert.notEqual((await applyContextChanges(state,{...preview,approvalHash:"0".repeat(64)})).status,200);
    appendFixtureEvents(state.sqlite,"creative:dev-local-creative",[["BlockPropertyEdited",{...contextBody,block_id:"block-palette",property_path:"text",new_value:"A newer related decision"}]]);
    const changed=contextEventCount(state),apply=await applyContextChanges(state,preview);assert.equal(apply.status,409);assert.equal(contextEventCount(state),changed);assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM authoring_commits").get().n,0);
  }finally{globalThis.fetch=original;}
});

test("human context approval rolls back the entire selection if an event, receipt, or final authority check fails",async()=>{
  for(const mode of ["personal","selected"]){for(const fault of ["event","receipt","authority"]){
    const state=mode==="personal"?await fixture({provider:true}):await sharedProjectFixture({provider:true}),headers=mode==="personal"?{}:state.owner,original=globalThis.fetch;
    const stream=mode==="personal"?"creative:dev-local-creative":"creative:assistant-owner",owner=mode==="personal"?"dev-local-creative":"assistant-owner";
    try{
      globalThis.fetch=async(_url,init)=>contextProposalResponse(JSON.parse(init.body));const quote=await quoteContext(state,contextBody,headers),result=await(await executeContext(state,quote,contextBody,headers)).json();
      const quoted=await previewContextChanges(state,[proposalSelection(result),proposalSelection(result,1)],headers);assert.equal(quoted.status,200);const {preview}=await quoted.json(),before=contextEventCount(state,stream);
      if(fault==="event")state.controls.failAuthoringEventAt=2;
      if(fault==="receipt")state.controls.failAuthoringCommit=true;
      if(fault==="authority")state.controls.beforeAuthoringCommit=()=>state.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id=?").run(owner);
      const applied=await applyContextChanges(state,preview,headers);assert.notEqual(applied.status,200,`${mode}/${fault}`);
      assert.equal(contextEventCount(state,stream),before,`${mode}/${fault}`);assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM authoring_commits").get().n,0);
    }finally{globalThis.fetch=original;}
  }}
});

test("human context approval concurrent confirmations and lost responses retain one complete canonical mutation",async()=>{
  const state=await fixture({provider:true}),original=globalThis.fetch;
  try{
    globalThis.fetch=async(_url,init)=>contextProposalResponse(JSON.parse(init.body));const quote=await quoteContext(state),result=await(await executeContext(state,quote)).json();
    const {preview}=await(await previewContextChanges(state,[proposalSelection(result),proposalSelection(result,1)])).json(),before=contextEventCount(state);
    const responses=await Promise.all([applyContextChanges(state,preview),applyContextChanges(state,preview)]);for(const response of responses)assert.ok([200,202].includes(response.status),JSON.stringify(await response.clone().json()));
    assert.equal(contextEventCount(state)-before,5);assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM authoring_commits").get().n,1);
    const recovered=await applyContextChanges(state,preview,{},"retrieve");assert.equal(recovered.status,200);assert.equal((await recovered.json()).status,"applied");assert.equal(contextEventCount(state)-before,5);
  }finally{globalThis.fetch=original;}
});

test("human context approval binds library and Canvas destinations without first-document or board aliases",async()=>{
  for(const surface of ["library","canvas"]){
    const state=await fixture({provider:true}),original=globalThis.fetch,blockId=`${surface}-decision`,canvasId=surface==="canvas"?"context-board":null;
    const body={...contextBody,blockId,...(canvasId?{canvasId}:{})};
    appendFixtureEvents(state.sqlite,"creative:dev-local-creative",[
      ...(canvasId?[["CanvasCreated",{project_id:contextBody.projectId,canvas_id:canvasId,name:"Exact context board"}]]:[]),
      ["BlockCreated",{project_id:contextBody.projectId,block_id:blockId,scope:surface,...(canvasId?{canvas_id:canvasId}:{}),type:"direction",handle:"direction/quiet",position:"z8",properties:{text:"quiet interior",subtype:"Campaign goal",intent:"include"}}],
    ]);
    try{
      globalThis.fetch=async(_url,init)=>contextProposalResponse(JSON.parse(init.body));
      if(canvasId){
        state.sqlite.prepare("UPDATE users SET role='creator' WHERE user_id='dev-local-creative'").run();
        assert.equal((await state.request("/api/context/decompose",json({...body,action:"quote"}))).status,403,"Canvas capability is not implied by authoring rights");
        state.sqlite.prepare("UPDATE users SET role='admin' WHERE user_id='dev-local-creative'").run();
      }
      const quote=await quoteContext(state,body),result=await(await executeContext(state,quote,body)).json();
      const response=await previewContextChanges(state,[proposalSelection(result)],{},body);assert.equal(response.status,200,JSON.stringify(await response.clone().json()));const {preview}=await response.json();
      assert.equal(preview.canvasId,canvasId);assert.ok(preview.events.every((event)=>event.payload.scope===surface));
      if(canvasId)assert.equal((await applyContextChanges(state,preview,{},"apply",{...body,canvasId:"another-board"})).status,409);
      const applied=await applyContextChanges(state,preview,{},"apply",body);assert.equal(applied.status,200,JSON.stringify(await applied.clone().json()));
    }finally{globalThis.fetch=original;}
  }
});

test("human context approval retains original addendum identities and explicit authored provenance",async()=>{
  const state=await fixture({provider:true}),original=globalThis.fetch;
  try{
    globalThis.fetch=async(_url,init)=>contextProposalResponse(JSON.parse(init.body));
    const base=await(await executeContext(state,await quoteContext(state))).json(),body={...contextBody,addedText:"quiet interior",addedType:"environment"};
    const addition=await(await executeContext(state,await quoteContext(state,body),body)).json();
    assert.equal(base.plan.proposals[0].id,addition.plan.proposals[0].id);assert.notEqual(base.executionId,addition.executionId);
    const response=await previewContextChanges(state,[proposalSelection(base,0),proposalSelection(addition,1)]);assert.equal(response.status,200);const {preview}=await response.json();
    const blocks=preview.events.filter((event)=>event.type==="BlockCreated");assert.equal(blocks.length,2);
    assert.equal(blocks[0].payload.properties.source_block_id,"block-direction");assert.equal(blocks[1].payload.properties.source_block_id,undefined);
    assert.equal(blocks[1].payload.properties.source_execution_id,addition.executionId);
    assert.equal((await applyContextChanges(state,preview)).status,200);
  }finally{globalThis.fetch=original;}
});

test("human context approval expiry, selected-session revocation and wrong actor never write or expose private plans",async()=>{
  for(const reason of ["expiry","session","actor","rights"]){
    const state=await sharedProjectFixture({provider:true}),original=globalThis.fetch,NativeDate=Date;
    try{
      globalThis.fetch=async(_url,init)=>contextProposalResponse(JSON.parse(init.body));const quote=await quoteContext(state,contextBody,state.owner),result=await(await executeContext(state,quote,contextBody,state.owner)).json();
      const {preview}=await(await previewContextChanges(state,[proposalSelection(result)],state.owner)).json();
      const before=contextEventCount(state,"creative:assistant-owner");
      if(reason==="expiry"){const future=Date.now()+11*60_000;globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[future]));}static now(){return future;}};}
      if(reason==="session")state.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE principal_user_id='assistant-owner'").run(new Date().toISOString());
      if(reason==="rights")appendFixtureEvents(state.sqlite,"creative:assistant-owner",[["BlockLocked",{project_id:contextBody.projectId,document_id:contextBody.documentId,block_id:contextBody.blockId}]]);
      const attempted=await applyContextChanges(state,preview,reason==="actor"?state.viewer:state.owner);assert.notEqual(attempted.status,200,reason);
      assert.equal(contextEventCount(state,"creative:assistant-owner"),before+(reason==="rights"?1:0));assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM authoring_commits").get().n,0);
      if(reason==="actor"||reason==="session"){
        const read=await applyContextChanges(state,preview,reason==="actor"?state.viewer:state.owner,"retrieve");assert.equal(read.status,403);assert.doesNotMatch(await read.text(),/source_excerpt|quiet|privateInput/u);
      }
    }finally{globalThis.Date=NativeDate;globalThis.fetch=original;}
  }
});

test("human context free authorship needs no provider eligibility, preserves the viewer ceiling, and read-only members recover locked-source receipts",async()=>{
  const state=await sharedProjectFixture({provider:true}),headers=state.viewer,original=globalThis.fetch;let calls=0;
  try{
    globalThis.fetch=async(_url,init)=>{calls++;return contextProposalResponse(JSON.parse(init.body));};
    state.sqlite.prepare("UPDATE project_memberships SET role='editor' WHERE user_id='assistant-viewer' AND project_access_id=?").run(state.projectAccessId);
    const quote=await quoteContext(state,contextBody,headers),analysis=await executeContext(state,quote,contextBody,headers);assert.equal(analysis.status,200);const result=await analysis.json();
    state.sqlite.prepare("UPDATE project_memberships SET role='viewer' WHERE user_id='assistant-viewer' AND project_access_id=?").run(state.projectAccessId);
    const now=new Date().toISOString();
    state.sqlite.prepare("INSERT INTO capability_grants(grant_id,user_id,capability,scope_type,organization_id,project_access_id,project_id,status,granted_by_user_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
      .run(crypto.randomUUID(),"assistant-viewer","project.author","project",state.organizationId,state.projectAccessId,contextBody.projectId,"active","assistant-owner",now,now);
    const auth=await requireUser(new Request("http://localhost/api/session",{headers}),state.env,"viewer",{account:"principal"});
    assert.equal(auth.user.access.capabilities.includes("project.author"),true);assert.equal(auth.user.access.capabilities.includes("project.output.request"),false);
    assert.equal((await previewContextChanges(state,[proposalSelection(result)],headers)).status,403,"aggregate grants must not bypass the scoped viewer ceiling");
    state.sqlite.prepare("UPDATE project_memberships SET role='editor' WHERE user_id='assistant-viewer' AND project_access_id=?").run(state.projectAccessId);
    delete state.env.OPENAI_API_KEY;delete state.env.FORMA_ASSISTANT_PROVIDER_USER_IDS;
    const response=await previewContextChanges(state,[proposalSelection(result)],headers);assert.equal(response.status,200,JSON.stringify(await response.clone().json()));const {preview}=await response.json();
    const applied=await applyContextChanges(state,preview,headers);assert.equal(applied.status,200,JSON.stringify(await applied.clone().json()));
    appendFixtureEvents(state.sqlite,"creative:assistant-owner",[["BlockLocked",{project_id:contextBody.projectId,document_id:contextBody.documentId,block_id:contextBody.blockId}]]);
    state.sqlite.prepare("UPDATE capability_grants SET status='revoked' WHERE user_id='assistant-viewer'").run();
    state.sqlite.prepare("UPDATE project_memberships SET role='viewer' WHERE user_id='assistant-viewer' AND project_access_id=?").run(state.projectAccessId);
    const count=contextEventCount(state,"creative:assistant-owner"),resumed=await state.request("/api/context/apply",json({...contextBody,action:"resume"},headers));
    assert.equal(resumed.status,200);const recovered=await resumed.json();assert.equal(recovered.status,"applied");assert.equal(recovered.preview.previewId,preview.previewId);
    assert.equal((await applyContextChanges(state,preview,headers,"retrieve")).status,200);assert.notEqual((await previewContextChanges(state,[proposalSelection(result)],headers)).status,200);
    assert.equal(contextEventCount(state,"creative:assistant-owner"),count);assert.equal(calls,1);
  }finally{globalThis.fetch=original;}
});

test("human context reopening without any browser receipt restores unsubmitted edits and lost successful saves without a provider",async()=>{
  const state=await fixture({provider:true}),original=globalThis.fetch;let calls=0;
  try{
    globalThis.fetch=async(_url,init)=>{calls++;return contextProposalResponse(JSON.parse(init.body));};const result=await(await executeContext(state,await quoteContext(state))).json();
    const edit={label:"My retained title",text:"My reviewed wording"},response=await previewContextChanges(state,[proposalSelection(result,0,edit)]);assert.equal(response.status,200);const {preview}=await response.json(),before=contextEventCount(state);
    delete state.env.OPENAI_API_KEY;
    const resume=()=>state.request("/api/context/apply",json({...contextBody,action:"resume"}));
    const unsubmitted=await(await resume()).json();assert.equal(unsubmitted.status,"not-applied");assert.equal(unsubmitted.preview.previewId,preview.previewId);assert.deepEqual(unsubmitted.preview.review.selections[0].edit,edit);assert.equal(contextEventCount(state),before);
    const ignored=await applyContextChanges(state,preview);assert.equal(ignored.status,200); // Deliberately discard the response body, as after transport loss.
    const recovered=await(await resume()).json();assert.equal(recovered.status,"applied");assert.equal(recovered.preview.previewId,preview.previewId);assert.equal(contextEventCount(state)-before,3);
    appendFixtureEvents(state.sqlite,"creative:dev-local-creative",[["BlockLocked",{project_id:contextBody.projectId,document_id:contextBody.documentId,block_id:contextBody.blockId}]]);
    assert.equal((await(await resume()).json()).status,"applied");
    const other=await state.request("/api/context/apply",json({...contextBody,blockId:"block-palette",action:"resume"}));assert.equal((await other.json()).status,"none");
    const dismissed=await applyContextChanges(state,preview,{},"dismiss");assert.equal(dismissed.status,200);assert.equal((await(await resume()).json()).status,"none");
    assert.equal(calls,1);assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM authoring_commits").get().n,1);
  }finally{globalThis.fetch=original;}
});

test("human context active saves remain pending and an expired lease is invalidated before safe retry",async()=>{
  const state=await fixture({provider:true}),original=globalThis.fetch;
  let start,release;const started=new Promise((resolve)=>{start=resolve;}),barrier=new Promise((resolve)=>{release=resolve;});
  try{
    globalThis.fetch=async(_url,init)=>contextProposalResponse(JSON.parse(init.body));const result=await(await executeContext(state,await quoteContext(state))).json();
    const {preview}=await(await previewContextChanges(state,[proposalSelection(result)])).json(),before=contextEventCount(state);
    state.controls.afterAuthoringClaim=async()=>{start();await barrier;};
    const first=applyContextChanges(state,preview);await started;
    const active=await state.request("/api/context/apply",json({...contextBody,action:"resume"}));assert.equal((await active.json()).status,"applying");
    assert.equal((await applyContextChanges(state,preview)).status,202);assert.equal((await applyContextChanges(state,preview,{},"dismiss")).status,409);
    state.sqlite.prepare("UPDATE private_content SET content=json_set(content,'$.leaseExpiresAt','2000-01-01T00:00:00.000Z') WHERE content_id=?").run(preview.previewId);
    const recovered=await state.request("/api/context/apply",json({...contextBody,action:"resume"}));assert.equal((await recovered.json()).status,"not-applied");
    release();assert.equal((await first).status,409);assert.equal(contextEventCount(state),before);
    const retry=await applyContextChanges(state,preview);assert.equal(retry.status,200);assert.equal(contextEventCount(state)-before,3);assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM authoring_commits").get().n,1);
  }finally{release?.();globalThis.fetch=original;}
});

test("human context confirmation tolerates activity-only stream progress without changing its approved plan",async()=>{
  const state=await fixture({provider:true}),original=globalThis.fetch;
  try{
    globalThis.fetch=async(_url,init)=>contextProposalResponse(JSON.parse(init.body));const result=await(await executeContext(state,await quoteContext(state))).json();
    const {preview}=await(await previewContextChanges(state,[proposalSelection(result)])).json();
    appendFixtureEvents(state.sqlite,"creative:dev-local-creative",[["SessionOpened",{session_id:"review-navigation",project_id:contextBody.projectId,document_id:contextBody.documentId}]]);
    const response=await applyContextChanges(state,preview);assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
    const applied=await response.json();assert.equal(applied.blockIds[0],preview.events.find((event)=>event.type==="BlockCreated").payload.block_id);
  }finally{globalThis.fetch=original;}
});

test("human context resume atomically observes a commit landing during status inspection",async()=>{
  const state=await fixture({provider:true}),original=globalThis.fetch;let calls=0,start,release;
  const started=new Promise((resolve)=>{start=resolve;}),barrier=new Promise((resolve)=>{release=resolve;});
  try{
    globalThis.fetch=async(_url,init)=>{calls++;return contextProposalResponse(JSON.parse(init.body));};const result=await(await executeContext(state,await quoteContext(state))).json();
    const {preview}=await(await previewContextChanges(state,[proposalSelection(result)])).json(),before=contextEventCount(state);
    state.controls.afterAuthoringClaim=async()=>{start();await barrier;};const applying=applyContextChanges(state,preview);await started;
    state.controls.beforeAuthoringStateRead=async()=>{release();assert.equal((await applying).status,200);};
    const response=await state.request("/api/context/apply",json({...contextBody,action:"resume"}));assert.equal(response.status,200);const recovered=await response.json();
    assert.equal(recovered.status,"applied");assert.equal(recovered.preview.previewId,preview.previewId);assert.equal(recovered.blockIds[0],preview.events.find((event)=>event.type==="BlockCreated").payload.block_id);
    assert.equal(contextEventCount(state)-before,3);assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM authoring_commits").get().n,1);assert.equal(calls,1);
  }finally{release?.();globalThis.fetch=original;}
});

test("human context live session expiry during a delayed save rolls back every event and receipt",async()=>{
  const state=await sharedProjectFixture({provider:true}),original=globalThis.fetch;
  try{
    globalThis.fetch=async(_url,init)=>contextProposalResponse(JSON.parse(init.body));const result=await(await executeContext(state,await quoteContext(state,contextBody,state.owner),contextBody,state.owner)).json();
    const {preview}=await(await previewContextChanges(state,[proposalSelection(result)],state.owner)).json(),before=contextEventCount(state,"creative:assistant-owner");
    state.sqlite.prepare("UPDATE project_context_sessions SET expires_at=? WHERE principal_user_id='assistant-owner'").run(new Date(Date.now()+100).toISOString());
    state.controls.afterAuthoringClaim=()=>new Promise((resolve)=>setTimeout(resolve,160));
    const response=await applyContextChanges(state,preview,state.owner);assert.notEqual(response.status,200);
    assert.equal(contextEventCount(state,"creative:assistant-owner"),before);assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM authoring_commits").get().n,0);
  }finally{globalThis.fetch=original;}
});

async function assertLosingAuthoringOutcome(finalize=async()=>{}){
  const state=await fixture({provider:true}),original=globalThis.fetch;let calls=0,firstRead,releaseFirst,winnerClaim,releaseWinner;
  const readStarted=new Promise((resolve)=>{firstRead=resolve;}),firstBarrier=new Promise((resolve)=>{releaseFirst=resolve;});
  const claimStarted=new Promise((resolve)=>{winnerClaim=resolve;}),winnerBarrier=new Promise((resolve)=>{releaseWinner=resolve;});
  try{
    globalThis.fetch=async(_url,init)=>{calls++;return contextProposalResponse(JSON.parse(init.body));};const result=await(await executeContext(state,await quoteContext(state))).json();
    const {preview}=await(await previewContextChanges(state,[proposalSelection(result)])).json(),before=contextEventCount(state);
    state.controls.afterAuthoringPreviewRead=async()=>{firstRead();await firstBarrier;};
    const loser=applyContextChanges(state,preview);await readStarted;
    state.controls.afterAuthoringClaim=async()=>{winnerClaim();await winnerBarrier;};
    const winner=applyContextChanges(state,preview);await claimStarted;
    state.controls.beforeAuthoringStateRead=async()=>{releaseWinner();assert.equal((await winner).status,200);await finalize(state,preview);};
    releaseFirst();const response=await loser;assert.equal(response.status,200,JSON.stringify(await response.clone().json()));const receipt=await response.json();
    assert.equal(receipt.status,"applied");assert.equal(receipt.previewId,preview.previewId);assert.equal(contextEventCount(state)-before,3);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM authoring_commits").get().n,1);assert.equal(calls,1);
  }finally{releaseFirst?.();releaseWinner?.();globalThis.fetch=original;}
}

test("human context losing confirmation reconciles a winner committed during catch-path inspection",()=>assertLosingAuthoringOutcome());

test("human context completed receipt survives Done and private-preview expiry during losing confirmation",async()=>{
  await assertLosingAuthoringOutcome(async(state,preview)=>{const done=await applyContextChanges(state,preview,{},"dismiss");assert.equal(done.status,200);assert.equal((await done.json()).status,"dismissed");});
  await assertLosingAuthoringOutcome(async(state,preview)=>{state.sqlite.prepare("UPDATE private_content SET expires_at='2000-01-01T00:00:00.000Z' WHERE content_id=?").run(preview.previewId);});
});

test("human context atomic receipt reads recheck current authorization before exposing private review content",async()=>{
  const state=await fixture({provider:true}),original=globalThis.fetch;
  try{
    globalThis.fetch=async(_url,init)=>contextProposalResponse(JSON.parse(init.body));const result=await(await executeContext(state,await quoteContext(state))).json();
    const {preview}=await(await previewContextChanges(state,[proposalSelection(result)])).json();assert.equal((await applyContextChanges(state,preview)).status,200);
    state.controls.afterAuthoringPreviewRead=async()=>{state.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id='dev-local-creative'").run();};
    const response=await applyContextChanges(state,preview,{},"retrieve");assert.equal(response.status,403);assert.doesNotMatch(await response.text(),/quiet|sourceText|blockIds|source_excerpt/u);
  }finally{globalThis.fetch=original;}
});

test("human context erased or malformed private previews never block a fresh free review or resurrect erased content",async()=>{
  for(const retention of ["redacted","malformed"]){
    const state=await fixture({provider:true}),original=globalThis.fetch;let calls=0;
    try{
      globalThis.fetch=async(_url,init)=>{calls++;return contextProposalResponse(JSON.parse(init.body));};
      const result=await(await executeContext(state,await quoteContext(state))).json();
      const {preview:old}=await(await previewContextChanges(state,[proposalSelection(result)])).json(),before=contextEventCount(state);
      const erased=retention==="redacted"?"":"not valid JSON",redactedAt=retention==="redacted"?new Date().toISOString():null;
      state.sqlite.prepare("UPDATE private_content SET content=?,redacted_at=? WHERE content_id=?").run(erased,redactedAt,old.previewId);
      delete state.env.OPENAI_API_KEY;
      const missing=await state.request("/api/context/apply",json({...contextBody,action:"resume"}));assert.equal(missing.status,200);assert.equal((await missing.json()).status,"none");
      assert.equal((await applyContextChanges(state,old,{},"retrieve")).status,403);
      const fresh=await previewContextChanges(state,[proposalSelection(result)]);assert.equal(fresh.status,200,JSON.stringify(await fresh.clone().json()));
      const {preview}=await fresh.json();assert.notEqual(preview.previewId,old.previewId);assert.equal(contextEventCount(state),before);assert.equal(calls,1);
      const retained=state.sqlite.prepare("SELECT content,redacted_at FROM private_content WHERE content_id=?").get(old.previewId);assert.equal(retained.content,erased);assert.equal(retained.redacted_at,redactedAt);
      assert.equal((await applyContextChanges(state,preview)).status,200);assert.equal(contextEventCount(state)-before,3);
      state.sqlite.prepare("UPDATE private_content SET content='',redacted_at=? WHERE content_id=?").run(new Date().toISOString(),preview.previewId);
      const receipt=await applyContextChanges(state,preview,{},"retrieve");assert.equal(receipt.status,200);assert.equal((await receipt.json()).status,"applied");
      assert.equal(calls,1);assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM authoring_commits").get().n,1);
    }finally{globalThis.fetch=original;}
  }
});
