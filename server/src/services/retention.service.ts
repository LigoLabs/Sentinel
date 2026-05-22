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
  retentionCount: number,
): Promise<number> {
  const oldBackups = backupsRepo.findDailyOverLimit(projectId, retentionCount);
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
