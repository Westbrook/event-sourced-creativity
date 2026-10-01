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

Select checks that cover the changed behavior; use the dependency order in
[the validation guide](docs/validation.md). Documentation-only changes need link,
command, and diff checks, not an application build.

- Run `pnpm typecheck` as soon as a coherent edit is ready, before costly setup.
  It covers production, the queue worker, and TypeScript test contracts. Follow
  with scoped lint and focused source tests; fix cheap failures before widening.
- `pnpm validate:fast` runs types then full lint. `pnpm test` (also `pnpm validate`)
  runs types → lint → source tests → runtime tests → one qualified build → artifact
  tests, stopping between stages on failure. Do not precede it with a separate
  build. Node file concurrency defaults to two; use `--workers=N` with one total
  CPU/memory budget across Node, browsers, Vite, workerd, and other active work.
- Use `pnpm test:source`, `pnpm test:runtime`, or `pnpm test:artifact` with explicit
  registered file paths while iterating. `pnpm test:node` runs Node lanes and
  requires an existing matching build for artifact consumers. These focused
  commands do not independently satisfy types, lint, or unselected coverage.
- `pnpm build` reuses output only when input and output hashes match; `--force`
  rebuilds deliberately. It owns CEM generation, localization and schema checks,
  cleaning, and Vite. Inspect generated manifest diffs. For contract-only work,
  `pnpm cem` then `pnpm cem:check` remains available; `pnpm i18n:check` is focused.
- After changing tests/helpers/tooling, run `pnpm validate:inventory:update`, review
  the registry diff and lane assignments, then `pnpm validate:inventory`. A new
  `.test.ts` or nested test cannot silently disappear. Never import a registering
  test module as a fixture; extract a shared helper. Do not weaken assertions or
  exclude failures to make a run pass.
- Batch compatible browser checks after relevant cheap checks. Use
  `FORMA_BROWSER_CONFIGS=<comma-separated config suffixes> pnpm test:browser` for
  one owned compatible server batch; `pnpm test:still-toolbar:browser` avoids
  repeating the toolbar units when already verified on matching inputs.
  Reuse qualified setup and caches, with fresh mutable state per test. Keep true
  zoom, fresh-process, shared-account, migration, and recovery lanes appropriately
  isolated. Widen browser workers only after proving independence and measuring.
- `pnpm test:a11y` retains its native keyboard/focus/zoom and actual account/archive
  requirements. Follow [the browser guide](tests/browser/README.md). Missing archive
  setup never authorizes creating, exporting, fabricating, or committing a fixture.

Keep one writer to `dist`. Managed builds/artifact batches and combined built
browser batches use an exclusive lock. Coordinate standalone previews/checkers
that do not participate in that lock; preserve their active output. Never stop
an unowned server or rebuild its active `dist` merely to run a check. Keep related
checks together rather than repeatedly tearing down and re-entering a lane.
After a fix, rerun the failed and affected checks, then remaining prerequisites;
reuse still-valid evidence. Preserve run receipts, failure logs and acceptance
archives. Report selected coverage, skips, disabled modes, failures and unverified
areas separately. Historical acceptance sequences do not mandate replaying an
unchanged accepted journey for every local edit.

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
