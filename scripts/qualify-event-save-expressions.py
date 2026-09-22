"""Compile the exact authenticated maintenance batches at D1's expression limit.

Input contains only schema and synthetic fixture statements. DML is explained,
not executed; DDL is applied so later statements see the correct schema.
"""
import json
import sqlite3
import sys

source = json.load(sys.stdin)
db = sqlite3.connect(':memory:')
db.execute('PRAGMA foreign_keys=ON')
for kind in ('table', 'index', 'trigger'):
    for row in source['schema']:
        if row['type'] == kind:
            db.execute(row['sql'])
db.setlimit(sqlite3.SQLITE_LIMIT_EXPR_DEPTH, 100)
count = 0
for batch in source['batches']:
    db.execute('SAVEPOINT qualification')
    for index, statement in enumerate(batch):
        sql, values = statement['sql'], statement['values']
        try:
            db.execute('EXPLAIN ' + sql, values).fetchall()
            if sql.startswith(('CREATE ', 'DROP ')):
                db.execute(sql, values)
            count += 1
        except sqlite3.DatabaseError as error:
            raise AssertionError(f'Batch statement {index}: {error}; {sql[:100]}') from error
    if not any(s['sql'].startswith('DROP TRIGGER') for s in batch):
        db.execute('ROLLBACK TO qualification')
    db.execute('RELEASE qualification')
print(json.dumps({'expressionDepth': 100, 'compiledStatements': count}))
