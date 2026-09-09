import { html, nothing } from "lit";
import type { NativeRetainedOutputDto } from "../model/native-retained-output.ts";
import "./model3d-viewer";
import "./model3d-generation.css";
import type { FormaLocaleController } from "./design-system/localization.ts";

type Model3dLocale = Pick<FormaLocaleController, "t" | "number" | "system">;

// This leaf previews only exact manifest-bound GLB bytes. Other file references
// remain metadata; it never turns the generation prompt into an editable mesh.
// The host owns expiry,
// source withdrawal and the exact same-Document inspection handoff.
export function renderNativeRetainedModel3d(
  result: Extract<NativeRetainedOutputDto, { output: "model3d" }>, locale: Model3dLocale,
) {
  const files = result.content.files;
  const preview = files.find(file => file.role === "mesh" && file.format === "glb"
    && file.mimeType === "model/gltf-binary" && file.previewSupported !== false);
  return html`<article class="retained-story-reader" aria-label=${locale.t("model3d.label", "3D model")}>
    ${result.title.trim() ? html`<h2 class="retained-story-title" dir="auto" translate="no">${result.title}</h2>` : nothing}
    ${preview ? html`<forma-model3d-viewer .src=${preview.url} .expectedSha256=${preview.sha256}
      .readonly=${true}></forma-model3d-viewer>` : nothing}
    <section class="model3d-output-files" aria-label=${locale.t("model3d.output.files", "Returned model files and textures")}>
      <h3>${locale.t("model3d.output.files", "Returned model files and textures")}</h3>
      ${files.length ? html`<ul>${files.map(file => html`<li>
        <div><bdi translate="no">${file.fileName}</bdi><small>
          ${file.role === "mesh" ? locale.t("model3d.output.mesh", "Mesh") : file.role === "texture"
            ? locale.t("model3d.output.texture", "Texture") : locale.t("model3d.output.preview", "Preview")}
          ${file.format ? html` · <bdi translate="no">${file.format.toUpperCase()}</bdi>` : nothing}
          · ${locale.number(file.fileSize)} B
        </small></div>
      </li>`)}</ul>` : html`<p role="status">${locale.system("Unavailable")}</p>`}
    </section>
  </article>`;
}
