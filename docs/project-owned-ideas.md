# Project-owned Ideas

Ideas now keep one identity in a project and can be used in zero, one, or multiple documents. Existing idea IDs, independent copies, relationships, and event histories remain intact. No content matching, deduplication, historical event rewrite, or database migration is required.

`BlockDocumentAttached` and `BlockDocumentDetached` record document uses. Older `BlockCreated` events still infer their original project/document as before. New document removals preserve project ideas; historical removals retain their old visibility. Explicit idea removal remains project-wide and reversible. Detaching a use leaves the idea available in Library.

Content, names, locks, and authored relationships are shared. Document position and influence are use-specific; Library edits the default influence. Connected dependencies follow a shared root. A dependency required by another included group cannot be detached separately. Explicit Fork and Duplicate remain independent-copy operations, and cross-project reuse still copies the complete supported graph. Moving an idea cannot silently discard multiple uses or strand cross-project relationships.

Forma Library includes ideas from every document plus ideas with no document. Document-used ideas can be edited directly, with shared-edit disclosure. Use in the open document and the layer shelf retain idea identity. Document counts, generation snapshots, output source pickers, relevant canvas consumers, and collection search use effective membership.

Still retains Documents as the project landing page. View ideas is the first local suggestion and the stated default in decision context. The project Ideas view supports listing, individual idea addresses, creation without a document, editing, locking, and Use idea in… . The suggestion remains subject to stronger contextual evidence; no click probability is fabricated. Viewers can browse Ideas without author permission.

Native Output requirements, governed organization context, and canvas-owned records retain their dedicated authoring/reuse contracts. They are not made unrestricted shared dependencies by this change.

Worker admission validates project/document membership and protected dependencies against authoritative history and fences the append against concurrent changes. Shared-workspace permissions remain project-scoped. Still history caches change schema version, and event readers recognize the new membership events. Release the frontend and Worker together; older clients need to refresh to understand new document uses.

Validation: 631 passing regression tests across Still, authoring, shared workspaces, generation readiness, document duplication, source integrity, and event replay; additional collection/indexing and project-idea tests; TypeScript, localization audit, schema manifest check, production build, and focused lint. Browser verification used an isolated in-memory fixture with external provider calls disabled: Documents → View ideas, editing a shared idea, observing the edit in another document and Forma Library, and using an unplaced idea from Forma without another idea ID.

Preview: `node --import tsx tests/project-ideas-preview.mjs` serves disposable data at `http://localhost:5188`. Restarting this fixture resets only its test data. Production has not been deployed by this task.

## Shared edits and output freshness

Before saving a shared idea change, Forma and Still offer **Apply to all documents**, **Create new idea**, or **Cancel**. This includes content, names, authored relationships and project-default influence; document-local influence and ordering stay local. The choice uses effective document membership, including ideas reached through a shared group. Cancellation retains the draft, and a changed workspace retires the choice before writing.

Creating a new idea from a document replaces that document's use with an independent identity. Connected parents and dependencies are copied when necessary to keep its relationships intact. Other documents keep their original identities and values. Creating a new idea from Library or the project Ideas page produces an unplaced project idea. Existing independent forks are still not merged.

Shared edits also produce in-app **Output out of date** notices for affected rendered documents. Notices are derived from retained source versions (or event ordering for older outputs without version evidence), cover images and document artifact formats, survive reload, and clear when a current replacement output of that format is available. Old output history remains available. An edit during generation can leave its eventual result out of date. A document-specific influence change does not produce a cross-document warning.

**Review and update output** opens the affected document's existing generation preparation. Still shows its output choices; Forma selects the affected format. No generation starts automatically. Forma's existing open-editor and draft protections still apply, with their original guidance preserved. Notices may be dismissed; Still also labels affected documents in its Documents list.

Follow-up verification: 641 regression tests passed, followed by focused checks for the final copy, notification and navigation changes. Browser checks covered cancellation, applying shared edits, document-specific copies, separate original/copy identities, Forma's shared edit prompt, and output preparation without submitting a generation. This work remains local and has not been deployed.
