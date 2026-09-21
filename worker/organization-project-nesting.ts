import { organizationProjectForest,qualifiedProjectKey,type OrganizationProjectNode } from '../src/model/organization-project-nesting.ts';
import { projectContainmentId } from '../src/model/project-containment.ts';
import { readNativeProjectContainment } from './project-containment-api.ts';
import { hasCapability,type PilotUser } from './pilot-policy.ts';
import { memoryCanonical } from './memory-sql.ts';
import { memoryDigest } from '../src/model/scoped-memory.ts';
import { derivationResults } from './memory-derivation-store.ts';
import { derivationExact,derivationTime } from './memory-derivation-policy.ts';
import type { WorkerEnv } from './runtime.ts';
type Tree=Awaited<ReturnType<typeof readNativeProjectContainment>>;
type Query={sql:string;bindings:(string|number|null)[]};
type Row=Record<string,unknown>;
const columns=['owner_user_id','project_id','declaration_ref','parent_owner_user_id','parent_project_id','parent_declaration_ref','organization_id','revision','updated_at'];
/** Every owner inventory and edge is exact and bounded. This is only a staged
 * source witness: callers replay all guards before disclosure or mutation. */
export async function readNativeOrganizationNesting(env:WorkerEnv,organizationId:string,actor:PilotUser,trees=new Map<string,Tree>()){
 if(!projectContainmentId(organizationId))throw Error('organization_nesting_scope');
 const db=env.DB,guards:Query[]=[];
 const read=async(query:Query,keys:string[])=>{
  const r=structuredClone(await db.prepare(query.sql).bind(...query.bindings).all<Row>());
  if(env.DB!==db||!derivationResults([r],1)||r.results.some(row=>!derivationExact(row,keys)))throw Error('organization_nesting_read');
  guards.push({sql:`(SELECT json_group_array(json_array(${keys.map(key=>'"'+key+'"').join(',')})) FROM (${query.sql}))=?`,bindings:[...query.bindings,JSON.stringify(r.results.map(row=>keys.map(key=>row[key])))]});
  return r.results;
 };
 const owners=await read({sql:'SELECT DISTINCT CASE WHEN length(CAST(owner_user_id AS BLOB))<=800 THEN owner_user_id END AS owner_user_id FROM organization_projects WHERE organization_id=? ORDER BY owner_user_id LIMIT 9',bindings:[organizationId]},['owner_user_id']);
 if(!owners.length||owners.length>8||owners.some(row=>!projectContainmentId(row.owner_user_id)))throw Error('organization_nesting_owner_capacity');
 const nodes:OrganizationProjectNode[]=[],access=new Map<string,{declaration:string;accessId:string|null;active:boolean}>();
 for(const row of owners){
  const owner=String(row.owner_user_id);let tree=trees.get(owner);
  if(!tree){tree=await readNativeProjectContainment(env,owner,true);trees.set(owner,tree);}
  if(!tree.crossOwner)throw Error('organization_nesting_schema');guards.push(...tree.guards);
  for(const node of tree.forest.values())if(node.organizationId===organizationId){
   const qualified={ownerId:owner,projectId:node.id};
   nodes.push({...qualified,organizationId,parent:node.parentId?{ownerId:owner,projectId:node.parentId}:null});access.set(qualifiedProjectKey(qualified),tree.access.get(node.id)!);
  }
  if(nodes.length>256)throw Error('organization_nesting_capacity');
 }
 const edges=await read({sql:`WITH selected AS MATERIALIZED(SELECT ${columns.join(',')} FROM organization_project_nesting WHERE organization_id=? ORDER BY owner_user_id,project_id LIMIT 257),
    size AS(SELECT COALESCE(SUM(${columns.map(c=>'length(CAST('+c+' AS BLOB))').join('+')}),0) AS bytes FROM selected)
    SELECT CASE WHEN size.bytes<=262144 THEN owner_user_id ELSE json('organization_nesting_capacity') END AS owner_user_id,${columns.slice(1).join(',')}
    FROM selected CROSS JOIN size ORDER BY owner_user_id,project_id`,bindings:[organizationId]},columns);
 if(edges.length>256)throw Error('organization_nesting_capacity');
 for(const edge of edges){
  const node=nodes.find(n=>n.ownerId===edge.owner_user_id&&n.projectId===edge.project_id),parent=nodes.find(n=>n.ownerId===edge.parent_owner_user_id&&n.projectId===edge.parent_project_id);
  if(!node||!parent||node.parent!==null||node.ownerId===parent.ownerId||edge.organization_id!==organizationId
   ||!projectContainmentId(edge.revision)||!derivationTime(edge.updated_at)||Date.parse(edge.updated_at)>Date.now()||access.get(qualifiedProjectKey(node))?.declaration!==edge.declaration_ref
   ||access.get(qualifiedProjectKey(parent))?.declaration!==edge.parent_declaration_ref)throw Error('organization_nesting_edge');
  node.parent={ownerId:parent.ownerId,projectId:parent.projectId};
 }
 const forest=organizationProjectForest(nodes);if(!forest||env.DB!==db)throw Error('organization_nesting_forest');
 const readable=new Set<string>(),authorable=new Set<string>();
 for(const node of nodes){const key=qualifiedProjectKey(node),native=access.get(key)!;
  if(native.active&&hasCapability(actor,'project.read',{organizationId,projectAccessId:native.accessId}))readable.add(key);
  if(readable.has(key)&&hasCapability(actor,'project.author',{organizationId,projectAccessId:native.accessId}))authorable.add(key);
 }
 const revision='sha256:'+await memoryDigest(memoryCanonical([organizationId,owners,edges,owners.map(row=>[row.owner_user_id,trees.get(String(row.owner_user_id))!.revision])]));
 return {forest,access,readable,authorable,guards,revision};
}
