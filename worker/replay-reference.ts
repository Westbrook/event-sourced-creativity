import type { LiveReplayPlan } from "../src/model/live-replay.ts";

const MAX_REFERENCE_BYTES = 12 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type CommonsMetadataValue = { value?: string };
type CommonsImageInfo = {
  url?: string;
  thumburl?: string;
  descriptionurl?: string;
  mime?: string;
  width?: number;
  height?: number;
  thumbwidth?: number;
  thumbheight?: number;
  extmetadata?: Record<string, CommonsMetadataValue>;
};
type CommonsPage = { title?: string; imageinfo?: CommonsImageInfo[] };
type CommonsSearchResponse = { query?: { pages?: Record<string, CommonsPage> } };

export type LicensedReplayReference = {
  bytes: Uint8Array;
  mimeType: string;
  width: number;
  height: number;
  sourceUrl: string;
  sourcePageUrl: string;
  licenseName: string;
  licenseUrl: string;
  creator: string;
  attribution: string;
  query: string;
  latencyMs: number;
};

const plainText = (value: unknown) => String(value ?? "")
  .replace(/<[^>]*>/g, " ")
  .replace(/&nbsp;/gi, " ")
  .replace(/&amp;/gi, "&")
  .replace(/&quot;/gi, '"')
  .replace(/&#0*39;|&apos;/gi, "'")
  .replace(/\s+/g, " ")
  .trim();

const trustedUrl = (value: unknown, hostname: string) => {
  try {
    const url = new URL(String(value ?? ""));
    return url.protocol === "https:" && url.hostname === hostname ? url.toString() : "";
  } catch { return ""; }
};

const trustedLicenseUrl = (value: unknown) => {
  try {
    const url = new URL(String(value ?? ""));
    return url.protocol === "https:" && ["creativecommons.org", "www.gnu.org", "commons.wikimedia.org"].includes(url.hostname) ? url.toString() : "";
  } catch { return ""; }
};

const metadata = (info: CommonsImageInfo, key: string) => plainText(info.extmetadata?.[key]?.value);

const validImageSignature = (bytes: Uint8Array, mimeType: string) => {
  if (mimeType === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === "image/png") return bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (mimeType === "image/webp") return bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  return false;
};

export function replayReferenceGenerationPrompt(reference: LiveReplayPlan["reference"]) {
  return reference.generation_prompt.trim() || `A standalone visual reference expressing ${reference.composition}. Mood: ${reference.mood}. Materials: ${reference.materials}. Lighting: ${reference.lighting}. Spatial character: ${reference.spatial}.`;
}

export async function replayReferenceContentHash(bytes: Uint8Array) {
  const input = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("");
}

/**
 * Resolve a bounded, freely reusable image from Wikimedia Commons. The planner
 * contributes only a search query; URLs are accepted solely from Commons and
 * upload.wikimedia.org, then the downloaded bytes are signature-checked before
 * they can become a replay upload.
 */
export async function findLicensedReplayReference(reference: LiveReplayPlan["reference"], fetcher: typeof fetch = fetch): Promise<LicensedReplayReference> {
  const query = reference.internet_search_query.trim().slice(0, 240);
  if (!query) throw new Error("replay_reference_search_query_missing");
  const started = Date.now();
  const search = new URL("https://commons.wikimedia.org/w/api.php");
  search.search = new URLSearchParams({
    action: "query", format: "json", origin: "*", generator: "search", gsrnamespace: "6", gsrlimit: "12",
    gsrsearch: `file:${query}`, prop: "imageinfo", iiprop: "url|mime|size|extmetadata", iiurlwidth: "1024",
    iiextmetadatafilter: "LicenseShortName|LicenseUrl|Artist|Credit|Attribution|UsageTerms",
  }).toString();
  const searchResponse = await fetcher(search, { headers: { accept: "application/json" } });
  if (!searchResponse.ok) throw new Error(`replay_reference_search_failed:${searchResponse.status}`);
  const body = await searchResponse.json() as CommonsSearchResponse;
  const pages = Object.values(body.query?.pages ?? {});
  const candidate = pages.map((page) => ({ page, info: page.imageinfo?.[0] })).find(({ info }) => {
    if (!info || !ALLOWED_IMAGE_TYPES.has(String(info.mime ?? "").toLowerCase())) return false;
    if (!trustedUrl(info.thumburl ?? info.url, "upload.wikimedia.org")) return false;
    return Boolean(metadata(info, "LicenseShortName") || metadata(info, "UsageTerms"));
  });
  if (!candidate?.info) throw new Error("replay_reference_search_returned_no_licensed_image");
  const info = candidate.info;
  const sourceUrl = trustedUrl(info.thumburl ?? info.url, "upload.wikimedia.org");
  const sourcePageUrl = trustedUrl(info.descriptionurl, "commons.wikimedia.org") || `https://commons.wikimedia.org/wiki/${encodeURIComponent(String(candidate.page.title ?? "File:Reference").replace(/ /g, "_"))}`;
  const imageResponse = await fetcher(sourceUrl, { headers: { accept: "image/jpeg,image/png,image/webp" } });
  if (!imageResponse.ok) throw new Error(`replay_reference_download_failed:${imageResponse.status}`);
  const declaredLength = Number(imageResponse.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_REFERENCE_BYTES) throw new Error("replay_reference_image_too_large");
  const bytes = new Uint8Array(await imageResponse.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_REFERENCE_BYTES) throw new Error("replay_reference_image_too_large");
  const responseType = String(imageResponse.headers.get("content-type") ?? "").split(";")[0].toLowerCase();
  const mimeType = ALLOWED_IMAGE_TYPES.has(responseType) ? responseType : String(info.mime ?? "").toLowerCase();
  if (!ALLOWED_IMAGE_TYPES.has(mimeType) || !validImageSignature(bytes, mimeType)) throw new Error("replay_reference_download_was_not_a_supported_image");
  const licenseName = metadata(info, "LicenseShortName") || metadata(info, "UsageTerms");
  const creator = metadata(info, "Artist") || metadata(info, "Credit") || "Wikimedia Commons contributor";
  const attribution = metadata(info, "Attribution") || `${plainText(candidate.page.title)} — ${creator}`;
  return {
    bytes, mimeType, width: Number(info.thumbwidth ?? info.width ?? 1024), height: Number(info.thumbheight ?? info.height ?? 1024),
    sourceUrl, sourcePageUrl, licenseName, licenseUrl: trustedLicenseUrl(info.extmetadata?.LicenseUrl?.value),
    creator, attribution, query, latencyMs: Date.now() - started,
  };
}
