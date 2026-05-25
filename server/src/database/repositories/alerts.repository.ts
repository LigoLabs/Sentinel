import { getDb } from '../connection.js';

export interface Alert {
  id: number;
  project_id: number;
  backup_id: number | null;
  type: string;
  message: string;
  is_read: number;
  created_at: string;
}

export interface AlertWithProject extends Alert {
  project_name: string;
}

export const alertsRepo = {
  findRecent(limit = 30): AlertWithProject[] {
    return getDb()
      .prepare(
        `SELECT a.*, p.name as project_name
         FROM alerts a JOIN projects p ON p.id = a.project_id
         ORDER BY a.created_at DESC LIMIT ?`,
      )
      .all(limit) as AlertWithProject[];
  },

  findUnread(): AlertWithProject[] {
    return getDb()
      .prepare(
        `SELECT a.*, p.name as project_name
         FROM alerts a JOIN projects p ON p.id = a.project_id
         WHERE a.is_read = 0
         ORDER BY a.created_at DESC`,
      )
      .all() as AlertWithProject[];
  },

  create(projectId: number, type: string, message: string, backupId?: number): Alert {
    const db = getDb();
    const result = db
      .prepare(
        'INSERT INTO alerts (project_id, backup_id, type, message) VALUES (?, ?, ?, ?)',
      )
      .run(projectId, backupId ?? null, type, message);
    return db.prepare('SELECT * FROM alerts WHERE id = ?').get(result.lastInsertRowid) as Alert;
  },

  markRead(id: number): void {
    getDb().prepare('UPDATE alerts SET is_read = 1 WHERE id = ?').run(id);
  },

  markUnread(id: number): void {
    getDb().prepare('UPDATE alerts SET is_read = 0 WHERE id = ?').run(id);
  },

  markAllRead(): void {
    getDb().prepare('UPDATE alerts SET is_read = 1 WHERE is_read = 0').run();
  },

  delete(id: number): void {
    getDb().prepare('DELETE FROM alerts WHERE id = ?').run(id);
  },

  getUnreadCount(): number {
    const row = getDb()
      .prepare('SELECT COUNT(*) as count FROM alerts WHERE is_read = 0')
      .get() as { count: number };
    return row.count;
  },
};
