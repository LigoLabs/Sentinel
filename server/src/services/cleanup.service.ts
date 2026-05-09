import { readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';
import { getDb } from '../database/connection.js';
import { backupsRepo } from '../database/repositories/backups.repository.js';

interface TmpFolder {
  path: string;
  name: string;
  sizeBytes: number;
}

function dirSize(dir: string): number {
  let total = 0;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) total += dirSize(p);
      else try { total += statSync(p).size; } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  return total;
}

function findTmpFolders(dir: string): TmpFolder[] {
  const result: TmpFolder[] = [];
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return result; }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('_tmp_') || entry.name.startsWith('_restore_tmp_')) {
        result.push({ path: fullPath, name: entry.name, sizeBytes: dirSize(fullPath) });
      } else {
        result.push(...findTmpFolders(fullPath));
      }
    }
  }
  return result;
}

export function getTmpStatus(): { count: number; totalSizeBytes: number } {
  const folders = findTmpFolders(config.BACKUP_DIR);
  const totalSize = folders.reduce((s, f) => s + f.sizeBytes, 0);
  return { count: folders.length, totalSizeBytes: totalSize };
}

export function cleanupTmpFolders(): number {
  const folders = findTmpFolders(config.BACKUP_DIR);
  let cleaned = 0;
  for (const f of folders) {
    try { rmSync(f.path, { recursive: true, force: true }); cleaned++; } catch { /* ignore */ }
  }
  return cleaned;
}

export function startupCleanup(): void {
  const tmpCleaned = cleanupTmpFolders();
  if (tmpCleaned > 0) {
    console.log(`[Cleanup] ${tmpCleaned} dossier(s) temporaire(s) supprimé(s)`);
  }

  const running = getDb()
    .prepare("SELECT id FROM backups WHERE status = 'running'")
    .all() as { id: number }[];

  for (const row of running) {
    backupsRepo.updateStatus(row.id, 'failed', {
      error_message: 'Backup interrompu (crash ou redémarrage du serveur)',
    });
  }

  if (running.length > 0) {
    console.log(`[Cleanup] ${running.length} backup(s) orphelin(s) marqué(s) comme échoué(s)`);
  }
}
