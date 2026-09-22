# Toolbar tooltip navigation cleanup

Toolbar help now belongs to its action and navigation context (workspace, document,
view, workflow, selected idea/result, page, item, and output format). Replacing that
context removes the old tooltip instead of rebinding its open state to another
button. Ordinary help-copy updates preserve the current instance and its held copy.

A keyed `repeat` removes the outgoing Lit part and runs its directive teardown.
The tooltip directive unconditionally clears `open`; the existing component
disconnect lifecycle releases its native popover, pending timers, trigger listeners,
warmup membership, and accessibility description. No vendor changes are needed.

Verification:

- 17 focused browser checks pass across toolbar tooltip lifecycle, onboarding copy,
  and focused-idea toolbar navigation. Coverage includes pointer/keyboard navigation,
  same-slot action replacement, delayed hover cancellation, history restoration,
  selection/page/workflow changes, button removal, More/Back, and stable open copy.
- TypeScript passes. The new directive and browser test pass ESLint; diff whitespace
  checks pass.
- The broader form-toolbar suite has two failing subtests (reuse button label and
  research “Review cost” control); both reproduce against unchanged HEAD source.
- The four existing empty-catch ESLint errors in `app.ts` also reproduce against
  unchanged HEAD. No unrelated cleanup was included.

Publication was subsequently requested with the document-scrolling and natural-media fixes.
