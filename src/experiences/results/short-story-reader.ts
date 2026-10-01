import { html, nothing } from "lit";
import type { ExperienceResultDto } from "./contracts.ts";

export type ExperienceShortStoryResult = Extract<ExperienceResultDto, { output: "short_story" }>;

/**
 * Read-only presentation, deliberately disconnected from the public entry.
 * The host must establish current read authority and validate the DTO against
 * independently retained identity before calling this function. It also owns
 * mounting, retirement, focus, and the exact Edit in Forma continuation.
 *
 * Match the native artifact reader's literal text parts: no HTML interpretation,
 * Markdown rewriting, linkification, summary, truncation, or media requests.
 */
export function renderExperienceShortStory(result: ExperienceShortStoryResult) {
  return html`<article class="experience-short-story-reader" aria-label="Short story">
    ${result.title.trim() ? html`<h2 class="experience-short-story-title" dir="auto">${result.title}</h2>` : nothing}
    <pre class="experience-short-story-content" dir="auto">${result.content.content_markdown}</pre>
  </article>`;
}
