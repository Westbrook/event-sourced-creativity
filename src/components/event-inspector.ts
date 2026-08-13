import { html, nothing } from "lit";
import { FormaElement, icon } from "./forma-element";
import { shortEventType } from "../model/events";

export class EventInspector extends FormaElement {
  override render(){if(!this.store.ui.inspectorOpen)return nothing;const event=this.store.events.get().find((item)=>item.eventId===this.store.ui.selectedEventId)??this.store.events.get().at(-1);if(!event)return nothing;return html`<aside class="inspector-panel" aria-label="Provenance inspector"><header><div><span class="eyebrow">Projection source</span><h2>${shortEventType(event.type)}</h2></div><button class="icon-button" aria-label="Close inspector" @click=${()=>this.store.patchUi({inspectorOpen:false})}>${icon("close")}</button></header><dl><dt>Sequence</dt><dd>#${event.sequence}</dd><dt>Actor</dt><dd>${event.actor}</dd><dt>Client</dt><dd>${event.clientId}</dd><dt>Correlation</dt><dd>${event.correlationId}</dd><dt>Authority</dt><dd>${event.actor==="user"?"authored":"inferred / operational"}</dd></dl><h3>Folded payload</h3><pre>${JSON.stringify(event.payload,null,2)}</pre><div class="inspector-actions"><button @click=${()=>this.store.setRoute("/operations/events")}>Open in Operations ${icon("arrow")}</button><button @click=${()=>navigator.clipboard.writeText(event.eventId)}>Copy event ID</button></div></aside>`;}
}
customElements.define("forma-event-inspector",EventInspector);
