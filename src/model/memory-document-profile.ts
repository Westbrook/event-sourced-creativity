export const DOCUMENT_PROFILE_POLICY = "document-profile-v1";
export const NATIVE_DOCUMENT_PALETTE_CHOICE_RECIPE = "native-document-palette-choice-v1";
export const MEMORY_DOCUMENT_PROFILE_MAX_BYTES = 65_536;
export const MEMORY_DOCUMENT_PROFILE_LIMITS = { blocks: 16, sources: 128, evidenceSources: 3, colors: 16 } as const;

export type DocumentPaletteIdentity = {
  actorUserId: string; ownerUserId: string; organizationId: string | null; projectAccessId: string | null;
  projectId: string; documentId: string;
};
export type MemoryDocumentProfileSource = {
  eventId: string; sequence: number; type: "BlockCreated" | "BlockPropertyEdited" | "ChipEdited"; recordedAt: string;
};
export type MemoryDocumentProfileEvidence = {
  blockId: string; intent: "prefer" | "avoid" | "prohibit"; lineage: "unknown" | "assisted" | "copy";
  independentEvidence: false; sources: MemoryDocumentProfileSource[];
};
export type MemoryDocumentPaletteChoice = {
  claimKey: string; colors: string[]; status: "supported" | "opposed" | "conflicted";
  supports: MemoryDocumentProfileEvidence[]; counterevidence: MemoryDocumentProfileEvidence[];
};
export type MemoryDocumentProfile = {
  version: typeof NATIVE_DOCUMENT_PALETTE_CHOICE_RECIPE; treatment: "document-authored-palette-choices";
  inferredPreferences: false; independentEvidence: false;
  scope: { organizationId: string | null; projectAccessId: string | null; projectId: string; documentId: string };
  grant: { id: string; revision: number }; lifetime: { checkedAt: string; validUntil: string };
  coverage: { bounded: true; completeHistory: false; blockLimit: 16; sourceLimit: 128;
    selectedBlockCount: number; eligibleChoiceCount: number };
  choices: MemoryDocumentPaletteChoice[];
};

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: readonly string[]) => Reflect.ownKeys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key));
const id = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 240
  && value.trim() === value && value.isWellFormed()
  && !Array.from(value).some(character => { const code = character.codePointAt(0)!; return code < 32 || code === 127; });
const dense = (value: readonly unknown[]) => Reflect.ownKeys(value).length === value.length + 1
  && Array.from({ length: value.length }, (_, index) => index).every(index => Object.hasOwn(value, index));
const integer = (value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER): value is number =>
  Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
const timestamp = (value: unknown): number | null => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : null;
};
const scopeValid = (value: Record<string, unknown>) => id(value.projectId) && id(value.documentId)
  && (value.organizationId === null && value.projectAccessId === null || id(value.organizationId) && id(value.projectAccessId));

/** Wire palettes are already normalized. Order and repeated colors are preserved:
 * this is one authored palette, not independent claims about individual colors. */
export function canonicalDocumentPalette(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > MEMORY_DOCUMENT_PROFILE_LIMITS.colors || !dense(value)
    || value.some(color => typeof color !== "string" || !/^#[0-9a-f]{6}$/u.test(color))) return null;
  return [...value] as string[];
}

/** Deterministic grouping identity only; neither a source revision nor an access
 * grant. The native caller must supply its independently certified full tuple. */
export async function documentPaletteClaimKey(identity: DocumentPaletteIdentity, colors: readonly string[]): Promise<string> {
  const palette = canonicalDocumentPalette(colors);
  if (!object(identity) || !exact(identity, ["actorUserId", "ownerUserId", "organizationId", "projectAccessId", "projectId", "documentId"])
    || !id(identity.actorUserId) || !id(identity.ownerUserId) || !scopeValid(identity) || !palette
    || identity.organizationId === null && identity.actorUserId !== identity.ownerUserId) throw new Error("document_palette_identity_invalid");
  const serialized = JSON.stringify([NATIVE_DOCUMENT_PALETTE_CHOICE_RECIPE, identity.actorUserId, identity.ownerUserId,
    identity.organizationId, identity.projectAccessId, identity.projectId, identity.documentId, palette]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(serialized));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

/** Strict presentation contract, not native authorization or proof of human
 * independence. Empty/incomplete selections never assert an empty history.
 * The original absolute lease is copied, never refreshed by parsing. */
export function parseMemoryDocumentProfile(value: unknown, now = Date.now()): MemoryDocumentProfile | null {
  try {
    if (!Number.isFinite(now) || !object(value)
      || !exact(value, ["version", "treatment", "inferredPreferences", "independentEvidence", "scope", "grant", "lifetime", "coverage", "choices"])
      || value.version !== NATIVE_DOCUMENT_PALETTE_CHOICE_RECIPE || value.treatment !== "document-authored-palette-choices"
      || value.inferredPreferences !== false || value.independentEvidence !== false
      || new TextEncoder().encode(JSON.stringify(value)).byteLength > MEMORY_DOCUMENT_PROFILE_MAX_BYTES) return null;
    const scope = value.scope, grant = value.grant, lifetime = value.lifetime, coverage = value.coverage;
    if (!object(scope) || !exact(scope, ["organizationId", "projectAccessId", "projectId", "documentId"]) || !scopeValid(scope)
      || !object(grant) || !exact(grant, ["id", "revision"]) || !id(grant.id) || !integer(grant.revision, 1)
      || !object(lifetime) || !exact(lifetime, ["checkedAt", "validUntil"])) return null;
    const checked = timestamp(lifetime.checkedAt), until = timestamp(lifetime.validUntil);
    if (checked === null || until === null || checked > now || until <= now || until <= checked || until - checked > 60_000) return null;
    if (!object(coverage) || !exact(coverage, ["bounded", "completeHistory", "blockLimit", "sourceLimit", "selectedBlockCount", "eligibleChoiceCount"])
      || coverage.bounded !== true || coverage.completeHistory !== false || coverage.blockLimit !== 16 || coverage.sourceLimit !== 128
      || !integer(coverage.selectedBlockCount, 0, 16) || !integer(coverage.eligibleChoiceCount, 0, 16)
      || !Array.isArray(value.choices) || value.choices.length > 16 || !dense(value.choices)
      || coverage.eligibleChoiceCount !== value.choices.length) return null;
    const keys = new Set<string>(), palettes = new Set<string>(), blocks = new Set<string>();
    const eventIds = new Set<string>(), sequences = new Set<number>();
    const evidence = (raw: unknown, support: boolean): MemoryDocumentProfileEvidence[] | null => {
      if (!Array.isArray(raw) || raw.length > 16 || !dense(raw)) return null;
      const parsed: MemoryDocumentProfileEvidence[] = [];
      for (const row of raw) {
        if (!object(row) || !exact(row, ["blockId", "intent", "lineage", "independentEvidence", "sources"])
          || !id(row.blockId) || blocks.has(row.blockId) || row.independentEvidence !== false
          || row.lineage !== "unknown" && row.lineage !== "assisted" && row.lineage !== "copy"
          || (support ? row.intent !== "prefer" : row.intent !== "avoid" && row.intent !== "prohibit")
          || !Array.isArray(row.sources) || row.sources.length < 1 || row.sources.length > 3 || !dense(row.sources)) return null;
        blocks.add(row.blockId);
        const sources: MemoryDocumentProfileSource[] = [];
        let previousSequence = 0;
        for (const source of row.sources) {
          if (!object(source) || !exact(source, ["eventId", "sequence", "type", "recordedAt"])
            || !id(source.eventId) || eventIds.has(source.eventId) || !integer(source.sequence, 1) || sequences.has(source.sequence)
            || source.sequence <= previousSequence || source.type !== "BlockCreated" && source.type !== "BlockPropertyEdited" && source.type !== "ChipEdited") return null;
          const recorded = timestamp(source.recordedAt);
          if (recorded === null || recorded > checked) return null;
          eventIds.add(source.eventId); sequences.add(source.sequence); previousSequence = source.sequence;
          if (eventIds.size > 128) return null;
          sources.push({ eventId: source.eventId, sequence: source.sequence,
            type: source.type as MemoryDocumentProfileSource["type"], recordedAt: source.recordedAt as string });
        }
        parsed.push({ blockId: row.blockId, intent: row.intent as MemoryDocumentProfileEvidence["intent"],
          lineage: row.lineage as MemoryDocumentProfileEvidence["lineage"], independentEvidence: false, sources });
      }
      return parsed;
    };
    const choices: MemoryDocumentPaletteChoice[] = [];
    for (const row of value.choices) {
      if (!object(row) || !exact(row, ["claimKey", "colors", "status", "supports", "counterevidence"])
        || typeof row.claimKey !== "string" || !/^[0-9a-f]{64}$/u.test(row.claimKey) || keys.has(row.claimKey)) return null;
      const colors = canonicalDocumentPalette(row.colors);
      if (!colors || palettes.has(JSON.stringify(colors))) return null;
      keys.add(row.claimKey); palettes.add(JSON.stringify(colors));
      const supports = evidence(row.supports, true), counterevidence = evidence(row.counterevidence, false);
      if (!supports || !counterevidence || supports.length + counterevidence.length === 0) return null;
      const status = supports.length ? counterevidence.length ? "conflicted" : "supported" : "opposed";
      if (row.status !== status) return null;
      choices.push({ claimKey: row.claimKey, colors, status, supports, counterevidence });
    }
    if (blocks.size > coverage.selectedBlockCount) return null;
    return {
      version: NATIVE_DOCUMENT_PALETTE_CHOICE_RECIPE, treatment: "document-authored-palette-choices",
      inferredPreferences: false, independentEvidence: false,
      scope: { organizationId: scope.organizationId as string | null, projectAccessId: scope.projectAccessId as string | null,
        projectId: scope.projectId as string, documentId: scope.documentId as string },
      grant: { id: grant.id, revision: grant.revision },
      lifetime: { checkedAt: lifetime.checkedAt as string, validUntil: lifetime.validUntil as string },
      coverage: { bounded: true, completeHistory: false, blockLimit: 16, sourceLimit: 128,
        selectedBlockCount: coverage.selectedBlockCount, eligibleChoiceCount: choices.length }, choices,
    };
  } catch { return null; }
}
