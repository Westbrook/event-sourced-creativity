import assert from "node:assert/strict";
import test from "node:test";
import { createSceneStoreHost, sceneDeferred, untilScene } from "./helpers/scene-cost-store-host.mjs";
import { financial } from "./helpers/event-source-retirement-fixture.mjs";

// Full actual Store; the existing local RAM Worker, HTTP and timer ports are synthetic.
// No live account, provider or document mutation is exercised.
async function inboxHost(t) {
  const networkAttempts=[];
  t.mock.method(globalThis, "fetch", async (...args) => {
    networkAttempts.push(String(args[0]));assert.fail("No live network or provider call");
  });
  const h = await createSceneStoreHost({count:1, exposeSceneTestAccessors:false});
  const before = financial(h.worker);
  h.reply = () => Response.json({tasks:[]});
  h.sessionReply = null; h.eventsReply = null; h.denied=[];
  h.intercept = request => {
    const violation=(request.init.method ?? "GET") !== "GET" ? "non-GET"
      : request.body !== null ? "request-body"
      : request.url === "/api/workspaces/reviews" && request.init.credentials !== "same-origin" ? "credentials"
      : request.url === "/api/workspaces/reviews" || request.url === "/api/session" && h.sessionReply
        || request.url.startsWith("/api/events?") && h.eventsReply ? null : "unexpected-path";
    if(violation){h.denied.push({url:request.url,violation});assert.fail(violation);}
    if (request.url === "/api/workspaces/reviews") {
      return h.reply(request);
    }
    if (request.url === "/api/session" && h.sessionReply) return h.sessionReply(request);
    if (request.url.startsWith("/api/events?") && h.eventsReply) return h.eventsReply(request);
    assert.fail("Unexpected application request: " + request.url);
  };
  t.after(async () => {
    try {
      assert.deepEqual(financial(h.worker), before, "Jobs and all financial rows unchanged");
      assert.deepEqual(h.denied,[],"No request violations, including swallowed exceptions");
      assert.deepEqual(networkAttempts,[],"No swallowed live-network attempt");
      assert.ok(h.requests.every(r => (r.init.method ?? "GET") === "GET"));
      t.diagnostic(JSON.stringify({requests:h.requests.map(r=>r.url),principal:h.store.session.get()?.user.userId,liveNetwork:false}));
    } finally { await h.close(); }
  });
  return h;
}
const task = name => ({status:"assigned",taskId:name});
const expectInbox = (h, state, tasks=[]) => {
  assert.equal(h.store.reviewInboxState.get(),state);
  assert.deepEqual(h.store.reviewInbox.get(),tasks);
};

test("Activity review inbox distinguishes failed and malformed reads from certified empty", async t => {
  const h=await inboxHost(t);
  const gate=sceneDeferred();h.reply=()=>gate.promise;
  const pending=h.store.syncReviewInbox();expectInbox(h,"loading");
  gate.resolve(Response.json({error:"unavailable"},{status:503}));
  assert.equal(await pending,false);expectInbox(h,"error");
  for (const body of [{},null,{tasks:null},{tasks:[null]},{tasks:[{}]},{tasks:[],error:"unavailable"}]) {
    h.reply=()=>Response.json(body);
    assert.equal(await h.store.syncReviewInbox(),false);expectInbox(h,"error");
  }
  h.reply=()=>Response.json({tasks:[]});
  assert.equal(await h.store.syncReviewInbox(),true);expectInbox(h,"ready");
});

test("Activity review inbox ignores older success, failure and denial after newer success", async t => {
  const h=await inboxHost(t);
  for (const status of [200,503,403]) {
    const old=sceneDeferred();let calls=0;const current=[task("new-"+status)];
    h.reply=()=>++calls===1?old.promise:Response.json({tasks:current});
    const pending=h.store.syncReviewInbox();
    assert.equal(await h.store.syncReviewInbox(),true);expectInbox(h,"ready",current);
    old.resolve(Response.json(status===200?{tasks:[task("old")]}:{error:"old-outcome"},{status}));
    assert.equal(await pending,false);expectInbox(h,"ready",current);
  }
});

test("Activity current denial withdraws already pending reads until a later positive read", async t => {
  const h=await inboxHost(t);
  for (const status of [401,403]) {
    const denied=sceneDeferred(),pending=sceneDeferred();let calls=0;
    h.reply=()=>++calls===1?denied.promise:pending.promise;
    const first=h.store.syncReviewInbox(),second=h.store.syncReviewInbox();
    denied.resolve(Response.json({error:"read_denied"},{status}));
    assert.equal(await first,false);expectInbox(h,"unavailable");
    pending.resolve(Response.json({tasks:[task("already-pending")]}));
    assert.equal(await second,false);expectInbox(h,"unavailable");
    h.reply=()=>Response.json({tasks:[]});
    assert.equal(await h.store.syncReviewInbox(),true);expectInbox(h,"ready");
  }
});

test("Activity review body from old authorization cannot repopulate a refreshed session", async t => {
  const h=await inboxHost(t),oldBody=sceneDeferred();let bodyStarted=false,calls=0;
  h.reply=()=>++calls===1?{ok:true,status:200,json(){bodyStarted=true;return oldBody.promise;}}:Response.json({tasks:[]});
  const pending=h.store.syncReviewInbox();
  await untilScene(()=>bodyStarted,"Old current headers reached deferred body");
  const previous=h.store.captureAuthorizationScope();
  const session={...h.store.session.get(),permissionEpoch:"activity-review-refresh-current"};
  h.sessionReply=()=>Response.json(session);
  await h.store.refreshSession();
  await untilScene(()=>h.store.reviewInboxState.get()==="ready","New session inbox finished");
  assert.equal(h.store.authorizationScopeActive(previous),false);
  assert.equal(h.store.session.get().permissionEpoch,"activity-review-refresh-current");
  oldBody.resolve({tasks:[task("old-authorization")]});
  assert.equal(await pending,false);expectInbox(h,"ready");
});

test("Activity source retirement and absent session clear inbox and fence pending reads", async t => {
  const h=await inboxHost(t),old=sceneDeferred();
  h.reply=()=>old.promise;
  const source=h.store.captureSourceOwnership(),pending=h.store.syncReviewInbox();
  h.eventsReply=()=>Response.json({error:"source_unavailable"},{status:403});
  await assert.rejects(h.store.refreshEvents(),/403/);
  assert.equal(h.store.sourceOwnershipActive(source),false);expectInbox(h,"idle");
  old.resolve(Response.json({tasks:[task("retired-source")]}));
  assert.equal(await pending,false);expectInbox(h,"idle");
  const count=h.requests.length;
  h.store.session.set(null);
  assert.equal(await h.store.syncReviewInbox(),false);expectInbox(h,"idle");
  assert.equal(h.requests.length,count,"Missing session makes no new request");
});
