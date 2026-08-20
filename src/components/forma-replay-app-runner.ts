import { html, nothing } from "lit";
import { FormaElement, icon } from "./forma-element";
import type { CreativeEvent, CreativeProjection } from "../model/events";
import type { ReplaySurface } from "../model/replay-runner";
import { foldCanvasEvents } from "../canvas/model";
import "./output-visual";

const value = (input: unknown) => String(input ?? "").trim();

export class FormaReplayAppRunner extends FormaElement {
  static properties = {
    events: { attribute: false },
    projection: { attribute: false },
    sequence: { type: Number },
    event: { attribute: false },
    surface: { attribute: false },
  };

  events: CreativeEvent[] = [];
  projection?: CreativeProjection;
  sequence = 0;
  event?: CreativeEvent;
  surface?: ReplaySurface;

  #targetIds() {
    const payload = this.event?.payload ?? {};
    return new Set(["project_id", "document_id", "block_id", "collection_id", "object_id", "item_id", "proposal_id", "condition_id", "observation_id"].map((key) => value(payload[key])).filter(Boolean));
  }

  #targetClass(...ids: unknown[]) {
    const targets = this.#targetIds();
    return ids.some((id) => targets.has(value(id))) ? "is-replay-target" : "";
  }

  #navigationActive(label: string, surface: ReplaySurface) {
    if (surface.application === "creative") {
      if (surface.kind === "projects") return label === "Projects";
      if (surface.kind === "project" || surface.kind === "document") return label === "Studio";
      if (surface.kind === "library") return label === "Library";
      if (surface.kind === "sessions") return label === "Sessions";
      if (surface.kind === "scout") return label === "Scout";
      if (surface.kind === "memory") return label === "Taste & time";
    }
    if (surface.application === "canvas") {
      if (surface.label.includes("Compare")) return label === "Compare";
      if (surface.label.includes("List")) return label === "List";
      if (surface.label.includes("Folders")) return label === "Folders";
      return label === "Spatial";
    }
    return surface.kind === "operations" && label === "Event operations";
  }

  #outputVisual(output: CreativeProjection["outputs"][number], compact = false) {
    const simulatedMedia = output.mediaUrl?.includes("replay%2Fgenerated") || output.mediaUrl?.includes("/replay/generated");
    if (simulatedMedia) return html`<div class="replay-app-simulated-image ${compact ? "compact" : ""}" role="img" aria-label="Simulated generated image"><span>${icon("image")}</span><b>${output.quality === "low" ? "Draft image" : "Generated image"}</b><small>Replay fixture</small></div>`;
    return html`<forma-output-visual ?compact=${compact} .output=${output}></forma-output-visual>`;
  }

  #projects(projection: CreativeProjection) {
    const projects = projection.projects.length ? projection.projects : projection.projectId ? [{ id: projection.projectId, name: projection.projectName, state: projection.projectState, documentCount: projection.documents.length, collectionCount: projection.collections.length, blockCount: projection.blocks.length, outputCount: projection.outputs.length, sourceEvents: [] }] : [];
    return html`<div class="replay-app-gallery">${projects.length ? projects.map((project) => html`<article class=${this.#targetClass(project.id)}><span>${project.state}</span><h4>${project.name}</h4><p>${project.documentCount} documents · ${project.outputCount} images</p><small>${project.collectionCount} collections · ${project.blockCount} context blocks</small></article>`) : this.#empty("The first project has not been created yet.")}</div>`;
  }

  #project(projection: CreativeProjection) {
    return html`<div class="replay-app-gallery">${projection.documents.length ? projection.documents.map((document) => html`<article class=${this.#targetClass(document.id)}><span>${document.removed ? "Removed" : "Document"}</span><h4>${document.title}</h4><p>${projection.blocks.filter((block) => block.documentId === document.id).length} context blocks</p><small>${projection.outputs.filter((output) => output.documentId === document.id).length} generations</small></article>`) : this.#empty("The project does not contain a document at this point in the replay.")}</div>`;
  }

  #document(projection: CreativeProjection, surface: ReplaySurface) {
    const documentId = value(this.event?.payload.document_id) || projection.documentId;
    const blocks = projection.blocks.filter((block) => !documentId || block.documentId === documentId);
    const outputs = projection.outputs.filter((output) => !documentId || output.documentId === documentId);
    const output = outputs.at(-1);
    return html`<div class="replay-app-document">
      <section class="replay-app-context"><header><div><small>${blocks.length} active decisions</small><h4>Creative context</h4></div><span>${surface.view === "chat" ? "Resolved from conversation" : surface.label}</span></header><div>${blocks.slice(-7).map((block) => html`<article class=${this.#targetClass(block.id)}><span>${block.type}</span><b>${block.handle}</b><p>${value(block.properties.text ?? block.properties.label ?? block.properties.value) || "Context saved for generation."}</p></article>`)}</div>${blocks.length ? nothing : this.#empty("A blank document is ready for its first decision.")}</section>
      <section class="replay-app-output"><header><div><small>${outputs.length} generated ${outputs.length === 1 ? "image" : "images"}</small><h4>${surface.view === "chat" ? "Current generation" : "Visual result"}</h4></div>${output ? html`<span>${output.quality === "low" ? "Draft" : "Full quality"}</span>` : nothing}</header><div class="replay-app-output-stage ${this.#targetClass(output?.id)}">${output ? this.#outputVisual(output) : html`<div class="replay-app-output-empty">${icon("image")}<b>No image yet</b><span>Generation results will appear here as their completion events land.</span></div>`}</div></section>
    </div>`;
  }

  #library(projection: CreativeProjection) {
    const blocks = projection.libraryBlocks;
    const outputs = projection.libraryOutputs;
    return html`<div class="replay-app-library"><section><header><small>Reusable context</small><h4>Blocks</h4></header>${blocks.length ? blocks.slice(-6).map((block) => html`<article class=${this.#targetClass(block.id)}><span>${block.type}</span><b>${block.handle}</b></article>`) : this.#empty("No reusable blocks yet.")}</section><section><header><small>Retained work</small><h4>Images and families</h4></header><div class="replay-app-thumbnails">${outputs.slice(-4).map((output) => html`<div class=${this.#targetClass(output.id)}>${this.#outputVisual(output, true)}<small>${output.quality === "low" ? "Draft" : "Full"}</small></div>`)}</div>${outputs.length ? nothing : this.#empty("No images have been added to the Library yet.")}<p>${projection.families.length} aesthetic ${projection.families.length === 1 ? "family" : "families"}</p></section></div>`;
  }

  #sessions(projection: CreativeProjection) {
    const brief = projection.brief ?? this.event?.payload ?? {};
    const items = Array.isArray(brief.items) ? brief.items as Array<Record<string, unknown>> : [];
    return html`<div class="replay-app-brief"><div><small>Resume with context</small><h4>Re-entry brief</h4><p>${projection.sessionOpen ? "The current working session remains open." : "The prior session has been summarized without changing the document."}</p></div><ol>${items.length ? items.map((item) => html`<li class=${this.#targetClass(item.item_id)}><b>${value(item.item_type) || "Suggested return point"}</b><span>${value(item.label ?? item.summary) || "Open the most relevant document state."}</span></li>`) : html`<li><b>${value(this.event?.payload.title) || "Session boundary"}</b><span>${value(this.event?.payload.reason) || "The replay is preparing the next useful return point."}</span></li>`}</ol></div>`;
  }

  #scout() {
    const payload = this.event?.payload ?? {};
    return html`<div class="replay-app-report"><span>Bounded observation</span><h4>${value(payload.label ?? payload.title) || "Scout is examining adjacent possibilities"}</h4><p>${value(payload.summary) || "A report-space observation can be reviewed without silently changing creative direction."}</p><dl><div><dt>Confidence</dt><dd>${typeof payload.confidence === "number" ? `${Math.round(payload.confidence * 100)}%` : "Pending"}</dd></div><div><dt>Authority</dt><dd>Report only</dd></div></dl></div>`;
  }

  #memory(projection: CreativeProjection) {
    const rows = [...projection.preferences, ...projection.conditions];
    return html`<div class="replay-app-memory"><header><small>Reversible evidence</small><h4>Taste & time</h4><p>Inferred ranking support stays separate from authored creative context.</p></header><div>${rows.length ? rows.slice(-6).map((row) => html`<article class=${this.#targetClass(row.preference_id, row.condition_id, row.claim_ref)}><span>${value(row.axis ?? row.kind ?? "evidence")}</span><b>${value(row.value ?? row.label ?? row.claim_ref) || "Recorded preference"}</b><small>${value(row.authority ?? row.status ?? "reviewable")}</small></article>`) : this.#empty("No memory evidence exists at this point in the replay.")}</div></div>`;
  }

  #operations() {
    const recent = this.events.slice(0, this.sequence).slice(-8).reverse();
    return html`<div class="replay-app-operations"><header><small>Durable data</small><h4>Event operations</h4><p>Technical receipts remain inspectable while the creative UI stays focused on outcomes.</p></header><div>${recent.map((event) => html`<article class=${event.eventId === this.event?.eventId ? "is-replay-target" : ""}><span>#${event.sequence}</span><b>${event.type.replace(/([a-z])([A-Z])/g, "$1 $2")}</b><small>${event.actor}</small></article>`)}</div></div>`;
  }

  #canvas(projection: CreativeProjection) {
    const applied = this.events.slice(0, this.sequence);
    const canvasId = value(this.event?.payload.canvas_id);
    const canvas = foldCanvasEvents(applied, projection.projectId, canvasId);
    return html`<div class="replay-app-canvas"><div class="replay-app-canvas-toolbar"><span>${canvas.items.length} items</span><span>${canvas.arrangements.length} saved arrangements</span><span>${canvas.contextSets.length} context sets</span><span>${canvas.proposals.filter((proposal) => proposal.status === "open").length} open proposals</span></div><div class="replay-app-canvas-plane">${canvas.items.length ? canvas.items.map((item) => html`<article class=${this.#targetClass(item.id, item.sourceId)} style=${`--runner-x:${Math.max(2, Math.min(74, item.x / 12))}%;--runner-y:${Math.max(3, Math.min(68, item.y / 10))}%;--runner-w:${Math.max(18, Math.min(34, item.w / 12))}%`}><small>${item.sourceKind}</small><b>${item.title}</b><p>${item.body || "Shared project reality"}</p></article>`) : this.#empty("The canvas is ready for its first shared item.")}</div></div>`;
  }

  #empty(message: string) { return html`<div class="replay-app-empty"><span>${icon("plus")}</span><p>${message}</p></div>`; }

  #content(projection: CreativeProjection, surface: ReplaySurface) {
    if (surface.kind === "projects") return this.#projects(projection);
    if (surface.kind === "project") return this.#project(projection);
    if (surface.kind === "document") return this.#document(projection, surface);
    if (surface.kind === "library") return this.#library(projection);
    if (surface.kind === "sessions") return this.#sessions(projection);
    if (surface.kind === "scout") return this.#scout();
    if (surface.kind === "memory") return this.#memory(projection);
    if (surface.kind === "canvas") return this.#canvas(projection);
    return this.#operations();
  }

  override render() {
    const projection = this.projection;
    const surface = this.surface;
    if (!projection || !surface) return html`<div class="replay-app-runner-empty"><span>${icon("play")}</span><b>The app runner is waiting at scenario start.</b><p>Advance to the first user-visible event to see the corresponding interface.</p></div>`;
    const navigation: Record<ReplaySurface["application"], string[]> = { creative: ["Projects", "Studio", "Library", "Sessions", "Scout", "Taste & time"], canvas: ["Canvases", "Spatial", "List", "Compare", "Folders"], operations: ["System", "Event operations", "Permissions"] };
    return html`<section class="replay-app-runner-frame" aria-label="Replayed application surface">
      <header class="replay-app-chrome"><div class="replay-app-brand"><span>F</span><b>Creative system</b></div><nav aria-label="Replayed application"><span class=${surface.application === "creative" ? "active" : ""}>Creative</span><span class=${surface.application === "canvas" ? "active" : ""}>Canvas</span><span class=${surface.application === "operations" ? "active" : ""}>Operations</span></nav><code>${surface.route}</code></header>
      <div class="replay-app-shell"><aside><b>${surface.application === "creative" ? projection.projectName : surface.application === "canvas" ? "Canvas" : "Administration"}</b><nav>${navigation[surface.application].map((label) => html`<span class=${this.#navigationActive(label, surface) ? "active" : ""}>${label}</span>`)}</nav></aside><main><header class="replay-app-page-header"><div><small>${surface.application} / ${surface.label}</small><h3>${surface.kind === "document" ? projection.documentTitle : surface.label}</h3><p>${surface.targetLabel}</p></div><span class="replay-app-live-marker">Following step #${this.event?.sequence ?? this.sequence}</span></header><div class="replay-app-page-body">${this.#content(projection, surface)}</div></main></div>
      <footer><span><b>${this.event?.actor ?? "system"}</b> ${this.event?.type.replace(/([a-z])([A-Z])/g, "$1 $2") ?? "Scenario start"}</span><span>The runner is read-only; state comes from the replay projection.</span></footer>
    </section>`;
  }
}

customElements.define("forma-replay-app-runner", FormaReplayAppRunner);
