"""Inspect without extraction; reproduce Sites' sorted, metadata-free tar hash."""
import hashlib
import io
import json
import sys
import tarfile
from pathlib import PurePosixPath


class DigestWriter:
    def __init__(self):
        self.digest = hashlib.sha256()
        self.size = 0

    def write(self, value):
        self.digest.update(value)
        self.size += len(value)
        return len(value)


def inspect_archive(path):
    entries = {}
    total = 0
    with tarfile.open(path, 'r:*') as archive:
        seen = set()
        for member in archive:
            name = member.name.rstrip('/')
            parts = PurePosixPath(name).parts
            if (name in seen or not parts or parts[0] != 'dist'
                    or '..' in parts or '\\' in name or name.startswith('/')
                    or name != '/'.join(parts)):
                raise ValueError('Unsafe or duplicate archive path')
            seen.add(name)
            if len(seen) > 10000:
                raise ValueError('Archive exceeds entry limit')
            if any(p in ('.git', 'node_modules') or p.startswith(('.env', '.dev.vars'))
                   or p.endswith('.pending.sql') for p in parts):
                raise ValueError('Unsafe release artifact')
            if member.isdir():
                continue
            if not member.isfile() or member.size > 256 * 1024 * 1024:
                raise ValueError('Archive must contain bounded regular files only')
            total += member.size
            if total > 512 * 1024 * 1024:
                raise ValueError('Archive exceeds inspection limit')
            entries[name] = archive.extractfile(member).read()
    sink = DigestWriter()
    with tarfile.open(fileobj=sink, mode='w|', format=tarfile.PAX_FORMAT) as normalized:
        for name, data in sorted(entries.items()):
            info = tarfile.TarInfo(name)
            info.size = len(data)
            info.mode = 0o644
            normalized.addfile(info, io.BytesIO(data))
    return {'normalizedSha256': sink.digest.hexdigest(), 'normalizedBytes': sink.size,
            'files': {name: hashlib.sha256(data).hexdigest() for name, data in sorted(entries.items())}}


if __name__ == '__main__':
    print(json.dumps(inspect_archive(sys.argv[1])))
