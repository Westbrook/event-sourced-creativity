/** A view selector only. Retained intake and current canonical source establish authority. */
export type ExperienceHostSelection = Readonly<{ output: "image" | "slides" | "short_story" | "scene" | "storyboard" | "audio" | "video" | "model3d"; draftId: string; documentId: string; documentRoute: string }>;
const keys = new Set(["experience", "experience-draft", "progress-report"]);
const draft = /^experience-draft-[a-f0-9]{64}$/u;
const documentPath = /^\/document\/([a-zA-Z0-9][a-zA-Z0-9._:-]{0,159})(?:\/[^/]+)?$/u;
function local(value: string): URL | null {
  if (typeof value !== "string" || value.length > 4096 || !value.startsWith("/") || value.startsWith("//") || /[\\\p{Cc}]/u.test(value)) return null;
  try { const url = new URL(value, "https://forma.local"); return url.origin === "https://forma.local" ? url : null; } catch { return null; }
}
/** Dedicated HTML entry, not another creative SPA view. This selects transport only. */
export function isStandaloneExperienceRoute(value: string): boolean {
  const url = local(value);
  if (!url || value.includes("#")) return false;
  const pathname = value.split("?", 1)[0]!.replace(/\/$/u, "");
  return /^\/experiences(?:\/(?:image|slides|short-story|scene|model3d|storyboard|audio|video))?$/u.test(pathname);
}
export function hasExperienceHostSelector(value: string): boolean {
  if (typeof value !== "string") return false;
  // Presentation only: malformed authority input must not reveal advanced chrome.
  // Extremely large candidate routes are unavailable without unbounded parsing.
  if (value.length > 131072) return true;
  const query = value.indexOf("?"), fragment = value.indexOf("#");
  if (query < 0 || fragment >= 0 && fragment < query) return false;
  const params = new URLSearchParams(value.slice(query + 1, fragment < 0 ? undefined : fragment));
  return params.has("experience") || params.has("experience-draft");
}
export function parseExperienceHostRoute(value: string): ExperienceHostSelection | null {
  const url = local(value), match = url?.pathname.match(documentPath);
  if (!url || !match || url.hash || [...url.searchParams.keys()].some(key => !keys.has(key))
    || [...keys].some(key => url.searchParams.getAll(key).length > 1)) return null;
  const output = url.searchParams.get("experience"), draftId = url.searchParams.get("experience-draft");
  if ((output !== "image" && output !== "slides" && output !== "short_story" && output !== "scene" && output !== "storyboard" && output !== "audio" && output !== "video" && output !== "model3d") || !draftId || !draft.test(draftId)) return null;
  url.searchParams.delete("experience"); url.searchParams.delete("experience-draft");
  return Object.freeze({ output, draftId, documentId: match[1]!, documentRoute: url.pathname + url.search });
}
export function experienceHostRoute(documentRoute: string, output: "image" | "slides" | "short_story" | "scene" | "storyboard" | "audio" | "video" | "model3d", draftId: string): string {
  const url = local(documentRoute);
  if (!url || hasExperienceHostSelector(documentRoute)) throw new TypeError("experience_route_invalid");
  url.searchParams.set("experience", output); url.searchParams.set("experience-draft", draftId);
  const route = url.pathname + url.search + url.hash;
  if (!parseExperienceHostRoute(route)) throw new TypeError("experience_route_invalid");
  return route;
}
/** Forward the Developer UI presence flag only, never a return URL or mode selector. */
export function withExperienceReportFlag(destination: string, source: string): string {
  const target = local(destination), from = local(source);
  if (!target) throw new TypeError("experience_route_invalid");
  if (from?.searchParams.has("progress-report")) target.searchParams.set("progress-report", "");
  return target.pathname + target.search + target.hash;
}
