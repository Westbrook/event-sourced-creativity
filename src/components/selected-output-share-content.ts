import { html } from "lit";
import type { DocumentArtifactDraftItem, SlideVisualData } from "../model/document-artifacts.ts";
import type { SelectedOutputSharePublicOutput, SelectedOutputShareSlide } from "../model/selected-output-share.ts";
import type { FormaLocaleController } from "./design-system/localization.ts";
import { renderPresentationReadingContent } from "./presentation-reading-content.ts";
import { selectedOutputShareCopy, selectedOutputShareExpiryLabel } from "./selected-output-share-messages.ts";
import "./presentation-slide";
import "./forma-retained-short-story.css";
import "../experiences/results/slides-reader.css";

type PublicSlides = Extract<SelectedOutputSharePublicOutput, { output: "slides" }>;
type ReaderLocale = Pick<FormaLocaleController, "locale" | "system" | "number" | "date">;

function presentationSlide(slide: SelectedOutputShareSlide | null): SlideVisualData | null {
  if (!slide) return null;
  // Compatibility data for the existing presentation leaves, never a retained
  // output or authority DTO. Empty producer/evidence fields carry no input data.
  return {
    layout: slide.layout, kicker: slide.kicker, bullets: [...slide.bullets],
    ...(slide.section !== undefined ? { section: slide.section } : {}),
    ...(slide.quote ? { quote: { ...slide.quote } } : {}),
    ...(slide.citations ? { citations: slide.citations.map(citation => ({ label: citation.label, anchor: citation.anchor, excerpt: "" })) } : {}),
    visual: { ...slide.visual, data: slide.visual.data.map(datum => ({ ...datum })) },
  };
}

function presentationItem(item: PublicSlides["content"]["items"][number]): DocumentArtifactDraftItem {
  return { title: item.title, body: item.body, notes: "", image_prompt: "", slide: presentationSlide(item.slide) };
}

/** A pure renderer for the already validated public fields. The recipient host
 * owns token reads, expiry and mount retirement. No source identity, media,
 * Markdown/HTML interpretation, linkification or private input is introduced.
 */
export function renderSelectedOutputShareContent(output: SelectedOutputSharePublicOutput, locale: ReaderLocale) {
  const copy = selectedOutputShareCopy(locale.locale);
  const expires = selectedOutputShareExpiryLabel(locale.locale,
    locale.date(Date.parse(output.expiresAt), { dateStyle: "medium", timeStyle: "short" }));
  const footer = html`<footer class="selected-output-share-footer" style="padding:1rem;overflow-wrap:anywhere">
    <p>${copy.attribution}</p><p>${copy.accessScope}</p><p><time datetime=${output.expiresAt}>${expires}</time></p>
  </footer>`;
  if (output.output !== "slides") {
    return html`<article class="retained-story-reader" aria-label=${copy.outputKinds[output.output]}>
      <h1 class="retained-story-title" dir="auto" translate="no">${output.title}</h1>
      <pre class="retained-story-content" dir="auto" translate="no">${output.content.text}</pre>
      ${footer}
    </article>`;
  }
  return html`<section class="experience-slides-reader" aria-label=${copy.outputKinds.slides}>
    <h1 class="experience-slides-title" dir="auto" translate="no">${output.title}</h1>
    <ol class="shared-slide-list" style="list-style:none;margin:0;padding:0" role="list">
      ${output.content.items.map((publicItem, index) => {
        const item = presentationItem(publicItem);
        return html`<li class="experience-slides-item">
          <forma-presentation-slide .item=${item} .presentation=${output.content.presentation}
            .index=${index} .total=${output.content.items.length} .compact=${true} .showFooterLabel=${true}></forma-presentation-slide>
          <details class="shared-presentation-reader experience-slides-reading">
            <summary>${locale.system("Read slide")} <bdi>${locale.number(index + 1)}</bdi></summary>
            ${renderPresentationReadingContent(item, index, locale)}
          </details>
        </li>`;
      })}
    </ol>
    ${footer}
  </section>`;
}
