// Actual full Store/Worker fixtures; synthetic SQLite, DOM and IndexedDB only.
import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
const ROOT=fileURLToPath(new URL("../../",import.meta.url));
// Reuse the actual Worker/SQLite and full production Store/DOM transport fixtures.
const { createSceneCostFixture } = await import("file://" + ROOT + "tests/helpers/scene-cost-fixture.mjs");

const { createSceneStoreHost, sceneDeferred, untilScene } = await import("file://" + ROOT + "tests/helpers/scene-cost-store-host.mjs");

const { appendAuditEvent, readWorkspaceEvents } = await import("file://" + ROOT + "worker/runtime.ts");

const { withDocumentInRoute } = await import("file://" + ROOT + "src/model/routes.ts");

const navigationTypes = new Set(["ProjectOpened", "DocumentOpened"]);

const matrix = [];

const pause = () => new Promise(resolve => setImmediate(resolve));

const eventRequest = request => request.url.startsWith("/api/events?") && (request.init.method ?? "GET") === "GET";

const financialTables = ["document_jobs", "budget_reservations", "budget_counters", "cost_budget_reservations", "cost_budget_counters", "output_provider_calls", "output_operation_slots", "consequential_executions", "consequential_steps"];

const financial = worker => Object.fromEntries(financialTables.map(table => [table, worker.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table) ? worker.sqlite.prepare('SELECT * FROM "' + table + '" ORDER BY rowid').all() : null]));

const view = h => ({ events: h.store.events.get().length, visibleEvents: h.store.eventView.get().length, content: Object.keys(h.store.content.get()).length,
  replay: h.store.replayEvents.get().length, project: h.store.projection.get().projectId, document: h.store.projection.get().documentId,
  artifacts: h.store.projection.get().libraryArtifacts.length, head: h.store.head.get() });

const isRetired = h => { const v = view(h); return v.visibleEvents === 0 && v.content === 0 && v.replay === 0 && v.artifacts === 0 && v.project === ""; };

function result(t, expected, observed, pass) { matrix.push({ case: t.name, expected, observed, pass }); t.diagnostic(JSON.stringify({ expected, observed, pass })); assert.ok(pass, expected); }

async function settled(promise) { try { await promise; return null; } catch (error) { return error instanceof Error ? error.message : String(error); } }


async function sourceFixture(t, { shared = true, reader = true, personalSibling = false, queued = false } = {}) {
  t.mock.method(globalThis, "fetch", async () => assert.fail("No live network or provider call in this audit"));
  const worker = await createSceneCostFixture(1, "visual", { shared });
  let originalJob = null;
  if (queued) {
    assert.equal(reader, false, "The actual original purchaser is this owner");
    assert.equal((await worker.request("/api/events?after=0&limit=2000&content=0")).status, 200, "reuse the normal authorized shared-index refresh before admission");
    const inspected = await worker.preview(); assert.equal(inspected.response.status, 200, inspected.body.error);
    const admitted = await worker.approve(inspected.body.sceneCostPreview); assert.equal(admitted.response.status, 202);
    originalJob = admitted.body.job; assert.ok(originalJob?.jobId);
  }
  if (personalSibling) {
    await appendAuditEvent(worker.env, worker.streamId, "user", "ProjectCreated", { project_id: "source-personal-project", name: "Current personal project" });
    await appendAuditEvent(worker.env, worker.streamId, "user", "DocumentCreated", { project_id: "source-personal-project", document_id: "source-personal-document", title: "Current personal document" });
    await appendAuditEvent(worker.env, worker.streamId, "user", "BlockCreated", { project_id: "source-personal-project", document_id: "source-personal-document", block_id: "source-personal-block", type: "direction", properties: { text: "Current independently authorized personal direction." } });
  }
  // Same genuine viewer-membership/selection setup as navigationFixture in d9adb249…;
  // no source handler, permission function, or session response is replaced.
  if (reader) {
    assert.equal(shared, true);
    const actor = "source-denial-reader", email = "source-denial-reader@local.forma", now = new Date().toISOString(), share = worker.sharing;
    worker.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,'creator','pilot-2026-08-10',?,?,?)").run(actor, email, "Source reader", now, now, now);
    worker.sqlite.prepare("INSERT INTO organization_memberships(membership_id,organization_id,user_id,role,status,invited_by_user_id,accepted_at,created_at,updated_at) VALUES(?,?,?,'member','active',?,?,?,?)").run("source-reader-org", share.organizationId, actor, worker.owner, now, now, now);
    worker.sqlite.prepare("INSERT INTO project_memberships(membership_id,organization_id,project_access_id,project_id,user_id,role,status,granted_by_user_id,created_at,updated_at) VALUES(?,?,?,?,?,'viewer','active',?,?,?)").run("source-reader-project", share.organizationId, share.projectAccessId, worker.projectId, actor, worker.owner, now, now);
    const identity = { "oai-authenticated-user-id": actor, "oai-authenticated-user-email": email };
    worker.setScopedHeaders(identity);
    const selected = await worker.request("/api/workspaces/" + share.organizationId + "/projects/" + share.projectAccessId + "/context", { method: "POST" });
    assert.equal(selected.status, 200, await selected.clone().text());
    worker.setScopedHeaders({ ...identity, cookie: selected.headers.get("set-cookie").split(";")[0] });
  }
  const h = await createSceneStoreHost({ workerFixture: worker });
  if (originalJob) { h.store.documentJobs.set([originalJob]); h.originalJobId = originalJob.jobId; }
  const oldHistory = globalThis.history;
  globalThis.history = { pushState(_state, _title, route) { const url = new URL(route, "http://localhost"); Object.assign(h.location, { pathname: url.pathname, search: url.search, hash: url.hash, href: url.href }); }, replaceState(...args) { this.pushState(...args); } };
  h.deep = withDocumentInRoute("/", worker.documentId, "Exact source");
  h.store.setRoute(h.deep); h.store.loading.set(false);
  assert.equal(h.store.projection.get().projectId, worker.projectId);
  assert.equal(h.store.projection.get().documentId, worker.documentId);
  assert.equal(h.store.projection.get().libraryArtifacts.length, 1);
  const beforeMoney = financial(worker);
  let expectedHistory = (await readWorkspaceEvents(worker.env, worker.streamId)).filter(event => !navigationTypes.has(event.type));
  h.seedEvent = async (type, payload) => {
    assert.ok(["DocumentOpened", "DocumentArtifactEdited"].includes(type), "Only the named, synthetic interleaving is seeded");
    const event = await appendAuditEvent(worker.env, worker.streamId, "user", type, { project_id: worker.projectId, document_id: worker.documentId, ...payload });
    expectedHistory = (await readWorkspaceEvents(worker.env, worker.streamId)).filter(value => !navigationTypes.has(value.type));
    return event;
  };
  h.revoke = () => reader
    ? worker.sqlite.prepare("UPDATE project_memberships SET status='revoked',updated_at=? WHERE membership_id='source-reader-project'").run(new Date().toISOString())
    : worker.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE context_id=?").run(new Date().toISOString(), worker.sharing.contextId);
  h.restoreMembership = () => worker.sqlite.prepare("UPDATE project_memberships SET status='active',updated_at=? WHERE membership_id='source-reader-project'").run(new Date().toISOString());
  t.after(async () => {
    try {
      assert.deepEqual(financial(worker), beforeMoney, "Jobs, reservations, used/held accounting and exact original IDs are unchanged");
      assert.deepEqual((await readWorkspaceEvents(worker.env, worker.streamId)).filter(event => !navigationTypes.has(event.type)), expectedHistory, "No unexpected source/result/approval history change");
      assert.equal(h.requests.filter(request => request.url.startsWith("/api/document-jobs") && request.init.method === "POST").length, 0, "No automatic purchase, retry or dispatch");
    } finally { globalThis.history = oldHistory; await h.close(); }
  });
  return h;
}


// Reuses the deterministic request/transaction pattern in persona-portfolio's
// indexedDbFixture, with actual named databases, keyPath and queued completion.
// This is a RAM browser port, not a replacement account-cache implementation.
function accountCachePort(t, delayedOpens = []) {
  const databases = new Map(), pending = new Map(); let opens = 0;
  const indexedDB = { open(name) {
    const sequence = ++opens, request = {};
    const finish = () => queueMicrotask(() => {
      let database = databases.get(name), created = false;
      if (!database) {
        created = true; const stores = new Map();
        database = { stores, objectStoreNames: { contains: key => stores.has(key) },
          createObjectStore(key, options) { stores.set(key, { keyPath: options.keyPath, values: new Map() }); }, close() {},
          transaction(key) {
            const saved = stores.get(key); assert.ok(saved, "Actual requested IndexedDB store exists");
            let requests = 0, complete = false; const transaction = {};
            const enqueue = operation => {
              const operationRequest = {}; requests++;
              queueMicrotask(() => {
                try { operationRequest.result = operation(); operationRequest.onsuccess?.({ target: operationRequest }); }
                catch (error) { operationRequest.error = error; operationRequest.onerror?.({ target: operationRequest }); transaction.onerror?.(); }
                requests--; queueMicrotask(() => { if (!requests && !complete) { complete = true; transaction.oncomplete?.(); } });
              });
              return operationRequest;
            };
            transaction.objectStore = () => ({
              get: key => enqueue(() => structuredClone(saved.values.get(key))),
              getAll: () => enqueue(() => [...saved.values.values()].map(value => structuredClone(value))),
              getAllKeys: () => enqueue(() => [...saved.values.keys()]),
              put: value => enqueue(() => { saved.values.set(value[saved.keyPath], structuredClone(value)); return value[saved.keyPath]; }),
              delete: key => enqueue(() => saved.values.delete(key)), clear: () => enqueue(() => saved.values.clear()),
            });
            return transaction;
          },
        };
        databases.set(name, database);
      }
      request.result = database;
      if (created) request.onupgradeneeded?.({ target: request });
      request.onsuccess?.({ target: request });
    });
    if (delayedOpens.includes(sequence)) pending.set(sequence, finish); else finish();
    return request;
  } };
  const previous = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, writable: true, value: indexedDB });
  t.after(() => { if (previous) Object.defineProperty(globalThis, "indexedDB", previous); else delete globalThis.indexedDB; });
  return { pending, release(sequence) { const finish = pending.get(sequence); assert.ok(finish); pending.delete(sequence); finish(); },
    rows() { return [...(databases.get("forma-account-snapshots-v1")?.stores.get("snapshots")?.values.values() ?? [])]; } };
}

function snapshotIdentity(session) {
  return { userId: session.user.userId, principalUserId: session.impersonation?.actor.userId ?? session.user.userId,
    audience: session.audience ?? "creative", organizationId: session.projectContext?.organizationId ?? null,
    projectAccessId: session.projectContext?.projectAccessId ?? null, permissionEpoch: session.permissionEpoch ?? "legacy",
    accessExpiresAt: session.projectContext?.expiresAt ?? null, policyVersion: session.policy.version,
    accepted: session.policy.accepted, impersonating: Boolean(session.impersonation) };
}

const eventPost=r=>r.url==="/api/events"&&r.init.method==="POST";

const input=(h,id,client=false)=>({type:"BlockCreated",payload:{project_id:h.worker.projectId,document_id:h.worker.documentId,block_id:id,type:"direction",properties:{text:"Private exact authored text "+id},...(client?{client_event_id:"client-"+id}:{})}});

const canvasInput=(h,id)=>({type:"CanvasCreated",payload:{project_id:h.worker.projectId,canvas_id:"board-"+id,name:"Private canvas "+id,client_event_id:"client-"+id,history_owner_id:h.worker.owner}});

async function writeFixture(t,{shared=true}={}){
 t.mock.method(globalThis,"fetch",async()=>assert.fail("No external or provider request"));
 const worker=await createSceneCostFixture(1,"visual",{shared,depth:true}),h=await createSceneStoreHost({workerFixture:worker});
 const oldHistory=globalThis.history;globalThis.history={pushState(_s,_t,route){const u=new URL(route,"http://localhost");Object.assign(h.location,{pathname:u.pathname,search:u.search,hash:u.hash,href:u.href});},replaceState(...args){this.pushState(...args);}};
 h.location.href=new URL(h.location.pathname+h.location.search+h.location.hash,"http://localhost").href;
 h.store.loading.set(false);const before=financial(worker);
 h.revoke=()=>{if(shared)worker.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE context_id=?").run(new Date().toISOString(),worker.sharing.contextId);else worker.env.FORMA_PILOT_COHORT_ID="synthetic-missing-controlled-cohort";};
 h.restore=()=>{if(shared)worker.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=NULL WHERE context_id=?").run(worker.sharing.contextId);else delete worker.env.FORMA_PILOT_COHORT_ID;};
 h.retired=()=>h.store.events.get().length===0&&Object.keys(h.store.content.get()).length===0&&h.store.projection.get().projectId==="";
 h.deny=async()=>{h.revoke();await assert.rejects(h.store.refreshEvents(),/403/);assert.ok(h.retired());};
 t.after(async()=>{try{assert.deepEqual(financial(worker),before,"Original jobs and all financial rows unchanged");assert.equal(h.requests.filter(r=>r.url.startsWith("/api/document-jobs")&&r.init.method==="POST").length,0);}finally{globalThis.history=oldHistory;await h.close();}});
 return h;
}
export { createSceneCostFixture,createSceneStoreHost,sceneDeferred,untilScene,appendAuditEvent,readWorkspaceEvents,withDocumentInRoute,navigationTypes,matrix,pause,eventRequest,financialTables,financial,view,isRetired,result,settled,sourceFixture,accountCachePort,snapshotIdentity,eventPost,input,canvasInput,writeFixture };
