import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { withExperienceOutputDispatch } from "../worker/experience-output-dispatch.ts";

// Dispatcher inputs only. No admitted/completed DB chain or provider fixture.
function input() {
  return {
    request: new Request(`https://forma.test/api/experiences/drafts/experience-draft-${"a".repeat(64)}/output/run`, { method: "POST" }),
    env: {}, executionContext: { waitUntil() { assert.fail("background dispatch"); } },
    principal: { userId: "owner", streamId: "creative:owner" },
    scope: { kind: "personal", key: "personal:owner:document", ownerUserId: "owner", actorUserId: "owner", projectId: "project", documentId: "document", organizationId: null, projectAccessId: null, contextId: null },
    slots: [{ scopeKey: "personal:owner:document", jobId: "original-job", status: "queued", attemptOrdinal: 0, previousSlotId: null }],
  };
}

test("wraps only dispatch and awaits the exact existing native job", async () => {
  const f = input(), calls = [];
  let finish, settled = false;
  const pending = new Promise(resolve => { finish = resolve; });
  const base = { preflight() {}, prepareAdmission() {}, resolveResult() {}, dispatch() { assert.fail("general queue driver"); } };
  const bridge = withExperienceOutputDispatch(base, async (...args) => { calls.push(args); await pending; });
  for (const key of ["preflight", "prepareAdmission", "resolveResult"]) assert.equal(bridge[key], base[key]);
  assert.equal(calls.length, 0);
  const work = bridge.dispatch(f).then(() => { settled = true; });
  await Promise.resolve();
  assert.deepEqual(calls, [[f.env, f.principal, "original-job"]]);
  assert.equal(settled, false);
  finish(); await work; assert.equal(settled, true);
});

test("rejects changed ownership and nonpersonal principals before dispatch", async () => {
  const changes = [
    f => { f.scope.actorUserId = "other"; }, f => { f.scope.ownerUserId = "other"; },
    f => { f.principal.userId = "other"; }, f => { f.principal.streamId = "creative:other"; },
    f => { f.principal.projectExecution = {}; }, f => { f.principal.fictional = true; },
    f => { f.scope.kind = "project"; }, f => { f.scope.organizationId = "org"; },
    f => { f.scope.projectAccessId = "access"; }, f => { f.scope.contextId = "context"; },
    f => { f.slots[0].scopeKey = "another-document"; },
  ];
  const bridge = withExperienceOutputDispatch({}, async () => assert.fail("wrong owner dispatched"));
  for (const change of changes) { const f = input(); change(f); await assert.rejects(bridge.dispatch(f), /experience_output_dispatch_unavailable/); }
});

test("GET, preparation, authorization and unrelated routes cannot wake jobs", async () => {
  const bridge = withExperienceOutputDispatch({}, async () => assert.fail("unsolicited dispatch"));
  for (const [method, path] of [["GET", "run"], ["POST", "prepare"], ["POST", "authorize"], ["POST", "run?retry=1"], ["POST", "run/"], ["POST", "../other/run"]]) {
    const f = input(); f.request = new Request(f.request.url.replace(/run$/, path), { method });
    await assert.rejects(bridge.dispatch(f), /experience_output_dispatch_unavailable/);
  }
});

test("refuses unqueued, cancelled, replacement, multiple or invalid jobs", async () => {
  const bridge = withExperienceOutputDispatch({}, async () => assert.fail("unselected job"));
  for (const status of ["authorized", "succeeded", "failed", "cancelled", "uncertain", "unavailable"]) {
    const f = input(); f.slots[0].status = status; await assert.rejects(bridge.dispatch(f));
  }
  for (const change of [f => { f.slots = []; }, f => { f.slots.push({ ...f.slots[0] }); },
    f => { f.slots[0].attemptOrdinal = 1; }, f => { f.slots[0].previousSlotId = "prior"; },
    f => { f.slots[0].jobId = "../other"; }]) {
    const f = input(); change(f); await assert.rejects(bridge.dispatch(f));
  }
});

test("duplicate explicit wakeups retain one job identity; native leases arbitrate attempts", async () => {
  const jobs = [], bridge = withExperienceOutputDispatch({}, async (_env, _user, jobId) => { jobs.push(jobId); });
  const f = input(); await bridge.dispatch(f); f.slots[0].status = "running"; await bridge.dispatch(f);
  assert.deepEqual(jobs, ["original-job", "original-job"]);
  // This tests routing only, not native lease idempotency or provider execution.
});

test("uncertain or refused native execution propagates without automatic redispatch", async () => {
  for (const reason of [new Error("native_source_changed"), new Error("cancelled"), undefined]) {
    let calls = 0;
    const bridge = withExperienceOutputDispatch({}, async () => { calls++; throw reason; });
    const result = await bridge.dispatch(input()).then(() => ({ fulfilled: true }), error => ({ error }));
    assert.deepEqual(result, { error: reason });
    await Promise.resolve(); assert.equal(calls, 1);
  }
});

test("only the experience endpoint installs the adapter in the Worker", () => {
  const source = readFileSync(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(source, /import \{ handleDocumentJobs, runDocumentJob \} from "\.\/document-jobs-api"/);
  assert.match(source, /handleExperienceOutput\(request,env,context,withExperienceOutputDispatch\(outputDocumentExecutionBridge,runDocumentJob\)\)/);
  assert.match(source, /handleOutputRequirements\(request,env,url\.pathname,context,outputDocumentExecutionBridge\)/);
});

test("API catch maps nullish and unknown dispatch failures to a private unavailable response", async () => {
  // Execute the actual API catch and response helpers only, without importing
  // the native financial graph or fabricating a completed command/job chain.
  const source = stripTypeScriptTypes(readFileSync(new URL("../worker/experience-output-api.ts", import.meta.url), "utf8"));
  const helpers = source.slice(source.indexOf("const record ="), source.indexOf("async function refused("));
  const caught = source.match(/\} catch \(cause\) \{([\s\S]*)\n {2}\}\n\}\s*$/u);
  assert.ok(caught); assert.ok(helpers.startsWith("const record ="));
  const refuse = new Function("cause", helpers + "\n" + caught[1]);
  for (const cause of [undefined, null, "private provider detail", 42, Symbol("private"), {}, new Error("private provider detail")]) {
    const response = refuse(cause);
    assert.equal(response.status, 409);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await response.json(), { version: 1, status: "unavailable", error: "experience_output_unavailable",
      originalIntent: "unknown_or_retained", permitted: { prepare: false, authorize: false, run: false, resumeRun: false, recoverResult: false } });
  }
  const known = refuse(Object.assign(new Error("private message"), { code: "experience_output_source_changed", status: 403 }));
  assert.equal(known.status, 403); assert.equal((await known.json()).error, "experience_output_source_changed");
});

test("non-Fal preflights never enter the recovery metadata query",async()=>{
  const source=readFileSync(new URL("../worker/experience-output-api.ts",import.meta.url),"utf8");
  const start=source.indexOf("result.permitted.recoverResult = Boolean("),end=source.indexOf(";",start);assert.ok(start>=0&&end>start);
  const evaluate=new Function("run","binding","job","snapshot","evidence","preflight","trusted","grantId",
    `return (async()=>{const result={permitted:{}};${source.slice(start,end+1)}return result.permitted.recoverResult;})()`);
  let reads=0;const trusted={env:{DB:{prepare(){reads++;throw new Error("recovery_query_forbidden");}}}};
  const target={provider:"fal",model:"ideogram/v4",route:"document-image-fal-manual-v1"};
  for(const altered of [{...target,provider:"openai"},{...target,model:"other"},{...target,route:"other"}]){
    assert.equal(await evaluate({}, {output:"image"},{status:"failed"},{permissions:{canRequest:true}},{row:{status:"active"}},{targets:[altered]},trusted,"original-grant"),false);
  }
  assert.equal(reads,0);
});
