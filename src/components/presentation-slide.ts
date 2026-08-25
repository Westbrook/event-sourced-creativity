import { html, nothing } from "lit";
import {
  authoritativeSlideDatumWeight,
  defaultSlidePresentation,
  formatPresentationQuantity,
  normalizeSlideItem,
  normalizeSlidePresentation,
  normalizeSlideVisual,
  slideVisualIsComplete,
  type DocumentArtifactDraftItem,
  type SlidePresentation,
  type SlideVisualData,
} from "../model/document-artifacts";
import { localizedSourceAnchor } from "../model/source-anchor";
import { inferPresentationAudienceLocale } from "../model/presentation-source";
import {
  PRESENTATION_CANVAS_HEIGHT,
  PRESENTATION_CANVAS_WIDTH,
  planSlideLayout,
} from "../model/presentation-layout";
import { FormaPresentationalElement } from "./presentational-element";

type PresentationQuote = {
  text: string;
  speaker: string;
  role: string;
  citation?: string;
};

type PresentationCitation = {
  label: string;
  anchor: string;
  excerpt: string;
};

type PresentationDatum = SlideVisualData["visual"]["data"][number] & {
  exactValue?: string;
  displayValue?: string;
};

type PresentationVisual = SlideVisualData["visual"] & {
  exactValue?: string;
  displayValue?: string;
  unit?: string;
};

type EnrichedSlideVisualData = SlideVisualData & {
  quote?: PresentationQuote;
  citations?: PresentationCitation[];
  visual: PresentationVisual;
};

const channel = (hex: string, index: number) => Number.parseInt(hex.slice(index, index + 2), 16) / 255;
const luminance = (hex: string) => {
  const values = [1, 3, 5].map((index) => {
    const value = channel(hex, index);
    return value <= .03928 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  });
  return .2126 * (values[0] ?? 0) + .7152 * (values[1] ?? 0) + .0722 * (values[2] ?? 0);
};
const contrast = (left: string, right: string) => {
  const [light, dark] = [luminance(left), luminance(right)].sort((a, b) => b - a);
  return (light + .05) / (dark + .05);
};
const accessibleInk = (background: string, foreground: string) => contrast(background, foreground) >= 4.5
  ? foreground
  : contrast(background, "#111714") > contrast(background, "#ffffff") ? "#111714" : "#ffffff";
const slideStyle = (presentation: SlidePresentation) => {
  const palette = presentation.palette;
  const foreground = accessibleInk(palette.background, palette.foreground);
  const muted = contrast(palette.background, palette.muted) >= 4.5 ? palette.muted : foreground;
  const accentInk = accessibleInk(palette.background, palette.accent);
  const onAccent = accessibleInk(palette.accent, palette.background);
  return `--slide-bg:${palette.background};--slide-ink:${foreground};--slide-accent:${palette.accent};--slide-accent-ink:${accentInk};--slide-on-accent:${onAccent};--slide-muted:${muted};--slide-surface:${palette.surface}${presentation.fontFamily?`;--slide-font:"${presentation.fontFamily}",sans-serif`:""}`;
};

const datumDisplayValue = (datum: PresentationDatum) => datum.displayValue ?? datum.value;
const datumExactValue = (datum: PresentationDatum) => datum.exactValue ?? "";
const privateSourceLabel = (value: string) => /^(?:(?:blk|grp|clm|source|decision)(?:_|-)\d+|context_group_\d+|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(value.trim());
const SLIDE_FOOTER_LABEL_PREFERENCE = "forma:slides:footer-label";
let presentationSlideFitObserver: ResizeObserver | undefined;
const presentationSlideFitMeasurements = new WeakMap<HTMLElement, () => void>();

const observePresentationSlideFit = (host: HTMLElement) => {
  if (typeof ResizeObserver === "undefined") return;
  presentationSlideFitObserver ??= new ResizeObserver((entries) => {
    for (const { target, contentRect: { width, height } } of entries) {
      if (!width || !height) continue;
      const scale = Math.min(width / PRESENTATION_CANVAS_WIDTH, height / PRESENTATION_CANVAS_HEIGHT);
      if (Number.isFinite(scale) && scale > 0) {
        (target as HTMLElement).style.setProperty("--presentation-slide-scale", String(scale));
        presentationSlideFitMeasurements.get(target as HTMLElement)?.();
      }
    }
  });
  presentationSlideFitObserver.observe(host);
};

export const readSlideFooterLabelPreference = () => {
  try {
    return localStorage.getItem(SLIDE_FOOTER_LABEL_PREFERENCE) !== "hidden";
  } catch {
    return true;
  }
};

export const writeSlideFooterLabelPreference = (visible: boolean) => {
  try {
    localStorage.setItem(SLIDE_FOOTER_LABEL_PREFERENCE, visible ? "visible" : "hidden");
  } catch {
    // The active viewer still applies the preference when storage is unavailable.
  }
};

export class PresentationSlide extends FormaPresentationalElement {
  static properties = {
    item: { attribute: false },
    presentation: { attribute: false },
    index: { type: Number },
    total: { type: Number },
    compact: { type: Boolean },
    showFooterLabel: { type: Boolean, attribute: "show-footer-label" },
  };

  item: DocumentArtifactDraftItem = { title: "", body: "", notes: "", image_prompt: "", slide: null };
  presentation: SlidePresentation | null = null;
  index = 0;
  total = 1;
  compact = false;
  showFooterLabel = true;
  #fitFrame = 0;

  override connectedCallback() {
    super.connectedCallback();
    presentationSlideFitMeasurements.set(this, this.#scheduleFitMeasurement);
    observePresentationSlideFit(this);
    if (typeof document !== "undefined") {
      void document.fonts?.ready.then(() => {
        if (this.isConnected) this.#scheduleFitMeasurement();
      });
    }
  }

  override disconnectedCallback() {
    presentationSlideFitObserver?.unobserve(this);
    presentationSlideFitMeasurements.delete(this);
    if (this.#fitFrame && typeof cancelAnimationFrame === "function") cancelAnimationFrame(this.#fitFrame);
    this.#fitFrame = 0;
    super.disconnectedCallback();
  }

  #scheduleFitMeasurement = () => {
    if (typeof requestAnimationFrame !== "function") return;
    if (this.#fitFrame) cancelAnimationFrame(this.#fitFrame);
    this.#fitFrame = requestAnimationFrame(() => {
      this.#fitFrame = 0;
      if (!this.isConnected || !this.clientWidth || !this.clientHeight) return;
      const surfaces = this.querySelectorAll<HTMLElement>(
        ".presentation-slide,.presentation-slide-body,.presentation-slide-body > section,.presentation-slide-body > aside,.presentation-slide__footnotes,.presentation-visual-fields,.presentation-slide__matrix",
      );
      const contentFits = Array.from(surfaces).every((surface) =>
        surface.clientWidth > 0 && surface.clientHeight > 0
          && surface.scrollHeight <= surface.clientHeight + 1
          && surface.scrollWidth <= surface.clientWidth + 1,
      );
      const value = String(contentFits);
      if (this.dataset.presentationContentFits === value) return;
      this.dataset.presentationContentFits = value;
      this.dispatchEvent(new CustomEvent("presentation-slide-fit", {
        bubbles: true,
        composed: true,
        detail: { contentFits },
      }));
    });
  };

  protected override updated() {
    this.#scheduleFitMeasurement();
  }

  #audienceLocale(){return inferPresentationAudienceLocale([this.item.title,this.item.body,this.item.notes,...(this.item.slide?.bullets??[])].join(" "),this.i18n.locale);}
  #audienceText(key:string,fallback:string,values?:Record<string,string|number>){
    return this.#audienceLocale().split("-")[0]===this.i18n.locale.split("-")[0]
      ?this.i18n.t(key,fallback,values)
      :fallback.replace(/\{(\w+)\}/g,(_,name:string)=>String(values?.[name]??""));
  }
  #audienceSystem(source:string,values?:Record<string,string|number>){
    return this.#audienceLocale().split("-")[0]===this.i18n.locale.split("-")[0]
      ?this.i18n.system(source,values)
      :source.replace(/\{(\w+)\}/g,(_,name:string)=>String(values?.[name]??""));
  }
  #audienceNumber(value:number,options?:Intl.NumberFormatOptions){
    const locale=this.#audienceLocale();return locale.split("-")[0]===this.i18n.locale.split("-")[0]?this.i18n.number(value,options):new Intl.NumberFormat(locale,options).format(value);
  }

  #precision(visual: PresentationVisual) {
    const exactValue = visual.exactValue ?? "";
    const displayValue = visual.displayValue ?? "";
    if ((!exactValue && !displayValue) || visual.kind === "roadmap" || visual.kind === "timeline") return nothing;

    return html`<dl class="presentation-slide__scorecard-summary presentation-slide__precision">
      ${exactValue ? html`<dt>${this.#audienceText("presentation.exactValue", "Exact")}</dt><dd><data value=${exactValue}>${formatPresentationQuantity(exactValue,visual.unit,{numericOnly:true})}</data></dd>` : nothing}
      ${displayValue ? html`<dt>${this.#audienceText("presentation.displayValue", "Displayed")}</dt><dd><data value=${displayValue}>${formatPresentationQuantity(displayValue,visual.unit,{numericOnly:true})}</data></dd>` : nothing}
    </dl>`;
  }

  #supplementalData(data: PresentationDatum[], label: string) {
    if (!data.length) return nothing;
    return html`<dl class="presentation-slide__data-list" aria-label=${label}>
      ${data.map((datum) => html`
        <dt class="presentation-slide__datum-label" dir="auto">${datum.label}</dt>
        <dd class="presentation-slide__datum-value" dir="auto">${datumDisplayValue(datum) || "—"}</dd>
      `)}
    </dl>`;
  }

  #quote(quote: PresentationQuote, label: string) {
    const role = quote.role && quote.role !== quote.speaker ? quote.role : "";
    const citation = quote.citation && privateSourceLabel(quote.citation)
      ? this.#audienceText("presentation.authoredSource", "Authored source")
      : quote.citation;
    return html`<figure class="presentation-slide__quote-card" aria-label=${label}>
      <blockquote><p class="presentation-slide__quote-text" dir="auto">${quote.text}</p></blockquote>
      ${quote.speaker || role || citation ? html`
        <figcaption class="presentation-slide__quote-attribution">
          ${quote.speaker ? html`<cite dir="auto">${quote.speaker}</cite>` : nothing}
          ${role ? html`<span dir="auto">${quote.speaker ? " · " : ""}${role}</span>` : nothing}
          ${citation ? html`<small dir="auto">${citation}</small>` : nothing}
        </figcaption>
      ` : nothing}
    </figure>`;
  }

  #bars(visual: PresentationVisual) {
    const data = visual.data as PresentationDatum[];
    return html`<figure class="presentation-visual-bars" aria-label=${visual.label}>
      ${visual.label ? html`<figcaption class="presentation-slide__caption" dir="auto">${visual.label}</figcaption>` : nothing}
      ${data.map((datum) => {
        const value = datumDisplayValue(datum);
        const exactValue = datumExactValue(datum);
        return html`<div class="presentation-slide__chart-row">
          <span class="presentation-slide__datum-label" dir="auto">${datum.label}</span>
          <i aria-hidden="true"><b style=${`--slide-value:${Math.round(authoritativeSlideDatumWeight(visual,datum) * 100)}%`}></b></i>
          <small class="presentation-slide__chart-value" dir="auto">
            <data value=${value}>${value}</data>
            ${exactValue && exactValue !== value ? html`<span> (${this.#audienceText("presentation.exactValue", "Exact")}: ${exactValue})</span>` : nothing}
          </small>
        </div>`;
      })}
      ${this.#precision(visual)}
    </figure>`;
  }

  #comparison(visual: PresentationVisual) {
    const data = visual.data as PresentationDatum[];
    const hasExactValues = data.some((datum) => {
      const exactValue = datumExactValue(datum);
      return exactValue && exactValue !== datumDisplayValue(datum);
    });
    return html`<div class="presentation-slide__matrix">
      <table class="presentation-slide__table">
        <caption class="presentation-slide__caption" dir="auto">${visual.label || visual.value}</caption>
        <thead><tr>
          <th scope="col">${this.#audienceText("presentation.dimension", "Dimension")}</th>
          <th scope="col">${this.#audienceText("presentation.value", "Value")}</th>
          ${hasExactValues ? html`<th scope="col">${this.#audienceText("presentation.exactValue", "Exact")}</th>` : nothing}
        </tr></thead>
        <tbody>${data.map((datum) => html`<tr>
          <th scope="row" dir="auto">${datum.label}</th>
          <td dir="auto"><data value=${datumDisplayValue(datum)}>${datumDisplayValue(datum)}</data></td>
          ${hasExactValues ? html`<td dir="auto">${datumExactValue(datum) || datumDisplayValue(datum)}</td>` : nothing}
        </tr>`)}</tbody>
      </table>
      ${visual.value && visual.value !== visual.label ? html`<p class="presentation-slide__matrix-summary" dir="auto">${visual.value}</p>` : nothing}
      ${this.#precision(visual)}
    </div>`;
  }

  #timeline(visual: PresentationVisual) {
    const data = visual.data as PresentationDatum[];
    const duration=formatPresentationQuantity(visual.displayValue??visual.exactValue,visual.unit,{numericOnly:true});
    const summary=visual.value&&visual.value!==visual.label?visual.value:duration;
    return html`<figure class="presentation-slide__timeline">
      ${visual.label ? html`<figcaption class="presentation-slide__caption" dir="auto">${visual.label}</figcaption>` : nothing}
      <ol class="presentation-visual-timeline" aria-label=${visual.label}>
        ${data.map((datum) => html`<li class="presentation-slide__timeline-item">
          <i aria-hidden="true"></i>
          <span><b dir="auto">${datum.label}</b><small dir="auto">${datumDisplayValue(datum)}</small></span>
        </li>`)}
      </ol>
      ${summary ? html`<p class="presentation-slide__timeline-summary" dir="auto">${summary}</p>` : nothing}
      ${this.#precision(visual)}
    </figure>`;
  }

  #diagram(visual: PresentationVisual) {
    const data = visual.data as PresentationDatum[];
    const structured = visual.value.trim().length > 40
      || data.length > 4
      || data.some((datum) => datum.label.trim().length > 20 || datumDisplayValue(datum).trim().length > 28);
    return html`<figure class=${`presentation-visual-diagram presentation-slide__diagram${structured ? " presentation-slide__diagram--structured" : ""}`} style=${`--slide-node-count:${Math.max(1, data.length)}`}>
      ${visual.label ? html`<figcaption class="presentation-slide__caption" dir="auto">${visual.label}</figcaption>` : nothing}
      <strong dir="auto">${visual.value}</strong>
      ${data.map((datum, index) => html`<span class="presentation-slide__diagram-node" style=${`--slide-node:${index}`}>
        <b dir="auto">${datum.label}</b>
        ${datumDisplayValue(datum) ? html`<small dir="auto">${datumDisplayValue(datum)}</small>` : nothing}
      </span>`)}
    </figure>`;
  }

  #visual(slide: EnrichedSlideVisualData) {
    const visual = slide.visual;
    const kind: string = visual.kind;
    const data = visual.data as PresentationDatum[];

    if (kind === "quote") {
      const quote = slide.quote ?? { text: visual.value, speaker: "", role: visual.label };
      return html`${this.#quote(quote, visual.label)}${this.#supplementalData(data, visual.label)}`;
    }

    if (kind === "hero-type" || kind === "metric") {
      const value = visual.displayValue ?? visual.value;
      const size = value.length > 48 ? "4.2cqi" : value.length > 24 ? "6.4cqi" : "10cqi";
      return html`<div class="presentation-visual-type" style=${`--slide-visual-size:${size}`}>
        <strong dir="auto">${value}</strong>
        ${visual.label ? html`<span dir="auto">${visual.label}</span>` : nothing}
        ${this.#precision(visual)}
        ${this.#supplementalData(data, visual.label)}
      </div>`;
    }

    if (kind === "bars" || kind === "scorecard") return this.#bars(visual);
    if (kind === "comparison" || kind === "matrix" || kind === "personas") return this.#comparison(visual);
    if (kind === "timeline" || kind === "roadmap") return this.#timeline(visual);
    if (kind === "diagram" || kind === "architecture") return this.#diagram(visual);

    // Color fields cannot place more than three separate bubbles without overlap.
    // Preserve larger evidence sets as a complete, readable semantic table.
    if (data.length > 3) return this.#comparison(visual);

    return html`<figure class="presentation-visual-fields" aria-label=${visual.label}>
      ${visual.label ? html`<figcaption class="presentation-slide__caption" dir="auto">${visual.label}</figcaption>` : nothing}
      ${data.map((datum, index) => html`<i style=${`--slide-field:${index};--slide-field-size:${Math.round(34 + datum.weight * 24)}%;--slide-field-mix:${Math.round(28 + datum.weight * 38)}%`}>
        <span dir="auto">${datum.label}${datumDisplayValue(datum) ? html`<small> ${datumDisplayValue(datum)}</small>` : nothing}</span>
      </i>`)}
    </figure>`;
  }

  #citations(slide: EnrichedSlideVisualData) {
    if (!slide.citations?.length) return nothing;
    return html`<section class="presentation-slide__footnotes" aria-label=${this.#audienceText("presentation.evidence", "Evidence and sources")}>
      <ol>${slide.citations.map((citation) => {
        const label = privateSourceLabel(citation.label)
          ? this.#audienceText("presentation.authoredSource", "Authored source")
          : citation.label;
        const anchor = privateSourceLabel(citation.anchor) ? "" : citation.anchor;
        return html`<li class="presentation-slide__citation" dir="auto">
          ${anchor ? html`<span class="presentation-slide__citation-anchor">${localizedSourceAnchor(anchor,(source,values)=>this.#audienceSystem(source,values),(value)=>this.#audienceNumber(value))}</span> ` : nothing}
          <cite>${label}</cite>
          ${citation.excerpt ? html`<span class="presentation-slide__citation-excerpt"> — ${citation.excerpt}</span>` : nothing}
        </li>`;
      })}</ol>
    </section>`;
  }

  override render() {
    const presentation = normalizeSlidePresentation(this.presentation) ?? defaultSlidePresentation();
    const originalItem = normalizeSlideItem(this.item, this.index);
    const layout = planSlideLayout(originalItem, presentation);
    const item = layout.visibleItem;
    const slide = (item.slide ?? normalizeSlideVisual(null, item, this.index)) as EnrichedSlideVisualData;
    const kind: string = slide.visual.kind;
    const hasVisual = slideVisualIsComplete(slide) || kind === "quote" && Boolean(slide.quote?.text);
    const showDeckLabel = this.showFooterLabel && Boolean(presentation.footerLabel);
    const inlineQuote = slide.quote && kind !== "quote" ? slide.quote : null;

    return html`<article
      class=${`presentation-slide ${layout.className} style-${presentation.stylePreset} layout-${slide.layout} visual-${kind}${hasVisual ? "" : " no-visual"}${this.compact ? " compact" : ""}`}
      data-presentation-artboard="960x540"
      data-layout-version=${layout.version}
      data-layout-density=${layout.density}
      data-reading-recommended=${String(layout.overflow.readingModeRecommended)}
      style=${`${slideStyle(presentation)};--presentation-safe-inline:${layout.safeArea.inline}px;--presentation-safe-block:${layout.safeArea.block}px`}
      aria-label=${this.#audienceText("presentation.slide", "Slide {index} of {total}: {title}", {
        index: this.#audienceNumber(this.index + 1),
        total: this.#audienceNumber(this.total),
        title: "\u2068" + item.title + "\u2069",
      })}
    >
      <header>
        <span dir="auto">${slide.kicker}</span>
        <small>${this.#audienceNumber(this.index + 1, { minimumIntegerDigits: 2 })} / ${this.#audienceNumber(this.total, { minimumIntegerDigits: 2 })}</small>
      </header>
      <div class="presentation-slide-body">
        <section>
          <h3 dir="auto">${item.title}</h3>
          ${item.body ? html`<p dir="auto">${item.body}</p>` : nothing}
          ${slide.bullets.length ? html`<ul>${slide.bullets.map((bullet) => html`<li dir="auto">${bullet}</li>`)}</ul>` : nothing}
          ${inlineQuote ? this.#quote(inlineQuote, this.#audienceText("presentation.stakeholderQuote", "Stakeholder quotation")) : nothing}
          ${this.#citations(slide)}
        </section>
        ${hasVisual ? html`<aside aria-label=${slide.visual.label}>${this.#visual(slide)}</aside>` : nothing}
      </div>
      <footer>
        ${showDeckLabel ? html`<span dir="auto">${presentation.footerLabel}</span>` : nothing}
        ${hasVisual ? html`<span dir="auto">${slide.visual.label}</span>` : nothing}
      </footer>
    </article>`;
  }
}

customElements.define("forma-presentation-slide", PresentationSlide);
declare global { interface HTMLElementTagNameMap { "forma-presentation-slide": PresentationSlide } }
