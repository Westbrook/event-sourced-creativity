import { html } from "lit";
import type { CreativeOutput } from "../model/events";
import { PROMPT_TECHNIQUE_DEFINITIONS } from "../model/prompt-structures";
import { FormaElement, icon } from "./forma-element";
import "./icons-history";
import "./output-visual";

export class PromptFanVisual extends FormaElement {
  static properties = { outputs: { attribute: false }, compact: { type: Boolean } };
  outputs: CreativeOutput[] = [];
  compact = false;

  override render() {
    const byTechnique = new Map(this.outputs.map((output) => [output.promptTechnique, output]));
    return html`<div class=${`prompt-fan-visual ${this.compact ? "compact" : ""}`} role="group" aria-label="Four prompt structures in one fan generation">
      ${PROMPT_TECHNIQUE_DEFINITIONS.map((definition) => {
        const output = byTechnique.get(definition.id);
        return html`<figure class=${output ? "ready" : "pending"}>
          <div>${output ? html`<forma-output-visual .output=${output} .fanOutputs=${this.outputs} .compact=${this.compact} .interactive=${!this.compact}></forma-output-visual>` : html`<span>${icon("clock")}</span>`}</div>
          <figcaption><b>${definition.shortLabel}</b>${output?.standalone ? html`<small>${icon("check")} Standalone</small>` : html`<small>${output ? "In fan" : "Pending"}</small>`}</figcaption>
        </figure>`;
      })}
    </div>`;
  }
}

customElements.define("forma-prompt-fan-visual", PromptFanVisual);
declare global { interface HTMLElementTagNameMap { "forma-prompt-fan-visual": PromptFanVisual } }
