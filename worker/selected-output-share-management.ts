import { SELECTED_OUTPUT_SHARE_MEDIA_PROJECTION_POLICY } from "../src/model/selected-output-share.ts";
import { SELECTED_OUTPUT_SHARE_AUDIO_POLICY } from "../src/model/selected-output-share-audio.ts";
import { SELECTED_OUTPUT_SHARE_VIDEO_POLICY, SELECTED_OUTPUT_SHARE_VIDEO_X264_POLICY } from "../src/model/selected-output-share-video.ts";
import { SELECTED_OUTPUT_SHARE_MODEL3D_POLICY, SELECTED_OUTPUT_SHARE_MODEL3D_TEXTURE_POLICY } from "../src/model/selected-output-share-model3d.ts";
import { hostedIdentity } from "./native-retained-text-custody.ts";
import { selectedOutputShareSchemaAssertion, selectedOutputShareSchemaState } from "./selected-output-share-readiness.ts";
import type { WorkerEnv } from "./runtime.ts";

const purpose = "selected-output-read-v1", pageSize = 50;
const encoder = new TextEncoder();
const identifier = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(value);
const timestamp = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const headers = { "cache-control": "private, no-store", "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers });
class Refusal extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number) { super(code); this.code = code; this.status = status; }
}
function fail(code = "selected_output_share_unavailable", status = 404): never { throw new Refusal(code, status); }
const queryInvalid = (): never => fail("selected_output_share_query_invalid", 400);
function hasControl(value: string) {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code >= 0x7f && code <= 0x9f) return true;
  }
  return false;
}
const own = (value: object, key: PropertyKey): unknown => {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
};
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function fields(value: unknown, keys: readonly string[]) {
  if (!record(value) || Reflect.ownKeys(value).length !== keys.length) return fail();
  const captured: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (!field || !Object.hasOwn(field, "value") || !field.enumerable) return fail();
    captured[key] = field.value;
  }
  return captured;
}
function frame(request: Request, env: WorkerEnv) {
  const db = env.DB, cohort = env.FORMA_PILOT_COHORT_ID, administrators = env.FORMA_ADMIN_EMAILS;
  const names = ["oai-authenticated-user-id", "oai-authenticated-user-email", "cookie", "origin", "sec-fetch-site"];
  const identity = names.map(name => request.headers.get(name));
  return () => {
    if (env.DB !== db || env.FORMA_PILOT_COHORT_ID !== cohort || env.FORMA_ADMIN_EMAILS !== administrators
      || request.signal.aborted || names.some((name, index) => request.headers.get(name) !== identity[index])) fail();
  };
}
function sameOrigin(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && !["same-origin", "none"].includes(site)
    || request.headers.has("origin") && request.headers.get("origin") !== new URL(request.url).origin)
    fail("selected_output_share_same_origin_required", 403);
}
type Cursor = readonly [createdAt: string, shareId: string];
const encodeCursor = (value: Cursor) => btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
function decodeCursor(value: string): Cursor {
  try {
    if (!/^[A-Za-z0-9_-]{1,320}$/u.test(value)) return queryInvalid();
    const decoded: unknown = JSON.parse(atob(value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4)));
    if (!Array.isArray(decoded) || decoded.length !== 2 || !timestamp(decoded[0]) || !identifier(decoded[1])
      || encodeCursor(decoded as unknown as Cursor) !== value) return queryInvalid();
    return decoded as unknown as Cursor;
  } catch { return queryInvalid(); }
}
function query(request: Request) {
  const url = new URL(request.url), params = url.searchParams;
  if (url.search.length > 1536 || [...params.keys()].some(key => !["documentId", "artifactId", "cursor"].includes(key))
    || params.getAll("documentId").length !== 1 || params.getAll("artifactId").length !== 1 || params.getAll("cursor").length > 1)
    return queryInvalid();
  const documentId = params.get("documentId"), artifactId = params.get("artifactId");
  if (!identifier(documentId) || !identifier(artifactId)) return queryInvalid();
  return { documentId, artifactId, cursor: params.has("cursor") ? decodeCursor(params.get("cursor")!) : null };
}
const rowKeys = ["permitted", "metadata_valid", "share_id", "review_title", "output", "revision", "expires_at", "issued_at", "created_at"] as const;
type Metadata = { shareId: string; title: string; output: "short_story" | "scene" | "slides" | "audio" | "video" | "model3d"; revision: number; expiresAt: string; issuedAt: string };
function readRows(result: unknown): Array<{ metadata: Metadata; cursor: Cursor }> {
  if (!record(result) || own(result, "success") !== true || own(result, "error") !== undefined
    || Object.getOwnPropertyDescriptor(result, "error") && !Object.hasOwn(Object.getOwnPropertyDescriptor(result, "error")!, "value")) return fail();
  const rows = own(result, "results");
  if (!Array.isArray(rows) || Object.getPrototypeOf(rows) !== Array.prototype) return fail();
  const length = own(rows, "length");
  if (!Number.isSafeInteger(length) || Number(length) < 1 || Number(length) > pageSize + 1
    || Reflect.ownKeys(rows).length !== Number(length) + 1) return fail();
  const parsed: Array<{ metadata: Metadata; cursor: Cursor }> = [];
  for (let index = 0; index < Number(length); index++) {
    const row = fields(own(rows, index), rowKeys);
    if (row.permitted !== 1) return fail();
    if (row.share_id === null && row.metadata_valid === null) {
      if (length !== 1 || rowKeys.slice(1).some(key => row[key] !== null)) return fail();
      return [];
    }
    if (row.metadata_valid !== 1 || !identifier(row.share_id) || typeof row.review_title !== "string" || !row.review_title.trim()
      || encoder.encode(row.review_title).length > 512 || hasControl(row.review_title)
      || typeof row.output !== "string" || !["short_story", "scene", "slides", "audio", "video", "model3d"].includes(row.output)
      || !Number.isSafeInteger(row.revision) || Number(row.revision) < 0
      || !timestamp(row.created_at) || !timestamp(row.expires_at) || !timestamp(row.issued_at)
      || row.created_at > row.issued_at || row.issued_at >= row.expires_at) return fail();
    const cursor: Cursor = [row.created_at, row.share_id];
    const previous = parsed.at(-1)?.cursor;
    if (previous && (previous[0] < cursor[0] || previous[0] === cursor[0] && previous[1] <= cursor[1])) return fail();
    parsed.push({ cursor, metadata: { shareId: row.share_id, title: row.review_title, output: row.output as Metadata["output"],
      revision: Number(row.revision), expiresAt: row.expires_at, issuedAt: row.issued_at } });
  }
  return parsed;
}

/** Canonical owner metadata only. Expired issued links remain manageable; a row
 * is not evidence that its source is currently available. This cannot recover a
 * secret, create an audience, read native content, provision identity or install schema. */
export async function listSelectedOutputShares(request: Request, env: WorkerEnv): Promise<Response> {
  try {
    if (request.method !== "GET") fail("method_not_allowed", 405);
    sameOrigin(request);
    const selected = query(request), stable = frame(request, env);
    let principal: ReturnType<typeof hostedIdentity>;
    try { principal = hostedIdentity(request); } catch { return json({ error: "selected_output_share_personal_principal_required" }, 403); }
    if (!principal) fail("selected_output_share_authentication_required", 401);
    stable();
    if (await selectedOutputShareSchemaState(env) !== "ready") fail();
    stable();
    const schema = selectedOutputShareSchemaAssertion();
    const selectedRows = `owner_id=? AND purpose=? AND token_hash IS NOT NULL AND issued_at IS NOT NULL
      AND revoked_at IS NULL AND minimized_at IS NULL AND json_extract(selection_json,'$.documentId')=?
      AND json_extract(selection_json,'$.artifactId')=?`;
    const boundedId = "typeof(share_id)='text' AND length(CAST(share_id AS BLOB)) BETWEEN 1 AND 160";
    const validTextSelection = `json_type(selection_json)='object'
      AND (SELECT count(*) FROM json_each(selection_json))=5
      AND (SELECT count(DISTINCT key) FROM json_each(selection_json)
        WHERE key IN('output','documentId','artifactId','revision','contentSha256'))=5
      AND json_type(selection_json,'$.output')='text' AND json_extract(selection_json,'$.output') IN('short_story','scene','slides')
      AND json_type(selection_json,'$.documentId')='text' AND json_type(selection_json,'$.artifactId')='text'
      AND json_type(selection_json,'$.revision')='integer' AND json_extract(selection_json,'$.revision') BETWEEN 0 AND 9007199254740991
      AND json_type(selection_json,'$.contentSha256')='text' AND length(json_extract(selection_json,'$.contentSha256'))=64
      AND length(CAST(json_extract(selection_json,'$.contentSha256') AS BLOB))=64
      AND json_extract(selection_json,'$.contentSha256') NOT GLOB '*[^0-9a-f]*'`;
    // Separate closed media branch: preserve text selection semantics and the
    // same single-statement owner/schema/cursor proof. Listing metadata never
    // reads a native result, proves paid provenance or obtains media bytes.
    const validMediaSelection = `json_type(selection_json)='object'
      AND (SELECT count(*) FROM json_each(selection_json))=8
      AND (SELECT count(DISTINCT key) FROM json_each(selection_json)
        WHERE key IN('output','documentId','artifactId','revision','contentSha256','mediaSha256','policy','projectionPolicy'))=8
      AND json_type(selection_json,'$.documentId')='text' AND json_type(selection_json,'$.artifactId')='text'
      AND json_type(selection_json,'$.revision')='integer' AND json_extract(selection_json,'$.revision') BETWEEN 0 AND 9007199254740991
      AND json_type(selection_json,'$.contentSha256')='text' AND length(json_extract(selection_json,'$.contentSha256'))=64
      AND length(CAST(json_extract(selection_json,'$.contentSha256') AS BLOB))=64
      AND json_extract(selection_json,'$.contentSha256') NOT GLOB '*[^0-9a-f]*'
      AND json_type(selection_json,'$.mediaSha256')='text' AND length(json_extract(selection_json,'$.mediaSha256'))=64
      AND length(CAST(json_extract(selection_json,'$.mediaSha256') AS BLOB))=64
      AND json_extract(selection_json,'$.mediaSha256') NOT GLOB '*[^0-9a-f]*'
      AND json_type(selection_json,'$.projectionPolicy')='text'
      AND json_extract(selection_json,'$.projectionPolicy')='${SELECTED_OUTPUT_SHARE_MEDIA_PROJECTION_POLICY}'
      AND json_type(selection_json,'$.output')='text' AND json_type(selection_json,'$.policy')='text'
      AND ((json_extract(selection_json,'$.output')='audio' AND json_extract(selection_json,'$.policy')='${SELECTED_OUTPUT_SHARE_AUDIO_POLICY}')
        OR (json_extract(selection_json,'$.output')='video' AND json_extract(selection_json,'$.policy') IN('${SELECTED_OUTPUT_SHARE_VIDEO_POLICY}','${SELECTED_OUTPUT_SHARE_VIDEO_X264_POLICY}'))
        OR (json_extract(selection_json,'$.output')='model3d' AND json_extract(selection_json,'$.policy') IN('${SELECTED_OUTPUT_SHARE_MODEL3D_POLICY}','${SELECTED_OUTPUT_SHARE_MODEL3D_TEXTURE_POLICY}')))`;
    const validSelection = `((${validTextSelection}) OR (${validMediaSelection}))`;
    const selectionBindings = [principal.userId, purpose, selected.documentId, selected.artifactId];
    const cursorProof = selected.cursor ? `AND EXISTS(SELECT 1 FROM selected_output_shares WHERE ${selectedRows} AND created_at=? AND share_id=? AND (${validSelection}))` : "";
    const after = selected.cursor ? "AND (created_at<? OR (created_at=? AND share_id<?))" : "";
    // The owner+schema+cursor proof and bounded metadata page are one statement,
    // including an empty-page sentinel, so absence cannot hide lost authority.
    const result: unknown = await env.DB.prepare(`WITH permitted AS (
      SELECT 1 AS permitted WHERE EXISTS(SELECT 1 FROM users WHERE user_id=? AND email=?) AND (${schema.sql}) ${cursorProof}
    ), page AS (
      SELECT CASE WHEN (${boundedId}) AND (${validSelection}) THEN 1 ELSE 0 END AS metadata_valid,
        CASE WHEN (${boundedId}) THEN share_id ELSE NULL END AS share_id,review_title,json_extract(selection_json,'$.output') AS output,
        json_extract(selection_json,'$.revision') AS revision,expires_at,issued_at,created_at
      FROM selected_output_shares WHERE ${selectedRows} AND EXISTS(SELECT 1 FROM permitted) ${after}
      ORDER BY selected_output_shares.created_at DESC,selected_output_shares.share_id DESC LIMIT ${pageSize + 1}
    ) SELECT permitted.permitted,page.metadata_valid,page.share_id,page.review_title,page.output,page.revision,page.expires_at,page.issued_at,page.created_at
      FROM permitted LEFT JOIN page ON 1=1 ORDER BY page.created_at DESC,page.share_id DESC`)
      .bind(principal.userId, principal.email, ...schema.bindings,
        ...(selected.cursor ? [...selectionBindings, ...selected.cursor] : []), ...selectionBindings,
        ...(selected.cursor ? [selected.cursor[0], selected.cursor[0], selected.cursor[1]] : [])).all();
    stable();
    const rows = readRows(result), hasMore = rows.length > pageSize, shown = rows.slice(0, pageSize);
    const response = json({ shares: shown.map(row => row.metadata), nextCursor: hasMore ? encodeCursor(shown.at(-1)!.cursor) : null });
    stable();
    return response;
  } catch (error) {
    return error instanceof Refusal ? json({ error: error.code }, error.status) : json({ error: "selected_output_share_unavailable" }, 404);
  }
}
