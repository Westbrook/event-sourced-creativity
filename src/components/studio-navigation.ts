import { html, nothing } from "lit";
import { FormaElement, icon } from "./forma-element";
import { ensureModalDialog } from "./modal-dialog";
import { documentFocusFromRoute, isDocumentViewRoute, withDocumentFocusInRoute, withDocumentInRoute } from "../model/routes";
import { generationHistoryItemIsDraft, generationHistoryItems, generationHistoryMix, outputQualityLabel, type CreativeBlock } from "../model/events";
import { documentArtifactDefinition } from "../model/document-artifacts";
import { artifactIconName, blockIconName } from "./icon-semantics";
import "./icons-navigation";
import "./design-system/choice-card";
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
  #revealedMode: StudioMode | null = null;
  #focusKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && this.#focused && !document.querySelector("dialog[open]")) this.#setFocused(false);
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
    window.removeEventListener("keydown", this.#focusKeydown);
    document.documentElement.removeAttribute("data-document-focus");
    super.disconnectedCallback();
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

  #revealActiveMode() {
    const scroller = this.querySelector<HTMLElement>(".studio-mode-links");
    const activeLink = scroller?.querySelector<HTMLElement>('a[aria-current="page"]');
    if (!scroller || !activeLink) return;

    const scrollerBounds = scroller.getBoundingClientRect();
    const activeBounds = activeLink.getBoundingClientRect();
    const breathingRoom = 8;
    if (activeBounds.left < scrollerBounds.left + breathingRoom) {
      scroller.scrollLeft += activeBounds.left - scrollerBounds.left - breathingRoom;
    } else if (activeBounds.right > scrollerBounds.right - breathingRoom) {
      scroller.scrollLeft += activeBounds.right - scrollerBounds.right + breathingRoom;
    }
  }

  #reflectFocus() {
    document.documentElement.toggleAttribute("data-document-focus", this.#focused);
  }

  #setFocused(focused: boolean) {
    this.#focused = focused;
    try { localStorage.setItem(DOCUMENT_FOCUS_KEY, String(focused)); } catch { /* Device preference remains session-only. */ }
    this.#reflectFocus();
    this.store.setRoute(withDocumentFocusInRoute(this.store.route.get(), focused), { documentFocus: focused });
    this.requestUpdate();
  }

  #closeContextPicker(){this.querySelector<HTMLDialogElement>(".context-set-picker-dialog")?.close();this.#contextPickerOpen=false;this.#contextSource="choose";this.requestUpdate();}
  #requestContextCreation(){this.#closeContextPicker();this.dispatchEvent(new CustomEvent("forma-context-create",{bubbles:true,composed:true}));}
  #connectedIds(rootId:string){const projection=this.store.projection.get();const ids=new Set([rootId]);let changed=true;while(changed&&ids.size<24){changed=false;for(const relation of projection.libraryBlockRelations)if(ids.has(relation.fromBlockId)&&!ids.has(relation.toBlockId)){ids.add(relation.toBlockId);changed=true;}}return ids;}
  async #addContextSet(rootId:string){const sourceOwner=this.store.captureSourceOwnership();if(!this.store.sourceOwnershipActive(sourceOwner))return;const source=this.store.projection.get().libraryBlocks.find((block)=>block.id===rootId);const result=await this.store.copyLibraryBlockSet(rootId,undefined,"document-view-context-picker");if(result&&!("publication"in result)&&this.store.sourceOwnershipActive(sourceOwner)){this.#closeContextPicker();if(source?.properties.source_artifact_id||source?.properties.source_output_id)await this.store.revealOutputInput(result.rootBlockId);}}
  async #addPreviousWork(kind:"image"|"artifact",id:string){const sourceOwner=this.store.captureSourceOwnership();if(!this.store.sourceOwnershipActive(sourceOwner))return;const destination=this.store.projection.get().documentId;const result=kind==="image"?await this.store.addImageOutputAsContext(id,destination,"document-view-context-picker",{reveal:false}):await this.store.addArtifactAsContext(id,destination,"document-view-context-picker",{reveal:false});if(!this.store.sourceOwnershipActive(sourceOwner)||!result||"publication"in result||!result.rootBlockId)return;this.#closeContextPicker();await this.store.revealOutputInput(result.rootBlockId,destination);}
  #previousWork(){
    const projection=this.store.projection.get();const images=projection.libraryOutputs.filter((output)=>Boolean(output.mediaUrl)&&!output.discarded);const artifacts=projection.libraryArtifacts;if(!images.length&&!artifacts.length)return nothing;
    return html`<section class="context-picker-previous-work" aria-label="Previous generated work"><h3>Previous work</h3><p>Every finished result can become editable context in ${projection.documentTitle}.</p>${artifacts.map((artifact)=>{const existing=projection.blocks.some((block)=>block.properties.source_artifact_id===artifact.id&&!block.properties.source_artifact_item_id);return html`<article><div class="context-set-preview"><span aria-hidden="true">${icon(artifactIconName(artifact.kind))}</span></div><div><span>${this.i18n.system(documentArtifactDefinition(artifact.kind).label)}</span><h3>${artifact.title}</h3><p>${artifact.summary}</p></div><button type="button" class="button primary" aria-label=${`${existing?"Edit":"Use and edit"} ${artifact.title}`} @click=${()=>this.#addPreviousWork("artifact",artifact.id)}>${existing?this.i18n.system("Edit input"):this.i18n.system("Use & edit")}</button></article>`;})}${images.map((output)=>{const existing=projection.blocks.some((block)=>block.properties.source_output_id===output.id);const source=projection.documents.find((document)=>document.id===output.documentId);const retained=output.contentRef?this.store.content.get()[output.contentRef]:"";let direction:Record<string,unknown>={};if(retained)try{direction=JSON.parse(retained) as Record<string,unknown>;}catch{/* Fall back to the document-specific result label. */}const title=String(direction.title??`${source?.title??"Project"} · ${outputQualityLabel(output)} image ${output.variant+1}`);return html`<article><div class="context-set-preview"><img src=${output.mediaUrl!} alt=${title} loading="lazy"></div><div><span>${this.i18n.system(outputQualityLabel(output))} image · ${source?.title??this.i18n.system("Project")}</span><h3>${title}</h3><p>${String(direction.rationale??direction.scene??"Reuse the image and customize its creative direction.")}</p></div><button type="button" class="button primary" aria-label=${`${existing?"Edit":"Use and edit"} ${title}`} @click=${()=>this.#addPreviousWork("image",output.id)}>${existing?this.i18n.system("Edit input"):this.i18n.system("Use & edit")}</button></article>`;})}</section>`;
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
          ${!choosing ? html`<button type="button" class="context-entry-back" @click=${() => { this.#contextSource = "choose"; this.requestUpdate(); }}>${icon("back")} ${this.i18n.system("Add context")}</button>` : nothing}
          <h2 id="context-set-picker-title">${this.i18n.system(choosing ? "Add context" : "Add reusable context")}</h2>
          <p>${this.i18n.system(choosing ? "Add an existing or new creative decision" : "Reuse a creative decision or any previous image, story, scene, presentation, storyboard, or video. Everything remains editable in this document.")}</p>
        </header>
        ${choosing ? html`<section class="context-entry-choices" aria-label=${this.i18n.system("Add context")}>
          <forma-ui-choice-card .label=${this.i18n.system("Add a context block")} .detail=${this.i18n.system("Choose a block type")} icon-name="plus" value="create" @forma-action=${this.#requestContextCreation}></forma-ui-choice-card>
          <forma-ui-choice-card .label=${this.i18n.system("Add from project")} .detail=${this.i18n.system("Reusable context")} icon-name="spark" value="reuse" @forma-action=${() => { this.#contextSource = "reuse"; this.requestUpdate(); }}></forma-ui-choice-card>
        </section>` : roots.length || hasPreviousWork ? html`<div class="context-set-picker-list">
          ${roots.map((block) => {
            const connected = this.#connectedIds(block.id);
            const connectedBlocks = projection.libraryBlocks.filter((item) => connected.has(item.id));
            const references = connectedBlocks.filter((item) => item.type === "reference");
            return html`<article>
              <div class="context-set-preview">${references.slice(0, 3).map((reference) => html`<forma-reference-image .src=${String(reference.properties.media_url ?? "")} .alt=${String(reference.properties.label ?? reference.handle)} .compact=${true} .targetId=${reference.id} .referenceId=${String(reference.properties.reference_id ?? "")} .focalPoint=${reference.properties.focal_point}></forma-reference-image>`)}${!references.length ? html`<span>${icon(blockIconName(block.type))}</span>` : nothing}</div>
              <div><span>${block.type} · ${connectedBlocks.length === 1 ? this.i18n.system("single block") : this.i18n.system("{count} connected blocks", { count: this.i18n.number(connectedBlocks.length) })}</span><h3>${block.handle}</h3><p>${String(block.properties.artifact_markdown ?? block.properties.text ?? block.properties.label ?? "Reusable creative context")}</p>${references.length ? html`<small>${references.map((reference) => String(reference.properties.label ?? reference.handle)).join(" · ")}</small>` : html`<small>No related reference image</small>`}</div>
              <button type="button" class="button primary" @click=${() => this.#addContextSet(block.id)}>${connectedBlocks.length === 1 ? this.i18n.system("Add block") : this.i18n.system("Add context set")}</button>
            </article>`;
          })}
          ${this.#previousWork()}
        </div>` : html`<div class="context-set-picker-empty"><b>No reusable context yet</b><p>Create a reusable decision or generate an image, story, scene, presentation, storyboard, or video.</p><a href="/library/blocks/editor/new" @click=${(event: MouseEvent) => { event.preventDefault(); this.#closeContextPicker(); this.store.setRoute("/library/blocks/editor/new"); }}>Open Block editor ${icon("arrow")}</a></div>`}
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
    const standalone=projection.libraryBlocks.filter((block)=>block.scope==="library");const targeted=new Set(projection.libraryBlockRelations.map((relation)=>relation.toBlockId));const roots=standalone.filter((block)=>block.type!=="reference"||!targeted.has(block.id));const hasPreviousWork=projection.libraryArtifacts.length>0||projection.libraryOutputs.some((output)=>Boolean(output.mediaUrl)&&!output.discarded);const context=this.store.session.get()?.projectContext;const canAuthor=!context||context.permissions.includes("project.author");const visibleModes=canAuthor?modes:modes.filter((mode)=>mode.id==="document");
    const familyOptions=[{id:"write",label:this.i18n.t("studio.family.write","Write"),path:"/"},...(canAuthor?[{id:"shape",label:this.i18n.t("studio.family.shape","Shape"),path:"/studio/board"}]:[]),{id:"present",label:this.i18n.t("studio.family.present","Present"),path:"/#output-title"}];
    const families=html`<div class="studio-mode-families" role="group" aria-label=${this.i18n.t("studio.family.label","Creative work modes")}>${familyOptions.map((family)=>{const href=withDocumentFocusInRoute(withDocumentInRoute(family.path,projection.documentId,projection.documentTitle),this.#focused);const presenting=this.store.route.get().includes("#output-title");const selected=family.id==="present"&&presenting||family.id==="write"&&!presenting&&["document","guided","chat"].includes(active)||family.id==="shape"&&["board","layers","adaptive","editor"].includes(active);return html`<a class=${`studio-mode-family ${selected?"selected":""}`} href=${href} @click=${(event:MouseEvent)=>{event.preventDefault();this.store.setRoute(href);if(family.id==="present")requestAnimationFrame(()=>document.getElementById("output-title")?.scrollIntoView({block:"start",behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"}));}}>${family.label}</a>`;})}</div>`;
    return html`<nav class="studio-mode-nav" aria-label="Document views"><span>Document views</span>${families}<div class="studio-mode-links">${visibleModes.map((mode)=>{const href=withDocumentFocusInRoute(withDocumentInRoute(mode.path,projection.documentId,projection.documentTitle),this.#focused);return html`<a href=${href} class=${active===mode.id?"active":""} aria-current=${active===mode.id?"page":nothing} @click=${(event:MouseEvent)=>{event.preventDefault();this.store.setRoute(href);window.scrollTo({top:0});}}>${this.i18n.system(mode.label)}</a>`;})}</div>${canAuthor?html`<button type="button" class="context-set-trigger" aria-label="Add context" title="Add context" @click=${()=>{this.#contextSource="choose";this.#contextPickerOpen=true;this.requestUpdate();}}>${icon("plus")}<span class="studio-mode-action-label">Add context</span></button>`:nothing}<button type="button" class="document-focus-toggle" aria-label=${this.#focused ? this.i18n.system("Exit focused document view") : this.i18n.system("Enter focused document view")} aria-pressed=${this.#focused} title=${this.#focused ? this.i18n.system("Restore project navigation and page context") : this.i18n.system("Give this document view the full workspace")} @click=${() => this.#setFocused(!this.#focused)}><span aria-hidden="true">${icon(this.#focused ? "collapse" : "expand")}</span><span class="studio-mode-action-label">${this.#focused ? this.i18n.system("Exit focus") : this.i18n.system("Focus view")}</span></button>${canAuthor&&this.#contextPickerOpen?this.#contextPicker(roots,hasPreviousWork):nothing}</nav>`;
  }
}

export class StudioNavigator extends FormaElement {
  #destination(){return this.getAttribute("destination")||"/";}
  #go(event:MouseEvent,path:string){event.preventDefault();this.store.setRoute(path);window.scrollTo({top:0});}
  async #chooseCollection(id:string){this.store.patchUi({focusCollectionId:id});if(!id)return;const p=this.store.projection.get();const ids=new Set(Object.entries(p.membership).filter(([,membership])=>membership.collectionId===id).map(([documentId])=>documentId));if(ids.has(p.documentId))return;const first=p.documents.find((document)=>ids.has(document.id));if(first)await this.store.openDocument(first.id,this.#destination());}
  override render(){
    const p=this.store.projection.get();const focused=this.store.ui.focusCollectionId;const collection=focused?p.collections.find((item)=>item.id===focused):undefined;
    const documentIds=collection?new Set(Object.entries(p.membership).filter(([,membership])=>membership.collectionId===collection.id).map(([id])=>id)):null;
    const documents=documentIds?p.documents.filter((document)=>documentIds.has(document.id)):p.documents;
    return html`<div class="studio-navigator" aria-label="Current project and document">
      <nav class="studio-breadcrumbs" aria-label="Current location"><a href="/projects" @click=${(event:MouseEvent)=>this.#go(event,"/projects")}>Projects</a><span class="ui-directional-icon" aria-hidden="true">${icon("next")}</span><a href="/studio/project" @click=${(event:MouseEvent)=>this.#go(event,"/studio/project")}>${p.projectName}</a><span class="ui-directional-icon" aria-hidden="true">${icon("next")}</span><strong>${p.documentTitle}</strong></nav>
      <form class="studio-navigation-form" @submit=${(event:SubmitEvent)=>event.preventDefault()}><label><span>Collection scope</span><select .value=${focused} @change=${(event:Event)=>{void this.#chooseCollection((event.target as HTMLSelectElement).value);}}><option value="">All collections</option>${p.collections.map((item)=>html`<option value=${item.id}>${item.handle}</option>`)}</select></label></form>
      <form class="studio-navigation-form" @submit=${(event:SubmitEvent)=>event.preventDefault()}><label><span>Open document</span><select .value=${documents.some((document)=>document.id===p.documentId)?p.documentId:""} @change=${(event:Event)=>{const id=(event.target as HTMLSelectElement).value;if(id)void this.store.openDocument(id,this.#destination());}}><option value="" disabled>${documents.length?this.i18n.system("Choose a document"):this.i18n.system("No documents filed here")}</option>${documents.map((document)=>html`<option value=${document.id}>${document.title}</option>`)}</select></label></form>
      ${focused?html`<button type="button" class="navigator-clear" @click=${()=>this.store.patchUi({focusCollectionId:""})}>Clear collection scope</button>`:html`<span class="navigator-count">${p.documents.length} document${p.documents.length===1?"":"s"} in project</span>`}
    </div>`;
  }
}

export class DocumentContinuity extends FormaElement {
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
      <a href=${baselineRoute} @click=${(event: MouseEvent) => { event.preventDefault(); this.store.setRoute(baselineRoute); window.scrollTo({ top: 0 }); }}>Open baseline ${icon("arrow")}</a>
    </section>`;
  }
}

if (!customElements.get("forma-studio-mode-nav")) customElements.define("forma-studio-mode-nav",StudioModeNav);
if (!customElements.get("forma-studio-navigator")) customElements.define("forma-studio-navigator",StudioNavigator);
if (!customElements.get("forma-document-continuity")) customElements.define("forma-document-continuity", DocumentContinuity);
