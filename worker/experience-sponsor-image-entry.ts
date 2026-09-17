import { exactKeys, jsonIssues, record } from "../src/experiences/compiler.ts";
import { createSponsorImageIntakeRoute } from "./experience-sponsor-intake-route.ts";
import { confirmSponsorImageOutput, readSponsorImageConfirmation } from "./experience-sponsor-image-confirmation.ts";
import { SponsorIntakeReadLimitError } from "./experience-sponsor-intake-read-attempts.ts";
import { SponsorEntitlementError } from "./experience-sponsor-policy.ts";
import type { WorkerEnv } from "./runtime.ts";

export type SponsorImageEntryConfiguration = Readonly<{ version: 2; enabled: false }> | Readonly<{
  version: 2; enabled: true; audience: "canonical-principal"; output: "image";
  freshCampaignId: string | null; generation: "disabled";
}>;

const base = "/api/experiences/sponsor/image";
const reply = (error: string, status: number, headers: Record<string, string> = {}) => Response.json({ error }, {
  status, headers: { "cache-control": "private, no-store", ...headers },
});
const fail = (): never => { throw new SponsorEntitlementError("sponsor_image_entry_configuration_invalid"); };

/** This closed version adds deliberate native output confirmation to the
 * separately metered intake routes. It grants no generation authority and
 * installs neither schema nor policy. Missing configuration is inert. */
export function createSponsorImageEntryRoute(raw?: unknown): (request: Request, env: WorkerEnv) => Promise<Response | null> {
  if (raw === undefined) return async () => null;
  if (jsonIssues(raw).length || !record(raw) || raw.version !== 2) return fail();
  if (raw.enabled === false && exactKeys(raw, ["version", "enabled"])) return async () => null;
  if (raw.enabled !== true || !exactKeys(raw, ["version", "enabled", "audience", "output", "freshCampaignId", "generation"])
    || raw.audience !== "canonical-principal" || raw.output !== "image" || raw.generation !== "disabled"
    || raw.freshCampaignId !== null && (typeof raw.freshCampaignId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/u.test(raw.freshCampaignId)))
    return fail();
  const intake = createSponsorImageIntakeRoute({ version: 1, enabled: true, audience: "canonical-principal", output: "image", freshCampaignId: raw.freshCampaignId });
  return async (request, env) => {
    const url = new URL(request.url);
    if (url.pathname !== base && !url.pathname.startsWith(base + "/")) return null;
    const match = /^\/api\/experiences\/sponsor\/image\/drafts\/(experience-draft-[a-f0-9]{64})\/output-confirmation$/u.exec(url.pathname);
    if (!match) return intake(request, env);
    if (url.searchParams.size) return reply("sponsor_image_confirmation_request_invalid", 400);
    if (request.method !== "GET" && request.method !== "POST") return reply("sponsor_image_confirmation_method_invalid", 405, { allow: "GET, POST" });
    try {
      return request.method === "GET" ? await readSponsorImageConfirmation(request, env, match[1]!)
        : await confirmSponsorImageOutput(request, env, match[1]!);
    } catch (cause) {
      if (cause instanceof SponsorIntakeReadLimitError) return reply(cause.code, 429, {
        "retry-after": String(Math.max(1, Math.ceil(cause.retryAfterMs / 1000))),
      });
      if (!(cause instanceof SponsorEntitlementError) || !/^[a-z][a-z0-9_]{0,119}$/u.test(cause.code))
        return reply("sponsor_image_confirmation_unavailable", 500);
      const status = /(?:request_invalid|body_invalid)$/u.test(cause.code) ? 400
        : /(?:actor|authority|consent|same_origin|internal_only)/u.test(cause.code) ? 403 : 409;
      return reply(cause.code, status);
    }
  };
}
