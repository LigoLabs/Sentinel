interface DbLike {
  exec(sql: string): void;
}

export function createSchema(db: DbLike): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS data_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      label TEXT NOT NULL,
      config_encrypted TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS backup_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL UNIQUE,
      cron_expression TEXT NOT NULL DEFAULT '0 3 * * *',
      retention_count INTEGER NOT NULL DEFAULT 15,
      retention_monthly INTEGER NOT NULL DEFAULT 1,
      cron_lifetime TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS backups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      type TEXT NOT NULL DEFAULT 'daily',
      status TEXT NOT NULL DEFAULT 'running',
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      size_bytes INTEGER DEFAULT 0,
      file_path TEXT,
      error_message TEXT,
      metadata TEXT DEFAULT '{}',
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_backups_project_date
      ON backups(project_id, started_at DESC);

    CREATE INDEX IF NOT EXISTS idx_backups_status
      ON backups(status);

    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      backup_id INTEGER,
      type TEXT NOT NULL DEFAULT 'failure',
      message TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (backup_id) REFERENCES backups(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_alerts_unread
      ON alerts(is_read, created_at DESC);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Migrations idempotentes pour les DBs existantes. On tente chaque migration
  // et on tolère les erreurs "no-op" :
  //   - ADD COLUMN sur col déjà existante → "duplicate column"
  //   - RENAME COLUMN sur col déjà renommée → "no such column"
  for (const alter of [
    `ALTER TABLE backup_schedules ADD COLUMN cron_lifetime TEXT`,
    `ALTER TABLE backup_schedules RENAME COLUMN retention_daily_days TO retention_count`,
  ]) {
    try {
      db.exec(alter);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/duplicate column|no such column/i.test(msg)) throw err;
    }
  }
}
