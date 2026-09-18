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
import { SponsorEntitlementError, readSponsorAudioPolicy, type SponsorPolicyV8 } from "./experience-sponsor-policy.ts";
import type { BudgetReservationGuard } from "./pilot-policy.ts";
import { outputCommandReceiptAssertion, type OutputSqlAssertion } from "./output-command-core.ts";
import type { WorkerEnv } from "./runtime.ts";
import { PRINCIPAL_WITH_ACCESS_SQL } from "./access-policy.ts";
import { sponsorApprovalAssertion } from "./experience-sponsor-approval.ts";
import { POLICY_VERSION } from "./policy-version.ts";

type Binding = string | number | null;
type Proof = Readonly<{ sql: string; bindings?: readonly Binding[]; deadlineMs?: number }>;
type Row = Record<string, unknown>;
type Saved = NonNullable<Awaited<ReturnType<typeof readDraft>>>;
type View = ReturnType<typeof requireSponsorAudioOutputReads>;
type State = { saved?: Saved; proofs: OutputSqlAssertion[]; reading: boolean; receiptReading: boolean;
  receiptComplete: boolean; receiptJson?: string; negatives?: OutputSqlAssertion[]; later?: LaterState };
const states = new WeakMap<SponsorAudioOutputReadOwner, State>();
declare const nativeReadBrand: unique symbol;
export type SponsorAudioOutputNativeRead = Readonly<{ [nativeReadBrand]: true }>;
const nativeReads = new WeakMap<SponsorAudioOutputNativeRead, { owner: SponsorAudioOutputReadOwner; descriptor: SponsorAudioOutputRows; used: boolean }>();
const nativeProofs = new WeakMap<object, SponsorAudioOutputReadOwner>();
const privateCatalogProofs = new WeakMap<SponsorAudioOutputReadOwner, Proof>();
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
  if (!["audio-output-state", "audio-output-prepare", "audio-output-review", "audio-output-authorize"].includes(view.operation)) return fail();
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
/** Only the actual private-content catalog producer registers this proof after
 * its native current recheck. It confers no body, custody or append authority. */
export function sponsorAudioOutputPrivateCatalogProof(owner: SponsorAudioOutputReadOwner): Proof | undefined {
  state(owner).view.current(); return privateCatalogProofs.get(owner);
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
  if (view.operation === "audio-output-review" || view.operation === "audio-output-authorize") privateCatalogProofs.set(owner, proofs[2]!);
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
    if (!native.later && ["audio-output-review", "audio-output-authorize"].includes(view.operation)) {
      const stable = (await view.wait(() => digest({ family: "canonical-instrumental-cue@1", actorUserId: auth.user.userId, draftId: plan.draftId }))).slice(7);
      const commandKey = `sponsor-audio-authorize-${stable}`;
      const issued = (await view.wait(() => digest({ campaignId: original.campaignId, actorUserId: auth.user.userId, intentKey: commandKey }))).slice(7);
      native.later = { ids: freeze({ driverId: `sponsor-audio-driver-${stable}`, intentKey: `audio-authorize-${stable}`, commandKey,
        grantId: `sponsor-audio-issued-${issued}`, resourceId: `sponsor-audio-resource-issue-${issued}` }), proofs: [] };
    }
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

// Review/authorization add a finite set of native reads to the initial grammar.
// Neither SQL supplied by a caller nor equal-looking source/selection data can
// create one of these descriptors: every binding is selected from the owner,
// its original receipt, or a row already returned through its bounded transport.
type LaterDescriptor = Readonly<{ kind: string; columns: readonly string[]; maximumRows: number; invalidRow: string; assertions?: readonly OutputSqlAssertion[] }>;
type LaterIds = Readonly<{ driverId: string; intentKey: string; commandKey: string; grantId: string; resourceId: string }>;
type LaterState = { ids: LaterIds; proofs: OutputSqlAssertion[]; witnesses?: OutputSqlAssertion[]; principal?: Row; payerPrincipal?: Row; policy?: SponsorPolicyV8; policyDigest?: string; policyJson?: string;
  limitsDigest?: string; approvedAssertions?: OutputSqlAssertion[]; dbClock?: number; intent?: Row; stage?: Row; issuance?: Row; quote?: Row; reviewQuote?: Row; command?: Row; memoryRows?: Record<string, readonly Row[]> };
const instant = "CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";
const laterPrincipalColumns = ["user_id", "role", "consent_version", "updated_at", "permission_epoch", "grants_json", "organizations_json", "projects_json", "identity_policies_json", "approved_canvas_requirements", "email", "display_name", "consented_at"] as const;
const evidencePrincipalColumns = ["user_id", "email", "display_name", "role", "consent_version", "updated_at", "permission_epoch", "grants_json", "organizations_json", "projects_json", "identity_policies_json", "approved_canvas_requirements"] as const;
const intentColumns = ["driver_id", "campaign_id", "actor_user_id", "session_digest", "intent_key", "document_id", "command_json", "command_digest", "source_digest", "requirements_digest", "source_text_bytes"] as const;
const issuanceColumns = ["grant_id", "campaign_id", "actor_user_id", "intent_key", "policy_digest", "driver_command_json", "command_digest", "envelope_digest", "envelope_json"] as const;
const preflightColumns = ["scope_key", "preflight_id", "plan_revision_id", "actor_user_id", "terms_digest", "event_id", "expires_at", "created_at"] as const;
const campaignSql = "SELECT policy_json,policy_digest FROM experience_sponsor_campaigns WHERE campaign_id=? AND enabled=1 AND length(CAST(policy_json AS BLOB))<=131072";
const intentSql = `SELECT ${intentColumns.join(",")} FROM experience_sponsor_driver_intents WHERE driver_id=?`;
const stageSql = "SELECT command_json,command_digest FROM experience_sponsor_driver_stages WHERE driver_id=? AND stage='authorize'";
const issuanceSql = "SELECT * FROM experience_sponsor_issuances WHERE campaign_id=? AND actor_user_id=? AND intent_key=?";
const quoteSql = `SELECT preflight.terms_digest,preflight.expires_at,body.private_json,plan.source_head,plan.plan_revision_id,plan_body.private_json AS plan_json
  FROM output_preflights preflight JOIN output_plan_revisions plan ON plan.scope_key=preflight.scope_key AND plan.plan_revision_id=preflight.plan_revision_id
  JOIN event_private_payloads body ON body.private_event_id=preflight.event_id AND body.owner_id=plan.owner_user_id AND body.project_id=plan.project_id AND body.document_id=plan.document_id AND body.redacted_at IS NULL
  JOIN event_private_payloads plan_body ON plan_body.private_event_id=plan.confirmed_event_id AND plan_body.owner_id=plan.owner_user_id AND plan_body.project_id=plan.project_id AND plan_body.document_id=plan.document_id AND plan_body.redacted_at IS NULL
  WHERE preflight.scope_key=? AND preflight.preflight_id=? AND preflight.actor_user_id=? AND plan.scope_kind='personal'
    AND plan.owner_user_id=? AND plan.project_id=? AND plan.document_id=? AND plan.source_digest=? AND plan.requirements_digest=?
    AND NOT EXISTS(SELECT 1 FROM output_plan_revisions newer WHERE newer.scope_key=plan.scope_key AND newer.revision>plan.revision)`;
const reviewQuoteSql = `SELECT preflight.event_id,preflight.expires_at,preflight.terms_digest,
      plan.plan_revision_id,plan.revision,plan.confirmed_event_id,plan.source_digest,plan.requirements_digest
      FROM output_preflights preflight JOIN output_plan_revisions plan ON plan.scope_key=preflight.scope_key AND plan.plan_revision_id=preflight.plan_revision_id
      WHERE preflight.scope_key=? AND preflight.preflight_id=? AND preflight.actor_user_id=? AND plan.scope_kind='personal'
        AND plan.document_id=? AND plan.owner_user_id=? AND plan.project_id=?`;
const replaySql = `SELECT command.request_digest,command.event_id,private.private_json FROM output_commands command
      LEFT JOIN event_private_payloads private ON private.private_event_id=command.event_id AND private.owner_id=? AND private.project_id=? AND private.document_id=? AND private.redacted_at IS NULL
      WHERE command.scope_key=? AND command.actor_user_id=? AND command.command_key=?`;
const budgetScopesSql = `SELECT project.organization_id,project.project_access_id
    FROM organization_projects project
    JOIN project_migration_states migration ON migration.project_access_id=project.project_access_id AND migration.organization_id=project.organization_id AND migration.owner_user_id=project.owner_user_id AND migration.status='active'
    JOIN organizations organization ON organization.organization_id=project.organization_id AND organization.status='active'
    JOIN organization_memberships membership ON membership.organization_id=project.organization_id AND membership.user_id=?
      AND membership.status='active' AND membership.accepted_at IS NOT NULL AND membership.revoked_at IS NULL
    JOIN budget_scope_policies policy ON policy.scope='workspace' AND policy.scope_id=project.organization_id AND policy.organization_id=project.organization_id
    WHERE project.owner_user_id=? AND project.status='active' AND
      ((?<>'' AND project.project_id=?) OR (?='' AND EXISTS(
        SELECT 1 FROM project_resource_scopes resource WHERE resource.project_access_id=project.project_access_id
          AND resource.organization_id=project.organization_id AND resource.project_id=project.project_id
          AND resource.owner_user_id=project.owner_user_id AND resource.resource_kind='document' AND resource.resource_id=?
      )))
    LIMIT 2`;
const pilotSql = `SELECT cohort.cohort_id,cohort.organization_id,cohort.status,cohort.starts_at,cohort.ends_at,
      cohort.participant_cap_microusd,cohort.organization_cap_microusd,participant.user_id AS participant_user_id,
      participant.status AS participant_status,participant.revoked_at AS participant_revoked_at,participant.role AS participant_role
    FROM pilot_cohorts cohort JOIN pilot_participants participant ON participant.cohort_id=cohort.cohort_id
      AND participant.organization_id=cohort.organization_id AND participant.user_id=? AND participant.status='active' AND participant.revoked_at IS NULL
    WHERE cohort.status IN ('active','paused','closed') ORDER BY CASE WHEN cohort.status='closed' THEN 1 ELSE 0 END,cohort.created_at DESC LIMIT 1`;
const costBudgetsSql = "SELECT scope,used_microusd,reserved_microusd,hard_limit_microusd FROM cost_budget_counters WHERE period=? AND ((scope='user' AND scope_id=?) OR (scope='workspace' AND scope_id='forma'))";
const memorySchemaSql = (names: string) => `SELECT (SELECT json_group_array(json_object('type',type,'name',name,'tbl_name',tbl_name,'sql',sql))
  FROM(SELECT type,name,tbl_name,CASE WHEN length(CAST(sql AS BLOB))<=16384 THEN sql ELSE NULL END AS sql
    FROM sqlite_schema WHERE tbl_name IN(${names}) ORDER BY name LIMIT 64)) AS schema_json`;
const structuredMemorySql = memorySchemaSql("'memory_structured_answer_origins','memory_structured_answer_originals','memory_structured_answer_ledger_revisions'");
const jobMemorySql = memorySchemaSql("'memory_document_job_answer_origins','memory_document_job_origin_dependencies'");
const auxiliaryMemorySql = "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='memory_native_answer_origins') AS origins,EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='assistant_turns') AS turns";
const laterCommandSql = `SELECT command.action,command.event_id,command.request_digest,command.created_at,body.private_json,
      event.stream_id,event.actor,event.client_id,event.correlation_id,
      json_extract(event.payload,'$.project_id') AS project_id,json_extract(event.payload,'$.document_id') AS document_id
    FROM output_commands command JOIN events event ON event.event_id=command.event_id
    LEFT JOIN event_private_payloads body ON body.private_event_id=command.event_id
      AND body.owner_id=? AND body.project_id=? AND body.document_id=? AND body.redacted_at IS NULL
    WHERE command.scope_key=? AND command.actor_user_id=? AND command.command_key=?`;
const numericLaterColumns = new Set(["source_text_bytes", "source_head", "revision", "now_ms", "approved_canvas_requirements", "present", "used_microusd", "reserved_microusd", "hard_limit_microusd"]);
const jsonLaterColumns = new Set(["policy_json", "private_json", "plan_json", "command_json", "driver_command_json", "envelope_json", "grants_json", "organizations_json", "projects_json", "identity_policies_json"]);
function laterDescriptor(kind: string, columns: readonly string[], maximumRows = 1): LaterDescriptor {
  const invalidRow = columns.map(column => {
    const field = `row."${column}"`;
    if (numericLaterColumns.has(column)) return `NOT(typeof(${field})='integer' AND ${field} BETWEEN 0 AND 9007199254740991)`;
    const bound = ["private_json", "plan_json"].includes(column) ? 2_000_000
      : ["command_json", "driver_command_json", "envelope_json"].includes(column) ? 524288
      : column === "policy_json" || column.endsWith("_json") ? 131072 : column === "display_name" ? 4096 : 1024;
    const valid = `typeof(${field})='text' AND length(CAST(${field} AS BLOB))<=${bound}${jsonLaterColumns.has(column) ? ` AND CASE WHEN json_valid(${field}) THEN 1 ELSE 0 END=1` : ` AND instr(${field},char(0))=0`}`;
    return `NOT(${["consent_version", "consented_at"].includes(column) ? `${field} IS NULL OR (` : ""}${valid}${["consent_version", "consented_at"].includes(column) ? ")" : ""})`;
  }).join(" OR ");
  return Object.freeze({ kind: `later-${kind}`, columns, maximumRows, invalidRow: invalidRow || "0" });
}
function later(owner: SponsorAudioOutputReadOwner) {
  const result = state(owner);
  if (!["audio-output-review", "audio-output-authorize"].includes(result.view.operation) || !result.native.later || !result.native.saved
    || !result.native.receiptComplete || result.native.reading || result.native.receiptReading) return null;
  return { ...result, later: result.native.later, plan: result.native.saved.plan };
}
function laterQuote(view: View): Row | null {
  const wanted = view.retainedSelection?.preflightId;
  for (const [, body] of view.observedBodies) {
    if (body.projectId !== view.original.projectId || body.documentId !== view.original.documentId) continue;
    let value: unknown; try { value = JSON.parse(body.raw); } catch { continue; }
    if (record(value) && record(value.preflight) && (!wanted || value.preflight.id === wanted)) return value.preflight;
  }
  return null;
}
function addLaterProofs(value: LaterState, proofs: readonly Proof[]) {
  value.proofs = distinct([...value.proofs, ...proofs.map(copy)]);
}
function laterProofMatch(view: View, value: LaterState, sql: string, bindings: readonly unknown[]) {
  return [...view.assertions, ...value.proofs].some(proof => sql === `SELECT CASE WHEN (${proof.sql}) THEN 1 ELSE 0 END AS current`
    && same(bindings, proof.bindings ?? []));
}
/** Read-only facts are actual observations. This accessor grants no new query,
 * transaction, payer, or source capability and never accepts expected facts. */
export function sponsorAudioOutputLaterNativeFacts(owner: SponsorAudioOutputReadOwner) {
  const selected = later(owner); if (!selected) return fail();
  const value = selected.later;
  return Object.freeze({ ids: value.ids, principal: value.principal, payerPrincipal: value.payerPrincipal, policy: value.policy, policyDigest: value.policyDigest, policyJson: value.policyJson,
    limitsDigest: value.limitsDigest, approvedAssertions: value.approvedAssertions, dbClock: value.dbClock, intent: value.intent, stage: value.stage, issuance: value.issuance,
    quote: value.quote, reviewQuote: value.reviewQuote, command: value.command, memoryRows: value.memoryRows ? Object.freeze({ ...value.memoryRows }) : undefined });
}
/** The exact native SQL and vector choose a bounded read, never a write. */
export function describeSponsorAudioOutputLaterRead(owner: SponsorAudioOutputReadOwner, sql: string, bindings: readonly unknown[]): LaterDescriptor | null {
  const descriptor = describeLater(owner, sql, bindings), selected = later(owner);
  return descriptor && selected ? Object.freeze({ ...descriptor, assertions: [...selected.later.witnesses ?? []] }) : null;
}
function describeLater(owner: SponsorAudioOutputReadOwner, sql: string, bindings: readonly unknown[]): LaterDescriptor | null {
  const selected = later(owner); if (!selected) return null;
  const { view, later: value, plan } = selected, actor = view.auth.user.userId;
  const scope = `personal:${actor}:${plan.projectId}`, trusted = view.currentContext;
  const quote = laterQuote(view), preflight = quote?.id;
  if (laterProofMatch(view, value, sql, bindings)) return Object.freeze({ kind: "later-proof", columns: ["current"], maximumRows: 1,
    invalidRow: "typeof(row.current)<>'integer' OR row.current<>1" });
  if (sql === PRINCIPAL_WITH_ACCESS_SQL && same(bindings, [actor])) return laterDescriptor("principal", laterPrincipalColumns);
  if (sql === PRINCIPAL_WITH_ACCESS_SQL && view.operation === "audio-output-authorize" && view.retainedCommand && value.policy
    && same(bindings, [value.policy.payerUserId])) return laterDescriptor("payer-principal", laterPrincipalColumns);
  if (sql === campaignSql && same(bindings, [view.original.campaignId])) return laterDescriptor("campaign", ["policy_json", "policy_digest"]);
  if (sql === reviewQuoteSql && preflight && same(bindings, [scope, preflight, actor, plan.documentId, actor, plan.projectId]))
    return laterDescriptor("review-quote", ["event_id", "expires_at", "terms_digest", "plan_revision_id", "revision", "confirmed_event_id", "source_digest", "requirements_digest"]);
  if (view.operation !== "audio-output-authorize") return null;
  if (sql === quoteSql && preflight && trusted && same(bindings, [scope, preflight, actor, actor, plan.projectId, plan.documentId, trusted.sourceDigest, trusted.requirementsDigest]))
    return laterDescriptor("quote", ["terms_digest", "expires_at", "private_json", "source_head", "plan_revision_id", "plan_json"]);
  if (sql === intentSql && same(bindings, [value.ids.driverId])) return laterDescriptor("intent", intentColumns);
  if (sql === stageSql && same(bindings, [value.ids.driverId])) return laterDescriptor("stage", ["command_json", "command_digest"]);
  if (sql === issuanceSql && value.policy && same(bindings, [view.original.campaignId, actor, value.ids.commandKey])) return laterDescriptor("issuance", issuanceColumns);
  if (sql === `SELECT ${instant} AS now_ms` && bindings.length === 0 && value.policy) return laterDescriptor("clock", ["now_ms"]);
  const actualCommand = view.retainedCommand ?? (value.stage ? JSON.parse(String(value.stage.command_json)) as Row : null);
  const commandVector = [actor, plan.projectId, plan.documentId, scope, actor, value.ids.commandKey];
  if (sql === replaySql && actualCommand && same(bindings, commandVector)) return laterDescriptor("replay", ["request_digest", "event_id", "private_json"]);
  if (sql === laterCommandSql && actualCommand && same(bindings, commandVector)) return laterDescriptor("command", ["action", "event_id", "request_digest", "created_at", "private_json", "stream_id", "actor", "client_id", "correlation_id", "project_id", "document_id"]);
  if (sql === "SELECT 1 AS present FROM output_commands WHERE scope_key=? AND actor_user_id=? AND command_key=?"
    && actualCommand && same(bindings, [scope, actor, value.ids.commandKey])) return laterDescriptor("original-present", ["present"]);
  if (preflight && same(bindings, [scope, preflight, actor])) {
    if (sql === "SELECT event_id,expires_at,terms_digest FROM output_preflights WHERE scope_key=? AND preflight_id=? AND actor_user_id=?")
      return laterDescriptor("preflight", ["event_id", "expires_at", "terms_digest"]);
    if (sql === "SELECT * FROM output_preflights WHERE scope_key=? AND preflight_id=? AND actor_user_id=?") return laterDescriptor("preflight", preflightColumns);
  }
  if (actualCommand && value.policy) {
    if (sql === budgetScopesSql && same(bindings, [actor, actor, plan.projectId, plan.projectId, plan.projectId, plan.documentId]))
      return laterDescriptor("budget-scopes", ["organization_id", "project_access_id"], 0);
    if (sql === pilotSql && bindings.length === 1 && typeof bindings[0] === "string" && [actor, value.policy.payerUserId].includes(bindings[0]))
      return laterDescriptor("pilot", ["cohort_id", "organization_id", "status", "starts_at", "ends_at", "participant_cap_microusd", "organization_cap_microusd", "participant_user_id", "participant_status", "participant_revoked_at", "participant_role"], 0);
    if (sql === costBudgetsSql && same(bindings, [new Date().toISOString().slice(0, 7), value.policy.payerUserId])) {
      const descriptor = laterDescriptor("cost-budgets", ["scope", "used_microusd", "reserved_microusd", "hard_limit_microusd"], 2);
      return { ...descriptor, invalidRow: `(${descriptor.invalidRow}) OR row.scope NOT IN('user','workspace')` };
    }
    if (bindings.length === 0 && [structuredMemorySql, jobMemorySql].includes(sql)) return { kind: sql === structuredMemorySql ? "later-structured-memory" : "later-job-memory", columns: ["schema_json"], maximumRows: 1,
      invalidRow: "typeof(row.schema_json)<>'text' OR length(CAST(row.schema_json AS BLOB))>65536 OR CASE WHEN json_valid(row.schema_json) THEN json_type(row.schema_json)<>'array' ELSE 1 END" };
    if (sql === auxiliaryMemorySql && bindings.length === 0) return { kind: "later-auxiliary-memory", columns: ["origins", "turns"], maximumRows: 1,
      invalidRow: "typeof(row.origins)<>'integer' OR row.origins NOT IN(0,1) OR typeof(row.turns)<>'integer' OR row.turns NOT IN(0,1)" };
  }
  return null;
}

/** Called only after the owner's real bounded transport has returned. Stable
 * row witnesses survive phase changes; empty lookups and clocks do not. */
export async function observeSponsorAudioOutputLaterRead(owner: SponsorAudioOutputReadOwner, sql: string, bindings: readonly unknown[], rows: readonly Row[], witness: OutputSqlAssertion): Promise<void> {
  const selected = later(owner); if (!selected) return fail();
  const { view, later: value, plan } = selected, descriptor = describeSponsorAudioOutputLaterRead(owner, sql, bindings);
  if (!descriptor || rows.length > descriptor.maximumRows || !view.isReadObservation(sql, bindings, rows, witness)) return fail();
  if (!rows.length) return;
  const row = rows[0]!; ownData(row);
  if (!exactKeys(row, descriptor.columns)) return fail();
  const actor = view.auth.user, scope = `personal:${actor.userId}:${plan.projectId}`, quote = laterQuote(view);
  const capture = (key: "principal" | "payerPrincipal" | "intent" | "stage" | "issuance" | "quote" | "reviewQuote" | "command") => {
    if (value[key] && canonicalJson(value[key]) !== canonicalJson(row)) return fail("sponsor_audio_output_later_original_changed");
    value[key] = row;
  };
  if (descriptor.kind === "later-payer-principal") {
    if (!value.policy || row.user_id !== value.policy.payerUserId || row.consent_version !== POLICY_VERSION || !["creator", "admin"].includes(String(row.role))) return fail();
    capture("payerPrincipal");
    addLaterProofs(value, [{ sql: `EXISTS(SELECT 1 FROM (${PRINCIPAL_WITH_ACCESS_SQL}) captured WHERE json_array(${laterPrincipalColumns.map(column => `captured.${column}`).join(",")})=?)`,
      bindings: [value.policy.payerUserId, JSON.stringify(laterPrincipalColumns.map(column => row[column] ?? null))] }]);
  } else if (descriptor.kind === "later-principal") {
    const snapshot = actor.authorizationSnapshot;
    if (row.user_id !== actor.userId || row.email !== actor.email || row.display_name !== actor.displayName || row.role !== actor.role
      || row.consent_version !== POLICY_VERSION || row.consent_version !== actor.consentVersion || row.consented_at !== actor.consentedAt
      || !snapshot || !same([row.updated_at, row.permission_epoch, row.grants_json, row.organizations_json, row.projects_json, row.identity_policies_json, row.approved_canvas_requirements],
        [snapshot.updatedAt, snapshot.rawEpoch, snapshot.grants, snapshot.organizations, snapshot.projects, snapshot.identityPolicies, snapshot.canvasRequirements])) return fail();
    capture("principal");
    for (const columns of [laterPrincipalColumns, evidencePrincipalColumns]) addLaterProofs(value, [{ sql: `EXISTS(SELECT 1 FROM (${PRINCIPAL_WITH_ACCESS_SQL}) captured WHERE json_array(${columns.map(column => `captured.${column}`).join(",")})=?)`,
      bindings: [actor.userId, JSON.stringify(columns.map(column => row[column] ?? null))] }]);
  } else if (descriptor.kind === "later-campaign") {
    if (typeof row.policy_json !== "string" || row.policy_digest !== view.original.sponsorPolicyDigest) return fail();
    const policy = readSponsorAudioPolicy(JSON.parse(row.policy_json));
    const policyDigest = await view.wait(() => digest(policy)); view.current();
    if (policy.campaignId !== view.original.campaignId || policyDigest !== row.policy_digest || policy.payerUserId === actor.userId
      || value.policy && canonicalJson(value.policy) !== canonicalJson(policy)) return fail();
    value.policy = policy; value.policyDigest = policyDigest; value.policyJson = row.policy_json; value.limitsDigest = await view.wait(() => digest(policy.resources)); view.current();
    if (!value.principal) return fail();
    const approved: OutputSqlAssertion[] = [{ sql: `EXISTS(SELECT 1 FROM (${PRINCIPAL_WITH_ACCESS_SQL}) captured WHERE json_array(${laterPrincipalColumns.map(column => `captured.${column}`).join(",")})=?)`,
      bindings: [actor.userId, JSON.stringify(laterPrincipalColumns.map(column => value.principal![column] ?? null))] }, sponsorApprovalAssertion(policy, actor.userId, true), {
      sql: `NOT EXISTS(SELECT 1 FROM pilot_participants participant JOIN pilot_cohorts cohort ON cohort.cohort_id=participant.cohort_id
      WHERE participant.user_id IN(?,?) AND participant.status='active' AND participant.revoked_at IS NULL AND cohort.status IN('active','paused','closed'))`, bindings: [actor.userId, policy.payerUserId],
    }, { sql: `EXISTS(SELECT 1 FROM experience_sponsor_campaigns WHERE campaign_id=? AND enabled=1 AND policy_digest=? AND policy_json=?) AND ${instant}>=? AND ${instant}<?`,
      bindings: [policy.campaignId, policyDigest, row.policy_json, policy.startsAtMs, policy.expiresAtMs], deadlineMs: policy.expiresAtMs }];
    value.approvedAssertions = approved.map(copy); ownData(value.approvedAssertions);
    addLaterProofs(value, [...approved, sponsorApprovalAssertion(policy, actor.userId), {
      sql: `EXISTS(SELECT 1 FROM experience_sponsor_resource_policies WHERE campaign_id=? AND enabled=1 AND limits_digest=? AND limits_json=?
      AND ?<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AND ?>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))`,
      bindings: [policy.campaignId, value.limitsDigest, canonicalJson(policy.resources), policy.resources.startsAtMs, policy.resources.expiresAtMs], deadlineMs: policy.resources.expiresAtMs }, {
      sql: `EXISTS(SELECT 1 FROM experience_sponsor_resource_policies resources
    WHERE resources.campaign_id=? AND resources.enabled=1 AND resources.limits_digest=? AND resources.limits_json=?
      AND ?<=${instant} AND ?>${instant})`,
      bindings: [policy.campaignId, value.limitsDigest, canonicalJson(policy.resources), policy.resources.startsAtMs, policy.resources.expiresAtMs], deadlineMs: policy.resources.expiresAtMs }]);
  } else if (descriptor.kind === "later-intent") {
    if (row.driver_id !== value.ids.driverId || row.campaign_id !== view.original.campaignId || row.actor_user_id !== actor.userId
      || row.intent_key !== value.ids.intentKey || row.document_id !== plan.documentId) return fail();
    capture("intent"); addLaterProofs(value, [{ sql: `EXISTS(SELECT 1 FROM experience_sponsor_driver_intents WHERE ${intentColumns.map(column => `${column}=?`).join(" AND ")})`, bindings: intentColumns.map(column => row[column] as Binding) }]);
  } else if (descriptor.kind === "later-stage") {
    if (!value.intent || typeof row.command_json !== "string" || row.command_json.length > 16384) return fail();
    const command: unknown = JSON.parse(row.command_json);
    if (!record(command) || command.action !== "authorize" || command.clientMutationId !== value.ids.commandKey || command.documentId !== plan.documentId
      || !quote || command.preflightId !== quote.id || command.termsDigest !== quote.termsDigest) return fail();
    capture("stage"); addLaterProofs(value, [{ sql: "EXISTS(SELECT 1 FROM experience_sponsor_driver_stages WHERE driver_id=? AND stage='authorize' AND command_json=? AND command_digest=?)",
      bindings: [value.ids.driverId, row.command_json, row.command_digest as Binding] }]);
  } else if (descriptor.kind === "later-issuance") {
    if (row.grant_id !== value.ids.grantId || row.campaign_id !== view.original.campaignId || row.actor_user_id !== actor.userId
      || row.intent_key !== value.ids.commandKey || row.policy_digest !== value.policyDigest) return fail();
    capture("issuance");
  } else if (descriptor.kind === "later-review-quote") {
    if (!quote || row.terms_digest !== quote.termsDigest || row.expires_at !== quote.expiresAt || row.plan_revision_id !== quote.planRevisionId
      || !view.observedPlans.includes(String(row.plan_revision_id)) || row.source_digest !== view.currentContext?.sourceDigest
      || row.requirements_digest !== view.currentContext?.requirementsDigest) return fail();
    capture("reviewQuote");
    addLaterProofs(value, [{ sql: "EXISTS(SELECT 1 FROM output_preflights WHERE scope_key=? AND preflight_id=? AND actor_user_id=? AND event_id=? AND terms_digest=? AND expires_at=? AND plan_revision_id=?)",
      bindings: [scope, quote.id as Binding, actor.userId, row.event_id as Binding, row.terms_digest as Binding, row.expires_at as Binding, row.plan_revision_id as Binding], deadlineMs: Date.parse(String(row.expires_at)) }, {
      sql: `EXISTS(SELECT 1 FROM output_plan_revisions plan WHERE plan.scope_key=? AND plan.document_id=? AND plan.plan_revision_id=? AND plan.revision=? AND plan.source_digest=? AND plan.requirements_digest=?
        AND plan.confirmed_event_id=? AND plan.scope_kind='personal' AND plan.owner_user_id=? AND plan.project_id=?
        AND NOT EXISTS(SELECT 1 FROM output_plan_revisions newer WHERE newer.scope_key=plan.scope_key AND newer.revision>plan.revision))`,
      bindings: [scope, plan.documentId, row.plan_revision_id as Binding, row.revision as Binding, row.source_digest as Binding, row.requirements_digest as Binding, row.confirmed_event_id as Binding, actor.userId, plan.projectId] }]);
  } else if (descriptor.kind === "later-quote") {
    if (!quote || row.terms_digest !== quote.termsDigest || row.expires_at !== quote.expiresAt || row.plan_revision_id !== quote.planRevisionId) return fail();
    capture("quote");
    addLaterProofs(value, [{ sql: `EXISTS(SELECT 1 FROM (${quoteSql}) captured WHERE terms_digest=? AND expires_at=? AND private_json=? AND source_head=? AND plan_revision_id=? AND plan_json=?)`,
      bindings: [...bindings as Binding[], ...["terms_digest", "expires_at", "private_json", "source_head", "plan_revision_id", "plan_json"].map(column => row[column] as Binding)] }]);
  } else if (descriptor.kind === "later-command" || descriptor.kind === "later-replay") {
    if (typeof row.private_json !== "string" || bytes(row.private_json) > 524288) return fail();
    const body: unknown = JSON.parse(row.private_json), expected: unknown = view.retainedCommand ?? (value.stage ? JSON.parse(String(value.stage.command_json)) : null);
    if (!record(body) || !record(body.output_command_envelope) || !record(expected)) return fail();
    const envelope = body.output_command_envelope, marker = envelope.sponsor_entitlement;
    const command = { ...envelope }; delete command.sponsor_entitlement;
    if (canonicalJson(command) !== canonicalJson(expected) || !record(marker) || marker.campaign_id !== view.original.campaignId
      || marker.policy_digest !== view.original.sponsorPolicyDigest || marker.payer_user_id === actor.userId) return fail();
    addLaterProofs(value, [{ sql: "EXISTS(SELECT 1 FROM event_private_payloads WHERE private_event_id=? AND owner_id=? AND project_id=? AND document_id=? AND private_json=? AND redacted_at IS NULL)",
      bindings: [row.event_id as Binding, actor.userId, plan.projectId, plan.documentId, row.private_json] }]);
    if (descriptor.kind === "later-command") {
      if (!same([row.action, row.stream_id, row.actor, row.client_id, row.correlation_id, row.project_id, row.document_id],
        ["authorize", plan.streamId, `user:${actor.userId}`, "server:output-requirements", value.ids.commandKey, plan.projectId, plan.documentId])) return fail();
      capture("command");
      addLaterProofs(value, [outputCommandReceiptAssertion({ kind: "personal", key: scope, ownerUserId: actor.userId, actorUserId: actor.userId,
        projectId: plan.projectId, documentId: plan.documentId, organizationId: null, projectAccessId: null, contextId: null }, {
        action: "authorize", eventId: String(row.event_id), createdAt: String(row.created_at), key: value.ids.commandKey,
        requestDigest: String(row.request_digest), payload: body,
      })]);
    }
  } else if (descriptor.kind === "later-clock") {
    if (!Number.isSafeInteger(row.now_ms) || value.dbClock !== undefined && value.dbClock !== row.now_ms) return fail();
    value.dbClock = Number(row.now_ms); return;
  } else if (["later-structured-memory", "later-job-memory", "later-auxiliary-memory"].includes(descriptor.kind)) {
    const prior = value.memoryRows?.[descriptor.kind];
    if (prior && canonicalJson(prior) !== canonicalJson(rows)) return fail();
    value.memoryRows ??= {}; value.memoryRows[descriptor.kind] = Object.freeze([...rows]); return;
  } else if (descriptor.kind === "later-cost-budgets") {
    if (new Set(rows.map(result => result.scope)).size !== rows.length) return fail();
    return;
  } else if (["later-proof", "later-original-present"].includes(descriptor.kind)) return;
  else if (descriptor.kind !== "later-preflight") return fail();
  // The actual bounded row witness is generated inside reads.ts. Never retain
  // a missing-row predicate: a successful later write may fill that same row.
  value.witnesses = distinct([...value.witnesses ?? [], copy(witness)]); view.current();
}
