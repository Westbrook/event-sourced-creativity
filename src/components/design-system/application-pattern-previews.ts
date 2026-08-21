import { html, nothing, type TemplateResult } from "lit";

const exampleAreas = [
  { label: "Replay", value: "replay" },
  { label: "Focal points", value: "focal-points" },
  { label: "Design system", value: "design-system" },
];

const exampleFanApproaches = ["Prose", "Bullets", "JSON", "XML"] as const;
const exampleFormats = ["Story", "Slides", "Storyboard", "Video"] as const;
const exampleSlides = [
  { label: "01", value: "1" },
  { label: "02", value: "2" },
  { label: "03", value: "3" },
];

function sampleArtwork(label: string, variant: "output" | "reference") {
  return html`<div class=${`component-pattern-artwork component-pattern-artwork--${variant}`} role="img" aria-label=${label}>
    ${variant === "reference" ? html`<span class="component-pattern-focal-point" aria-hidden="true"></span>` : nothing}
  </div>`;
}

function sampleFan() {
  return html`<div class="component-pattern-fan" role="group" aria-label="Four sample creative approaches">
    ${exampleFanApproaches.map((approach, index) => html`<figure>
      <div class=${`component-pattern-fan-art component-pattern-fan-art--${index + 1}`} aria-hidden="true"></div>
      <figcaption>${approach}</figcaption>
    </figure>`)}
  </div>`;
}

/**
 * Read-only application-pattern illustrations assembled from real UI primitives.
 * Application elements are intentionally never imported, mounted, or observed.
 */
export function renderApplicationPatternPreview(tag: string): TemplateResult | typeof nothing {
  switch (tag) {
    case "forma-area-navigation":
      return html`<div class="component-pattern component-pattern-navigation" role="group" aria-label="Example Laboratory navigation">
        <span class="component-pattern-kicker">Laboratory</span>
        <forma-ui-segmented-control label="Example Laboratory sections" value="design-system" .options=${exampleAreas}></forma-ui-segmented-control>
      </div>`;

    case "forma-collection-tree":
      return html`<div class="component-pattern component-pattern-collections" role="group" aria-label="Example project collections">
        <header><strong>Collections</strong><forma-ui-badge label="3 items"></forma-ui-badge></header>
        <ul role="list" aria-label="Sample collection hierarchy"><li><strong>Summer campaign</strong>
          <ul role="list"><li><span>Concept studies</span><span>2<span class="sr-only"> items</span></span></li><li><span>Approved references</span><span>1<span class="sr-only"> item</span></span></li></ul>
        </li></ul>
        <forma-ui-button label="Open collection" variant="ghost"></forma-ui-button>
      </div>`;

    case "forma-output-visual":
      return html`<div class="component-pattern component-pattern-media" role="group" aria-label="Example generated image">
        ${sampleArtwork("Soft blue generated concept with warm morning light", "output")}
        <div class="component-pattern-actions"><forma-ui-badge label="Full quality" tone="positive"></forma-ui-badge><forma-ui-button label="Review image" variant="ghost"></forma-ui-button></div>
      </div>`;

    case "forma-reference-image":
      return html`<figure class="component-pattern component-pattern-media">
        ${sampleArtwork("Authorized source reference with its focal point in the upper right", "reference")}
        <figcaption class="component-pattern-actions"><forma-ui-badge label="Authorized source"></forma-ui-badge><forma-ui-button label="Inspect reference" variant="ghost"></forma-ui-button></figcaption>
      </figure>`;

    case "forma-artifact-summary":
      return html`<div class="component-pattern component-pattern-artifact" role="group" aria-label="Example story outcome">
        <div class="component-pattern-actions"><forma-ui-icon name="story" label="Written story"></forma-ui-icon><forma-ui-badge label="Story" tone="accent"></forma-ui-badge></div>
        <h4>A quieter beginning</h4>
        <p>A short opening about finding space for the unexpected.</p>
      </div>`;

    case "forma-prompt-fan-visual":
      return html`<div class="component-pattern component-pattern-comparison" role="group" aria-label="Example four-direction creative comparison">
        ${sampleFan()}
        <forma-ui-badge label="Four directions ready" tone="positive"></forma-ui-badge>
      </div>`;

    case "forma-prompt-fan-review":
      return html`<div class="component-pattern component-pattern-comparison" role="group" aria-label="Example creative direction review">
        ${sampleFan()}
        <div class="component-pattern-actions"><forma-ui-badge label="Bullets selected" tone="accent"></forma-ui-badge><forma-ui-button label="Keep this direction"></forma-ui-button></div>
      </div>`;

    case "forma-presentation-slide":
      return html`<div class="component-pattern component-pattern-slide" role="group" aria-label="Example presentation slide, one of three">
        <header><span>Creative direction</span><span>01 / 03</span></header>
        <h4>Make room for the idea</h4>
        <p>Start with one clear outcome and build from there.</p>
        <div class="component-pattern-slide-accent" aria-hidden="true"></div>
      </div>`;

    case "forma-presentation-deck":
      return html`<div class="component-pattern component-pattern-deck" role="group" aria-label="Example three-slide presentation">
        <div class="component-pattern-deck-thumbnails" aria-hidden="true"><span>01</span><span>02</span><span>03</span></div>
        <h4>Campaign direction</h4>
        <forma-ui-segmented-control label="Choose a sample presentation slide" value="1" .options=${exampleSlides}></forma-ui-segmented-control>
      </div>`;

    case "forma-document-artifacts":
      return html`<div class="component-pattern component-pattern-formats" role="group" aria-label="Example available document outcomes">
        <h4>Choose an outcome</h4>
        <div class="component-pattern-format-list">${exampleFormats.map((format) => html`<forma-ui-badge .label=${format}></forma-ui-badge>`)}</div>
        <forma-ui-button label="Explore formats" variant="ghost"></forma-ui-button>
      </div>`;

    case "forma-generation-actions":
      return html`<div class="component-pattern component-pattern-generation" role="group" aria-label="Example generation options">
        <forma-ui-status label="Ready to explore" tone="positive"></forma-ui-status>
        <div class="component-pattern-action-list" role="group" aria-label="Example generation actions"><forma-ui-button label="Preview draft" variant="primary"></forma-ui-button><forma-ui-button label="Generate full"></forma-ui-button><forma-ui-button label="Fan ×4" variant="ghost"></forma-ui-button></div>
      </div>`;

    case "forma-project-rail":
      return html`<div class="component-pattern component-pattern-rail" role="group" aria-label="Example project navigation">
        <span class="component-pattern-kicker">Current project</span>
        <h4>Summer campaign</h4>
        <ul role="list" aria-label="Sample project sections"><li class="is-current"><strong>Overview</strong><span>Current</span></li><li><span>Collections</span><span>3<span class="sr-only"> collections</span></span></li><li><span>Library</span><span>12<span class="sr-only"> library items</span></span></li></ul>
        <forma-ui-button label="Open project" variant="ghost"></forma-ui-button>
      </div>`;

    default:
      return nothing;
  }
}
