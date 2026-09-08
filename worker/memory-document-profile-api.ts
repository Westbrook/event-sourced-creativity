import { memoryDigest } from "../src/model/scoped-memory.ts";
import { memoryCustodyMatches, parseMemoryCustody, type MemoryCustody } from "../src/model/memory-custody.ts";
import { parseMemoryDocumentProfile } from "../src/model/memory-document-profile.ts";
import { requireUser, requireConsent, type PilotUser } from "./pilot-policy.ts";
import { prepareDocumentAuthority } from "./context-authoring-authority.ts";
import { executionAdmissionGuard, type ConsequentialBinding } from "./consequential-consent.ts";
import { AssistantContextReadWitness } from "./assistant-context-source.ts";
import { nativeMemoryGrantDeadline } from "./memory-native-deadlines.ts";
import { readNativeDocumentPaletteProfile, documentProfileGrantValid, nativeDocumentProfileSuppressionsQuery } from "./memory-document-profile.ts";
import { DOCUMENT_PROFILE_POLICY, DOCUMENT_PROFILE_RECIPE, documentProfileEnabled, documentProfileSchemaReady,
  documentProfileGrantGuard, documentProfileWithdrawalStatements, type DocumentProfileGrant,
  type DocumentProfileSuppression, type DocumentProfileSqlGuard } from "./memory-document-profile-store.ts";
import type { LiveMemoryEnrollment } from "./memory-live-authority.ts";
import type { NativeMemoryContextObserver } from "./memory-live-context.ts";
import type { WorkerEnv } from "./runtime.ts";

export const DOCUMENT_PROFILE_CONTROL_VERSION = "document-profile-control-v1";
const HEADERS = { "cache-control": "private, no-store", vary: "Cookie, oai-authenticated-user-id, oai-authenticated-user-email" };
const GRANT_COLUMNS = ["grant_id", "actor_user_id", "owner_user_id", "organization_id", "project_access_id", "project_id", "document_id",
  "permission_epoch", "policy_version", "recipe_version", "revision", "enrollment_id", "enrollment_revision", "infer_enabled",
  "inspect_enabled", "background_enabled", "source_after_sequence", "consented_at", "expires_at", "retention_days", "revoked_at"] as const;
const PARENT_COLUMNS = ["enrollment_id", "actor_user_id", "owner_user_id", "organization_id", "project_access_id", "project_id", "document_id",
  "permission_epoch", "policy_version", "revision", "learn_enabled", "recall_enabled", "background_enabled", "retention_days", "time_zone",
  "enrolled_at", "expires_at", "cursor_sequence", "cutoff_sequence", "last_local_day", "last_admitted_at", "next_due_at", "lease_token",
  "lease_expires_at", "attempts", "failure_code"] as const;
const SUPPRESSION_COLUMNS = ["grant_id", "grant_revision", "claim_key", "revision", "state", "created_at", "expires_at"] as const;
type Row = Record<string, unknown>;
type Prepared = { principal: PilotUser; binding: ConsequentialBinding; sourceHead: number };
type Query = DocumentProfileSqlGuard;

const reply = (body: Row, status = 200) => Response.json({ version: DOCUMENT_PROFILE_CONTROL_VERSION, ...body }, { status, headers: HEADERS });
const deny = (error: string, status = 400) => reply({ error }, status);
// A rejected batch may be a lost response after commit. Without a verified rollback
// receipt the caller must reload the revision, never treat the response as a known no-op.
const writeFailure = () => deny("document_profile_commit_delivery_unconfirmed", 503);
const privateResponse = (response: Response) => new Response(response.body, { status: response.status,
  headers: { ...Object.fromEntries(response.headers), ...HEADERS } });
const object = (value: unknown): value is Row => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const exact = (value: Row, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const hasControlCharacters = (value: string): boolean => Array.from(value).some(character => {
  const code = character.charCodeAt(0); return code < 32 || code === 127;
});
const id = (value: unknown, maximum = 240): value is string => typeof value === "string" && value.length > 0 && value.length <= maximum
  && value.trim() === value && value.isWellFormed() && !hasControlCharacters(value);
const integer = (value: unknown, minimum = 0): value is number => Number.isSafeInteger(value) && Number(value) >= minimum;
const timestamp = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString() === value;
const deadlineGuard = (deadline: string): Query => ({ sql: "?>strftime('%Y-%m-%dT%H:%M:%fZ','now')", bindings: [deadline] });
const assertion = (env: WorkerEnv, guard: Query) => env.DB.prepare(`SELECT CASE WHEN (${guard.sql}) THEN 1 ELSE json('document_profile_source_changed') END AS verified`).bind(...guard.bindings);
const custody = (binding: ConsequentialBinding): MemoryCustody => binding.scope
  ? { kind: "organization", organizationId: binding.scope.organizationId, projectAccessId: binding.scope.projectAccessId, ownerUserId: binding.scope.ownerUserId }
  : { kind: "personal" };

/** Exact row snapshots are generated from closed server-owned column lists. */
function rowGuard(table: "memory_document_profile_grants" | "memory_document_profile_suppressions" | "memory_live_enrollments",
  columns: readonly string[], row: object): Query {
  const values = columns.map(column => (row as Row)[column]);
  if (values.some(value => value !== null && typeof value !== "string" && (typeof value !== "number" || !Number.isFinite(value)))) return { sql: "0", bindings: [] };
  return { sql: `EXISTS(SELECT 1 FROM ${table} WHERE ${columns.map(column => `${column} IS ?`).join(" AND ")})`, bindings: values as Query["bindings"] };
}
async function rows(env: WorkerEnv, query: Query, observer?: Pick<NativeMemoryContextObserver, "observe">): Promise<Row[]> {
  const statement = env.DB.prepare(query.sql).bind(...query.bindings), result = structuredClone(await statement.all<Row>());
  if (!result.success) throw new Error("document_profile_read_unavailable");
  observer?.observe([statement], [result], [query]);
  return result.results;
}
async function atomic(env: WorkerEnv, before: readonly Query[], writes: readonly D1PreparedStatement[], after: readonly Query[]) {
  const result = await env.DB.batch([...before.map(guard => assertion(env, guard)), ...writes, ...after.map(guard => assertion(env, guard))]);
  if (!Array.isArray(result) || result.some(value => !value || value.success !== true || !Array.isArray(value.results)))
    throw new Error("document_profile_write_unconfirmed");
  const assertions = [...result.slice(0, before.length), ...result.slice(before.length + writes.length)];
  if (result.length !== before.length + writes.length + after.length
    || assertions.length !== before.length + after.length
    || assertions.some(value => value.results.length !== 1 || (value.results[0] as Row).verified !== 1)) throw new Error("document_profile_write_unconfirmed");
}
/** JSON.parse has already validated the grammar; retain no ambiguous duplicate keys. */
function uniqueJsonKeys(text: string): boolean {
  const stack: { keys: Set<string> | null; expectsKey: boolean }[] = [];
  for (const [token] of text.matchAll(/"(?:\\.|[^"\\])*"|[{}:,]|\[|\]/gsu)) {
    if (token === "{" || token === "[") stack.push({ keys: token === "{" ? new Set<string>() : null, expectsKey: token === "{" });
    else if (token === "}" || token === "]") stack.pop();
    else {
      const current = stack.at(-1);
      if (token === "," && current?.keys) current.expectsKey = true;
      else if (token.startsWith('"') && current?.keys && current.expectsKey) {
        const key: string = JSON.parse(token);
        if (current.keys.has(key)) return false;
        current.keys.add(key); current.expectsKey = false;
      }
    }
  }
  return true;
}
async function requestBody(request: Request): Promise<Row | Response> {
  if (!request.body) return deny("document_profile_request_invalid");
  const reader = request.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "", bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 4096) { await reader.cancel(); return deny("document_profile_request_too_large", 413); }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode(); const value: unknown = JSON.parse(text);
    return object(value) && uniqueJsonKeys(text) ? value : deny("document_profile_request_invalid");
  } catch { return deny("document_profile_request_invalid"); }
  finally { reader.releaseLock(); }
}
function queryKeys(url: URL, keys: readonly string[]): boolean {
  return [...url.searchParams.keys()].every(key => keys.includes(key) && url.searchParams.getAll(key).length === 1);
}
function grantShape(value: Row): value is Row & DocumentProfileGrant {
  return exact(value, GRANT_COLUMNS) && [value.grant_id, value.actor_user_id, value.owner_user_id, value.project_id, value.document_id,
    value.permission_epoch, value.enrollment_id].every(item => id(item))
    && (value.organization_id === null && value.project_access_id === null && value.owner_user_id === value.actor_user_id
      || id(value.organization_id) && id(value.project_access_id))
    && value.policy_version === DOCUMENT_PROFILE_POLICY && value.recipe_version === DOCUMENT_PROFILE_RECIPE
    && integer(value.revision, 1) && integer(value.enrollment_revision, 1) && integer(value.source_after_sequence)
    && [value.infer_enabled, value.inspect_enabled, value.background_enabled].every(item => item === 0 || item === 1)
    && integer(value.retention_days, 1) && value.retention_days <= 365 && timestamp(value.consented_at) && timestamp(value.expires_at)
    && (value.revoked_at === null || timestamp(value.revoked_at));
}
function grantView(grant: DocumentProfileGrant) {
  return { grantId: grant.grant_id, revision: grant.revision, organizationId: grant.organization_id, projectAccessId: grant.project_access_id,
    ownerUserId: grant.owner_user_id, projectId: grant.project_id, documentId: grant.document_id,
    enrollmentId: grant.enrollment_id, enrollmentRevision: grant.enrollment_revision, policyVersion: grant.policy_version,
    recipeVersion: grant.recipe_version, infer: grant.infer_enabled === 1, inspect: grant.inspect_enabled === 1,
    background: grant.background_enabled === 1, sourceAfterSequence: grant.source_after_sequence, consentedAt: grant.consented_at,
    expiresAt: grant.expires_at, retentionDays: grant.retention_days, revokedAt: grant.revoked_at };
}
function sameScope(row: DocumentProfileGrant | LiveMemoryEnrollment, prepared: Prepared, requireEpoch = true): boolean {
  const { principal, binding } = prepared, scope = binding.scope;
  return row.actor_user_id === principal.userId && row.owner_user_id === (scope?.ownerUserId ?? principal.userId)
    && row.organization_id === (scope?.organizationId ?? null) && row.project_access_id === (scope?.projectAccessId ?? null)
    && row.project_id === binding.projectId && row.document_id === binding.documentId
    && (!requireEpoch || row.permission_epoch === principal.access.permissionEpoch);
}
function parentValid(value: LiveMemoryEnrollment | null, prepared: Prepared, now: number): value is LiveMemoryEnrollment {
  return Boolean(value && sameScope(value, prepared) && value.policy_version === "personal-memory-v2"
    && integer(value.revision, 1) && value.learn_enabled === 1 && value.recall_enabled === 1
    && integer(value.retention_days, 1) && value.retention_days <= 365 && integer(value.cursor_sequence)
    && timestamp(value.enrolled_at) && Date.parse(value.enrolled_at) <= now && timestamp(value.expires_at) && Date.parse(value.expires_at) > now
    && !["forgotten", "erased", "access-changed", "revoked"].includes(value.failure_code ?? ""));
}
async function prepare(request: Request, env: WorkerEnv, principal: PilotUser, projectId: string, documentId: string): Promise<Prepared | Response> {
  const resolved = await prepareDocumentAuthority(request, env, { projectId, documentId }, "read");
  if (resolved instanceof Response) return privateResponse(resolved);
  if (resolved.principal.userId !== principal.userId || resolved.principal.access.permissionEpoch !== principal.access.permissionEpoch
    || resolved.binding.actorUserId !== principal.userId || resolved.binding.permissionEpoch !== principal.access.permissionEpoch
    || !integer(resolved.sourceHead)) return deny("document_profile_authority_changed", 409);
  // Native scope resolution is retained, but a later requireUser result never replaces the original HTTP principal.
  return { principal, binding: resolved.binding, sourceHead: resolved.sourceHead };
}
async function grantForActor(env: WorkerEnv, grantId: string, actor: string, observer?: Pick<NativeMemoryContextObserver, "observe">) {
  const found = await rows(env, { sql: "SELECT * FROM memory_document_profile_grants WHERE grant_id=? AND actor_user_id=? LIMIT 2", bindings: [grantId, actor] }, observer);
  if (found.length > 1 || found.length === 1 && !grantShape(found[0])) throw new Error("document_profile_grant_unavailable");
  return found[0] as unknown as DocumentProfileGrant | undefined;
}
async function currentParent(env: WorkerEnv, prepared: Prepared, observer?: Pick<NativeMemoryContextObserver, "observe">,
  enrollmentId?: string): Promise<LiveMemoryEnrollment | null> {
  const { principal, binding } = prepared, scope = binding.scope;
  const found = await rows(env, { sql: `SELECT * FROM memory_live_enrollments WHERE actor_user_id=? AND owner_user_id=?
    AND organization_id IS ? AND project_access_id IS ? AND project_id=? AND document_id=?${enrollmentId ? " AND enrollment_id=?" : ""} ORDER BY enrollment_id LIMIT 2`,
  bindings: [principal.userId, scope?.ownerUserId ?? principal.userId, scope?.organizationId ?? null, scope?.projectAccessId ?? null,
    binding.projectId, binding.documentId, ...(enrollmentId ? [enrollmentId] : [])] }, observer);
  return found.length === 1 ? found[0] as unknown as LiveMemoryEnrollment : null;
}
function requireWitness(witness: AssistantContextReadWitness<unknown>, prepared: Prepared, deadline: string) {
  witness.require(executionAdmissionGuard(prepared.principal, prepared.binding, null)); witness.before(deadline);
}
async function certifiedResponse<T extends Row>(env: WorkerEnv, witness: AssistantContextReadWitness<T>, value: T,
  actorId: string, expectedEnabled: boolean): Promise<Response> {
  witness.seal(value); const statements = witness.statements();
  if (!statements.length) return deny("document_profile_unavailable", 403);
  const serialized = JSON.stringify(witness.context());
  if (new TextEncoder().encode(serialized).byteLength > 65_536) return deny("document_profile_response_too_large", 503);
  const response = new Response(serialized, { headers: { ...HEADERS, "content-type": "application/json; charset=utf-8" } });
  const result = await env.DB.batch<Row>(statements);
  if (expectedEnabled !== documentProfileEnabled(env, actorId) || !witness.matches(result)) return deny("document_profile_unavailable", 403);
  return response;
}

async function settingsRead(request: Request, env: WorkerEnv, actor: PilotUser, deadline: string, url: URL): Promise<Response> {
  const projectId = url.searchParams.get("projectId"), documentId = url.searchParams.get("documentId");
  if (!queryKeys(url, ["projectId", "documentId"]) || !id(projectId, 120) || !id(documentId, 120)) return deny("document_profile_scope_required");
  const prepared = await prepare(request, env, actor, projectId, documentId); if (prepared instanceof Response) return prepared;
  const witness = new AssistantContextReadWitness<Row>(env); requireWitness(witness, prepared, deadline);
  const grantId = await profileGrantId(prepared), grant = await grantForActor(env, grantId, actor.userId, witness);
  if (grant && !sameScope(grant, prepared, false)) return deny("document_profile_custody_changed", 409);
  const candidate = await currentParent(env, prepared, witness), parent = parentValid(candidate, prepared, Date.now()) ? candidate : null;
  const enabled = documentProfileEnabled(env, actor.userId);
  const grantCurrent = Boolean(enabled && grant && parent && documentProfileGrantValid(grant, parent, Date.now()));
  // The returned effective state cannot outlive an otherwise unchanged row.
  if (parent) witness.before(parent.expires_at);
  if (grantCurrent && grant) witness.before(grant.expires_at);
  return certifiedResponse(env, witness, { version: DOCUMENT_PROFILE_CONTROL_VERSION, enabled, policyVersion: DOCUMENT_PROFILE_POLICY,
    recipeVersion: DOCUMENT_PROFILE_RECIPE, purpose: "authored-palette-organization", backgroundSupported: false,
    scope: { projectId, documentId, custody: custody(prepared.binding) },
    parent: parent ? { enrollmentId: parent.enrollment_id, enrollmentRevision: parent.revision, expiresAt: parent.expires_at, retentionDays: parent.retention_days } : null,
    grant: grant ? grantView(grant) : null, grantCurrent }, actor.userId, enabled);
}
async function profileGrantId(prepared: Prepared): Promise<string> {
  const { principal, binding } = prepared, scope = binding.scope;
  return memoryDigest(JSON.stringify(["document-profile", principal.userId, scope?.ownerUserId ?? principal.userId,
    scope?.organizationId ?? null, scope?.projectAccessId ?? null, binding.projectId, binding.documentId]));
}

async function settingsWrite(request: Request, env: WorkerEnv, actor: PilotUser, deadline: string, body: Row): Promise<Response> {
  const keys = ["version", "policyVersion", "recipeVersion", "projectId", "documentId", "enrollmentId", "enrollmentRevision", "revision", "expectedCustody",
    "infer", "inspect", "background", "retentionDays", "expiresAt", "confirmation"];
  if (!exact(body, keys) || body.version !== DOCUMENT_PROFILE_CONTROL_VERSION || body.policyVersion !== DOCUMENT_PROFILE_POLICY
    || body.recipeVersion !== DOCUMENT_PROFILE_RECIPE || body.confirmation !== "ENABLE_DOCUMENT_PALETTE_PROFILE"
    || body.infer !== true || body.inspect !== true || body.background !== false || !id(body.projectId, 120) || !id(body.documentId, 120)
    || !id(body.enrollmentId) || !integer(body.enrollmentRevision, 1) || !integer(body.revision)
    || !integer(body.retentionDays, 1) || body.retentionDays > 365 || !timestamp(body.expiresAt)) return deny("explicit_document_profile_consent_required");
  if (body.revision >= Number.MAX_SAFE_INTEGER - 1) return deny("document_profile_revision_exhausted", 409);
  const expected = parseMemoryCustody(body.expectedCustody); if (!expected) return deny("document_profile_custody_required");
  const consent = requireConsent(actor); if (consent) return privateResponse(consent);
  const prepared = await prepare(request, env, actor, body.projectId, body.documentId); if (prepared instanceof Response) return prepared;
  if (!memoryCustodyMatches(expected, prepared.binding.scope)) return deny("document_profile_custody_changed", 409);
  const witness = new AssistantContextReadWitness<Row>(env); requireWitness(witness, prepared, deadline);
  const grantId = await profileGrantId(prepared), old = await grantForActor(env, grantId, actor.userId, witness);
  if ((old?.revision ?? 0) !== body.revision) return deny("document_profile_revision_changed", 409);
  if (old && !sameScope(old, prepared, false)) return deny("document_profile_custody_changed", 409);
  const parent = await currentParent(env, prepared, witness, body.enrollmentId), now = new Date().toISOString();
  if (!parentValid(parent, prepared, Date.parse(now)) || parent.revision !== body.enrollmentRevision
    || body.retentionDays > parent.retention_days || body.expiresAt > parent.expires_at || body.expiresAt <= now
    || Date.parse(body.expiresAt) > Date.parse(now) + 365 * 86_400_000) return deny("document_profile_parent_unavailable", 409);
  const scope = prepared.binding.scope;
  const grant: DocumentProfileGrant = { grant_id: grantId, actor_user_id: actor.userId, owner_user_id: scope?.ownerUserId ?? actor.userId,
    organization_id: scope?.organizationId ?? null, project_access_id: scope?.projectAccessId ?? null, project_id: body.projectId, document_id: body.documentId,
    permission_epoch: actor.access.permissionEpoch, policy_version: DOCUMENT_PROFILE_POLICY, recipe_version: DOCUMENT_PROFILE_RECIPE,
    revision: body.revision + 1, enrollment_id: parent.enrollment_id, enrollment_revision: parent.revision, infer_enabled: 1, inspect_enabled: 1,
    background_enabled: 0, source_after_sequence: prepared.sourceHead, consented_at: now, expires_at: body.expiresAt,
    retention_days: body.retentionDays, revoked_at: null };
  if (!documentProfileGrantValid(grant, parent, Date.parse(now))) return deny("document_profile_parent_unavailable", 409);
  witness.seal({ grantId, revision: old?.revision ?? 0 });
  const authority = executionAdmissionGuard(actor, prepared.binding, prepared.sourceHead), lifetime = deadlineGuard(deadline);
  const parentGuard = rowGuard("memory_live_enrollments", PARENT_COLUMNS, parent);
  const oldGuard = old ? rowGuard("memory_document_profile_grants", GRANT_COLUMNS, old)
    : { sql: "NOT EXISTS(SELECT 1 FROM memory_document_profile_grants WHERE grant_id=?)", bindings: [grantId] };
  const cleanup = old ? await documentProfileWithdrawalStatements(env, { grantId, currentRevision: old.revision }, now) : [];
  if (!documentProfileEnabled(env, actor.userId)) return deny("document_profile_disabled", 503);
  try {
    await atomic(env, [authority, lifetime, parentGuard, oldGuard], [
      ...witness.precommitStatements(), ...cleanup,
      env.DB.prepare(`INSERT INTO memory_document_profile_grants(${GRANT_COLUMNS.join(",")}) VALUES(${GRANT_COLUMNS.map(() => "?").join(",")})
        ON CONFLICT(grant_id) DO UPDATE SET ${GRANT_COLUMNS.filter(column => column !== "grant_id").map(column => `${column}=excluded.${column}`).join(",")}`)
        .bind(...GRANT_COLUMNS.map(column => grant[column])),
    ], [authority, lifetime, parentGuard, documentProfileGrantGuard(grant)]);
  } catch { return writeFailure(); }
  if (!documentProfileEnabled(env, actor.userId) || Date.now() >= Math.min(Date.parse(deadline), Date.parse(parent.expires_at), Date.parse(grant.expires_at)))
    return deny("document_profile_commit_delivery_unconfirmed", 503);
  return reply({ grant: grantView(grant), historyStartsAfterSequence: grant.source_after_sequence });
}

async function revoke(env: WorkerEnv, actor: PilotUser, started: number, url: URL, body: Row): Promise<Response> {
  const grantId = url.searchParams.get("grantId");
  if (!queryKeys(url, ["grantId"]) || !id(grantId) || !exact(body, ["version", "revision", "confirmation"])
    || body.version !== DOCUMENT_PROFILE_CONTROL_VERSION || !integer(body.revision, 1)
    || body.confirmation !== "REVOKE_DOCUMENT_PALETTE_PROFILE") return deny("explicit_document_profile_revocation_required");
  const schema = await rows(env, { sql: "SELECT name FROM sqlite_schema WHERE type='table' AND name IN('memory_document_profile_grants','memory_document_profile_suppressions')", bindings: [] });
  if (!schema.some(row => row.name === "memory_document_profile_grants")) return deny("document_profile_not_found", 404);
  const hasSuppressions = schema.some(row => row.name === "memory_document_profile_suppressions");
  const schemaGuard: Query = { sql: "(SELECT COUNT(*) FROM sqlite_schema WHERE name='memory_document_profile_suppressions')=?", bindings: [Number(hasSuppressions)] };
  const grant = await grantForActor(env, grantId, actor.userId);
  if (!grant) return deny("document_profile_not_found", 404);
  if (grant.revision !== body.revision) return deny("document_profile_revision_changed", 409);
  const snapshot = actor.authorizationSnapshot;
  if (!snapshot) return deny("document_profile_identity_unavailable", 403);
  // Revocation needs current authenticated ownership, not document access or platform consent.
  const identity: Query = { sql: "EXISTS(SELECT 1 FROM users WHERE user_id=? AND role=? AND COALESCE(updated_at,'')=?)",
    bindings: [actor.userId, actor.role, snapshot.updatedAt] };
  const lifetime = deadlineGuard(new Date(started + 60_000).toISOString()), now = new Date().toISOString();
  const changed = grant.revoked_at === null;
  const revision = grant.revision + Number(changed);
  if (!Number.isSafeInteger(revision)) return deny("document_profile_revision_exhausted", 409);
  const writes = await documentProfileWithdrawalStatements(env, { grantId, currentRevision: grant.revision }, now);
  const completed: Query = { sql: `EXISTS(SELECT 1 FROM memory_document_profile_grants WHERE grant_id=? AND actor_user_id=? AND revision=?
    AND infer_enabled=0 AND inspect_enabled=0 AND background_enabled=0 AND revoked_at IS NOT NULL AND expires_at<=?)
    ${hasSuppressions ? "AND NOT EXISTS(SELECT 1 FROM memory_document_profile_suppressions WHERE grant_id=?)" : ""}`, bindings: [grantId, actor.userId, revision, now, ...(hasSuppressions ? [grantId] : [])] };
  try { await atomic(env, [identity, lifetime, schemaGuard, rowGuard("memory_document_profile_grants", GRANT_COLUMNS, grant)], writes, [identity, lifetime, schemaGuard, completed]); }
  catch { return writeFailure(); }
  if (Date.now() >= started + 60_000) return deny("document_profile_commit_delivery_unconfirmed", 503);
  return reply({ revoked: true, grantId, revision, reEnrollmentRequired: true });
}

async function inspectOrSuppress(request: Request, env: WorkerEnv, actor: PilotUser, deadline: string, url: URL, body?: Row): Promise<Response> {
  const grantId = body ? body.grantId : url.searchParams.get("grantId");
  if (!id(grantId) || !body && (!queryKeys(url, ["grantId", "version"]) || url.searchParams.get("version") !== DOCUMENT_PROFILE_CONTROL_VERSION))
    return deny("document_profile_request_invalid");
  if (body && (!exact(body, ["version", "grantId", "grantRevision", "claimKey", "revision", "confirmation"])
    || body.version !== DOCUMENT_PROFILE_CONTROL_VERSION || body.confirmation !== "SUPPRESS_DOCUMENT_PALETTE_CLAIM"
    || !integer(body.grantRevision, 1) || !integer(body.revision) || body.revision >= Number.MAX_SAFE_INTEGER
    || typeof body.claimKey !== "string" || !/^[0-9a-f]{64}$/u.test(body.claimKey))) return deny("document_profile_suppression_invalid");
  const grant = await grantForActor(env, grantId, actor.userId); if (!grant) return deny("document_profile_not_found", 404);
  if (body && grant.revision !== body.grantRevision) return deny("document_profile_revision_changed", 409);
  const prepared = await prepare(request, env, actor, grant.project_id, grant.document_id); if (prepared instanceof Response) return prepared;
  if (!sameScope(grant, prepared) || !memoryCustodyMatches(custody(prepared.binding), grant.organization_id === null ? null
    : { organizationId: grant.organization_id, projectAccessId: grant.project_access_id!, ownerUserId: grant.owner_user_id }))
    return deny("document_profile_custody_changed", 409);
  const witness = new AssistantContextReadWitness<Row>(env); requireWitness(witness, prepared, deadline);
  const raw = await readNativeDocumentPaletteProfile(env, prepared, grantId, witness), profile = parseMemoryDocumentProfile(raw);
  if (!profile || profile.grant.id !== grantId || profile.grant.revision !== grant.revision
    || profile.scope.projectId !== prepared.binding.projectId || profile.scope.documentId !== prepared.binding.documentId
    || profile.scope.organizationId !== (prepared.binding.scope?.organizationId ?? null)
    || profile.scope.projectAccessId !== (prepared.binding.scope?.projectAccessId ?? null)) return deny("document_profile_unavailable", 403);
  witness.before(profile.lifetime.validUntil);
  if (!body) return certifiedResponse(env, witness, { version: DOCUMENT_PROFILE_CONTROL_VERSION, profile }, actor.userId, true);
  const claimKey = body.claimKey, expectedRevision = body.revision;
  if (typeof claimKey !== "string" || !integer(expectedRevision)) return deny("document_profile_suppression_invalid");
  if (!profile.choices.some(choice => choice.claimKey === claimKey)) return deny("document_profile_claim_unavailable", 409);
  const query = { sql: "SELECT * FROM memory_document_profile_suppressions WHERE grant_id=? AND grant_revision=? AND claim_key=? LIMIT 2",
    bindings: [grantId, grant.revision, claimKey] as Query["bindings"] };
  const found = await rows(env, query, witness);
  if (found.length > 1 || (found[0]?.revision ?? 0) !== expectedRevision) return deny("document_profile_suppression_revision_changed", 409);
  const now = new Date().toISOString(), suppression: DocumentProfileSuppression = { grant_id: grantId, grant_revision: grant.revision,
    claim_key: claimKey, revision: expectedRevision + 1, state: "active", created_at: now,
    expires_at: new Date(Math.min(Date.parse(grant.expires_at), Date.parse(now) + grant.retention_days * 86_400_000)).toISOString() };
  const authority = executionAdmissionGuard(actor, prepared.binding, null), liveGrant = documentProfileGrantGuard(grant);
  const lifetime = deadlineGuard(new Date(Math.min(Date.parse(deadline), Date.parse(profile.lifetime.validUntil))).toISOString());
  // Reuse the reader's applicable-row predicate: certified expired/inactive hashes
  // do not consume capacity, while malformed rows are not silently discarded.
  const applicable = nativeDocumentProfileSuppressionsQuery(grant);
  const capacity: Query = { sql: `(SELECT COUNT(*) FROM (${applicable.sql}))<128`, bindings: applicable.bindings };
  const capacityAfter: Query = { sql: `(SELECT COUNT(*) FROM (${applicable.sql}))<=128`, bindings: applicable.bindings };
  witness.seal({ version: DOCUMENT_PROFILE_CONTROL_VERSION, profile });
  if (!documentProfileEnabled(env, actor.userId)) return deny("document_profile_disabled", 503);
  try {
    // All source assertions precede this one metadata write in the same transaction.
    // Replaying the old suppression SELECT after our insert would deny our own row.
    await atomic(env, [authority, liveGrant, lifetime, capacity], [...witness.precommitStatements(),
      env.DB.prepare(`INSERT INTO memory_document_profile_suppressions(${SUPPRESSION_COLUMNS.join(",")}) VALUES(${SUPPRESSION_COLUMNS.map(() => "?").join(",")})
        ON CONFLICT(grant_id,grant_revision,claim_key) DO UPDATE SET revision=excluded.revision,state=excluded.state,created_at=excluded.created_at,expires_at=excluded.expires_at`)
        .bind(...SUPPRESSION_COLUMNS.map(column => suppression[column])),
    ], [authority, liveGrant, lifetime, capacityAfter, rowGuard("memory_document_profile_suppressions", SUPPRESSION_COLUMNS, suppression)]);
  } catch { return writeFailure(); }
  if (!documentProfileEnabled(env, actor.userId) || Date.now() >= Math.min(Date.parse(deadline), Date.parse(profile.lifetime.validUntil), Date.parse(suppression.expires_at)))
    return deny("document_profile_commit_delivery_unconfirmed", 503);
  return reply({ suppression: { grantId, grantRevision: grant.revision, claimKey: suppression.claim_key, revision: suppression.revision,
    state: suppression.state, createdAt: suppression.created_at, expiresAt: suppression.expires_at } });
}

/** On-demand, separately consented document authored-palette organization. No route registration,
 * parent enrollment, scheduler, provider, saved answer or inferred personal preference is created here. */
export async function handleMemoryDocumentProfile(request: Request, env: WorkerEnv, operation: "settings" | "inspect" | "suppress"): Promise<Response> {
  const allowed = operation === "settings" ? ["GET", "PUT", "DELETE"] : operation === "inspect" ? ["GET"] : operation === "suppress" ? ["PUT"] : [];
  if (!allowed.includes(request.method)) return deny("method_not_allowed", 405);
  const started = Date.now(), auth = await requireUser(request, env, "viewer", { account: "principal" });
  if (auth.response || !auth.user) return auth.response ? privateResponse(auth.response) : deny("authentication_required", 401);
  if (auth.user.fictional || !auth.user.authorizationSnapshot) return deny("principal_account_required", 403);
  const actor = structuredClone(auth.user), url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (request.method !== "GET" && (origin && origin !== url.origin || request.headers.get("sec-fetch-site") === "cross-site")) return deny("same_origin_required", 403);
  try {
    if (request.method === "DELETE") {
      const body = await requestBody(request); return body instanceof Response ? body : await revoke(env, actor, started, url, body);
    }
    if (!await documentProfileSchemaReady(env)) return deny("document_profile_schema_unavailable", 503);
    const originalDeadline = nativeMemoryGrantDeadline(actor, started);
    if (originalDeadline === undefined) return deny("document_profile_authority_changed", 403);
    const deadline = new Date(Math.min(started + 60_000, originalDeadline === null ? Infinity : Date.parse(originalDeadline))).toISOString();
    if (operation === "settings" && request.method === "GET") return await settingsRead(request, env, actor, deadline, url);
    if (!documentProfileEnabled(env, actor.userId)) return deny("document_profile_disabled", 503);
    if (operation === "inspect") return await inspectOrSuppress(request, env, actor, deadline, url);
    if (!queryKeys(url, [])) return deny("document_profile_request_invalid");
    const body = await requestBody(request); if (body instanceof Response) return body;
    return operation === "settings" ? await settingsWrite(request, env, actor, deadline, body) : await inspectOrSuppress(request, env, actor, deadline, url, body);
  } catch { return deny("document_profile_unavailable", 503); }
}
