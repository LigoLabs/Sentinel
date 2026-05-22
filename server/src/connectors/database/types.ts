export interface DumpResult {
  tables: { name: string; rowCount: number }[];
  sizeBytes: number;
  logs: string[];
  files?: {
    count: number;
    sizeBytes: number;
    failed: number;
  };
}

export interface DumpProgress {
  phase: 'dumping' | 'files-listing' | 'files-downloading';
  message?: string;
  totalFiles?: number;
  downloadedFiles?: number;
  currentFile?: string;
  downloadedBytes?: number;
}

export interface DatabaseConnector {
  readonly type: string;
  testConnection(config: Record<string, unknown>): Promise<boolean>;
  dump(
    config: Record<string, unknown>,
    outputDir: string,
    onProgress?: (p: DumpProgress) => void,
  ): Promise<DumpResult>;
  restore(config: Record<string, unknown>, inputDir: string): Promise<void>;
}
