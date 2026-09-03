# Office export repair checkpoint — 2026-09-03 UTC

## Scope

This candidate repairs three defects identified in supplied PowerPoint exports:
missing authored visual captions, repeated case-variant section/kicker headers,
and disconnected timeline continuation after the fourth milestone. It extends
the existing editable exporter; it does not create a second export pipeline.

The runtime parent is production 180, with documentation parent
`f5c3a03b3fc53b0ff3ceb172948b1c5b7e11265f`. This document is candidate
qualification, not evidence that the candidate was published or that the
original user documents have passed post-publication export review.

## Behavior and constraints

- The winning renderer owns each visual caption. A derived mixed quotation
  leaves caption ownership with its data visual. Caption-only visuals remain
  visible. Canonical content and presenter notes are not rewritten.
- Section/kicker comparison ignores case and repeated whitespace, retaining the
  first authored spelling and spacing. Distinct labels remain distinct.
- Timeline rows retain source order and connect through five orthogonal editable
  segments in reserved gutters. These are editable shapes, not a claim that
  PowerPoint has attached connector endpoints to milestone objects.
- Caption, timeline and diagram text budgets account for explicit newlines and
  estimated wrapping. Dense diagrams can use up to five columns. Impossible
  local geometry raises the existing `office_archive_slide_layout_overflow`;
  no content is truncated, dropped or silently split into new slides.
- Audience exports continue to exclude private notes and source excerpts.
  Presenter-note inclusion remains explicit, with identical visible slide XML.

Text-height budgeting is a conservative heuristic, not certification of every
font or Office renderer. Existing 24-node acceptance and 48-node rejection
tests are retained. RTL fixture evidence establishes preserved row-major
geometry and observed clearance, not native-language fluency or mirrored order.

## Reproducible evidence

| Gate | Result and limits |
| --- | --- |
| Root final isolated replay | 49/49 passed in the three whole files `office-documents`, `presentation-audience-export`, and `presentation-fidelity`; zero failures, skips, cancellations or late errors; source unchanged during execution. |
| Build and static checks | Production build passed with runtime bytes below; the final additional multiline-diagram test changed no runtime source. TypeScript, targeted executable-file ESLint and diff checks passed afterward. |
| Independent static review | Both root reviewers closed their prior caption, quote and multiline layout findings; no remaining blocker within this delta. |
| Independent preliminary replay | Reliability task reported 67/67 across four selected export suites against the same runtime, before the final added multiline-diagram test. This is separate evidence, not a deduplicated total. |
| Independent synthetic render review | Six supported audience fixture slides were individually inspected at 1600×900. Captions, running headers and five-/nine-step timeline continuation had no observed blocking defect. Separate RTL and audience/presenter XML/notes checks passed within their recorded fixture scope. |

Runtime file `src/model/office-documents.ts` SHA-256:
`3a20b8a362db66ab08a506dc33c1957ad80008b1d8544e94f0a175787dee24dd`.

Final test file `tests/office-documents.test.mjs` SHA-256:
`6ce492d317671fa1c5f549e0d0ffb5704aa737ecdc15952f7115e93d6d181b8d`.

Root immutable receipt `forma-office-export-repair-root-r6.result-r1.json`
SHA-256: `1c58e40b36bbab70b484d899bb2f241f3a62ab328f9c38ffe7435fe1b3511d2a`.
Its pre-documentation source aggregate is
`7321cb4a9fdbc694abd299ade34b6d339d69dd66f4371423ca80b23d4b825750`.
The runner's legacy `fetchedMain` field is literal local FETCH_HEAD, not proof
of remote-main state or release inclusion.

Private offline evidence remains under the reliability task's
`outputs/forma-reliability-20260902/exporter-fixtures-preliminary-03/` directory.
Its `root-preliminary-qa.json`, `visual-audit.json`, and
`independent-existing-tests.json` distinguish source-free synthetic inspection
from native user-output acceptance. Private source documents, exports, speaker
notes, raw prompts and credentials are not copied into this checkpoint.

Two crowded fixtures intentionally fail closed: an attributed quote sharing
space with five milestones, duration, caption and citation; and a dense
architecture sharing space with long bullets and a citation. They are excluded
from the visual pass, not counted as successes. Two supported caption fixtures
have a nonblocking single-word final line. The existing geometry is retained;
this slice does not claim a newly qualified general reflow engine.

## Publication and accounting remain separate

Final frozen-source review, approval for the existing workspace-wide access,
deployment success and native post-publication export acceptance are separate
release gates. No migration, runtime secret, access policy, Memory activation,
Experience integration or E6 work is included here. No generation, retry,
Dismiss, reservation release or budget reset was performed by the root gate.

The two unresolved historical slideshow holds are documented separately in
[reservation follow-up](forma-historical-reservation-followup-2026-09-03.md) and
[provider evidence handoff](forma-provider-investigation-handoff-2026-09-03.md).
Those records preserve the original $30 task accounting; they do not change or
combine it with the root task's separate $60 video authorization. Exporter
publication does not settle either historical hold.

Migration tracking remains the existing local per-migration receipts plus
separate release fingerprints and explicit production pre/post schema reads.
An automatic production per-migration reconciliation/dashboard is not included.
