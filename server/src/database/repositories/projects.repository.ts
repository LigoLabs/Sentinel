import { getDb } from '../connection.js';

export interface Project {
  id: number;
  name: string;
  description: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  is_active?: boolean;
}

export const projectsRepo = {
  findAll(): Project[] {
    return getDb().prepare('SELECT * FROM projects ORDER BY name').all() as Project[];
  },

  findById(id: number): Project | undefined {
    return getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id) as Project | undefined;
  },

  findByName(name: string): Project | undefined {
    return getDb().prepare('SELECT * FROM projects WHERE name = ?').get(name) as
      | Project
      | undefined;
  },

  create(input: CreateProjectInput): Project {
    const db = getDb();
    const result = db
      .prepare('INSERT INTO projects (name, description) VALUES (?, ?)')
      .run(input.name, input.description || '');
    return this.findById(result.lastInsertRowid as number)!;
  },

  update(id: number, input: UpdateProjectInput): Project | undefined {
    const db = getDb();
    const project = this.findById(id);
    if (!project) return undefined;

    const fields: string[] = [];
    const values: unknown[] = [];

    if (input.name !== undefined) {
      fields.push('name = ?');
      values.push(input.name);
    }
    if (input.description !== undefined) {
      fields.push('description = ?');
      values.push(input.description);
    }
    if (input.is_active !== undefined) {
      fields.push('is_active = ?');
      values.push(input.is_active ? 1 : 0);
    }

    if (fields.length === 0) return project;

    fields.push("updated_at = datetime('now')");
    values.push(id);

    db.prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.findById(id);
  },

  delete(id: number): boolean {
    const result = getDb().prepare('DELETE FROM projects WHERE id = ?').run(id);
    return result.changes > 0;
  },
};
