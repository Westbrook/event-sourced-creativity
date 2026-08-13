import { html, nothing } from "lit";
import { FormaElement, icon } from "./forma-element";
import type { CreativeBlock, CreativeOutput } from "../model/events";
import { CURRENT_FOCAL_POINT_METHOD, normalizeImageFocalPoint, type ImageFocalPoint } from "../model/focal-point";
import { diverseFocalPointCandidates } from "../model/focal-point-lab";
import { resolveImageFocalComparison, type ImageFocalComparison } from "../model/image-focus";
import "./area-navigation";
import "./output-visual";
import "../focal-point-lab.css";

type CropShape = "wide" | "square" | "portrait";
type SampleDensity = "representative" | "expanded" | "all";
type Verdict = "attention-region-v2" | "saliency-grid-v1" | "neither";
type LabAsset = {
  id: string;
  label: string;
  source: "generation" | "reference" | "provided diagnostic";
  mediaUrl: string;
  width: number;
  height: number;
  focalPoint: ImageFocalPoint;
  legacyFocalPoint?: ImageFocalPoint;
  comparison?: ImageFocalComparison;
  output: CreativeOutput;
};
type RawLabAsset = Omit<LabAsset, "focalPoint"> & { focalPoint: ImageFocalPoint | null };

const FALLBACK_POINT: ImageFocalPoint = { x: .5, y: .5, confidence: 0, method: CURRENT_FOCAL_POINT_METHOD, sampleWidth: 24, sampleHeight: 16 };
const asPercent = (value: number) => `${Number((value * 100).toFixed(1))}%`;
const asDuration = (value: number | undefined) => value === undefined ? "Calculating…" : value < 1 ? `${value.toFixed(2)} ms` : `${value.toFixed(1)} ms`;
const asCost = (value: number | undefined) => value === undefined ? "—" : `$${value.toFixed(6)}`;
const regionBounds = (point: ImageFocalPoint) => point.region
  ? `x ${asPercent(point.region.x0)}–${asPercent(point.region.x1)} · y ${asPercent(point.region.y0)}–${asPercent(point.region.y1)}`
  : "No distinct region";
const PROVIDED_DIAGNOSTICS = [
  { id: "provided-park-01", label: "Provided image 1 · children around the ball", mediaUrl: "/focal-point-lab/children-in-park-01.png" },
  { id: "provided-park-02", label: "Provided image 2 · players spread across the park", mediaUrl: "/focal-point-lab/children-in-park-02.png" },
  { id: "provided-park-03", label: "Provided image 3 · players left of the open field", mediaUrl: "/focal-point-lab/children-in-park-03.png" },
] as const;

function diagnosticOutput(id: string, mediaUrl: string, point: ImageFocalPoint, index: number, modelId: string): CreativeOutput {
  return {
    id,
    documentId: "focal-point-lab",
    generationId: "focal-point-lab",
    modelId,
    variant: index,
    latency: 0,
    sequence: 0,
    pinned: false,
    saved: false,
    discarded: false,
    library: false,
    contentRef: null,
    promptRef: null,
    promptTechnique: "prose",
    promptFanId: null,
    provider: "local-review",
    mediaUrl,
    mediaType: "image/png",
    width: 1536,
    height: 1024,
    plannerModelId: null,
    quality: "high",
    purpose: "final",
    sourceEventId: "focal-point-lab",
    sourceSurface: "focal-point-lab",
    promotionId: null,
    promotedFromId: null,
    promotedFromEventId: null,
    focalPoint: point,
    standalone: true,
    standaloneSequence: null,
  };
}

function referenceOutput(block: CreativeBlock, point: ImageFocalPoint, index: number): CreativeOutput {
  return {
    ...diagnosticOutput(`focal-lab-reference-${block.id}`, String(block.properties.media_url), point, index, "uploaded reference"),
    documentId: block.documentId,
    mediaType: String(block.properties.media_type ?? "image/*"),
    width: Number(block.properties.width ?? 1536),
    height: Number(block.properties.height ?? 1024),
    sourceEventId: block.sourceEvents.at(-1) ?? "focal-point-lab",
  };
}

export class FormaFocalPointLab extends FormaElement {
  #shape: CropShape = "wide";
  #density: SampleDensity = "expanded";
  #verdicts = new Map<string, Verdict>();
  #comparisons = new Map<string, ImageFocalComparison>();
  #pending = new Set<string>();

  protected override updated() {
    for (const candidate of this.#rawCandidates()) {
      if (this.#comparisons.has(candidate.mediaUrl) || this.#pending.has(candidate.mediaUrl)) continue;
      this.#pending.add(candidate.mediaUrl);
      void resolveImageFocalComparison(candidate.mediaUrl).then((analysis) => {
        this.#comparisons.set(candidate.mediaUrl, analysis);
        this.requestUpdate();
      }).catch(() => { /* The page labels unresolved assets instead of changing durable state. */ }).finally(() => {
        this.#pending.delete(candidate.mediaUrl);
      });
    }
  }

  #rawCandidates(): RawLabAsset[] {
    const projection = this.store.projection.get();
    const diagnostics = PROVIDED_DIAGNOSTICS.map((asset, index) => {
      const comparison = this.#comparisons.get(asset.mediaUrl);
      const focalPoint = comparison?.focalPoint ?? null;
      return {
        ...asset,
        source: "provided diagnostic" as const,
        width: 1536,
        height: 1024,
        focalPoint,
        legacyFocalPoint: comparison?.legacyFocalPoint,
        comparison,
        output: diagnosticOutput(asset.id, asset.mediaUrl, focalPoint ?? FALLBACK_POINT, index, "provided diagnostic"),
      };
    });
    const seen = new Set<string>(PROVIDED_DIAGNOSTICS.map((asset) => asset.mediaUrl));
    const outputs = [...projection.outputs, ...projection.libraryOutputs]
      .filter((output) => output.mediaUrl && !seen.has(output.mediaUrl) && seen.add(output.mediaUrl))
      .map((output) => {
        const comparison = this.#comparisons.get(output.mediaUrl!);
        const focalPoint = comparison?.focalPoint ?? normalizeImageFocalPoint(output.focalPoint) ?? null;
        return {
          id: output.id,
          label: `${output.purpose === "ideate" ? "Draft" : "Full-quality"} generation · ${output.id}`,
          source: "generation" as const,
          mediaUrl: output.mediaUrl!,
          width: output.width ?? 1536,
          height: output.height ?? 1024,
          focalPoint,
          legacyFocalPoint: comparison?.legacyFocalPoint,
          comparison,
          output: focalPoint ? { ...output, focalPoint } : output,
        };
      });
    const references = [...projection.blocks, ...projection.libraryBlocks]
      .filter((block) => block.type === "reference" && block.properties.media_url)
      .filter((block) => {
        const mediaUrl = String(block.properties.media_url);
        return !seen.has(mediaUrl) && Boolean(seen.add(mediaUrl));
      })
      .map((block, index) => {
        const mediaUrl = String(block.properties.media_url);
        const comparison = this.#comparisons.get(mediaUrl);
        const focalPoint = comparison?.focalPoint ?? normalizeImageFocalPoint(block.properties.focal_point) ?? null;
        return {
          id: block.id,
          label: `Uploaded reference · ${String(block.properties.label ?? block.handle)}`,
          source: "reference" as const,
          mediaUrl,
          width: Number(block.properties.width ?? 1536),
          height: Number(block.properties.height ?? 1024),
          focalPoint,
          legacyFocalPoint: comparison?.legacyFocalPoint,
          comparison,
          output: referenceOutput(block, focalPoint ?? FALLBACK_POINT, index),
        };
      });
    return [...diagnostics, ...outputs, ...references];
  }

  #assets(): LabAsset[] {
    const resolved = this.#rawCandidates().filter((candidate): candidate is LabAsset => candidate.focalPoint !== null);
    const diagnostics = resolved.filter((candidate) => candidate.source === "provided diagnostic");
    const project = resolved.filter((candidate) => candidate.source !== "provided diagnostic");
    const limit = this.#density === "representative" ? 8 : this.#density === "expanded" ? 16 : project.length;
    return [...diagnostics, ...diverseFocalPointCandidates(project.map((item) => ({ item, focalPoint: item.focalPoint })), limit).map(({ item }) => item)];
  }

  #methodResult(asset: LabAsset, point: ImageFocalPoint, method: "attention-region-v2" | "saliency-grid-v1") {
    const current = method === CURRENT_FOCAL_POINT_METHOD;
    const comparison = asset.comparison;
    const totalDuration = current ? comparison?.totalDurationMs : comparison?.legacyTotalDurationMs;
    const sampleDuration = current ? comparison?.sampleDurationMs : comparison?.legacySampleDurationMs;
    const calculationDuration = current ? comparison?.calculationDurationMs : comparison?.legacyCalculationDurationMs;
    const providerCost = current ? comparison?.providerCostUsd : comparison?.legacyProviderCostUsd;
    const output = { ...asset.output, focalPoint: point };
    return html`<article class=${`focal-lab-result ${current ? "recommended" : "legacy"}`}>
      <header><div><span>${current ? "Current production" : "Baseline"}</span><h3>${current ? "Attention regions" : "Saliency centroid"}</h3></div>${current ? html`<em>Recommended</em>` : nothing}</header>
      <figure class=${`focal-lab-crop focal-lab-crop--${this.#shape}`}>
        <div class="focal-lab-crop-stage"><forma-output-visual .output=${output}></forma-output-visual></div>
        <figcaption><b>x ${asPercent(point.x)} · y ${asPercent(point.y)}</b><span>${point.method}</span></figcaption>
      </figure>
      <dl><div><dt>This browser run</dt><dd>${asDuration(totalDuration)}</dd></div><div><dt>Sampling</dt><dd>${asDuration(sampleDuration)}</dd></div><div><dt>Calculation</dt><dd>${asDuration(calculationDuration)}</dd></div><div><dt>Provider cost</dt><dd>${asCost(providerCost)}</dd></div><div><dt>Sample</dt><dd>${point.sampleWidth} × ${point.sampleHeight}</dd></div><div><dt>Confidence</dt><dd>${Math.round(point.confidence * 100)}%</dd></div></dl>
      <p>${current ? `Selects a coherent region at several scales. ${regionBounds(point)}.` : "Averages thresholded high-contrast pixels into one centroid; its square sample distorts non-square images."}</p>
    </article>`;
  }

  #asset(asset: LabAsset, index: number) {
    const point = asset.focalPoint;
    const legacy = asset.legacyFocalPoint;
    const verdict = this.#verdicts.get(asset.id);
    const region = point.region;
    const sourceStyle = [
      `--source-ratio:${asset.width}/${asset.height}`,
      `--focal-x:${asPercent(point.x)}`,
      `--focal-y:${asPercent(point.y)}`,
      `--legacy-focal-x:${asPercent(legacy?.x ?? point.x)}`,
      `--legacy-focal-y:${asPercent(legacy?.y ?? point.y)}`,
      `--region-x:${asPercent(region?.x0 ?? point.x)}`,
      `--region-y:${asPercent(region?.y0 ?? point.y)}`,
      `--region-width:${asPercent(region ? region.x1-region.x0 : 0)}`,
      `--region-height:${asPercent(region ? region.y1-region.y0 : 0)}`,
    ].join(";");
    return html`<article class="focal-lab-asset">
      <header><span>${String(index + 1).padStart(2, "0")}</span><div><h2>${asset.label}</h2><p>${asset.source} · ${asset.width} × ${asset.height} · ${point.sampleWidth} × ${point.sampleHeight} aspect-preserving sample</p></div><code>x ${asPercent(point.x)} · y ${asPercent(point.y)}</code></header>
      <div class="focal-lab-review">
        <figure class="focal-lab-source" style=${sourceStyle}>
          <div><img src=${asset.mediaUrl} width=${asset.width} height=${asset.height} alt=${`Uncropped source for ${asset.label}`}><span class="focal-lab-region" aria-hidden="true"></span>${legacy ? html`<i class="legacy" aria-hidden="true"></i>` : nothing}<i class="current" aria-hidden="true"></i></div>
          <figcaption><b>Uncropped source</b><span><i class="legend-current"></i>Attention ${legacy ? html`<i class="legend-legacy"></i>Saliency` : nothing}</span></figcaption>
        </figure>
        <div class="focal-lab-results" aria-label=${`Calculation comparisons for ${asset.label}`}>${this.#methodResult(asset, point, "attention-region-v2")}${legacy ? this.#methodResult(asset, legacy, "saliency-grid-v1") : html`<p class="focal-lab-result-pending" role="status">Calculating the baseline…</p>`}</div>
      </div>
      <footer><span>Which calculation preserves the most useful crop?</span><div role="group" aria-label=${`Record the preferred focal-point calculation for ${asset.label}`}>
        ${(["attention-region-v2", "saliency-grid-v1", "neither"] as const).map((choice) => html`<button aria-pressed=${verdict === choice} @click=${() => { this.#verdicts.set(asset.id, choice); this.requestUpdate(); }}>${choice === "attention-region-v2" ? "Attention regions" : choice === "saliency-grid-v1" ? "Saliency centroid" : "Neither"}</button>`)}
      </div></footer>
    </article>`;
  }

  override render() {
    const assets = this.#assets();
    const diagnostics = assets.filter((asset) => asset.source === "provided diagnostic");
    const project = assets.filter((asset) => asset.source !== "provided diagnostic");
    const rawCandidates = this.#rawCandidates();
    const visibleIds = new Set(assets.map((asset) => asset.id));
    const visibleVerdicts = [...this.#verdicts.entries()].filter(([id]) => visibleIds.has(id)).map(([, verdict]) => verdict);
    const attention = visibleVerdicts.filter((value) => value === "attention-region-v2").length;
    const saliency = visibleVerdicts.filter((value) => value === "saliency-grid-v1").length;
    const neither = visibleVerdicts.filter((value) => value === "neither").length;
    const unresolved = rawCandidates.filter((candidate) => !candidate.focalPoint).length;
    const availableProject = rawCandidates.filter((candidate) => candidate.source !== "provided diagnostic").length;
    return html`<section class="focal-point-lab page-pad">
      <forma-area-navigation area="administration" active="system"></forma-area-navigation>
      <header class="page-header page-header--hero"><div class="page-header-copy"><span class="eyebrow">Administration / Image presentation</span><h1>Focal-point laboratory</h1><p>Compare two local focal-point calculations by their crop, execution time, and provider cost. No choice on this page changes the document or its durable stream.</p></div><div class="page-header-actions"><a class="button secondary" href="/system" @click=${(event:MouseEvent) => { event.preventDefault(); this.store.setRoute("/system"); }}>Back to system ${icon("arrow")}</a></div></header>
      <section class="focal-lab-controls" aria-label="Focal-point review controls"><div class="focal-lab-filter-groups"><div class="focal-lab-filter"><span>Crop shape</span><div role="group" aria-label="Crop shape">${(["wide", "square", "portrait"] as const).map((shape) => html`<button aria-pressed=${this.#shape === shape} @click=${() => { this.#shape = shape; this.requestUpdate(); }}>${shape}</button>`)}</div></div><div class="focal-lab-filter"><span>Image set</span><div role="group" aria-label="Image set">${(["representative", "expanded", "all"] as const).map((density) => html`<button aria-pressed=${this.#density === density} @click=${() => { this.#density = density; this.requestUpdate(); }}>${density === "representative" ? "8" : density === "expanded" ? "16" : "All"}</button>`)}</div></div></div><dl><div><dt>Visible</dt><dd>${assets.length}/${rawCandidates.length}</dd></div><div><dt>Reviewed</dt><dd>${visibleVerdicts.length}</dd></div><div><dt>Attention</dt><dd>${attention}</dd></div><div><dt>Saliency</dt><dd>${saliency}</dd></div><div><dt>Neither</dt><dd>${neither}</dd></div></dl></section>
      <section class="focal-lab-method" aria-labelledby="focal-method-title"><header><span>Implementation tradeoffs</span><h2 id="focal-method-title">Two calculations, one crop contract</h2><p>Both approaches run in the browser and send no pixels to a provider. Times shown with each image are observed runs that include loading, decoding, sampling, and calculation; they are device- and cache-dependent.</p></header><div class="focal-lab-implementations"><article><span>Current production</span><h3>Attention regions</h3><p>Preserves aspect ratio, scores local visual evidence, compares coherent regions at several scales, and anchors the crop at the winning region’s weighted center.</p><dl><div><dt>Provider cost</dt><dd>$0.000000</dd></div><div><dt>Privacy</dt><dd>Pixels stay local</dd></div></dl></article><article><span>Baseline</span><h3>Saliency centroid</h3><p>Uses the original square sample and averages thresholded high-contrast pixels. It is simpler and often faster, but can drift toward canopy, sky, or image edges.</p><dl><div><dt>Provider cost</dt><dd>$0.000000</dd></div><div><dt>Privacy</dt><dd>Pixels stay local</dd></div></dl></article></div></section>
      <aside class="focal-lab-reading-note"><b>How to read each comparison</b><p>The source overlays both calculations: the orange rectangle and solid marker represent attention regions; the hollow marker represents the saliency centroid. The two adjacent previews apply those points to the same crop shape, making output quality and computational tradeoffs directly comparable.</p></aside>
      ${diagnostics.length ? html`<section class="focal-lab-group" aria-labelledby="provided-diagnostics-title"><header class="focal-lab-group-heading"><span>Requested comparison set</span><div><h2 id="provided-diagnostics-title">Provided diagnostic images</h2><p>Each image is run through both local implementations. The current method preserves aspect ratio and selects a coherent attention region; the baseline reproduces the original square-sample saliency centroid. These calculations are intentionally not appended to a document.</p></div></header><div class="focal-lab-assets">${diagnostics.map((asset, index) => this.#asset(asset, index))}</div></section>` : nothing}
      ${project.length ? html`<section class="focal-lab-group" aria-labelledby="project-sample-title"><header class="focal-lab-group-heading"><span>Existing comparison set</span><div><h2 id="project-sample-title">Project images with varied focal points</h2><p>Showing ${project.length} of ${availableProject} durable generation and reference images. Representative and expanded sets maximize spatial diversity; All retains the complete available corpus.</p></div></header><div class="focal-lab-assets">${project.map((asset, index) => this.#asset(asset, index + diagnostics.length))}</div></section>` : diagnostics.length ? nothing : html`<div class="focal-lab-empty"><span>${icon("image")}</span><h2>No readable images yet</h2><p>Focal analysis runs locally when the supplied or project pixels become available.</p></div>`}
      ${unresolved ? html`<p class="focal-lab-pending" role="status">Calculating ${unresolved} additional local focal point${unresolved === 1 ? "" : "s"}…</p>` : nothing}
    </section>`;
  }
}

customElements.define("forma-focal-point-lab", FormaFocalPointLab);

declare global { interface HTMLElementTagNameMap { "forma-focal-point-lab": FormaFocalPointLab } }
