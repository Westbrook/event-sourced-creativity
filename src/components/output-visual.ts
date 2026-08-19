import { html, nothing } from "lit";
import { FormaElement, icon } from "./forma-element";
import type { CreativeOutput } from "../model/events";
import { focalPointCss } from "../model/focal-point";
import { positionImageAtFocalPoint } from "../model/image-focus";
import { PROMPT_TECHNIQUES, promptTechniqueDefinition } from "../model/prompt-structures";

export class OutputVisual extends FormaElement {
  static properties={output:{attribute:false},fanOutputs:{attribute:false},compact:{type:Boolean},interactive:{type:Boolean}};
  output?:CreativeOutput;fanOutputs:CreativeOutput[]=[];compact=false;interactive=false;#open=false;#activeOutputId="";#comparisonId="";#navigationDescriptionId=`fan-image-navigation-${crypto.randomUUID()}`;#viewEventQueue:Promise<void>=Promise.resolve();

  protected override updated(){
    const dialog=this.querySelector<HTMLDialogElement>(".generated-image-viewer");
    if(this.#open&&dialog&&!dialog.open)dialog.showModal();
  }

  #close(){this.querySelector<HTMLDialogElement>(".generated-image-viewer")?.close();this.#open=false;this.#activeOutputId="";this.#comparisonId="";this.requestUpdate();}

  #fan(output:CreativeOutput){
    if(!output.promptFanId)return[output];const candidates=[output,...this.fanOutputs,...this.store.projection.get().outputs,...this.store.projection.get().libraryOutputs,...this.store.replayProjection.get().outputs,...this.store.replayProjection.get().libraryOutputs];const unique=new Map<string,CreativeOutput>();
    for(const candidate of candidates)if(candidate.mediaUrl&&candidate.promptFanId===output.promptFanId&&candidate.documentId===output.documentId)unique.set(candidate.id,candidate);
    return[...unique.values()].sort((left,right)=>{const leftIndex=PROMPT_TECHNIQUES.indexOf(left.promptTechnique),rightIndex=PROMPT_TECHNIQUES.indexOf(right.promptTechnique);return(leftIndex<0?PROMPT_TECHNIQUES.length:leftIndex)-(rightIndex<0?PROMPT_TECHNIQUES.length:rightIndex)||left.sequence-right.sequence;});
  }

  #queueViewEvent(event:{type:string;payload:Record<string,unknown>}){this.#viewEventQueue=this.#viewEventQueue.then(()=>this.store.hot(event));}

  #recordView(output:CreativeOutput,interaction:"open"|"navigate",navigationMethod:"trigger"|"keyboard"|"button",previous?:CreativeOutput,direction?:-1|1,viewId=this.#comparisonId||crypto.randomUUID()){
    if(!this.store.ui.instrumentation)return;const fan=this.#fan(output);this.#queueViewEvent({type:"ObjectViewed",payload:{object_id:output.id,view_id:viewId,comparison_id:output.promptFanId?viewId:null,source_surface:"fan-image-dialog",interaction,navigation_method:navigationMethod,prompt_fan_id:output.promptFanId,fan_index:fan.findIndex((candidate)=>candidate.id===output.id)+1,fan_count:fan.length,prompt_technique:output.promptTechnique,previous_object_id:previous?.id??null,direction:direction===-1?"previous":direction===1?"next":null}});
  }

  #openViewer(output:CreativeOutput){this.#activeOutputId=output.id;const comparisonId=crypto.randomUUID();this.#comparisonId=comparisonId;this.#open=true;const fan=this.#fan(output);if(this.store.ui.instrumentation&&output.promptFanId&&fan.length>1)this.#queueViewEvent({type:"ComparisonOpened",payload:{comparison_id:comparisonId,comparison_kind:"prompt_fan_image_viewer",prompt_fan_id:output.promptFanId,object_ids:fan.map((candidate)=>candidate.id),starting_object_id:output.id,source_surface:"fan-image-dialog"}});this.#recordView(output,"open","trigger",undefined,undefined,comparisonId);this.requestUpdate();}

  #navigateFan(direction:-1|1,navigationMethod:"keyboard"|"button"){
    const origin=this.output;if(!origin)return;const fan=this.#fan(origin);if(fan.length<2)return;const currentIndex=Math.max(0,fan.findIndex((candidate)=>candidate.id===(this.#activeOutputId||origin.id)));const next=fan[(currentIndex+direction+fan.length)%fan.length];const previous=fan[currentIndex];this.#activeOutputId=next.id;this.#recordView(next,"navigate",navigationMethod,previous,direction);this.dispatchEvent(new CustomEvent("forma-fan-image-navigated",{bubbles:true,composed:true,detail:{comparisonId:this.#comparisonId,promptFanId:origin.promptFanId,objectId:next.id,previousObjectId:previous.id,direction:direction===-1?"previous":"next",navigationMethod,index:fan.indexOf(next)+1,count:fan.length}}));this.requestUpdate();
  }

  #onDialogKeydown(event:KeyboardEvent){if(event.key!=="ArrowLeft"&&event.key!=="ArrowRight")return;const fan=this.output?this.#fan(this.output):[];if(fan.length<2)return;event.preventDefault();event.stopPropagation();this.#navigateFan(event.key==="ArrowLeft"?-1:1,"keyboard");}

  #image(output:CreativeOutput){return html`<img class="generated-output-image" src=${output.mediaUrl!} alt=${`Generated image ${output.id}`} width=${output.width??1536} height=${output.height??1024} loading=${this.compact?"lazy":"eager"} style=${focalPointCss(output.focalPoint)} @load=${(event:Event)=>positionImageAtFocalPoint(event.currentTarget as HTMLImageElement,output.focalPoint)}>`;}

  override render(){
    const output=this.output;
    const fan=output?this.#fan(output):[];const active=fan.find((candidate)=>candidate.id===this.#activeOutputId)??output;const activeIndex=active?fan.findIndex((candidate)=>candidate.id===active.id):-1;const fanNavigation=Boolean(output?.promptFanId&&fan.length>1);const technique=promptTechniqueDefinition(active?.promptTechnique);
    return output?.mediaUrl
      ? html`${this.interactive?html`<button type="button" class="generated-output-trigger" aria-label=${`Open generated image ${output.id} at full size${fanNavigation?` and navigate its ${fan.length}-image fan`:""}`} @click=${()=>this.#openViewer(output)}>${this.#image(output)}<span>Open full image</span></button>`:this.#image(output)}
        ${this.#open&&active?html`<dialog class="modal generated-image-viewer" closedby="any" aria-modal="true" aria-labelledby=${`generated-image-title-${active.id}`} aria-describedby=${fanNavigation?this.#navigationDescriptionId:nothing} @keydown=${this.#onDialogKeydown} @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)this.#close();}} @cancel=${(event:Event)=>{event.preventDefault();this.#close();}} @close=${()=>{if(this.#open){this.#open=false;this.#activeOutputId="";this.#comparisonId="";this.requestUpdate();}}}><div class="modal-card image-lightbox-card"><button type="button" class="icon-button modal-close" aria-label="Close generated image" @click=${this.#close}>${icon("close")}</button><header><span class="eyebrow">${fanNavigation?`Fan image ${activeIndex+1} of ${fan.length} · ${technique.shortLabel} prompt`:"Generated image"} · ${active.modelId}</span><h2 id=${`generated-image-title-${active.id}`}>${fanNavigation?`${technique.label} output`:active.id}</h2>${fanNavigation?html`<p id=${this.#navigationDescriptionId}>Use the Left and Right Arrow keys to move through all ${fan.length} images without closing this dialog.</p>`:nothing}</header><div class="image-lightbox-stage">${this.#image(active)}${fanNavigation?html`<button type="button" class="icon-button fan-image-navigation previous" aria-label="Previous fan image" aria-keyshortcuts="ArrowLeft" @click=${()=>this.#navigateFan(-1,"button")}>←</button><button type="button" class="icon-button fan-image-navigation next" aria-label="Next fan image" aria-keyshortcuts="ArrowRight" @click=${()=>this.#navigateFan(1,"button")}>→</button>`:nothing}</div><footer><span aria-live="polite">${active.width??1536} × ${active.height??1024} · generation event #${active.sequence}${fanNavigation?` · ${activeIndex+1} of ${fan.length} · ${technique.shortLabel}`:""}</span><button type="button" class="button primary" @click=${this.#close}>Done</button></footer></div></dialog>`:nothing}`
      : html`<span class="generated-output-empty">${icon("image")}<small>${output?.provider==="simulation"?"Legacy simulated output":"No generated image"}</small></span>`;
  }
}

customElements.define("forma-output-visual",OutputVisual);
