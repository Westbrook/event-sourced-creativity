import { exactKeys, jsonIssues, record } from "../src/experiences/compiler.ts";
import { isDraftId, isIntentId } from "../src/experiences/intake.ts";
import { prepareSponsorImageDraft, commitSponsorImageDraft } from "./experience-sponsor-intake.ts";
import { createSponsorIntakePostReadAllowance, requireSponsorIntakePostReadAllowance, finishSponsorIntakePostRead,
  readSponsorImageIntake } from "./experience-sponsor-intake-reads.ts";
import { SponsorIntakeReadLimitError } from "./experience-sponsor-intake-read-attempts.ts";
import { SponsorEntitlementError } from "./experience-sponsor-policy.ts";
import type { WorkerEnv } from "./runtime.ts";

const base = "/api/experiences/sponsor/image";
const fail = (code: string): never => { throw new SponsorEntitlementError(code); };
const campaignId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/u.test(value);
const reply = (error: string, status: number, headers: Record<string, string> = {}) => Response.json({ error }, {
  status, headers: { "cache-control": "private, no-store", ...headers },
});
const checkSignal = (request: Request) => { if (request.signal.aborted) fail("sponsor_intake_route_cancelled"); };

function capturedConfiguration(config: unknown): { freshCampaignId: string | null } | null {
  if (config === undefined) return null;
  if (jsonIssues(config).length || !record(config) || config.version !== 1) return fail("sponsor_intake_route_config_invalid");
  if (config.enabled === false && exactKeys(config, ["version", "enabled"])) return null;
  if (config.enabled !== true || !exactKeys(config, ["version", "enabled", "audience", "output", "freshCampaignId"])
    || config.audience !== "canonical-principal" || config.output !== "image"
    || config.freshCampaignId !== null && !campaignId(config.freshCampaignId)) return fail("sponsor_intake_route_config_invalid");
  return Object.freeze({ freshCampaignId: config.freshCampaignId });
}

function alias(url: URL, allowDraft: boolean) {
  if (url.searchParams.size !== 1) return fail("sponsor_intake_route_request_invalid");
  const intentId = url.searchParams.get("intentId"), draftId = url.searchParams.get("draftId");
  if (intentId !== null && isIntentId(intentId)) return { intentId };
  if (allowDraft && draftId !== null && isDraftId(draftId)) return { draftId };
  return fail("sponsor_intake_route_request_invalid");
}

function refused(cause: unknown): Response {
  if (cause instanceof SponsorIntakeReadLimitError) return reply(cause.code, 429, {
    "retry-after": String(Math.max(1, Math.ceil(cause.retryAfterMs / 1000))),
  });
  if (!(cause instanceof SponsorEntitlementError) || !/^[a-z][a-z0-9_]{0,119}$/u.test(cause.code))
    return reply("sponsor_intake_route_unavailable", 500);
  const status = /(?:request_invalid|body_invalid|path_mismatch)$/u.test(cause.code) ? 400
    : /(?:actor|authority|consent|same_origin|internal_only)/u.test(cause.code) ? 403 : 409;
  return reply(cause.code, status);
}

/** Dormant HTTP composition. Only a trusted host may capture this closed
 * configuration; this module registers no route, schema or launch default.
 * Retained aliases resolve their original campaign inside the read authority. */
export function createSponsorImageIntakeRoute(config?: unknown): (request: Request, env: WorkerEnv) => Promise<Response | null> {
  const selected = capturedConfiguration(config);
  if (!selected) return async () => null;
  return async (request, env) => {
    const url = new URL(request.url), path = url.pathname;
    if (path !== base && !path.startsWith(base + "/")) return null;
    try {
      checkSignal(request);
      const bootstrap = path === base + "/bootstrap", collection = path === base + "/drafts";
      const match = path.match(/^\/api\/experiences\/sponsor\/image\/drafts\/(experience-draft-[a-f0-9]{64})(?:\/(receipt|commit))?$/u);
      if (!bootstrap && !collection && !match) return reply("sponsor_intake_route_request_invalid", 400);
      const allowed = bootstrap || match && match[2] !== "commit" ? "GET" : collection ? "GET, POST" : "POST";
      if (!allowed.split(", ").includes(request.method)) return reply("sponsor_intake_route_method_invalid", 405, { allow: allowed });
      if (request.method === "GET") {
        let selector;
        if (bootstrap) {
          if (url.searchParams.size) selector = { operation: "image-intake-bootstrap" as const, ...alias(url, true) };
          else {
            if (selected.freshCampaignId === null) return reply("sponsor_intake_route_fresh_unavailable", 409);
            selector = { operation: "image-intake-bootstrap" as const, campaignId: selected.freshCampaignId };
          }
        } else if (collection) selector = { operation: "image-intake-draft" as const, ...alias(url, false) };
        else {
          if (url.searchParams.size) return reply("sponsor_intake_route_request_invalid", 400);
          selector = { operation: match![2] === "receipt" ? "image-intake-receipt" as const : "image-intake-draft" as const, draftId: match![1] };
        }
        const response = await readSponsorImageIntake(request, env, selector);
        checkSignal(request); return response;
      }
      if (url.searchParams.size) return reply("sponsor_intake_route_request_invalid", 400);
      const allowance = await createSponsorIntakePostReadAllowance(request, env, selected.freshCampaignId);
      checkSignal(request);
      const action = collection ? "prepare-sponsored-image-draft" : "commit-sponsored-image-draft";
      const captured = requireSponsorIntakePostReadAllowance(allowance, request, env, action);
      if (!collection && captured.draftId !== match![1]) return reply("sponsor_intake_route_path_mismatch", 400);
      const result = collection ? await prepareSponsorImageDraft(request, env, allowance) : await commitSponsorImageDraft(request, env, allowance);
      checkSignal(request);
      const response = await finishSponsorIntakePostRead(allowance, request, env, result);
      checkSignal(request); return response;
    } catch (cause) { return refused(cause); }
  };
}
