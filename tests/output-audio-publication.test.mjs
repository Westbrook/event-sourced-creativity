import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { registerOutputSourceImports, outputTestDatabase } from "./output-execution-test-helpers.mjs";

registerOutputSourceImports();
const { guardOutputPrivateWrites, reconcileOutputNativeStorage } = await import("../worker/output-private-execution.ts");
const { createAudioOutputContract } = await import("../src/model/output-audio-contract.ts");
const originalFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error("Audio publication tests must not contact a provider"); };
test.after(() => { globalThis.fetch = originalFetch; });

// Explicit storage/SQL fixtures only: these bytes are not generated music,
// measured audio, a provider receipt, or evidence of execution admission.
const fixtureBytes = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0]);
const sha256 = value => createHash("sha256").update(value).digest("hex");

function fixture({ repair = false, scopeOwner = "owner", scopeDocument = "document" } = {}) {
  const f = outputTestDatabase();
  f.sqlite.exec(`
    CREATE TABLE output_atomic_assertions(token TEXT PRIMARY KEY,passed INTEGER CHECK(passed=1));
    CREATE TABLE events(event_id TEXT PRIMARY KEY,stream_id TEXT,type TEXT,correlation_id TEXT,actor TEXT,sequence INTEGER);
    CREATE TABLE event_private_payloads(private_event_id TEXT PRIMARY KEY,owner_id TEXT,document_id TEXT,private_json TEXT,redacted_at TEXT);
    CREATE TABLE document_jobs(job_id TEXT PRIMARY KEY,owner_id TEXT,document_id TEXT,stream_id TEXT,kind TEXT,status TEXT,expires_at TEXT,correlation_id TEXT,result_json TEXT,request_json TEXT);
    CREATE TABLE output_operation_slots(scope_key TEXT,slot_id TEXT,job_id TEXT,grant_id TEXT,plan_revision_id TEXT,target_id TEXT,target_contract_digest TEXT,source_digest TEXT,provider TEXT,model TEXT,attempt_ordinal INTEGER,previous_slot_id TEXT,status TEXT);
    CREATE TABLE output_execution_grants(scope_key TEXT,grant_id TEXT,actor_user_id TEXT,context_id TEXT,status TEXT,expires_at TEXT);
    CREATE TABLE output_plan_revisions(scope_key TEXT,plan_revision_id TEXT,owner_user_id TEXT,document_id TEXT,organization_id TEXT,project_access_id TEXT,scope_kind TEXT);
    CREATE TABLE output_provider_calls(scope_key TEXT,slot_id TEXT,call_key TEXT,stage_key TEXT,provider TEXT,model TEXT,client_request_id TEXT,status TEXT,used_microusd INTEGER,provider_response_id TEXT,request_digest TEXT);
    CREATE TABLE output_native_storage_writes(scope_key TEXT,slot_id TEXT,storage_key TEXT,content_sha256 TEXT,status TEXT,write_acknowledged INTEGER,publication_event_id TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE private_content(content_id TEXT,owner_id TEXT,kind TEXT,redacted_at TEXT,expires_at TEXT);
    CREATE TABLE project_resource_scopes(resource_kind TEXT,resource_id TEXT);
  `);
  const future = new Date(Date.now() + 60_000).toISOString();
  const contract = createAudioOutputContract({
    draftId: "experience-draft-" + "a".repeat(64), draftHash: "sha256:" + "b".repeat(64),
    releaseHash: "sha256:" + "c".repeat(64), requestHash: "sha256:" + "d".repeat(64), sourceBindingHash: "sha256:" + "e".repeat(64),
  });
  assert(contract);
  const reference = { scopeKey: "scope", slotId: "slot", grantId: "grant", planRevisionId: "revision", targetId: "target", targetContractDigest: "target-digest", sourceDigest: "source-digest" };
  const request = {
    outputAudio: contract, outputExecution: reference,
    audioCostConsent: { requestId: "job", confirmed: true, providerTransferConfirmed: true, actorUserId: "owner", documentId: "document", projectId: "project", sourceDigest: "source-digest", draftId: contract.source.draftId },
  };
  f.sqlite.prepare("INSERT INTO document_jobs VALUES('job','owner','document','creative:owner','render_document','committing',?,'correlation',?,?)")
    .run(future, JSON.stringify({ artifactId: "audio-original" }), JSON.stringify(request));
  f.sqlite.exec(`
    INSERT INTO output_operation_slots VALUES('scope','slot','job','grant','revision','target','target-digest','source-digest','fal','fal-ai/stable-audio-3/medium/text-to-audio',0,NULL,'running');
    INSERT INTO output_plan_revisions VALUES('scope','revision','owner','document',NULL,NULL,'personal');
  `);
  f.sqlite.prepare("INSERT INTO output_execution_grants VALUES('scope','grant','owner',NULL,'active',?)").run(future);
  const plannerIds = ["planner-initial", ...(repair ? ["planner-repair"] : [])];
  for (const [index, id] of plannerIds.entries()) {
    const stage = index ? "planning:0:repair" : "planning:0:initial";
    f.sqlite.prepare("INSERT INTO output_provider_calls VALUES('scope','slot',?,?,'openai','gpt-5.6-terra',?,'settled',100,?,?)")
      .run(stage, stage, id, id + "-response", id + "-digest");
  }
  f.sqlite.exec("INSERT INTO output_provider_calls VALUES('scope','slot','audio:initial','audio:initial','fal','fal-ai/stable-audio-3/medium/text-to-audio','media-original','settled',500,'fal-original','media-digest')");
  const key = "fixture-owner/generated/audio-original.mp3", url = "/api/media/" + encodeURIComponent(key);
  const payload = {
    document_id: "document", project_id: "project", artifact_id: "audio-original", artifact_kind: "audio", source_surface: "outputs",
    requested_by_user_id: "owner", media_type: "audio/mpeg", media_url: url, item_count: 1,
    items: [{ id: "audio-original-item-1", media_url: null, media_type: null, width: null, height: null }], provider_job_id: "fal-original",
    settings: {
      source_media_sha256: sha256(fixtureBytes), output_audio: structuredClone(contract), output_audio_execution: structuredClone(reference),
      output_audio_receipt: { schemaVersion: 1, contract: structuredClone(contract), requestedSeconds: 20, measuredSeconds: null, requirementFulfilled: false, plannerCallIds: plannerIds, mediaCallId: "media-original", providerRequestId: "fal-original", requestDigest: "media-digest" },
    },
  };
  const scope = { key: "scope", kind: "personal", ownerUserId: scopeOwner, actorUserId: "owner", documentId: scopeDocument, projectId: "project", organizationId: null, projectAccessId: null };
  const slot = { slotId: "slot", jobId: "job" };
  // Deliberately only fixture ownership, not a mock of paid admission or a
  // substitute for the execution hook's live source/lease assertions.
  const guarded = guardOutputPrivateWrites(f.env, scope, slot, async () => [{
    sql: "EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND owner_id=?)", bindings: ["job", "owner"],
  }], { retentionPolicy: null });
  const write = (bytes = fixtureBytes, storageKey = key) => guarded.MEDIA.put(storageKey, bytes, { httpMetadata: { contentType: "audio/mpeg" } });
  const publish = () => guarded.DB.batch([
    guarded.DB.prepare("INSERT INTO events VALUES('completion','creative:owner','DocumentRenderCompleted','correlation','worker:renderer',1)"),
    guarded.DB.prepare("INSERT INTO event_private_payloads VALUES('completion','owner','document',?,NULL)").bind(JSON.stringify(payload)),
  ]);
  const storage = () => f.sqlite.prepare("SELECT status,write_acknowledged,publication_event_id FROM output_native_storage_writes").get();
  const expire = async () => {
    f.sqlite.exec("UPDATE document_jobs SET status='completed'; UPDATE output_operation_slots SET status='succeeded'; UPDATE output_execution_grants SET status='completed',expires_at='2000-01-01T00:00:00.000Z'");
    return reconcileOutputNativeStorage(f.env, { ownerUserId: "owner", personalOnly: true });
  };
  const saveRequest = () => f.sqlite.prepare("UPDATE document_jobs SET request_json=? WHERE job_id='job'").run(JSON.stringify(request));
  return { ...f, request, payload, key, scope, write, publish, storage, expire, saveRequest };
}

test("original Audio publication survives spend expiry with either one or two original planner calls", async t => {
  for (const repair of [false, true]) await t.test(repair ? "initial plus repair" : "initial only", async () => {
    const f = fixture({ repair });
    try {
      await f.write();
      assert.equal(f.storage().publication_event_id, null, "PUT alone is not publication");
      await f.publish();
      assert.equal(f.storage().publication_event_id, "completion");
      assert.equal(f.storage().write_acknowledged, 1);
      const before = [...f.media.values()][0].bytes.slice();
      const calls = f.sqlite.prepare("SELECT * FROM output_provider_calls ORDER BY call_key").all();
      assert.equal((await f.expire()).reconciled, 0);
      assert.equal(f.storage().status, "written");
      assert.equal(f.media.size, 1);
      assert.deepEqual([...f.media.values()][0].bytes, before);
      assert.deepEqual(f.sqlite.prepare("SELECT * FROM output_provider_calls ORDER BY call_key").all(), calls);
    } finally { f.sqlite.close(); }
  });
});

test("altered Audio identity, contract, call or consent never qualifies for publication", async t => {
  const cases = [
    ["foreign hash", f => { f.payload.settings.source_media_sha256 = "f".repeat(64); }],
    ["foreign URL", f => { f.payload.media_url += ".foreign"; }],
    ["foreign event owner", f => { f.payload.requested_by_user_id = "foreign"; }],
    ["foreign event document", f => { f.payload.document_id = "foreign"; }],
    ["foreign contract", f => { f.payload.settings.output_audio.source.draftHash = "sha256:" + "f".repeat(64); }],
    ["foreign execution", f => { f.payload.settings.output_audio_execution.slotId = "foreign"; }],
    ["foreign media call", f => { f.payload.settings.output_audio_receipt.mediaCallId = "foreign"; }],
    ["foreign provider request", f => { f.sqlite.exec("UPDATE output_provider_calls SET provider_response_id='foreign' WHERE stage_key='audio:initial'"); }],
    ["foreign request digest", f => { f.sqlite.exec("UPDATE output_provider_calls SET request_digest='foreign' WHERE stage_key='audio:initial'"); }],
    ["unsettled media", f => { f.sqlite.exec("UPDATE output_provider_calls SET status='uncertain' WHERE stage_key='audio:initial'"); }],
    ["missing planner", f => { f.sqlite.exec("DELETE FROM output_provider_calls WHERE stage_key='planning:0:initial'"); }],
    ["duplicate planner receipt", f => { f.payload.settings.output_audio_receipt.plannerCallIds.push("planner-initial"); }],
    ["missing cost consent", f => { delete f.request.audioCostConsent.confirmed; f.saveRequest(); }],
    ["missing transfer consent", f => { f.request.audioCostConsent.providerTransferConfirmed = false; f.saveRequest(); }],
    ["foreign consent project", f => { f.request.audioCostConsent.projectId = "foreign"; f.saveRequest(); }],
    ["foreign consent source", f => { f.request.audioCostConsent.sourceDigest = "foreign"; f.saveRequest(); }],
  ];
  for (const [name, mutate] of cases) await t.test(name, async () => {
    const f = fixture();
    try {
      await f.write(); mutate(f); await f.publish();
      assert.equal(f.storage().publication_event_id, null);
      assert.equal((await f.expire()).reconciled, 1);
      assert.equal(f.storage().status, "deleted");
      assert.equal(f.media.size, 0);
    } finally { f.sqlite.close(); }
  });
});

test("foreign ownership metadata stays unlinked and is not deleted by owner cleanup", async t => {
  for (const options of [{ scopeOwner: "foreign" }, { scopeDocument: "foreign" }]) await t.test(Object.keys(options)[0], async () => {
    const f = fixture(options);
    try {
      await f.write(); await f.publish();
      assert.equal(f.storage().publication_event_id, null);
      assert.equal((await f.expire()).reconciled, 0);
      assert.equal(f.storage().status, "cleanup_pending");
      assert.equal(f.media.size, 1, "cleanup cannot delete an object whose ownership metadata differs");
    } finally { f.sqlite.close(); }
  });
});
