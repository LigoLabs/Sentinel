import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';
import { createSchema } from './schema.js';

type SqlValue = string | number | Uint8Array | null;

function normalizeParam(p: unknown): SqlValue {
  if (p === undefined || p === null) return null;
  if (typeof p === 'boolean') return p ? 1 : 0;
  if (typeof p === 'bigint') return Number(p);
  return p as SqlValue;
}

class PreparedStatement {
  constructor(
    private rawDb: SqlJsDatabase,
    private sql: string,
    private wrapper: DatabaseWrapper,
  ) {}

  get(...params: unknown[]): any {
    const stmt = this.rawDb.prepare(this.sql);
    try {
      if (params.length > 0) stmt.bind(params.map(normalizeParam));
      if (stmt.step()) {
        return stmt.getAsObject();
      }
      return undefined;
    } finally {
      stmt.free();
    }
  }

  all(...params: unknown[]): any[] {
    const stmt = this.rawDb.prepare(this.sql);
    try {
      if (params.length > 0) stmt.bind(params.map(normalizeParam));
      const rows: any[] = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
      return rows;
    } finally {
      stmt.free();
    }
  }

  run(...params: unknown[]): { changes: number; lastInsertRowid: number } {
    const normalized = params.map(normalizeParam);
    if (normalized.length > 0) {
      this.rawDb.run(this.sql, normalized);
    } else {
      this.rawDb.run(this.sql);
    }
    const changes = this.rawDb.getRowsModified();
    let lastInsertRowid = 0;
    try {
      const result = this.rawDb.exec('SELECT last_insert_rowid() as id');
      if (result.length > 0 && result[0].values.length > 0) {
        lastInsertRowid = result[0].values[0][0] as number;
      }
    } catch { /* ignore */ }
    this.wrapper.persist();
    return { changes, lastInsertRowid };
  }
}

class DatabaseWrapper {
  private rawDb: SqlJsDatabase;
  private dbPath: string;

  constructor(rawDb: SqlJsDatabase, dbPath: string) {
    this.rawDb = rawDb;
    this.dbPath = dbPath;
  }

  exec(sql: string): void {
    this.rawDb.exec(sql);
    this.persist();
  }

  pragma(pragma: string): void {
    try {
      this.rawDb.exec(`PRAGMA ${pragma}`);
    } catch { /* some pragmas are not supported in sql.js */ }
  }

  prepare(sql: string): PreparedStatement {
    return new PreparedStatement(this.rawDb, sql, this);
  }

  persist(): void {
    const data = this.rawDb.export();
    writeFileSync(this.dbPath, Buffer.from(data));
  }

  close(): void {
    this.persist();
    this.rawDb.close();
  }
}

let db: DatabaseWrapper;

export function getDb(): DatabaseWrapper {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

export async function initDatabase(): Promise<void> {
  const SQL = await initSqlJs();
  const dbPath = join(config.DATA_DIR, 'sentinel.db');

  let rawDb: SqlJsDatabase;
  if (existsSync(dbPath)) {
    const buffer = readFileSync(dbPath);
    rawDb = new SQL.Database(buffer);
  } else {
    rawDb = new SQL.Database();
  }

  db = new DatabaseWrapper(rawDb, dbPath);
  db.pragma('foreign_keys = ON');
  createSchema(db);
}
