import { Signal } from "signal-polyfill";
import { SignalObject } from "signal-utils/object";
import { foldEvents, type CreativeEvent, type CreativeProjection, type EventInput } from "../model/events";
import type { ImageSample, ReferenceFindingKind } from "../model/extractors";
import { readAttentionPreference, writeAttentionPreference } from "../model/attention";
import { blockEffectFor, blockIntentFor, type AdaptiveStructure, type AdaptiveSuggestionSet } from "../model/block-types";
import { documentFocusFromRoute, documentIdFromRoute, documentViewFromRoute, isDocumentViewRoute, withDocumentFocusInRoute, withDocumentInRoute } from "../model/routes";
import { normalizeSpatialScope } from "../model/spatial-scope";
import { CURRENT_FOCAL_POINT_METHOD, normalizeImageFocalPoint } from "../model/focal-point";
import { resolveImageFocalAnalysis } from "../model/image-focus";
import { documentGenerationRequestKey as generationRequestKeyFor, documentGenerationRevision as generationRevisionFor, documentJobFailure, documentJobIsStale, documentJobTerminal, generationFailureGuidance, type DocumentJob, type DocumentJobKind } from "../model/document-jobs";
import { effectivePromptPreference, normalizePromptTechnique, type PromptPreferenceScope, type PromptTechnique } from "../model/prompt-structures";
import { canvasIdFromRoute } from "../canvas/routes";
import { canvasProjectId, foldCanvasEvents, type CanvasContextSet, type CanvasProjection } from "../canvas/model";
import type { GenerationReadiness, GenerationReadinessKind, PromptTechniqueSafetyComparison } from "../model/generation-readiness";
import { parseDocumentArtifactContent, type DocumentArtifactKind, type SlidePresentation } from "../model/document-artifacts";
import { artifactContextEvents, imageOutputContextEvents } from "../model/output-context";
import { outputBlockRemovalEvents as ownedOutputBlockRemovalEvents, outputBlockTextEditEvents, outputInputDraft, outputInputEditEvents, type OutputInputDraft } from "../model/output-authoring";
import { combinedContextGroups, combinedContextMemberships, combinedContextRoleForBlockType } from "../model/combined-context";
import { eventProfileRank } from "../model/event-profiles";
import type { VideoAudioMode, VideoDurationSeconds } from "../model/video-adapter";
import { beginRoutePopulation, completeBackgroundHydration, recordEventPage, recordPopulationSource, recordPrivateContentState, recordRouteHistoryProfile, recordSessionReady } from "../performance";
import { matchingAccountSnapshot, readAccountSnapshots, writeAccountSnapshot, type AccountSnapshotIdentity, type AccountSnapshotProfile } from "./account-cache";
import { consumeSessionBootstrap, consumeSessionPrefetch } from "./session-bootstrap";
import { routeCapabilities } from "./route-capabilities";

type Listener = () => void;
type HistoryGroup = CreativeEvent[];
export type CanvasSyncResult = { appended:CreativeEvent[]; rejected:Array<{index?:number;type?:string;reason:string}>; head:number; retryable:boolean; error:string };
export type PilotSession = {
  user: { userId: string; email: string; displayName: string; role: "admin" | "creator" | "agent" | "viewer"; consentVersion: string | null; consentedAt: string | null };
  impersonation: { active:true; impersonationId:string; personaId:string; replaySessionId:string; actor:{userId:string;email:string;displayName:string;role:"admin"|"creator"|"agent"|"viewer"}; fictionalUser:{userId:string;email:string;displayName:string;role:"admin"|"creator"|"agent"|"viewer"}; startedAt:string; expiresAt:string } | null;
  policy: { version: string; accepted: boolean; passiveCapture: false; attentionCapture?: { available: boolean; defaultOn: false; retentionDays: number; rawInputCapture: false }; externalAssetsRequireAssertion: true; retentionDays: number; sharing: string };
  canvas: { version:string; mode:"internal"|"pilot"; pilotAvailable:boolean; access:boolean; accessReason:"administrator-internal-review"|"pilot-approved"|"pilot-gate-incomplete"|"role-not-eligible"; blockedBy:Array<"trust_safety"|"counsel"|"second_image_adapter">; requirements:Array<{id:"trust_safety"|"counsel"|"second_image_adapter";label:string;summary:string;approved:boolean;approvedBy:string|null;approvedByUserId:string|null;approvedAt:string|null;evidenceRef:string|null;details:Record<string,unknown>}> };
  provider: { name: string; model: string; plannerModel?: string; configured: boolean; imageProvider?:string; imageProviders?:Array<{provider:string;model:string;previewModel?:string;editModel?:string;configured:boolean}>; videoProvider?:string; videoModel?:string; videoReferenceModel?:string; videoAdapterVersion?:string; videoConfigured?:boolean; videoApiSunset?:string|null };
  budgets: { period: string; user: { used: number; reserved: number; limit: number }; workspace: { used: number; reserved: number; limit: number } };
};
export type ShareRecord = { shareId: string; token?: string; resourceKind?: string; resourceId?: string; projectId?: string; expiresAt: string; revokedAt?: string | null; createdAt?: string; active: boolean };

export class FormaStore {
  readonly events = new Signal.State<CreativeEvent[]>([]);
  readonly optimisticEvents = new Signal.State<CreativeEvent[]>([]);
  readonly eventView = new Signal.Computed<CreativeEvent[]>(() => [...this.events.get(),...this.optimisticEvents.get()]);
  readonly head = new Signal.State(0);
  readonly loading = new Signal.State(true);
  readonly busy = new Signal.State("");
  readonly error = new Signal.State("");
  readonly appendFailure = new Signal.State("");
  readonly asOf = new Signal.State(Number.POSITIVE_INFINITY);
  readonly replayEvents = new Signal.State<CreativeEvent[]>([]);
  readonly replayAsOf = new Signal.State(0);
  readonly route = new Signal.State(`${location.pathname}${location.search}${location.hash}`);
  readonly session = new Signal.State<PilotSession | null>(null);
  readonly content = new Signal.State<Record<string, string>>({});
  readonly shares = new Signal.State<ShareRecord[]>([]);
  readonly documentJobs = new Signal.State<DocumentJob[]>([]);
  readonly generationReadiness = new Signal.State<Record<string,GenerationReadiness>>({});
  readonly adaptiveStructures = new Signal.State<Record<string,AdaptiveStructure>>({});
  readonly adaptiveSuggestionSets = new Signal.State<Record<string,AdaptiveSuggestionSet[]>>({});
  readonly ui = new SignalObject({ inspectorOpen: false, commandOpen: false, accountOpen: false, shareOpen: false, compareOpen: false, projectRailCollapsed: false, instrumentation: true, attentionCapture: readAttentionPreference(), attentionPaused: false, impersonationConfirmOpen:false, impersonationAction:"", selectedEventId: "", selectedOutputId: "", comparisonOutputIds: "", focusBlockId: "", focusCollectionId: "", editingBlockId: "", libraryView: "all", libraryOutputScope: "recent", search: "", toast: "" });
  readonly projection = new Signal.Computed<CreativeProjection>(() => {
    const route = this.route.get();
    const canvasId=canvasIdFromRoute(route)??"";
    const events=this.eventView.get();
    return foldEvents(events, this.asOf.get(), isDocumentViewRoute(route) ? documentIdFromRoute(route) ?? "" : "", canvasId?canvasProjectId(events,canvasId):"");
  });
  readonly canvasProjection = new Signal.Computed<CanvasProjection>(() => foldCanvasEvents(this.eventView.get(),this.projection.get().projectId,canvasIdFromRoute(this.route.get())??""));
  readonly replayProjection = new Signal.Computed<CreativeProjection>(() => foldEvents(this.replayEvents.get(), this.replayAsOf.get()));
  #listeners = new Set<Listener>();
  #undo: HistoryGroup[] = [];
  #redo: HistoryGroup[] = [];
  #rememberedClientEventIds = new Set<string>();
  #appendPipeline:Promise<void> = Promise.resolve();
  #navigationCommit:Promise<boolean>|null=null;
  #focalInFlight = new Set<string>();
  #focalAppendQueue: Promise<void> = Promise.resolve();
  #jobPollTimer = 0;
  #jobsSyncing = false;
  #jobSyncScope = "";
  #jobResyncRequested = false;
  #jobPollFailures = 0;
  #jobPollIssueNotified = false;
  #jobsDriving = new Set<string>();
  #jobDetails = new Map<string, DocumentJob>();
  #jobStarts = new Set<string>();
  #readinessInFlight = new Set<string>();
  #readinessAcknowledgements = new Set<string>();
  #pendingJobNotices: DocumentJob[] = [];
  #pendingAdaptiveIntents = new Map<string,string>();
  #dismissedAdaptiveSuggestions = new Set<string>();
  #impersonationConfirmation?: (confirmed:boolean)=>void;
  #historyProfile: AccountSnapshotProfile = "full";
  #historyUpgrade?: Promise<void>;
  #contentHydration?: Promise<void>;
  #focalBackfillTimer = 0;

  constructor(){document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"&&this.session.get()&&this.events.get().length){this.#flushPendingJobNotices();this.#syncVisibleJobs();}});}

  subscribe(listener: Listener) { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }
  notify() { this.#listeners.forEach((listener) => listener()); }
  #publishAppended(events:CreativeEvent[]){
    if(!events.length)return;
    window.dispatchEvent(new CustomEvent("forma-events-appended",{detail:{events}}));
    const needsImageMaintenance=events.some((event)=>["GenerationCompleted","IdeationPreviewCompleted","DocumentRenderCompleted","ReferenceIngested","BlockCreated"].includes(event.type));
    if(needsImageMaintenance&&!this.session.get()?.impersonation){
      window.clearTimeout(this.#focalBackfillTimer);
      this.#focalBackfillTimer=window.setTimeout(()=>this.#backfillImageFocalPoints(),3_000);
    }
  }
  #hasFocalPoint(targetKind:"generation"|"reference"|"artifact",targetId:string){const projection=this.projection.get();const point=targetKind==="generation"?(projection.libraryOutputs.find((output)=>output.id===targetId)?.focalPoint??projection.outputs.find((output)=>output.id===targetId)?.focalPoint):targetKind==="artifact"?projection.libraryArtifacts.flatMap((artifact)=>artifact.items).find((item)=>item.id===targetId)?.focalPoint:normalizeImageFocalPoint(projection.libraryBlocks.find((block)=>block.id===targetId)?.properties.focal_point??projection.blocks.find((block)=>block.id===targetId)?.properties.focal_point);return point?.method===CURRENT_FOCAL_POINT_METHOD;}
  #backfillImageFocalPoints(){
    const projection=this.projection.get();const seen=new Set<string>();
    for(const output of [...projection.outputs,...projection.libraryOutputs])if(output.mediaUrl&&output.focalPoint?.method!==CURRENT_FOCAL_POINT_METHOD&&!seen.has(`generation:${output.id}`)){seen.add(`generation:${output.id}`);void this.calculateImageFocalPoint({targetKind:"generation",targetId:output.id,mediaUrl:output.mediaUrl});}
    for(const item of projection.libraryArtifacts.flatMap((artifact)=>artifact.items))if(item.mediaUrl&&item.focalPoint?.method!==CURRENT_FOCAL_POINT_METHOD&&!seen.has(`artifact:${item.id}`)){seen.add(`artifact:${item.id}`);void this.calculateImageFocalPoint({targetKind:"artifact",targetId:item.id,mediaUrl:item.mediaUrl});}
    for(const block of [...projection.blocks,...projection.libraryBlocks]){const mediaUrl=String(block.properties.media_url??"");if(block.type!=="reference"||!mediaUrl||block.properties.extraction_status==="pending"||normalizeImageFocalPoint(block.properties.focal_point)?.method===CURRENT_FOCAL_POINT_METHOD||seen.has(`reference:${block.id}`))continue;seen.add(`reference:${block.id}`);void this.calculateImageFocalPoint({targetKind:"reference",targetId:block.id,referenceId:String(block.properties.reference_id??""),mediaUrl});}
  }
  #reflectDocumentInRoute() {
    const currentRoute = this.route.get();
    if (!isDocumentViewRoute(currentRoute)) return;
    const projection = this.projection.get();
    const canonicalRoute = withDocumentInRoute(currentRoute, projection.documentId, projection.documentTitle);
    if (projection.documentId && canonicalRoute !== currentRoute) this.setRoute(canonicalRoute, { replace: true });
  }
  #generationContext(documentId=this.projection.get().documentId) {
    const projection=this.projection.get();
    const blocks=projection.libraryBlocks.filter((block)=>block.documentId===documentId);const blockIds=new Set(blocks.map((block)=>block.id));const relations=projection.libraryBlockRelations.filter((relation)=>blockIds.has(relation.fromBlockId)&&blockIds.has(relation.toBlockId));const outputs=projection.libraryOutputs.filter((output)=>output.documentId===documentId);
    const context={
      snapshot:{facts:blocks.map((b)=>({block_id:b.id,document_id:b.documentId,type: b.type,role:b.type,intent: blockIntentFor(b.type, b.properties),handle:b.handle,position:b.position,locked:b.locked,active:Number(b.properties.weight??.5)>0,effect: blockEffectFor(b.type, b.properties),properties:{...b.properties,spatial_scope: normalizeSpatialScope(b.properties.spatial_scope)},authority:b.properties.authority??"authored",source_event_refs:b.sourceEvents})),relationships:relations.map((relation)=>({relation_id:relation.id,from_block_id:relation.fromBlockId,to_block_id:relation.toBlockId,kind:relation.kind,properties:relation.properties,source_event_refs:relation.sourceEvents})),pins:outputs.filter((o)=>o.pinned).map((o)=>o.id),tail:[]},
      sourceBlockVersions:blocks.map((b)=>({block_id:b.id,version:b.sourceEvents.length})),documentId,
    };
    return {...context,documentRevision:generationRevisionFor(context)};
  }
  documentJob(kind:DocumentJobKind,documentId=this.projection.get().documentId){return this.documentJobs.get().find((job)=>job.documentId===documentId&&job.kind===kind&&(job.status==="queued"||job.status==="running"||job.status==="committing"));}
  documentGenerationRevision(){return this.#generationContext().documentRevision;}
  promptTechniquePreference(){const projection=this.projection.get();const filed=projection.membership[projection.documentId];return effectivePromptPreference(projection.preferences,{documentId:projection.documentId,collectionIds:filed?[filed.collectionId]:[],projectId:projection.projectId,accountId:this.session.get()?.user.userId});}
  documentGenerationRequestKey(kind:"preview"|"generate",sourcePreviewId?:string|null,promptTechnique:PromptTechnique=this.promptTechniquePreference().technique,promptFanId?:string|null){return generationRequestKeyFor(kind,this.documentGenerationRevision(),sourcePreviewId,promptTechnique,promptFanId);}
  generationReadinessRequestKey(kind:GenerationReadinessKind,sourcePreviewId?:string|null,promptTechnique:PromptTechnique=this.promptTechniquePreference().technique){const revision=this.documentGenerationRevision();return kind==="preview"?generationRequestKeyFor("preview",revision,null,promptTechnique):kind==="generate"?generationRequestKeyFor("generate",revision,sourcePreviewId,promptTechnique):`prompt-fan:${kind==="preview_fan"?"preview":"generate"}:${revision}:${sourcePreviewId||"document"}`;}
  generationReadinessFor(kind:GenerationReadinessKind,sourcePreviewId?:string|null,promptTechnique:PromptTechnique=this.promptTechniquePreference().technique){return this.generationReadiness.get()[this.generationReadinessRequestKey(kind,sourcePreviewId,promptTechnique)]??null;}
  generationRiskAcknowledged(requestKey:string){return this.#readinessAcknowledgements.has(requestKey);}
  acknowledgeGenerationRisk(requestKey:string){this.#readinessAcknowledgements.add(requestKey);this.notify();}
  async ensureGenerationReadiness(kind:GenerationReadinessKind,options:{sourcePreviewId?:string|null;promptTechnique?:PromptTechnique;sourceSurface?:string;force?:boolean}={}){const technique=normalizePromptTechnique(options.promptTechnique??this.promptTechniquePreference().technique);const context=this.#generationContext();const requestKey=this.generationReadinessRequestKey(kind,options.sourcePreviewId,technique);if(this.#readinessInFlight.has(requestKey))return this.generationReadiness.get()[requestKey]??null;const existing=this.generationReadiness.get()[requestKey];if(existing&&!options.force&&Date.parse(existing.expiresAt)>Date.now())return existing;this.#readinessInFlight.add(requestKey);this.generationReadiness.set({...this.generationReadiness.get(),[requestKey]:existing?{...existing,status:"checking",summary:"Checking current generation readiness…"}:{preflightId:"",requestKey,documentId:context.documentId,documentRevision:context.documentRevision,kind,promptTechnique:technique,status:"checking",summary:"Checking current generation readiness…",probes:[],provider:{status:"unknown",scope:"unknown",message:"Checking provider status.",observedAt:new Date().toISOString(),expiresAt:new Date().toISOString(),retryAfterMs:null,requestId:null},estimatedTokens:0,estimatedCostMicrousd:0,estimatedSeconds:0,requiresAcknowledgement:false,checkedAt:new Date().toISOString(),expiresAt:new Date().toISOString(),cached:false,version:"pending"}});this.notify();try{const response=await fetch("/api/generation-readiness",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...context,kind,requestKey,sourcePreviewId:options.sourcePreviewId??null,promptTechnique:technique,sourceSurface:options.sourceSurface??"generation-controls",force:Boolean(options.force)})});const body=await response.json() as {readiness?:GenerationReadiness;error?:string;message?:string};if(!response.ok||!body.readiness)throw new Error(body.message??body.error??"Generation readiness could not be checked");this.generationReadiness.set({...this.generationReadiness.get(),[requestKey]:body.readiness});if(body.readiness.status!=="review")this.#readinessAcknowledgements.delete(requestKey);this.notify();return body.readiness;}catch(error){const failed={...(this.generationReadiness.get()[requestKey]??existing!),status:"unknown" as const,summary:error instanceof Error?error.message:"Generation readiness could not be checked",expiresAt:new Date(Date.now()+30_000).toISOString()};this.generationReadiness.set({...this.generationReadiness.get(),[requestKey]:failed});this.notify();return failed;}finally{this.#readinessInFlight.delete(requestKey);}}
  async refreshGenerationProviderStatus(){try{const response=await this.guardedFetch("/api/generation-readiness/provider/refresh",{method:"POST"},"refresh provider readiness");const body=await response.json() as {error?:string};if(!response.ok)throw new Error(body.error??"Provider status could not be refreshed");this.generationReadiness.set({});this.#readinessAcknowledgements.clear();this.toast("Provider status cleared. Rechecking the current document…");this.notify();return true;}catch(error){this.toast(error instanceof Error?error.message:"Provider status could not be refreshed");return false;}}
  async comparePromptTechniqueSafety(job:DocumentJob,failedTechnique:PromptTechnique=job.promptTechnique,failedPrompt=""){
    const context=this.#generationContext(job.documentId);
    const kind=job.kind==="prompt_fan"?job.fanKind??"generate":job.kind==="preview"?"preview":"generate";
    const response=await this.guardedFetch("/api/generation-readiness/prompt-techniques",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...context,kind,sourcePreviewId:job.sourcePreviewId,failedTechnique:normalizePromptTechnique(failedTechnique),failedPrompt,sourceSurface:job.sourceSurface||"generation-failure"})},"run a moderation-only prompt comparison");
    const body=await response.json() as {comparison?:PromptTechniqueSafetyComparison;error?:string;message?:string};
    if(!response.ok||!body.comparison)throw new Error(body.message??body.error??"Prompt structures could not be compared");
    await this.#refreshEvents();
    return body.comparison;
  }
  documentGenerationJobs(documentId=this.projection.get().documentId){return this.documentJobs.get().filter((job)=>job.documentId===documentId&&(job.kind==="prompt_fan"||(job.kind==="preview"||job.kind==="generate")&&!job.parentJobId)&&(job.status==="queued"||job.status==="running"||job.status==="committing")).sort((a,b)=>a.requestedAt.localeCompare(b.requestedAt)||a.jobId.localeCompare(b.jobId));}
  documentRenderJobs(documentId=this.projection.get().documentId){return this.documentJobs.get().filter((job)=>job.documentId===documentId&&job.kind==="render_document"&&(job.status==="queued"||job.status==="running"||job.status==="committing")).sort((a,b)=>a.requestedAt.localeCompare(b.requestedAt)||a.jobId.localeCompare(b.jobId));}
  documentJobForRequest(kind:"preview"|"generate",requestKey:string,documentId=this.projection.get().documentId){return this.documentGenerationJobs(documentId).find((job)=>job.kind===kind&&job.requestKey===requestKey);}
  documentJobStarting(requestKey:string){return this.#jobStarts.has(requestKey);}
  documentJobActive(kind?:DocumentJobKind,documentId=this.projection.get().documentId){return this.documentJobs.get().some((job)=>job.documentId===documentId&&(!kind||job.kind===kind||job.kind==="prompt_fan"&&job.fanKind===kind)&&(job.status==="queued"||job.status==="running"||job.status==="committing"));}
  documentPreviewProgress(documentId=this.projection.get().documentId){const job=this.documentJobs.get().find((item)=>item.documentId===documentId&&item.kind==="preview"&&item.status==="running"&&item.result?.partialMediaUrl);if(!job)return null;return{jobId:job.jobId,mediaUrl:String(job.result!.partialMediaUrl),mediaType:String(job.result!.partialMediaType??"image/jpeg"),width:Number(job.result!.partialWidth??816),height:Number(job.result!.partialHeight??816),index:Number(job.result!.partialIndex??0),sourceSurface:job.sourceSurface};}
  adaptiveStructureFor(documentId=this.projection.get().documentId){return this.adaptiveStructures.get()[documentId]??null;}
  dismissAdaptiveStructure(documentId=this.projection.get().documentId){const next={...this.adaptiveStructures.get()};delete next[documentId];this.adaptiveStructures.set(next);this.notify();}
  adaptiveSuggestionSetsFor(documentId=this.projection.get().documentId){return this.adaptiveSuggestionSets.get()[documentId]??[];}
  dismissAdaptiveSuggestion(documentId:string,suggestionId:string){this.#dismissedAdaptiveSuggestions.add(suggestionId);const next={...this.adaptiveSuggestionSets.get(),[documentId]:this.adaptiveSuggestionSetsFor(documentId).filter((suggestion)=>suggestion.id!==suggestionId)};if(!next[documentId].length)delete next[documentId];this.adaptiveSuggestionSets.set(next);this.notify();}
  #adaptiveIntentForJob(job:DocumentJob){const result=job.result??{};const directRef=String(result.intentRef??"");if(directRef&&this.content.get()[directRef])return this.content.get()[directRef];const eventIds=new Set(Array.isArray(result.appendedEventIds)?result.appendedEventIds.map(String):[]);const reasoned=this.events.get().find((event)=>eventIds.has(event.eventId)&&event.type==="AssistantReasoned"&&event.payload.operation==="adaptive-structure");const eventRef=String(reasoned?.payload.intent_ref??"");return this.#pendingAdaptiveIntents.get(job.jobId)??this.content.get()[eventRef]??"";}
  #syncAdaptiveSuggestionSets(jobs:DocumentJob[]){const next:Record<string,AdaptiveSuggestionSet[]>={};for(const job of jobs){if(job.kind!=="structure_adaptive"||job.sourceSurface!=="canvas"||job.status!=="completed"||!job.result?.structure||this.#dismissedAdaptiveSuggestions.has(job.jobId))continue;const suggestion:AdaptiveSuggestionSet={id:job.jobId,documentId:job.documentId,intent:this.#adaptiveIntentForJob(job),structure:job.result.structure as AdaptiveStructure,requestedAt:job.requestedAt,completedAt:job.completedAt??job.updatedAt};(next[job.documentId]??=[]).push(suggestion);}for(const suggestions of Object.values(next))suggestions.sort((left,right)=>left.requestedAt.localeCompare(right.requestedAt)||left.id.localeCompare(right.id));this.adaptiveSuggestionSets.set(next);}
  #jobResultVisible(job:DocumentJob){if(document.visibilityState!=="visible")return false;if(job.sourceSurface==="canvas"&&this.route.get().startsWith("/canvas"))return true;if(!isDocumentViewRoute(this.route.get())||documentIdFromRoute(this.route.get())!==job.documentId)return false;const view=documentViewFromRoute(this.route.get());if(job.kind==="chat")return view==="chat";if(job.kind==="structure_adaptive")return view==="adaptive";return true;}
  #jobNotice(job:DocumentJob){const title=this.projection.get().documents.find((document)=>document.id===job.documentId)?.title??"your document";const labels:Record<DocumentJobKind,string>={preview:"Draft generation",generate:"Full-quality generation",prompt_fan:"Fan generation",chat:"Creative chat",structure_adaptive:"Adaptive planning",extract_reference:"Reference analysis",render_document:"Document render"};if(job.status==="partial"&&job.kind==="prompt_fan"){const completed=Number(job.result?.completedCount??0),failed=Number(job.result?.failedCount??0);return`Fan generation finished partially for ${title}: ${completed} image${completed===1?"":"s"} ready and ${failed} failed. Open the comparison for details.`;}if(job.status==="failed"){const detail=documentJobFailure(job);const guidance=generationFailureGuidance(detail,job.error??"");return`${labels[job.kind]} could not finish for ${title}. ${guidance.title}. ${guidance.summary}${detail?.requestId?` Request ${detail.requestId}.`:""}`;}const ready:Record<DocumentJobKind,string>={preview:"A draft image is ready",generate:"A full-quality image is ready",prompt_fan:"A four-image fan is ready",chat:"A chat response is ready",structure_adaptive:"An adaptive plan is ready",extract_reference:"Reference analysis is ready",render_document:"A new document artifact is ready"};return`${ready[job.kind]} in ${title}.`;}
  async #ackJob(jobId:string){try{await fetch(`/api/document-jobs/${encodeURIComponent(jobId)}/ack`,{method:"POST"});}catch{/* A later poll can offer the notice again. */}}
  async loadDocumentJobDetail(jobId:string){
    const current=this.documentJobs.get().find((job)=>job.jobId===jobId);
    const cached=this.#jobDetails.get(jobId);
    if(cached&&cached.updatedAt===current?.updatedAt)return cached;
    const response=await fetch(`/api/document-jobs/${encodeURIComponent(jobId)}`);
    const body=await response.json() as {job?:DocumentJob;error?:string};
    if(!response.ok||!body.job)throw new Error(body.error??"The retained generation inputs could not be loaded.");
    this.#jobDetails.set(jobId,body.job);
    if(this.#jobDetails.size>24)this.#jobDetails.delete(this.#jobDetails.keys().next().value!);
    this.documentJobs.set(this.documentJobs.get().map((job)=>job.jobId===jobId?body.job!:job));
    this.notify();
    return body.job;
  }
  async dismissDocumentJobFailure(jobId:string){try{const response=await this.guardedFetch(`/api/document-jobs/${encodeURIComponent(jobId)}/dismiss`,{method:"POST"},"dismiss this generation issue");const body=await response.json() as {job?:DocumentJob;error?:string};if(!response.ok||!body.job)throw new Error(body.error??"Generation issue could not be dismissed");this.documentJobs.set(this.documentJobs.get().map((job)=>job.jobId===jobId?body.job!:job));this.toast("Generation notice dismissed. Its retained inputs remain in this document’s failure history.");this.notify();return true;}catch(error){this.toast(error instanceof Error?error.message:"Generation issue could not be dismissed");return false;}}
  async recoverDocumentRender(jobId:string){try{const response=await this.guardedFetch(`/api/document-jobs/${encodeURIComponent(jobId)}/retry`,{method:"POST"},"recover this completed provider render");const body=await response.json() as {job?:DocumentJob;error?:string};if(!response.ok||!body.job)throw new Error(body.error??"The saved provider render could not be recovered");this.documentJobs.set([body.job,...this.documentJobs.get().filter((job)=>job.jobId!==jobId)]);this.toast("Recovering the saved Fal video. No second paid video was submitted.");this.notify();this.#driveDocumentJobs(this.documentJobs.get());this.#scheduleJobPoll(800);return true;}catch(error){this.toast(error instanceof Error?error.message:"The saved provider render could not be recovered");return false;}}
  async stopDocumentJob(jobId:string,force=false){try{const response=await this.guardedFetch(`/api/document-jobs/${encodeURIComponent(jobId)}/${force?"force-fail":"cancel"}`,{method:"POST"},force?"force-fail this document operation":"stop this document operation");const body=await response.json() as {job?:DocumentJob;error?:string};if(!response.ok||!body.job){const messages:Record<string,string>={job_finalizing:"This operation is already finalizing and can no longer be stopped.",admin_required:"Only an administrator can force-fail an operation."};throw new Error(messages[body.error??""]??body.error??"The operation could not be stopped");}this.documentJobs.set(this.documentJobs.get().map((job)=>job.jobId===jobId?body.job!:job));this.toast(force?"Operation force-failed. Its audit receipt and released budget remain available.":"Operation stopped. Any reserved application budget was released.");await Promise.all([this.syncDocumentJobs(),this.refreshSession()]);return true;}catch(error){this.toast(error instanceof Error?error.message:"The operation could not be stopped");return false;}}
  #flushPendingJobNotices(){if(document.visibilityState!=="visible"||!this.#pendingJobNotices.length)return;const jobs=this.#pendingJobNotices.splice(0);this.toast(jobs.length===1?this.#jobNotice(jobs[0]):`${jobs.length} background document operations finished.`);for(const job of jobs)void this.#ackJob(job.jobId);}
  async #readEventPages(after=0){return this.#readEventStream(after,"full",after===0);}
  async replayAuthoritativeHistory(sequence:number){const complete=await this.#readEventStream(0,"full",false);this.replayEvents.set(complete.events);this.setReplayAsOf(sequence);}
  async #readEventStream(after:number,profile:AccountSnapshotProfile,includeContent=false){
    let cursor=Math.max(0,after),head=cursor,first=true,initialHead=Number.POSITIVE_INFINITY;
    const events:CreativeEvent[]=[];let content:Record<string,string>={};
    for(let page=0;page<500;page+=1){
      const limit=profile==="full"?5000:6500;
      const selection=profile==="full"?"":`&profile=${profile}`;
      const response=await fetch(`/api/events?after=${cursor}&limit=${limit}&content=${first&&includeContent?1:0}${selection}`);
      if(!response.ok)throw new Error(`Event stream returned ${response.status}`);
      const body=await response.json() as {events?:CreativeEvent[];content?:Record<string,string>;head?:number;nextAfter?:number;hasMore?:boolean};
      const responseHead=Math.max(0,Number(body.head??head));
      head=first?responseHead:Math.max(head,responseHead);
      if(first)initialHead=head;
      const received=(body.events??[]).filter((event)=>event.sequence<=initialHead);events.push(...received);recordEventPage(received.length);
      if(body.content)content={...content,...body.content};
      const next=Math.min(initialHead,Math.max(cursor,Number(body.nextAfter??received.at(-1)?.sequence??cursor)));
      const hasMore=(body.hasMore??next<head)&&next<initialHead;
      if(hasMore&&next<=cursor)throw new Error("Event stream pagination did not advance");
      cursor=next;first=false;
      if(!hasMore){
        if(profile==="full"&&after>0&&events.some((event)=>Object.entries(event.payload).some(([key,value])=>/(?:^|_)(?:content|prompt|intent|input|response|message|statement|condition|note|output|direction)_ref$/.test(key)&&typeof value==="string"&&!this.content.get()[value]))){
          const hydration=await fetch(`/api/events?after=${head}&limit=1&content=1`);
          if(hydration.ok){const hydrated=await hydration.json() as {content?:Record<string,string>};content={...content,...(hydrated.content??{})};}
        }
        return{events,content,head:Math.min(head,initialHead)};
      }
    }
    throw new Error("Event stream exceeded the supported pagination window");
  }

  #profileForRoute(path:string):AccountSnapshotProfile{
    return routeCapabilities(path).profile;
  }

  routeDataReady(path=this.route.get()){
    return eventProfileRank(this.#historyProfile)>=eventProfileRank(this.#profileForRoute(path));
  }

  #snapshotIdentity(session:PilotSession):AccountSnapshotIdentity{
    return{userId:session.user.userId,policyVersion:session.policy.version,accepted:session.policy.accepted,impersonating:Boolean(session.impersonation)};
  }

  async #upgradeHistory(profile:AccountSnapshotProfile){
    if(eventProfileRank(this.#historyProfile)>=eventProfileRank(profile))return;
    if(this.#historyUpgrade){await this.#historyUpgrade;if(eventProfileRank(this.#historyProfile)>=eventProfileRank(profile))return;}
    const upgrade=(async()=>{
      const incoming=await this.#readEventStream(0,profile,profile==="full"&&routeCapabilities(this.route.get()).privateContent);
      const merged=new Map(incoming.events.map((event)=>[event.eventId,event]));
      for(const event of this.events.get())merged.set(event.eventId,event);
      this.events.set([...merged.values()].sort((left,right)=>left.sequence-right.sequence||left.eventId.localeCompare(right.eventId)));
      if(Object.keys(incoming.content).length)this.content.set({...this.content.get(),...incoming.content});
      this.head.set(Math.max(this.head.get(),incoming.head));
      this.#historyProfile=profile;
      recordRouteHistoryProfile(profile);
      if(profile!=="projects")completeBackgroundHydration(this.events.get().length,profile);
      this.notify();
      const session=this.session.get();if(session)void writeAccountSnapshot(this.#snapshotIdentity(session),this.events.get(),this.head.get(),profile);
    })();
    this.#historyUpgrade=upgrade;
    try{await upgrade;}finally{if(this.#historyUpgrade===upgrade)this.#historyUpgrade=undefined;}
  }

  async #hydrateVisiblePrivateContent(){
    if(Object.keys(this.content.get()).length){recordPrivateContentState("ready");return;}
    const hydrationPath=this.route.get().split(/[?#]/)[0]?.replace(/\/+$/,"")||"/";
    if(this.#contentHydration){try{await this.#contentHydration;if((this.route.get().split(/[?#]/)[0]?.replace(/\/+$/,"")||"/")===hydrationPath)recordPrivateContentState("ready");}catch(error){if((this.route.get().split(/[?#]/)[0]?.replace(/\/+$/,"")||"/")===hydrationPath)recordPrivateContentState("unavailable");throw error;}return;}
    recordPrivateContentState("pending");
    const hydration=(async()=>{
      const response=await fetch(`/api/events?after=${this.head.get()}&limit=1&content=1`);
      if(!response.ok)throw new Error(`Private content returned ${response.status}`);
      const body=await response.json() as {content?:Record<string,string>};
      if(Object.keys(body.content??{}).length){this.content.set({...this.content.get(),...body.content});this.notify();}
    })();
    this.#contentHydration=hydration;
    let state:"ready"|"unavailable"="unavailable";
    try{await hydration;state="ready";}finally{if((this.route.get().split(/[?#]/)[0]?.replace(/\/+$/,"")||"/")===hydrationPath)recordPrivateContentState(state);if(this.#contentHydration===hydration)this.#contentHydration=undefined;}
  }

  async ensurePrivateContent(reference:string){
    if(!reference)return null;
    const existing=this.content.get()[reference];if(typeof existing==="string")return existing;
    if(this.#contentHydration){try{await this.#contentHydration;}catch{/* A targeted retry below preserves the exact missing-reference contract. */}const hydrated=this.content.get()[reference];if(typeof hydrated==="string")return hydrated;}
    try{const response=await fetch(`/api/events?after=${this.head.get()}&limit=1&content=1`);if(!response.ok)return null;const body=await response.json() as {content?:Record<string,string>};if(Object.keys(body.content??{}).length){this.content.set({...this.content.get(),...body.content});this.notify();}return this.content.get()[reference]??null;}catch{return null;}
  }
  #clientEventIds(events:CreativeEvent[]){return new Set(events.map((event)=>String(event.payload.client_event_id??"")).filter(Boolean));}
  #mergeConfirmed(appended:CreativeEvent[],head=this.head.get(),remember=false){
    const known=new Set(this.events.get().map((event)=>event.eventId));const fresh=appended.filter((event)=>!known.has(event.eventId));
    if(fresh.length)this.events.set([...this.events.get(),...fresh].sort((left,right)=>left.sequence-right.sequence||left.eventId.localeCompare(right.eventId)));
    const confirmedClientIds=this.#clientEventIds(appended);if(confirmedClientIds.size)this.optimisticEvents.set(this.optimisticEvents.get().filter((event)=>!confirmedClientIds.has(String(event.payload.client_event_id??""))));
    this.head.set(Math.max(this.head.get(),head,...appended.map((event)=>event.sequence)));
    if(remember){const remembered=appended.filter((event)=>{const clientEventId=String(event.payload.client_event_id??"");if(event.actor!=="user"||event.compensatesEventId||!inverseEvent(event)||clientEventId&&this.#rememberedClientEventIds.has(clientEventId))return false;if(clientEventId)this.#rememberedClientEventIds.add(clientEventId);return true;});if(remembered.length){this.#undo.push(remembered);this.#redo=[];}}
    this.#publishAppended(fresh);return fresh;
  }
  stageOptimisticCanvasEvents(events:EventInput[]){
    const existing=new Set(this.optimisticEvents.get().map((event)=>String(event.payload.client_event_id??"")));const now=new Date().toISOString();let index=this.optimisticEvents.get().length;
    const staged:CreativeEvent[]=events.filter((event)=>!existing.has(String(event.payload.client_event_id??""))).map((event)=>{const clientEventId=String(event.payload.client_event_id??crypto.randomUUID());return{eventId:`optimistic:${clientEventId}`,streamId:"optimistic:canvas",sequence:this.head.get()+(++index),occurredAt:now,recordedAt:now,actor:"user",clientId:"web:canvas-optimistic",correlationId:String(event.payload.history_action_id??clientEventId),causationId:null,compensatesEventId:event.compensatesEventId??null,schemaVersion:1,type:event.type,payload:{...event.payload,client_event_id:clientEventId}};});
    if(staged.length){this.optimisticEvents.set([...this.optimisticEvents.get(),...staged]);this.notify();}return staged;
  }
  discardOptimisticCanvasEvents(clientEventIds:Iterable<string>){const ids=new Set(clientEventIds);if(!ids.size)return;this.optimisticEvents.set(this.optimisticEvents.get().filter((event)=>!ids.has(String(event.payload.client_event_id??""))));this.notify();}
  async syncCanvasBatch(events:EventInput[],options:{remember?:boolean}={}):Promise<CanvasSyncResult>{
    if(!events.length)return{appended:[],rejected:[],head:this.head.get(),retryable:false,error:""};
    let response:Response;let body:{appended?:CreativeEvent[];rejected?:Array<{index?:number;type?:string;reason:string}>;head?:number;error?:string}={};
    try{response=await this.guardedFetch("/api/events",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"canvas_sync",events,clientId:"web:canvas"})},events.length>1?`apply ${events.length} ordered board changes`:`record ${events[0].type}`);try{body=await response.json() as typeof body;}catch{body={error:`Canvas sync returned HTTP ${response.status} without a readable receipt.`};}}
    catch(error){const message=error instanceof Error?error.message:"The Canvas server could not be reached.";this.appendFailure.set(message);return{appended:[],rejected:[],head:this.head.get(),retryable:true,error:message};}
    const appended=body.appended??[];if(appended.length)this.#mergeConfirmed(appended,body.head??this.head.get(),options.remember!==false);
    const error=response.ok?"":body.error??`Canvas sync returned HTTP ${response.status}`;const retryable=!response.ok&&(response.status>=500||[408,425,429].includes(response.status)||response.status===409&&body.error==="stale_sequence");
    this.appendFailure.set(error||((body.rejected?.length??0)>0?body.rejected!.map((item)=>item.reason).join("; "):""));this.notify();
    return{appended,rejected:body.rejected??[],head:body.head??this.head.get(),retryable,error};
  }
  async #refreshEvents(){const previous=this.events.get();const known=new Set(previous.map((event)=>event.eventId));const after=this.#historyProfile==="full"?(previous.at(-1)?.sequence??0):this.head.get();let replace=after===0;let body=await this.#readEventPages(after);if(body.head<after){body=await this.#readEventPages(0);replace=true;this.#historyProfile="full";}if(!replace&&!body.events.length&&body.head===after&&!Object.keys(body.content).length)return false;const complete=replace?body.events:[...previous,...body.events.filter((event)=>!known.has(event.eventId))];this.events.set(complete);const confirmedClientIds=this.#clientEventIds(complete);if(confirmedClientIds.size)this.optimisticEvents.set(this.optimisticEvents.get().filter((event)=>!confirmedClientIds.has(String(event.payload.client_event_id??""))));if(Object.keys(body.content).length)this.content.set({...this.content.get(),...body.content});this.head.set(body.head);this.#publishAppended(complete.filter((event)=>!known.has(event.eventId)));return true;}
  async refreshEvents(){if(await this.#refreshEvents())this.notify();}
  #scheduleJobPoll(delay=2_000){window.clearTimeout(this.#jobPollTimer);this.#jobPollTimer=window.setTimeout(()=>{if(document.visibilityState==="visible")void this.syncDocumentJobs();},delay);}
  #syncVisibleJobs(path=this.route.get()){if(path!==this.route.get())return;if(routeCapabilities(path).jobHistory||this.documentJobs.get().some((job)=>job.status==="queued"||job.status==="running"||job.status==="committing"))void this.syncDocumentJobs();else this.#scheduleJobPoll(1_200);}
  #jobScope(path=this.route.get()){const documentId=documentIdFromRoute(path);return documentId?`?document=${encodeURIComponent(documentId)}`:routeCapabilities(path).jobHistory?"":"?scope=active";}
  #driveDocumentJobs(jobs:DocumentJob[]){const next=[...jobs].filter((job)=>job.kind!=="prompt_fan"&&(job.status==="queued"||job.status==="running"||job.status==="committing")).sort((a,b)=>a.requestedAt.localeCompare(b.requestedAt)||a.jobId.localeCompare(b.jobId))[0];if(next&&(next.status==="queued"||documentJobIsStale(next))&&!this.#jobsDriving.has(next.jobId))void this.#driveDocumentJob(next);}
  async #driveDocumentJob(job:DocumentJob){this.#jobsDriving.add(job.jobId);try{const response=await fetch(`/api/document-jobs/${encodeURIComponent(job.jobId)}/run`,{method:"POST"});const body=await response.json() as {job?:DocumentJob;error?:string};if(!response.ok&&!body.job)throw new Error(body.error??"document_job_runner_failed");}catch{if(document.visibilityState==="visible")this.toast("The connection to the background operation ended. The app will recover it safely.");}finally{this.#jobsDriving.delete(job.jobId);this.#scheduleJobPoll(350);}}
  async syncDocumentJobs(){const scope=this.#jobScope();if(this.#jobsSyncing){if(scope!==this.#jobSyncScope)this.#jobResyncRequested=true;return;}this.#jobsSyncing=true;this.#jobSyncScope=scope;try{const response=await fetch(`/api/document-jobs${scope}`);if(!response.ok)throw new Error(`Job status returned ${response.status}`);const body=await response.json() as {jobs?:DocumentJob[]};if(this.#jobScope()!==scope){this.#jobResyncRequested=true;return;}const previous=new Map(this.documentJobs.get().map((job)=>[job.jobId,job]));const jobs=(body.jobs??[]).map((job)=>{const detail=this.#jobDetails.get(job.jobId);if(detail&&detail.updatedAt===job.updatedAt)return{...job,result:detail.result};if(detail)this.#jobDetails.delete(job.jobId);return job;});this.documentJobs.set(jobs);this.#jobPollFailures=0;this.#jobPollIssueNotified=false;
      const terminalChanges=jobs.filter((job)=>documentJobTerminal(job)&&(previous.has(job.jobId)?previous.get(job.jobId)?.status!==job.status:!job.notifiedAt&&!job.parentJobId));const fanProgress=jobs.some((job)=>job.kind==="prompt_fan"&&previous.has(job.jobId)&&previous.get(job.jobId)?.updatedAt!==job.updatedAt);const completed=terminalChanges.filter((job)=>!job.notifiedAt&&!job.parentJobId);if(terminalChanges.length||fanProgress)await Promise.all([this.#refreshEvents(),this.refreshSession()]);this.#syncAdaptiveSuggestionSets(jobs);
      for(const job of completed){if(job.kind==="structure_adaptive"&&job.status==="completed"&&job.result?.structure)this.adaptiveStructures.set({...this.adaptiveStructures.get(),[job.documentId]:job.result.structure as AdaptiveStructure});if(job.status==="completed"&&this.#jobResultVisible(job)){void this.#ackJob(job.jobId);continue;}if(document.visibilityState==="visible"){this.toast(this.#jobNotice(job));void this.#ackJob(job.jobId);}else this.#pendingJobNotices.push(job);}
      this.notify();this.#driveDocumentJobs(jobs);this.#scheduleJobPoll(jobs.some((job)=>job.status==="queued"||job.status==="running"||job.status==="committing")?1_500:60_000);
    }catch{this.#jobPollFailures+=1;if(this.#jobPollFailures>=3&&!this.#jobPollIssueNotified&&document.visibilityState==="visible"){this.#jobPollIssueNotified=true;this.toast("Background status is temporarily unavailable. Retrying…");}this.#scheduleJobPoll(5_000);}finally{this.#jobsSyncing=false;if(this.#jobResyncRequested||this.#jobScope()!==scope){this.#jobResyncRequested=false;queueMicrotask(()=>void this.syncDocumentJobs());}}}
  async #startDocumentJob(kind:DocumentJobKind,payload:Record<string,unknown>,sourceSurface:string,documentIdOverride?:string){const documentId=documentIdOverride??this.projection.get().documentId;const requestKey=String(payload.requestKey??"");if(requestKey&&this.#jobStarts.has(requestKey))throw new Error("This exact image request is already being queued.");if(requestKey){this.#jobStarts.add(requestKey);this.notify();}try{const navigation=this.#navigationCommit;await this.#appendPipeline;if(navigation&&!await navigation)throw new Error("The selected project could not be opened safely.");const action=kind==="preview"?"start a draft image":kind==="generate"?"start a full-quality image":kind==="prompt_fan"?"start a four-image prompt fan":`start ${kind.replaceAll("_"," ")}`;const response=await this.guardedFetch("/api/document-jobs",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({kind,documentId,sourceSurface,payload})},action);const body=await response.json() as {job?:DocumentJob;error?:string;message?:string;reused?:boolean;readiness?:GenerationReadiness};if(body.readiness&&requestKey)this.generationReadiness.set({...this.generationReadiness.get(),[requestKey]:body.readiness});if(!response.ok||!body.job)throw new Error(body.message??body.error??"Document operation could not be started");const jobs=[body.job,...this.documentJobs.get().filter((job)=>job.jobId!==body.job!.jobId)];this.documentJobs.set(jobs);if(requestKey)this.#readinessAcknowledgements.delete(requestKey);this.notify();this.#driveDocumentJobs(jobs);this.#scheduleJobPoll(800);return{job:body.job,reused:Boolean(body.reused)};}finally{if(requestKey){this.#jobStarts.delete(requestKey);this.notify();}}}
  patchUi(patch: Partial<typeof this.ui>) { Object.assign(this.ui, patch); this.notify(); }
  toast(message: string) { this.ui.toast = message; this.notify(); window.setTimeout(() => { if (this.ui.toast === message) { this.ui.toast = ""; this.notify(); } }, 2800); }
  async confirmImpersonatedInteraction(action="change this fictional account"){
    if(!this.session.get()?.impersonation)return true;if(this.#impersonationConfirmation)return false;this.patchUi({impersonationConfirmOpen:true,impersonationAction:action});return new Promise<boolean>((resolve)=>{this.#impersonationConfirmation=resolve;});
  }
  resolveImpersonatedInteraction(confirmed:boolean){const resolve=this.#impersonationConfirmation;this.#impersonationConfirmation=undefined;this.patchUi({impersonationConfirmOpen:false,impersonationAction:""});resolve?.(confirmed);if(!confirmed)this.toast("Canceled. The fictional account was not changed.");}
  async guardedFetch(input:RequestInfo|URL,init:RequestInit={},action="change this fictional account"){
    const method=String(init.method??(input instanceof Request?input.method:"GET")).toUpperCase();if(!this.session.get()?.impersonation||["GET","HEAD","OPTIONS"].includes(method))return fetch(input,init);const confirmed=await this.confirmImpersonatedInteraction(action);if(!confirmed)return Response.json({error:"Action canceled. No changes were made to the fictional account."},{status:409});const headers=new Headers(input instanceof Request?input.headers:undefined);new Headers(init.headers).forEach((value,key)=>headers.set(key,value));headers.set("x-forma-impersonation-confirmation","I understand, continue");return fetch(input,{...init,headers});
  }
  async startImpersonating(personaId:string,route="/projects"){
    const response=await fetch("/api/impersonation",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({personaId,confirmation:"I understand, continue"})});const body=await response.json() as {route?:string;error?:string};if(!response.ok)throw new Error(body.error??"The fictional account could not be opened");window.location.assign(body.route??route);
  }
  async stopImpersonating(){const response=await fetch("/api/impersonation",{method:"DELETE"});const body=await response.json() as {route?:string;error?:string};if(!response.ok)throw new Error(body.error??"Your regular account could not be restored");window.location.assign(body.route??"/laboratory/replay");}
  setRoute(path: string, options: { replace?: boolean; documentFocus?: boolean } = {}) {
    const projection = this.projection.get();
    const requestedFocus = options.documentFocus ?? (documentFocusFromRoute(path) || documentFocusFromRoute(this.route.get()));
    const focusAwarePath = isDocumentViewRoute(path) ? withDocumentFocusInRoute(path, requestedFocus) : path;
    const requestedDocumentId = documentIdFromRoute(focusAwarePath);
    const routeDocumentId = requestedDocumentId || projection.documentId;
    const routeDocumentTitle = projection.documents.find((document) => document.id === routeDocumentId)?.title ?? (routeDocumentId === projection.documentId ? projection.documentTitle : "");
    const routedPath = isDocumentViewRoute(focusAwarePath) && routeDocumentId ? withDocumentInRoute(focusAwarePath, routeDocumentId, routeDocumentTitle) : focusAwarePath;
    const current = `${location.pathname}${location.search}${location.hash}`;
    if (current !== routedPath) {
      if (options.replace) history.replaceState({}, "", routedPath);
      else history.pushState({}, "", routedPath);
      if(!this.loading.get()){
        beginRoutePopulation(routedPath);
        recordRouteHistoryProfile(this.#historyProfile);
        recordPrivateContentState(routeCapabilities(routedPath).privateContent?(Object.keys(this.content.get()).length?"ready":"pending"):"not-required");
        recordPopulationSource("memory",this.events.get().length);
      }
    }
    this.route.set(routedPath); this.notify(); window.dispatchEvent(new CustomEvent("forma-route-changed", { detail: { path: routedPath } }));
    const required=this.#profileForRoute(routedPath);
    if(eventProfileRank(this.#historyProfile)<eventProfileRank(required))void this.#upgradeHistory(required).catch((error)=>{console.warn("[forma-performance]",JSON.stringify({phase:"history-upgrade",message:error instanceof Error?error.message:"history_upgrade_failed"}));});
    if(routeCapabilities(routedPath).privateContent&&!this.loading.get())requestAnimationFrame(()=>void this.#hydrateVisiblePrivateContent().catch(()=>undefined));
    if(!this.loading.get()&&this.#jobScope(current)!==this.#jobScope(routedPath))requestAnimationFrame(()=>this.#syncVisibleJobs(routedPath));
  }

  async syncDocumentFromRoute(path = this.route.get()) {
    if (!isDocumentViewRoute(path) || !this.events.get().length) return;
    const projection = this.projection.get();
    const requestedDocumentId = documentIdFromRoute(path);
    if (!requestedDocumentId) {
      if (projection.documentId) this.setRoute(withDocumentInRoute(path, projection.documentId, projection.documentTitle), { replace: true });
      return;
    }
    const requestedDocument = projection.documents.find((document) => document.id === requestedDocumentId);
    if (!requestedDocument) {
      this.setRoute(withDocumentInRoute(path, projection.documentId, projection.documentTitle), { replace: true });
      this.toast("That document is unavailable; the current document was opened instead.");
      return;
    }
    if (requestedDocumentId !== projection.documentId) {
      const opened = await this.openDocument(requestedDocumentId, path, "shared-document-url");
      if (!opened) this.setRoute(withDocumentInRoute(path, projection.documentId, projection.documentTitle), { replace: true });
    }
    else {
      const canonicalRoute = withDocumentInRoute(path, projection.documentId, projection.documentTitle);
      if (canonicalRoute !== path) this.setRoute(canonicalRoute, { replace: true });
    }
  }
  setAttentionCapture(enabled:boolean){if(this.session.get()?.impersonation){this.patchUi({attentionCapture:false,attentionPaused:true});this.toast("Attention capture stays off while you experience a fictional account.");return;}writeAttentionPreference(enabled,this.session.get()?.user.userId??"anonymous");this.patchUi({attentionCapture:enabled,attentionPaused:false});this.toast(enabled?"Attention signals enabled for this account on this device.":"Attention signals disabled; the current episode was closed.");}
  setAttentionPaused(paused:boolean){this.patchUi({attentionPaused:paused});this.toast(paused?"Attention capture paused on this device.":"Attention capture resumed.");}
  async forgetAttentionSignals(){window.dispatchEvent(new Event("forma-attention-forget"));const appended=await this.append({type:"AttentionSignalsForgotten",payload:{scope:"all-attention-episodes",before_sequence:this.head.get(),reason:"user-requested",device_ledger_cleared:true}});if(appended.length)this.toast("Attention episodes were forgotten and excluded from Scout and Memory.");return appended;}

  async load() {
    const path=this.route.get();const profile=this.#profileForRoute(path);const started=performance.now();
    beginRoutePopulation(path);
    recordRouteHistoryProfile(profile);
    recordPrivateContentState(routeCapabilities(path).privateContent?"pending":"not-required");
    this.loading.set(true); this.notify();
    try {
      // The document's streamed session is verified on this exact request. Cached
      // account data remains invisible until that authoritative identity is known.
      const snapshotsPromise=readAccountSnapshots();
      const bootstrap=consumeSessionBootstrap();
      const prefetched=consumeSessionPrefetch();
      const sessionPromise=bootstrap?Promise.resolve(this.#applySession(bootstrap)):this.refreshSession(prefetched);
      if(documentViewFromRoute(path)==="chat")void sessionPromise.then((verified)=>{if(this.session.get()?.user.userId!==verified.user.userId||this.route.get()!==path)return;return this.#hydrateVisiblePrivateContent();}).catch(()=>undefined);
      const live=snapshotsPromise.then(async(snapshots)=>{
        if(snapshots.length){
          const verified=await sessionPromise;
          const snapshot=matchingAccountSnapshot(snapshots,this.#snapshotIdentity(verified),profile);
          if(snapshot)return this.#readEventStream(snapshot.head,snapshot.profile,false);
        }
        return this.#readEventStream(0,profile,false);
      });
      const [session,snapshots]=await Promise.all([sessionPromise,snapshotsPromise]);
      recordSessionReady(started,bootstrap?"document":prefetched?"prefetch":"request");
      const identity=this.#snapshotIdentity(session);
      const cached=matchingAccountSnapshot(snapshots,identity,profile);
      if(cached){
        this.events.set(cached.events);this.head.set(cached.head);this.#historyProfile=cached.profile;
        recordPopulationSource("indexeddb",cached.events.length);
        void live.then(async(current)=>{
          if(current.head<cached.head){const restored=await this.#readEventStream(0,profile,false);this.events.set(restored.events);this.content.set(restored.content);this.head.set(restored.head);this.#historyProfile=profile;this.notify();}
          else if(current.head>cached.head){const merged=new Map([...this.events.get(),...current.events].map((event)=>[event.eventId,event]));this.events.set([...merged.values()].sort((left,right)=>left.sequence-right.sequence||left.eventId.localeCompare(right.eventId)));if(Object.keys(current.content).length)this.content.set({...this.content.get(),...current.content});this.head.set(current.head);this.#publishAppended(current.events);this.notify();void writeAccountSnapshot(identity,this.events.get(),this.head.get(),this.#historyProfile);}
        }).catch((error)=>console.warn("[forma-performance]",JSON.stringify({phase:"cache-revalidation",message:error instanceof Error?error.message:"cache_revalidation_failed"})));
      }else{
        const body=await live;
        this.events.set(body.events);this.content.set(body.content);this.head.set(body.head);this.#historyProfile=profile;
        recordPopulationSource("miss",body.events.length);
        void writeAccountSnapshot(identity,body.events,body.head,profile);
      }
      this.error.set("");this.loading.set(false);this.notify();
      requestAnimationFrame(()=>{
        void this.syncDocumentFromRoute(this.route.get());
        this.#syncVisibleJobs(this.route.get());
        if(routeCapabilities(this.route.get()).privateContent)void this.#hydrateVisiblePrivateContent().catch(()=>undefined);
      });
    } catch (error) { this.error.set(error instanceof Error ? error.message : "Unable to load event stream"); }
    finally { this.loading.set(false); this.notify(); }
  }

  #applySession(body:PilotSession){const previousUserId=this.session.get()?.user.userId;this.session.set(body);if(body.impersonation){this.ui.attentionCapture=false;this.ui.attentionPaused=true;}else if(previousUserId!==body.user.userId){this.ui.attentionCapture=readAttentionPreference(body.user.userId);this.ui.attentionPaused=false;}this.notify();return body;}

  async refreshSession(prefetched:Promise<Response>|null=null) {
    const response = await (prefetched?prefetched.catch(()=>fetch("/api/session")):fetch("/api/session")); const body = await response.json() as PilotSession & { error?: string };
    if (!response.ok) throw new Error(body.error ?? "Authentication required");return this.#applySession(body);
  }

  async acceptTerms() {
    this.busy.set("consent"); this.notify();
    try {
      const response = await fetch("/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "accept_terms", ownershipConfirmed: true, providerProcessingConfirmed: true }) });
      const body = await response.json() as PilotSession & { error?: string }; if (!response.ok) throw new Error(body.error ?? "Consent could not be recorded");
      this.session.set(body); await this.load(); this.toast("Pilot terms accepted and witnessed in the event stream.");
    } catch (error) { this.toast(error instanceof Error ? error.message : "Consent failed"); }
    finally { this.busy.set(""); this.notify(); }
  }

  async append(event: EventInput, options: { expected?: number; remember?: boolean; rebaseAttempts?: number; silent?: boolean; background?: boolean } = {}) {
    return this.appendBatch([event], options);
  }

  async appendBatch(events: EventInput[], options: { expected?: number; remember?: boolean; rebaseAttempts?: number; silent?: boolean; background?: boolean } = {}) {
    const pending=this.#appendPipeline.then(()=>this.#appendBatchNow(events,options));this.#appendPipeline=pending.then(()=>undefined,()=>undefined);return pending;
  }

  async #appendBatchNow(events: EventInput[], options: { expected?: number; remember?: boolean; rebaseAttempts?: number; silent?: boolean; background?: boolean } = {}) {
    if(!options.background)this.busy.set(events[0]?.type ?? "append"); this.appendFailure.set(""); this.notify();
    try {
      let response:Response;let body:{ appended?: CreativeEvent[]; rejected?: Array<{ index?: number; type?: string; reason: string }>; head?: number; error?: string }={};
      const attempts=options.expected===undefined?Math.max(1,Math.min(6,options.rebaseAttempts??2)):1;
      for(let attempt=0;attempt<attempts;attempt+=1){response=await this.guardedFetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: events.length > 1 ? "batch" : "append", event: events[0], events, expectedSequence: options.expected ?? this.head.get(), clientId: "web:lit" }) },events.length>1?`apply ${events.length} document changes`:`record ${events[0]?.type??"this change"}`);body=await response.json() as typeof body;if(response.status===409&&body.error==="stale_sequence"&&options.expected===undefined&&attempt<attempts-1){await this.#refreshEvents();continue;}if(!response.ok)throw new Error(body.error==="stale_sequence"?"The document changed elsewhere. Its latest state is now loaded; try that change again.":body.error??"Append rejected");break;}
      const appended = body.appended ?? [];
      this.events.set([...this.events.get(), ...appended]); this.head.set(body.head ?? this.head.get()); this.#publishAppended(appended);
      this.#reflectDocumentInRoute();
      if (options.remember !== false) { const remembered=appended.filter((e) => e.actor === "user" && !e.compensatesEventId && inverseEvent(e));if(remembered.length)this.#undo.push(remembered);this.#redo = []; }
      if (body.rejected?.length) {const reasons=[...new Set(body.rejected.map((item)=>`${item.type?`${item.type}: `:""}${item.reason}`))];this.appendFailure.set(reasons.join("; "));this.toast(documentViewFromRoute(this.route.get()) === "editor" ? `${body.rejected.length} change${body.rejected.length === 1 ? "" : "s"} could not be saved; the other changes are safe.` : `${body.rejected.length} event${body.rejected.length === 1 ? "" : "s"} rejected; valid events still appended.`);}
      return appended;
    } catch (error) { const message=error instanceof Error ? error.message : "Append failed";this.appendFailure.set(message);if(!options.silent)this.toast(message); return []; }
    finally { if(!options.background)this.busy.set(""); this.notify(); }
  }

  async copyLibraryBlockSet(rootBlockId:string,destinationDocumentId=this.projection.get().documentId,sourceSurface="library"){
    const projection=this.projection.get();const available=new Map(projection.libraryBlocks.filter((block)=>!block.removed&&block.projectId===projection.projectId).map((block)=>[block.id,block]));const root=available.get(rootBlockId);
    if(!root){this.toast("That reusable context is no longer available.");return null;}
    const connected=new Set([root.id]);let changed=true;while(changed&&connected.size<24){changed=false;for(const relation of projection.libraryBlockRelations){if(connected.has(relation.fromBlockId)&&available.has(relation.toBlockId)&&!connected.has(relation.toBlockId)){connected.add(relation.toBlockId);changed=true;}if(connected.size>=24)break;}}
    const blocks=[...connected].map((id)=>available.get(id)!).sort((left,right)=>left.id===root.id?-1:right.id===root.id?1:left.position.localeCompare(right.position));const ids=new Map(blocks.map((block)=>[block.id,crypto.randomUUID()]));const contextSetId=crypto.randomUUID();const base=this.head.get()+1;
    const groupRole=combinedContextRoleForBlockType(root.type),groupName=String(root.properties.label??root.properties.text??root.handle),groupRelativity=Math.max(.5,Math.min(1,Number(root.properties.weight??.8)));const events:EventInput[]=blocks.map((block,index)=>{const authoredMemberships=combinedContextMemberships(block.properties);return{type:"BlockCreated",payload:{block_id:ids.get(block.id),document_id:destinationDocumentId,type:block.type,handle:`${block.handle}-copy-${String(base+index).padStart(3,"0")}`,position:`z${String(base+index).padStart(6,"0")}`,properties:{...block.properties,authority:"authored",copied_from_block_id:block.id,copied_as_context_set:blocks.length>1,context_set_id:contextSetId,context_set_root_id:ids.get(root.id),combined_context_memberships:authoredMemberships.length?authoredMemberships.map((membership)=>({...membership,contextSetId,memberOrder:index,sourceCanvasId:""})):blocks.length>1?[{contextSetId,name:groupName,role:groupRole,target:groupName,application:"isolate",relativity:groupRelativity,memberOrder:index,sourceCanvasId:""}]:[],semantic_isolation:blocks.length>1,created_from:sourceSurface}}};});
    for(const relation of projection.libraryBlockRelations){const from=ids.get(relation.fromBlockId);const to=ids.get(relation.toBlockId);if(!from||!to)continue;events.push({type:"BlockRelationAdded",payload:{relation_id:crypto.randomUUID(),project_id:projection.projectId,document_id:destinationDocumentId,from_block_id:from,to_block_id:to,kind:relation.kind,properties:{...relation.properties,copied_from_relation_id:relation.id,context_set_id:contextSetId},source_surface:sourceSurface}});}
    const appended=await this.appendBatch(events);if(!appended.length)return null;const copiedRootId=ids.get(root.id)!;this.patchUi({focusBlockId:copiedRootId});this.toast(blocks.length===1?"Reusable block added to the open document.":`${blocks.length} connected blocks added as one context set.`);return{rootBlockId:copiedRootId,blockCount:blocks.length,relationCount:events.length-blocks.length};
  }

  #relatedOutputBlocks(blockId:string){
    const projection=this.projection.get(),target=projection.libraryBlocks.find((block)=>block.id===blockId);if(!target)return[];
    const rootId=target.properties.source_artifact_item_id?projection.libraryBlockRelations.find((relation)=>relation.kind==="artifact_contains"&&relation.toBlockId===target.id)?.fromBlockId??String(target.properties.context_set_root_id??""):target.id;
    const relationIds=new Set(projection.libraryBlockRelations.filter((relation)=>relation.kind==="artifact_contains"&&relation.fromBlockId===rootId).map((relation)=>relation.toBlockId));
    if(relationIds.size)return projection.libraryBlocks.filter((block)=>block.id===rootId||relationIds.has(block.id));
    return projection.libraryBlocks.filter((block)=>block.id===rootId||block.id===target.id||block.properties.context_set_root_id===rootId);
  }

  outputOwnedBlockCount(blockId:string){return this.projection.get().libraryBlockRelations.filter((relation)=>relation.kind==="artifact_contains"&&relation.fromBlockId===blockId).length;}

  outputBlockRemovalEvents(input:EventInput){
    const projection=this.projection.get(),target=projection.libraryBlocks.find((block)=>block.id===String(input.payload.block_id??""));
    if(!target)return[];
    if(target.locked){this.toast("Unlock this input before removing it.");return[];}
    const owner=projection.libraryBlockRelations.find((relation)=>relation.kind==="artifact_contains"&&relation.toBlockId===target.id);
    if(owner){this.toast("This frame belongs to a storyboard. Remove the complete storyboard to keep every future generation in sync.");return[];}
    const ownedIds=new Set(projection.libraryBlockRelations.filter((relation)=>relation.kind==="artifact_contains"&&relation.fromBlockId===target.id).map((relation)=>relation.toBlockId));
    const owned=projection.libraryBlocks.filter((block)=>ownedIds.has(block.id));
    if(owned.some((block)=>block.locked)){this.toast("Unlock every linked storyboard frame before removing this input.");return[];}
    return ownedOutputBlockRemovalEvents(target,projection.libraryBlocks,projection.libraryBlockRelations,input);
  }

  async removeOutputBlock(input:EventInput){const events=this.outputBlockRemovalEvents(input);if(!events.length)return[];return this.appendBatch(events,{rebaseAttempts:6});}

  outputBlockTextEvents(blockId:string,value:string,sourceSurface="output-context-editor"){
    const block=this.projection.get().libraryBlocks.find((candidate)=>candidate.id===blockId);if(!block)return[];
    return outputBlockTextEditEvents(block,this.#relatedOutputBlocks(blockId),value,sourceSurface);
  }

  async saveBlockText(blockId:string,value:string,sourceSurface="output-context-editor"){
    const events=this.outputBlockTextEvents(blockId,value,sourceSurface);if(!events.length)return[];return this.appendBatch(events,{rebaseAttempts:6});
  }

  async saveOutputInput(blockId:string,draft:OutputInputDraft,sourceSurface="output-input-editor"){
    const root=this.projection.get().libraryBlocks.find((block)=>block.id===blockId);if(!root)return false;
    const events=this.outputInputEvents(blockId,draft,sourceSurface);
    if(!events.length){if(JSON.stringify(outputInputDraft(root))===JSON.stringify(draft)){this.toast("Your input is already up to date.");return true;}this.toast(root.locked?"Unlock this input before editing it.":"Unlock the related storyboard frame before saving these changes.");return false;}
    const appended=await this.appendBatch(events,{rebaseAttempts:6});if(appended.length)this.toast("Your customized input is saved. The original output remains unchanged.");return Boolean(appended.length);
  }

  outputInputEvents(blockId:string,draft:OutputInputDraft,sourceSurface="output-input-editor"){
    const root=this.projection.get().libraryBlocks.find((block)=>block.id===blockId);if(!root)return[];return outputInputEditEvents(root,this.#relatedOutputBlocks(blockId),draft,{sourceSurface});
  }

  async revealOutputInput(blockId:string,destinationDocumentId=this.projection.get().documentId){
    if(!blockId)return false;
    const projection=this.projection.get(),targetDocument=projection.documents.find((item)=>item.id===destinationDocumentId);if(!targetDocument)return false;
    if(!isDocumentViewRoute(this.route.get())||projection.documentId!==destinationDocumentId||documentViewFromRoute(this.route.get())!=="document"){
      const opened=await this.openDocument(destinationDocumentId,withDocumentInRoute("/",destinationDocumentId,targetDocument.title),"output-input");if(!opened)return false;
    }
    this.patchUi({focusBlockId:blockId,editingBlockId:blockId});
    let attempts=0;const focus=()=>{const block=document.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(blockId)}"]`),field=block?.querySelector<HTMLTextAreaElement>("forma-ui-rich-text textarea")??block?.querySelector<HTMLTextAreaElement>("textarea");if(field&&!document.querySelector("dialog[open]")){const reduced=window.matchMedia("(prefers-reduced-motion: reduce)").matches;block?.scrollIntoView({block:"center",behavior:reduced?"instant":"smooth"});field.focus({preventScroll:true});return;}if(attempts++<24)window.requestAnimationFrame(focus);};window.requestAnimationFrame(focus);return true;
  }

  async addArtifactAsContext(artifactId:string,destinationDocumentId=this.projection.get().documentId,sourceSurface="document-artifact-viewer",options:{reveal?:boolean;presentation?:SlidePresentation|null}={}){
    const projection=this.projection.get();const artifact=projection.libraryArtifacts.find((candidate)=>candidate.id===artifactId);
    if(!artifact){this.toast("That output is no longer available.");return null;}
    const document=projection.documents.find((candidate)=>candidate.id===destinationDocumentId);if(!document){this.toast("Choose an available document before adding output context.");return null;}
    const existingBlocks=projection.libraryBlocks.filter((block)=>block.documentId===destinationDocumentId&&block.properties.source_artifact_id===artifact.id);const existingRoot=existingBlocks.find((block)=>!block.properties.source_artifact_item_id);const existingSourceItemIds=existingBlocks.map((block)=>String(block.properties.source_artifact_item_id??"")).filter(Boolean);const contextSetId=String(existingRoot?.properties.context_set_id??"")||undefined;
    const availableFrames=artifact.kind==="storyboard"?artifact.items.filter((item)=>Boolean(item.mediaUrl)).length:0;
    if(existingRoot&&existingSourceItemIds.length>=availableFrames){if(options.reveal!==false)await this.revealOutputInput(existingRoot.id,destinationDocumentId);return{rootBlockId:existingRoot.id,created:false,blockCount:0,availableMemberCount:1+availableFrames};}
    const retained=artifact.contentRef?await this.ensurePrivateContent(artifact.contentRef):null;let content=parseDocumentArtifactContent(retained??undefined);if(content&&artifact.kind==="slides"&&options.presentation)content={...content,presentation:structuredClone(options.presentation)};
    if(artifact.contentRef&&!content){this.toast("The complete original output is unavailable, so an incomplete copy was not created.");return null;}
    const result=artifactContextEvents(artifact,{documentId:destinationDocumentId,projectId:document.projectId,sourceSurface,content,existingRootBlockId:existingRoot?.id,existingSourceItemIds,contextSetId,positionStart:this.head.get()+1});
    if(!result.blockIds.length){if(existingRoot&&options.reveal!==false)await this.revealOutputInput(existingRoot.id,destinationDocumentId);return{rootBlockId:existingRoot?.id??"",created:false,blockCount:0,availableMemberCount:result.availableMemberCount};}
    const appended=await this.appendBatch(result.events,{rebaseAttempts:6});const created=appended.filter((event)=>event.type==="BlockCreated").length;if(!created)return null;
    const rootBlockId=existingRoot?.id??result.blockIds[0]??"";if(options.reveal!==false)await this.revealOutputInput(rootBlockId,destinationDocumentId);else this.patchUi({focusBlockId:rootBlockId});this.toast(`${artifact.title} is ready to customize${artifact.kind==="storyboard"?", with its finished frames kept in order":""}.`);return{rootBlockId,created:true,blockCount:created,availableMemberCount:result.availableMemberCount};
  }

  async addStoryboardFramesAsContext(artifactId:string,destinationDocumentId=this.projection.get().documentId,sourceSurface="document-artifact-viewer"){return this.addArtifactAsContext(artifactId,destinationDocumentId,sourceSurface);}

  async addImageOutputAsContext(outputId:string,destinationDocumentId=this.projection.get().documentId,sourceSurface="output-card",options:{reveal?:boolean}={}){
    const projection=this.projection.get();const output=projection.libraryOutputs.find((candidate)=>candidate.id===outputId);if(!output){this.toast("That generated image is no longer available.");return null;}
    const document=projection.documents.find((candidate)=>candidate.id===destinationDocumentId);if(!document){this.toast("Choose an available document before using this image as input.");return null;}
    const existing=projection.libraryBlocks.find((block)=>block.documentId===destinationDocumentId&&block.properties.source_output_id===output.id);if(existing){if(options.reveal!==false)await this.revealOutputInput(existing.id,destinationDocumentId);return{rootBlockId:existing.id,created:false,blockCount:0};}
    const retained=output.contentRef?await this.ensurePrivateContent(output.contentRef):null;let direction:Record<string,unknown>|null=null;if(retained)try{const parsed=JSON.parse(retained) as unknown;if(parsed&&typeof parsed==="object"&&!Array.isArray(parsed))direction=parsed as Record<string,unknown>;}catch{/* Existing image rights and pixels remain usable when optional direction is absent. */}
    const result=imageOutputContextEvents(output,{documentId:destinationDocumentId,projectId:document.projectId,sourceSurface,content:direction,positionStart:this.head.get()+1});if(!result.events.length){this.toast("The generated image has no durable media to use as input.");return null;}
    const appended=await this.appendBatch(result.events,{rebaseAttempts:6});const created=appended.filter((event)=>event.type==="BlockCreated").length;if(!created)return null;const rootBlockId=result.blockIds[0]??"";if(options.reveal!==false)await this.revealOutputInput(rootBlockId,destinationDocumentId);else this.patchUi({focusBlockId:rootBlockId});this.toast("The generated image and its editable direction are ready to reuse.");return{rootBlockId,created:true,blockCount:created};
  }

  async hot(event: EventInput, options: { keepalive?: boolean } = {}) {
    if(this.session.get()?.impersonation)return;
    try {
      if(!options.keepalive)await this.#appendPipeline;
      const response = await fetch("/api/events/hot", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "hot", event, events: [event], clientId: "web:lit" }), keepalive: options.keepalive });
      if (!response.ok) return;
      const body = await response.json() as { appended?: CreativeEvent[]; head?: number };
      const appended=body.appended??[];this.events.set([...this.events.get(), ...appended].sort((left,right)=>left.sequence-right.sequence)); this.head.set(Math.max(this.head.get(),body.head??0)); this.#publishAppended(appended);this.notify();
    } catch { /* Engagement instrumentation never blocks the creative action. */ }
  }

  async propose(prompt: string, events: EventInput[], exemplarRefs: Array<Record<string, unknown>> = []) {
    this.busy.set("proposal"); this.notify();
    try {
      const response = await this.guardedFetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "propose", prompt, events, exemplarRefs, expectedSequence: this.head.get(), clientId: "web:lit" }) },"ask the assistant to propose document changes");
      if (!response.ok) throw new Error("Proposal could not be recorded");
      const body = await response.json() as { appended: CreativeEvent[]; head: number };
      this.events.set([...this.events.get(), ...body.appended]); this.head.set(body.head); this.toast("Proposal recorded — review it before applying.");
      return body.appended[0];
    } finally { this.busy.set(""); this.notify(); }
  }

  async preview(sourceSurface?: string,promptTechnique?:PromptTechnique) {
    const technique=normalizePromptTechnique(promptTechnique??this.promptTechniquePreference().technique);
    try{const context=this.#generationContext();const requestKey=generationRequestKeyFor("preview",context.documentRevision,null,technique);const {reused}=await this.#startDocumentJob("preview",{...context,requestKey,promptTechnique:technique,preflightAcknowledged:this.generationRiskAcknowledged(requestKey)},sourceSurface??"studio");this.toast(reused?"This exact draft is already in the queue.":`${technique==="prose"?"Draft":`${technique} draft`} queued. You can keep editing and queue the updated document too.`);}catch(error){this.toast(error instanceof Error?error.message:"Draft generation failed");}
  }

  async generate(options?: string | { sourceSurface?: string; sourcePreviewId?: string; promptTechnique?: PromptTechnique }) {
    const sourceSurface=typeof options==="string"?options:options?.sourceSurface;const sourcePreviewId=typeof options==="string"?undefined:options?.sourcePreviewId;const technique=normalizePromptTechnique(typeof options==="string"?this.promptTechniquePreference().technique:options?.promptTechnique??this.promptTechniquePreference().technique);
    try {
      const context=this.#generationContext();const requestKey=generationRequestKeyFor("generate",context.documentRevision,sourcePreviewId,technique);const {reused}=await this.#startDocumentJob("generate",{sourcePreviewId,...context,requestKey,promptTechnique:technique,preflightAcknowledged:this.generationRiskAcknowledged(requestKey)},sourceSurface??"studio");this.toast(reused?"This exact full-quality image is already in the queue.":`${technique==="prose"?"Full-quality generation":`${technique} full-quality generation`} queued. You can keep editing and queue the updated document too.`);
    } catch (error) { this.toast(error instanceof Error ? error.message : "Generation failed"); }
  }

  async generatePromptFan(kind:"preview"|"generate",options:{sourceSurface?:string;sourcePreviewId?:string}={}){
    const context=this.#generationContext();const promptFanId=crypto.randomUUID();const requestKey=`prompt-fan:${kind}:${context.documentRevision}:${options.sourcePreviewId||"document"}`;
    try{const {reused}=await this.#startDocumentJob("prompt_fan",{...context,fanKind:kind,sourcePreviewId:options.sourcePreviewId,requestKey,promptFanId,preflightAcknowledged:this.generationRiskAcknowledged(requestKey)},options.sourceSurface??"studio");this.toast(reused?"This exact fan is already in the queue.":`${kind==="preview"?"Draft":"Full-quality"} fan accepted as one generation · four prompt processes.`);}catch(error){this.toast(error instanceof Error?error.message:"The fan generation could not be started.");}
    return promptFanId;
  }

  async retryDocumentGeneration(job:DocumentJob,promptTechnique?:PromptTechnique){
    const technique=normalizePromptTechnique(promptTechnique??job.promptTechnique);
    if(promptTechnique){const kind=job.kind==="prompt_fan"?job.fanKind??"generate":job.kind==="preview"?"preview":"generate";this.#readinessAcknowledgements.add(this.generationReadinessRequestKey(kind,job.sourcePreviewId,technique));}
    if(job.kind==="preview")return this.preview(job.sourceSurface,technique);
    if(job.kind==="generate")return this.generate({sourceSurface:job.sourceSurface,sourcePreviewId:job.sourcePreviewId??undefined,promptTechnique:technique});
    if(job.kind==="prompt_fan"&&job.fanKind&&promptTechnique)return job.fanKind==="preview"?this.preview(job.sourceSurface,technique):this.generate({sourceSurface:job.sourceSurface,sourcePreviewId:job.sourcePreviewId??undefined,promptTechnique:technique});
    if(job.kind==="prompt_fan"&&job.fanKind)return this.generatePromptFan(job.fanKind,{sourceSurface:job.sourceSurface,sourcePreviewId:job.sourcePreviewId??undefined});
  }

  async preferPromptTechnique(technique:PromptTechnique,scope:PromptPreferenceScope,source:{fanId?:string|null;outputId?:string|null}={}){
    const projection=this.projection.get();const collectionId=projection.membership[projection.documentId]?.collectionId;const scopeId=scope==="document"?projection.documentId:scope==="collection"?collectionId:scope==="project"?projection.projectId:this.session.get()?.user.userId;
    if(!scopeId){this.toast("File this document in a collection before setting a folder preference.");return false;}
    const appended=await this.append({type:"PromptTechniquePreferred",payload:{preference_id:crypto.randomUUID(),preference_kind:"prompt_technique",technique:normalizePromptTechnique(technique),scope,scope_id:scopeId,document_id:projection.documentId,project_id:projection.projectId,source_fan_id:source.fanId??null,source_output_id:source.outputId??null}});
    if(appended.length)this.toast(`${normalizePromptTechnique(technique)} prompts preferred for this ${scope==="collection"?"folder":scope}.`);return Boolean(appended.length);
  }

  async adoptCanvasOutputItems(items:readonly{sourceKind:string;sourceId:string}[],documentId:string,sourceSurface="canvas-generation"){
    const projection=this.projection.get();if(!projection.documents.some((document)=>document.id===documentId)){this.toast("Choose an available document before reusing the selected outputs.");return null;}
    const unique=new Map<string,{sourceKind:string;sourceId:string}>();for(const item of items)if(item.sourceKind==="output"||item.sourceKind==="artifact")unique.set(`${item.sourceKind}:${item.sourceId}`,item);
    for(const item of unique.values()){
      if(item.sourceKind==="output"){const output=projection.libraryOutputs.find((candidate)=>candidate.id===item.sourceId),existing=projection.libraryBlocks.find((block)=>block.documentId===documentId&&block.properties.source_output_id===item.sourceId);if(!output||!existing?.properties.media_url&&!output.mediaUrl){this.toast("A selected generated image is unavailable, so your document was left unchanged.");return null;}continue;}
      const artifact=projection.libraryArtifacts.find((candidate)=>candidate.id===item.sourceId);if(!artifact){this.toast("A selected output is unavailable, so your document was left unchanged.");return null;}
      const existingRoot=projection.libraryBlocks.find((block)=>block.documentId===documentId&&block.properties.source_artifact_id===artifact.id&&!block.properties.source_artifact_item_id);const ownedIds=new Set(projection.libraryBlockRelations.filter((relation)=>relation.kind==="artifact_contains"&&relation.fromBlockId===existingRoot?.id).map((relation)=>relation.toBlockId));const finished=new Set(artifact.items.filter((entry)=>Boolean(entry.mediaUrl)).map((entry)=>entry.id));const available=new Set(projection.libraryBlocks.filter((block)=>ownedIds.has(block.id)&&finished.has(String(block.properties.source_artifact_item_id??""))).map((block)=>String(block.properties.source_artifact_item_id)));if(existingRoot&&(artifact.kind!=="storyboard"||available.size===finished.size))continue;
      if(artifact.contentRef&&!parseDocumentArtifactContent(await this.ensurePrivateContent(artifact.contentRef)??undefined)){this.toast(`${artifact.title} is unavailable, so your document was left unchanged.`);return null;}
    }
    const rootIds:string[]=[];for(const item of unique.values()){const result=item.sourceKind==="output"?await this.addImageOutputAsContext(item.sourceId,documentId,`${sourceSurface}-output`,{reveal:false}):await this.addArtifactAsContext(item.sourceId,documentId,`${sourceSurface}-artifact`,{reveal:false});if(!result?.rootBlockId)return null;rootIds.push(result.rootBlockId);}
    return rootIds;
  }

  async generateCanvasContext(kind:"preview"|"generate"|"preview_fan"|"generate_fan",contextSet:CanvasContextSet,sourcePreviewId?:string){
    let projection=this.projection.get();const canvas=this.canvasProjection.get();const itemIds=new Set(contextSet.itemIds);const visitedSets=new Set<string>();const expandSet=(setId:string)=>{if(visitedSets.has(setId))return;visitedSets.add(setId);const nested=canvas.contextSets.find((candidate)=>candidate.id===setId);if(!nested)return;for(const itemId of nested.itemIds){itemIds.add(itemId);const item=canvas.items.find((candidate)=>candidate.id===itemId);if(item?.sourceKind==="context")expandSet(item.sourceId);}};for(const itemId of [...itemIds]){const item=canvas.items.find((candidate)=>candidate.id===itemId);if(item?.sourceKind==="context")expandSet(item.sourceId);}const selectedItems=canvas.items.filter((item)=>itemIds.has(item.id)&&item.sourceKind!=="context");
    const selectedDocumentIds=selectedItems.filter((item)=>item.sourceKind==="document").map((item)=>item.sourceId);const anchorDocumentId=[...contextSet.documentIds,...selectedDocumentIds].find((id)=>projection.documents.some((document)=>document.id===id))??projection.documents[0]?.id??projection.documentId;if(!anchorDocumentId){this.toast("Create a project document before starting a Canvas generation.");return false;}
    const blockIds=new Set(contextSet.blockIds);for(const nestedId of visitedSets){const nested=canvas.contextSets.find((candidate)=>candidate.id===nestedId);for(const blockId of nested?.blockIds??[])blockIds.add(blockId);}
    const roots=await this.adoptCanvasOutputItems(selectedItems,anchorDocumentId);if(!roots)return false;projection=this.projection.get();for(const rootId of roots)blockIds.add(rootId);
    for(const documentId of [...contextSet.documentIds,...selectedDocumentIds])for(const block of projection.libraryBlocks)if(block.documentId===documentId)blockIds.add(block.id);
    for(const relation of projection.libraryBlockRelations)if(relation.kind==="artifact_contains"&&blockIds.has(relation.fromBlockId))blockIds.add(relation.toBlockId);
    const blocks=projection.libraryBlocks.filter((block)=>blockIds.has(block.id));const selectedBySource=new Map(selectedItems.map((item)=>[item.sourceId,item]));
    const facts=blocks.map((block)=>{const item=selectedBySource.get(block.id)??selectedBySource.get(String(block.properties.source_output_id??block.properties.source_artifact_id??""));return{block_id:block.id,canvas_id:contextSet.canvasId,context_set_id:contextSet.id,type:block.type,role:block.type,intent:blockIntentFor(block.type,block.properties),handle:block.handle,active:Number(block.properties.weight??.5)>0,effect:blockEffectFor(block.type,block.properties),properties:{...block.properties,spatial_scope:normalizeSpatialScope(block.properties.spatial_scope)},authority:block.properties.authority??"authored",source_event_refs:[...block.sourceEvents,...(item?.sourceEvents??[])]};});const snapshot={facts,relationships:projection.libraryBlockRelations.filter((relation)=>blockIds.has(relation.fromBlockId)&&blockIds.has(relation.toBlockId)).map((relation)=>({relation_id:relation.id,from_block_id:relation.fromBlockId,to_block_id:relation.toBlockId,kind:relation.kind,properties:relation.properties,source_event_refs:relation.sourceEvents})),context_groups:combinedContextGroups({facts}),pins:[...new Set([...contextSet.outputIds,...selectedItems.filter((item)=>item.sourceKind==="output").map((item)=>item.sourceId),...projection.libraryOutputs.filter((output)=>output.canvasId===contextSet.canvasId&&output.pinned).map((output)=>output.id)])],canvas:{canvas_id:contextSet.canvasId,context_set_id:contextSet.id,item_ids:contextSet.itemIds,formalized_as_of_sequence:contextSet.asOfSequence,spatial_arrangement_is_semantic:false,arrangement_is_context:false,provenance_frames:selectedItems.map((item)=>({item_id:item.id,source_kind:item.sourceKind,source_id:item.sourceId,frame:{x:item.x,y:item.y,w:item.w,h:item.h,rotation:item.rot,z:item.z}}))},tail:[]};
    const context={snapshot,sourceBlockVersions:blocks.map((block)=>({block_id:block.id,version:block.sourceEvents.length})),documentId:anchorDocumentId,canvasId:contextSet.canvasId,contextSetId:contextSet.id};const documentRevision=generationRevisionFor(context);const filed=projection.membership[anchorDocumentId];const technique=effectivePromptPreference(projection.preferences,{documentId:anchorDocumentId,collectionIds:filed?[filed.collectionId]:[],projectId:projection.projectId,accountId:this.session.get()?.user.userId}).technique;const fan=kind.endsWith("_fan");const fanKind=kind.startsWith("preview")?"preview":"generate";const jobKind:"preview"|"generate"|"prompt_fan"=fan?"prompt_fan":fanKind;const promptFanId=fan?crypto.randomUUID():undefined;const requestKey=fan?`canvas:prompt-fan:${fanKind}:${contextSet.id}:${documentRevision}:${sourcePreviewId??"context"}`:`canvas:${kind}:${contextSet.id}:${documentRevision}:${sourcePreviewId??"context"}`;
    try{const {reused}=await this.#startDocumentJob(jobKind,{...context,documentRevision,requestKey,promptTechnique:technique,sourcePreviewId,...(fan?{fanKind,promptFanId}:{})},"canvas",anchorDocumentId);const quality=fanKind==="preview"?"Draft":"Full-quality";this.toast(reused?"This exact Canvas generation is already queued.":fan?`${quality} fan queued as one four-image comparison for ${contextSet.name}.`:`${quality} Canvas generation queued from ${contextSet.name}.`);return true;}catch(error){this.toast(error instanceof Error?error.message:"Canvas generation could not be started.");return false;}
  }

  async promotePromptFanOutputs(promptFanId:string,outputIds:string[]){
    const projection=this.projection.get();const requested=new Set(outputIds);const outputs=projection.outputs.filter((output)=>output.promptFanId===promptFanId&&requested.has(output.id)&&!output.standalone);
    if(!outputs.length){this.toast("Those fan results already stand on their own.");return false;}
    const appended=await this.appendBatch(outputs.map((output)=>({type:"PromptFanOutputPromoted",payload:{object_id:output.id,prompt_fan_id:promptFanId,prompt_technique:output.promptTechnique,document_id:projection.documentId,project_id:projection.projectId,source_surface:"prompt-fan-comparison"}})));
    if(appended.length)this.toast(`${appended.length} fan result${appended.length===1?" now stands":"s now stand"} alone in the generation history.`);return Boolean(appended.length);
  }

  async chat(message:string,livePreview=true) {
    try{
      const documentId=this.projection.get().documentId;await this.#startDocumentJob("chat",{message,livePreview,documentId,promptTechnique:this.promptTechniquePreference().technique},"chat");return[];
    }catch(error){this.toast(error instanceof Error?error.message:"Forma could not respond");return[];}
  }

  async structureAdaptive(prompt:string,options:{documentId?:string;sourceSurface?:string;projectScope?:boolean}={}) {
    const documentId=options.documentId??this.projection.get().documentId;const sourceSurface=options.sourceSurface??"adaptive";
    try{if(sourceSurface!=="canvas")this.dismissAdaptiveStructure(documentId);const {job}=await this.#startDocumentJob("structure_adaptive",{prompt,documentId,projectScope:options.projectScope===true},sourceSurface,documentId);this.#pendingAdaptiveIntents.set(job.jobId,prompt);this.toast(sourceSurface==="canvas"?"Forma is shaping a few useful next moves from the whole project.":"Adaptive planning started. You can continue working while it runs.");return true;}catch(error){this.toast(error instanceof Error?error.message:"Forma could not structure that intent");return false;}
  }

  async renderDocumentArtifact(kind:DocumentArtifactKind,options:{documentId?:string;itemCount?:number;audience?:string;tone?:string;videoSeconds?:VideoDurationSeconds;videoSize?:"1280x720"|"720x1280";videoAudioMode?:VideoAudioMode;paidMediaConfirmed?:boolean;sourceSurface?:string}={}){
    const documentId=options.documentId??this.projection.get().documentId;const context=this.#generationContext(documentId);const audience=options.audience?.trim()||undefined,tone=options.tone?.trim()||undefined;const requestKey=`render:${kind}:${context.documentRevision}:${options.itemCount??"default"}:${options.videoSeconds??"none"}:${options.videoSize??"none"}:${options.videoAudioMode??"silent"}:${encodeURIComponent(audience?.toLowerCase()??"general")}:${encodeURIComponent(tone?.toLowerCase()??"document-derived")}`;
    try{const {reused}=await this.#startDocumentJob("render_document",{...context,requestKey,artifactKind:kind,itemCount:options.itemCount,audience,tone,videoSeconds:options.videoSeconds,videoSize:options.videoSize,videoAudioMode:options.videoAudioMode,paidMediaConfirmed:options.paidMediaConfirmed===true},options.sourceSurface??"document",documentId);this.toast(reused?`This exact ${kind.replaceAll("_"," ")} is already in progress.`:`${kind.replaceAll("_"," ")} queued. You can keep working while it is prepared.`);return true;}catch(error){this.toast(error instanceof Error?error.message:`The ${kind.replaceAll("_"," ")} could not be started.`);return false;}
  }

  async openProject(projectId:string,destination="/") {
    const projection=this.projection.get();if(!projectId||projectId===projection.projectId){this.setRoute(destination);return true;}
    const target=projection.projects.find((project)=>project.id===projectId);if(!target){this.toast("That project is no longer available.");return false;}
    const previousRoute=this.route.get(),clientEventId=crypto.randomUUID(),now=new Date().toISOString();
    const input:EventInput={type:"ProjectOpened",payload:{project_id:projectId,previous_project_id:projection.projectId,source_surface:"projects",client_event_id:clientEventId}};
    const optimistic:CreativeEvent={eventId:`optimistic:${clientEventId}`,streamId:"optimistic:project",sequence:this.head.get()+1,occurredAt:now,recordedAt:now,actor:"user",clientId:"web:project-optimistic",correlationId:clientEventId,causationId:null,compensatesEventId:null,schemaVersion:1,type:input.type,payload:input.payload};
    this.optimisticEvents.set([...this.optimisticEvents.get(),optimistic]);
    this.patchUi({focusBlockId:"",focusCollectionId:"",selectedOutputId:"",compareOpen:false});const persisted=this.append(input,{rebaseAttempts:6,silent:true,background:true});const committed=persisted.then((events)=>events.length>0,()=>false);this.#navigationCommit=committed;this.setRoute(destination);
    const appended=await persisted;if(this.#navigationCommit===committed)this.#navigationCommit=null;
    this.optimisticEvents.set(this.optimisticEvents.get().filter((event)=>event.eventId!==optimistic.eventId));
    if(!appended.length){this.setRoute(previousRoute,{replace:true});this.toast("That project could not be opened. Your current workspace was restored.");return false;}
    this.notify();this.toast(`${target.name} opened in Studio.`);return true;
  }

  async openDocument(documentId: string, destination="/", sourceSurface?: string) {
    const projection=this.projection.get();const target=projection.documents.find((document)=>document.id===documentId);const routedDestination = withDocumentInRoute(destination, documentId, target?.title ?? "");
    if(!documentId||documentId===projection.documentId){this.setRoute(routedDestination);return true;}
    if(!target){this.toast("That document is no longer available.");return false;}
    const previousDocumentId=projection.documentId;this.patchUi({focusBlockId:"",selectedOutputId:"",compareOpen:false});
    const persisted=this.append({type:"DocumentOpened",payload:{document_id:documentId,previous_document_id:previousDocumentId,source_surface:sourceSurface??(documentViewFromRoute(destination)==="document"?"studio":"studio-alternative")}},{rebaseAttempts:6,silent:true,background:true});const committed=persisted.then((events)=>events.length>0,()=>false);this.#navigationCommit=committed;this.setRoute(routedDestination);
    const appended=await persisted;if(this.#navigationCommit===committed)this.#navigationCommit=null;
    if(appended.length)this.toast("Document opened.");return true;
  }

  async removeDocument(documentId: string) {
    const projection=this.projection.get();const target=projection.documents.find((document)=>document.id===documentId);if(!target){this.toast("That document is no longer available.");return[];}if(projection.documents.length<=1){this.toast("Create another document before removing the project’s final document.");return[];}
    const fallback=projection.documents.find((document)=>document.id!==documentId)!;const wasCurrent=documentId===projection.documentId;
    const appended=await this.append({type:"DocumentRemoved",payload:{document_id:documentId,title:target.title,was_current:wasCurrent,previous_document_id:projection.documentId,fallback_document_id:fallback.id,reason:"removed-by-user"}});
    if(appended.length){this.patchUi({focusBlockId:"",selectedOutputId:"",compareOpen:false});if(wasCurrent&&isDocumentViewRoute(this.route.get()))this.setRoute(withDocumentInRoute(this.route.get(),this.projection.get().documentId,this.projection.get().documentTitle),{replace:true});this.toast(wasCurrent?`${target.title} was removed. ${fallback.title} is now open.`:`${target.title} was removed. Undo can restore it.`);}return appended;
  }

  async evaluateExtractors() {
    this.busy.set("extractor-eval"); this.notify();
    try {
      const response = await this.guardedFetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "evaluate_extractors", expectedSequence: this.head.get(), clientId: "web:system" }) },"run reference extraction");
      const body = await response.json() as { appended?: CreativeEvent[]; head?: number; error?: string };
      if (!response.ok) throw new Error(body.error === "admin_required" ? "An admin must witness the quality-gate rerun." : body.error ?? "Extractor evaluation failed");
      this.events.set([...this.events.get(), ...(body.appended ?? [])]); this.head.set(body.head ?? this.head.get()); this.toast("Extractor gate passed and the result was appended to the event stream.");
    } catch (error) { this.toast(error instanceof Error ? error.message : "Extractor evaluation failed"); }
    finally { this.busy.set(""); this.notify(); }
  }

  async rebuildIndex() {
    this.busy.set("phase7-index"); this.notify();
    try {
      const response = await this.guardedFetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "rebuild_index", expectedSequence: this.head.get(), clientId: "web:library" }) },"rebuild the fictional account’s library index");
      const body = await response.json() as { appended?: CreativeEvent[]; head?: number; error?: string; report?: { indexedItems?: number; exemplars?: number; families?: number } };
      if (!response.ok) throw new Error(body.error === "admin_required" ? "An admin must run the derived index." : body.error ?? "Index rebuild failed");
      this.events.set([...this.events.get(), ...(body.appended ?? [])]); this.head.set(body.head ?? this.head.get());
      this.toast(body.appended?.length ? `Indexed ${body.report?.indexedItems ?? 0} objects, ${body.report?.exemplars ?? 0} exemplars, and ${body.report?.families ?? 0} families.` : "The Phase 7 index is already fresh.");
    } catch (error) { this.toast(error instanceof Error ? error.message : "Index rebuild failed"); }
    finally { this.busy.set(""); this.notify(); }
  }

  async extractReference(blockId: string, referenceId: string, sample: ImageSample, findingKinds: ReferenceFindingKind[] = []) {
    try {
      await this.#startDocumentJob("extract_reference",{blockId,referenceId,sample,findingKinds,documentId:this.projection.get().documentId},"reference");this.toast("Reference analysis started and will finish in the background.");
    } catch (error) { this.toast(error instanceof Error ? error.message : "Reference extraction failed"); }
  }

  async calculateImageFocalPoint(input:{targetKind:"generation"|"reference"|"artifact";targetId:string;mediaUrl:string;referenceId?:string;sample?:ImageSample}){
    const key=`${input.targetKind}:${input.targetId}:${input.mediaUrl}`;if(!input.mediaUrl||this.#focalInFlight.has(key)||this.#hasFocalPoint(input.targetKind,input.targetId))return null;this.#focalInFlight.add(key);
    try{
      const sample=input.sample??(await resolveImageFocalAnalysis(input.mediaUrl)).sample;
      let resolved:unknown=null;
      const append=async()=>{if(this.#hasFocalPoint(input.targetKind,input.targetId))return;const response=await this.guardedFetch("/api/events",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"calculate_focal_point",clientId:"web:focal-extractor",targetKind:input.targetKind,targetId:input.targetId,referenceId:input.referenceId,mediaUrl:input.mediaUrl,sample})},"calculate and save this image’s focal point");const body=await response.json() as {appended?:CreativeEvent[];head?:number;focalPoint?:unknown;error?:string};if(!response.ok)throw new Error(body.error??"focal_point_calculation_failed");const appended=body.appended??[];if(appended.length){this.events.set([...this.events.get(),...appended]);this.head.set(body.head??this.head.get());this.#publishAppended(appended);this.notify();}resolved=body.focalPoint??null;};
      const task=this.#focalAppendQueue.then(append);this.#focalAppendQueue=task.catch(()=>{});await task;return normalizeImageFocalPoint(resolved);
    }catch{return null;}finally{this.#focalInFlight.delete(key);}
  }

  async closeSession() {
    this.busy.set("close-session"); this.notify();
    try {
      const response = await this.guardedFetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "close_session", expectedSequence: this.head.get(), clientId: "web:sessions" }) },"close this fictional work session");
      const body = await response.json() as { appended?: CreativeEvent[]; head?: number; error?: string; eligibility?: { closedSessions?: number; requiredClosedSessions?: number } };
      if (!response.ok) throw new Error(body.error === "no_open_session" ? "Open a session before closing it." : body.error ?? "Session could not be closed");
      this.events.set([...this.events.get(), ...(body.appended ?? [])]); this.head.set(body.head ?? this.head.get()); this.toast(`Session closed with a state receipt · ${body.eligibility?.closedSessions ?? 0}/${body.eligibility?.requiredClosedSessions ?? 3} toward brief eligibility.`);
    } catch (error) { this.toast(error instanceof Error ? error.message : "Session could not be closed"); }
    finally { this.busy.set(""); this.notify(); }
  }

  async openSession() {
    this.busy.set("open-session"); this.notify();
    try {
      const response = await this.guardedFetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "open_session", expectedSequence: this.head.get(), clientId: "web:sessions" }) },"open a fictional work session");
      const body = await response.json() as { appended?: CreativeEvent[]; head?: number; error?: string; briefComposed?: boolean };
      if (!response.ok) throw new Error(body.error === "session_already_open" ? "The current session is already open." : body.error ?? "Session could not be opened");
      this.events.set([...this.events.get(), ...(body.appended ?? [])]); this.head.set(body.head ?? this.head.get()); this.toast(body.briefComposed ? "Session opened with an eligible re-entry brief; every impression was witnessed." : "Session opened. More history is needed before composing a valid brief.");
    } catch (error) { this.toast(error instanceof Error ? error.message : "Session could not be opened"); }
    finally { this.busy.set(""); this.notify(); }
  }

  async composeBrief() {
    this.busy.set("compose-brief"); this.notify();
    try {
      const response = await this.guardedFetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "compose_brief", expectedSequence: this.head.get(), clientId: "web:sessions" }) },"compose a re-entry brief for this fictional account");
      const body = await response.json() as { appended?: CreativeEvent[]; head?: number; error?: string; eligibility?: { reasons?: string[] } };
      if (!response.ok) throw new Error(body.error === "brief_not_eligible" ? `Brief is not eligible: ${body.eligibility?.reasons?.join(" and ") ?? "more history required"}.` : body.error === "open_session_required" ? "Open a session before composing a brief." : body.error ?? "Brief could not be composed");
      this.events.set([...this.events.get(), ...(body.appended ?? [])]); this.head.set(body.head ?? this.head.get()); this.toast("Re-entry brief composed from the event stream; impressions were witnessed in the same batch.");
    } catch (error) { this.toast(error instanceof Error ? error.message : "Brief could not be composed"); }
    finally { this.busy.set(""); this.notify(); }
  }

  async declareIntent(statement: string, deadline: string | null = null) {
    this.busy.set("declare-intent"); this.notify();
    try {
      const response = await this.guardedFetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "declare_intent", expectedSequence: this.head.get(), clientId: "web:sessions", statement, deadline }) },"record this intent in the fictional account");
      const body = await response.json() as { appended?: CreativeEvent[]; head?: number; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Intent could not be recorded");
      this.events.set([...this.events.get(), ...(body.appended ?? [])]); this.head.set(body.head ?? this.head.get()); this.toast("Intent recorded privately; the immutable event keeps only its expiring reference.");
    } catch (error) { this.toast(error instanceof Error ? error.message : "Intent could not be recorded"); }
    finally { this.busy.set(""); this.notify(); }
  }

  async runScout(maxObservations: number) {
    this.busy.set("run-scout"); this.notify();
    try {
      const response = await this.guardedFetch("/api/events", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({action:"run_scout",expectedSequence:this.head.get(),clientId:"web:scout",maxObservations}) },"run Scout against the fictional account");
      const body = await response.json() as {appended?:CreativeEvent[];head?:number;error?:string};
      if(!response.ok) throw new Error(body.error === "phase6_advance_required" ? "Record the Phase 6 advance-with-monitoring decision first." : body.error ?? "Scout run failed");
      this.events.set([...this.events.get(),...(body.appended??[])]);this.head.set(body.head??this.head.get());this.toast("Scout report completed inside its hard planning envelope.");
    } catch(error) { this.toast(error instanceof Error?error.message:"Scout run failed"); }
    finally { this.busy.set("");this.notify(); }
  }

  async refreshTasteModel() {
    this.busy.set("taste-model");this.notify();
    try {
      const response=await this.guardedFetch("/api/events",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"refresh_taste_model",expectedSequence:this.head.get(),clientId:"web:memory"})},"refresh the fictional account’s taste model");
      const body=await response.json() as {appended?:CreativeEvent[];head?:number;error?:string;beliefs?:number};if(!response.ok)throw new Error(body.error === "phase6_advance_required"?"Record the Phase 6 advance-with-monitoring decision first.":body.error??"Taste model refresh failed");
      this.events.set([...this.events.get(),...(body.appended??[])]);this.head.set(body.head??this.head.get());this.toast(`Taste model versioned with ${body.beliefs??0} ranking-only belief${body.beliefs===1?"":"s"}.`);
    } catch(error){this.toast(error instanceof Error?error.message:"Taste model refresh failed");}
    finally{this.busy.set("");this.notify();}
  }

  async setCondition(condition:string,triggerKind:"generation_count"|"on_date",threshold:number,onDate:string|null){
    this.busy.set("set-condition");this.notify();
    try{const response=await this.guardedFetch("/api/events",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"set_condition",expectedSequence:this.head.get(),clientId:"web:memory",condition,triggerKind,threshold,onDate})},"set a time condition in the fictional account");const body=await response.json() as {appended?:CreativeEvent[];content?:Record<string,string>;head?:number;error?:string};if(!response.ok)throw new Error(body.error??"Condition could not be set");this.events.set([...this.events.get(),...(body.appended??[])]);this.content.set({...this.content.get(),...(body.content??{})});this.head.set(body.head??this.head.get());this.toast("Time policy recorded privately.");return true;}catch(error){this.toast(error instanceof Error?error.message:"Condition could not be set");return false;}finally{this.busy.set("");this.notify();}
  }

  async checkConditions(){
    this.busy.set("check-conditions");this.notify();
    try{const response=await this.guardedFetch("/api/events",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"check_conditions",expectedSequence:this.head.get(),clientId:"web:memory"})},"check time conditions in the fictional account");const body=await response.json() as {appended?:CreativeEvent[];head?:number;error?:string};if(!response.ok)throw new Error(body.error??"Policy check failed");this.events.set([...this.events.get(),...(body.appended??[])]);this.head.set(body.head??this.head.get());this.toast(body.appended?.length?`${Math.floor(body.appended.length/2)} condition${body.appended.length===2?"":"s"} resurfaced.`:"No time policies are due yet.");}catch(error){this.toast(error instanceof Error?error.message:"Policy check failed");}finally{this.busy.set("");this.notify();}
  }

  async critiqueObject(objectId:string,axis:string,polarity:"positive"|"negative",value:string,note:string){
    this.busy.set("critique-object");this.notify();
    try{const response=await this.guardedFetch("/api/events",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"critique_object",expectedSequence:this.head.get(),clientId:"web:studio",objectId,axis,polarity,value,note})},"record this critique in the fictional account");const body=await response.json() as {appended?:CreativeEvent[];content?:Record<string,string>;head?:number;error?:string};if(!response.ok)throw new Error(body.error??"Critique could not be recorded");this.events.set([...this.events.get(),...(body.appended??[])]);this.content.set({...this.content.get(),...(body.content??{})});this.head.set(body.head??this.head.get());this.toast("Axis-specific critique recorded for the taste ledger.");return true;}catch(error){this.toast(error instanceof Error?error.message:"Critique could not be recorded");return false;}finally{this.busy.set("");this.notify();}
  }

  async loadShares() {
    const response = await fetch("/api/shares"); if (!response.ok) return; const body = await response.json() as { shares: ShareRecord[] }; this.shares.set(body.shares); this.notify();
  }

  async createShare(expiresHours: number) {
    const projection=this.projection.get();if(!projection.documentId||!projection.projectId){this.toast("Open the document you want to share first.");return null;}
    const response = await this.guardedFetch("/api/shares", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expiresHours, resourceKind:"document", documentId:projection.documentId, projectId:projection.projectId }) },"create a share link for this fictional document"); const body = await response.json() as { share?: ShareRecord; error?: string };
    if (!response.ok || !body.share) { this.toast(body.error ?? "Share link could not be created"); return null; }
    await this.loadShares(); this.toast("Private read-only link created."); return body.share;
  }

  async revokeShare(shareId: string) {
    const response = await this.guardedFetch(`/api/shares/${encodeURIComponent(shareId)}`, { method: "DELETE" },"revoke this fictional document’s share link"); const body = await response.json() as { error?: string };
    if (!response.ok) return this.toast(body.error ?? "Share link could not be revoked"); await this.loadShares(); this.toast("Share link revoked immediately.");
  }

  #canvasHistoryEvent(event:CreativeEvent,canvasId:string){return String(event.payload.canvas_id??event.payload.source_canvas_id??"")===canvasId&&Boolean(inverseEvent(event));}
  #historyIndex(groups:HistoryGroup[],canvasId=""){for(let index=groups.length-1;index>=0;index-=1)if(groups[index].some((event)=>canvasId?this.#canvasHistoryEvent(event,canvasId):Boolean(inverseEvent(event))))return index;return-1;}
  #streamCanvasUndoGroup(canvasId:string){const ownerId=this.session.get()?.user.userId??"";if(!ownerId)return null;const events=this.events.get();const compensated=new Set(events.map((event)=>event.compensatesEventId).filter(Boolean));const owned=events.filter((event)=>event.actor==="user"&&!event.compensatesEventId&&event.payload.history_owner_id===ownerId&&this.#canvasHistoryEvent(event,canvasId));const eligible=owned.filter((event)=>!compensated.has(event.eventId));const latest=eligible.at(-1);if(!latest)return null;const actionId=String(latest.payload.history_action_id??latest.eventId);const action=owned.filter((event)=>String(event.payload.history_action_id??event.eventId)===actionId);return action.some((event)=>event.type==="CanvasArrangementCreated")?action:eligible.filter((event)=>String(event.payload.history_action_id??event.eventId)===actionId);}
  canUndo() {
    const canvasId=canvasIdFromRoute(this.route.get())??"";if(this.#historyIndex(this.#undo,canvasId)>=0)return true;if(canvasId)return Boolean(this.#streamCanvasUndoGroup(canvasId));
    const compensated=new Set(this.events.get().map((event)=>event.compensatesEventId).filter(Boolean));
    return this.events.get().some((event)=>event.actor==="user"&&!event.compensatesEventId&&!compensated.has(event.eventId)&&Boolean(inverseEvent(event)));
  }
  canRedo() { return this.#historyIndex(this.#redo,canvasIdFromRoute(this.route.get())??"")>=0; }
  #undoCandidate(canvasId="") {
    if(canvasId){const streamed=this.#streamCanvasUndoGroup(canvasId);if(streamed?.length){const actionId=String(streamed.at(-1)?.payload.history_action_id??streamed.at(-1)?.eventId??"");const remembered=this.#undo.findLastIndex((group)=>group.some((event)=>String(event.payload.history_action_id??event.eventId)===actionId));if(remembered>=0)this.#undo.splice(remembered,1);return streamed;}return null;}
    const index=this.#historyIndex(this.#undo);if(index>=0)return this.#undo.splice(index,1)[0];
    const compensated=new Set(this.events.get().map((event)=>event.compensatesEventId).filter(Boolean));
    const fallback=[...this.events.get()].reverse().find((event)=>event.actor==="user"&&!event.compensatesEventId&&!compensated.has(event.eventId)&&Boolean(inverseEvent(event)));return fallback?[fallback]:null;
  }
  async undo() {
    const canvasId=canvasIdFromRoute(this.route.get())??"";const source = this.#undoCandidate(canvasId); if (!source?.length) return this.toast(canvasId?"Nothing to undo on this board.":documentViewFromRoute(this.route.get()) === "editor" ? "Nothing to undo." : "Nothing reversible remains in this document history.");
    const inverses=source.toReversed().map((event)=>{const inverse=inverseEvent(event)!;return{...inverse,payload:withoutClientEventId(inverse.payload),compensatesEventId:event.eventId};});
    const appended = await this.appendBatch(inverses, { remember: false });
    if (appended.length===inverses.length) this.#redo.push(source);
  }

  async redo() {
    const canvasId=canvasIdFromRoute(this.route.get())??"";const index=this.#historyIndex(this.#redo,canvasId);const source=index>=0?this.#redo.splice(index,1)[0]:null;if (!source?.length) return this.toast(canvasId?"Nothing to redo on this board.":"Nothing to redo in this session.");
    const appended = await this.appendBatch(source.map(redoEvent), { remember: false });
    const redone=appended.filter((event)=>event.actor==="user"&&Boolean(inverseEvent(event)));if(redone.length)this.#undo.push(redone);
  }

  buildReplay(events: CreativeEvent[]) { this.replayEvents.set(events); this.replayAsOf.set(0); this.notify(); }
  setReplayAsOf(value: number) { this.replayAsOf.set(value); this.notify(); }
}

let historyClock=0;
function historyHlc(event:CreativeEvent,mode:"undo"|"redo"){
  const operation=event.payload.operation&&typeof event.payload.operation==="object"&&!Array.isArray(event.payload.operation)?event.payload.operation as Record<string,unknown>:{};const source=operation.hlc&&typeof operation.hlc==="object"&&!Array.isArray(operation.hlc)?operation.hlc as Record<string,unknown>:{};
  historyClock=Math.max(Date.now(),Number(source.pt??0)+1,historyClock+1);return{pt:historyClock,c:0,site:`${mode}:${event.clientId}`};
}

function inverseEvent(event: CreativeEvent): EventInput | null {
  const p = event.payload;
  const pairs: Record<string, string> = { BlockLocked: "BlockUnlocked", BlockUnlocked: "BlockLocked", BlockRemoved: "BlockRestored", BlockRestored: "BlockRemoved", BlockRelationAdded: "BlockRelationRemoved", BlockRelationRemoved: "BlockRelationAdded", DocumentRemoved: "DocumentRestored", DocumentRestored: "DocumentRemoved", ObjectPinned: "ObjectUnpinned", ObjectUnpinned: "ObjectPinned", AddedToLibrary: "RemovedFromLibrary", RemovedFromLibrary: "AddedToLibrary", CanvasItemRemoved:"CanvasItemRestored", CanvasItemRestored:"CanvasItemRemoved", CanvasArrangementRemoved:"CanvasArrangementRestored", CanvasArrangementRestored:"CanvasArrangementRemoved", CanvasRemoved:"CanvasRestored", CanvasRestored:"CanvasRemoved", MembershipAdded:"MembershipRemoved", MembershipRemoved:"MembershipAdded" };
  if (pairs[event.type]) return { type: pairs[event.type], payload: p };
  if (event.type === "BlockCreated") return { type: "BlockRemoved", payload: { block_id: p.block_id, project_id:p.project_id, document_id:p.document_id, canvas_id:p.canvas_id, source_canvas_id:p.source_canvas_id, reason: "undo-created-block" } };
  if (event.type === "DocumentCreated") return { type: "DocumentRemoved", payload: { document_id:p.document_id, project_id:p.project_id, canvas_id:p.canvas_id, source_canvas_id:p.source_canvas_id, was_current:true, reason:"undo-created-document" } };
  if (event.type === "CanvasCreated") return { type: "CanvasRemoved", payload: { canvas_id:p.canvas_id, project_id:p.project_id, reason:"undo-created-canvas" } };
  if (event.type === "CanvasItemPlaced" || event.type === "CanvasReferenceCreated") return { type:"CanvasItemRemoved", payload:{canvas_id:p.canvas_id,project_id:p.project_id,item_id:p.item_id??p.reference_item_id,reason:"undo-placed-item"} };
  if (event.type === "CanvasArrangementCreated") return { type:"CanvasArrangementRemoved", payload:{canvas_id:p.canvas_id,project_id:p.project_id,arrangement_id:p.arrangement_id,reason:"undo-created-arrangement"} };
  if(event.type==="StrokeAdded"){
    const operation=p.operation&&typeof p.operation==="object"&&!Array.isArray(p.operation)?p.operation as Record<string,unknown>:{};const stroke=operation.stroke&&typeof operation.stroke==="object"&&!Array.isArray(operation.stroke)?operation.stroke as Record<string,unknown>:{};
    return{type:"StrokeErased",payload:{canvas_id:p.canvas_id,project_id:p.project_id,item_id:p.item_id,operation:{sketch:operation.sketch??{item_id:p.item_id},target:stroke.id}}};
  }
  if (event.type === "CollectionCreated") return { type: "CollectionRemoved", payload: { collection_id: p.collection_id, reason: "undo-created-collection" } };
  if (event.type === "BlockRenamed") return { type: event.type, payload: { ...p, old_handle: p.new_handle, new_handle: p.old_handle } };
  if (event.type === "CollectionRenamed") return { type: event.type, payload: { ...p, old_handle: p.new_handle, new_handle: p.old_handle } };
  if (event.type === "ProjectRenamed") return { type: event.type, payload: { ...p, old_name: p.new_name, new_name: p.old_name } };
  if (event.type === "ProjectStateChanged") return { type: event.type, payload: { ...p, state: p.previous_state, previous_state: p.state } };
  if (event.type === "ProjectOpened") return { type: event.type, payload: { ...p, project_id: p.previous_project_id, previous_project_id: p.project_id } };
  if (event.type === "DocumentOpened") return { type: event.type, payload: { ...p, document_id: p.previous_document_id, previous_document_id: p.document_id } };
  if (event.type === "CollectionItemAdded") return { type: "CollectionItemRemoved", payload: p };
  if (event.type === "CollectionItemRemoved") return { type: "CollectionItemAdded", payload: p };
  if (event.type === "CollectionItemMoved") return { type: event.type, payload: { ...p, from_collection_id: p.to_collection_id, to_collection_id: p.from_collection_id } };
  if (event.type === "BlockPropertyEdited") return { type: event.type, payload: { ...p, old_value: p.new_value, new_value: p.old_value } };
  if (event.type === "DocumentRenamed") return { type: event.type, payload: { ...p, old_title: p.new_title, new_title: p.old_title } };
  if (event.type === "BlockWeightSet") return { type: event.type, payload: { ...p, weight: p.previous_weight, previous_weight: p.weight } };
  if (event.type === "ChipEdited") return { type: event.type, payload: { ...p, old_value: p.new_value, new_value: p.old_value } };
  if(event.type==="CanvasRegisterSet"){
    const operation=p.operation&&typeof p.operation==="object"&&!Array.isArray(p.operation)?p.operation as Record<string,unknown>:{};if(!Object.hasOwn(p,"previous_value"))return null;
    return{type:event.type,payload:{...p,previous_value:operation.value,operation:{...operation,value:p.previous_value,hlc:historyHlc(event,"undo")}}};
  }
  return null;
}

function redoEvent(event:CreativeEvent):EventInput{
  if(event.type==="StrokeAdded"){
    const payload=withoutClientEventId(event.payload);const operation=payload.operation&&typeof payload.operation==="object"&&!Array.isArray(payload.operation)?payload.operation as Record<string,unknown>:{};const stroke=operation.stroke&&typeof operation.stroke==="object"&&!Array.isArray(operation.stroke)?operation.stroke as Record<string,unknown>:{};
    return{type:event.type,payload:{...payload,operation:{...operation,stroke:{...stroke,id:[`redo:${event.clientId}`,Date.now()]}}}};
  }
  if(event.type!=="CanvasRegisterSet")return{type:event.type,payload:withoutClientEventId(event.payload)};
  const operation=event.payload.operation&&typeof event.payload.operation==="object"&&!Array.isArray(event.payload.operation)?event.payload.operation as Record<string,unknown>:{};
  return{type:event.type,payload:{...withoutClientEventId(event.payload),operation:{...operation,hlc:historyHlc(event,"redo")}}};
}

function withoutClientEventId(payload:Record<string,unknown>){const fresh={...payload};delete fresh.client_event_id;return fresh;}

export const store = new FormaStore();
