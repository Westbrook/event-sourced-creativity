# Stage A completed: current native identity chain verified

The approved R15 Stage A finished with **7of8conservative native reservations**, no request replay and no hosted mutation. The unused slot was the unnecessary second deployment-status poll; it does not authorize a different action or transfer to Stage B/C. [Verified relationships](verification.json) · [durable ledger](request-ledger.json).

## Fresh result

- Target `appgprj_6a7a020e334881919ed8aea0363cb98f`, active; current connector user is owner.
- Native saved version550: `appgprj_6a7a020e334881919ed8aea0363cb98f~appgver_e2949878bb5c81919d4845ec5e3cb3f8`.
- Source `c28af5fea0fc3ec2b37b878a544ec59c52a64daf`.
- Successful production deployment `appgdep_6ab573499a108191a2691a137672b93e`; environment revision16; expected live URL `https://forma-creative-studio.reve-ai-0869.chatgpt.site`.
- Audience remains `workspace_all`, access revision7, external visitors0. Final site and environment observations match the initial ones.
- Native admitted archive metadata:622files,44523520bytes, `sha256:a629abf35cdb357f0affa0c309ebfc0591cfe235249404c97b7ce19ee813be7f`. This identifies the existing v550 archive, **not admission of the R15 candidate**.

These fresh observations agree with historical R1v550/source/env/audience. Exact source commit is present locally. Its hosting manifest, migration release policy/code, source journal and every one of the41packaged migration files match the local candidate inputs. This establishes source-level unchanged migration packaging; it does not inspect hosted applied-history rows or schema. Secret entries FAL_KEY/JEV_API_KEY/OPENAI_API_KEY were returned with valuesnull; only key/type/secret/presence metadata was retained. No credential value was requested or used. Candidate-specific purchase/custody control keys are absent from the observed environment; the unpublished candidate's empty configuration remains the stronger local purchase gate.

## Two local handling deviations, resolved without another native request

1. After the first successful `get_site`, the adapter paused on `Boolean(siwc_bypass_bearer_token) || Boolean(source_repository_credential)`. It excluded both fields from retained/model-visible output and did not use either. A source-credential object can be truthy without proving a usable secret. The retained projection cannot establish which field triggered it. This was an overly broad **local check**, not a native refusal, authentication failure, drift or demonstrated leak. A tested corrected projection never accesses either credential field and excludes them. The final scheduled get_site used that correction; the first read was not repeated.
2. Reservation3's successful version-list response reached the tool runtime, but local receipt handling called unavailable `structuredClone`. Native dispatch had already been reserved/fsynced. The exact completed native event was recovered from this task's existing durable local history, verified against the reserved project/limit, then saved/fsynced as03-versions.json **before any further native action**. Its late evidence-file persistence is disclosed in the ledger and receipt provenance. No request was replayed or extra reservation added. The helper was corrected to use a supported metadata projection. Signed screenshot URLs and the unused pagination token were omitted from retained version metadata.

Both pauses and resolutions remain in `localStopHistory`; the initial charged entry is not erased or relabeled as a native refusal. This local repair did not change the approved actions/target/ceiling, Worker/source or release envelope and required no repeated user approval. All seven reservations were saved/read back before dispatch; the completed chain and receipt hashes were then verified locally. Native internal HTTP/prices remain unknown.

## Scope and next gate

No website/browser authentication, app preflight, DB table/content read, source credential request/use, push/save/deploy, environment/access change, migration, storage probe, financial grant or provider request occurred. Stage A is complete; [Stage B remains unapproved](../forma-r15/decision.md). Its current-source relationship is now established, but unchanged applied-history/native package conditions and successful candidate admission still have to be satisfied under separately accepted publication scope. This metadata success alone does not qualify the actual application principal/consent/schema/holds/custody/financial authority.

R15 release remains `p5-forma-qualification:4cb06e6aeecfa77da573f754b3e951189590719cda4fd3b9fbb324931aca6e92` at7cc7193561dd3a2a024549a35eb7f3950a11362b;33focused/10compiled local checks remain its evidence. No artifact rebuild or modification was needed.

Private R14 remains untouched: version4 permanently disabled, original cleanup settled,62synthetic application rows/two tombstones/schema-platformmetadata/emptyMEDIA/source-versionhistory/privatebodies0;60charged/11unused/71ceiling/normalStop59exhausted. R13 is executed/retired. Accepted OptionB unknown-price private exposure and indefinite retention since2026-09-25T21:04Z bywestbrook.johnson@reve.art remain unchanged. October1 2026 00UTC expiry is not renewed. P2 between-arm human/original-settlement gates, sixPOST/twoimages/concurrency1/no retries,847/six exclusions and image rejection unknowns remain. P5 stays open; no generation-quality claim.
