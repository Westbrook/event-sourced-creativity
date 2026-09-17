# Dormant sponsor admission foundation

This implements part of the original mini-app proposal's “Low authentication
without an open spending endpoint” requirements. It does **not** launch sponsored
or guest generation. The original proposal permits verification before every paid
call for a conservative beta. This slice accepts an existing canonical principal,
a personal Document owned by that principal, and a distinct approved sponsor
payer. Guest custody and anonymous spending remain unsupported.

## Runtime boundary

The default policy remains `disabled`; `candidate` describes a closed review
contract. Sponsor modules can be imported transitively by the Worker, but no
registered route issues or passes a sponsor capability. There is no environment
switch, policy loader, enrollment/issuer endpoint, active sponsor migration or
campaign. An ordinary request cannot select a financial owner through browser
fields. Registered output commands reject a `sponsor_entitlement` field.

`SPONSOR_ENTITLEMENT_SCHEMA` remains unregistered. Tests install it only in an
in-memory SQLite fixture. Campaign and grant rows default to disabled. Synthetic
fixture payers, approvals, audiences and allowances are never runtime defaults.
No production database, provider, email, financial hold or permission was changed.

## Implemented native admission

- Closed policy/envelope contracts bind actor, distinct payer, campaign, policy
  and approval receipt; app/recipe/release; Project/Document, source revision,
  ordered assets and rights; exact provider/model/route/settings/transfer digests;
  dimensions, output count, calls, tokens, maximum cost, lifetime and intent.
  Compiled data is copied and frozen before hashing. Digests identify evidence;
  they do not themselves confer source or financial authority.
- The first qualified native mapping is **one original text-only Image target**,
  with zero references. It derives the exact retained native planning and image
  calls (one `planning:initial`, one `image:initial`), settings, route, size and
  caps. Other output/input modes, alternate attempts, project/fictional accounts,
  managed pilots and derived organization budgets fail closed. This qualification
  does not choose a launch recipe or establish seven other sponsored journeys.
- A module-private WeakMap capability binds the original Request, environment and
  database, independently read existing canonical principal, exact personal scope,
  source/context/rights snapshot, immutable command, issued grant and stored policy.
  The misleadingly generic envelope name `sessionDigest` is specifically a digest
  of the existing canonical principal and permission snapshot. It is **not** a
  separately issued login/guest session credential. The platform supplies current
  request authentication; no new cookie/session mechanism is claimed here.
- `executeSponsored` copies caller command and trusted data synchronously and
  validates the seal before command hashing and early replay. The immutable command
  marker includes payer, campaign, policy, consumption and envelope identity.
  Forged/cloned/cross-request seals, changed source proofs, changed command/payer,
  and revoked authority cannot use an existing receipt to bypass validation.
- The real `authorizePlan` and native Document preparation retain creative actor,
  source access, stream, Document/job ownership, private receipts and source guards.
  Only explicit financial preparation uses the sealed payer. No `PilotUser`
  impersonation or `billingUserId` override is introduced. Sponsor readiness reads
  reuse existing effective budget limits without initializing counters or exposing
  sponsor balances/utilization in the actor response. Native schema initialization
  is still part of existing entry points; this proves no **financial** preparation
  writes, not unconditional zero database writes on a cold schema.
- One actual `DB.batch` composes live actor/payer/source/rights/campaign guards,
  canonical events, actor-owned private inputs, native grant/slot/job, sponsor-owned
  token and cost reservations/counter initialization, entitlement consumption,
  principal-wide active marker, immutable command receipt, and its final joined
  proof. Grant/slot stay `authorized`; the retained native job is `queued` but is
  not runnable. Zero-row financial/job writes and a missing receipt marker roll
  back the complete transaction. The raw native hex digests are normalized only
  at the explicit equality join with the envelope's `sha256:` digests.
- Entitlement ceilings enforce campaign total count/cost, campaign and actor
  rolling-window counts, actor lifetime count, unique intent/grant/consumption/job
  and one active sponsored job per principal across campaigns. Only the database
  transaction clock defines admission/window time. There is no caller clock.
- Exact replay and a lost commit acknowledgment locate the existing native receipt
  without another reservation/debit. New sponsored personal `run` and replayed
  `run` refuse with `sponsor_execution_not_enabled` before queue transition,
  cleanup or dispatch. Existing shared/organization execution semantics stay intact.

These are entitlement ceilings and application-recorded reservations, **not
provider invoices**. Consumption is immutable and cumulative. Failed, cancelled,
expired or uncertain work does not automatically refund entitlement or release
its active slot. The existing native financial ledger remains authoritative.

## Qualification and preserved findings

The earlier 29-test entitlement suite uses complete production policy/SQL modules
and real SQLite, but its native rows and financial counter are explicitly synthetic
seams. It proves the primitive quota, replay, clock, immutable-history and atomic
assertion invariants; it does not by itself prove native integration.

`tests/experience-sponsor-native-admission.test.mjs` now uses the actual native
handlers, `authorizePlan`, compiler/preflight, bridge, canonical source/custody,
financial helpers and production schema in disposable SQLite. Its 20 checks cover
successful sponsorship and ordinary actor payment; missing-counter no-write
preview and atomic initialization; depleted actor versus depleted sponsor;
seal/command/source tampering; campaign/payer-changing replay; lost acknowledgment;
run/resume refusal; unsupported mapping; and complete rollback at actor/payer
consent, source/campaign, token/cost reservation, native job and final receipt gates.
A fetch tripwire records zero network attempts. The resume test seeds an old run
receipt only to exercise the real refusal branch; product code cannot start it.

Review identified and repaired the primitive/native status and receipt-order
mismatch, raw-hex versus prefixed digest join, actual Image planning/render call
vector, abandoned asynchronous compiler rejection, and mutable command/source
capture seams. The first actual native admission test passed after those fixes.
The first expanded run retained a fixture failure: creating a second fixture payer
initialized its counters after the comparison baseline. Moving that explicit setup
before the baseline fixed the test; this was not an application defect. Historical
future-clock regression and earlier foundation receipts remain preserved.

These deterministic transactions do not qualify deployed D1 concurrency,
anonymous sessions, guest claim, sponsor execution/settlement, actual billing or
any new live-provider journey. The eight accepted personal live journeys remain
separate evidence. Ordinary admission reuse, shared native execution and selected
personal native transaction/replay tests provide changed-path compatibility.

## Remaining implementation versus launch decisions

The following code can proceed with disabled synthetic policies, without selecting
an actual payer, allowance or audience. Coordinate shared ownership before edits:

1. Add a persisted sponsor execution authority resolver from the immutable native
   marker and entitlement, preserving actor source/custody. Teach `runGrant` and
   its replay, native reservation handoff in `document-jobs-api.ts`, and
   `createOutputEventExecution` in `output-execution-control.ts` to use that sealed
   financial identity, recheck campaign/consent and exact route/call caps before
   each paid stage, and fail closed without actor fallback. Keep the route off
   until this chain is qualified. The present direct runner's actor-owner
   reservation guard also fails closed; it is not sponsor execution support.
2. Qualify payer-correct settlement, interrupted-work handling and known/uncertain
   receipt reconciliation. Current runner/financial/recovery sites often derive
   payer from `user.billingUserId ?? user.userId`; changing only the admission
   grant is insufficient. Preserve same-job/call identities, known spend and
   original actor outputs. Coordinate with the automatic-recovery owner for
   `output-execution-control.ts`, financial-checkpoint and recovery modules.
   Implement terminal active-slot release only after the native outcome and
   financial exposure are resolved; never replenish cumulative entitlement.
3. Implement the server-owned, narrowly authorized issuer/policy-loader/migration
   boundary and bounded intake/storage/upload/parsing, polling/download and
   account-link limits, CSRF/origin/risk checks, and campaign kill-switch behavior
   for queued/running work. These are original requirements beyond generation
   admission. A tested disabled issuer is possible before real launch values.
4. Qualify each additional output and input mode from its actual native contract,
   rights and transfer envelope. For image-reference 3D this includes ordered
   images, exact geometry/material/texture settings and add-ons. Do not generalize
   the Image mapping or its acceptance to these contracts.
5. For an anonymous/passwordless audience, implement bounded authentication and
   verified same-Document guest claim: guest possession proof, claiming lease,
   private/media manifest staging, atomic ownership commit, guest-authority
   revocation, idempotent same-principal claim, competing-claim denial and approved
   expiry/deletion/output-only sharing. Email equality is not custody authority.

Before activating a real policy, obtain applicable **user and sponsor approval**
for the actual payer and auditable consent, admitted audience, allowed recipes,
total/per-person/rolling-window allowances, dates, retention and shutdown owner.
The deployment owner reviews and applies only that approved policy; deployment
responsibility does not authorize selecting financial commitments. No real values
were inferred here. The proposed first launch choice is the original plan's
conservative early-authenticated beta; anonymous spending remains off.

Missing launch terms block activation, not the independent implementation above.
The broader server-owned creative-generation architecture remains explicitly
deferred. This work reuses an existing atomic native admission boundary and does
not make that broader architecture a prerequisite.
