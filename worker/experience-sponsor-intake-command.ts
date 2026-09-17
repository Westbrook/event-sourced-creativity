import { canonicalJson, freeze, jsonIssues, record } from "../src/experiences/compiler.ts";
import { readExperienceBody } from "./experience-intake-body.ts";
import { SponsorEntitlementError } from "./experience-sponsor-policy.ts";

const fail = (code: string): never => { throw new SponsorEntitlementError(code); };

async function commandFrom(request: Request) {
  if (request.method !== "POST") return fail("sponsor_intake_post_required");
  const url = new URL(request.url), origin = request.headers.get("origin");
  if (origin && origin !== url.origin || request.headers.get("sec-fetch-site") === "cross-site") return fail("sponsor_intake_same_origin_required");
  // A command cannot hold the parser open before its policy-backed read lease.
  // This server-owned transport deadline grants no resource or payer allowance.
  const controller = new AbortController(), cancelled = () => controller.abort();
  if (request.signal.aborted) cancelled();
  else request.signal.addEventListener("abort", cancelled, { once: true });
  const deadline = setTimeout(cancelled, 5_000);
  let body: unknown;
  try { body = await readExperienceBody(request, controller.signal); }
  catch { return fail(controller.signal.aborted
    ? request.signal.aborted ? "sponsor_intake_request_cancelled" : "sponsor_intake_request_timeout"
    : "sponsor_intake_request_invalid"); }
  finally { clearTimeout(deadline); request.signal.removeEventListener("abort", cancelled); }
  if (jsonIssues(body).length || !record(body)) return fail("sponsor_intake_request_invalid");
  return freeze(JSON.parse(canonicalJson(body)) as Record<string, unknown>);
}

export { commandFrom as readSponsorIntakeCommand };
