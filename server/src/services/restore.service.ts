import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import AdmZip from 'adm-zip';
import { backupsRepo } from '../database/repositories/backups.repository.js';
import { sourcesRepo } from '../database/repositories/sources.repository.js';
import { getDatabaseConnector } from '../connectors/database/registry.js';
import { getStorageConnector } from '../connectors/storage/registry.js';

const DB_CONNECTOR_TYPES = ['turso', 'sqlite', 'postgres', 'postgres-ssh', 'mysql', 'mysql-ssh'];

export interface RestoreResult {
  success: boolean;
  logs: string[];
}

export async function restoreBackup(backupId: number): Promise<RestoreResult> {
  const backup = backupsRepo.findById(backupId);
  if (!backup) throw new Error(`Backup ${backupId} not found`);
  if (!backup.file_path || !existsSync(backup.file_path)) {
    throw new Error(`Backup files not found at ${backup.file_path}`);
  }

  const isZip = backup.file_path.endsWith('.zip');
  let workDir = backup.file_path;

  if (isZip) {
    workDir = join(dirname(backup.file_path), `_restore_tmp_${backupId}`);
    mkdirSync(workDir, { recursive: true });
    const zip = new AdmZip(backup.file_path);
    zip.extractAllTo(workDir, true);
  }

  const sources = sourcesRepo.findByProjectDecrypted(backup.project_id);
  const dbSources = sources.filter((s) => DB_CONNECTOR_TYPES.includes(s.type));
  const storageSources = sources.filter((s) => !DB_CONNECTOR_TYPES.includes(s.type));
  const logs: string[] = [];
  let allSuccess = true;

  try {
    for (const source of dbSources) {
      logs.push(`Restauration BDD : ${source.label} (${source.type})...`);
      try {
        const connector = getDatabaseConnector(source.type);
        await connector.restore(source.config, workDir);
        logs.push(`  OK`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logs.push(`  FAILED: ${msg}`);
        allSuccess = false;
      }
    }

    for (const source of storageSources) {
      logs.push(`Restauration storage : ${source.label} (${source.type})...`);
      try {
        const connector = getStorageConnector(source.type);
        await connector.restore(source.config, workDir);
        logs.push(`  OK`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logs.push(`  FAILED: ${msg}`);
        allSuccess = false;
      }
    }
  } finally {
    if (isZip) {
      try {
        rmSync(workDir, { recursive: true, force: true });
      } catch { /* ignore */ }
    }
  }

  return { success: allSuccess, logs };
}
