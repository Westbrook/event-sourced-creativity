# Dormant guest Image issuance

This slice adds explicit authorization and issuance for the existing text-only
guest Image quote. It remains unregistered: no route or UI calls these modules.
It does not authorize native execution, admit a job, generate output, or adopt
generated custody.

`prepareGuestImageAuthorization` returns a source-free review. The caller must
deliberately submit its exact authorization fields with
`explicitAuthorization: true` to `createGuestImageAuthorization`. The resulting
opaque capability is bound to the same request, environment, current guest
possession, actual payer approval, source, original native quote and expiry.
Reviewing or reading an issuance cannot manufacture this capability.

`issueGuestImageGrant` re-observes the current authentic source before choosing
its write path. One atomic native batch establishes exactly three lasting rows:
the sponsor grant, immutable issuance, and immutable issuance-resource receipt.
Before and after assertions retain source ownership, closed inventory, schema,
Memory, payer approval, finite preparation limits and claim-lease exclusions.
No new financial reservation, consumption, output command, event, job or media
is written. The grant retains the original guest actor and campaign payer.

The issuance's driver JSON is the original guest driver command. Its command
digest is the exact submitted authorization digest, also recorded as the v3
envelope's guest authorization digest. The envelope binds the actual native
recipe and current quote revision N+3; the confirmed plan's source head remains
N+1. Grant and resource identities are deterministic, and every expiry is
bounded by the original quote, session, source and policy.

The new, separately branded witness recognizes only quoted-unissued or an
exact complete three-row issuance. The original four-state witness continues
to reject any issuance. Partial, conflicting, foreign or unsupported retained
state is refused. Exact replay is read-only, including reuse of the original
authorization capability. A lost or malformed batch acknowledgement permits
only a fresh read of the exact completed original; it never retries purchase,
renews timestamps or refunds preparation work.

Each public operation guards local continuations with the captured request,
environment and original 30-second monotonic deadline. Public functions return
their owner's exact promise and check currentness before success. Outstanding
promises remain observed after timeout or abort. The unchanged nested payer
approval and guest source readers own internal read-only awaits without a
cancellation hook; those reads may complete after the public operation has
refused. This slice does not claim transitive cancellation of those helpers.
Native D1 batches already dispatched also retain their transaction semantics;
an exact original can be read on a later current request.

Qualification uses genuine synthetic guest/source and payer-approval APIs,
native SAVE, confirmation and quote, with no guest users row. Focused tests
cover exact receipts and recipe, original revision and command digests, consent
and identity substitutions, currentness, malformed acknowledgements, retained
state, claim races, finite limits, atomic rollback and replay. A small disposable
local workerd D1 qualification exercises successful issuance/replay and resource
cap rollback, qualifying SQL before forwarding it. Native setup is copied as
exact synthetic schema/rows from SQLite; issuer APIs run in Node against actual
local workerd D1. It is not hosted-service or live-provider evidence. Existing
accepted provider journeys and unrelated suites are reused.

The implementation is based on accepted R11 commit
`038ff04ab302485bdb3ea8918b115e066dfd8ca0`. Its separate protocol does not qualify
generated-result adoption or expand the active historical-custody work.
