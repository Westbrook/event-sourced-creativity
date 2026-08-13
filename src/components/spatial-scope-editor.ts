import { html, nothing } from "lit";
import type { CreativeBlock } from "../model/events";
import { WHOLE_DOCUMENT_SCOPE, formatSpatialPath, normalizeSpatialScope, parseSpatialPath, spatialScopeLabel, type SpatialScope, type SpatialScopeKind } from "../model/spatial-scope";
import { FormaElement, icon } from "./forma-element";
import { focalPointCss } from "../model/focal-point";
import { positionImageAtFocalPoint } from "../model/image-focus";

const kinds: Array<{ id: SpatialScopeKind; label: string; help: string }> = [
  { id: "document", label: "Everything", help: "Apply across the complete document." },
  { id: "region", label: "Named area", help: "Use a familiar or loosely described part." },
  { id: "aabb", label: "Rectangle", help: "Use an exact normalized bounding box." },
  { id: "subject", label: "Subject", help: "Follow a subject as its position changes." },
  { id: "path", label: "Custom shape", help: "Use a user-defined clipping path." },
];
const regions: Array<NonNullable<SpatialScope["region"]>> = ["left", "right", "top", "bottom", "center", "foreground", "background", "edges", "custom"];

type PreviewGesture =
  | { kind: "draw-box"; pointerId: number; start: { x: number; y: number } }
  | { kind: "move-box"; pointerId: number; start: { x: number; y: number }; box: NonNullable<SpatialScope["aabb"]> }
  | { kind: "resize-box"; pointerId: number; handle: BoxHandle; box: NonNullable<SpatialScope["aabb"]> }
  | { kind: "move-path-point"; pointerId: number; index: number; points: NonNullable<SpatialScope["path"]> }
  | { kind: "draw-path"; pointerId: number; points: Array<{ x: number; y: number }> };
type BoxHandle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const minimumBoxSize = .01;
const boxHandles: Array<{ id: BoxHandle; label: string; x: number; y: number }> = [
  { id: "nw", label: "top left corner", x: 0, y: 0 },
  { id: "n", label: "top edge", x: .5, y: 0 },
  { id: "ne", label: "top right corner", x: 1, y: 0 },
  { id: "e", label: "right edge", x: 1, y: .5 },
  { id: "se", label: "bottom right corner", x: 1, y: 1 },
  { id: "s", label: "bottom edge", x: .5, y: 1 },
  { id: "sw", label: "bottom left corner", x: 0, y: 1 },
  { id: "w", label: "left edge", x: 0, y: .5 },
];

function resizeBox(box: NonNullable<SpatialScope["aabb"]>, handle: BoxHandle, point: { x: number; y: number }) {
  let left = box.x; let top = box.y; let right = box.x + box.width; let bottom = box.y + box.height;
  if (handle.includes("w")) left = Math.min(clamp01(point.x), right - minimumBoxSize);
  if (handle.includes("e")) right = Math.max(clamp01(point.x), left + minimumBoxSize);
  if (handle.includes("n")) top = Math.min(clamp01(point.y), bottom - minimumBoxSize);
  if (handle.includes("s")) bottom = Math.max(clamp01(point.y), top + minimumBoxSize);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export class SpatialScopeEditor extends FormaElement {
  static properties = { block: { attribute: false } };
  block!: CreativeBlock;
  #open = false;
  #draft: SpatialScope = { ...WHOLE_DOCUMENT_SCOPE };
  #pathDraft = "";
  #directTool: "rectangle" | "freeform" = "rectangle";
  #gesture: PreviewGesture | null = null;

  protected override updated() {
    const dialog = this.querySelector<HTMLDialogElement>(".spatial-scope-dialog");
    if (this.#open && dialog && !dialog.open) dialog.showModal();
  }

  #openEditor() {
    if (this.block.locked) return;
    this.#draft = normalizeSpatialScope(this.block.properties.spatial_scope);
    this.#pathDraft = formatSpatialPath(this.#draft.path);
    this.#directTool = this.#draft.kind === "path" ? "freeform" : "rectangle";
    this.#open = true;
    this.requestUpdate();
  }

  #close() {
    this.querySelector<HTMLDialogElement>(".spatial-scope-dialog")?.close();
    this.#open = false;
    this.requestUpdate();
  }

  #set(patch: Partial<SpatialScope>) {
    this.#draft = normalizeSpatialScope({ ...this.#draft, ...patch });
    this.requestUpdate();
  }

  #setKind(kind: SpatialScopeKind) {
    const defaults: Record<SpatialScopeKind, Partial<SpatialScope>> = {
      document: WHOLE_DOCUMENT_SCOPE,
      region: { kind, region: "right", instruction: "", feather: .2, falloff: "contextual", polarity: "inside" },
      aabb: { kind, aabb: { x: .2, y: .2, width: .6, height: .6 }, feather: 0, falloff: "hard", polarity: "inside" },
      subject: { kind, subject_block_id: "", subject_relation: "around", feather: .2, falloff: "contextual", polarity: "inside" },
      path: { kind, path: [{ x: .2, y: .2 }, { x: .8, y: .2 }, { x: .7, y: .8 }, { x: .25, y: .72 }], feather: 0, falloff: "hard", polarity: "inside" },
    };
    this.#draft = normalizeSpatialScope(defaults[kind]);
    this.#pathDraft = kind === "path" ? formatSpatialPath(this.#draft.path) : "";
    if (kind === "aabb") this.#directTool = "rectangle";
    if (kind === "path") this.#directTool = "freeform";
    this.requestUpdate();
  }

  #previewPoint(event: PointerEvent) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: clamp01((event.clientX - rect.left) / rect.width), y: clamp01((event.clientY - rect.top) / rect.height) };
  }

  #startPreviewGesture(event: PointerEvent) {
    if (event.button !== 0) return;
    const canvas = event.currentTarget as HTMLElement;
    const point = this.#previewPoint(event);
    const target = event.target as HTMLElement;
    canvas.setPointerCapture(event.pointerId);
    const boxHandle = target.closest<HTMLElement>("[data-box-handle]")?.dataset.boxHandle as BoxHandle | undefined;
    const pathPoint = target.closest<HTMLElement>("[data-path-point]")?.dataset.pathPoint;
    const pathEdge = target.closest<HTMLElement>("[data-path-edge]")?.dataset.pathEdge;
    if (boxHandle && this.#draft.kind === "aabb") {
      this.#gesture = { kind: "resize-box", pointerId: event.pointerId, handle: boxHandle, box: this.#draft.aabb ?? { x: .2, y: .2, width: .6, height: .6 } };
    } else if (pathPoint !== undefined && this.#draft.kind === "path") {
      this.#gesture = { kind: "move-path-point", pointerId: event.pointerId, index: Number(pathPoint), points: [...(this.#draft.path ?? [])] };
    } else if (pathEdge !== undefined && this.#draft.kind === "path") {
      const points = [...(this.#draft.path ?? [])];
      const insertAt = Number(pathEdge) + 1;
      points.splice(insertAt, 0, point);
      this.#setPathPoints(points);
      this.#gesture = { kind: "move-path-point", pointerId: event.pointerId, index: insertAt, points };
    } else if (this.#directTool === "freeform") {
      this.#gesture = { kind: "draw-path", pointerId: event.pointerId, points: [point] };
      this.#draft = { ...normalizeSpatialScope({ ...this.#draft, kind: "path" }), kind: "path", path: [point] };
      this.#pathDraft = formatSpatialPath([point]);
    } else if (this.#draft.kind === "aabb" && target.closest(".spatial-target-overlay")) {
      this.#gesture = { kind: "move-box", pointerId: event.pointerId, start: point, box: this.#draft.aabb ?? { x: .2, y: .2, width: .6, height: .6 } };
    } else {
      this.#gesture = { kind: "draw-box", pointerId: event.pointerId, start: point };
      this.#draft = normalizeSpatialScope({ ...this.#draft, kind: "aabb", aabb: { x: point.x, y: point.y, width: 0, height: 0 } });
    }
    this.requestUpdate();
  }

  #movePreviewGesture(event: PointerEvent) {
    const gesture = this.#gesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const point = this.#previewPoint(event);
    if (gesture.kind === "draw-box") {
      this.#draft = normalizeSpatialScope({ ...this.#draft, kind: "aabb", aabb: { x: Math.min(gesture.start.x, point.x), y: Math.min(gesture.start.y, point.y), width: Math.abs(point.x - gesture.start.x), height: Math.abs(point.y - gesture.start.y) } });
    } else if (gesture.kind === "move-box") {
      const dx = point.x - gesture.start.x; const dy = point.y - gesture.start.y;
      this.#draft = normalizeSpatialScope({ ...this.#draft, kind: "aabb", aabb: { ...gesture.box, x: Math.max(0, Math.min(1 - gesture.box.width, gesture.box.x + dx)), y: Math.max(0, Math.min(1 - gesture.box.height, gesture.box.y + dy)) } });
    } else if (gesture.kind === "resize-box") {
      this.#draft = normalizeSpatialScope({ ...this.#draft, kind: "aabb", aabb: resizeBox(gesture.box, gesture.handle, point) });
    } else if (gesture.kind === "move-path-point") {
      const points = [...gesture.points];
      points[gesture.index] = point;
      this.#setPathPoints(points);
    } else {
      const previous = gesture.points.at(-1)!;
      if (Math.hypot(point.x - previous.x, point.y - previous.y) >= .015) gesture.points.push(point);
      this.#draft = { ...this.#draft, kind: "path", path: [...gesture.points] };
      this.#pathDraft = formatSpatialPath(gesture.points);
    }
    this.requestUpdate();
  }

  #endPreviewGesture(event: PointerEvent) {
    if (!this.#gesture || this.#gesture.pointerId !== event.pointerId) return;
    const canvas = event.currentTarget as HTMLElement;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    this.#gesture = null;
    this.requestUpdate();
  }

  #describeArea(value: string) {
    this.#draft = normalizeSpatialScope({ ...this.#draft, kind: "region", region: "custom", instruction: value, falloff: "contextual", feather: Math.max(.2, this.#draft.feather) });
    this.requestUpdate();
  }

  #editPath(value: string) {
    this.#pathDraft = value;
    const path = parseSpatialPath(value);
    if (path.length >= 3) this.#draft = { ...this.#draft, path };
    this.requestUpdate();
  }

  #setPathPoints(points: NonNullable<SpatialScope["path"]>) {
    this.#draft = { ...this.#draft, kind: "path", path: points };
    this.#pathDraft = formatSpatialPath(points);
  }

  #nudgeBoxHandle(event: KeyboardEvent, handle: BoxHandle) {
    const horizontal = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    const vertical = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if ((!horizontal && !vertical) || horizontal && !/[ew]/.test(handle) || vertical && !/[ns]/.test(handle)) return;
    event.preventDefault();
    const box = this.#draft.aabb ?? { x: .2, y: .2, width: .6, height: .6 };
    const step = event.shiftKey ? .05 : .01;
    const point = {
      x: handle.includes("w") ? box.x : handle.includes("e") ? box.x + box.width : box.x + box.width / 2,
      y: handle.includes("n") ? box.y : handle.includes("s") ? box.y + box.height : box.y + box.height / 2,
    };
    this.#draft = normalizeSpatialScope({ ...this.#draft, kind: "aabb", aabb: resizeBox(box, handle, { x: point.x + horizontal * step, y: point.y + vertical * step }) });
    this.requestUpdate();
  }

  #nudgePathPoint(event: KeyboardEvent, index: number, edge = false) {
    const horizontal = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    const vertical = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (!horizontal && !vertical) return;
    event.preventDefault();
    const points = [...(this.#draft.path ?? [])];
    if (edge) {
      const next = points[(index + 1) % points.length];
      const current = points[index];
      points.splice(index + 1, 0, { x: (current.x + next.x) / 2, y: (current.y + next.y) / 2 });
      index += 1;
    }
    const step = event.shiftKey ? .05 : .01;
    points[index] = { x: clamp01(points[index].x + horizontal * step), y: clamp01(points[index].y + vertical * step) };
    this.#setPathPoints(points);
    this.requestUpdate();
  }

  #box(key: "x" | "y" | "width" | "height", percent: number) {
    this.#set({ aabb: { ...(this.#draft.aabb ?? { x: .2, y: .2, width: .6, height: .6 }), [key]: percent / 100 } });
  }

  #subjectLabel(id = this.#draft.subject_block_id) {
    const block = this.store.projection.get().blocks.find((item) => item.id === id);
    return block ? String(block.properties.text ?? block.properties.label ?? block.handle) : "subject";
  }

  #previewStyle() {
    const scope = this.#draft;
    if (scope.kind === "aabb") {
      const box = scope.aabb ?? { x: .2, y: .2, width: .6, height: .6 };
      return `left:${box.x * 100}%;top:${box.y * 100}%;width:${box.width * 100}%;height:${box.height * 100}%`;
    }
    if (scope.kind === "path") return `inset:0;clip-path:polygon(${(scope.path ?? []).map((point) => `${point.x * 100}% ${point.y * 100}%`).join(",")})`;
    const boxes: Record<string, string> = { left: "inset:0 50% 0 0", right: "inset:0 0 0 50%", top: "inset:0 0 50% 0", bottom: "inset:50% 0 0 0", center: "inset:22% 22%", foreground: "inset:52% 8% 8%", background: "inset:8% 8% 52%", edges: "inset:8%", custom: "inset:18% 10% 28% 42%" };
    if (scope.kind === "region") return boxes[scope.region ?? "center"];
    if (scope.kind === "subject") return "left:38%;top:20%;width:28%;height:58%;border-radius:48% 48% 30% 30%";
    return "inset:0";
  }

  #shapeHandles() {
    if (this.#draft.kind === "aabb") {
      const box = this.#draft.aabb ?? { x: .2, y: .2, width: .6, height: .6 };
      return boxHandles.map((handle) => html`<button type="button" class=${`spatial-shape-handle spatial-shape-handle--box spatial-shape-handle--${handle.id} ${handle.id.length === 1 ? "edge" : "corner"}`} data-box-handle=${handle.id} style=${`left:${(box.x + box.width * handle.x) * 100}%;top:${(box.y + box.height * handle.y) * 100}%`} aria-label=${`Resize the ${handle.label}. Use arrow keys for one-percent steps; hold Shift for five-percent steps.`} @keydown=${(event: KeyboardEvent) => this.#nudgeBoxHandle(event, handle.id)}></button>`);
    }
    if (this.#draft.kind === "path") {
      const points = this.#draft.path ?? [];
      return html`${points.map((point, index) => {
        const next = points[(index + 1) % points.length];
        return html`<button type="button" class="spatial-shape-handle spatial-shape-handle--path-edge edge" data-path-edge=${index} style=${`left:${(point.x + next.x) * 50}%;top:${(point.y + next.y) * 50}%`} aria-label=${`Pull edge ${index + 1} to add a new corner. Use arrow keys for one-percent steps; hold Shift for five-percent steps.`} @keydown=${(event: KeyboardEvent) => this.#nudgePathPoint(event, index, true)}></button>`;
      })}${points.map((point, index) => html`<button type="button" class="spatial-shape-handle spatial-shape-handle--path-point corner" data-path-point=${index} style=${`left:${point.x * 100}%;top:${point.y * 100}%`} aria-label=${`Move shape corner ${index + 1}. Use arrow keys for one-percent steps; hold Shift for five-percent steps.`} @keydown=${(event: KeyboardEvent) => this.#nudgePathPoint(event, index)}></button>`)}`;
    }
    return nothing;
  }

  async #save() {
    const oldValue = normalizeSpatialScope(this.block.properties.spatial_scope);
    const newValue = normalizeSpatialScope(this.#draft);
    if (JSON.stringify(oldValue) === JSON.stringify(newValue)) return this.#close();
    const appended = await this.store.append({ type: "BlockPropertyEdited", payload: { block_id: this.block.id, property_path: "spatial_scope", old_value: oldValue, new_value: newValue, source_surface: this.getAttribute("surface") || "spatial-scope-editor" } });
    if (appended.length) this.#close();
  }

  override render() {
    if (!this.block) return nothing;
    const scope = normalizeSpatialScope(this.block.properties.spatial_scope);
    const subjects = this.store.projection.get().blocks.filter((item) => item.type === "subject" && item.id !== this.block.id);
    const label = spatialScopeLabel(scope, this.#subjectLabel(scope.subject_block_id));
    const pathValid = this.#draft.kind !== "path" || parseSpatialPath(this.#pathDraft).length >= 3;
    const boxValid = this.#draft.kind !== "aabb" || (this.#draft.aabb?.width ?? 0) >= .01 && (this.#draft.aabb?.height ?? 0) >= .01;
    const targetValid = pathValid && boxValid;
    const latest=this.store.projection.get().outputs[0];
    const blockPreview=String(this.block.properties.media_url??"");
    const previewUrl=blockPreview||latest?.mediaUrl||"";
    const dimensions=this.block.properties.dimensions&&typeof this.block.properties.dimensions==="object"?this.block.properties.dimensions as Record<string,unknown>:null;
    const previewWidth=Number(dimensions?.width??latest?.width??4);
    const previewHeight=Number(dimensions?.height??latest?.height??3);
    const previewFocal=blockPreview?this.block.properties.focal_point:latest?.focalPoint;
    return html`<div class=${`spatial-scope-control spatial-scope-control--${this.getAttribute("surface") || "default"}`}>
      <button type="button" class="spatial-scope-trigger" ?disabled=${this.block.locked} aria-label=${`Change affected area, currently ${label}`} @click=${this.#openEditor}><span aria-hidden="true">⌗</span><span><small>Affects</small><b>${label}</b></span>${icon("edit")}</button>
      ${this.#open ? html`<dialog class="modal spatial-scope-dialog" closedby="any" aria-labelledby=${`spatial-scope-title-${this.block.id}`} @click=${(event: MouseEvent) => { if (event.target === event.currentTarget) this.#close(); }} @cancel=${(event: Event) => { event.preventDefault(); this.#close(); }}>
        <div class="modal-card spatial-scope-card">
          <button type="button" class="icon-button modal-close" aria-label="Close affected area editor" @click=${this.#close}>${icon("close")}</button>
          <div class="spatial-scope-intro"><span class="eyebrow">Where this decision applies</span><h2 id=${`spatial-scope-title-${this.block.id}`}>Place this decision in the image</h2><p><b>${String(this.block.properties.text??this.block.properties.label??this.block.handle)}</b> can shape the whole image or only the area you choose. Draw directly on the preview for speed; use the controls for semantic relationships or precise refinement.</p></div>
          <div class="spatial-scope-scroll"><div class="spatial-scope-layout">
            <section class="spatial-scope-fields">
              <fieldset class="spatial-kind-picker"><legend>1 · Choose how the area should follow the composition</legend>${kinds.map((kind,index) => html`<label><input type="radio" name=${`scope-kind-${this.block.id}`} value=${kind.id} .checked=${this.#draft.kind === kind.id} @change=${() => this.#setKind(kind.id)}><span><i aria-hidden="true">${index+1}</i><b>${kind.label}</b><small>${kind.help}</small></span></label>`)}</fieldset>
              ${this.#draft.kind === "region" ? html`<fieldset class="spatial-region-fields"><legend>2 · Pick the area people naturally refer to</legend><div class="spatial-region-picker">${regions.map((region)=>html`<button type="button" aria-pressed=${this.#draft.region===region} @click=${()=>this.#set({region})}>${region[0].toUpperCase()+region.slice(1)}</button>`)}</div>${this.#draft.region === "custom" ? html`<label>Describe the implied area<input placeholder="For example: the quiet area behind the subject" .value=${this.#draft.instruction ?? ""} @input=${(event: InputEvent) => this.#set({ instruction: (event.target as HTMLInputElement).value })}><small>The generator receives this language together with the selected falloff.</small></label>` : nothing}</fieldset>` : nothing}
              ${this.#draft.kind === "aabb" ? html`<details class="spatial-precision"><summary>Fine-tune the drawn rectangle with numbers</summary><div class="spatial-method-fields spatial-box-fields">${(["x", "y", "width", "height"] as const).map((key) => html`<label>${key === "x" ? "Left" : key === "y" ? "Top" : key[0].toUpperCase() + key.slice(1)} %<input type="number" min="0" max="100" .value=${String(Math.round((this.#draft.aabb?.[key] ?? 0) * 100))} @input=${(event: InputEvent) => this.#box(key, Number((event.target as HTMLInputElement).value))}></label>`)}</div></details>` : nothing}
              ${this.#draft.kind === "subject" ? html`<div class="spatial-method-fields"><label>Follow subject<select .value=${this.#draft.subject_block_id ?? ""} @change=${(event: Event) => this.#set({ subject_block_id: (event.target as HTMLSelectElement).value })}><option value="">Nearest implied subject</option>${subjects.map((subject) => html`<option value=${subject.id}>${this.#subjectLabel(subject.id)}</option>`)}</select></label><label>Relationship<select .value=${this.#draft.subject_relation ?? "around"} @change=${(event: Event) => this.#set({ subject_relation: (event.target as HTMLSelectElement).value as SpatialScope["subject_relation"] })}><option value="inside">Inside its silhouette</option><option value="around">Around it</option><option value="in-front-of">In front of it</option><option value="behind">Behind it</option></select></label></div>` : nothing}
              ${this.#draft.kind === "path" ? html`<details class="spatial-precision"><summary>Review or edit the drawn path as coordinates</summary><div class="spatial-method-fields"><label>Polygon points <small>x,y percentages separated by spaces; use at least three points</small><textarea rows="3" aria-invalid=${pathValid ? "false" : "true"} .value=${this.#pathDraft} @input=${(event: InputEvent) => this.#editPath((event.target as HTMLTextAreaElement).value)}></textarea>${pathValid ? nothing : html`<small class="spatial-path-error">Add at least three valid x,y points before saving.</small>`}</label></div></details>` : nothing}
              ${this.#draft.kind !== "document" ? html`<fieldset class="spatial-edge-settings"><legend>3 · Decide what the boundary means</legend><label><span>Apply the decision</span><select .value=${this.#draft.polarity} @change=${(event: Event) => this.#set({ polarity: (event.target as HTMLSelectElement).value as SpatialScope["polarity"] })}><option value="inside">Inside the selected area</option><option value="outside">Everywhere outside it</option></select></label><label><span>Blend at the edge</span><select .value=${this.#draft.falloff} @change=${(event: Event) => this.#set({ falloff: (event.target as HTMLSelectElement).value as SpatialScope["falloff"] })}><option value="hard">Hard boundary</option><option value="soft">Soft transition</option><option value="contextual">Let composition decide</option></select></label><label><span>Feather</span><output>${Math.round(this.#draft.feather * 100)}%</output><input aria-label="Feather amount" type="range" min="0" max="1" step=".05" .value=${String(this.#draft.feather)} @input=${(event: InputEvent) => this.#set({ feather: Number((event.target as HTMLInputElement).value) })}></label></fieldset>` : nothing}
            </section>
            <aside class="spatial-scope-preview"><span>Draw directly on ${previewUrl?blockPreview?"the reference":"the latest generation":"the document preview"}</span><div class="spatial-direct-tools" role="toolbar" aria-label="Preview drawing tool"><button type="button" aria-pressed=${this.#directTool === "rectangle"} @click=${() => { this.#directTool = "rectangle"; this.requestUpdate(); }}>Rectangle</button><button type="button" aria-pressed=${this.#directTool === "freeform"} @click=${() => { this.#directTool = "freeform"; this.requestUpdate(); }}>Freeform</button></div><div class=${`spatial-preview-canvas ${this.#gesture ? "drawing" : ""}`} style=${`aspect-ratio:${previewWidth}/${previewHeight}`} aria-label=${this.#directTool === "rectangle" ? "Drag to draw an affected rectangle. Drag the selected rectangle to move it or use its edge and corner handles to resize it." : "Drag to draw a freeform affected area, then pull its corners or edges to refine it."} @pointerdown=${this.#startPreviewGesture} @pointermove=${this.#movePreviewGesture} @pointerup=${this.#endPreviewGesture} @pointercancel=${this.#endPreviewGesture}>${previewUrl?html`<img src=${previewUrl} alt="Preview used to position this decision" style=${focalPointCss(previewFocal)} @load=${(event:Event)=>positionImageAtFocalPoint(event.currentTarget as HTMLImageElement,previewFocal)}>`:html`<i></i><i></i>`}<b class=${`spatial-target-overlay ${this.#draft.polarity === "outside" ? "outside" : ""}`} style=${this.#previewStyle()}></b>${this.#shapeHandles()}<small>${this.#draft.kind === "aabb" ? "Drag the selection to move it. Pull an edge or corner to resize it." : this.#draft.kind === "path" ? "Drag a corner to reshape it, or pull an edge midpoint to add detail." : this.#directTool === "rectangle" ? "Drag anywhere to draw a rectangle." : "Drag around the area to draw a clipping shape."}</small></div><label class="spatial-preview-language"><span>Or describe it in words</span><input placeholder="e.g. the quiet space behind the subject" .value=${this.#draft.kind === "region" && this.#draft.region === "custom" ? this.#draft.instruction ?? "" : ""} @input=${(event: InputEvent) => this.#describeArea((event.target as HTMLInputElement).value)}></label><div class="spatial-preview-summary" aria-live="polite"><strong>${spatialScopeLabel(this.#draft, this.#subjectLabel())}</strong><p>${this.#draft.kind === "document" ? "This decision shapes the complete composition." : `${this.#draft.polarity === "outside" ? "Everything outside" : "Only content inside"} this target receives the decision, with ${this.#draft.falloff} falloff.`}</p></div></aside>
          </div>
          ${boxValid ? nothing : html`<p class="spatial-target-error">Drag a rectangle with visible width and height before saving.</p>`}</div>
          <footer class="spatial-scope-actions"><button type="button" class="spatial-reset" @click=${()=>this.#setKind("document")}>Use whole image</button><span></span><button type="button" class="button ghost" @click=${this.#close}>Cancel</button><button type="button" class="button primary" ?disabled=${!targetValid} @click=${this.#save}>Apply to this decision</button></footer>
        </div>
      </dialog>` : nothing}
    </div>`;
  }
}

customElements.define("forma-spatial-scope-editor", SpatialScopeEditor);

declare global { interface HTMLElementTagNameMap { "forma-spatial-scope-editor": SpatialScopeEditor } }
