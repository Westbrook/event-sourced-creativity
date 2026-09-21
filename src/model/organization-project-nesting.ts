import { projectContainmentId, PROJECT_CONTAINMENT_DEPTH, PROJECT_CONTAINMENT_LIMIT } from './project-containment.ts';
export type QualifiedProject = { ownerId:string; projectId:string };
export type OrganizationProjectNode = QualifiedProject & { parent:QualifiedProject|null; organizationId:string };
export type OrganizationProjectNestingView = {
 version:'project-containment-v2';project:QualifiedProject;revision:string;validUntil:string;
 ancestors:QualifiedProject[];ancestryComplete:boolean;parent:QualifiedProject|null;
 candidates:QualifiedProject[];canReparent:boolean;accessInherited:false;
};
export const qualifiedProjectKey=(project:QualifiedProject)=>JSON.stringify([project.ownerId,project.projectId]);
export function qualifiedProject(value:unknown):value is QualifiedProject {
 return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')==='ownerId,projectId'
  &&projectContainmentId((value as QualifiedProject).ownerId)&&projectContainmentId((value as QualifiedProject).projectId);
}
/** Owner-qualified relevance graph only, never a source of access rights. */
export function organizationProjectForest(input:readonly OrganizationProjectNode[]){
 if(!Array.isArray(input)||input.length>PROJECT_CONTAINMENT_LIMIT)return null;
 const nodes=new Map<string,Readonly<OrganizationProjectNode>>(),owners=new Set<string>();
 for(const node of input){
  if(!node||!qualifiedProject({ownerId:node.ownerId,projectId:node.projectId})||!projectContainmentId(node.organizationId)
    ||node.parent!==null&&!qualifiedProject(node.parent)||nodes.has(qualifiedProjectKey(node)))return null;
  owners.add(node.ownerId);if(owners.size>8)return null;
  nodes.set(qualifiedProjectKey(node),Object.freeze({...node,parent:node.parent?Object.freeze({...node.parent}):null}));
 }
 for(const node of nodes.values()){
  const visited=new Set<string>();let current:Readonly<OrganizationProjectNode>|undefined=node;
  while(current){
   const key=qualifiedProjectKey(current);
   if(visited.has(key)||visited.size>=PROJECT_CONTAINMENT_DEPTH||current.organizationId!==node.organizationId)return null;
   visited.add(key);if(current.parent===null)break;current=nodes.get(qualifiedProjectKey(current.parent));if(!current)return null;
  }
 }
 return nodes;
}
export function reparentOrganizationProject(nodes:readonly OrganizationProjectNode[],project:QualifiedProject,parent:QualifiedProject|null){
 if(!organizationProjectForest(nodes)||!qualifiedProject(project)||parent!==null&&!qualifiedProject(parent)
  ||!nodes.some(node=>qualifiedProjectKey(node)===qualifiedProjectKey(project)))return null;
 return organizationProjectForest(nodes.map(node=>qualifiedProjectKey(node)===qualifiedProjectKey(project)?{...node,parent}:node));
}
export function visibleOrganizationAncestors(nodes:ReadonlyMap<string,Readonly<OrganizationProjectNode>>,project:QualifiedProject,readable:ReadonlySet<string>){
 const first=nodes.get(qualifiedProjectKey(project));if(!first||!readable.has(qualifiedProjectKey(project)))return null;
 const ancestors:QualifiedProject[]=[];let current=first;
 while(current.parent){
  if(!readable.has(qualifiedProjectKey(current.parent)))return {ancestors,ancestryComplete:false};
  const next=nodes.get(qualifiedProjectKey(current.parent));if(!next)return null;
  ancestors.push({...current.parent});current=next;
 }
 return {ancestors,ancestryComplete:true};
}
