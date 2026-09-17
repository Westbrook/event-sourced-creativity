import { guestImageCopyProof as guestImageStageClaimProof } from "./experience-guest-image-copy-contract.ts";
import { freeze, record, exactKeys } from "../src/experiences/compiler.ts";
import { collectRetainedGuestImageHistory, current, unsupportedIdentityJson, boundedIdentityValue, type Proof, type Row } from "./experience-guest-image-history.ts";
import { collectGuestImageStageFacts, guestImageStageClosureRows, sha, fail, type GuestImageHistoricalStage } from "./experience-guest-image-stage-facts.ts";
import { inspectGuestImageStageCustodySchema } from "./experience-guest-image-stage-custody.ts";
import { readExistingPrincipalRequest, requireConsent } from "./principal-request-core.ts";
import { projectIntakeAuthority } from "./intake-authority.ts";
import { GUEST_DB_NOW, type GuestClaimProof } from "./experience-guest-session.ts";
import type { WorkerEnv } from "./runtime.ts";

export type GuestImageStageClaimInventory = Readonly<{ version: 1; sessionId: string; guestSubject: string; projectId: string; documentId: string;
  destinationUserId: string; draftHash: string; sourceHead: number; sourceSaveHead: number; stageHead: number;
  stageState: GuestImageHistoricalStage; expiresAt: string; manifestDigest: string }>;
type History = Awaited<ReturnType<typeof collectRetainedGuestImageHistory>>;
type ClaimSession = History["liveSource"]["session"] & { row: History["liveSource"]["session"]["row"] & { created_at_ms: number } };
type Facts = Awaited<ReturnType<typeof collectGuestImageStageFacts>>;
type Manifest = Readonly<{ version: 1; kind: "original-image-stage-history"; sessionId: string; guestSubject: string; documentId: string;
  projectId: string; sourceHead: number; sourceSaveHead: number; stageHead: number; stageState: GuestImageHistoricalStage; expiresAt: string;
  draftHash: string; contentDigest: string; sourceEventIds: readonly string[]; originalPayerUserId: string; nativeSnapshotDigest: string }>;
export type GuestImageStageClaimLeaseRow = { session_id: string; lease_id: string; destination_user_id: string; manifest_digest: string;
  request_id: string; request_ids_json: string; acquisitions: number; created_at_ms: number; expires_at_ms: number };
const leaseColumns = ["session_id", "lease_id", "destination_user_id", "manifest_digest", "request_id", "request_ids_json", "acquisitions", "created_at_ms", "expires_at_ms"];
const leaseObject = `json_object(${leaseColumns.flatMap(key => [`'${key}'`, key]).join(",")})`;
export function readGuestImageStageClaimLeaseRow(raw: unknown, session: ClaimSession, destination: string, manifestDigest: string): GuestImageStageClaimLeaseRow {
  if (!record(raw) || !exactKeys(raw, leaseColumns) || raw.session_id !== session.row.session_id || raw.destination_user_id !== destination
    || raw.manifest_digest !== manifestDigest || typeof raw.lease_id !== "string" || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u.test(raw.lease_id)
    || typeof raw.request_id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/u.test(raw.request_id)
    || typeof raw.request_ids_json !== "string" || new TextEncoder().encode(raw.request_ids_json).byteLength > 32768 || !raw.request_ids_json.isWellFormed()
    || typeof raw.acquisitions !== "number" || !Number.isSafeInteger(raw.acquisitions) || raw.acquisitions < 1 || raw.acquisitions > session.policy.terms.maximumLeaseAcquisitions
    || typeof raw.created_at_ms !== "number" || !Number.isSafeInteger(raw.created_at_ms) || raw.created_at_ms < session.row.created_at_ms
    || typeof raw.expires_at_ms !== "number" || !Number.isSafeInteger(raw.expires_at_ms) || raw.expires_at_ms <= raw.created_at_ms
    || raw.expires_at_ms > session.row.expires_at_ms) return fail("lease_invalid");
  let requests: unknown; try { requests = JSON.parse(raw.request_ids_json); } catch { return fail("lease_invalid"); }
  if (!Array.isArray(requests) || requests.length !== raw.acquisitions || new Set(requests).size !== requests.length
    || requests.some(value => typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/u.test(value))
    || requests.at(-1) !== raw.request_id || JSON.stringify(requests) !== raw.request_ids_json
    || raw.acquisitions === 1 && raw.expires_at_ms !== Math.min(raw.created_at_ms + session.policy.terms.leaseLifetimeMs, session.row.expires_at_ms)) return fail("lease_invalid");
  return freeze({ session_id: raw.session_id, lease_id: raw.lease_id, destination_user_id: raw.destination_user_id, manifest_digest: raw.manifest_digest,
    request_id: raw.request_id, request_ids_json: raw.request_ids_json, acquisitions: raw.acquisitions, created_at_ms: raw.created_at_ms, expires_at_ms: raw.expires_at_ms });
}
export function guestImageStageClaimLeaseRowProof(row: GuestImageStageClaimLeaseRow): Proof {
  return { sql: `EXISTS(SELECT 1 FROM experience_guest_claim_leases WHERE session_id=? AND ${leaseObject}=? AND created_at_ms<=${GUEST_DB_NOW})`, bindings: [row.session_id, JSON.stringify(row)] };
}

export { guestImageCopyProof as guestImageStageClaimProof } from "./experience-guest-image-copy-contract.ts";
type Data = Readonly<{ leaseObservedAtMs: number; lease: GuestImageStageClaimLeaseRow | null; leaseBeforeProof: Proof; manifest: Manifest; proof: Proof; beforeProof: Proof; sourceParts: readonly Proof[]; session: ClaimSession;
  history: Omit<History, "ctx" | "sponsor"> & { sponsor: { proof: Proof; tables: readonly string[]; snapshot: string } };
  facts: Omit<Facts, "ctx" | "history">; schema: Awaited<ReturnType<typeof inspectGuestImageStageCustodySchema>>;
  closureRows: ReturnType<typeof guestImageStageClosureRows>; authority: Proof }>;
const inventories = new WeakMap<GuestImageStageClaimInventory, { env: WorkerEnv; ctx: History["ctx"]; cohort: unknown; admins: unknown; data: Data }>();

/** Fixed historical predicates only. Callers cannot supply a SQL bypass. The
 * approved destination/manifest lease is the sole additional source identity. */
function closure(facts: Facts, destination: string, manifestDigest: string): Proof {
  const { originalGraphRows, custodyRows } = guestImageStageClosureRows(facts.history);
  const rows = [...originalGraphRows, ...custodyRows,
    ["experience_guest_claim_leases", "d.session_id=s.sessionId AND (d.destination_user_id<>s.destination OR d.manifest_digest<>s.manifest)"],
    ["experience_guest_image_stage_custodies", `${unsupportedIdentityJson("d.lineage_json", ["sessionId", "guestSubject", "projectId", "documentId"])} OR d.session_id=s.sessionId
      OR ${boundedIdentityValue("d.lineage_json", "sessionId")}=s.sessionId OR ${boundedIdentityValue("d.lineage_json", "guestSubject")}=s.guest
      OR ${boundedIdentityValue("d.lineage_json", "projectId")}=s.project OR ${boundedIdentityValue("d.lineage_json", "documentId")}=s.document`],
    ["experience_guest_image_stage_copies", "d.session_id=s.sessionId"]];
  const scope = { ...facts.scope, destination, manifest: manifestDigest }, names = Object.keys(scope);
  const groups = Array.from({ length: Math.ceil(rows.length / 4) }, (_, index) => rows.slice(index * 4, index * 4 + 4));
  return { sql: `NOT EXISTS(WITH stage_claim_input AS(SELECT ? AS value),stage_claim_scope AS(
    SELECT ${names.map(key => `json_extract(value,'$.${key}') AS ${key}`).join(",")} FROM stage_claim_input),
    ${groups.map((group, index) => `stage_claim_closure_${index} AS MATERIALIZED(${group.map(([table, predicate]) => `SELECT 1 FROM ${table} d,stage_claim_scope s WHERE ${predicate}`).join(" UNION ALL ")} LIMIT 1)`).join(",")}
    SELECT 1 WHERE ${groups.map((_, index) => `EXISTS(SELECT 1 FROM stage_claim_closure_${index})`).join(" OR ")})`, bindings: [JSON.stringify(scope)] };
}

/** Distinct full-stage review capability. Neither the historical unclaimed
 * inventory nor the strict first-SAVE inventory can cross this boundary. */
export async function inspectGuestImageStageClaimInventory(request: Request, env: WorkerEnv, input: { proof: GuestClaimProof }): Promise<GuestImageStageClaimInventory> {
  const history = await collectRetainedGuestImageHistory(request, env, input), { ctx } = history; current(ctx);
  const cohort = env.FORMA_PILOT_COHORT_ID, admins = env.FORMA_ADMIN_EMAILS;
  const check = () => { current(ctx); if (env.FORMA_PILOT_COHORT_ID !== cohort || env.FORMA_ADMIN_EMAILS !== admins) return fail(); };
  if (/(?:^|;\s*)(?:forma_project_context|forma_impersonation)=/u.test(request.headers.get("cookie") ?? "")) return fail();
  const auth = await readExistingPrincipalRequest(request, env, "creator", { account: "principal" }); check();
  if ("kind" in auth || auth.response || !auth.user || requireConsent(auth.user) || auth.user.fictional || auth.user.projectExecution
    || !auth.user.access.capabilities.includes("project.author") || auth.user.userId.startsWith("guest:")) return fail();
  const destination = auth.user.userId, authority = projectIntakeAuthority(env, { user: auth.user, principal: auth.user, impersonation: null },
    { projectId: history.original.projectId, documentId: history.original.documentId });
  if (!history.sponsor.tables.has("experience_guest_context_adoptions") || !history.sponsor.tables.has("experience_guest_image_claims")) return fail("schema_unavailable");
  const schema = await inspectGuestImageStageCustodySchema(env); check();
  const facts = await collectGuestImageStageFacts(history); check();
  const { source, session, projectId, eventIds } = history.original;
  const claimSession: ClaimSession = { ...history.liveSource.session, row: { ...history.liveSource.session.row, created_at_ms: Number(session.created_at_ms) } };
  const immutableRow = (value: Row) => Object.fromEntries(Object.entries(value).filter(([key]) => key !== "revoked_at_ms"));
  // Exact original Step1 manifest. Destination authority is captured separately,
  // and changing a lease never changes what the guest deliberately reviewed.
  const nativeSnapshotDigest = await sha(ctx, { source, session: immutableRow(session), sourcePolicy: history.original.policy,
    custodyTerms: history.original.terms, prefix: history.original.prefixWitnesses, approval: immutableRow(history.saved.approval.row),
    tails: facts.tails.map(value => value.observed), resources: facts.resources, rows: facts.rows }); check();
  const manifest: Manifest = { version: 1, kind: "original-image-stage-history", sessionId: facts.sessionId, guestSubject: String(session.guest_subject),
    documentId: facts.documentId, projectId, sourceHead: facts.sourceHead, sourceSaveHead: facts.sourceSaveHead, stageHead: facts.stageHead,
    stageState: facts.stageState, expiresAt: facts.expiresAt, draftHash: String(source.draft_hash), contentDigest: String(source.content_digest),
    sourceEventIds: [...eventIds], originalPayerUserId: history.saved.approval.policy.payerUserId, nativeSnapshotDigest };
  const manifestDigest = await sha(ctx, manifest); check();
  const sourceParts = [...history.original.associationParts, history.sponsor.proof, history.memory.proof, schema.proof,
    ...facts.stageParts, facts.blockCustodyProof, facts.eventCountProof, facts.recordedTimeProof, ...facts.tailProofs];
  const proof = guestImageStageClaimProof([...sourceParts, history.original.sessionProof, ...history.currentGuards, authority, closure(facts, destination, manifestDigest)]);
  const leaseResult = await ctx.db.prepare(`SELECT ${GUEST_DB_NOW} AS observed_at_ms,(SELECT ${leaseObject} FROM experience_guest_claim_leases WHERE session_id=?
    AND typeof(request_ids_json)='text' AND length(CAST(request_ids_json AS BLOB))<=32768) AS witness`).bind(facts.sessionId).first<{ observed_at_ms: number; witness: string | null }>(); check();
  if (!leaseResult || !Number.isSafeInteger(leaseResult.observed_at_ms) || leaseResult.observed_at_ms < claimSession.row.created_at_ms) return fail();
  const lease = leaseResult.witness !== null ? readGuestImageStageClaimLeaseRow(JSON.parse(leaseResult.witness), claimSession, destination, manifestDigest) : null;
  if (lease && (lease.created_at_ms > leaseResult.observed_at_ms || lease.expires_at_ms > Math.min(leaseResult.observed_at_ms
    + claimSession.policy.terms.leaseLifetimeMs, claimSession.row.expires_at_ms))) return fail("lease_invalid");
  const leaseBeforeProof: Proof = lease ? guestImageStageClaimLeaseRowProof(lease)
    : { sql: "NOT EXISTS(SELECT 1 FROM experience_guest_claim_leases WHERE session_id=?)", bindings: [facts.sessionId] };
  const beforeProof = guestImageStageClaimProof([proof, leaseBeforeProof]);
  const observed = await ctx.db.prepare(`SELECT 1 AS current WHERE ${beforeProof.sql}`).bind(...beforeProof.bindings).first<{ current: number }>(); check();
  if (observed?.current !== 1) return fail();
  const inventory = Object.freeze({ version: 1 as const, sessionId: facts.sessionId, guestSubject: manifest.guestSubject, projectId,
    documentId: facts.documentId, destinationUserId: destination, draftHash: manifest.draftHash, sourceHead: facts.sourceHead,
    sourceSaveHead: facts.sourceSaveHead, stageHead: facts.stageHead, stageState: facts.stageState, expiresAt: facts.expiresAt, manifestDigest });
  const { ctx: _ctx, sponsor, ...historicalValues } = history;
  const { ctx: _factsCtx, history: _factsHistory, ...factValues } = facts;
  void _ctx; void _factsCtx; void _factsHistory;
  const data = freeze({ leaseObservedAtMs: leaseResult.observed_at_ms, lease, leaseBeforeProof, manifest, proof, beforeProof, sourceParts, session: claimSession,
    history: { ...historicalValues, sponsor: { proof: sponsor.proof, snapshot: sponsor.snapshot, tables: [...sponsor.tables] } },
    facts: factValues, schema, closureRows: guestImageStageClosureRows(history), authority });
  inventories.set(inventory, { env, ctx, cohort, admins, data }); return inventory;
}
export function guestImageStageClaimInventoryData(env: WorkerEnv, inventory: GuestImageStageClaimInventory): Data {
  const captured = record(inventory) ? inventories.get(inventory) : undefined;
  if (!captured || env !== captured.env || env.DB !== captured.ctx.db || env.FORMA_PILOT_COHORT_ID !== captured.cohort
    || env.FORMA_ADMIN_EMAILS !== captured.admins) return fail();
  current(captured.ctx); return captured.data;
}
