import { html, nothing } from "lit";
import type { CreativeNextAction } from "../model/workspace-intelligence";
import { creativeNextActionDisplayLabels, type CreativeNextActionDisplayLocale } from "../model/output-naming";
import "./design-system/choice-card";
import "./next-action-cards.css";

// Shared composition of the existing store-independent choice card. The host owns
// exact-target validation and navigation; the card can never authorize a purchase.
export function renderNextActionCards(actions:CreativeNextAction[],locale:CreativeNextActionDisplayLocale,choose:(action:CreativeNextAction)=>unknown,options:{creatorHandoff?:boolean}={}){
  const labels=creativeNextActionDisplayLabels(actions,locale);
  return actions.length?html`<aside class="exact-next-actions" aria-label=${locale.t("next.exact.heading","Next for this document")}>
    ${actions.map((action,index)=>{const handoff=options.creatorHandoff&&["context","configure","compare"].includes(action.target.kind);const destination=handoff?` · ${locale.t("next.exact.creatorWorkspace","Creator Workspace")}`:"";return html`<forma-ui-choice-card data-primary=${String(index===0)} .compact=${true} .label=${labels[index]!+destination} .detail=${locale.t(action.reasonKey??`next.exact.${action.id}.reason`,action.reason)} .value=${action.id} icon-name="arrow" @forma-action=${()=>choose(action)}></forma-ui-choice-card>`;})}
  </aside>`:nothing;
}

/** Scope labels only. The caller supplies the exact current Document's resolver output. */
export function renderLifecycleNextActionCards(
  actions: CreativeNextAction[], locale: CreativeNextActionDisplayLocale,
  choose: (action: CreativeNextAction) => unknown,
  scope: { projectName: string; documentTitle: string; scopeUnknown: boolean; creatorHandoff?: boolean },
) {
  return actions.length ? html`<section class="lifecycle-next-actions" aria-label=${locale.t("next.exact.heading", "Next for this document") + " · " + scope.projectName + " · " + scope.documentTitle}>
    <p class="lifecycle-next-scope"><bdi dir="auto">${scope.projectName}</bdi> · <bdi dir="auto">${scope.documentTitle}</bdi></p>
    ${scope.scopeUnknown ? html`<p class="muted" role="status">${locale.t("next.lifecycle.scopeUnknown", "Delivery scope is unknown.")}</p>` : nothing}
    ${renderNextActionCards(actions, locale, choose, { creatorHandoff: scope.creatorHandoff })}
  </section>` : nothing;
}
