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
      if (surface.kind === "project" || surface.kind === "document" || surface.kind === "artifact") return label === "Studio";
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
    if(surface.application==="laboratory")return surface.label.includes("Design")?label==="Design system":surface.label.includes("adapter")?label==="Image adapters":surface.label.includes("Focal")?label==="Focal points":label==="Replay";
    return surface.kind === "operations" && (surface.label.includes("analytics")?label==="Analytics":surface.label.includes("governance")?label==="System":surface.label.includes("permissions")?label==="Permissions":label==="Event operations");
  }

  #outputVisual(output: CreativeProjection["outputs"][number], compact = false) {
    const simulatedMedia = output.mediaUrl?.includes("replay%2Fgenerated") || output.mediaUrl?.includes("/replay/generated");
    if (simulatedMedia) return html`<div class="replay-app-simulated-image ${compact ? "compact" : ""}" role="img" aria-label="Simulated generated image"><span>${icon("image")}</span><b>${output.quality === "low" ? this.i18n.system("Draft image") : this.i18n.system("Generated image")}</b><small>Replay fixture</small></div>`;
    return html`<forma-output-visual ?compact=${compact} .output=${output}></forma-output-visual>`;
  }

  #projects(projection: CreativeProjection) {
    const projects = projection.projects.length ? projection.projects : projection.projectId ? [{ id: projection.projectId, name: projection.projectName, state: projection.projectState, documentCount: projection.documents.length, collectionCount: projection.collections.length, blockCount: projection.blocks.length, outputCount: projection.libraryOutputs.length+projection.libraryArtifacts.length, sourceEvents: [] }] : [];
    return html`<div class="replay-app-gallery">${projects.length ? projects.map((project) => html`<article class=${this.#targetClass(project.id)}><span>${project.state}</span><h4>${project.name}</h4><p>${project.documentCount} documents · ${project.outputCount} creative ${project.outputCount===1?this.i18n.system("result"):this.i18n.system("results")}</p><small>${project.collectionCount} collections · ${project.blockCount} context blocks</small></article>`) : this.#empty("The first project has not been created yet.")}</div>`;
  }

  #project(projection: CreativeProjection) {
    return html`<div class="replay-app-gallery">${projection.documents.length ? projection.documents.map((document) => {const count=projection.libraryOutputs.filter((output)=>output.documentId===document.id).length+projection.libraryArtifacts.filter((artifact)=>artifact.documentId===document.id).length;return html`<article class=${this.#targetClass(document.id)}><span>${document.removed ? this.i18n.system("Removed") : this.i18n.system("Document")}</span><h4>${document.title}</h4><p>${projection.blocks.filter((block) => block.documentId === document.id).length} context blocks</p><small>${count} creative ${count===1?this.i18n.system("result"):this.i18n.system("results")}</small></article>`;}) : this.#empty("The project does not contain a document at this point in the replay.")}</div>`;
  }

  #document(projection: CreativeProjection, surface: ReplaySurface) {
    const documentId = value(this.event?.payload.document_id) || projection.documentId;
    const blocks = projection.blocks.filter((block) => !documentId || block.documentId === documentId);
    const outputs = projection.outputs.filter((output) => !documentId || output.documentId === documentId);
    const artifacts = projection.artifacts.filter((artifact) => !documentId || artifact.documentId === documentId);
    const output = outputs.at(-1);
    return html`<div class="replay-app-document">
      <section class="replay-app-context"><header><div><small>${blocks.length} active decisions</small><h4>Creative context</h4></div><span>${surface.view === "chat" ? this.i18n.system("Resolved from conversation") : surface.label}</span></header><div>${blocks.slice(-7).map((block) => html`<article class=${this.#targetClass(block.id)}><span>${block.type}</span><b>${block.handle}</b><p>${value(block.properties.text ?? block.properties.label ?? block.properties.value) || this.i18n.system("Context saved for generation.")}</p></article>`)}</div>${blocks.length ? nothing : this.#empty("A blank document is ready for its first decision.")}</section>
      <section class="replay-app-output"><header><div><small>${outputs.length} ${outputs.length === 1 ? this.i18n.system("image") : this.i18n.system("images")} · ${artifacts.length} ${artifacts.length === 1 ? this.i18n.system("deliverable") : this.i18n.system("deliverables")}</small><h4>${surface.view === "chat" ? this.i18n.system("Current creative work") : artifacts.length&&!output?this.i18n.system("Finished deliverable"):this.i18n.system("Creative results")}</h4></div>${output ? html`<span>${output.quality === "low" ? this.i18n.system("Draft") : this.i18n.system("Full quality")}</span>` : nothing}</header><div class="replay-app-output-stage ${this.#targetClass(output?.id??artifacts.at(-1)?.id)}">${output ? this.#outputVisual(output) : artifacts.length?html`<div class="replay-app-report"><span>${artifacts.at(-1)!.kind.replaceAll("_"," ")}</span><h4>${artifacts.at(-1)!.title}</h4><p>${artifacts.at(-1)!.summary||this.i18n.system("Ready to review from the shared creative context.")}</p></div>`:html`<div class="replay-app-output-empty">${icon("spark")}<b>No creative result yet</b><span>Images, stories, presentations, and other deliverables appear as they are completed.</span></div>`}</div>${artifacts.length?html`<div class="replay-app-artifact-list" aria-label="Document deliverables">${artifacts.slice(-6).map((artifact)=>html`<article class=${this.#targetClass(artifact.id)}><span>${artifact.kind.replaceAll("_"," ")}</span><b>${artifact.title}</b><small>${artifact.items.length} ${artifact.items.length===1?this.i18n.system("part"):this.i18n.system("parts")}</small></article>`)}</div>`:nothing}</section>
    </div>`;
  }

  #library(projection: CreativeProjection) {
    const blocks = projection.libraryBlocks;
    const outputs = projection.libraryOutputs;
    const artifacts=projection.libraryArtifacts;
    return html`<div class="replay-app-library"><section><header><small>Reusable context</small><h4>Blocks</h4></header>${blocks.length ? blocks.slice(-6).map((block) => html`<article class=${this.#targetClass(block.id)}><span>${block.type}</span><b>${block.handle}</b></article>`) : this.#empty("No reusable blocks yet.")}</section><section><header><small>Retained work</small><h4>Images, stories, and deliverables</h4></header><div class="replay-app-thumbnails">${outputs.slice(-4).map((output) => html`<div class=${this.#targetClass(output.id)}>${this.#outputVisual(output, true)}<small>${output.quality === "low" ? this.i18n.system("Draft") : this.i18n.system("Full")}</small></div>`)}</div>${outputs.length||artifacts.length ? nothing : this.#empty("No creative results have been added to the Library yet.")}${artifacts.length?html`<div class="replay-app-artifact-list">${artifacts.slice(-6).map((artifact)=>html`<article class=${this.#targetClass(artifact.id)}><span>${artifact.kind.replaceAll("_"," ")}</span><b>${artifact.title}</b></article>`)}</div>`:nothing}<p>${projection.families.length} aesthetic ${projection.families.length === 1 ? this.i18n.system("family") : this.i18n.system("families")}</p></section></div>`;
  }

  #artifact(projection: CreativeProjection) {
    const payload=this.event?.payload??{};const artifactId=value(payload.artifact_id);const artifact=projection.libraryArtifacts.find((item)=>item.id===artifactId)??projection.artifacts.find((item)=>item.id===artifactId);const blocked=this.event?.type==="DocumentRenderFailed";
    if(blocked)return html`<div class="replay-app-report"><span>${payload.video_mock_boundary===true?this.i18n.system("Treatment available"):this.i18n.system("Work needs attention")}</span><h4>${payload.video_mock_boundary===true?this.i18n.system("Video plan ready — rendering requires separate approval"):this.i18n.system("This result could not be completed")}</h4><p>${value(payload.error_message??payload.reason)||this.i18n.system("Review the retained evidence before choosing whether to try again.")}</p><dl><div><dt>Requested format</dt><dd>${value(payload.artifact_kind).replaceAll("_"," ")}</dd></div><div><dt>Authority</dt><dd>Explicit creator decision required</dd></div></dl></div>`;
    if(!artifact)return this.#empty("This deliverable has been requested and will appear when its completion receipt lands.");
    return html`<div class="replay-app-report"><span>${artifact.kind.replaceAll("_"," ")} · ${artifact.items.length} ${artifact.items.length===1?this.i18n.system("part"):this.i18n.system("parts")}</span><h4>${artifact.title}</h4><p>${artifact.summary||this.i18n.system("A purposeful deliverable generated from the same authored creative context.")}</p><div class="replay-app-artifact-list">${artifact.items.slice(0,4).map((item)=>html`<article><b>${item.title}</b><p>${item.body}</p></article>`)}</div></div>`;
  }

  #laboratory() {
    return html`<div class="replay-app-report"><span>Controlled experiment</span><h4>${this.surface?.label??this.i18n.system("Replay laboratory")}</h4><p>Inspect realistic creative journeys, unfinished goals, and many purposeful outputs without changing a creator’s work or authorizing provider spending.</p><dl><div><dt>Workflow</dt><dd>${value(this.event?.payload.workflow_id)||this.i18n.system("Read-only rehearsal")}</dd></div><div><dt>Authority</dt><dd>Laboratory only</dd></div></dl></div>`;
  }

  #sessions(projection: CreativeProjection) {
    const brief = projection.brief ?? this.event?.payload ?? {};
    const items = Array.isArray(brief.items) ? brief.items as Array<Record<string, unknown>> : [];
    return html`<div class="replay-app-brief"><div><small>Resume with context</small><h4>Re-entry brief</h4><p>${projection.sessionOpen ? this.i18n.system("The current working session remains open.") : this.i18n.system("The prior session has been summarized without changing the document.")}</p></div><ol>${items.length ? items.map((item) => html`<li class=${this.#targetClass(item.item_id)}><b>${value(item.item_type) || this.i18n.system("Suggested return point")}</b><span>${value(item.label ?? item.summary) || this.i18n.system("Open the most relevant document state.")}</span></li>`) : html`<li><b>${value(this.event?.payload.title) || this.i18n.system("Session boundary")}</b><span>${value(this.event?.payload.reason) || this.i18n.system("The replay is preparing the next useful return point.")}</span></li>`}</ol></div>`;
  }

  #scout() {
    const payload = this.event?.payload ?? {};
    return html`<div class="replay-app-report"><span>Bounded observation</span><h4>${value(payload.label ?? payload.title) || this.i18n.system("Scout is examining adjacent possibilities")}</h4><p>${value(payload.summary) || this.i18n.system("A report-space observation can be reviewed without silently changing creative direction.")}</p><dl><div><dt>Confidence</dt><dd>${typeof payload.confidence === "number" ? `${Math.round(payload.confidence * 100)}%` : this.i18n.system("Pending")}</dd></div><div><dt>Authority</dt><dd>Report only</dd></div></dl></div>`;
  }

  #memory(projection: CreativeProjection) {
    const rows = [...projection.preferences, ...projection.conditions];
    return html`<div class="replay-app-memory"><header><small>Reversible evidence</small><h4>Taste & time</h4><p>Inferred ranking support stays separate from authored creative context.</p></header><div>${rows.length ? rows.slice(-6).map((row) => html`<article class=${this.#targetClass(row.preference_id, row.condition_id, row.claim_ref)}><span>${value(row.axis ?? row.kind ?? "evidence")}</span><b>${value(row.value ?? row.label ?? row.claim_ref) || this.i18n.system("Recorded preference")}</b><small>${value(row.authority ?? row.status ?? "reviewable")}</small></article>`) : this.#empty("No memory evidence exists at this point in the replay.")}</div></div>`;
  }

  #operations() {
    const recent = this.events.slice(0, this.sequence).slice(-8).reverse();
    return html`<div class="replay-app-operations"><header><small>Durable data</small><h4>Event operations</h4><p>Technical receipts remain inspectable while the creative UI stays focused on outcomes.</p></header><div>${recent.map((event) => html`<article class=${event.eventId === this.event?.eventId ? "is-replay-target" : ""}><span>#${event.sequence}</span><b>${event.type.replace(/([a-z])([A-Z])/g, "$1 $2")}</b><small>${event.actor}</small></article>`)}</div></div>`;
  }

  #canvas(projection: CreativeProjection) {
    const applied = this.events.slice(0, this.sequence);
    const canvasId = value(this.event?.payload.canvas_id);
    const canvas = foldCanvasEvents(applied, projection.projectId, canvasId);
    return html`<div class="replay-app-canvas"><div class="replay-app-canvas-toolbar"><span>${canvas.items.length} items</span><span>${canvas.arrangements.length} saved arrangements</span><span>${canvas.contextSets.length} context sets</span><span>${canvas.proposals.filter((proposal) => proposal.status === "open").length} open proposals</span></div><div class="replay-app-canvas-plane">${canvas.items.length ? canvas.items.map((item) => html`<article class=${this.#targetClass(item.id, item.sourceId)} style=${`--runner-x:${Math.max(2, Math.min(74, item.x / 12))}%;--runner-y:${Math.max(3, Math.min(68, item.y / 10))}%;--runner-w:${Math.max(18, Math.min(34, item.w / 12))}%`}><small>${item.sourceKind}</small><b>${item.title}</b><p>${item.body || this.i18n.system("Shared project reality")}</p></article>`) : this.#empty("The canvas is ready for its first shared item.")}</div></div>`;
  }

  #empty(message: string) { return html`<div class="replay-app-empty"><span>${icon("plus")}</span><p>${message}</p></div>`; }

  #content(projection: CreativeProjection, surface: ReplaySurface) {
    if (surface.kind === "projects") return this.#projects(projection);
    if (surface.kind === "project") return this.#project(projection);
    if (surface.kind === "document") return this.#document(projection, surface);
    if (surface.kind === "artifact") return this.#artifact(projection);
    if (surface.kind === "library") return this.#library(projection);
    if (surface.kind === "sessions") return this.#sessions(projection);
    if (surface.kind === "scout") return this.#scout();
    if (surface.kind === "memory") return this.#memory(projection);
    if (surface.kind === "canvas") return this.#canvas(projection);
    if (surface.kind === "laboratory") return this.#laboratory();
    return this.#operations();
  }

  override render() {
    const projection = this.projection;
    const surface = this.surface;
    if (!projection || !surface) return html`<div class="replay-app-runner-empty"><span>${icon("play")}</span><b>The app runner is waiting at scenario start.</b><p>Advance to the first user-visible event to see the corresponding interface.</p></div>`;
    const navigation: Record<ReplaySurface["application"], string[]> = { creative: ["Projects", "Studio", "Library", "Sessions", "Scout", "Taste & time"], canvas: ["Canvases", "Spatial", "List", "Compare", "Folders"], operations: ["System", "Analytics", "Event operations", "Permissions"], laboratory:["Replay","Image adapters","Focal points","Design system"] };
    return html`<section class="replay-app-runner-frame" aria-label="Replayed application surface">
      <header class="replay-app-chrome"><div class="replay-app-brand"><span>F</span><b>Creative system</b></div><nav aria-label="Replayed application"><span class=${surface.application === "creative" ? "active" : ""}>Creative</span><span class=${surface.application === "canvas" ? "active" : ""}>Canvas</span><span class=${surface.application === "operations" ? "active" : ""}>Operations</span><span class=${surface.application === "laboratory" ? "active" : ""}>Laboratory</span></nav><code>${surface.route}</code></header>
      <div class="replay-app-shell"><aside><b>${surface.application === "creative" ? projection.projectName : surface.application === "canvas" ? "Canvas" : surface.application==="laboratory"?this.i18n.system("Laboratory"):this.i18n.system("Administration")}</b><nav>${navigation[surface.application].map((label) => html`<span class=${this.#navigationActive(label, surface) ? "active" : ""}>${this.i18n.system(label)}</span>`)}</nav></aside><main><header class="replay-app-page-header"><div><small>${surface.application} / ${surface.label}</small><h3>${surface.kind === "document" ? projection.documentTitle : surface.label}</h3><p>${surface.targetLabel}</p></div><span class="replay-app-live-marker">Following step #${this.event?.sequence ?? this.sequence}</span></header><div class="replay-app-page-body">${this.#content(projection, surface)}</div></main></div>
      <footer><span><b>${this.event?.actor ?? this.i18n.system("system")}</b> ${this.event?.type.replace(/([a-z])([A-Z])/g, "$1 $2") ?? this.i18n.system("Scenario start")}</span><span>The runner is read-only; state comes from the replay projection.</span></footer>
    </section>`;
  }
}

if (!customElements.get("forma-replay-app-runner")) customElements.define("forma-replay-app-runner", FormaReplayAppRunner);
