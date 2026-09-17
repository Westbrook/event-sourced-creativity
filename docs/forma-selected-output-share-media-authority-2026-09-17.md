# Selected media sharing authority

The detached `readSelectedOutputShareMediaAuthority(env, custody)` accepts only an authentic `NativeRetainedMediaCustody`. It returns the existing opaque `SelectedOutputShareAuthority`, with the same private snapshot/assertion accessors. Issuance is a read-only provenance observation; it creates no share, fetches no additional media, initializes no schema, grants no provider access, and changes no financial records. Byte qualification and deliberate share creation remain separate requirements.

## Admitted provenance

| Source | Selection | Required evidence |
| --- | --- | --- |
| Ordinary personal Document Audio, Video, GLB | Exact current original, edit or restore | Native current receipt/history/content proof and completed canonical manual job; no Outputs reference or specialized receipt marker; no sponsor association. |
| Personal Outputs Audio | Exact current original, edit or restore | Native Audio current receipt/edit proof and exact request **and** result execution references; succeeded original slot, completed personal actor=payer grant, original authorization envelope and selected target. Audio uses the generic native job publication path. |
| Personal Outputs Video | Revision zero | Actual original native Video proof and read mode, private Outputs receipt marker, exact result execution reference; an absent request duplicate is allowed by that native reader, while any present duplicate must match. Original call, private input, storage and byte evidence remain in the native sibling proof. |
| Personal Outputs GLB | Revision zero | Actual original native GLB proof selected by its private Outputs receipt marker; both request and result references match. The native proof retains the original paid call, prepared input, private receipt and storage witnesses. GLB completion item count is zero; the native Outputs request count is one. |

Every slotted path retains the existing actor=payer, personal scope, null shared context, original attempt, exact preflight, explicit authorization envelope and unique selected target requirements. The original grant or preflight spending deadline does not become a new retention deadline: a completed authorization proves past deliberate generation, not a fresh spending permission. No claim about provider invoices is made.

The media validator is separate from the unchanged text validator. Its bounded private completion JSON is inspected as well as the public event, so unsupported private sponsor, workflow, recovery or replacement keys cannot disappear through public redaction. Unknown private lineage refuses even when its value is null or false.

## Current proof and lifetime

The final authority statement composes four complete sibling proof relations: optional sponsor-schema witness; exact native media custody SELECT; creator-policy witness; and byte-exact completed-job/authorization provenance. It also checks the count of the unbounded provenance relation, so a contradictory oversized second row cannot disappear from the uniqueness check.

The authority deadline is the minimum of job expiry, **effective native custody expiry** (including applicable original input/edit source expiry), and creator-policy deadline. Its private state retains the exact environment, DB and tagged custody proof. Native media accessors retain their MEDIA/configuration/cancellation binding. Consumers must execute the exported complete assertions again at commit and public read; an opaque object alone is not a perpetual authorization.

## Deliberate limits

- Specialized Outputs Video/GLB edits and restores need an explicit original-to-current provenance bridge. Current native custody alone does not prove that the original packed Outputs proof ran for those selections. This increment does not fabricate an original revision or invoke a recovery lease.
- Recovery, workflow and replacement lineages remain outside this sharing slice. Native private recovery behavior is unchanged. Newly recovered original completions can use different completion clients, and GLB recovery checkpoint validation needs its own review; this increment claims no recovered sharing acceptance.
- MP3, scaled GLB with unreferenced source geometry, and unqualified original Video container metadata remain the previously identified byte-qualification gaps. A provenance success does not imply that one of those byte formats can be shared.
- No endpoint or schema activation, real share, provider journey, financial hold, permission expansion, or publication was performed by the authority implementation task.

## Verification

The first combined authority run passed 91 focused cases: 33 ordinary/slotted Audio/capability/source cases plus 58 actual native original Video/GLB cases. Existing text authority parity passed 145 cases. Independent review passed 38 additional cases and preserved a concrete four-case red-to-green finding: private-only recovery/workflow/sponsor/replacement completion markers initially escaped the public-only scan; the bounded private witness closes that gap. Scoped lint and whole-project TypeScript checking passed for the implementation snapshot. Full composed D1/lifecycle/file verification is owned by the integration delegate and must be reported from its separate receipt.

Synthetic helper setup failures are preserved separately from product findings. The first ordinary fixture normalization hit the actual append-only event trigger; setup now temporarily removes and immediately restores that exact trigger before observations. Its next slotted seed used an invalid zero token cap; it now satisfies the actual positive-integer schema. An earlier refusal occurred inside native custody before the authority issuer; the test now expects that specific native error. None of these setup corrections alter production guards.

Local evidence: `/private/tmp/forma-media-authority-evidence-20260917`, `/private/tmp/forma-media-authority-independent-20260917`, and `/private/tmp/forma-media-original-authority-evidence-20260917`. Source hashes and final increment-wide results belong in the release review packet; later fixture additions do not increase the independent review count above 38.
