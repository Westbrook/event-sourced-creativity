/** Finite transport for the real personal Audio initial output continuation.
 * The original C debit supplies accounting, never custody or write authority.
 * Every accepted native descriptor is closed below; no route installs this owner. */
import { canonicalJson } from "../src/experiences/compiler.ts";
import { experienceResourceId, type ExperiencePlan } from "../src/experiences/intake.ts";
import { continueExperienceAuthorization } from "./experience-intake-read.ts";
import { experienceOutputBinding, experienceOutputCommandKey } from "./experience-output-binding.ts";
import { scenePreparationCyclePrefix, MAX_SCENE_PREPARATION_RENEWALS } from "./experience-scene-renewal.ts";
import { createAudioOutputContract } from "../src/model/output-audio-contract.ts";
import { createExperienceOutputRecipe } from "./experience-output-recipe.ts";
import { requireSponsorAudioOutputReadBudget, retireSponsorAudioOutputReadBudget, type SponsorAudioOutputReadBudget } from "./experience-sponsor-audio-output-attempts.ts";
import { packSponsorIntakeReadQuery } from "./experience-sponsor-intake-read-sql.ts";
import { SponsorEntitlementError } from "./experience-sponsor-policy.ts";
import { recognizeNativePredicate, recognizeNativeScalarAssertion, type ConfirmationMutationIdentity } from "./experience-sponsor-image-confirmation-native.ts";
import { outputCommandReceiptAssertion, outputScopeAuthority, retainedOutputBodyAssertions, type OutputSqlAssertion } from "./output-command-core.ts";
import { EVENT_WRITE_COLUMNS, EVENT_WRITE_STAGE_TRIGGER_SQL, eventWriteBindings, type EventRow } from "./event-write-primitives.ts";
import type { ProjectIntakeAuthorization } from "./intake-authority.ts";
import { outputDigest, outputActiveSourceDeadlineAssertions } from "./output-disclosure-proof.ts";
import { compileOutputPlan } from "../src/model/output-plan.ts";
import type { OutputRequirementSpec } from "../src/model/output-requirements.ts";
import { outputTargetContractDigest } from "./output-requirements-api.ts";
import { isSponsorAudioOutputTrustedContext, isSponsorAudioOutputFinalResponse } from "./experience-output-api.ts";
import { isSponsorAudioOutputSourceProof } from "./output-audio-source.ts";
import { takeSponsorAudioOutputNativeRead, isSponsorAudioOutputNativeProof, isSponsorAudioOutputNativePlan,
  type SponsorAudioOutputNativeRead } from "./experience-sponsor-audio-output-native.ts";
import { outputAudioPreflightAssertions } from "./output-audio-preflight.ts";
import type { OutputNativeTargetPreflight, OutputPlanSuggestions } from "../src/model/output-delivery-contract.ts";
import type { OutputBridgeTargetInput, OutputTrustedContext } from "./output-requirements-api.ts";
import { OUTPUT_REQUIREMENTS_SCHEMA } from "./output-requirements-schema.ts";
import { SCENE_SOURCE_GENERATION_TABLES } from "../db/scene-source-generation-tables.ts";
import { SCENE_SOURCE_GENERATION_TRIGGERS } from "../db/scene-source-generations.ts";
import type { WorkerEnv } from "./runtime.ts";

type Value = string | number | null;
type Row = Record<string, unknown>;
type Proof = Readonly<{ sql: string; bindings?: readonly Value[]; deadlineMs?: number }>;
type Captured = Readonly<{ sql: string; bindings: readonly Value[] }>;
type Budget = ReturnType<typeof requireSponsorAudioOutputReadBudget>;
type Descriptor = { kind: string; columns: readonly string[]; maximumRows: number; order?: string };
export type SponsorAudioOutputRows = { sql: string; bindings: readonly unknown[]; columns: readonly string[]; maximumRows: number; invalidRow: string; assertions?: readonly Proof[] };
declare const ownerBrand: unique symbol;
export type SponsorAudioOutputReadOwner = Readonly<{ [ownerBrand]: true }>;
type Identity = ConfirmationMutationIdentity & { keys: Readonly<Record<string, string>>; plan: ExperiencePlan; planBytes: string; target: Row };
type Stage = { trusted: OutputTrustedContext; envelope: Readonly<Row>; serialized: string; phase: "save" | "confirm" | "preflight"; dispatched: boolean; lostAckRead?: boolean; lostAckInFlight?: boolean; recovered?: boolean; proofs: readonly Proof[]; sourcePrefix: readonly Proof[] };
type NativeContext = { facts: string; source: readonly Proof[]; check: () => void };
type State = {
  owner: SponsorAudioOutputReadOwner; request: Request; originalEnv: WorkerEnv; env: WorkerEnv; db: WorkerEnv["DB"]; budget: SponsorAudioOutputReadBudget; data: Budget;
  auth: ProjectIntakeAuthorization; closed: boolean; bodyRead: boolean; transporting?: boolean; identity?: () => Promise<Identity>; identityPending?: Promise<Identity>; resolvedIdentity?: Identity; contexts: WeakMap<OutputTrustedContext, NativeContext>; currentContext?: OutputTrustedContext; frame?: DisclosureFrame; planBytes?: string;
  proofs: Proof[]; observedBodies: Map<string, { raw: string; projectId: string | null; documentId: string | null }>;
  observedEvents: Set<string>; observedPlans: Set<string>; planEvents: Set<string>; preflightEvents: Set<string>;
  statements: WeakMap<D1PreparedStatement, Captured>; stage?: Stage;
};
const openedBudgets = new WeakSet<SponsorAudioOutputReadBudget>();
type DisclosureFrame = { trusted: OutputTrustedContext; proof: readonly Captured[]; completed: boolean; facts: string; deadlineMs: number };
const responses = new WeakMap<Response, { state: State; frame: DisclosureFrame; status: number; headers: string }>();
const stageInputs = new WeakMap<Stage, OutputBridgeTargetInput>();
const stageInputChecks = new WeakMap<Stage, () => void>();
const owners = new WeakMap<SponsorAudioOutputReadOwner, State>(), environments = new WeakMap<WorkerEnv, State>();
const ACK_BYTES = 16_384;
const encoder = new TextEncoder(), byteLength = (value: string) => encoder.encode(value).byteLength;
const fail = (code = "sponsor_audio_output_native_unavailable"): never => { throw new SponsorEntitlementError(code); };
const scalar = (value: unknown): value is Value => value === null || typeof value === "string" || typeof value === "number" && Number.isFinite(value);
const integer = (value: unknown, minimum = 0): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
const same = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((v, index) => Object.is(v, b[index]));
const record = (value: unknown): value is Row => !!value && typeof value === "object" && !Array.isArray(value);
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value);
const digest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const iso = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const own = (value: object, key: PropertyKey) => { const item = Object.getOwnPropertyDescriptor(value, key); return item && Object.hasOwn(item, "value") ? item.value : fail(); };
function capturedProof(proof: Proof): Proof {
  if (typeof proof.sql !== "string" || !proof.sql || proof.sql.includes("\0") || byteLength(proof.sql) > 100_000
    || !Array.isArray(proof.bindings ?? []) || (proof.bindings ?? []).some(value => !scalar(value))
    || proof.deadlineMs !== undefined && !Number.isFinite(proof.deadlineMs)) return fail();
  return Object.freeze({ sql: proof.sql, bindings: Object.freeze([...(proof.bindings ?? [])]), ...(proof.deadlineMs === undefined ? {} : { deadlineMs: proof.deadlineMs }) });
}
function current(state: State) {
  if (state.closed) return fail();
  try {
    state.data.current();
    if (state.currentContext) {
      const context = state.contexts.get(state.currentContext) ?? fail(); context.check();
      if (state.stage?.trusted !== state.currentContext && !sameProofArray(state.currentContext.sourceAssertions, context.source)) return fail();
    }
    if (state.stage) stageChecks.get(state.stage)?.();
    if (state.frame && (disclosureFacts(state.frame.trusted) !== state.frame.facts || Date.now() >= state.frame.deadlineMs)) return fail();
    if (state.originalEnv.DB !== state.db || state.env.DB === state.db || state.auth.user !== state.data.authenticated.user
      || state.proofs.some(proof => proof.deadlineMs !== undefined && Date.now() >= proof.deadlineMs)) return fail();
  } catch (error) { closeSponsorAudioOutputReads(state.owner); throw error; }
}
function get(owner: SponsorAudioOutputReadOwner, request?: Request, env?: WorkerEnv): State {
  const state = owners.get(owner);
  if (!state || request !== undefined && request !== state.request || env !== undefined && env !== state.originalEnv && env !== state.env) return fail();
  current(state); return state;
}
/** Descriptor-safe complete native result capture; a malformed ACK never earns authority. */
function captureResult(value: unknown, maximum: number) {
  const seen = new Set<object>(); let measured = 0;
  const visit = (item: unknown, depth: number): unknown => {
    if (depth > 64) return fail();
    if (item === null || typeof item === "boolean" || typeof item === "number" && Number.isFinite(item)) return item;
    if (typeof item === "string") { if (!item.isWellFormed() || (measured += byteLength(item)) > maximum) return fail(); return item; }
    if (!item || typeof item !== "object" || seen.has(item) || ![Object.prototype, Array.prototype, null].includes(Object.getPrototypeOf(item))) return fail();
    seen.add(item);
    if (Array.isArray(item)) {
      if (!integer(item.length) || item.length > 1_000_000 || Reflect.ownKeys(item).length !== item.length + 1) return fail();
      const result = Array.from({ length: item.length }, (_, at) => visit(own(item, at), depth + 1)); seen.delete(item); return result;
    }
    const result: Row = {};
    for (const key of Reflect.ownKeys(item)) {
      if (typeof key !== "string" || (measured += byteLength(key)) > maximum) return fail();
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) return fail();
      Object.defineProperty(result, key, { value: visit(descriptor.value, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    seen.delete(item); return result;
  };
  const result = visit(value, 0), serialized = JSON.stringify(result), bytes = byteLength(serialized);
  if (bytes > maximum) return fail("sponsor_audio_output_read_limit_reached");
  return { value: result, bytes };
}
function acknowledgement(value: unknown): asserts value is D1Result<Row> {
  if (!record(value) || value.success !== true || !Object.hasOwn(value, "success") || Object.hasOwn(value, "error")
    || !Array.isArray(value.results) || value.results.some(row => !record(row))) return fail("sponsor_audio_output_native_ack_invalid");
}
/** Join only caller-constructed predicate leaves without a left-deep SQL tree. */
function balancedConjunction(leaves: readonly string[]): string {
  if (!leaves.length) return fail();
  if (leaves.length === 1) return leaves[0]!;
  const middle = Math.floor(leaves.length / 2);
  return `(${balancedConjunction(leaves.slice(0, middle))} AND ${balancedConjunction(leaves.slice(middle))})`;
}
function composeRows(state: State, input: SponsorAudioOutputRows, maximum: number) {
  current(state);
  const b = input.bindings;
  if (typeof input.sql !== "string" || !input.sql || input.sql.includes("\0") || !Array.isArray(b) || b.some(value => !scalar(value))
    || !integer(input.maximumRows) || input.maximumRows > 1_000_000 || !input.columns.length || input.columns.length > 32 || typeof input.invalidRow !== "string" || !input.invalidRow || input.invalidRow.includes("\0")
    || input.columns.some(key => !/^[a-z][a-z0-9_]*$/u.test(key)) || new Set(input.columns).size !== input.columns.length) return fail();
  const proofs: Proof[] = [];
  for (const raw of [...state.proofs, ...(input.assertions ?? [])]) {
    const proof = capturedProof(raw);
    // The real native intake check repeats its exact draft/custody predicate.
    // Retain one identical observation; never drop a distinct scalar or expiry.
    if (!proofs.some(previous => previous.sql === proof.sql && previous.deadlineMs === proof.deadlineMs
      && same(previous.bindings ?? [], proof.bindings ?? []))) proofs.push(proof);
  }
  if (!proofs.length) return fail();
  let prefix = "audio_output_native";
  const source = [input.sql, ...proofs.map(proof => proof.sql)].join("\n").toLowerCase();
  while (source.includes(prefix)) prefix += "_";
  const gateNames = proofs.map((_, index) => `${prefix}_gate_${index}`), authority = `${prefix}_authority`, rows = `${prefix}_rows`, meta = `${prefix}_meta`;
  const data = `json_array(${input.columns.map(column => `row."${column}"`).join(",")})`;
  // Each predicate yields one truth row. False/NULL cannot disappear and masquerade as an empty authorized source.
  const gates = proofs.map((proof, at) => `${gateNames[at]} AS MATERIALIZED (SELECT CASE WHEN (${proof.sql}) THEN 1 ELSE 0 END AS allowed)`);
  const valid = balancedConjunction(gateNames.map(name => `(SELECT allowed FROM ${name})=1`));
  // A native proof SELECT often asks for the very same scalar already required
  // by an authority gate. Reuse that exact materialized truth row, including
  // its false/NULL-to-zero behavior, instead of duplicating SQL and parameters.
  const shared = input.columns.length === 1 && input.columns[0] === "current" ? proofs.findIndex(proof =>
    input.sql === `SELECT CASE WHEN (${proof.sql}) THEN 1 ELSE 0 END AS current` && same(b, proof.bindings ?? [])) : -1;
  const rowSource = shared < 0 ? input.sql : `SELECT allowed AS current FROM ${gateNames[shared]}`;
  const sql = `WITH ${gates.join(",")},${authority} AS MATERIALIZED (SELECT CASE WHEN ${valid} THEN 1 ELSE 0 END AS allowed),
    ${rows} AS MATERIALIZED (${rowSource}),${meta} AS MATERIALIZED (SELECT COUNT(*) AS count,COALESCE(SUM(CASE WHEN NOT(${input.invalidRow}) THEN 0 ELSE 1 END),0) AS invalid,json_group_array(${data}) AS body FROM ${rows} row)
    SELECT allowed AS authorized,count,CASE WHEN allowed=1 AND invalid=0 AND count<=${input.maximumRows}
      AND length(CAST(json_object('body',body||'') AS BLOB))<=${Math.max(0, maximum - ACK_BYTES)} THEN body ELSE NULL END AS body
    FROM ${meta} CROSS JOIN ${authority}`;
  const packed = packSponsorIntakeReadQuery(sql, [...proofs.flatMap(proof => proof.bindings ?? []), ...(shared < 0 ? b : [])]);
  return { packed, witnessSql: `COALESCE((SELECT json_group_array(${data}) FROM (${input.sql}) row),'[]')=?` };
}
async function readRowsUnchecked(state: State, input: SponsorAudioOutputRows): Promise<{ result: D1Result<Row>; witness: OutputSqlAssertion }> {
  current(state); const remaining = state.data.remaining();
  if (remaining.queries < 1 || remaining.rows < 1 || remaining.bytes < ACK_BYTES) return fail("sponsor_audio_output_read_limit_reached");
  const maximumRows = Math.min(input.maximumRows, Math.max(0, remaining.rows - 1));
  const { packed, witnessSql } = composeRows(state, { ...input, maximumRows }, remaining.bytes);
  state.data.account({ bytes: 0, queries: 1, rows: 0 });
  const raw = await state.data.wait(() => state.db.prepare(packed.sql).bind(...packed.bindings).all<Row>()); current(state);
  const captured = captureResult(raw, state.data.remaining().bytes); acknowledgement(captured.value);
  const result = captured.value, row = result.results[0];
  if (result.results.length !== 1 || !row || !same(Object.keys(row), ["authorized", "count", "body"]) || row.authorized !== 1
    || !integer(row.count) || row.count > maximumRows || typeof row.body !== "string") {
    state.data.account({ bytes: captured.bytes, queries: 0, rows: Math.max(1, result.results.length) });
    return fail("sponsor_audio_output_native_read_denied");
  }
  const decoded: unknown = JSON.parse(row.body);
  if (!Array.isArray(decoded) || decoded.length !== row.count || decoded.some(value => !Array.isArray(value) || value.length !== input.columns.length)) return fail();
  state.data.account({ bytes: captured.bytes, queries: 0, rows: 1 + decoded.length }); current(state);
  const native = { ...result, results: decoded.map(value => Object.fromEntries(input.columns.map((key, at) => [key, value[at]]))) };
  return { result: native, witness: { sql: witnessSql, bindings: [...input.bindings as Value[], row.body] } };
}
async function readRows(state: State, input: SponsorAudioOutputRows) {
  if (state.transporting) { closeSponsorAudioOutputReads(state.owner); return fail("sponsor_audio_output_parallel_read_refused"); }
  state.transporting = true;
  try { return await readRowsUnchecked(state, input); } catch (error) { closeSponsorAudioOutputReads(state.owner); throw error; }
  finally { state.transporting = false; }
}
function keepProofs(state: State, proofs: readonly Proof[]): void {
  for (const raw of proofs) {
    const proof = capturedProof(raw);
    if (!state.proofs.some(old => old.sql === proof.sql && old.deadlineMs === proof.deadlineMs && same(old.bindings ?? [], proof.bindings ?? []))) state.proofs.push(proof);
  }
  current(state);
}
export function retainSponsorAudioOutputProofs(owner: SponsorAudioOutputReadOwner, proofs: readonly Proof[]): void {
  const state = get(owner);
  if (!Array.isArray(proofs)) return fail();
  for (const proof of proofs) if (!isSponsorAudioOutputNativeProof(owner, proof) && !isSponsorAudioOutputSourceProof(owner, proof)
    && !state.proofs.some(old => old.sql === proof.sql && old.deadlineMs === proof.deadlineMs && same(old.bindings ?? [], proof.bindings ?? [])))
    return fail("sponsor_audio_output_native_proof_unowned");
  keepProofs(state, proofs);
}
export function retainSponsorAudioOutputTrustedContext(owner: SponsorAudioOutputReadOwner, trusted: OutputTrustedContext): void {
  const state = get(owner), i = state.resolvedIdentity;
  if (!i || !isSponsorAudioOutputTrustedContext(owner, trusted) || trusted.request !== state.request || trusted.env !== state.env
    || trusted.principal !== state.auth.user || trusted.scope.kind !== "personal" || trusted.scope.ownerUserId !== i.owner
    || trusted.scope.actorUserId !== i.owner || trusted.scope.projectId !== i.projectId || trusted.scope.documentId !== i.documentId) return fail();
  if (state.contexts.has(trusted)) return fail("sponsor_audio_output_native_context_reissued");
  const check = lockNativeData(trusted, new Set([state.request, state.env, state.auth.user, trusted.sourceAssertions]));
  // Native preflight appends proven deadline/quote predicates to this one array.
  // Existing predicate objects and every other native input remain immutable.
  for (const proof of trusted.sourceAssertions) lockNativeData(proof);
  state.contexts.set(trusted, { facts: trustedFacts(trusted), source: trusted.sourceAssertions.map(capturedProof), check }); state.currentContext = trusted;
  keepProofs(state, [...trusted.sourceAssertions, ...(trusted.context ? outputActiveSourceDeadlineAssertions(trusted.context) : [])]);
}
export function requireSponsorAudioOutputReads(owner: SponsorAudioOutputReadOwner, request?: Request, env?: WorkerEnv) {
  const state = get(owner, request, env);
  return Object.freeze({ request: state.request, originalEnv: state.originalEnv, env: state.env, nativeEnv: state.env,
    auth: state.auth, authenticated: state.data.authenticated, original: state.data.original, operation: state.data.operation, draftId: state.data.draftId,
    get assertions() { current(state); return [...state.proofs]; }, current: () => current(state),
    remaining: () => { current(state); return state.data.remaining(); },
    wait: <T>(work: () => Promise<T>) => state.data.wait(async () => { current(state); const value = await work(); current(state); return value; }),
    readRows: <T extends Row = Row>(token: SponsorAudioOutputNativeRead) => readRows(state, takeSponsorAudioOutputNativeRead(token, owner)) as Promise<{ result: D1Result<T>; witness: OutputSqlAssertion }>,
    accountSerialized(text: string) { current(state); state.data.accountResponse(text); current(state); },
  });
}
export function findSponsorAudioOutputReads(request: Request, env: WorkerEnv): SponsorAudioOutputReadOwner | null {
  const state = environments.get(env); if (!state) return null;
  get(state.owner, request, env); return state.owner;
}
export async function openSponsorAudioOutputReads(request: Request, env: WorkerEnv, budget: SponsorAudioOutputReadBudget): Promise<SponsorAudioOutputReadOwner> {
  const data = requireSponsorAudioOutputReadBudget(budget, request, env);
  if (openedBudgets.has(budget)) return fail();
  openedBudgets.add(budget);
  if (!["audio-output-state", "audio-output-prepare"].includes(data.operation)) return fail();
  const owner = Object.freeze({}) as SponsorAudioOutputReadOwner;
  const state = { owner, request, originalEnv: env, db: env.DB, budget, data, closed: false, bodyRead: false,
    proofs: data.assertions.map(capturedProof), contexts: new WeakMap(), observedBodies: new Map(), observedEvents: new Set(), observedPlans: new Set(), planEvents: new Set(), preflightEvents: new Set(), statements: new WeakMap(),
  } as State;
  const nativeEnv = Object.freeze({ ...env, DB: nativeDatabase(state), MEDIA: new Proxy({} as WorkerEnv["MEDIA"], { get: () => () => fail("sponsor_audio_output_media_unavailable") }) });
  state.env = nativeEnv;
  // Native authorization is continued from the same real result. This temporary
  // bootstrap does not expose the owner before that actual continuation succeeds.
  const auth = await data.wait(() => continueExperienceAuthorization(request, nativeEnv, data.authenticated));
  if (auth instanceof Response) { retireSponsorAudioOutputReadBudget(budget, request, env); return fail(); }
  state.auth = Object.freeze(auth); owners.set(owner, state); environments.set(nativeEnv, state); current(state); return owner;
}
export function closeSponsorAudioOutputReads(owner: SponsorAudioOutputReadOwner): void {
  const state = owners.get(owner); if (!state || state.closed) return;
  state.closed = true; try { retireSponsorAudioOutputReadBudget(state.budget, state.request, state.originalEnv); } catch { /* Already permanently retired. */ }
}
export function setSponsorAudioOutputNativePlan(owner: SponsorAudioOutputReadOwner, plan: ExperiencePlan): void {
  const state = get(owner); if (!isSponsorAudioOutputNativePlan(owner, plan)) return fail();
  const serialized = canonicalJson(plan);
  if (state.planBytes !== undefined) { if (state.planBytes !== serialized) return fail(); return; }
  if (plan.draftId !== state.data.draftId || plan.streamId !== state.auth.user.streamId || plan.release.output.output !== "audio"
    || Object.hasOwn(plan, "reference") || Object.hasOwn(plan.request, "reference")) return fail();
  state.planBytes = serialized;
  keepProofs(state, [sponsorAudioNativeSchemaProof()]);
  state.identity = async () => {
    const binding = await experienceOutputBinding(plan); current(state);
    const [requirementId, deliverableId, ...keys] = await Promise.all([
      experienceResourceId(plan.draftId, "native-output-requirement"), experienceResourceId(plan.draftId, "native-output-deliverable"),
      ...["save", "confirm", "preflight", "authorize", "run"].map(phase => experienceOutputCommandKey(binding, phase as "save")),
    ]); current(state);
    const contract = createAudioOutputContract({ draftId: binding.draftId, draftHash: binding.draftHash, releaseHash: binding.releaseHash, requestHash: binding.requestHash, sourceBindingHash: binding.sourceBindingHash });
    if (!contract) return fail();
    const recipe = createExperienceOutputRecipe({ output: "audio", requirementId, deliverableId, contract });
    const value: Identity = { owner: state.auth.user.userId, stream: plan.streamId, projectId: plan.projectId, documentId: plan.documentId,
      scopeKey: `personal:${state.auth.user.userId}:${plan.projectId}`, requirementId, targetId: recipe.targetId,
      allowedCommandKeys: keys.slice(0, 2), keys: Object.fromEntries(["save", "confirm", "preflight", "authorize", "run"].map((phase, at) => [phase, keys[at]!])),
      knownAssertions: [], observedBodies: state.observedBodies, plan, planBytes: serialized, target: recipe.spec as unknown as Row };
    state.resolvedIdentity = value; return value;
  };
}
async function identity(state: State): Promise<Identity> {
  current(state); if (!state.identity) return fail();
  // Start only when an actual caller awaits it. A failed earlier custody read
  // must not leave unobserved hashing work behind a permanently retired owner.
  const value = await (state.identityPending ??= state.identity()); current(state);
  if (canonicalJson(value.plan) !== value.planBytes) return fail();
  return { ...value, knownAssertions: [...state.proofs, ...(state.stage?.proofs ?? [])], ...(state.stage ? { expectedHead: state.stage.trusted.ownerHead } : {}) };
}

// Exact common native producer text; Image capability and mutation logic are not reused.
const HEAD_READ = "SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?";
const PAGE_READ = "SELECT * FROM events LEFT JOIN event_private_payloads secret ON secret.private_event_id=events.event_id AND secret.redacted_at IS NULL WHERE stream_id=? AND sequence>? ORDER BY sequence ASC LIMIT ?";
const GOVERNED_READ = "SELECT 1 AS present FROM organization_projects WHERE owner_user_id=? AND project_id=? LIMIT 1";
const SOURCE_READ = "SELECT private_event_id,private_json,project_id,document_id FROM event_private_payloads WHERE owner_id=? AND private_event_id IN(SELECT value FROM json_each(?)) AND redacted_at IS NULL";
const BODY_READ = "SELECT private_json FROM event_private_payloads WHERE private_event_id=? AND owner_id=? AND project_id=? AND document_id=? AND redacted_at IS NULL";
const OCCUPIED_READ = "SELECT COUNT(*) AS count FROM events WHERE stream_id=? AND type='BlockCreated' AND json_extract(payload,'$.block_id')=?";
const PLAN_READ = (specific: boolean) => `SELECT * FROM output_plan_revisions WHERE scope_key=? AND document_id=? ${specific ? "AND plan_revision_id=?" : ""} ORDER BY revision DESC LIMIT 1`;
const COMMAND_INDEX_READ = `SELECT command.request_digest,command.event_id,event.sequence
    FROM output_commands command LEFT JOIN events event ON event.event_id=command.event_id
    WHERE command.scope_key=? AND command.actor_user_id=? AND command.command_key=?`;
const ACTIVE_COMMITMENT = `(slot.status IN('authorized','queued','running','uncertain') OR EXISTS(SELECT 1 FROM output_provider_calls pending
  WHERE pending.scope_key=slot.scope_key AND pending.slot_id=slot.slot_id AND (pending.used_microusd IS NULL OR pending.status IN('pending','uncertain'))))`;
const COMMITMENTS_READ = `SELECT slot.slot_id,slot.grant_id,slot.job_id,slot.target_id,slot.plan_revision_id,CASE WHEN ${ACTIVE_COMMITMENT} THEN 1 ELSE 0 END AS active
    FROM output_operation_slots slot JOIN output_plan_revisions plan ON plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id
    WHERE slot.scope_key=? AND plan.document_id=?`;
const EVENT_COLUMNS = ["event_id", "stream_id", "sequence", "occurred_at", "recorded_at", "actor", "client_id", "correlation_id", "causation_id", "compensates_event_id", "schema_version", "type", "payload", "private_event_id", "owner_id", "project_id", "document_id", "private_json", "created_at", "redacted_at"];
const PLAN_COLUMNS = ["scope_key", "scope_kind", "owner_user_id", "project_id", "document_id", "organization_id", "project_access_id", "plan_revision_id", "plan_id", "revision", "confirmed_event_id", "requirements_digest", "source_digest", "resolver_version", "source_head", "target_count", "created_at"];
const COMMAND_READ = `SELECT command.action,command.event_id,command.request_digest,command.created_at,body.private_json,
      event.stream_id,event.actor,event.client_id,event.correlation_id,
      json_extract(event.payload,'$.project_id') AS project_id,json_extract(event.payload,'$.document_id') AS document_id
    FROM output_commands command JOIN events event ON event.event_id=command.event_id
    LEFT JOIN event_private_payloads body ON body.private_event_id=command.event_id
      AND body.owner_id=? AND body.project_id=? AND body.document_id=? AND body.redacted_at IS NULL
    WHERE command.scope_key=? AND command.actor_user_id=? AND command.command_key=?`;
const RENEWAL_READ = `SELECT command_key FROM output_commands
    WHERE scope_key=? AND actor_user_id=? AND substr(command_key,1,?)=? ORDER BY command_key LIMIT ?`;
const LATEST_OPERATIONS_READ = `SELECT slot.*,EXISTS(SELECT 1 FROM output_provider_calls call
      WHERE call.scope_key=slot.scope_key AND call.slot_id=slot.slot_id AND (call.used_microusd IS NULL OR call.status IN('pending','uncertain'))) AS unresolved_cost
    FROM output_operation_slots slot JOIN output_plan_revisions retained_plan ON retained_plan.scope_key=slot.scope_key AND retained_plan.plan_revision_id=slot.plan_revision_id
    JOIN json_each(?) wanted ON slot.target_id=json_extract(wanted.value,'$.targetId') AND slot.target_contract_digest=json_extract(wanted.value,'$.contract')
    WHERE slot.scope_key=? AND retained_plan.document_id=? AND NOT EXISTS(SELECT 1 FROM output_operation_slots newer
      WHERE newer.scope_key=slot.scope_key AND newer.target_id=slot.target_id AND newer.target_contract_digest=slot.target_contract_digest AND newer.attempt_ordinal>slot.attempt_ordinal)`;
const SLOT_COLUMNS = ["scope_key", "slot_id", "grant_id", "plan_revision_id", "target_id", "target_contract_digest", "source_digest", "provider", "model", "route_digest", "job_id", "cost_reservation_id", "token_reservation_id", "maximum_microusd", "maximum_calls", "maximum_tokens", "attempt_ordinal", "previous_slot_id", "status", "outcome_event_id", "created_at", "updated_at", "unresolved_cost"];
const COMMAND_COLUMNS = ["action", "event_id", "request_digest", "created_at", "private_json", "stream_id", "actor", "client_id", "correlation_id", "project_id", "document_id"];
function parsed(raw: unknown): Row | null {
  if (typeof raw !== "string") return null;
  try { const value: unknown = JSON.parse(raw); return record(value) ? value : null; } catch { return null; }
}
function actualPlanBody(state: State, revision?: string): Row | null {
  for (const eventId of state.planEvents) {
    const value = parsed(state.observedBodies.get(eventId)?.raw), plan = value?.confirmed_plan;
    if (record(plan) && (revision === undefined || plan.revisionId === revision)) return plan;
  }
  return null;
}
function describeRead(state: State, sql: string, b: readonly Value[], i: Identity): Descriptor {
  const scalar = recognizeNativeScalarAssertion(sql, b, i);
  if (scalar) return { kind: "proof", columns: ["current"], maximumRows: 1 };
  if (sql === "SELECT CASE WHEN (? > strftime('%Y-%m-%dT%H:%M:%fZ','now')) THEN 1 ELSE 0 END AS current" && b.length === 1) {
    const plan = actualPlanBody(state);
    if (plan && iso(plan.confirmedAt) && b[0] === new Date(Date.parse(plan.confirmedAt) + 900_000).toISOString())
      return { kind: "proof", columns: ["current"], maximumRows: 1 };
  }
  if (sql === HEAD_READ && same(b, [i.stream])) return { kind: "head", columns: ["head"], maximumRows: 1 };
  if (sql === PAGE_READ && b.length === 3 && b[0] === i.stream && integer(b[1]) && b[2] === 5000)
    return { kind: "events", columns: EVENT_COLUMNS, maximumRows: 5000 };
  if (sql === GOVERNED_READ && same(b, [i.owner, i.projectId])) return { kind: "empty", columns: ["present"], maximumRows: 0 };
  if (sql === SOURCE_READ && b.length === 2 && b[0] === i.owner && typeof b[1] === "string") {
    const ids: unknown = JSON.parse(b[1]);
    if (Array.isArray(ids) && new Set(ids).size === ids.length && ids.every(id => typeof id === "string" && state.observedEvents.has(id)))
      return { kind: "source", columns: ["private_event_id", "private_json", "project_id", "document_id"], maximumRows: ids.length };
  }
  if (sql === BODY_READ && b.length === 4 && typeof b[0] === "string" && (state.planEvents.has(b[0]) || state.preflightEvents.has(b[0]))
    && same(b.slice(1), [i.owner, i.projectId, i.documentId])) return { kind: "private-body", columns: ["private_json"], maximumRows: 1 };
  if (sql === OCCUPIED_READ && same(b, [i.stream, i.requirementId])) return { kind: "occupied", columns: ["count"], maximumRows: 1 };
  if (sql === PLAN_READ(false) && same(b, [i.scopeKey, i.documentId]) || sql === PLAN_READ(true) && b.length === 3
    && same(b.slice(0, 2), [i.scopeKey, i.documentId]) && typeof b[2] === "string" && state.observedPlans.has(b[2]))
    return { kind: "plan", columns: PLAN_COLUMNS, maximumRows: 1 };
  if (sql === COMMAND_INDEX_READ && b.length === 3 && same(b.slice(0, 2), [i.scopeKey, i.owner]) && Object.values(i.keys).includes(String(b[2])))
    return { kind: [i.keys.authorize, i.keys.run].includes(String(b[2])) ? "empty" : "command-index", columns: ["request_digest", "event_id", "sequence"], maximumRows: [i.keys.authorize, i.keys.run].includes(String(b[2])) ? 0 : 1 };
  if (sql === COMMAND_READ && b.length === 6 && same(b.slice(0, 5), [i.owner, i.projectId, i.documentId, i.scopeKey, i.owner])
    && [i.keys.save, i.keys.confirm, i.keys.preflight].includes(String(b[5]))) return { kind: "command", columns: COMMAND_COLUMNS, maximumRows: 1 };
  const prefix = scenePreparationCyclePrefix(i.plan.draftId, "audio");
  if (sql === RENEWAL_READ && same(b, [i.scopeKey, i.owner, prefix.length, prefix, MAX_SCENE_PREPARATION_RENEWALS * 4 + 1]))
    return { kind: "empty", columns: ["command_key"], maximumRows: 0 };
  if (sql === COMMITMENTS_READ && same(b, [i.scopeKey, i.documentId]))
    return { kind: "empty", columns: ["slot_id", "grant_id", "job_id", "target_id", "plan_revision_id", "active"], maximumRows: 0 };
  if (sql === "SELECT 1 AS present FROM output_operation_slots WHERE scope_key=? AND plan_revision_id=? LIMIT 1"
    && b.length === 2 && b[0] === i.scopeKey && typeof b[1] === "string" && state.observedPlans.has(b[1]))
    return { kind: "empty", columns: ["present"], maximumRows: 0 };
  if (sql === "SELECT 1 AS present FROM output_preflights WHERE scope_key=? AND plan_revision_id=? AND actor_user_id=? LIMIT 1"
    && b.length === 3 && b[0] === i.scopeKey && typeof b[1] === "string" && state.observedPlans.has(b[1]) && b[2] === i.owner)
    return { kind: "empty", columns: ["present"], maximumRows: 0 };
  if (sql === LATEST_OPERATIONS_READ && b.length === 3 && same(b.slice(1), [i.scopeKey, i.documentId]) && typeof b[0] === "string") {
    const plan = actualPlanBody(state);
    if (plan && record(plan.targetContractDigests) && b[0] === JSON.stringify([{ targetId: i.targetId, contract: plan.targetContractDigests[i.targetId] }]))
      return { kind: "empty", columns: SLOT_COLUMNS, maximumRows: 0 };
  }
  return fail("sponsor_audio_output_native_query_changed");
}
function invalidNativeRow(descriptor: Descriptor, i: Identity): string {
  const numeric = new Set(["head", "count", "current", "sequence", "schema_version", "revision", "source_head", "target_count", "active", "ordinal", "required", "selected"]);
  const nullable = new Set(["causation_id", "compensates_event_id", "private_event_id", "owner_id", "project_id", "document_id", "private_json", "redacted_at", "organization_id", "project_access_id"]);
  if (descriptor.kind === "events") nullable.add("created_at");
  const terms = descriptor.columns.map(column => {
    const field = `row."${column}"`, valid = numeric.has(column)
      ? `(typeof(${field}) IN('integer','real') AND ${field}>=0 AND ${field}<=9007199254740991 AND ${field}=CAST(${field} AS INTEGER))`
      : `(typeof(${field})='text' AND length(CAST(${field} AS BLOB))<=${column === "private_json" ? 16 * 1024 * 1024 : 2_000_000})`;
    return `NOT(${nullable.has(column) ? `${field} IS NULL OR ` : ""}${valid})`;
  });
  if (descriptor.kind === "events") terms.push(`row.private_json IS NOT NULL AND (typeof(row.private_json)<>'text' OR NOT json_valid(row.private_json)
    OR row.created_at IS NULL OR row.private_event_id IS NOT row.event_id OR row.owner_id IS NOT '${i.owner.replaceAll("'", "''")}')`);
  if (["source", "private-body", "command"].includes(descriptor.kind)) terms.push("row.private_json IS NULL OR typeof(row.private_json)<>'text' OR NOT json_valid(row.private_json)");
  return terms.map(term => `(${term})`).join(" OR ");
}
function rememberBody(state: State, id: unknown, raw: unknown, projectId: unknown, documentId: unknown) {
  if (typeof id !== "string" || typeof raw !== "string" || !raw.isWellFormed() || projectId !== null && typeof projectId !== "string"
    || documentId !== null && typeof documentId !== "string") return fail();
  const previous = state.observedBodies.get(id);
  if (previous && (previous.raw !== raw || previous.projectId !== projectId || previous.documentId !== documentId)) return fail("sponsor_audio_output_native_body_changed");
  state.observedBodies.set(id, { raw, projectId, documentId });
}
function observe(state: State, d: Descriptor, rows: Row[], input: Captured, i: Identity) {
  for (const row of rows) {
    if (d.kind === "events") {
      if (row.stream_id !== i.stream || typeof row.event_id !== "string" || !integer(row.sequence, 1)) return fail();
      state.observedEvents.add(row.event_id);
      if (row.private_json !== null) {
        if (row.private_event_id !== row.event_id || row.owner_id !== i.owner) return fail();
        rememberBody(state, row.event_id, row.private_json, row.project_id, row.document_id);
      }
    } else if (d.kind === "source") rememberBody(state, row.private_event_id, row.private_json, row.project_id, row.document_id);
    else if (d.kind === "private-body") rememberBody(state, input.bindings[0], row.private_json, i.projectId, i.documentId);
    else if (d.kind === "plan") {
      if (!same([row.scope_key, row.scope_kind, row.owner_user_id, row.project_id, row.document_id, row.organization_id, row.project_access_id],
        [i.scopeKey, "personal", i.owner, i.projectId, i.documentId, null, null]) || !uuid(row.plan_revision_id) || !uuid(row.confirmed_event_id)) return fail();
      state.observedPlans.add(row.plan_revision_id); state.planEvents.add(row.confirmed_event_id);
    } else if (d.kind === "command") {
      const key = String(input.bindings[5]), phase = Object.keys(i.keys).find(value => i.keys[value] === key);
      if (!uuid(row.event_id) || !digest(row.request_digest) || !iso(row.created_at) || row.action !== phase
        || !same([row.stream_id, row.actor, row.client_id, row.correlation_id, row.project_id, row.document_id],
          [i.stream, `user:${i.owner}`, "server:output-requirements", key, i.projectId, i.documentId])) return fail();
      if (typeof row.private_json !== "string") return fail("sponsor_audio_output_native_body_unavailable");
      rememberBody(state, row.event_id, row.private_json, i.projectId, i.documentId);
      const payload = parsed(row.private_json); if (!payload) return fail();
      if (phase === "confirm") { if (!uuid(payload.plan_revision_id)) return fail(); state.observedPlans.add(payload.plan_revision_id); state.planEvents.add(row.event_id); }
      if (phase === "preflight") state.preflightEvents.add(row.event_id);
      const proof = outputCommandReceiptAssertion({ kind: "personal", key: i.scopeKey, ownerUserId: i.owner, actorUserId: i.owner,
        projectId: i.projectId, documentId: i.documentId, organizationId: null, projectAccessId: null, contextId: null },
      { action: String(row.action), eventId: row.event_id, createdAt: row.created_at, key, requestDigest: row.request_digest, payload });
      keepProofs(state, [proof]);
    }
  }
}
async function nativeRead(state: State, captured: Captured) {
  if (state.frame || state.stage?.recovered) return fail("sponsor_audio_output_native_final_proof_changed");
  const i = await identity(state), descriptor = describeRead(state, captured.sql, captured.bindings, i);
  const recovery = state.stage?.lostAckRead ? state.stage : null;
  if (recovery) {
    if (recovery.lostAckInFlight) return fail();
    if (descriptor.kind !== "command" || captured.bindings[5] !== i.keys[recovery.phase]) return fail();
    recovery.lostAckInFlight = true;
  }
  const result = await readRows(state, { ...captured, ...descriptor, invalidRow: invalidNativeRow(descriptor, i) }); current(state);
  observe(state, descriptor, result.result.results, captured, i);
  if (recovery) { recovery.lostAckRead = false; recovery.lostAckInFlight = false; recovery.recovered = true; }
  return result.result;
}
const EVENT_INSERT = `INSERT INTO event_write_stage(${EVENT_WRITE_COLUMNS}) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
const ASSERTION_DELETE = "DELETE FROM output_atomic_assertions WHERE token=?";
const COMMAND_INSERT = "INSERT INTO output_commands(scope_key,actor_user_id,command_key,request_digest,action,event_id,created_at) VALUES(?,?,?,?,?,?,?)";
const PLAN_INSERT = `INSERT INTO output_plan_revisions(scope_key,scope_kind,owner_user_id,project_id,document_id,organization_id,project_access_id,plan_revision_id,plan_id,revision,confirmed_event_id,requirements_digest,source_digest,resolver_version,source_head,target_count,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
const TARGET_INSERT = "INSERT INTO output_plan_targets(scope_key,plan_revision_id,target_id,target_contract_digest,media_kind,required,selected,ordinal) VALUES(?,?,?,?,?,?,?,?)";
const PREFLIGHT_INSERT = "INSERT INTO output_preflights(scope_key,preflight_id,plan_revision_id,actor_user_id,terms_digest,event_id,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?)";
function trustedFacts(trusted: OutputTrustedContext) {
  return canonicalJson({ scope: trusted.scope, ownerHead: trusted.ownerHead, projectHead: trusted.projectHead, context: trusted.context,
    events: trusted.events, projection: trusted.projection, projectContext: trusted.projectContext, sourcePrivateCaptured: trusted.sourcePrivateCaptured,
    sourceProblems: trusted.sourceProblems, sourceEvidence: trusted.sourceEvidence,
    ...(trusted.governanceWitness === undefined ? {} : { governanceWitness: trusted.governanceWitness }),
    requirements: trusted.requirements, requirementsDigest: trusted.requirementsDigest, sourceDigest: trusted.sourceDigest });
}
/** Lock the actual producer graph, never a cast/copy. Native Set contents need
 * a retained intrinsic check because Object.freeze alone cannot lock them. */
function lockNativeData(value: unknown, excluded = new Set<unknown>()): () => void {
  const seen = new Set<object>(), sets: Array<{ value: Set<unknown>; entries: unknown[] }> = [];
  const visit = (item: unknown, depth: number) => {
    if (excluded.has(item) || item === null || item === undefined || typeof item === "string" || typeof item === "boolean" || typeof item === "number" && Number.isFinite(item)) return;
    if (!item || typeof item !== "object" || depth > 100) return fail();
    if (seen.has(item)) return; seen.add(item);
    const prototype = Object.getPrototypeOf(item);
    if (prototype === Set.prototype) {
      const entries = Array.from(Set.prototype.values.call(item) as SetIterator<unknown>);
      for (const entry of entries) visit(entry, depth + 1);
      sets.push({ value: item as Set<unknown>, entries });
    } else if (![Object.prototype, Array.prototype, null].includes(prototype)) return fail();
    for (const key of Reflect.ownKeys(item)) {
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (typeof key !== "string" || !descriptor || !Object.hasOwn(descriptor, "value")) return fail();
      visit(descriptor.value, depth + 1);
    }
    Object.freeze(item);
  };
  visit(value, 0);
  return () => { for (const item of sets) if (!same(Array.from(Set.prototype.values.call(item.value)), item.entries)) return fail(); };
}
function disclosureFacts(trusted: OutputTrustedContext) {
  return canonicalJson({ context: trustedFacts(trusted), source: trusted.sourceAssertions });
}
function sameProofArray(actual: readonly Proof[], expected: readonly Proof[]): boolean {
  if (!Array.isArray(actual) || Object.getPrototypeOf(actual) !== Array.prototype || actual.length !== expected.length
    || Reflect.ownKeys(actual).length !== actual.length + 1) return false;
  for (let at = 0; at < actual.length; at++) {
    const proof = own(actual, at), reference = expected[at]!;
    if (!record(proof) || ![Object.prototype, null].includes(Object.getPrototypeOf(proof)) || own(proof, "sql") !== reference.sql) return false;
    const bindings = Object.hasOwn(proof, "bindings") ? own(proof, "bindings") : [];
    if (!Array.isArray(bindings) || Object.getPrototypeOf(bindings) !== Array.prototype || Reflect.ownKeys(bindings).length !== bindings.length + 1
      || bindings.length !== (reference.bindings ?? []).length
      || (Object.hasOwn(proof, "deadlineMs") ? own(proof, "deadlineMs") : undefined) !== reference.deadlineMs) return false;
    for (let index = 0; index < bindings.length; index++) if (!Object.is(own(bindings, index), (reference.bindings ?? [])[index])) return false;
  }
  return true;
}
function fullStageGuards(state: State, i: Identity): Proof[] {
  const stage = state.stage ?? fail();
  const guards: Proof[] = [outputScopeAuthority(stage.trusted.scope, stage.phase === "preflight" ? "request" : "author"),
    { sql: "(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?", bindings: [i.stream, stage.trusted.ownerHead] },
    ...stage.trusted.sourceAssertions, ...retainedOutputBodyAssertions(stage.trusted.scope)];
  if (stage.phase === "save") guards.push({ sql: "NOT EXISTS(SELECT 1 FROM events WHERE stream_id=? AND type='BlockCreated' AND json_extract(payload,'$.block_id')=?)", bindings: [i.stream, i.requirementId] });
  for (const proof of state.proofs) if (!guards.some(guard => guard.sql === proof.sql && same(guard.bindings ?? [], proof.bindings ?? []))) return fail();
  for (const guard of guards) if (!recognizeNativePredicate(guard.sql, guard.bindings ?? [], i)) return fail();
  return guards;
}
function assertionPair(items: readonly Captured[], at: number, proof: Proof, used: Set<string>): number {
  const first = items[at], next = items[at + 1];
  if (!first || !next || first.sql !== `INSERT INTO output_atomic_assertions(token,passed) VALUES(?,CASE WHEN (${proof.sql}) THEN 1 ELSE 0 END)`
    || !uuid(first.bindings[0]) || used.has(first.bindings[0]) || !same(first.bindings.slice(1), proof.bindings ?? [])
    || next.sql !== ASSERTION_DELETE || !same(next.bindings, [first.bindings[0]])) return fail("sponsor_audio_output_native_batch_changed");
  used.add(first.bindings[0]); return at + 2;
}
async function validateBatch(state: State, items: readonly Captured[], i: Identity): Promise<{ event: EventRow; payload: Row }> {
  const stage = state.stage ?? fail(), tokens = new Set<string>();
  if (state.data.operation !== "audio-output-prepare" || stage.dispatched || canonicalJson(stage.envelope) !== stage.serialized) return fail();
  const guards = fullStageGuards(state, i); let at = 0;
  for (const guard of guards) at = assertionPair(items, at, guard, tokens);
  const write = items[at++], b = write?.bindings ?? [], payload = parsed(b[16]);
  const phaseType = stage.phase === "save" ? "BlockCreated" : stage.phase === "confirm" ? "OutputPlanConfirmed" : "OutputPlanPreflighted";
  if (!write || write.sql !== EVENT_INSERT || b.length !== 17 || !uuid(b[0]) || b[1] !== i.stream || b[2] !== stage.trusted.ownerHead + 1
    || !iso(b[3]) || b[4] !== b[3] || b[5] !== `user:${i.owner}` || b[6] !== "server:output-requirements" || b[7] !== i.keys[stage.phase]
    || b[8] !== null || b[9] !== null || b[10] !== 1 || b[11] !== phaseType || b[13] !== i.owner || b[14] !== i.projectId || b[15] !== i.documentId
    || !payload || payload.project_id !== i.projectId || payload.document_id !== i.documentId || payload.actor_user_id !== i.owner
    || canonicalJson(payload.output_command_envelope) !== stage.serialized) return fail("sponsor_audio_output_native_event_changed");
  const event: EventRow = { eventId: b[0], streamId: i.stream, sequence: Number(b[2]), occurredAt: b[3], recordedAt: b[3], actor: `user:${i.owner}`,
    clientId: "server:output-requirements", correlationId: String(b[7]), causationId: null, compensatesEventId: null, schemaVersion: 1, type: phaseType, payload };
  if (!same(eventWriteBindings(event), b)) return fail();
  at = assertionPair(items, at, { sql: "EXISTS(SELECT 1 FROM events event JOIN event_private_payloads body ON body.private_event_id=event.event_id AND body.redacted_at IS NULL WHERE event.event_id=? AND body.owner_id=? AND body.document_id=?)",
    bindings: [event.eventId, i.owner, i.documentId] }, tokens);
  const common = { output_command_envelope: stage.envelope, project_id: i.projectId, document_id: i.documentId, actor_user_id: i.owner };
  if (stage.phase === "save") {
    const spec = stage.envelope.spec;
    if (!record(spec) || canonicalJson(spec) !== canonicalJson(i.target)) return fail();
    const expected = { block_id: i.requirementId, type: "output", scope: "document", position: `z-output-${i.requirementId}`, handle: `output/${i.requirementId}`,
      properties: { text: typeof spec.original_text === "string" ? spec.original_text : "", subtype: typeof spec.label === "string" ? spec.label : "Output",
        output_spec: spec, output_plan_suggestions: { count_policies: {}, suggested_counts: {} }, authority: "authored" }, ...common };
    if (canonicalJson(payload) !== canonicalJson(expected)) return fail("sponsor_audio_output_native_event_changed");
  } else if (stage.phase === "confirm") {
    const plan = payload.confirmed_plan;
    if (!record(plan) || !uuid(payload.plan_revision_id) || plan.revisionId !== payload.plan_revision_id || !iso(plan.confirmedAt)) return fail();
    const options = stage.trusted.requirements.reduce<OutputPlanSuggestions>((result, row) => ({
      count_policies: { ...result.count_policies, ...row.planSuggestions.count_policies }, suggested_counts: { ...result.suggested_counts, ...row.planSuggestions.suggested_counts } }), { count_policies: {}, suggested_counts: {} });
    const compiled = compileOutputPlan(stage.trusted.requirements.map(row => row.spec!) as OutputRequirementSpec[], {
      ...options, document_id: i.documentId, source_revision: stage.trusted.sourceDigest, requirement_revision: stage.trusted.requirementsDigest, max_targets: 1000 });
    if (compiled.issues.length || compiled.targets.length !== 1 || compiled.targets[0]!.id !== i.targetId || compiled.targets[0]!.media_kind !== "audio") return fail();
    const contract = await outputTargetContractDigest(compiled.targets[0]!, stage.trusted.sourceDigest); current(state);
    const expectedPlan = { id: i.documentId, revisionId: payload.plan_revision_id, revision: 1, confirmedAt: plan.confirmedAt,
      requirementsDigest: stage.trusted.requirementsDigest, sourceDigest: stage.trusted.sourceDigest, plan: compiled,
      targetContractDigests: { [i.targetId]: contract }, confirmationOptions: options };
    if (canonicalJson(payload) !== canonicalJson({ plan_revision_id: payload.plan_revision_id, confirmed_plan: expectedPlan, ...common })) return fail("sponsor_audio_output_native_plan_changed");
    const revision = items[at++], target = items[at++];
    if (!revision || revision.sql !== PLAN_INSERT || !same(revision.bindings, [i.scopeKey, "personal", i.owner, i.projectId, i.documentId, null, null,
      expectedPlan.revisionId, i.documentId, expectedPlan.revision, event.eventId, expectedPlan.requirementsDigest, expectedPlan.sourceDigest, "output-plan-v1", stage.trusted.ownerHead, 1, expectedPlan.confirmedAt])
      || !target || target.sql !== TARGET_INSERT || !same(target.bindings, [i.scopeKey, expectedPlan.revisionId, i.targetId, contract, "audio", 1, 1, 0])) return fail();
  } else {
    const preflight = payload.preflight, quote = stageQuotes.get(stage), plan = actualPlanBody(state, String(stage.envelope.planRevisionId));
    if (!record(preflight) || !quote || !plan || !uuid(payload.preflight_id) || payload.preflight_id !== preflight.id
      || payload.plan_revision_id !== stage.envelope.planRevisionId || preflight.planRevisionId !== stage.envelope.planRevisionId
      || preflight.sourceDigest !== stage.trusted.sourceDigest || preflight.requirementsDigest !== stage.trusted.requirementsDigest
      || !Array.isArray(preflight.targets) || preflight.targets.length !== 1 || canonicalJson(preflight.targets[0]) !== quote.serialized
      || !iso(preflight.createdAt) || !iso(preflight.expiresAt) || Date.parse(preflight.expiresAt) > Date.parse(String(plan.confirmedAt)) + 900_000
      || canonicalJson(preflight.operationAttempts) !== canonicalJson({ [i.targetId]: { ordinal: 0, previousSlotId: null } })
      || preflight.maximumMicrousd !== (quote.result.available ? quote.result.maximumMicrousd : 0)
      || preflight.maximumCalls !== (quote.result.available ? quote.result.maximumCalls : 0)) return fail("sponsor_audio_output_native_quote_changed");
    if (canonicalJson(payload) !== canonicalJson({ preflight_id: preflight.id, plan_revision_id: preflight.planRevisionId, preflight, ...common })
      || Object.keys(preflight).sort().join(",") !== ["id","planRevisionId","sourceDigest","requirementsDigest","targets","operationAttempts","maximumMicrousd","maximumCalls","expiresAt","createdAt","termsDigest"].sort().join(",")) return fail();
    const { termsDigest: _terms, ...withoutDigest } = preflight;
    if (preflight.termsDigest !== await outputDigest(withoutDigest)) return fail(); current(state);
    const sidecar = items[at++];
    if (!sidecar || sidecar.sql !== PREFLIGHT_INSERT || !same(sidecar.bindings, [i.scopeKey, preflight.id, preflight.planRevisionId, i.owner,
      preflight.termsDigest, event.eventId, preflight.expiresAt, preflight.createdAt])) return fail();
  }
  const command = items[at++], requestDigest = await outputDigest(stage.envelope); current(state);
  if (!command || command.sql !== COMMAND_INSERT || command.bindings.length !== 7 || !iso(command.bindings[6])
    || !same(command.bindings.slice(0, 6), [i.scopeKey, i.owner, i.keys[stage.phase], requestDigest, stage.phase, event.eventId]) || at !== items.length) return fail();
  return { event, payload };
}
const stageQuotes = new WeakMap<Stage, { result: OutputNativeTargetPreflight; serialized: string; proofs: readonly Proof[] }>();
export function beginSponsorAudioOutputPreflight(owner: SponsorAudioOutputReadOwner, input: OutputBridgeTargetInput): void {
  const state = get(owner), stage = state.stage;
  if (!stage || stage.phase !== "preflight" || stageInputs.has(stage) || input.request !== state.request || input.env !== state.env
    || input.principal !== state.auth.user || input.scope !== stage.trusted.scope || input.context !== stage.trusted.context
    || input.sourceEvents !== stage.trusted.events || input.sourceAssertions !== stage.trusted.sourceAssertions || input.target.id !== state.resolvedIdentity?.targetId
    || input.ownerHead !== stage.trusted.ownerHead || input.sourceDigest !== stage.trusted.sourceDigest || input.requirementsDigest !== stage.trusted.requirementsDigest
    || canonicalJson(input.confirmedPlan) !== canonicalJson(actualPlanBody(state, String(stage.envelope.planRevisionId)))
    || canonicalJson(input.target) !== canonicalJson(input.confirmedPlan.plan.targets.find(target => target.id === state.resolvedIdentity?.targetId))) return fail();
  const check = lockNativeData(input, new Set([state.request, state.env, state.auth.user, stage.trusted.sourceAssertions]));
  stageInputChecks.set(stage, check);
  stageInputs.set(stage, input);
}
export function isSponsorAudioOutputPreflightInput(owner: SponsorAudioOutputReadOwner, input: OutputBridgeTargetInput): boolean {
  const state = get(owner); return !!state.stage && stageInputs.get(state.stage) === input;
}
export function retainSponsorAudioOutputPreflight(owner: SponsorAudioOutputReadOwner, input: OutputBridgeTargetInput, result: OutputNativeTargetPreflight) {
  const state = get(owner), stage = state.stage;
  if (!stage || stage.phase !== "preflight" || stageQuotes.has(stage) || input.request !== state.request || input.env !== state.env
    || input.principal !== state.auth.user || input.scope !== stage.trusted.scope || input.context !== stage.trusted.context || stageInputs.get(stage) !== input
    || result.targetId !== input.target.id || result.available && !outputAudioPreflightAssertions(result)?.length) return fail();
  const proofs = result.available ? outputAudioPreflightAssertions(result)! : [];
  stageQuotes.set(stage, { result, serialized: canonicalJson(result), proofs: proofs.map(capturedProof) });
  if (result.available) keepProofs(state, proofs);
  current(state);
}
export async function runSponsorAudioOutputStage<T>(owner: SponsorAudioOutputReadOwner, trusted: OutputTrustedContext, envelope: Row, work: () => Promise<T>): Promise<T> {
  const state = get(owner), i = await identity(state);
  const binding = await experienceOutputBinding(i.plan); current(state);
  if (!isSponsorAudioOutputTrustedContext(owner, trusted) || state.contexts.get(trusted)?.facts !== trustedFacts(trusted) || state.stage || state.data.operation !== "audio-output-prepare" || trusted.env !== state.env || trusted.request !== state.request || trusted.principal !== state.auth.user
    || trusted.scope.kind !== "personal" || !same([trusted.scope.actorUserId, trusted.scope.ownerUserId, trusted.scope.projectId, trusted.scope.documentId, trusted.scope.key],
      [i.owner, i.owner, i.projectId, i.documentId, i.scopeKey]) || !["save", "confirm", "preflight"].includes(String(envelope.action))
    || envelope.clientMutationId !== i.keys[String(envelope.action)] || envelope.expectedRevision !== `output:${trusted.ownerHead}`
    || canonicalJson(envelope.experienceBinding) !== canonicalJson(binding) || envelope.documentId !== i.documentId) return fail();
  const phase = envelope.action as Stage["phase"], common = ["action", "documentId", "expectedRevision", "clientMutationId", "experienceBinding"];
  const keys = [...common, ...(phase === "save" ? ["blockId", "spec", "explicitRequirementsConfirmation"] : phase === "confirm" ? ["explicitRequirementsConfirmation"] : ["planRevisionId", "targetIds"])];
  if (!same(Object.keys(envelope).sort(), keys.sort())
    || phase !== "preflight" && envelope.explicitRequirementsConfirmation !== true
    || phase === "save" && (envelope.blockId !== i.requirementId || canonicalJson(envelope.spec) !== canonicalJson(i.target))
    || phase === "preflight" && (!uuid(envelope.planRevisionId) || !state.observedPlans.has(envelope.planRevisionId)
      || !Array.isArray(envelope.targetIds) || !same(envelope.targetIds, [i.targetId]))) return fail();
  const envelopeCheck = lockNativeData(envelope);
  const stage: Stage = { trusted, envelope, serialized: canonicalJson(envelope), phase: envelope.action as Stage["phase"], dispatched: false,
    proofs: [...trusted.sourceAssertions, ...retainedOutputBodyAssertions(trusted.scope)].map(capturedProof), sourcePrefix: trusted.sourceAssertions.map(capturedProof) };
  const snapshot = trustedFacts(trusted), scope = trusted.scope, context = trusted.context, assertions = trusted.sourceAssertions;
  state.stage = stage;
  const check = () => { state.data.current(); envelopeCheck(); state.contexts.get(trusted)?.check(); stageInputChecks.get(stage)?.(); if (trusted.env !== state.env || trusted.request !== state.request || trusted.principal !== state.auth.user || trusted.scope !== scope || trusted.context !== context || trusted.sourceAssertions !== assertions
    || trustedFacts(trusted) !== snapshot || canonicalJson(envelope) !== stage.serialized) return fail();
    const prefix = stage.sourcePrefix, extra = [...(stage.phase === "preflight" && trusted.context ? outputActiveSourceDeadlineAssertions(trusted.context) : []), ...(stageQuotes.get(stage)?.proofs ?? [])];
    if (assertions.length < prefix.length || assertions.length > prefix.length + extra.length
      || !sameProofArray(assertions, [...prefix, ...extra].slice(0, assertions.length))) return fail();
  };
  stageChecks.set(stage, check);
  try {
    check(); const value = await state.data.wait(work); check();
    for (const proof of assertions) lockNativeData(proof);
    state.contexts.get(trusted)!.source = assertions.map(capturedProof);
    return value;
  }
  catch (error) { closeSponsorAudioOutputReads(owner); throw error; }
  finally { state.stage = undefined; }
}
const stageChecks = new WeakMap<Stage, () => void>();
function nativeDatabase(state: State): WorkerEnv["DB"] {
  const prepared = (sql: string, bindings: readonly Value[] = []): D1PreparedStatement => {
    const captured = Object.freeze({ sql, bindings: Object.freeze([...bindings]) });
    const statement = {
      bind(...next: unknown[]) { if (next.some(value => !scalar(value))) return fail(); return prepared(sql, next as Value[]); },
      async first(column?: string) { if (column !== undefined) return fail(); try { return (await nativeRead(state, captured)).results[0] ?? null; } catch (error) { closeSponsorAudioOutputReads(state.owner); throw error; } },
      async all() { try { return await nativeRead(state, captured); } catch (error) { closeSponsorAudioOutputReads(state.owner); throw error; } },
      run: () => fail(), raw: () => fail(),
    } as D1PreparedStatement;
    state.statements.set(statement, captured); return statement;
  };
  return {
    prepare(sql: string) { current(state); if (typeof sql !== "string" || sql.includes("\0")) return fail(); return prepared(sql); },
    async batch<T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      if (state.transporting) { closeSponsorAudioOutputReads(state.owner); return fail("sponsor_audio_output_parallel_read_refused"); }
      state.transporting = true;
      try {
        current(state);
        if (state.stage?.lostAckRead || state.stage?.recovered) return fail();
        if (!Array.isArray(statements) || !statements.length || statements.length > 1000 || Reflect.ownKeys(statements).length !== statements.length + 1) return fail();
        const captured = Array.from({ length: statements.length }, (_, at) => state.statements.get(own(statements, at)) ?? fail());
        const i = await identity(state);
        const frame = state.frame;
        if (frame && (frame.completed || captured.length !== frame.proof.length || captured.some((item, at) => item.sql !== frame.proof[at]!.sql
          || !same(item.bindings, frame.proof[at]!.bindings)))) return fail("sponsor_audio_output_native_final_proof_changed");
        if (captured.some(item => item.sql === EVENT_INSERT)) {
          const validated = await validateBatch(state, captured, i); current(state);
          const remaining = state.data.remaining();
          if (remaining.queries < captured.length || remaining.rows < captured.length || remaining.bytes < captured.length * ACK_BYTES) return fail("sponsor_audio_output_read_limit_reached");
          state.stage!.dispatched = true;
          state.data.account({ bytes: 0, queries: captured.length, rows: captured.length });
          const native = captured.map(item => { const packed = packSponsorIntakeReadQuery(item.sql, item.bindings); return state.db.prepare(packed.sql).bind(...packed.bindings); });
          let raw: D1Result<Row>[];
          try { raw = await state.data.wait(() => state.db.batch<Row>(native)); current(state); }
          catch (error) {
            // The native core owns one exact original-first lookup after an
            // unknown transaction ACK. No second write or generic read opens.
            current(state); state.stage!.lostAckRead = true;
            throw { nativeAudioOriginalLookup: true, cause: error };
          }
          const result = captureResult(raw, Math.min(state.data.remaining().bytes, captured.length * ACK_BYTES));
          if (!Array.isArray(result.value) || result.value.length !== native.length) return fail();
          result.value.forEach(ack => { acknowledgement(ack); if (ack.results.length !== 0 || captureResult(ack, ACK_BYTES).bytes > ACK_BYTES) return fail(); });
          state.data.account({ bytes: result.bytes, queries: 0, rows: result.value.reduce((total, ack) => total + Math.max(0, ack.results.length - 1), 0) });
          current(state); state.observedEvents.add(validated.event.eventId);
          rememberBody(state, validated.event.eventId, JSON.stringify(validated.payload), i.projectId, i.documentId);
          if (state.stage!.phase === "confirm") { state.planEvents.add(validated.event.eventId); state.observedPlans.add(String(validated.payload.plan_revision_id)); }
          if (state.stage!.phase === "preflight") state.preflightEvents.add(validated.event.eventId);
          return result.value as D1Result<T>[];
        }
        const descriptors = captured.map(item => describeRead(state, item.sql, item.bindings, i));
        if (descriptors.some(item => !["head", "proof", "source"].includes(item.kind))
          || descriptors.filter(item => item.kind === "source").length > 1
          || descriptors.some((item, index) => item.kind === "source" && index !== 0)
          || descriptors.filter(item => item.kind === "head").length > 1) return fail();
        // Keep a native proof batch atomic. Each bounded wrapper preserves every
        // original predicate and false/NULL result, with one shared remaining cap.
        const remaining = state.data.remaining();
        if (remaining.queries < captured.length || remaining.rows < captured.length * 2 || remaining.bytes < captured.length * ACK_BYTES)
          return fail("sponsor_audio_output_read_limit_reached");
        const maximum = Math.floor(remaining.bytes / captured.length), rowAllowance = Math.floor(remaining.rows / captured.length) - 1;
        const plans = captured.map((item, at) => composeRows(state, { ...item, columns: descriptors[at]!.columns, invalidRow: invalidNativeRow(descriptors[at]!, i), maximumRows: Math.min(descriptors[at]!.maximumRows, rowAllowance) }, maximum));
        state.data.account({ bytes: 0, queries: captured.length, rows: 0 });
        const raw = await state.data.wait(() => state.db.batch<Row>(plans.map(plan => state.db.prepare(plan.packed.sql).bind(...plan.packed.bindings)))); current(state);
        const result = captureResult(raw, state.data.remaining().bytes);
        if (!Array.isArray(result.value) || result.value.length !== captured.length) return fail();
        let rowsCharged = 0;
        const restored = result.value.map((ack, at) => {
          acknowledgement(ack); const row = ack.results[0], d = descriptors[at]!;
          if (ack.results.length !== 1 || !row || row.authorized !== 1 || !integer(row.count) || row.count > d.maximumRows || typeof row.body !== "string") return fail();
          const data: unknown = JSON.parse(row.body);
          if (!Array.isArray(data) || data.length !== row.count || data.some(value => !Array.isArray(value) || value.length !== d.columns.length)) return fail();
          const rows = data.map(value => Object.fromEntries(d.columns.map((column, index) => [column, value[index]])));
          if (d.kind === "proof" && (rows.length !== 1 || rows[0]!.current !== 1)) return fail("sponsor_audio_output_native_proof_changed");
          rowsCharged += 1 + rows.length; observe(state, d, rows, captured[at]!, i); return { ...ack, results: rows };
        });
        state.data.account({ bytes: result.bytes, queries: 0, rows: rowsCharged }); current(state);
        if (frame) frame.completed = true;
        return restored as D1Result<T>[];
      } catch (error) {
        if (record(error) && error.nativeAudioOriginalLookup === true && state.stage?.lostAckRead) throw error.cause;
        closeSponsorAudioOutputReads(state.owner); throw error;
      } finally { state.transporting = false; }
    },
    exec: () => fail(), dump: () => fail(), withSession: () => fail(),
  } as unknown as WorkerEnv["DB"];
}
async function readStream(state: State, body: ReadableStream<Uint8Array> | null): Promise<string> {
  current(state); if (!body) return "";
  if (state.transporting) { closeSponsorAudioOutputReads(state.owner); return fail("sponsor_audio_output_parallel_read_refused"); }
  state.transporting = true;
  const reader = body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true }); let text = "";
  try {
    for (;;) {
      const next = await state.data.wait(() => reader.read()); current(state);
      if (next.done) break;
      if (!(next.value instanceof Uint8Array)) return fail();
      state.data.account({ bytes: next.value.byteLength, queries: 0, rows: 0 });
      text += decoder.decode(next.value, { stream: true });
    }
    text += decoder.decode(); current(state); return text;
  } catch (error) { closeSponsorAudioOutputReads(state.owner); try { await reader.cancel(); } catch { /* Preserve original rejection. */ } throw error; }
  finally { state.transporting = false; reader.releaseLock(); }
}
export async function readSponsorAudioOutputBody(owner: SponsorAudioOutputReadOwner): Promise<unknown> {
  const state = get(owner);
  if (state.bodyRead || state.data.operation !== "audio-output-prepare" || state.request.bodyUsed) return fail();
  state.bodyRead = true;
  const body = Object.getOwnPropertyDescriptor(Request.prototype, "body")!.get!.call(state.request);
  const text = await readStream(state, body); current(state);
  try { return JSON.parse(text); } catch { closeSponsorAudioOutputReads(owner); return fail("sponsor_audio_output_initial_request_invalid"); }
}
export async function readSponsorAudioOutputResponse(owner: SponsorAudioOutputReadOwner, response: Response): Promise<unknown> {
  const state = get(owner);
  if (!(response instanceof Response) || response.bodyUsed) return fail();
  state.data.accountResponse(JSON.stringify([...response.headers]));
  const text = await readStream(state, Object.getOwnPropertyDescriptor(Response.prototype, "body")!.get!.call(response)); current(state);
  try { return JSON.parse(text); } catch { closeSponsorAudioOutputReads(owner); return fail(); }
}
/** Arm the complete proof of the actual native final disclosure. A subset of
 * successful reads or a caller-created Response cannot create this capability. */
export async function runSponsorAudioOutputDisclosure(owner: SponsorAudioOutputReadOwner, trusted: OutputTrustedContext,
  extra: readonly OutputSqlAssertion[], work: () => Promise<Response>): Promise<Response> {
  const state = get(owner), i = await identity(state);
  try {
    if (state.stage || state.frame || !isSponsorAudioOutputTrustedContext(owner, trusted)
      || state.contexts.get(trusted)?.facts !== trustedFacts(trusted) || trusted.env !== state.env || trusted.request !== state.request
      || trusted.principal !== state.auth.user || trusted.scope.kind !== "personal" || trusted.scope.ownerUserId !== i.owner
      || trusted.scope.actorUserId !== i.owner || trusted.scope.projectId !== i.projectId || trusted.scope.documentId !== i.documentId
      || !Array.isArray(extra)) return fail();
    const checks = [outputScopeAuthority(trusted.scope, "read"), ...retainedOutputBodyAssertions(trusted.scope),
      { sql: "(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?", bindings: [i.stream, trusted.ownerHead] },
      ...trusted.sourceAssertions, ...(trusted.context ? outputActiveSourceDeadlineAssertions(trusted.context) : []), ...extra].map(capturedProof);
    for (const proof of state.proofs) if (!checks.some(check => check.sql === proof.sql && same(check.bindings ?? [], proof.bindings ?? []))) return fail();
    const frame: DisclosureFrame = { trusted, completed: false, facts: disclosureFacts(trusted),
      deadlineMs: Math.min(Infinity, ...checks.flatMap(check => check.deadlineMs === undefined ? [] : [check.deadlineMs])),
      proof: Object.freeze(checks.map(check => Object.freeze({ sql: `SELECT CASE WHEN (${check.sql}) THEN 1 ELSE 0 END AS current`, bindings: check.bindings ?? [] }))) };
    state.frame = frame; current(state);
    const response = await state.data.wait(work); current(state);
    if (!frame.completed || !isSponsorAudioOutputFinalResponse(owner, response) || nativeResponseUsed(response)) return fail();
    const status = nativeResponseStatus(response), headers = JSON.stringify([...nativeResponseHeaders(response)]);
    responses.set(response, { state, frame, status, headers }); return response;
  } catch (error) { closeSponsorAudioOutputReads(owner); throw error; }
}
const nativeResponseUsed = (response: Response): boolean => Object.getOwnPropertyDescriptor(Response.prototype, "bodyUsed")!.get!.call(response);
const nativeResponseStatus = (response: Response): number => Object.getOwnPropertyDescriptor(Response.prototype, "status")!.get!.call(response);
const nativeResponseHeaders = (response: Response): Headers => Object.getOwnPropertyDescriptor(Response.prototype, "headers")!.get!.call(response);
export async function discloseSponsorAudioOutputResponse(owner: SponsorAudioOutputReadOwner, response: Response): Promise<Response> {
  const state = get(owner);
  try {
    const seal = responses.get(response);
    if (!seal || seal.state !== state || seal.frame !== state.frame || !seal.frame.completed || nativeResponseUsed(response)
      || nativeResponseStatus(response) !== seal.status || JSON.stringify([...nativeResponseHeaders(response)]) !== seal.headers) return fail();
    responses.delete(response);
    const headers = new Headers(nativeResponseHeaders(response)), status = seal.status;
    state.data.accountResponse(seal.headers);
    const text = await readStream(state, Object.getOwnPropertyDescriptor(Response.prototype, "body")!.get!.call(response)); current(state);
    // The actual native response has crossed an async stream boundary. Recheck
    // the original full final proof batch, never a renewed body or new budget.
    const proof = seal.frame.proof; seal.frame.completed = false;
    await state.env.DB.batch(proof.map(item => state.env.DB.prepare(item.sql).bind(...item.bindings))); current(state);
    if (!seal.frame.completed || nativeResponseStatus(response) !== status || JSON.stringify([...nativeResponseHeaders(response)]) !== seal.headers) return fail();
    const result = new Response(text, { status, headers }); current(state); closeSponsorAudioOutputReads(owner); return result;
  } catch (error) { closeSponsorAudioOutputReads(owner); throw error; }
}

/** Closed personal native write-chain schema. These are source declarations,
 * never observed/caller-supplied SQL. Exact DDL retains CHECK/FK/conflict rules;
 * main PRAGMAs independently prove actual visible columns and authority keys.
 * No schema is installed and no statement is added to the real native batch. */
type NativeSchemaTable = { name: string; definitions: readonly string[]; columns: readonly Value[][]; primary: readonly Value[][] };
function nativeSchemaTable(name: string, definitions: readonly string[], names: string, integers: string, nullable: string, primary: string, eventDefault = false): NativeSchemaTable {
  const fields = names.split(","), numbers = integers.split(","), optional = nullable.split(","), key = primary.split(",");
  return { name, definitions, columns: fields.map((field, cid) => [cid, field, numbers.includes(field) ? "INTEGER" : "TEXT",
    optional.includes(field) ? 0 : 1, eventDefault && field === "schema_version" ? "1" : null, key.indexOf(field) + 1, 0]),
  primary: key.map((field, seqno) => [seqno, fields.indexOf(field), field, 0, "BINARY"]) };
}
function nativeOutputDeclaration(name: string): readonly string[] {
  const declarations = OUTPUT_REQUIREMENTS_SCHEMA.filter(sql => sql.startsWith(`CREATE TABLE IF NOT EXISTS ${name}(`));
  if (declarations.length !== 1) return fail();
  const sql = declarations[0]!.replace(" IF NOT EXISTS", "");
  // Native model3d rebuild explicitly recognizes this canonical rename form.
  return name === "output_plan_targets" ? [sql, sql.replace("CREATE TABLE output_plan_targets(", 'CREATE TABLE "output_plan_targets"(')] : [sql];
}
function sponsorAudioNativeSchemaProof(): Proof {
  // Runtime bootstrap, Drizzle 0000/0015, and the privacy-rebuild rename.
  // Literal whitespace is intentional; no unknown catalog SQL is normalized.
  const tables: NativeSchemaTable[] = [
    nativeSchemaTable("events", ["CREATE TABLE events (\n      event_id TEXT PRIMARY KEY NOT NULL, stream_id TEXT NOT NULL, sequence INTEGER NOT NULL,\n      occurred_at TEXT NOT NULL, recorded_at TEXT NOT NULL, actor TEXT NOT NULL, client_id TEXT NOT NULL,\n      correlation_id TEXT NOT NULL, causation_id TEXT, compensates_event_id TEXT,\n      schema_version INTEGER NOT NULL DEFAULT 1, type TEXT NOT NULL, payload TEXT NOT NULL\n    )", "CREATE TABLE `events` (\n\t`event_id` text PRIMARY KEY NOT NULL,\n\t`stream_id` text NOT NULL,\n\t`sequence` integer NOT NULL,\n\t`occurred_at` text NOT NULL,\n\t`recorded_at` text NOT NULL,\n\t`actor` text NOT NULL,\n\t`client_id` text NOT NULL,\n\t`correlation_id` text NOT NULL,\n\t`causation_id` text,\n\t`compensates_event_id` text,\n\t`schema_version` integer DEFAULT 1 NOT NULL,\n\t`type` text NOT NULL,\n\t`payload` text NOT NULL\n)", "CREATE TABLE \"events\" (\n  event_id TEXT PRIMARY KEY NOT NULL,stream_id TEXT NOT NULL,sequence INTEGER NOT NULL,\n  occurred_at TEXT NOT NULL,recorded_at TEXT NOT NULL,actor TEXT NOT NULL,client_id TEXT NOT NULL,\n  correlation_id TEXT NOT NULL,causation_id TEXT,compensates_event_id TEXT,\n  schema_version INTEGER NOT NULL DEFAULT 1,type TEXT NOT NULL,payload TEXT NOT NULL\n)"],
      "event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,causation_id,compensates_event_id,schema_version,type,payload", "sequence,schema_version", "causation_id,compensates_event_id", "event_id", true),
    nativeSchemaTable("event_private_payloads", ["CREATE TABLE event_private_payloads (private_event_id TEXT PRIMARY KEY NOT NULL,owner_id TEXT NOT NULL,project_id TEXT,document_id TEXT,private_json TEXT NOT NULL,created_at TEXT NOT NULL,redacted_at TEXT)", "CREATE TABLE `event_private_payloads` (\n\t`private_event_id` text PRIMARY KEY NOT NULL,\n\t`owner_id` text NOT NULL,\n\t`project_id` text,\n\t`document_id` text,\n\t`private_json` text NOT NULL,\n\t`created_at` text NOT NULL,\n\t`redacted_at` text\n)"],
      "private_event_id,owner_id,project_id,document_id,private_json,created_at,redacted_at", "", "project_id,document_id,redacted_at", "private_event_id"),
    nativeSchemaTable("event_write_stage", ["CREATE TABLE event_write_stage (event_id TEXT PRIMARY KEY NOT NULL,stream_id TEXT NOT NULL,sequence INTEGER NOT NULL,occurred_at TEXT NOT NULL,recorded_at TEXT NOT NULL,actor TEXT NOT NULL,client_id TEXT NOT NULL,correlation_id TEXT NOT NULL,causation_id TEXT,compensates_event_id TEXT,schema_version INTEGER NOT NULL,type TEXT NOT NULL,payload TEXT NOT NULL,owner_id TEXT NOT NULL,project_id TEXT,document_id TEXT,private_json TEXT)", "CREATE TABLE `event_write_stage` (\n\t`event_id` text PRIMARY KEY NOT NULL,\n\t`stream_id` text NOT NULL,\n\t`sequence` integer NOT NULL,\n\t`occurred_at` text NOT NULL,\n\t`recorded_at` text NOT NULL,\n\t`actor` text NOT NULL,\n\t`client_id` text NOT NULL,\n\t`correlation_id` text NOT NULL,\n\t`causation_id` text,\n\t`compensates_event_id` text,\n\t`schema_version` integer NOT NULL,\n\t`type` text NOT NULL,\n\t`payload` text NOT NULL,\n\t`owner_id` text NOT NULL,\n\t`project_id` text,\n\t`document_id` text,\n\t`private_json` text\n)"],
      "event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,causation_id,compensates_event_id,schema_version,type,payload,owner_id,project_id,document_id,private_json", "sequence,schema_version", "causation_id,compensates_event_id,project_id,document_id,private_json", "event_id"),
    nativeSchemaTable("output_atomic_assertions", nativeOutputDeclaration("output_atomic_assertions"),
      "token,passed", "passed", "", "token"),
    nativeSchemaTable("output_commands", nativeOutputDeclaration("output_commands"),
      "scope_key,actor_user_id,command_key,request_digest,action,event_id,created_at", "", "", "scope_key,actor_user_id,command_key"),
    nativeSchemaTable("output_plan_revisions", nativeOutputDeclaration("output_plan_revisions"),
      "scope_key,scope_kind,owner_user_id,project_id,document_id,organization_id,project_access_id,plan_revision_id,plan_id,revision,confirmed_event_id,requirements_digest,source_digest,resolver_version,source_head,target_count,created_at", "revision,source_head,target_count", "organization_id,project_access_id", "scope_key,plan_revision_id"),
    nativeSchemaTable("output_plan_targets", nativeOutputDeclaration("output_plan_targets"),
      "scope_key,plan_revision_id,target_id,target_contract_digest,media_kind,required,selected,ordinal", "required,selected,ordinal", "", "scope_key,plan_revision_id,target_id"),
    nativeSchemaTable("output_preflights", nativeOutputDeclaration("output_preflights"),
      "scope_key,preflight_id,plan_revision_id,actor_user_id,terms_digest,event_id,expires_at,created_at", "", "", "scope_key,preflight_id"),
  ];
  const declaration = SCENE_SOURCE_GENERATION_TABLES.find(value => value.name === "scene_source_generations");
  if (!declaration) return fail();
  const sceneTable = nativeSchemaTable(declaration.name, [declaration.sql], "scope_kind,scope_key,generation", "generation", "", "scope_kind,scope_key");
  const triggers = [
    { name: "events_block_update", table: "events", definitions: ["CREATE TRIGGER events_block_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT, 'events are append-only'); END", "CREATE TRIGGER `events_block_update`\nBEFORE UPDATE ON `events` BEGIN\n\tSELECT RAISE(ABORT, 'events are append-only');\nEND"] },
    { name: "events_block_delete", table: "events", definitions: ["CREATE TRIGGER events_block_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT, 'events are append-only'); END", "CREATE TRIGGER `events_block_delete`\nBEFORE DELETE ON `events` BEGIN\n\tSELECT RAISE(ABORT, 'events are append-only');\nEND"] },
    { name: "event_write_stage_after_insert", table: "event_write_stage", definitions: [EVENT_WRITE_STAGE_TRIGGER_SQL.replace(" IF NOT EXISTS", "")] },
  ];
  const sceneTriggers = SCENE_SOURCE_GENERATION_TRIGGERS.filter(value =>
    value.name.startsWith("scene_source_events_") || value.name.startsWith("scene_source_event_private_payloads_") || value.name.startsWith("scene_source_generations_"))
    .map(value => ({ name: value.name, table: value.name.startsWith("scene_source_events_") ? "events"
      : value.name.startsWith("scene_source_event_private_payloads_") ? "event_private_payloads" : "scene_source_generations", definitions: [value.sql] }));
  if (sceneTriggers.length !== 9) return fail();
  const index = (name: string, table: string, unique: number, fields: readonly (readonly [string, number])[]) => {
    const columns = tables.find(value => value.name === table)?.columns;
    if (!columns) return fail();
    return { name, table, unique, columns: fields.map(([field, descending], seqno) => {
      const cid = columns.findIndex(column => column[1] === field); if (cid < 0) return fail();
      return [seqno, cid, field, descending, "BINARY"];
    }) };
  };
  const indexes = [index("idx_events_stream_sequence", "events", 1, [["stream_id", 0], ["sequence", 0]]),
    index("idx_output_plan_revisions_unique_1", "output_plan_revisions", 1, [["scope_key", 0], ["plan_id", 0], ["revision", 0]]),
    index("idx_output_plans_document", "output_plan_revisions", 0, [["scope_key", 0], ["document_id", 0], ["revision", 1]])];
  const tableChecks = [
    `EXISTS(SELECT 1 FROM main.sqlite_schema actual,json_each(expected.spec,'$.definitions') definition
          WHERE actual.type='table' AND actual.name COLLATE BINARY=json_extract(expected.spec,'$.name')
            AND actual.tbl_name COLLATE BINARY=actual.name AND actual.sql COLLATE BINARY=definition.value)`,
    `EXISTS(SELECT 1 FROM pragma_table_list(json_extract(expected.spec,'$.name')) actual
          WHERE actual.schema='main' AND actual.name=json_extract(expected.spec,'$.name') AND actual.type='table'
            AND actual.wr=0 AND actual.strict=0 AND actual.ncol=json_array_length(expected.spec,'$.columns'))`,
    `(SELECT COUNT(*) FROM pragma_table_xinfo(json_extract(expected.spec,'$.name'),'main'))=json_array_length(expected.spec,'$.columns')`,
    `NOT EXISTS(SELECT 1 FROM pragma_table_xinfo(json_extract(expected.spec,'$.name'),'main') actual
          WHERE NOT EXISTS(SELECT 1 FROM json_each(expected.spec,'$.columns') column
            WHERE json_array(actual.cid,actual.name,upper(actual.type),actual."notnull",actual.dflt_value,actual.pk,actual.hidden)=column.value))`,
    `(SELECT COUNT(*) FROM pragma_index_list(json_extract(expected.spec,'$.name'),'main') WHERE origin='pk')=1`,
    `EXISTS(SELECT 1 FROM pragma_index_list(json_extract(expected.spec,'$.name'),'main') actual
          WHERE actual.origin='pk' AND actual."unique"=1 AND actual.partial=0
            AND (SELECT COUNT(*) FROM pragma_index_xinfo(actual.name,'main') WHERE "key"=1)=json_array_length(expected.spec,'$.primary')
            AND NOT EXISTS(SELECT 1 FROM pragma_index_xinfo(actual.name,'main') part WHERE part."key"=1
              AND NOT EXISTS(SELECT 1 FROM json_each(expected.spec,'$.primary') key
                WHERE json_array(part.seqno,part.cid,part.name,part."desc",part.coll)=key.value)))`,
    `NOT EXISTS(SELECT 1 FROM pragma_index_list(json_extract(expected.spec,'$.name'),'main') actual
          WHERE actual."unique"=1 AND actual.origin<>'pk' AND NOT EXISTS(SELECT 1 FROM native_schema_indexes allowed
            WHERE actual.name COLLATE BINARY=json_extract(allowed.spec,'$.name')
              AND json_extract(allowed.spec,'$.table')=json_extract(expected.spec,'$.name') AND json_extract(allowed.spec,'$.unique')=1))`,
  ];
  // A mode must satisfy every original table predicate and every original
  // index/trigger/FK predicate. Emit one total truth row per fixed check rather
  // than nest all correlated PRAGMA expressions in one expression tree.
  const modeChecks = [
    ...tableChecks.map(check => `NOT EXISTS(SELECT 1 FROM native_schema_tables expected WHERE expected.mode=selected.mode AND NOT (${check}))`),
    `NOT EXISTS(SELECT 1 FROM native_schema_indexes expected WHERE NOT EXISTS(
        SELECT 1 FROM pragma_index_list(json_extract(expected.spec,'$.table'),'main') actual
        WHERE actual.name COLLATE BINARY=json_extract(expected.spec,'$.name') AND actual.origin='c'
          AND actual."unique"=json_extract(expected.spec,'$.unique') AND actual.partial=0
          AND EXISTS(SELECT 1 FROM main.sqlite_schema declaration WHERE declaration.type='index'
            AND declaration.name COLLATE BINARY=actual.name AND declaration.tbl_name COLLATE BINARY=json_extract(expected.spec,'$.table'))
          AND (SELECT COUNT(*) FROM pragma_index_xinfo(actual.name,'main') WHERE "key"=1)=json_array_length(expected.spec,'$.columns')
          AND NOT EXISTS(SELECT 1 FROM pragma_index_xinfo(actual.name,'main') part WHERE part."key"=1
            AND NOT EXISTS(SELECT 1 FROM json_each(expected.spec,'$.columns') column
              WHERE json_array(part.seqno,part.cid,part.name,part."desc",part.coll)=column.value))))`,
    `NOT EXISTS(SELECT 1 FROM main.sqlite_schema actual WHERE actual.type='trigger'
        AND lower(actual.tbl_name) IN(SELECT json_extract(spec,'$.name') FROM native_schema_tables WHERE mode=selected.mode)
        AND NOT EXISTS(SELECT 1 FROM native_schema_triggers expected,json_each(expected.spec,'$.definitions') definition
          WHERE expected.mode=selected.mode AND actual.name COLLATE BINARY=json_extract(expected.spec,'$.name')
            AND actual.tbl_name COLLATE BINARY=json_extract(expected.spec,'$.table') AND actual.sql COLLATE BINARY=definition.value))`,
    `NOT EXISTS(SELECT 1 FROM native_schema_triggers expected WHERE expected.mode=selected.mode
        AND NOT EXISTS(SELECT 1 FROM main.sqlite_schema actual,json_each(expected.spec,'$.definitions') definition
          WHERE actual.type='trigger' AND actual.name COLLATE BINARY=json_extract(expected.spec,'$.name')
            AND actual.tbl_name COLLATE BINARY=json_extract(expected.spec,'$.table') AND actual.sql COLLATE BINARY=definition.value))`,
    `NOT EXISTS(SELECT 1 FROM main.sqlite_schema child,pragma_foreign_key_list(child.name,'main') relation
        WHERE child.type='table' AND instr(lower(child.sql),'references')>0
          AND (lower(relation.[table]) IN('event_write_stage','output_atomic_assertions')
            OR selected.mode=1 AND lower(relation.[table])='scene_source_generations'))`,
  ];
  // Workerd permits at most five terms in a compound SELECT. Fixed groups of
  // four preserve all eleven obligations without changing that runtime limit.
  const checkGroups = Array.from({ length: Math.ceil(modeChecks.length / 4) }, (_, index) =>
    modeChecks.slice(index * 4, index * 4 + 4).map(check => `SELECT selected.mode,CASE WHEN (${check}) THEN 1 ELSE 0 END AS allowed FROM native_schema_modes selected`).join(" UNION ALL "));
  const checkTables = checkGroups.map((group, index) => `native_schema_checks_${index} AS MATERIALIZED (${group})`).join(",");
  const truthRows = checkGroups.map((_, index) => `SELECT mode,allowed FROM native_schema_checks_${index}`).join(" UNION ALL ");
  return { sql: `WITH native_schema_manifest AS (SELECT ? AS body),
    native_schema_modes(mode) AS (VALUES(0),(1)),
    native_schema_tables AS (
      SELECT mode,value AS spec FROM native_schema_modes,native_schema_manifest,json_each(body,'$.tables')
      UNION ALL SELECT 1,value FROM native_schema_manifest,json_each(body,'$.sceneTables')),
    native_schema_triggers AS (
      SELECT mode,value AS spec FROM native_schema_modes,native_schema_manifest,json_each(body,'$.triggers')
      UNION ALL SELECT 1,value FROM native_schema_manifest,json_each(body,'$.sceneTriggers')),
    native_schema_indexes AS (SELECT value AS spec FROM native_schema_manifest,json_each(body,'$.indexes')),${checkTables},native_schema_checks AS MATERIALIZED (${truthRows})
    SELECT EXISTS(SELECT 1 FROM native_schema_checks GROUP BY mode HAVING COUNT(*)=${modeChecks.length} AND MIN(allowed)=1)`,
    bindings: [JSON.stringify({ tables, sceneTables: [sceneTable], triggers, sceneTriggers, indexes })] };
}
