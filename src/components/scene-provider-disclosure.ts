import { html, nothing } from "lit";
import { isSceneCostPreview, type SceneCostPreview } from "../model/scene-cost-consent.ts";
import type { FormaLocaleController } from "./design-system/localization.ts";

type SceneProviderLocale = Pick<FormaLocaleController, "t" | "number">;

// Never substitute local batch math for an exact server-verified Scene cost descriptor.
export function renderSceneProviderDisclosure(locale: SceneProviderLocale, options: {
  preview?: SceneCostPreview | null;
  existing?: boolean;
}) {
  const preview = isSceneCostPreview(options.preview) ? options.preview : null;
  if (!preview) return html`<aside class="artifact-cost-confirm artifact-scene-provider-disclosure" aria-label=${locale.t("scene.provider.disclosure", "Paid Scene provider, source transmission, and cost")}><span>
    <small>${locale.t("scene.cost.priceUnavailable", "Provider calls and spending ceiling are not verified for the current draft. Check the exact Scene plan before approving paid work.")}</small>
    <small>${locale.t("scene.provider.output", "This creates a written Scene. It does not generate images, video, or audio. Paid attempts and charges remain recorded even if validation prevents an accepted output.")}</small>
  </span></aside>`;
  const planned = preview.providerCallCount, maximum = preview.maximumProviderCallCount;
  const model = "\u2068" + preview.model + "\u2069";
  const amount = locale.number(preview.maximumMicrousd / 1_000_000, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 6 });
  return html`<aside class="artifact-cost-confirm artifact-scene-provider-disclosure" aria-label=${locale.t("scene.provider.disclosure", "Paid Scene provider, source transmission, and cost")} aria-live="polite"><span>
    ${options.existing ? html`<b>${locale.t("scene.cost.original", "Original Scene request — not the current draft")}</b>` : nothing}
    <b>${locale.t("scene.provider.identity", "Paid provider · OpenAI Responses · {model}", { model })}</b>
    <small>${locale.t(preview.itemCount === 1 ? "scene.cost.planOne" : "scene.cost.plan", preview.itemCount === 1 ? "{count} planned written scene · {medium} · {mode}" : "{count} planned written scenes · {medium} · {mode}", { count: locale.number(preview.itemCount),
      medium: locale.t(preview.sceneMedium === "audio" ? "scene.medium.audio" : "scene.medium.visual", preview.sceneMedium),
      mode: locale.t(preview.productionMode === "managed" ? "scene.cost.managed" : "scene.cost.manual", preview.productionMode),
    })}</small>
    <small>${locale.t("scene.cost.reuse", "{count} reused source items included in this verified plan.", { count: locale.number(preview.reusedSourceCount) })}</small>
    <small>${planned === 1
      ? locale.t("scene.provider.callsOne", "1 planned provider request; up to {maximum} total paid requests including bounded validation and continuity repairs.", { maximum: locale.number(maximum) })
      : locale.t("scene.provider.callsMany", "{planned} planned provider requests; up to {maximum} total paid requests including bounded validation and continuity repairs.", { planned: locale.number(planned), maximum: locale.number(maximum) })}</small>
    <small>${options.existing
      ? locale.t("scene.cost.originalCeiling", "Original approved spending ceiling: {amount}. This is not a settled charge or a current reservation balance.", { amount })
      : locale.t("scene.provider.ceiling", "Initial reservation and application-enforced spending ceiling: {amount}. Forma blocks any request or repair whose conservative maximum would exceed this ceiling. This is not a provider-enforced cap.", { amount })}</small>
    ${options.existing ? nothing : html`<small>${locale.t("scene.provider.source", "Submitting sends this Document’s active, authorized text, Scene directions, and selected production source text to OpenAI. Stable source identifiers remain private to Forma.")}</small>`}
    <small>${locale.t("scene.provider.output", "This creates a written Scene. It does not generate images, video, or audio. Paid attempts and charges remain recorded even if validation prevents an accepted output.")}</small>
  </span></aside>`;
}
