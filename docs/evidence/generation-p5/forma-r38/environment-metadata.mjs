/**
 * Local output projection only: makes no tool/network call and changes no environment.
 * The connector/runtime may receive the ordinary response, including values.
 * This does not promise anything about provider/connector logging or retention.
 * Only the returned object may be printed/persisted; never echo the input or errors.
 *
 * Control semantics verified in R36 worker/generation-study-api.ts:42,
 * generation-study-custody-probe.ts:16 and generation-study-hold-read.ts:21:
 * each control is on exactly when the runtime string equals '1'.
 * null returned values cannot establish the underlying runtime string.
 */
export const CONTROL_KEYS = Object.freeze([
  'FORMA_GENERATION_STUDY_APPROVAL_ENABLED',
  'FORMA_GENERATION_STUDY_ENABLED',
  'FORMA_GENERATION_CUSTODY_PROBE_ENABLED',
  'FORMA_GENERATION_STUDY_HOLD_READ_ENABLED',
]);

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const record = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
const failure = (reason) => ({ ok: false, reason });
const dateShape = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

// Bounded comparison rejects conflicting structured/text representations.
function canonical(value, depth = 0) {
  if (depth > 12) throw new Error();
  if (value === null || ['string', 'boolean', 'number'].includes(typeof value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((v) => canonical(v, depth + 1)).join(',')}]`;
  if (!record(value)) throw new Error();
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k], depth + 1)}`).join(',')}}`;
}

export function projectEnvironmentMetadata(result, expectedProjectId) {
  try {
    if (typeof expectedProjectId !== 'string' || !/^appgprj_[A-Za-z0-9]{1,96}$/.test(expectedProjectId)) {
      return failure('invalid_expected_project');
    }
    if (!record(result)) return failure('malformed_response');
    if (result.isError === true) return failure('tool_error');
    if (own(result, 'isError') && result.isError !== false) return failure('malformed_response');
    const payloads = [];
    if (own(result, 'structuredContent')) payloads.push(result.structuredContent);
    if (own(result, 'content')) {
      if (!Array.isArray(result.content) || result.content.length > 2) return failure('malformed_response');
      for (const part of result.content) {
        if (!record(part) || part.type !== 'text' || typeof part.text !== 'string' || part.text.length > 1_048_576) {
          return failure('malformed_response');
        }
        // No raw text, resource, instruction, error or parse exception is returned.
        payloads.push(JSON.parse(part.text));
      }
    }
    if (!payloads.length || payloads.some((p) => !record(p))) return failure('malformed_response');
    const p = payloads[0];
    const representation = canonical(p);
    if (payloads.some((other) => canonical(other) !== representation)) return failure('ambiguous_response');
    if (p.project_id !== expectedProjectId) return failure('project_mismatch');
    if (!Number.isSafeInteger(p.revision) || p.revision < 0 || !own(p, 'updated_at') ||
        !(p.updated_at === null || (typeof p.updated_at === 'string' && dateShape.test(p.updated_at) && Number.isFinite(Date.parse(p.updated_at)))) ||
        !Array.isArray(p.entries) || p.entries.length > 1_000) return failure('malformed_response');
    const seen = new Set();
    for (const e of p.entries) {
      if (!record(e) || typeof e.key !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(e.key) || seen.has(e.key) ||
          !own(e, 'value') || !(e.value === null || typeof e.value === 'string') ||
          (own(e, 'is_secret') && typeof e.is_secret !== 'boolean') ||
          (own(e, 'type') && e.type !== 'envvar')) return failure('malformed_response');
      seen.add(e.key);
    }
    const entries = p.entries.map((e) => ({
      key: e.key, type: e.type ?? null, is_secret: own(e, 'is_secret') ? e.is_secret : null,
      // Returned-value presence; null does not mean an absent/unconfigured secret.
      valuePresent: e.value !== null,
    }));
    const controls = CONTROL_KEYS.map((key) => {
      const e = p.entries.find((item) => item.key === key);
      const enabled = !e ? false : e.is_secret === false && e.value !== null ? e.value === '1' : null;
      return { key, present: Boolean(e), enabled, state: enabled === null ? 'unknown' : enabled ? 'on' : 'off' };
    });
    return {
      ok: true, project_id: expectedProjectId, revision: p.revision, updated_at: p.updated_at,
      entries, controls,
      sensitiveValueReturned: p.entries.some((e) => e.is_secret !== false && e.value !== null),
      // The current environment getter has no binding response contract.
      bindingMetadata: 'not-provided-by-this-contract',
    };
  } catch {
    return failure('malformed_response');
  }
}
