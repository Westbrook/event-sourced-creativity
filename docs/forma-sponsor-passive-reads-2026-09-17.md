# Dormant original Image read core

This increment adds only new internal modules and synthetic tests. It does not
register a route, install a schema, approve operational limits, or change any
existing reader. It therefore does **not** establish browser polling or download
protection. Public sponsored generation remains closed.

## Boundaries

`identifySponsorImageRead(request, env, { jobId })` authenticates an existing
canonical personal principal and performs a bounded, indexed original-job lookup.
It checks the native slot/grant/plan, immutable sponsor consumption and issuance,
the historical approved policy/envelope, and the actual immutable issuance
resource receipt. Its opaque seal identifies the resource accounting scope only.
It does not read creative history, result bodies or R2 and never grants access to
creative bytes. A financial reservation, caller annotation or R2 metadata cannot
substitute for this lineage. Original principal/session equality is historical;
the current request separately captures and rechecks today's principal authority.

`reserveSponsorImageReadAttempt` accepts that seal and one closed operation:
`image-status`, `image-result`, or `image-media`. An explicit stored
`SponsorReadPolicyV1` defines rolling actor/campaign request and byte limits,
per-attempt byte limits and a deadline. There are no operational defaults. A
review receipt digest is provenance; the missing policy provisioning/approval
integration must establish actual server authority before activation.

Each invocation reserves a new server-generated identity and its full byte
ceiling atomically with original authority and policy assertions. The request
and bytes stay charged through the database deadline plus a full rolling window.
This conservative accounting includes failed, canceled, abandoned and lost-ACK
attempts, does not refund an old intent, and aggregates across jobs, operations
and historical policy versions. A duplicate generated identity cannot recover
an old ticket after a zero-row insert. Tickets are request/env/DB/seal-bound and
may be consumed once. No function reconciles money or changes a generation hold.

`resolveSponsorImageRead` consumes a fresh attempt before any creative replay.
The existing native Image witness/reducer supplies bounded complete event history
and original version proofs. Closed wrappers reserve the native query families'
worst-case response sizes before dispatch, account every returned result
(including prefetched/discarded data), and reject insufficient allowance before
expensive pages. Native page, row, history, revision, retained-state and query
ceilings remain intact. Unknown witness query shapes fail closed.

The deadline starts before the reservation, uses a monotonic clock, and is
constrained by database remaining time. Bounded waits reject stalled reads even
if the process wall clock moves backward; the final database proof still checks
absolute expiration. There is no detached work, Run, recovery, queue driving,
settlement, provider request or object-storage read in the resolver.

For a completed result, it verifies coherent native job/slot/grant state,
settled provider-call accounting, the completion event's original receipt,
private owner/Document/Project, unique object/generation association, current
nonremoved Document and nondiscarded output, retained provider-output existence,
retention expiry and exclusion from collaborative/legal-hold scope. A final
proof rechecks the original principal, native lineage, event version, result and
private custody together. The result exposes only an explicitly named
`original-generation` media tuple. It does not certify an edited current revision
or return raw planner content. Pending status returns no media tuple.

Generation campaign/grant switches, budget exhaustion, approval revocation or
generation expiry do not govern still-owned result reads. Current principal,
creative ownership and native retention remain necessary. Read throttling is
temporary and never purchases generation or transfers result ownership.

The tuple includes the **remaining** byte allowance and the original database
deadline. It is not a media response or standalone authorization to stream any
object. A later native reader must verify R2 custody, exact byte length/hash/MIME
and dimensions against the tuple, spend only this remainder, enforce the same
deadline, and repeat current disclosure proofs. No existing byte reader consumes
this result yet.

## Required later integration

Coordinate with the recovery owner before changing Document Jobs inspection,
detail/list or Outputs handlers. Preserve native response formats and current
custody proofs; do not fork general APIs or silently reconcile sponsored reads.
The Image result and direct media boundaries also need coordinated hooks.
Outputs snapshot, native adopted assets and exported deliveries are actual aliases
and must share the same accounting. An Image copied through ordinary native bind
retains its original job lineage and cannot bypass the policy merely because the
host normally uses `/api/media`.

The current Experience draft state reader rejects distinct payers and remains
closed. Event/hot-event history can expose completion metadata and private output
content; its sponsored response portions remain a dependency for any claim that
all result-read work is bounded. Edited-media and adopted-asset lookup adapters,
mixed-list policy, trusted read-policy approval/provisioning, schema installation,
explicit launch values and public activation are not supplied here.

## Qualification

The new tests use disposable actual SQLite and native sponsor admission/issuance
and completion through the existing in-memory Image responder. Fixture setup is
synthetic; no external provider request, invoice, real financial hold, customer
data or download occurs. After setup all network and R2 methods are hard failures.
The pending fixture stops the real driver before Run and has zero synthetic
provider calls. The tests check native state remains unchanged except for the
new resource read receipts.

Focused cases cover exact lineage and custody tampering, current revocation,
expired/revoked generation authority with retained owner access, original media
association, repeated/failed reads, concurrent quotas, lost acknowledgments,
duplicate identities, one-use request binding, immutable policies/receipts,
pre-dispatch byte limits and database/monotonic deadlines. Source review and
logs are recorded in the independent handoff packet; they are not live provider,
public-route, accessibility or physical-device evidence.
