import { Client as FtpClient, type FileInfo } from 'basic-ftp';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { StorageConnector, DownloadResult, DownloadProgress } from './types.js';

interface FtpConfig {
  ftpHost: string;
  ftpPort: number;
  ftpUser: string;
  ftpPassword: string;
  ftpSecure: boolean;
  remotePath: string;
}

interface RemoteFile {
  remoteFull: string;
  relative: string;
  size: number;
}

function parseConfig(config: Record<string, unknown>): FtpConfig {
  const ftpHost = config.ftpHost as string;
  const ftpUser = config.ftpUser as string;
  const remotePath = config.remotePath as string;
  if (!ftpHost || !ftpUser || !remotePath) {
    throw new Error('ftp requires ftpHost, ftpUser, and remotePath');
  }
  return {
    ftpHost,
    ftpPort: Number(config.ftpPort) || 21,
    ftpUser,
    ftpPassword: (config.ftpPassword as string) || '',
    ftpSecure: config.ftpSecure === true,
    remotePath: remotePath.replace(/\/+$/, '') || '/',
  };
}

async function connectFtp(cfg: FtpConfig): Promise<FtpClient> {
  const client = new FtpClient(30_000);
  client.ftp.verbose = false;
  try {
    await client.access({
      host: cfg.ftpHost,
      port: cfg.ftpPort,
      user: cfg.ftpUser,
      password: cfg.ftpPassword,
      secure: cfg.ftpSecure,
      secureOptions: cfg.ftpSecure ? { rejectUnauthorized: false } : undefined,
    });
  } catch (err) {
    client.close();
    throw err;
  }
  return client;
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

async function listRecursive(
  client: FtpClient,
  remotePath: string,
  basePath: string,
  acc: RemoteFile[],
  onUpdate?: (files: number, dirs: number) => void,
  counter?: { files: number; dirs: number },
): Promise<void> {
  let items: FileInfo[];
  try {
    items = await client.list(remotePath);
  } catch {
    return;
  }
  if (counter) {
    counter.dirs++;
    onUpdate?.(counter.files, counter.dirs);
  }

  for (const item of items) {
    if (item.name === '.' || item.name === '..') continue;
    const fullPath = `${remotePath}/${item.name}`;
    const relative = fullPath.startsWith(basePath + '/')
      ? fullPath.slice(basePath.length + 1)
      : item.name;
    if (item.isDirectory) {
      await listRecursive(client, fullPath, basePath, acc, onUpdate, counter);
    } else if (item.isFile) {
      acc.push({ remoteFull: fullPath, relative, size: item.size });
      if (counter) {
        counter.files++;
        onUpdate?.(counter.files, counter.dirs);
      }
    }
  }
}

export class FtpConnector implements StorageConnector {
  readonly type = 'ftp';

  async testConnection(config: Record<string, unknown>): Promise<boolean> {
    const cfg = parseConfig(config);
    const client = await connectFtp(cfg);
    try {
      // Verify remotePath exists and is reachable
      await client.list(cfg.remotePath);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Chemin distant inaccessible : ${cfg.remotePath} (${msg})`);
    } finally {
      client.close();
    }
  }

  async download(
    config: Record<string, unknown>,
    outputDir: string,
    onProgress?: (p: DownloadProgress) => void,
  ): Promise<DownloadResult> {
    const cfg = parseConfig(config);
    const logs: string[] = [];
    const assetsDir = join(outputDir, 'assets');
    mkdirSync(assetsDir, { recursive: true });

    onProgress?.({ totalFiles: -1, downloadedFiles: 0, currentFile: 'Connexion FTP…', downloadedBytes: 0 });

    const client = await connectFtp(cfg);
    const remoteFiles: RemoteFile[] = [];

    try {
      onProgress?.({ totalFiles: -1, downloadedFiles: 0, currentFile: 'Listing récursif via FTP…', downloadedBytes: 0 });
      const counter = { files: 0, dirs: 0 };
      await listRecursive(client, cfg.remotePath, cfg.remotePath, remoteFiles, (files, dirs) => {
        onProgress?.({
          totalFiles: -1,
          downloadedFiles: files,
          currentFile: `Scan FTP… ${dirs} dossier${dirs > 1 ? 's' : ''}${files > 0 ? `, ${files} fichier${files > 1 ? 's' : ''}` : ''}`,
          downloadedBytes: 0,
        });
      }, counter);

      logs.push(`FTP listing: ${remoteFiles.length} fichiers, ${counter.dirs} dossiers`);

      if (remoteFiles.length === 0) {
        logs.push('Aucun fichier à télécharger');
        return { files: [], totalSizeBytes: 0, logs };
      }

      const totalBytes = remoteFiles.reduce((sum, f) => sum + f.size, 0);
      logs.push(`Téléchargement de ${remoteFiles.length} fichiers (${fmtBytes(totalBytes)})…`);

      const files: { name: string; sizeBytes: number }[] = [];
      const failed: string[] = [];
      let downloadedCount = 0;
      let downloadedBytes = 0;

      for (const file of remoteFiles) {
        const localPath = join(assetsDir, file.relative.replace(/\.\./g, '_'));
        mkdirSync(dirname(localPath), { recursive: true });

        onProgress?.({
          totalFiles: remoteFiles.length,
          downloadedFiles: downloadedCount,
          currentFile: file.relative,
          downloadedBytes,
        });

        try {
          await client.downloadTo(localPath, file.remoteFull);
          files.push({ name: file.relative, sizeBytes: file.size });
          downloadedBytes += file.size;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          failed.push(`${file.relative}: ${msg}`);
        }

        downloadedCount++;
        onProgress?.({
          totalFiles: remoteFiles.length,
          downloadedFiles: downloadedCount,
          currentFile: file.relative,
          downloadedBytes,
        });
      }

      for (const f of failed) logs.push(`FAILED: ${f}`);
      logs.push(`Téléchargé ${files.length}/${remoteFiles.length} fichiers (${fmtBytes(downloadedBytes)})`);

      return { files, totalSizeBytes: downloadedBytes, logs };
    } finally {
      client.close();
    }
  }

  async restore(_config: Record<string, unknown>, _inputDir: string): Promise<void> {
    throw new Error('FTP restore non implémenté.');
  }
}
