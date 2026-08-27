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
const [{ default: worker }, { PLATFORM_PRINCIPAL_WITH_ACCESS_SQL,PRINCIPAL_WITH_ACCESS_SQL }, {requireUser,reconcileFailedBudgetReservations}] = await Promise.all([
  import("../worker/index.ts"),
  import("../worker/access-policy.ts"),
  import("../worker/pilot-policy.ts"),
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
      const result=this.execute("run");
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

test("board planning authorizes exact live boards and retains board identity in accepted, listed, and completed jobs",async()=>{
  const state=await fixture({provider:true});
  appendFixtureEvents(state.sqlite,"creative:dev-local-creative",[
    ["CanvasCreated",{canvas_id:"assistant-board-a",project_id:"project-atmosphere",name:"Board A",slug:"board-a"}],
    ["CanvasCreated",{canvas_id:"assistant-board-b",project_id:"project-atmosphere",name:"Board B",slug:"board-b"}],
    ["CanvasCreated",{canvas_id:"assistant-foreign-board",project_id:"foreign-project",name:"Foreign board",slug:"foreign"}],
  ]);
  const submit=(canvasId)=>state.request("/api/document-jobs",json({kind:"structure_adaptive",documentId:"doc-atmosphere",sourceSurface:"canvas",payload:{prompt:"Review this board without changing it.",projectScope:true,...(canvasId?{canvasId}:{})}}));
  const missing=await submit("");
  assert.equal(missing.status,400);
  assert.equal((await missing.json()).error,"canvas_context_required");
  const foreign=await submit("assistant-foreign-board");
  assert.equal(foreign.status,404);
  assert.equal((await foreign.json()).error,"canvas_not_found");
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM document_jobs").get().count,0);

  const originalFetch=globalThis.fetch;
  globalThis.fetch=async(_url,init)=>{
    const body=JSON.parse(init.body);
    return Response.json({id:"board-planning-response",model:body.model,
      output_text:JSON.stringify({interpretation:"Board A can explore a clearer subject.",active_decision:{type:"subject",label:"Choose a subject",prompt:"Who belongs here?",why:"Keep the composition grounded."},suggested_blocks:[],hidden_until_later:[]}),
      usage:{input_tokens:80,output_tokens:30,total_tokens:110}});
  };
  try{
    const accepted=await submit("assistant-board-a");
    assert.equal(accepted.status,202,JSON.stringify(await accepted.clone().json()));
    const queued=await accepted.json();
    assert.equal(queued.job.canvasId,"assistant-board-a");
    await state.drainBackground();
    const listing=await(await state.request("/api/document-jobs")).json();
    const completed=listing.jobs.find((job)=>job.jobId===queued.job.jobId);
    assert.equal(completed.status,"completed");
    assert.equal(completed.canvasId,"assistant-board-a");
    assert.equal(completed.result.structure.interpretation,"Board A can explore a clearer subject.");
    const detail=await(await state.request(`/api/document-jobs/${queued.job.jobId}`)).json();
    assert.equal(detail.job.canvasId,"assistant-board-a");

    appendFixtureEvents(state.sqlite,"creative:dev-local-creative",[["CanvasRemoved",{canvas_id:"assistant-board-a",project_id:"project-atmosphere"}]]);
    const removed=await submit("assistant-board-a");
    assert.equal(removed.status,404);
    assert.equal((await removed.json()).error,"canvas_not_found");
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
  const state=await fixture({provider:true}),original=globalThis.fetch,NativeDate=Date;let calls=0;
  try{
    const past=Date.now()-40*86_400_000;
    globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[past]));}static now(){return past;}};
    globalThis.fetch=async(_url,init)=>{calls++;return contextResult(JSON.parse(init.body));};const quote=await quoteContext(state);
    assert.equal((await executeContext(state,quote)).status,200);globalThis.Date=NativeDate;
    const reopened=await quoteContext(state);assert.equal(reopened.executionId,quote.executionId);assert.equal(reopened.period,quote.period);
    assert.equal((await retrieveContext(state,reopened)).status,200);assert.equal(calls,1);
    assert.equal(state.sqlite.prepare("SELECT period FROM cost_budget_reservations").get().period,quote.period);
  }finally{globalThis.Date=NativeDate;globalThis.fetch=original;}
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
