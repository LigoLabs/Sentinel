export interface DumpResult {
  tables: { name: string; rowCount: number }[];
  sizeBytes: number;
  logs: string[];
}

export interface DatabaseConnector {
  readonly type: string;
  testConnection(config: Record<string, unknown>): Promise<boolean>;
  dump(config: Record<string, unknown>, outputDir: string): Promise<DumpResult>;
  restore(config: Record<string, unknown>, inputDir: string): Promise<void>;
}
