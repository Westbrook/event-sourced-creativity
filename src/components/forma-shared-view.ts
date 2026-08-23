import { html, LitElement, nothing } from "lit";
import { documentArtifactDefinition, type DocumentArtifact } from "../model/document-artifacts";
import type { CreativeOutput } from "../model/events";
import { FormaLocaleController } from "./design-system/localization";
import { ensureModalDialog } from "./modal-dialog";
import { completeRoutePopulation } from "../performance";
import { renderVideoReel, type VideoReelItem } from "./video-reel";
import "./artifact-summary";

type SharedArtifact=DocumentArtifact&{contentMarkdown?:string|null;contentAvailable?:boolean};
type SharedProjection = { projectName: string; documentTitle: string; blocks: Array<{ id: string; type: string; handle: string; properties: Record<string, unknown> }>; outputs: CreativeOutput[]; artifacts: SharedArtifact[] };
type SharedResult = { kind: "image"; sequence: number; outputs: CreativeOutput[] } | { kind: "artifact"; sequence: number; artifact: SharedArtifact };

export class FormaSharedView extends LitElement {
  static properties = { token: { type: String } };
  token = ""; #loading = true; #error = ""; #projection: SharedProjection | null = null; #expiresAt = "";
  #i18n = new FormaLocaleController(this);
  #activeImage:{url:string;label:string;fan:Array<{url:string;label:string}>;index:number}|null=null;
  #returnFocus?:HTMLElement;
  protected override createRenderRoot() { return this; }
  protected override updated(){document.title=this.#projection?`${this.#projection.documentTitle} — ${this.#i18n.t("shared.review","Shared review")} — Forma`:`${this.#i18n.t(this.#error?"shared.unavailable":"shared.loading",this.#error?"Link unavailable":"Opening shared review")} — Forma`;}
  override connectedCallback() { super.connectedCallback(); void this.#load(); }

  async #openImage(event:MouseEvent,url:string,label:string,approvedFan:Array<{url:string;label:string}>=[]){
    let parsed:URL;try{parsed=new URL(url,location.origin);}catch{return;}
    const expected=`/api/shared/${encodeURIComponent(this.token)}/media/`;
    if(parsed.origin!==location.origin||!parsed.pathname.startsWith(expected))return;
    const fan=approvedFan.map((candidate)=>{try{const item=new URL(candidate.url,location.origin);return item.origin===location.origin&&item.pathname.startsWith(expected)?{url:item.href,label:candidate.label}:null;}catch{return null;}}).filter((candidate):candidate is {url:string;label:string}=>candidate!==null);
    if(!fan.some((candidate)=>candidate.url===parsed.href))fan.unshift({url:parsed.href,label});
    this.#returnFocus=event.currentTarget instanceof HTMLElement?event.currentTarget:undefined;
    this.#activeImage={url:parsed.href,label,fan,index:Math.max(0,fan.findIndex((candidate)=>candidate.url===parsed.href))};this.requestUpdate();await this.updateComplete;
    const dialog=this.querySelector<HTMLDialogElement>(".shared-image-dialog");ensureModalDialog(dialog);dialog?.querySelector<HTMLElement>("button")?.focus();
  }

  #closeImage(){this.querySelector<HTMLDialogElement>(".shared-image-dialog")?.close();this.#activeImage=null;this.requestUpdate();this.#returnFocus?.focus();this.#returnFocus=undefined;}

  #navigateImage(direction:-1|1){const active=this.#activeImage;if(!active||active.fan.length<2)return;const index=(active.index+direction+active.fan.length)%active.fan.length;const image=active.fan[index];this.#activeImage={...active,url:image.url,label:image.label,index};this.requestUpdate();}

  #image(url:string,label:string,fan:Array<{url:string;label:string}>=[]){return html`<button class="shared-image-trigger" type="button" aria-haspopup="dialog" aria-label=${fan.length>1?`${label} · ${this.#i18n.t("output.openComparison","Open the image at full size and navigate its {count}-image comparison",{count:this.#i18n.number(fan.length)})}`:this.#i18n.t("shared.inspectImage","Inspect image: {title}",{title:label})} @click=${(event:MouseEvent)=>this.#openImage(event,url,label,fan)}><img class="shared-reference-image" src=${url} alt=${label} loading="lazy"></button>`;}
  async #load() {
    try {if(!this.token.trim())throw new Error("Shared view unavailable");const response = await fetch(`/api/shared/${encodeURIComponent(this.token)}`); const body = await response.json() as { projection?: SharedProjection; share?: { expiresAt: string }; error?: string }; if (!response.ok || !body.projection) throw new Error(body.error ?? "Shared view unavailable"); this.#projection = body.projection; this.#expiresAt = body.share?.expiresAt ?? ""; }
    catch (error) { this.#error = error instanceof Error ? error.message : "Shared view unavailable"; }
    finally { this.#loading = false;this.requestUpdate();void this.updateComplete.then(()=>{this.querySelector<HTMLElement>("#main-content")?.focus({preventScroll:true});completeRoutePopulation(location.pathname);}); }
  }

  #results(projection: SharedProjection): SharedResult[] {
    const imageGroups = new Map<string, CreativeOutput[]>();
    for (const output of projection.outputs) {
      const key = output.promptFanId ? `fan:${output.promptFanId}` : `image:${output.id}`;
      const existing = imageGroups.get(key);
      if (existing) existing.push(output);
      else imageGroups.set(key, [output]);
    }
    const images: SharedResult[] = [...imageGroups.values()].map((outputs) => ({ kind: "image", sequence: Math.max(...outputs.map((output) => output.sequence)), outputs }));
    const artifacts: SharedResult[] = (projection.artifacts ?? []).map((artifact) => ({ kind: "artifact", sequence: artifact.sequence, artifact }));
    return [...images, ...artifacts].sort((left, right) => right.sequence - left.sequence);
  }

  #artifactDetails(artifact: SharedArtifact) {
    if (artifact.kind === "video" && artifact.mediaUrl) return renderVideoReel(artifact.items, artifact.mediaUrl, artifact.title);
    if (artifact.kind === "slides") return html`<div class="shared-slide-list">${artifact.items.map((item, index) => html`<forma-presentation-slide .item=${{ title: item.title, body: item.body, notes: item.notes, image_prompt: "", slide: item.slide }} .presentation=${artifact.presentation} .index=${index} .total=${artifact.itemCount} .compact=${true}></forma-presentation-slide>`)}</div>`;
    if(artifact.kind==="short_story"||artifact.kind==="scene")return typeof artifact.contentMarkdown==="string"?html`<pre class="shared-artifact-copy" dir="auto">${artifact.contentMarkdown}</pre>`:html`<p class="shared-artifact-unavailable">The original full writing is no longer available; retained titles and summary are shown.</p><ol class="shared-narrative-list">${artifact.items.map((item)=>html`<li><b dir="auto">${item.title}</b>${item.body?html`<p dir="auto">${item.body}</p>`:nothing}</li>`)}</ol>`;
    return html`<ol class=${artifact.kind === "storyboard" ? "shared-storyboard-list" : "shared-narrative-list"}>${artifact.items.map((item) => html`<li>${item.mediaUrl ? this.#image(item.mediaUrl,item.title) : nothing}<b dir="auto">${item.title}</b>${item.body ? html`<p dir="auto">${item.body}</p>` : nothing}${item.notes ? html`<small dir="auto">${item.notes}</small>` : nothing}</li>`)}</ol>`;
  }

  #result(result: SharedResult) {
    if (result.kind === "artifact") {
      const artifact = result.artifact;
      const definition = documentArtifactDefinition(artifact.kind);
      const label = this.#i18n.t(`artifact.${artifact.kind}.label`, definition.label);
      const unit = artifact.kind === "slides" ? "slides" : artifact.kind === "storyboard" ? "shots" : artifact.kind === "video" ? "scenes" : "parts";
      const count = this.#i18n.plural(`shared.${unit}`, artifact.itemCount, `{count} ${unit === "parts" ? "part" : unit === "shots" ? "shot" : unit === "scenes" ? "scene" : "slide"}`, `{count} ${unit}`);
      return html`<section class="shared-output shared-artifact"><forma-artifact-summary .artifact=${artifact} .compact=${true}></forma-artifact-summary><div class="shared-result-description"><b dir="auto">${artifact.title}</b><small>${label} · ${count}</small></div><details class="shared-result-details"><summary>${this.#i18n.t("shared.view", "View {format}", { format: label })}</summary>${this.#artifactDetails(artifact)}</details></section>`;
    }
    const fan = result.outputs.length > 1;
    const approvedFan=result.outputs.flatMap((output,index)=>output.mediaUrl?[{url:output.mediaUrl,label:this.#i18n.t("shared.imageAlt","Shared creative result {number}",{number:this.#i18n.number(index+1)})}]:[]);
    return html`<section class=${`shared-output${fan ? " shared-output-fan" : ""}`}><div class="shared-output-images">${result.outputs.map((output, index) => output.mediaUrl ? this.#image(output.mediaUrl,this.#i18n.t("shared.imageAlt", "Shared creative result {number}", { number: this.#i18n.number(index + 1) }),approvedFan) : html`<span class="shared-output-empty">${this.#i18n.t("shared.imageUnavailable", "Image unavailable")}</span>`)}</div><div class="shared-result-description"><b>${fan ? this.#i18n.plural("shared.alternatives", result.outputs.length, "{count} creative alternative", "{count} creative alternatives") : result.outputs[0]?.purpose === "ideate" ? this.#i18n.t("shared.exploration", "Exploration draft") : this.#i18n.t("shared.finishedImage", "Finished image")}</b><small>${fan ? this.#i18n.t("shared.alternativesDetail", "One result shown through different prompt approaches") : this.#i18n.t("shared.generatedDetail", "Generated from the shared creative direction")}</small></div></section>`;
  }

  override render() {
    if (this.#loading) return html`<main id="main-content" tabindex="-1" class="shared-view"><div class="shared-status" role="status">${this.#i18n.t("shared.loading", "Opening this shared creative document…")}</div></main>`;
    if (this.#error || !this.#projection) return html`<main id="main-content" tabindex="-1" class="shared-view"><div class="shared-status"><span>${this.#i18n.t("shared.unavailable", "Link unavailable")}</span><h1>${this.#i18n.t("shared.expired", "This view has expired or been revoked.")}</h1><p>${this.#i18n.t("shared.noData", "No project data was returned.")}</p></div></main>`;
    const p = this.#projection;
    const results = this.#results(p);
    const expires = this.#expiresAt ? this.#i18n.date(new Date(this.#expiresAt), { dateStyle: "medium", timeStyle: "short" }) : "";
    return html`<main id="main-content" tabindex="-1" class="shared-view"><header><div class="brand"><span class="brand-mark">F</span><span>Forma</span></div><span>${this.#i18n.t("shared.expires", "Private · view only · expires {date}", { date: expires })}</span></header><section class="shared-hero"><h1 dir="auto">${p.documentTitle}</h1><p><bdi dir="auto">${p.projectName}</bdi> · ${this.#i18n.t("shared.description", "A private, read-only view of this document and its creative results.")}</p></section><section class="shared-grid"><div><h2>${this.#i18n.t("shared.direction", "Creative direction")}</h2>${p.blocks.map((block) => {const video=block.properties.source_artifact_kind==="video"||String(block.properties.media_type??"").startsWith("video/");const structure=block.properties.artifact_structure&&typeof block.properties.artifact_structure==="object"?block.properties.artifact_structure as Record<string,unknown>:{};const items=Array.isArray(structure.items)?structure.items as VideoReelItem[]:[];const label=String(block.properties.label??block.handle);const copy=typeof block.properties.artifact_markdown==="string"?block.properties.artifact_markdown:String(block.properties.text??block.properties.label??this.#i18n.t("shared.retainedDecision","A retained creative decision"));return html`<article><small dir="ltr">${block.type}</small><h3 dir="auto">${label}</h3>${video?renderVideoReel(items,typeof block.properties.media_url==="string"?block.properties.media_url:null,label):typeof block.properties.media_url === "string" ? this.#image(block.properties.media_url,label) : nothing}<p dir="auto">${copy}</p></article>`;})}</div><aside><h2>${this.#i18n.t("shared.results", "Creative results")}</h2>${results.length ? results.map((result) => this.#result(result)) : html`<p>${this.#i18n.t("shared.noResults", "No results have been shared yet.")}</p>`}</aside></section><footer>${this.#i18n.t("shared.footer", "This link provides access only to the selected document and can be revoked immediately.")}</footer>${this.#activeImage?html`<dialog class="modal shared-image-dialog" open aria-labelledby="shared-image-dialog-heading" @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)this.#closeImage();}} @keydown=${(event:KeyboardEvent)=>{if(this.#activeImage!.fan.length<2||event.defaultPrevented||event.isComposing||event.metaKey||event.ctrlKey||event.altKey||event.key!=="ArrowLeft"&&event.key!=="ArrowRight")return;event.preventDefault();event.stopPropagation();const previous=this.matches(":dir(rtl)")?"ArrowRight":"ArrowLeft";this.#navigateImage(event.key===previous?-1:1);}} @close=${()=>{this.#activeImage=null;this.requestUpdate();this.#returnFocus?.focus();this.#returnFocus=undefined;}}><div class="modal-card"><header><h2 id="shared-image-dialog-heading" dir="auto">${this.#activeImage.label}</h2><button class="button secondary compact" type="button" @click=${()=>this.#closeImage()}>${this.#i18n.t("shared.closeImage","Close image")}</button></header>${this.#activeImage.fan.length>1?html`<p>${this.#i18n.t("output.navigation","Use the Left and Right Arrow keys to move through all {count} images without closing this dialog.",{count:this.#i18n.number(this.#activeImage.fan.length)})}</p>`:nothing}<img src=${this.#activeImage.url} alt=${this.#activeImage.label}>${this.#activeImage.fan.length>1?html`<nav class="shared-image-navigation" aria-label=${this.#i18n.t("output.navigation","Use the Left and Right Arrow keys to move through all {count} images without closing this dialog.",{count:this.#i18n.number(this.#activeImage.fan.length)})}><button class="button secondary compact" type="button" aria-keyshortcuts=${this.matches(":dir(rtl)")?"ArrowRight":"ArrowLeft"} @click=${()=>this.#navigateImage(-1)}>${this.#i18n.t("output.previous","Previous fan image")}</button><span aria-live="polite">${this.#i18n.t("output.positionOnly","{index} of {total}",{index:this.#i18n.number(this.#activeImage.index+1),total:this.#i18n.number(this.#activeImage.fan.length)})}</span><button class="button secondary compact" type="button" aria-keyshortcuts=${this.matches(":dir(rtl)")?"ArrowLeft":"ArrowRight"} @click=${()=>this.#navigateImage(1)}>${this.#i18n.t("output.next","Next fan image")}</button></nav>`:nothing}</div></dialog>`:nothing}</main>`;
  }
}
customElements.define("forma-shared-view", FormaSharedView);
