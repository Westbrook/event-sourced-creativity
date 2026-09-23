# Original source-event custody diagnostic

The authenticated original evidence reader previously returned one generic refusal when a required event failed custody. This diagnostic retains HTTP409 and every acceptance predicate, while returning the server-resolved event IDs/types and failed predicate names. It never returns rejected private bodies or actual mismatching owner/document/project values. There are no caller-supplied event selectors.

The failure path observes bounded Boolean-only rows from the same owner stream and rechecks those witnesses, the original job/records, source integrity, administrator authority, deadlines and configuration before disclosure. Diagnostic status is unavailable; review and execution eligibility remain false. No source certificate is issued. No database writes, reconciliation or provider operations occur.

A synthetic DocumentOpened with a correctly stored NULL project sidecar reproduces the generic refusal and now identifies private_project_matches. This is not a finding about live records. Source and production-bundle regression pairs pass (2/2), with no-write/no-provider assertions. TypeScript, changed-file lint, localization, generated schema check and clean build pass.

Live diagnosis remains to be read after deployment. No custody predicate is relaxed by this change.
