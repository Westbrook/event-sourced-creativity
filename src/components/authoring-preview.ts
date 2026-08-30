import { html, nothing } from "lit";
import type { AuthoringPreview } from "../../worker/authoring-commits";
import type { FormaLocaleController } from "./design-system/localization";
import "./authoring-preview.css";

export type AuthoringPreviewOptions = {
  id: string;
  status: "review" | "applying" | "applied";
  destinationDocumentId?: string;
  summary?: string;
  hint?: string;
  /** Inspection suppresses action guidance, but keeps a completed receipt hint. */
  readOnly?: boolean;
};

/** The existing exact-change review, shared by free human-authoring flows. */
export function renderAuthoringPreview(
  preview: AuthoringPreview,
  i18n: Pick<FormaLocaleController, "t" | "number" | "system">,
  options: AuthoringPreviewOptions,
) {
  const applied = options.status === "applied", applying = options.status === "applying";
  // Counts describe affected decisions, including edits; they are not creation counts.
  return html`<section class="context-change-preview" aria-labelledby=${options.id}>
    <h3 tabindex="-1" id=${options.id}>${i18n.t("context.changes.title")}</h3>
    <p role="status">${options.summary ?? i18n.t(applied ? "context.changes.applied" : applying ? "context.changes.applying" : "context.changes.summary", "",
      {blocks:i18n.number(preview.blockCount),relations:i18n.number(preview.relationCount)})}</p>
    ${!options.readOnly || applied ? html`<p>${options.hint ?? i18n.t(applied ? "context.changes.appliedHint" : "context.changes.atomic")}</p>` : nothing}
    <ol>${preview.changes.map((change) => html`<li><b>${i18n.t(`context.changes.${change.kind}`)} · <span dir="auto">${change.label}</span></b>${change.type ? html`<small>${i18n.system(change.type)}</small>` : nothing}<p dir="auto">${change.kind === "group" ? i18n.t("context.changes.isolate") : change.text}</p></li>`)}</ol>
    <details><summary>${i18n.t("context.changes.destination")}</summary><p>${preview.projectId} / ${options.destinationDocumentId ?? preview.documentId}${preview.canvasId ? ` / ${preview.canvasId}` : ""}</p><p>${preview.sourceHash}</p><p>${preview.expiresAt}</p><pre dir="ltr">${JSON.stringify(preview.events,null,2)}</pre></details>
  </section>`;
}
