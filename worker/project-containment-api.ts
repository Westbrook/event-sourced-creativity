import { readNativeControlBody } from "./native-control-body.ts";
import { prepareMemoryContextRetirement } from './memory-context-retirement.ts';
import { projectContainmentId as id, projectContainmentForest, reparentProjectForest, visibleProjectAncestors, PROJECT_CONTAINMENT_LIMIT,
  type ProjectContainmentNode, type ProjectContainmentView } from '../src/model/project-containment.ts';
import { PRINCIPAL_WITH_ACCESS_SQL } from './access-policy.ts';
import { POLICY_VERSION } from './policy-version.ts';
import { configuredPilotAdmissionGuard, hasCapability, requireConsent, requireUser, type PilotUser } from './pilot-policy.ts';
import { readProjectRequestContext } from './project-request-context.ts';
import { memoryCanonical } from './memory-sql.ts';
import { memoryDigest } from '../src/model/scoped-memory.ts';
import { projectContainmentSchemaProfile } from './project-containment-schema.ts';
import type { WorkerEnv } from './runtime.ts';

type Row = Record<string, unknown>;
type Query = { sql: string; bindings: (string | number | null)[] };
const headers = { 'cache-control': 'private, no-store', vary: 'Cookie, oai-authenticated-user-id, oai-authenticated-user-email' };
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });
const exact = (v: Row, keys: string[]) => Object.keys(v).sort().join(',') === keys.sort().join(',');
const schemaQuery = `SELECT name,sql,tbl_name AS 'table',type FROM sqlite_schema WHERE name LIKE 'project_containment%' OR name LIKE 'idx_project_containment%'
  OR tbl_name='project_containment' OR instr(lower(COALESCE(sql,'')),'project_containment')>0 ORDER BY name,type`;

function principalGuard(env: WorkerEnv, user: PilotUser): Query | null {
  const s = user.authorizationSnapshot, pilot = configuredPilotAdmissionGuard(env, user);
  if (!s) return null;
  return { sql: `EXISTS(SELECT 1 FROM(${PRINCIPAL_WITH_ACCESS_SQL}) principal WHERE
    (principal.user_id,principal.email,principal.role,principal.updated_at,principal.consent_version,COALESCE(principal.permission_epoch,''),
    COALESCE(principal.grants_json,'[]'),COALESCE(principal.organizations_json,'[]'),COALESCE(principal.projects_json,'[]'),
    COALESCE(principal.identity_policies_json,'[]'),COALESCE(principal.approved_canvas_requirements,0))=(?,?,?,?,?,?,?,?,?,?,?)) AND (${pilot.sql})`,
    bindings: [user.userId,user.userId,user.email,user.role,s.updatedAt,POLICY_VERSION,s.rawEpoch,s.grants,s.organizations,s.projects,s.identityPolicies,s.canvasRequirements,...pilot.bindings] };
}
function snapshot(query: Query, rows: Row[], columns: string[]): Query {
  return { sql: `(SELECT json_group_array(json_array(${columns.map(column => '"' + column + '"').join(',')})) FROM (${query.sql}))=?`,
    bindings: [...query.bindings,JSON.stringify(rows.map(row => columns.map(key => row[key])))] };
}
function verified(raw: unknown): raw is D1Result<Row>[] {
  return Array.isArray(raw) && raw.every(item => item && item.success === true && item.error === undefined && Array.isArray(item.results));
}
async function read(env: WorkerEnv, query: Query): Promise<Row[]> {
  const db = env.DB, result = structuredClone(await db.prepare(query.sql).bind(...query.bindings).all<Row>());
  if (env.DB !== db || !verified([result])) throw new Error('containment_read');
  return result.results;
}

async function readBatch(env: WorkerEnv, queries: Query[]): Promise<Row[][]> {
  const db=env.DB,result=structuredClone(await db.batch(queries.map(query=>db.prepare(query.sql).bind(...query.bindings))));
  if(env.DB!==db||!verified(result)||result.length!==queries.length)throw Error('containment_read');
  return result.map(value=>value.results);
}

/** Server-only witness. IDs carry no authority; replay its queries in the consuming transaction. */
export async function readNativeProjectContainment(env: WorkerEnv, owner: string, batched = false) {
  const size: Query = { sql: `SELECT COUNT(*) AS count,COALESCE(SUM(bytes),0) AS bytes FROM (
    SELECT length(CAST(event.payload AS BLOB)) AS bytes FROM events event WHERE event.stream_id=? AND event.type='ProjectCreated'
      AND NOT EXISTS(SELECT 1 FROM events compensation WHERE compensation.stream_id=event.stream_id AND compensation.compensates_event_id=event.event_id)
    ORDER BY event.sequence LIMIT ${PROJECT_CONTAINMENT_LIMIT + 1})`, bindings: ['creative:' + owner] };
  const schema = { sql: schemaQuery, bindings: [] };
  const [schemaRows, measured] = batched ? await readBatch(env, [schema,size]) : [await read(env,schema),await read(env,size)];
  const explicit = schemaRows.filter(row => row.sql !== null);
  if (schemaRows.length !== projectContainmentSchemaProfile.count + 1 || explicit.length !== projectContainmentSchemaProfile.count
    || 'sha256:' + await memoryDigest(memoryCanonical(explicit.map(row => ({ ...row, sql: String(row.sql).trim().replace(/;$/u,'').replace(/\bIF\s+NOT\s+EXISTS\s+/giu,'') })))) !== projectContainmentSchemaProfile.digest
    || schemaRows.some(row => row.sql === null && row.name !== 'sqlite_autoindex_project_containment_1')) throw new Error('containment_schema');
  if (measured.length !== 1 || !Number.isSafeInteger(measured[0].count) || !Number.isSafeInteger(measured[0].bytes)
    || Number(measured[0].count) > PROJECT_CONTAINMENT_LIMIT || Number(measured[0].bytes) > 1_048_576) throw new Error('containment_capacity');
  const declarations: Query = { sql: `SELECT event.event_id AS declaration,event.payload,event.sequence,
    (SELECT json_group_array(json_array(project.organization_id,project.project_access_id,project.status,
      (SELECT json_group_array(json_array(migration.organization_id,migration.owner_user_id,migration.status)) FROM project_migration_states migration WHERE migration.project_access_id=project.project_access_id)))
      FROM (SELECT * FROM organization_projects WHERE owner_user_id=? AND project_id=json_extract(event.payload,'$.project_id') ORDER BY project_access_id LIMIT 2) project) AS custody
    FROM events event WHERE event.stream_id=? AND event.type='ProjectCreated'
      AND NOT EXISTS(SELECT 1 FROM events compensation WHERE compensation.stream_id=event.stream_id AND compensation.compensates_event_id=event.event_id)
    ORDER BY event.sequence LIMIT ${PROJECT_CONTAINMENT_LIMIT + 1}`, bindings: [owner,'creative:' + owner] };
  const edges: Query = { sql: `SELECT project_id,declaration_ref,parent_project_id,parent_declaration_ref,organization_id,revision,updated_at
    FROM project_containment WHERE owner_user_id=? ORDER BY project_id LIMIT ${PROJECT_CONTAINMENT_LIMIT + 1}`, bindings: [owner] };
  // Repeat the measured bound in the body query so late growth is not hydrated.
  const boundedDeclarations: Query = {sql:`SELECT * FROM (${declarations.sql}) WHERE (?,?)=(SELECT count,bytes FROM (${size.sql}))`,
    bindings:[...declarations.bindings,Number(measured[0].count),Number(measured[0].bytes),...size.bindings]};
  const [declared, links] = batched ? await readBatch(env,[boundedDeclarations,edges]) : await Promise.all([read(env,boundedDeclarations),read(env,edges)]);
  if (declared.length !== measured[0].count) throw new Error('containment_declaration_changed');
  if (declared.length > PROJECT_CONTAINMENT_LIMIT || links.length > PROJECT_CONTAINMENT_LIMIT || new TextEncoder().encode(JSON.stringify([declared,links])).byteLength > 1_048_576) throw new Error('containment_capacity');
  const nodes: ProjectContainmentNode[] = [], access = new Map<string, { declaration: string; accessId: string | null; active: boolean }>();
  for (const row of declared) {
    const payload = JSON.parse(String(row.payload)), custody = JSON.parse(String(row.custody));
    if (!id(payload?.project_id) || !id(row.declaration) || access.has(payload.project_id) || !Array.isArray(custody) || custody.length > 1) throw new Error('containment_declaration');
    const scope = custody[0], migration = scope ? (typeof scope[3] === 'string' ? JSON.parse(scope[3]) : scope[3]) : null;
    if (scope && (!id(scope[0]) || !id(scope[1]) || !Array.isArray(migration))) throw new Error('containment_custody');
    nodes.push({ id: payload.project_id, parentId: null, organizationId: scope?.[0] ?? null });
    access.set(payload.project_id, { declaration: row.declaration, accessId: scope?.[1] ?? null,
      active: !scope || scope[2] === 'active' && migration.length === 1 && migration[0][0] === scope[0] && migration[0][1] === owner && migration[0][2] === 'active' });
  }
  for (const row of links) {
    const node = nodes.find(item => item.id === row.project_id), native = access.get(String(row.project_id));
    if (!node || native?.declaration !== row.declaration_ref || node.organizationId !== row.organization_id || !id(row.revision)
      || row.parent_project_id !== null && access.get(String(row.parent_project_id))?.declaration !== row.parent_declaration_ref) throw new Error('containment_edge');
    node.parentId = row.parent_project_id as string | null;
  }
  const forest = projectContainmentForest(nodes); if (!forest) throw new Error('containment_forest');
  const guards = [snapshot(schema,schemaRows,['name','sql','table','type']),snapshot(size,measured,['count','bytes']), snapshot(boundedDeclarations,declared,['declaration','payload','sequence','custody']),
    snapshot(edges,links,['project_id','declaration_ref','parent_project_id','parent_declaration_ref','organization_id','revision','updated_at'])];
  return { forest, access, guards, revision: 'sha256:' + await memoryDigest(memoryCanonical([declared,links])) };
}

async function commandBody(request: Request): Promise<Row | null> {
  const body = await readNativeControlBody(request, 2048);
  return body.status === 'parsed' && exact(body.value,['projectId','parentId','revision']) ? body.value : null;
}

export async function handleProjectContainment(request: Request, env: WorkerEnv): Promise<Response> {
  if (!['GET','PATCH'].includes(request.method)) return reply({ error: 'method_not_allowed' },405);
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') return reply({ error: 'same_origin_required' },403);
  try {
    const auth = await requireUser(request,env,'viewer',{account:'principal'}), user = auth.user;
    if (auth.response || !user) return new Response(auth.response?.body ?? null,{status:auth.response?.status ?? 401,headers});
    if (user.fictional || user.projectExecution || request.headers.get('cookie')?.split(';').some(c => c.trim().startsWith('forma_impersonation='))) return reply({error:'containment_unavailable'},403);
    const consent = requireConsent(user); if (consent) return reply({error:'pilot_terms_required'},428);
    const selected = await readProjectRequestContext(request,env,user); if (selected.response) return reply({error:'containment_unavailable'},403);
    const body = request.method === 'PATCH' ? await commandBody(request) : null;
    const projectId = body?.projectId ?? new URL(request.url).searchParams.get('projectId');
    if (!id(projectId) || request.method === 'PATCH' && (!body || body.parentId !== null && !id(body.parentId) || !/^sha256:[a-f0-9]{64}$/u.test(String(body.revision)))) return reply({error:'invalid_containment_command'},400);
    if (selected.context && selected.context.projectId !== projectId) return reply({error:'containment_unavailable'},403);
    const owner = selected.context?.ownerUserId ?? user.userId, db = env.DB;
    const state = await readNativeProjectContainment(env,owner), node = state.forest.get(projectId), principal = principalGuard(env,user);
    const readable = new Set<string>();
    for (const candidate of state.forest.values()) {
      const native = state.access.get(candidate.id)!;
      if (native.active && (candidate.organizationId === null ? owner === user.userId : hasCapability(user,'project.read',{organizationId:candidate.organizationId,projectAccessId:native.accessId}))) readable.add(candidate.id);
    }
    const path = visibleProjectAncestors(state.forest,projectId,readable);
    if (!node || !path || !principal) return reply({error:'containment_unavailable'},403);
    const author = (target: string) => {
      const item = state.forest.get(target), native = state.access.get(target);
      return owner === user.userId && readable.has(target) && !!item && (item.organizationId === null
        ? ['creator','admin'].includes(user.role) : hasCapability(user,'project.author',{organizationId:item.organizationId,projectAccessId:native?.accessId}));
    };
    const canReparent = author(projectId), candidateNodes = [...state.forest.values()];
    const candidates = canReparent ? candidateNodes.filter(item => item.id !== projectId && item.organizationId === node.organizationId && author(item.id)
      && reparentProjectForest(candidateNodes,projectId,item.id)).map(item => item.id) : [];
    const view: ProjectContainmentView = {version:'project-containment-v1',projectId,revision:canReparent ? state.revision : 'sha256:' + await memoryDigest(memoryCanonical([projectId,path])),...path,
      parentId:path.ancestors[0] ?? null,candidates,canReparent,accessInherited:false};
    const guards = [principal,...state.guards,{sql:'NOT EXISTS(SELECT 1 FROM sqlite_temp_schema)',bindings:[]},
      {sql:"?>strftime('%Y-%m-%dT%H:%M:%fZ','now')",bindings:[new Date(Date.now()+30_000).toISOString()]}];
    if (selected.context) guards.push({sql:"EXISTS(SELECT 1 FROM project_context_sessions WHERE context_id=? AND principal_user_id=? AND organization_id=? AND project_access_id=? AND revoked_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
      bindings:[selected.context.contextId,user.userId,selected.context.organizationId,selected.context.projectAccessId]});
    if (env.DB !== db) throw new Error('containment_database_changed');
    const assertions = guards.map(guard => db.prepare(`SELECT CASE WHEN (${guard.sql}) THEN 1 ELSE json('containment_changed') END AS verified`).bind(...guard.bindings));
    if (request.method === 'GET') {
      const result = await db.batch(assertions);
      if (env.DB !== db || !verified(result) || result.length !== assertions.length || result.some(r => r.results.length !== 1 || r.results[0].verified !== 1)) throw new Error('containment_unconfirmed');
      return reply(view);
    }
    const parentId = body!.parentId as string | null;
    if (!canReparent || parentId !== null && !candidates.includes(parentId)) return reply({error:'containment_move_not_allowed'},403);
    if (body!.revision !== state.revision) return reply({error:'containment_changed'},409);
    const revision = crypto.randomUUID(), updatedAt = new Date().toISOString();
    const mutation = db.prepare(`INSERT INTO project_containment(owner_user_id,project_id,declaration_ref,parent_project_id,parent_declaration_ref,organization_id,revision,updated_at)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(owner_user_id,project_id) DO UPDATE SET declaration_ref=excluded.declaration_ref,
      parent_project_id=excluded.parent_project_id,parent_declaration_ref=excluded.parent_declaration_ref,organization_id=excluded.organization_id,revision=excluded.revision,updated_at=excluded.updated_at`)
      .bind(owner,projectId,state.access.get(projectId)!.declaration,parentId,parentId === null ? null : state.access.get(parentId)!.declaration,node.organizationId,revision,updatedAt);
    const check = db.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM project_containment WHERE owner_user_id=? AND project_id=? AND revision=?)
      THEN 1 ELSE json('containment_commit_missing') END AS verified`).bind(owner,projectId,revision);
    const retired=await prepareMemoryContextRetirement(env,{kind:'hierarchy',ownerUserId:owner});
    const all=await db.batch([...retired.assertions,...assertions,mutation,assertions[0],check,...retired.statements]);
    if(!retired.acknowledge(all.slice(0,retired.assertions.length),all.slice(retired.assertions.length+assertions.length+3)))throw Error('containment_retirement_unconfirmed');
    const result=all.slice(retired.assertions.length,retired.assertions.length+assertions.length+3);
    if (env.DB !== db || !verified(result) || result.length !== assertions.length+3
      || result.filter((_,i) => i !== assertions.length).some(r => r.results.length !== 1 || r.results[0].verified !== 1)) throw new Error('containment_unconfirmed');
    return reply({version:'project-containment-v1',saved:true,refreshRequired:true});
  } catch { return reply({error:request.method === 'PATCH' ? 'containment_commit_unconfirmed' : 'containment_unavailable'},503); }
}
