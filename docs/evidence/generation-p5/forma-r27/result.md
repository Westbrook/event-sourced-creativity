# P5 R27 — diagnostic reached a logged200; restoration check pending

The approved full cycle deployed saved551 and made exactly one qualification navigation in existing tab8. The browser reported `net::ERR_BLOCKED_BY_CLIENT`, but the immediate native Worker-log read captured **one GET to the exact qualification route inside the attempt interval, status200,outcomeok**. This is new corroborating evidence of Worker activity during the attempt. The browser supplied no request/trace identifier, so attribution cannot be uniquely proved. No application JSON was obtained and no principal/schema/hold/custody qualification is claimed.

The subsequent native restore550 call returned **internal error-32603 without a deployment ID**. Its backend outcome is unknown. Last confirmed live deployment is551. The [exact bounded recovery lookup](recovery-decision.md) is pending approval; no blind restoration retry is proposed.

## Retained evidence

- Tab8 was bound through explicit `cua.getTab` and its origin checked before deployment. An earlier binding form was rejected by automatic approval review as undocumented; it performed no hosted action. The explicit CUA form succeeded. Its incidental initial document snapshot was not copied into P5 evidence/report.
- Fresh target,environment and saved-version checks passed: exact owner target,workspace_all/access7,environment16/redactedkey-secret-presence metadata,source and admittedarchive unchanged.
- Deployment551: `appgdep_6abba8a798a88191850f1b72b6563b66`, terminal succeeded at2026-09-29T12:01:57.409521Z.
- Qualification browser interval:12:02:45.305Z–12:02:48.503Z on September29. One navigation; no body or HTTP status received by browser tooling.
- Matching logged event:12:02:48.058Z,GET `/api/internal/generation-study/qualification`,status200,outcomeok,requestID `882b053103b599b9669b4163ca5e361b`,traceID `fefdbc4f99abd2c9af62239a600f74b7`,rayID `a42ad73958785f83`. Native script-version ID `3afbca95-db42-4f16-98b6-20c3ec0e38ed` is retained as supplied, not equated to a Sites saved-version ID.
- Immediate5-minute native log read returned7events and did not hit its100event limit. Exactly1event matched route/time/method. Coverage/sampling completeness is still unspecified. Six unrelated event contents were omitted. The local classifier used exact string route checks, passed positive/negative/missing-field checks and did not use the unavailable URL constructor from R23.
- Restore550 reservation39: native error-32603; no deployment ID or terminal state returned.

Ledger currently **29/30normal,10/13recovery,39charged**. Sixnormal andonerecovery consumed in this cycle; all32prior entries preserved. No diagnostic retry,secondqualificationread,sourcebuild/push/save,migration,fixture,provider,custody orgrant occurred. Existing cost/retention/authentication/migration decisions remain settled. Rawlogdump,headers,cookies,credentials,queryvalues andprivatebodies are not retained.

## Meaning and next gate

The matching Worker event makes a purely pre-dispatch explanation less plausible for this attempt, but it is not a proven browser root cause and does not retroactively identify R21. A200log is not the missing qualification response body. The next browser-path observation may be the already queued manual read using normal controls, but restoration state must be resolved first and any later attempt needs its own exact authority. No alternate surface or security bypass.

The available saved-version read exposes the latest deployment ID and can potentially recover the ID absent from the failed native response. The recovery proposal uses only existing remaining capacity and does not resubmit a deployment. If unavailable,ambiguous ornonterminal,report exactknownstate and stop.

Infrastructure readiness: deployment and matching Worker GET observed; browser receipt incomplete; restoration uncertain. Prompt adherence: no real comparison images. Moderation: no new finding. P5 remains open,StageC/paid separate,controls last verified off. Preserve P2 human-resume/original-settlement gates,sixPOST/twoimages/concurrency1/no retries,847/six exclusions,R14cleanup/retention and September30 22UTC margin/October1 00UTC expiry without renewal. Owner-only qualification functionality may remain available on551 within existing workspace audience until restoration is verified; no deletion or erased history is claimed.
