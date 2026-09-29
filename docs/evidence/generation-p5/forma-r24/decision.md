# P5 R24 — load saved551, then approve one fresh diagnostic

The user requested deployment of saved551 for continued testing, followed by approval of a fresh diagnostic and queued manual instructions if it fails. Deployment intent is accepted. **Execution is pending only an explicit sufficient reservation/recovery amendment.** R23 left19/22normal and6/6recovery charged:3normal and0recovery remain. No hosted action has occurred in R24.

## Exact amendment and target

Approve **+4normal and+4recovery** ceilings, preserving all25charges. New cumulative ceilings: **26normal,10recovery,36total**. This permits at most **7further normal and4further recovery** reservations for the stages below; no transfer, reset or automatic expansion. Capacity allocation is not diagnostic approval: after terminal551deployment I will request the user's go-ahead before dispatching the one qualification navigation.

Use existing actual Forma, **not** the separately retained synthetic Site:

- Project: `appgprj_6a7a020e334881919ed8aea0363cb98f`.
- Saved/admitted551: `appgprj_6a7a020e334881919ed8aea0363cb98f~appgver_dc5968eecc788191bfae9709c514379a`.
- Source: `d147817ff14b502a8fc116a74fa5388f9fe7ad62`.
- Native archive SHA256: `79c7f2c618e5cbe68ad454e27d5649bb24e33cf129bc0947638247af7eb50aa2`,622files,44,728,320bytes; R15release/R17localpackage unchanged.
- Production origin: `https://forma-creative-studio.reve-ai-0869.chatgpt.site`.
- Restoration550: `appgprj_6a7a020e334881919ed8aea0363cb98f~appgver_e2949878bb5c81919d4845ec5e3cb3f8`.
- Preserve environment16 and exact workspace_all/access7 policy; no bindings/access/configuration mutation. These identifiers are copied from verified R21 receipts and must be validated locally again before tool arguments.

## Fixed stages

| Stage | Maximum reservations | Operation and stop rule |
| --- | --- | --- |
| Fresh target/env/version | 3normal | Native get_site,get_environment_variables,get_site_version551. Require active owner target, expected origin, exact access policy,environment16/redacted configuration parity, saved source/archive equality. Latest-version drift or inconsistent provenance stops before publication; do not alter controls or repair anything. |
| Deploy existing551 | 1normal | Native deploy_site_version with exact saved ID; omit tunnel bindings to preserve them. No source credential,push,build,save or migration changes. Verify returned project/version/env16/origin. |
| Deployment status if needed | 1normal | Only when initial deployment response is nonterminal or lacks its expected successful URL, one same-deployment get_deployment_status. If still nonterminal/refused/inconsistent, stop normal work and use recovery. Do not assume terminal success. |
| User-approved diagnostic | 1normal | Only after terminal successful551deployment and the user's subsequent go-ahead: one documented Tab.goto to the fixed qualification URL in the existing actual-Forma browser session. No root-page opening/extra browser navigation is included. If the session/tab is unavailable, stop rather than create new authentication traffic. Capture the application JSON if returned, or the exact client error/time interval and bounded retained-console metadata. No second qualification endpoint/read. |
| Immediate failure evidence | 1normal | Only if that single navigation fails without application response: one sites_get_site_worker_logs for the same project,since_minutes5,limit100,errors_onlyfalse, promptly within5minutes of that attempt. Correlate exact route/method and attempt interval; retain only sanitized relevant metadata and aggregate coverage. If the interval no longer fits, do not send the call. No widening/retry/pagination. Successful navigation does not spend this slot. |
| Restore550 | 1recovery | Native deploy_site_version550 after diagnostic result/refusal/abort, or failed/nonterminal551deployment where applicable. If diagnostic approval is declined or cannot be obtained during the active session, restore rather than leave551 awaiting an indefinite decision. |
| Restoration status if needed | 1recovery | One same-ID status read for nonterminal response or missing expected success URL. If still nonterminal/refused, stop and report the precise known state; do not claim restoration. |
| Final target/environment | 2recovery | After terminal restoration, get_site and get_environment_variables; verify exact access/env parity. These checks cannot replace terminal deployment evidence. |

Record every reservation durably (fsync/readback) before dispatch; retain all prior entries unchanged. Recovery slots cannot fund normal work. No automatic retries or extra native calls. An uncertain qualification request is not replayed. Current-source head is not pushed or rewritten; saved-version provenance is checked through the supported version tool. Native admission already succeeded and must still match; no nonexistent per-file output is required. Migration evidence basis is the previously accepted no-new/changed-files basis, not an independent zero-DDL guarantee.

The diagnostic uses the supported browser path that previously failed; this is a **new, explicitly bounded attempt**, not a proven fix. The additional immediate log observation addresses R23's stale-window limitation but does not guarantee event capture or prove a browser cause. There is no supported retained browser network trace in the current contract. No browser internals, account inspection, credentials extraction, security changes, raw fetch or alternate surface. Existing authentication permission remains accepted. Any newly required unbounded authentication stops the attempt.

During the post-deployment approval pause,551will be live under existing workspace audience. No application navigation occurs until that go-ahead. If the pause cannot be maintained within the active session, use the allocated restoration before ending work. No new scheduler or promise of unattended restoration is included. Never deploy or start the diagnostic at/after **2026-09-30T22:00:00Z**; keep the original **2026-10-01T00:00:00Z** expiry without renewal. Restoration cannot undo database effects or erase source history.

## Failure/manual fallback and retained scope

If the automated attempt fails, stop, preserve its bounded evidence, restore550 and present [manual instructions](manual-test.md). That checklist is queued, not authority for another deployment or a manual request against550. A later manual attempt needs a fresh bounded551deployment/restoration allocation, or a separately reviewed plan to keep551live; neither is silently included here.

Keep accepted unknown-price production exposure and indefinite source/version/redacted evidence retention under existing Site access, owned by westbrook.johnson@reve.art. No dollar cap or verified underlying HTTP bound is claimed. Do not retain credentials,private document bodies,raw log dumps or unrelated log content. Retain only qualification JSON allowed by the sealed endpoint and redacted diagnostic/hosting receipts in restricted P5 evidence/Git.

Purchase/custody controls stay off. No Start,fixture,grant,paid provider request,production code/schema change or StageC action. R14 remains disabled with cleanup/retention unchanged. Preserve P2 human-resume/original-settlement gates,sixPOST/twoimages/concurrency1/no retries,847/six exclusions and actual-Forma financial/custody qualification. Readiness,prompt adherence and moderation remain separate; no realcomparison/newmoderationfinding. P5 stays open.
