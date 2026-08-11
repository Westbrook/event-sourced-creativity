# Forma information architecture review

**Status:** Implemented baseline · 2026-08-11

## Product model

Forma's strongest information-architecture asset is that its durable model already has a comprehensible containment hierarchy:

```text
Account
└── Projects
    ├── Collections (authored organization)
    ├── Documents
    │   ├── Context blocks
    │   ├── Outputs
    │   └── Document views
    └── Project library (derived discovery + deliberate keeping)
```

Creative intelligence operates across witnessed work without silently changing that hierarchy:

```text
Re-entry → Scout → Taste & time
```

Administration observes and governs the system without competing with creative destinations:

```text
System & governance → Event operations
```

## Strengths retained

- Projects are durable boundaries rather than cosmetic folders.
- Documents remain the unit of creative context and output generation.
- Collections are explicitly authored; search, family detection, and ranking stay derived.
- The six Studio document views expose different ways to author the same replayable document rather than separate document formats. Creative Editor deliberately hides stream and provenance machinery while preserving the same complete projection and authored operations.
- Re-entry, Scout, and Taste & time preserve distinct authority boundaries: resume, investigate, and remember.
- Event operations remains outside the creative workspace and is role-gated.

## Deficiencies found and resolved

| Deficiency | User cost | Resolution |
| --- | --- | --- |
| Projects was hidden behind the Forma logo | The root object in the hierarchy looked like a brand action rather than a destination | Projects is now the first primary destination and is active for project overview |
| System and Event admin sat beside everyday creative work | Implementation and governance concepts competed with the user's workflow | Both moved to an Administration group in the account surface; related pages also share an Administration local nav |
| “Sessions,” “Scout,” and “Memory” looked unrelated | Users had to infer the learning loop from page content | They are grouped and ordered as Re-entry, Scout, and Taste & time under Creative intelligence |
| Project overview appeared as a document-view option | Project and document scope were conflated | Project overview lives in the project rail; document-view tabs now contain only document representations |
| The project selector navigated to all projects | A control labeled with the current project changed to the account-level project list | Document views now expose a Projects / Project / Document breadcrumb with explicit destinations |
| Library appeared account-global while showing the current project projection | Scope was easy to misread | The page is titled Project library and consistently names the current project |
| Library collection filtering could change the open document | Browsing organization could unexpectedly mutate working context | Library collection selection now filters in place and does not open another document |
| The rail duplicated document counts and destination links | Important scope cues were visually noisy | The rail now separates project identity, project destinations, collections, library destinations, and creative-history health |
| Collapsing the rail removed every useful cue | More canvas space came at the cost of all wayfinding | Collapsed mode is now a functional dock with Projects, Project overview, Document, Library, and authorized Event operations shortcuts |
| The collapse affordance was a floating unlabeled chevron | Its purpose and state were unclear, especially on touch devices | It is now an integrated labeled control with expanded state, a persistent toolbar, and mobile disclosure behavior |
| Mobile CSS hid primary destinations by ordinal position | Navigation availability changed unpredictably when link order changed | Every primary destination remains available in a horizontally scrollable workspace nav |
| Page eyebrows used phase or implementation language inconsistently | The same hierarchy was described differently page to page | Headers now consistently state workspace, project/document scope, Creative intelligence, or Administration |
| `/` depended on whichever document the event projection last opened | A copied or refreshed Studio URL could display a different document than its sender intended | Document views use `/document/{durable-id}/{optional-readable-name}`; alternate lenses add `/view/{lens}`, and the ID—not the slug—selects the projection |
| Focus view existed only as a device preference | A focused workspace could not be shared, refreshed predictably, or traversed with browser history | Appending `/focus` to any canonical document-view route restores the focused presentation and preserves it across lens or document changes |
| Event-operation tabs existed only as component state | Refreshing or sharing the page silently returned to the stream table | Durable stream, Replay laboratory, and Permissions use `/admin/events/stream`, `/admin/events/replay`, and `/admin/events/permissions` |
| Library previews existed only as component-local dialog state | A block, output, or aesthetic family could not be shared, refreshed, or traversed with browser history | Stable previews use `/library/block/{id}/{optional-name}`, `/library/output/{id}`, and `/library/family/{id}/{optional-name}`; archive import remains session-only because browsers cannot restore a local file selection |

## Primary navigation

1. **Projects** — select or create a workspace.
2. **Studio** — work in the currently open document.
3. **Library** — reuse context and outcomes from the current project.
4. **Re-entry** — resume witnessed work and manage sessions.
5. **Scout** — investigate bounded trajectories without automatic promotion.
6. **Taste & time** — manage authored preferences, reversible inferences, and resurfacing.

The Forma mark also returns to Projects. System & governance and Event operations are administrative utilities rather than peer creative destinations.

## Local navigation rules

- The project rail owns project scope, project overview, collections, and project-library destinations.
- The Studio tab row owns only alternate views of the current document.
- The document context strip owns project, collection scope, and document selection.
- Focus view temporarily removes global, project, page-introduction, and summary chrome while retaining the document-view row as both orientation and exit control; `/focus` makes that presentation shareable and refresh-safe.
- Creative-intelligence pages repeat the same three-item local nav so their relationship remains visible after a direct entry.
- Administration pages repeat their local nav and preserve role-gated access.
- Navigation is expressed as links with real URLs wherever the action changes location; mutations remain buttons.
- A document URL carries durable document identity. Readable name segments may change after a rename without changing which document is opened.

## Visual-system invariant

- A rounded element may use a balanced border on all four sides, but never a one-sided or otherwise imbalanced CSS border.
- Directional emphasis must not simulate an imbalanced border with an offset inset shadow or another paint effect.
- An inset highlight on a rounded element must be concentric: zero horizontal and vertical offsets, with a balanced spread around every edge.

## Follow-up evaluation

- Observe whether users understand “Re-entry” without first visiting Sessions & re-entry.
- Compare project-rail collapse use by viewport width and document-view type.
- Measure whether direct visits to Library correctly communicate current-project scope.
- Test whether Creative intelligence reads as a coherent loop or whether Scout should precede Re-entry for some workflows.
- Consider account-wide library search only if the product later adds an explicit cross-project projection; do not imply it in the current project-scoped surface.
