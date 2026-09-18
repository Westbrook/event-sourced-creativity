import type { ImageReference } from "./openai-adapter.ts";
import { ProviderRequestError } from "./provider-errors.ts";

/** An in-process, single-delivery capability. JSON/ordinary readiness consent cannot create it. */
export type ImageSafetyAcknowledgement = { readonly acknowledged: true };
const approvals = new WeakMap<ImageSafetyAcknowledgement, { prompt: string; digest: string }>();

export function authorizeImageSafetyDelivery(prompt: string, digest: string): ImageSafetyAcknowledgement {
  if (!prompt.trim() || !/^[a-f0-9]{64}$/.test(digest)) throw new Error("safety_acknowledgement_unavailable");
  const approval = Object.freeze({ acknowledged: true as const });
  approvals.set(approval, { prompt, digest });
  return approval;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)]));
  return value;
}
async function sha256(bytes: Uint8Array) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer)), byte => byte.toString(16).padStart(2, "0")).join("");
}
export async function imageSafetyInputDigest(snapshot: Record<string, unknown>, settings: Record<string, unknown>, references: ImageReference[]) {
  const pixels = await Promise.all(references.map(async reference => ({ mimeType: reference.mimeType, sha256: await sha256(reference.bytes) })));
  return sha256(new TextEncoder().encode(JSON.stringify(canonical({ snapshot, settings, pixels }))));
}

/** Consume only for the unchanged inputs that raised the warning, using the retained exact prompt. */
export function consumeImageSafetyDelivery(approval: ImageSafetyAcknowledgement | undefined, digest: string): string | null {
  if (!approval) return null;
  const saved = approvals.get(approval);
  approvals.delete(approval);
  if (!saved || saved.digest !== digest) throw new ProviderRequestError({ code: "safety_acknowledgement_stale", category: "safety", scope: "request", action: "edit_request", message: "The generation inputs changed. Review a new request before acknowledging its risks.", retryable: false, retryAfterMs: null, requestId: null, httpStatus: 409 });
  return saved.prompt;
}
