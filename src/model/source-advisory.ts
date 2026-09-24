/** Existing wire construction uses JS string lengths, not UTF-8 bytes.
 * Snapshot and isolated facts are separate, positionally paired inputs. */
export type SourceAdvisoryInput = {
  index: number;
  kind: 'snapshot' | 'fact';
  sourceIndex: number | null;
  blockId: string | null;
  truncated: boolean;
};
export type SourceAdvisoryVerdict = SourceAdvisoryInput & {
  flagged: boolean;
  categories: string[];
  scores: Record<string, number> | null;
};

export function sourceAdvisoryInputs(snapshot: Record<string, unknown>) {
  const full = JSON.stringify(snapshot);
  const facts = Array.isArray(snapshot.facts) ? snapshot.facts : [];
  const mapped = facts.map((fact, sourceIndex) => {
    if (!fact || typeof fact !== 'object') return null;
    const record = fact as Record<string, unknown>;
    const properties = record.properties && typeof record.properties === 'object' ? record.properties as Record<string, unknown> : {};
    const text = [record.type, record.role, record.intent, record.effect, record.handle, properties.text, properties.instruction, properties.value, properties.label, properties.description].filter(Boolean).join(' · ');
    return text ? { text, sourceIndex, blockId: String(record.block_id ?? '') || null } : null;
  }).filter((value): value is NonNullable<typeof value> => value !== null).slice(0, 24);
  const input = [full.slice(0, 28000), ...mapped.map(value => value.text.slice(0, 6000))];
  const mapping: SourceAdvisoryInput[] = [
    { index: 0, kind: 'snapshot', sourceIndex: null, blockId: null, truncated: full.length > 28000 },
    ...mapped.map((value, i) => ({ index: i + 1, kind: 'fact' as const, sourceIndex: value.sourceIndex, blockId: value.blockId, truncated: value.text.length > 6000 })),
  ];
  return { input, mapping };
}
