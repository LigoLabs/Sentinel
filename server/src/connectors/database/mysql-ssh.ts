import { Client } from 'ssh2';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseConnector, DumpResult } from './types.js';

interface MysqlSshConfig {
  sshHost: string;
  sshPort: number;
  sshUser: string;
  sshPassword?: string;
  sshPrivateKey?: string;
  mysqlHost: string;
  mysqlPort: number;
  mysqlUser: string;
  mysqlPassword: string;
  mysqlDatabase: string;
}

function parseConfig(config: Record<string, unknown>): MysqlSshConfig {
  const sshHost = config.sshHost as string;
  const sshUser = config.sshUser as string;
  const mysqlDatabase = config.mysqlDatabase as string;
  if (!sshHost || !sshUser || !mysqlDatabase) {
    throw new Error('mysql-ssh requires sshHost, sshUser, and mysqlDatabase');
  }
  return {
    sshHost,
    sshPort: Number(config.sshPort) || 22,
    sshUser,
    sshPassword: (config.sshPassword as string) || undefined,
    sshPrivateKey: (config.sshPrivateKey as string) || undefined,
    mysqlHost: (config.mysqlHost as string) || '127.0.0.1',
    mysqlPort: Number(config.mysqlPort) || 3306,
    mysqlUser: (config.mysqlUser as string) || 'root',
    mysqlPassword: (config.mysqlPassword as string) || '',
    mysqlDatabase,
  };
}

function sshConnect(cfg: MysqlSshConfig): Promise<Client> {
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
      let stdout = '';
      let stderr = '';
      const chunks: Buffer[] = [];
      stream.on('data', (data: Buffer) => {
        chunks.push(data);
      });
      stream.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });
      stream.on('close', (code: number) => {
        stdout = Buffer.concat(chunks).toString('utf8');
        resolve({ stdout, stderr, code });
      });
    });
  });
}

export class MysqlSshConnector implements DatabaseConnector {
  readonly type = 'mysql-ssh';

  async testConnection(config: Record<string, unknown>): Promise<boolean> {
    const cfg = parseConfig(config);
    const conn = await sshConnect(cfg);
    try {
      const pw = cfg.mysqlPassword ? `-p'${cfg.mysqlPassword.replace(/'/g, "'\\''")}'` : '';
      const cmd = `mysql -h ${cfg.mysqlHost} -P ${cfg.mysqlPort} -u ${cfg.mysqlUser} ${pw} -e "SELECT 1" ${cfg.mysqlDatabase} 2>&1`;
      const { code, stdout, stderr } = await sshExec(conn, cmd);
      if (code !== 0) {
        const detail = (stderr || stdout).trim().slice(0, 200);
        throw new Error(`MySQL returned exit code ${code}${detail ? ': ' + detail : ''}`);
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

      const pw = cfg.mysqlPassword ? `-p'${cfg.mysqlPassword.replace(/'/g, "'\\''")}'` : '';
      const baseArgs = `-h ${cfg.mysqlHost} -P ${cfg.mysqlPort} -u ${cfg.mysqlUser} ${pw}`;

      // Get table list
      const tablesCmd = `mysql ${baseArgs} -N -e "SHOW TABLES" ${cfg.mysqlDatabase} 2>&1`;
      const tablesResult = await sshExec(conn, tablesCmd);
      if (tablesResult.code !== 0) {
        throw new Error(`Failed to list tables: ${tablesResult.stderr || tablesResult.stdout}`);
      }
      const tableNames = tablesResult.stdout.trim().split('\n').filter(Boolean);
      logs.push(`Found ${tableNames.length} tables: ${tableNames.join(', ')}`);

      // Get row counts
      const tables: DumpResult['tables'] = [];
      for (const name of tableNames) {
        const countCmd = `mysql ${baseArgs} -N -e "SELECT COUNT(*) FROM \\\`${name}\\\`" ${cfg.mysqlDatabase} 2>&1`;
        const countResult = await sshExec(conn, countCmd);
        const rowCount = parseInt(countResult.stdout.trim(), 10) || 0;
        tables.push({ name, rowCount });
        logs.push(`  ${name}: ${rowCount} rows`);
      }

      // Full mysqldump
      const dumpCmd = `mysqldump ${baseArgs} --single-transaction --routines --triggers --add-drop-table ${cfg.mysqlDatabase} 2>&1`;
      logs.push('Running mysqldump...');
      const dumpResult = await sshExec(conn, dumpCmd);
      if (dumpResult.code !== 0) {
        throw new Error(`mysqldump failed: ${dumpResult.stderr || dumpResult.stdout.slice(0, 500)}`);
      }

      const dumpPath = join(outputDir, `${cfg.mysqlDatabase}.sql`);
      writeFileSync(dumpPath, dumpResult.stdout, 'utf8');
      const sizeBytes = Buffer.byteLength(dumpResult.stdout, 'utf8');
      logs.push(`Dump written: ${dumpPath} (${sizeBytes} bytes)`);

      return { tables, sizeBytes, logs };
    } finally {
      conn.end();
    }
  }

  async restore(config: Record<string, unknown>, inputDir: string): Promise<void> {
    const { readFileSync } = await import('node:fs');
    const cfg = parseConfig(config);
    const conn = await sshConnect(cfg);

    try {
      const dumpPath = join(inputDir, `${cfg.mysqlDatabase}.sql`);
      const sql = readFileSync(dumpPath, 'utf8');

      const pw = cfg.mysqlPassword ? `-p'${cfg.mysqlPassword.replace(/'/g, "'\\''")}'` : '';
      const cmd = `mysql -h ${cfg.mysqlHost} -P ${cfg.mysqlPort} -u ${cfg.mysqlUser} ${pw} ${cfg.mysqlDatabase}`;

      await new Promise<void>((resolve, reject) => {
        conn.exec(cmd, (err, stream) => {
          if (err) return reject(err);
          stream.on('close', (code: number) => {
            if (code !== 0) reject(new Error(`mysql restore exited with code ${code}`));
            else resolve();
          });
          stream.stderr.on('data', (data: Buffer) => {
            const msg = data.toString();
            if (msg.toLowerCase().includes('error')) reject(new Error(msg));
          });
          stream.end(sql);
        });
      });
    } finally {
      conn.end();
    }
  }
}
