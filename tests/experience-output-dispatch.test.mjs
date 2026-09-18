import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { withExperienceOutputDispatch } from "../worker/experience-output-dispatch.ts";
import { ProviderRequestError } from "../worker/provider-errors.ts";
import { outputDatabaseMessageKind } from "../worker/output-database-diagnostic.ts";

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
  const logged=[];
  const invoke = new Function("cause", "console", helpers + "\nconst diagnosticStage='prepare_preflight_execute';\n" + caught[1]);
  const refuse=cause=>invoke(cause,{warn:(...args)=>logged.push(args)});
  for (const cause of [undefined, null, "private provider detail", 42, Symbol("private"), {}, new Error("private provider detail")]) {
    const response = refuse(cause);
    assert.equal(response.status, 409);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await response.json(), { version: 1, status: "unavailable", error: "experience_output_unavailable",
      originalIntent: "unknown_or_retained", permitted: { prepare: false, authorize: false, run: false, resumeRun: false, recoverResult: false } });
  }
  const known = refuse(Object.assign(new Error("private message"), { code: "experience_output_source_changed", status: 403 }));
  assert.equal(known.status, 403); assert.equal((await known.json()).error, "experience_output_source_changed");
  const privateCode=refuse({code:"Private provider source text",status:409});
  assert.equal((await privateCode.json()).error,"experience_output_unavailable");
  for (const code of ["private_customer_named_example","request_01a09b9506477779b6fa6b670ecafcc8"]) {
    assert.equal((await refuse({code,status:409}).json()).error,"experience_output_unavailable");
  }
  for(const [label,entry] of logged){assert.equal(label,"experience_output_refused");assert.deepEqual(Object.keys(entry),["code","status","stage","kind"]);assert.equal(entry.stage,"prepare_preflight_execute");assert.match(entry.code,/^[a-z][a-z0-9_]+$/u);assert.ok(entry.code.length<=160);}
  assert.ok(!JSON.stringify(logged).includes("private"));assert.ok(!JSON.stringify(logged).includes("Private"));
  for (const [cause,kind] of [[new TypeError("private body"),"TypeError"],[new Error("D1_ERROR: no such column: private_identifier"),"db_schema"],[new Error("UNIQUE constraint failed: secret_table"),"db_constraint"],[new Error("SQLITE_BUSY private values"),"db_busy"]]) {
    await refuse(cause);const entry=logged.at(-1)[1];assert.equal(entry.kind,kind);assert.equal(entry.code,"experience_output_unavailable");
    assert.ok(!JSON.stringify(entry).includes("private"));assert.ok(!JSON.stringify(entry).includes("secret"));
  }
  for(const code of ["experience_output_original_envelope_unavailable","output_scene_source_changed","scene_cost_authority_changed"])assert.equal((await refuse({code,status:409}).json()).error,code);
});

test("unknown failures gain only fixed bounded diagnostic kinds without changing response or log keys",async()=>{
  const source=stripTypeScriptTypes(readFileSync(new URL("../worker/experience-output-api.ts",import.meta.url),"utf8"));
  const helpers=source.slice(source.indexOf("const record ="),source.indexOf("async function refused("));
  const caught=source.match(/\} catch \(cause\) \{([\s\S]*)\n {2}\}\n\}\s*$/u);assert.ok(caught);
  const logged=[];
  const invoke=new Function("outputDatabaseMessageKind","cause","console",helpers+"\nconst diagnosticStage='prepare_preflight_execute';\n"+caught[1]).bind(null,outputDatabaseMessageKind);
  const readSubtype=new Function("outputDatabaseMessageKind","cause",helpers+"\nreturn diagnosticSubtype(cause);").bind(null,outputDatabaseMessageKind);
  const cases=[
    ...['unavailable','interrupted','identity','lifetime','object_metadata','content_type','stream_chunk','stream_length','inspection','digest','duration_basis','duration','codec','audio_present','rotation','dimensions','aspect_ratio'].map(reason=>[new Error('output_video_media_'+reason),'output_video_media_'+reason]),
    [new Error("output_video_recovery_unavailable"),"output_video_recovery_unavailable"],
    [new Error("output_video_provider_receipt_mismatch"),"output_video_provider_receipt_mismatch"],
    [new Error("output_video_result_unavailable"),"output_video_result_unavailable"],
    [new Error("output_video_request_timeout"),"output_video_request_timeout"],
    [new Error("wrapper",{cause:new Error("output_video_hook_timeout")}),"output_video_hook_timeout"],
    [new Error("D1_ERROR: FOREIGN KEY constraint failed: private_table"),"d1_constraint"],
    [new Error("Wrong number of parameter bindings: private_binding"),"d1_binding_count"],
    [new Error("D1_TYPE_ERROR: private value"),"d1_binding_type"],
    [new Error("D1_ERROR: Expression tree is too large (maximum depth 100): private SQL"),"d1_expression_depth"],
    [new Error("D1_ERROR: parser stack overflow private SQL"),"d1_parser_depth"],
    [new Error("D1_ERROR: malformed JSON private body"),"d1_malformed_json"],
    [new Error("D1_ERROR: ambiguous column name: private identifier"),"d1_ambiguous_column"],
    [new Error("D1_ERROR: not authorized private details"),"d1_sql_authorization"],
    [new Error("D1_ERROR: SQL statement too long private body"),"d1_statement_length"],
    [new Error("D1_ERROR: too many terms in compound SELECT private SQL"),"d1_compound_limit"],
    [new Error("D1_ERROR: too many SQL variables: private SQL"),"db_schema"],
    [new Error("D1_ERROR: string or blob too big: private body"),"d1_value_limit"],
    [new Error("SQLITE_LOCKED: private table"),"d1_busy"],
    [new Error("no such column: private_identifier"),"db_schema"],
    [new Error("Too many API requests by single worker invocation. private suffix"),"worker_subrequest_limit"],
    [new Error("Too many subrequests. private suffix"),"worker_subrequest_limit"],
    [new Error("D1_ERROR: too many queries: private details"),"d1_query_limit"],
    [new Error("D1_ERROR",{cause:new Error("SQLITE_TOOBIG: private details")}),"d1_value_limit"],
    [new Error("D1_ERROR: unrecognized private database detail"),"d1_error"],
    ...["bridge_target_mismatch","bridge_preflight_incomplete","bridge_provider_call_routes_required","bridge_provider_call_routes_invalid"]
      .map(code=>[Object.assign(new Error("private source"),{code,status:500}),code]),
    ...[
      "output_audio_recovery_unavailable", "output_audio_recovery_deadline", "output_audio_recovery_aborted",
      "output_audio_completion_unavailable", "output_audio_cost_unavailable",
      "output_audio_recovery_duplicate_completion", "output_audio_recovery_input_invalid", "output_audio_recovery_media_changed",
      "output_audio_recovery_result_invalid", "output_audio_recovery_settlement_unavailable", "output_audio_recovery_usage_conflict",
      "output_native_storage_recovery_conflict",
      "output_native_operation_required", "output_execution_contract_changed", "output_execution_grant_inactive",
      "output_fal_recovery_job_unavailable", "output_fal_recovery_scope_unsupported", "output_fal_recovery_route_unsupported",
      "output_fal_recovery_contract_unavailable", "output_fal_recovery_checkpoint_unavailable", "output_fal_recovery_completion_unavailable",
      "output_fal_recovery_content_unavailable", "output_fal_recovery_plan_unavailable", "output_fal_recovery_call_unavailable",
      "output_fal_recovery_origin_unavailable", "output_fal_recovery_provenance_unavailable", "output_fal_recovery_canceled",
      "output_fal_recovery_settlement_unavailable", "output_fal_recovery_unavailable", "output_fal_recovery_receipt_mismatch",
      "output_fal_recovery_result_unavailable", "output_fal_result_outside_contract", "output_fal_result_too_large", "output_fal_result_empty",
      "output_fal_recovery_ack_unavailable",
      "output_fal_checkpoint_invalid", "output_job_binding_missing", "output_job_scope_mismatch", "output_execution_authority_revoked", "output_execution_scope_mismatch",
      "output_execution_grant_not_found", "output_execution_context_changed",
    ].flatMap(code=>[[new Error(code),code],[Object.assign(new Error("private original metadata"),{code,status:409}),code],
      [new Error("private wrapper",{cause:new Error(code)}),code]]),
  ];
  for(const [cause,subtype] of cases){
    const response=invoke(cause,{warn:(...args)=>logged.push(args)}),body=await response.json();
    assert.equal(response.status,cause.status??409);assert.equal(body.error,"experience_output_unavailable");
    assert.equal(body.status,"unavailable");assert.equal(body.permitted.authorize,false);assert.equal(body.permitted.run,false);
    assert.equal(Object.hasOwn(body,"subtype"),false);assert.equal(Object.hasOwn(body,"diagnostic"),false);
    const [label,entry]=logged.at(-1);assert.equal(label,"experience_output_refused");assert.equal(entry.kind,subtype);
    assert.deepEqual(Object.keys(entry),["code","status","stage","kind"]);
    assert.equal(entry.stage,"prepare_preflight_execute");assert.ok(!JSON.stringify(entry).includes("private"));
  }
  for(const cause of [undefined,null,{},"D1_ERROR: private",{code:"private_customer_named_example"},new Error("private source"),new Error("too many ordinary creative ideas")])assert.equal(readSubtype(cause),undefined);
  let getters=0;const accessor=new Error("private source");
  Object.defineProperty(accessor,"cause",{get(){getters++;throw Error("private getter");}});
  assert.equal(readSubtype(accessor),undefined);assert.equal(getters,0);
  const cycle=new Error("private source");cycle.cause=cycle;assert.equal(readSubtype(cycle),undefined);
  const deep=new Error("D1_ERROR",{cause:new Error("private wrapper",{cause:new Error("private wrapper",{cause:new Error("SQLITE_TOOBIG")})})});
  assert.equal(readSubtype(deep),"d1_error","No inspection past three error nodes");
  assert.equal(readSubtype(new Error("x".repeat(2048)+"SQLITE_TOOBIG")),undefined,"No inspection past the bounded prefix");
  assert.equal(readSubtype(new Error("output_fal_recovery_private_customer_named_example")),undefined,"No arbitrary recovery-prefix logging");
  assert.equal(readSubtype(new Error("output_fal_recovery_plan_unavailable: private source")),undefined,"No suffix parsing of private recovery messages");
  const revoked=Proxy.revocable({},{});revoked.revoke();
  for(const cause of [new Proxy({}, {getOwnPropertyDescriptor(){throw Error("private descriptor trap");}}),revoked.proxy]){
    const response=invoke(new Error("opaque",{cause}),{warn:(...args)=>logged.push(args)});
    assert.equal(response.status,409);assert.equal((await response.json()).error,"experience_output_unavailable");
    assert.equal(logged.at(-1)[1].kind,"unknown");assert.ok(!JSON.stringify(logged.at(-1)).includes("private"));
  }
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
test("provider recovery diagnostics expose only fixed status or category labels, never private detail",async()=>{
  const source=stripTypeScriptTypes(readFileSync(new URL('../worker/experience-output-api.ts',import.meta.url),'utf8'));
  const helpers=source.slice(source.indexOf('const record ='),source.indexOf('async function refused('));
  const caught=source.match(/\} catch \(cause\) \{([\s\S]*)\n {2}\}\n\}\s*$/u);assert.ok(caught);
  const invoke=new Function('outputDatabaseMessageKind','cause','console',helpers+"\nconst diagnosticStage='recover_result_provider_status';\n"+caught[1]).bind(null,outputDatabaseMessageKind);
  const subtype=new Function('outputDatabaseMessageKind','cause',helpers+';return diagnosticSubtype(cause);').bind(null,outputDatabaseMessageKind);
  for(const code of ['model3d_original_length_mismatch','output_model3d_recovery_qualification_size_limit','model3d_primary_format_mismatch'])assert.equal(subtype(new Error(code)),code);
  assert.equal(subtype(new Error('model3d_arbitrary_private_payload')),undefined);
  const detail={code:'private_arbitrary_code',category:'unknown',scope:'request',action:'none',message:'private provider body',retryable:false,retryAfterMs:null,requestId:'private-request-id',httpStatus:null};
  for(const code of ['model3d_primary_format_mismatch','model3d_artifact_invalid','model3d_texture_invalid'])assert.equal(subtype(new ProviderRequestError({...detail,code,httpStatus:502},'private prompt')),code);
  for(const [change,kind] of [[{httpStatus:404},'provider_http_404'],[{httpStatus:422},'provider_http_422'],[{category:'network'},'provider_network'],[{category:'safety'},'provider_safety'],[{code:'fal_provider_returned_untrusted_image_url'},'fal_provider_returned_untrusted_image_url']]){
    const cause=new ProviderRequestError({...detail,...change},'private prepared prompt'),logs=[];
    const response=invoke(cause,{warn:(...args)=>logs.push(args)});
    assert.equal(response.status,409);assert.equal((await response.json()).error,'experience_output_unavailable');
    assert.equal(logs[0][1].kind,kind);assert.deepEqual(Object.keys(logs[0][1]),['code','status','stage','kind']);
    assert.ok(!JSON.stringify(logs).includes('private'));assert.equal(subtype(new Error('wrapper',{cause})),kind);
  }
  let getters=0;const hostile=new ProviderRequestError({...detail,category:'private_category',httpStatus:418});
  for(const key of ['code','category','httpStatus'])Object.defineProperty(hostile.detail,key,{get(){getters++;throw Error('private getter');}});
  assert.equal(subtype(hostile),undefined);assert.equal(getters,0);
  const unknown=new ProviderRequestError({...detail,category:'private_category',httpStatus:418});
  assert.equal(subtype(unknown),undefined);
});
