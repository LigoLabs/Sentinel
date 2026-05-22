import { Client as FtpClient, type FileInfo } from 'basic-ftp';
import { createWriteStream, mkdirSync, statSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import type { DatabaseConnector, DumpResult, DumpProgress } from './types.js';

// Number of additional FTP connections opened during the files phase, used as a worker
// pool for parallel downloads. Matches FileZilla's max-transfers default of 10. Shared
// hosts often cap below this — the pool gracefully shrinks to whatever the server allows.
const FTP_DOWNLOAD_CONCURRENCY = 10;

// Excludes for the WordPress files dump. Paths are matched against the relative path
// from the web root, with forward slashes. Trailing slash means directory prefix.
const FILE_EXCLUDES_PREFIX = [
  'wp-content/cache/',
  'wp-content/upgrade/',
  'wp-content/uploads/cache/',
  'wp-content/wflogs/',          // Wordfence logs
  'wp-content/ai1wm-backups/',   // All-in-One WP Migration
  'wp-content/updraft/',         // UpdraftPlus
];
const FILE_EXCLUDES_PREFIX_BASENAME = [
  '_sentinel_',  // any of our own temp scripts / shim dirs
];

interface WordPressConfig {
  ftpHost: string;
  ftpPort: number;
  ftpUser: string;
  ftpPassword: string;
  ftpSecure: boolean;
  remoteWebRoot: string;
  siteUrl: string;
}

function parseConfig(config: Record<string, unknown>): WordPressConfig {
  const ftpHost = config.ftpHost as string;
  const ftpUser = config.ftpUser as string;
  const remoteWebRoot = config.remoteWebRoot as string;
  const siteUrl = config.siteUrl as string;
  if (!ftpHost || !ftpUser || !remoteWebRoot || !siteUrl) {
    throw new Error('wordpress requires ftpHost, ftpUser, remoteWebRoot, and siteUrl');
  }
  return {
    ftpHost,
    ftpPort: Number(config.ftpPort) || 21,
    ftpUser,
    ftpPassword: (config.ftpPassword as string) || '',
    ftpSecure: config.ftpSecure === true,
    remoteWebRoot: remoteWebRoot.replace(/\/+$/, '') || '/',
    siteUrl: siteUrl.replace(/\/+$/, ''),
  };
}

async function connectFtp(cfg: WordPressConfig): Promise<FtpClient> {
  const client = new FtpClient(30_000);
  client.ftp.verbose = false;
  try {
    await client.access({
      host: cfg.ftpHost,
      port: cfg.ftpPort,
      user: cfg.ftpUser,
      password: cfg.ftpPassword,
      secure: cfg.ftpSecure,
      secureOptions: cfg.ftpSecure ? { rejectUnauthorized: false } : undefined,
    });
  } catch (err) {
    client.close();
    const raw = err instanceof Error ? err.message : String(err);
    const where = `${cfg.ftpHost}:${cfg.ftpPort} (user=${cfg.ftpUser}, FTPS=${cfg.ftpSecure ? 'on' : 'off'})`;
    // basic-ftp surfaces the server's reply verbatim, e.g. "500 This security scheme is not implemented"
    // when AUTH TLS is refused. Detect common cases and rewrite to something actionable.
    if (cfg.ftpSecure && /security scheme is not implemented|AUTH TLS|AUTH SSL|not supported|534|504/i.test(raw)) {
      throw new Error(
        `Connexion FTP refusée sur ${where} : le serveur ne supporte pas FTPS (${raw}). ` +
        `Désactivez l'option « FTP sécurisé (FTPS) » dans la source, ou utilisez un hébergement compatible FTPS/SFTP.`,
      );
    }
    if (/530|login|password|authentication/i.test(raw)) {
      throw new Error(`Authentification FTP refusée sur ${where} : ${raw}. Vérifiez l'utilisateur et le mot de passe.`);
    }
    if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH|getaddrinfo/i.test(raw)) {
      throw new Error(`Impossible de joindre le serveur FTP ${where} : ${raw}. Vérifiez l'hôte, le port et le pare-feu.`);
    }
    throw new Error(`Échec de connexion FTP sur ${where} : ${raw}`);
  }
  return client;
}

function buildDumperPhp(token: string): string {
  const tokenEscaped = token.replace(/'/g, "\\'");
  return `<?php
// Sentinel WordPress dumper — auto-deletes after run
declare(strict_types=1);
set_time_limit(0);
ini_set('memory_limit', '-1');
@ignore_user_abort(true);

function sentinel_cleanup() {
  @unlink(__FILE__);
}
// Self-delete only on the final call (cleanup=1). Otherwise the script needs to survive
// for subsequent calls in the same backup (meta → dump) without re-uploading and racing
// the shutdown handler.
if (isset($_GET['cleanup']) && $_GET['cleanup'] === '1') {
  register_shutdown_function('sentinel_cleanup');
}

$expected = '${tokenEscaped}';
$received = isset($_GET['token']) ? (string) $_GET['token'] : '';
if (!hash_equals($expected, $received)) {
  http_response_code(403);
  echo 'forbidden';
  exit;
}

$candidates = array(
  __DIR__ . '/wp-config.php',
  dirname(__DIR__) . '/wp-config.php',
);
$wp_config_path = null;
foreach ($candidates as $p) {
  if (is_readable($p)) { $wp_config_path = $p; break; }
}
if (!$wp_config_path) {
  http_response_code(500);
  echo 'wp-config.php introuvable (essayé : ' . implode(', ', $candidates) . ')';
  exit;
}

// Charge wp-config.php via require — robuste pour tous les styles (quotes mixées, getenv(), \$_ENV[…], Bedrock…).
// On définit ABSPATH vers un shim avant l'include pour empêcher wp-config de charger wp-settings.php et booter tout WP.
$shim_dir = __DIR__ . '/_sentinel_shim_' . bin2hex(random_bytes(6));
if (!@mkdir($shim_dir, 0700) && !is_dir($shim_dir)) {
  http_response_code(500);
  echo 'Impossible de créer le shim ABSPATH dans ' . __DIR__;
  exit;
}
@file_put_contents($shim_dir . '/wp-settings.php', '<?php /* sentinel shim — empêche le chargement de wp-settings.php */');
register_shutdown_function(function () use ($shim_dir) {
  @unlink($shim_dir . '/wp-settings.php');
  @rmdir($shim_dir);
});
if (!defined('ABSPATH')) {
  define('ABSPATH', $shim_dir . DIRECTORY_SEPARATOR);
}

$load_error = null;
ob_start();
try {
  require $wp_config_path;
} catch (Throwable $e) {
  $load_error = $e->getMessage();
}
$captured = ob_get_clean();

if ($load_error !== null) {
  http_response_code(500);
  echo 'Erreur lors du chargement de wp-config.php : ' . $load_error;
  exit;
}

$sentinel_check = function ($name) {
  if (!defined($name)) return 'non définie';
  $v = constant($name);
  if ($v === null) return 'définie à null';
  if ($v === false) return 'définie à false (getenv/\$_ENV manquant ?)';
  if ($v === '') return 'définie mais vide';
  return null;
};

$missing = array();
foreach (array('DB_NAME', 'DB_USER', 'DB_HOST') as $req) {
  $why = $sentinel_check($req);
  if ($why !== null) $missing[] = $req . ' (' . $why . ')';
}
if (!empty($missing)) {
  http_response_code(500);
  $hint = $captured !== '' ? ' — sortie capturée : ' . substr($captured, 0, 200) : '';
  echo 'wp-config.php chargé, constantes manquantes : ' . implode(', ', $missing) . $hint;
  exit;
}

$db_name = constant('DB_NAME');
$db_user = constant('DB_USER');
$db_password = defined('DB_PASSWORD') ? constant('DB_PASSWORD') : '';
$db_host_raw = constant('DB_HOST');
if (!isset($table_prefix)) { $table_prefix = 'wp_'; }

$db_host = $db_host_raw;
$db_port = 3306;
$db_socket = null;
if (strpos($db_host_raw, ':') !== false) {
  list($h, $p) = explode(':', $db_host_raw, 2);
  $db_host = $h;
  if (ctype_digit($p)) {
    $db_port = (int) $p;
  } else {
    $db_socket = $p;
  }
}

$mysqli = $db_socket
  ? @new mysqli($db_host, $db_user, $db_password, $db_name, 0, $db_socket)
  : @new mysqli($db_host, $db_user, $db_password, $db_name, $db_port);

if ($mysqli->connect_error) {
  http_response_code(500);
  echo 'MySQL connect error: ' . $mysqli->connect_error;
  exit;
}
$mysqli->set_charset('utf8mb4');

$mode = isset($_GET['mode']) ? $_GET['mode'] : 'dump';

if ($mode === 'meta') {
  header('Content-Type: application/json');
  $tables = array();
  $res = $mysqli->query('SHOW TABLES');
  while ($row = $res->fetch_array(MYSQLI_NUM)) {
    $name = $row[0];
    $cnt_res = $mysqli->query('SELECT COUNT(*) FROM \`' . str_replace('\`', '\`\`', $name) . '\`');
    $cnt_row = $cnt_res ? $cnt_res->fetch_array(MYSQLI_NUM) : array(0);
    $tables[] = array('name' => $name, 'rowCount' => (int) $cnt_row[0]);
  }
  echo json_encode(array(
    'database' => $db_name,
    'tablePrefix' => $table_prefix,
    'tables' => $tables,
    'serverVersion' => $mysqli->server_info,
  ));
  $mysqli->close();
  exit;
}

// Dump mode (default)
header('Content-Type: application/octet-stream');
header('X-Sentinel-Dump: 1');

echo "-- Sentinel WordPress dump\\n";
echo "-- Database: " . $db_name . "\\n";
echo "-- Generated: " . date('c') . "\\n";
echo "SET NAMES utf8mb4;\\n";
echo "SET FOREIGN_KEY_CHECKS=0;\\n\\n";

$tables_res = $mysqli->query('SHOW TABLES');
$tables = array();
while ($row = $tables_res->fetch_array(MYSQLI_NUM)) { $tables[] = $row[0]; }

foreach ($tables as $table) {
  $safe = '\`' . str_replace('\`', '\`\`', $table) . '\`';

  echo "DROP TABLE IF EXISTS " . $safe . ";\\n";

  $create = $mysqli->query("SHOW CREATE TABLE " . $safe);
  if ($create) {
    $crow = $create->fetch_array(MYSQLI_NUM);
    if ($crow) echo $crow[1] . ";\\n\\n";
    $create->free();
  }

  $result = $mysqli->query("SELECT * FROM " . $safe, MYSQLI_USE_RESULT);
  if (!$result) { echo "-- skip " . $table . ": " . $mysqli->error . "\\n\\n"; continue; }

  $fields = $result->fetch_fields();
  $colCount = count($fields);
  $colNames = array();
  foreach ($fields as $f) { $colNames[] = '\`' . str_replace('\`', '\`\`', $f->name) . '\`'; }
  $cols_sql = implode(',', $colNames);

  $batch = array();
  $BATCH_SIZE = 100;

  while ($row = $result->fetch_row()) {
    $vals = array();
    for ($i = 0; $i < $colCount; $i++) {
      $v = $row[$i];
      if ($v === null) {
        $vals[] = 'NULL';
      } else {
        $type = $fields[$i]->type;
        $flags = $fields[$i]->flags;
        $is_binary_blob = ($flags & MYSQLI_BINARY_FLAG) && in_array($type, array(
          MYSQLI_TYPE_TINY_BLOB, MYSQLI_TYPE_BLOB, MYSQLI_TYPE_MEDIUM_BLOB, MYSQLI_TYPE_LONG_BLOB
        ), true);
        if ($is_binary_blob) {
          $vals[] = strlen($v) > 0 ? '0x' . bin2hex($v) : "''";
        } elseif (($flags & MYSQLI_NUM_FLAG) && !($flags & MYSQLI_ZEROFILL_FLAG)) {
          $vals[] = $v;
        } else {
          $vals[] = "'" . $mysqli->real_escape_string($v) . "'";
        }
      }
    }
    $batch[] = '(' . implode(',', $vals) . ')';

    if (count($batch) >= $BATCH_SIZE) {
      echo "INSERT INTO " . $safe . " (" . $cols_sql . ") VALUES\\n" . implode(",\\n", $batch) . ";\\n";
      $batch = array();
      flush();
    }
  }

  if (count($batch) > 0) {
    echo "INSERT INTO " . $safe . " (" . $cols_sql . ") VALUES\\n" . implode(",\\n", $batch) . ";\\n";
  }

  echo "\\n";
  $result->free();
  flush();
}

echo "SET FOREIGN_KEY_CHECKS=1;\\n";
echo "-- Sentinel dump complete\\n";

$mysqli->close();
`;
}

async function uploadDumperScript(client: FtpClient, remotePath: string, php: string, scriptName: string): Promise<void> {
  const tmp = join(tmpdir(), `sentinel_dumper_${randomBytes(6).toString('hex')}.php`);
  writeFileSync(tmp, php, 'utf8');
  try {
    await client.uploadFrom(tmp, `${remotePath}/${scriptName}`);
  } finally {
    try { unlinkSync(tmp); } catch { /* ignore */ }
  }
}

async function deleteRemote(client: FtpClient, remotePath: string, scriptName: string): Promise<void> {
  try {
    await client.remove(`${remotePath}/${scriptName}`);
  } catch { /* ignore — script may have already self-deleted */ }
}

async function streamHttpToFile(url: string, localPath: string, onBytes?: (bytes: number) => void): Promise<{ bytes: number; isDump: boolean }> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const dumpHeader = res.headers.get('x-sentinel-dump');
  const isDump = dumpHeader === '1';
  if (!res.body) throw new Error('Réponse HTTP vide');

  const writer = createWriteStream(localPath);
  let total = 0;
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.length;
        if (!writer.write(Buffer.from(value))) {
          await new Promise<void>((r) => writer.once('drain', () => r()));
        }
        onBytes?.(total);
      }
    }
  } finally {
    await new Promise<void>((r) => writer.end(() => r()));
  }
  return { bytes: total, isDump };
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

interface RemoteFile {
  remoteFull: string;  // absolute path on FTP
  relative: string;    // path relative to remoteWebRoot, forward slashes
  size: number;
}

function isExcluded(relative: string): boolean {
  for (const p of FILE_EXCLUDES_PREFIX) {
    if (relative === p.replace(/\/$/, '') || relative.startsWith(p)) return true;
  }
  const segments = relative.split('/');
  for (const seg of segments) {
    for (const b of FILE_EXCLUDES_PREFIX_BASENAME) {
      if (seg.startsWith(b)) return true;
    }
  }
  return false;
}

async function listFilesRecursive(
  client: FtpClient,
  remotePath: string,
  basePath: string,
  acc: RemoteFile[],
  onCount?: (files: number, dirs: number) => void,
  counter?: { files: number; dirs: number },
): Promise<void> {
  let items: FileInfo[];
  try {
    items = await client.list(remotePath);
  } catch {
    return;
  }
  if (counter) {
    counter.dirs++;
    onCount?.(counter.files, counter.dirs);
  }
  for (const item of items) {
    if (item.name === '.' || item.name === '..') continue;
    const fullPath = `${remotePath}/${item.name}`;
    const relative = fullPath.startsWith(basePath + '/')
      ? fullPath.slice(basePath.length + 1)
      : item.name;
    if (isExcluded(relative)) continue;
    if (item.isDirectory) {
      await listFilesRecursive(client, fullPath, basePath, acc, onCount, counter);
    } else if (item.isFile) {
      acc.push({ remoteFull: fullPath, relative, size: item.size });
      if (counter) {
        counter.files++;
        onCount?.(counter.files, counter.dirs);
      }
    }
  }
}

async function downloadAllFiles(
  client: FtpClient,
  cfg: WordPressConfig,
  outputDir: string,
  logs: string[],
  onProgress?: (p: DumpProgress) => void,
): Promise<{ count: number; sizeBytes: number; failed: number }> {
  const filesDir = join(outputDir, 'files');
  mkdirSync(filesDir, { recursive: true });

  logs.push('Listing récursif des fichiers du site via FTP…');
  onProgress?.({ phase: 'files-listing', message: 'Listing des fichiers du site via FTP…' });
  const remoteFiles: RemoteFile[] = [];
  const counter = { files: 0, dirs: 0 };
  await listFilesRecursive(
    client,
    cfg.remoteWebRoot,
    cfg.remoteWebRoot,
    remoteFiles,
    (files, dirs) => {
      onProgress?.({
        phase: 'files-listing',
        message: `Listing FTP… ${dirs} dossier(s), ${files} fichier(s)`,
        totalFiles: files,
      });
    },
    counter,
  );
  logs.push(`Listing : ${remoteFiles.length} fichier(s), ${counter.dirs} dossier(s)`);

  if (remoteFiles.length === 0) {
    logs.push('Aucun fichier à télécharger.');
    return { count: 0, sizeBytes: 0, failed: 0 };
  }

  const totalBytes = remoteFiles.reduce((s, f) => s + f.size, 0);
  logs.push(`Téléchargement de ${remoteFiles.length} fichier(s) (~${fmtBytes(totalBytes)})…`);

  // ── Open additional FTP connections for parallel download (graceful fallback) ──
  // The original `client` keeps holding the PHP-dumper session for the finally cleanup;
  // we open up to FTP_DOWNLOAD_CONCURRENCY extra connections for the worker pool, all in
  // parallel to avoid a serial startup cost. Shared hosts often cap concurrent FTP per
  // user — Promise.allSettled keeps the connections that succeeded and discards the rest.
  const attempts = await Promise.allSettled(
    Array.from({ length: FTP_DOWNLOAD_CONCURRENCY }, () => connectFtp(cfg)),
  );
  const pool: FtpClient[] = [];
  let refusedCount = 0;
  for (const a of attempts) {
    if (a.status === 'fulfilled') pool.push(a.value);
    else refusedCount++;
  }
  if (refusedCount > 0) {
    const sample = attempts.find((a) => a.status === 'rejected') as PromiseRejectedResult | undefined;
    const why = sample ? (sample.reason instanceof Error ? sample.reason.message : String(sample.reason)) : '';
    logs.push(`(pool : ${refusedCount}/${FTP_DOWNLOAD_CONCURRENCY} connexion(s) refusée(s) par le serveur — ${why})`);
  }
  if (pool.length === 0) {
    // Fall back to the original client (sequential download).
    pool.push(client);
    logs.push('Aucune connexion FTP supplémentaire disponible : téléchargement séquentiel.');
  } else {
    logs.push(`Téléchargement parallèle avec ${pool.length} connexion(s) FTP.`);
  }

  let downloadedBytes = 0;
  let failed = 0;
  let completedCount = 0;
  let nextIndex = 0;
  let lastLogPct = -1;

  const worker = async (workerClient: FtpClient): Promise<void> => {
    while (nextIndex < remoteFiles.length) {
      const idx = nextIndex++;
      const file = remoteFiles[idx];
      // Strip any path traversal segments defensively.
      const safeRel = file.relative.split('/').map((s) => (s === '..' ? '_' : s)).join('/');
      const localPath = join(filesDir, safeRel);
      try {
        mkdirSync(dirname(localPath), { recursive: true });
        await workerClient.downloadTo(localPath, file.remoteFull);
        downloadedBytes += file.size;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logs.push(`FAILED ${file.relative} : ${msg}`);
        failed++;
      }
      completedCount++;
      onProgress?.({
        phase: 'files-downloading',
        message: `Téléchargement fichiers du site (FTP×${pool.length}) — ${completedCount}/${remoteFiles.length}`,
        totalFiles: remoteFiles.length,
        downloadedFiles: completedCount,
        currentFile: file.relative,
        downloadedBytes,
      });
      // Throttled progress log every ~10%
      const pct = Math.floor((completedCount / remoteFiles.length) * 10);
      if (pct !== lastLogPct) {
        lastLogPct = pct;
        logs.push(`Progression : ${completedCount}/${remoteFiles.length} fichiers (${fmtBytes(downloadedBytes)})`);
      }
    }
  };

  await Promise.all(pool.map((c) => worker(c)));

  // Close extra connections (but never the original `client` — caller's finally manages it).
  for (const c of pool) {
    if (c !== client) {
      try { c.close(); } catch { /* ignore */ }
    }
  }

  logs.push(`Téléchargement fichiers terminé : ${remoteFiles.length - failed}/${remoteFiles.length} (${fmtBytes(downloadedBytes)}), ${failed} échec(s)`);
  return { count: remoteFiles.length - failed, sizeBytes: downloadedBytes, failed };
}

function buildPathMismatchError(url: string, cfg: WordPressConfig, scriptName: string): string {
  let hostHint = '';
  try {
    hostHint = ` (souvent /public_html, /htdocs, ou /www/${new URL(cfg.siteUrl).hostname}/htdocs)`;
  } catch { /* ignore */ }
  return (
    `HTTP 404 sur ${url}. ` +
    `Le script a été uploadé via FTP à ${cfg.remoteWebRoot}/${scriptName}, mais l'URL correspondante retourne 404. ` +
    `Causes possibles : ` +
    `(1) le « Chemin web distant » FTP ne correspond pas à la racine servie à ${cfg.siteUrl}${hostHint} ; ` +
    `(2) un plugin de sécurité (Wordfence, iThemes Security…) ou une règle .htaccess bloque les fichiers PHP inconnus ; ` +
    `(3) l'upload FTP a échoué silencieusement.`
  );
}

export class WordPressConnector implements DatabaseConnector {
  readonly type = 'wordpress';

  async testConnection(config: Record<string, unknown>): Promise<boolean> {
    const cfg = parseConfig(config);

    // 1. Test FTP connection + path
    const client = await connectFtp(cfg);
    try {
      await client.list(cfg.remoteWebRoot);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Chemin FTP inaccessible : ${cfg.remoteWebRoot} (${msg})`);
    }

    // 2. Upload dumper script and call ?mode=meta to verify wp-config + MySQL access
    const token = randomBytes(24).toString('hex');
    const scriptName = `_sentinel_test_${randomBytes(8).toString('hex')}.php`;
    const php = buildDumperPhp(token);

    try {
      await uploadDumperScript(client, cfg.remoteWebRoot, php, scriptName);

      const url = `${cfg.siteUrl}/${scriptName}?mode=meta&token=${token}`;
      const res = await fetch(url, { redirect: 'follow' });
      const body = await res.text();
      if (res.status === 404) {
        throw new Error(buildPathMismatchError(url, cfg, scriptName));
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} sur ${url} : ${body.slice(0, 200)}`);
      }
      let parsed: unknown;
      try { parsed = JSON.parse(body); } catch {
        throw new Error(`Réponse non-JSON (le PHP s'exécute-t-il ?) : ${body.slice(0, 200)}`);
      }
      const meta = parsed as { database?: string; tables?: unknown[] };
      if (!meta.database || !Array.isArray(meta.tables)) {
        throw new Error(`Réponse inattendue : ${body.slice(0, 200)}`);
      }
      return true;
    } finally {
      await deleteRemote(client, cfg.remoteWebRoot, scriptName);
      client.close();
    }
  }

  async dump(
    config: Record<string, unknown>,
    outputDir: string,
    onProgress?: (p: DumpProgress) => void,
  ): Promise<DumpResult> {
    const cfg = parseConfig(config);
    const logs: string[] = [];
    mkdirSync(outputDir, { recursive: true });

    onProgress?.({ phase: 'dumping', message: 'Connexion FTP au site WordPress…' });
    logs.push(`Connexion FTP à ${cfg.ftpHost}:${cfg.ftpPort} (FTPS=${cfg.ftpSecure ? 'on' : 'off'})…`);
    const client = await connectFtp(cfg);
    logs.push('Connexion FTP établie.');
    const token = randomBytes(24).toString('hex');
    const scriptName = `_sentinel_dump_${randomBytes(8).toString('hex')}.php`;
    const php = buildDumperPhp(token);

    try {
      onProgress?.({ phase: 'dumping', message: 'Upload du script PHP de dump…' });
      logs.push(`Upload du script PHP : ${scriptName}`);
      await uploadDumperScript(client, cfg.remoteWebRoot, php, scriptName);

      // Get table metadata first (no cleanup=1 → script survives for the dump call)
      const metaUrl = `${cfg.siteUrl}/${scriptName}?mode=meta&token=${token}`;
      onProgress?.({ phase: 'dumping', message: 'Lecture des métadonnées MySQL…' });
      logs.push(`Récupération des métadonnées via ${metaUrl}`);
      const metaRes = await fetch(metaUrl, { redirect: 'follow' });
      const metaBody = await metaRes.text();
      if (metaRes.status === 404) {
        throw new Error(buildPathMismatchError(metaUrl, cfg, scriptName));
      }
      if (!metaRes.ok) {
        throw new Error(`Échec récupération métadonnées : HTTP ${metaRes.status} — ${metaBody.slice(0, 200)}`);
      }
      let meta: { database: string; tables: { name: string; rowCount: number }[] };
      try {
        meta = JSON.parse(metaBody);
      } catch {
        throw new Error(`Réponse métadonnées non-JSON : ${metaBody.slice(0, 200)}`);
      }
      logs.push(`Base : ${meta.database} (${meta.tables.length} tables)`);
      for (const t of meta.tables) logs.push(`  ${t.name} : ${t.rowCount} lignes`);

      // Stream the dump (cleanup=1 → script self-deletes after sending the dump)
      const dumpUrl = `${cfg.siteUrl}/${scriptName}?token=${token}&cleanup=1`;
      const dumpPath = join(outputDir, `${meta.database}.sql`);
      onProgress?.({ phase: 'dumping', message: `Export SQL — ${meta.tables.length} table(s)…` });
      logs.push(`Streaming du dump depuis ${dumpUrl}…`);
      let bytes: number;
      let isDump: boolean;
      try {
        const result = await streamHttpToFile(dumpUrl, dumpPath);
        bytes = result.bytes;
        isDump = result.isDump;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.startsWith('HTTP 404:')) {
          throw new Error(buildPathMismatchError(dumpUrl, cfg, scriptName));
        }
        throw err;
      }
      if (!isDump) {
        // Read first chunk of file to surface the error
        const head = readFileSync(dumpPath, 'utf8').slice(0, 500);
        throw new Error(`Réponse n'est pas un dump (header X-Sentinel-Dump absent). Contenu : ${head}`);
      }
      logs.push(`Dump écrit : ${dumpPath} (${fmtBytes(bytes)})`);
      const dumpSize = statSync(dumpPath).size;

      // ── Phase 2 : download all WordPress files via FTP ──
      logs.push('');
      logs.push('=== Phase 2 : téléchargement des fichiers du site ===');
      const filesResult = await downloadAllFiles(client, cfg, outputDir, logs, onProgress);

      return {
        tables: meta.tables,
        sizeBytes: dumpSize + filesResult.sizeBytes,
        logs,
        files: filesResult,
      };
    } finally {
      await deleteRemote(client, cfg.remoteWebRoot, scriptName);
      client.close();
    }
  }

  async restore(_config: Record<string, unknown>, _inputDir: string): Promise<void> {
    throw new Error('WordPress restore non implémenté.');
  }
}
