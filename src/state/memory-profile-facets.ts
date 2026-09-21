import type { DerivationResultItem,DerivationControl } from './memory-derivation-client.ts';
import type { ReconciledProfileItem } from './memory-profile-reconciliation.ts';
import type { MemoryCustody } from '../model/memory-custody.ts';
import type { MemoryRecallBoundary } from '../model/memory-recall-boundary.ts';
import type { RecallBoundaryView, RecallSource } from './memory-recall-boundary-client.ts';

export type MemoryProfileFacet={scope:Exclude<MemoryRecallBoundary,'document'>;projectId:string;text:string;category:string;
  authority:'tentative';independentEvidence:false;completeHistory:false;
  originalCount:number;documentCount:number;projectCount:number;
  support:readonly {ownerId?:string;projectId:string;documentId:string;jobId:string;claimKey:string;quotes:DerivationResultItem['supports']}[]};
export type MemoryProjectProfileFacet=MemoryProfileFacet & {scope:'project'};
type Section={purpose:string;source?:RecallSource;items:readonly (DerivationResultItem|ReconciledProfileItem)[];
  corrections:readonly DerivationControl[];jobId:string|null};

/** Read-side proposal, never policy or prompt/publication authority. Only exact
 * repeated interpretations are grouped: no semantic paraphrase equivalence.
 * Native original-backed profile parsers certify human quotation origins; their
 * original identities, not model responses, determine the evidence count.
 * The actual consumer separately proves local source-side project recall consent
 * and keeps this projection inside the intersection of all source leases. */
export function projectMemoryProfileFacets(projectId:string,documentId:string,sections:readonly Section[]):MemoryProjectProfileFacet[]{
  return profileFacets('project',projectId,documentId,sections) as MemoryProjectProfileFacet[];
}

/** Scope-qualified read-side facets. The peer's native relation proves its
 * source-side range. The independently read local boundary must also permit
 * this exact zoom. Organization remains private to this actor, not shared policy. */
export function scopedMemoryProfileFacets(selection:{projectId:string;documentId:string;custody:MemoryCustody},
  sections:readonly Section[],boundary:RecallBoundaryView):MemoryProfileFacet[]{
  if(boundary.boundary==='document')return [];
  const scopes:MemoryProfileFacet['scope'][]=['project'];
  if(['project-tree','partition','organization'].includes(boundary.boundary))scopes.push('project-tree');
  if(boundary.boundary==='partition')scopes.push('partition');
  if(boundary.boundary==='organization'&&boundary.organizationAvailable&&selection.custody.kind==='organization')scopes.push('organization');
  return scopes.flatMap(zoom=>profileFacets(zoom,selection.projectId,selection.documentId,sections,
    zoom!=='project'&&boundary.boundary==='organization'&&boundary.organizationAvailable===true&&selection.custody.kind==='organization'
      ?selection.custody.ownerUserId:undefined)).slice(0,16);
}

function profileFacets(zoom:MemoryProfileFacet['scope'],projectId:string,documentId:string,sections:readonly Section[],localOwner?:string):MemoryProfileFacet[]{
  if(sections.length>32)return [];
  const local=sections.filter(section=>section.purpose==='profile'&&!section.source);
  if(local.length!==1||local[0]!.corrections.length)return [];
  const peers=sections.filter(section=>section.purpose==='profile'&&section.source?.zoom===zoom
    &&(!section.source.ownerId||localOwner!==undefined&&section.source.ownerId!==localOwner)
    &&(zoom==='project'?section.source.projectId===projectId&&!section.source.ownerId&&section.source.documentId!==documentId
      :section.source.ownerId!==undefined||section.source.projectId!==projectId));
  if(!peers.length||peers.some(section=>section.corrections.length)||peers.length>8)return [];
  const groups=new Map<string,{text:string;category:string;members:{ownerId?:string;projectId:string;documentId:string;jobId:string;item:DerivationResultItem;ids:Set<string>}[]}>();
  for(const section of [...local,...peers])for(const item of section.items){
    if(!['preference-hypothesis','workflow-hypothesis'].includes(item.category)||item.citationStatus!=='support-cited'
      ||item.counterevidence.length||item.reconciles?.length||item.observationCitations?.length
      ||!item.originalSupportIds?.length||item.originalSupportIds.length>128
      ||'profileOrigin' in item&&(item.profileOrigin.state!=='latest'||item.profileOrigin.interpretation!=='current'
        ||item.profileOrigin.proposedRelations?.length))continue;
    const jobId='profileOrigin' in item?item.profileOrigin.jobId:section.jobId;if(!jobId)continue;
    const key=JSON.stringify([item.category,item.text]),group=groups.get(key)??{text:item.text,category:item.category,members:[]};
    group.members.push({...(section.source?.ownerId?{ownerId:section.source.ownerId}:localOwner?{ownerId:localOwner}:{}),projectId:section.source?.projectId??projectId,documentId:section.source?.documentId??documentId,jobId,item,ids:new Set(item.originalSupportIds)});groups.set(key,group);
  }
  const blocked=new Set([...local,...peers].flatMap(section=>section.items.filter(item=>item.citationStatus==='conflicting-citations'||item.counterevidence.length).map(item=>JSON.stringify([item.category,item.text]))));
  const challenged=new Set([...local,...peers].flatMap(section=>section.items.flatMap(item=>item.reconciles?.map(link=>link.claimKey)??[])));
  const facets:MemoryProfileFacet[]=[];
  for(const group of groups.values()){
    if(blocked.has(JSON.stringify([group.category,group.text]))||group.members.some(member=>challenged.has(member.item.claimKey)))continue;
    const documentKey=(member:{ownerId?:string;projectId:string;documentId:string})=>JSON.stringify([member.ownerId??null,member.projectId,member.documentId]);
    const documents=new Set(group.members.map(documentKey)),projects=new Set(group.members.map(member=>JSON.stringify([member.ownerId??null,member.projectId])));
    if(!documents.has(documentKey({ownerId:localOwner,projectId,documentId}))||documents.size<2||zoom!=='project'&&projects.size<2)continue;
    // Shared originals, even under different summaries or revisions, cannot
    // supply cross-document support. Ambiguous duplication suppresses the facet.
    const sourceDocuments=new Map<string,Set<string>>();
    for(const member of group.members)for(const id of member.ids){const sourceKey=JSON.stringify([member.ownerId??null,id]),docs=sourceDocuments.get(sourceKey)??new Set<string>();docs.add(documentKey(member));sourceDocuments.set(sourceKey,docs);}
    if(sourceDocuments.size<3||[...sourceDocuments.values()].some(docs=>docs.size!==1))continue;
    const support=group.members.map(member=>({...(member.ownerId?{ownerId:member.ownerId}:{}),projectId:member.projectId,documentId:member.documentId,jobId:member.jobId,claimKey:member.item.claimKey,quotes:structuredClone(member.item.supports)}));
    facets.push({scope:zoom,projectId,text:group.text,category:group.category,authority:'tentative',independentEvidence:false,
      completeHistory:false,originalCount:sourceDocuments.size,documentCount:documents.size,projectCount:projects.size,support});
  }
  return facets.slice(0,8);
}
