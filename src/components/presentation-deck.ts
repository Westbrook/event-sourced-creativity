import { html, nothing } from "lit";
import { applySlideStylePreset, formatPresentationQuantity, isSlideStylePresetId, normalizeSlideItem, normalizeSlidePresentation, SLIDE_STYLE_PRESETS, slideStylePresetDefinition, type DocumentArtifactDraftItem, type SlidePresentation, type SlideStylePresetId } from "../model/document-artifacts";
import { combinedContextMemberships } from "../model/combined-context";
import { FormaElement, icon } from "./forma-element";
import { readSlideFooterLabelPreference, writeSlideFooterLabelPreference } from "./presentation-slide";
import { presentationEditableExportFilename } from "../model/presentation-export";
import { authorizedPresentationCitations, presentationRequiresReadingPosture } from "../model/presentation-layout";
import { localizedSourceAnchor } from "../model/source-anchor";
import { inferPresentationAudienceLocale } from "../model/presentation-source";
import { renderSoundtrackCompanions as renderAudioCompanions, soundtrackCompanions, type SoundtrackAsset } from "./audio-playback";
import { audioFileExtension } from "../model/audio";

type DeckView="list"|"slideshow";
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
  #fullscreenChanged=()=>{this.#fullscreenActive=document.fullscreenElement===this;this.requestUpdate();};
  #syncReadingPosture=(entries:ResizeObserverEntry[])=>{
    const entry=entries.find((candidate)=>candidate.target===this.#readingViewport);
    if(!entry)return;
    const{width,height}=entry.contentRect;
    if(width<1||height<1)return;
    const reading=presentationRequiresReadingPosture(width,height);
    if(reading===this.#automaticReading)return;
    this.#automaticReading=reading;
    if(this.#readingOverride===null)this.requestUpdate();
  };
  #slideFit=(event:CustomEvent<{contentFits:boolean}>)=>{
    const overflow=!event.detail.contentFits;
    const unsafeVisualOverride=overflow&&this.#readingOverride===false;
    if(overflow===this.#visualOverflow&&!unsafeVisualOverride)return;
    this.#visualOverflow=overflow;
    if(unsafeVisualOverride)this.#readingOverride=null;
    this.requestUpdate();
    if(unsafeVisualOverride)void this.updateComplete.then(()=>this.querySelector<HTMLElement>(".presentation-deck-reading")?.focus({preventScroll:true}));
  };
  override connectedCallback(){super.connectedCallback();document.addEventListener("fullscreenchange",this.#fullscreenChanged);}
  override disconnectedCallback(){document.removeEventListener("fullscreenchange",this.#fullscreenChanged);this.#readingObserver?.disconnect();this.#readingViewport=undefined;super.disconnectedCallback();}
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
    if(!reading&&this.#visualOverflow){
      this.#readingOverride=null;
      this.requestUpdate();
      void this.updateComplete.then(()=>this.querySelector<HTMLElement>(".presentation-deck-reading")?.focus({preventScroll:true}));
      return;
    }
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
  #setIndex(index:number,total:number){if(!total)return;const next=Math.max(0,Math.min(total-1,index));if(next!==this.#index&&this.#readingOverride===false)this.#readingOverride=null;this.#index=next;this.#visualOverflow=false;writeDeckIndex(this.#styleKey(),this.#index);this.#seekPlayingSoundtrack();this.requestUpdate();}
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
  #syncIndex(total:number){const key=this.#styleKey();if(this.#indexKey!==key){this.#index=readDeckIndex(key);this.#indexKey=key;}this.#index=Math.max(0,Math.min(this.#index,Math.max(0,total-1)));return this.#index;}
  #toggleFooter(event:Event){this.#showFooterLabel=(event.target as HTMLInputElement).checked;writeSlideFooterLabelPreference(this.#showFooterLabel);this.requestUpdate();}
  #styleKey(){return this.preferenceKey.trim()||"unscoped";}
  #selectedStyle(presentation:SlidePresentation){const key=this.#styleKey();return this.#styleOverride?.key===key?this.#styleOverride.value:readDeckStyle(key)??presentation.stylePreset;}
  get activePresentation(){const presentation=normalizeSlidePresentation(this.presentation)??applySlideStylePreset(null,"gallery");return applySlideStylePreset(presentation,this.#selectedStyle(presentation));}
  #setStyle(event:Event){const value=(event.target as HTMLSelectElement).value;if(!isSlideStylePresetId(value))return;const key=this.#styleKey();this.#styleOverride={key,value};this.#visualOverflow=false;writeDeckStyle(key,value);this.dispatchEvent(new CustomEvent("slide-style-changed",{bubbles:true,composed:true,detail:{preferenceKey:this.preferenceKey,stylePreset:value}}));this.requestUpdate();}
  #positionExportMenu(event:MouseEvent){const trigger=event.currentTarget as HTMLButtonElement,menu=this.querySelector<HTMLElement>(`#${this.#exportMenuId}`);if(!menu||menu.matches(":popover-open"))return;const rect=trigger.getBoundingClientRect(),unit=Number.parseFloat(getComputedStyle(document.documentElement).fontSize)||16,width=Math.min(24*unit,Math.max(window.innerWidth-16,0)),height=Math.min(8*unit,Math.max(window.innerHeight-16,0)),desired=this.matches(":dir(rtl)")?rect.left:rect.right-width,left=Math.max(8,Math.min(desired,window.innerWidth-width-8)),top=rect.bottom+height+6<=window.innerHeight-8?rect.bottom+6:Math.max(8,rect.top-height-6);menu.style.setProperty("--presentation-export-top",`${top}px`);menu.style.setProperty("--presentation-export-left",`${left}px`);}
  #toggleExportMenu(event:ToggleEvent){this.#exportMenuOpen=event.newState==="open";this.requestUpdate();}
  #exportFromMenu(format:"pdf"|"powerpoint",items:DocumentArtifactDraftItem[],presentation:SlidePresentation){const menu=this.querySelector<HTMLElement>(`#${this.#exportMenuId}`);if(menu?.matches(":popover-open"))menu.hidePopover();this.querySelector<HTMLButtonElement>(".presentation-deck-export")?.focus({preventScroll:true});return format==="pdf"?this.#downloadPdf(items,presentation):this.#downloadPowerPoint(items,presentation);}
  async #fullscreen(){try{if(document.fullscreenElement===this)await document.exitFullscreen();else if(typeof this.requestFullscreen==="function"){if(this.#view!=="slideshow")this.#setView("slideshow");await this.requestFullscreen();}}catch{this.store.toast("Fullscreen presentation is unavailable in this browser.");}}
  #touchBegin(event:PointerEvent){if(event.pointerType==="touch")this.#touchStart={x:event.clientX,y:event.clientY};}
  #touchEnd(event:PointerEvent,total:number){if(event.pointerType!=="touch"||!this.#touchStart)return;const horizontal=event.clientX-this.#touchStart.x,vertical=event.clientY-this.#touchStart.y;this.#touchStart=null;if(Math.abs(horizontal)<48||Math.abs(horizontal)<Math.abs(vertical)*1.5)return;const rtl=this.matches(":dir(rtl)");this.#setIndex(this.#index+(horizontal<0===!rtl?1:-1),total);}
  #evidence(item:DocumentArtifactDraftItem):DeckEvidence{
    const projection=this.store.projection.get(),documentId=this.documentId||projection.documentId;
    const blocks=[...new Map([...projection.blocks,...projection.libraryBlocks].filter((block)=>block.documentId===documentId&&block.projectId===projection.projectId&&!block.removed).map((block)=>[block.id,block])).values()];
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
    const slide=item.slide as DeckVisual|null,quote=slide?.quote,evidence=this.#evidence(item),visual=slide?.visual as (DeckVisual["visual"]&{exactValue?:string;displayValue?:string;unit?:string})|undefined;
    const attribution=quote?[...new Set([quote.speaker,quote.role].filter(Boolean))].join(" · "):"";
    const showNumericPrecision=Boolean(visual&&visual.kind!=="roadmap"&&visual.kind!=="timeline"&&(visual.exactValue||visual.displayValue));
    const visualSummary=visual?.value||(visual&&(visual.kind==="roadmap"||visual.kind==="timeline")?formatPresentationQuantity(visual.displayValue??visual.exactValue,visual.unit,{numericOnly:true}):"");
    const quoteCitation=quote?.citation?visibleSourceLabel(quote.citation,this.i18n.system("Authorized source")):"";
    const content=html`<article class="presentation-deck-reader-content" aria-label=${this.i18n.system("Complete reading version of slide {count}", { count: this.i18n.number(index+1) })}><h3 dir="auto">${item.title}</h3>${item.body?html`<p dir="auto">${item.body}</p>`:nothing}${slide?.bullets.length?html`<ul>${slide.bullets.map((bullet)=>html`<li dir="auto">${bullet}</li>`)}</ul>`:nothing}${quote?.text?html`<blockquote><p dir="auto">${quote.text}</p>${attribution?html`<footer><cite dir="auto">${attribution}</cite></footer>`:nothing}${quoteCitation?html`<p dir="auto">${quoteCitation}</p>`:nothing}</blockquote>`:nothing}${visual&&(visualSummary||visual.data.length||showNumericPrecision)?html`<figure><figcaption dir="auto">${visual.label||this.i18n.system("Slide evidence")}</figcaption>${visualSummary?html`<p dir="auto">${visualSummary}</p>`:nothing}${showNumericPrecision?html`<dl>${visual.exactValue?html`<dt>Exact value</dt><dd>${formatPresentationQuantity(visual.exactValue,visual.unit,{numericOnly:true})}</dd>`:nothing}${visual.displayValue?html`<dt>Rounded display value</dt><dd>${formatPresentationQuantity(visual.displayValue,visual.unit,{numericOnly:true})}</dd>`:nothing}</dl>`:nothing}${visual.data.length?html`<dl>${visual.data.map((entry)=>{const datum=entry as DeckVisualDatum;return html`<dt dir="auto">${datum.label}</dt><dd dir="auto">${datum.displayValue??datum.value}${datum.exactValue&&datum.exactValue!==(datum.displayValue??datum.value)?html` <span>(exact: ${datum.exactValue})</span>`:nothing}</dd>`;})}</dl>`:nothing}</figure>`:nothing}<section class="presentation-deck-evidence"><h4>Authorized source evidence</h4>${evidence.sources.length?html`<ul>${evidence.sources.map((source)=>html`<li><span class="presentation-deck-source-chip">${this.i18n.system(source.kind)}</span> <strong dir="auto">${source.label}</strong>${source.citationLabel&&source.citationLabel!==source.label?html` <span dir="auto">${source.citationLabel}</span>`:nothing}${source.anchor?html` <span dir="auto">${localizedSourceAnchor(source.anchor,(label,values)=>this.i18n.system(label,values),(value)=>this.i18n.number(value))}</span>`:nothing}${source.excerpt?html`<p dir="auto">${source.excerpt}</p>`:nothing}</li>`)}</ul>`:html`<p>No authorized source evidence was retained for this slide.</p>`}${evidence.unresolved?html`<p role="status" aria-live="polite" aria-atomic="true">Some source references could not be verified against this document.</p>`:nothing}</section>${item.notes?html`<section><h4>Speaker notes</h4><p dir="auto">${item.notes}</p></section>`:nothing}</article>`;
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
  async #downloadPdf(items:DocumentArtifactDraftItem[],presentation:SlidePresentation){if(this.#exporting||!this.releaseAllowed)return;const authorization=this.store.captureAuthorizationScope(),scoped=authorization?.shared??false,artifactId=this.preferenceKey,documentId=this.documentId||this.store.projection.get().documentId;if(!authorization||!artifactId)return;this.#exporting=true;this.requestUpdate();try{const artifact=this.store.projection.get().libraryArtifacts.find((candidate)=>candidate.id===artifactId),retained=artifact?.contentRef?this.store.content.get()[artifact.contentRef]:"";if(scoped&&!retained){this.store.toast("The latest approved presentation is unavailable.");return;}const revision=this.store.events.get().filter((event)=>event.type==="DocumentArtifactEdited"&&String(event.payload.artifact_id??"")===artifactId).length;const{renderPresentationPdf}=await import("./presentation-pdf-export");if(!this.store.authorizationScopeActive(authorization))return;const audience=this.#audienceLocalization(items),options={title:this.deckTitle.trim()||audience.translate("Slide deck"),showFooterLabel:this.#showFooterLabel,...audience},result=await renderPresentationPdf(items,presentation,options);const digest=retained?Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(retained))),(byte)=>byte.toString(16).padStart(2,"0")).join(""):"";if(!this.store.authorizationScopeActive(authorization))return;const receipt={type:"DocumentArtifactExported",payload:{artifact_id:artifactId,artifact_kind:"slides",document_id:documentId,format:"application/pdf",destination_kind:"pdf",page_count:result.pageCount,artifact_revision:revision,...(digest?{content_sha256:digest}:{}),style_preset:presentation.stylePreset,render_mode:"browser-slide-capture",source_surface:this.sourceSurface}};if(!await this.store.authorizeProjectExport(receipt,authorization))return;if(!this.store.authorizationScopeActive(authorization))return;const blob=new Blob([Uint8Array.from(result.bytes).buffer],{type:"application/pdf"}),url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download=result.filename;document.body.append(link);link.click();link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1_000);this.store.toast(this.i18n.system("{count}-page PDF downloaded.",{count:this.i18n.number(result.pageCount)}));}catch(error){console.error("Slide PDF export failed",error);this.store.toast(error instanceof Error&&/visible clipping/.test(error.message)?"The presentation is too large to export completely. Nothing was released.":"The PDF could not preserve your slide design. Please try again.");}finally{this.#exporting=false;this.requestUpdate();}}
  async #downloadPowerPoint(items:DocumentArtifactDraftItem[],presentation:SlidePresentation){
    if(this.#exporting||!this.releaseAllowed)return;const authorization=this.store.captureAuthorizationScope(),scoped=authorization?.shared??false,artifactId=this.preferenceKey,documentId=this.documentId||this.store.projection.get().documentId;if(!authorization||scoped&&!artifactId)return;
    this.#exporting=true;this.requestUpdate();
    try{
      const artifact=this.store.projection.get().libraryArtifacts.find((candidate)=>candidate.id===artifactId);
      const retained=artifact?.contentRef?this.store.content.get()[artifact.contentRef]:"";
      if(scoped&&!retained){this.store.toast("The latest approved presentation is unavailable.");return;}
      const revision=this.store.events.get().filter((event)=>event.type==="DocumentArtifactEdited"&&String(event.payload.artifact_id??"")===artifactId).length;
      const{createPowerPointDocument,POWERPOINT_DOCUMENT_MIME}=await import("../model/office-documents");
      if(!this.store.authorizationScopeActive(authorization))return;
      const audience=this.#audienceLocalization(items);
      const bytes=createPowerPointDocument(items,presentation,{title:this.deckTitle.trim()||audience.translate("Slide deck"),showFooterLabel:this.#showFooterLabel,...audience});
      const digest=retained?Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(retained))),(byte)=>byte.toString(16).padStart(2,"0")).join(""):"";
      if(!this.store.authorizationScopeActive(authorization))return;
      const receipt={type:"DocumentArtifactExported",payload:{artifact_id:artifactId,artifact_kind:"slides",document_id:documentId,format:POWERPOINT_DOCUMENT_MIME,destination_kind:"powerpoint",page_count:items.length,artifact_revision:revision,...(digest?{content_sha256:digest}:{}),style_preset:presentation.stylePreset,render_mode:"editable-office-shapes",source_surface:this.sourceSurface}};
      if(!await this.store.authorizeProjectExport(receipt,authorization))return;
      if(!this.store.authorizationScopeActive(authorization))return;
      const blob=new Blob([Uint8Array.from(bytes).buffer],{type:POWERPOINT_DOCUMENT_MIME}),url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download=presentationEditableExportFilename(this.deckTitle.trim()||this.i18n.system("Slide deck"),this.i18n.locale);document.body.append(link);link.click();link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1_000);this.store.toast(items.length===1?this.i18n.system("{count} editable PowerPoint slide and speaker notes downloaded.",{count:this.i18n.number(items.length)}):this.i18n.system("{count} editable PowerPoint slides and speaker notes downloaded.",{count:this.i18n.number(items.length)}));
    }catch(error){this.store.toast(error instanceof Error&&/office_archive/.test(error.message)?"The presentation is too large to export completely. Nothing was released.":"The editable PowerPoint presentation could not be prepared. Nothing was released.");}finally{this.#exporting=false;this.requestUpdate();}
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
  override render(){const items=this.items.map((item,index)=>normalizeSlideItem(item,index)),total=items.length,generatedPresentation=normalizeSlidePresentation(this.presentation)??applySlideStylePreset(null,"gallery"),selectedStyle=this.#selectedStyle(generatedPresentation),presentation=applySlideStylePreset(generatedPresentation,selectedStyle),styleDefinition=slideStylePresetDefinition(selectedStyle),index=this.#syncIndex(total),current=items[index],preferenceFormId=`presentation-deck-preferences-${this.#styleKey()}`;const reading=this.#view==="slideshow"&&(this.#visualOverflow||(this.#readingOverride??this.#automaticReading));const readingLabel=this.i18n.system(reading?"Slide view":"Read slide");const artifact=this.store.projection.get().libraryArtifacts.find((candidate)=>candidate.id===this.preferenceKey);const soundtracks=soundtrackCompanions(artifact?.settings.soundtrack_assets);const renderSoundtrackCompanions=(value:Parameters<typeof renderAudioCompanions>[0],locale:Parameters<typeof renderAudioCompanions>[1],options:Parameters<typeof renderAudioCompanions>[2]={})=>renderAudioCompanions(value,locale,{...options,...(this.releaseAllowed?{onDownload:(asset:SoundtrackAsset)=>void this.#downloadSoundtrack(asset)}:{})});return html`<section class=${`presentation-deck presentation-deck--${this.#view}${reading?" presentation-deck--reading":""}${this.#fullscreenActive?" presentation-deck--fullscreen":""}`} aria-label="Slide deck" tabindex="0" @keydown=${(event:KeyboardEvent)=>this.#key(event,total)}>
    <form id=${preferenceFormId} hidden @submit=${(event:SubmitEvent)=>event.preventDefault()}></form>
    <header class="presentation-deck-toolbar" data-tools-open=${String(this.#compactToolsOpen)}>
      <button type="button" class="button ghost compact presentation-deck-tools-toggle" aria-label=${this.i18n.system("Slideshow controls")} title=${this.i18n.system("Slideshow controls")} aria-expanded=${String(this.#compactToolsOpen)} aria-controls=${`${this.#exportMenuId}-view ${this.#exportMenuId}-delivery`} @click=${()=>{this.#compactToolsOpen=!this.#compactToolsOpen;this.requestUpdate();}}>${icon("dots")}</button>
      <div id=${`${this.#exportMenuId}-view`}>
        <div class="presentation-deck-view-switch" role="group" aria-label="Slide view"><button type="button" aria-pressed=${this.#view==="list"} @click=${()=>this.#setView("list")}>List</button><button type="button" aria-pressed=${this.#view==="slideshow"} @click=${()=>this.#setView("slideshow")}>Slideshow</button></div>
        ${this.#view==="slideshow"?html`<label class="presentation-deck-jump presentation-deck-jump--compact"><span>Slide</span><select form=${preferenceFormId} aria-label="Jump to slide" .value=${String(index)} @change=${(event:Event)=>this.#setIndex(Number((event.currentTarget as HTMLSelectElement).value),total)}>${items.map((item,itemIndex)=>html`<option value=${String(itemIndex)} ?selected=${itemIndex===index}>${itemIndex+1}. ${item.title}</option>`)}</select></label>`:nothing}
        <label class="presentation-deck-style"><span>Style</span><select form=${preferenceFormId} aria-label="Slide style" title=${this.i18n.system(styleDefinition.description)} .value=${selectedStyle} @change=${this.#setStyle}>${SLIDE_STYLE_PRESETS.map((preset)=>html`<option value=${preset.id} ?selected=${preset.id===selectedStyle}>${this.i18n.system(preset.label)}</option>`)}</select></label>
        ${this.#view==="slideshow"&&typeof this.requestFullscreen==="function"?html`<button type="button" class="button secondary compact presentation-deck-presenter" aria-pressed=${this.#fullscreenActive} @click=${()=>void this.#fullscreen()}>${this.#fullscreenActive?this.i18n.system("Exit full screen"):this.i18n.system("Present full screen")}</button>`:nothing}
        ${soundtracks.length?html`<details class="presentation-deck-soundtrack"><summary>${this.i18n.t("audio.soundtrack.label","Optional soundtrack")}</summary>${renderSoundtrackCompanions(soundtracks,this.i18n,{followCues:this.#followSoundtrackCues,onFollowCues:(enabled)=>{this.#followSoundtrackCues=enabled;this.requestUpdate();}})}</details>`:nothing}
      </div>
      <div id=${`${this.#exportMenuId}-delivery`}>
        ${presentation.footerLabel?html`<label class="artifact-slide-footer-toggle" title="Use the document-derived deck label in each slide footer"><input form=${preferenceFormId} type="checkbox" .checked=${this.#showFooterLabel} @change=${this.#toggleFooter}><span>Show deck label</span></label>`:nothing}
        <button type="button" class="button secondary compact presentation-deck-export" popovertarget=${this.#exportMenuId} aria-controls=${this.#exportMenuId} aria-expanded=${this.#exportMenuOpen} title=${this.releaseAllowed?this.i18n.system("Export"):this.i18n.system("An independent reviewer must approve this output before it can leave the project")} ?disabled=${this.#exporting||!total||!this.releaseAllowed} @click=${this.#positionExportMenu}>${icon("download")} ${this.#exporting?this.i18n.system("Preparing export…"):this.i18n.system("Export")}</button>
        <div id=${this.#exportMenuId} class="presentation-deck-export-menu" popover="auto" role="group" aria-label=${this.i18n.system("Export")} @toggle=${this.#toggleExportMenu}><button type="button" title=${this.i18n.system("Download the presentation as a PDF")} ?disabled=${this.#exporting||!total||!this.releaseAllowed} @click=${()=>void this.#exportFromMenu("pdf",items,presentation)}>${this.i18n.system("Download PDF")}</button><button type="button" title=${this.i18n.t("presentation.export.powerpointHint")} ?disabled=${this.#exporting||!total||!this.releaseAllowed} @click=${()=>void this.#exportFromMenu("powerpoint",items,presentation)}>${this.i18n.t("presentation.export.powerpoint")}</button></div>
        <span class="presentation-deck-count">${this.#view==="slideshow"&&total?this.i18n.system("{count} of {total}", { count: this.i18n.number(index+1), total: this.i18n.number(total) }):(total===1 ? this.i18n.system("{total} slide", { total: this.i18n.number(total) }) : this.i18n.system("{total} slides", { total: this.i18n.number(total) }))}</span>
      </div>
    </header>
    <span class="sr-only" role="status" aria-live="polite" aria-atomic="true">${this.#view==="slideshow"&&current?this.i18n.system("Slide {count} of {total}: {title}", { count: this.i18n.number(index+1), total: this.i18n.number(total), title: current.title }):(total===1 ? this.i18n.system("{total} slide available", { total: this.i18n.number(total) }) : this.i18n.system("{total} slides available", { total: this.i18n.number(total) }))}</span>
    ${!total?html`<div class="presentation-deck-empty">No slides are available.</div>`:this.#view==="list"?html`<ol class="presentation-deck-list">${items.map((item,itemIndex)=>html`<li aria-current=${itemIndex===index?"true":nothing}><div class="presentation-deck-list-header"><button type="button" class="button secondary compact" @click=${()=>{this.#setIndex(itemIndex,total);this.#setView("slideshow");void this.updateComplete.then(()=>this.querySelector<HTMLElement>(".presentation-deck-stage")?.focus());}}>Present slide ${itemIndex+1}</button></div>${this.#slide(item,presentation,itemIndex,total)}${item.notes?html`<details class="presentation-deck-notes"><summary>Slide ${itemIndex+1} notes</summary><p dir="auto">${item.notes}</p></details>`:nothing}${this.#reader(item,itemIndex)}</li>`)}</ol>`:html`<div class="presentation-deck-stage" data-slide-posture=${reading?"reading":"visual"} tabindex="-1" @pointerdown=${this.#touchBegin} @pointerup=${(event:PointerEvent)=>this.#touchEnd(event,total)} @pointercancel=${()=>{this.#touchStart=null;}}><div class="presentation-deck-viewport" @presentation-slide-fit=${this.#slideFit}>${current?(reading?this.#reader(current,index,true):this.#slide(current,presentation,index,total)):nothing}</div><nav aria-label="Slideshow controls"><button type="button" aria-label=${this.i18n.system("Previous")} aria-keyshortcuts=${this.matches(":dir(rtl)")?"ArrowRight PageUp":"ArrowLeft PageUp"} ?disabled=${index===0} @click=${()=>this.#setIndex(index-1,total)}>${icon(this.matches(":dir(rtl)")?"next":"previous")}<span class="presentation-deck-navigation-label">${this.i18n.system("Previous")}</span></button><label class="presentation-deck-jump"><span>Slide</span><select form=${preferenceFormId} aria-label="Jump to slide" .value=${String(index)} @change=${(event:Event)=>this.#setIndex(Number((event.currentTarget as HTMLSelectElement).value),total)}>${items.map((item,itemIndex)=>html`<option value=${String(itemIndex)} ?selected=${itemIndex===index}>${itemIndex+1}. ${item.title}</option>`)}</select></label><span class="presentation-deck-position" aria-hidden="true">${index+1} / ${total}</span><button type="button" aria-label=${this.i18n.system("Next")} aria-keyshortcuts=${this.matches(":dir(rtl)")?"ArrowLeft PageDown":"ArrowRight PageDown"} ?disabled=${index===total-1} @click=${()=>this.#setIndex(index+1,total)}><span class="presentation-deck-navigation-label">${this.i18n.system("Next")}</span>${icon(this.matches(":dir(rtl)")?"previous":"next")}</button></nav><div class="presentation-deck-supporting"><button type="button" class="button secondary compact presentation-deck-reading-toggle" aria-pressed=${reading} aria-label=${readingLabel} @click=${()=>this.#setReading(!reading)}>${readingLabel}</button></div></div>`}
  </section>`;}
}

customElements.define("forma-presentation-deck",PresentationDeck);
declare global{interface HTMLElementTagNameMap{"forma-presentation-deck":PresentationDeck}}
