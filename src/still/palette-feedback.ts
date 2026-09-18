export type PaletteFeedback = {
  entry: 'shortcut' | 'more' | 'direct';
  surface: 'toolbar' | 'more' | 'workflow';
  toolbar: string[];
  more: string[];
};

// Client feedback is a bounded hint, never an eligibility or permission grant.
export function cleanPaletteFeedback(value: unknown, allowed: string[]): PaletteFeedback | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const v = value as Record<string, unknown>;
  if (!['shortcut', 'more', 'direct'].includes(String(v.entry)) || !['toolbar', 'more', 'workflow'].includes(String(v.surface))) return;
  const ids = (list: unknown) => Array.isArray(list) ? [...new Set(list.filter((id): id is string => typeof id === 'string' && allowed.includes(id)))].slice(0, 12) : [];
  return {entry: v.entry as PaletteFeedback['entry'], surface: v.surface as PaletteFeedback['surface'], toolbar: ids(v.toolbar), more: ids(v.more)};
}
