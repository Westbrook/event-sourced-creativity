import { blockTypeDefinition } from "../model/block-types";
import type { CreativeBlock } from "../model/events";
import type { FormaLocaleController } from "./design-system/localization";

/** Suspend owned modal layers before retaining an editor outside the document. */
export function suspendContextControls(host: ParentNode) {
  for (const control of host.querySelectorAll("forma-context-intelligence, forma-spatial-scope-editor, forma-reference-palette-picker")) {
    (control as Element & { suspendControls?: () => void }).suspendControls?.();
  }
  for (const dialog of host.querySelectorAll<HTMLDialogElement>("dialog[open]")) dialog.close();
}

export function contextControlName(
  labelOf: (candidate: CreativeBlock) => string,
  block: CreativeBlock,
  peers: readonly CreativeBlock[],
  i18n: Pick<FormaLocaleController, "t" | "system">,
) {
  // Normalize only comparisons; all authored values stay byte-complete in the name.
  const comparable = (value: string) => value.normalize("NFKC").replace(/\p{Cf}/gu, "").replace(/\s+/gu, " ").trim().toLowerCase();
  const valuesFor = (candidate: CreativeBlock) => ({
    label: labelOf(candidate),
    type: i18n.system(blockTypeDefinition(candidate.type)?.label ?? candidate.type),
    handle: "\u2068" + candidate.handle + "\u2069",
    id: "\u2068" + candidate.id + "\u2069",
  });
  // Exact IDs bind logical peers; normalization is never an identity key. A
  // retained current block may be a newer object or be absent from the peer view.
  const candidates = new Map(peers.map(candidate => [candidate.id, candidate]));
  candidates.set(block.id, block);
  const entries = [...candidates.values()].map(candidate => {
    const values = valuesFor(candidate);
    const base = i18n.t("context.controls.contextNamed", "{label} — {type}: {handle}", values);
    return { id: candidate.id, values, base, key: comparable(base), readable: Boolean(comparable(candidate.handle)), name: "" };
  });
  const baseCounts = new Map<string, number>();
  for (const entry of entries) baseCounts.set(entry.key, (baseCounts.get(entry.key) ?? 0) + 1);
  const byName = new Map<string, number[]>();
  for (const [index, entry] of entries.entries()) {
    entry.name = !entry.readable
      ? i18n.t("context.controls.identityOnly", "{label} — {type} · ID {id}", entry.values)
      : baseCounts.get(entry.key)! > 1
        ? i18n.t("context.controls.identityNamed", "{label} — {type}: {handle} · ID {id}", entry.values)
        : entry.base;
    const key = comparable(entry.name), group = byName.get(key);
    if (group) group.push(index); else byName.set(key, [index]);
  }
  const target = entries.findIndex(entry => entry.id === block.id);
  const affected = new Set<number>(), pending: number[] = [];
  const mark = (index: number) => { if (!affected.has(index)) { affected.add(index); pending.push(index); } };
  for (const group of byName.values()) if (group.length > 1) for (const index of group) mark(index);
  if (!pending.length) return entries[target]!.name;

  // One prefix-free candidate per peer, ordered by complete, exact IDs. The
  // ordinal prefix comes before every authored field and ends at a fixed
  // delimiter. Distinct candidates remain distinct under comparable().
  const ranks = new Map([...candidates.keys()].sort().map((id, index) => [id, index + 1]));
  const alternatives = entries.map(entry => i18n.t("context.controls.disambiguated", "{ordinal} · {name}", {
    ordinal: "\u2068" + ranks.get(entry.id)! + "\u2069", name: entry.name,
  }));
  // Close only candidate-to-original aliases. Each peer is marked at most once;
  // candidates never grow or change, so even an authored alias chain is finite.
  // Ordinary calls stay O(n); exceptional ranking is O(n log n) per call.
  for (let cursor = 0; cursor < pending.length; cursor += 1) {
    const aliases = byName.get(comparable(alternatives[pending[cursor]!]!));
    if (aliases) for (const index of aliases) mark(index);
  }
  return affected.has(target) ? alternatives[target]! : entries[target]!.name;
}
