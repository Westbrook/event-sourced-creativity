# Dormant selected Story read adapter

This increment implements an internal finite read boundary for the original
canonical owner's retained sponsored Short Story. It does not activate the
existing HTTP reader. Automatic approval review rejected that integration;
`worker/retained-story-api.ts` remains unchanged. Direct adapter qualification
and HTTP route integration are separate acceptance claims.

The original generation is still the V4 `canonical-short-story@1` contract.
Reading requires a separately reviewed `canonical-short-story-io@1` allocation
from its original payer. Generation need not remain active for an owned read.
The adapter adds no generation, recovery, provider access, purchase, guest claim,
new recipient, or shared-content permission.

## Native composition

`experience-sponsor-native-story-read.ts` classifies the selected original
completion using bounded control metadata before protected native history or
content is read. It joins the original job, slot, grant, and retained consumption
to the existing completion. A sponsorship marker overrides ordinary scope or
context labels; damaged or ambiguous originals refuse. An independent indexed
outcome-to-consumption lookup prevents a broken job correlation from converting
the original into an ordinary read.

Positively ordinary selections keep a negative sponsorship witness. That
witness is checked in the same final transaction as native custody so an
ordinary classification cannot survive a new sponsorship association before
disclosure. The bounded fallback uses the existing stream/type index and the
native reader's maximum 512 completion events when the shared sponsor
consumption relation is absent or empty. Unrelated Jobs do not impose a new
actor-wide Job-count limit on an ordinary Story.

The classifier nevertheless has an index dependency before full actor
classification: any nonempty shared sponsor consumption relation requires the
exact `idx_sponsor_story_actor_history` definition, including when all its rows
belong to another actor. Any consumption belonging to the requesting actor,
including Image sponsorship, also requires the exact
`idx_sponsor_story_outcome_lookup` definition. Selected artifact lookup is the
third dormant index definition. No production initializer installs these
indexes. The fixture installs all three, so neither the ordinary direct tests
nor actual D1 qualification proves compatibility for a mixed installation with
nonempty Image consumption and missing Story indexes. General ordinary
compatibility without these indexes is not an accepted claim. The unused
dormant modules do not change existing live ordinary reads.

The core `identifySponsorStoryRead` proof and separately approved IO attempt
remain bound to the same Request, environment, database, and original actor.
The native adapter reserves and takes `short-story-result` before protected
native reads. It accounts actual serialized classifier and ticket control
receipts, rather than assigning an assumed free allowance.

`experience-sponsor-story-read-budget.ts` reuses the actual
`readNativeRetainedPrincipal`, `readNativeRetainedSelection`, and
`readNativeRetainedContent` query forms. It does not call the stricter
sharing-specific `readNativeRetainedTextCustody` helper. Its closed SQL allowlist
rejects unknown statements, raw reads, writes, and generic query fallback.
SQLite computes the complete escaped JSON row-array byte size; body rows cross
the SQLite-to-Worker boundary only when the aggregate fits the remaining
attempt. Exact metrics and gated body queries share a single native batch.
Fixed bounded D1 receipt overhead and the actual returned receipts are included.

Final disclosure checks the unchanged native principal/history/content proof
alongside every original-lineage, IO approval, attempt, and classification
assertion in one acknowledged D1 batch. NULL or missing proof results refuse.
Starting a final check does not authorize response access: successful validated
completion is a separate state. Original Request, DB, abort, and monotonic
deadline checks apply before and after awaits and on each response pull.

The selected DTO retains the existing title, Markdown, exact revision/hash, and
expiry. The legacy `/api/retained-story/jobs/...` contract is manual one-item
generation and does not accept the sponsored native three-item ancillary
contract. Known sponsored requests to that legacy handle refuse before the
legacy completed-job reader. No legacy generation grammar is widened.

## Qualification and review history

All 28 direct qualification tests pass under plain `node --test`, with no
skipped cases. Full TypeScript checking and focused ESLint also pass. The
strict local SQLite pass compiles 44 statement shapes, at most 27 bindings,
expression depth 100, function arguments 32, parameters 100, and SQL bytes
100,000. That local SQLite qualification remains separate from the actual D1
result below.

The actual local Miniflare/workerd D1 direct qualification passes 1/1 on the
final production-module pins. Node-hosted production functions execute against
the loopback D1 engine; this is not bundled Worker or HTTP-route qualification.
The genuine synthetic C generation completes before its exact native rows are
exported. D1 begins with empty IO policy/approval/attempt tables and performs
real disposable payer preparation and approval, classifier/core provenance,
IO reservation and take, retained principal/selection/content reads, native
final proof, bounded response, and passive completed status.

The run covers 49 strict SQL shapes and 241 executed statements, at most 27
bindings and 18,935 SQL bytes. Replacing one final sibling with actual D1 FALSE
or NULL refuses while the native proof and all other siblings remain admitted.
Four immutable attempts remain charged. Passive status accounts for the exact
27,442 bytes of complete D1 control receipts. All native creative and financial
rows match their pre-read snapshots. The donor generation uses one synthetic
response; the read run makes zero external provider or media requests. These
snapshot checks establish the final stored rows for this fixture, not a general
proof against transient writes. The final validation receipt is
`/private/tmp/forma-sponsor-story-read-d1-final-validation.json` (SHA256
`a9e3e40282336e14a8774fe9345e31ab652fd01419d92d2d537c5385dbf4d2f2`).
It links the engine evidence, passing log, independent review, and stable
18-file source snapshot, including final IO attempt source
`673658fd87f9d7f9bfc9b10209e397ae80305af709dc264686b9f53d20561d51`.
The identical D1 group was rerun once for this stricter attempt guard; the prior
passing receipt `9b9d99bdc49499c6256ee7e049cfcad3d68e6174404be81ebbab458ef82daf74`
remains evidence for its earlier source. The native evidence packet retains
both runs separately.

The fixture uses the actual C driver,
native issuer and runner, one intercepted synthetic Story response, real
disposable payer approvals, and original retained JSON. The fixture never
imports a test module or seeds a completion, grant, or read attempt. App-recorded
synthetic accounting is not a provider invoice.

Initial source review found and repaired marker precedence, invalid identifiers
being mistaken for absent slot rows, the unrelated actor-wide 512-Job limit,
broken original job correlation, and response access while final proof was
pending or failed. The first review is retained separately from final review.
The first direct run passed 22/24; two fixture project-scope mutations failed
the existing schema CHECK before reaching the classifier. The fixture was
corrected, the affected cases and complete 24-case suite passed, then two
targeted classification regressions increased that suite to 26. A sibling
plain-Node import exposed unsupported constructor parameter-property syntax;
the equivalent explicit field initialization now passes without type-transform
flags. The historical logs remain available.

Subsequent cross-module review found that array iteration skipped a missing
nonzero final acknowledgment. Both sponsored and ordinary direct regression
tests failed before repair even though the real final SQL batch had succeeded:
deleting one returned proof receipt while retaining the array length incorrectly
passed validation. The local guards now require every own numeric index,
defined receipt, own successful acknowledgment, and exact dense scalar proof
row. The gated metric/body batch also rejects sparse receipts explicitly. The
two new groups cover holes, explicit undefined values, and primitive receipts;
all 28 tests and final type/lint checks pass. Independent review accepted the
repair. The earlier 26-case acceptance is preserved as incomplete coverage,
along with the original two-failure reproduction and pre-repair source copies.

Independent source and test reviews accepted the final dormant modules. Test
financial snapshots cover monetary, provider, and consumption relations; they
do not establish complete creative-row or Job immutability. These checks do not
prove HTTP dispatch or final DTO delivery. No accepted live-provider journey
was repeated.

The coordinating owner's related direct qualifications remain distinct counts:
the final IO policy suite has 78 passing cases, superseding its initial 32-case
coverage with acknowledgment and Request-consistency repairs. The core retains
15 historical cases plus two current targeted groups covering seven malformed
witness forms. The initial core
query referred to nonexistent `route.maximum_microusd` and failed against the
actual C fixture. Its corrected route proof uses the native stage, provider,
model, and maximum-call fields; monetary caps remain proved by the original
slot, execution, consumption, and issuance envelope. The initial attempt
implementation counted only result rows. It was corrected to include complete
returned D1 envelopes, changing the observed control receipt from 18,930 to
19,698 bytes. Its exact-byte strict regression and seven targeted missing-ACK
cases pass; the original 23-case attempt history is preserved. A later review
found inherited and non-data acknowledgment or immutable receipt fields could
pass. The final attempt guard requires own enumerable data fields. Its 28
targeted checks pass; the 19 inherited-field failures and two non-data-field
failures remain historical evidence. Earlier sparse acknowledgment reviews are
retained as incomplete coverage, not substituted for the final checks. These
related counts are not added to the 28 native-adapter cases as if they were one
nonoverlapping suite.

The first D1 launch was denied loopback listen access before engine
qualification; an explicit loopback-only escalation was subsequently approved.
The actual D1 test's initial schema oracle compared Node SQLite null-prototype
rows with D1 plain objects and failed before product qualification. A reviewed
test-only normalization preserves every schema field and row order; the
original failure and corrected final pass remain separate artifacts.

A separate Story A collector-abort diagnosis belongs to another workspace and
is not represented as implemented or qualified by this selected-read increment.

## Unapplied integration

The exact proposed handler patch is retained outside the repository at
`/private/tmp/forma-story-retained-read-unapplied-20260917.patch`, SHA256
`44be6c0e41da5d1a6bda37d6747e33182905291d61606882afcc3f63d75a3d4b`.
The approval-review rejection and concrete payload/destination boundary are
recorded at `/private/tmp/forma-story-retained-read-hook-refusal-20260917.json`.
The draft HTTP cases are preserved separately at
`/private/tmp/forma-story-native-http-tests-unapplied-20260917.mjs`; they were not
run and are not counted as accepted coverage.

Automatic review stated: “This patch activates a new sponsored Story read path
in the live retained-story API, potentially disclosing private retained content
and broadening data-sharing permissions without explicit authorization for
that payload and destination.” The patch was not retried through another tool
or copied handler. Root must obtain explicit authorization for that exact
same-owner selected-JSON integration before applying and qualifying it.

The held hook also requires exact index definitions to be verified or provisioned
under applicable authorization, followed by explicit unrelated-actor and
Image-consuming-actor compatibility tests. These checks must cover nonempty
shared consumption with the Story indexes missing and with the required indexes
present. No production schema or index installation was authorized or performed
by this increment. This is a publication prerequisite for activating the held
hook, not a blocker for sealing the unused dormant leaves.

This increment does not protect broad event/history/artifact aliases, implement
initial intake storage, change guest claims, install schemas, approve live
campaigns, or qualify physical-device behavior. Those scopes remain with their
existing owners. The broader server-owned generation architecture is not made
a prerequisite by this read adapter.
