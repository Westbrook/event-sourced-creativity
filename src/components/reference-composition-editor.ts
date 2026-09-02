import { html, nothing } from "lit";
import type { CreativeBlock } from "../model/events";
import {
  normalizeReferenceComposition, referenceCompositionSources,
  type ReferenceCompositionRecipe,
} from "../model/reference-composition";
import { FormaElement } from "./forma-element";
import { type ReferenceCompositionCapture, type ReferenceCompositor } from "./reference-compositor";
import "./reference-compositor";

type CompositionEditingSession = {
  blockId: string;
  label: string;
  recipe: ReferenceCompositionRecipe | null;
  owned: () => boolean;
  current: () => boolean;
};

/** Reopens a retained scene without replacing its block identity or losing source provenance. */
export class ReferenceCompositionEditor extends FormaElement {
  static properties = {
    block: { attribute: false }, readOnly: { type: Boolean }, surface: { type: String },
  };
  block: CreativeBlock | null = null;
  readOnly = false;
  surface = "document";
  #editing: CompositionEditingSession | null = null;
  #pending: object | null = null;

  #liveBlock() {
    const supplied = this.block;
    if (!supplied) return undefined;
    return this.store.projection.get().libraryBlocks.find(block => block.id === supplied.id
      && block.documentId === supplied.documentId && block.projectId === supplied.projectId
      && block.canvasId === supplied.canvasId && block.scope === supplied.scope
      && block.type === "reference" && !block.removed && Boolean(block.properties.reference_composition));
  }

  #canEdit(block = this.#liveBlock()) {
    const session = this.store.session.get(), permissions = session?.projectContext?.permissions ?? session?.capabilities ?? [];
    return Boolean(block && !this.readOnly && !block.locked && !block.properties.organization_context_package_binding_id
      && this.store.captureAuthorizationScope() && permissions.includes("project.read") && permissions.includes("project.author")
      && (this.surface !== "library" || block.scope === "library"));
  }

  #identity(block: CreativeBlock) {
    return JSON.stringify([block.id, block.projectId, block.documentId, block.canvasId, block.scope, block.type,
      block.handle, block.properties.label, block.properties.reference_id, block.properties.media_url,
      block.properties.source_content_hash, block.properties.reference_composition]);
  }

  #sources(block: CreativeBlock) {
    // A copied scene retains canonical source IDs. Keep those readable same-project sources
    // available alongside the destination document's references so its layers can be refreshed.
    const retained = new Set(normalizeReferenceComposition(block.properties.reference_composition)?.sources.map(source => source.blockId) ?? []);
    const blocks = this.store.projection.get().libraryBlocks.filter(source => source.projectId === block.projectId
      && source.id !== block.id && (source.documentId === block.documentId || retained.has(source.id)));
    return referenceCompositionSources(blocks, this.store.events.get());
  }

  #retire() { this.#editing = null; this.#pending = null; }

  override disconnectedCallback() { this.#retire(); super.disconnectedCallback(); }

  #open() {
    const block = this.#liveBlock();
    if (!this.isConnected || this.#pending || !block || !this.#canEdit(block)) return;
    const store = this.store, source = store.captureSourceOwnership(), route = store.route.get(), surface = this.surface;
    if (!store.sourceOwnershipActive(source)) return;
    const identity = this.#identity(block);
    const editing: CompositionEditingSession = {
      blockId: block.id,
      label: String(block.properties.label ?? block.handle),
      recipe: normalizeReferenceComposition(block.properties.reference_composition),
      owned: () => this.isConnected && this.store === store && this.#editing === editing
        && store.sourceOwnershipActive(source) && store.route.get() === route && this.surface === surface
        && this.#canEdit(),
      current: () => {
        const currentBlock = this.#liveBlock();
        return editing.owned() && Boolean(currentBlock && this.#identity(currentBlock) === identity);
      },
    };
    this.#editing = editing;
    this.requestUpdate();
  }

  #close(event: Event) {
    event.stopPropagation();
    const compositor = this.querySelector<ReferenceCompositor>("forma-reference-compositor");
    if (this.#pending || event.currentTarget !== compositor) return;
    compositor?.closeForOwner();
    this.#retire();
    this.requestUpdate();
  }

  async #save(event: CustomEvent<ReferenceCompositionCapture>) {
    event.stopPropagation();
    const editing = this.#editing;
    if (!editing?.current() || this.#pending
      || event.currentTarget !== this.querySelector("forma-reference-compositor")) return;
    const store = this.store, pending = {};
    this.#pending = pending;
    const current = () => this.#pending === pending && editing.current();
    this.requestUpdate();
    let saved = false;
    try {
      saved = await store.saveReferenceComposition({ ...event.detail, targetBlockId: editing.blockId }, current);
    } catch {
      if (current()) store.toast(this.i18n.t("composition.unavailable"));
    } finally {
      if (this.#pending === pending) {
        this.#pending = null;
        if (saved && this.#editing === editing) {
          if (editing.owned()) this.querySelector<ReferenceCompositor>("forma-reference-compositor")?.closeForOwner();
          this.#editing = null;
        }
        if (this.isConnected) this.requestUpdate();
      }
    }
  }

  override render() {
    if (this.#editing && (!this.#editing.owned() || !this.#pending && !this.#editing.current())) this.#retire();
    const block = this.#liveBlock(), editing = this.#editing;
    if (!block || !this.store.captureAuthorizationScope()) return nothing;
    // The native modal makes its invoker inert while saving. Keep that invoker
    // focusable so dialog.close() can restore it before the pending render ends;
    // #open still refuses duplicate work while #pending is set.
    return html`<button type="button" class="button secondary compact" ?disabled=${!this.#canEdit(block)} @click=${this.#open}>
      ${this.i18n.t("model3d.composition.edit", "Edit reference scene")}
    </button>
    ${!normalizeReferenceComposition(block.properties.reference_composition) ? html`<p role="status">${this.i18n.t("composition.invalid")}</p>` : nothing}
    ${editing ? html`<forma-reference-compositor .recipe=${editing.recipe} .label=${editing.label}
      .sources=${this.#sources(block)} .disabled=${Boolean(this.#pending)}
      @composition-capture=${this.#save} @composition-close=${this.#close}></forma-reference-compositor>` : nothing}`;
  }
}

if (!customElements.get("forma-reference-composition-editor")) customElements.define("forma-reference-composition-editor", ReferenceCompositionEditor);
declare global { interface HTMLElementTagNameMap { "forma-reference-composition-editor": ReferenceCompositionEditor } }
