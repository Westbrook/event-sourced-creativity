import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, closeSync, constants, openSync, statSync } from 'node:fs';
import { canonical } from './core.mjs';

/** One durable journal per authority domain, never one per manifest. No private prompt bodies. */
export class ExecutionJournal {
  #db;
  constructor(path) {
    // Refuse links; an existing DB must be reused. Never unlink/recreate it on corruption or lock failure.
    const fd = openSync(path, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
    closeSync(fd);
    if (!statSync(path).isFile()) throw new Error('journal_not_file');
    chmodSync(path,0o600);
    this.#db = new DatabaseSync(path);
    this.#db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS identity (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
      INSERT OR IGNORE INTO state VALUES (1,'{"schema":1,"scopes":{},"operations":{}}');`);
    this.#db.prepare('INSERT OR IGNORE INTO identity VALUES (1,?)').run(randomUUID());
  }
  get identity() { return this.#db.prepare('SELECT value FROM identity WHERE id=1').get().value; }
  close() { this.#db.close(); }
  read() { return JSON.parse(this.#db.prepare('SELECT body FROM state WHERE id=1').get().body); }
  events() { return this.#db.prepare('SELECT seq, body FROM events ORDER BY seq').all().map(r => ({seq:r.seq,...JSON.parse(r.body)})); }
  transaction(fn) {
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const state=this.read(), events=[];
      const result=fn(state, event => events.push(event));
      if(result?.then) throw new Error('journal_transaction_must_be_synchronous');
      this.#db.prepare('UPDATE state SET body=? WHERE id=1').run(canonical(state));
      for(const event of events) this.#db.prepare('INSERT INTO events(body) VALUES (?)').run(canonical(event));
      this.#db.exec('COMMIT'); return structuredClone(result);
    } catch(error) { this.#db.exec('ROLLBACK'); throw error; }
  }
}
