import { memoryPrivacyMutationActive } from '../state/memory-privacy-mutation.ts';
import { html, nothing } from "lit";
import type { CommandDeparture } from "./command-departure";
import { FormaElement, icon } from "./forma-element";
import { blockIconName } from "./icon-semantics";
import { blockTypeDefinition, type BlockKind } from "../model/block-types";
import { generationHistoryItemIsDraft, generationHistoryItems, outputQualityLabel } from "../model/events";
import { documentFocusFromRoute, withDocumentFocusInRoute, withDocumentInRoute } from "../model/routes";
import { captureOutputNavigationFocus } from "./output-navigation-focus";
import { personalMemoryMessage } from "./design-system/locales/personal-memory-messages.ts";
import { createDocumentJobMemoryClient, DocumentJobMemoryError, type DocumentJobMemoryRequest,
  type DocumentJobMemoryLease } from "../state/document-job-memory-client.ts";
import "./project-rail";
import "./studio-navigation";
import "./output-visual";
import "./generation-actions";
import "./prompt-fan-visual";
import "./prompt-fan-review";
import "./document-artifacts";
import "./design-system/choice-card";
import "./design-system/conversation-composer";

type ChatLine={id:string;role:"user"|"assistant";text:string;sequence:number};
type ChatMemoryRequest = { request: DocumentJobMemoryRequest; current(): boolean; jobId: string | null;
  controller: AbortController | null; lease: DocumentJobMemoryLease | null;
  status: "working" | "pending" | "uncertain" | "unavailable" | "current" | "expired" };
const CHAT_CONTEXT_STARTERS: readonly BlockKind[] = ["direction", "subject", "style", "exclusion"];

export class FormaChatStudio extends FormaElement {
  #draft="";
  #livePreview=true;
  #sending=false;
  #showResult=false;
  #memory:ChatMemoryRequest|null=null;
  #memoryTimer:ReturnType<typeof setTimeout>|null=null;
  #suspendMemory=()=>{this.#retireMemory();this.requestUpdate();};
  #memoryPrivacyChanged=()=>{if(memoryPrivacyMutationActive())this.#suspendMemory();else this.requestUpdate();};
  #memoryVisibility=()=>{if(this.ownerDocument.visibilityState!=="visible")this.#suspendMemory();};

  override connectedCallback(){
    super.connectedCallback();this.ownerDocument.addEventListener("visibilitychange",this.#memoryVisibility);
    for(const name of ['blur','pagehide','forma-route-changed','forma-authorization-changed','forma-memory-assistant-context-changed'])this.ownerDocument.defaultView?.addEventListener(name,this.#suspendMemory);
    this.ownerDocument.defaultView?.addEventListener('forma-memory-privacy-mutation',this.#memoryPrivacyChanged);
  }
  override disconnectedCallback(){
    this.ownerDocument.removeEventListener("visibilitychange",this.#memoryVisibility);
    for(const name of ['blur','pagehide','forma-route-changed','forma-authorization-changed','forma-memory-assistant-context-changed'])this.ownerDocument.defaultView?.removeEventListener(name,this.#suspendMemory);
    this.ownerDocument.defaultView?.removeEventListener('forma-memory-privacy-mutation',this.#memoryPrivacyChanged);
    this.#retireMemory();super.disconnectedCallback();
  }
  #memoryText(key:string,values?:Record<string,string|number>){return personalMemoryMessage(this.i18n.locale,"memory.live."+key,values);}
  #retireMemory(){this.#memory?.controller?.abort();this.#memory?.lease?.retire();this.#memory=null;if(this.#memoryTimer!==null)clearTimeout(this.#memoryTimer);this.#memoryTimer=null;}
  #currentMemory(){
    const memory=this.#memory;
    if(memory&&(!memory.current()||memoryPrivacyMutationActive())){this.#retireMemory();return null;}
    if(memory?.lease&&!memory.lease.read()){memory.lease.retire();memory.lease=null;memory.status="expired";}
    return memory;
  }
  async #recallMemory(action:"new"|"check"|"retry"="new"){
    let memory=this.#currentMemory();if(memory?.status==="working")return;
    if(action==="new"){
      this.#retireMemory();
      const store=this.store,session=store.session.get(),source=store.captureSourceOwnership(),authorization=store.captureAuthorizationScope();
      const projection=store.projection.get(),documentId=projection.documentId,projectId=projection.projectId,route=store.route.get(),locale=this.i18n.locale;
      if(memoryPrivacyMutationActive()||!this.isConnected||!session||session.impersonation||!authorization||!documentId||!projectId||!store.sourceOwnershipActive(source)
        ||session.projectContext&&!session.projectContext.permissions.includes("project.output.request"))return;
      const actor=session.user.userId;
      memory={request:Object.freeze({documentId,requestId:crypto.randomUUID(),message:this.#memoryText("assistantRecallPrompt"),locale}),
        jobId:null,controller:null,lease:null,status:"working",current:()=>!memoryPrivacyMutationActive()&&this.#memory===memory&&this.isConnected&&this.store===store
          &&this.ownerDocument.visibilityState==="visible"&&store.session.get()?.user.userId===actor&&!store.session.get()?.impersonation
          &&store.authorizationScopeActive(authorization)&&store.sourceOwnershipActive(source)&&store.route.get()===route&&this.i18n.locale===locale
          &&store.projection.get().projectId===projectId&&store.projection.get().documentId===documentId};
      this.#memory=memory;
    }
    if(!memory||!memory.current()||action==="check"&&!memory.jobId)return;
    const owner=memory,controller=new AbortController();owner.controller=controller;owner.lease?.retire();owner.lease=null;owner.status="working";this.requestUpdate();
    const client=createDocumentJobMemoryClient((url,init)=>this.store.guardedFetch(url,init,this.#memoryText("assistantRecall"),{current:owner.current}));
    try{
      const result=action==="check"?await client.read(owner.request.documentId,owner.jobId!,controller.signal):await client.start(owner.request,controller.signal);
      if(!owner.current()||controller.signal.aborted){result.lease?.retire();return;}
      owner.jobId=result.jobId;owner.lease=result.lease;owner.status=result.status;
      if(result.lease){
        const lease=result.lease;if(this.#memoryTimer!==null)clearTimeout(this.#memoryTimer);
        this.#memoryTimer=setTimeout(()=>{lease.retire();if(this.#memory===owner){owner.lease=null;owner.status="expired";this.requestUpdate();}},Math.max(1,lease.remainingMs()));
      }
    }catch(error){if(owner.current()&&!controller.signal.aborted)owner.status=error instanceof DocumentJobMemoryError&&error.uncertain?"uncertain":"unavailable";}
    finally{if(this.#memory===owner){owner.controller=null;this.requestUpdate();}}
  }
  #renderMemory(){
    const memory=this.#currentMemory(),view=memory?.lease?.read(),working=memory?.status==="working";
    const actor=this.store.session.get(),available=Boolean(!memoryPrivacyMutationActive()&&actor&&!actor.impersonation&&this.store.projection.get().documentId
      &&(!actor.projectContext||actor.projectContext.permissions.includes("project.output.request")));
    return html`<section class="chat-memory" aria-label=${this.#memoryText("assistantRecallHistorical")} aria-busy=${working?"true":"false"}>
      <button type="button" class="button secondary compact" aria-describedby="chat-memory-help" ?disabled=${!available||working} @click=${()=>this.#recallMemory()}>${this.#memoryText("assistantRecall")}</button>
      <p id="chat-memory-help">${this.#memoryText("assistantRecallHelp")}</p>
      ${working?html`<p role="status">${this.#memoryText("assistantRecallWorking")}</p>`:nothing}
      ${view?html`<p role="status">${this.#memoryText("assistantRecallReady",{until:this.i18n.date(Date.parse(view.validUntil),{timeStyle:"medium"})})}</p><blockquote lang=${view.locale} dir="auto">${view.text}</blockquote>`:nothing}
      ${memory&&["pending","uncertain"].includes(memory.status)?html`<p role="status">${this.#memoryText("assistantRecallUncertain")}</p>
        ${memory.jobId?html`<button type="button" class="button secondary compact" @click=${()=>this.#recallMemory("check")}>${this.#memoryText("jobRecallCheck")}</button>`:nothing}
        <button type="button" class="button secondary compact" @click=${()=>this.#recallMemory("retry")}>${this.#memoryText("jobRecallRetry")}</button>`:nothing}
      ${memory?.status==="unavailable"?html`<p role="status">${this.#memoryText("assistantRecallUnavailable")}</p>`:nothing}
      ${memory?.status==="expired"?html`<p role="status">${this.#memoryText("assistantRecallExpired")}</p>`:nothing}
      ${memory?html`<button type="button" class="button secondary compact" @click=${this.#suspendMemory}>${this.#memoryText("jobRecallDismiss")}</button>`:nothing}
    </section>`;
  }

  captureCommandDeparture():CommandDeparture {
    const store=this.store,projection=store.projection.get(),projectId=projection.projectId,documentId=projection.documentId;
    return {element:this,current:()=>this.isConnected&&this.store===store
      &&store.projection.get().projectId===projectId&&store.projection.get().documentId===documentId,
      blocked:()=>Boolean(this.#draft||this.#sending),reason:()=>"next.lifecycle.currentWorkOpen"};
  }

  #lines(documentId:string){
    const content=this.store.content.get();const actorUserId=this.store.session.get()?.user.userId;const lines=new Map<string,ChatLine>();
    for(const event of this.store.events.get()){
      if(String(event.payload.document_id??"")!==documentId)continue;
      const isUser=event.type==="ChatMessageSent"&&event.payload.operation!=="document-job-memory";const isAssistant=event.type==="AssistantReasoned"&&event.payload.operation==="creative-chat";if(!isUser&&!isAssistant)continue;
      const eventActor=String(event.payload.actor_user_id??"");if(eventActor&&actorUserId&&eventActor!==actorUserId)continue;
      const text=String(content[String(event.payload.content_ref??"")]??"").trim();if(!text)continue;
      const role=isUser?"user":"assistant";const turnId=String(event.payload.turn_id??event.eventId);const key=`${turnId}:${role}`;const previous=lines.get(key);lines.set(key,{id:event.eventId,role,text,sequence:previous?.sequence??event.sequence});
    }
    return [...lines.values()].sort((left,right)=>left.sequence-right.sequence);
  }

  async #send(event:SubmitEvent){
    event.preventDefault();
    const draft=this.#draft,message=draft.trim();
    if(!message||this.#sending||this.store.busy.get()||this.store.documentJobActive("chat"))return;
    const source=this.store.captureSourceOwnership(),route=this.store.route.get(),documentId=this.store.projection.get().documentId;
    const focus=captureOutputNavigationFocus(this.ownerDocument);
    const current=()=>this.isConnected&&this.store.sourceOwnershipActive(source)&&this.store.route.get()===route
      &&this.store.projection.get().documentId===documentId;
    const presentationCurrent=()=>current()&&focus.current()&&!this.ownerDocument.querySelector("dialog[open]");
    this.#sending=true;this.requestUpdate();
    try{
      const accepted=await this.store.chat(message,this.#livePreview&&Boolean(this.store.session.get()?.provider.configured));
      if(!current())return;
      if(accepted){
        if(this.#draft===draft)this.#draft="";
        await this.updateComplete;
        const end=this.querySelector<HTMLElement>(".chat-thread-end");
        if(end&&presentationCurrent())focus.run(end,()=>{end.scrollIntoView({behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth",block:"end"});return true;});
      }else{
        const field=this.querySelector<HTMLTextAreaElement>(".chat-composer textarea");
        if(field&&presentationCurrent())focus.run(field,()=>{field.focus({preventScroll:true});return true;});
      }
    }finally{focus.dispose();this.#sending=false;this.requestUpdate();}
  }

  #prepareContext(type: BlockKind) {
    const definition = blockTypeDefinition(type);
    if (!definition) return;
    if (!this.#draft.trim()) this.#draft = this.i18n.system(definition.prompt);
    this.requestUpdate();
    this.#focusAfterUpdate("#creative-chat-message");
  }

  #closeResult(){this.#showResult=false;this.requestUpdate();this.#focusAfterUpdate(".chat-result-toggle");}
  #focusAfterUpdate(selector:string){
    const store=this.store,source=store.captureSourceOwnership(),authorization=store.captureAuthorizationScope();
    const route=store.route.get(),documentId=store.projection.get().documentId,focus=captureOutputNavigationFocus(this.ownerDocument);
    void this.updateComplete.then(()=>{
      if(!this.isConnected||this.store!==store||store.route.get()!==route||store.projection.get().documentId!==documentId
        ||!store.sourceOwnershipActive(source)||!store.authorizationScopeActive(authorization))return;
      const target=this.querySelector<HTMLElement>(selector);
      if(target)focus.run(target,()=>{target.focus({preventScroll:true});return true;});
    },()=>undefined).finally(()=>focus.dispose());
  }

  override render(){
    const projection=this.store.projection.get();const lines=this.#lines(projection.documentId);const history=generationHistoryItems(projection.outputs);const currentItem=history.find((item)=>(item.kind==="fan"?`fan:${item.id}`:item.id)===this.store.ui.selectedOutputId)??history[0]??null;const current=currentItem?.kind==="output"?currentItem.output:null;const previewProgress=this.store.documentPreviewProgress(projection.documentId);const previewActive=this.store.documentJobActive("preview",projection.documentId);const working=Boolean(previewProgress)||generationHistoryItemIsDraft(currentItem);const busy=this.store.busy.get();const chatActive=this.store.documentJobActive("chat");
    const projectContext=this.store.session.get()?.projectContext;
    const canGenerate=!projectContext||projectContext.permissions.includes("project.output.request");
    const provider=this.store.session.get()?.provider;
    const canChat=canGenerate&&Boolean(provider?.plannerConfigured??provider?.configured);
    const canPreview=Boolean(provider?.configured);
    const destination=withDocumentFocusInRoute(withDocumentInRoute("/studio/chat",projection.documentId,projection.documentTitle),documentFocusFromRoute(this.store.route.get()));
    const conversation=html`<section class="chat-conversation" aria-labelledby="chat-thread-title">
      <header><div><span class="eyebrow">Creative conversation</span><h2 id="chat-thread-title">Chat with Forma</h2></div><button type="button" class="button secondary compact chat-result-toggle" aria-controls="chat-result-preview" aria-expanded=${this.#showResult} @click=${()=>{this.#showResult=!this.#showResult;this.requestUpdate();}}>${this.i18n.t(this.#showResult?"chat.hideResult":"chat.showResult",this.#showResult?"Hide result":"Show result")}</button><p>${canGenerate?this.i18n.system("Describe the image, revise an idea, or remove something that no longer belongs. Forma keeps the plan organized for you."):this.i18n.t("chat.viewerConversationPrivacy","Creative conversations are private to each project editor; your role can review shared results.")}</p></header>
      <div class="chat-thread" role="log" aria-live="polite" aria-busy=${chatActive}>
        ${!lines.length&&canChat?html`<article class="chat-line assistant"><span>Forma</span><p>What would you like to make? Start with the subject, feeling, setting, or simply the outcome you have in mind.</p></article><section class="chat-context-starters" aria-label=${this.i18n.system("Add context")}>${CHAT_CONTEXT_STARTERS.map((type)=>{const definition=blockTypeDefinition(type)!;return html`<forma-ui-choice-card compact .label=${this.i18n.system(definition.label)} .detail=${this.i18n.system(definition.description)} .iconName=${blockIconName(type)} .value=${type} @forma-action=${()=>this.#prepareContext(type)}></forma-ui-choice-card>`;})}</section>`:nothing}
        ${lines.map((line)=>html`<article class=${`chat-line ${line.role}`}><span>${line.role==="user"?this.i18n.system("You"):"Forma"}</span><p>${line.text}</p></article>`)}
        ${chatActive?html`<article class="chat-line assistant thinking"><span>Forma</span><p>Working through that idea on the server… You can refresh or leave this view safely.</p></article>`:previewActive?html`<article class="chat-line assistant thinking previewing"><span>Forma</span><p>The plan is updated. I’m drawing its working preview separately, so the conversation is available before the image finishes.</p></article>`:nothing}
        <span class="chat-thread-end" aria-hidden="true"></span>
      </div>
      ${this.#renderMemory()}
      ${canChat?html`<form class="chat-composer" @submit=${this.#send}>
        <forma-ui-conversation-composer .label=${this.i18n.t("assistant.messageLabel")} .fieldId=${"creative-chat-message"}
          .placeholder=${this.i18n.t("assistant.mode.creativeChatPlaceholder")} .submitLabel=${this.i18n.t("assistant.send")}
          .value=${this.#draft} .rows=${3} .maxLength=${4_000} .showSubmitLabel=${true}
          .help=${this.i18n.t("assistant.composer.help")}
          .busy=${this.#sending||Boolean(busy)||chatActive}
          @forma-input=${(event:CustomEvent<{value:string}>)=>{this.#draft=event.detail.value;this.requestUpdate();}}></forma-ui-conversation-composer>
        <p class="chat-composer-help chat-budget-disclosure">${this.i18n.t(canPreview&&this.#livePreview?"assistant.creativeBudgetPreview":"assistant.creativeBudget")}</p>
        <div><label class="chat-live-preview"><input type="checkbox" .checked=${this.#livePreview&&canPreview} ?disabled=${!canPreview} aria-description=${!canPreview?this.i18n.t("assistant.previewUnavailable"):nothing} title=${!canPreview?this.i18n.t("assistant.previewUnavailable"):nothing} @change=${(event:Event)=>{this.#livePreview=(event.target as HTMLInputElement).checked;this.requestUpdate();}}><span><b>Live preview</b><small>${!canPreview?this.i18n.t("assistant.previewUnavailable"):this.#livePreview?this.i18n.system("Make a fast image after useful visual changes."):this.i18n.system("Keep chatting without generating an image.")}</small></span></label></div>
      </form>`:html`<p role="note">${canGenerate?this.i18n.t("assistant.creativeUnavailable"):this.i18n.t("workspace.admin.readOnlyGeneration","Your project role allows reviewing outputs but not creating them.")}</p>`}
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
            <header><div><span class="eyebrow">${working?this.i18n.system("Working preview"):this.i18n.system("Current generation")}</span><h2 id="chat-generation-title">${projection.documentTitle}</h2></div><span class=${`chat-image-status ${working?"working":currentItem?"final":"empty"}`}>${working?this.i18n.system("Following the conversation"):currentItem?this.i18n.system("Full quality"):this.i18n.t("chat.noImageYet","No image yet")}</span><button type="button" class="button secondary compact chat-result-close" aria-label=${this.i18n.t("chat.hideResult","Hide result")} @click=${this.#closeResult}>${this.i18n.t("chat.hideResult","Hide result")}</button></header>
            <div class="chat-generation-stage" aria-busy=${previewActive}>
              ${previewProgress?html`<div class="streaming-preview"><img class="streaming-preview-image" src=${previewProgress.mediaUrl} width=${previewProgress.width} height=${previewProgress.height} alt="Early image preview still being refined"><span>Early preview · finalizing</span></div>`:currentItem?.kind==="fan"?html`<div class="chat-prompt-fan"><forma-prompt-fan-visual .outputs=${currentItem.outputs}></forma-prompt-fan-visual><forma-prompt-fan-review .fanId=${currentItem.id}></forma-prompt-fan-review></div>`:current?html`<forma-output-visual .output=${current} interactive></forma-output-visual>`:html`<div class="chat-generation-empty">${icon("image")}<b>${previewActive?this.i18n.system("Preparing the first image…"):canGenerate?canPreview?this.i18n.system("Your image will appear here"):this.i18n.t("assistant.previewUnavailable"):this.i18n.t("chat.noSharedImage","No image has been shared yet")}</b><span>${previewActive?this.i18n.system("The server is resolving the latest creative plan. An early image will appear before the completed draft."):canGenerate?canPreview?this.i18n.system("Tell Forma what you want to make. A quick working preview will follow the conversation."):this.i18n.t("assistant.creativeBudget"):this.i18n.t("chat.viewerImageHint","A project editor can create an image for everyone to review.")}</span></div>`}
            </div>
            ${history.length>1?html`<div class="chat-generation-history" role="group" aria-label="Generation history">${history.map((item,index)=>{const id=item.kind==="fan"?`fan:${item.id}`:item.id;return html`<button class=${id===(currentItem?.kind==="fan"?`fan:${currentItem.id}`:currentItem?.id)?"selected":""} aria-pressed=${id===(currentItem?.kind==="fan"?`fan:${currentItem.id}`:currentItem?.id)} @click=${()=>this.store.patchUi({selectedOutputId:id})}>${item.kind==="fan"?html`<forma-prompt-fan-visual .outputs=${item.outputs} compact></forma-prompt-fan-visual>`:html`<forma-output-visual .output=${item.output} compact></forma-output-visual>`}<span>${item.kind==="fan"?this.i18n.system("{label} fan", { label: generationHistoryItemIsDraft(item) ? this.i18n.system("Draft") : this.i18n.system("Full") }):this.i18n.system(outputQualityLabel(item.output))}</span><small>${index===0?this.i18n.system("Latest"):`#${history.length-index}`}</small></button>`;})}</div>`:nothing}
            <footer><p>${previewProgress?this.i18n.system("This early image is usable for orientation while GPT Image finishes the durable draft."):working?this.i18n.system("This fast draft keeps pace with your ideas. Generating it at full quality records a deliberate promotion and preserves the visual handoff."):currentItem?this.i18n.system("This is a full-quality image. Preview another direction quickly, or keep talking to reshape the plan."):canGenerate?canPreview?this.i18n.t("chat.createImageHint","Start a conversation when you are ready to create an image."):this.i18n.t("assistant.previewUnavailable"):this.i18n.t("chat.viewerImageHint","A project editor can create an image for everyone to review.")}</p><forma-generation-actions source="chat" .selected=${current}></forma-generation-actions></footer>
            <forma-document-artifacts compact source="chat"></forma-document-artifacts>
          </section>

        </div></div>
      </div>
    </section>`;
  }
}

if (!customElements.get("forma-chat-studio")) customElements.define("forma-chat-studio",FormaChatStudio);
