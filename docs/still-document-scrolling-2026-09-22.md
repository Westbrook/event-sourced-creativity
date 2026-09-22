# Document scrolling for Show all lists

Show all lists now participate in normal document scrolling. The list wrapper no
longer has a height cap, nested overflow, scroll containment, or reserved scrollbar
gutter. Lists above 30 items continue to virtualize.

The shared En Reve controller recognizes `document.scrollingElement`, listens for
document scroll events, and uses the window's scroll offset and viewport bounds.
Anchor corrections and item reveals target the window. Geometry changes above a
list do not pull a reader into that list before they have scrolled there.
Existing element scrollports remain supported.

Still observes the sticky header and toolbar heights to keep item reveals clear of
them. Native keyboard targets receive corresponding scroll margins. Focused rows
remain mounted; deleting the focused record recovers focus to the list region.

The upstream change is in the sibling design-system repository:

- `packages/primitives/src/interactions/virtual-collection.ts`
- `packages/primitives/docs/virtual-collection.md`

The primitives package was rebuilt and its virtual-collection module closure was
regenerated with `node scripts/vendor-still-primitives.mjs ../design-system --virtual-only`.
Other vendored components were not updated.

Verification completed:

- Eight new Chromium browser scenarios cover document scrolling at desktop and
  narrow viewport sizes, reaching row 1,000, variable-height anchoring, heading
  changes, smooth reveals, toolbar resizing, keyboard focus, record removal,
  disabling/disconnecting, and existing element scrollports. Fewer than 65 rows
  mount in the 1,000-record document fixture.
- All six existing list-flow scenarios pass. Their fixture now includes current
  projection defaults, reflects the existing all-ideas default, and no longer
  imposes an artificial inner scrollport.
- All eight tooltip lifecycle scenarios from the preceding fix pass.
- Eleven virtual-collection model tests pass. The design-system primitives build,
  app TypeScript check, changed-file ESLint, whitespace checks, localization audit,
  and production build pass.

Publication was subsequently requested with the tooltip and natural-media fixes.
Browser checks used Chromium with simulated content; no live provider calls were made.
