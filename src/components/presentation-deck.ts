import { ideasInDocument } from '../model/project-ideas.ts';
import { html, nothing } from "lit";
import { applySlideStylePreset, formatPresentationQuantity, isSlideStylePresetId, normalizeSlideItem, normalizeSlidePresentation, SLIDE_STYLE_PRESETS, slideStylePresetDefinition, type DocumentArtifactDraftItem, type SlidePresentation, type SlideStylePresetId } from "../model/document-artifacts";
import { combinedContextMemberships } from "../model/combined-context";
import { FormaElement, icon } from "./forma-element";
import { observeNativePopoverPosition, positionNativePopover } from "./native-popover";
import type { FormaUiPopover } from "./design-system/feedback";
import "./design-system/feedback";
import { presentationSlideRenderKey, readSlideFooterLabelPreference, writeSlideFooterLabelPreference, type PresentationSlideFitDetail } from "./presentation-slide";
import { presentationEditableExportFilename } from "../model/presentation-export";
import { presentationAudienceItem } from "../model/presentation-delivery";
import { authorizedPresentationCitations, presentationRequiresReadingPosture } from "../model/presentation-layout";
import { localizedSourceAnchor } from "../model/source-anchor";
import { inferPresentationAudienceLocale } from "../model/presentation-source";
import { presentationUsesReadingView } from "../model/presentation-view-posture";
import { renderSoundtrackCompanions as renderAudioCompanions, soundtrackCompanions, type SoundtrackAsset } from "./audio-playback";
import { audioFileExtension } from "../model/audio";
import { captureOutputNavigationFocus } from "./output-navigation-focus";

type DeckView="list"|"slideshow";
type ExportCompletionOwner={current:()=>boolean;dispose:()=>void};
type PreparedPresentationExport={owner:ExportCompletionOwner;url:string;filename:string;format:"pdf"|"powerpoint"|"powerpoint-presenter"};
type ExportFocusReturn={controller:AbortController;cancel:(event:MouseEvent)=>void;restore:(prepared:boolean)=>Promise<void>;dispose:()=>void};
const DECK_VIEW_PREFERENCE="forma:slides:deck-view";
const DECK_STYLE_PREFERENCE="forma:slides:style";
const DECK_SLIDE_PREFERENCE="forma:slides:current";
const readDeckView=():DeckView=>{try{return localStorage.getItem(DECK_VIEW_PREFERENCE)==="list"?"list":"slideshow";}catch{return"slideshow";}};
const writeDeckView=(view:DeckView)=>{try{localStorage.setItem(DECK_VIEW_PREFERENCE,view);}catch{/* The active deck still keeps the selected view. */}};
const readDeckStyle=(key:string)=>{try{const value=localStorage.getItem(`${DECK_STYLE_PREFERENCE}:${key}`);return isSlideStylePresetId(value)?value:null;}catch{return null;}};
const writeDeckStyle=(key:string,value:SlideStylePresetId)=>{try{localStorage.setItem(`${DECK_STYLE_PREFERENCE}:${key}`,value);}catch{/* The active deck still keeps the selected style. */}};
const readDeckIndex=(key:string)=>{try{const value=Number(localStorage.getItem(`${DECK_SLIDE_PREFERENCE}:${key}`));return Number.isSafeInteger(value)&&value>=0?value:0;}catch{return 0;}};
const writeDeckIndex=(key:string,index:number)=>{try{localStorage.setItem(`${DECK_SLIDE_PREFERENCE}:${key}`,String(index));}catch{/* Slide navigation remains available without browser storage. */}};
const OPAQUE_SOURCE_LABEL=/^(?:(?:blk|grp|clm|source|context|decision)[_-]\d+|context_group_\d+|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i;
const visibleSourceLabel=(value:string,fallback:string)=>{const label=value.trim();return !label||OPAQUE_SOURCE_LABEL.test(label)?fallback:label;};

type DeckQuote={text:string;speaker:string;role:string;sourceId?:string;citation?:string};
type DeckCitation={sourceId?:string;label:string;anchor:string;excerpt:string};
type DeckVisual=NonNullable<DocumentArtifactDraftItem["slide"]>&{quote?:DeckQuote;citations?:DeckCitation[];sourceIds?:string[]};
type DeckVisualDatum=DeckVisual["visual"]["data"][number]&{exactValue?:string;displayValue?:string;sourceIds?:string[]};
type DeckEvidence={sources:Array<{label:string;kind:"Source decision"|"Combined context";citationLabel:string;anchor:string;excerpt:string}>;unresolved:boolean};

export class PresentationDeck extends FormaElement{
  static properties={items:{attribute:false},presentation:{attribute:false},preferenceKey:{type:String,attribute:"preference-key"},deckTitle:{type:String,attribute:"deck-title"},documentId:{type:String,attribute:"document-id"},sourceSurface:{type:String,attribute:"source-surface"},releaseAllowed:{type:Boolean,attribute:false}};
  items:DocumentArtifactDraftItem[]=[];presentation:SlidePresentation|null=null;preferenceKey="";deckTitle="";documentId="";sourceSurface="presentation-deck";releaseAllowed=true;#view:DeckView=readDeckView();#index=0;#indexKey="";#showFooterLabel=readSlideFooterLabelPreference();#styleOverride:{key:string;value:SlideStylePresetId}|null=null;#exporting=false;#exportMenuId=`presentation-deck-export-${crypto.randomUUID()}`;#exportMenuOpen=false;#fullscreenActive=false;#touchStart:{x:number;y:number}|null=null;#followSoundtrackCues=false;#compactToolsOpen=false;#automaticReading=false;#visualOverflow=false;#readingOverride:boolean|null=null;#readingObserver?:ResizeObserver;#readingViewport?:HTMLElement;
  #exportProgress:{stage:"preparing"|"rendering"|"finalizing"|"prepared"|"save-requested"|"failed";completed:number;total:number;message?:string;format?:"pdf"|"powerpoint"|"powerpoint-presenter"}|null=null;
  #exportAbort?:AbortController;
  #exportFocus?:ExportFocusReturn;
  #exportCompletion?:ExportCompletionOwner;
  #preparedExport:PreparedPresentationExport|null=null;
  #activeFitKey="";
  #popoverScope="";
  #stopExportPosition?:()=>void;
  #closeDeckPopovers(){
    this.#stopExportPosition?.();this.#stopExportPosition=undefined;
    this.querySelector<FormaUiPopover>(".presentation-deck-soundtrack")?.close();
    const menu=this.querySelector<HTMLElement>(".presentation-deck-export-menu");
    if(menu?.matches(":popover-open"))menu.hidePopover();
    this.#exportMenuOpen=false;
  }
  protected override willUpdate(){
    if(this.#exportCompletion&&!this.#exportCompletion.current())this.#clearExportCompletion();
    const scope=JSON.stringify([this.store.captureAuthorizationScope()?.key??"",this.store.route.get(),this.documentId,this.preferenceKey,this.releaseAllowed]);
    if(scope!==this.#popoverScope)this.#closeDeckPopovers();
    this.#popoverScope=scope;
  }
  #postureFrame=0;
  #fullscreenChanged=()=>{this.#fullscreenActive=document.fullscreenElement===this;this.requestUpdate();};
  #syncReadingPosture=(entries:ResizeObserverEntry[])=>{
    const entry=entries.find((candidate)=>candidate.target===this.#readingViewport);
    if(!entry)return;
    // Reading focus gutters must not shrink the viewport used to choose its posture.
    const style=getComputedStyle(entry.target);
    const width=entry.contentRect.width+Number.parseFloat(style.paddingLeft)+Number.parseFloat(style.paddingRight);
    const height=entry.contentRect.height+Number.parseFloat(style.paddingTop)+Number.parseFloat(style.paddingBottom);
    if(!Number.isFinite(width)||!Number.isFinite(height)||width<1||height<1)return;
    const reading=presentationRequiresReadingPosture(width,height);
    const postureChanged=reading!==this.#automaticReading;
    this.#automaticReading=reading;
    if(postureChanged&&this.#readingOverride===null){
      if(this.#postureFrame)cancelAnimationFrame(this.#postureFrame);
      this.#postureFrame=requestAnimationFrame(()=>{this.#postureFrame=0;if(this.isConnected)this.requestUpdate();});
    }
  };
  #slideFit=(event:CustomEvent<PresentationSlideFitDetail>)=>{
    if(event.target!==this.querySelector(".presentation-deck-viewport forma-presentation-slide")||event.detail.renderKey!==this.#activeFitKey)return;
    const overflow=!event.detail.contentFits;
    if(overflow===this.#visualOverflow)return;
    this.#visualOverflow=overflow;
    this.requestUpdate();
  };
  override connectedCallback(){super.connectedCallback();document.addEventListener("fullscreenchange",this.#fullscreenChanged);this.requestUpdate();}
  override disconnectedCallback(){this.#clearExportCompletion();this.#closeDeckPopovers();this.#exportAbort?.abort();this.#exportFocus?.dispose();this.#exportFocus=undefined;document.removeEventListener("fullscreenchange",this.#fullscreenChanged);this.#readingObserver?.disconnect();this.#readingViewport=undefined;if(this.#postureFrame)cancelAnimationFrame(this.#postureFrame);this.#postureFrame=0;super.disconnectedCallback();}
  protected override updated(){
    const viewport=this.#view==="slideshow"?this.querySelector<HTMLElement>(".presentation-deck-viewport"):null;
    if(viewport===this.#readingViewport)return;
    this.#readingObserver?.disconnect();
    this.#readingViewport=viewport??undefined;
    if(viewport&&typeof ResizeObserver==="function"){
      this.#readingObserver??=new ResizeObserver(this.#syncReadingPosture);
      this.#readingObserver.observe(viewport);
    }
  }
  #setReading(reading:boolean){
    this.#readingOverride=reading;
    this.requestUpdate();
    void this.updateComplete.then(()=>this.querySelector<HTMLElement>(reading?".presentation-deck-reading":".presentation-deck-reading-toggle")?.focus({preventScroll:true}));
  }
  #setView(view:DeckView){
    if(view==="list"&&this.#fullscreenActive){
      void document.exitFullscreen().then(()=>{this.#view=view;writeDeckView(view);this.requestUpdate();}).catch(()=>{/* Fullscreen retains its visible exit control. */});
      return;
    }
    this.#view=view;writeDeckView(view);this.requestUpdate();
  }
  #setIndex(index:number,total:number){if(!total)return;const next=Math.max(0,Math.min(total-1,index));this.#index=next;this.#visualOverflow=false;writeDeckIndex(this.#styleKey(),this.#index);this.#seekPlayingSoundtrack();this.requestUpdate();}
  #seekPlayingSoundtrack(){
    if(!this.#followSoundtrackCues)return;
    const audio=this.querySelector<HTMLAudioElement>(".presentation-deck-soundtrack audio");if(!audio||audio.paused||audio.ended)return;
    const artifact=this.store.projection.get().libraryArtifacts.find((candidate)=>candidate.id===this.preferenceKey);if(!artifact)return;
    const slide=artifact.items[this.#index],title=String(slide?.title??this.items[this.#index]?.title??"").trim().toLocaleLowerCase();
    const numbered=String(this.#index+1);
    for(const asset of soundtrackCompanions(artifact.settings.soundtrack_assets)){
      const cues=(asset.cues??[]).filter((cue)=>cue.target_kind==="slide"&&typeof cue.start_seconds==="number");
      const cue=cues.find((entry)=>{const target=String(entry.target_id??"").trim().toLocaleLowerCase();return target===numbered||target===`slide ${numbered}`||target===String(slide?.id??"").toLocaleLowerCase()||Boolean(title&&target===title);})??cues.filter((entry)=>!entry.target_id)[this.#index];
      if(cue&&Number.isFinite(cue.start_seconds)&&cue.start_seconds!>=0){audio.currentTime=cue.start_seconds!;break;}
    }
  }
  async #downloadSoundtrack(asset:SoundtrackAsset){
    this.querySelector<FormaUiPopover>(".presentation-deck-soundtrack")?.close(true);
    const authorization=this.store.captureAuthorizationScope(),artifact=this.store.projection.get().libraryArtifacts.find((candidate)=>candidate.id===this.preferenceKey),url=String(asset.media_url??"");
    if(!authorization||!artifact||!this.releaseAllowed||!url.startsWith("/api/media/"))return;
    const retained=artifact.contentRef?this.store.content.get()[artifact.contentRef]:"";if(authorization.shared&&!retained)return;
    const revision=this.store.events.get().filter((event)=>event.type==="DocumentArtifactEdited"&&String(event.payload.artifact_id??"")===artifact.id).length;
    const digest=retained?Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(retained))),(byte)=>byte.toString(16).padStart(2,"0")).join(""):"";
    if(!this.store.authorizationScopeActive(authorization))return;
    const receipt={type:"DocumentArtifactExported",payload:{artifact_id:artifact.id,artifact_kind:"slides",document_id:this.documentId||artifact.documentId,format:String(asset.media_type??"audio/mpeg"),destination_kind:"soundtrack-companion",artifact_revision:revision,...(digest?{content_sha256:digest}:{}),source_surface:`${this.sourceSurface}-soundtrack`}};
    if(!await this.store.authorizeProjectExport(receipt,authorization)||!this.store.authorizationScopeActive(authorization))return;
    const extension=audioFileExtension(String(asset.media_type??""))??"mp3",link=document.createElement("a");link.href=url;link.download=`${asset.label??artifact.title}.${extension}`;document.body.append(link);link.click();link.remove();
  }
  #syncIndex(total:number){const key=this.#styleKey();if(this.#indexKey!==key){this.#index=readDeckIndex(key);this.#indexKey=key;this.#visualOverflow=false;this.#activeFitKey="";}this.#index=Math.max(0,Math.min(this.#index,Math.max(0,total-1)));return this.#index;}
  #toggleFooter(event:Event){const value=(event.target as HTMLInputElement).checked;if(value!==this.#showFooterLabel)this.#clearExportCompletion();this.#showFooterLabel=value;writeSlideFooterLabelPreference(this.#showFooterLabel);this.requestUpdate();}
  #styleKey(){return this.preferenceKey.trim()||"unscoped";}
  #selectedStyle(presentation:SlidePresentation){const key=this.#styleKey();return this.#styleOverride?.key===key?this.#styleOverride.value:readDeckStyle(key)??presentation.stylePreset;}
  get activePresentation(){const presentation=normalizeSlidePresentation(this.presentation)??applySlideStylePreset(null,"gallery");return applySlideStylePreset(presentation,this.#selectedStyle(presentation));}
  #setStyle(event:Event){const value=(event.target as HTMLSelectElement).value;if(!isSlideStylePresetId(value))return;if(value!==this.activePresentation.stylePreset)this.#clearExportCompletion();const key=this.#styleKey();this.#styleOverride={key,value};this.#visualOverflow=false;writeDeckStyle(key,value);this.dispatchEvent(new CustomEvent("slide-style-changed",{bubbles:true,composed:true,detail:{preferenceKey:this.preferenceKey,stylePreset:value}}));this.requestUpdate();}
  #positionExportMenu(event:MouseEvent){const menu=this.querySelector<HTMLElement>(`#${this.#exportMenuId}`);if(menu)positionNativePopover(event.currentTarget as HTMLButtonElement,menu);}
  #toggleExportMenu(event:ToggleEvent){
    const panel=event.currentTarget as HTMLElement;
    this.#exportMenuOpen=this.isConnected&&panel.matches(":popover-open");
    this.#stopExportPosition?.();this.#stopExportPosition=undefined;
    const trigger=this.querySelector<HTMLButtonElement>(".presentation-deck-export");
    if(this.#exportMenuOpen&&trigger)this.#stopExportPosition=observeNativePopoverPosition(trigger,panel);
    this.requestUpdate();
  }
  #exportFromMenu(format:"pdf"|"powerpoint"|"powerpoint-presenter",items:DocumentArtifactDraftItem[],presentation:SlidePresentation){const menu=this.querySelector<HTMLElement>(`#${this.#exportMenuId}`);if(menu?.matches(":popover-open"))menu.hidePopover();this.querySelector<HTMLButtonElement>(".presentation-deck-export")?.focus({preventScroll:true});return format==="pdf"?this.#downloadPdf(items,presentation):format==="powerpoint-presenter"?this.#downloadPresenterPowerPoint(items,presentation):this.#downloadPowerPoint(items,presentation);}
  #clearExportCompletion(){
    this.#exportCompletion?.dispose();this.#exportCompletion=undefined;
    if(this.#preparedExport)URL.revokeObjectURL(this.#preparedExport.url);
    this.#preparedExport=null;
    if(this.#exportProgress?.stage==="prepared"||this.#exportProgress?.stage==="save-requested")this.#exportProgress=null;
  }
  #savePreparedExport(event:MouseEvent,prepared:PreparedPresentationExport){
    // Default activation of this persistent native link owns the save gesture.
    // It reuses authorized bytes without conversion, a new receipt, or a synthetic click.
    if(event.type!=="click"||event.button!==0||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey){event.preventDefault();return;}
    if(this.#preparedExport!==prepared||this.#exportCompletion!==prepared.owner||this.#exporting||!prepared.owner.current()){
      event.preventDefault();
      if(this.#preparedExport===prepared)this.#clearExportCompletion();
      this.requestUpdate();return;
    }
    if(this.#exportProgress)this.#exportProgress={...this.#exportProgress,stage:"save-requested"};
    this.requestUpdate();
  }
  #captureExportCompletion(authorization:NonNullable<ReturnType<PresentationDeck["store"]["captureAuthorizationScope"]>>,includePresenterNotes=false):ExportCompletionOwner{
    const store=this.store,owner=this.ownerDocument,source=store.captureSourceOwnership();
    const route=store.route.get(),documentId=this.documentId,artifactId=this.preferenceKey,surface=this.sourceSurface;
    const snapshot=()=>{
      const projection=store.projection.get(),artifact=projection.libraryArtifacts.find(candidate=>candidate.id===artifactId);
      const content=artifact?.contentRef?store.content.get()[artifact.contentRef]:null,session=store.session.get();
      const revision=store.events.get().filter(event=>event.type==="DocumentArtifactEdited"&&String(event.payload.artifact_id??"")===artifactId).length;
      return JSON.stringify([projection.documentId,artifact?.id,artifact?.documentId,artifact?.sourceEventId,artifact?.contentRef,artifact?.sequence,artifact?.title,artifact?.settings,content,revision,this.items,this.presentation,this.activePresentation,this.#showFooterLabel,this.deckTitle,
        session?.user.userId,session?.user.role,session?.capabilities,session?.policy,session?.projectContext,session?.impersonation]);
    };
    let original:string|undefined,retired=false;
    try{original=snapshot();}catch{retired=true;}
    const current=()=>{
      try{if(!retired&&this.isConnected&&this.ownerDocument===owner&&this.store===store&&this.releaseAllowed
        &&store.sourceOwnershipActive(source)&&store.authorizationScopeActive(authorization)&&store.route.get()===route
        &&this.documentId===documentId&&this.preferenceKey===artifactId&&this.sourceSurface===surface&&snapshot()===original
        &&(!store.session.get()?.projectContext?.expiresAt||Date.parse(store.session.get()!.projectContext!.expiresAt)>Date.now())
        &&(!includePresenterNotes||this.#presenterExportAllowed()))return true;
      }catch{/* A withdrawn deck cannot keep or save previously prepared bytes. */}
      retired=true;return false;
    };
    // Latch retirement at the store notification, even if it returns before the next render.
    const unsubscribe=store.subscribe(()=>{
      if(current())return;
      if(this.#exportCompletion===completion){this.#clearExportCompletion();this.requestUpdate();}
      else completion.dispose();
    });
    const completion={current,dispose:()=>{retired=true;unsubscribe();}};
    return completion;
  }
  #captureExportFocus(controller:AbortController,authorization:NonNullable<ReturnType<PresentationDeck["store"]["captureAuthorizationScope"]>>){
    const store=this.store,owner=this.ownerDocument,ownerWindow=owner.defaultView,source=store.captureSourceOwnership();
    const trigger=this.querySelector<HTMLButtonElement>(".presentation-deck-export");
    if(!ownerWindow||!source||!trigger)return undefined;
    const route=store.route.get(),documentId=this.documentId,artifactId=this.preferenceKey,surface=this.sourceSurface;
    const snapshot=()=>{
      const projection=store.projection.get(),artifact=projection.libraryArtifacts.find(candidate=>candidate.id===artifactId);
      const content=artifact?.contentRef?store.content.get()[artifact.contentRef]:null;
      const revision=store.events.get().filter(event=>event.type==="DocumentArtifactEdited"&&String(event.payload.artifact_id??"")===artifactId).length;
      return JSON.stringify([projection.documentId,artifact?.id,artifact?.documentId,artifact?.sourceEventId,artifact?.contentRef,artifact?.sequence,content,revision,this.items,this.presentation,this.activePresentation,this.#showFooterLabel]);
    };
    let original:string;
    try{original=snapshot();}catch{return undefined;}
    let closed=false,departed=false,canceled=false;
    let focus:ReturnType<typeof captureOutputNavigationFocus>|undefined;
    const current=()=>{
      try{return !closed&&this.isConnected&&this.ownerDocument===owner&&this.store===store
        &&this.#exportAbort===controller&&this.releaseAllowed&&owner.visibilityState==="visible"&&owner.hasFocus()
        &&store.sourceOwnershipActive(source)&&store.authorizationScopeActive(authorization)&&store.route.get()===route
        &&this.documentId===documentId&&this.preferenceKey===artifactId&&this.sourceSurface===surface&&snapshot()===original
        &&trigger.isConnected&&trigger.ownerDocument===owner&&this.querySelector(".presentation-deck-export")===trigger;
      }catch{return false;}
    };
    const visible=()=>!trigger.closest("[hidden],[inert],[aria-hidden='true']")&&trigger.getClientRects().length>0
      &&trigger.checkVisibility({checkOpacity:true,checkVisibilityCSS:true});
    if(current()&&!trigger.disabled&&visible()&&owner.activeElement===trigger)focus=captureOutputNavigationFocus(owner);
    const depart=()=>{departed=true;focus?.dispose();};
    const visibility=()=>{if(owner.visibilityState!=="visible")depart();};
    ownerWindow.addEventListener("blur",depart);
    owner.addEventListener("visibilitychange",visibility);
    const dispose=()=>{if(closed)return;closed=true;focus?.dispose();ownerWindow.removeEventListener("blur",depart);owner.removeEventListener("visibilitychange",visibility);};
    return{controller,dispose,
      cancel:(event:MouseEvent)=>{
        const control=event.currentTarget as HTMLButtonElement|null;
        if(!current()||!this.#exporting||!control||control!==this.querySelector(".presentation-deck-export-cancel")
          ||!control.isConnected||control.disabled||owner.activeElement!==control)return;
        // Deliberate Cancel removes its own focused control; it owns a fresh return.
        focus?.dispose();departed=false;focus=captureOutputNavigationFocus(owner);canceled=true;
      },
      restore:async(prepared:boolean)=>{
        try{
          await this.updateComplete;
          if(!prepared&&!canceled)return;
          const ready=()=>!departed&&current()&&!this.#exporting&&!trigger.disabled&&visible()&&Boolean(focus?.current());
          if(ready())focus!.run(trigger,()=>{if(!ready())return false;trigger.focus({preventScroll:true});return ready()&&owner.activeElement===trigger;});
        }catch{/* Failed or withdrawn UI cannot acquire focus or replace the export outcome. */}
        finally{dispose();}
      },
    };
  }
  async #finishExport(controller:AbortController,focus:ExportFocusReturn|undefined,preparedReady:boolean){
    if(this.#exportAbort!==controller){focus?.dispose();return;}
    this.#exporting=false;
    const prepared=this.#preparedExport&&this.#exportCompletion===this.#preparedExport.owner&&this.#preparedExport.owner.current();
    if(this.#exportProgress?.stage!=="failed"&&!prepared)this.#exportProgress=null;
    if(!prepared)this.#clearExportCompletion();
    try{this.requestUpdate();await focus?.restore(preparedReady);}
    catch{
      // Retry only the enabled-state render, never conversion or authorization.
      // A failed render must not strand a prepared file behind a disabled trigger.
      if(this.#exportAbort===controller)try{this.requestUpdate();}catch{/* A persistent render failure keeps its exact bytes until owner retirement. */}
    }
    finally{
      if(this.#exportAbort===controller)this.#exportAbort=undefined;
      if(this.#exportFocus===focus)this.#exportFocus=undefined;
      focus?.dispose();
    }
  }
  async #fullscreen(){try{if(document.fullscreenElement===this)await document.exitFullscreen();else if(typeof this.requestFullscreen==="function"){if(this.#view!=="slideshow")this.#setView("slideshow");await this.requestFullscreen();}}catch{this.store.toast("Fullscreen presentation is unavailable in this browser.");}}
  #touchBegin(event:PointerEvent){if(event.pointerType==="touch")this.#touchStart={x:event.clientX,y:event.clientY};}
  #touchEnd(event:PointerEvent,total:number){if(event.pointerType!=="touch"||!this.#touchStart)return;const horizontal=event.clientX-this.#touchStart.x,vertical=event.clientY-this.#touchStart.y;this.#touchStart=null;if(Math.abs(horizontal)<48||Math.abs(horizontal)<Math.abs(vertical)*1.5)return;const rtl=this.matches(":dir(rtl)");this.#setIndex(this.#index+(horizontal<0===!rtl?1:-1),total);}
  #evidence(item:DocumentArtifactDraftItem):DeckEvidence{
    const projection=this.store.projection.get(),documentId=this.documentId||projection.documentId;
    const blocks=ideasInDocument(projection,documentId);
    const authorized=new Map<string,{label:string;kind:"Source decision"|"Combined context"}>();
    for(const block of blocks){const label=visibleSourceLabel(String(block.properties.label??block.handle??block.type),this.i18n.system("Authorized source"));authorized.set(block.id,{label,kind:"Source decision"});for(const membership of combinedContextMemberships(block.properties))if(!authorized.has(membership.contextSetId))authorized.set(membership.contextSetId,{label:visibleSourceLabel(membership.name,this.i18n.system("Authored context")),kind:"Combined context"});}
    const slide=item.slide as DeckVisual|null,citations=slide?.citations??[],references=[...new Set([...(item.context_group_ids??[]),...(slide?.sourceIds??[]),...(slide?.visual.data.flatMap((entry)=>(entry as DeckVisualDatum).sourceIds??[])??[]),...(slide?.quote?.sourceId?[slide.quote.sourceId]:[]),...citations.flatMap((citation)=>citation.sourceId?[citation.sourceId]:[])])];
    const sources:DeckEvidence["sources"]=[],labels=new Set<string>();let unresolved=false;
    for(const reference of references){
      const source=authorized.get(reference);if(!source){unresolved=true;continue;}
      const matches=authorizedPresentationCitations(citations,reference,source.label);
      for(const citation of matches.length?matches:[undefined]){
        const key=`${source.kind}:${source.label}:${citation?.label??""}:${citation?.anchor??""}:${citation?.excerpt??""}`;
        if(labels.has(key))continue;
        labels.add(key);
        const anchor=citation?.anchor??"";
        sources.push({...source,citationLabel:visibleSourceLabel(citation?.label??"",""),anchor:OPAQUE_SOURCE_LABEL.test(anchor.trim())?"":anchor,excerpt:citation?.excerpt??""});
      }
    }
    if(citations.length&&!sources.length)unresolved=true;
    return{sources,unresolved};
  }
  #reader(item:DocumentArtifactDraftItem,index:number,standalone=false){
    const delivery=presentationAudienceItem(item),slide=delivery.slide as DeckVisual|null,quote=slide?.quote,evidence=this.#evidence(item),visual=slide?.visual as (DeckVisual["visual"]&{exactValue?:string;displayValue?:string;unit?:string})|undefined;
    const attribution=quote?[...new Set([quote.speaker,quote.role].filter(Boolean))].join(" · "):"";
    const showNumericPrecision=Boolean(visual&&visual.kind!=="roadmap"&&visual.kind!=="timeline"&&(visual.exactValue||visual.displayValue));
    const visualSummary=visual?.value||(visual&&(visual.kind==="roadmap"||visual.kind==="timeline")?formatPresentationQuantity(visual.displayValue??visual.exactValue,visual.unit,{numericOnly:true}):"");
    const quoteCitation=quote?.citation?visibleSourceLabel(quote.citation,this.i18n.system("Authorized source")):"";
    const content=html`<article class="presentation-deck-reader-content" aria-label=${this.i18n.system("Complete reading version of slide {count}", { count: this.i18n.number(index+1) })}><h3 dir="auto">${delivery.title}</h3>${delivery.body?html`<p dir="auto">${delivery.body}</p>`:nothing}${slide?.bullets.length?html`<ul>${slide.bullets.map((bullet)=>html`<li dir="auto">${bullet}</li>`)}</ul>`:nothing}${quote?.text?html`<blockquote><p dir="auto">${quote.text}</p>${attribution?html`<footer><cite dir="auto">${attribution}</cite></footer>`:nothing}${quoteCitation?html`<p dir="auto">${quoteCitation}</p>`:nothing}</blockquote>`:nothing}${visual&&(visualSummary||visual.data.length||showNumericPrecision)?html`<figure><figcaption dir="auto">${visual.label||this.i18n.system("Slide evidence")}</figcaption>${visualSummary?html`<p dir="auto">${visualSummary}</p>`:nothing}${showNumericPrecision?html`<dl>${visual.exactValue?html`<dt>Exact value</dt><dd>${formatPresentationQuantity(visual.exactValue,visual.unit,{numericOnly:true})}</dd>`:nothing}${visual.displayValue?html`<dt>Rounded display value</dt><dd>${formatPresentationQuantity(visual.displayValue,visual.unit,{numericOnly:true})}</dd>`:nothing}</dl>`:nothing}${visual.data.length?html`<dl>${visual.data.map((entry)=>{const datum=entry as DeckVisualDatum;return html`<dt dir="auto">${datum.label}</dt><dd dir="auto">${datum.displayValue??datum.value}${datum.exactValue&&datum.exactValue!==(datum.displayValue??datum.value)?html` <span>(exact: ${datum.exactValue})</span>`:nothing}</dd>`;})}</dl>`:nothing}</figure>`:nothing}<details class="presentation-deck-evidence presentation-deck-reader"><summary>Authorized source evidence</summary>${evidence.sources.length?html`<ul>${evidence.sources.map((source)=>html`<li><span class="presentation-deck-source-chip">${this.i18n.system(source.kind)}</span> <strong dir="auto">${source.label}</strong>${source.citationLabel&&source.citationLabel!==source.label?html` <span dir="auto">${source.citationLabel}</span>`:nothing}${source.anchor?html` <span dir="auto">${localizedSourceAnchor(source.anchor,(label,values)=>this.i18n.system(label,values),(value)=>this.i18n.number(value))}</span>`:nothing}${source.excerpt?html`<p dir="auto">${source.excerpt}</p>`:nothing}</li>`)}</ul>`:html`<p>No authorized source evidence was retained for this slide.</p>`}${evidence.unresolved?html`<p role="status" aria-live="polite" aria-atomic="true">Some source references could not be verified against this document.</p>`:nothing}</details>${item.notes?html`<details class="presentation-deck-notes"><summary>Speaker notes</summary><p dir="auto">${item.notes}</p></details>`:nothing}</article>`;
    if(standalone)return html`<section class="presentation-deck-reading" tabindex="0">${content}</section>`;
    return html`<details class="presentation-deck-reader"><summary>Read slide ${index+1} and inspect evidence</summary>${content}</details>`;
  }
  #audienceLocalization(items:DocumentArtifactDraftItem[]){
    const source=items.map((item)=>[item.title,item.body,item.notes,...(item.slide?.bullets??[])].join(" ")).join("\n");
    const language=inferPresentationAudienceLocale(source,this.i18n.locale);
    const matchesInterface=language.split("-")[0]===this.i18n.locale.split("-")[0];
    const translate=(value:string,variables?:Record<string,string|number>)=>matchesInterface?this.i18n.system(value,variables):value.replace(/\{(\w+)\}/g,(_,key:string)=>String(variables?.[key]??""));
    const number=(value:number)=>matchesInterface?this.i18n.number(value):new Intl.NumberFormat(language).format(value);
    const direction:"ltr"|"rtl"=/^ar(?:-|$)/i.test(language)?"rtl":"ltr";
    return{language,direction,translate,number};
  }
  async #downloadPdf(items:DocumentArtifactDraftItem[],presentation:SlidePresentation){
    if(this.#exporting||!this.releaseAllowed)return;
    const authorization=this.store.captureAuthorizationScope(),scoped=authorization?.shared??false,artifactId=this.preferenceKey,documentId=this.documentId||this.store.projection.get().documentId;
    if(!authorization||!artifactId)return;
    this.#clearExportCompletion();
    const completion=this.#captureExportCompletion(authorization);
    this.#exportCompletion=completion;
    const controller=new AbortController();
    this.#exportFocus?.dispose();
    this.#exportAbort=controller;
    const focus=this.#captureExportFocus(controller,authorization);
    this.#exportFocus=focus;
    this.#exporting=true;
    this.#exportProgress={stage:"preparing",completed:0,total:items.length};
    let preparedReady=false;
    try{
      this.requestUpdate();
      const artifact=this.store.projection.get().libraryArtifacts.find((candidate)=>candidate.id===artifactId),retained=artifact?.contentRef?this.store.content.get()[artifact.contentRef]:"";
      if(scoped&&!retained){
        const message=this.i18n.system("The latest approved presentation is unavailable.");
        this.#exportProgress={stage:"failed",completed:0,total:items.length,message};
        return;
      }
      const revision=this.store.events.get().filter((event)=>event.type==="DocumentArtifactEdited"&&String(event.payload.artifact_id??"")===artifactId).length;
      const{renderPresentationPdf}=await import("./presentation-pdf-export");
      if(controller.signal.aborted||!this.store.authorizationScopeActive(authorization)||this.#exportCompletion!==completion||!completion.current())return;
      const onProgress=(progress:{stage:"preparing"|"rendering"|"finalizing";completed:number;total:number})=>{
        if(!this.store.authorizationScopeActive(authorization)||this.#exportCompletion!==completion||!completion.current()){
          controller.abort();
          return;
        }
        this.#exportProgress=progress;
        this.requestUpdate();
      };
      const audience=this.#audienceLocalization(items),options={title:this.deckTitle.trim()||audience.translate("Slide deck"),showFooterLabel:this.#showFooterLabel,...audience,onProgress,signal:controller.signal};
      const result=await renderPresentationPdf(items,presentation,options);
      if(controller.signal.aborted||!this.store.authorizationScopeActive(authorization)||this.#exportCompletion!==completion||!completion.current())return;
      const digest=retained?Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(retained))),(byte)=>byte.toString(16).padStart(2,"0")).join(""):"";
      if(controller.signal.aborted||!this.store.authorizationScopeActive(authorization)||this.#exportCompletion!==completion||!completion.current())return;
      const receipt={type:"DocumentArtifactExported",payload:{artifact_id:artifactId,artifact_kind:"slides",document_id:documentId,format:"application/pdf",destination_kind:"pdf",page_count:result.pageCount,artifact_revision:revision,...(digest?{content_sha256:digest}:{}),style_preset:presentation.stylePreset,render_mode:"browser-slide-capture",source_surface:this.sourceSurface}};
      if(!await this.store.authorizeProjectExport(receipt,authorization))return;
      if(controller.signal.aborted||this.#exportCompletion!==completion||!completion.current())return;
      const blob=new Blob([result.bytes as Uint8Array<ArrayBuffer>],{type:"application/pdf"}),url=URL.createObjectURL(blob);
      this.#preparedExport={owner:completion,url,filename:result.filename,format:"pdf"};
      this.#exportProgress={stage:"prepared",completed:result.pageCount,total:result.pageCount,format:"pdf"};
      preparedReady=true;
    }catch(error){
      if(controller.signal.aborted||!this.store.authorizationScopeActive(authorization)||this.#exportCompletion!==completion||!completion.current())return;
      console.error("Slide PDF export failed",error);
      const message=error instanceof Error&&/visible clipping/.test(error.message)
        ?this.i18n.t("presentation.export.pdfClipped")
        :this.i18n.t("presentation.export.pdfFailed");
      this.#exportProgress={stage:"failed",completed:this.#exportProgress?.completed??0,total:items.length,message};
    }finally{
      await this.#finishExport(controller,focus,preparedReady);
    }
  }
  async #downloadPowerPoint(items:DocumentArtifactDraftItem[],presentation:SlidePresentation){return this.#downloadPowerPointVariant(items,presentation,false);}
  async #downloadPresenterPowerPoint(items:DocumentArtifactDraftItem[],presentation:SlidePresentation){return this.#downloadPowerPointVariant(items,presentation,true);}
  #presenterExportAllowed(artifact=this.store.projection.get().libraryArtifacts.find((candidate)=>candidate.id===this.preferenceKey)){
    if(!artifact)return false;
    const events=this.store.events.get(),completed=events.find((event)=>event.eventId===artifact.sourceEventId);
    const rendered=[...events].reverse().find((event)=>event.type==="DocumentRenderRequested"&&String(event.payload.artifact_id??"")===artifact.id);
    const renderedBy=rendered?.actor.startsWith("user:")?rendered.actor.slice(5):"";
    const session=this.store.session.get();
    return Boolean(session&&!session.impersonation&&(!session.projectContext||String(completed?.payload.requested_by_user_id??renderedBy)===session.user.userId));
  }
  async #downloadPowerPointVariant(items:DocumentArtifactDraftItem[],presentation:SlidePresentation,includePresenterNotes:boolean){
    if(this.#exporting||!this.releaseAllowed)return;const authorization=this.store.captureAuthorizationScope(),scoped=authorization?.shared??false,artifactId=this.preferenceKey,documentId=this.documentId||this.store.projection.get().documentId;if(!authorization||scoped&&!artifactId)return;
    this.#clearExportCompletion();
    const completion=this.#captureExportCompletion(authorization,includePresenterNotes);
    this.#exportCompletion=completion;
    const controller=new AbortController();
    this.#exportFocus?.dispose();
    this.#exportAbort=controller;
    const focus=this.#captureExportFocus(controller,authorization);
    this.#exportFocus=focus;
    this.#exporting=true;
    this.#exportProgress={stage:"preparing",completed:0,total:items.length};
    let preparedReady=false;
    try{
      this.requestUpdate();
      const artifact=this.store.projection.get().libraryArtifacts.find((candidate)=>candidate.id===artifactId);
      const retained=artifact?.contentRef?this.store.content.get()[artifact.contentRef]:"";
      if(scoped&&!retained){
        const message=this.i18n.system("The latest approved presentation is unavailable.");
        this.#exportProgress={stage:"failed",completed:0,total:items.length,message};
        return;
      }
      const events=this.store.events.get(),revision=events.filter((event)=>event.type==="DocumentArtifactEdited"&&String(event.payload.artifact_id??"")===artifactId).length;
      if(includePresenterNotes&&!this.#presenterExportAllowed(artifact))return;
      const{createPowerPointDocumentAsync,POWERPOINT_DOCUMENT_MIME}=await import("../model/office-documents");
      if(controller.signal.aborted||!this.store.authorizationScopeActive(authorization)||this.#exportCompletion!==completion||!completion.current())return;
      const audience=this.#audienceLocalization(items);
      const onProgress=(progress:{stage:"preparing"|"rendering"|"finalizing";completed:number;total:number})=>{
        if(!this.store.authorizationScopeActive(authorization)||this.#exportCompletion!==completion||!completion.current()){
          controller.abort();
          return;
        }
        this.#exportProgress=progress;
        this.requestUpdate();
      };
      const bytes=await createPowerPointDocumentAsync(items,presentation,{title:this.deckTitle.trim()||audience.translate("Slide deck"),showFooterLabel:this.#showFooterLabel,includePresenterNotes,...audience,onProgress,signal:controller.signal});
      if(controller.signal.aborted||!this.store.authorizationScopeActive(authorization)||this.#exportCompletion!==completion||!completion.current())return;
      const digest=retained?Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(retained))),(byte)=>byte.toString(16).padStart(2,"0")).join(""):"";
      if(controller.signal.aborted||!this.store.authorizationScopeActive(authorization)||this.#exportCompletion!==completion||!completion.current())return;
      const receipt={type:"DocumentArtifactExported",payload:{artifact_id:artifactId,artifact_kind:"slides",document_id:documentId,format:POWERPOINT_DOCUMENT_MIME,destination_kind:"powerpoint",page_count:items.length,artifact_revision:revision,...(digest?{content_sha256:digest}:{}),style_preset:presentation.stylePreset,render_mode:"editable-office-shapes",presenter_notes_included:includePresenterNotes,source_surface:this.sourceSurface}};
      if(!await this.store.authorizeProjectExport(receipt,authorization))return;
      if(controller.signal.aborted||this.#exportCompletion!==completion||!completion.current())return;
      const blob=new Blob([bytes as Uint8Array<ArrayBuffer>],{type:POWERPOINT_DOCUMENT_MIME}),url=URL.createObjectURL(blob);
      const format=includePresenterNotes?"powerpoint-presenter":"powerpoint";
      const audienceFilename=presentationEditableExportFilename(this.deckTitle.trim()||this.i18n.system("Slide deck"),this.i18n.locale);
      this.#preparedExport={owner:completion,url,filename:includePresenterNotes?audienceFilename.replace(/\.pptx$/u,"-presenter.pptx"):audienceFilename,format};
      this.#exportProgress={stage:"prepared",completed:items.length,total:items.length,format};
      preparedReady=true;
    }catch(error){
      if(controller.signal.aborted||!this.store.authorizationScopeActive(authorization)||this.#exportCompletion!==completion||!completion.current())return;
      console.error("Editable slide export failed",error);
      const message=this.i18n.t("presentation.export.powerpointFailed");
      this.#exportProgress={stage:"failed",completed:this.#exportProgress?.completed??0,total:items.length,message};
    }finally{
      await this.#finishExport(controller,focus,preparedReady);
    }
  }
  #key(event:KeyboardEvent,total:number){
    if(this.#view!=="slideshow"||!total||event.defaultPrevented||event.isComposing||event.metaKey||event.ctrlKey||event.altKey)return;
    const target=event.target as Element|null;if(target?.closest("input,textarea,select,audio,video,[contenteditable='true']"))return;
    if(target?.closest(".presentation-deck-reading")&&["ArrowUp","ArrowDown","PageUp","PageDown","Home","End"].includes(event.key))return;
    if(event.key==="ArrowLeft"||event.key==="ArrowRight"){event.preventDefault();const previous=this.matches(":dir(rtl)")?"ArrowRight":"ArrowLeft";this.#setIndex(this.#index+(event.key===previous?-1:1),total);}
    else if(event.key==="ArrowUp"||event.key==="PageUp"){event.preventDefault();this.#setIndex(this.#index-1,total);}
    else if(event.key==="ArrowDown"||event.key==="PageDown"){event.preventDefault();this.#setIndex(this.#index+1,total);}
    else if(event.key==="Home"||event.key==="End"){event.preventDefault();this.#setIndex(event.key==="Home"?0:total-1,total);}
  }
  #slide(item:DocumentArtifactDraftItem,presentation:SlidePresentation,index:number,total:number){return html`<div class="presentation-deck-frame"><forma-presentation-slide .item=${item} .presentation=${presentation} .index=${index} .total=${total} .showFooterLabel=${this.#showFooterLabel}></forma-presentation-slide></div>`;}
  #renderExportProgress(){
    const progress=this.#exportProgress;
    if(!progress)return nothing;
    const failed=progress.stage==="failed",prepared=this.#preparedExport,ready=progress.stage==="prepared"||progress.stage==="save-requested",total=Math.max(0,progress.total),completed=Math.max(0,Math.min(progress.completed,total));
    const count=total?this.i18n.system("{count} of {total}",{count:this.i18n.number(completed),total:this.i18n.number(total)}):"";
    const label=ready?this.i18n.t(progress.format==="powerpoint"?"presentation.export.audiencePrepared":progress.format==="powerpoint-presenter"?"presentation.export.presenterPrepared":"presentation.export.pdfPrepared","",{count:this.i18n.number(total)}):progress.message??(failed?this.i18n.t("job.progress.failed"):progress.stage==="preparing"?this.i18n.system("Preparing export…"):progress.stage==="rendering"?this.i18n.t("job.progress.rendering"):this.i18n.t("job.progress.finalizing"));
    const saveAllowed=Boolean(ready&&prepared&&this.#exportCompletion===prepared.owner&&!this.#exporting&&prepared.owner.current());
    const saveLabel=this.i18n.t(prepared?.format==="powerpoint"?"presentation.export.savePreparedPowerpoint":prepared?.format==="powerpoint-presenter"?"presentation.export.savePreparedPresenter":"presentation.export.savePreparedPdf");
    const determinate=progress.stage!=="preparing"&&total>0;
    return html`<section id=${`${this.#exportMenuId}-status`} class="presentation-deck-export-status" data-export-stage=${progress.stage} role=${failed?"alert":"status"} aria-live=${failed?"assertive":"polite"} aria-atomic="true">
      <div class="presentation-deck-export-status-heading"><span class="presentation-deck-export-status-label">${label}</span>${!failed&&!ready&&total?html`<span class="presentation-deck-export-status-count">${count}</span>`:nothing}${!failed&&!ready&&this.#exporting?html`<button type="button" class="button secondary compact presentation-deck-export-cancel" @click=${(event:MouseEvent)=>{this.#exportFocus?.cancel(event);this.#exportAbort?.abort();}}>${this.i18n.t("action.cancel")}</button>`:nothing}</div>
      ${ready&&prepared?html`<a class="button primary presentation-deck-export-save" href=${saveAllowed?prepared.url:nothing} download=${prepared.filename} aria-disabled=${String(!saveAllowed)} tabindex="0"
        @click=${(event:MouseEvent)=>this.#savePreparedExport(event,prepared)} @auxclick=${(event:MouseEvent)=>this.#savePreparedExport(event,prepared)}>${saveLabel}</a>
        <p>${this.i18n.t(progress.stage==="save-requested"?"presentation.export.saveRequested":"presentation.export.preparedHint")}</p>`:failed?html`<button type="button" class="button secondary compact presentation-deck-export-retry" @click=${()=>{const trigger=this.querySelector<HTMLButtonElement>(".presentation-deck-export");trigger?.focus({preventScroll:true});trigger?.click();}}>${this.i18n.t("action.retry")}</button>`:determinate?html`<progress max=${total} value=${completed} aria-label=${this.i18n.t("status.progress")} aria-valuetext=${count}></progress>`:html`<progress aria-label=${this.i18n.t("status.progress")}></progress>`}
    </section>`;
  }
  override render(){const items=this.items.map((item,index)=>normalizeSlideItem(item,index)),total=items.length,generatedPresentation=normalizeSlidePresentation(this.presentation)??applySlideStylePreset(null,"gallery"),selectedStyle=this.#selectedStyle(generatedPresentation),presentation=applySlideStylePreset(generatedPresentation,selectedStyle),styleDefinition=slideStylePresetDefinition(selectedStyle),index=this.#syncIndex(total),current=items[index],preferenceFormId=`presentation-deck-preferences-${this.#styleKey()}`;const fitKey=current?presentationSlideRenderKey(current,presentation,index,total,this.#showFooterLabel,false,this.i18n.locale):"";if(fitKey!==this.#activeFitKey){this.#activeFitKey=fitKey;this.#visualOverflow=false;}const reading=this.#view==="slideshow"&&presentationUsesReadingView({contentOverflows:this.#visualOverflow,readingPreference:this.#readingOverride,viewportRequiresReading:this.#automaticReading});const readingLabel=this.i18n.system(reading?"Slide view":"Read slide");const artifact=this.store.projection.get().libraryArtifacts.find((candidate)=>candidate.id===this.preferenceKey);const soundtracks=soundtrackCompanions(artifact?.settings.soundtrack_assets);const renderSoundtrackCompanions=(value:Parameters<typeof renderAudioCompanions>[0],locale:Parameters<typeof renderAudioCompanions>[1],options:Parameters<typeof renderAudioCompanions>[2]={})=>renderAudioCompanions(value,locale,{...options,...(this.releaseAllowed?{onDownload:(asset:SoundtrackAsset)=>void this.#downloadSoundtrack(asset)}:{})});return html`<section class=${`presentation-deck presentation-deck--${this.#view}${this.#exportProgress?" presentation-deck--export-status":""}${reading?" presentation-deck--reading":""}${this.#fullscreenActive?" presentation-deck--fullscreen":""}`} aria-label="Slide deck" tabindex="0" @keydown=${(event:KeyboardEvent)=>this.#key(event,total)}>
    <form id=${preferenceFormId} hidden @submit=${(event:SubmitEvent)=>event.preventDefault()}></form>
    <header class="presentation-deck-toolbar" data-tools-open=${String(this.#compactToolsOpen)}>
      <button type="button" class="button ghost compact presentation-deck-tools-toggle" aria-label=${this.i18n.system("Slideshow controls")} title=${this.i18n.system("Slideshow controls")} aria-expanded=${String(this.#compactToolsOpen)} aria-controls=${`${this.#exportMenuId}-view ${this.#exportMenuId}-delivery`} @click=${()=>{this.#compactToolsOpen=!this.#compactToolsOpen;this.requestUpdate();}}>${icon("dots")}</button>
      <div id=${`${this.#exportMenuId}-view`}>
        <div class="presentation-deck-view-switch" role="group" aria-label="Slide view"><button type="button" aria-pressed=${this.#view==="list"} @click=${()=>this.#setView("list")}>List</button><button type="button" aria-pressed=${this.#view==="slideshow"} @click=${()=>this.#setView("slideshow")}>Slideshow</button></div>
        ${this.#view==="slideshow"?html`<label class="presentation-deck-jump presentation-deck-jump--compact"><span>Slide</span><select form=${preferenceFormId} aria-label="Jump to slide" .value=${String(index)} @change=${(event:Event)=>this.#setIndex(Number((event.currentTarget as HTMLSelectElement).value),total)}>${items.map((item,itemIndex)=>html`<option value=${String(itemIndex)} ?selected=${itemIndex===index}>${itemIndex+1}. ${item.title}</option>`)}</select></label>`:nothing}
        <label class="presentation-deck-style"><span>Style</span><select form=${preferenceFormId} aria-label="Slide style" title=${this.i18n.system(styleDefinition.description)} .value=${selectedStyle} @change=${this.#setStyle}>${SLIDE_STYLE_PRESETS.map((preset)=>html`<option value=${preset.id} ?selected=${preset.id===selectedStyle}>${this.i18n.system(preset.label)}</option>`)}</select></label>
        ${this.#view==="slideshow"&&typeof this.requestFullscreen==="function"?html`<button type="button" class="button secondary compact presentation-deck-presenter" aria-pressed=${this.#fullscreenActive} @click=${()=>void this.#fullscreen()}>${this.#fullscreenActive?this.i18n.system("Exit full screen"):this.i18n.system("Present full screen")}</button>`:nothing}
        ${soundtracks.length?html`<forma-ui-popover class="presentation-deck-soundtrack" .label=${this.i18n.t("audio.soundtrack.label","Optional soundtrack")} .content=${renderSoundtrackCompanions(soundtracks,this.i18n,{followCues:this.#followSoundtrackCues,onFollowCues:(enabled)=>{this.#followSoundtrackCues=enabled;this.requestUpdate();}})}></forma-ui-popover>`:nothing}
      </div>
      <div id=${`${this.#exportMenuId}-delivery`}>
        ${presentation.footerLabel?html`<label class="artifact-slide-footer-toggle" title="Use the document-derived deck label in each slide footer"><input form=${preferenceFormId} type="checkbox" .checked=${this.#showFooterLabel} @change=${this.#toggleFooter}><span>Show deck label</span></label>`:nothing}
        <button type="button" class="button secondary compact presentation-deck-export" popovertarget=${this.#exportMenuId} aria-controls=${this.#exportMenuId} aria-expanded=${this.#exportMenuOpen} aria-describedby=${this.#exportProgress?`${this.#exportMenuId}-status`:nothing} aria-busy=${String(this.#exporting)} title=${this.releaseAllowed?this.i18n.system("Export"):this.i18n.system("An independent reviewer must approve this output before it can leave the project")} ?disabled=${this.#exporting||!total||!this.releaseAllowed} @click=${this.#positionExportMenu}>${icon("download")} ${this.#exporting?this.i18n.system("Preparing export…"):this.i18n.system("Export")}</button>
        <div id=${this.#exportMenuId} class="presentation-deck-export-menu" popover="auto" role="group" aria-label=${this.i18n.system("Export")} @toggle=${this.#toggleExportMenu}><button type="button" title=${this.i18n.system("Download the presentation as a PDF")} ?disabled=${this.#exporting||!total||!this.releaseAllowed} @click=${()=>void this.#exportFromMenu("pdf",items,presentation)}>${this.i18n.system("Download PDF")}</button><button type="button" title=${this.i18n.t("presentation.export.powerpointHint")} ?disabled=${this.#exporting||!total||!this.releaseAllowed} @click=${()=>void this.#exportFromMenu("powerpoint",items,presentation)}>${this.i18n.t("presentation.export.powerpoint")}</button>${this.#presenterExportAllowed(artifact)?html`<button type="button" title=${this.i18n.t("presentation.export.presenterPowerpointHint")} ?disabled=${this.#exporting||!total||!this.releaseAllowed} @click=${()=>void this.#exportFromMenu("powerpoint-presenter",items,presentation)}>${this.i18n.t("presentation.export.presenterPowerpoint")}</button>`:nothing}</div>
        <span class="presentation-deck-count">${this.#view==="slideshow"&&total?this.i18n.system("{count} of {total}", { count: this.i18n.number(index+1), total: this.i18n.number(total) }):(total===1 ? this.i18n.system("{total} slide", { total: this.i18n.number(total) }) : this.i18n.system("{total} slides", { total: this.i18n.number(total) }))}</span>
      </div>
    </header>
    ${this.#renderExportProgress()}
    <span class="sr-only" role="status" aria-live="polite" aria-atomic="true">${this.#view==="slideshow"&&current?this.i18n.system("Slide {count} of {total}: {title}", { count: this.i18n.number(index+1), total: this.i18n.number(total), title: current.title }):(total===1 ? this.i18n.system("{total} slide available", { total: this.i18n.number(total) }) : this.i18n.system("{total} slides available", { total: this.i18n.number(total) }))}</span>
    ${!total?html`<div class="presentation-deck-empty">No slides are available.</div>`:this.#view==="list"?html`<ol class="presentation-deck-list">${items.map((item,itemIndex)=>html`<li aria-current=${itemIndex===index?"true":nothing}><div class="presentation-deck-list-header"><button type="button" class="button secondary compact" @click=${()=>{this.#setIndex(itemIndex,total);this.#setView("slideshow");void this.updateComplete.then(()=>this.querySelector<HTMLElement>(".presentation-deck-stage")?.focus());}}>Present slide ${itemIndex+1}</button></div>${this.#slide(item,presentation,itemIndex,total)}${item.notes?html`<details class="presentation-deck-notes"><summary>Slide ${itemIndex+1} notes</summary><p dir="auto">${item.notes}</p></details>`:nothing}${this.#reader(item,itemIndex)}</li>`)}</ol>`:html`<div class="presentation-deck-stage" data-slide-posture=${reading?"reading":"visual"} tabindex="-1" @pointerdown=${this.#touchBegin} @pointerup=${(event:PointerEvent)=>this.#touchEnd(event,total)} @pointercancel=${()=>{this.#touchStart=null;}}><div class="presentation-deck-viewport" @presentation-slide-fit=${this.#slideFit}>${current?(reading?this.#reader(current,index,true):this.#slide(current,presentation,index,total)):nothing}</div><nav aria-label="Slideshow controls"><button type="button" aria-label=${this.i18n.system("Previous")} aria-keyshortcuts=${this.matches(":dir(rtl)")?"ArrowRight PageUp":"ArrowLeft PageUp"} ?disabled=${index===0} @click=${()=>this.#setIndex(index-1,total)}>${icon(this.matches(":dir(rtl)")?"next":"previous")}<span class="presentation-deck-navigation-label">${this.i18n.system("Previous")}</span></button><label class="presentation-deck-jump"><span>Slide</span><select form=${preferenceFormId} aria-label="Jump to slide" .value=${String(index)} @change=${(event:Event)=>this.#setIndex(Number((event.currentTarget as HTMLSelectElement).value),total)}>${items.map((item,itemIndex)=>html`<option value=${String(itemIndex)} ?selected=${itemIndex===index}>${itemIndex+1}. ${item.title}</option>`)}</select></label><span class="presentation-deck-position" aria-hidden="true">${index+1} / ${total}</span><button type="button" aria-label=${this.i18n.system("Next")} aria-keyshortcuts=${this.matches(":dir(rtl)")?"ArrowLeft PageDown":"ArrowRight PageDown"} ?disabled=${index===total-1} @click=${()=>this.#setIndex(index+1,total)}><span class="presentation-deck-navigation-label">${this.i18n.system("Next")}</span>${icon(this.matches(":dir(rtl)")?"previous":"next")}</button></nav><div class="presentation-deck-supporting">${!reading&&this.#visualOverflow?html`<p class="presentation-slide-fit-warning" role="status">${this.i18n.t("presentation.fitOverflow","Some content does not fit. Read slide for the complete content.")}</p>`:nothing}<button type="button" class="button secondary compact presentation-deck-reading-toggle" aria-pressed=${reading} aria-label=${readingLabel} @click=${()=>this.#setReading(!reading)}>${readingLabel}</button></div></div>`}
  </section>`;}
}

if (!customElements.get("forma-presentation-deck")) customElements.define("forma-presentation-deck",PresentationDeck);
declare global{interface HTMLElementTagNameMap{"forma-presentation-deck":PresentationDeck}}
