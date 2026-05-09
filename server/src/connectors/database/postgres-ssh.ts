import { Client } from 'ssh2';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseConnector, DumpResult } from './types.js';

interface PostgresSshConfig {
  sshHost: string;
  sshPort: number;
  sshUser: string;
  sshPassword?: string;
  sshPrivateKey?: string;
  pgHost: string;
  pgPort: number;
  pgUser: string;
  pgPassword: string;
  pgDatabase: string;
}

function parseConfig(config: Record<string, unknown>): PostgresSshConfig {
  const sshHost = config.sshHost as string;
  const sshUser = config.sshUser as string;
  const pgDatabase = config.pgDatabase as string;
  if (!sshHost || !sshUser || !pgDatabase) {
    throw new Error('postgres-ssh requires sshHost, sshUser, and pgDatabase');
  }
  return {
    sshHost,
    sshPort: Number(config.sshPort) || 22,
    sshUser,
    sshPassword: (config.sshPassword as string) || undefined,
    sshPrivateKey: (config.sshPrivateKey as string) || undefined,
    pgHost: (config.pgHost as string) || '127.0.0.1',
    pgPort: Number(config.pgPort) || 5432,
    pgUser: (config.pgUser as string) || 'postgres',
    pgPassword: (config.pgPassword as string) || '',
    pgDatabase,
  };
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function envPrefix(cfg: PostgresSshConfig): string {
  return cfg.pgPassword ? `PGPASSWORD=${shellEscape(cfg.pgPassword)} ` : '';
}

function sshConnect(cfg: PostgresSshConfig): Promise<Client> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => resolve(conn));
    conn.on('error', reject);
    conn.connect({
      host: cfg.sshHost,
      port: cfg.sshPort,
      username: cfg.sshUser,
      password: cfg.sshPassword,
      privateKey: cfg.sshPrivateKey,
    });
  });
}

function sshExec(conn: Client, command: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    conn.exec(command, (err, stream) => {
      if (err) return reject(err);
      let stderr = '';
      const chunks: Buffer[] = [];
      stream.on('data', (data: Buffer) => {
        chunks.push(data);
      });
      stream.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });
      stream.on('close', (code: number) => {
        const stdout = Buffer.concat(chunks).toString('utf8');
        resolve({ stdout, stderr, code });
      });
    });
  });
}

export class PostgresSshConnector implements DatabaseConnector {
  readonly type = 'postgres-ssh';

  async testConnection(config: Record<string, unknown>): Promise<boolean> {
    const cfg = parseConfig(config);
    const conn = await sshConnect(cfg);
    try {
      const baseArgs = `-h ${cfg.pgHost} -p ${cfg.pgPort} -U ${cfg.pgUser} -d ${cfg.pgDatabase} -w`;
      const cmd = `${envPrefix(cfg)}psql ${baseArgs} -tA -c "SELECT 1" 2>&1`;
      const { code, stdout, stderr } = await sshExec(conn, cmd);
      if (code !== 0) {
        const detail = (stderr || stdout).trim().slice(0, 200);
        throw new Error(`psql returned exit code ${code}${detail ? ': ' + detail : ''}`);
      }
      return true;
    } finally {
      conn.end();
    }
  }

  async dump(config: Record<string, unknown>, outputDir: string): Promise<DumpResult> {
    const cfg = parseConfig(config);
    const conn = await sshConnect(cfg);
    const logs: string[] = [];

    try {
      mkdirSync(outputDir, { recursive: true });

      const baseArgs = `-h ${cfg.pgHost} -p ${cfg.pgPort} -U ${cfg.pgUser} -d ${cfg.pgDatabase} -w`;

      const tablesCmd = `${envPrefix(cfg)}psql ${baseArgs} -tA -c "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename" 2>&1`;
      const tablesResult = await sshExec(conn, tablesCmd);
      if (tablesResult.code !== 0) {
        throw new Error(`Failed to list tables: ${tablesResult.stderr || tablesResult.stdout}`);
      }
      const tableNames = tablesResult.stdout.trim().split('\n').filter(Boolean);
      logs.push(`Found ${tableNames.length} tables: ${tableNames.join(', ')}`);

      const tables: DumpResult['tables'] = [];
      for (const name of tableNames) {
        const safeName = name.replace(/"/g, '""');
        const countCmd = `${envPrefix(cfg)}psql ${baseArgs} -tA -c 'SELECT COUNT(*) FROM "${safeName}"' 2>&1`;
        const countResult = await sshExec(conn, countCmd);
        const rowCount = parseInt(countResult.stdout.trim(), 10) || 0;
        tables.push({ name, rowCount });
        logs.push(`  ${name}: ${rowCount} rows`);
      }

      const dumpCmd = `${envPrefix(cfg)}pg_dump ${baseArgs} --no-owner --no-privileges --clean --if-exists 2>&1`;
      logs.push('Running pg_dump...');
      const dumpResult = await sshExec(conn, dumpCmd);
      if (dumpResult.code !== 0) {
        throw new Error(`pg_dump failed: ${dumpResult.stderr || dumpResult.stdout.slice(0, 500)}`);
      }

      const dumpPath = join(outputDir, `${cfg.pgDatabase}.sql`);
      writeFileSync(dumpPath, dumpResult.stdout, 'utf8');
      const sizeBytes = Buffer.byteLength(dumpResult.stdout, 'utf8');
      logs.push(`Dump written: ${dumpPath} (${sizeBytes} bytes)`);

      return { tables, sizeBytes, logs };
    } finally {
      conn.end();
    }
  }

  async restore(config: Record<string, unknown>, inputDir: string): Promise<void> {
    const cfg = parseConfig(config);
    const conn = await sshConnect(cfg);

    try {
      const dumpPath = join(inputDir, `${cfg.pgDatabase}.sql`);
      const sql = readFileSync(dumpPath, 'utf8');

      const cmd = `${envPrefix(cfg)}psql -h ${cfg.pgHost} -p ${cfg.pgPort} -U ${cfg.pgUser} -d ${cfg.pgDatabase} -w -v ON_ERROR_STOP=1`;

      await new Promise<void>((resolve, reject) => {
        conn.exec(cmd, (err, stream) => {
          if (err) return reject(err);
          let stderr = '';
          stream.on('close', (code: number) => {
            if (code !== 0) reject(new Error(`psql restore exited with code ${code}: ${stderr.slice(0, 500)}`));
            else resolve();
          });
          stream.stderr.on('data', (data: Buffer) => {
            stderr += data.toString();
          });
          stream.end(sql);
        });
      });
    } finally {
      conn.end();
    }
  }
}
