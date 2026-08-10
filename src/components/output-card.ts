import { html } from "lit";
import { FormaElement, icon, downloadJson } from "./forma-element";
import type { CreativeOutput } from "../model/events";

export class OutputCard extends FormaElement {
  static properties = { output: { attribute: false }, primary: { type: Boolean } };
  output!: CreativeOutput; primary = false;
  override render() {
    const out = this.output; if (!out) return html``;
    return html`<article class="output-card ${this.primary ? "primary" : ""} ${this.store.ui.selectedOutputId === out.id ? "selected" : ""}">
      <button class="output-art variant-${out.variant % 4}" aria-label="Select generated output ${out.id}" aria-pressed=${this.store.ui.selectedOutputId === out.id} @click=${() => { this.store.patchUi({ selectedOutputId: out.id }); if (this.store.ui.instrumentation) void this.store.hot({ type: "ObjectViewed", payload: { object_id: out.id } }); }}><span class="art-glow"></span><span class="art-frame"></span><span class="art-vase"></span><span class="art-table"></span></button>
      <div class="output-info"><div><b>Quiet nocturne ${out.variant + 1}</b><small>${out.modelId} · ${(out.latency / 1000).toFixed(1)}s</small></div><div class="output-actions">
        <button aria-pressed=${out.pinned} @click=${() => this.store.append({ type: out.pinned ? "ObjectUnpinned" : "ObjectPinned", payload: { object_id: out.id, scope: "project" } })}>${icon("pin")} ${out.pinned ? "Pinned" : "Pin"}</button>
        <button aria-pressed=${out.saved} @click=${() => this.store.append({ type: "ObjectSaved", payload: { object_id: out.id } })}>${icon("check")} ${out.saved ? "Saved" : "Save"}</button>
        <button @click=${() => { downloadJson(`${out.id}.json`, { output: out, context: this.store.projection.get().latestCompile, clearance: "owned" }); void this.store.append({ type: "ObjectExported", payload: { object_id: out.id, destination_class: "download", format: "application/json" } }); }}>${icon("download")} Export</button>
      </div></div>
    </article>`;
  }
}
customElements.define("forma-output-card", OutputCard);
