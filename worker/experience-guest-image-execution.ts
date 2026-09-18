import { canonicalJson, exactKeys, freeze, jsonIssues, record } from "../src/experiences/compiler.ts";
import { foldEvents } from "../src/model/events.ts";
import { OUTPUT_NATIVE_EXECUTION_POLICY } from "../src/model/output-execution-policy.ts";
import { outputRequirements } from "./output-trusted-context.ts";
import type { GuestImageRunWitness } from "./experience-guest-image-admission-witness.ts";
import type { GuestImageOutputInput } from "./experience-guest-image-stage-witness.ts";
import { readSponsorFinancialBinding, sponsorFinancialIdentity, sponsorFinancialEventProfile,
  type SponsorFinancialBinding } from "./experience-sponsor-execution.ts";
import { guestFail } from "./experience-guest-session.ts";
import type { DocumentJobRow } from "./document-jobs-api.ts";
import type { OutputExecutionProof, OutputJobBinding } from "./output-execution-control.ts";
import type { OutputNativeSettings } from "./output-document-execution.ts";
import type { OutputSqlAssertion } from "./output-requirements-ledger.ts";
import type { WorkerEnv } from "./runtime.ts";

const fail = (part: string): never => guestFail(`image_execution_${part}`);
const own = (value: unknown, key: PropertyKey): unknown => {
  if (!value || typeof value !== "object") return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
};
const successful = (value: unknown) => {
  if (own(value, "success") !== true || !value || typeof value !== "object") return false;
  if (!("error" in value)) return true;
  const error = Object.getOwnPropertyDescriptor(value, "error");
  return !!error && Object.hasOwn(error, "value") && error.value === undefined;
};
type WitnessApi = typeof import("./experience-guest-image-admission-witness.ts");
type WitnessData = ReturnType<WitnessApi["requireGuestImageRunWitness"]>;
export type GuestImageRunInput = GuestImageOutputInput & Readonly<{ commandKey: string; explicitRun: true }>;
declare const brand: unique symbol;
export type GuestImageExecutionAuthority = Readonly<{ [brand]: true }>;
export type GuestImageExecutionView = Readonly<{
  identity: Readonly<{ actorKind: "guest"; actorUserId: string; ownerUserId: string; streamId: string; payerUserId: string }>;
  scope: WitnessData["frame"]["scope"]; slot: WitnessData["frame"]["slot"]; job: DocumentJobRow;
  binding: OutputJobBinding; proof: OutputExecutionProof; settings: OutputNativeSettings;
  financial: SponsorFinancialBinding; assertions: readonly OutputSqlAssertion[];
  sourceEvents: OutputExecutionProof["events"]; context: OutputExecutionProof["context"];
  policy: typeof OUTPUT_NATIVE_EXECUTION_POLICY; expiresAtMs: number;
  assertCurrent: () => void; refresh: () => Promise<void>;
}>;
type Captured = {
  request: Request; env: WorkerEnv; database: WorkerEnv["DB"]; input: GuestImageRunInput;
  api: WitnessApi; witness: GuestImageRunWitness; financial: SponsorFinancialBinding; immutable: string;
  runEventId: string | null; view: GuestImageExecutionView; tail: Promise<void>; stopped: boolean;
};
const registry = new WeakMap<GuestImageExecutionAuthority, Captured>();

function capture(input: GuestImageRunInput) {
  if (jsonIssues(input).length || !record(input)
    || !exactKeys(input, ["proof", "campaignId", "policyDigest", "draftHash", "commandKey", "explicitRun"])
    || input.explicitRun !== true || typeof input.commandKey !== "string" || !input.commandKey
    || input.commandKey.length > 256 || Array.from(input.commandKey).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
    || new TextEncoder().encode(canonicalJson(input)).byteLength > 32768) return fail("input_invalid");
  return freeze(structuredClone(input));
}
function original(data: WitnessData) {
  const f = data.frame, { status: _status, ...slot } = f.slot;
  return canonicalJson({ actor: f.actorUserId, owner: f.ownerUserId, payer: f.payerUserId, scope: f.scope, slot,
    sourceHead: f.sourceHead, planSourceHead: f.planSourceHead, quoteHead: f.quoteHead,
    preflight: f.preflight, confirmedPlan: f.confirmedPlan, recipe: f.recipe, context: f.context,
    createdAt: f.createdAt, expiresAt: f.expiresAt, period: f.period, runKey: data.runKey });
}
function financialIdentity(state: Pick<Captured, "financial" | "env">, data: WitnessData) {
  const expected = data.expectedFinancialIdentity;
  const identity = sponsorFinancialIdentity(state.financial, state.env, expected.actorUserId, expected.jobId);
  // These are the unchanged native binder's captured thirteen identity values,
  // not a caller-supplied SQL predicate or a second monetary authorization.
  const tuple = [expected.jobId, expected.actorUserId, expected.payerUserId, expected.grantId,
    expected.scopeKey, expected.slotId, expected.consumptionId, expected.campaignId,
    expected.issuerGrantId, expected.policyDigest, expected.envelopeDigest,
    expected.costReservationId, expected.tokenReservationId];
  if (identity.payerUserId !== expected.payerUserId
    || canonicalJson(identity.assertion.bindings) !== canonicalJson(tuple)
    || sponsorFinancialEventProfile(state.financial, state.env, expected.actorUserId,
      { scopeKey: expected.scopeKey, grantId: expected.grantId, slotId: expected.slotId }) !== "image")
    return fail("financial_identity_changed");
  return identity;
}
function requireState(request: Request, env: WorkerEnv, authority: GuestImageExecutionAuthority) {
  const state = authority && typeof authority === "object" ? registry.get(authority) : undefined;
  if (!state || state.request !== request || state.env !== env || state.database !== env.DB || state.stopped)
    return fail("capability_unavailable");
  const data = state.api.requireGuestImageRunWitness(request, env, state.witness);
  data.check();
  if (original(data) !== state.immutable || data.runKey !== state.input.commandKey
    || state.runEventId !== null && data.runEvent?.eventId !== state.runEventId) return fail("original_changed");
  const finance = financialIdentity(state, data);
  return { state, data, finance };
}
async function prove(data: WitnessData, env: WorkerEnv, assertions: readonly OutputSqlAssertion[]) {
  if (!assertions.length) return fail("complete_proof_required");
  const result = await data.wait(() => env.DB.batch(assertions.map(assertion => env.DB.prepare(
    `SELECT CASE WHEN (${assertion.sql}) THEN 1 ELSE 0 END AS current`).bind(...assertion.bindings ?? []))));
  data.check();
  if (!Array.isArray(result) || result.length !== assertions.length) return fail("proof_ack_invalid");
  for (let index = 0; index < result.length; index++) {
    const item = own(result, index), rows = own(item, "results");
    if (!successful(item) || !Array.isArray(rows) || rows.length !== 1 || own(own(rows, 0), "current") !== 1)
      return fail("proof_unavailable");
  }
}
function makeView(authority: GuestImageExecutionAuthority, state: Captured, data: WitnessData): GuestImageExecutionView {
  const f = data.frame;
  const sourceEvents = structuredClone([...data.sourceEvents]);
  const targetPreflight = f.preflight.targets.find(target => target.targetId === f.slot.targetId);
  if (!targetPreflight?.available || targetPreflight.provider !== "openai"
    || targetPreflight.route !== "document-image-manual-v1" || f.target.media_kind !== "image") return fail("image_required");
  const settings = structuredClone(data.settings);
  if (settings.kind !== "generate" || !settings.imageRender) return fail("image_required");
  const finance = financialIdentity(state, data);
  const assertions = structuredClone([...data.beforeAssertions, finance.assertion]);
  const sourceAssertions = structuredClone([...data.sourceAssertions, finance.assertion]);
  const proof: OutputExecutionProof = {
    sourceDigest: f.confirmedPlan.sourceDigest, requirementsDigest: f.confirmedPlan.requirementsDigest,
    head: data.sourceHead, events: sourceEvents, requirements: outputRequirements(foldEvents(sourceEvents, Number.POSITIVE_INFINITY, f.documentId, f.projectId)),
    context: structuredClone(f.context), confirmedPlan: structuredClone(f.confirmedPlan), preflight: structuredClone(f.preflight),
    target: structuredClone(f.target), targetPreflight: structuredClone(targetPreflight),
    sourceEpoch: { head: data.sourceHead, sourceDigest: f.slot.sourceDigest }, assertions: sourceAssertions,
  };
  const binding: OutputJobBinding = { scope: structuredClone(f.scope), slot: structuredClone(data.binding.slot), sponsored: true,
    payerUserId: f.payerUserId, retentionPolicy: null };
  const view = {
    identity: { actorKind: "guest" as const, actorUserId: f.actorUserId, ownerUserId: f.ownerUserId, streamId: f.streamId, payerUserId: f.payerUserId },
    scope: binding.scope, slot: binding.slot, job: structuredClone(data.job), binding, proof, settings,
    financial: state.financial, assertions, sourceEvents, context: proof.context, policy: OUTPUT_NATIVE_EXECUTION_POLICY,
    expiresAtMs: f.expiresAtMs,
    assertCurrent: () => { requireState(state.request, state.env, authority); },
    refresh: () => refreshGuestImageExecution(state.request, state.env, authority),
  };
  // Only data is recursively frozen. Request/env/DB remain captured privately;
  // the captured monetary capability retains its own independent native seal.
  freeze(view.identity); freeze(view.scope); freeze(view.slot); freeze(view.job); freeze(view.binding);
  freeze(view.proof); freeze(view.settings); freeze(view.assertions); freeze(view.sourceEvents);
  return Object.freeze(view);
}
async function create(request: Request, env: WorkerEnv, input: GuestImageRunInput, deadline?: number) {
  const copied = capture(input), base = freeze({ proof: copied.proof, campaignId: copied.campaignId, policyDigest: copied.policyDigest, draftHash: copied.draftHash });
  if (!(request instanceof Request) || deadline !== undefined && !Number.isFinite(deadline)) return fail("request_invalid");
  const database = env.DB, signal = request.signal, headers = JSON.stringify(Array.from(request.headers)), url = request.url, method = request.method;
  const configuration = () => canonicalJson({ openai: env.OPENAI_API_KEY ?? null, model: env.OPENAI_MODEL ?? null,
    image: env.OPENAI_IMAGE_MODEL ?? null, provider: env.FORMA_IMAGE_PROVIDER ?? null, project: env.OPENAI_PROJECT ?? null,
    cohort: env.FORMA_PILOT_COHORT_ID ?? null, tokenUser: env.FORMA_USER_TOKEN_LIMIT ?? null, tokenWorkspace: env.FORMA_WORKSPACE_TOKEN_LIMIT ?? null,
    costUser: env.FORMA_USER_COST_LIMIT_USD ?? null, costWorkspace: env.FORMA_WORKSPACE_COST_LIMIT_USD ?? null });
  const initialConfiguration = configuration(), ownerDeadline = Math.min(performance.now() + OUTPUT_NATIVE_EXECUTION_POLICY.maximumMilliseconds, deadline ?? Infinity);
  const current = () => {
    if (env.DB !== database || request.signal !== signal || signal.aborted || request.url !== url || request.method !== method
      || JSON.stringify(Array.from(request.headers)) !== headers || configuration() !== initialConfiguration || performance.now() >= ownerDeadline)
      return fail("request_changed");
  };
  current();
  // Shared native modules import this leaf. Loading the guest witness only at
  // its genuine entry avoids a schema-initialization cycle, without preloading
  // fixtures or changing canonical module initialization.
  const api = await import("./experience-guest-image-admission-witness.ts"); current();
  const witness = await api.createGuestImageRunWitness(request, env, base, ownerDeadline); current();
  const data = api.requireGuestImageRunWitness(request, env, witness);
  if (copied.commandKey !== data.runKey) return fail("run_command_changed");
  const financial = await data.wait(() => readSponsorFinancialBinding(env, data.frame.actorUserId, data.frame.slot.jobId));
  data.check();
  const identity = financialIdentity({ financial, env }, data);
  // Join the captured native monetary seal to the complete exact original
  // continuation. A guest-looking actor string alone never mints authority.
  await prove(data, env, [...data.beforeAssertions, identity.assertion]);
  const authority = Object.freeze(Object.create(null)) as GuestImageExecutionAuthority;
  const state: Captured = { request, env, database, input: copied, api, witness, financial, immutable: original(data),
    runEventId: data.runEvent?.eventId ?? null, view: undefined as never, tail: Promise.resolve(), stopped: false };
  registry.set(authority, state); state.view = makeView(authority, state, data);
  requireState(request, env, authority); return authority;
}
/** Explicit original Run only. The public function returns the owner's Promise. */
export function createGuestImageExecutionAuthority(request: Request, env: WorkerEnv, input: GuestImageRunInput, deadline?: number) {
  return create(request, env, input, deadline);
}
export function requireGuestImageExecution(request: Request, env: WorkerEnv, authority: GuestImageExecutionAuthority, exactClaimedJob?: DocumentJobRow) {
  const { state, data } = requireState(request, env, authority);
  if (exactClaimedJob) {
    const fields = ["job_id", "owner_id", "stream_id", "document_id", "kind", "source_surface", "correlation_id", "requested_sequence",
      "request_json", "attempt_count", "requested_at", "started_at", "expires_at", "output_slot_id", "scene_source_version_json", "scene_source_protocol"] as const;
    if (fields.some(key => exactClaimedJob[key] !== data.job[key]) || exactClaimedJob.attempt_count !== 1
      || exactClaimedJob.correlation_id !== `${data.frame.slot.jobId}:attempt:1`
      || ["running", "committing"].includes(data.phase) && exactClaimedJob.lease_expires_at !== data.job.lease_expires_at
      || !["running", "committing", "completed", "failed", "interrupted"].includes(data.phase)) return fail("claimed_job_changed");
  }
  return state.view;
}
export function refreshGuestImageExecution(request: Request, env: WorkerEnv, authority: GuestImageExecutionAuthority): Promise<void> {
  const { state } = requireState(request, env, authority);
  const next = state.tail.then(async () => {
    const current = requireState(request, env, authority);
    const refreshed = await current.data.wait(() => state.api.refreshGuestImageRunWitness(request, env, state.witness));
    current.data.check();
    const data = state.api.requireGuestImageRunWitness(request, env, refreshed);
    if (original(data) !== state.immutable || state.runEventId !== null && data.runEvent?.eventId !== state.runEventId) return fail("original_changed");
    const identity = financialIdentity(state, data);
    await prove(data, env, [...data.beforeAssertions, identity.assertion]);
    current.data.check(); data.check();
    state.witness = refreshed; state.runEventId = data.runEvent?.eventId ?? null;
    state.view = makeView(authority, state, data); requireState(request, env, authority);
  });
  state.tail = next.then(() => undefined, () => { state.stopped = true; });
  return next;
}
export function guestImageExecutionInternal(request: Request, env: WorkerEnv, authority: GuestImageExecutionAuthority) {
  const { state, data } = requireState(request, env, authority);
  return { witness: state.witness, data, input: state.input, wait: data.wait, check: () => { requireState(request, env, authority); } };
}
export async function prepareGuestImageJobClaim(request: Request, env: WorkerEnv, authority: GuestImageExecutionAuthority,
  input: { correlationId: string; attempt: 1; startedAt: string; leaseExpiresAt: string; initialResult: Record<string, unknown> }) {
  const { state, data } = requireState(request, env, authority), job = data.job, f = data.frame;
  if (data.phase !== "queued" || job.status !== "queued" || job.attempt_count !== 0 || job.started_at !== null
    || input.attempt !== 1 || input.correlationId !== `${job.job_id}:attempt:1`
    || !Number.isFinite(Date.parse(input.startedAt)) || new Date(Date.parse(input.startedAt)).toISOString() !== input.startedAt
    || !Number.isFinite(Date.parse(input.leaseExpiresAt)) || new Date(Date.parse(input.leaseExpiresAt)).toISOString() !== input.leaseExpiresAt
    || Date.parse(input.startedAt) > Date.now() || Date.parse(input.leaseExpiresAt) <= Date.now()
    || Date.parse(input.leaseExpiresAt) > Math.min(f.expiresAtMs, Date.parse(input.startedAt) + OUTPUT_NATIVE_EXECUTION_POLICY.maximumMilliseconds))
    return fail("claim_invalid");
  let prior: unknown;
  try { prior = JSON.parse(job.result_json ?? "{}"); } catch { return fail("claim_invalid"); }
  if (!record(prior) || canonicalJson(input.initialResult) !== canonicalJson({ ...prior, providerSubmissionProtocol: 1,
    stage: "preparing", progressMessage: "Preparing the document context." })) return fail("claim_invalid");
  const planned: DocumentJobRow = freeze({ ...structuredClone(job), status: "running", attempt_count: 1, correlation_id: input.correlationId,
    started_at: input.startedAt, lease_expires_at: input.leaseExpiresAt, result_json: JSON.stringify(input.initialResult), updated_at: input.startedAt });
  const after = state.api.guestImageRunJobClaimAssertions(request, env, state.witness, planned);
  const before = freeze(structuredClone(data.beforeAssertions));
  const acknowledge: (results: D1Result[]) => Promise<void> = async () => {
    requireState(request, env, authority);
    await refreshGuestImageExecution(request, env, authority);
    const observed = requireGuestImageExecution(request, env, authority, planned);
    if (canonicalJson(observed.job) !== canonicalJson(planned)) return fail("claim_receipt_changed");
  };
  requireState(request, env, authority); return { before, after, acknowledge };
}
