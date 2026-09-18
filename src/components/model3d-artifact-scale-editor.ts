import { html, nothing } from "lit";
import type { Model3dGeometryBounds } from "../model/model3d-geometry-edit.ts";
import { model3dScaleCopy, type Model3dScaleCopy } from "./design-system/locales/model3d-artifact-scale-messages.ts";
import "./model3d-artifact-scale-editor.css";

export type Model3dArtifactScaleView = Readonly<{
  locale: string;
  fieldForm: string;
  factor: string;
  beforeBounds: Model3dGeometryBounds | null;
  afterBounds: Model3dGeometryBounds | null;
  loading: boolean;
  preparing: boolean;
  saving: boolean;
  checking: boolean;
  ready: boolean;
  code: keyof Model3dScaleCopy["status"] | null;
  onFactorInput: (event: InputEvent) => void;
  onSave: (event: MouseEvent) => void;
  onCancel: (event: MouseEvent) => void;
  onCheck: (event: MouseEvent) => void;
}>;

function dimensions(bounds: Model3dGeometryBounds, locale: string) {
  const numbers = new Intl.NumberFormat(locale, { maximumSignificantDigits: 9 });
  return html`<span dir="ltr">X: ${numbers.format(bounds.size[0])} · Y: ${numbers.format(bounds.size[1])} · Z: ${numbers.format(bounds.size[2])}</span>`;
}

/** Passive native controls. The existing artifact host owns every private read,
 * source check, prepared candidate, publication, cancellation and focus intent. */
export function renderModel3dArtifactScaleEditor(view: Model3dArtifactScaleView) {
  const copy = model3dScaleCopy(view.locale), inputId = `${view.fieldForm}-factor`, helpId = `${view.fieldForm}-help`;
  return html`<section class="artifact-model3d-scale" aria-label=${copy.title}>
    <h3>${copy.title}</h3>
    <p id=${helpId}>${copy.help}</p>
    ${view.loading ? html`<p role="status">${copy.loading}</p>` : nothing}
    ${view.preparing ? html`<p role="status">${copy.preparing}</p>` : nothing}
    ${view.checking ? html`<p role="status">${copy.checking}</p>` : nothing}
    ${view.code ? html`<p class="artifact-model3d-scale-status" role="status">${copy.status[view.code]}</p>` : nothing}
    ${view.beforeBounds ? html`<div class="artifact-model3d-scale-field">
      <label for=${inputId}>${copy.factor}</label>
      <input id=${inputId} class="artifact-model3d-scale-factor" type="number" min="0" step="any" inputmode="decimal"
        form=${view.fieldForm} .value=${view.factor} aria-describedby=${helpId}
        aria-invalid=${String(view.code === "invalid_scale")}
        ?disabled=${view.saving || view.checking || view.code === "unconfirmed"}
        @input=${view.onFactorInput}>
      <dl class="artifact-model3d-scale-dimensions">
        <div><dt>${copy.currentDimensions}</dt><dd>${dimensions(view.beforeBounds, view.locale)}</dd></div>
        ${view.afterBounds ? html`<div><dt>${copy.proposedDimensions}</dt><dd>${dimensions(view.afterBounds, view.locale)}</dd></div>` : nothing}
      </dl><p>${copy.units}. ${copy.autoFit}</p>
    </div>` : nothing}
    <p class="artifact-model3d-scale-notes">${copy.originalNotes}</p>
  </section>`;
}

/** Keep the normal viewer action area and its native button sizing. */
export function renderModel3dArtifactScaleActions(view: Model3dArtifactScaleView) {
  const copy = model3dScaleCopy(view.locale), pending = view.saving || view.checking;
  return html`<div class="artifact-model3d-scale-actions">
    <button type="button" form=${view.fieldForm} class="button primary artifact-model3d-scale-save"
      aria-disabled=${String(pending || view.loading || view.preparing || !view.ready || view.code === "unconfirmed")}
      aria-busy=${String(view.saving)} @click=${view.onSave}>${view.saving ? copy.saving : copy.save}</button>
    <button type="button" form=${view.fieldForm} class="button secondary artifact-model3d-scale-cancel"
      ?disabled=${pending} @click=${view.onCancel}>${copy.cancel}</button>
    ${view.code === "unconfirmed" || view.checking ? html`<button type="button" form=${view.fieldForm}
      class="button secondary artifact-model3d-scale-check" aria-disabled=${String(pending)}
      aria-busy=${String(view.checking)} @click=${view.onCheck}>${view.checking ? copy.checking : copy.check}</button>` : nothing}
  </div>`;
}
