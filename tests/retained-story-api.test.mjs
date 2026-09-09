import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { outputTestDatabase, registerOutputSourceImports } from "./output-server-test-helpers.mjs";

const imports = registerOutputSourceImports();
let handleRetainedStoryRead, ensureSchema, appendAuditEvent, retainedStoryRequestPath;
let appendEvents, makeEvent, nativeStoryCompletionPath;
let handleNativeRetainedOutputRead, nativeRetainedOutputRequestPath, parseNativeRetainedOutputRoute;
let nativeSceneCompletionPath, validateNativeSceneCompletion, nativeSceneRetainedRoute;
try {
  ({ handleRetainedStoryRead } = await import("../worker/retained-story-api.ts"));
  ({ handleNativeRetainedOutputRead } = await import("../worker/retained-story-api.ts"));
  ({ nativeRetainedOutputRequestPath, parseNativeRetainedOutputRoute } = await import("../src/model/native-retained-output.ts"));
  ({ nativeSceneCompletionPath, validateNativeSceneCompletion, nativeSceneRetainedRoute } = await import("../src/model/native-scene-completion.ts"));
  ({ ensureSchema, appendAuditEvent } = await import("../worker/runtime.ts"));
  ({ retainedStoryRequestPath } = await import("../src/model/retained-short-story.ts"));
  ({ appendEvents, makeEvent } = await import("../worker/runtime.ts"));
  ({ nativeStoryCompletionPath } = await import("../src/model/native-short-story-generation.ts"));
} finally { imports.deregister(); }

const OWNER = "retained-story-owner";
const EMAIL = "retained-story-owner@example.test";
const DOCUMENT = "retained-story-document";
const PROJECT = "retained-story-personal-project";
const ARTIFACT = "retained-story-artifact";
const CONTENT = "retained-story-content";
const EXPIRY = "2099-01-01T00:00:00.000Z";
const POLICY = "pilot-2026-08-10";
const digest = value => createHash("sha256").update(value, "utf8").digest("hex");
const initialBody = () => ({ title: "Literal <title>", summary: "Not transported", content_markdown: "# A retained story\n\nLiteral <script>text</script>.", presentation: null,
  items: [{ title: "Part one", body: "The original item body.", notes: "Private notes, not transported", image_prompt: "", slide: null }] });

async function fixture(t, options = {}) {
  const state = outputTestDatabase();
  t.after(() => state.sqlite.close());
  await ensureSchema(state.env);
  const now = new Date().toISOString();
  state.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
    .run(OWNER, EMAIL, "Retained owner", "creator", POLICY, now, now, now);
  const stream = `creative:${OWNER}`;
  await appendAuditEvent(state.env, stream, "user", "DocumentCreated", { document_id: DOCUMENT, project_id: PROJECT, title: "Document name is not the result title" });
  const completion = await (options.completionWriter ?? appendAuditEvent)(state.env, stream, "worker:renderer", "DocumentRenderCompleted", {
    document_id: DOCUMENT, project_id: PROJECT, artifact_id: ARTIFACT, artifact_kind: options.kind ?? "short_story",
    requested_by_user_id: OWNER, title: "Completion name is not the retained title", content_ref: CONTENT, item_count: 1,
    ...options.completionPayload,
  });
  let raw = JSON.stringify(initialBody());
  state.sqlite.prepare("INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at) VALUES(?,?,?,?,?,?,NULL)")
    .run(CONTENT, OWNER, "document-artifact", raw, now, EXPIRY);
  const calls = [];
  const rawReads = [];
  let beforeRead = null;
  const guardedDB = {
    prepare(sql) {
      assert.match(sql, /^\s*(?:WITH|SELECT)\b/iu, "the read endpoint may not prepare any writer statement");
      const prepared = state.DB.prepare(sql);
      function statement(values) {
        return {
          bind(...bindings) { return statement(bindings); },
          async first() {
            calls.push(sql);
            if (beforeRead) await beforeRead(sql);
            const result = await prepared.bind(...values).first();
            if (sql.startsWith("SELECT content,expires_at")) rawReads.push(result);
            return result;
          },
          async all() {
            calls.push(sql);
            if (beforeRead) await beforeRead(sql);
            return prepared.bind(...values).all();
          },
        };
      }
      return statement([]);
    },
    batch() { throw new Error("No batch or mutation is expected from the retained reader"); },
  };
  const env = { ...state.env, DB: guardedDB,
    MEDIA: new Proxy({}, { get() { throw new Error("Retained read entered MEDIA"); } }),
    ASSETS: { fetch() { throw new Error("Retained read entered ASSETS"); } },
  };
  const select = (revision = 0, sha256 = digest(raw)) => ({ documentId: DOCUMENT, artifactId: ARTIFACT, revision, contentSha256: sha256 });
  const request = (selection = select(), headers = {}, method = "GET") => new Request(`https://forma.test${retainedStoryRequestPath(selection)}`, {
    method, headers: { "oai-authenticated-user-id": OWNER, "oai-authenticated-user-email": EMAIL, ...headers },
  });
  const read = (selection = select(), headers = {}) => handleRetainedStoryRead(request(selection, headers), env);
  const requestNative = (output, selection = select(), headers = {}, method = "GET") => new Request(
    `https://forma.test${nativeRetainedOutputRequestPath({ output, selection })}`, {
      method, headers: { "oai-authenticated-user-id": OWNER, "oai-authenticated-user-email": EMAIL, ...headers },
    });
  const readNative = (output, selection = select(), headers = {}) => handleNativeRetainedOutputRead(requestNative(output, selection, headers), env);
  const changes = () => state.sqlite.prepare("SELECT total_changes() AS count").get().count;
  const replace = value => {
    raw = typeof value === "string" ? value : JSON.stringify(value);
    state.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id=?").run(raw, CONTENT);
  };
  const append = (type, payload) => appendAuditEvent(state.env, stream, "user", type, { project_id: PROJECT, document_id: DOCUMENT, ...payload });
  // Deliberately malformed/oversized public-history fixtures, never production admission.
  let rawSequence = 0;
  const rawEvent = (type, payload) => {
    const sequence = state.sqlite.prepare("SELECT COALESCE(MAX(sequence),0)+1 AS next FROM events WHERE stream_id=?").get(stream).next;
    state.sqlite.prepare("INSERT INTO events(event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,schema_version,type,payload) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
      .run(`retained-raw-${++rawSequence}`, stream, sequence, now, now, "user", "test", "retained-test", 1, type, JSON.stringify(payload));
  };
  return { ...state, env, calls, rawReads, request, read, requestNative, readNative, select, changes, replace, append, rawEvent, completion,
    raw: () => raw, setBeforeRead(value) { beforeRead = value; } };
}

test("retained Short Story reads only the current hash-bound native text without writes", async t => {
  const f = await fixture(t);
  const before = f.changes();
  const response = await f.read();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(await response.json(), { schemaVersion: 1, kind: "native-retained-short-story", selection: f.select(),
    title: initialBody().title, contentMarkdown: initialBody().content_markdown, expiresAt: EXPIRY });
  assert.notEqual(f.select().contentSha256, digest(initialBody().content_markdown));
  assert.equal(f.changes(), before);
  assert.equal(f.calls.length, 4);
  assert.equal(f.calls.filter(sql => sql.includes("expected_events AS")).length, 1);
  assert.equal(f.calls.some(sql => /(?:private_json|artifact_revisions|document_jobs)/u.test(sql)), false);
});

test("retained Short Story selects edited current bytes and refuses historical revision or hash", async t => {
  const f = await fixture(t);
  const old = f.select();
  f.replace({ ...initialBody(), title: "Edited native title", content_markdown: "The exact edited story." });
  await f.append("DocumentArtifactEdited", { artifact_id: ARTIFACT, content_ref: CONTENT, revision: 1,
    content_sha256: digest(f.raw()), edited_by_user_id: OWNER });
  const before = f.changes();
  const response = await f.read(f.select(1));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).title, "Edited native title");
  assert.equal((await f.read(old)).status, 404);
  assert.equal((await f.read(f.select(1, old.contentSha256))).status, 404);
  assert.equal((await f.read(f.select(2))).status, 404);
  assert.equal(f.changes(), before);
  assert.equal(f.calls.some(sql => sql.includes("artifact_revisions")), false);
});

test("retained Short Story requires an existing current hosted personal author without provisioning", async t => {
  for (const fault of ["missing", "bare-cf", "email", "role", "consent", "project-cookie", "impersonation-cookie", "empty-context-cookie", "other-owner"]) {
    await t.test(fault, async child => {
      const f = await fixture(child);
      let request = f.request();
      let expected = 403;
      if (fault === "missing" || fault === "bare-cf") {
        request = new Request(request.url, { headers: fault === "bare-cf" ? { "cf-access-authenticated-user-email": EMAIL } : {} });
        expected = 401;
      } else if (fault === "email") request = f.request(f.select(), { "oai-authenticated-user-email": "changed@example.test" });
      else if (fault === "role") f.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id=?").run(OWNER);
      else if (fault === "consent") f.sqlite.prepare("UPDATE users SET consent_version='old' WHERE user_id=?").run(OWNER);
      else if (fault === "other-owner") request = f.request(f.select(), { "oai-authenticated-user-id": "unprovisioned-user" });
      else request = f.request(f.select(), { cookie: fault === "project-cookie" ? "forma_project_context=selected"
        : fault === "empty-context-cookie" ? "forma_project_context=" : "forma_impersonation=%ZZ" });
      const before = f.changes();
      assert.equal((await handleRetainedStoryRead(request, f.env)).status, expected);
      assert.equal(f.changes(), before);
      assert.equal(f.calls.some(sql => sql.includes("event_base AS")), false);
    });
  }
});

test("retained Short Story preserves configured cohort admission without binding a participant", async t => {
  const f = await fixture(t);
  const now = new Date().toISOString();
  f.sqlite.prepare("INSERT INTO organizations VALUES(?,?,?,?,?,?)").run("reader-org", "Reader org", "another-owner", "active", now, now);
  f.sqlite.prepare("INSERT INTO pilot_cohorts(cohort_id,organization_id,status,starts_at,ends_at,created_by_user_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
    .run("reader-cohort", "reader-org", "active", "2020-01-01T00:00:00.000Z", EXPIRY, OWNER, now, now);
  f.sqlite.prepare("INSERT INTO pilot_participants(participant_id,cohort_id,organization_id,email_normalized,user_id,status,invited_by_user_id,created_at) VALUES(?,?,?,?,?,?,?,?)")
    .run("reader-participant", "reader-cohort", "reader-org", EMAIL, null, "active", OWNER, now);
  f.env.FORMA_PILOT_COHORT_ID = "reader-cohort";
  const beforeUnbound = f.changes();
  assert.equal((await f.read()).status, 403);
  assert.equal(f.changes(), beforeUnbound);
  assert.equal(f.sqlite.prepare("SELECT user_id FROM pilot_participants").get().user_id, null);
  f.sqlite.prepare("UPDATE pilot_participants SET user_id=?").run(OWNER);
  const beforeBound = f.changes();
  assert.equal((await f.read()).status, 200);
  assert.equal(f.changes(), beforeBound);
  f.sqlite.prepare("UPDATE pilot_participants SET revoked_at=?").run(now);
  assert.equal((await f.read()).status, 403);
});

test("retained Short Story honors identity-policy custody denial without refreshing identity", async t => {
  const f = await fixture(t);
  const now = new Date().toISOString();
  f.sqlite.prepare("INSERT INTO organizations VALUES(?,?,?,?,?,?)").run("policy-org", "Policy org", OWNER, "active", now, now);
  f.sqlite.prepare("INSERT INTO organization_memberships(membership_id,organization_id,user_id,role,status,invited_by_user_id,accepted_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .run("policy-member", "policy-org", OWNER, "owner", "active", OWNER, now, now, now);
  f.sqlite.prepare("INSERT INTO organization_security_policies(organization_id,require_mfa,updated_by_user_id,updated_at) VALUES(?,?,?,?)")
    .run("policy-org", 1, OWNER, now);
  const before = f.changes();
  assert.equal((await f.read()).status, 403);
  assert.equal(f.changes(), before);
  assert.equal(f.calls.some(sql => sql.includes("event_base AS")), false);
});

test("retained Short Story rejects unavailable or ambiguous personal native selection", async t => {
  for (const fault of ["expired", "redacted", "wrong-owner", "removed-document", "duplicate-document", "duplicate-artifact", "source-erased", "scoped-content", "scoped-project", "scoped-event", "wrong-kind"]) {
    await t.test(fault, async child => {
      const f = await fixture(child, { kind: fault === "wrong-kind" ? "slides" : "short_story" });
      const now = new Date().toISOString();
      if (fault === "expired") f.sqlite.prepare("UPDATE private_content SET expires_at='2020-01-01T00:00:00.000Z'").run();
      else if (fault === "redacted") f.sqlite.prepare("UPDATE private_content SET redacted_at=?").run(now);
      else if (fault === "wrong-owner") f.sqlite.prepare("UPDATE private_content SET owner_id='other'").run();
      else if (fault === "removed-document") await f.append("DocumentRemoved", {});
      else if (fault === "duplicate-document") await f.append("DocumentForked", { title: "Duplicate identity" });
      else if (fault === "duplicate-artifact") await f.append("DocumentRenderCompleted", {
        artifact_id: ARTIFACT, artifact_kind: "short_story", content_ref: CONTENT, requested_by_user_id: OWNER,
      });
      else if (fault === "source-erased") f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at=? WHERE private_event_id=?").run(now, f.completion.eventId);
      else if (fault === "scoped-content") f.sqlite.prepare("INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,actor_user_id,created_at) VALUES(?,?,?,?,?,?,?,?)")
        .run("tenant-access", "content", CONTENT, "tenant", PROJECT, OWNER, OWNER, now);
      else if (fault === "scoped-project") f.sqlite.prepare("INSERT INTO organization_projects VALUES(?,?,?,?,?,?,?)")
        .run("tenant-access", PROJECT, "tenant", OWNER, "active", now, now);
      else if (fault === "scoped-event") f.sqlite.prepare("INSERT INTO project_event_scopes VALUES(?,?,?,?,?,?,?,?,?,?)")
        .run(f.completion.eventId, "tenant-access", "tenant", PROJECT, OWNER, `creative:${OWNER}`, 2, 1, OWNER, now);
      const before = f.changes();
      const response = await f.read();
      assert.equal(response.status, 404);
      assert.equal(f.changes(), before);
      assert.equal((await response.text()).includes(initialBody().content_markdown), false);
    });
  }
});

test("retained Short Story gates authorization, public history and raw content before materializing more", async t => {
  for (const fault of ["auth-bytes", "event-count", "event-row-bytes", "event-total-bytes", "raw-bytes", "expiry-bytes", "markdown-bytes", "title-bytes"]) {
    await t.test(fault, async child => {
      const f = await fixture(child);
      if (fault === "auth-bytes") f.sqlite.prepare("UPDATE users SET display_name=?").run("a".repeat(128 * 1024));
      else if (fault === "event-count") for (let index = 0; index < 511; index++) f.rawEvent("DocumentRestored", { document_id: `other-${index}` });
      else if (fault === "event-row-bytes") f.rawEvent("DocumentRestored", { document_id: "other", text: "a".repeat(64 * 1024) });
      else if (fault === "event-total-bytes") for (let index = 0; index < 40; index++) f.rawEvent("DocumentRestored", { document_id: `other-${index}`, text: "a".repeat(30_000) });
      else if (fault === "raw-bytes") f.replace({ ...initialBody(), unused: "a".repeat(1_000_000) });
      else if (fault === "expiry-bytes") f.sqlite.prepare("UPDATE private_content SET expires_at=?").run("z".repeat(1_000_000));
      else if (fault === "markdown-bytes") f.replace({ ...initialBody(), content_markdown: "a".repeat(512_001) });
      else f.replace({ ...initialBody(), title: "a".repeat(80_001) });
      const before = f.changes();
      assert.equal((await f.read()).status, fault === "auth-bytes" ? 403 : 404);
      assert.equal(f.changes(), before);
      assert.equal(f.calls.some(sql => sql.includes("expected_events AS")), false);
      if (fault === "expiry-bytes" || fault === "raw-bytes") assert.deepEqual(f.rawReads, [null], "SQL must deny raw materialization before DTO validation");
      if (fault.startsWith("event-") || fault === "auth-bytes") {
        assert.equal(f.calls.some(sql => sql.startsWith("SELECT content,expires_at")), false);
      }
    });
  }
});

test("retained Short Story final read rejects intervening authority, bytes, expiry, source or custody change", async t => {
  for (const fault of ["role", "consent", "same-length-content", "expiry", "source-redaction", "new-revision", "custody"]) {
    await t.test(fault, async child => {
      const f = await fixture(child);
      let finalEntered = 0;
      f.setBeforeRead(async sql => {
        if (!sql.includes("expected_events AS")) return;
        finalEntered++;
        if (fault === "role") f.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id=?").run(OWNER);
        else if (fault === "consent") f.sqlite.prepare("UPDATE users SET consent_version='old' WHERE user_id=?").run(OWNER);
        else if (fault === "same-length-content") f.replace(f.raw().replace("A retained story", "B retained story"));
        else if (fault === "expiry") f.sqlite.prepare("UPDATE private_content SET expires_at='2020-01-01T00:00:00.000Z'").run();
        else if (fault === "source-redaction") f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at=? WHERE private_event_id=?").run(new Date().toISOString(), f.completion.eventId);
        else if (fault === "new-revision") await f.append("DocumentArtifactEdited", { artifact_id: ARTIFACT, content_ref: CONTENT,
          revision: 1, content_sha256: digest(f.raw()), edited_by_user_id: OWNER });
        else f.sqlite.prepare("INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,actor_user_id,created_at) VALUES(?,?,?,?,?,?,?,?)")
          .run("late-tenant", "artifact", ARTIFACT, "tenant", PROJECT, OWNER, OWNER, new Date().toISOString());
      });
      const response = await f.read();
      assert.equal(finalEntered, 1, "the initial authorization, history, body and hash must succeed first");
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: "retained_story_unavailable" });
    });
  }
});

test("retained Short Story does not dispatch invalid methods or selectors", async t => {
  const f = await fixture(t);
  assert.equal((await handleRetainedStoryRead(f.request(f.select(), {}, "POST"), f.env)).status, 405);
  assert.equal((await handleRetainedStoryRead(new Request(`${f.request().url}&revision=0`), f.env)).status, 400);
  assert.equal(f.calls.length, 0);
});

// Detached source proposals only. These fixture writes and endpoint calls have
// not been run; the guarded endpoint binding still permits SELECTs only.
const NATIVE_JOB = "retained-native-story-job";
async function nativeFixture(t, options = {}) {
  const f = await fixture(t, { kind: options.kind, completionWriter: async (env, stream, actor, type, payload) => {
    if (options.beforeCompletion) await options.beforeCompletion(env, stream, payload);
    const event = makeEvent(options.completionStream ?? stream, 0, options.completionActor ?? actor,
      options.completionClient ?? "server:document-job:render_document", options.completionCorrelation ?? `${NATIVE_JOB}:attempt:1`,
      type, { ...payload, ...options.completionPayload });
    await appendEvents(env, [event]);
    return event;
  } });
  const now = new Date().toISOString();
  const jobRequest = { artifactKind: "short_story", productionMode: "manual", itemCount: 1 };
  const jobResult = { artifactKind: "short_story", artifactId: ARTIFACT, appendedEventIds: [f.completion.eventId] };
  const job = { job_id: NATIVE_JOB, owner_id: OWNER, stream_id: `creative:${OWNER}`, document_id: DOCUMENT,
    kind: "render_document", status: "completed", source_surface: "document", correlation_id: `${NATIVE_JOB}:attempt:1`,
    requested_sequence: 1, request_json: JSON.stringify(jobRequest), result_json: JSON.stringify(jobResult),
    error_message: null, attempt_count: 1, requested_at: now, started_at: now, completed_at: now,
    expires_at: EXPIRY, updated_at: now, ...options.job };
  f.sqlite.prepare("INSERT INTO document_jobs(job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,request_json,result_json,error_message,attempt_count,requested_at,started_at,completed_at,expires_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(job.job_id, job.owner_id, job.stream_id, job.document_id, job.kind, job.status, job.source_surface,
      job.correlation_id, job.requested_sequence, job.request_json, job.result_json, job.error_message,
      job.attempt_count, job.requested_at, job.started_at, job.completed_at, job.expires_at, job.updated_at);
  const handle = { documentId: DOCUMENT, jobId: NATIVE_JOB };
  const completionRequest = (headers = {}, method = "GET") => new Request(`https://forma.test${nativeStoryCompletionPath(handle)}`, {
    method, headers: { "oai-authenticated-user-id": OWNER, "oai-authenticated-user-email": EMAIL, ...headers },
  });
  const readCompletion = (headers = {}) => handleRetainedStoryRead(completionRequest(headers), f.env);
  return { ...f, handle, jobRequest, jobResult, completionRequest, readCompletion };
}

test("native completion resolves the exact owned completed manual one-item job to metadata only without writes", async t => {
  for (const earlier of ["job", "source"]) {
    await t.test(`${earlier} expiry limits the receipt`, async child => {
      const f = await nativeFixture(child);
      const earlierExpiry = "2098-01-01T00:00:00.000Z";
      if (earlier === "job") f.sqlite.prepare("UPDATE document_jobs SET expires_at=? WHERE job_id=?").run(earlierExpiry, NATIVE_JOB);
      else f.sqlite.prepare("UPDATE private_content SET expires_at=? WHERE content_id=?").run(earlierExpiry, CONTENT);
      const before = f.changes();
      const response = await f.readCompletion();
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      const receipt = await response.json();
      assert.deepEqual(receipt, { schemaVersion: 1, kind: "native-short-story-completion", handle: f.handle,
        selection: f.select(0), expiresAt: earlierExpiry });
      assert.match(receipt.selection.contentSha256, /^[a-f0-9]{64}$/u);
      assert.notEqual(receipt.selection.contentSha256, digest(initialBody().content_markdown));
      assert.equal(JSON.stringify(receipt).includes(initialBody().title), false);
      assert.equal(JSON.stringify(receipt).includes(initialBody().content_markdown), false);
      assert.equal(f.changes(), before);
      assert.equal(f.calls.length, 5);
      assert.equal(f.calls.filter(sql => sql.includes("story_job AS")).length, 2);
      assert.equal(f.calls.filter(sql => sql.includes("expected_events AS")).length, 1);
      assert.equal(f.calls.some(sql => /(?:private_json|artifact_revisions)/u.test(sql)), false);
      assert.equal(f.rawReads.length, 1);
    });
  }
});

test("native completion denies pending, failed and mismatched native job associations before history or raw reads", async t => {
  const faults = [
    ...["queued", "running", "committing", "partial", "failed", "canceled"].map(status => [status, { job: { status } }]),
    ["wrong-owner", { job: { owner_id: "another-owner" } }],
    ["wrong-document", { job: { document_id: "another-document" } }],
    ["wrong-stream", { job: { stream_id: "creative:another-owner" } }],
    ["wrong-kind", { job: { kind: "generate" } }],
    ["wrong-surface", { job: { source_surface: "experience" } }],
    ["wrong-job-correlation", { job: { correlation_id: "another-correlation" } }],
    ["wrong-completion-correlation", { completionCorrelation: "another-correlation" }],
    ["wrong-completion-stream", { completionStream: "creative:another-owner" }],
    ["wrong-completion-actor", { completionActor: "user" }],
    ["wrong-completion-client", { completionClient: "server:policy" }],
    ["expired-job", { job: { expires_at: "2020-01-01T00:00:00.000Z" } }],
    ["error-on-completed-job", { job: { error_message: "Unconfirmed completion" } }],
    ["missing-completed-at", { job: { completed_at: null } }],
    ["managed-request", { request: { productionMode: "managed" } }],
    ["multi-item-request", { request: { itemCount: 2 } }],
    ["wrong-request-kind", { request: { artifactKind: "slides" } }],
    ["output-execution-request", { request: { outputExecution: {} } }],
    ["workflow-request", { request: { workflowId: "workflow-one" } }],
    ["wrong-result-kind", { result: { artifactKind: "slides" } }],
    ["unappended-completion", { result: { appendedEventIds: ["another-event"] } }],
    ["duplicate-append-id", { duplicateAppendId: true }],
  ];
  for (const [fault, options] of faults) {
    await t.test(fault, async child => {
      const f = await nativeFixture(child, options);
      if (options.request) f.sqlite.prepare("UPDATE document_jobs SET request_json=? WHERE job_id=?")
        .run(JSON.stringify({ ...f.jobRequest, ...options.request }), NATIVE_JOB);
      if (options.result || options.duplicateAppendId) f.sqlite.prepare("UPDATE document_jobs SET result_json=? WHERE job_id=?")
        .run(JSON.stringify({ ...f.jobResult, ...options.result,
          ...(options.duplicateAppendId ? { appendedEventIds: [f.completion.eventId, f.completion.eventId] } : {}) }), NATIVE_JOB);
      const before = f.changes();
      const response = await f.readCompletion();
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: "retained_story_unavailable" });
      assert.equal(f.calls.some(sql => sql.includes("event_base AS")), false);
      assert.deepEqual(f.rawReads, []);
      assert.equal(f.changes(), before);
    });
  }
});

test("native completion rejects source mismatch, edits and source custody before materializing retained bytes", async t => {
  for (const fault of ["wrong-artifact", "wrong-source-document", "wrong-source-kind", "edited", "source-erased", "source-owner", "source-scoped"]) {
    await t.test(fault, async child => {
      const f = await nativeFixture(child, { kind: fault === "wrong-source-kind" ? "slides" : "short_story",
        ...(fault === "wrong-source-document" ? { completionPayload: { document_id: "another-document" } } : {}) });
      if (fault === "wrong-artifact") f.sqlite.prepare("UPDATE document_jobs SET result_json=? WHERE job_id=?")
        .run(JSON.stringify({ ...f.jobResult, artifactId: "another-artifact" }), NATIVE_JOB);
      else if (fault === "edited") await f.append("DocumentArtifactEdited", { artifact_id: ARTIFACT, content_ref: CONTENT,
        revision: 1, content_sha256: digest(f.raw()), edited_by_user_id: OWNER });
      else if (fault === "source-erased") f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at=? WHERE private_event_id=?")
        .run(new Date().toISOString(), f.completion.eventId);
      else if (fault === "source-owner") f.sqlite.prepare("UPDATE event_private_payloads SET owner_id='another-owner' WHERE private_event_id=?")
        .run(f.completion.eventId);
      else if (fault === "source-scoped") f.sqlite.prepare("INSERT INTO project_event_scopes VALUES(?,?,?,?,?,?,?,?,?,?)")
        .run(f.completion.eventId, "native-tenant-access", "tenant", PROJECT, OWNER, `creative:${OWNER}`, 2, 1, OWNER, new Date().toISOString());
      const before = f.changes();
      const response = await f.readCompletion();
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: "retained_story_unavailable" });
      assert.equal(f.calls.some(sql => sql.includes("event_base AS")), true);
      assert.equal(f.calls.some(sql => sql.startsWith("SELECT content,expires_at")), false);
      assert.deepEqual(f.rawReads, []);
      assert.equal(f.changes(), before);
    });
  }
});

test("native completion bounds result JSON, job metadata and append IDs before reading source history", async t => {
  for (const fault of ["result-bytes", "projection-bytes", "append-count", "expiry-bytes"]) {
    await t.test(fault, async child => {
      const f = await nativeFixture(child);
      if (fault === "expiry-bytes") f.sqlite.prepare("UPDATE document_jobs SET expires_at=? WHERE job_id=?")
        .run("z".repeat(128 * 1024), NATIVE_JOB);
      else {
        const result = { ...f.jobResult };
        if (fault === "result-bytes") result.unused = "a".repeat(128 * 1024);
        else result.appendedEventIds = [f.completion.eventId, ...Array.from({ length: fault === "append-count" ? 128 : 127 }, (_, index) =>
          fault === "projection-bytes" ? `event-${index}-` + "a".repeat(149) : `event-${index}`)];
        f.sqlite.prepare("UPDATE document_jobs SET result_json=? WHERE job_id=?").run(JSON.stringify(result), NATIVE_JOB);
      }
      const before = f.changes();
      assert.equal((await f.readCompletion()).status, 404);
      assert.equal(f.calls.some(sql => sql.includes("event_base AS")), false);
      assert.deepEqual(f.rawReads, []);
      assert.equal(f.changes(), before);
    });
  }
});

test("native completion final witness rejects changed authority, job, source bytes, expiry and edits before response", async t => {
  for (const fault of ["role", "cohort-expiry", "job-status", "job-request", "job-artifact", "job-append-id", "job-expiry", "source-bytes", "source-expiry", "source-redaction", "source-edit", "source-custody"]) {
    await t.test(fault, async child => {
      const f = await nativeFixture(child);
      if (fault === "cohort-expiry") {
        const now = new Date().toISOString();
        f.sqlite.prepare("INSERT INTO organizations VALUES(?,?,?,?,?,?)").run("native-org", "Native org", "another-owner", "active", now, now);
        f.sqlite.prepare("INSERT INTO pilot_cohorts(cohort_id,organization_id,status,starts_at,ends_at,created_by_user_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
          .run("native-cohort", "native-org", "active", "2020-01-01T00:00:00.000Z", EXPIRY, OWNER, now, now);
        f.sqlite.prepare("INSERT INTO pilot_participants(participant_id,cohort_id,organization_id,email_normalized,user_id,status,invited_by_user_id,created_at) VALUES(?,?,?,?,?,?,?,?)")
          .run("native-participant", "native-cohort", "native-org", EMAIL, OWNER, "active", OWNER, now);
        f.env.FORMA_PILOT_COHORT_ID = "native-cohort";
      }
      let finalEntered = 0, afterMutation = null;
      f.setBeforeRead(async sql => {
        if (!sql.includes("expected_events AS")) return;
        finalEntered++;
        if (fault === "role") f.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id=?").run(OWNER);
        else if (fault === "cohort-expiry") f.sqlite.prepare("UPDATE pilot_cohorts SET ends_at='2020-01-01T00:00:00.000Z' WHERE cohort_id='native-cohort'").run();
        else if (fault === "job-status") f.sqlite.prepare("UPDATE document_jobs SET status='partial' WHERE job_id=?").run(NATIVE_JOB);
        else if (fault === "job-request") f.sqlite.prepare("UPDATE document_jobs SET request_json=? WHERE job_id=?")
          .run(JSON.stringify({ ...f.jobRequest, productionMode: "managed" }), NATIVE_JOB);
        else if (fault === "job-artifact" || fault === "job-append-id") f.sqlite.prepare("UPDATE document_jobs SET result_json=? WHERE job_id=?")
          .run(JSON.stringify({ ...f.jobResult, ...(fault === "job-artifact" ? { artifactId: "another-artifact" } : { appendedEventIds: ["another-event"] }) }), NATIVE_JOB);
        else if (fault === "job-expiry") f.sqlite.prepare("UPDATE document_jobs SET expires_at='2020-01-01T00:00:00.000Z' WHERE job_id=?").run(NATIVE_JOB);
        else if (fault === "source-bytes") f.replace(f.raw().replace("A retained story", "B retained story"));
        else if (fault === "source-expiry") f.sqlite.prepare("UPDATE private_content SET expires_at='2020-01-01T00:00:00.000Z' WHERE content_id=?").run(CONTENT);
        else if (fault === "source-redaction") f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at=? WHERE private_event_id=?")
          .run(new Date().toISOString(), f.completion.eventId);
        else if (fault === "source-edit") await f.append("DocumentArtifactEdited", { artifact_id: ARTIFACT, content_ref: CONTENT,
          revision: 1, content_sha256: digest(f.raw()), edited_by_user_id: OWNER });
        else f.sqlite.prepare("INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,actor_user_id,created_at) VALUES(?,?,?,?,?,?,?,?)")
          .run("native-late-tenant", "content", CONTENT, "tenant", PROJECT, OWNER, OWNER, new Date().toISOString());
        afterMutation = f.changes();
      });
      const response = await f.readCompletion();
      assert.equal(finalEntered, 1, "authorization, native job, source history, bytes and full hash must succeed first");
      assert.equal(f.rawReads.length, 1);
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: "retained_story_unavailable" });
      assert.equal(f.changes(), afterMutation, "the endpoint must add no writes after the fixture's intervening mutation");
    });
  }
});

test("native completion requires current hosted personal authorization and rejects invalid dispatch shapes", async t => {
  for (const fault of ["missing-principal", "changed-email", "project-context", "wrong-method", "extra-query"]) {
    await t.test(fault, async child => {
      const f = await nativeFixture(child);
      let request = f.completionRequest(), expected;
      if (fault === "missing-principal") { request = new Request(request.url); expected = 401; }
      else if (fault === "changed-email") { request = f.completionRequest({ "oai-authenticated-user-email": "changed@example.test" }); expected = 403; }
      else if (fault === "project-context") { request = f.completionRequest({ cookie: "forma_project_context=selected" }); expected = 403; }
      else if (fault === "wrong-method") { request = f.completionRequest({}, "POST"); expected = 405; }
      else { request = new Request(`${request.url}?newest=1`, { headers: request.headers }); expected = 400; }
      const before = f.changes();
      assert.equal((await handleRetainedStoryRead(request, f.env)).status, expected);
      assert.equal(f.calls.some(sql => sql.includes("story_job AS") || sql.includes("event_base AS")), false);
      assert.deepEqual(f.rawReads, []);
      assert.equal(f.changes(), before);
    });
  }
});

const nativeOutputBody = () => ({
  title: "  Native <title>\r\nمرحبا  ", summary: "Private source summary",
  content_markdown: "\ufeff# Native scene\r\n\r\n  Last <script>literal</script>\t\n",
  presentation: null,
  items: [{ title: "  Authored slide  ", body: "\ufeffFirst\r\n\r\n  Last <>&\t\n",
    notes: "Private presenter notes", image_prompt: "Private image direction", slide: null }],
});

test("native retained Scene and Slides read the exact current source hash without writes or media", async t => {
  for (const output of ["scene", "slides"]) {
    await t.test(output, async child => {
      const f = await fixture(child, { kind: output, completionPayload: { scene_medium: "visual" } });
      const source = nativeOutputBody();
      f.replace(source);
      const before = f.changes();
      const response = await f.readNative(output);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      const expectedContent = output === "scene"
        ? { content_markdown: source.content_markdown, medium: null }
        : { items: [{ ...source.items[0], notes: "", image_prompt: "" }], presentation: null };
      assert.deepEqual(await response.json(), { schemaVersion: 1, kind: "native-retained-output", output,
        selection: f.select(), title: source.title, expiresAt: EXPIRY, content: expectedContent });
      assert.notEqual(f.select().contentSha256, digest(source.content_markdown));
      assert.equal(f.changes(), before);
      assert.equal(f.calls.length, 4);
      assert.equal(f.calls.filter(sql => sql.includes("expected_events AS")).length, 1);
      assert.equal(f.calls.some(sql => /(?:private_json|artifact_revisions|document_jobs)/u.test(sql)), false);
      assert.equal(f.rawReads.length, 1);
    });
  }
});

test("native retained Slides preserve authored literals and public citations while excluding private evidence", async t => {
  const f = await fixture(t, { kind: "slides" });
  const source = nativeOutputBody();
  source.presentation = { aspectRatio: "16:9", theme: "Authored theme", footerLabel: "  Footer <>&  ",
    stylePreset: "gallery", mode: "light", palette: {
      background: "#f5f3ee", foreground: "#18201c", accent: "#d66a3d", muted: "#667069", surface: "#ffffff",
    } };
  source.items[0].context_group_ids = ["private-context-group"];
  source.items[0].slide = {
    layout: "quote", kicker: "  Literal kicker\r\n  ", bullets: ["  First <>&  ", "\ufeffSecond\r\nline\t"],
    sourceIds: ["private-slide-source"], section: "  Authored section  ", sourceOrder: 7,
    quote: { text: "  Quoted <text>\r\n  ", speaker: "  Speaker  ", role: "  Role  ",
      sourceId: "private-quote-source", citation: "Public Research Journal" },
    citations: [
      { sourceId: "private-citation-source", label: "Public Research Journal", anchor: "p. 4", excerpt: "Private full citation excerpt" },
      { sourceId: "private-internal-source", label: "Internal source brief", anchor: "Private notes", excerpt: "Private internal excerpt" },
    ],
    visual: { kind: "metric", label: "  Literal metric  ", value: "  12%  ", exactValue: "12.000", displayValue: "  12%  ", unit: "%",
      data: [{ label: "  Datum  ", value: "  12  ", weight: 0.12, exactValue: "12.000", displayValue: "  12  ",
        sourceIds: ["private-datum-source"] }] },
  };
  source.items.push({ title: "  Final slide\r\n  ", body: "\ufeffComplete final body <>&\t\n",
    notes: "Private second notes", image_prompt: "Private second direction", slide: null });
  f.replace(source);
  const originalRaw = f.raw(), before = f.changes();
  const response = await f.readNative("slides");
  assert.equal(response.status, 200);
  const dto = await response.json(), items = dto.content.items;
  assert.equal(dto.title, source.title);
  assert.deepEqual(dto.content.presentation, source.presentation);
  assert.equal(items.length, 2);
  for (let index = 0; index < items.length; index++) {
    assert.equal(items[index].title, source.items[index].title);
    assert.equal(items[index].body, source.items[index].body);
    assert.equal(items[index].notes, "");
    assert.equal(items[index].image_prompt, "");
  }
  const slide = items[0].slide;
  assert.equal(slide.kicker, source.items[0].slide.kicker);
  assert.equal(slide.section, source.items[0].slide.section);
  assert.equal(Object.hasOwn(slide, "sourceOrder"), false);
  assert.deepEqual(slide.bullets, source.items[0].slide.bullets);
  assert.deepEqual(slide.quote, { text: source.items[0].slide.quote.text, speaker: source.items[0].slide.quote.speaker,
    role: source.items[0].slide.quote.role, citation: "Public Research Journal" });
  assert.deepEqual(slide.citations, [{ label: "Public Research Journal", anchor: "p. 4", excerpt: "" }]);
  const { sourceIds: ignoredSources, ...datum } = source.items[0].slide.visual.data[0];
  const { sourceIds: deliveredSources, ...deliveredDatum } = slide.visual.data[0];
  assert.deepEqual(deliveredDatum, datum);
  for (const key of ["kind", "label", "value", "exactValue", "displayValue", "unit"]) {
    assert.equal(slide.visual[key], source.items[0].slide.visual[key]);
  }
  const encoded = JSON.stringify(dto);
  for (const privateText of ["private-context-group", "private-slide-source", "private-quote-source", "private-citation-source",
    "private-internal-source", "private-datum-source", "Private presenter notes", "Private image direction",
    "Private full citation excerpt", "Private internal excerpt", "Private second notes", "Private second direction", source.summary]) {
    assert.equal(encoded.includes(privateText), false, `private evidence must not be transported: ${privateText}`);
  }
  assert.equal(f.raw(), originalRaw, "audience projection must leave retained source bytes intact");
  assert.equal(f.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(CONTENT).content, originalRaw);
  assert.equal(f.changes(), before);
});

test("native retained Scene excludes private completion medium and ignores retained content metadata", async t => {
  for (const [name, completionPayload, requestedMedium] of [
    ["visual", { scene_medium: "visual" }, "visual"],
    ["audio", { scene_medium: "audio" }, "audio"],
    ["settings visual", { settings: { scene_medium: "visual" } }, "visual"],
    ["settings audio", { settings: { scene_medium: "audio" } }, "audio"],
    ["missing", {}, null],
  ]) {
    await t.test(name, async child => {
      const f = await fixture(child, { kind: "scene", completionPayload });
      const source = { ...nativeOutputBody(), scene_medium: requestedMedium === "audio" ? "visual" : "audio",
        settings: { scene_medium: requestedMedium === "audio" ? "visual" : "audio" } };
      f.replace(source);
      const publicPayload = JSON.parse(f.sqlite.prepare("SELECT payload FROM events WHERE event_id=?").get(f.completion.eventId).payload);
      const privatePayload = JSON.parse(f.sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=?")
        .get(f.completion.eventId).private_json);
      for (const key of ["scene_medium", "settings"]) {
        assert.equal(Object.hasOwn(publicPayload, key), false, "the normal writer excludes private completion metadata from public history");
        assert.equal(Object.hasOwn(privatePayload, key), Object.hasOwn(completionPayload, key));
        if (Object.hasOwn(completionPayload, key)) assert.deepEqual(privatePayload[key], completionPayload[key]);
      }
      const before = f.changes(), response = await f.readNative("scene");
      assert.equal(response.status, 200);
      const dto = await response.json();
      assert.deepEqual(dto.content, { content_markdown: source.content_markdown, medium: null });
      assert.equal(f.changes(), before);
      assert.equal(f.calls.some(sql => /\bprivate_json\b/u.test(sql)), false);
    });
  }
});

test("native retained outputs select edits exactly and reject historical or cross-target reads", async t => {
  for (const output of ["scene", "slides"]) {
    await t.test(output, async child => {
      const f = await fixture(child, { kind: output });
      f.replace(nativeOutputBody());
      const original = f.select();
      const edited = nativeOutputBody();
      edited.title = "  Current edited title  ";
      edited.content_markdown = "\ufeffCurrent edited scene\r\n";
      edited.items[0].body = "\ufeffCurrent edited slide\r\n";
      f.replace(edited);
      await f.append("DocumentArtifactEdited", { artifact_id: ARTIFACT, content_ref: CONTENT, revision: 1,
        content_sha256: digest(f.raw()), edited_by_user_id: OWNER });
      const before = f.changes(), response = await f.readNative(output, f.select(1));
      assert.equal(response.status, 200);
      const dto = await response.json();
      assert.deepEqual(dto.selection, f.select(1));
      assert.equal(dto.title, edited.title);
      assert.equal(output === "scene" ? dto.content.content_markdown : dto.content.items[0].body,
        output === "scene" ? edited.content_markdown : edited.items[0].body);
      for (const selection of [original, f.select(1, original.contentSha256), f.select(2),
        { ...f.select(1), documentId: "another-document" }, { ...f.select(1), artifactId: "another-artifact" }]) {
        assert.equal((await f.readNative(output, selection)).status, 404);
      }
      assert.equal((await f.readNative(output === "scene" ? "slides" : "scene", f.select(1))).status, 404);
      assert.equal((await f.read(f.select(1))).status, 404, "the retained Short Story route must remain kind-specific");
      assert.equal(f.changes(), before);
      assert.equal(f.calls.some(sql => /(?:artifact_revisions|document_jobs)/u.test(sql)), false);
    });
  }
});

test("native retained outputs require the existing hosted personal owner and reject project or source custody", async t => {
  for (const output of ["scene", "slides"]) {
    for (const fault of ["missing", "project-context", "other-principal", "role", "source-owner", "scoped-project", "scoped-content", "scoped-event", "source-erased", "removed-document", "wrong-kind"]) {
      await t.test(`${output}: ${fault}`, async child => {
        const f = await fixture(child, { kind: fault === "wrong-kind" ? "short_story" : output });
        f.replace(nativeOutputBody());
        const now = new Date().toISOString();
        let request = f.requestNative(output), expected = 404;
        if (fault === "missing") { request = new Request(request.url); expected = 401; }
        else if (fault === "project-context") { request = f.requestNative(output, f.select(), { cookie: "forma_project_context=selected" }); expected = 403; }
        else if (fault === "other-principal") { request = f.requestNative(output, f.select(), { "oai-authenticated-user-id": "another-owner" }); expected = 403; }
        else if (fault === "role") { f.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id=?").run(OWNER); expected = 403; }
        else if (fault === "source-owner") f.sqlite.prepare("UPDATE private_content SET owner_id='another-owner' WHERE content_id=?").run(CONTENT);
        else if (fault === "scoped-project") f.sqlite.prepare("INSERT INTO organization_projects VALUES(?,?,?,?,?,?,?)")
          .run("native-output-access", PROJECT, "tenant", OWNER, "active", now, now);
        else if (fault === "scoped-content") f.sqlite.prepare("INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,actor_user_id,created_at) VALUES(?,?,?,?,?,?,?,?)")
          .run("native-output-access", "content", CONTENT, "tenant", PROJECT, OWNER, OWNER, now);
        else if (fault === "scoped-event") f.sqlite.prepare("INSERT INTO project_event_scopes VALUES(?,?,?,?,?,?,?,?,?,?)")
          .run(f.completion.eventId, "native-output-access", "tenant", PROJECT, OWNER, `creative:${OWNER}`, 2, 1, OWNER, now);
        else if (fault === "source-erased") f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at=? WHERE private_event_id=?").run(now, f.completion.eventId);
        else if (fault === "removed-document") await f.append("DocumentRemoved", {});
        const before = f.changes(), response = await handleNativeRetainedOutputRead(request, f.env);
        assert.equal(response.status, expected);
        assert.equal(f.changes(), before);
        assert.deepEqual(await response.json(), { error: fault === "missing" ? "authentication_required"
          : fault === "project-context" ? "personal_principal_required"
            : expected === 403 ? "retained_story_access_denied" : "retained_story_unavailable" });
        assert.equal(f.calls.some(sql => sql.includes("expected_events AS")), false);
      });
    }
  }
});

test("native retained outputs reject malformed and oversized source before a positive final witness", async t => {
  for (const output of ["scene", "slides"]) {
    for (const fault of ["malformed-json", "nonrecord", "raw-bytes", "title-bytes", "expiry-bytes", "output-shape"]) {
      await t.test(`${output}: ${fault}`, async child => {
        const f = await fixture(child, { kind: output });
        const source = nativeOutputBody();
        if (fault === "malformed-json") f.replace('{"title":');
        else if (fault === "nonrecord") f.replace([]);
        else if (fault === "raw-bytes") f.replace({ ...source, unused: "a".repeat(1_000_000) });
        else if (fault === "title-bytes") f.replace({ ...source, title: "a".repeat(80_001) });
        else if (fault === "expiry-bytes") {
          f.replace(source);
          f.sqlite.prepare("UPDATE private_content SET expires_at=? WHERE content_id=?").run("z".repeat(1_000_000), CONTENT);
        } else f.replace(output === "scene" ? { ...source, content_markdown: "a".repeat(512_001) }
          : { ...source, items: [{ ...source.items[0], body: { untrusted: "body" } }] });
        const before = f.changes(), response = await f.readNative(output);
        assert.equal(response.status, fault === "malformed-json" ? 503 : 404);
        assert.deepEqual(await response.json(), { error: "retained_story_unavailable" });
        assert.equal(f.changes(), before);
        assert.equal(f.calls.some(sql => sql.includes("expected_events AS")), false);
        if (fault === "raw-bytes" || fault === "expiry-bytes") assert.deepEqual(f.rawReads, [null], "SQL must deny raw materialization before projection");
      });
    }
  }
});

test("native retained outputs recheck authority, exact bytes, source events, expiry and custody at the final read", async t => {
  for (const output of ["scene", "slides"]) {
    for (const fault of ["role", "consent", "same-length-content", "expiry", "source-redaction", "source-completion", "new-revision", "custody"]) {
      await t.test(`${output}: ${fault}`, async child => {
        const f = await fixture(child, { kind: output, completionPayload: { scene_medium: "visual" } });
        f.replace(nativeOutputBody());
        let finalEntered = 0, afterMutation = null;
        f.setBeforeRead(async sql => {
          if (!sql.includes("expected_events AS")) return;
          finalEntered++;
          if (fault === "role") f.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id=?").run(OWNER);
          else if (fault === "consent") f.sqlite.prepare("UPDATE users SET consent_version='old' WHERE user_id=?").run(OWNER);
          else if (fault === "same-length-content") f.replace(f.raw().replace("Native <title>", "Edited <title>"));
          else if (fault === "expiry") f.sqlite.prepare("UPDATE private_content SET expires_at='2020-01-01T00:00:00.000Z' WHERE content_id=?").run(CONTENT);
          else if (fault === "source-redaction") f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at=? WHERE private_event_id=?")
            .run(new Date().toISOString(), f.completion.eventId);
          else if (fault === "source-completion") {
            const originalPayload = f.sqlite.prepare("SELECT payload FROM events WHERE event_id=?").get(f.completion.eventId).payload;
            assert.throws(() => f.sqlite.prepare("UPDATE events SET payload=? WHERE event_id=?")
              .run(JSON.stringify({ ...JSON.parse(originalPayload), scene_medium: "audio" }), f.completion.eventId), /events are append-only/u);
            assert.equal(f.sqlite.prepare("SELECT payload FROM events WHERE event_id=?").get(f.completion.eventId).payload, originalPayload);
            await f.append("DocumentRenderCompleted", { artifact_id: ARTIFACT, artifact_kind: output,
              content_ref: CONTENT, requested_by_user_id: OWNER });
          } else if (fault === "new-revision") await f.append("DocumentArtifactEdited", { artifact_id: ARTIFACT, content_ref: CONTENT,
            revision: 1, content_sha256: digest(f.raw()), edited_by_user_id: OWNER });
          else f.sqlite.prepare("INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,actor_user_id,created_at) VALUES(?,?,?,?,?,?,?,?)")
            .run("native-output-late-tenant", "artifact", ARTIFACT, "tenant", PROJECT, OWNER, OWNER, new Date().toISOString());
          afterMutation = f.changes();
        });
        const response = await f.readNative(output);
        assert.equal(finalEntered, 1, "initial authority, exact source selection, content projection and hash must succeed first");
        assert.equal(f.rawReads.length, 1);
        assert.equal(response.status, 404);
        assert.deepEqual(await response.json(), { error: "retained_story_unavailable" });
        assert.equal(f.changes(), afterMutation, "only the explicit intervening fixture mutation may write");
      });
    }
  }
});

test("native retained output dispatch rejects unsupported methods and malformed selectors before any database read", async t => {
  for (const output of ["scene", "slides"]) {
    await t.test(output, async child => {
      const f = await fixture(child, { kind: output });
      assert.equal((await handleNativeRetainedOutputRead(f.requestNative(output, f.select(), {}, "POST"), f.env)).status, 405);
      const valid = f.requestNative(output);
      for (const url of [valid.url + "&revision=0", valid.url + "&extra=1", valid.url.replace("sha256=", "hash="),
        valid.url.replace(`/retained-output/${output}/`, "/retained-output/short_story/")]) {
        assert.equal((await handleNativeRetainedOutputRead(new Request(url, { headers: valid.headers }), f.env)).status, 400);
      }
      assert.equal(f.calls.length, 0);
    });
  }
});


// One Scene association extension of the existing declared, read-only API fixture.
// Synthetic completed rows are endpoint controls, not evidence of actual admission/generation.
async function nativeSceneFixture(t, options = {}) {
  const consent = { version: "scene-cost-v1", confirmed: true, requestId: NATIVE_JOB,
    actorUserId: OWNER, documentId: DOCUMENT, productionMode: "manual", itemCount: 1, ...options.consent };
  const jobRequest = { artifactKind: "scene", productionMode: "manual", sceneRequestId: NATIVE_JOB,
    sceneCostConsent: consent, ...options.request };
  const correlationId = `${NATIVE_JOB}:attempt:1`;
  const f = await nativeFixture(t, { kind: "scene", completionPayload: { scene_medium: "visual", ...options.completionPayload },
    completionCorrelation: options.completionCorrelation ?? correlationId,
    completionActor: options.completionActor, completionClient: options.completionClient, beforeCompletion: options.beforeCompletion,
    job: { request_json: JSON.stringify(jobRequest), correlation_id: correlationId, ...options.job } });
  const jobResult = { ...f.jobResult, artifactKind: "scene", ...options.result };
  f.sqlite.prepare("UPDATE document_jobs SET result_json=? WHERE job_id=?").run(JSON.stringify(jobResult), NATIVE_JOB);
  const sceneRequest = (headers = {}, method = "GET") => new Request(`https://forma.test${nativeSceneCompletionPath(f.handle)}`, {
    method, headers: { "oai-authenticated-user-id": OWNER, "oai-authenticated-user-email": EMAIL, ...headers },
  });
  return { ...f, jobRequest, jobResult, sceneRequest,
    readSceneCompletion: (headers = {}) => handleNativeRetainedOutputRead(sceneRequest(headers), f.env) };
}

test("native Scene completion binds omitted or numeric one count to the original job and current reader without writes", async t => {
  for (const request of [{}, { itemCount: 1 }]) await t.test(Object.hasOwn(request, "itemCount") ? "numeric one" : "automatic count absent", async child => {
    const f = await nativeSceneFixture(child, { request }), before = f.changes();
    const response = await f.readSceneCompletion(); assert.equal(response.status, 200);
    const receipt = await response.json();
    assert.deepEqual(receipt, { schemaVersion: 1, kind: "native-scene-completion", handle: f.handle,
      selection: f.select(0), expiresAt: EXPIRY });
    assert.deepEqual(validateNativeSceneCompletion(receipt, f.handle), receipt);
    const route = nativeSceneRetainedRoute(receipt, f.handle);
    assert.deepEqual(parseNativeRetainedOutputRoute(route), { output: "scene", selection: f.select(0) });
    assert.notEqual(f.sqlite.prepare("SELECT correlation_id FROM document_jobs WHERE job_id=?").get(NATIVE_JOB).correlation_id, NATIVE_JOB, "Scene uses its actual attempt correlation, not an invented job-ID correlation");
    assert.equal(f.calls.length, 5); assert.equal(f.rawReads.length, 1);
    assert.equal(f.calls.filter(sql => sql.includes("story_job AS")).length, 2);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(JSON.stringify(receipt).includes(initialBody().content_markdown), false);
    const read = await f.readNative("scene", receipt.selection); assert.equal(read.status, 200);
    assert.equal((await read.json()).content.content_markdown, initialBody().content_markdown);
    assert.equal(f.changes(), before);
    assert.equal((await f.readCompletion()).status, 404, "the unchanged Story completion endpoint rejects the Scene job");
  });
});

test("native Scene completion rejects non-one counts and mismatched original consent before source reads", async t => {
  const faults = [
    ["requested two", { request: { itemCount: 2 } }], ["requested string one", { request: { itemCount: "1" } }],
    ["requested null", { request: { itemCount: null } }], ["requested boolean", { request: { itemCount: true } }],
    ["consent missing", { request: { sceneCostConsent: undefined } }], ["consent count missing", { consent: { itemCount: undefined } }],
    ["consent count two", { consent: { itemCount: 2 } }], ["consent count string", { consent: { itemCount: "1" } }],
    ["consent count null", { consent: { itemCount: null } }], ["consent unconfirmed", { consent: { confirmed: false } }],
    ["consent numeric confirmation", { consent: { confirmed: 1 } }], ["consent wrong version", { consent: { version: "scene-cost-v0" } }],
    ["wrong original request", { request: { sceneRequestId: "another-request" } }], ["consent wrong request", { consent: { requestId: "another-request" } }],
    ["consent wrong actor", { consent: { actorUserId: "another-owner" } }], ["consent wrong document", { consent: { documentId: "another-document" } }],
    ["consent managed", { consent: { productionMode: "managed" } }],
  ];
  for (const [name, options] of faults) await t.test(name, async child => {
    const f = await nativeSceneFixture(child, options), before = f.changes();
    const response = await f.readSceneCompletion(); assert.equal(response.status, 404);
    assert.equal(f.rawReads.length, 0); assert.equal(f.changes(), before);
  });
});

test("native Scene completion stays manual, Document-only and separate from workflows and other outputs", async t => {
  for (const [name, options] of [
    ["managed", { request: { productionMode: "managed" } }], ["workflow", { request: { workflowId: "workflow-one" } }],
    ["orphan workflow stage", { request: { workflowStageId: "scene-final" } }], ["workflow sources", { request: { workflowSources: [] } }],
    ["output execution", { request: { outputExecution: {} } }], ["canvas surface", { job: { source_surface: "canvas" } }],
    ["queued", { job: { status: "queued" } }], ["partial", { job: { status: "partial" } }],
    ["Story request", { request: { artifactKind: "short_story" } }], ["Story result", { result: { artifactKind: "short_story" } }],
    ["wrong artifact", { result: { artifactId: "other-artifact" } }],
    ["wrong attempt correlation", { completionCorrelation: "different-scene-attempt" }],
    ["wrong completion actor", { completionActor: "user" }], ["wrong completion client", { completionClient: "another-client" }],
    ["completion absent from append IDs", { result: { appendedEventIds: ["another-event"] } }],
  ]) await t.test(name, async child => {
    const f = await nativeSceneFixture(child, options), before = f.changes();
    assert.equal((await f.readSceneCompletion()).status, 404);
    assert.equal(f.rawReads.length, 0); assert.equal(f.changes(), before);
  });
});

test("native Scene completion requires one actual current retained item and the earlier current expiry", async t => {
  for (const [name, alter, expected] of [
    ["no items", f => f.replace({ ...initialBody(), items: [] }), 404],
    ["two items", f => f.replace({ ...initialBody(), items: [...initialBody().items, ...initialBody().items] }), 404],
    ["earlier job", f => f.sqlite.prepare("UPDATE document_jobs SET expires_at=? WHERE job_id=?").run("2098-01-01T00:00:00.000Z", NATIVE_JOB), 200],
    ["earlier source", f => f.sqlite.prepare("UPDATE private_content SET expires_at=? WHERE content_id=?").run("2098-01-01T00:00:00.000Z", CONTENT), 200],
  ]) await t.test(name, async child => {
    const f = await nativeSceneFixture(child); alter(f); const before = f.changes();
    const response = await f.readSceneCompletion(); assert.equal(response.status, expected);
    if (expected === 200) assert.equal((await response.json()).expiresAt, "2098-01-01T00:00:00.000Z");
    assert.equal(f.changes(), before);
  });
});

test("native Scene completion final witness rejects changed Scene association, source, authorization and current revision", async t => {
  for (const fault of ["consent-count", "request-count", "job-status", "job-artifact", "attempt-correlation", "source-bytes", "source-edit", "role"]) await t.test(fault, async child => {
    const f = await nativeSceneFixture(child); let entered = 0, afterMutation;
    f.setBeforeRead(async sql => {
      if (!sql.includes("expected_events AS")) return; entered++;
      if (fault === "consent-count" || fault === "request-count") f.sqlite.prepare("UPDATE document_jobs SET request_json=? WHERE job_id=?")
        .run(JSON.stringify({ ...f.jobRequest, ...(fault === "request-count" ? { itemCount: 2 }
          : { sceneCostConsent: { ...f.jobRequest.sceneCostConsent, itemCount: 2 } }) }), NATIVE_JOB);
      else if (fault === "job-status") f.sqlite.prepare("UPDATE document_jobs SET status='partial' WHERE job_id=?").run(NATIVE_JOB);
      else if (fault === "attempt-correlation") f.sqlite.prepare("UPDATE document_jobs SET correlation_id=? WHERE job_id=?").run("changed-scene-attempt", NATIVE_JOB);
      else if (fault === "job-artifact") f.sqlite.prepare("UPDATE document_jobs SET result_json=? WHERE job_id=?")
        .run(JSON.stringify({ ...f.jobResult, artifactId: "another-artifact" }), NATIVE_JOB);
      else if (fault === "source-bytes") f.replace(f.raw().replace("A retained story", "B retained story"));
      else if (fault === "source-edit") await f.append("DocumentArtifactEdited", { artifact_id: ARTIFACT, content_ref: CONTENT,
        revision: 1, content_sha256: digest(f.raw()), edited_by_user_id: OWNER });
      else f.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id=?").run(OWNER);
      afterMutation = f.changes();
    });
    assert.equal((await f.readSceneCompletion()).status, 404); assert.equal(entered, 1);
    assert.equal(f.rawReads.length, 1); assert.equal(f.changes(), afterMutation);
  });
});

test("native Scene completion rejects malformed dispatch and wrong methods before database work", async t => {
  const f = await nativeSceneFixture(t), before = f.changes();
  for (const path of ["/api/retained-output/scene/jobs/one", "/api/retained-output/slides/jobs/one/two/extra",
    "/api/retained-output/scene/jobs/one/two?", "/api/retained-output/scene/jobs/one/two?revision=0"]) {
    assert.equal((await handleNativeRetainedOutputRead(new Request("https://forma.test" + path), f.env)).status, 400);
  }
  assert.equal((await handleNativeRetainedOutputRead(f.sceneRequest({}, "POST"), f.env)).status, 405);
  assert.equal(f.calls.length, 0); assert.equal(f.changes(), before);
});


test("native Story and Scene completion bind the current bounded attempt instead of the job ID or another completion", async t => {
  for (const [kind, factory, read] of [
    ["Story", nativeFixture, f => f.readCompletion()], ["Scene", nativeSceneFixture, f => f.readSceneCompletion()],
  ]) {
    await t.test(`${kind} accepts current attempt eight`, async child => {
      const correlation = `${NATIVE_JOB}:attempt:8`;
      const f = await factory(child, { job: { attempt_count: 8, correlation_id: correlation }, completionCorrelation: correlation });
      assert.equal((await read(f)).status, 200);
    });
    for (const [name, attempt, correlation] of [
      ["bare job ID", 1, NATIVE_JOB], ["arbitrary correlation", 1, "unrelated-correlation"],
      ["prior attempt", 2, `${NATIVE_JOB}:attempt:1`], ["zero attempts", 0, `${NATIVE_JOB}:attempt:0`],
      ["over attempt limit", 9, `${NATIVE_JOB}:attempt:9`], ["noncanonical attempt", 1, `${NATIVE_JOB}:attempt:01`],
    ]) await t.test(`${kind} rejects ${name}`, async child => {
      const f = await factory(child, { job: { attempt_count: attempt, correlation_id: correlation }, completionCorrelation: correlation });
      const before = f.changes(); assert.equal((await read(f)).status, 404);
      assert.equal(f.rawReads.length, 0); assert.equal(f.changes(), before);
    });
    await t.test(`${kind} rechecks its exact attempt at the final witness`, async child => {
      const f = await factory(child); let entered = 0, afterMutation;
      f.setBeforeRead(sql => {
        if (!sql.includes("expected_events AS")) return; entered++;
        f.sqlite.prepare("UPDATE document_jobs SET attempt_count=2,correlation_id=? WHERE job_id=?")
          .run(`${NATIVE_JOB}:attempt:2`, NATIVE_JOB);
        afterMutation = f.changes();
      });
      assert.equal((await read(f)).status, 404); assert.equal(entered, 1);
      assert.equal(f.rawReads.length, 1); assert.equal(f.changes(), afterMutation);
    });
  }
});


// An actual earlier retained artifact is present before the current attempt's
// completion. These are protocol fixture rows, not another generation run.
function earlierNativeAttempt(captured) {
  return async (env, stream, payload) => {
    const raw = JSON.stringify({ ...initialBody(), title: "Earlier attempt result" });
    await env.DB.prepare("INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at) VALUES(?,?,?,?,?,?,NULL)")
      .bind("earlier-attempt-content", OWNER, "document-artifact", raw, new Date().toISOString(), EXPIRY).run();
    const event = makeEvent(stream, 0, "worker:renderer", "server:document-job:render_document", `${NATIVE_JOB}:attempt:1`,
      "DocumentRenderCompleted", { ...payload, artifact_id: "earlier-attempt-artifact", content_ref: "earlier-attempt-content" });
    await appendEvents(env, [event]); captured.eventId = event.eventId;
  };
}
const nativeCompletionKinds = [
  ["Story", nativeFixture, f => f.readCompletion()], ["Scene", nativeSceneFixture, f => f.readSceneCompletion()],
];

test("native Story and Scene completion selects current attempt two despite an earlier retained attempt one artifact", async t => {
  for (const [kind, factory, read] of nativeCompletionKinds) await t.test(kind, async child => {
    const earlier = {}, correlation = `${NATIVE_JOB}:attempt:2`;
    const f = await factory(child, { beforeCompletion: earlierNativeAttempt(earlier), completionCorrelation: correlation,
      job: { attempt_count: 2, correlation_id: correlation } });
    const before = f.changes(), response = await read(f); assert.equal(response.status, 200);
    const receipt = await response.json(); assert.deepEqual(receipt.selection, f.select(0));
    assert.equal(receipt.selection.artifactId, ARTIFACT); assert.notEqual(receipt.selection.artifactId, "earlier-attempt-artifact");
    assert.ok(earlier.eventId); assert.equal(f.jobResult.appendedEventIds.includes(earlier.eventId), false);
    assert.equal(f.rawReads.length, 1); assert.equal(f.rawReads[0].content, f.raw()); assert.equal(f.changes(), before);
  });
});

test("native Story and Scene completion rejects other attempts, stale IDs and duplicate current completion before content reads", async t => {
  for (const [kind, factory, read] of nativeCompletionKinds) for (const fault of ["previous-completion", "future-completion", "other-job-completion", "stale-artifact", "stale-append-id", "duplicate-current"]) {
    await t.test(`${kind} ${fault}`, async child => {
      const earlier = {}, correlation = `${NATIVE_JOB}:attempt:2`;
      const completionCorrelation = fault === "previous-completion" ? `${NATIVE_JOB}:attempt:1`
        : fault === "future-completion" ? `${NATIVE_JOB}:attempt:3`
        : fault === "other-job-completion" ? "another-job:attempt:2" : correlation;
      const f = await factory(child, { beforeCompletion: earlierNativeAttempt(earlier), completionCorrelation,
        job: { attempt_count: 2, correlation_id: correlation } });
      if (fault === "stale-artifact" || fault === "stale-append-id") f.sqlite.prepare("UPDATE document_jobs SET result_json=? WHERE job_id=?")
        .run(JSON.stringify({ ...f.jobResult, ...(fault === "stale-artifact" ? { artifactId: "earlier-attempt-artifact" }
          : { appendedEventIds: [earlier.eventId] }) }), NATIVE_JOB);
      if (fault === "duplicate-current") {
        const event = makeEvent(`creative:${OWNER}`, 0, "worker:renderer", "server:document-job:render_document", correlation,
          "DocumentRenderCompleted", { project_id: PROJECT, document_id: DOCUMENT, artifact_id: "duplicate-current-artifact",
            artifact_kind: kind === "Story" ? "short_story" : "scene", requested_by_user_id: OWNER,
            title: "Duplicate current completion", content_ref: CONTENT, item_count: 1 });
        await appendEvents({ ...f.env, DB: f.DB }, [event]);
      }
      const before = f.changes(); assert.equal((await read(f)).status, 404);
      assert.equal(f.rawReads.length, 0); assert.equal(f.changes(), before);
    });
  }
});

test("native Story and Scene completion rechecks isolated correlation or attempt-count change at the final witness", async t => {
  for (const [kind, factory, read] of nativeCompletionKinds) for (const fault of ["correlation", "attempt-count"]) await t.test(`${kind} ${fault}`, async child => {
    const f = await factory(child); let entered = 0, afterMutation;
    f.setBeforeRead(sql => {
      if (!sql.includes("expected_events AS")) return; entered++;
      if (fault === "correlation") f.sqlite.prepare("UPDATE document_jobs SET correlation_id=? WHERE job_id=?").run(`${NATIVE_JOB}:attempt:2`, NATIVE_JOB);
      else f.sqlite.prepare("UPDATE document_jobs SET attempt_count=2 WHERE job_id=?").run(NATIVE_JOB);
      afterMutation = f.changes();
    });
    assert.equal((await read(f)).status, 404); assert.equal(entered, 1);
    assert.equal(f.rawReads.length, 1); assert.equal(f.changes(), afterMutation);
  });
});
