/** Finite transport for the unchanged PERSONAL text-only Image save/confirm
 * path. The opaque parent capability owns authority and the shared lifetime;
 * this adapter only accepts exact native statements and never grants a route. */
import { experienceResourceId, type ExperiencePlan } from "../src/experiences/intake.ts";
import { canonicalJson } from "../src/experiences/compiler.ts";
import { experienceOutputBinding, experienceOutputCommandKey } from "./experience-output-binding.ts";
import { createExperienceOutputRecipe } from "./experience-output-recipe.ts";
import { packSponsorIntakeReadQuery } from "./experience-sponsor-intake-read-sql.ts";
import { SponsorEntitlementError } from "./experience-sponsor-policy.ts";
import type { ProjectIntakeAuthorization } from "./intake-authority.ts";
import type { BudgetReservationGuard } from "./pilot-policy.ts";
import type { WorkerEnv } from "./runtime.ts";
import { EVENT_WRITE_COLUMNS, eventWriteBindings, type EventRow } from "./event-write-primitives.ts";
import { POLICY_VERSION } from "./policy-version.ts";

export type SponsorImageConfirmationNativeControl = {
  auth: ProjectIntakeAuthorization; plan: ExperiencePlan;
  check(): void; remaining(): number; account(value: unknown): void;
  run<T>(work: () => Promise<T>): Promise<T>;
  assertions(): readonly BudgetReservationGuard[];
  nativeAssertions(): readonly BudgetReservationGuard[];
  allowWrite(): void;
};
type ReadDescriptor = { kind: string; columns: readonly string[]; maximumRows: number; order?: string };
type CapturedStatement = { sql: string; bindings: readonly NativeValue[] };
type NativeRow = Record<string, unknown>;
const refuse = (code = "sponsor_confirmation_native_query_changed"): never => { throw new SponsorEntitlementError(code); };
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
const RECEIPT_ASSERTION = `EXISTS(SELECT 1 FROM output_commands command JOIN events event ON event.event_id=command.event_id
    WHERE command.scope_key=? AND command.actor_user_id=? AND command.command_key=? AND command.request_digest=?
      AND command.action=? AND command.event_id=? AND command.created_at=?
      AND event.stream_id=? AND event.actor=? AND event.client_id='server:output-requirements' AND event.correlation_id=command.command_key
      AND json_extract(event.payload,'$.project_id')=? AND json_extract(event.payload,'$.document_id')=?)`;
const EVENT_COLUMNS = ["event_id", "stream_id", "sequence", "occurred_at", "recorded_at", "actor", "client_id", "correlation_id", "causation_id", "compensates_event_id", "schema_version", "type", "payload", "private_event_id", "owner_id", "project_id", "document_id", "private_json", "created_at", "redacted_at"];
const PLAN_COLUMNS = ["scope_key", "scope_kind", "owner_user_id", "project_id", "document_id", "organization_id", "project_access_id", "plan_revision_id", "plan_id", "revision", "confirmed_event_id", "requirements_digest", "source_digest", "resolver_version", "source_head", "target_count", "created_at"];
const copyProofs = (values: readonly BudgetReservationGuard[]) => values.map(value => Object.freeze({ sql: value.sql, bindings: Object.freeze([...value.bindings]) }));

/** The control is issued inside the opaque capability module, never from HTTP
 * fields. Only exact native reads and complete native save/confirm batches run. */
export function createSponsorImageConfirmationNativeEnvironment(env: WorkerEnv, control: SponsorImageConfirmationNativeControl): WorkerEnv {
  control.check();
  const database = env.DB, auth = control.auth, plan = control.plan;
  const planIdentity = canonicalJson(plan), owner = auth.user.userId, stream = `creative:${owner}`;
  if (auth.impersonation || auth.user.fictional || auth.user.projectExecution || auth.user.streamId !== stream
    || auth.principal.userId !== owner || plan.streamId !== stream || plan.release.output.output !== "image"
    || Object.hasOwn(plan, "reference") || Object.hasOwn(plan.request, "reference")) return refuse();
  const check = () => { control.check(); if (env.DB !== database || control.auth !== auth || control.plan !== plan || canonicalJson(plan) !== planIdentity) refuse(); };
  const observedBodies = new Map<string, { raw: string; projectId: string | null; documentId: string | null }>();
  const observedEvents = new Set<string>(), observedPlans = new Set<string>(), planEvents = new Set<string>();
  const receiptProofs: NativeProof[] = [], statements = new WeakMap<D1PreparedStatement, CapturedStatement>();
  const identity = (async () => {
    const binding = await experienceOutputBinding(plan);
    const [requirementId, deliverableId, variantId, saveKey, confirmKey] = await Promise.all([
      experienceResourceId(plan.draftId, "native-output-requirement"), experienceResourceId(plan.draftId, "native-output-deliverable"),
      experienceResourceId(plan.draftId, "native-output-variant"), experienceOutputCommandKey(binding, "save"), experienceOutputCommandKey(binding, "confirm"),
    ]);
    const ratio = plan.request.values.ratio;
    if (!ratio || ratio.provenance !== "authored" || !object(ratio.value)) return refuse();
    const recipe = createExperienceOutputRecipe({ output: "image", requirementId, deliverableId, variantId, aspectRatio: ratio.value as { width: number; height: number } });
    check();
    return Object.freeze({ owner, stream, projectId: plan.projectId, documentId: plan.documentId, scopeKey: `personal:${owner}:${plan.projectId}`,
      requirementId, targetId: recipe.targetId, allowedCommandKeys: Object.freeze([saveKey, confirmKey]) });
  })();
  async function currentIdentity(): Promise<ConfirmationMutationIdentity> {
    const value = await identity; check();
    return { ...value, knownAssertions: [...copyProofs(control.nativeAssertions()), ...receiptProofs], observedBodies };
  }
  function describeRead(sql: string, b: readonly NativeValue[], i: ConfirmationMutationIdentity): ReadDescriptor {
    const command = recognizeNativeCommandRead(sql, b, i); if (command) return command;
    const scalar = recognizeNativeScalarAssertion(sql, b, i); if (scalar) return { ...scalar, maximumRows: 1 };
    if (sql === HEAD_READ && equalValues(b, [stream])) return { kind: "head", columns: ["head"], maximumRows: 1 };
    if (sql === PAGE_READ && b.length === 3 && b[0] === stream && integer(b[1]) && b[2] === 5000)
      return { kind: "events", columns: EVENT_COLUMNS, maximumRows: 5000, order: "sequence ASC" };
    if (sql === GOVERNED_READ && equalValues(b, [owner, plan.projectId])) return { kind: "governed", columns: ["present"], maximumRows: 1 };
    if (sql === OCCUPIED_READ && equalValues(b, [stream, i.requirementId])) return { kind: "occupied", columns: ["count"], maximumRows: 1 };
    if (sql === SOURCE_READ && b.length === 2 && b[0] === owner && typeof b[1] === "string") {
      let ids: unknown; try { ids = JSON.parse(b[1]); } catch { return refuse(); }
      if (!Array.isArray(ids) || ids.some(id => typeof id !== "string" || !observedEvents.has(id)) || new Set(ids).size !== ids.length) return refuse();
      return { kind: "source", columns: ["private_event_id", "private_json", "project_id", "document_id"], maximumRows: ids.length };
    }
    if (sql === BODY_READ && b.length === 4 && typeof b[0] === "string" && planEvents.has(b[0])
      && equalValues(b.slice(1), [owner, plan.projectId, plan.documentId])) return { kind: "plan-body", columns: ["private_json"], maximumRows: 1 };
    if (sql === PLAN_READ(false) && equalValues(b, [i.scopeKey, plan.documentId])
      || sql === PLAN_READ(true) && b.length === 3 && equalValues(b.slice(0, 2), [i.scopeKey, plan.documentId]) && typeof b[2] === "string" && observedPlans.has(b[2]))
      return { kind: "plan", columns: PLAN_COLUMNS, maximumRows: 1 };
    if (sql === COMMAND_INDEX_READ && b.length === 3 && equalValues(b.slice(0, 2), [i.scopeKey, owner]) && i.allowedCommandKeys.includes(String(b[2])))
      return { kind: "command-index", columns: ["request_digest", "event_id", "sequence"], maximumRows: 1 };
    if (sql === COMMITMENTS_READ && equalValues(b, [i.scopeKey, plan.documentId]))
      return { kind: "commitments", columns: ["slot_id", "grant_id", "job_id", "target_id", "plan_revision_id", "active"], maximumRows: 1000 };
    return refuse();
  }
  function rememberBody(id: unknown, raw: unknown, projectId: unknown, documentId: unknown) {
    if (typeof id !== "string" || typeof raw !== "string" || projectId !== null && typeof projectId !== "string" || documentId !== null && typeof documentId !== "string") return refuse();
    const previous = observedBodies.get(id);
    if (previous && (previous.raw !== raw || previous.projectId !== projectId || previous.documentId !== documentId)) return refuse("sponsor_confirmation_native_body_changed");
    observedBodies.set(id, { raw, projectId, documentId });
  }
  function observe(d: ReadDescriptor, rows: NativeRow[], statement: CapturedStatement, i: ConfirmationMutationIdentity) {
    for (const row of rows) {
      if (d.kind === "events") {
        if (row.stream_id !== stream || typeof row.event_id !== "string" || !integer(row.sequence, 1)) return refuse();
        observedEvents.add(row.event_id);
        if (typeof row.private_json === "string") {
          if (row.private_event_id !== row.event_id || row.owner_id !== owner) return refuse();
          rememberBody(row.event_id, row.private_json, row.project_id, row.document_id);
        }
      } else if (d.kind === "source") rememberBody(row.private_event_id, row.private_json, row.project_id, row.document_id);
      else if (d.kind === "plan") {
        if (row.scope_key !== i.scopeKey || row.scope_kind !== "personal" || row.owner_user_id !== owner || row.project_id !== plan.projectId
          || row.document_id !== plan.documentId || row.organization_id !== null || row.project_access_id !== null || !uuid(row.plan_revision_id) || !uuid(row.confirmed_event_id)) return refuse();
        observedPlans.add(row.plan_revision_id); planEvents.add(row.confirmed_event_id);
      } else if (d.kind === "commitments") { if (!uuid(row.plan_revision_id)) return refuse(); observedPlans.add(row.plan_revision_id); }
      else if (d.kind === "plan-body") rememberBody(statement.bindings[0], row.private_json, plan.projectId, plan.documentId);
      else if (d.kind === "command-receipt") {
        const key = statement.bindings[5];
        if (row.stream_id !== stream || row.actor !== `user:${owner}` || row.client_id !== "server:output-requirements" || row.correlation_id !== key
          || row.project_id !== plan.projectId || row.document_id !== plan.documentId || !uuid(row.event_id) || !digest(row.request_digest) || !iso(row.created_at)
          || row.action !== phaseForKey(key, i)) return refuse();
        receiptProofs.push({ sql: RECEIPT_ASSERTION, bindings: [i.scopeKey, owner, String(key), row.request_digest, String(row.action), row.event_id, row.created_at, stream, `user:${owner}`, plan.projectId, plan.documentId] });
        if (typeof row.private_json === "string") {
          rememberBody(row.event_id, row.private_json, plan.projectId, plan.documentId);
          const payload = parsed(row.private_json); if (payload && typeof payload.plan_revision_id === "string") observedPlans.add(payload.plan_revision_id);
        }
      }
    }
  }
  function bounded(s: CapturedStatement, d: ReadDescriptor, maximum: number) {
    check(); if (!integer(maximum) || maximum < 2) return refuse("sponsor_intake_read_byte_limit");
    const proofs = copyProofs(control.assertions()); if (!proofs.length) return refuse();
    let prefix = "sponsor_confirmation_native";
    const source = [s.sql, ...proofs.map(proof => proof.sql)].join("\n").toLowerCase(); while (source.includes(prefix)) prefix += "_";
    const gates = proofs.map((_, n) => `${prefix}_gate_${n}`), authority = `${prefix}_authority`, rows = `${prefix}_rows`, objects = `${prefix}_objects`, metadata = `${prefix}_metadata`;
    let json = "'{}'";
    for (let offset = 0; offset < d.columns.length; offset += 15)
      json = `json_set(${json},${d.columns.slice(offset, offset + 15).map(c => `'$.${c}',native."${c}"`).join(",")})`;
    const sql = `WITH ${proofs.map((p, n) => `${gates[n]} AS MATERIALIZED (SELECT 1 WHERE ${p.sql})`).join(",")},
      ${authority} AS MATERIALIZED (SELECT 1 AS authorized FROM ${gates.join(" CROSS JOIN ")}),
      ${rows} AS MATERIALIZED (SELECT ${d.columns.map(c => `native."${c}"`).join(",")} FROM (${s.sql}) native CROSS JOIN ${authority}),
      ${objects} AS MATERIALIZED (SELECT ${json} AS object FROM ${rows} native${d.order ? ` ORDER BY ${d.order}` : ""}),
      ${metadata} AS (SELECT COUNT(*) AS count,COALESCE(SUM(length(CAST(object AS BLOB))),0)+MAX(COUNT(*)-1,0)+2 AS bytes FROM ${objects})
      SELECT EXISTS(SELECT 1 FROM ${authority}) AS authorized,count,bytes,
        CASE WHEN EXISTS(SELECT 1 FROM ${authority}) AND count<=${d.maximumRows} AND bytes<=${maximum}
          THEN (SELECT json_group_array(json(object)) FROM ${objects}) ELSE NULL END AS body FROM ${metadata}`;
    const packed = packSponsorIntakeReadQuery(sql, [...proofs.flatMap(proof => proof.bindings), ...s.bindings]);
    return database.prepare(packed.sql).bind(...packed.bindings);
  }
  function decode(result: D1Result<NativeRow>, d: ReadDescriptor): NativeRow[] {
    check(); const meta = result.results?.[0];
    if (!result.success || result.results.length !== 1 || !meta || Number(meta.authorized) !== 1) return refuse("sponsor_confirmation_native_read_denied");
    if (!integer(meta.count) || !integer(meta.bytes) || meta.count > d.maximumRows || typeof meta.body !== "string") return refuse("sponsor_intake_read_byte_limit");
    let rows: unknown; try { rows = JSON.parse(meta.body); } catch { return refuse(); }
    if (!Array.isArray(rows) || rows.length !== meta.count || rows.some(row => !object(row) || !equalValues(Object.keys(row), d.columns))) return refuse();
    control.account(rows); check(); return rows;
  }
  async function read(s: CapturedStatement) {
    const i = await currentIdentity(), d = describeRead(s.sql, s.bindings, i), native = bounded(s, d, control.remaining());
    const result = await control.run(() => native.all<NativeRow>()); check();
    const rows = decode(result, d); observe(d, rows, s, i); return { ...result, results: rows };
  }
  function prepared(sql: string, bindings: readonly NativeValue[] = []): D1PreparedStatement {
    check(); const captured = Object.freeze({ sql, bindings: Object.freeze([...bindings]) });
    const value = {
      bind(...next: unknown[]) {
        if (next.some(v => v !== null && typeof v !== "string" && (typeof v !== "number" || !Number.isFinite(v)))) return refuse();
        return prepared(sql, next as NativeValue[]);
      },
      async first(column?: string) { if (column !== undefined) return refuse(); return (await read(captured)).results[0] ?? null; },
      all: () => read(captured), run: () => refuse(), raw: () => refuse(),
    } as D1PreparedStatement;
    statements.set(value, captured); return value;
  }
  const DB = {
    prepare(sql: string) { if (typeof sql !== "string" || sql.includes("\0")) return refuse(); return prepared(sql); },
    async batch<T = Record<string, unknown>>(items: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      check(); if (!Array.isArray(items) || !items.length || items.length > 1000) return refuse();
      const captured = items.map(item => statements.get(item) ?? refuse()), i = await currentIdentity();
      const mutations = captured.map(s => recognizeNativeMutation(s.sql, s.bindings, i));
      if (mutations.some(Boolean)) {
        control.allowWrite(); check();
        if (mutations.some(value => !value) || !nativeConfirmationBatchMatches(mutations as NativeMutationDescriptor[])) return refuse();
        for (const proof of control.nativeAssertions()) if (!captured.some(s =>
          s.sql === `INSERT INTO output_atomic_assertions(token,passed) VALUES(?,CASE WHEN (${proof.sql}) THEN 1 ELSE 0 END)`
          && equalValues(s.bindings.slice(1), proof.bindings))) return refuse();
        const native = captured.map(s => database.prepare(s.sql).bind(...s.bindings));
        const result = await control.run(() => database.batch<T>(native)); check();
        if (!Array.isArray(result) || result.length !== captured.length || result.some(entry => entry.success !== true)) return refuse("sponsor_confirmation_native_acknowledgment_invalid");
        for (const mutation of mutations) if (mutation?.kind === "event") {
          observedEvents.add(mutation.eventId); rememberBody(mutation.eventId, JSON.stringify(mutation.payload), plan.projectId, plan.documentId);
        }
        return result;
      }
      const descriptors = captured.map(s => describeRead(s.sql, s.bindings, i));
      if (descriptors.some(d => !["head", "scalar-assertion"].includes(d.kind))) return refuse();
      const allowance = Math.floor(control.remaining() / items.length), native = captured.map((s, at) => bounded(s, descriptors[at]!, allowance));
      const result = await control.run(() => database.batch<NativeRow>(native)); check();
      if (!Array.isArray(result) || result.length !== items.length) return refuse();
      return result.map((entry, at) => ({ ...entry, results: decode(entry, descriptors[at]!) as T[] }));
    },
    exec: () => refuse(), dump: () => refuse(), withSession: () => refuse(),
  } as unknown as WorkerEnv["DB"];
  const MEDIA = new Proxy({} as WorkerEnv["MEDIA"], { get: () => () => refuse("sponsor_confirmation_media_unsupported") });
  return { ...env, DB, MEDIA };
}

type NativeValue = string | number | null;
type NativeProof = Readonly<{ sql: string; bindings?: readonly NativeValue[] }>;
export type ConfirmationMutationIdentity = Readonly<{
  owner: string; stream: string; projectId: string; documentId: string; scopeKey: string;
  requirementId: string; targetId: string;
  allowedCommandKeys: readonly string[];
  /** Capture exact immutable proofs from trusted.sourceAssertions/retained bodies.
   * Never fill this from SQL received through prepare(). */
  knownAssertions: readonly NativeProof[];
  /** Private rows actually read/byte-accounted in this bounded environment. */
  observedBodies?: ReadonlyMap<string, Readonly<{ raw: string; projectId: string | null; documentId: string | null }>>;
  /** If supplied, this is the native predecessor captured for this one batch. */
  expectedHead?: number;
}>;
const equalValues = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const integer = (value: unknown, minimum = 0): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
const iso = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value);
const digest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
function parsed(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string") return null;
  try { const result: unknown = JSON.parse(value); return object(result) ? result : null; } catch { return null; }
}
function identityValid(i: ConfirmationMutationIdentity) {
  return i.stream === `creative:${i.owner}` && Boolean(i.owner && i.projectId && i.documentId && i.scopeKey && i.requirementId && i.targetId)
    && i.allowedCommandKeys.length === 2 && new Set(i.allowedCommandKeys).size === 2
    && i.allowedCommandKeys.some(k => k.endsWith(":save")) && i.allowedCommandKeys.some(k => k.endsWith(":confirm"));
}
function phaseForKey(key: unknown, i: ConfirmationMutationIdentity): "save" | "confirm" | null {
  if (typeof key !== "string" || !i.allowedCommandKeys.includes(key)) return null;
  return key.endsWith(":save") ? "save" : key.endsWith(":confirm") ? "confirm" : null;
}

// Exact bytes from output-command-core.ts; no whitespace/prefix SQL parser.
const PERSONAL_AUTHORITY = `?=? AND EXISTS(SELECT 1 FROM users actor WHERE actor.user_id=? AND actor.consent_version=?
        AND (?=1 OR actor.role IN('admin','creator')))
      AND NOT EXISTS(SELECT 1 FROM organization_projects project WHERE project.owner_user_id=? AND project.project_id=?)`;
const OWNER_HEAD = "(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?";
const CREATED_EVENT = "EXISTS(SELECT 1 FROM events event JOIN event_private_payloads body ON body.private_event_id=event.event_id AND body.redacted_at IS NULL WHERE event.event_id=? AND body.owner_id=? AND body.document_id=?)";
const EMPTY_REQUIREMENT = "NOT EXISTS(SELECT 1 FROM events WHERE stream_id=? AND type='BlockCreated' AND json_extract(payload,'$.block_id')=?)";
const RETAINED_BODY = `NOT EXISTS(SELECT 1 FROM json_each(?) expected LEFT JOIN event_private_payloads body
    ON body.private_event_id=json_extract(expected.value,'$.id') AND body.owner_id=?
      AND body.project_id IS json_extract(expected.value,'$.projectId') AND body.document_id IS json_extract(expected.value,'$.documentId')
    WHERE body.private_event_id IS NULL OR body.redacted_at IS NOT NULL OR length(body.private_json)<>json_extract(expected.value,'$.total')
      OR substr(body.private_json,json_extract(expected.value,'$.offset'),json_extract(expected.value,'$.length'))<>json_extract(expected.value,'$.part'))`;
function retainedBodyBindings(b: readonly unknown[], i: ConfirmationMutationIdentity) {
  if (b.length !== 2 || b[1] !== i.owner || typeof b[0] !== "string" || !i.observedBodies
    || new TextEncoder().encode(b[0]).byteLength > 128 * 1024) return false;
  let pieces: unknown; try { pieces = JSON.parse(b[0]); } catch { return false; }
  if (!Array.isArray(pieces) || !pieces.length) return false;
  return pieces.every(piece => {
    if (!object(piece) || Object.keys(piece).sort().join(",") !== "documentId,id,length,offset,part,projectId,total" || typeof piece.id !== "string"
      || !integer(piece.total) || !integer(piece.offset, 1) || !integer(piece.length) || piece.length > 16000 || typeof piece.part !== "string") return false;
    const body = i.observedBodies!.get(piece.id); if (!body || piece.projectId !== body.projectId || piece.documentId !== body.documentId) return false;
    const characters = Array.from(body.raw), offset = piece.offset - 1;
    return piece.total === characters.length && offset % 16000 === 0 && offset <= characters.length
      && piece.length === Math.min(16000, characters.length - offset) && piece.part === characters.slice(offset, offset + piece.length).join("")
      && (piece.length > 0 || characters.length === 0 && offset === 0);
  });
}

export type NativePredicateDescriptor = { kind: "authority" | "head" | "created-event" | "empty-requirement" | "captured"; eventId?: string; readOnlyAuthority?: boolean };
export function recognizeNativePredicate(sql: string, b: readonly unknown[], i: ConfirmationMutationIdentity): NativePredicateDescriptor | null {
  if (!identityValid(i)) return null;
  if (sql === PERSONAL_AUTHORITY && b.length === 7 && (b[4] === 0 || b[4] === 1)
    && equalValues(b, [i.owner, i.owner, i.owner, POLICY_VERSION, b[4], i.owner, i.projectId]))
    return { kind: "authority", readOnlyAuthority: b[4] === 1 };
  if (sql === OWNER_HEAD && b.length === 2 && b[0] === i.stream && integer(b[1])
    && (i.expectedHead === undefined || b[1] === i.expectedHead)) return { kind: "head" };
  if (sql === CREATED_EVENT && b.length === 3 && uuid(b[0]) && b[1] === i.owner && b[2] === i.documentId)
    return { kind: "created-event", eventId: b[0] };
  if (sql === EMPTY_REQUIREMENT && equalValues(b, [i.stream, i.requirementId])) return { kind: "empty-requirement" };
  // This authenticates each complete native chunk predicate; it does not replace
  // the caller's requirement to preserve EVERY predicate the native core emitted.
  if (sql === RETAINED_BODY && retainedBodyBindings(b, i)) return { kind: "captured" };
  if (i.knownAssertions.some(proof => proof.sql === sql && equalValues(proof.bindings ?? [], b))) return { kind: "captured" };
  return null;
}

/** Exact SELECT generated by outputProofReadStatements. No generic scalar SQL. */
export function recognizeNativeScalarAssertion(sql: string, b: readonly unknown[], i: ConfirmationMutationIdentity) {
  const candidates = [PERSONAL_AUTHORITY, OWNER_HEAD, CREATED_EVENT, EMPTY_REQUIREMENT, RETAINED_BODY, ...i.knownAssertions.map(p => p.sql)];
  for (const predicate of candidates) {
    if (sql !== `SELECT CASE WHEN (${predicate}) THEN 1 ELSE 0 END AS current`) continue;
    const proof = recognizeNativePredicate(predicate, b, i);
    if (proof) return { kind: "scalar-assertion" as const, columns: ["current"] as const, proof };
  }
  return null;
}

/** Predicate-only helper for the main finite read adapter. */
export function validateAssertion(sql: string, bindings: readonly unknown[], identity: ConfirmationMutationIdentity): boolean {
  return recognizeNativePredicate(sql, bindings, identity) !== null;
}

const EVENT_INSERT = `INSERT INTO event_write_stage(${EVENT_WRITE_COLUMNS}) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
const ASSERTION_DELETE = "DELETE FROM output_atomic_assertions WHERE token=?";
const COMMAND_INSERT = "INSERT INTO output_commands(scope_key,actor_user_id,command_key,request_digest,action,event_id,created_at) VALUES(?,?,?,?,?,?,?)";
const PLAN_INSERT = `INSERT INTO output_plan_revisions(scope_key,scope_kind,owner_user_id,project_id,document_id,organization_id,project_access_id,plan_revision_id,plan_id,revision,confirmed_event_id,requirements_digest,source_digest,resolver_version,source_head,target_count,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
const TARGET_INSERT = "INSERT INTO output_plan_targets(scope_key,plan_revision_id,target_id,target_contract_digest,media_kind,required,selected,ordinal) VALUES(?,?,?,?,?,?,?,?)";

export type NativeMutationDescriptor =
  | { kind: "assertion-insert"; token: string; proof: NativePredicateDescriptor }
  | { kind: "assertion-delete"; token: string }
  | { kind: "event"; eventId: string; phase: "save" | "confirm"; commandKey: string; sequence: number; occurredAt: string; payload: Record<string, unknown> }
  | { kind: "command"; eventId: string; phase: "save" | "confirm"; commandKey: string; requestDigest: string; createdAt: string }
  | { kind: "plan"; eventId: string; revisionId: string; revision: number; sourceHead: number; sourceDigest: string; requirementsDigest: string; createdAt: string }
  | { kind: "target"; revisionId: string; targetId: string; contractDigest: string };

export function recognizeNativeMutation(sql: string, b: readonly unknown[], i: ConfirmationMutationIdentity): NativeMutationDescriptor | null {
  if (!identityValid(i)) return null;
  if (sql === ASSERTION_DELETE) return b.length === 1 && uuid(b[0]) ? { kind: "assertion-delete", token: b[0] } : null;
  // Construct every accepted complete CASE statement from a finite predicate.
  // Preserve it verbatim at execution: CASE false/NULL must insert 0 and fail CHECK.
  const predicates = [PERSONAL_AUTHORITY, OWNER_HEAD, CREATED_EVENT, EMPTY_REQUIREMENT, RETAINED_BODY, ...i.knownAssertions.map(p => p.sql)];
  for (const predicate of predicates) {
    if (sql !== `INSERT INTO output_atomic_assertions(token,passed) VALUES(?,CASE WHEN (${predicate}) THEN 1 ELSE 0 END)`) continue;
    const proof = recognizeNativePredicate(predicate, b.slice(1), i);
    return uuid(b[0]) && proof && !(proof.kind === "authority" && proof.readOnlyAuthority)
      ? { kind: "assertion-insert", token: b[0], proof } : null;
  }
  if (sql === EVENT_INSERT) {
    const phase = phaseForKey(b[7], i), payload = parsed(b[16]);
    if (b.length !== 17 || !uuid(b[0]) || b[1] !== i.stream || !integer(b[2], 1) || !iso(b[3]) || b[4] !== b[3]
      || b[5] !== `user:${i.owner}` || b[6] !== "server:output-requirements" || !phase || b[8] !== null || b[9] !== null
      || b[10] !== 1 || b[11] !== (phase === "save" ? "BlockCreated" : "OutputPlanConfirmed")
      || b[13] !== i.owner || b[14] !== i.projectId || b[15] !== i.documentId || !payload
      || payload.project_id !== i.projectId || payload.document_id !== i.documentId || payload.actor_user_id !== i.owner
      || i.expectedHead !== undefined && b[2] !== i.expectedHead + 1) return null;
    const envelope = payload.output_command_envelope;
    if (!object(envelope) || envelope.action !== phase || envelope.documentId !== i.documentId || envelope.clientMutationId !== b[7]
      || envelope.expectedRevision !== `output:${b[2] - 1}` || !object(envelope.experienceBinding)
      || envelope.experienceBinding.output !== "image" || envelope.experienceBinding.documentId !== i.documentId
      || envelope.experienceBinding.projectId !== i.projectId || envelope.experienceBinding.streamId !== i.stream) return null;
    if (phase === "save" && (payload.block_id !== i.requirementId || payload.type !== "output" || payload.scope !== "document"
      || payload.position !== `z-output-${i.requirementId}` || payload.handle !== `output/${i.requirementId}`
      || !object(payload.properties) || payload.properties.authority !== "authored" || !object(payload.properties.output_spec)
      || payload.properties.output_spec.id !== i.requirementId || envelope.blockId !== i.requirementId)) return null;
    if (phase === "confirm") {
      const plan = payload.confirmed_plan;
      if (!object(plan) || !uuid(payload.plan_revision_id) || plan.id !== i.documentId || plan.revisionId !== payload.plan_revision_id
        || !integer(plan.revision, 1) || !iso(plan.confirmedAt) || !digest(plan.requirementsDigest) || !digest(plan.sourceDigest)
        || !object(plan.plan) || !Array.isArray(plan.plan.targets) || plan.plan.targets.length !== 1 || !object(plan.plan.targets[0])
        || plan.plan.targets[0].id !== i.targetId || plan.plan.targets[0].media_kind !== "image" || plan.plan.targets[0].required !== true
        || plan.plan.targets[0].selected !== true || !object(plan.targetContractDigests) || !digest(plan.targetContractDigests[i.targetId])) return null;
    }
    const event: EventRow = { eventId: b[0], streamId: i.stream, sequence: b[2], occurredAt: b[3], recordedAt: b[3], actor: `user:${i.owner}`,
      clientId: "server:output-requirements", correlationId: String(b[7]), causationId: null, compensatesEventId: null,
      schemaVersion: 1, type: String(b[11]), payload };
    // Reuse the real privacy splitter; do not reimplement safe-field policy.
    if (!equalValues(eventWriteBindings(event), b)) return null;
    return { kind: "event", eventId: b[0], phase, commandKey: String(b[7]), sequence: b[2], occurredAt: b[3], payload };
  }
  if (sql === COMMAND_INSERT) {
    const phase = phaseForKey(b[2], i);
    return b.length === 7 && b[0] === i.scopeKey && b[1] === i.owner && phase && b[4] === phase && digest(b[3]) && uuid(b[5]) && iso(b[6])
      ? { kind: "command", commandKey: String(b[2]), requestDigest: b[3], phase, eventId: b[5], createdAt: b[6] } : null;
  }
  if (sql === PLAN_INSERT) {
    return b.length === 17 && equalValues(b.slice(0, 7), [i.scopeKey, "personal", i.owner, i.projectId, i.documentId, null, null])
      && uuid(b[7]) && b[8] === i.documentId && integer(b[9], 1) && uuid(b[10]) && digest(b[11]) && digest(b[12])
      && b[13] === "output-plan-v1" && integer(b[14]) && b[15] === 1 && iso(b[16]) && (i.expectedHead === undefined || b[14] === i.expectedHead)
      ? { kind: "plan", revisionId: b[7], revision: b[9], eventId: b[10], requirementsDigest: b[11], sourceDigest: b[12], sourceHead: b[14], createdAt: b[16] } : null;
  }
  if (sql === TARGET_INSERT) {
    return b.length === 8 && b[0] === i.scopeKey && uuid(b[1]) && b[2] === i.targetId && digest(b[3]) && equalValues(b.slice(4), ["image", 1, 1, 0])
      ? { kind: "target", revisionId: b[1], targetId: i.targetId, contractDigest: b[3] } : null;
  }
  return null;
}

/** Call after describing the complete batch, before executing ANY statement.
 * This accepts the exact first-save/one-Image-confirm grammar; historical saves
 * use the native receipt path. It intentionally rejects native requirement edits. */
export function nativeConfirmationBatchMatches(rows: readonly NativeMutationDescriptor[]): boolean {
  const units: NativeMutationDescriptor[] = [], tokens = new Set<string>();
  for (let n = 0; n < rows.length; n++) {
    const row = rows[n];
    if (row.kind === "assertion-insert") {
      const next = rows[++n];
      if (!next || next.kind !== "assertion-delete" || next.token !== row.token || tokens.has(row.token)) return false;
      tokens.add(row.token); units.push(row);
    } else if (row.kind === "assertion-delete") return false;
    else units.push(row);
  }
  const first = units[0], second = units[1];
  if (first?.kind !== "assertion-insert" || first.proof.kind !== "authority" || first.proof.readOnlyAuthority
    || second?.kind !== "assertion-insert" || second.proof.kind !== "head") return false;
  const at = units.findIndex(row => row.kind === "event");
  if (at < 2 || units.slice(0, at).some(row => row.kind !== "assertion-insert" || row.proof.kind === "created-event")) return false;
  const event = units[at], after = units[at + 1];
  if (event.kind !== "event" || after?.kind !== "assertion-insert" || after.proof.kind !== "created-event" || after.proof.eventId !== event.eventId) return false;
  const tail = units.slice(at + 2), command = tail.at(-1);
  if (command?.kind !== "command" || command.eventId !== event.eventId || command.commandKey !== event.commandKey || command.phase !== event.phase) return false;
  if (event.phase === "save") return tail.length === 1 && units.slice(0, at).some(row => row.kind === "assertion-insert" && row.proof.kind === "empty-requirement");
  const revision = tail[0], target = tail[1], plan = event.payload.confirmed_plan;
  return tail.length === 3 && revision?.kind === "plan" && target?.kind === "target" && object(plan) && object(plan.targetContractDigests)
    && revision.eventId === event.eventId && revision.revisionId === target.revisionId && revision.revisionId === plan.revisionId
    && revision.revision === plan.revision && revision.sourceHead === event.sequence - 1 && revision.sourceDigest === plan.sourceDigest
    && revision.requirementsDigest === plan.requirementsDigest && revision.createdAt === plan.confirmedAt
    && target.contractDigest === plan.targetContractDigests[target.targetId];
}

const COMMAND_READ = `SELECT command.action,command.event_id,command.request_digest,command.created_at,body.private_json,
      event.stream_id,event.actor,event.client_id,event.correlation_id,
      json_extract(event.payload,'$.project_id') AS project_id,json_extract(event.payload,'$.document_id') AS document_id
    FROM output_commands command JOIN events event ON event.event_id=command.event_id
    LEFT JOIN event_private_payloads body ON body.private_event_id=command.event_id
      AND body.owner_id=? AND body.project_id=? AND body.document_id=? AND body.redacted_at IS NULL
    WHERE command.scope_key=? AND command.actor_user_id=? AND command.command_key=?`;
export function recognizeNativeCommandRead(sql: string, b: readonly unknown[], i: ConfirmationMutationIdentity) {
  if (!identityValid(i) || sql !== COMMAND_READ || b.length !== 6 || !phaseForKey(b[5], i)
    || !equalValues(b.slice(0, 5), [i.owner, i.projectId, i.documentId, i.scopeKey, i.owner])) return null;
  return { kind: "command-receipt" as const, maximumRows: 1,
    columns: ["action", "event_id", "request_digest", "created_at", "private_json", "stream_id", "actor", "client_id", "correlation_id", "project_id", "document_id"] as const };
}
