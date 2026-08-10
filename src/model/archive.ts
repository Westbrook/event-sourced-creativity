import type { CreativeEvent } from "./events";

export type FormaArchive = {
  format: "forma-event-archive";
  version: 1;
  exportedAt: string;
  streamId: string;
  events: CreativeEvent[];
  mediaManifest: Array<{ sourceRef: string; rightsClass: string }>;
};

export function exportArchive(events: CreativeEvent[]): FormaArchive {
  return {
    format: "forma-event-archive", version: 1, exportedAt: new Date().toISOString(),
    streamId: events[0]?.streamId ?? "empty",
    events: structuredClone(events),
    mediaManifest: events.filter((e) => e.type === "ReferenceIngested").map((e) => ({ sourceRef: String(e.payload.source_ref ?? ""), rightsClass: String(e.payload.rights_class ?? "unknown") })),
  };
}

export function importArchive(value: unknown): FormaArchive {
  if (!value || typeof value !== "object") throw new Error("Archive must be an object");
  const archive = value as Partial<FormaArchive>;
  if (archive.format !== "forma-event-archive" || archive.version !== 1 || !Array.isArray(archive.events)) throw new Error("Unsupported Forma archive");
  for (const event of archive.events) if (!event || typeof event.type !== "string" || typeof event.sequence !== "number" || !event.payload) throw new Error("Archive contains an invalid event");
  return archive as FormaArchive;
}
