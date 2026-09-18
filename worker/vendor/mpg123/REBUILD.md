# Pinned mpg123 decoder source and rebuild materials

`decoder.wasm` is the unmodified 99,479-byte binary extracted from
`mpg123-decoder@1.0.3`. Its SHA-256 is
`f0e9e8848367320ccb757e4092f0d6809668cfe38f43139d47b447151d7dff6b`.
The npm integrity, Git revisions, source/archive hashes, and notices are recorded
in `PROVENANCE.json`. The local Forma loader is separate from these unmodified
upstream sources.

## Verified offline extraction

The following commands verify every archived source member against its pinned
Git blob and SHA-256 before writing a new build directory. They then extract the
original compressed WASM without evaluating the upstream generated JavaScript,
installing packages, invoking build scripts, or accessing the network. Run them
from this vendor directory with a destination that does not already exist:

```sh
python3 corresponding-source/materialize.py /tmp/forma-mpg123-source-check
node corresponding-source/extract-wasm.mjs \
  /tmp/forma-mpg123-source-check/wasm-audio-decoders/src/mpg123-decoder/src/EmscriptenWasm.js \
  /tmp/forma-mpg123-source-check/extracted.wasm
```

The extraction receipt must report the SHA-256 above and
`matchesShippedBinary: true`. This was verified locally. It is **not** a C source
rebuild: `sourceBuildReproduced` correctly remains false in this mode. The helper
refuses existing output files and has bounded source, expansion, and WASM sizes.
The exact MIT-licensed `simple-yenc` extraction source is preserved as text and
in its own source archive. Only this offline Node CLI verifies its hash,
materializes an owned temporary `.mjs`, imports it, and cleans it up. The receipt
discloses that dependency execution. It does not evaluate the generated decoder
wrapper or run package lifecycle scripts. The Worker imports none of this CLI
tooling and does not use dynamic compilation, temporary files, or that import.

## Source-build recipe, not executed here

The complete pinned mpg123 Git source tree is supplied, including all source
headers, Autoconf input, build files, and notices. The wrapper archive supplies
the root Makefile, README, build/minification script and lockfiles, complete
mpg123 wrapper source and common source, and the exact mpg123 minified bundle
whose copyright notice is retained. Other codecs and unrelated audio fixtures
are excluded. `materialize.py` places mpg123 at the Makefile's expected
`modules/mpg123` path. No source bytes in either archive are modified.

The pinned upstream README specifies a Linux-like environment, Node.js 18 or
later, and **Emscripten 4.0.7** (Emscripten source revision
`8dc91db45bf96c174531006839472a3924d105aa`). Autoconf/Automake/Libtool and GNU Make
are also required by the actual configure recipe. Provision that toolchain in
a separately approved controlled build environment; this bundle does not
install it or accept an SDK/Xcode license.

After activating that SDK, start from a newly materialized source directory:

```sh
cd /tmp/forma-mpg123-source-check/wasm-audio-decoders
make mpg123-configure
make src/mpg123-decoder/src/EmscriptenWasm.tmp.js
```

These are the pinned Makefile's original targets. The first target runs
`autoreconf -iv`, the full upstream `emconfigure ./configure` flags, and appends
`#define NOQUIET 0` to the generated `modules/mpg123/src/config.h`. The second
compiles the 13 named codec C files and the wrapper with the upstream Emscripten
options. It yields a single-file Emscripten JavaScript build containing base64
WASM. This route does not need npm/minification dependencies to recover the
underlying binary. Do not use `make`'s default all-codec target in this selected
source bundle.

Extract that candidate into a separate file, using an absolute path back to
this vendor directory's helper:

```sh
node /path/to/worker/vendor/mpg123/corresponding-source/extract-wasm.mjs \
  /tmp/forma-mpg123-source-check/wasm-audio-decoders/src/mpg123-decoder/src/EmscriptenWasm.tmp.js \
  /tmp/forma-mpg123-source-check/rebuilt-candidate.wasm --rebuilt
```

This mode reports whether the candidate matches the shipped binary. The mode
flag alone cannot prove any compilation took place: `sourceBuildReproduced`
therefore remains false even on a byte match. Only a separate reviewed build
receipt can establish a source rebuild. This helper never
overwrites `decoder.wasm` and does not grant permission to replace it. Preserve
the compiler/SDK/host versions, configure output, generated config/header files,
link information, emitted JavaScript, hash, and test receipts for any rebuild.
A differing candidate needs ABI, behavior, memory, fixture, and packaging review
before adoption. Changes to codec source must be recorded separately with dates.

## What is and is not established

- All 356 files in the pinned mpg123 Git tree and all 32 selected wrapper files
  were checked against the exact Git blob identities. The full codec source
  archive is 877,073 bytes; no codec source was omitted.
- The npm binary and the pinned generated wrapper source yield the same WASM.
  The npm registry's `gitHead` agrees with the wrapper source pin, and that
  revision pins the exact mpg123 submodule. These facts establish provenance
  correspondence; they do not replace a signed upstream build attestation.
- A source build has **not** run. The original build's generated `config.h`,
  configured headers, link map, SDK cache objects, and exact host tool versions
  are not supplied by upstream's pinned tree. The original Makefile explains
  how to regenerate them. Byte-identical reproducibility is unproved.
- Emscripten, libc, compiler runtime, and their build tools are external pinned
  toolchain prerequisites. Their notice files and primary source links are
  preserved; this packet does not contain a complete SDK checkout or claim an
  exact link-map attribution for every retained runtime/math routine.
- The local machine lacked `emcc`/`wasm-ld`, and Apple clang was blocked by its
  unaccepted Xcode license during earlier feasibility work. No toolchain was
  installed or license accepted to change that condition.
- Offline materialization/extraction does not exercise Forma's production
  loader, accept untrusted MP3 input, activate sharing, or authorize a release.

The LGPL codec notice and source/relinking provisions must remain visible to
the release reviewer. Do not substitute an npm JavaScript tarball or source URL
for these supplied library sources, and do not describe the binary as MIT-only.
