import { html, nothing } from "lit";
import { FormaElement, icon } from "./forma-element";
import { ensureModalDialog } from "./modal-dialog";
import { isDraftOutput, outputQualityLabel, type CreativeOutput } from "../model/events";
import { focalPointCss } from "../model/focal-point";
import { positionImageAtFocalPoint } from "../model/image-focus";
import { PROMPT_TECHNIQUES, promptTechniqueDefinition } from "../model/prompt-structures";

export class OutputVisual extends FormaElement {
  static properties={output:{attribute:false},fanOutputs:{attribute:false},compact:{type:Boolean},interactive:{type:Boolean},readOnly:{type:Boolean,attribute:"read-only"},viewerOnly:{type:Boolean,attribute:"viewer-only"}};
  output?:CreativeOutput;fanOutputs:CreativeOutput[]=[];compact=false;interactive=false;readOnly=false;viewerOnly=false;#open=false;#focused=false;#returnFocus?:HTMLElement;#activeOutputId="";#comparisonId="";#navigationDescriptionId=`fan-image-navigation-${crypto.randomUUID()}`;#viewEventQueue:Promise<void>=Promise.resolve();

  protected override updated(){
    const dialog=this.querySelector<HTMLDialogElement>(".generated-image-viewer");
    if(this.#open)ensureModalDialog(dialog);
  }

  #close(){this.querySelector<HTMLDialogElement>(".generated-image-viewer")?.close();this.#open=false;this.#focused=false;this.#activeOutputId="";this.#comparisonId="";const opener=this.#returnFocus;this.#returnFocus=undefined;this.requestUpdate();if(opener?.isConnected)opener.focus({preventScroll:true});}
  #setFocused(focused:boolean){this.#focused=focused;this.requestUpdate();void this.updateComplete.then(()=>this.querySelector<HTMLButtonElement>(".image-lightbox-focus-toggle")?.focus({preventScroll:true}));}

  #fan(output:CreativeOutput){
    if(!output.promptFanId)return[output];const candidates=this.readOnly?[output,...this.fanOutputs]:[output,...this.fanOutputs,...this.store.projection.get().outputs,...this.store.projection.get().libraryOutputs,...this.store.replayProjection.get().outputs,...this.store.replayProjection.get().libraryOutputs];const unique=new Map<string,CreativeOutput>();
    for(const candidate of candidates)if(candidate.mediaUrl&&candidate.promptFanId===output.promptFanId&&candidate.documentId===output.documentId)unique.set(candidate.id,candidate);
    return[...unique.values()].sort((left,right)=>{const leftIndex=PROMPT_TECHNIQUES.indexOf(left.promptTechnique),rightIndex=PROMPT_TECHNIQUES.indexOf(right.promptTechnique);return(leftIndex<0?PROMPT_TECHNIQUES.length:leftIndex)-(rightIndex<0?PROMPT_TECHNIQUES.length:rightIndex)||left.sequence-right.sequence;});
  }

  #queueViewEvent(event:{type:string;payload:Record<string,unknown>}){if(this.readOnly||this.store.session.get()?.projectContext)return;this.#viewEventQueue=this.#viewEventQueue.then(()=>this.store.hot(event));}

  #recordView(output:CreativeOutput,interaction:"open"|"navigate",navigationMethod:"trigger"|"keyboard"|"button",previous?:CreativeOutput,direction?:-1|1,viewId=this.#comparisonId||crypto.randomUUID()){
    if(this.readOnly||this.store.session.get()?.projectContext||!this.store.ui.instrumentation)return;const fan=this.#fan(output);this.#queueViewEvent({type:"ObjectViewed",payload:{object_id:output.id,view_id:viewId,comparison_id:output.promptFanId?viewId:null,source_surface:"fan-image-dialog",interaction,navigation_method:navigationMethod,prompt_fan_id:output.promptFanId,fan_index:fan.findIndex((candidate)=>candidate.id===output.id)+1,fan_count:fan.length,prompt_technique:output.promptTechnique,previous_object_id:previous?.id??null,direction:direction===-1?"previous":direction===1?"next":null}});
  }

  #openViewer(output:CreativeOutput,opener?:HTMLElement){this.#returnFocus=opener??(document.activeElement instanceof HTMLElement?document.activeElement:undefined);this.#focused=false;this.#activeOutputId=output.id;const comparisonId=crypto.randomUUID();this.#comparisonId=comparisonId;this.#open=true;const fan=this.#fan(output);if(!this.readOnly&&this.store.ui.instrumentation&&output.promptFanId&&fan.length>1)this.#queueViewEvent({type:"ComparisonOpened",payload:{comparison_id:comparisonId,comparison_kind:"prompt_fan_image_viewer",prompt_fan_id:output.promptFanId,object_ids:fan.map((candidate)=>candidate.id),starting_object_id:output.id,source_surface:"fan-image-dialog"}});this.#recordView(output,"open","trigger",undefined,undefined,comparisonId);this.requestUpdate();}
  openImageViewer(opener?:HTMLElement){if(this.output?.mediaUrl)this.#openViewer(this.output,opener);}

  #navigateFan(direction:-1|1,navigationMethod:"keyboard"|"button"){
    const origin=this.output;if(!origin)return;const fan=this.#fan(origin);if(fan.length<2)return;const currentIndex=Math.max(0,fan.findIndex((candidate)=>candidate.id===(this.#activeOutputId||origin.id)));const next=fan[(currentIndex+direction+fan.length)%fan.length];const previous=fan[currentIndex];this.#activeOutputId=next.id;this.#recordView(next,"navigate",navigationMethod,previous,direction);this.dispatchEvent(new CustomEvent("forma-fan-image-navigated",{bubbles:true,composed:true,detail:{comparisonId:this.#comparisonId,promptFanId:origin.promptFanId,objectId:next.id,previousObjectId:previous.id,direction:direction===-1?"previous":"next",navigationMethod,index:fan.indexOf(next)+1,count:fan.length}}));this.requestUpdate();
  }

  #onDialogKeydown(event:KeyboardEvent){if(event.defaultPrevented||event.isComposing||event.metaKey||event.ctrlKey||event.altKey||event.key!=="ArrowLeft"&&event.key!=="ArrowRight")return;const fan=this.output?this.#fan(this.output):[];if(fan.length<2)return;event.preventDefault();event.stopPropagation();const previous=this.matches(":dir(rtl)")?"ArrowRight":"ArrowLeft";this.#navigateFan(event.key===previous?-1:1,"keyboard");}

  #quality(output:CreativeOutput){return this.i18n.t(isDraftOutput(output)?"sample.draft":"sample.full",outputQualityLabel(output));}
  #technique(output:CreativeOutput|undefined){const definition=promptTechniqueDefinition(output?.promptTechnique);const id=output?.promptTechnique;return id==="prose"||id==="bullets"?this.i18n.t(`sample.${id}`,definition.shortLabel):definition.shortLabel;}
  #image(output:CreativeOutput){return html`<img class="generated-output-image" src=${output.mediaUrl!} alt=${this.i18n.t("output.description","{quality} image prepared with the {technique} creative approach",{quality:this.#quality(output),technique:this.#technique(output)})} width=${output.width??1536} height=${output.height??1024} loading=${this.compact?"lazy":"eager"} style=${focalPointCss(output.focalPoint)} @load=${(event:Event)=>positionImageAtFocalPoint(event.currentTarget as HTMLImageElement,output.focalPoint)}>`;}

  override render(){
    const output=this.output;
    const fan=output?this.#fan(output):[];const active=fan.find((candidate)=>candidate.id===this.#activeOutputId)??output;const activeIndex=active?fan.findIndex((candidate)=>candidate.id===active.id):-1;const fanNavigation=Boolean(output?.promptFanId&&fan.length>1);const technique=this.#technique(active);const rtl=this.matches(":dir(rtl)");
    return output?.mediaUrl
      ? html`${this.viewerOnly?nothing:this.interactive?html`<button type="button" class="generated-output-trigger" aria-label=${fanNavigation?this.i18n.t("output.openComparison","Open the image at full size and navigate its {count}-image comparison",{count:this.i18n.number(fan.length)}):this.i18n.t("output.open","Open full image")} @pointerdown=${(event:PointerEvent)=>event.stopPropagation()} @click=${(event:MouseEvent)=>{event.stopPropagation();this.#openViewer(output);}}>${this.#image(output)}<span>${this.i18n.t("output.open","Open full image")}</span></button>`:this.#image(output)}
        ${this.#open&&active?html`<dialog class="modal generated-image-viewer" data-output-focus=${String(this.#focused)} closedby="any" aria-modal="true" aria-labelledby=${`generated-image-title-${active.id}`} aria-describedby=${fanNavigation?this.#navigationDescriptionId:nothing} @keydown=${this.#onDialogKeydown} @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)this.#close();}} @cancel=${(event:Event)=>{event.preventDefault();if(this.#focused){this.#setFocused(false);return;}this.#close();}} @close=${()=>{if(this.#open){this.#open=false;this.#focused=false;this.#activeOutputId="";this.#comparisonId="";const opener=this.#returnFocus;this.#returnFocus=undefined;this.requestUpdate();if(opener?.isConnected)opener.focus({preventScroll:true});}}}>
          <div class="modal-card image-lightbox-card">
            <button type="button" class="icon-button image-lightbox-focus-toggle" aria-label=${this.i18n.system(this.#focused?"Exit focus":"Focus view")} title=${this.i18n.system(this.#focused?"Exit focus":"Focus view")} aria-pressed=${this.#focused} @click=${()=>this.#setFocused(!this.#focused)}>${icon(this.#focused?"collapse":"expand")}</button>
            <button type="button" class="icon-button modal-close" aria-label=${this.i18n.t("output.close","Close generated image")} @click=${this.#close}>${icon("close")}</button>
            <header>
              <span class="eyebrow">${fanNavigation?this.i18n.t("output.position","Image {index} of {total} · {technique} approach",{index:this.i18n.number(activeIndex+1),total:this.i18n.number(fan.length),technique}):this.i18n.t("output.generated","Generated image")}</span>
              <h2 id=${`generated-image-title-${active.id}`}>${fanNavigation?this.i18n.t("output.result","{technique} result",{technique}):this.i18n.t("output.image","{quality} image",{quality:this.#quality(active)})}</h2>
              ${fanNavigation?html`<span class="sr-only image-lightbox-position" role="status" aria-live="polite" aria-atomic="true">${this.i18n.t("output.positionOnly","{index} of {total}",{index:this.i18n.number(activeIndex+1),total:this.i18n.number(fan.length)})}</span><p id=${this.#navigationDescriptionId}>${this.i18n.t("output.navigation","Use the Left and Right Arrow keys to move through all {count} images without closing this dialog.",{count:this.i18n.number(fan.length)})}</p>`:nothing}
            </header>
            <div class="image-lightbox-stage">${this.#image(active)}${fanNavigation?html`<button type="button" class="icon-button fan-image-navigation previous" aria-label=${this.i18n.t("output.previous","Previous fan image")} aria-keyshortcuts=${rtl?"ArrowRight":"ArrowLeft"} @click=${()=>this.#navigateFan(-1,"button")}>${icon(rtl?"next":"previous")}</button><button type="button" class="icon-button fan-image-navigation next" aria-label=${this.i18n.t("output.next","Next fan image")} aria-keyshortcuts=${rtl?"ArrowLeft":"ArrowRight"} @click=${()=>this.#navigateFan(1,"button")}>${icon(rtl?"previous":"next")}</button>`:nothing}</div>
            <footer><span>${this.i18n.number(active.width??1536)} × ${this.i18n.number(active.height??1024)} · ${this.#quality(active)}${fanNavigation?` · ${this.i18n.t("output.positionOnly","{index} of {total}",{index:this.i18n.number(activeIndex+1),total:this.i18n.number(fan.length)})}`:""}</span><button type="button" class="button primary" @click=${this.#close}>${this.i18n.t("output.done","Done")}</button></footer>
          </div>
        </dialog>`:nothing}`
      : html`<span class="generated-output-empty">${icon("image")}<small>${output?.provider==="simulation"?this.i18n.t("output.legacy","Legacy simulated output"):this.i18n.t("output.missing","No generated image")}</small></span>`;
  }
}

if (!customElements.get("forma-output-visual")) customElements.define("forma-output-visual",OutputVisual);
