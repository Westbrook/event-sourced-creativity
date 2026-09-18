import { readVideoReferenceIntent } from "../src/experiences/video-reference.ts";
import { authorizeExperienceIntake, readExperienceBody } from "./experience-intake-api.ts";
import { loadOutputTrustedContext } from "./output-requirements-api.ts";
import { inspectVideoReferenceCustody } from "./video-reference-custody.ts";
import { OwnedImageReferenceError } from "./owned-image-reference-custody.ts";
import type { WorkerEnv } from "./runtime.ts";

const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: {
  "cache-control": "private, no-store", "x-content-type-options": "nosniff",
} });
const refused = (error: string, status: number) => reply({ version: 1, status: "unavailable", error, generation: "unavailable" }, status);

export async function handleExperienceVideoReference(request: Request, env: WorkerEnv): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/experiences/video/reference/inspect" || url.search || url.hash) return refused("not_found", 404);
  if (request.method !== "POST") return refused("method_not_allowed", 405);
  if (request.headers.get("origin") && request.headers.get("origin") !== url.origin || request.headers.get("sec-fetch-site") === "cross-site")
    return refused("same_origin_required", 403);
  const auth = await authorizeExperienceIntake(request, env);
  if (auth instanceof Response) return auth;
  let selection;
  try { selection = readVideoReferenceIntent(await readExperienceBody(request)); }
  catch { return refused("request_invalid", 400); }
  if (!selection) return refused("video_reference_selection_invalid", 400);
  try {
    const trusted = await loadOutputTrustedContext(request, env, selection.sourceDocumentId, "read");
    if (trusted instanceof Response) return trusted;
    const inspection = await inspectVideoReferenceCustody(trusted, auth, selection);
    return reply({ version: 1, status: "inspected", inspection, generation: "unavailable", persisted: false, transferAuthorized: false });
  } catch (error) {
    if (error instanceof OwnedImageReferenceError) return refused(error.code, 409);
    const candidate = error as { code?: unknown; status?: unknown };
    if (typeof candidate?.code === "string" && /^video_reference_[a-z_]+$/u.test(candidate.code)
      && typeof candidate.status === "number" && [400, 403, 409].includes(candidate.status)) return refused(candidate.code, candidate.status);
    if (request.signal.aborted) return refused("video_reference_read_cancelled", 409);
    return refused("video_reference_unavailable", 409);
  }
}
