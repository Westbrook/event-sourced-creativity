import { html, nothing } from "lit";
import type { CreativeNextAction } from "../model/workspace-intelligence";
import "./design-system/choice-card";
import "./next-action-cards.css";

// Shared composition of the existing store-independent choice card. The host owns
// exact-target validation and navigation; the card can never authorize a purchase.
export function renderNextActionCards(actions:CreativeNextAction[],locale:{t:(id:string,fallback?:string)=>string},choose:(action:CreativeNextAction)=>unknown,options:{creatorHandoff?:boolean}={}){
  return actions.length?html`<aside class="exact-next-actions" aria-label=${locale.t("next.exact.heading","Next for this document")}>
    ${actions.map((action,index)=>{const title=action.title&&action.target.kind!=="job"?(action.target.kind==="configure"?locale.t(`artifact.${action.title}.label`,action.title.replaceAll("_"," ")):action.title):"";const handoff=options.creatorHandoff&&["context","configure","compare"].includes(action.target.kind);const label=locale.t(`next.exact.${action.id}.label`,action.label);const destination=handoff?` · ${locale.t("next.exact.creatorWorkspace","Creator Workspace")}`:"";return html`<forma-ui-choice-card data-primary=${String(index===0)} .compact=${true} .label=${(title?`${label}: ${title}`:label)+destination} .detail=${locale.t(`next.exact.${action.id}.reason`,action.reason)} .value=${action.id} icon-name="arrow" @forma-action=${()=>choose(action)}></forma-ui-choice-card>`;})}
  </aside>`:nothing;
}
