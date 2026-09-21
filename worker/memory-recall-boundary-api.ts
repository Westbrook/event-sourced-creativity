import { memoryProfileContextBoundarySchemaProfile as profileContextBoundary } from './memory-derivation-profile-context-schema.ts';
import { prepareNativeReuseRecall } from './memory-reuse-recall.ts';
import { readNativeOrganizationNesting } from './organization-project-nesting.ts';
import { qualifiedProjectKey,visibleOrganizationAncestors } from '../src/model/organization-project-nesting.ts';
import { prepareMemoryContextRetirement } from './memory-context-retirement.ts';
import { bodyOf, parentColumns, readScope } from './memory-derivation-api.ts';
import { nativeMemoryGrantDeadline, nativeMemoryPilotDeadline, nativeMemoryPilotQuery } from './memory-native-deadlines.ts';
import { requireUser, hasCapability, type PilotUser } from './pilot-policy.ts';
import { liveMemoryEnabled } from './memory-live-store.ts';
import { liveMemoryAuthorityFromPrincipal, liveMemoryEnrollmentGuard, type LiveMemoryEnrollment } from './memory-live-authority.ts';
import { memoryCanonical, type MemorySqlGuard } from './memory-sql.ts';
import { memoryDigest } from '../src/model/scoped-memory.ts';
import { memoryRecallBoundary, memoryRecallRelation, type MemoryRecallBoundary, type MemoryRecallScope } from '../src/model/memory-recall-boundary.ts';
import { memoryRecallOrganizationSchemaProfile as organizationProfile } from './memory-recall-organization-schema.ts';
import { memoryRecallBoundarySchemaProfile as profile } from './memory-recall-boundary-schema.ts';
import { readNativeProjectContainment } from './project-containment-api.ts';
import { derivationAssertion, derivationResults, derivationVerified, memoryDerivationEnabled, memoryDerivationBinding } from './memory-derivation-store.ts';
import { derivationExact, derivationId, MEMORY_DERIVATION_PURPOSES } from './memory-derivation-policy.ts';
import { readNativeDerivationPresentation } from './memory-derivation-results.ts';
import type { WorkerEnv } from './runtime.ts';

type Row = Record<string, unknown>;
const version = 'memory-scope-recall-v1';
const headers = { 'cache-control': 'private, no-store', vary: 'Cookie, oai-authenticated-user-id, oai-authenticated-user-email' };
const reply = (value: Row, status = 200, current?:()=>boolean) => {
  const body = JSON.stringify({ version, ...value });
  const response=new TextEncoder().encode(body).byteLength <= 524288
    ? new Response(body, { status, headers: { ...headers, 'content-type': 'application/json' } })
    : Response.json({ version, error: 'recall_response_capacity' }, { status: 503, headers });
  if(current&&!current())throw Error('recall_delivery_expired');return response;
};
const columns = ['enrollment_id', 'enrollment_revision', 'boundary', 'revision', 'consented_at'] as const;
const organizationColumns = ['enrollment_id','enrollment_revision','boundary_revision','actor_user_id','organization_id','consented_at'] as const;
const family = "name LIKE 'memory_recall_boundaries%' OR tbl_name='memory_recall_boundaries' OR instr(lower(COALESCE(sql,'')),'memory_recall_boundaries')>0";
const extendedFamily = `(${family}) OR name LIKE 'memory_recall_organization_%' OR tbl_name='memory_recall_organization_ranges' OR instr(lower(COALESCE(sql,'')),'memory_recall_organization_ranges')>0`;
const schemaQuery = `SELECT name,sql,tbl_name AS 'table',type FROM sqlite_schema WHERE ${extendedFamily} ORDER BY name,type LIMIT 12`;
async function rows(env: WorkerEnv, sql: string, bindings: readonly (string | number | null)[] = []) {
  const db = env.DB, result = structuredClone(await db.prepare(sql).bind(...bindings).all<Row>());
  if (env.DB !== db || !derivationResults([result], 1)) throw Error('recall_read');
  return result.results;
}
function inventory(sql: string, bindings: readonly (string | number | null)[], found: Row[], keys: readonly string[]): MemorySqlGuard {
  return { condition: `(SELECT json_group_array(json_array(${keys.map(key => '"' + key + '"').join(',')})) FROM (${sql}))=?`,
    bindings: [...bindings, JSON.stringify(found.map(row => keys.map(key => row[key])))] };
}
async function certifyRecallBoundarySchema(found: Row[]) {
  const profiles=[profile,organizationProfile,profileContextBoundary];
  const explicit=found.filter(row=>row.sql!==null),names:readonly string[]=profiles.flatMap(p=>[...p.names]);
  if(found.some(row=>!derivationExact(row,['name','sql','table','type'])) || explicit.some(row=>!names.includes(String(row.name))))throw Error('recall_schema');
  const organizationRangesPresent=explicit.some(row=>(organizationProfile.names as readonly string[]).includes(String(row.name)));
  const installed=[profile,...(organizationRangesPresent?[organizationProfile]:[]),...(explicit.some(row=>(profileContextBoundary.names as readonly string[]).includes(String(row.name)))?[profileContextBoundary]:[])];
  const automatic:readonly string[]=installed.flatMap(p=>[...p.automaticIndexes]);
  if(found.length!==installed.reduce((sum,p)=>sum+p.count+p.automaticIndexes.length,0)
    || found.some(row=>row.sql===null&&(!automatic.includes(String(row.name))||row.type!=='index')))throw Error('recall_schema');
  for(const p of installed){
    const selected=explicit.filter(row=>(p.names as readonly string[]).includes(String(row.name)));
    if(selected.length!==p.count||'sha256:'+await memoryDigest(memoryCanonical(selected.map(row=>({...row,sql:String(row.sql).trim().replace(/;$/u,'').replace(/\bIF\s+NOT\s+EXISTS\s+/giu,'')}))))!==p.digest)throw Error('recall_schema');
  }
  return {guard:inventory(schemaQuery,[],found,['name','sql','table','type']),organizationRangesPresent};
}
export async function readNativeRecallBoundarySchema(env: WorkerEnv) {
  return (await certifyRecallBoundarySchema(await rows(env,schemaQuery))).guard;
}
/** One source-free read for independently certified schema and exact consent.
 * The returned data is not access authority; consumers replay both guards with
 * native source/target permission and ancestry proofs before publication. */
export async function readNativeRecallBoundarySnapshot(env: WorkerEnv, enrollmentId: string) {
  if(!derivationId(enrollmentId))throw Error('recall_enrollment');
  const db=env.DB,query=`SELECT ${columns.join(',')} FROM memory_recall_boundaries WHERE enrollment_id=? LIMIT 2`;
  const results=structuredClone(await db.batch<Row>([db.prepare(schemaQuery),db.prepare(query).bind(enrollmentId)]));
  if(env.DB!==db||!derivationResults(results,2))throw Error('recall_read');
  const schema=await certifyRecallBoundarySchema(results[0]!.results),found=results[1]!.results;
  if(env.DB!==db||found.length>1||found.some(row=>!derivationExact(row,columns)))throw Error('recall_boundary');
  const guards=[schema.guard,inventory(query,[enrollmentId],found,columns)],boundary=found[0]??null;
  if(schema.organizationRangesPresent){
    const q=`SELECT ${organizationColumns.join(',')} FROM memory_recall_organization_ranges WHERE enrollment_id=? LIMIT 2`,organization=await rows(env,q,[enrollmentId]);
    guards.push(inventory(q,[enrollmentId],organization,organizationColumns));
    if(organization.length>1||organization.some(row=>!derivationExact(row,organizationColumns)||!boundary||boundary.boundary!=='partition'
      ||row.enrollment_revision!==boundary.enrollment_revision||row.boundary_revision!==boundary.revision))throw Error('recall_organization_consent');
    if(organization.length)return {boundary:{...boundary!,boundary:'organization'} as Row,organization:organization[0]!,guards,organizationRangesPresent:true};
  }
  return {boundary,organization:null,guards,organizationRangesPresent:schema.organizationRangesPresent};
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

type RecallTree = Awaited<ReturnType<typeof readNativeProjectContainment>>;
/** Each owner has a separate native forest. Equal bare project IDs cannot
 * borrow another owner's access or ancestry. This cache lives for one request
 * only; every captured proof is replayed at disclosure/dispatch. */
export async function readNativeRecallRelation(env:WorkerEnv,actor:PilotUser,source:LiveMemoryEnrollment,target:LiveMemoryEnrollment,
  boundary:MemoryRecallBoundary,trees=new Map<string,RecallTree>()){
  const tree=async(owner:string)=>{let value=trees.get(owner);if(!value){if(trees.size>=8)throw Error('recall_owner_capacity');value=await readNativeProjectContainment(env,owner,true);trees.set(owner,value);}return value;};
  const targetTree=await tree(target.owner_user_id),sourceTree=source.owner_user_id===target.owner_user_id?targetTree:await tree(source.owner_user_id);
  const readable=(owner:string,t:RecallTree)=>new Set([...t.forest.values()].filter(node=>{
    const access=t.access.get(node.id)!;return access.active&&(node.organizationId===null?owner===actor.userId:hasCapability(actor,'project.read',{organizationId:node.organizationId,projectAccessId:access.accessId}));
  }).map(node=>node.id));
  // Only the separately explicit organization range can traverse another
  // owner's edges. Legacy partition/project-tree consent is never broadened.
  if(boundary==='organization'&&source.organization_id&&sourceTree.crossOwner&&targetTree.crossOwner){
    const graph=await readNativeOrganizationNesting(env,source.organization_id,actor,trees);
    const from={ownerId:source.owner_user_id,projectId:source.project_id},to={ownerId:target.owner_user_id,projectId:target.project_id};
    const a=visibleOrganizationAncestors(graph.forest,from,graph.readable),b=visibleOrganizationAncestors(graph.forest,to,graph.readable);
    if(!a||!b)return {relation:null,guards:graph.guards.map(g=>({condition:g.sql,bindings:g.bindings})),hierarchyRevision:graph.revision};
    const left=[from,...a.ancestors],right=[to,...b.ancestors],distances=left.flatMap((p,i)=>{const j=right.findIndex(q=>qualifiedProjectKey(p)===qualifiedProjectKey(q));return j<0?[]:[i+j];});
    const distance=distances.length?Math.min(...distances):null;
    const sameProject=qualifiedProjectKey(from)===qualifiedProjectKey(to);
    const relation:import('../src/model/memory-recall-boundary.ts').MemoryRecallRelation=sameProject
      ?{zoom:source.document_id===target.document_id?'document':'project',distance:0,weight:source.document_id===target.document_id?1:.7}
      :distance!==null?{zoom:'project-tree',distance,weight:.5/(1+distance)}:{zoom:'organization',distance:0,weight:.0125};
    return {relation,guards:graph.guards.map(g=>({condition:g.sql,bindings:g.bindings})),hierarchyRevision:graph.revision};
  }
  const relation=memoryRecallRelation(identity(source),identity(target),boundary,targetTree.forest,readable(target.owner_user_id,targetTree),
    {forest:sourceTree.forest,readable:readable(source.owner_user_id,sourceTree)});
  const distinct=sourceTree===targetTree?[targetTree]:[sourceTree,targetTree];
  return {relation,guards:distinct.flatMap(t=>t.guards.map(g=>({condition:g.sql,bindings:g.bindings}))),
    hierarchyRevision:sourceTree===targetTree?targetTree.revision:'sha256:'+await memoryDigest(memoryCanonical([
      [source.owner_user_id,sourceTree.revision],[target.owner_user_id,targetTree.revision]]))};
}
export function recallSourceIdentity(e:LiveMemoryEnrollment,zoom:string,crossOwner=false){
  return {enrollmentId:e.enrollment_id,projectId:e.project_id,documentId:e.document_id,...(zoom==='organization'||crossOwner?{ownerId:e.owner_user_id}: {})};
}

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
    if (!derivationId(projectId) || !derivationId(documentId) || [...url.searchParams.keys()].some(key => !(control ? ['projectId', 'documentId'] : ['projectId', 'documentId', 'source', 'purpose', 'reuse']).includes(key) || url.searchParams.getAll(key).length !== 1)) return reply({ error: 'recall_scope_required' }, 400);
    if(url.searchParams.has('reuse')&&(control||url.searchParams.get('reuse')!=='1'))return reply({error:'recall_scope_required'},400);
    const schema=await certifyRecallBoundarySchema(await rows(env,schemaQuery));
    const guards: MemorySqlGuard[] = [schema.guard, { condition: "?>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT EXISTS(SELECT 1 FROM sqlite_temp_schema) AND EXISTS(SELECT 1 FROM pragma_foreign_keys WHERE foreign_keys=1) AND EXISTS(SELECT 1 FROM pragma_ignore_check_constraints WHERE ignore_check_constraints=0)", bindings: [new Date(started + 30000).toISOString()] }];
    // Withdrawal remains possible after source access, qualification or learning ends.
    if (control && request.method === 'DELETE') {
      const body = await bodyOf(request);
      if (!body || !derivationExact(body, ['confirmation']) || body.confirmation !== 'RESET_RECALL_BOUNDARY') return reply({ error: 'explicit_recall_reset_required' }, 400);
      const snapshot = actor.authorizationSnapshot; if (!snapshot) return reply({ error: 'principal_account_required' }, 403);
      guards.push({ condition: "EXISTS(SELECT 1 FROM users WHERE user_id=? AND role=? AND COALESCE(updated_at,'')=?)", bindings: [actor.userId, actor.role, snapshot.updatedAt] });
      const checks = packRecallGuards(guards).map(g => derivationAssertion(env, g));
      const retired=await prepareMemoryContextRetirement(env,{kind:'boundary',actorUserId:actor.userId,projectId,documentId});
      const all=await db.batch([...retired.assertions,...checks, db.prepare('DELETE FROM memory_recall_boundaries WHERE enrollment_id IN(SELECT enrollment_id FROM memory_live_enrollments WHERE actor_user_id=? AND project_id=? AND document_id=?)').bind(actor.userId, projectId, documentId),...retired.statements]);
      if(!retired.acknowledge(all.slice(0,retired.assertions.length),all.slice(retired.assertions.length+checks.length+1)))throw Error('recall_retirement_unconfirmed');
      const result=all.slice(retired.assertions.length,retired.assertions.length+checks.length+1);
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
    const recalled=await readNativeRecallBoundarySnapshot(env,parent.enrollment_id),boundary=recalled.boundary;
    guards.push(...recalled.guards);
    if(boundary&&(boundary.enrollment_revision!==parent.revision||!memoryRecallBoundary(boundary.boundary))
      ||recalled.organization&&(recalled.organization.actor_user_id!==parent.actor_user_id||recalled.organization.organization_id!==parent.organization_id))throw Error('recall_boundary');
      if (request.method === 'PUT') {
        const body = await bodyOf(request);
        if (!body || !derivationExact(body, ['version', 'enrollmentId', 'enrollmentRevision', 'boundary', 'revision', 'confirmation']) || body.version !== version
          || body.enrollmentId !== parent.enrollment_id || body.enrollmentRevision !== parent.revision || !memoryRecallBoundary(body.boundary)
          || body.confirmation !== 'CHANGE_RECALL_BOUNDARY') return reply({ error: 'explicit_recall_boundary_required' }, 400);
        if(body.boundary==='organization'&&(!schema.organizationRangesPresent||!parent.organization_id||parent.learn_enabled!==1))return reply({error:'organization_recall_unavailable'},409);
        if (body.revision !== (boundary?.revision ?? null)) return reply({ error: 'recall_boundary_changed' }, 409);
        const revision = crypto.randomUUID(), checks = packRecallGuards(guards).map(g => derivationAssertion(env, g));
        const retired=await prepareMemoryContextRetirement(env,{kind:'boundary',actorUserId:actor.userId,projectId,documentId});
        const organizationWrites=body.boundary==='organization'?[db.prepare(`INSERT INTO memory_recall_organization_ranges(${organizationColumns.join(',')}) VALUES(?,?,?,?,?,?)`)
          .bind(parent.enrollment_id,parent.revision,revision,actor.userId,parent.organization_id,new Date().toISOString()),
          derivationAssertion(env,{condition:'changes()=1',bindings:[]})]:[];
        const all = await db.batch([...retired.assertions,...checks, db.prepare(`INSERT INTO memory_recall_boundaries(${columns.join(',')}) VALUES(?,?,?,?,?)
          ON CONFLICT(enrollment_id) DO UPDATE SET enrollment_revision=excluded.enrollment_revision,boundary=excluded.boundary,revision=excluded.revision,consented_at=excluded.consented_at`)
          .bind(parent.enrollment_id, parent.revision, body.boundary==='organization'?'partition':body.boundary, revision, new Date().toISOString()),
          derivationAssertion(env, { condition: 'EXISTS(SELECT 1 FROM memory_recall_boundaries WHERE enrollment_id=? AND revision=?)', bindings: [parent.enrollment_id, revision] }),...organizationWrites,...retired.statements]);
        if(!retired.acknowledge(all.slice(0,retired.assertions.length),all.slice(retired.assertions.length+checks.length+2+organizationWrites.length)))throw Error('recall_retirement_unconfirmed');
        const result=all.slice(retired.assertions.length,retired.assertions.length+checks.length+2+organizationWrites.length);
        if (!current() || !derivationResults(result, checks.length + 2 + organizationWrites.length) || !result.slice(0, checks.length).every(derivationVerified) || !derivationVerified(result[checks.length+1]!) || !derivationVerified(result.at(-1)!)) throw Error('recall_unconfirmed');
        return reply({ saved: true, refreshRequired: true });
      }
      const checks = packRecallGuards(guards).map(g => derivationAssertion(env, g)), checked = await db.batch(checks);
      if (!current() || !derivationResults(checked, checks.length) || !checked.every(derivationVerified)) throw Error('recall_changed');
      return reply({ enrollmentId: parent.enrollment_id, enrollmentRevision: parent.revision, boundary: boundary?.boundary ?? 'document', revision: boundary?.revision ?? null,
        validUntil: new Date(presentationDeadline).toISOString(),...(schema.organizationRangesPresent?{organizationAvailable:parent.organization_id!==null&&parent.learn_enabled===1}:{}) },200,()=>current()&&Date.now()<presentationDeadline);
    }
    if (!memoryDerivationEnabled(env, actor.userId)) return reply({ error: 'derived_memory_disabled' }, 403);
    const trees=new Map<string,RecallTree>();
    // Capture the target's native project inventory even for an empty catalog.
    const hierarchy=await readNativeProjectContainment(env,parent.owner_user_id,true);trees.set(parent.owner_user_id,hierarchy);
    guards.push(...hierarchy.guards.map(g=>({condition:g.sql,bindings:g.bindings})));
    const organizationJoin=schema.organizationRangesPresent?'LEFT JOIN memory_recall_organization_ranges o ON o.enrollment_id=e.enrollment_id AND o.enrollment_revision=e.revision AND o.boundary_revision=b.revision AND o.actor_user_id=e.actor_user_id AND o.organization_id=e.organization_id': '';
    const effectiveBoundary=schema.organizationRangesPresent?"CASE WHEN o.enrollment_id IS NOT NULL AND b.boundary='partition' THEN 'organization' ELSE b.boundary END":'b.boundary';
    const sourcesQuery = `SELECT ${parentColumns.map(c => 'e.' + c).join(',')},${effectiveBoundary} AS boundary,b.revision AS boundary_revision FROM memory_live_enrollments e
      JOIN memory_recall_boundaries b ON b.enrollment_id=e.enrollment_id AND b.enrollment_revision=e.revision ${organizationJoin}
      WHERE e.actor_user_id=? AND (e.owner_user_id=? ${schema.organizationRangesPresent?"OR o.enrollment_id IS NOT NULL AND b.boundary='partition'":''})
        AND e.organization_id IS ? AND e.enrollment_id<>? AND e.learn_enabled=1 AND e.recall_enabled=1
        AND e.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND b.boundary<>'document' ORDER BY e.enrollment_id LIMIT 33`;
    const sourceBindings = [actor.userId, parent.owner_user_id, parent.organization_id, parent.enrollment_id], sources = await rows(env, sourcesQuery, sourceBindings);
    if (sources.length > 32) return reply({ error: 'recall_scope_capacity' }, 409);
    guards.push(inventory(sourcesQuery, sourceBindings, sources, [...parentColumns, 'boundary', 'boundary_revision']));
    let eligible=[];
    for(const row of sources){
      const e=Object.fromEntries(parentColumns.map(key=>[key,row[key]])) as unknown as LiveMemoryEnrollment;
      if(!memoryRecallBoundary(row.boundary)||['forgotten','erased','access-changed','revoked'].includes(e.failure_code??''))continue;
      const authority=liveMemoryAuthorityFromPrincipal(env,e,actor);if(!authority)continue;
      const related=await readNativeRecallRelation(env,actor,e,parent,row.boundary,trees);guards.push(...related.guards);
      if(related.relation)eligible.push({e,relation:related.relation,authority});
    }
    if(url.searchParams.get('reuse')==='1'){
      const reused=await prepareNativeReuseRecall(env,actor,parent,eligible.map(value=>value.e));
      guards.push(...reused.guards);responseDeadline=Math.min(responseDeadline,Date.parse(reused.validUntil));
      eligible=eligible.filter(value=>reused.enrollments.includes(value.e.enrollment_id));
    }
    eligible.sort((a,b)=>b.relation.weight-a.relation.weight||a.e.enrollment_id.localeCompare(b.e.enrollment_id));
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
      return reply({ source: { ...recallSourceIdentity(chosen.e,chosen.relation.zoom,chosen.e.owner_user_id!==parent.owner_user_id), ...chosen.relation },
        presentation, validUntil: new Date(Math.min(responseDeadline, Date.parse(presentation.candidate.validUntil))).toISOString(),
        independentEvidence: false, completeHistory: false, presentationOnly: true },200,()=>current()&&Date.now()<Date.parse(presentation.candidate.validUntil));
    }
    if (purpose !== null) return reply({ error: 'recall_scope_required' }, 400);
    guards.push(...eligible.map(source => source.authority.guard));
    const checks = packRecallGuards(guards).map(g => derivationAssertion(env, g)), checked = await db.batch(checks);
    if (!current() || !derivationResults(checked, checks.length) || !checked.every(derivationVerified)) throw Error('recall_changed');
    return reply({ sources: eligible.map(source => ({ ...recallSourceIdentity(source.e,source.relation.zoom,source.e.owner_user_id!==parent.owner_user_id), ...source.relation })),
      validUntil: new Date(Math.min(responseDeadline, ...eligible.map(source => Date.parse(source.e.expires_at)))).toISOString(), complete: true },200,()=>current()&&eligible.every(source=>Date.now()<Date.parse(source.e.expires_at)));
  } catch { return reply({ error: request.method === 'GET' ? 'recall_unavailable' : 'recall_commit_unconfirmed' }, 503); }
}
