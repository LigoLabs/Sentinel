import { Client } from 'ssh2';
import SftpClient from 'ssh2-sftp-client';
import { mkdirSync, createWriteStream, unlinkSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { StorageConnector, DownloadResult, DownloadProgress } from './types.js';

const SFTP_CONCURRENCY = 5;

interface SshSftpConfig {
  sshHost: string;
  sshPort: number;
  sshUser: string;
  sshPassword?: string;
  sshPrivateKey?: string;
  remotePath: string;
  useSudo: boolean;
}

interface RemoteFile {
  remoteFull: string;
  relative: string;
  size: number;
}

function parseConfig(config: Record<string, unknown>): SshSftpConfig {
  const sshHost = config.sshHost as string;
  const sshUser = config.sshUser as string;
  const remotePath = config.remotePath as string;
  if (!sshHost || !sshUser || !remotePath) {
    throw new Error('ssh-sftp requires sshHost, sshUser, and remotePath');
  }
  return {
    sshHost,
    sshPort: Number(config.sshPort) || 22,
    sshUser,
    sshPassword: (config.sshPassword as string) || undefined,
    sshPrivateKey: (config.sshPrivateKey as string) || undefined,
    remotePath: remotePath.replace(/\/+$/, ''),
    useSudo: config.useSudo === true,
  };
}

function sshConnect(cfg: SshSftpConfig): Promise<Client> {
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

function sshExec(conn: Client, cmd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let stdout = '';
      let stderr = '';
      stream.on('data', (data: Buffer) => { stdout += data.toString(); });
      stream.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
      stream.on('close', (code: number) => resolve({ code, stdout, stderr }));
    });
  });
}

function connectSftp(cfg: SshSftpConfig): Promise<SftpClient> {
  const sftp = new SftpClient();
  return sftp.connect({
    host: cfg.sshHost,
    port: cfg.sshPort,
    username: cfg.sshUser,
    password: cfg.sshPassword,
    privateKey: cfg.sshPrivateKey,
  }).then(() => sftp);
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// ── Strategy 1: create tar on remote server, download via SFTP, then delete ──

async function downloadViaSudoTar(
  cfg: SshSftpConfig,
  assetsDir: string,
  onProgress?: (p: DownloadProgress) => void,
): Promise<{ success: boolean; sizeBytes: number }> {
  const sudo = cfg.useSudo ? 'sudo ' : '';
  const escaped = cfg.remotePath.replace(/'/g, "'\\''");
  const remoteTar = `/tmp/sentinel_assets_${Date.now()}.tar.gz`;

  let conn: Client;
  try { conn = await sshConnect(cfg); } catch { return { success: false, sizeBytes: 0 }; }

  try {
    // Step 1: create tar.gz on remote server
    onProgress?.({ totalFiles: -1, downloadedFiles: 0, currentFile: 'Création du tar.gz sur le serveur...', downloadedBytes: 0 });

    const { code, stderr } = await sshExec(conn, `${sudo}tar czf '${remoteTar}' -C '${escaped}' . 2>&1`);
    conn.end();

    if (code !== 0) {
      // Cleanup attempt
      try { const c2 = await sshConnect(cfg); await sshExec(c2, `${sudo}rm -f '${remoteTar}'`); c2.end(); } catch { /* ignore */ }
      throw new Error(`tar failed (code ${code}): ${stderr.trim().slice(0, 200)}`);
    }

    // Step 2: download the tar.gz via SFTP
    onProgress?.({ totalFiles: -1, downloadedFiles: 0, currentFile: 'Téléchargement du tar.gz...', downloadedBytes: 0 });

    // If sudo was used, the file is owned by root — chmod it so our SFTP user can read it
    if (cfg.useSudo) {
      const chConn = await sshConnect(cfg);
      await sshExec(chConn, `sudo chmod 644 '${remoteTar}'`);
      chConn.end();
    }

    mkdirSync(assetsDir, { recursive: true });
    const localTarPath = join(assetsDir, 'assets.tar.gz');

    const sftp = await connectSftp(cfg);
    try {
      // Get remote file size for progress
      const remoteStat = await sftp.stat(remoteTar);
      const remoteSize = remoteStat.size;

      // Use fastGet with step callback for progress
      await new Promise<void>((resolve, reject) => {
        sftp.fastGet(remoteTar, localTarPath, {
          step: (transferred: number) => {
            onProgress?.({
              totalFiles: -1,
              downloadedFiles: 0,
              currentFile: `Téléchargement... ${fmtBytes(transferred)} / ${fmtBytes(remoteSize)}`,
              downloadedBytes: transferred,
            });
          },
        }).then(() => resolve()).catch(reject);
      });
    } finally {
      await sftp.end();
    }

    // Step 3: delete the tar.gz from remote server
    const cleanConn = await sshConnect(cfg);
    await sshExec(cleanConn, `${sudo}rm -f '${remoteTar}'`);
    cleanConn.end();

    const localSize = statSync(localTarPath).size;
    return { success: true, sizeBytes: localSize };
  } catch (err) {
    // Cleanup: try to remove remote tar
    try { const c = await sshConnect(cfg); await sshExec(c, `${cfg.useSudo ? 'sudo ' : ''}rm -f '${remoteTar}'`); c.end(); } catch { /* ignore */ }
    try { unlinkSync(join(assetsDir, 'assets.tar.gz')); } catch { /* ignore */ }
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, sizeBytes: 0 };
  }
}

// ── Strategy 2: direct tar stream (no sudo, direct pipe) ──

async function downloadViaTarStream(
  cfg: SshSftpConfig,
  assetsDir: string,
  onProgress?: (p: DownloadProgress) => void,
): Promise<{ success: boolean; sizeBytes: number }> {
  let conn: Client;
  try { conn = await sshConnect(cfg); } catch { return { success: false, sizeBytes: 0 }; }

  const tarPath = join(assetsDir, 'assets.tar.gz');
  mkdirSync(assetsDir, { recursive: true });

  try {
    const escaped = cfg.remotePath.replace(/'/g, "'\\''");
    const bytesReceived = await new Promise<number>((resolve) => {
      conn.exec(`tar czf - -C '${escaped}' . 2>/dev/null`, (err, stream) => {
        if (err) { resolve(0); return; }
        const ws = createWriteStream(tarPath);
        let bytes = 0;

        stream.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          ws.write(chunk);
          onProgress?.({ totalFiles: -1, downloadedFiles: 0, currentFile: `Transfert tar... ${fmtBytes(bytes)} reçus`, downloadedBytes: bytes });
        });
        stream.on('close', (code: number) => { ws.end(() => resolve(code === 0 && bytes > 0 ? bytes : 0)); });
        stream.on('error', () => { ws.end(); resolve(0); });
      });
    });
    conn.end();

    if (bytesReceived === 0) {
      try { unlinkSync(tarPath); } catch { /* ignore */ }
      return { success: false, sizeBytes: 0 };
    }
    return { success: true, sizeBytes: bytesReceived };
  } catch {
    conn.end();
    try { unlinkSync(tarPath); } catch { /* ignore */ }
    return { success: false, sizeBytes: 0 };
  }
}

// ── Fallback: SSH find for listing ──

async function listViaFind(cfg: SshSftpConfig): Promise<RemoteFile[] | null> {
  let conn: Client;
  try { conn = await sshConnect(cfg); } catch { return null; }
  try {
    const sudo = cfg.useSudo ? 'sudo ' : '';
    const escaped = cfg.remotePath.replace(/'/g, "'\\''");
    const { stdout } = await sshExec(conn, `${sudo}find '${escaped}' -type f -printf '%s %p\\n' 2>/dev/null`);

    const files: RemoteFile[] = [];
    for (const line of stdout.split('\n')) {
      if (!line.trim()) continue;
      const sp = line.indexOf(' ');
      if (sp === -1) continue;
      const size = parseInt(line.slice(0, sp), 10);
      const fullPath = line.slice(sp + 1);
      if (!fullPath.startsWith(cfg.remotePath)) continue;
      const rel = fullPath.slice(cfg.remotePath.length + 1);
      if (!rel) continue;
      files.push({ remoteFull: fullPath, relative: rel, size: isNaN(size) ? 0 : size });
    }
    return files.length > 0 ? files : null;
  } catch { return null; } finally { conn.end(); }
}

// ── Fallback: SFTP recursive listing ──

interface SftpListProgress { files: number; dirs: number; }

async function listViaSftp(
  sftp: SftpClient, remotePath: string, basePath: string,
  counter: SftpListProgress, onUpdate?: (p: SftpListProgress) => void,
): Promise<RemoteFile[]> {
  const entries: RemoteFile[] = [];
  let items: Awaited<ReturnType<SftpClient['list']>>;
  try { items = await sftp.list(remotePath); } catch { return entries; }

  counter.dirs++;
  onUpdate?.(counter);

  for (const item of items) {
    const fullPath = `${remotePath}/${item.name}`;
    const relativePath = fullPath.slice(basePath.length + 1);
    if (item.type === 'd') {
      const sub = await listViaSftp(sftp, fullPath, basePath, counter, onUpdate);
      entries.push(...sub);
    } else if (item.type === '-') {
      entries.push({ remoteFull: fullPath, relative: relativePath, size: item.size });
      counter.files++;
      onUpdate?.(counter);
    }
  }
  return entries;
}

// ── Concurrent SFTP download ──

async function downloadConcurrent(
  cfg: SshSftpConfig, remoteFiles: RemoteFile[], assetsDir: string,
  onProgress?: (downloaded: number, totalBytes: number, currentFile: string) => void,
): Promise<{ files: { name: string; sizeBytes: number }[]; failed: string[]; totalSize: number }> {
  const files: { name: string; sizeBytes: number }[] = [];
  const failed: string[] = [];
  let totalSize = 0;
  let downloadedCount = 0;
  let nextIndex = 0;

  const poolSize = Math.min(SFTP_CONCURRENCY, remoteFiles.length);
  const pool: SftpClient[] = [];
  for (let i = 0; i < poolSize; i++) {
    try { pool.push(await connectSftp(cfg)); } catch { break; }
  }
  if (pool.length === 0) throw new Error('Impossible d\'ouvrir une connexion SFTP');

  async function worker(sftp: SftpClient) {
    while (nextIndex < remoteFiles.length) {
      const idx = nextIndex++;
      const file = remoteFiles[idx];
      const localPath = join(assetsDir, file.relative.replace(/\.\./g, '_'));
      mkdirSync(dirname(localPath), { recursive: true });
      try {
        await sftp.fastGet(file.remoteFull, localPath);
        files.push({ name: file.relative, sizeBytes: file.size });
        totalSize += file.size;
      } catch (err) {
        failed.push(`${file.relative}: ${err instanceof Error ? err.message : String(err)}`);
      }
      downloadedCount++;
      onProgress?.(downloadedCount, totalSize, file.relative);
    }
  }

  await Promise.all(pool.map((s) => worker(s)));
  for (const s of pool) { try { await s.end(); } catch { /* ignore */ } }
  return { files, failed, totalSize };
}

// ── Connector ──

export class SshSftpConnector implements StorageConnector {
  readonly type = 'ssh-sftp';

  async testConnection(config: Record<string, unknown>): Promise<boolean> {
    const cfg = parseConfig(config);
    const sftp = await connectSftp(cfg);
    try {
      const exists = await sftp.exists(cfg.remotePath);
      if (exists === false) throw new Error(`Chemin distant introuvable : ${cfg.remotePath}`);
      if (exists !== 'd') throw new Error(`${cfg.remotePath} n'est pas un dossier (type: ${exists})`);
      return true;
    } finally {
      await sftp.end();
    }
  }

  async download(config: Record<string, unknown>, outputDir: string, onProgress?: (p: DownloadProgress) => void): Promise<DownloadResult> {
    const cfg = parseConfig(config);
    const logs: string[] = [];
    const assetsDir = join(outputDir, 'assets');
    mkdirSync(assetsDir, { recursive: true });

    // ── Priority: sudo tar → create on server, SFTP download, cleanup ──
    if (cfg.useSudo) {
      onProgress?.({ totalFiles: -1, downloadedFiles: 0, currentFile: 'Création tar.gz (sudo) sur le serveur...', downloadedBytes: 0 });
      logs.push('Using sudo tar strategy...');

      const tar = await downloadViaSudoTar(cfg, assetsDir, onProgress);
      if (tar.success) {
        logs.push(`Sudo tar OK: assets.tar.gz (${fmtBytes(tar.sizeBytes)})`);
        onProgress?.({ totalFiles: 1, downloadedFiles: 1, currentFile: '', downloadedBytes: tar.sizeBytes });
        return { files: [{ name: 'assets.tar.gz', sizeBytes: tar.sizeBytes }], totalSizeBytes: tar.sizeBytes, logs };
      }
      logs.push('Sudo tar failed, trying alternatives...');
    }

    // ── Attempt: direct tar stream (no sudo) ──
    onProgress?.({ totalFiles: -1, downloadedFiles: 0, currentFile: 'Tentative tar direct...', downloadedBytes: 0 });
    logs.push('Trying direct tar stream...');

    const tar = await downloadViaTarStream(cfg, assetsDir, onProgress);
    if (tar.success) {
      logs.push(`Tar stream OK: assets.tar.gz (${fmtBytes(tar.sizeBytes)})`);
      onProgress?.({ totalFiles: 1, downloadedFiles: 1, currentFile: '', downloadedBytes: tar.sizeBytes });
      return { files: [{ name: 'assets.tar.gz', sizeBytes: tar.sizeBytes }], totalSizeBytes: tar.sizeBytes, logs };
    }
    logs.push('Tar stream failed, switching to SFTP...');

    // ── Fallback: list + concurrent SFTP download ──
    onProgress?.({ totalFiles: -1, downloadedFiles: 0, currentFile: 'Listing via SSH find...', downloadedBytes: 0 });
    let remoteFiles = await listViaFind(cfg);

    if (remoteFiles) {
      logs.push(`SSH find: ${remoteFiles.length} files`);
    } else {
      logs.push('SSH find failed, SFTP listing...');
      onProgress?.({ totalFiles: -1, downloadedFiles: 0, currentFile: 'Scan SFTP en cours...', downloadedBytes: 0 });
      const sftpList = await connectSftp(cfg);
      try {
        const counter: SftpListProgress = { files: 0, dirs: 0 };
        remoteFiles = await listViaSftp(sftpList, cfg.remotePath, cfg.remotePath, counter, (p) => {
          onProgress?.({
            totalFiles: -1, downloadedFiles: p.files,
            currentFile: `Scan SFTP... ${p.dirs} dossier${p.dirs > 1 ? 's' : ''}${p.files > 0 ? `, ${p.files} fichier${p.files > 1 ? 's' : ''}` : ''}`,
            downloadedBytes: 0,
          });
        });
      } finally { await sftpList.end(); }
      logs.push(`SFTP listing: ${remoteFiles.length} files`);
    }

    if (remoteFiles.length === 0) {
      logs.push('No files to download');
      return { files: [], totalSizeBytes: 0, logs };
    }

    logs.push(`Downloading ${remoteFiles.length} files via ${SFTP_CONCURRENCY}x parallel SFTP...`);
    onProgress?.({ totalFiles: remoteFiles.length, downloadedFiles: 0, currentFile: 'Connexion SFTP...', downloadedBytes: 0 });

    const result = await downloadConcurrent(cfg, remoteFiles, assetsDir, (downloaded, totalBytes, currentFile) => {
      onProgress?.({ totalFiles: remoteFiles!.length, downloadedFiles: downloaded, currentFile, downloadedBytes: totalBytes });
    });

    for (const f of result.failed) logs.push(`FAILED: ${f}`);
    logs.push(`Downloaded ${result.files.length}/${remoteFiles.length} files (${fmtBytes(result.totalSize)})`);
    return { files: result.files, totalSizeBytes: result.totalSize, logs };
  }

  async restore(_config: Record<string, unknown>, _inputDir: string): Promise<void> {
    throw new Error('SSH/SFTP restore not yet implemented.');
  }
}
