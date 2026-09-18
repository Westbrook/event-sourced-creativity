/** Finite transport for the real personal Audio output continuation.
 * The original C debit supplies accounting, never custody or write authority.
 * Every accepted native descriptor is closed below; no route installs this owner. */
import { canonicalJson, digest as audioIssuerDigest, exactKeys, record as audioIssuerRecord } from "../src/experiences/compiler.ts";
import { experienceResourceId, type ExperiencePlan } from "../src/experiences/intake.ts";
import { continueExperienceAuthorization } from "./experience-intake-read.ts";
import { PRINCIPAL_WITH_ACCESS_SQL } from "./access-policy.ts";
import { experienceOutputBinding, experienceOutputCommandKey } from "./experience-output-binding.ts";
import { scenePreparationCyclePrefix, MAX_SCENE_PREPARATION_RENEWALS } from "./experience-scene-renewal.ts";
import { createAudioOutputContract } from "../src/model/output-audio-contract.ts";
import { createExperienceOutputRecipe } from "./experience-output-recipe.ts";
import { requireSponsorAudioOutputReadBudget, retireSponsorAudioOutputReadBudget, type SponsorAudioOutputReadBudget } from "./experience-sponsor-audio-output-attempts.ts";
import { packSponsorIntakeReadQuery } from "./experience-sponsor-intake-read-sql.ts";
import { SponsorEntitlementError, captureSponsorAudioJson, compileSponsorAudioEnvelope, type SponsorEnvelopeV8 } from "./experience-sponsor-policy.ts";
import { recognizeNativePredicate, recognizeNativeScalarAssertion, type ConfirmationMutationIdentity } from "./experience-sponsor-image-confirmation-native.ts";
import { outputCommandReceiptAssertion, outputScopeAuthority, retainedOutputBodyAssertions, type OutputCommandReceipt, type OutputSqlAssertion } from "./output-command-core.ts";
import { EVENT_WRITE_COLUMNS, EVENT_WRITE_STAGE_TRIGGER_SQL, eventWriteBindings, type EventRow } from "./event-write-primitives.ts";
import type { ProjectIntakeAuthorization } from "./intake-authority.ts";
import { outputDigest, outputActiveSourceDeadlineAssertions } from "./output-disclosure-proof.ts";
import { compileOutputPlan } from "../src/model/output-plan.ts";
import type { OutputRequirementSpec } from "../src/model/output-requirements.ts";
import { outputTargetContractDigest } from "./output-requirements-api.ts";
import { isSponsorAudioOutputTrustedContext, isSponsorAudioOutputFinalResponse, isSponsorAudioOutputSelection } from "./experience-output-api.ts";
import { isSponsorAudioOutputSourceProof } from "./output-audio-source.ts";
import { takeSponsorAudioOutputNativeRead, isSponsorAudioOutputNativeProof, isSponsorAudioOutputNativePlan, sponsorAudioOutputPrivateCatalogProof,
  describeSponsorAudioOutputLaterRead, observeSponsorAudioOutputLaterRead, sponsorAudioOutputLaterNativeFacts, type SponsorAudioOutputNativeRead } from "./experience-sponsor-audio-output-native.ts";
import { outputAudioPreflightAssertions } from "./output-audio-preflight.ts";
import type { OutputNativeTargetPreflight, OutputPlanSuggestions } from "../src/model/output-delivery-contract.ts";
import { outputExperienceCommands, type OutputExecutionBridge, type OutputBridgeTargetInput, type OutputTrustedContext } from "./output-requirements-api.ts";
import { OUTPUT_REQUIREMENTS_SCHEMA } from "./output-requirements-schema.ts";
import { SCENE_SOURCE_GENERATION_TABLES } from "../db/scene-source-generation-tables.ts";
import { SCENE_SOURCE_GENERATION_TRIGGERS } from "../db/scene-source-generations.ts";
import { sponsorAudioOutputHandoffSource, sponsorAudioOutputAdmissionNative, type AudioSponsorAdmissionPreparation } from "./output-audio-sponsored-handoff.ts";
import { sponsorAudioOutputActorContext } from "./experience-sponsor-audio-actor-evidence.ts";
import { sponsorAudioOutputEvidenceContext, sponsorAudioOutputEvidenceInput } from "./experience-sponsor-audio-evidence.ts";
import { isSponsorAudioOutputAuthorizeClone, authorizeSponsoredAudio, sponsorAudioOutputDriverFrame, isSponsorAudioOutputDriverRecovered, sponsorAudioOutputAuthorizationReload, sponsorAudioOutputAuthorizationDisclosure, type SponsorAudioAuthorizeSelection } from "./experience-sponsor-audio-authorize.ts";
import { readSponsorAudioCurrentReview, type SponsorAudioServerConfiguration } from "./experience-sponsor-audio-review.ts";
import { inheritRuntimeSchemaReadiness, SCOPED_EVENT_PAGE_SIZE, type WorkerEnv } from "./runtime.ts";
import { matchSponsorAudioTemplate } from "./experience-sponsor-audio-contract.ts";
import { prepareSponsorResourcePlan } from "./experience-sponsor-resources.ts";
import { sponsorApprovalAssertion, sponsorIssuedAuthorityAssertion } from "./experience-sponsor-approval.ts";
import { sponsorCurrentSourceAssertions } from "./experience-sponsor-image-evidence.ts";
import { POLICY_VERSION } from "./policy-version.ts";
import { PROFILE_EXCLUDED_EVENT_TYPES } from "../src/model/event-profiles.ts";
import { PHANTOM_ATTENTION_EVENT_SQL } from "../db/event-predicates.ts";
import { outputDocumentExecutionBridge, prepareAdmission as prepareNativeAudioAdmission } from "./output-document-execution.ts";
import { issueSponsorAudioGrant, type SponsorAudioIssuedGrant } from "./experience-sponsor-audio-issuer.ts";
import { sponsorAdmissionPayer, sponsorAdmissionPlan, sponsorAudioAdmissionPreparation, sponsorPrincipalDigest } from "./experience-sponsor-admission.ts";

type Value = string | number | null;
type Row = Record<string, unknown>;
type Proof = Readonly<{ sql: string; bindings?: readonly Value[]; deadlineMs?: number }>;
type Captured = Readonly<{ sql: string; bindings: readonly Value[] }>;
type Budget = ReturnType<typeof requireSponsorAudioOutputReadBudget>;
type Descriptor = { kind: string; columns: readonly string[]; maximumRows: number; order?: string; invalidRow?: string; assertions?: readonly Proof[] };
export type SponsorAudioOutputRows = { sql: string; bindings: readonly unknown[]; columns: readonly string[]; maximumRows: number; invalidRow: string; assertions?: readonly Proof[] };
declare const ownerBrand: unique symbol;
export type SponsorAudioOutputReadOwner = Readonly<{ [ownerBrand]: true }>;
type Identity = ConfirmationMutationIdentity & { keys: Readonly<Record<string, string>>; plan: ExperiencePlan; planBytes: string; target: Row };
type Stage = { trusted: OutputTrustedContext; envelope: Readonly<Row>; serialized: string; phase: "save" | "confirm" | "preflight"; dispatched: boolean; lostAckRead?: boolean; lostAckInFlight?: boolean; recovered?: boolean; proofs: readonly Proof[]; sourcePrefix: readonly Proof[] };
type NativeContext = { facts: string; source: readonly Proof[]; check: () => void };
type DriverFrame = { token: object; trusted: OutputTrustedContext; intent: Readonly<Row>; stage: Readonly<{ command_json: string; command_digest: string }>; assertions: readonly Proof[]; dispatched: boolean };
type LaterPhase = { trusted: OutputTrustedContext; kind: "review" | "authorize"; selection: Readonly<SponsorAudioServerConfiguration>; serialized: string; reloading: boolean };
type LaterInput = { trusted: OutputTrustedContext; check: () => void; facts: string; retained: boolean };
type FinalAuthorization = { token: object; trusted: OutputTrustedContext; response: object; responseJson: string; assertions: readonly Proof[]; assertCurrent: () => void };
type State = {
  owner: SponsorAudioOutputReadOwner; request: Request; originalEnv: WorkerEnv; env: WorkerEnv; db: WorkerEnv["DB"]; budget: SponsorAudioOutputReadBudget; data: Budget;
  auth: ProjectIntakeAuthorization; closed: boolean; bodyRead: boolean; transporting?: boolean; identity?: () => Promise<Identity>; identityPending?: Promise<Identity>; resolvedIdentity?: Identity; contexts: WeakMap<OutputTrustedContext, NativeContext>; currentContext?: OutputTrustedContext; frame?: DisclosureFrame; planBytes?: string;
  proofs: Proof[]; transportProofs: Proof[]; observedBodies: Map<string, { raw: string; projectId: string | null; documentId: string | null }>;
  observedEvents: Set<string>; observedPlans: Set<string>; planEvents: Set<string>; preflightEvents: Set<string>;
  statements: WeakMap<D1PreparedStatement, Captured>; stage?: Stage; later?: LaterPhase; driver?: DriverFrame; driverRecovery?: DriverFrame; recoveryProofBatch?: readonly Captured[]; authorizationCommand?: Readonly<Row>; authorizationReload?: { command: Readonly<Row>; receipt: OutputCommandReceipt }; finalAuthorization?: FinalAuthorization; recovery?: "driver" | "issuer" | "admission"; parserPasses: number; parserActive: boolean; derivatives: WeakMap<OutputTrustedContext, { parent: OutputTrustedContext; check: () => void; facts: string }>; laterInputs: WeakMap<OutputBridgeTargetInput, LaterInput>;
};
const rowObservations = new WeakMap<object, { state: State; sql: string; bindings: readonly unknown[]; witness: OutputSqlAssertion }>();
const usedAuthorizationReloads = new WeakSet<object>();
const openedBudgets = new WeakSet<SponsorAudioOutputReadBudget>();
const parserRequests = new WeakMap<Request, { state: State; source: Request; used: boolean; signal: AbortSignal; facts: string }>();
const requestFacts = (request: Request) => JSON.stringify({ method: request.method, url: request.url, headers: [...request.headers] });
const requestSignal = (request: Request): AbortSignal => Object.getOwnPropertyDescriptor(Request.prototype, "signal")!.get!.call(request);
const requestUnused = (request: Request): boolean => Reflect.get(Request.prototype, "bodyUsed", request) === false;
const laterOperation = (state: State) => state.data.operation === "audio-output-review" || state.data.operation === "audio-output-authorize";
type DisclosureFrame = { trusted: OutputTrustedContext; proof: readonly Captured[]; completed: boolean; facts: string; deadlineMs: number };
const responses = new WeakMap<Response, { state: State; frame: DisclosureFrame; status: number; headers: string }>();
const stageInputs = new WeakMap<Stage, OutputBridgeTargetInput>();
const stageInputChecks = new WeakMap<Stage, () => void>();
const owners = new WeakMap<SponsorAudioOutputReadOwner, State>(), environments = new WeakMap<WorkerEnv, State>();
// Only the private catalog producer can register this exact frozen singleton.
// Its truth is never retained: the first original statement rechecks it in each
// qualifying read-only D1 transaction before any logical batch result escapes.
const laterCatalogProofs = new WeakMap<State, Proof>();
// Only setSponsorAudioOutputNativePlan can register the exact source-owned
// native catalog proof. Retain provenance, never its database truth.
const nativeCatalogProofs = new WeakMap<State, Proof>();
const privateCatalogProofs = new WeakMap<State, Proof>();
const originalMetadataProofs = new WeakMap<State, readonly Proof[]>();
type CarriedCatalogs = { proof: Proof; nativeProof?: Proof; nativeIndex: number;
  privateProof?: Proof; metadataProofs?: readonly Proof[]; extra: readonly { proof: Proof; index: number }[] };
const catalogBatchEncodings = new WeakMap<object, CarriedCatalogs & { state: State; inputs: readonly SponsorAudioOutputRows[]; next: number }>();
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
      if (state.stage?.trusted !== state.currentContext && !sameProofArray(state.currentContext.sourceAssertions, context.source)) {
        const deadlines = laterOperation(state) && state.currentContext.context ? outputActiveSourceDeadlineAssertions(state.currentContext.context) : [];
        if (!deadlines.length || !sameProofArray(state.currentContext.sourceAssertions, [...context.source, ...deadlines])) return fail();
        // The unchanged native producer has appended its one known deadline.
        // Seal that actual array now; it cannot drift during later owned waits.
        lockNativeData(state.currentContext.sourceAssertions);
        context.source = state.currentContext.sourceAssertions.map(capturedProof);
      }
    }
    if (state.stage) stageChecks.get(state.stage)?.();
    if (state.later && canonicalJson(state.later.selection) !== state.later.serialized) return fail();
    if (state.finalAuthorization && (canonicalJson(state.finalAuthorization.response) !== state.finalAuthorization.responseJson
      || state.finalAuthorization.assertions.some(proof => proof.deadlineMs !== undefined && Date.now() >= proof.deadlineMs))) return fail();
    if (state.frame && (disclosureFacts(state.frame.trusted) !== state.frame.facts || Date.now() >= state.frame.deadlineMs)) return fail();
    if (state.originalEnv.DB !== state.db || state.env.DB === state.db || state.auth.user !== state.data.authenticated.user
      || state.proofs.some(proof => proof.deadlineMs !== undefined && Date.now() >= proof.deadlineMs)) return fail();
  } catch (error) { closeSponsorAudioOutputReads(state.owner); throw error; }
}
function get(owner: SponsorAudioOutputReadOwner, request?: Request, env?: WorkerEnv): State {
  const state = owners.get(owner);
  if (!state || request !== undefined && request !== state.request || env !== undefined && env !== state.originalEnv && env !== state.env && environments.get(env) !== state) return fail();
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
/** Later native producers accept absent error and an own data error:undefined.
 * Preserve that exact ABI without invoking getters or tolerating sparse ACKs. */
function captureLaterResults(value: unknown, maximum: number) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).length !== value.length + 1) return fail();
  const values = Array.from({ length: value.length }, (_, at) => {
    const ack = own(value, at); if (!record(ack) || ![Object.prototype, null].includes(Object.getPrototypeOf(ack))) return fail();
    const descriptors = Object.getOwnPropertyDescriptors(ack), error = descriptors.error;
    if (!error) return ack;
    // Retain actual error data for bounded measurement before semantic denial.
    // The generic capture still rejects accessors and non-enumerable fields.
    if (!Object.hasOwn(error, "value") || error.value !== undefined || !error.enumerable) return ack;
    delete descriptors.error;
    return Object.create(Object.getPrototypeOf(ack), descriptors) as Row;
  });
  return captureResult(values, maximum);
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
// Exact snapshot EXISTS from executionAdmissionGuard in intake-authority.ts.
// It has eleven anonymous parameters and returns only SQLite 0 or 1.
const audioIntakePrincipalLeaf = `EXISTS(SELECT 1 FROM(${PRINCIPAL_WITH_ACCESS_SQL}) principal WHERE principal.user_id=? AND principal.role=?
    AND principal.updated_at=? AND principal.consent_version=? AND COALESCE(principal.permission_epoch,'')=?
    AND COALESCE(principal.grants_json,'[]')=? AND COALESCE(principal.organizations_json,'[]')=?
    AND COALESCE(principal.projects_json,'[]')=? AND COALESCE(principal.identity_policies_json,'[]')=?
    AND COALESCE(principal.approved_canvas_requirements,0)=?)`;
const audioIntakePrincipalTail = `
     AND NOT EXISTS(SELECT 1 FROM organization_projects project WHERE project.owner_user_id=? AND project.project_id=?)
      AND NOT EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.owner_user_id=? AND resource.resource_kind='document' AND resource.resource_id=?) AND `;

// Use only after owned proof admission and the original SQL collision check.
// These copies change statement encoding; original proofs retain their authority.
function sharedAudioIntakePrincipals(proofs: readonly Proof[], prefix: string) {
  type Group = { values: readonly Value[]; indices: number[]; name?: string };
  const groups: Group[] = [];
  const candidates = proofs.map((proof, index) => {
    // Nothing before this source-owned leaf can contain a scalar or expression.
    const offset = /^\(*/u.exec(proof.sql)![0].length;
    const values = proof.bindings ?? [];
    if (values.length < 15 || !proof.sql.startsWith(audioIntakePrincipalLeaf + audioIntakePrincipalTail, offset)) return null;
    const captured = values.slice(0, 11);
    let group = groups.find(value => same(value.values, captured));
    if (!group) { group = { values: captured, indices: [] }; groups.push(group); }
    group.indices.push(index);
    return { group, offset };
  });
  const shared = groups.filter(group => group.indices.length > 1);
  shared.forEach((group, index) => { group.name = `${prefix}_principal_${index}`; });
  return {
    definitions: shared.map(group => ({ name: group.name!, sql: `SELECT (${audioIntakePrincipalLeaf}) AS value`, bindings: group.values })),
    proofs: proofs.map((proof, index) => {
      const candidate = candidates[index];
      if (!candidate?.group.name) return proof;
      return { ...proof, sql: proof.sql.slice(0, candidate.offset)
        + `(SELECT value FROM ${candidate.group.name})`
        + proof.sql.slice(candidate.offset + audioIntakePrincipalLeaf.length),
        bindings: (proof.bindings ?? []).slice(11) };
    }),
  };
}

// Only these complete native wrappers have a known first actor binding. No
// substring search or SQL parameter parsing may promote another query scope.
const audioPrincipalColumns = ["user_id", "role", "consent_version", "updated_at", "permission_epoch", "grants_json", "organizations_json", "projects_json", "identity_policies_json", "approved_canvas_requirements", "email", "display_name", "consented_at"] as const;
const audioEvidencePrincipalColumns = ["user_id", "email", "display_name", "role", "consent_version", "updated_at", "permission_epoch", "grants_json", "organizations_json", "projects_json", "identity_policies_json", "approved_canvas_requirements"] as const;
const audioPrincipalWrappers = [
  ...[audioPrincipalColumns, audioEvidencePrincipalColumns].map(columns => ({ before: "EXISTS(SELECT 1 FROM (",
    after: `) captured WHERE json_array(${columns.map(column => `captured.${column}`).join(",")})=?)` })),
  { before: `COALESCE((SELECT json_group_array(json_array(${audioPrincipalColumns.map(column => `row."${column}"`).join(",")})) FROM (`, after: ") row),'[]')=?" },
].flatMap(wrapper => [wrapper, { before: `SELECT CASE WHEN (${wrapper.before}`, after: `${wrapper.after}) THEN 1 ELSE 0 END AS current` }]);
// Full bounded actor snapshot from the original C producer. It is eligible
// only as an exact retained C assertion, never merely by matching this shape.
const audioOriginalPrincipalJsonColumns = new Set<string>(["grants_json", "organizations_json", "projects_json", "identity_policies_json"]);
const audioOriginalPrincipalBound = audioPrincipalColumns.map(column => column === "approved_canvas_requirements"
  ? `typeof(native.${column})='integer' AND native.${column} BETWEEN 0 AND 9007199254740991`
  : `${["consent_version", "consented_at"].includes(column) ? `(native.${column} IS NULL OR (` : "("}typeof(native.${column})='text'
    AND length(CAST(native.${column} AS BLOB))<=${audioOriginalPrincipalJsonColumns.has(column) ? 131072 : column === "display_name" ? 4096 : 1024}
    AND instr(native.${column},char(0))=0${audioOriginalPrincipalJsonColumns.has(column) ? ` AND CASE WHEN json_valid(native.${column}) THEN json_type(native.${column})='array' ELSE 0 END` : ""})${["consent_version", "consented_at"].includes(column) ? ")" : ""}`).join(" AND ");
const audioOriginalPrincipalWrapper = { before: "EXISTS(SELECT 1 FROM (WITH native AS MATERIALIZED (", after: `)
  SELECT ${audioPrincipalColumns.map(column => `native.${column}`).join(",")} FROM native WHERE ${audioOriginalPrincipalBound} LIMIT 2) captured WHERE json_array(${audioPrincipalColumns.map(column => `captured.${column}`).join(",")})=?)` };
function audioPrincipalFragment(value: Captured, intake: boolean, original: boolean): { before: string; after: string; directRelation?: true } | null {
  if (intake && value.sql === `SELECT (${audioIntakePrincipalLeaf}) AS value` && value.bindings.length === 11) {
    const before = "SELECT (EXISTS(SELECT 1 FROM(";
    const after = value.sql.slice(before.length + PRINCIPAL_WITH_ACCESS_SQL.length);
    // Only this exact source-owned EXISTS wrapper becomes a total count truth
    // row. Empty, duplicate and NULL-comparison inputs retain the same 0/1;
    // the ten ordered comparisons and their original bindings are unchanged.
    return { before: "SELECT COUNT(*)>0 AS value FROM ", after: after.slice(1, -")) AS value".length), directRelation: true };
  }
  if (value.sql === PRINCIPAL_WITH_ACCESS_SQL && value.bindings.length === 1) return { before: "", after: "" };
  if (value.bindings.length !== 2) return null;
  if (original && value.sql === audioOriginalPrincipalWrapper.before + PRINCIPAL_WITH_ACCESS_SQL + audioOriginalPrincipalWrapper.after) return audioOriginalPrincipalWrapper;
  return audioPrincipalWrappers.find(wrapper => value.sql === wrapper.before + PRINCIPAL_WITH_ACCESS_SQL + wrapper.after) ?? null;
}
function sharedAudioPrincipalRows(definitions: readonly (Captured & { name: string })[], proofs: readonly Proof[], row: Captured, prefix: string, actorUserId: string, originalProofs: readonly Proof[]) {
  type Group = { actor: Value; count: number; name?: string };
  const groups: Group[] = [];
  const fragments: Captured[] = [...definitions, ...proofs.map(proof => ({ sql: proof.sql, bindings: proof.bindings ?? [] })), row];
  const candidates = fragments.map((fragment, index) => {
    const proof = index >= definitions.length && index < definitions.length + proofs.length ? proofs[index - definitions.length] : undefined;
    const original = !!proof && originalProofs.some(value => value.sql === proof.sql && value.deadlineMs === proof.deadlineMs
      && same(value.bindings ?? [], proof.bindings ?? []));
    const wrapper = audioPrincipalFragment(fragment, index < definitions.length, original);
    if (!wrapper || !Object.is(fragment.bindings[0], actorUserId)) return null;
    const actor = fragment.bindings[0]!;
    let group = groups.find(value => Object.is(value.actor, actor));
    if (!group) { group = { actor, count: 0 }; groups.push(group); }
    group.count++;
    return { wrapper, group };
  });
  const shared = groups.filter(group => group.count > 1);
  shared.forEach((group, index) => { group.name = `${prefix}_principal_rows_${index}`; });
  const encoded = fragments.map((fragment, index) => {
    const candidate = candidates[index];
    if (!candidate?.group.name) return fragment;
    return { sql: candidate.wrapper.before + (candidate.wrapper.directRelation ? candidate.group.name : `SELECT * FROM ${candidate.group.name}`) + candidate.wrapper.after,
      bindings: fragment.bindings.slice(1) };
  });
  return {
    definitions: [...shared.map(group => ({ name: group.name!, sql: PRINCIPAL_WITH_ACCESS_SQL, bindings: [group.actor] })),
      ...definitions.map((definition, index) => ({ name: definition.name, ...encoded[index]! }))],
    proofs: proofs.map((proof, index) => ({ ...proof, ...encoded[definitions.length + index]! })),
    row: encoded[encoded.length - 1]!,
  };
}
/** Batch-local reuse of pure parameter encoding only; no database truth is cached.
 * The quota bounds retained encoding units, not JavaScript engine heap bytes. */
function createSponsorAudioProofPackMemo(maximumEntries: number): {
  pack(sql: string, bindings: readonly unknown[], provenance: readonly unknown[]): ReturnType<typeof packSponsorIntakeReadQuery>;
  retire(): void;
} | null {
  if (!Number.isSafeInteger(maximumEntries) || maximumEntries < 1 || maximumEntries > 1000) return null;
  type Key = string | number | null | readonly Key[];
  type Packed = ReturnType<typeof packSponsorIntakeReadQuery>;
  const quota = 8 * 1024 * 1024;
  const entries: { key: Key; packed: Packed }[] = [];
  let retained = 0, retired = false;
  const capture = (input: unknown): { key: Key; weight: number } | undefined => {
    let weight = 0, nodes = 0;
    const visit = (value: unknown, depth: number): Key | undefined => {
      if (++nodes > 100_000 || depth > 16) return undefined;
      if (value === null || typeof value === "string" || typeof value === "number" && Number.isFinite(value)) {
        weight += 16 + (typeof value === "string" ? value.length * 2 : 0);
        return weight <= quota ? value : undefined;
      }
      if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return undefined;
      const length = Object.getOwnPropertyDescriptor(value, "length");
      if (!length || !Object.hasOwn(length, "value") || !Number.isSafeInteger(length.value) || length.value < 0 || length.value > 100_000) return undefined;
      weight += 32 + length.value * 8;
      if (weight > quota || Reflect.ownKeys(value).length !== length.value + 1) return undefined;
      const result: Key[] = [];
      for (let at = 0; at < length.value; at++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(at));
        if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) return undefined;
        const item = visit(descriptor.value, depth + 1);
        if (item === undefined) return undefined;
        result.push(item);
      }
      return Object.freeze(result);
    };
    try {
      const key = visit(input, 0);
      return key === undefined ? undefined : { key, weight };
    } catch { return undefined; }
  };
  const equal = (a: Key, b: Key): boolean => {
    if (Object.is(a, b)) return true;
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length
      && a.every((value, at) => equal(value, b[at]!));
  };
  return {
    pack(sql, bindings, provenance) {
      if (retired) return packSponsorIntakeReadQuery(sql, bindings);
      const captured = capture([sql, bindings, provenance]);
      if (!captured) return packSponsorIntakeReadQuery(sql, bindings);
      const previous = entries.find(entry => equal(entry.key, captured.key));
      if (previous) return previous.packed;
      // Do not cache thrown errors or replace the original packer's validation.
      const packed = packSponsorIntakeReadQuery(sql, bindings);
      const weight = captured.weight + 64 + packed.sql.length * 2
        + packed.bindings.reduce((total, value) => total + 16 + value.length * 2, 0);
      if (entries.length < maximumEntries && retained + weight <= quota) {
        Object.freeze(packed.bindings); Object.freeze(packed);
        entries.push({ key: captured.key, packed }); retained += weight;
      }
      return packed;
    },
    retire() { retired = true; entries.length = 0; retained = 0; },
  };
}
/** Catalog and original-metadata factoring inside one existing atomic read-only batch. This is
 * a synchronous encoding token, not a cached result or a caller capability. */
function beginCatalogBatchEncoding(state: State, inputs: readonly SponsorAudioOutputRows[], descriptors: readonly Descriptor[]): object | null {
  const proof = laterCatalogProofs.get(state);
  if (!laterOperation(state) || inputs.length < 2 || inputs.length !== descriptors.length || !proof
    || proof.deadlineMs !== undefined || state.transportProofs.length !== 1 || state.transportProofs[0] !== proof
    || descriptors.some((value, at) => !["proof", "later-proof"].includes(value.kind)
      || value.maximumRows !== 1 || !same(value.columns, ["current"])
      || inputs[at]!.maximumRows !== 1 || !same(inputs[at]!.columns, ["current"]))) return null;
  const nativeProof = nativeCatalogProofs.get(state), nativeIndex = nativeProof ? state.proofs.indexOf(nativeProof) : -1;
  if (nativeProof && (nativeIndex < 0 || nativeProof.deadlineMs !== undefined)) return fail();
  const privateProof = privateCatalogProofs.get(state), metadataProofs = originalMetadataProofs.get(state);
  const extra = [...(metadataProofs ?? []), ...(privateProof ? [privateProof] : [])].map(item => {
    const index = state.proofs.indexOf(item);
    if (index < 0 || item.deadlineMs !== undefined || item === nativeProof) return fail();
    return Object.freeze({ proof: item, index });
  });
  if (new Set(extra.map(item => item.index)).size !== extra.length) return fail();
  const token = Object.freeze({});
  catalogBatchEncodings.set(token, { state, proof, nativeProof, nativeIndex, privateProof, metadataProofs,
    extra: Object.freeze(extra), inputs, next: 0 });
  return token;
}
function carriedCatalogProof(state: State, input: SponsorAudioOutputRows, token: object): CarriedCatalogs | undefined {
  const encoding = catalogBatchEncodings.get(token);
  if (!encoding || encoding.state !== state || encoding.inputs[encoding.next] !== input
    || laterCatalogProofs.get(state) !== encoding.proof || state.transportProofs.length !== 1
    || state.transportProofs[0] !== encoding.proof || encoding.proof.deadlineMs !== undefined
    || nativeCatalogProofs.get(state) !== encoding.nativeProof
    || encoding.nativeProof && (encoding.nativeProof.deadlineMs !== undefined || state.proofs[encoding.nativeIndex] !== encoding.nativeProof)
    || privateCatalogProofs.get(state) !== encoding.privateProof || originalMetadataProofs.get(state) !== encoding.metadataProofs
    || encoding.extra.some(item => item.proof.deadlineMs !== undefined || state.proofs[item.index] !== item.proof)) return fail();
  // Slot zero rechecks every exact registered catalog/original-metadata snapshot.
  // Only this same atomic read-only scalar batch shares them. Actor/grant expiry,
  // C validity/attempt clocks, custody and native input predicates stay per slot.
  return encoding.next++ === 0 ? undefined : encoding;
}
function composeRows(state: State, input: SponsorAudioOutputRows, maximum: number, memo?: ReturnType<typeof createSponsorAudioProofPackMemo>, catalogEncoding?: object) {
  current(state);
  const b = input.bindings;
  if (typeof input.sql !== "string" || !input.sql || input.sql.includes("\0") || !Array.isArray(b) || b.some(value => !scalar(value))
    || !integer(input.maximumRows) || input.maximumRows > 1_000_000 || !input.columns.length || input.columns.length > 32 || typeof input.invalidRow !== "string" || !input.invalidRow || input.invalidRow.includes("\0")
    || input.columns.some(key => !/^[a-z][a-z0-9_]*$/u.test(key)) || new Set(input.columns).size !== input.columns.length) return fail();
  const proofs: Proof[] = [], packingProofs: Proof[] | undefined = memo ? [] : undefined;
  const mandatoryCount = state.proofs.length, transportCount = state.transportProofs.length;
  const carried = catalogEncoding ? carriedCatalogProof(state, input, catalogEncoding) : undefined;
  for (const [at, raw] of [...state.proofs, ...state.transportProofs, ...(input.assertions ?? [])].entries()) {
    const proof = capturedProof(raw);
    packingProofs?.push(proof);
    const extra = carried?.extra.find(item => item.index === at);
    if (carried && (at === mandatoryCount || at === carried.nativeIndex || extra)) {
      if (raw !== (at === mandatoryCount ? carried.proof : at === carried.nativeIndex ? carried.nativeProof : extra?.proof)) return fail();
      continue; // Only privately registered, statement-invariant contributions.
    }
    // The real native intake check repeats its exact draft/custody predicate.
    // Retain one identical observation; never drop a distinct scalar or expiry.
    if (!proofs.some(previous => previous.sql === proof.sql && previous.deadlineMs === proof.deadlineMs
      && same(previous.bindings ?? [], proof.bindings ?? []))) proofs.push(proof);
  }
  if (!proofs.length) return fail();
  let prefix = "audio_output_native";
  const source = [input.sql, ...proofs.map(proof => proof.sql), ...(carried ? [carried.proof.sql, ...(carried.nativeProof ? [carried.nativeProof.sql] : []), ...carried.extra.map(item => item.proof.sql)] : [])].join("\n").toLowerCase();
  while (source.includes(prefix)) prefix += "_";
  const gateNames = proofs.map((_, index) => `${prefix}_gate_${index}`), authority = `${prefix}_authority`, rows = `${prefix}_rows`, meta = `${prefix}_meta`;
  const data = `json_array(${input.columns.map(column => `row."${column}"`).join(",")})`;
  // Each predicate yields one truth row. False/NULL cannot disappear and masquerade as an empty authorized source.
  const sharedPrincipals = laterOperation(state) ? sharedAudioIntakePrincipals(proofs, prefix)
    : { definitions: [], proofs };
  const valid = balancedConjunction(gateNames.map(name => `(SELECT allowed FROM ${name})=1`));
  // A native proof SELECT often asks for the very same scalar already required
  // by an authority gate. Reuse that exact materialized truth row, including
  // its false/NULL-to-zero behavior, instead of duplicating SQL and parameters.
  const shared = input.columns.length === 1 && input.columns[0] === "current" ? proofs.findIndex(proof =>
    input.sql === `SELECT CASE WHEN (${proof.sql}) THEN 1 ELSE 0 END AS current` && same(b, proof.bindings ?? [])) : -1;
  const row = { sql: shared < 0 ? input.sql : `SELECT allowed AS current FROM ${gateNames[shared]}`, bindings: shared < 0 ? b as readonly Value[] : [] };
  const encoded = laterOperation(state) ? sharedAudioPrincipalRows(sharedPrincipals.definitions, sharedPrincipals.proofs, row, prefix, state.auth.user.userId, state.data.assertions)
    : { definitions: sharedPrincipals.definitions, proofs: sharedPrincipals.proofs, row };
  const gates = encoded.proofs.map((proof, at) => `${gateNames[at]} AS MATERIALIZED (SELECT CASE WHEN (${proof.sql}) THEN 1 ELSE 0 END AS allowed)`);
  const definitions = encoded.definitions.map(definition => `${definition.name} AS MATERIALIZED (${definition.sql})`);
  const sql = `WITH ${[...definitions, ...gates].join(",")},${authority} AS MATERIALIZED (SELECT CASE WHEN ${valid} THEN 1 ELSE 0 END AS allowed),
    ${rows} AS MATERIALIZED (${encoded.row.sql}),${meta} AS MATERIALIZED (SELECT COUNT(*) AS count,COALESCE(SUM(CASE WHEN NOT(${input.invalidRow}) THEN 0 ELSE 1 END),0) AS invalid,json_group_array(${data}) AS body FROM ${rows} row)
    SELECT allowed AS authorized,count,CASE WHEN allowed=1 AND invalid=0 AND count<=${input.maximumRows}
      AND length(CAST(json_object('body',body||'') AS BLOB))<=${Math.max(0, maximum - ACK_BYTES)} THEN body ELSE NULL END AS body
    FROM ${meta} CROSS JOIN ${authority}`;
  const bindings = [...encoded.definitions.flatMap(definition => definition.bindings), ...encoded.proofs.flatMap(proof => proof.bindings ?? []), ...encoded.row.bindings];
  const packed = memo ? memo.pack(sql, bindings, [input.sql, b, input.columns, input.invalidRow, input.maximumRows, maximum,
    mandatoryCount, transportCount, packingProofs!.map(proof => [proof.sql, proof.bindings ?? [], proof.deadlineMs === undefined ? null : proof.deadlineMs])])
    : packSponsorIntakeReadQuery(sql, bindings);
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
  const witness = { sql: witnessSql, bindings: [...input.bindings as Value[], row.body] };
  rowObservations.set(native.results, { state, sql: input.sql, bindings: [...input.bindings], witness });
  return { result: native, witness };
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
    get assertions() { current(state); return [...state.proofs]; },
    get currentContext() { current(state); return state.currentContext ?? null; },
    get observedBodies() { current(state); return [...state.observedBodies].map(([id, body]) => [id, { ...body }] as const); },
    get observedPlans() { current(state); return [...state.observedPlans]; },
    get retainedSelection() { current(state); return state.later?.selection ?? null; },
    get retainedCommand() { current(state); return state.authorizationCommand ?? null; },
    get recoveryKind() { current(state); return state.recovery ?? null; },
    isReadObservation(sql: string, bindings: readonly unknown[], rows: object, witness: OutputSqlAssertion) {
      current(state); const observation = rowObservations.get(rows);
      return !!observation && observation.state === state && observation.sql === sql && same(observation.bindings, bindings) && observation.witness === witness;
    }, current: () => current(state),
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
  if (!["audio-output-state", "audio-output-prepare", "audio-output-review", "audio-output-authorize"].includes(data.operation)) return fail();
  const owner = Object.freeze({}) as SponsorAudioOutputReadOwner;
  const bootstrap: { env?: WorkerEnv; auth?: ProjectIntakeAuthorization } = {};
  const state: State = { owner, request, originalEnv: env, get env() { return bootstrap.env ?? fail(); }, get auth() { return bootstrap.auth ?? fail(); }, db: env.DB, budget, data, closed: false, bodyRead: false, parserPasses: 0, parserActive: false, derivatives: new WeakMap(), laterInputs: new WeakMap(),
    proofs: data.assertions.map(capturedProof), transportProofs: [], contexts: new WeakMap(), observedBodies: new Map(), observedEvents: new Set(), observedPlans: new Set(), planEvents: new Set(), preflightEvents: new Set(), statements: new WeakMap(),
  };
  const nativeEnv = Object.freeze({ ...env, DB: nativeDatabase(state), MEDIA: new Proxy({} as WorkerEnv["MEDIA"], { get: () => () => fail("sponsor_audio_output_media_unavailable") }) });
  bootstrap.env = nativeEnv;
  if (data.operation === "audio-output-authorize") inheritRuntimeSchemaReadiness(state.db, nativeEnv.DB);
  // Native authorization is continued from the same real result. This temporary
  // bootstrap does not expose the owner before that actual continuation succeeds.
  const auth = await data.wait(() => continueExperienceAuthorization(request, state.env, data.authenticated));
  if (auth instanceof Response) { retireSponsorAudioOutputReadBudget(budget, request, env); return fail(); }
  bootstrap.auth = Object.freeze(auth); owners.set(owner, state); environments.set(nativeEnv, state);
  if (data.operation === "audio-output-authorize") parserRequests.set(request, { state, source: request, used: false, signal: requestSignal(request), facts: requestFacts(request) });
  current(state);
  if (laterOperation(state)) {
    try {
      // Resolve the real budget producer's exact original metadata to the
      // objects this owner actually retained. Equal caller DTOs never enter.
      const originals = data.originalMetadataAssertions.map(item => {
        if (!data.assertions.includes(item)) return fail();
        const at = data.assertions.indexOf(item), retained = state.proofs[at];
        if (!retained || retained.sql !== item.sql || retained.deadlineMs !== undefined
          || !same(retained.bindings ?? [], item.bindings)) return fail();
        return retained;
      });
      if (originals.length !== 8 || new Set(originals).size !== originals.length) return fail();
      originalMetadataProofs.set(state, Object.freeze(originals));
      const catalog = capturedProof(await data.wait(() => sponsorAudioLaterSchemaProof()));
      state.transportProofs = [catalog]; laterCatalogProofs.set(state, catalog); current(state);
    }
    catch (error) { closeSponsorAudioOutputReads(owner); throw error; }
  }
  return owner;
}
/** Associate only the intrinsic clone minted inside the genuine authorizer.
 * Equal URL/body/headers, or even a clone of this Request, cannot register it. */
export function registerSponsorAudioOutputAuthorizeClone(owner: SponsorAudioOutputReadOwner, original: Request, clone: Request): void {
  const state = get(owner, original);
  if (state.data.operation !== "audio-output-authorize" || !state.later || state.later.kind !== "authorize"
    || !isSponsorAudioOutputAuthorizeClone(owner, original, clone) || parserRequests.has(clone) || clone === original
    || !requestUnused(original) || !requestUnused(clone) || requestFacts(clone) !== requestFacts(original)) return fail();
  const signal = requestSignal(clone);
  if (clone.signal !== signal || Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")!.get!.call(signal) !== false) return fail();
  parserRequests.set(clone, { state, source: original, used: false, signal, facts: requestFacts(clone) });
}
/** The shared parser keeps its existing decoding/cap behavior. This capability
 * owns only one actual parser pass, raw chunks and the original nonrenewing C
 * lifetime. No parser Request or body can mint a second budget. */
export function beginSponsorAudioOutputParserUse(request: Request) {
  const registration = parserRequests.get(request);
  if (!registration) return null;
  const state = registration.state; get(state.owner);
  if (registration.used || state.parserActive || state.transporting || state.parserPasses >= 2
    || state.data.operation !== "audio-output-authorize" || state.later?.kind !== "authorize") return fail();
  registration.used = true; state.parserPasses++; state.parserActive = true;
  let active = true;
  const check = () => {
    current(state);
    if (!active || !state.parserActive || requestSignal(request) !== registration.signal || request.signal !== registration.signal
      || Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")!.get!.call(registration.signal) !== false
      || requestFacts(request) !== registration.facts || !requestUnused(request) || !requestUnused(state.request)
      || registration.source !== state.request) return fail();
  };
  check();
  return Object.freeze({ current: check,
    async wait<T>(work: () => Promise<T>): Promise<T> { check(); const result = await state.data.wait(work); check(); return result; },
    accountChunk(chunk: Uint8Array) {
      check(); if (!(chunk instanceof Uint8Array)) return fail();
      const size = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), "byteLength")!.get!.call(chunk);
      if (!integer(size) || chunk.byteLength !== size) return fail();
      state.data.account({ bytes: size, queries: 0, rows: 0 }); check();
    },
    finish() { check(); active = false; state.parserActive = false; },
    cancel(reason?: unknown) { void reason; active = false; state.parserActive = false; closeSponsorAudioOutputReads(state.owner); },
  });
}
/** A context enters only through the existing API producer or one of the two
 * exact native derivative producers. JSON equality never supplies this brand. */
export function requireSponsorAudioOutputContext(owner: SponsorAudioOutputReadOwner, trusted: OutputTrustedContext): void {
  const state = get(owner, trusted.request, trusted.env);
  if (!laterOperation(state) || trusted.request !== state.request) return fail();
  const native = state.contexts.get(trusted), derivative = state.derivatives.get(trusted);
  if (native) {
    native.check();
    if (!isSponsorAudioOutputTrustedContext(owner, trusted) || native.facts !== trustedFacts(trusted)
      || trusted.env !== state.env || trusted.principal !== state.auth.user) return fail();
  } else if (derivative) {
    derivative.check();
    if (derivative.facts !== disclosureFacts(trusted)) return fail();
  } else return fail("sponsor_audio_output_native_context_unowned");
}
export function registerSponsorAudioOutputActorContext(owner: SponsorAudioOutputReadOwner, parent: OutputTrustedContext, trusted: OutputTrustedContext): void {
  const state = get(owner); requireSponsorAudioOutputContext(owner, parent);
  const producer = sponsorAudioOutputActorContext(owner, trusted);
  if (!producer || producer.parent !== parent || state.derivatives.has(trusted) || trusted === parent
    || trusted.request !== parent.request || trusted.env !== parent.env || trusted.principal !== parent.principal
    || trusted.scope !== parent.scope || trusted.context !== parent.context || trusted.events !== parent.events
    || trustedFacts(trusted) !== trustedFacts(parent)) return fail();
  // Producer ownership retains the additional original-custody proof objects.
  for (const proof of trusted.sourceAssertions) if (!parent.sourceAssertions.includes(proof)
    && !isSponsorAudioOutputNativeProof(owner, proof) && !isSponsorAudioOutputSourceProof(owner, proof)) return fail();
  const check = lockNativeData(trusted, new Set([state.request, trusted.env, trusted.principal]));
  state.derivatives.set(trusted, { parent, check, facts: disclosureFacts(trusted) });
  current(state);
}
export function registerSponsorAudioOutputEvidenceContext(owner: SponsorAudioOutputReadOwner, parent: OutputTrustedContext,
  trusted: OutputTrustedContext, principal: OutputTrustedContext["principal"]): void {
  const state = get(owner); requireSponsorAudioOutputContext(owner, parent);
  const producer = sponsorAudioOutputEvidenceContext(owner, trusted);
  if (!producer || producer.parent !== parent || producer.authenticated !== principal || state.derivatives.has(trusted)
    || trusted === parent || trusted.env === parent.env || trusted.env.DB !== state.env.DB || trusted.request !== state.request
    || trustedFacts(trusted) !== trustedFacts(parent) || canonicalJson(principal) !== canonicalJson(state.auth.user)) return fail();
  const check = lockNativeData(trusted, new Set([state.request, trusted.env, trusted.principal]));
  const envKeys = Reflect.ownKeys(state.env);
  if (!same(Reflect.ownKeys(trusted.env), envKeys) || envKeys.some(key => own(trusted.env, key) !== own(state.env, key))) return fail();
  Object.freeze(trusted.env); lockNativeData(principal);
  environments.set(trusted.env, state);
  state.derivatives.set(trusted, { parent, check, facts: disclosureFacts(trusted) });
  current(state);
}
export function beginSponsorAudioOutputLaterSource(owner: SponsorAudioOutputReadOwner, input: OutputBridgeTargetInput): void {
  const state = get(owner, input.request, input.env);
  if (!laterOperation(state) || !state.later || state.laterInputs.has(input)) return fail();
  const handoff = sponsorAudioOutputHandoffSource(owner, input), evidence = sponsorAudioOutputEvidenceInput(owner, input);
  const trusted = evidence?.native ?? state.later.trusted;
  requireSponsorAudioOutputContext(owner, trusted);
  if ((!handoff && !evidence) || handoff && evidence || input.scope !== trusted.scope || input.context !== trusted.context
    || input.sourceEvents !== trusted.events || input.sourceAssertions !== trusted.sourceAssertions || input.ownerHead !== trusted.ownerHead
    || input.sourceDigest !== trusted.sourceDigest || input.requirementsDigest !== trusted.requirementsDigest
    || input.request !== trusted.request || input.env !== trusted.env || input.principal !== (evidence?.authenticated ?? trusted.principal)
    || input.target.id !== state.resolvedIdentity?.targetId
    || canonicalJson(input.confirmedPlan) !== canonicalJson(actualPlanBody(state, input.confirmedPlan.revisionId))
    || canonicalJson(input.target) !== canonicalJson(input.confirmedPlan.plan.targets.find(target => target.id === state.resolvedIdentity?.targetId))) return fail();
  const quote = actualPreflightBody(state, state.later.selection.preflightId);
  if (!quote || !Array.isArray(quote.targets) || quote.targets.length !== 1 || !record(quote.targets[0]) || quote.targets[0].targetId !== input.target.id
    || handoff && (canonicalJson(handoff.quote) !== canonicalJson(quote) || handoff.phase === "admission" && state.later.kind !== "authorize")) return fail();
  if (handoff?.command && (handoff.command.action !== "authorize" || handoff.command.documentId !== trusted.scope.documentId
    || handoff.command.expectedRevision !== `output:${trusted.ownerHead}` || handoff.command.preflightId !== quote.id
    || handoff.command.termsDigest !== quote.termsDigest || handoff.command.maximumMicrousd !== quote.maximumMicrousd
    || handoff.command.explicitAuthorization !== true)) return fail();
  const check = lockNativeData(input, new Set([state.request, input.env, input.principal, input.sourceAssertions]));
  state.laterInputs.set(input, { trusted, check, facts: canonicalJson({ plan: input.confirmedPlan, target: input.target, source: input.sourceAssertions }), retained: false });
  current(state);
}
export function isSponsorAudioOutputLaterSourceInput(owner: SponsorAudioOutputReadOwner, input: OutputBridgeTargetInput): boolean {
  const state = get(owner), owned = state.laterInputs.get(input);
  if (!owned) return false;
  owned.check(); requireSponsorAudioOutputContext(owner, owned.trusted);
  if (owned.facts !== canonicalJson({ plan: input.confirmedPlan, target: input.target, source: input.sourceAssertions })) return fail();
  return true;
}
export function retainSponsorAudioOutputLaterSource(owner: SponsorAudioOutputReadOwner, input: OutputBridgeTargetInput, result: OutputNativeTargetPreflight): void {
  const state = get(owner), owned = state.laterInputs.get(input);
  if (!owned || owned.retained || !isSponsorAudioOutputLaterSourceInput(owner, input) || result.targetId !== input.target.id) return fail();
  const proof = result.available ? outputAudioPreflightAssertions(result) : null;
  const quote = state.later && actualPreflightBody(state, state.later.selection.preflightId);
  if (!result.available || !proof?.length || !quote || !Array.isArray(quote.targets) || canonicalJson(result) !== canonicalJson(quote.targets[0])) return fail();
  owned.retained = true; keepProofs(state, proof); current(state);
}
async function runLater<T>(owner: SponsorAudioOutputReadOwner, trusted: OutputTrustedContext, selection: SponsorAudioServerConfiguration,
  kind: "review" | "authorize", work: () => Promise<T>): Promise<T> {
  const state = get(owner); requireSponsorAudioOutputContext(owner, trusted);
  if (state.later || state.stage || state.frame || state.currentContext !== trusted
    || state.data.operation !== `audio-output-${kind}` || !isSponsorAudioOutputSelection(owner, trusted, selection)
    || selection.campaignId !== state.data.original.campaignId) return fail();
  lockNativeData(selection);
  state.later = { trusted, kind, selection, serialized: canonicalJson(selection), reloading: false };
  try { const value = await state.data.wait(work); current(state); return value; }
  catch (error) { closeSponsorAudioOutputReads(owner); throw error; }
}
export function runSponsorAudioOutputReview(owner: SponsorAudioOutputReadOwner, trusted: OutputTrustedContext, selection: SponsorAudioServerConfiguration) {
  return runLater(owner, trusted, selection, "review", () => readSponsorAudioCurrentReview(trusted, selection));
}
export function runSponsorAudioOutputAuthorize(owner: SponsorAudioOutputReadOwner, trusted: OutputTrustedContext, selection: SponsorAudioAuthorizeSelection) {
  return runLater(owner, trusted, selection, "authorize", () => authorizeSponsoredAudio(trusted, selection));
}
/** The actual native authorizer enters this only after proving its original
 * command receipt. Current head can advance; original custody never changes. */
export function beginSponsorAudioOutputAuthorizationReload(owner: SponsorAudioOutputReadOwner, prior: OutputTrustedContext): void {
  const state = get(owner); requireSponsorAudioOutputContext(owner, prior);
  const producer = sponsorAudioOutputAuthorizationReload(owner, prior);
  if (!producer || usedAuthorizationReloads.has(producer) || state.later?.kind !== "authorize" || state.later.trusted !== prior
    || state.currentContext !== prior || state.later.reloading || state.driver || audioIssuerBatchFrames.has(owner) || state.parserActive
    || producer.receipt.action !== "authorize" || producer.receipt.privateUnavailable || producer.receipt.key !== producer.command.clientMutationId
    || producer.command.documentId !== prior.scope.documentId || producer.command.preflightId !== state.later.selection.preflightId
    || producer.stage.command_json !== canonicalJson(producer.command) || !uuid(producer.receipt.eventId) || !digest(producer.receipt.requestDigest)) return fail();
  const expected = state.authorizationCommand ?? (() => {
    const stage = sponsorAudioOutputLaterNativeFacts(owner).stage;
    return stage ? parsed(stage.command_json) : null;
  })();
  if (!expected || canonicalJson(expected) !== canonicalJson(producer.command)) return fail();
  usedAuthorizationReloads.add(producer); state.later.reloading = true;
  state.authorizationReload = { command: producer.command, receipt: producer.receipt };
  // Keep the exact original authorization body and index permanently. No old
  // head equality ever enters that immutable proof collection.
  keepProofs(state, [outputCommandReceiptAssertion(prior.scope, producer.receipt)]);
  state.currentContext = undefined;
}
/** Only the genuine native authorizer can mint this pre-proof frame. The
 * predicate list is never adopted from a controller or transport response. */
export function beginSponsorAudioOutputAuthorizationDisclosure(owner: SponsorAudioOutputReadOwner, token: object): void {
  const state = get(owner), producer = sponsorAudioOutputAuthorizationDisclosure(owner, token), reload = state.authorizationReload;
  if (!producer || !reload || state.finalAuthorization || state.later?.kind !== "authorize" || !state.later.reloading
    || producer.fresh !== state.currentContext || producer.fresh === state.later.trusted) return fail();
  requireSponsorAudioOutputContext(owner, producer.fresh);
  const response = producer.response, receipt = reload.receipt;
  if (response.receipt.key !== receipt.key || response.receipt.eventId !== receipt.eventId || response.receipt.requestDigest !== receipt.requestDigest
    || response.grantId !== receipt.payload.grant_id || response.binding.draftId !== state.data.draftId
    || response.binding.actorUserId !== state.auth.user.userId || response.binding.documentId !== producer.fresh.scope.documentId
    || response.binding.projectId !== producer.fresh.scope.projectId || response.binding.sourceDigest !== producer.fresh.sourceDigest
    || response.binding.requirementsDigest !== producer.fresh.requirementsDigest || !producer.assertions.length) return fail();
  producer.assertCurrent(); lockNativeData(response); lockNativeData(producer.assertions);
  state.finalAuthorization = { token, trusted: producer.fresh, response, responseJson: canonicalJson(response),
    assertions: producer.assertions.map(capturedProof), assertCurrent: producer.assertCurrent };
  current(state);
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
  const nativeCatalog = capturedProof(sponsorAudioNativeSchemaProof());
  keepProofs(state, [nativeCatalog]);
  const retainedCatalog = state.proofs.find(proof => proof.sql === nativeCatalog.sql && proof.deadlineMs === undefined
    && same(proof.bindings ?? [], nativeCatalog.bindings ?? []));
  if (!retainedCatalog) return fail();
  nativeCatalogProofs.set(state, retainedCatalog);
  if (laterOperation(state)) {
    const privateCatalog = sponsorAudioOutputPrivateCatalogProof(owner);
    const retainedPrivate = privateCatalog && state.proofs.find(proof => proof.sql === privateCatalog.sql && proof.deadlineMs === undefined
      && same(proof.bindings ?? [], privateCatalog.bindings ?? []));
    if (!retainedPrivate) return fail();
    privateCatalogProofs.set(state, retainedPrivate);
  }
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
  const phase = await laterPhaseAssertions(state); current(state);
  return { ...value, knownAssertions: [...state.proofs, ...(state.stage?.proofs ?? []), ...phase],
    ...(state.stage ? { expectedHead: state.stage.trusted.ownerHead } : state.currentContext ? { expectedHead: state.currentContext.ownerHead } : {}) };
}

async function laterPhaseAssertions(state: State): Promise<readonly Proof[]> {
  if (!laterOperation(state)) return [];
  const trusted = state.currentContext;
  const proofs: Proof[] = [...(trusted ? sponsorCurrentSourceAssertions(trusted) : []), ...(state.driver?.assertions ?? [])];
  if (state.finalAuthorization) { state.finalAuthorization.assertCurrent(); proofs.push(...state.finalAuthorization.assertions); }
  proofs.push(...await sponsorAudioIssuerPhaseProofs(state));
  const admission = admissions.get(state.owner);
  if (admission && !admission.completed) {
    const payer = sponsorAdmissionPayer(admission.issued.admissionAuthority, audioAuthorityIdentity(admission.trusted));
    proofs.push(...payer.assertions, ...sponsorAudioOutputAdmissionNative(state.owner, admission.preparation)?.assertions ?? [],
      ...admission.prepared?.sourceAssertions ?? []);
  }
  return proofs;
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
function actualPreflightBody(state: State, id: string): Row | null {
  for (const eventId of state.preflightEvents) {
    const body = parsed(state.observedBodies.get(eventId)?.raw), value = body?.preflight;
    if (record(value) && value.id === id) return value;
  }
  return null;
}
function actualPlanBody(state: State, revision?: string): Row | null {
  for (const eventId of state.planEvents) {
    const value = parsed(state.observedBodies.get(eventId)?.raw), plan = value?.confirmed_plan;
    if (record(plan) && (revision === undefined || plan.revisionId === revision)) return plan;
  }
  return null;
}
function describeRead(state: State, sql: string, b: readonly Value[], i: Identity): Descriptor {
  const later = laterOperation(state) ? describeSponsorAudioOutputLaterRead(state.owner, sql, b) : null;
  if (later) return later;
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
  if (descriptor.invalidRow) return descriptor.invalidRow;
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
  if (state.recovery && !["proof", "later-proof", ...(state.recovery === "driver" ? ["later-intent", "later-stage"]
    : state.recovery === "issuer" ? ["later-issuance", "later-principal", "later-payer-principal"] : ["later-command"])].includes(descriptor.kind)) return fail("sponsor_audio_output_recovery_read_changed");
  const recovery = state.stage?.lostAckRead ? state.stage : null;
  if (recovery) {
    if (recovery.lostAckInFlight) return fail();
    if (descriptor.kind !== "command" || captured.bindings[5] !== i.keys[recovery.phase]) return fail();
    recovery.lostAckInFlight = true;
  }
  const result = await readRows(state, { ...captured, ...descriptor, invalidRow: invalidNativeRow(descriptor, i) }); current(state);
  if (descriptor.kind.startsWith("later-")) await observeSponsorAudioOutputLaterRead(state.owner, captured.sql, captured.bindings, result.result.results, result.witness);
  else observe(state, descriptor, result.result.results, captured, i);
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
const DRIVER_KEYS = ["driver_id", "campaign_id", "actor_user_id", "session_digest", "intent_key", "document_id", "command_json", "command_digest", "source_digest", "requirements_digest", "source_text_bytes"] as const;
function driverProof(intent: Readonly<Row>): Proof {
  return { sql: `EXISTS(SELECT 1 FROM experience_sponsor_driver_intents WHERE ${DRIVER_KEYS.map(key => `${key}=?`).join(" AND ")})`,
    bindings: DRIVER_KEYS.map(key => { const value = intent[key]; return scalar(value) ? value : fail(); }) };
}
function driverStageProof(driverId: Value, stage: { command_json: string; command_digest: string }): Proof {
  return { sql: "EXISTS(SELECT 1 FROM experience_sponsor_driver_stages WHERE driver_id=? AND stage='authorize' AND command_json=? AND command_digest=?)",
    bindings: [driverId, stage.command_json, stage.command_digest] };
}
export async function runSponsorAudioOutputDriver<T>(owner: SponsorAudioOutputReadOwner, token: object, work: () => Promise<T>): Promise<T> {
  const state = get(owner), producer = sponsorAudioOutputDriverFrame(owner, token);
  if (!producer || state.later?.kind !== "authorize" || state.driver || state.stage || state.frame || state.parserActive) return fail();
  requireSponsorAudioOutputContext(owner, producer.trusted);
  if (producer.trusted !== state.later.trusted || producer.intent.campaign_id !== state.later.selection.campaignId
    || producer.intent.actor_user_id !== state.auth.user.userId || producer.intent.document_id !== producer.trusted.scope.documentId
    || producer.intent.source_digest !== producer.trusted.sourceDigest || producer.intent.requirements_digest !== producer.trusted.requirementsDigest) return fail();
  lockNativeData(producer.intent); lockNativeData(producer.stage); lockNativeData(producer.assertions);
  const frame: DriverFrame = { token, trusted: producer.trusted, intent: producer.intent, stage: producer.stage, assertions: producer.assertions, dispatched: false };
  const command = parsed(frame.stage.command_json); if (!command) return fail();
  state.authorizationCommand = command; lockNativeData(command);
  state.driver = frame;
  try { const result = await state.data.wait(work); current(state); if (!frame.dispatched) return fail(); return result; }
  finally { state.driver = undefined; }
}
export function completeSponsorAudioOutputDriverRecovery(owner: SponsorAudioOutputReadOwner, token: object): void {
  const state = get(owner), frame = state.driverRecovery, producer = sponsorAudioOutputDriverFrame(owner, token);
  if (state.recovery !== "driver" || !frame || frame.token !== token || !frame.dispatched || !producer
    || !isSponsorAudioOutputDriverRecovered(owner, token) || producer.intent !== frame.intent || producer.stage !== frame.stage
    || producer.assertions !== frame.assertions || state.later?.trusted !== frame.trusted) return fail();
  const observed = sponsorAudioOutputLaterNativeFacts(owner);
  if (canonicalJson(observed.intent) !== canonicalJson(frame.intent) || canonicalJson(observed.stage) !== canonicalJson(frame.stage)) return fail();
  const expected = [...frame.assertions, driverProof(frame.intent), driverStageProof(String(frame.intent.driver_id), frame.stage)];
  const batch = state.recoveryProofBatch;
  if (!batch || batch.length !== expected.length || batch.some((item, at) => item.sql !== `SELECT CASE WHEN (${expected[at]!.sql}) THEN 1 ELSE 0 END AS current`
    || !same(item.bindings, expected[at]!.bindings ?? []))) return fail();
  state.recovery = undefined; state.driverRecovery = undefined; state.recoveryProofBatch = undefined;
  current(state);
}
function validateDriverBatch(state: State, items: readonly Captured[]): void {
  const frame = state.driver ?? fail(), producer = sponsorAudioOutputDriverFrame(state.owner, frame.token), tokens = new Set<string>();
  if (!producer || frame.dispatched || producer.trusted !== frame.trusted || producer.intent !== frame.intent || producer.stage !== frame.stage
    || producer.assertions !== frame.assertions) return fail();
  let at = 0;
  for (const proof of frame.assertions) at = assertionPair(items, at, proof, tokens);
  const first = items[at++], second = items[at++];
  if (!first || first.sql !== `INSERT INTO experience_sponsor_driver_intents(${DRIVER_KEYS.join(",")},created_at_ms) VALUES(${DRIVER_KEYS.map(() => "?").join(",")},CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))`
    || !same(first.bindings, DRIVER_KEYS.map(key => frame.intent[key])) || !second
    || second.sql !== "INSERT INTO experience_sponsor_driver_stages(driver_id,stage,command_json,command_digest) VALUES(?,'authorize',?,?)"
    || !same(second.bindings, [frame.intent.driver_id, frame.stage.command_json, frame.stage.command_digest])) return fail("sponsor_audio_output_native_batch_changed");
  for (const proof of [...frame.assertions, driverProof(frame.intent), driverStageProof(String(frame.intent.driver_id), frame.stage)]) at = assertionPair(items, at, proof, tokens);
  if (at !== items.length) return fail("sponsor_audio_output_native_batch_changed");
}
type AudioIssuerBatchFrame = {
  trusted: OutputTrustedContext;
  command: Readonly<Row>;
  preparation: AudioSponsorAdmissionPreparation;
  selection: Readonly<SponsorAudioServerConfiguration>;
  dispatched: boolean;
};
const audioIssuerBatchFrames = new WeakMap<SponsorAudioOutputReadOwner, AudioIssuerBatchFrame>();

const AUDIO_ISSUER_NOW = "CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";
const AUDIO_ISSUER_GRANT_INSERT = "INSERT INTO experience_sponsor_grants(grant_id,campaign_id,policy_digest,actor_user_id,session_digest,intent_key,envelope_digest,issued_at_ms,expires_at_ms,enabled) VALUES(?,?,?,?,?,?,?,?,?,1)";
const AUDIO_ISSUER_ROW_INSERT = "INSERT INTO experience_sponsor_issuances(grant_id,campaign_id,actor_user_id,intent_key,policy_digest,driver_command_json,command_digest,envelope_digest,envelope_json) VALUES(?,?,?,?,?,?,?,?,?)";
const AUDIO_ISSUER_COMMAND_KEYS = ["documentId", "action", "expectedRevision", "clientMutationId", "preflightId", "termsDigest", "maximumMicrousd", "explicitAuthorization", "audioCostConsent"];

async function deriveSponsorAudioIssuerPhase(state: State) {
  const frame = audioIssuerBatchFrames.get(state.owner);
  if (!frame) return null;
  if (state.data.operation !== "audio-output-authorize"
    || !state.later || state.later.kind !== "authorize" || state.later.trusted !== frame.trusted
    || state.later.selection !== frame.selection) return fail("sponsor_audio_output_issuer_phase_changed");
  const { trusted, preparation, selection } = frame;
  const view = requireSponsorAudioOutputReads(state.owner, trusted.request, trusted.env);
  const native = sponsorAudioOutputAdmissionNative(state.owner, preparation);
  const observed = sponsorAudioOutputLaterNativeFacts(state.owner);
  // The genuine issuer first invokes the native handoff proof, then loads its
  // campaign. Those existing closed descriptors handle these early reads.
  // Missing evidence grants NO new predicate, rather than fabricating a basis.
  if (!native || !observed.policy || !observed.policyDigest || !observed.policyJson
    || !observed.principal || !observed.approvedAssertions) return null;
  if (observed.approvedAssertions.length !== 4
    || observed.principal.user_id !== trusted.scope.actorUserId) return fail("sponsor_audio_output_issuer_evidence_missing");
  const { policy, policyDigest, policyJson, ids } = observed;
  const approvedAssertions = observed.approvedAssertions;
  const originalCommand = frame.command;
  const raw = captureSponsorAudioJson(originalCommand);
  if (!audioIssuerRecord(raw) || !exactKeys(raw, AUDIO_ISSUER_COMMAND_KEYS) || raw.action !== "authorize"
    || raw.explicitAuthorization !== true || !Number.isSafeInteger(raw.maximumMicrousd)
    || Number(raw.maximumMicrousd) < 1 || raw.clientMutationId !== ids.commandKey
    || raw.documentId !== trusted.scope.documentId || raw.preflightId !== selection.preflightId)
    return fail("sponsor_audio_output_issuer_command_changed");
  const command = raw, commandJson = canonicalJson(command);
  const selectionJson = canonicalJson(selection);
  const observedJson = canonicalJson({ policy, policyDigest, policyJson, ids,
    principal: observed.principal, approvedAssertions, dbClock: observed.dbClock ?? null, issuance: observed.issuance ?? null });
  const nativeJson = canonicalJson({ nativePreflight: native.nativePreflight, actorIntent: native.actorIntent,
    description: native.description, recipe: native.recipe, assertions: native.assertions, deadlineMs: native.deadlineMs });
  const { actorIntent, description } = native, review = actorIntent.review;
  const deadline = Math.min(native.deadlineMs, policy.expiresAtMs, policy.resources.expiresAtMs,
    description.preflightExpiresAtMs, Date.parse(review.expiresAt), Date.parse(review.preview.expiresAt));
  const check = () => {
    current(state); view.current();
    if (audioIssuerBatchFrames.get(state.owner) !== frame
      || frame.trusted !== trusted || frame.command !== originalCommand || frame.preparation !== preparation || frame.selection !== selection
      || state.later?.trusted !== trusted || state.later.selection !== selection
      || sponsorAudioOutputAdmissionNative(state.owner, preparation) !== native
      || canonicalJson(captureSponsorAudioJson(frame.command)) !== commandJson
      || canonicalJson(selection) !== selectionJson) return fail("sponsor_audio_output_issuer_phase_changed");
    native.assertCurrent();
    const fresh = sponsorAudioOutputLaterNativeFacts(state.owner);
    if (!fresh.policy || !fresh.policyDigest || !fresh.policyJson || !fresh.principal || !fresh.approvedAssertions
      || canonicalJson({ policy: fresh.policy, policyDigest: fresh.policyDigest, policyJson: fresh.policyJson,
        ids: fresh.ids, principal: fresh.principal, approvedAssertions: fresh.approvedAssertions,
        dbClock: fresh.dbClock ?? null, issuance: fresh.issuance ?? null }) !== observedJson
      || canonicalJson({ nativePreflight: native.nativePreflight, actorIntent: native.actorIntent,
        description: native.description, recipe: native.recipe, assertions: native.assertions, deadlineMs: native.deadlineMs }) !== nativeJson
      || !Number.isFinite(deadline) || !Number.isFinite(Date.now()) || Date.now() >= deadline)
      return fail("sponsor_audio_output_issuer_evidence_changed");
  };
  const pure = async <T>(work: () => Promise<T>): Promise<T> => {
    check(); const result = await view.wait(work); check(); return result;
  };
  check();
  // The campaign proof uses the exact observed policyJson bytes; its first
  // assertion uses the raw 13-column principal snapshot, not a normalized DTO.
  // Both are supplied by the closed native facts accessor, not reconstructed
  // from the candidate batch. No actual native assertion is dropped/replaced.
  if (policy.version !== 8 || policy.campaignId !== selection.campaignId
    || await pure(() => audioIssuerDigest(policy)) !== policyDigest
    || description.actorUserId !== trusted.scope.actorUserId
    || command.documentId !== description.documentId || actorIntent.commandDigest !== await pure(() => audioIssuerDigest(command))
    || selection.templateDigest !== await pure(() => audioIssuerDigest(policy.templates[0]))
    || selection.templateDigest !== review.templateDigest || review.campaignId !== policy.campaignId
    || review.policyDigest !== policyDigest || review.payerUserId !== policy.payerUserId
    || review.approvalReceiptDigest !== policy.approvalReceiptDigest
    || canonicalJson(native.recipe) !== canonicalJson(description.recipe))
    return fail("sponsor_audio_output_issuer_intent_changed");
  const sessionDigest = await pure(() => sponsorPrincipalDigest(trusted.principal));
  if (description.sessionDigest !== sessionDigest
    || !await pure(() => matchSponsorAudioTemplate(policy.templates[0], {
      recipe: description.recipe, offered: native.nativePreflight, consent: actorIntent.request.audioCostConsent,
    }))) return fail("sponsor_audio_output_issuer_intent_changed");
  const actorUserId = description.actorUserId, intentKey = String(command.clientMutationId);
  const commandDigest = await pure(() => audioIssuerDigest(command));
  const driverCommandJson = canonicalJson(actorIntent.request);
  const stable = (await pure(() => audioIssuerDigest({ campaignId: policy.campaignId, actorUserId, intentKey }))).slice(7);
  const grantId = `sponsor-audio-issued-${stable}`, resourceId = `sponsor-audio-resource-issue-${stable}`;
  if (grantId !== ids.grantId || resourceId !== ids.resourceId)
    return fail("sponsor_audio_output_issuer_identity_changed");
  const textBytes = new TextEncoder().encode(canonicalJson(trusted.context?.snapshot ?? {})).byteLength;
  const limitsDigest = await pure(() => audioIssuerDigest(policy.resources));
  const resourceAuthority: Proof = {
    sql: `EXISTS(SELECT 1 FROM experience_sponsor_resource_policies resources
    WHERE resources.campaign_id=? AND resources.enabled=1 AND resources.limits_digest=? AND resources.limits_json=?
      AND ?<=${AUDIO_ISSUER_NOW} AND ?>${AUDIO_ISSUER_NOW})`,
    bindings: [policy.campaignId, limitsDigest, canonicalJson(policy.resources), policy.resources.startsAtMs, policy.resources.expiresAtMs],
    deadlineMs: policy.resources.expiresAtMs,
  };
  const originalDeadline: Proof = { sql: `${AUDIO_ISSUER_NOW}<?`, bindings: [deadline], deadlineMs: deadline };
  const baseAssertions: Proof[] = [...approvedAssertions, resourceAuthority, ...native.assertions, originalDeadline];
  const { preflightExpiresAtMs, ...descriptionFields } = description;
  const finishFor = async (compiled: Awaited<ReturnType<typeof compileSponsorAudioEnvelope>>) => {
    const envelope = compiled.envelope;
    if (compiled.policyDigest !== policyDigest || envelope.templateDigest !== selection.templateDigest
      || envelope.audioActorRequestDigest !== actorIntent.requestDigest || envelope.audioSponsorReviewDigest !== actorIntent.reviewDigest
      || envelope.originalRequestId !== review.preview.requestId || envelope.originalExpiresAtMs !== Date.parse(review.preview.expiresAt)
      || envelope.expiresAtMs > deadline || envelope.expiresAtMs <= Date.now()
      || envelope.consumptionId !== `sponsor-audio-consume-${stable}` || envelope.intentKey !== intentKey
      || Object.entries(description).some(([key, value]) => key !== "preflightExpiresAtMs"
        && canonicalJson(envelope[key as keyof SponsorEnvelopeV8]) !== canonicalJson(value)))
      return fail("sponsor_audio_output_issuer_original_changed");
    const originalGrant: Proof = { sql: `EXISTS(SELECT 1 FROM experience_sponsor_grants WHERE grant_id=? AND campaign_id=? AND policy_digest=?
      AND actor_user_id=? AND session_digest=? AND intent_key=? AND envelope_digest=? AND issued_at_ms=? AND expires_at_ms=? AND enabled=1
      AND issued_at_ms<=${AUDIO_ISSUER_NOW} AND expires_at_ms>${AUDIO_ISSUER_NOW})`,
      bindings: [grantId, policy.campaignId, policyDigest, actorUserId, sessionDigest,
        intentKey, compiled.envelopeDigest, envelope.issuedAtMs, envelope.expiresAtMs], deadlineMs: envelope.expiresAtMs };
    const resource = await pure(() => prepareSponsorResourcePlan({
      limits: policy.resources, campaignId: policy.campaignId, policyDigest, actorUserId, sessionDigest,
      intentKey, operation: "issuance", payloadDigest: compiled.envelopeDigest,
      textBytes, resourceId, issuedGrantId: grantId,
    }));
    const receiptAssertion: Proof = { sql: resource.receiptAssertion.sql, bindings: [...resource.receiptAssertion.bindings] };
    const issued = await pure(() => sponsorIssuedAuthorityAssertion({
      policy, policyDigest, grantId, actorUserId, sessionDigest, intentKey, envelopeDigest: compiled.envelopeDigest,
    }));
    // createSponsorAdmissionAuthority's internal require runs before the opaque
    // authority is returned. Derive its exact native predicate from the real
    // compiled envelope; the child descriptor handles BOTH actual raw principal
    // snapshot predicates independently. No fabricated authority is needed.
    const e = envelope, p = policy;
    const nativeAuthority: Proof = { sql: `EXISTS(SELECT 1 FROM experience_sponsor_campaigns campaign JOIN experience_sponsor_grants grant_row ON grant_row.campaign_id=campaign.campaign_id
    JOIN users actor ON actor.user_id=grant_row.actor_user_id JOIN users payer ON payer.user_id=?
    WHERE campaign.campaign_id=? AND campaign.enabled=1 AND campaign.policy_digest=? AND campaign.policy_json=?
      AND grant_row.grant_id=? AND grant_row.enabled=1 AND grant_row.policy_digest=campaign.policy_digest
      AND grant_row.actor_user_id=? AND grant_row.session_digest=? AND grant_row.intent_key=? AND grant_row.envelope_digest=?
      AND grant_row.issued_at_ms=? AND grant_row.expires_at_ms=?
      AND grant_row.issued_at_ms<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)
      AND grant_row.expires_at_ms>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)
      AND actor.consent_version=? AND payer.consent_version=? AND actor.role IN('creator','admin') AND payer.role IN('creator','admin')
      AND NOT EXISTS(SELECT 1 FROM pilot_participants participant JOIN pilot_cohorts cohort ON cohort.cohort_id=participant.cohort_id
        WHERE participant.user_id IN(actor.user_id,payer.user_id) AND participant.status='active' AND participant.revoked_at IS NULL AND cohort.status IN('active','paused','closed')))
    AND NOT EXISTS(SELECT 1 FROM organization_projects project
      JOIN project_migration_states migration ON migration.project_access_id=project.project_access_id AND migration.organization_id=project.organization_id AND migration.owner_user_id=project.owner_user_id AND migration.status='active'
      JOIN organizations organization ON organization.organization_id=project.organization_id AND organization.status='active'
      JOIN organization_memberships member ON member.organization_id=project.organization_id AND member.user_id=? AND member.status='active' AND member.accepted_at IS NOT NULL AND member.revoked_at IS NULL
      JOIN budget_scope_policies policy ON policy.scope='workspace' AND policy.scope_id=project.organization_id AND policy.organization_id=project.organization_id
      WHERE project.owner_user_id=? AND project.status='active' AND project.project_id=?)`,
      bindings: [p.payerUserId, p.campaignId, compiled.policyDigest, compiled.policyJson, grantId, e.actorUserId, e.sessionDigest, e.intentKey,
        compiled.envelopeDigest, e.issuedAtMs, e.expiresAtMs, POLICY_VERSION, POLICY_VERSION, e.actorUserId, e.actorUserId, e.projectId] };
    check();
    return { compiled, resource, receiptAssertion, issued, originalGrant,
      finishAssertions: [...baseAssertions, originalGrant, receiptAssertion, issued],
      admissionAssertions: [sponsorApprovalAssertion(policy, actorUserId), issued, nativeAuthority, ...native.assertions] };
  };
  let original: Awaited<ReturnType<typeof finishFor>> | null = null;
  if (observed.issuance) {
    const row = observed.issuance;
    const keys = ["grant_id", "campaign_id", "actor_user_id", "intent_key", "policy_digest", "driver_command_json", "command_digest", "envelope_digest", "envelope_json"];
    if (!exactKeys(row, keys) || keys.some(key => typeof row[key] !== "string")
      || row.grant_id !== grantId || row.campaign_id !== policy.campaignId || row.actor_user_id !== actorUserId
      || row.intent_key !== intentKey || row.policy_digest !== policyDigest || row.command_digest !== commandDigest
      || row.driver_command_json !== driverCommandJson || String(row.envelope_json).length > 131072
      || String(row.driver_command_json).length > 131072) return fail("sponsor_audio_output_issuer_original_changed");
    let parsed: unknown;
    try { parsed = JSON.parse(String(row.envelope_json)); } catch { return fail("sponsor_audio_output_issuer_original_changed"); }
    const compiled = await pure(() => compileSponsorAudioEnvelope(policy, parsed));
    if (compiled.envelopeDigest !== row.envelope_digest || compiled.envelopeJson !== row.envelope_json)
      return fail("sponsor_audio_output_issuer_original_changed");
    original = await finishFor(compiled);
  }
  let fresh: (Awaited<ReturnType<typeof finishFor>> & { closing: Proof[] }) | null = null;
  // No fresh envelope or clock is necessary for original-only recovery/replay.
  // A concurrent identical issuer can win after this attempt reads its own
  // clock. Recover its actual immutable original, whose issuance time/envelope
  // may differ from this losing candidate; the native finish constraints above
  // establish all required original identity, policy, source and expiry bounds.
  if (!original && observed.dbClock !== undefined) {
    if (!Number.isSafeInteger(observed.dbClock) || observed.dbClock < 0)
      return fail("sponsor_audio_output_issuer_clock_changed");
    const issuedAtMs = observed.dbClock;
    const envelope: SponsorEnvelopeV8 = {
      version: 8, family: "canonical-instrumental-cue@1", campaignId: policy.campaignId,
      policyVersion: policy.policyVersion, payerUserId: policy.payerUserId,
      consumptionId: `sponsor-audio-consume-${stable}`, intentKey, ...descriptionFields,
      templateDigest: selection.templateDigest, audioActorRequestDigest: actorIntent.requestDigest,
      audioSponsorReviewDigest: actorIntent.reviewDigest, originalRequestId: review.preview.requestId,
      originalExpiresAtMs: Date.parse(review.preview.expiresAt), issuedAtMs,
      expiresAtMs: Math.min(deadline, preflightExpiresAtMs, issuedAtMs + policy.maximumGrantLifetimeMs),
    };
    const compiled = await pure(() => compileSponsorAudioEnvelope(policy, envelope));
    const finish = await finishFor(compiled);
    const envelopeDeadline: Proof = { sql: `?<=${AUDIO_ISSUER_NOW} AND ?>${AUDIO_ISSUER_NOW}`,
      bindings: [issuedAtMs, envelope.expiresAtMs], deadlineMs: envelope.expiresAtMs };
    fresh = { ...finish, closing: [...baseAssertions, envelopeDeadline] };
  }
  check();
  return { frame, native, grantId, resourceId, policy, policyDigest, actorUserId, sessionDigest, intentKey,
    driverCommandJson, commandDigest, baseAssertions, fresh, original, check };
}

// Called from owner identity/descriptor preparation, never installed in the
// permanent proof pool. Missing initial handoff evidence returns [] and thereby
// leaves unknown SQL denied. Current source-head proof expires with this phase.
async function sponsorAudioIssuerPhaseProofs(state: State): Promise<readonly Proof[]> {
  const value = await deriveSponsorAudioIssuerPhase(state);
  if (!value) return [];
  return [...value.baseAssertions,
    ...(value.fresh ? [...value.fresh.closing, ...value.fresh.finishAssertions, ...value.fresh.admissionAssertions] : []),
    ...(value.original ? [...value.original.finishAssertions, ...value.original.admissionAssertions] : [])];
}

async function validateSponsorAudioIssuerBatch(state: State, items: readonly Captured[]) {
  const value = await deriveSponsorAudioIssuerPhase(state);
  if (!value || value.frame.dispatched || !value.fresh || value.original)
    return fail("sponsor_audio_output_issuer_phase_changed");
  const { frame, native, grantId, resourceId, policy, policyDigest, actorUserId, sessionDigest, intentKey,
    driverCommandJson, commandDigest, check } = value;
  const { compiled, resource, receiptAssertion, issued, closing } = value.fresh;
  const envelope = compiled.envelope, issuedAtMs = envelope.issuedAtMs;
  // Native issuance resource family is exactly seven statements. Both resource
  // authority and grant CHECKs precede the debit, with receipt CHECK afterward.
  if (resource.statements.length !== 7 || items.length !== 4 * native.assertions.length + 41)
    return fail("sponsor_audio_output_issuer_batch_changed");
  const used = new Set<string>();
  let at = 0;
  const exact = (sql: string, bindings: readonly Value[]) => {
    const actual = items[at++];
    if (!actual || actual.sql !== sql || !same(actual.bindings, bindings))
      return fail("sponsor_audio_output_issuer_batch_changed");
  };
  for (const proof of closing) at = assertionPair(items, at, proof, used);
  exact(AUDIO_ISSUER_GRANT_INSERT, [grantId, policy.campaignId, policyDigest, actorUserId, sessionDigest,
    intentKey, compiled.envelopeDigest, issuedAtMs, envelope.expiresAtMs]);
  for (const item of resource.statements) exact(item.sql, item.bindings);
  exact(AUDIO_ISSUER_ROW_INSERT, [grantId, policy.campaignId, actorUserId, intentKey, policyDigest,
    driverCommandJson, commandDigest, compiled.envelopeDigest, compiled.envelopeJson]);
  for (const proof of [...closing, receiptAssertion, issued]) at = assertionPair(items, at, proof, used);
  if (at !== items.length) return fail("sponsor_audio_output_issuer_batch_changed");
  check();
  if (Date.now() >= envelope.expiresAtMs) return fail("sponsor_audio_output_issuer_envelope_expired");
  // Private validation output only. Never brand this DTO as native approval or
  // add these predicates to a permanent global proof pool; source-head proofs
  // belong to this issuer phase and become obsolete after native admission.
  return { frame, grantId, resourceId, issuedAtMs, expiresAtMs: envelope.expiresAtMs,
    envelope: compiled.envelope, envelopeDigest: compiled.envelopeDigest, envelopeJson: compiled.envelopeJson,
    closing, receiptAssertion, issuedAuthorityAssertion: issued,
    original: { grant_id: grantId, campaign_id: policy.campaignId, actor_user_id: actorUserId,
      intent_key: intentKey, policy_digest: policyDigest, driver_command_json: driverCommandJson,
      command_digest: commandDigest, envelope_digest: compiled.envelopeDigest, envelope_json: compiled.envelopeJson } };
}


type OwnedAdmissionInput = Parameters<OutputExecutionBridge["prepareAdmission"]>[0];
type OwnedAdmissionPrepared = Awaited<ReturnType<OutputExecutionBridge["prepareAdmission"]>>;
type OwnedAdmissionNative = ReturnType<OwnedAdmissionPrepared["buildStatements"]>;
type AdmissionFrame = { trusted: OutputTrustedContext; command: Readonly<Row>; issued: SponsorAudioIssuedGrant; preparation: AudioSponsorAdmissionPreparation;
  startedAt: number; input?: OwnedAdmissionInput; prepared?: OwnedAdmissionPrepared; native?: OwnedAdmissionNative; events?: EventRow[];
  inputCheck?: () => void; inputFacts?: string; nativeStatements?: readonly D1PreparedStatement[]; dispatched: boolean; completed: boolean };
const admissions = new WeakMap<SponsorAudioOutputReadOwner, AdmissionFrame>();
const ownedIssued = new WeakMap<SponsorAudioIssuedGrant, { owner: SponsorAudioOutputReadOwner; trusted: OutputTrustedContext; command: Readonly<Row>; preparation: AudioSponsorAdmissionPreparation }>();
const rejectDetachedAudioWork = { waitUntil() { return fail("sponsor_audio_output_detached_work_unavailable"); } };
const audioAuthorityIdentity = (trusted: OutputTrustedContext) => ({ request: trusted.request, env: trusted.env, actorUserId: trusted.scope.actorUserId, documentId: trusted.scope.documentId });
function admissionInputFacts(input: OwnedAdmissionInput): string {
  return canonicalJson({ scope: input.scope, principal: input.principal, plan: input.confirmedPlan, context: input.context, ownerHead: input.ownerHead,
    events: input.sourceEvents, assertions: input.sourceAssertions, sourceDigest: input.sourceDigest, requirementsDigest: input.requirementsDigest,
    grantId: input.grantId, preflight: input.preflight, slots: input.slots.map(slot => Object.fromEntries(Object.entries(slot).filter(([, value]) => value !== undefined))), audioCostConsent: input.audioCostConsent });
}
function currentAdmission(state: State, frame: AdmissionFrame): void {
  current(state);
  if (admissions.get(state.owner) !== frame || state.later?.kind !== "authorize" || state.later.trusted !== frame.trusted
    || ownedIssued.get(frame.issued)?.owner !== state.owner || sponsorAudioAdmissionPreparation(frame.issued.admissionAuthority, audioAuthorityIdentity(frame.trusted)) !== frame.preparation) return fail();
  frame.inputCheck?.();
  if (frame.input && admissionInputFacts(frame.input) !== frame.inputFacts) return fail();
}
/** The actual issuer supplies the opaque authority. A caller-created issued DTO
 * cannot enter the admission wrapper even when every public field is equal. */
export async function issueSponsorAudioOutputGrant(owner: SponsorAudioOutputReadOwner, input: Parameters<typeof issueSponsorAudioGrant>[0]): Promise<SponsorAudioIssuedGrant> {
  const state = get(owner); requireSponsorAudioOutputContext(owner, input.trusted);
  const selection = state.later?.selection;
  if (state.later?.kind !== "authorize" || input.trusted !== state.later.trusted || !selection || audioIssuerBatchFrames.has(owner)
    || admissions.has(owner) || input.campaignId !== selection.campaignId || input.templateDigest !== selection.templateDigest) return fail();
  const command = state.authorizationCommand ?? (() => {
    const observed = sponsorAudioOutputLaterNativeFacts(owner).stage;
    return observed ? parsed(observed.command_json) : null;
  })();
  if (!command || canonicalJson(command) !== canonicalJson(input.command)) return fail();
  lockNativeData(input.command);
  state.authorizationCommand = input.command;
  const frame: AudioIssuerBatchFrame = { trusted: input.trusted, command: input.command, preparation: input.preparation, selection, dispatched: false };
  audioIssuerBatchFrames.set(owner, frame);
  // Reaching this genuine call follows the authorizer's exact original lookup
  // and proof. It never clears a dispatched issuer/admission write for retry.
  if (state.recovery) return fail("sponsor_audio_output_recovery_incomplete");
  try {
    const result = await state.data.wait(() => issueSponsorAudioGrant(input)); current(state);
    if (sponsorAudioAdmissionPreparation(result.admissionAuthority, audioAuthorityIdentity(input.trusted)) !== input.preparation) return fail();
    ownedIssued.set(result, { owner, trusted: input.trusted, command: input.command, preparation: input.preparation });
    if (state.recovery === "issuer") state.recovery = undefined;
    return result;
  } catch (error) { closeSponsorAudioOutputReads(owner); throw error; }
  finally { audioIssuerBatchFrames.delete(owner); }
}
/** The private bridge calls the genuine native preparer once. Its genuine
 * closure retains financial snapshots, private IDs and timestamps that cannot
 * be regenerated by a validator without changing native behavior. */
export async function runSponsorAudioOutputAdmission(owner: SponsorAudioOutputReadOwner, trusted: OutputTrustedContext, command: Row,
  issued: SponsorAudioIssuedGrant) {
  const state = get(owner); requireSponsorAudioOutputContext(owner, trusted);
  const issuance = ownedIssued.get(issued);
  if (!issuance || issuance.owner !== owner || issuance.trusted !== trusted || canonicalJson(issuance.command) !== canonicalJson(command)
    || admissions.has(owner) || state.later?.kind !== "authorize" || state.later.trusted !== trusted || state.recovery) return fail();
  const frame: AdmissionFrame = { trusted, command, issued, preparation: issuance.preparation, startedAt: Date.now(), dispatched: false, completed: false };
  admissions.set(owner, frame);
  const originalPrepareAudioAdmission = prepareNativeAudioAdmission;
  if (outputDocumentExecutionBridge.prepareAdmission !== originalPrepareAudioAdmission) return fail("sponsor_audio_output_native_bridge_changed");
  const bridge: OutputExecutionBridge = Object.freeze({ preflight: async () => fail(), dispatch: async () => fail(),
    async prepareAdmission(input: OwnedAdmissionInput): Promise<OwnedAdmissionPrepared> {
      currentAdmission(state, frame);
      if (frame.input || frame.dispatched || input.request !== state.request || input.env !== state.env || input.sponsorAdmission !== issued.admissionAuthority
        || input.principal.userId !== state.auth.user.userId || canonicalJson(input.principal) !== canonicalJson(state.auth.user)
        || canonicalJson(input.scope) !== canonicalJson(trusted.scope) || canonicalJson(input.context) !== canonicalJson(trusted.context)
        || canonicalJson(input.sourceEvents) !== canonicalJson(trusted.events) || input.ownerHead !== trusted.ownerHead
        || input.sourceDigest !== trusted.sourceDigest || input.requirementsDigest !== trusted.requirementsDigest
        || input.governanceWitness !== trusted.governanceWitness || input.sceneCostConsent !== undefined || input.model3dCostConsent !== undefined
        || input.sceneUseVersionedHistory !== undefined || input.sceneSourceVersion !== undefined
        || input.slots.length !== 1 || !uuid(input.grantId) || input.preflight.id !== command.preflightId
        || canonicalJson(input.preflight) !== canonicalJson(actualPreflightBody(state, String(command.preflightId)))
        || canonicalJson(input.confirmedPlan) !== canonicalJson(actualPlanBody(state, input.preflight.planRevisionId))
        || canonicalJson(input.audioCostConsent) !== canonicalJson(command.audioCostConsent)) return fail();
      const deadlines = trusted.context ? outputActiveSourceDeadlineAssertions(trusted.context) : [];
      if (!sameProofArray(input.sourceAssertions ?? [], trusted.sourceAssertions)
        && !sameProofArray(input.sourceAssertions ?? [], [...trusted.sourceAssertions, ...deadlines])) return fail();
      const slot = input.slots[0]!, offer = input.preflight.targets[0];
      if (!offer?.available || !uuid(slot.slotId) || !uuid(slot.costReservationId) || !uuid(slot.tokenReservationId)
        || slot.scopeKey !== trusted.scope.key || slot.grantId !== input.grantId || slot.planRevisionId !== input.confirmedPlan.revisionId
        || slot.targetId !== state.resolvedIdentity?.targetId || slot.targetContractDigest !== input.confirmedPlan.targetContractDigests[slot.targetId]
        || slot.sourceDigest !== trusted.sourceDigest || slot.provider !== offer.provider || slot.model !== offer.model
        || slot.routeDigest !== await outputDigest(offer) || slot.maximumMicrousd !== offer.maximumMicrousd || slot.maximumCalls !== offer.maximumCalls
        || slot.maximumTokens !== offer.maximumTokens || slot.status !== "authorized" || slot.attemptOrdinal !== 0 || slot.previousSlotId !== null
        || slot.jobId !== issued.envelope.originalRequestId) return fail();
      currentAdmission(state, frame);
      frame.input = input; frame.inputFacts = admissionInputFacts(input);
      frame.inputCheck = lockNativeData(input, new Set([state.request, state.env, issued.admissionAuthority]));
      if (outputDocumentExecutionBridge.prepareAdmission !== originalPrepareAudioAdmission) return fail();
      const prepared = await state.data.wait(() => originalPrepareAudioAdmission(input)); currentAdmission(state, frame);
      if (outputDocumentExecutionBridge.prepareAdmission !== originalPrepareAudioAdmission) return fail();
      if (frame.prepared || !prepared.events.length || prepared.events.length !== 1 || prepared.sceneJobAdmissions?.length) return fail();
      lockNativeData(prepared.events); if (prepared.sourceAssertions) lockNativeData(prepared.sourceAssertions);
      frame.prepared = prepared;
      const nativeBuild = prepared.buildStatements;
      return Object.freeze({ events: prepared.events, sourceAssertions: prepared.sourceAssertions, sceneJobAdmissions: prepared.sceneJobAdmissions,
        buildStatements(events: EventRow[]) {
          currentAdmission(state, frame);
          if (frame.native || frame.events || frame.dispatched || events.length !== 2 || prepared.buildStatements !== nativeBuild) return fail();
          // These exact native EventRows are also the parent command's input;
          // lock them before the real private financial/job closure observes it.
          lockNativeData(events);
          const native = nativeBuild(events); currentAdmission(state, frame);
          if (!Array.isArray(native.statements) || !native.statements.length || !native.assertions.length
            || native.statements.some(statement => !state.statements.has(statement))) return fail();
          lockNativeData(native.assertions);
          frame.native = native; frame.events = events; frame.nativeStatements = Object.freeze([...native.statements]);
          return native;
        } });
    } });
  try {
    const result = await state.data.wait(() => outputExperienceCommands.executeSponsored(trusted, command, issued.admissionAuthority, bridge, rejectDetachedAudioWork));
    currentAdmission(state, frame);
    if (result instanceof Response || !result.receipt || result.receipt.action !== "authorize" || result.receipt.key !== command.clientMutationId || result.receipt.privateUnavailable) return fail();
    frame.completed = true;
    if (state.recovery === "admission") state.recovery = undefined;
    return result;
  } catch (error) { closeSponsorAudioOutputReads(owner); throw error; }
}
async function validateSponsorAudioAdmissionBatch(state: State, items: readonly Captured[], statements: readonly D1PreparedStatement[], i: Identity) {
  const frame = admissions.get(state.owner) ?? fail(); currentAdmission(state, frame);
  const { input, prepared, native, events, nativeStatements } = frame;
  if (!input || !prepared || !native || !events || !nativeStatements || frame.dispatched || frame.completed
    || !integer(input.ownerHead) || input.ownerHead !== frame.trusted.ownerHead) return fail();
  const slot = input.slots[0]!, offer = input.preflight.targets[0]!;
  const sponsor = sponsorAdmissionPayer(frame.issued.admissionAuthority, audioAuthorityIdentity(frame.trusted));
  const sourceAssertions: Proof[] = [...input.sourceAssertions ?? [], ...retainedOutputBodyAssertions(input.scope),
    { sql: "?>strftime('%Y-%m-%dT%H:%M:%fZ','now')", bindings: [frame.issued.envelope.originalExpiresAtMs ? new Date(frame.issued.envelope.originalExpiresAtMs).toISOString() : ""], deadlineMs: frame.issued.envelope.originalExpiresAtMs }];
  const captured = new Set(sourceAssertions.map(proof => canonicalJson(proof)));
  for (const proof of prepared.sourceAssertions ?? []) if (!captured.has(canonicalJson(proof))) { captured.add(canonicalJson(proof)); sourceAssertions.push(proof); }
  const execution = items.find(item => item.sql === AUDIO_EXECUTION_GRANT_INSERT);
  const createdAt = execution?.bindings.at(-1);
  if (!iso(createdAt) || Date.parse(createdAt) < frame.startedAt || Date.parse(createdAt) > Date.now()) return fail();
  const guards: Proof[] = [outputScopeAuthority(input.scope, "request"),
    { sql: "(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?", bindings: [i.stream, input.ownerHead] }, ...sourceAssertions,
    { sql: "EXISTS(SELECT 1 FROM output_preflights preflight JOIN event_private_payloads body ON body.private_event_id=preflight.event_id AND body.redacted_at IS NULL WHERE preflight.scope_key=? AND preflight.preflight_id=? AND preflight.actor_user_id=? AND preflight.terms_digest=? AND preflight.expires_at>MAX(?,strftime('%Y-%m-%dT%H:%M:%fZ','now')))",
      bindings: [input.scope.key, input.preflight.id, input.scope.actorUserId, input.preflight.termsDigest, createdAt] }];
  const tokens = new Set<string>(); let at = 0;
  for (const guard of guards) at = assertionPair(items, at, guard, tokens);
  const facts = sponsorAudioOutputLaterNativeFacts(state.owner), nativeEvidence = sponsorAudioOutputAdmissionNative(state.owner, frame.preparation);
  if (!facts.policyDigest || !nativeEvidence) return fail();
  const compiled = await compileSponsorAudioEnvelope(frame.issued.policy, frame.issued.envelope); currentAdmission(state, frame);
  const marker = { envelope_digest: compiled.envelopeDigest, policy_digest: compiled.policyDigest, consumption_id: frame.issued.envelope.consumptionId,
    campaign_id: frame.issued.policy.campaignId, payer_user_id: frame.issued.policy.payerUserId, audio_actor_intent: nativeEvidence.actorIntent };
  const envelope = { ...frame.command, sponsor_entitlement: marker }, envelopeDigest = await outputDigest(envelope); currentAdmission(state, frame);
  const expectedPayloads = [prepared.events[0]!.payload, { grant_id: input.grantId, plan_revision_id: input.confirmedPlan.revisionId,
    preflight_id: input.preflight.id, maximum_microusd: frame.command.maximumMicrousd, maximum_calls: input.preflight.maximumCalls,
    authorized_targets: [{ target_id: slot.targetId, operation_slot_id: slot.slotId, job_id: slot.jobId, route_digest: slot.routeDigest }], source_digest: input.sourceDigest,
    output_command_envelope: envelope }];
  for (let index = 0; index < events.length; index++) {
    const event = events[index]!, write = items[at++];
    if (!write || write.sql !== EVENT_INSERT || !same(write.bindings, eventWriteBindings(event)) || !uuid(event.eventId)
      || event.streamId !== i.stream || event.sequence !== input.ownerHead + index + 1 || event.actor !== `user:${i.owner}`
      || event.clientId !== "server:output-requirements" || event.correlationId !== frame.command.clientMutationId
      || event.causationId !== null || event.compensatesEventId !== null || event.schemaVersion !== 1
      || !iso(event.occurredAt) || event.recordedAt !== event.occurredAt || Date.parse(event.occurredAt) < frame.startedAt || Date.parse(event.occurredAt) > Date.now()
      || event.type !== (index === 0 ? prepared.events[0]!.type : "OutputExecutionAuthorized")
      || canonicalJson(event.payload) !== canonicalJson({ ...expectedPayloads[index], project_id: i.projectId, document_id: i.documentId, actor_user_id: i.owner })) return fail("sponsor_audio_output_admission_event_changed");
    at = assertionPair(items, at, { sql: "EXISTS(SELECT 1 FROM events event JOIN event_private_payloads body ON body.private_event_id=event.event_id AND body.redacted_at IS NULL WHERE event.event_id=? AND body.owner_id=? AND body.document_id=?)", bindings: [event.eventId, i.owner, i.documentId] }, tokens);
  }
  const exact = (sql: string, bindings: readonly unknown[]) => { const item = items[at++]; if (!item || item.sql !== sql || !same(item.bindings, bindings)) return fail("sponsor_audio_output_admission_batch_changed"); };
  const expiry = new Date(frame.issued.envelope.originalExpiresAtMs).toISOString();
  exact(AUDIO_EXECUTION_GRANT_INSERT, [input.scope.key, input.grantId, input.confirmedPlan.revisionId, i.owner, sponsor.payerUserId, null,
    input.preflight.id, events.at(-1)!.eventId, frame.command.maximumMicrousd, input.preflight.maximumCalls, expiry < input.preflight.expiresAt ? expiry : input.preflight.expiresAt, createdAt]);
  exact(AUDIO_SLOT_INSERT, [slot.scopeKey, slot.slotId, slot.grantId, slot.planRevisionId, slot.targetId, slot.targetContractDigest, slot.sourceDigest, slot.provider,
    slot.model, slot.routeDigest, slot.jobId, slot.costReservationId, slot.tokenReservationId, slot.maximumMicrousd, slot.maximumCalls, slot.maximumTokens,
    slot.attemptOrdinal, slot.previousSlotId, createdAt, createdAt]);
  const calls = offer.settings.calls;
  if (!Array.isArray(calls) || calls.length !== offer.maximumCalls) return fail();
  for (const call of calls) { if (!record(call)) return fail(); exact("INSERT INTO output_operation_routes(scope_key,slot_id,stage_key,provider,model,maximum_calls) VALUES(?,?,?,?,?,1)", [slot.scopeKey, slot.slotId, call.stage, call.provider, call.model]); }
  const allowedSelects: number[] = [];
  for (const original of nativeStatements) {
    if (statements[at] !== original || state.statements.get(original) !== items[at]) return fail();
    const item = items[at]!;
    if (item.sql === AUDIO_COST_OBSERVATION) {
      if (item.bindings.length !== 2 || item.bindings[0] !== sponsor.payerUserId || typeof item.bindings[1] !== "string" || !/^\d{4}-\d{2}$/u.test(item.bindings[1])) return fail();
      allowedSelects.push(at);
    } else if (!/^\s*(INSERT|UPDATE|DELETE)\s/iu.test(item.sql)) return fail();
    at++;
  }
  if (allowedSelects.length !== 1) return fail();
  const sponsorPlan = await sponsorAdmissionPlan(frame.issued.admissionAuthority, frame.trusted, { scopeKey: input.scope.key,
    planRevisionId: input.confirmedPlan.revisionId, slotId: slot.slotId, executionGrantId: input.grantId, jobId: slot.jobId,
    costReservationId: slot.costReservationId, tokenReservationId: slot.tokenReservationId, commandKey: String(frame.command.clientMutationId) });
  currentAdmission(state, frame);
  for (const item of sponsorPlan.admissionStatements) exact(item.sql, item.bindings);
  const allocation = { sql: "(SELECT COALESCE(SUM(maximum_microusd),0) FROM output_operation_slots WHERE scope_key=? AND grant_id=?)<=? AND (SELECT COALESCE(SUM(maximum_calls),0) FROM output_operation_slots WHERE scope_key=? AND grant_id=?)=?",
    bindings: [input.scope.key, input.grantId, frame.command.maximumMicrousd, input.scope.key, input.grantId, input.preflight.maximumCalls] as Value[] };
  for (const proof of [...sponsor.assertions, allocation, ...native.assertions]) at = assertionPair(items, at, proof, tokens);
  const commandRow = items[at++];
  if (!commandRow || commandRow.sql !== COMMAND_INSERT || !iso(commandRow.bindings[6])
    || Date.parse(commandRow.bindings[6]) < frame.startedAt || Date.parse(commandRow.bindings[6]) > Date.now()
    || !same(commandRow.bindings.slice(0, 6), [input.scope.key, i.owner, frame.command.clientMutationId, envelopeDigest, "authorize", events.at(-1)!.eventId])) return fail();
  at = assertionPair(items, at, sponsorPlan.nativeAssertion, tokens);
  if (at !== items.length) return fail("sponsor_audio_output_admission_batch_changed");
  return { frame, allowedSelects, events };
}
const AUDIO_EXECUTION_GRANT_INSERT = "INSERT INTO output_execution_grants(scope_key,grant_id,plan_revision_id,actor_user_id,payer_user_id,context_id,preflight_id,authorization_event_id,maximum_microusd,maximum_calls,status,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,'authorized',?,?)";
const AUDIO_SLOT_INSERT = `INSERT INTO output_operation_slots(scope_key,slot_id,grant_id,plan_revision_id,target_id,target_contract_digest,source_digest,provider,model,route_digest,job_id,cost_reservation_id,token_reservation_id,maximum_microusd,maximum_calls,maximum_tokens,attempt_ordinal,previous_slot_id,status,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'authorized',?,?)`;
const AUDIO_COST_OBSERVATION = "SELECT used_microusd,reserved_microusd,hard_limit_microusd FROM cost_budget_counters WHERE scope='user' AND scope_id=? AND period=?";

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
/** Preserve every original native statement and predicate. Only the owner's
 * separately checked schema transport predicate strengthens the first existing
 * CHECK; the application still receives its exact native ACK vector. */
function guardedLaterStatements(state: State, items: readonly Captured[], selects: readonly number[]): Captured[] {
  if (!items.length || !items[0]!.sql.startsWith("INSERT INTO output_atomic_assertions(token,passed) VALUES(?,CASE WHEN (")
    || !items[0]!.sql.endsWith(") THEN 1 ELSE 0 END)")) return fail();
  const prefix = "INSERT INTO output_atomic_assertions(token,passed) VALUES(?,CASE WHEN (", suffix = ") THEN 1 ELSE 0 END)";
  const first = items[0]!, guard = first.sql.slice(prefix.length, -suffix.length);
  return items.map((item, at) => {
    if (at === 0 && state.transportProofs.length) return {
      sql: `${prefix}${balancedConjunction([guard, ...state.transportProofs.map(proof => `(${proof.sql})`)])}${suffix}`,
      bindings: [...item.bindings, ...state.transportProofs.flatMap(proof => proof.bindings ?? [])] };
    if (selects.includes(at)) {
      if (item.sql !== AUDIO_COST_OBSERVATION) return fail();
      return { sql: `WITH audio_cost_observed AS MATERIALIZED (${item.sql}),audio_cost_bounded AS MATERIALIZED (
        SELECT COUNT(*) AS count,SUM(CASE WHEN typeof(used_microusd)='integer' AND used_microusd BETWEEN 0 AND 9007199254740991
          AND typeof(reserved_microusd)='integer' AND reserved_microusd BETWEEN 0 AND 9007199254740991
          AND typeof(hard_limit_microusd)='integer' AND hard_limit_microusd BETWEEN 0 AND 9007199254740991 THEN 0 ELSE 1 END) AS invalid,
          json_group_array(json_array(used_microusd,reserved_microusd,hard_limit_microusd)) AS body FROM audio_cost_observed)
        SELECT count,CASE WHEN count=1 AND invalid=0 AND length(CAST(body AS BLOB))<=1024 THEN body ELSE NULL END AS body FROM audio_cost_bounded`, bindings: item.bindings };
    }
    return item;
  });
}
async function dispatchLaterMutation(state: State, items: readonly Captured[], kind: "driver" | "issuer" | "admission", selects: readonly number[] = []) {
  current(state);
  const nativeItems = guardedLaterStatements(state, items, selects), remaining = state.data.remaining();
  // The exact driver/issuer vectors return empty results; admission additionally
  // returns one bounded cost row. Include the full array's brackets/commas and
  // the minimum complete native shape. Metadata remains in the measured ACK.
  const minimumBytes = nativeItems.length * 30 + selects.length * 30 + 1;
  const maximumBytes = Math.min(remaining.bytes, nativeItems.length * ACK_BYTES);
  if (state.recovery || remaining.queries < nativeItems.length || remaining.rows < nativeItems.length + selects.length
    || maximumBytes < minimumBytes) return fail("sponsor_audio_output_read_limit_reached");
  const prepared = nativeItems.map(item => { const packed = packSponsorIntakeReadQuery(item.sql, item.bindings); return state.db.prepare(packed.sql).bind(...packed.bindings); });
  state.data.account({ bytes: 0, queries: nativeItems.length, rows: nativeItems.length });
  if (kind === "driver") state.driver!.dispatched = true;
  else if (kind === "issuer") audioIssuerBatchFrames.get(state.owner)!.dispatched = true;
  else admissions.get(state.owner)!.dispatched = true;
  let raw: D1Result<Row>[];
  try { raw = await state.data.wait(() => state.db.batch<Row>(prepared)); current(state); }
  catch (error) {
    // No returned envelope: native original-only lookup remains possible under
    // the same live allowance. Receiving malformed bytes is a different case.
    current(state); state.recovery = kind;
    if (kind === "driver") state.driverRecovery = state.driver;
    throw { nativeAudioLaterLookup: true, cause: error };
  }
  try {
    const result = captureLaterResults(raw, Math.min(state.data.remaining().bytes, maximumBytes));
    // Account every bounded returned byte before interpreting success/shape.
    // An unmeasurable or over-budget ACK retires the owner in the catch below.
    state.data.account({ bytes: result.bytes, queries: 0, rows: selects.length }); current(state);
    if (!Array.isArray(result.value) || result.value.length !== nativeItems.length) return fail("sponsor_audio_output_native_ack_invalid");
    const restored: D1Result<Row>[] = [];
    for (let at = 0; at < result.value.length; at++) {
      const ack = result.value[at]; acknowledgement(ack);
      if (captureResult(ack, ACK_BYTES).bytes > ACK_BYTES) return fail();
      if (selects.includes(at)) {
        const row = ack.results[0];
        if (ack.results.length !== 1 || !row || !same(Object.keys(row), ["count", "body"]) || row.count !== 1 || typeof row.body !== "string") return fail();
        const decoded: unknown = JSON.parse(row.body);
        if (!Array.isArray(decoded) || decoded.length !== 1 || !Array.isArray(decoded[0]) || decoded[0].length !== 3 || !decoded[0].every(value => integer(value))) return fail();
        restored.push({ ...ack, results: [Object.fromEntries(["used_microusd", "reserved_microusd", "hard_limit_microusd"].map((key, index) => [key, decoded[0][index]]))] });
      } else { if (ack.results.length) return fail(); restored.push(ack); }
    }
    return restored;
  } catch (error) { closeSponsorAudioOutputReads(state.owner); throw error; }
}

/** Exact current native workspace transport, never a general filtered event
 * query. The job preparer reads this pair only inside genuine admission; single
 * queries and other profiles retain the ordinary closed descriptor refusal. */
function admissionWorkspacePair(state: State, captured: readonly Captured[], i: Identity): Descriptor[] | null {
  const frame = admissions.get(state.owner);
  if (!frame?.input || frame.prepared || frame.native || frame.dispatched || frame.completed || captured.length !== 2) return null;
  currentAdmission(state, frame);
  const input = frame.input, [page, head] = captured;
  if (!page || !head || input.principal.streamId !== i.stream || input.scope.kind !== "personal"
    || input.scope.ownerUserId !== i.owner || input.scope.actorUserId !== i.owner || !integer(input.ownerHead)) return null;
  // Use the unchanged runtime producer's exact workspace profile and phantom
  // predicate. Resolve these pure declarations here, avoiding eager import-cycle
  // initialization; there is no caller-supplied profile or SQL fragment.
  const excluded = PROFILE_EXCLUDED_EVENT_TYPES.workspace;
  const sql = `SELECT * FROM events LEFT JOIN event_private_payloads secret ON secret.private_event_id=events.event_id AND secret.redacted_at IS NULL WHERE stream_id=? AND sequence>? AND type NOT IN (${excluded.map(() => "?").join(",")}) AND NOT (${PHANTOM_ATTENTION_EVENT_SQL}) ORDER BY sequence ASC LIMIT ?`;
  const bindings = page.bindings, cursor = bindings[1];
  if (page.sql !== sql || !integer(cursor) || cursor > input.ownerHead
    || !same(bindings, [i.stream, cursor, ...excluded, SCOPED_EVENT_PAGE_SIZE])
    || head.sql !== HEAD_READ || !same(head.bindings, [i.stream])) return null;
  return [{ kind: "events", columns: EVENT_COLUMNS, maximumRows: SCOPED_EVENT_PAGE_SIZE },
    { kind: "head", columns: ["head"], maximumRows: 1 }];
}

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
    prepare(sql: string) { current(state); if (state.parserActive) return fail("sponsor_audio_output_parser_in_flight"); if (typeof sql !== "string" || sql.includes("\0")) return fail(); return prepared(sql); },
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
        if (state.driver && captured.some(item => item.sql.startsWith("INSERT INTO experience_sponsor_driver_intents("))) {
          validateDriverBatch(state, captured); current(state);
          return await dispatchLaterMutation(state, captured, "driver") as D1Result<T>[];
        }
        if (audioIssuerBatchFrames.has(state.owner) && captured.some(item => item.sql === AUDIO_ISSUER_GRANT_INSERT)) {
          await validateSponsorAudioIssuerBatch(state, captured); current(state);
          return await dispatchLaterMutation(state, captured, "issuer") as D1Result<T>[];
        }
        if (admissions.has(state.owner) && captured.some(item => item.sql === EVENT_INSERT)) {
          const validated = await validateSponsorAudioAdmissionBatch(state, captured, statements, i); current(state);
          const result = await dispatchLaterMutation(state, captured, "admission", validated.allowedSelects);
          for (const event of validated.events) { state.observedEvents.add(event.eventId); rememberBody(state, event.eventId, JSON.stringify(event.payload), i.projectId, i.documentId); }
          return result as D1Result<T>[];
        }
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
        const workspacePair = admissionWorkspacePair(state, captured, i);
        const descriptors = workspacePair ?? captured.map(item => describeRead(state, item.sql, item.bindings, i));
        // Unknown mutation outcomes permit only the native original lookup
        // through single reads and its scalar proof batch until recovery ends.
        if (state.recovery && descriptors.some(item => !["proof", "later-proof"].includes(item.kind)))
          return fail("sponsor_audio_output_recovery_read_changed");
        const memoryBatch = !!admissions.get(state.owner)?.input && same(descriptors.map(item => item.kind), ["later-structured-memory", "later-job-memory", "later-auxiliary-memory"]);
        if (!memoryBatch && !workspacePair && descriptors.some(item => !["head", "proof", "later-proof", "source"].includes(item.kind))
          || descriptors.filter(item => item.kind === "source").length > 1
          || descriptors.some((item, index) => item.kind === "source" && index !== 0)
          || descriptors.filter(item => item.kind === "head").length > 1) return fail();
        // Keep a native proof batch atomic. Each bounded wrapper preserves every
        // original predicate and false/NULL result, with one shared remaining cap.
        const remaining = state.data.remaining();
        if (remaining.queries < captured.length || remaining.rows < captured.length * 2 || remaining.bytes < captured.length * ACK_BYTES)
          return fail("sponsor_audio_output_read_limit_reached");
        const maximum = Math.floor(remaining.bytes / captured.length), rowAllowance = Math.floor(remaining.rows / captured.length) - 1;
        const memo = laterOperation(state) && descriptors.every(item => ["proof", "later-proof"].includes(item.kind))
          ? createSponsorAudioProofPackMemo(captured.length) : null;
        let plans: ReturnType<typeof composeRows>[], catalogEncoding: object | null = null;
        try {
          const inputs = captured.map((item, at) => ({ ...item, columns: descriptors[at]!.columns, assertions: descriptors[at]!.assertions, invalidRow: invalidNativeRow(descriptors[at]!, i), maximumRows: Math.min(descriptors[at]!.maximumRows, rowAllowance) }));
          catalogEncoding = beginCatalogBatchEncoding(state, inputs, descriptors);
          plans = inputs.map(input => composeRows(state, input, maximum, memo, catalogEncoding ?? undefined));
          if (catalogEncoding && catalogBatchEncodings.get(catalogEncoding)?.next !== inputs.length) return fail();
        } finally { if (catalogEncoding) catalogBatchEncodings.delete(catalogEncoding); memo?.retire(); }
        state.data.account({ bytes: 0, queries: captured.length, rows: 0 });
        const raw = await state.data.wait(() => state.db.batch<Row>(plans.map(plan => state.db.prepare(plan.packed.sql).bind(...plan.packed.bindings)))); current(state);
        const result = laterOperation(state) ? captureLaterResults(raw, state.data.remaining().bytes) : captureResult(raw, state.data.remaining().bytes);
        if (!Array.isArray(result.value) || result.value.length !== captured.length) return fail();
        let rowsCharged = 0;
        const restored = [];
        for (let at = 0; at < result.value.length; at++) { const ack = result.value[at]!;
          acknowledgement(ack); const row = ack.results[0], d = descriptors[at]!;
          if (ack.results.length !== 1 || !row || row.authorized !== 1 || !integer(row.count) || row.count > d.maximumRows || typeof row.body !== "string") return fail();
          const data: unknown = JSON.parse(row.body);
          if (!Array.isArray(data) || data.length !== row.count || data.some(value => !Array.isArray(value) || value.length !== d.columns.length)) return fail();
          const rows = data.map(value => Object.fromEntries(d.columns.map((column, index) => [column, value[index]])));
          if (["proof", "later-proof"].includes(d.kind) && (rows.length !== 1 || rows[0]!.current !== 1)) return fail("sponsor_audio_output_native_proof_changed");
          rowsCharged += 1 + rows.length;
          const item = captured[at]!, witness = { sql: plans[at]!.witnessSql, bindings: [...item.bindings, row.body] };
          restored.push({ ack: { ...ack, results: rows }, rows, witness });
        }
        state.data.account({ bytes: result.bytes, queries: 0, rows: rowsCharged }); current(state);
        // Native MAX always returns one current head. Refuse malformed pair ACKs
        // before runtime's optional-row fallback or any event/body observation.
        if (workspacePair && (restored[1]!.rows.length !== 1
          || restored[1]!.rows[0]!.head !== admissions.get(state.owner)?.input?.ownerHead))
          return fail("sponsor_audio_output_native_workspace_head_changed");
        for (let at = 0; at < restored.length; at++) {
          const item = captured[at]!, d = descriptors[at]!, observation = restored[at]!;
          // No witness registration or native observation precedes validation
          // of the first schema carrier and every genuine result in the batch.
          rowObservations.set(observation.rows, { state, sql: item.sql, bindings: item.bindings, witness: observation.witness });
          if (d.kind.startsWith("later-")) await observeSponsorAudioOutputLaterRead(state.owner, item.sql, item.bindings, observation.rows, observation.witness);
          else observe(state, d, observation.rows, item, i);
        }
        if (frame) frame.completed = true;
        if (state.recovery === "driver") state.recoveryProofBatch = Object.freeze(captured.map(item => Object.freeze({ sql: item.sql, bindings: Object.freeze([...item.bindings]) })));
        return restored.map(item => item.ack) as D1Result<T>[];
      } catch (error) {
        if (record(error) && error.nativeAudioLaterLookup === true && state.recovery) throw error.cause;
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
  const body = Reflect.get(Request.prototype, "body", state.request);
  const text = await readStream(state, body); current(state);
  try { return JSON.parse(text); } catch { closeSponsorAudioOutputReads(owner); return fail("sponsor_audio_output_initial_request_invalid"); }
}
export async function readSponsorAudioOutputResponse(owner: SponsorAudioOutputReadOwner, response: Response): Promise<unknown> {
  const state = get(owner);
  if (!(response instanceof Response) || response.bodyUsed) return fail();
  state.data.accountResponse(JSON.stringify([...response.headers]));
  const text = await readStream(state, Reflect.get(Response.prototype, "body", response)); current(state);
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
const nativeResponseUsed = (response: Response): boolean => Reflect.get(Response.prototype, "bodyUsed", response);
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
    const text = await readStream(state, Reflect.get(Response.prototype, "body", response)); current(state);
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

type LaterSchemaTable = NativeSchemaTable & { unique: readonly Value[][][]; foreign: readonly Value[][] };
async function sponsorAudioLaterSchemaProof(): Promise<Proof> {
  const [{ SPONSOR_DRIVER_SCHEMA },{ SPONSOR_ISSUER_SCHEMA },{ SPONSOR_ENTITLEMENT_SCHEMA },{ SPONSOR_RESOURCE_SCHEMA },{ SPONSOR_APPROVAL_SCHEMA },{ HOLD_DISPOSITION_SCHEMA },{ VIDEO_RECONCILIATION_SCHEMA },{ OUTPUT_DURABLE_SCHEMA },{ GUEST_IMAGE_STAGE_CUSTODY_SCHEMA }] = await Promise.all([import("./experience-sponsor-driver.ts"),import("./experience-sponsor-issuer.ts"),import("./experience-sponsor-entitlement.ts"),import("./experience-sponsor-resources.ts"),import("./experience-sponsor-approval.ts"),import("./budget-hold-schema.ts"),import("./managed-video-reconciliation-schema.ts"),import("./output-durable-schema.ts"),import("./experience-guest-image-stage-custody.ts")]);

  const declarations: readonly string[] = [
    ...SPONSOR_DRIVER_SCHEMA, ...SPONSOR_ISSUER_SCHEMA, ...SPONSOR_ENTITLEMENT_SCHEMA,
    ...SPONSOR_RESOURCE_SCHEMA, ...SPONSOR_APPROVAL_SCHEMA, ...OUTPUT_REQUIREMENTS_SCHEMA,
  ];
  const declaration = (name: string): readonly string[] => {
    const values = declarations.filter(sql => new RegExp(`^CREATE TABLE (?:IF NOT EXISTS )?${name}\\(`, "u").test(sql));
    if (values.length !== 1) return fail();
    return [values[0]!.replace(" IF NOT EXISTS", "")];
  };
  const table = (name: string, definitions: readonly string[], names: string, integers: string, nullable: string,
    primary: string, defaults: Readonly<Record<string, string>> = {}, unique: readonly string[] = [],
    foreign: readonly (readonly [string, string, string])[] = []): LaterSchemaTable => {
    const base = nativeSchemaTable(name, definitions, names, integers, nullable, primary);
    return { ...base, columns: base.columns.map(column => column.map((value, at) => at === 4 ? defaults[String(column[1])] ?? null : value)),
      unique: unique.map(key => key.split(",").map((field, seqno) => [seqno, names.split(",").indexOf(field), field, 0, "BINARY"])),
      // Pin outgoing FK rows independently of exact DDL. Group ids are catalog
      // allocation details; seq and all semantic fields are retained. Exact DDL
      // also pins each multi-column grouping and every CHECK/conflict clause.
      foreign: foreign.flatMap(([target, fields, targets]) => fields.split(",").map((field, seq) =>
        [seq, target, field, targets.split(",")[seq]!, "NO ACTION", "NO ACTION", "NONE"])) };
  };
  // Runtime bootstrap declarations only. No arbitrary catalog normalization.
  // Known Drizzle/ALTER TABLE postimages require a separate literal variant +
  // matching column manifest; do not infer them from observed SQLite SQL.
  const runtime = {
  "private_content": "CREATE TABLE private_content (content_id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, kind TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, redacted_at TEXT)",
  "budget_counters": "CREATE TABLE budget_counters (scope TEXT NOT NULL, scope_id TEXT NOT NULL, period TEXT NOT NULL, used_tokens INTEGER NOT NULL DEFAULT 0, reserved_tokens INTEGER NOT NULL DEFAULT 0, hard_limit_tokens INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(scope, scope_id, period))",
  "budget_reservations": "CREATE TABLE budget_reservations (reservation_id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, stream_id TEXT NOT NULL, correlation_id TEXT NOT NULL, operation TEXT NOT NULL, period TEXT NOT NULL, reserved_tokens INTEGER NOT NULL, used_tokens INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, settlement_reason TEXT, created_at TEXT NOT NULL, settled_at TEXT, updated_at TEXT NOT NULL)",
  "cost_budget_counters": "CREATE TABLE cost_budget_counters (scope TEXT NOT NULL, scope_id TEXT NOT NULL, period TEXT NOT NULL, used_microusd INTEGER NOT NULL DEFAULT 0, reserved_microusd INTEGER NOT NULL DEFAULT 0, hard_limit_microusd INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(scope, scope_id, period))",
  "cost_budget_reservations": "CREATE TABLE cost_budget_reservations (reservation_id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, workspace_id TEXT NOT NULL DEFAULT 'forma', stream_id TEXT NOT NULL DEFAULT '', correlation_id TEXT NOT NULL DEFAULT '', operation TEXT NOT NULL, period TEXT NOT NULL, reserved_microusd INTEGER NOT NULL, used_microusd INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, allow_user_overage INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, settled_at TEXT, updated_at TEXT NOT NULL)",
  "document_jobs": "CREATE TABLE document_jobs (job_id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, stream_id TEXT NOT NULL, document_id TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, source_surface TEXT NOT NULL, correlation_id TEXT NOT NULL, requested_sequence INTEGER NOT NULL, request_json TEXT NOT NULL, result_json TEXT, scene_source_version_json TEXT, scene_source_protocol INTEGER NOT NULL DEFAULT 0 CHECK(scene_source_protocol IN(0,1)), error_message TEXT, attempt_count INTEGER NOT NULL DEFAULT 0, requested_at TEXT NOT NULL, started_at TEXT, completed_at TEXT, lease_expires_at TEXT, notified_at TEXT, expires_at TEXT NOT NULL, updated_at TEXT NOT NULL)"
};
  const tables: LaterSchemaTable[] = [
    table("experience_sponsor_driver_intents", declaration("experience_sponsor_driver_intents"),
      "driver_id,campaign_id,actor_user_id,session_digest,intent_key,document_id,command_json,command_digest,source_digest,requirements_digest,source_text_bytes,created_at_ms", "source_text_bytes,created_at_ms", "", "driver_id", {}, ["campaign_id,actor_user_id,intent_key"], [["experience_sponsor_campaigns", "campaign_id", "campaign_id"]]),
    table("experience_sponsor_driver_stages", declaration("experience_sponsor_driver_stages"),
      "driver_id,stage,command_json,command_digest", "", "", "driver_id,stage", {}, [], [["experience_sponsor_driver_intents", "driver_id", "driver_id"]]),
    table("experience_sponsor_issuances", declaration("experience_sponsor_issuances"),
      "grant_id,campaign_id,actor_user_id,intent_key,policy_digest,driver_command_json,command_digest,envelope_digest,envelope_json", "", "", "grant_id", {}, ["campaign_id,actor_user_id,intent_key"], [["experience_sponsor_grants", "grant_id", "grant_id"]]),
    table("experience_sponsor_campaigns", declaration("experience_sponsor_campaigns"),
      "campaign_id,policy_digest,policy_json,enabled", "enabled", "", "campaign_id", { enabled: "0" }),
    table("experience_sponsor_grants", declaration("experience_sponsor_grants"),
      "grant_id,campaign_id,policy_digest,actor_user_id,session_digest,intent_key,envelope_digest,issued_at_ms,expires_at_ms,enabled", "issued_at_ms,expires_at_ms,enabled", "", "grant_id", { enabled: "0" }, ["campaign_id,actor_user_id,intent_key"], [["experience_sponsor_campaigns", "campaign_id", "campaign_id"]]),
    table("experience_sponsor_consumptions", declaration("experience_sponsor_consumptions"),
      "consumption_id,grant_id,campaign_id,actor_user_id,session_digest,intent_key,envelope_digest,job_id,maximum_microusd,admitted_at_ms", "maximum_microusd,admitted_at_ms", "", "consumption_id", {}, ["grant_id", "job_id", "campaign_id,actor_user_id,intent_key"], [["experience_sponsor_grants", "grant_id", "grant_id"], ["experience_sponsor_campaigns", "campaign_id", "campaign_id"]]),
    table("experience_sponsor_active_jobs", declaration("experience_sponsor_active_jobs"),
      "actor_user_id,consumption_id,job_id", "", "", "actor_user_id", {}, ["consumption_id", "job_id"], [["experience_sponsor_consumptions", "consumption_id", "consumption_id"]]),
    table("experience_sponsor_assertions", declaration("experience_sponsor_assertions"), "token,passed", "passed", "", "token"),
    table("experience_sponsor_resource_policies", declaration("experience_sponsor_resource_policies"),
      "campaign_id,limits_digest,limits_json,enabled", "enabled", "", "campaign_id", { enabled: "0" }, [], [["experience_sponsor_campaigns", "campaign_id", "campaign_id"]]),
    table("experience_sponsor_resource_receipts", declaration("experience_sponsor_resource_receipts"),
      "resource_id,campaign_id,policy_digest,limits_digest,actor_user_id,session_digest,operation,intent_key,payload_digest,text_bytes,issued_grant_id,recorded_at_ms", "text_bytes,recorded_at_ms", "issued_grant_id", "resource_id", {}, ["campaign_id,actor_user_id,operation,intent_key", "issued_grant_id"], [["experience_sponsor_campaigns", "campaign_id", "campaign_id"], ["experience_sponsor_grants", "issued_grant_id", "grant_id"]]),
    table("experience_sponsor_approvals", declaration("experience_sponsor_approvals"),
      "approval_id,campaign_id,payer_user_id,terms_digest,terms_json,policy_digest,policy_json,approved_by_user_id,payer_authority_json,approval_command_json,approved_at_ms,revoked_at_ms", "approved_at_ms,revoked_at_ms", "revoked_at_ms", "approval_id", {}, ["campaign_id"]),
    table("output_execution_grants", nativeOutputDeclaration("output_execution_grants"),
      "scope_key,grant_id,plan_revision_id,actor_user_id,payer_user_id,context_id,preflight_id,authorization_event_id,maximum_microusd,maximum_calls,status,expires_at,created_at", "maximum_microusd,maximum_calls", "context_id", "scope_key,grant_id", {}, [], [["output_plan_revisions", "scope_key,plan_revision_id", "scope_key,plan_revision_id"], ["output_preflights", "scope_key,preflight_id", "scope_key,preflight_id"], ["events", "authorization_event_id", "event_id"]]),
    table("output_operation_slots", nativeOutputDeclaration("output_operation_slots"),
      "scope_key,slot_id,grant_id,plan_revision_id,target_id,target_contract_digest,source_digest,provider,model,route_digest,job_id,cost_reservation_id,token_reservation_id,maximum_microusd,maximum_calls,maximum_tokens,attempt_ordinal,previous_slot_id,status,outcome_event_id,created_at,updated_at", "maximum_microusd,maximum_calls,maximum_tokens,attempt_ordinal", "previous_slot_id,outcome_event_id", "scope_key,slot_id", { attempt_ordinal: "0" }, [], [["output_execution_grants", "scope_key,grant_id", "scope_key,grant_id"], ["output_operation_slots", "scope_key,previous_slot_id", "scope_key,slot_id"], ["output_plan_targets", "scope_key,plan_revision_id,target_id", "scope_key,plan_revision_id,target_id"]]),
    table("output_operation_routes", nativeOutputDeclaration("output_operation_routes"),
      "scope_key,slot_id,stage_key,provider,model,maximum_calls", "maximum_calls", "", "scope_key,slot_id,stage_key", {}, [], [["output_operation_slots", "scope_key,slot_id", "scope_key,slot_id"]]),
    table("private_content", [runtime.private_content], "content_id,owner_id,kind,content,created_at,expires_at,redacted_at", "", "redacted_at", "content_id"),
    table("budget_counters", [runtime.budget_counters], "scope,scope_id,period,used_tokens,reserved_tokens,hard_limit_tokens,updated_at", "used_tokens,reserved_tokens,hard_limit_tokens", "", "scope,scope_id,period", { used_tokens: "0", reserved_tokens: "0" }),
    table("budget_reservations", [runtime.budget_reservations], "reservation_id,owner_id,stream_id,correlation_id,operation,period,reserved_tokens,used_tokens,status,settlement_reason,created_at,settled_at,updated_at", "reserved_tokens,used_tokens", "settlement_reason,settled_at", "reservation_id", { used_tokens: "0" }),
    table("cost_budget_counters", [runtime.cost_budget_counters], "scope,scope_id,period,used_microusd,reserved_microusd,hard_limit_microusd,updated_at", "used_microusd,reserved_microusd,hard_limit_microusd", "", "scope,scope_id,period", { used_microusd: "0", reserved_microusd: "0" }),
    table("cost_budget_reservations", [runtime.cost_budget_reservations], "reservation_id,owner_id,workspace_id,stream_id,correlation_id,operation,period,reserved_microusd,used_microusd,status,allow_user_overage,created_at,settled_at,updated_at", "reserved_microusd,used_microusd,allow_user_overage", "settled_at", "reservation_id", { workspace_id: "'forma'", stream_id: "''", correlation_id: "''", used_microusd: "0", allow_user_overage: "0" }),
    table("document_jobs", [runtime.document_jobs], "job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,request_json,result_json,scene_source_version_json,scene_source_protocol,error_message,attempt_count,requested_at,started_at,completed_at,lease_expires_at,notified_at,expires_at,updated_at", "requested_sequence,scene_source_protocol,attempt_count", "result_json,scene_source_version_json,error_message,started_at,completed_at,lease_expires_at,notified_at", "job_id", { scene_source_protocol: "0", attempt_count: "0" }),
  ];
  const names = new Set(tables.map(value => value.name));
  const index = (name: string, tableName: string, fields: string) => {
    const selected = tables.find(value => value.name === tableName) ?? fail();
    const sql = declarations.filter(value => new RegExp(`^CREATE (?:UNIQUE )?INDEX (?:IF NOT EXISTS )?${name} ON ${tableName}\\(`, "u").test(value));
    if (sql.length !== 1) return fail();
    return { name, table: tableName, definition: sql[0]!.replace(" IF NOT EXISTS", ""), unique: sql[0]!.startsWith("CREATE UNIQUE ") ? 1 : 0,
      columns: fields.split(",").map((field, seqno) => [seqno, selected.columns.findIndex(column => column[1] === field), field, 0, "BINARY"]) };
  };
  const indexes = [
    index("experience_sponsor_campaign_consumption", "experience_sponsor_consumptions", "campaign_id,admitted_at_ms"),
    index("experience_sponsor_actor_consumption", "experience_sponsor_consumptions", "campaign_id,actor_user_id,admitted_at_ms"),
    index("experience_sponsor_resource_campaign_time", "experience_sponsor_resource_receipts", "campaign_id,recorded_at_ms"),
    index("experience_sponsor_resource_actor_time", "experience_sponsor_resource_receipts", "campaign_id,actor_user_id,recorded_at_ms"),
    index("idx_output_execution_grants_unique_1", "output_execution_grants", "scope_key,preflight_id"),
    index("idx_output_operation_slots_unique_1", "output_operation_slots", "scope_key,grant_id,target_id"),
    index("idx_output_operation_slots_unique_2", "output_operation_slots", "scope_key,target_id,target_contract_digest,attempt_ordinal"),
    index("idx_output_operation_slots_unique_3", "output_operation_slots", "job_id"),
    index("idx_output_operation_slots_unique_4", "output_operation_slots", "cost_reservation_id"),
    index("idx_output_operation_slots_unique_5", "output_operation_slots", "token_reservation_id"),
  ];
  const triggerDefinitions = (sources: readonly string[], required: boolean) => sources.flatMap(raw => {
    const sql = raw.replace(" IF NOT EXISTS", "");
    const match = /^CREATE TRIGGER ([a-z_]+)\s+[\s\S]*?\bON ([a-z_]+)\b/u.exec(sql);
    return match && names.has(match[2]!) ? [{ name: match[1]!, table: match[2]!, definition: sql, required: required ? 1 : 0 }] : [];
  });
  const triggers = [...triggerDefinitions(declarations, true),
    ...triggerDefinitions([...HOLD_DISPOSITION_SCHEMA, ...VIDEO_RECONCILIATION_SCHEMA,
      ...OUTPUT_DURABLE_SCHEMA, ...GUEST_IMAGE_STAGE_CUSTODY_SCHEMA], false)];
  // Only these tables are UPDATE targets in the captured personal bridge.
  // The assertion scratch table is also DELETEd. All other new tables are
  // INSERT-only here; no REPLACE or mutable-key upsert is in the genuine vector.
  const updateTargets = ["budget_counters", "budget_reservations", "cost_budget_counters", "cost_budget_reservations", "private_content"];
  const tableChecks = [
    `EXISTS(SELECT 1 FROM main.sqlite_schema actual,json_each(expected.spec,'$.definitions') definition WHERE actual.type='table' AND actual.name COLLATE BINARY=json_extract(expected.spec,'$.name') AND actual.tbl_name COLLATE BINARY=actual.name AND actual.sql COLLATE BINARY=definition.value)`,
    `EXISTS(SELECT 1 FROM pragma_table_list(json_extract(expected.spec,'$.name')) actual WHERE actual.schema='main' AND actual.name=json_extract(expected.spec,'$.name') AND actual.type='table' AND actual.wr=0 AND actual.strict=0 AND actual.ncol=json_array_length(expected.spec,'$.columns'))`,
    `(SELECT COUNT(*) FROM pragma_table_xinfo(json_extract(expected.spec,'$.name'),'main'))=json_array_length(expected.spec,'$.columns')`,
    `NOT EXISTS(SELECT 1 FROM pragma_table_xinfo(json_extract(expected.spec,'$.name'),'main') actual WHERE NOT EXISTS(SELECT 1 FROM json_each(expected.spec,'$.columns') column WHERE json_array(actual.cid,actual.name,upper(actual.type),actual."notnull",actual.dflt_value,actual.pk,actual.hidden)=column.value))`,
    `(SELECT COUNT(*) FROM pragma_index_list(json_extract(expected.spec,'$.name'),'main') WHERE origin='pk')=1`,
    `EXISTS(SELECT 1 FROM pragma_index_list(json_extract(expected.spec,'$.name'),'main') actual WHERE actual.origin='pk' AND actual."unique"=1 AND actual.partial=0 AND (SELECT COUNT(*) FROM pragma_index_xinfo(actual.name,'main') WHERE "key"=1)=json_array_length(expected.spec,'$.primary') AND NOT EXISTS(SELECT 1 FROM pragma_index_xinfo(actual.name,'main') part WHERE part."key"=1 AND NOT EXISTS(SELECT 1 FROM json_each(expected.spec,'$.primary') key WHERE json_array(part.seqno,part.cid,part.name,part."desc",part.coll)=key.value)))`,
    `(SELECT COUNT(*) FROM pragma_index_list(json_extract(expected.spec,'$.name'),'main') WHERE origin='u')=json_array_length(expected.spec,'$.unique')`,
    `NOT EXISTS(SELECT 1 FROM json_each(expected.spec,'$.unique') expected_key WHERE NOT EXISTS(SELECT 1 FROM pragma_index_list(json_extract(expected.spec,'$.name'),'main') actual WHERE actual.origin='u' AND actual."unique"=1 AND actual.partial=0 AND (SELECT COUNT(*) FROM pragma_index_xinfo(actual.name,'main') WHERE "key"=1)=json_array_length(expected_key.value) AND NOT EXISTS(SELECT 1 FROM pragma_index_xinfo(actual.name,'main') part WHERE part."key"=1 AND NOT EXISTS(SELECT 1 FROM json_each(expected_key.value) key WHERE json_array(part.seqno,part.cid,part.name,part."desc",part.coll)=key.value))))`,
    `NOT EXISTS(SELECT 1 FROM pragma_index_list(json_extract(expected.spec,'$.name'),'main') actual WHERE actual."unique"=1 AND actual.origin NOT IN('pk','u') AND NOT EXISTS(SELECT 1 FROM audio_later_indexes allowed WHERE actual.name COLLATE BINARY=json_extract(allowed.spec,'$.name') AND json_extract(allowed.spec,'$.table')=json_extract(expected.spec,'$.name') AND json_extract(allowed.spec,'$.unique')=1))`,
    `(SELECT COUNT(*) FROM pragma_foreign_key_list(json_extract(expected.spec,'$.name'),'main'))=json_array_length(expected.spec,'$.foreign')`,
    `NOT EXISTS(SELECT 1 FROM pragma_foreign_key_list(json_extract(expected.spec,'$.name'),'main') actual WHERE NOT EXISTS(SELECT 1 FROM json_each(expected.spec,'$.foreign') relation WHERE json_array(actual.seq,actual.[table],actual.[from],actual.[to],actual.on_update,actual.on_delete,actual.[match])=relation.value))`,
  ];
  const checks = [
    ...tableChecks.map(check => `NOT EXISTS(SELECT 1 FROM audio_later_tables expected WHERE NOT (${check}))`),
    `NOT EXISTS(SELECT 1 FROM audio_later_indexes expected WHERE NOT EXISTS(SELECT 1 FROM pragma_index_list(json_extract(expected.spec,'$.table'),'main') actual WHERE actual.name COLLATE BINARY=json_extract(expected.spec,'$.name') AND actual.origin='c' AND actual."unique"=json_extract(expected.spec,'$.unique') AND actual.partial=0 AND EXISTS(SELECT 1 FROM main.sqlite_schema declaration WHERE declaration.type='index' AND declaration.name COLLATE BINARY=actual.name AND declaration.tbl_name COLLATE BINARY=json_extract(expected.spec,'$.table') AND declaration.sql COLLATE BINARY=json_extract(expected.spec,'$.definition')) AND (SELECT COUNT(*) FROM pragma_index_xinfo(actual.name,'main') WHERE "key"=1)=json_array_length(expected.spec,'$.columns') AND NOT EXISTS(SELECT 1 FROM pragma_index_xinfo(actual.name,'main') part WHERE part."key"=1 AND NOT EXISTS(SELECT 1 FROM json_each(expected.spec,'$.columns') column WHERE json_array(part.seqno,part.cid,part.name,part."desc",part.coll)=column.value))))`,
    `NOT EXISTS(SELECT 1 FROM main.sqlite_schema actual WHERE actual.type='trigger' AND lower(actual.tbl_name) IN(SELECT json_extract(spec,'$.name') FROM audio_later_tables) AND NOT EXISTS(SELECT 1 FROM audio_later_triggers expected WHERE actual.name COLLATE BINARY=json_extract(expected.spec,'$.name') AND actual.tbl_name COLLATE BINARY=json_extract(expected.spec,'$.table') AND actual.sql COLLATE BINARY=json_extract(expected.spec,'$.definition')))`,
    `NOT EXISTS(SELECT 1 FROM audio_later_triggers expected WHERE json_extract(expected.spec,'$.required')=1 AND NOT EXISTS(SELECT 1 FROM main.sqlite_schema actual WHERE actual.type='trigger' AND actual.name COLLATE BINARY=json_extract(expected.spec,'$.name') AND actual.tbl_name COLLATE BINARY=json_extract(expected.spec,'$.table') AND actual.sql COLLATE BINARY=json_extract(expected.spec,'$.definition')))`,
    // Extra children with cascading/default/null actions can mutate tables not
    // present in the captured native batch. Fail before every native mutation.
    `NOT EXISTS(SELECT 1 FROM main.sqlite_schema child,pragma_foreign_key_list(child.name,'main') relation WHERE child.type='table' AND instr(lower(child.sql),'references')>0 AND (lower(relation.[table])='experience_sponsor_assertions' OR (lower(relation.[table]) IN(SELECT value FROM audio_later_manifest,json_each(body,'$.updateTargets')) AND upper(relation.on_update) NOT IN('NO ACTION','RESTRICT'))))`,
  ];
  // Fifteen total truth rows: four groups (4/4/4/3), then four outer terms.
  // No caller-controlled count or SQL. False and NULL always contribute zero.
  if (checks.length !== 15) return fail();
  const groups = Array.from({ length: Math.ceil(checks.length / 4) }, (_, at) => checks.slice(at * 4, at * 4 + 4)
    .map(check => `SELECT CASE WHEN (${check}) THEN 1 ELSE 0 END AS allowed`).join(" UNION ALL "));
  return { sql: `WITH audio_later_manifest AS (SELECT ? AS body),
    audio_later_tables AS (SELECT value AS spec FROM audio_later_manifest,json_each(body,'$.tables')),
    audio_later_indexes AS (SELECT value AS spec FROM audio_later_manifest,json_each(body,'$.indexes')),
    audio_later_triggers AS (SELECT value AS spec FROM audio_later_manifest,json_each(body,'$.triggers')),
    ${groups.map((group, at) => `audio_later_checks_${at} AS MATERIALIZED (${group})`).join(",")},
    audio_later_checks AS MATERIALIZED (${groups.map((_, at) => `SELECT allowed FROM audio_later_checks_${at}`).join(" UNION ALL ")})
    SELECT CASE WHEN COUNT(*)=${checks.length} AND MIN(allowed)=1 THEN 1 ELSE 0 END FROM audio_later_checks`,
    bindings: [JSON.stringify({ tables, indexes, triggers, updateTargets })] };
}

// INTEGRATION: keepProofs(state, [sponsorAudioNativeSchemaProof(),
//   ...(laterOperation(state) ? [sponsorAudioLaterSchemaProof()] : [])]);
// Do not expose a caller parameter that can replace either source declaration.
// The same baseline must remain in atomic pre/post proofs and final disclosure.
// Caveats requiring allocated verification:
// - No SQL has been run. The shape uses <=4 compound terms and <=7 function
//   args, one binding, but complete packed queries still must meet depth100,
//   functionargs32, params100, SQL100KB and compound5. Adding the proof may push
//   a formerly near-limit complete query above the byte/depth ceiling.
// - Runtime canonical nonexported tables only; migrated Drizzle/ALTER variants
//   are deliberately not accepted here until a literal postimage is reviewed.
// - Extra nonunique indexes are harmless to conflict semantics and are not
//   rejected; every required explicit source index and all uniqueness is pinned.
// - Optional known abort-only guards are recognized by exact bytes, not required.
//   Their ancillary tables are not write targets and add no mutation authority.
// - Initial proof continues to own events/private event bodies/stage/assertions,
//   output commands/plan/preflight and optional Scene generation trigger closure.
// - Source policy tables used by existing C/principal custody remain under their
//   existing proof owners; this companion is not a substitute for those proofs.
