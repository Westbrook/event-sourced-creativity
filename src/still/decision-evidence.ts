/** Coverage contains counts only. It never duplicates authored evidence. */
export type EvidenceRow = { id: string; fields?: Record<string, string> };
export type EvidenceSource = { total: number; rows: EvidenceRow[]; upstreamBounded?: boolean };
export type EvidenceSection = {
  available: number; included: number; omitted: number;
  status: 'complete' | 'partial' | 'unavailable' | 'upstream-bounded';
  upstreamBounded?:boolean;
  fields: Record<string, { availableCharacters: number; includedCharacters: number; truncatedItems: number; omittedItems: number }>;
};
export type DecisionEvidenceCoverage = {
  version: 1;
  meaning: string;
  sections: Record<string, EvidenceSection>;
  constraintsComplete: boolean;
  budgetExceeded: boolean;
};

export function evidenceRows<T>(values: readonly T[], id: (value: T) => string, fields: (value: T) => Record<string, string> = () => ({})): EvidenceRow[] {
  return values.map(value => ({ id: id(value), fields: fields(value) }));
}

export function evidenceSection(source: EvidenceSource, included: EvidenceRow[]): EvidenceSection {
  const original = new Map(source.rows.map(row => [row.id, row]));
  const current = new Map(included.map(row => [row.id, row]));
  const fields: EvidenceSection['fields'] = {};
  for (const row of original.values()) {
    for (const [field, text] of Object.entries(row.fields ?? {})) {
      const count = fields[field] ??= { availableCharacters: 0, includedCharacters: 0, truncatedItems: 0, omittedItems: 0 };
      const present = current.get(row.id)?.fields?.[field];
      count.availableCharacters += text.length;
      count.includedCharacters += present?.length ?? 0;
      if (present === undefined) count.omittedItems++;
      else if (present.length < text.length) count.truncatedItems++;
    }
  }
  const omitted = Math.max(0, source.total - current.size);
  const partial = omitted > 0 || Object.values(fields).some(f => f.truncatedItems > 0 || f.omittedItems > 0);
  return {
    available: source.total, included: current.size, omitted,
    status: source.total > 0 && !current.size ? 'unavailable' : partial ? 'partial' : source.upstreamBounded ? 'upstream-bounded' : 'complete',
    ...(source.upstreamBounded?{upstreamBounded:true}:{}),fields,
  };
}

export function decisionEvidenceCoverage(sources: Record<string, EvidenceSource>, included: Record<string, EvidenceRow[]>): DecisionEvidenceCoverage {
  const sections = Object.fromEntries(Object.entries(sources).map(([name, source]) => [name, evidenceSection(source, included[name] ?? [])]));
  return {
    version: 1,
    meaning: 'Counts describe authorized evidence before and after this request budget. Field lengths exclude redacted URLs. Upstream-bounded text may have been shortened before preparation. Omitted or unavailable is unknown, never zero activity or permission to disregard a constraint.',
    sections,
    constraintsComplete: sections['focus.lockedConstraints']?.status === 'complete',
    budgetExceeded: false,
  };
}
