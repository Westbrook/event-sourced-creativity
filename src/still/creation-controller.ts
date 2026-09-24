import type { CreationDraft, CreationEntryKind, CreationScope, CreationPlan, ReviewState, ProposedNode, CreationReceipt, CreationIssue, ReferenceSelection, Decision } from '../model/creation.ts';
import { creationReviewHashes, creationNodeComplete } from '../model/creation-validation.ts';
import { richDocumentText, richDocumentFromRuns } from './vendor/elements/rich-document.js';
import { classifyCreationInput, creationDocumentMarkers, markerScopeProblem } from './creation-input.ts';
import type { CreativeBlock } from '../model/events.ts';
import type { CreationSearchResponse } from '../model/creation-search.ts';

type Document = CreationDraft['workingDocument'];
type Request = <T>(path:string,body?:unknown,method?:string,signal?:AbortSignal)=>Promise<T>;
type Hashes = {nodeHashes:Record<string,string>;useHashes:Record<string,string>;approvalHash:string};
export const creationText=(document:Document):string=>richDocumentText(document);
export const creationDocument=(text:string):Document=>richDocumentFromRuns([{kind:'text',text}]);
export type CreationFailureKind='conflict'|'access'|'expired'|'size'|'organizer'|'network'|'other';
export function creationFailure(error:unknown):{kind:CreationFailureKind;message:string}{
  const value=error as {body?:{error?:string};status?:number;message?:string};const code=value?.body?.error??value?.message??'';
  if(/creation[_ ]revision[_ ]conflict/u.test(code))return {kind:'conflict',message:'This draft changed in another tab. Your latest text is still here. Copy your text, then reload the saved draft.'};
  if(value?.status===401||value?.status===403||/creation[_ ](?:scope[_ ]denied|source[_ ]unavailable)/u.test(code))return {kind:'access',message:'Access to this draft is unavailable. Your latest text is still here. Restore access and retry, or copy your text before leaving.'};
  if(/creation[_ ]draft[_ ](?:unavailable|expired)/u.test(code))return {kind:'expired',message:'This saved draft expired or is no longer available. Copy your latest text before leaving, then start a new draft.'};
  if(value?.status===413||/creation[_ ](?:payload[_ ]too[_ ]large|envelope[_ ]too[_ ]large)/u.test(code))return {kind:'size',message:'This draft is too large to save. Copy your text, then shorten the draft and try again.'};
  if(/creation[_ ]interpretation[_ ]unavailable/u.test(code))return {kind:'organizer',message:'Organization is unavailable. Your full input is kept. Retry or complete one Idea manually.'};
  return {kind:'other',message:`${error instanceof Error?error.message:'This step was interrupted.'} Your latest text is still here. Retry or copy it before leaving.`};
}
const emptyReview=():ReviewState=>({schemaVersion:1,nodes:{},uses:{},stage:'ideas',lastAcknowledgedRevision:0});
export class CreationController {
  draft:CreationDraft;
  busy=false;error='';failureKind?:CreationFailureKind;private saveBlock?:{kind:CreationFailureKind;message:string};status='';hashes:Hashes={nodeHashes:{},useHashes:{},approvalHash:''};issues:CreationIssue[]=[];
  search?:CreationSearchResponse;searchFailure='';private searchFocus=false;private searchPointer=false;private pendingSearch?:{response:CreationSearchResponse;ticket:number;revision:number;version:number};
  get searchFrozen(){return this.searchFocus||this.searchPointer;}
  get searchStale(){return !!this.search&&(this.search.queryRevision!==this.queryRevision||this.search.draftRevision!==this.draft.revision||!!this.searchFailure);}
  setSearchInteraction(kind:'focus'|'pointer',active:boolean){if(kind==='focus')this.searchFocus=active;else this.searchPointer=active;if(this.searchFrozen)return;const pending=this.pendingSearch;this.pendingSearch=undefined;if(pending&&!this.disposed&&pending.ticket===this.queryRevision&&pending.revision===this.draft.revision&&pending.version===this.localVersion){this.search=pending.response;this.searchFailure='';this.notify();}}
  sourceBodies:CreativeBlock[]=[];dependencyManifests:Record<string,import('../model/creation.ts').DependencyVersion[]>={};
  split?:{nodeId:string;semanticVersion:string;contextVersion:string;suggestSplit?:boolean;status:string};
  splitOptions?:CreationPlan;private splitTimer?:ReturnType<typeof setTimeout>;private splitTicket=0;
  private frozenOriginal=false;private pendingReferenceIds=new Set<string>();
  private classificationOverride?:'title'|'description';
  private localVersion=1;private acknowledgedVersion=0;private savedRevision=0;private saveFlight?:Promise<void>;private saveTimer?:ReturnType<typeof setTimeout>;private searchAbort?:AbortController;private composing=false;private searchTimer?:ReturnType<typeof setTimeout>;private queryRevision=0;private hashTicket=0;private disposed=false;private started=false;
  private operationId='';private preview?:{operationId:string;approvalHash:string};
  receipt?:CreationReceipt;
  noChange?:{projectId:string;documentId:string|null;blockId?:string};
  readonly key:string;
  constructor(private options:{entryKind:CreationEntryKind;scope:CreationScope;request:Request;onChange:()=>void;storage?:Pick<Storage,'getItem'|'setItem'|'removeItem'>}){
    this.draft={schemaVersion:1,id:crypto.randomUUID(),scope:options.scope,entryKind:options.entryKind,revision:1,originalDocument:creationDocument(''),workingDocument:creationDocument(''),markers:[],acknowledgedRevision:0,referenceSelections:[],decisions:[],expiresAt:'',state:'editing'};
    this.key=`still.creation.v1:${options.scope.actorUserId}:${options.scope.custodyKey}:${options.scope.projectId??''}:${options.scope.documentId??''}:${options.entryKind}`;
  }
  private get storage(){return this.options.storage??(typeof localStorage!=='undefined'?localStorage:undefined);}
  private notify(){if(!this.disposed)this.options.onChange();}
  private path(suffix=''){return `/api/still/creation/drafts/${encodeURIComponent(this.draft.id)}${suffix}`;}
  get plan(){return this.draft.plan;}
  get review(){return this.draft.review??=emptyReview();}
  get text(){return creationText(this.draft.workingDocument);}
  get classification(){return this.classificationOverride??classifyCreationInput(this.text,this.draft.markers);}
  get currentStage(){return this.review.stage;}
  get stages():ReviewState['stage'][] {
    const plan=this.plan;if(!plan)return [];
    return [...(plan.nodes.some(n=>n.disposition==='retained'&&n.kind==='idea')?['ideas' as const]:[]),...(plan.nodes.some(n=>n.disposition==='retained'&&n.kind==='document')||plan.uses.some(u=>u.disposition==='retained')?['documents' as const]:[]),...(plan.nodes.some(n=>n.disposition==='retained'&&n.kind==='project')?['project' as const]:[])];
  }
  get stageItems(){
    const plan=this.plan;if(!plan)return [];
    const kind=this.currentStage==='ideas'?'idea':this.currentStage==='documents'?'document':'project';
    const result=plan.nodes.filter(n=>n.kind===kind&&n.disposition==='retained').map(node=>({id:node.id,title:node.title,kind:node.kind,node:node as ProposedNode|undefined,uses:plan.uses.filter(u=>u.disposition==='retained'&&(kind==='idea'?u.ideaId===node.id:kind==='document'?u.documentId===node.id:true))}));
    if(kind==='document')for(const id of new Set(plan.uses.filter(u=>u.disposition==='retained').map(u=>u.documentId)))if(!result.some(n=>n.id===id))result.push({id,title:'Attach to existing Document',kind:'document',node:undefined,uses:plan.uses.filter(u=>u.disposition==='retained'&&u.documentId===id)});
    return result;
  }
  get currentId(){return this.review.currentId??this.stageItems[0]?.id??'';}
  get currentItem(){return this.stageItems.find(n=>n.id===this.currentId)??this.stageItems[0];}
  get retained(){return this.plan?.nodes.filter(n=>n.disposition==='retained')??[];}
  get allSeen(){return !!this.plan&&this.retained.every(n=>this.review.nodes[n.id]?.presentedHash===this.hashes.nodeHashes[n.id]&&!!this.hashes.nodeHashes[n.id])&&this.plan.uses.filter(u=>u.disposition==='retained').every(u=>this.review.uses[u.id]?.presentedHash===this.hashes.useHashes[u.id]&&!!this.hashes.useHashes[u.id]);}
  get eligible(){return this.allSeen&&!this.issues.some(i=>i.blocking)&&this.retained.every(n=>creationNodeComplete(n)&&this.review.nodes[n.id]?.approvedHash===this.hashes.nodeHashes[n.id])&&this.plan!.uses.filter(u=>u.disposition==='retained').every(u=>this.review.uses[u.id]?.complete&&this.review.uses[u.id]?.approvedHash===this.hashes.useHashes[u.id]);}
  get pendingCount(){return this.retained.filter(n=>!creationNodeComplete(n)||this.review.nodes[n.id]?.approvedHash!==this.hashes.nodeHashes[n.id]).length+(this.plan?.uses.filter(u=>u.disposition==='retained'&&this.review.uses[u.id]?.approvedHash!==this.hashes.useHashes[u.id]).length??0);}
  get hasUnacknowledgedChanges(){return this.acknowledgedVersion!==this.localVersion;}
  setComposing(value:boolean){this.composing=value;if(value){clearTimeout(this.searchTimer);this.searchAbort?.abort();this.queryRevision++;}else this.scheduleSearch();}
  get canRetry(){return !this.saveBlock;}
  get canCompleteManually(){return this.failureKind==='organizer'&&!this.saveBlock;}
  setError(message:string){this.error=message;this.failureKind=undefined;this.notify();}
  reportFailure(error:unknown){const failure=this.saveBlock??creationFailure(error);this.failureKind=failure.kind;this.error=failure.message;if(failure.kind==='conflict'||failure.kind==='expired')this.saveBlock=failure;this.notify();}
  setClassification(value:'title'|'description'){this.classificationOverride=value;if(value==='title')this.draft.decisions.push({id:crypto.randomUUID(),kind:'correction',nodeIds:[],revision:this.draft.revision,accepted:true,detail:'explicit-title-classification'});this.touch();}
  async start(){
    try{const journal=this.storage?.getItem(this.key+':operation');if(journal){const saved=JSON.parse(journal) as {draftId:string;operationId:string;approvalHash:string};this.draft.id=saved.draftId;this.preview={operationId:saved.operationId,approvalHash:saved.approvalHash};const result=await this.options.request<{receipt?:CreationReceipt}>(this.path(`/operations/${encodeURIComponent(saved.operationId)}`));if(result.receipt){this.receipt=result.receipt;this.draft.state='saved';this.status='Saved';this.notify();return;}}const id=this.storage?.getItem(this.key);if(id){const result=await this.options.request<{draft:CreationDraft}>(`/api/still/creation/drafts/${encodeURIComponent(id)}`);this.draft=result.draft;this.frozenOriginal=!!this.draft.plan||!!this.draft.decisions.length;this.savedRevision=this.draft.revision;this.acknowledgedVersion=this.localVersion;this.started=true;this.status='Draft saved';if(this.plan)await this.refreshHashes();}}
    catch(error){this.error=`Saved draft could not be opened. ${error instanceof Error?error.message:''}`;}
    this.notify();
  }
  changeDocument(document:Document){
    this.draft.workingDocument=structuredClone(document);if(!this.frozenOriginal)this.draft.originalDocument=structuredClone(document);this.draft.markers=creationDocumentMarkers(document,{draftId:this.draft.id,projectId:this.draft.scope.projectId},this.draft.markers);
    this.pendingReferenceIds.clear();
    for(const marker of this.draft.markers)if(marker.kind==='reference'&&marker.targetId)this.pendingReferenceIds.add(marker.targetId);if(this.draft.referenceSelections.some(selection=>selection.rootIds.some(id=>!this.pendingReferenceIds.has(id))))this.draft.referenceSelections=[];this.draft.plan=undefined;this.draft.review=undefined;this.draft.state='editing';this.classificationOverride=undefined;this.error=this.saveBlock?.message??'';if(!this.saveBlock)this.failureKind=undefined;this.touch();this.scheduleSearch();
  }
  private touch(){this.localVersion++;this.noChange=undefined;this.issues=[];this.preview=undefined;this.operationId='';this.status=this.saveBlock?'Unable to save draft':'Saving draft…';clearTimeout(this.saveTimer);if(!this.saveBlock)this.saveTimer=setTimeout(()=>void this.flush().catch(()=>{}),500);this.notify();}
  async flush():Promise<void>{
    if(this.saveBlock)throw new Error(this.saveBlock.message);
    clearTimeout(this.saveTimer);if(this.saveFlight){await this.saveFlight;if(this.acknowledgedVersion!==this.localVersion)return this.flush();return;}
    if(this.acknowledgedVersion===this.localVersion)return;
    const snapshot=structuredClone(this.draft),version=this.localVersion,expectedRevision=this.savedRevision,revision=this.started?expectedRevision+1:1;snapshot.revision=revision;
    this.status='Saving draft…';this.notify();
    this.saveFlight=(async()=>{
      try{const response=await this.options.request<{draft:CreationDraft}>(this.started?this.path():'/api/still/creation/drafts',this.started?{draft:snapshot,expectedRevision}:{draft:snapshot},this.started?'PUT':'POST');
        if(this.started&&response.draft.id!==snapshot.id||response.draft.revision!==revision)throw new Error('Draft acknowledgement did not match this revision.');
        this.draft.id=response.draft.id;this.started=true;this.savedRevision=revision;this.acknowledgedVersion=version;this.draft.revision=revision;this.draft.acknowledgedRevision=revision;this.draft.scope=response.draft.scope;this.draft.expiresAt=response.draft.expiresAt;if(this.plan){this.plan.scope=response.draft.scope;this.plan.draftId=response.draft.id;this.plan.draftRevision=revision;}this.storage?.setItem(this.key,this.draft.id);this.status=this.acknowledgedVersion===this.localVersion?'Draft saved':'Saving draft…';
      }catch(error){this.status='Unable to save draft';this.reportFailure(error);throw error;}finally{this.saveFlight=undefined;this.notify();}
    })();await this.saveFlight;if(this.acknowledgedVersion!==this.localVersion)return this.flush();
  }
  async refreshHashes(){if(!this.plan)return;const ticket=++this.hashTicket;const result=await creationReviewHashes(this.plan);if(ticket!==this.hashTicket)return;this.hashes=result;for(const node of this.retained){const old=this.review.nodes[node.id]??{};this.review.nodes[node.id]={...old,complete:creationNodeComplete(node)};}this.notify();}
  private makePlan(titleOnly:boolean,manual=false){
    const sourceText=this.text,projectId=this.draft.scope.projectId??crypto.randomUUID(),evidence={kind:'span' as const,start:0,end:sourceText.length,quote:sourceText};
    const nodes:ProposedNode[]=[];
    if(this.draft.entryKind==='project')nodes.push({id:projectId,projectId,kind:'project',title:titleOnly?sourceText:'',revision:1,disposition:'retained',sourceEvidence:[evidence]});
    if(this.draft.entryKind==='document')nodes.push({id:crypto.randomUUID(),projectId,kind:'document',title:titleOnly?sourceText:'',revision:1,disposition:'retained',sourceEvidence:[evidence]});
    if(!titleOnly)nodes.push({id:crypto.randomUUID(),projectId,kind:'idea',title:this.classification==='title'?sourceText:'',body:{schemaVersion:1,document:this.classification==='title'?creationDocument(''):structuredClone(this.draft.workingDocument)},text:this.classification==='title'?'':sourceText,revision:1,disposition:'retained',sourceEvidence:[evidence]});
    const idea=nodes.find(n=>n.kind==='idea'),destination=nodes.find(n=>n.kind==='document')?.id??this.draft.scope.documentId;
    this.draft.plan={schemaVersion:1,draftId:this.draft.id,draftRevision:this.draft.revision,entryKind:this.draft.entryKind,scope:this.draft.scope,sourceText,nodes,uses:idea&&destination?[{id:crypto.randomUUID(),documentId:destination,ideaId:idea.id,order:0,revision:1,disposition:'retained',dependencyManifest:[]}]:[],references:[],issues:[],coverage:[{start:0,end:sourceText.length,nodeIds:nodes.map(n=>n.id)}],decisions:this.draft.decisions,modelVersion:manual?'manual-v1':'deterministic-title-v1',compiledEventBound:nodes.length+1,titleOnly};this.draft.review=emptyReview();this.draft.state='review';this.review.stage=this.stages[0]??'final';
  }
  private referenceOnlyPlan():boolean {
    if(this.draft.entryKind==='project'||!this.draft.referenceSelections.length)return false;
    let remaining=this.text;for(const marker of [...this.draft.markers].sort((a,b)=>b.start-a.start)){if(marker.kind!=='reference')return false;remaining=remaining.slice(0,marker.start)+remaining.slice(marker.end);}
    if(remaining.trim())return false;
    const projectId=this.draft.scope.projectId!,sourceText=this.text,documentId=this.draft.entryKind==='document'?crypto.randomUUID():this.draft.scope.documentId;
    const roots=[...new Set(this.draft.referenceSelections.flatMap(selection=>selection.rootIds))];
    const evidence=this.draft.referenceSelections.flatMap(selection=>selection.sources.map(source=>({kind:'existing' as const,blockId:source.id,projectId:source.projectId,revision:source.revision,hash:source.hash})));
    const decision={id:crypto.randomUUID(),kind:'correction' as const,nodeIds:[],revision:this.draft.revision,accepted:true,detail:'Explicitly selected existing Idea identities'};
    const nodes:ProposedNode[]=this.draft.entryKind==='document'?[{id:documentId!,projectId,kind:'document',title:sourceText,revision:1,disposition:'retained',sourceEvidence:evidence}]:[];
    const uses=documentId?roots.map((ideaId,order)=>({id:crypto.randomUUID(),ideaId,documentId,order,revision:1,disposition:'retained' as const,dependencyManifest:this.dependencyManifests[ideaId]??this.draft.referenceSelections.find(selection=>selection.rootIds.includes(ideaId))!.sources})):[];
    this.draft.decisions.push(decision);this.draft.plan={schemaVersion:1,draftId:this.draft.id,draftRevision:this.draft.revision,entryKind:this.draft.entryKind,scope:this.draft.scope,sourceText,nodes,uses,references:[],issues:[],coverage:[{start:0,end:sourceText.length,nodeIds:nodes.map(node=>node.id),decisionId:decision.id}],decisions:this.draft.decisions,modelVersion:'selected-references-v1',compiledEventBound:nodes.length+uses.length};this.draft.review=emptyReview();this.draft.state='review';this.review.stage=this.stages[0]??'final';return true;
  }
  async submit():Promise<CreationReceipt|undefined>{
    if(!this.text.trim()){this.setError('Describe what you have in mind.');return;}
    const problem=markerScopeProblem(this.draft.markers,this.draft.entryKind);if(problem){this.setError(problem);return;}
    await this.flush();this.frozenOriginal=true;
    if(this.pendingReferenceIds.size){await this.selectReference('','document',[...this.pendingReferenceIds]);this.pendingReferenceIds.clear();}
    if(this.referenceOnlyPlan()){this.touch();await this.refreshHashes();await this.flush();return;}
    if(this.classification==='title'){
      this.makePlan(this.draft.entryKind!=='idea');this.touch();await this.refreshHashes();await this.flush();if(this.plan?.titleOnly)return this.commit();return;
    }
    const revision=this.draft.revision,version=this.localVersion,id=this.operationId||=crypto.randomUUID();
    try{const response=await this.options.request<{draft?:CreationDraft;plan?:CreationPlan;status?:string;message?:string}>(this.path('/interpret'),{expectedRevision:revision,operationId:id});
      if(this.draft.revision!==revision||this.localVersion!==version)return;
      const plan=response.draft?.plan??response.plan;if(!plan)throw new Error(response.message??'Organization is unavailable. Retry or complete one Idea manually.');
      if(response.draft){this.draft=response.draft;this.savedRevision=response.draft.revision;this.acknowledgedVersion=this.localVersion;}else{this.draft.plan=plan;this.draft.review=emptyReview();this.draft.state='review';this.touch();}this.review.stage=this.stages[0]??'final';await this.refreshHashes();await this.flush();
    }catch(error){const failure=creationFailure(error);if(failure.kind==='organizer')this.operationId='';if(['conflict','access','expired','size'].includes(failure.kind))this.reportFailure(error);else{this.failureKind='organizer';this.error='Organization is unavailable. Your full input is kept. Retry or complete one Idea manually.';this.notify();}}
  }
  async manual(){this.makePlan(false,true);this.touch();await this.refreshHashes();await this.flush();}
  navigate(id:string){if(id!==this.currentId)this.retireSplit();this.review.currentId=id;this.notify();}
  stage(stage:ReviewState['stage']){if(stage!=='final'&&!this.stages.includes(stage))return;if(stage!==this.currentStage)this.retireSplit();this.review.stage=stage;this.review.currentId=undefined;this.touch();}
  async markPresented(id=this.currentId){await this.validateGraph();await this.refreshHashes();if(this.issues.some(i=>['source_changed','reference_denied','dependency_denied','authority_changed','unavailable_reference'].includes(i.code)))throw new Error('Included content changed or is unavailable. Refresh and review its current version.');const node=this.plan?.nodes.find(n=>n.id===id);if(node)this.review.nodes[id]={...this.review.nodes[id],complete:creationNodeComplete(node),presentedHash:this.hashes.nodeHashes[id]};for(const use of this.plan?.uses.filter(u=>u.disposition==='retained'&&u.documentId===id)??[])this.review.uses[use.id]={...this.review.uses[use.id],complete:true,presentedHash:this.hashes.useHashes[use.id]};this.touch();}
  async approve(id=this.currentId){await this.refreshHashes();const entry=this.review.nodes[id],hash=this.hashes.nodeHashes[id];if(entry?.complete&&entry.presentedHash===hash)entry.approvedHash=hash;for(const use of this.plan?.uses.filter(u=>u.disposition==='retained'&&u.documentId===id)??[]){const r=this.review.uses[use.id],h=this.hashes.useHashes[use.id];if(r?.complete&&r.presentedHash===h)r.approvedHash=h;}this.touch();}
  async approveAll(){await this.refreshHashes();for(const [id,entry] of Object.entries(this.review.nodes))if(entry.complete&&entry.presentedHash===this.hashes.nodeHashes[id])entry.approvedHash=this.hashes.nodeHashes[id];for(const [id,entry] of Object.entries(this.review.uses))if(entry.complete&&entry.presentedHash===this.hashes.useHashes[id])entry.approvedHash=this.hashes.useHashes[id];this.touch();}
  async editNode(id:string,change:Partial<ProposedNode>){const node=this.plan?.nodes.find(n=>n.id===id);if(!node)return;Object.assign(node,change,{revision:node.revision+1});let decision=this.plan!.decisions.find(item=>item.kind==='correction'&&item.accepted&&item.nodeIds.length===1&&item.nodeIds[0]===id&&item.detail==='Explicitly edited during creation review');if(!decision){decision={id:crypto.randomUUID(),kind:'correction',nodeIds:[id],revision:this.draft.revision,accepted:true,detail:'Explicitly edited during creation review'};this.plan!.decisions.push(decision);}this.draft.decisions=this.plan!.decisions;if(!node.sourceEvidence.some(e=>e.kind==='correction'&&e.decisionId===decision!.id))node.sourceEvidence.push({kind:'correction',decisionId:decision.id});if(change.body)node.text=creationText(change.body.document);this.touch();await this.refreshHashes();this.scheduleSplit(id);}
  async replacePlan(draft:CreationDraft,plan:CreationPlan,review:ReviewState){this.draft=draft;this.draft.plan=plan;this.draft.decisions=plan.decisions;this.draft.review=review;this.touch();await this.refreshHashes();await this.flush();if(this.draft.referenceSelections.length)await this.refreshReferences();}
  async validateGraph(){await this.flush();if(!this.plan)return;const result=await this.options.request<Hashes & {issues:CreationIssue[]}>(this.path('/review'),{expectedRevision:this.savedRevision});this.issues=result.issues;this.hashes={nodeHashes:result.nodeHashes,useHashes:result.useHashes,approvalHash:result.approvalHash};this.notify();}
  async commit():Promise<CreationReceipt|undefined>{
    await this.validateGraph();await this.refreshHashes();if(!this.plan?.titleOnly&&!this.eligible)throw new Error('Review and approve every retained record and use before saving.');
    if(!this.preview){this.review.finalApprovalHash=this.hashes.approvalHash;this.touch();}await this.flush();
    const operationId=this.preview?.operationId??crypto.randomUUID();
    if(!this.preview){const preview=await this.options.request<{operationId:string;approvalHash:string;status?:string;open?:NonNullable<CreationController['noChange']>}>(this.path('/preview'),{expectedRevision:this.savedRevision,operationId});if(preview.status==='no-change'){this.noChange=preview.open??{projectId:this.plan!.scope.projectId!,documentId:this.plan!.scope.documentId};this.status='Already included';this.notify();return;}this.preview=preview;}
    this.storage?.setItem(this.key+':operation',JSON.stringify({draftId:this.draft.id,operationId,approvalHash:this.preview.approvalHash}));
    let result:{receipt:CreationReceipt};
    try{result=await this.options.request(this.path('/apply'),{operationId,approvalHash:this.preview.approvalHash});}
    catch(error){try{result=await this.options.request(this.path(`/operations/${encodeURIComponent(operationId)}`));if(!result.receipt)throw error;}catch{throw error;}}
    if(!result.receipt||result.receipt.operationId!==operationId)throw new Error('Save is unconfirmed. Check this same operation before trying another save.');
    this.receipt=result.receipt;this.draft.state='saved';this.storage?.removeItem(this.key);this.storage?.removeItem(this.key+':operation');this.status='Saved';this.notify();return result.receipt;
  }
  async previewReference(rootIds:string[]){await this.flush();return this.options.request<{selection:ReferenceSelection;sourceBodies:CreativeBlock[];dependencyManifests:CreationController['dependencyManifests'];revision:number}>(this.path('/use-preview'),{expectedRevision:this.savedRevision,rootIds});}
  async acceptReferenceSelection(selection:ReferenceSelection,sourceBodies:CreativeBlock[],decisions:Decision[]=[]){
    this.frozenOriginal=true;await this.flush();const version=this.localVersion;const result=await this.options.request<{draft:CreationDraft;sourceBodies:CreativeBlock[];dependencyManifests:CreationController['dependencyManifests']}>(this.path('/use'),{expectedRevision:this.savedRevision,rootIds:selection.rootIds,expectedSources:selection.sources});if(version!==this.localVersion)throw new Error('The draft changed during reference selection. Review the current passage again.');this.draft=result.draft;this.savedRevision=result.draft.revision;this.acknowledgedVersion=this.localVersion;this.sourceBodies=result.sourceBodies;this.dependencyManifests=result.dependencyManifests;this.draft.decisions.push(...decisions);if(decisions.length)this.touch();this.notify();
  }
  recordDecisions(decisions:Decision[]){this.draft.decisions.push(...decisions);if(this.plan)this.plan.decisions=this.draft.decisions;this.touch();}
  async selectReference(id:string,kind:string,rootIds?:string[]){
    if(this.draft.entryKind==='project')throw new Error('Account-wide discoveries can only be opened.');
    const roots=kind==='document'?rootIds:[id];if(!roots?.length)throw new Error('Select the Ideas to include from this Document.');
    await this.flush();const version=this.localVersion;
    const result=await this.options.request<{draft:CreationDraft;sourceBodies:CreativeBlock[];dependencyManifests?:CreationController['dependencyManifests']}>(this.path('/use'),{expectedRevision:this.savedRevision,rootIds:roots});
    if(version!==this.localVersion)throw new Error('The draft changed while selecting references. Your current text is kept; review the selection again.');
    this.draft=result.draft;this.savedRevision=result.draft.revision;this.acknowledgedVersion=this.localVersion;this.sourceBodies=result.sourceBodies;this.dependencyManifests=result.dependencyManifests??{};this.status='Draft saved';this.notify();
  }
  async refreshReferences(){await this.flush();const result=await this.options.request<{draft:CreationDraft;sourceBodies:CreativeBlock[]}>(this.path('/refresh'),{expectedRevision:this.savedRevision});this.draft=result.draft;this.savedRevision=result.draft.revision;this.acknowledgedVersion=this.localVersion;this.sourceBodies=result.sourceBodies;this.preview=undefined;await this.refreshHashes();}
  private retireSplit(){clearTimeout(this.splitTimer);this.splitTicket++;this.split=undefined;this.splitOptions=undefined;}
  private scheduleSplit(id:string){clearTimeout(this.splitTimer);const ticket=++this.splitTicket;this.split=undefined;this.splitOptions=undefined;this.splitTimer=setTimeout(()=>void this.assessSplit(id,ticket),500);}
  private async assessSplit(id:string,ticket:number){try{await this.flush();if(ticket!==this.splitTicket)return;await this.refreshHashes();const semanticVersion=this.hashes.nodeHashes[id],contextVersion=this.hashes.approvalHash,version=this.localVersion;const result=await this.options.request<NonNullable<CreationController['split']>>(this.path('/split'),{expectedRevision:this.savedRevision,nodeId:id,semanticVersion,contextVersion});if(ticket===this.splitTicket&&version===this.localVersion&&this.currentId===id){this.split=result;this.notify();}}catch{/* The complete Idea remains usable when the advisory service fails. */}}
  async keepAsOne(){if(!this.split||!this.plan)return;this.plan.decisions.push({id:crypto.randomUUID(),kind:'keep-together',nodeIds:[this.split.nodeId],revision:this.draft.revision,accepted:true,detail:JSON.stringify({semanticVersion:this.split.semanticVersion,contextVersion:this.split.contextVersion})});this.draft.decisions=this.plan.decisions;this.split=undefined;this.splitOptions=undefined;this.splitTicket++;this.touch();await this.flush();}
  async prepareSplitOptions(){if(!this.split)return;await this.flush();const version=this.localVersion,ticket=this.splitTicket;const result=await this.options.request<{plan?:CreationPlan}>(this.path('/interpret'),{expectedRevision:this.savedRevision,operationId:crypto.randomUUID()});if(version===this.localVersion&&ticket===this.splitTicket){this.splitOptions=result.plan;this.notify();}}
  async acceptSplitOptions(){if(!this.splitOptions)return;this.draft.plan=this.splitOptions;this.draft.decisions=this.splitOptions.decisions;this.draft.review=emptyReview();this.splitOptions=undefined;this.split=undefined;this.splitTicket++;this.touch();await this.refreshHashes();await this.flush();}
  async back(){await this.flush();}
  async discard(){await this.options.request(this.path(),{expectedRevision:this.savedRevision},'DELETE');this.storage?.removeItem(this.key);this.draft.state='discarded';this.notify();}
  private scheduleSearch(){clearTimeout(this.searchTimer);this.searchAbort?.abort();this.pendingSearch=undefined;this.searchFailure='';if(this.composing)return;const ticket=++this.queryRevision;if(!this.text.trim()){this.search=undefined;this.searchFocus=false;this.searchPointer=false;return;}this.searchTimer=setTimeout(()=>void this.runSearch(ticket),400);}
  private async runSearch(ticket:number){try{await this.flush();if(ticket!==this.queryRevision)return;const revision=this.draft.revision,version=this.localVersion;this.searchAbort=new AbortController();const response=await this.options.request<CreationSearchResponse>('/api/still/creation/search',{draftId:this.draft.id,draftRevision:revision,queryRevision:ticket,query:this.text},'POST',this.searchAbort.signal);if(ticket===this.queryRevision&&revision===this.draft.revision&&version===this.localVersion){if(this.searchFrozen)this.pendingSearch={response,ticket,revision,version};else{this.search=response;this.searchFailure='';this.notify();}}}catch(error){if(ticket===this.queryRevision){this.pendingSearch=undefined;const failure=creationFailure(error);if(failure.kind==='access'||failure.kind==='expired'){this.search=undefined;this.searchFocus=false;this.searchPointer=false;}this.searchFailure='Search is unavailable. Previously shown matches may be outdated.';this.notify();}}}
  dispose(){this.disposed=true;this.searchAbort?.abort();clearTimeout(this.saveTimer);clearTimeout(this.searchTimer);clearTimeout(this.splitTimer);this.splitTicket++;this.queryRevision++;this.hashTicket++;}
}
