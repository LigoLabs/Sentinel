import { mkdirSync, writeFileSync, statSync, readdirSync, rmSync, createWriteStream } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import archiver from 'archiver';
import { config } from '../config.js';
import { projectsRepo } from '../database/repositories/projects.repository.js';
import { sourcesRepo } from '../database/repositories/sources.repository.js';
import { backupsRepo, type Backup } from '../database/repositories/backups.repository.js';
import { alertsRepo } from '../database/repositories/alerts.repository.js';
import { getDatabaseConnector } from '../connectors/database/registry.js';
import { getStorageConnector } from '../connectors/storage/registry.js';
import type { DumpResult } from '../connectors/database/types.js';
import type { DownloadResult } from '../connectors/storage/types.js';
import { applyRetention } from './retention.service.js';
import { schedulesRepo } from '../database/repositories/schedules.repository.js';
import { pingBackupStart, pingBackupSuccess, pingBackupFailure } from '../monitoring/heartbeat.js';
import { sendBackupAlert } from './email.service.js';
import { updateProgress, clearProgress } from './progress.service.js';
import { slugify } from '../utils/slug.js';

const DB_CONNECTOR_TYPES = ['turso', 'sqlite', 'postgres', 'postgres-ssh', 'mysql', 'mysql-ssh', 'wordpress'];

export interface BackupResult {
  backupId: number;
  status: 'success' | 'partial' | 'failed';
  duration: number;
}

function formatTimestamp(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}_${pad(date.getMonth() + 1)}_${pad(date.getDate())}_${pad(date.getHours())}_${pad(date.getMinutes())}`;
}

function zipDirectory(sourceDir: string, zipPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    mkdirSync(dirname(zipPath), { recursive: true });
    const output = createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 6 } });

    output.on('close', () => resolve(archive.pointer()));
    archive.on('error', reject);

    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

export async function runBackup(
  projectId: number,
  type: 'daily' | 'monthly' | 'manual',
  options: { reuseBackupId?: number } = {},
): Promise<BackupResult> {
  const startTime = Date.now();
  const project = projectsRepo.findById(projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);

  const now = new Date();
  const projectSlug = slugify(project.name);
  const projectDir = join(config.BACKUP_DIR, projectSlug, type);

  // Relance « sur place » : on réutilise la même ligne et on écrase le même .zip.
  // Sinon : nouvelle ligne + nouveau fichier horodaté.
  let backup: Backup;
  let zipPath: string;
  let backupName: string;
  if (options.reuseBackupId) {
    const existing = backupsRepo.findById(options.reuseBackupId);
    if (!existing || existing.project_id !== projectId) {
      throw new Error(`Backup ${options.reuseBackupId} not found for project ${projectId}`);
    }
    zipPath = existing.file_path ?? join(projectDir, `bkp_${projectSlug}_${formatTimestamp(now)}.zip`);
    backupName = basename(zipPath).replace(/\.zip$/i, '');
    backupsRepo.resetForRerun(existing.id);
    backup = backupsRepo.findById(existing.id)!;
  } else {
    backupName = `bkp_${projectSlug}_${formatTimestamp(now)}`;
    zipPath = join(projectDir, `${backupName}.zip`);
    backup = backupsRepo.create({ project_id: projectId, type, file_path: zipPath });
  }

  const tmpDir = join(projectDir, `_tmp_${backupName}`);
  mkdirSync(tmpDir, { recursive: true });

  updateProgress(projectId, { phase: 'starting', backupId: backup.id, message: 'Démarrage du backup...' });
  await pingBackupStart();

  const sources = sourcesRepo.findByProjectDecrypted(projectId);
  const allLogs: string[] = [];
  const metadata: Record<string, unknown> = { sources: [] };
  let hasSuccess = false;
  let hasFailure = false;

  const dbSources = sources.filter((s) => DB_CONNECTOR_TYPES.includes(s.type));
  const storageSources = sources.filter((s) => !DB_CONNECTOR_TYPES.includes(s.type));

  for (const source of dbSources) {
    allLogs.push(`\n=== Database: ${source.label} (${source.type}) ===`);
    updateProgress(projectId, {
      phase: 'database',
      sourceLabel: source.label,
      sourceType: source.type,
      message: `Dump de ${source.label}...`,
    });
    try {
      const connector = getDatabaseConnector(source.type);
      const result: DumpResult = await connector.dump(source.config, tmpDir, (p) => {
        // Map DumpProgress phases to BackupProgress so the existing UI handles them.
        const mappedPhase: 'database' | 'storage' = p.phase === 'dumping' ? 'database' : 'storage';
        updateProgress(projectId, {
          phase: mappedPhase,
          sourceLabel: source.label,
          sourceType: source.type,
          message: p.message,
          totalFiles: p.totalFiles,
          downloadedFiles: p.downloadedFiles,
          currentFile: p.currentFile,
          downloadedBytes: p.downloadedBytes,
        });
      });
      allLogs.push(...result.logs);
      (metadata.sources as unknown[]).push({
        id: source.id,
        label: source.label,
        type: source.type,
        status: 'success',
        tables: result.tables,
        sizeBytes: result.sizeBytes,
        files: result.files,
      });
      hasSuccess = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      allLogs.push(`ERROR: ${msg}`);
      (metadata.sources as unknown[]).push({
        id: source.id,
        label: source.label,
        type: source.type,
        status: 'failed',
        error: msg,
      });
      hasFailure = true;
    }
  }

  for (const source of storageSources) {
    allLogs.push(`\n=== Storage: ${source.label} (${source.type}) ===`);
    updateProgress(projectId, {
      phase: 'storage',
      sourceLabel: source.label,
      sourceType: source.type,
      totalFiles: 0,
      downloadedFiles: 0,
      downloadedBytes: 0,
      currentFile: 'Connexion...',
      message: `Téléchargement de ${source.label}...`,
    });
    try {
      const connector = getStorageConnector(source.type);
      const result: DownloadResult = await connector.download(source.config, tmpDir, (p) => {
        updateProgress(projectId, {
          phase: 'storage',
          sourceLabel: source.label,
          sourceType: source.type,
          totalFiles: p.totalFiles,
          downloadedFiles: p.downloadedFiles,
          currentFile: p.currentFile,
          downloadedBytes: p.downloadedBytes,
        });
      });
      allLogs.push(...result.logs);
      (metadata.sources as unknown[]).push({
        id: source.id,
        label: source.label,
        type: source.type,
        status: 'success',
        files: result.files.length,
        sizeBytes: result.totalSizeBytes,
      });
      hasSuccess = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      allLogs.push(`ERROR: ${msg}`);
      (metadata.sources as unknown[]).push({
        id: source.id,
        label: source.label,
        type: source.type,
        status: 'failed',
        error: msg,
      });
      hasFailure = true;
    }
  }

  const duration = Date.now() - startTime;

  let status: 'success' | 'partial' | 'failed';
  if (!hasSuccess && hasFailure) {
    status = 'failed';
  } else if (hasSuccess && hasFailure) {
    status = 'partial';
  } else {
    status = 'success';
  }

  metadata.duration = duration;
  metadata.logs = allLogs;

  writeFileSync(
    join(tmpDir, 'metadata.json'),
    JSON.stringify(
      { status, duration, started_at: backup.started_at, sources: metadata.sources, logs: allLogs },
      null,
      2,
    ),
  );

  updateProgress(projectId, { phase: 'compressing', message: 'Compression en .zip...' });

  let sizeBytes = 0;
  try {
    sizeBytes = await zipDirectory(tmpDir, zipPath);
    allLogs.push(`Compressed to ${backupName}.zip (${sizeBytes} bytes)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    allLogs.push(`ERROR compressing: ${msg}`);
    if (!hasFailure) {
      status = 'partial';
      hasFailure = true;
    }
  }

  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch { /* ignore */ }

  backupsRepo.updateStatus(backup.id, status, {
    size_bytes: sizeBytes,
    error_message: status === 'failed' ? allLogs.filter((l) => l.startsWith('ERROR')).join('; ') : undefined,
    metadata: JSON.stringify(metadata),
  });

  if (status === 'failed' || status === 'partial') {
    alertsRepo.create(
      projectId,
      'failure',
      `Backup ${type} ${status === 'partial' ? 'partiellement échoué' : 'échoué'} pour ${project.name}`,
      backup.id,
    );

    await sendBackupAlert({
      projectName: project.name,
      backupType: type,
      status,
      timestamp: now,
      duration,
      errors: allLogs.filter((l) => l.startsWith('ERROR')),
    });
  }

  if (status === 'failed') {
    await pingBackupFailure();
  } else {
    await pingBackupSuccess();
  }

  const schedule = schedulesRepo.findByProject(projectId);
  if (schedule) {
    await applyRetention(projectId, schedule.retention_count);
  }

  updateProgress(projectId, { phase: 'done', status, duration, message: 'Terminé' });
  clearProgress(projectId);

  return { backupId: backup.id, status, duration };
}
