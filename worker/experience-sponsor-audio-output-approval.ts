import { canonicalJson, digest, exactKeys, freeze, jsonIssues, record } from "../src/experiences/compiler.ts";
import { compileSponsorApprovalProposal, sponsorApprovalAssertion } from "./experience-sponsor-approval.ts";
import { readSponsorAudioOutputReadPolicy, SPONSOR_AUDIO_OUTPUT_READ_POLICY_SCHEMA, type SponsorAudioOutputReadPolicyV1 } from "./experience-sponsor-audio-output-policy.ts";
import { SponsorEntitlementError } from "./experience-sponsor-policy.ts";
import { readExistingPrincipalRequest, identityFromRequest, decodedCookieValue } from "./principal-request-core.ts";
import { POLICY_VERSION } from "./policy-version.ts";
import { PRINCIPAL_WITH_ACCESS_SQL } from "./access-policy.ts";
import { hasProjectContextCookie } from "./project-request-context.ts";
import { packSponsorIntakeReadQuery } from "./experience-sponsor-intake-read-sql.ts";
import type { OutputSqlAssertion } from "./output-command-core.ts";
import { readSponsorIntakeCommand } from "./experience-sponsor-intake-command.ts";
import type { WorkerEnv } from "./runtime.ts";
import { createSponsorAudioIntakeReadBoundary, type SponsorAudioIntakeReadLimits } from "./experience-sponsor-audio-intake-approval.ts";

const fail = (code: string): never => { throw new SponsorEntitlementError(code); };
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/u.test(value);
const hash = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
const boundedJson = (column: string, maximumBytes: number) => `CASE WHEN typeof(${column})='text' AND length(CAST(${column} AS BLOB))<=${maximumBytes} AND instr(${column},char(0))=0 THEN ${column} END`;
const clock = "CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";
export type SponsorAudioOutputReadApprovalProposal = {
  version: 1; family: "canonical-audio-output-read@1"; campaignId: string; sponsorPolicyDigest: string; readPolicy: SponsorAudioOutputReadPolicyV1;
};
type OriginalApproval = { approval_id: string; campaign_id: string; payer_user_id: string; terms_json: string; terms_digest: string;
  policy_json: string; policy_digest: string; payer_authority_json: string; approval_command_json: string };

/** Dormant native-output read allocation: no initializer, registered route or launch
 * policy. Both new rows are installed together by the actual original V8 payer.
 * Neither a detached policy nor its digest is authority. */
export const SPONSOR_AUDIO_OUTPUT_READ_APPROVAL_SCHEMA = Object.freeze([
  `CREATE TABLE experience_sponsor_audio_output_read_approvals(
    approval_id TEXT PRIMARY KEY NOT NULL,campaign_id TEXT NOT NULL,sponsor_policy_digest TEXT NOT NULL,
    original_approval_id TEXT NOT NULL REFERENCES experience_sponsor_approvals(approval_id),payer_user_id TEXT NOT NULL,
    read_policy_digest TEXT NOT NULL,terms_json TEXT NOT NULL,terms_digest TEXT NOT NULL,
    review_receipt_json TEXT NOT NULL,review_receipt_digest TEXT UNIQUE NOT NULL,
    approval_command_json TEXT NOT NULL,approved_by_user_id TEXT NOT NULL,approved_at_ms INTEGER NOT NULL,
    UNIQUE(campaign_id,sponsor_policy_digest),CHECK(approved_by_user_id=payer_user_id),
    CHECK(typeof(approved_at_ms)='integer' AND approved_at_ms>=0),
    FOREIGN KEY(campaign_id,sponsor_policy_digest) REFERENCES experience_sponsor_audio_output_read_policies(campaign_id,sponsor_policy_digest)
      DEFERRABLE INITIALLY DEFERRED) WITHOUT ROWID`,
  ...["UPDATE", "DELETE"].map(action => `CREATE TRIGGER experience_sponsor_audio_output_read_approvals_no_${action.toLowerCase()}
    BEFORE ${action} ON experience_sponsor_audio_output_read_approvals BEGIN SELECT RAISE(ABORT,'sponsor_audio_output_read_approval_immutable'); END`),
  `CREATE TRIGGER experience_sponsor_audio_output_read_approvals_no_replace BEFORE INSERT ON experience_sponsor_audio_output_read_approvals
    WHEN EXISTS(SELECT 1 FROM main.experience_sponsor_audio_output_read_approvals old WHERE old.approval_id=NEW.approval_id
      OR (old.campaign_id=NEW.campaign_id AND old.sponsor_policy_digest=NEW.sponsor_policy_digest)
      OR old.review_receipt_digest=NEW.review_receipt_digest)
    BEGIN SELECT RAISE(ABORT,'sponsor_audio_output_read_approval_exists'); END`,
]);

function proposal(raw: unknown): Readonly<SponsorAudioOutputReadApprovalProposal> {
  if (jsonIssues(raw).length || !record(raw) || !exactKeys(raw, ["version", "family", "campaignId", "sponsorPolicyDigest", "readPolicy"])
    || raw.version !== 1 || raw.family !== "canonical-audio-output-read@1" || !id(raw.campaignId) || !hash(raw.sponsorPolicyDigest)) return fail("sponsor_audio_output_read_approval_terms_invalid");
  return freeze({ version: 1, family: "canonical-audio-output-read@1", campaignId: raw.campaignId, sponsorPolicyDigest: raw.sponsorPolicyDigest,
    readPolicy: readSponsorAudioOutputReadPolicy(raw.readPolicy) });
}

/** The unchanged Audio A boundary is bounded control transport only. Its name
 * conveys no intake permission here. Keep its Request/DB identity, cancellation,
 * complete-ACK byte accounting and caller-narrowed monotonic deadline. */
const policyInsertSql = `INSERT INTO main.experience_sponsor_audio_output_read_policies(campaign_id,sponsor_policy_digest,read_policy_digest,policy_json,review_receipt_digest)
        VALUES(?,?,?,?,?)`;
const approvalInsertSql = `INSERT INTO main.experience_sponsor_audio_output_read_approvals(approval_id,campaign_id,sponsor_policy_digest,original_approval_id,payer_user_id,
        read_policy_digest,terms_json,terms_digest,review_receipt_json,review_receipt_digest,approval_command_json,approved_by_user_id,approved_at_ms)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,${clock})`;

export type SponsorAudioOutputReadControlUsage = { bytes: number; queries: number; rows: number };
export type SponsorAudioOutputReadLimits = SponsorAudioIntakeReadLimits & {
  /** Caller-owned technical bootstrap counter, narrowing only; never authority. */
  sharedControl?: {
    remaining(): SponsorAudioOutputReadControlUsage;
    account(usage: SponsorAudioOutputReadControlUsage): void;
  };
};
export function createSponsorAudioOutputReadBoundary(request: Request, env: WorkerEnv, limits?: SponsorAudioOutputReadLimits) {
  const base = createSponsorAudioIntakeReadBoundary(request, env, limits), shared = limits?.sharedControl;
  let controlQueries = 0, controlRows = 0;
  const acknowledgementOverhead = 4096;
  const mutations = new WeakMap<D1PreparedStatement, "assertion" | "policy" | "approval">();
  const assertions = (items: readonly OutputSqlAssertion[]) => {
    const statements = base.assertions(items);
    for (const statement of statements) mutations.set(statement, "assertion");
    return statements;
  };
  const mutation = (sql: string, bindings: readonly (string | number | null)[]) => {
    base.check();
    if (sql !== policyInsertSql && sql !== approvalInsertSql || bindings.length !== (sql === policyInsertSql ? 5 : 12)
      || bindings.some(value => typeof value !== "string")) return fail("sponsor_audio_output_read_control_invalid");
    const statement = base.database.prepare(sql).bind(...bindings);
    mutations.set(statement, sql === policyInsertSql ? "policy" : "approval"); return statement;
  };
  const remaining = () => {
    base.check();
    const own = { bytes: 4_194_304 - base.controlBytes, queries: 1024 - controlQueries, rows: 65_536 - controlRows };
    const external = shared?.remaining();
    if (external) for (const key of ["bytes", "queries", "rows"] as const) {
      if (!Number.isSafeInteger(external[key]) || external[key] < 0) return fail("sponsor_audio_output_read_control_limit");
      own[key] = Math.min(own[key], external[key]);
    }
    return own;
  };
  const account = (usage: SponsorAudioOutputReadControlUsage) => {
    if (![usage.bytes, usage.queries, usage.rows].every(value => Number.isSafeInteger(value) && value >= 0))
      return fail("sponsor_audio_output_read_control_limit");
    controlQueries += usage.queries; controlRows += usage.rows;
    if (controlQueries > 1024 || controlRows > 65_536) return fail("sponsor_audio_output_read_control_limit");
    shared?.account(usage); base.check();
  };
  const query = async <T extends object>(sql: string, bindings: readonly (string | number | null)[], fields: readonly string[], maximum = 1): Promise<T[]> => {
    const room = remaining();
    if (room.queries < 1 || room.rows < 1 || room.bytes < acknowledgementOverhead + 2 || !Number.isSafeInteger(maximum) || maximum < 0 || maximum > 65_536
      || !fields.length || fields.length > 64 || new Set(fields).size !== fields.length || fields.some(field => !/^[a-z_][a-z0-9_]*$/u.test(field)))
      return fail("sponsor_audio_output_read_control_limit");
    const rowLimit = Math.min(maximum, room.rows);
    let prefix = "audio_output_control"; while (sql.toLowerCase().includes(prefix)) prefix += "_";
    let object = "'{}'";
    for (let index = 0; index < fields.length; index += 15)
      object = `json_set(${object},${fields.slice(index, index + 15).map(field => `'$.${field}',native."${field}"`).join(",")})`;
    const packed = packSponsorIntakeReadQuery(`WITH ${prefix}_rows AS MATERIALIZED (
        SELECT ${object} AS value FROM (${sql}) native LIMIT ${maximum + 1}),
      ${prefix}_body AS (SELECT COUNT(*) AS count,json_group_array(json(value)) AS body FROM ${prefix}_rows)
      SELECT count,length(CAST(json_quote(body) AS BLOB)) AS bytes,
        CASE WHEN count<=${rowLimit} AND length(CAST(json_quote(body) AS BLOB))<=${Math.max(0, room.bytes - acknowledgementOverhead)} THEN body END AS body
      FROM ${prefix}_body`, bindings);
    account({ bytes: 0, queries: 1, rows: 0 });
    const beforeBytes = base.controlBytes;
    const result = await base.query<{ count: number; bytes: number; body: string | null }>(packed.sql, packed.bindings, ["count", "bytes", "body"]);
    const actualBytes = base.controlBytes - beforeBytes, row = result[0];
    account({ bytes: actualBytes, queries: 0, rows: row && Number.isSafeInteger(row.count) && row.count >= 0 ? Math.max(1, row.count) : 1 });
    if (result.length !== 1 || !row || !Number.isSafeInteger(row.count) || row.count < 0 || row.count > rowLimit
      || !Number.isSafeInteger(row.bytes) || row.bytes < 0 || row.bytes > room.bytes - acknowledgementOverhead || typeof row.body !== "string" || actualBytes > room.bytes || actualBytes - row.bytes > acknowledgementOverhead)
      return fail("sponsor_audio_output_read_control_limit");
    const parsed: unknown = JSON.parse(row.body);
    if (!Array.isArray(parsed) || parsed.length !== row.count || parsed.some(value => !record(value) || !exactKeys(value, fields)
      || fields.some(field => value[field] !== null && typeof value[field] !== "string" && (typeof value[field] !== "number" || !Number.isFinite(value[field])))))
      return fail("sponsor_audio_output_read_control_invalid");
    base.check(); return parsed as T[];
  };
  const batch = async (statements: D1PreparedStatement[]) => {
    const room = remaining();
    if (!Array.isArray(statements) || !statements.length || statements.length > room.queries
      || statements.length * acknowledgementOverhead > room.bytes || room.rows < statements.length)
      return fail("sponsor_audio_output_read_control_limit");
    const kinds = statements.map(statement => mutations.get(statement));
    const policyIndex = kinds.indexOf("policy"), approvalIndex = kinds.indexOf("approval");
    if (kinds.some(kind => !kind) || kinds.filter(kind => kind === "policy").length > 1
      || kinds.filter(kind => kind === "approval").length > 1 || (policyIndex < 0) !== (approvalIndex < 0)
      || policyIndex >= 0 && approvalIndex !== policyIndex + 1) return fail("sponsor_audio_output_read_control_invalid");
    for (const statement of statements) mutations.delete(statement);
    account({ bytes: 0, queries: statements.length, rows: 0 });
    const beforeBytes = base.controlBytes;
    const acknowledgements = await base.batch(statements);
    if (acknowledgements.some(acknowledgement => acknowledgement.results.length !== 0))
      return fail("sponsor_audio_output_read_control_invalid");
    // Every actual result envelope is a control row for these exact no-row mutations.
    const rows = acknowledgements.reduce((total, acknowledgement) => total + Math.max(1, acknowledgement.results.length), 0);
    const bytes = base.controlBytes - beforeBytes;
    account({ bytes, queries: 0, rows });
    if (bytes > room.bytes || bytes > statements.length * acknowledgementOverhead || rows > room.rows) return fail("sponsor_audio_output_read_control_limit");
    return acknowledgements;
  };
  return { database: base.database, check: base.check, wait: base.wait, assertions, mutation, query, batch,
    get controlBytes() { return base.controlBytes; },
    get controlQueries() { base.check(); return controlQueries; },
    get controlRows() { base.check(); return controlRows; } };
}
const boundary = (env: WorkerEnv, request: Request, limits?: SponsorAudioOutputReadLimits) => createSponsorAudioOutputReadBoundary(request, env, limits);
type Boundary = ReturnType<typeof boundary>;

const principalColumns = ["user_id", "role", "consent_version", "updated_at", "permission_epoch", "grants_json", "organizations_json", "projects_json", "identity_policies_json", "approved_canvas_requirements", "email", "display_name", "consented_at"] as const;
const principalJsonColumns = new Set<string>(["grants_json", "organizations_json", "projects_json", "identity_policies_json"]);
const principalBound = principalColumns.map(column => column === "approved_canvas_requirements"
  ? `typeof(native.${column})='integer' AND native.${column} BETWEEN 0 AND 9007199254740991`
  : `${["consent_version", "consented_at"].includes(column) ? `(native.${column} IS NULL OR (` : "("}typeof(native.${column})='text'
    AND length(CAST(native.${column} AS BLOB))<=${principalJsonColumns.has(column) ? 131072 : column === "display_name" ? 4096 : 1024}
    AND instr(native.${column},char(0))=0${principalJsonColumns.has(column) ? ` AND CASE WHEN json_valid(native.${column}) THEN json_type(native.${column})='array' ELSE 0 END` : ""})${["consent_version", "consented_at"].includes(column) ? ")" : ""}`).join(" AND ");
// The unmodified native query may include private project labels. These are
// bounded internal authorization metadata, not a client/provider disclosure.
const principalQuery = `WITH native AS MATERIALIZED (${PRINCIPAL_WITH_ACCESS_SQL})
  SELECT ${principalColumns.map(column => `native.${column}`).join(",")} FROM native WHERE ${principalBound} LIMIT 2`;

function principalSnapshot(value: string, payerUserId: string): readonly unknown[] {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { return fail("sponsor_audio_output_read_principal_invalid"); }
  if (!Array.isArray(parsed) || parsed.length !== 13 || JSON.stringify(parsed) !== value || parsed[0] !== payerUserId
    || !["creator", "admin"].includes(parsed[1]) || typeof parsed[2] !== "string" || !parsed[2]
    || ![0, 1, 3, 4, 10, 11].every(index => typeof parsed[index] === "string")
    || parsed[12] !== null && typeof parsed[12] !== "string" || !Number.isSafeInteger(parsed[9]) || parsed[9] < 0)
    return fail("sponsor_audio_output_read_principal_invalid");
  for (const index of [5, 6, 7, 8]) {
    if (typeof parsed[index] !== "string") return fail("sponsor_audio_output_read_principal_invalid");
    let list: unknown; try { list = JSON.parse(parsed[index]); } catch { return fail("sponsor_audio_output_read_principal_invalid"); }
    if (!Array.isArray(list)) return fail("sponsor_audio_output_read_principal_invalid");
  }
  return parsed;
}

/** Capture the actual native graph after the bounded 13-column SQL read and
 * unchanged native completion. This pins own data and child identity without
 * imposing policy-envelope limits on legitimate large grants/project lists.
 * Rechecks examine only the captured graph; getters or replacement graphs never run. */
function nativePrincipalCurrent(principal: object): () => void {
  const seen = new WeakSet<object>();
  const nodes: { value: object; prototype: object | null; fields: { key: string; value: unknown; enumerable: boolean }[] }[] = [];
  const visit = (value: unknown) => {
    if (value === null) return;
    if (typeof value !== "object") {
      if (!["undefined", "string", "boolean", "number"].includes(typeof value) || typeof value === "number" && !Number.isFinite(value))
        return fail("sponsor_audio_output_read_principal_invalid");
      return;
    }
    if (seen.has(value)) return;
    seen.add(value);
    const prototype = Object.getPrototypeOf(value);
    if (![Object.prototype, Array.prototype, null].includes(prototype)) return fail("sponsor_audio_output_read_principal_invalid");
    const fields: { key: string; value: unknown; enumerable: boolean }[] = [];
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (typeof key !== "string" || !descriptor || !Object.hasOwn(descriptor, "value")) return fail("sponsor_audio_output_read_principal_invalid");
      fields.push({ key, value: descriptor.value, enumerable: descriptor.enumerable === true });
      visit(descriptor.value);
    }
    nodes.push({ value, prototype, fields });
  };
  visit(principal);
  return () => {
    for (const node of nodes) {
      const keys = Reflect.ownKeys(node.value);
      if (Object.getPrototypeOf(node.value) !== node.prototype || keys.length !== node.fields.length)
        return fail("sponsor_audio_output_read_principal_changed");
      for (let index = 0; index < keys.length; index++) {
        const expected = node.fields[index]!, actual = Object.getOwnPropertyDescriptor(node.value, expected.key);
        if (keys[index] !== expected.key || !actual || !Object.hasOwn(actual, "value") || actual.enumerable !== expected.enumerable
          || !Object.is(actual.value, expected.value)) return fail("sponsor_audio_output_read_principal_changed");
      }
    }
  };
}

/** Real native authentication through one exact, bounded query descriptor.
 * This returns a principal and current proof, never a future private-read grant.
 * The 13-column native snapshot, including private project labels, stays internal.
 * No lifecycle/schema operation, alternate principal completion or SQL fallback is allowed. */
async function readPrincipal(request: Request, env: WorkerEnv, bound: Boundary) {
  const identity = identityFromRequest(request);
  if (!identity || !id(identity.userId) || env.FORMA_PILOT_COHORT_ID?.trim()
    || decodedCookieValue(request, "forma_impersonation") || hasProjectContextCookie(request))
    return fail("sponsor_canonical_principal_required");
  const read = async () => {
    const rows = await bound.query<Record<string, string | number | null>>(principalQuery, [identity.userId], principalColumns);
    bound.check();
    if (rows.length !== 1) return fail("sponsor_audio_output_read_principal_invalid");
    return rows[0]!;
  };
  const before = await read(), principalSnapshotJson = JSON.stringify(principalColumns.map(column => before[column] ?? null));
  const captured = principalSnapshot(principalSnapshotJson, identity.userId);
  const unsupported = (): never => fail("sponsor_audio_output_read_principal_query_invalid");
  const database = new Proxy(bound.database, { get(_database, key) {
    if (key !== "prepare") return unsupported();
    return (sql: string) => {
      bound.check(); if (sql !== PRINCIPAL_WITH_ACCESS_SQL) return unsupported();
      const statement = bound.database.prepare(sql);
      const view = (boundIdentity: boolean): D1PreparedStatement => new Proxy(statement, { get(_statement, method) {
        if (method === "bind") return (...bindings: unknown[]) => {
          bound.check(); if (bindings.length !== 1 || bindings[0] !== identity.userId) return unsupported();
          return view(true);
        };
        if (method === "first") return async (column?: string) => {
          bound.check(); if (!boundIdentity || column !== undefined) return unsupported();
          const row = await read(); bound.check(); return row;
        };
        return unsupported();
      } });
      return view(false);
    };
  } });
  const nativeEnv = { ...env, DB: database };
  const auth = await bound.wait(() => readExistingPrincipalRequest(request, nativeEnv, "creator", { account: "principal" }));
  if ("kind" in auth || auth.response || !auth.user || auth.user.fictional || auth.user.projectExecution
    || auth.user.billingUserId && auth.user.billingUserId !== auth.user.userId || auth.user.consentVersion !== POLICY_VERSION
    || auth.user.userId !== identity.userId || auth.user.streamId !== `creative:${identity.userId}`)
    return fail("sponsor_canonical_principal_required");
  const principal = auth.user;
  const currentIdentity = () => canonicalJson({ userId: principal.userId, role: principal.role, consentVersion: principal.consentVersion,
    email: principal.email, displayName: principal.displayName, consentedAt: principal.consentedAt, authorizationSnapshot: principal.authorizationSnapshot });
  const expected = canonicalJson({ userId: captured[0], role: captured[1], consentVersion: captured[2], email: captured[10], displayName: captured[11],
    consentedAt: captured[12], authorizationSnapshot: { updatedAt: captured[3], rawEpoch: captured[4], grants: captured[5], organizations: captured[6],
      projects: captured[7], identityPolicies: captured[8], canvasRequirements: captured[9] } });
  if (currentIdentity() !== expected) return fail("sponsor_audio_output_read_principal_changed");
  const completePrincipalCurrent = nativePrincipalCurrent(principal);
  const assertCurrent = () => { bound.check(); completePrincipalCurrent();
    if (currentIdentity() !== expected)
      return fail("sponsor_audio_output_read_principal_changed");
  };
  assertCurrent();
  const assertion: OutputSqlAssertion = { sql: `EXISTS(SELECT 1 FROM (${principalQuery}) captured WHERE json_array(${principalColumns.map(column => `captured.${column}`).join(",")})=?)`,
    bindings: [identity.userId, principalSnapshotJson] };
  const proof = await bound.query<{ current: number }>(`SELECT CASE WHEN (${assertion.sql}) THEN 1 ELSE 0 END AS current`, assertion.bindings!, ["current"]);
  assertCurrent(); if (proof.length !== 1 || proof[0]!.current !== 1) return fail("sponsor_audio_output_read_principal_changed");
  return { principal, principalSnapshotJson, assertions: [assertion], controlBytes: bound.controlBytes,
    controlQueries: bound.controlQueries, controlRows: bound.controlRows, assertCurrent };
}

export async function readSponsorAudioOutputPrincipal(request: Request, env: WorkerEnv, limits?: SponsorAudioOutputReadLimits) {
  const bound = boundary(env, request, limits);
  const result = await readPrincipal(request, env, bound);
  result.assertCurrent(); bound.check(); return result;
}

// Exact stored SQL produced by output-requirements-schema.ts's native DDL.
// SQLite omits IF NOT EXISTS from sqlite_schema.sql. No schema is installed here.
const assertionSinkSql = "CREATE TABLE output_atomic_assertions(token TEXT PRIMARY KEY NOT NULL,passed INTEGER NOT NULL CHECK(passed=1))";
const assertionSinkObject = ["table", "output_atomic_assertions", assertionSinkSql] as const;
const assertionSinkSnapshot = JSON.stringify([assertionSinkObject]);
const assertionSinkQuery = `WITH selected AS MATERIALIZED (
    SELECT type,name,sql FROM main.sqlite_schema WHERE tbl_name='output_atomic_assertions' AND sql IS NOT NULL
    ORDER BY name COLLATE BINARY LIMIT 2), packed AS (
    SELECT COUNT(*) AS total,json_group_array(json_array(type,name,sql)) AS snapshot FROM selected)
  SELECT CASE WHEN total=1 AND length(CAST(snapshot AS BLOB))<=4096 THEN snapshot END AS snapshot FROM packed`;

/** Exact native NOT-NULL/CHECK sink and absence of additional attached objects.
 * This qualifies an existing transaction primitive; it creates no schema or authority. */
export async function qualifySponsorAudioOutputReadAssertionSink(request: Request, env: WorkerEnv, limits?: SponsorAudioOutputReadLimits) {
  const bound = boundary(env, request, limits);
  const rows = await bound.query<{ snapshot: string }>(assertionSinkQuery, [], ["snapshot"]);
  if (rows.length !== 1 || rows[0]!.snapshot !== assertionSinkSnapshot) return fail("sponsor_audio_output_read_assertion_sink_unavailable");
  const assertion: OutputSqlAssertion = { sql: `EXISTS(SELECT 1 FROM (${assertionSinkQuery}) WHERE snapshot=?)`, bindings: [assertionSinkSnapshot] };
  bound.check(); return { assertion, controlBytes: bound.controlBytes, controlQueries: bound.controlQueries, controlRows: bound.controlRows };
}

const approvalSchemaObjects = [...[...SPONSOR_AUDIO_OUTPUT_READ_POLICY_SCHEMA, ...SPONSOR_AUDIO_OUTPUT_READ_APPROVAL_SCHEMA].map(sql => {
  const match = /^CREATE (TABLE|INDEX|TRIGGER) ([a-z0-9_]+)/u.exec(sql)!;
  return [match[1]!.toLowerCase(), match[2]!, sql] as const;
}), assertionSinkObject].sort((a, b) => a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);
const approvalSchemaSnapshot = JSON.stringify(approvalSchemaObjects);
const approvalSchemaQuery = `WITH selected AS MATERIALIZED (
    SELECT type,name,sql FROM main.sqlite_schema
    WHERE tbl_name IN('experience_sponsor_audio_output_read_policies','experience_sponsor_audio_output_read_approvals','output_atomic_assertions') AND sql IS NOT NULL
    ORDER BY name COLLATE BINARY LIMIT ${approvalSchemaObjects.length + 1}), packed AS (
    SELECT COUNT(*) AS total,json_group_array(json_array(type,name,sql)) AS snapshot FROM selected)
  SELECT CASE WHEN total=${approvalSchemaObjects.length} AND length(CAST(snapshot AS BLOB))<=65536 THEN snapshot END AS snapshot FROM packed`;
async function approvalSchema(bound: Boundary): Promise<OutputSqlAssertion> {
  const rows = await bound.query<{ snapshot: string }>(approvalSchemaQuery, [], ["snapshot"]);
  if (rows.length !== 1 || rows[0]!.snapshot !== approvalSchemaSnapshot) return fail("sponsor_audio_output_read_approval_schema_unavailable");
  return { sql: `EXISTS(SELECT 1 FROM (${approvalSchemaQuery}) WHERE snapshot=?)`, bindings: [approvalSchemaSnapshot] };
}

async function originalProof(original: OriginalApproval, campaignId: string, sponsorPolicyDigest: string, bound: Boundary) {
  if (![original.terms_json, original.policy_json, original.payer_authority_json, original.approval_command_json].every(value => typeof value === "string")
    || !id(original.approval_id) || !id(original.payer_user_id) || !hash(original.terms_digest)) return fail("sponsor_audio_output_read_original_approval_unavailable");
  let originalTerms: unknown; try { originalTerms = JSON.parse(original.terms_json); } catch { return fail("sponsor_audio_output_read_original_approval_unavailable"); }
  principalSnapshot(original.payer_authority_json, original.payer_user_id);
  const compiled = await bound.wait(() => compileSponsorApprovalProposal(originalTerms));
  if (!record(originalTerms) || !Array.isArray(originalTerms.issuerUserIds) || !id(originalTerms.issuerUserIds[0])
    || compiled.policy.version !== 8 || compiled.policy.family !== "canonical-instrumental-cue@1"
    || original.campaign_id !== campaignId || original.policy_digest !== sponsorPolicyDigest
    || compiled.policy.campaignId !== campaignId || compiled.policy.payerUserId !== original.payer_user_id
    || compiled.policyDigest !== sponsorPolicyDigest || original.policy_json !== compiled.policyJson
    || original.terms_json !== compiled.termsJson || original.terms_digest !== compiled.termsDigest
    || original.approval_command_json !== canonicalJson({ action: "approve-sponsor-campaign", approvalId: original.approval_id,
      proposal: originalTerms, confirmation: "APPROVE_SPONSOR_CAMPAIGN", reviewedTermsDigest: compiled.termsDigest })) return fail("sponsor_audio_output_read_original_approval_unavailable");
  return { compiled, issuerUserId: originalTerms.issuerUserIds[0] };
}
const termsFor = (input: Readonly<SponsorAudioOutputReadApprovalProposal>, original: OriginalApproval) => freeze({
  purpose: "sponsor-audio-output-read-policy" as const, proposal: input, payerUserId: original.payer_user_id,
  originalApprovalId: original.approval_id, originalTermsDigest: original.terms_digest,
});
const originalFields = ["approval_id", "campaign_id", "payer_user_id", "terms_json", "terms_digest", "policy_digest", "policy_json", "payer_authority_json", "approval_command_json"] as const;
const originalSelect = (alias: string) => [
  ["approval_id", 200], ["campaign_id", 200], ["payer_user_id", 200], ["terms_json", 131072], ["terms_digest", 71],
  ["policy_digest", 71], ["policy_json", 262144], ["payer_authority_json", 131072], ["approval_command_json", 131072],
].map(([column, limit]) => `${boundedJson(`${alias}.${column}`, Number(limit))} AS ${column}`).join(",");

/** Native authentication supplies the actual caller. The original issuer is
 * only a witness to that recorded approval, never an impersonated payer. */
async function review(request: Request, env: WorkerEnv, raw: unknown, bound: Boundary) {
  const input = proposal(raw);
  const schema = await approvalSchema(bound);
  const authenticated = await bound.wait(() => readPrincipal(request, env, bound));
  const payer = authenticated.principal;
  authenticated.assertCurrent();
  const original = (await bound.query<OriginalApproval>(`SELECT ${originalSelect("approval")}
    FROM main.experience_sponsor_approvals approval WHERE approval.campaign_id=? AND approval.policy_digest=? LIMIT 2`,
    [input.campaignId, input.sponsorPolicyDigest], originalFields))[0];
  if (!original || original.payer_user_id !== payer.userId || original.payer_authority_json !== authenticated.principalSnapshotJson) return fail("sponsor_audio_output_read_payer_approval_required");
  const { compiled, issuerUserId } = await originalProof(original, input.campaignId, input.sponsorPolicyDigest, bound);
  const assertions: OutputSqlAssertion[] = [
    schema, ...authenticated.assertions,
    sponsorApprovalAssertion(compiled.policy, issuerUserId, true),
    { sql: `EXISTS(SELECT 1 FROM main.experience_sponsor_campaigns campaign JOIN main.experience_sponsor_approvals approval
        ON approval.campaign_id=campaign.campaign_id WHERE campaign.campaign_id=? AND campaign.enabled=1
        AND campaign.policy_digest=? AND campaign.policy_json=? AND approval.approval_id=? AND approval.terms_json=?
        AND approval.terms_digest=? AND approval.policy_digest=? AND approval.payer_authority_json=? AND approval.approval_command_json=?)
        AND ${clock}>=? AND ${clock}<?`,
      bindings: [input.campaignId, compiled.policyDigest, compiled.policyJson, original.approval_id, compiled.termsJson,
        compiled.termsDigest, compiled.policyDigest, original.payer_authority_json, original.approval_command_json,
        compiled.policy.startsAtMs, compiled.policy.expiresAtMs] },
    { sql: `NOT EXISTS(SELECT 1 FROM pilot_participants participant JOIN pilot_cohorts cohort ON cohort.cohort_id=participant.cohort_id
      WHERE (participant.user_id=? OR participant.email_normalized=?) AND participant.status='active' AND participant.revoked_at IS NULL AND cohort.status IN('active','paused','closed'))`,
      bindings: [payer.userId, payer.email] },
    { sql: "EXISTS(SELECT 1 FROM users WHERE user_id=? AND email=?)", bindings: [payer.userId, payer.email] },
  ];
  const terms = termsFor(input, original), termsJson = canonicalJson(terms);
  const termsDigest = await bound.wait(() => digest(terms)), readPolicyDigest = await bound.wait(() => digest(input.readPolicy));
  authenticated.assertCurrent();
  return { input, original, assertions, terms, termsJson, termsDigest, readPolicyDigest, policyJson: canonicalJson(input.readPolicy), assertCurrent: authenticated.assertCurrent };
}

/** Payer-authenticated preparation retains no policy, approval or business state.
 * Native assertion rows are checked and removed in one transaction. The returned
 * digest describes a review, never a capability or substitute for commit proof. */
export async function prepareSponsorAudioOutputReadApproval(request: Request, env: WorkerEnv) {
  const bound = boundary(env, request);
  const raw = await bound.wait(() => readSponsorIntakeCommand(request));
  if (!record(raw) || !exactKeys(raw, ["action", "proposal"]) || raw.action !== "prepare-sponsor-audio-output-read-policy") return fail("sponsor_explicit_command_required");
  const checked = await review(request, env, raw.proposal, bound);
  checked.assertCurrent();
  await bound.batch(bound.assertions(checked.assertions));
  checked.assertCurrent(); bound.check();
  return freeze({ terms: checked.terms, termsDigest: checked.termsDigest, readPolicyDigest: checked.readPolicyDigest });
}

/** Exact explicit payer review, immutable one-time policy, bounded internal control-metadata replay.
 * Active campaign authority is required to provision/replay this command; it
 * never becomes a requirement for consuming already provisioned historical read terms.
 * No grant, native storage, provider call, financial hold or read-attempt credit is created. */
export async function approveSponsorAudioOutputReadPolicy(request: Request, env: WorkerEnv) {
  const bound = boundary(env, request);
  const raw = await bound.wait(() => readSponsorIntakeCommand(request));
  if (jsonIssues(raw).length || !record(raw) || !exactKeys(raw, ["action", "approvalId", "proposal", "reviewedTermsDigest", "confirmation"])
    || raw.action !== "approve-sponsor-audio-output-read-policy" || !id(raw.approvalId) || !hash(raw.reviewedTermsDigest)
    || raw.confirmation !== "APPROVE_SPONSOR_AUDIO_OUTPUT_READ_POLICY") return fail("sponsor_explicit_approval_required");
  const input = JSON.parse(canonicalJson(raw)) as typeof raw;
  const checked = await review(request, env, input.proposal, bound);
  if (input.reviewedTermsDigest !== checked.termsDigest) return fail("sponsor_audio_output_read_terms_not_reviewed");
  const approvalId = String(input.approvalId), approvalCommandJson = canonicalJson(input);
  const receipt = freeze({ version: 1, purpose: "sponsor-audio-output-read-policy-approval", approvalId,
    termsDigest: checked.termsDigest, readPolicyDigest: checked.readPolicyDigest, approvedByUserId: checked.terms.payerUserId,
    payerAuthorityJson: checked.original.payer_authority_json, approvalCommandDigest: await bound.wait(() => digest(input)) });
  const receiptJson = canonicalJson(receipt), receiptDigest = await bound.wait(() => digest(receipt));
  const proof: OutputSqlAssertion = { sql: `EXISTS(SELECT 1 FROM main.experience_sponsor_audio_output_read_approvals approval
    JOIN main.experience_sponsor_audio_output_read_policies policy ON policy.campaign_id=approval.campaign_id AND policy.sponsor_policy_digest=approval.sponsor_policy_digest
    WHERE approval.approval_id=? AND approval.campaign_id=? AND approval.sponsor_policy_digest=? AND approval.original_approval_id=?
      AND approval.payer_user_id=? AND approval.approved_by_user_id=? AND approval.read_policy_digest=? AND approval.terms_json=? AND approval.terms_digest=?
      AND approval.review_receipt_json=? AND approval.review_receipt_digest=? AND approval.approval_command_json=?
      AND policy.read_policy_digest=approval.read_policy_digest AND policy.policy_json=? AND policy.review_receipt_digest=approval.review_receipt_digest)`,
    bindings: [approvalId, checked.input.campaignId, checked.input.sponsorPolicyDigest, checked.original.approval_id,
      checked.terms.payerUserId, checked.terms.payerUserId, checked.readPolicyDigest, checked.termsJson, checked.termsDigest,
      receiptJson, receiptDigest, approvalCommandJson, checked.policyJson] };
  const finish = async (replayed: boolean) => {
    await bound.batch(bound.assertions([...checked.assertions, proof]));
    checked.assertCurrent(); bound.check();
    return freeze({ replayed, approvalId, campaignId: checked.input.campaignId, sponsorPolicyDigest: checked.input.sponsorPolicyDigest,
      readPolicyDigest: checked.readPolicyDigest, reviewReceiptDigest: receiptDigest, termsDigest: checked.termsDigest });
  };
  const exists = async () => (await bound.query<{ present: number }>(`SELECT 1 AS present FROM main.experience_sponsor_audio_output_read_approvals
    WHERE approval_id=? OR (campaign_id=? AND sponsor_policy_digest=?) LIMIT 1`,
    [approvalId, checked.input.campaignId, checked.input.sponsorPolicyDigest], ["present"])).some(row => row.present === 1);
  let replayed = await exists();
  if (!replayed) {
    try {
      await bound.batch([
        ...bound.assertions(checked.assertions),
        bound.mutation(policyInsertSql, [checked.input.campaignId, checked.input.sponsorPolicyDigest, checked.readPolicyDigest, checked.policyJson, receiptDigest]),
        bound.mutation(approvalInsertSql, [approvalId, checked.input.campaignId, checked.input.sponsorPolicyDigest, checked.original.approval_id,
          checked.terms.payerUserId, checked.readPolicyDigest, checked.termsJson, checked.termsDigest, receiptJson, receiptDigest, approvalCommandJson, checked.terms.payerUserId]),
        ...bound.assertions([...checked.assertions, proof]),
      ]);
    } catch (error) {
      bound.check();
      // Recover the exact committed row after an ambiguous acknowledgment. A
      // conflict fails the full proof; never overwrite a row or reset read usage.
      if (!await exists()) throw error;
      replayed = true;
    }
  }
  // Await the inner proof here: directly adopting its promise would leave one
  // more unguarded async continuation in this exported approval boundary.
  const result = await finish(replayed);
  checked.assertCurrent(); bound.check();
  return result;
}

type RetainedReadRow = { campaign_id: string; sponsor_policy_digest: string; read_policy_digest: string; policy_json: string;
  review_receipt_digest: string; approval_id: string; original_approval_id: string; payer_user_id: string;
  terms_json: string; terms_digest: string; review_receipt_json: string; approval_command_json: string };
const retainedFrom = `FROM main.experience_sponsor_audio_output_read_policies policy
  JOIN main.experience_sponsor_audio_output_read_approvals approval ON approval.campaign_id=policy.campaign_id
    AND approval.sponsor_policy_digest=policy.sponsor_policy_digest AND approval.read_policy_digest=policy.read_policy_digest
    AND approval.review_receipt_digest=policy.review_receipt_digest AND approval.approved_by_user_id=approval.payer_user_id
  JOIN main.experience_sponsor_approvals original ON original.approval_id=approval.original_approval_id
    AND original.campaign_id=policy.campaign_id AND original.policy_digest=policy.sponsor_policy_digest
    AND original.payer_user_id=approval.payer_user_id AND original.approved_by_user_id=original.payer_user_id`;

/** Read-only, bounded immutable provenance, never a raw read capability. Current
 * actor/custody and request/byte reservations belong to the separate consumer.
 * Revocation, expiry or changed payer consent cannot erase an owned result's
 * original approval. This reconstructs provenance even after read-policy expiry;
 * consumers separately enforce its startsAtMs/expiresAtMs, current native custody
 * and durable bytes/query/row debit. No current generation predicate is used here. */
export async function readApprovedSponsorAudioOutputReadPolicy(request: Request, env: WorkerEnv, campaignId: string, sponsorPolicyDigest: string, limits?: SponsorAudioOutputReadLimits) {
  const bound = boundary(env, request, limits), unavailable = () => fail("sponsor_audio_output_read_policy_unavailable");
  if (!id(campaignId) || !hash(sponsorPolicyDigest)) return unavailable();
  const schema = await approvalSchema(bound);
  const projectionFields = [
    ["policy.campaign_id", "campaign_id", 200], ["policy.sponsor_policy_digest", "sponsor_policy_digest", 71],
    ["policy.read_policy_digest", "read_policy_digest", 71], ["policy.policy_json", "policy_json", 8192],
    ["policy.review_receipt_digest", "review_receipt_digest", 71], ["approval.approval_id", "approval_id", 200],
    ["approval.original_approval_id", "original_approval_id", 200], ["approval.payer_user_id", "payer_user_id", 200],
    ["approval.terms_json", "terms_json", 16384], ["approval.terms_digest", "terms_digest", 71],
    ["approval.review_receipt_json", "review_receipt_json", 262144], ["approval.approval_command_json", "approval_command_json", 32768],
  ] as const;
  const projections = projectionFields.map(([column, alias, maximum]) => `${boundedJson(column, maximum)} AS ${alias}`).join(",");
  const row = (await bound.query<RetainedReadRow>(`SELECT ${projections} ${retainedFrom}
    WHERE policy.campaign_id=? AND policy.sponsor_policy_digest=? LIMIT 2`, [campaignId, sponsorPolicyDigest], projectionFields.map(field => field[1])))[0];
  if (!row || row.campaign_id !== campaignId || row.sponsor_policy_digest !== sponsorPolicyDigest
    || ![row.read_policy_digest, row.review_receipt_digest, row.terms_digest].every(hash)
    || ![row.approval_id, row.original_approval_id, row.payer_user_id].every(id)
    || ![row.policy_json, row.terms_json, row.review_receipt_json, row.approval_command_json].every(value => typeof value === "string")) return unavailable();
  const original = (await bound.query<OriginalApproval>(`SELECT ${originalSelect("approval")}
    FROM main.experience_sponsor_approvals approval WHERE approval.approval_id=? AND approval.campaign_id=? AND approval.policy_digest=? LIMIT 2`,
    [row.original_approval_id, campaignId, sponsorPolicyDigest], originalFields))[0];
  if (!original || original.payer_user_id !== row.payer_user_id) return unavailable();
  await originalProof(original, campaignId, sponsorPolicyDigest, bound);
  let raw: unknown; try { raw = JSON.parse(row.policy_json); } catch { return unavailable(); }
  const policy = readSponsorAudioOutputReadPolicy(raw);
  if (row.policy_json !== canonicalJson(policy) || row.read_policy_digest !== await bound.wait(() => digest(policy))) return unavailable();
  const input = proposal({ version: 1, family: "canonical-audio-output-read@1", campaignId, sponsorPolicyDigest, readPolicy: policy });
  const terms = termsFor(input, original);
  if (row.terms_json !== canonicalJson(terms) || row.terms_digest !== await bound.wait(() => digest(terms))) return unavailable();
  const command = { action: "approve-sponsor-audio-output-read-policy", approvalId: row.approval_id, proposal: input,
    reviewedTermsDigest: row.terms_digest, confirmation: "APPROVE_SPONSOR_AUDIO_OUTPUT_READ_POLICY" };
  const receipt = { version: 1, purpose: "sponsor-audio-output-read-policy-approval", approvalId: row.approval_id,
    termsDigest: row.terms_digest, readPolicyDigest: row.read_policy_digest, approvedByUserId: row.payer_user_id,
    payerAuthorityJson: original.payer_authority_json, approvalCommandDigest: await bound.wait(() => digest(command)) };
  if (row.approval_command_json !== canonicalJson(command) || row.review_receipt_json !== canonicalJson(receipt)
    || row.review_receipt_digest !== await bound.wait(() => digest(receipt))) return unavailable();
  const assertion: OutputSqlAssertion = { sql: `EXISTS(SELECT 1 ${retainedFrom}
    WHERE policy.campaign_id=? AND policy.sponsor_policy_digest=? AND policy.read_policy_digest=? AND policy.policy_json=?
      AND policy.review_receipt_digest=? AND approval.approval_id=? AND approval.original_approval_id=? AND approval.payer_user_id=?
      AND approval.terms_json=? AND approval.terms_digest=? AND approval.review_receipt_json=? AND approval.approval_command_json=?
      AND original.terms_json=? AND original.terms_digest=? AND original.policy_json=? AND original.payer_authority_json=?
      AND original.approval_command_json=?)`,
    bindings: [campaignId, sponsorPolicyDigest, row.read_policy_digest, row.policy_json, row.review_receipt_digest,
      row.approval_id, row.original_approval_id, row.payer_user_id, row.terms_json, row.terms_digest, row.review_receipt_json,
      row.approval_command_json, original.terms_json, original.terms_digest, original.policy_json, original.payer_authority_json,
      original.approval_command_json] };
  bound.check();
  return freeze({ policy, readPolicyDigest: row.read_policy_digest, reviewReceiptDigest: row.review_receipt_digest,
    approvalId: row.approval_id, originalApprovalId: row.original_approval_id, payerUserId: row.payer_user_id,
    assertions: [schema, assertion], controlBytes: bound.controlBytes, controlQueries: bound.controlQueries, controlRows: bound.controlRows });
}
