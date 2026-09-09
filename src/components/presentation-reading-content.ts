import { html, nothing } from "lit";
import { formatPresentationQuantity, type DocumentArtifactDraftItem } from "../model/document-artifacts.ts";
import type { FormaLocaleController } from "./design-system/localization.ts";

export type PresentationReadingItem = Pick<DocumentArtifactDraftItem, "title" | "body" | "slide">;
export type PresentationReadingLocale = Pick<FormaLocaleController, "system" | "number">;

const OPAQUE_SHARED_SOURCE_LABEL=/^(?:(?:blk|grp|clm|source|context|decision)[_-]\d+|context_group_\d+|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i;

/** The existing shared audience reading article, without host or modal ownership.
 * The caller owns audience projection, authority, locale and mounting lifetime.
 * No presenter notes, private excerpts, media controls or navigation are added.
 */
export function renderPresentationReadingContent(item: PresentationReadingItem, index: number, locale: PresentationReadingLocale) {
  const slide=item.slide,quote=slide?.quote,citations=slide?.citations??[];
  const safeLabel=(value:string)=>{const label=value.trim();return label&&!OPAQUE_SHARED_SOURCE_LABEL.test(label)?label:locale.system("Authorized source citation");};
  return html`<article aria-label=${locale.system("Complete reading version of slide {count}",{count:locale.number(index+1)})}>
        <h3 dir="auto">${item.title}</h3>${item.body?html`<p dir="auto">${item.body}</p>`:nothing}
        ${slide?.bullets.length?html`<ul>${slide.bullets.map((bullet)=>html`<li dir="auto">${bullet}</li>`)}</ul>`:nothing}
        ${quote?.text?html`<blockquote><p dir="auto">${quote.text}</p>${quote.speaker||quote.role?html`<footer dir="auto">${[quote.speaker,quote.role].filter(Boolean).join(" · ")}</footer>`:nothing}${quote.citation?html`<p dir="auto">${safeLabel(quote.citation)}</p>`:nothing}</blockquote>`:nothing}
        ${slide?.visual&&(slide.visual.value||slide.visual.data.length||slide.visual.exactValue||slide.visual.displayValue)?html`<figure><figcaption dir="auto">${slide.visual.label||locale.system("Slide evidence")}</figcaption>${slide.visual.value?html`<p dir="auto">${slide.visual.value}</p>`:nothing}${slide.visual.exactValue||slide.visual.displayValue?html`<dl>${slide.visual.exactValue?html`<dt>${locale.system("Exact value")}</dt><dd>${formatPresentationQuantity(slide.visual.exactValue,slide.visual.unit,{numericOnly:true})}</dd>`:nothing}${slide.visual.displayValue?html`<dt>${locale.system("Rounded display value")}</dt><dd>${formatPresentationQuantity(slide.visual.displayValue,slide.visual.unit,{numericOnly:true})}</dd>`:nothing}</dl>`:nothing}${slide.visual.data.length?html`<dl>${slide.visual.data.map((datum)=>html`<dt dir="auto">${datum.label}</dt><dd dir="auto">${datum.displayValue??datum.value}${datum.exactValue&&datum.exactValue!==(datum.displayValue??datum.value)?html` <span>(${locale.system("Exact value")}: ${datum.exactValue})</span>`:nothing}</dd>`)}</dl>`:nothing}</figure>`:nothing}
        ${citations.length?html`<section><h4>${locale.system("References")}</h4><ul>${citations.map((citation)=>html`<li><b dir="auto">${safeLabel(citation.label)}</b>${citation.anchor&&!OPAQUE_SHARED_SOURCE_LABEL.test(citation.anchor.trim())?html` <span dir="auto">${citation.anchor}</span>`:nothing}</li>`)}</ul></section>`:nothing}
      </article>`;
}
