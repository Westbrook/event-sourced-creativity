# Quiet image progress in Still and Forma

Implemented locally on 2026-09-22. Existing OpenAI credential configuration is reused; no credentials were changed and verification made no paid provider calls.

Still shows a preview in its existing image frame and a short status above the toolbar. Forma shares an in-place preview with one small caption across its image surfaces. Status follows actual job phases: Queued, Preparing…, Generating…, and Saving…. No percentage or estimated completion time is invented.

Ordinary OpenAI generation and editing requests can return one early image. It is stored through authenticated media access, including shared-project authorization, and replaced by the final image. Missing previews or optional preview-storage failures do not prevent the final result. Retries clear earlier preview metadata; failed and completed jobs stop presenting their preview as active work.

Fixed-price native/sponsored Output contracts and other providers retain status-only feedback. Their provider and pricing contracts are unchanged.

## Verification

- 75 focused tests pass, including streamed generation/edit responses, personal and shared-project Worker job lifecycles, final-image replacement, cancellation, failures, and Still behavior.
- TypeScript, localization audit, and production build pass. Changed-file lint passes except four existing empty catch blocks in Still's app module, confirmed on HEAD.
- The broader reliability run has seven failures; all seven reproduce on unchanged HEAD. They concern request admission and presentation recovery/budgets.
- Browser checks confirm loaded previews and restrained status placement in both applications. Forma's Saving… phase was also verified.

## Review and continuation

The independent [Progress Report](http://127.0.0.1:4187) contains review cards. Local simulated previews run on port 5182 and use fixture content only:

- [Still](http://127.0.0.1:5182/still/project/project-atmosphere/document/scene-reuse-document/generation/quiet-preview-job?progress-report)
- [Forma](http://127.0.0.1:5182/document/scene-reuse-document/local-test-small-ideas?progress-report)

The temporary fixture is `/tmp/quiet-image-preview-local.mjs`; run `node --import tsx /tmp/quiet-image-preview-local.mjs` from the repository after building to restart it. Its Forma report-return link is fixture-only. Test logs are `/tmp/quiet-image-final-tests.log`, `/tmp/quiet-image-baseline-tests.log`, and `/tmp/quiet-image-build.log`.

Changes remain uncommitted and are not deployed. Next action is user review; no further implementation is pending for this scope.
