#!/usr/bin/env python3
"""Verify and materialize the pinned sources without network or script execution."""

import hashlib
import json
from pathlib import Path, PurePosixPath
import sys
import tarfile

HERE = Path(__file__).resolve().parent


def verified_members(manifest_name, prefix, destination_prefix):
    manifest = json.loads((HERE / manifest_name).read_text())
    archive = HERE / manifest["archive"]
    if hashlib.sha256(archive.read_bytes()).hexdigest() != manifest["archiveSha256"]:
        raise ValueError(f"archive hash mismatch: {archive.name}")
    expected = {entry["path"]: entry for entry in manifest["files"]}
    if len(expected) != len(manifest["files"]):
        raise ValueError("duplicate manifest entry")
    results = []
    seen = set()
    expanded = 0
    with tarfile.open(archive, "r:gz") as source:
        for member in source:
            if member.isdir():
                continue
            if not member.isfile() or member.name in seen:
                raise ValueError("unsupported or duplicate archive entry")
            seen.add(member.name)
            path = PurePosixPath(member.name)
            if path.is_absolute() or ".." in path.parts or not member.name.startswith(prefix):
                raise ValueError("unsafe archive path")
            key = member.name[len(prefix):]
            entry = expected.pop(key, None)
            if entry is None or member.size != entry["bytes"]:
                raise ValueError("unexpected archive member")
            expanded += member.size
            if expanded > 5_000_000:
                raise ValueError("source expansion limit")
            data = source.extractfile(member).read(member.size + 1)
            blob = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
            if (len(data) != member.size or hashlib.sha256(data).hexdigest() != entry["sha256"]
                    or blob != entry["gitBlobSha1"]):
                raise ValueError("source member hash mismatch")
            mode = int(entry.get("mode", "100644"), 8) & 0o777
            if mode not in (0o644, 0o755):
                raise ValueError("unexpected source mode")
            results.append((destination_prefix / key, data, mode))
    if expected:
        raise ValueError("missing source members")
    return results


def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: python3 materialize.py NEW_EMPTY_BUILD_DIRECTORY")
    destination = Path(sys.argv[1]).resolve()
    if destination.exists():
        raise ValueError("destination must not exist")
    # Verify every archive/member before writing any files.
    entries = verified_members("wrapper-source-manifest.json", "", Path())
    entries += verified_members(
        "codec-source-manifest.json",
        "mpg123-08247b317163175e62035893af3ff9e71a5dfefd/",
        Path("wasm-audio-decoders/modules/mpg123"),
    )
    destination.mkdir(parents=True)
    for relative, data, mode in entries:
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("xb") as output:
            output.write(data)
        target.chmod(mode)
    print(json.dumps({"files": len(entries), "buildRoot": str(destination / "wasm-audio-decoders"),
                      "networkRequests": 0, "upstreamScriptsExecuted": 0}))


if __name__ == "__main__":
    main()
