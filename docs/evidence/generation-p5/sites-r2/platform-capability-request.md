# Draft capability request for Sites — not sent

We use Sites-managed hosting for Forma, project **appgprj_6a7a020e334881919ed8aea0363cb98f**, currently v550, source **c28af5fea0fc3ec2b37b878a544ec59c52a64daf**, environment revision 16, logical **DB/MEDIA**. We need one finite synthetic rehearsal of its authenticated image-study adapter before asking to run two paid images. No live provider call is needed for rehearsal.

Please identify a supported way to run the reviewed Worker with an **isolated D1 application dataset and fixture-only environment**, while the ordinary Forma version retains its existing production DB, R2 and credentials. The current connector/manifest exposes one DB binding and Site-level environment; we found no per-version isolated binding, disposable environment or clone control. We do not have or request end-user Cloudflare account credentials, raw physical IDs or an unrestricted SQL endpoint.

Required behavior:

- Bind a compiled fixed-function fixture to known logical DB/R2 state, exclude production authority/content and live credentials, preserve authentic Sites sign-in/origin enforcement, and make the fixture/version/environment mapping reviewable.
- Install bounded schema-only appended migrations through Sites, preserving applied history; expose exact success/partial-failure receipts. Run fixed P5 assertion batches to observe atomic rollback, duplicate/concurrent commit, lost acknowledgement, revocation/expiry and durable original intent across requests. No user-authored SQL or raw grant-entry endpoint.
- Allow a bounded compiled synthetic provider transport with unmatched egress denied, original R2 put/read/hash/delete/read-null observations, and durable one-run disablement. Preserve required financial metadata and production data; disclose storage/backup deletion limits.
- Expose applicable request/query/batch/CPU/memory limits and resource charging/retention terms sufficient to review the exact finite fixture. Forced isolate restart is optional if unsupported; identify its absence so cross-request durability is not mislabeled as a forced-restart test.

Acceptable evidence is a supported native API/manifest procedure or platform-documented logical isolation guarantee tied to Site/version/environment receipts, plus observable runtime markers/transaction/custody results. Physical infrastructure UUIDs are not required. A documented equivalent may be acceptable if it establishes the same no-production-access invariant; key prefixes alone do not isolate canonical users/budgets/holds tables.

If this is unavailable, please state whether an explicitly authorized successor on the existing retired owner-private D1-only Site **appgprj_6ab5929a74288191bf37ed429f7a7e20**, with newly approved R2 and schema deltas, is the supported option. Its original N10H run is complete and must remain disabled; no reuse is currently authorized.

Separately, the empty disabled Forma bundle can be published through normal source/archive/version validation. That does not require study schema or paid authority, and its publication does not resolve this isolation question.

This request asks for a capability/procedure, not deployment, provisioning, wider access or purchases. No contact has been assumed and no message has been sent.
