import { canonicalJson, digest, exactKeys, freeze, jsonIssues, record } from "../src/experiences/compiler.ts";
import { experienceDocumentRoute, experienceResourceId } from "../src/experiences/intake.ts";
import { insertEventAtHead } from "./event-append.ts";
import { makeEvent } from "./event-write-primitives.ts";
import { publicEventPayload } from "./event-privacy.ts";
import { readExistingPrincipalRequest, requireConsent } from "./principal-request-core.ts";
import { projectIntakeAuthority } from "./intake-authority.ts";
import { guestContextAdoptionData, inspectGuestContextAdoption } from "./experience-guest-context-adoption.ts";
import { retainGuestContextPlan } from "./experience-guest-plan-custody.ts";
import { acquireGuestImageSaveClaimLease } from "./experience-guest-claim-lease.ts";
import { GUEST_IMAGE_SAVE_CLAIM_SCHEMA, guestImageSaveInventoryData, inspectGuestImageSaveInventory,
  type GuestImageSaveInventory } from "./experience-guest-image-claim-inventory.ts";
import { GUEST_DB_NOW, guestFail, guestHash, guestId, type GuestClaimProof } from "./experience-guest-session.ts";
import { outputAssertionStatements } from "./output-command-core.ts";
import { nativeMemoryAnswerExclusion } from "./memory-native-boundary.ts";
import { nativeStructuredOriginSchema } from "./memory-native-origin-schema.ts";
import { nativeDocumentJobOriginSchema } from "./memory-document-job-origin-schema.ts";
import type { WorkerEnv } from "./runtime.ts";

import { guestImageCopyPrefixEventInput, guestImageCopyPrefixLineage, guestImageCopyOriginalSource,
  guestImageCopySaveEnvelope, guestImageCopySaveEventInput, guestImageCopyLineage,
  guestImageCopyCommandKey as commandKey, guestImageCopyClaimRowProof as claimRowProof,
  guestImageCopyEventMeta as eventMeta, guestImageCopyCommandProof as commandProof,
  guestImageCopyTargetCustody as targetCustody, guestImageCopyTargetBody as targetBody,
  guestImageCopyPrefixTargets as prefixTargets, guestImageCopyClaimProvenance as claimProvenance,
  type GuestImageClaimLineage, type GuestImageCopyRow as Row, type GuestImageCopyCommand as Command,
  type GuestImageCopyResource as Resource } from "./experience-guest-image-copy-contract.ts";
export type { GuestImageClaimLineage } from "./experience-guest-image-copy-contract.ts";

export const GUEST_IMAGE_CLAIM_SCHEMA = GUEST_IMAGE_SAVE_CLAIM_SCHEMA;
type Value = string | number | null;
type Proof = { sql: string; bindings: Value[] };
type Context = { request: Request; env: WorkerEnv; db: WorkerEnv["DB"]; current: () => void };
type Prefix = ReturnType<typeof guestContextAdoptionData>;
export type GuestImageClaimRequest = Readonly<{ sessionId: string; requestId: string; approvedManifestDigest: string; proof?: GuestClaimProof }>;
const rowColumns = "session_id,destination_user_id,lease_id,request_id,manifest_digest,context_lineage_digest,lineage_json,lineage_digest,created_at_ms";
const commandColumns = "scope_key,actor_user_id,command_key,request_digest,action,event_id,created_at";
const resourceColumns = "resource_id,campaign_id,policy_digest,limits_digest,actor_user_id,session_digest,operation,intent_key,payload_digest,text_bytes,issued_grant_id,recorded_at_ms";
const leaseColumns = "session_id,lease_id,destination_user_id,manifest_digest,request_id,request_ids_json,acquisitions,created_at_ms,expires_at_ms";
const planColumns = "session_id,destination_user_id,draft_id,content_id,draft_hash,content_digest,lineage_digest,created_at,expires_at";
const eventKeys = ["id", "sequence", "occurred", "recorded", "public", "privateDigest"];
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
const fail = (code = "unavailable"): never => guestFail(`image_claim_${code}`);
const integer = (value: unknown, min = 0): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= min;
const text = (value: unknown, max = 240): value is string => typeof value === "string" && value.length > 0 && value.length <= max
  && value.trim() === value && value.isWellFormed() && !/[\p{Cc}]/u.test(value);
const rawHash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const iso = (value: unknown): value is string => typeof value === "string" && value.length === 24 && Number.isSafeInteger(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
const tuple = (row: object, columns: string) => JSON.stringify(columns.split(",").map(key => (row as Record<string, unknown>)[key]));
const arraySql = (columns: string, alias: string) => `json_array(${columns.split(",").map(key => `${alias}.${key}`).join(",")})`;
const all = (...parts: Proof[]): Proof => ({ sql: `EXISTS(WITH ${parts.map((part, i) => `claim_p${i} AS MATERIALIZED(SELECT 1 WHERE ${part.sql})`).join(",")}
  SELECT 1 FROM ${parts.map((_, i) => `claim_p${i}`).join(",")})`, bindings: parts.flatMap(part => part.bindings) });
const parsed = (value: string): Record<string, unknown> => {
  let result: unknown; try { result = JSON.parse(value); } catch { return fail(); }
  if (!record(result) || jsonIssues(result).length) return fail();
  return result;
};

/** Closed historical metadata only. Validation is not live custody authority. */
export function readGuestImageClaimLineage(raw: unknown): GuestImageClaimLineage {
  if (typeof raw !== "string" || !raw.isWellFormed() || bytes(raw) > 65536) return fail();
  const value = parsed(raw);
  if (!exactKeys(value, ["version", "kind", "sessionId", "guestSubject", "destinationUserId", "projectId", "documentId", "draftId", "draftHash", "manifestDigest", "origin", "contextLineageDigest", "source", "target"])
    || value.version !== 1 || value.kind !== "first-image-save" || !guestId(value.sessionId) || !guestId(value.projectId) || !guestId(value.documentId)
    || !text(value.destinationUserId) || value.destinationUserId.startsWith("guest:") || !text(value.guestSubject) || !/^guest:[a-f0-9-]{36}$/u.test(value.guestSubject)
    || !text(value.draftId) || !/^experience-draft-[a-f0-9]{64}$/u.test(value.draftId) || !guestHash(value.draftHash)
    || !guestHash(value.manifestDigest) || !guestHash(value.contextLineageDigest) || typeof value.origin !== "string"
    || !record(value.source) || !record(value.target) || canonicalJson(value) !== raw) return fail();
  let origin: URL; try { origin = new URL(value.origin); } catch { return fail(); }
  if (origin.protocol !== "https:" || origin.origin !== value.origin) return fail();
  const source = value.source, target = value.target;
  if (!exactKeys(source, ["head", "eventIds", "expiresAt", "sessionPolicyId", "sessionTermsDigest", "sessionExpiresAtMs", "sourcePolicyId", "sourcePolicyDigest", "requestDigest", "contentDigest", "releaseHash", "save", "command", "resource"])
    || !integer(source.head, 3) || source.head > 16 || !Array.isArray(source.eventIds) || source.eventIds.length !== source.head
    || source.eventIds.some(id => !guestId(id)) || new Set(source.eventIds).size !== source.head || !iso(source.expiresAt)
    || !guestId(source.sessionPolicyId) || !guestId(source.sourcePolicyId) || !integer(source.sessionExpiresAtMs, 1)
    || Date.parse(source.expiresAt) > source.sessionExpiresAtMs
    || [source.sessionTermsDigest, source.sourcePolicyDigest, source.requestDigest, source.contentDigest, source.releaseHash].some(hash => !guestHash(hash))
    || !record(source.save) || !record(source.command) || !record(source.resource)
    || !exactKeys(source.save, eventKeys) || !exactKeys(target, [...eventKeys, "commandKey", "requestDigest", "requirementId", "contextHead"])) return fail();
  for (const event of [source.save, target]) if (!guestId(event.id) || !integer(event.sequence, 1) || !iso(event.occurred) || !iso(event.recorded)
    || event.occurred !== event.recorded || typeof event.public !== "string" || bytes(event.public) > 8192 || !guestHash(event.privateDigest)) return fail();
  const command = source.command, resource = source.resource;
  if (!exactKeys(command, commandColumns.split(",")) || !exactKeys(resource, resourceColumns.split(","))
    || command.scope_key !== `personal:${value.guestSubject}:${value.projectId}` || command.actor_user_id !== value.guestSubject
    || !text(command.command_key, 200) || !rawHash(command.request_digest) || command.action !== "save"
    || command.event_id !== source.save.id || command.created_at !== source.save.recorded
    || resource.resource_id !== `${command.command_key}:text` || !text(resource.campaign_id, 200)
    || !guestHash(resource.policy_digest) || !guestHash(resource.limits_digest) || !guestHash(resource.session_digest)
    || resource.actor_user_id !== value.guestSubject || resource.operation !== "text-intake" || resource.intent_key !== command.command_key
    || resource.payload_digest !== `sha256:${command.request_digest}` || resource.issued_grant_id !== null
    || !integer(resource.text_bytes) || !integer(resource.recorded_at_ms) || source.save.sequence !== source.head + 1
    || !integer(target.contextHead, source.head) || target.sequence !== target.contextHead + 1 || !guestId(target.requirementId)
    || !text(target.commandKey, 200) || !rawHash(target.requestDigest)
    || source.eventIds.includes(source.save.id) || source.eventIds.includes(target.id) || source.save.id === target.id) return fail();
  for (const event of [source.save, target]) {
    const pub = parsed(String(event.public));
    if (!exactKeys(pub, ["block_id", "type", "scope", "project_id", "document_id", "actor_user_id", "_private_ref"])
      || pub.block_id !== target.requirementId || pub.type !== "output" || pub.scope !== "document" || pub.project_id !== value.projectId
      || pub.document_id !== value.documentId || pub._private_ref !== event.id
      || pub.actor_user_id !== (event === target ? value.destinationUserId : value.guestSubject)) return fail();
  }
  return freeze(value as unknown as GuestImageClaimLineage);
}

function context(request: Request, env: WorkerEnv): Context {
  if (!(request instanceof Request)) return fail("request_invalid");
  const db = env.DB, url = request.url, method = request.method, headers = JSON.stringify(Array.from(request.headers)), signal = request.signal;
  const cohort = env.FORMA_PILOT_COHORT_ID, admins = env.FORMA_ADMIN_EMAILS, origin = new URL(url), site = request.headers.get("sec-fetch-site");
  if (method !== "POST" || origin.protocol !== "https:" || origin.username || origin.password || origin.search || origin.hash
    || request.headers.get("origin") !== origin.origin || site !== null && site !== "same-origin" && site !== "none" || bytes(headers) > 32768
    || (request.headers.get("cookie") ?? "").split(";").some(part => ["forma_project_context", "forma_impersonation"].includes(part.split("=", 1)[0]!.trim()))) return fail("request_invalid");
  const current = () => {
    if (env.DB !== db) fail("database_changed");
    if (request.signal !== signal || signal.aborted) fail("aborted");
    if (request.url !== url || request.method !== method || JSON.stringify(Array.from(request.headers)) !== headers
      || env.FORMA_PILOT_COHORT_ID !== cohort || env.FORMA_ADMIN_EMAILS !== admins) fail("authority_changed");
  };
  current(); return { request, env, db, current };
}
async function prove(ctx: Context, proof: Proof) {
  ctx.current(); const live = await ctx.db.prepare(`SELECT 1 AS current WHERE ${proof.sql}`).bind(...proof.bindings).first();
  ctx.current(); if (!live) return fail();
}
async function destination(ctx: Context) {
  const auth = await readExistingPrincipalRequest(ctx.request, ctx.env, "creator", { account: "principal" }); ctx.current();
  if ("kind" in auth || auth.response || !auth.user || requireConsent(auth.user) || auth.user.fictional || auth.user.projectExecution
    || auth.user.userId.startsWith("guest:") || !auth.user.access.capabilities.includes("project.author")) return fail("destination_unavailable");
  return { user: auth.user, principal: auth.user, impersonation: null };
}
function leaseProof(lease: Record<string, Value>, active: boolean): Proof {
  return { sql: `EXISTS(SELECT 1 FROM experience_guest_claim_leases lease WHERE ${arraySql(leaseColumns, "lease") }=?${active ? ` AND expires_at_ms>${GUEST_DB_NOW}` : ""})`, bindings: [tuple(lease, leaseColumns)] };
}
const registries = ["memory_native_answer_origins", "memory_structured_answer_origins", "memory_document_job_answer_origins"] as const;
const memorySchema = `(SELECT json_group_array(json_object('type',type,'name',name,'sql',definition)) FROM
  (SELECT type,name,CASE WHEN length(CAST(sql AS BLOB))<=16384 THEN sql ELSE NULL END AS definition FROM sqlite_schema
    WHERE type IN('table','view') AND name IN(${registries.map(name => `'${name}'`).join(",")}) ORDER BY name LIMIT 4))`;
async function targetMemory(ctx: Context, ids: string[]): Promise<Proof> {
  const [structured, documentJob] = await Promise.all([nativeStructuredOriginSchema(ctx.env), nativeDocumentJobOriginSchema(ctx.env)]); ctx.current();
  const row = await ctx.db.prepare(`SELECT ${memorySchema} AS snapshot`).first<{ snapshot: string }>(); ctx.current();
  if (!row || bytes(row.snapshot) > 65536) return fail();
  const found: unknown = JSON.parse(row.snapshot);
  if (!Array.isArray(found) || found.length > 3 || found.some(item => !record(item) || !exactKeys(item, ["type", "name", "sql"])
    || item.type !== "table" || !registries.includes(item.name as typeof registries[number]) || typeof item.sql !== "string")) return fail();
  // Retain the complete native family witnesses, including auxiliary tables,
  // indexes and triggers. The three registry tables alone cannot certify them.
  const parts: Proof[] = [structured, documentJob].map(family => ({ sql: family.guard.condition, bindings: [...family.guard.bindings] }));
  parts.push({ sql: `${memorySchema}=?`, bindings: [row.snapshot] });
  for (const item of found) parts.push({ sql: `NOT EXISTS(SELECT 1 FROM ${item.name} WHERE user_event_id IN(SELECT value FROM json_each(?)) OR answer_event_id IN(SELECT value FROM json_each(?)))`, bindings: [JSON.stringify(ids), JSON.stringify(ids)] });
  return all(...parts);
}
function sourceMetadata(lineage: GuestImageClaimLineage): Proof {
  const s = lineage.source;
  // One exact tuple preserves all immutable original metadata while leaving
  // room for complete Memory proofs under D1's 100-binding statement limit.
  return { sql: `EXISTS(SELECT 1 FROM experience_guest_sources source JOIN experience_guest_sessions session ON session.session_id=source.session_id
    JOIN experience_guest_source_commits committed ON committed.session_id=source.session_id
    WHERE json_array(source.session_id,source.draft_id,source.draft_hash,source.policy_id,source.policy_digest,source.request_digest,source.content_digest,
      source.expires_at,source.event_count,session.policy_id,session.terms_digest,session.expires_at_ms,committed.head,committed.event_ids_json)=?
      AND committed.draft_hash=source.draft_hash)`,
  bindings: [JSON.stringify([lineage.sessionId, lineage.draftId, lineage.draftHash, s.sourcePolicyId, s.sourcePolicyDigest, s.requestDigest, s.contentDigest,
    s.expiresAt, s.head, s.sessionPolicyId, s.sessionTermsDigest, s.sessionExpiresAtMs, s.head, JSON.stringify(s.eventIds)])] };
}
function receipt(lineage: GuestImageClaimLineage, row: Row, replayed: boolean) {
  return freeze({ version: 1 as const, status: "image-save-adopted" as const, sessionId: lineage.sessionId, destinationUserId: lineage.destinationUserId,
    leaseId: row.lease_id, requestId: row.request_id, manifestDigest: lineage.manifestDigest, projectId: lineage.projectId, documentId: lineage.documentId,
    requirementId: lineage.target.requirementId, eventId: lineage.target.id, commandKey: lineage.target.commandKey, revision: lineage.target.sequence,
    route: experienceDocumentRoute({ documentId: lineage.documentId, title: "Image" }), contextCustodyTransferred: true as const,
    requirementCustodyTransferred: true as const, generationAvailable: false as const, miniAppClaimComplete: false as const, replayed });
}
async function completed(ctx: Context, sessionId: string) {
  const witness = await inspectGuestContextAdoption(ctx.request, ctx.env, { sessionId }); ctx.current();
  const row = await ctx.db.prepare(`SELECT ${rowColumns} FROM experience_guest_image_claims WHERE session_id=? AND length(CAST(lineage_json AS BLOB)) BETWEEN 1 AND 65536`)
    .bind(sessionId).first<Row>(); ctx.current();
  if (!row) {
    const present = await ctx.db.prepare("SELECT 1 FROM experience_guest_image_claims WHERE session_id=?").bind(sessionId).first(); ctx.current();
    if (present) return fail();
    return null;
  }
  if (!witness) return fail();
  const prefix = guestContextAdoptionData(ctx.env, witness), lineage = readGuestImageClaimLineage(row.lineage_json);
  if (lineage.sessionId !== sessionId || lineage.destinationUserId !== prefix.lineage.destinationUserId || row.destination_user_id !== lineage.destinationUserId
    || row.manifest_digest !== lineage.manifestDigest || row.context_lineage_digest !== prefix.row.lineage_digest || lineage.contextLineageDigest !== prefix.row.lineage_digest
    || row.lease_id !== prefix.row.lease_id || row.request_id !== prefix.row.request_id || row.manifest_digest !== prefix.row.manifest_digest
    || row.created_at_ms !== prefix.row.created_at_ms || !integer(row.created_at_ms) || lineage.projectId !== prefix.lineage.projectId
    || lineage.documentId !== prefix.lineage.documentId || lineage.draftHash !== prefix.lineage.draftHash || lineage.guestSubject !== prefix.lineage.guestSubject
    || lineage.origin !== prefix.lineage.origin || lineage.origin !== new URL(ctx.request.url).origin || lineage.target.contextHead !== prefix.lineage.targetHead
    || lineage.source.head !== prefix.lineage.sourceHead || canonicalJson(lineage.source.eventIds) !== canonicalJson(prefix.lineage.sourceEventIds)
    || [...lineage.source.eventIds, lineage.source.save.id].some(id => prefix.lineage.events.some(event => event.id === id))
    || prefix.lineage.events.some(event => event.id === lineage.target.id)) return fail();
  const [lineageHash, key, requirement] = await Promise.all([digest(lineage), commandKey(sessionId, lineage.destinationUserId, lineage.manifestDigest), experienceResourceId(lineage.draftId, "native-output-requirement")]); ctx.current();
  if (lineageHash !== row.lineage_digest || key !== lineage.target.commandKey || requirement !== lineage.target.requirementId) return fail();
  const memory = await targetMemory(ctx, [...prefix.lineage.events.map(event => event.id), lineage.target.id]); ctx.current();
  const guards = [prefix.proof, claimRowProof(row), sourceMetadata(lineage), eventMeta(lineage, false), eventMeta(lineage, true), commandProof(lineage), targetCustody(lineage, prefix.lineage), memory];
  const read = all(...guards);
  const body = await ctx.db.prepare(`SELECT private_json FROM event_private_payloads WHERE private_event_id=? AND redacted_at IS NULL
    AND length(CAST(private_json AS BLOB)) BETWEEN 1 AND 65536 AND ${read.sql}`).bind(lineage.target.id, ...read.bindings).first<{ private_json: string }>(); ctx.current();
  if (!body || await digest(body.private_json) !== lineage.target.privateDigest) return fail(); ctx.current();
  const payload = parsed(body.private_json), envelope = payload.output_command_envelope;
  if (!record(envelope) || !exactKeys(envelope, ["action", "documentId", "expectedRevision", "clientMutationId", "blockId", "spec", "planSuggestions", "guestImageClaim"])
    || envelope.action !== "save" || envelope.documentId !== lineage.documentId || envelope.expectedRevision !== `output:${lineage.target.contextHead}`
    || envelope.clientMutationId !== lineage.target.commandKey || envelope.blockId !== lineage.target.requirementId
    || canonicalJson(envelope.guestImageClaim) !== canonicalJson(claimProvenance(lineage))
    || JSON.stringify(publicEventPayload(lineage.target.id, payload, true).payload) !== lineage.target.public
    || (await digest(envelope)).slice(7) !== lineage.target.requestDigest) return fail(); ctx.current();
  const proof = all(...guards, targetBody(lineage, body.private_json));
  await prove(ctx, proof); ctx.current();
  // This receipt resolves the current completed row, including after a first
  // copy. replayed does not mean adoption necessarily predates this invocation.
  return { row, lineage, prefix, proof, receipt: receipt(lineage, row, true) };
}

/** Source-free current canonical receipt. No guest credentials or payer access. */
export async function readGuestImageClaim(request: Request, env: WorkerEnv, input: { sessionId: string }) {
  const ctx = context(request, env);
  if (jsonIssues(input).length || !record(input) || !exactKeys(input, ["sessionId"]) || !guestId(input.sessionId)) return fail("invalid");
  const saved = await completed(ctx, input.sessionId); ctx.current();
  return saved?.receipt ?? null;
}

/** Separate internal canonical GET capture; the existing POST context and
 * public receipt reader retain their original contract. completed() binds the
 * request origin to the stored immutable canonical origin before disclosure. */
function completedReadContext(request: Request, env: WorkerEnv): Context {
  if (!(request instanceof Request)) return fail("request_invalid");
  if (request.method === "POST") return context(request, env);
  const db = env.DB, url = request.url, method = request.method, headers = JSON.stringify(Array.from(request.headers)), signal = request.signal;
  const cohort = env.FORMA_PILOT_COHORT_ID, admins = env.FORMA_ADMIN_EMAILS, origin = new URL(url), site = request.headers.get("sec-fetch-site");
  if (method !== "GET" || origin.protocol !== "https:" || origin.username || origin.password || origin.search || origin.hash
    || request.headers.has("origin") && request.headers.get("origin") !== origin.origin
    || site !== null && site !== "same-origin" && site !== "none" || bytes(headers) > 32768
    || (request.headers.get("cookie") ?? "").split(";").some(part => ["forma_project_context", "forma_impersonation"].includes(part.split("=", 1)[0]!.trim()))) return fail("request_invalid");
  const current = () => {
    if (env.DB !== db) fail("database_changed");
    if (request.signal !== signal || signal.aborted) fail("aborted");
    if (request.url !== url || request.method !== method || JSON.stringify(Array.from(request.headers)) !== headers
      || env.FORMA_PILOT_COHORT_ID !== cohort || env.FORMA_ADMIN_EMAILS !== admins) fail("authority_changed");
  };
  current(); return { request, env, db, current };
}
declare const completedImageClaimBrand: unique symbol;
export type GuestImageCompletedClaimWitness = Readonly<{ [completedImageClaimBrand]: true }>;
type CompletedReadData = Readonly<Pick<Completed, "row" | "lineage" | "proof" | "receipt"> & {
  prefix: Pick<Prefix, "row" | "lineage" | "proof">;
}>;
const completedImageClaims = new WeakMap<GuestImageCompletedClaimWitness, { ctx: Context; data: CompletedReadData }>();

/** Internal completed-only read capability. No guest credentials, new claim,
 * payer access or source-free receipt can create this request-bound witness. */
export async function inspectCompletedGuestImageClaim(request: Request, env: WorkerEnv, input: { sessionId: string }): Promise<GuestImageCompletedClaimWitness | null> {
  const ctx = completedReadContext(request, env);
  if (jsonIssues(input).length || !record(input) || !exactKeys(input, ["sessionId"]) || !guestId(input.sessionId)) return fail("invalid");
  const saved = await completed(ctx, input.sessionId); ctx.current();
  if (!saved) return null;
  // Only inert values are cloned/frozen. Native auth, Request, env, DB and the
  // lifecycle closure stay outside this recursively frozen value container.
  const data = freeze(structuredClone({ row: saved.row, lineage: saved.lineage, proof: saved.proof, receipt: saved.receipt,
    prefix: { row: saved.prefix.row, lineage: saved.prefix.lineage, proof: saved.prefix.proof } }));
  const witness = Object.freeze(Object.create(null)) as GuestImageCompletedClaimWitness;
  completedImageClaims.set(witness, { ctx, data });
  return witness;
}
export function guestImageCompletedClaimData(request: Request, env: WorkerEnv, witness: GuestImageCompletedClaimWitness): CompletedReadData {
  const saved = witness && typeof witness === "object" ? completedImageClaims.get(witness) : undefined;
  if (!saved || saved.ctx.request !== request || saved.ctx.env !== env) return fail();
  saved.ctx.current();
  // This proof is a component, not an automatic reread. Consumers must join it
  // with exact mapping/body predicates in their final awaited read, then call
  // this accessor again to check captured request and environment identity.
  return saved.data;
}

async function copy(ctx: Context, inventory: GuestImageSaveInventory, leaseId: string, requestId: string) {
  const data = guestImageSaveInventoryData(ctx.env, inventory), auth = await destination(ctx); ctx.current();
  if (new URL(ctx.request.url).origin !== data.session.policy.terms.origin) return fail("origin_required");
  const native = projectIntakeAuthority(ctx.env, auth, inventory);
  const lease = await ctx.db.prepare(`SELECT ${leaseColumns} FROM experience_guest_claim_leases WHERE session_id=? AND lease_id=? AND request_id=?
    AND destination_user_id=? AND manifest_digest=? AND expires_at_ms>${GUEST_DB_NOW}`)
    .bind(inventory.sessionId, leaseId, requestId, auth.user.userId, inventory.manifestDigest).first<Prefix["lineage"]["lease"]>(); ctx.current();
  if (!lease) return fail("lease_unavailable");
  const currentHead = await ctx.db.prepare("SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?").bind(auth.user.streamId).first<{ head: number }>(); ctx.current();
  if (!currentHead || !integer(currentHead.head)) return fail();
  const head = currentHead.head, plan = data.plan;
  const prefixEvents = plan.events.map((event, index) => makeEvent(...guestImageCopyPrefixEventInput(
    { destinationStreamId: auth.user.streamId, head, sessionId: inventory.sessionId }, event, index)));
  const prefixBodies = prefixEvents.map(event => JSON.stringify(event.payload));
  const hashes = await Promise.all(prefixBodies.map(body => digest(body))); ctx.current();
  const prefix = guestImageCopyPrefixLineage({ sessionId: inventory.sessionId, guestSubject: inventory.guestSubject, projectId: inventory.projectId,
    documentId: inventory.documentId, draftHash: inventory.draftHash, manifestDigest: inventory.manifestDigest, sourceEventIds: data.sourceEventIds,
    sourceHead: inventory.sourceHead, destinationUserId: auth.user.userId, origin: data.session.policy.terms.origin, head }, prefixEvents, hashes, lease);
  const prefixJson = canonicalJson(prefix), prefixHash = await digest(prefix); ctx.current();
  const sourcePayload = parsed(data.save.privateJson), originalEnvelope = sourcePayload.output_command_envelope;
  if (!record(originalEnvelope) || !record(originalEnvelope.guestSponsorPreparation) || !record(originalEnvelope.guestSponsorPreparation.source)) return fail();
  const original = originalEnvelope.guestSponsorPreparation.source;
  const source = guestImageCopyOriginalSource({ head: inventory.sourceHead, eventIds: data.sourceEventIds, expiresAt: inventory.expiresAt,
    sessionPolicyId: data.session.row.policy_id, sessionTermsDigest: data.session.row.terms_digest, sessionExpiresAtMs: data.session.row.expires_at_ms,
    releaseHash: plan.release.releaseHash }, { event: data.save.event, command: data.save.command as unknown as Command,
    resource: data.save.resource as unknown as Resource }, sourcePayload, original, await digest(data.save.privateJson)); ctx.current();
  const key = await commandKey(inventory.sessionId, auth.user.userId, inventory.manifestDigest); ctx.current();
  const envelope = guestImageCopySaveEnvelope({ sessionId: inventory.sessionId, manifestDigest: inventory.manifestDigest,
    guestSubject: inventory.guestSubject, documentId: inventory.documentId, source, contextHead: prefix.targetHead,
    commandKey: key, requirementId: data.save.requirementId }, { spec: originalEnvelope.spec, planSuggestions: originalEnvelope.planSuggestions });
  const requestDigest = (await digest(envelope)).slice(7); ctx.current();
  const tail = makeEvent(...guestImageCopySaveEventInput({ destinationStreamId: auth.user.streamId, destinationUserId: auth.user.userId,
    contextHead: prefix.targetHead, commandKey: key }, sourcePayload, envelope));
  const body = JSON.stringify(tail.payload), tailHash = await digest(body); ctx.current();
  const lineage = readGuestImageClaimLineage(canonicalJson(guestImageCopyLineage({ sessionId: inventory.sessionId, guestSubject: inventory.guestSubject,
    destinationUserId: auth.user.userId, projectId: inventory.projectId, documentId: inventory.documentId, draftId: plan.draftId, draftHash: plan.draftHash,
    manifestDigest: inventory.manifestDigest, origin: prefix.origin, contextLineageDigest: prefixHash, source,
    commandKey: key, requestDigest, requirementId: data.save.requirementId, contextHead: prefix.targetHead }, tail, tailHash)));
  const lineageJson = canonicalJson(lineage), lineageHash = await digest(lineage); ctx.current();
  const allEvents = [...prefixEvents, tail], memory = await targetMemory(ctx, allEvents.map(event => event.eventId)); ctx.current();
  const ids = JSON.stringify([...new Set([...plan.events.flatMap(event => [event.payload.project_id, event.payload.document_id, event.payload.block_id]
    .filter(value => typeof value === "string")), data.save.requirementId])]);
  const collision: Proof = { sql: `NOT EXISTS(SELECT 1 FROM events prior,json_tree(prior.payload) item WHERE prior.stream_id=? AND prior.sequence<=?
    AND item.type='text' AND item.value IN(SELECT value FROM json_each(?)))`, bindings: [auth.user.streamId, head, ids] };
  const originalHead: Proof = { sql: "(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?", bindings: [auth.user.streamId, head] };
  const noPrior: Proof = { sql: `NOT EXISTS(SELECT 1 FROM experience_guest_context_adoptions WHERE session_id=?)
    AND NOT EXISTS(SELECT 1 FROM experience_guest_image_claims WHERE session_id=?)`, bindings: [inventory.sessionId, inventory.sessionId] };
  const receiptPost: Proof = { sql: `EXISTS(SELECT 1 FROM experience_guest_context_adoptions prefix JOIN experience_guest_image_claims claim ON claim.session_id=prefix.session_id
    JOIN experience_guest_sessions session ON session.session_id=prefix.session_id
    WHERE prefix.session_id=? AND prefix.destination_user_id=? AND prefix.lease_id=? AND prefix.request_id=? AND prefix.manifest_digest=?
      AND prefix.lineage_json=? AND prefix.lineage_digest=? AND prefix.created_at_ms=session.revoked_at_ms
      AND claim.destination_user_id=prefix.destination_user_id AND claim.lease_id=prefix.lease_id AND claim.request_id=prefix.request_id
      AND claim.manifest_digest=prefix.manifest_digest AND claim.context_lineage_digest=prefix.lineage_digest AND claim.created_at_ms=prefix.created_at_ms
      AND claim.lineage_json=? AND claim.lineage_digest=? AND session.guest_subject=? AND session.project_id=? AND session.document_id=?
      AND session.expires_at_ms>${GUEST_DB_NOW})`, bindings: [inventory.sessionId, auth.user.userId, leaseId, requestId, inventory.manifestDigest,
    prefixJson, prefixHash, lineageJson, lineageHash, inventory.guestSubject, inventory.projectId, inventory.documentId] };
  // All full BEFORE checks precede native event insertion. appendEvents places
  // its sidecars afterwards, so this operation deliberately builds one batch.
  const before = [data.proof, native, leaseProof(lease, true), originalHead, collision, noPrior, memory];
  const statements = before.flatMap(guard => outputAssertionStatements(ctx.env, guard));
  const eventOffset = statements.length;
  statements.push(...allEvents.map((event, i) => insertEventAtHead(ctx.env, event, head + i)));
  const prefixReceiptOffset = statements.length;
  statements.push(...prefixEvents.map(event => ctx.db.prepare("INSERT INTO event_client_receipts(stream_id,client_event_id,event_id,sequence,created_at) VALUES(?,?,?,?,?)")
    .bind(event.streamId, String(event.payload.client_event_id), event.eventId, event.sequence, event.recordedAt)));
  const commandOffset = statements.length;
  statements.push(ctx.db.prepare(`INSERT INTO output_commands(${commandColumns}) VALUES(?,?,?,?,?,?,?)`)
    .bind(`personal:${auth.user.userId}:${inventory.projectId}`, auth.user.userId, key, requestDigest, "save", tail.eventId, tail.recordedAt));
  const prefixOffset = statements.length;
  statements.push(ctx.db.prepare(`INSERT INTO experience_guest_context_adoptions VALUES(?,?,?,?,?,?,?,${GUEST_DB_NOW})`)
    .bind(inventory.sessionId, auth.user.userId, leaseId, requestId, inventory.manifestDigest, prefixJson, prefixHash));
  const claimOffset = statements.length;
  statements.push(ctx.db.prepare(`INSERT INTO experience_guest_image_claims(${rowColumns}) VALUES(?,?,?,?,?,?,?,?,(SELECT created_at_ms FROM experience_guest_context_adoptions WHERE session_id=?))`)
    .bind(inventory.sessionId, auth.user.userId, leaseId, requestId, inventory.manifestDigest, prefixHash, lineageJson, lineageHash, inventory.sessionId));
  const revokeOffset = statements.length;
  statements.push(ctx.db.prepare("UPDATE experience_guest_sessions SET revoked_at_ms=(SELECT created_at_ms FROM experience_guest_context_adoptions WHERE session_id=?) WHERE session_id=? AND revoked_at_ms IS NULL")
    .bind(inventory.sessionId, inventory.sessionId));
  const after = [data.sourceProof, data.session.policy.guard, native, leaseProof(lease, true), collision, memory, prefixTargets(prefix, prefixBodies),
    eventMeta(lineage, true), commandProof(lineage), targetBody(lineage, body), targetCustody(lineage, prefix), receiptPost,
    { sql: "(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?", bindings: [auth.user.streamId, tail.sequence] }];
  statements.push(...after.flatMap(guard => outputAssertionStatements(ctx.env, guard)));
  ctx.current();
  try {
    const result = await ctx.db.batch(statements); ctx.current();
    if (!Array.isArray(result) || result.length !== statements.length || Array.from({ length: statements.length }, (_, i) => i).some(i => result[i]?.success !== true)
      || allEvents.some((_, i) => !integer(result[eventOffset + i]?.meta?.changes, 1))
      || [...prefixEvents.map((_, i) => prefixReceiptOffset + i), commandOffset, prefixOffset, claimOffset, revokeOffset].some(i => result[i]?.meta?.changes !== 1)) return fail("acknowledgement_unavailable");
  } catch (error) {
    ctx.current(); const recovered = await completed(ctx, inventory.sessionId); ctx.current();
    if (!recovered || recovered.row.lease_id !== leaseId || recovered.row.request_id !== requestId || recovered.row.manifest_digest !== inventory.manifestDigest) throw error;
    return recovered;
  }
  const saved = await completed(ctx, inventory.sessionId); ctx.current();
  if (!saved || saved.row.lease_id !== leaseId || saved.row.request_id !== requestId || saved.row.manifest_digest !== inventory.manifestDigest) return fail();
  return saved;
}

type Completed = NonNullable<Awaited<ReturnType<typeof completed>>>;
type Retained = Awaited<ReturnType<typeof retainGuestContextPlan>>;
function exact(saved: Completed, input: GuestImageClaimRequest) {
  if (saved.row.session_id !== input.sessionId || saved.row.request_id !== input.requestId || saved.row.manifest_digest !== input.approvedManifestDigest) return fail("conflict");
  return saved;
}
async function joinedPlan(ctx: Context, input: GuestImageClaimRequest, retained: Retained) {
  const saved = await completed(ctx, input.sessionId); ctx.current();
  if (!saved) return fail(); exact(saved, input);
  const prefix = saved.prefix, custody = retained.custody, plan = retained.plan;
  const expectedAppended = prefix.lineage.events.map((event, i) => ({ eventId: event.id, streamId: `creative:${prefix.lineage.destinationUserId}`,
    sequence: event.sequence, occurredAt: event.occurred, recordedAt: event.recorded, actor: "user", clientId: "server:guest-context-adoption",
    correlationId: `guest-context-adoption:${input.sessionId}`, causationId: null, compensatesEventId: null, schemaVersion: 1,
    type: event.type, payload: JSON.parse(prefix.bodies[i]) as Record<string, unknown> }));
  if (custody.sessionId !== input.sessionId || custody.destinationUserId !== saved.lineage.destinationUserId || custody.manifestDigest !== input.approvedManifestDigest
    || custody.lineageDigest !== prefix.row.lineage_digest || custody.draftId !== saved.lineage.draftId || custody.draftHash !== saved.lineage.draftHash
    || custody.projectId !== saved.lineage.projectId || custody.documentId !== saved.lineage.documentId || custody.targetStreamId !== `creative:${saved.lineage.destinationUserId}`
    || custody.head !== prefix.lineage.targetHead || canonicalJson(custody.eventIds) !== canonicalJson(prefix.lineage.events.map(event => event.id))
    || canonicalJson(custody.appended) !== canonicalJson(expectedAppended) || plan.draftId !== custody.draftId || plan.draftHash !== custody.draftHash
    || custody.documentRoute !== experienceDocumentRoute(plan)) return fail();
  const content = canonicalJson(plan);
  const [contentDigest, contentIdentity] = await Promise.all([digest(content), digest({ domain: "forma-guest-plan-custody-v1", sessionId: input.sessionId,
    destinationUserId: saved.lineage.destinationUserId, lineageDigest: prefix.row.lineage_digest })]); ctx.current();
  const mapping = await ctx.db.prepare(`SELECT ${planColumns} FROM experience_guest_plan_custodies WHERE session_id=?`).bind(input.sessionId).first<Record<string, Value>>(); ctx.current();
  if (!mapping || mapping.session_id !== input.sessionId || mapping.destination_user_id !== saved.lineage.destinationUserId || mapping.draft_id !== plan.draftId
    || mapping.content_id !== `experience-draft-${contentIdentity.slice(7)}` || mapping.draft_hash !== plan.draftHash || mapping.content_digest !== contentDigest
    || mapping.lineage_digest !== prefix.row.lineage_digest || mapping.expires_at !== retained.expiresAt || !iso(mapping.created_at) || !iso(mapping.expires_at)) return fail();
  const memory = await nativeMemoryAnswerExclusion(ctx.env, { answerAlias: "content" }); ctx.current();
  const planProof: Proof = { sql: `EXISTS(SELECT 1 FROM experience_guest_plan_custodies mapping JOIN private_content content ON content.content_id=mapping.content_id
    WHERE ${arraySql(planColumns, "mapping") }=? AND content.owner_id=mapping.destination_user_id AND content.kind='experience-draft' AND content.content=?
      AND content.created_at=mapping.created_at AND content.expires_at=mapping.expires_at AND content.redacted_at IS NULL
      AND content.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND NOT EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.resource_kind='content' AND resource.resource_id=content.content_id)
      AND NOT EXISTS(SELECT 1 FROM private_content_retention_scopes retention WHERE retention.content_id=content.content_id)
      AND (${memory.sql}))`, bindings: [tuple(mapping, planColumns), content, ...memory.bindings] };
  // This one joined SQL read is the final awaited success operation. Neither a
  // fresh SAVE-only receipt nor a fresh prefix-only read can disclose old bytes.
  await prove(ctx, all(saved.proof, planProof)); ctx.current();
  return freeze({ version: 1 as const, status: "image-save-claimed" as const, contextCustodyTransferred: true as const,
    requirementCustodyTransferred: true as const, generationAvailable: false as const, miniAppClaimComplete: false as const,
    receipt: saved.receipt, planRetention: "retained" as const, retained });
}

/** Dormant N+1 custody only. Completed canonical recovery precedes guest proof;
 * no identity bootstrap, provider admission, route or schema activation exists. */
export async function claimGuestImageSave(request: Request, env: WorkerEnv, input: GuestImageClaimRequest) {
  const ctx = context(request, env);
  if (jsonIssues(input).length || !record(input) || !exactKeys(input, ["sessionId", "requestId", "approvedManifestDigest", ...(Object.hasOwn(input, "proof") ? ["proof"] : [])])
    || !guestId(input.sessionId) || !guestId(input.requestId) || !guestHash(input.approvedManifestDigest)) return fail("invalid");
  const captured = structuredClone(input);
  if (Object.hasOwn(captured, "proof") && (!record(captured.proof) || !exactKeys(captured.proof, ["sessionId", "sessionToken", "claimToken"])
    || captured.proof.sessionId !== captured.sessionId || typeof captured.proof.sessionToken !== "string" || typeof captured.proof.claimToken !== "string"
    || !/^forma-guest-session-v1\.[a-f0-9]{64}$/u.test(captured.proof.sessionToken) || !/^forma-guest-claim-v1\.[a-f0-9]{64}$/u.test(captured.proof.claimToken))) return fail("invalid");
  let saved = await completed(ctx, captured.sessionId); ctx.current();
  if (saved) exact(saved, captured);
  else {
    if (!captured.proof) return fail("proof_unavailable");
    try {
      const inventory = await inspectGuestImageSaveInventory(request, env, { proof: captured.proof }); ctx.current();
      if (inventory.sessionId !== captured.sessionId || inventory.manifestDigest !== captured.approvedManifestDigest) return fail("conflict");
      const lease = await acquireGuestImageSaveClaimLease(request, env, { proof: captured.proof, requestId: captured.requestId, inventory }); ctx.current();
      saved = exact(await copy(ctx, inventory, lease.leaseId, captured.requestId), captured); ctx.current();
    } catch (error) {
      ctx.current(); saved = await completed(ctx, captured.sessionId); ctx.current();
      if (!saved) throw error;
      exact(saved, captured);
    }
  }
  try {
    const retained = await retainGuestContextPlan(request, env, { sessionId: captured.sessionId }); ctx.current();
    const result = await joinedPlan(ctx, captured, retained); ctx.current(); return result;
  } catch {
    // Discard every held private byte. Only a freshly authorized complete SAVE
    // can qualify a partial source-free return; revoked access is not success.
    ctx.current(); const current = await completed(ctx, captured.sessionId); ctx.current();
    if (!current) return fail(); exact(current, captured);
    return freeze({ version: 1 as const, status: "image-save-claimed" as const, contextCustodyTransferred: true as const,
      requirementCustodyTransferred: true as const, generationAvailable: false as const, miniAppClaimComplete: false as const,
      receipt: current.receipt, planRetention: "unavailable" as const });
  }
}
