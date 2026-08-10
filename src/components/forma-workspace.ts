import { html, nothing } from "lit";
import { FormaElement, icon } from "./forma-element";
import { contextDiff, foldEvents, shortEventType, type EventInput } from "../model/events";
import "./context-block";
import "./collection-tree";
import "./output-card";

export class FormaWorkspace extends FormaElement {
  #prompt = "";
  #proposal: { prompt: string; events: EventInput[]; proposalId?: string } | null = null;
  #uploading = false;

  #addBlock() {
    void this.store.append({ type: "BlockCreated", payload: { block_id: crypto.randomUUID(), type: "direction", handle: `direction/study-${this.store.head.get()+1}`, position: `z${String(this.store.head.get()+1).padStart(4,"0")}`, properties: { text: "Describe a new direction", weight: .64, authority: "authored" } } });
  }
  async #upload(event: Event) {
    const input = event.target as HTMLInputElement; const file = input.files?.[0]; if (!file) return;
    this.#uploading = true; this.requestUpdate();
    try {
      const form = new FormData(); form.append("file", file); const response = await fetch("/api/media", { method: "POST", body: form }); const media = await response.json() as { key?: string; url?: string; error?: string };
      if (!response.ok) throw new Error(media.error ?? "Upload failed");
      const ref = crypto.randomUUID(); const block = crypto.randomUUID();
      await this.store.appendBatch([
        { type: "ReferenceIngested", payload: { reference_id: ref, source_type: "upload", source_ref: media.url, content_hash: media.key, rights_class: "unknown" } },
        { type: "BlockCreated", payload: { block_id: block, type: "reference", handle: `reference/${file.name.replace(/\W+/g,"-").toLowerCase()}`, position: `z${this.store.head.get()}`, properties: { reference_id: ref, label: file.name, media_url: media.url, weight: .72, authority: "authored" } } },
      ]); this.store.toast("Reference stored in R2 and appended to the document.");
    } catch (error) { this.store.toast(error instanceof Error ? error.message : "Upload failed"); }
    this.#uploading = false; this.requestUpdate(); input.value = "";
  }
  async #ask() {
    const prompt = this.#prompt.trim(); if (!prompt) return;
    const p = this.store.projection.get(); const palette = p.blocks.find((b) => b.type === "palette");
    const events: EventInput[] = /warm/i.test(prompt) && palette ? [{ type: "BlockPropertyEdited", payload: { block_id: palette.id, property_path: "temperature", old_value: palette.properties.temperature ?? "neutral", new_value: "warmer" } }] : [{ type: "BlockCreated", payload: { block_id: crypto.randomUUID(), type: "direction", handle: `direction/chat-${this.store.head.get()}`, position: `z${this.store.head.get()}`, properties: { text: prompt, authority: "authored", weight: .7 } } }];
    const proposal = await this.store.propose(prompt, events); this.#proposal = { prompt, events, proposalId: proposal?.eventId }; this.#prompt = ""; this.requestUpdate();
  }
  async #acceptProposal() {
    if (!this.#proposal) return; const proposal = this.#proposal;
    await this.store.appendBatch([{ type: "ProposalAccepted", payload: { proposal_event_id: proposal.proposalId, expected_sequence: this.store.head.get() } }, ...proposal.events]); this.#proposal = null; this.requestUpdate();
  }
  async #rejectProposal() {
    if (!this.#proposal) return; await this.store.append({ type: "ProposalRejected", payload: { proposal_event_id: this.#proposal.proposalId, reason_ref: null } }); this.#proposal = null; this.requestUpdate();
  }
  #renameProject() {
    const p = this.store.projection.get(); const next = window.prompt("Rename project", p.projectName)?.trim();
    if (next && next !== p.projectName) void this.store.append({ type: "ProjectRenamed", payload: { project_id: p.projectId, old_name: p.projectName, new_name: next } });
  }
  #compare() {
    const out = this.store.projection.get().outputs.slice(0,2); if (out.length < 2) return this.store.toast("Generate one more output to compare.");
    void this.store.append({ type: "ComparisonOpened", payload: { object_ids: out.map((o) => o.id), source_surface: "studio" } }); this.store.patchUi({ compareOpen: true });
  }

  #comparison() {
    const events = this.store.events.get(); const completed = events.filter((e) => e.type === "GenerationCompleted"); const rightSeq = completed.at(-1)?.sequence ?? this.store.head.get(); const leftSeq = completed.at(-2)?.sequence ?? Math.max(1, rightSeq - 3);
    const left = foldEvents(events, leftSeq); const right = foldEvents(events, rightSeq); const diff = contextDiff(left, right); const outputs = this.store.projection.get().outputs.slice(0,2);
    return html`<dialog class="modal comparison-modal" open aria-labelledby="compare-title"><div class="modal-card wide"><button class="icon-button modal-close" aria-label="Close comparison" @click=${() => this.store.patchUi({ compareOpen:false })}>${icon("close")}</button><span class="eyebrow">Decision frontier · witnessed</span><h2 id="compare-title">Compare two event-derived states</h2><div class="comparison-grid">${outputs.map((o,i) => html`<div><div class="output-art variant-${o.variant % 4}"><span class="art-glow"></span><span class="art-frame"></span><span class="art-vase"></span><span class="art-table"></span></div><b>${i ? "Previous" : "Current"} · ${o.id}</b></div>`)}</div><div class="diff-list"><h3>Context diff</h3>${diff.length ? diff.map((d) => html`<div><span class="status-dot ${d.status}"></span><b>${d.id}</b><span>${d.status}</span></div>`) : html`<p>No block changes — this comparison isolates generator variance.</p>`}</div></div></dialog>`;
  }
  #inspector() {
    const event = this.store.events.get().find((e) => e.eventId === this.store.ui.selectedEventId) ?? this.store.events.get().at(-1);
    if (!event) return nothing;
    return html`<aside class="inspector-panel" aria-label="Provenance inspector"><header><div><span class="eyebrow">Projection source</span><h2>${shortEventType(event.type)}</h2></div><button class="icon-button" aria-label="Close inspector" @click=${() => this.store.patchUi({ inspectorOpen:false })}>${icon("close")}</button></header><dl><dt>Sequence</dt><dd>#${event.sequence}</dd><dt>Actor</dt><dd>${event.actor}</dd><dt>Client</dt><dd>${event.clientId}</dd><dt>Correlation</dt><dd>${event.correlationId}</dd><dt>Authority</dt><dd>${event.actor === "user" ? "authored" : "inferred / operational"}</dd></dl><h3>Folded payload</h3><pre>${JSON.stringify(event.payload,null,2)}</pre><div class="inspector-actions"><button @click=${() => this.store.setRoute("/admin/events")}>Open in event admin ${icon("arrow")}</button><button @click=${() => navigator.clipboard.writeText(event.eventId)}>Copy event ID</button></div></aside>`;
  }

  override render() {
    const p = this.store.projection.get(); const output = p.outputs[0];
    return html`<section class="workspace-page">
      <aside class="studio-sidebar">
        <div class="project-switcher"><span class="eyebrow">Current project</span><button @click=${this.#renameProject}><b>${p.projectName}</b><small>${p.projectState} · edit</small></button></div>
        <forma-collection-tree></forma-collection-tree>
        <div class="side-links"><button @click=${() => this.store.setRoute("/library")}>Reusable blocks <span>${p.blocks.length}</span></button><button @click=${() => this.store.setRoute("/library")}>Recent outputs <span>${p.outputs.length}</span></button><button @click=${() => this.store.setRoute("/library")}>Aesthetic families <span>${Math.max(1,p.families.length)}</span></button></div>
        <div class="stream-peek"><span class="live-dot"></span><div><b>Durable stream</b><small>#${this.store.head.get()} · ${this.store.loading.get() ? "syncing" : "caught up"}</small></div><button @click=${() => this.store.setRoute("/admin/events")}>Review</button></div>
      </aside>
      <div class="studio-main">
        <div class="document-bar"><div><span class="eyebrow">Document / ${p.documentId || "loading"}</span><h1>${p.documentTitle}</h1></div><div class="document-actions"><button class="icon-button labeled" @click=${() => this.store.undo()}>${icon("undo")}<span>Undo</span></button><button class="icon-button labeled" @click=${() => this.store.redo()}>${icon("redo")}<span>Redo</span></button><button class="button secondary compact" @click=${this.#compare}>${icon("compare")} Compare</button></div></div>
        <div class="studio-grid">
          <section class="context-column" aria-labelledby="context-title"><div class="section-heading"><div><span class="eyebrow">Projection · sequence ${this.store.head.get()}</span><h2 id="context-title">Creative context</h2></div><span class="health-pill"><i></i> replayable</span></div>
            <div class="block-list">${p.blocks.map((block) => html`<forma-context-block .block=${block}></forma-context-block>`)}</div>
            <button class="add-block" @click=${this.#addBlock}>${icon("plus")} Add context block</button>
            <div class="compile-bridge"><span>${icon("branch")}</span><div><b>Deterministic context compiler</b><small>${p.latestCompile ? "Snapshot embedded at last generation" : "Ready to compile"} · citations intact</small></div><button @click=${() => this.store.patchUi({ inspectorOpen:true })}>Inspect</button></div>
          </section>
          <section class="output-column" aria-labelledby="output-title"><div class="section-heading"><div><span class="eyebrow">Adapter-neutral simulation</span><h2 id="output-title">Output</h2></div><button class="text-button" @click=${this.#compare}>Compare history</button></div>
            ${output ? html`<forma-output-card .output=${output} .primary=${true}></forma-output-card>` : html`<div class="empty-output"><span>${icon("image")}</span><h3>Context is ready</h3><p>Generate a replayable simulation from the current projection.</p></div>`}
            ${p.outputs.length > 1 ? html`<div class="output-filmstrip" aria-label="Previous outputs">${p.outputs.slice(1,5).map((o) => html`<button class="mini-output variant-${o.variant % 4} ${this.store.ui.selectedOutputId===o.id?"selected":""}" aria-label="Select ${o.id}" aria-pressed=${this.store.ui.selectedOutputId===o.id} @click=${() => { this.store.patchUi({ selectedOutputId:o.id }); if (this.store.ui.instrumentation) void this.store.hot({type:"ObjectViewed",payload:{object_id:o.id}}); }}></button>`)}</div>` : nothing}
            <label class="dropzone"><input type="file" accept="image/*" @change=${this.#upload}><span>${icon("plus")}</span><b>${this.#uploading ? "Uploading…" : "Drop or choose a reference"}</b><small>Stored in R2; rights stay unknown until asserted</small></label>
          </section>
        </div>
      </div>
      ${this.store.ui.inspectorOpen ? this.#inspector() : nothing}
      <div class="composer-dock">
        ${this.#proposal ? html`<div class="proposal-preview"><div><span class="eyebrow">Proposed events · inert until accepted</span><b>${this.#proposal.events.map((e) => shortEventType(e.type)).join(" + ")}</b><small>Expected sequence ${this.store.head.get()} · previewed with context diff</small></div><button class="button ghost" @click=${this.#rejectProposal}>Decline</button><button class="button primary" @click=${this.#acceptProposal}>Accept proposal</button></div>` : nothing}
        <div class="composer"><label class="sr-only" for="creative-command">Describe a change or ask Forma</label><textarea id="creative-command" rows="1" placeholder="Describe a change — “make the palette warmer”…" .value=${this.#prompt} @input=${(e: InputEvent) => { this.#prompt = (e.target as HTMLTextAreaElement).value; }} @keydown=${(e: KeyboardEvent) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void this.#ask(); } }}></textarea><label class="icon-button add-ref" title="Add reference"><input type="file" accept="image/*" @change=${this.#upload}>${icon("plus")}</label><button class="button secondary ask" @click=${this.#ask}>Ask Forma</button><button class="button primary generate" ?disabled=${!!this.store.busy.get()} @click=${() => this.store.generate()}>${icon("spark")} ${this.store.busy.get()==="generate" ? "Compiling…" : "Generate"}</button></div>
      </div>
      ${this.store.ui.compareOpen ? this.#comparison() : nothing}
    </section>`;
  }
}
customElements.define("forma-workspace", FormaWorkspace);
