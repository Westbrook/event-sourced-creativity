import type { OutputCommandResponse, OutputRequirementsSnapshot } from "../model/output-delivery-contract";

export type OutputRecordedPackage = Readonly<{
  manifestId: string;
  eventId: string;
  paths: readonly string[];
}>;

/** Validate an export ACK's supplied links; never recover a link from another read or receipt. */
export function readOutputRecordedPackage(value: unknown, documentId: string): OutputRecordedPackage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const command = value as OutputCommandResponse["command"];
  const id = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/;
  if (command.action !== "export" || typeof command.manifestId !== "string" || !id.test(command.manifestId)
    || typeof command.eventId !== "string" || !id.test(command.eventId)) return null;
  const parts = command.downloadUrls !== undefined ? command.downloadUrls : (command.downloadUrl ? [command.downloadUrl] : []);
  if (!Array.isArray(parts) || !parts.length || parts.length > 9999
    || command.partCount !== undefined && command.partCount !== parts.length) return null;
  const valid = (path: unknown, part: number | null) => {
    if (typeof path !== "string" || !path.startsWith("/api/output-requirements/deliveries/") || /[\s\\#]/.test(path)) return false;
    try {
      const url = new URL(path, "https://forma-output.invalid");
      return url.origin === "https://forma-output.invalid"
        && url.pathname === `/api/output-requirements/deliveries/${encodeURIComponent(command.manifestId!)}`
        && url.searchParams.getAll("documentId").length === 1 && url.searchParams.get("documentId") === documentId
        && [...url.searchParams.keys()].every(key => key === "documentId" || key === "part")
        && (part === null ? !url.searchParams.has("part")
          : url.searchParams.getAll("part").length === 1 && url.searchParams.get("part") === String(part));
    } catch { return false; }
  };
  if (command.downloadUrl !== undefined && !valid(command.downloadUrl, null)
    || !Array.from(parts).every((path, index) => valid(path, parts.length > 1 ? index + 1 : null))) return null;
  return Object.freeze({ manifestId: command.manifestId!, eventId: command.eventId, paths: Object.freeze([...parts]) });
}

/** Export itself changes the event-stream revision, not this current result/acceptance inventory. */
export function outputPackageInventory(snapshot: OutputRequirementsSnapshot): string {
  const ordered = (rows: unknown[][]) => rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return JSON.stringify([
    snapshot.summary?.delivery_ready,
    ordered(snapshot.results.map(row => [row.id, row.targetId, row.planRevisionId, row.assetId, row.resultRevision,
      row.targetContractDigest, row.sourceDigest, row.sha256, row.checksStatus, row.review, row.acceptanceId])),
    ordered(snapshot.assets.map(row => [row.id, row.sha256, row.available])),
  ]);
}
