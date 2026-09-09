import { html, nothing } from "lit";
import type { NativeRetainedOutputDto } from "../model/native-retained-output.ts";
import { renderPresentationReadingContent, type PresentationReadingLocale } from "./presentation-reading-content.ts";
import "./presentation-slide";
import "../experiences/results/slides-reader.css";

/** Native-authorized audience content only. The retained host owns the read,
 * mount lifetime and exact artifact handoff; no Experience identity is inferred.
 * The existing slide leaf and page-flow reading styles remain shared.
 */
export function renderNativeRetainedSlides(
  result: Extract<NativeRetainedOutputDto, { output: "slides" }>, locale: PresentationReadingLocale,
) {
  const { items, presentation } = result.content;
  return html`<section class="experience-slides-reader" aria-label=${locale.system("Slides")}>
    ${result.title.trim() ? html`<h2 class="experience-slides-title" dir="auto" translate="no">${result.title}</h2>` : nothing}
    <div class="shared-slide-list">${items.map((item, index) => html`<div class="experience-slides-item">
      <forma-presentation-slide .item=${item} .presentation=${presentation} .index=${index} .total=${items.length}
        .compact=${true} .showFooterLabel=${true}></forma-presentation-slide>
      <details class="shared-presentation-reader experience-slides-reading">
        <summary>${locale.system("Read slide")} <bdi>${locale.number(index + 1)}</bdi></summary>
        ${renderPresentationReadingContent(item, index, locale)}
      </details>
    </div>`)}</div>
  </section>`;
}
