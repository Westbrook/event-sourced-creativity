/** Explicit, version-bound graph corrections. No wording is invented by these operations. */
import type { CreationPlan, Decision, ProposedNode, ProposedUse, ReviewState, SourceEvidence } from './creation.ts';

type IdeaPatch = Pick<ProposedNode, 'title'|'body'|'text'|'type'|'subtype'|'intent'|'preferredOutputKinds'>;
export type CorrectionSource = {node:ProposedNode; dependencyIds:string[]};
export type CorrectionEffect = {id:string; nodeId?:string; documentId?:string; kind:'use'|'reference'|'mention'|'meaning'|'record'; before:string; after:string; resolved:boolean; message:string};
export type CorrectionPreview = {schemaVersion:1; id:string; baseSignature:string; before:CreationPlan; after:CreationPlan; effects:CorrectionEffect[]; changedNodeIds:string[]; changedUseIds:string[]; blockers:string[]};
export type RemovalRepair = {nodeId:string; patch:IdeaPatch; /** Required for an existing saved Idea. */ independentId?:string; retainedAliasIsDifferentIdentity?:boolean};
const copy = <T>(value:T):T => structuredClone(value);
const signature=(plan:CreationPlan)=>JSON.stringify(plan);
const fingerprint=(text:string)=>{let hash=14695981039346656037n;for(let i=0;i<text.length;i++){hash^=BigInt(text.charCodeAt(i));hash=BigInt.asUintN(64,hash*1099511628211n);}return hash.toString(16);};
const undoSignature=(plan:CreationPlan)=>fingerprint(JSON.stringify({...plan,draftRevision:undefined,decisions:plan.decisions.map(({detail,...decision})=>decision)}));
const derivedId=(decisionId:string,role:string,id:string)=>`correction:${fingerprint(JSON.stringify([decisionId,role,id]))}`;
const retained=(node:ProposedNode)=>node.disposition==='retained';
const sourceText=(node:ProposedNode)=>node.text??'';
const correctionEvidence=(id:string):SourceEvidence=>({kind:'correction',decisionId:id});
function requireId(plan:CreationPlan,id:string){if(!id||plan.decisions.some(d=>d.id===id))throw new Error('Use a new correction identity.');}
function nodesWithSources(plan:CreationPlan,sources:readonly CorrectionSource[]=[]){
  const nodes=new Map(plan.nodes.filter(retained).map(n=>[n.id,n]));
  for(const source of sources){if(source.node.projectId!==(plan.scope.projectId??plan.nodes.find(n=>n.kind==='project'&&retained(n))?.id))throw new Error('Reuse and variation must stay in the same Project.');if(!nodes.has(source.node.id))nodes.set(source.node.id,source.node);}
  return nodes;
}
/** Public body shape only; references retain display text and independent occurrence identity. */
function rewriteBody(body:ProposedNode['body'],mapping:Map<string,string>,suffix=''):ProposedNode['body']{
  if(!body)return body;
  const next=copy(body);
  const visit=(value:unknown)=>{if(!value||typeof value!=='object')return;if(Array.isArray(value)){value.forEach(visit);return;}const record=value as Record<string,unknown>;if(record.kind==='token'&&record.type==='still-idea-reference'){const data=record.data as Record<string,unknown>|undefined;if(data&&typeof data.blockId==='string'&&mapping.has(data.blockId))data.blockId=mapping.get(data.blockId)!;if(suffix&&typeof record.id==='string')record.id+=suffix;}Object.values(record).forEach(visit);};visit(next);return next;
}
export function correctionBodyTargetIds(body:ProposedNode['body']):string[]{const targets=new Set<string>();const visit=(v:unknown)=>{if(!v||typeof v!=='object')return;if(Array.isArray(v)){v.forEach(visit);return;}const r=v as Record<string,unknown>;if(r.kind==='token'&&r.type==='still-idea-reference'){const d=r.data as Record<string,unknown>|undefined;if(typeof d?.blockId==='string')targets.add(d.blockId);}Object.values(r).forEach(visit);};visit(body);return [...targets];}
function edges(plan:CreationPlan,sources:readonly CorrectionSource[]=[]){const result=new Map<string,Set<string>>();const add=(a:string,b:string)=>{if(!result.has(a))result.set(a,new Set());result.get(a)!.add(b);};for(const node of plan.nodes.filter(retained))for(const id of correctionBodyTargetIds(node.body))add(node.id,id);for(const ref of plan.references)add(ref.fromId,ref.toId);for(const source of sources){for(const id of [...source.dependencyIds,...correctionBodyTargetIds(source.node.body)])add(source.node.id,id);}return result;}
function closure(roots:Iterable<string>,graph:Map<string,Set<string>>){const found=new Set<string>(),todo=[...roots];while(todo.length){const id=todo.pop()!;if(found.has(id))continue;found.add(id);todo.push(...graph.get(id)??[]);}return found;}
function changedIds<T extends {id:string}>(before:T[],after:T[]){const old=new Map(before.map(x=>[x.id,JSON.stringify(x)]));return after.filter(x=>old.get(x.id)!==JSON.stringify(x)).map(x=>x.id);}
function finish(before:CreationPlan,after:CreationPlan,id:string,kind:Decision['kind'],nodeIds:string[],effects:CorrectionEffect[],blockers:string[]=[],detail?:string):CorrectionPreview{
  requireId(before,id);
  const graph=edges(after),visiting=new Set<string>(),visited=new Set<string>();
  const acyclic=(nodeId:string):boolean=>{if(visiting.has(nodeId))return false;if(visited.has(nodeId))return true;visiting.add(nodeId);for(const target of graph.get(nodeId)??[])if(!acyclic(target))return false;visiting.delete(nodeId);visited.add(nodeId);return true;};
  if([...graph.keys()].some(nodeId=>!acyclic(nodeId)))blockers.push('This correction creates a circular Idea dependency. Repair its references before accepting.');
  const decision:Decision={id,kind,nodeIds,revision:before.draftRevision,accepted:true,detail};
  after.decisions.push(decision);
  const changedNodeIds=changedIds(before.nodes,after.nodes),changedUseIds=changedIds(before.uses,after.uses);
  decision.detail=JSON.stringify({schemaVersion:1,explanation:detail,afterSignature:undoSignature(after),undo:{nodes:before.nodes.filter(n=>changedNodeIds.includes(n.id)),addedNodeIds:changedNodeIds.filter(id=>!before.nodes.some(n=>n.id===id)),uses:before.uses.filter(u=>changedUseIds.includes(u.id)),addedUseIds:changedUseIds.filter(id=>!before.uses.some(u=>u.id===id)),references:before.references,coverage:before.coverage}});
  // Review changes are governed by semantic hashes as well as these explicit invalidations.
  return {schemaVersion:1,id,baseSignature:signature(before),before:copy(before),after,effects,changedNodeIds,changedUseIds,blockers:[...blockers,...effects.filter(e=>!e.resolved).map(e=>e.message)]};
}
export function acceptCreationCorrection(plan:CreationPlan,review:ReviewState,preview:CorrectionPreview):{plan:CreationPlan;review:ReviewState}{
  if(signature(plan)!==preview.baseSignature)throw new Error('This correction preview is stale. Review it again.');
  if(preview.blockers.length||preview.effects.some(e=>!e.resolved))throw new Error('Resolve every correction effect before accepting.');
  const next=copy(preview.after),state=copy(review);delete state.finalApprovalHash;
  const graph=edges(next),affected=new Set(preview.changedNodeIds);
  let expanded=true;while(expanded){expanded=false;for(const [parent,children]of graph)if([...children].some(id=>affected.has(id))&&!affected.has(parent)){affected.add(parent);expanded=true;}}
  for(const id of affected)delete state.nodes[id];
  for(const use of next.uses)if(preview.changedUseIds.includes(use.id)||affected.has(use.ideaId)){delete state.uses[use.id];delete state.nodes[use.documentId];}
  for(const node of next.nodes)if(node.kind==='project')delete state.nodes[node.id];
  state.stage='ideas';return{plan:next,review:state};
}
export function previewRemoveDocument(plan:CreationPlan,documentId:string,decisionId:string):CorrectionPreview{
  const after=copy(plan),node=after.nodes.find(n=>n.id===documentId&&n.kind==='document'&&retained(n));if(!node)throw new Error('Only a proposed Document can be removed.');node.disposition='removed';node.revision++;
  const effects:CorrectionEffect[]=[{id:`${decisionId}:record`,nodeId:documentId,kind:'record',before:node.title,after:'All Idea proposals remain in the Project.',resolved:true,message:'Remove the proposed Document and preserve all Ideas.'}];
  for(const use of after.uses.filter(u=>u.documentId===documentId&&u.disposition==='retained')){use.disposition='removed';use.revision++;effects.push({id:use.id,documentId,nodeId:use.ideaId,kind:'use',before:'Used in this Document',after:'Preserved in Project',resolved:true,message:'Remove this Document use only.'});}
  after.coverage=after.coverage.map(c=>c.nodeIds.includes(documentId)?{...c,decisionId}:c);
  return finish(plan,after,decisionId,'remove',[documentId],effects);
}
export function previewLocalVariation(plan:CreationPlan,input:{ideaId:string;documentId:string;decisionId:string;newId:string;patch:IdeaPatch;sources?:readonly CorrectionSource[]}):CorrectionPreview{
  const {ideaId,documentId,decisionId,newId,patch}=input,graph=edges(plan,input.sources),all=nodesWithSources(plan,input.sources),source=all.get(ideaId);if(!source||source.kind!=='idea')throw new Error('Choose an available Idea.');
  const roots=plan.uses.filter(u=>u.disposition==='retained'&&u.documentId===documentId).map(u=>u.ideaId),local=closure(roots,graph);if(!local.has(ideaId))throw new Error('This Idea is not included in the selected Document.');
  const affected=[...local].filter(id=>closure([id],graph).has(ideaId)),mapping=new Map(affected.map(id=>[id,id===ideaId?newId:derivedId(decisionId,'parent',id)]));
  for(const id of mapping.values())if(plan.nodes.some(n=>n.id===id)||all.has(id)||[...mapping.values()].filter(value=>value===id).length>1)throw new Error('A local variation needs a new identity.');
  const after=copy(plan),effects:CorrectionEffect[]=[];
  for(const id of affected){const original=all.get(id);if(!original)throw new Error('Refresh the full dependency closure before making a variation.');const node:ProposedNode={...copy(original),...(id===ideaId?copy(patch):{}),id:mapping.get(id)!,revision:1,disposition:'retained',sourceEvidence:[...original.sourceEvidence,correctionEvidence(decisionId)],provenance:[...(original.provenance??[]),...original.sourceEvidence.filter(e=>e.kind==='existing')]};node.body=rewriteBody(node.body,mapping,`:${decisionId}`);after.nodes.push(node);effects.push({id:node.id,nodeId:node.id,documentId,kind:'record',before:sourceText(original),after:sourceText(node),resolved:true,message:id===ideaId?'Create an independent local Idea.':'Create a local parent and redirect its dependencies.'});}
  for(const ref of plan.references)if(mapping.has(ref.fromId))after.references.push({...copy(ref),id:derivedId(decisionId,'reference',ref.id),fromId:mapping.get(ref.fromId)!,toId:mapping.get(ref.toId)??ref.toId,sourceEvidence:[...ref.sourceEvidence,correctionEvidence(decisionId)]});
  // Existing authored dependency relations also need explicit redirected edges.
  for(const [from,toIds]of graph)if(mapping.has(from))for(const to of toIds){if(correctionBodyTargetIds(all.get(from)?.body).includes(to))continue;const mappedFrom=mapping.get(from)!,mappedTo=mapping.get(to)??to;if(!correctionBodyTargetIds(after.nodes.find(n=>n.id===mappedFrom)?.body).includes(mappedTo)&&!after.references.some(r=>r.fromId===mappedFrom&&r.toId===mappedTo))after.references.push({id:derivedId(decisionId,'edge',`${from}:${to}`),fromId:mappedFrom,toId:mappedTo,kind:'semantic',sourceEvidence:[correctionEvidence(decisionId)]});}
  for(const use of after.uses)if(use.documentId===documentId&&use.disposition==='retained'&&mapping.has(use.ideaId)){use.ideaId=mapping.get(use.ideaId)!;use.revision++;use.dependencyManifest=[];}
  return finish(plan,after,decisionId,'variation',affected,effects);
}
export function previewRemoveIdea(plan:CreationPlan,input:{ideaId:string;decisionId:string;repairs?:readonly RemovalRepair[];aliases?:readonly string[];semanticFindings?:readonly {nodeId:string;phrase:string;resolved:boolean}[];semanticReviewComplete:boolean;sources?:readonly CorrectionSource[]}):CorrectionPreview{
  const {ideaId,decisionId}=input,all=nodesWithSources(plan,input.sources),target=all.get(ideaId);if(!target||target.kind!=='idea')throw new Error('Choose an available Idea to remove.');
  const after=copy(plan),graph=edges(plan,input.sources),effects:CorrectionEffect[]=[],blockers:string[]=[],repairs=new Map((input.repairs??[]).map(r=>[r.nodeId,r])),mapping=new Map<string,string>();
  if(!input.semanticReviewComplete)blockers.push('Review aliases, pronouns and remaining meaning before completing removal.');
  const proposed=after.nodes.find(n=>n.id===ideaId);if(proposed){proposed.disposition='removed';proposed.revision++;}
  for(const [id,repair]of repairs){if(id===ideaId)throw new Error('Repair the remaining Ideas, not the removed Idea.');const original=all.get(id);if(!original)throw new Error('A repair target is unavailable.');const existing=!after.nodes.some(n=>n.id===id);if(existing&&!repair.independentId)throw new Error('A saved Idea repair must create an independent variation.');const newId=existing?repair.independentId!:id;if(existing&&(all.has(newId)||after.nodes.some(n=>n.id===newId)||[...mapping.values()].includes(newId)))throw new Error('Use a new identity for the repair.');mapping.set(id,newId);const node:ProposedNode={...copy(original),...copy(repair.patch),id:newId,revision:existing?1:original.revision+1,disposition:'retained',sourceEvidence:[...original.sourceEvidence,correctionEvidence(decisionId)]};if(existing)after.nodes.push(node);else after.nodes[after.nodes.findIndex(n=>n.id===id)]=node;}
  // Any saved parent that must be rewritten is copied into this draft, transitively.
  let more=true;while(more){more=false;for(const [parent,children]of graph)if(parent!==ideaId&&!mapping.has(parent)&&[...children].some(id=>mapping.has(id)&&mapping.get(id)!==id)){const original=all.get(parent);if(!original)continue;if(after.nodes.some(n=>n.id===parent)){mapping.set(parent,parent);}else{const id=derivedId(decisionId,'parent',parent);mapping.set(parent,id);after.nodes.push({...copy(original),id,revision:1,sourceEvidence:[...original.sourceEvidence,correctionEvidence(decisionId)]});}more=true;}}
  for(const node of after.nodes.filter(retained)){const old=all.get([...mapping].find(([,to])=>to===node.id)?.[0]??node.id);const rewritten=rewriteBody(node.body,mapping);if(JSON.stringify(rewritten)!==JSON.stringify(node.body)){node.body=rewritten;node.revision++;}if(old&&old.id!==ideaId){const depends=(graph.get(old.id)?.has(ideaId)??false),aliases=[target.title,...input.aliases??[]].filter(Boolean),mentions=aliases.some(alias=>sourceText(old).toLocaleLowerCase().includes(alias.toLocaleLowerCase()));const findings=(input.semanticFindings??[]).filter(f=>f.nodeId===old.id);if(depends||mentions||findings.length){const repair=repairs.get(old.id),residual=correctionBodyTargetIds(node.body).includes(ideaId)||(!repair?.retainedAliasIsDifferentIdentity&&aliases.some(alias=>(node.title+'\n'+sourceText(node)).toLocaleLowerCase().includes(alias.toLocaleLowerCase())));effects.push({id:`${decisionId}:meaning:${old.id}`,nodeId:node.id,kind:depends?'reference':'mention',before:sourceText(old),after:sourceText(node),resolved:Boolean(repair)&&!residual&&findings.every(f=>f.resolved),message:'Resolve references, aliases and relationships in this Idea with explicit replacement wording.'});}}}
  for(const source of input.sources??[])if(source.node.id!==ideaId&&!mapping.has(source.node.id)&&((graph.get(source.node.id)?.has(ideaId))||[target.title,...input.aliases??[]].some(alias=>alias&&sourceText(source.node).toLocaleLowerCase().includes(alias.toLocaleLowerCase()))))effects.push({id:`${decisionId}:saved:${source.node.id}`,nodeId:source.node.id,kind:'meaning',before:sourceText(source.node),after:sourceText(source.node),resolved:false,message:'An included saved Idea still contains this concept. Detach it or create an independent repaired variation.'});
  const oldReferences=after.references;after.references=[];
  for(const ref of oldReferences){if(ref.fromId===ideaId)continue;const from=mapping.get(ref.fromId)??ref.fromId,to=mapping.get(ref.toId)??ref.toId;if(to===ideaId){if(!repairs.has(ref.fromId))blockers.push('An explicit dependency on the removed Idea needs repair.');continue;}after.references.push({...ref,fromId:from,toId:to});}
  for(const source of input.sources??[])if(mapping.has(source.node.id)){const fromId=mapping.get(source.node.id)!;for(const targetId of graph.get(source.node.id)??[]){if(targetId===ideaId||correctionBodyTargetIds(source.node.body).includes(targetId))continue;const toId=mapping.get(targetId)??targetId;if(!correctionBodyTargetIds(after.nodes.find(n=>n.id===fromId)?.body).includes(toId)&&!after.references.some(r=>r.fromId===fromId&&r.toId===toId))after.references.push({id:derivedId(decisionId,'repair',`${fromId}:${toId}`),fromId,toId,kind:'semantic',sourceEvidence:[correctionEvidence(decisionId)]});}}
  for(const use of after.uses){if(use.disposition!=='retained')continue;if(use.ideaId===ideaId){use.disposition='removed';use.revision++;effects.push({id:use.id,nodeId:ideaId,documentId:use.documentId,kind:'use',before:'Included',after:'Removed from draft',resolved:true,message:'Remove this use.'});}else if(mapping.has(use.ideaId)){use.ideaId=mapping.get(use.ideaId)!;use.revision++;use.dependencyManifest=[];}}
  for(const node of after.nodes.filter(retained))if(correctionBodyTargetIds(node.body).includes(ideaId))blockers.push(`An unresolved reference remains in ${node.title}.`);
  const ranges=target.sourceEvidence.filter((e):e is Extract<SourceEvidence,{kind:'span'}>=>e.kind==='span').map(({start,end})=>({start,end}));
  after.coverage=after.coverage.map(c=>c.nodeIds.includes(ideaId)?{...c,decisionId}:c);
  const preview=finish(plan,after,decisionId,'remove',[ideaId],effects,blockers);preview.after.decisions.at(-1)!.sourceRanges=ranges;const undo=JSON.parse(preview.after.decisions.at(-1)!.detail!);undo.afterSignature=undoSignature(preview.after);preview.after.decisions.at(-1)!.detail=JSON.stringify(undo);
  return preview;
}
/** Redirect an already-created identity inside one composition, copying dependent parents. */
function redirectLocalParents(plan:CreationPlan,documentId:string,targetId:string,replacementId:string,decisionId:string,sources:readonly CorrectionSource[]=[]){
  const all=nodesWithSources(plan,sources),graph=edges(plan,sources),local=closure(plan.uses.filter(u=>u.disposition==='retained'&&u.documentId===documentId).map(u=>u.ideaId),graph);
  const parents=[...local].filter(id=>id!==targetId&&id!==replacementId&&closure([id],graph).has(targetId)),mapping=new Map([[targetId,replacementId],...parents.map(id=>[id,derivedId(decisionId,'merge-parent',`${documentId}:${id}`)] as [string,string])]);
  for(const id of parents){const original=all.get(id);if(!original)throw new Error('Refresh complete source dependencies before merging.');const newId=mapping.get(id)!;if(plan.nodes.some(n=>n.id===newId))throw new Error('A local merge parent needs a new identity.');plan.nodes.push({...copy(original),id:newId,revision:1,body:rewriteBody(original.body,mapping,`:${newId}`),sourceEvidence:[...original.sourceEvidence,correctionEvidence(decisionId)]});
    for(const target of graph.get(id)??[])if(!correctionBodyTargetIds(original.body).includes(target))plan.references.push({id:derivedId(decisionId,'merge-edge',`${newId}:${target}`),fromId:newId,toId:mapping.get(target)??target,kind:'semantic',sourceEvidence:[correctionEvidence(decisionId)]});
  }
  for(const use of plan.uses)if(use.disposition==='retained'&&use.documentId===documentId&&mapping.has(use.ideaId)){use.ideaId=mapping.get(use.ideaId)!;use.revision++;use.dependencyManifest=[];}
}
/** Merge is authored by the user/reviewed proposal. The compiler never writes into a saved target. */
export function previewMergeIdeas(plan:CreationPlan,input:{sourceId:string;targetId:string;decisionId:string;patch:IdeaPatch;independentId?:string;sources?:readonly CorrectionSource[];differentUsesAcknowledged:boolean}):CorrectionPreview{
  const {sourceId,targetId,decisionId}=input;if(sourceId===targetId)throw new Error('Choose a different merge destination.');const all=nodesWithSources(plan,input.sources),source=all.get(sourceId),target=all.get(targetId);if(!source||!target||source.kind!=='idea'||target.kind!=='idea')throw new Error('Both Ideas must be available.');
  const after=copy(plan),sourceProposed=after.nodes.find(n=>n.id===sourceId),targetProposed=after.nodes.find(n=>n.id===targetId);if(!sourceProposed)throw new Error('Merge starts from a proposed Idea; saved sources stay unchanged.');
  const graph=edges(plan,input.sources),sourceDocs=new Set(plan.uses.filter(u=>u.disposition==='retained'&&closure([u.ideaId],graph).has(sourceId)).map(u=>u.documentId)),targetDocs=new Set(plan.uses.filter(u=>u.disposition==='retained'&&closure([u.ideaId],graph).has(targetId)).map(u=>u.documentId));const different=[...sourceDocs].some(d=>!targetDocs.has(d))||[...targetDocs].some(d=>!sourceDocs.has(d));
  // Different compositions get an independent merged identity in source uses; destination-only uses stay unchanged.
  const independent=!targetProposed||different;const mergedId=independent?input.independentId:targetId;if(!mergedId||independent&&(all.has(mergedId)||plan.nodes.some(n=>n.id===mergedId)))throw new Error('This merge needs a new independent Idea identity.');
  const merged:ProposedNode={...copy(target),...copy(input.patch),id:mergedId,revision:independent?1:target.revision+1,disposition:'retained',sourceEvidence:[...source.sourceEvidence,...target.sourceEvidence,correctionEvidence(decisionId)],provenance:[...(target.provenance??[]),...target.sourceEvidence.filter(e=>e.kind==='existing')]};
  const mapping=new Map([[sourceId,mergedId],...(!independent?[[targetId,mergedId] as [string,string]]:[])]);merged.body=rewriteBody(merged.body,mapping,independent?`:${decisionId}`:'');if(correctionBodyTargetIds(merged.body).some(id=>id===mergedId||id===targetId||id===sourceId))throw new Error('The merged body cannot reference itself.');
  if(independent)after.nodes.push(merged);else after.nodes[after.nodes.findIndex(n=>n.id===targetId)]=merged;sourceProposed.disposition='merged';sourceProposed.mergedInto=mergedId;sourceProposed.revision++;
  for(const node of after.nodes.filter(retained)){const updated=rewriteBody(node.body,mapping);if(JSON.stringify(updated)!==JSON.stringify(node.body)){node.body=updated;node.revision++;}}
  for(const use of after.uses)if(use.disposition==='retained'&&use.ideaId===sourceId){use.ideaId=mergedId;use.revision++;use.dependencyManifest=[];}
  after.references=after.references.map(r=>({...r,fromId:mapping.get(r.fromId)??r.fromId,toId:mapping.get(r.toId)??r.toId})).filter(r=>r.fromId!==r.toId);
  if(independent)for(const documentId of sourceDocs)if(targetDocs.has(documentId))redirectLocalParents(after,documentId,targetId,mergedId,decisionId,input.sources);
  const dedupe=new Set<string>();for(const use of after.uses.filter(u=>u.disposition==='retained')){const key=`${use.documentId}:${use.ideaId}`;if(dedupe.has(key)){use.disposition='removed';use.revision++;}else dedupe.add(key);}
  const effects:CorrectionEffect[]=[{id:mergedId,nodeId:mergedId,kind:'record',before:`${sourceText(source)}\n\n${sourceText(target)}`,after:sourceText(merged),resolved:true,message:independent?'Create an independent merged Idea; preserve the original destination.':'Merge into the proposed destination.'}];
  for(const doc of new Set([...sourceDocs,...targetDocs]))effects.push({id:`${decisionId}:doc:${doc}`,documentId:doc,kind:'use',before:[sourceDocs.has(doc)?source.title:'',targetDocs.has(doc)?target.title:''].filter(Boolean).join(', '),after:sourceDocs.has(doc)?merged.title:target.title,resolved:!different||input.differentUsesAcknowledged,message:'Review the complete effect on this Document; its unrelated uses remain unchanged.'});
  after.coverage=after.coverage.map(c=>({...c,nodeIds:c.nodeIds.map(id=>id===sourceId?mergedId:id)}));return finish(plan,after,decisionId,'merge',[sourceId,targetId],effects);
}
export function previewPartialReuse(plan:CreationPlan,input:{source:CorrectionSource;decisionId:string;newId:string;patch:IdeaPatch;excerpt:string;documentId?:string}):CorrectionPreview{
  nodesWithSources(plan,[input.source]);if(plan.nodes.some(n=>n.id===input.newId)||input.newId===input.source.node.id)throw new Error('Partial reuse needs a new identity.');
  if(!input.excerpt.trim()||!sourceText(input.source.node).includes(input.excerpt))throw new Error('Select an exact excerpt from the source.');
  const evidence=input.source.node.sourceEvidence.filter(e=>e.kind==='existing');if(!evidence.length)throw new Error('Refresh the exact saved source revision before partial reuse.');
  const node:ProposedNode={...copy(input.source.node),...copy(input.patch),id:input.newId,revision:1,disposition:'retained',sourceEvidence:[correctionEvidence(input.decisionId)],provenance:evidence.map(e=>({...e,excerpt:input.excerpt}))};
  node.body=rewriteBody(node.body,new Map(),`:${input.decisionId}`);
  if(correctionBodyTargetIds(node.body).includes(input.source.node.id))throw new Error('A partial Idea must not include its full source.');
  const after=copy(plan);after.nodes.push(node);if(input.documentId)after.uses.push({id:`input:${input.decisionId}`,documentId:input.documentId,ideaId:node.id,order:after.uses.length,revision:1,disposition:'retained',dependencyManifest:[]});
  return finish(plan,after,input.decisionId,'partial',[node.id],[{id:node.id,nodeId:node.id,documentId:input.documentId,kind:'record',before:input.excerpt,after:sourceText(node),resolved:true,message:'Create an independent partial Idea; provenance does not include the source.'}]);
}
/** Undo is version-bound and cannot silently discard edits made after a correction. */
export function undoCreationCorrection(plan:CreationPlan,review:ReviewState,preview:CorrectionPreview,undoId:string){if(signature(plan)!==signature(preview.after))throw new Error('Undo later changes before undoing this correction.');const restored=copy(preview.before);restored.decisions.push({...copy(preview.after.decisions.at(-1)!),accepted:false},{id:undoId,kind:'undo',nodeIds:preview.changedNodeIds,revision:plan.draftRevision,accepted:true,undoOf:preview.id});const nextReview=copy(review);delete nextReview.finalApprovalHash;for(const id of preview.changedNodeIds)delete nextReview.nodes[id];for(const id of preview.changedUseIds)delete nextReview.uses[id];return{plan:restored,review:nextReview};}
/** Reanalysis must keep decision identity and may never restore a removed entity or covered source span. */
export function enforceCreationDecisionLedger(previous:CreationPlan,next:CreationPlan):string[]{
  const errors:string[]=[],undone=new Set(previous.decisions.filter(d=>d.kind==='undo'&&d.accepted).map(d=>d.undoOf));
  if(JSON.stringify(previous.decisions)!==JSON.stringify(next.decisions))errors.push('Reanalysis cannot add or change explicit user decisions.');
  for(const node of next.nodes.filter(retained))if(node.sourceEvidence.some(e=>e.kind==='correction'&&previous.decisions.some(d=>d.id===e.decisionId&&d.accepted))&&!previous.nodes.some(old=>old.id===node.id&&old.disposition==='retained'&&JSON.stringify([old.title,old.body,old.type,old.subtype])===JSON.stringify([node.title,node.body,node.type,node.subtype])))errors.push(`An existing correction does not authorize newly changed content in ${node.title}.`);
  for(const decision of previous.decisions.filter(d=>d.accepted&&!undone.has(d.id))){if(!next.decisions.some(d=>JSON.stringify(d)===JSON.stringify(decision)))errors.push(`Preserve explicit decision ${decision.id}.`);if(decision.kind!=='remove')continue;for(const node of next.nodes.filter(retained)){if(decision.nodeIds.includes(node.id))errors.push(`Removed content ${node.title} was reintroduced.`);for(const evidence of node.sourceEvidence)if(evidence.kind==='span'&&decision.sourceRanges?.some(r=>evidence.start<r.end&&evidence.end>r.start)&&!previous.nodes.some(old=>old.id===node.id&&old.disposition==='retained'&&JSON.stringify([old.title,old.body,old.type,old.subtype])===JSON.stringify([node.title,node.body,node.type,node.subtype])))errors.push(`Review the removed source content in ${node.title} before reintroducing it.`);}}
  return [...new Set(errors)];
}

/** Recoverable inverse patch in the protected ledger allows Undo after acknowledged draft reload. */
export function undoLastCreationCorrection(plan:CreationPlan,review:ReviewState,undoId:string){
  const decision=plan.decisions.at(-1);if(!decision?.accepted||!decision.detail)throw new Error('There is no latest correction to undo.');
  let record:{schemaVersion:number;afterSignature:string;undo:{nodes:ProposedNode[];addedNodeIds:string[];uses:ProposedUse[];addedUseIds:string[];references:CreationPlan['references'];coverage:CreationPlan['coverage']}};try{record=JSON.parse(decision.detail);}catch{throw new Error('This correction has no recoverable Undo.');}
  if(record.schemaVersion!==1||record.afterSignature!==undoSignature(plan))throw new Error('Undo later changes before undoing this correction.');
  const before=copy(plan),patch=record.undo;before.nodes=before.nodes.filter(n=>!patch.addedNodeIds.includes(n.id)).map(n=>patch.nodes.find(old=>old.id===n.id)??n);before.uses=before.uses.filter(u=>!patch.addedUseIds.includes(u.id)).map(u=>patch.uses.find(old=>old.id===u.id)??u);before.references=patch.references;before.coverage=patch.coverage;before.decisions.pop();
  const preview:CorrectionPreview={schemaVersion:1,id:decision.id,baseSignature:signature(before),before,after:plan,effects:[],changedNodeIds:[...patch.nodes.map(n=>n.id),...patch.addedNodeIds],changedUseIds:[...patch.uses.map(u=>u.id),...patch.addedUseIds],blockers:[]};
  return undoCreationCorrection(plan,review,preview,undoId);
}
/** Keep the inverse patch usable after trusted dependency hydration, without authorizing content edits. */
export function rebindCreationCorrectionUndo(before:CreationPlan,refreshed:CreationPlan):CreationPlan {
  const shape=(plan:CreationPlan)=>({...plan,nodes:plan.nodes.map(node=>({...node,sourceEvidence:node.sourceEvidence.filter(e=>e.kind!=='existing')})),uses:plan.uses.map(({dependencyManifest,...use})=>use)});
  if(JSON.stringify(shape(before))!==JSON.stringify(shape(refreshed)))throw new Error('Only trusted dependency bindings can refresh a correction Undo.');
  const next=copy(refreshed),decision=next.decisions.at(-1);if(!decision?.detail||!decision.accepted)return next;
  const record=JSON.parse(decision.detail);if(record.schemaVersion!==1||record.afterSignature!==undoSignature(before))throw new Error('Refresh the latest correction before rebinding its Undo.');
  record.afterSignature=undoSignature(next);decision.detail=JSON.stringify(record);return next;
}
