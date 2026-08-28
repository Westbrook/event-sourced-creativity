import assert from "node:assert/strict";

const copy = (value) => value === undefined ? undefined : structuredClone(value);
const storageError = (name, message = name) => new DOMException(message, name);
const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

/**
 * Deterministic in-memory port of the IndexedDB behavior used by account-cache.
 * This is not a browser certification. It deliberately enforces the native
 * connection FIFO, overlapping-store transaction order, active request tasks,
 * structured cloning, and atomic completion/abort. A gate delays a background
 * operation or its notification; it never lets a later connection overtake an
 * unfinished opening or two overlapping readwrite transactions run together.
 */
export class AccountCacheIndexedDbFixture {
  constructor({ version = 3, rows = [], storeExists = true } = {}) {
    this.name = "forma-account-snapshots-v1";
    this.storeName = "snapshots";
    this.version = version;
    this.storeExists = storeExists;
    this.rows = new Map(rows.map((row) => [row.key, copy(row)]));
    this.trace = [];
    this.connections = [];
    this.transactions = [];
    this.opens = [];
    this.openQueue = [];
    this.gates = [];
    this.hooks = [];
    this.failures = [];
    this.errors = [];
    this.pendingTasks = 0;
    this.counter = 0;
    this.indexedDB = { open: (name, requestedVersion) => this.open(name, requestedVersion) };
  }

  record(phase, meta = {}) {
    const entry = { order: ++this.counter, phase, ...meta };
    this.trace.push(entry);
    return entry;
  }

  task(phase, meta, run) {
    const runTask = () => {
      this.pendingTasks += 1;
      setImmediate(() => {
        this.pendingTasks -= 1;
        try {
          const entry = this.record(phase, meta);
          for (const hook of this.hooks) {
            if (!hook.done && hook.phase === phase && hook.predicate(entry)) {
              hook.done = true;
              hook.run(entry);
            }
          }
          run();
        } catch (error) { this.errors.push(error); }
      });
    };
    const gate = this.gates.find((candidate) => !candidate.entered && candidate.phase === phase && candidate.predicate(meta));
    if (!gate) { runTask(); return; }
    gate.entered = true;
    gate.entry = this.record(phase + ":held", meta);
    gate.resume = runTask;
    gate.resolve(gate.entry);
  }

  gate(phase, predicate = () => true) {
    const gate = { phase, predicate, entered: false, released: false };
    gate.wait = new Promise((resolve) => { gate.resolve = resolve; });
    gate.release = () => {
      assert.equal(gate.entered, true, "a gate can only release an actually reached native boundary");
      assert.equal(gate.released, false, "a native notification is released exactly once");
      gate.released = true;
      gate.resume();
    };
    this.gates.push(gate);
    return gate;
  }

  on(phase, run, predicate = () => true) {
    const hook = { phase, run, predicate, done: false };
    this.hooks.push(hook);
    return hook;
  }

  failNext(phase, name = "AbortError", predicate = () => true) {
    this.failures.push({ phase, name, predicate });
  }

  failure(phase, meta) {
    const index = this.failures.findIndex((entry) => entry.phase === phase && entry.predicate(meta));
    return index < 0 ? null : storageError(this.failures.splice(index, 1)[0].name);
  }

  async until(predicate, label = "native boundary") {
    const deadline = performance.now() + 3_000;
    do {
      if (this.errors.length) throw this.errors[0];
      if (predicate()) return;
      await nextTurn();
    } while (performance.now() < deadline);
    throw new Error("Timed out waiting for " + label + "\n" + JSON.stringify(this.trace.slice(-16)));
  }

  async quiet() {
    for (let count = 0; count < 4; count += 1) await nextTurn();
    if (this.errors.length) throw this.errors[0];
  }

  install() {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, writable: true, value: this.indexedDB });
    return () => {
      if (previous) Object.defineProperty(globalThis, "indexedDB", previous);
      else delete globalThis.indexedDB;
    };
  }

  seed(...rows) { for (const row of rows) this.rows.set(row.key, copy(row)); }
  committed() { return [...this.rows.values()].map(copy); }
  row(key) { return copy(this.rows.get(key)); }
  activeHandles() { return this.connections.filter((connection) => !connection.closed).length; }

  holdConnection() {
    const connection = this.connection();
    this.record("connection:held", { connection: connection.id });
    return connection;
  }

  open(name, requestedVersion) {
    assert.equal(name, this.name, "account fixture cannot impersonate analytics or another database");
    assert.equal(requestedVersion, 3, "the existing account-cache schema/version must not change");
    const request = { id: this.opens.length + 1, result: undefined, error: null, transaction: null,
      onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null, done: false };
    this.opens.push(request);
    this.openQueue.push({ request, version: requestedVersion, started: false, notified: false });
    this.record("open:called", { open: request.id });
    this.startOpen();
    return request;
  }

  startOpen() {
    const entry = this.openQueue[0];
    if (!entry || entry.started) return;
    entry.started = true;
    this.task("open:begin", { open: entry.request.id }, () => this.openStep(entry));
  }

  openStep(entry) {
    if (entry.request.done || entry.upgrading) return;
    assert.equal(this.openQueue[0], entry, "connection opens process FIFO");
    const failed = this.failure("open:begin", { open: entry.request.id });
    if (failed) { this.finishOpen(entry, failed); return; }
    if (entry.version < this.version) { this.finishOpen(entry, storageError("VersionError")); return; }
    if (entry.version > this.version) {
      const blockers = this.connections.filter((connection) => !connection.closed);
      if (blockers.length) {
        if (entry.notified) return;
        entry.notified = true;
        this.task("open:versionchange", { open: entry.request.id }, () => {
          for (const connection of blockers) connection.onversionchange?.({ oldVersion: this.version, newVersion: entry.version });
          if (this.connections.some((connection) => !connection.closed)) {
            this.task("open:blocked", { open: entry.request.id }, () => entry.request.onblocked?.({ oldVersion: this.version, newVersion: entry.version }));
          } else this.openStep(entry);
        });
        return;
      }
      entry.upgrading = true;
      this.upgrade(entry);
      return;
    }
    entry.request.result = this.connection();
    this.finishOpen(entry);
  }

  upgrade(entry) {
    const connection = this.connection();
    const draft = new Map([...this.rows].map(([key, value]) => [key, copy(value)]));
    const beforeStore = this.storeExists;
    let active = false, aborted = false;
    const request = entry.request;
    const upgradeTransaction = {
      objectStore: (name) => {
        assert.equal(active, true, "versionchange requests require an active callback");
        assert.equal(name, this.storeName);
        return { clear: () => { draft.clear(); return {}; } };
      },
      abort: () => { if (!active || aborted) throw storageError("InvalidStateError"); aborted = true; },
    };
    connection.upgrade = { create: () => { assert.equal(active, true); this.storeExists = true; } };
    request.result = connection;
    request.transaction = upgradeTransaction;
    this.task("open:upgrade", { open: request.id, connection: connection.id }, () => {
      active = true;
      try { request.onupgradeneeded?.({ oldVersion: this.version, newVersion: entry.version }); }
      catch (error) { aborted = true; this.errors.push(error); }
      active = false;
      connection.upgrade = null;
      request.transaction = null;
      if (aborted) {
        this.storeExists = beforeStore;
        connection.close();
        this.finishOpen(entry, storageError("AbortError"));
      } else {
        this.rows = draft;
        this.version = entry.version;
        this.finishOpen(entry);
      }
    });
  }

  finishOpen(entry, error = null) {
    const request = entry.request;
    assert.equal(this.openQueue.shift(), entry);
    request.done = true;
    request.error = error;
    this.task(error ? "open:error" : "open:success", { open: request.id, connection: request.result?.id }, () => {
      if (error) request.onerror?.({ target: request });
      else request.onsuccess?.({ target: request });
    });
    this.startOpen();
  }

  connection() {
    const connection = {
      id: this.connections.length + 1,
      closed: false, closePending: false, onversionchange: null, upgrade: null,
      objectStoreNames: { contains: (name) => this.storeExists && name === this.storeName },
      createObjectStore: (name, options) => {
        assert.equal(name, this.storeName);
        assert.deepEqual(options, { keyPath: "key" });
        assert.ok(connection.upgrade, "store creation is only valid during versionchange");
        connection.upgrade.create();
        return {};
      },
      transaction: (name, mode) => {
        if (connection.closed || connection.closePending) throw storageError("InvalidStateError");
        assert.equal(name, this.storeName);
        assert.ok(this.storeExists);
        assert.ok(mode === "readonly" || mode === "readwrite");
        return this.transaction(connection, mode);
      },
      close: () => {
        connection.closePending = true;
        this.record("connection:close", { connection: connection.id });
        this.finishConnection(connection);
      },
    };
    this.connections.push(connection);
    this.record("connection:created", { connection: connection.id });
    return connection;
  }

  finishConnection(connection) {
    if (!connection.closePending || connection.closed ||
      this.transactions.some((transaction) => transaction.connection === connection && !transaction.finished)) return;
    connection.closed = true;
    const entry = this.openQueue[0];
    if (entry?.started && entry.notified && !this.connections.some((candidate) => !candidate.closed)) {
      this.task("open:unblocked", { open: entry.request.id }, () => this.openStep(entry));
    }
  }

  transaction(connection, mode) {
    const transaction = {
      id: this.transactions.length + 1, connection, mode, active: true, ready: false,
      started: false, finished: false, aborting: false, requests: [], cursor: 0,
      error: null, oncomplete: null, onerror: null, onabort: null, work: null, busy: false,
      objectStore: (name) => {
        assert.equal(name, this.storeName);
        if (transaction.finished) throw storageError("InvalidStateError");
        return {
          get: (key) => this.request(transaction, "get", key),
          getAll: () => this.request(transaction, "getAll"),
          put: (value) => this.request(transaction, "put", value.key, value),
          delete: (key) => this.request(transaction, "delete", key),
          clear: () => this.request(transaction, "clear"),
        };
      },
      abort: () => { this.abort(transaction); },
    };
    this.transactions.push(transaction);
    this.record("transaction:created", { transaction: transaction.id, connection: connection.id, mode });
    this.task("transaction:ready", { transaction: transaction.id, mode }, () => {
      transaction.active = false;
      transaction.ready = true;
      this.startTransactions();
    });
    return transaction;
  }

  startTransactions() {
    for (const transaction of this.transactions) {
      if (!transaction.ready || transaction.started || transaction.finished) continue;
      const blocked = this.transactions.some((earlier) => earlier.id < transaction.id && !earlier.finished &&
        (earlier.mode === "readwrite" || transaction.mode === "readwrite"));
      if (blocked) continue;
      transaction.started = true;
      transaction.work = new Map([...this.rows].map(([key, value]) => [key, copy(value)]));
      this.record("transaction:started", { transaction: transaction.id, mode: transaction.mode });
      this.nextRequest(transaction);
    }
  }

  request(transaction, kind, key, value) {
    if (!transaction.active || transaction.finished || transaction.aborting) throw storageError("TransactionInactiveError");
    if (kind === "put" || kind === "delete" || kind === "clear") {
      if (transaction.mode !== "readwrite") throw storageError("ReadOnlyError");
    }
    const request = { kind, key, value: copy(value), result: undefined, error: null,
      onsuccess: null, onerror: null, done: false };
    transaction.requests.push(request);
    this.record("request:queued", { transaction: transaction.id, kind, key });
    return request;
  }

  nextRequest(transaction) {
    if (transaction.finished || transaction.aborting || transaction.busy) return;
    const request = transaction.requests[transaction.cursor];
    if (!request) {
      transaction.busy = true;
      this.task("transaction:commit", { transaction: transaction.id, mode: transaction.mode }, () => this.commit(transaction));
      return;
    }
    transaction.busy = true;
    const meta = { transaction: transaction.id, mode: transaction.mode, kind: request.kind, key: request.key };
    this.task("request:" + request.kind, meta, () => {
      if (transaction.finished || transaction.aborting) return;
      const error = this.failure("request:" + request.kind, meta);
      if (error) request.error = error;
      else {
        if (request.kind === "get") request.result = copy(transaction.work.get(request.key));
        else if (request.kind === "getAll") request.result = [...transaction.work.values()].map(copy);
        else if (request.kind === "put") { transaction.work.set(request.key, copy(request.value)); request.result = request.key; }
        else if (request.kind === "delete") transaction.work.delete(request.key);
        else if (request.kind === "clear") transaction.work.clear();
      }
      this.task("request:event:" + request.kind, meta, () => this.requestEvent(transaction, request));
    });
  }

  requestEvent(transaction, request) {
    if (transaction.finished || transaction.aborting) return;
    request.done = true;
    transaction.active = true;
    const event = { target: request, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    try {
      if (request.error) {
        request.onerror?.(event);
        if (!transaction.finished && !transaction.aborting) transaction.onerror?.(event);
        if (!event.defaultPrevented && !transaction.finished && !transaction.aborting) this.abort(transaction, request.error);
      } else request.onsuccess?.(event);
    } catch (error) {
      this.abort(transaction, storageError("AbortError", String(error)));
      this.errors.push(error);
    } finally { transaction.active = false; }
    transaction.cursor += 1;
    transaction.busy = false;
    this.nextRequest(transaction);
  }

  commit(transaction) {
    if (transaction.finished || transaction.aborting) return;
    const error = this.failure("transaction:commit", { transaction: transaction.id, mode: transaction.mode });
    if (error) { this.abort(transaction, error); return; }
    if (transaction.mode === "readwrite") this.rows = transaction.work;
    transaction.finished = true;
    transaction.active = false;
    this.record("transaction:committed", { transaction: transaction.id, mode: transaction.mode });
    this.finishConnection(transaction.connection);
    this.startTransactions();
    this.task("transaction:complete", { transaction: transaction.id, mode: transaction.mode }, () => transaction.oncomplete?.({ target: transaction }));
  }

  abort(transaction, error = storageError("AbortError")) {
    if (transaction.finished || transaction.aborting) throw storageError("InvalidStateError");
    transaction.aborting = true;
    transaction.active = false;
    transaction.finished = true;
    transaction.error = error;
    this.record("transaction:rolled-back", { transaction: transaction.id, mode: transaction.mode });
    this.finishConnection(transaction.connection);
    this.startTransactions();
    this.task("transaction:abort", { transaction: transaction.id, mode: transaction.mode }, () => transaction.onabort?.({ target: transaction }));
  }

  assertConsistent() {
    assert.deepEqual(this.errors, []);
    assert.equal(this.transactions.some((transaction) => !transaction.finished), false, "no leaked native transactions");
    assert.equal(this.activeHandles(), 0, "all cache-owned connections are closed");
    for (const transaction of this.transactions) {
      const started = this.trace.find((entry) => entry.phase === "transaction:started" && entry.transaction === transaction.id)?.order;
      if (!started) continue;
      for (const earlier of this.transactions.filter((entry) => entry.id < transaction.id &&
        (entry.mode === "readwrite" || transaction.mode === "readwrite"))) {
        const finished = this.trace.find((entry) => ["transaction:committed", "transaction:rolled-back"].includes(entry.phase) && entry.transaction === earlier.id)?.order;
        assert.ok(finished < started, "overlapping-store transaction started before its predecessor finished");
      }
    }
  }
}
