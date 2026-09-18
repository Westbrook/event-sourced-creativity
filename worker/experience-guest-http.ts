import { canonicalJson } from "../src/experiences/compiler.ts";
import { GUEST_DB_NOW, guestFail, guestPolicy, guestSession, guestTokenHash, issueGuestClaimSession, revokeGuestClaimSession, type GuestClaimProof } from "./experience-guest-session.ts";
import type { WorkerEnv } from "./runtime.ts";

// Dormant server-callable transport. No router, identity, schema or policy
// installer imports this module. Its caller selects an already reviewed policy.
const sessionCookie = "__Host-forma-guest-session", claimCookie = "__Host-forma-guest-claim";
const uuid = "[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}";
const cookiePattern = (purpose: "session" | "claim") => new RegExp(`^v1\\.(${uuid})\\.(forma-guest-${purpose}-v1\\.[a-f0-9]{64})$`, "u");
const encoder = new TextEncoder();

function cookieProof(request: Request): GuestClaimProof | null {
  const header = request.headers.get("cookie") ?? "";
  if (encoder.encode(header).byteLength > 8192) return guestFail("cookies_invalid");
  const values = new Map<string, string>();
  for (const part of header.split(";")) {
    const separator = part.indexOf("="), name = (separator < 0 ? part : part.slice(0, separator)).trim();
    if (name !== sessionCookie && name !== claimCookie) continue;
    if (separator < 0 || values.has(name)) return guestFail("cookies_invalid");
    values.set(name, part.slice(separator + 1).trim());
  }
  if (values.size === 0) return null;
  const session = values.get(sessionCookie)?.match(cookiePattern("session"));
  const claim = values.get(claimCookie)?.match(cookiePattern("claim"));
  if (!session || !claim || session[1] !== claim[1]) return guestFail("cookies_invalid");
  return Object.freeze({ sessionId: session[1]!, sessionToken: session[2]!, claimToken: claim[2]! });
}

/** Server-only proof extraction. Never return this object in a response, URL or
 * log; callers still need native guestSession/current mutation authority. */
export function readGuestClaimProofCookies(request: Request): GuestClaimProof {
  return cookieProof(request) ?? guestFail("proof_unavailable");
}

function reply(body: Record<string, unknown>, status: number, cookies: string[] = []) {
  const headers = new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store",
    "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" });
  for (const value of cookies) headers.append("set-cookie", value);
  return new Response(canonicalJson({ version: 1, ...body }), { status, headers });
}
const denied = (error: string, status: number) => reply({ status: "unavailable", error }, status);

async function envelope(request: Request): Promise<Response | null> {
  if (request.signal.aborted) return denied("request_invalid", 400);
  if (request.method !== "POST") return denied("method_not_allowed", 405);
  const url = new URL(request.url), site = request.headers.get("sec-fetch-site");
  if (url.protocol !== "https:" || url.username || url.password || request.headers.get("origin") !== url.origin
    || (site !== null && site !== "same-origin" && site !== "none")) return denied("same_origin_required", 403);
  if (url.search || url.hash) return denied("request_invalid", 400);
  const type = request.headers.get("content-type") ?? "", declared = request.headers.get("content-length"), coding = request.headers.get("content-encoding");
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?\s*$/iu.test(type)
    || (coding !== null && !/^identity$/iu.test(coding))
    || (declared !== null && (!/^(?:0|[1-9][0-9]*)$/u.test(declared) || Number(declared) > 512))) return denied("request_invalid", 400);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try { reader = request.body?.getReader(); } catch { return denied("request_invalid", 400); }
  if (!reader) return denied("request_invalid", 400);
  const chunks: Uint8Array[] = []; let length = 0, count = 0;
  let timeout: ReturnType<typeof setTimeout> | undefined, abort: (() => void) | undefined;
  const stopped = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error("body_deadline")), 5000);
    abort = () => reject(new Error("body_aborted"));
    request.signal.addEventListener("abort", abort, { once: true });
    if (request.signal.aborted) abort();
  });
  try {
    for (;;) {
      const item = await Promise.race([reader.read(), stopped]); if (item.done) break;
      length += item.value.byteLength; count++;
      // Also bound continuously ready empty chunks, which otherwise need not
      // yield an event-loop turn for the read deadline to fire.
      if (length > 512 || count > 1024) { void reader.cancel().catch(() => undefined); return denied("request_invalid", 400); }
      chunks.push(item.value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    if (!/^[\x20\t\r\n]*\{[\x20\t\r\n]*"version"[\x20\t\r\n]*:[\x20\t\r\n]*1[\x20\t\r\n]*\}[\x20\t\r\n]*$/u.test(text)) return denied("request_invalid", 400);
    const raw = JSON.parse(text) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).length !== 1 || !("version" in raw) || raw.version !== 1) return denied("request_invalid", 400);
    return null;
  } catch { void reader.cancel().catch(() => undefined); return denied("request_invalid", 400); }
  finally { clearTimeout(timeout); if (abort) request.signal.removeEventListener("abort", abort); reader.releaseLock(); }
}

function deliveryCookies(proof: GuestClaimProof, expiresAtMs: number) {
  const suffix = `; Path=/; Secure; HttpOnly; SameSite=Lax; Expires=${new Date(expiresAtMs).toUTCString()}`;
  return [`${sessionCookie}=v1.${proof.sessionId}.${proof.sessionToken}${suffix}`, `${claimCookie}=v1.${proof.sessionId}.${proof.claimToken}${suffix}`];
}
const clearCookies = () => [sessionCookie, claimCookie].map(name => `${name}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`);

/** Issues once. There is no automatic retry or recovery of lost raw secrets.
 * Existing cookies refuse replacement; concurrent cookie-free starts are still
 * distinct issuances under the native finite policy ceiling. */
export async function handleGuestSessionStart(request: Request, env: WorkerEnv, options: Readonly<{ policyId: string }>): Promise<Response> {
  const db = env.DB, invalid = await envelope(request); if (invalid) return invalid;
  try {
    if (env.DB !== db || request.signal.aborted || cookieProof(request)) return denied("guest_session_unavailable", 409);
    const issued = await issueGuestClaimSession(request, env, options.policyId);
    if (env.DB !== db || request.signal.aborted) return denied("guest_session_unavailable", 409);
    const proof = Object.freeze({ sessionId: issued.sessionId, sessionToken: issued.sessionToken, claimToken: issued.claimToken });
    const current = await guestSession(env, request, proof);
    if (env.DB !== db || request.signal.aborted) return denied("guest_session_unavailable", 409);
    const confirmed = await db.prepare(`SELECT expires_at_ms FROM experience_guest_sessions WHERE session_id=? AND (${current.guard.sql})`)
      .bind(issued.sessionId, ...current.guard.bindings).first<{ expires_at_ms: number }>();
    if (env.DB !== db || request.signal.aborted || !confirmed || confirmed.expires_at_ms !== issued.expiresAtMs
      || !Number.isSafeInteger(confirmed.expires_at_ms) || confirmed.expires_at_ms <= 0 || confirmed.expires_at_ms > 8_640_000_000_000_000) return denied("guest_session_unavailable", 409);
    return reply({ status: "started", expiresAtMs: confirmed.expires_at_ms }, 201, deliveryCookies(proof, confirmed.expires_at_ms));
  } catch { return denied("guest_session_unavailable", 409); }
}

async function confirmedRevocation(request: Request, env: WorkerEnv, db: WorkerEnv["DB"], proof: GuestClaimProof): Promise<boolean> {
  if (env.DB !== db || request.signal.aborted) return false;
  const hashes = await Promise.all([guestTokenHash(proof.sessionToken, "session"), guestTokenHash(proof.claimToken, "claim")]);
  const row = await db.prepare(`SELECT policy_id,terms_digest FROM experience_guest_sessions WHERE session_id=? AND session_hash=? AND claim_hash=? AND revoked_at_ms IS NOT NULL AND revoked_at_ms<=${GUEST_DB_NOW}`)
    .bind(proof.sessionId, ...hashes).first<{ policy_id: string; terms_digest: string }>();
  if (env.DB !== db || request.signal.aborted || !row) return false;
  const policy = await guestPolicy(env, request, row.policy_id);
  if (env.DB !== db || request.signal.aborted || row.terms_digest !== policy.row.terms_digest) return false;
  const current = await db.prepare(`SELECT 1 AS present FROM experience_guest_sessions WHERE session_id=? AND session_hash=? AND claim_hash=? AND policy_id=? AND terms_digest=? AND revoked_at_ms IS NOT NULL AND revoked_at_ms<=${GUEST_DB_NOW} AND (${policy.guard.sql})`)
    .bind(proof.sessionId, ...hashes, row.policy_id, row.terms_digest, ...policy.guard.bindings).first<{ present: number }>();
  return env.DB === db && !request.signal.aborted && current?.present === 1;
}

/** Clears transport credentials only after native revocation is confirmed. A
 * proof-matched revoked row recovers a lost acknowledgment under current policy;
 * no creative content, account, lease history or financial row is deleted. */
export async function handleGuestSessionRevoke(request: Request, env: WorkerEnv): Promise<Response> {
  const db = env.DB, invalid = await envelope(request); if (invalid) return invalid;
  try {
    const proof = readGuestClaimProofCookies(request);
    if (env.DB !== db || request.signal.aborted) return denied("guest_session_unavailable", 409);
    if (!await confirmedRevocation(request, env, db, proof)) {
      if (env.DB !== db || request.signal.aborted) return denied("guest_session_unavailable", 409);
      try { await revokeGuestClaimSession(request, env, proof); } catch { /* Resolve only the original revoked row, never retry mutation. */ }
    }
    if (env.DB !== db || request.signal.aborted || !await confirmedRevocation(request, env, db, proof) || env.DB !== db || request.signal.aborted) return denied("guest_session_unavailable", 409);
    return reply({ status: "revoked" }, 200, clearCookies());
  } catch { return denied("guest_session_unavailable", 409); }
}
