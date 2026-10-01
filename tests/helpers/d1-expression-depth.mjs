import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cachedCompile } from "./sqlite-compile-cache.mjs";

// Node's SQLite defaults to depth 1000. D1 allows 100. Compile the actual request
// statement in a fresh in-memory SQLite connection before the fixture can execute it.
// The default prepare-time check sends only schema and SQL, never fixture row data.
// An explicit bindings option is available for exact mocked-statement probes.
// Optional queryLimits additionally applies real SQLite function/variable limits,
// workerd's fixed five-term compound SELECT limit, and the raw UTF-8 SQL byte
// ceiling. Omission preserves depth-only behavior and the existing receipt shape.
const COMPILE = String.raw`
import json,re,sqlite3,sys,time
started=time.monotonic()
def milestone(stage,**fields):
    print(json.dumps({"stage":stage,"elapsedMs":round((time.monotonic()-started)*1000),**fields}),file=sys.stderr,flush=True)
milestone("started")
# The parent owns one complete JSON frame. Do not wait for a separate pipe EOF
# after all of its UTF-8 bytes have arrived.
if len(sys.argv)!=2 or not re.fullmatch(r"[1-9][0-9]*",sys.argv[1]):
    raise ValueError("D1 compiler requires a positive decimal input byte length")
expected=int(sys.argv[1])
if expected>sys.maxsize:
    raise ValueError("D1 compiler input byte length exceeds the platform limit")
milestone("input-read-start",expectedBytes=expected)
payload=sys.stdin.buffer.read(expected)
milestone("input-read-complete",expectedBytes=expected,receivedBytes=len(payload))
if len(payload)!=expected:
    raise EOFError("D1 compiler input frame is truncated")
data=json.loads(payload)
milestone("input-parsed")
if not hasattr(sqlite3.Connection,"setlimit"):
    raise RuntimeError("D1 depth tests require Python 3.11+ with sqlite3.Connection.setlimit")
db=sqlite3.connect(":memory:",cached_statements=0)
class ExplainAggregate:
    def step(self,*args): pass
    def finalize(self): return 1
class ExplainWindow(ExplainAggregate):
    def value(self): return 1
    def inverse(self,*args): pass
for function in data.get("functions",[]):
    if function["type"]=="a":
        db.create_aggregate(function["name"],function["narg"],ExplainAggregate)
    elif function["type"]=="w":
        db.create_window_function(function["name"],function["narg"],ExplainWindow)
    else:
        db.create_function(function["name"],function["narg"],lambda *args:1,deterministic=bool(function["flags"]&2048))
for statement in data["schema"]:
    db.executescript(statement+";")
milestone("schema-created")
db.setlimit(sqlite3.SQLITE_LIMIT_EXPR_DEPTH,data["limit"])
assert db.getlimit(sqlite3.SQLITE_LIMIT_EXPR_DEPTH)==data["limit"]
query_limits=data.get("queryLimits")
statement_bytes=len(data["sql"].encode("utf-8"))
parameter_count=len(data.get("bindings",[]))
if query_limits is not None:
    db.setlimit(sqlite3.SQLITE_LIMIT_COMPOUND_SELECT,5)
    assert db.getlimit(sqlite3.SQLITE_LIMIT_COMPOUND_SELECT)==5
    db.setlimit(sqlite3.SQLITE_LIMIT_FUNCTION_ARG,query_limits["functionArguments"])
    db.setlimit(sqlite3.SQLITE_LIMIT_VARIABLE_NUMBER,query_limits["parameters"])
    # EXPLAIN is test-only framing. The raw statement gets its own exact byte
    # check below; permit that prefix without subtracting from D1's SQL budget.
    db.setlimit(sqlite3.SQLITE_LIMIT_SQL_LENGTH,query_limits["sqlBytes"]+len("EXPLAIN "))
    assert db.getlimit(sqlite3.SQLITE_LIMIT_FUNCTION_ARG)==query_limits["functionArguments"]
    assert db.getlimit(sqlite3.SQLITE_LIMIT_VARIABLE_NUMBER)==query_limits["parameters"]
    assert db.getlimit(sqlite3.SQLITE_LIMIT_SQL_LENGTH)==query_limits["sqlBytes"]+len("EXPLAIN ")
try:
    if query_limits is not None and statement_bytes>query_limits["sqlBytes"]:
        raise sqlite3.OperationalError("D1 SQL statement byte limit exceeded")
    if query_limits is not None and parameter_count>query_limits["parameters"]:
        raise sqlite3.OperationalError("D1 bound parameter limit exceeded")
    try:
        milestone("before-explain",suppliedBindings=len(data.get("bindings",[])))
        compiled=db.execute("EXPLAIN "+data["sql"],data.get("bindings",[]))
    except sqlite3.ProgrammingError as error:
        # SQLite reports the real parameter count after parsing. Null placeholders
        # suffice for EXPLAIN: none of the target statement's operations execute.
        match=re.fullmatch(r"Incorrect number of bindings supplied\. The current statement uses (\d+), and there are 0 supplied\.",str(error))
        if not match:
            raise
        parameter_count=int(match.group(1))
        milestone("before-explain-placeholder-bindings",placeholderBindings=parameter_count)
        compiled=db.execute("EXPLAIN "+data["sql"],(None,)*int(match.group(1)))
    compiled.fetchall()
    milestone("after-explain")
    result={"ok":True}
except sqlite3.Error as error:
    milestone("sqlite-error")
    result={"ok":False,"error":str(error)}
print(json.dumps({**result,"limit":data["limit"],"sqliteVersion":sqlite3.sqlite_version,
    **({"queryLimits":query_limits,"statementBytes":statement_bytes,"parameterCount":parameter_count} if query_limits is not None else {})}))
milestone("finished")
`;
const schemaSql = sqlite => sqlite.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'view' THEN 2 ELSE 3 END").all().map(row => row.sql);

const functionSignatures = sqlite => sqlite.prepare("PRAGMA function_list").all().filter(row => !row.builtin)
  .map(({ name, narg, type, flags }) => ({ name, narg, type, flags }))
  .sort((a, b) => a.name.localeCompare(b.name) || a.narg - b.narg || a.type.localeCompare(b.type));

/**
 * @param {import('node:sqlite').DatabaseSync} sqlite
 * @param {string} sql
 * @param {{limit?: number, schema?: string[], bindings?: unknown[], functions?: Array<{name: string, narg: number, type: string, flags: number}>, queryLimits?: {functionArguments: number, parameters: number, sqlBytes: number}}} options
 */
export function compileSqliteExpressionDepth(sqlite, sql, { limit = 100, schema = schemaSql(sqlite), bindings, functions = functionSignatures(sqlite), queryLimits } = {}) {
  const started = performance.now();
  if (queryLimits !== undefined) {
    assert.deepEqual(Object.keys(queryLimits).sort(), ["functionArguments", "parameters", "sqlBytes"]);
    assert.ok(Object.values(queryLimits).every(value => Number.isSafeInteger(value) && value > 0));
  }
  const input = JSON.stringify({ schema, sql, limit, functions, ...(queryLimits === undefined ? {} : { queryLimits }), ...(bindings === undefined ? {} : { bindings }) });
  const python = process.env.FORMA_SQLITE_PYTHON ?? "python3";
  return cachedCompile(python, COMPILE, input, () => {
  const compiled = spawnSync(python, ["-I", "-S", "-B", "-c", COMPILE, String(Buffer.byteLength(input, "utf8"))], {
    input, encoding: "utf8", maxBuffer: 4 * 1024 * 1024, timeout: 30_000,
  });
  try {
    assert.equal(compiled.status, 0, (compiled.stderr || compiled.error?.message || compiled.stdout) + "\n" + sql.slice(0, 220));
    return JSON.parse(compiled.stdout);
  } catch (error) {
    // A route may turn this assertion into a generic response before the fixture
    // sees it. Keep process/stage evidence here, without printing fixture values.
    console.error("[forma:d1-compiler-failure] " + JSON.stringify({
      elapsedMs: Math.round(performance.now() - started), limit,
      sqlSha256: createHash("sha256").update(sql).digest("hex"), sqlBytes: Buffer.byteLength(sql),
      schemaStatements: schema.length, suppliedBindings: bindings?.length ?? null,
      status: compiled.status, signal: compiled.signal,
      processError: compiled.error ? { name: compiled.error.name, code: compiled.error.code, message: compiled.error.message } : null,
      childStderr: compiled.stderr?.slice(-8192) ?? "", childStdout: compiled.stdout?.slice(-2048) ?? "",
    }));
    throw error;
  }
  });
}

// Only reuse a completed compile for identical SQL, schema, function signatures and limits. The
// Python connection itself disables prepared-statement caching before setting its limit.
const verifiedCompiles = new Map();
export function enforceD1ExpressionDepth(state, { queryLimits } = {}) {
  queryLimits = queryLimits === undefined ? undefined : structuredClone(queryLimits);
  const original = state.env.DB.prepare, observed = new Set(), records = [], failures = [], boundCounts = [], wrapped = new WeakSet();
  const wrap = statement => {
    if (queryLimits === undefined || wrapped.has(statement)) return statement;
    wrapped.add(statement);
    const bind = statement.bind;
    statement.bind = function (...values) {
      boundCounts.push(values.length);
      if (values.length > queryLimits.parameters) {
        failures.push({ kind: "bound-parameters", count: values.length, limit: queryLimits.parameters });
        assert.fail("D1 bound parameter limit exceeded");
      }
      return wrap(bind.apply(this, values));
    };
    return statement;
  };
  let version = -1, schema = [], schemaHash = "";
  state.env.DB.prepare = function (sql) {
    if (/^\s*(?:SELECT|WITH|INSERT|UPDATE|DELETE)\b/iu.test(sql)) {
      const current = state.sqlite.prepare("PRAGMA schema_version").get().schema_version;
      if (current !== version) {
        version = current; schema = schemaSql(state.sqlite);
        schemaHash = createHash("sha256").update(JSON.stringify(schema)).digest("hex");
      }
      const functions = functionSignatures(state.sqlite);
      const key = schemaHash + "\n" + JSON.stringify(functions) + "\n100\n" + JSON.stringify(queryLimits ?? null) + "\n" + sql;
      let result = verifiedCompiles.get(key);
      if (!result) {
        try {
          result = compileSqliteExpressionDepth(state.sqlite, sql, { schema, functions, queryLimits });
        } catch (error) {
          failures.push({ sql, ok: false, limit: 100, kind: "compiler-exception", error: error instanceof Error ? error.message : String(error) });
          throw error;
        }
        verifiedCompiles.set(key, result);
      }
      if (!observed.has(key)) { observed.add(key); records.push({ sql, ...result }); }
      if (!result.ok) failures.push({ sql, ...result });
      assert.ok(result.ok, result.error + "\n" + sql);
    }
    return wrap(original.call(this, sql));
  };
  return {
    records, failures, boundCounts,
    assertVerified() {
      // Background workers may deliberately catch a database failure: still fail this test.
      assert.deepEqual(failures, []);
      assert.ok(records.length > 0);
      assert.ok(records.every(record => record.limit === 100 && record.ok));
      if (queryLimits !== undefined) assert.ok(boundCounts.every(count => count <= queryLimits.parameters));
      if (queryLimits !== undefined) for (const record of records) {
        assert.deepEqual(record.queryLimits, queryLimits);
        assert.ok(record.statementBytes <= queryLimits.sqlBytes);
        assert.ok(record.parameterCount <= queryLimits.parameters);
      }
    },
    restore() { state.env.DB.prepare = original; },
  };
}
