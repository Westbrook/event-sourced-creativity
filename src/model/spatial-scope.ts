export type SpatialScopeKind = "document" | "region" | "aabb" | "subject" | "path";
export type SpatialFalloff = "hard" | "soft" | "contextual";

export type SpatialPoint = { x: number; y: number };
export type SpatialScope = {
  schema_version: 1;
  kind: SpatialScopeKind;
  coordinate_space: "document-normalized";
  region?: "left" | "right" | "top" | "bottom" | "center" | "foreground" | "background" | "edges" | "custom";
  instruction?: string;
  aabb?: { x: number; y: number; width: number; height: number };
  subject_block_id?: string;
  subject_relation?: "inside" | "around" | "in-front-of" | "behind";
  path?: SpatialPoint[];
  feather: number;
  falloff: SpatialFalloff;
  polarity: "inside" | "outside";
};

const record = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const clamp = (value: unknown, fallback = 0) => Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : fallback));
const scopeKinds = new Set<SpatialScopeKind>(["document", "region", "aabb", "subject", "path"]);
const regions = new Set<NonNullable<SpatialScope["region"]>>(["left", "right", "top", "bottom", "center", "foreground", "background", "edges", "custom"]);
const falloffs = new Set<SpatialFalloff>(["hard", "soft", "contextual"]);

export const WHOLE_DOCUMENT_SCOPE: SpatialScope = {
  schema_version: 1,
  kind: "document",
  coordinate_space: "document-normalized",
  feather: 0,
  falloff: "hard",
  polarity: "inside",
};

export function normalizeSpatialScope(value: unknown): SpatialScope {
  const input = record(value);
  const kind = scopeKinds.has(input.kind as SpatialScopeKind) ? input.kind as SpatialScopeKind : "document";
  const box = record(input.aabb);
  const points = Array.isArray(input.path) ? input.path.map(record).map((point) => ({ x: clamp(point.x), y: clamp(point.y) })).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y)).slice(0, 64) : [];
  return {
    schema_version: 1,
    kind,
    coordinate_space: "document-normalized",
    ...(kind === "region" ? { region: regions.has(input.region as NonNullable<SpatialScope["region"]>) ? input.region as NonNullable<SpatialScope["region"]> : "center", instruction: String(input.instruction ?? "") } : {}),
    ...(kind === "aabb" ? { aabb: { x: clamp(box.x, .2), y: clamp(box.y, .2), width: clamp(box.width, .6), height: clamp(box.height, .6) } } : {}),
    ...(kind === "subject" ? { subject_block_id: String(input.subject_block_id ?? ""), subject_relation: (["inside", "around", "in-front-of", "behind"].includes(String(input.subject_relation)) ? String(input.subject_relation) : "around") as NonNullable<SpatialScope["subject_relation"]> } : {}),
    ...(kind === "path" ? { path: points.length >= 3 ? points : [{ x: .2, y: .2 }, { x: .8, y: .2 }, { x: .7, y: .8 }, { x: .25, y: .72 }] } : {}),
    feather: kind === "document" ? 0 : clamp(input.feather, kind === "region" || kind === "subject" ? .2 : 0),
    falloff: falloffs.has(input.falloff as SpatialFalloff) ? input.falloff as SpatialFalloff : kind === "region" || kind === "subject" ? "contextual" : "hard",
    polarity: input.polarity === "outside" ? "outside" : "inside",
  };
}

export function spatialScopeLabel(value: unknown, subjectLabel = "subject") {
  const scope = normalizeSpatialScope(value);
  if (scope.kind === "document") return "Whole document";
  if (scope.kind === "region") return scope.region === "custom" ? scope.instruction || "Implied area" : `${scope.region?.replaceAll("-", " ")} area`;
  if (scope.kind === "aabb") return `Rectangle · ${Math.round((scope.aabb?.width ?? 0) * 100)}% × ${Math.round((scope.aabb?.height ?? 0) * 100)}%`;
  if (scope.kind === "subject") return `${scope.subject_relation?.replaceAll("-", " ")} ${subjectLabel}`;
  return `Custom path · ${scope.path?.length ?? 0} points`;
}

export function parseSpatialPath(value: string): SpatialPoint[] {
  return value.split(/\s+/).map((pair) => pair.split(",").map(Number)).filter((pair) => pair.length === 2 && pair.every(Number.isFinite)).map(([x, y]) => ({ x: clamp(x / 100), y: clamp(y / 100) })).slice(0, 64);
}

export function formatSpatialPath(points: SpatialPoint[] | undefined) {
  return (points ?? []).map((point) => `${Math.round(point.x * 100)},${Math.round(point.y * 100)}`).join(" ");
}
