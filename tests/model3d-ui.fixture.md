# Local 3D UI fixture

Run `pnpm exec vite --config tests/model3d-ui.vite.config.mjs`, then open
`http://127.0.0.1:5193/tests/model3d-ui.fixture.html`.

The fixture uses the real viewer, generation settings editor, and reference
compositor with a synthetic ceramic GLB and generated PNG backdrop. Its separate
Vite configuration serves only synthetic preview images. The page has no
provider submission action. HMR is disabled so unrelated development changes do
not reset manual verification; reload after changing a component.

Browser checks performed on 2026-08-31:

- Loaded the self-contained GLB and used Front, keyboard Up, and zoom controls.
- Saved through the visible **Use this view** button: 1024 × 1024 PNG plus camera
  settings and the private media source URL.
- Saved Front `[0,0,6.4]`, orbited with Up, activated **Refresh saved view
  properties**, and saved again. The orbit remained `[0,1.111348,6.30277]`.
- Repeated that capture with the same view: identical 147,897-byte PNG and SHA-256
  `529830934b0920275ded530a9dbcf1b53916ca22f63ad994127475d805c238cb` in the tested
  browser. Pixel hashes can vary between browser/GPU implementations.
- Captured a transparent view, added it and the backdrop to the compositor, and
  used **Use composition**. The result was a 1536 × 864 PNG with both source IDs
  and content hashes in the recipe.
- Rechecked the numeric-edit regression after its fix: set model scale to 100,
  activated the backdrop layer directly, set its scale to 150, and activated
  **Use composition** without blurring the field. The recipe retained both
  authored values.
- Entered 1,025 emoji into the exact prompt. All text remained visible, the count
  showed 1,025 / 1,024, an actionable warning appeared, and the settings event
  reported `valid: false`.
- Checked the default High tier's incompatible 2K Triangle option was disabled.
- Selected **Simulate composition save**, opened the dialog, and pressed Escape.
  The dialog remained open with Close and Cancel disabled.
- Inspected the viewer and settings at 1365px desktop and 390px Arabic RTL.

Final browser images are in `outputs/model3d-ui/`:
`3d-view-and-settings.png`, `3d-view-mobile-arabic.png`, and
`3d-settings-mobile-arabic.png`.
