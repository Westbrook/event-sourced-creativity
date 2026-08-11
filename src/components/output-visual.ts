import { html } from "lit";
import { FormaElement, icon } from "./forma-element";
import type { CreativeOutput } from "../model/events";

export class OutputVisual extends FormaElement {
  static properties={output:{attribute:false},compact:{type:Boolean}};
  output?:CreativeOutput;compact=false;

  override render(){
    const output=this.output;
    return output?.mediaUrl
      ? html`<img class="generated-output-image" src=${output.mediaUrl} alt=${`Generated image ${output.id}`} width=${output.width??1536} height=${output.height??1024} loading=${this.compact?"lazy":"eager"}>`
      : html`<span class="generated-output-empty">${icon("image")}<small>${output?.provider==="simulation"?"Legacy simulated output":"No generated image"}</small></span>`;
  }
}

customElements.define("forma-output-visual",OutputVisual);
