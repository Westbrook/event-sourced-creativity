import { html, nothing } from "lit";
import { platformSession } from "../../platform/session-controller";
import { FormaProductEvaluation } from "./evaluation";

// Localize only exact, current application-owned routing and validation sentences.
// Unknown explanations, historical findings, model IDs and inputs stay unchanged.
const ADAPTER_PREVIEW_GUIDANCE = new Map<string, string>([
  ["one-reference Ideogram 4 image-to-image","evaluation.preview.reason.oneReference"],
  ["configured Ideogram 4 text-to-image","evaluation.preview.reason.configuredIdeogram"],
  ["Fal is not configured","evaluation.preview.reason.falUnavailable"],
  ["Ideogram 4 accepts one reference; preserving the multi-reference contract","evaluation.preview.reason.multipleReferences"],
  ["Ideogram 4 does not return WebP","evaluation.preview.reason.webpUnsupported"],
  ["configured OpenAI image adapter","evaluation.preview.reason.configuredOpenAI"],
  ["Use WIDTHxHEIGHT dimensions.","evaluation.preview.size.syntax"],
  ["Ideogram V4 requires each side to be at least 512 pixels.","evaluation.preview.size.minimum"],
  ["Ideogram V4 accepts custom sides up to 3840 pixels.","evaluation.preview.size.maximum"],
  ["Ideogram V4 custom dimensions must be multiples of 16.","evaluation.preview.size.multiple"],
]);

type AdapterPreview={dryRun:boolean;providerCall:boolean;pixelsTransmitted:boolean;request:{provider:string;quality:string;size:string;outputFormat:string;referenceCount:number;wouldTransmitReferencePixels:boolean};selection:{provider:string;model:string;adapterId:string;adapterVersion:string;reason:string;renderingSpeed:string|null;sizeValid:boolean;sizeMessage:string;estimatedProviderCostUsd:number|null};stages:Array<{id:string;label:string;wouldContactProvider:boolean}>};

/** Frozen qualification evidence plus explicit no-cost, provider-free adapter routing simulation. */
export class FormaProductAdapterPreview extends FormaProductEvaluation {
  protected override dashboardHeadingLevel:1|2=2;
  #simulation?:AdapterPreview;
  #simulationIssue="";
  #simulating=false;

  #guidance(value:string){
    const key=ADAPTER_PREVIEW_GUIDANCE.get(value);
    return key?this.i18n.t(key,value):value;
  }

  async #simulate(event:SubmitEvent){
    event.preventDefault();
    if(this.#simulating||!platformSession.get()?.capabilities.includes("evaluation.qualification.run"))return;
    const values=new FormData(event.currentTarget as HTMLFormElement);
    const input={provider:String(values.get("provider")??"fal-ideogram"),quality:String(values.get("quality")??"low"),size:String(values.get("size")??"1024x1024"),outputFormat:String(values.get("outputFormat")??"jpeg"),referenceCount:Number(values.get("referenceCount")??0)};
    this.#simulating=true;this.#simulationIssue="";this.requestUpdate();
    try{
      const response=await fetch("/api/portfolio/product/adapter-preview",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(input)});
      const body=await response.json() as AdapterPreview&{error?:string};
      if(!response.ok||!body.dryRun||body.providerCall||body.pixelsTransmitted)throw new Error(body.error??"adapter_preview_unavailable");
      this.#simulation=body;
    }catch(error){const reason=error instanceof Error?error.message:"adapter_preview_unavailable";this.#simulationIssue=reason==="adapter_preview_unavailable"?this.i18n.system("Adapter preview is unavailable."):reason;}finally{this.#simulating=false;this.requestUpdate();}
  }

  override render(){
    const canRun=platformSession.get()?.capabilities.includes("evaluation.qualification.run")===true;
    const preview=this.#simulation;
    return html`<section class="adapter-preview page-pad" aria-labelledby="adapter-preview-heading"><h1 id="adapter-preview-heading">${this.i18n.t("evaluation.preview.heading","Adapter contract simulation")}</h1><p>${this.i18n.t("evaluation.preview.description","Inspect routing, normalization, fallback behavior, and indicative cost without calling a provider, transmitting pixels, changing production policy, or spending funds.")}</p>
      ${canRun?html`<form class="adapter-preview-form" @submit=${(event:SubmitEvent)=>this.#simulate(event)}><label>${this.i18n.t("evaluation.preview.provider","Requested provider")}<select name="provider"><option value="fal-ideogram">Fal Ideogram</option><option value="openai">OpenAI</option></select></label><label>${this.i18n.t("evaluation.preview.quality","Requested quality")}<select name="quality"><option value="low">${this.i18n.t("evaluation.preview.low","Low")}</option><option value="medium">${this.i18n.t("evaluation.preview.medium","Medium")}</option><option value="high">${this.i18n.t("evaluation.preview.high","High")}</option></select></label><label>${this.i18n.t("evaluation.preview.size","Requested dimensions")}<input name="size" value="1024x1024" pattern="[0-9]+x[0-9]+" required></label><label>${this.i18n.t("evaluation.preview.format","Output format")}<select name="outputFormat"><option value="jpeg">JPEG</option><option value="png">PNG</option><option value="webp">WebP</option></select></label><label>${this.i18n.t("evaluation.preview.references","Reference images")}<input name="referenceCount" type="number" min="0" max="4" value="0" required></label><button class="button primary" type="submit" ?disabled=${this.#simulating}>${this.i18n.t("evaluation.preview.run","Run free contract simulation")}</button></form>`:html`<p role="note">${this.i18n.t("evaluation.preview.readOnly","Your access permits reviewing retained evidence. Running a no-cost contract simulation requires a separate qualification execution grant.")}</p>`}
      ${this.#simulationIssue?html`<p role="alert">${this.#simulationIssue}</p>`:nothing}
      ${preview?html`<section aria-labelledby="adapter-preview-result-heading"><h2 id="adapter-preview-result-heading">${this.i18n.t("evaluation.preview.result","Simulated routing result")}</h2><dl class="adapter-preview-results"><dt>${this.i18n.t("evaluation.preview.selectedProvider","Selected provider")}</dt><dd>${preview.selection.provider}</dd><dt>${this.i18n.t("evaluation.preview.model","Selected model")}</dt><dd><code>${preview.selection.model}</code></dd><dt>${this.i18n.t("evaluation.preview.reason","Routing or fallback reason")}</dt><dd>${this.#guidance(preview.selection.reason)}</dd><dt>${this.i18n.t("evaluation.preview.normalized","Normalized request")}</dt><dd>${preview.request.size} · ${preview.request.outputFormat} · ${this.i18n.number(preview.request.referenceCount)}</dd><dt>${this.i18n.t("evaluation.preview.estimate","Indicative provider cost")}</dt><dd>${preview.selection.estimatedProviderCostUsd===null?this.i18n.t("role.notMeasured","Not measured"):new Intl.NumberFormat(this.i18n.locale,{style:"currency",currency:"USD",maximumFractionDigits:4}).format(preview.selection.estimatedProviderCostUsd)}</dd></dl>${preview.selection.sizeValid?nothing:html`<p role="status">${this.#guidance(preview.selection.sizeMessage)}</p>`}<p>${this.i18n.t("evaluation.preview.guarantee","Simulation complete: no provider request, no image transmission, no saved customer data, and no charge.")}</p></section>`:nothing}
      </section>${super.render()}`;
  }
}

if(!customElements.get("forma-product-adapter-preview"))customElements.define("forma-product-adapter-preview",FormaProductAdapterPreview);
