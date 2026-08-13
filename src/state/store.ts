import { Signal } from "signal-polyfill";
import { SignalObject } from "signal-utils/object";
import { foldEvents, type CreativeEvent, type CreativeProjection, type EventInput } from "../model/events";
import { buildScenario, type ScenarioKey } from "../model/scenarios";
import type { ImageSample, ReferenceFindingKind } from "../model/extractors";
import { readAttentionPreference, writeAttentionPreference } from "../model/attention";
import { blockEffectFor, blockIntentFor, type AdaptiveStructure } from "../model/block-types";
import { documentFocusFromRoute, documentIdFromRoute, documentViewFromRoute, isDocumentViewRoute, withDocumentFocusInRoute, withDocumentInRoute } from "../model/routes";
import { normalizeSpatialScope } from "../model/spatial-scope";
import { normalizeImageFocalPoint } from "../model/focal-point";
import { resolveImageFocalAnalysis } from "../model/image-focus";
import { documentGenerationRequestKey as generationRequestKeyFor, documentGenerationRevision as generationRevisionFor, documentJobIsStale, type DocumentJob, type DocumentJobKind } from "../model/document-jobs";
import { effectivePromptPreference, normalizePromptTechnique, PROMPT_TECHNIQUES, type PromptPreferenceScope, type PromptTechnique } from "../model/prompt-structures";

type Listener = () => void;
export type PilotSession = {
  user: { userId: string; email: string; displayName: string; role: "admin" | "creator" | "agent" | "viewer"; consentVersion: string | null; consentedAt: string | null };
  policy: { version: string; accepted: boolean; passiveCapture: false; attentionCapture?: { available: boolean; defaultOn: false; retentionDays: number; rawInputCapture: false }; externalAssetsRequireAssertion: true; retentionDays: number; sharing: string };
  provider: { name: string; model: string; plannerModel?: string; configured: boolean };
  budgets: { period: string; user: { used: number; reserved: number; limit: number }; workspace: { used: number; reserved: number; limit: number } };
};
export type ShareRecord = { shareId: string; token?: string; expiresAt: string; revokedAt?: string | null; createdAt?: string; active: boolean };

export class FormaStore {
  readonly events = new Signal.State<CreativeEvent[]>([]);
  readonly head = new Signal.State(0);
  readonly loading = new Signal.State(true);
  readonly busy = new Signal.State("");
  readonly error = new Signal.State("");
  readonly asOf = new Signal.State(Number.POSITIVE_INFINITY);
  readonly replayEvents = new Signal.State<CreativeEvent[]>([]);
  readonly replayAsOf = new Signal.State(0);
  readonly route = new Signal.State(`${location.pathname}${location.search}${location.hash}`);
  readonly session = new Signal.State<PilotSession | null>(null);
  readonly content = new Signal.State<Record<string, string>>({});
  readonly shares = new Signal.State<ShareRecord[]>([]);
  readonly documentJobs = new Signal.State<DocumentJob[]>([]);
  readonly adaptiveStructures = new Signal.State<Record<string,AdaptiveStructure>>({});
  readonly ui = new SignalObject({ inspectorOpen: false, commandOpen: false, accountOpen: false, shareOpen: false, compareOpen: false, projectRailCollapsed: false, instrumentation: true, attentionCapture: readAttentionPreference(), attentionPaused: false, selectedEventId: "", selectedOutputId: "", comparisonOutputIds: "", focusBlockId: "", focusCollectionId: "", editingBlockId: "", libraryView: "all", libraryOutputScope: "recent", search: "", toast: "" });
  readonly projection = new Signal.Computed<CreativeProjection>(() => foldEvents(this.events.get(), this.asOf.get()));
  readonly replayProjection = new Signal.Computed<CreativeProjection>(() => foldEvents(this.replayEvents.get(), this.replayAsOf.get()));
  #listeners = new Set<Listener>();
  #undo: CreativeEvent[] = [];
  #redo: CreativeEvent[] = [];
  #focalInFlight = new Set<string>();
  #focalAppendQueue: Promise<void> = Promise.resolve();
  #jobPollTimer = 0;
  #jobsSyncing = false;
  #jobPollFailures = 0;
  #jobPollIssueNotified = false;
  #jobsDriving = new Set<string>();
  #jobStarts = new Set<string>();
  #pendingJobNotices: DocumentJob[] = [];

  constructor(){document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"){this.#flushPendingJobNotices();void this.syncDocumentJobs();}});}

  subscribe(listener: Listener) { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }
  notify() { this.#listeners.forEach((listener) => listener()); }
  #publishAppended(events:CreativeEvent[]){if(events.length){window.dispatchEvent(new CustomEvent("forma-events-appended",{detail:{events}}));queueMicrotask(()=>this.#backfillImageFocalPoints());}}
  #hasFocalPoint(targetKind:"generation"|"reference",targetId:string){const projection=this.projection.get();return targetKind==="generation"?Boolean(projection.libraryOutputs.find((output)=>output.id===targetId)?.focalPoint??projection.outputs.find((output)=>output.id===targetId)?.focalPoint):Boolean(normalizeImageFocalPoint(projection.libraryBlocks.find((block)=>block.id===targetId)?.properties.focal_point??projection.blocks.find((block)=>block.id===targetId)?.properties.focal_point));}
  #backfillImageFocalPoints(){
    const projection=this.projection.get();const seen=new Set<string>();
    for(const output of [...projection.outputs,...projection.libraryOutputs])if(output.mediaUrl&&!output.focalPoint&&!seen.has(`generation:${output.id}`)){seen.add(`generation:${output.id}`);void this.calculateImageFocalPoint({targetKind:"generation",targetId:output.id,mediaUrl:output.mediaUrl});}
    for(const block of [...projection.blocks,...projection.libraryBlocks]){const mediaUrl=String(block.properties.media_url??"");if(block.type!=="reference"||!mediaUrl||block.properties.extraction_status==="pending"||normalizeImageFocalPoint(block.properties.focal_point)||seen.has(`reference:${block.id}`))continue;seen.add(`reference:${block.id}`);void this.calculateImageFocalPoint({targetKind:"reference",targetId:block.id,referenceId:String(block.properties.reference_id??""),mediaUrl});}
  }
  #reflectDocumentInRoute() {
    const currentRoute = this.route.get();
    if (!isDocumentViewRoute(currentRoute)) return;
    const projection = this.projection.get();
    const canonicalRoute = withDocumentInRoute(currentRoute, projection.documentId, projection.documentTitle);
    if (projection.documentId && canonicalRoute !== currentRoute) this.setRoute(canonicalRoute, { replace: true });
  }
  #generationContext() {
    const projection=this.projection.get();
    const context={
      snapshot:{facts:projection.blocks.map((b)=>({block_id:b.id,document_id:b.documentId,type: b.type,role:b.type,intent: blockIntentFor(b.type, b.properties),handle:b.handle,position:b.position,locked:b.locked,active:Number(b.properties.weight??.5)>0,effect: blockEffectFor(b.type, b.properties),properties:{...b.properties,spatial_scope: normalizeSpatialScope(b.properties.spatial_scope)},authority:b.properties.authority??"authored",source_event_refs:b.sourceEvents})),relationships:projection.blockRelations.map((relation)=>({relation_id:relation.id,from_block_id:relation.fromBlockId,to_block_id:relation.toBlockId,kind:relation.kind,properties:relation.properties,source_event_refs:relation.sourceEvents})),pins:projection.outputs.filter((o)=>o.pinned).map((o)=>o.id),tail:[]},
      sourceBlockVersions:projection.blocks.map((b)=>({block_id:b.id,version:b.sourceEvents.length})),documentId:projection.documentId,
    };
    return {...context,documentRevision:generationRevisionFor(context)};
  }
  documentJob(kind:DocumentJobKind,documentId=this.projection.get().documentId){return this.documentJobs.get().find((job)=>job.documentId===documentId&&job.kind===kind&&(job.status==="queued"||job.status==="running"));}
  documentGenerationRevision(){return this.#generationContext().documentRevision;}
  promptTechniquePreference(){const projection=this.projection.get();const filed=projection.membership[projection.documentId];return effectivePromptPreference(projection.preferences,{documentId:projection.documentId,collectionIds:filed?[filed.collectionId]:[],projectId:projection.projectId,accountId:this.session.get()?.user.userId});}
  documentGenerationRequestKey(kind:"preview"|"generate",sourcePreviewId?:string|null,promptTechnique:PromptTechnique=this.promptTechniquePreference().technique,promptFanId?:string|null){return generationRequestKeyFor(kind,this.documentGenerationRevision(),sourcePreviewId,promptTechnique,promptFanId);}
  documentGenerationJobs(documentId=this.projection.get().documentId){return this.documentJobs.get().filter((job)=>job.documentId===documentId&&(job.kind==="preview"||job.kind==="generate")&&(job.status==="queued"||job.status==="running")).sort((a,b)=>a.requestedAt.localeCompare(b.requestedAt)||a.jobId.localeCompare(b.jobId));}
  documentJobForRequest(kind:"preview"|"generate",requestKey:string,documentId=this.projection.get().documentId){return this.documentGenerationJobs(documentId).find((job)=>job.kind===kind&&job.requestKey===requestKey);}
  documentJobStarting(requestKey:string){return this.#jobStarts.has(requestKey);}
  documentJobActive(kind?:DocumentJobKind,documentId=this.projection.get().documentId){return this.documentJobs.get().some((job)=>job.documentId===documentId&&(!kind||job.kind===kind)&&(job.status==="queued"||job.status==="running"));}
  documentPreviewProgress(documentId=this.projection.get().documentId){const job=this.documentJobs.get().find((item)=>item.documentId===documentId&&item.kind==="preview"&&item.status==="running"&&item.result?.partialMediaUrl);if(!job)return null;return{jobId:job.jobId,mediaUrl:String(job.result!.partialMediaUrl),mediaType:String(job.result!.partialMediaType??"image/jpeg"),width:Number(job.result!.partialWidth??816),height:Number(job.result!.partialHeight??816),index:Number(job.result!.partialIndex??0),sourceSurface:job.sourceSurface};}
  adaptiveStructureFor(documentId=this.projection.get().documentId){return this.adaptiveStructures.get()[documentId]??null;}
  dismissAdaptiveStructure(documentId=this.projection.get().documentId){const next={...this.adaptiveStructures.get()};delete next[documentId];this.adaptiveStructures.set(next);this.notify();}
  #jobResultVisible(job:DocumentJob){if(document.visibilityState!=="visible"||!isDocumentViewRoute(this.route.get())||documentIdFromRoute(this.route.get())!==job.documentId)return false;const view=documentViewFromRoute(this.route.get());if(job.kind==="chat")return view==="chat";if(job.kind==="structure_adaptive")return view==="adaptive";return true;}
  #jobNotice(job:DocumentJob){const title=this.projection.get().documents.find((document)=>document.id===job.documentId)?.title??"your document";if(job.status==="failed"){const labels:Record<DocumentJobKind,string>={preview:"Draft generation",generate:"Full-quality generation",chat:"Creative chat",structure_adaptive:"Adaptive planning",extract_reference:"Reference analysis"};const reason=job.error==="execution_interrupted"?"The server connection ended before the allowed recovery could finish.":job.error==="document_job_lease_lost"?"Another runner took over the operation.":"The provider or server returned an error.";return`${labels[job.kind]} could not finish for ${title}. ${reason} Open the document to retry.`;}const labels:Record<DocumentJobKind,string>={preview:"A draft image is ready",generate:"A full-quality image is ready",chat:"A chat response is ready",structure_adaptive:"An adaptive plan is ready",extract_reference:"Reference analysis is ready"};return`${labels[job.kind]} in ${title}.`;}
  async #ackJob(jobId:string){try{await fetch(`/api/document-jobs/${encodeURIComponent(jobId)}/ack`,{method:"POST"});}catch{/* A later poll can offer the notice again. */}}
  #flushPendingJobNotices(){if(document.visibilityState!=="visible"||!this.#pendingJobNotices.length)return;const jobs=this.#pendingJobNotices.splice(0);this.toast(jobs.length===1?this.#jobNotice(jobs[0]):`${jobs.length} background document operations finished.`);for(const job of jobs)void this.#ackJob(job.jobId);}
  async #refreshEvents(){const response=await fetch("/api/events");if(!response.ok)throw new Error(`Event stream returned ${response.status}`);const body=await response.json() as {events:CreativeEvent[];content?:Record<string,string>;head:number};const known=new Set(this.events.get().map((event)=>event.eventId));this.events.set(body.events);this.content.set(body.content??{});this.head.set(body.head);this.#publishAppended(body.events.filter((event)=>!known.has(event.eventId)));}
  #scheduleJobPoll(delay=2_000){window.clearTimeout(this.#jobPollTimer);this.#jobPollTimer=window.setTimeout(()=>void this.syncDocumentJobs(),delay);}
  #driveDocumentJobs(jobs:DocumentJob[]){const next=[...jobs].filter((job)=>job.status==="queued"||job.status==="running").sort((a,b)=>a.requestedAt.localeCompare(b.requestedAt)||a.jobId.localeCompare(b.jobId))[0];if(next&&(next.status==="queued"||documentJobIsStale(next))&&!this.#jobsDriving.has(next.jobId))void this.#driveDocumentJob(next);}
  async #driveDocumentJob(job:DocumentJob){this.#jobsDriving.add(job.jobId);try{const response=await fetch(`/api/document-jobs/${encodeURIComponent(job.jobId)}/run`,{method:"POST"});const body=await response.json() as {job?:DocumentJob;error?:string};if(!response.ok&&!body.job)throw new Error(body.error??"document_job_runner_failed");}catch{if(document.visibilityState==="visible")this.toast("The connection to the background operation ended. The app will recover it safely.");}finally{this.#jobsDriving.delete(job.jobId);this.#scheduleJobPoll(350);}}
  async syncDocumentJobs(){if(this.#jobsSyncing)return;this.#jobsSyncing=true;try{const response=await fetch("/api/document-jobs");if(!response.ok)throw new Error(`Job status returned ${response.status}`);const body=await response.json() as {jobs?:DocumentJob[]};const previous=new Map(this.documentJobs.get().map((job)=>[job.jobId,job]));const jobs=body.jobs??[];this.documentJobs.set(jobs);this.#jobPollFailures=0;this.#jobPollIssueNotified=false;
      const completed=jobs.filter((job)=>!job.notifiedAt&&(job.status==="completed"||job.status==="failed")&&(previous.get(job.jobId)?.status!==job.status||!previous.has(job.jobId)));if(completed.length)await Promise.all([this.#refreshEvents(),this.refreshSession()]);
      for(const job of completed){if(job.kind==="structure_adaptive"&&job.status==="completed"&&job.result?.structure)this.adaptiveStructures.set({...this.adaptiveStructures.get(),[job.documentId]:job.result.structure as AdaptiveStructure});if(job.status==="completed"&&this.#jobResultVisible(job)){void this.#ackJob(job.jobId);continue;}if(document.visibilityState==="visible"){this.toast(this.#jobNotice(job));void this.#ackJob(job.jobId);}else this.#pendingJobNotices.push(job);}
      this.notify();this.#driveDocumentJobs(jobs);this.#scheduleJobPoll(jobs.some((job)=>job.status==="queued"||job.status==="running")?1_500:10_000);
    }catch{this.#jobPollFailures+=1;if(this.#jobPollFailures>=3&&!this.#jobPollIssueNotified&&document.visibilityState==="visible"){this.#jobPollIssueNotified=true;this.toast("Background status is temporarily unavailable. Retrying…");}this.#scheduleJobPoll(5_000);}finally{this.#jobsSyncing=false;}}
  async #startDocumentJob(kind:DocumentJobKind,payload:Record<string,unknown>,sourceSurface:string){const documentId=this.projection.get().documentId;const requestKey=String(payload.requestKey??"");if(requestKey&&this.#jobStarts.has(requestKey))throw new Error("This exact image request is already being queued.");if(requestKey){this.#jobStarts.add(requestKey);this.notify();}try{const response=await fetch("/api/document-jobs",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({kind,documentId,sourceSurface,payload})});const body=await response.json() as {job?:DocumentJob;error?:string;reused?:boolean};if(!response.ok||!body.job)throw new Error(body.error??"Document operation could not be started");const jobs=[body.job,...this.documentJobs.get().filter((job)=>job.jobId!==body.job!.jobId)];this.documentJobs.set(jobs);this.notify();this.#driveDocumentJobs(jobs);this.#scheduleJobPoll(800);return{job:body.job,reused:Boolean(body.reused)};}finally{if(requestKey){this.#jobStarts.delete(requestKey);this.notify();}}}
  patchUi(patch: Partial<typeof this.ui>) { Object.assign(this.ui, patch); this.notify(); }
  toast(message: string) { this.ui.toast = message; this.notify(); window.setTimeout(() => { if (this.ui.toast === message) { this.ui.toast = ""; this.notify(); } }, 2800); }
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
    }
    this.route.set(routedPath); this.notify(); window.dispatchEvent(new CustomEvent("forma-route-changed", { detail: { path: routedPath } }));
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
  setAttentionCapture(enabled:boolean){writeAttentionPreference(enabled,this.session.get()?.user.userId??"anonymous");this.patchUi({attentionCapture:enabled,attentionPaused:false});this.toast(enabled?"Attention signals enabled for this account on this device.":"Attention signals disabled; the current episode was closed.");}
  setAttentionPaused(paused:boolean){this.patchUi({attentionPaused:paused});this.toast(paused?"Attention capture paused on this device.":"Attention capture resumed.");}
  async forgetAttentionSignals(){window.dispatchEvent(new Event("forma-attention-forget"));const appended=await this.append({type:"AttentionSignalsForgotten",payload:{scope:"all-attention-episodes",before_sequence:this.head.get(),reason:"user-requested",device_ledger_cleared:true}});if(appended.length)this.toast("Attention episodes were forgotten and excluded from Scout and Memory.");return appended;}

  async load() {
    this.loading.set(true); this.notify();
    try {
      await this.refreshSession();
      const response = await fetch("/api/events");
      if (!response.ok) throw new Error(`Event stream returned ${response.status}`);
      const body = await response.json() as { events: CreativeEvent[]; content?: Record<string, string>; head: number };
      this.events.set(body.events); this.content.set(body.content ?? {}); this.head.set(body.head); this.error.set("");
      await this.syncDocumentFromRoute(this.route.get());
      await this.syncDocumentJobs();
      queueMicrotask(()=>this.#backfillImageFocalPoints());
    } catch (error) { this.error.set(error instanceof Error ? error.message : "Unable to load event stream"); }
    finally { this.loading.set(false); this.notify(); }
  }

  async refreshSession() {
    const response = await fetch("/api/session"); const body = await response.json() as PilotSession & { error?: string };
    if (!response.ok) throw new Error(body.error ?? "Authentication required");const previousUserId=this.session.get()?.user.userId;this.session.set(body);if(previousUserId!==body.user.userId){this.ui.attentionCapture=readAttentionPreference(body.user.userId);this.ui.attentionPaused=false;} this.notify(); return body;
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

  async append(event: EventInput, options: { expected?: number; remember?: boolean } = {}) {
    return this.appendBatch([event], options);
  }

  async appendBatch(events: EventInput[], options: { expected?: number; remember?: boolean } = {}) {
    this.busy.set(events[0]?.type ?? "append"); this.notify();
    try {
      const response = await fetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: events.length > 1 ? "batch" : "append", event: events[0], events, expectedSequence: options.expected ?? this.head.get(), clientId: "web:lit" }) });
      const body = await response.json() as { appended?: CreativeEvent[]; rejected?: Array<{ reason: string }>; head?: number; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Append rejected");
      const appended = body.appended ?? [];
      this.events.set([...this.events.get(), ...appended]); this.head.set(body.head ?? this.head.get()); this.#publishAppended(appended);
      this.#reflectDocumentInRoute();
      if (options.remember !== false) { this.#undo.push(...appended.filter((e) => e.actor === "user" && !e.compensatesEventId && inverseEvent(e))); this.#redo = []; }
      if (body.rejected?.length) this.toast(documentViewFromRoute(this.route.get()) === "editor" ? `${body.rejected.length} change${body.rejected.length === 1 ? "" : "s"} could not be saved; the other changes are safe.` : `${body.rejected.length} event${body.rejected.length === 1 ? "" : "s"} rejected; valid events still appended.`);
      return appended;
    } catch (error) { this.toast(error instanceof Error ? error.message : "Append failed"); return []; }
    finally { this.busy.set(""); this.notify(); }
  }

  async copyLibraryBlockSet(rootBlockId:string,destinationDocumentId=this.projection.get().documentId,sourceSurface="library"){
    const projection=this.projection.get();const available=new Map(projection.libraryBlocks.filter((block)=>!block.removed&&block.projectId===projection.projectId).map((block)=>[block.id,block]));const root=available.get(rootBlockId);
    if(!root){this.toast("That reusable context is no longer available.");return null;}
    const connected=new Set([root.id]);let changed=true;while(changed&&connected.size<24){changed=false;for(const relation of projection.libraryBlockRelations){if(connected.has(relation.fromBlockId)&&available.has(relation.toBlockId)&&!connected.has(relation.toBlockId)){connected.add(relation.toBlockId);changed=true;}if(connected.size>=24)break;}}
    const blocks=[...connected].map((id)=>available.get(id)!).sort((left,right)=>left.id===root.id?-1:right.id===root.id?1:left.position.localeCompare(right.position));const ids=new Map(blocks.map((block)=>[block.id,crypto.randomUUID()]));const contextSetId=crypto.randomUUID();const base=this.head.get()+1;
    const events:EventInput[]=blocks.map((block,index)=>({type:"BlockCreated",payload:{block_id:ids.get(block.id),document_id:destinationDocumentId,type:block.type,handle:`${block.handle}-copy-${String(base+index).padStart(3,"0")}`,position:`z${String(base+index).padStart(6,"0")}`,properties:{...block.properties,authority:"authored",copied_from_block_id:block.id,copied_as_context_set:blocks.length>1,context_set_id:contextSetId,context_set_root_id:ids.get(root.id),created_from:sourceSurface}}}));
    for(const relation of projection.libraryBlockRelations){const from=ids.get(relation.fromBlockId);const to=ids.get(relation.toBlockId);if(!from||!to)continue;events.push({type:"BlockRelationAdded",payload:{relation_id:crypto.randomUUID(),project_id:projection.projectId,document_id:destinationDocumentId,from_block_id:from,to_block_id:to,kind:relation.kind,properties:{...relation.properties,copied_from_relation_id:relation.id,context_set_id:contextSetId},source_surface:sourceSurface}});}
    const appended=await this.appendBatch(events);if(!appended.length)return null;const copiedRootId=ids.get(root.id)!;this.patchUi({focusBlockId:copiedRootId});this.toast(blocks.length===1?"Reusable block added to the open document.":`${blocks.length} connected blocks added as one context set.`);return{rootBlockId:copiedRootId,blockCount:blocks.length,relationCount:events.length-blocks.length};
  }

  async hot(event: EventInput, options: { keepalive?: boolean } = {}) {
    try {
      const response = await fetch("/api/events/hot", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "hot", event, events: [event], clientId: "web:lit" }), keepalive: options.keepalive });
      if (!response.ok) return;
      const body = await response.json() as { appended?: CreativeEvent[]; head?: number };
      const appended=body.appended??[];this.events.set([...this.events.get(), ...appended].sort((left,right)=>left.sequence-right.sequence)); this.head.set(Math.max(this.head.get(),body.head??0)); this.#publishAppended(appended);this.notify();
    } catch { /* Engagement instrumentation never blocks the creative action. */ }
  }

  async propose(prompt: string, events: EventInput[], exemplarRefs: Array<Record<string, unknown>> = []) {
    this.busy.set("proposal"); this.notify();
    try {
      const response = await fetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "propose", prompt, events, exemplarRefs, expectedSequence: this.head.get(), clientId: "web:lit" }) });
      if (!response.ok) throw new Error("Proposal could not be recorded");
      const body = await response.json() as { appended: CreativeEvent[]; head: number };
      this.events.set([...this.events.get(), ...body.appended]); this.head.set(body.head); this.toast("Proposal recorded — review it before applying.");
      return body.appended[0];
    } finally { this.busy.set(""); this.notify(); }
  }

  async preview(sourceSurface?: string,promptTechnique?:PromptTechnique) {
    const technique=normalizePromptTechnique(promptTechnique??this.promptTechniquePreference().technique);
    try{const context=this.#generationContext();const requestKey=generationRequestKeyFor("preview",context.documentRevision,null,technique);const {reused}=await this.#startDocumentJob("preview",{...context,requestKey,promptTechnique:technique},sourceSurface??"studio");this.toast(reused?"This exact draft is already in the queue.":`${technique==="prose"?"Draft":`${technique} draft`} queued. You can keep editing and queue the updated document too.`);}catch(error){this.toast(error instanceof Error?error.message:"Draft generation failed");}
  }

  async generate(options?: string | { sourceSurface?: string; sourcePreviewId?: string; promptTechnique?: PromptTechnique }) {
    const sourceSurface=typeof options==="string"?options:options?.sourceSurface;const sourcePreviewId=typeof options==="string"?undefined:options?.sourcePreviewId;const technique=normalizePromptTechnique(typeof options==="string"?this.promptTechniquePreference().technique:options?.promptTechnique??this.promptTechniquePreference().technique);
    try {
      const context=this.#generationContext();const requestKey=generationRequestKeyFor("generate",context.documentRevision,sourcePreviewId,technique);const {reused}=await this.#startDocumentJob("generate",{sourcePreviewId,...context,requestKey,promptTechnique:technique},sourceSurface??"studio");this.toast(reused?"This exact full-quality image is already in the queue.":`${technique==="prose"?"Full-quality generation":`${technique} full-quality generation`} queued. You can keep editing and queue the updated document too.`);
    } catch (error) { this.toast(error instanceof Error ? error.message : "Generation failed"); }
  }

  async generatePromptFan(kind:"preview"|"generate",options:{sourceSurface?:string;sourcePreviewId?:string}={}){
    const context=this.#generationContext();const promptFanId=crypto.randomUUID();let started=0;
    for(const technique of PROMPT_TECHNIQUES){try{const requestKey=generationRequestKeyFor(kind,context.documentRevision,options.sourcePreviewId,technique,promptFanId);await this.#startDocumentJob(kind,{...context,sourcePreviewId:options.sourcePreviewId,requestKey,promptTechnique:technique,promptFanId},options.sourceSurface??"studio");started+=1;}catch(error){this.toast(`${started} of 4 prompt fan requests queued. ${error instanceof Error?error.message:"The remaining request could not be started."}`);return promptFanId;}}
    this.toast(`${kind==="preview"?"Draft":"Full-quality"} prompt fan queued · prose, bullets, JSON, and XML.`);return promptFanId;
  }

  async preferPromptTechnique(technique:PromptTechnique,scope:PromptPreferenceScope,source:{fanId?:string|null;outputId?:string|null}={}){
    const projection=this.projection.get();const collectionId=projection.membership[projection.documentId]?.collectionId;const scopeId=scope==="document"?projection.documentId:scope==="collection"?collectionId:scope==="project"?projection.projectId:this.session.get()?.user.userId;
    if(!scopeId){this.toast("File this document in a collection before setting a folder preference.");return false;}
    const appended=await this.append({type:"PromptTechniquePreferred",payload:{preference_id:crypto.randomUUID(),preference_kind:"prompt_technique",technique:normalizePromptTechnique(technique),scope,scope_id:scopeId,document_id:projection.documentId,project_id:projection.projectId,source_fan_id:source.fanId??null,source_output_id:source.outputId??null}});
    if(appended.length)this.toast(`${normalizePromptTechnique(technique)} prompts preferred for this ${scope==="collection"?"folder":scope}.`);return Boolean(appended.length);
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

  async structureAdaptive(prompt:string) {
    try{this.dismissAdaptiveStructure();await this.#startDocumentJob("structure_adaptive",{prompt,documentId:this.projection.get().documentId},"adaptive");this.toast("Adaptive planning started. You can continue working while it runs.");return null;}catch(error){this.toast(error instanceof Error?error.message:"Forma could not structure that intent");return null;}
  }

  async openProject(projectId:string,destination="/") {
    const projection=this.projection.get();if(!projectId||projectId===projection.projectId){this.setRoute(destination);return true;}
    const target=projection.projects.find((project)=>project.id===projectId);if(!target){this.toast("That project is no longer available.");return false;}
    const appended=await this.append({type:"ProjectOpened",payload:{project_id:projectId,previous_project_id:projection.projectId,source_surface:"projects"}});
    if(!appended.length)return false;this.patchUi({focusBlockId:"",focusCollectionId:"",selectedOutputId:"",compareOpen:false});this.setRoute(destination);this.toast(`${target.name} opened in Studio.`);return true;
  }

  async openDocument(documentId: string, destination="/", sourceSurface?: string) {
    const projection=this.projection.get();const target=projection.documents.find((document)=>document.id===documentId);const routedDestination = withDocumentInRoute(destination, documentId, target?.title ?? "");
    if(!documentId||documentId===projection.documentId){this.setRoute(routedDestination);return true;}
    const appended=await this.append({type:"DocumentOpened",payload:{document_id:documentId,previous_document_id:projection.documentId,source_surface:sourceSurface??(documentViewFromRoute(destination)==="document"?"studio":"studio-alternative")}});
    if(!appended.length)return false;this.patchUi({focusBlockId:"",selectedOutputId:"",compareOpen:false});this.setRoute(routedDestination);this.toast("Document opened.");return true;
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
      const response = await fetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "evaluate_extractors", expectedSequence: this.head.get(), clientId: "web:system" }) });
      const body = await response.json() as { appended?: CreativeEvent[]; head?: number; error?: string };
      if (!response.ok) throw new Error(body.error === "admin_required" ? "An admin must witness the quality-gate rerun." : body.error ?? "Extractor evaluation failed");
      this.events.set([...this.events.get(), ...(body.appended ?? [])]); this.head.set(body.head ?? this.head.get()); this.toast("Extractor gate passed and the result was appended to the event stream.");
    } catch (error) { this.toast(error instanceof Error ? error.message : "Extractor evaluation failed"); }
    finally { this.busy.set(""); this.notify(); }
  }

  async rebuildIndex() {
    this.busy.set("phase7-index"); this.notify();
    try {
      const response = await fetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "rebuild_index", expectedSequence: this.head.get(), clientId: "web:library" }) });
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

  async calculateImageFocalPoint(input:{targetKind:"generation"|"reference";targetId:string;mediaUrl:string;referenceId?:string;sample?:ImageSample}){
    const key=`${input.targetKind}:${input.targetId}:${input.mediaUrl}`;if(!input.mediaUrl||this.#focalInFlight.has(key)||this.#hasFocalPoint(input.targetKind,input.targetId))return null;this.#focalInFlight.add(key);
    try{
      const sample=input.sample??(await resolveImageFocalAnalysis(input.mediaUrl)).sample;
      let resolved:unknown=null;
      const append=async()=>{if(this.#hasFocalPoint(input.targetKind,input.targetId))return;const response=await fetch("/api/events",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"calculate_focal_point",clientId:"web:focal-extractor",targetKind:input.targetKind,targetId:input.targetId,referenceId:input.referenceId,mediaUrl:input.mediaUrl,sample})});const body=await response.json() as {appended?:CreativeEvent[];head?:number;focalPoint?:unknown;error?:string};if(!response.ok)throw new Error(body.error??"focal_point_calculation_failed");const appended=body.appended??[];if(appended.length){this.events.set([...this.events.get(),...appended]);this.head.set(body.head??this.head.get());this.#publishAppended(appended);this.notify();}resolved=body.focalPoint??null;};
      const task=this.#focalAppendQueue.then(append);this.#focalAppendQueue=task.catch(()=>{});await task;return normalizeImageFocalPoint(resolved);
    }catch{return null;}finally{this.#focalInFlight.delete(key);}
  }

  async closeSession() {
    this.busy.set("close-session"); this.notify();
    try {
      const response = await fetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "close_session", expectedSequence: this.head.get(), clientId: "web:sessions" }) });
      const body = await response.json() as { appended?: CreativeEvent[]; head?: number; error?: string; eligibility?: { closedSessions?: number; requiredClosedSessions?: number } };
      if (!response.ok) throw new Error(body.error === "no_open_session" ? "Open a session before closing it." : body.error ?? "Session could not be closed");
      this.events.set([...this.events.get(), ...(body.appended ?? [])]); this.head.set(body.head ?? this.head.get()); this.toast(`Session closed with a state receipt · ${body.eligibility?.closedSessions ?? 0}/${body.eligibility?.requiredClosedSessions ?? 3} toward brief eligibility.`);
    } catch (error) { this.toast(error instanceof Error ? error.message : "Session could not be closed"); }
    finally { this.busy.set(""); this.notify(); }
  }

  async openSession() {
    this.busy.set("open-session"); this.notify();
    try {
      const response = await fetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "open_session", expectedSequence: this.head.get(), clientId: "web:sessions" }) });
      const body = await response.json() as { appended?: CreativeEvent[]; head?: number; error?: string; briefComposed?: boolean };
      if (!response.ok) throw new Error(body.error === "session_already_open" ? "The current session is already open." : body.error ?? "Session could not be opened");
      this.events.set([...this.events.get(), ...(body.appended ?? [])]); this.head.set(body.head ?? this.head.get()); this.toast(body.briefComposed ? "Session opened with an eligible re-entry brief; every impression was witnessed." : "Session opened. More history is needed before composing a valid brief.");
    } catch (error) { this.toast(error instanceof Error ? error.message : "Session could not be opened"); }
    finally { this.busy.set(""); this.notify(); }
  }

  async composeBrief() {
    this.busy.set("compose-brief"); this.notify();
    try {
      const response = await fetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "compose_brief", expectedSequence: this.head.get(), clientId: "web:sessions" }) });
      const body = await response.json() as { appended?: CreativeEvent[]; head?: number; error?: string; eligibility?: { reasons?: string[] } };
      if (!response.ok) throw new Error(body.error === "brief_not_eligible" ? `Brief is not eligible: ${body.eligibility?.reasons?.join(" and ") ?? "more history required"}.` : body.error === "open_session_required" ? "Open a session before composing a brief." : body.error ?? "Brief could not be composed");
      this.events.set([...this.events.get(), ...(body.appended ?? [])]); this.head.set(body.head ?? this.head.get()); this.toast("Re-entry brief composed from the event stream; impressions were witnessed in the same batch.");
    } catch (error) { this.toast(error instanceof Error ? error.message : "Brief could not be composed"); }
    finally { this.busy.set(""); this.notify(); }
  }

  async declareIntent(statement: string, deadline: string | null = null) {
    this.busy.set("declare-intent"); this.notify();
    try {
      const response = await fetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "declare_intent", expectedSequence: this.head.get(), clientId: "web:sessions", statement, deadline }) });
      const body = await response.json() as { appended?: CreativeEvent[]; head?: number; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Intent could not be recorded");
      this.events.set([...this.events.get(), ...(body.appended ?? [])]); this.head.set(body.head ?? this.head.get()); this.toast("Intent recorded privately; the immutable event keeps only its expiring reference.");
    } catch (error) { this.toast(error instanceof Error ? error.message : "Intent could not be recorded"); }
    finally { this.busy.set(""); this.notify(); }
  }

  async runScout(maxObservations: number) {
    this.busy.set("run-scout"); this.notify();
    try {
      const response = await fetch("/api/events", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({action:"run_scout",expectedSequence:this.head.get(),clientId:"web:scout",maxObservations}) });
      const body = await response.json() as {appended?:CreativeEvent[];head?:number;error?:string};
      if(!response.ok) throw new Error(body.error === "phase6_advance_required" ? "Record the Phase 6 advance-with-monitoring decision first." : body.error ?? "Scout run failed");
      this.events.set([...this.events.get(),...(body.appended??[])]);this.head.set(body.head??this.head.get());this.toast("Scout report completed inside its hard planning envelope.");
    } catch(error) { this.toast(error instanceof Error?error.message:"Scout run failed"); }
    finally { this.busy.set("");this.notify(); }
  }

  async refreshTasteModel() {
    this.busy.set("taste-model");this.notify();
    try {
      const response=await fetch("/api/events",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"refresh_taste_model",expectedSequence:this.head.get(),clientId:"web:memory"})});
      const body=await response.json() as {appended?:CreativeEvent[];head?:number;error?:string;beliefs?:number};if(!response.ok)throw new Error(body.error === "phase6_advance_required"?"Record the Phase 6 advance-with-monitoring decision first.":body.error??"Taste model refresh failed");
      this.events.set([...this.events.get(),...(body.appended??[])]);this.head.set(body.head??this.head.get());this.toast(`Taste model versioned with ${body.beliefs??0} ranking-only belief${body.beliefs===1?"":"s"}.`);
    } catch(error){this.toast(error instanceof Error?error.message:"Taste model refresh failed");}
    finally{this.busy.set("");this.notify();}
  }

  async setCondition(condition:string,triggerKind:"generation_count"|"on_date",threshold:number,onDate:string|null){
    this.busy.set("set-condition");this.notify();
    try{const response=await fetch("/api/events",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"set_condition",expectedSequence:this.head.get(),clientId:"web:memory",condition,triggerKind,threshold,onDate})});const body=await response.json() as {appended?:CreativeEvent[];content?:Record<string,string>;head?:number;error?:string};if(!response.ok)throw new Error(body.error??"Condition could not be set");this.events.set([...this.events.get(),...(body.appended??[])]);this.content.set({...this.content.get(),...(body.content??{})});this.head.set(body.head??this.head.get());this.toast("Time policy recorded privately.");return true;}catch(error){this.toast(error instanceof Error?error.message:"Condition could not be set");return false;}finally{this.busy.set("");this.notify();}
  }

  async checkConditions(){
    this.busy.set("check-conditions");this.notify();
    try{const response=await fetch("/api/events",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"check_conditions",expectedSequence:this.head.get(),clientId:"web:memory"})});const body=await response.json() as {appended?:CreativeEvent[];head?:number;error?:string};if(!response.ok)throw new Error(body.error??"Policy check failed");this.events.set([...this.events.get(),...(body.appended??[])]);this.head.set(body.head??this.head.get());this.toast(body.appended?.length?`${Math.floor(body.appended.length/2)} condition${body.appended.length===2?"":"s"} resurfaced.`:"No time policies are due yet.");}catch(error){this.toast(error instanceof Error?error.message:"Policy check failed");}finally{this.busy.set("");this.notify();}
  }

  async critiqueObject(objectId:string,axis:string,polarity:"positive"|"negative",value:string,note:string){
    this.busy.set("critique-object");this.notify();
    try{const response=await fetch("/api/events",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"critique_object",expectedSequence:this.head.get(),clientId:"web:studio",objectId,axis,polarity,value,note})});const body=await response.json() as {appended?:CreativeEvent[];content?:Record<string,string>;head?:number;error?:string};if(!response.ok)throw new Error(body.error??"Critique could not be recorded");this.events.set([...this.events.get(),...(body.appended??[])]);this.content.set({...this.content.get(),...(body.content??{})});this.head.set(body.head??this.head.get());this.toast("Axis-specific critique recorded for the taste ledger.");return true;}catch(error){this.toast(error instanceof Error?error.message:"Critique could not be recorded");return false;}finally{this.busy.set("");this.notify();}
  }

  async loadShares() {
    const response = await fetch("/api/shares"); if (!response.ok) return; const body = await response.json() as { shares: ShareRecord[] }; this.shares.set(body.shares); this.notify();
  }

  async createShare(expiresHours: number) {
    const response = await fetch("/api/shares", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expiresHours }) }); const body = await response.json() as { share?: ShareRecord; error?: string };
    if (!response.ok || !body.share) { this.toast(body.error ?? "Share link could not be created"); return null; }
    await this.loadShares(); this.toast("Private read-only link created."); return body.share;
  }

  async revokeShare(shareId: string) {
    const response = await fetch(`/api/shares/${encodeURIComponent(shareId)}`, { method: "DELETE" }); const body = await response.json() as { error?: string };
    if (!response.ok) return this.toast(body.error ?? "Share link could not be revoked"); await this.loadShares(); this.toast("Share link revoked immediately.");
  }

  canUndo() {
    if(this.#undo.some((event)=>Boolean(inverseEvent(event))))return true;const compensated=new Set(this.events.get().map((event)=>event.compensatesEventId).filter(Boolean));
    return this.events.get().some((event)=>event.actor==="user"&&!event.compensatesEventId&&!compensated.has(event.eventId)&&Boolean(inverseEvent(event)));
  }
  canRedo() { return this.#redo.length>0; }
  #undoCandidate() {
    while(this.#undo.length){const event=this.#undo.pop()!;if(inverseEvent(event))return event;}
    const compensated=new Set(this.events.get().map((event)=>event.compensatesEventId).filter(Boolean));
    return [...this.events.get()].reverse().find((event)=>event.actor==="user"&&!event.compensatesEventId&&!compensated.has(event.eventId)&&Boolean(inverseEvent(event)));
  }
  async undo() {
    const source = this.#undoCandidate(); if (!source) return this.toast(documentViewFromRoute(this.route.get()) === "editor" ? "Nothing to undo." : "Nothing reversible remains in this document history.");
    const inverse = inverseEvent(source)!;
    const appended = await this.append({ ...inverse, compensatesEventId: source.eventId }, { remember: false });
    if (appended.length) this.#redo.push(source);
  }

  async redo() {
    const source = this.#redo.pop(); if (!source) return this.toast("Nothing to redo in this session.");
    const appended = await this.append({ type: source.type, payload: source.payload }, { remember: false });
    const redone=appended.find((event)=>event.actor==="user"&&Boolean(inverseEvent(event)));if(redone)this.#undo.push(redone);
  }

  buildReplay(key: ScenarioKey, count: number) { const events = buildScenario(key, count); this.replayEvents.set(events); this.replayAsOf.set(0); this.notify(); }
  setReplayAsOf(value: number) { this.replayAsOf.set(value); this.notify(); }
}

function inverseEvent(event: CreativeEvent): EventInput | null {
  const p = event.payload;
  const pairs: Record<string, string> = { BlockLocked: "BlockUnlocked", BlockUnlocked: "BlockLocked", BlockRemoved: "BlockRestored", BlockRestored: "BlockRemoved", BlockRelationAdded: "BlockRelationRemoved", BlockRelationRemoved: "BlockRelationAdded", DocumentRemoved: "DocumentRestored", DocumentRestored: "DocumentRemoved", ObjectPinned: "ObjectUnpinned", ObjectUnpinned: "ObjectPinned", AddedToLibrary: "RemovedFromLibrary", RemovedFromLibrary: "AddedToLibrary" };
  if (pairs[event.type]) return { type: pairs[event.type], payload: p };
  if (event.type === "BlockCreated") return { type: "BlockRemoved", payload: { block_id: p.block_id, reason: "undo-created-block" } };
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
  return null;
}

export const store = new FormaStore();
