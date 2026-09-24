/** Bind explicit input identities to the reviewed graph independently of model prompts. */
import type {CreationDraft,CreationPlan,CreationIssue} from './creation.ts';
import {creationDocumentMarkers} from '../still/creation-input.ts';
import {ideaBodyReferences} from './idea-body.ts';
export function creationBindingIssues(draft:CreationDraft,plan:CreationPlan):CreationIssue[]{
 const issues:CreationIssue[]=[];
 const markers=creationDocumentMarkers(draft.workingDocument,{draftId:draft.id,projectId:draft.scope.projectId});
 const undone=new Set(draft.decisions.filter(d=>d.accepted&&d.kind==='undo').map(d=>d.undoOf));
 const active=draft.decisions.filter(d=>d.accepted&&!undone.has(d.id));
 const refs=plan.nodes.filter(n=>n.disposition==='retained'&&n.body).flatMap(n=>ideaBodyReferences(n.body!));
 for(const marker of markers){
  if(!marker.targetId)continue;
  const correction=active.find(d=>['remove','merge'].includes(d.kind)&&d.nodeIds.includes(marker.targetId!));
  const target=plan.nodes.find(n=>n.id===marker.targetId);
  const occurrence=refs.find(r=>r.occurrenceId===marker.id);
  let valid=correction?.kind==='remove'?!target||target.disposition==='removed':correction?.kind==='merge'?target?.disposition==='retained'||target?.disposition==='merged'&&plan.nodes.some(n=>n.id===target.mergedInto&&n.disposition==='retained'):marker.kind==='declaration'?target?.disposition==='retained':draft.referenceSelections.some(s=>s.rootIds.includes(marker.targetId!))&&(!plan.scope.documentId&&plan.entryKind==='idea'||plan.uses.some(u=>u.ideaId===marker.targetId&&u.disposition==='retained')||refs.some(r=>r.blockId===marker.targetId));
  if(occurrence&&occurrence.blockId!==(correction?.kind==='merge'?target?.mergedInto??marker.targetId:marker.targetId))valid=false;
  // A declaration may define its own node without a self-reference. If it is
  // used inline, retain the chosen occurrence rather than inventing a new one.
  const definition=marker.kind==='declaration'&&target?.sourceEvidence.some(e=>e.kind==='span'&&e.start<=marker.start&&e.end>=marker.end);
  if(!correction&&!definition&&refs.some(r=>r.blockId===marker.targetId)&&!occurrence)valid=false;
  if(!valid)issues.push({code:'selected_identity_changed',message:'Preserve each selected @ identity and occurrence, or explicitly remove or merge it in review.',nodeId:marker.targetId,blocking:true});
 }
 for(const partial of draft.partialIdeas?.filter(n=>n.disposition==='retained')??[]){
  const retained=plan.nodes.find(n=>n.id===partial.id&&n.disposition==='retained');
  if(!retained||!draft.plan&&JSON.stringify([retained.title,retained.body,retained.provenance])!==JSON.stringify([partial.title,partial.body,partial.provenance]))issues.push({code:'partial_identity_changed',message:'Preserve the reviewed independent excerpt and its provenance.',nodeId:partial.id,blocking:true});
  for(const source of partial.provenance??[])if(source.kind==='existing'&&!markers.some(m=>m.kind==='reference'&&m.targetId===source.blockId)&&(plan.uses.some(u=>u.disposition==='retained'&&u.ideaId===source.blockId)||refs.some(r=>r.blockId===source.blockId)))issues.push({code:'partial_includes_whole',message:'An independent excerpt must not include the whole saved source.',blocking:true});
 }
 return issues;
}
