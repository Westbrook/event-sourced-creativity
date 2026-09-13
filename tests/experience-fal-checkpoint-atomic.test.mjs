import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { guardOutputPrivateWrites } from "../worker/output-private-execution.ts";
import { outputAssertionStatements, OutputConflictError } from "../worker/output-command-core.ts";
import { createOutputFalImageContract, captureOutputFalImageRequest, restoreOutputFalImageRequest } from "../worker/output-fal-image-contract.ts";

// SQL transaction unit coverage only: synthetic pending metadata is not a real
// authorization, provider receipt, completed job, or full mini-app journey.
// The actual checkpoint writer and custody wrapper run against in-memory SQLite.
// Only private-content preparation is injected to avoid unrelated retention/schema work.
test("checkpoint transaction pairs both bodies with metadata, and rolls back every partial write", async () => {
  const source = await readFile(new URL("../worker/output-fal-image-checkpoint.ts", import.meta.url), "utf8");
  const executable = stripTypeScriptTypes(source.replace(/^import .*;\n/gm, "").replace("export async function", "async function"));
  const contract = createOutputFalImageContract("ideogram/v4", "1024x1024");
  const request = await captureOutputFalImageRequest(contract, contract.model, {
    prompt: "A copper lamp.", expansion_model: "Large", image_size: { width: 1024, height: 1024 },
    rendering_speed: "QUALITY", acceleration: "none", num_images: 1, sync_mode: false,
    enable_safety_checker: true, output_format: "png",
  }, contract, "original-call");
  for (const mode of ["success", "revoked", "wrong-call", "expired-lease", "missing-body", "late-write-failure", "existing-checkpoint"]) {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(`CREATE TABLE output_atomic_assertions(token TEXT PRIMARY KEY,passed INTEGER NOT NULL CHECK(passed=1));
        CREATE TABLE output_provider_calls(scope_key TEXT,slot_id TEXT,call_key TEXT,stage_key TEXT,provider TEXT,model TEXT,client_request_id TEXT,request_digest TEXT,status TEXT,provider_response_id TEXT);
        CREATE TABLE output_operation_slots(scope_key TEXT,slot_id TEXT,job_id TEXT,route_digest TEXT,grant_id TEXT,source_digest TEXT,status TEXT);
        CREATE TABLE document_jobs(job_id TEXT,owner_id TEXT,stream_id TEXT,document_id TEXT,correlation_id TEXT,attempt_count INTEGER,status TEXT,lease_expires_at TEXT,result_json TEXT,updated_at TEXT);
        CREATE TABLE private_content(content_id TEXT PRIMARY KEY,owner_id TEXT,kind TEXT,content TEXT,created_at TEXT,expires_at TEXT,redacted_at TEXT);`);
      const expiry = "9999-12-31T23:59:59.999Z";
      const prior = mode === "existing-checkpoint" ? JSON.stringify({ outputFalCheckpoint: { requestRef: "already-retained" } }) : "{}";
      db.prepare("INSERT INTO output_provider_calls VALUES(?,?,?,?,?,?,?,?,?,NULL)").run("scope", "slot", "image:initial", "image:initial", "fal", contract.model, mode === "wrong-call" ? "other-call" : request.attempt.clientRequestId, request.attempt.requestDigest, "pending");
      db.prepare("INSERT INTO output_operation_slots VALUES(?,?,?,?,?,?,?)").run("scope", "slot", "job", "route", "grant", "source", "running");
      db.prepare("INSERT INTO document_jobs VALUES(?,?,?,?,?,?,?,?,?,?)").run("job", "actor", "creative:actor", "document", "correlation", 1, "running", mode === "expired-lease" ? "2000-01-01T00:00:00.000Z" : expiry, prior, "");
      if (mode === "late-write-failure") db.exec("CREATE TRIGGER reject_checkpoint BEFORE UPDATE ON document_jobs BEGIN SELECT RAISE(ABORT,'checkpoint_refused'); END");
      const statement = (sql, bindings = []) => ({
        bind: (...args) => statement(sql, args),
        run: () => { const r = db.prepare(sql).run(...bindings); return { results: [], meta: { changes: Number(r.changes) } }; },
      });
      const nativeDB = {
        prepare: statement,
        batch: async (items) => {
          db.exec("BEGIN");
          try { const results = items.map(item => item.run()); db.exec("COMMIT"); return results; }
          catch (error) { db.exec("ROLLBACK"); throw error; }
        },
      };
      const scope = { key: "scope", actorUserId: "actor", documentId: "document", kind: "personal" };
      const slot = { slotId: "slot", jobId: "job", routeDigest: "route", grantId: "grant", sourceDigest: "source" };
      let guardCalls = 0;
      const env = guardOutputPrivateWrites({ DB: nativeDB, MEDIA: {} }, scope, slot, async () => {
        guardCalls++;
        return [{ sql: "?=1", bindings: [mode === "revoked" ? 0 : 1] }];
      });
      let prepared = 0;
      const prepare = async (guarded, owner, kind, body) => {
        const contentId = "body-" + (++prepared);
        const statements = mode === "missing-body" && prepared === 2 ? [] : [
          guarded.DB.prepare("INSERT INTO private_content VALUES(?,?,?,?,?,?,NULL)").bind(contentId, owner, kind, body, new Date().toISOString(), expiry),
        ];
        return { contentId, expiresAt: expiry, statements };
      };
      const retain = new Function("preparePrivateContent", "outputAssertionStatements", "OutputConflictError", "restoreOutputFalImageRequest",
        executable + "; return retainOutputFalImageCheckpoint;")(prepare, outputAssertionStatements, OutputConflictError, restoreOutputFalImageRequest);
      const job = { owner_id: "actor", job_id: "job", kind: "generate", document_id: "document", output_slot_id: "slot", stream_id: "creative:actor", correlation_id: "correlation", attempt_count: 1, result_json: prior };
      const perform = () => retain(env, { userId: "actor" }, job, scope, slot, request, { title: "Original private planning" });
      if (mode === "success") {
        await perform();
        const saved = JSON.parse(db.prepare("SELECT result_json FROM document_jobs").get().result_json);
        assert.deepEqual(JSON.parse(job.result_json), saved);
        const bodies = db.prepare("SELECT * FROM private_content ORDER BY content_id").all();
        assert.equal(bodies.length, 2);
        assert.equal(bodies[0].content, request.body);
        assert.equal(saved.outputFalCheckpoint.requestRef, bodies[0].content_id);
        assert.equal(saved.outputFalCheckpoint.planningRef, bodies[1].content_id);
        assert.equal(JSON.stringify(saved).includes("copper"), false);
        assert.equal(JSON.stringify(saved).includes("Original private planning"), false);
        await assert.rejects(perform(), undefined, "existing checkpoint cannot be replaced");
        assert.equal(db.prepare("SELECT COUNT(*) AS n FROM private_content").get().n, 2);
      } else {
        await assert.rejects(perform(), undefined, mode);
        assert.equal(db.prepare("SELECT COUNT(*) AS n FROM private_content").get().n, 0, mode);
        assert.equal(db.prepare("SELECT result_json FROM document_jobs").get().result_json, prior, mode);
        assert.equal(job.result_json, prior, mode);
      }
      assert.ok(guardCalls >= 1, mode);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM output_atomic_assertions").get().n, 0, mode);
    } finally { db.close(); }
  }
});

