export interface DownloadResult {
  files: { name: string; sizeBytes: number }[];
  totalSizeBytes: number;
  logs: string[];
}

export interface DownloadProgress {
  totalFiles: number;
  downloadedFiles: number;
  currentFile: string;
  downloadedBytes: number;
}

export interface StorageConnector {
  readonly type: string;
  testConnection(config: Record<string, unknown>): Promise<boolean>;
  download(config: Record<string, unknown>, outputDir: string, onProgress?: (p: DownloadProgress) => void): Promise<DownloadResult>;
  restore(config: Record<string, unknown>, inputDir: string): Promise<void>;
}
