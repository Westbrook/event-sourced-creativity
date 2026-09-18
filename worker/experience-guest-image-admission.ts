import { canonicalJson, record } from "../src/experiences/compiler.ts";
import { createGuestImageAdmissionAuthority, requireGuestImageAdmissionFrame, guestImageAdmissionInternal,
  prepareGuestImageAdmissionBlueprint, guestImageAdmissionSuccessor, guestImageAdmissionReceipt,
  type GuestImageAdmissionAuthority, type GuestImageAdmissionBlueprint } from "./experience-guest-image-admission-witness.ts";
import type { GuestImageOutputInput } from "./experience-guest-image-stage-witness.ts";
import { prepareGuestImageAdmission } from "./output-document-execution.ts";
import { denseGuestImageAcknowledgement } from "./experience-guest-image-confirmation.ts";
import { outputAssertionStatements } from "./output-command-core.ts";
import { EVENT_WRITE_COLUMNS, eventWriteBindings } from "./event-write-primitives.ts";
import { guestFail } from "./experience-guest-session.ts";
import type { WorkerEnv } from "./runtime.ts";

const fail = (part: string): never => guestFail(`image_admission_${part}`);
type Internal = ReturnType<typeof guestImageAdmissionInternal>;
function acknowledgementErrorsAbsent(results: unknown) {
  if (!Array.isArray(results)) return false;
  for (let index=0;index<results.length;index++) {
    const item=Object.getOwnPropertyDescriptor(results,index);
    if (!item || !Object.hasOwn(item,"value") || !record(item.value)) return false;
    const value=item.value;
    if ("error" in value) { const error=Object.getOwnPropertyDescriptor(value,"error");
      if (!error || !Object.hasOwn(error,"value") || error.value!==undefined) return false; }
  }
  return true;
}

function originalTuple(request: Request, env: WorkerEnv, authority: GuestImageAdmissionAuthority) {
  const f = requireGuestImageAdmissionFrame(request, env, authority), internal = guestImageAdmissionInternal(request, env, authority);
  return canonicalJson({ slot: f.slot, createdAt: f.createdAt, expiresAt: f.expiresAt, period: f.period, commandKey: f.commandKey,
    actorUserId: f.actorUserId, ownerUserId: f.ownerUserId, payerUserId: f.payerUserId, streamId: f.streamId,
    projectId: f.projectId, documentId: f.documentId, sourceHead: f.sourceHead, planSourceHead: f.planSourceHead, quoteHead: f.quoteHead,
    issuerGrantId: internal.issuerGrantId, envelopeDigest: internal.compiled.envelopeDigest, policyDigest: internal.compiled.policyDigest });
}

async function original(request: Request, env: WorkerEnv, authority: GuestImageAdmissionAuthority,
  tuple: string, blueprint: GuestImageAdmissionBlueprint, replayed: boolean) {
  const internal = guestImageAdmissionInternal(request, env, authority);
  const recovered = await internal.wait(() => createGuestImageAdmissionAuthority(request, env, internal.base, internal.deadline));
  internal.check();
  const latest = guestImageAdmissionInternal(request, env, recovered), frame = requireGuestImageAdmissionFrame(request, env, recovered);
  if (frame.state !== "admitted" || !latest.blueprint || originalTuple(request, env, recovered) !== tuple
    || canonicalJson(latest.blueprint) !== canonicalJson(blueprint)) return fail("original_unavailable");
  const receipt = guestImageAdmissionReceipt(request, env, recovered, replayed);
  latest.check(); internal.check(); return receipt;
}

/** The dynamic limits are the existing native sponsor policy predicates. This
 * leaf uses the already compiled genuine v3 grant; the complete native graph
 * and distinct N+1 plan/N+3 quote are proved by its own final witness. */
function consumptionStatement(env: WorkerEnv, internal: Internal, jobId: string) {
  const { policy, envelope, policyDigest, envelopeDigest, policyJson } = internal.compiled, recipe = envelope.recipe;
  return env.DB.prepare(`WITH instant(now_ms) AS (
      SELECT CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))
    INSERT INTO experience_sponsor_consumptions(consumption_id,grant_id,campaign_id,actor_user_id,session_digest,intent_key,envelope_digest,job_id,maximum_microusd,admitted_at_ms)
    SELECT ?,grant_row.grant_id,campaign.campaign_id,grant_row.actor_user_id,grant_row.session_digest,grant_row.intent_key,grant_row.envelope_digest,?,?,instant.now_ms
    FROM instant JOIN experience_sponsor_campaigns campaign JOIN experience_sponsor_grants grant_row ON grant_row.campaign_id=campaign.campaign_id
    WHERE campaign.campaign_id=? AND campaign.enabled=1 AND campaign.policy_digest=? AND campaign.policy_json=?
      AND grant_row.grant_id=? AND grant_row.enabled=1 AND grant_row.policy_digest=campaign.policy_digest
      AND grant_row.actor_user_id=? AND grant_row.session_digest=? AND grant_row.intent_key=? AND grant_row.envelope_digest=?
      AND grant_row.issued_at_ms=? AND grant_row.expires_at_ms=? AND grant_row.issued_at_ms<=instant.now_ms AND grant_row.expires_at_ms>instant.now_ms
      AND ?<=instant.now_ms AND ?>instant.now_ms
      AND (SELECT COUNT(*) FROM experience_sponsor_consumptions used WHERE used.campaign_id=campaign.campaign_id)<?
      AND (SELECT COALESCE(SUM(used.maximum_microusd),0) FROM experience_sponsor_consumptions used WHERE used.campaign_id=campaign.campaign_id)<=?-?
      AND (SELECT COUNT(*) FROM experience_sponsor_consumptions used WHERE used.campaign_id=campaign.campaign_id AND used.actor_user_id=grant_row.actor_user_id)<?
      AND (SELECT COUNT(*) FROM experience_sponsor_consumptions used WHERE used.campaign_id=campaign.campaign_id AND used.admitted_at_ms>instant.now_ms-?)<?
      AND (SELECT COUNT(*) FROM experience_sponsor_consumptions used WHERE used.campaign_id=campaign.campaign_id AND used.actor_user_id=grant_row.actor_user_id AND used.admitted_at_ms>instant.now_ms-?)<?`)
    .bind(envelope.consumptionId, jobId, recipe.maximumMicrousd,
      policy.campaignId, policyDigest, policyJson, internal.issuerGrantId, envelope.actorUserId, envelope.sessionDigest, envelope.intentKey, envelopeDigest,
      envelope.issuedAtMs, envelope.expiresAtMs, policy.startsAtMs, policy.expiresAtMs,
      policy.maximumAdmissions, policy.maximumMicrousd, recipe.maximumMicrousd, policy.maximumAdmissionsPerActor,
      policy.windowMs, policy.maximumAdmissionsPerWindow, policy.windowMs, policy.maximumAdmissionsPerActorWindow);
}

async function admit(request: Request, env: WorkerEnv, authority: GuestImageAdmissionAuthority) {
  const supplied = guestImageAdmissionInternal(request, env, authority);
  // Every invocation observes the original source again. An earlier capability
  // is never permission to write a second native graph after a committed call.
  const observed = await supplied.wait(() => createGuestImageAdmissionAuthority(request, env, supplied.base, supplied.deadline));
  supplied.check();
  const internal = guestImageAdmissionInternal(request, env, observed), frame = requireGuestImageAdmissionFrame(request, env, observed);
  if (frame.state === "admitted") {
    const receipt = guestImageAdmissionReceipt(request, env, observed, true);
    internal.check(); supplied.check(); return receipt;
  }
  if (frame.state !== "issued" || internal.blueprint || !internal.beforeAssertions.length) return fail("issued_original_required");
  const prepared = await internal.wait(() => prepareGuestImageAdmission(request, env, observed)); internal.check(); supplied.check();
  const blueprint = await internal.wait(() => prepareGuestImageAdmissionBlueprint(request, env, observed, prepared.job)); internal.check(); supplied.check();
  const successor = await internal.wait(() => guestImageAdmissionSuccessor(request, env, observed, blueprint)); internal.check(); supplied.check();
  if (!prepared.sourceAssertions.length || !successor.length) return fail("complete_proof_required");
  const native = prepared.buildStatements([blueprint.queue]); internal.check(); supplied.check();
  if (!native.statements.length || !native.assertions.length) return fail("native_preparation_required");
  const tuple = originalTuple(request, env, observed), slot = frame.slot, database = env.DB;
  const statements = [...internal.beforeAssertions, ...prepared.sourceAssertions].flatMap(assertion => outputAssertionStatements(env, assertion));
  const eventIndexes: number[] = [];
  for (const event of [blueprint.queue, blueprint.authorization]) {
    eventIndexes.push(statements.length);
    statements.push(database.prepare(`INSERT INTO event_write_stage(${EVENT_WRITE_COLUMNS}) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(...eventWriteBindings(event)));
  }
  const exact: number[] = [];
  const addExact = (statement: D1PreparedStatement) => { exact.push(statements.length); statements.push(statement); };
  addExact(database.prepare("INSERT INTO output_execution_grants(scope_key,grant_id,plan_revision_id,actor_user_id,payer_user_id,context_id,preflight_id,authorization_event_id,maximum_microusd,maximum_calls,status,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,'authorized',?,?)")
    .bind(frame.scope.key, slot.grantId, slot.planRevisionId, frame.actorUserId, frame.payerUserId, null,
      frame.preflight.id, blueprint.authorization.eventId, slot.maximumMicrousd, slot.maximumCalls, frame.expiresAt, frame.createdAt));
  addExact(database.prepare(`INSERT INTO output_operation_slots(scope_key,slot_id,grant_id,plan_revision_id,target_id,target_contract_digest,source_digest,provider,model,route_digest,job_id,cost_reservation_id,token_reservation_id,maximum_microusd,maximum_calls,maximum_tokens,attempt_ordinal,previous_slot_id,status,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'authorized',?,?)`).bind(slot.scopeKey, slot.slotId, slot.grantId, slot.planRevisionId,
      slot.targetId, slot.targetContractDigest, slot.sourceDigest, slot.provider, slot.model, slot.routeDigest, slot.jobId,
      slot.costReservationId, slot.tokenReservationId, slot.maximumMicrousd, slot.maximumCalls, slot.maximumTokens, slot.attemptOrdinal, slot.previousSlotId, frame.createdAt, frame.createdAt));
  const calls = frame.preflight.targets[0]?.settings.calls;
  if (!Array.isArray(calls) || calls.length !== 2 || calls.length !== slot.maximumCalls
    || calls.some(call => !record(call) || typeof call.stage !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(call.stage)
      || typeof call.provider !== "string" || !call.provider || typeof call.model !== "string" || !call.model)
    || new Set(calls.map(call => call.stage)).size !== calls.length) return fail("native_routes_required");
  for (const call of calls) addExact(database.prepare("INSERT INTO output_operation_routes(scope_key,slot_id,stage_key,provider,model,maximum_calls) VALUES(?,?,?,?,?,1)")
    .bind(slot.scopeKey, slot.slotId, call.stage, call.provider, call.model));
  statements.push(...native.statements);
  addExact(consumptionStatement(env, internal, slot.jobId));
  statements.push(...outputAssertionStatements(env, { sql: "changes()=1" }));
  addExact(database.prepare("INSERT INTO experience_sponsor_active_jobs(actor_user_id,consumption_id,job_id) VALUES(?,?,?)")
    .bind(frame.actorUserId, internal.compiled.envelope.consumptionId, slot.jobId));
  addExact(database.prepare("INSERT INTO output_commands(scope_key,actor_user_id,command_key,request_digest,action,event_id,created_at) VALUES(?,?,?,?,'authorize',?,?)")
    .bind(frame.scope.key, frame.actorUserId, frame.commandKey, blueprint.commandDigest, blueprint.authorization.eventId, frame.createdAt));
  statements.push(...[...native.assertions, ...successor].flatMap(assertion => outputAssertionStatements(env, assertion)));
  internal.check(); supplied.check();
  try {
    const results = await internal.wait(() => database.batch(statements)); internal.check(); supplied.check();
    if (!acknowledgementErrorsAbsent(results) || !denseGuestImageAcknowledgement(results, statements.length, exact, eventIndexes[0])
      || !denseGuestImageAcknowledgement(results, statements.length, exact, eventIndexes[1])) return fail("acknowledgement_unavailable");
  } catch (error) {
    internal.check(); supplied.check();
    // A missing/malformed ACK is never retried. Only a fresh complete read of
    // these same source, job, slot, holds, events and original timestamps wins.
    try { const result = await original(request, env, observed, tuple, blueprint, true); internal.check(); supplied.check(); return result; }
    catch { internal.check(); supplied.check(); throw error; }
  }
  const result = await original(request, env, observed, tuple, blueprint, false); internal.check(); supplied.check(); return result;
}

/** Dormant entry: the owner's exact Promise settles under the original seal. */
export function admitGuestImage(request: Request, env: WorkerEnv, authority: GuestImageAdmissionAuthority) {
  return admit(request, env, authority);
}

async function read(request: Request, env: WorkerEnv, base: GuestImageOutputInput) {
  const authority = await createGuestImageAdmissionAuthority(request, env, base);
  const internal = guestImageAdmissionInternal(request, env, authority), frame = requireGuestImageAdmissionFrame(request, env, authority);
  if (frame.state === "issued") { internal.check(); return null; }
  const receipt = guestImageAdmissionReceipt(request, env, authority, true); internal.check(); return receipt;
}
/** Metadata only; null is a fully proved original issued-but-unadmitted state. */
export function readGuestImageAdmission(request: Request, env: WorkerEnv, base: GuestImageOutputInput) {
  return read(request, env, base);
}
