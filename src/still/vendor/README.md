# En Reve components for Still

Unpatched built module closure from design-system main. Exact source revision, module inventory and build/output hashes are recorded in provenance.json. Build tokens, styles, primitives and elements in an isolated checkout of that revision, then run `node scripts/vendor-still-primitives.mjs <built-checkout> <revision>` from the Still repository. Do not use a dirty checkout’s dist as evidence of main.

All editor, clipboard, command, portable-document and document-scrolling capabilities now come from upstream. No preserved extension files or implementation patches are applied. Partial refresh modes are retired to avoid mixing library versions. Only internal package imports and source-map comments are transformed.

Runtime dependencies include Lit, Signals, Lit Context and ProseMirror. MIT license included. Customize through Still’s theme and public APIs; application reference/authorization policy belongs in Still.
