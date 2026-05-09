import { rmSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { config } from '../config.js';
import { backupsRepo } from '../database/repositories/backups.repository.js';

function pruneEmptyParents(filePath: string): void {
  const backupsRoot = resolve(config.BACKUP_DIR);
  let dir = dirname(filePath);
  while (dir.length > backupsRoot.length && dir.startsWith(backupsRoot)) {
    try {
      const entries = readdirSync(dir);
      if (entries.length > 0) break;
      rmSync(dir, { recursive: true, force: true });
      dir = dirname(dir);
    } catch { break; }
  }
}

export async function applyRetention(
  projectId: number,
  retentionDailyDays: number,
): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDailyDays);
  const cutoff = cutoffDate.toISOString().replace('T', ' ').slice(0, 19);

  const oldBackups = backupsRepo.findDailyOlderThan(projectId, cutoff);
  let deletedCount = 0;

  for (const backup of oldBackups) {
    if (backup.file_path) {
      try {
        rmSync(backup.file_path, { force: true });
        pruneEmptyParents(backup.file_path);
      } catch { /* file may already be gone */ }
    }
    backupsRepo.delete(backup.id);
    deletedCount++;
  }

  return deletedCount;
}
