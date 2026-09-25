# P4 — local producer connected

The exact `generation-supplied-study-approval` operation now runs through authenticated preview, explicit commit, private intake and the reconstructed P2 host. This is a local implementation result. **Live execution remains disabled; no real grant, consent, funding, provider request or hosted qualification exists.** The fixture decisions are explicitly synthetic. Report review is not financial consent.

Continue from P3 `c25ec7780527bf959a121a63a74bcfc05d85a428` in `/private/tmp/forma-p3-approval-connection`, branch `codex/forma-p3-approval-connection`. Local `main` `c28af5fea0fc3ec2b37b878a544ec59c52a64daf` is already an ancestor; cached `origin/main` is `1face58997dd1c9662cfe20a5f4a8a41c041614d`. No fetch, merge or push was needed or performed. The original checkout and historical P1/P2/P3/C2 envelopes remain untouched.

## Run and inspect

From this worktree, with the existing installed dependencies:

```sh
node --import tsx scripts/serve-generation-p4-review.mjs
```

Open [the loopback review](http://127.0.0.1:4194/?progress-report). Choose either synthetic financial mode and load its full review. “Simulate the displayed decision” calls the real authoring operation and shows its immutable receipt plus database counts. Load a missing account, lifecycle, deletion or bounded-proof case to see commitment disabled. The page has no execution endpoint. It binds only `127.0.0.1`, checks Host and same-origin POSTs, and uses an in-memory database. The fixture clock is September 24, 2026. Its fixed mock edge supplies the synthetic principal to the existing authentication code; it is not a production identity proxy.

```sh
node --import tsx scripts/run-generation-p4-demo.mjs
node --import tsx --test tests/generation-p4-approval.test.mjs
node scripts/check-authoring-study-schema.mjs
node scripts/seal-generation-p4.mjs
```

[complete-chain.json](complete-chain.json) retains both modes' complete displays, exact simulated commands, receipts, database counts, human/settlement gates and original stage/evidence rows. It also records four non-committable missing-evidence scenarios, including actual-classified proposals inside an explicitly synthetic fixture. `interface.md` describes the exact callable contract. `verification.json` distinguishes source tests, built artifacts, browser verification and unqualified live assumptions.

## What changed

`worker/authoring-commits.ts` exports a separate versioned side-effect operation. Its ordinary document plan union, event proofs and commit implementation are unchanged. The producer uses the existing personal-administrator, origin, pilot, principal snapshot, Memory/project exclusion and atomic assertion components. It does not use the sponsor producer, invent document events, accept raw policies from HTTP or register a financial endpoint.

The server owns the proposal, complete P2 plan, source and agent-authored direction bytes, exact protocol, runtime/candidate/inventory/operation identities, expiry and typed private evidence references. HTTP requests supply an opaque proposal ID. Commit must match the retained preview, complete display digest, immutable intent and exact mode-specific decision. Administrator status and request flags alone grant nothing.

The default-off approval switch is `FORMA_GENERATION_STUDY_APPROVAL_ENABLED`. The separate existing execution switch remains `FORMA_GENERATION_STUDY_ENABLED`. Neither is installed or activated on a real target. Approval creates no operation, budget reservation or provider dispatch. Optional SQL is unregistered and was installed only in disposable local fixtures.

One `env.DB.batch` commits the study grant, exact supplied review, both F3 grants, two private copies and authoring receipt. It asserts the current principal, schema, configuration, evidence authority/content/expiry, complete retained display and resulting rows in the same transaction. P2 intake was split only to expose statement construction; the legacy intake still performs its original authentication, two-financial-grant checks and guarded transaction. P4's receipt/configuration/evidence guard is also consumed at each later P2 supplied-authority boundary.

Seven material inserts are fault-tested independently. Failures and changes injected after all seven writes roll the entire transaction back. Identical concurrent commits and a lost commit acknowledgement return the byte-equivalent original receipt only after current authorization; revocation prevents recovery. Conflicting display/intent/configuration cannot create a second receipt. Immutable schema constraints retain proposal, intent, review and operation uniqueness.

## Financial and private custody

Both `accepted-estimate` and `bounded-proof` compile into the unchanged F3 validator. Each arm requires typed account, rate, liability, settlement, lifecycle and deletion records; bounded mode additionally requires its scoped bound record and nonzero substantiated maximum. The private display includes all terms and evidence contents. Accepted estimate explicitly shows unknown maximum exposure and no provider-enforced cap. No mode is selected for the user.

The optional server configuration and verified evidence records are a **trusted input interface**, not a new external billing, funding or deletion verifier. The HTTP operation cannot create them. Local fixtures supply marked synthetic records. Real issuance must come from identified, qualified server owners; hashing a document, an administrator flag or labeling a row “verified” cannot establish the truth of its claims. Real account bindings, rates, liability decisions, funded retention and named deletion/settlement authority remain unfilled.

Immortal `policy_json` uses fixed descriptions/enumerated vocabulary and opaque evidence IDs; it never copies evidence `terms`, prompts or source text. Tests put a source canary in every private term and verify it does not enter finance or the receipt. Private evidence and full previews have distinct personal kinds, expiry and Memory/project exclusions. Their opaque metadata references intentionally do not foreign-key-block private-content deletion. Deleting private content preserves immutable accounting identities and active holds, and denies further execution. This local deletion exercise proves neither remote physical erasure nor funding/lifecycle closure.

The later host still uses six one-use provider POST slots and nine evidence records per arm. The synthetic baseline tether finding remains measurable and requires an explicit simulated human observation. Treatment waits for original settlement and funded lifecycle evidence. Existing safety, invalid moderation, custody, uncertainty, one-shot deletion and original-only recovery behavior remains covered by the P2/C2/F3 regressions. No quality improvement is claimed.

## Evidence and limits

75 new producer tests, 248 P2/C2/finance/context regressions and 77 document-copy/Canvas authoring regressions pass (400 checks total). The application build, TypeScript, changed-file lint, optional SQL contract and separately bundled producer/host default-off traps pass. The two synthetic complete-chain runs each retain 18 evidence records and consume exactly six intercepted POSTs. The browser exercise confirms a positive simulated decision and missing-lifecycle refusal. The final display and evidence scope also enumerate the added private preview, 12 or 14 private financial evidence records, opaque reference metadata and seven material commit inserts. Both the report and demo are independent local servers; the Developer UI return link appears only with `?progress-report`.

`built-host.json` records the actual changed source graph and bundled artifact identity. `release-envelope.json` binds source, tests, UI, schema, logs and this adoption packet. `execution-proposal.json` binds a successor runtime identity to the original exact P2 packet; it is explicitly unapproved and does not reuse fixture authority. The demonstration's smaller mock runtime ID is labeled synthetic; it is not a deployment attestation. Historical envelopes are retained as historical evidence, not falsely revalidated against changed source.

## Adoption decision: park live execution pending concrete facts

Local producer work is complete. The next decision is whether the following finite requirements can be met for one qualified pilot; otherwise keep it parked. There is no next generic framework task.

1. Identify the actual payer/principal and server evidence owners. Supply real account/region/credential binding, exact rate/inventory evidence, one consciously selected F3 mode and its explicit liability decision, original-charge settlement verification, funded financial retention and named deletion operator. Bound mode requires substantive bound proof; estimate mode requires explicit unknown-exposure acceptance.
2. Qualify the existing target's actual trusted identity edge, runtime, physical `DB`/`MEDIA` bindings, installed schemas, transaction limits, storage custody/expiry and operating/funding/deletion responsibilities using a disposable same-runtime fixture. The existing Sites metadata is only a compatibility lead. No physical bindings have been attested; Node/SQLite and Node-bundle results do not qualify managed D1/workerd/R2. No separate GKE pilot port or new hosting service is authorized.
3. If both are feasible, prepare a newly approved exact source/runtime/financial packet and then request the finite pilot decision. This expired-or-expiring proposal never renews automatically. Current deadline remains **October 1, 2026, 00:00 UTC**; a later review requires a new exact packet.

N10H remains complete, N8A parked, N6 archived; original 847/six source exclusions remain intact. No census, source backfill, live preflight, provider call, account change, schema/grant installation on a real target, runtime activation, publication or message occurred.
