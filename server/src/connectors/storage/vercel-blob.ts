import { list, put, del } from '@vercel/blob';
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import type { StorageConnector, DownloadResult, DownloadProgress } from './types.js';

interface VercelBlobConfig {
  token: string;
}

function parseConfig(config: Record<string, unknown>): VercelBlobConfig {
  const token = config.token as string;
  if (!token) {
    throw new Error('Vercel Blob connector requires a BLOB_READ_WRITE_TOKEN');
  }
  return { token };
}

async function downloadBlob(url: string, outputPath: string): Promise<number> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download ${url}: ${res.status}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, buffer);
  return buffer.length;
}

function listFilesRecursive(dir: string): string[] {
  const results: string[] = [];
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return results; }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) results.push(...listFilesRecursive(fullPath));
    else if (entry.isFile()) results.push(fullPath);
  }
  return results;
}

export class VercelBlobConnector implements StorageConnector {
  readonly type = 'vercel-blob';

  async testConnection(config: Record<string, unknown>): Promise<boolean> {
    const { token } = parseConfig(config);
    const result = await list({ token, limit: 1 });
    return Array.isArray(result.blobs);
  }

  async download(config: Record<string, unknown>, outputDir: string, onProgress?: (p: DownloadProgress) => void): Promise<DownloadResult> {
    const { token } = parseConfig(config);
    const logs: string[] = [];
    const files: DownloadResult['files'] = [];
    let totalSize = 0;

    const assetsDir = join(outputDir, 'assets');
    mkdirSync(assetsDir, { recursive: true });

    let cursor: string | undefined;
    let hasMore = true;
    let blobCount = 0;

    while (hasMore) {
      const result = await list({ token, limit: 1000, cursor });
      blobCount += result.blobs.length;
      cursor = result.cursor;
      hasMore = result.hasMore;

      for (const blob of result.blobs) {
        const relativePath = blob.pathname || `blob_${files.length}`;
        const outputPath = join(assetsDir, relativePath.replace(/\.\./g, '_'));

        onProgress?.({ totalFiles: blobCount, downloadedFiles: files.length, currentFile: relativePath, downloadedBytes: totalSize });

        try {
          const size = await downloadBlob(blob.downloadUrl, outputPath);
          files.push({ name: relativePath, sizeBytes: size });
          totalSize += size;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logs.push(`FAILED: ${relativePath} - ${msg}`);
        }
      }
    }

    logs.push(`Listed ${blobCount} blobs, downloaded ${files.length} files (${totalSize} bytes)`);
    return { files, totalSizeBytes: totalSize, logs };
  }

  async restore(config: Record<string, unknown>, inputDir: string): Promise<void> {
    const { token } = parseConfig(config);

    let cursor: string | undefined;
    let hasMore = true;
    let deleted = 0;
    while (hasMore) {
      const result = await list({ token, limit: 500, cursor });
      if (result.blobs.length > 0) {
        await del(result.blobs.map((b) => b.url), { token });
        deleted += result.blobs.length;
      }
      cursor = result.cursor;
      hasMore = result.hasMore;
    }
    if (deleted > 0) console.log(`[Vercel Blob] Cleared ${deleted} existing blobs before restore`);

    const assetsDir = join(inputDir, 'assets');
    const files = listFilesRecursive(assetsDir);
    if (files.length === 0) return;

    let uploaded = 0;
    for (const filePath of files) {
      const rel = relative(assetsDir, filePath).replace(/\\/g, '/');
      const buffer = readFileSync(filePath);
      await put(rel, buffer, { access: 'public', token });
      uploaded++;
      if (uploaded % 100 === 0) console.log(`[Vercel Blob] Uploaded ${uploaded}/${files.length}`);
    }
    console.log(`[Vercel Blob] Restore complete: ${uploaded} files uploaded`);
  }
}
