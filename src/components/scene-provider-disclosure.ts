import { html } from "lit";
import type { ManagedProductionPlan } from "../model/managed-production.ts";
import type { FormaLocaleController } from "./design-system/localization.ts";

type SceneProviderPlan = Pick<ManagedProductionPlan, "providerCallCount" | "maximumProviderCallCount" | "estimatedPlanningCostMicrousd">;
type SceneProviderLocale = Pick<FormaLocaleController, "t" | "number">;

/** A Scene is a paid written artifact; its complete cost is the bounded planning cost. */
export function renderSceneProviderDisclosure(locale: SceneProviderLocale, options: {
  model?: string;
  production?: SceneProviderPlan | null;
}) {
  const planned = options.production?.providerCallCount ?? 1;
  const maximum = options.production?.maximumProviderCallCount ?? 2;
  const reservation = options.production?.estimatedPlanningCostMicrousd ?? 1_000_000;
  const model = options.model ?? locale.t("scene.provider.modelUnavailable", "Configured text model");
  return html`<aside class="artifact-cost-confirm artifact-scene-provider-disclosure" aria-label=${locale.t("scene.provider.disclosure", "Paid Scene provider, source transmission, and cost")} aria-live="polite"><span>
    <b>${locale.t("scene.provider.identity", "Paid provider · OpenAI Responses · {model}", { model })}</b>
    <small>${planned === 1
      ? locale.t("scene.provider.callsOne", "1 planned provider request; up to {maximum} total paid requests including bounded validation and continuity repairs.", { maximum: locale.number(maximum) })
      : locale.t("scene.provider.callsMany", "{planned} planned provider requests; up to {maximum} total paid requests including bounded validation and continuity repairs.", { planned: locale.number(planned), maximum: locale.number(maximum) })}</small>
    <small>${locale.t("scene.provider.ceiling", "Initial reservation and application-enforced spending ceiling: {amount}. Forma blocks any request or repair whose conservative maximum would exceed this ceiling. This is not a provider-enforced cap.", { amount: locale.number(reservation / 1_000_000, { style: "currency", currency: "USD" }) })}</small>
    <small>${locale.t("scene.provider.source", "Submitting sends this Document’s active, authorized text, Scene directions, and selected production source text to OpenAI. Stable source identifiers remain private to Forma.")}</small>
    <small>${locale.t("scene.provider.output", "This creates a written Scene. It does not generate images, video, or audio. Paid attempts and charges remain recorded even if validation prevents an accepted output.")}</small>
  </span></aside>`;
}
