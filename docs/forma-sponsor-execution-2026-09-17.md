# Dormant sponsor execution and accounting qualification — 17 September 2026

This continues the [admission checkpoint](forma-sponsor-foundation-2026-09-17.md).
It implements an internal continuation for one original, text-only native Image,
with one OpenAI planning call and one OpenAI Image call. Qualification uses real
native handlers, source checks, SQLite transactions and synthetic in-memory
provider responses. It does not authorize a real sponsor or enable sponsored use.
Fal, other outputs, reference inputs, alternatives and repairs are not qualified
sponsored execution in this increment.

## Exact execution boundary

`createSponsorExecutionAuthority` reconstructs an internal, non-serializable
capability from a fresh authenticated request and the admitted native job, grant,
entitlement and exact token/cost reservations. The actor remains the Document,
job, source, event, private-content and media owner. A separate financial owner
comes only from the original matched grant/reservations; neither browser JSON nor
an actor's `billingUserId` can select or replace it.

The internal `executeSponsoredRun` path validates that seal before digest/replay,
then uses actual native Run transaction and source assertions. Tests separately
pass the same fresh-request seal to the actual `runDocumentJob` runner. The ordinary
bridge retains its existing foreground behavior and does not carry the new seal.
There is **no registered HTTP or queue driver that creates or forwards this
capability**. These are qualified internal Run and runner/accounting boundaries,
not a public sponsored Run round-trip. Registered Output Run/resume and direct
job Run refuse sponsored personal work, including already-queued jobs. No runtime
schema, policy loader, issuer, campaign, scheduler, launch route or live financial
mutation was activated. Imports into the Worker are present.

Dispatch rechecks the exact native source/rights, route and call allowances plus
current actor/payer consent, campaign/grant state and immutable deadlines. An
issued-grant deadline earlier than the campaign deadline is enforced synchronously
immediately before fetch, including expiry after the pending checkpoint. Fresh
principal objects with a sponsor billing override or fictional/project authority
cannot reuse an otherwise valid seal. Ordinary personal and shared/project paths
retain their original financial and creative authority.

## Accounting and recovery limits

Known incurred cost uses a separate original financial proof. It does not depend
on current campaign JSON/enabled state, consent, source content or the private
admission marker. The financial checkpoint remains owned by the actor. The same
proof participates in provider observation, account settlement, zero-call cleanup
and reconciliation transactions. Current reservation/job correlation must match
after the existing native attempt handoff; no second reservation is bought.

Actual recorded usage, including overage, settles the sponsor and workspace once;
it is not clamped to the estimate. A known planning receipt can settle after
revocation while the Image stage is refused. Accepted or uncertain exposure keeps
its existing holds and active occupancy. Fully resolved terminal jobs release only
active occupancy; cumulative entitlement is never refunded. Zero-cost released
reservations are terminal evidence too. Repeated public stop and generic cleanup
can complete an interrupted occupancy cleanup without changing settled money.
This is bounded existing maintenance, not an automatic scheduling architecture.

The actual privacy handler was tested on completed work and on unresolved held
work with retained known receipts. The latter can converge after source erasure,
revoked consent and disabled/changed campaign configuration, without restoring
private content or contacting a provider. Fully settled erasure may intentionally
remove the redundant receipt vector; a redundant direct settlement read can then
report uncertainty while the existing settled counters remain unchanged.

## Evidence and preserved failures

Focused source tests cover native success, custody, public refusal, fresh-request
replay after a lost Run acknowledgment, exact payer isolation for two actors,
lost settlement acknowledgments, overage, revocation, forged capabilities and
principals, issued expiry at dispatch, unknown submission holds, terminal cleanup,
and erased-source known-cost reconciliation (72 focused tests, including the
existing admission/foundation cases). Existing admission/foundation tests
and selected ordinary native/shared/project tests qualify changed-path behavior.
These synthetic amounts are application-recorded test usage, not provider invoices
or evidence of deployed D1 concurrency or live sponsor acceptance.

The first actual run exposed an invalid new SQL join to a nonexistent native job
column; the resolver now uses the canonical slot/job relation. Independent review
also found and closed earlier-issued deadline binding, safe JSON inspection after
erasure, zero-cost occupancy release, every-entry cleanup financial assertions,
post-stop retry convergence, original financial observation assertions, and the
separate internal-principal boundary. Historical red logs remain preserved.

Two test observations were corrected without product changes: a second actor's
fixture schema initialization was not idempotent, and the ledger-failure test read
a stale returned runner object instead of the canonical durable job row. A later
cross-actor access test also required the fixture’s complete authenticated header
pair instead of a single header that fell back to the local default user. Tracing
the actual fallback showed the completed monetary witness committed and survived
terminalization. No financial-checkpoint or ledger-core change was needed.

The final source hashes, exact commands/log paths and independent review are in
`forma-sponsor-execution-validation-20260917.json` in the handoff evidence directory.

## Work still independent of launch approval

A separately reviewed internal issuer/driver adapter must connect fresh canonical
request authorization to the sealed Run and runner boundaries. A reusable campaign
policy needs a closed, stable allowed-template contract separated from the exact
per-preflight grant envelope. The existing candidate policy intentionally matches
exact reviewed intent route/settings digests; this increment does not relax them.
Server-owned policy loading/issuance, bounded intake/upload/storage/parsing and
polling/download/account-link controls, resource quotas and campaign shutdown
behavior remain original implementation work that can be built disabled with
synthetic policies. Mapping and execution for other providers/outputs/input modes
need their own exact native contracts and tests. Anonymous authentication and
same-Document guest claim remain separate from this canonical-principal slice.

Actual payer, sponsor consent, audience, recipes, monetary/admission/time-window
allowances, dates, retention and shutdown ownership still need applicable user and
sponsor approval before activation. The deployment owner applies approved terms;
deployment responsibility does not authorize choosing financial commitments.
These missing launch terms do not block the independent implementation above.
The broader server-owned generation architecture remains explicitly deferred.
