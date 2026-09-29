# Explicit resource assistant context — 2026-09-21

## Implemented locally

Library and Canvas retain their independent owner-qualified resource identities.
Their activity consent does **not** authorize model use. The real resource controls
now offer a separate review, selection and forgetting workflow. Selection freezes
the reviewed history; it cannot inherit a linked document's grant, include later
activity automatically, start a provider request, approve spending or grant an
assistant permission to edit.

The native `resource-assistant-context` endpoint supplies a bounded metadata-only
preview, confirms its exact snapshot/hash with a compare-and-swap against the
previous selection, and supports actor-owned revocation without renewed source
access. Native downstream handles retain the original disclosure deadline and
all independent scope, enrollment, source and selection predicates. Serialized
identities and hashes are not capabilities. Empty, changed, oversized, forged,
expired or partly acknowledged selections fail closed; writes are never retried
automatically.

Frozen resource recall owns its input copy, rejects accessors and sparse arrays,
revalidates exact source membership and preserves the original retention ceiling.
Historical 7/30-day counts remain relative to the reviewed `asOf`, not today's
rolling window. New activity does not rewrite an approved snapshot. Counts still
do not establish reading, comprehension, preference or independent human intent.

Additive migration `0070_memory_resource_contexts` stores no linked document or
block prose. Consent/revision/retention changes and deletion of any referenced
activity/opening permanently retire the selection and clear its snapshot.
Restoring source records cannot reactivate it. Old 0067/0069 installations remain
supported for their existing controls; the new endpoint requires exact 0070 schema.
The Drizzle declaration, ordered journal and snapshot are included. No request
runs DDL or backfills/enrolls a user.

## Verification

- 146 integrated native resource checks pass, including personal/shared local D1.
- 27 final context-specific checks pass, including four additional atomic races,
  lost acknowledgement, explicit forgetting and source restoration. These counts
  overlap the integrated run; they are not an additive distinct-test claim.
- 287 client, local-migration and assistant-migration checks pass.
- 10 synthetic browser journeys pass across Library/Canvas, English/Arabic,
  explicit consent, uncertain writes and blur/privacy clearing. The final visual
  pass also corrects checkbox flex shrink at narrow widths.
- TypeScript, changed-source lint and the unchanged production build pass; the
  build retains existing large-chunk warnings.

The first browser attempt lacked its required synthetic-network flag. A subsequent
fixture expected a post-write control before the required fresh read. Both failed
attempts are retained separately; neither is qualification evidence. No production
browser, real provider, real enrollment or live data was exercised.

## Remaining assigned implementation

This is the native selection boundary, **not** a complete semantic resource
assistant. Durable private semantic execution/publication, separately approved
provider/price review, downstream retirement and actual semantic result consumers
remain assigned here. They must not require a fake document enrollment or turn
activity counts into independent preferences. The other native rows remain in the
[completion matrix](forma-memory-completion-matrix-2026-09-20.md).

Hosted registration/qualification, live provider qualification, owner integration,
production deployment and explicit real-user enrollment remain separate gates.
