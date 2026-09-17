# Short story sponsorship: dormant native admission and execution, tranche B

This increment composes the existing native Short story job with sponsor approval, immutable issuance evidence, atomic admission, execution and original financial settlement. It is restricted to canonical principals and personal Documents. It does not install sponsor schema, approve a live campaign, register an issuer route, enable guest Story spending or publish a new provider journey.

## Resulting behavior

A distinct policy/envelope V4 with `family: canonical-short-story@1` permits exactly one tranche-A Story template and resource V1 terms. It retains the original actual `planning:0:initial` call, `render_document` job, `short_story` artifact and `document-render:short_story` accounting operation. The actor owns the Document, job, output and retained content. Only the explicitly approved distinct sponsor pays; actor funds do not provide a fallback.

The existing explicit payer-authenticated approval action binds the exact Story terms and digest. Old Image approval terms cannot authorize V4. The existing `loadApprovedSponsorCampaign` remains Image V2-only; Story uses `loadApprovedSponsorStoryCampaign`. Default disabled, V1/V2 Image parsing/JSON/digests and guest V3 dependencies remain unchanged. Resource V1 does not grant initial-draft storage or read egress.

Native admission reconstructs the retained Story quote through tranche A, matches its exact source/rights/input/transfer/recipe/quote fields, and uses the same opaque admission capability and native transaction. The transaction creates one ordinary native job, one original slot, one `planning:0:initial` route, a paired sponsor reservation and immutable consumption/occupancy. No parallel billing ledger is added.

Execution reconstructs immutable issuance and the original authorization, then rechecks current Story source/quote, campaign, approval, issuer/resource authority and original monetary identity. A fresh read revision is used solely to validate the original quote against current native context; it emits no new authorization. The native provider request-byte, completion, custody, private storage and accounting checks remain unchanged.

The events gate derives its permitted action from the opaque original financial binding and exact environment/DB/slot/grant/scope. Image still permits `generate`; Story permits only the actual manual `render_document` / `short_story` native narrative payload. Another document artifact, managed mode, raw marker, forged binding, switched DB or slot reference does not obtain this permission. The rejected 3D dispatcher is untouched.

## Original money versus current permission

The separate Story monetary query retains the existing Image ownership/stream/plan/grant/slot/consumption/reservation predicates and adds exactly the original Story job/operation/one-call route and immutable V4 issuance identity. It does not require live policy, consent, creative private bodies, active jobs or unexpired grants to account for already incurred known usage. Revocation stops new work and publication; it cannot convert the actor into the payer or prevent correct original settlement. Uncertain calls continue to retain occupancy under the existing native terminal-release rules.

The existing Image `FINANCIAL_FROM` SQL literal is unchanged (2214 bytes, SHA256 `c31f5794d7ae23f0a3a42a1989ae92cfdbf2e1d763d8a1d516aa23454ce55a99`). Compatibility evidence additionally pins exact original V1/V2 policy/envelope and V2 approval canonical JSON/digests against source extracted from `9fb1f8bc2921c17ac0cab76977d7351b394f6ae3`.

## SQL defect found during actual composition

The first actual Story admission failed both strict local SQLite and pinned local workerd D1: combining native receipt, resource and approval predicates inside one final CASE exceeded expression depth 100. A first attempt using sibling CTEs also exceeded that engine limit. After separating the resource/approval checks, strict diagnostics isolated the long native receipt conjunction itself and the later wrapped Story monetary predicate. These failures and their complete SQL/bindings are preserved externally; none is relabeled as passing.

The final V4 composition keeps the native receipt witness separate, using an explicit balanced equivalent of all 51 original predicates with the same joins and bindings. An exact original-SQL digest guard fails closed if that upstream proof changes before this mapping is reviewed. The Story monetary predicate likewise balances its 40 top-level conjunctions while preserving nested subqueries, scalar types and binding order; the Image literal is untouched. Complete resource and approval predicates each run as their own CASE/CHECK statements in the **same existing native DB.batch**, after native holds and consumption/occupancy insertion. The unchanged composer then inserts the command receipt and verifies the equivalent native receipt predicate. False or NULL guards abort and roll back the whole admission. The resource check sees the newly occupied slot. No predicate, receipt binding, atomic boundary or shared ledger implementation is removed. Image V2's existing composition remains unchanged.

## Qualification and limits

The new synthetic fixture uses actual session/context/requirement save/confirm/preflight handlers and actual payer approval, with a clearly labeled fixture-only immutable issuance row. It runs the real native authorize, queue, document runner and settlement against one intercepted synthetic Responses completion. It checks actor custody, exact stage/cost owner, duplicate suppression, public/forged refusal, depleted-budget separation, expiry/revocation, retained-source erasure and monetary settlement independent of publication permission. It is not the real issuer/driver; that is tranche C.

The local D1 qualification runs native production modules in Node against actual pinned Miniflare/workerd D1. It is not a bundled Worker or deployed production test. SQL capture checks parameter counts and byte limits, typed binding behavior and atomic false/NULL/late-withdrawal rollback. A local loopback server is required; every nonlocal transport is refused except the exact synthetic provider interceptor, and loopback redirects are disabled. The stricter SQLite compile checks cover depth 100, 32 function arguments, 100 bindings and 100000 SQL bytes.

Final checks passed: 61 new pure policy cases (including fixed Image canonical JSON/digest goldens), 12 new native Story groups, 85 affected existing Image cases, full typecheck and scoped lint. Actual local D1 passed its single composed test: 372 schema objects and 1,554 captured statements, at most 59 bindings and 16,996 SQL bytes. Independent source and test reviews found no remaining findings. The D1 test also preserved and corrected a test-only numeric-binding assumption: a bound JavaScript number has SQLite REAL storage in this engine.

All outputs, accounts, approvals, policies, source text, provider responses, costs and databases used by these checks are synthetic. Recorded amounts demonstrate app accounting behavior; they are not provider invoices. Historical fixture failures (one returned ancillary item instead of the native three; an initially assumed budget error name) are preserved and distinguished from the actual SQL product defect.

## Remaining work

Tranche C must compose a real dormant Story issuer/driver. Tranche D must add explicit Story intake storage/read allocation and finite status/result reads with qualified native alias boundaries. The current Markdown download is a client Blob from retained Story bytes, so finite result-byte protection is the relevant egress boundary. Canonical Story requires no ownership claim: the actor already owns the Document. Guest V3's separate claim behavior is unchanged.

Live policy selection, payer approval and activation remain separate requirements. Broader server-owned automatic generation is not required for this bounded native synchronous route. This increment does not establish whole-original-plan completion or sponsored support for the other six non-Image outputs.
