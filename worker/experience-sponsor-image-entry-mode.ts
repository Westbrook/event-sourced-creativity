import { freeze } from "../src/experiences/compiler.ts";
import { isDraftId, isIntentId } from "../src/experiences/intake.ts";
import { createSponsorImageEntryRoute, type SponsorImageEntryConfiguration } from "./experience-sponsor-image-entry.ts";
import { readSponsorImageEntryMode } from "./experience-sponsor-intake-reads.ts";
import { SponsorIntakeReadLimitError } from "./experience-sponsor-intake-read-attempts.ts";
import { SponsorEntitlementError } from "./experience-sponsor-policy.ts";
import type { WorkerEnv } from "./runtime.ts";

export const SPONSOR_IMAGE_ENTRY_MODE_PATH = "/api/experiences/image/entry-mode";
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
const reply = (error: string, status: number, headers: Record<string, string> = {}) => Response.json({ error }, {
  status, headers: { "cache-control": "private, no-store", ...headers },
});

/** Mode describes a transport choice, never grants browser authority. The
 * ordinary fresh response is available with absent configuration and no DB.
 * Retained sponsor evidence never falls through to an ordinary transport. */
export function createSponsorImageEntryModeRoute(raw?: unknown): (request: Request, env: WorkerEnv) => Promise<Response | null> {
  // Reuse the exact current configuration grammar. Construction installs
  // nothing; this factory does not invoke the returned intake/confirmation route.
  createSponsorImageEntryRoute(raw);
  const configuration = raw === undefined ? undefined : freeze(structuredClone(raw)) as SponsorImageEntryConfiguration;
  const enabled = configuration?.enabled === true;
  const campaignId = configuration?.enabled === true ? configuration.freshCampaignId : null;
  return async (request, env) => {
    const url = new URL(request.url);
    if (url.pathname !== SPONSOR_IMAGE_ENTRY_MODE_PATH) return null;
    if (request.method !== "GET") return reply("sponsor_image_entry_mode_method_invalid", 405, { allow: "GET" });
    if (bytes(request.url) > 1024 || url.username || url.password || url.hash || request.body)
      return reply("sponsor_image_entry_mode_request_invalid", 400);
    let selector: { kind: "fresh" } | { draftId: string } | { intentId: string };
    const values = [...url.searchParams.entries()];
    if (!values.length) selector = { kind: "fresh" };
    else if (values.length === 1 && values[0]![0] === "draftId" && isDraftId(values[0]![1])) selector = { draftId: values[0]![1] };
    else if (values.length === 1 && values[0]![0] === "intentId" && isIntentId(values[0]![1])) selector = { intentId: values[0]![1] };
    else return reply("sponsor_image_entry_mode_request_invalid", 400);
    try { return await readSponsorImageEntryMode(request, env, freeze({ enabled, campaignId, selector })); }
    catch (cause) {
      if (cause instanceof SponsorIntakeReadLimitError) return reply(cause.code, 429, {
        "retry-after": String(Math.max(1, Math.ceil(cause.retryAfterMs / 1000))),
      });
      const code = cause instanceof SponsorEntitlementError && ["sponsor_intake_post_read_cancelled", "sponsor_intake_read_deadline"].includes(cause.code)
        ? cause.code : "sponsor_image_entry_mode_unavailable";
      return reply(code, 409);
    }
  };
}
