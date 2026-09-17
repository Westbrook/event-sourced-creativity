import { nativeMediaFixture, OWNER, EMAIL, DOCUMENT, PROJECT, ARTIFACT, EXPIRY } from "./native-media-custody-fixture.mjs";
import { registerOutputSourceImports } from "../output-server-test-helpers.mjs";
const imports = registerOutputSourceImports();
let OUTPUT_REQUIREMENTS_SCHEMA, makeEvent, appendEvents, readNativeRetainedMediaCustody, readSelectedOutputShareMediaAuthority;
try {
  ({ OUTPUT_REQUIREMENTS_SCHEMA } = await import("../../worker/output-requirements-schema.ts"));
  ({ makeEvent, appendEvents } = await import("../../worker/runtime.ts"));
  ({ readNativeRetainedMediaCustody } = await import("../../worker/native-retained-media-custody.ts"));
  ({ readSelectedOutputShareMediaAuthority } = await import("../../worker/selected-output-share-authority.ts"));
} finally { imports.deregister(); }
export { OWNER, EMAIL, DOCUMENT, PROJECT, ARTIFACT, EXPIRY };
export const JOB = "selected-share-native-media-job";

/** Real native media custody and canonical completed-job provenance. Synthetic
 * setup only; neither a request shim nor a replaced reader can mint the proof.
 * Optional slotted Audio follows the same production grant/envelope shape as
 * the text fixture; specialized original Video/GLB use their dedicated fixture.
 */
export async function selectedOutputShareMediaFixture(t, output, options = {}) {
  const f = await nativeMediaFixture(t, output, options);
  for (const sql of OUTPUT_REQUIREMENTS_SCHEMA) f.sqlite.exec(sql);
  const now = new Date().toISOString(), stream = `creative:${OWNER}`;
  const seedCompletion = (sql, ...bindings) => {
    // Fixture-only normalization before the observation begins. Restore the
    // exact production append-only trigger immediately, including on failure.
    const trigger = f.sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='events_block_update'").get().sql;
    f.sqlite.exec("DROP TRIGGER events_block_update");
    try { f.sqlite.prepare(sql).run(...bindings); } finally { f.sqlite.exec(trigger); }
  };
  const insert = (table, row) => f.sqlite.prepare(`INSERT INTO ${table}(${Object.keys(row).join(",")}) VALUES(${Object.keys(row).map(() => "?").join(",")})`).run(...Object.values(row));
  const slot = { scopeKey: `personal:${OWNER}:${DOCUMENT}`, grantId: "selected-media-grant", slotId: "selected-media-slot",
    planRevisionId: "selected-media-plan", targetId: "selected-media-target", targetContractDigest: `sha256:${"c".repeat(64)}`, sourceDigest: `sha256:${"d".repeat(64)}` };
  const routeDigest = `sha256:${"e".repeat(64)}`, termsDigest = `sha256:${"f".repeat(64)}`;
  let authorization;
  if (options.slot) {
    const planEvent = await f.append("OutputPlanConfirmed", { plan_revision_id: slot.planRevisionId, source_digest: slot.sourceDigest });
    const preflightEvent = await f.append("OutputPreflightCompleted", { preflight_id: "selected-media-preflight", plan_revision_id: slot.planRevisionId });
    authorization = makeEvent(stream, 0, `user:${OWNER}`, "server:output-requirements", "selected-media-authorization", "OutputExecutionAuthorized", {
      project_id: PROJECT, document_id: DOCUMENT, actor_user_id: OWNER, grant_id: slot.grantId,
      plan_revision_id: slot.planRevisionId, preflight_id: "selected-media-preflight", source_digest: slot.sourceDigest,
      maximum_microusd: 1000, maximum_calls: 1,
      authorized_targets: [{ target_id: slot.targetId, operation_slot_id: slot.slotId, job_id: JOB, route_digest: routeDigest }],
      output_command_envelope: { action: "authorize", documentId: DOCUMENT, clientMutationId: "selected-media-authorization",
        preflightId: "selected-media-preflight", termsDigest, maximumMicrousd: 1000, explicitAuthorization: true,
        expectedRevision: `output:${preflightEvent.sequence}` },
    });
    await appendEvents(f.baseEnv, [authorization]);
    // Native completion predates this fixture's added provenance records. Move
    // that same event after its genuine authorization; no reader is replaced.
    f.completion.sequence = authorization.sequence + 1;
    seedCompletion("UPDATE events SET sequence=? WHERE event_id=?", f.completion.sequence, f.completion.eventId);
    f.changePrivate(body => { body.source_surface = "outputs"; });
    insert("output_plan_revisions", { scope_key: slot.scopeKey, scope_kind: "personal", owner_user_id: OWNER, project_id: PROJECT,
      document_id: DOCUMENT, organization_id: null, project_access_id: null, plan_revision_id: slot.planRevisionId,
      plan_id: "selected-media-plan-id", revision: 1, confirmed_event_id: planEvent.eventId, requirements_digest: `sha256:${"b".repeat(64)}`,
      source_digest: slot.sourceDigest, resolver_version: "synthetic", source_head: 1, target_count: 1, created_at: now });
    insert("output_plan_targets", { scope_key: slot.scopeKey, plan_revision_id: slot.planRevisionId, target_id: slot.targetId,
      target_contract_digest: slot.targetContractDigest, media_kind: output, required: 1, selected: 1, ordinal: 0 });
    insert("output_preflights", { scope_key: slot.scopeKey, preflight_id: "selected-media-preflight", plan_revision_id: slot.planRevisionId,
      actor_user_id: OWNER, terms_digest: termsDigest, event_id: preflightEvent.eventId, expires_at: EXPIRY, created_at: now });
    insert("output_execution_grants", { scope_key: slot.scopeKey, grant_id: slot.grantId, plan_revision_id: slot.planRevisionId,
      actor_user_id: OWNER, payer_user_id: OWNER, context_id: null, preflight_id: "selected-media-preflight", authorization_event_id: authorization.eventId,
      maximum_microusd: 1000, maximum_calls: 1, status: "completed", expires_at: EXPIRY, created_at: now });
    insert("output_operation_slots", { scope_key: slot.scopeKey, slot_id: slot.slotId, grant_id: slot.grantId, plan_revision_id: slot.planRevisionId,
      target_id: slot.targetId, target_contract_digest: slot.targetContractDigest, source_digest: slot.sourceDigest,
      provider: "fal", model: "synthetic-owned-media", route_digest: routeDigest, job_id: JOB,
      cost_reservation_id: "synthetic-cost", token_reservation_id: "synthetic-tokens", maximum_microusd: 1000,
      maximum_calls: 1, maximum_tokens: 1000, attempt_ordinal: 0, previous_slot_id: null, status: "succeeded",
      outcome_event_id: f.completion.eventId, created_at: now, updated_at: now });
  }
  seedCompletion("UPDATE events SET actor='worker:renderer',client_id='server:document-job:render_document',correlation_id=? WHERE event_id=?",
    `${JOB}:attempt:1`, f.completion.eventId);
  const request = { artifactKind: output, productionMode: "manual", itemCount: 1, ...(options.slot ? { outputExecution: slot } : {}), ...options.request };
  const result = { artifactKind: output, artifactId: ARTIFACT, appendedEventIds: [f.completion.eventId], ...(options.slot ? { outputExecution: slot } : {}), ...options.result };
  insert("document_jobs", { job_id: JOB, owner_id: OWNER, stream_id: stream, document_id: DOCUMENT, kind: "render_document",
    status: "completed", source_surface: options.slot ? "outputs" : "document", correlation_id: `${JOB}:attempt:1`,
    requested_sequence: f.completion.sequence - 1, request_json: JSON.stringify(request), result_json: JSON.stringify(result),
    error_message: null, attempt_count: 1, requested_at: now, started_at: now, completed_at: now,
    expires_at: options.jobExpiresAt ?? EXPIRY, updated_at: now, ...options.job });
  const readCustody = (selection = f.select(), signal = new AbortController().signal) => readNativeRetainedMediaCustody(f.env, f.identity, selection, signal);
  return { ...f, jobId: JOB, slot, authorization, insert, job: () => f.sqlite.prepare("SELECT * FROM document_jobs WHERE job_id=?").get(JOB),
    updateJob: patch => f.sqlite.prepare(`UPDATE document_jobs SET ${Object.keys(patch).map(key => `${key}=?`).join(",")} WHERE job_id=?`).run(...Object.values(patch), JOB),
    readCustody, authority: async (selection, signal) => readSelectedOutputShareMediaAuthority(f.env, await readCustody(selection, signal)) };
}
