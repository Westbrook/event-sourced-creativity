import { normalizeSpatialScope } from "../../model/spatial-scope.ts";
import type { FormaLocaleController } from "./localization";

type SpatialLocalization = Pick<FormaLocaleController, "locale" | "number" | "system">;

/** Preserve authored area descriptions and subject names while translating system vocabulary. */
export function localizedSpatialScopeLabel(value: unknown, locale: SpatialLocalization, authoredSubject?: string) {
  const scope = normalizeSpatialScope(value);
  if (scope.kind === "document") return locale.system("Whole document");
  if (scope.kind === "region") {
    return scope.region === "custom" && scope.instruction
      ? scope.instruction
      : locale.system(scope.region === "custom" ? "Implied area" : `${scope.region?.replaceAll("-", " ")} area`);
  }
  if (scope.kind === "aabb") {
    return `${locale.system("Rectangle")} · ${locale.number(Math.round((scope.aabb?.width ?? 0) * 100))}% × ${locale.number(Math.round((scope.aabb?.height ?? 0) * 100))}%`;
  }
  if (scope.kind === "subject") {
    const subject = authoredSubject || locale.system("subject");
    const relation = locale.system(scope.subject_relation?.replaceAll("-", " ") || "around");
    return locale.locale.startsWith("ja") ? `${subject}の${relation}` : `${relation} ${subject}`;
  }
  const points = scope.path?.length ?? 0;
  return `${locale.system("Custom path")} · ${locale.number(points)} ${locale.system(points === 1 ? "point" : "points")}`;
}
