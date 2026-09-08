import type { WorkerEnv } from "./runtime.ts";
import { requireExistingHoldAdministrator } from "./pilot-policy.ts";
import { applyHoldDisposition, HoldDispositionError, previewHoldDisposition, validateHoldCommand } from "./budget-hold-dispositions.ts";
import { verifyHoldDisposition } from "./budget-hold-verification.ts";

export async function handleHoldDispositions(request: Request, env: WorkerEnv) {
  const url = new URL(request.url), headers = { "cache-control": "private, no-store" };
  const response = (body: unknown, status = 200) => Response.json(body, { status, headers });
  if (!["GET", "POST"].includes(request.method)) return response({ error: "method_not_allowed" }, 405);
  if (request.method === "POST" && request.headers.get("origin") !== url.origin) return response({ error: "same_origin_required" }, 403);
  try {
    // This path never bootstraps identity/schema or repairs ledgers, including GET verification.
    const auth = await requireExistingHoldAdministrator(request, env);
    if (auth.response || !auth.user) return auth.response!;
    const confirmedResponse = async (value: unknown) => {
      const confirmed = await requireExistingHoldAdministrator(request, env);
      return confirmed.response ?? response(value);
    };
    if (request.method === "GET") {
      const id = url.searchParams.get("dispositionId");
      if (!id || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(id)) return response({ error: "hold_disposition_id_required" }, 400);
      return confirmedResponse(await verifyHoldDisposition(env, auth.user.userId, id));
    }
    if (!request.headers.get("content-type")?.startsWith("application/json")) return response({ error: "json_required" }, 415);
    // Bound the stream before JSON parsing, even when Content-Length is absent or false.
    const reader = request.body?.getReader(); let text = "", length = 0;
    if (!reader) return response({ error: "body_required" }, 400);
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > 8192) { await reader.cancel(); return response({ error: "body_too_large" }, 413); }
      text += decoder.decode(value, { stream: true });
    }
    const body = JSON.parse(text + decoder.decode()) as Record<string, unknown>;
    if (body?.action === "preview" && Object.keys(body).sort().join(",") === "action,jobId" && typeof body.jobId === "string" && body.jobId.length <= 100)
      return confirmedResponse({ applyEnabled: env.FORMA_HOLD_DISPOSITION_ENABLED === "true", preview: await previewHoldDisposition(env, auth.user, body.jobId) });
    if (body?.action === "apply" && Object.keys(body).sort().join(",") === "action,command")
      return response(await applyHoldDisposition(env, auth.user, validateHoldCommand(body.command)));
    return response({ error: "hold_explicit_action_required" }, 400);
  } catch (error) {
    if (error instanceof HoldDispositionError) return response({ error: error.code }, error.status);
    if (error instanceof SyntaxError) return response({ error: "invalid_json_or_receipt" }, 400);
    return response({ error: "hold_administration_unavailable" }, 503);
  }
}
