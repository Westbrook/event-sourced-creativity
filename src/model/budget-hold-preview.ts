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
      if (bytes > 65_536) { void reader.cancel().catch(() => {}); throw new Error("hold_preview_response_invalid"); }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}

export type HoldOperatorCommand = {
  dispositionId: string; jobId: string; previewSha256: string; approvalRef: string;
  supportRef: string; reason: string; evidenceSha256: string; acknowledgement: string;
};
export type HoldApplyResponse = { applied: boolean; replayed: boolean; dispositionId: string; recordSha256: string };

const holdCommandKeys = ["dispositionId", "jobId", "previewSha256", "approvalRef", "supportRef", "reason", "evidenceSha256", "acknowledgement"] as const;
const holdAcknowledgement = "Release internal holds; provider billing remains unknown";
const holdSha256 = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const holdControlCharacter = (value: string) => Array.from(value).some(character => {
  const code = character.charCodeAt(0);
  return code < 32 || code >= 127 && code <= 159;
});
export const validHoldDispositionId = (value: string): boolean => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/u.test(value);

/** Run only after JSON.parse succeeds. Decode names so escaped duplicate keys also fail. */
function duplicateHoldCommandKeys(text: string): boolean {
  const objects: Set<string>[] = [];
  for (let index = 0; index < text.length; index++) {
    if (text[index] === "{") objects.push(new Set());
    else if (text[index] === "}") objects.pop();
    else if (text[index] === '"') {
      const start = index++;
      while (index < text.length && text[index] !== '"') {
        if (text[index] === "\\") index++;
        index++;
      }
      let next = index + 1;
      while (/\s/u.test(text[next] ?? "") && next < text.length) next++;
      if (text[next] === ":") {
        const key = JSON.parse(text.slice(start, index + 1)) as string, keys = objects.at(-1);
        if (!keys || keys.has(key)) return true;
        keys.add(key);
      }
    }
  }
  return false;
}

/** Validate an operator-supplied command without rewriting the exact text later sent to the server. */
export function parsedHoldOperatorCommand(text: string): { action: "apply"; command: HoldOperatorCommand } | null {
  if (typeof text !== "string" || text.length > 8192 || new TextEncoder().encode(text).byteLength > 8192) return null;
  try {
    const body: unknown = JSON.parse(text);
    if (!exact(body, ["action", "command"]) || body.action !== "apply" || !exact(body.command, holdCommandKeys)) return null;
    const command = body.command;
    if (typeof command.dispositionId !== "string" || !validHoldDispositionId(command.dispositionId)
      || typeof command.jobId !== "string" || !validHoldPreviewJobId(command.jobId)
      || !holdSha256(command.previewSha256) || !holdSha256(command.evidenceSha256)
      || ![command.approvalRef, command.supportRef, command.reason].every(value => typeof value === "string"
        && value.trim().length >= 5 && value.length <= 500 && !holdControlCharacter(value))
      || command.acknowledgement !== holdAcknowledgement || duplicateHoldCommandKeys(text)) return null;
    return body as { action: "apply"; command: HoldOperatorCommand };
  } catch { return null; }
}

export function validateHoldApplyResponse(value: unknown, dispositionId: string): value is HoldApplyResponse {
  return validHoldDispositionId(dispositionId) && exact(value, ["applied", "replayed", "dispositionId", "recordSha256"])
    && typeof value.applied === "boolean" && typeof value.replayed === "boolean" && value.applied !== value.replayed
    && value.dispositionId === dispositionId && holdSha256(value.recordSha256);
}

const holdVerificationChecks = ["recordDigest", "commandDigest", "identity", "unknownPreserved", "amounts", "reservationTransition", "counterDelta",
  "immutableSchema", "liveJobBinding", "reservationsPersisted", "providerEvidenceUnchanged", "auditEvent", "noAdditionalAttemptUsage",
  "currentReservedProjection", "settledCountersUnchanged"] as const;
type HoldVerificationCheck = typeof holdVerificationChecks[number];
const holdTransactionChecks: readonly HoldVerificationCheck[] = ["recordDigest", "commandDigest", "identity", "unknownPreserved", "amounts",
  "reservationTransition", "counterDelta", "reservationsPersisted", "auditEvent", "immutableSchema"];
const holdVerificationNote = "The recorded adjustment is checked separately from current state. Any changed settled counter requires review, including legitimate later usage; this pass does not attribute that change or infer historical provider charges.";
type HoldCounterScope = { scope: "user" | "workspace"; scope_id: string; period: string; updated_at: string; ledger_reserved: number };
export type HoldVerificationResponse = {
  dispositionId: string; recordSha256: string; checkedAt: string; transactionVerified: boolean; verified: boolean;
  checks: Record<HoldVerificationCheck, boolean>; providerOutcome: "unknown"; providerBillingVerified: false;
  currentCounters: {
    tokens: (HoldCounterScope & { used_tokens: number; reserved_tokens: number; hard_limit_tokens: number })[];
    dollars: (HoldCounterScope & { used_microusd: number; reserved_microusd: number; hard_limit_microusd: number })[];
  };
  requiresReview: HoldVerificationCheck[]; note: string;
};

function holdTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/u.exec(value);
  if (!match) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === `${match[1]}.${(match[2] ?? "").padEnd(3, "0")}Z`;
}

/** Keep the entire source-free response, including valid failed-check diagnostics; never strip unknown fields. */
export function validateHoldVerificationResponse(value: unknown, dispositionId: string, ownerId: string,
  expectedRecordSha256?: string): value is HoldVerificationResponse {
  if (!validHoldDispositionId(dispositionId)
    || !exact(value, ["dispositionId", "recordSha256", "checkedAt", "transactionVerified", "verified", "checks", "providerOutcome", "providerBillingVerified", "currentCounters", "requiresReview", "note"])
    || value.dispositionId !== dispositionId || !holdSha256(value.recordSha256)
    || expectedRecordSha256 !== undefined && (!holdSha256(expectedRecordSha256) || value.recordSha256 !== expectedRecordSha256)
    || !holdTimestamp(value.checkedAt) || value.providerOutcome !== "unknown" || value.providerBillingVerified !== false
    || value.note !== holdVerificationNote || !exact(value.checks, holdVerificationChecks)
    || !exact(value.currentCounters, ["tokens", "dollars"]) || !Array.isArray(value.requiresReview)) return false;
  const checks = value.checks;
  if (!holdVerificationChecks.every(key => typeof checks[key] === "boolean")
    || value.verified !== holdVerificationChecks.every(key => checks[key])
    || value.transactionVerified !== holdTransactionChecks.every(key => checks[key])) return false;
  const failed = holdVerificationChecks.filter(key => !checks[key]);
  if (value.requiresReview.length !== failed.length || new Set(value.requiresReview).size !== failed.length
    || !value.requiresReview.every(key => failed.some(check => check === key))) return false;

  let period: string | undefined, reservedProjection = true;
  for (const [key, unit] of [["tokens", "tokens"], ["dollars", "microusd"]] as const) {
    const rows = value.currentCounters[key];
    if (!Array.isArray(rows) || rows.length !== 2) return false;
    for (const row of rows) {
      if (!exact(row, ["scope", "scope_id", "period", `used_${unit}`, `reserved_${unit}`, `hard_limit_${unit}`, "updated_at", "ledger_reserved"])
        || typeof row.period !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/u.test(row.period)
        || ![row[`used_${unit}`], row[`reserved_${unit}`], row[`hard_limit_${unit}`], row.ledger_reserved].every(amount)
        || !holdTimestamp(row.updated_at)) return false;
      period ??= row.period;
      if (row.period !== period) return false;
      reservedProjection &&= row.ledger_reserved === row[`reserved_${unit}`];
    }
    if (rows.filter(row => row.scope === "user" && row.scope_id === ownerId).length !== 1
      || rows.filter(row => row.scope === "workspace" && row.scope_id === "forma").length !== 1) return false;
  }
  return checks.currentReservedProjection === reservedProjection;
}
