import { html, nothing } from "lit";
import { styleMap } from "lit/directives/style-map.js";
import { paginateSceneLines, SCENE_PAGINATION_POLICY as P, type ScenePageLine } from "../model/scene-pagination.ts";
import { SCENE_FONT_SHA256 } from "./scene-text-measurement.ts";
import "./native-retained-scene.css";

export type NativeRetainedSceneContent = Readonly<{ title: string; body: string }>;
export type NativeRetainedSceneLabels = Readonly<{
  fixed: string;
  reflow: string;
  unqualified: string;
  tooLong: string;
  page: (page: number, total: number) => string;
  continuation: string;
}>;
export const NATIVE_RETAINED_SCENE_LABELS: NativeRetainedSceneLabels = Object.freeze({
  fixed: "Fixed-page preview · US Letter, DM Mono 12 pt. This is not print or PDF verification.",
  reflow: "Reading view · text wraps here. Page divisions come from the measured layout, not this view or a verified print/PDF.",
  unqualified: "Original text · fixed-font page layout is not verified.",
  tooLong: "Original text · the measured layout exceeds two pages. No two-page or print/PDF verification is claimed.",
  page: (page: number, total: number) => "Measured page " + page + " of " + total,
  continuation: "Pagination continuation, not authored text:",
});

const ownValue = (value: unknown, key: string): unknown => {
  if (!value || typeof value !== "object") return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
};

/** Rendering qualification only. Props confer no source, approval or export
 * authority. Ignore any supplied page frames/counts: use the accepted packer
 * on captured measured lines, and show only current literal body on refusal. */
export function sceneReaderPresentation(body: string, measurement: unknown) {
  const fontFamily = ownValue(measurement, "fontFamily");
  const ink = ownValue(measurement, "ink"), ascent = ownValue(ink, "ascentPx"), descent = ownValue(ink, "descentPx");
  if (ownValue(measurement, "status") !== "measured" || ownValue(measurement, "body") !== body
    || ownValue(measurement, "fontSha256") !== SCENE_FONT_SHA256
    || typeof fontFamily !== "string" || !/^FormaScene-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(fontFamily)
    || ownValue(measurement, "fontSizePt") !== P.fontSizePt || ownValue(measurement, "lineHeightPt") !== P.lineHeightPt
    || ownValue(measurement, "pageCount") !== null
    || typeof ascent !== "number" || typeof descent !== "number" || !Number.isFinite(ascent + descent)
    || ascent < 0 || descent < 0 || ascent + descent + 0.5 > P.lineHeightPt * 4 / 3) {
    return { kind: "fallback" as const, reason: "unqualified" as const };
  }
  const packed = paginateSceneLines(ownValue(measurement, "groups") as Parameters<typeof paginateSceneLines>[0]);
  if (packed.status !== "packed") return { kind: "fallback" as const, reason: packed.status === "too-long" ? "tooLong" as const : "unqualified" as const };
  return { kind: "pages" as const, fontFamily, packed };
}

type Fragment = { sourceIndex: number; kind: "heading" | "action" | "dialogue"; lines: ScenePageLine[] };
function fragments(lines: readonly ScenePageLine[]): Fragment[] {
  const result: Fragment[] = [];
  for (const line of lines) {
    let fragment = result.at(-1);
    if (!fragment || fragment.sourceIndex !== line.sourceIndex) {
      fragment = { sourceIndex: line.sourceIndex, kind: line.role === "heading" || line.role === "action" ? line.role : "dialogue", lines: [] };
      result.push(fragment);
    }
    fragment.lines.push(line);
  }
  return result;
}

/** Stateless, literal retained-reader leaf, following native-retained-story.
 * The host owns exact source/authority/expiry, rechecks after measurement,
 * retains the measured font in the same Document, and removes this subtree
 * on retirement. No parsing, network, font loading, focus, actions or controls.
 * Host integrations supply localized labels; English defaults are explicit.
 * One line-node representation serves both layouts. The narrow reading flow
 * preserves measured line boundaries, literal spaces and empty line cells.
 */
export function renderNativeRetainedScene(
  content: NativeRetainedSceneContent, label: string, measurement: unknown = null,
  labels: NativeRetainedSceneLabels = NATIVE_RETAINED_SCENE_LABELS,
) {
  const presentation = sceneReaderPresentation(content.body, measurement);
  return html`<article class="native-retained-scene-reader" aria-label=${label} data-scene-presentation=${presentation.kind}>
    ${content.title.trim() ? html`<h2 class="native-retained-scene-title" dir="auto" translate="no">${content.title}</h2>` : nothing}
    ${presentation.kind === "fallback" ? html`<p class="native-retained-scene-notice" dir="auto">${labels[presentation.reason]}</p><pre class="native-retained-scene-original" dir="auto" translate="no">${content.body}</pre>`
      : html`<p class="native-retained-scene-notice native-retained-scene-notice--reflow" dir="auto">${labels.reflow}</p>
        <p class="native-retained-scene-notice native-retained-scene-notice--fixed" dir="auto">${labels.fixed}</p>
        <div class="native-retained-scene-pages" style=${styleMap({ "--native-scene-font": '"' + presentation.fontFamily + '"' })}>
          ${presentation.packed.pages.map(page => html`<section class="native-retained-scene-page" data-page-number=${page.pageNumber}>
            <h3 class="native-retained-scene-page-label" dir="auto">${labels.page(page.pageNumber, presentation.packed.pageCount)}</h3>
            <div class="native-retained-scene-frame" dir="ltr">
              ${fragments(page.lines).map(fragment => html`<div class="native-retained-scene-fragment"
                data-source-index=${fragment.sourceIndex} data-scene-kind=${fragment.kind}>
                ${fragment.lines.map(line => html`<span class="native-retained-scene-line" data-scene-role=${line.role}
                  data-source-index=${line.sourceIndex} data-line-index=${line.lineIndex ?? nothing} data-derived=${String(line.derived)}
                  translate="no" style=${styleMap({ "--scene-line-left": line.leftPt + "pt", "--scene-line-top": line.topPt + "pt", "--scene-line-width": line.widthPt + "pt" })}>${line.role === "continuation" ? html`<span class="native-retained-scene-sr-only">${labels.continuation} </span>` : nothing}${line.text}</span>`)}
              </div>`)}
            </div>
          </section>`)}
        </div>`}
  </article>`;
}
