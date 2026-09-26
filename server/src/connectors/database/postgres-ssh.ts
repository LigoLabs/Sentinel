import { Client } from 'ssh2';
import { mkdirSync, createReadStream, createWriteStream, rmSync } from 'node:fs';
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

// Streams stdout straight to disk: dumps can exceed V8's max string length (~512 MB),
// so they must never be buffered into a single string.
function sshExecToFile(conn: Client, command: string, filePath: string): Promise<{ code: number; stderr: string; sizeBytes: number }> {
  return new Promise((resolve, reject) => {
    conn.exec(command, (err, stream) => {
      if (err) return reject(err);
      const out = createWriteStream(filePath);
      let stderr = '';
      let code: number | null = null;
      let closed = false;
      let flushed = false;
      const settle = () => {
        if (closed && flushed) resolve({ code: code ?? -1, stderr, sizeBytes: out.bytesWritten });
      };
      stream.stderr.on('data', (data: Buffer) => {
        if (stderr.length < 10_000) stderr += data.toString();
      });
      stream.on('close', (exitCode: number | null) => {
        code = exitCode;
        closed = true;
        if (!out.writableEnded) out.end();
        settle();
      });
      out.on('finish', () => {
        flushed = true;
        settle();
      });
      out.on('error', (e) => {
        stream.destroy();
        reject(e);
      });
      stream.pipe(out);
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

      // No 2>&1 here: stdout is the dump file itself, stderr must stay out of it.
      const dumpCmd = `${envPrefix(cfg)}pg_dump ${baseArgs} --no-owner --no-privileges --clean --if-exists`;
      const dumpPath = join(outputDir, `${cfg.pgDatabase}.sql`);
      logs.push('Running pg_dump...');
      const dumpResult = await sshExecToFile(conn, dumpCmd, dumpPath);
      if (dumpResult.code !== 0) {
        rmSync(dumpPath, { force: true });
        throw new Error(`pg_dump failed (exit ${dumpResult.code}): ${dumpResult.stderr.slice(0, 500)}`);
      }

      const { sizeBytes } = dumpResult;
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
          createReadStream(dumpPath).on('error', reject).pipe(stream);
        });
      });
    } finally {
      conn.end();
    }
  }
}
