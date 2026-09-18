# Dormant existing-account context claim coordinator

`worker/experience-guest-context-claim.ts` coordinates existing native guest
context adoption and retained-plan custody. It is a new internal module with no
public route, cookie operation, schema or policy activation. It does not create
an account, verify email, choose a destination, generate an output or move media.

## Contract

`claimGuestContext(request, env, {sessionId, requestId,
approvedManifestDigest, proof?})` accepts the actual strict same-origin HTTPS
POST and a closed, copied intent. The native read-only principal path determines
the existing canonical Creator destination. No identity or destination is
accepted in the input. A supplied purpose-separated proof must match the session
selector. Query strings, cross-site metadata, unsupported methods, aborted
requests, extra fields and ambiguous proof shapes fail closed.

The coordinator first reads a completed native canonical adoption. Exact request
ID and approved manifest must match; completed recovery does not require usable
guest credentials, because adoption revokes them. If no receipt exists, current
guest proof is mandatory. The coordinator obtains the real opaque inventory,
matches its digest, acquires the native lease, then passes that witness directly
to native atomic adoption. It never rehydrates a caller-provided inventory or
automatically retries a failed lease or adoption. After uncertain acknowledgment,
only the exact completed canonical receipt can establish success.

After confirmed adoption, the coordinator captures the current opaque canonical
adoption witness and immutable lineage digest. `retainGuestContextPlan` is the
final awaited success operation. Its existing final query proves both current
canonical custody and retained private-plan authority. Synchronous comparisons
bind the returned plan to the exact lineage, destination, resources, event IDs and
head; no later await can return private bytes after only rechecking context.

The successful result explicitly reports `contextCustodyTransferred:true`,
`planRetention:"retained"`, `generationAvailable:false` and
`miniAppClaimComplete:false`, along with the native receipt and retained
context-only plan. The receipt comes from a current canonical reread, so its
`replayed:true` does not mean adoption predated this coordinator invocation.
The retained-plan replay flag describes that separate retention operation. No
combined generation/claim completion is implied.

## Partial custody and recovery

Context transfer and plan retention are separate native transactions. Failure to
retain cannot roll back an already committed adoption. The coordinator freshly
reauthorizes the exact canonical receipt and may return a source-free partial
result with `planRetention:"unavailable"`; it contains no retained plan or old
private bytes. "Unavailable" means current availability was not confirmed, not
proof that no copy committed. Revoked destination access, DB replacement or an
aborted request are failures, never disguised as partial success.
Cancellation stops later phases; a native mutation already in progress can
complete, and a later explicit request must recover its actual canonical receipt.

An explicit later POST can recover the same receipt and attempt retention again.
Native retention is idempotent and never refreshes or recreates an expired copy.
No GET, link prefetch or automatic retry performs custody/retention work. Original
guest actors, plan hashes, resource IDs, private source history and financial
records remain unchanged; native adoption only creates its existing canonical
baseline and immutable lineage, then revokes guest authority atomically.

## Scope and qualification

The source inventory still rejects generated jobs, outputs, media and unrelated
sidecars. This is a context-only same-Document claim and saved-settings reopening
stage. Full original guest mini-app acceptance also requires the separately
designed result/media graph custody and verified public entry. No new OTP vendor
or full durable-generation architecture is required to qualify this dormant
existing-account coordinator.

Focused synthetic tests use actual native source, inventory, lease, adoption and
retention implementations. They cover exact completed recovery, concurrency,
uncertain acknowledgments, partial retention, current authority and no unrelated
side effects. Separate local workerd D1 executes the composed native lifecycle;
strict SQL limits are checked before acceptance. Fixture-only account/schema and
policy setup does not represent production provisioning or activation.
