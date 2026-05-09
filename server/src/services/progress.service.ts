export interface BackupProgress {
  projectId: number;
  backupId?: number;
  phase: 'starting' | 'database' | 'storage' | 'compressing' | 'done' | 'error';
  sourceLabel?: string;
  sourceType?: string;
  totalFiles?: number;
  downloadedFiles?: number;
  currentFile?: string;
  downloadedBytes?: number;
  message?: string;
  status?: 'success' | 'partial' | 'failed';
  duration?: number;
}

const progressMap = new Map<number, BackupProgress>();

export function updateProgress(projectId: number, update: Partial<BackupProgress>): void {
  const current = progressMap.get(projectId) || { projectId, phase: 'starting' as const };
  progressMap.set(projectId, { ...current, ...update, projectId });
}

export function getProgress(projectId: number): BackupProgress | undefined {
  return progressMap.get(projectId);
}

export function clearProgress(projectId: number): void {
  setTimeout(() => progressMap.delete(projectId), 60_000);
}
