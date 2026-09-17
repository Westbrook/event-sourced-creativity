/** Tab-local recovery metadata. Contains identifiers and hashes, never creative text or credentials. */
export type WriteReceipt = { type: string; keys: string[]; digest: string };
export type WriteJournal = { correlationId: string; receipts: WriteReceipt[]; signature: string };
export type GenerationJournal = { documentId: string; format: string; requestKey: string };
const memory = new Map<string,string>();
function read(key: string) { try { return typeof sessionStorage === 'undefined' ? memory.get(key) : sessionStorage.getItem(key); } catch { return memory.get(key); } }
function write(key: string, value: unknown) {
  const encoded = JSON.stringify(value);
  if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(key, encoded); // Fail before a write if durable tab recovery is unavailable.
  memory.set(key, encoded);
}
function remove(key: string) { if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(key); memory.delete(key); }
function load<T>(key: string): T | null { const raw = read(key); if (!raw) return null; try { return JSON.parse(raw) as T; } catch { throw new Error('A pending operation could not be read. Reopen the original workspace to reconcile it.'); } }
export const operationJournal = {
  write: (scope: string) => load<WriteJournal>(`still:write:${scope}`),
  saveWrite: (scope: string, value: WriteJournal) => write(`still:write:${scope}`,value),
  clearWrite: (scope: string) => remove(`still:write:${scope}`),
  generation: (scope: string, document: string) => load<GenerationJournal>(`still:generation:${scope}:${document}`),
  saveGeneration: (scope: string, value: GenerationJournal) => write(`still:generation:${scope}:${value.documentId}`,value),
  clearGeneration: (scope: string, document: string) => remove(`still:generation:${scope}:${document}`),
};
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([,v]) => v !== undefined).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export async function digest(value: unknown) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value)))), n => n.toString(16).padStart(2,'0')).join(''); }
