/** Display fallbacks are grounded excerpts, never silent edits to saved names. */
export function genericIdeaName(name: string, type = ''): boolean {
  const parts = name.toLowerCase().trim().split('/');
  return parts.every(part => !part || /^(subject|style|environment|action|reference|context|idea|something|untitled|detail|quality|new idea)([ _-]\d+)?$/.test(part) || part === type.toLowerCase());
}
export function ideaExcerpt(text: string, limit = 240): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (compact.length <= limit) return compact;
  return compact.slice(0, limit - 1).replace(/\s+\S*$/, '') + '…';
}
export function descriptiveIdeaName(name: string, text: string, type = ''): string {
  const clean = name.replace(/\s+/g, ' ').trim();
  return clean && !genericIdeaName(clean, type) ? clean.slice(0, 160) : ideaExcerpt(text, 100) || clean || 'Unnamed idea';
}
