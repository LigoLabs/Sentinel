import { getDb } from '../connection.js';
import { encryptJson, decryptJson } from '../../crypto/encryption.js';

export interface DataSource {
  id: number;
  project_id: number;
  type: string;
  label: string;
  config_encrypted: string;
  created_at: string;
}

export interface DataSourceWithConfig extends Omit<DataSource, 'config_encrypted'> {
  config: Record<string, unknown>;
}

export interface CreateSourceInput {
  project_id: number;
  type: string;
  label: string;
  config: Record<string, unknown>;
}

export interface UpdateSourceInput {
  type?: string;
  label?: string;
  config?: Record<string, unknown>;
}

function toPublic(source: DataSource): DataSourceWithConfig {
  return {
    id: source.id,
    project_id: source.project_id,
    type: source.type,
    label: source.label,
    created_at: source.created_at,
    config: decryptJson(source.config_encrypted),
  };
}

function toSafe(source: DataSource): Omit<DataSource, 'config_encrypted'> & { hasConfig: boolean } {
  return {
    id: source.id,
    project_id: source.project_id,
    type: source.type,
    label: source.label,
    created_at: source.created_at,
    hasConfig: !!source.config_encrypted,
  };
}

export const sourcesRepo = {
  findByProject(projectId: number) {
    const rows = getDb()
      .prepare('SELECT * FROM data_sources WHERE project_id = ? ORDER BY label')
      .all(projectId) as DataSource[];
    return rows.map(toSafe);
  },

  findById(id: number): DataSource | undefined {
    return getDb().prepare('SELECT * FROM data_sources WHERE id = ?').get(id) as
      | DataSource
      | undefined;
  },

  findByIdDecrypted(id: number): DataSourceWithConfig | undefined {
    const row = this.findById(id);
    return row ? toPublic(row) : undefined;
  },

  findByProjectDecrypted(projectId: number): DataSourceWithConfig[] {
    const rows = getDb()
      .prepare('SELECT * FROM data_sources WHERE project_id = ? ORDER BY label')
      .all(projectId) as DataSource[];
    return rows.map(toPublic);
  },

  create(input: CreateSourceInput): ReturnType<typeof toSafe> {
    const db = getDb();
    const encrypted = encryptJson(input.config);
    const result = db
      .prepare(
        'INSERT INTO data_sources (project_id, type, label, config_encrypted) VALUES (?, ?, ?, ?)',
      )
      .run(input.project_id, input.type, input.label, encrypted);
    const row = this.findById(result.lastInsertRowid as number)!;
    return toSafe(row);
  },

  update(id: number, input: UpdateSourceInput): ReturnType<typeof toSafe> | undefined {
    const db = getDb();
    const existing = this.findById(id);
    if (!existing) return undefined;

    const fields: string[] = [];
    const values: unknown[] = [];

    if (input.type !== undefined) {
      fields.push('type = ?');
      values.push(input.type);
    }
    if (input.label !== undefined) {
      fields.push('label = ?');
      values.push(input.label);
    }
    if (input.config !== undefined) {
      fields.push('config_encrypted = ?');
      values.push(encryptJson(input.config));
    }

    if (fields.length === 0) return toSafe(existing);

    values.push(id);
    db.prepare(`UPDATE data_sources SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return toSafe(this.findById(id)!);
  },

  delete(id: number): boolean {
    const result = getDb().prepare('DELETE FROM data_sources WHERE id = ?').run(id);
    return result.changes > 0;
  },
};
