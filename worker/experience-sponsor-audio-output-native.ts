import { canonicalJson, digest, exactKeys, freeze, record } from "../src/experiences/compiler.ts";
import { buildExperiencePlan, receiptPrefix, type ExperiencePlan } from "../src/experiences/intake.ts";
import { projectIntakeValue, type ProjectIntake } from "../src/model/project-intake.ts";
import { readDraft, retainedGuard } from "./experience-intake-read.ts";
import { serializeEvent } from "./event-read-primitives.ts";
import { intakeGuard, projectIntakeAuthority, type AtomicIntakeOptions, type ProjectIntakeAuthorization } from "./intake-authority.ts";
import { SPONSOR_INTAKE_SCHEMA } from "./experience-sponsor-intake.ts";
import { SPONSOR_STORY_INTAKE_STORAGE_SCHEMA } from "./experience-sponsor-story-intake-resources.ts";
import { closeSponsorAudioOutputReads, requireSponsorAudioOutputReads, retainSponsorAudioOutputProofs, setSponsorAudioOutputNativePlan,
  type SponsorAudioOutputReadOwner, type SponsorAudioOutputRows } from "./experience-sponsor-audio-output-reads.ts";
import { SponsorEntitlementError } from "./experience-sponsor-policy.ts";
import type { BudgetReservationGuard } from "./pilot-policy.ts";
import type { OutputSqlAssertion } from "./output-command-core.ts";
import type { WorkerEnv } from "./runtime.ts";

type Binding = string | number | null;
type Proof = Readonly<{ sql: string; bindings?: readonly Binding[]; deadlineMs?: number }>;
type Row = Record<string, unknown>;
type Saved = NonNullable<Awaited<ReturnType<typeof readDraft>>>;
type View = ReturnType<typeof requireSponsorAudioOutputReads>;
type State = { saved?: Saved; proofs: OutputSqlAssertion[]; reading: boolean; receiptReading: boolean;
  receiptComplete: boolean; receiptJson?: string; negatives?: OutputSqlAssertion[] };
const states = new WeakMap<SponsorAudioOutputReadOwner, State>();
declare const nativeReadBrand: unique symbol;
export type SponsorAudioOutputNativeRead = Readonly<{ [nativeReadBrand]: true }>;
const nativeReads = new WeakMap<SponsorAudioOutputNativeRead, { owner: SponsorAudioOutputReadOwner; descriptor: SponsorAudioOutputRows; used: boolean }>();
const nativeProofs = new WeakMap<object, SponsorAudioOutputReadOwner>();
const fail = (code = "sponsor_audio_output_native_unavailable"): never => { throw new SponsorEntitlementError(code); };
const same = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
const scalar = (value: unknown): value is Binding => value === null || typeof value === "string" || typeof value === "number" && Number.isFinite(value);
const copy = (value: Proof): OutputSqlAssertion =>
  freeze({ sql: value.sql, bindings: [...value.bindings ?? []], ...(value.deadlineMs === undefined ? {} : { deadlineMs: value.deadlineMs }) });
const distinct = (proofs: readonly OutputSqlAssertion[]) => proofs.filter((proof, index) => !proofs.slice(0, index).some(other =>
  proof.sql === other.sql && proof.deadlineMs === other.deadlineMs && same(proof.bindings ?? [], other.bindings ?? [])));
const join = (proofs: readonly { sql: string; bindings?: readonly Binding[] }[]): BudgetReservationGuard => ({
  sql: proofs.map(proof => `(${proof.sql})`).join(" AND "), bindings: proofs.flatMap(proof => [...proof.bindings ?? []]),
});

/** Observe only plain own data. Caller-created intake/options cannot invoke a
 * getter or toJSON while being bound to an otherwise genuine native owner. */
function ownData(value: unknown, active = new Set<object>()): void {
  if (scalar(value) || typeof value === "boolean") return;
  if (!value || typeof value !== "object" || active.has(value)) return fail();
  const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return fail();
  const keys = Reflect.ownKeys(value), descriptors = Object.getOwnPropertyDescriptors(value);
  if (keys.some(key => typeof key !== "string")) return fail();
  if (array && (!Number.isSafeInteger(descriptors.length?.value) || keys.length !== descriptors.length.value + 1)) return fail();
  active.add(value);
  for (const key of keys) {
    if (array && key === "length") continue;
    const descriptor = descriptors[String(key)];
    if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable
      || array && (!/^(0|[1-9][0-9]*)$/u.test(String(key)) || Number(key) >= descriptors.length!.value)) return fail();
    ownData(descriptor.value, active);
  }
  active.delete(value);
  // Always visit children, including beneath a caller-prefrozen parent.
  Object.freeze(value);
}
function state(owner: SponsorAudioOutputReadOwner, request?: Request, env?: WorkerEnv) {
  const view = requireSponsorAudioOutputReads(owner, request, env);
  if (!["audio-output-state", "audio-output-prepare"].includes(view.operation)) return fail();
  let native = states.get(owner);
  if (!native) { native = { proofs: [], reading: false, receiptReading: false, receiptComplete: false }; states.set(owner, native); }
  view.current(); return { view, native };
}
/** Only this module's closed native paths issue transport descriptors. The
 * exported consumer cannot manufacture, clone, change or reuse a read token. */
async function nativeRead<T extends Row>(owner: SponsorAudioOutputReadOwner, view: View, input: SponsorAudioOutputRows): Promise<{ result: D1Result<T>; witness: OutputSqlAssertion }> {
  view.current();
  const descriptor: SponsorAudioOutputRows = { sql: input.sql, bindings: [...input.bindings], columns: [...input.columns],
    maximumRows: input.maximumRows, assertions: (input.assertions ?? []).map(copy), invalidRow: input.invalidRow };
  ownData(descriptor);
  const token = Object.freeze({}) as SponsorAudioOutputNativeRead;
  nativeReads.set(token, { owner, descriptor, used: false });
  const result = await view.readRows<T>(token);
  view.current(); return result;
}
export function takeSponsorAudioOutputNativeRead(token: SponsorAudioOutputNativeRead, owner: SponsorAudioOutputReadOwner): SponsorAudioOutputRows {
  const sealed = nativeReads.get(token);
  if (!sealed || sealed.owner !== owner || sealed.used) return fail();
  state(owner).view.current(); sealed.used = true;
  return sealed.descriptor;
}
/** Identity only: an equal SQL string or a spread/copied assertion is not a
 * native proof. The read owner separately checks its own current lifetime. */
export function isSponsorAudioOutputNativeProof(owner: SponsorAudioOutputReadOwner, proof: unknown): proof is OutputSqlAssertion {
  return proof !== null && typeof proof === "object" && nativeProofs.get(proof) === owner;
}
/** Only the original, fully validated native observation can initialize the
 * general descriptor identity. A canonical-equal caller clone has no custody. */
export function isSponsorAudioOutputNativePlan(owner: SponsorAudioOutputReadOwner, plan: unknown): plan is ExperiencePlan {
  return plan !== null && typeof plan === "object" && states.get(owner)?.saved?.plan === plan;
}
function retain(owner: SponsorAudioOutputReadOwner, native: State, proofs: readonly Proof[]) {
  const captured = proofs.map(copy);
  for (const proof of captured) nativeProofs.set(proof, owner);
  native.proofs = distinct([...native.proofs, ...captured]);
  retainSponsorAudioOutputProofs(owner, captured);
}

// These are negative, current schema/association predicates, not Story/Image
// capabilities. The Audio A paired receipt/schema proofs come from the C owner.
const storyTables = ["experience_sponsor_story_intake_allocations", "experience_sponsor_story_intakes"] as const;
const storyObjects = SPONSOR_STORY_INTAKE_STORAGE_SCHEMA.map(sql => {
  const declaration = /^CREATE (TABLE|INDEX|TRIGGER) ([a-z0-9_]+)/u.exec(sql)!;
  return [declaration[1]!.toLowerCase(), declaration[2]!, sql];
}).sort((a, b) => a[1]! < b[1]! ? -1 : a[1]! > b[1]! ? 1 : 0);
const storySnapshot = JSON.stringify(storyObjects);
const storySchemaQuery = `WITH selected AS MATERIALIZED (
    SELECT type,name,sql FROM main.sqlite_schema WHERE tbl_name IN('${storyTables[0]}','${storyTables[1]}') AND sql IS NOT NULL
    ORDER BY name COLLATE BINARY LIMIT ${storyObjects.length + 1}), packed AS (
    SELECT COUNT(*) AS total,json_group_array(json_array(type,name,sql)) AS snapshot FROM selected)
  SELECT total,CASE WHEN total<=${storyObjects.length} AND length(CAST(snapshot AS BLOB))<=65536 THEN snapshot END AS snapshot FROM packed`;
// Preserve the native classifier's indexed private-content lookup qualification.
// A row/byte cap alone does not make a view or a nonindexed schema acceptable.
const privateShape = `EXISTS(SELECT 1 FROM pragma_table_list('private_content') WHERE schema='main' AND name='private_content' AND type='table' AND wr=0 AND ncol BETWEEN 1 AND 64)
  AND (SELECT COUNT(*) FROM pragma_table_xinfo('private_content','main')) BETWEEN 1 AND 64
  AND EXISTS(SELECT 1 FROM pragma_table_xinfo('private_content','main') WHERE name='content_id' AND upper(type)='TEXT' AND "notnull"=1 AND pk=1 AND hidden=0)
  AND (SELECT COUNT(*) FROM pragma_table_xinfo('private_content','main') WHERE pk<>0)=1
  AND (SELECT COUNT(*) FROM pragma_index_list('private_content','main')) BETWEEN 1 AND 32
  AND EXISTS(SELECT 1 FROM pragma_index_list('private_content','main') idx WHERE idx.origin='pk' AND idx."unique"=1 AND idx.partial=0
    AND (SELECT COUNT(*) FROM pragma_index_xinfo(idx.name,'main') WHERE "key"=1)=1
    AND EXISTS(SELECT 1 FROM pragma_index_xinfo(idx.name,'main') WHERE "key"=1 AND name='content_id' AND cid>=0 AND "desc"=0 AND coll='BINARY'))
  AND EXISTS(SELECT 1 FROM pragma_table_xinfo('private_content','main') WHERE name='content' AND upper(type)='TEXT' AND "notnull"=1 AND hidden=0)`;
const privateSchemaQuery = `WITH objects AS MATERIALIZED (
    SELECT type,name,tbl_name,sql FROM main.sqlite_schema WHERE lower(name)='private_content' OR lower(tbl_name)='private_content'
    ORDER BY type COLLATE BINARY,name COLLATE BINARY LIMIT 65), packed AS (
    SELECT COUNT(*) AS total,COALESCE(SUM(CASE WHEN typeof(type)='text' AND length(CAST(type AS BLOB))<=16
      AND typeof(name)='text' AND length(CAST(name AS BLOB))<=200 AND typeof(tbl_name)='text' AND length(CAST(tbl_name AS BLOB))<=200
      AND (sql IS NULL OR typeof(sql)='text' AND length(CAST(sql AS BLOB))<=32768) THEN 0 ELSE 1 END),0) AS invalid,
      json_group_array(json_object('type',type,'name',name,'table',tbl_name,'sql',sql)) AS snapshot FROM objects)
  SELECT CASE WHEN total BETWEEN 1 AND 64 AND invalid=0 AND length(CAST(snapshot AS BLOB))<=65536 THEN snapshot END AS snapshot FROM packed`;
async function negativeAssociations(owner: SponsorAudioOutputReadOwner, view: View): Promise<OutputSqlAssertion[]> {
  const expected = SPONSOR_INTAKE_SCHEMA[1]!;
  const image = await nativeRead<{ type: string; name: string; sql: string | null }>(owner, view, {
    sql: `SELECT type,name,CASE WHEN typeof(sql)='text' AND length(CAST(sql AS BLOB))<=32768 THEN sql END AS sql
    FROM main.sqlite_schema WHERE lower(name)='experience_sponsor_intakes' LIMIT 2`, bindings: [], columns: ["type", "name", "sql"], maximumRows: 1, assertions: [],
    invalidRow: "typeof(row.type)<>'text' OR length(CAST(row.type AS BLOB))>16 OR typeof(row.name)<>'text' OR length(CAST(row.name AS BLOB))>200 OR typeof(row.sql)<>'text' OR length(CAST(row.sql AS BLOB))>32768",
  });
  view.current();
  const rows = image.result.results;
  let imageProof: OutputSqlAssertion;
  if (!rows.length) imageProof = { sql: "NOT EXISTS(SELECT 1 FROM main.sqlite_schema WHERE lower(name)='experience_sponsor_intakes')", bindings: [] };
  else {
    const row = rows[0];
    if (rows.length !== 1 || !row || row.type !== "table" || row.name !== "experience_sponsor_intakes" || row.sql !== expected) return fail();
    imageProof = { sql: `EXISTS(SELECT 1 FROM main.sqlite_schema WHERE name='experience_sponsor_intakes' AND type='table' AND sql=?)
      AND NOT EXISTS(SELECT 1 FROM main.experience_sponsor_intakes WHERE draft_id=?)`, bindings: [expected, view.draftId] };
  }
  const story = await nativeRead<{ total: number; snapshot: string | null }>(owner, view, {
    sql: storySchemaQuery, bindings: [], columns: ["total", "snapshot"], maximumRows: 1, assertions: [],
    invalidRow: `typeof(row.total)<>'integer' OR row.total NOT BETWEEN 0 AND ${storyObjects.length} OR typeof(row.snapshot)<>'text' OR length(CAST(row.snapshot AS BLOB))>65536`,
  });
  view.current();
  const row = story.result.results[0];
  if (story.result.results.length !== 1 || !row) return fail();
  let storyProof: OutputSqlAssertion;
  if (row.total === 0 && row.snapshot === "[]") storyProof = {
    // Like the native classifier, an orphan declaration anywhere in the Story
    // intake namespace cannot make an absent storage pair look ordinary.
    sql: "NOT EXISTS(SELECT 1 FROM main.sqlite_schema WHERE lower(name) GLOB 'experience_sponsor_story_intake*' OR lower(tbl_name) IN(?,?))", bindings: [...storyTables],
  };
  else {
    if (row.total !== storyObjects.length || row.snapshot !== storySnapshot) return fail();
    storyProof = { sql: `EXISTS(SELECT 1 FROM (${storySchemaQuery}) WHERE total=? AND snapshot=?)
      AND NOT EXISTS(SELECT 1 FROM main.experience_sponsor_story_intakes WHERE draft_id COLLATE BINARY=?)
      AND NOT EXISTS(SELECT 1 FROM main.experience_sponsor_story_intake_allocations WHERE draft_id COLLATE BINARY=?)`,
    bindings: [storyObjects.length, storySnapshot, view.draftId, view.draftId] };
  }
  const privateSchema = await nativeRead<{ snapshot: string | null; supported: number }>(owner, view, {
    sql: `SELECT snapshot,CASE WHEN (${privateShape}) THEN 1 ELSE 0 END AS supported FROM (${privateSchemaQuery})`,
    bindings: [], columns: ["snapshot", "supported"], maximumRows: 1, assertions: [],
    invalidRow: "typeof(row.snapshot)<>'text' OR length(CAST(row.snapshot AS BLOB))>65536 OR typeof(row.supported)<>'integer' OR row.supported<>1",
  });
  view.current(); const privateRow = privateSchema.result.results[0];
  if (privateSchema.result.results.length !== 1 || !privateRow || typeof privateRow.snapshot !== "string" || privateRow.supported !== 1) return fail();
  const privateProof: OutputSqlAssertion = { sql: `EXISTS(SELECT 1 FROM (${privateSchemaQuery}) WHERE snapshot=?) AND (${privateShape})`, bindings: [privateRow.snapshot] };
  // A positive Audio label alone provides no current negative-family proof.
  const proofs = [copy(imageProof), copy(storyProof), copy(privateProof)];
  const current = await nativeRead<{ current: number }>(owner, view, { sql: "SELECT 1 AS current", bindings: [], columns: ["current"], maximumRows: 1, assertions: proofs,
    invalidRow: "typeof(row.current)<>'integer' OR row.current<>1" });
  view.current(); if (current.result.results[0]?.current !== 1) return fail();
  return proofs;
}

function readOnlyStatement(execute: (bindings: readonly unknown[]) => Promise<unknown>, bindings: readonly unknown[] = []): D1PreparedStatement {
  return { bind: (...values: unknown[]) => readOnlyStatement(execute, values), first: (column?: string) => column === undefined ? execute(bindings) : fail(),
    all: () => fail(), run: () => fail(), raw: () => fail() } as D1PreparedStatement;
}

/** Reenter the actual native two-read draft loader. The C ticket supplies only
 * finite IO; this owner adds actual original bytes, family and current custody. */
export async function readSponsorAudioOutputNativeDraft(owner: SponsorAudioOutputReadOwner, request: Request, env: WorkerEnv): Promise<Saved> {
  const { view, native } = state(owner, request, env);
  if (env !== view.nativeEnv || native.reading || native.receiptReading) return fail();
  native.reading = true;
  try {
    if (!native.negatives) {
      native.negatives = await negativeAssociations(owner, view); view.current();
      retain(owner, native, native.negatives);
    }
    const auth = view.auth, original = view.original;
    const expiry: OutputSqlAssertion = { sql: "? > strftime('%Y-%m-%dT%H:%M:%fZ','now')", bindings: [original.expiresAt], deadlineMs: Date.parse(original.expiresAt) };
    if (!Number.isSafeInteger(expiry.deadlineMs) || original.draftId !== view.draftId || original.actorUserId !== auth.user.userId) return fail();
    const additional = join([...native.negatives, expiry]);
    // The unchanged native query owns the complete original base predicate.
    // Gate it separately from the bounded data projection and retain it beside
    // the observed row witness, so later reads keep exactly the same authority.
    const base = projectIntakeAuthority(env, auth, { projectId: "", documentId: "" });
    let calls = 0, content: string | undefined, witness: OutputSqlAssertion | undefined, currentProof: BudgetReservationGuard | undefined;
    const database = Object.freeze({ prepare(sql: string) {
      view.current();
      return readOnlyStatement(async bindings => {
        view.current(); if (calls >= 2) return fail();
        if (calls++ === 0) {
          const data = `SELECT content,expires_at FROM private_content WHERE content_id=? AND owner_id=? AND kind='experience-draft'
    AND redacted_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')`;
          if (sql !== `${data} AND (${base.sql}) AND (${additional.sql})` || !same(bindings, [view.draftId, auth.user.userId, ...base.bindings, ...additional.bindings])) return fail();
          const found = await nativeRead<{ content: string; expires_at: string }>(owner, view, {
            sql: `${data} AND typeof(content)='text' AND length(CAST(content AS BLOB)) BETWEEN 1 AND 65536 AND expires_at=?`,
            bindings: [view.draftId, auth.user.userId, original.expiresAt], columns: ["content", "expires_at"], maximumRows: 1, assertions: [base, additional],
            invalidRow: "typeof(row.content)<>'text' OR length(CAST(row.content AS BLOB)) NOT BETWEEN 1 AND 65536 OR typeof(row.expires_at)<>'text' OR length(CAST(row.expires_at AS BLOB))<>24",
          });
          view.current(); const row = found.result.results[0];
          if (found.result.results.length !== 1 || !row || typeof row.content !== "string" || !row.content || !row.content.isWellFormed()
            || bytes(row.content) > 65536 || row.expires_at !== original.expiresAt) return fail();
          if (native.saved && (row.content !== native.saved.content || row.expires_at !== native.saved.expiresAt)) return fail("sponsor_audio_output_original_changed");
          content = row.content; witness = copy(found.witness); return row;
        }
        if (content === undefined) return fail();
        const plan = JSON.parse(content) as ExperiencePlan;
        const core = join([projectIntakeAuthority(env, auth, plan), retainedGuard(auth, plan, content)]);
        if (sql !== `SELECT 1 AS current WHERE (${core.sql}) AND (${additional.sql})` || !same(bindings, [...core.bindings, ...additional.bindings])) return fail();
        const found = await nativeRead<{ current: number }>(owner, view, { sql: "SELECT 1 AS current", bindings: [], columns: ["current"], maximumRows: 1, assertions: [core, additional],
          invalidRow: "typeof(row.current)<>'integer' OR row.current<>1" });
        view.current(); if (found.result.results.length !== 1 || found.result.results[0]?.current !== 1) return fail();
        currentProof = core; return found.result.results[0];
      });
    }, batch: () => fail(), exec: () => fail() }) as unknown as WorkerEnv["DB"];
    const saved = await view.wait(() => readDraft({ ...env, DB: database }, auth, view.draftId, additional));
    view.current(); if (!saved || calls !== 2 || !witness || !currentProof) return fail();
    ownData(saved);
    const plan = saved.plan, marker = (plan as unknown as Row).sponsor_intake;
    if (!record(marker) || !exactKeys(marker, ["version", "family", "receiptId"]) || marker.version !== 1
      || marker.family !== "canonical-audio-initial-intake@1" || marker.receiptId !== original.receiptId
      || plan.request.experienceId !== "audio" || plan.release.output.output !== "audio" || ![5, 6].includes(plan.events.length)
      || Object.hasOwn(plan, "reference") || Object.hasOwn(plan.request, "reference")) return fail();
    const rebuilt = await view.wait(() => buildExperiencePlan(auth.user.userId, plan.request, plan.release));
    view.current();
    const { draftHash: _unmarkedHash, ...unmarked } = rebuilt;
    const marked = JSON.parse(canonicalJson({ ...unmarked, sponsor_intake: marker }));
    const expected = { ...marked, draftHash: await view.wait(() => digest(marked)) };
    view.current();
    if (canonicalJson(plan) !== canonicalJson(expected) || saved.content !== canonicalJson(plan)) return fail();
    const payloads = plan.events.map(event => JSON.stringify(event.payload));
    const [contentDigest, sourceDigest, payloadDigest] = await view.wait(() => Promise.all([digest(saved.content), digest(plan.events), digest(payloads)]));
    view.current();
    if (original.projectId !== plan.projectId || original.documentId !== plan.documentId || original.draftId !== plan.draftId
      || original.draftHash !== plan.draftHash || original.nativeIntentId !== plan.request.intentId || original.expiresAt !== saved.expiresAt
      || original.contentDigest !== contentDigest || original.sourceDigest !== sourceDigest || original.eventPayloadDigest !== payloadDigest
      || original.eventCount !== plan.events.length || original.draftBytes !== bytes(saved.content)
      || original.eventBytes !== payloads.reduce((total, payload) => total + bytes(payload), 0) || original.totalBytes !== original.draftBytes + original.eventBytes) return fail();
    freeze(saved);
    if (!native.saved) { native.saved = saved; setSponsorAudioOutputNativePlan(owner, native.saved.plan); }
    retain(owner, native, [base, currentProof, expiry, witness]);
    view.current(); return saved;
  } catch (error) { closeSponsorAudioOutputReads(owner); throw error; }
  finally { native.reading = false; }
}

declare const receiptBrand: unique symbol;
export type SponsorAudioOutputNativeReceiptCheck = Readonly<{ [receiptBrand]: true }>;
type ReceiptSeal = { owner: SponsorAudioOutputReadOwner; env: WorkerEnv; db: WorkerEnv["DB"]; request: Request;
  auth: ProjectIntakeAuthorization; intake: ProjectIntake; options: AtomicIntakeOptions; intakeJson: string; guard: BudgetReservationGuard; used: boolean };
const receipts = new WeakMap<SponsorAudioOutputNativeReceiptCheck, ReceiptSeal>();
const receiptColumns = ["requested_key", "receipt_key", "event_id", "stream_id", "sequence", "occurred_at", "recorded_at", "actor",
  "client_id", "correlation_id", "causation_id", "compensates_event_id", "schema_version", "type", "payload", "private_json", "receipt_total", "current_head"] as const;
// Keep missing LEFT JOIN fields available to the unchanged native decoder, but
// never transfer BLOBs or unsafe numbers through JSON's coercion. The retained
// original plan itself fits 65536 bytes, bounding every original payload too.
const receiptText = ["receipt_key", "event_id", "stream_id", "occurred_at", "recorded_at", "actor", "client_id", "correlation_id",
  "causation_id", "compensates_event_id", "type", "payload", "private_json"] as const;
const receiptInvalidRow = `CASE WHEN typeof(row.requested_key)='text' AND length(CAST(row.requested_key AS BLOB)) BETWEEN 1 AND 65536
  AND ${receiptText.map(column => `(row.${column} IS NULL OR typeof(row.${column})='text' AND length(CAST(row.${column} AS BLOB))<=65536)`).join(" AND ")}
  AND (row.sequence IS NULL OR typeof(row.sequence)='integer' AND row.sequence BETWEEN 1 AND 9007199254740991)
  AND (row.schema_version IS NULL OR typeof(row.schema_version)='integer' AND row.schema_version BETWEEN 1 AND 9007199254740991)
  AND typeof(row.receipt_total)='integer' AND row.receipt_total BETWEEN 0 AND 9007199254740991
  AND typeof(row.current_head)='integer' AND row.current_head BETWEEN 0 AND 9007199254740991 THEN 0 ELSE 1 END`;
function receiptSource(guard: BudgetReservationGuard, mode: "native" | "bounded" = "native") {
  const projection = mode === "native" ? "event.*,secret.private_json"
    : `${receiptColumns.slice(2, 15).map(column => `event.${column}`).join(",")},secret.private_json`;
  // The bounded variant moves the complete guard into readRows' mandatory
  // assertion input. Both exact relations are emitted from this owned template.
  const qualification = mode === "native" ? `\n    WHERE ${guard.sql}` : "";
  return `SELECT expected.value AS requested_key,receipt.client_event_id AS receipt_key,
      ${projection},
      (SELECT COUNT(*) FROM event_client_receipts counted WHERE counted.stream_id=? AND substr(counted.client_event_id,1,?)=?) AS receipt_total,
      (SELECT COALESCE(MAX(sequence),0) FROM events head WHERE head.stream_id=?) AS current_head
    FROM json_each(?) expected
    LEFT JOIN event_client_receipts receipt ON receipt.stream_id=? AND receipt.client_event_id=expected.value
    LEFT JOIN events event ON event.event_id=receipt.event_id AND event.stream_id=receipt.stream_id AND event.sequence=receipt.sequence
    LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id AND secret.owner_id=? AND secret.redacted_at IS NULL${qualification} ORDER BY CAST(expected.key AS INTEGER)`;
}

/** One actual original read only. No B token, append continuation, root receipt,
 * cleanup hook or storage permission is issued by this seal. */
export function sealSponsorAudioOutputNativeReceiptCheck(owner: SponsorAudioOutputReadOwner, request: Request, env: WorkerEnv,
  auth: ProjectIntakeAuthorization, intake: ProjectIntake, options: AtomicIntakeOptions): AtomicIntakeOptions {
  const { view, native } = state(owner, request, env), saved = native.saved;
  if (env !== view.nativeEnv || auth !== view.auth || !saved || native.reading || native.receiptReading) return fail();
  ownData(intake); ownData(options);
  if (!exactKeys(options, ["receiptPrefix", "clientId", "correlationPrefix", "guard"])
    || options.receiptPrefix !== receiptPrefix(saved.plan.draftId) || options.clientId !== "web:experience-intake"
    || options.correlationPrefix !== "experience-intake:" || canonicalJson(options.guard) !== canonicalJson(retainedGuard(auth, saved.plan, saved.content))
    || canonicalJson(intake) !== canonicalJson({ projectId: saved.plan.projectId, documentId: saved.plan.documentId, events: saved.plan.events })) return fail();
  // readOriginal uses this same object after the asynchronous native read.
  // Preserve its exact closed data graph through decoding and native reply.
  freeze(intake);
  const token = Object.freeze({}) as SponsorAudioOutputNativeReceiptCheck;
  const sealed = freeze({ ...options, guard: { sql: options.guard.sql, bindings: [...options.guard.bindings] }, sponsorAudioOutputReceiptCheck: token });
  receipts.set(token, { owner, request, env, db: env.DB, auth, intake, options: sealed,
    intakeJson: canonicalJson(intake), guard: intakeGuard(env, auth, intake, sealed), used: false });
  view.current(); return sealed;
}

/** The unchanged native readOriginal calls this exact descriptor. Its decoder
 * and reply still own complete/absent/unavailable semantics. */
export async function readSponsorAudioOutputNativeReceiptCheck(token: SponsorAudioOutputNativeReceiptCheck, env: WorkerEnv,
  auth: ProjectIntakeAuthorization, intake: ProjectIntake, options: AtomicIntakeOptions, sql: string, bindings: unknown[]): Promise<D1Result<Row>> {
  const seal = receipts.get(token); if (!seal) return fail();
  const { view, native } = state(seal.owner, seal.request, env);
  if (seal.used || env !== seal.env || env.DB !== seal.db || auth !== seal.auth || auth !== view.auth || intake !== seal.intake
    || options !== seal.options || options.sponsorAudioOutputReceiptCheck !== token || native.reading || native.receiptReading) return fail();
  ownData(intake); ownData(bindings);
  if (canonicalJson(intake) !== seal.intakeJson) return fail();
  const prefix = options.receiptPrefix, stream = auth.user.streamId;
  const vector = [stream, prefix.length, prefix, stream, JSON.stringify(intake.events.map(event => String(event.payload.client_event_id))), stream, auth.user.userId];
  if (sql !== receiptSource(seal.guard) || !same(bindings, [...vector, ...seal.guard.bindings])) return fail();
  seal.used = true; native.receiptReading = true;
  try {
    const data = receiptSource(seal.guard, "bounded");
    const found = await nativeRead<Row>(seal.owner, view, { sql: data, bindings: vector, columns: receiptColumns, maximumRows: intake.events.length, assertions: [seal.guard],
      invalidRow: receiptInvalidRow });
    view.current(); const rows = found.result.results;
    const immutableColumns = receiptColumns.slice(0, -1);
    const immutableJson = JSON.stringify(rows.map(row => immutableColumns.map(column => row[column])));
    if (native.receiptJson !== undefined && immutableJson !== native.receiptJson) return fail("sponsor_audio_output_original_changed");
    let complete = rows.length === intake.events.length;
    const head = rows[0]?.current_head;
    if (!Number.isSafeInteger(head) || Number(head) < 0 || rows.some(row => row.current_head !== head)) complete = false;
    if (complete) for (let index = 0; index < rows.length; index++) {
      const row = rows[index]!, expected = intake.events[index]!;
      if (row.receipt_total !== intake.events.length || row.receipt_key !== expected.payload.client_event_id || row.requested_key !== expected.payload.client_event_id
        || typeof row.private_json !== "string" || row.actor !== "user" || row.type !== expected.type || row.stream_id !== stream) { complete = false; break; }
      try { const event = serializeEvent(row); if (event.compensatesEventId !== null || projectIntakeValue(event.payload) !== projectIntakeValue(expected.payload)) complete = false; }
      catch { complete = false; }
    }
    native.receiptComplete = complete;
    if (complete) {
      // Only the native context owns the current-head witness. Pin every other
      // native receipt field forever within this owner, across actual stage writes.
      const stable: OutputSqlAssertion = { sql: `(SELECT json_group_array(json_array(${immutableColumns.map(column => `row.${column}`).join(",")})) FROM (${data}) row)=?`,
        bindings: [...vector, immutableJson] };
      native.receiptJson ??= immutableJson;
      retain(seal.owner, native, [stable]);
    }
    view.current(); return found.result;
  } catch (error) { closeSponsorAudioOutputReads(seal.owner); throw error; }
  finally { native.receiptReading = false; }
}

/** Only actual observed original bodies/receipts contribute custody. A detached
 * plan, original metadata or C ticket cannot supply these private witnesses. */
export function sponsorAudioOutputNativeProofs(owner: SponsorAudioOutputReadOwner): readonly OutputSqlAssertion[] {
  const { view, native } = state(owner);
  if (!native.saved || !native.receiptComplete || native.reading || native.receiptReading) return fail();
  // Capture only the genuine owner's current immutable assertions through the
  // same private copy-and-brand path; never cast readonly bindings to mutable.
  view.current(); retain(owner, native, view.assertions);
  return freeze(distinct(native.proofs));
}
