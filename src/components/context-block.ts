import { html, nothing, type TemplateResult } from "lit";
import { navigateInApp, type CommandDeparture } from "./command-departure";
import { cache } from "lit/directives/cache.js";
import { localizeTemplateResult } from "./design-system/localized-template";
import { keyed } from "lit/directives/keyed.js";
import { repeat } from "lit/directives/repeat.js";
import { contextControlName, suspendContextControls } from "./context-controls";
import { captureOutputNavigationFocus, type OutputNavigationFocusLease } from "./output-navigation-focus";
import "./context-controls.css";
import { FormaElement, icon } from "./forma-element";
import { blockIconName } from "./icon-semantics";
import "./icons-authoring";
import type { CreativeBlock, CreativeBlockRelation, EventInput } from "../model/events";
import { BLOCK_INTENTS, BLOCK_TYPES, blockIntentFor, blockTypeDefinition, suggestedSubtype, type BlockIntent, type BlockKind } from "../model/block-types";
import { COMBINED_CONTEXT_APPLICATION_DEFINITIONS, COMBINED_CONTEXT_ROLE_DEFINITIONS, CONTEXT_CONTAINS_RELATION, combinedContextMemberships, combinedContextRoleForBlockType, contextRelationOrder, isContextCompositionRelation, type CombinedContextApplication, type CombinedContextMembership, type CombinedContextRole } from "../model/combined-context";
import { CHARACTER_FIELD_SECTIONS, characterProfileSummary, characterProfileValue, isCharacterContext, withCharacterProfileField, type CharacterFieldSection } from "../model/character-context";
import { requestDialogText } from "./modal-dialog";
import { documentArtifactDefinition, isDocumentArtifactKind } from "../model/document-artifacts";
import { inferDocumentArtifactKind } from "../model/document-output-intent";
import { outputInputDraft } from "../model/output-authoring";
import "./forma-output-requirements";
import { localizedSourceAnchor } from "../model/source-anchor";
import { referenceMedium, type ReferenceMedium } from "../model/reference-media";
import { renderVideoReel } from "./video-reel";
import { renderAudioPlayer } from "./audio-playback";
import { MAX_AUDIO_UPLOAD_BYTES, normalizeAudioCues, audioPlaybackTiming } from "../model/audio";
import { analyzeAudioLocally } from "../model/audio-browser";
import { normalizeModel3dView, type Model3dCaptureDetail } from "../model/model3d-view";
import "./model3d-viewer";
import "./reference-image";
import "./reference-palette-picker";
import "./reference-findings";
import "./spatial-scope-editor";
import "./reference-pixel-policy";
import "./reference-composition-editor";
import "./image-format-editor";
import "./output-input-editor";
import "./context-intelligence";
import type { MemoryFieldCompletion } from "./memory-field-completion.ts";
import "./memory-field-completion.ts";

type ContextControlFocus = { lease: OutputNavigationFocusLease; current: () => boolean };

export class ContextBlock extends FormaElement {
  static properties = { block: { attribute: false }, surface: { type: String }, readOnly: { type: Boolean, attribute: "read-only" } };
  block!: CreativeBlock;
  surface = "document";
  /** Inspection never grants the containing surface authoring rights. */
  readOnly = false;
  #controlsOpen = false;
  #controlsWereVisible = false;
  #controlsIdentity = "";
  #editingRequest = "";
  #draftActive = false;
  #draftChanged = false;
  #structuredEditor: HTMLElementTagNameMap["forma-output-input-editor"] | null = null;
  #draftInitialized = false;
  #draftRevision = 0;
  #savingDraft: object | null = null;
  #controlFocus: ContextControlFocus | null = null;
  #draft = "";
  #draftComposing=false;
  #imageLabel = "";
  #imagePalette: string[] = [];
  #editingFocused = false;
  #analyzingAudio=false;
  #savingModelView: object | null = null;
  #detailDraft:{parentId:string;label:string;value:string;type:BlockKind}|null=null;
  #reuseParentId="";
  #characterSaving:Promise<void>=Promise.resolve();
  #characterGenerating=false;
  #confirmRemove = false; #paletteOpen = false; #dropPosition: ""|"before"|"after" = "";

  #beginEdit() {
    if (!this.#canEdit() || this.block.locked || this.block.properties.source_evidence_hash) return;
    this.#initializeDraft();
    this.#draftRevision++;
    this.#draftActive = true;
    this.#editingFocused = true;
    this.store.patchUi({ focusBlockId: this.block.id, editingBlockId: this.block.id });
    this.#focusAfterUpdate(() => this.#editorFocusTarget());
  }

  #cancelEdit() { this.#finishEdit(this.#captureControlFocus()); }

  #finishEdit(focus: ContextControlFocus) {
    this.querySelector("forma-output-input-editor")?.reset();
    this.#structuredEditor = null;
    this.#draftComposing=false;
    this.#draftRevision++;
    this.#savingDraft = null;
    if (this.store.ui.editingBlockId === this.block.id) this.store.patchUi({ editingBlockId: "" });
    this.#draftActive = false; this.#draftChanged = false; this.#draftInitialized = false; this.#editingFocused = false;
    this.requestUpdate();
    this.#focusAfterUpdate(() => this.querySelector<HTMLButtonElement>(".block-copy"), focus);
  }

  async #saveEdit() {
    if (this.#savingDraft || !this.isConnected || !this.#draftActive || !this.#canEdit() || this.block.locked || this.block.properties.source_evidence_hash) return;
    const workbench = this.querySelector("forma-output-input-editor");
    const submitted = workbench?.draft ?? null;
    const revision = this.#draftRevision, identity = this.#controlsScope(), route = this.store.route.get();
    const submission = {}, focus = this.#captureControlFocus();
    const current = () => this.#savingDraft === submission && this.#draftRevision === revision
      && this.#draftActive && this.isConnected && this.#controlsScope() === identity && this.store.route.get() === route
      && this.#canEdit() && !this.block.locked && !this.block.properties.source_evidence_hash
      && (!workbench || this.querySelector("forma-output-input-editor") === workbench && JSON.stringify(workbench.draft) === JSON.stringify(submitted));
    let completed = false;
    const complete = () => { if (current()) { completed = true; this.#finishEdit(focus); } };
    this.#savingDraft = submission;
    this.requestUpdate();
    try {
      if (submitted) {
        if (await this.store.saveOutputInput(this.block.id, submitted, `${this.surface}-output-input-editor`)) complete();
        return;
      }
      const previous = String(this.block.properties.text ?? this.block.properties.label ?? "");
      const derived = Boolean(this.block.properties.source_output_id || this.block.properties.source_artifact_item_id);
      const next = derived ? this.#draft : this.#draft.trim();
      const changes = this.store.outputBlockTextEvents(this.block.id, next, `${this.surface}-context-block`);
      if (this.block.properties.source_output_id && this.#imageLabel !== String(this.block.properties.label ?? "")) {
        changes.push({ type: "BlockPropertyEdited", payload: { block_id: this.block.id, property_path: "label", old_value: this.block.properties.label ?? "", new_value: this.#imageLabel, source_surface: `${this.surface}-context-block` } });
        changes.push({ type: "BlockPropertyEdited", payload: { block_id: this.block.id, property_path: "image_caption", old_value: this.block.properties.image_caption ?? "", new_value: this.#imageLabel, source_surface: `${this.surface}-context-block` } });
      }
      if (this.block.properties.source_output_id && JSON.stringify(this.#imagePalette) !== JSON.stringify(this.block.properties.output_palette ?? [])) for (const property of ["output_palette", "palette"]) changes.push({ type: "BlockPropertyEdited", payload: { block_id: this.block.id, property_path: property, old_value: this.block.properties[property] ?? [], new_value: [...this.#imagePalette], source_surface: `${this.surface}-context-block` } });
      if (!changes.length) {
        if (next === previous) complete();
        else this.store.toast("Unlock the parent storyboard input before editing this frame.");
        return;
      }
      const appended = await this.store.appendBatch(changes);
      if (appended.length) complete();
    } finally {
      if (this.#savingDraft === submission) { this.#savingDraft = null; this.requestUpdate(); }
      if (!completed) this.#disposeControlFocus(focus);
    }
  }

  #initializeDraft() {
    if (this.#draftInitialized) return;
    this.#draftInitialized = true;
    this.#draftRevision++;
    this.#draftChanged = false;
    this.#draft = String(this.block.properties.text ?? this.block.properties.label ?? "");
    this.#imageLabel = String(this.block.properties.label ?? "");
    this.#imagePalette = Array.isArray(this.block.properties.output_palette) ? this.block.properties.output_palette.map(String) : [];
  }

  #markDraftChanged() { this.querySelector<MemoryFieldCompletion>("forma-memory-field-completion")?.retire();this.#draftRevision++; this.#draftChanged = true; }

  #markStructuredDraftChanged() { this.#structuredEditor = this.querySelector("forma-output-input-editor"); this.#markDraftChanged(); }

  #structuredDraftDiffers() { const current = outputInputDraft(this.block), editor = this.#structuredEditor; return Boolean(current && editor && editor.block.id === this.block.id && JSON.stringify(editor.draft) !== JSON.stringify(current)); }

  #ordinaryDraftDiffers() { const p = this.block.properties; return this.#draft !== String(p.text ?? p.label ?? "") || this.#imageLabel !== String(p.label ?? "") || JSON.stringify(this.#imagePalette) !== JSON.stringify(Array.isArray(p.output_palette) ? p.output_palette.map(String) : []); }

  #controlsScope() { return JSON.stringify([this.store.captureAuthorizationScope()?.key ?? "", this.block.projectId, this.block.documentId, this.block.id, this.surface, this.readOnly, this.#canEdit(), this.block.properties.source_artifact_id ?? null, this.block.properties.source_artifact_kind ?? null]); }

  /** Content-free custody shared by this view's existing navigation owners. */
  captureCommandDeparture(): CommandDeparture {
    const store = this.store, scope = this.#controlsScope(), revision = this.#draftRevision;
    return {
      element: this,
      current: () => this.isConnected && FormaElement.hasStoreIdentity(this, store)
        && this.#controlsScope() === scope && this.#draftRevision === revision,
      blocked: () => {
        const editor = this.querySelector("forma-output-input-editor") ?? this.#structuredEditor;
        const sameEditor = editor && FormaElement.hasStoreIdentity(editor, this.store)
          && editor.block.projectId === this.block.projectId && editor.block.documentId === this.block.documentId
          && editor.block.id === this.block.id && editor.source === this.surface
          && editor.block.properties.source_artifact_id === this.block.properties.source_artifact_id
          && editor.block.properties.source_artifact_kind === this.block.properties.source_artifact_kind;
        return Boolean(this.#savingDraft || this.#savingModelView
          || this.#draftChanged && (outputInputDraft(this.block) ? this.#structuredDraftDiffers() : this.#ordinaryDraftDiffers())
          || sameEditor && editor?.localWorkBlocked);
      },
      reason: () => "next.lifecycle.currentWorkOpen",
    };
  }

  #disposeControlFocus(focus = this.#controlFocus) {
    focus?.lease.dispose();
    if (this.#controlFocus === focus) this.#controlFocus = null;
  }

  #captureControlFocus(editingRequest?: string): ContextControlFocus {
    this.#disposeControlFocus();
    const identity = this.#controlsScope(), route = this.store.route.get(), selection = this.store.ui.focusBlockId, open = this.#controlsOpen, revision = this.#draftRevision;
    const lease = captureOutputNavigationFocus(this.ownerDocument);
    const focus: ContextControlFocus = { lease, current: () => this.#controlFocus === focus && this.isConnected
      && this.#controlsScope() === identity && this.store.route.get() === route && this.store.ui.focusBlockId === selection
      && this.#controlsOpen === open && (editingRequest === undefined || this.store.ui.editingBlockId === editingRequest && this.#draftRevision === revision) && lease.current() };
    this.#controlFocus = focus;
    return focus;
  }

  #focusAfterUpdate(target: () => HTMLElement | null, focus = this.#captureControlFocus(), reveal = false) {
    void this.updateComplete.then(() => {
      try {
        if (!focus.current() || this.ownerDocument.querySelector("dialog[open]")) return;
        const element = target();
        if (element) focus.lease.run(element, () => {
          if (reveal) {
            element.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
            if (!focus.current() || !element.isConnected || target() !== element || this.ownerDocument.querySelector("dialog[open]")) return false;
          }
          element.focus({ preventScroll: true }); return true;
        });
      } finally { this.#disposeControlFocus(focus); }
    }, () => this.#disposeControlFocus(focus));
  }

  #editorFocusTarget() { return this.querySelector<HTMLTextAreaElement>(".block-editor forma-ui-rich-text textarea") ?? this.querySelector<HTMLTextAreaElement>(".block-editor textarea"); }

  #calmSurface() { return this.surface === "document" || this.surface === "library"; }
  #canEdit() { const session = this.store.session.get(), permissions = session?.projectContext?.permissions ?? session?.capabilities ?? []; return Boolean(this.store.captureAuthorizationScope()) && !this.readOnly && permissions.includes("project.read") && permissions.includes("project.author"); }
  #controlsVisible() { return this.#controlsOpen && this.store.ui.focusBlockId === this.block.id; }
  #selectDecision() { this.store.patchUi({ focusBlockId: this.block.id }); }
  #controlsLabel() { const context = this.store.session.get()?.projectContext; const readOnly = this.readOnly || Boolean(context && !context.permissions.includes("project.author")); return this.i18n.t(readOnly ? "context.controls.inspect" : "context.controls.named", readOnly ? "Inspect {name}" : "Controls for {name}", { name: `\u2068${String(this.block.properties.label ?? this.block.handle)}\u2069` }); }

  protected override willUpdate() {
    if (!this.block) return;
    const identity = this.#controlsScope();
    if (this.#controlsIdentity && identity !== this.#controlsIdentity) {
      suspendContextControls(this);
      this.#draftRevision++; this.#savingDraft = null; this.#structuredEditor = null;
      if (this.store.ui.editingBlockId === this.block.id) this.store.patchUi({ editingBlockId: "" });
      this.#controlsOpen = false; this.#draftActive = false; this.#draftChanged = false; this.#draftInitialized = false; this.#draft = ""; this.#imageLabel = ""; this.#imagePalette = []; this.#editingFocused = false; this.#editingRequest = "";
      this.#detailDraft = null; this.#reuseParentId = ""; this.#confirmRemove = false; this.#paletteOpen = false;
    }
    this.#controlsIdentity = identity;
    const requested = this.store.ui.editingBlockId;
    if (requested === this.block.id && requested !== this.#editingRequest && this.#canEdit()) {
      this.#initializeDraft(); this.#draftRevision++; this.#draftActive = true;
      if (this.#calmSurface()) this.#controlsOpen = true;
    }
    this.#editingRequest = requested;
    if (this.#draftInitialized && !this.#draftChanged && !outputInputDraft(this.block) && this.#ordinaryDraftDiffers()) { this.#draftInitialized = false; this.#initializeDraft(); }
    const visible = !this.#calmSurface() || this.#controlsVisible();
    if (this.#controlsWereVisible && !visible) { suspendContextControls(this); this.#controlsOpen = false; }
    this.#controlsWereVisible = visible;
    if (this.#controlFocus && !this.#controlFocus.current()) this.#disposeControlFocus();
  }

  protected override updated() {
    const currentEditor = this.querySelector("forma-output-input-editor");
    if (currentEditor) {
      if (!this.#draftChanged) {
        const current = outputInputDraft(this.block);
        if (JSON.stringify(currentEditor.draft) !== JSON.stringify(current)) currentEditor.reset();
      }
      // The existing cache may detach this same child when controls close.
      this.#structuredEditor = currentEditor;
    }
    const editing = this.#calmSurface() ? this.#draftActive : this.store.ui.editingBlockId === this.block?.id;
    if (!editing || this.#calmSurface() && !this.#controlsVisible()) { this.#editingFocused = false; return; }
    if (this.#editingFocused) return;
    this.#editingFocused = true;
    this.#initializeDraft();
    if (!this.#calmSurface() && !this.#controlFocus) this.#focusAfterUpdate(() => this.#editorFocusTarget());
  }

  override disconnectedCallback() { this.#disposeControlFocus(); this.#draftRevision++; this.#savingDraft = null; this.#structuredEditor = null; suspendContextControls(this); super.disconnectedCallback(); }

  #closeControls() {
    suspendContextControls(this);
    this.#draftRevision++;
    this.#editingRequest = "";
    if (this.store.ui.editingBlockId === this.block.id) this.store.patchUi({ editingBlockId: "" });
    this.#controlsOpen = false; this.#editingFocused = false; this.requestUpdate();
    this.#focusAfterUpdate(() => this.querySelector<HTMLButtonElement>(".context-controls-toggle"), this.#captureControlFocus(this.store.ui.editingBlockId), this.surface === "document");
  }

  #toggleControls() {
    if (this.#controlsVisible()) { this.#closeControls(); return; }
    this.#controlsOpen = true;
    const editable = this.#canEdit() && !this.block.locked && !this.block.properties.source_evidence_hash;
    if (editable) { this.#initializeDraft(); this.#draftRevision++; this.#draftActive = true; this.#editingFocused = true; }
    this.store.patchUi({ focusBlockId: this.block.id, ...(editable ? { editingBlockId: this.block.id } : {}) });
    this.requestUpdate();
    this.#focusAfterUpdate(() => this.querySelector<HTMLElement>(".context-controls-panel"));
    void this.#recordNativeInspection();
  }

  async #recordNativeInspection() {
    if(this.surface!=="document"||!this.store.ui.instrumentation||this.block.scope!=="document"||this.block.removed
      ||!this.block.sourceEvents.length||this.block.sourceEvents.length>256||this.block.sourceEvents.some(id=>!id||id.startsWith("optimistic:")))return;
    const block={id:this.block.id,projectId:this.block.projectId,documentId:this.block.documentId},sourceIds=[...this.block.sourceEvents],store=this.store,owner=store.captureSourceOwnership(),route=store.route.get();
    // The native inspection receipt certifies block fields, not relationship
    // versions. Structural events still invalidate this full presentation lease.
    // Unknown IDs are retained so the server rejects missing/ambiguous history;
    // only known relationship records are excluded from the field inventory.
    const structural=new Set(store.eventView.get().filter(event=>event.type==='BlockRelationAdded'||event.type==='BlockRelationRemoved').map(event=>event.eventId));
    const fieldSourceIds=sourceIds.filter(id=>!structural.has(id));if(!fieldSourceIds.length)return;
    const current=()=>this.store===store&&this.isConnected&&this.surface==="document"&&this.block.id===block.id&&this.block.documentId===block.documentId&&this.block.projectId===block.projectId&&this.block.scope==="document"&&!this.block.removed&&this.#controlsVisible()&&this.store.ui.instrumentation
      &&this.store.route.get()===route&&this.store.sourceOwnershipActive(owner)&&this.ownerDocument.visibilityState==="visible"
      &&JSON.stringify(this.block.sourceEvents)===JSON.stringify(sourceIds)&&Boolean(this.querySelector<HTMLElement>(".context-controls-panel")?.getClientRects().length);
    try{
      await this.updateComplete;if(!current())return;
      await this.store.hot({type:"BlockInspected",payload:{project_id:block.projectId,document_id:block.documentId,block_id:block.id,
        source_event_ids:fieldSourceIds,source_surface:"document-context-controls"}},{current});
    }catch{/* Optional observation never prevents inspection or retries a possibly committed write. */}
  }

  #controlsKeys(event: KeyboardEvent) {
    if (event.isComposing || event.key !== "Escape" || (event.target as Element | null)?.closest("dialog")) return;
    event.preventDefault(); event.stopPropagation(); this.#closeControls();
  }

  #openPalette() {
    this.#paletteOpen = true; this.requestUpdate();
    void this.updateComplete.then(() => this.querySelector("forma-reference-palette-picker")?.openControls());
  }

  #editorKeys(event: KeyboardEvent) {
    if (event.isComposing) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (this.#calmSurface()) this.#closeControls(); else this.#cancelEdit(); }
    else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); event.stopPropagation(); (event.currentTarget as HTMLFormElement).requestSubmit(); }
  }

  #editor(properties: Record<string, unknown>) {
    const cancelLabel = this.#savingDraft ? this.i18n.t("context.controls.discardLocal", "Discard local edits") : this.i18n.system("Cancel");
    const editHelp = this.#savingDraft
      ? this.i18n.t("context.controls.saveRequestedHelp", "A save was already requested and may still finish. Discarding these local edits does not cancel it.")
      : this.#calmSurface() ? this.i18n.t("context.controls.shortcut", "⌘/Ctrl + Enter to save · Esc to close controls") : this.i18n.system("⌘/Ctrl + Enter to save · Esc to cancel");
    if (outputInputDraft(this.block)) return html`<form class="block-editor output-derived-block-editor" @submit=${(event: SubmitEvent) => { event.preventDefault(); void this.#saveEdit(); }} @keydown=${this.#editorKeys}><forma-output-input-editor .block=${this.block} .source=${this.surface} .shortcutHelp=${this.#calmSurface()?this.i18n.t("context.controls.shortcutHelp","Command or Control plus Enter saves; Escape closes controls and keeps unsaved edits."):""} @output-input-change=${this.#markStructuredDraftChanged}></forma-output-input-editor><div><small>${editHelp}</small><button type="button" class="button ghost" @click=${this.#cancelEdit}>${cancelLabel}</button><button type="submit" class="button primary" ?disabled=${Boolean(this.#savingDraft)}>Save input</button></div></form>`;
    if (properties.source_output_id || properties.source_artifact_item_id) return html`<form class="block-editor output-derived-block-editor" @submit=${(event: SubmitEvent) => { event.preventDefault(); void this.#saveEdit(); }} @keydown=${this.#editorKeys}>${properties.source_output_id ? html`<label>Image title<input .value=${this.#imageLabel} @input=${(event: InputEvent) => { this.#imageLabel = (event.target as HTMLInputElement).value; this.#markDraftChanged(); }}></label>` : nothing}<forma-ui-rich-text .label=${properties.source_artifact_item_id ? properties.source_artifact_kind==="video"?this.i18n.system("Scene {value} direction", { value: String(properties.video_scene_index??properties.narrative_order??"") }):this.i18n.system("Frame {value} shot direction", { value: String(properties.storyboard_frame_index ?? "") }) : this.i18n.system("Image description and creative direction")} .value=${this.#draft} .rows=${5} .help=${this.#calmSurface()?this.i18n.t("context.controls.shortcutHelp","Command or Control plus Enter saves; Escape closes controls and keeps unsaved edits."):this.i18n.system("Command or Control plus Enter saves; Escape cancels.")} @forma-input=${(event: CustomEvent<{ value: string }>) => { this.#draft = event.detail.value; this.#markDraftChanged(); }}></forma-ui-rich-text>${properties.source_output_id&&this.#imagePalette.length?html`<fieldset class="output-input-image-palette"><legend>Creative image palette</legend>${this.#imagePalette.map((color,index)=>html`<label>Palette color ${index+1}<input .value=${color} @input=${(event:InputEvent)=>{this.#imagePalette=this.#imagePalette.map((value,position)=>position===index?(event.target as HTMLInputElement).value:value);this.#markDraftChanged();}}></label>`)}</fieldset>`:nothing}<div><small>${editHelp}</small><button type="button" class="button ghost" @click=${this.#cancelEdit}>${cancelLabel}</button><button type="submit" class="button primary" ?disabled=${Boolean(this.#savingDraft)}>Save input</button></div></form>`;
    return html`<form class="block-editor" @submit=${(event:SubmitEvent)=>{event.preventDefault();void this.#saveEdit();}}><label for=${`block-copy-${this.block.id}`}>Edit ${this.block.type} content</label><textarea id=${`block-copy-${this.block.id}`} rows="3" .value=${this.#draft} placeholder=${String(properties.placeholder??"Describe a direction…")} @compositionstart=${()=>{this.#draftComposing=true;this.querySelector<MemoryFieldCompletion>("forma-memory-field-completion")?.retire();this.requestUpdate();}} @compositionend=${()=>{this.#draftComposing=false;this.requestUpdate();}} @input=${(event:InputEvent)=>{this.#draft=(event.target as HTMLTextAreaElement).value;this.#markDraftChanged();this.requestUpdate();}} @keydown=${(event:KeyboardEvent)=>{if(event.key==="Escape"&&!event.isComposing){event.preventDefault();event.stopPropagation();if(this.#calmSurface())this.#closeControls();else this.#cancelEdit();}else if(event.key==="Enter"&&!event.isComposing&&(event.metaKey||event.ctrlKey)){event.preventDefault();(event.currentTarget as HTMLTextAreaElement).form?.requestSubmit();}}}></textarea><forma-memory-field-completion .block=${this.block} .draft=${this.#draft} .composing=${this.#draftComposing} .disabled=${Boolean(this.#savingDraft)}
      .fieldCurrent=${()=>!this.#draftComposing&&!this.#savingDraft&&this.#canEdit()&&this.#draft===String(this.block.properties.text??'')}
      @forma-memory-field-applied=${(event:CustomEvent<{blockId:string}>)=>{if(event.detail.blockId===this.block.id&&!this.#draftComposing&&!this.#savingDraft)this.#finishEdit(this.#captureControlFocus());}}></forma-memory-field-completion><div><small>${editHelp}</small><button type="button" class="button ghost" @click=${this.#cancelEdit}>${cancelLabel}</button><button type="submit" class="button primary" ?disabled=${Boolean(this.#savingDraft)}>Save</button></div></form>`;
  }
  async #rename() {
    const previous = this.block.handle;
    const next = await requestDialogText({ title: this.i18n.system("Rename this creative decision"), label: this.i18n.system("Name"), value: previous, confirmLabel: this.i18n.system("Save name"), cancelLabel: this.i18n.t("action.cancel", "Cancel") });
    if (next && next !== previous) await this.store.append({ type: "BlockRenamed", payload: { block_id: this.block.id, old_handle: previous, new_handle: next, reason: "user" } });
  }
  #commitOrder(list: CreativeBlock[]) {
    const events = list.map((block,index)=>({type:"BlockPropertyEdited",payload:{block_id:block.id,property_path:"position",old_value:block.position,new_value:`p${String(index).padStart(4,"0")}`}})).filter((event)=>event.payload.old_value!==event.payload.new_value);
    if (events.length) void this.store.appendBatch(events);
  }
  #move(delta: number) {
    const list = [...this.store.projection.get().blocks]; const index = list.findIndex((block) => block.id === this.block.id); const target = index + delta;
    if (target < 0 || target >= list.length) return this.store.toast(delta < 0 ? "This block is already first." : "This block is already last.");
    const [moved] = list.splice(index,1); list.splice(target,0,moved); this.#commitOrder(list);
  }
  #dragStart(event: DragEvent) {
    if (this.block.locked || !event.dataTransfer) return; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/forma-block-id",this.block.id);
  }
  #dragOver(event: DragEvent) {
    if (!event.dataTransfer?.types.includes("text/forma-block-id")) return; event.preventDefault(); event.dataTransfer.dropEffect = "move";
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect(); this.#dropPosition = event.clientY < rect.top + rect.height / 2 ? "before" : "after"; this.requestUpdate();
  }
  #drop(event: DragEvent) {
    event.preventDefault(); const sourceId = event.dataTransfer?.getData("text/forma-block-id"); const position = this.#dropPosition || "before"; this.#dropPosition = "";
    if (!sourceId || sourceId === this.block.id) { this.requestUpdate(); return; }
    const list = [...this.store.projection.get().blocks]; const sourceIndex = list.findIndex((block)=>block.id===sourceId); if (sourceIndex < 0) return;
    const [moved] = list.splice(sourceIndex,1); const targetIndex = list.findIndex((block)=>block.id===this.block.id); list.splice(position==="after"?targetIndex+1:targetIndex,0,moved); this.#commitOrder(list); this.requestUpdate();
  }
  #changeColor(index: number, value: string) {
    const colors = Array.isArray(this.block.properties.colors) ? [...this.block.properties.colors] as string[] : [];
    const old = [...colors]; colors[index] = value;
    void this.store.append({ type: "ChipEdited", payload: { chip_id: `chip-${this.block.id}-${index}`, block_id: this.block.id, property: "colors", old_value: old, new_value: colors } });
  }
  #weight(value: number) { void this.store.append({ type: "BlockWeightSet", payload: { block_id: this.block.id, weight: value, previous_weight: Number(this.block.properties.weight ?? .5) } }); }
  #changeSubtype(value:string) { const oldValue=String(this.block.properties.subtype??"");if(value!==oldValue){const events:EventInput[]=[{type:"BlockPropertyEdited",payload:{block_id:this.block.id,property_path:"subtype",old_value:oldValue,new_value:value,source_surface:"context-block"}}];if(this.block.type==="audio")events.push({type:"BlockPropertyEdited",payload:{block_id:this.block.id,property_path:"audio_role",old_value:String(this.block.properties.audio_role??"score"),new_value:value.toLowerCase().replace(/\s+/g,"_"),source_surface:"context-block"}});if(this.block.type==="subject"&&["Character headshot","Character sheet"].includes(value)){if(this.block.properties.character_context!==true)events.push({type:"BlockPropertyEdited",payload:{block_id:this.block.id,property_path:"character_context",old_value:this.block.properties.character_context??null,new_value:true,source_surface:"character-context"}});if(!this.block.properties.context_group){const name=String(this.block.properties.label??this.block.properties.text??this.block.handle);events.push({type:"BlockPropertyEdited",payload:{block_id:this.block.id,property_path:"context_group",old_value:null,new_value:{name,target:name,role:"character",application:"isolate",relativity:.9},source_surface:"character-context"}});}}void this.store.appendBatch(events);} }
  #audioField(path:string,value:unknown){if(this.block.locked)return;const previous=this.block.properties[path];if(JSON.stringify(previous??null)===JSON.stringify(value??null))return;void this.store.append({type:"BlockPropertyEdited",payload:{block_id:this.block.id,property_path:path,old_value:previous??null,new_value:value,source_surface:`${this.surface}-audio-context`}});}
  #audioCue(index:number,patch:Record<string,unknown>|null){
    if(this.block.locked)return;
    const existing=normalizeAudioCues(this.block.properties.audio_cues).map((cue)=>({start_seconds:cue.startSeconds,end_seconds:cue.endSeconds,target_kind:cue.targetKind,target_id:cue.targetId,label:cue.label,emotional_intent:cue.emotionalIntent}));
    if(patch===null){existing.splice(index,1);this.#audioField("audio_cues",existing);return;}
    if(index>=existing.length)existing.push({start_seconds:existing.at(-1)?.end_seconds??(existing.at(-1)?.start_seconds??-1)+1,end_seconds:null,target_kind:"moment",target_id:"",label:"",emotional_intent:""});
    const current=existing[index];if(!current)return;
    const next={...current,...patch};
    if(typeof next.start_seconds!=="number"||!Number.isFinite(next.start_seconds)||next.start_seconds<0||next.end_seconds!==null&&(typeof next.end_seconds!=="number"||!Number.isFinite(next.end_seconds)||next.end_seconds<=next.start_seconds))return;
    existing[index]=next;this.#audioField("audio_cues",existing);
  }
  async #analyzeAudio(){
    const url=String(this.block.properties.media_url??"");if(this.#analyzingAudio||this.block.locked||!url.startsWith("/api/media/"))return;
    this.#analyzingAudio=true;this.requestUpdate();
    try{
      const authorization=this.store.captureAuthorizationScope();if(!authorization)return;
      const response=await this.store.guardedFetch(url,{credentials:"same-origin"},"analyze this private recording locally");
      if(!response.ok||!String(response.headers.get("content-type")??"").toLowerCase().startsWith("audio/")||!this.store.authorizationScopeActive(authorization))throw new Error("local_audio_unavailable");
      const bytes=await response.arrayBuffer();if(!bytes.byteLength||bytes.byteLength>MAX_AUDIO_UPLOAD_BYTES||!this.store.authorizationScopeActive(authorization))throw new Error("local_audio_size_invalid");
      const analysis=await analyzeAudioLocally(bytes);if(!this.store.authorizationScopeActive(authorization))return;
      const changes:Array<{type:string;payload:Record<string,unknown>}>=[];
      const set=(path:string,value:unknown)=>{const previous=this.block.properties[path];if(JSON.stringify(previous??null)!==JSON.stringify(value??null))changes.push({type:"BlockPropertyEdited",payload:{block_id:this.block.id,property_path:path,old_value:previous??null,new_value:value,source_surface:`${this.surface}-local-audio-analysis`}});};
      set("analysis_summary",analysis.description);
      set("analysis_provenance",{method:"browser-local-web-audio",source_content_hash:String(this.block.properties.source_content_hash??""),analyzed_at:new Date().toISOString(),analyzed_duration_seconds:analysis.analyzedDurationSeconds,rms:analysis.rms,peak:analysis.peak});
      if(!String(this.block.properties.description??"").trim())set("description",analysis.description);
      if(!this.block.properties.tempo_bpm&&analysis.estimatedTempoBpm)set("tempo_bpm",analysis.estimatedTempoBpm);
      if(!normalizeAudioCues(this.block.properties.audio_cues).length&&analysis.quietRegions.length)set("audio_cues",analysis.quietRegions.slice(0,8).map((region)=>({start_seconds:region.startSeconds,end_seconds:region.endSeconds,target_kind:"moment",target_id:"",label:"Quiet passage",emotional_intent:""})));
      if(changes.length)await this.store.appendBatch(changes);
    }catch{this.store.toast(this.i18n.t("audio.analysis.failed","This browser could not safely analyze the recording. You can still add listening notes manually."));}
    finally{this.#analyzingAudio=false;this.requestUpdate();}
  }
  #audioContext(properties:Record<string,unknown>,readOnly=false){if(this.block.type!=="audio")return nothing;const label=String(properties.label??this.block.handle);return html`<section class="context-audio" aria-label=${this.i18n.t("audio.reference.private","Private audio reference")}>
    ${renderAudioPlayer(String(properties.media_url??""),label,this.i18n,{transcript:String(properties.transcript??properties.lyrics??"")})}
    ${(() => { const timing=audioPlaybackTiming(properties,String(properties.media_url??"")); return timing?html`<p class="context-audio-duration">${this.i18n.t(`audio.duration.${timing.basis}`,"",{seconds:this.i18n.number(timing.seconds)})}</p>`:nothing; })()}
    ${readOnly?nothing:html`${properties.media_url?html`<section class="context-audio-analysis"><button type="button" class="button secondary compact" ?disabled=${this.block.locked||this.#analyzingAudio} aria-describedby=${`audio-analysis-hint-${this.block.id}`} @click=${()=>void this.#analyzeAudio()}>${this.#analyzingAudio?this.i18n.t("audio.analysis.running","Analyzing locally…"):this.i18n.t("audio.analysis.action","Analyze on this device")}</button><small id=${`audio-analysis-hint-${this.block.id}`}>${this.i18n.t("audio.analysis.detail","Measures loudness, quiet passages, pulse, and dynamics in your browser. No provider receives the recording; speech and instruments are not identified.")}</small></section>`:nothing}<div class="context-audio-notes"><label><span>${this.i18n.t("audio.reference.description","Describe what you hear")}</span><textarea rows="2" ?disabled=${this.block.locked} .value=${String(properties.description??"")} @change=${(event:Event)=>this.#audioField("description",(event.currentTarget as HTMLTextAreaElement).value.trim())}></textarea></label><label><span>${this.i18n.t("audio.reference.mood","Mood and emotional arc")}</span><input ?disabled=${this.block.locked} .value=${String(properties.mood??"")} @change=${(event:Event)=>this.#audioField("mood",(event.currentTarget as HTMLInputElement).value.trim())}></label><label><span>${this.i18n.t("audio.reference.arc","Emotional progression")}</span><input ?disabled=${this.block.locked} .value=${String(properties.emotional_arc??"")} @change=${(event:Event)=>this.#audioField("emotional_arc",(event.currentTarget as HTMLInputElement).value.trim())}></label><label><span>${this.i18n.t("audio.reference.purpose","Narrative purpose")}</span><input ?disabled=${this.block.locked} .value=${String(properties.narrative_purpose??"")} @change=${(event:Event)=>this.#audioField("narrative_purpose",(event.currentTarget as HTMLInputElement).value.trim())}></label><label><span>${this.i18n.t("audio.reference.instruments","Instruments and texture")}</span><input ?disabled=${this.block.locked} .value=${Array.isArray(properties.instrumentation)?properties.instrumentation.join(", "):String(properties.instrumentation??"")} @change=${(event:Event)=>this.#audioField("instrumentation",(event.currentTarget as HTMLInputElement).value.split(",").map((value)=>value.trim()).filter(Boolean))}></label><label><span>${this.i18n.t("audio.reference.tempo","Tempo in BPM")}</span><input type="number" min="1" max="400" ?disabled=${this.block.locked} .value=${properties.tempo_bpm?String(properties.tempo_bpm):""} @change=${(event:Event)=>this.#audioField("tempo_bpm",(event.currentTarget as HTMLInputElement).value?Number((event.currentTarget as HTMLInputElement).value):null)}></label><label><span>${this.i18n.t("audio.reference.vocals","Voice and vocals")}</span><select ?disabled=${this.block.locked} .value=${String(properties.vocal_policy??"unspecified")} @change=${(event:Event)=>this.#audioField("vocal_policy",(event.currentTarget as HTMLSelectElement).value)}><option value="unspecified" ?selected=${!properties.vocal_policy||properties.vocal_policy==="unspecified"}>${this.i18n.t("audio.reference.vocals.unspecified","No preference")}</option><option value="instrumental" ?selected=${properties.vocal_policy==="instrumental"}>${this.i18n.t("audio.reference.vocals.instrumental","Instrumental only")}</option><option value="vocals" ?selected=${properties.vocal_policy==="vocals"}>${this.i18n.t("audio.reference.vocals.allowed","Original vocals allowed")}</option></select></label><label><span>${this.i18n.t("audio.reference.transcript","Transcript or listening notes")}</span><textarea rows="2" ?disabled=${this.block.locked} .value=${String(properties.transcript??"")} @change=${(event:Event)=>this.#audioField("transcript",(event.currentTarget as HTMLTextAreaElement).value.trim())}></textarea></label></div>
      <fieldset class="context-audio-cue-editor" ?disabled=${this.block.locked}><legend>${this.i18n.t("audio.generation.cues","Musical cue sheet")}</legend>${normalizeAudioCues(properties.audio_cues).map((cue,index)=>html`<div class="context-audio-cue"><label><span>${this.i18n.t("audio.cues.start","Start in seconds")}</span><input type="number" min="0" step="0.1" .value=${String(cue.startSeconds)} @change=${(event:Event)=>this.#audioCue(index,{start_seconds:Number((event.currentTarget as HTMLInputElement).value)})}></label><label><span>${this.i18n.t("audio.cues.end","End in seconds")}</span><input type="number" min=${String(cue.startSeconds)} step="0.1" .value=${cue.endSeconds===null?"":String(cue.endSeconds)} @change=${(event:Event)=>{const field=event.currentTarget as HTMLInputElement,value=field.value?Number(field.value):null;field.setCustomValidity(value!==null&&value<=cue.startSeconds?this.i18n.t("audio.cues.end","End in seconds"):"");if(field.reportValidity())this.#audioCue(index,{end_seconds:value});}}></label><label><span>${this.i18n.t("audio.cues.target","Target")}</span><select .value=${cue.targetKind} @change=${(event:Event)=>this.#audioCue(index,{target_kind:(event.currentTarget as HTMLSelectElement).value})}>${(["moment","scene","slide","frame","chapter"] as const).map((kind)=>html`<option value=${kind}>${this.i18n.t(`audio.target.${kind}`,kind)}</option>`)}</select></label><label><span>${this.i18n.t("audio.cues.targetName","Target name or number")}</span><input .value=${cue.targetId} @change=${(event:Event)=>this.#audioCue(index,{target_id:(event.currentTarget as HTMLInputElement).value.trim()})}></label><label><span>${this.i18n.t("audio.cues.label","Cue label")}</span><input .value=${cue.label} @change=${(event:Event)=>this.#audioCue(index,{label:(event.currentTarget as HTMLInputElement).value.trim()})}></label><label><span>${this.i18n.t("audio.cues.intent","Emotional intention")}</span><input .value=${cue.emotionalIntent} @change=${(event:Event)=>this.#audioCue(index,{emotional_intent:(event.currentTarget as HTMLInputElement).value.trim()})}></label><button type="button" class="button ghost compact" aria-label=${this.i18n.t("audio.cues.remove","Remove cue {number}",{number:this.i18n.number(index+1)})} @click=${()=>this.#audioCue(index,null)}>${icon("trash")}</button></div>`)}<button type="button" class="button secondary compact" @click=${()=>this.#audioCue(normalizeAudioCues(properties.audio_cues).length,{})}>${this.i18n.t("audio.cues.add","Add a musical cue")}</button></fieldset>
      <fieldset class="audio-permissions" ?disabled=${this.block.locked}><legend>${this.i18n.t("artifact.audio.label","Audio")}</legend>${([{"path":"inform_generation","key":"inform"},{"path":"include_in_output","key":"include"},{"path":"allow_provider_audio_transfer","key":"transfer"}] as const).map(({path,key})=>{const hint=`audio-hint-${this.block.id}-${key}`;return html`<label class="audio-permission"><input type="checkbox" aria-describedby=${hint} .checked=${properties[path]===true} @change=${(event:Event)=>this.#audioField(path,(event.currentTarget as HTMLInputElement).checked)}><span><b>${this.i18n.t(`audio.use.${key}.label`,"")}</b><small id=${hint}>${this.i18n.t(`audio.use.${key}.description`,"")}</small></span></label>`;})}</fieldset>`}
  </section>`;}

  #contextChildren(parentId:string){
    const projection=this.store.projection.get(),blocks=new Map(projection.libraryBlocks.map((block)=>[block.id,block]));
    return projection.libraryBlockRelations.filter((relation)=>isContextCompositionRelation(relation.kind)&&relation.fromBlockId===parentId)
      .map((relation)=>({relation,block:blocks.get(relation.toBlockId)}))
      .filter((item):item is {relation:CreativeBlockRelation;block:CreativeBlock}=>Boolean(item.block))
      .sort((left,right)=>contextRelationOrder(left.relation.properties)-contextRelationOrder(right.relation.properties)||left.block.position.localeCompare(right.block.position));
  }

  #contextDescendants(rootId:string){
    const visited=new Set<string>(),pending=[rootId];
    while(pending.length){const id=pending.pop()!;if(visited.has(id))continue;visited.add(id);for(const{block}of this.#contextChildren(id))pending.push(block.id);}
    return visited;
  }

  #contextGroupEvents(parent:CreativeBlock):EventInput[]{
    if(parent.properties.context_group)return[];
    const name=String(parent.properties.label??parent.properties.text??parent.handle).trim()||parent.handle;
    return[{type:"BlockPropertyEdited",payload:{block_id:parent.id,property_path:"context_group",old_value:null,new_value:{name,target:name,role:combinedContextRoleForBlockType(parent.type),application:"isolate",relativity:Math.max(.5,Number(parent.properties.weight??.8))},source_surface:`${this.surface}-context-composition`}}];
  }

  #contextRelation(parent:CreativeBlock,childId:string,label:string,order=this.#contextChildren(parent.id).length):EventInput{
    return{type:"BlockRelationAdded",payload:{relation_id:crypto.randomUUID(),project_id:parent.projectId,document_id:parent.documentId,from_block_id:parent.id,to_block_id:childId,kind:CONTEXT_CONTAINS_RELATION,properties:{member_order:order,relation_label:label,relativity:1},source_surface:`${this.surface}-context-composition`}};
  }

  #beginDetail(parent:CreativeBlock){
    if(parent.locked||this.block.locked)return;
    this.#reuseParentId="";this.#detailDraft={parentId:parent.id,label:"",value:"",type:parent.type==="reference"?"direction":blockTypeDefinition(parent.type)?.type??"direction"};this.requestUpdate();
  }

  async #addDetail(event:SubmitEvent,parent:CreativeBlock){
    event.preventDefault();const draft=this.#detailDraft;if(!draft||draft.parentId!==parent.id||parent.locked)return;
    const label=draft.label.trim(),value=draft.value.trim();if(!label&&!value)return;
    const id=crypto.randomUUID(),name=label||value,slug=name.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"").slice(0,36)||`detail-${id.slice(0,8)}`;
    const events=[...this.#contextGroupEvents(parent),{type:"BlockCreated",payload:{block_id:id,project_id:parent.projectId,document_id:parent.documentId,type:draft.type,handle:`${draft.type}/${slug}`,position:`z${String(this.store.head.get()+1).padStart(8,"0")}`,properties:{label:name,text:value||name,subtype:suggestedSubtype(draft.type),intent:"include",weight:.8,authority:"authored",context_detail:true},source_surface:`${this.surface}-context-composition`}},this.#contextRelation(parent,id,name)];
    if((await this.store.appendBatch(events,{rebaseAttempts:6})).length){this.#detailDraft=null;this.requestUpdate();}
  }

  #availableContext(parent:CreativeBlock){
    const current=new Set(this.#contextChildren(parent.id).map(({block})=>block.id));
    return this.store.projection.get().blocks.filter((block)=>block.id!==parent.id&&!block.locked&&!block.properties.organization_context_package_binding_id&&!current.has(block.id)&&!this.#contextDescendants(block.id).has(parent.id));
  }

  async #reuseContext(parent:CreativeBlock,id:string){
    const candidate=this.#availableContext(parent).find((block)=>block.id===id);if(!candidate||parent.locked)return;
    const label=String(candidate.properties.label??candidate.properties.text??candidate.handle);
    if((await this.store.appendBatch([...this.#contextGroupEvents(parent),this.#contextRelation(parent,candidate.id,label)],{rebaseAttempts:6})).length){this.#reuseParentId="";this.requestUpdate();}
  }

  async #detachContext(parent:CreativeBlock,child:CreativeBlock,relation:CreativeBlockRelation){
    if(parent.locked||child.locked||this.block.locked)return;
    await this.store.append({type:"BlockRelationRemoved",payload:{relation_id:relation.id,project_id:parent.projectId,document_id:parent.documentId,from_block_id:parent.id,to_block_id:child.id,source_surface:`${this.surface}-context-composition`}},{rebaseAttempts:6});
  }

  async #moveContext(parent:CreativeBlock,index:number,delta:number){
    const children=this.#contextChildren(parent.id),other=index+delta;if(parent.locked||other<0||other>=children.length)return;
    const first=children[index],second=children[other];if(!first||!second||first.block.locked||second.block.locked)return;
    const shared={project_id:parent.projectId,document_id:parent.documentId,source_surface:`${this.surface}-context-composition`};
    const remove=(relation:CreativeBlockRelation):EventInput=>({type:"BlockRelationRemoved",payload:{...shared,relation_id:relation.id,from_block_id:relation.fromBlockId,to_block_id:relation.toBlockId}});
    const restore=(item:{block:CreativeBlock;relation:CreativeBlockRelation},order:number):EventInput=>({type:"BlockRelationAdded",payload:{...shared,relation_id:crypto.randomUUID(),from_block_id:parent.id,to_block_id:item.block.id,kind:CONTEXT_CONTAINS_RELATION,properties:{...item.relation.properties,member_order:order}}});
    await this.store.appendBatch([remove(first.relation),remove(second.relation),restore(first,contextRelationOrder(second.relation.properties,other)),restore(second,contextRelationOrder(first.relation.properties,index))],{rebaseAttempts:6});
  }

  #saveContextValue(block:CreativeBlock,value:string){
    if(block.locked||this.block.locked)return;
    const section=String(block.properties.character_trait_section??""),field=String(block.properties.character_trait_key??"");
    if(section&&field){this.#characterField(section,field,value);return;}
    const previous=String(block.properties.text??"");if(previous===value.trim())return;
    void this.store.append({type:"BlockPropertyEdited",payload:{block_id:block.id,property_path:"text",old_value:previous,new_value:value.trim(),source_surface:`${this.surface}-context-composition`}});
  }

  #groupSetting(key:"name"|"target"|"role"|"application",value:string){
    if(this.block.locked)return;
    const previous=this.block.properties.context_group&&typeof this.block.properties.context_group==="object"?this.block.properties.context_group as Record<string,unknown>:{};
    if(previous[key]===value)return;
    void this.store.append({type:"BlockPropertyEdited",payload:{block_id:this.block.id,property_path:"context_group",old_value:previous,new_value:{...previous,[key]:value},source_surface:`${this.surface}-context-composition`}});
  }

  #detailComposer(parent:CreativeBlock):TemplateResult|typeof nothing{
    const draft=this.#detailDraft;if(!draft||draft.parentId!==parent.id)return nothing;
    const options=BLOCK_TYPES.filter((definition)=>definition.type!=="reference"&&definition.type!=="audio");
    return html`<form class="context-detail-composer" @submit=${(event:SubmitEvent)=>void this.#addDetail(event,parent)}><label><span>${this.i18n.t("context.composition.label")}</span><input required .value=${draft.label} @input=${(event:InputEvent)=>{draft.label=(event.currentTarget as HTMLInputElement).value;}}></label><label><span>${this.i18n.t("context.composition.value")}</span><input .value=${draft.value} @input=${(event:InputEvent)=>{draft.value=(event.currentTarget as HTMLInputElement).value;}}></label><label><span>${this.i18n.system("Kind")}</span><select .value=${draft.type} @change=${(event:Event)=>{draft.type=(event.currentTarget as HTMLSelectElement).value as BlockKind;}}>${options.map((option)=>html`<option value=${option.type}>${this.i18n.system(option.label)}</option>`)}</select></label><footer><button type="button" class="button ghost compact" @click=${()=>{this.#detailDraft=null;this.requestUpdate();}}>${this.i18n.t("action.cancel")}</button><button type="submit" class="button secondary compact">${this.i18n.t("context.composition.add")}</button></footer></form>`;
  }

  #reuseChooser(parent:CreativeBlock):TemplateResult|typeof nothing{
    if(this.#reuseParentId!==parent.id)return nothing;
    const options=this.#availableContext(parent);
    return html`<label class="context-reuse-select"><span>${this.i18n.t("context.composition.choose")}</span><select @change=${(event:Event)=>void this.#reuseContext(parent,(event.currentTarget as HTMLSelectElement).value)}><option value="">${this.i18n.t("field.choose")}</option>${options.map((block)=>html`<option value=${block.id}>${String(block.properties.label??block.properties.text??block.handle)}</option>`)}</select></label>`;
  }

  #contextNode(parent:CreativeBlock,item:{block:CreativeBlock;relation:CreativeBlockRelation},index:number,depth:number,readOnly:boolean,ancestors:Set<string>):TemplateResult{
    const{block,relation}=item,children=this.#contextChildren(block.id),locked=readOnly||this.block.locked||parent.locked||block.locked,label=String(block.properties.label??relation.properties.relation_label??block.handle);
    const value=String(block.properties.character_trait_value??block.properties.text??"");
    const actions=html`<div class="context-tree-node"><div class="context-tree-copy"><label><span>${label}</span>${readOnly?html`<span class="context-tree-value" dir="auto">${value}</span>`:html`<input ?disabled=${locked} .value=${value} @change=${(event:Event)=>this.#saveContextValue(block,(event.currentTarget as HTMLInputElement).value)}>`}</label></div><div class="context-tree-actions"><button type="button" class="icon-button" aria-label=${this.i18n.t("context.composition.inspect")} @click=${()=>this.store.patchUi({inspectorOpen:true,selectedEventId:block.sourceEvents.at(-1)??relation.sourceEvents.at(-1)??""})}>${icon("info")}</button>${readOnly?nothing:html`<button type="button" class="icon-button" aria-label=${this.i18n.t("context.composition.moveUp")} ?disabled=${locked||index===0} @click=${()=>void this.#moveContext(parent,index,-1)}>${icon("up")}</button><button type="button" class="icon-button" aria-label=${this.i18n.t("context.composition.moveDown")} ?disabled=${locked||index>=this.#contextChildren(parent.id).length-1} @click=${()=>void this.#moveContext(parent,index,1)}>${icon("down")}</button><button type="button" class="icon-button" aria-label=${block.locked?this.i18n.system("Unlock block"):this.i18n.system("Lock block")} ?disabled=${this.block.locked||parent.locked} @click=${()=>void this.store.append({type:block.locked?"BlockUnlocked":"BlockLocked",payload:{block_id:block.id,locked_by:"user"}})}>${icon(block.locked?"lock":"unlock")}</button><button type="button" class="button ghost compact" ?disabled=${locked} @click=${()=>void this.#detachContext(parent,block,relation)}>${this.i18n.t("context.composition.detach")}</button>`}</div></div>`;
    const nested=children.length&&!ancestors.has(block.id)?html`<ol role="group" class="context-tree-children">${children.map((child,position)=>this.#contextNode(block,child,position,depth+1,readOnly,new Set([...ancestors,block.id])))}</ol>`:nothing;
    return html`<li role="treeitem" aria-level=${String(depth)} aria-expanded=${children.length?"true":nothing}>${children.length?html`<details class="context-tree-branch" ?open=${this.#calmSurface()||depth<2}><summary><span>${label}</span><small>${this.i18n.t("context.composition.summary","",{count:this.i18n.number(this.#contextDescendants(block.id).size-1)})}</small></summary>${actions}${nested}</details>`:actions}${readOnly?nothing:html`<div class="context-tree-add"><button type="button" class="button ghost compact" ?disabled=${locked} @click=${()=>this.#beginDetail(block)}>${icon("plus")}${this.i18n.t("context.composition.add")}</button><button type="button" class="button ghost compact" ?disabled=${locked} @click=${()=>{this.#detailDraft=null;this.#reuseParentId=this.#reuseParentId===block.id?"":block.id;this.requestUpdate();}}>${this.i18n.t("context.composition.reuse")}</button><forma-context-intelligence .block=${block} .surface=${this.surface} .compact=${true}></forma-context-intelligence></div>${this.#detailComposer(block)}${this.#reuseChooser(block)}`}</li>`;
  }

  #contextComposition(readOnly=false):TemplateResult{
    const children=this.#contextChildren(this.block.id),descendants=this.#contextDescendants(this.block.id).size-1;
    const metadata=this.block.properties.context_group&&typeof this.block.properties.context_group==="object"?this.block.properties.context_group as Record<string,unknown>:{};
    const settings=children.length&&!readOnly?html`<details class="context-composition-settings" ?open=${this.#calmSurface()}><summary>${this.i18n.t("context.composition.groupName")}</summary><div><label><span>${this.i18n.t("context.composition.groupName")}</span><input ?disabled=${this.block.locked} .value=${String(metadata.name??this.block.properties.label??this.block.properties.text??this.block.handle)} @change=${(event:Event)=>this.#groupSetting("name",(event.currentTarget as HTMLInputElement).value.trim())}></label><label><span>${this.i18n.t("context.composition.target")}</span><input ?disabled=${this.block.locked} .value=${String(metadata.target??metadata.name??this.block.handle)} @change=${(event:Event)=>this.#groupSetting("target",(event.currentTarget as HTMLInputElement).value.trim())}></label><label><span>${this.i18n.t("context.composition.role")}</span><select ?disabled=${this.block.locked} .value=${String(metadata.role??combinedContextRoleForBlockType(this.block.type))} @change=${(event:Event)=>this.#groupSetting("role",(event.currentTarget as HTMLSelectElement).value)}>${COMBINED_CONTEXT_ROLE_DEFINITIONS.map((option)=>html`<option value=${option.id}>${this.i18n.system(option.label)}</option>`)}</select></label><label><span>${this.i18n.t("context.composition.behavior")}</span><select ?disabled=${this.block.locked} .value=${String(metadata.application??"isolate")} @change=${(event:Event)=>this.#groupSetting("application",(event.currentTarget as HTMLSelectElement).value)}>${COMBINED_CONTEXT_APPLICATION_DEFINITIONS.map((option)=>html`<option value=${option.id}>${this.i18n.system(option.label)}</option>`)}</select></label></div></details>`:nothing;
    return html`<details class="context-composition" ?open=${this.#calmSurface()||Boolean(children.length||this.#detailDraft?.parentId===this.block.id||this.#reuseParentId===this.block.id)}><summary><span>${icon("branch")}${this.i18n.t("context.composition.heading")}</span><small>${this.i18n.t("context.composition.summary","",{count:this.i18n.number(descendants)})}</small></summary>${children.length?html`<ol role="tree" class="context-tree" aria-label=${this.i18n.t("context.composition.heading")}>${children.map((child,index)=>this.#contextNode(this.block,child,index,1,readOnly,new Set([this.block.id])))}</ol>`:html`<p class="context-composition-empty">${this.i18n.t("context.composition.empty")}</p>`}${settings}${readOnly?nothing:html`<div class="context-composition-actions"><button type="button" class="button secondary compact" ?disabled=${this.block.locked} @click=${()=>this.#beginDetail(this.block)}>${icon("plus")}${this.i18n.t("context.composition.add")}</button><button type="button" class="button ghost compact" ?disabled=${this.block.locked} @click=${()=>{this.#detailDraft=null;this.#reuseParentId=this.#reuseParentId===this.block.id?"":this.block.id;this.requestUpdate();}}>${this.i18n.t("context.composition.reuse")}</button></div>${this.#detailComposer(this.block)}${this.#reuseChooser(this.block)}`}</details>`;
  }

  #characterField(sectionId:string,fieldId:string,value:string){
    this.#characterSaving=this.#characterSaving.then(()=>this.#saveCharacterField(sectionId,fieldId,value)).catch(()=>undefined);
  }

  async #saveCharacterField(sectionId:string,fieldId:string,value:string){
    const projection=this.store.projection.get(),root=projection.blocks.find((block)=>block.id===this.block.id),section=CHARACTER_FIELD_SECTIONS.find((candidate)=>candidate.id===sectionId),definition=section?.fields.find((field)=>field.id===fieldId);
    if(!root||root.locked||!section||!definition)return;
    const next=value.trim(),previous=characterProfileValue(root.properties,sectionId,fieldId);if(previous===next)return;
    const descendants=this.#contextDescendants(root.id),groups=new Map(projection.blocks.filter((block)=>descendants.has(block.id)&&block.properties.character_group_section).map((block)=>[String(block.properties.character_group_section),block]));
    const current=projection.blocks.find((block)=>descendants.has(block.id)&&block.properties.character_trait_section===sectionId&&block.properties.character_trait_key===fieldId);
    if(current?.locked||groups.get(sectionId)?.locked)return;
    const events:EventInput[]=[{type:"BlockPropertyEdited",payload:{block_id:root.id,property_path:"character_profile",old_value:root.properties.character_profile??null,new_value:withCharacterProfileField(root.properties,sectionId,fieldId,next),source_surface:`${this.surface}-character-context`}}];
    if(sectionId==="identity"&&fieldId==="name"&&next){const group=root.properties.context_group&&typeof root.properties.context_group==="object"?root.properties.context_group as Record<string,unknown>:{};events.push({type:"BlockPropertyEdited",payload:{block_id:root.id,property_path:"context_group",old_value:group,new_value:{...group,name:next,target:next,role:"character",application:group.application??"isolate",relativity:group.relativity??.9},source_surface:`${this.surface}-character-context`}});}
    const scheduledGroups=new Map<string,CreativeBlock>();
    const ensureSection=(candidate:CharacterFieldSection):CreativeBlock|null=>{
      const existing=groups.get(candidate.id)??scheduledGroups.get(candidate.id);if(existing)return existing.locked?null:existing;
      const ancestor=candidate.parent?CHARACTER_FIELD_SECTIONS.find((item)=>item.id===candidate.parent):undefined;
      const parent=ancestor?ensureSection(ancestor):root;if(!parent||parent.locked)return null;
      const id=crypto.randomUUID(),label=this.i18n.t(`context.character.section.${candidate.id}`,candidate.label),type:BlockKind=candidate.id==="shot"?"camera":candidate.id==="wardrobe"?"style":candidate.id==="personality"?"emotion":"direction";
      const group:CreativeBlock={id,projectId:root.projectId,documentId:root.documentId,canvasId:"",scope:"document",type,handle:`${type}/${candidate.id}-${id.slice(0,8)}`,position:`z${String(this.store.head.get()+events.length).padStart(8,"0")}`,removed:false,locked:false,properties:{label,text:label,subtype:suggestedSubtype(type),weight:.8,authority:"authored",character_group_section:candidate.id,context_group:{name:label,target:`${String(root.properties.label??root.properties.text??root.handle)} · ${label}`,role:candidate.id==="wardrobe"?"wardrobe":"custom",application:"isolate",relativity:.9}},sourceEvents:[]};
      events.push({type:"BlockCreated",payload:{block_id:id,project_id:root.projectId,document_id:root.documentId,type,handle:group.handle,position:group.position,properties:group.properties,source_surface:`${this.surface}-character-context`}});
      const pendingChildren=events.filter((event)=>event.type==="BlockRelationAdded"&&event.payload.from_block_id===parent.id).length;
      events.push(this.#contextRelation(parent,id,label,this.#contextChildren(parent.id).length+pendingChildren));scheduledGroups.set(candidate.id,group);return group;
    };
    if(current){
      if(next){events.push({type:"BlockPropertyEdited",payload:{block_id:current.id,property_path:"text",old_value:current.properties.text??"",new_value:`${this.i18n.t(`context.character.field.${definition.id}`,definition.label)}: ${next}`,source_surface:`${this.surface}-character-context`}},{type:"BlockPropertyEdited",payload:{block_id:current.id,property_path:"character_trait_value",old_value:current.properties.character_trait_value??previous,new_value:next,source_surface:`${this.surface}-character-context`}});}
      else{const parent=groups.get(sectionId);const relation=parent?this.#contextChildren(parent.id).find((child)=>child.block.id===current.id)?.relation:undefined;if(relation&&parent)events.push({type:"BlockRelationRemoved",payload:{relation_id:relation.id,project_id:root.projectId,document_id:root.documentId,from_block_id:parent.id,to_block_id:current.id,source_surface:`${this.surface}-character-context`}});events.push({type:"BlockRemoved",payload:{block_id:current.id,project_id:root.projectId,document_id:root.documentId,source_surface:`${this.surface}-character-context`}});}
    }else if(next){
      const parent=ensureSection(section);if(!parent)return;
      const id=crypto.randomUUID(),label=this.i18n.t(`context.character.field.${definition.id}`,definition.label),type=parent.type as BlockKind;
      events.push({type:"BlockCreated",payload:{block_id:id,project_id:root.projectId,document_id:root.documentId,type,handle:`${type}/${definition.id}-${id.slice(0,8)}`,position:`z${String(this.store.head.get()+events.length).padStart(8,"0")}`,properties:{label,text:`${label}: ${next}`,subtype:suggestedSubtype(type),weight:.85,authority:"authored",character_trait_section:section.id,character_trait_key:definition.id,character_trait_value:next},source_surface:`${this.surface}-character-context`}});
      const pendingChildren=events.filter((event)=>event.type==="BlockRelationAdded"&&event.payload.from_block_id===parent.id).length;
      events.push(this.#contextRelation(parent,id,label,this.#contextChildren(parent.id).length+pendingChildren));
    }
    await this.store.appendBatch(events,{rebaseAttempts:6});
  }

  #characterReferences(){
    const descendants=this.#contextDescendants(this.block.id);
    return this.store.projection.get().blocks.filter((block)=>descendants.has(block.id)&&block.type==="reference"&&block.properties.context_reference_kind==="character_identity");
  }

  #characterOutputs(){
    const events=this.store.events.get();
    return this.store.projection.get().outputs.filter((output)=>{
      const compiled=events.find((event)=>event.type==="ContextCompiled"&&String(event.payload.generation_id??"")===output.generationId);
      const snapshot=compiled?.payload.compiled_snapshot&&typeof compiled.payload.compiled_snapshot==="object"?compiled.payload.compiled_snapshot as Record<string,unknown>:{};
      const scope=snapshot.context_scope&&typeof snapshot.context_scope==="object"?snapshot.context_scope as Record<string,unknown>:{};
      return String(scope.root_block_id??"")===this.block.id&&Boolean(output.mediaUrl);
    }).slice(0,4);
  }

  async #generateCharacter(kind:"headshot"|"character_sheet"){
    if(this.#characterGenerating)return;
    this.#characterGenerating=true;this.requestUpdate();
    try{await this.store.generateCharacterStudy(this.block.id,kind);}finally{this.#characterGenerating=false;this.requestUpdate();}
  }

  async #characterPixels(reference:CreativeBlock,allowed:boolean){
    if(reference.locked||this.block.locked)return;
    const change=(path:string,value:unknown):EventInput=>({type:"BlockPropertyEdited",payload:{block_id:reference.id,property_path:path,old_value:reference.properties[path]??null,new_value:value,source_surface:`${this.surface}-character-likeness-consent`}});
    const consent=change("likeness_transfer_consent",allowed),mode=change("pixel_reference_mode",allowed?"preserve_subject":"context_only");
    await this.store.appendBatch(allowed?[consent,mode]:[mode,consent],{rebaseAttempts:6});
  }

  #characterContext(properties:Record<string,unknown>,readOnly=false):TemplateResult|typeof nothing{
    if(!isCharacterContext(this.block.type,properties))return nothing;
    const summary=characterProfileSummary(properties),references=this.#characterReferences(),outputs=this.#characterOutputs();
    const session=this.store.session.get(),canGenerate=!readOnly&&Boolean(session?.provider.configured)&&(!session?.projectContext||session.projectContext.permissions.includes("project.output.request"));
    const pendingReviews=canGenerate?(["headshot","character_sheet"] as const).flatMap((kind)=>{
      const requestKey=this.store.characterGenerationRequestKey(this.block.id,kind),readiness=this.store.generationReadiness.get()[requestKey];
      return readiness?.status==="review"&&!this.store.generationRiskAcknowledged(requestKey)?[{kind,readiness,requestKey}]:[];
    }):[];
    return html`
      <section class="character-context" aria-label=${this.i18n.t("context.character.title")}>
        <header>
          <span>${icon("branch")}</span>
          <div><b>${this.i18n.t("context.character.title")}</b><small>${this.i18n.t("context.character.description")}</small></div>
        </header>
        ${summary?html`<p class="character-context-summary" dir="auto">${summary}</p>`:nothing}
        <p class="character-identity-notice">${this.i18n.t("context.character.identityNotice")}</p>
        <div class="character-context-sections">
          ${CHARACTER_FIELD_SECTIONS.map((section,index)=>html`
            <details class="character-context-section" ?open=${this.#calmSurface()||index===0}>
              <summary>
                <span>${this.i18n.t(`context.character.section.${section.id}`,section.label)}</span>
                <small>${this.i18n.number(section.fields.filter((field)=>Boolean(characterProfileValue(properties,section.id,field.id))).length)}</small>
              </summary>
              <fieldset class="character-context-fields" ?disabled=${readOnly||this.block.locked}>
                <legend class="sr-only">${this.i18n.t(`context.character.section.${section.id}`,section.label)}</legend>
                ${section.fields.map((field)=>html`
                  <label>
                    <span>${this.i18n.t(`context.character.field.${field.id}`,field.label)}</span>
                    ${readOnly ? html`<span class="context-tree-value" dir="auto">${characterProfileValue(properties,section.id,field.id)}</span>` : field.multiline
                      ?html`<textarea rows="2" .value=${characterProfileValue(properties,section.id,field.id)} @change=${(event:Event)=>this.#characterField(section.id,field.id,(event.currentTarget as HTMLTextAreaElement).value)}></textarea>`
                      :html`<input .value=${characterProfileValue(properties,section.id,field.id)} @change=${(event:Event)=>this.#characterField(section.id,field.id,(event.currentTarget as HTMLInputElement).value)}>`}
                  </label>
                `)}
              </fieldset>
            </details>
          `)}
        </div>
        <section class="character-reference-stage">
          <header><b>${this.i18n.t("context.character.references")}</b><small>${this.i18n.number(references.length)}</small></header>
          ${references.length?html`
            <ul class="character-reference-list">
              ${references.map((reference)=>{
                const allowed=reference.properties.pixel_reference_mode==="preserve_subject"&&reference.properties.likeness_transfer_consent===true;
                return html`
                  <li>
                    ${reference.properties.media_url?html`<img src=${String(reference.properties.media_url)} alt=${String(reference.properties.label??reference.handle)} loading="lazy">`:nothing}
                    <div>
                      <b>${String(reference.properties.label??reference.handle)}</b>
                      <small>${allowed?this.i18n.t("context.character.pixelsAllowed"):this.i18n.t("context.character.textOnly")}</small>
                      ${readOnly?nothing:html`<button type="button" class="button ghost compact" ?disabled=${reference.locked||this.block.locked} @click=${()=>void this.#characterPixels(reference,!allowed)}>${allowed?this.i18n.t("context.character.revokePixels"):this.i18n.t("context.character.allowPixels")}</button>`}
                    </div>
                  </li>
                `;
              })}
            </ul>
            <p class="character-reference-consent">${this.i18n.t("context.character.consent")}</p>
          `:html`<p>${this.i18n.t("context.character.referencesEmpty")}</p>`}
          ${outputs.length?html`
            <div class="character-generated-portraits">
              ${outputs.map((output)=>html`
                <article>
                  <img src=${String(output.mediaUrl)} alt=${String(properties.label??properties.text??this.block.handle)} loading="lazy">
                  ${readOnly||references.some((reference)=>reference.properties.source_output_id===output.id)?nothing:html`<button type="button" class="button secondary compact" ?disabled=${this.block.locked} @click=${()=>void this.store.addImageOutputAsContext(output.id,this.block.documentId,`${this.surface}-character-reference`,{reveal:false,contextParentBlockId:this.block.id,identityReference:true})}>${this.i18n.t("context.character.useReference")}</button>`}
                </article>
              `)}
            </div>
          `:nothing}
        </section>
        ${canGenerate?html`
          ${pendingReviews.map(({kind,readiness,requestKey})=>html`
            <section class="character-generation-review" role="status">
              <b>${this.i18n.t(kind==="headshot"?"context.character.headshot":"context.character.sheet")}</b>
              <p>${readiness.summary}</p>
              <button type="button" class="button ghost compact" @click=${()=>this.store.acknowledgeGenerationRisk(requestKey)}>${this.i18n.t("context.character.review")}</button>
            </section>
          `)}
          <footer class="character-generation-actions">
            <button type="button" class="button secondary compact" ?disabled=${this.#characterGenerating} @click=${()=>void this.#generateCharacter("headshot")}>${icon("spark")}${this.#characterGenerating?this.i18n.t("context.character.generating"):this.i18n.t("context.character.headshot")}</button>
            <button type="button" class="button ghost compact" ?disabled=${this.#characterGenerating} @click=${()=>void this.#generateCharacter("character_sheet")}>${this.i18n.t("context.character.sheet")}</button>
          </footer>
        `:nothing}
      </section>
    `;
  }

  #changeIntent(value:BlockIntent) { const oldValue=blockIntentFor(this.block.type,this.block.properties);if(value!==oldValue||!this.block.properties.intent)void this.store.append({type:"BlockPropertyEdited",payload:{block_id:this.block.id,property_path:"intent",old_value:oldValue,new_value:value,source_surface:"context-block"}}); }
  #updateCombinedContext(contextSetId:string,patch:Partial<Pick<CombinedContextMembership,"role"|"target"|"application"|"relativity">>){
    const blocks=this.store.projection.get().blocks.filter((block)=>block.documentId===this.block.documentId&&combinedContextMemberships(block.properties).some((membership)=>membership.contextSetId===contextSetId));if(blocks.some((block)=>block.locked||block.properties.organization_context_package_binding_id))return;const events=blocks.map((block)=>{const previous=combinedContextMemberships(block.properties),next=previous.map((membership)=>membership.contextSetId===contextSetId?{...membership,...patch}:membership);return{type:"BlockPropertyEdited",payload:{block_id:block.id,property_path:"combined_context_memberships",old_value:previous,new_value:next,context_set_id:contextSetId,source_surface:"context-block-group-editor"}};});if(events.length)void this.store.appendBatch(events);
  }
  async #remove() { const relatedIds=new Set(this.store.projection.get().libraryBlockRelations.filter((relation)=>relation.kind==="artifact_contains"&&relation.fromBlockId===this.block.id).map((relation)=>relation.toBlockId));const neighbor=[...this.parentElement?.querySelectorAll<HTMLElement>("forma-context-block")??[]].find((element)=>element!==this&&!relatedIds.has(element.querySelector<HTMLElement>("[data-block-id]")?.dataset.blockId??""));const next=neighbor?.querySelector<HTMLElement>("[data-block-id]")??neighbor??document.querySelector<HTMLElement>('.context-set-trigger, [aria-label="Add reusable context"], .add-block');const appended=await this.store.removeOutputBlock({type:"BlockRemoved",payload:{block_id:this.block.id}});if(appended.length){this.#confirmRemove=false;window.requestAnimationFrame(()=>next?.focus());} }

  #sourceEvidence(properties: Record<string,unknown>){
    if(this.block.type!=="reference"||!properties.source_evidence_hash)return nothing;
    const citations=Array.isArray(properties.source_citations)?properties.source_citations.flatMap((item)=>{
      if(!item||typeof item!=="object")return[];
      const citation=item as Record<string,unknown>;
      return typeof citation.anchor==="string"&&typeof citation.excerpt==="string"?[{anchor:citation.anchor,excerpt:citation.excerpt}]:[];
    }):[];
    return html`<details class="source-evidence-inspector" ?open=${this.#calmSurface()}><summary>Verified source evidence · ${citations.length} ${citations.length===1?this.i18n.system("cited section"):this.i18n.system("cited sections")}${properties.source_excerpt_truncated?" " + this.i18n.system("· truncated"):""}</summary>
      <p>${properties.source_excerpt_truncated?this.i18n.system("This source exceeds the supported evidence window; only the listed sections were included."):this.i18n.system("These excerpts and locations were extracted by Forma and verified against the exact uploaded file.")}</p>
      ${properties.extraction_message?html`<p>${this.i18n.system(String(properties.extraction_message))}</p>`:nothing}
      ${citations.length?html`<ol>${citations.map((citation)=>html`<li><b>${localizedSourceAnchor(citation.anchor,(source,values)=>this.i18n.system(source,values),(value)=>this.i18n.number(value))}</b><blockquote>${citation.excerpt}</blockquote></li>`)}</ol>`:nothing}
      ${properties.media_url?html`<a href=${String(properties.media_url)}>Download the verified original source</a>`:nothing}
      <small>SHA-256 ${String(properties.source_content_hash??"")}</small>
    </details>`;
  }

  #referenceSource(properties: Record<string, unknown>, medium: ReferenceMedium | null) {
    if (this.block.type !== "reference" || medium !== "text" && medium !== "document") return nothing;
    const citation = typeof properties.source_citation === "string" ? properties.source_citation.trim() : "";
    const label = medium === "text" ? this.i18n.system("Source text") : this.i18n.t("command.document", "Document");
    return html`<div class="reference-source-kind" role="note">${icon("document")}<b>${label}</b>${citation ? html`<small>${citation}</small>` : nothing}</div>`;
  }

  #fullEditor() {
    if (!this.block) return nothing;
    const p = this.block.properties; const memberships=combinedContextMemberships(p); const definition=blockTypeDefinition(this.block.type); const sourceKind=isDocumentArtifactKind(p.source_artifact_kind)&&!p.source_artifact_item_id?p.source_artifact_kind:null; const readableType=sourceKind?`${this.i18n.system(documentArtifactDefinition(sourceKind).label)} ${this.i18n.system("input")}`:definition?this.i18n.system(definition.label):this.block.type; const subtypes=definition?[...new Set([String(p.subtype??""),...definition.subtypes].filter(Boolean))]:[]; const intent=blockIntentFor(this.block.type,p); const intentLabel=this.i18n.system(BLOCK_INTENTS.find((option)=>option.id===intent)?.label??intent); const authority = String(p.authority ?? "authored"); const confidence = Number(p.confidence ?? 1); const colors = Array.isArray(p.colors) ? p.colors as string[] : []; const dimensions = p.dimensions && typeof p.dimensions === "object" ? p.dimensions as Record<string, unknown> : null; const extractionStatus = String(p.extraction_status ?? "");
    const medium = this.block.type === "reference" ? referenceMedium(p) : null;
    const symbol = this.block.type !== "reference" ? blockIconName(this.block.type) : medium === "image" ? "image" : medium === "audio" ? "audio" : medium === "video" ? "video" : medium === "unknown" ? "info" : "document";
    const formatKind = this.block.type === "format" ? inferDocumentArtifactKind([{ type: "format", properties: p }]) : null;
    const imageFormat = this.block.type === "format" && (formatKind === "storyboard" || !formatKind && Boolean(p.image_format || /\b(?:images?|photo(?:graphs?)?|illustrations?|posters?|visuals?|graphics?|portrait|png|jpe?g|webp|aspect\s*ratio|pixels?|resolution)\b/i.test([p.medium,p.format,p.deliverable,p.label,p.text,p.subtype].filter((value): value is string => typeof value === "string").join(" "))));
    const copy = String(p.artifact_markdown ?? p.text ?? p.source_excerpt ?? p.description ?? p.label ?? ""); const displayCopy = copy || String(p.placeholder ?? "Describe a direction…"); const focused = this.store.ui.focusBlockId === this.block.id; const editing = this.#calmSurface() ? this.#draftActive : this.store.ui.editingBlockId === this.block.id;
    const context=this.store.session.get()?.projectContext;
    const canAuthor=this.#canEdit();
    const governed=context&&p.organization_context_package_binding_id?this.store.organizationContextBindings.get()
      .find((binding)=>binding.id===String(p.organization_context_package_binding_id)&&binding.projectAccessId===context.projectAccessId):undefined;
    const governedPackage=governed?this.store.organizationContextPackages.get().find((item)=>item.id===governed.packageId):undefined;
    const governedVersion=governed?this.store.organizationContextVersions.get()[governed.versionId]:undefined;
    if(!canAuthor||governed)return html`<article class="context-block context-block--read-only intent-${intent} ${focused?"brief-focus":""}" tabindex="0" data-block-id=${this.block.id} aria-label="${readableType}, ${sourceKind?String(p.label??this.block.handle):this.block.handle}, intent ${intentLabel}"><div class="block-rail"><span class="block-rail-code" aria-hidden="true">${icon(symbol)}</span></div><div class="block-body"><header class="block-heading"><div class="block-heading-copy"><h3 class="block-type">${readableType}</h3><span class="handle" dir="auto">${sourceKind?String(p.label??this.block.handle):this.block.handle}</span></div><div class="block-heading-state"><span class=${`block-intent-badge ${intent}`}>${intentLabel}</span><span class="context-lock-state">${this.i18n.t(this.block.locked?"context.controls.locked":"context.controls.unlocked",this.block.locked?"Locked":"Unlocked")}</span></div></header>${governed?html`<p class="block-governed-context"><b dir="auto">${governedPackage?.name??this.i18n.system("Organization context")}</b>${governedVersion?` · v${governedVersion.version}`:""} <button type="button" class="button ghost compact" @click=${()=>navigateInApp(this,navigation=>navigation.route("/library"))}>${this.i18n.system("Organization context")}</button></p>`:nothing}${colors.length?html`<div class="palette-strip" aria-label="Saved palette">${colors.map((color)=>html`<i style=${`--swatch:${color}`}></i>`)}</div>`:nothing}${copy?html`<p class="block-copy" data-forma-content="primary" dir="auto">${displayCopy}</p>`:nothing}${this.#referenceSource(p,medium)}${this.block.type==="reference"&&p.media_url&&medium==="image"?html`<img src=${String(p.media_url)} alt=${String(p.label??this.block.handle)} loading="lazy">`:nothing}${this.#modelContext(p,true)}${this.#audioContext(p,true)}${this.#characterContext(p,true)}${this.#contextComposition(true)}${this.#sourceEvidence(p)}${this.#protectedCopy(p)}<forma-context-intelligence .block=${this.block} .surface=${this.surface} .readOnly=${true}></forma-context-intelligence><div class="block-meta"><span>${Math.round(Number(p.weight??.5)*100)}%</span><span class=${`authority ${authority}`}>${this.i18n.t(`context.authority.${authority}`,this.i18n.system(authority))}</span><button class="why-button" aria-label="Why does this block have these values?" @click=${()=>this.store.patchUi({inspectorOpen:true,selectedEventId:this.block.sourceEvents.at(-1)??""})}>Why?</button></div></div></article>`;
    return html`<article class="context-block intent-${intent} ${focused?"brief-focus":""} ${this.#dropPosition?`drop-${this.#dropPosition}`:""}" tabindex="0" data-block-id=${this.block.id} aria-label="${readableType}, ${sourceKind?String(p.label??this.block.handle):this.block.handle}, intent ${intentLabel}" @dragover=${this.#dragOver} @dragleave=${()=>{this.#dropPosition="";this.requestUpdate();}} @drop=${this.#drop}>
      <div class="block-rail">
        <button class="drag-handle" .draggable=${!this.block.locked} aria-label=${this.block.locked?this.i18n.system("Unlock block to reorder"):this.i18n.system("Drag block to reorder")} title=${this.block.locked?this.i18n.system("Unlock block to reorder"):this.i18n.system("Drag to reorder")} @dragstart=${this.#dragStart} @dragend=${()=>{this.#dropPosition="";this.requestUpdate();}}><span class="block-rail-code" aria-hidden="true">${icon(symbol)}</span><span class="block-drag-dots" aria-hidden="true">${icon("dots")}</span></button>
        <div class="reorder-buttons"><button aria-label="Move block up" @click=${() => this.#move(-1)}>${icon("up")}</button><button aria-label="Move block down" @click=${() => this.#move(1)}>${icon("down")}</button></div>
      </div>
      <div class="block-body">
        <header class="block-heading"><div class="block-heading-copy"><h3 class="block-type">${readableType}</h3><button class="handle" @click=${sourceKind?this.#beginEdit:this.#rename}>${sourceKind?String(p.label??this.block.handle):this.block.handle} ${icon("edit")}</button></div><div class="block-heading-state"><span class=${`block-intent-badge ${intent}`}>${intentLabel}</span><button class="icon-button lock-button" aria-label=${this.block.locked ? this.i18n.system("Unlock block") : this.i18n.system("Lock block")} title=${this.block.locked ? this.i18n.system("Unlock block") : this.i18n.system("Lock block")} @click=${() => this.store.append({ type: this.block.locked ? "BlockUnlocked" : "BlockLocked", payload: { block_id: this.block.id, locked_by: "user" } })}>${icon(this.block.locked ? "lock" : "unlock")}<span class="lock-label">${this.i18n.t(this.block.locked ? "context.controls.locked" : "context.controls.unlocked", this.block.locked ? "Locked" : "Unlocked")}</span></button></div></header>
        ${colors.length && this.block.type === "reference" ? html`<div class="reference-palette"><div class="palette-strip" aria-label="Extracted reference colors">${colors.map(color=>html`<i style=${`--swatch:${color}`}></i>`)}</div><div><span><b>Extracted palette</b><small>Read-only evidence from this reference</small></span><button class="button secondary compact" @click=${this.#openPalette}>Explore palettes</button></div></div>${p.source_output_id||p.source_artifact_item_id?editing?this.#editor(p):html`<button class="block-copy ${copy?"":"placeholder"}" data-forma-content="primary" ?disabled=${this.block.locked} title="Edit reusable image direction" @click=${this.#beginEdit}>${displayCopy}</button>`:nothing}` : colors.length ? html`<form class="palette-row" aria-label="Editable palette" @submit=${(event:SubmitEvent)=>event.preventDefault()}>${colors.map((color, i) => html`<label class="swatch" style="--swatch:${color}" title="Edit swatch ${i+1}"><input type="color" .value=${color} @change=${(e: Event) => this.#changeColor(i, (e.target as HTMLInputElement).value)}><span></span><small>${color}</small></label>`)}</form>` : editing ? this.#editor(p) : html`<button class="block-copy ${copy?"":"placeholder"}" data-forma-content="primary" ?disabled=${this.block.locked} title=${this.block.locked?this.i18n.system("Unlock this block to edit"):sourceKind?this.i18n.system("Edit {value} input", { value: this.i18n.system(documentArtifactDefinition(sourceKind).label).toLocaleLowerCase(this.i18n.locale) }):this.i18n.system("Edit block content")} @click=${this.#beginEdit}>${displayCopy}</button>`}
        <form class="block-classifiers" @submit=${(event:SubmitEvent)=>event.preventDefault()}>
          ${definition?html`<label class="block-subtype"><span>Kind</span><select ?disabled=${this.block.locked} aria-label=${this.i18n.system("{readableType} subtype", { readableType: readableType })} .value=${String(p.subtype??definition.subtypes[0])} @change=${(event:Event)=>this.#changeSubtype((event.target as HTMLSelectElement).value)}>${repeat(subtypes,(subtype)=>subtype,(subtype)=>html`<option value=${subtype} ?selected=${subtype===String(p.subtype??definition?.subtypes[0])}>${this.i18n.system(subtype)}</option>`)}</select></label>`:nothing}
          <label class="block-intent"><span>Use as</span><select ?disabled=${this.block.locked} aria-label=${this.i18n.system("{value} intent", { value: definition?.label??this.block.type })} .value=${intent} @change=${(event:Event)=>this.#changeIntent((event.target as HTMLSelectElement).value as BlockIntent)}>${BLOCK_INTENTS.map((option)=>html`<option value=${option.id} ?selected=${option.id===intent}>${this.i18n.system(option.label)}</option>`)}</select></label>
        </form>
        ${this.#referenceSource(p,medium)}
        ${this.#modelContext(p)}
        ${p.reference_composition ? html`<forma-reference-composition-editor .block=${this.block} .surface=${this.surface}></forma-reference-composition-editor>` : nothing}
        ${this.block.type === "reference"&&medium==="image" ? html`<forma-reference-image .src=${String(p.media_url??"")} .alt=${String(p.label??this.block.handle)} .targetId=${this.block.id} .referenceId=${String(p.reference_id??"")} .focalPoint=${p.focal_point}></forma-reference-image>` : nothing}
        ${this.#audioContext(p)}
        ${this.#characterContext(p)}
        ${sourceKind==="video"&&p.media_url&&!editing?renderVideoReel(outputInputDraft(this.block)?.items??[],String(p.media_url),String(p.label??this.block.handle),this.i18n):nothing}
        ${this.block.type === "reference" && extractionStatus ? html`<div class="extraction-summary" aria-live="polite" aria-busy=${extractionStatus === "pending" ? "true" : "false"}>
          <span>${extractionStatus === "pending" ? this.i18n.system("Extracting deterministic facts…") : extractionStatus === "complete" ? this.i18n.system("Extraction complete") : extractionStatus === "ready" ? p.source_evidence_hash ? this.i18n.system("Source evidence extracted and verified") : this.i18n.t("action.ready", "Ready") : this.i18n.system("Extraction unavailable")}</span>
          ${dimensions&&medium==="image" ? html`<b>${String(dimensions.width)} × ${String(dimensions.height)}</b><b>${String(p.dominant_edges ?? "balanced")} edges</b>` : nothing}
          ${extractionStatus === "complete" ? html`<small>${Math.round(confidence * 100)}% confidence · ${String(p.extractor ?? "deterministic suite")}</small>` : nothing}
        </div>` : nothing}
        ${this.#sourceEvidence(p)}${this.#protectedCopy(p)}
        ${this.block.type === "reference"&&medium==="image" ? html`<forma-reference-findings .block=${this.block} @reference-palette-request=${this.#openPalette}></forma-reference-findings>` : nothing}
        ${this.block.type === "reference"&&medium==="image" ? html`<forma-reference-pixel-policy .block=${this.block} surface=${this.surface}></forma-reference-pixel-policy>` : nothing}
        ${imageFormat ? html`<forma-image-format-editor .block=${this.block} surface=${this.surface}></forma-image-format-editor>` : nothing}
        ${memberships.length?html`<section class="block-combined-contexts" aria-label="Combined context membership"><header><span>Travels with</span><b>${memberships.length} combined context${memberships.length===1?"":"s"}</b></header>${memberships.map((membership)=>html`<form class="block-combined-context" @submit=${(event:SubmitEvent)=>{event.preventDefault();const target=(event.currentTarget as HTMLFormElement).querySelector<HTMLInputElement>('.block-combined-context-target input');if(target&&!this.block.locked)this.#updateCombinedContext(membership.contextSetId,{target:target.value.trim()||membership.name});}}><div class="block-combined-context-heading"><span><b>${membership.name}</b><small>Applies only to ${membership.target}</small></span><em>${membership.memberOrder+1}</em></div><div class="block-combined-context-controls"><label><span>Defines</span><select ?disabled=${this.block.locked} .value=${membership.role} @change=${(event:Event)=>this.#updateCombinedContext(membership.contextSetId,{role:(event.target as HTMLSelectElement).value as CombinedContextRole})}>${COMBINED_CONTEXT_ROLE_DEFINITIONS.map((option)=>html`<option value=${option.id}>${this.i18n.system(option.label)}</option>`)}</select></label><label><span>Behavior</span><select ?disabled=${this.block.locked} .value=${membership.application} @change=${(event:Event)=>this.#updateCombinedContext(membership.contextSetId,{application:(event.target as HTMLSelectElement).value as CombinedContextApplication})}>${COMBINED_CONTEXT_APPLICATION_DEFINITIONS.map((option)=>html`<option value=${option.id}>${this.i18n.system(option.label)}</option>`)}</select></label><label class="block-combined-context-target"><span>Named target</span><input ?disabled=${this.block.locked} .value=${membership.target} @change=${(event:Event)=>this.#updateCombinedContext(membership.contextSetId,{target:(event.target as HTMLInputElement).value.trim()||membership.name})}></label></div><label class="block-relativity"><span>Relativity <small>How tightly this decision stays bound to the group</small></span><input aria-label=${this.i18n.system("{name} relativity", { name: membership.name })} ?disabled=${this.block.locked} type="range" min="0" max="1" step=".05" .value=${String(membership.relativity)} @change=${(event:Event)=>this.#updateCombinedContext(membership.contextSetId,{relativity:Number((event.target as HTMLInputElement).value)})}><output>${Math.round(membership.relativity*100)}%</output></label></form>`)}</section>`:nothing}
        <forma-context-intelligence .block=${this.block} .surface=${this.surface}></forma-context-intelligence>
        ${this.#contextComposition()}
        <forma-spatial-scope-editor .block=${this.block} surface=${this.surface}></forma-spatial-scope-editor>
        <div class="block-meta">
          <form class="block-influence-form" @submit=${(event:SubmitEvent)=>event.preventDefault()}><label><span class="meta-long">Influence</span><span class="meta-short" aria-hidden="true">Inf.</span><input aria-label="Block influence" type="range" min="0" max="1" step="0.05" .value=${String(Number(p.weight ?? .5))} @change=${(e: Event) => this.#weight(Number((e.target as HTMLInputElement).value))}><output>${Math.round(Number(p.weight ?? .5) * 100)}%</output></label></form>
          <span class="authority ${authority}" aria-label=${this.i18n.system("{authority} authority", { authority: authority })} title=${this.i18n.system("{authority} authority", { authority: authority })}><span class="meta-long">${this.i18n.t(`context.authority.${authority}`,this.i18n.system(authority))}</span><span class="meta-short" aria-hidden="true">${authority.slice(0,1).toUpperCase()}</span></span>
          ${confidence < .75 ? html`<span class="confidence low" aria-label=${this.i18n.system("Low confidence, {number} percent", { number: this.i18n.number(Math.round(confidence * 100)) })} title=${this.i18n.system("Low confidence · {percent}%", { percent: this.i18n.number(Math.round(confidence * 100)) })}><span class="meta-long">Low confidence · </span>${Math.round(confidence * 100)}%</span>` : confidence < 1 ? html`<span class="confidence" aria-label=${this.i18n.system("{number} percent confidence", { number: this.i18n.number(Math.round(confidence * 100)) })} title=${this.i18n.system("{percent}% confidence", { percent: this.i18n.number(Math.round(confidence * 100)) })}>${Math.round(confidence * 100)}%<span class="meta-long"> confidence</span></span>` : nothing}
          <button class="why-button" aria-label="Why does this block have these values?" title="Why does this block have these values?" @click=${() => this.store.patchUi({ inspectorOpen: true, selectedEventId: this.block.sourceEvents.at(-1) ?? "" })}><span class="meta-long">Why?</span><span class="meta-short" aria-hidden="true">${icon("info")}</span></button>
          <button class="remove-block" aria-label="Remove block" ?disabled=${this.block.locked} title=${this.block.locked?this.i18n.system("Unlock this block to remove"):this.i18n.system("Remove block")} @click=${()=>{this.#confirmRemove=true;this.requestUpdate();}}><span class="meta-long">Remove</span><span class="meta-short" aria-hidden="true">${icon("close")}</span></button>
        </div>
        ${this.#confirmRemove?html`<div class="block-remove-confirm" role="alert"><span><b>${sourceKind==="storyboard"?((count:number)=>count===1?this.i18n.system("Remove this storyboard and {count} linked frame?",{count:this.i18n.number(count)}):this.i18n.system("Remove this storyboard and {count} linked frames?",{count:this.i18n.number(count)}))(this.store.outputOwnedBlockCount(this.block.id)):this.i18n.system("Remove this block?")}</b><small>${sourceKind==="storyboard"?this.i18n.system("The storyboard and every linked frame disappear together. Undo restores the complete set."):this.i18n.system("It will be tombstoned and can be restored with Undo.")}</small></span><button class="button ghost compact" @click=${()=>{this.#confirmRemove=false;this.requestUpdate();}}>Cancel</button><button class="button danger compact" @click=${this.#remove}>${sourceKind==="storyboard"?this.i18n.system("Remove storyboard"):this.i18n.system("Remove block")}</button></div>`:nothing}
      </div>
      ${this.#paletteOpen?html`<forma-reference-palette-picker .referenceBlockId=${this.block.id} .referenceId=${String(p.reference_id??"")} .mediaUrl=${String(p.media_url??"")} .label=${String(p.label??this.block.handle)} .colors=${colors} .focalPoint=${p.focal_point} @picker-close=${()=>{this.#paletteOpen=false;this.requestUpdate();}}></forma-reference-palette-picker>`:nothing}
    </article>`;
  }

  #protectedCopy(properties: Record<string, unknown>) {
    const exact = typeof properties.exact_text === "string" ? properties.exact_text : "";
    const phrases = Array.isArray(properties.protected_phrases) ? properties.protected_phrases.flatMap((value) => typeof value === "string" ? [value] : value && typeof value === "object" && typeof value.text === "string" ? [value.text] : []) : [];
    if (!exact && !phrases.length) return nothing;
    return html`<section class="context-protected-copy"><b>${this.i18n.t("context.controls.protected", "Protected wording")}</b>${[...new Set([exact, ...phrases].filter(Boolean))].map((phrase) => html`<p dir="auto">${phrase}</p>`)}</section>`;
  }

  async #saveModelView(event: CustomEvent<Model3dCaptureDetail>) {
    event.stopPropagation();
    if (this.#savingModelView || !this.#canEdit() || this.block.locked || this.block.type !== "model3d") return;
    const store = this.store, source = store.captureSourceOwnership(), blockId = this.block.id;
    const route = store.route.get(), modelUrl = String(this.block.properties.model_url ?? ""), modelHash = this.block.properties.model_content_hash;
    const pending = {};
    const current = () => this.isConnected && this.#savingModelView === pending && this.store === store
      && store.sourceOwnershipActive(source) && store.route.get() === route && this.#canEdit()
      && this.block.id === blockId && !this.block.locked && this.block.properties.model_url === modelUrl
      && this.block.properties.model_content_hash === modelHash;
    if (!modelUrl || event.detail.src !== modelUrl || !store.sourceOwnershipActive(source)) return;
    this.#savingModelView = pending; this.requestUpdate();
    try { await store.saveModel3dView(blockId, event.detail, current); }
    finally { if (this.#savingModelView === pending) { this.#savingModelView = null; this.requestUpdate(); } }
  }

  #modelContext(properties: Record<string, unknown>, readOnly = false) {
    if (this.block.type !== "model3d") return nothing;
    const src = String(properties.model_url ?? ""), view = normalizeModel3dView(properties.model_view);
    const saved = Boolean(properties.media_url && properties.source_content_hash && view);
    return html`<section class="model3d-context" aria-label=${this.i18n.t("model3d.context.title", "3D model and saved view")}>
      ${src ? html`<forma-model3d-viewer .src=${src} .view=${view} .readonly=${readOnly || this.block.locked} .disabled=${Boolean(this.#savingModelView)} @model3d-capture=${this.#saveModelView}></forma-model3d-viewer>` : nothing}
      <p>${this.i18n.t("model3d.context.explanation", "Choose a view here and save it as an image. Generations use that saved view; rotating the preview does not change it.")}</p>
      ${saved ? html`<figure><img src=${String(properties.media_url)} alt=${this.i18n.t("model3d.context.savedAlt", "Saved model view for generation")} loading="lazy"><figcaption>${this.i18n.t("model3d.context.saved", "Saved image view")}</figcaption></figure>` : html`<p role="status">${this.i18n.t("model3d.context.missingView", "Save a view before using this model as an image reference.")}</p>`}
      <forma-reference-pixel-policy .block=${this.block} .surface=${this.surface} .readOnly=${readOnly} .disabled=${Boolean(this.#savingModelView)}></forma-reference-pixel-policy>
      ${src ? html`<a href=${src} download=${String(properties.model_filename ?? "model.glb")}>${this.i18n.t("model3d.context.download", "Download original GLB")}</a>` : nothing}
    </section>`;
  }

  #authoredSummary(block = this.block, ancestors = new Set<string>()): TemplateResult {
    const p = block.properties, intent = blockIntentFor(block.type, p), definition = blockTypeDefinition(block.type);
    const copy = String(p.artifact_markdown ?? p.text ?? p.source_excerpt ?? p.description ?? p.label ?? "");
    const children = ancestors.has(block.id) ? [] : this.#contextChildren(block.id);
    const colors = Array.isArray(p.colors) ? p.colors.map(String) : [];
    return html`<article class="context-block context-block--summary" data-block-id=${block.id} tabindex="-1">
      <div class="block-body">
        <header class="block-heading"><div class="block-heading-copy"><h3 class="block-type">${definition ? this.i18n.system(definition.label) : block.type}</h3><span class="handle" dir="auto">${block.handle}</span></div><div class="block-heading-state"><span class=${`block-intent-badge ${intent}`}>${this.i18n.system(BLOCK_INTENTS.find((item) => item.id === intent)?.label ?? intent)}</span><span class="context-lock-state">${icon(block.locked ? "lock" : "unlock")}${this.i18n.t(block.locked ? "context.controls.locked" : "context.controls.unlocked", block.locked ? "Locked" : "Unlocked")}</span></div></header>
        ${copy ? html`<p class="block-copy" data-forma-content="primary" dir="auto">${copy}</p>` : nothing}
        ${this.#protectedCopy(p)}
        ${colors.length ? html`<div class="palette-strip" aria-label=${this.i18n.t("context.controls.palette", "Saved palette")}>${colors.map((color) => html`<i style=${`--swatch:${color}`}><span class="sr-only">${color}</span></i>`)}</div>` : nothing}
        ${block.type === "reference" && referenceMedium(p) === "image" && p.media_url ? html`<forma-reference-image .src=${String(p.media_url)} .alt=${String(p.label ?? block.handle)} .targetId=${block.id} .referenceId=${String(p.reference_id ?? "")} .focalPoint=${p.focal_point}></forma-reference-image>` : nothing}
        ${block.type === "model3d" ? html`${p.media_url ? html`<img class="model3d-saved-view" src=${String(p.media_url)} alt=${this.i18n.t("model3d.context.savedAlt", "Saved model view for generation")} loading="lazy">` : nothing}<p>${p.media_url ? this.i18n.t("model3d.context.saved", "Saved image view") : this.i18n.t("model3d.context.missingView", "Save a view before using this model as an image reference.")}</p>` : nothing}
        ${block.type === "audio" ? renderAudioPlayer(String(p.media_url ?? ""), String(p.label ?? block.handle), this.i18n, { transcript: String(p.transcript ?? p.lyrics ?? "") }) : nothing}
        ${isCharacterContext(block.type, p) ? html`<p class="character-context-summary" dir="auto">${characterProfileSummary(p)}</p>` : nothing}
        ${children.length ? html`<ol class="context-authored-children">${children.map(({ block: child }) => html`<li>${this.#authoredSummary(child, new Set([...ancestors, block.id]))}</li>`)}</ol>` : nothing}
      </div>
    </article>`;
  }

  override render() {
    if (!this.block || !this.store.captureAuthorizationScope()) return nothing;
    if (this.block.type.toLowerCase() === "output") return html`<forma-output-requirements .documentId=${this.block.documentId} .blockId=${this.block.id} .inspectionOnly=${this.readOnly}></forma-output-requirements>`;
    if (!this.#calmSurface()) return this.#fullEditor();
    const open = this.#controlsVisible(), selected = this.store.ui.focusBlockId === this.block.id;
    const selectionLabel = this.i18n.t(selected ? "context.controls.selected" : "context.controls.select", selected ? "Selected decision" : "Select decision");
    return html`<section class="context-decision" data-controls-open=${String(open)} data-selected=${String(selected)}>
      <div class="context-decision-actions">
        ${this.surface === "document" ? html`<label class="context-decision-select"><input type="radio" name=${`context-selection-${this.block.projectId}-${this.block.documentId}`} .checked=${selected} aria-label=${contextControlName(candidate=>this.i18n.t("context.controls.selectNamed", "{selection}: {name}", { selection: selectionLabel, name: `\u2068${String(candidate.properties.label ?? candidate.handle)}\u2069` }), this.block, this.store.projection.get().blocks, this.i18n)} @change=${this.#selectDecision}><span>${selectionLabel}</span></label>` : nothing}
        ${selected || this.surface === "library" ? html`<button type="button" class="button ghost context-controls-toggle" aria-expanded=${String(open)} aria-controls=${`context-controls-${this.surface}-${this.block.id}`} @click=${this.#toggleControls}>${icon(open ? "close" : "edit")}${this.#controlsLabel()}</button>` : nothing}
      </div>
      ${!open && this.#draftChanged && (outputInputDraft(this.block) ? this.#structuredDraftDiffers() : this.#ordinaryDraftDiffers()) ? html`<small class="context-draft-note">${this.i18n.t("context.controls.retained", "Unsaved edits retained")}</small>` : nothing}
      ${keyed(this.#controlsIdentity, html`${cache(localizeTemplateResult(open ? html`<div id=${`context-controls-${this.surface}-${this.block.id}`} class="context-controls-panel" tabindex="-1" role="region" aria-label=${this.#controlsLabel()} @keydown=${this.#controlsKeys}>${this.#fullEditor()}</div>` : html`<div id=${`context-controls-${this.surface}-${this.block.id}`}>${this.#authoredSummary()}</div>`, this.i18n))}`)}
    </section>`;
  }

}
if (!customElements.get("forma-context-block")) customElements.define("forma-context-block", ContextBlock);

declare global { interface HTMLElementTagNameMap { "forma-context-block": ContextBlock } }
