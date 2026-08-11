import { html, nothing } from "lit";
import type { CreativeBlock, EventInput } from "../model/events";
import { BLOCK_TYPES, blockTypeDefinition, suggestedSubtype, type BlockKind } from "../model/block-types";
import { DEFAULT_REFERENCE_FINDINGS } from "../model/extractors";
import { sampleImageFile } from "../model/image-sample";
import { icon } from "./forma-element";
import { AlternativeStudio } from "./forma-studio-alternatives";
import { spatialScopeLabel } from "../model/spatial-scope";
import "./spatial-scope-editor";

type EditorSection = {
  id: "brief" | "picture" | "look" | "delivery" | "references";
  label: string;
  description: string;
  types: BlockKind[];
  starter: BlockKind;
};

const EDITOR_SECTIONS: readonly EditorSection[] = [
  { id: "brief", label: "The brief", description: "What this needs to achieve and who it is for", types: ["direction", "audience", "message", "emotion"], starter: "direction" },
  { id: "picture", label: "The picture", description: "What appears, where it happens, and how it moves", types: ["subject", "environment", "motion", "scale"], starter: "subject" },
  { id: "look", label: "The look", description: "How the work should be framed, lit, and styled", types: ["composition", "camera", "lighting", "style", "material", "palette", "typography"], starter: "style" },
  { id: "delivery", label: "The guardrails", description: "Where it goes and what it must protect or avoid", types: ["format", "brand", "exclusion", "accessibility"], starter: "format" },
  { id: "references", label: "Visual references", description: "Images that make the direction easier to see", types: ["reference"], starter: "reference" },
] as const;

const FRIENDLY_LABELS: Record<BlockKind, string> = {
  direction: "Goal",
  audience: "Audience",
  message: "Message",
  emotion: "Feeling",
  subject: "Subject",
  environment: "Setting",
  motion: "Movement",
  scale: "Scale",
  composition: "Framing",
  camera: "Viewpoint",
  lighting: "Light",
  style: "Visual style",
  material: "Materials",
  palette: "Color",
  typography: "Type",
  format: "Format",
  brand: "Brand behavior",
  exclusion: "Avoid",
  accessibility: "Accessibility",
  reference: "Reference image",
};

const QUICK_TOOLS: readonly BlockKind[] = ["direction", "subject", "style", "lighting", "exclusion"];
const textFor = (item: CreativeBlock) => String(item.properties.text ?? item.properties.label ?? "Untitled");
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 42) || "item";
const strengthFor = (weight: number) => weight >= .82 ? "lead" : weight >= .5 ? "balanced" : "supporting";
const weightFor = (strength: string) => strength === "lead" ? .94 : strength === "supporting" ? .34 : .65;

export class FormaCreativeEditor extends AlternativeStudio {
  #selectedId = "";
  #creating = false;
  #newType: BlockKind = "direction";
  #newText = "";
  #newStrength = "balanced";
  #pendingReference: File | null = null;
  #rightsConfirmed = false;
  #uploading = false;

  protected override updated() {
    const create = this.querySelector<HTMLDialogElement>(".creative-add-dialog");
    if (this.#creating && create && !create.open) create.showModal();
    const reference = this.querySelector<HTMLDialogElement>(".creative-reference-dialog");
    if (this.#pendingReference && reference && !reference.open) reference.showModal();
  }

  #openCreate(type: BlockKind = "direction") {
    if (type === "reference") return;
    this.#newType = type;
    this.#newText = "";
    this.#newStrength = "balanced";
    this.#creating = true;
    this.requestUpdate();
  }

  #closeCreate() {
    this.querySelector<HTMLDialogElement>(".creative-add-dialog")?.close();
    this.#creating = false;
    this.requestUpdate();
  }

  #queueReference(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    this.#pendingReference = file;
    this.#rightsConfirmed = false;
    this.requestUpdate();
  }

  #cancelReference() {
    this.querySelector<HTMLDialogElement>(".creative-reference-dialog")?.close();
    this.#pendingReference = null;
    this.#rightsConfirmed = false;
    this.requestUpdate();
  }

  async #confirmReference() {
    const file = this.#pendingReference;
    if (!file || !this.#rightsConfirmed || this.#uploading) return;
    this.#uploading = true;
    this.requestUpdate();
    try {
      let sample;
      try { sample = await sampleImageFile(file); } catch { sample = undefined; }
      const form = new FormData();
      form.append("file", file);
      form.append("rightsConfirmed", "true");
      const response = await fetch("/api/media", { method: "POST", body: form });
      const media = await response.json() as { key?: string; url?: string; error?: string };
      if (!response.ok || !media.url) throw new Error(media.error ?? "That image could not be added");
      const projection = this.store.projection.get();
      const referenceId = crypto.randomUUID();
      const itemId = crypto.randomUUID();
      const appended = await this.store.appendBatch([
        { type: "ReferenceIngested", payload: { reference_id: referenceId, source_type: "upload", source_ref: media.url, content_hash: media.key, rights_class: "asserted" } },
        { type: "RightsAsserted", payload: { reference_id: referenceId, rights_class: "owned_or_licensed", assertion_method: "explicit-upload-confirmation" } },
        { type: "BlockCreated", payload: { block_id: itemId, document_id: projection.documentId, type: "reference", handle: `reference/${slug(file.name)}`, position: `e${String(this.store.head.get() + 1).padStart(6, "0")}`, properties: { reference_id: referenceId, label: file.name, media_url: media.url, subtype: "Mood", weight: .72, authority: "authored", extraction_preferences: DEFAULT_REFERENCE_FINDINGS, extraction_status: sample ? "pending" : "unavailable", created_from: "creative-editor" } } },
      ]);
      if (appended.length) {
        this.#selectedId = itemId;
        if (sample) await this.store.extractReference(itemId, referenceId, sample, DEFAULT_REFERENCE_FINDINGS);
        this.#cancelReference();
      }
    } catch (error) {
      this.store.toast(error instanceof Error ? error.message : "That image could not be added");
    } finally {
      this.#uploading = false;
      this.requestUpdate();
    }
  }

  async #create(event: SubmitEvent) {
    event.preventDefault();
    const text = this.#newText.trim();
    if (!text) return;
    const projection = this.store.projection.get();
    const id = crypto.randomUUID();
    const appended = await this.store.append({
      type: "BlockCreated",
      payload: {
        block_id: id,
        document_id: projection.documentId,
        type: this.#newType,
        handle: `${this.#newType}/${slug(text)}`,
        position: `e${String(this.store.head.get() + 1).padStart(6, "0")}`,
        properties: {
          text,
          subtype: suggestedSubtype(this.#newType),
          weight: weightFor(this.#newStrength),
          authority: "authored",
          created_from: "creative-editor",
          ...(this.#newType === "exclusion" ? { semantic_role: "negative_constraint" } : {}),
        },
      },
    });
    if (appended.length) {
      this.#selectedId = id;
      this.#closeCreate();
    }
  }

  async #save(event: SubmitEvent, item: CreativeBlock) {
    event.preventDefault();
    if (item.locked) return;
    const data = new FormData(event.currentTarget as HTMLFormElement);
    const text = String(data.get("copy") ?? "").trim();
    const strength = String(data.get("strength") ?? strengthFor(Number(item.properties.weight ?? .65)));
    const currentText = textFor(item);
    const currentWeight = Number(item.properties.weight ?? .65);
    const nextWeight = weightFor(strength);
    const changes: EventInput[] = [];
    if (text && text !== currentText) changes.push({ type: "BlockPropertyEdited", payload: { block_id: item.id, property_path: item.properties.text === undefined ? "label" : "text", old_value: currentText, new_value: text, source_surface: "creative-editor" } });
    if (nextWeight !== currentWeight) changes.push({ type: "BlockWeightSet", payload: { block_id: item.id, weight: nextWeight, previous_weight: currentWeight, source_surface: "creative-editor" } });
    if (!changes.length) {
      this.store.toast("Everything already matches.");
      return;
    }
    await this.store.appendBatch(changes);
  }

  async #toggle(item: CreativeBlock) {
    const current = Number(item.properties.weight ?? .65);
    await this.store.append({ type: "BlockWeightSet", payload: { block_id: item.id, weight: current > 0 ? 0 : .65, previous_weight: current, source_surface: "creative-editor" } });
  }

  async #protect(item: CreativeBlock) {
    await this.store.append({ type: item.locked ? "BlockUnlocked" : "BlockLocked", payload: { block_id: item.id, source_surface: "creative-editor" } });
  }

  async #duplicate(item: CreativeBlock) {
    const projection = this.store.projection.get();
    const id = crypto.randomUUID();
    const appended = await this.store.append({
      type: "BlockCreated",
      payload: {
        block_id: id,
        document_id: projection.documentId,
        type: item.type,
        handle: `${item.type}/${slug(textFor(item))}-copy`,
        position: `e${String(this.store.head.get() + 1).padStart(6, "0")}`,
        properties: { ...item.properties, authority: "authored", copied_from_block_id: item.id, created_from: "creative-editor" },
      },
    });
    if (appended.length) this.#selectedId = id;
  }

  async #remove(item: CreativeBlock) {
    if (item.locked) {
      this.store.toast("Allow changes before removing this item.");
      return;
    }
    const appended = await this.store.append({ type: "BlockRemoved", payload: { block_id: item.id, source_surface: "creative-editor" } });
    if (appended.length && this.#selectedId === item.id) this.#selectedId = "";
  }

  #drag(event: DragEvent, id: string) {
    event.dataTransfer?.setData("application/x-creative-editor-item", id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  }

  async #reorder(sourceId: string, targetId: string) {
    if (!sourceId || sourceId === targetId) return;
    const ordered = [...this.store.projection.get().blocks];
    const sourceIndex = ordered.findIndex((item) => item.id === sourceId);
    const targetIndex = ordered.findIndex((item) => item.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const [moved] = ordered.splice(sourceIndex, 1);
    ordered.splice(targetIndex, 0, moved);
    const changes: EventInput[] = ordered.map((item, index) => ({
      type: "BlockPropertyEdited",
      payload: { block_id: item.id, property_path: "position", old_value: item.position, new_value: `e${String(index).padStart(5, "0")}`, source_surface: "creative-editor" },
    })).filter((change) => change.payload.old_value !== change.payload.new_value);
    if (changes.length) await this.store.appendBatch(changes);
  }

  async #drop(event: DragEvent, targetId: string) {
    event.preventDefault();
    await this.#reorder(event.dataTransfer?.getData("application/x-creative-editor-item") ?? "", targetId);
  }

  async #move(item: CreativeBlock, delta: number) {
    const ordered = [...this.store.projection.get().blocks];
    const index = ordered.findIndex((candidate) => candidate.id === item.id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= ordered.length) {
      this.store.toast(delta < 0 ? "This is already first." : "This is already last.");
      return;
    }
    await this.#reorder(item.id, ordered[target].id);
  }

  #previewCopy() {
    const output = this.store.projection.get().outputs[0];
    if (!output?.contentRef) return null;
    const raw = this.store.content.get()[output.contentRef];
    if (!raw) return null;
    try { return JSON.parse(raw) as Record<string, unknown>; } catch { return { rationale: raw }; }
  }

  #sectionFor(item: CreativeBlock) {
    return EDITOR_SECTIONS.find((section) => section.types.includes(item.type as BlockKind)) ?? EDITOR_SECTIONS[3];
  }

  #itemCard(item: CreativeBlock) {
    const kind = item.type as BlockKind;
    const negativeConstraint = kind === "exclusion";
    const selected = this.#selectedId === item.id;
    const included = Number(item.properties.weight ?? .65) > 0;
    const image = kind === "reference" ? String(item.properties.media_url ?? "") : "";
    return html`<article class=${`creative-editor-item ${negativeConstraint ? "negative-constraint" : ""} ${selected ? "selected" : ""} ${included ? "" : "paused"}`} draggable="true"
      @dragstart=${(event: DragEvent) => this.#drag(event, item.id)}
      @dragover=${(event: DragEvent) => event.preventDefault()}
      @drop=${(event: DragEvent) => this.#drop(event, item.id)}>
      <button class="creative-editor-item-main" aria-pressed=${selected} @click=${() => { this.#selectedId = item.id; this.requestUpdate(); }}>
        ${image ? html`<img src=${image} alt=${textFor(item)} loading="lazy">` : html`<span class=${`editor-item-glyph editor-item-glyph--${this.#sectionFor(item).id}`}>${FRIENDLY_LABELS[kind].slice(0, 2)}</span>`}
        <span><b>${FRIENDLY_LABELS[kind]}</b><small>${negativeConstraint ? `Must not include: ${textFor(item)}` : textFor(item)}</small><small class="creative-editor-item-scope">${spatialScopeLabel(item.properties.spatial_scope)}</small></span>
        ${item.locked ? html`<em>Protected</em>` : negativeConstraint ? html`<em>Exclude</em>` : nothing}
      </button>
      <button class="creative-editor-item-toggle" aria-pressed=${included} title=${included ? "Leave out of the next preview" : "Use in the next preview"} @click=${() => this.#toggle(item)}>${included ? "On" : "Off"}</button>
    </article>`;
  }

  override render() {
    const projection = this.store.projection.get();
    const selected = projection.blocks.find((item) => item.id === this.#selectedId) ?? projection.blocks[0];
    const selectedIsExclusion = selected?.type === "exclusion";
    const latest = projection.outputs[0];
    const blockIds = new Set(projection.blocks.map((item) => item.id));
    const previewOutdated = Boolean(latest && this.store.events.get().some((event) => event.sequence > latest.sequence && /^(BlockCreated|BlockPropertyEdited|BlockWeightSet|BlockRemoved|BlockRestored|ChipEdited)$/.test(event.type) && (event.payload.document_id === projection.documentId || blockIds.has(String(event.payload.block_id ?? "")))));
    const preview = this.#previewCopy();
    const direction = projection.blocks.find((item) => item.type === "direction" && Number(item.properties.weight ?? .65) > 0);
    const subject = projection.blocks.find((item) => item.type === "subject" && Number(item.properties.weight ?? .65) > 0);
    const look = projection.blocks.find((item) => ["style", "lighting", "palette", "material"].includes(item.type) && Number(item.properties.weight ?? .65) > 0);
    const providerReady = Boolean(this.store.session.get()?.provider.configured);
    const body = html`
      <section class="creative-editor" aria-label="Creative document editor">
        <header class="creative-editor-toolbar">
          <div class="creative-editor-title"><span>Editing</span><b>${projection.documentTitle}</b><small>Changes save automatically</small></div>
          <div class="creative-editor-history" role="toolbar" aria-label="Editing controls">
            <button ?disabled=${!this.store.canUndo()} title="Undo" @click=${() => this.store.undo()}>${icon("undo")}<span>Undo</span></button>
            <button ?disabled=${!this.store.canRedo()} title="Redo" @click=${() => this.store.redo()}>${icon("redo")}<span>Redo</span></button>
          </div>
          <button class="button secondary compact" @click=${() => this.#openCreate()}>${icon("plus")} Add something</button>
          <button class="button primary compact" ?disabled=${!providerReady || Boolean(this.store.busy.get())} title=${providerReady ? "Make a fresh preview" : "Preview is not available yet"} @click=${() => this.store.generate()}>${icon("spark")} ${this.store.busy.get() === "generate" ? "Making preview…" : previewOutdated ? "Update preview" : latest ? "Try another" : "Make a preview"}</button>
        </header>

        <div class="creative-editor-layout">
          <aside class="creative-editor-tools" aria-label="Add creative material">
            <header><span>Tools</span><h2>Add to the plan</h2><p>Choose what you want to shape. The editor will put it in the right place.</p></header>
            <div class="creative-quick-tools">
              ${QUICK_TOOLS.map((type) => html`<button @click=${() => this.#openCreate(type)}><span>${FRIENDLY_LABELS[type].slice(0, 2)}</span><b>${FRIENDLY_LABELS[type]}</b><small>${blockTypeDefinition(type)?.description}</small></button>`)}
            </div>
            <button class="creative-tool-more" @click=${() => this.#openCreate()}>${icon("plus")} More ways to shape the work</button>
            <label class="creative-reference-tool">${icon("image")}<span><b>Add an image</b><small>Use a visual reference</small></span><input type="file" accept="image/*" @change=${this.#queueReference}></label>
            <footer><b>Not sure where to start?</b><p>Set the goal first. A clear goal makes every later choice easier to judge.</p><button @click=${() => this.#openCreate("direction")}>Set the goal ${icon("arrow")}</button></footer>
          </aside>

          <main class="creative-editor-canvas">
            <section class=${`creative-preview ${previewOutdated ? "preview-outdated" : ""}`}>
              <div class=${`creative-preview-art variant-${latest ? latest.variant % 4 : projection.blocks.length % 4} ${latest ? "has-preview" : ""}`}>
                <span class="creative-preview-light"></span><span class="creative-preview-frame"></span><span class="creative-preview-subject"></span><span class="creative-preview-ground"></span>
              </div>
              <div class="creative-preview-copy">
                <span>Working preview</span>
                <h2>${preview ? String(preview.title ?? "A direction is taking shape") : direction ? textFor(direction) : "Start with one clear goal"}</h2>
                <p>${preview ? String(preview.rationale ?? preview.scene ?? "") : subject ? `Centered on ${textFor(subject)}${look ? `, with ${textFor(look).toLowerCase()}` : ""}.` : "Add a goal, subject, or visual reference. You can refine the rest only when it becomes useful."}</p>
                ${previewOutdated ? html`<small>Plan changed since this preview · update it to apply the current guardrails and decisions.</small>` : latest ? html`<small>Latest preview · keep editing and try another whenever the plan changes.</small>` : html`<small>No preview yet · the plan remains useful on its own.</small>`}
              </div>
            </section>

            <section class="creative-plan-page" aria-label="One-page creative plan">
              <header><div><span>One-page plan</span><h2>Everything shaping the work</h2></div><small>Select anything to edit it. Drag to change the reading order.</small></header>
              <div class="creative-plan-sections">
                ${EDITOR_SECTIONS.map((section) => {
                  const items = projection.blocks.filter((item) => section.types.includes(item.type as BlockKind));
                  return html`<section class=${`creative-plan-section creative-plan-section--${section.id}`}>
                    <header><div><h3>${section.label}</h3><p>${section.description}</p></div><button aria-label=${`Add to ${section.label}`} @click=${() => section.starter === "reference" ? this.querySelector<HTMLInputElement>(".creative-reference-tool input")?.click() : this.#openCreate(section.starter)}>${icon("plus")}</button></header>
                    <div>${items.length ? items.map((item) => this.#itemCard(item)) : html`<button class="creative-section-empty" @click=${() => section.starter === "reference" ? this.querySelector<HTMLInputElement>(".creative-reference-tool input")?.click() : this.#openCreate(section.starter)}>Add ${FRIENDLY_LABELS[section.starter].toLowerCase()}</button>`}</div>
                  </section>`;
                })}
              </div>
            </section>
          </main>

          <aside class=${`creative-editor-inspector ${selectedIsExclusion ? "negative-constraint" : ""}`} aria-label="Selected item settings">
            ${selected ? html`<form @submit=${(event: SubmitEvent) => this.#save(event, selected)}>
              <header><span>${selectedIsExclusion ? "Guardrail selected" : "Selected"}</span><h2>${FRIENDLY_LABELS[selected.type as BlockKind]}</h2><p>${selectedIsExclusion ? "This is a negative constraint. It tells the preview what must not appear; it never becomes a subject, goal, or positive direction." : "Change the wording and how strongly it should shape the next preview."}</p></header>
              ${selected.type === "reference" && selected.properties.media_url ? html`<img class="creative-inspector-image" src=${String(selected.properties.media_url)} alt=${textFor(selected)}>` : nothing}
              <label><span>${selectedIsExclusion ? "What must the work avoid?" : "What should it say?"}</span><textarea name="copy" rows="6" .value=${textFor(selected)} ?disabled=${selected.locked}></textarea></label>
              <fieldset ?disabled=${selected.locked}>
                <legend>${selectedIsExclusion ? "How strictly should it be excluded?" : "How much should it lead?"}</legend>
                ${(selectedIsExclusion ? [["supporting", "Prefer avoiding"], ["balanced", "Avoid"], ["lead", "Never include"]] : [["supporting", "Supporting"], ["balanced", "Balanced"], ["lead", "Lead"]]).map(([value, label]) => html`<label><input type="radio" name="strength" value=${value} .checked=${strengthFor(Number(selected.properties.weight ?? .65)) === value}><span>${label}</span></label>`)}
              </fieldset>
              <button class="button primary" ?disabled=${selected.locked}>${selectedIsExclusion ? "Save guardrail" : "Save changes"}</button>
              <div class="creative-inspector-order"><button type="button" @click=${() => this.#move(selected, -1)}>↑ Earlier</button><button type="button" @click=${() => this.#move(selected, 1)}>↓ Later</button></div>
              <div class="creative-inspector-actions">
                <button type="button" @click=${() => this.#protect(selected)}>${selected.locked ? "Allow changes" : "Protect from changes"}</button>
                <button type="button" @click=${() => this.#duplicate(selected)}>Make a copy</button>
                <button type="button" class="danger" @click=${() => this.#remove(selected)}>Remove</button>
              </div>
            </form><forma-spatial-scope-editor .block=${selected} surface="editor"></forma-spatial-scope-editor>` : html`<div class="creative-inspector-empty"><span>✦</span><h2>Start anywhere</h2><p>Add a goal, subject, look, or reference. Select it on the page whenever you want to refine it.</p><button class="button primary" @click=${() => this.#openCreate()}>Add something</button></div>`}
          </aside>
        </div>
      </section>

      ${this.#creating ? html`<dialog class="modal creative-add-dialog" closedby="any" aria-labelledby="creative-add-title" @click=${(event: MouseEvent) => { if (event.target === event.currentTarget) this.#closeCreate(); }} @cancel=${(event: Event) => { event.preventDefault(); this.#closeCreate(); }}>
        <form class="modal-card creative-add-card" @submit=${this.#create}>
          <button type="button" class="icon-button modal-close" aria-label="Close" @click=${this.#closeCreate}>${icon("close")}</button>
          <span class="eyebrow">Add to the plan</span><h2 id="creative-add-title">What do you want to shape?</h2><p>${this.#newType === "exclusion" ? "Name something that must not appear. It will be stored and compiled as a negative guardrail, never as the subject of the work." : "Choose the closest fit and write the instruction in everyday language. You can change it later."}</p>
          <label><span>Area</span><select .value=${this.#newType} @change=${(event: Event) => { this.#newType = (event.target as HTMLSelectElement).value as BlockKind; this.requestUpdate(); }}>${BLOCK_TYPES.filter((item) => item.type !== "reference").map((item) => html`<option value=${item.type}>${FRIENDLY_LABELS[item.type]}</option>`)}</select></label>
          <label><span>${this.#newType === "exclusion" ? "What must be excluded?" : "Your instruction"}</span><textarea autofocus required rows="4" placeholder=${this.#newType === "exclusion" ? "For example: people under 20 years old" : blockTypeDefinition(this.#newType)?.prompt} .value=${this.#newText} @input=${(event: InputEvent) => { this.#newText = (event.target as HTMLTextAreaElement).value; this.requestUpdate(); }}></textarea></label>
          <fieldset><legend>${this.#newType === "exclusion" ? "How strictly should it be excluded?" : "How much should it lead?"}</legend>${(this.#newType === "exclusion" ? [["supporting", "Prefer avoiding"], ["balanced", "Avoid"], ["lead", "Never include"]] : [["supporting", "Supporting"], ["balanced", "Balanced"], ["lead", "Lead"]]).map(([value, label]) => html`<label><input type="radio" name="new-strength" value=${value} .checked=${this.#newStrength === value} @change=${() => { this.#newStrength = value; this.requestUpdate(); }}><span>${label}</span></label>`)}</fieldset>
          <footer><button type="button" class="button ghost" @click=${this.#closeCreate}>Cancel</button><button class="button primary" ?disabled=${!this.#newText.trim()}>Add to plan</button></footer>
        </form>
      </dialog>` : nothing}

      ${this.#pendingReference ? html`<dialog class="modal creative-reference-dialog" closedby="any" aria-labelledby="creative-reference-title" @click=${(event: MouseEvent) => { if (event.target === event.currentTarget && !this.#uploading) this.#cancelReference(); }} @cancel=${(event: Event) => { event.preventDefault(); if (!this.#uploading) this.#cancelReference(); }}>
        <div class="modal-card creative-reference-card">
          <button class="icon-button modal-close" aria-label="Close" ?disabled=${this.#uploading} @click=${this.#cancelReference}>${icon("close")}</button>
          <span class="eyebrow">Add a visual reference</span><h2 id="creative-reference-title">Use this image in the plan?</h2>
          <div class="creative-reference-receipt"><span>${icon("image")}</span><div><b>${this.#pendingReference.name}</b><small>${(this.#pendingReference.size / 1_048_576).toFixed(1)} MB</small></div></div>
          <p>The editor will prepare color, mood, layout, material, lighting, and spatial cues. You choose which ones become part of the plan.</p>
          <label class="rights-check"><input type="checkbox" .checked=${this.#rightsConfirmed} @change=${(event: Event) => { this.#rightsConfirmed = (event.target as HTMLInputElement).checked; this.requestUpdate(); }}><span><b>I own this image or have permission to use it.</b><small>This confirmation stays with the image wherever it is reused.</small></span></label>
          <footer><button class="button ghost" ?disabled=${this.#uploading} @click=${this.#cancelReference}>Cancel</button><button class="button primary" ?disabled=${!this.#rightsConfirmed || this.#uploading} @click=${this.#confirmReference}>${this.#uploading ? "Adding image…" : "Add image"}</button></footer>
        </div>
      </dialog>` : nothing}
    `;
    return this.shell("editor", "Creative editor", "Shape the brief, scene, look, and guardrails in one familiar workspace. The system keeps the underlying history organized for you.", body, { continuity: false, inspector: false, quietRail: true });
  }
}

customElements.define("forma-creative-editor", FormaCreativeEditor);
