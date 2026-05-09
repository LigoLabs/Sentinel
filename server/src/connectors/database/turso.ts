import { createClient, type Client } from '@libsql/client';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseConnector, DumpResult } from './types.js';

interface TursoConfig {
  url: string;
  authToken: string;
}

function parseConfig(config: Record<string, unknown>): TursoConfig {
  const url = config.url as string;
  const authToken = config.authToken as string;
  if (!url || !authToken) {
    throw new Error('Turso connector requires url and authToken');
  }
  return { url, authToken };
}

export class TursoConnector implements DatabaseConnector {
  readonly type = 'turso';

  async testConnection(config: Record<string, unknown>): Promise<boolean> {
    const { url, authToken } = parseConfig(config);
    const client = createClient({ url, authToken });
    try {
      await client.execute('SELECT 1');
      return true;
    } catch {
      return false;
    } finally {
      client.close();
    }
  }

  async dump(config: Record<string, unknown>, outputDir: string): Promise<DumpResult> {
    const { url, authToken } = parseConfig(config);
    const client = createClient({ url, authToken });
    const logs: string[] = [];
    const tables: DumpResult['tables'] = [];

    try {
      mkdirSync(outputDir, { recursive: true });

      const tablesResult = await client.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_litestream_%' AND name NOT LIKE 'libsql_%'",
      );
      const tableNames = tablesResult.rows.map((r) => r.name as string);
      logs.push(`Found ${tableNames.length} tables: ${tableNames.join(', ')}`);

      const allData: Record<string, unknown[]> = {};
      let totalSize = 0;

      for (const tableName of tableNames) {
        const result = await client.execute(`SELECT * FROM "${tableName}"`);
        const rows = result.rows.map((row) => {
          const obj: Record<string, unknown> = {};
          for (const col of result.columns) {
            obj[col] = row[col];
          }
          return obj;
        });

        allData[tableName] = rows;
        tables.push({ name: tableName, rowCount: rows.length });
        logs.push(`  ${tableName}: ${rows.length} rows`);
      }

      const json = JSON.stringify(allData, null, 2);
      totalSize = Buffer.byteLength(json, 'utf8');
      writeFileSync(join(outputDir, 'database.json'), json, 'utf8');
      logs.push(`Total dump size: ${totalSize} bytes`);

      return { tables, sizeBytes: totalSize, logs };
    } finally {
      client.close();
    }
  }

  async restore(config: Record<string, unknown>, inputDir: string): Promise<void> {
    const { readFileSync } = await import('node:fs');
    const { url, authToken } = parseConfig(config);
    const client = createClient({ url, authToken });

    try {
      const json = readFileSync(join(inputDir, 'database.json'), 'utf8');
      const allData: Record<string, Record<string, unknown>[]> = JSON.parse(json);

      for (const [tableName, rows] of Object.entries(allData)) {
        if (rows.length === 0) continue;

        const columns = Object.keys(rows[0]);
        const placeholders = columns.map(() => '?').join(', ');
        const insertSql = `INSERT OR REPLACE INTO "${tableName}" (${columns.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders})`;

        for (const row of rows) {
          const values = columns.map((col) => {
            const v = row[col];
            return v === null || v === undefined ? null : v;
          });
          await client.execute({ sql: insertSql, args: values as any });
        }
      }
    } finally {
      client.close();
    }
  }
}
