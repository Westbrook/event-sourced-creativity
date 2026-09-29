# Still actions before Jev

The browser and worker fallback share `local-policy.ts`. Existing eligibility rules run first: the policy cannot enable a locked edit, unavailable provider, forbidden mutation, or navigation to the current page.

The local toolbar uses page facts: empty documents favor adding context, selected ideas favor editing and composition, excluded ideas favor inclusion, outputs favor download/edit/source, and unconfirmed generations favor status inspection. Only motivated actions are suggested; the action limit is a maximum. Other eligible choices remain in More and the palette.

Successful context saves add a bounded `completed:` marker to the current document's recent interaction list. Opening or cancelling an action does not count as completion. Moving to another page consumes the marker. A format choice is retained within the document; changing documents clears it. These markers are session context, not new creative entities or authorization.

Local format order uses a whole explicit format instruction, the latest selected format, the selected output, other outputs in the current document, then a stable fallback. Mentions in prose and negative instructions are not interpreted as requests. Jev's usable format scores take precedence.

The Developer Panel's “Before Jev” disclosure records the local reasons and compares them with the inspected Jev menu. Full decision exports include that baseline; local weights are not click probabilities or model confidence.

A pointer passing over the toolbar does not freeze it. Focus, pointer press, and opening More preserve the controls during deliberate interaction. Dwell signals remain observational. No additional Jev calls are introduced.
