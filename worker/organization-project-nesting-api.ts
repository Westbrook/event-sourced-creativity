import { memoryDigest } from '../src/model/scoped-memory.ts';
import { qualifiedProject,qualifiedProjectKey,reparentOrganizationProject,visibleOrganizationAncestors,type OrganizationProjectNestingView } from '../src/model/organization-project-nesting.ts';
import { projectContainmentId } from '../src/model/project-containment.ts';
import { readNativeControlBody } from './native-control-body.ts';
import { readNativeOrganizationNesting } from './organization-project-nesting.ts';
import { projectContainmentPrincipalGuard,readNativeProjectContainment } from './project-containment-api.ts';
import { requireUser,requireConsent } from './pilot-policy.ts';
import { readProjectRequestContext } from './project-request-context.ts';
import { nativeMemoryGrantDeadline } from './memory-native-deadlines.ts';
import { derivationExact } from './memory-derivation-policy.ts';
import { memoryDerivationSchema,derivationResults,derivationVerified } from './memory-derivation-store.ts';
import type { WorkerEnv } from './runtime.ts';
const headers={'cache-control':'private, no-store',vary:'Cookie, oai-authenticated-user-id, oai-authenticated-user-email'};
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers});
/** Owner controls the child; every possible parent needs independent author
 * access. An edge is not a membership, publication or Memory consent grant. */
export async function handleOrganizationProjectNesting(request:Request,env:WorkerEnv):Promise<Response|null>{
 if(!['GET','PATCH'].includes(request.method))return reply({error:'method_not_allowed'},405);
 const url=new URL(request.url),origin=request.headers.get('origin');
 if(origin&&origin!==url.origin||request.headers.get('sec-fetch-site')==='cross-site'||request.method==='PATCH'&&origin!==url.origin)return reply({error:'same_origin_required'},403);
 const db=env.DB,started=Date.now(),mono=performance.now();let deadline=started+30000;
 const current=()=>env.DB===db&&Date.now()>=started&&Date.now()<deadline&&performance.now()>=mono&&performance.now()-mono<30000;
 try{
  if([...url.searchParams.keys()].some(k=>!(request.method==='GET'?['projectId','version']:['version']).includes(k)||url.searchParams.getAll(k).length!==1))return reply({error:'invalid_containment_command'},400);
  const auth=await requireUser(request,env,'viewer',{account:'principal'}),user=auth.user;
  if(auth.response||!user)return reply({error:'authentication_required'},auth.response?.status??401);
  if(user.fictional||user.projectExecution||request.headers.get('cookie')?.split(';').some(c=>c.trim().startsWith('forma_impersonation=')))return reply({error:'containment_unavailable'},403);
  if(requireConsent(user))return reply({error:'pilot_terms_required'},428);
  const selected=await readProjectRequestContext(request,env,user);if(selected.response)return reply({error:'containment_unavailable'},403);
  const parsed=request.method==='PATCH'?await readNativeControlBody(request,4096):null,body=parsed?.status==='parsed'?parsed.value:null;
  const projectId=request.method==='PATCH'?(body?.project as {projectId?:unknown}|undefined)?.projectId:url.searchParams.get('projectId');
  if(!projectContainmentId(projectId)||body&&(!derivationExact(body,['version','project','parent','revision'])||body.version!=='project-containment-v2'
    ||!qualifiedProject(body.project)||body.parent!==null&&!qualifiedProject(body.parent)||!/^sha256:[a-f0-9]{64}$/u.test(String(body.revision))))return reply({error:'invalid_containment_command'},400);
  const owner=selected.context?.ownerUserId??user.userId,project={ownerId:owner,projectId};
  if(selected.context&&selected.context.projectId!==projectId||body&&qualifiedProjectKey(body.project as typeof project)!==qualifiedProjectKey(project))return reply({error:'containment_unavailable'},403);
  const tree=await readNativeProjectContainment(env,owner,true),node=tree.forest.get(projectId);
  if(!node)return reply({error:'containment_unavailable'},403);
  // Old installations and personal-only projects retain the exact old contract.
  // A v2 mutation can never fall through to a legacy write.
  if(!node.organizationId||!tree.crossOwner)return request.method==='GET'?null:reply({error:'containment_unavailable'},503);
  const state=await readNativeOrganizationNesting(env,node.organizationId,user,new Map([[owner,tree]])),principal=projectContainmentPrincipalGuard(env,user);
  const grant=nativeMemoryGrantDeadline(user,started);if(grant===undefined||!principal)throw Error('containment_authority');
  if(grant)deadline=Math.min(deadline,Date.parse(grant));
  const path=visibleOrganizationAncestors(state.forest,project,state.readable);if(!path)return reply({error:'containment_unavailable'},403);
  const canReparent=owner===user.userId&&state.authorable.has(qualifiedProjectKey(project)),nodes=[...state.forest.values()];
  const candidates=canReparent?nodes.filter(n=>qualifiedProjectKey(n)!==qualifiedProjectKey(project)&&state.authorable.has(qualifiedProjectKey(n))
    &&reparentOrganizationProject(nodes,project,{ownerId:n.ownerId,projectId:n.projectId})).map(n=>({ownerId:n.ownerId,projectId:n.projectId})):[];
  const schema=await memoryDerivationSchema(env);
  const guards=[principal,...state.guards,{sql:schema.guard.condition,bindings:[...schema.guard.bindings]},
    {sql:"?>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT EXISTS(SELECT 1 FROM sqlite_temp_schema) AND EXISTS(SELECT 1 FROM pragma_foreign_keys WHERE foreign_keys=1) AND EXISTS(SELECT 1 FROM pragma_ignore_check_constraints WHERE ignore_check_constraints=0)",bindings:[new Date(deadline).toISOString()]}];
  if(selected.context)guards.push({sql:"EXISTS(SELECT 1 FROM project_context_sessions WHERE context_id=? AND principal_user_id=? AND organization_id=? AND project_access_id=? AND revoked_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))",bindings:[selected.context.contextId,user.userId,selected.context.organizationId,selected.context.projectAccessId]});
  const assertions=guards.map(g=>db.prepare(`SELECT CASE WHEN (${g.sql}) THEN 1 ELSE json('containment_changed') END AS verified`).bind(...g.bindings));
  if(request.method==='GET'){
   // View-only revisions must not become an oracle for inaccessible topology.
   const view:OrganizationProjectNestingView={version:'project-containment-v2',project,revision:canReparent?state.revision:'sha256:'+await memoryDigest(JSON.stringify([project,path])),
    validUntil:new Date(deadline).toISOString(),...path,parent:path.ancestors[0]??null,candidates,canReparent,accessInherited:false};
   const result=structuredClone(await db.batch(assertions));if(!current()||!derivationResults(result,assertions.length)||!result.every(derivationVerified))throw Error('containment_changed');
   return reply(view);
  }
  if(!body||!canReparent||body.parent!==null&&!candidates.some(p=>qualifiedProjectKey(p)===qualifiedProjectKey(body.parent as typeof project)))return reply({error:'containment_move_not_allowed'},403);
  if(body.revision!==state.revision)return reply({error:'containment_changed'},409);
  const parent=body.parent as typeof project|null,revision=crypto.randomUUID(),now=new Date().toISOString(),sameOwner=parent?.ownerId===owner;
  const local=db.prepare(`INSERT INTO project_containment(owner_user_id,project_id,declaration_ref,parent_project_id,parent_declaration_ref,organization_id,revision,updated_at)
    VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(owner_user_id,project_id) DO UPDATE SET declaration_ref=excluded.declaration_ref,parent_project_id=excluded.parent_project_id,
    parent_declaration_ref=excluded.parent_declaration_ref,organization_id=excluded.organization_id,revision=excluded.revision,updated_at=excluded.updated_at`)
   .bind(owner,projectId,state.access.get(qualifiedProjectKey(project))!.declaration,sameOwner?parent!.projectId:null,
    sameOwner?state.access.get(qualifiedProjectKey(parent!))!.declaration:null,node.organizationId,revision,now);
  const writes=[local,db.prepare("SELECT CASE WHEN changes()=1 THEN 1 ELSE json('containment_unconfirmed') END AS verified")];
  if(parent&&!sameOwner)writes.push(db.prepare(`INSERT INTO organization_project_nesting(owner_user_id,project_id,declaration_ref,parent_owner_user_id,parent_project_id,parent_declaration_ref,organization_id,revision,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`)
   .bind(owner,projectId,state.access.get(qualifiedProjectKey(project))!.declaration,parent.ownerId,parent.projectId,state.access.get(qualifiedProjectKey(parent))!.declaration,node.organizationId,revision,now),
   db.prepare("SELECT CASE WHEN changes()=1 THEN 1 ELSE json('containment_unconfirmed') END AS verified"));
  if(!current())throw Error('containment_expired');
  const result=structuredClone(await db.batch([...assertions,...writes,assertions[0]!]));
  if(!current()||!derivationResults(result,assertions.length+writes.length+1)||!result.slice(0,assertions.length).every(derivationVerified)
   ||!derivationVerified(result.at(-1)!)||writes.some((_,i)=>i%2===1&&!derivationVerified(result[assertions.length+i]!)))throw Error('containment_unconfirmed');
  return reply({version:'project-containment-v2',saved:true,refreshRequired:true});
 }catch{return reply({error:request.method==='PATCH'?'containment_commit_unconfirmed':'containment_unavailable'},503);}
}
