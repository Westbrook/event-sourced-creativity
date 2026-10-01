# Still goal and user settings actions

Policy `still-26` applies this follow-up. The Command Palette exposes **Your goal** and **User settings** through Still’s
canonical action catalog. `intent` retains its stable identifier and existing
links. `user-settings` opens the existing dialog primitive over the current work.
Neither action needs a persistent masthead button or changes creative records
merely by opening. Personal controls remain available to authorized Viewers;
permission to change shared work is unchanged.

Your goal edits the current explicit goal and success criteria and exposes
complete, abandon and clear operations. A session goal stays in that session.
Remembering a goal is a separate explicit choice, scoped to the selected work and
limited to 30 days. Goal navigation respects unsaved or uncertain authoring work.
User settings can open over a draft without discarding it, and restores the
underlying route and focus when closed.

## Suggestion history and the Event Log

Suggestion history already has durable server storage in the actor-private
`still_action_receipts` and `still_action_observations` tables. The creative Event
Log contains the canonical events used to reconstruct projects and documents.
Suggestion history does not append to that stream, advance its head, become a
collaborator’s project history, or expose creative replay actions. This preserves
independent expiry and erasure for suggestions and personal feedback.

Opening an authorized action context now enables saving by default. A durable
account preference in `still_user_settings` controls this across Still. **Save
suggestion history**, under User settings, is the opt-out control. Missing account
preference means enabled; an explicit disabled value does not expire with the
history. The browser waits for an authorized context before recording, and
unavailable preference/history reads fail closed without blocking creative work.

| User operation | Effect |
| --- | --- |
| Turn saving off | Persist the account opt-out and erase that actor’s suggestion observations, receipts and recording leases across scopes. Remembered goals and creative events remain. |
| Turn saving on | Persist the account choice and begin a fresh authorized recording lease. Erased evidence and old causal chains do not return. |
| Erase current history and goal | Erase history and the remembered goal for the selected scope. Keep the account saving preference; when enabled, future activity can be recorded through a fresh lease. |
| History expires | Remove expired evidence without changing the account setting. An enabled account can begin a new authorized lease; a disabled account stays disabled. |

Rows remain tied to actor, authorized scope, recording epoch and fixed expiry.
Their retention is at most 30 days, possibly shorter by workspace policy, parent,
source, goal or evidence horizon. Opt-out and lease checks guard writes atomically;
late reads or writes cannot restore a revoked epoch. History clearing and account
opt-out are separate operations. Personal erasure and expiry must not delete the
opt-out and silently turn saving back on.

The previous implementation deleted a scoped preference when a person disabled
history; it did not retain a durable disabled value. Those missing rows cannot
reveal whether a person opted out or never enabled history. The new default
therefore applies where no durable account choice exists; subsequent explicit
opt-outs are preserved.

## Existing evidence boundaries

Recording is automatic; quality judgments remain optional and unknown until a
person supplies them. The payload excludes passive attention, scrolling,
keystrokes, draft bodies and provider prose. The workflow, outcome and quality
series retain their exact target, causal and retention contracts. Existing
verified operational feedback can inform bounded suggestions; workflow and
quality diagnostics remain excluded from Jev retrieval.

Migration 0075 adds only the durable settings table. Historical SQL remains
unchanged. The ordinary server bootstrap can create this additive table; the
publication archive retains the existing 41-migration prefix and does not activate
held Memory migrations. Source-journal qualification separately binds the exact
0075 append and unchanged historical Memory repair manifest.

Implementation, focused verification, production publication and user acceptance
are tracked separately in the Progress Report. See the
[workflow contract](still-workflow-observations.md),
[action-quality guide](still-action-quality.md), and
[release checks](still-toolbar-release-checks.md).

## Publication and verification

Published as **Production 570**, source `0a548533`, and included in `main`.
The [native release receipt](evidence/still-goal-settings-release-2026-10-01.json)
binds the pushed source and inspected archive. Workspace audience revision 7 and
runtime environment 16 are unchanged. 188 focused source/runtime checks, 44 toolbar
units, 98 cross-browser/native-zoom checks and 10 goal/settings browser scenarios
passed. Final types, full lint, inventory, build, generated manifests, localization,
migration preview and exact saved-archive verification passed. Initial failures
and scoped rerun receipts remain available; no failed case is counted as a pass.

Publication does not close the three existing product reviews or establish
real-user benefit. The tests used fictional data and no paid provider calls.
