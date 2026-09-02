import { html, nothing } from "lit";
import { live } from "lit/directives/live.js";
import { FormaElement, icon } from "./forma-element";
import { navigateInApp } from "./command-departure";
import { captureOutputNavigationFocus, outputNavigationOwnedRouteFocus, type OutputNavigationFocusLease } from "./output-navigation-focus";
import { ensureModalDialog } from "./modal-dialog";
import type { FormaUiPopover } from "./design-system/feedback";
import { documentContextBlockFromRoute, documentFocusFromRoute, documentIdFromRoute, isDocumentViewRoute, withDocumentFocusInRoute, withDocumentInRoute } from "../model/routes";
import { generationHistoryItemIsDraft, generationHistoryItems, generationHistoryMix, outputQualityLabel, type CreativeBlock } from "../model/events";
import { documentArtifactDefinition } from "../model/document-artifacts";
import { artifactIconName, blockIconName } from "./icon-semantics";
import "./icons-navigation";
import "./design-system/choice-card";
import "./design-system/feedback";
import "./studio-navigation.css";
import "./reference-image";

type StudioMode = "document" | "board" | "guided" | "layers" | "adaptive" | "editor" | "chat";

const modes: Array<{ id: StudioMode; label: string; path: string }> = [
  { id: "document", label: "Document", path: "/" },
  { id: "board", label: "Context board", path: "/studio/board" },
  { id: "guided", label: "Guided brief", path: "/studio/guided" },
  { id: "layers", label: "Reality layers", path: "/studio/layers" },
  { id: "adaptive", label: "Adaptive path", path: "/studio/adaptive" },
  { id: "editor", label: "Creative editor", path: "/studio/editor" },
  { id: "chat", label: "Chat", path: "/studio/chat" },
];

const lensCopy: Record<Exclude<StudioMode, "document">, string> = {
  board: "Every decision is placed by the job it performs.",
  guided: "The interview focuses the next questions without dropping supporting decisions.",
  layers: "Every decision stays in the stack, including choices with no current influence.",
  adaptive: "The next-step path changes, while the complete document remains in scope.",
  editor: "The creative plan stays complete while the machinery stays out of sight.",
  chat: "The conversation changes the complete creative plan without exposing its machinery.",
};

const DOCUMENT_FOCUS_KEY = "forma:document-focus";
const readDocumentFocus = () => {
  try { return localStorage.getItem(DOCUMENT_FOCUS_KEY) === "true"; }
  catch { return false; }
};

export class StudioModeNav extends FormaElement {
  #focused = false;
  #contextPickerOpen = false;
  #contextSource: "choose" | "reuse" = "choose";
  #contextPickerRevision=0;
  #cancelContextCopy:(()=>void)|null=null;
  #revealedMode: StudioMode | null = null;
  #viewMenuCurrent: (() => boolean) | null = null;
  #focusKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && !event.defaultPrevented && this.#focused
      && !document.querySelector("dialog[open], :popover-open")) this.#setFocused(false);
  };

  override connectedCallback() {
    super.connectedCallback();
    const route = this.store.route.get();
    const routeFocused = documentFocusFromRoute(route);
    this.#focused = routeFocused || readDocumentFocus();
    if (this.#focused && !routeFocused && isDocumentViewRoute(route)) this.store.setRoute(withDocumentFocusInRoute(route, true), { replace: true, documentFocus: true });
    this.#reflectFocus();
    window.addEventListener("keydown", this.#focusKeydown);
  }

  override disconnectedCallback() {
    this.#cancelContextCopy?.();this.#contextPickerRevision++;
    this.querySelector<FormaUiPopover>(".studio-view-menu")?.close();
    this.#viewMenuCurrent = null;
    window.removeEventListener("keydown", this.#focusKeydown);
    document.documentElement.removeAttribute("data-document-focus");
    super.disconnectedCallback();
  }

  protected override willUpdate() {
    if (this.#viewMenuCurrent && !this.#viewMenuCurrent()) this.querySelector<FormaUiPopover>(".studio-view-menu")?.close();
  }

  protected override updated() {
    const dialog = this.querySelector<HTMLDialogElement>(".context-set-picker-dialog");
    ensureModalDialog(dialog);

    const active = (this.getAttribute("active") ?? "document") as StudioMode;
    if (active !== this.#revealedMode) {
      this.#revealedMode = active;
      this.#revealActiveMode();
    }
  }

  #revealActiveMode(scroller = this.querySelector<HTMLElement>(".studio-mode-links")) {
    const activeControl = scroller?.querySelector<HTMLElement>(".ui-popover-trigger");
    if (!scroller || !activeControl) return;

    const scrollerBounds = scroller.getBoundingClientRect();
    const activeBounds = activeControl.getBoundingClientRect();
    const breathingRoom = 8;
    if (activeBounds.left < scrollerBounds.left + breathingRoom) {
      scroller.scrollLeft += activeBounds.left - scrollerBounds.left - breathingRoom;
    } else if (activeBounds.right > scrollerBounds.right - breathingRoom) {
      scroller.scrollLeft += activeBounds.right - scrollerBounds.right + breathingRoom;
    }
  }


  #viewMenu(visibleModes: typeof modes, active: StudioMode) {
    if (visibleModes.length < 2) {
      this.#viewMenuCurrent = null;
      return html`<span class="studio-current-view">${this.i18n.system(visibleModes[0]?.label ?? "Document")}</span>`;
    }
    const projection = this.store.projection.get(), route = this.store.route.get();
    const projectId = projection.projectId, documentId = projection.documentId;
    const sourceOwner = this.store.captureSourceOwnership();
    const current = () => Boolean(this.isConnected && this.store.sourceOwnershipActive(sourceOwner)
      && this.store.route.get() === route && this.store.projection.get().projectId === projectId
      && this.store.projection.get().documentId === documentId);
    this.#viewMenuCurrent = current;
    const menu = () => this.querySelector<FormaUiPopover>(".studio-view-menu");
    const currentMode = visibleModes.find(mode => mode.id === active) ?? visibleModes[0]!;
    const links = html`<nav class="studio-view-options" aria-label=${this.i18n.t("studio.view.label", "Document views")}>${visibleModes.map(mode => {
      const href = withDocumentFocusInRoute(withDocumentInRoute(mode.path, documentId, projection.documentTitle), this.#focused);
      return html`<a data-studio-view=${mode.id} href=${href} class=${active === mode.id ? "active" : ""} aria-current=${active === mode.id ? "page" : nothing}
        @click=${(event: MouseEvent) => {
          if (event.defaultPrevented) return;
          const popover = menu(), link = event.currentTarget as HTMLAnchorElement | null;
          const context = this.store.session.get()?.projectContext;
          const choiceCurrent = () => Boolean(current() && popover?.isConnected && link?.isConnected && popover.contains(link)
            && link.getAttribute("href") === href && popover.querySelector(".ui-popover-panel")?.matches(":popover-open")
            && (mode.id === "document" || !context || context.permissions.includes("project.author")));
          if (!choiceCurrent()) { event.preventDefault(); return; }
          // Keep ordinary link semantics for opening this exact view in another tab.
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          // Choosing this exact current URL only dismisses the menu, even with
          // local work. It does not ask the Store to replace the current owner.
          if (href === this.store.route.get()) { event.preventDefault(); popover!.close(true); return; }
          this.#go(event, href, false, () => {
            if (!choiceCurrent()) return false;
            // Capture admission before native closure returns focus to the
            // exact invoker. The shared navigation checks that lease again.
            popover!.close(true);
            return true;
          });
        }}>${this.i18n.system(mode.label)}</a>`;
    })}</nav>`;
    return html`<forma-ui-popover class="studio-view-menu"
      .label=${this.i18n.t("studio.view.changeCurrent", "Change view · {view}", { view: this.i18n.system(currentMode.label) })}
      .heading=${this.i18n.t("studio.view.change", "Change view")} .content=${links}
      @focusin=${(event: FocusEvent) => {
        const popover = menu(), target = event.composedPath()[0];
        const panel = popover?.querySelector<HTMLElement>(".ui-popover-panel");
        const scroller = this.querySelector<HTMLElement>(".studio-mode-nav");
        if (!current() || !popover?.isConnected || event.currentTarget !== popover
          || !(target instanceof HTMLElement) || target.tagName !== "BUTTON" || !target.isConnected
          || target !== popover.querySelector(".ui-popover-trigger")
          || popover.querySelectorAll(".ui-popover-trigger").length !== 1
          || target.ownerDocument !== this.ownerDocument || this.ownerDocument.activeElement !== target
          || target.matches(":disabled") || !target.matches(":focus-visible")
          || !panel?.isConnected || panel.matches(":popover-open")
          || target.getAttribute("popovertarget") !== panel.getAttribute("id")
          || !scroller?.contains(popover) || scroller.closest("forma-studio-mode-nav") !== this
          || scroller.querySelector(".ui-popover-trigger") !== target
          || !["auto", "scroll"].includes(this.ownerDocument.defaultView?.getComputedStyle(scroller).overflowX ?? "")) return;
        // Only the current horizontal owner moves; do not scroll the page or
        // manipulate an open native panel to reveal a keyboard-focused trigger.
        this.#revealActiveMode(scroller);
      }}
      @forma-toggle=${(event: CustomEvent<{ open: boolean }>) => {
        const popover = menu();
        if (event.detail.open && event.currentTarget === popover && !current()) popover?.close();
      }}></forma-ui-popover>`;
  }

  #reflectFocus() {
    document.documentElement.toggleAttribute("data-document-focus", this.#focused);
  }

  #setFocused(focused: boolean) {
    const path=withDocumentFocusInRoute(this.store.route.get(),focused);
    if(path===this.store.route.get())return;
    void navigateInApp(this,navigation=>{
      this.#focused = focused;
      try { localStorage.setItem(DOCUMENT_FOCUS_KEY, String(focused)); } catch { /* Device preference remains session-only. */ }
      this.#reflectFocus();this.requestUpdate();
      return navigation.route(path,{documentFocus:focused});
    });
  }

  #go(event:MouseEvent,path:string,present=false,onAdmitted?:()=>boolean){
    if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    event.preventDefault();
    if(path===this.store.route.get())return;
    void navigateInApp(this,async navigation=>{
      if(onAdmitted&&(!onAdmitted()||!navigation.current()))return false;
      const opened=await navigation.route(path);
      if(opened&&present&&navigation.current())await new Promise<void>(resolve=>requestAnimationFrame(()=>{
        if(navigation.current())document.getElementById("output-title")?.scrollIntoView({block:"start",behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"});
        resolve();
      }));
      if(opened&&!present&&navigation.current())window.scrollTo({top:0});
      return opened;
    });
  }

  #contextPickerSources(){
    const projection=this.store.projection.get();
    const standalone=projection.libraryBlocks.filter(block=>block.scope==="library");
    const targeted=new Set(projection.libraryBlockRelations.map(relation=>relation.toBlockId));
    return {roots:standalone.filter(block=>block.type!=="reference"||!targeted.has(block.id)),
      hasPreviousWork:projection.libraryArtifacts.length>0||projection.libraryOutputs.some(output=>Boolean(output.mediaUrl)&&!output.discarded)};
  }
  #openEmptyContextLibrary(event:MouseEvent){
    if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    event.preventDefault();
    const element=this.querySelector<HTMLDialogElement>(".context-set-picker-dialog");
    const trigger=event.currentTarget as HTMLElement|null,opener=this.querySelector<HTMLButtonElement>(".context-set-trigger");
    if(!element||!trigger)return;
    const {projectId,documentId}=this.store.projection.get();
    const current=()=>{
      const projection=this.store.projection.get(),contents=this.#contextPickerSources();
      return this.#contextPickerOpen&&this.#contextSource==="reuse"
        &&this.querySelector<HTMLDialogElement>(".context-set-picker-dialog")===element
        &&projection.projectId===projectId&&projection.documentId===documentId
        &&contents.roots.length===0&&!contents.hasPreviousWork;
    };
    void navigateInApp(this,navigation=>{
      if(!navigation.closePresentation(()=>this.#closeContextPicker()))return false;
      return navigation.route("/library/blocks/editor/new");
    },{presentation:{owner:this,element,trigger,current,...(opener?{opener}:{})}});
  }
  #chooseContextSource(source:"choose"|"reuse"){
    this.#cancelContextCopy?.();this.#contextPickerRevision++;this.#contextSource=source;this.requestUpdate();
  }
  #openContextPicker(){this.#chooseContextSource("choose");this.#contextPickerOpen=true;this.requestUpdate();}
  #closeContextPicker(){this.#cancelContextCopy?.();this.#contextPickerRevision++;this.querySelector<HTMLDialogElement>(".context-set-picker-dialog")?.close();this.#contextPickerOpen=false;this.#contextSource="choose";this.requestUpdate();}
  #captureContextCopy(event:MouseEvent){
    const element=this.querySelector<HTMLDialogElement>(".context-set-picker-dialog"),trigger=event.currentTarget as HTMLElement|null;
    if(!this.isConnected||!this.#contextPickerOpen||this.#contextSource!=="reuse"||!element?.open||!trigger?.isConnected
      ||!element.contains(trigger)||trigger.matches(":disabled"))return null;
    this.#cancelContextCopy?.();
    let revision=++this.#contextPickerRevision,retired=false,closedOwn=false,transferred=false,targetBlockId="";
    let unsubscribe=()=>{};
    const store=this.store,route=store.route.get(),{projectId,documentId}=store.projection.get();
    const source=store.captureSourceOwnership(),authorization=store.captureAuthorizationScope();
    const opener=this.querySelector<HTMLButtonElement>(".context-set-trigger");
    const sourceCurrent=()=>{
      const session=store.session.get(),permissions=session?.projectContext?.permissions??session?.capabilities??[];
      return store.sourceOwnershipActive(source)&&store.authorizationScopeActive(authorization)
        &&store.projection.get().projectId===projectId&&store.projection.get().documentId===documentId
        &&permissions.includes("project.read")&&permissions.includes("project.author");
    };
    const scopeCurrent=()=>this.isConnected&&this.store===store&&store.route.get()===route&&sourceCurrent();
    const focus:OutputNavigationFocusLease=captureOutputNavigationFocus(this.ownerDocument,{ownedRouteFocus:target=>{
      if(closedOwn&&target===opener&&Boolean(opener?.isConnected)&&scopeCurrent())return true;
      if(!transferred||!targetBlockId||!sourceCurrent())return false;
      const destination=store.route.get(),arrival=store.captureWorkspaceNavigationFocus(destination,focus);
      const current=()=>Boolean(arrival?.routeCurrent())&&sourceCurrent();
      // Native modal close may keep this original opener focused until the
      // same lease's exact copied-input destination presents its editor.
      if(closedOwn&&target===opener&&opener?.isConnected&&!opener.closest("[hidden],[inert]")
        &&!opener.matches(":disabled")&&current()&&documentIdFromRoute(destination)===documentId
        &&documentContextBlockFromRoute(destination)===targetBlockId)return true;
      return current()&&outputNavigationOwnedRouteFocus(this.ownerDocument,store,{documentId,blockId:targetBlockId},current)(target);
    }});
    const dispose=()=>{
      retired=true;unsubscribe();if(!transferred)focus.dispose();
      if(this.#cancelContextCopy===dispose)this.#cancelContextCopy=null;
    };
    const current=()=>{
      try{
        if(!retired&&scopeCurrent()&&revision===this.#contextPickerRevision&&focus.current()
          &&(closedOwn||this.#contextPickerOpen&&this.#contextSource==="reuse"
            &&this.querySelector(".context-set-picker-dialog")===element&&element.isConnected&&element.open))return true;
      }catch{/* A retired original gesture cannot acquire a new picker or Source. */}
      dispose();return false;
    };
    this.#cancelContextCopy=dispose;
    unsubscribe=store.subscribe(()=>{if(!current())dispose();});
    const close=()=>{
      if(!current())return false;
      // Only this positive completion may perform its own synchronous close.
      // Ordinary Cancel/Back/open still retires the original completion first.
      if(this.#cancelContextCopy===dispose)this.#cancelContextCopy=null;
      closedOwn=true;this.#closeContextPicker();revision=this.#contextPickerRevision;
      return current();
    };
    if(!current())return null;
    return{current,close,dispose,async reveal(blockId:string){
      if(!close()||!current())return false;
      targetBlockId=blockId;transferred=true;unsubscribe();
      // The existing reveal lifetime now owns this same lease, including every
      // early refusal and its deferred native presentation cleanup.
      return store.revealOutputInput(blockId,documentId,{current,focus});
    }};
  }
  #requestContextCreation(){this.#closeContextPicker();this.dispatchEvent(new CustomEvent("forma-context-create",{bubbles:true,composed:true}));}
  #connectedIds(rootId:string){const projection=this.store.projection.get();const ids=new Set([rootId]);let changed=true;while(changed&&ids.size<24){changed=false;for(const relation of projection.libraryBlockRelations)if(ids.has(relation.fromBlockId)&&!ids.has(relation.toBlockId)){ids.add(relation.toBlockId);changed=true;}}return ids;}
  async #admitContextCopy(event:MouseEvent,run:()=>Promise<void>){
    const element=this.querySelector<HTMLDialogElement>(".context-set-picker-dialog"),trigger=event.currentTarget as HTMLElement|null;
    const opener=this.querySelector<HTMLButtonElement>(".context-set-trigger");
    if(!element||!trigger)return;
    const revision=this.#contextPickerRevision,route=this.store.route.get(),{projectId,documentId}=this.store.projection.get();
    const current=()=>{
      const projection=this.store.projection.get();
      return this.#contextPickerOpen&&this.#contextSource==="reuse"&&revision===this.#contextPickerRevision
        &&this.querySelector(".context-set-picker-dialog")===element&&this.store.route.get()===route
        &&projection.projectId===projectId&&projection.documentId===documentId;
    };
    let pending:Promise<void>|undefined;
    await navigateInApp(this,()=>{
      // Admission precedes dispatch while this exact picker remains shown.
      // The existing completion captures its own original lease synchronously;
      // Shell's admission lease ends here, not after canonical copy publication.
      pending=run();return true;
    },{presentation:{owner:this,element,trigger,current,...(opener?{opener}:{})}});
    if(pending)await pending;
  }
  async #addContextSet(rootId:string,event:MouseEvent){
    const source=this.store.projection.get().libraryBlocks.find(block=>block.id===rootId);
    const reveals=Boolean(source?.properties.source_artifact_id||source?.properties.source_output_id);
    const copy=async()=>{
      const completion=this.#captureContextCopy(event);if(!completion)return;
      try{
        const result=await this.store.copyLibraryBlockSet(rootId,undefined,"document-view-context-picker");
        if(!result||"publication"in result||!completion.current())return;
        if(reveals)await completion.reveal(result.rootBlockId);
        else completion.close();
      }finally{completion.dispose();}
    };
    // Plain Add block remains a same-view authoring action, not a departure.
    if(reveals)await this.#admitContextCopy(event,copy);else await copy();
  }
  async #addPreviousWork(kind:"image"|"artifact",id:string,event:MouseEvent){
    await this.#admitContextCopy(event,async()=>{
      const completion=this.#captureContextCopy(event);if(!completion)return;
      const destination=this.store.projection.get().documentId;
      try{
        const result=kind==="image"?await this.store.addImageOutputAsContext(id,destination,"document-view-context-picker",{reveal:false})
          :await this.store.addArtifactAsContext(id,destination,"document-view-context-picker",{reveal:false});
        if(!result||"publication"in result||!result.rootBlockId||!completion.current())return;
        await completion.reveal(result.rootBlockId);
      }finally{completion.dispose();}
    });
  }
  #previousWork(){
    const projection=this.store.projection.get();const images=projection.libraryOutputs.filter((output)=>Boolean(output.mediaUrl)&&!output.discarded);const artifacts=projection.libraryArtifacts;if(!images.length&&!artifacts.length)return nothing;
    return html`<section class="context-picker-previous-work" aria-label="Previous generated work"><h3>Previous work</h3><p>Every finished result can become editable context in ${projection.documentTitle}.</p>${artifacts.map((artifact)=>{const existing=projection.blocks.some((block)=>block.properties.source_artifact_id===artifact.id&&!block.properties.source_artifact_item_id);return html`<article><div class="context-set-preview"><span aria-hidden="true">${icon(artifactIconName(artifact.kind))}</span></div><div><span>${this.i18n.system(documentArtifactDefinition(artifact.kind).label)}</span><h3>${artifact.title}</h3><p>${artifact.summary}</p></div><button type="button" class="button primary" aria-label=${`${existing?"Edit":"Use and edit"} ${artifact.title}`} @click=${(event:MouseEvent)=>this.#addPreviousWork("artifact",artifact.id,event)}>${existing?this.i18n.system("Edit input"):this.i18n.system("Use & edit")}</button></article>`;})}${images.map((output)=>{const existing=projection.blocks.some((block)=>block.properties.source_output_id===output.id);const source=projection.documents.find((document)=>document.id===output.documentId);const retained=output.contentRef?this.store.content.get()[output.contentRef]:"";let direction:Record<string,unknown>={};if(retained)try{direction=JSON.parse(retained) as Record<string,unknown>;}catch{/* Fall back to the document-specific result label. */}const title=String(direction.title??`${source?.title??"Project"} · ${outputQualityLabel(output)} image ${output.variant+1}`);return html`<article><div class="context-set-preview"><img src=${output.mediaUrl!} alt=${title} loading="lazy"></div><div><span>${this.i18n.system(outputQualityLabel(output))} image · ${source?.title??this.i18n.system("Project")}</span><h3>${title}</h3><p>${String(direction.rationale??direction.scene??"Reuse the image and customize its creative direction.")}</p></div><button type="button" class="button primary" aria-label=${`${existing?"Edit":"Use and edit"} ${title}`} @click=${(event:MouseEvent)=>this.#addPreviousWork("image",output.id,event)}>${existing?this.i18n.system("Edit input"):this.i18n.system("Use & edit")}</button></article>`;})}</section>`;
  }

  #contextPicker(roots: CreativeBlock[], hasPreviousWork: boolean) {
    const projection = this.store.projection.get();
    const choosing = this.#contextSource === "choose";
    return html`<dialog class="modal context-set-picker-dialog" closedby="any" aria-labelledby="context-set-picker-title"
      @click=${(event: MouseEvent) => { if (event.target === event.currentTarget) this.#closeContextPicker(); }}
      @cancel=${(event: Event) => { event.preventDefault(); this.#closeContextPicker(); }}>
      <section class="context-set-picker-panel">
        <button type="button" class="icon-button modal-close" aria-label="Close reusable context picker" @click=${this.#closeContextPicker}>${icon("close")}</button>
        <header>
          ${!choosing ? html`<button type="button" class="context-entry-back" @click=${() => this.#chooseContextSource("choose")}>${icon("back")} ${this.i18n.system("Add context")}</button>` : nothing}
          <h2 id="context-set-picker-title">${this.i18n.system(choosing ? "Add context" : "Add reusable context")}</h2>
          <p>${this.i18n.system(choosing ? "Add an existing or new creative decision" : "Reuse a creative decision or any previous image, story, scene, presentation, storyboard, or video. Everything remains editable in this document.")}</p>
        </header>
        ${choosing ? html`<section class="context-entry-choices" aria-label=${this.i18n.system("Add context")}>
          <forma-ui-choice-card .label=${this.i18n.system("Add a context block")} .detail=${this.i18n.system("Choose a block type")} icon-name="plus" value="create" @forma-action=${this.#requestContextCreation}></forma-ui-choice-card>
          <forma-ui-choice-card .label=${this.i18n.system("Add from project")} .detail=${this.i18n.system("Reusable context")} icon-name="spark" value="reuse" @forma-action=${() => this.#chooseContextSource("reuse")}></forma-ui-choice-card>
        </section>` : roots.length || hasPreviousWork ? html`<div class="context-set-picker-list">
          ${roots.map((block) => {
            const connected = this.#connectedIds(block.id);
            const connectedBlocks = projection.libraryBlocks.filter((item) => connected.has(item.id));
            const references = connectedBlocks.filter((item) => item.type === "reference");
            return html`<article>
              <div class="context-set-preview">${references.slice(0, 3).map((reference) => html`<forma-reference-image .src=${String(reference.properties.media_url ?? "")} .alt=${String(reference.properties.label ?? reference.handle)} .compact=${true} .targetId=${reference.id} .referenceId=${String(reference.properties.reference_id ?? "")} .focalPoint=${reference.properties.focal_point}></forma-reference-image>`)}${!references.length ? html`<span>${icon(blockIconName(block.type))}</span>` : nothing}</div>
              <div><span>${block.type} · ${connectedBlocks.length === 1 ? this.i18n.system("single block") : this.i18n.system("{count} connected blocks", { count: this.i18n.number(connectedBlocks.length) })}</span><h3>${block.handle}</h3><p>${String(block.properties.artifact_markdown ?? block.properties.text ?? block.properties.label ?? "Reusable creative context")}</p>${references.length ? html`<small>${references.map((reference) => String(reference.properties.label ?? reference.handle)).join(" · ")}</small>` : html`<small>No related reference image</small>`}</div>
              <button type="button" class="button primary" @click=${(event:MouseEvent) => this.#addContextSet(block.id,event)}>${connectedBlocks.length === 1 ? this.i18n.system("Add block") : this.i18n.system("Add context set")}</button>
            </article>`;
          })}
          ${this.#previousWork()}
        </div>` : html`<div class="context-set-picker-empty"><b>No reusable context yet</b><p>Create a reusable decision or generate an image, story, scene, presentation, storyboard, or video.</p><a href="/library/blocks/editor/new" @click=${this.#openEmptyContextLibrary}>Open Block editor ${icon("arrow")}</a></div>`}
      </section>
    </dialog>`;
  }

  override render() {
    const active=(this.getAttribute("active")??"document") as StudioMode;
    const projection = this.store.projection.get();
    const routeFocused = documentFocusFromRoute(this.store.route.get());
    if (routeFocused !== this.#focused) {
      this.#focused = routeFocused;
      try { localStorage.setItem(DOCUMENT_FOCUS_KEY, String(routeFocused)); } catch { /* URL state still works without storage. */ }
      this.#reflectFocus();
    }
    const {roots,hasPreviousWork}=this.#contextPickerSources();const context=this.store.session.get()?.projectContext;const canAuthor=!context||context.permissions.includes("project.author");const visibleModes=canAuthor?modes:modes.filter((mode)=>mode.id==="document");
    const familyOptions=[{id:"write",label:canAuthor?this.i18n.t("studio.family.write","Write"):this.i18n.t("studio.family.read","Read"),path:"/"},...(canAuthor?[{id:"shape",label:this.i18n.t("studio.family.shape","Shape"),path:"/studio/board"}]:[]),{id:"present",label:this.i18n.t("studio.family.present","Present"),path:"/#output-title"}];
    const families=html`<div class="studio-mode-families" role="group" aria-label=${this.i18n.t("studio.family.label","Creative work modes")}>${familyOptions.map((family)=>{const href=withDocumentFocusInRoute(withDocumentInRoute(family.path,projection.documentId,projection.documentTitle),this.#focused);const presenting=this.store.route.get().includes("#output-title");const selected=family.id==="present"&&presenting||family.id==="write"&&!presenting&&["document","guided","chat"].includes(active)||family.id==="shape"&&["board","layers","adaptive","editor"].includes(active);return html`<a class=${`studio-mode-family ${selected?"selected":""}`} href=${href} @click=${(event:MouseEvent)=>this.#go(event,href,family.id==="present")}>${family.label}</a>`;})}</div>`;
    return html`<nav class="studio-mode-nav" aria-label=${this.i18n.t("studio.view.label","Document views")}><span>${this.i18n.t("studio.view.label","Document views")}</span>${families}<div class="studio-mode-links">${this.#viewMenu(visibleModes,active)}</div>${canAuthor?html`<button type="button" class="context-set-trigger" aria-label="Add context" title="Add context" @click=${()=>this.#openContextPicker()}>${icon("plus")}<span class="studio-mode-action-label">Add context</span></button>`:nothing}<button type="button" class="document-focus-toggle" aria-label=${this.#focused ? this.i18n.system("Exit focused document view") : this.i18n.system("Enter focused document view")} aria-pressed=${this.#focused} title=${this.#focused ? this.i18n.system("Restore project navigation and page context") : this.i18n.system("Give this document view the full workspace")} @click=${() => this.#setFocused(!this.#focused)}><span aria-hidden="true">${icon(this.#focused ? "collapse" : "expand")}</span><span class="studio-mode-action-label">${this.#focused ? this.i18n.system("Exit focus") : this.i18n.system("Focus view")}</span></button>${canAuthor&&this.#contextPickerOpen?this.#contextPicker(roots,hasPreviousWork):nothing}</nav>`;
  }
}

export class StudioNavigator extends FormaElement {
  #destination(){return this.getAttribute("destination")||"/";}
  #go(event:MouseEvent,path:string){
    if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    event.preventDefault();if(path===this.store.route.get())return;
    void navigateInApp(this,async navigation=>{
      const opened=await navigation.route(path);
      if(opened&&navigation.current())window.scrollTo({top:0});
      return opened;
    });
  }
  async #chooseCollection(id:string){
    const p=this.store.projection.get();
    if(id&&!p.collections.some(collection=>collection.id===id))return false;
    const ids=new Set(Object.entries(p.membership).filter(([,membership])=>membership.collectionId===id).map(([documentId])=>documentId));
    const first=id&&!ids.has(p.documentId)?p.documents.find(document=>ids.has(document.id)):undefined;
    if(!first){this.store.patchUi({focusCollectionId:id});return true;}
    const destination=this.#destination();
    return navigateInApp(this,navigation=>this.store.openDocument(first.id,destination,undefined,{
      ...navigation,onOriginHandoff:()=>{
        if(!navigation.onOriginHandoff())return false;
        this.store.patchUi({focusCollectionId:id});return true;
      },
    }));
  }
  async #chooseDocument(id:string){
    if(!id)return false;
    const p=this.store.projection.get(),destination=this.#destination(),target=p.documents.find(document=>document.id===id);
    if(target&&id===p.documentId&&withDocumentInRoute(destination,id,target.title)===this.store.route.get())return true;
    return navigateInApp(this,navigation=>this.store.openDocument(id,destination,undefined,navigation));
  }
  override render(){
    const p=this.store.projection.get();const focused=this.store.ui.focusCollectionId;const collection=focused?p.collections.find((item)=>item.id===focused):undefined;
    const documentIds=collection?new Set(Object.entries(p.membership).filter(([,membership])=>membership.collectionId===collection.id).map(([id])=>id)):null;
    const documents=documentIds?p.documents.filter((document)=>documentIds.has(document.id)):p.documents;
    return html`<div class="studio-navigator" aria-label="Current project and document">
      <nav class="studio-breadcrumbs" aria-label="Current location"><a href="/projects" @click=${(event:MouseEvent)=>this.#go(event,"/projects")}>Projects</a><span class="ui-directional-icon" aria-hidden="true">${icon("next")}</span><a href="/studio/project" @click=${(event:MouseEvent)=>this.#go(event,"/studio/project")}>${p.projectName}</a><span class="ui-directional-icon" aria-hidden="true">${icon("next")}</span><strong>${p.documentTitle}</strong></nav>
      <form class="studio-navigation-form" @submit=${(event:SubmitEvent)=>event.preventDefault()}><label><span>Collection scope</span><select .value=${live(focused)} @change=${(event:Event)=>{void this.#chooseCollection((event.target as HTMLSelectElement).value).finally(()=>{if(this.isConnected)this.requestUpdate();});}}><option value="">All collections</option>${p.collections.map((item)=>html`<option value=${item.id}>${item.handle}</option>`)}</select></label></form>
      <form class="studio-navigation-form" @submit=${(event:SubmitEvent)=>event.preventDefault()}><label><span>Open document</span><select .value=${live(documents.some((document)=>document.id===p.documentId)?p.documentId:"")} @change=${(event:Event)=>{void this.#chooseDocument((event.target as HTMLSelectElement).value).finally(()=>{if(this.isConnected)this.requestUpdate();});}}><option value="" disabled>${documents.length?this.i18n.system("Choose a document"):this.i18n.system("No documents filed here")}</option>${documents.map((document)=>html`<option value=${document.id}>${document.title}</option>`)}</select></label></form>
      ${focused?html`<button type="button" class="navigator-clear" @click=${()=>this.store.patchUi({focusCollectionId:""})}>Clear collection scope</button>`:html`<span class="navigator-count">${p.documents.length} document${p.documents.length===1?"":"s"} in project</span>`}
    </div>`;
  }
}

export class DocumentContinuity extends FormaElement {
  #go(event:MouseEvent,path:string){
    if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    event.preventDefault();if(path===this.store.route.get())return;
    void navigateInApp(this,async navigation=>{
      const opened=await navigation.route(path);
      if(opened&&navigation.current())window.scrollTo({top:0});
      return opened;
    });
  }
  override render() {
    const projection = this.store.projection.get();
    const view = (this.getAttribute("view") ?? "board") as Exclude<StudioMode, "document">;
    const active = projection.blocks.filter((block) => Number(block.properties.weight ?? .5) > 0).length;
    const history=generationHistoryItems(projection.outputs);const latest=history[0];
    const generationCount=history.length;const mix=generationHistoryMix(projection.outputs);
    const baselineRoute = withDocumentInRoute("/", projection.documentId, projection.documentTitle);
    return html`<section class="document-continuity" aria-label="Current document represented in this view">
      <div class="document-continuity-title">
        <span class="eyebrow">One document · ${view} lens</span>
        <strong>${projection.documentTitle}</strong>
        <small>${this.i18n.system(lensCopy[view])} ${this.i18n.system("Every saved decision and result is still represented here.")}</small>
      </div>
      <dl>
        <div><dt>Decisions</dt><dd>${projection.blocks.length}</dd></div>
        <div><dt>Guiding now</dt><dd>${active}</dd></div>
        <div><dt>Generations</dt><dd>${generationCount}</dd></div>
        <div><dt>Draft / full</dt><dd>${mix.drafts} / ${mix.full}</dd></div>
        <div><dt>Latest</dt><dd>${latest ? latest.kind==="fan"?this.i18n.system("{label} fan", { label: generationHistoryItemIsDraft(latest) ? this.i18n.system("Draft") : this.i18n.system("Full") }):this.i18n.system(outputQualityLabel(latest.output)) : this.i18n.system("Not generated")}</dd></div>
      </dl>
      <a href=${baselineRoute} @click=${(event: MouseEvent) => this.#go(event,baselineRoute)}>Open baseline ${icon("arrow")}</a>
    </section>`;
  }
}

if (!customElements.get("forma-studio-mode-nav")) customElements.define("forma-studio-mode-nav",StudioModeNav);
if (!customElements.get("forma-studio-navigator")) customElements.define("forma-studio-navigator",StudioNavigator);
if (!customElements.get("forma-document-continuity")) customElements.define("forma-document-continuity", DocumentContinuity);
