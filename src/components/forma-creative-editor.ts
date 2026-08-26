import { html, nothing } from "lit";
import { generationHistoryItemIsDraft, generationHistoryItems, isDraftOutput, outputQualityLabel, type CreativeBlock, type EventInput } from "../model/events";
import { BLOCK_INTENTS, BLOCK_TYPES, blockIntentFor, blockTypeDefinition, isBlockIntent, isBlockKind, isNegativeIntent, suggestedSubtype, type BlockIntent, type BlockKind } from "../model/block-types";
import { DEFAULT_REFERENCE_FINDINGS } from "../model/extractors";
import { sampleImageFile } from "../model/image-sample";
import { focalPointCss } from "../model/focal-point";
import { positionImageAtFocalPoint } from "../model/image-focus";
import { icon } from "./forma-element";
import { blockIconName } from "./icon-semantics";
import { ensureModalDialog } from "./modal-dialog";
import { AlternativeStudio } from "./forma-studio-alternatives";
import { localizedSpatialScopeLabel } from "./design-system/localized-spatial-scope";
import { outputInputDraft } from "../model/output-authoring";
import { isImageReference, referenceMedium } from "../model/reference-media";
import { audioMimeType } from "../model/audio";
import { browserAudioDuration } from "../model/audio-browser";
import { renderAudioPlayer } from "./audio-playback";
import "./icons-authoring";
import "./spatial-scope-editor";
import "./output-visual";
import "./reference-image";
import "./reference-pixel-policy";
import "./generation-actions";
import "./document-artifacts";
import "./design-system/choice-card";
import "./prompt-fan-visual";
import "./prompt-fan-review";
import "./output-input-editor";

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
  { id: "look", label: "The look", description: "How the work should be framed, lit, and styled", types: ["composition", "camera", "lighting", "style", "material", "palette", "typography", "audio"], starter: "style" },
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
  audio: "Audio",
  format: "Format",
  brand: "Brand behavior",
  exclusion: "General constraint",
  accessibility: "Accessibility",
  reference: "Reference image",
  sketch: "Sketch",
};

const QUICK_TOOLS: readonly { type: BlockKind; intent: BlockIntent; label?: string; description?: string }[] = [
  { type:"direction", intent:"include" },
  { type:"subject", intent:"include" },
  { type:"style", intent:"include" },
  { type:"lighting", intent:"include" },
  { type:"audio", intent:"include" },
  { type:"subject", intent:"avoid", label:"Avoid", description:"Keep an unwanted subject, mood, color, material, or other reality out." },
];
const textFor = (item: CreativeBlock) => String(item.properties.artifact_markdown ?? item.properties.text ?? item.properties.source_excerpt ?? item.properties.label ?? "Untitled");
const labelFor = (item: CreativeBlock): string => {
  if (item.type !== "reference") return FRIENDLY_LABELS[item.type as BlockKind];
  const medium = referenceMedium(item.properties);
  return medium === "image" ? "Reference image" : medium === "document" ? "Document" : medium === "audio" ? "Audio" : medium === "video" ? "Video" : medium === "text" ? "Source" : "Reference";
};
const slug = (value: string, id = "") => value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 42) || (id ? `decision-${id.slice(0, 8)}` : "item");
const strengthFor = (weight: number) => weight >= .82 ? "lead" : weight >= .5 ? "balanced" : "supporting";
const weightFor = (strength: string) => strength === "lead" ? .94 : strength === "supporting" ? .34 : .65;
const intentCopy = (intent: BlockIntent) => intent === "prohibit" ? "Never use" : intent === "avoid" ? "Avoid" : intent === "prefer" ? "Prefer" : "Include";

export class FormaCreativeEditor extends AlternativeStudio {
  #selectedId = "";
  #creating = false;
  #newType: BlockKind = "direction";
  #newIntent: BlockIntent = "include";
  #newText = "";
  #newStrength = "balanced";
  #pendingReference: File | null = null;
  #rightsConfirmed = false;
  #uploading = false;

  protected override updated() {
    const create = this.querySelector<HTMLDialogElement>(".creative-add-dialog");
    if (this.#creating) ensureModalDialog(create);
    const reference = this.querySelector<HTMLDialogElement>(".creative-reference-dialog");
    if (this.#pendingReference) ensureModalDialog(reference);
  }

  #openCreate(type: BlockKind = "direction", intent: BlockIntent = "include") {
    if (type === "reference") return;
    this.#newType = type;
    this.#newIntent = intent;
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
      const isAudio=Boolean(audioMimeType(file.type));
      let sample;
      if(!isAudio)try { sample = await sampleImageFile(file); } catch { sample = undefined; }
      const localDuration=isAudio?await browserAudioDuration(file):null;
      const form = new FormData();
      form.append("file", file);
      form.append("rightsConfirmed", "true");
      form.append("nonSensitiveConfirmed", "true");
      const response = await this.store.guardedFetch("/api/media", { method: "POST", body: form },"upload this reference image");
      const media = await response.json() as { key?: string; url?: string; contentHash?:string;mimeType?:string;durationSeconds?:number;size?:number;error?: string };
      if (!response.ok || !media.url) throw new Error(media.error ?? "That image could not be added");
      const projection = this.store.projection.get();
      const referenceId = crypto.randomUUID();
      const itemId = crypto.randomUUID();
      const appended = await this.store.appendBatch([
        { type: "ReferenceIngested", payload: { reference_id: referenceId, source_type: isAudio?"audio-upload":"upload", source_ref: media.url, content_hash: media.contentHash??media.key,source_mime_type:media.mimeType??file.type, rights_class: "asserted" } },
        { type: "RightsAsserted", payload: { reference_id: referenceId, rights_class: "owned_or_licensed", assertion_method: "explicit-upload-confirmation" } },
        { type: "BlockCreated", payload: { block_id: itemId, document_id: projection.documentId, type: isAudio?"audio":"reference", handle: `${isAudio?"audio":"reference"}/${slug(file.name, itemId)}`, position: `e${String(this.store.head.get() + 1).padStart(6, "0")}`, properties: { reference_id: referenceId, label: file.name, media_url: media.url,source_mime_type:media.mimeType??file.type,media_type:media.mimeType??file.type,source_content_hash:media.contentHash, subtype:isAudio?"Score":"Mood", weight: .72, authority: "authored",...(isAudio?{audio_role:"score",rights_class:"owned_or_licensed",duration_seconds:media.durationSeconds??localDuration,size_bytes:media.size??file.size,description:"",inform_generation:false,include_in_output:false,allow_provider_audio_transfer:false}:{pixel_reference_mode:"context_only",extraction_preferences:DEFAULT_REFERENCE_FINDINGS,extraction_status:sample?"pending":"unavailable"}),created_from: "creative-editor" } } },
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
        handle: `${this.#newType}/${slug(text, id)}`,
        position: `e${String(this.store.head.get() + 1).padStart(6, "0")}`,
        properties: {
          text,
          subtype: suggestedSubtype(this.#newType),
          weight: weightFor(this.#newStrength),
          intent: this.#newIntent,
          authority: "authored",
          created_from: "creative-editor",
          ...(this.#newType==="audio"?{audio_role:"score",inform_generation:false,include_in_output:false,allow_provider_audio_transfer:false}:{}),
          ...(isNegativeIntent(this.#newIntent) ? { semantic_role: "negative_constraint" } : {}),
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
    const audioRecording=item.type==="audio"&&Boolean(item.properties.media_url);
    const currentDraft = audioRecording?null:outputInputDraft(item);
    const workbench = currentDraft ? (event.currentTarget as HTMLFormElement).querySelector("forma-output-input-editor") : null;
    const rawText = workbench?.draft?.markdown ?? String(data.get("copy") ?? "");
    const text = item.properties.source_artifact_id || item.properties.source_output_id ? rawText : rawText.trim();
    const strength = String(data.get("strength") ?? strengthFor(Number(item.properties.weight ?? .65)));
    const currentText = audioRecording?String(item.properties.description??""):outputInputDraft(item)?.markdown ?? textFor(item);
    const nextType = String(data.get("item-type") ?? item.type);
    const currentIntent = blockIntentFor(item.type, item.properties);
    const nextIntent = String(data.get("item-intent") ?? currentIntent);
    const storedIntent = String(item.properties.intent ?? "");
    const currentWeight = Number(item.properties.weight ?? .65);
    const nextWeight = weightFor(strength);
    const changes: EventInput[] = [];
    if (isBlockKind(nextType) && nextType !== item.type) {
      changes.push({ type: "BlockPropertyEdited", payload: { block_id: item.id, property_path: "type", old_value: item.type, new_value: nextType, source_surface: "creative-editor-role" } });
      if(nextType==="audio"){
        for(const path of ["inform_generation","include_in_output","allow_provider_audio_transfer"] as const)changes.push({type:"BlockPropertyEdited",payload:{block_id:item.id,property_path:path,old_value:item.properties[path]??null,new_value:false,source_surface:"creative-editor-audio-consent"}});
        changes.push({type:"BlockPropertyEdited",payload:{block_id:item.id,property_path:"audio_role",old_value:item.properties.audio_role??null,new_value:"score",source_surface:"creative-editor-audio-consent"}});
      }
    }
    if (isBlockIntent(nextIntent) && (nextIntent !== currentIntent || (nextType !== item.type && !isBlockIntent(storedIntent)))) changes.push({ type: "BlockPropertyEdited", payload: { block_id: item.id, property_path: "intent", old_value: currentIntent, new_value: nextIntent, source_surface: "creative-editor-intent" } });
    if (currentDraft && workbench?.draft) {
      const authoredChanges = this.store.outputInputEvents(item.id, workbench.draft, "creative-editor");
      if (JSON.stringify(currentDraft) !== JSON.stringify(workbench.draft) && !authoredChanges.length) { this.store.toast(item.properties.source_artifact_kind==="video"?"Unlock every related video scene before saving these changes.":"Unlock every related storyboard frame before saving these changes."); return; }
      changes.push(...authoredChanges);
    } else if(audioRecording&&text!==currentText)changes.push({type:"BlockPropertyEdited",payload:{block_id:item.id,property_path:"description",old_value:currentText,new_value:text,source_surface:"creative-editor-audio"}});
    else if ((text || item.properties.source_artifact_id || item.properties.source_output_id) && text !== currentText) changes.push(...this.store.outputBlockTextEvents(item.id, text, "creative-editor"));
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
    if(item.properties.source_artifact_id){if(item.properties.source_artifact_item_id){this.store.toast(item.properties.source_artifact_kind==="video"?"Copy the complete video to keep every scene connected.":"Copy the complete storyboard to keep every frame connected.");return;}const copied=await this.store.copyLibraryBlockSet(item.id,projection.documentId,"creative-editor");if(copied){this.#selectedId=copied.rootBlockId;this.requestUpdate();}return;}
    const id = crypto.randomUUID();
    const appended = await this.store.append({
      type: "BlockCreated",
      payload: {
        block_id: id,
        document_id: projection.documentId,
        type: item.type,
        handle: `${item.type}/${slug(textFor(item), id)}-copy`,
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
    const appended = await this.store.removeOutputBlock({ type: "BlockRemoved", payload: { block_id: item.id, source_surface: "creative-editor" } });
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

  #previewCopy(output=this.store.projection.get().outputs[0]) {
    if (!output?.contentRef) return null;
    const raw = this.store.content.get()[output.contentRef];
    if (!raw) return null;
    try { return JSON.parse(raw) as Record<string, unknown>; } catch { return { rationale: raw }; }
  }

  #selectOutput(id:string){
    this.store.patchUi({selectedOutputId:id});
    if(this.store.ui.instrumentation&&!this.store.session.get()?.projectContext)void this.store.hot({type:"ObjectViewed",payload:{object_id:id,source_surface:"creative-editor-preview"}});
  }

  #sectionFor(item: CreativeBlock) {
    if (isNegativeIntent(blockIntentFor(item.type, item.properties))) return EDITOR_SECTIONS[3];
    return EDITOR_SECTIONS.find((section) => section.types.includes(item.type as BlockKind)) ?? EDITOR_SECTIONS[3];
  }

  #itemCard(item: CreativeBlock) {
    const kind = item.type as BlockKind;
    const intent = blockIntentFor(item.type, item.properties);
    const negativeConstraint = isNegativeIntent(intent);
    const selected = this.#selectedId === item.id;
    const included = Number(item.properties.weight ?? .65) > 0;
    const image = kind === "reference" && isImageReference(item.properties) ? String(item.properties.media_url ?? "") : "";
    const medium = kind === "reference" ? referenceMedium(item.properties) : "unknown";
    const glyph = medium === "audio" ? "audio" : medium === "video" ? "video" : medium === "text" || medium === "document" ? "document" : blockIconName(kind);
    const itemLabel = labelFor(item);
    return html`<article class=${`creative-editor-item intent-${intent} ${negativeConstraint ? "negative-constraint" : ""} ${selected ? "selected" : ""} ${included ? "" : "paused"}`} draggable="true"
      @dragstart=${(event: DragEvent) => this.#drag(event, item.id)}
      @dragover=${(event: DragEvent) => event.preventDefault()}
      @drop=${(event: DragEvent) => this.#drop(event, item.id)}>
      <button class="creative-editor-item-main" aria-pressed=${selected} @click=${() => { this.#selectedId = item.id; this.requestUpdate(); }}>
        ${image ? html`<img src=${image} alt=${textFor(item)} loading="lazy" style=${focalPointCss(item.properties.focal_point)} @load=${(event:Event)=>positionImageAtFocalPoint(event.currentTarget as HTMLImageElement,item.properties.focal_point)}>` : html`<span class=${`editor-item-glyph editor-item-glyph--${this.#sectionFor(item).id}`} data-reference-medium=${medium}>${icon(glyph)}</span>`}
        <span><b>${intent==="include"?this.i18n.system(itemLabel):this.i18n.system("{intent} {type}",{intent:this.i18n.system(intentCopy(intent)),type:this.i18n.system(itemLabel).toLocaleLowerCase(this.i18n.locale)})}</b><small>${negativeConstraint ? this.i18n.system("Must not include: {value}", { value: textFor(item) }) : textFor(item)}</small><small class="creative-editor-item-scope">${localizedSpatialScopeLabel(item.properties.spatial_scope,this.i18n)}</small></span>
        ${item.locked ? html`<em>Protected</em>` : intent !== "include" ? html`<em>${this.i18n.system(intentCopy(intent))}</em>` : nothing}
      </button>
      <button class="creative-editor-item-toggle" aria-pressed=${included} title=${included ? this.i18n.system("Leave out of the next preview") : this.i18n.system("Use in the next preview")} @click=${() => this.#toggle(item)}>${included ? this.i18n.system("On") : this.i18n.system("Off")}</button>
    </article>`;
  }

  override render() {
    const projection = this.store.projection.get();
    const selected = projection.blocks.find((item) => item.id === this.#selectedId) ?? projection.blocks[0];
    const selectedIntent = selected ? blockIntentFor(selected.type, selected.properties) : "include";
    const selectedIsExclusion = isNegativeIntent(selectedIntent);
    const selectedLabel = selected ? labelFor(selected) : "Reference";
    const hasNonImageReference = projection.blocks.some((item) => item.type === "reference" && !isImageReference(item.properties));
    const history=generationHistoryItems(projection.outputs);const latestItem=history.find((item)=>(item.kind==="fan"?`fan:${item.id}`:item.id)===this.store.ui.selectedOutputId)??history[0];const latest=latestItem?.kind==="output"?latestItem.output:undefined;const latestSequence=latestItem?.sequence??0;const previewProgress=this.store.documentPreviewProgress(projection.documentId);
    const blockIds = new Set(projection.blocks.map((item) => item.id));
    const previewOutdated = Boolean(latestItem && this.store.events.get().some((event) => event.sequence > latestSequence && /^(BlockCreated|BlockPropertyEdited|BlockWeightSet|BlockRemoved|BlockRestored|ChipEdited)$/.test(event.type) && (event.payload.document_id === projection.documentId || blockIds.has(String(event.payload.block_id ?? "")))));
    const preview = this.#previewCopy(latest);
    const direction = projection.blocks.find((item) => item.type === "direction" && !isNegativeIntent(blockIntentFor(item.type, item.properties)) && Number(item.properties.weight ?? .65) > 0);
    const subject = projection.blocks.find((item) => item.type === "subject" && !isNegativeIntent(blockIntentFor(item.type, item.properties)) && Number(item.properties.weight ?? .65) > 0);
    const look = projection.blocks.find((item) => ["style", "lighting", "palette", "material"].includes(item.type) && !isNegativeIntent(blockIntentFor(item.type, item.properties)) && Number(item.properties.weight ?? .65) > 0);
    const body = html`
      <section class="creative-editor" aria-label="Creative document editor">
        <header class="creative-editor-toolbar">
          <div class="creative-editor-title"><span>Editing</span><b>${projection.documentTitle}</b><small>Changes save automatically</small></div>
          <div class="creative-editor-history" role="toolbar" aria-label="Editing controls">
            <button ?disabled=${!this.store.canUndo()} title="Undo" @click=${() => this.store.undo()}>${icon("undo")}<span>Undo</span></button>
            <button ?disabled=${!this.store.canRedo()} title="Redo" @click=${() => this.store.redo()}>${icon("redo")}<span>Redo</span></button>
          </div>
          <button class="button secondary compact" @click=${() => this.#openCreate()}>${icon("plus")} Add context</button>
          <forma-generation-actions source="editor" .selected=${latest??null} compact></forma-generation-actions>
        </header>

        <div class="creative-editor-layout">
          <aside class="creative-editor-tools" aria-label="Add creative material">
            <header><span>Tools</span><h2>Add context</h2><p>Choose what you want to shape. The editor will put it in the right place.</p></header>
            <div class="creative-quick-tools">
              ${QUICK_TOOLS.map((tool) => html`<forma-ui-choice-card compact .label=${this.i18n.system(tool.label??FRIENDLY_LABELS[tool.type])} .detail=${this.i18n.system(tool.description??blockTypeDefinition(tool.type)?.description??"")} .iconName=${blockIconName(tool.type)} .value=${`${tool.type}:${tool.intent}`} @forma-action=${() => this.#openCreate(tool.type, tool.intent)}></forma-ui-choice-card>`)}
            </div>
            <button class="creative-tool-more" @click=${() => this.#openCreate()}>${icon("plus")} More ways to shape the work</button>
            <form @submit=${(event:SubmitEvent)=>{event.preventDefault();}}><label class="creative-reference-tool">${icon("image")}<span><b>Add an image</b><small>Use a visual reference</small></span><input type="file" accept="image/*" @change=${this.#queueReference}></label><label class="creative-reference-tool creative-audio-tool">${icon("audio")}<span><b>${this.i18n.t("artifact.audio.label","Audio")}</b><small>${this.i18n.t("audio.reference.private","Private audio reference")}</small></span><input type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.webm" @change=${this.#queueReference}></label></form>
            <footer><b>Not sure where to start?</b><p>Set the goal first. A clear goal makes every later choice easier to judge.</p><button @click=${() => this.#openCreate("direction")}>Set the goal ${icon("arrow")}</button></footer>
          </aside>

          <main class="creative-editor-canvas">
            <section class=${`creative-preview ${previewOutdated ? "preview-outdated" : ""}`}>
              <div class="creative-preview-stage">
                <div class=${`creative-preview-art ${latest?.mediaUrl||latestItem?.kind==="fan"||previewProgress ? "has-preview" : ""} ${latestItem?.kind==="fan"?"fan":""}`}>${previewProgress?html`<div class="streaming-preview"><img class="streaming-preview-image" src=${previewProgress.mediaUrl} width=${previewProgress.width} height=${previewProgress.height} alt="Early image preview still being refined"><span>Early preview · finalizing</span></div>`:latestItem?.kind==="fan"?html`<forma-prompt-fan-visual .outputs=${latestItem.outputs}></forma-prompt-fan-visual>`:html`<forma-output-visual .output=${latest} .interactive=${true}></forma-output-visual>`}</div>
                ${latestItem?.kind==="fan"?html`<div class="creative-prompt-fan-actions"><forma-prompt-fan-review .fanId=${latestItem.id}></forma-prompt-fan-review></div>`:nothing}
                ${history.length>1?html`<div class="creative-preview-filmstrip" aria-label="All generations from this document">${history.map((item,index)=>{const id=item.kind==="fan"?`fan:${item.id}`:item.id;return html`<button class=${id===(latestItem?.kind==="fan"?`fan:${latestItem.id}`:latestItem?.id)?"selected":""} aria-pressed=${id===(latestItem?.kind==="fan"?`fan:${latestItem.id}`:latestItem?.id)} aria-label=${this.i18n.system("Show {label} {count}", { label: item.kind==="fan" ? this.i18n.system("prompt fan") : outputQualityLabel(item.output).toLowerCase(), count: this.i18n.number(index+1) })} @click=${()=>this.#selectOutput(id)}>${item.kind==="fan"?html`<forma-prompt-fan-visual .outputs=${item.outputs} .compact=${true}></forma-prompt-fan-visual>`:html`<forma-output-visual .output=${item.output} .compact=${true}></forma-output-visual>`}<span>${item.kind==="fan"?this.i18n.system("{label} fan", { label: generationHistoryItemIsDraft(item) ? this.i18n.system("Draft") : this.i18n.system("Full") }):isDraftOutput(item.output)?this.i18n.system("Draft"):this.i18n.system("Full")}${index===0?" " + this.i18n.system("· Latest"):` · #${history.length-index}`}</span></button>`;})}</div>`:nothing}
              </div>
              <div class="creative-preview-copy">
                <span>${previewProgress?this.i18n.system("Image arriving"):latestItem?.kind==="fan"?this.i18n.system("Fan generation"):latest?this.i18n.system(outputQualityLabel(latest)):this.i18n.system("Working preview")}</span>
                <h2>${previewProgress?this.i18n.system("The plan is becoming visible"):latestItem?.kind==="fan"?this.i18n.system("Four prompt processes, one creative decision"):preview ? String(preview.title ?? "A direction is taking shape") : direction ? textFor(direction) : this.i18n.system("Start with one clear goal")}</h2>
                <p>${previewProgress?this.i18n.system("Use this early pass to orient yourself while the completed draft is finalized."):latestItem?.kind==="fan"?this.i18n.system("Compare the four outputs together. Promote only the results that deserve an independent place in the document history."):preview ? String(preview.rationale ?? preview.scene ?? "") : subject ? look?this.i18n.system("Centered on {subject}, with {look}.",{subject:textFor(subject),look:textFor(look).toLowerCase()}):this.i18n.system("Centered on {subject}.",{subject:textFor(subject)}) : this.i18n.system("Add a goal, subject, or visual reference. You can refine the rest only when it becomes useful.")}</p>
                ${previewProgress?html`<small>The durable draft will replace this streamed image automatically.</small>`:previewOutdated ? html`<small>Plan changed since this image · Preview draft or Update image at full quality.</small>`:latestItem?.kind==="fan"?html`<small>${latestItem.complete} of 4 ready · ${latestItem.standaloneCount} promoted to stand alone.</small>` : latest?.mediaUrl ? html`<small>${isDraftOutput(latest)?this.i18n.system("Fast draft for exploration · generate it at full quality when it holds."):latest.promotedFromId?this.i18n.system("Full-quality result refined from a selected draft."):this.i18n.system("Full-quality generated image.")}</small>` : html`<small>No generated image yet · the plan remains useful on its own.</small>`}
              </div>
            </section>

            <forma-document-artifacts compact source="editor"></forma-document-artifacts>

            <section class="creative-plan-page" aria-label="One-page creative plan">
              <header><div><span>One-page plan</span><h2>Everything shaping the work</h2></div><small>Select anything to edit it. Drag to change the reading order.</small></header>
              <div class="creative-plan-sections">
                ${EDITOR_SECTIONS.map((section) => {
                  const items = projection.blocks.filter((item) => {
                    const negative = isNegativeIntent(blockIntentFor(item.type, item.properties));
                    return section.id === "delivery" ? negative || section.types.includes(item.type as BlockKind) : !negative && section.types.includes(item.type as BlockKind);
                  });
                  const sectionLabel = section.id === "references" && hasNonImageReference ? "References" : section.label;
                  const sectionDescription = section.id === "references" && hasNonImageReference ? "References that make intent concrete" : section.description;
                  return html`<section class=${`creative-plan-section creative-plan-section--${section.id}`}>
                    <header><div><h3>${this.i18n.system(sectionLabel)}</h3><p>${this.i18n.system(sectionDescription)}</p></div><button aria-label=${this.i18n.system("Add to {label}", { label: this.i18n.system(sectionLabel) })} @click=${() => section.starter === "reference" ? this.querySelector<HTMLInputElement>(".creative-reference-tool input")?.click() : this.#openCreate(section.starter)}>${icon("plus")}</button></header>
                    <div>${items.length ? items.map((item) => this.#itemCard(item)) : html`<button class="creative-section-empty" @click=${() => section.starter === "reference" ? this.querySelector<HTMLInputElement>(".creative-reference-tool input")?.click() : this.#openCreate(section.starter)}>Add ${this.i18n.system(FRIENDLY_LABELS[section.starter]).toLocaleLowerCase(this.i18n.locale)}</button>`}</div>
                  </section>`;
                })}
              </div>
            </section>
          </main>

          <aside class=${`creative-editor-inspector ${selectedIsExclusion ? "negative-constraint" : ""}`} aria-label="Selected item settings">
            ${selected ? html`<form @submit=${(event: SubmitEvent) => this.#save(event, selected)} @keydown=${(event:KeyboardEvent)=>{if(event.isComposing)return;if(event.key==="Enter"&&(event.metaKey||event.ctrlKey)){event.preventDefault();event.stopPropagation();(event.currentTarget as HTMLFormElement).requestSubmit();}else if(event.key==="Escape"){event.preventDefault();event.stopPropagation();const form=event.currentTarget as HTMLFormElement;form.querySelector("forma-output-input-editor")?.reset();const rich=form.querySelector<HTMLElementTagNameMap["forma-ui-rich-text"]>('forma-ui-rich-text[name="copy"]');if(rich){rich.value=textFor(selected);const textarea=rich.querySelector("textarea");if(textarea)textarea.value=textFor(selected);rich.requestUpdate();}const textarea=form.querySelector<HTMLTextAreaElement>('textarea[name="copy"]');if(textarea)textarea.value=textFor(selected);const type=form.querySelector<HTMLSelectElement>('select[name="item-type"]'),intent=form.querySelector<HTMLSelectElement>('select[name="item-intent"]');if(type)type.value=selected.type;if(intent)intent.value=blockIntentFor(selected.type,selected.properties);for(const radio of form.querySelectorAll<HTMLInputElement>('input[name="strength"]'))radio.checked=radio.value===strengthFor(Number(selected.properties.weight??.65));this.#selectedId=selected.id;this.store.patchUi({focusBlockId:selected.id,editingBlockId:""});this.requestUpdate();void this.updateComplete.then(()=>this.querySelector<HTMLButtonElement>(".creative-editor-item.selected .creative-editor-item-main")?.focus({preventScroll:true}));}}}>
              <header><span>${selectedIsExclusion ? this.i18n.system("Guardrail selected") : this.i18n.system("Selected")}</span><h2>${selectedIntent==="include"?this.i18n.system(selectedLabel):this.i18n.system("{intent} {type}",{intent:this.i18n.system(intentCopy(selectedIntent)),type:this.i18n.system(selectedLabel).toLocaleLowerCase(this.i18n.locale)})}</h2><p>${selectedIsExclusion ? this.i18n.system("This is a negative {value} constraint. It tells the preview what must not appear; it never becomes a positive focus.", { value: this.i18n.system(selectedLabel).toLocaleLowerCase(this.i18n.locale) }) : this.i18n.system("Change the role, intent, wording, and influence of this decision.")}</p></header>
              ${selected.type === "reference" && isImageReference(selected.properties) && selected.properties.media_url ? html`<forma-reference-image class="creative-inspector-image" .src=${String(selected.properties.media_url)} .alt=${textFor(selected)} .targetId=${selected.id} .referenceId=${String(selected.properties.reference_id??"")} .focalPoint=${selected.properties.focal_point}></forma-reference-image>` : nothing}
              ${selected.type === "reference" && !isImageReference(selected.properties) ? html`<div class="creative-inspector-source" data-reference-medium=${referenceMedium(selected.properties)}><span>${icon(referenceMedium(selected.properties)==="audio"?"audio":referenceMedium(selected.properties)==="video"?"video":"document")}</span><blockquote>${String(selected.properties.source_excerpt??selected.properties.text??selected.properties.description??selected.properties.label??"")}</blockquote></div>` : nothing}
              ${selected.type==="audio"?html`${renderAudioPlayer(String(selected.properties.media_url??""),String(selected.properties.label??selected.handle),this.i18n,{transcript:String(selected.properties.transcript??selected.properties.lyrics??"")})}<fieldset class="audio-permissions" ?disabled=${selected.locked}><legend>${this.i18n.t("artifact.audio.label","Audio")}</legend>${([{"path":"inform_generation","key":"inform"},{"path":"include_in_output","key":"include"},{"path":"allow_provider_audio_transfer","key":"transfer"}] as const).map(({path,key})=>{const hint=`editor-audio-${selected.id}-${key}`;return html`<label class="audio-permission"><input type="checkbox" aria-describedby=${hint} .checked=${selected.properties[path]===true} @change=${(event:Event)=>void this.store.append({type:"BlockPropertyEdited",payload:{block_id:selected.id,property_path:path,old_value:selected.properties[path]===true,new_value:(event.currentTarget as HTMLInputElement).checked,source_surface:"creative-editor"}})}><span><b>${this.i18n.t(`audio.use.${key}.label`,"")}</b><small id=${hint}>${this.i18n.t(`audio.use.${key}.description`,"")}</small></span></label>`;})}</fieldset>`:nothing}
              ${selected.type === "reference" && isImageReference(selected.properties) ? html`<forma-reference-pixel-policy .block=${selected} surface="editor" compact></forma-reference-pixel-policy>` : nothing}
              <label><span>Role in the plan</span><select name="item-type" ?disabled=${selected.locked||selected.type==="audio"&&Boolean(selected.properties.media_url)}>${BLOCK_TYPES.map((item) => html`<option value=${item.type} ?selected=${item.type === selected.type}>${this.i18n.system(FRIENDLY_LABELS[item.type])}</option>`)}</select></label>
              <label><span>Intent</span><select name="item-intent" ?disabled=${selected.locked}>${BLOCK_INTENTS.map((intent) => html`<option value=${intent.id} ?selected=${intent.id === selectedIntent}>${this.i18n.system(intent.label)} · ${this.i18n.system(intent.description)}</option>`)}</select></label>
              <div class="creative-role-intent-summary"><b>${this.i18n.system(intentCopy(selectedIntent))} · ${this.i18n.system(selectedLabel)}</b><small>${localizedSpatialScopeLabel(selected.properties.spatial_scope,this.i18n)}</small></div>
              ${selected.type==="audio"&&selected.properties.media_url?html`<label><span>${this.i18n.t("audio.reference.description","Describe what you hear")}</span><textarea name="copy" rows="6" .value=${String(selected.properties.description??"")} ?disabled=${selected.locked}></textarea></label>`:outputInputDraft(selected)?html`<forma-output-input-editor .block=${selected} source="creative-editor"></forma-output-input-editor>`:selected.properties.source_artifact_item_id||selected.properties.source_output_id?html`<forma-ui-rich-text name="copy" .label=${selected.properties.source_artifact_item_id?selected.properties.source_artifact_kind==="video"?this.i18n.system("Video scene direction"):this.i18n.system("Storyboard shot direction"):this.i18n.system("Image direction")} .value=${textFor(selected)} .rows=${7} ?disabled=${selected.locked}></forma-ui-rich-text>`:html`<label><span>${selectedIsExclusion ? this.i18n.system("What must the work avoid?") : this.i18n.system("What should it say?")}</span><textarea name="copy" rows="6" .value=${textFor(selected)} ?disabled=${selected.locked}></textarea></label>`}
              <fieldset ?disabled=${selected.locked}>
                <legend>${selectedIsExclusion ? this.i18n.system("How strictly should it be excluded?") : this.i18n.system("How much should it lead?")}</legend>
                ${(selectedIsExclusion ? [["supporting", "Gentle"], ["balanced", "Standard"], ["lead", "Strict"]] : [["supporting", "Supporting"], ["balanced", "Balanced"], ["lead", "Lead"]]).map(([value, label]) => html`<label><input type="radio" name="strength" value=${value} .checked=${strengthFor(Number(selected.properties.weight ?? .65)) === value}><span>${label}</span></label>`)}
              </fieldset>
              <button class="button primary" ?disabled=${selected.locked}>${selectedIsExclusion ? this.i18n.system("Save guardrail") : this.i18n.system("Save changes")}</button>
              <div class="creative-inspector-order"><button type="button" @click=${() => this.#move(selected, -1)}>${icon("up")} Earlier</button><button type="button" @click=${() => this.#move(selected, 1)}>${icon("down")} Later</button></div>
              <div class="creative-inspector-actions">
                <button type="button" @click=${() => this.#protect(selected)}>${selected.locked ? this.i18n.system("Allow changes") : this.i18n.system("Protect from changes")}</button>
                <button type="button" @click=${() => this.#duplicate(selected)}>Make a copy</button>
                <button type="button" class="danger" @click=${() => this.#remove(selected)}>Remove</button>
              </div>
            </form><forma-spatial-scope-editor .block=${selected} surface="editor"></forma-spatial-scope-editor>` : html`<div class="creative-inspector-empty"><span>${icon("spark")}</span><h2>Start anywhere</h2><p>Add a goal, subject, look, or reference. Select it on the page whenever you want to refine it.</p><button class="button primary" @click=${() => this.#openCreate()}>Add context</button></div>`}
          </aside>
        </div>
      </section>

      ${this.#creating ? html`<dialog class="modal creative-add-dialog" closedby="any" aria-labelledby="creative-add-title" @click=${(event: MouseEvent) => { if (event.target === event.currentTarget) this.#closeCreate(); }} @cancel=${(event: Event) => { event.preventDefault(); this.#closeCreate(); }}>
        <form class="modal-card creative-add-card" @submit=${this.#create}>
          <button type="button" class="icon-button modal-close" aria-label="Close" @click=${this.#closeCreate}>${icon("close")}</button>
          <h2 id="creative-add-title">Add context</h2><p>${isNegativeIntent(this.#newIntent) ? this.i18n.system("Choose what kind of decision this is, then name what must stay out. The role remains explicit while the intent compiles as a negative guardrail.") : this.i18n.system("Choose what the instruction concerns and how the plan should treat it. You can change both later.")}</p>
          <label><span>Role in the plan</span><select @change=${(event: Event) => { this.#newType = (event.target as HTMLSelectElement).value as BlockKind; this.requestUpdate(); }}>${BLOCK_TYPES.filter((item) => item.type !== "reference").map((item) => html`<option value=${item.type} ?selected=${item.type === this.#newType}>${this.i18n.system(FRIENDLY_LABELS[item.type])}</option>`)}</select></label>
          <label><span>Intent</span><select @change=${(event: Event) => { this.#newIntent = (event.target as HTMLSelectElement).value as BlockIntent; this.requestUpdate(); }}>${BLOCK_INTENTS.map((intent) => html`<option value=${intent.id} ?selected=${intent.id === this.#newIntent}>${this.i18n.system(intent.label)} · ${this.i18n.system(intent.description)}</option>`)}</select></label>
          <label><span>${isNegativeIntent(this.#newIntent) ? this.i18n.system("What {value} must be excluded?", { value: this.i18n.system(FRIENDLY_LABELS[this.#newType]).toLocaleLowerCase(this.i18n.locale) }) : this.i18n.system("Your instruction")}</span><textarea autofocus required rows="4" placeholder=${isNegativeIntent(this.#newIntent) ? this.#newType==="subject"?this.i18n.system("For example: people under 20 years old"):this.i18n.system("For example: an unwanted {type}",{type:this.i18n.system(FRIENDLY_LABELS[this.#newType]).toLocaleLowerCase(this.i18n.locale)}) : this.i18n.system(blockTypeDefinition(this.#newType)?.prompt ?? "")} .value=${this.#newText} @input=${(event: InputEvent) => { this.#newText = (event.target as HTMLTextAreaElement).value; this.requestUpdate(); }}></textarea></label>
          <fieldset><legend>${isNegativeIntent(this.#newIntent) ? this.i18n.system("How strongly should this guardrail apply?") : this.i18n.system("How much should it lead?")}</legend>${(isNegativeIntent(this.#newIntent) ? [["supporting", "Gentle"], ["balanced", "Standard"], ["lead", "Strict"]] : [["supporting", "Supporting"], ["balanced", "Balanced"], ["lead", "Lead"]]).map(([value, label]) => html`<label><input type="radio" name="new-strength" value=${value} .checked=${this.#newStrength === value} @change=${() => { this.#newStrength = value; this.requestUpdate(); }}><span>${this.i18n.system(label)}</span></label>`)}</fieldset>
          <footer><button type="button" class="button ghost" @click=${this.#closeCreate}>Cancel</button><button class="button primary" ?disabled=${!this.#newText.trim()}>Add context</button></footer>
        </form>
      </dialog>` : nothing}

      ${this.#pendingReference ? html`<dialog class="modal creative-reference-dialog" closedby="any" aria-labelledby="creative-reference-title" @click=${(event: MouseEvent) => { if (event.target === event.currentTarget && !this.#uploading) this.#cancelReference(); }} @cancel=${(event: Event) => { event.preventDefault(); if (!this.#uploading) this.#cancelReference(); }}>
        <form class="modal-card creative-reference-card" @submit=${(event:SubmitEvent)=>{event.preventDefault();if(this.#rightsConfirmed&&!this.#uploading)void this.#confirmReference();}}>
          <button type="button" class="icon-button modal-close" aria-label="Close" ?disabled=${this.#uploading} @click=${this.#cancelReference}>${icon("close")}</button>
          <span class="eyebrow">${audioMimeType(this.#pendingReference.type)?this.i18n.t("audio.reference.private","Private audio reference"):this.i18n.system("Add a visual reference")}</span><h2 id="creative-reference-title">${audioMimeType(this.#pendingReference.type)?this.i18n.t("audio.reference.description","Describe what you hear"):this.i18n.system("Use this image in the plan?")}</h2>
          <div class="creative-reference-receipt"><span>${icon(audioMimeType(this.#pendingReference.type)?"audio":"image")}</span><div><b>${this.#pendingReference.name}</b><small>${(this.#pendingReference.size / 1_048_576).toFixed(1)} MB</small></div></div>
          <p>${audioMimeType(this.#pendingReference.type)?this.i18n.t("audio.use.inform.description","Use only your written description to shape images, stories, presentations, video, and music."):this.i18n.system("The editor will prepare color, mood, layout, material, lighting, and spatial cues. You choose which ones become part of the plan.")}</p>
          <label class="rights-check"><input type="checkbox" aria-describedby="creative-reference-rights-hint" .checked=${this.#rightsConfirmed} @change=${(event: Event) => { this.#rightsConfirmed = (event.target as HTMLInputElement).checked; this.requestUpdate(); }}><span><b>${audioMimeType(this.#pendingReference.type)?this.i18n.system("I own this source or have a license that permits this use."):this.i18n.system("I own this image or have permission to use it.")}</b><small id="creative-reference-rights-hint">${audioMimeType(this.#pendingReference.type)?this.i18n.t("audio.upload.rightsNotice","I also confirm this recording contains no sensitive information. Upload remains private; creative influence, accompaniment, and provider transfer each require separate approval."):this.i18n.system("In a controlled pilot, I also confirm it contains no sensitive information. This confirmation stays with the image wherever it is reused.")}</small></span></label>
          <footer><button type="button" class="button ghost" ?disabled=${this.#uploading} @click=${this.#cancelReference}>Cancel</button><button type="submit" class="button primary" ?disabled=${!this.#rightsConfirmed || this.#uploading}>${audioMimeType(this.#pendingReference.type)?this.#uploading?this.i18n.system("Uploading securely…"):this.i18n.t("artifact.audio.label","Audio"):this.#uploading?this.i18n.system("Adding image…"):this.i18n.system("Add image")}</button></footer>
        </form>
      </dialog>` : nothing}
    `;
    return this.shell("editor", "Creative editor", "Shape the brief, scene, look, and guardrails in one familiar workspace. The system keeps the underlying history organized for you.", body, { continuity: false, inspector: false, quietRail: true });
  }
}

customElements.define("forma-creative-editor", FormaCreativeEditor);
