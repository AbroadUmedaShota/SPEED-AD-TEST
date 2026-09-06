import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const migration = new URL(
  '../../99_backend-docs/10_support-contact/d1-poc/migrations/0001_atomic_note.sql', import.meta.url);

export function openSqlite(path = ':memory:', initialize = true, beforeBatch = () => {}) {
  const sqlite = new DatabaseSync(path);
  sqlite.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (initialize) {
    sqlite.exec(readFileSync(migration, 'utf8'));
    sqlite.exec(`INSERT INTO poc_operators VALUES ('demo-a', 1), ('demo-b', 1), ('disabled', 0);
      INSERT INTO poc_cases VALUES
      ('case-1', '未対応', 1, NULL, '2026-01-01T00:00:00.000Z'),
      ('case-2', '対応中', 1, NULL, '2026-01-01T00:00:00.000Z');`);
  }
  const adapter = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            sql, args,
            async first() { return sqlite.prepare(sql).get(...args) ?? null; },
          };
        },
      };
    },
    async batch(statements) {
      beforeBatch();
      // This emulates the documented D1 batch contract, not D1's distributed runtime.
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results = statements.map(({ sql, args }) => sqlite.prepare(sql).run(...args));
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return { sqlite, adapter };
}

export function snapshot(sqlite) {
  return Object.fromEntries(['poc_cases', 'poc_requests', 'poc_events'].map(table => [
    table, sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map(row => ({ ...row })),
  ]));
}
