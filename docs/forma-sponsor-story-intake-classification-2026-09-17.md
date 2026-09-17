# Dormant Story intake classification

This increment composes negative sponsorship checks for original Story intake.
It adds no public callsite, read capability, financial allocation, schema
initializer, or initial-intake storage operation. It is groundwork for D2,
not completed sponsored intake or permission to activate the held Story reads.

An ordinary Context does not become sponsored intake because a later Story
generation used a sponsor. The classifier has no Document, output job, plan,
generation-consumption, or event-history joins.

## Classification contract

`classifySponsorStoryIntakeDraft(request, env, draftId)` calls the unchanged
Image classifier and separately inspects a proposed Story intake sidecar.
Its results mean only:

- `ordinary`: both negative predicates must remain true at the actual native
  read, storage, commit, receipt, or fallback boundary.
- `story-sponsored`: a raw original Story sidecar exists and no Image sidecar
  conflicts. The ordinary path must refuse. This does not establish valid
  Story provenance or authorize a read.
- `sponsored`: preserve the existing Image classifier's refusal, including
  marker-only and unknown-family cases. This is not proof of Image authority.
- `unavailable`: failed, inconsistent, ambiguous, or expired classification
  cannot choose an ordinary or guest fallback.

The existing `sponsor_intake` marker is shared refusal evidence. A Story
sidecar with that marker is expected; actual rows in both sidecars conflict.
An erased body, invalid receipt field, foreign actor, or expired original
cannot make a raw Story sidecar ordinary. Invalid ordinary JSON without a
marker or sidecar is not itself sponsorship evidence.

## Source-free lookup boundary

The reserved table name is `experience_sponsor_story_intakes`. The accepted
lookup representation is a main `WITHOUT ROWID` table with a unique,
non-null `TEXT` primary key `draft_id`, using a sole ascending BINARY key.
Other future receipt columns are permitted. Catalog and lookup shape are
checked before the indexed scalar probe; `LIMIT 1` alone is not a work bound.
Views, partial or unsupported shapes, and conflicting declarations refuse.

This is a structural lookup contract, not the complete immutable storage
receipt schema. No table or index is installed. Synthetic test rows are
negative evidence only; they are not approved purchases or native receipts.

The new Story catalog aggregate is bounded in SQL before transport. The
imported Image catalog query stays byte-identical and is checked after its
existing metadata read; this increment does not claim a new pre-transport
bound for that inherited query.

The returned ordinary witness preserves the Image SQL and ordered bindings,
and adds the exact Story catalog/shape snapshot plus absence of a matching
row. The absent-table branch never references that absent table. Story or
Image association, a marker, or a schema change after classification must
invalidate the witness at the later native boundary.

Both Story lookup predicates explicitly select the main relation and BINARY
equality. The catalog's primary-key proof therefore describes the relation
and equality actually used, including a column with a different declared
collation. This does not change the inherited Image predicates.

Request, environment, database, identity headers, cancellation, and technical
lifetime remain captured across awaited metadata work. The new helper returns
only classification and SQL witness data. Its sole existing draft access is
the unchanged Image scalar marker query; it never returns authored content.

## Qualification status

The final focused SQLite run passes 82/82 checks. Its separately gated actual
D1 group is explicitly skipped in that run and passes 1/1 in its dedicated run.
The focused checks cover actual SQL-witness races, lookup shape/index use,
Request/DB/cancellation/deadline lifetime, and malformed scalar receipts.
Strict SQL compilation uses expression depth 100, 32 function arguments,
100 parameters and 100,000 SQL bytes. Full project TypeScript checking and
focused ESLint pass. Independent source review accepts the final helper.
The dedicated D1 test's stale-evidence cleanup and read-only assertions were
then tightened without changing the 82 focused branches; that reviewed test
delta was exercised by the single dedicated D1 run.

The actual local Miniflare/workerd D1 group executes the Node-hosted production
classifier against an empty marker table and a synthetic source-free Story
sidecar. All four table-valued pragma forms work. Fifteen classifier statements
use at most four bindings and 2,552 SQL bytes. An absent-schema ordinary guard
fails after schema appearance; a supported empty-table guard fails after a raw
Story insertion, which then classifies as `story-sponsored`. Real D1 receipts
report zero changes and snapshots remain unchanged across classification.
There are zero creative body rows, provider calls, or external requests. Seven
explicit source/test/helper hashes match before and after. This qualifies the
new runtime forms and negative predicates, not a bundled Worker or HTTP route.
The actual D1 fixture does not claim runtime TEMP-shadow support or a live
campaign; those relation/collation regressions are separate local SQLite checks.

The first launch failed during test imports, before any cases; it was corrected
to use the existing source-import registration helper. The first executed run
passed 76/81. Four failures demonstrated three source findings: unqualified
Story queries could use a TEMP shadow instead of the catalog's main table;
column collation could cause a scan despite a verified BINARY key; and raw
scalar serialization could invoke a malformed object's callback. The source
now uses main/BINARY predicates and copies validated own primitive fields to
null-prototype rows before serialization. The fifth failure was an overly
strict test oracle: a valid own scalar with a harmless inherited serializer
may be copied and accepted without calling that serializer. The corrected
oracle still requires zero callback executions. All original failures and
the initial source/review are preserved separately.

No HTTP, native storage, provider journey, physical device, or production
acceptance is claimed. The classifier tests use synthetic negative sidecars,
not actual campaign approvals or paid storage receipts.

## Remaining D2 work

The next actual native composition requires a separately approved finite
initial-intake/storage contract, immutable storage debit and receipt, genuine
structured Story plan preparation, atomic private storage, native commit and
original receipt reopening, bounded draft/receipt reads, and internal POST
response accounting. D1's selected-result/status terms cannot authorize those
operations. Live numeric terms and enrollment remain separate.

Current intake/output and guest callsites remain unchanged. Their later
integration must retain the complete negative witness at every native
boundary and preserve the Image and claimed-context behavior. The previously
rejected retained-Story and passive-status hooks remain held; this classifier
does not implement either hook or provide another route to their capability.
