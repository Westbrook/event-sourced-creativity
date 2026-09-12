type Row = Record<string, unknown>;
const object = (value: unknown): value is Row => Boolean(value && typeof value === "object" && !Array.isArray(value));
const exact = (value: unknown, keys: readonly string[]): value is Row => object(value) && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
const id = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(value);
const amount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
export const validHoldPreviewJobId = (value: string) => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(value);

/** Validate the entire source-free wire shape; do not silently drop unexpected private fields. */
export function validateHoldPreviewResponse(value: unknown, jobId: string, ownerId: string): value is { applyEnabled: boolean; preview: Row } {
  if (!exact(value, ["applyEnabled", "preview"]) || typeof value.applyEnabled !== "boolean") return false;
  const p = value.preview;
  if (!exact(p, ["schemaVerified", "kind", "providerOutcome", "previewSha256", "jobId", "documentId", "correlationId", "ownerId", "streamId", "tokenReservationId", "costReservationId", "period", "releaseTokens", "releaseMicrousd", "settledTokensDelta", "settledMicrousdDelta", "providerCalls", "counters", "warning"])
    || p.schemaVerified !== true || p.kind !== "administrative_hold_release" || p.providerOutcome !== "unknown"
    || p.jobId !== jobId || p.ownerId !== ownerId || p.streamId !== `creative:${ownerId}`
    || ![p.documentId, p.correlationId, p.tokenReservationId, p.costReservationId].every(id)
    || typeof p.previewSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(p.previewSha256)
    || typeof p.period !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/u.test(p.period)
    || !amount(p.releaseTokens) || !p.releaseTokens || !amount(p.releaseMicrousd) || !p.releaseMicrousd
    || p.settledTokensDelta !== 0 || p.settledMicrousdDelta !== 0 || p.providerCalls !== 0
    || p.warning !== "This releases internal capacity only. Provider usage and billed amount remain unknown. A later charge requires a separate reviewed correction."
    || !exact(p.counters, ["tokens", "dollars"])) return false;
  for (const [key, unit, release] of [["tokens", "tokens", p.releaseTokens], ["dollars", "microusd", p.releaseMicrousd]] as const) {
    const rows = p.counters[key];
    if (!Array.isArray(rows) || rows.length !== 2 || rows.some(row => !exact(row, ["scope", "scope_id", "period", `used_${unit}`, `reserved_${unit}`, `hard_limit_${unit}`, "updated_at"])
      || row.period !== p.period || ![row[`used_${unit}`], row[`reserved_${unit}`], row[`hard_limit_${unit}`]].every(amount)
      || Number(row[`reserved_${unit}`]) < release || typeof row.updated_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(row.updated_at) || !Number.isFinite(Date.parse(row.updated_at)))
      || rows.filter(row => row.scope === "user" && row.scope_id === ownerId).length !== 1
      || rows.filter(row => row.scope === "workspace" && row.scope_id === "forma").length !== 1) return false;
  }
  return true;
}

/** Only stable server error codes are displayable; HTML or arbitrary error content is never echoed. */
export function holdPreviewErrorCode(value: unknown): string | null {
  return exact(value, ["error"]) && typeof value.error === "string" && /^[a-z][a-z0-9_]{0,99}$/u.test(value.error) ? value.error : null;
}

export async function readHoldPreviewBody(response: Response): Promise<string> {
  if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new Error("hold_preview_response_invalid");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("hold_preview_response_invalid");
  const decoder = new TextDecoder(); let text = "", bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 65_536) { await reader.cancel(); throw new Error("hold_preview_response_invalid"); }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}
