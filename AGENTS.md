# Forma agent guidance

Forma is an event-sourced creative platform. Creative work is projected from
durable append-only history shared across independently authorized applications.
The stack is TypeScript, Lit/native custom elements, Vite, Cloudflare Workers,
and Drizzle with D1/SQLite. Use the Node and pnpm versions declared in
`package.json`; use `pnpm install` and `pnpm dev` for local development.

## Find the relevant contracts

Read the documentation relevant to the change:

- [README.md](README.md): product overview, setup, and repository entry points.
- [ARCHITECTURE.md](ARCHITECTURE.md): application ownership, dependencies,
  event/state contracts, authorization, and provider boundaries.
- [DESIGN.md](DESIGN.md), [component guidance](docs/components.md), the living
  `/knowledge/design-system` reference, and `custom-elements.json`: UI design,
  reuse, accessibility, localization, and component contracts.
- [Local migrations](docs/local-migrations.md): schema changes and local migration
  execution; shared schema lives in `db/` and migrations in `drizzle/`.

## Architecture

- Preserve append-only history and existing project/document identities. New
  authoring approaches reuse shared events, projections, jobs, and generations.
- Applications under `src/apps/` may use shared platform contracts but may not
  import sibling applications. Shared code must not import application entries.
  Cross-application navigation uses URLs; data exchange uses shared contracts.
- Keep one application owner and build entry per canonical route. The root shell
  selects and loads application entries; application pages belong to their owner.
- Presentational atoms and molecules must not read or mutate the application
  store. Communicate user intent through named DOM events. Keep experimental
  signal dependencies behind `FormaStore`.
- Enforce route and resource authorization on the server before protected HTML,
  JavaScript, APIs, or hydration. Preserve exact-resource public/guest isolation.
- Output entry points share configuration, consent, readiness, reference-policy,
  durable-job, and inspection contracts. Only active, authorized creative
  decisions may enter provider-facing generation prompts; exclude internal IDs.

## UI changes

- Inspect the existing component contracts before adding UI. Reuse the nearest
  production primitive, extend it when appropriate, and document why a new
  component is necessary. Promote repeated patterns to the shared layer and
  migrate known duplicate consumers in the same change.
- Deliver component changes with production consumers, a safe fictional catalog
  example, usage documentation, supported-language descriptions, both generated
  manifests (`custom-elements.json` and `public/custom-elements.json`), and
  relevant regression coverage.
- Use shared design tokens and native form, keyboard, focus, and dialog semantics.
  Preserve stable machine identifiers, localization, and writing-direction support.
- Lit is the application default. Preserve dependency-free native custom elements
  where public/guest isolation requires them, and respect each component's
  documented rendering boundary. Public-safe controls must not pull in private
  catalogs, application state, authenticated shells, or provider adapters.

## Validation

Select checks that cover the changed behavior. Documentation-only edits need
link, command, and diff checks; they do not require an application build.

- `pnpm typecheck` and `pnpm lint`: TypeScript and lint checks.
- `pnpm test`: build and repository Node tests.
- `pnpm build`: production build and build-time consistency checks.
- `pnpm i18n:check`: system localization consistency.
- `pnpm cem`, then `pnpm cem:check`: regenerate and verify both manifests when
  custom-element contracts change. Inspect generated diffs; do not hand-edit them.
- `pnpm test:a11y`: browser keyboard, focus, and zoom checks. Follow
  [the browser test guide](tests/browser/README.md) for the preview, bundled
  Chromium, account, and retained-archive prerequisites. Missing archive setup
  does not authorize creating, exporting, fabricating, or committing a fixture.

`pnpm build` and `pnpm test` both regenerate manifests and clean/rebuild `dist`.
Run them sequentially, and coordinate rebuilds with browser verification that
depends on the preview's build output. Report checks run and any unverified areas.

## Work continuity

- Use [the central backlog](docs/backlog.md) for unfinished work and update the
  relevant item when materially advancing it. Reconcile historical proposals and
  handoffs against current code, active owners, and branch work before reopening
  or reimplementing tasks. Keep proposals distinct from accepted requirements.
- For substantive work, reuse the report located by
  [.progress-report/project.json](.progress-report/project.json). Read its handoff
  and unresolved feedback before planning; follow the configured progress-report
  skill. Keep report state and runtime outside the product application.
- Keep implementation, production activation, user review, and acceptance status
  distinct. Local verification does not establish deployment or live acceptance.

## Credentials, evaluations, and migrations

- Provider credentials stay server-only and out of source control and logs.
  Paid provider evaluations and actual-data fixtures require explicit human
  authorization within the current task's scope.
- Preview local migrations with `pnpm db:migrate:local --database <path>` before
  applying the intended change with `--apply`. Follow the migration guide's
  coordination rules for a database used by a development server. Preserve
  historical SQL, journal entries, and snapshots; add new migrations for changes.
- Follow the documented Sites deployment boundary for hosted changes. A local
  migration or passing test suite is not authorization to activate hosted work.
