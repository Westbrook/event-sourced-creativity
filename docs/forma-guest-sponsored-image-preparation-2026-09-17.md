# Dormant guest-sponsored Image contract and source preparation

This increment implements a versioned guest contract and a read-only preparation
from an actual retained native guest source. It does not implement anonymous
generation, payer approval, grant issuance, financial admission, execution,
generated-result adoption, or full mini-app claim. No route, installer, environment
switch, new identity provider or production policy imports these modules.

The base is reviewed R4 `e6158801a0bfd013c95738e5f908a8193ae39698`. Existing
canonical sponsor v1/v2 parsers, approved terms, native command authority, guest
session/source/context inventory and completed context claims remain unchanged.
Existing canonical payer approvals enumerate canonical users; they cannot be
reinterpreted as approvals for guests.

## Contract

`experience-guest-sponsor-contract.ts` defines a separate strict v3 candidate
policy. All payer, campaign, origin, reviewed release, guest session/source policy
identities and digests, lifetime, monetary and resource limits are explicit. There
is no default campaign or allowance. Its single text-only Image template reuses
the existing pure native template validator; resource limits use the existing
explicit finite validator. Validation does not verify a real payer approval or
actual native provider configuration.

The separate approval proposal gives a future canonical payer an exact guest
audience to review. Compiling its canonical bytes/digests creates no approval row.
Session and source commitments use distinct domains and exclude raw bearer
credentials and their secret hashes. The original guest subject remains creative
actor and owner; the separate payer field retains the canonical payer. Neither
field creates a native user record.

The pure envelope compiler validates exact cross-links among candidate policy,
guest session/source commitments, explicit authorization metadata and a native
recipe descriptor. These supplied values remain validation material. The future
issuer must independently obtain the actual approved terms, current payer
authority, authenticated source, retained quote and explicit user authorization;
a compiler result does not substitute for any of them.

Stable driver identity binds campaign, session and original draft. Changed source
content cannot evade that identity by obtaining another mutation key. Exact
payload/digest conflict detection and native command receipts are still required
when the consumer is implemented. Original source head is separate from the
later native confirmed-plan source revision and digest: saving an Output
requirement changes the native source.

## Actual source preparation

`prepareGuestImageProducer(request, env, {proof, policy, draftHash})` calls the
existing actual guest inventory with both purpose-specific credentials. It
matches the candidate policy to the real immutable guest session/source policy,
registered release, original draft and authored Image ratio. It derives the
existing native unconfirmed requirement identity and digest using the original
draft IDs. It does not save that requirement or present native recipe eligibility
as guest execution readiness.

The operation requires HTTPS POST, exact Origin, no query/fragment, accepted
same-origin Fetch Metadata and an unaborted actual Request. Its final database
proof checks the full unchanged native context inventory, exact source-policy
binding and current revocation, absence of a prior claim lease and the candidate
policy/resource time interval. The deadline uses database time and is capped by
the explicit maximum grant lifetime, session and source retention, guest policy,
candidate policy and resource expiry. It does not extend or renew those limits.

Fresh production preparation deliberately refuses revoked source-issuance policy.
Historical context recovery keeps its accepted, less restrictive semantics.
Any prior claim lease is outside this bounded preparation protocol, even if it
expired. This stage never releases or alters a lease.

All asynchronous derivation ends before the complete final proof. The returned
opaque witness is bound to the exact Request, environment and DB object, with
private proof data held in a WeakMap. `recheckGuestImagePreparation` executes that
complete proof again, and refuses clones, forged witnesses, changed environment
or DB, request changes, revoked/expired custody, source mutation, new native
output work and Memory provenance changes. Returned summaries contain no source
text, proof tokens or SQL. Their issuer/admission/provider/generation/custody
flags are explicitly false.

No writer accepts the witness. A later reviewed adapter must consume its full
bootstrap assertion **inside** the same transaction as the first native command.
A successful read followed by an unrelated write is not that transaction.

## Smallest remaining genuine producer

1. Implement an explicit v3 payer approval adapter using the actual canonical
   payer and existing immutable approval/resource rows. Preserve v1/v2 terms.
2. Add a sealed guest command authority, without `PilotUser`, trusted headers or
   an arbitrary caller-supplied SQL override. The current native writer always
   requires canonical user authority; an extra guest predicate cannot replace it.
3. Atomically prove the original empty-output source before the first native
   requirement command and record only that command's exact successor footprint.
   The accepted context inventory intentionally rejects any new Output event;
   it must not be weakened to accept an arbitrary extended stream.
4. Bind actual native preflight, driver stage, grant issuance and resource receipt
   to genuine guest source/session proof plus the independently approved payer.
   Native job/slot/grant/routes, financial reservations, sponsor consumption and
   immutable command receipt must be one admission transaction with a final proof.
5. Qualify explicit guest execution and paid-call fences, then the completed
   sponsored media graph and custody alias, preserving original actor, payer,
   IDs, quotas and settlement history. No ownership/hash rewrite or second
   paid-looking completion event is an adoption mechanism.

These are remaining original-scope code increments. Launch values are needed for
live activation, not for dormant engineering and synthetic qualification. The
broader deferred server-owned architecture is not introduced as a prerequisite.

## Verification

Focused tests use synthetic explicit policies and the actual native guest session,
source and inventory modules in disposable storage. They cover closed validation,
stable identity, source binding/currentness, exact opaque witness boundaries and
unchanged persistent state. Strict SQLite compilation applies D1's function,
parameter and SQL-byte limits plus the measured expression-depth limit; actual
local workerd/D1 checks execute the composed end-to-end proof independently.

Exact final counts, query bounds, independent review and preserved failures belong
in the handoff packet. This document does not turn planned or failing checks into
acceptance, and no test proves provider submission or whole-result guest claim.
