import { getDb } from '../connection.js';

export interface Backup {
  id: number;
  project_id: number;
  type: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  size_bytes: number;
  file_path: string | null;
  error_message: string | null;
  metadata: string;
}

export interface BackupWithProject extends Backup {
  project_name: string;
}

export interface CreateBackupInput {
  project_id: number;
  type: 'daily' | 'monthly' | 'manual';
  file_path: string;
}

export const backupsRepo = {
  findById(id: number): Backup | undefined {
    return getDb().prepare('SELECT * FROM backups WHERE id = ?').get(id) as Backup | undefined;
  },

  findByIdWithProject(id: number): BackupWithProject | undefined {
    return getDb()
      .prepare(
        `SELECT b.*, p.name as project_name
         FROM backups b JOIN projects p ON p.id = b.project_id
         WHERE b.id = ?`,
      )
      .get(id) as BackupWithProject | undefined;
  },

  findByProject(projectId: number, limit = 50): Backup[] {
    return getDb()
      .prepare('SELECT * FROM backups WHERE project_id = ? ORDER BY started_at DESC LIMIT ?')
      .all(projectId, limit) as Backup[];
  },

  findRecent(limit = 20): BackupWithProject[] {
    return getDb()
      .prepare(
        `SELECT b.*, p.name as project_name
         FROM backups b JOIN projects p ON p.id = b.project_id
         ORDER BY b.started_at DESC LIMIT ?`,
      )
      .all(limit) as BackupWithProject[];
  },

  findDailyOlderThan(projectId: number, date: string): Backup[] {
    return getDb()
      .prepare(
        `SELECT * FROM backups
         WHERE project_id = ? AND type = 'daily' AND started_at < ?
         ORDER BY started_at ASC`,
      )
      .all(projectId, date) as Backup[];
  },

  create(input: CreateBackupInput): Backup {
    const db = getDb();
    const result = db
      .prepare('INSERT INTO backups (project_id, type, file_path) VALUES (?, ?, ?)')
      .run(input.project_id, input.type, input.file_path);
    return this.findById(result.lastInsertRowid as number)!;
  },

  updateStatus(
    id: number,
    status: string,
    extra: { size_bytes?: number; error_message?: string; metadata?: string } = {},
  ): void {
    const db = getDb();
    const fields = ["status = ?", "completed_at = datetime('now')"];
    const values: unknown[] = [status];

    if (extra.size_bytes !== undefined) {
      fields.push('size_bytes = ?');
      values.push(extra.size_bytes);
    }
    if (extra.error_message !== undefined) {
      fields.push('error_message = ?');
      values.push(extra.error_message);
    }
    if (extra.metadata !== undefined) {
      fields.push('metadata = ?');
      values.push(extra.metadata);
    }

    values.push(id);
    db.prepare(`UPDATE backups SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  },

  delete(id: number): boolean {
    const result = getDb().prepare('DELETE FROM backups WHERE id = ?').run(id);
    return result.changes > 0;
  },

  getTotalSize(): number {
    const row = getDb()
      .prepare("SELECT COALESCE(SUM(size_bytes), 0) as total FROM backups WHERE status = 'success' OR status = 'partial'")
      .get() as { total: number };
    return row.total;
  },

  getCount(): number {
    const row = getDb()
      .prepare('SELECT COUNT(*) as count FROM backups')
      .get() as { count: number };
    return row.count;
  },

  getFailedCount(sinceDays = 7): number {
    const row = getDb()
      .prepare(
        `SELECT COUNT(*) as count FROM backups
         WHERE status = 'failed' AND started_at > datetime('now', ?)`,
      )
      .get(`-${sinceDays} days`) as { count: number };
    return row.count;
  },
};
