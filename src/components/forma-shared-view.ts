import { html, nothing } from "lit";
import { documentArtifactDefinition, formatPresentationQuantity, type DocumentArtifact, type DocumentArtifactItem } from "../model/document-artifacts";
import { presentationRequiresReadingPosture } from "../model/presentation-layout";
import { referenceMedium } from "../model/reference-media";
import type { CreativeOutput } from "../model/events";
import { FormaLocaleController } from "./design-system/localization";
import { FormaPresentationalElement } from "./presentational-element";
import { ensureModalDialog } from "./modal-dialog";
import { completeRoutePopulation } from "../performance";
import { renderVideoReel, type VideoReelItem } from "./video-reel";
import { renderAudioPlayer, renderIncludedSoundtrackTranscripts, renderSoundtrackCompanions } from "./audio-playback";
import "./artifact-summary";

type SharedArtifact=DocumentArtifact&{contentMarkdown?:string|null;contentAvailable?:boolean;contextRevision?:string};
type SharedProjection = { projectName: string; documentTitle: string; blocks: Array<{ id: string; type: string; handle: string; properties: Record<string, unknown> }>; outputs: CreativeOutput[]; artifacts: SharedArtifact[] };
type SharedResult = { kind: "image"; sequence: number; outputs: CreativeOutput[] } | { kind: "artifact"; sequence: number; artifact: SharedArtifact };
type SharedExperience={revision:string;artifacts:SharedArtifact[]};
const OPAQUE_SHARED_SOURCE_LABEL=/^(?:(?:blk|grp|clm|source|context|decision)[_-]\d+|context_group_\d+|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i;

export class FormaSharedView extends FormaPresentationalElement {
  static properties = { token: { type: String } };
  token = ""; #loading = true; #error = ""; #projection: SharedProjection | null = null; #expiresAt = "";
  #i18n = new FormaLocaleController(this);
  #activeImage:{url:string;label:string;fan:Array<{url:string;label:string}>;index:number}|null=null;
  #imageFocused=false;
  #returnFocus?:HTMLElement;
  #activePresentation:{artifact:SharedArtifact;index:number}|null=null;
  #presentationFocused=false;
  #presentationReading=false;
  #presentationReadingPreference:boolean|null=null;
  #presentationContentOverflow=false;
  #presentationObserver?:ResizeObserver;
  #presentationObserved?:Element;
  #presentationReturnFocus?:HTMLElement;
  #presentationTouchStart:{x:number;y:number}|null=null;
  #selectedExperienceKind="";
  #syncPresentationPosture=(entries:ResizeObserverEntry[])=>{
    const entry=entries.find((candidate)=>candidate.target===this.#presentationObserved);
    if(!entry||this.#presentationReadingPreference!==null)return;
    const{width,height}=entry.contentRect;
    if(width<1||height<1)return;
    const reading=presentationRequiresReadingPosture(width,Math.max(0,height-56));
    if(reading===this.#presentationReading)return;
    this.#presentationReading=reading;
    this.requestUpdate();
  };
  protected override updated(){
    document.title=this.#projection?`${this.#projection.documentTitle} — ${this.#i18n.t("shared.review","Shared review")} — Forma`:`${this.#i18n.t(this.#error?"shared.unavailable":"shared.loading",this.#error?"Link unavailable":"Opening shared review")} — Forma`;
    const stage=this.querySelector(".shared-presentation-stage");
    if(stage===this.#presentationObserved)return;
    this.#presentationObserver?.disconnect();
    this.#presentationObserved=stage??undefined;
    if(stage&&typeof ResizeObserver==="function"){
      this.#presentationObserver??=new ResizeObserver(this.#syncPresentationPosture);
      this.#presentationObserver.observe(stage);
    }
  }
  override connectedCallback() { super.connectedCallback(); void this.#load(); }
  override disconnectedCallback(){this.#presentationObserver?.disconnect();this.#presentationObserved=undefined;super.disconnectedCallback();}

  async #openImage(event:MouseEvent,url:string,label:string,approvedFan:Array<{url:string;label:string}>=[]){
    let parsed:URL;try{parsed=new URL(url,location.origin);}catch{return;}
    const expected=`/api/shared/${encodeURIComponent(this.token)}/media/`;
    if(parsed.origin!==location.origin||!parsed.pathname.startsWith(expected))return;
    const fan=approvedFan.map((candidate)=>{try{const item=new URL(candidate.url,location.origin);return item.origin===location.origin&&item.pathname.startsWith(expected)?{url:item.href,label:candidate.label}:null;}catch{return null;}}).filter((candidate):candidate is {url:string;label:string}=>candidate!==null);
    if(!fan.some((candidate)=>candidate.url===parsed.href))fan.unshift({url:parsed.href,label});
    this.#returnFocus=event.currentTarget instanceof HTMLElement?event.currentTarget:undefined;
    this.#imageFocused=false;this.#activeImage={url:parsed.href,label,fan,index:Math.max(0,fan.findIndex((candidate)=>candidate.url===parsed.href))};this.requestUpdate();await this.updateComplete;
    const dialog=this.querySelector<HTMLDialogElement>(".shared-image-dialog");ensureModalDialog(dialog);dialog?.querySelector<HTMLElement>("button")?.focus();
  }

  #closeImage(){this.querySelector<HTMLDialogElement>(".shared-image-dialog")?.close();this.#activeImage=null;this.#imageFocused=false;this.requestUpdate();this.#returnFocus?.focus();this.#returnFocus=undefined;}
  #setImageFocus(focused:boolean){this.#imageFocused=focused;this.requestUpdate();void this.updateComplete.then(()=>this.querySelector<HTMLButtonElement>(".shared-image-focus-toggle")?.focus({preventScroll:true}));}

  #navigateImage(direction:-1|1){const active=this.#activeImage;if(!active||active.fan.length<2)return;const index=(active.index+direction+active.fan.length)%active.fan.length;const image=active.fan[index];this.#activeImage={...active,url:image.url,label:image.label,index};this.requestUpdate();}

  async #openPresentation(event:MouseEvent,artifact:SharedArtifact){
    if(artifact.kind!=="slides"||!artifact.items.length)return;
    this.#presentationReturnFocus=event.currentTarget instanceof HTMLElement?event.currentTarget:undefined;
    this.#presentationFocused=false;this.#presentationReading=false;this.#presentationReadingPreference=null;this.#presentationContentOverflow=false;this.#activePresentation={artifact,index:0};this.requestUpdate();await this.updateComplete;
    const dialog=this.querySelector<HTMLDialogElement>(".shared-presentation-dialog");ensureModalDialog(dialog);dialog?.querySelector<HTMLElement>("button")?.focus();
  }

  #closePresentation(){this.querySelector<HTMLDialogElement>(".shared-presentation-dialog")?.close();this.#activePresentation=null;this.#presentationFocused=false;this.#presentationReading=false;this.#presentationReadingPreference=null;this.#presentationContentOverflow=false;this.#presentationTouchStart=null;this.#presentationObserver?.disconnect();this.#presentationObserved=undefined;const opener=this.#presentationReturnFocus;this.#presentationReturnFocus=undefined;this.requestUpdate();if(opener?.isConnected)opener.focus({preventScroll:true});}
  #setPresentationFocus(focused:boolean){this.#presentationFocused=focused;this.requestUpdate();void this.updateComplete.then(()=>this.querySelector<HTMLButtonElement>(".shared-presentation-focus-toggle")?.focus({preventScroll:true}));}
  #setPresentationReading(reading:boolean){
    const bounds=this.#presentationObserved?.getBoundingClientRect(),narrow=Boolean(bounds&&presentationRequiresReadingPosture(bounds.width,Math.max(0,bounds.height-56)));
    if(!reading&&this.#presentationContentOverflow&&narrow){this.#presentationReadingPreference=null;this.#presentationReading=true;this.requestUpdate();void this.updateComplete.then(()=>this.querySelector<HTMLElement>(".shared-presentation-reading")?.focus({preventScroll:true}));return;}
    this.#presentationReadingPreference=reading;this.#presentationReading=reading;this.requestUpdate();void this.updateComplete.then(()=>this.querySelector<HTMLElement>(reading?".shared-presentation-reading":".shared-presentation-reading-toggle")?.focus({preventScroll:true}));
  }
  #sharedSlideFit=(event:CustomEvent<{contentFits:boolean}>)=>{
    const overflow=!event.detail.contentFits;
    if(overflow===this.#presentationContentOverflow)return;
    this.#presentationContentOverflow=overflow;
    if(!overflow||this.#presentationReadingPreference!==null)return;
    const bounds=this.#presentationObserved?.getBoundingClientRect();
    if(bounds&&presentationRequiresReadingPosture(bounds.width,Math.max(0,bounds.height-56))){this.#presentationReading=true;this.requestUpdate();}
  };
  #navigatePresentation(index:number){
    const active=this.#activePresentation;if(!active)return;
    const nextIndex=Math.max(0,Math.min(active.artifact.items.length-1,index));
    if(nextIndex!==active.index&&this.#presentationReadingPreference===false)this.#presentationReadingPreference=null;
    this.#presentationContentOverflow=false;
    if(this.#presentationReadingPreference===null){
      const bounds=this.#presentationObserved?.getBoundingClientRect();
      const narrow=Boolean(bounds&&presentationRequiresReadingPosture(bounds.width,Math.max(0,bounds.height-56)));
      this.#presentationReading=narrow;
    }
    this.#activePresentation={...active,index:nextIndex};
    this.requestUpdate();
  }
  #presentationPointerDown(event:PointerEvent){if(event.pointerType==="touch")this.#presentationTouchStart={x:event.clientX,y:event.clientY};}
  #presentationPointerUp(event:PointerEvent){const start=this.#presentationTouchStart;this.#presentationTouchStart=null;if(event.pointerType!=="touch"||!start||!this.#activePresentation)return;const horizontal=event.clientX-start.x,vertical=event.clientY-start.y;if(Math.abs(horizontal)<48||Math.abs(horizontal)<Math.abs(vertical)*1.5)return;const direction=this.matches(":dir(rtl)")?(horizontal<0?-1:1):(horizontal<0?1:-1);this.#navigatePresentation(this.#activePresentation.index+direction);}

  #image(url:string,label:string,fan:Array<{url:string;label:string}>=[]){return html`<button class="shared-image-trigger" type="button" aria-haspopup="dialog" aria-label=${fan.length>1?`${label} · ${this.#i18n.t("output.openComparison","Open the image at full size and navigate its {count}-image comparison",{count:this.#i18n.number(fan.length)})}`:this.#i18n.t("shared.inspectImage","Inspect image: {title}",{title:label})} @click=${(event:MouseEvent)=>this.#openImage(event,url,label,fan)}><img class="shared-reference-image" src=${url} alt=${label} loading="lazy"></button>`;}
  async #load() {
    try {if(!this.token.trim())throw new Error("Shared view unavailable");const response = await fetch(`/api/shared/${encodeURIComponent(this.token)}`); const body = await response.json() as { projection?: SharedProjection; share?: { expiresAt: string }; error?: string }; if (!response.ok || !body.projection) throw new Error(body.error ?? "Shared view unavailable"); this.#projection = body.projection; this.#expiresAt = body.share?.expiresAt ?? ""; }
    catch (error) { this.#error = error instanceof Error ? error.message : "Shared view unavailable"; }
    finally { this.#loading = false;this.requestUpdate();void this.updateComplete.then(()=>{this.querySelector<HTMLElement>("#main-content")?.focus({preventScroll:true});completeRoutePopulation(location.pathname);}); }
  }

  #results(projection: SharedProjection): SharedResult[] {
    const imageGroups = new Map<string, CreativeOutput[]>();
    for (const output of projection.outputs) {
      const key = output.promptFanId ? `fan:${output.promptFanId}` : `image:${output.id}`;
      const existing = imageGroups.get(key);
      if (existing) existing.push(output);
      else imageGroups.set(key, [output]);
    }
    const images: SharedResult[] = [...imageGroups.values()].map((outputs) => ({ kind: "image", sequence: Math.max(...outputs.map((output) => output.sequence)), outputs }));
    const artifacts: SharedResult[] = (projection.artifacts ?? []).map((artifact) => ({ kind: "artifact", sequence: artifact.sequence, artifact }));
    return [...images, ...artifacts].sort((left, right) => right.sequence - left.sequence);
  }

  #experience(projection:SharedProjection):SharedExperience|null{
    const candidates=[...(projection.artifacts??[])].filter((artifact)=>Boolean(artifact.contextRevision)).sort((left,right)=>right.sequence-left.sequence);
    const inspected=new Set<string>();
    for(const newest of candidates){
      const revision=newest.contextRevision;if(!revision||inspected.has(revision))continue;inspected.add(revision);
      const current=candidates.filter((artifact)=>artifact.contextRevision===revision);
      const latestByKind=new Map<string,SharedArtifact>();for(const artifact of current)if(!latestByKind.has(artifact.kind))latestByKind.set(artifact.kind,artifact);
      if(latestByKind.size>1)return{revision,artifacts:[...latestByKind.values()]};
    }
    return null;
  }

  #chooseExperience(event:Event,experience:SharedExperience){
    const kind=(event.currentTarget as HTMLSelectElement).value;
    if(kind&&!experience.artifacts.some((artifact)=>artifact.kind===kind))return;
    this.#selectedExperienceKind=kind;this.requestUpdate();
  }

  #experienceSelector(experience:SharedExperience|null){
    if(!experience)return nothing;
    const selected=experience.artifacts.some((artifact)=>artifact.kind===this.#selectedExperienceKind)?this.#selectedExperienceKind:"";
    return html`<label class="shared-experience-selector">${this.#i18n.system("Experience as")}<select .value=${selected} @change=${(event:Event)=>this.#chooseExperience(event,experience)}><option value="">${this.#i18n.system("View all")}</option>${experience.artifacts.map((artifact)=>html`<option value=${artifact.kind}>${this.#i18n.t(`artifact.${artifact.kind}.label`,documentArtifactDefinition(artifact.kind).label)}</option>`)}</select></label>`;
  }

  #directionBlock(block:SharedProjection["blocks"][number]){
    const medium=referenceMedium(block.properties),video=block.properties.source_artifact_kind==="video"||medium==="video",audio=block.type==="audio"||medium==="audio",image=medium==="image";
    const structure=block.properties.artifact_structure&&typeof block.properties.artifact_structure==="object"?block.properties.artifact_structure as Record<string,unknown>:{};
    const items=Array.isArray(structure.items)?structure.items as VideoReelItem[]:[],label=String(block.properties.label??block.handle);
    const copy=typeof block.properties.artifact_markdown==="string"?block.properties.artifact_markdown:String(block.properties.text??block.properties.description??block.properties.label??this.#i18n.t("shared.retainedDecision","A retained creative decision"));
    return html`<article><small>${this.#i18n.t(`system.block.${block.type}.label`,this.#i18n.system(block.type))}</small><h3 dir="auto">${label}</h3>${audio?renderAudioPlayer(typeof block.properties.media_url==="string"?block.properties.media_url:null,label,this.#i18n,{transcript:String(block.properties.transcript??block.properties.lyrics??"")}):video?renderVideoReel(items,typeof block.properties.media_url==="string"?block.properties.media_url:null,label,this.#i18n):image&&typeof block.properties.media_url==="string"?this.#image(block.properties.media_url,label):nothing}<p dir="auto">${copy}</p></article>`;
  }

  #artifactDetails(artifact: SharedArtifact) {
    const soundtrack=renderSoundtrackCompanions(artifact.settings?.soundtrack_assets,this.#i18n);
    if(artifact.kind==="audio")return html`${renderAudioPlayer(artifact.mediaUrl,artifact.title,this.#i18n,{transcript:typeof artifact.settings?.lyrics==="string"?artifact.settings.lyrics:""})}${artifact.settings?.audio_synthid_watermarked?html`<p>${this.#i18n.t("audio.generation.watermark","Generated audio includes an embedded SynthID watermark.")}</p>`:nothing}${soundtrack}`;
    if (artifact.kind === "video" && artifact.mediaUrl) return html`${renderVideoReel(artifact.items, artifact.mediaUrl, artifact.title, this.#i18n)}${renderIncludedSoundtrackTranscripts(artifact.settings?.soundtrack_transcripts,this.#i18n)}${soundtrack}`;
    if (artifact.kind === "slides") return html`<div class="shared-slide-list">${artifact.items.map((item, index) => html`<forma-presentation-slide .item=${{ title: item.title, body: item.body, notes: "", image_prompt: "", slide: item.slide }} .presentation=${artifact.presentation} .index=${index} .total=${artifact.itemCount} .compact=${true}></forma-presentation-slide>`)}</div>${soundtrack}`;
    if(artifact.kind==="short_story"||artifact.kind==="scene")return typeof artifact.contentMarkdown==="string"?html`<pre class="shared-artifact-copy" dir="auto">${artifact.contentMarkdown}</pre>`:html`<p class="shared-artifact-unavailable">The original full writing is no longer available; retained titles and summary are shown.</p><ol class="shared-narrative-list">${artifact.items.map((item)=>html`<li><b dir="auto">${item.title}</b>${item.body?html`<p dir="auto">${item.body}</p>`:nothing}</li>`)}</ol>`;
    return html`<ol class=${artifact.kind === "storyboard" ? "shared-storyboard-list" : "shared-narrative-list"}>${artifact.items.map((item) => html`<li>${item.mediaUrl ? this.#image(item.mediaUrl,item.title) : nothing}<b dir="auto">${item.title}</b>${item.body ? html`<p dir="auto">${item.body}</p>` : nothing}</li>`)}</ol>${soundtrack}`;
  }

  #sharedSlideReader(item:DocumentArtifactItem,index:number){
    const slide=item.slide,quote=slide?.quote,citations=slide?.citations??[];
    const safeLabel=(value:string)=>{const label=value.trim();return label&&!OPAQUE_SHARED_SOURCE_LABEL.test(label)?label:this.#i18n.system("Authorized source citation");};
    return html`<div class="shared-presentation-reader shared-presentation-reading" tabindex="0">
      <article aria-label=${this.#i18n.system("Complete reading version of slide {count}",{count:this.#i18n.number(index+1)})}>
        <h3 dir="auto">${item.title}</h3>${item.body?html`<p dir="auto">${item.body}</p>`:nothing}
        ${slide?.bullets.length?html`<ul>${slide.bullets.map((bullet)=>html`<li dir="auto">${bullet}</li>`)}</ul>`:nothing}
        ${quote?.text?html`<blockquote><p dir="auto">${quote.text}</p>${quote.speaker||quote.role?html`<footer dir="auto">${[quote.speaker,quote.role].filter(Boolean).join(" · ")}</footer>`:nothing}${quote.citation?html`<p dir="auto">${safeLabel(quote.citation)}</p>`:nothing}</blockquote>`:nothing}
        ${slide?.visual&&(slide.visual.value||slide.visual.data.length||slide.visual.exactValue||slide.visual.displayValue)?html`<figure><figcaption dir="auto">${slide.visual.label||this.#i18n.system("Slide evidence")}</figcaption>${slide.visual.value?html`<p dir="auto">${slide.visual.value}</p>`:nothing}${slide.visual.exactValue||slide.visual.displayValue?html`<dl>${slide.visual.exactValue?html`<dt>${this.#i18n.system("Exact value")}</dt><dd>${formatPresentationQuantity(slide.visual.exactValue,slide.visual.unit,{numericOnly:true})}</dd>`:nothing}${slide.visual.displayValue?html`<dt>${this.#i18n.system("Rounded display value")}</dt><dd>${formatPresentationQuantity(slide.visual.displayValue,slide.visual.unit,{numericOnly:true})}</dd>`:nothing}</dl>`:nothing}${slide.visual.data.length?html`<dl>${slide.visual.data.map((datum)=>html`<dt dir="auto">${datum.label}</dt><dd dir="auto">${datum.displayValue??datum.value}${datum.exactValue&&datum.exactValue!==(datum.displayValue??datum.value)?html` <span>(${this.#i18n.system("Exact value")}: ${datum.exactValue})</span>`:nothing}</dd>`)}</dl>`:nothing}</figure>`:nothing}
        ${citations.length?html`<section><h4>${this.#i18n.system("References")}</h4><ul>${citations.map((citation)=>html`<li><b dir="auto">${safeLabel(citation.label)}</b>${citation.anchor&&!OPAQUE_SHARED_SOURCE_LABEL.test(citation.anchor.trim())?html` <span dir="auto">${citation.anchor}</span>`:nothing}</li>`)}</ul></section>`:nothing}
      </article>
    </div>`;
  }

  #presentationDialog(){
    const active=this.#activePresentation;if(!active)return nothing;
    const{artifact,index}=active,item=artifact.items[index];if(!item)return nothing;
    const rtl=this.matches(":dir(rtl)"),position=this.#i18n.system("{count} of {total}",{count:this.#i18n.number(index+1),total:this.#i18n.number(artifact.items.length)});
    return html`<dialog class="modal shared-presentation-dialog" data-output-focus=${String(this.#presentationFocused)} closedby="any" aria-labelledby="shared-presentation-heading"
      @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)this.#closePresentation();}}
      @cancel=${(event:Event)=>{if(!this.#presentationFocused)return;event.preventDefault();this.#setPresentationFocus(false);}}
      @keydown=${(event:KeyboardEvent)=>{if(event.defaultPrevented||event.isComposing||event.metaKey||event.ctrlKey||event.altKey)return;if((event.target as Element|null)?.closest(".shared-presentation-reading")&&(event.key==="Home"||event.key==="End"))return;if(event.key==="ArrowLeft"||event.key==="ArrowRight"){event.preventDefault();event.stopPropagation();this.#navigatePresentation(index+(event.key===(rtl?"ArrowRight":"ArrowLeft")?-1:1));}else if(event.key==="Home"||event.key==="End"){event.preventDefault();event.stopPropagation();this.#navigatePresentation(event.key==="Home"?0:artifact.items.length-1);}}}
      @close=${()=>{this.#activePresentation=null;this.#presentationFocused=false;this.#presentationReading=false;this.#presentationReadingPreference=null;this.#presentationContentOverflow=false;this.#presentationTouchStart=null;this.#presentationObserver?.disconnect();this.#presentationObserved=undefined;const opener=this.#presentationReturnFocus;this.#presentationReturnFocus=undefined;this.requestUpdate();if(opener?.isConnected)opener.focus({preventScroll:true});}}>
      <section class="modal-card shared-presentation-card">
        <header><div><span>${this.#i18n.system("Presentation")}</span><h2 id="shared-presentation-heading" dir="auto">${artifact.title}</h2></div><div class="shared-presentation-actions"><button type="button" class="button secondary compact shared-presentation-reading-toggle" aria-pressed=${String(this.#presentationReading)} @click=${()=>this.#setPresentationReading(!this.#presentationReading)}>${this.#i18n.system(this.#presentationReading?"Slide view":"Read slide")}</button><button type="button" class="button secondary compact shared-presentation-focus-toggle" aria-pressed=${this.#presentationFocused} @click=${()=>this.#setPresentationFocus(!this.#presentationFocused)}>${this.#i18n.system(this.#presentationFocused?"Exit focus":"Focus view")}</button><button type="button" class="button secondary compact" @click=${()=>this.#closePresentation()}>${this.#i18n.t("action.close","Close")}</button></div></header>
        <div class=${`shared-presentation-stage${this.#presentationReading?" shared-presentation-stage--reading":""}`} data-slide-posture=${this.#presentationReading?"reading":"visual"} @presentation-slide-fit=${this.#sharedSlideFit} @pointerdown=${this.#presentationPointerDown} @pointerup=${this.#presentationPointerUp} @pointercancel=${()=>{this.#presentationTouchStart=null;}}>
          ${this.#presentationReading?this.#sharedSlideReader(item,index):html`<div class="shared-presentation-viewport"><forma-presentation-slide .item=${{title:item.title,body:item.body,notes:"",image_prompt:"",slide:item.slide}} .presentation=${artifact.presentation} .index=${index} .total=${artifact.items.length} .compact=${false}></forma-presentation-slide></div>`}
          <nav aria-label=${this.#i18n.system("Presentation")}><button type="button" class="button secondary compact" aria-keyshortcuts=${rtl?"ArrowRight":"ArrowLeft"} ?disabled=${index===0} @click=${()=>this.#navigatePresentation(index-1)}>${this.#i18n.system("Previous")}</button><span role="status" aria-live="polite" aria-atomic="true">${position}</span><button type="button" class="button secondary compact" aria-keyshortcuts=${rtl?"ArrowLeft":"ArrowRight"} ?disabled=${index===artifact.items.length-1} @click=${()=>this.#navigatePresentation(index+1)}>${this.#i18n.system("Next")}</button></nav>
        </div>
      </section>
    </dialog>`;
  }

  #result(result: SharedResult) {
    if (result.kind === "artifact") {
      const artifact = result.artifact;
      const definition = documentArtifactDefinition(artifact.kind);
      const label = this.#i18n.t(`artifact.${artifact.kind}.label`, definition.label);
      const unit = artifact.kind === "slides" ? "slides" : artifact.kind === "storyboard" ? "shots" : artifact.kind === "video" ? "scenes" : "parts";
      const count = this.#i18n.plural(`shared.${unit}`, artifact.itemCount, `{count} ${unit === "parts" ? "part" : unit === "shots" ? "shot" : unit === "scenes" ? "scene" : "slide"}`, `{count} ${unit}`);
      return html`<section class="shared-output shared-artifact" data-forma-content="primary"><forma-artifact-summary .artifact=${artifact} .compact=${true}></forma-artifact-summary><div class="shared-result-description"><b dir="auto">${artifact.title}</b><small>${label} · ${count}</small></div>${artifact.kind==="slides"?html`<button type="button" class="button secondary compact shared-presentation-open" @click=${(event:MouseEvent)=>void this.#openPresentation(event,artifact)}>${this.#i18n.system("Slideshow")}</button>`:nothing}<details class="shared-result-details"><summary>${this.#i18n.t("shared.view", "View {format}", { format: label })}</summary>${this.#artifactDetails(artifact)}</details>${artifact.kind==="slides"&&this.#activePresentation?.artifact.id===artifact.id?this.#presentationDialog():nothing}</section>`;
    }
    const fan = result.outputs.length > 1;
    const approvedFan=result.outputs.flatMap((output,index)=>output.mediaUrl?[{url:output.mediaUrl,label:this.#i18n.t("shared.imageAlt","Shared creative result {number}",{number:this.#i18n.number(index+1)})}]:[]);
    return html`<section class=${`shared-output${fan ? " shared-output-fan" : ""}`} data-forma-content="primary"><div class="shared-output-images">${result.outputs.map((output, index) => output.mediaUrl ? this.#image(output.mediaUrl,this.#i18n.t("shared.imageAlt", "Shared creative result {number}", { number: this.#i18n.number(index + 1) }),approvedFan) : html`<span class="shared-output-empty">${this.#i18n.t("shared.imageUnavailable", "Image unavailable")}</span>`)}</div><div class="shared-result-description"><b>${fan ? this.#i18n.plural("shared.alternatives", result.outputs.length, "{count} creative alternative", "{count} creative alternatives") : result.outputs[0]?.purpose === "ideate" ? this.#i18n.t("shared.exploration", "Exploration draft") : this.#i18n.t("shared.finishedImage", "Finished image")}</b><small>${fan ? this.#i18n.t("shared.alternativesDetail", "One result shown through different prompt approaches") : this.#i18n.t("shared.generatedDetail", "Generated from the shared creative direction")}</small></div></section>`;
  }

  override render() {
    if (this.#loading) return html`<main id="main-content" tabindex="-1" class="shared-view"><div class="shared-status" role="status">${this.#i18n.t("shared.loading", "Opening this shared creative document…")}</div></main>`;
    if (this.#error || !this.#projection) return html`<main id="main-content" tabindex="-1" class="shared-view"><div class="shared-status"><span>${this.#i18n.t("shared.unavailable", "Link unavailable")}</span><h1>${this.#i18n.t("shared.expired", "This view has expired or been revoked.")}</h1><p>${this.#i18n.t("shared.noData", "No project data was returned.")}</p></div></main>`;
    const p = this.#projection;
    const results = this.#results(p);
    const experience=this.#experience(p);
    const selected=experience?.artifacts.some((artifact)=>artifact.kind===this.#selectedExperienceKind)?this.#selectedExperienceKind:"";
    const visibleResults=selected&&experience?results.filter((result)=>result.kind==="artifact"&&result.artifact.contextRevision===experience.revision&&result.artifact.kind===selected):results;
    const expires = this.#expiresAt ? this.#i18n.date(new Date(this.#expiresAt), { dateStyle: "medium", timeStyle: "short" }) : "";
    return html`<main id="main-content" tabindex="-1" class="shared-view">
      <header><div class="brand"><span class="brand-mark">F</span><span>Forma</span></div><span>${this.#i18n.t("shared.expires", "Private · view only · expires {date}", { date: expires })}</span></header>
      <section class="shared-hero"><h1 dir="auto">${p.documentTitle}</h1><p><bdi dir="auto">${p.projectName}</bdi> · ${this.#i18n.t("shared.description", "A private, read-only view of this document and its creative results.")}</p></section>
      <section class="shared-grid">${results.length?html`<section class="shared-results" aria-labelledby="shared-results-heading"><h2 id="shared-results-heading">${this.#i18n.t("shared.results", "Creative results")}</h2>${this.#experienceSelector(experience)}${visibleResults.map((result)=>this.#result(result))}</section><aside class="shared-direction" aria-labelledby="shared-direction-heading"><h2 id="shared-direction-heading">${this.#i18n.t("shared.direction", "Creative direction")}</h2>${p.blocks.map((block)=>this.#directionBlock(block))}</aside>`:html`<aside class="shared-direction" aria-labelledby="shared-direction-heading"><h2 id="shared-direction-heading">${this.#i18n.t("shared.direction", "Creative direction")}</h2>${p.blocks.map((block)=>this.#directionBlock(block))}</aside><section class="shared-results" aria-labelledby="shared-results-heading"><h2 id="shared-results-heading">${this.#i18n.t("shared.results", "Creative results")}</h2><p data-forma-empty-state>${this.#i18n.t("shared.noResults", "No results have been shared yet.")}</p></section>`}</section>
      <footer>${this.#i18n.t("shared.footer", "This link provides access only to the selected document and can be revoked immediately.")}</footer>
      ${this.#activeImage?html`<dialog class="modal shared-image-dialog" data-output-focus=${String(this.#imageFocused)} open aria-labelledby="shared-image-dialog-heading"
        @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)this.#closeImage();}}
        @cancel=${(event:Event)=>{if(!this.#imageFocused)return;event.preventDefault();this.#setImageFocus(false);}}
        @keydown=${(event:KeyboardEvent)=>{if(this.#activeImage!.fan.length<2||event.defaultPrevented||event.isComposing||event.metaKey||event.ctrlKey||event.altKey||event.key!=="ArrowLeft"&&event.key!=="ArrowRight")return;event.preventDefault();event.stopPropagation();const previous=this.matches(":dir(rtl)")?"ArrowRight":"ArrowLeft";this.#navigateImage(event.key===previous?-1:1);}}
        @close=${()=>{this.#activeImage=null;this.#imageFocused=false;this.requestUpdate();this.#returnFocus?.focus();this.#returnFocus=undefined;}}>
        <div class="modal-card"><header><h2 id="shared-image-dialog-heading" dir="auto">${this.#activeImage.label}</h2><button class="button secondary compact shared-image-focus-toggle" type="button" aria-pressed=${this.#imageFocused} @click=${()=>this.#setImageFocus(!this.#imageFocused)}>${this.#i18n.system(this.#imageFocused?"Exit focus":"Focus view")}</button><button class="button secondary compact" type="button" @click=${()=>this.#closeImage()}>${this.#i18n.t("shared.closeImage","Close image")}</button></header>
          ${this.#activeImage.fan.length>1?html`<p>${this.#i18n.t("output.navigation","Use the Left and Right Arrow keys to move through all {count} images without closing this dialog.",{count:this.#i18n.number(this.#activeImage.fan.length)})}</p>`:nothing}
          <img src=${this.#activeImage.url} alt=${this.#activeImage.label}>
          ${this.#activeImage.fan.length>1?html`<nav class="shared-image-navigation" aria-label=${this.#i18n.t("output.navigation","Use the Left and Right Arrow keys to move through all {count} images without closing this dialog.",{count:this.#i18n.number(this.#activeImage.fan.length)})}><button class="button secondary compact" type="button" aria-keyshortcuts=${this.matches(":dir(rtl)")?"ArrowRight":"ArrowLeft"} @click=${()=>this.#navigateImage(-1)}>${this.#i18n.t("output.previous","Previous fan image")}</button><span aria-live="polite">${this.#i18n.t("output.positionOnly","{index} of {total}",{index:this.#i18n.number(this.#activeImage.index+1),total:this.#i18n.number(this.#activeImage.fan.length)})}</span><button class="button secondary compact" type="button" aria-keyshortcuts=${this.matches(":dir(rtl)")?"ArrowLeft":"ArrowRight"} @click=${()=>this.#navigateImage(1)}>${this.#i18n.t("output.next","Next fan image")}</button></nav>`:nothing}
        </div></dialog>`:nothing}
    </main>`;
  }
}
customElements.define("forma-shared-view", FormaSharedView);
