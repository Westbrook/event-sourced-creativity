import { canonicalJson, digest, exactKeys, freeze, jsonIssues, record } from "../src/experiences/compiler.ts";
import { isDraftId, isIntentId } from "../src/experiences/intake.ts";
import { SponsorEntitlementError } from "./experience-sponsor-policy.ts";
import { readSponsorStoryIntakePolicy, type SponsorStoryIntakePolicyV1 } from "./experience-sponsor-story-intake-policy.ts";
import { createSponsorStoryIntakeReadBoundary, type SponsorStoryIntakeReadLimits } from "./experience-sponsor-story-intake-approval.ts";
import type { OutputSqlAssertion } from "./output-command-core.ts";
import type { WorkerEnv } from "./runtime.ts";

type Binding = string | number | null;
export type SponsorStoryIntakeSqlStatement = Readonly<{ sql: string; bindings: readonly Binding[] }>;
export type SponsorStoryIntakeReceipt = Readonly<{
  receiptId: string; allocationId: string; campaignId: string; sponsorPolicyDigest: string; intakePolicyDigest: string;
  intakeApprovalId: string; actorUserId: string; sessionDigest: string; nativeIntentId: string; draftId: string;
  projectId: string; documentId: string; draftHash: string; bodyDigest: string; contentDigest: string; sourceDigest: string;
  eventPayloadDigest: string; eventCount: number; draftBytes: number; eventBytes: number; totalBytes: number;
  expiresAt: string; recordedAtMs: number;
}>;
export type SponsorStoryIntakeStorageInput = Omit<SponsorStoryIntakeReceipt, "recordedAtMs"> & { policy: SponsorStoryIntakePolicyV1 };
const fail = (): never => { throw new SponsorEntitlementError("sponsor_story_intake_storage_unavailable"); };
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/u.test(value);
const hash = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
const integer = (value: unknown, max: number): value is number => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= max;
const clock = "CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";
const allocationTable = "experience_sponsor_story_intake_allocations", receiptTable = "experience_sponsor_story_intakes";
const fields = Object.freeze([
  ["receiptId", "receipt_id", 200], ["allocationId", "allocation_id", 200], ["campaignId", "campaign_id", 200],
  ["sponsorPolicyDigest", "sponsor_policy_digest", 71], ["intakePolicyDigest", "intake_policy_digest", 71],
  ["intakeApprovalId", "intake_approval_id", 200], ["actorUserId", "actor_user_id", 200], ["sessionDigest", "session_digest", 71],
  ["nativeIntentId", "native_intent_id", 36], ["draftId", "draft_id", 81], ["projectId", "project_id", 200], ["documentId", "document_id", 200],
  ["draftHash", "draft_hash", 71], ["bodyDigest", "body_digest", 71], ["contentDigest", "content_digest", 71],
  ["sourceDigest", "source_digest", 71], ["eventPayloadDigest", "event_payload_digest", 71],
  ["eventCount", "event_count", 0], ["draftBytes", "draft_bytes", 0], ["eventBytes", "event_bytes", 0], ["totalBytes", "total_bytes", 0],
  ["expiresAt", "expires_at", 24], ["recordedAtMs", "recorded_at_ms", 0],
] as const);
export const SPONSOR_STORY_INTAKE_RECEIPT_COLUMNS = Object.freeze(fields.map(field => field[1]));
const inputFields = fields.filter(field => field[0] !== "recordedAtMs");
const commonColumns = `receipt_id TEXT NOT NULL,allocation_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,sponsor_policy_digest TEXT NOT NULL,intake_policy_digest TEXT NOT NULL,
  intake_approval_id TEXT NOT NULL REFERENCES experience_sponsor_story_intake_approvals(approval_id),
  actor_user_id TEXT NOT NULL,session_digest TEXT NOT NULL,native_intent_id TEXT NOT NULL,
  project_id TEXT NOT NULL,document_id TEXT NOT NULL,draft_hash TEXT NOT NULL,body_digest TEXT NOT NULL,
  content_digest TEXT NOT NULL,source_digest TEXT NOT NULL,event_payload_digest TEXT NOT NULL,
  event_count INTEGER NOT NULL CHECK(typeof(event_count)='integer' AND event_count IN(9,10)),
  draft_bytes INTEGER NOT NULL CHECK(typeof(draft_bytes)='integer' AND draft_bytes BETWEEN 1 AND 1048576),
  event_bytes INTEGER NOT NULL CHECK(typeof(event_bytes)='integer' AND event_bytes BETWEEN 1 AND 1048576),
  total_bytes INTEGER NOT NULL CHECK(typeof(total_bytes)='integer' AND total_bytes=draft_bytes+event_bytes AND total_bytes<=2097152),
  expires_at TEXT NOT NULL,recorded_at_ms INTEGER NOT NULL CHECK(typeof(recorded_at_ms)='integer' AND recorded_at_ms>=0)`;
const immutable = (table: string, identity: string) => [
  ...["UPDATE", "DELETE"].map(action => `CREATE TRIGGER ${table}_no_${action.toLowerCase()} BEFORE ${action} ON ${table}
    BEGIN SELECT RAISE(ABORT,'sponsor_story_intake_storage_immutable'); END`),
  `CREATE TRIGGER ${table}_no_replace BEFORE INSERT ON ${table}
    WHEN EXISTS(SELECT 1 FROM ${table} old WHERE ${identity})
    BEGIN SELECT RAISE(ABORT,'sponsor_story_intake_storage_exists'); END`,
];
const duplicate = "old.draft_id=NEW.draft_id OR old.allocation_id=NEW.allocation_id OR old.receipt_id=NEW.receipt_id OR (old.actor_user_id=NEW.actor_user_id AND old.native_intent_id=NEW.native_intent_id)";

/** Dormant immutable logical-byte journal. No schema initialization, native
 * draft mutation, monetary entry, refund or generation allocation occurs here.
 * The exact sidecar PK is also the negative classifier's structural contract. */
export const SPONSOR_STORY_INTAKE_STORAGE_SCHEMA = Object.freeze([
  `CREATE TABLE ${allocationTable}(draft_id TEXT UNIQUE NOT NULL,${commonColumns},
    PRIMARY KEY(allocation_id),UNIQUE(receipt_id),UNIQUE(actor_user_id,native_intent_id)) WITHOUT ROWID`,
  `CREATE INDEX idx_sponsor_story_intake_allocation_campaign ON ${allocationTable}(campaign_id,recorded_at_ms)`,
  `CREATE INDEX idx_sponsor_story_intake_allocation_actor ON ${allocationTable}(campaign_id,actor_user_id,recorded_at_ms)`,
  ...immutable(allocationTable, duplicate),
  `CREATE TABLE ${receiptTable}(draft_id TEXT PRIMARY KEY NOT NULL,${commonColumns},
    UNIQUE(allocation_id),UNIQUE(receipt_id),UNIQUE(actor_user_id,native_intent_id),
    FOREIGN KEY(allocation_id) REFERENCES ${allocationTable}(allocation_id)) WITHOUT ROWID`,
  ...immutable(receiptTable, duplicate),
]);

// This exact dormant DDL also defines the indexed lookup and immutable receipt
// boundaries. Automatic unique indexes are established by the pinned CREATE
// TABLE text; every explicit index and trigger must match as well. Aggregate
// bounded catalog text before crossing SQLite -> Worker, and carry its witness.
const schemaObjects = SPONSOR_STORY_INTAKE_STORAGE_SCHEMA.map(sql => {
  const match = /^CREATE (TABLE|INDEX|TRIGGER) ([a-z0-9_]+)/u.exec(sql)!;
  return [match[1]!.toLowerCase(), match[2]!, sql] as const;
}).sort((a, b) => a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);
const schemaSnapshot = JSON.stringify(schemaObjects);
const schemaQuery = `WITH selected AS MATERIALIZED (
    SELECT type,name,sql FROM main.sqlite_schema WHERE tbl_name IN('${allocationTable}','${receiptTable}') AND sql IS NOT NULL
    ORDER BY name COLLATE BINARY LIMIT ${schemaObjects.length + 1}), packed AS (
    SELECT COUNT(*) AS total,json_group_array(json_array(type,name,sql)) AS snapshot FROM selected)
  SELECT CASE WHEN total=${schemaObjects.length} AND length(CAST(snapshot AS BLOB))<=65536 THEN snapshot END AS snapshot FROM packed`;
const storageSchemaAssertion = (): OutputSqlAssertion => ({
  sql: `EXISTS(SELECT 1 FROM (${schemaQuery}) WHERE snapshot=?)`, bindings: [schemaSnapshot],
});

function validateReceipt(raw: unknown, stored: boolean): asserts raw is SponsorStoryIntakeReceipt {
  const keys = (stored ? fields : inputFields).map(field => field[0]);
  if (jsonIssues(raw).length || !record(raw) || !exactKeys(raw, keys)
    || ![raw.receiptId, raw.allocationId, raw.campaignId, raw.intakeApprovalId, raw.actorUserId, raw.projectId, raw.documentId].every(id)
    || ![raw.sponsorPolicyDigest, raw.intakePolicyDigest, raw.sessionDigest, raw.draftHash, raw.bodyDigest, raw.contentDigest, raw.sourceDigest, raw.eventPayloadDigest].every(hash)
    || !isIntentId(raw.nativeIntentId) || typeof raw.draftId !== "string" || !isDraftId(raw.draftId)
    || raw.eventCount !== 9 && raw.eventCount !== 10 || !integer(raw.draftBytes, 1_048_576) || !raw.draftBytes
    || !integer(raw.eventBytes, 1_048_576) || !raw.eventBytes || !integer(raw.totalBytes, 2_097_152)
    || raw.totalBytes !== raw.draftBytes + raw.eventBytes || typeof raw.expiresAt !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(raw.expiresAt)
    || !Number.isFinite(Date.parse(raw.expiresAt)) || new Date(raw.expiresAt).toISOString() !== raw.expiresAt
    || stored && !integer(raw.recordedAtMs, 8_000_000_000_000)) fail();
}
const joined = `FROM main.${receiptTable} receipt JOIN main.${allocationTable} allocation
  ON allocation.allocation_id=receipt.allocation_id AND ${fields.map(([, column]) => `allocation.${column}=receipt.${column}`).join(" AND ")}`;
const projection = fields.map(([, column, cap]) => cap
  ? `CASE WHEN typeof(receipt.${column})='text' AND length(CAST(receipt.${column} AS BLOB))<=${cap}
      AND instr(receipt.${column},char(0))=0 THEN receipt.${column} END AS ${column}`
  : `CASE WHEN typeof(receipt.${column})='integer' AND receipt.${column} BETWEEN 0 AND 8000000000000 THEN receipt.${column} END AS ${column}`).join(",");

/** Bounded original metadata descriptor; no private body appears in this SQL.
 * The PK bounds one candidate; incomplete or contradictory pairs refuse. */
export function sponsorStoryIntakeReceiptLookup(draftId: string): SponsorStoryIntakeSqlStatement {
  if (!isDraftId(draftId)) return fail();
  return freeze({ sql: `SELECT ${projection} ${joined} WHERE receipt.draft_id COLLATE BINARY=? LIMIT 2`, bindings: [draftId] });
}
function receiptAssertion(receipt: Omit<SponsorStoryIntakeReceipt, "recordedAtMs"> | SponsorStoryIntakeReceipt): OutputSqlAssertion {
  const selected = Object.hasOwn(receipt, "recordedAtMs") ? fields : inputFields;
  return { sql: `EXISTS(SELECT 1 ${joined} WHERE ${selected.map(([, column]) => `receipt.${column}=?`).join(" AND ")})`,
    bindings: selected.map(([key]) => (receipt as SponsorStoryIntakeReceipt)[key]) };
}

/** Always returns the actual metadata-read byte count, including absence.
 * This is provenance only: the caller still needs current native custody and
 * a fresh IO debit before reading a draft, event or native receipt. */
export async function readStoredSponsorStoryIntake(request: Request, env: WorkerEnv,
  selector: { draftId: string; actorUserId: string }, limits?: SponsorStoryIntakeReadLimits) {
  if (jsonIssues(selector).length || !record(selector) || !exactKeys(selector, ["draftId", "actorUserId"])
    || !isDraftId(selector.draftId) || !id(selector.actorUserId)) return fail();
  const { draftId, actorUserId } = selector, bound = createSponsorStoryIntakeReadBoundary(request, env, limits);
  const schemaRows = await bound.query<{ snapshot: string }>(schemaQuery, [], ["snapshot"]);
  if (schemaRows.length !== 1 || schemaRows[0]!.snapshot !== schemaSnapshot) return fail();
  const schema = storageSchemaAssertion();
  const lookup = sponsorStoryIntakeReceiptLookup(draftId);
  const rows = await bound.query<Record<string, Binding>>(lookup.sql, lookup.bindings, SPONSOR_STORY_INTAKE_RECEIPT_COLUMNS);
  if (rows.length) {
    const receipt = Object.fromEntries(fields.map(([key, column]) => [key, rows[0]![column]]));
    validateReceipt(receipt, true);
    if (receipt.actorUserId !== actorUserId || receipt.draftId !== draftId) return fail();
    bound.check(); return freeze({ receipt, assertions: [schema, receiptAssertion(receipt)], controlBytes: bound.controlBytes });
  }
  const absent: OutputSqlAssertion = { sql: `NOT EXISTS(SELECT 1 FROM main.${receiptTable} WHERE draft_id COLLATE BINARY=?)
    AND NOT EXISTS(SELECT 1 FROM main.${allocationTable} WHERE draft_id COLLATE BINARY=?)`, bindings: [draftId, draftId] };
  const proof = await bound.query<{ absent: number }>(`SELECT CASE WHEN (${absent.sql}) THEN 1 ELSE 0 END AS absent`, absent.bindings!, ["absent"]);
  if (proof.length !== 1 || proof[0]!.absent !== 1) return fail();
  bound.check(); return freeze({ receipt: null, assertions: [schema, absent], controlBytes: bound.controlBytes });
}

const assertionStatements = (proof: OutputSqlAssertion): SponsorStoryIntakeSqlStatement[] => {
  const token = crypto.randomUUID();
  return [{ sql: `INSERT INTO main.output_atomic_assertions(token,passed) VALUES(?,CASE WHEN (${proof.sql}) THEN 1 ELSE 0 END)`,
    bindings: [token, ...(proof.bindings ?? [])] }, { sql: "DELETE FROM main.output_atomic_assertions WHERE token=?", bindings: [token] }];
};

/** Pure composition only. The native owner must put these statements, actual
 * prepared private-content collector statements and exact native/IO/final
 * payload proofs into one DB.batch. Calling this function executes no debit.
 * Commit/retry reuses the original receipt and must not invoke this plan again. */
export async function prepareSponsorStoryIntakeStorage(raw: SponsorStoryIntakeStorageInput) {
  if (jsonIssues(raw).length || !record(raw) || !exactKeys(raw, ["policy", ...inputFields.map(field => field[0])])) return fail();
  const policy = readSponsorStoryIntakePolicy(raw.policy);
  const input = Object.fromEntries(inputFields.map(([key]) => [key, raw[key]]));
  validateReceipt(input, false);
  const receipt = freeze(input as Omit<SponsorStoryIntakeReceipt, "recordedAtMs">);
  if (receipt.intakePolicyDigest !== await digest(policy) || receipt.draftBytes > policy.storage.maximumDraftBytes
    || receipt.eventBytes > policy.storage.maximumEventBytes || receipt.totalBytes > policy.storage.maximumOriginalBytes) return fail();
  const writeAssertion: OutputSqlAssertion = { sql: `EXISTS(SELECT 1 FROM main.experience_sponsor_story_intake_policies policy
    JOIN main.experience_sponsor_story_intake_approvals approval ON approval.campaign_id=policy.campaign_id
      AND approval.sponsor_policy_digest=policy.sponsor_policy_digest AND approval.intake_policy_digest=policy.intake_policy_digest
      AND approval.review_receipt_digest=policy.review_receipt_digest AND approval.approved_by_user_id=approval.payer_user_id
    JOIN main.experience_sponsor_campaigns campaign ON campaign.campaign_id=policy.campaign_id
    WHERE policy.campaign_id=? AND policy.sponsor_policy_digest=? AND policy.intake_policy_digest=? AND policy.policy_json=?
      AND approval.approval_id=? AND campaign.enabled=1 AND campaign.policy_digest=policy.sponsor_policy_digest)
    AND ${clock}>=? AND ${clock}<?`,
    bindings: [receipt.campaignId, receipt.sponsorPolicyDigest, receipt.intakePolicyDigest, canonicalJson(policy), receipt.intakeApprovalId,
      policy.storage.startsAtMs, policy.storage.expiresAtMs] };
  const quotaParts: string[] = [], quotaBindings: Binding[] = [];
  for (const scope of ["campaign", "actor"] as const) {
    const allowance = policy.storage[scope];
    for (const rolling of [false, true]) {
      // This transaction's immutable admission timestamp defines its window.
      // A later statement clock must not age the very allocation being checked
      // out of a short window before the final capacity witness executes.
      const where = `campaign_id=?${scope === "actor" ? " AND actor_user_id=?" : ""}${rolling
        ? ` AND recorded_at_ms>(SELECT recorded_at_ms FROM main.${allocationTable} WHERE allocation_id=?)-?` : ""}`;
      quotaParts.push(`EXISTS(SELECT 1 FROM (SELECT COUNT(*) AS operations,COALESCE(SUM(total_bytes),0) AS bytes
        FROM main.${allocationTable} WHERE ${where}) WHERE operations<=? AND bytes<=?)`);
      quotaBindings.push(receipt.campaignId, ...(scope === "actor" ? [receipt.actorUserId] : []), ...(rolling ? [receipt.allocationId, policy.storage.windowMs] : []),
        rolling ? allowance.maximumOperationsPerWindow : allowance.maximumOperations, rolling ? allowance.maximumBytesPerWindow : allowance.maximumBytes);
    }
  }
  const quota: OutputSqlAssertion = { sql: quotaParts.join(" AND "), bindings: quotaBindings };
  const original = receiptAssertion(receipt);
  const columns = SPONSOR_STORY_INTAKE_RECEIPT_COLUMNS.join(",");
  const values = inputFields.map(([key]) => receipt[key]);
  const statements: SponsorStoryIntakeSqlStatement[] = [
    ...assertionStatements(storageSchemaAssertion()),
    ...assertionStatements(writeAssertion),
    { sql: `INSERT INTO main.${allocationTable}(${columns}) VALUES(${inputFields.map(() => "?").join(",")},${clock})`, bindings: values },
    { sql: `INSERT INTO main.${receiptTable}(${columns}) SELECT ${columns} FROM main.${allocationTable} WHERE allocation_id=?`, bindings: [receipt.allocationId] },
    ...assertionStatements({ sql: `(${original.sql}) AND (${quota.sql}) AND (${writeAssertion.sql})`,
      bindings: [...original.bindings!, ...quota.bindings!, ...writeAssertion.bindings!] }),
  ];
  return freeze({ statements, receiptAssertion: original, writeAssertion, replayLookup: sponsorStoryIntakeReceiptLookup(receipt.draftId) });
}
