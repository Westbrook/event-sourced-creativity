import { html, nothing } from "lit";
import type { AvailableConsequentialPreview } from "../../worker/consequential-consent";
import type { FormaLocaleController } from "./design-system/localization";

/** One disclosure for every paid proposal: exact input, destination, custody and bounded charge. */
export function consequentialPreview(quote:AvailableConsequentialPreview,i18n:Pick<FormaLocaleController,"t"|"number">){
  const input=quote.privateInput&&typeof quote.privateInput==="object"?quote.privateInput as Record<string,unknown>:{};
  const planning=quote.operation==="adaptive-structure"&&typeof input.documentTitle==="string"&&typeof input.projectTitle==="string"&&Number.isSafeInteger(input.blockCount)&&Number.isSafeInteger(input.documentCount);
  return html`${!quote.providerAvailable?html`<p role="status">${i18n.t("context.consent.unavailable")}</p>`:nothing}
    ${quote.budgetAvailable===false?html`<p role="status">${i18n.t("planning.consent.budgetUnavailable")}</p>`:nothing}
    ${quote.unavailableReasons?.length?html`<p role="status">${i18n.t("planning.consent.policyUnavailable")}</p>`:nothing}
    ${planning?html`<p>${i18n.t(input.scope==="whole-project"?"planning.consent.scopeProject":"planning.consent.scopeDocument","",{count:i18n.number(input.blockCount as number),documents:i18n.number(input.documentCount as number),title:String(input.scope==="whole-project"?input.projectTitle:input.documentTitle)})}</p>
      ${input.scope==="whole-project"?html`<dl><div><dt>${i18n.t("planning.consent.sourceDocuments")}</dt><dd>${i18n.number(input.documentCount as number)}</dd></div>${Number.isSafeInteger(input.libraryBlockCount)&&Number(input.libraryBlockCount)>=0?html`<div><dt>${i18n.t("planning.consent.libraryDecisions")}</dt><dd>${i18n.number(input.libraryBlockCount as number)}</dd></div>`:nothing}${Number.isSafeInteger(input.canvasBlockCount)&&Number(input.canvasBlockCount)>=0?html`<div><dt>${i18n.t("planning.consent.canvasDecisions")}</dt><dd>${i18n.number(input.canvasBlockCount as number)}</dd></div>`:nothing}</dl>`:nothing}
      <p>${i18n.t("planning.consent.destination","",{title:[input.documentTitle,input.canvasTitle].filter((title)=>typeof title==="string"&&title).join(" / ")})}</p>${Number.isSafeInteger(input.protectedBlockCount)?html`<p>${i18n.t("planning.consent.protected","",{count:i18n.number(input.protectedBlockCount as number)})}</p>`:nothing}`:nothing}
    <dl><div><dt>${i18n.t("context.consent.provider")}</dt><dd>${quote.provider} · ${quote.models.join(", ")}</dd></div><div><dt>${i18n.t("context.consent.reservation")}</dt><dd>USD ${(quote.maximumMicrousd/1_000_000).toFixed(4)} · ${i18n.t("context.consent.calls","",{count:i18n.number(quote.providerCalls)})}</dd></div><div><dt>${i18n.t("context.consent.billing")}</dt><dd>${quote.actorLabel} · ${quote.workspaceId??i18n.t("context.consent.personal")} · ${quote.period}</dd></div></dl>
    <p>${i18n.t(quote.publicQuery?"context.consent.searchBoundary":"context.consent.noSearch")}</p><p>${i18n.t("context.consent.held")}</p>
    <details><summary>${i18n.t("context.consent.exactInput")}</summary><p>${quote.projectId} / ${quote.documentId}${quote.canvasId?` / ${quote.canvasId}`:""}</p><p>${quote.sourceHash}</p><textarea readonly rows="10" aria-label=${i18n.t("context.consent.exactInput")} .value=${JSON.stringify(quote.privateInput,null,2)}></textarea><small>${i18n.t("context.consent.expires")} ${quote.expiresAt}</small></details>`;
}
