/** Prospective roots are authorized independently of a live Document. */
import type { CreativeProjection } from '../src/model/events.ts';
import type { CreationAuthority, CreationEntryKind, CreationScope } from '../src/model/creation.ts';
import { creationHash } from '../src/model/creation-validation.ts';

export async function authorityFromCreationProjection(scope:CreationScope,entryKind:CreationEntryKind,projection:CreativeProjection,options:{canCreateProject:boolean;canAuthorProject:boolean;allocatedIds?:Record<string,string>;selectedSharedProjectId?:string|null;selectedRootIds?:string[]}):Promise<CreationAuthority>{
  if(entryKind==='project'&&(scope.projectId!==null||options.selectedSharedProjectId||!options.canCreateProject))throw new Error('creation_prospective_project_denied');
  if(entryKind!=='project'&&(!scope.projectId||!options.canAuthorProject||!projection.projects.some(p=>p.id===scope.projectId)||options.selectedSharedProjectId&&options.selectedSharedProjectId!==scope.projectId))throw new Error('creation_project_denied');
  const blocks=projection.libraryBlocks.filter(b=>!b.removed&&b.projectId===scope.projectId);
  const documentIds=projection.documents.filter(d=>!d.removed&&d.projectId===scope.projectId).map(d=>d.id);
  if(scope.documentId&&(entryKind!=='idea'||!documentIds.includes(scope.documentId)))throw new Error('creation_document_denied');
  const relations=projection.libraryBlockRelations.filter(r=>!r.removed&&r.projectId===scope.projectId);
  const existingVersions=await Promise.all(blocks.map(async block=>({id:block.id,projectId:block.projectId,revision:block.sourceEvents.join(':'),hash:await creationHash({block,relations:relations.filter(r=>r.fromBlockId===block.id)})})));
  return {actorUserId:scope.actorUserId,custodyKey:scope.custodyKey,permissionEpoch:scope.permissionEpoch,canCreateProject:options.canCreateProject,canAuthorProject:options.canAuthorProject,projectId:scope.projectId,documentIds,existingBlocks:blocks,existingRelations:relations,existingVersions,allocatedIds:options.allocatedIds??{},selectedRootIds:options.selectedRootIds??[],occupiedIds:[...projection.projects.map(p=>p.id),...projection.documents.map(d=>d.id),...projection.libraryBlocks.map(b=>b.id),...projection.libraryBlockRelations.map(r=>r.id)]};
}
