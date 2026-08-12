# Design Direction

## The product should feel like a quiet creative instrument

The interface exists to reveal, shape, and protect the work. It should feel closer to a contemporary gallery, an excellent editing suite, and a well-made physical tool than to a dashboard or content-management system.

Created images, references, documents, and decisions receive the strongest visual emphasis. Navigation, metadata, system status, and provenance remain available, legible, and trustworthy without competing with the work.

The desired character is:

- Minimal, but never sparse for its own sake.
- High-end, but never precious or intimidating.
- Calm, but never inert.
- Precise, but never clinical.
- Accessible, forgiving, and easy to enter.

## Core principles

### 1. Content owns the canvas

Images and authored content get the largest areas, highest contrast, and clearest placement. Interface chrome should become quieter as the user moves from navigation into making, comparing, and presenting work.

- Prefer a large image with a small adjacent control group over a small image surrounded by explanation.
- Preserve the complete image wherever inspection or editing is the task.
- Use focal-point-aware cropping only for thumbnails and browsing grids.
- Present metadata after the object it describes, not before it.

### 2. White space is the primary container

Separate ideas with alignment, rhythm, and open space before introducing a box.

- A section should usually be a heading, a short optional introduction, and its content on the page background.
- Do not place a card inside a card to communicate hierarchy.
- Use a border only when it clarifies an interactive boundary, selection, table structure, or input.
- Use a tinted surface only to signal a distinct mode, a temporary state, or an image stage.
- Prefer one strong outer container over several nested containers.

### 3. Reveal complexity on demand

The first view should make the next useful action obvious. Detailed controls, metadata, receipts, and advanced options should be collapsible or disclosed contextually.

- Side rails, inspectors, advanced form sections, histories, and operational detail should be collapsible.
- Collapsing a region must give its space back to the created content.
- A collapsed control must remain discoverable, keyboard accessible, and named by what it reveals.
- Preserve user choices for workspace-level layout preferences.

### 4. Every detail belongs to one system

Typography, color, spacing, control height, border treatment, and language should repeat consistently across every surface.

- Do not invent a new card, badge, input, or heading treatment for a single page.
- Similar hierarchy should look similar even when the underlying data differs.
- The same action should use the same label and emphasis wherever it appears.
- Administrative surfaces may be denser, but they remain part of the same visual system.

### 5. Motion must preserve layout

Hover and focus may change color, opacity, or a non-layout shadow. They must not move neighboring content or reveal content that changes the page geometry.

- Never translate or scale an entire card on hover.
- Never switch an in-flow action group between `display: none` and visible on hover.
- Reserve action space, use an overlay, or disclose actions on focus without reflow.
- Respect `prefers-reduced-motion`.

## Visual language

### Color

The palette is neutral and artwork-first. Most of the application is warm white, white, ink, and restrained gray. A clear blue accent identifies focus and primary interaction. Green is reserved for success; amber for attention; red for destructive or failed states.

| Token | Value | Use |
| --- | --- | --- |
| Canvas | `#f7f7f4` | Application and reading background |
| Surface | `#ffffff` | Inputs, dialogs, and necessary bounded regions |
| Subtle surface | `#f0f0ec` | Quiet controls and secondary grouped content |
| Ink | `#171717` | Primary text and dark controls |
| Muted ink | `#686864` | Supporting copy and metadata |
| Hairline | `#deded8` | Necessary boundaries |
| Strong line | `#bcbcb5` | Inputs and selected structural boundaries |
| Accent | `#315fe8` | Focus, links, selected states, and primary emphasis |
| Accent wash | `#e9eeff` | Selected backgrounds and focus support |
| Success | `#287a4b` | Completed and healthy states |
| Warning | `#9a6419` | Incomplete or attention states |
| Danger | `#a3382b` | Destructive actions and failures |

Never use color as the only way to communicate state. Text, an icon, or a stable structural change must accompany it.

### Typography

Use one sans-serif family throughout the product, including all headlines. A monospace face is reserved for identifiers, event payloads, shortcuts, and code-like values.

- Default browser text size remains user-controlled. Do not set a font size on `html`.
- Body text starts at `1rem` with a relaxed line height.
- Nothing may render below `0.625rem` / 10px.
- Headlines are sans-serif, moderately weighted, and tightly tracked.
- Avoid repeated eyebrow labels. Use one only when it contributes information that the nearby heading cannot carry.
- Prefer sentence case over all caps.
- Use bold sparingly: headings, selected values, and the most important phrase in a compact status.

Recommended scale:

| Role | Size | Line height |
| --- | --- | --- |
| Display | `clamp(2.75rem, 7vw, 6.5rem)` | `0.95` |
| Page title | `clamp(2rem, 4vw, 4.25rem)` | `1` |
| Section title | `clamp(1.375rem, 2vw, 2rem)` | `1.15` |
| Subheading | `1.125rem` | `1.3` |
| Body | `1rem` | `1.6` |
| Supporting | `0.875rem` | `1.5` |
| Label | `0.75rem` | `1.35` |
| Technical microcopy | `0.625rem` | `1.4` |

### Spacing

Use an 8px-derived rhythm. Prefer generous spacing between conceptual sections and compact spacing within a control.

- 4px: icon-to-label or tightly related inline detail.
- 8px: compact control groups.
- 12–16px: fields and local content groups.
- 24–32px: component regions.
- 48–72px: major page sections.
- 80–120px: gallery-like transitions and hero breathing room.

Page gutters should be fluid, normally `clamp(1rem, 4vw, 4.5rem)`. Content widths should be set by reading or image needs, not by arbitrary card widths.

### Shape and depth

- Standard controls use a 6px radius.
- Larger interactive surfaces and dialogs may use a 10–14px radius.
- Images may be square-edged in gallery layouts or use a restrained 4–8px radius in tools.
- Borders and radii must always be balanced on every edge.
- Do not simulate an imbalanced border with an inset shadow or pseudo-element on a rounded surface.
- Shadows are reserved for floating layers: dialogs, command palettes, popovers, and fixed composers.
- In-flow content should usually have no shadow.

## Layout system

### Global shell

The global header is a quiet utility strip, not a page hero. It should remain visually stable across routes. The current location is indicated with type and color, not with a heavy tab treatment.

The project rail is a navigational tool. Expanded, it provides project, document, collection, and library paths. Collapsed, it becomes a compact dock and returns meaningful width to the workspace.

### Page header

Every page begins with the same hierarchy:

1. Optional context line only when necessary.
2. A direct sans-serif page title.
3. At most one short sentence explaining the page.
4. Primary and secondary actions aligned consistently.

Do not repeat the same concept in the context line, title, and description.

### Gallery and library surfaces

- Use fewer, larger columns rather than dense card walls.
- Images should dominate each item.
- Object names and one useful supporting fact follow the image.
- Receipts and technical metadata live in a disclosure, focused view, or inspector.
- Families are visual groups first and data records second.

### Editing surfaces

- Give the working image or document the largest flexible region.
- Keep the primary action close to the work.
- Tools and inspectors should be collapsible and independently scrollable only when the viewport requires it.
- Avoid scrolling a parent merely to reach a child tool panel.
- Alternate document views must represent the same durable document while optimizing the experience for their specific mode.

### Administrative surfaces

Administrative tools may expose more detail and denser tables, but should still use the same typography, neutral palette, form controls, and whitespace hierarchy. Operational data belongs in tables, timelines, and inspectors—not decorative cards.

## Component rules

### Buttons

- Primary: dark ink or accent fill, used once per local decision area.
- Secondary: surface with a balanced hairline.
- Ghost: no container until hover or focus.
- Destructive: danger text or fill, spatially separated from primary progress actions.
- Minimum target size is 40px; icon-only targets are at least 36px square and have an accessible name.
- Button labels use sentence case.

### Forms

All forms share the same structure:

1. Section heading outside the field border.
2. Optional one-sentence help text.
3. Label.
4. Control.
5. Optional supporting or error text.

- Inputs, textareas, and selects use a white surface, balanced 1px border, 6px radius, and visible accent focus ring.
- Do not use placeholder text as the only label.
- Related fields align to a responsive grid and become one column before compression harms readability.
- Advanced and infrequent field groups should use `details` with a meaningful summary.
- Checkboxes and radios keep their native semantics and large clickable labels.

### Cards and lists

Use a card only when the item is independently actionable or movable. Otherwise use a list row, section, or plain content.

- Cards cannot contain decorative nested cards.
- Hover cannot move a card or change surrounding layout.
- Selected cards use an accent border and accent wash, always paired with an accessible selected state.
- Action regions reserve their space or remain visible.

### Images

- Browsing thumbnail: focal-point-aware `object-fit: cover`.
- Editing, comparing, focused preview, and lightbox: `object-fit: contain`.
- A passive clickable image opens the shared large-image dialog.
- Image stages use near-black so the content edge is legible without competing with it.
- Labels overlaying images require sufficient contrast and should not obscure the focal region.

### Dialogs and transient feedback

- Dialogs use one white surface over a dimmed, blurred backdrop.
- Clicking the backdrop closes dismissible dialogs; use `closedby="any"` where supported.
- Toasts must remain available above dialogs or be repeated inside the active dialog.
- Modal headings are direct. Avoid ceremonial eyebrow copy.

### Status, metadata, and provenance

- Status chips are compact, sentence case, and textually explicit.
- IDs and model names use monospace only where they help verification.
- Provenance and event details should be one disclosure away from the primary creative experience unless the user is in an administrative view.

## Responsive behavior

- Every grid uses `minmax(0, 1fr)` and allows children to shrink without overflow.
- Switch multi-column forms and content layouts to one column before labels or controls truncate.
- Rail collapse and focus modes must be valid independent states.
- Horizontal scrolling is acceptable for timelines, filmstrips, and wide data tables when clearly intentional; it is not a page-layout strategy.
- Sticky elements must not stack into an unusable viewport.
- Touch and keyboard users receive the same actions as pointer users; no essential action exists only on hover.

## Accessibility baseline

- Meet WCAG 2.2 AA contrast for text, controls, states, and focus indicators.
- Preserve semantic headings in a logical order.
- Every control has an accessible name and visible focus treatment.
- Interactive targets are at least 40px where practical.
- Do not disable zoom or override the browser’s root font size.
- Errors describe what happened and how to recover.
- Live progress and completion feedback is announced without stealing focus.
- Reduced-motion preferences remove nonessential animation.

## Content style

Interface language should be direct, human, and compact.

- Name the user’s object or action rather than the system mechanism.
- Replace “What this infrastructure enables” with the concrete outcome.
- Avoid repeated stage labels, phase names, and implementation vocabulary outside administrative tools.
- Keep helper text to one sentence when possible.
- Put education where the decision occurs, not in permanent chrome.

## Implementation invariants

- Use Lit custom elements and shared design tokens.
- Keep the root font size user-owned and use `rem` for typography.
- No text below 10px.
- No imbalanced border on a rounded element.
- No inset or pseudo-element workaround that simulates an imbalanced edge on a rounded element.
- No layout-affecting hover reveal.
- No hover translation of in-flow cards or controls.
- No essential action available only on hover.
- No new one-off color, typeface, shadow, radius, or spacing value without first determining whether a shared token should exist.
- Prefer container queries for reusable components and media queries for viewport-level shell changes.

## Review checklist

Before a surface is complete, verify:

- The created content is visually stronger than the interface around it.
- The page can be understood without reading eyebrow labels.
- Conceptual sections are separated primarily by space, not nested containers.
- Images are as large as the task reasonably allows.
- Forms follow the shared label/control/help pattern.
- Advanced or secondary regions can give space back when collapsed.
- Hover and focus do not cause layout shifts.
- Typography, color, weight, radius, and action hierarchy match the rest of the product.
- The surface remains usable at browser-zoom and narrow-width extremes.
- Keyboard, touch, reduced-motion, and screen-reader paths retain every essential action.
