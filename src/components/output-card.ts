import { html, nothing } from "lit";
import "./generated-image-editor";
import { readGeneratedImagePng, type GeneratedImageEditorOpening } from "./generated-image-editor";
import { inspectOutputAsset } from "../model/output-asset-inspection";
import { captureOutputNavigationFocus } from "./output-navigation-focus";
import { generatedImageEditMessage } from "./design-system/locales/generated-image-edit-messages";
import { FormaElement, icon, downloadJson } from "./forma-element";
import { creatorAxisIconName } from "./icon-semantics";
import { isDraftOutput, outputQualityLabel, type CreativeOutput } from "../model/events";
import { CREATOR_AXES } from "../model/taste";
import { outputGenerationInputInspection } from "../model/generation-inputs";
import { describeOutput, imageOutputNamingCandidate } from "../model/output-naming";
import { requestDialogText } from "./modal-dialog";
import type { OutputVisual } from "./output-visual";
import type { CommandDeparture } from "./command-departure";
import { reuseManualOutput, type ManualOutputReuse } from "./manual-output-reuse";
import type { FormaUiPopover } from "./design-system/feedback";
import "./design-system/feedback";
import "./output-card.css";
import "./icons-authoring";
import "./output-visual";
import "./generation-input-dialog";

export class OutputCard extends FormaElement {
  static properties = { output: { attribute: false }, primary: { type: Boolean } };
  output!: CreativeOutput; primary = false;
  #critiqueOpen=false;#inputsOpen=false;#axis="style";#polarity:"positive"|"negative"="negative";#value="";#note="";
  #actionsCurrent:(()=>boolean)|null=null;
  #actionsPopover(){return this.querySelector<FormaUiPopover>(".output-actions-popover");}
  protected override willUpdate(){if(this.#actionsCurrent&&!this.#actionsCurrent())this.#actionsPopover()?.close();if(this.#imageEdit&&!this.#imageEdit.current()){this.#imageEditEpoch++;this.#imageEdit=null;this.#imageEditOpener=null;this.#imageEditReturnCurrent=null;}}
  #outputReuse:ManualOutputReuse={cancel:null};
  #imageEdit:GeneratedImageEditorOpening|null=null;
  #imageEditOpener:HTMLButtonElement|null=null;
  #imageEditEpoch=0;
  #imageEditReturnCurrent:(()=>boolean)|null=null;
  #imageEditEligible(){
    const session=this.store.session.get(),output=this.output,projection=this.store.projection.get();
    return Boolean(this.isConnected&&session&&!session.projectContext&&!session.impersonation&&session.policy.accepted
      &&(session.user.role==="creator"||session.user.role==="admin")&&output&&output.documentId===projection.documentId
      &&output.mediaType==="image/png"&&output.quality==="high"&&output.purpose==="final"&&!output.discarded);
  }
  #openImageEdit(event:Event){
    const button=event.currentTarget;
    if(!(button instanceof HTMLButtonElement)||button!==this.querySelector("[data-generated-image-edit]")||button.disabled
      ||this.#imageEdit||!this.#imageEditEligible())return;
    const store=this.store,source=store.captureSourceOwnership(),authorization=store.captureAuthorizationScope(),route=store.route.get();
    const projection=store.projection.get(),output=this.output,ownerId=store.session.get()!.user.userId;
    if(!authorization||authorization.shared||!store.sourceOwnershipActive(source))return;
    const token=Object.freeze({}),epoch=++this.#imageEditEpoch;
    const returnCurrent=()=>this.isConnected&&this.store===store&&this.#imageEditEligible()&&store.sourceOwnershipActive(source)&&store.authorizationScopeActive(authorization)
      &&store.route.get()===route&&store.projection.get().projectId===projection.projectId
      &&store.projection.get().documentId===projection.documentId&&this.output?.id===output.id
      &&this.output.sourceEventId===output.sourceEventId&&this.output.generationId===output.generationId
      &&this.output.contentRef===output.contentRef;
    const current=()=>returnCurrent()&&this.#imageEdit?.token===token&&this.#imageEditEpoch===epoch;
    this.#imageEditReturnCurrent=returnCurrent;
    this.#imageEdit=Object.freeze({token,ownerId,projectId:projection.projectId,documentId:projection.documentId,outputId:output.id,current,
      read:()=>store.loadGeneratedImageEdit(output.id,{current}),
      capture:(sourceId:string)=>store.captureGeneratedImageEdit(output.id,sourceId,{current}),
      adopt:async()=>{if(!current())return false;const result=await store.addImageOutputAsContext(output.id,projection.documentId,"generated-image-editor",{reveal:false,current});
        return Boolean(current()&&result&&!("publication"in result)&&result.rootBlockId);},
      save:(request,bytes)=>store.reviseGeneratedImage(output.id,request,bytes,{current}),
      check:(operationSha256:string)=>store.checkGeneratedImageEdit(output.id,operationSha256,{current}),
    } satisfies GeneratedImageEditorOpening);
    this.#imageEditOpener=button;this.requestUpdate();
  }
  async #closeImageEdit(event:CustomEvent<{opening:GeneratedImageEditorOpening;reason:string}>){
    const opening=this.#imageEdit,host=this.querySelector("forma-generated-image-editor");
    if(!opening||event.currentTarget!==host||event.detail.opening!==opening)return;
    const owner=this.ownerDocument,active=owner.activeElement,opener=this.#imageEditOpener,returnCurrent=this.#imageEditReturnCurrent;
    const returnFocus=event.detail.reason!=="retired"&&opening.current()&&owner.hasFocus()&&Boolean(active&&host?.contains(active));
    const focus=returnFocus?captureOutputNavigationFocus(owner):null;
    const epoch=++this.#imageEditEpoch;this.#imageEdit=null;this.#imageEditOpener=null;this.#imageEditReturnCurrent=null;this.requestUpdate();
    try{
    await this.updateComplete;
    if(!focus?.current()||!returnFocus||!returnCurrent?.()||!this.isConnected||this.#imageEditEpoch!==epoch||this.#imageEdit||!opener?.isConnected||opener.disabled
      ||opener!==this.querySelector("[data-generated-image-edit]")||!this.#imageEditEligible()||!owner.hasFocus()
      ||owner.activeElement!==owner.body&&owner.activeElement!==active&&owner.activeElement!==opener)return;
    for(let node:HTMLElement|null=opener;node;node=node.parentElement){const style=getComputedStyle(node);
      if(node.hidden||node.inert||style.display==="none"||style.visibility!=="visible"||Number(style.opacity)===0)return;}
    if(opener.getClientRects().length)focus.run(opener,()=>{opener.focus({preventScroll:true});return owner.activeElement===opener;});
    }finally{focus?.dispose();}
  }
  // Opening changes and actual field edits share this cleanup-freshness token.
  #critiqueOpening=0;
  override disconnectedCallback(){this.#imageEditEpoch++;this.#imageEdit=null;this.#imageEditOpener=null;this.#imageEditReturnCurrent=null;this.#critiqueOpening++;this.#outputReuse.cancel?.();this.#actionsCurrent=null;this.#actionsPopover()?.close();super.disconnectedCallback();}
  captureCommandDeparture():CommandDeparture{
    const store=this.store,id=this.output?.id,documentId=this.output?.documentId;
    return {element:this,current:()=>this.isConnected&&this.store===store&&this.output?.id===id&&this.output?.documentId===documentId,
      // Axis/polarity alone are retained selectors, not an authored claim.
      blocked:()=>Boolean(this.#imageEdit||this.#value||this.#note||store.busy.get()==="critique-object"),
      reason:()=>"next.lifecycle.currentWorkOpen"};
  }
  #setCritiqueOpen(open:boolean){
    if(this.#critiqueOpen===open)return;
    this.#critiqueOpening++;this.#critiqueOpen=open;this.requestUpdate();
  }
  async #saveCritique(event:SubmitEvent){
    event.preventDefault();if(!this.#value.trim())return;
    const store=this.store,source=store.captureSourceOwnership(),outputId=this.output.id;
    const outputDocumentId=this.output.documentId,outputEventId=this.output.sourceEventId;
    const opening=this.#critiqueOpening,{projectId,documentId}=store.projection.get();
    const original={axis:this.#axis,polarity:this.#polarity,value:this.#value,note:this.#note};
    const saved=await store.critiqueObject(outputId,original.axis,original.polarity,original.value.trim(),original.note.trim());
    // An exact original ACK does not own a later draft or a reopened form.
    if(!saved||!this.isConnected||this.store!==store||!store.sourceOwnershipActive(source)
      ||this.output?.id!==outputId||this.output.documentId!==outputDocumentId||this.output.sourceEventId!==outputEventId
      ||store.projection.get().projectId!==projectId||store.projection.get().documentId!==documentId
      ||!this.#critiqueOpen||this.#critiqueOpening!==opening
      ||this.#axis!==original.axis||this.#polarity!==original.polarity||this.#value!==original.value||this.#note!==original.note)return;
    this.#value="";this.#note="";this.#setCritiqueOpen(false);
  }
  async #renameOutput(output:CreativeOutput,title:string){
    const next=await requestDialogText({title:this.i18n.system("Rename {documentTitle}",{documentTitle:title}),label:this.i18n.system("Name"),value:title,confirmLabel:this.i18n.system("Save name"),cancelLabel:this.i18n.t("action.cancel","Cancel")});
    const name=next?.normalize("NFC").trim();if(!name||name===title)return;
    await this.store.append({type:"OutputRenamed",payload:{output_id:output.id,object_id:output.id,output_kind:"image",document_id:output.documentId,project_id:this.store.projection.get().projectId,old_title:title,new_title:name,source_surface:"output-card"}});
  }
  async #generateFull(out:CreativeOutput){this.store.patchUi({selectedOutputId:out.id});const readiness=await this.store.ensureGenerationReadiness("generate",{sourcePreviewId:out.id,sourceSurface:"output-card"});if(readiness?.status==="ready"||readiness?.status==="review"&&this.store.generationRiskAcknowledged(readiness.requestKey))return this.store.generate({sourceSurface:"output-card",sourcePreviewId:out.id});this.store.toast(readiness?.status==="review"?"Review and acknowledge the generation warning in the document controls first.":readiness?.summary??"Generation readiness could not be confirmed.");}
  async #exportEditedImage(){
    const store=this.store,output=this.output,edit=output.imageRevision,source=store.captureSourceOwnership(),authorization=store.captureAuthorizationScope();
    const route=store.route.get(),document=store.projection.get().documents.find(item=>item.id===output.documentId);
    if(!edit||!authorization||authorization.shared||!output.mediaUrl||!document)return;
    const proof=JSON.stringify({id:output.id,documentId:output.documentId,sourceEventId:output.sourceEventId,generationId:output.generationId,
      contentRef:output.contentRef,mediaUrl:output.mediaUrl,mediaType:output.mediaType,width:output.width,height:output.height,imageRevision:edit});
    const current=()=>{
      const now=store.projection.get().libraryOutputs.find(item=>item.id===output.id);
      return Boolean(this.isConnected&&this.store===store&&this.output.id===output.id&&now&&!now.discarded
        &&store.sourceOwnershipActive(source)&&store.authorizationScopeActive(authorization)&&store.route.get()===route
        &&store.projection.get().documentId===output.documentId&&store.projection.get().projectId===document.projectId
        &&JSON.stringify({id:now.id,documentId:now.documentId,sourceEventId:now.sourceEventId,generationId:now.generationId,
          contentRef:now.contentRef,mediaUrl:now.mediaUrl,mediaType:now.mediaType,width:now.width,height:now.height,imageRevision:now.imageRevision})===proof);
    };
    if(!current())return;
    const controller=new AbortController(),unsubscribe=store.subscribe(()=>{if(!current())controller.abort();});
    let bytes:Uint8Array<ArrayBuffer>|null=null,url="";
    try{
      bytes=await readGeneratedImagePng(output.mediaUrl,controller,current);
      const inspected=await inspectOutputAsset(bytes,"edited.png",{snapshot:false});
      if(!current()||inspected.status!=="inspected"||inspected.extension!=="png"||inspected.mimeType!=="image/png"
        ||inspected.sha256!==edit.mediaSha256||bytes.byteLength!==edit.byteLength||inspected.facts.width!==output.width||inspected.facts.height!==output.height)return;
      const receipt={type:"ObjectExported",payload:{object_id:output.id,destination_class:"download",format:"image/png",
        image_edit_event_id:edit.editEventId,image_revision:edit.revision,source_content_hash:edit.mediaSha256,source_surface:"edited-image-output-card"}};
      if(!await store.authorizeProjectExport(receipt,authorization)||!current())return;
      const title=(imageOutputNamingCandidate(output,store.content.get(),document.title).title??output.id).normalize("NFKC")
        .replace(/[\p{Cc}/\\:*?"<>|]/gu," ").replace(/\s+/gu," ").replace(/^\.+/u,"").trim().slice(0,100)||output.id;
      url=URL.createObjectURL(new Blob([bytes],{type:"image/png"}));const anchor=this.ownerDocument.createElement("a");
      anchor.href=url;anchor.download=`${title}-revision-${edit.revision}.png`;if(current())anchor.click();
    }catch{if(current())store.toast(this.i18n.system("The generated image could not be downloaded."));}
    finally{controller.abort();unsubscribe();bytes?.fill(0);if(url)URL.revokeObjectURL(url);}
  }
  async #exportOutput(){if(this.output.imageRevision)return this.#exportEditedImage();const out=this.output,authorization=this.store.captureAuthorizationScope();if(!authorization)return;const documentTitle=this.store.projection.get().documents.find((document)=>document.id===out.documentId)?.title??"";const filename=(imageOutputNamingCandidate(out,this.store.content.get(),documentTitle).title??out.id).normalize("NFKC").replace(/[\p{Cc}/\\:*?"<>|]/gu," ").replace(/\s+/gu," ").replace(/^\.+/u,"").trim().slice(0,120)||out.id;if(out.mediaUrl){const response=await fetch(out.mediaUrl);if(!this.store.authorizationScopeActive(authorization))return;if(!response.ok){this.store.toast("The generated image could not be downloaded.");return;}const blob=await response.blob();if(!this.store.authorizationScopeActive(authorization))return;const mime=out.mediaType??blob.type??"image/png",receipt={type:"ObjectExported",payload:{object_id:out.id,destination_class:"download",format:mime}};if(!await this.store.authorizeProjectExport(receipt,authorization))return;if(!this.store.authorizationScopeActive(authorization))return;const url=URL.createObjectURL(blob),anchor=document.createElement("a"),extension=mime==="image/jpeg"?"jpg":mime==="image/webp"?"webp":"png";anchor.href=url;anchor.download=`${filename}.${extension}`;anchor.click();URL.revokeObjectURL(url);return;}const receipt={type:"ObjectExported",payload:{object_id:out.id,destination_class:"download",format:"application/json"}};if(!await this.store.authorizeProjectExport(receipt,authorization))return;if(!this.store.authorizationScopeActive(authorization))return;downloadJson(`${filename}.json`,{output:out,context:this.store.projection.get().latestCompile,clearance:"owned"});}
  async #useAsInput(event:MouseEvent){
    const output=this.output,destination=this.store.projection.get().documentId;
    await reuseManualOutput(this,this.store,this.#outputReuse,event,{
      destinationDocumentId:destination,
      current:()=>this.output?.id===output.id&&this.output.documentId===output.documentId
        &&this.output.sourceEventId===output.sourceEventId&&this.output.mediaUrl===output.mediaUrl&&!this.output.discarded,
      copy:()=>this.store.addImageOutputAsContext(output.id,destination,"output-card",{reveal:false}),
    });
    this.requestUpdate();
  }
  override render() {
    const out = this.output; if (!out) return html``;
    const context=this.store.session.get()?.projectContext;
    const canAuthor=!context||context.permissions.includes("project.author");
    const canGenerate=!context||context.permissions.includes("project.output.request");
    const raw = out.contentRef ? this.store.content.get()[out.contentRef] : ""; let direction: Record<string, unknown> | null = null;
    if (raw) { try { direction = JSON.parse(raw) as Record<string, unknown>; } catch { direction = { rationale: raw }; } }
    const inspection=outputGenerationInputInspection(out,this.store.events.get(),this.store.content.get());
    const projection=this.store.projection.get(),retained=this.store.content.get();
    const document=projection.documents.find((candidate)=>candidate.id===out.documentId);
    const namingCandidate=imageOutputNamingCandidate(out,retained,document?.title??"Creative result");
    const documentNames=new Map(projection.documents.map(document=>[document.id,document.title]));
    for(const output of [...projection.libraryOutputs,out])if(!documentNames.has(output.documentId))documentNames.set(output.documentId,this.i18n.system("Project document"));
    const outputDocuments=[...documentNames].map(([id,title])=>({id,title}));
    const peers=projection.libraryOutputs.map(candidate=>imageOutputNamingCandidate(candidate,retained,documentNames.get(candidate.documentId)??""));
    const presentation=describeOutput(namingCandidate,peers,{events:this.store.events.get(),locale:this.i18n.locale,timeZone:this.i18n.timeZone,formatTake:(take)=>this.i18n.t("output.take","Take {number}",{number:this.i18n.number(take)}),scopedLabels:{documents:outputDocuments,formatDocument:(number)=>this.i18n.t("artifact.delivery.documentQualifier","Document {number}",{number:this.i18n.number(number)}),formatResult:(number)=>this.i18n.t("artifact.delivery.resultQualifier","Result {number}",{number:this.i18n.number(number)})}});
    const title=presentation.title,actionContext=presentation.displayScope?.context??`\u2068${title}\u2069`;
    // A reader has only Download beside Open: a one-option menu adds no value.
    const groupActions=Boolean(out.mediaUrl&&canAuthor);
    const source=this.store.captureSourceOwnership(),route=this.store.route.get();
    const current=()=>{
      const latest=this.store.projection.get(),value=latest.libraryOutputs.find(candidate=>candidate.id===out.id);
      return Boolean(this.isConnected&&this.store.sourceOwnershipActive(source)&&route===this.store.route.get()
        &&latest.projectId===projection.projectId&&this.output?.id===out.id&&value?.documentId===out.documentId
        &&value.sourceEventId===out.sourceEventId&&value.sequence===out.sequence&&value.contentRef===out.contentRef
        &&value.mediaUrl===out.mediaUrl&&value.pinned===out.pinned&&value.saved===out.saved&&value.title===out.title);
    };
    this.#actionsCurrent=groupActions?current:null;
    const secondaryAction={capture:true,handleEvent:(event:Event)=>{
      const action=(event.target as Element|null)?.closest("button,a");
      if(!action)return;
      const menu=this.#actionsPopover(),owned=current()&&Boolean(menu?.querySelector(".ui-popover-panel")?.matches(":popover-open"));
      // Reuse must admit its still-visible native trigger before the original copy.
      if(!owned||action.getAttribute("data-output-reuse")===null)menu?.close(owned);
      if(!owned){event.preventDefault();event.stopImmediatePropagation();}
    }};
    const secondaryButtons=html`
        ${canAuthor?html`<button type="button" class="output-rename" aria-label=${this.i18n.system("Rename {documentTitle}",{documentTitle:title})} @click=${()=>void this.#renameOutput(out,title)}>${icon("edit")} ${this.i18n.system("Rename")}</button><button aria-pressed=${out.pinned} @click=${() => this.store.append({ type: out.pinned ? "ObjectUnpinned" : "ObjectPinned", payload: { object_id: out.id, scope: "project" } })}>${icon("pin")} ${out.pinned ? this.i18n.system("Pinned") : this.i18n.system("Pin")}</button>
        <button aria-pressed=${out.saved} @click=${() => this.store.append({ type: "ObjectSaved", payload: { object_id: out.id } })}>${icon("check")} ${out.saved ? this.i18n.system("Saved") : this.i18n.system("Save")}</button>`:nothing}
        ${!context?html`<button aria-expanded=${this.#critiqueOpen} @click=${()=>this.#setCritiqueOpen(!this.#critiqueOpen)}>${icon("edit")} Taste evidence</button>`:nothing}
        ${!context?html`<button @click=${()=>{this.#inputsOpen=true;this.requestUpdate();}}>${icon("info")} Inspect inputs</button>`:nothing}
        ${canAuthor?html`<button data-output-reuse @click=${(event:MouseEvent)=>this.#useAsInput(event)}>${icon("plus")} ${this.store.route.get().startsWith("/canvas/")?this.store.projection.get().blocks.some((block)=>block.properties.source_output_id===out.id)?this.i18n.t("projects.editCreator","Edit in Creator Workspace"):this.i18n.t("projects.useEditCreator","Use & edit in Creator Workspace"):this.store.projection.get().blocks.some((block)=>block.properties.source_output_id===out.id)?this.i18n.system("Edit input"):this.i18n.system("Use & edit input")}</button>`:nothing}
        ${!context||out.mediaUrl?html`<button type="button" @click=${()=>this.#exportOutput()}>${icon("download")} ${context?this.i18n.t("projects.downloadMedia","Download media"):this.i18n.system("Export")}</button>`:nothing}
    `;
    const secondaryActions=html`<div class="output-secondary-actions" @click=${secondaryAction}>${secondaryButtons}</div>`;
    return html`<article class="output-card ${this.primary ? "primary" : ""} ${this.store.ui.selectedOutputId === out.id ? "selected" : ""}" data-output-id=${out.id}>
      <button class="output-art" aria-label=${this.i18n.system("Select {title}", { title: title })} aria-pressed=${this.store.ui.selectedOutputId === out.id} @click=${() => { this.store.patchUi({ selectedOutputId: out.id }); if (!context&&this.store.ui.instrumentation) void this.store.hot({ type: "ObjectViewed", payload: { object_id: out.id } }); }}><forma-output-visual .output=${out}></forma-output-visual></button>
      ${direction ? html`<div class="provider-direction"><span class="eyebrow">Creative direction</span><h3>${String(direction.title ?? "Creative direction")}</h3><p>${String(direction.rationale ?? direction.scene ?? "")}</p>${Array.isArray(direction.palette) ? html`<div>${direction.palette.map((color) => html`<span>${String(color)}</span>`)}</div>` : ""}</div>` : ""}
      <div class="output-info"><div><span class=${`output-quality ${isDraftOutput(out)?"draft":"full"}`}>${this.i18n.system(outputQualityLabel(out))}</span><b dir="auto">${title}</b><small>${presentation.disambiguator?`${presentation.disambiguator} · `:""}${out.width??1536} × ${out.height??1024} · ${this.i18n.system("Latency")} ${this.i18n.number(Number((out.latency / 1000).toFixed(1)),{minimumFractionDigits:1,maximumFractionDigits:1})}s${out.promotedFromId?" " + this.i18n.system("· refined from an earlier draft"):""}</small>${presentation.displayScope?.showDocument?html`<small class="output-context"><bdi>${presentation.displayScope.documentTitle}</bdi>${presentation.displayScope.qualifier?html` · <bdi>${presentation.displayScope.qualifier}</bdi>`:nothing}</small>`:nothing}<p class="output-next-step">${!canAuthor?this.i18n.t("projects.readOnlyOutput","Inspect this shared creative result and its project context."):out.saved||out.pinned?this.i18n.system("Kept for the next stage. You can still export it or record what worked."):isDraftOutput(out)?this.i18n.system("Decide whether to generate this draft at full quality, keep it, or record what should change."):this.i18n.system("Decide whether to pin, save, export, or record what should change next time.")}</p></div><div class="output-actions">
        ${out.mediaUrl?html`<button type="button" class="output-open" @click=${(event:MouseEvent)=>this.querySelector<OutputVisual>(".output-card-image-viewer")?.openImageViewer(event.currentTarget as HTMLElement)}>${icon("expand")} ${this.i18n.t("output.open","Open full image")}</button>`:nothing}
        ${this.#imageEditEligible()?html`<button type="button" data-generated-image-edit ?disabled=${Boolean(this.#imageEdit)} @click=${this.#openImageEdit}>${icon("edit")} ${generatedImageEditMessage(this.i18n.locale,"action")}</button>`:nothing}
        ${canGenerate&&isDraftOutput(out)?html`<button class="promote" ?disabled=${Boolean(this.store.busy.get())||this.store.documentJobActive("generate")} @click=${()=>this.#generateFull(out)}>${icon("spark")} ${this.store.documentJobActive("generate")?this.i18n.system("Generating safely…"):this.i18n.system("Generate full")}</button>`:nothing}
        ${groupActions?html`<forma-ui-popover class="output-actions-popover" .label=${this.i18n.t("action.more","More actions")} .triggerAccessibleName=${this.i18n.t("artifact.delivery.namedAction","{action} — {name}",{action:this.i18n.t("action.more","More actions"),name:actionContext})} .heading=${actionContext} .content=${secondaryActions}></forma-ui-popover>`:secondaryButtons}
      </div></div>${!context&&this.#critiqueOpen?html`<form class="output-critique" @submit=${this.#saveCritique}><header><div><span class="eyebrow">Authored taste evidence</span><h3>Teach the ranking, transparently</h3><p>Choose exactly what you are reacting to. This evidence can reorder future options; it never filters them.</p></div><button type="button" class="icon-button" aria-label="Close taste evidence" @click=${()=>this.#setCritiqueOpen(false)}>${icon("close")}</button></header><fieldset><legend>Creative axis</legend><div class="taste-axis-grid">${CREATOR_AXES.map(axis=>html`<button type="button" aria-pressed=${this.#axis===axis} @click=${()=>{if(this.#axis!==axis)this.#critiqueOpening++;this.#axis=axis;this.requestUpdate();}}><span>${icon(creatorAxisIconName(axis))}</span>${axis}</button>`)}</div></fieldset><fieldset><legend>Signal</legend><div class="taste-signal"><button type="button" class="positive" aria-pressed=${this.#polarity==="positive"} @click=${()=>{if(this.#polarity!=="positive")this.#critiqueOpening++;this.#polarity="positive";this.requestUpdate();}}>${icon("check")} Worked well</button><button type="button" class="negative" aria-pressed=${this.#polarity==="negative"} @click=${()=>{if(this.#polarity!=="negative")this.#critiqueOpening++;this.#polarity="negative";this.requestUpdate();}}>${icon("close")} Change next time</button></div></fieldset><label class="taste-value"><span>${this.#polarity==="positive"?this.i18n.system("What should Forma favor?"):this.i18n.system("What should Forma avoid or change?")}</span><input maxlength="120" required placeholder=${this.#axis==="palette"?this.i18n.system("e.g. electric cyan accents"):this.#axis==="composition"?this.i18n.system("e.g. centered symmetry"):this.i18n.system("Name the specific quality")} .value=${this.#value} @input=${(event:InputEvent)=>{const value=(event.target as HTMLInputElement).value;if(this.#value!==value)this.#critiqueOpening++;this.#value=value;this.requestUpdate();}}><small>Saved as a specific ${this.#axis} claim, not a general thumbs-up or thumbs-down.</small></label><details><summary>Add a private note <span>optional · retained 30 days</span></summary><textarea maxlength="500" rows="3" placeholder="Explain why this quality worked or did not." .value=${this.#note} @input=${(event:InputEvent)=>{const note=(event.target as HTMLTextAreaElement).value;if(this.#note!==note)this.#critiqueOpening++;this.#note=note;}}></textarea></details><footer><button type="button" class="button ghost compact" @click=${()=>this.#setCritiqueOpen(false)}>Cancel</button><button class="button primary compact" ?disabled=${!this.#value.trim()||this.store.busy.get()==="critique-object"}>${this.store.busy.get()==="critique-object"?this.i18n.system("Recording…"):this.i18n.system("Record taste evidence")}</button></footer></form>`:nothing}
    </article>${this.#imageEdit?html`<forma-generated-image-editor .opening=${this.#imageEdit} @generated-image-editor-close=${this.#closeImageEdit}></forma-generated-image-editor>`:nothing}${out.mediaUrl?html`<forma-output-visual class="output-card-image-viewer" .output=${out} .viewerOnly=${true}></forma-output-visual>`:nothing}${!context?html`<forma-generation-input-dialog .open=${this.#inputsOpen} .inspection=${inspection} @generation-input-close=${()=>{this.#inputsOpen=false;this.requestUpdate();}}></forma-generation-input-dialog>`:nothing}`;
  }
}
if (!customElements.get("forma-output-card")) customElements.define("forma-output-card", OutputCard);
