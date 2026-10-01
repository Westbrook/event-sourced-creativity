import { experienceIds, isDraftId, isIntentId } from "./intake.ts";
import { parseRetainedStoryRoute, type RetainedStorySelection } from "../model/retained-short-story.ts";

export type ExperienceRoute =
  | Readonly<{ kind: "chooser" }>
  | Readonly<{ kind: "fresh"; experienceId: string }>
  | Readonly<{ kind: "recover"; experienceId: string; id: string; byIntent: boolean }>
  | Readonly<{ kind: "retained"; selection: RetainedStorySelection }>
  | Readonly<{ kind: "invalid" }>;

const registeredIds = new Set(experienceIds);

/** Preserve the supplied query/fragment delimiters; URL.search/hash erase empty ones. */
function relativeAddress(address: string): string | null {
  if (address.startsWith("/")) return address.startsWith("//") ? null : address;
  const authority = /^https?:\/\/[^/?#]+/iu.exec(address);
  if (!authority) return null;
  const url = new URL(address);
  if (!/^https?:$/u.test(url.protocol) || url.username || url.password) return null;
  const suffix = address.slice(authority[0].length);
  return suffix.startsWith("/") ? suffix : "/" + suffix;
}

/**
 * Classify the original request.url/location.href before any asset rewrite.
 * Selection is not authentication. null is unrelated; invalid is never fresh.
 */
export function classifyExperienceRoute(address: string): ExperienceRoute | null {
  try {
    if (typeof address !== "string") return null;
    const relative = relativeAddress(address);
    if (relative === null) return null;
    const boundary = relative.search(/[?#]/u);
    const path = boundary < 0 ? relative : relative.slice(0, boundary);
    if (path !== "/make" && !path.startsWith("/make/")) return null;
    if (address.length > 4096 || /[\0-\u0020\u007f\\]/u.test(address)) return { kind: "invalid" };
    if (relative.length > 2048 || relative.includes("#")) return { kind: "invalid" };
    const queryAt = relative.indexOf("?");
    if (queryAt >= 0 && relative.slice(queryAt + 1).split("&").some(part => !part)) return { kind: "invalid" };
    const url = new URL(relative, "https://forma.local");
    // Never admit a setup route created by dot-segment or other URL normalization.
    if (url.origin !== "https://forma.local" || url.pathname !== path) return { kind: "invalid" };
    const retained = parseRetainedStoryRoute(relative);
    if (retained) return { kind: "retained", selection: retained };
    if (path === "/make" || path === "/make/") return queryAt < 0 ? { kind: "chooser" } : { kind: "invalid" };
    const match = /^\/make\/([^/]+)$/u.exec(path);
    if (!match || !registeredIds.has(match[1]!)) return { kind: "invalid" };
    const experienceId = match[1]!;
    if (queryAt < 0) return { kind: "fresh", experienceId };
    const keys = [...url.searchParams.keys()];
    if (keys.length !== 1) return { kind: "invalid" };
    const key = keys[0]!, id = url.searchParams.get(key)!;
    if (key === "draft" && isDraftId(id)) return { kind: "recover", experienceId, id, byIntent: false };
    if (key === "intent" && isIntentId(id)) return { kind: "recover", experienceId, id, byIntent: true };
    return { kind: "invalid" };
  } catch { return { kind: "invalid" }; }
}
