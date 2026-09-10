import { html, nothing } from "lit";
import { cache } from "lit/directives/cache.js";
import { keyed } from "lit/directives/keyed.js";
import { localizeTemplateResult } from "./design-system/localized-template";
import type { GenerationInputInspection } from "../model/generation-inputs";
import { isManagedVideoInspection } from "../model/generation-execution-evidence";
import { savedStoryboardInspection } from "../model/saved-storyboard-inspection";
import { model3dPromptLength } from "../model/model3d";
import { copyTextToClipboard, FormaElement, icon } from "./forma-element";
import { ensureModalDialog } from "./modal-dialog";
import { createGenerationAccountingReader, generationAccountingTarget, type GenerationAccountingTarget } from "../model/generation-accounting-inspection.ts";

type AccountingInspectionOwner = { inspection: GenerationInputInspection; scopeKey: string; route: string; target: GenerationAccountingTarget };

export class GenerationInputDialog extends FormaElement {
  static properties={open:{type:Boolean},inspection:{attribute:false},openingCurrent:{attribute:false}};
  // The existing caller owns this check only at deferred native promotion.
  openingCurrent:(()=>boolean)|null=null;
  open=false;inspection:GenerationInputInspection|null=null;#unavailableFrames=new Set<string>();#titleId=`generation-input-${crypto.randomUUID()}`;
  #inspectionScope="";
  #accounting = createGenerationAccountingReader();
  #accountingOwner: AccountingInspectionOwner | null = null;
  #accountingUnsubscribe?: () => void;
  #retireAccounting=()=>{this.#accounting.cancel();this.#accountingOwner=null;};
  #accountingScopeChanged=()=>{if(this.#accountingOwner&&!this.#accountingCurrent(this.#accountingOwner)){this.#retireAccounting();this.requestUpdate();}};
  protected override willUpdate(){
    this.#accountingScopeChanged();
    const scope=this.store.captureAuthorizationScope()?.key??"";
    if((!scope||this.#inspectionScope&&scope!==this.#inspectionScope)&&(this.open||this.inspection))this.#clearPrivatePreview();
    this.#inspectionScope=scope;
    if(!this.open||!this.inspection)this.renderRoot.querySelector<HTMLDialogElement>("dialog")?.close();
  }
  protected override updated(){
    const dialog=this.renderRoot.querySelector<HTMLDialogElement>("dialog");
    if(this.open&&dialog&&!dialog.open){
      if(this.openingCurrent&&!this.openingCurrent()){this.#clearPrivatePreview();return;}
      ensureModalDialog(dialog);
    }
    if(!this.open&&dialog?.open)dialog.close();
  }
  #close(){this.#retireAccounting();this.open=false;this.#unavailableFrames.clear();this.renderRoot.querySelector<HTMLDialogElement>("dialog")?.close();this.dispatchEvent(new CustomEvent("generation-input-close",{bubbles:true,composed:true}));this.requestUpdate();}
  #clearPrivatePreview=()=>{this.#unavailableFrames.clear();this.inspection=null;this.#close();};
  override connectedCallback(){super.connectedCallback();this.#accountingUnsubscribe?.();this.#accountingUnsubscribe=this.store.subscribe(this.#accountingScopeChanged);window.addEventListener("forma-authorization-changed",this.#clearPrivatePreview);}
  override disconnectedCallback(){this.#accountingUnsubscribe?.();this.#accountingUnsubscribe=undefined;this.#retireAccounting();window.removeEventListener("forma-authorization-changed",this.#clearPrivatePreview);this.open=false;this.renderRoot.querySelector<HTMLDialogElement>("dialog")?.close();this.#unavailableFrames.clear();this.inspection=null;this.#inspectionScope="";super.disconnectedCallback();}
  #frameUnavailable(url:string){this.#unavailableFrames.add(url);this.requestUpdate();}
  #backdrop(event:MouseEvent){if(event.target===event.currentTarget)this.#close();}
  #accountingTarget(){const session=this.store.session.get(),scope=this.store.captureAuthorizationScope();return scope?generationAccountingTarget(this.inspection,{role:session?.user.role,shared:scope.shared||Boolean(session?.projectContext),impersonating:Boolean(session?.impersonation)}):null;}
  #accountingCurrent(owner:AccountingInspectionOwner){
    try{
      const target=this.#accountingTarget();
      return this.isConnected&&this.open&&this.renderRoot.querySelector<HTMLDialogElement>("dialog")?.open===true&&this.inspection===owner.inspection
        &&this.#accountingOwner===owner&&this.store.captureAuthorizationScope()?.key===owner.scopeKey&&this.store.route.get()===owner.route
        &&(!this.openingCurrent||this.openingCurrent())&&target!==null&&target.jobId===owner.target.jobId&&target.documentId===owner.target.documentId&&target.attemptCount===owner.target.attemptCount&&target.status===owner.target.status;
    }catch{return false;}
  }
  async #readAccounting(){
    const target=this.#accountingTarget(),inspection=this.inspection,scope=this.store.captureAuthorizationScope();
    if(!target||!inspection||!scope||this.#accounting.state().status==="loading")return;
    this.#retireAccounting();
    const owner={inspection,scopeKey:scope.key,route:this.store.route.get(),target};this.#accountingOwner=owner;
    await this.#accounting.read(target,{current:()=>this.#accountingCurrent(owner),changed:()=>this.requestUpdate(),
      fetch:(url,init,current)=>this.store.guardedFetch(url,init,"inspect accounting",{current})});
  }
  #accountingTemplate(){
    if(!this.#accountingTarget())return nothing;
    const state=this.#accounting.state(),preview=state.preview;
    const dollars=(value:number|null)=>value===null?this.i18n.t("generation.accounting.unconfirmed","Not yet confirmed"):this.i18n.number(value/1_000_000,{style:"currency",currency:"USD",minimumFractionDigits:6,maximumFractionDigits:6});
    return html`<section class="generation-receipt-summary generation-accounting-preview" aria-label=${this.i18n.t("generation.accounting.heading","Accounting inspection")} aria-busy=${state.status==="loading"?"true":"false"}>
      <header><div><h3>${this.i18n.t("generation.accounting.heading","Accounting inspection")}</h3><p>${this.i18n.t("generation.accounting.help","Read current Forma accounting and retained provider receipts. This does not contact a provider or change any balance.")}</p></div>
        <button type="button" class="button secondary compact" aria-disabled=${state.status==="loading"?"true":"false"} @click=${()=>void this.#readAccounting()}>${state.status==="loading"?this.i18n.t("generation.accounting.loading","Reading accounting…"):state.status==="ready"?this.i18n.t("generation.accounting.refresh","Refresh accounting"):this.i18n.t("generation.accounting.inspect","Inspect accounting")}</button></header>
      <p role="status">${state.status==="unavailable"?this.i18n.t("generation.accounting.unavailable","Accounting details could not be loaded. The original receipt is unchanged; no settlement or release was made."):state.status==="ready"?this.i18n.t("generation.accounting.readOnly","Read-only snapshot. No provider request, settlement, budget reset or release was made."):state.status==="loading"?this.i18n.t("generation.accounting.loading","Reading accounting…"):nothing}</p>
      ${preview?html`<dl>
        <div><dt>${this.i18n.t("generation.accounting.reservation","Current Forma reservation")}</dt><dd>${dollars(preview.reservations.dollars.reservedMicrousd)} · ${this.i18n.system(preview.reservations.dollars.status.replaceAll("_"," "))}</dd></div>
        <div><dt>${this.i18n.t("generation.accounting.recordedUsage","Current Forma recorded usage")}</dt><dd>${dollars(preview.reservations.dollars.usedMicrousd)}</dd></div>
        <div><dt>${this.i18n.t("generation.accounting.knownCosts","Known provider receipt costs")}</dt><dd>${dollars(preview.accounting.knownReceiptCostMicrousd)}</dd></div>
      </dl><p>${this.i18n.t("generation.accounting.subtotal","Recorded provider costs are a subtotal, not a proposed charge or confirmation that the entire attempt was free.")}</p>
      <dl class="generation-accounting-calls">${preview.calls.map(call=>html`<div><dt>${call.operation==="planning"?this.i18n.t("generation.accounting.planning","Planning"):call.operation==="image"?this.i18n.t("generation.accounting.image","Image"):this.i18n.t("generation.accounting.video","Video")} · ${call.provider} · ${call.model}</dt><dd><code>${call.providerRequestId??this.i18n.t("generation.accounting.unconfirmed","Not yet confirmed")}</code><br>${dollars(call.costMicrousd)} · ${call.accountingReason?this.i18n.t("generation.accounting.incomplete","Accounting incomplete"):this.i18n.t("generation.accounting.recorded","Receipt recorded")}</dd></div>`)}</dl>
      <label class="generation-accounting-receipt-label">${this.i18n.t("generation.accounting.receipt","Accounting diagnostic receipt")}<textarea dir="ltr" readonly spellcheck="false" .value=${JSON.stringify(preview,null,2)} aria-label=${this.i18n.t("generation.accounting.receipt","Accounting diagnostic receipt")}></textarea></label>`:nothing}
    </section>`;
  }
  async #copy(value:string,label:string){const copied=await copyTextToClipboard(value);this.store.toast(copied?this.i18n.system("{label} copied.",{label:this.i18n.system(label)}):this.i18n.system("{label} could not be copied.",{label:this.i18n.system(label)}));}
  override render(){
    if(!this.inspection||!this.store.captureAuthorizationScope())return nothing;
    return keyed(this.#inspectionScope,cache(this.open?localizeTemplateResult(this.#dialogTemplate(),this.i18n):nothing));
  }
  #dialogTemplate(){
    const inspection=this.inspection;if(!inspection)return nothing;
    const failed=inspection.outcome==="failed",running=inspection.outcome==="in_progress";
    const systemHeader=inspection.systemHeader?.format==="scene"&&inspection.outcome?inspection.systemHeader:null;
    const title=systemHeader?this.i18n.system(failed?"Failed generation inputs":running?"Generation in progress":"Completed generation inputs"):inspection.title;
    const subtitle=systemHeader?this.i18n.t("scene.receipt.subtitle","{format} · attempt {attempt}",{format:this.i18n.t("artifact.scene.label","Scene"),attempt:this.i18n.number(systemHeader.attemptCount)}):inspection.subtitle;
    const storyboard=savedStoryboardInspection(inspection);
    const receipt=JSON.stringify(inspection.receipt,null,2),accounting=record(inspection.receipt.generation_receipt);
    const managed=record(record(inspection.receipt.artifact_checkpoint).managed_inputs);
    const managedScenes=Array.isArray(managed.scenes)?managed.scenes.map(record):[];
    const anchor=record(managed.anchor);
    const managedVideo=isManagedVideoInspection(inspection.receipt);
    const privateInput=record(inspection.receipt.private_input);
    const render=record(inspection.receipt.render??privateInput.render);
    const model3dSettings=record(render.parameters??render.model3d_settings??render.settings??record(privateInput.request).model3d_settings??record(record(inspection.receipt.artifact).settings).model3d_settings);
    const model3d=inspection.receipt.artifact_kind==="model3d"||record(inspection.receipt.artifact).artifact_kind==="model3d"||record(inspection.receipt.job).artifact_kind==="model3d"||accounting.artifact_kind==="model3d"||Object.keys(model3dSettings).length>0&&String(render.model??accounting.model??"").includes("rodin");
    const rawModel3dPrompt=render.submitted_prompt??render.submittedPrompt;
    const prompt=model3d&&typeof rawModel3dPrompt==="string"?rawModel3dPrompt:inspection.prompt;
    const frozenInputs=Array.isArray(inspection.receipt.frozen_inputs)?inspection.receipt.frozen_inputs.map(record):[];
    const frozenReferences=frozenInputs.flatMap((input)=>Array.isArray(input.reference_inputs)?input.reference_inputs:[]);
    const references=Array.isArray(render.reference_inputs)?render.reference_inputs:Array.isArray(render.referenceInputs)?render.referenceInputs:Array.isArray(inspection.receipt.reference_inputs)?inspection.receipt.reference_inputs:frozenReferences;
    const providerContacted=accounting.provider_contacted;
    const promptLabel=managedVideo?"Retained prompt":providerContacted===true?"Submitted prompt":providerContacted===false?"Prepared prompt":"Retained prompt";
    const knownStatuses=new Set(["not_submitted","submitted","completed","rejected","prepared","preparing","unavailable","submission_unknown","unknown","not_transmitted","transmitted","estimated","authorizing","active","executing","settled","released","local_persistence","source_fidelity_validation","provider","application","planning","queue"]);
    const status=(value:unknown)=>typeof value==="string"?knownStatuses.has(value)?this.i18n.system(value.replaceAll("_"," ")):value.replaceAll("_"," "):this.i18n.system("unknown");
    const dollars=(value:unknown)=>typeof value==="number"&&Number.isFinite(value)?`$${(value/1_000_000).toFixed(6)}`:this.i18n.system("Not yet confirmed");
    const facts:Array<[string,string|null]>=[
      ["Provider",accounting.provider?`${String(accounting.provider)}${accounting.model?` · ${String(accounting.model)}`:""}`:null],
      ["Authored slides",typeof accounting.authored_slide_count==="number"?this.i18n.number(accounting.authored_slide_count):null],
      ["Requested slides",typeof accounting.requested_slide_count==="number"?this.i18n.number(accounting.requested_slide_count):null],
      ["Predicted slides",typeof accounting.predicted_slide_count==="number"?this.i18n.number(accounting.predicted_slide_count):null],
      ["Completed slides",typeof accounting.actual_slide_count==="number"?this.i18n.number(accounting.actual_slide_count):null],
      ["Provider batches",typeof accounting.batch_count==="number"?this.i18n.number(accounting.batch_count):null],
      ["Recorded provider calls",typeof accounting.actual_provider_call_count==="number"?this.i18n.number(accounting.actual_provider_call_count):null],
      ["Planning calls",typeof accounting.actual_planner_call_count==="number"?this.i18n.number(accounting.actual_planner_call_count):null],
      ["Media calls",typeof accounting.actual_media_call_count==="number"?this.i18n.number(accounting.actual_media_call_count):null],
      ["Unconfirmed submissions",typeof accounting.unresolved_provider_call_count==="number"&&accounting.unresolved_provider_call_count>0?this.i18n.number(accounting.unresolved_provider_call_count):accounting.provider_submission_uncertain===true?this.i18n.system("unknown"):null],
      ["Planning call forecast",accounting.provider_call_forecast_scope==="planning"&&typeof accounting.maximum_provider_call_count==="number"?this.i18n.system("{minimum}–{maximum} possible",{minimum:this.i18n.number(Number(accounting.minimum_provider_call_count??accounting.planned_provider_call_count??1)),maximum:this.i18n.number(accounting.maximum_provider_call_count)}):null],
      ["Retained clips",typeof accounting.retained_clip_count==="number"?this.i18n.number(accounting.retained_clip_count):null],
      ["Call breakdown",accounting.provider_call_breakdown_complete===false?this.i18n.system("Partial retained evidence"):null],
      ["Provider request",accounting.provider_request_status?status(accounting.provider_request_status):null],
      ["Provider contacted",accounting.provider_request_status?providerContacted===true?this.i18n.system("Yes"):providerContacted===false?this.i18n.system("No"):this.i18n.system("Not yet confirmed"):null],
      ["Source transmission",accounting.source_transmission_status?status(accounting.source_transmission_status):null],
      ["Reserved amount",typeof accounting.reservation_microusd==="number"?dollars(accounting.reservation_microusd):null],
      ["Application spending ceiling",accounting.reservation_is_application_hard_cap===true&&typeof accounting.maximum_authorized_cost_microusd==="number"?dollars(accounting.maximum_authorized_cost_microusd):null],
      ["Settled cost",typeof accounting.settled_cost_microusd==="number"?dollars(accounting.settled_cost_microusd):accounting.provider_request_status?this.i18n.system("Not yet confirmed"):null],
      ["Reservation",accounting.reservation_status?status(accounting.reservation_status):null],
      ["Failure stage",accounting.failure_stage?status(accounting.failure_stage):null],
    ].filter((entry):entry is [string,string]=>entry[1]!==null);
    const description=inspection.retained?failed?this.i18n.system("These are the retained inputs captured before the attempt failed. They are not rebuilt from the document’s current state."):running?this.i18n.system("These are the immutable private inputs captured when this in-progress generation was accepted."):this.i18n.system("This is the retained input receipt for the completed output. It is not rebuilt from the document’s current state."):failed?this.i18n.system("Only the surviving job and event receipt is available; private inputs expired or were not captured for this earlier failure."):running?this.i18n.system("The accepted generation receipt is available, but its private inputs have not been loaded."):this.i18n.system("Only the surviving public receipt is available for this older output.");
    return html`<dialog class="generation-input-dialog" aria-labelledby=${this.#titleId} closedby="any" @click=${this.#backdrop} @close=${(event:Event)=>{if(this.open&&event.currentTarget===this.renderRoot.querySelector("dialog")&&!(event.currentTarget as HTMLDialogElement).open){this.#retireAccounting();this.open=false;this.dispatchEvent(new CustomEvent("generation-input-close",{bubbles:true,composed:true}));this.requestUpdate();}}}>
      <article><header><div><span>${subtitle}</span><h2 id=${this.#titleId}>${title}</h2><p>${description}</p></div><button class="icon-button" aria-label="Close generation inputs" @click=${()=>this.#close()}>${icon("close")}</button></header>
      <div class="generation-input-body">
        ${storyboard?html`<section class="saved-storyboard-inspection" aria-label=${this.i18n.system("Saved storyboard preview")}>
          <header><div><h3>${this.i18n.system("{saved} of {total} frames recorded · Incomplete",{saved:this.i18n.number(storyboard.recordedFrameCount),total:this.i18n.number(storyboard.totalFrameCount)})}</h3><p>${this.i18n.system("Original request source, not current approval. Viewing does not generate, replace, approve, or release any work or budget hold.")}</p></div></header>
          ${storyboard.title?html`<h4>${storyboard.title}</h4>`:nothing}${storyboard.summary?html`<p>${storyboard.summary}</p>`:nothing}
          ${storyboard.sourceRevision?html`<p class="saved-storyboard-source">${this.i18n.system("Original source revision")}: <code>${storyboard.sourceRevision}</code></p>`:nothing}
          <ol class="saved-storyboard-frames">${storyboard.frames.map((frame)=>html`<li>
            <figure>${frame.mediaUrl&&!this.#unavailableFrames.has(frame.mediaUrl)?html`<img src=${frame.mediaUrl} alt=${frame.title||this.i18n.system("Storyboard shot {storyboard_sequence}",{storyboard_sequence:String(frame.index)})} loading="lazy" referrerpolicy="no-referrer" @error=${()=>this.#frameUnavailable(frame.mediaUrl!)}>`:html`<div class="saved-storyboard-placeholder" role="img" aria-label=${this.i18n.system(frame.recorded?"Recorded image unavailable":"No image recorded")}><span>${this.i18n.number(frame.index)}</span><p>${this.i18n.system(frame.recorded?"Recorded image unavailable":"No image recorded")}</p></div>`}
              <figcaption><span>${this.i18n.system("Storyboard shot {storyboard_sequence}",{storyboard_sequence:String(frame.index)})}</span><h4>${frame.title}</h4><p>${frame.body}</p>
                ${frame.recorded?html`<small>${this.i18n.system("Recorded provider and model")}: ${frame.provider||this.i18n.system("unknown")}${frame.model?` · ${frame.model}`:""}</small>`:nothing}
                ${frame.notes||frame.imagePrompt?html`<details><summary>${this.i18n.system("Original shot direction")}</summary>${frame.notes?html`<p>${frame.notes}</p>`:nothing}${frame.imagePrompt?html`<p>${frame.imagePrompt}</p>`:nothing}</details>`:nothing}
              </figcaption>
            </figure>
          </li>`)}</ol>
        </section>`:nothing}
        ${facts.length?html`<section class="generation-receipt-summary"><header><div><h3>Generation receipt</h3><p>Verified provider, source-transmission, slide-count, reservation, and settlement details for this attempt.</p></div></header><dl>${facts.map(([label,value])=>html`<div><dt>${this.i18n.system(label)}</dt><dd>${value}</dd></div>`)}</dl>${accounting.slide_count_mismatch===true?html`<p role="status">The requested slide count intentionally differs from the authored outline.</p>`:nothing}${accounting.reservation_is_application_hard_cap===true?html`<p>Forma checks the remaining application spending ceiling before every provider request or repair. This is not a provider-enforced spending cap.</p>`:accounting.reservation_is_provider_hard_cap===false?html`<p>A reservation is an application estimate, not a provider-enforced spending cap. Bounded repair calls may add billable usage.</p>`:nothing}</section>`:nothing}
        ${this.#accountingTemplate()}
        ${model3d?html`<section class="model3d-input-receipt"><header><div><h3>${this.i18n.t("model3d.receipt.heading","3D generation inputs")}</h3><p>${this.i18n.t("model3d.receipt.help","The retained prompt, image order, and provider settings identify this attempt. Inspecting them does not start or retry generation.")}</p></div></header><dl>
          <div><dt>${this.i18n.t("model3d.receipt.promptCharacters","Prompt characters")}</dt><dd>${this.i18n.number(model3dPromptLength(prompt))}</dd></div>
          <div><dt>${this.i18n.t("model3d.receipt.referenceCount","Ordered image references")}</dt><dd>${this.i18n.number(references.length)}</dd></div>
          ${model3dSettings.geometry_file_format?html`<div><dt>${this.i18n.t("model3d.receipt.format","Requested mesh format")}</dt><dd>${String(model3dSettings.geometry_file_format).toUpperCase()}</dd></div>`:nothing}
          ${model3dSettings.tier?html`<div><dt>${this.i18n.t("model3d.receipt.tier","Geometry tier")}</dt><dd>${String(model3dSettings.tier)}</dd></div>`:nothing}
          ${model3dSettings.material?html`<div><dt>${this.i18n.t("model3d.receipt.material","Material")}</dt><dd>${String(model3dSettings.material)}</dd></div>`:nothing}
        </dl>${Object.keys(model3dSettings).length?html`<details><summary>${this.i18n.t("model3d.receipt.settings","Retained 3D settings")}</summary><textarea readonly spellcheck="false" .value=${JSON.stringify(model3dSettings,null,2)} aria-label=${this.i18n.t("model3d.receipt.settings","Retained 3D settings")}></textarea></details>`:html`<p>${this.i18n.t("model3d.receipt.settingsUnavailable","The exact 3D settings were not retained in this receipt.")}</p>`}</section>`:nothing}
        ${managedVideo?html`<section class="managed-production-inputs"><header><div><h3>${this.i18n.system("Managed production inputs")}</h3><p>${this.i18n.system("Private retained evidence only. Inspection does not generate, retry, approve, or change a budget hold.")}</p></div></header>
          ${!managedScenes.length?html`<p>${this.i18n.system("Per-scene provider inputs are unavailable. The overall retained prompt does not establish submitted scene parameters.")}</p>`:nothing}
          ${Object.keys(anchor).length?html`<details><summary>${this.i18n.system("Continuity anchor")}</summary><p>${String(anchor.provider??"")} · ${String(anchor.model??"")}</p><p>${this.i18n.system("Request ID")}: <code>${String(anchor.provider_request_id??this.i18n.system("Not yet confirmed"))}</code></p><p>${this.i18n.system("Parameter receipt unavailable")}</p></details>`:nothing}
          ${managedScenes.map((scene)=>html`<details><summary>${this.i18n.system("Scene {count}",{count:this.i18n.number(Number(scene.narrative_order??0))})} · ${status(scene.request_status)}</summary><p>${String(scene.provider??"")} · ${String(scene.model??"")}</p><p>${this.i18n.system("Request ID")}: <code>${String(scene.provider_request_id??this.i18n.system("Not yet confirmed"))}</code></p><p>${status(scene.input_status)}</p>${scene.render_input?html`<textarea readonly spellcheck="false" .value=${JSON.stringify(scene.render_input,null,2)} aria-label=${this.i18n.system("Scene {count} input receipt",{count:this.i18n.number(Number(scene.narrative_order??0))})}></textarea>`:html`<p>${this.i18n.system("Parameter receipt unavailable")}</p>`}</details>`)}
        </section>`:nothing}
        ${prompt?html`<section><header><div><h3>${this.i18n.system(promptLabel)}</h3><p>${managedVideo?managedScenes.length?this.i18n.system("Inspect per-scene inputs for the exact prepared or submitted provider parameters."):this.i18n.system("Per-scene provider inputs are unavailable. The overall retained prompt does not establish submitted scene parameters."):providerContacted===true?failed?this.i18n.system("The exact retained prompt associated with the failed provider request."):this.i18n.system("The exact retained prompt sent to the generation provider."):providerContacted===false?this.i18n.system("The retained prompt was prepared locally and has not been submitted to a provider."):this.i18n.system("The retained prompt is available, but provider submission has not been confirmed.")}</p></div><button class="button secondary compact" @click=${()=>this.#copy(prompt,"Prompt")}>Copy prompt</button></header><textarea readonly spellcheck="false" .value=${prompt} aria-label=${this.i18n.system("{promptLabel} for generation", { promptLabel: this.i18n.system(promptLabel) })}></textarea></section>`:nothing}
        ${references.length?html`<section><header><div><h3>Reference pixels</h3><p>${references.length} ordered reference image${references.length===1?" " + this.i18n.system("was"):this.i18n.system("s were")} supplied or prepared. Pixel receipts show whether bytes reached the provider and include hashes without duplicating private image data.</p></div></header><ol class="generation-reference-receipts">${references.map((value,index)=>{const item=record(value);return html`<li><b>${String(item.label??`Reference ${index+1}`)}</b><span>${item.storyboard_sequence?this.i18n.system("Storyboard shot {storyboard_sequence}", { storyboard_sequence: String(item.storyboard_sequence) }):this.i18n.system("Reference {count}", { count: this.i18n.number(index+1) })} · ${String(item.mode??(model3d?this.i18n.t("model3d.receipt.imageView","Image view"):"context"))}</span><small>${item.pixels_submitted===true||model3d&&(accounting.source_transmission_status==="transmitted"||providerContacted===true||Boolean(render.providerJobId))?this.i18n.system("Pixels submitted"):item.pixels_submitted===false?this.i18n.system("Metadata only"):model3d?this.i18n.t("model3d.receipt.referencePrepared","Prepared image; check the source-transmission receipt."):this.i18n.system("Prepared before failure")}${(item.byte_length??item.byteLength)?" " + this.i18n.system("· {formatted} bytes", { formatted: Number(item.byte_length??item.byteLength).toLocaleString(this.i18n.locale) }):""}${item.sha256?` · SHA-256 ${String(item.sha256).slice(0,16)}…`:""}</small>${item.shot_direction?html`<p>${String(item.shot_direction)}</p>`:nothing}</li>`;})}</ol></section>`:nothing}
        <section><header><div><h3>Complete input receipt</h3><p>Frozen document state, request settings, provider parameters, provenance, reference ordering, and any technical failure.</p></div><button class="button secondary compact" @click=${()=>this.#copy(receipt,"Input receipt")}>Copy receipt</button></header><textarea class="generation-input-receipt" readonly spellcheck="false" .value=${receipt} aria-label="Complete generation input receipt"></textarea></section>
      </div><footer><span>${inspection.retained?failed?this.i18n.system("Retained failed-attempt input"):running?this.i18n.system("Retained in-progress input"):this.i18n.system("Retained private input"):failed?this.i18n.system("Partial failure receipt"):running?this.i18n.system("Partial in-progress receipt"):this.i18n.system("Partial legacy receipt")}</span><button class="button primary" @click=${()=>this.#close()}>Done</button></footer></article>
    </dialog>`;
  }
}

const record=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
if (!customElements.get("forma-generation-input-dialog")) customElements.define("forma-generation-input-dialog",GenerationInputDialog);
declare global{interface HTMLElementTagNameMap{"forma-generation-input-dialog":GenerationInputDialog}}
