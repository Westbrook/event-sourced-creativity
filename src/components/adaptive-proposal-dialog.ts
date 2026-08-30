import { html, nothing } from "lit";
import { blockTypeDefinition } from "../model/block-types";
import type { FormaLocaleController } from "./design-system/localization";
import type { AdaptiveProposalReviewController } from "./adaptive-proposal-review";
import { renderAuthoringPreview } from "./authoring-preview";
import { captureOutputNavigationFocus } from "./output-navigation-focus";
import "./adaptive-proposal-dialog.css";

export function renderAdaptiveProposalDialog(controller:AdaptiveProposalReviewController,i18n:Pick<FormaLocaleController,"t"|"number"|"system">,
  options:{id:string;dialog:()=>HTMLDialogElement|null;close:()=>void;open:(kind:"block"|"canvas-item",id:string)=>void}){
  controller.synchronize();if(!controller.visible)return nothing;
  const scope=controller.ports.scope();if(!scope)return nothing;
  const presentationId=controller.presentationId;
  const close=(event?:Event)=>{if(!controller.visible||controller.presentationId!==presentationId)return;if(event?.type==="close"&&(event.currentTarget!==options.dialog()||(event.currentTarget as HTMLDialogElement).open))return;options.close();};
  const preview=controller.preview,review=preview?.adaptiveReview,receipt=controller.receipt,disabled=!controller.canEdit;
  return html`<dialog class="modal context-intelligence-dialog adaptive-proposal-dialog" closedby="any" aria-labelledby=${options.id} @cancel=${(event:Event)=>{event.preventDefault();close(event);}} @close=${close}>
    <div class="modal-card"><header class="context-intelligence-head"><div><h2 id=${options.id} tabindex="-1">${i18n.t("adaptive.changes.title")}</h2><p>${i18n.t("adaptive.changes.free")}</p></div><button class="button secondary" type="button" @click=${()=>close()}>${i18n.t("action.close")}</button></header>
      <p class="adaptive-proposal-destination" dir="auto">${i18n.t("adaptive.changes.destination")}: ${scope.projectId} / ${scope.documentId}${scope.canvasId?" / "+scope.canvasId:""}</p>
      ${controller.notice?html`<p role="status">${i18n.t(controller.notice)}</p>`:nothing}
      ${!scope.canAuthor?html`<p>${i18n.t("adaptive.changes.readOnly")}</p>`:nothing}
      ${controller.outputEditorRequired&&controller.notice!=="adaptive.changes.outputEditorRequired"?html`<p>${i18n.t("adaptive.changes.outputEditorRequired")}</p>`:nothing}
      ${!controller.originals.length&&controller.executionId&&!controller.handle&&!controller.uncertain&&!receipt&&controller.phase!=="receipts"?html`<button type="button" class="button secondary" ?disabled=${controller.busy} @click=${()=>controller.retrieveOriginal()}>${i18n.t("adaptive.changes.retrieveOriginal")}</button>`:nothing}
      ${controller.originals.length&&!receipt&&controller.phase!=="receipts"?html`<div class="adaptive-proposal-fields">
        ${controller.drafts.map((draft,index)=>{const original=controller.originals.find(item=>item.proposalId===draft.proposalId);if(!original)return nothing;const id=options.id+"-"+index,targets=controller.targets(draft.proposalId);
          return html`<section aria-labelledby=${id}><h3 id=${id} dir="auto">${original.label}</h3><p>${i18n.system(blockTypeDefinition(draft.edit?.type??original.type)?.label??original.type)}</p>
            <label>${i18n.t("adaptive.changes.target")}<select ?disabled=${disabled} .value=${draft.targetBlockId??""} @change=${(event:Event)=>controller.update(draft.proposalId,"targetBlockId",(event.target as HTMLSelectElement).value)}>
              <option value="" .selected=${!draft.targetBlockId}>${i18n.t("adaptive.changes.create")}</option>${controller.outputTargetId(draft.proposalId)?html`<option value=${draft.targetBlockId!} disabled .selected=${true}>${i18n.t("adaptive.changes.outputTarget")} · ${draft.targetBlockId}</option>`:draft.targetBlockId&&!targets.some(block=>block.id===draft.targetBlockId)?html`<option value=${draft.targetBlockId} disabled .selected=${true}>${i18n.t("adaptive.changes.unavailableTarget")} · ${draft.targetBlockId}</option>`:nothing}${targets.filter(block=>block.id!==controller.outputTargetId(draft.proposalId)).map(block=>html`<option value=${block.id} .selected=${draft.targetBlockId===block.id}>${String(block.properties.label??block.handle)} · ${block.id}</option>`)}</select></label>
            ${controller.canOpenOutputTarget(draft.proposalId)?html`<button type="button" class="button secondary" @click=${()=>controller.visible&&controller.presentationId===presentationId&&controller.ports.scope()?.key===scope.key&&controller.outputTargetId(draft.proposalId)===draft.targetBlockId?controller.openOutputTarget(draft.proposalId,options.close):false}>${i18n.t("adaptive.changes.openOutput")}</button>`:nothing}
            <label>${i18n.t("adaptive.changes.label")}<input maxlength="160" dir="auto" ?disabled=${disabled} .value=${draft.edit?.label??original.label} @input=${(event:InputEvent)=>controller.update(draft.proposalId,"label",(event.target as HTMLInputElement).value)}></label>
            <label>${i18n.t("adaptive.changes.text")}<textarea rows="4" maxlength="16000" dir="auto" ?disabled=${disabled} .value=${draft.edit?.text??original.text} @input=${(event:InputEvent)=>controller.update(draft.proposalId,"text",(event.target as HTMLTextAreaElement).value)}></textarea></label>
            <label>${i18n.t("adaptive.changes.subtype")}<select ?disabled=${disabled} .value=${draft.edit?.subtype??original.subtype} @change=${(event:Event)=>controller.update(draft.proposalId,"subtype",(event.target as HTMLSelectElement).value)}>${blockTypeDefinition(draft.edit?.type??original.type)?.subtypes.map(subtype=>html`<option value=${subtype}>${i18n.system(subtype)}</option>`)}</select></label>
            ${scope.canvasId&&!draft.targetBlockId&&draft.placement?html`<fieldset><legend>${i18n.t("adaptive.changes.placement")}</legend><div class="adaptive-proposal-placement">${(["x","y","w","h"] as const).map(key=>html`<label>${i18n.t("adaptive.changes."+key)}<input type="number" step="any" min=${key==="w"||key==="h"?"1":"-1000000"} max="1000000" dir="ltr" ?disabled=${disabled} .value=${String(draft.placement![key])} @input=${(event:InputEvent)=>controller.update(draft.proposalId,key,(event.target as HTMLInputElement).value)}></label>`)}</div></fieldset>`:nothing}
            <details><summary>${i18n.t("adaptive.changes.original")}</summary><code dir="ltr">${original.proposalId}</code><p dir="auto">${original.text}</p><p dir="auto">${original.reason}</p>${original.relationshipTo?html`<p dir="auto">${original.relationshipTo}</p>`:nothing}</details>
          </section>`;
        })}
      </div>`:nothing}
      ${preview?renderAuthoringPreview(preview,i18n,{id:options.id+"-changes",status:receipt?"applied":controller.uncertain?"applying":"review",hint:i18n.t("adaptive.changes.atomic")}):nothing}
      ${review?html`<details class="adaptive-proposal-proof"><summary>${i18n.t("adaptive.changes.sourceProof")}</summary><p>${i18n.t(review.sourceChanged?"adaptive.changes.sourceChanged":"adaptive.changes.sourceSame")}</p><dl><dt>${i18n.t("adaptive.changes.originalHash")}</dt><dd dir="ltr">${review.originalSourceHash}</dd><dt>${i18n.t("adaptive.changes.currentHash")}</dt><dd dir="ltr">${review.currentSourceHash}</dd></dl></details>`:nothing}
      ${controller.phase==="receipts"?html`<section aria-label=${i18n.t("adaptive.changes.receipts")}><h3>${i18n.t("adaptive.changes.receipts")}</h3><p>${i18n.t("adaptive.changes.receiptChoice")}</p><ul>${controller.receipts.map(item=>html`<li><p dir="auto">${item.createdAt} · ${i18n.number(item.blockIds.length)}</p><details><summary>${i18n.t("adaptive.changes.identity")}</summary><p dir="ltr">${item.executionId}</p><p dir="ltr">${item.bindingHash}</p><p dir="ltr">${item.selectionKey}</p></details><button type="button" class="button secondary" ?disabled=${controller.busy} @click=${()=>controller.chooseReceipt(item)}>${i18n.t("adaptive.changes.readReceipt")} · ${item.previewId}</button></li>`)}</ul>${controller.nextCursor?html`<button class="button secondary" type="button" ?disabled=${controller.busy} @click=${()=>controller.receiptDiscovery==="destination"?controller.discoverDestinationReceipts(controller.nextCursor!):controller.discoverReceipts(controller.nextCursor!)}>${i18n.t("adaptive.changes.moreReceipts")}</button>`:nothing}</section>`:nothing}
      ${receipt?html`<section class="adaptive-proposal-result"><h3>${i18n.t("adaptive.changes.applied")}</h3><p>${i18n.t("adaptive.changes.notDelivery")}</p><ul>${receipt.blockIds.map(id=>html`<li><button class="button secondary" type="button" @click=${()=>options.open("block",id)}>${i18n.t("adaptive.changes.openBlock")} · ${id}</button></li>`)}${receipt.canvasItemIds.map(id=>html`<li><button class="button secondary" type="button" @click=${()=>options.open("canvas-item",id)}>${i18n.t("adaptive.changes.openItem")} · ${id}</button></li>`)}</ul></section>`:nothing}
      <details class="adaptive-proposal-proof"><summary>${i18n.t("adaptive.changes.identity")}</summary><p dir="ltr">${controller.executionId}</p><p dir="ltr">${controller.bindingHash}</p>${controller.handle?html`<p dir="ltr">${controller.handle.previewId}</p><p dir="ltr">${controller.handle.approvalHash}</p>`:nothing}</details>
      <footer class="context-intelligence-actions">
        ${controller.canPreview&&(!preview||controller.dirty||controller.stale)?html`<button type="button" class="button secondary" @click=${()=>controller.request("preview")}>${i18n.t("adaptive.changes.preview")}</button>`:nothing}
        ${preview&&!receipt?html`<button type="button" class="button primary" ?disabled=${!controller.canApply} @click=${()=>controller.request("apply")}>${i18n.t(controller.retryable?"adaptive.changes.retryApply":"adaptive.changes.apply")}</button>`:nothing}
        ${controller.handle||controller.uncertain?html`<button type="button" class="button secondary" ?disabled=${controller.busy} @click=${()=>controller.resume()}>${i18n.t("adaptive.changes.check")}</button>`:nothing}
        ${controller.bindingHash&&!controller.uncertain?html`<button type="button" class="text-button" ?disabled=${controller.busy} @click=${()=>controller.discoverReceipts()}>${i18n.t("adaptive.changes.findReceipts")}</button>`:nothing}
        ${!controller.uncertain?html`<button type="button" class="text-button" ?disabled=${controller.busy} @click=${()=>controller.discoverDestinationReceipts()}>${i18n.t("adaptive.changes.findDestinationReceipts")}</button>`:nothing}
        ${controller.canDismiss?html`<button type="button" class="text-button" ?disabled=${controller.busy} @click=${()=>controller.request("dismiss")}>${i18n.t("adaptive.changes.dismiss")}</button>`:nothing}
      </footer><p>${i18n.t("adaptive.changes.closeHint")}</p>
    </div>
  </dialog>`;
}

/** Shared native-close ownership and focus return for both authoring hosts. */
export function closeAdaptiveProposalDialog(host:HTMLElement&{updateComplete:Promise<unknown>},controller:AdaptiveProposalReviewController,opener:HTMLElement|undefined,fallback:()=>HTMLElement|null,currentContext:()=>boolean=()=>true){
  const presentationId=controller.presentationId,scope=controller.ports.scope()?.key,openingOutput=controller.openingOutputRequirement;
  controller.close();host.querySelector<HTMLDialogElement>(".adaptive-proposal-dialog")?.close();
  // Native Close may synchronously restore focus; own only its deferred follow-up.
  const focus=captureOutputNavigationFocus(host.ownerDocument);
  void host.updateComplete.then(()=>{
    try{
    if(openingOutput||!host.isConnected||controller.visible||controller.presentationId!==presentationId||controller.ports.scope()?.key!==scope||host.querySelector("dialog[open]")||!currentContext())return;
    const target=opener?.isConnected?opener:fallback();if(!target)return;
    focus.run(target,()=>{
      const tabindex=target.getAttribute("tabindex");if(tabindex===null)target.setAttribute("tabindex","-1");
      try{target.focus({preventScroll:true});return true;}finally{if(tabindex===null)target.removeAttribute("tabindex");}
    });
    }finally{focus.dispose();}
  },()=>focus.dispose());
}
