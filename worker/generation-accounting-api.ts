import type { WorkerEnv } from "./runtime.ts";
import type { requireExistingHoldAdministrator } from "./pilot-policy.ts";
import { GenerationAccountingPreviewError, previewGenerationAccounting } from "./generation-accounting-preview.ts";

type Authorize = typeof requireExistingHoldAdministrator;
/** Dependency seam permits dedicated tests without identity/schema bootstrapping. Not request-configurable. */
export function createGenerationAccountingHandler(authorize: Authorize) {
  return async (request: Request, env: WorkerEnv) => {
    const response = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
    if (request.method !== "GET") return response({ error: "method_not_allowed" }, 405);
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].length !== 1 || !query.has("jobId") || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(query.get("jobId") ?? "")) return response({ error: "accounting_job_id_required" }, 400);
    try {
      const auth = await authorize(request, env);
      if (auth.response || !auth.user) return auth.response ?? response({ error: "authentication_required" }, 401);
      const preview = await previewGenerationAccounting(env, auth.user, query.get("jobId")!);
      const confirmed = await authorize(request, env);
      if (confirmed.response || !confirmed.user) return confirmed.response ?? response({ error: "authentication_required" }, 401);
      if (confirmed.user.userId !== auth.user.userId || confirmed.user.streamId !== auth.user.streamId
        || JSON.stringify(confirmed.user.authorizationSnapshot) !== JSON.stringify(auth.user.authorizationSnapshot)) return response({ error: "accounting_authority_changed" }, 409);
      return response({ preview });
    } catch (error) {
      if (error instanceof GenerationAccountingPreviewError) return response({ error: error.code }, error.status);
      return response({ error: "accounting_preview_unavailable" }, 503);
    }
  };
}

export async function handleGenerationAccounting(request: Request, env: WorkerEnv) {
  const { requireExistingHoldAdministrator } = await import("./pilot-policy.ts");
  return createGenerationAccountingHandler(requireExistingHoldAdministrator)(request, env);
}
