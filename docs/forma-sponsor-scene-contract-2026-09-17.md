# Dormant Scene sponsor contract and evidence

This new-only increment defines the `canonical-scene-screenplay@1` family. Its local template version is 1; future sponsor protocol **V6 is reserved, not enabled**. It changes no Image V1/V2, guest V3, Story V4, Slides V5, shared union, route, schema, issuer, permission, native source, reservation or deployment. It returns immutable data with no authority brand or capability. No live provider journey, private asset, campaign, share, invoice or payment is exercised.

## Contract and APIs

`worker/experience-sponsor-scene-contract.ts` exports:

- `readSponsorSceneCampaignTemplate(raw)`: a closed immutable template or `sponsor_scene_contract_invalid`.
- `recipeMatchesSponsorSceneTemplate(template, recipe)`: finite shape/cap matching only, never source or release authority.
- `matchSponsorSceneTemplate(template, {recipe, offered})`: captures input before awaiting, reconstructs the entire offer through `outputScenePreflightConfiguration`, and matches the actual registered Scene release/revision, source-dependent settings and route digests.
- `captureSponsorSceneJson(raw)`: own-data snapshot, used by both leaves. Bounds: depth 24, 8,192 nodes, 524,288 aggregate key/string UTF-16 code units, arrays at most 8,192 elements. It refuses sparse arrays, hidden/symbol/accessor properties, unsupported prototypes, cycles and nonfinite numbers. Array length comes from its captured own data descriptor; no caller `get` supplies the bound.

The supported native contract remains one manually authored visual Scene, two ordered character slots, one location and 1–2 measured screenplay pages. The fixed native policy includes its existing font, metrics and pagination hashes. The actual source-bound Scene contract stays in the native payload, not in a campaign-wide substitute. Equal character names still have distinct A/B goals. Authored provenance, secret, knowledge holder and tension remain bound through the native intake, request and provider-input readers.

Exactly one `planning:0:initial` OpenAI Responses call uses `gpt-5.6-terra`: `{parsing:0, planning:1, render:0, repair:0}`. Native source-derived input quote is preserved, within 4,096–125,000; output cap 3,000; total reservation cap 128,000; maximum 1,000,000 microusd. Pricing is `openai-text-2026-09-02`. This is an application ceiling, not an invoice. No reference upload, managed/alternate medium, paid render, second call or repair is included.

The native request contract and dispatch capture remain the wire authority: strict `document_scene` schema, medium verbosity, low reasoning, `store:false`, default tier, explicit cache policy, actual client request/safety identifiers and byte-based input estimate. The contract matcher does not invent a parallel wire builder. Focused tests exercise the real wire capture, including altered model, store, tools, cache and output limits.

`worker/experience-sponsor-scene-evidence.ts` exports:

- `describeSponsorSceneAdmission(trusted, command, nativePreflight)`: inert canonical-principal description, exact source/transfer/settings digests and finite one-call recipe.
- `readSponsorSceneTemplateEvidence(trusted, command, recipe, nativePreflight)`: repeats the same native evidence checks, matches the caller's captured recipe, and returns only `{recipe, offered}`.

The command is the closed ordinary native authorize command plus the **already supplied** exact `sceneCostConsent`. It must carry `explicitAuthorization:true` and the exact `scene-mini-app-cost-v1` preview with `confirmed:true`. The collector neither adds confirmation nor claims that data alone proves a user gesture or sponsor consent. Future sponsored composition must bind the actual actor action and sponsor payment to the same immutable command/quote. Existing ordinary and legacy Scene approval semantics remain separate.

## Original proof and read-only lifetime

The caller supplies an actual `preflightOutputSceneTarget` object whose private WeakMap proof includes its genuine original `PreparedSceneCost.sourceVersion`. Serialized/copied/unversioned objects are refused. The collector does not call that factory, `captureSceneSourceVersion`, nonce activation, schema initialization, an authorization route or a provider.

It joins the exact original retained preflight and latest confirmed plan, unredacted private bodies, original attempt 0 with no predecessor, Project/Document/source/requirements and native target settings. It compares the entire supplied offer with the retained quote. It reconstructs current native provider input from the proof's effective snapshot and compares the original request input. It regenerates only the pure typed cost preview from that proof and uses `requireSceneMiniAppCostApproval` to compare exact retained/current/supplied values. It never generates output or refreshes a source version.

The trusted principal must be the current personal canonical actor and owner, with current policy consent and no guest, impersonated/project/pilot execution or rewritten billing owner. Existing principal authentication is reread from the original Request. Request identity plus URL/method/header bytes, principal identity plus full state, environment/DB identity, provider key/model/cohort, source/context/assertions and revisions are pinned across awaits. Provider key bytes are only an internal comparison; they are never returned, logged or hashed into an exposed result.

The final batch includes original native private-source/assertion predicates, the original version's exact schema/nonce/epoch/generations, current source/head/rights, exact principal SQL row and exact private quote/plan bytes. Every returned own data slot must exist, have `success:true`, a single row and integer `current:1`; sparse, proxy-hidden-length, inherited/coerced/failed predicate responses are refused. Original preflight/source/rights deadlines are checked before and after the read. A source edit/restore remains a version change and fails.

Local limits are separate from future campaign resource authorization: quote and plan bodies are restricted in SQL to 524,288 UTF-8 bytes each; JSON snapshots have the limits above; final proof has at most 128 assertions, 100 bindings per statement, 100,000 SQL characters per statement and 2 MiB aggregate serialized assertions. This is a conservative supported subset; oversized evidence is refused, not truncated. Current principal/native source-reader resource costs still require the future reviewed campaign meter. No read from this leaf is a durable permission for a later write or dispatch.

### Important producer handoff distinction

Persisting `OutputPlanPreflighted` advances the native source generation. An actual preflight object captured **before** that bookkeeping write is therefore stale afterward and is rejected. A caller may separately perform an explicitly authorized native source-preparation operation after the writes, produce a genuinely new current proof, and preserve whole-offer equality to the original retained quote. That is what existing native authorization does; it is not a collector fallback or a relabeling of the stale object.

The fixture makes this distinction explicit: real local intake/commit/prepare creates the retained quote; then a separate native producer captures a synthetic current version in setup and calls the real factory with it. The collector consumes that original current object without further writes. It also tests rejection of the actual earlier pre-write object. Migration 0038 and operational nonce activation occur only in disposable fixture setup. The collector's rows/schema/`total_changes()` snapshots remain identical.

## Scope correction and remaining integration

The earlier Scene audit's generic Markdown/Output asset capability did **not** establish reachable native Scene adoption. `resolveOutputNativeResult` rejects `scene_contract` before database or body access (`worker/output-native-result.ts`); canonical Scene recipes contain this contract; native adoption requires that resolver in `output-requirements-api.ts`. After the Image branch the resolver permits only Slides/3D. **Current native Scene asset/package refusal is accepted safe behavior.** Opening it is a future conditional feature, not a required remaining gap. The historical proposal is retained; this corrects its overly broad inference.

Actual retained Scene completion/current-revision reads, Jobs inspection, original same-ID Scene receipt, Experience intake/output, event/private-content hydration and artifact current/history/export aliases remain separate reviewed integration work. This leaf activates none of them. Selected public sharing is a different custody/permission composition.

The concrete remaining sponsor generation dependencies are:

1. Bind an actual Scene actor disclosure to the original immutable command and a separately approved sponsor envelope. Register future V6 through the shared owner's narrow reservation after Story/Slides work is frozen.
2. Compose the one-call `render_document` / `document-render:scene` financial proof and resource meters. Preserve original operation, replay, payer and uncertain-cost holds.
3. Resolve the existing Scene claim's actor/payer collision: `events-api.ts` uses billing owner in `ClaimedSceneBudget.actorUserId`, while `scene-paid-dispatch.ts` compares it to creative actor and `pilot-policy.ts` uses it as ledger owner. A future separately sealed Scene claim needs distinct actor/payer; ordinary guards must remain intact.
4. Carry the original proof through actual admission and paid dispatch; never recapture a mismatch. Qualify bounded retained reads and original metadata-only reconciliation separately from new generation authorization. Do not turn an expired campaign into a reason to retry or refund an uncertain original call.

No concrete dependency here makes the explicitly deferred server-owned generation architecture a release prerequisite. Native Image custody remains under its separate publication hold.

## Focused validation and review history

The 38 focused tests in `tests/experience-sponsor-scene-evidence.test.mjs` pass for this increment. It uses actual repository source, real local SQLite, registered Scene release, native retained source/factory, typed preview and wire capture; no WeakMap or native resolver mocks. The positive path reports 15 bounded statements with at most 23 bindings, no DB changes/jobs/slots/grants/reservations/provider calls, and zero network/media/asset access. It tests exact wire/settings/release, supplied actor approval, source ABA/epoch/nonce/generation/retention/expiry, copied/stale/unversioned proof, current principal/configuration and late Request/DB/environment/private-body mutation, malformed proof responses and local limits.

Independent review initially found descriptor array-length, actual release binding and principal/Request lifetime omissions in the new leaves. They were repaired and regression-tested. Expanded local checks also exposed the older shared proof helper's sparse-array behavior; the new leaf uses strict own-slot verification without editing that shared file. Independent response probes then found two remaining raw response-array length reads; both now use own descriptors. These are inert evidence correctness defects, not demonstrated live spending bypasses. A final independent check also required sealing the principal email, display name and consent timestamp, which feed the full authenticated principal. Those fields are now in the exact final SQL row comparison and tested. Original red logs are preserved in the sealed evidence packet.

Two initial test-fixture failures are preserved separately: a nonce mutation was correctly blocked by the actual database trigger; and the wire fixture used canonicalized schema key order instead of the native builder's exact serialized order. Tests were corrected to exercise a deliberate test-only nonce swap with restored exact schema and the actual original native schema. Initial lint rejected a deliberately sparse literal; the same adversarial case now uses `Array(2)` and a set index. Typecheck and scoped lint results and independent review are sealed with the final packet.

## Cancellation successor to the frozen leaf

The frozen `d23e46244f4df6880e7cf419248e5277f55e9fd2` collector omitted cancellation from its lifetime check. A single faithful test aborted the original AbortController-backed Request after the actual final database batch and reproduced return of inert evidence. Rows, schema and `total_changes()` remained unchanged; network/media/asset accesses were zero. This is a cancellation correctness defect, not a demonstrated spending capability or permission bypass. The original 38 focused and 32 independent accepted groups remain preserved; they were not rerun for this successor.

The successor pins the original AbortSignal and checks it together with the existing Request/environment/DB/principal/source state before the first read, immediately after the principal row, native authentication and retained quote reads, and around the final proof batch. An internal synchronous liveness/deadline assertion is also repeated after each public wrapper's await; that function never escapes either public return shape and cannot start reads or writes. Already-started reads are not rolled back or represented as cancelled transport. The collector refuses the result and prevents the next owned read.

Eleven new targeted groups pass: normal behavior and both public return shapes, late abort for both APIs, pre-abort with zero reads, abort after each owned initial read, and Request-header/principal/environment/AbortSignal substitution before another read. They use the original native proof and real local SQL; they neither mock proof predicates nor rerun accepted generation journeys. Native proof/resource/cost limits, SQL predicates, no-activation scope and all existing refusal boundaries remain unchanged. Exact original red pins, successor checks and independent review are retained in the separate cancellation packet.
