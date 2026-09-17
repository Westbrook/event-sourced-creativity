import { canonicalJson, exactKeys, freeze, jsonIssues, record } from "../src/experiences/compiler.ts";
import type { OutputNativeTargetPreflight, OutputPreflight } from "../src/model/output-delivery-contract.ts";
import { parseAudioMiniAppCostPreview } from "../src/model/audio-mini-app-consent.ts";
import { readSponsoredAudioReview } from "../src/experiences/sponsored-audio-actor-intent.ts";
import type { OutputBridgeTargetInput, OutputTrustedContext } from "./output-requirements-api.ts";
import type { WorkerEnv } from "./runtime.ts";
import type { EventExecutionControl } from "./events-api.ts";
import { OutputConflictError, type OutputScope, type OutputSqlAssertion } from "./output-command-core.ts";
import type { OutputOperationSlot } from "./output-requirements-ledger.ts";
import { outputDigest, outputProofReadStatements, outputActiveSourceDeadlineAssertions } from "./output-disclosure-proof.ts";
import { outputAudioPreflightAssertions, preflightOutputAudioTarget } from "./output-audio-preflight.ts";
import { readOutputAudioPayload, requireAudioMiniAppCostApproval } from "./output-audio-execution.ts";
import { sponsorCurrentSourceAssertions } from "./experience-sponsor-image-evidence.ts";
import { classifySponsorIntakeDraft } from "./experience-sponsor-intake-classification.ts";
import { readSponsorInternalCommand } from "./experience-sponsor-approval.ts";
import { readSponsorAudioActorEvidence } from "./experience-sponsor-audio-actor-evidence.ts";

declare const admissionBrand: unique symbol;
declare const reviewBrand: unique symbol;
declare const runBrand: unique symbol;
declare const dispatchBrand: unique symbol;
declare const dispatchOwnerBrand: unique symbol;
export type AudioSponsorAdmissionPreparation = Readonly<{ [admissionBrand]: true }>;
export type AudioSponsorReviewPreparation = Readonly<{ [reviewBrand]: true }>;
export type AudioSponsorRunPreparation = Readonly<{ [runBrand]: true }>;
export type AudioSponsorDispatchEvidence = Readonly<{ [dispatchBrand]: true }>;
export type AudioSponsorDispatchOwner = Readonly<{ [dispatchOwnerBrand]: true }>;
type AudioNativeSource = Omit<OutputBridgeTargetInput, "sceneSourceVersion" | "sceneUseVersionedHistory">;
type ActorEvidence = Awaited<ReturnType<typeof readSponsorAudioActorEvidence>>;
export type AudioSponsorActorIntent = Pick<ActorEvidence, "request" | "review" | "requestDigest" | "reviewDigest" | "commandDigest">;
type NativeProof = NonNullable<ReturnType<typeof outputAudioPreflightAssertions>>;
function fail(): never { throw new OutputConflictError("sponsor_audio_handoff_changed", 403); }
const json = (value: unknown) => canonicalJson(value);
const copy = <T>(value: T): T => structuredClone(value);
const own = (value: unknown, key: PropertyKey): unknown => value && typeof value === "object" ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
function commandJson(value: unknown) { if (jsonIssues(value).length) fail(); return json(value); }
function signalOf(request: Request): AbortSignal {
  let value: AbortSignal | undefined;
  try { value = Object.getOwnPropertyDescriptor(Request.prototype, "signal")?.get?.call(request) as AbortSignal | undefined; } catch { fail(); }
  if (!value || request.signal !== value) fail(); return value;
}
function requireSignal(signal: AbortSignal) {
  try { if (Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get?.call(signal) !== false) fail(); } catch { fail(); }
}
function sourceFacts(input: AudioNativeSource) {
  return { scope: input.scope, principal: input.principal, confirmedPlan: input.confirmedPlan, target: input.target,
    context: input.context, ownerHead: input.ownerHead ?? null, sourceEvents: input.sourceEvents ?? [],
    sourceDigest: input.sourceDigest, requirementsDigest: input.requirementsDigest };
}
function requestFacts(request: Request) { return json({ url: request.url, method: request.method, headers: [...request.headers.entries()] }); }
function environmentFacts(env: WorkerEnv) { return json({ model: env.OPENAI_MODEL ?? null, openai: env.OPENAI_API_KEY ?? null, fal: env.FAL_KEY ?? null,
  audioProvider: env.FORMA_AUDIO_PROVIDER ?? null, audioModel: env.FAL_AUDIO_MODEL ?? null, cohort: env.FORMA_PILOT_COHORT_ID ?? null }); }
function cleanAcknowledgementError(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const error = Object.getOwnPropertyDescriptor(value, "error");
  return error ? Object.hasOwn(error, "value") && error.value === undefined : !("error" in value);
}
function dense(results: unknown, length: number) {
  if (!Array.isArray(results) || own(results, "length") !== length || Array.from({ length }, (_, i) => {
    const result = own(results, i), rows = own(result, "results"), row = own(rows, 0);
    return own(result, "success") !== true || !cleanAcknowledgementError(result) || !Array.isArray(rows)
      || own(rows, "length") !== 1 || own(row, "current") !== 1;
  }).some(Boolean)) fail();
}
function deadline(previewExpiresAt: string, assertions: readonly OutputSqlAssertion[], extra = Infinity) {
  const value = Math.min(extra, Date.parse(previewExpiresAt), ...assertions.flatMap(a => a.deadlineMs === undefined ? [] : [a.deadlineMs]));
  if (!Number.isFinite(value) || !Number.isFinite(Date.now()) || value <= Date.now()) fail(); return value;
}
async function check(env: WorkerEnv, assertions: readonly OutputSqlAssertion[], current: () => void) {
  current();
  if (!assertions.length || assertions.length > 256 || assertions.some(a => !a.sql || a.sql.length > 100000 || (a.bindings?.length ?? 0) > 100)
    || new TextEncoder().encode(json(assertions)).byteLength > 2 * 1024 * 1024) fail();
  const result = await env.DB.batch<Record<string, unknown>>(outputProofReadStatements(env, assertions));
  current(); dense(result, assertions.length); current();
}
function proofOf(native: OutputNativeTargetPreflight) {
  const proof = outputAudioPreflightAssertions(native), settings = record(native.settings) ? native.settings : null;
  const preview = settings ? parseAudioMiniAppCostPreview(settings.costPreview) : null;
  const contract = settings && record(settings.payload) ? readOutputAudioPayload(settings.payload) : null;
  if (!native.available || !proof?.length || !preview || !contract || native.provider !== "fal"
    || native.model !== "fal-ai/stable-audio-3/medium/text-to-audio" || native.route !== "document-audio-timed-music-manual-v1"
    || native.maximumCalls !== 3 || native.maximumTokens !== 128000) fail();
  return { proof, preview, contract };
}
function personal(input: AudioNativeSource) {
  if (input.scope.kind !== "personal" || input.scope.ownerUserId !== input.scope.actorUserId || input.scope.contextId
    || input.scope.organizationId || input.scope.projectAccessId || input.principal.userId !== input.scope.actorUserId
    || input.principal.streamId !== `creative:${input.scope.actorUserId}` || input.principal.fictional || input.principal.projectExecution
    || input.principal.billingUserId && input.principal.billingUserId !== input.principal.userId
    || !Object.hasOwn(input.target, "audio_contract") || input.confirmedPlan.plan.targets.length !== 1
    || input.env.FORMA_PILOT_COHORT_ID?.trim() || Object.hasOwn(input, "sceneSourceVersion") || Object.hasOwn(input, "sceneUseVersionedHistory")) fail();
}
type Base = { source: AudioNativeSource; request: Request; signal: AbortSignal; env: WorkerEnv; database: WorkerEnv["DB"];
  requestJson: string; environmentJson: string; sourceJson: string; originalAssertionsJson: string;
  native: OutputNativeTargetPreflight; proof: NativeProof; nativeJson: string; proofJson: string; commandJson: string;
  quote: OutputPreflight; quoteJson: string; assertions: OutputSqlAssertion[]; deadlineMs: number;
  identities: {scope: AudioNativeSource["scope"]; principal: AudioNativeSource["principal"]; context: AudioNativeSource["context"]; events: AudioNativeSource["sourceEvents"]; plan: AudioNativeSource["confirmedPlan"]; target: AudioNativeSource["target"]} };
const admissions = new WeakMap<AudioSponsorAdmissionPreparation, Base & { actor: ActorEvidence; actorIntent: AudioSponsorActorIntent }>();
const reviews = new WeakMap<AudioSponsorReviewPreparation, Base>();
const runs = new WeakMap<AudioSponsorRunPreparation, Base & { slot: OutputOperationSlot; slotJson: string; correlationId: string }>();
function allowedAssertions(state: Base, assertions: readonly OutputSqlAssertion[] | undefined) {
  const candidate = json(assertions ?? []), original = JSON.parse(state.originalAssertionsJson) as OutputSqlAssertion[];
  const deadlines = outputActiveSourceDeadlineAssertions(state.source.context);
  const options = [original, [...original, ...state.proof], [...original, ...deadlines], [...original, ...deadlines, ...state.proof], [...original, ...state.proof, ...deadlines]];
  if (deadlines.length && json(original.slice(-deadlines.length)) === json(deadlines)) options.push(original.slice(0, -deadlines.length));
  return options.some(option => candidate === json(option));
}
function currentBase(state: Base, source = state.source) {
  if (state.source.scope !== state.identities.scope || state.source.principal !== state.identities.principal || state.source.context !== state.identities.context
    || state.source.sourceEvents !== state.identities.events || state.source.confirmedPlan !== state.identities.plan || state.source.target !== state.identities.target
    || json(sourceFacts(state.source)) !== state.sourceJson || !allowedAssertions(state, state.source.sourceAssertions)
    || source.request !== state.request || source.env !== state.env || state.env.DB !== state.database
    || signalOf(state.request) !== state.signal || requestFacts(state.request) !== state.requestJson
    || environmentFacts(state.env) !== state.environmentJson || json(sourceFacts(source)) !== state.sourceJson
    || !allowedAssertions(state, source.sourceAssertions) || outputAudioPreflightAssertions(state.native) !== state.proof
    || json(state.native) !== state.nativeJson || json(state.proof) !== state.proofJson
    || json(state.quote) !== state.quoteJson || !Number.isFinite(Date.now()) || state.deadlineMs <= Date.now()) fail();
  requireSignal(state.signal);
}
async function nativeBase(input: { source: AudioNativeSource; command: Record<string, unknown>; quote: OutputPreflight }): Promise<Base> {
  const source = input.source; personal(source);
  const request = source.request, signal = signalOf(request), env = source.env, database = env.DB;
  const identities = {scope:source.scope,principal:source.principal,context:source.context,events:source.sourceEvents,plan:source.confirmedPlan,target:source.target};
  const initialDeadline = Math.min(Date.parse(input.quote.expiresAt), ...(source.sourceAssertions ?? []).flatMap(a => a.deadlineMs === undefined ? [] : [a.deadlineMs]));
  const capturedCommand = commandJson(input.command), capturedQuote = json(input.quote), sourceJson = json(sourceFacts(source));
  const originalAssertionsJson = json(source.sourceAssertions ?? []), requestJson = requestFacts(request), environmentJson = environmentFacts(env);
  const unchanged = () => {
    requireSignal(signal);
    if (source.scope !== identities.scope || source.principal !== identities.principal || source.context !== identities.context || source.sourceEvents !== identities.events
      || source.confirmedPlan !== identities.plan || source.target !== identities.target || !Number.isFinite(initialDeadline) || !Number.isFinite(Date.now()) || Date.now() >= initialDeadline
      || source.request !== request || source.env !== env || env.DB !== database || signalOf(request) !== signal
      || requestFacts(request) !== requestJson || environmentFacts(env) !== environmentJson || json(sourceFacts(source)) !== sourceJson
      || json(source.sourceAssertions ?? []) !== originalAssertionsJson || commandJson(input.command) !== capturedCommand || json(input.quote) !== capturedQuote) fail();
  };
  unchanged(); const native = await preflightOutputAudioTarget(source); unchanged();
  const { proof, preview } = proofOf(native), quote = copy(input.quote);
  if (quote.targets.length !== 1 || json(quote.targets[0]) !== json(native) || quote.planRevisionId !== source.confirmedPlan.revisionId
    || quote.sourceDigest !== source.sourceDigest || quote.requirementsDigest !== source.requirementsDigest
    || preview.actorUserId !== source.scope.actorUserId || preview.documentId !== source.scope.documentId || preview.projectId !== source.scope.projectId
    || preview.sourceDigest !== source.sourceDigest || preview.requirementsDigest !== source.requirementsDigest) fail();
  const assertions = [...copy(source.sourceAssertions ?? []), ...copy(proof)];
  const state: Base = { source, request, signal, env, database, requestJson, environmentJson, sourceJson, originalAssertionsJson,
    native, proof, nativeJson: json(native), proofJson: json(proof), commandJson: capturedCommand, quote, quoteJson: json(quote),
    assertions, deadlineMs: deadline(preview.expiresAt, assertions, Date.parse(quote.expiresAt)), identities };
  await check(env, assertions, () => { unchanged(); currentBase(state); }); unchanged(); currentBase(state); return state;
}
function evidenceSource(state: Base, trusted: OutputTrustedContext): AudioNativeSource {
  if (!trusted.context || trusted.sourceProblems.length || !trusted.sourcePrivateCaptured || trusted.projectContext) fail();
  return { ...state.source, request: trusted.request, env: trusted.env, scope: trusted.scope, principal: trusted.principal,
    context: trusted.context, ownerHead: trusted.ownerHead, sourceEvents: trusted.events, sourceAssertions: trusted.sourceAssertions,
    sourceDigest: trusted.sourceDigest, requirementsDigest: trusted.requirementsDigest };
}
/** Consent-free native quote proof for an already-owned ordinary Document.
 * This separate capability cannot be used for admission, Run or dispatch. */
export async function prepareAudioSponsorReview(input: { source: AudioNativeSource; quote: OutputPreflight; quoteAssertions: readonly OutputSqlAssertion[] }): Promise<AudioSponsorReviewPreparation> {
  personal(input.source);
  const request = input.source.request, signal = signalOf(request), env = input.source.env, database = env.DB;
  const identities = { scope: input.source.scope, principal: input.source.principal, context: input.source.context, events: input.source.sourceEvents };
  const facts = () => json({ source: sourceFacts(input.source), assertions: input.source.sourceAssertions ?? [], quote: input.quote,
    quoteAssertions: input.quoteAssertions, request: requestFacts(request), environment: environmentFacts(env) });
  const captured = facts(), expiresAt = Date.parse(input.quote.expiresAt);
  const current = () => {
    requireSignal(signal);
    if (input.source.request !== request || signalOf(request) !== signal || input.source.env !== env || env.DB !== database
      || input.source.scope !== identities.scope || input.source.principal !== identities.principal || input.source.context !== identities.context
      || input.source.sourceEvents !== identities.events || facts() !== captured || !Number.isFinite(expiresAt)
      || !Number.isFinite(Date.now()) || Date.now() >= expiresAt) fail();
  };
  current();
  const settings = input.quote.targets[0]?.settings;
  const payload = settings && record(settings.payload) ? settings.payload : null;
  const contract = payload && readOutputAudioPayload(payload);
  if (!contract || !input.quoteAssertions.length) fail();
  const classification = await classifySponsorIntakeDraft(env, contract.source.draftId); current();
  if (classification.kind !== "ordinary") fail();
  const state = await nativeBase({ source: input.source, quote: input.quote,
    command: { action: "sponsor-audio-review", preflightId: input.quote.id } });
  current(); currentBase(state);
  state.assertions.push(copy(classification.guard), ...copy(input.quoteAssertions));
  state.deadlineMs = Math.min(state.deadlineMs, ...input.quoteAssertions.flatMap(value => value.deadlineMs === undefined ? [] : [value.deadlineMs]));
  await check(env, state.assertions, () => { current(); currentBase(state); }); current(); currentBase(state);
  const handle = Object.freeze({}) as AudioSponsorReviewPreparation;
  reviews.set(handle, state); return handle;
}
/** Internal display metadata and a final-current guard, never wire authority. */
export async function requireAudioSponsorReviewForDisplay(handle: AudioSponsorReviewPreparation, trusted: OutputTrustedContext) {
  const state = reviews.get(handle); if (!state) fail();
  const assertCurrent = () => currentBase(state, evidenceSource(state, trusted));
  assertCurrent(); await check(state.env, state.assertions, assertCurrent); assertCurrent();
  const { preview, contract } = proofOf(state.native);
  const result = { quote: copy(state.quote), preview, draftHash: contract.source.draftHash,
    releaseHash: contract.source.releaseHash, targetId: state.native.targetId,
    expectedRevision: `output:${state.source.ownerHead}`, assertions: copy(state.assertions), deadlineMs: state.deadlineMs, assertCurrent };
  assertCurrent(); return result;
}
/** The actual original Request is consumed by actor31e inside this capability owner.
 * An externally supplied actor/native DTO cannot mint this handle. */
export async function prepareAudioSponsorAdmission(input: { source: AudioNativeSource; trusted: OutputTrustedContext; command: Record<string, unknown>; quote: OutputPreflight; review: unknown }): Promise<AudioSponsorAdmissionPreparation> {
  const command = JSON.parse(commandJson(input.command)) as Record<string, unknown>, review = readSponsoredAudioReview(input.review);
  if (!exactKeys(command, ["documentId", "action", "expectedRevision", "clientMutationId", "preflightId", "termsDigest", "maximumMicrousd", "explicitAuthorization", "audioCostConsent"])
    || command.action !== "authorize" || command.documentId !== input.source.scope.documentId || command.explicitAuthorization !== true
    || command.preflightId !== input.quote.id || command.termsDigest !== input.quote.termsDigest || command.maximumMicrousd !== input.quote.maximumMicrousd
    || command.expectedRevision !== `output:${input.source.ownerHead}`) fail();
  personal(input.source);
  const request = input.source.request, signal = signalOf(request), env = input.source.env, database = env.DB;
  const capture = () => json({ command: input.command, quote: input.quote, review: readSponsoredAudioReview(input.review),
    source: sourceFacts(input.source), assertions: input.source.sourceAssertions ?? [], request: requestFacts(request), configuration: environmentFacts(env) });
  const captured = capture(), identities = {scope:input.source.scope,principal:input.source.principal,context:input.source.context,events:input.source.sourceEvents,plan:input.source.confirmedPlan,target:input.source.target};
  const retainedAssertions = copy(sponsorCurrentSourceAssertions(input.trusted));
  const initialDeadline = Math.min(Date.parse(review.expiresAt), Date.parse(review.preview.expiresAt), Date.parse(input.quote.expiresAt), ...retainedAssertions.flatMap(a => a.deadlineMs === undefined ? [] : [a.deadlineMs]));
  const current = () => { requireSignal(signal); if (input.source.request !== request || input.trusted.request !== request || signalOf(request) !== signal
    || input.source.env !== env || input.trusted.env !== env || env.DB !== database || capture() !== captured
    || input.source.scope !== identities.scope || input.source.principal !== identities.principal || input.source.context !== identities.context || input.source.sourceEvents !== identities.events
    || input.source.confirmedPlan !== identities.plan || input.source.target !== identities.target
    || !Number.isFinite(initialDeadline) || !Number.isFinite(Date.now()) || Date.now() >= initialDeadline) fail(); };
  current(); const actor = await readSponsorAudioActorEvidence(input.trusted, command, review); current();
  const classification = await classifySponsorIntakeDraft(env, review.preview.draftId); current();
  if (classification.kind !== "ordinary") fail();
  const state = await nativeBase(input); current(); currentBase(state, evidenceSource(state, input.trusted));
  state.assertions.push(...retainedAssertions, copy(classification.guard));
  if (json(actor.native.offered) !== json(state.native) || actor.commandDigest !== `sha256:${await outputDigest(command)}`) fail();
  current(); currentBase(state);
  requireAudioMiniAppCostApproval(command.audioCostConsent, actor.review.preview, (state.native.settings as Record<string, unknown>).costPreview);
  const actorIntent = freeze({ request: actor.request, review: actor.review, requestDigest: actor.requestDigest, reviewDigest: actor.reviewDigest, commandDigest: actor.commandDigest });
  state.deadlineMs = Math.min(state.deadlineMs, initialDeadline, Date.parse(actor.review.expiresAt), actor.native.description.preflightExpiresAtMs);
  await check(env, state.assertions, () => { current(); currentBase(state); }); current(); currentBase(state);
  const handle = Object.freeze({}) as AudioSponsorAdmissionPreparation; admissions.set(handle, { ...state, actor, actorIntent }); return handle;
}
export async function requireAudioSponsorAdmissionForEvidence(handle: AudioSponsorAdmissionPreparation, trusted: OutputTrustedContext, command: Record<string, unknown>) {
  const state = admissions.get(handle); if (!state || commandJson(command) !== state.commandJson) fail();
  const assertCurrent = () => { if (commandJson(command) !== state.commandJson) fail(); currentBase(state, evidenceSource(state, trusted)); };
  await check(state.env, state.assertions, assertCurrent); assertCurrent();
  return { nativePreflight: state.native, actorIntent: state.actorIntent, description: state.actor.native.description, recipe: state.actor.native.recipe,
    assertions: copy(state.assertions), deadlineMs: state.deadlineMs, assertCurrent };
}
export function requireAudioSponsorAdmissionCurrent(handle: AudioSponsorAdmissionPreparation, input: OutputBridgeTargetInput, quote: OutputPreflight, audioCostConsent: unknown): OutputSqlAssertion[] {
  const state = admissions.get(handle); if (!state || json(quote) !== state.quoteJson
    || commandJson(audioCostConsent) !== commandJson((JSON.parse(state.commandJson) as Record<string, unknown>).audioCostConsent)) fail(); currentBase(state, input); return copy(state.assertions);
}
export async function requireAudioSponsorAdmissionForTarget(handle: AudioSponsorAdmissionPreparation, input: OutputBridgeTargetInput, quote: OutputPreflight, audioCostConsent: unknown): Promise<OutputNativeTargetPreflight> {
  const state = admissions.get(handle); if (!state) fail();
  const current = () => requireAudioSponsorAdmissionCurrent(handle, input, quote, audioCostConsent);
  await check(state.env, state.assertions, current); current(); return state.native;
}
/** Run proves the retained original native operation; it never requests fresh actor consent. */
export async function prepareAudioSponsorRun(input: { source: AudioNativeSource; command: Record<string, unknown>; quote: OutputPreflight; slot: OutputOperationSlot; correlationId: string }): Promise<AudioSponsorRunPreparation> {
  if (!exactKeys(input.command, ["documentId", "action", "expectedRevision", "clientMutationId", "grantId"]) || input.command.action !== "run"
    || input.command.documentId !== input.source.scope.documentId || input.command.grantId !== input.slot.grantId
    || input.slot.targetId !== input.source.target.id || input.slot.attemptOrdinal !== 0 || input.slot.previousSlotId
    || ![input.slot.jobId, `${input.slot.jobId}:attempt:1`].includes(input.correlationId)) fail();
  const slotJson = json(input.slot), correlationId = input.correlationId;
  const request=input.source.request,signal=signalOf(request),env=input.source.env,database=env.DB;
  const facts=()=>json({command:commandJson(input.command),source:sourceFacts(input.source),assertions:input.source.sourceAssertions??[],
    quote:input.quote,slot:input.slot,correlationId:input.correlationId,request:requestFacts(request),configuration:environmentFacts(env)});
  const captured=facts(),identities={scope:input.source.scope,principal:input.source.principal,context:input.source.context,events:input.source.sourceEvents};
  const initialDeadline=Math.min(Date.parse(input.quote.expiresAt),...(input.source.sourceAssertions??[]).flatMap(a=>a.deadlineMs===undefined?[]:[a.deadlineMs]));
  const unchanged=()=>{requireSignal(signal);if(input.source.request!==request||signalOf(request)!==signal||input.source.env!==env||env.DB!==database
    ||input.source.scope!==identities.scope||input.source.principal!==identities.principal||input.source.context!==identities.context||input.source.sourceEvents!==identities.events
    ||captured!==facts()||!Number.isFinite(initialDeadline)||!Number.isFinite(Date.now())||Date.now()>=initialDeadline)fail();};
  unchanged();if(request.method!=="POST"||request.bodyUsed)fail();
  const supplied=await readSponsorInternalCommand(request,4096);unchanged();
  if(commandJson(supplied)!==commandJson(input.command))fail();
  const state = await nativeBase(input); unchanged(); currentBase(state);
  const current = () => { unchanged(); currentBase(state); if (json(input.slot) !== slotJson || input.correlationId !== correlationId) fail(); };
  current(); const route = await outputDigest(state.native); current();
  if (proofOf(state.native).preview.requestId !== input.slot.jobId || route !== input.slot.routeDigest) fail();
  state.assertions.push({ sql: `EXISTS(SELECT 1 FROM document_jobs job JOIN output_operation_slots slot ON slot.job_id=job.job_id
    WHERE slot.scope_key=? AND slot.slot_id=? AND slot.grant_id=? AND slot.plan_revision_id=? AND slot.target_id=? AND slot.route_digest=?
      AND slot.status IN('authorized','queued','running') AND slot.attempt_ordinal=0 AND slot.previous_slot_id IS NULL
      AND job.job_id=? AND job.owner_id=? AND job.stream_id=? AND job.document_id=? AND job.kind='render_document' AND job.correlation_id=?
      AND ((job.status='queued' AND job.attempt_count=0 AND job.correlation_id=job.job_id)
        OR (job.status IN('running','committing') AND job.attempt_count=1 AND job.correlation_id=job.job_id||':attempt:1'))
      AND job.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))`, bindings: [input.slot.scopeKey, input.slot.slotId, input.slot.grantId,
        input.slot.planRevisionId,input.slot.targetId,input.slot.routeDigest,input.slot.jobId,input.source.scope.ownerUserId,
        input.source.principal.streamId,input.source.scope.documentId,correlationId] });
  await check(state.env, state.assertions, current); current();
  const handle = Object.freeze({}) as AudioSponsorRunPreparation;
  runs.set(handle, { ...state, slot: copy(input.slot), slotJson, correlationId }); return handle;
}
export async function requireAudioSponsorRunPreparation(handle: AudioSponsorRunPreparation, trusted: OutputTrustedContext, command: Record<string, unknown>) {
  const state = runs.get(handle); if (!state || commandJson(command) !== state.commandJson) fail();
  const assertCurrent = () => { if (commandJson(command) !== state.commandJson) fail(); currentBase(state, evidenceSource(state, trusted)); };
  await check(state.env, state.assertions, assertCurrent); assertCurrent();
  return { nativePreflight: state.native, quote: copy(state.quote), slot: copy(state.slot), assertions: copy(state.assertions), deadlineMs: state.deadlineMs, assertCurrent };
}
export function audioSponsorRunTransaction(handle: AudioSponsorRunPreparation, input: { request: Request; env: WorkerEnv; scope: OutputScope; slot: OutputOperationSlot; correlationId: string }) {
  const state = runs.get(handle); if (!state) fail(); currentBase(state);
  if (input.request !== state.request || input.env !== state.env || input.env.DB !== state.database || json(input.scope) !== json(state.source.scope)
    || json(input.slot) !== state.slotJson || input.correlationId !== state.correlationId) fail(); return copy(state.assertions);
}

type DispatchOwner = { env: WorkerEnv; database: WorkerEnv["DB"]; scope: OutputScope; slot: OutputOperationSlot; correlationId: string;
  generation: number; control: EventExecutionControl | null; signal: AbortSignal | null; output: EventExecutionControl["output"];
  identityJson: string; environmentJson: string };
type DispatchState = { owner: DispatchOwner; generation: number; native: OutputNativeTargetPreflight; nativeJson: string; proof: NativeProof;
  proofJson: string; control: EventExecutionControl; signal: AbortSignal; assertions: OutputSqlAssertion[]; deadlineMs: number };
const dispatchOwners = new WeakMap<AudioSponsorDispatchOwner, DispatchOwner>();
const dispatches = new WeakMap<AudioSponsorDispatchEvidence, DispatchState>();
/** Only the native execution owner calls this factory after validating its opaque
 * original financial seal. A handle alone never supplies payer/dispatch authority. */
export function createAudioSponsorDispatchOwner(input: { env: WorkerEnv; scope: OutputScope; slot: OutputOperationSlot; correlationId: string }): AudioSponsorDispatchOwner {
  const scope = copy(input.scope), slot = copy(input.slot);
  if (scope.kind !== "personal" || scope.actorUserId !== scope.ownerUserId || scope.contextId || slot.provider !== "fal"
    || slot.model !== "fal-ai/stable-audio-3/medium/text-to-audio" || slot.attemptOrdinal !== 0 || slot.previousSlotId || input.correlationId !== `${slot.jobId}:attempt:1`) fail();
  const handle = Object.freeze({}) as AudioSponsorDispatchOwner;
  dispatchOwners.set(handle, { env: input.env, database: input.env.DB, scope, slot, correlationId: input.correlationId, generation: 0, control: null, signal: null, output: undefined,
    identityJson: json({ scope, slot, correlationId: input.correlationId }), environmentJson: environmentFacts(input.env) }); return handle;
}
export function invalidateAudioSponsorDispatch(handle: AudioSponsorDispatchOwner) { const owner = dispatchOwners.get(handle); if (!owner) fail(); owner.generation++; }
export async function prepareAudioSponsorDispatchEvidence(handle: AudioSponsorDispatchOwner, input: { nativePreflight: OutputNativeTargetPreflight; control: EventExecutionControl; signal: AbortSignal }): Promise<AudioSponsorDispatchEvidence> {
  const owner = dispatchOwners.get(handle), control = input.control, signal = input.signal;
  if (!owner || !control.output || control.signal !== signal || owner.control && owner.control !== control || owner.signal && owner.signal !== signal) fail();
  requireSignal(signal); owner.control = control; owner.signal = signal; owner.output ??= control.output;
  const generation = ++owner.generation, native = input.nativePreflight, { proof, preview } = proofOf(native);
  if (preview.requestId !== owner.slot.jobId || preview.actorUserId !== owner.scope.actorUserId || preview.documentId !== owner.scope.documentId
    || preview.projectId !== owner.scope.projectId || preview.sourceDigest !== owner.slot.sourceDigest) fail();
  const nativeJson = json(native), proofJson = json(proof);
  const unchanged = () => { requireSignal(signal); if (owner.env.DB !== owner.database || environmentFacts(owner.env) !== owner.environmentJson
    || owner.generation !== generation || input.nativePreflight !== native || input.control !== control || input.signal !== signal
    || control.signal !== signal || control.output !== owner.output || owner.control !== control || owner.signal !== signal
    || json(native) !== nativeJson || json(proof) !== proofJson || outputAudioPreflightAssertions(native) !== proof) fail(); };
  unchanged();
  const row = await owner.env.DB.prepare("SELECT request_json,expires_at,lease_expires_at FROM document_jobs WHERE job_id=? AND owner_id=? AND stream_id=? AND document_id=? AND correlation_id=? AND attempt_count=1 AND status IN('running','committing')")
    .bind(owner.slot.jobId, owner.scope.ownerUserId, `creative:${owner.scope.actorUserId}`, owner.scope.documentId, owner.correlationId).first<Record<string, unknown>>();
  unchanged();
  const requestJson = own(row, "request_json"), expiresAt = own(row, "expires_at"), leaseExpiresAt = own(row, "lease_expires_at");
  if (typeof requestJson !== "string" || new TextEncoder().encode(requestJson).byteLength > 524288 || typeof expiresAt !== "string" || typeof leaseExpiresAt !== "string") fail();
  const request: unknown = JSON.parse(requestJson);
  requireAudioMiniAppCostApproval(own(request, "audioCostConsent"), preview, preview);
  const jobDeadline = Math.min(Date.parse(expiresAt), Date.parse(leaseExpiresAt));
  const assertions: OutputSqlAssertion[] = [...copy(proof), { sql: "EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND owner_id=? AND stream_id=? AND document_id=? AND correlation_id=? AND attempt_count=1 AND status IN('running','committing') AND request_json=? AND expires_at=? AND lease_expires_at=? AND lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
    bindings: [owner.slot.jobId, owner.scope.ownerUserId, `creative:${owner.scope.actorUserId}`, owner.scope.documentId, owner.correlationId, requestJson, expiresAt, leaseExpiresAt], deadlineMs: jobDeadline }];
  const state: DispatchState = { owner, generation, native, nativeJson, proof, proofJson, control, signal, assertions, deadlineMs: deadline(preview.expiresAt, assertions) };
  const evidence = Object.freeze({}) as AudioSponsorDispatchEvidence; dispatches.set(evidence, state);
  const current = () => { unchanged(); requireAudioSponsorDispatchEvidence(evidence, control); };
  current(); if (await outputDigest(native) !== owner.slot.routeDigest) fail(); current();
  await check(owner.env, assertions, current); current(); return evidence;
}
export function requireAudioSponsorDispatchEvidence(handle: AudioSponsorDispatchEvidence, control: EventExecutionControl) {
  const state = dispatches.get(handle); if (!state) fail(); const { owner, native } = state;
  requireSignal(state.signal);
  if (control !== state.control || owner.control !== control || control.output !== owner.output || control.signal !== state.signal || owner.signal !== state.signal
    || owner.env.DB !== owner.database || environmentFacts(owner.env) !== owner.environmentJson || owner.generation !== state.generation
    || owner.identityJson !== json({ scope: owner.scope, slot: owner.slot, correlationId: owner.correlationId })
    || outputAudioPreflightAssertions(native) !== state.proof || json(native) !== state.nativeJson || json(state.proof) !== state.proofJson
    || !Number.isFinite(Date.now()) || Date.now() >= state.deadlineMs) fail();
  return { env: owner.env, database: owner.database, actorUserId: owner.scope.actorUserId, jobId: owner.slot.jobId, scopeKey: owner.scope.key,
    grantId: owner.slot.grantId, slotId: owner.slot.slotId, streamId: `creative:${owner.scope.actorUserId}`, correlationId: owner.correlationId,
    signal: state.signal, control: state.control, nativePreflight: native, assertions: copy(state.assertions), deadlineMs: state.deadlineMs,
    provider: native.provider, model: native.model, routeDigest: owner.slot.routeDigest, maximumTokens: native.maximumTokens,
    maximumMicrousd: native.maximumMicrousd, maximumCalls: native.maximumCalls };
}
