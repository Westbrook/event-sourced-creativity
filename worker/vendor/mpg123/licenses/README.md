# Decoder notices

The decoder is not MIT-only. These files preserve notices from the pinned sources;
they do not assert that Forma has published this dormant module or determine the
legal obligations of a particular future distribution.

| Component | Notice and provenance |
| --- | --- |
| libmpg123 1.29.0 | `MPG123-COPYING` and `MPG123-AUTHORS` are verbatim files from commit `08247b317163175e62035893af3ff9e71a5dfefd`. The applicable codec-source declarations name LGPL 2.1. COPYING also includes GPLv2 text for an optional conversion; including that text does not assert a conversion occurred. |
| wasm-audio-decoders wrapper | `WRAPPER-UPSTREAM-NOTICES.txt` preserves the published `Copyright 2021-2025 Ethan Halsall` banner and the pinned README's MIT declaration. The complete upstream tree has no standalone LICENSE/COPYING/NOTICE at this revision. `MIT-STANDARD-TEXT.txt` is the standard MIT text from SPDX license-list-data v3.27.0. `WRAPPER-MIT-NOTICE.txt` explicitly labels the assembled notice that fills its placeholder copyright line from the actual upstream banner; neither file is represented as a missing upstream LICENSE. |
| Emscripten | `EMSCRIPTEN-LICENSE-4.0.7.txt` is the full upstream dual MIT / Illinois-NCSA text. `EMMALLOC-UPSTREAM-NOTICE.txt` preserves the exact allocator header's additional 2018 Emscripten Authors notice. Emscripten 4.0.7 is the wrapper README's declared prerequisite, not a verified build attestation for the npm binary. |
| musl / compiler runtime | `EMSCRIPTEN-MUSL-COPYRIGHT-4.0.7.txt` and `EMSCRIPTEN-COMPILER-RT-LICENSE-4.0.7.txt` preserve the full corresponding toolchain notice files, including their component exceptions. No link map was available to prove exactly which math/runtime portions remain in the shipped binary. |
| simple-yenc 1.0.4 | `SIMPLE-YENC-LICENSE` accompanies the exact source used by the offline extraction helper. It is extraction tooling only; it is not imported by the Forma Worker. |
| puff | `PUFF-UPSTREAM-HEADER.txt` is the verbatim upstream header containing Mark Adler's zlib-style notice. The common-source archive preserves upstream's altered puff source and its own alteration note. Forma's static decoder loader and the offline Node extraction helper do not execute puff. |

All copied codec files, including their individual notices, are preserved in the
complete source archive. Archive/member hashes and primary-source URLs are in
`../PROVENANCE.json` and `../corresponding-source/*-manifest.json`.
