"""Disposable SQLite compiler qualification. JSON stdin contains schema only."""
import json
import sqlite3
import sys

source = json.load(sys.stdin)
results = {}
for name in ('before', 'after'):
    db = sqlite3.connect(':memory:')
    db.execute('PRAGMA foreign_keys=ON')
    # Preserve creation order within each kind, including trigger ordering.
    for kind in ('table', 'index', 'trigger'):
        for row in source[name]:
            if row['type'] == kind:
                db.execute(row['sql'])
    db.setlimit(sqlite3.SQLITE_LIMIT_TRIGGER_DEPTH, 3)
    try:
        db.execute(source['probe'])
        results[name] = 'saved'
        assert db.execute('SELECT count(*) FROM events').fetchone()[0] == 1
        assert db.execute('SELECT count(*) FROM event_private_payloads').fetchone()[0] == 1
        assert db.execute('SELECT count(*) FROM event_write_stage').fetchone()[0] == 0
    except sqlite3.DatabaseError as error:
        results[name] = str(error)
    finally:
        db.close()
assert results['after'] == 'saved', results
# SQLite 3.53 introduced the compilation-depth check; old SQLite can execute
# the empty graph without walking the inactive chains at runtime.
if sqlite3.sqlite_version_info >= (3, 53, 0):
    assert 'triggers nested too deep' in results['before'], results
print(json.dumps({'sqlite': sqlite3.sqlite_version, 'triggerDepth': 3, **results}))
