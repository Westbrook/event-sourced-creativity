/** Presentation only. A refusal never authorizes a retry or proves zero cost. */
export function outputCommandRefusal(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.status !== 'unavailable' || row.originalIntent !== 'unknown_or_retained'
    || typeof row.error !== 'string' || !/^[a-z][a-z0-9_]{0,95}$/u.test(row.error)) return null;
  // These are locally generated transport/decoder outcomes, not a confirmed
  // server refusal. Keep their uncertainty visible.
  if (['not_loaded','submission_unconfirmed','original_unavailable','withdrawn'].includes(row.error)) return null;
  return { code: row.error };
}
