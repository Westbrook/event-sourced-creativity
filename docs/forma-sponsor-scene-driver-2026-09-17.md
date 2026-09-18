# Dormant Scene V6 issuer and foreground driver

This slice starts with an actor-owned, canonical Scene Document and its already
confirmed native plan. It adds an actual server issuer and two explicit internal
foreground calls. It uses the accepted Scene V6 recipe, native source/version
handoff, original Run, provider dispatch and original-payer settlement.

The new modules export no schema initializer and have no registered route,
scheduled work or production campaign. Importing them does not activate a
sponsored product. Initial sponsored draft storage, passive status/results,
retained-read aliases, exports and recovery remain outside this slice.

## Actor command boundary

`prepareSponsoredSceneDriver(request, env, context)` accepts exactly action
`prepare-sponsored-scene`, campaignId, documentId, planRevisionId, targetId and
intentKey. It authenticates the actual canonical principal, requires current
real V6 payer approval and issuer membership, and checks the exact personal
Document, confirmed plan and sole native Scene target. It does not infer a
campaign, payer, model, budget or source from client overrides.

The call commits the immutable driver intent with its actual Resource V1
text-intake statements, then atomically owns the preflight stage and preflight
resource receipt before calling the real native preflight command. It returns
only the selected identity, policy digest, payer ID, original native quote
id/terms/maximum/expiry and original Scene cost preview. Input is capped at
8 KiB and projected output at 64 KiB.

`driveSponsoredScene(request, env, context)` accepts the same selection with
action `run-sponsored-scene`, reviewedPolicyDigest, preflightId, termsDigest,
maximumMicrousd, explicitAuthorization=true and the actor's exact
sceneCostConsent. The actor must have deliberately confirmed the returned native
preview. Production code never synthesizes `{confirmed:true}`. This second
action explicitly requests authorization and foreground Run of that original.

The immutable intent retains the original prepare wire. The authorize stage and
issuance row retain the later actor confirmation. Same-intent changes conflict;
native command keys, original revisions, timestamps and quotes are preserved on
replay. Requests, native AbortSignals, environment/DB identities, principal,
source and provider configuration are guarded across asynchronous boundaries.

## Genuine issuance and execution

The issuer uses the existing `loadApprovedSponsorSceneCampaign` and exact
approved V6 policy. A fresh native Scene admission preparation owns the real
version-bearing preflight proof. The existing Scene descriptor/template matcher
and V6 compiler derive the envelope from that proof and retained native quote.
The issuer commits the exact grant, Resource V1 issuance statements and immutable
issuance receipt in one guarded transaction, then creates the genuine admission
authority consumed by `outputExperienceCommands.executeSponsored`.

The driver persists the exact original Run stage, obtains a native Run
preparation using the retained job-source successor, creates execution authority
and invokes `executeSponsoredRun`. That native write advances the witness. The
driver therefore reloads and obtains another genuine Run preparation bound to
the stored successor before calling `runDocumentJob`. It never substitutes the
payer for the creative actor. Existing financial authority selects the original
payer. Detached `waitUntil` work is refused.

After current approval, source, intent and original receipt proof, the driver
returns only jobId, status and replayed. This bounded foreground acknowledgment
is not a public polling/result service.

## Accounting and replay

Let N be UTF-8 bytes of the canonical existing Document snapshot. A fresh
successful intent records exactly three Resource V1 operations and 3N text
bytes: text-intake, preflight, issuance. Both campaign and actor lifetime/window
counters and maximumOperationTextBytes apply. Limits come from the reviewed
policy; there is no fallback allowance. Issuance checks pending-grant capacity
after inserting its exact grant. Existing native admission and financial claims
continue to enforce monetary, admissions and inflight-job limits.

The preparation receipts use the selected driver intent; issuance uses its
stable native authorize intent and exact envelope digest. Original receipts
bind these identities explicitly. Replay proves original receipts and current
resource authority without another debit or a requirement for unused allowance.
Failed native admission does not refund work already consumed. Final job disclosure
repeats current resource authority and the exact three original receipt predicates
without inserting receipts or requiring spare capacity. Its return guard includes
the original resource and grant deadlines.

A committed preflight ticket without its durable native receipt is unknown.
The driver cannot repeat the protected preflight or mint a replacement intent
automatically. A missing, redacted or conflicting authorization receipt cannot
be converted into reissuance. An admitted replay proves the original native
authorize envelope, issuer/resource receipt and exact native grant/slot/job/
consumption/routes. It returns inert original receipt data without calling the
Scene admission factory or recapturing a source baseline. Continuing Run uses
only the accepted stored-successor native Run boundary. Execution expiry never
renews consent or grants a replacement purchase.

Resource V1 meters these semantic preparation and issuance operations. It does
not fund unlimited repeated proof queries, response/ACK bytes, public replay
traffic, initial draft storage or passive reads. These dormant functions add no
new policy family or public capability. Existing `canonical-scene-screenplay@1`,
Resource V1 and Scene cost-confirmation bytes remain unchanged.

## Qualification boundary

The new fixture creates actual registered authored Scene intake/commit and native
save/confirm only, then real synthetic payer approval from stable native review
material. It asserts that preflight, driver, resource, issuance, grant, native
job, reservation and provider-call rows start empty. The production modules must
create those records. Synthetic actor confirmation appears only in test code.

The driver validates the exact current Scene confirmation before claiming its
immutable authorize stage. A rejected confirmation can be corrected on the same
prepared intent. Data-only loaders and native preflight retain per-operation
Request, AbortSignal and environment lifetime checks; native admission and Run
capabilities retain their actual environment identity.

Qualification is ordered: independent complete source/test review; first
connected native positive plus replay; targeted authority, transaction, source,
consent and lost-acknowledgment cases; then bounded actual local workerd D1
composition. Accepted V6 execution suites and eight live journeys are reused.
All provider responses are synthetic and the only permitted asset is the
existing local bundled Scene font. No real provider, customer campaign or
financial account is used.

Every new SQL statement must satisfy strict32 function arguments, depth100,
100 parameters and 100,000 SQL bytes. The unchanged native metadata query alone
retains its exact SHA-256 exception
`87984dc31fc80df29511e79e97c2d1f59ce7e1c5324781951a3cb486f96d1a41`
at 56 arguments. Node-hosted qualification and actual workerd D1 evidence are
reported separately. There is no blanket64 exception.

Implementation/qualification status and immutable source pins are recorded in
the separate `scene-v6-issuer-driver-evidence-20260917` packet. This document
defines the behavior and qualification boundary; it is not itself a passing
test receipt, activation or publication claim.
