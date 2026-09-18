import { canonicalJson } from "../src/experiences/compiler.ts";
import type { OutputNativeTargetPreflight, OutputPreflight } from "../src/model/output-delivery-contract.ts";
import type { OutputBridgeTargetInput, OutputTrustedContext } from "./output-requirements-api.ts";
import type { WorkerEnv } from "./runtime.ts";
import { OutputConflictError, type OutputScope, type OutputSqlAssertion } from "./output-command-core.ts";
import type { OutputOperationSlot } from "./output-requirements-ledger.ts";
import { outputDigest, outputProofReadStatements, outputActiveSourceDeadlineAssertions } from "./output-disclosure-proof.ts";
import { outputScenePreflightProof, preflightOutputSceneTarget } from "./output-scene-preflight.ts";
import { readOutputScenePayload } from "./output-scene-preflight-contract.ts";
import { requireSceneMiniAppCostApproval } from "./scene-mini-app-consent.ts";
import { readSceneJobSourceWitness, sceneJobSourceWitnessAssertions } from "./scene-job-source-witness.ts";
import type { PreparedSceneCost } from "./scene-cost-consent.ts";
import { captureSponsorSceneJson } from "./experience-sponsor-scene-contract.ts";

declare const admissionBrand: unique symbol;
declare const runBrand: unique symbol;
declare const dispatchBrand: unique symbol;
declare const dispatchOwnerBrand: unique symbol;
export type SceneSponsorAdmissionPreparation = Readonly<{ [admissionBrand]: true }>;
export type SceneSponsorRunPreparation = Readonly<{ [runBrand]: true }>;
export type SceneSponsorDispatchEvidence = Readonly<{ [dispatchBrand]: true }>;
export type SceneSponsorDispatchOwner = Readonly<{ [dispatchOwnerBrand]: true }>;
type SceneNativeSource = Omit<OutputBridgeTargetInput, "sceneSourceVersion" | "sceneUseVersionedHistory">;
type NativeProof = NonNullable<ReturnType<typeof outputScenePreflightProof>>;
type Receipt = ReturnType<typeof sceneJobSourceWitnessAssertions>;
function fail(): never { throw new OutputConflictError("sponsor_scene_handoff_changed", 403); }
const json = (value: unknown) => canonicalJson(value);
const copy = <T>(value: T): T => structuredClone(value);
const own = (value: unknown, key: PropertyKey): unknown => value && typeof value === "object" ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
const commandJson = (value: unknown) => json(captureSponsorSceneJson(value));
function signalOf(request: Request): AbortSignal {
  const value = Object.getOwnPropertyDescriptor(Request.prototype, "signal")?.get?.call(request) as AbortSignal | undefined;
  if (!value || request.signal !== value) fail(); return value;
}
function requireSignal(signal: AbortSignal) {
  try { if (Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get?.call(signal) !== false) fail(); }
  catch { fail(); }
}

function sourceFacts(input: SceneNativeSource) {
  return { scope: input.scope, principal: input.principal, confirmedPlan: input.confirmedPlan, target: input.target,
    context: input.context, ownerHead: input.ownerHead ?? null, sourceEvents: input.sourceEvents ?? [],
    sourceDigest: input.sourceDigest, requirementsDigest: input.requirementsDigest };
}
function requestFacts(request: Request) { return json({ url: request.url, method: request.method, headers: [...request.headers.entries()] }); }
function environmentFacts(env: WorkerEnv) { return json({ model: env.OPENAI_MODEL ?? null, key: env.OPENAI_API_KEY ?? null, cohort: env.FORMA_PILOT_COHORT_ID ?? null }); }
function dense(results: unknown, length: number) {
  if (!Array.isArray(results) || own(results, "length") !== length || Array.from({ length }, (_, i) => {
    const result = own(results, i), rows = own(result, "results"), row = own(rows, 0);
    return own(result, "success") !== true || own(result, "error") !== undefined || !Array.isArray(rows)
      || own(rows, "length") !== 1 || own(row, "current") !== 1;
  }).some(Boolean)) fail();
}
function deadline(proof: NativeProof, assertions: readonly OutputSqlAssertion[], extra = Infinity) {
  const value = Math.min(extra, Date.parse(proof.expiresAt), Date.parse(proof.prepared.validUntil),
    ...assertions.flatMap(a => a.deadlineMs === undefined ? [] : [a.deadlineMs]));
  if (!Number.isFinite(value) || value <= Date.now()) fail();
  return value;
}
async function check(env: WorkerEnv, assertions: readonly OutputSqlAssertion[], current: () => void) {
  current();
  if (!assertions.length || assertions.length > 256 || assertions.some(a => !a.sql || a.sql.length > 100000 || (a.bindings?.length ?? 0) > 100)
    || new TextEncoder().encode(json(assertions)).byteLength > 2 * 1024 * 1024) fail();
  const result = await env.DB.batch<Record<string, unknown>>(outputProofReadStatements(env, assertions));
  current(); dense(result, assertions.length); current();
}
function proofOf(native: OutputNativeTargetPreflight) {
  const proof = outputScenePreflightProof(native);
  if (!native.available || !proof?.prepared.sourceVersion || !proof.sourceAssertions.length) fail();
  return proof;
}
function personal(input: SceneNativeSource) {
  if (input.scope.kind !== "personal" || input.scope.ownerUserId !== input.scope.actorUserId || input.scope.contextId
    || input.scope.organizationId || input.scope.projectAccessId || input.principal.userId !== input.scope.actorUserId
    || input.principal.streamId !== `creative:${input.scope.actorUserId}` || input.principal.fictional || input.principal.projectExecution
    || input.principal.billingUserId && input.principal.billingUserId !== input.principal.userId
    || !Object.hasOwn(input.target, "scene_contract") || input.confirmedPlan.plan.targets.length !== 1) fail();
}
type Base = { source: SceneNativeSource; request: Request; signal: AbortSignal; env: WorkerEnv; database: WorkerEnv["DB"];
  requestJson: string; environmentJson: string; sourceJson: string; originalAssertionsJson: string;
  native: OutputNativeTargetPreflight; proof: NativeProof; nativeJson: string; proofJson: string; commandJson: string;
  quote: OutputPreflight; quoteJson: string; assertions: OutputSqlAssertion[]; deadlineMs: number };
const admissions = new WeakMap<SceneSponsorAdmissionPreparation, Base>();
const runs = new WeakMap<SceneSponsorRunPreparation, Base & { slot: OutputOperationSlot; slotJson: string; correlationId: string; receipt: Receipt }>();
function nativeValue(value: unknown, depth = 0): unknown {
  if (depth > 100) fail();
  if (value === undefined) return ["undefined"];
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return [typeof value, value];
  if (!value || typeof value !== "object" || Object.getOwnPropertySymbols(value).length) fail();
  if (Array.isArray(value)) return ["array", Array.from({ length: value.length }, (_, i) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, i); if (!descriptor || !Object.hasOwn(descriptor, "value")) fail();
    return nativeValue(descriptor.value, depth + 1);
  })];
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail();
  return ["object", Object.keys(value).sort().map(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor || !Object.hasOwn(descriptor, "value")) fail();
    return [key, nativeValue(descriptor.value, depth + 1)];
  })];
}
function proofFacts(proof: NativeProof) { return json(nativeValue({ prepared: proof.prepared, sourceAssertions: proof.sourceAssertions, requestId: proof.requestId, expiresAt: proof.expiresAt })); }
function allowedAssertions(state: Base, assertions: readonly OutputSqlAssertion[] | undefined) {
  const candidate = json(assertions ?? []);
  const original = JSON.parse(state.originalAssertionsJson) as OutputSqlAssertion[], deadlines = outputActiveSourceDeadlineAssertions(state.source.context);
  const options = [original, [...original, ...state.proof.sourceAssertions], [...original, ...deadlines],
    [...original, ...deadlines, ...state.proof.sourceAssertions], [...original, ...state.proof.sourceAssertions, ...deadlines]];
  if (deadlines.length && json(original.slice(-deadlines.length)) === json(deadlines)) options.push(original.slice(0, -deadlines.length));
  return options.some(option => candidate === json(option));
}
function currentBase(state: Base, source = state.source) {
  if (source.request !== state.request || source.env !== state.env || state.env.DB !== state.database
    || signalOf(state.request) !== state.signal || requestFacts(state.request) !== state.requestJson
    || environmentFacts(state.env) !== state.environmentJson || json(sourceFacts(source)) !== state.sourceJson
    || !allowedAssertions(state, source.sourceAssertions) || outputScenePreflightProof(state.native) !== state.proof
    || json(state.native) !== state.nativeJson || proofFacts(state.proof) !== state.proofJson
    || json(state.quote) !== state.quoteJson || state.deadlineMs <= Date.now()) fail();
  requireSignal(state.signal);
}
async function nativeBase(input: { source: SceneNativeSource; command: Record<string, unknown>; quote: OutputPreflight }, receipt?: Receipt): Promise<Base> {
  const source = input.source;
  if (Object.hasOwn(source, "sceneSourceVersion") || Object.hasOwn(source, "sceneUseVersionedHistory")) fail();
  personal(source);
  const request = source.request, signal = signalOf(request), env = source.env, database = env.DB;
  const capturedCommand = commandJson(input.command), capturedQuote = json(input.quote), sourceJson = json(sourceFacts(source));
  const originalAssertionsJson = json(source.sourceAssertions ?? []), requestJson = requestFacts(request), environmentJson = environmentFacts(env);
  const unchanged = () => {
    requireSignal(signal);
    if (source.request !== request || source.env !== env || env.DB !== database || signalOf(request) !== signal
      || requestFacts(request) !== requestJson || environmentFacts(env) !== environmentJson || json(sourceFacts(source)) !== sourceJson
      || json(source.sourceAssertions ?? []) !== originalAssertionsJson || commandJson(input.command) !== capturedCommand || json(input.quote) !== capturedQuote) fail();
  };
  unchanged();
  const native = await preflightOutputSceneTarget({ ...source, ...(receipt ? { sceneSourceVersion: receipt.witness.successor } : { sceneUseVersionedHistory: true }) });
  unchanged();
  const proof = proofOf(native), quote = copy(input.quote);
  if (quote.targets.length !== 1 || json(quote.targets[0]) !== json(native) || quote.planRevisionId !== source.confirmedPlan.revisionId
    || quote.sourceDigest !== source.sourceDigest || quote.requirementsDigest !== source.requirementsDigest
    || proof.prepared.binding.actorUserId !== source.scope.actorUserId || proof.prepared.binding.documentId !== source.scope.documentId
    || proof.prepared.binding.projectId !== source.scope.projectId || proof.prepared.sourceVersion!.streamId !== source.principal.streamId
    || proof.prepared.sourceVersion!.projectAccessId !== undefined || proof.prepared.scope || proof.prepared.production
    || json(proof.prepared.authoredSnapshot) !== json(source.context.snapshot)) fail();
  const assertions = [...copy(source.sourceAssertions ?? []), ...copy(proof.sourceAssertions), ...(receipt ? copy(receipt.assertions) : [])];
  const state: Base = { source, request, signal, env, database, requestJson, environmentJson, sourceJson, originalAssertionsJson,
    native, proof, nativeJson: json(native), proofJson: proofFacts(proof), commandJson: capturedCommand, quote, quoteJson: json(quote),
    assertions, deadlineMs: deadline(proof, assertions, Date.parse(quote.expiresAt)) };
  await check(env, assertions, () => { unchanged(); currentBase(state); });
  unchanged(); currentBase(state);
  return state;
}

/** The only admission factory owns the real producer call and captures its
 * Request/environment BEFORE awaiting. Neither JSON nor a supplied proof seals it. */
export async function prepareSceneSponsorAdmission(input: { source: SceneNativeSource; command: Record<string, unknown>; quote: OutputPreflight }): Promise<SceneSponsorAdmissionPreparation> {
  const command = captureSponsorSceneJson(input.command) as Record<string, unknown>;
  if (command.action !== "authorize" || command.documentId !== input.source.scope.documentId || command.explicitAuthorization !== true
    || command.preflightId !== input.quote.id || command.termsDigest !== input.quote.termsDigest || command.maximumMicrousd !== input.quote.maximumMicrousd
    || command.expectedRevision !== `output:${input.source.ownerHead}` || Object.hasOwn(command, "sponsor_entitlement")) fail();
  const state = await nativeBase(input);
  const current = () => { currentBase(state); if (commandJson(input.command) !== state.commandJson || json(input.quote) !== state.quoteJson) fail(); };
  current();
  const payload = await readOutputScenePayload((state.native.settings as Record<string, unknown>).payload);
  current();
  if (!payload) fail();
  requireSceneMiniAppCostApproval(command.sceneCostConsent, payload.outputScene.costPreview, payload.outputScene.costPreview);
  await check(state.env, state.assertions, current);
  current();
  const handle = Object.freeze({}) as SceneSponsorAdmissionPreparation;
  admissions.set(handle, state); return handle;
}
function evidenceSource(state: Base, trusted: OutputTrustedContext): SceneNativeSource {
  if (!trusted.context || trusted.sourceProblems.length || !trusted.sourcePrivateCaptured || trusted.projectContext) fail();
  return { ...state.source, request: trusted.request, env: trusted.env, scope: trusted.scope, principal: trusted.principal,
    context: trusted.context, ownerHead: trusted.ownerHead, sourceEvents: trusted.events, sourceAssertions: trusted.sourceAssertions,
    sourceDigest: trusted.sourceDigest, requirementsDigest: trusted.requirementsDigest };
}
export async function requireSceneSponsorAdmissionForEvidence(handle: SceneSponsorAdmissionPreparation, trusted: OutputTrustedContext, command: Record<string, unknown>): Promise<OutputNativeTargetPreflight> {
  const state = admissions.get(handle); if (!state || commandJson(command) !== state.commandJson) fail();
  const current = () => { if (commandJson(command) !== state.commandJson) fail(); currentBase(state, evidenceSource(state, trusted)); };
  await check(state.env, state.assertions, current); current(); return state.native;
}
export function requireSceneSponsorAdmissionCurrent(handle: SceneSponsorAdmissionPreparation, input: OutputBridgeTargetInput, quote: OutputPreflight, sceneCostConsent: unknown): void {
  const state = admissions.get(handle); if (!state || json(quote) !== state.quoteJson
    || commandJson(sceneCostConsent) !== commandJson((JSON.parse(state.commandJson) as Record<string, unknown>).sceneCostConsent)) fail();
  currentBase(state, input);
}
export async function requireSceneSponsorAdmissionForTarget(handle: SceneSponsorAdmissionPreparation, input: OutputBridgeTargetInput, quote: OutputPreflight, sceneCostConsent: unknown): Promise<OutputNativeTargetPreflight> {
  const state = admissions.get(handle); if (!state || json(quote) !== state.quoteJson
    || commandJson(sceneCostConsent) !== commandJson((JSON.parse(state.commandJson) as Record<string, unknown>).sceneCostConsent)) fail();
  const current = () => { if (json(quote) !== state.quoteJson || commandJson(sceneCostConsent) !== commandJson((JSON.parse(state.commandJson) as Record<string, unknown>).sceneCostConsent)) fail(); currentBase(state, input); };
  await check(state.env, state.assertions, current); current(); return state.native;
}

export async function prepareSceneSponsorRun(input: { source: SceneNativeSource; command: Record<string, unknown>; quote: OutputPreflight;
  slot: OutputOperationSlot; correlationId: string }): Promise<SceneSponsorRunPreparation> {
  const request = input.source.request, signal = signalOf(request), env = input.source.env, database = env.DB;
  const facts = () => json({ command: captureSponsorSceneJson(input.command), source: sourceFacts(input.source), assertions: input.source.sourceAssertions ?? [],
    quote: input.quote, request: requestFacts(request), environment: environmentFacts(env), slot: input.slot, correlationId: input.correlationId });
  const captured = facts();
  const unchanged = () => { requireSignal(signal); if (request !== input.source.request || signal !== signalOf(request) || env !== input.source.env || database !== env.DB
    || captured !== facts()) fail(); };
  unchanged();
  if (input.command.action !== "run" || input.command.documentId !== input.source.scope.documentId || input.command.grantId !== input.slot.grantId
    || Object.hasOwn(input.command, "sponsor_entitlement") || input.slot.targetId !== input.source.target.id) fail();
  const receipt = await readSceneJobSourceWitness(env, input.source.scope, input.slot, input.correlationId);
  unchanged();
  const state = await nativeBase(input, receipt); unchanged(); currentBase(state);
  if (state.proof.requestId !== input.slot.jobId || await outputDigest(state.native) !== input.slot.routeDigest
    || json(state.proof.prepared.sourceVersion) !== json(receipt.witness.successor)) fail();
  unchanged(); currentBase(state);
  const handle = Object.freeze({}) as SceneSponsorRunPreparation;
  runs.set(handle, { ...state, slot: copy(input.slot), slotJson: json(input.slot), correlationId: input.correlationId, receipt }); return handle;
}
export async function requireSceneSponsorRunPreparation(handle: SceneSponsorRunPreparation, trusted: OutputTrustedContext, command: Record<string, unknown>) {
  const state = runs.get(handle); if (!state || commandJson(command) !== state.commandJson) fail();
  const assertCurrent = () => { if (commandJson(command) !== state.commandJson) fail(); currentBase(state, evidenceSource(state, trusted)); };
  await check(state.env, state.assertions, assertCurrent);
  assertCurrent();
  return { nativePreflight: state.native, quote: copy(state.quote), slot: copy(state.slot), receipt: copy(state.receipt),
    assertions: copy(state.assertions), deadlineMs: state.deadlineMs, assertCurrent };
}
export function sceneSponsorRunTransaction(handle: SceneSponsorRunPreparation, input: { request: Request; env: WorkerEnv; scope: OutputScope;
  slot: OutputOperationSlot; correlationId: string; raw: string }) {
  const state = runs.get(handle); if (!state) fail(); currentBase(state);
  if (input.request !== state.request || input.env !== state.env || input.env.DB !== state.database || json(input.scope) !== json(state.source.scope)
    || json(input.slot) !== state.slotJson || input.correlationId !== state.correlationId || input.raw !== state.receipt.raw) fail();
  return copy(state.assertions);
}

type DispatchOwner = { env: WorkerEnv; database: WorkerEnv["DB"]; scope: OutputScope; slot: OutputOperationSlot; correlationId: string;
  generation: number; signal: AbortSignal | null; identityJson: string; environmentJson: string };
type DispatchState = { owner: DispatchOwner; generation: number; native: OutputNativeTargetPreflight; nativeJson: string; proof: NativeProof;
  proofJson: string; receipt: Receipt; signal: AbortSignal; assertions: OutputSqlAssertion[]; deadlineMs: number };
const dispatchOwners = new WeakMap<SceneSponsorDispatchOwner, DispatchOwner>();
const dispatches = new WeakMap<SceneSponsorDispatchEvidence, DispatchState>();
export function createSceneSponsorDispatchOwner(input: { env: WorkerEnv; scope: OutputScope; slot: OutputOperationSlot; correlationId: string }): SceneSponsorDispatchOwner {
  const handle = Object.freeze({}) as SceneSponsorDispatchOwner;
  const scope = copy(input.scope), slot = copy(input.slot);
  dispatchOwners.set(handle, { env: input.env, database: input.env.DB, scope, slot, correlationId: input.correlationId, generation: 0, signal: null,
    identityJson: json({ scope, slot, correlationId: input.correlationId }), environmentJson: environmentFacts(input.env) }); return handle;
}
export function invalidateSceneSponsorDispatch(owner: SceneSponsorDispatchOwner) {
  const state = dispatchOwners.get(owner); if (!state) fail(); state.generation++;
}
/** Native execution owns this call. Candidate receipt bytes are independently
 * turned into exact DB predicates; caller assertions and versions are ignored. */
export async function prepareSceneSponsorDispatchEvidence(ownerHandle: SceneSponsorDispatchOwner, input: {
  nativePreflight: OutputNativeTargetPreflight; receiptRaw: string; signal: AbortSignal;
}): Promise<SceneSponsorDispatchEvidence> {
  const owner = dispatchOwners.get(ownerHandle); if (!owner || owner.signal && owner.signal !== input.signal) fail();
  requireSignal(input.signal);
  owner.signal = input.signal;
  const proof = proofOf(input.nativePreflight), receipt = sceneJobSourceWitnessAssertions(owner.scope, owner.slot, owner.correlationId, input.receiptRaw);
  if (!['run', 'execution'].includes(receipt.witness.phase) || owner.correlationId !== `${owner.slot.jobId}:attempt:1`
    || proof.requestId !== owner.slot.jobId || json(proof.prepared.sourceVersion) !== json(receipt.witness.successor)
    || proof.prepared.binding.actorUserId !== owner.scope.actorUserId || proof.prepared.binding.documentId !== owner.scope.documentId
    || proof.prepared.binding.projectId !== owner.scope.projectId || proof.prepared.scope || proof.prepared.production) fail();
  const native = input.nativePreflight, generation = ++owner.generation, signal = input.signal;
  const nativeJson = json(native), proofJson = proofFacts(proof);
  const unchanged = () => { requireSignal(signal); if (owner.env.DB !== owner.database || environmentFacts(owner.env) !== owner.environmentJson || owner.signal !== signal || input.signal !== signal
    || owner.generation !== generation || input.nativePreflight !== native || input.receiptRaw !== receipt.raw
    || json(native) !== nativeJson || proofFacts(proof) !== proofJson || outputScenePreflightProof(native) !== proof) fail(); };
  unchanged();
  const job = await owner.env.DB.prepare("SELECT request_json,expires_at,lease_expires_at FROM document_jobs WHERE job_id=? AND owner_id=? AND correlation_id=? AND attempt_count=1 AND status IN('running','committing')")
    .bind(owner.slot.jobId, owner.scope.ownerUserId, owner.correlationId).first<Record<string, unknown>>();
  unchanged();
  const requestJson = own(job, "request_json"), expiresAt = own(job, "expires_at"), leaseExpiresAt = own(job, "lease_expires_at");
  if (typeof requestJson !== "string" || typeof expiresAt !== "string" || typeof leaseExpiresAt !== "string") fail();
  const jobDeadline = Math.min(Date.parse(expiresAt), Date.parse(leaseExpiresAt));
  if (!Number.isFinite(jobDeadline) || jobDeadline <= Date.now()) fail();
  const payload = await readOutputScenePayload((native.settings as Record<string, unknown>).payload); unchanged();
  if (!payload) fail();
  const jobRequest: unknown = JSON.parse(requestJson);
  requireSceneMiniAppCostApproval(own(jobRequest, "sceneCostConsent"), payload.outputScene.costPreview, payload.outputScene.costPreview);
  const assertions = [...copy(proof.sourceAssertions), ...copy(receipt.assertions), {
    sql: "EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND owner_id=? AND correlation_id=? AND attempt_count=1 AND status IN('running','committing') AND request_json=? AND expires_at=? AND lease_expires_at=? AND lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
    bindings: [owner.slot.jobId, owner.scope.ownerUserId, owner.correlationId, requestJson, expiresAt, leaseExpiresAt], deadlineMs: jobDeadline,
  }];
  const state: DispatchState = { owner, generation, native, nativeJson, proof, proofJson, receipt,
    signal: input.signal, assertions, deadlineMs: deadline(proof, assertions) };
  const handle = Object.freeze({}) as SceneSponsorDispatchEvidence;
  dispatches.set(handle, state);
  const current = () => { unchanged(); requireSceneSponsorDispatchEvidence(handle, proof.prepared); };
  current();
  if (await outputDigest(native) !== owner.slot.routeDigest) fail(); current();
  await check(owner.env, assertions, current); current(); return handle;
}
export function requireSceneSponsorDispatchEvidence(handle: SceneSponsorDispatchEvidence, prepared: PreparedSceneCost) {
  const state = dispatches.get(handle); if (!state) fail();
  const { owner, proof, native } = state;
  requireSignal(state.signal);
  if (owner.env.DB !== owner.database || environmentFacts(owner.env) !== owner.environmentJson || owner.generation !== state.generation || owner.signal !== state.signal
    || owner.identityJson !== json({ scope: owner.scope, slot: owner.slot, correlationId: owner.correlationId })
    || proof.prepared !== prepared || outputScenePreflightProof(native) !== proof || json(native) !== state.nativeJson
    || proofFacts(proof) !== state.proofJson || Date.now() >= state.deadlineMs) fail();
  return { env: owner.env, database: owner.database, actorUserId: owner.scope.actorUserId, jobId: owner.slot.jobId,
    scopeKey: owner.scope.key, grantId: owner.slot.grantId, slotId: owner.slot.slotId, streamId: `creative:${owner.scope.actorUserId}`,
    correlationId: owner.correlationId, signal: state.signal, assertions: copy(state.assertions), deadlineMs: state.deadlineMs,
    provider: native.provider, model: native.model, routeDigest: owner.slot.routeDigest,
    maximumTokens: native.maximumTokens, maximumMicrousd: native.maximumMicrousd, maximumCalls: native.maximumCalls };
}
