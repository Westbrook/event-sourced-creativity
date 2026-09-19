# Native document and block rename observations

Implemented on the isolated Memory branch, not deployed.

Genuine `DocumentRenamed` and `BlockRenamed` events now participate in the existing
consented native source selector, descriptive action vocabulary, private recall,
strict reference export and saved-answer origin manifests as **edit** actions.
Block renames also receive exact historical block-version and relationship-endpoint
bindings. Existing principal, custody, original-time retention, compensation and
source-erasure checks remain authoritative. No new event writer, background
tracker, schema migration, consent, provider call or external service is added.

The renamed title/handle is not sent as an original quotation or an inferred
preference. Private captures and exports contain the bounded edit reference and
version provenance, not renamed prose. Native owner-stream sequence remains the
version authority even when a shared project's presentation sequence differs.
Source changes invalidate captured proof; erasure removes the corresponding edit
from a newly certified reference export. Pending source bookkeeping is not a
retained-body permission or a claim of completed remote deletion.

## Verification

- 219 native artifact/block tests pass, including genuine personal/governed event
  API writes, scheduled capture, recall, actual strict-client reference export,
  exact rename version binding, post-capture source mutation and source erasure.
  Existing isolated D1 writer/capture/privacy regressions are included.
- 162 selected client/observation/saved-origin compatibility tests pass.
- Full TypeScript, changed-production-file lint, production build and whitespace
  checks pass. Existing bundle-size warnings remain.
- All data and network transports are isolated/synthetic. No real users, provider
  spending, hosted scheduler, deployment or production migration is involved.

This closes two missing document-local edit observations. It does **not** add
nested-project authority, Library/Canvas/page histories, attachment dereferencing,
cross-document recall or durable automatic assistant/autocomplete publication.
Those remain native implementation in the continuation plan.
