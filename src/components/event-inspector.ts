import { html, nothing } from "lit";
import { FormaElement, icon } from "./forma-element";
import { shortEventType } from "../model/events";

export class EventInspector extends FormaElement {
  override render(){
    if(!this.store.ui.inspectorOpen)return nothing;
    const event=this.store.events.get().find((item)=>item.eventId===this.store.ui.selectedEventId)??this.store.events.get().at(-1);if(!event)return nothing;
    const engineering=this.store.session.get()?.capabilities?.includes("engineering.events.read")===true;
    const author=event.actor==="user"?this.i18n.t("workspace.provenance.you","You"):this.i18n.t("workspace.provenance.assistance","Approved creative assistance");
    return html`<aside class="inspector-panel" aria-label=${this.i18n.t("workspace.provenance.inspector","Creative history")}><header><div><span class="eyebrow">${this.i18n.t("workspace.provenance.source","Saved creative history")}</span><h2>${shortEventType(event.type)}</h2></div><button class="icon-button" aria-label=${this.i18n.t("workspace.provenance.close","Close creative history")} @click=${()=>this.store.patchUi({inspectorOpen:false})}>${icon("close")}</button></header><p>${this.i18n.t("workspace.provenance.description","This creative decision is saved to your private document and remains available for future results.")}</p><dl><dt>${this.i18n.t("workspace.provenance.author","Created by")}</dt><dd>${author}</dd><dt>${this.i18n.t("workspace.provenance.saved","Saved")}</dt><dd>${this.i18n.date(new Date(event.occurredAt),{dateStyle:"medium",timeStyle:"short"})}</dd><dt>${this.i18n.t("workspace.provenance.change","Creative change")}</dt><dd>${shortEventType(event.type)}</dd></dl>${engineering?html`<details class="provenance-technical"><summary>${this.i18n.t("workspace.provenance.technical","Technical details for engineering")}</summary><dl><dt>Sequence</dt><dd>#${event.sequence}</dd><dt>Actor</dt><dd>${event.actor}</dd><dt>Client</dt><dd>${event.clientId}</dd><dt>Correlation</dt><dd>${event.correlationId}</dd></dl><pre>${JSON.stringify(event.payload,null,2)}</pre><div class="inspector-actions"><button @click=${()=>this.store.setRoute("/engineering/events")}>${this.i18n.t("workspace.provenance.engineering","Open Engineering Diagnostics")} ${icon("arrow")}</button><button @click=${()=>navigator.clipboard.writeText(event.eventId)}>${this.i18n.t("workspace.provenance.copy","Copy technical event ID")}</button></div></details>`:nothing}</aside>`;
  }
}
if (!customElements.get("forma-event-inspector")) customElements.define("forma-event-inspector",EventInspector);
