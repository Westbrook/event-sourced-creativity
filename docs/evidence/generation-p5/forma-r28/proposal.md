# P5 R28 — readiness and allocation proposal

**Recommendation: wait for P6’s finite owner answer before another diagnostic cycle.** A successful browser qualification would not supply an authentic evidence registrar, the missing original study-charge producer, or an account-specific source of adjustment-complete finality. P6 is complete and idle: provide private references/custodians or “unavailable” for its four groups (account/rates, billing source/verifier, paid mode/amounts, paid custody obligations). This does not reopen accepted hosting, authentication, migration evidence or retention. The optional manual read below has independent infrastructure diagnostic value only.

This is a preparation-only proposal, not accepted execution authority. No deployment, navigation, hosted read, log query, provider call or renewal occurred in R28. The existing P5 task remains open.

## Corrected starting point

R25 at `03f699e40d98d57f02bd92c2a61dd9b33073b7ad` did restore550 with final parity and charged23/26 normal,9/10 recovery. Preserve its [manual checklist](../forma-r25/manual-test.md) as historical. Later accepted R26 and executed R27 at `ac794f05381683464f2ff11916134ed31274652f` supersede that starting state:

- **29/30 normal +10/13 recovery =39 charged;1 normal +3 recovery unused.** No entries reset or transferred; consumed stage caps remain consumed.
- R27’s one automated navigation returned `net::ERR_BLOCKED_BY_CLIENT`. Immediate logs corroborate one exact-route/time GET200/ok; no qualification JSON or unique browser correlation was received. This does not establish authentication, schema, moderation or root cause.
- R27 restore550 returned native internal error−32603 with no deployment ID. **Restoration is unknown; last confirmed live version551**, deployment `appgdep_6abba8a798a88191850f1b72b6563b66`. Do not describe550 as currently restored. Its owner-only qualification route within the workspace-audience Worker may remain available; last verified purchase/custody controls remain off.
- The pending [R27 recovery lookup](../forma-r27/recovery-decision.md) is not executed by this planning instruction. Its read-only reconciliation is distinct from another publication cycle.

## Session readiness before any deployment

At **2026-09-29T12:15:43.562Z**, documented `cua.listTabs({browser:'1',emit:false})` exposed actual Forma **tab8** at origin `https://forma-creative-studio.reve-ai-0869.chatgpt.site`. Only matching tab ID/origin were retained; no document body, title, private path, credentials, history or application response was read. Inventory metadata is not a hosted request reservation and does not prove authentication or guarantee future availability. Repeat this metadata-only check immediately before any later deployment; absence means stop before publication. Ambient UI context alone is insufficient.

**Smallest path reuses this existing ordinary tab: opening0; authentication0.** Owner confirms they can perform the one manual address-bar navigation in that same Codex in-app browser. If the tab needs opening, reserve a separately accepted **+1 normal** ordinary-origin navigation before deployment, then inventory it again. That optional opening is not included in the base amendment below. If login is needed, stop before deployment: authentication permission remains accepted, but its concrete visible actions need a finite allocation; no unknown redirect/login loop is hidden in one “authentication” reservation. Do not request fresh authentication consent for unchanged scope. No credential export, security bypass or switch of browser surface.

## One conditional proposal — reconcile first, then manual read only if separately chosen

All identifiers are copied from retained native receipts and must be validated locally before arguments are dispatched. Each operator reservation is durably recorded and read back before its action; failures and uncertain results remain charged. No blind retries, fungible stage caps or borrowing recovery for normal work.

| Stage / exact operation | Normal maximum | Recovery maximum | Stop or required result |
| --- | ---: | ---: | --- |
| A. Existing R27 reconciliation: `sites_get_site_version(project_id, saved550)` | 1 | 0 | Existing unused normal slot must be explicitly reassigned as in R27; exact source/project/version. Read returned latest `deployment_id`; old/missing/ambiguous ID stops. |
| A. `sites_get_deployment_status(project_id, returned deployment_id)` | 0 | 1 | New versus R25 restore ID, timestamp consistent with R27 restore; terminal550/env16/origin required. No guessed ID or repeated polling. |
| A. Final `sites_get_site` and `sites_get_environment_variables` | 0 | 2 | Workspace_all/access7 and environment16/binding metadata parity. Any drift stops. |
| B. Ordinary page opening / authentication | 0 | 0 | Reuse exposed tab and ready owner session; otherwise stop before deployment as above. |
| B. Fresh `sites_get_site`, `sites_get_environment_variables`, `sites_get_site_version(saved551)` | 3 | 0 | Exact audience, environment, source and admitted archive match; no new version or intervening release. |
| B. `sites_deploy_site_version(project_id, saved551)` | 1 | 0 | Reuse immutable admitted551; omit tunnel_bindings to preserve bindings. No push/build/save. |
| B. One deployment-status check, only if initial response nonterminal | 1 | 0 | Use returned ID; only terminal success permits diagnostic. Missing ID/refusal/nonterminal stops normal work and enters bounded recovery where safe. |
| B. Owner manually enters fixed qualification URL once | 1 | 0 | Agent reserves before instructing Enter; owner returns bounded JSON or exact visible error/time. No refresh/replay, automatic fallback or log query. |
| B. Restore saved550 once | 0 | 1 | Only within the unchanged, explicitly serialized release window. Not over a P7/intervening release. |
| B. Missing-ID fallback: `sites_get_site_version(saved550)` once | 0 | 1 | Only if restoration has no ID. Require a new ID relative to the Stage A verified restore, correct source and restoration interval. Never resubmit deploy. |
| B. One restoration status check | 0 | 1 | Only if initial restore nonterminal or new ID recovered. Require terminal550/env16/origin. |
| B. Final `sites_get_site` and `sites_get_environment_variables` | 0 | 2 | Final audience/environment parity after terminal restoration. |
| **Maximum from current R27 state** | **7** | **8** | **15 further reservations;54 cumulative worst case.** |

Stage A fits the existing1 normal/3 recovery spare but needs its explicit reassignment approval. If it fails, **do not begin B**; retain exact known state. Stage B is a fresh, explicitly allocated cap of **6 normal/5 recovery**; its extra missing-ID read addresses the observed R27 restoration failure without a retry. After maximum A, ceilings are30/13 with43 charged. Proposed amendment **+6 normal/+5 recovery gives cumulative36 normal/18 recovery =54**, preserving all39 prior charges. At most54 is reached only if every conditional slot is needed. Unused slots do not authorize another attempt. Optional ordinary opening would instead require explicit **+7 normal/+5 recovery**, ceilings37/18,total55. There is no priced-dollar ceiling or verified total-HTTP claim; native/browser/authentication internal HTTP and historical unknown traffic remain unknown. No old Stage A/private R14 allowance is borrowed.

Five recovery slots cover one restore submission, its possible missing-ID lookup, one terminal-status observation, and both final parity reads. They cannot guarantee platform success. Any refusal, stale/missing ID, nonterminal result after that one observation, drift or expiry stops execution with the last confirmed version and unresolved diagnostic exposure stated plainly. Do not silently mark restored or spend another slot. No log read is in this manual proposal.

### Fixed identities and manual operation

- Actual Forma project: `appgprj_6a7a020e334881919ed8aea0363cb98f`.
- saved551: `appgprj_6a7a020e334881919ed8aea0363cb98f~appgver_dc5968eecc788191bfae9709c514379a`; source `d147817ff14b502a8fc116a74fa5388f9fe7ad62`.
- recovery550: `appgprj_6a7a020e334881919ed8aea0363cb98f~appgver_e2949878bb5c81919d4845ec5e3cb3f8`; source `c28af5fea0fc3ec2b37b878a544ec59c52a64daf`.
- R15 release `p5-forma-qualification:4cb06e6aeecfa77da573f754b3e951189590719cda4fd3b9fbb324931aca6e92`; R17 package `p5-forma-local-package:164dcc1c29d8fe5a6f0b36045661d5d5abef3dfa31bf4b2c70c4d49f780dc803`.
- Upload SHA256 `130377a70b50a81e7111c71445bf2c15bd8bea2c992abe25eaf2d607c1407360`; admitted normalized tar SHA256 `79c7f2c618e5cbe68ad454e27d5649bb24e33cf129bc0947638247af7eb50aa2`,622files/44728320bytes. No rebuild/repack/save. Keep41 packaged migrations/metadata unchanged,31held/optional SQL excluded. Accepted publishing-contract/equality basis remains; zero hosted DDL and old archive bytes were not independently proved.
- Exact manual address-bar operation, only after terminal551 confirmation and reservation: `https://forma-creative-studio.reve-ai-0869.chatgpt.site/api/internal/generation-study/qualification` then Enter once. Return only bounded qualification JSON or visible error/time, without private document contents, credentials or headers. Agent records receipt then performs authorized recovery without another generic permission pause. If owner cannot finish/return the result in the agreed window, restore rather than leave551 waiting indefinitely.

JSON would provide actual qualification findings, including refusals/missing dependencies; it grants no permission to fix them. A client block without JSON leaves qualification unresolved. A manual success after automation failure supports an interaction-path distinction, not a proven root cause. Do not deploy again solely to reproduce historical failure.

## P7 publication coordination

Read P7’s [independent production-release plan](http://127.0.0.1:4193/next-tasks/video-reference-provenance/integration/production-release-plan.md). P7 `a16625724d5787d10d428061b8e9afd626bd5a20`, tree `faf881c06dde3cdc48d37c83282e5b43067ce3fa`, is locally integrated; publication remains separately pending. P6 documentation was subsequently committed at9152ccf3. P7’s older reference to R26 pending is historical; R27 recovery uncertainty is now the controlling P5 state.

The written release order is **P5 state reconciliation and any elected diagnostic/restoration closure → recorded terminal final state and explicit release of P5’s hosted window → separately authorized P7 publication**. P7 may continue local work while P5 waits. Before a P5 cycle, confirm from current P7 handoff/owner that no competing hosted release is active or scheduled for that window. No platform lock or compare-and-swap deploy is claimed. `get_site.latest_version_number` is not a live-version field. An inventory or historical successful deployment alone cannot rule out another publisher.

If P7 or another release takes production first, invalidate this551/550 cycle: do not deploy551 or restore550 over it. Reconcile and separately approve a new exact qualification and recovery basis; do not silently substitute a new recovery version or rebuild551 to include P7. Preserve both immutable identities and package bytes. No message to P7 or hosted release was sent by R28; this shared written handoff is the coordination artifact, not a claim that a release window is already secured.

## Decision to return later

**Recommended: “Wait for P6’s owner answer; no diagnostic cycle.”** Pending R27 state reconciliation can be elected on its own under its exact1-normal/3-recovery plan; waiting does not prove restoration or close that obligation.

Alternatively: **“Approve R28 Stage A reconciliation and, only on verified550 parity and a secured P7 release window, one manual Stage B diagnostic for its own value; add6 normal/5 recovery, ceilings36/18. Reuse the existing tab; no opening/authentication actions. Restore and verify within the exact recovery allocation.”** This is a concrete proposed decision, not an approval inferred from this planning request. If opening is needed, explicitly select the +1-normal variant; a new login flow needs its own finite observed-action allocation before publication, with existing authentication permission preserved.

Expiry stays **2026-10-01T00:00:00Z**, mutation/recovery margin **2026-09-30T22:00:00Z**. Do not begin a cycle that cannot finish within that margin; no extension follows from waiting. No source changes, migration changes, fixture/run creation, custody/grant writes, real provider requests, purchase or paid comparison. Purchase/custody controls stay off. Preserve accepted unknown-price production exposure, indefinite source/version/restricted redacted evidence retention owned by westbrook.johnson@reve.art; restoration erases neither history nor database effects. Private R14 cleanup/disablement and retention remain settled and separate.

OpenAI support history is retained: request and email acknowledgement received, human escalation requested, **no confirmed human case, case number or diagnosis**. Automated support text is not an engineering finding. No new support message or raw log/session upload.

Infrastructure readiness: admitted551 and terminal publication demonstrated; qualification JSON absent; current restoration unknown. Prompt adherence: no real comparison images/results. Moderation: no new finding. Keep the real two-image exact-request/provider-evidence objective, P2 human-resume/original-settlement gates, six POSTs/two images/concurrency one/no retries,847/six exclusions and separate actual-Forma authority. Cross-media learning is deployment/session/evidence separation only, not quality improvement.
