# Original source-event custody diagnostic

The authenticated original evidence reader previously returned one generic refusal when a required event failed custody. This diagnostic retains HTTP409 and every acceptance predicate, while returning the server-resolved event IDs/types and failed predicate names. It never returns rejected private bodies or actual mismatching owner/document/project values. There are no caller-supplied event selectors.

The failure path observes bounded Boolean-only rows from the same owner stream and rechecks those witnesses, the original job/records, source integrity, administrator authority, deadlines and configuration before disclosure. Diagnostic status is unavailable; review and execution eligibility remain false. No source certificate is issued. No database writes, reconciliation or provider operations occur.

The original synthetic DocumentOpened fault removed private project metadata while retaining its public project claim. It reproduces the scope refusal, but is an inconsistent envelope, not evidence of a legitimate producer omission. S1a corrects that description and adds separate real-writer omission fixtures. This is not a finding about live records. Source and production-bundle regression pairs pass (2/2), with no-write/no-provider assertions. TypeScript, changed-file lint, localization, generated schema check and clean build pass.

Production 535 subsequently identified three scope failures; see the [S1a continuation](generation-source-scope-observation-s1a.md) for the retained finding, local state observation and pending live classification. No custody predicate is relaxed by this change.
