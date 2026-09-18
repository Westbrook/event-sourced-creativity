import type { WorkerEnv } from "./runtime.ts";
import { requireExistingHoldAdministrator } from "./pilot-policy.ts";
import { GenerationAccountingPreviewError } from "./generation-accounting-preview.ts";
import { HoldDispositionError } from "./budget-hold-dispositions.ts";
import { applyManagedVideoReconciliation, previewManagedVideoReconciliation, verifyManagedVideoReconciliation, VideoReconciliationError, VIDEO_TREATMENT } from "./managed-video-reconciliation.ts";

type Authorize = typeof requireExistingHoldAdministrator;
/** Fixed diagnostics only; never echo a database message, SQL or bound value. */
export function reconciliationFailureCategory(error: unknown): string[] {
  const messages: string[] = [];
  let current = error;
  for (let depth = 0; depth < 3 && current instanceof Error; depth++) {
    messages.push(current.message); current = current.cause;
  }
  const text = messages.join(" ").toLowerCase();
  return ["d1_error", "d1_type_error", "sqlite_error", "sqlite_auth", "sqlite_constraint",
    "not authorized", "no such table", "no such column", "no such function", "syntax error",
    "too many sql variables", "too many subrequests", "too many terms", "malformed json",
    "string or blob too big", "datatype mismatch", "database is locked", "interrupted"]
    .filter(value => text.includes(value));
}
/** Injected authority is a test seam, never caller-configurable. */
export function createVideoReconciliationHandler(authorize: Authorize = requireExistingHoldAdministrator) {
  return async (request: Request, env: WorkerEnv): Promise<Response> => {
    const response = (body: unknown, status = 200) => Response.json(body, { status,
      headers: { "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
    const url = new URL(request.url);
    if (!["GET", "POST"].includes(request.method)) return response({ error: "method_not_allowed" }, 405);
    if (request.method === "POST" && request.headers.get("origin") !== url.origin) return response({ error: "same_origin_required" }, 403);
    try {
      const auth = await authorize(request, env);
      if (auth.response || !auth.user) return auth.response ?? response({ error: "authentication_required" }, 401);
      const confirmedResponse = async (value: unknown) => {
        const current = await authorize(request, env);
        if (current.response || !current.user) return current.response ?? response({ error: "authentication_required" }, 401);
        if (current.user.userId !== auth.user.userId || current.user.streamId !== auth.user.streamId
          || JSON.stringify(current.user.authorizationSnapshot) !== JSON.stringify(auth.user.authorizationSnapshot))
          return response({ error: "reconciliation_authority_changed" }, 409);
        return response(value);
      };
      if (request.method === "GET") {
        if ([...url.searchParams.keys()].length !== 1) return response({ error: "reconciliation_exact_target_required" }, 400);
        if (url.searchParams.get("jobId") === VIDEO_TREATMENT.jobId)
          return confirmedResponse(await previewManagedVideoReconciliation(env, auth.user));
        if (url.searchParams.get("treatmentId") === VIDEO_TREATMENT.id)
          return confirmedResponse({ verification: await verifyManagedVideoReconciliation(env, auth.user) });
        return response({ error: "reconciliation_exact_target_required" }, 400);
      }
      if ([...url.searchParams.keys()].length) return response({ error: "reconciliation_exact_target_required" }, 400);
      if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return response({ error: "json_required" }, 415);
      const reader = request.body?.getReader();
      if (!reader) return response({ error: "body_required" }, 400);
      let length = 0, text = "";
      const decoder = new TextDecoder("utf-8", { fatal: true });
      try {
        for (;;) {
          const { done, value } = await reader.read(); if (done) break;
          length += value.byteLength;
          if (length > 4096) { await reader.cancel(); return response({ error: "body_too_large" }, 413); }
          text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode();
      } finally { reader.releaseLock(); }
      const command: unknown = JSON.parse(text);
      return confirmedResponse(await applyManagedVideoReconciliation(env, auth.user, command));
    } catch (error) {
      if (error instanceof VideoReconciliationError || error instanceof GenerationAccountingPreviewError || error instanceof HoldDispositionError) {
        console.error("video_reconciliation_refused", { method: request.method, code: error.code });
        return response({ error: error.code }, error.status);
      }
      if (error instanceof SyntaxError) return response({ error: "invalid_json" }, 400);
      // The UI must verify the stable operation before treating an ambiguous POST as failed.
      console.error("video_reconciliation_unavailable", { method: request.method,
        categories: reconciliationFailureCategory(error) });
      return response({ error: "reconciliation_unavailable_verify_original_operation" }, 503);
    }
  };
}
export const handleVideoReconciliation = createVideoReconciliationHandler();
