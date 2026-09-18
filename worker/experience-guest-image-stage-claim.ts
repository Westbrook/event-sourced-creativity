import { canonicalJson, digest, exactKeys, freeze, jsonIssues, record } from "../src/experiences/compiler.ts";
import { insertEventAtHead } from "./event-append.ts";
import { makeEvent } from "./event-write-primitives.ts";
import { projectIntakeAuthority } from "./intake-authority.ts";
import { readExistingPrincipalRequest, requireConsent } from "./principal-request-core.ts";
import { outputAssertionStatements } from "./output-command-core.ts";
import { inspectCompletedGuestImageClaim, guestImageCompletedClaimData, readGuestImageClaimLineage } from "./experience-guest-image-claim.ts";
import { acquireGuestImageStageClaimLease } from "./experience-guest-claim-lease.ts";
import { inspectGuestImageStageClaimInventory, guestImageStageClaimInventoryData, type GuestImageStageClaimInventory } from "./experience-guest-image-stage-claim-inventory.ts";
import { guestImageCopyPrefixEventInput, guestImageCopyPrefixLineage, guestImageCopyOriginalSource, guestImageCopyCommandKey, guestImageCopyProof,
  guestImageCopySaveEnvelope, guestImageCopySaveEventInput, guestImageCopyLineage, guestImageCopyPrefixTargets,
  guestImageCopyEventMeta, guestImageCopyCommandProof, guestImageCopyTargetBody, guestImageCopyTargetCustody,
  type GuestImageCopyLease, type GuestImageCopyCommand, type GuestImageCopyResource } from "./experience-guest-image-copy-contract.ts";
import { readGuestImageStageClaimLineage, guestImageStageHistoryRoles, guestImageStageHistoryIdentity, guestImageStageHistoryStorageValue,
  GUEST_IMAGE_STAGE_CUSTODY_COLUMNS, GUEST_IMAGE_STAGE_COPY_COLUMNS, readGuestImageStageCustodyMapping, readClaimedGuestImageStageHistory,
  type GuestImageStageHistoryRole, type GuestImageStageCopyRow } from "./experience-guest-image-stage-custody.ts";
import { objectSql, sessionColumns, unsupportedIdentityJson, boundedIdentityValue, type Proof, type Row } from "./experience-guest-image-history.ts";
import { GUEST_DB_NOW, guestFail, guestHash, guestId, type GuestClaimProof } from "./experience-guest-session.ts";
import { nativeMemoryAnswerExclusion } from "./memory-native-boundary.ts";
import { nativeStructuredOriginSchema } from "./memory-native-origin-schema.ts";
import { nativeDocumentJobOriginSchema } from "./memory-document-job-origin-schema.ts";
import { preparePrivateContent } from "./private-content-storage.ts";
import type { WorkerEnv } from "./runtime.ts";

type Context = { request: Request; env: WorkerEnv; db: WorkerEnv["DB"]; current: () => void };
type InventoryData = ReturnType<typeof guestImageStageClaimInventoryData>;
export type GuestImageStageClaimRequest = Readonly<{ sessionId: string; requestId: string; approvedManifestDigest: string; proof?: GuestClaimProof }>;
const claimColumns = "session_id,destination_user_id,lease_id,request_id,manifest_digest,context_lineage_digest,lineage_json,lineage_digest,created_at_ms";
const commandColumns = "scope_key,actor_user_id,command_key,request_digest,action,event_id,created_at";
const leaseColumns = "session_id,lease_id,destination_user_id,manifest_digest,request_id,request_ids_json,acquisitions,created_at_ms,expires_at_ms";
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
const fail = (part = "unavailable"): never => guestFail(`image_stage_claim_${part}`);
const integer = (value: unknown, min = 0): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= min;
const tuple = (row: object, columns: string) => JSON.stringify(columns.split(",").map(key => (row as Record<string, unknown>)[key]));
const arraySql = (columns: string, alias: string) => `json_array(${columns.split(",").map(key => `${alias}.${key}`).join(",")})`;
const all = (...parts: Proof[]): Proof => guestImageCopyProof(parts);
function parsed(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string" || !raw.isWellFormed() || bytes(raw) > 65536) return fail();
  let value: unknown; try { value = JSON.parse(raw); } catch { return fail(); }
  if (!record(value) || jsonIssues(value).length) return fail(); return value;
}
function context(request: Request, env: WorkerEnv): Context {
  if (!(request instanceof Request)) return fail("request_invalid");
  const db = env.DB, url = request.url, method = request.method, headers = JSON.stringify(Array.from(request.headers)), signal = request.signal;
  const cohort = env.FORMA_PILOT_COHORT_ID, admins = env.FORMA_ADMIN_EMAILS, retention = env.FORMA_RETENTION_DAYS;
  const origin = new URL(url), site = request.headers.get("sec-fetch-site");
  if (method !== "POST" || origin.protocol !== "https:" || origin.username || origin.password || origin.search || origin.hash
    || request.headers.get("origin") !== origin.origin || site !== null && site !== "same-origin" && site !== "none" || bytes(headers) > 32768
    || (request.headers.get("cookie") ?? "").split(";").some(part => ["forma_project_context", "forma_impersonation"].includes(part.split("=", 1)[0]!.trim()))) return fail("request_invalid");
  const current = () => {
    if (env.DB !== db) fail("database_changed");
    if (request.signal !== signal || signal.aborted) fail("aborted");
    if (request.url !== url || request.method !== method || JSON.stringify(Array.from(request.headers)) !== headers
      || env.FORMA_PILOT_COHORT_ID !== cohort || env.FORMA_ADMIN_EMAILS !== admins || env.FORMA_RETENTION_DAYS !== retention) fail("authority_changed");
  };
  current(); return { request, env, db, current };
}
async function destination(ctx: Context) {
  const auth = await readExistingPrincipalRequest(ctx.request, ctx.env, "creator", { account: "principal" }); ctx.current();
  if ("kind" in auth || auth.response || !auth.user || requireConsent(auth.user) || auth.user.fictional || auth.user.projectExecution
    || auth.user.userId.startsWith("guest:") || !auth.user.access.capabilities.includes("project.author")) return fail("destination_unavailable");
  return { user: auth.user, principal: auth.user, impersonation: null };
}
const leaseProof = (lease: GuestImageCopyLease): Proof => ({ sql: `EXISTS(SELECT 1 FROM experience_guest_claim_leases lease WHERE ${arraySql(leaseColumns, "lease") }=? AND expires_at_ms>${GUEST_DB_NOW})`, bindings: [tuple(lease, leaseColumns)] });
const registries = ["memory_native_answer_origins", "memory_structured_answer_origins", "memory_document_job_answer_origins"] as const;
const memorySchema = `(SELECT json_group_array(json_object('type',type,'name',name,'sql',definition)) FROM
  (SELECT type,name,CASE WHEN length(CAST(sql AS BLOB))<=16384 THEN sql ELSE NULL END AS definition FROM sqlite_schema
    WHERE type IN('table','view') AND name IN(${registries.map(name => `'${name}'`).join(",")}) ORDER BY name LIMIT 4))`;
/** Same native target-origin authority as the N1 writer, independently scoped
 * to these newly constructed canonical events; no historical DTO grants it. */
async function targetMemory(ctx: Context, ids: string[]): Promise<Proof> {
  const [structured, documentJob] = await Promise.all([nativeStructuredOriginSchema(ctx.env), nativeDocumentJobOriginSchema(ctx.env)]); ctx.current();
  const row = await ctx.db.prepare(`SELECT ${memorySchema} AS snapshot`).first<{ snapshot: string }>(); ctx.current();
  if (!row || bytes(row.snapshot) > 65536) return fail();
  let found: unknown; try { found = JSON.parse(row.snapshot); } catch { return fail(); }
  if (!Array.isArray(found) || found.length > 3 || found.some(item => !record(item) || !exactKeys(item, ["type", "name", "sql"])
    || item.type !== "table" || !registries.includes(item.name as typeof registries[number]) || typeof item.sql !== "string")) return fail();
  const parts: Proof[] = [structured, documentJob].map(family => ({ sql: family.guard.condition, bindings: [...family.guard.bindings] }));
  parts.push({ sql: `${memorySchema}=?`, bindings: [row.snapshot] });
  for (const item of found) parts.push({ sql: `NOT EXISTS(SELECT 1 FROM ${item.name} WHERE user_event_id IN(SELECT value FROM json_each(?)) OR answer_event_id IN(SELECT value FROM json_each(?)))`, bindings: [JSON.stringify(ids), JSON.stringify(ids)] });
  return all(...parts);
}
/** Original graph rows are retained byte-for-byte. Only exact own immutable
 * mappings become allowed; their complete tuples are separately proved. */
function completedSourceClosure(data: InventoryData): Proof {
  const rows = [...data.closureRows.originalGraphRows.map(row => [...row]), ...data.closureRows.custodyRows.map(([table, predicate]) =>
    [table, ["experience_guest_context_adoptions", "experience_guest_image_claims"].includes(table) ? `(${predicate}) AND d.session_id<>s.sessionId` : predicate]),
    ["experience_guest_image_stage_custodies", `(${unsupportedIdentityJson("d.lineage_json", ["sessionId", "guestSubject", "projectId", "documentId"])}
      OR d.session_id=s.sessionId OR ${boundedIdentityValue("d.lineage_json", "sessionId")}=s.sessionId OR ${boundedIdentityValue("d.lineage_json", "guestSubject")}=s.guest
      OR ${boundedIdentityValue("d.lineage_json", "projectId")}=s.project OR ${boundedIdentityValue("d.lineage_json", "documentId")}=s.document) AND d.session_id<>s.sessionId`]];
  const scope = data.facts.scope, names = Object.keys(scope), groups = Array.from({ length: Math.ceil(rows.length / 4) }, (_, i) => rows.slice(i * 4, i * 4 + 4));
  return { sql: `NOT EXISTS(WITH stage_completed_input AS(SELECT ? AS value),stage_completed_scope AS(
    SELECT ${names.map(key => `json_extract(value,'$.${key}') AS ${key}`).join(",")} FROM stage_completed_input),
    ${groups.map((group, i) => `stage_completed_closure_${i} AS MATERIALIZED(${group.map(([table, predicate]) => `SELECT 1 FROM ${table} d,stage_completed_scope s WHERE ${predicate}`).join(" UNION ALL ")} LIMIT 1)`).join(",")}
    SELECT 1 WHERE ${groups.map((_, i) => `EXISTS(SELECT 1 FROM stage_completed_closure_${i})`).join(" OR ")})`, bindings: [JSON.stringify(scope)] };
}
function copyBodiesProof(owner: string, copies: readonly GuestImageStageCopyRow[], contents: readonly string[], exclusion: Proof): Proof {
  return { sql: `(SELECT COUNT(*) FROM json_each(?) expected JOIN private_content content ON content.content_id=json_extract(expected.value,'$.content_id')
    AND content.owner_id=? AND content.kind='guest-image-stage-history' AND content.content=json_extract(expected.value,'$.content')
    AND length(CAST(content.content AS BLOB))=json_extract(expected.value,'$.byte_length') AND content.created_at=json_extract(expected.value,'$.created_at')
    AND content.expires_at=json_extract(expected.value,'$.expires_at') AND content.redacted_at IS NULL
    AND content.created_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND content.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
    AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=content.content_id)
    AND NOT EXISTS(SELECT 1 FROM private_content_retention_scopes WHERE content_id=content.content_id)
    AND (${exclusion.sql}))=?`, bindings: [JSON.stringify(copies.map((copy, i) => ({ ...copy, content: contents[i] }))), owner, ...exclusion.bindings, copies.length] };
}
async function completed(ctx: Context, sessionId: string) {
  const witness = await inspectCompletedGuestImageClaim(ctx.request, ctx.env, { sessionId }); ctx.current();
  if (!witness) return null;
  const native = guestImageCompletedClaimData(ctx.request, ctx.env, witness);
  const mapping = await readGuestImageStageCustodyMapping(ctx.env, { sessionId }); ctx.current(); guestImageCompletedClaimData(ctx.request, ctx.env, witness);
  if (!mapping) return fail("mapping_unavailable");
  const { row, lineage } = mapping, original = native.lineage;
  if (row.session_id !== original.sessionId || row.destination_user_id !== original.destinationUserId || row.lease_id !== native.row.lease_id
    || row.request_id !== native.row.request_id || row.manifest_digest !== native.row.manifest_digest || row.context_lineage_digest !== native.row.context_lineage_digest
    || row.save_lineage_digest !== native.row.lineage_digest || row.created_at_ms !== native.row.created_at_ms
    || lineage.guestSubject !== original.guestSubject || lineage.projectId !== original.projectId || lineage.documentId !== original.documentId
    || lineage.source.head !== original.source.head || lineage.source.saveHead !== original.source.save.sequence || lineage.source.saveEventId !== original.source.save.id
    || lineage.source.expiresAt !== original.source.expiresAt || Date.parse(lineage.source.confirmation.recorded) < Date.parse(original.source.save.recorded)) return fail();
  const proof = all(native.proof, mapping.proof);
  const live = await ctx.db.prepare(`SELECT 1 AS current WHERE ${proof.sql}`).bind(...proof.bindings).first<{ current: number }>(); ctx.current();
  guestImageCompletedClaimData(ctx.request, ctx.env, witness); if (live?.current !== 1) return fail();
  return { native, mapping, proof };
}
type Completed = NonNullable<Awaited<ReturnType<typeof completed>>>;
function exact(saved: Completed, input: GuestImageStageClaimRequest, leaseId?: string) {
  if (saved.mapping.row.session_id !== input.sessionId || saved.mapping.row.request_id !== input.requestId
    || saved.mapping.row.manifest_digest !== input.approvedManifestDigest || leaseId !== undefined && saved.mapping.row.lease_id !== leaseId) return fail("conflict");
  return saved;
}
async function copy(ctx: Context, inventory: GuestImageStageClaimInventory, leaseId: string, requestId: string): Promise<Completed & { replayed: boolean }> {
  const data = guestImageStageClaimInventoryData(ctx.env, inventory), auth = await destination(ctx); ctx.current();
  if (auth.user.userId !== inventory.destinationUserId || new URL(ctx.request.url).origin !== data.session.policy.terms.origin) return fail("destination_unavailable");
  const native = projectIntakeAuthority(ctx.env, auth, inventory), liveInventory = () => { ctx.current(); guestImageStageClaimInventoryData(ctx.env, inventory); };
  const lease = await ctx.db.prepare(`SELECT ${leaseColumns} FROM experience_guest_claim_leases WHERE session_id=? AND lease_id=? AND request_id=?
    AND destination_user_id=? AND manifest_digest=? AND expires_at_ms>${GUEST_DB_NOW}`)
    .bind(inventory.sessionId, leaseId, requestId, auth.user.userId, inventory.manifestDigest).first<GuestImageCopyLease>(); liveInventory();
  if (!lease) return fail("lease_unavailable");
  const currentHead = await ctx.db.prepare("SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?").bind(auth.user.streamId).first<{ head: number }>(); liveInventory();
  const plan = data.history.original.plan, originalSaved = data.history.saved;
  if (!currentHead || !integer(currentHead.head) || !plan) return fail();
  const head = currentHead.head, prefixEvents = plan.events.map((event, index) => makeEvent(...guestImageCopyPrefixEventInput(
    { destinationStreamId: auth.user.streamId, head, sessionId: inventory.sessionId }, event, index)));
  const prefixBodies = prefixEvents.map(event => JSON.stringify(event.payload)), hashes = await Promise.all(prefixBodies.map(body => digest(body))); liveInventory();
  const prefix = guestImageCopyPrefixLineage({ sessionId: inventory.sessionId, guestSubject: inventory.guestSubject, projectId: inventory.projectId,
    documentId: inventory.documentId, draftHash: inventory.draftHash, manifestDigest: inventory.manifestDigest, sourceEventIds: data.history.original.eventIds,
    sourceHead: inventory.sourceHead, destinationUserId: auth.user.userId, origin: data.session.policy.terms.origin, head }, prefixEvents, hashes, lease);
  const prefixJson = canonicalJson(prefix), prefixHash = await digest(prefix); liveInventory();
  const sourcePayload = parsed(originalSaved.tail.private_json), originalEnvelope = sourcePayload.output_command_envelope;
  if (!record(originalEnvelope) || !record(originalEnvelope.guestSponsorPreparation) || !record(originalEnvelope.guestSponsorPreparation.source)) return fail();
  const source = guestImageCopyOriginalSource({ head: inventory.sourceHead, eventIds: data.history.original.eventIds, expiresAt: inventory.expiresAt,
    sessionPolicyId: data.session.row.policy_id, sessionTermsDigest: data.session.row.terms_digest, sessionExpiresAtMs: data.session.row.expires_at_ms,
    releaseHash: plan.release.releaseHash }, { event: { eventId: originalSaved.eventId, sequence: Number(originalSaved.tail.sequence),
      occurredAt: String(originalSaved.tail.occurred_at), recordedAt: String(originalSaved.tail.recorded_at) },
    command: originalSaved.command as unknown as GuestImageCopyCommand, resource: originalSaved.resource as unknown as GuestImageCopyResource },
  sourcePayload, originalEnvelope.guestSponsorPreparation.source, await digest(originalSaved.tail.private_json)); liveInventory();
  const key = await guestImageCopyCommandKey(inventory.sessionId, auth.user.userId, inventory.manifestDigest); liveInventory();
  const envelope = guestImageCopySaveEnvelope({ sessionId: inventory.sessionId, manifestDigest: inventory.manifestDigest, guestSubject: inventory.guestSubject,
    documentId: inventory.documentId, source, contextHead: prefix.targetHead, commandKey: key, requirementId: originalSaved.requirementId }, { spec: originalEnvelope.spec, planSuggestions: originalEnvelope.planSuggestions });
  const requestDigest = (await digest(envelope)).slice(7); liveInventory();
  const tail = makeEvent(...guestImageCopySaveEventInput({ destinationStreamId: auth.user.streamId, destinationUserId: auth.user.userId,
    contextHead: prefix.targetHead, commandKey: key }, sourcePayload, envelope));
  const body = JSON.stringify(tail.payload), tailHash = await digest(body); liveInventory();
  const lineage = readGuestImageClaimLineage(canonicalJson(guestImageCopyLineage({ sessionId: inventory.sessionId, guestSubject: inventory.guestSubject,
    destinationUserId: auth.user.userId, projectId: inventory.projectId, documentId: inventory.documentId, draftId: plan.draftId, draftHash: plan.draftHash,
    manifestDigest: inventory.manifestDigest, origin: prefix.origin, contextLineageDigest: prefixHash, source, commandKey: key, requestDigest,
    requirementId: originalSaved.requirementId, contextHead: prefix.targetHead }, tail, tailHash)));
  const lineageJson = canonicalJson(lineage), lineageHash = await digest(lineage); liveInventory();
  const roles = guestImageStageHistoryRoles(inventory.stageState), contents: string[] = [], identities: { role: GuestImageStageHistoryRole; contentId: string; digest: string; bytes: number }[] = [];
  for (const role of roles) {
    const raw = role === "confirmation" ? data.facts.tails[1].row.private_json : role === "quote" ? data.facts.tails[2].row.private_json
      : canonicalJson({ stage: data.facts.rows.stage, resource: data.facts.resources[2] });
    const content = guestImageStageHistoryStorageValue(role, raw), originalDigest = await digest(content); liveInventory();
    const contentId = await guestImageStageHistoryIdentity({ sessionId: inventory.sessionId, destinationUserId: auth.user.userId,
      manifestDigest: inventory.manifestDigest, role, originalDigest }); liveInventory();
    contents.push(content); identities.push({ role, contentId, digest: originalDigest, bytes: bytes(content) });
  }
  const originalEvent = (row: Row, privateDigest: string) => ({ id: String(row.event_id), sequence: Number(row.sequence), occurred: String(row.occurred_at),
    recorded: String(row.recorded_at), public: String(row.payload), privateDigest });
  const quoteIndex = data.facts.rows.quoteIndex;
  const stageLineage = readGuestImageStageClaimLineage(canonicalJson({ version: 1, kind: "original-image-stage-custody", sessionId: inventory.sessionId,
    guestSubject: inventory.guestSubject, destinationUserId: auth.user.userId, projectId: inventory.projectId, documentId: inventory.documentId,
    manifestDigest: inventory.manifestDigest, nativeSnapshotDigest: data.manifest.nativeSnapshotDigest, contextLineageDigest: prefixHash, saveLineageDigest: lineageHash,
    source: { head: inventory.sourceHead, saveHead: inventory.sourceSaveHead, stageHead: inventory.stageHead, state: inventory.stageState, expiresAt: inventory.expiresAt,
      originalPayerUserId: data.manifest.originalPayerUserId, saveEventId: originalSaved.eventId,
      confirmation: originalEvent(data.facts.tails[1].row, identities[0].digest), confirmationCommand: data.facts.rows.command,
      confirmationResource: data.facts.resources[1], quote: quoteIndex ? { ...originalEvent(data.facts.tails[2].row, identities.find(value => value.role === "quote")!.digest),
        preflightId: quoteIndex.preflight_id, planRevisionId: quoteIndex.plan_revision_id, expiresAt: quoteIndex.expires_at, termsDigest: quoteIndex.terms_digest } : null,
      quoteCommand: data.facts.rows.preflightCommand, construction: data.facts.rows.stage ? { driverId: data.facts.rows.stage.driver_id,
        commandDigest: data.facts.rows.stage.command_digest, resource: data.facts.resources[2] } : null }, copies: identities }));
  const stageJson = canonicalJson(stageLineage), stageHash = await digest(stageLineage); liveInventory();
  const allEvents = [...prefixEvents, tail], memory = await targetMemory(ctx, allEvents.map(event => event.eventId)); liveInventory();
  const exclusion = await nativeMemoryAnswerExclusion(ctx.env, { answerAlias: "content" }); liveInventory();
  const sourceFuture: Proof = { sql: `?>strftime('%Y-%m-%dT%H:%M:%fZ','now')`, bindings: [inventory.expiresAt] };
  const storageGuard = all(native, leaseProof(lease), sourceFuture), copies: GuestImageStageCopyRow[] = [];
  const preparations: Awaited<ReturnType<typeof preparePrivateContent>>[] = [];
  for (let i = 0; i < identities.length; i++) {
    const identity = identities[i];
    // This is the actual held native storage seam. No alternate kind, cast or
    // raw insertion substitutes for its coordinated implementation.
    const prepared = await preparePrivateContent(ctx.env, auth.user.userId, "guest-image-stage-history", contents[i], undefined, undefined, storageGuard, { contentId: identity.contentId }); liveInventory();
    if (prepared.requiredInserts !== 1 || prepared.contentId !== identity.contentId || !Array.isArray(prepared.statements) || prepared.statements.length < prepared.requiredInserts) return fail();
    preparations.push(prepared); copies.push({ session_id: inventory.sessionId, role: identity.role, content_id: identity.contentId,
      original_digest: identity.digest, byte_length: identity.bytes, created_at: prepared.createdAt, expires_at: prepared.expiresAt });
  }
  const ids = JSON.stringify([...new Set([...plan.events.flatMap(event => [event.payload.project_id, event.payload.document_id, event.payload.block_id]
    .filter(value => typeof value === "string")), originalSaved.requirementId])]);
  const collision: Proof = { sql: `NOT EXISTS(SELECT 1 FROM events prior,json_tree(prior.payload) item WHERE prior.stream_id=? AND prior.sequence<=?
    AND item.type='text' AND item.value IN(SELECT value FROM json_each(?)))`, bindings: [auth.user.streamId, head, ids] };
  const originalHead: Proof = { sql: "(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?", bindings: [auth.user.streamId, head] };
  const noPrior: Proof = { sql: `NOT EXISTS(SELECT 1 FROM experience_guest_context_adoptions WHERE session_id=?)
    AND NOT EXISTS(SELECT 1 FROM experience_guest_image_claims WHERE session_id=?) AND NOT EXISTS(SELECT 1 FROM experience_guest_image_stage_custodies WHERE session_id=?)
    AND NOT EXISTS(SELECT 1 FROM experience_guest_image_stage_copies WHERE session_id=?)
    AND NOT EXISTS(SELECT 1 FROM private_content WHERE content_id IN(SELECT value FROM json_each(?)))`,
  bindings: [inventory.sessionId, inventory.sessionId, inventory.sessionId, inventory.sessionId, JSON.stringify(copies.map(copy => copy.content_id))] };
  const receiptPost: Proof = { sql: `EXISTS(SELECT 1 FROM experience_guest_context_adoptions prefix JOIN experience_guest_image_claims claim ON claim.session_id=prefix.session_id
    JOIN experience_guest_image_stage_custodies stage ON stage.session_id=prefix.session_id JOIN experience_guest_sessions session ON session.session_id=prefix.session_id
    WHERE json_array(prefix.session_id,prefix.destination_user_id,prefix.lease_id,prefix.request_id,prefix.manifest_digest,prefix.lineage_json,prefix.lineage_digest)=?
      AND json_array(claim.session_id,claim.destination_user_id,claim.lease_id,claim.request_id,claim.manifest_digest,claim.context_lineage_digest,claim.lineage_json,claim.lineage_digest)=?
      AND json_array(stage.session_id,stage.destination_user_id,stage.lease_id,stage.request_id,stage.manifest_digest,stage.context_lineage_digest,stage.save_lineage_digest,stage.lineage_json,stage.lineage_digest)=?
      AND prefix.created_at_ms=claim.created_at_ms AND prefix.created_at_ms=stage.created_at_ms AND prefix.created_at_ms=session.revoked_at_ms
      AND prefix.created_at_ms<=${GUEST_DB_NOW} AND session.expires_at_ms>${GUEST_DB_NOW}
      AND ${objectSql(sessionColumns, "session.")}=json_set(?,'$.revoked_at_ms',prefix.created_at_ms))`, bindings: [
    JSON.stringify([inventory.sessionId, auth.user.userId, leaseId, requestId, inventory.manifestDigest, prefixJson, prefixHash]),
    JSON.stringify([inventory.sessionId, auth.user.userId, leaseId, requestId, inventory.manifestDigest, prefixHash, lineageJson, lineageHash]),
    JSON.stringify([inventory.sessionId, auth.user.userId, leaseId, requestId, inventory.manifestDigest, prefixHash, lineageHash, stageJson, stageHash]), JSON.stringify(data.history.original.session)] };
  const copyPost: Proof = { sql: `(SELECT COUNT(*) FROM experience_guest_image_stage_copies WHERE session_id=?)=? AND
    (SELECT COUNT(*) FROM json_each(?) expected JOIN experience_guest_image_stage_copies copy ON ${arraySql(GUEST_IMAGE_STAGE_COPY_COLUMNS, "copy")}=expected.value)=?`,
  bindings: [inventory.sessionId, copies.length, JSON.stringify(copies.map(copy => tuple(copy, GUEST_IMAGE_STAGE_COPY_COLUMNS))), copies.length] };
  // Separate assertions preserve the native per-statement D1 capacity contract.
  // Every full before-proof precedes every insert; one DB transaction owns all.
  const before = [data.beforeProof, native, leaseProof(lease), sourceFuture, originalHead, collision, noPrior, memory];
  const statements = before.flatMap(proof => outputAssertionStatements(ctx.env, proof)), exactWrites: number[] = [];
  const eventOffset = statements.length;
  statements.push(...allEvents.map((event, i) => insertEventAtHead(ctx.env, event, head + i)));
  for (const event of prefixEvents) { exactWrites.push(statements.length); statements.push(ctx.db.prepare("INSERT INTO event_client_receipts(stream_id,client_event_id,event_id,sequence,created_at) VALUES(?,?,?,?,?)")
    .bind(event.streamId, String(event.payload.client_event_id), event.eventId, event.sequence, event.recordedAt)); }
  exactWrites.push(statements.length); statements.push(ctx.db.prepare(`INSERT INTO output_commands(${commandColumns}) VALUES(?,?,?,?,?,?,?)`)
    .bind(`personal:${auth.user.userId}:${inventory.projectId}`, auth.user.userId, key, requestDigest, "save", tail.eventId, tail.recordedAt));
  for (const prepared of preparations) for (const insert of prepared.statements.slice(0, prepared.requiredInserts)) { exactWrites.push(statements.length); statements.push(insert); }
  exactWrites.push(statements.length); statements.push(ctx.db.prepare(`INSERT INTO experience_guest_context_adoptions VALUES(?,?,?,?,?,?,?,${GUEST_DB_NOW})`)
    .bind(inventory.sessionId, auth.user.userId, leaseId, requestId, inventory.manifestDigest, prefixJson, prefixHash));
  exactWrites.push(statements.length); statements.push(ctx.db.prepare(`INSERT INTO experience_guest_image_claims(${claimColumns}) VALUES(?,?,?,?,?,?,?,?,(SELECT created_at_ms FROM experience_guest_context_adoptions WHERE session_id=?))`)
    .bind(inventory.sessionId, auth.user.userId, leaseId, requestId, inventory.manifestDigest, prefixHash, lineageJson, lineageHash, inventory.sessionId));
  exactWrites.push(statements.length); statements.push(ctx.db.prepare(`INSERT INTO experience_guest_image_stage_custodies(${GUEST_IMAGE_STAGE_CUSTODY_COLUMNS}) VALUES(?,?,?,?,?,?,?,?,?,(SELECT created_at_ms FROM experience_guest_context_adoptions WHERE session_id=?))`)
    .bind(inventory.sessionId, auth.user.userId, leaseId, requestId, inventory.manifestDigest, prefixHash, lineageHash, stageJson, stageHash, inventory.sessionId));
  for (const copy of copies) { exactWrites.push(statements.length); statements.push(ctx.db.prepare(`INSERT INTO experience_guest_image_stage_copies(${GUEST_IMAGE_STAGE_COPY_COLUMNS}) VALUES(?,?,?,?,?,?,?)`)
    .bind(copy.session_id, copy.role, copy.content_id, copy.original_digest, copy.byte_length, copy.created_at, copy.expires_at)); }
  exactWrites.push(statements.length); statements.push(ctx.db.prepare("UPDATE experience_guest_sessions SET revoked_at_ms=(SELECT created_at_ms FROM experience_guest_context_adoptions WHERE session_id=?) WHERE session_id=? AND revoked_at_ms IS NULL")
    .bind(inventory.sessionId, inventory.sessionId));
  const after = [...data.sourceParts, data.history.currentPolicyProof, native, leaseProof(lease), sourceFuture, completedSourceClosure(data), collision, memory,
    guestImageCopyPrefixTargets(prefix, prefixBodies), guestImageCopyEventMeta(lineage, true), guestImageCopyCommandProof(lineage), guestImageCopyTargetBody(lineage, body),
    guestImageCopyTargetCustody(lineage, prefix), receiptPost, copyPost, copyBodiesProof(auth.user.userId, copies, contents, exclusion),
    { sql: "(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?", bindings: [auth.user.streamId, tail.sequence] }];
  statements.push(...after.flatMap(proof => outputAssertionStatements(ctx.env, proof)));
  liveInventory();
  try {
    const result = await ctx.db.batch(statements); ctx.current();
    const own = (value: unknown, key: PropertyKey): unknown => value !== null && typeof value === "object" ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
    if (!Array.isArray(result) || result.length !== statements.length || Array.from({ length: statements.length }, (_, i) => i)
      .some(i => own(own(result, i), "success") !== true || own(own(result, i), "error") !== undefined)
      || allEvents.some((_, i) => !integer(own(own(own(result, eventOffset + i), "meta"), "changes"), 1))
      || exactWrites.some(i => own(own(own(result, i), "meta"), "changes") !== 1)) return fail("acknowledgement_unavailable");
  } catch (error) {
    // This invocation has attempted its sole copy mutation. Recovery can read
    // only the original exact completed mapping, never construct a successor.
    ctx.current(); const recovered = await completed(ctx, inventory.sessionId); ctx.current();
    if (!recovered) throw error;
    return { ...exact(recovered, { sessionId: inventory.sessionId, requestId, approvedManifestDigest: inventory.manifestDigest }, leaseId), replayed: true };
  }
  const saved = await completed(ctx, inventory.sessionId); ctx.current();
  if (!saved) return fail();
  return { ...exact(saved, { sessionId: inventory.sessionId, requestId, approvedManifestDigest: inventory.manifestDigest }, leaseId), replayed: false };
}
function response(saved: Completed, replayed: boolean, historyRetention: "retained" | "unavailable") {
  return freeze({ version: 1 as const, status: "image-stage-history-claimed" as const, sessionId: saved.mapping.lineage.sessionId,
    stageState: saved.mapping.lineage.source.state, contextCustodyTransferred: true as const, requirementCustodyTransferred: true as const,
    stageHistoryCustodyTransferred: true as const, historyRetention, planRetention: "not-attempted" as const,
    generationAvailable: false as const, miniAppClaimComplete: false as const, receipt: saved.native.receipt, replayed });
}
/** Dormant deliberate historical claim. Canonical completed recovery precedes
 * guest proof; private history never supplies canonical execution authority. */
export async function claimGuestImageStages(request: Request, env: WorkerEnv, input: GuestImageStageClaimRequest) {
  const ctx = context(request, env);
  if (jsonIssues(input).length || !record(input) || !exactKeys(input, ["sessionId", "requestId", "approvedManifestDigest", ...(Object.hasOwn(input, "proof") ? ["proof"] : [])])
    || !guestId(input.sessionId) || !guestId(input.requestId) || !guestHash(input.approvedManifestDigest)) return fail("invalid");
  const captured = structuredClone(input);
  if (Object.hasOwn(captured, "proof") && (!record(captured.proof) || !exactKeys(captured.proof, ["sessionId", "sessionToken", "claimToken"])
    || captured.proof.sessionId !== captured.sessionId || typeof captured.proof.sessionToken !== "string" || typeof captured.proof.claimToken !== "string"
    || !/^forma-guest-session-v1\.[a-f0-9]{64}$/u.test(captured.proof.sessionToken) || !/^forma-guest-claim-v1\.[a-f0-9]{64}$/u.test(captured.proof.claimToken))) return fail("invalid");
  let saved = await completed(ctx, captured.sessionId); ctx.current(); let replayed = saved !== null;
  if (saved) exact(saved, captured);
  else {
    if (!captured.proof) return fail("proof_unavailable");
    try {
      const inventory = await inspectGuestImageStageClaimInventory(request, env, { proof: captured.proof }); ctx.current();
      if (inventory.sessionId !== captured.sessionId || inventory.manifestDigest !== captured.approvedManifestDigest) return fail("conflict");
      const lease = await acquireGuestImageStageClaimLease(request, env, { proof: captured.proof, requestId: captured.requestId, inventory }); ctx.current();
      const leasedInventory = await inspectGuestImageStageClaimInventory(request, env, { proof: captured.proof }); ctx.current();
      if (leasedInventory.manifestDigest !== inventory.manifestDigest || leasedInventory.destinationUserId !== inventory.destinationUserId) return fail("conflict");
      const copied = await copy(ctx, leasedInventory, lease.leaseId, captured.requestId); ctx.current();
      saved = exact(copied, captured); replayed = copied.replayed;
    } catch (error) {
      ctx.current(); saved = await completed(ctx, captured.sessionId); ctx.current();
      if (!saved) throw error; exact(saved, captured); replayed = true;
    }
  }
  try {
    const history = await readClaimedGuestImageStageHistory(request, env, { sessionId: captured.sessionId }); ctx.current();
    if (!history || history.stageState !== saved.mapping.lineage.source.state) return fail();
    // The dedicated reader's final joined proof is the last awaited operation;
    // only source-free availability and immutable receipt facts leave this path.
    return response(saved, replayed, "retained");
  } catch {
    ctx.current(); const current = await completed(ctx, captured.sessionId); ctx.current();
    if (!current) return fail(); exact(current, captured);
    return response(current, replayed, "unavailable");
  }
}
