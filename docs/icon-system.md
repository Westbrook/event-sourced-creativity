# Forma icon system

## Decision

Forma uses **Phosphor Icons, Regular weight**, delivered as individual SVG
assets from the MIT-licensed `@phosphor-icons/core` package. The decision came
from an inventory of roughly 300 icon uses spanning the shared application
shell, seven creative document modes, project and library navigation, rich-text
authoring, spatial Canvas tools, six output formats, replay, governance, and the
living component library.

Phosphor's deliberately drawn, softly geometric silhouettes reinforce Forma's
quiet editorial/gallery character without competing with the work. Its broad
vocabulary covers creative artifacts and spatial tools more naturally than a
generic navigation-only set; Regular remains readable at 16–24px and maintains
a more distinctive product identity than ubiquitous general-purpose outline
families. Six upstream weights remain available for future, deliberate design
decisions, but production currently uses **Regular only**.

## Audited usage inventory

| Product area | Existing and anticipated needs | Semantic icon names |
| --- | --- | --- |
| Shared shell and feedback | Search, close, add, account, share, private access, download, success, warning, information, media transport | `search`, `close`, `plus`, `user`, `share`, `lock`, `download`, `check`, `warning`, `info`, `play`, `pause` |
| Project and library navigation | Home, project folders, active document, reusable ideas, result grids, visual families, rail collapse, focus mode, breadcrumbs, pagination | `home`, `folder`, `document`, `grid`, `dashboard`, `families`, `layers`, `back`, `arrow`, `previous`, `next`, `expand`, `collapse` |
| Creative authoring | Create, edit, remove, undo, redo, protect, visibility, reorder, pin, copy, save, send, and inspect | `spark`, `edit`, `trash`, `undo`, `redo`, `lock`, `unlock`, `eye`, `hidden`, `up`, `down`, `pin`, `copy`, `save`, `send` |
| Rich-text formatting | Bold, italic, heading, unordered list, numbered list, quotation, and hyperlink | `bold`, `italic`, `heading`, `bullets`, `numbered`, `quote`, `link` |
| Creative outputs and references | Images, stories, film scenes, presentations, storyboards, video, palette, comparison, and missing-image placeholders | `image`, `story`, `scene`, `slides`, `storyboard`, `video`, `palette`, `compare` |
| Spatial Canvas | Pointer selection, panning, marquee/batch selection, context boundaries, focal regions, drawing, contrast, zoom, and organized content | `select`, `pan`, `marquee`, `selection`, `scope`, `focal-point`, `draw`, `contrast`, `plus`, `minus` |
| History, replay, and operations | Timeline, replay, branching, step transport, concurrency, administrative configuration, experiments, and producer permissions | `clock`, `replay`, `branch`, `step`, `swap`, `admin`, `flask`, `check`, `lock` |

## Consumption contract

Use the existing design-system primitives wherever possible:

```html
<forma-ui-icon name="spark"></forma-ui-icon>
<forma-ui-icon name="warning" label="Attention required" size="small"></forma-ui-icon>
<forma-ui-icon-button icon-name="close" label="Close panel"></forma-ui-icon-button>
<forma-ui-button icon-name="save" label="Save changes"></forma-ui-button>
```

Within a Lit template, use `icon("semantic-name")`. It returns a decorative,
fixed-size SVG result, so the containing control remains responsible for its
accessible name. `FormaIconName` is the canonical typed vocabulary for public
component properties and product-side icon mappings.

Never interpolate `icon()` into an ordinary JavaScript template string: it is a
Lit `TemplateResult`, not text. Keep it directly inside an `html` template, or
return a tagged `html` result from a conditional branch.

Creative surfaces derive icon names from `src/components/icon-semantics.ts`
rather than abbreviating labels or inventing a different local convention. Its
exhaustive typed mappings cover all 21 context-block kinds, five document
artifact formats, six creator-taste axes, and eight Reality Layers categories.
Import these mappings only from creative feature owners, never the eager shell
or otherwise-focused project/operations pages.

The helper trusts only statically bundled package assets. Every SVG preserves
Phosphor's native `viewBox="0 0 256 256"` and `fill="currentColor"`, adds
intrinsic 20px dimensions plus `aria-hidden="true"`/`focusable="false"`, and
responds to the inherited `--forma-icon-size` token. The tokenized component
sizes are `small` 16px, `medium` 20px, and `large` 24px; meaningful empty-state
symbols may intentionally use 32px.

## Delivery and route ownership

`src/components/icons.ts` contains only the eager shell vocabulary. Additional
assets are owned by small, statically imported feature modules:

- `icons-navigation.ts`: project destinations, document structure, and focus.
- `icons-authoring.ts`: editing, visibility, mutation, and expressive actions.
- `icons-history.ts`: time, replay, branching, and comparisons.
- `icons-media.ts`: narrative, presentation, video, and palette formats.
- `icons-formatting.ts`: rich-text toolbar actions.
- `icons-canvas.ts`: selection, spatial regions, and composition tools.

Each pack imports only explicit paths such as
`@phosphor-icons/core/regular/selection.svg?raw`, then calls `registerIcons()`
synchronously while its already-lazy application route is evaluated. Therefore
icons render immediately with their consuming page, need no additional network
requests, preserve the existing route split, and never pull the complete
1,500-plus-icon upstream catalog into a focused application page.

Both the global design stylesheet and the adopted stylesheet shared by shadow
components apply matching fixed-size SVG rules. This prevents native SVG
300-by-150 intrinsic fallback, flashes, and content shifts regardless of a
component's rendering boundary.

## Guardrails

Do not import `@phosphor-icons/core` as a package root, glob its complete icon
set, add an icon font or external sprite, fetch icons at runtime, or fall back
to typographic symbols. Keep route-specific icons out of the shell and unrelated
application entries. Preserve meaningful mathematical dimensions, signed
quantities, real keyboard-key labels, and genuine user initials as text.

`tests/icon-system.test.mjs` enforces the source contract, synchronously owned
feature-pack boundaries, actual production-bundle SVG contents, light/shadow DOM
sizing, absence of legacy glyphs or stringified icon results, right-to-left
navigation, and complete French/Arabic gallery translations.

References: [Phosphor Core](https://github.com/phosphor-icons/core),
[Vite static asset imports](https://vite.dev/guide/assets), and
[Lit trusted HTML directives](https://lit.dev/docs/templates/directives/).
