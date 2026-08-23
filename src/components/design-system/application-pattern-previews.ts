import { html, nothing, type TemplateResult } from "lit";

type PatternMessages = {
  t: (id: string, fallback?: string, values?: Record<string, string | number>) => string;
  number: (value: number, options?: Intl.NumberFormatOptions) => string;
  plural: (id: string, count: number, one: string, other: string, values?: Record<string, string | number>) => string;
};

function sampleArtwork(label: string, variant: "output" | "reference") {
  return html`<div class=${`component-pattern-artwork component-pattern-artwork--${variant}`} role="img" aria-label=${label}>
    ${variant === "reference" ? html`<span class="component-pattern-focal-point" aria-hidden="true"></span>` : nothing}
  </div>`;
}

function sampleFan(messages: PatternMessages) {
  const approaches = [messages.t("sample.prose", "Prose"), messages.t("sample.bullets", "Bullets"), "JSON", "XML"];
  return html`<div class="component-pattern-fan" role="group" aria-label=${messages.t("pattern.fanVisual", "Example four-direction creative comparison")}>
    ${approaches.map((approach, index) => html`<figure>
      <div class=${`component-pattern-fan-art component-pattern-fan-art--${index + 1}`} aria-hidden="true"></div>
      <figcaption>${approach}</figcaption>
    </figure>`)}
  </div>`;
}

/**
 * Read-only application-pattern illustrations assembled from real UI primitives.
 * Application elements are intentionally never imported, mounted, or observed.
 */
export function renderApplicationPatternPreview(tag: string, messages: PatternMessages): TemplateResult | typeof nothing {
  const t = (id: string, fallback: string, values: Record<string, string | number> = {}) => messages.t(id, fallback, values);
  const count = (value: number) => messages.number(value);
  switch (tag) {
    case "forma-area-navigation":
      return html`<div class="component-pattern component-pattern-navigation" role="group" aria-label=${t("pattern.navigation", "Example audience-specific navigation")}>
        <span class="component-pattern-kicker">${t("shell.knowledge", "Design & Knowledge")}</span>
        <forma-ui-audience-navigation .label=${t("pattern.knowledgeSections", "Example Design & Knowledge sections")} value="components" .destinations=${[
          { label: t("shell.navigation.components", "Components"), value: "components", href: "#forma-area-navigation" },
          { label: t("shell.navigation.patterns", "Patterns"), value: "patterns", href: "#forma-area-navigation" },
          { label: t("shell.navigation.guidance", "Guidance"), value: "guidance", href: "#forma-area-navigation" },
        ]}></forma-ui-audience-navigation>
        <h4>${t("pattern.workspaceOwnedResources","Same project, workspace-owned destinations")}</h4>
        <forma-ui-audience-navigation .label=${t("shell.canvas","Canvas")} value="library" .destinations=${[
          {label:t("shell.navigation.canvases","Canvases"),value:"canvases",href:"#forma-area-navigation-canvas"},
          {label:t("shell.navigation.projects","Projects"),value:"projects",href:"#forma-area-navigation-canvas-projects"},
          {label:t("shell.navigation.library","Library"),value:"library",href:"#forma-area-navigation-canvas-library"},
        ]}></forma-ui-audience-navigation>
        <p><code>/canvas/projects</code> · <code>/canvas/library</code> — ${t("pattern.sharedProjectResources","Same project and Library; no unexpected workspace switch.")}</p>
      </div>`;

    case "forma-platform-shell":
      return html`<div class="component-pattern component-pattern-navigation" role="group" aria-label=${t("pattern.platformShell", "Example isolated Product & Quality workspace")}>
        <span class="component-pattern-kicker">${t("shell.product", "Product & Quality")}</span>
        <forma-ui-workspace-switcher .label=${t("navigation.availableWorkspaces", "Available workspaces")} value="product" .destinations=${[
          { label: t("shell.product", "Product & Quality"), value: "product", href: "#forma-platform-shell" },
          { label: t("shell.knowledge", "Design & Knowledge"), value: "knowledge", href: "#forma-platform-shell" },
        ]}></forma-ui-workspace-switcher>
        <forma-ui-audience-navigation .label=${t("shell.product", "Product & Quality")} value="insights" .destinations=${[
          { label: t("shell.navigation.insights", "Insights"), value: "insights", href: "#forma-platform-shell" },
          { label: t("shell.navigation.delivery", "Delivery"), value: "delivery", href: "#forma-platform-shell" },
        ]}></forma-ui-audience-navigation>
      </div>`;

    case "forma-workspace-settings":
      return html`<div class="component-pattern component-pattern-navigation" role="group" aria-label=${t("pattern.workspaceAdministration","Example scoped Creator Workspace administration")}>
        <span class="component-pattern-kicker">${t("workspace.admin.eyebrow","Creator settings")}</span>
        <h4>${t("sample.campaign","Summer campaign")}</h4>
        <forma-ui-audience-navigation .label=${t("workspace.admin.navigation","Organization settings")} value="members" .destinations=${[
          {label:t("workspace.admin.section.members","Members"),value:"members",href:"#forma-workspace-settings"},
          {label:t("workspace.admin.section.projects","Projects"),value:"projects",href:"#forma-workspace-settings"},
          {label:t("workspace.admin.section.usage","Usage"),value:"usage",href:"#forma-workspace-settings"},
        ]}></forma-ui-audience-navigation>
        <forma-ui-list-item .label=${"Avery Park"} .detail=${t("workspace.admin.role.editor","Editor")} value="fictional-member"></forma-ui-list-item>
        <forma-ui-switch .label=${t("workspace.admin.canvasAccessNamed","Allow Canvas access for {name}",{name:"Avery Park"})} .help=${t("workspace.admin.canvasAccessHelp","Their project role determines whether they can edit the board.")} .checked=${true}></forma-ui-switch>
        <p>${t("workspace.admin.editorBudgetNotice","Editors can create outputs using their personal and organization budgets; viewers cannot.")}</p>
        <forma-ui-notice .heading=${t("workspace.admin.readOnlyProject","You have view-only access to this shared project.")} tone="neutral" value="fictional-project-notice"></forma-ui-notice>
      </div>`;

    case "forma-collection-tree":
      return html`<div class="component-pattern component-pattern-collections" role="group" aria-label=${t("pattern.collectionsExample", "Example project collections")}>
        <header><strong>${t("pattern.collections", "Collections")}</strong><forma-ui-badge .label=${messages.plural("pattern.items", 3, "{count} item", "{count} items")}></forma-ui-badge></header>
        <ul role="list" aria-label=${t("pattern.collectionHierarchy", "Sample collection hierarchy")}><li><strong>${t("sample.campaign", "Summer campaign")}</strong>
          <ul role="list"><li><span>${t("pattern.concepts", "Concept studies")}</span><span>${messages.plural("pattern.items", 2, "{count} item", "{count} items")}</span></li><li><span>${t("pattern.approved", "Approved references")}</span><span>${messages.plural("pattern.items", 1, "{count} item", "{count} items")}</span></li></ul>
        </li></ul>
        <forma-ui-button .label=${t("pattern.openCollection", "Open collection")} value="open-collection" variant="ghost"></forma-ui-button>
      </div>`;

    case "forma-output-visual":
      return html`<div class="component-pattern component-pattern-media" role="group" aria-label=${t("pattern.output", "Example generated image")}>
        ${sampleArtwork(t("pattern.outputImage", "Soft blue generated concept with warm morning light"), "output")}
        <div class="component-pattern-actions"><forma-ui-badge .label=${t("sample.full", "Full quality")} tone="positive"></forma-ui-badge><forma-ui-button .label=${t("pattern.review", "Review image")} value="review-image" variant="ghost"></forma-ui-button></div>
      </div>`;

    case "forma-reference-image":
      return html`<figure class="component-pattern component-pattern-media">
        ${sampleArtwork(t("pattern.referenceImage", "Authorized source reference with its focal point in the upper right"), "reference")}
        <figcaption class="component-pattern-actions"><forma-ui-badge .label=${t("pattern.authorized", "Authorized source")}></forma-ui-badge><forma-ui-button .label=${t("pattern.openReference", "Inspect reference")} value="inspect-reference" variant="ghost"></forma-ui-button></figcaption>
      </figure>`;

    case "forma-artifact-summary":
      return html`<div class="component-pattern component-pattern-artifact" role="group" aria-label=${t("pattern.artifact", "Example story outcome")}>
        <div class="component-pattern-actions"><forma-ui-icon name="story" .label=${t("sample.story", "Written story")}></forma-ui-icon><forma-ui-badge .label=${t("sample.story", "Story")} tone="accent"></forma-ui-badge></div>
        <h4>${t("pattern.quietBeginning", "A quieter beginning")}</h4>
        <p>${t("pattern.quietDetail", "A short opening about finding space for the unexpected.")}</p>
      </div>`;

    case "forma-prompt-fan-visual":
      return html`<div class="component-pattern component-pattern-comparison" role="group" aria-label=${t("pattern.fanVisual", "Example four-direction creative comparison")}>
        ${sampleFan(messages)}
        <forma-ui-badge .label=${messages.plural("pattern.directionsCount", 4, "{count} direction", "{count} directions")} tone="positive"></forma-ui-badge>
      </div>`;

    case "forma-prompt-fan-review":
      return html`<div class="component-pattern component-pattern-comparison" role="group" aria-label=${t("pattern.fanReview", "Example creative direction review")}>
        ${sampleFan(messages)}
        <div class="component-pattern-actions"><forma-ui-badge .label=${t("pattern.selectedApproach", "Bullets selected")} tone="accent"></forma-ui-badge><forma-ui-button .label=${t("pattern.selectDirection", "Keep this direction")} value="keep-direction"></forma-ui-button></div>
      </div>`;

    case "forma-presentation-slide":
      return html`<div class="component-pattern component-pattern-slide" role="group" aria-label=${t("pattern.slide", "Example presentation slide, one of three")}>
        <header><span>${t("pattern.creativeDirection", "Creative direction")}</span><span>${count(1)} / ${count(3)}</span></header>
        <h4>${t("pattern.ideaHeading", "Make room for the idea")}</h4>
        <p>${t("pattern.ideaDetail", "Start with one clear outcome and build from there.")}</p>
        <div class="component-pattern-slide-accent" aria-hidden="true"></div>
      </div>`;

    case "forma-presentation-deck":
      return html`<div class="component-pattern component-pattern-deck" role="group" aria-label=${t("pattern.deck", "Example three-slide presentation")}>
        <div class="component-pattern-deck-thumbnails" aria-hidden="true"><span>${count(1)}</span><span>${count(2)}</span><span>${count(3)}</span></div>
        <h4>${t("pattern.campaignDirection", "Campaign direction")}</h4>
        <forma-ui-segmented-control .label=${t("pattern.selectSlide", "Choose a sample presentation slide")} value="1" .options=${[1, 2, 3].map((value) => ({ label: count(value), value: String(value) }))}></forma-ui-segmented-control>
      </div>`;

    case "forma-document-artifacts":
      return html`<div class="component-pattern component-pattern-formats" role="group" aria-label=${t("pattern.artifacts", "Example available document outcomes")}>
        <h4>${t("pattern.chooseOutcome", "Choose an outcome")}</h4>
        <div class="component-pattern-format-list">${["story", "slides", "storyboard", "video"].map((format) => html`<forma-ui-badge .label=${t("sample." + format, format)}></forma-ui-badge>`)}</div>
        <forma-ui-button .label=${t("pattern.exploreFormats", "Explore formats")} value="explore-formats" variant="ghost"></forma-ui-button>
      </div>`;

    case "forma-generation-actions":
      return html`<div class="component-pattern component-pattern-generation" role="group" aria-label=${t("pattern.actions", "Example generation options")}>
        <forma-ui-status .label=${t("pattern.readyExplore", "Ready to explore")} tone="positive"></forma-ui-status>
        <div class="component-pattern-action-list" role="group" aria-label=${t("pattern.actions", "Example generation actions")}><forma-ui-button .label=${t("pattern.previewDraft", "Preview draft")} value="preview-draft" variant="primary"></forma-ui-button><forma-ui-button .label=${t("pattern.generateFull", "Generate full")} value="generate-full"></forma-ui-button><forma-ui-button .label=${t("pattern.fanCount", "Fan ×{count}", { count: count(4) })} value="generate-fan" variant="ghost"></forma-ui-button></div>
      </div>`;

    case "forma-project-rail":
      return html`<div class="component-pattern component-pattern-rail" role="group" aria-label=${t("pattern.rail", "Example project navigation")}>
        <span class="component-pattern-kicker">${t("pattern.currentProject", "Current project")}</span>
        <h4>${t("sample.campaign", "Summer campaign")}</h4>
        <ul role="list" aria-label=${t("pattern.sections", "Sample project sections")}><li class="is-current"><strong>${t("pattern.overview", "Overview")}</strong><span>${t("pattern.current", "Current")}</span></li><li><span>${t("pattern.collections", "Collections")}</span><span>${count(3)}<span class="sr-only"> ${t("pattern.collections", "collections")}</span></span></li><li><span>${t("pattern.library", "Library")}</span><span>${count(12)}<span class="sr-only"> ${t("pattern.libraryItems", "library items")}</span></span></li></ul>
        <forma-ui-button .label=${t("pattern.openProject", "Open project")} value="open-project" variant="ghost"></forma-ui-button>
      </div>`;

    default:
      return nothing;
  }
}
