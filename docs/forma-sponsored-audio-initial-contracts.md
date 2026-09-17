# Audio initial-context contracts

Audio sponsorship now has dormant, separately approved initial-context terms. These four leaves prepare policy, payer approval, original logical storage receipts and negative classification. They do not create a native draft, commit a Project/Document, reserve an IO attempt, expose a route or authorize generation.

The basis is accepted R12 `c61c2c9c4e26c6eb1bb5d3858c900d0795a4cdcd` plus accepted Audio server `d1b0506f2ab3c08d578ad9e00900a1ed3e715f0f`, composed as `8c9c57f`. Both existing Audio server preimages matched R12. This change adds exactly four worker modules, one focused test file and this document; it changes no existing source.

## Contracts and provenance

`experience-sponsor-audio-intake-policy.ts` defines the closed `canonical-audio-initial-intake@1` family, purpose `initial-context`, explicit actor/campaign storage ceilings and four finite IO operation terms: prepare, commit, original draft read and original receipt read. There are no default campaign allowances. Existing generation V8 and resource V1 meanings remain unchanged.

`experience-sponsor-audio-intake-approval.ts` authenticates the actual supplied payer Request and reconstructs its original V8 campaign, reviewed terms and approval command. Current V8 approval uses the full 13-column payer snapshot. The separate explicit initial-context approval retains exact terms and repeats current payer/campaign/schema predicates at transaction closure. Replay cannot change identity or terms. The retained reader reconstructs immutable original provenance after generation revocation; its returned assertions are not private-read authority.

The bounded metadata helper captures Request, signal, environment and DB, applies a monotonic deadline and checks currentness across its owned awaits. It rejects sparse, accessor and contradictory acknowledgements, including inherited error fields. Recursive copying accounts the exact serialized UTF-8 byte count, including escaped controls, property names and lone surrogates, against the remaining complete-envelope allowance before a large whole-envelope serialization. The batch shares that allowance across every acknowledgement.

`experience-sponsor-audio-intake-resources.ts` prepares an atomic logical-byte allocation and matching original receipt. The complete 23-field join includes actor/session, campaign/policy/approval, native intent, draft/project/Document, marked canonical hash, source/body/event-payload digests, exact byte counts, original expiry and database recording time. Quotas use that original allocation time. Partial pairs, duplicate originals and changed identities fail closed. Pure preparation captures its input before hashing and executes no statements itself.

The actual registered builder produces five native events for required musical direction and an empty optional detail, or six with authored development detail. Storage accepts those counts only; count alone is not native grammar proof. Logical bytes cover the marked canonical draft plus exact native private event payloads. The normal bounded native draft collector still imposes its additional 65,536-byte limit; the broader policy validation ceilings cannot override it.

`experience-sponsor-audio-intake-classification.ts` is negative classification only. It preserves ordinary, Image and Story boundaries, refuses all sponsor markers, and recognizes Audio's exact indexed sidecar schema and complete pair. Audio allocation-only, receipt-only or mismatched originals cannot fall back to ordinary. An ordinary result carries the complete catalog, schema and absence guard for its eventual protected boundary. A positive classification never grants custody or generation authority.

All DDL exports are dormant. Synthetic tests install them only in disposable in-memory SQLite. No migration or application initializer imports them. These receipts measure logical storage and bounded metadata, not monetary settlement, provider charges or invoices.

## Qualification

`tests/experience-sponsor-audio-initial-contracts.test.mjs` uses real production exports, actual registered compiler/builder output, actual synthetic V8 payer approval and actual prepared SQL. Its four groups cover:

- Registered five/six-event output, exact typed values/format, closed policy grammar and owned immutable inputs.
- Actual payer review/approval, exact replay and retained provenance; wrong actor/terms; same-transaction payer mutation rollback; bounded acknowledgements and lifetime checks.
- Actual allocation/receipt SQL, capacity, original identity, false/NULL final-proof rollback and partial-pair refusal.
- Image/Story/Audio/marker refusal, catalog/index restrictions, complete ordinary absence guards and acknowledgement/currentness failures.

The full focused run passed **21 nodes: four parent groups and 17 case nodes**. Independent review then found that the payer-mutation fixture could reject its extra approval-table trigger before the intended mutation. That case's original acceptance is superseded: the corrected fixture changes only the existing assertion sink, proves the actual mutation ran after both new rows existed, and passed in the affected **eight-node approval group**. The complete ordinary classification guard subsequently passed the existing strict SQL compiler in the affected **five-node classification group**. Production source was unchanged; other coverage is reused. The three strict fixture compiler checks observed 15, 20 and 33 statement shapes respectively, with maximum binding counts 14, 48 and 48. Counts overlap and must not be added as unique statements or new acceptance cases. They enforce D1-style expression depth, function-argument, parameter and SQL-size limits on actual SQL, but are not a real D1 runtime test. Full TypeScript and scoped lint passed.

Historical evidence preserves two genuine new-helper failures before repair: inherited error acknowledgements were accepted, and cumulative acknowledgement size was checked only after whole-envelope serialization. A separate first-run fixture error used a revocation time earlier than its original approval; that setup error was corrected to the actual original approval time. The misleading original mutation fixture and a test-name filter that selected no case are also preserved as instrumentation history, not product defects or accepted checks. No accepted live journey, broad V8 suite or provider test was repeated. Network/media egress is trapped, no native source rows or financial records are created, and no real payer, consent or asset is used.

## Next dependency

Genuine native custody needs the separate attempts/reads/native/controller leaves together with allocated Audio-only hooks in `intake-authority.ts`, `project-intake-read.ts`, `project-intake.ts` and `private-content-storage.ts`. The existing generic append acknowledgement observer can remain unchanged. This increment neither reserves nor modifies those hooks, and preserves closed Story authority.

Later Audio source/evidence/handoff propagation is distinct from a finite public current-context/quote read owner. In particular, the accepted Audio authorizer's post-admission context reload is not covered by these four intake operations. Public entry guards, review/authorize read accounting, Run, result/status/downloads, real payer/audience/caps and schema activation remain separately scoped. No broader server-owned generation architecture is made a prerequisite.
