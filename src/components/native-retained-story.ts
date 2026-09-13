import { html, nothing } from "lit";

/** Literal reading content shared by the retained and Experience hosts.
 * The caller owns authorization, exact result identity, expiry and retirement.
 * This function neither validates a narrative contract nor reads private data.
 * Hosts include forma-retained-short-story.css for the shared page-flow styles.
 * No Markdown/HTML interpretation, normalization, controls or nested scroller.
 */
export function renderNativeRetainedStory(
  content: Readonly<{ title: string; contentMarkdown: string }>, label: string,
) {
  return html`<article class="retained-story-reader" aria-label=${label}>
    ${content.title.trim() ? html`<h2 class="retained-story-title" dir="auto" translate="no">${content.title}</h2>` : nothing}
    <pre class="retained-story-content" dir="auto" translate="no">${content.contentMarkdown}</pre>
  </article>`;
}
