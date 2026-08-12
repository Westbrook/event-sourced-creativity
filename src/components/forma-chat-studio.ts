import { html, nothing } from "lit";
import { FormaElement, icon } from "./forma-element";
import type { CreativeEvent, CreativeOutput } from "../model/events";
import { documentFocusFromRoute, withDocumentFocusInRoute, withDocumentInRoute } from "../model/routes";
import "./project-rail";
import "./studio-navigation";
import "./output-visual";

type ChatLine={id:string;role:"user"|"assistant";text:string;sequence:number};

export class FormaChatStudio extends FormaElement {
  #draft="";

  #lines(documentId:string){
    const content=this.store.content.get();const lines:ChatLine[]=[];
    for(const event of this.store.events.get()){
      if(String(event.payload.document_id??"")!==documentId)continue;
      const isUser=event.type==="ChatMessageSent";const isAssistant=event.type==="AssistantReasoned"&&event.payload.operation==="creative-chat";if(!isUser&&!isAssistant)continue;
      const text=String(content[String(event.payload.content_ref??"")]??"").trim();if(text)lines.push({id:event.eventId,role:isUser?"user":"assistant",text,sequence:event.sequence});
    }
    return lines;
  }

  #preview(documentId:string){return [...this.store.events.get()].reverse().find((event)=>event.type==="IdeationPreviewCompleted"&&String(event.payload.document_id??"")===documentId);}

  #previewOutput(event:CreativeEvent):CreativeOutput{return{id:`preview-${String(event.payload.generation_id??event.eventId)}`,documentId:String(event.payload.document_id??""),generationId:String(event.payload.generation_id??""),modelId:String(event.payload.model_id??"gpt-image-2"),variant:0,latency:Number(event.payload.latency_ms??0),sequence:event.sequence,pinned:false,saved:false,discarded:false,library:false,contentRef:null,provider:String(event.payload.provider??"openai"),mediaUrl:event.payload.media_url?String(event.payload.media_url):null,mediaType:event.payload.media_type?String(event.payload.media_type):null,width:Number(event.payload.image_width??1024),height:Number(event.payload.image_height??1024),plannerModelId:null};}

  async #send(event:SubmitEvent){event.preventDefault();const message=this.#draft.trim();if(!message||this.store.busy.get())return;this.#draft="";this.requestUpdate();await this.store.chat(message);await this.updateComplete;this.querySelector(".chat-thread-end")?.scrollIntoView({behavior:"smooth",block:"end"});}

  #keydown(event:KeyboardEvent){if(event.key==="Enter"&&!event.shiftKey){event.preventDefault();this.querySelector<HTMLFormElement>(".chat-composer")?.requestSubmit();}}

  override render(){
    const projection=this.store.projection.get();const lines=this.#lines(projection.documentId);const previewEvent=this.#preview(projection.documentId);const preview=previewEvent?this.#previewOutput(previewEvent):null;const final=projection.outputs[0]??null;const current=preview&&(!final||preview.sequence>final.sequence)?preview:final;const working=current===preview;const busy=this.store.busy.get();
    const destination=withDocumentFocusInRoute(withDocumentInRoute("/studio/chat",projection.documentId,projection.documentTitle),documentFocusFromRoute(this.store.route.get()));
    return html`<section class="workspace-page studio-subpage chat-view-page">
      <forma-project-rail surface="studio" destination=${destination} quiet></forma-project-rail>
      <div class="studio-main chat-view-main">
        <forma-studio-mode-nav active="chat"></forma-studio-mode-nav>
        <main class="chat-workspace" aria-label="Chat document view">
          <section class="chat-generation" aria-labelledby="chat-generation-title">
            <header><div><span class="eyebrow">${working?"Working preview":"Current generation"}</span><h1 id="chat-generation-title">${projection.documentTitle}</h1></div><span class=${`chat-image-status ${working?"working":"final"}`}>${working?"Following the conversation":"Full quality"}</span></header>
            <div class="chat-generation-stage">
              ${current?html`<forma-output-visual .output=${current} interactive></forma-output-visual>`:html`<div class="chat-generation-empty">${icon("image")}<b>Your image will appear here</b><span>Tell Forma what you want to make. A quick working preview will follow the conversation.</span></div>`}
            </div>
            <footer><p>${working?"This quick preview keeps pace with your ideas. Generate when the direction feels ready.":"This is the latest full-quality image. Keep talking to explore a new direction."}</p><button class="button primary chat-generate" ?disabled=${Boolean(busy)} @click=${()=>this.store.generate("chat")}>${busy==="generate"?"Generating full image…":html`${icon("spark")} Generate`}</button></footer>
          </section>

          <section class="chat-conversation" aria-labelledby="chat-thread-title">
            <header><div><span class="eyebrow">Creative conversation</span><h2 id="chat-thread-title">Chat with Forma</h2></div><p>Describe the image, revise an idea, or remove something that no longer belongs. Forma keeps the plan organized for you.</p></header>
            <div class="chat-thread" role="log" aria-live="polite" aria-busy=${busy==="chat"}>
              ${!lines.length?html`<article class="chat-line assistant"><span>Forma</span><p>What would you like to make? Start with the subject, feeling, setting, or simply the outcome you have in mind.</p></article>`:nothing}
              ${lines.map((line)=>html`<article class=${`chat-line ${line.role}`}><span>${line.role==="user"?"You":"Forma"}</span><p>${line.text}</p></article>`)}
              ${busy==="chat"?html`<article class="chat-line assistant thinking"><span>Forma</span><p>Working through that idea…</p></article>`:nothing}
              <span class="chat-thread-end" aria-hidden="true"></span>
            </div>
            <form class="chat-composer" @submit=${this.#send}>
              <label for="creative-chat-message" class="sr-only">Message Forma</label>
              <textarea id="creative-chat-message" rows="3" maxlength="4000" placeholder="Describe what to create or change…" .value=${this.#draft} @input=${(event:InputEvent)=>{this.#draft=(event.target as HTMLTextAreaElement).value;this.requestUpdate();}} @keydown=${this.#keydown}></textarea>
              <div><small>A fast working preview updates after useful changes. Shift + Enter adds a line.</small><button class="button primary" ?disabled=${!this.#draft.trim()||Boolean(busy)}>${busy==="chat"?"Forma is thinking…":html`Send ${icon("arrow")}`}</button></div>
            </form>
          </section>
        </main>
      </div>
    </section>`;
  }
}

customElements.define("forma-chat-studio",FormaChatStudio);
