# Dormant guest session and claiming lease

This increment implements only a disabled, server-internal session and claim-lease ledger. No production importer, route, schema installer, policy provisioner, cookie, OTP integration, guest account or provider operation is added. Its exported DDL is exercised only in disposable test databases. No actual terms or identity is provisioned.

An explicitly stored, immutable policy supplies an exact HTTPS origin, validity interval, session and lease lifetimes, maximum lifetime session count and maximum lease acquisitions. There are no policy defaults. The seven-day validation ceiling is a technical upper bound, not adoption of the proposal's seven-day retention policy. Database time controls admission, expiry and renewal. Policy revocation is irreversible through the schema.

Each internal issuance generates a distinct guest subject, session, Project and Document ID and two 256-bit secrets with separate session/claim domains. Only their hashes persist; neither secret is a public read-share credential. Generated Project/Document IDs are reserved intent identities only: no native records, Creator capabilities, provider allowance, native document ownership or account-wide Memory is created. Issuance has a finite atomic policy-wide count. A lost issuance acknowledgement can consume an additional slot on retry; it cannot exceed the total cap or allocate paid work. Ingress replay/rate limiting is still required before a public route exists.

Lease acquisition requires both original guest proofs and the actual `readExistingPrincipalRequest` canonical Creator. It refuses missing accounts, new lifecycle continuations, impersonation/project cookies, fictional users, unaccepted terms and missing personal-author capability. Email equality cannot merge subjects. Existing native principal/pilot/custody SQL guards run at mutation and final return; the module never constructs authentication headers or a writable guest `PilotUser`.

The lease is pinned to one destination and manifest digest. The digest is an untrusted, immutable intent commitment, **not** an attestation of complete native custody. Exact same-request replay returns the same unextended lease. Competing subjects or changed manifests fail. An expired lease can be reacquired by that same subject and digest with a fresh request ID, within the original guest lifetime and bounded acquisition count. Lost database acknowledgement resumes the same record. Revoked/expired guest proof has no implicit recovery path. All return values say `status: claiming` and `custodyTransferred: false`.

There is deliberately no `completed` state or completion API. Completion must be introduced only alongside a real native custody transaction and a witness minted by that transaction. A future public ingress must deliver the session secret in a Secure, HttpOnly, appropriately SameSite cookie, separately protect claim proof/CSRF, enforce trusted origin and bounded abusive attempts, and not log either secret. This module is not ready to be wired to a public endpoint on its own.

## Focused validation

Source tests use actual SQLite and actual native principal/access functions; only synthetic identities are bootstrapped in fixture setup. Network and R2 operations are tripwires. Tests compare all non-guest tables before/after successful flows. Coverage includes purpose and cross-session forgery, exact origin/method, closed explicit terms, policy/session revocation, DB-clock admission, account/terms/context rejection, atomic cap, concurrent claims, immutable manifest/target, lost acknowledgement, live permission and revocation races, expired lease renewal and refusal of expired-session recovery. These are local lifecycle checks, not browser login, public abuse-load, native asset adoption or guest generation acceptance.

## Next native custody work

The existing native graph cannot be adopted by updating displayed owner IDs:

- Draft identity/hash commits to the original owner and `creative:<owner>` stream.
- Event IDs are globally unique and `(stream_id, sequence)` is unique; the destination already has its own sequence history.
- Original native command, completion and retained-output proofs check original actor/owner and financial/provider identities.
- Private event bodies, private content, artifact revisions, jobs, output scopes and R2 namespace/metadata are distinct custody boundaries.

The smallest safe next increment is a read-only **native claim inventory witness** for one exact registered shape, after the guest source is genuinely persisted. It should pin full native source/event/private/revision/asset rows and byte hashes, reject unknown dependencies or in-flight/uncertain jobs, and produce a database-identity-bound opaque witness. It must not certify a caller-supplied manifest. This inventory alone still cannot complete adoption.

For final adoption, prefer an explicit current-custody receipt while keeping original actor, provider and financial history immutable. The native readers and future authoring path must deliberately understand that receipt; otherwise retaining old rows makes target work unreadable, while changing historical actor/payer to pass checks falsifies provenance. Exact event namespace/ordering and destination editor hydration must be resolved with the owners of native events, Jobs/Outputs, host/store/bindings. Existing `document-duplication-api` remaps identifiers and is not same-Document claim. Existing organization transfer explicitly excludes personal project custody.

R2 copies must be staged and hash-verified before a single final D1 custody/manifest/claim/revocation transaction. Interrupted copies retain original authority; orphan cleanup has durable state. 3D closure includes model/dependencies/poster/reference provenance and saved-view receipts. Text-only staging does not waive remaining media adoption. No financial settlement/hold adjustment is part of claim.

Unknown sponsor payer/audience/caps do not block this disabled ledger, but actual guest generation and public launch require those approvals. Guest retention/deletion and any new passwordless identity issuer/linking flow remain explicit decisions. Existing trusted canonical login needs no new OTP issuer to be the eventual destination.
