import { actionHelp, readOnboardingFlag } from './onboarding.ts';
import './vendor/elements/define/tooltip.js';
import { DecisionMemo, stableDecisionKey } from './decision-cache.ts';
import { StillAttentionObserver } from './attention-observer.ts';
import { generationActive, generationPreview, generationFormat, generationResult, generationStatus, stillResults } from './results.ts';
import { failureNotification, canContinueReview } from './notifications.ts';
import type { DocumentJob } from '../model/document-jobs.ts';
import './form-elements.js';
import type { PaletteFeedback } from './palette-feedback.ts';
import { actionLimit, type ExperimentResult } from './decision-lab.ts';
import './palette-elements.js';
import { localHistoryEvidence } from './history.ts';
import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { live } from 'lit/directives/live.js';
import { keyed } from 'lit/directives/keyed.js';
import './vendor/tokens/default.css';
import './theme.css';
import './vendor/elements/define/button.js';
import './vendor/elements/define/badge.js';
import './vendor/elements/define/toolbar.js';
import './vendor/elements/define/textarea.js';
import './style.css';
import './context-flow.ts';
import './use-in-flow.ts';
import type { StillUseInFlow } from './use-in-flow.ts';
import { explicitAction, paletteActions, nextToolbarActions, finderEntry } from './finder.ts';
import { presentActions, presentToolbar, type Emphasis } from './presentation.ts';
import './developer-console.ts';
import { DEVELOPER_DESKTOP_QUERY } from './developer-layout.ts';
import type { StillDeveloperConsole } from './developer-console.ts';
import { decisionDiagnostics, responseDisposition, type DecisionDiagnostics, type DecisionResponse, type ReceivedDecision } from './diagnostics.ts';
import { ACTIONS, POLICY_VERSION, eligibleActions, evaluateActions, rankAllFormats, selectActions, type Action } from './decisions.ts';
import { isContextCompositionRelation } from '../model/combined-context.ts';
import { documentSnapshot } from './context.ts';
import { generationReview, issueAffectsBlock, type GenerationReview } from './generation-review.ts';
import { api, ApiError, StillClient, type GenerationDraft } from './client.ts';
import { documentArtifactRevision, model3dArtifactMediaFile, parseDocumentArtifactContent, type DocumentArtifact } from '../model/document-artifacts.ts';
import { estimateModel3dCostMicrousd } from '../model/model3d.ts';
import { parseStillRoute, stillRouteProblem, stillURL, type StillRoute } from './routes.ts';
import type { StillContextFlow } from './context-flow.ts';
import type { CreativeProjection } from '../model/events.ts';

const REPORT_URL = 'http://127.0.0.1:4187';
const FORMATS: Record<string, string> = { image: 'Image', short_story: 'Short story', scene: 'Scene', slides: 'Presentation', storyboard: 'Storyboard', video: 'Video', audio: 'Audio', model3d: '3D model' };
const blockKinds = ['direction', 'subject', 'environment', 'style', 'exclusion', 'message', 'material', 'audience', 'emotion', 'composition'];
const activeJobs = new Set(['queued', 'running', 'committing']);
const text = (v: unknown) => typeof v === 'string' ? v : '';
const safeMedia = (url: string | null | undefined) => url?.startsWith('/api/media/') ? url : '';

export class StillApp extends LitElement {
  private client = new StillClient();
  private attention?:StillAttentionObserver;
  private decisionMemory=new DecisionMemo<DecisionResponse>({
    accept:r=>r.source==='jev'&&!r.reason&&r.policy===POLICY_VERSION&&r.head===this.client.head&&r.cache?.stored===true,
    ttl:r=>r.cache?.remainingMs??0,latency:r=>r.cache?.originalLatencyMs,age:r=>r.cache?.ageMs??0,
  });
  private decisionKey(body:unknown){return stableDecisionKey({scope:this.client.scopeKey,epoch:this.client.epoch,head:this.client.head,abilities:this.client.abilities,body});}
  private decisionBody(extra:Record<string,unknown>={}){return {...this.client.position,...extra,...(this.developer?{developer:true}:{})};}
  private async requestDecision(body:Record<string,unknown>,bypass=false,timeout?:number){
    const result=await this.decisionMemory.run(this.decisionKey(body),()=>api<DecisionResponse>('/api/still/decision',{...body,...(bypass?{cacheBypass:true}:{})},'POST',timeout),bypass);
    return result.cache.status==='hit'||result.cache.status==='shared'?{...result.value,cache:{...result.cache,layer:'browser' as const}}:result.value;
  }
  private refreshDecision=()=>{
    if(!this.developer||this.developerPending||this.paletteBusy||this.paletteRefreshing||this.busy||this.loading)return;
    this.decisionMemory.clear();
    if(this.paletteOpen){this.paletteTouched=false;void this.refreshPalette(true);}
    else{this.dockTouched=false;this.formatTouched=false;this.decide(true);}
  };
  private loading = true;
  private startupFailed = false;
  private contentRead: {key:string; error:string} | null = null;
  private busy = false;
  private errorMessage = '';
  private errorVersion = 0;
  private get error() { return this.errorMessage; }
  private set error(value:string) { this.errorMessage=value; ++this.errorVersion; }
  private noticeMessage = '';
  private noticeVersion = 0;
  private get notice() { return this.noticeMessage; }
  private set notice(value:string) { this.noticeMessage=value; ++this.noticeVersion; }
  private dismissedNotifications = new Set<string>();
  private reviewVersion = 0;
  private mode = '';
  private routeMode = '';
  private routeError = '';
  private activeAddress = '';
  private historyIndex = Number.isSafeInteger(history.state?.stillIndex)?history.state.stillIndex:0;
  private draftBaseline = '';
  private titleDraft = '';
  private bodyDraft = '';
  private kindDraft = 'direction';
  private pendingBlock: ReturnType<StillClient['blockEvent']> | null = null;
  private editBase: { text?: string; revision?: number; title?: string; item?: number } = {};
  private composing = false;
  private dockObserver = new ResizeObserver(entries => { const h = entries[0]?.contentRect.height ?? 140; this.style.setProperty('--dock-height', `${h + 70}px`); });
  private choice = '';
  private page = 0;
  private get itemIndex() { return this.client.position.itemIndex ?? 0; }
  private set itemIndex(value: number) { this.client.position.itemIndex = value; }
  private suggestions: Action[] = [];
  private emphasis:Record<string,Emphasis>={};
  private formatEmphasis:Record<string,Emphasis>={};
  private suggestionTargets:Record<string,string>={};
  private useInTarget='';
  private dockTouched=false;
  private moreOpen=false;
  private onboarding=false;
  private setOnboarding=(e:CustomEvent<{value:boolean}>)=>{this.onboarding=e.detail.value===true;try{localStorage.setItem('still:flag:onboarding',String(this.onboarding));}catch{}const url=new URL(location.href);url.searchParams.delete('onboarding');url.searchParams.delete('onbaording');history.replaceState(history.state,'',url);this.activeAddress=this.address();this.changed();};
  private help(id:string,label:string){return this.onboarding?html`<en-tooltip for=${id} show-delay="250"><span slot="content">${actionHelp(id.replace('still-help-',''),label)}</span></en-tooltip>`:nothing;}
  private density=5;
  private get pageActionLimit(){return this.developer?this.density:5;}
  private setDensity=(e:CustomEvent<{value:number}>)=>{this.density=actionLimit(e.detail.value);this.moreOpen=false;this.client.position.actionLimit=this.pageActionLimit;this.changed();};
  private experiment=async(e:CustomEvent<{scope:string;request:unknown;complete:(result?:ExperimentResult,error?:string)=>void}>)=>{const d=e.detail;if(!this.developer||d.scope!==this.diagnosticScope()){d.complete(undefined,'View changed. Copy a new request.');return;}try{const result=await api<ExperimentResult>('/api/still/experiment',d.request);d.complete(d.scope===this.diagnosticScope()?result:undefined,d.scope===this.diagnosticScope()?undefined:'View changed. Experiment discarded.');}catch(error){d.complete(undefined,error instanceof Error?error.message:'Experiment failed.');}};
  private rankedActions:Action[]=[];
  private paletteOpen=false;
  private paletteQuery='';
  private paletteChoice='';
  private paletteIndex=0;
  private paletteBusy=false;
  private paletteTicket=0;
  private paletteRefreshing=false;
  private paletteTouched=false;
  private paletteFeedback:PaletteFeedback|undefined;
  private paletteOrder:{rankedIds:string[];passedOverIds:string[]}={rankedIds:[],passedOverIds:[]};
  private toolbarSeen:string[]=[];
  private finderInferred=false;
  private finderMessage='';
  private decisionSource = 'fallback';
  private decisionTicket = 0;
  private decisionTimer = 0;
  private developerRequested = new URL(location.href).searchParams.has('developer');
  private readonly desktop = window.matchMedia(DEVELOPER_DESKTOP_QUERY);
  private get developer() { return this.developerRequested && this.desktop.matches; }
  private readonly developerViewportChanged = () => {
    if(!this.desktop.matches){this.density=5;this.client.position.actionLimit=5;}
    ++this.developerEpoch;
    this.developerApplied=undefined;this.developerReceived=undefined;this.developerPending=false;
    this.developerScope=this.diagnosticScope();this.changed();
    if(this.developer&&!this.loading&&!this.mode)this.decide();
  };
  private developerEpoch = 0;
  private developerPending = false;
  private developerApplied?: DecisionDiagnostics;
  private developerReceived?: ReceivedDecision;
  private developerScope = '';
  private pollTimer = 0;
  private lastHistoryPoll = 0;
  private lastJobsPoll = 0;
  private syncPending = false;
  private readonly resumeSync = () => { if (!document.hidden) void this.sync(true); };
  private directGeneration = false;
  private generation: GenerationDraft | null = null;
  private formatSuggestions: string[] = [];
  private formatTouched = false;
  private generationGate: GenerationReview | null = null;
  private ownership = false;
  private providerConsent = false;
  private disposed = false;
  private readonly popstate = (event:PopStateEvent) => {
    if(this.loading||this.address()===this.activeAddress)return;
    const index=Number.isSafeInteger(event.state?.stillIndex)?event.state.stillIndex:null;
    if(this.preventsRouteChange()){
      if(index!==null&&index!==this.historyIndex)history.go(this.historyIndex-index);
      else history.pushState({...history.state,stillIndex:this.historyIndex},'',this.activeAddress);
      this.error='Finish or close this step before leaving.';this.changed();return;
    }
    this.historyIndex=index??0;this.readRoute();this.changed();this.decide();this.focusContent();
  };
  createRenderRoot() { return this; }
  connectedCallback() {
    super.connectedCallback(); this.disposed = false;
    this.attention=new StillAttentionObserver(this,snapshot=>{
      const inspector=this.querySelector<StillDeveloperConsole>('still-developer-console');
      if(inspector?.context)inspector.context={...inspector.context,attention:snapshot};
    });
    try{this.onboarding=readOnboardingFlag(location.href,localStorage);}catch{this.onboarding=new URL(location.href).searchParams.has('onboarding');}
    this.client.onChange = () => { this.decisionMemory.clear(); if (this.client.recoveredWrite) { this.notice = 'Save confirmed.'; this.client.recoveredWrite = false; } this.changed(); };
    this.desktop.addEventListener('change', this.developerViewportChanged);
    window.addEventListener('keydown', this.paletteShortcut);
    window.addEventListener('popstate', this.popstate);
    window.addEventListener('beforeunload', this.beforeUnload);
    window.addEventListener('focus', this.resumeSync);
    document.addEventListener('visibilitychange', this.resumeSync);
    void this.run(() => this.loadWorkspace());
  }
  disconnectedCallback() { super.disconnectedCallback(); this.attention?.dispose();this.attention=undefined;this.decisionMemory.clear(); this.desktop.removeEventListener('change', this.developerViewportChanged); this.disposed = true; ++this.developerEpoch; this.developerApplied=undefined;this.developerReceived=undefined;this.dockObserver.disconnect(); clearTimeout(this.pollTimer); clearTimeout(this.decisionTimer); window.removeEventListener('keydown', this.paletteShortcut);window.removeEventListener('popstate', this.popstate); window.removeEventListener('beforeunload', this.beforeUnload); window.removeEventListener('focus', this.resumeSync); document.removeEventListener('visibilitychange', this.resumeSync); }
  private draftSignature(){const g=this.generation;return JSON.stringify([this.titleDraft,this.bodyDraft,this.kindDraft,g?.prompt,g?.tone,g?.audience,g?.itemCount]);}
  private preventsRouteChange(){return this.busy&&!this.loading||this.composing||this.client.hasUnconfirmedWrite||!!this.generation?.attempted||!!this.mode&&this.draftSignature()!==this.draftBaseline||!!this.querySelector<StillContextFlow>('still-context-flow')?.preventsRouteChange||!!this.querySelector<StillUseInFlow>('still-use-in-flow')?.preventsRouteChange;}
  private beforeUnload = (e: BeforeUnloadEvent) => { if (this.preventsRouteChange()) { e.preventDefault(); e.returnValue = ''; } };
  private changed() { this.requestUpdate(); }
  protected updated() {
    this.reconcileGeneration();
    this.hydrateVisibleWriting();
    const attentionPage=location.pathname;
    const attentionEnabled=!this.loading&&!this.startupFailed&&!!this.client.session?.policy.accepted;
    this.attention?.refresh(`${this.client.epoch}/${this.client.scopeKey}`,attentionEnabled?attentionPage:'',attentionEnabled,this.paletteOpen);
    const dock = this.querySelector('.action-dock'); this.dockObserver.disconnect(); if (dock) this.dockObserver.observe(dock);
    const inspector=this.querySelector<StillDeveloperConsole>('still-developer-console');
    if(inspector){
      if(this.developerScope!==this.diagnosticScope()){this.developerApplied=undefined;this.developerReceived=undefined;this.developerScope=this.diagnosticScope();}
      inspector.context={onboarding:this.onboarding,historyComplete:this.client.historyComplete,canRefreshDecision:!this.loading&&!this.busy&&(this.paletteOpen||this.mode==='generate'&&!this.generation||!this.mode&&this.client.position.view!=='generation'),attention:this.attention?.summary.snapshot(),view:this.client.position.view,mode:this.mode,head:this.client.head,page:this.page,actionLimit:this.pageActionLimit,more:this.moreOpen,paletteOpen:this.paletteOpen,paletteFeedback:this.paletteFeedback,paletteOrder:this.paletteOrder,selectedFormat:this.generation?.format??'',current:this.localDiagnostics('Current eligibility')};
      inspector.applied=this.developerApplied;inspector.received=this.developerReceived;inspector.pending=this.developerPending||this.paletteBusy||this.paletteRefreshing;
      inspector.scope=this.diagnosticScope();
    }
  }
  private interactionScope(){return JSON.stringify([this.client.epoch,this.client.scopeKey,this.client.position.projectId,this.client.position.documentId]);}
  private diagnosticScope(){return `${this.developerEpoch}/${this.interactionScope()}`;}
  private localDiagnostics(reason:string, formats=false){return decisionDiagnostics(this.client.projection,{...this.client.position,...(formats?{view:'choose-format'}:{})},this.client.abilities,{head:this.client.head,source:'fallback',reason,localEvents:localHistoryEvidence(this.client.events),artifactKind:this.client.projection.artifacts.find(a=>a.id===this.client.position.outputId)?.kind});}
  private recordDecision(result:DecisionResponse,disposition:string,scope:string,started:number){
    if(!this.developer||this.disposed||scope!==this.diagnosticScope())return;
    this.developerReceived={preparation:result.preparation,cache:result.cache,receivedAt:Date.now(),at:new Date().toLocaleTimeString(),requestElapsedMs:Math.max(0,performance.now()-started),disposition,trace:result.diagnostics,source:result.source,reason:result.reason,recommended:result.paletteActions?.map(a=>a.id)??(result.formats?.length?result.formats:result.actions?.map(a=>a.id)??[])};
    if(disposition==='Applied')this.developerApplied=result.diagnostics;
    this.changed();
  }
  private setDeveloper(enabled:boolean){
    if(enabled&&!this.desktop.matches)return;
    ++this.developerEpoch;
    if(!enabled){this.density=5;this.client.position.actionLimit=5;}
    this.developerRequested=enabled;this.developerApplied=undefined;this.developerReceived=undefined;this.developerPending=false;this.developerScope=this.diagnosticScope();
    const url=new URL(location.href);if(enabled)url.searchParams.set('developer','');else url.searchParams.delete('developer');history.replaceState({...history.state},'',url);this.activeAddress=this.address();
    this.changed();
    if(enabled){if(!this.mode)this.decide();void this.updateComplete.then(()=>this.querySelector<StillDeveloperConsole>('still-developer-console')?.show());}
    else this.focusContent();
  }
  private focusContent() { void this.updateComplete.then(() => { const target = this.querySelector('en-textarea, en-text-field, en-select, main h1') as HTMLElement | null; if(target) { if(target.tagName === 'H1') target.tabIndex = -1; target.focus(); } }); }
  private async run(work: () => Promise<void>) {
    if (this.busy || this.composing) return;
    this.busy = true; this.error = ''; this.changed();
    try { await work(); } catch (error) { this.error = error instanceof Error ? error.message : 'Could not complete this step.'; }
    finally { this.busy = false; this.loading = false; this.changed(); }
  }
  private async loadWorkspace() {
    this.loading = true; this.startupFailed = false; this.changed();
    try {
      await this.client.load({hydrateContent:false,route:parseStillRoute(location.href)??{documentId:""}}); this.readRoute(); this.loading = false;
      this.changed();
      const address=this.address();void this.client.completeHistory().then(()=>{if(this.disposed)return;if(this.routeError&&this.address()===address)this.readRoute();this.changed();}).catch(error=>{if(!this.disposed){this.error=error instanceof Error?error.message:"History unavailable. Refresh to retry.";this.changed();}});
      this.lastHistoryPoll = Date.now(); this.decide(); this.poll();
    } catch (error) { this.startupFailed = true; throw error; }
  }
  private missingWriting() {
    if (this.loading || this.startupFailed || this.client.position.view !== 'artifact') return null;
    const artifact = this.client.projection.artifacts.find(a=>a.id===this.client.position.outputId);
    return artifact?.contentRef && ['short_story','scene','slides','storyboard'].includes(artifact.kind) && !(artifact.contentRef in this.client.content) ? artifact : null;
  }
  private hydrateVisibleWriting() {
    const artifact = this.missingWriting(); if (!artifact) return;
    const key = `${this.interactionScope()}/${artifact.id}/${artifact.contentRef}/${documentArtifactRevision(this.client.events,artifact.id)}`;
    if (this.contentRead?.key === key) return;
    const read = this.contentRead = {key,error:''}; this.changed();
    void this.client.ensureContent(artifact.contentRef!).then(()=>{
      if (this.contentRead!==read || this.disposed) return;
      if (this.mode==='edit-artifact' && this.client.position.outputId===artifact.id) this.begin('edit-artifact',false);
    }).catch(error=>{if(this.contentRead===read)read.error=error instanceof Error?error.message:'Writing unavailable.';})
      .finally(()=>{if(this.contentRead===read){if(!read.error)this.contentRead=null;this.changed();}});
  }
  private renderWritingLoad() {
    return html`<section class="quiet-state"><h1>${this.contentRead?.error ? 'Writing unavailable' : 'Loading writing…'}</h1>${this.contentRead?.error ? html`<p role="alert">${this.contentRead.error}</p>${this.button('Try again',()=>{this.contentRead=null;this.changed();})}` : nothing}</section>`;
  }
  private readRoute() {
    const q = new URL(location.href).searchParams, route=parseStillRoute(location.href);
    if(this.developerRequested!==q.has('developer'))++this.developerEpoch;
    this.developerRequested=q.has('developer');if(!this.developer){this.developerApplied=undefined;this.developerReceived=undefined;}
    if(this.mode==='generate')this.client.position.intent='';
    this.resetStep();this.routeError='';this.error='';this.notice='';
    if(!route){this.routeError='Page not found';this.activeAddress=this.address();return;}
    const changedDocument=route.projectId!==this.client.position.projectId||route.documentId!==this.client.position.documentId;
    this.client.position={...this.client.position,...(changedDocument?{intent:'',recentActions:[]}:{}),projectId:route.projectId,documentId:route.documentId,blockId:route.blockId,outputId:route.outputId,view:route.view,itemIndex:route.itemIndex};this.page=route.page;
    if(!this.client.session?.policy.accepted){this.activeAddress=this.address();return;}
    const p = this.client.projection;
    if(route.legacy&&route.documentId&&!route.projectId){route.projectId=p.documents.find(d=>d.id===route.documentId)?.projectId??'';this.client.position.projectId=route.projectId;}
    this.routeError=stillRouteProblem(route,p,this.resultCount());
    if(route.documentId&&!this.routeError)void this.client.pollJobs().catch(()=>{});
    if(!this.routeError&&route.mode){
      const allowed=this.candidates().some(a=>a.id===(route.mode==='generate'?'create':route.mode))||['actions','workspaces'].includes(route.mode)||route.mode==='generate'&&!!this.client.pendingGeneration;
      if(!allowed)this.routeError='Action unavailable';
      else if(route.mode==='generate'){
        try{const format=this.client.pendingGeneration?.format??route.format;if(format)this.generation=this.client.prepareGeneration(format);this.begin('generate',false);}
        catch(error){this.routeError=error instanceof Error?error.message:'Format unavailable';}
      }else this.begin(route.mode,false);
    }
    if(!this.routeError)this.writeRoute(true);
    else {this.activeAddress=this.address();history.replaceState({...history.state,stillIndex:this.historyIndex},'',this.activeAddress);}
  }
  private address(){return location.pathname+location.search+location.hash;}
  private currentRoute():StillRoute{return {...this.client.position,itemIndex:this.itemIndex,page:this.page,mode:this.routeMode,format:this.generation?.format??''};}
  private currentRouteProblem(p:CreativeProjection){
    if(this.routeError)return this.routeError;
    const expected=parseStillRoute(this.activeAddress||location.href), current=this.currentRoute();
    if(expected&&!expected.legacy&&(['projectId','documentId','blockId','outputId','view','itemIndex'] as const).some(key=>expected[key]!==current[key]))return 'Workspace changed. Reopen this link.';
    return stillRouteProblem(current,p,this.resultCount());
  }
  private resultCount(){return this.client.jobsLoaded?stillResults(this.client.projection,this.client.jobs,this.client.events).length:Infinity;}
  private reconcileGeneration(){
    const c=this.client;
    if(this.loading||this.mode||c.position.view!=='generation'||this.currentRouteProblem(c.projection))return;
    const job=c.jobs.find(j=>j.jobId===c.position.outputId&&j.documentId===c.position.documentId);
    const id=job?generationResult(job,c.projection,c.events):'';
    if(!id)return;
    c.position={...c.position,view:'artifact',outputId:id};this.writeRoute(true);this.changed();this.decide();
  }
  private writeRoute(replace=false){
    const url=stillURL(this.currentRoute(),location.href);
    if(replace||url!==this.address()){
      if(!replace)++this.historyIndex;
      history[replace?'replaceState':'pushState']({...history.state,stillIndex:this.historyIndex},'',url);
    }
    this.activeAddress=url;
  }
  private resetStep(){this.toolbarSeen=[];this.paletteFeedback=undefined;this.paletteRefreshing=false;this.moreOpen=false;this.paletteOpen=false;++this.paletteTicket;this.dockTouched=false;this.useInTarget='';this.emphasis={};this.formatEmphasis={};++this.decisionTicket;clearTimeout(this.decisionTimer);this.mode='';this.routeMode='';this.bodyDraft='';this.titleDraft='';this.pendingBlock=null;this.generation=null;this.generationGate=null;this.formatSuggestions=[];this.formatTouched=false;this.developerPending=false;}
  private navigate(view: string, ids: Partial<StillClient['position']> = {}) {
    this.resetStep();this.page = 0; this.itemIndex = 0; this.error = '';this.routeError='';this.notice='';
    const changedDocument = ids.documentId !== undefined && ids.documentId !== this.client.position.documentId || ids.projectId !== undefined && ids.projectId !== this.client.position.projectId;
    this.client.position = { ...this.client.position, ...(changedDocument ? { intent:'', recentActions:[] } : {}), blockId: '', outputId: '', ...ids, view };
    const p = this.client.position;
    this.writeRoute(); this.changed(); this.focusContent(); this.decide();
    if (p.documentId) void this.client.pollJobs().catch(() => {});
  }
  private viewURL(view:string,ids:Partial<StillClient['position']>={}){return stillURL({...this.currentRoute(),blockId:'',outputId:'',itemIndex:0,page:0,mode:'',format:'',...ids,view},location.href);}
  private follow(event:MouseEvent,view:string,ids:Partial<StillClient['position']>={}){
    if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||event.defaultPrevented)return;
    event.preventDefault();if(!this.busy&&!this.composing)this.navigate(view,ids);
  }
  private home=(event:MouseEvent)=>{
    if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||event.defaultPrevented)return;
    if(this.preventsRouteChange()){event.preventDefault();this.error='Finish or close this step before leaving.';this.changed();return;}
    this.follow(event,'projects',{projectId:'',documentId:''});
  };
  private turnPage(page:number){this.dockTouched=false;this.page=Math.max(0,page);this.writeRoute();this.changed();this.decide();}
  private turnItem(item:number){this.dockTouched=false;this.itemIndex=item;this.writeRoute();this.changed();this.decide();}
  private candidates() { return eligibleActions(this.client.projection, this.client.position, this.client.abilities); }
  private decide(bypass=false) {
    if(this.client.position.view==='generation'&&!this.mode){clearTimeout(this.decisionTimer);++this.decisionTicket;this.developerPending=false;this.developerReceived=undefined;this.developerApplied=this.developer?this.localDiagnostics('Generation progress uses Document, Results and Palette navigation.'):undefined;return;}
    if(this.currentRouteProblem(this.client.projection))return;
    if(this.mode){clearTimeout(this.decisionTimer);if(this.mode==='generate'&&!this.generation){++this.decisionTicket;this.suggestFormats(bypass);}return;}
    clearTimeout(this.decisionTimer); const ticket = ++this.decisionTicket;
    const candidates = this.candidates(); if(this.dockTouched)return;this.suggestions = selectActions(candidates, this.client.position);this.rankedActions=evaluateActions(candidates,this.client.position).ranked;this.moreOpen=false;this.emphasis=presentActions(this.suggestions.map(a=>a.id));this.suggestionTargets={}; this.decisionSource = 'fallback'; this.changed();
    if(this.developer){this.developerScope=this.diagnosticScope();this.developerApplied=this.localDiagnostics('Local policy');this.developerReceived=undefined;this.developerPending=false;}
    if (!this.client.session?.policy.accepted || this.mode) return;
    this.decisionTimer = window.setTimeout(async () => {
      const snapshot = JSON.stringify(this.client.position), head = this.client.head, scope=this.interactionScope(), diagnosticScope=this.diagnosticScope();
      this.developerPending=this.developer;this.changed();
      const started=performance.now();
      try {
        const result = await this.requestDecision(this.decisionBody(),bypass);
        const disposition=responseDisposition(result,{head:this.client.head,headChanged:head!==this.client.head,stale:ticket!==this.decisionTicket||snapshot!==JSON.stringify(this.client.position)||!!this.mode||this.disposed||scope!==this.interactionScope(),focused:this.dockTouched||!!this.querySelector('.action-dock')?.contains(document.activeElement)});
        this.recordDecision(result,disposition,diagnosticScope,started);
        if(disposition==='Applied'){const allowed=new Map(this.candidates().map(a=>[a.id,a]));this.suggestions=result.actions!.map(a=>allowed.get(a.id)).filter((a):a is Action=>!!a).slice(0,4);this.rankedActions=(result.rankedActions??result.actions??[]).map(a=>allowed.get(a.id)).filter((a):a is Action=>!!a);this.emphasis=result.presentation??presentActions(this.suggestions.map(a=>a.id));this.suggestionTargets=result.targets??{};this.decisionSource=result.source;this.changed();}
      } catch(error) { this.recordDecision({source:'fallback',reason:error instanceof ApiError?`HTTP ${error.status}`:'Network unavailable',head,policy:POLICY_VERSION},'Kept local controls',diagnosticScope,started); }
      finally {if(ticket===this.decisionTicket){this.developerPending=false;this.changed();}}
    }, bypass||this.decisionMemory.peek(this.decisionKey(this.decisionBody()))?0:700);
  }
  private suggestFormats(bypass=false) {
    const ticket = this.decisionTicket, snapshot = JSON.stringify(this.client.position), head = this.client.head, scope = this.interactionScope();
    if(this.developer){this.developerApplied=this.localDiagnostics('No automatic format choice',true);this.developerReceived=undefined;}
    this.decisionTimer = window.setTimeout(async () => {
      const diagnosticScope=this.diagnosticScope(),started=performance.now();
      try {
        if (ticket !== this.decisionTicket || this.mode !== 'generate' || this.generation || this.formatTouched || scope!==this.interactionScope()) return;
        this.developerPending=this.developer;this.changed();
        const result = await this.requestDecision(this.decisionBody({view:'choose-format'}),bypass);
        const disposition=responseDisposition(result,{formats:true,head:this.client.head,headChanged:head!==this.client.head,stale:ticket!==this.decisionTicket||this.mode!=='generate'||!!this.generation||this.disposed||scope!==this.interactionScope()||snapshot!==JSON.stringify(this.client.position),touched:this.formatTouched});
        this.recordDecision(result,disposition,diagnosticScope,started);
        if (disposition==='Applied') {
          const allowed = new Set(this.candidates().filter(a=>!!FORMATS[a.id]).map(a=>a.id));
          this.formatSuggestions = [...new Set(result.rankedFormats ?? result.formats!)].filter(id=>allowed.has(id));this.formatEmphasis=result.presentation??presentActions(this.formatSuggestions); this.changed();
        }
      } catch(error) { this.recordDecision({source:'fallback',reason:error instanceof ApiError?`HTTP ${error.status}`:'Network unavailable',head,policy:POLICY_VERSION},'Kept local format order',diagnosticScope,started); }
      finally {if(ticket===this.decisionTicket){this.developerPending=false;this.changed();}}
    }, bypass||this.decisionMemory.peek(this.decisionKey(this.decisionBody({view:'choose-format'})))?0:1300);
  }
  private async sync(force = false) {
    if (this.syncPending || this.disposed || this.loading || this.busy || document.hidden || !this.client.session?.policy.accepted) return;
    const now = Date.now(), work: Promise<void>[] = [];
    this.syncPending = true;
    try {
      // Keep collaborator edits current independently of whether this page has jobs.
      if (force || now - this.lastHistoryPoll >= 30000) { this.lastHistoryPoll = now; work.push(this.client.refresh()); }
      const interval = this.client.jobs.some(j => activeJobs.has(j.status)) ? 2000 : 60000;
      if (this.client.position.documentId && (force || now - this.lastJobsPoll >= interval)) { this.lastJobsPoll = now; work.push(this.client.pollJobs()); }
      await Promise.allSettled(work);
    } finally { this.syncPending = false; }
  }
  private poll() {
    this.pollTimer = window.setTimeout(async () => {
      await this.sync();
      if (!this.disposed) this.poll();
    }, 2000);
  }
  private suggestedButton(a:Action,format=false,presentation?:Record<string,Emphasis>){const e=(presentation??(format?this.formatEmphasis:this.emphasis))[a.id]??{variant:'secondary',size:'medium',tier:'peer',reason:'No clear leader'};return html`<en-button id=${"still-help-"+a.id} data-action-id=${a.id} data-tier=${e.tier} data-emphasis-reason=${e.reason} variant=${e.variant} size=${e.size} .disabled=${this.busy||this.composing} @click=${()=>format?void this.startGeneration(a.id):this.choose(a.id)}>${a.label}</en-button>${this.help("still-help-"+a.id,a.label)}`;}
  private toolbarSuggestions(actions:Action[]){const emphasis=presentToolbar(actions.map(a=>a.id),this.emphasis,{view:this.client.position.view,more:this.moreOpen});return actions.map(a=>this.suggestedButton(a,false,emphasis));}
  private paletteShortcut=(event:KeyboardEvent)=>{
    if(event.isComposing||event.keyCode===229)return;
    if((event.metaKey||event.ctrlKey)&&!event.altKey&&event.key.toLowerCase()==='k'){
      event.preventDefault();if(event.repeat)return;if(this.paletteOpen)this.closeFinder();else this.openFinder('shortcut');
    }
  };
  private openMore(){this.attention?.summary.explore('more');this.toolbarSeen=this.visibleToolbarActions();this.moreOpen=true;this.dockTouched=true;this.client.position.recentActions=[...this.client.position.recentActions,'ui:more'].slice(-12);this.changed();void this.updateComplete.then(()=>this.querySelector<HTMLElement>('.action-dock en-button')?.focus());}
  private visibleToolbarActions(){return [...this.querySelectorAll<HTMLElement>('.action-dock [data-action-id]')].map(e=>e.dataset.actionId!).filter(id=>this.candidates().some(a=>a.id===id));}
  private paletteOptions(){return paletteActions(this.paletteQuery,this.candidates(),this.paletteOrder).filter(a=>this.desktop.matches||a.id!=='ui:developer');}
  private openFinder(entry:PaletteFeedback['entry']='direct'){
    if(!this.paletteOpen)this.attention?.summary.explore('palette');
    const visible=this.visibleToolbarActions();
    this.paletteFeedback={entry,surface:this.mode?'workflow':this.moreOpen?'more':'toolbar',toolbar:this.moreOpen?this.toolbarSeen:visible,more:this.moreOpen?visible:[]};
    this.paletteOrder={rankedIds:[...this.suggestions,...this.rankedActions].map(a=>a.id),passedOverIds:[...this.paletteFeedback.toolbar,...this.paletteFeedback.more]};
    this.paletteTouched=false;
    this.paletteOpen=true;this.paletteQuery='';this.paletteChoice='';this.paletteIndex=0;this.paletteBusy=false;++this.paletteTicket;this.finderInferred=false;this.finderMessage='';
    this.dockTouched=true;this.client.position.recentActions=[...this.client.position.recentActions,'ui:palette'].slice(-12);this.changed();
    void this.updateComplete.then(()=>this.querySelector<HTMLInputElement>('.palette-query')?.focus());
    void this.refreshPalette();
  }
  private async refreshPalette(bypass=false){
    if(this.loading||this.startupFailed||!this.client.session?.policy.accepted)return;
    const snapshot=JSON.stringify(this.client.position),head=this.client.head,scope=this.interactionScope(),diagnosticScope=this.diagnosticScope(),ticket=this.paletteTicket;
    this.paletteRefreshing=true;if(this.developer)this.developerReceived=undefined;this.changed();
    const started=performance.now();
    try{
      const result=await this.requestDecision(this.decisionBody({palette:this.paletteFeedback}),bypass,1800);
      const stale=ticket!==this.paletteTicket||!this.paletteOpen||this.paletteTouched||scope!==this.interactionScope()||snapshot!==JSON.stringify(this.client.position)||head!==this.client.head||result.head!==head||this.disposed;
      const applied=!stale&&result.policy===POLICY_VERSION&&result.source==='jev'&&!!result.paletteActions?.length;
      this.recordDecision(result,stale?'Ignored: palette changed':applied?'Palette order applied':'Kept local palette order',diagnosticScope,started);
      if(applied)this.paletteOrder={rankedIds:result.paletteActions!.map(a=>a.id),passedOverIds:[]};
    }catch(error){
      if(ticket===this.paletteTicket)this.recordDecision({source:'fallback',reason:error instanceof ApiError?`HTTP ${error.status}`:'Palette refresh exceeded budget or was unavailable',head,policy:POLICY_VERSION},'Kept local palette order',diagnosticScope,started);
    }finally{if(ticket===this.paletteTicket){this.paletteRefreshing=false;this.changed();}}
  }
  private closeFinder(){this.paletteRefreshing=false;this.paletteOpen=false;this.paletteBusy=false;++this.paletteTicket;if(this.routeMode==='actions'){this.routeMode=this.mode;this.writeRoute(true);}this.changed();}
  private async findAction(){
    const query=this.paletteQuery.trim(),candidates=this.candidates();if(!query||this.paletteBusy||!this.client.session?.policy.accepted)return;
    const explicit=explicitAction(query,candidates);this.finderInferred=true;this.finderMessage='';
    if(explicit){this.paletteChoice=explicit;this.changed();return;}
    const snapshot=JSON.stringify(this.client.position),head=this.client.head,scope=this.interactionScope(),diagnosticScope=this.diagnosticScope(),ticket=++this.paletteTicket;
    this.paletteRefreshing=false;this.paletteBusy=true;if(this.developer)this.developerReceived=undefined;this.changed();
    const started=performance.now();
    try{const result=await this.requestDecision(this.decisionBody({view:'find-action',intent:query,palette:this.paletteFeedback}));
      const stale=result.policy!==POLICY_VERSION||result.head!==head||ticket!==this.paletteTicket||!this.paletteOpen||query!==this.paletteQuery.trim()||scope!==this.interactionScope()||snapshot!==JSON.stringify(this.client.position)||head!==this.client.head||this.disposed;
      this.recordDecision(result,stale?'Ignored: palette changed':'Palette suggestion',diagnosticScope,started);if(stale)return;
      this.paletteChoice=candidates.some(a=>a.id===result.resolvedAction)?result.resolvedAction!:'';this.finderMessage=this.paletteChoice?'':'Choose an action.';
    }catch(error){if(ticket===this.paletteTicket){this.finderMessage='Choose an action.';this.recordDecision({source:'fallback',reason:error instanceof ApiError?`HTTP ${error.status}`:'Network unavailable',head,policy:POLICY_VERSION},'Palette lookup failed',diagnosticScope,started);}}finally{if(ticket===this.paletteTicket){this.paletteBusy=false;this.changed();}}
  }
  private openFoundAction(id=this.paletteChoice,inferred=this.finderInferred){
    if(!id)return;
    if(this.loading||this.startupFailed||!this.client.session?.policy.accepted){this.finderMessage='Open your workspace first.';this.changed();return;}
    if(this.preventsRouteChange()){this.finderMessage='Finish or close the current step first.';this.changed();return;}
    this.closeFinder();this.suggestionTargets={};this.useInTarget='';
    if(id==='ui:workspaces'){this.begin('workspaces');return;}
    if(id==='ui:refresh'){void this.run(async()=>{await this.client.load({hydrateContent:false});this.readRoute();this.closeMode();});return;}
    const entry=inferred?finderEntry(id):id;
    if(entry==='view-result'){this.navigate('artifact',{outputId:this.client.position.outputId});return;}
    if(entry==='context'&&id!=='context'){this.navigate('document',{blockId:this.client.position.blockId});return;}
    this.choose(entry);
  }
  private paletteKeys=(event:KeyboardEvent)=>{
    this.paletteTouched=true;
    if(event.isComposing||event.keyCode===229){event.stopPropagation();return;}
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();this.closeFinder();return;}
    const options=this.paletteOptions();
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)&&options.length){event.preventDefault();this.paletteIndex=event.key==='Home'?0:event.key==='End'?options.length-1:(this.paletteIndex+(event.key==='ArrowDown'?1:-1)+options.length)%options.length;this.changed();void this.updateComplete.then(()=>this.querySelector('#palette-option-'+this.paletteIndex)?.scrollIntoView({block:'nearest'}));}
    if(event.key==='Enter'){event.preventDefault();if(options[this.paletteIndex])this.openFoundAction(options[this.paletteIndex].id,false);else void this.findAction();}
  };
  private renderPalette(){
    const options=this.paletteOptions();
    const chosen=this.candidates().find(a=>a.id===this.paletteChoice);
    return html`<en-dialog class="command-palette" label="Command palette" .open=${this.paletteOpen} closedby="any" @en-change=${(e:CustomEvent)=>{if(e.target===e.currentTarget&&e.detail.proposed===false)this.closeFinder();}}>
      <input class="palette-query" autofocus type="text" autocomplete="off" spellcheck="false" role="combobox" aria-label="Find an action" aria-autocomplete="list" aria-expanded="true" aria-controls="palette-options" aria-activedescendant=${options[this.paletteIndex]?'palette-option-'+this.paletteIndex:nothing} placeholder="Search actions or describe a next step…" .value=${live(this.paletteQuery)} @keydown=${this.paletteKeys} @input=${(e:Event)=>{this.paletteTouched=true;this.paletteRefreshing=false;this.paletteQuery=(e.target as HTMLInputElement).value;this.paletteIndex=0;this.paletteChoice='';this.finderMessage='';this.paletteBusy=false;++this.paletteTicket;this.changed();}} />
      ${this.finderMessage?html`<p role="status">${this.finderMessage}</p>`:nothing}
      ${chosen?html`<button class="palette-result" @click=${()=>this.openFoundAction()}>Open ${chosen.label}</button>`:nothing}
      <div id="palette-options" role="listbox" aria-label="Actions" class="palette-options" @pointermove=${()=>{this.paletteTouched=true;}} @pointerdown=${()=>{this.paletteTouched=true;}}>${options.map((a,i)=>html`<button id=${'palette-option-'+i} data-action-id=${a.id} class="palette-result" role="option" aria-selected=${i===this.paletteIndex} tabindex="-1" @click=${()=>this.openFoundAction(a.id,false)}>${a.label}</button>`)}</div>
      ${this.paletteQuery.trim()?html`<button class="palette-find" ?disabled=${this.paletteBusy} @click=${()=>void this.findAction()}>${this.paletteBusy?'Finding…':'Find a step with Jev'}</button>`:nothing}
      <span slot="footer" class="palette-hint">↑ ↓ Select · Enter Open · Esc Close</span>
    </en-dialog>`;
  }
  private button(label: string, action: () => void, primary = false, disabled = false, actionId='', variant:Emphasis['variant']=primary?'primary':'ghost') { const helpId="still-help-"+(actionId||label.toLowerCase().replaceAll(" ","-"));return html`<en-button id=${helpId} data-action-id=${actionId} size="medium" variant=${variant} .disabled=${this.busy || this.composing || disabled} @click=${action}>${label}</en-button>${this.help(helpId,label)}`; }
  private field(label: string, value: string, change: (v: string) => void, rows = 3, placeholder = '') { if(rows===1)return html`<en-text-field label=${label} .value=${live(value)} placeholder=${placeholder} .disabled=${this.busy || this.client.hasUnconfirmedWrite || !!this.generation?.attempted} @en-input=${(e: CustomEvent<{value:string;isComposing:boolean}>)=>{change(e.detail.value);this.composing=e.detail.isComposing;if(!this.composing)this.changed();}}></en-text-field>`; return html`<en-textarea label=${label} .value=${live(value)} rows=${rows} placeholder=${placeholder} .disabled=${this.busy || this.client.hasUnconfirmedWrite || !!this.generation?.attempted} @en-input=${(e: CustomEvent<{ value: string; isComposing: boolean }>) => { change(e.detail.value); this.composing = e.detail.isComposing; if (!this.composing) this.changed(); }}></en-textarea>`; }
  private closeMode() { if (this.mode === 'generate') this.client.position.intent = ''; this.resetStep();this.error='';this.writeRoute();this.decide();this.focusContent(); }
  private begin(mode: string, updateURL=true) {
    if(mode==='actions'){this.routeMode='actions';this.openFinder();if(updateURL)this.writeRoute();return;}
    this.moreOpen=false;
    this.developerPending=false;
    this.pendingBlock = null; this.mode = mode;this.routeMode=mode; ++this.decisionTicket; clearTimeout(this.decisionTimer); this.error = ''; this.choice = ''; this.titleDraft = ''; this.bodyDraft = ''; this.kindDraft = 'direction';
    if (mode === 'edit-block') { const block = this.client.projection.blocks.find(b => b.id === this.client.position.blockId); this.bodyDraft = text(block?.properties.text); this.titleDraft = block?.handle ?? ''; this.kindDraft = block?.type ?? 'message'; this.editBase = { text: text(block?.properties.text) };  }
    if (mode === 'rename') { this.titleDraft = this.client.projection.documentTitle; this.editBase = { title: this.titleDraft }; }
    if (mode === 'intent') this.bodyDraft = this.client.position.intent;
    if (mode === 'surprise') { this.mode = 'add-context'; this.titleDraft = 'Another possibility'; this.kindDraft = 'style'; this.bodyDraft = ''; }
    if (mode === 'clarify') { this.mode = 'add-context'; this.titleDraft = 'The heart of it'; this.kindDraft = 'direction'; }
    if (mode === 'edit-artifact') { const a = this.client.projection.artifacts.find(x => x.id === this.client.position.outputId); const content = parseDocumentArtifactContent(a?.contentRef ? this.client.content[a.contentRef] : undefined); this.editBase = { revision: a ? documentArtifactRevision(this.client.events, a.id) : 0, ...(a && ['slides','storyboard'].includes(a.kind) ? {item:this.itemIndex} : {}) }; this.bodyDraft = this.editBase.item !== undefined ? (content?.items[this.itemIndex]?.body ?? a?.items[this.itemIndex]?.body ?? '') : content?.content_markdown ?? a?.items.map(i => `## ${i.title}\n\n${i.body}`).join('\n\n') ?? ''; }
    this.draftBaseline=this.draftSignature();if(updateURL)this.writeRoute();this.changed(); this.focusContent();
  }
  private choose(id: string) {
    if (this.busy || this.composing) return;
    if(!id.startsWith('ui:')&&!this.candidates().some(a=>a.id===id)){this.error='Action changed. Choose another step.';this.dockTouched=false;this.decide();return;}
    if(id==='use-in')this.useInTarget=this.suggestionTargets[id]??'';
    if(id==='ui:developer'){this.closeMode();this.setDeveloper(true);return;}
    this.client.position.recentActions = [...this.client.position.recentActions, id].slice(-12);
    if (id === 'projects') return this.navigate('projects', { projectId: '', documentId: '' });
    if (id === 'documents') return this.navigate('documents', { documentId: '' });
    if (id === 'context') return this.navigate('document');
    if (id === 'results') return this.navigate('results');
    if (id === 'replace-part') return this.begin('edit-block');
    if (id === 'export') { void this.run(() => this.exportWork()); return; }
    if (['lock', 'unlock', 'toggle-context'].includes(id)) {
      void this.run(async () => { const b = this.client.projection.blocks.find(x => x.id === this.client.position.blockId); if (!b) return; await this.client.append([{ type: id === 'toggle-context' ? 'BlockWeightSet' : id === 'lock' ? 'BlockLocked' : 'BlockUnlocked', payload: { block_id: b.id, ...(id === 'toggle-context' ? { weight: Number(b.properties.weight ?? 1) > 0 ? 0 : .8, previous_weight: b.properties.weight ?? 1 } : {}) } }]); this.notice = 'Updated.';this.closeMode(); }); return;
    }
    if (id === 'create' || FORMATS[id]) {
      this.generation = null; this.generationGate = null; this.formatSuggestions = []; this.formatTouched = false;
      try {
        const format = this.client.pendingGeneration?.format ?? (id === 'create' ? '' : id);
        if (format && (id==='create'||this.client.pendingGeneration)) this.generation = this.client.prepareGeneration(format);
      } catch (error) { this.error = error instanceof Error ? error.message : 'Format unavailable.'; this.changed(); return; }
      if(id!=='create'&&!this.client.pendingGeneration){this.generation=null;this.begin('generate');void this.startGeneration(id);return;}
      this.begin('generate'); if (!this.generation) this.suggestFormats(); return;
    }
    this.begin(id);
  }
  private selectMenuFormat = (event: CustomEvent<{action:string}>) => {
    const menu = event.currentTarget as HTMLElement & {open:boolean; updateComplete:Promise<unknown>};
    const item = event.composedPath()[0] as HTMLElement;
    if (event.defaultPrevented || item.localName !== 'en-menu-item' || item.parentElement !== menu) return;
    const format = event.detail.action;
    queueMicrotask(async () => {
      if (event.defaultPrevented) return;
      await menu.updateComplete;
      if (!menu.open && menu.isConnected && this.mode === 'generate' && !this.generation) void this.startGeneration(format);
    });
  };
  private async startGeneration(format:string) {
    if(this.busy||this.composing||this.directGeneration||this.generation?.attempted)return;
    this.directGeneration=true;this.formatTouched=true;
    try {
      await this.run(async()=>{
        this.generation=this.client.prepareGeneration(format);
        this.generationGate=null;this.draftBaseline=this.draftSignature();
        await this.generate();
      });
    } finally {this.directGeneration=false;this.changed();}
  }
  private chooseFormat(format: string) {
    if (this.busy || this.composing || this.generation?.attempted) return;
    const enteringReview = !this.generation && !!format;
    try { this.generation = format ? this.client.prepareGeneration(format, this.generation ?? undefined) : null; this.generationGate = null; this.error = ''; }
    catch (error) { this.error = error instanceof Error ? error.message : 'Format unavailable.'; }
    this.changed();
    this.writeRoute();this.draftBaseline=this.draftSignature();
    if (enteringReview && this.generation) void this.updateComplete.then(()=>this.querySelector<HTMLElement>('.format-options en-select')?.focus());
  }
  private async save() {
    const c = this.client, p = c.projection;
    if (this.mode === 'new-project' || this.mode === 'new-document') {
      if (!this.titleDraft.trim()) throw new Error('Enter a name.');
      const ids = this.mode === 'new-project' ? await c.createProject(this.titleDraft.trim(), this.bodyDraft.trim()) : await c.createDocument(this.titleDraft.trim(), this.bodyDraft.trim());
      this.navigate('document', ids);
    } else if (this.mode === 'add-context') {
      if (!this.bodyDraft.trim()) throw new Error('Add an idea.');
      if (!c.hasUnconfirmedWrite || !this.pendingBlock) { const event = c.blockEvent(this.bodyDraft, this.titleDraft.trim() || 'A thought', this.kindDraft); if(this.pendingBlock) Object.assign(event.payload,{block_id:this.pendingBlock.payload.block_id,position:this.pendingBlock.payload.position}); this.pendingBlock = event; }
      await c.append([this.pendingBlock]); this.closeMode();
    } else if (this.mode === 'edit-block') {
      const b = p.blocks.find(x => x.id === c.position.blockId); if (!b || b.locked) throw new Error('Idea is not editable.');
      await c.append([{ type: 'BlockPropertyEdited', payload: { block_id: b.id, property_path: 'text', old_value: this.editBase.text ?? '', new_value: this.bodyDraft } }]); this.closeMode();
    } else if (this.mode === 'rename') {
      if (!this.titleDraft.trim()) throw new Error('Enter a name.');
      await c.append([{ type: 'DocumentRenamed', payload: { document_id: p.documentId, old_title: this.editBase.title ?? p.documentTitle, new_title: this.titleDraft.trim() } }]); this.closeMode();
    } else if (this.mode === 'intent') { c.position.intent = this.bodyDraft.trim(); this.closeMode(); return; }
    else if (this.mode === 'edit-artifact') { if (this.missingWriting()) throw new Error('Wait for the writing to load.'); await c.editArtifact(c.position.outputId, this.editBase.item !== undefined ? (parseDocumentArtifactContent(c.content[p.artifacts.find(a => a.id === c.position.outputId)?.contentRef ?? ''])?.content_markdown ?? '') : this.bodyDraft, this.editBase.revision ?? 0, this.editBase.item !== undefined ? [{index:this.editBase.item,body:this.bodyDraft}] : undefined); this.closeMode(); }
    else if (this.mode === 'reuse') { const b = p.libraryBlocks.find(x => x.id === this.choice); if (!b) throw new Error('Choose a context block.'); const event = c.blockEvent(text(b.properties.text), b.handle, b.type); event.payload.properties = { ...b.properties, source_block_id: b.id, weight: .8 }; if (!c.hasUnconfirmedWrite || !this.pendingBlock) { if(this.pendingBlock) Object.assign(event.payload,{block_id:this.pendingBlock.payload.block_id,position:this.pendingBlock.payload.position}); this.pendingBlock=event; } await c.append([this.pendingBlock]); this.closeMode(); }
    this.notice = 'Saved.'; this.changed(); this.decide();
  }
  private async generate() {
    const draft = this.generation; if (!draft) return;
    if(draft.recoveryClosed){this.generation=this.client.reviewNewGeneration(draft);this.generationGate=null;this.notice='Review this new request before generating.';this.changed();return;}
    if (!draft.attempted && draft.format === 'scene' && !draft.scenePreview) { const quote = await this.client.previewScene(draft); if (quote) draft.scenePreview = quote; this.changed(); return; }
    if (this.generationGate && !this.generationGate.key) return;
    if (this.generationGate?.key) { draft.acknowledgements = { ...draft.acknowledgements, [this.generationGate.key]: true }; this.generationGate = null; }
    try { const job=await this.client.generate(draft); this.navigate('generation',{outputId:job.jobId}); }
    catch (error) {
      const review = error instanceof ApiError ? generationReview(error.status, error.body) : null;
      if (review) {
        this.generationGate = review; ++this.reviewVersion;
        this.changed();
        await this.updateComplete;
        this.querySelector<HTMLElement>('.generation-notifications')?.focus();
        return;
      }
      throw error;
    }
  }
  private async exportWork() {
    const check = await this.client.verifyScope();
    const p = this.client.projection, id = this.client.position.outputId, artifact = p.artifacts.find(a => a.id === id), output = p.outputs.find(o => o.id === id);
    if (artifact?.contentRef) {
      await this.client.ensureContent(artifact.contentRef); check();
      if (id !== this.client.position.outputId) throw new Error('Result changed. Reopen before downloading.');
    }
    const model = artifact?.kind === 'model3d' ? model3dArtifactMediaFile(artifact) : null;
    const url = safeMedia(model?.url ?? artifact?.mediaUrl ?? output?.mediaUrl);
    const retained = artifact ? this.client.content[artifact.contentRef ?? ''] : '';
    const revision = artifact ? documentArtifactRevision(this.client.events, artifact.id) : 0;
    if (artifact && this.client.session?.projectContext && !retained) throw new Error('Retained content and approval are required to download.');
    const digest = retained ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(retained))), b => b.toString(16).padStart(2, '0')).join('') : '';
    check();
    await this.client.append([{ type: artifact ? 'DocumentArtifactExported' : 'ObjectExported', payload: artifact ? { artifact_id: id, artifact_kind: artifact.kind, document_id: artifact.documentId, format: model?.mimeType ?? artifact.mediaType ?? 'markdown', artifact_revision: revision, ...(digest ? {content_sha256:digest} : {}) } : { object_id: id, document_id: output?.documentId, format: output?.mediaType ?? 'image/png' } }]);
    check();
    if (id !== this.client.position.outputId || artifact && (revision !== documentArtifactRevision(this.client.events, id) || retained !== this.client.content[artifact.contentRef ?? ''])) throw new Error('Result changed. Reopen before downloading.');
    let blob: Blob;
    if (url) { const response = await fetch(url); if (!response.ok) throw new Error('File unavailable.'); blob = await response.blob(); }
    else if (artifact) { const content = parseDocumentArtifactContent(artifact.contentRef ? this.client.content[artifact.contentRef] : undefined); blob = new Blob([content?.content_markdown || artifact.items.map(i => `${i.title}\n\n${i.body}`).join('\n\n')], { type: 'text/markdown' }); }
    else throw new Error('Select a result to download.');
    await this.client.verifyScope(); check();
    const href = URL.createObjectURL(blob), a = document.createElement('a'); a.href = href; a.download = model?.fileName ?? `${artifact?.title ?? output?.title ?? 'creative-work'}.${url ? blob.type.includes('png') ? 'png' : blob.type.includes('video') ? 'mp4' : blob.type.includes('audio') ? 'mp3' : 'jpg' : 'md'}`; a.click(); setTimeout(() => URL.revokeObjectURL(href), 1000);
  }
  private prose(value: string): TemplateResult { return html`${value.split(/\n\s*\n/).map(part => /^#{1,6}\s/.test(part) ? html`<h2>${part.replace(/^#{1,6}\s*/, '')}</h2>` : html`<p>${part}</p>`)}`; }
  private renderArtifact(a: DocumentArtifact) {
    if (this.missingWriting()) return this.renderWritingLoad();
    const content = parseDocumentArtifactContent(a.contentRef ? this.client.content[a.contentRef] : undefined), receipt = a.items[this.itemIndex], item = receipt ? {...receipt,...content?.items[this.itemIndex]} : undefined;
    if (a.kind === 'model3d') { const file = model3dArtifactMediaFile(a); void import('./model-view.ts'); return html`<div data-attention-id=${`result:${a.id}`} class="model-stage"><still-model-view src=${safeMedia(file?.url)}></still-model-view></div><p class="caption">${a.title} · Drag to rotate</p>`; }
    if (a.kind === 'video' || a.kind === 'audio') return html`<div data-attention-id=${`result:${a.id}`} class=${`media-stage ${a.kind}`}>${a.kind === 'video' ? html`<video controls playsinline src=${safeMedia(a.mediaUrl ?? item?.mediaUrl)}></video>` : html`<div class="sound-form" aria-hidden="true">${Array.from({ length: 42 }, (_, i) => html`<i style=${`height:${20 + Math.abs(Math.sin(i * .7) * Math.cos(i * .23)) * 100}px`}></i>`)}</div><audio controls src=${safeMedia(a.mediaUrl ?? item?.mediaUrl)}></audio>`}<h1>${a.title}</h1>${a.summary ? html`<p>${a.summary}</p>` : nothing}</div>`;
    if ((a.kind === 'slides' || a.kind === 'storyboard') && item) return html`<article data-attention-id=${`result:${a.id}:item:${this.itemIndex}`} class="slide" style=${`--slide-bg:${/^#[a-f\d]{3,8}$/i.test(a.presentation?.palette.background ?? '') ? a.presentation?.palette.background : '#ede9e1'}`}><span class="eyebrow">${String(this.itemIndex + 1).padStart(2, '0')} / ${String(a.items.length).padStart(2, '0')}</span>${safeMedia(item.mediaUrl) ? html`<img src=${safeMedia(item.mediaUrl)} alt=${item.title} />` : nothing}<div><h1>${item.title}</h1><div class="prose">${this.prose(item.body)}</div></div></article>`;
    return html`<article data-attention-id=${`result:${a.id}`} class="writing"><span class="eyebrow">${FORMATS[a.kind] ?? 'Creative work'}</span><h1>${a.title}</h1><div class="prose">${this.prose(content?.content_markdown || a.items.map(x => `${x.title}\n\n${x.body}`).join('\n\n') || a.summary || 'Writing unavailable.')}</div></article>`;
  }
  private renderGeneration() {
    const c=this.client,p=c.projection,job=c.jobs.find(j=>j.jobId===c.position.outputId&&j.documentId===p.documentId);
    if(!job||!generationFormat(job))return html`<section class="quiet-state"><h1>${c.jobsError?'Couldn’t load generation':c.jobsLoaded?'Generation unavailable':'Loading generation…'}</h1>${c.jobsError?this.button('Try again',()=>void this.run(()=>c.pollJobs())):nothing}</section>`;
    const active=generationActive(job),kind=generationFormat(job),preview=generationPreview(job,p,c.events);
    return html`<section class="generation-stage"><span class="eyebrow">${FORMATS[kind]??kind}</span><h1>${preview.title}</h1>${preview.width&&preview.height?html`<p class="caption">${preview.width} × ${preview.height}</p>`:nothing}<p role="status">${active?(job.progressMessage||generationStatus(job)):job.status==='completed'?'The result is being loaded.':job.errorDetail?.message||job.error||generationStatus(job)}</p>${active?html`<div class=${`generation-placeholder ${kind} ${preview.width?'known-size':''}`} style=${preview.width&&preview.height?`--generation-ratio:${preview.width/preview.height}`:nothing} aria-label="Generation in progress"><en-skeleton shape="rectangle"></en-skeleton></div>`:nothing}${!active?this.button('Check again',()=>void this.run(async()=>{await c.pollJobs();await c.refresh();})):nothing}</section>`;
  }
  private renderCanvas() {
    const c = this.client, p = c.projection, pos = c.position;
    if (this.loading) return html`<section class="quiet-state"><div class="still-mark" aria-hidden="true"></div><h1>Loading…</h1></section>`;
    if (this.startupFailed || !c.session) return html`<section class="quiet-state"><h1>Couldn’t load Still</h1>${this.button('Try again', () => void this.run(() => this.loadWorkspace()), true)}</section>`;
    if (!c.session.policy.accepted) return html`<section class="form-page"><h1>Before you begin</h1><p>Your context is processed by generation providers and TypeSafe. Forma’s access and retention rules apply.</p><en-checkbox class="check" label="I have permission to use this content." .checked=${this.ownership} @en-change=${(e: CustomEvent<{proposed:boolean}>) => { this.ownership = e.detail.proposed; this.changed(); }}></en-checkbox><en-checkbox class="check" label="I consent to private provider processing." .checked=${this.providerConsent} @en-change=${(e: CustomEvent<{proposed:boolean}>) => { this.providerConsent = e.detail.proposed; this.changed(); }}></en-checkbox>${this.button('Continue', () => void this.run(async () => { await c.acceptTerms(); this.readRoute(); this.decide(); }), true, !this.ownership || !this.providerConsent)}</section>`;
    const routeProblem=this.currentRouteProblem(p);
    if (routeProblem) return html`<section class="quiet-state"><h1>${routeProblem}</h1>${this.button('Projects',()=>this.navigate('projects',{projectId:'',documentId:''}))}</section>`;
    if (this.mode) return this.renderMode();
    if (pos.view === 'projects' || pos.view === 'documents') {
      const projects = pos.view === 'projects', items = projects ? p.projects.map(x => ({ id: x.id, title: x.name, detail: `${x.documentCount} ${x.documentCount === 1 ? 'document' : 'documents'}` })) : p.documents.filter(d => !d.removed).map(d => ({ id: d.id, title: d.title, detail: '' }));
      return html`<section class="library-page">${projects ? nothing : html`<span class="eyebrow">${p.projectName}</span>`}<h1>${projects ? 'Projects' : 'Documents'}</h1><div class="work-list">${items.slice(this.page * 3, this.page * 3 + 3).map((x, i) => html`<a data-attention-id=${`${projects?'project':'document'}:${x.id}`} class="work-row" href=${projects?this.viewURL('documents',{projectId:x.id,documentId:''}):this.viewURL('document',{documentId:x.id})} @click=${(e:MouseEvent)=>projects?this.follow(e,'documents',{projectId:x.id,documentId:''}):this.follow(e,'document',{documentId:x.id})}><span class="work-number">${String(this.page * 3 + i + 1).padStart(2, '0')}</span><span><strong>${x.title}</strong>${x.detail ? html`<small>${x.detail}</small>` : nothing}</span><span class="row-arrow" aria-hidden="true">↗</span></a>`)}</div>${!items.length ? html`<p class="empty-copy">${projects ? 'No projects yet.' : 'No documents yet.'}</p>` : nothing}</section>`;
    }
    if (pos.view === 'results') {
      const results = stillResults(p,c.jobs,c.events);
      return html`<section class="results-page"><span class="eyebrow">${p.documentTitle}</span><h1>Results</h1><div class="result-grid">${results.slice(this.page * 3, this.page * 3 + 3).map(r => html`<a data-attention-id=${`result:${r.id}`} class="result" href=${this.viewURL(r.view,{outputId:r.id})} @click=${(e:MouseEvent)=>this.follow(e,r.view,{outputId:r.id})}>${r.job?html`<div class="pending-thumbnail">${generationActive(r.job)?html`<en-skeleton shape="rectangle"></en-skeleton>`:nothing}<span>${FORMATS[r.kind]??r.kind}</span></div>`:safeMedia(r.url) ? html`<img src=${safeMedia(r.url)} alt=${r.title} />` : html`<div class="result-word">${FORMATS[r.kind]}</div>`}<span>${r.title}${r.job?html`<small>${generationStatus(r.job)}</small>`:nothing}</span></a>`)}</div>${!results.length ? html`<p>${c.jobsError?'Couldn’t load generations.':c.jobsLoaded?'No results yet.':'Loading generations…'}</p>`:nothing}${c.jobsError?this.button('Try again',()=>void this.run(()=>c.pollJobs())):nothing}</section>`;
    }
    if(pos.view==='generation')return this.renderGeneration();
    if (pos.view === 'artifact') {
      const a = p.artifacts.find(x => x.id === pos.outputId), o = p.outputs.find(x => x.id === pos.outputId);
      return a ? this.renderArtifact(a) : o ? html`<figure data-attention-id=${`result:${pos.outputId}`} class="image-stage"><img src=${safeMedia(o.mediaUrl)} alt=${o.title ?? p.documentTitle} /><figcaption>${o.title ?? p.documentTitle}</figcaption></figure>` : html`<section class="quiet-state"><h1>Result unavailable</h1></section>`;
    }
    return html`<article class="document-page"><span class="eyebrow">${p.projectName}</span><h1>${p.documentTitle}</h1><div class="context-blocks">${p.blocks.filter(b => !b.removed).map((b, i) => html`<a data-attention-id=${`block:${b.id}`} aria-current=${pos.blockId===b.id?'true':nothing} href=${this.viewURL('document',{blockId:pos.blockId===b.id?'':b.id})} class=${`context-block ${pos.blockId === b.id ? 'selected' : ''} ${Number(b.properties.weight ?? 1) <= 0 ? 'inactive' : ''}`} @click=${(e:MouseEvent)=>this.follow(e,'document',{blockId:pos.blockId===b.id?'':b.id})}><span class="block-index">${String(i + 1).padStart(2, '0')}</span><div><span class="block-label">${text(b.properties.label) || b.handle || b.type}${p.blockRelations.filter(r=>!r.removed&&r.toBlockId===b.id&&isContextCompositionRelation(r.kind)).map(r=>` · part of ${p.blocks.find(parent=>parent.id===r.fromBlockId)?.handle??'a group'}`).join('')}${b.locked ? ' · locked' : ''}${Number(b.properties.weight ?? 1) <= 0 ? ' · excluded' : ''}</span>${safeMedia(text(b.properties.media_url)) && b.type === 'reference' ? html`<img class="context-reference" src=${safeMedia(text(b.properties.media_url))} alt=${b.handle}/>` : nothing}<p>${text(b.properties.text) || text(b.properties.description) || 'Empty idea'}</p></div></a>`)}</div>${!p.blocks.filter(b => !b.removed).length ? html`<div class="blank-page"><span class="pencil-line" aria-hidden="true"></span><p>Add an idea.</p></div>` : nothing}</article>`;
  }
  private renderMode() {
    const mode = this.mode, p = this.client.projection;
    if (mode==='edit-artifact' && this.missingWriting()) return this.renderWritingLoad();
    if(mode==='use-in')return keyed(`${this.interactionScope()}/${this.client.position.blockId}/use-in`,html`<still-use-in-flow .client=${this.client} .suggestedTarget=${this.useInTarget} @context-back=${()=>this.closeMode()} @use-in-done=${(e:CustomEvent<{projectId:string;documentId:string;blockId:string}>)=>{this.navigate('document',{projectId:e.detail.projectId,documentId:e.detail.documentId,blockId:e.detail.blockId});this.notice='Saved.';}}></still-use-in-flow>`);
    if (['split-context','research-context','find-references','compose'].includes(mode)) return keyed(`${this.client.scopeKey}/${p.projectId}/${p.documentId}/${this.client.position.blockId}/${mode}`,html`<still-context-flow .client=${this.client} .action=${mode} @context-back=${()=>this.closeMode()} @context-done=${()=>{this.notice='Saved.';this.closeMode();}}></still-context-flow>`);
    if (mode === 'generate') {
      const g = this.directGeneration?null:this.generation;
      const source = g?.sourceSnapshot ?? documentSnapshot(p, p.documentId);
      const issues = this.generationGate?.issues ?? [];
      const visibleFacts = source.facts.filter(b => b.active || issues.some(i => issueAffectsBlock(i, b)));
      const formats = this.candidates().filter(a => !!FORMATS[a.id]);
      return html`<section class="form-page generation-page">
        <span class="eyebrow">${p.projectName}</span><h1>${p.documentTitle}</h1>
        <div class="generation-context">${visibleFacts.map(b => { const warnings = issues.filter(i => issueAffectsBlock(i, b)); return html`<section id=${'generation-context-'+b.block_id} class=${warnings.length ? 'generation-fact needs-review' : 'generation-fact'} tabindex="-1">
          <p><span>${text(b.properties.label) || b.handle || b.type}${b.locked ? ' · locked' : ''}</span>${safeMedia(text(b.properties.media_url)) && b.type === 'reference' ? html`<img class="context-reference" src=${safeMedia(text(b.properties.media_url))} alt=${b.handle}/>` : nothing}${text(b.properties.text) || text(b.properties.description)}</p>
          ${warnings.map(i => html`<div class="context-review-reason"><strong>${i.label}</strong> · ${i.summary}</div>`)}
          ${warnings.length ? html`<a class="review-context-link" href=${this.viewURL('document',{blockId:b.block_id})} @click=${(e:MouseEvent)=>this.follow(e,'document',{blockId:b.block_id})}>Open idea</a>` : nothing}
        </section>`; })}</div>
        <div class="format-options" @pointerdown=${()=>{this.formatTouched=true;}} @focusin=${()=>{this.formatTouched=true;}}>
        ${!g ? nothing : html`<en-select class="select-label" label="Output" .value=${live(g.format)} ?disabled=${this.busy || this.composing || !!g.attempted} @en-change=${(e: CustomEvent<{proposed:string;value:string}>) => this.chooseFormat(e.detail.proposed)}>
          <en-select-option value="">Choose a format</en-select-option>${formats.map(a => html`<en-select-option value=${a.id}>${FORMATS[a.id]}</en-select-option>`)}${!formats.some(a => a.id === g.format) ? html`<en-select-option value=${g.format}>${FORMATS[g.format]}</en-select-option>` : nothing}
        </en-select>`}
        </div>
        ${g?.format === 'model3d' ? this.field('Prompt · 1,024 characters max', g.prompt, v => { g.prompt = v; }, 6) : nothing}
        ${g && ['slides', 'storyboard'].includes(g.format) ? html`<en-select class="select-label" label="Length" .value=${String(g.itemCount)} ?disabled=${this.busy || !!g.attempted} @en-change=${(e: CustomEvent<{proposed:string;value:string}>) => { g.itemCount = Number(e.detail.proposed); this.changed(); }}>${[3, 4, 6, 8, 10].map(n => html`<en-select-option value=${n}>${n} ${g.format === 'slides' ? 'slides' : 'frames'}</en-select-option>`)}</en-select>` : nothing}
        ${g && !['model3d', 'image'].includes(g.format) ? this.field('Tone', g.tone, v => { g.tone = v; g.scenePreview = undefined; }, 1, 'Optional') : nothing}
        ${g?.adaptation?.omittedBlockIds.length ? html`<p class="cost-note">${g.adaptation.omittedBlockIds.length} blocks omitted to fit. Review the prompt.</p>` : nothing}
        ${g?.adaptation?.issues.map(i => html`<p class="gate-notice">${i.message}</p>`)}
        ${g?.previousUnconfirmed ? html`<p class="gate-notice">Original status unknown. Starting another may duplicate it.</p>` : nothing}
        ${g ? html`<p class="cost-note">${g.recoveryClosed ? 'Original status unknown. Starting another may duplicate it.' : g.attempted ? `Checking an earlier ${FORMATS[g.format].toLowerCase()} request.` : g.format === 'model3d' ? `Estimated cost: $${(estimateModel3dCostMicrousd() / 1e6).toFixed(2)} · GLB · text to 3D` : g.scenePreview ? `Maximum cost: $${(g.scenePreview.maximumMicrousd / 1e6).toFixed(2)} · ${g.scenePreview.model}` : g.format === 'scene' ? 'Cost approval required.' : 'Forma provider and spending limits apply.'}</p>` : nothing}

      </section>`;
    }
    if (mode === 'workspaces') return html`<section class="form-page"><h1>Workspaces</h1><en-select class="select-label" label="Workspace" .value=${this.choice} @en-change=${(e: CustomEvent<{proposed:string;value:string}>) => { this.choice = e.detail.proposed; this.changed(); }}><en-select-option value="">Personal projects</en-select-option>${this.client.session?.projects?.map(p => html`<en-select-option value=${p.projectAccessId}>${p.projectName} · ${p.role}</en-select-option>`)}</en-select><div class="form-actions">${this.button('Open', () => void this.run(async () => { await this.client.switchWorkspace(this.client.session?.projects?.find(p => p.projectAccessId === this.choice)); this.navigate(this.client.position.view, this.client.position); }), true)}${this.button('Back', () => this.closeMode())}</div></section>`;
    if (mode === 'reuse') return html`<section class="form-page"><h1>Reuse idea</h1><en-select class="select-label" label="Idea" .value=${this.choice} @en-change=${(e: CustomEvent<{proposed:string;value:string}>) => { this.choice = e.detail.proposed; this.changed(); }}><en-select-option value="">Choose an idea</en-select-option>${p.libraryBlocks.filter(b => !b.removed && b.documentId !== p.documentId).map(b => html`<en-select-option value=${b.id}>${b.handle} · ${b.type}</en-select-option>`)}</en-select><p class="context-preview">${text(p.libraryBlocks.find(b => b.id === this.choice)?.properties.text)}</p><div class="form-actions">${this.button('Use idea', () => void this.run(() => this.save()), true, !this.choice)}${this.button('Back', () => this.closeMode())}</div></section>`;
    const titles: Record<string, string> = { 'new-project': 'New project', 'new-document': 'New document', 'add-context': 'Add idea', 'edit-block': 'Edit idea', rename: 'Rename', intent: 'Next step', 'edit-artifact': 'Edit writing' };
    const named = ['new-project', 'new-document', 'add-context', 'rename'].includes(mode);
    return html`<section class="form-page">${p.projectName ? html`<span class="eyebrow">${p.projectName}</span>` : nothing}<h1>${titles[mode] ?? 'New idea'}</h1>${named ? this.field('Name', this.titleDraft, v => { this.titleDraft = v; }, 1) : nothing}${mode === 'add-context' ? html`<en-select class="select-label" label="Type" .value=${this.kindDraft} @en-change=${(e: CustomEvent<{proposed:string;value:string}>) => { this.kindDraft = e.detail.proposed; }}>${blockKinds.map(k => html`<en-select-option value=${k}>${k[0].toUpperCase() + k.slice(1)}</en-select-option>`)}</en-select>` : nothing}${mode !== 'rename' ? this.field(mode === 'intent' ? 'Your direction' : mode === 'edit-artifact' ? 'Writing' : 'Idea', this.bodyDraft, v => { this.bodyDraft = v; }, mode === 'edit-artifact' ? 16 : 6, '') : nothing}<div class="form-actions">${this.button(mode === 'intent' ? 'Suggest actions' : this.client.hasUnconfirmedWrite ? 'Check save' : 'Save', () => void this.run(() => this.save()), true)}${this.button('Back', () => this.closeMode())}</div></section>`;
  }
  private paletteButton(entry:PaletteFeedback['entry']) { return html`<en-button id="still-help-ui:palette" data-action-id="ui:palette" variant="ghost" size="medium" aria-keyshortcuts="Meta+K Control+K" .disabled=${this.busy||this.composing} @click=${()=>this.openFinder(entry)}>Palette<en-badge slot="suffix" variant="neutral">⌘+K</en-badge></en-button>${this.help("still-help-ui:palette","Palette")}`; }
  private compactDock(options:{id:string;label:string;run:()=>void;variant?:Emphasis['variant'];disabled?:boolean}[],menuLabel='Menu') {
    const shown=options.slice(0,this.pageActionLimit-1),rest=options.slice(shown.length);
    return html`<footer class="action-dock" @pointerdown=${()=>{this.dockTouched=true;if(this.mode==='generate')this.formatTouched=true;}} @focusin=${()=>{this.dockTouched=true;if(this.mode==='generate')this.formatTouched=true;}}><en-toolbar label="Your next step" keyboard-navigation="tab">
      ${shown.map(option=>this.button(option.label,option.run,false,!!option.disabled,option.id,option.variant??'secondary'))}
      ${rest.length?html`<en-button id="still-compact-menu" variant="ghost" size="medium" .disabled=${this.busy||this.composing}>${menuLabel}</en-button>`:nothing}
    </en-toolbar>${rest.length?html`<en-menu for="still-compact-menu" label="More actions" @en-action=${(event:CustomEvent<{action:string}>)=>{const option=rest.find(x=>x.id===event.detail.action);if(option&&!option.disabled&&!this.busy&&!this.composing)option.run();}}>
      ${rest.map(option=>html`<en-menu-item action=${option.id} ?disabled=${option.disabled}>${option.label}${option.id==='ui:palette'?html`<en-badge slot="suffix" variant="neutral">⌘+K</en-badge>`:nothing}</en-menu-item>`)}
    </en-menu>`:nothing}</footer>`;
  }
  private renderGenerationDock() {
    const g=this.directGeneration?null:this.generation;
    const formats=this.candidates().filter(a=>!!FORMATS[a.id]);
    const ordered=[...new Set([...this.formatSuggestions,...rankAllFormats(formats)])].filter(id=>formats.some(a=>a.id===id));
    if(this.pageActionLimit<3){
      const emphasis=presentToolbar(ordered.slice(0,3),this.formatEmphasis);
    const choices=g?[{id:'ui:generate',label:g.recoveryClosed?'Review another':g.attempted?'Check generation':g.format==='scene'&&!g.scenePreview?'Check cost':this.generationGate?(this.generationGate.key?'I understand the risks':'Blocked'):'Generate',run:()=>void this.run(()=>this.generate()),variant:'primary' as const,disabled:!!this.generationGate&&!this.generationGate.key}]:ordered.map(id=>({id,label:FORMATS[id],run:()=>{this.formatTouched=true;void this.startGeneration(id);},variant:emphasis[id]?.variant??'secondary' as const}));
      return this.compactDock([...choices,{id:'ui:back',label:'Back',run:()=>this.closeMode(),variant:'ghost'}],g?'Menu':'Other outputs');
    }
    const suggested=ordered.slice(0,Math.min(3,this.pageActionLimit-2));
    const remaining=ordered.filter(id=>!suggested.includes(id));
    return html`<footer class="action-dock" @pointerdown=${()=>{this.formatTouched=true;}} @focusin=${()=>{this.formatTouched=true;}}>
      <en-toolbar label="Your next step" keyboard-navigation="tab">
        ${g?this.button(g.recoveryClosed?'Review another':g.attempted?'Check generation':g.format==='scene'&&!g.scenePreview?'Check cost':this.generationGate?(this.generationGate.key?'I understand the risks':'Blocked'):'Generate',()=>void this.run(()=>this.generate()),true,!!this.generationGate&&!this.generationGate.key):html`
          ${suggested.map(id=>this.suggestedButton({...ACTIONS.find(a=>a.id===id)!,label:FORMATS[id]},true,presentToolbar(suggested,this.formatEmphasis)))}
          ${remaining.length?html`<en-button id="still-format-menu" variant="ghost" size="medium" ?disabled=${this.busy||this.composing}>Other outputs</en-button>${this.help("still-format-menu","Other outputs")}`:nothing}
        `}
        ${this.button('Back',()=>this.closeMode())}
      </en-toolbar>
      ${!g&&remaining.length?html`<en-menu for="still-format-menu" label="Other outputs" @en-action=${this.selectMenuFormat}>${remaining.map(id=>html`<en-menu-item action=${id}>${FORMATS[id]}</en-menu-item>`)}</en-menu>`:nothing}
    </footer>`;
  }
  private renderDock() {
    const c = this.client, p = c.projection, view = c.position.view;
    if (this.loading || this.startupFailed || !c.session?.policy.accepted || this.currentRouteProblem(p)) return nothing;
    if(this.mode==='generate')return this.renderGenerationDock();
    if(this.mode)return nothing;
    if(view==='generation'&&this.pageActionLimit<3)return this.compactDock([{id:'document',label:'Document',run:()=>this.navigate('document')},{id:'results',label:'Results',run:()=>this.navigate('results')},{id:'ui:palette',label:'Palette',run:()=>this.openFinder('shortcut'),variant:'ghost'}]);
    if(view==='generation')return html`<footer class="action-dock"><en-toolbar label="Your next step" keyboard-navigation="tab">${this.button('Document',()=>this.navigate('document'),false,false,'','secondary')}${this.button('Results',()=>this.navigate('results'),false,false,'','secondary')}${this.paletteButton('shortcut')}</en-toolbar></footer>`;
    const limit=this.pageActionLimit,eligible=this.candidates();
    const pool=[...this.suggestions,...(limit>5?this.rankedActions.filter(a=>!this.suggestions.some(s=>s.id===a.id)):[])].filter(a=>eligible.some(e=>e.id===a.id));
    const a=p.artifacts.find(x=>x.id===c.position.outputId);
    const slides=view==='artifact'&&a&&['slides','storyboard'].includes(a.kind)&&a.items.length>1;
    const browsing=['projects','documents','results'].includes(view);
    const count=view==='projects'?p.projects.length:view==='documents'?p.documents.filter(d=>!d.removed).length:stillResults(p,c.jobs,c.events).length;
    const previousPage=browsing&&this.page>0,nextPage=browsing&&(this.page+1)*3<count;
    const pageControls=[
      ...(previousPage?[{id:'ui:previous-page',label:'Previous results',run:()=>this.turnPage(this.page-1)}]:[]),
      ...(nextPage?[{id:'ui:next-page',label:'More results',run:()=>this.turnPage(this.page+1)}]:[]),
    ];
    if(limit<3){
      const choices=pool.filter(a=>!browsing||a.id!==view),emphasis=presentToolbar(choices.map(a=>a.id),this.emphasis,{view});
      return this.compactDock([
        ...choices.map(a=>({id:a.id,label:a.label,run:()=>this.choose(a.id),variant:emphasis[a.id]?.variant})),
        ...(slides?[{id:'ui:previous',label:'Previous',run:()=>this.turnItem(this.itemIndex-1),disabled:this.itemIndex===0},{id:'ui:next',label:'Next',run:()=>this.turnItem(this.itemIndex+1),disabled:this.itemIndex>=a!.items.length-1}]:[]),
        ...pageControls,
        {id:'ui:palette',label:'Palette',run:()=>this.openFinder('more'),variant:'ghost'},
      ]);
    }
    const visible=pool.filter(a=>!browsing||a.id!==view).slice(0,Math.max(0,limit-1-(slides?2:pageControls.length)));
    const visibleIds=visible.map(a=>a.id);
    let actions:TemplateResult[]=[...this.toolbarSuggestions(visible)];
    if(slides)actions.unshift(this.button('Previous',()=>this.turnItem(this.itemIndex-1),false,this.itemIndex===0,'','secondary'),this.button('Next',()=>this.turnItem(this.itemIndex+1),false,this.itemIndex>=a!.items.length-1,'','secondary'));
    actions.push(...pageControls.map(control=>this.button(control.label,control.run,false,false,control.id,'secondary')));
    actions.push(this.button('More',()=>this.openMore(),false,false,'ui:more'));
    if(this.moreOpen)actions=[...this.toolbarSuggestions(nextToolbarActions(this.rankedActions,visibleIds,eligible,limit-2)),this.button('Back',()=>{this.moreOpen=false;this.changed();void this.updateComplete.then(()=>this.querySelector<HTMLElement>('[data-action-id="ui:more"]')?.focus());}),this.paletteButton('more')];
    return html`<footer class="action-dock" @pointerenter=${()=>{this.dockTouched=true;}} @pointerdown=${()=>{this.dockTouched=true;}} @focusin=${()=>{this.dockTouched=true;}}><en-toolbar label="Your next step" keyboard-navigation="tab">${actions}</en-toolbar></footer>`;
  }
  private reviewContext(job?:DocumentJob) {
    const ids=job?.errorDetail?.contributingBlockIds ?? this.generationGate?.issues.flatMap(i=>i.blockIds??[]) ?? [];
    const refs=job?.errorDetail?.contributingReferenceIds ?? this.generationGate?.issues.flatMap(i=>i.referenceIds??[]) ?? [];
    const block=this.client.projection.blocks.find(b=>!b.removed && (ids.includes(b.id) || refs.includes(String(b.properties.reference_id??''))));
    this.navigate('document',{blockId:block?.id??'',outputId:''});
  }
  private notification(key:string,message:string,variant:'info'|'success'|'warning'|'danger',actions:{label:string;run:()=>void}[],dismiss?:()=>void) {
    const identity=`${this.client.scopeKey}:${this.client.position.documentId}:${key}`;
    if(this.dismissedNotifications.has(identity))return nothing;
    return keyed(identity,html`<en-toast .announcement=${message} variant=${variant} priority="polite" duration="0" dismiss-label="Dismiss message" @en-change=${(event:CustomEvent<{proposed:boolean}>)=>{
      if(event.target!==event.currentTarget||event.detail.proposed!==false)return;
      const focused=(event.currentTarget as HTMLElement).matches(':focus-within');
      queueMicrotask(()=>{
        if(event.defaultPrevented)return;
        this.dismissedNotifications.add(identity);
        if(this.dismissedNotifications.size>200)this.dismissedNotifications.delete(this.dismissedNotifications.values().next().value!);
        dismiss?.();this.changed();
        if(focused)void this.updateComplete.then(()=>this.focusContent());
      });
    }}>${message}${actions.map(action=>html`<en-button slot="actions" variant="secondary" size="small" ?disabled=${this.busy||this.composing} @click=${()=>{this.dismissedNotifications.add(identity);action.run();this.changed();}}>${action.label}</en-button>`)}</en-toast>`);
  }
  private renderNotifications(failed?:DocumentJob) {
    const review=this.generationGate, failure=failed?failureNotification(failed):null;
    return html`<en-toast-region class="generation-notifications" placement="block-start-end" label="Notifications" max="2">
      ${this.error?this.notification(`error:${this.errorVersion}`,this.error,'danger',[
        this.generation?.attempted?{label:'Check generation',run:()=>void this.run(()=>this.generate())}:
        this.mode==='generate'?{label:'Review context',run:()=>this.reviewContext()}:
        {label:this.startupFailed?'Reload':'Review step',run:()=>this.startupFailed?void this.run(()=>this.loadWorkspace()):this.focusContent()},
      ],()=>{this.error='';}):nothing}
      ${review?this.notification(`review:${this.reviewVersion}`, [review.message,...review.issues.map(i=>i.summary)].join('. '),canContinueReview(review)?'warning':'danger',[
        {label:'Review context',run:()=>this.reviewContext()},
        ...(canContinueReview(review)?[{label:'I understand the risks',run:()=>void this.run(()=>this.generate())}]:[]),
      ]):nothing}
      ${!this.mode&&failed&&failure?this.notification(`job:${failure.key}`,failure.message,failed.errorDetail?.category==='safety'?'warning':'danger',[
        {label:failure.label,run:()=>{
          if(failure.action==='context')this.reviewContext(failed);
          else if(failure.action==='generation'&&generationFormat(failed))this.navigate('generation',{outputId:failed.jobId});
          else this.navigate('results');
        }},
      ],()=>{void this.client.dismissJob(failed).catch(()=>{this.error='Message hidden here. Dismissal could not be saved.';this.changed();});}):nothing}
      ${this.notice?this.notification(`notice:${this.noticeVersion}`,this.notice,'success',[],()=>{this.notice='';}):nothing}
    </en-toast-region>`;
  }
  render() {
    const c = this.client, displayedGeneration = !this.loading && !this.mode && c.position.view === 'generation' ? c.position.outputId : '';
    const running = c.jobs.filter(j => activeJobs.has(j.status) && j.documentId === c.position.documentId && !(j.jobId === displayedGeneration && generationFormat(j))), failed = c.jobs.find(j => j.status === 'failed' && !j.dismissedAt && j.documentId === c.position.documentId && j.jobId !== displayedGeneration);
    return html`<div class=${this.developer?'still-layout has-developer':'still-layout'}><div class="still-shell"><header class="masthead"><a class="wordmark" href=${this.viewURL('projects',{projectId:'',documentId:''})} aria-label="Still home" @click=${this.home}>still<span aria-hidden="true">.</span></a><span class="working-status" role="status" aria-live="polite">${this.busy ? 'Working…' : ''}</span><span class="session-status">${c.session?.impersonation ? 'Preview · read only' : c.session && !c.abilities.author ? 'Read only' : ''}</span></header><div class="feedback-strip">${running.length ? html`<aside class="job-status" role="status"><i></i>${generationFormat(running[0])?html`<a href=${this.viewURL('generation',{outputId:running[0].jobId})} @click=${(e:MouseEvent)=>this.follow(e,'generation',{outputId:running[0].jobId})}>${running[0].progressMessage || 'Generating…'}</a>`:running[0].progressMessage||'Working…'}${running.length > 1 ? ` · ${running.length} in progress` : ''}</aside>` : nothing}</div><main id="still-content" aria-busy=${this.loading}>${this.renderCanvas()}</main>${this.renderDock()}${this.renderPalette()}</div>${this.developer ? html`<aside class="developer-panel" aria-label="Developer panel"><still-developer-console @developer-flags=${this.setOnboarding} @developer-refresh=${this.refreshDecision} @developer-density=${this.setDensity} @developer-experiment=${this.experiment} @developer-disable=${()=>this.setDeveloper(false)}></still-developer-console></aside>` : nothing}${new URL(location.href).searchParams.has('progress-report') ? html`<a class="progress-return" href=${REPORT_URL}>Progress Report ↗</a>` : nothing}</div>${this.renderNotifications(failed)}`;
  }
}
if (!customElements.get('still-app')) customElements.define('still-app', StillApp);
