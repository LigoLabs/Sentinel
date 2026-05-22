import { getDb } from '../connection.js';

export interface BackupSchedule {
  id: number;
  project_id: number;
  cron_expression: string;
  retention_count: number;
  retention_monthly: number;
  cron_lifetime: string | null;
  is_active: number;
}

export interface CreateScheduleInput {
  project_id: number;
  cron_expression?: string;
  retention_count?: number;
  retention_monthly?: boolean;
  cron_lifetime?: string | null;
}

export interface UpdateScheduleInput {
  cron_expression?: string;
  retention_count?: number;
  retention_monthly?: boolean;
  cron_lifetime?: string | null;
  is_active?: boolean;
}

export const schedulesRepo = {
  findByProject(projectId: number): BackupSchedule | undefined {
    return getDb()
      .prepare('SELECT * FROM backup_schedules WHERE project_id = ?')
      .get(projectId) as BackupSchedule | undefined;
  },

  findAllActive(): (BackupSchedule & { project_name: string })[] {
    return getDb()
      .prepare(
        `SELECT bs.*, p.name as project_name
         FROM backup_schedules bs
         JOIN projects p ON p.id = bs.project_id
         WHERE bs.is_active = 1 AND p.is_active = 1`,
      )
      .all() as (BackupSchedule & { project_name: string })[];
  },

  create(input: CreateScheduleInput): BackupSchedule {
    const db = getDb();
    const result = db
      .prepare(
        `INSERT INTO backup_schedules (project_id, cron_expression, retention_count, retention_monthly, cron_lifetime)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        input.project_id,
        input.cron_expression || '0 3 * * *',
        input.retention_count ?? 15,
        input.retention_monthly !== false ? 1 : 0,
        input.cron_lifetime || null,
      );
    return db.prepare('SELECT * FROM backup_schedules WHERE id = ?').get(
      result.lastInsertRowid,
    ) as BackupSchedule;
  },

  update(projectId: number, input: UpdateScheduleInput): BackupSchedule | undefined {
    const db = getDb();
    const existing = this.findByProject(projectId);
    if (!existing) return undefined;

    const fields: string[] = [];
    const values: unknown[] = [];

    if (input.cron_expression !== undefined) {
      fields.push('cron_expression = ?');
      values.push(input.cron_expression);
    }
    if (input.retention_count !== undefined) {
      fields.push('retention_count = ?');
      values.push(input.retention_count);
    }
    if (input.retention_monthly !== undefined) {
      fields.push('retention_monthly = ?');
      values.push(input.retention_monthly ? 1 : 0);
    }
    if (input.cron_lifetime !== undefined) {
      const v = (input.cron_lifetime ?? '').trim();
      fields.push('cron_lifetime = ?');
      values.push(v ? v : null);
    }
    if (input.is_active !== undefined) {
      fields.push('is_active = ?');
      values.push(input.is_active ? 1 : 0);
    }

    if (fields.length === 0) return existing;

    values.push(existing.id);
    db.prepare(`UPDATE backup_schedules SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.findByProject(projectId);
  },

  delete(projectId: number): boolean {
    const result = getDb()
      .prepare('DELETE FROM backup_schedules WHERE project_id = ?')
      .run(projectId);
    return result.changes > 0;
  },
};
