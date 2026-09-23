# S2 standalone current-source reader — local review

This change implements `GET /api/generation-current-source?documentId=…` as a separate, read-only, hosted owner-administrator observation. It accepts one document identifier and rejects duplicates/other selectors. It has no original job/request-sequence prerequisite. It creates no source freeze, study, grant, provider request or background retention work.

The selected real Document is `9a3fdd14-f7e9-4426-8b5e-0d5f929d021e`. Its URL's project identifier is only a user-supplied selection claim; the reader resolves its actual project from authenticated server evidence. Local tests do not qualify that live Document.

## Proof and response boundary

The existing native retained authentication contract supplies the current principal without initialization. The reader requires administrator role, accepted consent, personal scope and no impersonation/project cookie or active pilot. It captures the full owner stream within the fixed history/transport budgets, including final rechecks.

Scalar SQL custody checks precede all private event-body hydration. Missing, redacted, invalid/missing owner, foreign owner, binding, nonpersonal, size and JSON failures are mutually exclusive first failures. CASE stops before later predicates on failed custody. A metadata refusal loads zero private history bodies. Body page SELECTs repeat custody and complete-footprint conditions; concurrent redaction or foreign ownership returns no private body.

Every available event must match the actual writer's public/private envelope and sidecar normalization. Explicit unique project/document/block origins and uninterrupted current incarnation are required. Only the narrowly recognized creation/open/rename/block-edit/relation-add family is supported; unknown effects or transitions anywhere in this first conservative full-stream contract refuse. This does not declare unavailable history unrelated. Project origin IDs are explicit and valid. Scope omission support is event-specific for document rename and block property edit with unique explicit origins; it is not NULL acceptance or history backfill.

The current snapshot uses the existing authoritative context fold and rights rules. All source facts, including inactive ones, retain deadline checks. Preferences anywhere in the stream, references/pins and Memory/private pointers remain unsupported. No asset is hydrated. Governance/resource scope is checked initially and in the final authority observation.

Approved-proposal facts require retained execution/consent/result, selected proposal and edits, applied preview, verified commit, exact emitted events and current full properties binding. The approval's source hash is recomputed with the existing `contextSourceHash` at the server-resolved preview source boundary. The current and original approval states remain separate. A copied label or an empty binding list cannot qualify E2a.

A complete response carries the exact source JSON, UTF-8 length/SHA-256, revision, incarnation, source ledger and genuine producer bindings. Configuration is either explicitly unavailable beyond environment labels or validated against H5's server-bound metadata contract. Direction reuse and comparison eligibility remain false until separately qualified; no direction/job scan occurs. No human approval or financial authority is inferred.

Any prerequisite failure returns bounded state only. Census completion describes custody metadata, with separate body completeness; it does not certify source or approval. Failed final authority/history/retention witnesses discard the earlier diagnostic, including its counts. All responses are private/no-store. Serial rechecks certify observations; they do not make DB state and network delivery atomic.

## Scope and limits

The original evidence reader, generation admission, compiler, provider routing, financial rules, schema and migration files are unchanged. The Worker adds one read route and excludes it from background expiry cleanup. The existing isolated Memory boundary exports its exact read query set so delegated reads can reject unknown SQL shapes; its repair behavior is unchanged.

Limits: 50,000 initial history rows; 64 MiB raw history; 2,200,000-byte cell; 5,000-row pages; 1,024 statements; 150,000 aggregate returned rows; 192 MiB aggregate returned bytes; 12,000,000-byte response. Rechecks share these ceilings, so a history within the initial ceiling can still refuse the aggregate budget. These are transport/work bounds, not financial caps. No truncation qualifies.

## Validation and release status

The dedicated test suite uses the real context-plan builder, private preview writer, authoring commit writer and staging event writer against the hosted-like SQLite schema. Provider/execution result inputs are explicitly synthetic test records; no provider runs. The positive case has no generation job and includes a later authored edit. The same journeys run against source and the actual rebuilt Worker. Mutation fixtures distinguish simulated concurrent writes from forbidden inspection writes.

See the existing local S2 implementation packet for exact test counts, logs, source and bundle hashes, reviewable patch and handoff. This is a local review change, not an integrated or published release. Production remains at the previously retained 538 receipt until a separately authorized release is completed. No live selected-source read, genuine compiler pair, image, migration, study or financial-policy decision is claimed.
