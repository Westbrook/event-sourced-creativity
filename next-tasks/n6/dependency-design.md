# N6 — missing prospective source authority contract

This is a bounded design, **not an implemented inspector or witness schema**. The N5 contract was reviewed before coding. Its bounds and prohibitions remain in force. N6 follows the user's explicit fallback when existing resolver contracts cannot supply complete authority.

## Exact missing dependency

The ordinary preflight source resolver must produce and later requalify a **complete, versioned authority census for the exact source sent by that preflight**. `authoritativeCreativeContext` currently derives a snapshot, projection, source block versions and document revision from caller-supplied events. It does not return custody, exhaustive dependency membership, immutable source lifetimes, execution exclusions, or a requalification capability. Its streaming sibling explicitly disclaims establishing authority or freshness.

`readWorkspaceEvents` reads projection-relevant events. A successfully folded snapshot does not prove that every relevant private envelope remains present, authorized and retained. `source_event_refs`, current block versions and the preflight context-mutation high-water mark are not this missing contract. Neither snapshot equality nor a hash supplies rights or custody.

The existing complete-stream current-source diagnostic is not an alternative authority producer. It requires the original user's actor on every event and its incarnation proof rejects unknown transitions. Ordinary `GenerationPreflightRequested` and `GenerationPreflightCompleted` worker events fall outside that contract. Filtering out events to make the diagnostic pass would weaken the complete census. The existing admitted-job reader additionally requires a real terminal job and original `GenerationRequested` binding. Neither reader changes in N6.

## Smallest bounded extension

Extend the existing ordinary source-resolution boundary; do not add a generic evidence platform or an independent hand-maintained event reader. The producer must own membership and completeness, including the absence of excluded inputs. One candidate interface is `resolvePersonalStillAdvisoryAuthority` returning either `{status: 'unavailable', reason}` or `{status: 'qualified', witness, requalify}`. These names describe a future interface and are not exported by this candidate.

The resolver must consume original custody-qualified envelopes while it builds the same source projection. For each relevant document, project, fact, relationship, constraint, attachment and accepted-input dependency, it must record original identity/hash, owner/stream/scope binding, current lifecycle and all original retention/rights deadlines. It must account for removed or superseded inputs whose text remains in the submitted source. Unknown effects, missing envelopes, unknown lifetimes or incomplete dependency coverage yield unavailable. A caller cannot supply a list and assert it is complete. Exclusion checks must come from the resolver's complete source and execution authority, not the absence of a few property names.

Keep the initial support exactly bounded:

- Personal Still `generate`, manual text-only Image, original principal paying for itself, with a complete untruncated snapshot of strictly under 28,000 JavaScript UTF-16 code units and at most 128 complete source dependencies.
- No references or 3D, derived or rights-bearing input, accepted Memory source, governed or sponsored/billing-delegated context, workflow, native Output/durable slot, Canvas or narrowed character context.
- The 128 limit covers dependencies, not merely 128 currently visible blocks. Overflow is unavailable; never inspect a prefix. Larger or otherwise unsupported jobs retain their ordinary moderation/admission behavior.
- No legacy backfill, source reconstruction, historical repair or change to existing reader predicates. If this complete qualification cannot be established for any selected source, no raw inspector is enabled for it.

The witness needs an immutable original preflight/request identity, original owner/stream/project/document/revision/full-source SHA-256, resolver version, complete dependency count and digest, explicit completeness and exclusion outcomes, source lifetimes, and original capture deadline. Bind the database identity in the live read session; do not accept a serialized database label as identity proof.

At existing input construction (`sourceAdvisoryInputs`), derive a versioned positional manifest: index, snapshot/fact kind, original fact index, block ID, truncation, exact input hash and UTF-16/UTF-8 lengths. The actual submitted array remains byte-for-byte unchanged: snapshot then first 24 nonempty fact projections, with existing 28,000/6,000 code-unit slicing. Capture from that array, not a second reconstruction. Position is the provider association contract; a valid reordered response cannot be independently detected without echoed identities.

Persist the witness observationally through the existing authorized preflight capture, bound to its original private evidence envelopes and original preflight row. Keep server-only witness detail out of ordinary readiness responses. Capture/serialization/storage/qualification failure records unavailable metadata at most, without changing moderation dispatch count, wire, model, verdict, admission or acknowledgement. Never invoke another source preflight or provider call to repair it.

## Reader after the dependency is qualified

One GET path may accept exactly one document ID and one selected original/adopter preflight ID. Reject duplicate/extra selectors and arbitrary content IDs. Use hosted identity and `readNativeRetainedPrincipal` before any normal initialization. Route before mutating handlers **and** exclude the route from `worker/index.ts` post-response retention scheduling.

Require the selected and original preflight rows, matching original/request/adopter/owner/stream/project/document/revision/source binding. Reuse the qualified original witness and at most two server-owned moderation references. An adopter never becomes a new origin. An upsert that replaces the original preflight identity makes access unavailable even while the bodies remain retained.

Reuse `qualifyAdvisoryCapture` for its actual bounded custody checks, then independently validate exact original envelope digests and exact operation request/response body digests, same evidence ID and one of each phase, manifest hash and exact input/cardinality association. Preserve raw strings exactly; never parse and reserialize them as originals. Unique-key bounded JSON validation and existing result validation are reusable. Missing or incomplete bodies are unavailable. Invalid/cardinality-mismatched result bodies have unknown classifications, never clear. Distinguish requested model, returned model, request header ID, response body ID, flag, categories and scores; absent values stay unknown. Scores are provider values, not calibrated probabilities.

The effective deadline is the minimum of original and selected preflight expiry, original witness/source-rights lifetimes and both original private-record deadlines. Extension of a stored deadline must not extend this minimum. Body retention cannot revive expired preflight access. Legacy/missing/expired witnesses yield metadata only.

Before returning, requalify canonical principal/consent, database identity, both exact preflight rows, complete current source membership/rights/provenance/exclusions, exact content bytes and original deadline bindings. Apply deadlines immediately before response serialization/return. Any invalidation discards partially qualified bytes and stale sensitive diagnostics.

Return private/no-store with identity-sensitive Vary headers. Render exact bytes as escaped inert text in a compact disclosure selected from that review. Opening/collapsing inspection cannot acknowledge, refresh, generate or retry. The existing explicit acknowledgement control remains the only acknowledgement action. The Progress Report return link uses trusted configuration when `?progress-report` is present.

## Remaining qualification

`qualification-matrix.json` records the entire requested route matrix as **unimplemented/not run for N6**. Existing custody and N5 tests are regression evidence only. They do not qualify this proposed route. The dependency counterexamples establish why the current contracts are insufficient; they are not a classifier evaluation or historical evidence.

The next bounded implementation is the resolver-owned census/requalification producer and its tests. Only after that contract is established can the observational witness, selected reader and actual disclosure be implemented and qualified. No release or live observation follows from this design. A later live observation requires a separate exact proposal.
