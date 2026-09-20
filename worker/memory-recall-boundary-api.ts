import { bodyOf, parentColumns, readScope } from './memory-derivation-api.ts';
import { nativeMemoryGrantDeadline, nativeMemoryPilotDeadline, nativeMemoryPilotQuery } from './memory-native-deadlines.ts';
import { requireUser, hasCapability } from './pilot-policy.ts';
import { liveMemoryEnabled } from './memory-live-store.ts';
import { liveMemoryAuthorityFromPrincipal, liveMemoryEnrollmentGuard, type LiveMemoryEnrollment } from './memory-live-authority.ts';
import { memoryCanonical, type MemorySqlGuard } from './memory-sql.ts';
import { memoryDigest } from '../src/model/scoped-memory.ts';
import { memoryRecallBoundary, memoryRecallRelation, type MemoryRecallScope } from '../src/model/memory-recall-boundary.ts';
import { memoryRecallBoundarySchemaProfile as profile } from './memory-recall-boundary-schema.ts';
import { readNativeProjectContainment } from './project-containment-api.ts';
import { derivationAssertion, derivationResults, derivationVerified, memoryDerivationEnabled, memoryDerivationBinding } from './memory-derivation-store.ts';
import { derivationExact, derivationId, MEMORY_DERIVATION_PURPOSES } from './memory-derivation-policy.ts';
import { readNativeDerivationPresentation } from './memory-derivation-results.ts';
import type { WorkerEnv } from './runtime.ts';

type Row = Record<string, unknown>;
const version = 'memory-scope-recall-v1';
const headers = { 'cache-control': 'private, no-store', vary: 'Cookie, oai-authenticated-user-id, oai-authenticated-user-email' };
const reply = (value: Row, status = 200) => {
  const body = JSON.stringify({ version, ...value });
  return new TextEncoder().encode(body).byteLength <= 524288
    ? new Response(body, { status, headers: { ...headers, 'content-type': 'application/json' } })
    : Response.json({ version, error: 'recall_response_capacity' }, { status: 503, headers });
};
const columns = ['enrollment_id', 'enrollment_revision', 'boundary', 'revision', 'consented_at'] as const;
const family = "name LIKE 'memory_recall_boundaries%' OR tbl_name='memory_recall_boundaries' OR instr(lower(COALESCE(sql,'')),'memory_recall_boundaries')>0";
const schemaQuery = `SELECT name,sql,tbl_name AS 'table',type FROM sqlite_schema WHERE ${family} ORDER BY name,type LIMIT 4`;
async function rows(env: WorkerEnv, sql: string, bindings: readonly (string | number | null)[] = []) {
  const db = env.DB, result = structuredClone(await db.prepare(sql).bind(...bindings).all<Row>());
  if (env.DB !== db || !derivationResults([result], 1)) throw Error('recall_read');
  return result.results;
}
function inventory(sql: string, bindings: readonly (string | number | null)[], found: Row[], keys: readonly string[]): MemorySqlGuard {
  return { condition: `(SELECT json_group_array(json_array(${keys.map(key => '"' + key + '"').join(',')})) FROM (${sql}))=?`,
    bindings: [...bindings, JSON.stringify(found.map(row => keys.map(key => row[key])))] };
}
export async function readNativeRecallBoundarySchema(env: WorkerEnv) {
  const found = await rows(env, schemaQuery), explicit = found.filter(row => row.sql !== null);
  if (found.length !== profile.count + 1 || explicit.length !== profile.count
    || found.some(row => row.sql === null && row.name !== profile.automaticIndexes[0])
    || 'sha256:' + await memoryDigest(memoryCanonical(explicit.map(row => ({ ...row, sql: String(row.sql).trim().replace(/;$/u, '').replace(/\bIF\s+NOT\s+EXISTS\s+/giu, '') })))) !== profile.digest) throw Error('recall_schema');
  return inventory(schemaQuery, [], found, ['name', 'sql', 'table', 'type']);
}
/** Keep each assertion's expression tree separate and below native bind limits. */
export function packRecallGuards(guards: readonly MemorySqlGuard[]): MemorySqlGuard[] {
  const result: MemorySqlGuard[] = []; let group: MemorySqlGuard[] = [], size = 0, bytes = 0;
  const flush = () => { if (!group.length) return; result.push({ condition: `NOT EXISTS(SELECT 1 FROM (${group.map(g => `SELECT CASE WHEN (${g.condition}) THEN 1 ELSE 0 END AS ok`).join(' UNION ALL ')}) WHERE ok<>1)`, bindings: group.flatMap(g => [...g.bindings]) }); group = []; size = bytes = 0; };
  for (const guard of guards) {
    const length = new TextEncoder().encode(guard.condition).byteLength;
    if (guard.bindings.length > 100 || length > 80000) throw Error('recall_guard_capacity');
    if (size + guard.bindings.length > 100 || bytes + length > 80000 || group.length === 5) flush();
    group.push(guard); size += guard.bindings.length; bytes += length;
  }
  flush(); return result;
}
const identity = (e: LiveMemoryEnrollment): MemoryRecallScope => ({ actorId: e.actor_user_id, ownerId: e.owner_user_id,
  organizationId: e.organization_id, projectId: e.project_id, documentId: e.document_id });

/** Consent and ephemeral cross-scope presentation. No provider, scheduling,
 * automatic enrollment, durable answer, remote index or document mutation. */
export async function handleMemoryRecallBoundary(request: Request, env: WorkerEnv): Promise<Response> {
  const config = () => memoryCanonical([env.FORMA_MEMORY_ENABLED, env.FORMA_MEMORY_USER_IDS, env.FORMA_MEMORY_DERIVATION_ENABLED,
    env.FORMA_MEMORY_DERIVATION_USER_IDS, env.FORMA_PILOT_COHORT_ID, env.FORMA_ADMIN_EMAILS, memoryDerivationBinding(env)]);
  const db = env.DB, started = Date.now(), monotonic = performance.now(), configuration = config();
  let responseDeadline = started + 30000;
  const current = () => env.DB === db && Date.now() >= started && Date.now() < responseDeadline
    && performance.now() >= monotonic && performance.now() - monotonic < 30000 && configuration === config();
  try {
    const url = new URL(request.url), auth = await requireUser(request, env, 'viewer', { account: 'principal' }), actor = auth.user;
    if (auth.response || !actor) return reply({ error: 'authentication_required' }, auth.response?.status ?? 401);
    if (actor.fictional || actor.projectExecution || request.headers.get('cookie')?.split(';').some(c => c.trim().startsWith('forma_impersonation='))) return reply({ error: 'principal_account_required' }, 403);
    const control = url.pathname === '/api/memory/recall-boundary';
    if (!(control ? ['GET', 'PUT', 'DELETE'] : ['GET']).includes(request.method)) return reply({ error: 'method_not_allowed' }, 405);
    if (request.headers.get('sec-fetch-site') === 'cross-site' || request.method !== 'GET' && request.headers.get('origin') !== url.origin) return reply({ error: 'same_origin_required' }, 403);
    const projectId = url.searchParams.get('projectId'), documentId = url.searchParams.get('documentId');
    if (!derivationId(projectId) || !derivationId(documentId) || [...url.searchParams.keys()].some(key => !(control ? ['projectId', 'documentId'] : ['projectId', 'documentId', 'source', 'purpose']).includes(key) || url.searchParams.getAll(key).length !== 1)) return reply({ error: 'recall_scope_required' }, 400);
    const guards: MemorySqlGuard[] = [await readNativeRecallBoundarySchema(env), { condition: "?>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT EXISTS(SELECT 1 FROM sqlite_temp_schema) AND EXISTS(SELECT 1 FROM pragma_foreign_keys WHERE foreign_keys=1) AND EXISTS(SELECT 1 FROM pragma_ignore_check_constraints WHERE ignore_check_constraints=0)", bindings: [new Date(started + 30000).toISOString()] }];
    // Withdrawal remains possible after source access, qualification or learning ends.
    if (control && request.method === 'DELETE') {
      const body = await bodyOf(request);
      if (!body || !derivationExact(body, ['confirmation']) || body.confirmation !== 'RESET_RECALL_BOUNDARY') return reply({ error: 'explicit_recall_reset_required' }, 400);
      const snapshot = actor.authorizationSnapshot; if (!snapshot) return reply({ error: 'principal_account_required' }, 403);
      guards.push({ condition: "EXISTS(SELECT 1 FROM users WHERE user_id=? AND role=? AND COALESCE(updated_at,'')=?)", bindings: [actor.userId, actor.role, snapshot.updatedAt] });
      const checks = packRecallGuards(guards).map(g => derivationAssertion(env, g));
      const result = await db.batch([...checks, db.prepare('DELETE FROM memory_recall_boundaries WHERE enrollment_id IN(SELECT enrollment_id FROM memory_live_enrollments WHERE actor_user_id=? AND project_id=? AND document_id=?)').bind(actor.userId, projectId, documentId)]);
      if (!current() || !derivationResults(result, checks.length + 1) || !result.slice(0, checks.length).every(derivationVerified)) throw Error('recall_unconfirmed');
      return reply({ saved: true, refreshRequired: true });
    }
    if (!liveMemoryEnabled(env, actor.userId)) return reply({ error: 'memory_disabled' }, 403);
    const selected = await readScope(request, env, actor, projectId, documentId);
    if (selected instanceof Response) return selected;
    const parent = selected.parent, grantDeadline = nativeMemoryGrantDeadline(actor, Date.now());
    if (grantDeadline === undefined) throw Error('recall_grant_deadline');
    const pilot = env.FORMA_PILOT_COHORT_ID?.trim() ?? '';
    const breakglass = (env.FORMA_ADMIN_EMAILS ?? '').split(',').map(value => value.trim().toLowerCase()).includes(actor.email.toLowerCase());
    let pilotDeadline: string | null = null;
    if (pilot && !breakglass) {
      const query = nativeMemoryPilotQuery(pilot), found = await rows(env, query.sql, query.bindings);
      const deadline = nativeMemoryPilotDeadline(found, pilot, started);
      if (deadline === undefined) throw Error('recall_pilot_deadline');
      pilotDeadline = deadline;
      guards.push(inventory(query.sql, query.bindings, found, ['cohort_id', 'organization_id', 'status', 'starts_at', 'ends_at']));
    }
    const presentationDeadline = Math.min(started + 30000, Date.parse(parent.expires_at),
      ...(pilotDeadline ? [Date.parse(pilotDeadline)] : []),
      ...(grantDeadline ? [Date.parse(grantDeadline)] : []), ...(selected.accessDeadline ? [Date.parse(selected.accessDeadline)] : []));
    responseDeadline = presentationDeadline;
    if (!Number.isFinite(presentationDeadline) || presentationDeadline <= Date.now()) throw Error('recall_expired');
    guards.push({condition:"?>strftime('%Y-%m-%dT%H:%M:%fZ','now')",bindings:[new Date(presentationDeadline).toISOString()]});
    if (parent.recall_enabled !== 1) return reply({ error: 'recall_consent_required' }, 403);
    guards.push(...selected.guards, liveMemoryEnrollmentGuard(parent, 'recall'));
    if (control) {
    const query = `SELECT ${columns.join(',')} FROM memory_recall_boundaries WHERE enrollment_id=?`, bindings = [parent.enrollment_id];
    const found = await rows(env, query, bindings); guards.push(inventory(query, bindings, found, columns));
    const boundary = found[0];
    if (found.length > 1 || boundary && (!derivationExact(boundary, columns) || boundary.enrollment_revision !== parent.revision || !memoryRecallBoundary(boundary.boundary))) throw Error('recall_boundary');
      if (request.method === 'PUT') {
        const body = await bodyOf(request);
        if (!body || !derivationExact(body, ['version', 'enrollmentId', 'enrollmentRevision', 'boundary', 'revision', 'confirmation']) || body.version !== version
          || body.enrollmentId !== parent.enrollment_id || body.enrollmentRevision !== parent.revision || !memoryRecallBoundary(body.boundary)
          || body.confirmation !== 'CHANGE_RECALL_BOUNDARY') return reply({ error: 'explicit_recall_boundary_required' }, 400);
        if (body.revision !== (boundary?.revision ?? null)) return reply({ error: 'recall_boundary_changed' }, 409);
        const revision = crypto.randomUUID(), checks = packRecallGuards(guards).map(g => derivationAssertion(env, g));
        const result = await db.batch([...checks, db.prepare(`INSERT INTO memory_recall_boundaries(${columns.join(',')}) VALUES(?,?,?,?,?)
          ON CONFLICT(enrollment_id) DO UPDATE SET enrollment_revision=excluded.enrollment_revision,boundary=excluded.boundary,revision=excluded.revision,consented_at=excluded.consented_at`)
          .bind(parent.enrollment_id, parent.revision, body.boundary, revision, new Date().toISOString()),
          derivationAssertion(env, { condition: 'EXISTS(SELECT 1 FROM memory_recall_boundaries WHERE enrollment_id=? AND revision=?)', bindings: [parent.enrollment_id, revision] })]);
        if (!current() || !derivationResults(result, checks.length + 2) || !result.slice(0, checks.length).every(derivationVerified) || !derivationVerified(result.at(-1)!)) throw Error('recall_unconfirmed');
        return reply({ saved: true, refreshRequired: true });
      }
      const checks = packRecallGuards(guards).map(g => derivationAssertion(env, g)), checked = await db.batch(checks);
      if (!current() || !derivationResults(checked, checks.length) || !checked.every(derivationVerified)) throw Error('recall_changed');
      return reply({ enrollmentId: parent.enrollment_id, enrollmentRevision: parent.revision, boundary: boundary?.boundary ?? 'document', revision: boundary?.revision ?? null,
        validUntil: new Date(presentationDeadline).toISOString() });
    }
    if (!memoryDerivationEnabled(env, actor.userId)) return reply({ error: 'derived_memory_disabled' }, 403);
    const hierarchy = await readNativeProjectContainment(env, parent.owner_user_id, true);
    guards.push(...hierarchy.guards.map(g => ({ condition: g.sql, bindings: g.bindings })));
    const readable = new Set([...hierarchy.forest.values()].filter(node => {
      const native = hierarchy.access.get(node.id)!;
      return native.active && (node.organizationId === null ? parent.owner_user_id === actor.userId : hasCapability(actor, 'project.read', { organizationId: node.organizationId, projectAccessId: native.accessId }));
    }).map(node => node.id));
    const sourcesQuery = `SELECT ${parentColumns.map(c => 'e.' + c).join(',')},b.boundary,b.revision AS boundary_revision FROM memory_live_enrollments e
      JOIN memory_recall_boundaries b ON b.enrollment_id=e.enrollment_id AND b.enrollment_revision=e.revision
      WHERE e.actor_user_id=? AND e.owner_user_id=? AND e.organization_id IS ? AND e.enrollment_id<>? AND e.learn_enabled=1 AND e.recall_enabled=1
        AND e.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND b.boundary<>'document' ORDER BY e.enrollment_id LIMIT 33`;
    const sourceBindings = [actor.userId, parent.owner_user_id, parent.organization_id, parent.enrollment_id], sources = await rows(env, sourcesQuery, sourceBindings);
    if (sources.length > 32) return reply({ error: 'recall_scope_capacity' }, 409);
    guards.push(inventory(sourcesQuery, sourceBindings, sources, [...parentColumns, 'boundary', 'boundary_revision']));
    const eligible = sources.flatMap(row => {
      const e = Object.fromEntries(parentColumns.map(key => [key, row[key]])) as unknown as LiveMemoryEnrollment;
      if (!memoryRecallBoundary(row.boundary) || ['forgotten', 'erased', 'access-changed', 'revoked'].includes(e.failure_code ?? '')) return [];
      const authority = liveMemoryAuthorityFromPrincipal(env, e, actor), relation = memoryRecallRelation(identity(e), identity(parent), row.boundary, hierarchy.forest, readable);
      return authority && relation ? [{ e, relation, authority }] : [];
    }).sort((a, b) => b.relation.weight - a.relation.weight || a.e.enrollment_id.localeCompare(b.e.enrollment_id));
    const sourceId = url.searchParams.get('source'), purpose = url.searchParams.get('purpose');
    if (sourceId !== null) {
      const chosen = eligible.find(source => source.e.enrollment_id === sourceId);
      if (!chosen || !MEMORY_DERIVATION_PURPOSES.some(p => p === purpose)) return reply({ error: 'recall_source_unavailable' }, 404);
      guards.push(chosen.authority.guard, liveMemoryEnrollmentGuard(chosen.e, 'recall'));
      const latestQuery = `SELECT j.job_id FROM memory_derivation_jobs j JOIN memory_derivation_grants g ON g.consent_id=j.consent_id
        JOIN memory_derivation_results r ON r.job_id=j.job_id WHERE g.enrollment_id=? AND g.enrollment_revision=? AND g.actor_user_id=? AND g.purpose=?
        AND g.revoked_at IS NULL AND g.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
        ORDER BY j.through_sequence DESC,j.job_id LIMIT 1`;
      const latestBindings = [chosen.e.enrollment_id, chosen.e.revision, actor.userId, purpose], latest = await rows(env, latestQuery, latestBindings);
      if (latest.length !== 1) return reply({ error: 'recall_source_unavailable' }, 404);
      guards.push(inventory(latestQuery, latestBindings, latest, ['job_id']));
      const presentation = await readNativeDerivationPresentation(env, actor.userId, String(latest[0].job_id), { enrollmentId: chosen.e.enrollment_id,
        enrollmentRevision: chosen.e.revision, guards: packRecallGuards(guards) });
      if (!presentation || !current()) return reply({ error: 'recall_source_unavailable' }, 503);
      return reply({ source: { enrollmentId: chosen.e.enrollment_id, projectId: chosen.e.project_id, documentId: chosen.e.document_id, ...chosen.relation },
        presentation, validUntil: new Date(Math.min(presentationDeadline, Date.parse(presentation.candidate.validUntil))).toISOString(),
        independentEvidence: false, completeHistory: false, presentationOnly: true });
    }
    if (purpose !== null) return reply({ error: 'recall_scope_required' }, 400);
    guards.push(...eligible.map(source => source.authority.guard));
    const checks = packRecallGuards(guards).map(g => derivationAssertion(env, g)), checked = await db.batch(checks);
    if (!current() || !derivationResults(checked, checks.length) || !checked.every(derivationVerified)) throw Error('recall_changed');
    return reply({ sources: eligible.map(source => ({ enrollmentId: source.e.enrollment_id, projectId: source.e.project_id, documentId: source.e.document_id, ...source.relation })),
      validUntil: new Date(Math.min(presentationDeadline, ...eligible.map(source => Date.parse(source.e.expires_at)))).toISOString(), complete: true });
  } catch { return reply({ error: request.method === 'GET' ? 'recall_unavailable' : 'recall_commit_unconfirmed' }, 503); }
}
