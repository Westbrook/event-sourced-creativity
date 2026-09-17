import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { outputTestDatabase, registerOutputSourceImports } from "../output-server-test-helpers.mjs";

const imports = registerOutputSourceImports();
let ensureSchema, appendAuditEvent, appendEvents, makeEvent, OUTPUT_REQUIREMENTS_SCHEMA;
try {
  ({ ensureSchema, appendAuditEvent, appendEvents, makeEvent } = await import("../../worker/runtime.ts"));
  ({ OUTPUT_REQUIREMENTS_SCHEMA } = await import("../../worker/output-requirements-schema.ts"));
} finally { imports.deregister(); }

export const OWNER = "selected-share-owner";
export const EMAIL = "selected-share-owner@example.test";
export const DOCUMENT = "selected-share-document";
export const PROJECT = "selected-share-personal-project";
export const ARTIFACT = "selected-share-artifact";
export const CONTENT = "selected-share-content";
export const JOB = "selected-share-native-job";
export const POLICY = "pilot-2026-08-10";
export const EXPIRY = "2099-01-01T00:00:00.000Z";
export const PURPOSE = "selected-output-read-v1";
export const LITERAL = "\ufeff  مرحبا 日本語\r\n\n![source](/api/media/private-input.png)\n"
  + "<img src='https://untrusted.invalid/pixel'><script>literal()</script>\n"
  + "[open](javascript:alert(1)) https://untrusted.invalid/no-fetch  ";
export const digest = value => createHash("sha256").update(value, "utf8").digest("hex");

export const nativeContent = () => ({ title: "PRIVATE_NATIVE_TITLE", summary: "PRIVATE_SUMMARY",
  content_markdown: LITERAL, presentation: null, prompt: "PRIVATE_PROMPT", memory: "PRIVATE_MEMORY",
  items: [{ title: "Audience slide", body: LITERAL, notes: "PRIVATE_NOTES", image_prompt: "PRIVATE_IMAGE_PROMPT",
    context_group_ids: ["PRIVATE_CONTEXT"], slide: null }] });

/** Real production DDL, event/private custody and native lineage. All records
 * are synthetic; the transport guards forbid providers, media and unrelated writes.
 * The detached share schema is installed only by this test fixture.
 */
export async function selectedOutputShareFixture(t, options = {}) {
  const state = outputTestDatabase();
  t.after(() => state.sqlite.close());
  await ensureSchema(state.env);
  for (const sql of OUTPUT_REQUIREMENTS_SCHEMA) state.sqlite.exec(sql);
  if (options.installShareSchema !== false) {
    const source = registerOutputSourceImports();
    try {
      const { SELECTED_OUTPUT_SHARE_SCHEMA } = await import("../../worker/selected-output-share-schema.ts");
      for (const sql of SELECTED_OUTPUT_SHARE_SCHEMA) state.sqlite.exec(sql);
    } finally { source.deregister(); }
  }
  const now = new Date().toISOString(), kind = options.kind ?? "short_story";
  const insert = (table, row) => state.sqlite.prepare(`INSERT INTO ${table}(${Object.keys(row).join(",")}) VALUES(${Object.keys(row).map(() => "?").join(",")})`).run(...Object.values(row));
  insert("users", { user_id: OWNER, email: EMAIL, display_name: "Synthetic canonical owner", role: "creator",
    consent_version: POLICY, consented_at: now, created_at: now, updated_at: now });
  const stream = `creative:${OWNER}`;
  const append = (type, payload = {}, actor = "user") => appendAuditEvent(state.env, stream, actor, type,
    { document_id: DOCUMENT, project_id: PROJECT, ...payload });
  const created = await append("DocumentCreated", { title: "PRIVATE_DOCUMENT_TITLE" });
  await append("BlockCreated", { block_id: "private-source", type: "direction", handle: "private/source", scope: "document",
    properties: { text: "PRIVATE_SOURCE_WORDING", media_url: "/api/media/private-source.png", email: "private@example.test", claim_token: "PRIVATE_CLAIM_TOKEN" } });

  const slot = { scopeKey: `personal:${OWNER}:${DOCUMENT}`, grantId: "selected-share-grant", slotId: "selected-share-slot",
    planRevisionId: "selected-share-plan-revision", targetId: "selected-share-target",
    targetContractDigest: `sha256:${"c".repeat(64)}`, sourceDigest: `sha256:${"d".repeat(64)}` };
  const routeDigest = `sha256:${"e".repeat(64)}`;
  let planEvent, preflightEvent, authorization;
  if (options.slot) {
    planEvent = await append("OutputPlanConfirmed", { plan_revision_id: slot.planRevisionId, source_digest: slot.sourceDigest });
    preflightEvent = await append("OutputPreflightCompleted", { preflight_id: "selected-share-preflight", plan_revision_id: slot.planRevisionId });
    authorization = makeEvent(stream, 0, options.authorizationActor ?? `user:${OWNER}`, options.authorizationClientId ?? "server:output-requirements", "selected-share-authorization", "OutputExecutionAuthorized", {
      project_id: PROJECT, document_id: DOCUMENT, actor_user_id: OWNER, grant_id: slot.grantId,
      plan_revision_id: slot.planRevisionId, preflight_id: "selected-share-preflight", source_digest: slot.sourceDigest,
      maximum_microusd: 1000, maximum_calls: 1,
      authorized_targets: [{ target_id: slot.targetId, operation_slot_id: slot.slotId, job_id: JOB, route_digest: routeDigest }],
      output_command_envelope: { action: "authorize", documentId: DOCUMENT, clientMutationId: "selected-share-authorization",
        preflightId: "selected-share-preflight", termsDigest: `sha256:${"f".repeat(64)}`, maximumMicrousd: 1000,
        explicitAuthorization: true, expectedRevision: `output:${state.sqlite.prepare("SELECT MAX(sequence) AS head FROM events WHERE stream_id=?").get(stream).head}`,
        ...(options.slot === "sponsor" ? { sponsor_entitlement: { consumption_id: "synthetic-consumption" } } : {}) },
    });
    await appendEvents(state.env, [authorization]);
  }
  const completion = makeEvent(stream, 0, options.completionActor ?? "worker:renderer", options.completionClientId ?? "server:document-job:render_document", `${JOB}:attempt:1`, "DocumentRenderCompleted", {
    document_id: DOCUMENT, project_id: PROJECT, artifact_id: ARTIFACT, artifact_kind: kind,
    requested_by_user_id: OWNER, title: "PRIVATE_COMPLETION_TITLE", content_ref: CONTENT, item_count: 1,
    ...(kind === "scene" ? { medium: "visual" } : {}), ...options.completionPayload,
  });
  await appendEvents(state.env, [completion]);
  let raw = JSON.stringify(options.content ?? nativeContent());
  insert("private_content", { content_id: CONTENT, owner_id: OWNER, kind: "document-artifact", content: raw,
    created_at: now, expires_at: options.sourceExpiresAt ?? EXPIRY, redacted_at: null });
  const jobRequest = { artifactKind: kind, productionMode: "manual", itemCount: 1,
    ...(options.slot ? { outputExecution: slot } : {}), ...options.request };
  const jobResult = { artifactKind: kind, artifactId: ARTIFACT, appendedEventIds: [completion.eventId],
    ...(options.slot ? { outputExecution: slot } : {}), ...options.result };
  insert("document_jobs", { job_id: JOB, owner_id: OWNER, stream_id: stream, document_id: DOCUMENT, kind: "render_document",
    status: "completed", source_surface: options.slot ? "outputs" : "document", correlation_id: `${JOB}:attempt:1`,
    requested_sequence: completion.sequence - 1, request_json: JSON.stringify(jobRequest), result_json: JSON.stringify(jobResult),
    error_message: null, attempt_count: 1, requested_at: now, started_at: now, completed_at: now,
    expires_at: options.jobExpiresAt ?? EXPIRY, updated_at: now, ...options.job });
  if (options.slot) {
    insert("output_plan_revisions", { scope_key: slot.scopeKey, scope_kind: "personal", owner_user_id: OWNER, project_id: PROJECT,
      document_id: DOCUMENT, organization_id: null, project_access_id: null, plan_revision_id: slot.planRevisionId,
      plan_id: "selected-share-plan", revision: 1, confirmed_event_id: planEvent.eventId, requirements_digest: `sha256:${"b".repeat(64)}`,
      source_digest: slot.sourceDigest, resolver_version: "synthetic-resolver", source_head: created.sequence, target_count: 1, created_at: now });
    insert("output_plan_targets", { scope_key: slot.scopeKey, plan_revision_id: slot.planRevisionId, target_id: slot.targetId,
      target_contract_digest: slot.targetContractDigest, media_kind: kind === "slides" ? "slides" : "document", required: 1, selected: 1, ordinal: 0 });
    insert("output_preflights", { scope_key: slot.scopeKey, preflight_id: "selected-share-preflight", plan_revision_id: slot.planRevisionId,
      actor_user_id: OWNER, terms_digest: `sha256:${"f".repeat(64)}`, event_id: preflightEvent.eventId, expires_at: EXPIRY, created_at: now });
    insert("output_execution_grants", { scope_key: slot.scopeKey, grant_id: slot.grantId, plan_revision_id: slot.planRevisionId,
      actor_user_id: OWNER, payer_user_id: options.slot === "sponsor" ? "synthetic-sponsor" : OWNER, context_id: null,
      preflight_id: "selected-share-preflight", authorization_event_id: authorization.eventId, maximum_microusd: 1000, maximum_calls: 1,
      status: "completed", expires_at: EXPIRY, created_at: now });
    insert("output_operation_slots", { scope_key: slot.scopeKey, slot_id: slot.slotId, grant_id: slot.grantId,
      plan_revision_id: slot.planRevisionId, target_id: slot.targetId, target_contract_digest: slot.targetContractDigest,
      source_digest: slot.sourceDigest, provider: "synthetic", model: "synthetic-text", route_digest: routeDigest, job_id: JOB,
      cost_reservation_id: "synthetic-cost-reservation", token_reservation_id: "synthetic-token-reservation", maximum_microusd: 1000,
      maximum_calls: 1, maximum_tokens: 100, attempt_ordinal: 0, previous_slot_id: null, status: "succeeded",
      outcome_event_id: completion.eventId, created_at: now, updated_at: now });
  }

  const calls = [], statements = [];
  let beforeStatement = null, afterStatement = null;
  const DB = {
    prepare(sql) {
      assert.ok(Buffer.byteLength(sql, "utf8") <= 100_000, "D1 SQL text limit");
      assert.match(sql, /^\s*(?:WITH|SELECT|INSERT\s+INTO\s+selected_output_shares\b|UPDATE\s+selected_output_shares\b)/iu,
        "production share calls may only read custody or write the dedicated share table");
      const prepared = state.DB.prepare(sql);
      function statement(values) {
        const underlying = prepared.bind(...values);
        return {
          sql, underlying,
          bind(...bindings) { assert.ok(bindings.length <= 100, "D1 bound parameter limit"); return statement(bindings); },
          async invoke(mode) {
            calls.push(sql); statements.push({ sql, bindings: [...values], mode });
            if (beforeStatement) await beforeStatement(sql, values, mode);
            const result = await underlying[mode]();
            if (afterStatement) await afterStatement(sql, values, mode, result);
            return result;
          },
          async first() { return this.invoke("first"); },
          async all() { return this.invoke("all"); },
          async run() { return this.invoke("run"); },
        };
      }
      return statement([]);
    },
    async batch(batch) {
      for (const statement of batch) {
        calls.push(statement.sql); statements.push({ sql: statement.sql, mode: "batch" });
        if (beforeStatement) await beforeStatement(statement.sql, [], "batch");
      }
      return state.DB.batch(batch.map(statement => statement.underlying));
    },
  };
  const env = { ...state.env, DB, MEDIA: new Proxy({}, { get() { throw new Error("selected share must not enter MEDIA"); } }),
    ASSETS: { fetch() { throw new Error("selected share must not enter ASSETS"); } } };
  const selection = (revision = 0, hash = digest(raw)) => ({ output: kind, documentId: DOCUMENT, artifactId: ARTIFACT,
    revision, contentSha256: hash });
  const review = (patch = {}) => ({ title: "Deliberately selected output", expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(), ...patch });
  const request = (body, headers = {}, method = "POST") => new Request("https://forma.test/detached-selected-output-share", {
    method, headers: { "content-type": "application/json", "oai-authenticated-user-id": OWNER, "oai-authenticated-user-email": EMAIL, ...headers },
    ...(body === undefined || method === "GET" || method === "HEAD" ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
  const replace = value => {
    raw = typeof value === "string" ? value : JSON.stringify(value);
    state.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id=?").run(raw, CONTENT);
  };
  const job = () => state.sqlite.prepare("SELECT * FROM document_jobs WHERE job_id=?").get(JOB);
  const updateJob = patch => state.sqlite.prepare(`UPDATE document_jobs SET ${Object.keys(patch).map(key => `${key}=?`).join(",")} WHERE job_id=?`).run(...Object.values(patch), JOB);
  const installPilot = (patch = {}) => {
    const configured = { cohortId: "selected-share-cohort", organizationId: "selected-share-pilot-org",
      participantId: "selected-share-participant", startsAt: "2020-01-01T00:00:00.000Z",
      endsAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), ...patch };
    insert("organizations", { organization_id: configured.organizationId, name: "Synthetic pilot organization", owner_user_id: "pilot-admin",
      status: "active", created_at: now, updated_at: now });
    insert("pilot_cohorts", { cohort_id: configured.cohortId, organization_id: configured.organizationId, status: "active",
      starts_at: configured.startsAt, ends_at: configured.endsAt, created_by_user_id: "pilot-admin", created_at: now, updated_at: now });
    insert("pilot_participants", { participant_id: configured.participantId, cohort_id: configured.cohortId,
      organization_id: configured.organizationId, email_normalized: EMAIL, user_id: OWNER, status: "active",
      invited_by_user_id: "pilot-admin", created_at: now });
    env.FORMA_PILOT_COHORT_ID = configured.cohortId;
    return configured;
  };
  return { ...state, baseEnv: state.env, env, insert, kind, identity: { userId: OWNER, email: EMAIL, source: "openai-workspace" },
    selection, select: selection, request, review, replace, append, created, completion, authorization, slot, routeDigest, job, updateJob,
    jobRequest, jobResult, calls, statements, installPilot, raw: () => raw, changes: () => state.sqlite.prepare("SELECT total_changes() AS n").get().n,
    setBeforeStatement(value) { beforeStatement = value; }, setAfterStatement(value) { afterStatement = value; },
    shares: () => state.sqlite.prepare("SELECT * FROM selected_output_shares ORDER BY share_id").all() };
}
