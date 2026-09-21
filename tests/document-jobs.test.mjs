import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  DOCUMENT_JOB_STALE_AFTER_MS,
  documentGenerationRequestKey,
  documentGenerationRevision,
  documentJobActionLabel,
  documentJobFailure,
  documentJobFailureVisible,
  documentJobProgress,
  documentJobTerminal,
  generationFailureGuidance,
  documentJobIsStale,
  documentJobMaxAttempts,
  documentJobHasNoBudgetHold,
  planningStopBudget,
} from "../src/model/document-jobs.ts";
import { documentJobCompletionBindings } from "../worker/document-job-sql.ts";
import { failedGenerationInputInspection } from "../src/model/generation-inputs.ts";
import { readFile } from "node:fs/promises";

const job = (patch = {}) => ({
  jobId: "job-1",
  documentId: "doc-1",
  kind: "preview",
  status: "queued",
  sourceSurface: "studio",
  requestedSequence: 1,
  documentRevision: "rev-one",
  requestKey: "preview:rev-one",
  sourcePreviewId: null,
  promptTechnique: "prose",
  promptFanId: null,
  parentJobId: null,
  fanKind: null,
  members: [],
  result: null,
  error: null,
  errorDetail: null,
  moderationPromptRef: null,
  dismissedAt: null,
  attemptCount: 0,
  requestedAt: "2026-08-12T00:00:00.000Z",
  startedAt: null,
  completedAt: null,
  notifiedAt: null,
  leaseExpiresAt: null,
  updatedAt: "2026-08-12T00:00:00.000Z",
  stage: "queued",
  progressMessage: "",
  ...patch,
});

test("canonical budget evidence proves no hold only for three exact ledger pairs",()=>{
  const proven=new Set(["settled/settled","released/not-incurred","not-reserved/not-incurred"]);
  for(const reservationStatus of["not-reserved","released","retained","settled","unknown"]){
    for(const billingStatus of["not-incurred","pending","settled","unknown"]){
      const budget=planningStopBudget({planningStopBudget:{reservationStatus,billingStatus}});
      assert.deepEqual(budget,{reservationStatus,billingStatus});
      assert.equal(documentJobHasNoBudgetHold(budget),proven.has(reservationStatus+"/"+billingStatus),reservationStatus+"/"+billingStatus);
    }
  }
  for(const value of[undefined,null,{},[],"released",{reservationStatus:"released"},{reservationStatus:"released",billingStatus:"refunded"}]){
    assert.equal(documentJobHasNoBudgetHold(planningStopBudget({planningStopBudget:value})),false);
  }
});

test("bounds automatic retries for costly image work and avoids replaying chat turns", () => {
  assert.equal(documentJobMaxAttempts("preview"), 2);
  assert.equal(documentJobMaxAttempts("generate"), 2);
  assert.equal(documentJobMaxAttempts("extract_reference"), 2);
  assert.equal(documentJobMaxAttempts("prompt_fan"), 1);
  assert.equal(documentJobMaxAttempts("chat"), 1);
  assert.equal(documentJobMaxAttempts("structure_adaptive"), 1);
});

test("recognizes expired leases and missing heartbeats without treating queued work as stale", () => {
  const now = Date.parse("2026-08-12T00:02:00.000Z");
  assert.equal(documentJobIsStale(job({ status: "queued" }), now), false);
  assert.equal(documentJobIsStale(job({ status: "running", leaseExpiresAt: "2026-08-12T00:01:59.000Z", updatedAt: "2026-08-12T00:01:50.000Z" }), now), true);
  assert.equal(documentJobIsStale(job({ status: "running", leaseExpiresAt: "2026-08-12T00:03:00.000Z", updatedAt: new Date(now - DOCUMENT_JOB_STALE_AFTER_MS - 1).toISOString() }), now), true);
  assert.equal(documentJobIsStale(job({ status: "running", leaseExpiresAt: "2026-08-12T00:03:00.000Z", updatedAt: "2026-08-12T00:01:50.000Z" }), now), false);
});

test("reports queued and running stages truthfully", () => {
  assert.equal(documentJobActionLabel(job(), "preview"), "Draft queued…");
  assert.equal(documentJobActionLabel(job({ kind: "generate" }), "generate", true), "Full queued behind draft…");
  assert.equal(documentJobActionLabel(job({ status: "running", stage: "preparing" }), "preview"), "Draft preparing…");
  assert.equal(documentJobActionLabel(job({ status: "running", stage: "rendering" }), "preview"), "Draft rendering…");
  assert.equal(documentJobActionLabel(job({ kind: "generate", status: "running", stage: "rendering" }), "generate"), "Rendering full image…");
  assert.equal(documentJobActionLabel(job({ kind: "generate", status: "committing", stage: "rendering" }), "generate"), "Finalizing full image…");
  assert.equal(documentJobTerminal(job({ status: "canceled" })), true);
});

test("projects durable image and document-render checkpoints into honest progress", () => {
  const queued=documentJobProgress(job());
  assert.equal(queued.label,"Queue");
  assert.equal(queued.percent,4);
  assert.equal(queued.steps[0].state,"active");

  const reviewed=documentJobProgress(job({status:"running",stage:"safety-review",progressMessage:"Reviewing the exact image prompt."}));
  assert.equal(reviewed.label,"Review");
  assert.equal(reviewed.steps[1].state,"complete");
  assert.ok(reviewed.percent>queued.percent);

  const storyboard=documentJobProgress(job({kind:"render_document",status:"running",stage:"rendering-frames",result:{artifactKind:"storyboard"},progressMessage:"3 of 6 storyboard frames are safely stored."}));
  assert.equal(storyboard.label,"Render frames");
  assert.equal(storyboard.detail,"3 of 6 frames stored");
  assert.equal(storyboard.percent,63);

  const video=documentJobProgress(job({kind:"render_document",status:"running",stage:"rendering",result:{artifactKind:"video"},progressMessage:"Video rendering · 37%"}));
  assert.equal(video.label,"Render");
  assert.equal(video.detail,"37% reported by the provider");
  assert.equal(video.percent,67);

  const fan=documentJobProgress(job({kind:"prompt_fan",status:"running",stage:"running",result:{completedCount:2},members:[]}));
  assert.equal(fan.label,"Render ×4");
  assert.equal(fan.detail,"2 of 4 prompt approaches finished");

  const recovering=documentJobProgress(job({kind:"render_document",status:"queued",stage:"queue-recovery",result:{artifactKind:"slides"},progressMessage:"An earlier operation lost contact. The server is recovering it before this render starts."}));
  assert.equal(recovering.label,"Recovering queue");
  assert.equal(recovering.steps[0].state,"active");
  assert.match(recovering.detail,/recovering it before this render starts/i);
});

test("recovers an expired running job before advancing queued document renders",async()=>{
  const jobsApi=await readFile(new URL("../worker/document-jobs-api.ts",import.meta.url),"utf8");
  assert.match(jobsApi,/if \(!rowIsStale\(running\)\) return;/);
  assert.match(jobsApi,/const recovered = await runDocumentJob\(env, owner, running\.job_id\);/);
  assert.match(jobsApi,/if \(recoveryBlocker&&!requiresForegroundDocumentExecution\(recoveryBlocker\)\) context\?\.waitUntil\(driveDocumentQueue\(env, user\)\);/);
  assert.match(jobsApi,/if\(requiresForegroundDocumentExecution\(running\)\)\{await reconcileStaleForegroundJob\(env,owner,running\);continue;\}/);
  assert.match(jobsApi,/if\(requiresForegroundDocumentExecution\(next\)\)return;/);
  assert.match(jobsApi,/if \(context&&!requiresForegroundDocumentExecution\(existing\)\)/);
  assert.match(jobsApi,/stage: "queue-recovery"/);
  assert.match(jobsApi,/An earlier operation lost contact\. The server is recovering it before this render starts\./);
  assert.doesNotMatch(jobsApi,/if \(running\) return;/);
});

test("a manual presentation bypasses only a verified video in another project",async(context)=>{
  const [jobsApi,store]=await Promise.all([
    readFile(new URL("../worker/document-jobs-api.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/state/store.ts",import.meta.url),"utf8"),
  ]);
  const projectTemplate=jobsApi.match(/const documentJobProjectSql=\(alias:"target"\|"candidate"\|"active"\|"document_jobs"\)=>`([\s\S]*?)`;/u)?.[1];
  const claimTemplate=jobsApi.match(/const claimSql=`([\s\S]*?)`;/u)?.[1];
  assert.ok(projectTemplate,"project identity must come from immutable document-creation events");
  assert.ok(claimTemplate,"project isolation must also hold inside the atomic claim");
  assert.match(jobsApi,/const independentPresentation=isPresentationJob\(row\)&&queuedRequest\.productionMode==="manual";/u,
    "broader foreground media execution must not widen the manual-slideshow exception");
  assert.match(store,/projectDocuments\.has\(job\.documentId\)/u,
    "the browser must not select an older unrelated project's running job");
  const projectExpression=(alias)=>projectTemplate.replaceAll("${alias}",alias);
  const staleHeartbeatTemplate="${outputBinding?'':' OR updated_at<?'}";
  assert.ok(claimTemplate.includes(staleHeartbeatTemplate),"native claims must respect their longer lease without changing legacy heartbeat recovery");
  const claimSqlFor=(outputBinding)=>claimTemplate.replaceAll('${documentJobProjectSql("active")}',projectExpression("active"))
    .replaceAll('${documentJobProjectSql("document_jobs")}',projectExpression("document_jobs"))
    .replaceAll(staleHeartbeatTemplate,outputBinding?"":" OR updated_at<?");
  const legacyClaimSql=claimSqlFor(false),nativeClaimSql=claimSqlFor(true);
  for(const [sql,bindings]of[[legacyClaimSql,13],[nativeClaimSql,12]]){
    assert.doesNotMatch(sql,/\$\{/u,"every trusted SQL-template expression must be resolved before the SQLite proof");
    assert.equal((sql.match(/\?/gu)??[]).length,bindings,"legacy and native claim parameter layouts differ only by the heartbeat cutoff");
  }
  assert.match(legacyClaimSql,/ OR updated_at<\?/u);
  assert.doesNotMatch(nativeClaimSql,/ OR updated_at<\?/u);

  const sqlite=new DatabaseSync(":memory:");
  context.after(()=>sqlite.close());
  sqlite.exec("CREATE TABLE events(stream_id TEXT,sequence INTEGER,type TEXT,payload TEXT)");
  sqlite.exec("CREATE TABLE document_jobs(job_id TEXT PRIMARY KEY,owner_id TEXT,stream_id TEXT,document_id TEXT,kind TEXT,status TEXT,correlation_id TEXT,started_at TEXT,lease_expires_at TEXT,result_json TEXT,updated_at TEXT,attempt_count INTEGER,requested_at TEXT,request_json TEXT)");
  const stream="creative:owner",owner="owner",now="2026-08-26T12:00:00.000Z";
  const append=sqlite.prepare("INSERT INTO events VALUES(?,?,?,?)");
  for(const [sequence,type,payload] of [
    [1,"ProjectCreated",{project_id:"video-project"}],
    [2,"DocumentCreated",{project_id:"video-project",document_id:"video-document"}],
    [3,"ProjectCreated",{project_id:"presentation-project"}],
    [4,"DocumentCreated",{project_id:"presentation-project",document_id:"presentation-one"}],
    [5,"DocumentCreated",{project_id:"presentation-project",document_id:"presentation-two"}],
    [6,"ProjectCreated",{project_id:"legacy-project"}],
    [7,"DocumentCreated",{document_id:"legacy-document"}],
  ])append.run(stream,sequence,type,JSON.stringify(payload));

  const insert=sqlite.prepare("INSERT INTO document_jobs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  const add=(id,document,kind,status,artifact)=>insert.run(id,owner,stream,document,kind,status,
    `${id}:original`,null,"2099-01-01T00:00:00.000Z","{}",now,status==="running"?1:0,now,JSON.stringify({artifactKind:artifact}));
  add("unrelated-video","video-document","render_document","running","video");
  add("presentation-one","presentation-one","render_document","queued","slides");
  add("presentation-two","presentation-two","render_document","queued","slides");
  add("legacy-target","legacy-document","render_document","queued","slides");
  add("unknown-target","unknown-document","render_document","queued","slides");

  const lookup=(id)=>sqlite.prepare(`SELECT ${projectExpression("target")} AS project_id FROM document_jobs target WHERE target.job_id=?`).get(id).project_id;
  assert.equal(lookup("presentation-one"),"presentation-project");
  assert.equal(lookup("legacy-target"),"legacy-project","legacy creation inherits its historically active project");
  assert.equal(lookup("unknown-target"),"","missing provenance fails closed");
  const claim=(id,manual=true,outputBinding=false)=>{
    const sql=outputBinding?nativeClaimSql:legacyClaimSql;
    const bindings=[`${id}:attempt:1`,now,"2099-01-01T00:00:00.000Z","{}",now,id,owner,stream,now,
      ...(outputBinding?[]:[now]),`${id}:original`,"{}",Number(manual)];
    assert.equal(bindings.length,(sql.match(/\?/gu)??[]).length,"each executed claim must bind every SQL parameter exactly once");
    return Number(sqlite.prepare(sql).run(...bindings).changes);
  };

  sqlite.prepare("UPDATE document_jobs SET correlation_id='racing-attempt' WHERE job_id='presentation-one'").run();
  assert.equal(claim("presentation-one"),0,"a concurrent attempt must keep its provider correlation");
  sqlite.prepare("UPDATE document_jobs SET correlation_id='presentation-one:original',result_json='{\"checkpoint\":\"new\"}' WHERE job_id='presentation-one'").run();
  assert.equal(claim("presentation-one"),0,"a concurrent paid checkpoint must not be overwritten");
  sqlite.prepare("UPDATE document_jobs SET result_json='{}' WHERE job_id='presentation-one'").run();
  assert.equal(claim("presentation-one"),1,"a verified other-project video cannot starve a manual presentation");
  assert.equal(claim("presentation-two"),0,"presentations in the same project must remain serialized");
  sqlite.prepare("UPDATE document_jobs SET status='completed' WHERE job_id='presentation-one'").run();
  assert.equal(claim("presentation-two",false),0,"the exception applies only to manual presentations");
  assert.equal(claim("unknown-target"),0,"an unknown target project must not bypass any active job");

  add("same-project-video","presentation-one","render_document","running","video");
  assert.equal(claim("presentation-two"),0,"a same-project video remains an execution boundary");
  sqlite.prepare("UPDATE document_jobs SET status='completed' WHERE job_id='same-project-video'").run();
  add("unknown-project-video","unknown-video-document","render_document","running","video");
  assert.equal(claim("presentation-two"),0,"an unverifiable video project remains an execution boundary");
  sqlite.prepare("UPDATE document_jobs SET status='completed' WHERE job_id='unknown-project-video'").run();
  assert.equal(claim("presentation-two"),1);
  assert.deepEqual({...sqlite.prepare("SELECT status,attempt_count,correlation_id FROM document_jobs WHERE job_id='unrelated-video'").get()},
    {status:"running",attempt_count:1,correlation_id:"unrelated-video:original"},
    "the unrelated in-flight video, its attempt, and its provider correlation are never changed");
  sqlite.prepare("UPDATE document_jobs SET status='completed' WHERE status='running'").run();
  add("long-native-lease","presentation-one","render_document","running","slides");
  sqlite.prepare("UPDATE document_jobs SET updated_at='2000-01-01T00:00:00.000Z' WHERE job_id='long-native-lease'").run();
  assert.equal(claim("long-native-lease",true,true),0,"an old heartbeat cannot steal a native attempt while its bounded lease is current");
  assert.equal(claim("long-native-lease"),1,"legacy stale-heartbeat recovery is unchanged");
});

test("atomically hands both paid-render reservations to the recovered provider attempt", async (context) => {
  const jobsApi = await readFile(new URL("../worker/document-jobs-api.ts", import.meta.url), "utf8");
  const handoff = jobsApi.match(/const\s+claimStatements\s*=\s*outputBinding\s*\?\s*(\[[^;]+?)\s*:\s*(\[claimAttempt,\s*tokenReservationHandoff,\s*costReservationHandoff\]);/);
  assert.ok(handoff, "reservation handoff distinguishes Output grants from the legacy job path");
  assert.match(handoff[2], /^\s*\[\s*claimAttempt\s*,\s*tokenReservationHandoff\s*,\s*costReservationHandoff\s*\]\s*$/);
  const outputBatch = handoff[1].replace(/\s+/gu, "");
  assert.ok(outputBatch.startsWith('[...sceneClaimPrefix,claimAttempt,...outputAssertionStatements(env,{sql:"changes()=1"}),tokenReservationHandoff,...outputAssertionStatements(env,{sql:"changes()=1"}),costReservationHandoff,...outputAssertionStatements(env,{sql:"changes()=1"}),'), "Scene custody precedes the claim; every Output claim and reservation handoff is followed by an atomic rollback guard");
  const admissionGuards='...outputAdmissionAssertions.flatMap(assertion=>outputAssertionStatements(env,assertion))';
  const freshCallGuard='...(freshOutput?outputAssertionStatements(env,{sql:"NOT EXISTS(SELECT 1 FROM output_provider_calls WHERE scope_key=? AND slot_id=?)",bindings:[outputBinding.scope.key,outputBinding.slot.slotId]}):[])'.replace(/\s+/gu, "");
  assert.ok(outputBatch.endsWith(`${admissionGuards},${freshCallGuard},...(sceneClaim?.after??[])]`), "source and actor-private assertions precede the fresh-slot guard and Scene witness handoff in the same atomic batch");
  assert.match(jobsApi,/const claims=await env\.DB\.batch\(claimStatements\);/u);
  assert.match(jobsApi,/claims\.length!==claimStatements\.length/u,"the complete atomic acknowledgement is required");
  assert.match(jobsApi,/claimed = claims\[sceneClaimPrefix\.length\];/u,"the claim result accounts for the preceding Scene assertions");
  assert.match(jobsApi,/outputAdmissionAssertions=\[\.\.\.\(sponsorExecution\?\.assertions\?\?\[\]\),\.\.\.outputProof\.assertions,\.\.\.\(jobAuthority\?\[jobAuthority\]:\[\]\)\]/u,
    "the retained admission assertions contain both current source proof and exact actor-private project-job custody");
  assert.match(jobsApi,/const jobAuthority=documentJobProjectAuthority\(user,row\.document_id,jobId\)/u);
  assert.match(jobsApi,/const freshOutput=Boolean\(outputBinding&&row\.status==="queued"&&row\.attempt_count===0\)/u,
    "the zero-call optimization is confined to an untouched native slot and job");
  const freshCallSql=handoff[1].match(/freshOutput\?outputAssertionStatements\(env,\{sql:"([^"]+)"/u)?.[1];
  assert.ok(freshCallSql);
  assert.equal((freshCallSql.match(/\?/gu)??[]).length,2);
  assert.match(jobsApi, /if \(previousAttempt > 0 && !handoffPaidProviderReservations&&!settledModel3dRecovery\) await releaseInterruptedAttempt/);

  const tokenHandoff = jobsApi.match(/const TOKEN_RESERVATION_HANDOFF_SQL = "([^"]+)";/)?.[1];
  const costHandoff = jobsApi.match(/const COST_RESERVATION_HANDOFF_SQL = "([^"]+)";/)?.[1];
  assert.ok(tokenHandoff);
  assert.ok(costHandoff);

  const sqlite = new DatabaseSync(":memory:");
  context.after(()=>sqlite.close());
  sqlite.exec("CREATE TABLE document_jobs (job_id TEXT,owner_id TEXT,stream_id TEXT,correlation_id TEXT,attempt_count INTEGER,status TEXT)");
  sqlite.exec("CREATE TABLE budget_reservations (reservation_id TEXT,owner_id TEXT,stream_id TEXT,correlation_id TEXT,operation TEXT,period TEXT,status TEXT,updated_at TEXT)");
  sqlite.exec("CREATE TABLE cost_budget_reservations (reservation_id TEXT,owner_id TEXT,stream_id TEXT,correlation_id TEXT,operation TEXT,period TEXT,status TEXT,updated_at TEXT)");

  const previousCorrelation = "job-1:attempt:1";
  const nextCorrelation = "job-1:attempt:2";
  const now = "2026-08-22T12:00:00.000Z";
  const operation="document-render:video";
  const period="2026-08";
  sqlite.prepare("INSERT INTO document_jobs VALUES (?,?,?,?,?,?)").run("job-1","creator","creative:owner",nextCorrelation,2,"running");
  sqlite.prepare("INSERT INTO budget_reservations VALUES (?,?,?,?,?,?,?,?)").run("token-1","billing-owner","creative:owner",previousCorrelation,operation,period,"active","before");
  sqlite.prepare("INSERT INTO budget_reservations VALUES (?,?,?,?,?,?,?,?)").run("token-other","another-owner","creative:owner",previousCorrelation,operation,period,"active","before");
  sqlite.prepare("INSERT INTO cost_budget_reservations VALUES (?,?,?,?,?,?,?,?)").run("cost-1","billing-owner","creative:owner",previousCorrelation,operation,period,"executing","before");
  sqlite.prepare("INSERT INTO cost_budget_reservations VALUES (?,?,?,?,?,?,?,?)").run("cost-other","another-owner","creative:owner",previousCorrelation,operation,period,"executing","before");

  const tokenBindings=[nextCorrelation,now,"token-1","billing-owner","creative:owner",previousCorrelation,operation,"cost-1","job-1","creator",nextCorrelation,2];
  const costBindings=[nextCorrelation,now,"cost-1","billing-owner","creative:owner",previousCorrelation,operation,"token-1",nextCorrelation,"job-1","creator",nextCorrelation,2];
  assert.equal(Number(sqlite.prepare(tokenHandoff).run(...tokenBindings).changes), 1);
  assert.equal(Number(sqlite.prepare(costHandoff).run(...costBindings).changes), 1);
  assert.deepEqual({ ...sqlite.prepare("SELECT correlation_id,status FROM budget_reservations WHERE reservation_id='token-1'").get() }, { correlation_id: nextCorrelation, status: "active" });
  assert.deepEqual({ ...sqlite.prepare("SELECT correlation_id,status FROM cost_budget_reservations WHERE reservation_id='cost-1'").get() }, { correlation_id: nextCorrelation, status: "active" });
  assert.equal(sqlite.prepare("SELECT correlation_id FROM budget_reservations WHERE reservation_id='token-other'").get().correlation_id, previousCorrelation);
  assert.deepEqual({ ...sqlite.prepare("SELECT correlation_id,status FROM cost_budget_reservations WHERE reservation_id='cost-other'").get() }, { correlation_id: previousCorrelation, status: "executing" });
  assert.equal(Number(sqlite.prepare(tokenHandoff).run(...tokenBindings).changes), 0, "the previous attempt cannot hand off a token reservation twice");
  assert.equal(Number(sqlite.prepare(costHandoff).run(...costBindings).changes), 0, "a competing stale worker cannot reactivate the handed-off provider reservation");

  sqlite.prepare("INSERT INTO document_jobs VALUES (?,?,?,?,?,?)").run("job-missing","creator","creative:owner","job-missing:attempt:2",2,"running");
  sqlite.prepare("INSERT INTO budget_reservations VALUES (?,?,?,?,?,?,?,?)").run("token-missing","billing-owner","creative:owner","job-missing:attempt:1",operation,period,"active","before");
  const missingCostBindings=["job-missing:attempt:2",now,"token-missing","billing-owner","creative:owner","job-missing:attempt:1",operation,"missing-cost","job-missing","creator","job-missing:attempt:2",2];
  assert.equal(Number(sqlite.prepare(tokenHandoff).run(...missingCostBindings).changes),0,"a token reservation cannot move without its matching cost reservation");

  sqlite.exec("CREATE TABLE output_provider_calls(scope_key TEXT,slot_id TEXT); CREATE TABLE output_test_atomic_assertion(passed INTEGER NOT NULL CHECK(passed=1));");
  const fresh=sqlite.prepare(`SELECT CASE WHEN (${freshCallSql}) THEN 1 ELSE 0 END AS current`);
  assert.equal(fresh.get("scope-one","slot-one").current,1);
  sqlite.prepare("INSERT INTO output_provider_calls VALUES(?,?),(?,?)").run("other-scope","slot-one","scope-one","other-slot");
  assert.equal(fresh.get("scope-one","slot-one").current,1,"unrelated calls cannot block this exact slot");
  sqlite.prepare("INSERT INTO output_provider_calls VALUES(?,?)").run("scope-one","slot-one");
  assert.equal(fresh.get("scope-one","slot-one").current,0,"any existing call prevents treating this slot as never dispatched");
  sqlite.prepare("UPDATE budget_reservations SET correlation_id=? WHERE reservation_id='token-1'").run(previousCorrelation);
  sqlite.prepare("UPDATE cost_budget_reservations SET correlation_id=?,status='executing' WHERE reservation_id='cost-1'").run(previousCorrelation);
  assert.throws(()=>{
    sqlite.exec("BEGIN");
    try{
      assert.equal(Number(sqlite.prepare(tokenHandoff).run(...tokenBindings).changes),1);
      assert.equal(Number(sqlite.prepare(costHandoff).run(...costBindings).changes),1);
      sqlite.prepare(`INSERT INTO output_test_atomic_assertion VALUES(CASE WHEN (${freshCallSql}) THEN 1 ELSE 0 END)`).run("scope-one","slot-one");
      sqlite.exec("COMMIT");
    }catch(error){sqlite.exec("ROLLBACK");throw error;}
  },/CHECK constraint failed/u,"the final zero-call assertion must roll back both preceding reservation handoffs");
  assert.equal(sqlite.prepare("SELECT correlation_id FROM budget_reservations WHERE reservation_id='token-1'").get().correlation_id,previousCorrelation);
  assert.deepEqual({...sqlite.prepare("SELECT correlation_id,status FROM cost_budget_reservations WHERE reservation_id='cost-1'").get()},
    {correlation_id:previousCorrelation,status:"executing"},"the failed fresh-slot check cannot refund or reactivate an exposed cost reservation");
});

test("keeps pending artifact identity visible before its first worker checkpoint",async()=>{
  const jobsApi=await readFile(new URL("../worker/document-jobs-api.ts",import.meta.url),"utf8");
  assert.match(jobsApi,/visibleResult = row\.kind === "render_document"/);
  assert.match(jobsApi,/artifactKind: String\(parsed\.artifactKind \?\? request\.artifactKind\)/);
});

test("gives creators durable cancellation and administrators a force-fail escape hatch",async()=>{
  const [jobsApi,eventsApi,adapter,actions,store]=await Promise.all([
    readFile(new URL("../worker/document-jobs-api.ts",import.meta.url),"utf8"),
    readFile(new URL("../worker/events-api.ts",import.meta.url),"utf8"),
    readFile(new URL("../worker/openai-adapter.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/components/generation-actions.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/state/store.ts",import.meta.url),"utf8"),
  ]);
  assert.match(jobsApi,/path\.endsWith\("\/cancel"\)/);
  assert.match(jobsApi,/path\.endsWith\("\/force-fail"\)/);
  assert.match(jobsApi,/path\.endsWith\("\/retry"\)/);
  assert.match(jobsApi,/event\.correlationId === target\.correlation_id/);
  assert.match(jobsApi,/failedEvent\?\.payload\.provider_job_id/);
  assert.match(jobsApi,/SET status='queued',correlation_id=\?/);
  assert.match(jobsApi,/user\.role !== "admin"/);
  assert.match(jobsApi,/SET status='committing'/);
  assert.match(jobsApi,/status IN \('running','committing'\)/);
  assert.match(jobsApi,/releaseBudgetReservationsForCorrelation/);
  assert.match(eventsApi,/execution\?\.beginCommit\(\)/);
  assert.match(eventsApi,/signal:execution\?\.signal/);
  assert.match(adapter,/signal:options\.signal/);
  assert.match(actions,/Stop generation/);
  assert.match(actions,/Force fail/);
  assert.match(store,/stopDocumentJob\(jobId:string,force=false\)/);
  assert.match(store,/recoverDocumentRender\(jobId:string\)/);
});

test("identifies the exact document state independently of object key order", () => {
  const first = { documentId: "doc-1", snapshot: { facts: [{ block_id: "b1", properties: { weight: .5, text: "Quiet light" } }], pins: [] }, sourceBlockVersions: [{ block_id: "b1", version: 2 }] };
  const reordered = { sourceBlockVersions: [{ version: 2, block_id: "b1" }], snapshot: { pins: [], facts: [{ properties: { text: "Quiet light", weight: .5 }, block_id: "b1" }] }, documentId: "doc-1" };
  const changed = { ...first, sourceBlockVersions: [{ block_id: "b1", version: 3 }] };
  assert.equal(documentGenerationRevision(first), documentGenerationRevision(reordered));
  assert.notEqual(documentGenerationRevision(first), documentGenerationRevision(changed));
});

test("distinguishes updated draft work and full generations promoted from different drafts", () => {
  assert.equal(documentGenerationRequestKey("preview", "rev-one"), "preview:rev-one");
  assert.notEqual(documentGenerationRequestKey("preview", "rev-one"), documentGenerationRequestKey("preview", "rev-two"));
  assert.notEqual(documentGenerationRequestKey("generate", "rev-one", "draft-a"), documentGenerationRequestKey("generate", "rev-one", "draft-b"));
  assert.equal(documentGenerationRequestKey("generate", "rev-one"), "generate:rev-one:document");
  assert.notEqual(documentGenerationRequestKey("preview", "rev-one", null, "json"), documentGenerationRequestKey("preview", "rev-one", null, "xml"));
  assert.notEqual(documentGenerationRequestKey("preview", "rev-one", null, "prose", "fan-a"), documentGenerationRequestKey("preview", "rev-one", null, "prose", "fan-b"));
});

test("explains safety, application budgets, and project quotas without suggesting futile retries",()=>{
  const base={code:"failure",category:"quota",scope:"project",action:"raise_limit",message:"limit",retryable:false,retryAfterMs:null,requestId:null,httpStatus:429};
  assert.equal(generationFailureGuidance({...base,code:"moderation_blocked",category:"safety",scope:"request",action:"edit_request"}).retryAllowed,false);
  assert.match(generationFailureGuidance({...base,code:"budget_hard_cap_reached",scope:"user",action:"review_budget"}).title,/Your generation budget/);
  assert.match(generationFailureGuidance(base).title,/OpenAI project limit/);
  assert.equal(generationFailureGuidance({...base,category:"rate_limit",action:"wait_and_retry",retryable:true,retryAfterMs:2500}).retryAllowed,true);
  const legacyFal=documentJobFailure(job({status:"failed",error:"fal_422"}));
  assert.equal(legacyFal?.httpStatus,422);
  assert.match(generationFailureGuidance(legacyFal,"fal_422").summary,/duration, frame, reference images, and submitted prompt/i);
  assert.equal(generationFailureGuidance(legacyFal,"fal_422").retryAllowed,false);
  assert.match(generationFailureGuidance({...base,code:"fal_422",category:"safety",scope:"request",action:"edit_request",httpStatus:422}).title,/Safety checks/);
  assert.doesNotMatch(generationFailureGuidance(null,"provider_unavailable").summary,/provider_unavailable/);
});

test("keeps every terminal D1 placeholder paired with one binding",()=>{
  const values=documentJobCompletionBindings({status:"completed",result:{stage:"completed"},errorMessage:null,completedAt:"2026-08-14T12:00:00.000Z",parentId:null,jobId:"job-1",ownerId:"user-1",correlationId:"job-1:attempt:1"});
  assert.equal(values.length,10);
  assert.equal(values[3],"2026-08-14T12:00:00.000Z");
  assert.equal(values[4],null);
  assert.equal(values[7],"job-1");
});

test("keeps terminal failures visible until their durable notice is dismissed",()=>{
  assert.equal(documentJobFailureVisible(job({status:"failed",dismissedAt:null})),true);
  assert.equal(documentJobFailureVisible(job({status:"partial",dismissedAt:null})),true);
  assert.equal(documentJobFailureVisible(job({status:"failed",dismissedAt:"2026-08-14T12:00:00.000Z"})),false);
  assert.equal(documentJobFailureVisible(job({status:"completed",dismissedAt:null})),false);
});

test("keeps failed attempts inspectable from their retained prompt and frozen compile",()=>{
  const events=[
    {eventId:"compile-1",streamId:"s",sequence:10,occurredAt:"2026-08-12T00:00:01.000Z",recordedAt:"2026-08-12T00:00:01.000Z",actor:"worker:compiler",clientId:"test",correlationId:"c",causationId:null,compensatesEventId:null,schemaVersion:1,type:"ContextCompiled",payload:{document_id:"doc-1",generation_id:"generation-1",prompt_technique:"bullets",context_hash:"hash-1",compiled_snapshot:{facts:[{block_id:"subject-1",properties:{text:"A librarian"}}]},source_block_versions:[{block_id:"subject-1",version:2}],reference_inputs:[{label:"Opening frame",pixels_submitted:true}],used_uploaded_reference_pixels:true}},
    {eventId:"failure-1",streamId:"s",sequence:11,occurredAt:"2026-08-12T00:00:02.000Z",recordedAt:"2026-08-12T00:00:02.000Z",actor:"worker:generator",clientId:"test",correlationId:"c",causationId:"compile-1",compensatesEventId:null,schemaVersion:1,type:"GenerationFailed",payload:{document_id:"doc-1",generation_id:"generation-1",prompt_technique:"bullets",prompt_ref:"failed-prompt",error_code:"safety_rejected",error_category:"safety"}},
  ];
  const inspection=failedGenerationInputInspection(job({kind:"generate",status:"failed",promptTechnique:"bullets",moderationPromptRef:"failed-prompt",attemptCount:1,result:{appendedEventIds:["compile-1","failure-1"]},errorDetail:{code:"safety_rejected",category:"safety",scope:"request",action:"edit_request",message:"Rejected",retryable:false,retryAfterMs:null,requestId:"req_1",httpStatus:400}}),events,{"failed-prompt":"Exact failed provider prompt"});
  assert.equal(inspection.outcome,"failed");assert.equal(inspection.prompt,"Exact failed provider prompt");assert.equal(inspection.retained,true);assert.equal(inspection.receipt.frozen_inputs[0].context_hash,"hash-1");assert.equal(inspection.receipt.frozen_inputs[0].used_reference_pixels,true);assert.equal(inspection.receipt.failures[0].event_id,"failure-1");assert.equal(inspection.receipt.technical_error.requestId,"req_1");
});

test("exposes retained document failure history to document and Canvas surfaces",async()=>{
  const [jobsApi,eventsApi,actions,canvas,inputDialog]=await Promise.all([
    readFile(new URL("../worker/document-jobs-api.ts",import.meta.url),"utf8"),readFile(new URL("../worker/events-api.ts",import.meta.url),"utf8"),readFile(new URL("../src/components/generation-actions.ts",import.meta.url),"utf8"),readFile(new URL("../src/canvas/canvas-application.ts",import.meta.url),"utf8"),readFile(new URL("../src/components/generation-input-dialog.ts",import.meta.url),"utf8"),
  ]);
  assert.match(jobsApi,/kind IN \('preview','generate','prompt_fan','render_document','structure_adaptive'\)/);assert.match(jobsApi,/expires_at>\?/);assert.match(jobsApi,/response\.ok\?\{\}:parseResult\(row\)/);
  assert.match(eventsApi,/retainFailurePrompt/);assert.doesNotMatch(eventsApi,/detail\.category==="safety"\?providerFailurePrompt/);
  assert.match(actions,/Failed generation attempts/);assert.match(actions,/Inspect failed inputs/);assert.match(actions,/Review all \$\{allFailures\.length\} failed attempts/);assert.match(actions,/failedGenerationInputInspection/);
  assert.match(actions,/#actorInputContent:Record<string,string>/);
  assert.match(actions,/addEventListener\("forma-authorization-changed",this\.#clearPrivateFailureInputs\)/);
  assert.match(actions,/removeEventListener\("forma-authorization-changed",this\.#clearPrivateFailureInputs\)/);
  assert.match(actions,/loadActorDocumentGenerationReceipt\(job\.jobId\)/);
  assert.match(actions,/authorization\.shared\s*&&\s*job\.kind\s*!==\s*"render_document"/);
  assert.match(actions,/authorizationScopeActive\(authorization\)/);
  assert.match(actions,/projectContext\s*\|\|\s*job\.kind\s*===\s*"render_document"/);
  assert.match(actions,/failedGenerationInputInspection\(this\.#failureInputJob,this\.store\.events\.get\(\),this\.store\.session\.get\(\)\?\.projectContext\?this\.#actorInputContent:this\.store\.content\.get\(\)\)/);
  assert.doesNotMatch(actions,/this\.store\.content\.set\(/);
  assert.match(canvas,/Failed attempts/);assert.match(canvas,/#documentOutputFailures/);assert.match(canvas,/failedGenerationInputInspection/);assert.match(inputDialog,/retained inputs captured before the attempt failed/i);
});

test("keeps adaptive suggestion receipts associated with the private submitted intent",async()=>{
  const jobsApi=await readFile(new URL("../worker/document-jobs-api.ts",import.meta.url),"utf8");
  assert.match(jobsApi,/adaptiveReasoning/);
  assert.match(jobsApi,/intentRef: adaptivePayload\?\.intent_ref/);
  assert.match(jobsApi,/structure: body\.structure/);
});

test("settles generation capacity by reservation identity and repairs orphaned failures",async()=>{
  const [policy,eventsApi,jobsApi,runtime,actions]=await Promise.all([
    readFile(new URL("../worker/pilot-policy.ts",import.meta.url),"utf8"),
    readFile(new URL("../worker/events-api.ts",import.meta.url),"utf8"),
    readFile(new URL("../worker/document-jobs-api.ts",import.meta.url),"utf8"),
    readFile(new URL("../worker/runtime.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/components/generation-actions.ts",import.meta.url),"utf8"),
  ]);
  assert.match(runtime,/CREATE TABLE IF NOT EXISTS budget_reservations/);
  assert.match(policy,/WHERE reservation_id=\? AND owner_id=\? AND status='active'/);
  assert.match(policy,/orphaned_failed_reservation_reconciled/);
  assert.match(policy,/NOT EXISTS \(SELECT 1 FROM document_jobs job[\s\S]*status IN \('queued','running','committing'\)/);
  assert.match(jobsApi,/releaseBudgetReservationsForCorrelation\(env,user,row\.correlation_id/);
  assert.doesNotMatch(jobsApi,/releaseBudget\(env, user\.userId, reservedTokens\)/);
  assert.doesNotMatch(eventsApi,/releaseBudget\(env,ownerId,reserved\)/);
  assert.match(eventsApi,/const ordinaryBillingOwnerId=auth\.user\.billingUserId\?\?actorUserId/);
  assert.match(eventsApi,/settleBudget\(env,billingOwnerId,reservation\.reservationId/);
  assert.match(eventsApi,/const plannerCharge=\(failedBillableTokens>0\|\|failedActualCost>0\)\?makeEvent/);
  assert.match(actions,/aria-describedby=\$\{previewFanBudgetBlocked&&budgetNoteVisible\?this\.#budgetNoteId:nothing\}/);
  assert.match(actions,/const reservationMessage=this\.i18n\.t\("generation\.reservationUncertainty"/);
  assert.match(actions,/\$\{reservationMessage\}/);
  assert.doesNotMatch(actions,/Failed work releases its (?:unused )?reservation automatically/);
  assert.match(actions,/Dismiss generation capacity notification/);
  assert.match(actions,/sessionStorage\.setItem\(key,"dismissed"\)/);
  assert.match(actions,/budgetBand/);
  assert.match(actions,/<button class="button ghost compact" aria-label="Dismiss this generation issue"/);
  assert.doesNotMatch(actions,/category==="safety"\?html`<button class="button ghost compact" aria-label="Dismiss/);
});

// Native Image interrupted-worker coverage. Actual private worker functions and
// SQL run against isolated metadata; no production rows or provider calls.
async function imageInterruptedWorkerFunctions(){
  const {stripTypeScriptTypes}=await import('node:module');
  const jobs=await readFile(new URL('../worker/document-jobs-api.ts',import.meta.url),'utf8');
  const provider=await readFile(new URL('../src/model/provider-submission.ts',import.meta.url),'utf8');
  const policy=await readFile(new URL('../worker/output-fal-recovery-policy.ts',import.meta.url),'utf8');
  const outcome=await readFile(new URL('../worker/output-execution-control.ts',import.meta.url),'utf8');
  const between=(source,start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a);assert(a>=0&&b>a);return source.slice(a,b).replace(/^export /gm,'');};
  const paid=new Function(stripTypeScriptTypes(provider.replace(/^export /gm,''))+';return {providerSubmissions,hasUnresolvedProviderSubmission,hasUnsettledProviderSubmission};')();
  const readCheckpoint=new Function('object',stripTypeScriptTypes(between(policy,'export function readFalRecoveryCheckpoint','/** Original format'))+';return readFalRecoveryCheckpoint;')(v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{});
  const project=new Function(stripTypeScriptTypes(between(outcome,'export function prepareOutputJobOutcomeStatements','export async function synchronizeOutputJobOutcome'))+';return prepareOutputJobOutcomeStatements;')();
  const ports={...paid,readFalRecoveryCheckpoint:readCheckpoint,parseResult:r=>JSON.parse(r.result_json??'{}'),parseRequest:r=>JSON.parse(r.request_json??'{}'),
    requiresForegroundDocumentExecution:()=>true,isPresentationJob:()=>false,unresolvedModel3dSubmission:()=>false,trustedStoryboardSafeRecovery:()=>false,unsafePresentationRecovery:()=>null,
    parseDocumentArtifactContent:raw=>{const v=JSON.parse(raw);return Array.isArray(v.items)?v:null;},
    consentedAdaptiveJob:()=>false,DOCUMENT_JOB_STALE_AFTER_MS:60_000,unresolvedAudioSubmission:()=>false,unresolvedStoryboardSubmission:()=>false,unresolvedPresentationSubmission:()=>false,
    parentJobIdFromRequest:()=>null,failureProgressMessage:d=>d.message,prepareOutputJobOutcomeStatements:project,
    appendAuditEvent:async()=>{},refreshGenerationReceipt:async()=>{},reconcileParentForChild:async()=>{},releaseInterruptedAttempt:async()=>{},
    operationFinished:()=>null,readCorrelatedEvents:async()=>[]};
  const guard=new Function(...Object.keys(ports),stripTypeScriptTypes(between(jobs,'function unsafePaidRecovery(','function generationRevisionFromRequest('))+';return unsafePaidRecovery;')(...Object.values(ports));
  const stop=new Function(...Object.keys(ports),stripTypeScriptTypes(between(jobs,'async function failStaleJob(','function operationFinished('))+';return failStaleJob;')(...Object.values(ports));
  return {guard,stop};
}
function imageInterruptedRow(){
  return {job_id:'job',owner_id:'owner',stream_id:'creative:owner',document_id:'doc',kind:'generate',output_slot_id:'slot',correlation_id:'original',attempt_count:1,status:'running',request_json:'{}',
    result_json:JSON.stringify({providerSubmissionProtocol:1,outputFalCheckpoint:{version:'output-fal-checkpoint-v1',stage:'image:initial',provider:'fal',model:'ideogram/v4',clientRequestId:'media',requestDigest:'a'.repeat(64),requestRef:'request',requestSha256:'b'.repeat(64),planningRef:'direction',planningSha256:'c'.repeat(64),expiresAt:'2099-01-01T00:00:00.000Z'},
      providerSubmissions:{planning:{clientRequestId:'planning',provider:'openai',operation:'planning',model:'planner',status:'completed',providerRequestId:'planner-original',costMicrousd:5076},media:{clientRequestId:'media',provider:'fal',operation:'image',model:'ideogram/v4',status:'accepted',providerRequestId:'image-original'}}})};
}
test('native Image direction checkpoint remains terminal and nonretryable without claiming document-plan loss',async()=>{
  const {guard}=await imageInterruptedWorkerFunctions(),row=imageInterruptedRow(),before=row.result_json;
  const failure=guard(row);assert.equal(failure.code,'execution_interrupted');assert.equal(failure.retryable,false);assert.equal(failure.action,'contact_support');assert.equal(row.result_json,before);
});
test('Image classifier keeps unknown submissions and missing private checkpoints closed; document plans remain separately required',async()=>{
  const {guard}=await imageInterruptedWorkerFunctions();
  for(const mode of ['pending','missing','malformed','legacy','document']){
    const row=imageInterruptedRow(),data=JSON.parse(row.result_json);
    if(mode==='pending')data.providerSubmissions.media.status='pending';
    if(mode==='missing')delete data.outputFalCheckpoint;
    if(mode==='malformed')data.outputFalCheckpoint.planningSha256='';
    if(mode==='legacy')delete row.output_slot_id;
    if(mode==='document')row.kind='render_document';
    row.result_json=JSON.stringify(data);const failure=guard(row);
    assert.equal(failure.code,mode==='pending'?'provider_submission_uncertain':'provider_result_recovery_unavailable',mode);assert.equal(failure.retryable,false,mode);
  }
});
async function imageInterruptedDatabase(row,{sidecarFailure=false}={}){
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE document_jobs(job_id TEXT,owner_id TEXT,stream_id TEXT,document_id TEXT,kind TEXT,correlation_id TEXT,attempt_count INTEGER,status TEXT,request_json TEXT,result_json TEXT,error_message TEXT,completed_at TEXT,lease_expires_at TEXT,notified_at TEXT,updated_at TEXT);
    CREATE TABLE output_operation_slots(scope_key TEXT,slot_id TEXT,grant_id TEXT,job_id TEXT,status TEXT,outcome_event_id TEXT,updated_at TEXT);
    CREATE TABLE output_provider_calls(scope_key TEXT,slot_id TEXT,status TEXT,used_microusd INTEGER,maximum_microusd INTEGER);
    CREATE TABLE output_execution_grants(scope_key TEXT,grant_id TEXT,status TEXT);
    CREATE TABLE events(event_id TEXT,stream_id TEXT,correlation_id TEXT,type TEXT,sequence INTEGER);`);
  db.prepare('INSERT INTO document_jobs VALUES(?,?,?,?,?,?,?,?,?,?,NULL,NULL,?,NULL,?)').run(row.job_id,row.owner_id,row.stream_id,row.document_id,row.kind,row.correlation_id,row.attempt_count,row.status,row.request_json,row.result_json,'2000-01-01','2000-01-01');
  db.exec("INSERT INTO output_operation_slots VALUES('scope','slot','grant','job','running',NULL,'2000-01-01'); INSERT INTO output_execution_grants VALUES('scope','grant','active'); INSERT INTO output_provider_calls VALUES('scope','slot','settled',5076,100000),('scope','slot','uncertain',NULL,900000)");
  const env={DB:{prepare(sql){return{bind(...args){return{sql,args,async run(){return{meta:{changes:db.prepare(sql).run(...args).changes}};}};}};},async batch(statements){db.exec('BEGIN');try{const results=[];for(const [index,s] of statements.entries()){if(index===1&&sidecarFailure)throw Error('projection_failed');results.push(await s.run());}db.exec('COMMIT');return results;}catch(error){db.exec('ROLLBACK');throw error;}}}};
  return{db,env,close:()=>db.close()};
}
test('stale native job failure atomically projects uncertain operation without releasing original calls',async()=>{
  const {guard,stop}=await imageInterruptedWorkerFunctions(),row=imageInterruptedRow(),f=await imageInterruptedDatabase(row);
  try{const calls=f.db.prepare('SELECT * FROM output_provider_calls').all();await stop(f.env,{userId:'owner',streamId:'creative:owner'},row,guard(row));
    const saved=f.db.prepare('SELECT * FROM document_jobs').get();assert.equal(saved.status,'failed');assert.equal(saved.correlation_id,'original');assert.equal(saved.attempt_count,1);
    assert.deepEqual(JSON.parse(saved.result_json).outputFalCheckpoint,JSON.parse(row.result_json).outputFalCheckpoint);
    assert.equal(f.db.prepare('SELECT status FROM output_operation_slots').get().status,'uncertain');assert.equal(f.db.prepare('SELECT status FROM output_execution_grants').get().status,'active');assert.deepEqual(f.db.prepare('SELECT * FROM output_provider_calls').all(),calls);
  }finally{f.close();}
});
test('failed operation projection rolls back stale job transition',async()=>{
  const {guard,stop}=await imageInterruptedWorkerFunctions(),row=imageInterruptedRow(),f=await imageInterruptedDatabase(row,{sidecarFailure:true});
  try{await assert.rejects(stop(f.env,{userId:'owner',streamId:'creative:owner'},row,guard(row)),/projection_failed/);assert.equal(f.db.prepare('SELECT status FROM document_jobs').get().status,'running');assert.equal(f.db.prepare('SELECT status FROM output_operation_slots').get().status,'running');assert.equal(f.db.prepare('SELECT result_json FROM document_jobs').get().result_json,row.result_json);}finally{f.close();}
});
test('newer checkpoint prevents stale failure from overwriting the current worker',async()=>{
  const {guard,stop}=await imageInterruptedWorkerFunctions(),row=imageInterruptedRow(),f=await imageInterruptedDatabase(row);
  try{const newer=JSON.stringify({...JSON.parse(row.result_json),newer:true});f.db.prepare('UPDATE document_jobs SET result_json=?,lease_expires_at=?,updated_at=?').run(newer,'2099-01-01','2099-01-01');await stop(f.env,{userId:'owner',streamId:'creative:owner'},row,guard(row));assert.equal(f.db.prepare('SELECT status FROM document_jobs').get().status,'running');assert.equal(f.db.prepare('SELECT result_json FROM document_jobs').get().result_json,newer);assert.equal(f.db.prepare('SELECT status FROM output_execution_grants').get().status,'active');}finally{f.close();}
});
test('stale native failure cannot project an old correlation over current job or grant',async()=>{
  const {guard,stop}=await imageInterruptedWorkerFunctions();
  for(const liveStatus of ['running','failed']){
    const row=imageInterruptedRow(),f=await imageInterruptedDatabase(row);
    try{
      f.db.prepare('UPDATE document_jobs SET correlation_id=?,status=?').run('newer',liveStatus);
      f.db.exec("UPDATE output_operation_slots SET outcome_event_id='newer-evidence',status='failed'; UPDATE output_provider_calls SET status='settled'; INSERT INTO events VALUES('old-failure','creative:owner','original','GenerationFailed',10)");
      const before=f.db.prepare('SELECT * FROM output_operation_slots').get();
      await stop(f.env,{userId:'owner',streamId:'creative:owner'},row,guard(row));
      assert.deepEqual(f.db.prepare('SELECT * FROM output_operation_slots').get(),before);
      assert.equal(f.db.prepare('SELECT status FROM output_execution_grants').get().status,'active');
      assert.equal(f.db.prepare('SELECT correlation_id FROM document_jobs').get().correlation_id,'newer');
    }finally{f.close();}
  }
});
test('lost checkpoint CAS leaves same-correlation projection and grant untouched',async()=>{
  const {guard,stop}=await imageInterruptedWorkerFunctions(),row=imageInterruptedRow(),f=await imageInterruptedDatabase(row);
  try{
    f.db.exec("UPDATE document_jobs SET status='failed',result_json='{}',completed_at='2001-01-01'; UPDATE output_operation_slots SET status='failed'; UPDATE output_provider_calls SET status='settled'");
    const before=f.db.prepare('SELECT * FROM output_operation_slots').get();
    await stop(f.env,{userId:'owner',streamId:'creative:owner'},row,guard(row));
    assert.deepEqual(f.db.prepare('SELECT * FROM output_operation_slots').get(),before);
    assert.equal(f.db.prepare('SELECT status FROM output_execution_grants').get().status,'active');
  }finally{f.close();}
});
test('settled stale native jobs project failure and complete the existing grant without changing usage',async()=>{
  const {stop}=await imageInterruptedWorkerFunctions();
  for(const kind of ['generate','render_document']){
    const row=imageInterruptedRow();row.kind=kind;const f=await imageInterruptedDatabase(row);
    try{
      f.db.exec("UPDATE output_provider_calls SET status='settled',used_microusd=maximum_microusd; INSERT INTO events VALUES('original-failure','creative:owner','original','GenerationFailed',10)");
      const calls=f.db.prepare('SELECT * FROM output_provider_calls').all();
      await stop(f.env,{userId:'owner',streamId:'creative:owner'},row);
      assert.equal(f.db.prepare('SELECT status FROM document_jobs').get().status,'failed');
      const slot=f.db.prepare('SELECT * FROM output_operation_slots').get();assert.equal(slot.status,'failed');assert.equal(slot.outcome_event_id,'original-failure');
      assert.equal(f.db.prepare('SELECT status FROM output_execution_grants').get().status,'completed');
      assert.deepEqual(f.db.prepare('SELECT * FROM output_provider_calls').all(),calls);
    }finally{f.close();}
  }
});
