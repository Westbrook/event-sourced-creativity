import { canonicalJson, digest, exactKeys, jsonIssues, record } from "../src/experiences/compiler.ts";
import { experienceDraftId, experienceResourceId, receiptPrefix } from "../src/experiences/intake.ts";
import { guestFail, guestHash, guestId, readGuestCustodyTerms } from "./experience-guest-session.ts";
import { readGuestSourcePolicy } from "./experience-guest-source.ts";
import { publicEventPayload } from "./event-privacy.ts";
import { nativeMemoryAnswerExclusion } from "./memory-native-boundary.ts";
import type { WorkerEnv } from "./runtime.ts";

type Value = string | number | null;
type Row = Record<string, Value>;
type Proof = { sql: string; bindings: Value[] };
const unavailable = (): never => guestFail("source_retirement_unavailable");
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
const canonicalTime = (value: unknown): value is string => typeof value === "string" && value.length === 24
  && Number.isSafeInteger(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
const integer = (value: unknown, minimum: number, maximum: number): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
const canonicalRedactionSql = (column: string) => `typeof(${column})='text' AND length(CAST(${column} AS BLOB))=24
  AND ${column}=strftime('%Y-%m-%dT%H:%M:%fZ',${column})`;
const json = (value: Value | undefined): Record<string, unknown> => {
  if (typeof value !== "string") return unavailable();
  let parsed: unknown; try { parsed = JSON.parse(value); } catch { return unavailable(); }
  if (!record(parsed) || jsonIssues(parsed).length) return unavailable();
  return parsed;
};
const join = (proofs: Proof[]): Proof => ({ sql: proofs.map(proof => `(${proof.sql})`).join(" AND "), bindings: proofs.flatMap(proof => proof.bindings) });
const objectSql = (columns: readonly string[], alias = "") => `json_object(${columns.flatMap(column => [`'${column}'`, `${alias}${column}`]).join(",")})`;
const sourceColumns = ["session_id", "policy_id", "policy_digest", "draft_id", "draft_hash", "request_digest", "content_digest", "draft_bytes", "event_bytes", "event_count", "expires_at"];
const sessionColumns = ["session_id", "policy_id", "terms_digest", "guest_subject", "project_id", "document_id", "session_hash", "claim_hash", "created_at_ms", "expires_at_ms", "revoked_at_ms"];
const sourcePolicyColumns = ["policy_id", "policy_digest", "policy_json", "review_digest", "revoked_at_ms"];
const sessionPolicyColumns = ["policy_id", "terms_digest", "terms_json", "review_digest", "revoked_at_ms"];
const draftColumns = ["content_id", "owner_id", "kind", "content", "created_at", "expires_at", "redacted_at"];
const commitColumns = ["session_id", "draft_hash", "head", "event_ids_json"];
const eventColumns = ["event_id", "stream_id", "sequence", "occurred_at", "recorded_at", "actor", "client_id", "correlation_id", "causation_id", "compensates_event_id", "schema_version", "type", "payload"];
// Preserve the flat, ordered witness including explicit nulls. D1 caps SQL
// function arguments at 32: the base object uses 26 and json_set uses 17.
const eventWitness = `json_set(${objectSql(eventColumns, "e.")},
  '$.owner_id',body.owner_id,'$.project_id',body.project_id,'$.document_id',body.document_id,'$.private_json',body.private_json,
  '$.created_at',body.created_at,'$.redacted_at',body.redacted_at,'$.receipt_key',receipt.client_event_id,'$.receipt_created_at',receipt.created_at)`;
const eventJoins = `JOIN events e ON e.event_id=expected.value
  JOIN event_private_payloads body ON body.private_event_id=e.event_id
  JOIN event_client_receipts receipt ON receipt.event_id=e.event_id AND receipt.stream_id=e.stream_id AND receipt.sequence=e.sequence`;
const registries = ["memory_native_answer_origins", "memory_structured_answer_origins", "memory_document_job_answer_origins"] as const;
const registrySchemaSql = `(SELECT json_group_array(json_object('type',type,'name',name,'sql',definition)) FROM
  (SELECT type,name,CASE WHEN length(CAST(sql AS BLOB))<=16384 THEN sql ELSE NULL END AS definition FROM sqlite_schema
    WHERE type IN('table','view') AND name IN(${registries.map(name => `'${name}'`).join(",")}) ORDER BY name LIMIT 4))`;

/** Internal and dormant. Retires only one proven original Image source. No
 * caller-supplied owner, native principal, schema installation or background
 * sweep is accepted here. Revocation and expired credentials cannot postpone
 * an already-agreed retention deadline; a claim lease cannot extend it.
 *
 * There is no adoption operation yet. Future adoption must atomically require
 * an unexpired/unredacted exact source and event copies. Any future adoption
 * that keeps guest-owned envelopes through a custody receipt must introduce an
 * explicit native retention exclusion before that adoption is activated. */
export async function retireExpiredGuestImageSource(env: WorkerEnv, input: { sessionId: string }) {
  if (jsonIssues(input).length || !record(input) || !exactKeys(input, ["sessionId"]) || !guestId(input.sessionId)) return unavailable();
  const sessionId = input.sessionId, db = env.DB, proofs: Proof[] = [];
  const current = () => { if (env.DB !== db) guestFail("database_changed"); };
  async function read(table: string, key: string, value: Value, columns: string[], bound: string) {
    const row = await db.prepare(`SELECT ${columns.join(",")},${objectSql(columns)} AS witness FROM ${table} WHERE ${key}=? AND (${bound})`)
      .bind(value).first<Row>();
    current();
    if (!row || typeof row.witness !== "string") return unavailable();
    proofs.push({ sql: `EXISTS(SELECT 1 FROM ${table} WHERE ${key}=? AND ${objectSql(columns)}=?)`, bindings: [value, row.witness] });
    return row;
  }
  const source = await read("experience_guest_sources", "session_id", sessionId, sourceColumns,
    "length(CAST(draft_id AS BLOB))<=128 AND length(CAST(policy_id AS BLOB))<=160 AND length(CAST(expires_at AS BLOB))=24 AND draft_bytes BETWEEN 1 AND 65536 AND event_bytes BETWEEN 1 AND 65536 AND event_count BETWEEN 1 AND 16");
  if (!guestId(source.policy_id) || !guestHash(source.policy_digest) || !guestHash(source.draft_hash)
    || !guestHash(source.request_digest) || !guestHash(source.content_digest) || !canonicalTime(source.expires_at)
    || !integer(source.draft_bytes, 1, 65_536) || !integer(source.event_bytes, 1, 65_536) || !integer(source.event_count, 1, 16)) return unavailable();
  const due = await db.prepare("SELECT ?<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AS due").bind(source.expires_at).first<{ due: number }>();
  current(); if (due?.due !== 1) return guestFail("source_retirement_not_due");
  const session = await read("experience_guest_sessions", "session_id", sessionId, sessionColumns,
    "length(CAST(guest_subject AS BLOB))<=160 AND length(CAST(project_id AS BLOB))<=160 AND length(CAST(document_id AS BLOB))<=160 AND length(CAST(policy_id AS BLOB))<=160");
  if (typeof session.guest_subject !== "string" || !/^guest:[a-f0-9-]{36}$/u.test(session.guest_subject)
    || !guestId(session.policy_id) || !guestHash(session.terms_digest) || !guestHash(session.session_hash) || !guestHash(session.claim_hash)
    || !integer(session.created_at_ms, 0, 8_640_000_000_000_000) || !integer(session.expires_at_ms, 1, 8_640_000_000_000_000)
    || session.expires_at_ms <= session.created_at_ms || Date.parse(source.expires_at) > session.expires_at_ms) return unavailable();
  const sourcePolicy = await read("experience_guest_source_policies", "policy_id", source.policy_id, sourcePolicyColumns, "length(CAST(policy_json AS BLOB)) BETWEEN 1 AND 4096");
  const sessionPolicy = await read("experience_guest_policies", "policy_id", session.policy_id, sessionPolicyColumns, "length(CAST(terms_json AS BLOB)) BETWEEN 1 AND 4096");
  let policy, terms;
  try { policy = readGuestSourcePolicy(json(sourcePolicy.policy_json)); terms = readGuestCustodyTerms(json(sessionPolicy.terms_json)); }
  catch { return unavailable(); }
  const draftId = await experienceDraftId(session.guest_subject, sessionId);
  const [projectId, documentId, policyDigest, termsDigest] = await Promise.all([
    experienceResourceId(draftId, "project"), experienceResourceId(draftId, "document"), digest(policy), digest(terms),
  ]);
  current();
  if (draftId !== source.draft_id || projectId !== session.project_id || documentId !== session.document_id
    || policy.policyId !== source.policy_id || policyDigest !== source.policy_digest || sourcePolicy.policy_digest !== policyDigest
    || canonicalJson(policy) !== sourcePolicy.policy_json || !guestHash(sourcePolicy.review_digest)
    || policy.sessionPolicyId !== session.policy_id || policy.sessionTermsDigest !== session.terms_digest
    || terms.policyId !== session.policy_id || termsDigest !== session.terms_digest || sessionPolicy.terms_digest !== termsDigest
    || canonicalJson(terms) !== sessionPolicy.terms_json || !guestHash(sessionPolicy.review_digest)
    || session.created_at_ms < terms.startsAtMs || session.expires_at_ms > terms.expiresAtMs
    || session.expires_at_ms - session.created_at_ms > terms.sessionLifetimeMs
    || source.draft_bytes > policy.maximumDraftBytes || source.event_bytes > policy.maximumEventBytes || source.event_count > policy.maximumEvents) return unavailable();
  const draft = await read("private_content", "content_id", draftId, draftColumns, "typeof(content)='text' AND length(CAST(content AS BLOB))<=65536");
  const draftSnapshotProof = proofs.at(-1)!;
  if (draft.owner_id !== session.guest_subject || draft.kind !== "experience-draft" || draft.expires_at !== source.expires_at
    || !canonicalTime(draft.created_at) || Date.parse(draft.created_at) >= Date.parse(source.expires_at)
    || draft.redacted_at !== null && (!canonicalTime(draft.redacted_at) || draft.content !== "")) return unavailable();
  let planEvents: unknown[] | null = null;
  if (draft.redacted_at === null) {
    if (typeof draft.content !== "string" || bytes(draft.content) !== source.draft_bytes || await digest(draft.content) !== source.content_digest) return unavailable();
    const plan = json(draft.content), { draftHash, ...base } = plan;
    if (draftHash !== source.draft_hash || await digest(base) !== draftHash || canonicalJson(plan) !== draft.content || plan.draftId !== draftId
      || plan.streamId !== `creative:${session.guest_subject}` || plan.projectId !== projectId || plan.documentId !== documentId
      || !record(plan.request) || plan.request.intentId !== sessionId || plan.request.experienceId !== "image" || plan.request.reference !== undefined
      || await digest(plan.request) !== source.request_digest || !record(plan.release) || plan.release.releaseHash !== policy.releaseHash
      || !Array.isArray(plan.events) || plan.events.length !== source.event_count) return unavailable();
    planEvents = plan.events;
  }
  current();
  const rawCommit = await db.prepare(`SELECT ${commitColumns.join(",")},${objectSql(commitColumns)} AS witness FROM experience_guest_source_commits
    WHERE session_id=? AND length(CAST(event_ids_json AS BLOB))<=4096`).bind(sessionId).first<Row>();
  current();
  let eventIds: string[] = [];
  if (rawCommit) {
    let parsed: unknown; try { parsed = JSON.parse(String(rawCommit.event_ids_json)); } catch { return unavailable(); }
    if (rawCommit.draft_hash !== source.draft_hash || rawCommit.head !== source.event_count || !Array.isArray(parsed)
      || parsed.length !== source.event_count || parsed.some(id => typeof id !== "string" || !/^[a-f0-9-]{36}$/u.test(id))
      || new Set(parsed).size !== parsed.length || JSON.stringify(parsed) !== rawCommit.event_ids_json || typeof rawCommit.witness !== "string") return unavailable();
    eventIds = parsed;
    proofs.push({ sql: `EXISTS(SELECT 1 FROM experience_guest_source_commits WHERE session_id=? AND ${objectSql(commitColumns)}=?)`, bindings: [sessionId, rawCommit.witness] });
  } else {
    // A partial or oversized existing receipt is not an uncommitted source.
    proofs.push({ sql: "NOT EXISTS(SELECT 1 FROM experience_guest_source_commits WHERE session_id=?) AND NOT EXISTS(SELECT 1 FROM events WHERE stream_id=?)", bindings: [sessionId, `creative:${session.guest_subject}`] });
  }
  const idsJson = JSON.stringify(eventIds), rows = eventIds.length ? await db.prepare(`SELECT ${eventWitness} AS witness
    FROM json_each(?) expected ${eventJoins} WHERE typeof(e.payload)='text' AND length(CAST(e.payload AS BLOB))<=65536
      AND typeof(body.private_json)='text' AND length(CAST(body.private_json AS BLOB))<=65536 ORDER BY CAST(expected.key AS INTEGER)`)
    .bind(idsJson).all<{ witness: string }>() : { results: [] };
  current();
  if (rows.results.length !== eventIds.length) return unavailable();
  let retainedBytes = 0, allRedacted = draft.redacted_at !== null;
  for (const [index, entry] of rows.results.entries()) {
    const event = json(entry.witness), payload = json(event.payload as Value), id = eventIds[index], eventDocument = index === 0 ? null : documentId;
    const expectedType = ["ProjectCreated", "DocumentCreated", "EmptyCanvasChosen"][index] ?? "BlockCreated";
    if (event.event_id !== id || event.stream_id !== `creative:${session.guest_subject}` || event.sequence !== index + 1
      || event.actor !== session.guest_subject || event.client_id !== "server:guest-source" || event.correlation_id !== draftId
      || event.schema_version !== 1 || event.type !== expectedType || event.causation_id !== null || event.compensates_event_id !== null
      || event.owner_id !== session.guest_subject || event.project_id !== projectId || event.document_id !== eventDocument
      || event.receipt_key !== receiptPrefix(draftId) + index || payload.client_event_id !== event.receipt_key
      || payload._private_ref !== id || payload.project_id !== projectId || (payload.document_id ?? null) !== eventDocument
      || !canonicalTime(event.recorded_at) || !canonicalTime(event.occurred_at) || event.created_at !== event.recorded_at
      || event.receipt_created_at !== event.recorded_at || typeof event.private_json !== "string") return unavailable();
    retainedBytes += bytes(String(event.payload)) + bytes(event.private_json);
    if (planEvents) {
      const expected = planEvents[index];
      if (!record(expected) || expected.type !== event.type || !record(expected.payload)
        || JSON.stringify(publicEventPayload(id, expected.payload, true).payload) !== event.payload) return unavailable();
    }
    if (event.redacted_at !== null) {
      if (!canonicalTime(event.redacted_at) || event.private_json !== "") return unavailable();
    } else {
      allRedacted = false;
      const privatePayload = json(event.private_json);
      if (privatePayload.client_event_id !== event.receipt_key || privatePayload.project_id !== projectId || (privatePayload.document_id ?? null) !== eventDocument
        || JSON.stringify(publicEventPayload(id, privatePayload, true).payload) !== event.payload) return unavailable();
      if (planEvents) {
        const expected = planEvents[index];
        if (!record(expected) || expected.type !== event.type || JSON.stringify(expected.payload) !== event.private_json) return unavailable();
      }
      // Once native cleanup has already erased the draft, the immutable event
      // receipt and exact native association authorize due erasure of this
      // original envelope. They cannot certify its historical private bytes.
    }
  }
  if (retainedBytes > source.event_bytes) return unavailable();
  // Native provenance is a conservative exclusion, including contradictory or
  // malformed registrations. It never enrolls Memory or cleans up its records.
  // The actual helper qualifies the structured/document-job schema or their
  // total absence, and carries that exact witness into both uses below.
  try {
    const boundary = await nativeMemoryAnswerExclusion(env, { answerAlias: "private_content" });
    current();
    proofs.push({ sql: `EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND (${boundary.sql}))`,
      bindings: [draftId, ...boundary.bindings] });
    // The helper does not expose schema flags. This one compact observation
    // freezes the registry branches for original event IDs without repeating
    // its full known-schema qualification. For the legacy registry this is
    // exact observed definition/absence stability, not a DDL allowlist; absent
    // required columns fail closed when the fixed exclusion query executes.
    const schema = await db.prepare(`SELECT ${registrySchemaSql} AS snapshot`).first<{ snapshot: string }>();
    current();
    if (!schema || typeof schema.snapshot !== "string" || bytes(schema.snapshot) > 65_536) return unavailable();
    const observed: unknown = JSON.parse(schema.snapshot);
    if (!Array.isArray(observed) || observed.length > registries.length || observed.some(row => !record(row) || !exactKeys(row, ["type", "name", "sql"])
      || row.type !== "table" || !registries.includes(row.name as typeof registries[number]) || typeof row.sql !== "string")) return unavailable();
    proofs.push({ sql: `${registrySchemaSql}=?`, bindings: [schema.snapshot] });
    if (eventIds.length) for (const entry of observed) proofs.push({
      sql: `NOT EXISTS(SELECT 1 FROM ${entry.name} WHERE user_event_id IN(SELECT value FROM json_each(?)) OR answer_event_id IN(SELECT value FROM json_each(?)))`,
      bindings: [idsJson, idsJson],
    });
  } catch { current(); return unavailable(); }
  proofs.push({ sql: `?<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    AND NOT EXISTS(SELECT 1 FROM organization_projects WHERE project_id=?)
    AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=? OR resource_kind='document' AND resource_id=?)
    AND NOT EXISTS(SELECT 1 FROM private_content_retention_scopes WHERE content_id=?)
    AND NOT EXISTS(SELECT 1 FROM project_event_scopes WHERE event_id IN(SELECT value FROM json_each(?)))`,
  bindings: [source.expires_at, projectId, draftId, documentId, draftId, idsJson] });
  const eventSnapshotProof = eventIds.length ? { sql: `(SELECT COUNT(*) FROM json_each(?) expected ${eventJoins}
    JOIN json_each(?) snapshots ON snapshots.key=expected.key WHERE ${eventWitness}=snapshots.value)=?`,
  bindings: [idsJson, `[${rows.results.map(row => row.witness).join(",")}]`, eventIds.length] } : null;
  if (eventSnapshotProof) proofs.push(eventSnapshotProof);
  const proof = join(proofs), token = crypto.randomUUID();
  current();
  const statements = [
    db.prepare(`INSERT INTO experience_guest_source_assertions VALUES(?,CASE WHEN ${proof.sql} THEN 1 ELSE 0 END)`).bind(token, ...proof.bindings),
    db.prepare("UPDATE private_content SET content='',redacted_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE content_id=? AND redacted_at IS NULL").bind(draftId),
    db.prepare("UPDATE event_private_payloads SET private_json='',redacted_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE private_event_id IN(SELECT value FROM json_each(?)) AND redacted_at IS NULL").bind(idsJson),
    db.prepare("DELETE FROM experience_guest_source_assertions WHERE token=?").bind(token),
  ];
  let uncertain = false;
  try {
    const result = await db.batch(statements);
    if (!Array.isArray(result) || result.length !== statements.length || result.some(item => item?.success !== true)) uncertain = true;
  } catch { uncertain = true; }
  current();
  // This last read is also the lost-acknowledgement path. It rechecks receipts
  // and unchanged native associations without retaining a second creative copy.
  {
    const unchanged = proofs.filter(part => part !== draftSnapshotProof && part !== eventSnapshotProof);
    const associations = eventIds.length ? { sql: `(SELECT COUNT(*) FROM json_each(?) expected ${eventJoins}
      JOIN json_each(?) snapshots ON snapshots.key=expected.key WHERE ${eventColumns.map(column => `e.${column} IS json_extract(snapshots.value,'$.${column}')`).join(" AND ")}
      AND body.owner_id=json_extract(snapshots.value,'$.owner_id') AND body.project_id IS json_extract(snapshots.value,'$.project_id')
      AND body.document_id IS json_extract(snapshots.value,'$.document_id') AND body.created_at=json_extract(snapshots.value,'$.created_at')
      AND (${canonicalRedactionSql("body.redacted_at")})
      AND (json_extract(snapshots.value,'$.redacted_at') IS NULL OR body.redacted_at=json_extract(snapshots.value,'$.redacted_at'))
      AND receipt.client_event_id=json_extract(snapshots.value,'$.receipt_key') AND receipt.created_at=json_extract(snapshots.value,'$.receipt_created_at'))=?`,
    bindings: [idsJson, `[${rows.results.map(row => row.witness).join(",")}]`, eventIds.length] } : null;
    if (associations) unchanged.push(associations);
    const recovery = join(unchanged);
    let retired;
    try {
      retired = await db.prepare(`SELECT 1 WHERE (${recovery.sql}) AND EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=?
        AND kind='experience-draft' AND expires_at=? AND created_at=? AND content='' AND (${canonicalRedactionSql("redacted_at")})
        AND (? IS NULL OR redacted_at=?))
        AND (SELECT COUNT(*) FROM event_private_payloads WHERE private_event_id IN(SELECT value FROM json_each(?)) AND private_json='' AND redacted_at IS NOT NULL)=?`)
        .bind(...recovery.bindings, draftId, session.guest_subject, source.expires_at, draft.created_at, draft.redacted_at, draft.redacted_at, idsJson, eventIds.length).first();
    } catch { current(); return unavailable(); }
    current(); if (!retired) return unavailable();
  }
  return Object.freeze({ status: "retired" as const, sessionId, draftId, eventCount: eventIds.length, replayed: allRedacted || uncertain });
}
