import { html, nothing } from "lit";
import { FormaElement, icon } from "./forma-element";
import { blockIconName } from "./icon-semantics";
import { blockTypeDefinition, type BlockKind } from "../model/block-types";
import { generationHistoryItemIsDraft, generationHistoryItems, outputQualityLabel } from "../model/events";
import { documentFocusFromRoute, withDocumentFocusInRoute, withDocumentInRoute } from "../model/routes";
import "./project-rail";
import "./studio-navigation";
import "./output-visual";
import "./generation-actions";
import "./prompt-fan-visual";
import "./prompt-fan-review";
import "./document-artifacts";
import "./design-system/choice-card";

type ChatLine={id:string;role:"user"|"assistant";text:string;sequence:number};
const CHAT_CONTEXT_STARTERS: readonly BlockKind[] = ["direction", "subject", "style", "exclusion"];

export class FormaChatStudio extends FormaElement {
  #draft="";
  #livePreview=true;
  #sending=false;
  #showResult=false;

  #lines(documentId:string){
    const content=this.store.content.get();const lines:ChatLine[]=[];
    for(const event of this.store.events.get()){
      if(String(event.payload.document_id??"")!==documentId)continue;
      const isUser=event.type==="ChatMessageSent";const isAssistant=event.type==="AssistantReasoned"&&event.payload.operation==="creative-chat";if(!isUser&&!isAssistant)continue;
      const text=String(content[String(event.payload.content_ref??"")]??"").trim();if(text)lines.push({id:event.eventId,role:isUser?"user":"assistant",text,sequence:event.sequence});
    }
    return lines;
  }

  async #send(event:SubmitEvent){event.preventDefault();const message=this.#draft.trim();if(!message||this.#sending||this.store.busy.get()||this.store.documentJobActive("chat"))return;this.#sending=true;this.requestUpdate();try{const accepted=await this.store.chat(message,this.#livePreview);if(accepted){this.#draft="";await this.updateComplete;this.querySelector(".chat-thread-end")?.scrollIntoView({behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth",block:"end"});}else this.querySelector<HTMLTextAreaElement>(".chat-composer textarea")?.focus({preventScroll:true});}finally{this.#sending=false;this.requestUpdate();}}

  #keydown(event:KeyboardEvent){if(event.key==="Enter"&&!event.shiftKey&&!event.isComposing&&!event.metaKey&&!event.ctrlKey&&!event.altKey){event.preventDefault();const submitter=this.querySelector<HTMLButtonElement>('.chat-composer button[type="submit"]');if(submitter&&!submitter.disabled)submitter.form?.requestSubmit(submitter);}}

  #prepareContext(type: BlockKind) {
    const definition = blockTypeDefinition(type);
    if (!definition) return;
    if (!this.#draft.trim()) this.#draft = this.i18n.system(definition.prompt);
    this.requestUpdate();
    void this.updateComplete.then(() => this.querySelector<HTMLTextAreaElement>("#creative-chat-message")?.focus({ preventScroll: true }));
  }

  override render(){
    const projection=this.store.projection.get();const lines=this.#lines(projection.documentId);const history=generationHistoryItems(projection.outputs);const currentItem=history.find((item)=>(item.kind==="fan"?`fan:${item.id}`:item.id)===this.store.ui.selectedOutputId)??history[0]??null;const current=currentItem?.kind==="output"?currentItem.output:null;const previewProgress=this.store.documentPreviewProgress(projection.documentId);const previewActive=this.store.documentJobActive("preview",projection.documentId);const working=Boolean(previewProgress)||generationHistoryItemIsDraft(currentItem);const busy=this.store.busy.get();const chatActive=this.store.documentJobActive("chat");
    const projectContext=this.store.session.get()?.projectContext;
    const canGenerate=!projectContext||projectContext.permissions.includes("project.output.request");
    const destination=withDocumentFocusInRoute(withDocumentInRoute("/studio/chat",projection.documentId,projection.documentTitle),documentFocusFromRoute(this.store.route.get()));
    const conversation=html`<section class="chat-conversation" aria-labelledby="chat-thread-title">
      <header><div><span class="eyebrow">Creative conversation</span><h2 id="chat-thread-title">Chat with Forma</h2></div><button type="button" class="button secondary compact chat-result-toggle" aria-controls="chat-result-preview" aria-expanded=${this.#showResult} @click=${()=>{this.#showResult=!this.#showResult;this.requestUpdate();}}>${this.i18n.t(this.#showResult?"chat.hideResult":"chat.showResult",this.#showResult?"Hide result":"Show result")}</button><p>${canGenerate?this.i18n.system("Describe the image, revise an idea, or remove something that no longer belongs. Forma keeps the plan organized for you."):this.i18n.t("chat.viewerConversationPrivacy","Creative conversations are private to each project editor; your role can review shared results.")}</p></header>
      <div class="chat-thread" role="log" aria-live="polite" aria-busy=${chatActive}>
        ${!lines.length&&canGenerate?html`<article class="chat-line assistant"><span>Forma</span><p>What would you like to make? Start with the subject, feeling, setting, or simply the outcome you have in mind.</p></article><section class="chat-context-starters" aria-label=${this.i18n.system("Add context")}>${CHAT_CONTEXT_STARTERS.map((type)=>{const definition=blockTypeDefinition(type)!;return html`<forma-ui-choice-card compact .label=${this.i18n.system(definition.label)} .detail=${this.i18n.system(definition.description)} .iconName=${blockIconName(type)} .value=${type} @forma-action=${()=>this.#prepareContext(type)}></forma-ui-choice-card>`;})}</section>`:nothing}
        ${lines.map((line)=>html`<article class=${`chat-line ${line.role}`}><span>${line.role==="user"?this.i18n.system("You"):"Forma"}</span><p>${line.text}</p></article>`)}
        ${chatActive?html`<article class="chat-line assistant thinking"><span>Forma</span><p>Working through that idea on the server… You can refresh or leave this view safely.</p></article>`:previewActive?html`<article class="chat-line assistant thinking previewing"><span>Forma</span><p>The plan is updated. I’m drawing its working preview separately, so the conversation is available before the image finishes.</p></article>`:nothing}
        <span class="chat-thread-end" aria-hidden="true"></span>
      </div>
      ${canGenerate?html`<form class="chat-composer" @submit=${this.#send}>
        <label for="creative-chat-message" class="sr-only">Message Forma</label>
        <textarea id="creative-chat-message" rows="3" maxlength="4000" placeholder="Describe what to create or change…" .value=${this.#draft} @input=${(event:InputEvent)=>{this.#draft=(event.target as HTMLTextAreaElement).value;this.requestUpdate();}} @keydown=${this.#keydown}></textarea>
        <p class="chat-composer-help">Shift + Enter adds a line. Your message still updates the creative plan when previewing is paused.</p>
        <div><label class="chat-live-preview"><input type="checkbox" .checked=${this.#livePreview} @change=${(event:Event)=>{this.#livePreview=(event.target as HTMLInputElement).checked;this.requestUpdate();}}><span><b>Live preview</b><small>${this.#livePreview?this.i18n.system("Make a fast image after useful visual changes."):this.i18n.system("Keep chatting without generating an image.")}</small></span></label><button type="submit" class="button primary" ?disabled=${!this.#draft.trim()||this.#sending||Boolean(busy)||chatActive}>${this.#sending||chatActive?this.i18n.system("Forma is thinking safely…"):html`Send ${icon("arrow")}`}</button></div>
      </form>`:html`<p role="note">${this.i18n.t("workspace.admin.readOnlyGeneration","Your project role allows reviewing outputs but not creating them.")}</p>`}
    </section>`;
    return html`<section class="workspace-page studio-subpage chat-view-page">
      <forma-project-rail surface="studio" destination=${destination} quiet></forma-project-rail>
      <div class="studio-main chat-view-main">
        <div class="studio-header-stack">
          <header class="page-header page-header--document">
            <div class="page-header-copy">
              <span class="eyebrow">${projection.projectName} / ${projection.documentTitle} / Document view</span>
              <h1>Chat</h1>
              <p>Shape the same durable document through conversation while the creative plan stays out of the way.</p>
            </div>
          </header>
          <forma-studio-mode-nav active="chat"></forma-studio-mode-nav>
        </div>
        <div class="studio-subpage-body studio-subpage-body--chat"><div class="chat-workspace" data-result-open=${String(this.#showResult)} role="region" aria-labelledby="chat-thread-title">
          ${conversation}
          <section class="chat-generation" id="chat-result-preview" aria-labelledby="chat-generation-title">
            <header><div><span class="eyebrow">${working?this.i18n.system("Working preview"):this.i18n.system("Current generation")}</span><h2 id="chat-generation-title">${projection.documentTitle}</h2></div><span class=${`chat-image-status ${working?"working":currentItem?"final":"empty"}`}>${working?this.i18n.system("Following the conversation"):currentItem?this.i18n.system("Full quality"):this.i18n.t("chat.noImageYet","No image yet")}</span></header>
            <div class="chat-generation-stage" aria-busy=${previewActive}>
              ${previewProgress?html`<div class="streaming-preview"><img class="streaming-preview-image" src=${previewProgress.mediaUrl} width=${previewProgress.width} height=${previewProgress.height} alt="Early image preview still being refined"><span>Early preview · finalizing</span></div>`:currentItem?.kind==="fan"?html`<div class="chat-prompt-fan"><forma-prompt-fan-visual .outputs=${currentItem.outputs}></forma-prompt-fan-visual><forma-prompt-fan-review .fanId=${currentItem.id}></forma-prompt-fan-review></div>`:current?html`<forma-output-visual .output=${current} interactive></forma-output-visual>`:html`<div class="chat-generation-empty">${icon("image")}<b>${previewActive?this.i18n.system("Preparing the first image…"):canGenerate?this.i18n.system("Your image will appear here"):this.i18n.t("chat.noSharedImage","No image has been shared yet")}</b><span>${previewActive?this.i18n.system("The server is resolving the latest creative plan. An early image will appear before the completed draft."):canGenerate?this.i18n.system("Tell Forma what you want to make. A quick working preview will follow the conversation."):this.i18n.t("chat.viewerImageHint","A project editor can create an image for everyone to review.")}</span></div>`}
            </div>
            ${history.length>1?html`<div class="chat-generation-history" role="group" aria-label="Generation history">${history.map((item,index)=>{const id=item.kind==="fan"?`fan:${item.id}`:item.id;return html`<button class=${id===(currentItem?.kind==="fan"?`fan:${currentItem.id}`:currentItem?.id)?"selected":""} aria-pressed=${id===(currentItem?.kind==="fan"?`fan:${currentItem.id}`:currentItem?.id)} @click=${()=>this.store.patchUi({selectedOutputId:id})}>${item.kind==="fan"?html`<forma-prompt-fan-visual .outputs=${item.outputs} compact></forma-prompt-fan-visual>`:html`<forma-output-visual .output=${item.output} compact></forma-output-visual>`}<span>${item.kind==="fan"?this.i18n.system("{label} fan", { label: generationHistoryItemIsDraft(item) ? this.i18n.system("Draft") : this.i18n.system("Full") }):this.i18n.system(outputQualityLabel(item.output))}</span><small>${index===0?this.i18n.system("Latest"):`#${history.length-index}`}</small></button>`;})}</div>`:nothing}
            <footer><p>${previewProgress?this.i18n.system("This early image is usable for orientation while GPT Image finishes the durable draft."):working?this.i18n.system("This fast draft keeps pace with your ideas. Generating it at full quality records a deliberate promotion and preserves the visual handoff."):currentItem?this.i18n.system("This is a full-quality image. Preview another direction quickly, or keep talking to reshape the plan."):canGenerate?this.i18n.t("chat.createImageHint","Start a conversation when you are ready to create an image."):this.i18n.t("chat.viewerImageHint","A project editor can create an image for everyone to review.")}</p><forma-generation-actions source="chat" .selected=${current}></forma-generation-actions></footer>
            <forma-document-artifacts compact source="chat"></forma-document-artifacts>
          </section>

        </div></div>
      </div>
    </section>`;
  }
}

if (!customElements.get("forma-chat-studio")) customElements.define("forma-chat-studio",FormaChatStudio);
