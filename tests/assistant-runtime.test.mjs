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
      if(controls.requestQueryLimit&&++controls.requestQueryCount>controls.requestQueryLimit){controls.queryLimitSql ||= this.sql.slice(0,220);throw new Error("D1 request query limit exceeded");}
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
    assert.equal(parked.output_slot_id,null,"Unsigned historical work must never acquire Output authority");
    const parkedPhysical=Object.assign(Object.create(Object.getPrototypeOf(parked)),parked);delete parkedPhysical.output_slot_id;
    for(const key of ["job_id","owner_id","stream_id","document_id","correlation_id","attempt_count","request_json"])assert.equal(parked[key],original[key]);
    assert.deepEqual(ledger(),beforeLedger,"No exact non-submission proof exists for these original holds");
    appendFixtureEvents(state.sqlite,stream,[["CanvasRestored",{canvas_id:canvasId,project_id:"project-atmosphere"}]]);
    assert.deepEqual(await runDocumentJob(state.env,auth.user,jobId),parked,"Restoration is not retroactive approval");assert.deepEqual(adaptiveJob(state,jobId),parkedPhysical);assert.deepEqual(ledger(),beforeLedger);
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

function specialistStructuredResponse(payload,{reply,actions=[],usage={input_tokens:1000,output_tokens:300,total_tokens:1300},...receipt}={}){
  return specialistRawResponse(payload,{...receipt,usage,output:[{type:"message",id:"migrated-specialist-message",role:"assistant",status:"completed",
    content:[{type:"output_text",text:JSON.stringify({reply:reply??"A focused answer is ready.",actions})}]}]});
}
async function specialistApprovedTurn(state,message,options={}){
  const {model,...scope}=options,turn=await specialistFreeTurn(state,crypto.randomUUID(),message,scope);
  await state.drainBackground();
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM assistant_specialist_tasks WHERE turn_id=?").get(turn.id).n,0,"Send must not admit any paid task");
  const review=await specialistQuote(state,turn.id,model,scope);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM budget_reservations WHERE correlation_id=?").get(review.quote.executionId).n,0,"Quote is free");
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM cost_budget_reservations WHERE correlation_id=?").get(review.quote.executionId).n,0,"Quote is free");
  const response=await specialistExecute(state,review,scope),accepted=await response.json();
  assert.equal(response.status,202,JSON.stringify(accepted)+" SQL: "+state.controls.lastDatabaseError);
  assert.equal(accepted.task.id,review.quote.executionId);assert.equal(accepted.task.executionId,review.quote.executionId);
  assert.equal(accepted.task.bindingHash,review.quote.bindingHash);assert.equal(accepted.task.estimatedMicrousd,review.quote.maximumMicrousd);
  return{turn,review,task:accepted.task};
}
/** Faithful pre-consent queue row and real historical ledgers; this never reopens automatic Send admission. */
async function seedLegacyAssistantTask(state,turn,{status="needs-review",submitted=true,id="legacy-specialist-"+crypto.randomUUID()}={}){
  const row=state.sqlite.prepare("SELECT * FROM assistant_turns WHERE turn_id=?").get(turn.id),actor=row.actor_user_id;
  assert.ok(row);const streamId="creative:"+actor,correlationId="assistant-specialist:"+actor+":"+turn.id,operation="assistant-specialist:page-guidance:gpt-5.6-luna",now=new Date().toISOString();
  const projectScope=row.organization_id?{organizationId:row.organization_id,projectAccessId:row.project_access_id,actorUserId:actor}:undefined;
  const token=await reserveBudget(state.env,actor,12000,{reservationId:id+"-tokens",streamId,correlationId,operation,projectScope});
  assert.equal(token.ok,true,JSON.stringify(token));
  const cost=await reserveCostBudget(state.env,actor,4000,{reservationId:id+"-usd",maximumMicrousd:4000,allowUserOverage:false,streamId,correlationId,operation,period:token.period,projectScope});
  assert.equal(cost.ok,true,JSON.stringify(cost));
  if(submitted)assert.equal(await claimCostBudgetReservation(state.env,actor,id+"-usd"),true);
  state.sqlite.prepare("INSERT INTO assistant_specialist_tasks(task_id,actor_user_id,scope_key,turn_id,organization_id,project_access_id,project_id,document_id,route_family,task_kind,selected_model,token_reservation_id,cost_reservation_id,estimated_microusd,maximum_input_tokens,maximum_output_tokens,locale,permission_epoch,status,error_code,created_at,updated_at,started_at,completed_at,lease_expires_at,provider_submitted,result_json) VALUES(?,?,?,?,?,?,?,?,?,'page-guidance','gpt-5.6-luna',?,?,4000,10400,1600,'en',?,?,?,?,?,?,NULL,?,?,NULL)")
    .run(id,actor,row.scope_key,turn.id,row.organization_id,row.project_access_id,row.project_id,row.document_id,row.route_family,id+"-tokens",id+"-usd",row.permission_epoch,status,submitted?"assistant_provider_submission_unverified":null,now,now,submitted?now:null,submitted?"2000-01-01T00:00:00.000Z":null,Number(submitted));
  state.sqlite.prepare("UPDATE assistant_turns SET request_json=NULL WHERE turn_id=?").run(turn.id);
  assert.equal(state.sqlite.prepare("SELECT result_json FROM assistant_specialist_tasks WHERE task_id=?").get(id).result_json,null);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM consequential_executions WHERE execution_id=?").get(id).n,0,"Historical tasks have no retroactive consent");
  return{id,turnId:turn.id,tokenReservationId:id+"-tokens",costReservationId:id+"-usd",correlationId};
}
/** Recreate an actual crashed signed worker boundary using the shared reservation and submission primitives. */
async function seedExpiredConsentedAssistantLease(state,review,{submitted=false}={}){
  const id=review.quote.executionId,execution=state.sqlite.prepare("SELECT * FROM consequential_executions WHERE execution_id=?").get(id);
  const retained=JSON.parse(state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(execution.consent_ref).content);
  const authorized=await requireUser(new Request("http://localhost"+endpoint(),{headers:state.owner??{}}),state.env);assert.ok(authorized.user);
  await consequential.reserveConsequentialSteps(state.env,authorized.user,retained.binding,id);
  if(submitted){
    const head=Number(state.sqlite.prepare("SELECT MAX(sequence) AS head FROM events WHERE stream_id=?").get(authorized.user.streamId).head);
    await consequential.beginConsequentialStep(state.env,authorized.user,retained.binding,id,0,head);
  }
  state.sqlite.prepare("UPDATE assistant_specialist_tasks SET status='running',lease_expires_at=?,provider_submitted=? WHERE task_id=?")
    .run("2000-01-01T00:00:00.000Z",Number(submitted),id);
  const receipt=consequentialReceipt(state,id);assert.equal(receipt.steps[0].status,submitted?"submitting":"reserved");
  assert.equal(receipt.tokens[0].status,"active");assert.equal(receipt.cost[0].status,"executing");
  return receipt;
}

test("Luna specialist requires explicit saved-turn approval, keeps page-aware privacy, and settles exact usage",async()=>{
  const state=await specialistMockFixture({respond:payload=>specialistStructuredResponse(payload,{id:"assistant-provider-luna",reply:"This document already supports audio and other current output formats.",usage:{input_tokens:1000,output_tokens:200,total_tokens:1200}})});
  try{
    const {turn,review,task}=await specialistApprovedTurn(state,"What outputs are available now?");
    assert.equal(task.model,"gpt-5.6-luna");assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM assistant_specialist_tasks").get().n,1);
    await state.drainBackground();assert.equal(state.calls.length,1);
    const submitted=state.calls[0].payload;assert.equal(submitted.model,"gpt-5.6-luna");assert.equal(submitted.store,false);assert.equal(submitted.max_output_tokens,1600);
    assert.deepEqual(submitted,review.quote.privateInput.providerRequest,"Dispatch reuses the exact reviewed provider request");
    const delivered=JSON.parse(submitted.input);assert.equal(delivered.page,"document");assert.equal(delivered.available_formats.includes("audio"),true);
    assert.doesNotMatch(submitted.input,/dev-local-creative|project-atmosphere|doc-atmosphere|content_ref|allow_provider_audio_transfer/u);
    const receipt=consequentialReceipt(state,task.id);assert.equal(receipt.execution.status,"completed");assert.equal(receipt.steps[0].verified_tokens,1200);assert.equal(receipt.steps[0].verified_microusd,440);
    assert.equal(receipt.balances.cost.used,440);assert.equal(receipt.balances.cost.reserved,0);assert.equal(receipt.balances.tokens.used,1200);assert.equal(receipt.balances.tokens.reserved,0);
    const updated=await(await state.request(endpoint())).json();assert.match(updated.turns.find(item=>item.id===turn.id).reply.text,/already supports audio/u);assert.equal(updated.tasks[0].status,"completed");
    let creativeProviderInput;
    globalThis.fetch=async(_url,init)=>{const body=JSON.parse(init.body);creativeProviderInput=JSON.parse(body.input);return Response.json({id:"direct-follow-up",model:body.model,
      output_text:JSON.stringify({reply:"Direct creative follow-up succeeded.",mutations:[],preview_worthy:false,preview_direction:""}),usage:{input_tokens:100,output_tokens:20,total_tokens:120}});};
    const direct=await state.request("/api/document-jobs",json({kind:"chat",documentId:"doc-atmosphere",sourceSurface:"chat",payload:{message:"Use what you explained",livePreview:false}}));
    assert.equal(direct.status,202,JSON.stringify(await direct.clone().json()));await state.drainBackground();assert.ok(creativeProviderInput);
    assert.equal(creativeProviderInput.history.filter(item=>item.role==="assistant"&&item.text.includes("already supports audio")).length,1,JSON.stringify(creativeProviderInput.history));
  }finally{await state.cleanup();}
});

test("Terra explicitly approved suggestions remain private proposals without authored changes",async()=>{
  const state=await specialistMockFixture({respond:payload=>specialistStructuredResponse(payload,{id:"assistant-terra-proposal",reply:"I prepared independent palette and emotional-direction suggestions.",actions:[{kind:"context.create",block_type:"emotion",target_block_id:null,from_block_id:null,to_block_id:null,relation_kind:"",intent:"include",text:"A calm, welcoming neighborhood atmosphere"}],usage:{input_tokens:900,output_tokens:120,total_tokens:1020}})});
  try{
    const before=state.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='BlockCreated'").get().n;
    const {turn,review,task}=await specialistApprovedTurn(state,"Add palette: twilight cobalt");assert.equal(task.model,"gpt-5.6-terra");
    await state.drainBackground();assert.equal(state.calls.length,1);assert.equal(state.calls[0].payload.model,"gpt-5.6-terra");
    assert.equal(state.sqlite.prepare("SELECT status FROM assistant_specialist_tasks WHERE task_id=?").get(task.id).status,"completed");
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='BlockCreated'").get().n,before);
    const history=await(await state.request(endpoint())).json();assert.deepEqual(history.turns.find(item=>item.id===turn.id).proposals.map(item=>item.summary),["Add palette: twilight cobalt","A calm, welcoming neighborhood atmosphere"]);
    const immutable=state.sqlite.prepare("SELECT payload FROM events WHERE correlation_id=?").all(task.id).map(row=>row.payload).join("\n");
    assert.doesNotMatch(immutable,/calm, welcoming|twilight cobalt/u);
    const receipt=consequentialReceipt(state,review.quote.executionId);assert.equal(receipt.cost[0].used_microusd,3240);assert.equal(receipt.tokens[0].used_tokens,1020);
    assert.equal(receipt.balances.cost.reserved,0);assert.equal(receipt.balances.tokens.reserved,0);
  }finally{await state.cleanup();}
});

test("two explicitly approved specialists run concurrently while queued cancellation preserves both live holds",{timeout:15000},async()=>{
  const gates=[Promise.withResolvers(),Promise.withResolvers()],started=[Promise.withResolvers(),Promise.withResolvers()];let index=0;
  const state=await specialistMockFixture({respond:async payload=>{const current=index++;assert.ok(current<2,"Canceled queued task must never submit");started[current].resolve();await gates[current].promise;return specialistStructuredResponse(payload,{id:"assistant-concurrent-"+current,usage:{input_tokens:100,output_tokens:30,total_tokens:130}});}});
  try{
    const turns=[];for(const message of["Explain the current direction","What results already exist?","What is a useful next step?"])turns.push(await specialistFreeTurn(state,crypto.randomUUID(),message));
    const reviews=[];for(const turn of turns)reviews.push(await specialistQuote(state,turn.id));
    assert.equal((await specialistExecute(state,reviews[0])).status,202);await started[0].promise;
    assert.equal((await specialistExecute(state,reviews[1])).status,202);await started[1].promise;
    assert.equal((await specialistExecute(state,reviews[2])).status,202);
    const third=reviews[2].quote.executionId;assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM assistant_specialist_tasks WHERE status='running'").get().n,2);
    assert.equal(state.sqlite.prepare("SELECT status FROM assistant_specialist_tasks WHERE task_id=?").get(third).status,"queued");
    const free=await specialistFreeTurn(state,crypto.randomUUID(),"The composer remains available while both specialists work.");assert.ok(free.id);assert.equal(state.calls.length,2);
    const before=adaptiveReentryFinancialState(state);const queued=consequentialReceipt(state,third);
    assert.equal(queued.steps[0].status,"quoted");assert.equal(queued.cost.length,0);assert.equal(queued.tokens.length,0,"A queued approval has not reserved beyond the two active tasks");
    const canceled=await state.request(taskEndpoint(third,"cancel"),{method:"POST"});assert.equal(canceled.status,200,JSON.stringify(await canceled.clone().json()));
    assert.equal(state.sqlite.prepare("SELECT status FROM assistant_specialist_tasks WHERE task_id=?").get(third).status,"canceled");
    assert.equal(consequentialReceipt(state,third).steps[0].status,"not-submitted");assert.deepEqual(adaptiveReentryFinancialState(state),before,"Canceling another queued execution cannot release either live provider hold");
    for(const gate of gates)gate.resolve();await state.drainBackground();assert.equal(state.calls.length,2);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM assistant_specialist_tasks WHERE status='completed'").get().n,2);
    const balances=consequentialBalances(state);assert.equal(balances.cost.reserved,0);assert.equal(balances.tokens.reserved,0);assert.equal(balances.tokens.used,260);
  }finally{for(const gate of gates)gate.resolve();await state.cleanup();}
});

test("premium Sol requires exact quote model, administrator enrollment, and separate explicit execution",async()=>{
  const state=await specialistMockFixture({models:"gpt-5.6-luna,gpt-5.6-terra,gpt-5.6-sol",solUsers:"dev-local-creative",respond:payload=>specialistStructuredResponse(payload,{id:"assistant-sol",reply:"The relevant governance decisions are ready for your review.",usage:{input_tokens:200,output_tokens:40,total_tokens:240}})});
  try{
    const session=await(await state.request("/api/session")).json();assert.deepEqual(session.assistant.models,[{id:"gpt-5.6-luna",maximumMicrousd:4000,premiumApprovalRequired:false},{id:"gpt-5.6-terra",maximumMicrousd:40000,premiumApprovalRequired:false},{id:"gpt-5.6-sol",maximumMicrousd:100000,premiumApprovalRequired:true}]);
    const turn=await specialistFreeTurn(state,crypto.randomUUID(),"Review governance and compliance policy",{model:"gpt-5.6-sol",premiumApproval:true});
    await state.drainBackground();assert.equal(state.calls.length,0);assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM assistant_specialist_tasks").get().n,0);
    const implicit=await specialistQuote(state,turn.id);assert.equal(implicit.quote.models[0],"gpt-5.6-sol");assert.equal(implicit.quote.canExecute,false);
    assert.equal((await specialistExecute(state,implicit)).status,409);
    const wrong=await specialistQuote(state,turn.id,"gpt-5.6-luna");assert.equal(wrong.quote.canExecute,false);assert.ok(wrong.quote.unavailableReasons.includes("assistant_model_task_model_insufficient"));assert.equal((await specialistExecute(state,wrong)).status,409);
    const approved=await specialistQuote(state,turn.id,"gpt-5.6-sol");assert.equal(approved.quote.canExecute,true);assert.equal(state.calls.length,0);
    const response=await specialistExecute(state,approved);assert.equal(response.status,202,JSON.stringify(await response.clone().json()));await state.drainBackground();
    assert.equal(state.calls.length,1);assert.equal(state.calls[0].payload.model,"gpt-5.6-sol");
    const receipt=consequentialReceipt(state,approved.quote.executionId);assert.equal(receipt.execution.status,"completed");assert.equal(receipt.tokens[0].used_tokens,240);
    assert.equal(receipt.cost[0].used_microusd,200*4+40*20,"New approval retains the current Sol snapshot instead of repricing historical receipts");
  }finally{await state.cleanup();}
});

test("provider HTTP rejection without verified usage retains both holds and cannot be retried",async()=>{
  const state=await specialistMockFixture({respond:()=>new Response("Temporarily unavailable",{status:503})});
  try{
    const {turn,review,task}=await specialistApprovedTurn(state,"What should I review?");await state.drainBackground();assert.equal(state.calls.length,1);
    const receipt=consequentialReceipt(state,task.id);assert.equal(receipt.execution.status,"uncertain");assert.equal(receipt.steps[0].status,"uncertain");
    assert.equal(receipt.tokens[0].used_tokens,0);assert.equal(receipt.cost[0].used_microusd,0);assert.equal(receipt.cost[0].reserved_microusd,review.quote.maximumMicrousd);assert.ok(receipt.tokens[0].reserved_tokens>0);
    const row=state.sqlite.prepare("SELECT status,result_json FROM assistant_specialist_tasks WHERE task_id=?").get(task.id);assert.equal(row.status,"needs-review");
    assert.ok(JSON.parse(row.result_json).rawReceipt.contentRef,"Raw HTTP error is retained for independent billing verification");
    const finances=adaptiveReentryFinancialState(state);
    assert.equal((await state.request(endpoint())).status,200);assert.equal((await specialistRetrieve(state,review)).status,200);
    assert.equal((await specialistProtocolRequest(state,{action:"resume",turnId:turn.id,executionId:task.id})).status,200);
    assert.equal((await specialistExecute(state,review)).status,200);await state.drainBackground();assert.equal(state.calls.length,1);assert.deepEqual(adaptiveReentryFinancialState(state),finances);
  }finally{await state.cleanup();}
});

test("ambiguous signed submission remains reserved through cancellation and cannot be self-reconciled",async()=>{
  const state=await specialistMockFixture({respond:()=>{throw new TypeError("network disconnected after submission");}});
  try{
    const {turn,review,task}=await specialistApprovedTurn(state,"What is the current direction?");await state.drainBackground();
    assert.equal(state.sqlite.prepare("SELECT status FROM assistant_specialist_tasks WHERE task_id=?").get(task.id).status,"needs-review");
    const receipt=consequentialReceipt(state,task.id);assert.equal(receipt.steps[0].status,"uncertain");assert.equal(receipt.balances.cost.reserved,review.quote.maximumMicrousd);assert.ok(receipt.balances.tokens.reserved>0);
    const finances=adaptiveReentryFinancialState(state);assert.equal((await(await state.request(endpoint())).json()).tasks.find(item=>item.id===task.id).status,"needs-review");
    const canceled=await state.request(taskEndpoint(task.id,"cancel"),{method:"POST"});assert.equal(canceled.status,200,JSON.stringify(await canceled.clone().json()));
    assert.equal(consequentialReceipt(state,task.id).steps[0].status,"uncertain","Cancellation cannot manufacture proof that a prior POST was unused");
    assert.deepEqual(adaptiveReentryFinancialState(state),finances);assert.equal(state.sqlite.prepare("SELECT status FROM assistant_specialist_tasks WHERE task_id=?").get(task.id).status,"canceled");
    assert.equal((await state.request(taskEndpoint(task.id,"reconcile"),{method:"POST"})).status,400);
    assert.equal((await state.request(taskEndpoint(task.id,"reconcile"),json({confirmedNoProviderCharge:false}))).status,400);
    const denied=await state.request(taskEndpoint(task.id,"reconcile"),json({confirmedNoProviderCharge:true}));assert.equal(denied.status,403,JSON.stringify(await denied.clone().json()));
    assert.equal((await denied.json()).error,"assistant_independent_reviewer_required");assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM assistant_billing_reconciliations WHERE task_id=?").get(task.id).n,0);
    assert.equal((await specialistRetrieve(state,review)).status,200);assert.equal((await specialistProtocolRequest(state,{action:"resume",turnId:turn.id,executionId:task.id})).status,200);assert.equal((await specialistExecute(state,review)).status,200);
    await state.drainBackground();assert.equal(state.calls.length,1,"Unknown paid POST is never repeated");assert.deepEqual(adaptiveReentryFinancialState(state),finances);
  }finally{await state.cleanup();}
});

test("an exact authorized organization administrator reconciles a true legacy shared task without private conversation access", async () => {
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
    const turn = await specialistFreeTurn(state, crypto.randomUUID(), userMessage, { headers: state.owner });
    const task = await seedLegacyAssistantTask(state, turn, { status: "needs-review", submitted: true });
    await state.drainBackground();
    assert.equal(submissions, 0, "Historical uncertain charge is seeded, never resubmitted");
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
    assert.equal(submissions, 0, "administrative reconciliation must never retry the seeded ambiguous paid submission");
  } finally { globalThis.fetch = originalFetch; }
});

test("tenant deletion refuses unresolved legacy and explicitly approved organization specialist submissions",async()=>{
  for(const legacy of[true,false]){
    const state=await specialistMockFixture({shared:true,respond:()=>{throw new TypeError("provider completion could not be confirmed");}});
    try{
      let task;if(legacy){const turn=await specialistFreeTurn(state,crypto.randomUUID(),"Explain the approved source context");task=await seedLegacyAssistantTask(state,turn);}
      else({task}=await specialistApprovedTurn(state,"Explain the approved source context"));
      await state.drainBackground();const finances=adaptiveReentryFinancialState(state);
      const removed=await state.request("/api/workspaces/"+state.organizationId+"/deletion",json({confirmation:"DELETE_ORGANIZATION_AND_SCOPED_DATA",organizationId:state.organizationId},state.owner));
      assert.equal(removed.status,409,JSON.stringify(await removed.clone().json()));const response=await removed.json();
      assert.equal(response.error,"provider_submission_in_flight");assert.equal(response.assistantTasks[0].taskId,task.id);
      assert.equal(state.sqlite.prepare("SELECT status FROM organizations WHERE organization_id=?").get(state.organizationId).status,"active");
      assert.equal(state.sqlite.prepare("SELECT status FROM assistant_specialist_tasks WHERE task_id=?").get(task.id).status,"needs-review");
      assert.deepEqual(adaptiveReentryFinancialState(state),finances);assert.equal(state.calls.length,legacy?0:1);
    }finally{await state.cleanup();}
  }
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

test("tenant deletion atomically rejects a legacy provider submission racing the final destructive claim",async()=>{
  const state=await specialistMockFixture({shared:true,respond:()=>{throw new Error("The deletion fixture must never contact a provider");}});
  try{
    const turn=await specialistFreeTurn(state,crypto.randomUUID(),"Explain the approved source context"),task=await seedLegacyAssistantTask(state,turn,{status:"queued",submitted:false});
    let raced=false;state.controls.beforeDeletionClaim=()=>{
      state.sqlite.prepare("UPDATE assistant_specialist_tasks SET status='running',provider_submitted=1 WHERE task_id=?").run(task.id);
      state.sqlite.prepare("UPDATE cost_budget_reservations SET status='executing' WHERE reservation_id=?").run(task.costReservationId);raced=true;
    };
    const finances=adaptiveReentryFinancialState(state),removed=await state.request("/api/workspaces/"+state.organizationId+"/deletion",json({confirmation:"DELETE_ORGANIZATION_AND_SCOPED_DATA",organizationId:state.organizationId},state.owner));
    assert.equal(raced,true);assert.equal(removed.status,409,JSON.stringify(await removed.clone().json()));assert.equal((await removed.json()).error,"provider_submission_in_flight");
    assert.equal(state.sqlite.prepare("SELECT status FROM organizations WHERE organization_id=?").get(state.organizationId).status,"active");
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM organization_deletion_jobs WHERE organization_id=?").get(state.organizationId).n,0);
    assert.equal(state.sqlite.prepare("SELECT provider_submitted FROM assistant_specialist_tasks WHERE task_id=?").get(task.id).provider_submitted,1);
    assert.equal(state.sqlite.prepare("SELECT status FROM cost_budget_reservations WHERE reservation_id=?").get(task.costReservationId).status,"executing");
    const after=adaptiveReentryFinancialState(state);assert.deepEqual(after.costCounters,finances.costCounters);assert.deepEqual(after.tokenCounters,finances.tokenCounters);assert.equal(state.calls.length,0);
  }finally{await state.cleanup();}
});

test("tenant deletion cancels true legacy never-submitted work and erases mutable organization records",async()=>{
  const state=await specialistMockFixture({shared:true,respond:()=>{throw new Error("A never-submitted legacy task must not call a provider");}});
  try{
    const turn=await specialistFreeTurn(state,crypto.randomUUID(),"Explain the approved source context"),task=await seedLegacyAssistantTask(state,turn,{status:"queued",submitted:false});
    assert.equal(state.sqlite.prepare("SELECT status FROM assistant_specialist_tasks WHERE task_id=?").get(task.id).status,"queued");
    assert.equal(state.sqlite.prepare("SELECT status FROM cost_budget_reservations WHERE reservation_id=?").get(task.costReservationId).status,"active");
    const removed=await state.request("/api/workspaces/"+state.organizationId+"/deletion",json({confirmation:"DELETE_ORGANIZATION_AND_SCOPED_DATA",organizationId:state.organizationId},state.owner));
    assert.equal(removed.status,200,JSON.stringify(await removed.clone().json()));assert.equal((await removed.json()).status,"completed");
    for(const table of["assistant_turns","assistant_action_proposals","assistant_specialist_tasks"])assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM "+table+" WHERE organization_id=?").get(state.organizationId).n,0,table);
    const balances=consequentialBalances(state,"assistant-owner");assert.equal(balances.cost.reserved,0);assert.equal(balances.tokens.reserved,0);assert.equal(balances.cost.used,0);assert.equal(balances.tokens.used,0);
    const token=state.sqlite.prepare("SELECT status,used_tokens FROM budget_reservations WHERE reservation_id=?").get(task.tokenReservationId),cost=state.sqlite.prepare("SELECT status,used_microusd FROM cost_budget_reservations WHERE reservation_id=?").get(task.costReservationId);
    assert.equal(token.status,"released");assert.equal(token.used_tokens,0);assert.equal(cost.status,"released");assert.equal(cost.used_microusd,0);
    assert.equal(state.calls.length,0);
  }finally{await state.cleanup();}
});

test("successful-looking signed response without authoritative usage retains holds and never becomes free output",async()=>{
  const state=await specialistMockFixture({respond:payload=>specialistStructuredResponse(payload,{reply:"UNVERIFIED COMPLETION",usage:undefined})});
  try{
    // Omit actual usage entirely; a syntactically completed response is not evidence of a free result.
    const originalFetch=globalThis.fetch;globalThis.fetch=async(...args)=>{const response=await originalFetch(...args),body=await response.json();delete body.usage;return Response.json(body);};
    const {turn,review,task}=await specialistApprovedTurn(state,"What should I inspect?");await state.drainBackground();
    const row=state.sqlite.prepare("SELECT status,error_code FROM assistant_specialist_tasks WHERE task_id=?").get(task.id);assert.equal(row.status,"needs-review");
    const receipt=consequentialReceipt(state,task.id);assert.equal(receipt.steps[0].status,"uncertain");assert.equal(receipt.execution.result_ref,null);
    assert.equal(receipt.balances.cost.reserved,review.quote.maximumMicrousd);assert.ok(receipt.balances.tokens.reserved>0);assert.equal(receipt.balances.cost.used,0);assert.equal(receipt.balances.tokens.used,0);
    assert.doesNotMatch(JSON.stringify((await(await state.request(endpoint())).json()).turns),/UNVERIFIED COMPLETION/u);
    const finance=adaptiveReentryFinancialState(state),retrieved=await specialistRetrieve(state,review),body=await retrieved.json();assert.equal(retrieved.status,200);assert.equal(body.result,undefined);assert.equal(body.task.submission,"uncertain");
    const resume=await specialistProtocolRequest(state,{action:"resume",turnId:turn.id,executionId:task.id});assert.equal(resume.status,200);await state.drainBackground();
    assert.equal(state.calls.length,1);assert.deepEqual(adaptiveReentryFinancialState(state),finance);
  }finally{await state.cleanup();}
});

test("actor-scoped polling and resume never dispatch a lost background job; only explicit original execution resumes it",async()=>{
  const state=await specialistMockFixture({shared:true,respond:payload=>specialistStructuredResponse(payload,{id:"recovered-queued",reply:"Your interrupted request has completed.",usage:{input_tokens:120,output_tokens:30,total_tokens:150}})});
  try{
    state.controls.skipAssistantTaskClaimOnce=true;const {turn,review,task}=await specialistApprovedTurn(state,"Explain this page");await state.drainBackground();
    assert.equal(state.sqlite.prepare("SELECT status FROM assistant_specialist_tasks WHERE task_id=?").get(task.id).status,"queued");assert.equal(state.calls.length,0);
    const finances=adaptiveReentryFinancialState(state);const page=await state.request(endpoint(),{headers:state.owner}),listed=await page.json();assert.equal(page.status,200);
    assert.equal(listed.tasks.find(item=>item.id===task.id).executionId,task.id);assert.equal(listed.tasks.find(item=>item.id===task.id).canExecute,false);
    const resumed=await specialistProtocolRequest(state,{action:"resume",turnId:turn.id,executionId:task.id}),body=await resumed.json();assert.equal(resumed.status,200);assert.equal(body.task.canExecute,true);assert.equal(body.quote.canExecute,true);assert.equal(body.task.submission,"not-submitted");
    const other=await specialistProtocolRequest(state,{action:"resume",turnId:turn.id,executionId:task.id},{headers:state.viewer});assert.equal(other.status,404);assert.doesNotMatch(JSON.stringify(await other.json()),/interrupted request|Explain this page/u);
    await state.drainBackground();assert.equal(state.calls.length,0);assert.deepEqual(adaptiveReentryFinancialState(state),finances);
    const explicit=await specialistExecute(state,review);assert.equal(explicit.status,202,JSON.stringify(await explicit.clone().json()));await state.drainBackground();assert.equal(state.calls.length,1);
    const receipt=consequentialReceipt(state,task.id);assert.equal(receipt.execution.status,"completed");assert.equal(receipt.tokens.length,1);assert.equal(receipt.cost.length,1);
    assert.equal(receipt.tokens[0].reservation_id,task.id+":tokens:0");assert.equal(receipt.cost[0].reservation_id,task.id+":usd:0");assert.equal(receipt.tokens[0].used_tokens,150);
  }finally{await state.cleanup();}
});

test("expired signed specialist leases require explicit execution and never replay a possibly submitted POST",async()=>{
  for(const submitted of[false,true]){
    const state=await specialistMockFixture({respond:payload=>specialistStructuredResponse(payload,{id:"recovered-lease",reply:"The safely recoverable request has completed.",usage:{input_tokens:120,output_tokens:30,total_tokens:150}})});
    try{
      state.controls.skipAssistantTaskClaimOnce=true;const {turn,review,task}=await specialistApprovedTurn(state,"Explain the current page");await state.drainBackground();
      await seedExpiredConsentedAssistantLease(state,review,{submitted});const finances=adaptiveReentryFinancialState(state);
      assert.equal((await state.request(endpoint())).status,200);const resume=await specialistProtocolRequest(state,{action:"resume",turnId:turn.id,executionId:task.id}),body=await resume.json();assert.equal(resume.status,200);
      assert.equal(body.task.canExecute,!submitted);assert.equal(body.task.submission,submitted?"submitting":"not-submitted");
      await state.drainBackground();assert.equal(state.calls.length,0,"Lease expiry and GET/resume never authorize a POST");assert.deepEqual(adaptiveReentryFinancialState(state),finances);
      const explicit=await specialistExecute(state,review);assert.equal(explicit.status,submitted?200:202,JSON.stringify(await explicit.clone().json()));await state.drainBackground();
      assert.equal(state.calls.length,submitted?0:1);
      const receipt=consequentialReceipt(state,task.id);assert.equal(receipt.steps[0].status,submitted?"submitting":"settled");
      assert.equal(receipt.balances.cost.reserved,submitted?review.quote.maximumMicrousd:0);assert.equal(receipt.balances.tokens.used,submitted?0:150);
      if(submitted)assert.deepEqual(adaptiveReentryFinancialState(state),finances);else assert.equal(receipt.execution.status,"completed");
    }finally{await state.cleanup();}
  }
});

test("provider model mismatch retains truthful unknown spend and cannot commit suggestions or silently reprice",async()=>{
  const state=await specialistMockFixture({respond:payload=>specialistStructuredResponse(payload,{id:"wrong-model",model:"gpt-5.6-sol",reply:"This must never be delivered.",usage:{input_tokens:20,output_tokens:5,total_tokens:25}})});
  try{
    const {turn,review,task}=await specialistApprovedTurn(state,"What should I do next?");assert.equal(task.model,"gpt-5.6-luna");await state.drainBackground();
    const row=state.sqlite.prepare("SELECT status,error_code,result_json FROM assistant_specialist_tasks WHERE task_id=?").get(task.id);assert.equal(row.status,"needs-review");
    const receipt=consequentialReceipt(state,task.id);assert.equal(receipt.steps[0].status,"uncertain");assert.equal(receipt.execution.result_ref,null);
    assert.equal(receipt.cost[0].used_microusd,0,"Mismatched evidence must not be billed at either an unapproved model or invented Luna rate");assert.equal(receipt.balances.cost.reserved,review.quote.maximumMicrousd);assert.ok(receipt.balances.tokens.reserved>0);
    const raw=JSON.parse(row.result_json).rawReceipt;assert.ok(raw?.contentRef);
    const retained=JSON.parse(state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(raw.contentRef).content);assert.equal(JSON.parse(retained.responseBody).model,"gpt-5.6-sol");
    const history=await(await state.request(endpoint())).json();assert.doesNotMatch(JSON.stringify(history.turns),/must never be delivered/u);
    const finances=adaptiveReentryFinancialState(state),otherModel=await specialistQuote(state,turn.id,"gpt-5.6-terra");assert.equal(otherModel.quote.executionId,task.id);
    assert.equal((await specialistExecute(state,otherModel)).status,200);assert.equal((await specialistRetrieve(state,review)).status,200);await state.drainBackground();assert.equal(state.calls.length,1);assert.deepEqual(adaptiveReentryFinancialState(state),finances);
  }finally{await state.cleanup();}
});

test("shared viewers stay free while explicitly approved owners use exact tenant billing and private recovery",async()=>{
  const state=await specialistMockFixture({shared:true,respond:payload=>specialistStructuredResponse(payload,{id:"shared-luna",reply:"This shared work remains inside its approved project.",usage:{input_tokens:100,output_tokens:20,total_tokens:120}})});
  try{
    assert.equal((await(await state.request("/api/session",{headers:state.viewer})).json()).assistant.models,undefined);
    assert.deepEqual((await(await state.request("/api/session",{headers:state.owner})).json()).assistant.models.map(model=>model.id),["gpt-5.6-luna","gpt-5.6-terra"]);
    const readerTurn=await specialistFreeTurn(state,crypto.randomUUID(),"What can I review?",{headers:state.viewer});await state.drainBackground();assert.equal(state.calls.length,0);
    const denied=await specialistProtocolRequest(state,{action:"quote",turnId:readerTurn.id},{headers:state.viewer});assert.equal(denied.status,403,JSON.stringify(await denied.clone().json()));
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM assistant_specialist_tasks").get().n,0);assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM budget_reservations").get().n,0);assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM cost_budget_reservations").get().n,0);
    const {review,task}=await specialistApprovedTurn(state,"What current results should I review?");assert.equal(task.model,"gpt-5.6-luna");await state.drainBackground();assert.equal(state.calls.length,1);
    const billing=state.sqlite.prepare("SELECT reservation_kind,organization_id,project_access_id,actor_user_id FROM project_budget_reservation_scopes ORDER BY reservation_kind").all();
    assert.deepEqual(billing.map(row=>({...row})),["tokens","usd"].map(reservation_kind=>({reservation_kind,organization_id:state.organizationId,project_access_id:state.projectAccessId,actor_user_id:"assistant-owner"})));
    const other=await specialistRetrieve(state,review,{headers:state.viewer});assert.equal(other.status,404);
    assert.doesNotMatch(JSON.stringify((await(await state.request(endpoint(),{headers:state.viewer})).json()).turns),/shared work remains inside/u);
    const receipt=consequentialReceipt(state,task.id);assert.equal(receipt.execution.status,"completed");assert.equal(receipt.cost[0].used_microusd,44);assert.equal(receipt.tokens[0].used_tokens,120);
  }finally{await state.cleanup();}
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

test("owner cookie-free turns use real organization custody without adopting old personal history", async () => {
  const { request, sqlite, owner, viewer, organizationId, projectAccessId } = await sharedProjectFixture({ legacyConversation: true });
  const { cookie: _cookie, ...personal } = owner;
  const sharedMessage = "SHARED ORGANIZATION CREATIVE QUESTION", implicitMessage = "IMPLICIT OWNER REAL TENANT QUESTION";
  const sharedTurn=crypto.randomUUID(),implicitTurn=crypto.randomUUID();
  const shared = await request(endpoint(), json({ turnId:sharedTurn, message: sharedMessage }, owner));
  assert.equal(shared.status, 201, JSON.stringify(await shared.clone().json()));
  const individual = await request(endpoint(), json({ turnId:implicitTurn, message:implicitMessage }, personal));
  assert.equal(individual.status, 201, JSON.stringify(await individual.clone().json()));
  for(const turnId of[sharedTurn,implicitTurn]){
    const turn=sqlite.prepare("SELECT * FROM assistant_turns WHERE actor_user_id='assistant-owner' AND turn_id=?").get(turnId);
    assert.equal(turn.organization_id,organizationId);assert.equal(turn.project_access_id,projectAccessId);
    for(const ref of[turn.user_content_ref,turn.assistant_content_ref]){
      const resource=sqlite.prepare("SELECT * FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=?").get(ref);
      const retention=sqlite.prepare("SELECT * FROM private_content_retention_scopes WHERE content_id=?").get(ref);
      assert.equal(resource.visibility,"actor_private");assert.equal(resource.actor_user_id,"assistant-owner");assert.equal(resource.organization_id,organizationId);
      assert.equal(retention.actor_user_id,"assistant-owner");assert.equal(retention.organization_id,organizationId);assert.equal(retention.project_access_id,projectAccessId);
    }
  }
  const personalHistory = await (await request(endpoint(), { headers: personal })).json();
  assert.match(JSON.stringify(personalHistory), /LEGACY PERSONAL CREATIVE QUESTION/u);
  assert.match(JSON.stringify(personalHistory), /IMPLICIT OWNER REAL TENANT QUESTION/u);
  assert.match(JSON.stringify(personalHistory), /SHARED ORGANIZATION CREATIVE QUESTION/u);
  const sharedHistory = await (await request(endpoint(), { headers: owner })).json();
  assert.match(JSON.stringify(sharedHistory), /SHARED ORGANIZATION CREATIVE QUESTION/u);
  assert.match(JSON.stringify(sharedHistory), /IMPLICIT OWNER REAL TENANT QUESTION/u);
  assert.doesNotMatch(JSON.stringify(sharedHistory), /LEGACY PERSONAL CREATIVE QUESTION/u);
  const sharedContent = await (await request("/api/events?after=0&limit=2000&content=1", { headers: owner })).json();
  assert.match(JSON.stringify(sharedContent.content), /SHARED ORGANIZATION CREATIVE QUESTION/u);
  assert.match(JSON.stringify(sharedContent.content), /IMPLICIT OWNER REAL TENANT QUESTION/u);
  assert.doesNotMatch(JSON.stringify(sharedContent.content), /LEGACY PERSONAL CREATIVE QUESTION/u);
  const personalContent = await (await request("/api/events?after=0&limit=2000&content=1", { headers: personal })).json();
  assert.match(JSON.stringify(personalContent.content), /LEGACY PERSONAL CREATIVE QUESTION/u);
  assert.doesNotMatch(JSON.stringify(personalContent.content), /SHARED ORGANIZATION CREATIVE QUESTION|IMPLICIT OWNER REAL TENANT QUESTION/u);
  const viewerHistory=await(await request(endpoint(),{headers:viewer})).json();
  assert.doesNotMatch(JSON.stringify(viewerHistory),/SHARED ORGANIZATION CREATIVE QUESTION|IMPLICIT OWNER REAL TENANT QUESTION|LEGACY PERSONAL CREATIVE QUESTION/u);
  const legacy=sqlite.prepare("SELECT content_id,content FROM private_content WHERE owner_id='assistant-owner' AND content IN('LEGACY PERSONAL CREATIVE QUESTION','LEGACY PERSONAL CREATIVE ANSWER')").all();
  assert.equal(legacy.length,2);
  for(const row of legacy)assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM private_content_retention_scopes WHERE content_id=?").get(row.content_id).n,0,"Old personal private bytes are never silently adopted into tenant retention");
  const reopened=await(await request(endpoint(),{headers:personal})).json();assert.match(JSON.stringify(reopened),/LEGACY PERSONAL CREATIVE QUESTION/u);
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
    intercept=interceptAdaptiveRegressionSql(state,(sql,stack)=>(sql==="SELECT * FROM document_jobs WHERE job_id=? AND owner_id=?"||sql==="SELECT *,(SELECT slot.slot_id FROM output_operation_slots slot WHERE slot.job_id=document_jobs.job_id) AS output_slot_id FROM document_jobs WHERE job_id=? AND owner_id=?")&&/\bat Object\.read\b/u.test(stack),"first",async()=>{readEntered.resolve();await readRelease.promise;});
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
    // Match only the two exact owned-reservation reads; claim/list/other scopes stay outside this gate.
    const outputReservationProjection=(uncertain=false)=>`EXISTS(SELECT 1 FROM output_operation_slots slot
 JOIN output_execution_grants grant_row ON grant_row.scope_key=slot.scope_key AND grant_row.grant_id=slot.grant_id
 ${uncertain?"JOIN output_provider_calls call_row ON call_row.scope_key=slot.scope_key AND call_row.slot_id=slot.slot_id":""}
 WHERE slot.${ledger==="budget_reservations"?"token":"cost"}_reservation_id=${ledger}.reservation_id AND grant_row.payer_user_id=${ledger}.owner_id
 ${uncertain?"AND call_row.status IN('pending','uncertain')":""})`;
    const settlementReads=new Set([`SELECT * FROM ${ledger} WHERE reservation_id=? AND owner_id=?`,
      `SELECT *,${outputReservationProjection()} AS output_bound,${outputReservationProjection(true)} AS output_uncertain FROM ${ledger} WHERE reservation_id=? AND owner_id=?`]);
    try{
      globalThis.fetch=async(_url,init)=>{calls++;return contextResult(JSON.parse(init.body));};const quote=await quoteContext(state);
      state.env.DB.prepare=(sql)=>{
        const statement=prepare(sql),bind=statement.bind.bind(statement);
        statement.bind=(...values)=>{
          const bound=bind(...values),first=bound.first.bind(bound);
          bound.first=async()=>{
            const result=await first();
            if(!paused&&settlementReads.has(sql)&&["active","executing"].includes(result?.status)
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

function specialistFeedTrace(state){
  const original=state.env.DB.prepare,statements=[];
  state.env.DB.prepare=function(sql){
    const wrap=statement=>{const bind=statement.bind;statement.bind=(...values)=>{statements.push({sql,bindings:values.length,bytes:new TextEncoder().encode(sql).byteLength});return wrap(bind.call(statement,...values));};return statement;};
    return wrap(original.call(this,sql));
  };
  return{statements,restore(){state.env.DB.prepare=original;}};
}
function assertSpecialistFeedReadOnly(state,before,trace,expectedCalls=1){
  assert.equal(state.calls.length,expectedCalls,"GET must not POST to a provider");
  assert.deepEqual(adaptiveReentryFinancialState(state),before.financial);
  assert.deepEqual(state.sqlite.prepare("SELECT * FROM consequential_executions ORDER BY execution_id").all(),before.executions);
  assert.deepEqual(state.sqlite.prepare("SELECT * FROM consequential_execution_steps ORDER BY execution_id,step_index").all(),before.steps);
  assert.deepEqual(state.sqlite.prepare("SELECT * FROM assistant_specialist_tasks ORDER BY task_id").all(),before.tasks);
  assert.deepEqual(state.sqlite.prepare("SELECT * FROM assistant_action_commits ORDER BY commit_id").all(),before.commits);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM private_content").get().n,before.privateCount);
  for(const statement of trace.statements){
    assert.ok(statement.bindings<=100,statement.bindings+" bindings: "+statement.sql);
    assert.ok(statement.bytes<=100_000,statement.bytes+" SQL bytes");
    assert.doesNotMatch(statement.sql,/^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM|REPLACE INTO)\s+(?:consequential_\w+|(?:cost_)?budget_\w+|assistant_action_commits|assistant_billing_reconciliations|private_content)\b/iu);
    assert.doesNotMatch(statement.sql,/^\s*SELECT[\s\S]+kind\s*=\s*'provider-response'/iu,"GET must not read or decode raw responses");
  }
}
function specialistFeedSnapshot(state){
  return{financial:adaptiveReentryFinancialState(state),
    executions:state.sqlite.prepare("SELECT * FROM consequential_executions ORDER BY execution_id").all(),
    steps:state.sqlite.prepare("SELECT * FROM consequential_execution_steps ORDER BY execution_id,step_index").all(),
    tasks:state.sqlite.prepare("SELECT * FROM assistant_specialist_tasks ORDER BY task_id").all(),
    commits:state.sqlite.prepare("SELECT * FROM assistant_action_commits ORDER BY commit_id").all(),
    privateCount:state.sqlite.prepare("SELECT COUNT(*) AS n FROM private_content").get().n};
}
async function specialistFeedCompleted(state,id="specialist-feed-turn"){
  const turn=await specialistFreeTurn(state,id),review=await specialistQuote(state,turn.id);
  const response=await specialistExecute(state,review);assert.equal(response.status,202,JSON.stringify(await response.clone().json()));
  await state.drainBackground();
  assert.equal(state.sqlite.prepare("SELECT status FROM assistant_specialist_tasks WHERE task_id=?").get(review.quote.executionId).status,"completed",state.controls.lastDatabaseError);
  return{turn,review};
}
function specialistFeedPointers(state,turn,review){
  const execution=state.sqlite.prepare("SELECT * FROM consequential_executions WHERE execution_id=?").get(review.quote.executionId);
  const saved=state.sqlite.prepare("SELECT * FROM assistant_turns WHERE turn_id=?").get(turn.id);
  return{canonical:execution.result_ref,consent:execution.consent_ref,answer:saved.assistant_content_ref,authored:saved.user_content_ref};
}
function specialistFeedWithdrawal(state,pointers,target,kind){
  const ref=pointers[target];assert.ok(ref);
  if(kind==="expired")state.sqlite.prepare("UPDATE private_content SET expires_at='2000-01-01T00:00:00.000Z' WHERE content_id=?").run(ref);
  else if(kind==="redacted")state.sqlite.prepare("UPDATE private_content SET content='',redacted_at=? WHERE content_id=?").run(new Date().toISOString(),ref);
  else if(kind==="custody")state.sqlite.prepare("UPDATE private_content_retention_scopes SET project_id='different-current-custody' WHERE content_id=?").run(ref);
  else if(kind==="owner")state.sqlite.prepare("UPDATE private_content SET owner_id='different-private-owner' WHERE content_id=?").run(ref);
  else assert.fail("Unknown withdrawal fixture");
}
function assertSpecialistFeedNoCertificate(body,review){
  const task=body.tasks.find(item=>item.id===review.quote.executionId);assert.ok(task,JSON.stringify(body));
  assert.equal(task.certifiedCompleted,undefined);assert.equal(task.completedReview,undefined);
  assert.equal(task.canExecute,false);
  return task;
}
for(const shared of[false,true])test("specialist feed certification: exact completed review is read-only "+(shared?"shared":"personal"),async(t)=>{
  const state=await specialistMockFixture({shared});let trace;
  try{
    const{turn,review}=await specialistFeedCompleted(state),before=specialistFeedSnapshot(state);trace=specialistFeedTrace(state);
    const response=await state.request(endpoint(),{headers:state.owner??{}}),body=await response.json();
    assert.equal(response.status,200,JSON.stringify(body)+" SQL:"+state.controls.lastDatabaseError);
    assert.equal(response.headers.get("cache-control"),"private, no-store");
    const task=body.tasks.find(item=>item.id===review.quote.executionId),completed=task.completedReview;
    assert.equal(task.certifiedCompleted,true);assert.equal(task.status,"completed");assert.equal(task.canExecute,false);
    assert.equal(task.executionId,review.quote.executionId);assert.equal(task.bindingHash,review.quote.bindingHash);assert.equal(task.turnId,turn.id);
    assert.equal(completed.turnId,turn.id);assert.equal(completed.executionId,review.quote.executionId);
    const{budgetAvailable,availableMicrousd,unavailableReasons,...originalQuote}=review.quote;
    assert.deepEqual(completed.quote,{...originalQuote,status:"completed",providerAvailable:true,canExecute:false});
    assert.deepEqual(completed.originalRequest,review.originalRequest);
    assert.deepEqual(completed.result,{reply:"PRIVATE_VERIFIED_SPECIALIST_REPLY",sourceStatus:"original-approved-source"});
    assert.equal(body.turns.find(item=>item.id===turn.id)?.reply.text,completed.result.reply);
    assert.equal("record"in task,false);assert.equal("proof"in task,false);assert.equal("providerResult"in completed.result,false);
    assert.doesNotMatch(JSON.stringify(task),/rawReceipt|contentRef|assistantPaidReplyReadGuard/u);
    assertSpecialistFeedReadOnly(state,before,trace);
    t.diagnostic("GET SQL maximum "+Math.max(...trace.statements.map(item=>item.bindings))+" bindings / "+Math.max(...trace.statements.map(item=>item.bytes))+" bytes");
  }finally{trace?.restore();await state.cleanup();}
});
test("specialist feed certification: fresh certificate follows older pending resume without inferring completion from task identity",async()=>{
  const entered=Promise.withResolvers(),release=Promise.withResolvers(),state=await specialistMockFixture({respond:async payload=>{entered.resolve();await release.promise;return specialistRawResponse(payload);}});let trace;
  try{
    const turn=await specialistFreeTurn(state),review=await specialistQuote(state,turn.id);await specialistExecute(state,review);await entered.promise;
    const oldResponse=await specialistProtocolRequest(state,{action:"resume",turnId:turn.id,executionId:review.quote.executionId}),old=await oldResponse.json();
    const pending=await(await state.request(endpoint())).json(),pendingTask=assertSpecialistFeedNoCertificate(pending,review);
    assert.equal(pendingTask.retentionUnavailable,undefined);assert.equal(old.result,undefined);assert.equal(old.task.submission,"submitting");
    release.resolve();await state.drainBackground();const before=specialistFeedSnapshot(state);trace=specialistFeedTrace(state);
    const current=await(await state.request(endpoint())).json(),task=current.tasks.find(item=>item.id===review.quote.executionId);
    assert.equal(task.certifiedCompleted,true);assert.equal(task.completedReview.result.reply,"PRIVATE_VERIFIED_SPECIALIST_REPLY");
    assert.equal(task.completedReview.turnId,old.turnId);assert.equal(task.completedReview.executionId,old.executionId);
    assert.equal(task.completedReview.quote.bindingHash,old.quote.bindingHash);assert.equal(old.result,undefined);
    assertSpecialistFeedReadOnly(state,before,trace);
  }finally{release.resolve();trace?.restore();await state.cleanup();}
});
test("specialist feed certification: completed identity without current canonical answer and verified commit is insufficient",async()=>{
  const state=await specialistMockFixture();
  try{
    const{review}=await specialistFeedCompleted(state);
    state.sqlite.prepare("DELETE FROM assistant_action_commits WHERE commit_id=?").run("task:"+review.quote.executionId);
    const body=await(await state.request(endpoint())).json(),task=assertSpecialistFeedNoCertificate(body,review);
    assert.equal(task.status,"completed");assert.equal(task.retentionUnavailable,undefined);
    assert.doesNotMatch(JSON.stringify(body),/PRIVATE_VERIFIED_SPECIALIST_REPLY/u);
  }finally{await state.cleanup();}
});
for(const kind of["expired","redacted","custody","owner"])for(const target of["canonical","consent","answer","authored"])
test("specialist feed certification: explicit "+kind+" "+target+" clears retained result without recovery",async()=>{
  const state=await specialistMockFixture({shared:true});let trace;
  try{
    const{turn,review}=await specialistFeedCompleted(state),pointers=specialistFeedPointers(state,turn,review);
    specialistFeedWithdrawal(state,pointers,target,kind);
    const before=specialistFeedSnapshot(state);trace=specialistFeedTrace(state);
    const response=await state.request(endpoint(),{headers:state.owner}),body=await response.json();
    assert.equal(response.status,200,JSON.stringify(body)+" SQL:"+state.controls.lastDatabaseError);
    const task=assertSpecialistFeedNoCertificate(body,review);
    assert.equal(task.retentionUnavailable,true,JSON.stringify(task));assert.equal(task.executionId,review.quote.executionId);
    assert.equal(task.bindingHash,review.quote.bindingHash);assert.equal(task.turnId,turn.id);
    assert.doesNotMatch(JSON.stringify(body),/PRIVATE_VERIFIED_SPECIALIST_REPLY/u);
    assertSpecialistFeedReadOnly(state,before,trace);
  }finally{trace?.restore();await state.cleanup();}
});
for(const target of["canonical","consent","answer","authored"])test("specialist feed certification: final SELECT snapshot detects late "+target+" erasure",async()=>{
  const state=await specialistMockFixture({shared:true});let restore;
  try{
    const{turn,review}=await specialistFeedCompleted(state),pointers=specialistFeedPointers(state,turn,review);let fired=false;
    restore=interceptConsequentialDb(state,"batch",/AS certified_completed/u,()=>{fired=true;specialistFeedWithdrawal(state,pointers,target,"redacted");});
    const response=await state.request(endpoint(),{headers:state.owner}),body=await response.json();
    assert.equal(fired,true);assert.equal(response.status,200,JSON.stringify(body));
    assert.equal(assertSpecialistFeedNoCertificate(body,review).retentionUnavailable,true);
    assert.doesNotMatch(JSON.stringify(body),/PRIVATE_VERIFIED_SPECIALIST_REPLY/u);
    assert.equal(body.turns.some(item=>item.id===turn.id),false);
    assert.equal(body.context.recentTurns.some(item=>item.id.startsWith(turn.id+":")),false);
    assert.equal(state.calls.length,1);
  }finally{restore?.();await state.cleanup();}
});
test("specialist feed certification: final read authority is rechecked after result lookup",async()=>{
  const state=await specialistMockFixture({shared:true});let restore;
  try{
    await specialistFeedCompleted(state);let fired=false;
    restore=interceptConsequentialDb(state,"batch",/AS certified_completed/u,()=>{fired=true;state.sqlite.prepare("UPDATE users SET consent_version='' WHERE user_id='assistant-owner'").run();});
    const response=await state.request(endpoint(),{headers:state.owner}),body=await response.json();
    assert.equal(fired,true);assert.equal(response.status,403,JSON.stringify(body));assert.equal(body.error,"assistant_read_scope_denied");
    assert.equal(body.tasks,undefined);assert.equal(body.turns,undefined);assert.doesNotMatch(JSON.stringify(body),/PRIVATE_VERIFIED_SPECIALIST_REPLY/u);
    assert.equal(state.calls.length,1);
  }finally{restore?.();await state.cleanup();}
});
test("specialist feed certification: ordinary pending status cannot withdraw a previously retained result",async()=>{
  const state=await specialistMockFixture();
  try{
    const{review}=await specialistFeedCompleted(state);
    state.sqlite.prepare("UPDATE assistant_specialist_tasks SET status='running' WHERE task_id=?").run(review.quote.executionId);
    const body=await(await state.request(endpoint())).json(),task=assertSpecialistFeedNoCertificate(body,review);
    assert.equal(task.retentionUnavailable,undefined);assert.equal(task.retainedResultUnavailable,undefined);
    assert.equal(state.calls.length,1);
  }finally{await state.cleanup();}
});
test("specialist feed certification: copied answer with mismatching live private content is never certified",async()=>{
  const state=await specialistMockFixture();let restore;
  try{
    const{turn,review}=await specialistFeedCompleted(state),pointers=specialistFeedPointers(state,turn,review);
    restore=interceptConsequentialDb(state,"batch",/AS certified_completed/u,()=>{state.sqlite.prepare("UPDATE private_content SET content='different live answer' WHERE content_id=?").run(pointers.answer);});
    const body=await(await state.request(endpoint())).json(),task=assertSpecialistFeedNoCertificate(body,review);
    assert.equal(task.retentionUnavailable,undefined);assert.doesNotMatch(JSON.stringify(body),/PRIVATE_VERIFIED_SPECIALIST_REPLY|different live answer/u);
    assert.equal(body.turns.some(item=>item.id===turn.id),false);
  }finally{restore?.();await state.cleanup();}
});
test("specialist feed certification: raw-only receipt remains pending without materialization or ledger reconciliation",async()=>{
  const state=await specialistMockFixture();let restore,trace;
  try{
    const turn=await specialistFreeTurn(state),review=await specialistQuote(state,turn.id);
    restore=interceptConsequentialDb(state,"run",/^\s*UPDATE consequential_executions SET status='completed'/u,()=>{throw new Error("fixture raw-only retained result");});
    await specialistExecute(state,review);await state.drainBackground();restore();restore=null;
    const task=state.sqlite.prepare("SELECT * FROM assistant_specialist_tasks WHERE task_id=?").get(review.quote.executionId);
    assert.ok(JSON.parse(task.result_json).rawReceipt.contentRef);
    assert.equal(state.sqlite.prepare("SELECT result_ref FROM consequential_executions WHERE execution_id=?").get(review.quote.executionId).result_ref,null);
    const before=specialistFeedSnapshot(state);trace=specialistFeedTrace(state);
    const body=await(await state.request(endpoint())).json(),shown=assertSpecialistFeedNoCertificate(body,review);
    assert.equal(shown.retentionUnavailable,undefined);assert.equal(shown.retainedResultUnavailable,undefined);
    assert.doesNotMatch(JSON.stringify(body),/PRIVATE_VERIFIED_SPECIALIST_REPLY/u);
    assertSpecialistFeedReadOnly(state,before,trace);
  }finally{restore?.();trace?.restore();await state.cleanup();}
});
test("specialist feed certification: disabled provider and exhausted purchase budget do not block completed read",async()=>{
  const state=await specialistMockFixture();let trace;
  try{
    const{review}=await specialistFeedCompleted(state);
    delete state.env.OPENAI_API_KEY;state.env.FORMA_ASSISTANT_PROVIDER_USER_IDS="";state.env.FORMA_ASSISTANT_ALLOWED_MODELS="";
    state.sqlite.prepare("UPDATE cost_budget_counters SET used_microusd=1000000000000").run();
    const before=specialistFeedSnapshot(state);trace=specialistFeedTrace(state);
    const response=await state.request(endpoint()),body=await response.json(),task=body.tasks.find(item=>item.id===review.quote.executionId);
    assert.equal(response.status,200,JSON.stringify(body));assert.equal(task.certifiedCompleted,true);
    assert.equal(task.completedReview.quote.providerAvailable,false);assert.equal(task.completedReview.quote.canExecute,false);
    assertSpecialistFeedReadOnly(state,before,trace);
  }finally{trace?.restore();await state.cleanup();}
});
test("specialist feed certification: current other actor and route cannot obtain an original execution certificate",async()=>{
  const state=await specialistMockFixture({shared:true});
  try{
    const{review}=await specialistFeedCompleted(state);
    for(const options of[{path:endpoint(),headers:state.viewer},{path:endpoint("/projects/project-atmosphere"),headers:state.owner}]){
      const response=await state.request(options.path,{headers:options.headers}),body=await response.json();
      assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.tasks.some(item=>item.executionId===review.quote.executionId),false);
      assert.doesNotMatch(JSON.stringify(body),/PRIVATE_VERIFIED_SPECIALIST_REPLY/u);
    }
    assert.equal(state.calls.length,1);
  }finally{await state.cleanup();}
});

const specialistTestRoute="/document/doc-atmosphere";
function specialistProtocolRequest(state,body,{headers=state.owner??{},route=specialistTestRoute,project="project-atmosphere",selected=[]}={}){
  const path=endpoint(route,project).replace("/api/assistant?","/api/assistant/specialist?")+selected.map(id=>"&selected="+encodeURIComponent(id)).join("");
  return state.request(path,json(body,headers));
}
async function specialistFreeTurn(state,id="specialist-turn-0001",message="What should I do next?",options={}){
  const {headers=state.owner??{},route=specialistTestRoute,project="project-atmosphere",selected=[],...body}=options;
  const response=await state.request(endpoint(route,project)+selected.map(value=>"&selected="+encodeURIComponent(value)).join(""),json({turnId:id,message,locale:"en",...body},headers));
  const result=await response.json();assert.equal(response.status,201,JSON.stringify(result)+" SQL: "+state.controls.lastDatabaseError);return result.turn;
}
async function specialistQuote(state,turnId="specialist-turn-0001",model,options={}){
  const response=await specialistProtocolRequest(state,{action:"quote",turnId,...(model?{model}:{})},options),result=await response.json();
  assert.equal(response.status,200,JSON.stringify(result)+" SQL: "+state.controls.lastDatabaseError);assert.ok(result.quote?.executionId);return result;
}
function specialistExecute(state,review,options={}){
  return specialistProtocolRequest(state,{action:"execute",turnId:review.turnId,executionId:review.quote.executionId,approvedBindingHash:review.quote.bindingHash},options);
}
function specialistRetrieve(state,review,options={}){
  return specialistProtocolRequest(state,{action:"retrieve",turnId:review.turnId,executionId:review.quote.executionId,approvedBindingHash:review.quote.bindingHash},options);
}
function specialistRawResponse(payload,override={}){
  return Response.json({id:"specialist-provider-response",model:payload.model,service_tier:"default",status:"completed",
    output:[{type:"message",id:"specialist-provider-message",role:"assistant",status:"completed",content:[{type:"output_text",text:JSON.stringify({reply:"PRIVATE_VERIFIED_SPECIALIST_REPLY",actions:[]})}]}],
    usage:{input_tokens:1000,output_tokens:300,total_tokens:1300},...override});
}
async function specialistMockFixture(options={}){
  const state=options.shared?await sharedProjectFixture({...options,provider:true,actions:true}):await fixture({...options,provider:true,actions:true}),original=globalThis.fetch,calls=[];
  globalThis.fetch=async(url,init)=>{assert.equal(String(url),"https://api.openai.com/v1/responses");assert.equal(init.method,"POST");const payload=JSON.parse(init.body);calls.push({payload,headers:init.headers});return options.respond?options.respond(payload,state):specialistRawResponse(payload);};
  return{...state,calls,async cleanup(){try{await state.drainBackground();}finally{globalThis.fetch=original;}}};
}
test("specialist consent: Send stays free even with explicit premium/model body",async()=>{
  const state=await specialistMockFixture();
  try{
    const turn=await specialistFreeTurn(state,"specialist-turn-free","What should I do next?",{model:"gpt-5.6-sol",premiumApproval:true});
    assert.equal(turn.originalRequest.turnId,turn.id);assert.equal(turn.originalRequest.route,specialistTestRoute);
    await state.drainBackground();assert.equal(state.calls.length,0);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM assistant_specialist_tasks").get().n,0);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM budget_reservations").get().n,0);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM cost_budget_reservations").get().n,0);
    const again=await state.request(endpoint(),json({turnId:turn.id,message:turn.user,model:"gpt-5.6-terra"}));assert.equal(again.status,200);
    assert.equal(state.calls.length,0);assert.equal((await again.json()).turn.id,turn.id);
  }finally{await state.cleanup();}
});
test("specialist consent: no-key quote discloses full saved contract without purchase",async()=>{
  const state=await specialistMockFixture();
  try{
    delete state.env.OPENAI_API_KEY;const turn=await specialistFreeTurn(state);const review=await specialistQuote(state,turn.id);
    assert.equal(review.quote.operation,"assistant-specialist");assert.equal(review.quote.providerAvailable,false);assert.equal(review.quote.canExecute,false);
    assert.equal(review.originalRequest.turnId,turn.id);assert.equal(review.originalRequest.documentId,"doc-atmosphere");assert.deepEqual(review.originalRequest.selectedItemIds,[]);
    assert.ok(review.quote.maximumMicrousd>0);assert.equal(state.calls.length,0);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM assistant_specialist_tasks").get().n,0);assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM budget_reservations").get().n,0);
    const execution=await specialistExecute(state,review);assert.equal(execution.status,503,JSON.stringify(await execution.clone().json()));
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM assistant_specialist_tasks").get().n,0);assert.equal(state.calls.length,0);
  }finally{await state.cleanup();}
});
test("specialist consent: one approved task settles raw evidence and recovers without a new POST",async()=>{
  const state=await specialistMockFixture();
  try{
    const turn=await specialistFreeTurn(state);const review=await specialistQuote(state,turn.id);
    assert.equal(review.quote.canExecute,true,JSON.stringify(review));const response=await specialistExecute(state,review);
    assert.equal(response.status,202,JSON.stringify(await response.clone().json())+" SQL: "+state.controls.lastDatabaseError);
    await state.drainBackground();
    const receipt=consequentialReceipt(state,review.quote.executionId);
    assert.equal(state.calls.length,1,JSON.stringify(receipt)+" SQL: "+state.controls.lastDatabaseError);
    assert.equal(receipt.execution.status,"completed",JSON.stringify(receipt)+" SQL: "+state.controls.lastDatabaseError);
    assert.equal(receipt.steps[0].status,"settled");assert.equal(receipt.steps[0].verified_tokens,1300);assert.equal(receipt.cost[0].status,"settled");assert.equal(receipt.tokens[0].status,"settled");
    const task=state.sqlite.prepare("SELECT * FROM assistant_specialist_tasks WHERE task_id=?").get(review.quote.executionId);
    assert.equal(task.status,"completed",JSON.stringify(task)+" SQL: "+state.controls.lastDatabaseError);
    assert.equal(task.token_reservation_id,task.task_id+":tokens:0");assert.equal(task.cost_reservation_id,task.task_id+":usd:0");
    assert.ok(JSON.parse(task.result_json).rawReceipt.contentRef);assert.equal(task.result_json.includes("PRIVATE_VERIFIED"),false);
    assert.equal(state.calls[0].headers["X-Client-Request-Id"],task.task_id);
    const financial=adaptiveReentryFinancialState(state);
    for(const action of["retrieve","resume"]){
      const retrieved=await specialistProtocolRequest(state,{action,turnId:turn.id,executionId:task.task_id,...(action==="retrieve"?{approvedBindingHash:review.quote.bindingHash}:{})});
      const body=await retrieved.json();assert.equal(retrieved.status,200,JSON.stringify(body));assert.equal(body.result.reply,"PRIVATE_VERIFIED_SPECIALIST_REPLY",JSON.stringify(body));
      assert.equal(body.turn.id,turn.id);assert.equal(body.task.executionId,task.task_id);assert.equal(body.task.bindingHash,review.quote.bindingHash);assert.equal(body.task.model,review.quote.models[0]);
    }
    await state.drainBackground();assert.equal(state.calls.length,1);assert.deepEqual(adaptiveReentryFinancialState(state),financial);
    const page=await state.request(endpoint()),body=await page.json();assert.equal(page.status,200,JSON.stringify(body));assert.equal(body.tasks[0].executionId,task.task_id);
  }finally{await state.cleanup();}
});

test("specialist consent: preissued model quotes and concurrent approval cannot buy twice",async()=>{
  const state=await specialistMockFixture();
  try{
    const turn=await specialistFreeTurn(state),luna=await specialistQuote(state,turn.id,"gpt-5.6-luna"),terra=await specialistQuote(state,turn.id,"gpt-5.6-terra");
    assert.notEqual(luna.quote.executionId,terra.quote.executionId);
    const responses=await Promise.all([specialistExecute(state,luna),specialistExecute(state,luna),specialistExecute(state,terra)]);
    for(const response of responses)assert.ok([200,202].includes(response.status),JSON.stringify(await response.clone().json())+" SQL: "+state.controls.lastDatabaseError);
    await state.drainBackground();assert.equal(state.calls.length,1);
    const rows=state.sqlite.prepare("SELECT task_id,status FROM assistant_specialist_tasks WHERE turn_id=?").all(turn.id);assert.equal(rows.length,1);assert.equal(rows[0].status,"completed",JSON.stringify(rows));
    const winner=rows[0].task_id,loser=winner===luna.quote.executionId?terra:luna,redirect=await specialistExecute(state,loser),body=await redirect.json();
    assert.equal(body.requestedExecutionId,loser.quote.executionId);assert.equal(body.reusedExecutionId,winner);assert.equal(body.winnerExecutionId,winner);
    assert.equal(body.quote.executionId,winner);assert.equal(body.result.reply,"PRIVATE_VERIFIED_SPECIALIST_REPLY");assert.equal(state.calls.length,1);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM budget_reservations").get().n,1);assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM cost_budget_reservations").get().n,1);
    const page=await state.request(endpoint()),listed=await page.json();assert.equal(listed.tasks[0].executionId,winner);
  }finally{await state.cleanup();}
});
for(const mode of["missing usage","numeric-string usage","transport unknown","malformed raw JSON"]){
  test("specialist consent: "+mode+" keeps exact hold and all recovery paths free",async()=>{
    const state=await specialistMockFixture({respond(payload){
      if(mode==="transport unknown")throw new TypeError("fixture connection lost after dispatch");
      if(mode==="malformed raw JSON")return new Response("{ unparseable raw",{status:200});
      return specialistRawResponse(payload,{usage:mode==="missing usage"?undefined:{input_tokens:"1000",output_tokens:300,total_tokens:1300}});
    }});
    try{
      const turn=await specialistFreeTurn(state),review=await specialistQuote(state,turn.id);assert.equal((await specialistExecute(state,review)).status,202);await state.drainBackground();
      assert.equal(state.calls.length,1);const first=consequentialReceipt(state,review.quote.executionId);assert.equal(first.execution.status,"uncertain",JSON.stringify(first));assert.equal(first.steps[0].status,"uncertain");
      assert.ok(first.balances.tokens.reserved>0);assert.ok(first.balances.cost.reserved>0);assert.equal(first.balances.tokens.used,0);assert.equal(first.balances.cost.used,0);
      const raw=state.sqlite.prepare("SELECT result_json FROM assistant_specialist_tasks WHERE task_id=?").get(review.quote.executionId).result_json;
      assert.equal(Boolean(JSON.parse(raw).rawReceipt),mode!=="transport unknown");
      const finances=adaptiveReentryFinancialState(state);
      for(const action of["retrieve","resume","quote","execute"]){
        const body=action==="quote"?{action,turnId:turn.id,model:"gpt-5.6-terra"}:{action,turnId:turn.id,executionId:review.quote.executionId,...(action!=="resume"?{approvedBindingHash:review.quote.bindingHash}:{})};
        const response=await specialistProtocolRequest(state,body),output=await response.json();assert.equal(response.status,200,JSON.stringify(output));assert.equal(output.quote.executionId,review.quote.executionId);assert.equal(output.result,undefined);
        assert.equal(output.task.submission,"uncertain");assert.equal(output.retainedResultUnavailable,undefined);
      }
      await state.drainBackground();assert.equal(state.calls.length,1);assert.deepEqual(adaptiveReentryFinancialState(state),finances);
    }finally{await state.cleanup();}
  });
}
for(const mode of["non-2xx valid usage","malformed structured reply","incomplete output","over-limit output usage"]){
  test("specialist consent: "+mode+" is truthfully charged before result validation",async()=>{
    const state=await specialistMockFixture({respond(payload){
      if(mode==="non-2xx valid usage")return new Response(JSON.stringify({id:"charged-error",model:payload.model,status:"failed",error:{message:"fixture paid failure"},usage:{input_tokens:1000,output_tokens:300,total_tokens:1300}}),{status:503,headers:{"content-type":"application/json"}});
      if(mode==="malformed structured reply")return specialistRawResponse(payload,{output:[{type:"message",id:"msg-invalid",role:"assistant",status:"completed",content:[{type:"output_text",text:"this is not valid JSON"}]}]});
      if(mode==="incomplete output")return specialistRawResponse(payload,{status:"incomplete"});
      return specialistRawResponse(payload,{usage:{input_tokens:1000,output_tokens:5000,total_tokens:6000}});
    }});
    try{
      const turn=await specialistFreeTurn(state),review=await specialistQuote(state,turn.id);assert.equal((await specialistExecute(state,review)).status,202);await state.drainBackground();
      const receipt=consequentialReceipt(state,review.quote.executionId);assert.equal(state.calls.length,1);assert.equal(receipt.steps[0].status,"settled",JSON.stringify(receipt));
      assert.equal(receipt.tokens[0].used_tokens,mode==="over-limit output usage"?6000:1300);assert.ok(receipt.cost[0].used_microusd>0);assert.equal(receipt.balances.tokens.reserved,0);assert.equal(receipt.balances.cost.reserved,0);
      assert.equal(receipt.execution.result_ref,null);const finance=adaptiveReentryFinancialState(state),recovered=await specialistRetrieve(state,review),body=await recovered.json();
      assert.equal(recovered.status,200,JSON.stringify(body));assert.ok(body.recoveryError);assert.equal(body.result,undefined);assert.equal(body.task.submission,"settled");
      const again=await specialistQuote(state,turn.id,"gpt-5.6-terra");assert.equal(again.quote.executionId,review.quote.executionId);
      assert.equal(state.calls.length,1);assert.deepEqual(adaptiveReentryFinancialState(state),finance);
    }finally{await state.cleanup();}
  });
}
test("specialist consent: unknown lost execute response is recoverable by existing task and cannot dispatch again",async()=>{
  const gate=Promise.withResolvers(),entered=Promise.withResolvers(),state=await specialistMockFixture({respond:async payload=>{entered.resolve();await gate.promise;return specialistRawResponse(payload);}});
  try{
    const turn=await specialistFreeTurn(state),review=await specialistQuote(state,turn.id);await specialistExecute(state,review);await entered.promise;
    const page=await state.request(endpoint()),body=await page.json();assert.equal(body.tasks[0].executionId,review.quote.executionId);assert.equal(body.tasks[0].bindingHash,review.quote.bindingHash);
    for(const action of["retrieve","resume"]){const response=await specialistProtocolRequest(state,{action,turnId:turn.id,executionId:review.quote.executionId,...(action==="retrieve"?{approvedBindingHash:review.quote.bindingHash}:{})});const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));assert.equal(value.result,undefined);assert.equal(value.task.submission,"submitting");assert.equal(value.retainedResultUnavailable,undefined);}
    assert.equal(state.calls.length,1);gate.resolve();await state.drainBackground();assert.equal(consequentialReceipt(state,review.quote.executionId).execution.status,"completed");
  }finally{gate.resolve();await state.cleanup();}
});

for(const cookie of[true,false])test("specialist consent: shared owner "+(cookie?"selected session":"cookie-free migrated custody")+" uses real tenant ledgers and private retention",async()=>{
  const state=await specialistMockFixture({shared:true});
  try{
    const headers=cookie?state.owner:Object.fromEntries(Object.entries(state.owner).filter(([key])=>key!=="cookie")),options={headers};
    const turn=await specialistFreeTurn(state,"specialist-turn-owner-"+cookie,"What should I do next?",options),review=await specialistQuote(state,turn.id,undefined,options);
    assert.equal(review.quote.workspaceId,state.organizationId);assert.equal(review.quote.canExecute,true,JSON.stringify(review));
    const response=await specialistExecute(state,review,options);assert.equal(response.status,202,JSON.stringify(await response.clone().json())+" SQL: "+state.controls.lastDatabaseError);
    await state.drainBackground();const task=state.sqlite.prepare("SELECT * FROM assistant_specialist_tasks WHERE task_id=?").get(review.quote.executionId);
    assert.equal(task.status,"completed",JSON.stringify(task)+" SQL: "+state.controls.lastDatabaseError);assert.equal(state.calls.length,1);
    const turnRow=state.sqlite.prepare("SELECT * FROM assistant_turns WHERE turn_id=?").get(turn.id);assert.equal(turnRow.organization_id,state.organizationId);assert.equal(turnRow.project_access_id,state.projectAccessId);
    for(const ref of[turnRow.user_content_ref,turnRow.assistant_content_ref,JSON.parse(task.result_json).rawReceipt.contentRef]){
      const resource=state.sqlite.prepare("SELECT * FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=?").get(ref),retention=state.sqlite.prepare("SELECT * FROM private_content_retention_scopes WHERE content_id=?").get(ref);
      assert.equal(resource.organization_id,state.organizationId);assert.equal(resource.owner_user_id,"assistant-owner");assert.equal(resource.actor_user_id,"assistant-owner");assert.equal(resource.visibility,"actor_private");
      assert.equal(retention.organization_id,state.organizationId);assert.equal(retention.project_access_id,state.projectAccessId);
    }
    for(const table of["budget_reservations","cost_budget_reservations"]){const ledger=state.sqlite.prepare("SELECT * FROM "+table+" WHERE correlation_id=?").get(task.task_id);const custody=state.sqlite.prepare("SELECT * FROM project_budget_reservation_scopes WHERE reservation_kind=? AND reservation_id=?").get(table==="budget_reservations"?"tokens":"usd",ledger.reservation_id);assert.equal(custody.organization_id,state.organizationId);assert.equal(custody.project_access_id,state.projectAccessId);assert.equal(custody.actor_user_id,"assistant-owner");assert.equal(ledger.owner_id,"assistant-owner");assert.equal(ledger.stream_id,"creative:assistant-owner");}
    const retained=await specialistRetrieve(state,review,options);assert.equal(retained.status,200,JSON.stringify(await retained.clone().json()));assert.equal((await retained.json()).result.reply,"PRIVATE_VERIFIED_SPECIALIST_REPLY");
    const foreign=await specialistRetrieve(state,review,{headers:state.viewer});assert.equal(foreign.status,404);assert.equal((await foreign.json()).result,undefined);
  }finally{await state.cleanup();}
});
test("specialist consent: existing paid reader recovers after source, model, key, budget and month change",async()=>{
  const state=await assistantR2DepthFixture({shared:true});
  try{
    state.sqlite.prepare("UPDATE users SET role='creator' WHERE user_id='assistant-viewer'").run();
    state.sqlite.prepare("UPDATE project_memberships SET role='editor' WHERE user_id='assistant-viewer' AND project_access_id=?").run(state.projectAccessId);
    const options={headers:state.viewer},turn=await specialistFreeTurn(state,"specialist-turn-editor","What should I do next?",options),review=await specialistQuote(state,turn.id,undefined,options);
    const approved=await specialistExecute(state,review,options);assert.equal(approved.status,202,JSON.stringify(await approved.clone().json()));await state.drainBackground();assert.equal(state.calls.length,1);
    const old=consequentialReceipt(state,review.quote.executionId);assert.equal(old.execution.status,"completed",JSON.stringify(old));assert.equal(old.cost[0].used_microusd,560);
    appendFixtureEvents(state.sqlite,"creative:assistant-owner",[["BlockPropertyEdited",{project_id:"project-atmosphere",document_id:"doc-atmosphere",block_id:"block-direction",property_path:"text",new_value:"A new current source that was never approved."}]]);
    state.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id='assistant-viewer'").run();state.sqlite.prepare("UPDATE project_memberships SET role='viewer' WHERE user_id='assistant-viewer' AND project_access_id=?").run(state.projectAccessId);
    state.sqlite.prepare("UPDATE cost_budget_counters SET hard_limit_microusd=0").run();delete state.env.OPENAI_API_KEY;state.env.FORMA_ASSISTANT_ALLOWED_MODELS="";state.env.FORMA_ASSISTANT_PROVIDER_USER_IDS="";
    const oldHeaders=options.headers,{cookie,...identity}=oldHeaders,oldContextId=decodeURIComponent(cookie.slice(cookie.indexOf("=")+1));
    const originalSession=state.sqlite.prepare("SELECT expires_at FROM project_context_sessions WHERE context_id=?").get(oldContextId);
    const clock=consequentialDbClock(state),period=review.quote.period,nextMonth=new Date(Date.UTC(Number(period.slice(0,4)),Number(period.slice(5,7)),1)).toISOString();
    const simulatedNow=new Date(Math.max(Date.parse(nextMonth),Date.parse(originalSession.expires_at)+1)).toISOString();clock.set(simulatedNow);
    try{
      const finance=adaptiveReentryFinancialState(state);
      const expired=await specialistRetrieve(state,review,{headers:oldHeaders}),expiredBody=await expired.json();
      assert.ok([403,404].includes(expired.status),JSON.stringify(expiredBody));assert.equal(expiredBody.result,undefined);assert.equal(expiredBody.unusedExecution,undefined);
      // Renew through the actual route; align only the new selected reader with the simulated DB clock.
      const renewed=await state.request("/api/workspaces/"+state.organizationId+"/projects/"+state.projectAccessId+"/context",{method:"POST",headers:identity});
      assert.equal(renewed.status,200,JSON.stringify(await renewed.clone().json()));
      const renewedCookie=renewed.headers.get("set-cookie").split(";")[0],newContextId=decodeURIComponent(renewedCookie.slice(renewedCookie.indexOf("=")+1));assert.notEqual(newContextId,oldContextId);
      const newExpiry=new Date(Date.parse(simulatedNow)+8*60*60_000).toISOString();
      assert.equal(state.sqlite.prepare("UPDATE project_context_sessions SET expires_at=? WHERE context_id=? AND principal_user_id=? AND revoked_at IS NULL").run(newExpiry,newContextId,"assistant-viewer").changes,1);
      assert.equal(state.sqlite.prepare("SELECT expires_at FROM project_context_sessions WHERE context_id=?").get(oldContextId).expires_at,originalSession.expires_at);assert.ok(originalSession.expires_at<simulatedNow);
      options.headers={...identity,cookie:renewedCookie};
      for(const action of["retrieve","resume","quote"]){
        const response=await specialistProtocolRequest(state,action==="quote"?{action,turnId:turn.id,model:"gpt-5.6-sol"}:{action,turnId:turn.id,executionId:review.quote.executionId,...(action==="retrieve"?{approvedBindingHash:review.quote.bindingHash}:{})},options),result=await response.json();
        assert.equal(response.status,200,JSON.stringify(result));assert.equal(result.result.reply,"PRIVATE_VERIFIED_SPECIALIST_REPLY");assert.equal(result.quote.executionId,review.quote.executionId);assert.equal(result.quote.period,period);assert.equal(result.quote.canExecute,false);assert.ok([result.turn.proposal,...(result.turn.proposals??[])].filter(Boolean).every(proposal=>proposal.kind==="navigate"));
      }
      assert.deepEqual(adaptiveReentryFinancialState(state),finance);assert.equal(state.calls.length,1);
    }finally{clock.close();}
  }finally{await state.cleanup();}
});
for(const[seam,kind,pattern]of[["step claim","run",/^\s*UPDATE consequential_execution_steps SET status='reserved'/u],["token INSERT","batch",/^\s*INSERT OR IGNORE INTO budget_reservations\b/u],["cost INSERT","batch",/^\s*INSERT OR IGNORE INTO cost_budget_reservations\b/u],["begin","run",/^\s*UPDATE consequential_execution_steps SET status='submitting'/u],["final read","first",/^\s*SELECT MIN\(execution\.expires_at,task\.lease_expires_at/u]]){
  test("specialist consent: cancellation before "+seam+" releases only proven-unused holds",{timeout:15_000},async()=>{
    const state=await specialistMockFixture();let gate;
    try{
      const turn=await specialistFreeTurn(state),review=await specialistQuote(state,turn.id);gate=gateConsequentialDb(state,kind,pattern);
      const response=await specialistExecute(state,review);assert.equal(response.status,202,JSON.stringify(await response.clone().json()));await gate.entered;
      const canceled=await state.request(taskEndpoint(review.quote.executionId,"cancel"),{method:"POST"});assert.equal(canceled.status,200,JSON.stringify(await canceled.clone().json()));
      gate.release();await state.drainBackground();gate.restore();gate=null;
      assert.equal(state.calls.length,0);const receipt=consequentialReceipt(state,review.quote.executionId);assert.equal(receipt.steps[0].status,"not-submitted",JSON.stringify(receipt));
      assert.equal(receipt.balances.tokens.reserved,0);assert.equal(receipt.balances.cost.reserved,0);assert.equal(receipt.balances.tokens.used,0);assert.equal(receipt.balances.cost.used,0);
      const read=await specialistRetrieve(state,review);assert.equal(read.status,200);assert.equal((await read.json()).task.submission,"not-submitted");assert.equal(state.calls.length,0);
    }finally{gate?.release();gate?.restore();await state.cleanup();}
  });
}
test("specialist consent: cancellation after submit keeps holds then accepts verified late response without re-POST",{timeout:15_000},async()=>{
  const entered=Promise.withResolvers(),release=Promise.withResolvers(),state=await specialistMockFixture({respond:async payload=>{entered.resolve();await release.promise;return specialistRawResponse(payload);}});
  try{
    const turn=await specialistFreeTurn(state),review=await specialistQuote(state,turn.id);await specialistExecute(state,review);await entered.promise;
    const canceled=await state.request(taskEndpoint(review.quote.executionId,"cancel"),{method:"POST"});assert.equal(canceled.status,200);const before=consequentialReceipt(state,review.quote.executionId);
    assert.equal(before.steps[0].status,"uncertain");assert.ok(before.balances.tokens.reserved>0);assert.ok(before.balances.cost.reserved>0);
    release.resolve();await state.drainBackground();const after=consequentialReceipt(state,review.quote.executionId);assert.equal(after.execution.status,"completed",JSON.stringify(after));assert.equal(after.steps[0].status,"settled");
    assert.equal(after.balances.tokens.reserved,0);assert.equal(after.balances.cost.reserved,0);assert.ok(after.balances.cost.used>0);assert.equal(state.calls.length,1);
    const task=state.sqlite.prepare("SELECT * FROM assistant_specialist_tasks WHERE task_id=?").get(review.quote.executionId);assert.equal(task.status,"completed");assert.ok(JSON.parse(task.result_json).rawReceipt);
    const again=await state.request(taskEndpoint(review.quote.executionId,"cancel"),{method:"POST"});assert.equal(again.status,200);assert.equal((await again.json()).result.reply,"PRIVATE_VERIFIED_SPECIALIST_REPLY");assert.equal(state.calls.length,1);assert.deepEqual(consequentialReceipt(state,review.quote.executionId),after);
  }finally{release.resolve();await state.cleanup();}
});

test("specialist consent: full protected source, aliases, locale and approved conversation remain exact",async()=>{
  const state=await specialistMockFixture(),stream="creative:dev-local-creative",exact="  REVENUE  IS NOT PROOF\nNever fabricate a claim.  ",full="A complete protected requirement. ".repeat(55)+"CRITICAL_UNTRUNCATED_TAIL";
  try{
    appendFixtureEvents(state.sqlite,stream,[
      ...Array.from({length:22},(_,index)=>["BlockCreated",{project_id:"project-atmosphere",document_id:"doc-atmosphere",block_id:"specialist-source-"+index,type:"subject",handle:"Source "+index,position:"z"+index.toString().padStart(2,"0"),properties:{text:"Exact authored fact "+index,weight:1}}]),
      ["BlockCreated",{project_id:"project-atmosphere",document_id:"doc-atmosphere",block_id:"specialist-protected",type:"direction",handle:"Protected exact context",position:"zzz",properties:{text:full,intent:"prohibit",weight:1,exact_text:exact,exact_placements:["opening","closing"],protected_phrases:[{text:exact,placement:"opening_and_closing"}]}}],
      ["BlockLocked",{project_id:"project-atmosphere",document_id:"doc-atmosphere",block_id:"specialist-protected"}],
      ["BlockCreated",{project_id:"project-atmosphere",document_id:"doc-atmosphere",block_id:"specialist-inactive",type:"direction",handle:"Inactive",position:"zzzz",properties:{text:"INACTIVE_SOURCE_MUST_NOT_LEAK",active:false}}],
      ["DocumentCreated",{project_id:"project-atmosphere",document_id:"other-specialist-document",title:"Other authorized document"}],
      ["BlockCreated",{project_id:"project-atmosphere",document_id:"other-specialist-document",block_id:"specialist-other-doc",type:"direction",handle:"Other document",position:"a",properties:{text:"OTHER_DOCUMENT_MUST_NOT_LEAK"}}],
    ]);
    const old=await specialistFreeTurn(state,"specialist-history-old","The earlier creative question"),longReply="An earlier complete specialist reply. ".repeat(70)+"HISTORY_UNTRUNCATED_TAIL";
    state.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id=(SELECT assistant_content_ref FROM assistant_turns WHERE turn_id=?)").run(longReply,old.id);
    const turn=await specialistFreeTurn(state,"specialist-history-current","Answer this exact saved question.",{locale:"ja"}),review=await specialistQuote(state,turn.id),payload=review.quote.privateInput.providerRequest,view=JSON.parse(payload.input);
    assert.ok(view.blocks.length>16);const protectedBlock=view.blocks.find(block=>block.properties?.text===full);assert.ok(protectedBlock);assert.equal(protectedBlock.properties.text,full);
    assert.equal(protectedBlock.properties.exact_text,exact);assert.deepEqual(protectedBlock.properties.exact_placements,["opening","closing"]);assert.deepEqual(protectedBlock.properties.protected_phrases,[{text:exact,placement:"opening_and_closing"}]);assert.equal(protectedBlock.locked,true);
    assert.match(protectedBlock.id,/^decision_\d+$/u);assert.doesNotMatch(payload.input,/INACTIVE_SOURCE_MUST_NOT_LEAK|OTHER_DOCUMENT_MUST_NOT_LEAK|specialist-protected|specialist-source-21/u);
    assert.equal(view.recent_conversation.find(item=>item.text===longReply).text,longReply);assert.equal(view.message,turn.user);assert.match(payload.instructions,/\(ja\)/u);assert.deepEqual(review.originalRequest.conversationTurnIds,[old.id,turn.id]);
    await specialistFreeTurn(state,"specialist-history-newer","NEWER_UNAPPROVED_MESSAGE_NOT_IN_ORIGINAL_REQUEST");
    const before=adaptiveAuthoredCount(state),response=await specialistExecute(state,review);assert.equal(response.status,202,JSON.stringify(await response.clone().json()));await state.drainBackground();
    assert.equal(state.calls.length,1);assert.deepEqual(state.calls[0].payload,payload);assert.doesNotMatch(state.calls[0].payload.input,/NEWER_UNAPPROVED_MESSAGE/u);assert.equal(adaptiveAuthoredCount(state),before);
  }finally{await state.cleanup();}
});
for(const route of["/","/projects","/studio/project"])test("specialist consent: free "+route+" guidance requires an explicit document before purchase",async()=>{
  const state=await specialistMockFixture();
  try{
    const options={route},turn=await specialistFreeTurn(state,"specialist-scope-"+route.replaceAll("/","-")+"-turn","What should I do next?",options);
    const review=await specialistProtocolRequest(state,{action:"quote",turnId:turn.id},options);assert.equal(review.status,409,JSON.stringify(await review.clone().json()));assert.equal((await review.json()).error,"assistant_source_document_required");
    assert.equal(state.calls.length,0);assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM assistant_specialist_tasks").get().n,0);assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM budget_reservations").get().n,0);
  }finally{await state.cleanup();}
});
function specialistCanvasEvents(state){
  appendFixtureEvents(state.sqlite,state.owner?"creative:assistant-owner":"creative:dev-local-creative",[
    ["CanvasCreated",{project_id:"project-atmosphere",canvas_id:"specialist-exact-board",name:"Exact specialist board"}],
    ["CanvasItemPlaced",{project_id:"project-atmosphere",canvas_id:"specialist-exact-board",item_id:"specialist-selected-document",source_kind:"document",source_id:"doc-atmosphere",title:"Exact document",frame:{x:0,y:0,w:240,h:160,z:"a0"}}],
    ["DocumentCreated",{project_id:"project-atmosphere",document_id:"specialist-second-document",title:"Second document"}],
    ["CanvasItemPlaced",{project_id:"project-atmosphere",canvas_id:"specialist-exact-board",item_id:"specialist-selected-second",source_kind:"document",source_id:"specialist-second-document",title:"Other selected document",frame:{x:250,y:0,w:240,h:160,z:"a1"}}],
  ]);
  return{route:"/canvas/specialist-exact-board/exact-specialist-board",selected:["specialist-selected-document"]};
}
test("specialist consent: Canvas retains exact selected document and never chooses a first document",async()=>{
  const state=await specialistMockFixture();
  try{
    const options=specialistCanvasEvents(state),turn=await specialistFreeTurn(state,"specialist-canvas-exact","Review this selected document.",options),review=await specialistQuote(state,turn.id,undefined,options);
    assert.equal(review.quote.canvasId,"specialist-exact-board");assert.equal(review.quote.documentId,"doc-atmosphere");assert.deepEqual(review.originalRequest.selectedItemIds,options.selected);assert.equal(review.originalRequest.route,options.route);
    const approved=await specialistExecute(state,review,options);assert.equal(approved.status,202,JSON.stringify(await approved.clone().json()));await state.drainBackground();assert.equal(state.calls.length,1);
    const retrieved=await specialistRetrieve(state,review,options);assert.equal(retrieved.status,200);assert.equal((await retrieved.json()).originalRequest.documentId,"doc-atmosphere");
    for(const selected of[[],["specialist-selected-document","specialist-selected-second"],["specialist-selected-document","missing-selection"]]){
      const selection={...options,selected},id="specialist-canvas-ambiguous-"+selected.join("-").slice(-50),other=await specialistFreeTurn(state,id,"Review this page.",selection),denied=await specialistProtocolRequest(state,{action:"quote",turnId:other.id},selection);
      assert.equal(denied.status,409,JSON.stringify(await denied.clone().json()));assert.match((await denied.json()).error,/assistant_source_document_required|assistant_selected_source_changed/u);
    }
    assert.equal(state.calls.length,1);assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM assistant_specialist_tasks").get().n,1);
  }finally{await state.cleanup();}
});
for(const change of["source","permission","board"]){
  test("specialist consent: "+change+" changing at actual begin prevents the approved POST",{timeout:15_000},async()=>{
    const state=await specialistMockFixture();let restore;
    try{
      const options=change==="board"?specialistCanvasEvents(state):{},turn=await specialistFreeTurn(state,"specialist-dispatch-"+change,"What should I do next?",options),review=await specialistQuote(state,turn.id,undefined,options);
      restore=interceptConsequentialDb(state,"run",/^\s*UPDATE consequential_execution_steps SET status='submitting'/u,()=>{
        if(change==="permission")state.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id='dev-local-creative'").run();
        else appendFixtureEvents(state.sqlite,"creative:dev-local-creative",[change==="board"?["CanvasRemoved",{project_id:"project-atmosphere",canvas_id:"specialist-exact-board"}]:["BlockPropertyEdited",{project_id:"project-atmosphere",document_id:"doc-atmosphere",block_id:"block-direction",property_path:"text",new_value:"Source changed during admission."}]]);
      });
      const approved=await specialistExecute(state,review,options);assert.equal(approved.status,202);await state.drainBackground();const receipt=consequentialReceipt(state,review.quote.executionId);
      assert.equal(state.calls.length,0);assert.equal(receipt.steps[0].status,"not-submitted",JSON.stringify(receipt));assert.equal(receipt.balances.tokens.reserved,0);assert.equal(receipt.balances.cost.reserved,0);
    }finally{restore?.();await state.cleanup();}
  });
}
for(const boundary of["claim","begin","final read"])for(const change of["expiry","month"]){
  test("specialist consent: live DB "+change+" at "+boundary+" defeats captured JS time",{timeout:15_000},async()=>{
    const state=await specialistMockFixture();let restore,clock;
    try{
      const turn=await specialistFreeTurn(state),review=await specialistQuote(state,turn.id);clock=consequentialDbClock(state);
      const nextMonth=new Date(Date.UTC(Number(review.quote.period.slice(0,4)),Number(review.quote.period.slice(5,7)),1)),later=change==="month"?nextMonth.toISOString():new Date(Date.parse(review.quote.expiresAt)+1).toISOString();
      if(change==="month")state.sqlite.prepare("UPDATE consequential_executions SET expires_at=? WHERE execution_id=?").run(new Date(nextMonth.getTime()+86_400_000).toISOString(),review.quote.executionId);
      restore=interceptConsequentialDb(state,boundary==="claim"?"batch":boundary==="begin"?"run":"first",boundary==="claim"?/^\s*UPDATE consequential_executions SET status='reserved'/u:boundary==="begin"?/^\s*UPDATE consequential_execution_steps SET status='submitting'/u:/^\s*SELECT MIN\(execution\.expires_at,task\.lease_expires_at/u,()=>clock.set(later));
      const response=await specialistExecute(state,review);assert.equal(response.status,boundary==="claim"?409:202,JSON.stringify(await response.clone().json()));await state.drainBackground();
      const receipt=consequentialReceipt(state,review.quote.executionId);assert.equal(state.calls.length,0);assert.equal(receipt.balances.tokens.reserved,0);assert.equal(receipt.balances.cost.reserved,0);
      assert.equal(receipt.steps[0].status,boundary==="claim"?"quoted":"not-submitted");
      if(boundary==="claim"){assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM assistant_specialist_tasks").get().n,0);assert.equal(receipt.tokens.length,0);assert.equal(receipt.cost.length,0);}
    }finally{restore?.();clock?.close();await state.cleanup();}
  });
}

for(const source of["owned","owned_or_licensed","governed-upstream"])for(const seam of["begin","final read response"]){
  test("specialist consent: "+source+" deadline at "+seam+" blocks without dropping protected source",{timeout:15_000},async()=>{
    const state=await specialistMockFixture({shared:source.startsWith("governed")}),nativeNow=Date.now;let restore,clock;
    try{
      const validUntil=new Date(Date.now()+60_000).toISOString(),later=new Date(Date.now()+300_000).toISOString();
      if(source.startsWith("governed"))await seedAdaptiveRightsDeadline(state,source,validUntil,later);
      else appendFixtureEvents(state.sqlite,"creative:dev-local-creative",[["BlockCreated",{project_id:"project-atmosphere",document_id:"doc-atmosphere",block_id:"specialist-licensed",type:"direction",handle:"Licensed exact source",position:"z-license",properties:{text:"FULL_PROTECTED_LICENSED_TAIL",intent:"prohibit",rights_class:source,license_expires_at:validUntil,rights_expires_at:later}}]]);
      const turn=await specialistFreeTurn(state),review=await specialistQuote(state,turn.id);assert.equal(review.quote.privateInput.sourceRightsValidUntil,validUntil);
      assert.match(review.quote.privateInput.providerRequest.input,source.startsWith("governed")?/protected contractual tail/u:/FULL_PROTECTED_LICENSED_TAIL/u);
      clock=consequentialDbClock(state);
      restore=interceptConsequentialDb(state,seam==="begin"?"run":"first",seam==="begin"?/^\s*UPDATE consequential_execution_steps SET status='submitting'/u:/^\s*SELECT MIN\(execution\.expires_at,task\.lease_expires_at/u,()=>{
        clock.set(validUntil);if(seam==="final read response")Date.now=()=>Date.parse(validUntil);
      },seam==="begin"?"before":"after");
      const approved=await specialistExecute(state,review);assert.equal(approved.status,202,JSON.stringify(await approved.clone().json()));await state.drainBackground();
      assert.equal(state.calls.length,0);const receipt=consequentialReceipt(state,review.quote.executionId),balances=consequentialBalances(state,source.startsWith("governed")?"assistant-owner":"dev-local-creative");
      assert.equal(receipt.steps[0].status,"not-submitted",JSON.stringify(receipt));assert.deepEqual(balances,{tokens:{used:0,reserved:0},cost:{used:0,reserved:0}});
    }finally{Date.now=nativeNow;restore?.();clock?.close();await state.cleanup();}
  });
}
for(const mutation of["upstream revoked","package redacted"])test("specialist consent: governed "+mutation+" at final dispatch checks the independent stream",{timeout:15_000},async()=>{
  const state=await specialistMockFixture({shared:true});let restore;
  try{
    const source=await seedAdaptiveSeparateProjectGoverned(state),turn=await specialistFreeTurn(state),review=await specialistQuote(state,turn.id);
    assert.equal(review.quote.canExecute,true);assert.doesNotMatch(JSON.stringify(review),/dispatchDependencies|sourceRightsDispatchProof/u);
    restore=interceptConsequentialDb(state,"first",/^\s*SELECT MIN\(execution\.expires_at,task\.lease_expires_at/u,()=>{
      const head=state.sqlite.prepare("SELECT MAX(sequence) AS head FROM events WHERE stream_id='creative:assistant-owner'").get().head;
      if(mutation==="upstream revoked")appendFixtureEvents(state.sqlite,source.sourceStream,[["BlockPropertyEdited",{project_id:source.sourceProjectId,document_id:source.sourceDocumentId,block_id:source.sourceBlockId,property_path:"rights_revoked",new_value:true}]]);
      else state.sqlite.prepare("UPDATE organization_context_package_contents SET redacted_at=? WHERE version_id=?").run(new Date().toISOString(),source.versionId);
      assert.equal(state.sqlite.prepare("SELECT MAX(sequence) AS head FROM events WHERE stream_id='creative:assistant-owner'").get().head,head);
    });
    const accepted=await specialistExecute(state,review);assert.equal(accepted.status,202,JSON.stringify(await accepted.clone().json()));await state.drainBackground();
    assert.equal(state.calls.length,0);assert.equal(consequentialReceipt(state,review.quote.executionId).steps[0].status,"not-submitted");assert.deepEqual(consequentialBalances(state,"assistant-owner"),{tokens:{used:0,reserved:0},cost:{used:0,reserved:0}});
  }finally{restore?.();await state.cleanup();}
});
test("specialist consent: same-owner different-project governed source remains a valid positive dispatch",async()=>{
  const state=await specialistMockFixture({shared:true});
  try{
    await seedAdaptiveSeparateProjectGoverned(state,{sameOwner:true});const turn=await specialistFreeTurn(state),review=await specialistQuote(state,turn.id);
    const accepted=await specialistExecute(state,review);assert.equal(accepted.status,202,JSON.stringify(await accepted.clone().json()));await state.drainBackground();assert.equal(state.calls.length,1);
    assert.equal(consequentialReceipt(state,review.quote.executionId).execution.status,"completed");
  }finally{await state.cleanup();}
});
test("specialist consent: private raw response is retained before usage accounting",async()=>{
  const state=await specialistMockFixture();let restore,observed=false;
  try{
    const turn=await specialistFreeTurn(state),review=await specialistQuote(state,turn.id);
    restore=interceptConsequentialDb(state,"run",/^\s*UPDATE consequential_execution_steps SET status='usage-recorded'/u,()=>{
      const task=state.sqlite.prepare("SELECT result_json FROM assistant_specialist_tasks WHERE task_id=?").get(review.quote.executionId),pointer=JSON.parse(task.result_json).rawReceipt;
      assert.ok(pointer?.contentRef);const raw=state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=? AND kind='provider-response' AND redacted_at IS NULL").get(pointer.contentRef);
      assert.ok(raw);const receipt=JSON.parse(raw.content),body=JSON.parse(receipt.responseBody);assert.equal(body.usage.total_tokens,1300);assert.equal(receipt.executionId,review.quote.executionId);observed=true;
    });
    await specialistExecute(state,review);await state.drainBackground();assert.equal(observed,true);assert.equal(state.calls.length,1);assert.equal(consequentialReceipt(state,review.quote.executionId).execution.status,"completed");
  }finally{restore?.();await state.cleanup();}
});
test("specialist consent: canonical and copied-reply crash windows recover free and atomically",async()=>{
  const state=await specialistMockFixture();let restore;
  try{
    const turn=await specialistFreeTurn(state),review=await specialistQuote(state,turn.id);
    restore=interceptConsequentialDb(state,"run",/^\s*UPDATE consequential_executions SET status='completed'/u,()=>{throw new Error("fixture canonical pointer interruption");});
    await specialistExecute(state,review);await state.drainBackground();restore();restore=null;
    const before=consequentialReceipt(state,review.quote.executionId);assert.equal(before.execution.result_ref,null);assert.equal(before.steps[0].status,"settled");assert.equal(state.calls.length,1);
    const financial=adaptiveReentryFinancialState(state);state.controls.failAssistantActionCommit=true;
    const failedCopy=await specialistRetrieve(state,review),pending=await failedCopy.json();assert.equal(failedCopy.status,200,JSON.stringify(pending));assert.equal(pending.result.reply,"PRIVATE_VERIFIED_SPECIALIST_REPLY");assert.equal(pending.materializationPending,true);
    assert.ok(consequentialReceipt(state,review.quote.executionId).execution.result_ref);
    const oldAnswer=state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=(SELECT assistant_content_ref FROM assistant_turns WHERE turn_id=?)").get(turn.id).content;assert.notEqual(oldAnswer,"PRIVATE_VERIFIED_SPECIALIST_REPLY");
    const after=await specialistRetrieve(state,review),complete=await after.json();assert.equal(after.status,200,JSON.stringify(complete));assert.equal(complete.materializationPending,false);assert.equal(complete.turn.reply.text,"PRIVATE_VERIFIED_SPECIALIST_REPLY");
    assert.equal(state.calls.length,1);assert.deepEqual(adaptiveReentryFinancialState(state),financial);assert.equal(consequentialReceipt(state,review.quote.executionId).cost[0].used_microusd,before.cost[0].used_microusd);
  }finally{restore?.();await state.cleanup();}
});
for(const source of["canonical","consent","answer","raw custody"])test("specialist consent: withdrawn "+source+" private custody is never exposed or recreated",async()=>{
  const state=await specialistMockFixture({shared:true});let restore;
  try{
    const turn=await specialistFreeTurn(state),review=await specialistQuote(state,turn.id);
    if(source==="raw custody")restore=interceptConsequentialDb(state,"run",/^\s*UPDATE consequential_executions SET status='completed'/u,()=>{throw new Error("fixture leave raw only");});
    await specialistExecute(state,review);await state.drainBackground();restore?.();restore=null;
    const execution=state.sqlite.prepare("SELECT * FROM consequential_executions WHERE execution_id=?").get(review.quote.executionId),task=state.sqlite.prepare("SELECT * FROM assistant_specialist_tasks WHERE task_id=?").get(review.quote.executionId),turnRow=state.sqlite.prepare("SELECT * FROM assistant_turns WHERE turn_id=?").get(turn.id);
    const ref=source==="canonical"?execution.result_ref:source==="consent"?execution.consent_ref:source==="answer"?turnRow.assistant_content_ref:JSON.parse(task.result_json).rawReceipt.contentRef;
    assert.ok(ref);if(source==="raw custody")state.sqlite.prepare("UPDATE private_content_retention_scopes SET project_id='wrong-current-custody' WHERE content_id=?").run(ref);else state.sqlite.prepare("UPDATE private_content SET content='',redacted_at=? WHERE content_id=?").run(new Date().toISOString(),ref);
    const finance=adaptiveReentryFinancialState(state),privateCount=state.sqlite.prepare("SELECT COUNT(*) AS n FROM private_content").get().n;
    const returned=await specialistRetrieve(state,review),body=await returned.json();assert.equal(body.result,undefined);assert.doesNotMatch(JSON.stringify(body),/PRIVATE_VERIFIED_SPECIALIST_REPLY/u);
    if(source==="canonical"){assert.equal(body.retainedResultUnavailable,true);assert.equal(body.recoveryError,"assistant_result_unavailable");}
    if(source==="consent"||source==="answer"){assert.equal(returned.status,404);assert.equal(body.retentionUnavailable,true);}
    if(source!=="raw custody"){
      const page=await state.request(endpoint(),{headers:state.owner}),view=await page.json();assert.equal(page.status,200,JSON.stringify(view));assert.doesNotMatch(JSON.stringify(view.turns),/PRIVATE_VERIFIED_SPECIALIST_REPLY/u);
    }
    await state.drainBackground();assert.equal(state.calls.length,1);assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM private_content").get().n,privateCount);assert.deepEqual(adaptiveReentryFinancialState(state),finance);
    if(source!=="raw custody")assert.equal(state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(ref).content,"");
  }finally{restore?.();await state.cleanup();}
});
test("specialist consent: oversized complete source fails free instead of silently trimming",async()=>{
  const state=await specialistMockFixture();
  try{
    appendFixtureEvents(state.sqlite,"creative:dev-local-creative",[["BlockCreated",{project_id:"project-atmosphere",document_id:"doc-atmosphere",block_id:"specialist-overflow",type:"direction",handle:"Required long source",position:"z",properties:{text:"OVERFLOW".repeat(20_000),intent:"prohibit"}}]]);
    const turn=await specialistFreeTurn(state),response=await specialistProtocolRequest(state,{action:"quote",turnId:turn.id});assert.equal(response.status,413,JSON.stringify(await response.clone().json()));assert.equal(state.calls.length,0);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM assistant_specialist_tasks").get().n,0);assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM budget_reservations").get().n,0);
  }finally{await state.cleanup();}
});

for(const seam of["begin","final read response"])test("specialist consent: original selected session expiry at "+seam+" prevents dispatch",async()=>{
  const state=await specialistMockFixture({shared:true}),nativeNow=Date.now;let restore,clock;
  try{
    const expiresAt=new Date(Date.now()+45_000).toISOString();state.sqlite.prepare("UPDATE project_context_sessions SET expires_at=? WHERE principal_user_id='assistant-owner'").run(expiresAt);
    const turn=await specialistFreeTurn(state),review=await specialistQuote(state,turn.id);clock=consequentialDbClock(state);
    restore=interceptConsequentialDb(state,seam==="begin"?"run":"first",seam==="begin"?/^\s*UPDATE consequential_execution_steps SET status='submitting'/u:/^\s*SELECT MIN\(execution\.expires_at,task\.lease_expires_at/u,()=>{clock.set(expiresAt);if(seam==="final read response")Date.now=()=>Date.parse(expiresAt);},seam==="begin"?"before":"after");
    const admitted=await specialistExecute(state,review);assert.equal(admitted.status,202,JSON.stringify(await admitted.clone().json()));await state.drainBackground();assert.equal(state.calls.length,0);assert.equal(consequentialReceipt(state,review.quote.executionId).steps[0].status,"not-submitted");
    assert.deepEqual(consequentialBalances(state,"assistant-owner"),{tokens:{used:0,reserved:0},cost:{used:0,reserved:0}});
  }finally{Date.now=nativeNow;restore?.();clock?.close();await state.cleanup();}
});
test("specialist consent: proven-unsubmitted signed queue waits for explicit execute, never GET or resume",async()=>{
  const state=await specialistMockFixture();
  try{
    const turn=await specialistFreeTurn(state),review=await specialistQuote(state,turn.id);state.controls.skipAssistantTaskClaimOnce=true;
    assert.equal((await specialistExecute(state,review)).status,202);await state.drainBackground();assert.equal(state.calls.length,0);
    const task=state.sqlite.prepare("SELECT * FROM assistant_specialist_tasks WHERE task_id=?").get(review.quote.executionId);assert.equal(task.status,"queued");assert.equal(consequentialReceipt(state,task.task_id).tokens.length,0);
    const financial=adaptiveReentryFinancialState(state);assert.equal((await state.request(endpoint())).status,200);
    for(const action of["retrieve","resume"]){const response=await specialistProtocolRequest(state,{action,turnId:turn.id,executionId:task.task_id,...(action==="retrieve"?{approvedBindingHash:review.quote.bindingHash}:{})});assert.equal(response.status,200);const body=await response.json();assert.equal(body.task.submission,"not-submitted");assert.equal(body.task.canExecute,true);assert.equal(body.quote.canExecute,true);}
    await state.drainBackground();assert.equal(state.calls.length,0);assert.deepEqual(adaptiveReentryFinancialState(state),financial);
    assert.equal((await specialistExecute(state,review)).status,202);await state.drainBackground();assert.equal(state.calls.length,1);assert.equal(consequentialReceipt(state,task.task_id).execution.status,"completed");
  }finally{await state.cleanup();}
});
for(const status of["queued","running"])test("specialist consent: unsigned legacy "+status+" is parked without retry or invented no-charge release",async()=>{
  const state=await specialistMockFixture();
  try{
    const turn=await specialistFreeTurn(state),row=state.sqlite.prepare("SELECT * FROM assistant_turns WHERE turn_id=?").get(turn.id),id="legacy-unsigned-"+status,correlation="assistant-specialist:dev-local-creative:"+turn.id,now=new Date().toISOString();
    const token=await reserveBudget(state.env,"dev-local-creative",12000,{reservationId:id+"-tokens",streamId:"creative:dev-local-creative",correlationId:correlation,operation:"assistant-specialist:page-guidance:gpt-5.6-luna"});assert.equal(token.ok,true);
    const cost=await reserveCostBudget(state.env,"dev-local-creative",4000,{reservationId:id+"-cost",maximumMicrousd:4000,allowUserOverage:false,streamId:"creative:dev-local-creative",correlationId:correlation,operation:"assistant-specialist:page-guidance:gpt-5.6-luna",period:token.period});assert.equal(cost.ok,true);
    assert.equal(await claimCostBudgetReservation(state.env,"dev-local-creative",id+"-cost"),true);
    state.sqlite.prepare("INSERT INTO assistant_specialist_tasks(task_id,actor_user_id,scope_key,turn_id,organization_id,project_access_id,project_id,document_id,route_family,task_kind,selected_model,token_reservation_id,cost_reservation_id,estimated_microusd,maximum_input_tokens,maximum_output_tokens,locale,permission_epoch,status,error_code,created_at,updated_at,started_at,completed_at,lease_expires_at,provider_submitted,result_json) VALUES(?,?,?,?,NULL,NULL,'project-atmosphere','doc-atmosphere','/document/:document','page-guidance','gpt-5.6-luna',?,?,4000,10400,1600,'en',?,?,NULL,?,?,?,NULL,?,1,NULL)")
      .run(id,"dev-local-creative",row.scope_key,turn.id,id+"-tokens",id+"-cost",row.permission_epoch,status,now,now,now,"2000-01-01T00:00:00.000Z");
    const before=adaptiveReentryFinancialState(state),page=await state.request(endpoint());assert.equal(page.status,200);await state.drainBackground();
    const parked=state.sqlite.prepare("SELECT * FROM assistant_specialist_tasks WHERE task_id=?").get(id);assert.equal(parked.status,"needs-review");assert.equal(parked.error_code,"assistant_legacy_approval_required");assert.equal(state.calls.length,0);assert.deepEqual(adaptiveReentryFinancialState(state),before);
    const quote=await specialistProtocolRequest(state,{action:"quote",turnId:turn.id});assert.equal(quote.status,409);assert.equal((await quote.json()).error,"assistant_existing_task_unavailable");
    const resume=await specialistProtocolRequest(state,{action:"resume",turnId:turn.id,executionId:id});assert.equal(resume.status,404);assert.equal(state.calls.length,0);assert.deepEqual(adaptiveReentryFinancialState(state),before);
  }finally{await state.cleanup();}
});
for(const denied of["not-admin","not-enrolled","not-explicit"])test("specialist consent: Sol "+denied+" cannot be silently approved by a model field",async()=>{
  const state=await specialistMockFixture({models:"gpt-5.6-luna,gpt-5.6-terra,gpt-5.6-sol",solUsers:denied==="not-enrolled"?"another-user":"dev-local-creative"});
  try{
    if(denied==="not-admin")state.sqlite.prepare("UPDATE users SET role='creator' WHERE user_id='dev-local-creative'").run();
    const turn=await specialistFreeTurn(state,"specialist-sol-"+denied,"Review the governance and compliance of this document.",{model:"gpt-5.6-sol",premiumApproval:true}),review=await specialistQuote(state,turn.id,denied==="not-explicit"?undefined:"gpt-5.6-sol");
    assert.equal(review.quote.models[0],"gpt-5.6-sol");assert.equal(review.quote.canExecute,false);assert.ok(review.quote.unavailableReasons.includes("assistant_model_premium_approval_required"));
    const blocked=await specialistExecute(state,review);assert.equal(blocked.status,409,JSON.stringify(await blocked.clone().json()));assert.equal(state.calls.length,0);assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM assistant_specialist_tasks").get().n,0);
  }finally{await state.cleanup();}
});
test("specialist consent: explicitly approved allowlisted admin Sol uses retained current pricing and cache partitions",async()=>{
  const state=await specialistMockFixture({models:"gpt-5.6-luna,gpt-5.6-terra,gpt-5.6-sol",solUsers:"dev-local-creative",respond:payload=>specialistRawResponse(payload,{usage:{input_tokens:1000,output_tokens:300,total_tokens:1300,input_tokens_details:{cached_tokens:200,cache_write_tokens:100}}})});
  try{
    const turn=await specialistFreeTurn(state,"specialist-sol-allowed","Review the governance of this document."),review=await specialistQuote(state,turn.id,"gpt-5.6-sol");assert.equal(review.quote.canExecute,true);
    const snapshot=review.quote.privateInput.pricing;assert.equal(snapshot.version,"openai-standard-usd-2026-08-27-v1");assert.equal(snapshot.short.input,4);assert.equal(snapshot.short.output,20);
    const before=review.quote.maximumMicrousd,accepted=await specialistExecute(state,review);assert.equal(accepted.status,202);await state.drainBackground();assert.equal(state.calls.length,1);
    const receipt=consequentialReceipt(state,review.quote.executionId);assert.equal(receipt.execution.status,"completed");assert.equal(receipt.cost[0].used_microusd,700*4+200*.4+100*5+300*20);
    const recovered=await specialistRetrieve(state,review),body=await recovered.json();assert.equal(body.result.maximumMicrousd,before);assert.equal(body.result.providerResult.usage.cachedInputTokens,200);assert.equal(body.result.providerResult.usage.cacheWriteInputTokens,100);assert.equal(state.calls.length,1);
  }finally{await state.cleanup();}
});

test("specialist consent: same-document Canvas block selection reuses the shared exact-document resolver",async()=>{
  const state=await specialistMockFixture();
  try{
    const options=specialistCanvasEvents(state);appendFixtureEvents(state.sqlite,"creative:dev-local-creative",[["CanvasItemPlaced",{project_id:"project-atmosphere",canvas_id:"specialist-exact-board",item_id:"specialist-selected-block",source_kind:"block",source_id:"block-direction",title:"Exact selected direction",frame:{x:0,y:170,w:240,h:160,z:"a2"}}]]);
    options.selected=["specialist-selected-block"];const turn=await specialistFreeTurn(state,"specialist-canvas-block","Review the selected direction.",options),review=await specialistQuote(state,turn.id,undefined,options);
    assert.equal(review.originalRequest.documentId,"doc-atmosphere");assert.deepEqual(review.originalRequest.selectedItemIds,options.selected);
    const approved=await specialistExecute(state,review,options);assert.equal(approved.status,202,JSON.stringify(await approved.clone().json()));await state.drainBackground();assert.equal(state.calls.length,1);assert.equal(consequentialReceipt(state,review.quote.executionId).execution.status,"completed");
  }finally{await state.cleanup();}
});
test("specialist consent: migrated owner keeps old personal free history but never silently adopts it for paid work",async()=>{
  const state=await specialistMockFixture({shared:true});
  try{
    const headers=Object.fromEntries(Object.entries(state.owner).filter(([key])=>key!=="cookie")),options={headers};
    const current=await specialistFreeTurn(state,"specialist-new-real-custody","New scoped question.",options),now=new Date().toISOString(),expires=new Date(Date.now()+86_400_000).toISOString(),id="specialist-legacy-personal";
    for(const[kind,suffix,content]of[["chat-user","user","LEGACY_FREE_PERSONAL_QUESTION"],["chat-assistant","answer","LEGACY_FREE_PERSONAL_REPLY"]])state.sqlite.prepare("INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at)VALUES(?,'assistant-owner',?,?,?,?,NULL)").run(id+"-"+suffix,kind,content,now,expires);
    state.sqlite.prepare("INSERT INTO assistant_turns(turn_id,actor_user_id,scope_key,organization_id,project_access_id,project_id,document_id,route_family,user_content_ref,assistant_content_ref,proposal_json,permission_epoch,status,created_at,completed_at,request_json) SELECT ?,'assistant-owner',?,NULL,NULL,project_id,document_id,route_family,?,?,NULL,permission_epoch,'completed',created_at,completed_at,NULL FROM assistant_turns WHERE turn_id=?")
      .run(id,JSON.stringify(["","","project-atmosphere","doc-atmosphere"]),id+"-user",id+"-answer",current.id);
    const page=await state.request(endpoint(),{headers}),body=await page.json();assert.equal(page.status,200,JSON.stringify(body));assert.ok(body.turns.some(turn=>turn.id===id&&turn.user==="LEGACY_FREE_PERSONAL_QUESTION"&&turn.reply.text==="LEGACY_FREE_PERSONAL_REPLY"));
    const paid=await specialistProtocolRequest(state,{action:"quote",turnId:id},options);assert.equal(paid.status,409,JSON.stringify(await paid.clone().json()));assert.equal((await paid.json()).error,"assistant_turn_snapshot_unavailable");
    assert.equal(state.calls.length,0);assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM assistant_specialist_tasks").get().n,0);
    for(const ref of[id+"-user",id+"-answer"]){assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=?").get(ref).n,0);assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM private_content_retention_scopes WHERE content_id=?").get(ref).n,0);}
    assert.equal(state.sqlite.prepare("SELECT organization_id FROM assistant_turns WHERE turn_id=?").get(id).organization_id,null);
  }finally{await state.cleanup();}
});

test("specialist consent: canonical reply and review-only proposals commit once without semantic writes",async()=>{
  const action={kind:"context.create",block_type:"subject",target_block_id:null,from_block_id:null,to_block_id:null,relation_kind:"",intent:"include",text:"A separately reviewable new subject."};
  const state=await specialistMockFixture({respond:payload=>specialistRawResponse(payload,{output:[{type:"message",id:"proposal-message",role:"assistant",status:"completed",content:[{type:"output_text",text:JSON.stringify({reply:"A proposed subject is ready for your review.",actions:[action]})}]}]})});
  try{
    const turn=await specialistFreeTurn(state),review=await specialistQuote(state,turn.id),before=adaptiveAuthoredCount(state);
    assert.equal((await specialistExecute(state,review)).status,202);await state.drainBackground();
    const first=await(await specialistRetrieve(state,review)).json();assert.equal(first.result.actions.length,1);assert.equal(first.turn.reply.text,"A proposed subject is ready for your review.");
    const proposals=state.sqlite.prepare("SELECT proposal_id,action_content_ref,status FROM assistant_action_proposals WHERE turn_id=?").all(turn.id);assert.equal(proposals.length,1);assert.equal(proposals[0].status,"pending");assert.equal(first.turn.proposal.id,proposals[0].proposal_id);
    const count=state.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='MutationProposed' AND correlation_id=?").get(review.quote.executionId).n;assert.equal(count,1);
    await specialistRetrieve(state,review);assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM assistant_action_proposals WHERE turn_id=?").get(turn.id).n,1);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='MutationProposed' AND correlation_id=?").get(review.quote.executionId).n,1);assert.equal(adaptiveAuthoredCount(state),before);assert.equal(state.calls.length,1);
  }finally{await state.cleanup();}
});

test("specialist consent: concurrency cap queues third approval and only explicit original continuation runs it",{timeout:15_000},async()=>{
  const gates=[Promise.withResolvers(),Promise.withResolvers()],entered=[Promise.withResolvers(),Promise.withResolvers()];let started=0,active=0,maxActive=0;
  const state=await specialistMockFixture({respond:async payload=>{const index=started++;active++;maxActive=Math.max(maxActive,active);try{if(index<2){entered[index].resolve();await gates[index].promise;}return specialistRawResponse(payload,{id:"capped-specialist-"+index});}finally{active--;}}});
  try{
    const turns=[];for(let index=0;index<3;index++)turns.push(await specialistFreeTurn(state,"specialist-cap-"+index+"-turn","Review exact turn "+index+"."));
    const reviews=[];for(const turn of turns)reviews.push(await specialistQuote(state,turn.id));
    assert.equal((await specialistExecute(state,reviews[0])).status,202);await entered[0].promise;
    assert.equal((await specialistExecute(state,reviews[1])).status,202);await entered[1].promise;
    const third=await specialistExecute(state,reviews[2]);assert.equal(third.status,202);assert.equal(state.calls.length,2);
    const busy=await(await specialistRetrieve(state,reviews[2])).json();assert.equal(busy.task.status,"queued");assert.equal(busy.task.submission,"not-submitted");assert.equal(busy.task.canExecute,false);assert.equal(busy.quote.canExecute,false);
    gates[0].resolve();gates[1].resolve();await state.drainBackground();const finance=adaptiveReentryFinancialState(state);
    const ready=await(await specialistRetrieve(state,reviews[2])).json();assert.equal(ready.task.status,"queued");assert.equal(ready.task.canExecute,true);assert.equal(ready.quote.canExecute,true);assert.equal(ready.quote.executionId,reviews[2].quote.executionId);
    assert.equal((await state.request(endpoint())).status,200);await state.drainBackground();assert.equal(state.calls.length,2);assert.deepEqual(adaptiveReentryFinancialState(state),finance);
    const continued=await specialistExecute(state,reviews[2]);assert.equal(continued.status,202,JSON.stringify(await continued.clone().json()));await state.drainBackground();
    assert.equal(state.calls.length,3);assert.equal(maxActive,2);assert.deepEqual(state.calls[2].payload,reviews[2].quote.privateInput.providerRequest,"The original reviewed conversation is not rebuilt after the first two replies change");
    for(const review of reviews)assert.equal(consequentialReceipt(state,review.quote.executionId).execution.status,"completed");
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM assistant_specialist_tasks").get().n,3);assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM budget_reservations").get().n,3);
  }finally{for(const gate of gates)gate.resolve();await state.cleanup();}
});
for(const source of["canonical","consent","answer"])test("specialist consent: final response proof withdraws "+source+" erased after a paid result was read",async()=>{
  const state=await specialistMockFixture({shared:true});let restore;
  try{
    const turn=await specialistFreeTurn(state),review=await specialistQuote(state,turn.id);await specialistExecute(state,review);await state.drainBackground();
    const execution=state.sqlite.prepare("SELECT * FROM consequential_executions WHERE execution_id=?").get(review.quote.executionId),turnRow=state.sqlite.prepare("SELECT * FROM assistant_turns WHERE turn_id=?").get(turn.id),ref=source==="canonical"?execution.result_ref:source==="consent"?execution.consent_ref:turnRow.assistant_content_ref;
    let fired=false;restore=interceptConsequentialDb(state,"first",/AS retained,CASE WHEN[\s\S]+AS result_retained/u,()=>{
      assert.equal(consequentialReceipt(state,review.quote.executionId).execution.status,"completed");state.sqlite.prepare("UPDATE private_content SET content='',redacted_at=? WHERE content_id=?").run(new Date().toISOString(),ref);fired=true;
    });
    const response=await specialistRetrieve(state,review),body=await response.json();assert.equal(fired,true);assert.equal(body.result,undefined);assert.equal(body.turn,undefined);assert.doesNotMatch(JSON.stringify(body),/PRIVATE_VERIFIED_SPECIALIST_REPLY/u);
    assert.equal(body.turnId,turn.id);assert.equal(body.executionId,review.quote.executionId);
    if(source==="canonical"){assert.equal(body.retainedResultUnavailable,true);assert.equal(response.status,200);}else{assert.equal(body.retentionUnavailable,true);assert.equal(response.status,404);assert.equal(body.quote,undefined);}
    assert.equal(state.calls.length,1);
  }finally{restore?.();await state.cleanup();}
});

test("specialist consent: shared-owner Canvas page history keeps original custody through index synchronization",async()=>{
  const state=await specialistMockFixture({shared:true});
  try{
    state.sqlite.prepare("UPDATE users SET role='admin' WHERE user_id='assistant-owner'").run();const options=specialistCanvasEvents(state);
    const turn=await specialistFreeTurn(state,"specialist-shared-canvas","Review this exact document on the board.",options),review=await specialistQuote(state,turn.id,undefined,options);
    assert.equal(review.originalRequest.canvasId,"specialist-exact-board");const response=await specialistExecute(state,review,options);assert.equal(response.status,202,JSON.stringify(await response.clone().json()));await state.drainBackground();
    assert.equal(state.calls.length,1);assert.equal(consequentialReceipt(state,review.quote.executionId).execution.status,"completed");
    const page=await state.request(endpoint(options.route)+options.selected.map(value=>"&selected="+value).join(""),{headers:state.owner}),body=await page.json();assert.equal(page.status,200,JSON.stringify(body));assert.equal(body.turns.find(item=>item.id===turn.id).reply.text,"PRIVATE_VERIFIED_SPECIALIST_REPLY");
  }finally{await state.cleanup();}
});
for(const mismatch of["retention-project","resource-owner","retention-actor"])test("specialist consent: page-chat index never preserves or recreates invalid "+mismatch+" custody",async()=>{
  const state=await specialistMockFixture({shared:true});
  try{
    const route="/settings/workspaces/"+state.organizationId+"/members",options={route},turn=await specialistFreeTurn(state,"specialist-page-"+mismatch,"CURRENT_PRIVATE_WORKSPACE_TEXT",options);
    const original=await state.request(endpoint(route),{headers:state.owner});assert.match(JSON.stringify(await original.json()),/CURRENT_PRIVATE_WORKSPACE_TEXT/u);
    const ref=state.sqlite.prepare("SELECT user_content_ref FROM assistant_turns WHERE turn_id=?").get(turn.id).user_content_ref;
    if(mismatch==="retention-project")state.sqlite.prepare("UPDATE private_content_retention_scopes SET project_id='another-project' WHERE content_id=?").run(ref);
    if(mismatch==="resource-owner")state.sqlite.prepare("UPDATE project_resource_scopes SET owner_user_id='assistant-viewer' WHERE resource_kind='content' AND resource_id=?").run(ref);
    if(mismatch==="retention-actor")state.sqlite.prepare("UPDATE private_content_retention_scopes SET actor_user_id='assistant-viewer' WHERE content_id=?").run(ref);
    const {synchronizeProjectScope}=await import("../worker/project-access.ts");
    appendFixtureEvents(state.sqlite,"creative:assistant-owner",[["ProjectRenamed",{project_id:"project-atmosphere",name:"Force a current exact index pass"}]]);
    await synchronizeProjectScope(state.env,{organizationId:state.organizationId,projectAccessId:state.projectAccessId,projectId:"project-atmosphere",ownerUserId:"assistant-owner"});
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=?").get(ref).n,0);
    assert.equal(state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(ref).content,"CURRENT_PRIVATE_WORKSPACE_TEXT");
    const unavailable=await state.request(endpoint(route),{headers:state.owner});assert.doesNotMatch(JSON.stringify(await unavailable.json()),/CURRENT_PRIVATE_WORKSPACE_TEXT/u);
    state.sqlite.prepare("UPDATE private_content_retention_scopes SET project_id='project-atmosphere',actor_user_id='assistant-owner' WHERE content_id=?").run(ref);
    appendFixtureEvents(state.sqlite,"creative:assistant-owner",[["ProjectRenamed",{project_id:"project-atmosphere",name:"Missing custody is not silently recreated"}]]);
    await synchronizeProjectScope(state.env,{organizationId:state.organizationId,projectAccessId:state.projectAccessId,projectId:"project-atmosphere",ownerUserId:"assistant-owner"});
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=?").get(ref).n,0);assert.equal(state.calls.length,0);
  }finally{await state.cleanup();}
});

function measureSpecialistConversationSql(state){
  const original=state.env.DB.prepare,metrics={bindings:0,bytes:0};
  state.env.DB.prepare=function(sql){
    metrics.bytes=Math.max(metrics.bytes,new TextEncoder().encode(sql).byteLength);
    const statement=original.call(this,sql),bind=statement.bind;
    statement.bind=function(...values){metrics.bindings=Math.max(metrics.bindings,values.length);return bind.call(this,...values);};
    return statement;
  };
  return{metrics,assertBounded(){assert.ok(metrics.bindings<100,"D1 parameters: "+metrics.bindings);assert.ok(metrics.bytes<100000,"D1 SQL bytes: "+metrics.bytes);},restore(){state.env.DB.prepare=original;}};
}
for(const source of["canonical","consent"]){
  test("specialist conversation custody: withdrawn "+source+" before quote cannot be copied into a new paid request",async()=>{
    const state=await specialistMockFixture({shared:true}),sql=measureSpecialistConversationSql(state);
    try{
      const original=await specialistApprovedTurn(state,"Explain the exact current source.");await state.drainBackground();assert.equal(state.calls.length,1);
      const execution=state.sqlite.prepare("SELECT * FROM consequential_executions WHERE execution_id=?").get(original.task.id),reference=source==="canonical"?execution.result_ref:execution.consent_ref;
      state.sqlite.prepare("UPDATE private_content SET content='',redacted_at=? WHERE content_id=?").run(new Date().toISOString(),reference);
      const copied=state.sqlite.prepare("SELECT answer.content,answer.redacted_at FROM assistant_turns turn JOIN private_content answer ON answer.content_id=turn.assistant_content_ref WHERE turn.turn_id=?").get(original.turn.id);
      assert.equal(copied.redacted_at,null);assert.equal(copied.content,"PRIVATE_VERIFIED_SPECIALIST_REPLY","The live copied answer reproduces the old privacy gap");
      const page=await(await state.request(endpoint(),{headers:state.owner})).json();assert.doesNotMatch(JSON.stringify(page.turns),/PRIVATE_VERIFIED_SPECIALIST_REPLY/u);
      const next=await specialistFreeTurn(state,crypto.randomUUID(),"What should we do next?"),finances=adaptiveReentryFinancialState(state),before=state.calls.length;
      const denied=await specialistProtocolRequest(state,{action:"quote",turnId:next.id}),body=await denied.json();
      assert.equal(denied.status,403,JSON.stringify(body)+" SQL: "+state.controls.lastDatabaseError);assert.equal(body.error,"assistant_conversation_custody_unavailable");
      assert.equal(body.quote,undefined);assert.doesNotMatch(JSON.stringify(body),/PRIVATE_VERIFIED_SPECIALIST_REPLY/u);
      await state.drainBackground();assert.equal(state.calls.length,before);assert.deepEqual(adaptiveReentryFinancialState(state),finances);
      assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM assistant_specialist_tasks WHERE turn_id=?").get(next.id).n,0);
      assert.equal(state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(reference).content,"");sql.assertBounded();
    }finally{sql.restore();await state.cleanup();}
  });
  for(const boundary of["submission CAS","after submitting SQL response","final dispatch read"]){
    test("specialist conversation custody: "+source+" withdrawal at "+boundary+" releases proven unused work without a POST",async()=>{
      const state=await specialistMockFixture({shared:true}),sql=measureSpecialistConversationSql(state);let restore;
      try{
        const original=await specialistApprovedTurn(state,"Explain the exact current source.");await state.drainBackground();assert.equal(state.calls.length,1);
        const execution=state.sqlite.prepare("SELECT * FROM consequential_executions WHERE execution_id=?").get(original.task.id),reference=source==="canonical"?execution.result_ref:execution.consent_ref;
        const next=await specialistFreeTurn(state,crypto.randomUUID(),"What should we do next?"),review=await specialistQuote(state,next.id);
        assert.match(JSON.stringify(review.quote.privateInput.providerRequest),/PRIVATE_VERIFIED_SPECIALIST_REPLY/u);
        const balances=consequentialBalances(state,"assistant-owner"),before=state.calls.length;let fired=false;
        const withdraw=()=>{state.sqlite.prepare("UPDATE private_content SET content='',redacted_at=? WHERE content_id=?").run(new Date().toISOString(),reference);fired=true;};
        restore=boundary==="final dispatch read"
          ?interceptConsequentialDb(state,"first",/^\s*SELECT MIN\(execution.expires_at,task.lease_expires_at/u,withdraw)
          :interceptConsequentialDb(state,"run",/^\s*UPDATE consequential_execution_steps SET status='submitting'/u,withdraw,boundary==="after submitting SQL response"?"after":"before");
        const accepted=await specialistExecute(state,review);assert.equal(accepted.status,202,JSON.stringify(await accepted.clone().json()));await state.drainBackground();assert.equal(fired,true,boundary);
        assert.equal(state.calls.length,before,"A withdrawn paid answer must never reach another provider request");
        const receipt=consequentialReceipt(state,review.quote.executionId);assert.equal(receipt.execution.status,"failed");assert.equal(receipt.execution.result_ref,null);assert.equal(receipt.steps[0].status,"not-submitted");
        assert.equal(receipt.tokens.length,1);assert.equal(receipt.cost.length,1);assert.equal(receipt.tokens[0].status,"released");assert.equal(receipt.cost[0].status,"released");
        assert.equal(receipt.tokens[0].used_tokens,0);assert.equal(receipt.cost[0].used_microusd,0);assert.deepEqual(consequentialBalances(state,"assistant-owner"),balances);
        assert.equal(state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(reference).content,"");sql.assertBounded();
      }finally{restore?.();sql.restore();await state.cleanup();}
    });
  }
}
test("specialist conversation custody: legitimate earlier paid completion preserves the frozen approved free history",async()=>{
  const state=await specialistMockFixture({shared:true}),sql=measureSpecialistConversationSql(state);
  try{
    const prior=await specialistFreeTurn(state,crypto.randomUUID(),"Explain the exact current source."),next=await specialistFreeTurn(state,crypto.randomUUID(),"What should we do next?");
    const reviewed=await specialistQuote(state,next.id),frozen=structuredClone(reviewed.quote.privateInput.providerRequest);
    const originalAnswer=state.sqlite.prepare("SELECT answer.content FROM assistant_turns turn JOIN private_content answer ON answer.content_id=turn.assistant_content_ref WHERE turn.turn_id=?").get(prior.id).content;
    assert.ok(JSON.parse(frozen.input).recent_conversation.some(item=>item.role==="assistant"&&item.text===originalAnswer));assert.doesNotMatch(JSON.stringify(frozen),/PRIVATE_VERIFIED_SPECIALIST_REPLY/u);
    const earlier=await specialistQuote(state,prior.id);assert.equal((await specialistExecute(state,earlier)).status,202);await state.drainBackground();assert.equal(state.calls.length,1);
    assert.equal(state.sqlite.prepare("SELECT answer.content FROM assistant_turns turn JOIN private_content answer ON answer.content_id=turn.assistant_content_ref WHERE turn.turn_id=?").get(prior.id).content,"PRIVATE_VERIFIED_SPECIALIST_REPLY");
    const accepted=await specialistExecute(state,reviewed);assert.equal(accepted.status,202,JSON.stringify(await accepted.clone().json()));await state.drainBackground();assert.equal(state.calls.length,2);
    assert.deepEqual(state.calls[1].payload,frozen,"Current valid paid provenance is checked without rebuilding or replacing the approved history bytes");
    assert.equal(consequentialReceipt(state,reviewed.quote.executionId).execution.status,"completed");sql.assertBounded();
  }finally{sql.restore();await state.cleanup();}
});
test("specialist conversation custody: withdrawn turns outside the exact bounded window are neither included nor substituted",async()=>{
  const state=await specialistMockFixture({shared:true}),sql=measureSpecialistConversationSql(state);
  try{
    const old=await specialistApprovedTurn(state,"Explain the exact current source.");await state.drainBackground();
    const execution=state.sqlite.prepare("SELECT result_ref FROM consequential_executions WHERE execution_id=?").get(old.task.id);
    state.sqlite.prepare("UPDATE private_content SET content='',redacted_at=? WHERE content_id=?").run(new Date().toISOString(),execution.result_ref);
    const fresh=[];for(let index=0;index<3;index++)fresh.push(await specialistFreeTurn(state,crypto.randomUUID(),"New independent question "+index+"."));
    const review=await specialistQuote(state,fresh.at(-1).id);
    assert.deepEqual(review.originalRequest.conversationTurnIds,fresh.map(turn=>turn.id));assert.doesNotMatch(JSON.stringify(review.quote.privateInput.providerRequest),/PRIVATE_VERIFIED_SPECIALIST_REPLY/u);
    assert.equal((await specialistExecute(state,review)).status,202);await state.drainBackground();assert.equal(state.calls.length,2);
    assert.deepEqual(state.calls[1].payload,review.quote.privateInput.providerRequest);assert.equal(consequentialReceipt(state,review.quote.executionId).execution.status,"completed");sql.assertBounded();
  }finally{sql.restore();await state.cleanup();}
});

const deleteAssistantOrganization=state=>state.request("/api/workspaces/"+state.organizationId+"/deletion",json({confirmation:"DELETE_ORGANIZATION_AND_SCOPED_DATA",organizationId:state.organizationId},state.owner));
async function independentAssistantBillingReviewer(state){
  const reviewer=(await(await state.request("/api/session")).json()).user;
  const invitationResponse=await state.request("/api/workspaces/"+state.organizationId+"/members",json({email:reviewer.email,role:"administrator"},state.owner));
  assert.equal(invitationResponse.status,201,JSON.stringify(await invitationResponse.clone().json()));const invitation=await invitationResponse.json(),token=new URL(invitation.invitationUrl).searchParams.get("token");
  assert.equal((await state.request("/api/workspaces/"+state.organizationId+"/invitations/"+invitation.invitationId+"/accept",json({token}))).status,200);
  const membership=await state.request("/api/workspaces/"+state.organizationId+"/projects/"+state.projectAccessId+"/members",json({userId:reviewer.userId,role:"editor"},state.owner));
  assert.equal(membership.status,201,JSON.stringify(await membership.clone().json()));
  return{reviewer,confirmation:{actorUserId:"assistant-owner",organizationId:state.organizationId,projectAccessId:state.projectAccessId,confirmedNoProviderCharge:true}};
}
const independentlyReconcileAssistant=(state,id,confirmation)=>state.request("/api/platform/assistant/billing/"+encodeURIComponent(id)+"/reconcile",json(confirmation));
function ageAssistantReservations(state){
  state.sqlite.prepare("UPDATE budget_reservations SET created_at='2000-01-01T00:00:00.000Z'").run();
  state.sqlite.prepare("UPDATE cost_budget_reservations SET created_at='2000-01-01T00:00:00.000Z'").run();
}
async function sweepAssistantReservations(state){
  const principal=await requireUser(new Request("http://localhost/api/session",{headers:state.owner??{}}),state.env);
  assert.ok(principal.user);return reconcileFailedBudgetReservations(state.env,principal.user);
}
for(const[field,prefix]of[["operation","assistant:"],["operation","assistant-specialist:"],["correlation_id","assistant:"],["correlation_id","assistant-specialist:"]]){
  test("specialist lifecycle: orphan sweep retains historical "+field+" "+prefix+" holds",async()=>{
    const state=await specialistMockFixture();
    try{
      const turn=await specialistFreeTurn(state),task=await seedLegacyAssistantTask(state,turn);
      state.sqlite.prepare("UPDATE budget_reservations SET operation='historical-unknown',correlation_id='historical-unknown' WHERE reservation_id=?").run(task.tokenReservationId);
      state.sqlite.prepare("UPDATE budget_reservations SET "+field+"=? WHERE reservation_id=?").run(prefix+"page-guidance:gpt-5.6-luna",task.tokenReservationId);
      state.sqlite.prepare("DELETE FROM assistant_specialist_tasks WHERE task_id=?").run(task.id);ageAssistantReservations(state);
      const finances=adaptiveReentryFinancialState(state),result=await sweepAssistantReservations(state);
      assert.equal(result.releasedTokens,0);assert.equal(result.reservationCount,0);assert.deepEqual(adaptiveReentryFinancialState(state),finances);
      assert.equal(state.calls.length,0);
    }finally{await state.cleanup();}
  });
}
test("specialist lifecycle: orphan sweep retains a signed unknown hold without its mutable task row",async()=>{
  const state=await specialistMockFixture({respond:()=>{throw new TypeError("The POST may have reached the provider");}});
  try{
    const {task}=await specialistApprovedTurn(state,"Explain the current document.");await state.drainBackground();assert.equal(state.calls.length,1);
    state.sqlite.prepare("DELETE FROM assistant_specialist_tasks WHERE task_id=?").run(task.id);
    state.sqlite.prepare("UPDATE budget_reservations SET operation='recovered-operation',correlation_id='recovered-correlation' WHERE reservation_id=?").run(task.id+":tokens:0");
    ageAssistantReservations(state);const finances=adaptiveReentryFinancialState(state),result=await sweepAssistantReservations(state);
    assert.equal(result.releasedTokens,0);assert.deepEqual(adaptiveReentryFinancialState(state),finances);assert.equal(state.calls.length,1);
    assert.equal(state.sqlite.prepare("SELECT status FROM consequential_execution_steps WHERE execution_id=?").get(task.id).status,"uncertain");
  }finally{await state.cleanup();}
});
test("specialist lifecycle: a restored verified receipt cannot be zeroed by orphan repair even when its step label is terminal",async()=>{
  const state=await specialistMockFixture();
  try{
    state.controls.skipAssistantTaskClaimOnce=true;const {review,task}=await specialistApprovedTurn(state,"Explain the current document.");await state.drainBackground();
    await seedExpiredConsentedAssistantLease(state,review,{submitted:true});
    // Reproduces a stale restored ledger beside a durably verified terminal step; repair must not call this unused.
    state.sqlite.prepare("UPDATE consequential_execution_steps SET status='settled',verified_tokens=1300,verified_microusd=560,provider_request_id='verified-historical-response' WHERE execution_id=?").run(task.id);
    state.sqlite.prepare("UPDATE budget_reservations SET operation='restored-operation',correlation_id='restored-correlation' WHERE reservation_id=?").run(task.id+":tokens:0");
    ageAssistantReservations(state);const finances=adaptiveReentryFinancialState(state),result=await sweepAssistantReservations(state);
    assert.equal(result.releasedTokens,0);assert.deepEqual(adaptiveReentryFinancialState(state),finances);assert.equal(state.calls.length,0);
  }finally{await state.cleanup();}
});
test("specialist lifecycle: ordinary proven orphan token cleanup remains available",async()=>{
  const state=await specialistMockFixture();
  try{
    await specialistFreeTurn(state);const reserved=await reserveBudget(state.env,"dev-local-creative",200,{reservationId:"ordinary-orphan-budget",streamId:"creative:dev-local-creative",correlationId:"ordinary-orphan",operation:"ordinary-test-operation"});assert.equal(reserved.ok,true);
    ageAssistantReservations(state);const repaired=await sweepAssistantReservations(state);assert.equal(repaired.releasedTokens,200);assert.equal(repaired.reservationCount,1);
    assert.equal(state.sqlite.prepare("SELECT status,used_tokens FROM budget_reservations WHERE reservation_id='ordinary-orphan-budget'").get().status,"released");assert.equal(state.calls.length,0);
  }finally{await state.cleanup();}
});
for(const stage of["queued approval","reserved hold"])test("specialist lifecycle: tenant deletion tombstones a "+stage+" before releasing any signed hold",async()=>{
  const state=await specialistMockFixture({shared:true}),sql=measureSpecialistConversationSql(state);
  try{
    state.controls.skipAssistantTaskClaimOnce=true;const {review,task}=await specialistApprovedTurn(state,"Explain the current document.");await state.drainBackground();
    if(stage==="reserved hold")await seedExpiredConsentedAssistantLease(state,review);
    const before=consequentialReceipt(state,task.id);assert.equal(before.steps[0].status,stage==="reserved hold"?"reserved":"quoted");
    const deleted=await deleteAssistantOrganization(state);assert.equal(deleted.status,200,JSON.stringify(await deleted.clone().json())+" SQL: "+state.controls.lastDatabaseError);assert.equal((await deleted.json()).status,"completed");
    const after=consequentialReceipt(state,task.id);assert.equal(after.execution.status,"failed");assert.equal(after.steps[0].status,"not-submitted");assert.equal(after.execution.result_ref,null);
    assert.ok(after.tokens.every(row=>row.status==="released"&&row.used_tokens===0));assert.ok(after.cost.every(row=>row.status==="released"&&row.used_microusd===0));
    assert.deepEqual(consequentialBalances(state,"assistant-owner"),{tokens:{used:0,reserved:0},cost:{used:0,reserved:0}});
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM assistant_specialist_tasks WHERE organization_id=?").get(state.organizationId).n,0);assert.equal(state.calls.length,0);sql.assertBounded();
  }finally{sql.restore();await state.cleanup();}
});
for(const ledger of["tokens","cost"])test("specialist lifecycle: deletion winning before "+ledger+" INSERT cannot create a late reservation or POST",async()=>{
  const state=await specialistMockFixture({shared:true});let gate;
  try{
    const turn=await specialistFreeTurn(state),review=await specialistQuote(state,turn.id);
    gate=gateConsequentialDb(state,"batch",ledger==="tokens"?/^\s*INSERT OR IGNORE INTO budget_reservations\b/u:/^\s*INSERT OR IGNORE INTO cost_budget_reservations\b/u);
    const executing=specialistExecute(state,review);await gate.entered;
    const removed=await deleteAssistantOrganization(state);assert.equal(removed.status,200,JSON.stringify(await removed.clone().json())+" SQL: "+state.controls.lastDatabaseError);
    gate.release();await executing;await state.drainBackground();
    const receipt=consequentialReceipt(state,review.quote.executionId);assert.equal(receipt.execution.status,"failed");assert.equal(receipt.steps[0].status,"not-submitted");
    assert.equal(receipt.tokens.length,ledger==="cost"?1:0);assert.equal(receipt.cost.length,0);assert.ok(receipt.tokens.every(row=>row.status==="released"));
    assert.deepEqual(consequentialBalances(state,"assistant-owner"),{tokens:{used:0,reserved:0},cost:{used:0,reserved:0}});assert.equal(state.calls.length,0);
  }finally{gate?.release();gate?.restore();await state.cleanup();}
});
test("specialist lifecycle: interrupted deletion resumes its persisted tombstone without reallocating either ledger",async()=>{
  const state=await specialistMockFixture({shared:true});let restore;
  try{
    state.controls.skipAssistantTaskClaimOnce=true;const {review,task}=await specialistApprovedTurn(state,"Explain the current document.");await state.drainBackground();await seedExpiredConsentedAssistantLease(state,review);
    let fired=false;restore=interceptConsequentialDb(state,"batch",/^\s*UPDATE consequential_execution_steps SET status='not-submitted'/u,()=>{fired=true;throw new Error("fixture crash after signed stop persisted");},"after");
    const first=await deleteAssistantOrganization(state);assert.ok(first.status>=500,JSON.stringify(await first.clone().json()));assert.equal(fired,true);restore();restore=null;
    let receipt=consequentialReceipt(state,task.id);assert.equal(receipt.steps[0].status,"not-submitted");assert.equal(receipt.tokens[0].status,"active");assert.equal(receipt.cost[0].status,"executing");
    const second=await deleteAssistantOrganization(state);assert.equal(second.status,200,JSON.stringify(await second.clone().json())+" SQL: "+state.controls.lastDatabaseError);
    receipt=consequentialReceipt(state,task.id);assert.equal(receipt.tokens.length,1);assert.equal(receipt.cost.length,1);assert.equal(receipt.tokens[0].status,"released");assert.equal(receipt.cost[0].status,"released");
    assert.deepEqual(consequentialBalances(state,"assistant-owner"),{tokens:{used:0,reserved:0},cost:{used:0,reserved:0}});assert.equal(state.calls.length,0);
  }finally{restore?.();await state.cleanup();}
});
test("specialist lifecycle: signed begin winning the destructive claim preserves exact private and budget evidence",async()=>{
  const state=await specialistMockFixture({shared:true});let restore;
  try{
    state.controls.skipAssistantTaskClaimOnce=true;const {review,task}=await specialistApprovedTurn(state,"Explain the current document.");await state.drainBackground();await seedExpiredConsentedAssistantLease(state,review);
    const execution=state.sqlite.prepare("SELECT * FROM consequential_executions WHERE execution_id=?").get(task.id),binding=JSON.parse(state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(execution.consent_ref).content).binding;
    const principal=await requireUser(new Request("http://localhost/api/session",{headers:state.owner}),state.env),finances=adaptiveReentryFinancialState(state),privateRows=state.sqlite.prepare("SELECT content_id,content,redacted_at FROM private_content ORDER BY content_id").all();let fired=false;
    restore=interceptConsequentialDb(state,"batch",/^\s*INSERT INTO organization_deletion_jobs\b/u,async()=>{
      const head=Number(state.sqlite.prepare("SELECT MAX(sequence) AS head FROM events WHERE stream_id=?").get(binding.streamId).head);
      await consequential.beginConsequentialStep(state.env,principal.user,binding,task.id,0,head);state.sqlite.prepare("UPDATE assistant_specialist_tasks SET provider_submitted=1 WHERE task_id=?").run(task.id);fired=true;
    });
    const removed=await deleteAssistantOrganization(state);assert.equal(fired,true);assert.equal(removed.status,409,JSON.stringify(await removed.clone().json()));assert.equal((await removed.json()).error,"provider_submission_in_flight");
    assert.equal(state.sqlite.prepare("SELECT status FROM organizations WHERE organization_id=?").get(state.organizationId).status,"active");assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM organization_deletion_jobs WHERE organization_id=?").get(state.organizationId).n,0);
    assert.equal(consequentialReceipt(state,task.id).steps[0].status,"submitting");assert.deepEqual(adaptiveReentryFinancialState(state),finances);
    assert.deepEqual(state.sqlite.prepare("SELECT content_id,content,redacted_at FROM private_content ORDER BY content_id").all(),privateRows);assert.equal(state.calls.length,0);
  }finally{restore?.();await state.cleanup();}
});
test("specialist lifecycle: cancel and refused deletion retain a late verified response until exact settlement", {timeout:15000},async()=>{
  const entered=Promise.withResolvers(),finish=Promise.withResolvers(),state=await specialistMockFixture({shared:true,respond:async payload=>{entered.resolve();await finish.promise;return specialistRawResponse(payload);}});
  try{
    const {review,task}=await specialistApprovedTurn(state,"Explain the current document.");await entered.promise;
    const canceled=await state.request(taskEndpoint(task.id,"cancel"),{method:"POST",headers:state.owner});assert.equal(canceled.status,200);assert.equal((await canceled.json()).task.submission,"uncertain");
    const finances=adaptiveReentryFinancialState(state),blocked=await deleteAssistantOrganization(state);assert.equal(blocked.status,409,JSON.stringify(await blocked.clone().json()));
    assert.equal((await blocked.json()).error,"provider_submission_in_flight");assert.deepEqual(adaptiveReentryFinancialState(state),finances);
    assert.equal(state.sqlite.prepare("SELECT status FROM organizations WHERE organization_id=?").get(state.organizationId).status,"active");
    finish.resolve();await state.drainBackground();const response=await specialistRetrieve(state,review),body=await response.json();assert.equal(response.status,200);assert.equal(body.result.reply,"PRIVATE_VERIFIED_SPECIALIST_REPLY");assert.equal(body.task.status,"completed");assert.equal(body.result.accountedMicrousd,560);assert.equal(body.result.billingStatus,"settled");
    const record=state.sqlite.prepare("SELECT result_json FROM assistant_specialist_tasks WHERE task_id=?").get(task.id),raw=JSON.parse(record.result_json).rawReceipt.contentRef,execution=state.sqlite.prepare("SELECT * FROM consequential_executions WHERE execution_id=?").get(task.id);
    assert.ok(state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(raw).content.includes("PRIVATE_VERIFIED_SPECIALIST_REPLY"));
    const removed=await deleteAssistantOrganization(state);assert.equal(removed.status,200,JSON.stringify(await removed.clone().json())+" SQL: "+state.controls.lastDatabaseError);
    const after=consequentialReceipt(state,task.id);assert.equal(after.execution.status,"completed");assert.equal(after.steps[0].status,"settled");assert.equal(after.tokens[0].used_tokens,1300);assert.equal(after.cost[0].used_microusd,560);
    assert.deepEqual(consequentialBalances(state,"assistant-owner"),{tokens:{used:1300,reserved:0},cost:{used:560,reserved:0}});
    for(const ref of[raw,execution.result_ref,execution.consent_ref]){const row=state.sqlite.prepare("SELECT content,redacted_at FROM private_content WHERE content_id=?").get(ref);assert.equal(row.content,"");assert.ok(row.redacted_at,"Only the subsequent explicit fully-settled deletion erases private bodies");}
    assert.equal(state.calls.length,1);
  }finally{finish.resolve();await state.cleanup();}
});
test("specialist lifecycle: raw response before usage accounting blocks deletion and independent no-charge release",async()=>{
  const state=await specialistMockFixture({shared:true});let restore;
  try{
    const {confirmation}=await independentAssistantBillingReviewer(state);
    restore=interceptConsequentialDb(state,"run",/^\s*UPDATE consequential_execution_steps SET status='usage-recorded'/u,()=>{throw new Error("fixture interrupted before usage receipt commit");});
    const {task}=await specialistApprovedTurn(state,"Explain the current document.");await state.drainBackground();restore();restore=null;
    const receipt=consequentialReceipt(state,task.id),record=state.sqlite.prepare("SELECT status,result_json FROM assistant_specialist_tasks WHERE task_id=?").get(task.id);
    assert.equal(receipt.steps[0].status,"uncertain");assert.equal(record.status,"needs-review");
    const pointer=JSON.parse(record.result_json).rawReceipt,raw=state.sqlite.prepare("SELECT content,redacted_at FROM private_content WHERE content_id=?").get(pointer.contentRef);
    assert.ok(raw.content.includes("PRIVATE_VERIFIED_SPECIALIST_REPLY"));const finances=adaptiveReentryFinancialState(state);
    const billing=await independentlyReconcileAssistant(state,task.id,confirmation);assert.equal(billing.status,409,JSON.stringify(await billing.clone().json()));assert.equal((await billing.json()).error,"assistant_signed_billing_evidence_required");
    const deletion=await deleteAssistantOrganization(state);assert.equal(deletion.status,409,JSON.stringify(await deletion.clone().json()));
    assert.equal((await deletion.json()).error,"provider_submission_in_flight");assert.deepEqual(adaptiveReentryFinancialState(state),finances);
    assert.deepEqual(state.sqlite.prepare("SELECT content,redacted_at FROM private_content WHERE content_id=?").get(pointer.contentRef),raw);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM assistant_billing_reconciliations WHERE task_id=?").get(task.id).n,0);assert.equal(state.calls.length,1);
  }finally{restore?.();await state.cleanup();}
});
test("specialist lifecycle: signed unknown spend cannot use the legacy independent no-charge attestation",async()=>{
  const state=await specialistMockFixture({shared:true,respond:()=>{throw new TypeError("Unknown original POST");}});
  try{
    const {confirmation}=await independentAssistantBillingReviewer(state),{task}=await specialistApprovedTurn(state,"Explain the current document.");await state.drainBackground();
    const finances=adaptiveReentryFinancialState(state),response=await independentlyReconcileAssistant(state,task.id,confirmation);
    assert.equal(response.status,409,JSON.stringify(await response.clone().json()));assert.equal((await response.json()).error,"assistant_signed_billing_evidence_required");
    assert.deepEqual(adaptiveReentryFinancialState(state),finances);assert.equal(consequentialReceipt(state,task.id).steps[0].status,"uncertain");
    assert.equal(state.sqlite.prepare("SELECT status FROM assistant_specialist_tasks WHERE task_id=?").get(task.id).status,"needs-review");
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM assistant_billing_reconciliations WHERE task_id=?").get(task.id).n,0);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM organization_audit_events WHERE resource_id=? AND action='AssistantProviderChargeReconciled'").get(task.id).n,0);assert.equal(state.calls.length,1);
  }finally{await state.cleanup();}
});
test("specialist lifecycle: missing signed task metadata cannot bypass the retained execution billing guard",async()=>{
  const state=await specialistMockFixture({shared:true,respond:()=>{throw new TypeError("Unknown original POST");}});
  try{
    const {confirmation}=await independentAssistantBillingReviewer(state),{task}=await specialistApprovedTurn(state,"Explain the current document.");await state.drainBackground();
    state.sqlite.prepare("UPDATE assistant_specialist_tasks SET result_json=NULL WHERE task_id=?").run(task.id);
    const finances=adaptiveReentryFinancialState(state),response=await independentlyReconcileAssistant(state,task.id,confirmation);assert.equal(response.status,409);assert.equal((await response.json()).error,"assistant_signed_billing_evidence_required");
    assert.deepEqual(adaptiveReentryFinancialState(state),finances);assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM assistant_billing_reconciliations WHERE task_id=?").get(task.id).n,0);assert.equal(state.calls.length,1);
  }finally{await state.cleanup();}
});
test("specialist lifecycle: independent billing finishes persisted signed usage without repricing or asserting no charge",{timeout:15000},async()=>{
  const finish=Promise.withResolvers(),state=await specialistMockFixture({shared:true,respond:async payload=>{await finish.promise;return specialistRawResponse(payload);}});
  try{
    const {confirmation}=await independentAssistantBillingReviewer(state),{task}=await specialistApprovedTurn(state,"Explain the current document.");
    state.controls.failAssistantBillingCostSettlement=true;finish.resolve();await state.drainBackground();
    const before=consequentialReceipt(state,task.id);assert.equal(before.steps[0].status,"usage-recorded");assert.equal(before.tokens[0].status,"settled");assert.equal(before.cost[0].status,"executing");assert.equal(before.steps[0].verified_microusd,560);
    const saved=state.sqlite.prepare("SELECT * FROM consequential_executions WHERE execution_id=?").get(task.id),raw=state.sqlite.prepare("SELECT result_json FROM assistant_specialist_tasks WHERE task_id=?").get(task.id).result_json;
    delete state.env.OPENAI_API_KEY;state.env.FORMA_ASSISTANT_ALLOWED_MODELS="gpt-5.6-sol";
    const response=await independentlyReconcileAssistant(state,task.id,confirmation);assert.equal(response.status,409,JSON.stringify(await response.clone().json()));assert.equal((await response.json()).error,"assistant_signed_billing_evidence_required");
    const after=consequentialReceipt(state,task.id);assert.equal(after.execution.status,"completed");assert.equal(after.steps[0].status,"settled");assert.equal(after.tokens[0].used_tokens,1300);assert.equal(after.cost[0].used_microusd,560);
    assert.deepEqual(consequentialBalances(state,"assistant-owner"),{tokens:{used:1300,reserved:0},cost:{used:560,reserved:0}});
    assert.equal(state.sqlite.prepare("SELECT result_json FROM assistant_specialist_tasks WHERE task_id=?").get(task.id).result_json,raw);
    assert.equal(state.sqlite.prepare("SELECT result_ref FROM consequential_executions WHERE execution_id=?").get(task.id).result_ref,saved.result_ref);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM assistant_billing_reconciliations WHERE task_id=?").get(task.id).n,0);assert.equal(state.calls.length,1);
  }finally{finish.resolve();await state.cleanup();}
});
test("specialist lifecycle: verified legacy usage winning the billing claim prevents a false no-charge audit",async()=>{
  const state=await specialistMockFixture({shared:true});let restore;
  try{
    const {confirmation}=await independentAssistantBillingReviewer(state),turn=await specialistFreeTurn(state),task=await seedLegacyAssistantTask(state,turn);let fired=false;
    restore=interceptConsequentialDb(state,"batch",/^\s*UPDATE assistant_specialist_tasks SET status='reconciling'/u,async()=>{
      await settleBudget(state.env,"assistant-owner",task.tokenReservationId,1300);await settleCostBudget(state.env,"assistant-owner",task.costReservationId,560);fired=true;
    });
    const response=await independentlyReconcileAssistant(state,task.id,confirmation);assert.equal(fired,true);assert.equal(response.status,409,JSON.stringify(await response.clone().json()));
    assert.deepEqual(consequentialBalances(state,"assistant-owner"),{tokens:{used:1300,reserved:0},cost:{used:560,reserved:0}});
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM assistant_billing_reconciliations WHERE task_id=?").get(task.id).n,0);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM organization_audit_events WHERE action='AssistantProviderChargeReconciled' AND resource_id=?").get(task.id).n,0);
    assert.equal(state.sqlite.prepare("SELECT status FROM assistant_specialist_tasks WHERE task_id=?").get(task.id).status,"needs-review");assert.equal(state.calls.length,0);
  }finally{restore?.();await state.cleanup();}
});
test("specialist lifecycle: explicit deletion settles persisted verified usage before erasing fully accounted private bodies",{timeout:15000},async()=>{
  const finish=Promise.withResolvers(),state=await specialistMockFixture({shared:true,respond:async payload=>{await finish.promise;return specialistRawResponse(payload);}});
  try{
    const {task}=await specialistApprovedTurn(state,"Explain the current document.");state.controls.failAssistantBillingCostSettlement=true;finish.resolve();await state.drainBackground();
    const before=consequentialReceipt(state,task.id);assert.equal(before.steps[0].status,"usage-recorded");assert.equal(before.cost[0].status,"executing");
    const removed=await deleteAssistantOrganization(state);assert.equal(removed.status,200,JSON.stringify(await removed.clone().json())+" SQL: "+state.controls.lastDatabaseError);
    const after=consequentialReceipt(state,task.id);assert.equal(after.execution.status,"completed");assert.equal(after.steps[0].status,"settled");assert.equal(after.tokens[0].used_tokens,1300);assert.equal(after.cost[0].used_microusd,560);
    assert.deepEqual(consequentialBalances(state,"assistant-owner"),{tokens:{used:1300,reserved:0},cost:{used:560,reserved:0}});assert.equal(state.calls.length,1);
  }finally{finish.resolve();await state.cleanup();}
});
test("specialist lifecycle: fully accounted invalid paid output is erasable without zeroing its charge",async()=>{
  const state=await specialistMockFixture({shared:true,respond:payload=>Response.json({id:"accounted-provider-error",model:payload.model,status:"failed",usage:{input_tokens:1000,output_tokens:300,total_tokens:1300}},{status:503})});
  try{
    const {task}=await specialistApprovedTurn(state,"Explain the current document.");await state.drainBackground();assert.equal(state.sqlite.prepare("SELECT status FROM assistant_specialist_tasks WHERE task_id=?").get(task.id).status,"needs-review");
    const before=consequentialReceipt(state,task.id);assert.equal(before.steps[0].status,"settled");assert.equal(before.execution.result_ref,null);assert.equal(before.cost[0].used_microusd,560);
    const removed=await deleteAssistantOrganization(state);assert.equal(removed.status,200,JSON.stringify(await removed.clone().json())+" SQL: "+state.controls.lastDatabaseError);
    const after=consequentialReceipt(state,task.id);assert.equal(after.steps[0].status,"settled");assert.equal(after.tokens[0].used_tokens,1300);assert.equal(after.cost[0].used_microusd,560);
    assert.deepEqual(consequentialBalances(state,"assistant-owner"),{tokens:{used:1300,reserved:0},cost:{used:560,reserved:0}});assert.equal(state.calls.length,1);
  }finally{await state.cleanup();}
});
test("specialist lifecycle: final deletion transaction retains private receipts when settlement evidence becomes inconsistent",async()=>{
  const state=await specialistMockFixture({shared:true});let restore;
  try{
    const {task}=await specialistApprovedTurn(state,"Explain the current document.");await state.drainBackground();
    const execution=state.sqlite.prepare("SELECT * FROM consequential_executions WHERE execution_id=?").get(task.id),raw=JSON.parse(state.sqlite.prepare("SELECT result_json FROM assistant_specialist_tasks WHERE task_id=?").get(task.id).result_json).rawReceipt.contentRef;
    const balances=consequentialBalances(state,"assistant-owner");let fired=false;
    restore=interceptConsequentialDb(state,"batch",/^\s*DELETE FROM assistant_action_proposals\b/u,()=>{state.sqlite.prepare("UPDATE cost_budget_reservations SET status='executing' WHERE reservation_id=?").run(task.id+":usd:0");fired=true;});
    const removed=await deleteAssistantOrganization(state);assert.equal(fired,true);assert.equal(removed.status,409,JSON.stringify(await removed.clone().json()));
    assert.equal((await removed.json()).error,"provider_submission_in_flight");
    for(const ref of[raw,execution.result_ref,execution.consent_ref]){const row=state.sqlite.prepare("SELECT content,redacted_at FROM private_content WHERE content_id=?").get(ref);assert.ok(row.content);assert.equal(row.redacted_at,null);}
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM assistant_specialist_tasks WHERE task_id=?").get(task.id).n,1);assert.deepEqual(consequentialBalances(state,"assistant-owner"),balances);
    assert.equal(state.sqlite.prepare("SELECT status FROM organizations WHERE organization_id=?").get(state.organizationId).status,"active");assert.equal(state.calls.length,1);
  }finally{restore?.();await state.cleanup();}
});
for(const kind of["legacy-token-only","legacy-active-cost","signed-unknown"])test("specialist lifecycle: tenant deletion cannot discard "+kind+" evidence after its mutable task row is lost",async()=>{
  const state=await specialistMockFixture({shared:true,respond:()=>{throw new TypeError("An original signed POST is unknown");}});
  try{
    let id,tokenId,costId;
    if(kind==="signed-unknown"){
      const {task}=await specialistApprovedTurn(state,"Explain the current document.");await state.drainBackground();id=task.id;tokenId=id+":tokens:0";costId=id+":usd:0";
    }else{
      const turn=await specialistFreeTurn(state),task=await seedLegacyAssistantTask(state,turn,{status:"queued",submitted:false});id=task.id;tokenId=task.tokenReservationId;costId=task.costReservationId;
      if(kind==="legacy-token-only"){await settleCostBudget(state.env,"assistant-owner",costId,0);}
    }
    state.sqlite.prepare("DELETE FROM assistant_specialist_tasks WHERE task_id=?").run(id);const finances=adaptiveReentryFinancialState(state);
    const removed=await deleteAssistantOrganization(state);assert.equal(removed.status,409,JSON.stringify(await removed.clone().json())+" SQL: "+state.controls.lastDatabaseError);
    const body=await removed.json();assert.equal(body.error,"provider_submission_in_flight");
    if(kind==="signed-unknown")assert.ok(body.assistantTasks.some(task=>task.taskId===id));else assert.ok(body.tokenReservations.some(row=>row.reservationId===tokenId));
    assert.deepEqual(adaptiveReentryFinancialState(state),finances);assert.equal(state.sqlite.prepare("SELECT status FROM organizations WHERE organization_id=?").get(state.organizationId).status,"active");
    assert.equal(state.calls.length,kind==="signed-unknown"?1:0);
  }finally{await state.cleanup();}
});
test("specialist lifecycle: legacy deletion resumes only its own durable unused cancellation after a crash",async()=>{
  const state=await specialistMockFixture({shared:true});let restore;
  try{
    const turn=await specialistFreeTurn(state),task=await seedLegacyAssistantTask(state,turn,{status:"queued",submitted:false});let fired=false;
    restore=interceptConsequentialDb(state,"run",/^\s*UPDATE assistant_specialist_tasks SET status='canceled'/u,()=>{fired=true;throw new Error("fixture crash after legacy unused cancellation");},"after");
    const first=await deleteAssistantOrganization(state);assert.equal(first.status,503,JSON.stringify(await first.clone().json()));assert.equal(fired,true);restore();restore=null;
    const stopped=state.sqlite.prepare("SELECT status,error_code,provider_submitted FROM assistant_specialist_tasks WHERE task_id=?").get(task.id);
    assert.deepEqual({...stopped},{status:"canceled",error_code:"organization_deleted",provider_submitted:0});assert.equal(state.sqlite.prepare("SELECT status FROM budget_reservations WHERE reservation_id=?").get(task.tokenReservationId).status,"active");
    const second=await deleteAssistantOrganization(state);assert.equal(second.status,200,JSON.stringify(await second.clone().json())+" SQL: "+state.controls.lastDatabaseError);
    assert.equal(state.sqlite.prepare("SELECT status FROM budget_reservations WHERE reservation_id=?").get(task.tokenReservationId).status,"released");
    assert.equal(state.sqlite.prepare("SELECT status FROM cost_budget_reservations WHERE reservation_id=?").get(task.costReservationId).status,"released");
    assert.deepEqual(consequentialBalances(state,"assistant-owner"),{tokens:{used:0,reserved:0},cost:{used:0,reserved:0}});assert.equal(state.calls.length,0);
  }finally{restore?.();await state.cleanup();}
});

/** Count actual executed statements, including batch members, per HTTP request only. */
async function deletionProgressAttempt(state){
 state.controls.requestQueryCount=0;state.controls.requestQueryLimit=1000;
 state.controls.queryLimitSql="";
 try{
  const response=await deleteAssistantOrganization(state),body=await response.json();
  assert.ok(state.controls.requestQueryCount<=1000,state.controls.queryLimitSql);
  assert.ok([200,503].includes(response.status),JSON.stringify(body)+" SQL: "+state.controls.lastDatabaseError);
  if(response.status===503){assert.equal(response.ok,false);assert.equal(body.status,"partial");assert.equal(body.retryable,true);
   assert.ok(body.assistantCleanup.attempted<=24);assert.equal(body.assistantCleanup.requestLimit,24);}
  return{status:response.status,body,queries:state.controls.requestQueryCount};
 }finally{state.controls.requestQueryLimit=0;}
}
function assistantDeletionBodies(state){
 return state.sqlite.prepare("SELECT COUNT(*) AS count FROM private_content WHERE content<>'' AND redacted_at IS NULL").get().count;
}
function restoreDeletionCostScopes(state,scopes){
 for(const row of scopes)state.sqlite.prepare("INSERT INTO project_budget_reservation_scopes(reservation_kind,reservation_id,organization_id,project_access_id,actor_user_id,workspace_scope_id,created_at) VALUES(?,?,?,?,?,?,?)")
     .run(row.reservation_kind,row.reservation_id,row.organization_id,row.project_access_id,row.actor_user_id,row.workspace_scope_id,row.created_at);
}
async function deletionSignedBacklog(state,count,{held=false,verified=false}={}){
 const reviews=[];
 for(let index=0;index<count;index++){
  state.controls.skipAssistantTaskClaimOnce=true;
  const {review}=await specialistApprovedTurn(state,"Retained deletion backlog "+index);
  await state.drainBackground();reviews.push(review);
 }
 for(let index=0;index<reviews.length;index++){
  if(!verified&&!held)continue;
  if(held==="alternating"&&index%2===0)continue;
  const review=reviews[index];await seedExpiredConsentedAssistantLease(state,review,{submitted:verified});
  if(verified){
   state.controls.failAssistantBillingCostSettlement=true;
   await assert.rejects(consequential.settleConsequentialStep(state.env,"assistant-owner",review.quote.executionId,0,1300,560,"verified-deletion-"+review.quote.executionId),/injected_assistant_billing_settlement_failure/u);
  }
 }
 assert.equal(state.calls.length,0);return reviews;
}
test("specialist deletion progress: 150 signed approvals resume without reprocessing released or absent holds",{timeout:30000},async()=>{
 const state=await specialistMockFixture({shared:true});
 try{
  await deletionSignedBacklog(state,150,{held:"alternating"});
  const bodies=assistantDeletionBodies(state),samples=[];let stopped=0,jobId;
  for(let attempt=0;attempt<10;attempt++){
   const sample=await deletionProgressAttempt(state);samples.push(sample.queries);
   const next=state.sqlite.prepare("SELECT COUNT(*) AS count FROM consequential_execution_steps WHERE status='not-submitted'").get().count;
   assert.ok(next>stopped,"Each explicit retry must make durable progress");assert.ok(next-stopped<=24);stopped=next;
   if(sample.status===200){assert.equal(stopped,150);assert.equal(sample.body.status,"completed");assert.equal(sample.body.jobId,jobId);break;}
   assert.ok(sample.body.jobId);jobId??=sample.body.jobId;assert.equal(sample.body.jobId,jobId);
   assert.equal(state.sqlite.prepare("SELECT status FROM organization_deletion_jobs WHERE job_id=?").get(jobId).status,"partial");
   assert.equal(assistantDeletionBodies(state),bodies,"No private erasure ahead of unfinished cleanup");
  }
  assert.equal(stopped,150);assert.equal(assistantDeletionBodies(state),0);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM budget_reservations WHERE status='released' AND used_tokens=0").get().count,75);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM cost_budget_reservations WHERE status='released' AND used_microusd=0").get().count,75);
  assert.deepEqual(consequentialBalances(state,"assistant-owner"),{tokens:{used:0,reserved:0},cost:{used:0,reserved:0}});
  assert.equal(state.calls.length,0);console.log("ASSISTANT_DELETION_SIGNED_150",JSON.stringify({queries:samples,requests:samples.length}));
 }finally{state.controls.requestQueryLimit=0;await state.cleanup();}
});
test("specialist deletion progress: 150 true legacy unused tasks release once and reach completion",{timeout:30000},async()=>{
 const state=await specialistMockFixture({shared:true});
 try{
  for(let index=0;index<150;index++){
   const turn=await specialistFreeTurn(state,"legacy-progress-"+index,"Retained legacy task "+index);
   await seedLegacyAssistantTask(state,turn,{status:"queued",submitted:false,id:"legacy-progress-task-"+String(index).padStart(4,"0")});
  }
  const bodies=assistantDeletionBodies(state),samples=[];let released=0,jobId;
  for(let attempt=0;attempt<10;attempt++){
   const sample=await deletionProgressAttempt(state);samples.push(sample.queries);
   const tokens=state.sqlite.prepare("SELECT COUNT(*) AS count FROM budget_reservations WHERE status='released' AND used_tokens=0").get().count;
   const costs=state.sqlite.prepare("SELECT COUNT(*) AS count FROM cost_budget_reservations WHERE status='released' AND used_microusd=0").get().count;
   assert.ok(tokens>released);assert.ok(tokens-released<=24);assert.equal(tokens,costs);released=tokens;
   if(sample.status===200){assert.equal(released,150);assert.equal(sample.body.jobId,jobId);break;}
   assert.ok(sample.body.jobId);jobId??=sample.body.jobId;assert.equal(sample.body.jobId,jobId);
   assert.equal(assistantDeletionBodies(state),bodies);
  }
  assert.equal(released,150);assert.equal(assistantDeletionBodies(state),0);
  assert.deepEqual(consequentialBalances(state,"assistant-owner"),{tokens:{used:0,reserved:0},cost:{used:0,reserved:0}});
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM assistant_billing_reconciliations").get().count,0,"Deletion is not an independent no-charge billing attestation");
  assert.equal(state.calls.length,0);console.log("ASSISTANT_DELETION_LEGACY_150",JSON.stringify({queries:samples,requests:samples.length}));
 }finally{state.controls.requestQueryLimit=0;await state.cleanup();}
});
test("specialist deletion progress: 150 verified receipts settle in bounded preflight chunks without repricing",{timeout:30000},async()=>{
 const state=await specialistMockFixture({shared:true});
 try{
  const reviews=await deletionSignedBacklog(state,150,{verified:true});
  const bodies=assistantDeletionBodies(state),samples=[];let settled=0;
  delete state.env.OPENAI_API_KEY;state.env.FORMA_ASSISTANT_ALLOWED_MODELS="gpt-5.6-sol";
  for(let attempt=0;attempt<10;attempt++){
   const sample=await deletionProgressAttempt(state);samples.push(sample.queries);
   const next=state.sqlite.prepare("SELECT COUNT(*) AS count FROM consequential_execution_steps WHERE status='settled'").get().count;
   assert.ok(next>settled);assert.ok(next-settled<=24);settled=next;
   assert.equal(consequentialBalances(state,"assistant-owner").cost.used,settled*560);
   if(sample.status===200){assert.equal(settled,150);break;}
   assert.equal(sample.body.error,"organization_assistant_reconciliation_incomplete");
   assert.equal(sample.body.jobId,undefined,"Unsettled receipts must not reopen destructive admission");
   assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM organization_deletion_jobs").get().count,0);
   assert.equal(assistantDeletionBodies(state),bodies);
  }
  assert.equal(settled,150);assert.equal(assistantDeletionBodies(state),0);
  assert.deepEqual(consequentialBalances(state,"assistant-owner"),{tokens:{used:195000,reserved:0},cost:{used:84000,reserved:0}});
  for(const review of reviews){const receipt=consequentialReceipt(state,review.quote.executionId);assert.equal(receipt.steps[0].verified_tokens,1300);assert.equal(receipt.steps[0].verified_microusd,560);assert.ok(receipt.steps[0].provider_request_id);}
  assert.equal(state.calls.length,0);console.log("ASSISTANT_DELETION_VERIFIED_150",JSON.stringify({queries:samples,requests:samples.length}));
 }finally{state.controls.requestQueryLimit=0;await state.cleanup();}
});
test("specialist deletion progress: accounting and cancellation share the same request allowance",{timeout:15000},async()=>{
 const state=await specialistMockFixture({shared:true});
 try{
  const reviews=await deletionSignedBacklog(state,42),bodies=assistantDeletionBodies(state);
  for(const review of reviews.slice(0,12)){
   await seedExpiredConsentedAssistantLease(state,review,{submitted:true});
   state.controls.failAssistantBillingCostSettlement=true;
   await assert.rejects(consequential.settleConsequentialStep(state.env,"assistant-owner",review.quote.executionId,0,1300,560,"mixed-"+review.quote.executionId),/injected_assistant_billing_settlement_failure/u);
  }
  const first=await deletionProgressAttempt(state);assert.equal(first.status,503);assert.equal(first.body.assistantCleanup.attempted,24);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM consequential_execution_steps WHERE status='settled'").get().count,12);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM consequential_execution_steps WHERE status='not-submitted'").get().count,12);
  assert.equal(assistantDeletionBodies(state),bodies);
  const second=await deletionProgressAttempt(state);assert.equal(second.status,200);assert.equal(second.body.jobId,first.body.jobId);
  assert.deepEqual(consequentialBalances(state,"assistant-owner"),{tokens:{used:15600,reserved:0},cost:{used:6720,reserved:0}});assert.equal(state.calls.length,0);
 }finally{state.controls.requestQueryLimit=0;await state.cleanup();}
});
test("specialist deletion progress: failed oldest verified receipts cannot starve later valid settlement",{timeout:20000},async()=>{
 const state=await specialistMockFixture({shared:true});
 try{
  const reviews=await deletionSignedBacklog(state,50,{verified:true}),blocked=reviews.slice(0,24).map(review=>review.quote.executionId),scopes=[];
  for(let index=0;index<reviews.length;index++)state.sqlite.prepare("UPDATE consequential_execution_steps SET updated_at=? WHERE execution_id=?")
    .run(index<24?"2000-01-01T00:00:00.000Z":"2001-01-01T00:00:00.000Z",reviews[index].quote.executionId);
  for(const id of blocked){
   scopes.push(state.sqlite.prepare("SELECT * FROM project_budget_reservation_scopes WHERE reservation_kind='usd' AND reservation_id=?").get(id+":usd:0"));
   state.sqlite.prepare("DELETE FROM project_budget_reservation_scopes WHERE reservation_kind='usd' AND reservation_id=?").run(id+":usd:0");
  }
  const bodies=assistantDeletionBodies(state);
  for(let attempt=0;attempt<3;attempt++){
   const sample=await deletionProgressAttempt(state);assert.equal(sample.status,503);assert.equal(assistantDeletionBodies(state),bodies);
  }
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM consequential_execution_steps WHERE status='settled'").get().count,26,"Later exact receipts advance past the broken prefix");
  for(const id of blocked){const step=consequentialReceipt(state,id).steps[0];assert.equal(step.status,"usage-recorded");assert.equal(step.verified_tokens,1300);assert.equal(step.verified_microusd,560);assert.equal(state.sqlite.prepare("SELECT status FROM cost_budget_reservations WHERE reservation_id=?").get(id+":usd:0").status,"executing");}
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM organization_deletion_jobs").get().count,0);
  assert.equal(consequentialBalances(state,"assistant-owner").cost.used,26*560);
  restoreDeletionCostScopes(state,scopes);
  const final=await deletionProgressAttempt(state);assert.equal(final.status,200);
  assert.deepEqual(consequentialBalances(state,"assistant-owner"),{tokens:{used:65000,reserved:0},cost:{used:28000,reserved:0}});assert.equal(state.calls.length,0);
 }finally{state.controls.requestQueryLimit=0;await state.cleanup();}
});
test("specialist deletion progress: contradictory paid ledgers are not mistaken for fully released cleanup",async()=>{
 const state=await specialistMockFixture({shared:true});
 try{
  const [review]=await deletionSignedBacklog(state,1,{held:true}),id=review.quote.executionId;
  await consequential.failConsequentialExecution(state.env,"assistant-owner",id,"organization_deleted");
  state.sqlite.prepare("UPDATE assistant_specialist_tasks SET status='canceled',error_code='organization_deleted' WHERE task_id=?").run(id);
  state.sqlite.prepare("UPDATE cost_budget_reservations SET status='settled',used_microusd=560 WHERE reservation_id=?").run(id+":usd:0");
  state.sqlite.prepare("UPDATE cost_budget_counters SET used_microusd=used_microusd+560 WHERE period=? AND ((scope='user' AND scope_id='assistant-owner') OR scope='workspace' AND scope_id IN('forma',?))")
    .run(new Date().toISOString().slice(0,7),state.organizationId);
  const balances=consequentialBalances(state,"assistant-owner"),bodies=assistantDeletionBodies(state);
  for(let attempt=0;attempt<2;attempt++){const sample=await deletionProgressAttempt(state);assert.equal(sample.status,503);assert.equal(assistantDeletionBodies(state),bodies);assert.deepEqual(consequentialBalances(state,"assistant-owner"),balances);}
  assert.equal(state.sqlite.prepare("SELECT used_microusd FROM cost_budget_reservations WHERE reservation_id=?").get(id+":usd:0").used_microusd,560);assert.equal(state.calls.length,0);
 }finally{state.controls.requestQueryLimit=0;await state.cleanup();}
});
test("specialist deletion progress: partial accounting uses the existing native retry path, never the success notice",async()=>{
 const {readFileSync}=await import("node:fs"),source=readFileSync(new URL("../src/components/forma-workspace-settings.ts",import.meta.url),"utf8");
 assert.match(source,/if\(!response\.ok\).*retryable:body\.retryable===true\|\|body\.status==="partial"/u);
 assert.match(source,/if\(error instanceof Error&&\(error as Error&\{retryable\?:boolean\}\)\.retryable\)await this\.#load\(\)/u);
 assert.match(source,/#deletionRecoveryControls\(\)/u);
 assert.match(source,/if\(deletion\.job&&\["pending","partial","processing"\]\.includes\(deletion\.job\.status\)\)/u);
});

test("specialist deletion progress: malformed receipt prefix remains blocked without starving valid usage",{timeout:15000},async()=>{
 const state=await specialistMockFixture({shared:true});
 try{
  const reviews=await deletionSignedBacklog(state,25,{verified:true}),invalid=reviews.slice(0,24).map(review=>review.quote.executionId);
  for(const id of invalid)state.sqlite.prepare("UPDATE consequential_execution_steps SET verified_tokens=NULL,updated_at='2000-01-01T00:00:00.000Z' WHERE execution_id=?").run(id);
  const bodies=assistantDeletionBodies(state),first=await deletionProgressAttempt(state);
  assert.equal(first.status,503);assert.equal(first.body.assistantCleanup.attempted,1);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM consequential_execution_steps WHERE status='settled'").get().count,1);
  assert.equal(consequentialBalances(state,"assistant-owner").cost.used,560);
  assert.equal(assistantDeletionBodies(state),bodies);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM organization_deletion_jobs").get().count,0);
  for(const id of invalid){
   const step=state.sqlite.prepare("SELECT status,verified_tokens,verified_microusd,updated_at FROM consequential_execution_steps WHERE execution_id=?").get(id);
   assert.deepEqual({...step},{status:"usage-recorded",verified_tokens:null,verified_microusd:560,updated_at:"2000-01-01T00:00:00.000Z"});
   state.sqlite.prepare("UPDATE consequential_execution_steps SET verified_tokens=1300 WHERE execution_id=?").run(id);
  }
  const final=await deletionProgressAttempt(state);assert.equal(final.status,200);
  assert.deepEqual(consequentialBalances(state,"assistant-owner"),{tokens:{used:32500,reserved:0},cost:{used:14000,reserved:0}});assert.equal(state.calls.length,0);
 }finally{state.controls.requestQueryLimit=0;await state.cleanup();}
});

for(const kind of["signed","legacy"])test("specialist deletion progress: "+kind+" unused custody failures rotate without repeating completed cleanup",{timeout:15000},async()=>{
 const state=await specialistMockFixture({shared:true});
 try{
  const tasks=[];
  if(kind==="signed"){
   const reviews=await deletionSignedBacklog(state,50,{held:true});
   for(const review of reviews)tasks.push({id:review.quote.executionId,costReservationId:review.quote.executionId+":usd:0"});
  }else for(let index=0;index<50;index++){
   const turn=await specialistFreeTurn(state,"legacy-fair-"+index,"Retained legacy fairness "+index);
   tasks.push(await seedLegacyAssistantTask(state,turn,{status:"queued",submitted:false,id:"legacy-fair-task-"+String(index).padStart(4,"0")}));
  }
  const blocked=tasks.slice(0,24),scopes=[];
  for(let index=0;index<tasks.length;index++){
   const timestamp=index<24?"2000-01-01T00:00:00.000Z":"2001-01-01T00:00:00.000Z";
   state.sqlite.prepare("UPDATE assistant_specialist_tasks SET updated_at=? WHERE task_id=?").run(timestamp,tasks[index].id);
   if(kind==="signed")state.sqlite.prepare("UPDATE consequential_executions SET updated_at=? WHERE execution_id=?").run(timestamp,tasks[index].id);
  }
  for(const task of blocked){
   scopes.push(state.sqlite.prepare("SELECT * FROM project_budget_reservation_scopes WHERE reservation_kind='usd' AND reservation_id=?").get(task.costReservationId));
   state.sqlite.prepare("DELETE FROM project_budget_reservation_scopes WHERE reservation_kind='usd' AND reservation_id=?").run(task.costReservationId);
  }
  const bodies=assistantDeletionBodies(state);let jobId;
  for(let attempt=0;attempt<3;attempt++){
   const sample=await deletionProgressAttempt(state);assert.equal(sample.status,503);
   jobId??=sample.body.jobId;assert.equal(sample.body.jobId,jobId);assert.equal(assistantDeletionBodies(state),bodies);
  }
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM assistant_specialist_tasks WHERE status='canceled' AND error_code='organization_deleted'").get().count,50);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM cost_budget_reservations WHERE status='released' AND used_microusd=0").get().count,26);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM budget_reservations WHERE status='released' AND used_tokens=0").get().count,50);
  assert.equal(consequentialBalances(state,"assistant-owner").cost.used,0);
  for(const task of blocked)assert.equal(state.sqlite.prepare("SELECT status FROM cost_budget_reservations WHERE reservation_id=?").get(task.costReservationId).status,kind==="signed"?"executing":"active");
  restoreDeletionCostScopes(state,scopes);
  const final=await deletionProgressAttempt(state);assert.equal(final.status,200);assert.equal(final.body.jobId,jobId);
  assert.deepEqual(consequentialBalances(state,"assistant-owner"),{tokens:{used:0,reserved:0},cost:{used:0,reserved:0}});assert.equal(state.calls.length,0);
 }finally{state.controls.requestQueryLimit=0;await state.cleanup();}
});

const {effectivePilotParticipantSql,effectivePilotReviewerSql}=await import("../worker/access-policy.ts");
const d1LegacyParticipantSql=(organizationId,userId)=>`NOT EXISTS(
  SELECT 1 FROM pilot_cohorts effective_cohort
  WHERE effective_cohort.organization_id=${organizationId} AND effective_cohort.status IN ('active','paused','closed')
    AND (effective_cohort.status!='closed' OR NOT EXISTS(
      SELECT 1 FROM pilot_cohorts effective_successor
      WHERE effective_successor.organization_id=effective_cohort.organization_id AND effective_successor.status IN ('active','paused')
    ))
    AND NOT EXISTS(
      SELECT 1 FROM pilot_participants effective_participant
      WHERE effective_participant.cohort_id=effective_cohort.cohort_id
        AND effective_participant.organization_id=effective_cohort.organization_id
        AND effective_participant.user_id=${userId}
        AND effective_participant.status='active' AND effective_participant.revoked_at IS NULL
    )
)`;
const d1LegacyReviewerSql=(organizationId,userId)=>`EXISTS(
SELECT 1 FROM pilot_cohorts reviewer_cohort
    JOIN pilot_participants reviewer_participant ON reviewer_participant.cohort_id=reviewer_cohort.cohort_id
      AND reviewer_participant.organization_id=reviewer_cohort.organization_id
  WHERE reviewer_cohort.organization_id=${organizationId} AND reviewer_cohort.status IN ('active','paused','closed')
    AND (reviewer_cohort.status!='closed' OR NOT EXISTS(
      SELECT 1 FROM pilot_cohorts reviewer_successor
      WHERE reviewer_successor.organization_id=reviewer_cohort.organization_id AND reviewer_successor.status IN ('active','paused')
    ))
    AND reviewer_participant.user_id=${userId} AND reviewer_participant.status='active'
    AND reviewer_participant.revoked_at IS NULL AND reviewer_participant.role='reviewer'
)`;

test("assistant d1 depth: policy anti-joins preserve original cohort, enrollment, reviewer and NULL decisions",async(t)=>{
  const state=await fixture(),db=new DatabaseSync(":memory:");
  // Exact production table constraints; unrelated destructive-lifecycle triggers are not under test.
  for(const name of["pilot_cohorts","pilot_participants"])db.exec(state.sqlite.prepare("SELECT sql FROM sqlite_master WHERE type=\'table\' AND name=?").get(name).sql);
  for(const row of state.sqlite.prepare("SELECT sql FROM sqlite_master WHERE type=\'index\' AND tbl_name IN(\'pilot_cohorts\',\'pilot_participants\') AND sql IS NOT NULL").all())db.exec(row.sql);
  const sql=db.prepare("SELECT "+d1LegacyParticipantSql("expected.organization_id","expected.user_id")+" AS old_participant,"
    +effectivePilotParticipantSql("expected.organization_id","expected.user_id")+" AS current_participant,"
    +d1LegacyReviewerSql("expected.organization_id","expected.user_id")+" AS old_reviewer,"
    +effectivePilotReviewerSql("expected.organization_id","expected.user_id")+" AS current_reviewer FROM(SELECT ? AS organization_id,? AS user_id) expected");
  const insertCohort=db.prepare("INSERT INTO pilot_cohorts(cohort_id,organization_id,status,starts_at,ends_at,created_by_user_id,created_at,updated_at) VALUES(?,?,?,'2000-01-01','2999-01-01','fixture','2000-01-01','2000-01-01')");
  const insertParticipant=db.prepare("INSERT INTO pilot_participants(participant_id,cohort_id,organization_id,email_normalized,user_id,role,status,invited_by_user_id,created_at,revoked_at) VALUES(?,?,?,?,?,?,?,'fixture','2000-01-01',?)");
  const layouts=[[],["active"],["paused"],["closed"],["draft"],["closed","active"],["closed","paused"],
    ["active","paused"],["closed","closed"],["closed","foreign:active"],["foreign:active"],["closed","active","paused"]];
  const enrollments=[
    null,{user:"depth-user",status:"active",role:"member",revoked:null},
    {user:"depth-user",status:"active",role:"reviewer",revoked:null},
    {user:"foreign-user",status:"active",role:"reviewer",revoked:null},
    {user:null,status:"active",role:"reviewer",revoked:null},
    {user:"depth-user",status:"invited",role:"reviewer",revoked:null},
    {user:"depth-user",status:"paused",role:"reviewer",revoked:null},
    {user:"depth-user",status:"removed",role:"reviewer",revoked:null},
    {user:"depth-user",status:"active",role:"reviewer",revoked:"2000-01-01"},
    {user:"depth-user",status:"active",role:"reviewer",revoked:null,foreignOrganization:true},
    {user:"depth-user",status:"active",role:"member",revoked:null,foreignCohort:true},
  ];
  const scopes=[["depth-org","depth-user"],["depth-org","foreign-user"],["foreign-org","depth-user"],["depth-org",null],[null,"depth-user"]];
  const combinations=count=>count===0?[[]]:combinations(count-1).flatMap(prefix=>enrollments.map(enrollment=>[...prefix,enrollment]));
  let cases=0;
  for(const layout of layouts)for(const selected of combinations(layout.length)){
    db.exec("DELETE FROM pilot_participants; DELETE FROM pilot_cohorts;");
    const cohorts=layout.map((entry,index)=>({id:"depth-cohort-"+index,organization:entry.startsWith("foreign:")?"foreign-org":"depth-org",status:entry.replace("foreign:","")}));
    const participants=[];
    for(const [index,cohort]of cohorts.entries()){
      insertCohort.run(cohort.id,cohort.organization,cohort.status);
      const enrollment=selected[index];
      if(enrollment){
        const row={...enrollment,cohort:enrollment.foreignCohort?"missing-cohort-"+index:cohort.id,organization:enrollment.foreignOrganization?"foreign-enrollment-org":cohort.organization};
        participants.push(row);insertParticipant.run("depth-participant-"+index,row.cohort,row.organization,"depth-participant-"+index+"@example.test",row.user,row.role,row.status,row.revoked);
        // A second ineligible row must not negate an existing eligible match or multiply access.
        insertParticipant.run("depth-duplicate-"+index,cohort.id,cohort.organization,"depth-duplicate-"+index+"@example.test","other-user","reviewer","active",null);
      }
    }
    for(const [organization,user]of scopes){
      const row=sql.get(organization,user),label=JSON.stringify({layout,selected,organization,user});
      const effective=cohorts.filter(cohort=>cohort.organization===organization&&["active","paused","closed"].includes(cohort.status)
        &&(cohort.status!=="closed"||!cohorts.some(other=>other.organization===cohort.organization&&["active","paused"].includes(other.status))));
      const matches=(participant,cohort)=>user!==null&&participant.cohort===cohort.id&&participant.organization===cohort.organization
        &&participant.user===user&&participant.status==="active"&&participant.revoked===null;
      assert.equal(row.current_participant,row.old_participant,label);
      assert.equal(row.current_reviewer,row.old_reviewer,label);
      assert.equal(row.current_participant,Number(effective.every(cohort=>participants.some(participant=>matches(participant,cohort)))),label);
      assert.equal(row.current_reviewer,Number(effective.some(cohort=>participants.some(participant=>matches(participant,cohort)&&participant.role==="reviewer"))),label);
      cases++;
    }
  }
  assert.ok(cases>9000);t.diagnostic(cases+" original/current policy decisions agree, including independent expected outcomes");db.close();
});

test("assistant d1 depth: custody tuples retain all original fields, NULL denial and SQLite affinities",async(t)=>{
  const state=await fixture(),db=state.sqlite;
  const binding={actorUserId:"depth-actor",scope:{projectAccessId:"depth-access",organizationId:"depth-org",projectId:"depth-project",ownerUserId:"depth-owner"}};
  const current=consequential.executionContentCustodyGuard(binding,"content");
  assert.deepEqual(current.bindings,["depth-access","depth-org","depth-project","depth-owner","depth-actor"]);
  const legacy="EXISTS(SELECT 1 FROM project_resource_scopes resource JOIN private_content_retention_scopes retention "
    +"ON retention.content_id=resource.resource_id AND retention.organization_id=resource.organization_id AND retention.project_access_id=resource.project_access_id "
    +"AND retention.project_id=resource.project_id AND retention.actor_user_id=resource.actor_user_id "
    +"WHERE resource.resource_kind='content' AND resource.resource_id=content.content_id AND resource.visibility='actor_private' "
    +"AND resource.project_access_id=? AND resource.organization_id=? AND resource.project_id=? AND resource.owner_user_id=? AND resource.actor_user_id=?)";
  // Reuse the actual production table definitions (including TEXT affinities/NOT NULL).
  const columns={
    resource:db.prepare("PRAGMA table_info(project_resource_scopes)").all(),
    retention:db.prepare("PRAGMA table_info(private_content_retention_scopes)").all(),
  };
  const resource={resource_kind:"content",resource_id:"depth-content",project_access_id:"depth-access",organization_id:"depth-org",project_id:"depth-project",owner_user_id:"depth-owner",actor_user_id:"depth-actor",visibility:"actor_private",created_at:"2000-01-01"};
  const retention={content_id:"depth-content",organization_id:"depth-org",project_access_id:"depth-access",project_id:"depth-project",actor_user_id:"depth-actor",classification:"test",policy_version:1,assigned_expires_at:"2999-01-01",created_at:"2000-01-01"};
  const compare=db.prepare("SELECT "+legacy+" AS legacy,"+current.sql+" AS current FROM(SELECT ? AS content_id) content");
  const insert=(table,record)=>{const keys=Object.keys(record);db.prepare("INSERT INTO "+table+"("+keys.join(",")+") VALUES("+keys.map(()=>"?").join(",")+")").run(...Object.values(record));};
  const variants=[{name:"exact",resource,retention,contentId:"depth-content",bindings:current.bindings,allowed:1},
    {name:"missing resource",resource:null,retention,contentId:"depth-content",bindings:current.bindings,allowed:0},
    {name:"missing retention",resource,retention:null,contentId:"depth-content",bindings:current.bindings,allowed:0},
    {name:"NULL selected content",resource,retention,contentId:null,bindings:current.bindings,allowed:0},
    {name:"foreign selected content",resource,retention,contentId:"foreign-content",bindings:current.bindings,allowed:0}];
  for(const [kind,record]of Object.entries({resource,retention}))for(const key of (kind==="resource"?["resource_kind","resource_id","visibility","project_access_id","organization_id","project_id","owner_user_id","actor_user_id"]:["content_id","organization_id","project_access_id","project_id","actor_user_id"])){
    variants.push({name:kind+" wrong "+key,resource,retention,[kind]:{...record,[key]:"foreign"},contentId:"depth-content",bindings:current.bindings,allowed:0});
    if(columns[kind].find(column=>column.name===key)?.notnull===0)variants.push({name:kind+" NULL "+key,resource,retention,[kind]:{...record,[key]:null},contentId:"depth-content",bindings:current.bindings,allowed:0});
  }
  for(let index=0;index<current.bindings.length;index++)for(const value of[null,"foreign",0,1,"",true]){
    const bindings=[...current.bindings];bindings[index]=value===true?1:value;
    variants.push({name:"binding "+index+" "+value,resource,retention,contentId:"depth-content",bindings,allowed:0});
  }
  // SQLite converts inserted numbers to TEXT in the real schema; tuple comparison must
  // preserve the same column affinity as each original comparison against a bound value.
  for(const value of[0,1,12,1.25,"01","1e1","",null]){
    variants.push({name:"content-id affinity "+value,resource:{...resource,resource_id:String(value)},retention:{...retention,content_id:String(value)},contentId:value,bindings:current.bindings});
    variants.push({name:"scope affinity "+value,resource:{...resource,project_access_id:String(value)},retention:{...retention,project_access_id:String(value)},contentId:"depth-content",bindings:[value,...current.bindings.slice(1)]});
  }
  for(const variant of variants){
    db.exec("DELETE FROM project_resource_scopes; DELETE FROM private_content_retention_scopes;");
    if(variant.resource)insert("project_resource_scopes",variant.resource);
    if(variant.retention)insert("private_content_retention_scopes",variant.retention);
    const result=compare.get(...variant.bindings,...variant.bindings,variant.contentId);
    assert.equal(result.current,result.legacy,variant.name);
    if(variant.allowed!==undefined)assert.equal(result.current,variant.allowed,variant.name);
  }
  t.diagnostic(variants.length+" original/current custody predicates agree with original binding order");
});


import { compileSqliteExpressionDepth, enforceD1ExpressionDepth } from "./helpers/d1-expression-depth.mjs";

test("assistant d1 depth: the real depth-100 preflight rejects before fixture preparation or execution",()=>{
  const sqlite=new DatabaseSync(":memory:"),sql="SELECT "+Array(125).fill("1").join(" AND ")+" AS permitted";
  assert.equal(sqlite.prepare(sql).get().permitted,1,"Default Node SQLite would conceal this D1 failure");
  assert.equal(compileSqliteExpressionDepth(sqlite,sql,{limit:1000}).ok,true);
  const rejected=compileSqliteExpressionDepth(sqlite,sql);
  assert.equal(rejected.ok,false);assert.match(rejected.error,/Expression tree is too large \(maximum depth 100\)/u);
  let prepared=0;const state={sqlite,env:{DB:{prepare(){prepared++;}}}},guard=enforceD1ExpressionDepth(state);
  try{assert.throws(()=>state.env.DB.prepare(sql),/maximum depth 100/u);assert.equal(prepared,0);assert.equal(guard.failures.length,1);}
  finally{guard.restore();sqlite.close();}
});

for(const shared of[false,true])test("assistant d1 depth: actual Document and Canvas consent lifecycle compiles before execution "+(shared?"shared":"personal"),async(t)=>{
  const state=await specialistMockFixture({shared}),depth=enforceD1ExpressionDepth(state);
  try{
    if(shared)state.sqlite.prepare("UPDATE users SET role='admin' WHERE user_id='assistant-owner'").run();
    const canvas=specialistCanvasEvents(state),headers=state.owner??{};
    for(const route of["/projects","/document/doc-atmosphere",canvas.route]){
      const response=await state.request(endpoint(route),{headers});assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
    }
    let calls=0;
    for(const [index,options]of[{},canvas].entries()){
      for(let generation=0;generation<2;generation++){
        const turn=await specialistFreeTurn(state,"depth-"+index+"-"+generation,"Review the exact original conversation and current document.",options);
        const review=await specialistQuote(state,turn.id,undefined,options);
        assert.equal(state.calls.length,calls,"Send and quote stay free");
        const approved=await specialistExecute(state,review,options);assert.equal(approved.status,202,JSON.stringify(await approved.clone().json()));
        await state.drainBackground();assert.equal(state.calls.length,++calls);
        const retrieved=await specialistRetrieve(state,review,options),body=await retrieved.json();
        assert.equal(retrieved.status,200,JSON.stringify(body));assert.equal(body.result.reply,"PRIVATE_VERIFIED_SPECIALIST_REPLY");
        const resumed=await specialistProtocolRequest(state,{action:"resume",turnId:turn.id,executionId:review.quote.executionId},options);
        assert.equal(resumed.status,200,JSON.stringify(await resumed.clone().json()));
        const before=specialistFeedSnapshot(state),trace=specialistFeedTrace(state);
        try{
          const feed=await state.request(endpoint(options.route),{headers}),shown=await feed.json();
          assert.equal(feed.status,200,JSON.stringify(shown));
          assert.equal(shown.tasks.find(task=>task.id===review.quote.executionId)?.certifiedCompleted,true);
          assertSpecialistFeedReadOnly(state,before,trace,calls);assert.equal(state.calls.length,calls);
        }finally{trace.restore();}
      }
    }
    state.controls.skipAssistantTaskClaimOnce=true;
    const queued=await specialistApprovedTurn(state,"Prepare a cancelable exact request.");await state.drainBackground();
    const canceled=await state.request(taskEndpoint(queued.task.id,"cancel"),{method:"POST",headers}),cancelBody=await canceled.json();
    assert.equal(canceled.status,200,JSON.stringify(cancelBody));assert.equal(cancelBody.task.status,"canceled");assert.equal(state.calls.length,calls);
    const actor=shared?"assistant-owner":"dev-local-creative";
    const orphan=await reserveBudget(state.env,actor,200,{reservationId:"depth-orphan",streamId:"creative:"+actor,correlationId:"depth-orphan",operation:"ordinary-test-operation"});
    assert.equal(orphan.ok,true);ageAssistantReservations(state);
    const repaired=await sweepAssistantReservations(state);assert.equal(repaired.releasedTokens,200);
    await state.drainBackground();depth.assertVerified();
    assert.ok(depth.records.length>=100,"Exercise the full real request-query inventory");
    t.diagnostic(depth.records.length+" byte-exact SQL/schema shapes compiled with SQLITE_LIMIT_EXPR_DEPTH=100 before fixture preparation");
  }finally{depth.restore();await state.cleanup();}
});

for(const shared of[false,true])test("assistant d1 depth: signed cleanup and cancellation never guess away submitted usage "+(shared?"shared":"personal"),async(t)=>{
  const state=await specialistMockFixture({shared}),depth=enforceD1ExpressionDepth(state);
  try{
    state.controls.skipAssistantTaskClaimOnce=true;const {review,task}=await specialistApprovedTurn(state,"Review this exact source.");await state.drainBackground();
    await seedExpiredConsentedAssistantLease(state,review,{submitted:true});
    const canceled=await state.request(taskEndpoint(task.id,"cancel"),{method:"POST",headers:state.owner??{}}),body=await canceled.json();
    assert.equal(canceled.status,200,JSON.stringify(body));assert.equal(body.task.submission,"uncertain");
    ageAssistantReservations(state);const finances=adaptiveReentryFinancialState(state),result=await sweepAssistantReservations(state);
    assert.equal(result.releasedTokens,0);assert.deepEqual(adaptiveReentryFinancialState(state),finances);
    if(shared){
      const removed=await deleteAssistantOrganization(state),failure=await removed.json();
      assert.equal(removed.status,409,JSON.stringify(failure));assert.equal(failure.error,"provider_submission_in_flight");
      assert.deepEqual(adaptiveReentryFinancialState(state),finances);
    }
    assert.equal(state.calls.length,0);depth.assertVerified();
    t.diagnostic(depth.records.length+" signed cleanup/cancel SQL shapes verified before execution");
  }finally{depth.restore();await state.cleanup();}
});

test("assistant d1 depth: final read-only feed still rejects each private withdrawal and current authority change",async(t)=>{
  const state=await specialistMockFixture({shared:true}),depth=enforceD1ExpressionDepth(state);let restore;
  try{
    const{turn,review}=await specialistFeedCompleted(state,"depth-final-feed"),pointers=specialistFeedPointers(state,turn,review);
    const original=new Map(Object.values(pointers).map(ref=>[ref,state.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(ref)]));
    for(const target of["canonical","consent","answer","authored"]){
      let fired=false;restore=interceptConsequentialDb(state,"batch",/AS certified_completed/u,()=>{
        fired=true;specialistFeedWithdrawal(state,pointers,target,"redacted");
      });
      const response=await state.request(endpoint(),{headers:state.owner}),body=await response.json();restore();restore=null;
      assert.equal(fired,true);assert.equal(response.status,200,JSON.stringify(body));
      assert.equal(assertSpecialistFeedNoCertificate(body,review).retentionUnavailable,true);
      assert.equal(body.turns.some(item=>item.id===turn.id),false);assert.doesNotMatch(JSON.stringify(body),/PRIVATE_VERIFIED_SPECIALIST_REPLY/u);
      const row=original.get(pointers[target]);state.sqlite.prepare("UPDATE private_content SET content=?,redacted_at=? WHERE content_id=?").run(row.content,row.redacted_at,row.content_id);
    }
    for(const target of["answer","authored"]){
      restore=interceptConsequentialDb(state,"batch",/AS certified_completed/u,()=>state.sqlite.prepare("UPDATE private_content SET content='different final private bytes' WHERE content_id=?").run(pointers[target]));
      const response=await state.request(endpoint(),{headers:state.owner}),body=await response.json();restore();restore=null;
      assert.equal(response.status,200);assert.equal(body.turns.some(item=>item.id===turn.id),false);
      assert.equal(body.context.recentTurns.some(item=>item.id.startsWith(turn.id+":")),false);
      if(target==="answer"){assertSpecialistFeedNoCertificate(body,review);assert.doesNotMatch(JSON.stringify(body),/PRIVATE_VERIFIED_SPECIALIST_REPLY/u);}
      else assert.equal(body.tasks.find(task=>task.id===review.quote.executionId)?.completedReview?.result.reply,"PRIVATE_VERIFIED_SPECIALIST_REPLY","A retained original review is not reconstructed from the changed chat message");
      assert.doesNotMatch(JSON.stringify(body),/different final private bytes/u);
      const row=original.get(pointers[target]);state.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id=?").run(row.content,row.content_id);
    }
    restore=interceptConsequentialDb(state,"batch",/AS certified_completed/u,()=>state.sqlite.prepare("UPDATE users SET consent_version='' WHERE user_id='assistant-owner'").run());
    const denied=await state.request(endpoint(),{headers:state.owner}),body=await denied.json();
    assert.equal(denied.status,403);assert.equal(body.error,"assistant_read_scope_denied");
    assert.equal(body.tasks,undefined);assert.equal(body.turns,undefined);assert.doesNotMatch(JSON.stringify(body),/PRIVATE_VERIFIED_SPECIALIST_REPLY/u);
    assert.equal(state.calls.length,1);depth.assertVerified();t.diagnostic(depth.records.length+" final read/custody proof SQL shapes verified");
  }finally{restore?.();depth.restore();await state.cleanup();}
});

test("assistant d1 depth: verified shared-document cleanup compiles before destructive statements",async(t)=>{
  const state=await specialistMockFixture({shared:true}),depth=enforceD1ExpressionDepth(state);
  try{
    const{review}=await specialistFeedCompleted(state,"depth-verified-cleanup");
    const receipt=consequentialReceipt(state,review.quote.executionId),before=consequentialBalances(state,"assistant-owner");
    assert.equal(receipt.steps[0].status,"settled");
    const deleted=await deleteAssistantOrganization(state),body=await deleted.json();
    assert.equal(deleted.status,200,JSON.stringify(body));assert.equal(body.status,"completed");
    const after=consequentialReceipt(state,review.quote.executionId);
    assert.equal(after.execution.status,"completed");assert.equal(after.steps[0].status,"settled");
    assert.deepEqual(consequentialBalances(state,"assistant-owner"),before);assert.equal(state.calls.length,1);
    depth.assertVerified();t.diagnostic(depth.records.length+" verified cleanup SQL shapes checked before execution");
  }finally{depth.restore();await state.cleanup();}
});

test("assistant d1 depth: compile-only custom row gates retain their signatures and never execute",()=>{
  const sqlite=new DatabaseSync(":memory:");let calls=0;
  sqlite.function("depth_test_row_gate",{deterministic:true},()=>{calls++;return 1;});
  sqlite.exec("CREATE TABLE depth_gate(value TEXT); CREATE TRIGGER depth_gate_proof BEFORE INSERT ON depth_gate BEGIN SELECT depth_test_row_gate(); END;");
  const sql="INSERT INTO depth_gate(value) VALUES(?)";
  assert.equal(compileSqliteExpressionDepth(sqlite,sql,{bindings:["mocked-row"]}).ok,true);
  assert.equal(calls,0);assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM depth_gate").get().count,0);
  sqlite.prepare(sql).run("mocked-row");assert.equal(calls,1,"The real fixture gate still runs only with the actual write");
  sqlite.close();
});

/** Reuse the actual routed SQLite fixture, with native D1 depth and statement-size gates. */
async function assistantR2DepthFixture(options={}){
 const state=await specialistMockFixture(options),depth=enforceD1ExpressionDepth(state),trace=specialistFeedTrace(state);
 return{...state,depth,trace,async cleanup(){
  try{
   await state.cleanup();depth.assertVerified();
   for(const statement of trace.statements){assert.ok(statement.bindings<=100,statement.bindings+" bindings");assert.ok(statement.bytes<=100_000,statement.bytes+" SQL bytes");}
  }finally{trace.restore();depth.restore();}
 }};
}

function assistantR2RevokeSession(state,kind="revoked"){
 const sql=kind==="expired"?"UPDATE project_context_sessions SET expires_at='2000-01-01T00:00:00.000Z' WHERE principal_user_id=? AND project_access_id=?":"UPDATE project_context_sessions SET revoked_at=? WHERE principal_user_id=? AND project_access_id=?";
 const actor=state.owner?.["oai-authenticated-user-id"]??"dev-local-creative";
 const changed=kind==="expired"?state.sqlite.prepare(sql).run(actor,state.projectAccessId):state.sqlite.prepare(sql).run(new Date().toISOString(),actor,state.projectAccessId);
 assert.ok(changed.changes>0);
}
async function assistantR2EditorFixture(){
 const original=await assistantR2DepthFixture({shared:true});
 original.sqlite.prepare("UPDATE users SET role='creator' WHERE user_id='assistant-viewer'").run();
 original.sqlite.prepare("UPDATE project_memberships SET role='editor',updated_at=? WHERE user_id='assistant-viewer' AND project_access_id=?").run(new Date().toISOString(),original.projectAccessId);
 return{...original,owner:original.viewer};
}
async function assistantR2Queued(state,{reserve=true}={}){
 state.controls.skipAssistantTaskClaimOnce=true;
 const approved=await specialistApprovedTurn(state,"Review the exact retained source.");
 await state.drainBackground();if(reserve)await seedExpiredConsentedAssistantLease(state,approved.review);
 return approved;
}
function assistantR2Financial(state){return{...specialistFeedSnapshot(state),providerCalls:state.calls.length};}

for(const action of["feed","resume","quote"])test("assistant authority R2: revoked CURRENT selected session withholds "+action,async()=>{
 const state=await assistantR2DepthFixture({shared:true});let restore;
 try{
  const {turn,review}=action==="quote"?{turn:await specialistFreeTurn(state,"r2-old-free-quote"),review:null}:await specialistFeedCompleted(state,"r2-old-paid-"+action);
  const pattern=action==="feed"?/AS certified_completed/u:action==="resume"?/AS result_retained/u:/^SELECT 1 AS retained WHERE/u;
  let fired=false;restore=interceptConsequentialDb(state,action==="feed"?"batch":"first",pattern,()=>{fired=true;assistantR2RevokeSession(state);});
  const response=action==="feed"?await state.request(endpoint(),{headers:state.owner}):action==="resume"?await specialistProtocolRequest(state,{action:"resume",turnId:turn.id,executionId:review.quote.executionId}):await specialistProtocolRequest(state,{action:"quote",turnId:turn.id});
  const body=await response.json();assert.equal(fired,true);assert.ok([403,404].includes(response.status),JSON.stringify(body));
  assert.equal(body.quote,undefined);assert.equal(body.tasks,undefined);assert.doesNotMatch(JSON.stringify(body),/PRIVATE_VERIFIED_SPECIALIST_REPLY|providerRequest/u);
 }finally{restore?.();await state.cleanup();}
});
test("assistant authority R2: downgraded viewer cannot stop or release holds",async()=>{
 const state=await assistantR2EditorFixture();
 try{
  const {task}=await assistantR2Queued(state),before=assistantR2Financial(state);
  state.sqlite.prepare("UPDATE project_memberships SET role='viewer',updated_at=? WHERE user_id='assistant-viewer' AND project_access_id=?").run(new Date().toISOString(),state.projectAccessId);
  const response=await state.request(taskEndpoint(task.id,"cancel"),{method:"POST",headers:state.owner}),body=await response.json();
  assert.equal(response.status,403,JSON.stringify(body));assert.equal(body.error,"assistant_stop_scope_denied");
  assert.deepEqual(assistantR2Financial(state),before);
 }finally{await state.cleanup();}
});
test("assistant authority R2: Stop authorization loss after read prevents mutation and release",async()=>{
 const state=await assistantR2EditorFixture();let restore;
 try{
  const {task}=await assistantR2Queued(state),before=assistantR2Financial(state);let fired=false;
  restore=interceptConsequentialDb(state,"first",/^SELECT 1 AS current WHERE[\s\S]*specialistConsentVersion/u,()=>{
   fired=true;state.sqlite.prepare("UPDATE project_memberships SET status='revoked',revoked_at=? WHERE user_id='assistant-viewer' AND project_access_id=?").run(new Date().toISOString(),state.projectAccessId);
  },"after");
  const response=await state.request(taskEndpoint(task.id,"cancel"),{method:"POST",headers:state.owner}),body=await response.json();
  assert.equal(fired,true);assert.equal(response.status,409,JSON.stringify(body));assert.equal(body.error,"assistant_stop_unconfirmed");assert.deepEqual(assistantR2Financial(state),before);
  assert.equal(state.sqlite.prepare("SELECT status FROM assistant_specialist_tasks WHERE task_id=?").get(task.id).status,"running");
 }finally{restore?.();await state.cleanup();}
});
for(const paid of["settled","uncertain"])test("assistant authority R2: generic catch does not assert unused on "+paid+" receipt failure",async()=>{
 const state=await assistantR2DepthFixture(paid==="uncertain"?{respond:()=>{throw new TypeError("Unknown original POST");}}:{});let restore;
 try{
  const {review,task}=await specialistApprovedTurn(state,"Review the exact retained source.");await state.drainBackground();
  const original=consequentialReceipt(state,task.id);assert.equal(state.calls.length,1);if(paid==="settled")assert.equal(original.cost[0].used_microusd,560);else assert.ok(original.balances.cost.reserved>0);
  const before=assistantR2Financial(state);
  restore=interceptConsequentialDb(state,"first",/^SELECT \* FROM consequential_executions WHERE execution_id=/u,()=>{throw new Error("fixture transient original receipt read");});
  const response=await specialistRetrieve(state,review),body=await response.json();
  assert.equal(response.status,409);assert.equal(body.submission,undefined);assert.equal(body.unusedExecution,undefined);assert.deepEqual(assistantR2Financial(state),before);
 }finally{restore?.();await state.cleanup();}
});
test("assistant authority R2: original unused recovery has a certified refresh marker",async()=>{
 const state=await assistantR2DepthFixture();
 try{
  const turn=await specialistFreeTurn(state,"r2-original-unused"),review=await specialistQuote(state,turn.id),response=await specialistRetrieve(state,review),body=await response.json();
  assert.equal(response.status,200);assert.equal(body.quote.status,"quoted");assert.equal(body.task,undefined);assert.equal(body.unusedExecution,true);assert.equal(body.quote.canExecute,false);assert.equal(state.calls.length,0);
 }finally{await state.cleanup();}
});

for(const action of["feed","resume","quote"])test("assistant authority R2: expired CURRENT selected session withholds "+action+" private material at final read",async()=>{
 const state=await assistantR2DepthFixture({shared:true});let restore;
 try{
  const {turn,review}=action==="quote"?{turn:await specialistFreeTurn(state,"r2-expiring-quote"),review:null}:await specialistFeedCompleted(state,"r2-expiring-"+action);
  let fired=false;restore=interceptConsequentialDb(state,action==="feed"?"batch":"first",action==="feed"?/AS certified_completed/u:action==="resume"?/AS result_retained/u:/^SELECT 1 AS retained WHERE/u,()=>{fired=true;assistantR2RevokeSession(state,"expired");});
  const response=action==="feed"?await state.request(endpoint(),{headers:state.owner}):action==="resume"?await specialistProtocolRequest(state,{action:"resume",turnId:turn.id,executionId:review.quote.executionId}):await specialistProtocolRequest(state,{action:"quote",turnId:turn.id}),body=await response.json();
  assert.equal(fired,true);assert.ok([403,404].includes(response.status),JSON.stringify(body));
  assert.equal(body.quote,undefined);assert.equal(body.tasks,undefined);assert.equal(body.unusedExecution,undefined);
  assert.doesNotMatch(JSON.stringify(body),/PRIVATE_VERIFIED_SPECIALIST_REPLY|providerRequest/u);
 }finally{restore?.();await state.cleanup();}
});
test("assistant authority R2: cookie-free owner reads remain valid after an unrelated selected session expires",async()=>{
 const state=await assistantR2DepthFixture({shared:true});
 try{
  const {turn,review}=await specialistFeedCompleted(state,"r2-cookie-free-owner"),before=assistantR2Financial(state);
  assistantR2RevokeSession(state,"expired");const{cookie,...headers}=state.owner;assert.ok(cookie);
  const resumed=await specialistProtocolRequest(state,{action:"resume",turnId:turn.id,executionId:review.quote.executionId},{headers}),body=await resumed.json();
  assert.equal(resumed.status,200,JSON.stringify(body));assert.equal(body.result.reply,"PRIVATE_VERIFIED_SPECIALIST_REPLY");assert.equal(body.quote.canExecute,false);
  const feed=await state.request(endpoint(),{headers});assert.equal(feed.status,200);assert.equal((await feed.json()).tasks.find(task=>task.id===review.quote.executionId)?.certifiedCompleted,true);
  assert.deepEqual(assistantR2Financial(state),before);
 }finally{await state.cleanup();}
});
test("assistant authority R2: renewed current reader session does not depend on the original approval session",async()=>{
 const state=await assistantR2EditorFixture();
 try{
  const {turn,review}=await specialistFeedCompleted(state,"r2-renewed-reader");
  assistantR2RevokeSession(state,"expired");
  state.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id='assistant-viewer'").run();
  state.sqlite.prepare("UPDATE project_memberships SET role='viewer' WHERE user_id='assistant-viewer' AND project_access_id=?").run(state.projectAccessId);
  const{cookie,...identity}=state.owner;assert.ok(cookie);
  const renewed=await state.request("/api/workspaces/"+state.organizationId+"/projects/"+state.projectAccessId+"/context",{method:"POST",headers:identity});
  assert.equal(renewed.status,200,JSON.stringify(await renewed.clone().json()));
  const headers={...identity,cookie:renewed.headers.get("set-cookie").split(";")[0]},before=assistantR2Financial(state);
  assert.notEqual(headers.cookie,cookie);
  for(const action of["retrieve","resume"]){
   const response=await specialistProtocolRequest(state,{action,turnId:turn.id,executionId:review.quote.executionId,...(action==="retrieve"?{approvedBindingHash:review.quote.bindingHash}:{})},{headers}),body=await response.json();
   assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.result.reply,"PRIVATE_VERIFIED_SPECIALIST_REPLY");assert.equal(body.quote.canExecute,false);assert.equal(body.unusedExecution,undefined);
  }
  assert.deepEqual(assistantR2Financial(state),before);
 }finally{await state.cleanup();}
});
for(const shared of[false,true])test("assistant authority R2: current authorized Stop ignores provider/model/budget/month purchase eligibility "+shared,async()=>{
 const state=shared?await assistantR2EditorFixture():await assistantR2DepthFixture();let clock;
 try{
  const {review,task}=await assistantR2Queued(state);
  delete state.env.OPENAI_API_KEY;state.env.FORMA_ASSISTANT_ALLOWED_MODELS="";state.env.FORMA_ASSISTANT_PROVIDER_USER_IDS="";
  state.sqlite.prepare("UPDATE cost_budget_counters SET hard_limit_microusd=0").run();
  state.sqlite.prepare("UPDATE private_content SET expires_at='2099-01-01T00:00:00.000Z' WHERE redacted_at IS NULL").run();
  state.sqlite.prepare("UPDATE project_context_sessions SET expires_at='2099-01-01T00:00:00.000Z' WHERE revoked_at IS NULL").run();
  clock=consequentialDbClock(state);clock.set(new Date(Date.UTC(Number(review.quote.period.slice(0,4)),Number(review.quote.period.slice(5,7)),1)).toISOString());
  const response=await state.request(taskEndpoint(task.id,"cancel"),{method:"POST",headers:state.owner??{}}),body=await response.json();
  assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.task.status,"canceled");assert.equal(body.task.submission,"not-submitted");
  const receipt=consequentialReceipt(state,task.id);assert.equal(receipt.steps[0].status,"not-submitted");assert.ok(receipt.tokens.every(row=>row.status==="released"));assert.ok(receipt.cost.every(row=>row.status==="released"));assert.equal(state.calls.length,0);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM assistant_action_commits WHERE commit_id=?").get("specialist-stop:"+task.id).count,1);
 }finally{clock?.close();await state.cleanup();}
});
for(const change of["session","expired session","consent","membership","author role"])test("assistant authority R2: "+change+" loss at Stop mutation boundary has zero Stop or budget effects",async()=>{
 const state=await assistantR2EditorFixture();let restore;
 try{
  const {review,task}=await assistantR2Queued(state);let fired=false;
  restore=interceptConsequentialDb(state,"batch",/^UPDATE consequential_execution_steps SET status='not-submitted'/u,()=>{
   fired=true;
   if(change==="session"||change==="expired session")assistantR2RevokeSession(state,change==="expired session"?"expired":"revoked");
   else if(change==="author role")state.sqlite.prepare("UPDATE project_memberships SET role='viewer' WHERE user_id='assistant-viewer' AND project_access_id=?").run(state.projectAccessId);
   else if(change==="consent")state.sqlite.prepare("UPDATE private_content SET content='',redacted_at=? WHERE content_id=(SELECT consent_ref FROM consequential_executions WHERE execution_id=?)").run(new Date().toISOString(),review.quote.executionId);
   else state.sqlite.prepare("UPDATE project_memberships SET status='revoked',revoked_at=? WHERE user_id='assistant-viewer' AND project_access_id=?").run(new Date().toISOString(),state.projectAccessId);
  });
  const before=assistantR2Financial(state),response=await state.request(taskEndpoint(task.id,"cancel"),{method:"POST",headers:state.owner}),body=await response.json();
  assert.equal(fired,true);assert.equal(response.status,409,JSON.stringify(body));assert.equal(body.error,"assistant_stop_unconfirmed");assert.deepEqual(assistantR2Financial(state),before);assert.equal(body.submission,undefined);
 }finally{restore?.();await state.cleanup();}
});
test("assistant authority R2: authorization revoked between Stop mutations rolls the entire batch back",async()=>{
 const state=await assistantR2EditorFixture();
 try{
  const {task}=await assistantR2Queued(state),before=assistantR2Financial(state);
  state.sqlite.exec("CREATE TRIGGER r2_revoke_inside_stop AFTER UPDATE OF status ON consequential_execution_steps WHEN NEW.execution_id='"+task.id+"' AND NEW.status='not-submitted' BEGIN UPDATE project_memberships SET status='revoked',revoked_at='2000-01-01' WHERE user_id='assistant-viewer' AND project_access_id='"+state.projectAccessId+"'; END;");
  const response=await state.request(taskEndpoint(task.id,"cancel"),{method:"POST",headers:state.owner}),body=await response.json();
  assert.equal(response.status,409,JSON.stringify(body));assert.equal(body.error,"assistant_stop_unconfirmed");assert.deepEqual(assistantR2Financial(state),before);
  assert.equal(state.sqlite.prepare("SELECT status FROM project_memberships WHERE user_id='assistant-viewer' AND project_access_id=?").get(state.projectAccessId).status,"active","The failed final CHECK rolls back every statement in the batch");
 }finally{await state.cleanup();}
});
test("assistant authority R2: an existing Stop receipt cannot suppress a later CHECK denial",async()=>{
 const state=await assistantR2EditorFixture();let restore;
 try{
  const {task}=await assistantR2Queued(state);assert.equal((await state.request(taskEndpoint(task.id,"cancel"),{method:"POST",headers:state.owner})).status,200);
  const before=assistantR2Financial(state);let fired=false;
  restore=interceptConsequentialDb(state,"first",/^SELECT 1 AS current WHERE[\s\S]*specialistConsentVersion/u,()=>{fired=true;assistantR2RevokeSession(state);},"after");
  const response=await state.request(taskEndpoint(task.id,"cancel"),{method:"POST",headers:state.owner}),body=await response.json();
  assert.equal(fired,true);assert.equal(response.status,409,JSON.stringify(body));assert.equal(body.error,"assistant_stop_unconfirmed");assert.deepEqual(assistantR2Financial(state),before);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM assistant_action_commits WHERE commit_id=?").get("specialist-stop:"+task.id).count,1);
 }finally{restore?.();await state.cleanup();}
});
test("assistant authority R2: Stop retains unknown submitted holds and cannot turn them into an unused quote",async()=>{
 const state=await assistantR2DepthFixture({respond:()=>{throw new TypeError("unknown original submission");}});
 try{
  const{review,task}=await specialistApprovedTurn(state,"Review the exact retained source.");await state.drainBackground();
  const before=consequentialReceipt(state,task.id),response=await state.request(taskEndpoint(task.id,"cancel"),{method:"POST"}),body=await response.json(),after=consequentialReceipt(state,task.id);
  assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.task.status,"canceled");assert.equal(body.task.submission,"uncertain");assert.equal(body.unusedExecution,undefined);
  assert.deepEqual(after.tokens,before.tokens);assert.deepEqual(after.cost,before.cost);assert.deepEqual(after.balances,before.balances);assert.equal(state.calls.length,1);
  const resumed=await specialistRetrieve(state,review);assert.equal((await resumed.json()).unusedExecution,undefined);assert.equal(state.calls.length,1);
 }finally{await state.cleanup();}
});
test("assistant authority R2: completed paid original wins a racing Stop without changing its receipt",async()=>{
 const ready=Promise.withResolvers(),release=Promise.withResolvers(),state=await assistantR2DepthFixture({respond:async payload=>{ready.resolve();await release.promise;return specialistRawResponse(payload);}});let restore;
 try{
  const{task}=await specialistApprovedTurn(state,"Review the exact retained source.");await ready.promise;let completed;
  restore=interceptConsequentialDb(state,"first",/^SELECT 1 AS current WHERE[\s\S]*specialistConsentVersion/u,async()=>{release.resolve();await state.drainBackground();completed=consequentialReceipt(state,task.id);},"after");
  const response=await state.request(taskEndpoint(task.id,"cancel"),{method:"POST"}),body=await response.json();
  assert.ok(completed);assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.result.reply,"PRIVATE_VERIFIED_SPECIALIST_REPLY");assert.equal(body.task.status,"completed");assert.equal(body.unusedExecution,undefined);assert.deepEqual(consequentialReceipt(state,task.id),completed);assert.equal(state.calls.length,1);
  const before=assistantR2Financial(state),again=await state.request(taskEndpoint(task.id,"cancel"),{method:"POST"});
  assert.equal(again.status,200);assert.equal((await again.json()).result.reply,"PRIVATE_VERIFIED_SPECIALIST_REPLY");assert.deepEqual(assistantR2Financial(state),before);
 }finally{release.resolve();restore?.();await state.cleanup();}
});

for(const reason of["provider-unavailable","source-changed","expired-approval"])test("assistant authority R2: exact unused recovery permits only an explicit FREE refresh after "+reason,async()=>{
 const state=await assistantR2DepthFixture();
 try{
  const turn=await specialistFreeTurn(state,"r2-unused-"+reason),review=await specialistQuote(state,turn.id),original=structuredClone(review.quote);
  if(reason==="provider-unavailable")delete state.env.OPENAI_API_KEY;
  if(reason==="source-changed")appendFixtureEvents(state.sqlite,"creative:dev-local-creative",[["BlockPropertyEdited",{project_id:"project-atmosphere",document_id:"doc-atmosphere",block_id:"block-direction",property_path:"text",new_value:"A new current direction requiring a new free review."}]]);
  if(reason==="expired-approval")state.sqlite.prepare("UPDATE consequential_executions SET expires_at='2000-01-01T00:00:00.000Z' WHERE execution_id=?").run(review.quote.executionId);
  const rejected=await specialistExecute(state,review),failure=await rejected.json();assert.ok(rejected.status>=400,JSON.stringify(failure));assert.equal(failure.unusedExecution,undefined);assert.equal(failure.submission,undefined);
  const before=assistantR2Financial(state);
  const resumed=await specialistProtocolRequest(state,{action:"resume",turnId:turn.id,executionId:review.quote.executionId}),body=await resumed.json();
  assert.equal(resumed.status,200,JSON.stringify(body));assert.equal(body.unusedExecution,true);assert.equal(body.task,undefined);assert.equal(body.result,undefined);assert.equal(body.quote.canExecute,false);
  assert.equal(body.executionId,original.executionId);assert.equal(body.quote.bindingHash,original.bindingHash);assert.deepEqual(body.quote.privateInput,original.privateInput);
  assert.deepEqual(assistantR2Financial(state),before);assert.equal(state.calls.length,0);
  const fresh=await specialistQuote(state,turn.id);assert.equal(state.calls.length,0);
  if(reason==="source-changed"){assert.notEqual(fresh.quote.bindingHash,original.bindingHash);assert.notEqual(fresh.quote.sourceHash,original.sourceHash);}
 }finally{await state.cleanup();}
});
for(const corruption of[
 "missing-step","extra-step","wrong-index","wrong-token-limit","wrong-cost-limit","wrong-token-pointer","wrong-cost-pointer",
 "reserved-step","submitting-step","uncertain-step","usage-recorded-step","settled-step","not-submitted-step",
 "zero-verified-tokens","zero-verified-cost","empty-provider-id","reserved-execution","failed-execution","result-pointer",
])test("assistant authority R2: "+corruption+" is not an unused execution certificate",async()=>{
 const state=await assistantR2DepthFixture();
 try{
  const turn=await specialistFreeTurn(state,"r2-unused-negative-"+corruption),review=await specialistQuote(state,turn.id),id=review.quote.executionId;
  if(corruption==="missing-step")state.sqlite.prepare("DELETE FROM consequential_execution_steps WHERE execution_id=?").run(id);
  else if(corruption==="extra-step")state.sqlite.prepare("INSERT INTO consequential_execution_steps(execution_id,step_index,token_reservation_id,cost_reservation_id,maximum_tokens,maximum_microusd,status,updated_at) SELECT execution_id,1,execution_id||':tokens:1',execution_id||':usd:1',maximum_tokens,maximum_microusd,'quoted',updated_at FROM consequential_execution_steps WHERE execution_id=? AND step_index=0").run(id);
  else if(corruption==="wrong-index")state.sqlite.prepare("UPDATE consequential_execution_steps SET step_index=2 WHERE execution_id=?").run(id);
  else if(corruption==="wrong-token-limit")state.sqlite.prepare("UPDATE consequential_execution_steps SET maximum_tokens=maximum_tokens+1 WHERE execution_id=?").run(id);
  else if(corruption==="wrong-cost-limit")state.sqlite.prepare("UPDATE consequential_execution_steps SET maximum_microusd=maximum_microusd+1 WHERE execution_id=?").run(id);
  else if(corruption==="wrong-token-pointer")state.sqlite.prepare("UPDATE consequential_execution_steps SET token_reservation_id='different-token-pointer' WHERE execution_id=?").run(id);
  else if(corruption==="wrong-cost-pointer")state.sqlite.prepare("UPDATE consequential_execution_steps SET cost_reservation_id='different-cost-pointer' WHERE execution_id=?").run(id);
  else if(corruption.endsWith("-step"))state.sqlite.prepare("UPDATE consequential_execution_steps SET status=? WHERE execution_id=?").run(corruption.slice(0,-5),id);
  else if(corruption==="zero-verified-tokens")state.sqlite.prepare("UPDATE consequential_execution_steps SET verified_tokens=0 WHERE execution_id=?").run(id);
  else if(corruption==="zero-verified-cost")state.sqlite.prepare("UPDATE consequential_execution_steps SET verified_microusd=0 WHERE execution_id=?").run(id);
  else if(corruption==="empty-provider-id")state.sqlite.prepare("UPDATE consequential_execution_steps SET provider_request_id='' WHERE execution_id=?").run(id);
  else if(corruption.endsWith("-execution"))state.sqlite.prepare("UPDATE consequential_executions SET status=? WHERE execution_id=?").run(corruption.slice(0,-10),id);
  else if(corruption==="result-pointer")state.sqlite.prepare("UPDATE consequential_executions SET result_ref='missing-but-existing-result-pointer' WHERE execution_id=?").run(id);
  const before=assistantR2Financial(state),response=await specialistRetrieve(state,review),body=await response.json();
  assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.unusedExecution,undefined);assert.equal(body.quote.canExecute,false);assert.deepEqual(assistantR2Financial(state),before);assert.equal(state.calls.length,0);
 }finally{await state.cleanup();}
});
for(const ledger of["tokens","cost"])for(const evidence of["normal","foreign-owner","orphan-correlation","unexpected-index","released"])test("assistant authority R2: "+ledger+" "+evidence+" reservation prevents a false unused certificate",async()=>{
 const state=await assistantR2DepthFixture();
 try{
  const turn=await specialistFreeTurn(state,"r2-ledger-"+ledger+"-"+evidence),review=await specialistQuote(state,turn.id),id=review.quote.executionId;
  const reservationId=evidence==="orphan-correlation"?"orphan-"+id:id+(ledger==="tokens"?":tokens:":":usd:")+(evidence==="unexpected-index"?"9":"0");
  const options={reservationId,streamId:"creative:dev-local-creative",correlationId:evidence==="unexpected-index"?"different-correlation":id,operation:"assistant-specialist:fixture"};
  const held=ledger==="tokens"?await reserveBudget(state.env,"dev-local-creative",100,options):await reserveCostBudget(state.env,"dev-local-creative",100,{...options,maximumMicrousd:100,allowUserOverage:false});
  assert.equal(held.ok,true);
  const table=ledger==="tokens"?"budget_reservations":"cost_budget_reservations";
  if(evidence==="foreign-owner")state.sqlite.prepare("UPDATE "+table+" SET owner_id='foreign-ledger-owner' WHERE reservation_id=?").run(reservationId);
  if(evidence==="released")state.sqlite.prepare("UPDATE "+table+" SET status='released' WHERE reservation_id=?").run(reservationId);
  const before=assistantR2Financial(state),response=await specialistRetrieve(state,review),body=await response.json();
  assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.unusedExecution,undefined);assert.equal(body.quote.canExecute,false);assert.deepEqual(assistantR2Financial(state),before);assert.equal(state.calls.length,0);
 }finally{await state.cleanup();}
});
test("assistant authority R2: admission racing the final unused proof never unlocks a new request",async()=>{
 const state=await assistantR2DepthFixture();let restore;
 try{
  const turn=await specialistFreeTurn(state,"r2-unused-racing-admission"),review=await specialistQuote(state,turn.id);let fired=false;
  restore=interceptConsequentialDb(state,"first",/AS unused_execution/u,async()=>{
   fired=true;state.controls.skipAssistantTaskClaimOnce=true;
   const admitted=await specialistExecute(state,review);assert.equal(admitted.status,202,JSON.stringify(await admitted.clone().json()));await state.drainBackground();
  });
  const response=await specialistRetrieve(state,review),body=await response.json();
  assert.equal(fired,true);assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.unusedExecution,undefined);assert.equal(body.quote.canExecute,false);assert.equal(state.calls.length,0);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM assistant_specialist_tasks WHERE task_id=?").get(review.quote.executionId).count,1);
 }finally{restore?.();await state.cleanup();}
});
test("assistant authority R2: paid same-turn winner remains evidence even when its mutable task row is gone",async()=>{
 const state=await assistantR2DepthFixture();
 try{
  const turn=await specialistFreeTurn(state,"r2-unused-paid-winner"),old=await specialistQuote(state,turn.id),winner=await specialistQuote(state,turn.id,"gpt-5.6-terra");
  assert.notEqual(winner.quote.executionId,old.quote.executionId);
  assert.equal((await specialistExecute(state,winner)).status,202);await state.drainBackground();
  assert.equal(consequentialReceipt(state,winner.quote.executionId).execution.status,"completed");
  state.sqlite.prepare("DELETE FROM assistant_specialist_tasks WHERE task_id=?").run(winner.quote.executionId);
  const before=assistantR2Financial(state),response=await specialistRetrieve(state,old),body=await response.json();
  assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.unusedExecution,undefined);assert.deepEqual(assistantR2Financial(state),before);assert.equal(state.calls.length,1);
 }finally{await state.cleanup();}
});
test("assistant authority R2: multiple truly unused model previews remain independently reviewable without spend",async()=>{
 const state=await assistantR2DepthFixture();
 try{
  const turn=await specialistFreeTurn(state,"r2-unused-free-siblings"),first=await specialistQuote(state,turn.id),second=await specialistQuote(state,turn.id,"gpt-5.6-terra");
  assert.notEqual(first.quote.executionId,second.quote.executionId);
  for(const review of[first,second]){const response=await specialistRetrieve(state,review),body=await response.json();assert.equal(response.status,200);assert.equal(body.unusedExecution,true);assert.equal(body.quote.canExecute,false);}
  assert.equal(state.calls.length,0);assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM assistant_specialist_tasks").get().count,0);
 }finally{await state.cleanup();}
});
for(const withdrawal of["consent","session"])test("assistant authority R2: "+withdrawal+" withdrawal at final unused proof withholds the entire certificate",async()=>{
 const state=await assistantR2DepthFixture({shared:true});let restore;
 try{
  const turn=await specialistFreeTurn(state,"r2-unused-final-"+withdrawal),review=await specialistQuote(state,turn.id);
  restore=interceptConsequentialDb(state,"first",/AS unused_execution/u,()=>{
   if(withdrawal==="session")assistantR2RevokeSession(state);
   else state.sqlite.prepare("UPDATE private_content SET content='',redacted_at=? WHERE content_id=(SELECT consent_ref FROM consequential_executions WHERE execution_id=?)").run(new Date().toISOString(),review.quote.executionId);
  });
  const response=await specialistRetrieve(state,review),body=await response.json();
  assert.equal(response.status,404,JSON.stringify(body));assert.equal(body.unusedExecution,undefined);assert.equal(body.quote,undefined);assert.equal(state.calls.length,0);
 }finally{restore?.();await state.cleanup();}
});

for(const paid of["settled","uncertain"])for(const corruption of["missing","unrecognized"])test("assistant authority R2: "+paid+" "+corruption+" step never implies no submission in exact recovery or feed",async()=>{
 const state=await assistantR2DepthFixture(paid==="uncertain"?{respond:()=>{throw new TypeError("Unknown original POST");}}:{});
 try{
  const{turn,review,task}=await specialistApprovedTurn(state,"Review the exact retained source.");await state.drainBackground();
  const receipt=consequentialReceipt(state,task.id);assert.equal(state.calls.length,1);
  assert.equal(receipt.steps[0].status,paid);if(paid==="settled")assert.equal(receipt.cost[0].used_microusd,560);else assert.ok(receipt.balances.cost.reserved>0);
  if(corruption==="missing")state.sqlite.prepare("DELETE FROM consequential_execution_steps WHERE execution_id=?").run(task.id);
  else state.sqlite.prepare("UPDATE consequential_execution_steps SET status='unrecognized-status' WHERE execution_id=?").run(task.id);
  const before=assistantR2Financial(state);
  const response=await specialistProtocolRequest(state,{action:"resume",turnId:turn.id,executionId:review.quote.executionId}),body=await response.json();
  assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.task.submission,undefined);assert.equal(body.task.canExecute,false);assert.equal(body.unusedExecution,undefined);
  assert.deepEqual(adaptiveReentryFinancialState(state),before.financial);assert.equal(state.calls.length,before.providerCalls);
  const beforeFeed=assistantR2Financial(state),feed=await state.request(endpoint()),page=await feed.json();assert.equal(feed.status,200,JSON.stringify(page));
  const listed=page.tasks.find(item=>item.id===task.id);assert.ok(listed);assert.equal(listed.submission,undefined);assert.equal(listed.canExecute,false);
  assert.deepEqual(assistantR2Financial(state),beforeFeed);
 }finally{await state.cleanup();}
});
for(const reserved of[false,true])test("assistant authority R2: genuine "+(reserved?"reserved":"quoted")+" step remains proven not-submitted and explicitly runnable",async()=>{
 const state=await assistantR2DepthFixture();
 try{
  const{turn,review,task}=await assistantR2Queued(state,{reserve:reserved}),receipt=consequentialReceipt(state,task.id);
  assert.equal(receipt.steps[0].status,reserved?"reserved":"quoted");
  const before=assistantR2Financial(state),response=await specialistProtocolRequest(state,{action:"resume",turnId:turn.id,executionId:review.quote.executionId}),body=await response.json();
  assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.task.submission,"not-submitted");assert.equal(body.task.canExecute,true);assert.equal(body.unusedExecution,undefined);
  const feed=await state.request(endpoint()),page=await feed.json();assert.equal(feed.status,200,JSON.stringify(page));
  const listed=page.tasks.find(item=>item.id===task.id);assert.ok(listed);assert.equal(listed.submission,"not-submitted");assert.equal(listed.canExecute,false);
  assert.deepEqual(assistantR2Financial(state),before);assert.equal(state.calls.length,0);
 }finally{await state.cleanup();}
});

for (const shared of [false, true]) for (const surface of ["Document", "Canvas"]) {
  test("unused model route R3 " + (shared ? "shared " : "personal ") + surface + ": original inspection and explicit replacement previews reserve nothing", async () => {
    const state = await assistantR2DepthFixture({ shared, models: "gpt-5.6-luna,gpt-5.6-terra,gpt-5.6-sol", solUsers: "dev-local-creative,assistant-owner",
      respond: () => assert.fail("Free recovery must never reach a provider") });
    try {
      if (shared && surface === "Canvas") state.sqlite.prepare("UPDATE users SET role='admin' WHERE user_id='assistant-owner'").run();
      const options = surface === "Canvas" ? specialistCanvasEvents(state) : {};
      const authored = adaptiveAuthoredCount(state);
      for (const locale of ["en", "fr", "ar", "ja"]) {
        state.env.FORMA_ASSISTANT_ALLOWED_MODELS = "gpt-5.6-luna,gpt-5.6-terra,gpt-5.6-sol";
        const turn = await specialistFreeTurn(state, "unused-model-" + surface + "-" + locale, "Explain the exact original source.", { ...options, locale });
        const original = await specialistQuote(state, turn.id, "gpt-5.6-luna", options), finances = adaptiveReentryFinancialState(state);
        state.env.FORMA_ASSISTANT_ALLOWED_MODELS = "gpt-5.6-terra,gpt-5.6-sol";
        const session = await (await state.request("/api/session", { headers: state.owner ?? {} })).json();
        assert.equal(session.assistant.models.some(model => model.id === "gpt-5.6-luna"), false);
        const response = await specialistProtocolRequest(state, { action: "resume", turnId: turn.id, executionId: original.executionId }, options), unused = await response.json();
        assert.equal(response.status, 200, JSON.stringify(unused));
        assert.equal(unused.unusedExecution, true); assert.equal(unused.task, undefined); assert.equal(unused.result, undefined);
        assert.equal(unused.quote.canExecute, false); assert.equal(unused.quote.bindingHash, original.quote.bindingHash);
        const inspected = await specialistQuote(state, turn.id, "gpt-5.6-luna", options);
        assert.equal(inspected.quote.models[0], "gpt-5.6-luna"); assert.equal(inspected.quote.canExecute, false);
        assert.ok(inspected.quote.unavailableReasons.includes("assistant_model_model_not_allowed"));
        assert.equal(inspected.originalRequest.locale, locale);
        assert.deepEqual(inspected.originalRequest.selectedItemIds, original.originalRequest.selectedItemIds);
        const denied = await specialistExecute(state, inspected, options);
        assert.ok(denied.status >= 400, JSON.stringify(await denied.clone().json()));
        const chosen = await specialistQuote(state, turn.id, "gpt-5.6-terra", options);
        assert.equal(chosen.quote.models[0], "gpt-5.6-terra"); assert.equal(chosen.quote.canExecute, true);
        assert.equal(chosen.turnId, turn.id); assert.notEqual(chosen.quote.bindingHash, original.quote.bindingHash);
        assert.equal(chosen.originalRequest.sourceHash, chosen.quote.sourceHash);
        assert.equal(chosen.originalRequest.route, original.originalRequest.route);
        assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM assistant_turns WHERE turn_id=?").get(turn.id).n, 1);
        assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM assistant_specialist_tasks").get().n, 0);
        assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM budget_reservations").get().n, 0);
        assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM cost_budget_reservations").get().n, 0);
        assert.deepEqual(adaptiveReentryFinancialState(state), finances);
        assert.equal(adaptiveAuthoredCount(state), authored);
        assert.equal(state.calls.length, 0);
      }
    } finally { await state.cleanup(); }
  });
}

const phase3ED1Profiles=[];
async function withPhase3EOutputProposal(mode, run, options={}) {
  const paid=options.paid!==false,state=mode==="personal"?await fixture({provider:paid}):await sharedProjectFixture({provider:paid});
  const headers=mode==="personal"?{}:mode==="selected"?state.owner:Object.fromEntries(Object.entries(state.owner).filter(([key])=>key!=="cookie"));
  const owner=mode==="personal"?"dev-local-creative":"assistant-owner",stream="creative:"+owner,original=globalThis.fetch,body=options.body??contextBody;let calls=0,depth,restore;
  try {
    await options.setup?.({state,headers,owner,stream,body});
    let result=null,selected=null;
    if(paid){
      globalThis.fetch=async(_url,init)=>{calls++;return contextProposalResponse(JSON.parse(init.body));};
      const quote=await quoteContext(state,body,headers),executed=await executeContext(state,quote,body,headers);
      assert.equal(executed.status,200,await executed.clone().text());result=await executed.json();
      selected=proposalSelection(result,0,options.edit??{type:"output",subtype:"Executive summary",label:"Reviewed delivery draft",text:"1 slideshow with 5 slides outlining the document."});
    }
    delete state.env.OPENAI_API_KEY;delete state.env.FORMA_ASSISTANT_PROVIDER_USER_IDS;
    const {enforceD1ExpressionDepth}=await import("./helpers/d1-expression-depth.mjs");depth=enforceD1ExpressionDepth(state);
    const {AsyncLocalStorage}=await import("node:async_hooks"),scope=new AsyncLocalStorage(),profiles=[];
    const prototype=Object.getPrototypeOf(state.env.DB.prepare("SELECT 1")),execute=prototype.execute,request=state.request;
    prototype.execute=function(kind){
      const profile=scope.getStore();
      if(profile){
        profile.queries++;
        profile.maxBindings=Math.max(profile.maxBindings,this.values.length);
        profile.maxSqlBytes=Math.max(profile.maxSqlBytes,Buffer.byteLength(this.sql,"utf8"));
        profile.maxValueBytes=Math.max(profile.maxValueBytes,...this.values.map(value=>typeof value==="string"?Buffer.byteLength(value,"utf8"):0));
        assert.ok(this.values.length<=100,this.sql.slice(0,160));
        assert.ok(Buffer.byteLength(this.sql,"utf8")<=100_000,this.sql.slice(0,160));
        assert.ok(profile.queries<=1000,profile.action+" actual D1 request query budget");
      }
      return execute.call(this,kind);
    };
    state.request=(path,init)=>{
      let action="read";try{action=JSON.parse(init?.body??"{}").action??action;}catch{ /* A non-JSON read has no action field. */ }
      const profile={mode,path,action,queries:0,maxBindings:0,maxSqlBytes:0,maxValueBytes:0};profiles.push(profile);
      return scope.run(profile,()=>request(path,init));
    };
    restore=()=>{prototype.execute=execute;state.request=request;};
    await run({state,headers,owner,stream,body,result,selected,calls:()=>calls,profiles});
    await state.drainBackground();
    phase3ED1Profiles.push(...profiles);
    assert.equal(calls,paid?1:0);
  } finally { globalThis.fetch=original;restore?.();try{depth?.assertVerified();}finally{depth?.restore();state.phase3ECleanup?.();} }
}
async function phase3EAppend(state,headers,events){
  const response=await state.request("/api/events",json({action:"batch",events,clientId:"phase3e-output-fixture"},headers));
  assert.equal(response.status,200,await response.clone().text());return response.json();
}
const phase3EOutputCreation=(blockId="phase3e-source-output",documentId=contextBody.documentId,properties={})=>({type:"BlockCreated",payload:{project_id:contextBody.projectId,document_id:documentId,scope:"document",block_id:blockId,type:"output",handle:"output/reviewed-delivery",position:"z-output",properties:{label:"Reviewed requirements",text:"1 slideshow with 5 slides outlining the document.",subtype:"Executive summary",...properties}}});
for(const mode of ["personal","owner-custody","selected"])test("Phase3E Output proposals normalize before approval and commit exact bytes: "+mode,()=>withPhase3EOutputProposal(mode,async({state,headers,stream,selected,calls})=>{
  const before=contextEventCount(state,stream),costs=state.sqlite.prepare("SELECT COUNT(*) AS n FROM cost_budget_reservations").get().n;
  const response=await previewContextChanges(state,[selected],headers);assert.equal(response.status,200,await response.clone().text());
  const {preview}=await response.json(),created=preview.events.find(event=>event.type==="BlockCreated");
  assert.equal(created.payload.type,"output");assert.equal(created.payload.properties.output_spec?.id,created.payload.block_id);
  for(const key of ["weight","intent","influence","effect"])assert.equal(Object.hasOwn(created.payload.properties,key),false,key);
  const retained=JSON.parse(state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(preview.previewId).content);
  assert.equal(await consequential.consentHash(retained.plan),preview.approvalHash);
  assert.deepEqual(retained.plan.events,preview.events);assert.equal(contextEventCount(state,stream),before);
  const committed=await applyContextChanges(state,preview,headers);assert.equal(committed.status,200,await committed.clone().text());
  const first=await committed.json();assert.equal(first.status,"applied");assert.equal(first.blockIds[0],created.payload.block_id);
  const exact=state.sqlite.prepare("SELECT event.type,secret.private_json FROM events event JOIN event_private_payloads secret ON secret.private_event_id=event.event_id WHERE event.stream_id=? AND event.correlation_id=? ORDER BY event.sequence").all(stream,"authoring:"+retained.plan.binding.actorUserId+":"+preview.previewId);
  assert.deepEqual(exact.map(row=>({type:row.type,payload:JSON.parse(row.private_json)})),preview.events);
  const saved=JSON.parse(state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(preview.previewId).content);
  assert.deepEqual(saved.plan,retained.plan);assert.equal(saved.approvalHash,preview.approvalHash);
  const recovered=await applyContextChanges(state,preview,headers,"retrieve");assert.equal(recovered.status,200);assert.equal((await recovered.json()).status,"applied");
  assert.equal(contextEventCount(state,stream),before+preview.events.length);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM authoring_commits").get().n,1);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE stream_id=? AND type LIKE 'Output%'").get(stream).n,0);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM cost_budget_reservations").get().n,costs);assert.equal(calls(),1);
}));
for(const mode of ["personal","owner-custody","selected"])for(const fault of ["staged-private-body","retained-plan","source-private-owner"])test("Phase3E Output proposals final exactness rejects "+mode+"/"+fault,()=>withPhase3EOutputProposal(mode,async({state,headers,stream,owner,selected})=>{
  const response=await previewContextChanges(state,[selected],headers);assert.equal(response.status,200,await response.clone().text());const{preview}=await response.json();
  const before=contextEventCount(state,stream);
  state.controls.beforeAuthoringCommit=()=>{
    if(fault==="staged-private-body")state.sqlite.prepare("UPDATE event_private_payloads SET private_json=json_set(private_json,'$.properties.text','ALTERED_AFTER_STAGING') WHERE private_event_id IN(SELECT event_id FROM events WHERE correlation_id=? AND type='BlockCreated')").run("authoring:"+owner+":"+preview.previewId);
    else if(fault==="retained-plan")state.sqlite.prepare("UPDATE private_content SET content=json_set(content,'$.plan.events[1].payload.properties.text','ALTERED_SAVED_PLAN') WHERE content_id=?").run(preview.previewId);
    else state.sqlite.prepare("UPDATE event_private_payloads SET owner_id='foreign-private-owner' WHERE private_event_id IN(SELECT event_id FROM events WHERE stream_id=? AND type='BlockCreated' AND json_extract(payload,'$.block_id')=?)").run(stream,contextBody.blockId);
  };
  const committed=await applyContextChanges(state,preview,headers);assert.notEqual(committed.status,200,await committed.clone().text());
  assert.equal(contextEventCount(state,stream),before);assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM authoring_commits").get().n,0);
}));


for(const mode of ["personal","owner-custody","selected"])test("Phase3E Output proposals never rewrite a previously approved unnormalized draft: "+mode,()=>withPhase3EOutputProposal(mode,async({state,headers,stream,selected,calls})=>{
  const response=await previewContextChanges(state,[selected],headers);assert.equal(response.status,200,await response.clone().text());const{preview}=await response.json();
  const stored=JSON.parse(state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(preview.previewId).content);
  // A retained pre-main approval legitimately contained these pre-normalization bytes.
  const legacy=structuredClone(stored),created=legacy.plan.events.find(event=>event.type==="BlockCreated");
  delete created.payload.properties.output_spec;created.payload.properties.intent="include";created.payload.properties.weight=.8;
  legacy.approvalHash=await consequential.consentHash(legacy.plan);
  state.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id=?").run(JSON.stringify(legacy),preview.previewId);
  const before=contextEventCount(state,stream),rejected=await applyContextChanges(state,{...preview,approvalHash:legacy.approvalHash},headers);
  const denied=await rejected.json();assert.equal(rejected.status,409,JSON.stringify(denied));assert.equal(denied.status,"not-applied");assert.equal(denied.error,"authoring_preview_stale");
  assert.equal(contextEventCount(state,stream),before);assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM authoring_commits").get().n,0);
  const unchanged=JSON.parse(state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(preview.previewId).content);
  assert.deepEqual(unchanged.plan,legacy.plan);assert.equal(unchanged.approvalHash,legacy.approvalHash);
  const fresh=await previewContextChanges(state,[selected],headers);assert.equal(fresh.status,200,await fresh.clone().text());
  const next=(await fresh.json()).preview,newBlock=next.events.find(event=>event.type==="BlockCreated");
  assert.notEqual(next.previewId,preview.previewId);assert.notEqual(next.approvalHash,legacy.approvalHash);
  assert.equal(newBlock.payload.properties.output_spec.id,newBlock.payload.block_id);
  assert.equal((await applyContextChanges(state,next,headers)).status,200);assert.equal(calls(),1);
}));

for(const mode of ["personal","owner-custody","selected"])for(const grouped of [false,true])test("Phase3E Output proposals existing Output requires its revision-aware editor: "+mode+"/"+grouped,()=>withPhase3EOutputProposal(mode,async({state,headers,stream,body})=>{
  const {prepareContextAuthority}=await import("../worker/context-authoring-authority.ts"),{storeAuthoringPreview}=await import("../worker/authoring-commits.ts");
  const prepared=await prepareContextAuthority(new Request("http://localhost/api/context/apply",json(body,headers)),state.env,body,"author");
  assert.ok(!(prepared instanceof Response));assert.equal(prepared.target.type,"output");
  const plan={operation:"context-proposal",binding:prepared.binding,sourceHead:prepared.sourceHead,expiresAt:new Date(Date.now()+600_000).toISOString(),
    events:[{type:"BlockRelationAdded",payload:{project_id:body.projectId,document_id:body.documentId,scope:"document",relation_id:crypto.randomUUID(),from_block_id:body.blockId,to_block_id:"block-direction",kind:"context_contains",properties:{member_order:0}}}],
    changes:[{kind:"link",label:"Existing Output",text:"Unchanged source",sourceId:body.blockId,targetId:"block-direction"}],result:{blockIds:[],relationCount:1}};
  const preview=await storeAuthoringPreview(state.env,prepared.principal,plan),before=contextEventCount(state,stream);
  const response=await applyContextChanges(state,preview,headers,"apply",body),denied=await response.json();
  assert.equal(response.status,409,JSON.stringify(denied));assert.equal(denied.status,"not-applied");assert.equal(denied.error,"output_requirement_endpoint_required");assert.equal(denied.blockId,body.blockId);
  assert.match(denied.message,/Output requirements editor.*current revision.*draft was not saved/);
  assert.equal(contextEventCount(state,stream),before);assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM authoring_commits").get().n,0);
  const saved=JSON.parse(state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(preview.previewId).content);
  assert.deepEqual(saved.plan,plan);assert.equal(saved.approvalHash,preview.approvalHash);
},{paid:false,body:{...contextBody,blockId:"phase3e-existing-output"},setup:async({state,headers})=>{
  await phase3EAppend(state,headers,[phase3EOutputCreation("phase3e-existing-output",contextBody.documentId,grouped?{context_group:{name:"Already grouped",application:"isolate",role:"direction",relativity:1}}:{})]);
}}));

for(const mode of ["personal","owner-custody","selected"])test("Phase3E Output proposals a dedicated Output draft revision invalidates the old approval without rewriting it: "+mode,()=>withPhase3EOutputProposal(mode,async({state,headers,stream,selected})=>{
  const quoted=await previewContextChanges(state,[selected],headers);assert.equal(quoted.status,200,await quoted.clone().text());const{preview}=await quoted.json();
  const old=state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(preview.previewId).content;
  const editorHeaders=state.owner??headers;
  const inspected=await state.request("/api/output-requirements?documentId="+encodeURIComponent(contextBody.documentId),{headers:editorHeaders});assert.equal(inspected.status,200,await inspected.clone().text());
  const snapshot=await inspected.json(),requirement=snapshot.requirements.find(item=>item.blockId==="phase3e-source-output");
  assert.ok(requirement);const spec=structuredClone(requirement.spec);
  spec.label="A new explicitly saved Output draft";
  const changed=await state.request("/api/output-requirements",json({action:"save",documentId:contextBody.documentId,blockId:requirement.blockId,spec,expectedRevision:snapshot.revision,clientMutationId:crypto.randomUUID()},editorHeaders));
  assert.equal(changed.status,200,await changed.clone().text());const changedBody=await changed.json();assert.ok(changedBody.appended.some(event=>event.type==="BlockPropertyEdited"));
  const before=contextEventCount(state,stream),denied=await applyContextChanges(state,preview,headers);assert.equal(denied.status,409,await denied.clone().text());
  assert.equal(contextEventCount(state,stream),before);assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM authoring_commits").get().n,0);
  const retained=JSON.parse(state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(preview.previewId).content);
  assert.deepEqual(retained.plan,JSON.parse(old).plan);assert.equal(retained.approvalHash,preview.approvalHash);
  const recovered=await applyContextChanges(state,preview,headers,"retrieve");assert.equal(recovered.status,200);assert.equal((await recovered.json()).stale,true);
},{setup:async({state,headers})=>phase3EAppend(state,state.owner??headers,[phase3EOutputCreation()])}));

async function phase3ERetainedOutputPlan(state,stream,owner){
  const {parseOutputRequirement,inspectOutputRequirement}=await import("../src/model/output-requirements.ts"),{compileOutputPlan}=await import("../src/model/output-plan.ts"),{makeEvent,eventWriteBindings,EVENT_WRITE_COLUMNS}=await import("../worker/runtime.ts");
  const spec=parseOutputRequirement({id:"phase3e-ledger-only",type:"output",subtype:"Executive summary",content:"1 slideshow with 5-15 slides, one podcast episode, and a series of videos outlining the document."}).spec;
  spec.deliverables=[spec.deliverables[0]];spec.deliverables[0].quantity={kind:"exact",unit:"presentation",value:1000};assert.equal(inspectOutputRequirement(spec).status,"valid");
  const plan=compileOutputPlan([spec],{document_id:contextBody.documentId,source_revision:"a".repeat(64),requirement_revision:"b".repeat(64),count_policies:{[spec.deliverables[0].id]:{kind:"exact",unit:"slide",value:5}},max_targets:1000});
  assert.equal(plan.issues.length,0);assert.equal(plan.targets.length,1000);assert.equal(plan.unresolved_groups.length,0);assert.ok(plan.targets.every(target=>target.blocking_issues.length===0));
  const payload={project_id:contextBody.projectId,document_id:contextBody.documentId,plan_revision_id:"phase3e-ledger-only",confirmed_plan:{id:contextBody.documentId,revisionId:"phase3e-ledger-only",revision:1,confirmedAt:new Date().toISOString(),requirementsDigest:"b".repeat(64),sourceDigest:"a".repeat(64),plan,targetContractDigests:Object.fromEntries(plan.targets.map(target=>[target.id,"c".repeat(64)])),confirmationOptions:{}}};
  const head=state.sqlite.prepare("SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?").get(stream).head;
  const event=makeEvent(stream,head+1,"user:"+owner,"phase3e-retained-ledger-fixture",crypto.randomUUID(),"OutputPlanConfirmed",payload),values=eventWriteBindings(event);
  await state.env.DB.prepare("INSERT INTO event_write_stage("+EVENT_WRITE_COLUMNS+") VALUES("+values.map(()=>"?").join(",")+")").bind(...values).run();
  const retained=state.sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=?").get(event.eventId);
  assert.ok(Buffer.byteLength(retained.private_json,"utf8")>1_000_000,"supported 1000-target retained plan exercises the original large-ledger boundary");
  return event.eventId;
}
for(const mode of ["personal","owner-custody","selected"])test("Phase3E Output proposals unrelated 1000-target Output ledger retention is not a creative source dependency: "+mode,()=>withPhase3EOutputProposal(mode,async({state,headers,stream,owner,selected,profiles})=>{
  const {prepareContextAuthority}=await import("../worker/context-authoring-authority.ts"),request=()=>new Request("http://localhost/api/context/apply",json(contextBody,headers));
  const before=await prepareContextAuthority(request(),state.env,contextBody,"author");assert.ok(!(before instanceof Response));
  const ledgerId=await phase3ERetainedOutputPlan(state,stream,owner);
  const withLedger=await prepareContextAuthority(request(),state.env,contextBody,"author");assert.ok(!(withLedger instanceof Response));assert.ok(withLedger.events.some(event=>event.eventId===ledgerId));
  assert.equal(withLedger.binding.sourceHash,before.binding.sourceHash,"actual main event reader includes the ledger but contextSourceHash does not depend on it");
  const response=await previewContextChanges(state,[selected],headers);assert.equal(response.status,200,await response.clone().text());const{preview}=await response.json();
  const saved=JSON.parse(state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(preview.previewId).content);
  // Real retention can erase this unrelated result ledger without changing an authored decision.
  state.sqlite.prepare("UPDATE event_private_payloads SET private_json='{}',redacted_at=? WHERE private_event_id=?").run(new Date().toISOString(),ledgerId);
  const current=await prepareContextAuthority(request(),state.env,contextBody,"author");assert.ok(!(current instanceof Response));assert.equal(current.binding.sourceHash,before.binding.sourceHash);
  const count=contextEventCount(state,stream),committed=await applyContextChanges(state,preview,headers);assert.equal(committed.status,200,await committed.clone().text());
  assert.equal(contextEventCount(state,stream),count+preview.events.length);
  const same=JSON.parse(state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(preview.previewId).content);assert.deepEqual(same.plan,saved.plan);assert.equal(same.approvalHash,saved.approvalHash);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE stream_id=? AND type LIKE 'Output%'").get(stream).n,1,"no plan, job, grant, approval or result ledger was copied or created by acceptance");
  assert.ok(profiles.filter(profile=>["preview","apply"].includes(profile.action)).every(profile=>profile.maxValueBytes<1_000_000),"no truncated or duplicated ledger body enters the exact creative source proof");
}));

for(const mode of ["personal","owner-custody","selected"])for(const change of ["source-private-erased","source-private-deleted","preview-private-erased","authority-withdrawn",...(mode==="personal"?[]:["source-event-custody","source-resource-custody","preview-retention-custody"])])test("Phase3E Output proposals retained source/current authority changes during the lease leave zero authored effects: "+mode+"/"+change,()=>withPhase3EOutputProposal(mode,async({state,headers,stream,owner,selected})=>{
  const response=await previewContextChanges(state,[selected],headers);assert.equal(response.status,200,await response.clone().text());const{preview}=await response.json();
  const before=contextEventCount(state,stream),correlation="authoring:"+owner+":"+preview.previewId;
  const source=state.sqlite.prepare("SELECT event_id FROM events WHERE stream_id=? AND type='BlockCreated' AND json_extract(payload,'$.block_id')=?").get(stream,contextBody.blockId).event_id;
  state.controls.afterAuthoringClaim=async()=>{
    if(change==="source-private-erased")state.sqlite.prepare("UPDATE event_private_payloads SET private_json='{}',redacted_at=? WHERE private_event_id=?").run(new Date().toISOString(),source);
    else if(change==="source-private-deleted")state.sqlite.prepare("DELETE FROM event_private_payloads WHERE private_event_id=?").run(source);
    else if(change==="preview-private-erased")state.sqlite.prepare("UPDATE private_content SET content='',redacted_at=? WHERE content_id=?").run(new Date().toISOString(),preview.previewId);
    else if(change==="authority-withdrawn")state.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id=?").run(owner);
    else if(change==="source-event-custody")state.sqlite.prepare("DELETE FROM project_event_scopes WHERE event_id=?").run(source);
    else if(change==="source-resource-custody")state.sqlite.prepare("DELETE FROM project_resource_scopes WHERE project_access_id=? AND resource_kind='block' AND resource_id=?").run(state.projectAccessId,contextBody.blockId);
    else state.sqlite.prepare("DELETE FROM private_content_retention_scopes WHERE content_id=?").run(preview.previewId);
  };
  const rejected=await applyContextChanges(state,preview,headers);assert.notEqual(rejected.status,200,await rejected.clone().text());
  assert.equal(contextEventCount(state,stream),before);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM authoring_commits").get().n,0);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE correlation_id=?").get(correlation).n,0);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM event_private_payloads secret JOIN events event ON event.event_id=secret.private_event_id WHERE event.correlation_id=?").get(correlation).n,0);
  if(mode!=="personal")assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM project_resource_scopes WHERE source_event_id IN(SELECT event_id FROM events WHERE correlation_id=?)").get(correlation).n,0);
}));

for(const mode of ["personal","owner-custody","selected"])test("Phase3E Output proposals concurrent confirmation and lost-response recovery reuse the exact original receipt: "+mode,()=>withPhase3EOutputProposal(mode,async({state,headers,stream,selected})=>{
  const response=await previewContextChanges(state,[selected],headers);assert.equal(response.status,200,await response.clone().text());const{preview}=await response.json(),before=contextEventCount(state,stream);
  let enter,release;const entered=new Promise(resolve=>{enter=resolve;}),barrier=new Promise(resolve=>{release=resolve;});
  state.controls.afterAuthoringClaim=async()=>{enter();await barrier;};
  const first=applyContextChanges(state,preview,headers);await entered;
  try{
    const concurrent=await applyContextChanges(state,preview,headers);assert.equal(concurrent.status,202,await concurrent.clone().text());assert.equal((await concurrent.json()).status,"applying");
  }finally{release();}
  const committed=await first;assert.equal(committed.status,200,await committed.clone().text());
  // The client receives no body here. Recovery uses only the original opaque preview identity/hash.
  const recovered=await applyContextChanges(state,preview,headers,"retrieve");assert.equal(recovered.status,200,await recovered.clone().text());const receipt=await recovered.json();assert.equal(receipt.status,"applied");
  const repeated=await applyContextChanges(state,preview,headers);assert.equal(repeated.status,200);assert.deepEqual((await repeated.json()).blockIds,receipt.blockIds);
  assert.equal(contextEventCount(state,stream),before+preview.events.length);assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM authoring_commits").get().n,1);
  const saved=JSON.parse(state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(preview.previewId).content);
  assert.equal(saved.approvalHash,preview.approvalHash);assert.deepEqual(saved.plan.events,preview.events);
}));



test("Phase3E exact event proof preserves the extracted Phase6 truth table, including NULL and missing private rows",()=>withPhase3EOutputProposal("personal",async({state,stream,owner})=>{
  const {authoringEventProof,authoringEventRowsProof}=await import("../worker/authoring-event-proof.ts"),{makeEvent,eventWriteBindings,EVENT_WRITE_COLUMNS}=await import("../worker/runtime.ts");
  const columns=["event_id","stream_id","sequence","occurred_at","recorded_at","actor","client_id","correlation_id","causation_id","compensates_event_id","schema_version","type","payload"];
  const head=state.sqlite.prepare("SELECT COALESCE(MAX(sequence),0) AS n FROM events WHERE stream_id=?").get(stream).n,event=makeEvent(stream,head+1,"user:"+owner,"phase3e-proof-fixture","proof-correlation","BlockCreated",{project_id:contextBody.projectId,document_id:contextBody.documentId,block_id:"proof-output",type:"output",properties:{text:"Exact Unicode Élodie 東京 — private source"}});
  const values=eventWriteBindings(event);await state.env.DB.prepare("INSERT INTO event_write_stage("+EVENT_WRITE_COLUMNS+") VALUES("+values.map(()=>"?").join(",")+")").bind(...values).run();
  // Frozen Phase6's reference comparison: all 13 canonical fields, four private fields and live retention.
  const originalSql="NOT EXISTS(SELECT 1 FROM json_each(?) expected WHERE NOT EXISTS(SELECT 1 FROM events event JOIN event_private_payloads secret ON secret.private_event_id=event.event_id WHERE "+columns.map((column,index)=>"event."+column+" IS json_extract(expected.value,'$["+index+"]')").join(" AND ")+" AND secret.owner_id IS json_extract(expected.value,'$[13]') AND secret.project_id IS json_extract(expected.value,'$[14]') AND secret.document_id IS json_extract(expected.value,'$[15]') AND secret.private_json IS json_extract(expected.value,'$[16]') AND secret.redacted_at IS NULL))";
  const evaluate=async proof=>(await state.env.DB.prepare("SELECT CASE WHEN "+proof.sql+" THEN 1 ELSE 0 END AS verified").bind(...proof.bindings).first()).verified;
  const compare=async(expected,want)=>{const old=await evaluate({sql:originalSql,bindings:[JSON.stringify([expected])]}),current=await evaluate(authoringEventRowsProof([expected]));assert.equal(old,want);assert.equal(current,old);};
  assert.equal(await evaluate(authoringEventProof([event])),1);await compare(values,1);
  for(let index=0;index<values.length;index++){
    const wrong=[...values];wrong[index]=typeof wrong[index]==="number"?wrong[index]+1:wrong[index]===null?"unexpected-nonnull":String(wrong[index])+"-changed";await compare(wrong,0);
    if(values[index]!==null){const absent=[...values];absent[index]=null;await compare(absent,0);}
  }
  state.sqlite.prepare("UPDATE event_private_payloads SET redacted_at=? WHERE private_event_id=?").run(new Date().toISOString(),event.eventId);await compare(values,0);
  state.sqlite.prepare("DELETE FROM event_private_payloads WHERE private_event_id=?").run(event.eventId);await compare(values,0);
  const legacy=eventWriteBindings(event);legacy.splice(13,4,null,null,null,null);
  assert.equal(await evaluate(authoringEventRowsProof([legacy],true)),1,"captured genuine legacy absence is explicit, not an allocated-write exemption");
  assert.equal(await evaluate(authoringEventRowsProof([legacy])),0,"newly allocated writes always require their private row");
  state.sqlite.prepare("INSERT INTO event_private_payloads(private_event_id,owner_id,project_id,document_id,private_json,created_at,redacted_at) VALUES(?,?,?,?,?,?,NULL)").run(event.eventId,owner,contextBody.projectId,contextBody.documentId,"{}",new Date().toISOString());
  assert.equal(await evaluate(authoringEventRowsProof([legacy],true)),0,"a newly introduced private body cannot match the captured absence");
  assert.throws(()=>authoringEventProof([]),/invalid_authoring_operation/);
  assert.throws(()=>authoringEventRowsProof([[null]]),/authoring_write_proof_required/);
},{paid:false}));

test("Phase3E exact source sidecar proof preserves every custody column without NULL widening",()=>withPhase3EOutputProposal("selected",async({state})=>{
  const {authoringSidecarProof,AUTHORING_SIDECAR_COLUMNS}=await import("../worker/authoring-event-proof.ts");
  for(const table of ["project_event_scopes","project_resource_scopes"]){
    const row=state.sqlite.prepare("SELECT * FROM "+table+" WHERE project_access_id=? LIMIT 1").get(state.projectAccessId),columns=AUTHORING_SIDECAR_COLUMNS[table],values=columns.map(column=>row[column]??null);
    const evaluate=async expected=>{const guard=authoringSidecarProof(table,[expected]);return(await state.env.DB.prepare("SELECT CASE WHEN "+guard.sql+" THEN 1 ELSE 0 END AS verified").bind(...guard.bindings).first()).verified;};
    assert.equal(await evaluate(values),1);
    for(let index=0;index<values.length;index++){const wrong=[...values];wrong[index]=values[index]===null?"unexpected":typeof values[index]==="number"?values[index]+1:String(values[index])+"-changed";assert.equal(await evaluate(wrong),0,table+"/"+columns[index]);if(values[index]!==null){wrong[index]=null;assert.equal(await evaluate(wrong),0,table+"/"+columns[index]+"/NULL");}}
  }
},{paid:false}));

for(const mode of ["personal","owner-custody","selected"])for(const predicate of ["0","NULL"])test("Phase3E exact final receipt false-or-NULL source proof rolls back the whole authored operation: "+mode+"/"+predicate,()=>withPhase3EOutputProposal(mode,async({state,headers,stream,selected})=>{
  const response=await previewContextChanges(state,[selected],headers);assert.equal(response.status,200,await response.clone().text());const{preview}=await response.json();
  const saved=JSON.parse(state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(preview.previewId).content),{prepareContextAuthority}=await import("../worker/context-authoring-authority.ts"),{commitAuthoringPlan}=await import("../worker/authoring-commits.ts");
  const prepared=await prepareContextAuthority(new Request("http://localhost/api/context/apply",json(contextBody,headers)),state.env,contextBody,"author");assert.ok(!(prepared instanceof Response));
  const before=contextEventCount(state,stream);
  await assert.rejects(commitAuthoringPlan(state.env,prepared.principal,prepared.binding,prepared.shared,preview.previewId,preview.approvalHash,saved.plan,prepared.sourceHead,{sql:predicate,bindings:[]}));
  assert.equal(contextEventCount(state,stream),before);assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM authoring_commits").get().n,0);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM event_private_payloads WHERE private_event_id IN(SELECT event_id FROM events WHERE correlation_id=?)").get("authoring:"+prepared.principal.userId+":"+preview.previewId).n,0);
}));

test("Phase3E Output proposals missing owner-migration event custody is rejected until the existing selected refresh indexes it",()=>withPhase3EOutputProposal("owner-custody",async({state,headers,stream,selected})=>{
  const source=state.sqlite.prepare("SELECT event_id FROM events WHERE stream_id=? AND json_extract(payload,'$.block_id')='phase3e-source-output'").get(stream);
  assert.ok(source);assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM project_event_scopes WHERE event_id=?").get(source.event_id).n,0);
  const before=contextEventCount(state,stream),denied=await previewContextChanges(state,[selected],headers);assert.equal(denied.status,409);assert.equal((await denied.json()).error,"context_changes_source_custody_changed");
  assert.equal(contextEventCount(state,stream),before);
  const refreshed=await state.request("/api/events?after=0&limit=2000&content=0",{headers:state.owner});assert.equal(refreshed.status,200,await refreshed.clone().text());
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM project_event_scopes WHERE event_id=?").get(source.event_id).n,1);
  const preview=await previewContextChanges(state,[selected],headers);assert.equal(preview.status,200,await preview.clone().text());assert.equal(contextEventCount(state,stream),before);
},{setup:async({state,headers})=>phase3EAppend(state,headers,[phase3EOutputCreation()])}));

for(const mode of ["owner-custody","selected"])test("Phase3E Output proposals a used reference losing resource custody during the lease cannot commit: "+mode,()=>withPhase3EOutputProposal(mode,async({state,headers,stream,selected})=>{
  const response=await previewContextChanges(state,[selected],headers);assert.equal(response.status,200,await response.clone().text());const{preview}=await response.json(),before=contextEventCount(state,stream);
  state.controls.afterAuthoringClaim=async()=>{state.sqlite.prepare("DELETE FROM project_resource_scopes WHERE project_access_id=? AND resource_kind='reference' AND resource_id='phase3e-owned-reference'").run(state.projectAccessId);};
  const rejected=await applyContextChanges(state,preview,headers);assert.notEqual(rejected.status,200,await rejected.clone().text());assert.equal(contextEventCount(state,stream),before);assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM authoring_commits").get().n,0);
},{setup:async({state,headers,stream})=>{appendFixtureEvents(state.sqlite,stream,[
  ["ReferenceIngested",{project_id:contextBody.projectId,document_id:contextBody.documentId,reference_id:"phase3e-owned-reference",rights_class:"owned",source_type:"text",source_ref:""}],
  ["BlockPropertyEdited",{project_id:contextBody.projectId,document_id:contextBody.documentId,block_id:contextBody.blockId,property_path:"reference_id",old_value:null,new_value:"phase3e-owned-reference"}]
]);const refreshed=await state.request("/api/events?after=0&limit=2000&content=0",{headers:state.owner??headers});assert.equal(refreshed.status,200);}}));


for(const mode of ["personal","owner-custody","selected"])for(const source of ["block","reference"])test("Phase3E Output proposals license expiration is checked against database time at the final receipt: "+mode+"/"+source,()=>withPhase3EOutputProposal(mode,async({state,headers,stream,selected})=>{
  const response=await previewContextChanges(state,[selected],headers);assert.equal(response.status,200,await response.clone().text());const{preview}=await response.json(),before=contextEventCount(state,stream);
  const clock=new DatabaseSync(":memory:");state.phase3ECleanup=()=>clock.close();let reached=false;
  try{
    state.controls.afterAuthoringClaim=async()=>{
      reached=true;assert.ok(Date.now()<Date.parse(state.phase3ELicenseDeadline),"JavaScript's earlier source read still sees the license as live");
      const databaseNow=new Date(Date.parse(state.phase3ELicenseDeadline)+30_000).toISOString();
      // A deterministic SQLite clock boundary: the lease and preview are still live,
      // while the exact source license has expired. No source/event byte is changed.
      state.sqlite.function("strftime",{varargs:true},(...args)=>clock.prepare("SELECT strftime("+args.map(()=>"?").join(",")+") AS value").get(...args.map((arg,index)=>index===1&&arg==="now"?databaseNow:arg)).value);
      const observed=state.sqlite.prepare("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') AS now").get().now;
      assert.ok(observed>state.phase3ELicenseDeadline);
      const saved=JSON.parse(state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(preview.previewId).content);
      assert.ok(saved.leaseExpiresAt>observed);assert.ok(saved.plan.expiresAt>observed);
    };
    const denied=await applyContextChanges(state,preview,headers);assert.equal(reached,true);assert.notEqual(denied.status,200,await denied.clone().text());
    assert.equal(contextEventCount(state,stream),before);assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM authoring_commits").get().n,0);
  }finally{
    // Keep the fixture's DB callable for its final background/read-proof checks.
    state.sqlite.function("strftime",{varargs:true},(...args)=>clock.prepare("SELECT strftime("+args.map(()=>"?").join(",")+") AS value").get(...args).value);
  }
},{setup:async({state,headers,stream})=>{
  state.phase3ELicenseDeadline=new Date(Date.now()+60_000).toISOString();
  if(source==="block")await phase3EAppend(state,state.owner??headers,[{type:"BlockPropertyEdited",payload:{project_id:contextBody.projectId,document_id:contextBody.documentId,block_id:contextBody.blockId,property_path:"license_expires_at",old_value:null,new_value:state.phase3ELicenseDeadline}}]);
  else{
    appendFixtureEvents(state.sqlite,stream,[["ReferenceIngested",{project_id:contextBody.projectId,document_id:contextBody.documentId,reference_id:"phase3e-time-reference",rights_class:"owned_or_licensed",source_type:"text",source_ref:"",license_expires_at:state.phase3ELicenseDeadline}],["BlockPropertyEdited",{project_id:contextBody.projectId,document_id:contextBody.documentId,block_id:contextBody.blockId,property_path:"reference_id",old_value:null,new_value:"phase3e-time-reference"}]]);
    const refreshed=await state.request("/api/events?after=0&limit=2000&content=0",{headers:state.owner??headers});assert.equal(refreshed.status,200);
  }
}}));

for(const mode of ["personal","owner-custody","selected"])for(const complete of [false,true])test("Phase3E model-to-Worker retained research Output copies preserve exact partial/complete source scope: "+mode+"/"+complete,()=>withPhase3EOutputProposal(mode,async({state,headers,stream})=>{
  const {prepareContextAuthority}=await import("../worker/context-authoring-authority.ts"),{storeAuthoringPreview}=await import("../worker/authoring-commits.ts"),{buildContextApplicationPlan}=await import("../src/model/context-proposal-application.ts"),{prepareOutputRequirementClientEvents,outputAuthoringBlocksFromEvents}=await import("../worker/output-requirement-event-guards.ts");
  const prepared=await prepareContextAuthority(new Request("http://localhost/api/context/apply",json(contextBody,headers)),state.env,contextBody,"author");assert.ok(!(prepared instanceof Response));
  const original=prepared.projection.libraryBlocks.find(block=>block.id==="phase3e-research-output");assert.ok(original);
  const planned=buildContextApplicationPlan({projection:prepared.projection,target:prepared.target,proposals:[{key:"retained-research:output",executionId:"retained-research",proposalId:"output",research:{id:"output",area:"related",blockId:original.id,type:"output",subtype:"Executive summary",label:"Saved Output requirements",text:original.properties.text,reason:"Reviewed related source",scope:"project",distance:1,sourceUrl:null,imageUrl:null,license:null,attribution:null}}]});
  const normalized=prepareOutputRequirementClientEvents(planned.events,outputAuthoringBlocksFromEvents(prepared.events));assert.equal(normalized.ok,true);
  const plan={operation:"context-proposal",binding:prepared.binding,sourceHead:prepared.sourceHead,events:normalized.events,changes:planned.changes,result:{blockIds:planned.blockIds,relationCount:planned.relationCount},expiresAt:new Date(Date.now()+600_000).toISOString()};
  const preview=await storeAuthoringPreview(state.env,prepared.principal,plan),before=contextEventCount(state,stream);
  const copied=preview.events.filter(event=>event.type==="BlockCreated"),output=copied.find(event=>event.payload.type==="output"),ids=new Map(copied.map(event=>[event.payload.properties.copied_from_block_id,event.payload.block_id]));
  assert.equal(copied.length,complete?3:2);assert.equal(output.payload.properties.output_spec.id,output.payload.block_id);assert.notEqual(output.payload.block_id,original.id);
  if(complete)assert.deepEqual(output.payload.properties.output_spec.deliverables[0].source_scope,{kind:"blocks",block_ids:[ids.get("phase3e-research-a"),ids.get("phase3e-research-b")]});
  else assert.equal(output.payload.properties.output_spec.deliverables[0].source_scope.kind,"unknown");
  assert.ok(copied.every(event=>event.payload.document_id===contextBody.documentId));assert.ok(preview.events.every(event=>!event.type.startsWith("Output")));
  const committed=await applyContextChanges(state,preview,headers);assert.equal(committed.status,200,await committed.clone().text());assert.equal(contextEventCount(state,stream),before+preview.events.length);
  const rows=state.sqlite.prepare("SELECT event.type,secret.private_json FROM events event JOIN event_private_payloads secret ON secret.private_event_id=event.event_id WHERE event.correlation_id=? ORDER BY event.sequence").all("authoring:"+prepared.principal.userId+":"+preview.previewId);
  assert.deepEqual(rows.map(row=>({type:row.type,payload:JSON.parse(row.private_json)})),preview.events);
  const saved=JSON.parse(state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(preview.previewId).content);assert.equal(saved.approvalHash,preview.approvalHash);assert.deepEqual(saved.plan,plan);
},{paid:false,setup:async({state,headers})=>{
  const {parseOutputRequirement}=await import("../src/model/output-requirements.ts"),documentId="phase3e-research-doc",spec=parseOutputRequirement({id:"phase3e-research-output",type:"output",subtype:"Executive summary",content:"1 slideshow with 5 slides outlining the document."}).spec;
  spec.deliverables[0].source_scope={kind:"blocks",block_ids:["phase3e-research-a","phase3e-research-b"]};
  const scope={project_id:contextBody.projectId,document_id:documentId,scope:"document"};
  const events=[{type:"DocumentCreated",payload:{project_id:contextBody.projectId,document_id:documentId,title:"Research source",handle:"research-source"}},phase3EOutputCreation("phase3e-research-output",documentId,{output_spec:spec}),
    ...["a","b"].map(id=>({type:"BlockCreated",payload:{...scope,block_id:"phase3e-research-"+id,type:"subject",handle:"subject/research-"+id,position:"a-"+id,properties:{label:"Source "+id,text:"Exact retained "+id}}})),
    ...["a",...(complete?["b"]:[])].map(id=>({type:"BlockRelationAdded",payload:{...scope,relation_id:"phase3e-research-link-"+id,from_block_id:"phase3e-research-output",to_block_id:"phase3e-research-"+id,kind:"visual_evidence",properties:{}}}))];
  await phase3EAppend(state,state.owner??headers,events);
}}));


for(const mode of ["personal","owner-custody","selected"])test("Phase3E Output proposals all 48 selected new Output drafts commit atomically within the existing request budget: "+mode,()=>withPhase3EOutputProposal(mode,async({state,headers,stream,profiles})=>{
  const {prepareContextAuthority}=await import("../worker/context-authoring-authority.ts"),{storeAuthoringPreview}=await import("../worker/authoring-commits.ts"),{buildContextApplicationPlan}=await import("../src/model/context-proposal-application.ts"),{prepareOutputRequirementClientEvents,outputAuthoringBlocksFromEvents}=await import("../worker/output-requirement-event-guards.ts");
  const prepared=await prepareContextAuthority(new Request("http://localhost/api/context/apply",json(contextBody,headers)),state.env,contextBody,"author");assert.ok(!(prepared instanceof Response));
  const proposals=Array.from({length:48},(_,index)=>({key:"retained:"+index,executionId:"retained-"+Math.floor(index/24),proposalId:"proposal-"+index,decomposition:{id:"proposal-"+index,type:"emotion",subtype:"Primary affect",label:"Quiet",text:"quiet",sourceExcerpt:"quiet",participants:[],addendum:index>=24},edit:{type:"output",subtype:"Executive summary",label:"Reviewed Output "+index,text:"1 slideshow with 5 slides outlining the document."}}));
  const planned=buildContextApplicationPlan({projection:prepared.projection,target:prepared.target,proposals}),normalized=prepareOutputRequirementClientEvents(planned.events,outputAuthoringBlocksFromEvents(prepared.events));assert.equal(normalized.ok,true);
  const plan={operation:"context-proposal",binding:prepared.binding,sourceHead:prepared.sourceHead,events:normalized.events,changes:planned.changes,result:{blockIds:planned.blockIds,relationCount:planned.relationCount},expiresAt:new Date(Date.now()+600_000).toISOString()};
  assert.equal(plan.result.blockIds.length,48);assert.equal(plan.events.length,97);
  const preview=await storeAuthoringPreview(state.env,prepared.principal,plan),before=contextEventCount(state,stream);
  const applied=await applyContextChanges(state,preview,headers);assert.equal(applied.status,200,await applied.clone().text());const receipt=await applied.json();
  assert.deepEqual(receipt.blockIds,plan.result.blockIds);assert.equal(contextEventCount(state,stream),before+97);assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM authoring_commits").get().n,1);
  assert.ok(profiles.find(profile=>profile.action==="apply").queries<1000);
  const created=state.sqlite.prepare("SELECT secret.private_json FROM events event JOIN event_private_payloads secret ON secret.private_event_id=event.event_id WHERE event.correlation_id=? AND event.type='BlockCreated'").all("authoring:"+prepared.principal.userId+":"+preview.previewId);
  assert.equal(created.length,48);
  for(const row of created){const payload=JSON.parse(row.private_json);assert.equal(payload.type,"output");assert.equal(payload.properties.output_spec.id,payload.block_id);}
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE stream_id=? AND type LIKE 'Output%'").get(stream).n,0);
},{paid:false}));


test("Phase3E exact event proof reuses the large escaped-body fallback without truncating canonical/private bytes",()=>withPhase3EOutputProposal("personal",async({state,stream,owner})=>{
  const {authoringEventProof,authoringEventRowsProof}=await import("../worker/authoring-event-proof.ts"),{makeEvent,eventWriteBindings,EVENT_WRITE_COLUMNS}=await import("../worker/runtime.ts");
  const head=state.sqlite.prepare("SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?").get(stream).head;
  const event=makeEvent(stream,head+1,"user:"+owner,"phase3e-proof-fixture","large-private-proof","BlockCreated",{project_id:contextBody.projectId,document_id:contextBody.documentId,block_id:"large-proof",type:"direction",properties:{text:'"'.repeat(500_000)+"EXACT_PRIVATE_TAIL"}});
  const values=eventWriteBindings(event);assert.ok(Buffer.byteLength(JSON.stringify(values),"utf8")>1_900_000);assert.ok(Buffer.byteLength(values[16],"utf8")<2_000_000);
  await state.env.DB.prepare("INSERT INTO event_write_stage("+EVENT_WRITE_COLUMNS+") VALUES("+values.map(()=>"?").join(",")+")").bind(...values).run();
  const proof=authoringEventProof([event]);assert.equal(proof.bindings.length,17,"same Phase6 raw-binding fallback, not a larger platform-bound JSON value");
  assert.equal((await state.env.DB.prepare("SELECT CASE WHEN "+proof.sql+" THEN 1 ELSE 0 END AS verified").bind(...proof.bindings).first()).verified,1);
  const changed=[...values];changed[16]=changed[16].replace("EXACT_PRIVATE_TAIL","WRONG_PRIVATE_TAIL");const denied=authoringEventRowsProof([changed]);
  assert.equal((await state.env.DB.prepare("SELECT CASE WHEN "+denied.sql+" THEN 1 ELSE 0 END AS verified").bind(...denied.bindings).first()).verified,0);
  const tooLarge=[...values];tooLarge[16]="x".repeat(2_000_001);assert.throws(()=>authoringEventRowsProof([tooLarge]),/authoring_payload_too_large/);
},{paid:false}));
test("Phase3E Output proposals use the actual bounded D1 request/statement budget",(t)=>{
  assert.ok(phase3ED1Profiles.length);
  for(const profile of phase3ED1Profiles){assert.ok(profile.queries<=1000);assert.ok(profile.maxBindings<=100);assert.ok(profile.maxSqlBytes<=100_000);assert.ok(profile.maxValueBytes<=2_000_000);}
  const byAction=new Map();for(const profile of phase3ED1Profiles){const key=profile.mode+"/"+profile.action,current=byAction.get(key)??{queries:0,bindings:0,sqlBytes:0,valueBytes:0};for(const[a,b]of[["queries","queries"],["bindings","maxBindings"],["sqlBytes","maxSqlBytes"],["valueBytes","maxValueBytes"]])current[a]=Math.max(current[a],profile[b]);byAction.set(key,current);}
  t.diagnostic(JSON.stringify({actualD1Requests:Object.fromEntries(byAction)}));
});

// Main170 generic Output authoring must share the native Worker route and the
// accepted personal/selected/migrated-owner authority paths.
async function withMain170Authority(mode, run, { canvas = false } = {}) {
  const state = mode === "personal" ? await fixture() : await sharedProjectFixture();
  if (canvas && mode !== "personal") {
    const { IMAGE_ADAPTER_V52_EVALUATION_EVIDENCE: evidence } = await import("../worker/image-adapter-evaluation-evidence.ts");
    const now = new Date().toISOString(), approval = state.sqlite.prepare("INSERT INTO canvas_governance_requirements(requirement_id,status,evidence_ref,details_json,updated_at) VALUES(?,?,?,?,?)");
    approval.run("trust_safety", "approved", "fixture/trust-safety", "{}", now);
    approval.run("counsel", "approved", "fixture/counsel", "{}", now);
    approval.run("second_image_adapter", "approved", evidence.evaluationRef, JSON.stringify({
      adapter_id: evidence.adapterId, contract_version: evidence.adapterVersion, corpus_version: evidence.corpusVersion,
      evaluation_ref: evidence.evaluationRef, evaluation_passed: true,
    }), now);
  }
  await state.drainBackground();
  const headers = mode === "personal" ? {} : mode === "selected" ? state.owner
    : Object.fromEntries(Object.entries(state.owner).filter(([key]) => key !== "cookie"));
  const owner = mode === "personal" ? "dev-local-creative" : "assistant-owner", stream = "creative:" + owner;
  const depth = enforceD1ExpressionDepth(state), originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("main170_authority_must_not_use_network"); };
  try {
    if (canvas) {
      const created = await main170AuthorityWrite(state, headers, { type: "CanvasCreated", payload: { project_id: "project-atmosphere", canvas_id: "main170-board", name: "Output board", slug: "output-board" } });
      assert.equal(created.status, 200, await created.clone().text());
    }
    await run({ state, headers, owner, stream, depth }); assert.equal(calls, 0);
  }
  finally { await state.drainBackground(); depth.assertVerified(); depth.restore(); globalThis.fetch = originalFetch; state.sqlite.close(); }
}
const main170AuthorityScope = { project_id: "project-atmosphere", document_id: "doc-atmosphere" };
const main170AuthorityOutput = (id = "main170-output", extra = {}) => ({
  type: "BlockCreated", payload: { ...main170AuthorityScope, block_id: id, position: "c0", type: "OUtput",
    properties: { text: 'Output images at aspect ratios "1:1" and "4:5".', subtype: "Social media image",
      weight: 0.8, intent: "avoid", influence: 1, effect: "must_not_include" }, ...extra },
});
const main170AuthorityWrite = (state, headers, event, extra = {}) => state.request("/api/events", json({ action: "append", event, ...extra }, headers));
const main170AuthorityEventCount = (state, stream) => state.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE stream_id=?").get(stream).n;
const main170AuthorityBudgetState = state => Object.fromEntries([
  "document_jobs", "budget_reservations", "cost_budget_reservations", "output_plan_revisions", "output_execution_grants",
  "output_operation_slots", "output_provider_calls", "output_target_acceptances",
].map(name => [name, state.sqlite.prepare("SELECT COUNT(*) AS n FROM " + name).get().n]));
async function main170AuthorityCreate(state, headers, id = "main170-output", extra = {}) {
  const response = await main170AuthorityWrite(state, headers, main170AuthorityOutput(id, extra));
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json(); assert.equal(body.appended.length, 1); return body.appended[0];
}

for (const mode of ["personal", "selected", "owner-custody"]) {
  test("main170 authority union: native Output creation remains a free draft: " + mode, () => withMain170Authority(mode, async ({ state, headers, stream }) => {
    const before = main170AuthorityBudgetState(state), created = await main170AuthorityCreate(state, headers);
    const { inspectOutputRequirement } = await import("../src/model/output-requirements.ts");
    assert.equal(created.type, "BlockCreated"); assert.equal(created.payload.type, "output");
    const properties = created.payload.properties;
    assert.equal(inspectOutputRequirement(properties.output_spec).status, "valid");
    assert.equal(properties.output_spec.id, "main170-output");
    assert.equal(properties.output_spec.deliverables[0].format_variants.length, 2);
    for (const key of ["weight", "intent", "influence", "effect", "confirmed", "output_grant_id"]) assert.equal(Object.hasOwn(properties, key), false, key);
    assert.deepEqual(main170AuthorityBudgetState(state), before);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE stream_id=? AND type LIKE 'Output%'").get(stream).n, 0);
    if (mode === "owner-custody") {
      const unselected = await state.request("/api/output-requirements?documentId=doc-atmosphere", { headers });
      assert.equal(unselected.status, 403); assert.equal((await unselected.json()).errorCode, "project_context_required");
      const refresh = await state.request("/api/events?after=0&limit=2000&content=0", { headers: state.owner }); assert.equal(refresh.status, 200);
    }
    const read = await state.request("/api/output-requirements?documentId=doc-atmosphere", { headers: mode === "owner-custody" ? state.owner : headers });
    assert.equal(read.status, 200, await read.clone().text());
    const snapshot = await read.json(); assert.equal(snapshot.requirements.length, 1);
    assert.equal(snapshot.requirements[0].blockId, "main170-output");
    assert.deepEqual(main170AuthorityBudgetState(state), before);
  }));

  test("main170 authority union: generic edits cannot confer Output authority or partially apply a batch: " + mode, () => withMain170Authority(mode, async ({ state, headers, stream }) => {
    await main170AuthorityCreate(state, headers);
    const before = main170AuthorityEventCount(state, stream), finances = main170AuthorityBudgetState(state);
    const edit = (property_path, new_value) => ({ type: "BlockPropertyEdited", payload: { ...main170AuthorityScope, block_id: "main170-output", property_path, new_value } });
    const prohibited = [
      edit("text", "A stale rewrite"), edit("output_spec", {}), edit("type", "format"), edit("weight", 1),
      { type: "BlockRemoved", payload: { ...main170AuthorityScope, block_id: "main170-output" } },
      { type: "BlockRenamed", payload: { ...main170AuthorityScope, block_id: "main170-output", name: "No confirmation" } },
      { type: "OutputPlanConfirmed", payload: { ...main170AuthorityScope, plan_id: "not-a-confirmed-plan" } },
      { type: "OutputExecutionAuthorized", payload: { ...main170AuthorityScope, grant_id: "not-a-grant" } },
      main170AuthorityOutput("main170-output"),
      main170AuthorityOutput("status-injected", { properties: { text: "Draft only", output_grant_id: "not-a-grant" } }),
    ];
    for (const event of prohibited) {
      const response = await main170AuthorityWrite(state, headers, event);
      assert.ok(response.status >= 400, event.type + ": " + await response.clone().text());
      assert.equal(main170AuthorityEventCount(state, stream), before, event.type);
    }
    const response = await state.request("/api/events", json({ action: "batch", events: [
      { type: "BlockCreated", payload: { ...main170AuthorityScope, block_id: "should-not-be-partially-created", type: "direction", properties: { text: "Ordinary context" } } },
      edit("text", "Still requires the Output endpoint"),
    ] }, headers));
    assert.ok(response.status >= 400, await response.clone().text());
    assert.equal(main170AuthorityEventCount(state, stream), before);
    assert.deepEqual(main170AuthorityBudgetState(state), finances);
  }));

  test("main170 authority union: removed requirements in non-current Documents retain their generic-edit guard: " + mode, () => withMain170Authority(mode, async ({ state, headers, stream }) => {
    await main170AuthorityCreate(state, headers);
    appendFixtureEvents(state.sqlite, stream, [
      ["BlockRemoved", { ...main170AuthorityScope, block_id: "main170-output" }],
      ["DocumentCreated", { project_id: "project-atmosphere", document_id: "main170-other-doc", title: "Other document" }],
      ["DocumentOpened", { project_id: "project-atmosphere", document_id: "main170-other-doc" }],
    ]);
    const before = main170AuthorityEventCount(state, stream);
    for (const event of [
      { type: "BlockRestored", payload: { ...main170AuthorityScope, block_id: "main170-output" } },
      { type: "BlockPropertyEdited", payload: { ...main170AuthorityScope, block_id: "main170-output", property_path: "text", new_value: "Removed does not mean ungoverned" } },
    ]) {
      const response = await main170AuthorityWrite(state, headers, event), body = await response.json();
      assert.equal(response.status, 409, JSON.stringify(body)); assert.equal(body.error, "output_requirement_endpoint_required");
      assert.equal(main170AuthorityEventCount(state, stream), before);
    }
  }));

  test("main170 authority union: Canvas receipt retry preserves the original Output position event: " + mode, () => withMain170Authority(mode, async ({ state, headers, owner, stream }) => {
    const created = await main170AuthorityCreate(state, headers);
    const move = { type: "BlockPropertyEdited", payload: { ...main170AuthorityScope, block_id: "main170-output", property_path: "position",
      old_value: "c0", new_value: "d0", canvas_id: "main170-board", client_event_id: "main170-canvas-position", history_owner_id: owner } };
    const first = await main170AuthorityWrite(state, headers, move, { action: "canvas_sync" });
    assert.equal(first.status, 200, await first.clone().text()); const written = await first.json();
    assert.equal(written.appended.length, 1); assert.equal(written.appended[0].payload.new_value, "d0");
    const count = main170AuthorityEventCount(state, stream);
    const again = await main170AuthorityWrite(state, headers, move, { action: "canvas_sync" });
    assert.equal(again.status, 200, await again.clone().text()); assert.equal((await again.json()).appended[0].eventId, written.appended[0].eventId);
    assert.equal(main170AuthorityEventCount(state, stream), count);
    const stale = await main170AuthorityWrite(state, headers, { ...move, payload: { ...move.payload, client_event_id: "new-stale-position", new_value: "e0" } }, { action: "canvas_sync" });
    assert.equal(stale.status, 409, await stale.clone().text()); assert.equal(main170AuthorityEventCount(state, stream), count);
    const { foldEvents } = await import("../src/model/events.ts"), { readEvents } = await import("../worker/runtime.ts");
    const projected = foldEvents(await readEvents(state.env, stream), Number.POSITIVE_INFINITY, "doc-atmosphere", "project-atmosphere");
    const output = projected.blocks.find(block => block.id === "main170-output");
    assert.equal(output.position, "d0"); assert.deepEqual(output.properties, created.payload.properties);
  }, { canvas: true }));

  for (const action of ["append", "canvas_sync"]) for (const changedSource of ["position", "unrelated-head"]) test("main170 authority union: final owner-head guard rejects a newer Output position: " + mode + "/" + action + "/" + changedSource, () => withMain170Authority(mode, async ({ state, headers, owner, stream }) => {
    await main170AuthorityCreate(state, headers);
    const before = main170AuthorityEventCount(state, stream), batch = state.env.DB.batch;
    let injected = 0;
    state.env.DB.batch = async function (statements) {
      if (!injected && statements.some(statement => /^\s*INSERT INTO event_write_stage/iu.test(statement.sql) && statement.values.includes("main170-older-position"))) {
        injected++; appendFixtureEvents(state.sqlite, stream, changedSource === "position" ? [["BlockPropertyEdited", { ...main170AuthorityScope, block_id: "main170-output",
          property_path: "position", old_value: "c0", new_value: "d0" }]] : [["DocumentOpened", main170AuthorityScope]]);
      }
      return batch.call(this, statements);
    };
    try {
      const response = await main170AuthorityWrite(state, headers, { type: "BlockPropertyEdited", payload: {
        ...main170AuthorityScope, block_id: "main170-output", property_path: "position", old_value: "c0", new_value: "e0",
        ...(action === "canvas_sync" ? { canvas_id: "main170-board", client_event_id: "main170-older-position", history_owner_id: owner } : {}),
      } }, { action, correlationId: "main170-older-position" });
      assert.equal(injected, 1); assert.equal(response.status, 409, await response.clone().text());
      assert.equal(main170AuthorityEventCount(state, stream), before + 1);
      assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE correlation_id='main170-older-position'").get().n, 0);
      assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM event_client_receipts WHERE client_event_id='main170-older-position'").get().n, 0);
    } finally { state.env.DB.batch = batch; }
  }, { canvas: action === "canvas_sync" }));
}

test("main170 authority union: native shared Output reads refuse a stale source without repairing it", () => withMain170Authority("selected", async ({ state, headers, stream }) => {
  await main170AuthorityCreate(state, headers);
  const initial = await state.request("/api/output-requirements?documentId=doc-atmosphere", { headers });
  assert.equal(initial.status, 200, await initial.clone().text());
  const indexed = state.sqlite.prepare("SELECT last_owner_sequence FROM project_migration_states WHERE project_access_id=?").get(state.projectAccessId).last_owner_sequence;
  appendFixtureEvents(state.sqlite, stream, [["DocumentOpened", main170AuthorityScope]]);
  const before = state.sqlite.prepare("SELECT total_changes() AS n").get().n;
  const stale = await state.request("/api/output-requirements?documentId=doc-atmosphere", { headers });
  assert.equal(stale.status, 409, await stale.clone().text()); assert.equal((await stale.json()).errorCode, "output_target_source_projection_stale");
  assert.equal(state.sqlite.prepare("SELECT total_changes() AS n").get().n, before);
  assert.equal(state.sqlite.prepare("SELECT last_owner_sequence FROM project_migration_states WHERE project_access_id=?").get(state.projectAccessId).last_owner_sequence, indexed);
  const refreshed = await state.request("/api/events?after=0&limit=2000&content=0", { headers }); assert.equal(refreshed.status, 200);
  const current = await state.request("/api/output-requirements?documentId=doc-atmosphere", { headers }); assert.equal(current.status, 200, await current.clone().text());
}));

test("main170 authority union: shared source quarantine at the exact Output read keeps the response private", () => withMain170Authority("selected", async ({ state, headers, stream }) => {
  await main170AuthorityCreate(state, headers);
  const count = main170AuthorityEventCount(state, stream), batch = state.env.DB.batch;
  let changed = false;
  state.env.DB.batch = async function (statements) {
    if (!changed && statements.some(statement => statement.sql.includes("AS projection_current"))) {
      changed = true; state.sqlite.prepare("UPDATE project_migration_states SET status='disabled' WHERE project_access_id=?").run(state.projectAccessId);
    }
    return batch.call(this, statements);
  };
  try {
    const read = await state.request("/api/output-requirements?documentId=doc-atmosphere", { headers });
    assert.equal(changed, true); assert.equal(read.status, 403, await read.clone().text());
    assert.equal((await read.json()).errorCode, "output_execution_authority_revoked");
    assert.equal(main170AuthorityEventCount(state, stream), count);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM output_atomic_assertions").get().n, 0);
  } finally { state.env.DB.batch = batch; }
}));

test("main170 authority union: viewer and revoked selected sessions cannot author Output requirements", () => withMain170Authority("selected", async ({ state, headers, stream }) => {
  const before = main170AuthorityEventCount(state, stream), finances = main170AuthorityBudgetState(state);
  const reader = await main170AuthorityWrite(state, state.viewer, main170AuthorityOutput("viewer-output"));
  assert.equal(reader.status, 403, await reader.clone().text());
  state.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE project_access_id=? AND principal_user_id='assistant-owner'").run(new Date().toISOString(), state.projectAccessId);
  const revoked = await main170AuthorityWrite(state, headers, main170AuthorityOutput("revoked-output"));
  assert.equal(revoked.status, 403, await revoked.clone().text());
  assert.equal(main170AuthorityEventCount(state, stream), before);
  assert.deepEqual(main170AuthorityBudgetState(state), finances);
}));


for (const mode of ["personal", "selected", "owner-custody"]) {
  test("main170 authority union: ordinary Canvas rebase behavior is unchanged: " + mode, () => withMain170Authority(mode, async ({ state, headers, owner, stream }) => {
    await main170AuthorityCreate(state, headers, "ordinary-direction", { type: "direction", properties: { text: "Ordinary source direction", weight: 1 } });
    const before = main170AuthorityEventCount(state, stream), batch = state.env.DB.batch;
    let injected = false;
    state.env.DB.batch = async function (statements) {
      if (!injected && statements.some(statement => /^\s*INSERT INTO event_write_stage/iu.test(statement.sql) && statement.values.includes("main170-ordinary-position"))) {
        injected = true; appendFixtureEvents(state.sqlite, stream, [["DocumentOpened", main170AuthorityScope]]);
      }
      return batch.call(this, statements);
    };
    try {
      const response = await main170AuthorityWrite(state, headers, { type: "BlockPropertyEdited", payload: {
        ...main170AuthorityScope, block_id: "ordinary-direction", property_path: "position", old_value: "c0", new_value: "d0",
        canvas_id: "main170-board", client_event_id: "main170-ordinary-position", history_owner_id: owner,
      } }, { action: "canvas_sync", correlationId: "main170-ordinary-position" });
      assert.equal(injected, true);
      // Selected-project appends already reject an owner-head change. The
      // account Canvas helper retains its ordinary commutative retry behavior.
      assert.equal(response.status, mode === "selected" ? 409 : 200, await response.clone().text());
      assert.equal(main170AuthorityEventCount(state, stream), before + (mode === "selected" ? 1 : 2));
    } finally { state.env.DB.batch = batch; }
  }, { canvas: true }));

  for (const output of [true, false]) test("main170 authority union: exact Canvas receipt recovery survives a lost acknowledgement: " + mode + "/" + (output ? "Output" : "ordinary"), () => withMain170Authority(mode, async ({ state, headers, owner, stream }) => {
    const blockId = output ? "main170-output" : "ordinary-direction";
    await main170AuthorityCreate(state, headers, blockId, output ? {} : { type: "direction", properties: { text: "Ordinary source direction", weight: 1 } });
    const count = main170AuthorityEventCount(state, stream), batch = state.env.DB.batch;
    let lost = false;
    state.env.DB.batch = async function (statements) {
      const result = await batch.call(this, statements);
      if (!lost && statements.some(statement => /^\s*INSERT INTO event_write_stage/iu.test(statement.sql) && statement.values.includes("main170-lost-move"))) {
        lost = true; throw new Error("mock_lost_write_acknowledgement");
      }
      return result;
    };
    const move = { type: "BlockPropertyEdited", payload: { ...main170AuthorityScope, block_id: blockId,
      property_path: "position", old_value: "c0", new_value: "d0", canvas_id: "main170-board",
      client_event_id: "main170-lost-move", history_owner_id: owner } };
    try {
      const response = await main170AuthorityWrite(state, headers, move, { action: "canvas_sync", correlationId: "main170-lost-move" });
      assert.equal(lost, true);
      assert.equal(response.status, mode === "selected" ? 409 : 200, await response.clone().text());
      const committed = state.sqlite.prepare("SELECT event_id FROM events WHERE stream_id=? AND correlation_id='main170-lost-move'").all(stream);
      assert.equal(committed.length, 1); assert.equal(main170AuthorityEventCount(state, stream), count + 1);
      const retry = await main170AuthorityWrite(state, headers, move, { action: "canvas_sync", correlationId: "main170-lost-move" });
      assert.equal(retry.status, 200, await retry.clone().text());
      const recovered = await retry.json(); assert.equal(recovered.appended.length, 1); assert.equal(recovered.appended[0].eventId, committed[0].event_id);
      assert.equal(main170AuthorityEventCount(state, stream), count + 1);
      assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM event_client_receipts WHERE event_id=?").get(committed[0].event_id).n, 1);
    } finally { state.env.DB.batch = batch; }
  }, { canvas: true }));
}
