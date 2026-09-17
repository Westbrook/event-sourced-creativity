# Dormant sponsor entitlement foundation

This implements a local, executable foundation for the original mini-app plan's
“Low authentication without an open spending endpoint” requirements. It does
**not** enable a sponsored or guest journey. Existing signed-in personal admission
and same-Document custody are unchanged.

The original proposal permits a conservative first beta that verifies identity
before all paid generation. This slice accepts an existing canonical Forma
principal owning a personal Document and a distinct sponsor payer. A guest actor
is explicitly refused with `sponsor_guest_custody_not_integrated`. Email strings,
email verification and policy configuration cannot create canonical identity or
grant access to a Document.

## Implemented, with a closed runtime boundary

- `worker/experience-sponsor-policy.ts` defaults to disabled. The only other
  accepted policy mode is `candidate`, describing review material. There is no
  environment flag, policy loader, sponsor enrollment, grant issuer or endpoint.
  Unknown fields and malformed values fail closed. Compiled envelopes are copied
  and frozen before asynchronous hashing.
- Exact bindings cover creative actor, session digest, distinct payer, campaign,
  policy and approval receipt; app, recipe and release; same Project/Document and
  source revision; ordered source asset digests and rights evidence; output count,
  duration and dimensions; provider/model/route, compiled input, settings and
  transfer-envelope digests; parsing/planning/render/repair calls, tokens and
  maximum cost; lifetime and unique consumption/intent identity. For 3D, the
  compiling integration must digest the full exact provider payload and asset
  transfer envelope, including image order, geometry/material/texture settings
  and add-ons. A digest is an identity commitment, not permission or proof that
  this integration already exists.
- `worker/experience-sponsor-entitlement.ts` exports an **unregistered** schema
  and SQL transaction plan. Campaigns and grants default to disabled. No function
  executes SQL, creates a reservation, issues a capability or dispatches a job.
- Entitlement consumption uses only the database transaction clock and checks the
  exact issued grant and policy. The API refuses caller-supplied clocks, which
  otherwise could advance a short-window cutoff. It enforces the shared campaign admission/cost ceiling, actor
  lifetime count within that campaign, campaign and actor short-window counts,
  unique intent/grant/consumption/job identities, and one active sponsored job per
  principal across campaigns and outputs.
- The final transaction assertion requires matching native plan, execution grant,
  slot, job, sponsor-owned token/cost reservations and a private command-envelope
  marker binding this exact entitlement. With missing or mismatched native rows,
  entitlement statements fail and roll back. This assertion proves an exact
  admission exists, not that its rows were inserted in the same transaction;
  atomic composition remains the integrating caller's responsibility. Existing
  native admission does not create that marker or authorize a
  distinct sponsor payer, so no current route can activate the candidate.
- Replays return an internal locator for the original job; changed content under
  the original intent conflicts. The consumption record is immutable and retained
  through expiry, cancellation, failure or uncertain submission. There is no
  automatic refund or active-slot release helper.

These are campaign **entitlement ceilings**, not charged amounts, invoices,
financial balances or financial holds. Existing token/cost reservations and
settlement remain the sole financial authority. This module neither reconciles
nor changes an existing financial hold.

## Required integration before any launch

1. Obtain applicable user and sponsor approval for a concrete policy: actual
   sponsor/payer principal and auditable sponsor consent, admitted audience,
   allowed exact recipes, total and per-person allowances, short windows, dates,
   retention and shutdown owner. The deployment owner reviews the integration
   and activates only that approved policy; deployment responsibility does not
   authorize choosing financial commitments, a sponsor, allowances or audience.
   This change selects none of these values. Test fixture identifiers and
   numbers are synthetic and must never become defaults.
2. Implement a server-owned issuer and narrowly authorized database migration.
   Validate current canonical identity, consent, admission eligibility and exact
   source/asset/provider-transfer rights. Hashes of evidence do not replace these
   checks. Include commit-time live authority, source and rights assertions from
   the existing native admission path; an old matching plan alone is insufficient.
3. Review the native envelope version and sponsor payer integration. In one
   `DB.batch`, compose existing source/authority guards, canonical events and
   immutable command receipt, native grant/slot/job, existing financial
   reservations, and the complete entitlement plan. Use the durable native job
   as the execution queue, or add a transactional outbox for an external queue.
   Never execute fragments independently or dispatch before the commit.
4. Read the scoped replay index before a new transaction and after an ambiguous
   acknowledgment/competing write. Resolve the original digest before considering
   fresh allowance. Current principal/session/Document read authority must still
   gate disclosure. The locator helper itself does not authenticate the caller.
5. Establish bounded intake/storage/upload/parsing authority and request, polling,
   download, account-linking and any email-code rate limits. Apply secure session
   cookies, CSRF/origin checks, server-validated risk signals and a tested campaign
   kill switch. Setting `enabled=0` stops new entitlement consumption; stopping
   already queued/running paid calls requires integration with native controls.
6. Add a reviewed terminal active-slot release tied to native completion and
   reconciliation. Never infer release or replenishment from a browser failure,
   timeout, local cancellation or unresolved provider receipt. Used entitlement
   is cumulative; a later active-slot release does not refund it.
7. For an anonymous or newly passwordless audience, implement verified account
   linking and guest custody first: exact guest-Document proof, claiming lease,
   verified private/media manifest staging, atomic ownership/manifest commit and
   guest-authority revocation, idempotent same-principal claim, competing-claim
   denial and the original same-Document route. No public share or matching email
   is claim authority. Also implement approved guest expiry/deletion and explicit
   output-only sharing before advertising them.

The broader server-owned creative generation architecture remains separately
deferred. This foundation requires an atomic durable native admission boundary,
which already exists; it does not require adopting that broader architecture.

## Proposed policy decision for review

Prefer the original plan's early-authentication beta, restricted to already
admitted canonical principals and explicitly selected recipes. Keep anonymous
spending disabled. The user and authorized sponsor still need to approve the
actual payer, consent/approval owner, audience, exact campaign and per-principal
limits, allowed recipes and retention policy. The deployment owner reviews and
applies those approved values. No real payer, monetary allowance,
audience membership or data-sharing permission is inferred by this proposal.

## Validation boundary

`tests/experience-sponsor-entitlement.test.mjs` directly imports complete modules
and executes their actual schema and SQL in disposable SQLite. It checks disabled
defaults, closed contracts, mutation-safe hashing, replay/conflict, shared quota,
principal-wide active slots, transaction-time expiry/revocation, native mismatch,
rollback, lost acknowledgment and preserved uncertain-spend history. Prepared
contenders commit sequentially on one SQLite connection; this is deterministic
competing-admission coverage, not a deployed D1 concurrency qualification. Native
admission and financial records in this suite are explicitly synthetic seams.
These tests establish the dormant primitives' invariants; they do not qualify
live identity, OTP, guest claim, actual sponsor billing, deployment or any new
provider journey. No network call, production database operation or financial
mutation is performed.
