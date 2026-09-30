import {ToolbarMotion} from './motion/coordinator.ts';
import './source-advisory-inspector.ts';
import './idea-body-editor.ts';
import { decodeIdeaBody, ideaBodyText, plainTextIdeaBody, type IdeaBodyV1 } from '../model/idea-body.ts';
import { OUTPUT_KINDS, OUTPUT_KIND_LABELS, validateFormatOutputPreferences, type OutputKind } from '../model/document-output-intent.ts';
import './creation-flow.ts';
import type { StillCreationFlow } from './creation-flow.ts';
import { documentOutputPreferenceSummary, preferredOutputChoices } from '../model/document-output-intent.ts';
import '../components/video-cover.ts';
import { renderGenerationOptions } from './generation-options.ts';
import { validateGenerationOptions } from './generation-settings.ts';
import { imageGenerationProgress } from '../model/image-generation-progress.ts';
import { sharedIdeaOutputNotices } from '../model/shared-idea-output-freshness.ts';
import { IdeaEditCanceled } from '../ui/shared-idea-choice.ts';
import { attachIdeaEvents, ideaDocumentUses } from '../model/project-ideas.ts';
import './rejection-page.ts';
import { stillPageTitle } from './page-title.ts';
import { isIdeaPage, pageToolbarCandidates, withDocumentReturn, DOCUMENT_RETURN_REASON } from './local-policy.ts';
import {matchingIdeaAssessment,cachedIdeaAssessment,type IdeaAssessment} from './idea-assessment.ts';
import type { WorkflowAction, WorkflowToolbar } from './workflow-toolbar.ts';
import './all-list.ts';
import './audio-player.ts';
import { ListDisplay, listType, listControls, LIST_PAGE_SIZE } from './list-display.ts';
import { assessNextBest, nextBestOrder, readNextBestFlag, type NextBestAnswer } from './next-best.ts';
import { stillResultThumbnail, stillImage, stillVideoCover, stillVideo, stillImageStage, stillMediaHeading } from './media.ts';
import { fitToolbarLimit } from './toolbar-fit.ts';
import { generationOutcome } from './generation-outcome.ts';
import { generationDecisionContext } from './generation-decision.ts';
import { documentJobCanAcknowledgeSafety } from "../model/document-jobs.ts";
import { fetchDecision } from './decision-transport.ts';
import { actionHelp, workflowHelp, readOnboardingFlag, ONBOARDING_VIEWS, type OnboardingContext, type OnboardingResult } from './onboarding.ts';
import { OnboardingController } from './onboarding-client.ts';
import { onboardingCopy } from './onboarding-copy.ts';
import { toolbarTooltip } from './toolbar-tooltip.ts';
import './vendor/elements/define/tooltip.js';
import { DecisionMemo, stableDecisionKey } from './decision-cache.ts';
import { StillAttentionObserver } from './attention-observer.ts';
import { generationActive, generationPreview, generationFormat, generationResult, generationStatus, stillResults } from './results.ts';
import { failureNotification, canContinueReview, quietNotification } from './notifications.ts';
import { generationCompletion, generationNoticeKey } from './generation-activity.ts';
import type { DocumentJob } from '../model/document-jobs.ts';
import './form-elements.js';
import type { PaletteFeedback } from './palette-feedback.ts';
import { actionLimit, type ExperimentResult } from './decision-lab.ts';
import './palette-elements.js';
import { localHistoryEvidence } from './history.ts';
import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { live } from 'lit/directives/live.js';
import { keyed } from 'lit/directives/keyed.js';
import { repeat } from 'lit/directives/repeat.js';
import './vendor/tokens/default.css';
import './theme.css';
import './vendor/elements/define/button.js';
import './vendor/elements/define/badge.js';
import './vendor/elements/define/toolbar.js';
import './vendor/elements/define/textarea.js';
import './style.css';
import './motion/motion.css';
import './context-flow.ts';
import './use-in-flow.ts';
import type { StillUseInFlow } from './use-in-flow.ts';
import { explicitAction, paletteActions, nextToolbarActions, finderEntry } from './finder.ts';
import { presentActions, presentToolbar, type Emphasis } from './presentation.ts';
import './developer-console.ts';
import { DEVELOPER_DESKTOP_QUERY } from './developer-layout.ts';
import type { StillDeveloperConsole } from './developer-console.ts';
import { decisionDiagnostics, responseDisposition, type DecisionDiagnostics, type DecisionResponse, type ReceivedDecision } from './diagnostics.ts';
import { ACTIONS, POLICY_VERSION, eligibleActions, evaluateActions, rankAllFormats, selectActions, type Action, type Position } from './decisions.ts';
import { isContextCompositionRelation } from '../model/combined-context.ts';
import { documentSnapshot } from './context.ts';
import { generationReview, issueAffectsBlock, issueBlockSummary, type GenerationReview } from './generation-review.ts';
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
  private toolbarMotion?:ToolbarMotion;
  private toolbarDecisionPending=false;
  private toolbarContextWaiting=false;
  private toolbarContextPending(){return ['generation','rejection','results'].includes(this.client.position.view)&&!this.client.jobsLoaded&&!this.client.jobsError||!!this.missingWriting()&&!this.contentRead?.error;}
  private toolbarDecisionSettled=false;
  private toolbarDecisionAbort?:AbortController;
  private toolbarWorkflow(){return this.querySelector<StillContextFlow|StillUseInFlow|StillCreationFlow>('still-context-flow,still-use-in-flow,still-creation-flow')?.toolbar;}
  private toolbarReady(){return !this.loading&&!this.busy&&!this.directGeneration&&!this.toolbarContextPending()&&!this.toolbarDecisionPending&&!this.toolbarWorkflow()?.pending&&!!this.querySelector('.toolbar-motion-live .action-dock en-toolbar > en-button');}
  private expireToolbarDecision(){
    if(!this.toolbarDecisionPending)return;
    this.toolbarDecisionSettled=true;this.toolbarDecisionPending=false;++this.decisionTicket;
    clearTimeout(this.decisionTimer);this.decisionMemory.clearPending();this.toolbarDecisionAbort?.abort();this.decisionMemory.clear();
    this.onboardingDecisionPending=false;this.ideaRequestPending=false;this.developerPending=false;
    this.changed();
  }

  private writeRecovery?:{key:string;correlationId:string};
  private attention?:StillAttentionObserver;
  private decisionMemory=new DecisionMemo<DecisionResponse>({
    accept:r=>r.source==='jev'&&!r.reason&&r.policy===POLICY_VERSION&&r.head===this.client.head&&r.cache?.stored===true,
    ttl:r=>r.cache?.remainingMs??0,latency:r=>r.cache?.originalLatencyMs,age:r=>r.cache?.ageMs??0,
  });
  private decisionValidity = "";
  private decisionEvents = this.client.events;
  private retireChangedDecisions(){
    const validity=stableDecisionKey({scope:this.client.scopeKey,epoch:this.client.epoch,head:this.client.head,abilities:this.client.abilities});
    if(validity!==this.decisionValidity||this.decisionEvents!==this.client.events){
      this.decisionMemory.clear();this.decisionValidity=validity;
      this.decisionEvents=this.client.events;
    }
  }
  private decisionKey(body:unknown){
    const ref=this.client.projection.artifacts.find(a=>a.id===this.client.position.outputId)?.contentRef;
    return stableDecisionKey({scope:this.client.scopeKey,epoch:this.client.epoch,head:this.client.head,abilities:this.client.abilities,selectedContent:ref?this.client.content[ref]:undefined,body});
  }
  private decisionPosition():Position {const generation=['generation','rejection'].includes(this.client.position.view)?generationDecisionContext(this.selectedGeneration()):undefined;return {...this.client.position,...(generation?{generation:{...generation,canStartNew:generation.canStartNew&&!this.client.pendingGeneration&&!this.client.hasUnconfirmedWrite}}:{})};}
  private decisionBody(extra:Record<string,unknown>={}){return {...this.decisionPosition(),...extra,...(this.developer?{developer:true}:{})};}
  private async requestDecision(body:Record<string,unknown>,bypass=false,timeout?:number,onInitial?:(value:DecisionResponse)=>void,signal?:AbortSignal){
    const result=await this.decisionMemory.run(this.decisionKey(body),()=>fetchDecision({...body,...(bypass?{cacheBypass:true}:{})},onInitial,timeout,signal),bypass);
    return result.cache.status==='hit'||result.cache.status==='shared'?{...result.value,cache:{...result.cache,layer:'browser' as const}}:result.value;
  }
  private ideaAssessment?:IdeaAssessment;
  private ideaAssessmentTrace?:DecisionDiagnostics;
  private ideaAssessing=false;
  private ideaRequestPending=false;
  private assessIdeasAgain=async()=>{
    if(!this.developer||this.ideaAssessing||this.ideaRequestPending||this.loading||this.busy||this.mode||this.client.position.view!=='document')return;
    const scope=this.interactionScope(),position={...this.decisionPosition()},head=this.client.head;
    this.decisionMemory.clear();this.ideaAssessing=true;this.changed();
    try{
      const result=await this.requestDecision(this.decisionBody({opportunitiesOnly:true}),true);
      if(scope===this.interactionScope()&&matchingIdeaAssessment(result.opportunities,this.decisionPosition(),this.client.head)){this.ideaAssessment=cachedIdeaAssessment(result.opportunities,result.cache?.status==='hit');this.ideaAssessmentTrace=result.diagnostics;}
    }catch{
      if(scope===this.interactionScope()&&this.client.head===head&&this.client.position.blockId===position.blockId&&this.ideaAssessment){this.ideaAssessment={...this.ideaAssessment,phase:'complete',complete:false,actions:Object.fromEntries(Object.entries(this.ideaAssessment.actions).map(([id,a])=>[id,{...a,status:'Failed',probability:undefined,reason:'Reassessment unavailable'}]))};}
    }finally{this.ideaAssessing=false;this.changed();}
  };
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
  private generationCheck: {key:string;message:string} | null = null;
  private inlineGenerationKey = '';
  private errorCode = '';
  private errorMessage = '';
  private errorVersion = 0;
  private get error() { return this.errorMessage; }
  private set error(value:string) { this.errorMessage=value;this.errorCode=''; ++this.errorVersion; }
  private noticeMessage = '';
  private noticeVersion = 0;
  private get notice() { return this.noticeMessage; }
  private set notice(value:string) { this.noticeMessage=value; ++this.noticeVersion; }
  private dismissedNotifications = new Set<string>();
  private expandedNotification = '';
  private reviewVersion = 0;
  private mode = '';
  private routeMode = '';
  private routeError = '';
  private activeAddress = '';
  private historyIndex = Number.isSafeInteger(history.state?.stillIndex)?history.state.stillIndex:0;
  private draftBaseline = '';
  private titleDraft = '';
  private bodyDraft = '';
  private richBodyDraft:IdeaBodyV1|undefined;
  private richEditIssue='';
  private preferenceDraft:OutputKind[]=[];
  private kindDraft = 'direction';
  private pendingBlock: ReturnType<StillClient['blockEvent']> | null = null;
  private editBase: { text?: string; revision?: number; title?: string; item?: number } = {};
  private composing = false;
  private dockObserver = new ResizeObserver(() => this.scheduleDockFit());
  private dockFitFrame=0;
  private measuredDockLimit=7;
  private firstDockLimit=5;
  private measuringDock=0;
  private dockFitScope='';
  private dockFitWidth=0;
  private dockFit={maximum:5,fits:5,hidden:[] as string[],deferred:false};
  private get toolbarLimit(){return this.measuringDock||Math.min(this.pageActionLimit,this.measuredDockLimit);}
  private get dockClass(){return this.measuringDock?'dock-measure':'action-dock';}
  private dockId(id:string){return this.measuringDock?'measure-'+this.measuringDock+'-'+id:id;}
  private scheduleDockFit(){cancelAnimationFrame(this.dockFitFrame);this.dockFitFrame=requestAnimationFrame(()=>this.measureDock());}
  private measureDock(){
    const dock=this.querySelector<HTMLElement>('.action-dock');
    if(!dock)return;
    this.style.setProperty('--dock-height', `${(this.querySelector('.dock-stack')??dock).getBoundingClientRect().height+70}px`);
    const padding=getComputedStyle(dock);
    const available=dock.clientWidth-parseFloat(padding.paddingLeft)-parseFloat(padding.paddingRight);
    const probes=[...this.querySelectorAll<HTMLElement>('.toolbar-probes [data-fit-limit]')];
    const widths=probes.map(probe=>({limit:Number(probe.dataset.fitLimit),width:(probe.querySelector('en-toolbar')?.shadowRoot?.querySelector('[part=base]')?.getBoundingClientRect().width??Infinity)+8}));
    const scope=[this.activeAddress,this.mode,this.moreOpen,this.pageActionLimit].join('/');
    const previous=scope===this.dockFitScope?this.measuredDockLimit:undefined;
    const fits=fitToolbarLimit(widths,available,this.pageActionLimit,previous);
    const resized=Math.abs(available-this.dockFitWidth)>1;
    this.dockFitWidth=available;
    const focused=dock.contains(document.activeElement)?document.activeElement as HTMLElement:null;
    const focusId=focused?.dataset.actionId||focused?.id;
    // Optional growth can wait while a control is focused. Shrinking and viewport
    // changes must always refit, including focus retained after a touch action.
    const deferred=previous!==undefined&&!resized&&!!focused&&fits>this.measuredDockLimit;
    const next=deferred?this.measuredDockLimit:fits;
    const current=probes.find(p=>Number(p.dataset.fitLimit)===next);
    const maximum=probes.find(p=>Number(p.dataset.fitLimit)===this.pageActionLimit);
    const labels=(node:Element|undefined)=>[...node?.querySelectorAll('en-toolbar > en-button')??[]].map(b=>b.textContent?.trim()??'');
    const shown=labels(current),hidden=labels(maximum).filter(label=>!shown.includes(label));
    const info={maximum:this.pageActionLimit,fits:next,hidden,deferred};
    const changed=JSON.stringify(info)!==JSON.stringify(this.dockFit)||next!==this.measuredDockLimit;
    this.dockFitScope=scope;this.dockFit=info;this.measuredDockLimit=next;
    if(!this.moreOpen)this.firstDockLimit=next;
    if(changed){
      this.changed();
      if(previous!==undefined&&next!==previous&&focused&&focusId)void this.updateComplete.then(()=>{
        if(!this.isConnected||scope!==this.dockFitScope)return;
        // Do not steal focus if the user moved elsewhere while Lit was updating.
        if(document.activeElement!==focused&&document.activeElement!==document.body)return;
        const buttons=[...this.querySelectorAll<HTMLElement>('.action-dock en-toolbar > en-button')];
        const target=buttons.find(button=>(button.dataset.actionId||button.id)===focusId)
          ??buttons.find(button=>button.dataset.actionId==='ui:more'||button.id==='still-compact-menu')
          ??buttons[0];
        target?.focus({preventScroll:true});
      });
    }
  }
  // At most seven inert alternatives: real En Reve sizing without duplicate IDs, help requests or telemetry.
  private renderDockProbes(){
    const probes=[];
    try{for(let limit=1;limit<=this.pageActionLimit;limit++){this.measuringDock=limit;probes.push(html`<div data-fit-limit=${limit}>${this.renderDock()}</div>`);}}
    finally{this.measuringDock=0;}
    return html`<div class="toolbar-probes" inert aria-hidden="true">${probes}</div>`;
  }
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
  private listDisplay=new ListDisplay();
  private listKind(){const p=this.client.position,type=listType(p.view,this.mode,p.blockId);this.listDisplay.enter([this.client.epoch,this.client.scopeKey,p.projectId,p.documentId,p.view,p.blockId,this.mode].join('/'),type);return type;}
  private listCount(){const p=this.client.projection;return this.listKind()==='projects'?p.projects.length:this.listKind()==='documents'?p.documents.filter(d=>!d.removed).length:this.listKind()==='ideas'?p.blocks.filter(b=>!b.removed).length:stillResults(p,this.client.jobs,this.client.events).length;}
  private listOptions(){return listControls(this.listKind(),this.listDisplay.all,this.page,this.listCount());}
  private runListAction(id:string){
    if(!this.listOptions().some(a=>a.id===id))return false;
    if(id==='ui:previous-page')this.turnPage(this.page-1);
    else if(id==='ui:next-page')this.turnPage(this.page+1);
    else {this.toolbarDecisionSettled=false;this.toolbarMotion?.begin('list-display');this.listDisplay.set(id==='ui:show-all');this.page=0;this.moreOpen=false;++this.toolbarHelpEpoch;this.writeRoute(true);this.changed();this.focusContent();this.decide();}
    return true;
  }
  private setRememberLists=(e:CustomEvent<{value:boolean}>)=>{this.listKind();this.listDisplay.setRemember(e.detail.value===true);this.changed();};
  private renderList<T extends {id:string}>(items:T[],renderItem:(item:T,index:number)=>unknown,className:string){
    const type=this.listKind();
    if(type&&this.listDisplay.all)return html`<still-all-list .label=${'All '+type} .items=${items} .renderItem=${renderItem}></still-all-list>`;
    const offset=type?this.page*LIST_PAGE_SIZE:0;
    return html`<div class=${className}>${(type?items.slice(offset,offset+LIST_PAGE_SIZE):items).map((item,i)=>renderItem(item,offset+i))}</div>`;
  }
  private moreOpen=false;
  private toolbarHelpEpoch=0;
  private nextBestEnabled=true;
  private nextBest?:NextBestAnswer;
  private setNextBest=(e:CustomEvent<{value:boolean}>)=>{
    this.nextBestEnabled=e.detail.value===true;
    try{localStorage.setItem('still:flag:next-best',String(this.nextBestEnabled));}catch{/* Storage may be unavailable in private browsing. */}
    this.moreOpen=false;this.changed();
  };
  private nextBestAssessment(){
    const formats=this.mode==='generate'&&!this.generation;
    const ids=formats?this.formatSuggestions:this.rankedActions.filter(a=>this.candidates().some(c=>c.id===a.id)).map(a=>a.id);
    return assessNextBest(this.nextBest,ids,formats?this.formatEmphasis:this.emphasis,this.nextBestEnabled,this.secondaryOnly());
  }
  private emptyProject(){return this.client.position.view==='documents'&&!!this.client.position.projectId&&!this.client.projection.documents.some(d=>!d.removed);}
  private preferredSuggestions(){
    const ordered=nextBestOrder(this.suggestions,this.rankedActions,this.nextBestAssessment());
    const start=this.emptyProject()?this.candidates().find(a=>a.id==='new-document'):undefined;
    const fallback=!ordered.length?this.candidates().find(a=>a.id===(this.client.position.view==='projects'?'new-project':'projects')):undefined;
    return start?[start,...ordered.filter(a=>a.id!==start.id)]:fallback?[fallback]:ordered;
  }
  private onboarding=false;
  private onboardingDecisionPending=false;
  private onboardingHelp=new OnboardingController(input=>api<OnboardingResult>('/api/still/onboarding',input,'POST',8000),()=>this.changed());
  private onboardingScope(){return this.interactionScope()+'/'+this.client.position.view+'/'+this.mode+'/'+this.client.position.blockId+'/'+this.client.position.outputId;}
  private onboardingContext(ids:string[]):OnboardingContext{
    const p=this.client.projection,pos=this.client.position,formats=this.mode==='generate'&&!this.generation;
    const evidence=formats?this.formatEmphasis:this.emphasis,choice=this.nextBestAssessment();
    const ideas=pos.documentId?p.blocks.filter(b=>!b.removed):[],selected=ideas.find(b=>b.id===pos.blockId);
    return {
      surface:formats?'formats':this.moreOpen?'more':this.mode?'workflow':'main',
      basis:Object.fromEntries(ids.map(id=>[id,this.moreOpen?'alternative':id==='context'&&isIdeaPage(this.decisionPosition())?'page-default':this.emptyProject()&&id==='new-document'?'page-default':choice.accepted&&choice.choice===id?'next-best':evidence[id]?.score!==undefined?'model-ranked':pos.view==='projects'&&id==='new-project'?'page-default':'local'])),
      available:{...(pos.view==='projects'?{projects:p.projects.length}:{}),...(pos.view==='documents'?{documents:p.documents.filter(d=>!d.removed).length}:{}),...(pos.documentId?{ideas:ideas.length,activeIdeas:ideas.filter(b=>Number(b.properties.weight??1)>0).length,results:p.outputs.length+p.artifacts.length}:{})},
      ...(selected?{selectedIdea:{kind:selected.type,active:Number(selected.properties.weight??1)>0,locked:selected.locked}}:{}),
      recentActions:pos.recentActions,historyComplete:this.client.historyComplete,
    };
  }
  private setOnboarding=(e:CustomEvent<{value:boolean}>)=>{this.onboarding=e.detail.value===true;try{localStorage.setItem('still:flag:onboarding',String(this.onboarding));}catch{/* Storage may be unavailable in private browsing. */}const url=new URL(location.href);url.searchParams.delete('onboarding');url.searchParams.delete('onbaording');history.replaceState(history.state,'',url);this.activeAddress=this.address();this.changed();};
  private help(id:string,label:string){
    // Lit can reuse a toolbar slot for another action or the same action on a new page.
    // Retire the previous help instance so its open state and delayed work cannot follow it.
    const key=JSON.stringify([this.onboardingScope(),this.page,this.itemIndex,this.generation?.format,id,label,this.toolbarHelpEpoch]);
    // A keyed repeat removes the old part and runs its async-directive disconnect cleanup.
    return this.onboarding&&!this.measuringDock?repeat([key],key=>key,()=>html`<en-tooltip ${toolbarTooltip()} for=${id} inline="center" block="start" warmup-group="still-onboarding" show-delay="250"><span slot="content">${onboardingCopy(workflowHelp(this.mode,id.replace('still-help-',''),label,this.client.hasUnconfirmedWrite)??this.onboardingHelp.help(this.onboardingScope(),id.replace('still-help-',''))??actionHelp(id.replace('still-help-',''),label))}</span></en-tooltip>`):nothing;
  }
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
  private sharedPanelActive=false;
  private get developerVisible(){return this.developerRequested&&this.desktop.matches;}
  private get developer() { return this.developerVisible||this.sharedPanelActive; }
  private setSharing=(e:CustomEvent<{value:boolean}>)=>{this.sharedPanelActive=e.detail.value;if(!this.sharedPanelActive&&!this.developerRequested)this.setDeveloper(false);else this.changed();};
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
  private generationDrafts = new Map<string,GenerationDraft>();
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
    this.toolbarDecisionSettled=false;this.toolbarMotion?.begin('history');
    this.historyIndex=index??0;this.readRoute();this.changed();this.decide();this.focusContent();
  };
  // Update only the header decoration; scrolling must not rerender actions or request Jev.
  private readonly updateHeaderScroll = () => { this.toggleAttribute('data-header-scrolled', window.scrollY > 0); };
  createRenderRoot() { return this; }
  connectedCallback() {
    super.connectedCallback(); this.disposed = false;
    this.toolbarMotion=new ToolbarMotion(this,{ready:()=>this.toolbarReady(),timeout:()=>this.expireToolbarDecision(),recovery:()=>!!this.error||!!this.contentRead?.error||!!this.client.jobsError||!!this.toolbarWorkflow()?.recovery||this.startupFailed||!!this.routeError,state:()=>this.error?'error':this.moreOpen?'page2':'page1',settled:()=>{this.toolbarDecisionSettled=true;this.scheduleDockFit();}});
    this.toolbarMotion.begin('initial');
    this.updatePageTitle();
    this.updateHeaderScroll();
    window.addEventListener('scroll', this.updateHeaderScroll, { passive: true });
    this.attention=new StillAttentionObserver(this,snapshot=>{
      const inspector=this.querySelector<StillDeveloperConsole>('still-developer-console');
      if(inspector?.context)inspector.context={...inspector.context,attention:snapshot};
    });
    try{this.nextBestEnabled=readNextBestFlag(localStorage);}catch{/* Storage may be unavailable in private browsing. */}
    try{this.listDisplay=new ListDisplay(localStorage);}catch{/* Storage may be unavailable in private browsing. */}
    try{this.onboarding=readOnboardingFlag(location.href,localStorage);}catch{this.onboarding=new URL(location.href).searchParams.has('onboarding');}
    this.client.onChange = () => { this.retireChangedDecisions(); if (this.client.recoveredWrite) { this.notice = 'Save confirmed.'; this.client.recoveredWrite = false; } this.changed(); };
    this.desktop.addEventListener('change', this.developerViewportChanged);
    window.addEventListener('keydown', this.paletteShortcut);
    window.addEventListener('popstate', this.popstate);
    window.addEventListener('beforeunload', this.beforeUnload);
    window.addEventListener('focus', this.resumeSync);
    document.addEventListener('visibilitychange', this.resumeSync);
    void this.run(() => this.loadWorkspace());
  }
  disconnectedCallback() { super.disconnectedCallback(); this.toolbarMotion?.dispose();this.decisionMemory.clearPending();this.toolbarDecisionAbort?.abort(); window.removeEventListener('scroll', this.updateHeaderScroll); this.onboardingHelp.dispose(); this.attention?.dispose();this.attention=undefined;this.decisionMemory.clear(); this.desktop.removeEventListener('change', this.developerViewportChanged); this.disposed = true; ++this.developerEpoch; this.developerApplied=undefined;this.developerReceived=undefined;this.dockObserver.disconnect();cancelAnimationFrame(this.dockFitFrame); clearTimeout(this.pollTimer); clearTimeout(this.decisionTimer); window.removeEventListener('keydown', this.paletteShortcut);window.removeEventListener('popstate', this.popstate); window.removeEventListener('beforeunload', this.beforeUnload); window.removeEventListener('focus', this.resumeSync); document.removeEventListener('visibilitychange', this.resumeSync); }
  private draftSignature(){const g=this.generation;return JSON.stringify([this.titleDraft,this.bodyDraft,this.richBodyDraft,this.preferenceDraft,this.kindDraft,g?.prompt,g?.tone,g?.audience,g?.itemCount,g?.settings]);}
  private preventsRouteChange(unloading=false){return this.busy&&!this.loading||this.composing||!!this.generation?.attempted||!!this.mode&&this.draftSignature()!==this.draftBaseline||!!this.querySelector<StillContextFlow>('still-context-flow')?.preventsRouteChange||!!this.querySelector<StillUseInFlow>('still-use-in-flow')?.preventsRouteChange||!!this.querySelector<StillCreationFlow>('still-creation-flow')?.[unloading?'preventsUnload':'preventsRouteChange'];}
  private beforeUnload = (e: BeforeUnloadEvent) => { if (this.preventsRouteChange(true)) { e.preventDefault(); e.returnValue = ''; } };
  private changed() { this.requestUpdate(); }
  private updatePageTitle() {
    const title=stillPageTitle(location.href,this.client.session?.policy.accepted?this.client.projection:undefined,this.client.jobs,this.routeError);
    if(document.title!==title)document.title=title;
  }
  protected updated() {
    this.toolbarMotion?.attach();
    if(this.toolbarContextWaiting&&!this.toolbarContextPending()){this.toolbarContextWaiting=false;this.decide();}
    if(!this.loading&&!this.startupFailed&&this.client.session&&!this.client.session.policy.accepted)this.toolbarMotion?.suspend();
    this.updatePageTitle();
    this.reconcileGenerationNotices();
    this.reconcileGeneration();
    this.hydrateVisibleWriting();
    const actionIds=[...new Set([...this.querySelectorAll<HTMLElement>('.action-dock en-button')].map(button=>button.dataset.actionId||button.id.replace('still-help-','')).filter(id=>ACTIONS.some(a=>a.id===id)))].slice(0,7);
    const helpView=this.mode==='generate'?'choose-format':ONBOARDING_VIEWS.includes(this.client.position.view)?this.client.position.view:'other';
    const helpEnabled=this.onboarding&&!this.loading&&!this.busy&&!this.startupFailed&&!this.paletteOpen&&!this.onboardingDecisionPending&&!!this.client.session?.policy.accepted;
    this.onboardingHelp.update(this.onboardingScope(),helpEnabled?{enabled:true,actions:actionIds,view:helpView,locale:document.documentElement.lang||'en',context:this.onboardingContext(actionIds)}:null,`${this.client.epoch}/${this.client.scopeKey}`);
    const attentionPage=location.pathname;
    const attentionEnabled=!this.loading&&!this.startupFailed&&!!this.client.session?.policy.accepted;
    this.attention?.refresh(`${this.client.epoch}/${this.client.scopeKey}`,attentionEnabled?attentionPage:'',attentionEnabled,this.paletteOpen);
    const dock = this.querySelector('.action-dock'); this.dockObserver.disconnect();
    if(dock){this.dockObserver.observe(this.querySelector('.dock-stack')??dock);this.dockObserver.observe(dock);for(const probe of this.querySelectorAll('.toolbar-probes en-toolbar'))this.dockObserver.observe(probe);this.scheduleDockFit();}
    const inspector=this.querySelector<StillDeveloperConsole>('still-developer-console');
    if(inspector){
      if(this.developerScope!==this.diagnosticScope()){this.developerApplied=undefined;this.developerReceived=undefined;this.developerScope=this.diagnosticScope();}
      inspector.context={ideaAssessment:matchingIdeaAssessment(this.ideaAssessment,this.decisionPosition(),this.client.head),ideaAssessmentTrace:matchingIdeaAssessment(this.ideaAssessment,this.decisionPosition(),this.client.head)?this.ideaAssessmentTrace:undefined,ideaAssessing:this.ideaAssessing,ideaRequestPending:this.ideaRequestPending,rememberLists:this.listDisplay.remember,listDisplay:{type:this.listKind(),all:this.listDisplay.all},nextBest:this.nextBestAssessment(),nextBestAnswer:this.nextBest,toolbarFit:this.dockFit,generation:this.decisionPosition().generation,onboarding:this.onboarding,onboardingText:this.onboardingHelp.status,historyComplete:this.client.historyComplete,canRefreshDecision:!this.loading&&!this.busy&&(this.paletteOpen||this.mode==='generate'&&!this.generation||!this.mode&&!this.isInlineGeneration()&&!this.canAcknowledgeSafety(this.selectedGeneration())),attention:this.attention?.summary.snapshot(),view:this.client.position.view,mode:this.mode,head:this.client.head,page:this.page,actionLimit:this.pageActionLimit,more:this.moreOpen,paletteOpen:this.paletteOpen,paletteFeedback:this.paletteFeedback,paletteOrder:this.paletteOrder,selectedFormat:this.generation?.format??'',current:this.localDiagnostics('Current eligibility')};
      inspector.applied=this.developerApplied;inspector.received=this.developerReceived;inspector.pending=this.developerPending||this.paletteBusy||this.paletteRefreshing;
      inspector.scope=this.diagnosticScope();inspector.hostVisible=this.developerVisible;
    }
  }
  private interactionScope(){return JSON.stringify([this.client.epoch,this.client.scopeKey,this.client.position.projectId,this.client.position.documentId]);}
  private diagnosticScope(){return `${this.developerEpoch}/${this.interactionScope()}`;}
  private localDiagnostics(reason:string, formats=false){return decisionDiagnostics(this.client.projection,{...this.decisionPosition(),...(formats?{view:'choose-format'}:{})},this.client.abilities,{head:this.client.head,source:'fallback',reason,localEvents:localHistoryEvidence(this.client.events),artifactKind:this.client.projection.artifacts.find(a=>a.id===this.client.position.outputId)?.kind});}
  private recordDecision(result:DecisionResponse,disposition:string,scope:string,started:number,firstResponseMs?:number){
    if(!this.developer||this.disposed||scope!==this.diagnosticScope())return;
    this.developerReceived={firstResponseMs,delivery:result.delivery,originalTiming:result.originalTiming,preparation:result.preparation,cache:result.cache,receivedAt:Date.now(),at:new Date().toLocaleTimeString(),requestElapsedMs:Math.max(0,performance.now()-started),disposition,trace:result.diagnostics,source:result.source,reason:result.reason,recommended:result.paletteActions?.map(a=>a.id)??(result.formats?.length?result.formats:result.actions?.map(a=>a.id)??[])};
    if(disposition==='Applied')this.developerApplied=result.diagnostics;
    this.changed();
  }
  private setDeveloper(enabled:boolean){
    if(enabled&&!this.desktop.matches)return;
    if(this.sharedPanelActive){
      this.developerRequested=enabled;const url=new URL(location.href);if(enabled)url.searchParams.set('developer','');else url.searchParams.delete('developer');history.replaceState(history.state,'',url);this.activeAddress=this.address();this.changed();return;
    }
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
    this.toolbarDecisionSettled=false;this.toolbarMotion?.ensure();
    this.busy = true; this.error = ''; this.changed();
    try { await work(); } catch (error) { if(!(error instanceof IdeaEditCanceled)){this.error = error instanceof Error ? error.message : 'Could not complete this step.';this.errorCode=error instanceof ApiError?String(error.body.error??''):'';} }
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
    return html`<section class="quiet-state"><h1>${this.contentRead?.error ? 'Writing unavailable' : 'Loading writing…'}</h1>${this.contentRead?.error ? html`<p role="alert">${this.contentRead.error}</p>${this.button('Retry loading writing',()=>{this.toolbarMotion?.ensure();this.contentRead=null;this.changed();})}` : nothing}</section>`;
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
        try{const format=this.client.pendingGeneration?.format??route.format;if(format){this.generation=this.client.prepareGeneration(format);
        this.client.position.recentActions=[...this.client.position.recentActions.filter(a=>!a.startsWith('format-choice:')),`format-choice:${format}`].slice(-12);}this.begin('generate',false);}
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
    this.toolbarDecisionSettled=false;this.toolbarMotion?.ensure();
    c.position={...c.position,view:'artifact',outputId:id};this.writeRoute(true);this.changed();this.decide();
  }
  private writeRoute(replace=false){
    const url=stillURL(this.currentRoute(),location.href);
    if(replace||url!==this.address()){
      if(!replace)++this.historyIndex;
      history[replace?'replaceState':'pushState']({...history.state,stillIndex:this.historyIndex},'',url);
    }
    this.activeAddress=url;
    this.updatePageTitle();
  }
  private resetStep(){this.toolbarContextWaiting=false;this.toolbarDecisionSettled=false;this.toolbarDecisionPending=false;this.decisionMemory.clearPending();this.toolbarDecisionAbort?.abort();this.ideaRequestPending=false;this.ideaAssessment=undefined;this.ideaAssessmentTrace=undefined;this.listDisplay.leave();this.inlineGenerationKey='';this.toolbarSeen=[];this.paletteFeedback=undefined;this.paletteRefreshing=false;this.moreOpen=false;this.paletteOpen=false;++this.paletteTicket;this.dockTouched=false;this.useInTarget='';this.emphasis={};this.formatEmphasis={};this.nextBest=undefined;++this.decisionTicket;clearTimeout(this.decisionTimer);this.mode='';this.routeMode='';this.bodyDraft='';this.titleDraft='';this.pendingBlock=null;this.generation=null;this.generationDrafts.clear();this.generationGate=null;this.formatSuggestions=[];this.formatTouched=false;this.developerPending=false;}
  private navigate(view: string, ids: Partial<StillClient['position']> = {}) {
    if(this.busy)this.toolbarMotion?.ensure();else this.toolbarMotion?.begin('navigate');
    this.resetStep();this.page = 0; this.itemIndex = 0; this.error = '';this.routeError='';this.notice='';
    const changedDocument = ids.documentId !== undefined && ids.documentId !== this.client.position.documentId || ids.projectId !== undefined && ids.projectId !== this.client.position.projectId;
    this.client.position = { ...this.client.position, ...(changedDocument ? { intent:'', recentActions:[] } : {recentActions:this.client.position.recentActions.filter(a=>!a.startsWith('completed:'))}), blockId: '', outputId: '', ...ids, view };
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
  private turnPage(page:number){if(this.listKind()&&this.listDisplay.all)return;this.toolbarDecisionSettled=false;this.toolbarMotion?.begin('page');this.dockTouched=false;this.page=Math.max(0,page);this.writeRoute();this.changed();this.decide();}
  private turnItem(item:number){this.toolbarDecisionSettled=false;this.toolbarMotion?.begin('item');this.dockTouched=false;this.itemIndex=item;this.writeRoute();this.changed();this.decide();}
  private candidates() { return eligibleActions(this.client.projection, this.decisionPosition(), this.client.abilities); }
  private decide(bypass=false) {
    if(this.toolbarDecisionSettled&&!bypass)return;
    this.toolbarMotion?.ensure();
    this.ideaRequestPending=false;
    this.onboardingDecisionPending=false;
    if(this.toolbarContextPending()){this.toolbarContextWaiting=true;return;}
    if(this.client.position.view==='generation'&&!this.mode&&(this.isInlineGeneration()||this.canAcknowledgeSafety(this.selectedGeneration()))){clearTimeout(this.decisionTimer);++this.decisionTicket;this.developerPending=false;this.developerReceived=undefined;this.developerApplied=this.developer?this.localDiagnostics('Required generation review supplies deterministic controls; Jev cannot authorize submission.'):undefined;return;}
    if(this.currentRouteProblem(this.client.projection))return;
    if(this.mode){clearTimeout(this.decisionTimer);if(this.mode==='generate'&&!this.generation){++this.decisionTicket;this.suggestFormats(bypass);}return;}
    clearTimeout(this.decisionTimer);this.decisionMemory.clearPending();this.toolbarDecisionAbort?.abort();this.toolbarDecisionAbort=new AbortController();
    const signal=this.toolbarDecisionAbort.signal;this.toolbarDecisionPending=true;this.toolbarDecisionSettled=false;
    const ticket = ++this.decisionTicket;
    this.lastGenerationDecision=JSON.stringify(this.decisionPosition().generation);
    const candidates = this.candidates(); this.suggestions = selectActions(candidates, this.decisionPosition(),{},this.client.projection);this.rankedActions=evaluateActions(candidates,this.decisionPosition(),{},this.client.projection).ranked;this.moreOpen=false;this.emphasis=presentActions(this.suggestions.map(a=>a.id));this.suggestionTargets={}; this.nextBest=undefined; this.decisionSource = 'fallback'; this.changed();
    if(this.developer){this.developerScope=this.diagnosticScope();this.developerApplied=this.localDiagnostics('Local policy');this.developerReceived=undefined;this.developerPending=false;}
    if (!this.client.session?.policy.accepted || this.mode){this.toolbarDecisionPending=false;return;}
    this.onboardingDecisionPending=true;
    this.decisionTimer = window.setTimeout(async () => {
      const snapshot = JSON.stringify(this.decisionPosition()), head = this.client.head, scope=this.interactionScope(), diagnosticScope=this.diagnosticScope();
      this.ideaRequestPending=this.client.position.view==='document';this.developerPending=this.developer;this.changed();
      const started=performance.now();
      try {
        let firstResponseMs:number|undefined;
        const applyResult=(result:DecisionResponse)=>{
        this.toolbarMotion?.sync();
        if(ticket!==this.decisionTicket||this.toolbarDecisionSettled)return;
        if(result.delivery?.stage==='initial')throw new Error('Final toolbar actions unavailable');
        firstResponseMs??=Math.max(0,performance.now()-started);
        if(ticket===this.decisionTicket&&scope===this.interactionScope()&&result.policy===POLICY_VERSION&&snapshot===JSON.stringify(this.decisionPosition())&&!this.mode&&matchingIdeaAssessment(result.opportunities,this.decisionPosition(),this.client.head)){
          this.ideaAssessment=cachedIdeaAssessment(result.opportunities,result.cache?.status==='hit');this.ideaAssessmentTrace=result.diagnostics;
          if(result.delivery?.enrichment==='interrupted'&&this.ideaAssessment?.phase==='pending')this.ideaAssessment={...this.ideaAssessment,phase:'complete',complete:false,actions:Object.fromEntries(Object.entries(this.ideaAssessment.actions).map(([id,a])=>[id,a.status==='Pending'?{...a,status:'Failed',reason:'Assessment stream interrupted'}:a]))};
          this.changed();
        }
        const disposition=responseDisposition(result,{head:this.client.head,headChanged:head!==this.client.head,stale:ticket!==this.decisionTicket||snapshot!==JSON.stringify(this.decisionPosition())||!!this.mode||this.disposed||scope!==this.interactionScope(),focused:false});
        this.recordDecision(result,disposition,diagnosticScope,started,firstResponseMs);
        if(disposition==='Applied'){this.nextBest=result.nextBest;const allowed=new Map(this.candidates().map(a=>[a.id,a]));this.suggestions=result.actions!.map(a=>allowed.get(a.id)).filter((a):a is Action=>!!a).slice(0,4);this.rankedActions=(result.rankedActions??result.actions??[]).map(a=>allowed.get(a.id)).filter((a):a is Action=>!!a);this.emphasis=result.presentation??presentActions(this.suggestions.map(a=>a.id));this.suggestionTargets=result.targets??{};this.decisionSource=result.source;this.changed();}
        // Help starts only after the final action set has been selected.
        if(ticket===this.decisionTicket){this.onboardingDecisionPending=false;this.developerPending=false;this.changed();}
        };
        const result=await this.requestDecision(this.decisionBody(),bypass,0,partial=>{
          if(ticket===this.decisionTicket)this.recordDecision(partial,'Pending: waiting for final actions',diagnosticScope,started);
        },signal);
        applyResult(result);
      } catch(error) { this.recordDecision({source:'fallback',reason:error instanceof ApiError?`HTTP ${error.status}`:'Network unavailable',head,policy:POLICY_VERSION},'Kept local controls',diagnosticScope,started); }
      finally {if(ticket===this.decisionTicket){this.toolbarDecisionPending=false;this.toolbarDecisionSettled=true;this.ideaRequestPending=false;this.onboardingDecisionPending=false;this.developerPending=false;this.changed();}}
    }, 0);
  }
  private suggestFormats(bypass=false) {
    if(this.toolbarDecisionSettled&&!bypass)return;
    this.toolbarMotion?.ensure();this.decisionMemory.clearPending();this.toolbarDecisionAbort?.abort();this.toolbarDecisionAbort=new AbortController();
    const signal=this.toolbarDecisionAbort.signal;this.toolbarDecisionPending=true;
    const ticket = this.decisionTicket, snapshot = JSON.stringify(this.client.position), head = this.client.head, scope = this.interactionScope();
    if(this.developer){this.developerApplied=this.localDiagnostics('No automatic format choice',true);this.developerReceived=undefined;}
    this.onboardingDecisionPending=true;
    this.decisionTimer = window.setTimeout(async () => {
      const diagnosticScope=this.diagnosticScope(),started=performance.now();
      try {
        if (ticket !== this.decisionTicket || this.mode !== 'generate' || this.generation || this.formatTouched || scope!==this.interactionScope()) return;
        this.developerPending=this.developer;this.changed();
        const result = await this.requestDecision(this.decisionBody({view:'choose-format'}),bypass,0,undefined,signal);
        this.toolbarMotion?.sync();if(ticket!==this.decisionTicket||this.toolbarDecisionSettled)return;
        const disposition=responseDisposition(result,{formats:true,head:this.client.head,headChanged:head!==this.client.head,stale:ticket!==this.decisionTicket||this.mode!=='generate'||!!this.generation||this.disposed||scope!==this.interactionScope()||snapshot!==JSON.stringify(this.client.position),touched:this.formatTouched});
        this.recordDecision(result,disposition,diagnosticScope,started);
        if (disposition==='Applied') {
          const allowed = new Set(this.candidates().filter(a=>!!FORMATS[a.id]).map(a=>a.id));
          this.nextBest=result.nextBest;this.formatSuggestions = [...new Set(result.rankedFormats ?? result.formats!)].filter(id=>allowed.has(id));this.formatEmphasis=result.presentation??presentActions(this.formatSuggestions); this.changed();
        }
      } catch(error) { this.recordDecision({source:'fallback',reason:error instanceof ApiError?`HTTP ${error.status}`:'Network unavailable',head,policy:POLICY_VERSION},'Kept local format order',diagnosticScope,started); }
      finally {if(ticket===this.decisionTicket){this.toolbarDecisionPending=false;this.toolbarDecisionSettled=true;this.onboardingDecisionPending=false;this.developerPending=false;this.changed();}}
    }, 0);
  }
  private lastGenerationDecision = '';
  private async sync(force = false) {
    if (this.syncPending || this.disposed || this.loading || this.busy || document.hidden || !this.client.session?.policy.accepted) return;
    const now = Date.now(), work: Promise<void>[] = [];
    this.syncPending = true;
    const completionPosition=JSON.stringify([this.client.position.view,this.client.position.outputId]);
    const completed=new Set(this.client.jobs.filter(j=>j.documentId===this.client.position.documentId&&!generationActive(j)).map(j=>j.jobId));
    try {
      // Keep collaborator edits current independently of whether this page has jobs.
      if (force || now - this.lastHistoryPoll >= 30000) { this.lastHistoryPoll = now; work.push(this.client.refresh()); }
      const interval = this.client.generationActivity.hasActive || this.client.jobs.some(j => activeJobs.has(j.status)) ? 2000 : 60000;
      if (force || now - this.lastJobsPoll >= interval) { this.lastJobsPoll = now; work.push(this.client.pollJobs()); }
      await Promise.allSettled(work);
      if(!this.mode&&completionPosition===JSON.stringify([this.client.position.view,this.client.position.outputId])&&this.client.jobs.some(j=>j.documentId===this.client.position.documentId&&!generationActive(j)&&!completed.has(j.jobId))){
        this.toolbarDecisionSettled=false;this.dockTouched=false;this.toolbarMotion?.ensure();this.decide();
      }
    } finally { this.syncPending = false; }
  }
  private poll() {
    this.pollTimer = window.setTimeout(async () => {
      await this.sync();
      if (!this.disposed) this.poll();
    }, 2000);
  }
  private suggestedButton(a:Action,format=false,presentation?:Record<string,Emphasis>){const e=(presentation??(format?this.formatEmphasis:this.emphasis))[a.id]??{variant:'secondary',size:'medium',tier:'peer',reason:'No clear leader'};return html`<en-button id=${this.dockId("still-help-"+a.id)} data-action-id=${a.id} data-tier=${e.tier} data-action-source=${!format&&a.id==='context'&&isIdeaPage(this.decisionPosition())?DOCUMENT_RETURN_REASON:this.decisionSource==='jev'&&e.score!==undefined?'Jev ranking':'Local fallback'} data-emphasis-reason=${e.reason} variant=${e.variant} size=${e.size} .disabled=${this.busy||this.composing} @click=${()=>format?void this.selectGenerationFormat(a.id):this.choose(a.id)}>${a.label}</en-button>${this.help("still-help-"+a.id,a.label)}`;}
  private secondaryOnly(){return ['refresh-generation',...(this.decisionPosition().generation?.mayDuplicateCharge?['generate-again','create',...Object.keys(FORMATS)]:[])];}
  private toolbarPolicy(){const choice=this.nextBestAssessment();return {view:this.client.position.view,emptyProject:this.emptyProject(),more:this.moreOpen,secondaryOnly:this.secondaryOnly(),nextBest:choice.accepted?choice.choice:undefined};}
  private toolbarSuggestions(actions:Action[]){const emphasis=presentToolbar(actions.map(a=>a.id),this.emphasis,this.toolbarPolicy());return actions.map(a=>this.suggestedButton(a,false,emphasis));}
  private paletteShortcut=(event:KeyboardEvent)=>{
    if(event.isComposing||event.keyCode===229)return;
    if((event.metaKey||event.ctrlKey)&&!event.altKey&&event.key.toLowerCase()==='k'){
      event.preventDefault();if(event.repeat)return;if(this.paletteOpen)this.closeFinder();else this.openFinder('shortcut');
    }
  };
  private openMore(event:MouseEvent){
    this.attention?.summary.explore('more');this.toolbarSeen=this.visibleToolbarActions();this.dockTouched=true;
    this.client.position.recentActions=[...this.client.position.recentActions,'ui:more'].slice(-12);
    void this.replaceToolbar(true,event);
  }
  private async replaceToolbar(more:boolean,event?:MouseEvent){
    if(this.toolbarMotion){
      ++this.toolbarHelpEpoch;
      await this.toolbarMotion.page(async()=>{this.moreOpen=more;this.changed();await this.updateComplete;},more?'more':'back',event?.detail===0);
      return;
    }
    const keyboard=event?.detail===0;
    const scope=this.interactionScope();
    const parkFocus=()=>{
      const dock=this.querySelector<HTMLElement>('.action-dock');
      // A non-tab-stop before the controls preserves the next Tab destination without opening help.
      if(dock){dock.tabIndex=-1;dock.focus({preventScroll:true});}
    };
    parkFocus();
    for(const tip of this.querySelectorAll<HTMLElement & {open:boolean}>('.action-dock en-tooltip'))tip.open=false;
    // Replace the outgoing help instances too, releasing their pending timers and group membership.
    ++this.toolbarHelpEpoch;
    this.moreOpen=more;this.changed();
    await this.updateComplete;
    if(this.disposed||scope!==this.interactionScope()||this.moreOpen!==more)return;
    if(keyboard){
      const target=this.querySelector<HTMLElement>(more?'.action-dock en-button':'.action-dock [data-action-id="ui:more"]')
        ??this.querySelector<HTMLElement>('.action-dock en-button');
      target?.focus({preventScroll:true});
    }else parkFocus();
  }
  private visibleToolbarActions(){return [...this.querySelectorAll<HTMLElement>('.action-dock [data-action-id]')].map(e=>e.dataset.actionId!).filter(id=>this.candidates().some(a=>a.id===id));}
  private paletteOptions(){return paletteActions(this.paletteQuery,this.candidates(),this.paletteOrder,this.listOptions()).filter(a=>this.desktop.matches||a.id!=='ui:developer');}
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
    if(this.runListAction(id))return;
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
  private button(label: string, action: (event:MouseEvent) => void, primary = false, disabled = false, actionId='', variant:Emphasis['variant']=primary?'primary':'ghost',source='') { const helpId="still-help-"+(actionId||label.toLowerCase().replaceAll(" ","-"));return html`<en-button id=${this.dockId(helpId)} data-action-id=${actionId} data-action-source=${source} form=${!this.measuringDock&&actionId==='workflow:save'&&this.isCreationMode()?'still-create-form':nothing} size="medium" variant=${variant} .disabled=${this.busy || this.composing || disabled} @click=${action}>${label}</en-button>${this.help(helpId,label)}`; }
  private field(label: string, value: string, change: (v: string) => void, rows = 3, placeholder = '') { if(rows===1)return html`<en-text-field label=${label} .value=${live(value)} placeholder=${placeholder} .disabled=${this.busy || !!this.generation?.attempted} @en-input=${(e: CustomEvent<{value:string;isComposing:boolean}>)=>{change(e.detail.value);this.composing=e.detail.isComposing;if(!this.composing)this.changed();}}></en-text-field>`; return html`<en-textarea label=${label} .value=${live(value)} rows=${rows} placeholder=${placeholder} .disabled=${this.busy || !!this.generation?.attempted} @en-input=${(e: CustomEvent<{ value: string; isComposing: boolean }>) => { change(e.detail.value); this.composing = e.detail.isComposing; if (!this.composing) this.changed(); }}></en-textarea>`; }
  private closeMode() { this.toolbarMotion?.ensure();if (this.mode === 'generate') this.client.position.intent = ''; this.resetStep();this.error='';this.writeRoute();this.decide();this.focusContent(); }
  private begin(mode: string, updateURL=true) {
    if(mode==='surprise')mode='add-context'; // Legacy entry points use the ordinary idea form.
    if(mode==='actions'){this.routeMode='actions';this.openFinder();if(updateURL)this.writeRoute();return;}
    this.toolbarDecisionSettled=false;this.toolbarDecisionPending=false;this.decisionMemory.clearPending();this.toolbarDecisionAbort?.abort();this.toolbarMotion?.ensure();
    this.moreOpen=false;
    this.developerPending=false;
    this.pendingBlock = null; this.mode = mode;this.routeMode=mode; ++this.decisionTicket; clearTimeout(this.decisionTimer); this.error = ''; this.choice = ''; this.titleDraft = ''; this.bodyDraft = ''; this.kindDraft = 'direction';
    if (mode === 'edit-block') { const block = this.client.projection.libraryBlocks.find(b => b.id === this.client.position.blockId); this.bodyDraft = text(block?.properties.text); this.titleDraft = block?.handle ?? ''; this.kindDraft = block?.type ?? 'message'; this.editBase = { text: text(block?.properties.text) };this.richEditIssue='';this.richBodyDraft=undefined;this.preferenceDraft=Array.isArray(block?.properties.preferred_output_kinds)?block!.properties.preferred_output_kinds as OutputKind[]:[];try{this.richBodyDraft=block&&Object.hasOwn(block.properties,'rich_text_body')?decodeIdeaBody(block.properties.rich_text_body):plainTextIdeaBody(this.bodyDraft);}catch(error){this.richEditIssue=error instanceof Error?error.message:'Open this Idea in a compatible editor.';} }
    if (mode === 'rename') { this.titleDraft = this.client.projection.documentTitle; this.editBase = { title: this.titleDraft }; }
    if (mode === 'intent') this.bodyDraft = this.client.position.intent;
    if (mode === 'clarify') { this.mode = 'add-context'; this.titleDraft = 'The heart of it'; this.kindDraft = 'direction'; }
    if (mode === 'edit-artifact') { const a = this.client.projection.artifacts.find(x => x.id === this.client.position.outputId); const content = parseDocumentArtifactContent(a?.contentRef ? this.client.content[a.contentRef] : undefined); this.editBase = { revision: a ? documentArtifactRevision(this.client.events, a.id) : 0, ...(a && ['slides','storyboard'].includes(a.kind) ? {item:this.itemIndex} : {}) }; this.bodyDraft = this.editBase.item !== undefined ? (content?.items[this.itemIndex]?.body ?? a?.items[this.itemIndex]?.body ?? '') : content?.content_markdown ?? a?.items.map(i => `## ${i.title}\n\n${i.body}`).join('\n\n') ?? ''; }
    this.draftBaseline=this.draftSignature();if(updateURL)this.writeRoute();this.changed(); this.focusContent();
  }
  private choose(id: string) {
    if (this.busy || this.composing) return;
    this.toolbarDecisionSettled=false;
    if(!id.startsWith('ui:')&&!this.candidates().some(a=>a.id===id)){this.error='Action changed. Choose another step.';this.dockTouched=false;this.decide();return;}
    if(id==='use-in')this.useInTarget=this.suggestionTargets[id]??'';
    if(id==='ui:developer'){this.closeMode();this.setDeveloper(true);return;}
    this.client.position.recentActions = [...this.client.position.recentActions, id].slice(-12);
    if (id === 'inspect-rejection') return this.navigate('rejection',{outputId:this.client.position.outputId});
    if (id === 'view-output') return this.navigate('generation',{outputId:this.client.position.outputId});
    if (id === 'refresh-generation') return void this.refreshGenerationStatus();
    if (id === 'generate-again') return void this.generateAgain(this.client.position.outputId);
    if (id === 'projects') return this.navigate('projects', { projectId: '', documentId: '' });
    if (id === 'ideas') return this.navigate('ideas', { documentId: '' });
    if (id === 'documents') return this.navigate('documents', { documentId: '' });
    if (id === 'context') return this.navigate('document');
    if (id === 'results') return this.navigate('results');
    if (id === 'export') { void this.run(() => this.exportWork()); return; }
    if (['lock', 'unlock', 'toggle-context'].includes(id)) {
      void this.run(async () => { const b = this.client.projection.blocks.find(x => x.id === this.client.position.blockId); if (!b) return; await this.client.append([{ type: id === 'toggle-context' ? 'BlockWeightSet' : id === 'lock' ? 'BlockLocked' : 'BlockUnlocked', payload: { block_id: b.id, ...(id === 'toggle-context' ? { weight: Number(b.properties.weight ?? 1) > 0 ? 0 : .8, previous_weight: b.properties.weight ?? 1 } : {}) } }]); this.notice = 'Updated.';this.closeMode(); }); return;
    }
    if (id === 'create' || FORMATS[id]) {
      this.generation = null; this.generationDrafts.clear(); this.generationGate = null; this.formatSuggestions = []; this.nextBest=undefined; this.formatTouched = false;
      try {
        const format = this.client.pendingGeneration?.format ?? (id === 'create' ? '' : id);
        if (format && (id==='create'||this.client.pendingGeneration)) this.generation = this.client.prepareGeneration(format);
      } catch (error) { this.error = error instanceof Error ? error.message : 'Format unavailable.'; this.changed(); return; }
      if(id!=='create'&&!this.client.pendingGeneration){this.generation=null;this.begin('generate');void this.selectGenerationFormat(id);return;}
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
      if (!menu.open && menu.isConnected && this.mode === 'generate' && !this.generation) void this.selectGenerationFormat(format);
    });
  };
  private rememberCompletion(action:string){this.client.position.recentActions=[...this.client.position.recentActions.filter(a=>!a.startsWith('completed:')),`completed:${action}`].slice(-12);}
  private async startGeneration(format:string) {
    if(this.busy||this.composing||this.directGeneration||this.generation?.attempted)return;
    this.directGeneration=true;this.formatTouched=true;
    try {
      await this.run(async()=>{
        this.generation=this.client.prepareGeneration(format);
        this.client.position.recentActions=[...this.client.position.recentActions.filter(a=>!a.startsWith('format-choice:')),`format-choice:${format}`].slice(-12);
        this.generationGate=null;this.draftBaseline=this.draftSignature();
        await this.generate();
      });
    } finally {this.directGeneration=false;this.changed();}
  }
  private selectGenerationFormat(format:string) {
    if(this.busy||this.composing||this.generation?.attempted)return;
    this.formatTouched=true;
    this.chooseFormat(format);
  }
  private chooseFormat(format: string) {
    if (this.busy || this.composing || this.generation?.attempted) return;
    this.toolbarDecisionPending=false;this.toolbarDecisionSettled=false;this.decisionMemory.clearPending();this.toolbarDecisionAbort?.abort();this.toolbarMotion?.ensure();
    try {
      if(this.generation)this.generationDrafts.set(this.generation.format,this.generation);
      const fresh=format?this.client.prepareGeneration(format):null;
      const saved=this.generationDrafts.get(format);
      this.generation=fresh&&saved&&fresh.scopeKey===saved.scopeKey&&fresh.documentId===saved.documentId&&fresh.sourceRevision===saved.sourceRevision?saved:fresh;
      this.generationGate=null;this.error='';
      if(format)this.client.position.recentActions=[...this.client.position.recentActions.filter(a=>!a.startsWith('format-choice:')),`format-choice:${format}`].slice(-12);
    } catch(error) {this.error=error instanceof Error?error.message:'Format unavailable.';}
    this.changed();this.writeRoute();this.draftBaseline=this.draftSignature();this.focusContent();
  }
  private generationBack() {
    if(this.generation&&!this.generation.attempted){this.chooseFormat('');return;}
    this.closeMode();
  }
  private unifiedCreation(){return this.isCreationMode()&&this.client.session?.creation?.enabled===true;}
  private isCreationMode(){return ['new-project','new-document','add-context'].includes(this.mode);}
  private writeRecoveryKey(){return `${this.client.scopeKey}:${this.client.epoch}:${this.mode}:${this.client.pendingWriteId}`;}
  private renderWriteRecovery(){return this.client.hasUnconfirmedWrite ? html`<p class="gate-notice" role="status">${this.writeRecovery?.key===this.writeRecoveryKey()?'The earlier save is still unconfirmed. You can edit this draft. Choose Save draft to submit your current changes, or Back to review saved work. The earlier save may still exist; saving again could create a duplicate.':'You can keep editing this draft. Check save looks for the earlier save without submitting your changes.'}</p>` : nothing;}
  private async checkSave(){
    const key=this.writeRecoveryKey();this.writeRecovery=undefined;
    const result=await this.client.checkPendingSave();
    if(result.confirmed){this.pendingBlock=null;this.notice='The earlier save is confirmed. Review your saved work before saving again.';this.focusContent();}
    else if(key===this.writeRecoveryKey())this.writeRecovery={key,correlationId:result.correlationId};
    this.changed();
  }
  private async saveUnconfirmedDraft(){
    const recovery=this.writeRecovery;
    if(!recovery||recovery.key!==this.writeRecoveryKey())return;
    this.validateSaveDraft();
    const result=await this.client.startNewSave(recovery.correlationId);
    this.writeRecovery=undefined;this.pendingBlock=null;
    if(result.confirmed){this.notice='The earlier save is confirmed. Your current draft has not been submitted. Review the saved work before saving again.';this.changed();return;}
    await this.save();
  }
  // En Reve buttons use type="button"; bind their toolbar action to the form here.
  private requestCreationSubmit(){
    if(!this.isCreationMode()||this.busy||this.composing)return;
    this.querySelector<HTMLFormElement>('#still-create-form')?.requestSubmit();
  }
  private submitCreation=(event:SubmitEvent)=>{
    event.preventDefault();
    if(!this.isCreationMode()||event.target!==this.querySelector('#still-create-form'))return;
    void this.run(()=>this.save());
  };
  private creationKeydown=(event:KeyboardEvent)=>{
    // The text field's native input is in a shadow root, so bridge implicit submission.
    // Textareas keep Enter for newlines; composition and modified keys remain untouched.
    if(event.defaultPrevented||event.key!=='Enter'||event.isComposing||event.keyCode===229||event.repeat||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return;
    if(!event.composedPath().some(node=>node instanceof HTMLElement&&node.localName==='en-text-field'))return;
    event.preventDefault();this.requestCreationSubmit();
  };
  private validateSaveDraft(){
    if(['new-project','new-document','rename'].includes(this.mode)&&!this.titleDraft.trim())throw new Error('Enter a name.');
    if(this.mode==='add-context'&&!this.bodyDraft.trim())throw new Error('Add an idea.');
    if(this.mode==='edit-block'){if(this.richEditIssue)throw new Error(this.richEditIssue);const block=this.client.projection.libraryBlocks.find(b=>b.id===this.client.position.blockId);if(!block||block.locked)throw new Error('Idea is not editable.');}
    if(this.mode==='reuse'&&!this.client.projection.libraryBlocks.some(b=>b.id===this.choice))throw new Error('Choose an idea.');
    if(this.mode==='edit-artifact'&&this.missingWriting())throw new Error('Wait for the writing to load.');
  }
  private async save() {
    const c = this.client, p = c.projection;
    if(c.hasUnconfirmedWrite){await this.checkSave();return;}
    if (this.mode === 'new-project' || this.mode === 'new-document') {
      if (!this.titleDraft.trim()) throw new Error('Enter a name.');
      if(this.mode==='new-project') {
        const ids=await c.createProject(this.titleDraft.trim());
        this.navigate('documents',{...ids,documentId:''});
      } else this.navigate('document',await c.createDocument(this.titleDraft.trim(),this.bodyDraft.trim()));
    } else if (this.mode === 'add-context') {
      if (!this.bodyDraft.trim()) throw new Error('Add an idea.');
      if (!c.hasUnconfirmedWrite || !this.pendingBlock) { const event = c.blockEvent(this.bodyDraft, this.titleDraft.trim() || 'A thought', this.kindDraft); if(this.pendingBlock) Object.assign(event.payload,{block_id:this.pendingBlock.payload.block_id,position:this.pendingBlock.payload.position}); this.pendingBlock = event; }
      await c.append([this.pendingBlock]); this.rememberCompletion(this.mode);this.closeMode();
    } else if (this.mode === 'edit-block') {
      const b = p.libraryBlocks.find(x => x.id === c.position.blockId); if (!b || b.locked) throw new Error('Idea is not editable.');
      if(this.richEditIssue||!this.richBodyDraft)throw new Error(this.richEditIssue||'Open this Idea in a compatible editor.');
      const body=decodeIdeaBody(this.richBodyDraft),bodyText=ideaBodyText(body);if(!bodyText.trim())throw new Error('Add an Idea body before saving.');
      const properties={...b.properties,text:bodyText,rich_text_body:body,...(Object.hasOwn(b.properties,'preferred_output_kinds')?{preferred_output_kinds:this.preferenceDraft}:{})};
      const preference=validateFormatOutputPreferences({...b,properties});if(!preference.valid)throw new Error(preference.issues.join(' '));
      await c.append([{ type: 'BlockPropertyEdited', payload: { project_id:b.projectId,block_id: b.id, property_path: 'text', old_value: this.editBase.text ?? '', new_value: bodyText } },{type:'BlockPropertyEdited',payload:{project_id:b.projectId,block_id:b.id,property_path:'rich_text_body',old_value:b.properties.rich_text_body??null,new_value:body}},...(Object.hasOwn(b.properties,'preferred_output_kinds')?[{type:'BlockPropertyEdited',payload:{project_id:b.projectId,block_id:b.id,property_path:'preferred_output_kinds',old_value:b.properties.preferred_output_kinds,new_value:this.preferenceDraft}}]:[])]); this.rememberCompletion('edit-block');this.closeMode();
    } else if (this.mode === 'rename') {
      if (!this.titleDraft.trim()) throw new Error('Enter a name.');
      await c.append([{ type: 'DocumentRenamed', payload: { document_id: p.documentId, old_title: this.editBase.title ?? p.documentTitle, new_title: this.titleDraft.trim() } }]); this.closeMode();
    } else if (this.mode === 'intent') { c.position.intent = this.bodyDraft.trim(); this.closeMode(); return; }
    else if (this.mode === 'edit-artifact') { if (this.missingWriting()) throw new Error('Wait for the writing to load.'); await c.editArtifact(c.position.outputId, this.editBase.item !== undefined ? (parseDocumentArtifactContent(c.content[p.artifacts.find(a => a.id === c.position.outputId)?.contentRef ?? ''])?.content_markdown ?? '') : this.bodyDraft, this.editBase.revision ?? 0, this.editBase.item !== undefined ? [{index:this.editBase.item,body:this.bodyDraft}] : undefined); this.closeMode(); }
    else if (this.mode === 'reuse') { const b=p.libraryBlocks.find(x=>x.id===this.choice);if(!b)throw new Error('Choose an idea.');const events=attachIdeaEvents(b,c.position.documentId,p.libraryBlocks,p.libraryBlockRelations);if(events.length)await c.append(events);this.rememberCompletion(this.mode);this.closeMode(); }
    this.notice = 'Saved.'; this.changed(); this.decide();
  }
  private async generate() {
    const draft = this.generation; if (!draft) return;
    if(!draft.attempted)validateGenerationOptions(draft);
    const inlineKey=this.inlineGenerationKey;
    if(draft.recoveryClosed){this.generation=this.client.reviewNewGeneration(draft);this.generationGate=null;this.notice='Review this new request before generating.';this.changed();return;}
    if (!draft.attempted && draft.format === 'scene' && !draft.scenePreview) { const quote = await this.client.previewScene(draft); if (quote) draft.scenePreview = quote; this.changed(); return; }
    if (this.generationGate && !this.generationGate.key) return;
    if (this.generationGate?.key) { draft.acknowledgements = { ...draft.acknowledgements, [this.generationGate.key]: true }; this.generationGate = null; }
    try { const job=await this.client.generate(draft); if(inlineKey&&(!this.isInlineGeneration()||inlineKey!==this.inlineGenerationKey))return;this.navigate('generation',{outputId:job.jobId}); }
    catch (error) {
      if(inlineKey&&(!this.isInlineGeneration()||inlineKey!==this.inlineGenerationKey))return;
      const review = error instanceof ApiError ? generationReview(error.status, error.body) : null;
      if (review) {
        this.generationGate = review; ++this.reviewVersion;
        this.changed();
        await this.updateComplete;
        this.querySelector<HTMLElement>(inlineKey?'.generation-inline-review':'.generation-notifications')?.focus();
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
    if (a.kind === 'model3d') { const file = model3dArtifactMediaFile(a); void import('./model-view.ts'); return html`<div data-attention-id=${`result:${a.id}`} class="model-stage">${stillMediaHeading('3D model',a.title)}<still-model-view src=${safeMedia(file?.url)}></still-model-view><p class="caption">Drag to rotate</p></div>`; }
    if (a.kind === 'video' || a.kind === 'audio') return html`<div data-attention-id=${`result:${a.id}`} class=${`media-stage ${a.kind}`}>${stillMediaHeading(FORMATS[a.kind]??a.kind,a.title)}${a.kind === 'video' ? stillVideo(safeMedia(a.mediaUrl ?? item?.mediaUrl),a) : html`<still-audio-player .src=${safeMedia(a.mediaUrl ?? item?.mediaUrl)} .label=${a.title} .scope=${`${this.client.scopeKey}:${this.client.epoch}`} .cacheScope=${this.client.scopeKey}></still-audio-player>`}${a.summary ? html`<p>${a.summary}</p>` : nothing}</div>`;
    if ((a.kind === 'slides' || a.kind === 'storyboard') && item) return html`<article data-attention-id=${`result:${a.id}:item:${this.itemIndex}`} class="slide" style=${`--slide-bg:${/^#[a-f\d]{3,8}$/i.test(a.presentation?.palette.background ?? '') ? a.presentation?.palette.background : 'var(--en-color-surface-subtle)'};--slide-fg:${/^#[a-f\d]{3,8}$/i.test(a.presentation?.palette.foreground ?? '') ? a.presentation?.palette.foreground : /^#[a-f\d]{3,8}$/i.test(a.presentation?.palette.background ?? '') ? '#302f2b' : 'var(--en-color-text)'}`}>${stillMediaHeading(`${FORMATS[a.kind]} · ${this.itemIndex + 1} / ${a.items.length}`,item.title)}${safeMedia(item.mediaUrl) ? stillImage(safeMedia(item.mediaUrl),item.title,receipt,{loading:'eager'}) : nothing}<div><div class="prose">${this.prose(item.body)}</div></div></article>`;
    return html`<article data-attention-id=${`result:${a.id}`} class="writing"><span class="eyebrow">${FORMATS[a.kind] ?? 'Creative work'}</span><h1>${a.title}</h1><div class="prose">${this.prose(content?.content_markdown || a.items.map(x => `${x.title}\n\n${x.body}`).join('\n\n') || a.summary || 'Writing unavailable.')}</div></article>`;
  }
  private serviceReadyKey = '';
  private serviceReadyUntil = 0;
  private generationCheckKey() { const c=this.client;return `${c.scopeKey}/${c.epoch}/${c.position.documentId}/${c.position.outputId}`; }
  private isInlineGeneration() { return !!this.inlineGenerationKey&&this.client.position.view==='generation'&&this.inlineGenerationKey===this.generationCheckKey(); }
  private selectedGeneration() { const c=this.client;return c.jobs.find(j=>j.jobId===c.position.outputId&&j.documentId===c.position.documentId); }
  private canGenerateAgain(job:DocumentJob|undefined) {
    const c=this.client,format=job&&generationFormat(job);
    return !!format&&!!job&&generationOutcome(job).canStartNew&&(!generationOutcome(job).serviceBlocked||this.serviceReadyKey===this.generationCheckKey()&&Date.now()<this.serviceReadyUntil)&&c.abilities.generate&&c.abilities.formats.includes(format)&&!c.pendingGeneration&&!c.hasUnconfirmedWrite;
  }
  private async refreshGenerationStatus() {
    const key=this.generationCheckKey();
    await this.run(async()=>{
      this.generationCheck={key,message:'Checking status…'};this.changed();
      try {
        await this.client.refreshGeneration(this.selectedGeneration()!);await this.client.refresh();this.dockTouched=false;this.decide();
        if(key!==this.generationCheckKey()||!['generation','rejection'].includes(this.client.position.view))return;
        const job=this.selectedGeneration();
        if(job&&['completed','partial'].includes(job.status)&&this.client.position.view==='rejection'){this.navigate('generation',{outputId:job.jobId});return;}
        const status=!job?'This attempt is unavailable.':job.status==='failed'?'This attempt is still failed.':job.status==='canceled'?'This attempt is canceled.':job.status==='completed'?'This attempt is complete.':job.status==='partial'?'This attempt is partially complete.':'This attempt is still in progress.';
        this.generationCheck={key,message:`Status checked. ${status} No new generation was started.`};
      } catch {
        if(key===this.generationCheckKey())this.generationCheck={key,message:'Couldn’t refresh status. No new generation was started.'};
      }
    });
  }
  private async checkServiceReadiness() {
    const key=this.generationCheckKey();this.serviceReadyKey='';
    await this.run(async()=>{
      const readiness=await this.client.checkGenerationReadiness();
      if(key!==this.generationCheckKey())return;
      if(readiness.ready){this.serviceReadyKey=key;this.serviceReadyUntil=Date.now()+60_000;}
      const message=`${readiness.message} Checked at ${new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}.`;
      this.generationCheck={key,message};
      if(this.mode==='generate'){if(readiness.ready)this.notice=message;else{this.error=message;this.errorCode='generation_preparation_unavailable';}}
      this.changed();
    });
  }
  private reviewNewPaidGeneration(jobId:string) {
    const job=this.selectedGeneration();
    if(this.busy||this.composing||this.directGeneration||job?.jobId!==jobId||!this.canGenerateAgain(job))return;
    this.generationCheck=null;this.generation=null;this.inlineGenerationKey='';
    this.begin('generate');this.chooseFormat(generationFormat(job));
    const reviewed=this.generation as GenerationDraft|null;
    if(reviewed)this.generation={...reviewed,previousAttemptId:job.jobId,previousDocumentRevision:job.documentRevision??null};
    this.changed();
  }
  private generateAgain(jobId:string) {
    const job=this.selectedGeneration();
    if(this.busy||this.composing||this.directGeneration||job?.jobId!==jobId||!this.canGenerateAgain(job))return;
    const format=generationFormat(job)!;
    this.generationCheck=null;this.generation=null;
    if(format==='video'&&this.client.position.view==='generation'){this.inlineGenerationKey=this.generationCheckKey();this.generationGate=null;this.error='';}
    else this.begin('generate');
    return this.startGeneration(format);
  }
  private renderInlineGeneration() {
    if(!this.isInlineGeneration()||this.busy||this.directGeneration)return nothing;
    const draft=this.generation,review=this.generationGate;
    const message=this.busy||this.directGeneration?'Preparing new video…':review?.message||this.error||(draft?.recoveryClosed?'Review a new request before starting another.':draft?.attempted?'Check the new request before starting another.':draft?.previousUnconfirmed?'A new request may duplicate the earlier attempt. Review before generating.':'Ready to generate a new video.');
    return html`<section class="generation-inline-review" tabindex="-1" aria-label="New video request"><p role="status" aria-live="polite">${message}</p>${review?.issues.map(issue=>html`<p>${issue.summary}</p>`)}</section>`;
  }
  private canAcknowledgeSafety(job:DocumentJob|undefined) {
    return !!job&&documentJobCanAcknowledgeSafety(job)&&this.client.abilities.generate&&!this.client.pendingGeneration&&!this.client.hasUnconfirmedWrite;
  }
  private acknowledgeSafety(job:DocumentJob) {
    if(this.busy||this.composing||!this.canAcknowledgeSafety(job))return;
    void this.run(async()=>{await this.client.acknowledgeGenerationSafety(job);this.generationCheck=null;this.navigate('generation',{outputId:job.jobId});});
  }
  private generationRecoveryActions() {
    const job=this.selectedGeneration();
    const inline=this.isInlineGeneration(),draft=inline?this.generation:null,review=inline?this.generationGate:null;
    const outcome=job?generationOutcome(job):null;
    return [
      ...(outcome?.serviceBlocked?[{id:'ui:readiness',label:'Check service readiness',variant:this.canGenerateAgain(job)?'secondary' as const:'primary' as const,run:()=>void this.checkServiceReadiness()}]:[]),
      ...(outcome?.recovery&&this.client.abilities.generate?[{id:'ui:recover-generation',label:'Recover original result',variant:'primary' as const,run:()=>void this.run(async()=>{const key=this.generationCheckKey();await this.client.recoverGeneration(job!);if(key===this.generationCheckKey())this.navigate('generation',{outputId:job!.jobId});})}]:[]),
      ...(!inline&&this.canGenerateAgain(job)?[{id:'ui:new-generation',label:'Review new paid request',variant:outcome?.serviceBlocked?'primary' as const:'secondary' as const,run:()=>this.reviewNewPaidGeneration(job!.jobId)}]:[]),
      ...(inline?[{id:'ui:continue-generation',label:this.busy?'Preparing…':draft?.recoveryClosed?'Review new request':draft?.attempted?'Check request':review?(canContinueReview(review)?'Acknowledge & send':'Unavailable'):'Make new video',variant:'primary' as const,disabled:!draft||!!review&&!canContinueReview(review),run:()=>void this.run(()=>this.generate())}]:this.canAcknowledgeSafety(job)?[{id:'ui:acknowledge-safety',label:'Acknowledge & send',variant:'primary' as const,disabled:false,run:()=>this.acknowledgeSafety(job!)}]:[]),
      ...(review?[{id:'ui:review-context',label:'Review ideas',variant:'secondary' as const,run:()=>this.reviewContext()}]:[]),
      ...(!job||!generationActive(job)?[{id:'ui:refresh-generation',label:'Refresh status',variant:'secondary' as const,run:()=>void this.refreshGenerationStatus()}]:[]),
      ...(job&&this.client.position.view==='generation'&&['failed','partial'].includes(job.status)?[{id:'ui:inspect-generation',label:'Inspect attempt',variant:'secondary' as const,run:()=>this.navigate('rejection',{outputId:job.jobId})}]:[]),
      {id:'document',label:'View document',variant:'secondary' as const,run:()=>this.navigate('document')},
      {id:'results',label:'View results',variant:'secondary' as const,run:()=>this.navigate('results')},
      {id:'ui:palette',label:'Find action',variant:'ghost' as const,run:()=>this.openFinder('shortcut')},
    ];
  }
  private renderGenerationStatusDock() {
    if(this.busy||this.directGeneration)return this.renderBusyDock();
    const actions=this.generationRecoveryActions();
    const job=this.selectedGeneration(),format=job&&generationFormat(job);
    const status=this.client.position.view==='rejection'&&this.generationCheck?.key===this.generationCheckKey()?this.generationCheck.message:job&&generationActive(job)?`${job.status==='queued'?'Queued':job.status==='committing'?'Saving':'Generating'} ${(FORMATS[format!]??format).toLowerCase()}…`:'';
    if(this.toolbarLimit<3)return this.compactDock(this.moreOpen?[...actions.filter(a=>a.id!=='ui:palette').slice(Math.max(0,this.firstDockLimit-1)).map(a=>({...a,variant:'secondary' as const})),{id:'ui:back',label:'Back',variant:'ghost',run:()=>void this.replaceToolbar(false)},actions[actions.length-1]]:actions,'More actions',status);
    const choices=actions.filter(a=>a.id!=='ui:palette'),visible=choices.slice(0,(this.moreOpen?this.firstDockLimit:this.toolbarLimit)-1),remaining=choices.slice(visible.length,this.toolbarLimit-2+visible.length);
    const controls=this.moreOpen
      ? [...remaining.map(a=>this.button(a.label,a.run,false,'disabled' in a&&a.disabled,a.id,'secondary')),this.button('Back',event=>void this.replaceToolbar(false,event),false,false,'ui:back'),this.paletteButton('more')]
      : [...visible.map(a=>this.button(a.label,a.run,false,'disabled' in a&&a.disabled,a.id,a.variant)),this.button('More actions',event=>this.openMore(event),false,false,'ui:more')];
    return html`<footer class=${this.dockClass} @focusout=${()=>this.scheduleDockFit()}>${this.toolbarStatus(status)}<en-toolbar label="Your next step" keyboard-navigation="tab">${controls}</en-toolbar></footer>`;
  }
  private toolbarStatus(message:string) { return message?html`<span class="toolbar-status" role="status" aria-live="polite">${message}</span>`:nothing; }
  private renderBusyDock() {
    const message=this.generationCheck?.message==='Checking status…'?'Checking status…':this.directGeneration||this.isInlineGeneration()&&this.generation ? `Preparing ${(FORMATS[this.generation?.format??'video']??'generation').toLowerCase()}…` : this.client.position.view==='generation'?'Submitting request…':'Working…';
    return html`<footer class=${this.dockClass} @focusout=${()=>this.scheduleDockFit()}>${this.toolbarStatus(message)}</footer>`;
  }
  private renderGeneration() {
    const c=this.client,p=c.projection,job=c.jobs.find(j=>j.jobId===c.position.outputId&&j.documentId===p.documentId);
    if(!job||!generationFormat(job))return html`<section class="quiet-state"><h1>${c.jobsError?'Couldn’t load generation':c.jobsLoaded?'Generation unavailable':'Loading generation…'}</h1>${c.jobsError?this.button('Retry loading generations',()=>void this.run(()=>c.pollJobs())):nothing}</section>`;
    const active=generationActive(job),kind=generationFormat(job),preview=generationPreview(job,p,c.events),outcome=generationOutcome(job);
    if(active&&kind==='image'){const partial=imageGenerationProgress(job,p.documentId);return stillImageStage(preview.title,preview,partial?.mediaUrl||undefined,true);}
    return html`<section class="generation-stage"><span class="eyebrow">${FORMATS[kind]??kind}</span><h1>${preview.title}</h1>${preview.width&&preview.height?html`<p class="caption">${preview.width} × ${preview.height}</p>`:nothing}${job.status==='failed'&&!outcome.uncertain&&!outcome.recovery?html`<p class="caption">This attempt failed.</p>`:nothing}${active?nothing:html`<p role="status">${outcome.title}</p><p>${outcome.summary}</p>${outcome.facts.map(fact=>html`<p class="caption">${fact}</p>`)}<p>${outcome.next}</p>`}${active?html`<div class=${`generation-placeholder ${kind} ${preview.width?'known-size':''}`} style=${preview.width&&preview.height?`--generation-ratio:${preview.width/preview.height}`:nothing} aria-label="Generation in progress"><en-skeleton shape="rectangle"></en-skeleton></div>`:nothing}${this.canAcknowledgeSafety(job)?html`<p class="caption">Nothing is sent automatically. “Acknowledge & send” sends the reviewed request to the model and may incur usage. The provider can still decline it.</p>`:this.canGenerateAgain(job)?html`<p class="caption">A new generation uses your current document and allowance.</p>`:nothing}${this.generationCheck?.key===this.generationCheckKey()?html`<p class="caption" role="status" aria-live="polite">${this.generationCheck.message}</p>`:nothing}${typeof job.result?.previousAttemptId==='string'?html`<p class="caption"><a href=${this.viewURL('generation',{outputId:job.result.previousAttemptId})} @click=${(event:MouseEvent)=>this.follow(event,'generation',{outputId:String(job.result!.previousAttemptId)})}>View earlier attempt</a></p>`:nothing}${this.renderInlineGeneration()}</section>`;
  }
  private renderCanvas() {
    const c = this.client, p = c.projection, pos = c.position;
    if (this.loading) return html`<section class="quiet-state"><div class="still-mark" aria-hidden="true"></div><h1>Loading…</h1></section>`;
    if (this.startupFailed || !c.session) return html`<section class="quiet-state"><h1>Couldn’t load Still</h1></section>`;
    if (!c.session.policy.accepted) return html`<section class="form-page"><h1>Before you begin</h1><p>Your context is processed by generation providers and TypeSafe. Forma’s access and retention rules apply.</p><en-checkbox class="check" label="I have permission to use this content." .checked=${this.ownership} @en-change=${(e: CustomEvent<{proposed:boolean}>) => { this.ownership = e.detail.proposed; this.changed(); }}></en-checkbox><en-checkbox class="check" label="I consent to private provider processing." .checked=${this.providerConsent} @en-change=${(e: CustomEvent<{proposed:boolean}>) => { this.providerConsent = e.detail.proposed; this.changed(); }}></en-checkbox>${this.button('Continue', () => void this.run(async () => { await c.acceptTerms(); this.readRoute(); this.decide(); }), true, !this.ownership || !this.providerConsent)}</section>`;
    const routeProblem=this.currentRouteProblem(p);
    if (routeProblem) return html`<section class="quiet-state"><h1>${routeProblem}</h1>${this.button('Projects',()=>this.navigate('projects',{projectId:'',documentId:''}))}</section>`;
    if (this.mode) return this.renderMode();
    if(pos.view==='ideas'){
      const ideas=p.libraryBlocks.filter(b=>!b.removed&&(!pos.blockId||b.id===pos.blockId));
      return html`<article class="document-page"><span class="eyebrow">${p.projectName}</span><h1>${pos.blockId?ideas[0]?.handle??'Idea unavailable':'Ideas'}</h1>${this.renderList(ideas,(b,i)=>html`<a class="context-block" data-attention-id=${`block:${b.id}`} href=${this.viewURL('ideas',{documentId:'',blockId:pos.blockId?'':b.id})} @click=${(e:MouseEvent)=>this.follow(e,'ideas',{documentId:'',blockId:pos.blockId?'':b.id})}><span class="block-index">${String(i+1).padStart(2,'0')}</span><div><span class="block-label">${b.handle}${b.locked?' · locked':''}</span>${safeMedia(text(b.properties.media_url))&&b.type==='reference'&&(!b.properties.media_type||text(b.properties.media_type).startsWith('image/'))?stillImage(safeMedia(text(b.properties.media_url)),b.handle,b.properties,{className:'context-reference'}):nothing}<p>${text(b.properties.text)||text(b.properties.description)||text(b.properties.label)||(b.properties.media_url||b.properties.model_url?'File reference':'Empty idea')}</p><small>${ideaDocumentUses(b).filter(u=>p.documents.some(d=>d.id===u.documentId)).map(u=>p.documents.find(d=>d.id===u.documentId)?.title).join(' · ')||'Project idea'}</small></div></a>`,'context-blocks')}${!ideas.length?html`<p class="empty-copy">No ideas yet.</p>`:nothing}${pos.blockId?html`<p class="idea-sharing-note">Edits to this idea are shared wherever it is used.</p>`:nothing}</article>`;
    }
    if (pos.view === 'projects' || pos.view === 'documents') {
      const projects = pos.view === 'projects', items = projects ? p.projects.map(x => ({ id: x.id, title: x.name, detail: `${x.documentCount} ${x.documentCount === 1 ? 'document' : 'documents'}` })) : p.documents.filter(d => !d.removed).map(d => ({ id: d.id, title: d.title, detail: sharedIdeaOutputNotices(p,c.events).some(n=>n.documentId===d.id)?'Output out of date':'' }));
      return html`<section class="library-page">${projects ? nothing : html`<span class="eyebrow">${p.projectName}</span>`}<h1>${projects ? 'Projects' : 'Documents'}</h1>${this.renderList(items,(x, i) => html`<a data-attention-id=${`${projects?'project':'document'}:${x.id}`} class="work-row" href=${projects?this.viewURL('documents',{projectId:x.id,documentId:''}):this.viewURL('document',{documentId:x.id})} @click=${(e:MouseEvent)=>projects?this.follow(e,'documents',{projectId:x.id,documentId:''}):this.follow(e,'document',{documentId:x.id})}><span class="work-number">${String(i + 1).padStart(2, '0')}</span><span><strong>${x.title}</strong>${x.detail ? html`<small>${x.detail}</small>` : nothing}</span><en-icon class="row-arrow" name="arrow-right" aria-hidden="true"></en-icon></a>`,'work-list')}${!items.length ? html`<p class="empty-copy">${projects ? 'No projects yet.' : this.client.abilities.author ? 'Create a document to collect your ideas.' : 'No documents yet.'}</p>` : nothing}</section>`;
    }
    if (pos.view === 'results') {
      const results = stillResults(p,c.jobs,c.events);
      return html`<section class="results-page"><span class="eyebrow">${p.documentTitle}</span><h1>Results</h1>${this.renderList(results,r => html`<a data-attention-id=${`result:${r.id}`} class="result" href=${this.viewURL(r.view,{outputId:r.id})} @click=${(e:MouseEvent)=>this.follow(e,r.view,{outputId:r.id})}>${stillResultThumbnail(html`${r.job?html`<div class="pending-thumbnail">${generationActive(r.job)?html`<en-skeleton shape="rectangle"></en-skeleton>`:nothing}<span>${FORMATS[r.kind]??r.kind}</span></div>`:r.kind==='video'&&safeMedia(r.url)?stillVideoCover(safeMedia(r.url),r.title):safeMedia(r.url) ? stillImage(safeMedia(r.url),r.title,r) : html`<div class="result-word">${FORMATS[r.kind]}</div>`}`,r.focalPoint)}<span>${r.title}${r.job?html`<small>${generationStatus(r.job)}</small>`:nothing}</span></a>`,'result-grid')}${!results.length ? html`<p>${c.jobsError?'Couldn’t load generations.':c.jobsLoaded?'No results yet.':'Loading generations…'}</p>`:nothing}${c.jobsError?this.button('Retry loading generations',()=>void this.run(()=>c.pollJobs())):nothing}</section>`;
    }
    if(pos.view==='rejection')return keyed(this.generationCheckKey(),html`<still-rejection-page .client=${c} .scope=${`${this.generationCheckKey()}/${this.selectedGeneration()?.updatedAt??''}/${this.selectedGeneration()?.status??''}`}></still-rejection-page>`);
    if(pos.view==='generation')return this.renderGeneration();
    if (pos.view === 'artifact') {
      const a = p.artifacts.find(x => x.id === pos.outputId), o = p.outputs.find(x => x.id === pos.outputId);
      return a ? this.renderArtifact(a) : o ? html`<div data-attention-id=${`result:${pos.outputId}`}>${stillImageStage(o.title??p.documentTitle,o,safeMedia(o.mediaUrl))}</div>` : html`<section class="quiet-state"><h1>Result unavailable</h1></section>`;
    }
    return html`<article class="document-page"><span class="eyebrow">${p.projectName}</span><h1>${p.documentTitle}</h1>${documentOutputPreferenceSummary(p.blocks)?html`<p class="context-preview">${documentOutputPreferenceSummary(p.blocks)}</p>`:nothing}${this.renderList(p.blocks.filter(b => !b.removed),(b, i) => html`<a data-attention-id=${`block:${b.id}`} aria-current=${pos.blockId===b.id?'true':nothing} href=${this.viewURL('document',{blockId:pos.blockId===b.id?'':b.id})} class=${`context-block ${pos.blockId === b.id ? 'selected' : ''} ${Number(b.properties.weight ?? 1) <= 0 ? 'inactive' : ''}`} @click=${(e:MouseEvent)=>this.follow(e,'document',{blockId:pos.blockId===b.id?'':b.id})}><span class="block-index">${String(i + 1).padStart(2, '0')}</span><div><span class="block-label">${text(b.properties.label) || b.handle || b.type}${p.blockRelations.filter(r=>!r.removed&&r.toBlockId===b.id&&isContextCompositionRelation(r.kind)).map(r=>` · part of ${p.blocks.find(parent=>parent.id===r.fromBlockId)?.handle??'a group'}`).join('')}${b.locked ? ' · locked' : ''}${Number(b.properties.weight ?? 1) <= 0 ? ' · excluded' : ''}</span>${safeMedia(text(b.properties.media_url)) && b.type === 'reference' && (!b.properties.media_type||text(b.properties.media_type).startsWith('image/')) ? stillImage(safeMedia(text(b.properties.media_url)),b.handle,b.properties,{className:'context-reference'}) : nothing}<p>${text(b.properties.text) || text(b.properties.description) || (b.properties.media_url||b.properties.model_url?'File reference':'Empty idea')}</p></div></a>`,'context-blocks')}${p.blocks.filter(b=>!b.removed&&b.id===pos.blockId&&safeMedia(text(b.properties.model_url??b.properties.media_url))).map(b=>html`<a class="source-link" href=${safeMedia(text(b.properties.model_url??b.properties.media_url))} target="_blank" rel="noopener noreferrer"><en-icon name="file" aria-hidden="true"></en-icon> Open file</a>`)}${!p.blocks.filter(b => !b.removed).length ? html`<div class="blank-page"><span class="pencil-line" aria-hidden="true"></span><p>Add an idea.</p></div>` : nothing}</article>`;
  }
  private renderMode() {
    const mode = this.mode, p = this.client.projection;
    if(this.unifiedCreation())return keyed(`${this.client.scopeKey}/${p.projectId}/${p.documentId}/${mode}`,html`<still-creation-flow data-toolbar-scope=${this.workflowScope()} .client=${this.client} .entryKind=${mode==='new-project'?'project':mode==='new-document'?'document':'idea'} @workflow-toolbar-change=${()=>this.changed()} @creation-back=${()=>this.closeMode()} @creation-open=${(event:CustomEvent<{id:string;kind:string;projectId:string;locations?:{documentId?:string}[]}>)=>{const item=event.detail;void this.run(async()=>{const shared=this.client.session?.projects?.find(project=>project.projectId===item.projectId);if(shared&&this.client.session?.projectContext?.projectId!==item.projectId)await this.client.switchWorkspace(shared);this.navigate(item.kind==='project'?'documents':item.kind==='document'?'document':'ideas',{projectId:item.projectId,documentId:item.kind==='document'?item.id:'',blockId:item.kind==='idea'?item.id:''});});}} @creation-done=${(event:CustomEvent<import('../model/creation.ts').CreationReceipt>)=>{const receipt=event.detail;void this.run(async()=>{await this.client.refresh();this.navigate(receipt.primaryDocumentId?'document':mode==='new-project'?'documents':'ideas',{projectId:receipt.projectId,documentId:receipt.primaryDocumentId??'',blockId:''});this.notice='Saved.';});}}></still-creation-flow>`);
    if (mode==='edit-artifact' && this.missingWriting()) return this.renderWritingLoad();
    if(mode==='use-in')return keyed(`${this.interactionScope()}/${this.client.position.blockId}/use-in`,html`<still-use-in-flow data-toolbar-scope=${this.workflowScope()} @workflow-toolbar-change=${()=>this.changed()} .client=${this.client} .suggestedTarget=${this.useInTarget} @context-back=${()=>this.closeMode()} @use-in-done=${(e:CustomEvent<{projectId:string;documentId:string;blockId:string}>)=>{this.navigate('document',{projectId:e.detail.projectId,documentId:e.detail.documentId,blockId:e.detail.blockId});this.notice='Saved.';}}></still-use-in-flow>`);
    if (['split-context','research-context','find-references','supply-reference','compose'].includes(mode)) return keyed(`${this.client.scopeKey}/${p.projectId}/${p.documentId}/${this.client.position.blockId}/${mode}`,html`<still-context-flow data-toolbar-scope=${this.workflowScope()} @workflow-toolbar-change=${()=>this.changed()} .client=${this.client} .action=${mode} .suggestedTarget=${this.suggestionTargets[mode]??''} @context-select=${(e:CustomEvent<string>)=>{this.navigate('document',{blockId:e.detail});this.begin(mode);}} @context-back=${()=>this.closeMode()} @context-done=${()=>{this.rememberCompletion(mode);this.notice='Saved.';this.closeMode();}}></still-context-flow>`);
    if (mode === 'generate') {
      const g = this.directGeneration?null:this.generation;
      const source = g?.sourceSnapshot ?? documentSnapshot(p, p.documentId);
      const issues = this.generationGate?.issues ?? [];
      const visibleFacts = source.facts.filter(b => b.active || issues.some(i => issueAffectsBlock(i, b)));
      return html`<section class="form-page generation-page">
        <span class="eyebrow">${p.documentTitle} · Step ${g?2:1} of 2</span><h1>${g?`Configure ${FORMATS[g.format].toLowerCase()}`:'Choose output'}</h1>${!g?html`<p class="context-preview">${documentOutputPreferenceSummary(p.blocks)}</p>${preferredOutputChoices(p.blocks,this.client.abilities.formats as import('../model/document-output-intent.ts').OutputKind[]).filter(option=>!option.available).map(option=>html`<p class="cost-note">${option.label} is preferred but unavailable in this workspace.</p>`)}`:nothing}
        ${g?renderGenerationOptions(g,this.busy||!!g.attempted,isComposing=>{if(isComposing!==undefined)this.composing=isComposing;this.generationGate=null;this.changed();}):nothing}
        ${g?.format==='image'&&this.generationGate?.inspection?keyed(`${this.generationGate.inspection.documentId}/${this.generationGate.inspection.preflightId}`,html`<still-source-advisory-inspector .selection=${this.generationGate.inspection}></still-source-advisory-inspector>`):nothing}
        ${g?.previousAttemptId?html`<p class="cost-note">This is a new paid request linked to attempt ${g.previousAttemptId}. ${g.previousDocumentRevision?(g.previousDocumentRevision===g.sourceRevision?'The recorded document revision is unchanged.':'Your current document differs from the original attempt’s recorded revision.'):'The original document revision is unavailable, so changes cannot be verified.'} This request uses your current document; it does not recreate missing original inputs.</p>`:nothing}
        <details class="generation-source" ?open=${!g||!!issues.length}><summary>Document context</summary><div class="generation-context">${visibleFacts.map(b => { const warnings = issues.filter(i => issueAffectsBlock(i, b)); return html`<section id=${'generation-context-'+b.block_id} class=${warnings.length ? 'generation-fact needs-review' : 'generation-fact'} tabindex="-1">
          <p><span>${text(b.properties.label) || b.handle || b.type}${b.locked ? ' · locked' : ''}</span>${safeMedia(text(b.properties.media_url)) && b.type === 'reference' && (!b.properties.media_type||text(b.properties.media_type).startsWith('image/')) ? stillImage(safeMedia(text(b.properties.media_url)),b.handle,b.properties,{className:'context-reference'}) : nothing}${text(b.properties.text) || text(b.properties.description)}</p>
          ${warnings.map(i => html`<div class="context-review-reason"><strong>${i.label}</strong> · ${issueBlockSummary(i,b.block_id)}</div>`)}
          ${warnings.length ? html`<a class="review-context-link" href=${this.viewURL('document',{blockId:b.block_id})} @click=${(e:MouseEvent)=>this.follow(e,'document',{blockId:b.block_id})}>Open idea</a>` : nothing}
        </section>`; })}</div>
        </details>
        ${g?.format === 'model3d' ? this.field('Prompt · 1,024 characters max', g.prompt, v => { g.prompt = v; g.acknowledgements=undefined;this.generationGate=null; }, 6) : nothing}
        ${g?.adaptation?.omittedBlockIds.length ? html`<p class="cost-note">${g.adaptation.omittedBlockIds.length} blocks omitted to fit. Review the prompt.</p>` : nothing}
        ${g?.adaptation?.issues.map(i => html`<p class="gate-notice">${i.message}</p>`)}
        ${g?.previousUnconfirmed ? html`<p class="gate-notice">Original status unknown. Starting another may duplicate it.</p>` : nothing}
        ${g ? html`<p class="cost-note">${g.recoveryClosed ? 'Original status unknown. Starting another may duplicate it.' : g.attempted ? `Checking an earlier ${FORMATS[g.format].toLowerCase()} request.` : g.format === 'model3d' ? `Estimated cost: $${(estimateModel3dCostMicrousd(g.settings?.model3dSettings) / 1e6).toFixed(2)} · ${g.settings?.model3dSettings.geometry_file_format.toUpperCase()??'GLB'} · text to 3D` : g.scenePreview ? `Maximum cost: $${(g.scenePreview.maximumMicrousd / 1e6).toFixed(2)} · ${g.scenePreview.model}` : g.format === 'scene' ? 'Cost approval required.' : 'Forma provider and spending limits apply.'}</p>` : nothing}

      </section>`;
    }
    if (mode === 'workspaces') return html`<section class="form-page"><h1>Workspaces</h1><en-select class="select-label" label="Workspace" .value=${this.choice} @en-change=${(e: CustomEvent<{proposed:string;value:string}>) => { this.choice = e.detail.proposed; this.changed(); }}><en-select-option value="">Personal projects</en-select-option>${this.client.session?.projects?.map(p => html`<en-select-option value=${p.projectAccessId}>${p.projectName} · ${p.role}</en-select-option>`)}</en-select></section>`;
    if (mode === 'reuse') return html`<section class="form-page"><h1>Use existing idea</h1>${this.renderWriteRecovery()}<en-select class="select-label" label="Idea" .value=${this.choice} @en-change=${(e: CustomEvent<{proposed:string;value:string}>) => { this.choice = e.detail.proposed; this.changed(); }}><en-select-option value="">Choose an idea</en-select-option>${p.libraryBlocks.filter(b => !b.removed && !p.blocks.some(used=>used.id===b.id)).map(b => html`<en-select-option value=${b.id}>${b.handle} · ${b.type}</en-select-option>`)}</en-select><p class="context-preview">${text(p.libraryBlocks.find(b => b.id === this.choice)?.properties.text)}</p></section>`;
    if(mode==='edit-block'){const block=p.libraryBlocks.find(b=>b.id===this.client.position.blockId);return html`<section class="form-page"><span class="eyebrow">${p.projectName}</span><h1>Edit idea</h1>${this.renderWriteRecovery()}${this.richEditIssue?html`<p role="status">${this.richEditIssue}</p><blockquote>${this.bodyDraft}</blockquote>`:this.richBodyDraft&&block?html`<still-idea-body-editor .body=${this.richBodyDraft} .blocks=${p.libraryBlocks} .projectId=${block.projectId} .blockId=${block.id} .disabled=${this.busy||block.locked} @idea-body-change=${(event:CustomEvent<IdeaBodyV1>)=>{this.richBodyDraft=event.detail;this.bodyDraft=ideaBodyText(event.detail);this.changed();}}></still-idea-body-editor>${Object.hasOwn(block.properties,'preferred_output_kinds')?html`<fieldset><legend>Preferred Outputs</legend><p>Keep the visible “Preferred outputs” line consistent with these choices. Other Outputs remain available.</p>${OUTPUT_KINDS.map(kind=>html`<label><input type="checkbox" .checked=${this.preferenceDraft.includes(kind)} @change=${(event:Event)=>{this.preferenceDraft=(event.target as HTMLInputElement).checked?[...new Set([...this.preferenceDraft,kind])]:this.preferenceDraft.filter(value=>value!==kind);this.changed();}}>${OUTPUT_KIND_LABELS[kind]}</label>`)}</fieldset>`:nothing}`:nothing}</section>`;}
    const titles: Record<string, string> = { 'new-project': 'New project', 'new-document': 'New document', 'add-context': 'Add idea', 'edit-block': 'Edit idea', rename: 'Rename document', intent: 'Set next goal', 'edit-artifact': 'Edit result' };
    const named = ['new-project', 'new-document', 'add-context', 'rename'].includes(mode);
    const fields=html`${mode!=='new-project'&&p.projectName ? html`<span class="eyebrow">${p.projectName}</span>` : nothing}<h1>${titles[mode] ?? 'New idea'}</h1>${this.renderWriteRecovery()}${named ? this.field('Name', this.titleDraft, v => { this.titleDraft = v; }, 1) : nothing}${mode === 'add-context' ? html`<en-select class="select-label" label="Type" .value=${this.kindDraft} @en-change=${(e: CustomEvent<{proposed:string;value:string}>) => { this.kindDraft = e.detail.proposed; }}>${blockKinds.map(k => html`<en-select-option value=${k}>${k[0].toUpperCase() + k.slice(1)}</en-select-option>`)}</en-select>` : nothing}${mode !== 'rename' && mode !== 'new-project' ? this.field(mode === 'intent' ? 'Your next goal' : mode === 'edit-artifact' ? 'Writing' : 'Idea', this.bodyDraft, v => { this.bodyDraft = v; }, mode === 'edit-artifact' ? 16 : 6, '') : nothing}`;
    return this.isCreationMode()
      ? html`<form id="still-create-form" class="form-page" @submit=${this.submitCreation} @keydown=${this.creationKeydown}>${fields}</form>`
      : html`<section class="form-page">${fields}</section>`;
  }
  private paletteButton(entry:PaletteFeedback['entry']) { return html`<en-button id=${this.dockId("still-help-ui:palette")} data-action-id="ui:palette" variant="ghost" size="medium" aria-keyshortcuts="Meta+K Control+K" .disabled=${this.busy||this.composing} @click=${()=>this.openFinder(entry)}>Find action<en-badge slot="suffix" variant="neutral">⌘+K</en-badge></en-button>${this.help("still-help-ui:palette","Find action")}`; }
  private compactDock(options:{id:string;label:string;run:()=>void;variant?:Emphasis['variant'];disabled?:boolean;source?:string}[],menuLabel='More actions',status='') {
    const shown=options.slice(0,this.toolbarLimit-1),rest=options.slice(shown.length);
    return html`<footer class=${this.dockClass} @focusout=${()=>this.scheduleDockFit()} @pointerdown=${()=>{this.dockTouched=true;if(this.mode==='generate')this.formatTouched=true;}} @focusin=${()=>{this.dockTouched=true;if(this.mode==='generate')this.formatTouched=true;}}>${this.toolbarStatus(status)}<en-toolbar label="Your next step" keyboard-navigation="tab">
      ${shown.map(option=>this.button(option.label,option.run,false,!!option.disabled,option.id,option.variant??'secondary',option.source))}
      ${rest.length?html`<en-button id=${this.dockId("still-compact-menu")} variant="ghost" size="medium" .disabled=${this.busy||this.composing}>${menuLabel}</en-button>`:nothing}
    </en-toolbar>${rest.length?html`<en-menu for=${this.dockId("still-compact-menu")} label="More actions" @en-action=${(event:CustomEvent<{action:string}>)=>{const option=rest.find(x=>x.id===event.detail.action);if(option&&!option.disabled&&!this.busy&&!this.composing)option.run();}}>
      ${rest.map(option=>html`<en-menu-item action=${option.id} ?disabled=${option.disabled}>${option.label}${option.id==='ui:palette'?html`<en-badge slot="suffix" variant="neutral">⌘+K</en-badge>`:nothing}</en-menu-item>`)}
    </en-menu>`:nothing}</footer>`;
  }
  private generationBackLabel() {
    if(this.generation&&!this.generation.attempted)return 'Back to types';
    const p=this.client.position;
    return `Back to ${p.view==='document'?(p.blockId?'idea':'document'):({projects:'projects',documents:'documents',ideas:'ideas',results:'results',generation:'generation',artifact:'result',output:'result'} as Record<string,string>)[p.view]??'document'}`;
  }
  private renderGenerationDock() {
    const g=this.directGeneration?null:this.generation;
    const formats=this.candidates().filter(a=>!!FORMATS[a.id]);
    const formatOrder=nextBestOrder(this.formatSuggestions.map(id=>({id})),[],this.nextBestAssessment(),this.formatSuggestions.length).map(a=>a.id);
    const preferred=new Set(preferredOutputChoices(this.client.projection.blocks,this.client.abilities.formats as OutputKind[]).filter(option=>option.preferred&&option.available).map(option=>option.kind as string));
    const ordered=[...new Set([...preferred,...formatOrder,...rankAllFormats(formats,{}, {projection:this.client.projection,position:this.decisionPosition()})])].filter(id=>formats.some(a=>a.id===id));
    if(this.toolbarLimit<3){
      const emphasis=presentToolbar(ordered.slice(0,3),this.formatEmphasis,this.toolbarPolicy());
    const choices=g?[{id:'ui:generate',label:g.recoveryClosed?'Review new request':g.attempted?'Check request':g.format==='scene'&&!g.scenePreview?'Estimate cost':this.generationGate?(this.generationGate.key?'Acknowledge & send':'Unavailable'):'Generate',run:()=>void this.run(()=>this.generate()),variant:'primary' as const,disabled:!!this.generationGate&&!this.generationGate.key}]:ordered.map(id=>({id,label:ACTIONS.find(a=>a.id===id)!.label+(preferred.has(id)?' · preferred':''),run:()=>{this.formatTouched=true;void this.selectGenerationFormat(id);},variant:emphasis[id]?.variant??'secondary' as const}));
      return this.compactDock([...choices,{id:'ui:back',label:this.generationBackLabel(),run:()=>this.generationBack(),variant:'ghost'}],g?'More actions':'Other outputs');
    }
    const suggested=ordered.slice(0,Math.min(3,this.toolbarLimit-2));
    const remaining=ordered.filter(id=>!suggested.includes(id));
    return html`<footer class=${this.dockClass} @focusout=${()=>this.scheduleDockFit()} @pointerdown=${()=>{this.formatTouched=true;}} @focusin=${()=>{this.formatTouched=true;}}>
      <en-toolbar label="Your next step" keyboard-navigation="tab">
        ${g?this.button(g.recoveryClosed?'Review new request':g.attempted?'Check request':g.format==='scene'&&!g.scenePreview?'Estimate cost':this.generationGate?(this.generationGate.key?'Acknowledge & send':'Unavailable'):'Generate',()=>void this.run(()=>this.generate()),true,!!this.generationGate&&!this.generationGate.key):html`
          ${suggested.map(id=>this.suggestedButton({...ACTIONS.find(a=>a.id===id)!,label:ACTIONS.find(a=>a.id===id)!.label+(preferred.has(id)?' · preferred':'')},true,presentToolbar(suggested,this.formatEmphasis,this.toolbarPolicy())))}
          ${remaining.length?html`<en-button id=${this.dockId("still-format-menu")} variant="ghost" size="medium" ?disabled=${this.busy||this.composing}>Other outputs</en-button>${this.help("still-format-menu","Other outputs")}`:nothing}
        `}
        ${this.button(this.generationBackLabel(),()=>this.generationBack())}
      </en-toolbar>
      ${!g&&remaining.length?html`<en-menu for=${this.dockId("still-format-menu")} label="Other outputs" @en-action=${this.selectMenuFormat}>${remaining.map(id=>html`<en-menu-item action=${id}>${ACTIONS.find(a=>a.id===id)!.label}${preferred.has(id)?' · preferred':''}</en-menu-item>`)}</en-menu>`:nothing}
    </footer>`;
  }
  private workflowScope(){return `${this.interactionScope()}/${this.client.position.blockId}/${this.mode}`;}
  private renderWorkflowDock(){
    let toolbar:WorkflowToolbar;
    if(this.unifiedCreation()){const flow=this.querySelector<StillCreationFlow>('still-creation-flow');if(!flow||flow.dataset.toolbarScope!==this.workflowScope())return nothing;toolbar=flow.toolbar;}
    else if(['use-in','split-context','research-context','find-references','supply-reference','compose'].includes(this.mode)){
      const flow=this.querySelector<StillContextFlow|StillUseInFlow>('still-context-flow, still-use-in-flow');
      if(!flow||flow.dataset.toolbarScope!==this.workflowScope())return nothing;
      toolbar=flow.toolbar;
    }else{
      const back:WorkflowAction={id:'ui:back',label:'Back',run:()=>this.closeMode(),variant:'ghost'};
      if(this.mode==='edit-artifact'&&this.missingWriting())toolbar={actions:[back]};
      else if(this.mode==='workspaces')toolbar={actions:[{id:'workflow:open',label:'Open',variant:'primary',run:()=>void this.run(async()=>{await this.client.switchWorkspace(this.client.session?.projects?.find(p=>p.projectAccessId===this.choice));this.navigate(this.client.position.view,this.client.position);})},back]};
      else toolbar={actions:[{id:'workflow:save',label:this.client.hasUnconfirmedWrite?'Check save':this.mode==='intent'?'Suggest actions':this.mode==='reuse'?'Use idea':'Save',variant:'primary',disabled:this.mode==='edit-block'&&!!this.richEditIssue||this.mode==='reuse'&&!this.choice&&!this.client.hasUnconfirmedWrite,run:()=>this.client.hasUnconfirmedWrite?void this.run(()=>this.checkSave()):this.isCreationMode()?this.requestCreationSubmit():void this.run(()=>this.save())},...(this.client.hasUnconfirmedWrite&&this.writeRecovery?.key===this.writeRecoveryKey()?[{id:'workflow:save-draft',label:'Save draft',variant:'secondary' as const,run:()=>void this.run(()=>this.saveUnconfirmedDraft())}]:[]),back]};
    }
    toolbar={...toolbar,actions:toolbar.actions.map(action=>({...action,run:()=>{this.toolbarMotion?.ensure();action.run();}}))};
    if(!toolbar.actions.length&&!toolbar.status)return nothing;
    if(toolbar.actions.length>this.toolbarLimit)return this.compactDock(toolbar.actions,'More actions',toolbar.status);
    return html`<footer class=${this.dockClass} @focusout=${()=>this.scheduleDockFit()}>${this.toolbarStatus(toolbar.status??'')}<en-toolbar label="Your next step" keyboard-navigation="tab">${toolbar.actions.map(action=>this.button(action.label,action.run,false,!!action.disabled,action.id,action.variant,'Workflow rule'))}</en-toolbar></footer>`;
  }
  private renderDock() {
    const c = this.client, p = c.projection, view = c.position.view;
    if(this.loading)return nothing;
    if(this.startupFailed)return html`<footer class=${this.dockClass}><en-toolbar label="Recovery" keyboard-navigation="tab">${this.button('Retry loading Still',()=>void this.run(()=>this.loadWorkspace()),true)}${this.button('View projects',()=>{history.replaceState(null,'','/still');void this.run(()=>this.loadWorkspace());})}</en-toolbar></footer>`;
    if(!c.session?.policy.accepted)return nothing;
    if(this.currentRouteProblem(p))return html`<footer class=${this.dockClass}><en-toolbar label="Recovery" keyboard-navigation="tab">${this.button('View projects',()=>this.navigate('projects',{projectId:'',documentId:''}))}</en-toolbar></footer>`;
    if(this.busy||this.directGeneration)return this.renderBusyDock();
    if(this.mode==='generate')return this.renderGenerationDock();
    if(this.mode)return this.renderWorkflowDock();
    if((view==='generation'||view==='rejection')&&(this.isInlineGeneration()||this.canAcknowledgeSafety(this.selectedGeneration())||this.selectedGeneration()&&(generationOutcome(this.selectedGeneration()!).serviceBlocked||generationOutcome(this.selectedGeneration()!).recovery)))return this.renderGenerationStatusDock();
    const limit=this.toolbarLimit,firstLimit=this.moreOpen?this.firstDockLimit:limit,eligible=pageToolbarCandidates(this.candidates(),this.decisionPosition()),job=view==='generation'?this.selectedGeneration():undefined;
    const generationProgress=job&&generationActive(job)?generationStatus(job):'';
    const selected=this.preferredSuggestions();
    const pool=[...selected,...(firstLimit>5&&this.decisionSource==='jev'?this.rankedActions.filter(a=>!selected.some(s=>s.id===a.id)):[])].filter(a=>eligible.some(e=>e.id===a.id));
    const a=p.artifacts.find(x=>x.id===c.position.outputId);
    const slides=view==='artifact'&&a&&['slides','storyboard'].includes(a.kind)&&a.items.length>1;
    const browsing=!!this.listKind();
    const listOptions=this.listOptions(),toggle=listOptions.find(a=>a.id==='ui:show-all'||a.id==='ui:show-less');
    const pageControls=listOptions.filter(a=>a!==toggle).map(a=>({...a,run:()=>this.runListAction(a.id)}));
    const visible=withDocumentReturn(pool.filter(a=>!browsing||a.id!==view),eligible,this.decisionPosition(),Math.max(0,firstLimit-1-(slides?2:pageControls.length)));
    const visibleIds=visible.map(a=>a.id);
    if(this.moreOpen&&limit<3){
      const alternatives=nextToolbarActions(this.rankedActions,visibleIds,eligible,this.rankedActions.length);
      return this.compactDock([...(toggle?[{...toggle,run:()=>this.runListAction(toggle.id),variant:'secondary' as const}]:[]),...alternatives.map(a=>({id:a.id,label:a.label,run:()=>this.choose(a.id),variant:'secondary' as const})),{id:'ui:back',label:'Back',variant:'ghost',run:()=>void this.replaceToolbar(false)},{id:'ui:palette',label:'Find action',variant:'ghost',run:()=>this.openFinder('more')}],'More actions',generationProgress);
    }
    if(limit<3){
      const compactPool=[...pool,...this.rankedActions.filter(a=>!pool.some(p=>p.id===a.id))].filter(a=>eligible.some(e=>e.id===a.id)&&(!browsing||a.id!==view));
      const first=withDocumentReturn(compactPool,eligible,this.decisionPosition(),1);
      const choices=[...first,...compactPool.filter(a=>!first.some(f=>f.id===a.id))],emphasis=presentToolbar(choices.map(a=>a.id),this.emphasis,this.toolbarPolicy());
      return this.compactDock([
        ...choices.map(a=>({id:a.id,label:a.label,run:()=>this.choose(a.id),variant:emphasis[a.id]?.variant,source:a.id==='context'&&isIdeaPage(this.decisionPosition())?DOCUMENT_RETURN_REASON:this.decisionSource==='jev'&&emphasis[a.id]?.score!==undefined?'Jev ranking':'Local fallback'})),
        ...(slides?[{id:'ui:previous',label:a!.kind==='slides'?'Previous slide':'Previous frame',run:()=>this.turnItem(this.itemIndex-1),disabled:this.itemIndex===0},{id:'ui:next',label:a!.kind==='slides'?'Next slide':'Next frame',run:()=>this.turnItem(this.itemIndex+1),disabled:this.itemIndex>=a!.items.length-1}]:[]),
        ...pageControls,
        ...(toggle?[{...toggle,run:()=>this.runListAction(toggle.id),variant:'secondary' as const}]:[]),
        {id:'ui:palette',label:'Find action',run:()=>this.openFinder('more'),variant:'ghost',source:'Navigation utility'},
      ],'More actions',generationProgress);
    }
    let actions:TemplateResult[]=[...this.toolbarSuggestions(visible)];
    if(slides)actions.unshift(this.button(a!.kind==='slides'?'Previous slide':'Previous frame',()=>this.turnItem(this.itemIndex-1),false,this.itemIndex===0,'','secondary'),this.button(a!.kind==='slides'?'Next slide':'Next frame',()=>this.turnItem(this.itemIndex+1),false,this.itemIndex>=a!.items.length-1,'','secondary'));
    actions.push(...pageControls.map(control=>this.button(control.label,control.run,false,false,control.id,'secondary')));
    actions.push(this.button('More actions',event=>this.openMore(event),false,false,'ui:more'));
    if(this.moreOpen)actions=[...(toggle?[this.button(toggle.label,()=>this.runListAction(toggle.id),false,false,toggle.id,'secondary')]:[]),...this.toolbarSuggestions(nextToolbarActions(this.rankedActions,visibleIds,eligible,limit-2-(toggle?1:0))),this.button('Back',event=>void this.replaceToolbar(false,event),false,false,'ui:back'),this.paletteButton('more')];
    return html`<footer class=${this.dockClass} @focusout=${()=>this.scheduleDockFit()} @pointerdown=${()=>{this.dockTouched=true;}} @focusin=${()=>{this.dockTouched=true;}}>${this.toolbarStatus(generationProgress)}<en-toolbar label="Your next step" keyboard-navigation="tab">${actions}</en-toolbar></footer>`;
  }
  private reviewContext(job?:DocumentJob) {
    const ids=job?.errorDetail?.contributingBlockIds ?? this.generationGate?.issues.flatMap(i=>i.blockIds??[]) ?? [];
    const refs=job?.errorDetail?.contributingReferenceIds ?? this.generationGate?.issues.flatMap(i=>i.referenceIds??[]) ?? [];
    const block=this.client.projection.blocks.find(b=>!b.removed && (ids.includes(b.id) || refs.includes(String(b.properties.reference_id??''))));
    this.navigate('document',{blockId:block?.id??'',outputId:''});
  }
  private notification(key:string,message:string,variant:'info'|'success'|'warning'|'danger',actions:{label:string;run:()=>void;disabled?:boolean}[],dismiss?:()=>void,documentId=this.client.position.documentId) {
    const identity=`${this.client.scopeKey}:${documentId}:${key}`;
    if(this.dismissedNotifications.has(identity))return nothing;
    const {summary,label}=quietNotification(message,variant),expanded=this.expandedNotification===identity,details=summary!==message||actions.length>0;
    const detailId=`notification-${encodeURIComponent(identity)}`;
    const duration=variant==='success'&&!actions.length&&['Saved.','Save confirmed.','Updated.'].includes(message)?5000:0;
    return keyed(identity,html`<en-toast class="quiet-notification" swipe .announcement=${message} variant=${variant} priority="polite" duration=${duration} dismiss-label="Dismiss message" @en-change=${(event:CustomEvent<{proposed:boolean}>)=>{
      if(event.target!==event.currentTarget||event.detail.proposed!==false)return;
      const focused=(event.currentTarget as HTMLElement).matches(':focus-within');
      queueMicrotask(()=>{
        if(event.defaultPrevented)return;
        this.dismissedNotifications.add(identity);
        if(this.dismissedNotifications.size>200)this.dismissedNotifications.delete(this.dismissedNotifications.values().next().value!);
        if(this.expandedNotification===identity)this.expandedNotification='';
        dismiss?.();this.changed();
        if(focused)void this.updateComplete.then(()=>this.focusContent());
      });
    }}><span class="notification-summary">${summary}</span>${details?html`<section id=${detailId} class="notification-detail" ?hidden=${!expanded} aria-label="Message details" @keydown=${(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();this.expandedNotification='';this.changed();(event.currentTarget as HTMLElement).parentElement?.querySelector<HTMLElement>('.notification-review')?.focus();}}}><p>${message}</p><div class="notification-detail-actions">${actions.map(action=>html`<en-button variant="secondary" size="small" ?disabled=${this.busy||this.composing||action.disabled} @click=${()=>{this.dismissedNotifications.add(identity);this.expandedNotification='';action.run();this.changed();}}>${action.label}</en-button>`)}</div></section><en-button class="notification-review" slot="actions" variant="ghost" size="small" aria-expanded=${String(expanded)} aria-controls=${detailId} @click=${(event:MouseEvent)=>{this.expandedNotification=expanded?'':identity;this.changed();if(!expanded&&event.detail===0)void this.updateComplete.then(()=>this.querySelector<HTMLElement>(`[id="${detailId}"] en-button`)?.focus());}}>${expanded?'Close':label}</en-button>`:nothing}</en-toast>`);
  }
  private renderNotifications(failed?:DocumentJob) {
    const inline=this.isInlineGeneration(),review=inline?null:this.generationGate, failure=failed?failureNotification(failed):null;
    return html`<en-toast-region class="generation-notifications" placement="inline" label="Notifications" max="2">
      ${this.renderGenerationCompletions()}
      ${this.error&&!inline?this.notification(`error:${this.errorVersion}`,this.error,'danger',[
        this.errorCode==='generation_preparation_unavailable'?{label:'Check service readiness',run:()=>void this.checkServiceReadiness()}:
        this.generation?.attempted?{label:'Check request',run:()=>void this.run(()=>this.generate())}:
        this.mode==='generate'?{label:'Review ideas',run:()=>this.reviewContext()}:
        {label:this.startupFailed?'Reload':'Review step',run:()=>this.startupFailed?void this.run(()=>this.loadWorkspace()):this.focusContent()},
      ],()=>{this.error='';}):nothing}
      ${review?this.notification(`review:${this.reviewVersion}`, [review.message,...review.issues.map(i=>i.summary)].join('. '),canContinueReview(review)?'warning':'danger',[
        {label:'Review ideas',run:()=>this.reviewContext()},
        ...(canContinueReview(review)?[{label:'Acknowledge & send',run:()=>void this.run(()=>this.generate())}]:[]),
      ]):nothing}
      ${!this.mode&&failed&&!failed.dismissedAt&&failure&&!this.client.generationActivity.hasSeen(failed)&&!this.client.generationActivity.notices.some(job=>job.jobId===failed.jobId)?this.notification(`generation:${generationNoticeKey(failed)}`,failure.message,failed.errorDetail?.category==='safety'?'warning':'danger',[
        ...(this.canAcknowledgeSafety(failed)?[{label:'Acknowledge & send',run:()=>this.acknowledgeSafety(failed)}]:[]),
        {label:failure.label,run:()=>{
          if(failure.action==='context')this.reviewContext(failed);
          else if(failure.action==='generation'&&generationFormat(failed))this.navigate('generation',{outputId:failed.jobId});
          else this.navigate('results');
        }},
      ],()=>void this.dismissGenerationNotice(failed)):nothing}
      ${!this.mode?sharedIdeaOutputNotices(this.client.projection,this.client.events).map(n=>this.notification(`shared-idea:${n.key}`,`${n.documentTitle}: a shared idea changed elsewhere. This ${FORMATS[n.kind]??n.kind} output is out of date. Would you like to update it?`,'warning',[{label:this.client.abilities.generate?'Review and update output':'View document',disabled:this.preventsRouteChange(),run:()=>{this.navigate('document',{documentId:n.documentId});if(this.client.abilities.generate)this.begin('generate');}}],undefined,n.documentId)):nothing}
      ${this.notice?this.notification(`notice:${this.noticeVersion}`,this.notice,'success',[],()=>{this.notice='';}):nothing}
    </en-toast-region>`;
  }
  private async dismissGenerationNotice(job:DocumentJob) {
    const c=this.client,scope=c.scopeKey;
    // Hide this attempt in every local notification path while saving its dismissal.
    c.generationActivity.consume(job);
    try { await c.dismissJob(job); }
    catch {
      if(c.scopeKey!==scope)return;
      this.error='Message hidden here. Dismissal could not be saved.';
      this.changed();
    }
  }
  private generationIsVisible(job:DocumentJob) {
    const c=this.client,p=c.position;
    return !this.loading&&!this.mode&&p.documentId===job.documentId&&(p.view==='generation'&&p.outputId===job.jobId||p.view==='artifact'&&p.outputId===generationResult(job,c.projection,c.events));
  }
  private reconcileGenerationNotices() {
    for(const job of this.client.generationActivity.notices)if(this.generationIsVisible(job))this.client.generationActivity.consume(job);
  }
  private renderGenerationCompletions() {
    const c=this.client;
    return c.generationActivity.notices.filter(job=>!this.generationIsVisible(job)).map(job=>{
      const notice=generationCompletion(job);
      return this.notification(`generation:${generationNoticeKey(job)}`,notice.message,notice.variant,[{label:notice.label,disabled:this.preventsRouteChange(),run:()=>void this.openGenerationNotice(job)}],()=>void this.dismissGenerationNotice(job),job.documentId);
    });
  }
  private async openGenerationNotice(job:DocumentJob) {
    if(this.preventsRouteChange())return;
    await this.run(async()=>{
      const c=this.client;
      if(!c.historyComplete)await c.completeHistory();
      const doc=c.projection.documents.find(d=>d.id===job.documentId&&!d.removed);
      if(!doc)throw new Error('This generation is no longer available.');
      c.generationActivity.consume(job);
      this.navigate('generation',{projectId:doc.projectId,documentId:job.documentId,outputId:job.jobId});
    });
  }
  render() {
    const c = this.client, displayedGeneration = !this.loading && !this.mode && c.position.view === 'generation' ? c.position.outputId : '';
    const failed = c.jobs.find(j => j.status === 'failed' && !j.dismissedAt && j.documentId === c.position.documentId && j.jobId !== displayedGeneration);
    return html`<div class=${this.developerVisible?'still-layout has-developer':'still-layout'}><div class="still-shell" id="still-onboarding"><header class="masthead"><a class="wordmark header-stamp" href=${this.viewURL('projects',{projectId:'',documentId:''})} aria-label="Still home" @click=${this.home}>still<span aria-hidden="true">.</span></a>${c.session?.impersonation || c.session && !c.abilities.author ? html`<span class="session-status header-stamp">${c.session?.impersonation ? 'Preview · read only' : 'Read only'}</span>` : nothing}</header><main id="still-content" aria-busy=${this.loading}>${this.renderCanvas()}</main><div class="dock-stack">${this.renderNotifications(failed)}<div class="toolbar-motion-root"><div class="toolbar-motion-live">${this.renderDock()}</div><div class="toolbar-motion-visual" aria-hidden="true" inert></div><span class="toolbar-motion-status" role="status" aria-live="polite"></span></div></div>${this.renderDockProbes()}${this.renderPalette()}</div>${this.developer ? html`<aside class="developer-panel" ?hidden=${!this.developerVisible} aria-label="Developer panel"><still-developer-console @developer-sharing=${this.setSharing} @developer-visibility=${(e:CustomEvent<{value:boolean}>)=>this.setDeveloper(e.detail.value)} @developer-remember-lists=${this.setRememberLists} @developer-next-best=${this.setNextBest} @developer-flags=${this.setOnboarding} @developer-assess-ideas=${this.assessIdeasAgain} @developer-refresh=${this.refreshDecision} @developer-density=${this.setDensity} @developer-experiment=${this.experiment} @developer-disable=${()=>this.setDeveloper(false)}></still-developer-console></aside>` : nothing}${new URL(location.href).searchParams.has('progress-report') ? html`<a class="progress-return" href=${REPORT_URL}>Progress Report <en-icon name="arrow-right" aria-hidden="true"></en-icon></a>` : nothing}</div>`;
  }
}
if (!customElements.get('still-app')) customElements.define('still-app', StillApp);
