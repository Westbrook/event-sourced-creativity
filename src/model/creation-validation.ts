import { blockTypeDefinition, isBlockIntent } from './block-types.ts';
import { canAttachProjectIdea, ideaDependencies, ideaUsedInDocument, isSemanticIdeaRelation, validateIdeaDependencyGraph } from './project-ideas.ts';
import { CREATION_LIMITS, type CreationAuthority, type CreationIssue, type CreationPlan, type ReviewState, type ProposedNode, type SourceEvidence, type CompiledCreation, type DependencyVersion } from './creation.ts';
import { classifyCreationInput, creationMarkers } from '../still/creation-input.ts';
import type { EventInput } from './events.ts';
import { decodeIdeaBody, ideaBodyText, ideaBodyReferences, remapIdeaBodyReferences } from './idea-body.ts';
import { validateFormatOutputPreferences } from './document-output-intent.ts';

export class CreationValidationError extends Error {
  constructor(public readonly issues:CreationIssue[]) { super(issues.map(issue=>issue.message).join(' ')); this.name='CreationValidationError'; }
}
export const creationEnvelopeBytes=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value)).byteLength;
const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,v])=>[key,canonical(v)])):value;
export async function creationHash(value:unknown):Promise<string>{return 'sha256:'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(canonical(value))))),b=>b.toString(16).padStart(2,'0')).join('');}
const retained=(plan:CreationPlan)=>plan.nodes.filter(node=>node.disposition==='retained');
function bodyTargets(node:ProposedNode):string[]{try{return node.body?ideaBodyReferences(node.body).map(ref=>ref.blockId):[];}catch{return [];}}
function targetIds(plan:CreationPlan,id:string):string[]{const node=plan.nodes.find(n=>n.id===id);return [...new Set([...(node?bodyTargets(node):[]),...plan.references.filter(r=>r.fromId===id).map(r=>r.toId)])];}
export function creationNodeComplete(node:ProposedNode):boolean {
  if(!node.title?.trim())return false;
  if(node.kind!=='idea')return true;
  const definition=node.type?blockTypeDefinition(node.type):undefined;
  if(!definition||node.subtype&&!definition.subtypes.includes(node.subtype))return false;
  try{return Boolean(node.body&&ideaBodyText(decodeIdeaBody(node.body)).trim());}catch{return false;}
}
/** Composition hashes include dependent content, not just revision counters supplied by clients. */
export async function creationReviewHashes(plan:CreationPlan,_authority?:CreationAuthority){
  void _authority; // Current source authorization is validated separately from portable review hashes.
  const nodes=retained(plan), byId=new Map(nodes.map(node=>[node.id,node]));
  const graph=(id:string,seen=new Set<string>()):unknown=>{
    if(seen.has(id))return {id,cycle:true};seen.add(id);
    const node=byId.get(id);if(!node)return {id,existing:true};
    const {revision:_revision,body,...semantic}=node;
    return {node:{...semantic,...(body?{body:{text:ideaBodyText(body),references:ideaBodyReferences(body)}}:{})},dependencies:targetIds(plan,id).map(target=>graph(target,new Set(seen)))};
  };
  const useHashes:Record<string,string>={};
  for(const use of plan.uses.filter(use=>use.disposition==='retained'))useHashes[use.id]=await creationHash({use:{...use,revision:undefined},content:graph(use.ideaId)});
  const nodeHashes:Record<string,string>={};
  for(const node of nodes){
    const uses=plan.uses.filter(use=>use.disposition==='retained'&&(node.kind==='document'?use.documentId===node.id:node.kind==='idea'?use.ideaId===node.id:false)).map(use=>[use.id,useHashes[use.id]]);
    // Project approval includes its actual organization, not unreviewed hidden children.
    nodeHashes[node.id]=await creationHash({content:graph(node.id),uses,organization:node.kind==='project'?{nodes:nodes.filter(n=>n.id!==node.id).map(n=>graph(n.id)),uses:useHashes}:undefined});
  }
  const approvalHash=await creationHash({schemaVersion:plan.schemaVersion,draftId:plan.draftId,sourceText:plan.sourceText,scope:plan.scope,nodeHashes,useHashes,coverage:plan.coverage,decisions:plan.decisions,references:plan.references,modelVersion:plan.modelVersion});
  return {nodeHashes,useHashes,approvalHash};
}
const safeId=(id:unknown):id is string=>typeof id==='string'&&id.length>0&&id.length<=120&&!['__proto__','prototype','constructor'].includes(id)&&!Array.from(id).some(char=>char.charCodeAt(0)<32);
const versionEqual=(a:DependencyVersion,b:DependencyVersion)=>a.id===b.id&&a.projectId===b.projectId&&a.revision===b.revision&&a.hash===b.hash;
const issue=(code:string,message:string,nodeId?:string,useId?:string):CreationIssue=>({code,message,blocking:true,...(nodeId?{nodeId}:{}),...(useId?{useId}:{})});
export function exactTitleOnlyPlan(plan:CreationPlan):boolean {
  const nodes=retained(plan);return plan.titleOnly===true&&plan.entryKind!=='idea'&&nodes.length===1&&nodes[0]!.kind===plan.entryKind&&nodes[0]!.title===plan.sourceText&&!creationMarkers(plan.sourceText).length&&(classifyCreationInput(plan.sourceText)==='title'||plan.decisions.some(d=>d.accepted&&d.kind==='correction'&&d.detail==='explicit-title-classification'))&&!plan.uses.length&&!plan.references.length&&!nodes[0]!.body;
}
/** Server validation requires live authorized facts. Source evidence proves attribution, not semantic fidelity. */
async function validateCreationPlanInternal(plan:CreationPlan,authority:CreationAuthority,review?:ReviewState,options:{requireReview?:boolean;requireAllocation?:boolean}={}){
  const issues:CreationIssue[]=[];
  if(!plan||typeof plan!=='object'||plan.schemaVersion!==1||!Array.isArray(plan.nodes)||!Array.isArray(plan.uses)||!Array.isArray(plan.references)||!Array.isArray(plan.coverage)||!Array.isArray(plan.decisions)||!Array.isArray(plan.issues)||!plan.scope||typeof plan.sourceText!=='string')return {issues:[issue('invalid_schema','The creation proposal has an unsupported shape.')],nodeHashes:{},useHashes:{},approvalHash:''};
  if(plan.decisions.some(d=>!d||!safeId(d.id)||!['remove','merge','keep-together','variation','partial','correction','undo'].includes(d.kind)||!Array.isArray(d.nodeIds)||d.nodeIds.some(id=>!safeId(id))||!Number.isSafeInteger(d.revision)||typeof d.accepted!=='boolean'))return {issues:[issue('invalid_schema','The correction ledger has an unsupported shape.')],nodeHashes:{},useHashes:{},approvalHash:''};
  if(creationEnvelopeBytes({plan,...(review?{review}:{})})>CREATION_LIMITS.envelopeBytes)issues.push(issue('envelope_too_large','This draft exceeds 1,000,000 bytes. Reduce it before saving.'));
  if(!Number.isSafeInteger(plan.draftRevision)||plan.draftRevision<0||!safeId(plan.draftId))issues.push(issue('invalid_revision','The draft revision is invalid.'));
  if(plan.scope.actorUserId!==authority.actorUserId||plan.scope.custodyKey!==authority.custodyKey||plan.scope.permissionEpoch!==authority.permissionEpoch||plan.scope.projectId!==authority.projectId)issues.push(issue('authority_changed','The destination or access changed. Refresh this draft.'));
  if(!['project','document','idea'].includes(plan.entryKind))issues.push(issue('invalid_entry','Choose a supported creation entry.'));
  if(plan.entryKind==='project'?!authority.canCreateProject||authority.projectId!==null:!authority.canAuthorProject||!authority.projectId)issues.push(issue('scope_denied','Creation is not allowed in this Project.'));
  if(plan.scope.documentId&&(!authority.documentIds.includes(plan.scope.documentId)||plan.entryKind!=='idea'))issues.push(issue('destination_denied','The destination Document is unavailable.'));
  const nodes=retained(plan), byId=new Map(plan.nodes.map(node=>[node.id,node])), liveIds=new Set(nodes.map(node=>node.id));
  const projectNodes=nodes.filter(n=>n.kind==='project'),documents=nodes.filter(n=>n.kind==='document');
  if(plan.entryKind==='project'?projectNodes.length!==1:projectNodes.length!==0)issues.push(issue('project_root','New Project requires exactly one retained new Project.'));
  if(plan.entryKind==='idea'&&documents.length)issues.push(issue('entry_scope','New Idea cannot create a Document.'));
  if(plan.entryKind==='document'&&!documents.length&&!plan.decisions.some(d=>d.accepted&&d.kind==='remove'&&d.nodeIds.some(id=>byId.get(id)?.kind==='document')))issues.push(issue('document_required','Review a proposed Document or explicitly remove it.'));
  const projectId=plan.entryKind==='project'?projectNodes[0]?.id:authority.projectId;
  const occurrences=new Set<string>();
  const ids=new Set<string>(), allocated=new Set<string>(), existing=new Map(authority.existingBlocks.filter(b=>!b.removed).map(b=>[b.id,b]));
  const selectedIds=new Set(ideaDependencies(authority.selectedRootIds??[],authority.existingBlocks,authority.existingRelations).map(b=>b.id));
  const currentVersions=new Map(authority.existingVersions.map(v=>[v.id,v]));
  const validEvidence=(e:SourceEvidence):boolean=>{
    if(!e||typeof e!=='object')return false;
    if(e.kind==='span')return Number.isSafeInteger(e.start)&&Number.isSafeInteger(e.end)&&e.start>=0&&e.end>e.start&&e.end<=plan.sourceText.length&&plan.sourceText.slice(e.start,e.end)===e.quote;
    if(e.kind==='correction')return plan.decisions.some(d=>d.id===e.decisionId&&d.accepted&&d.kind!=='undo');
    if(e.kind==='existing'){const version=currentVersions.get(e.blockId);return Boolean(version&&selectedIds.has(e.blockId)&&e.projectId===projectId&&version.projectId===e.projectId&&version.revision===e.revision&&version.hash===e.hash&&existing.has(e.blockId));}
    return false;
  };
  for(const node of plan.nodes){
    if(!safeId(node.id)||ids.has(node.id))issues.push(issue('duplicate_identity','Every proposal needs a unique identity.',node.id));ids.add(node.id);
    if(!['project','document','idea'].includes(node.kind)||!['retained','merged','removed'].includes(node.disposition)||!Number.isSafeInteger(node.revision)||node.revision<1)issues.push(issue('invalid_node','A proposal has an invalid kind, disposition or revision.',node.id));
    if(node.disposition!=='retained'){
      if(!plan.decisions.some(d=>d.accepted&&d.nodeIds.includes(node.id)&&(node.disposition==='removed'?d.kind==='remove':d.kind==='merge')))issues.push(issue('unconfirmed_disposition','Removal or merge requires an explicit accepted decision.',node.id));
      if(node.disposition==='merged'&&(!node.mergedInto||!liveIds.has(node.mergedInto)||byId.get(node.mergedInto)?.kind!=='idea'))issues.push(issue('invalid_merge','A merged proposal needs its retained destination.',node.id));
      continue;
    }
    if(node.projectId!==projectId)issues.push(issue('cross_project','Content cannot be adopted across Projects.',node.id));
    if(!creationNodeComplete(node))issues.push(issue('incomplete_node','Complete the title, semantic body and supported Idea type.',node.id));
    if(!Array.isArray(node.sourceEvidence)||!node.sourceEvidence.length||!node.sourceEvidence.every(validEvidence))issues.push(issue('invalid_evidence','Review exact supplied source or an explicit correction for this proposal.',node.id));
    if(node.provenance&&!node.provenance.every(validEvidence))issues.push(issue('invalid_provenance','Partial-source provenance is stale or unauthorized.',node.id));
    if(node.intent&&!isBlockIntent(node.intent))issues.push(issue('invalid_intent','Choose a supported Idea intent.',node.id));
    if(node.kind==='idea'&&node.body){
      try{
        const body=decodeIdeaBody(node.body),text=ideaBodyText(body);
        if(plan.entryKind==='idea'&&nodes.length===1&&classifyCreationInput(plan.sourceText,creationMarkers(plan.sourceText))==='title'&&text===plan.sourceText&&!node.sourceEvidence.some(e=>e.kind==='correction'||e.kind==='existing'))issues.push(issue('title_body_requires_completion','A title alone is not an Idea body. Supply or explicitly confirm its intended content and type.',node.id));
        if(node.text!==undefined&&node.text!==text)issues.push(issue('body_projection','The readable body and structured body must agree.',node.id));
        for(const ref of ideaBodyReferences(body)){if(occurrences.has(ref.occurrenceId))issues.push(issue('duplicate_occurrence','Every reference occurrence needs a unique identity.',node.id));occurrences.add(ref.occurrenceId);if(ref.projectId!==projectId)issues.push(issue('cross_project_reference','Reference targets must belong to this Project.',node.id));}
      }catch{issues.push(issue('invalid_body','Use the compatible Idea editor to repair this body.',node.id));}
    }
    if(node.preferredOutputKinds?.length){
      const result=validateFormatOutputPreferences({type:node.type??'',properties:{text:node.body?ideaBodyText(node.body):'',subtype:node.subtype,intent:node.intent,preferred_output_kinds:node.preferredOutputKinds}});
      if(!result.valid)issues.push(issue('invalid_preferences','Reconcile the visible supported Format preferences before saving.',node.id));
    }
    if(options.requireAllocation!==false){const id=authority.allocatedIds[node.id];if(!safeId(id)||allocated.has(id)||authority.occupiedIds.includes(id))issues.push(issue('allocated_identity','Canonical identities must be allocated once and unused.',node.id));if(id)allocated.add(id);}
  }
  for(const ref of plan.references){
    if(!safeId(ref.id)||ids.has(ref.id)||!liveIds.has(ref.fromId)||byId.get(ref.fromId)?.kind!=='idea'||ref.kind!=='semantic'||!ref.sourceEvidence?.length||!ref.sourceEvidence.every(validEvidence))issues.push(issue('invalid_relationship','A relationship requires a unique identity, retained Idea and valid source evidence.',ref.fromId));
    ids.add(ref.id);
    if(options.requireAllocation!==false){const id=authority.allocatedIds[ref.id];if(!safeId(id)||allocated.has(id)||authority.occupiedIds.includes(id))issues.push(issue('allocated_identity','Relationship identities must be allocated once and unused.',ref.fromId));if(id)allocated.add(id);}
  }
  const dependencyVersions=(rootId:string):DependencyVersion[]=>{
    const result=new Map<string,DependencyVersion>(),visited=new Set<string>(),active=new Set<string>();
    const visit=(id:string)=>{
      if(active.has(id)){issues.push(issue('dependency_cycle','Resolve the circular Idea dependency.',id));return;}if(visited.has(id))return;visited.add(id);active.add(id);
      const node=byId.get(id);
      if(node){if(node.kind!=='idea'||node.disposition!=='retained')issues.push(issue('unavailable_reference','A referenced proposal is unavailable.',id));else for(const next of targetIds(plan,id))visit(next);}
      else {
        const block=existing.get(id);
        if(plan.entryKind==='project'||!selectedIds.has(id)||!block||block.projectId!==projectId||!canAttachProjectIdea(block)){issues.push(issue('reference_denied','A referenced Idea is unavailable or outside this Project.',id));active.delete(id);return;}
        const closure=ideaDependencies([id],authority.existingBlocks,authority.existingRelations);
        const graphIssue=validateIdeaDependencyGraph(closure,authority.existingRelations);if(graphIssue)issues.push(issue(graphIssue.code,graphIssue.message,graphIssue.blockId));
        for(const dependency of closure){
          const v=currentVersions.get(dependency.id);if(dependency.projectId!==projectId||!canAttachProjectIdea(dependency)||!v)issues.push(issue('dependency_denied','A shared dependency is unavailable or unauthorized.',dependency.id));else result.set(v.id,v);
        }
        // Missing generic targets and cycles cannot be hidden by tolerant legacy projection.
        if(block.properties.rich_text_body){try{for(const ref of ideaBodyReferences(decodeIdeaBody(block.properties.rich_text_body)))visit(ref.blockId);}catch{issues.push(issue('invalid_existing_body','A referenced Idea needs a compatible body before reuse.',id));}}
        for(const relation of authority.existingRelations.filter(r=>!r.removed&&r.fromBlockId===id&&isSemanticIdeaRelation(r.kind)))visit(relation.toBlockId);
      }
      active.delete(id);
    };visit(rootId);return [...result.values()].sort((a,b)=>a.id.localeCompare(b.id));
  };
  for(const node of nodes.filter(node=>node.kind==='idea'))for(const version of dependencyVersions(node.id)){
    if(!node.sourceEvidence.some(e=>e.kind==='existing'&&e.blockId===version.id&&e.revision===version.revision&&e.hash===version.hash))issues.push(issue('unbound_dependency','Disclose the exact shared dependency content before reviewing this Idea.',node.id));
  }
  const useIds=new Set<string>(),usePairs=new Set<string>();
  for(const use of plan.uses){
    if(!safeId(use.id)||useIds.has(use.id)||ids.has(use.id))issues.push(issue('duplicate_use','Every reviewed use needs a unique identity.',undefined,use.id));useIds.add(use.id);
    if(use.disposition==='removed'){if(!plan.decisions.some(d=>d.accepted&&['remove','merge','variation'].includes(d.kind)&&d.nodeIds.some(id=>[use.id,use.ideaId,use.documentId].includes(id))))issues.push(issue('unconfirmed_disposition','Removing a use requires an explicit accepted correction.',undefined,use.id));continue;}
    if(use.disposition!=='retained'||!Number.isSafeInteger(use.revision)||use.revision<1||!Number.isSafeInteger(use.order)||use.order<0)issues.push(issue('invalid_use','The composition use is invalid.',undefined,use.id));
    const destination=byId.get(use.documentId),allowed=destination?.kind==='document'&&destination.disposition==='retained'||plan.entryKind==='idea'&&plan.scope.documentId===use.documentId&&authority.documentIds.includes(use.documentId);
    if(!allowed)issues.push(issue('use_destination','A use must target the reviewed Document destination.',undefined,use.id));
    const pair=use.documentId+'\0'+use.ideaId;if(usePairs.has(pair))issues.push(issue('duplicate_membership','An Idea is included only once per Document.',undefined,use.id));usePairs.add(pair);
    const versions=dependencyVersions(use.ideaId),manifest=use.dependencyManifest;
    if(!Array.isArray(manifest)||manifest.length!==versions.length||versions.some(v=>!manifest.some(m=>versionEqual(v,m))))issues.push(issue('source_changed','Shared content or dependencies changed. Refresh and review this composition.',undefined,use.id));
  }
  const covered=new Uint8Array(plan.sourceText.length);
  for(const coverage of plan.coverage){
    const decision=coverage.decisionId&&plan.decisions.find(d=>d.id===coverage.decisionId&&d.accepted);
    if(!Number.isSafeInteger(coverage.start)||!Number.isSafeInteger(coverage.end)||coverage.start<0||coverage.end<=coverage.start||coverage.end>covered.length||(!decision&&!coverage.nodeIds.some(id=>liveIds.has(id)||selectedIds.has(id)))){issues.push(issue('invalid_coverage','Supplied content needs retained content or an explicit correction.'));continue;}
    covered.fill(1,coverage.start,coverage.end);
  }
  for(let i=0;i<covered.length;i++)if(!covered[i]&&/[\p{L}\p{N}]/u.test(plan.sourceText[i]!)){issues.push(issue('uncovered_source','Some supplied content is not accounted for. Review omissions or remove it explicitly.'));break;}
  // Reanalysis anti-reintroduction compares with the trusted previous plan via
  // enforceCreationDecisionLedger; overlapping scene evidence alone is not removal.
  issues.push(...plan.issues.filter(i=>i.blocking));
  const eventCount=nodes.length+plan.uses.filter(u=>u.disposition==='retained'&&!creationUseAlreadyAttached(u,authority)).length+plan.references.length;
  if(eventCount>CREATION_LIMITS.compiledEvents||!Number.isSafeInteger(plan.compiledEventBound)||plan.compiledEventBound<eventCount||plan.compiledEventBound>CREATION_LIMITS.compiledEvents)issues.push(issue('event_limit','The reviewed graph exceeds its 512-event bound.'));
  const hashes=await creationReviewHashes(plan);
  if(options.requireReview!==false&&!exactTitleOnlyPlan(plan)){
    if(!review||review.schemaVersion!==1)issues.push(issue('review_required','Present and approve this creation before saving.'));
    else {
      for(const node of nodes){const entry=review.nodes[node.id],hash=hashes.nodeHashes[node.id];if(!entry?.complete||entry.presentedHash!==hash||entry.approvedHash!==hash)issues.push(issue('node_not_approved','Every retained record must be complete, presented and approved at its current version.',node.id));}
      for(const use of plan.uses.filter(use=>use.disposition==='retained')){const entry=review.uses[use.id],hash=hashes.useHashes[use.id];if(!entry?.complete||entry.presentedHash!==hash||entry.approvedHash!==hash)issues.push(issue('use_not_approved','Review and approve every current Document use.',undefined,use.id));}
      if(review.finalApprovalHash!==hashes.approvalHash)issues.push(issue('final_approval_required','Confirm the complete current creation graph.'));
    }
  }
  return {issues,...hashes};
}
/** Malformed untrusted proposal members become a recoverable validation result. */
export async function validateCreationPlan(plan:CreationPlan,authority:CreationAuthority,review?:ReviewState,options:{requireReview?:boolean;requireAllocation?:boolean}={}){
  try{return await validateCreationPlanInternal(plan,authority,review,options);}
  catch{return {issues:[issue('invalid_schema','The creation proposal has an unsupported shape. Keep the draft and retry or complete it manually.')],nodeHashes:{},useHashes:{},approvalHash:''};}
}
/** Refresh only already selected roots; callers must present changed bindings and renew approvals. */
export function refreshCreationDependencyBindings(plan:CreationPlan,authority:CreationAuthority):CreationPlan {
  const copy=structuredClone(plan),nodes=new Map(copy.nodes.map(n=>[n.id,n]));
  const selected=new Set(ideaDependencies(authority.selectedRootIds??[],authority.existingBlocks,authority.existingRelations).map(b=>b.id));
  const versions=new Map(authority.existingVersions.map(v=>[v.id,v]));
  const dependencies=(id:string,seen=new Set<string>()):DependencyVersion[]=>{
    if(seen.has(id))return [];seen.add(id);
    const node=nodes.get(id);if(node)return targetIds(copy,id).flatMap(target=>dependencies(target,seen));
    if(!selected.has(id))throw new Error('Choose this existing Idea explicitly before using it.');
    return ideaDependencies([id],authority.existingBlocks,authority.existingRelations).map(block=>{const v=versions.get(block.id);if(!v)throw new Error('A selected dependency is unavailable.');return v;});
  };
  const unique=(rows:DependencyVersion[])=>[...new Map(rows.map(row=>[row.id,row])).values()].sort((a,b)=>a.id.localeCompare(b.id));
  for(const use of copy.uses.filter(u=>u.disposition==='retained'))use.dependencyManifest=unique(dependencies(use.ideaId));
  for(const node of copy.nodes.filter(n=>n.kind==='idea'&&n.disposition==='retained')){const bound=unique(dependencies(node.id));node.sourceEvidence=[...node.sourceEvidence.filter(e=>e.kind!=='existing'),...bound.map(v=>({kind:'existing' as const,blockId:v.id,projectId:v.projectId,revision:v.revision,hash:v.hash}))];}
  return copy;
}
/** Explicit memberships are idempotent; an inherited dependency is not an independent root use. */
export function creationUseAlreadyAttached(use:{documentId:string;ideaId:string},authority:CreationAuthority):boolean {
  const existing=authority.existingBlocks.find(block=>block.id===use.ideaId&&!block.removed&&block.projectId===authority.projectId);
  return Boolean(existing&&ideaUsedInDocument(existing,use.documentId));
}
export async function compileCreationPlan(plan:CreationPlan,authority:CreationAuthority,review?:ReviewState):Promise<CompiledCreation>{
  const validation=await validateCreationPlan(plan,authority,review);if(validation.issues.length)throw new CreationValidationError(validation.issues);
  const nodes=retained(plan),idMap={...authority.allocatedIds},id=(value:string)=>idMap[value]??value;
  const projectId=plan.entryKind==='project'?id(nodes.find(n=>n.kind==='project')!.id):authority.projectId!;
  const events:EventInput[]=[];
  for(const node of nodes.filter(n=>n.kind==='project'))events.push({type:'ProjectCreated',payload:{project_id:id(node.id),name:node.title,state:'active'}});
  for(const node of nodes.filter(n=>n.kind==='document'))events.push({type:'DocumentCreated',payload:{project_id:projectId,document_id:id(node.id),title:node.title,handle:node.title}});
  for(const node of nodes.filter(n=>n.kind==='idea')){
    const body=remapIdeaBodyReferences(node.body!,new Map([...authority.existingBlocks.map(b=>[b.id,b.id] as [string,string]),...Object.entries(idMap)]),projectId);
    events.push({type:'BlockCreated',payload:{project_id:projectId,block_id:id(node.id),scope:'library',project_owned:true,type:node.type,handle:node.title,position:'a'+String(events.length).padStart(8,'0'),properties:{text:ideaBodyText(body),rich_text_body:body,...(node.subtype?{subtype:node.subtype}:{}),...(node.intent?{intent:node.intent}:{}),...(node.preferredOutputKinds?{preferred_output_kinds:node.preferredOutputKinds}:{})}}});
  }
  for(const ref of plan.references)events.push({type:'BlockRelationAdded',payload:{project_id:projectId,relation_id:id(ref.id),from_block_id:id(ref.fromId),to_block_id:id(ref.toId),kind:'idea_reference'}});
  const changedUses=plan.uses.filter(u=>u.disposition==='retained'&&!creationUseAlreadyAttached(u,authority)).map(u=>({documentId:id(u.documentId),ideaId:id(u.ideaId)}));
  for(const use of plan.uses.filter(u=>u.disposition==='retained'&&!creationUseAlreadyAttached(u,authority)).sort((a,b)=>a.order-b.order))events.push({type:'BlockDocumentAttached',payload:{project_id:projectId,document_id:id(use.documentId),block_id:id(use.ideaId),position:'a'+String(use.order).padStart(8,'0')}});
  return {status:events.length?'ready':'no-change',changedUses,events,idMap,projectId,primaryDocumentId:nodes.find(n=>n.kind==='document')?id(nodes.find(n=>n.kind==='document')!.id):plan.scope.documentId,...{approvalHash:validation.approvalHash,nodeHashes:validation.nodeHashes,useHashes:validation.useHashes}};
}
