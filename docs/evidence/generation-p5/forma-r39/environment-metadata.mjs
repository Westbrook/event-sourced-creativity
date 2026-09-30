/**
 * Offline-reviewed projection, not a transport or authorization mechanism.
 * The ordinary connector/runtime receives the response, possibly including values.
 * Only this function's returned projection may be displayed or persisted.
 * Never print/store the input or caught errors. No network, tool, or file access.
 * R38's exact rejected input shape was not retained; this is not a root-cause claim.
 */
export const CONTROL_KEYS = Object.freeze([
  'FORMA_GENERATION_STUDY_APPROVAL_ENABLED',
  'FORMA_GENERATION_STUDY_ENABLED',
  'FORMA_GENERATION_CUSTODY_PROBE_ENABLED',
  'FORMA_GENERATION_STUDY_HOLD_READ_ENABLED',
]);

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const record = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
const kind = (o) => o === null ? 'null' : Array.isArray(o) ? 'array' :
  ['string', 'number', 'boolean', 'undefined'].includes(typeof o) ? typeof o :
    typeof o === 'object' ? 'object' : 'other';
const anchors = ['project_id', 'revision', 'updated_at', 'entries'];
const looksLikePayload = (p) => record(p) && anchors.some((k) => own(p, k));
const dateShape = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const maxText = 1_048_576;

// Every field/path/reason here is a code constant; never insert an input key/value.
function failure(reason, path, actual) {
  return { ok: false, reason, diagnostic: { path, type: kind(actual) } };
}

function validatePayload(p, expectedProjectId) {
  if (!record(p)) return failure('payload_not_object', 'payload', p);
  if (!own(p, 'project_id')) return failure('project_missing', 'payload.project_id', undefined);
  if (typeof p.project_id !== 'string') return failure('project_type', 'payload.project_id', p.project_id);
  if (p.project_id !== expectedProjectId) return failure('project_mismatch', 'payload.project_id', p.project_id);
  if (!own(p, 'revision')) return failure('revision_missing', 'payload.revision', undefined);
  if (!Number.isSafeInteger(p.revision) || p.revision < 0) return failure('revision_invalid', 'payload.revision', p.revision);
  if (!own(p, 'updated_at')) return failure('updated_at_missing', 'payload.updated_at', undefined);
  if (!(p.updated_at === null || (typeof p.updated_at === 'string' && dateShape.test(p.updated_at) && Number.isFinite(Date.parse(p.updated_at))))) {
    return failure('updated_at_invalid', 'payload.updated_at', p.updated_at);
  }
  if (!Array.isArray(p.entries)) return failure('entries_not_array', 'payload.entries', p.entries);
  if (p.entries.length > 1000) return failure('entries_limit', 'payload.entries', p.entries);
  const seen = new Set();
  for (const e of p.entries) {
    if (!record(e)) return failure('entry_not_object', 'payload.entries[*]', e);
    if (typeof e.key !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(e.key)) return failure('entry_key_invalid', 'payload.entries[*].key', e.key);
    if (seen.has(e.key)) return failure('entry_key_duplicate', 'payload.entries[*].key', e.key);
    seen.add(e.key);
    if (!own(e, 'value')) return failure('entry_value_missing', 'payload.entries[*].value', undefined);
    if (!(e.value === null || typeof e.value === 'string')) return failure('entry_value_type', 'payload.entries[*].value', e.value);
    if (typeof e.value === 'string' && e.value.length > maxText) return failure('entry_value_limit', 'payload.entries[*].value', e.value);
    if (own(e, 'is_secret') && e.is_secret !== null && typeof e.is_secret !== 'boolean') return failure('entry_secret_classification_type', 'payload.entries[*].is_secret', e.is_secret);
    if (own(e, 'type') && e.type !== null && e.type !== 'envvar') return failure('entry_type_invalid', 'payload.entries[*].type', e.type);
  }
  return null;
}

// Compare only validated environment fields, including undisplayed values. Auxiliary
// instructions/narration are not data candidates and never enter the projection.
const signature = (p) => JSON.stringify([
  p.project_id, p.revision, p.updated_at,
  // Null and absent optional metadata carry the same unknown fact. They never
  // establish a nonsecret value or enable interpretation of a control value.
  p.entries.map((e) => [e.key, e.value, e.type ?? null, e.is_secret ?? null])
    .sort((a, b) => a[0].localeCompare(b[0])),
]);

export function projectEnvironmentMetadata(input, expectedProjectId) {
  try {
    if (typeof expectedProjectId !== 'string' || !/^appgprj_[A-Za-z0-9]{1,96}$/.test(expectedProjectId)) {
      return failure('invalid_expected_project', 'expectedProjectId', expectedProjectId);
    }
    let root = input;
    let serialized = false;
    if (typeof root === 'string') {
      serialized = true;
      if (root.length > maxText) return failure('serialized_input_limit', 'response', root);
      try { root = JSON.parse(root); } catch { return failure('serialized_input_invalid_json', 'response', root); }
    }
    if (!record(root)) return failure('response_not_object', 'response', root);
    if (root.isError === true) return failure('tool_error', 'response.isError', root.isError);
    if (own(root, 'isError') && root.isError !== false) return failure('error_flag_type', 'response.isError', root.isError);
    const hasStructured = own(root, 'structuredContent') && root.structuredContent !== null;
    const hasContent = own(root, 'content') && root.content !== null;
    const direct = looksLikePayload(root);
    if (direct && (hasStructured || hasContent)) return failure('mixed_direct_and_envelope', 'response', root);
    const candidates = [];
    let representation;
    if (direct) {
      candidates.push(root);
      representation = serialized ? 'serialized-direct' : 'direct';
    } else {
      representation = serialized ? 'serialized-mcp' : 'mcp';
      if (!hasStructured && !hasContent) return failure(
        own(root, 'structuredContent') || own(root, 'content') ? 'payload_missing' : 'unsupported_envelope', 'response', root);
      if (hasStructured) {
        const invalid = validatePayload(root.structuredContent, expectedProjectId);
        if (invalid) return invalid;
        candidates.push(root.structuredContent);
      }
      if (hasContent) {
        if (!Array.isArray(root.content)) return failure('content_not_array', 'response.content', root.content);
        if (root.content.length > 32) return failure('content_limit', 'response.content', root.content);
        let total = 0;
        for (const part of root.content) {
          if (!record(part)) return failure('content_part_not_object', 'response.content[*]', part);
          if (part.type !== 'text') {
            if (hasStructured && ['image', 'audio', 'resource', 'resource_link'].includes(part.type)) continue;
            return failure('content_part_type_unsupported', 'response.content[*].type', part.type);
          }
          if (typeof part.text !== 'string') return failure('content_text_type', 'response.content[*].text', part.text);
          total += part.text.length;
          if (part.text.length > maxText || total > 2 * maxText) return failure('content_text_limit', 'response.content[*].text', part.text);
          let parsed;
          try { parsed = JSON.parse(part.text); } catch {
            // Structured data is authoritative over display-only prose. Without
            // structured data this cannot establish a usable environment response.
            if (hasStructured) continue;
            return failure('content_text_invalid_json', 'response.content[*].text', part.text);
          }
          if (!looksLikePayload(parsed)) {
            if (hasStructured) continue;
            return failure('content_json_not_payload', 'response.content[*].text', parsed);
          }
          candidates.push(parsed);
        }
      }
    }
    if (!candidates.length) return failure('payload_missing', 'response', root);
    for (const p of candidates) {
      const invalid = validatePayload(p, expectedProjectId);
      if (invalid) return invalid;
    }
    const p = candidates[0];
    const first = signature(p);
    if (candidates.some((candidate) => signature(candidate) !== first)) return failure('conflicting_data_candidates', 'payload', p);
    const entries = p.entries.map((e) => ({
      key: e.key, type: e.type ?? null,
      is_secret: own(e, 'is_secret') ? e.is_secret : null,
      valuePresent: e.value !== null,
    }));
    const controls = CONTROL_KEYS.map((key) => {
      const e = p.entries.find((item) => item.key === key);
      const enabled = !e ? false : e.is_secret === false && e.value !== null ? e.value === '1' : null;
      return { key, present: Boolean(e), enabled, state: enabled === null ? 'unknown' : enabled ? 'on' : 'off' };
    });
    return {
      ok: true, representation, project_id: expectedProjectId, revision: p.revision, updated_at: p.updated_at,
      entries, controls, sensitiveValueReturned: p.entries.some((e) => e.is_secret !== false && e.value !== null),
      bindingMetadata: 'not-provided-by-this-contract',
    };
  } catch {
    // Never expose caught exception text, stack, dynamic keys, values, or input.
    return { ok: false, reason: 'projection_exception', diagnostic: { path: 'response', type: 'unknown' } };
  }
}
