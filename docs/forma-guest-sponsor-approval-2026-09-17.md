# Guest Image sponsorship: dormant payer approval

The separate v3 guest sponsorship contract now has a payer approval adapter in
`worker/experience-guest-sponsor-approval.ts`. It records the actual existing
canonical payer's explicit review in the existing native sponsor tables. It does
not create an account, enroll a guest, install schema, issue a grant, prepare a
native output job, reserve money or call a provider. No router imports it.

This is a prerequisite for anonymous sponsored Image generation, not completion
of that journey. Both exported operations return `generationAvailable: false`.
The original v1/v2 canonical-principal compilers and approval code are unchanged.

## Server-only operations

`approveGuestSponsorCampaign(request, env)` consumes this closed JSON command:

```typescript
{
  version: 1,
  action: "approve-guest-sponsor-campaign",
  approvalId: string,
  proposal: GuestSponsorApprovalProposalV1,
  reviewedTermsDigest: string,
  confirmation: "APPROVE_GUEST_SPONSOR_CAMPAIGN"
}
```

Use the existing `compileGuestSponsorApprovalProposal` to produce the reviewable
proposal and its terms digest. That compiler remains validation only. An actual
payer request must confirm the exact digest; a supplied digest is not authority.
The v3 proposal explicitly binds the guest audience, original Image release,
custody/source policies, origin, template and finite monetary/resource limits.
This operation need not read or create a guest session or source. Later issuance
must prove that an actual guest matches those reviewed restrictions.

`revokeGuestSponsorCampaign(request, env)` consumes:

```typescript
{
  version: 1,
  action: "revoke-guest-sponsor-campaign",
  campaignId: string,
  policyDigest: string,
  confirmation: "REVOKE_GUEST_SPONSOR_CAMPAIGN"
}
```

Both return a frozen receipt containing only `version: 1`, `status` (`approved`
or `revoked`), `approvalId`, `campaignId`, `termsDigest`, `policyDigest`, `replayed`
and `generationAvailable: false`. No principal snapshot, source text, guest
credential or execution capability is disclosed. Failures use
`GuestSponsorContractError` with a `guest_sponsor_approval_` code prefix; the
existing v3 compiler may also emit its contract validation errors.

The original Request body is consumed. Use a fresh Request for a deliberate
replay; do not transform an authenticated GET or manufacture identity headers.
No HTTP error mapping, cookie mutation or public response handler is installed.

## Request and payer boundary

Requests require HTTPS POST, an explicit Origin equal to both their URL origin
and the reviewed guest origin, no URL credentials/query/fragment, and absent,
`same-origin` or `none` Fetch Metadata. JSON permits an optional UTF-8 charset;
other content coding is refused. The reader enforces 128 KiB, at most 4,096
chunks, a five-second deadline and request abort. It uses fatal UTF-8 decoding,
refuses a BOM, handles a locked body, and cancels without awaiting cancellation.
The chunk limit also bounds ready empty chunks that could otherwise starve the
deadline timer. The complete header snapshot and URL are pinned before the first
await and checked afterward alongside DB identity, request abort and pilot
configuration.

The native read-only `readExistingPrincipalRequest` must return the actual
existing Creator/admin principal with current consent. Lifecycle-required,
fictional, guest-subject, delegated-payer and project-execution results fail.
Any exact project-context or impersonation cookie name is refused, including
empty or stale values. An unrelated admin cannot approve or revoke another
payer's campaign. No account/profile/consent lifecycle helper is invoked.

The second native principal row must match the user just authenticated, including
role, consent, email, display name and every normalized `authorizationSnapshot`
field. The stored approval retains the original ten-field SQL authority array.
The atomic guard repeats those exact facts and excludes active, unrevoked pilot
participation by user ID or normalized email in active, paused or closed cohorts.
Native principal SQL includes creator project-name reads; the adapter needs no
guest creative-source data, but it is not literally free of all creative reads.

## Creation, replay and uncertainty

One `DB.batch` checks current payer authority and the DB-time campaign window,
inserts fresh campaign/resource-policy/approval rows, and repeats the complete
current proof. Plain INSERT and the existing immutable approval triggers prevent
replacement or renewal. Campaign and approval IDs share the existing v2/v3
namespace. Any conflicting or partial prior installation fails; no row is
repaired automatically.

The current proof binds full canonical command bytes, reviewed terms and policy,
original payer authority and both exact enabled configuration rows. It establishes
the immutable DB approval timestamp within its original policy window and checks
that the campaign is currently live. No preliminary timestamp query is needed:
the final resolver selects the single exact immutable record. Campaign/resource-policy rows themselves
are mutable; the immutable approval plus this repeated comparison is essential.
Sibling materialized relations keep the large native principal query separate
from approval predicates for D1 expression-depth compatibility.

Successful creation ends with a read-only exact current receipt query. A replay
requires the identical command, original authority and live configuration; it
cannot renew expiry, replace resources, alter caps or reactivate a revoked
approval. DB time supplies creation timestamps and time checks. No client clock
is accepted. A resource subwindow may open later than approval; actual resource
issuance must enforce its own window.

A thrown, truncated or unsuccessful batch acknowledgement is uncertain, not a
reason to repeat the mutation. The adapter performs only the same exact current
receipt read. If that read proves the complete original, it returns
`replayed: true`; otherwise the error remains. A normal fresh operation returns
`replayed: false`. The replay flag reports resolution of existing evidence; it
does not claim that approval predated the invocation. DB/abort/header/cohort
checks follow awaited helpers and the final outer return boundary.

An abort cannot undo a batch that is already executing. If it occurs during that
batch, the operation stops later work and disclosure; a fresh explicit request
can resolve the committed original if current authority still permits it.

## Revocation

Revocation authenticates the current actual payer and reconstructs the exact
immutable original v3 command. It does not require the original approval-time
authority snapshot still to match, the campaign to be live, or mutable
configuration still to have its original content. Those conditions could strand
the payer's kill switch after an ordinary authority change or expiry.

One atomic batch pins the original record and current payer, retains the first
DB revocation timestamp, disables that campaign's configuration and grant rows,
and proves the resulting disabled state. Repeating it preserves the first
timestamp. Uncertain acknowledgement again resolves only the exact current
revoked state, never a second automatic mutation. A normal revoke's `replayed`
flag reflects whether revocation was already observed before its batch; uncertain
acknowledgement recovery returns `true`.

No history is deleted. Resource receipts, consumptions, active jobs, balances,
financial holds and incurred-cost settlement remain untouched. The existing
same-payer generic v2 revocation can also disable a v3 row; that monotonic overlap
adds no issuance or purchase authority.

## Qualification and deployment boundaries

Focused new native and workerd D1 tests use actual schema and synthetic existing
payer records in disposable local storage, with network and media denied. They
exercise the exported operations, exact replay and collisions, changed payer
facts, configuration drift, transactional rollback, malformed/lost
acknowledgements, request bounds, and revocation after expiry or authority drift.
Their individual results belong in the accompanying qualification evidence;
this document alone does not assert a passing run or live acceptance.

The fixture explicitly installs `ensureSchema`, `SPONSOR_ENTITLEMENT_SCHEMA`,
`SPONSOR_RESOURCE_SCHEMA` and `SPONSOR_APPROVAL_SCHEMA`. Product operations never
invoke those installers. Missing schema fails closed. No new tables or changes
to their definitions are required for these approval-only writes. The sponsor
schema exports remain dormant until separately reviewed deployment work.

Next, independently qualify and integrate this bounded adapter. Guest-native
source/actor authority, output command successors, actual issuer/admission
composition and public entry remain separate work. No current campaign values,
live payer identity or spending permission is implied by local fixtures.

The coordinating root task owns isolated integration and review. The established
“Assemble Forma specialist team” task
`01a03eaa-d5b7-7630-943d-7105f7a3067b` retains canonical `main` and publication
ownership. This supplier checkout has no independent publication authority.
