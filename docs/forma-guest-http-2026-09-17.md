# Dormant guest-session HTTP transport

This new module wraps the existing finite guest-session authority. No existing
router or installer imports it. It does not activate guest access, create an
account, install policy, generate content, make a claim, or change spending.

## Server-callable contract

`handleGuestSessionStart(request, env, { policyId })` receives a server-selected,
already reviewed custody policy ID. `handleGuestSessionRevoke(request, env)`
receives the two browser credentials. Neither handler accepts identity, policy
terms, payer, resource IDs or destination selection from the request body.

Both operations require POST, HTTPS, an exact matching Origin, no query or
fragment, and compatible Fetch Metadata when present. The wire body is exactly
`{"version":1}`, permitting JSON whitespace, with application/json and optional
UTF-8 charset. Duplicate keys, escaped property names, alternate numeric
spellings, byte-order marks, compressed bodies and extra properties fail closed. The body limit is
512 bytes and 1,024 stream chunks with a five-second total read deadline; abort and oversize cancellation
do not await a potentially stalled stream cancellation. Missing schema or policy
fails closed without installation.

Start returns HTTP 201 with `{version:1,status:"started",expiresAtMs}` only.
Independent `__Host-forma-guest-session` and `__Host-forma-guest-claim` cookies
contain a matching session ID and distinct purpose-bound random secrets. Both
use Secure, HttpOnly, Path=/, SameSite=Lax, no Domain, and an absolute Expires
derived from the native DB deadline. No Max-Age extends that deadline. The DB
clock and current policy remain authoritative. Final native proof and captured
DB checks precede cookie delivery; no tokens or internal IDs appear in JSON.

The server-only `readGuestClaimProofCookies(request)` parses the strict pair. It
is not authorization: later callers still need native current guest authority.
Duplicate, partial, mixed-session, wrong-purpose, quoted, encoded or oversized
guest cookies fail closed. Start refuses existing guest credentials; it never
silently replaces them.

Revoke calls the existing native revocation at most once and only clears both
cookies after confirming the exact proof-matched revoked row. A lost revocation
acknowledgment can be recovered read-only under the same currently valid reviewed
policy. Policy expiry or revocation prevents that acknowledgment recovery. This
does not delete context, creative bodies, accounts, lease history or financial
records. All responses use private/no-store, no-referrer and nosniff. Public
errors are closed and contain no caught exception or credential details.

## Explicit limits and later activation

Initial issuance has no request-ID or browser-bound idempotency record. Two
concurrent cookie-free requests may create different sessions within the policy
cap, and browser response order can replace their cookies. Losing the initial
response can consume a finite session slot without recoverable raw secrets.
There is no automatic issuance retry, implicit capacity refund or claim that this
transport solves those cases. Revocation and expiry do not replenish the policy's
all-time issuance count.

This increment does not qualify a real browser cookie jar, authentication return,
public route, deployed edge, OTP vendor or identity linkage. Later activation
requires separately reviewed route/installer and explicit operating terms. The
native context claim and retained-plan operations remain separate and dormant;
generated result/media custody remains incomplete. No full server-owned
generation architecture is a prerequisite for this transport.

## Qualification

Focused native fixtures use the real session primitives against SQLite and only
the three guest tables. Separate tests execute the lifecycle, concurrency cap,
expiry and revocation against actual local workerd D1. Synthetic policies and
credentials exist only in disposable fixtures. No provider/network, media,
account or financial operation is permitted. This evidence does not represent
production activation or a physical-device/browser acceptance test.
