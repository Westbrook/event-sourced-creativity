import { canonicalJson, exactKeys, jsonIssues, record } from "../src/experiences/compiler.ts";
import { sponsorSceneExecutionPaidEvidence, type SponsorExecutionAuthority, type SponsorFinancialBinding } from "./experience-sponsor-execution.ts";
import { SponsorEntitlementError } from "./experience-sponsor-policy.ts";
import { requireSceneSponsorDispatchEvidence, type SceneSponsorDispatchEvidence } from "./output-scene-sponsored-handoff.ts";
import { OutputConflictError, type OutputSqlAssertion } from "./output-command-core.ts";
import { outputProofReadStatements } from "./output-disclosure-proof.ts";
import { claimedSceneBudgetGuard, type ClaimedSceneBudget } from "./pilot-policy.ts";
import { ScenePaidPolicyStopError } from "./scene-paid-dispatch.ts";
import type { PreparedSceneCost } from "./scene-cost-consent.ts";
import type { EventExecutionControl } from "./events-api.ts";
import type { WorkerEnv } from "./runtime.ts";

declare const paidClaim: unique symbol;
/** Server-only handle for one original Scene purchase. It is not a reservation. */
export type SponsorScenePaidClaim = Readonly<{ [paidClaim]: true }>;
export type SponsorSceneOriginalClaimIdentity = Readonly<{
  jobId: string; scopeKey: string; grantId: string; slotId: string;
  streamId: string; correlationId: string; period: string;
  tokenReservationId: string; costReservationId: string;
  reservedTokens: number; reservedMicrousd: number;
}>;
type Identity = SponsorSceneOriginalClaimIdentity & Readonly<{ actorUserId: string; payerUserId: string }>;
type State = {
  env: WorkerEnv; database: WorkerEnv["DB"]; executionAuthority: SponsorExecutionAuthority;
  financial: SponsorFinancialBinding; control: EventExecutionControl; signal: AbortSignal;
  output: EventExecutionControl["output"]; configuration: string; identity: Identity; verificationEpoch: number;
  verified?: { prepared: PreparedSceneCost; evidence: SceneSponsorDispatchEvidence; deadlineMs: number };
};
const claims = new WeakMap<SponsorScenePaidClaim, State>();
const identityKeys = ["jobId", "scopeKey", "grantId", "slotId", "streamId", "correlationId", "period",
  "tokenReservationId", "costReservationId", "reservedTokens", "reservedMicrousd"];
const stringKeys = ["jobId", "scopeKey", "grantId", "slotId", "streamId", "correlationId", "tokenReservationId", "costReservationId"] as const;
const configurationKeys = ["FORMA_USER_TOKEN_LIMIT", "FORMA_WORKSPACE_TOKEN_LIMIT", "FORMA_USER_COST_LIMIT_USD", "FORMA_WORKSPACE_COST_LIMIT_USD"] as const;
const stop = (): never => { throw new ScenePaidPolicyStopError(); };
const own = (value: object, key: PropertyKey): unknown => Object.getOwnPropertyDescriptor(value, key)?.value;
const dataRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
function configuration(env: WorkerEnv) {
  const values = configurationKeys.map(key => env[key]);
  if (values.some(value => value !== undefined && typeof value !== "string")) return stop();
  return JSON.stringify(values);
}
function requireSignal(control: EventExecutionControl, signal: AbortSignal) {
  if (!control || typeof control !== "object" || own(control, "signal") !== signal) return stop();
  // Invoke the platform getter on the retained object. A structural boolean or
  // an own `aborted: false` field cannot impersonate an AbortSignal.
  const getter = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get;
  let aborted: unknown;
  try { aborted = getter?.call(signal); } catch { return stop(); }
  if (aborted !== false) return stop();
}
function sealed<T>(read: () => T): T {
  try { return read(); }
  catch (error) {
    if (error instanceof SponsorEntitlementError || error instanceof OutputConflictError) return stop();
    throw error;
  }
}
function current(state: State) {
  requireSignal(state.control, state.signal);
  if (!state.output || own(state.control, "output") !== state.output || state.env.DB !== state.database
    || configuration(state.env) !== state.configuration) return stop();
  const authority = sealed(() => sponsorSceneExecutionPaidEvidence(state.executionAuthority, state.financial, state.env));
  const identity = state.identity;
  if (authority.actorUserId !== identity.actorUserId || authority.payerUserId !== identity.payerUserId
    || authority.actorUserId === authority.payerUserId || authority.jobId !== identity.jobId
    || authority.scopeKey !== identity.scopeKey || authority.grantId !== identity.grantId || authority.slotId !== identity.slotId
    || authority.tokenReservationId !== identity.tokenReservationId || authority.costReservationId !== identity.costReservationId
    || !Number.isFinite(authority.deadlineMs) || !(authority.deadlineMs > Date.now())) return stop();
  return authority;
}

/** The caller supplies observed IDs, never proof predicates or a billing owner.
 * The sealed financial identity must agree now; SQL certifies the remaining
 * correlation, period and amount fields against that exact slot at dispatch. */
export function createSponsorScenePaidClaim(input: {
  env: WorkerEnv; executionAuthority: SponsorExecutionAuthority; financial: SponsorFinancialBinding;
  runtimeControl: EventExecutionControl; originalClaimIdentity: SponsorSceneOriginalClaimIdentity;
}): SponsorScenePaidClaim {
  const raw: unknown = input.originalClaimIdentity;
  if (jsonIssues(raw).length || !record(raw) || !exactKeys(raw, identityKeys)
    || stringKeys.some(key => typeof raw[key] !== "string" || !raw[key] || raw[key].length > 512)
    || typeof raw.period !== "string" || !/^\d{4}-\d{2}$/u.test(raw.period)
    || raw.reservedTokens !== 128000 || raw.reservedMicrousd !== 1000000) return stop();
  const identity = JSON.parse(canonicalJson(raw)) as SponsorSceneOriginalClaimIdentity;
  const env = input.env, database = env.DB, control = input.runtimeControl, signal = own(control, "signal") as AbortSignal;
  requireSignal(control, signal);
  const config = configuration(env);
  const authority = sealed(() => sponsorSceneExecutionPaidEvidence(input.executionAuthority, input.financial, env));
  const state: State = { env, database, control, signal, output: own(control, "output") as EventExecutionControl["output"], configuration: config, verificationEpoch: 0,
    executionAuthority: input.executionAuthority, financial: input.financial,
    identity: Object.freeze({ ...identity, actorUserId: authority.actorUserId, payerUserId: authority.payerUserId }) };
  current(state);
  const claim = Object.freeze({}) as SponsorScenePaidClaim;
  claims.set(claim, state);
  return claim;
}

/** Captured audit data only, including after a stop. No SQL or live authority is
 * returned. The actor is always the creator; payer provenance has its own key. */
export function sponsorScenePaidClaimIdentity(claim: SponsorScenePaidClaim): Identity {
  const state = claims.get(claim);
  if (!state) return stop();
  return Object.freeze({ ...state.identity });
}

/** Final synchronous continuation check, after the awaited complete proof and
 * immediately before dispatch. It cannot replace a new whole-proof snapshot. */
export function requireSponsorScenePaidDispatchCurrent(claim: SponsorScenePaidClaim): void {
  const state = claims.get(claim);
  if (!state?.verified) return stop();
  const execution = current(state), verified = state.verified;
  const native = sealed(() => requireSceneSponsorDispatchEvidence(verified.evidence, verified.prepared));
  if (!(verified.deadlineMs > Date.now()) || !(execution.deadlineMs > Date.now()) || !(native.deadlineMs > Date.now())) return stop();
  current(state);
}

function sameSlotAssertion(identity: Identity, prepared: PreparedSceneCost,
  native: ReturnType<typeof requireSceneSponsorDispatchEvidence>): OutputSqlAssertion {
  const pin = JSON.stringify({ ...identity, documentId: prepared.binding.documentId,
    projectId: prepared.binding.projectId, provider: native.provider, model: native.model, routeDigest: native.routeDigest });
  return { sql: `EXISTS(SELECT 1 FROM (SELECT ? AS value) pin
    JOIN document_jobs job ON job.job_id=json_extract(pin.value,'$.jobId')
    JOIN output_operation_slots slot ON slot.scope_key=json_extract(pin.value,'$.scopeKey')
      AND slot.slot_id=json_extract(pin.value,'$.slotId') AND slot.job_id=job.job_id
    JOIN output_plan_revisions plan ON plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id
    JOIN output_execution_grants execution ON execution.scope_key=slot.scope_key AND execution.grant_id=slot.grant_id
    JOIN budget_reservations tokens ON tokens.reservation_id=slot.token_reservation_id
    JOIN cost_budget_reservations cost ON cost.reservation_id=slot.cost_reservation_id
    WHERE (job.owner_id,job.stream_id,job.correlation_id,job.document_id,plan.project_id,job.kind,job.source_surface)=
      (json_extract(pin.value,'$.actorUserId'),json_extract(pin.value,'$.streamId'),json_extract(pin.value,'$.correlationId'),
       json_extract(pin.value,'$.documentId'),json_extract(pin.value,'$.projectId'),'render_document','outputs')
    AND job.stream_id='creative:'||job.owner_id AND job.status IN('running','committing')
    AND plan.scope_kind='personal' AND plan.owner_user_id=job.owner_id AND plan.document_id=job.document_id
    AND job.lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND job.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
    AND (slot.grant_id,slot.token_reservation_id,slot.cost_reservation_id,slot.maximum_tokens,slot.maximum_microusd,slot.maximum_calls,
      slot.provider,slot.model,slot.route_digest,slot.attempt_ordinal)=
      (json_extract(pin.value,'$.grantId'),json_extract(pin.value,'$.tokenReservationId'),json_extract(pin.value,'$.costReservationId'),
       json_extract(pin.value,'$.reservedTokens'),json_extract(pin.value,'$.reservedMicrousd'),1,
       json_extract(pin.value,'$.provider'),json_extract(pin.value,'$.model'),json_extract(pin.value,'$.routeDigest'),0)
    AND slot.previous_slot_id IS NULL AND slot.status IN('queued','running')
    AND (execution.actor_user_id,execution.payer_user_id,execution.maximum_microusd,execution.maximum_calls,execution.plan_revision_id)=
      (job.owner_id,json_extract(pin.value,'$.payerUserId'),slot.maximum_microusd,1,slot.plan_revision_id)
    AND execution.actor_user_id<>execution.payer_user_id AND execution.context_id IS NULL
    AND execution.status IN('authorized','active') AND execution.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
    AND (tokens.owner_id,tokens.stream_id,tokens.correlation_id,tokens.period,tokens.reserved_tokens,tokens.operation)=
      (execution.payer_user_id,job.stream_id,job.correlation_id,json_extract(pin.value,'$.period'),slot.maximum_tokens,'document-render:scene')
    AND (cost.owner_id,cost.stream_id,cost.correlation_id,cost.period,cost.reserved_microusd,cost.operation)=
      (tokens.owner_id,tokens.stream_id,tokens.correlation_id,tokens.period,slot.maximum_microusd,tokens.operation)
    AND (SELECT COUNT(*) FROM output_operation_slots sibling WHERE sibling.scope_key=slot.scope_key AND sibling.grant_id=slot.grant_id)=1
    AND (SELECT COUNT(*) FROM output_operation_routes route WHERE route.scope_key=slot.scope_key AND route.slot_id=slot.slot_id)=1
    AND EXISTS(SELECT 1 FROM output_operation_routes route WHERE route.scope_key=slot.scope_key AND route.slot_id=slot.slot_id
      AND (route.stage_key,route.provider,route.model,route.maximum_calls)=('planning:0:initial',slot.provider,slot.model,1)))`, bindings: [pin] };
}
function assertDenseProof(results: unknown, expected: number) {
  if (!Array.isArray(results) || Object.getPrototypeOf(results) !== Array.prototype || own(results, "length") !== expected) return stop();
  for (let index = 0; index < expected; index++) {
    const result = own(results, index);
    if (!dataRecord(result) || own(result, "success") !== true || Object.hasOwn(result, "error")) return stop();
    const rows = own(result, "results");
    if (!Array.isArray(rows) || Object.getPrototypeOf(rows) !== Array.prototype || own(rows, "length") !== 1) return stop();
    const row = own(rows, 0);
    if (!dataRecord(row) || own(row, "current") !== 1) return stop();
  }
}
function deadline(prepared: PreparedSceneCost, executionDeadline: number, nativeDeadline: number, assertions: readonly OutputSqlAssertion[]) {
  const values = [Date.parse(prepared.validUntil), executionDeadline, nativeDeadline,
    ...assertions.flatMap(assertion => assertion.deadlineMs === undefined ? [] : [assertion.deadlineMs])];
  if (values.some(value => !Number.isFinite(value))) return stop();
  const result = Math.min(...values);
  if (!(result > Date.now())) return stop();
  return result;
}

/** New dispatch only: one final read-only snapshot proves the current native
 * successor AND original sponsor purchase. Transport errors stay uncertain. */
export async function sponsorScenePaidDispatchDeadline(input: {
  claim: SponsorScenePaidClaim; prepared: PreparedSceneCost; evidence: SceneSponsorDispatchEvidence;
}): Promise<{ validUntil: string; pilotValidUntil: null }> {
  const { claim, prepared, evidence } = input;
  const state = claims.get(claim);
  if (!state) return stop();
  const verificationEpoch = ++state.verificationEpoch;
  state.verified = undefined;
  const execution = current(state), identity = state.identity;
  const native = sealed(() => requireSceneSponsorDispatchEvidence(evidence, prepared));
  if (native.env !== state.env || native.database !== state.database || native.signal !== state.signal || native.actorUserId !== identity.actorUserId
    || native.jobId !== identity.jobId || native.scopeKey !== identity.scopeKey || native.grantId !== identity.grantId || native.slotId !== identity.slotId
    || native.streamId !== identity.streamId || native.correlationId !== identity.correlationId
    || native.maximumTokens !== identity.reservedTokens || native.maximumMicrousd !== identity.reservedMicrousd
    || native.maximumCalls !== 1 || native.provider !== "openai" || native.model !== "gpt-5.6-terra"
    || prepared.scope || prepared.binding.scope || prepared.binding.contextSessionId !== null || prepared.binding.pilotCohortId !== null
    || prepared.binding.actorUserId !== identity.actorUserId || prepared.preview.actorUserId !== identity.actorUserId
    || prepared.binding.streamId !== identity.streamId || identity.streamId !== `creative:${identity.actorUserId}`
    || prepared.preview.requestId !== identity.jobId || prepared.binding.period !== identity.period || prepared.preview.period !== identity.period
    || prepared.preview.documentId !== prepared.binding.documentId || prepared.preview.projectId !== prepared.binding.projectId) return stop();
  // This payer-as-owner shape never escapes to native Scene consent, source,
  // policy-stop actor fields, or the ordinary scenePaidDispatchDeadline.
  const ledger: ClaimedSceneBudget = { actorUserId: identity.payerUserId, streamId: identity.streamId,
    correlationId: identity.correlationId, period: identity.period, tokenReservationId: identity.tokenReservationId,
    costReservationId: identity.costReservationId, reservedTokens: identity.reservedTokens, reservedMicrousd: identity.reservedMicrousd,
    projectScope: null, pilotCohortId: null };
  const paid = claimedSceneBudgetGuard(state.env, ledger);
  const assertions = [...execution.assertions, ...native.assertions, sameSlotAssertion(identity, prepared, native),
    { sql: paid.sql, bindings: [...paid.bindings] }];
  const until = deadline(prepared, execution.deadlineMs, native.deadlineMs, assertions);
  current(state);
  sealed(() => requireSceneSponsorDispatchEvidence(evidence, prepared));
  const statements = outputProofReadStatements(state.env, assertions);
  current(state);
  const checked: unknown = await state.database.batch<Record<string, unknown>>(statements);
  if (state.verificationEpoch !== verificationEpoch) return stop();
  current(state);
  sealed(() => requireSceneSponsorDispatchEvidence(evidence, prepared));
  assertDenseProof(checked, statements.length);
  deadline(prepared, execution.deadlineMs, native.deadlineMs, assertions);
  current(state);
  sealed(() => requireSceneSponsorDispatchEvidence(evidence, prepared));
  state.verified = { prepared, evidence, deadlineMs: until };
  return { validUntil: new Date(until).toISOString(), pilotValidUntil: null };
}
