# P5 R23 — approved log read completed; historical window unavailable

**The one approved native log read succeeded, but returned100events entirely after the failed R21 navigation. It cannot establish whether that request reached the Worker or why the browser blocked it.** No second query, navigation, redeployment or other hosted action followed. [Redacted receipt](25-worker-logs-redacted.json) · [Ledger](request-ledger.json).

The user approved the exact [R22 decision](../forma-r22/decision.md) with “Approve.” Reservation25 was durably saved, fsynced and read back before dispatch. The native call used the project copied from the verified R21 receipt, `appgprj_6a7a020e334881919ed8aea0363cb98f`, with `since_minutes:62`, `limit:100`, `errors_only:false`. Returned project matched; native `isError` was false. The62-minute lookback covered the attempt, but a recent-event cap is not a complete time-window result.

| Evidence | Observed interval/count |
| --- | --- |
| Original R21 action interval | September28,2026,23:57:45.950721–23:58:30.915793UTC |
| Returned event timestamps | September29,2026,00:22:25.002–00:55:20.444UTC |
| Native events / requested maximum | 100/100 |
| Returned events inside the original interval | 0 |
| Relevant event metadata retained | 0; unrelated contents omitted |

The original interval is before the earliest returned event. This does **not** prove no invocation occurred: recent traffic filled the bounded result, and log capture/retention/restored-version scope remain unspecified. No response status, qualification JSON, principal/schema/hold/custody proof or browser blocking reason for R21 was obtained. A successful connector log read is not proof that the browser qualification request authenticated.

An initial local route filter used an unavailable `URL` constructor in the orchestration runtime. Its route-only counts were invalidated and removed. The independently computed numeric timestamp range establishes the interval exclusion without route parsing. Raw logs had already been discarded after privacy filtering; no second native read was made to compensate. This local processing limitation is disclosed in the receipt. Only aggregate coverage and approved metadata were durably retained; no raw log dump, credentials, request headers, account data, query values or private document bodies were written to the evidence/report.

## Concrete next gate

The supported native log tool offers a lookback, maximum100recent events and an error filter. It offers no absolute end time, route filter, offset or pagination cursor. Increasing the lookback cannot force older events into a newest100 result; changing to errors-only would miss a successful dispatch and is not an authorized retry. The documented browser API exposes captured console messages but no retained network-failure/policy-decision trace. Both retained console filters were already empty in R22.

The missing capability is a supported read of the **specific retained navigation failure**, or a native historical log slice anchored to its interval. A concise [platform capability request](platform-capability-request.md) is prepared, not sent. It specifies the exact event, bounded metadata, possible outcomes and supported-path question. No root cause is invented and no new general infrastructure project is proposed. Do not redeploy551 to reproduce, switch surfaces, extract credentials or weaken security to obtain that observation.

## State and authority

Ledger now **19/22normal,6/6recovery;25total charged**. Three normal and zero recovery remain. All24prior entries are identical; original stopped R21 ledger is unchanged. The log-only exception is consumed and normal work is stopped. No capacity transfer or ceiling amendment occurred. Underlying native/browser/authentication HTTP and prices remain unknown. Any later deployment/qualification resumption still requires explicit sufficient recovery; a prior maximum6normal/3recovery plan would now require+3normal/+3recovery, which is arithmetic only, not approval or a selected plan.

Last verified live state remains restored550/environment16/workspace_all/access7 from R21; this log read did not freshly verify it. Saved/admitted551 and exact R15/R17 source/archive remain retained and unchanged. No rebuild, push/save, migration, fixture, custody, grant, provider request, Stop/Cleanup or control change occurred. Purchase/custody controls remain off. R19's Google denial remains historical and R20 authentication approval remains accepted. Migration evidence basis and production retention remain settled.

Infrastructure readiness: admitted551 and successful predecessor restoration known; qualification transport unresolved. Prompt adherence: no real comparison images. Moderation: no new finding. P5 remains open for the separately authorized real two-image comparison with exact request/provider evidence; StageC custody and paid generation remain separate. Preserve P2 human-resume/original-settlement gates, sixPOST/twoimages/concurrency1/no retries,847/six exclusions, R14disabled/originalcleanup and existing retention. No automatic renewal: September30 22UTC margin and October1 00UTC expiry remain unchanged. Redacted receipts remain under accepted indefinite restricted P5 evidence/Git retention owned by westbrook.johnson@reve.art.
