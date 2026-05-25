#!/usr/bin/env node
/**
 * Seed temporaire pour les screenshots du README.
 * Génère une BDD `data/sentinel.db` remplie d'exemples factices mais cohérents
 * (projets, sources chiffrées, plannings, backups, alertes).
 *
 * Utilisation :
 *   node scripts/seed-demo.mjs
 *
 * Sauvegarde l'ancienne BDD dans `data/sentinel.db.real.bak` si elle existe,
 * pour pouvoir la restaurer après les captures.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCipheriv, randomBytes } from 'node:crypto';
import dotenv from 'dotenv';
import initSqlJs from 'sql.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
dotenv.config({ path: resolve(ROOT, '.env') });

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length !== 64) {
  console.error('[seed] ENCRYPTION_KEY manquant ou invalide dans .env');
  process.exit(1);
}
const KEY = Buffer.from(ENCRYPTION_KEY, 'hex');

function encrypt(plaintext) {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', KEY, iv);
  let ct = cipher.update(plaintext, 'utf8', 'hex');
  ct += cipher.final('hex');
  return iv.toString('hex') + ':' + cipher.getAuthTag().toString('hex') + ':' + ct;
}
const encryptJson = (obj) => encrypt(JSON.stringify(obj));

// ── chemins ────────────────────────────────────────────────────────────────
const DATA_DIR = resolve(ROOT, 'data');
const DB_PATH = resolve(DATA_DIR, 'sentinel.db');
const BACKUP_PATH = resolve(DATA_DIR, 'sentinel.db.real.bak');

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

if (existsSync(DB_PATH) && !existsSync(BACKUP_PATH)) {
  renameSync(DB_PATH, BACKUP_PATH);
  console.log('[seed] BDD réelle sauvegardée -> data/sentinel.db.real.bak');
} else if (existsSync(DB_PATH)) {
  console.log('[seed] Une BDD démo existe déjà, on l\'écrase.');
}

// ── init sql.js ────────────────────────────────────────────────────────────
const SQL = await initSqlJs();
const db = new SQL.Database();

db.exec(`
  CREATE TABLE projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT DEFAULT '',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE data_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    label TEXT NOT NULL,
    config_encrypted TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );
  CREATE TABLE backup_schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL UNIQUE,
    cron_expression TEXT NOT NULL DEFAULT '0 3 * * *',
    retention_count INTEGER NOT NULL DEFAULT 15,
    retention_monthly INTEGER NOT NULL DEFAULT 1,
    cron_lifetime TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );
  CREATE TABLE backups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    type TEXT NOT NULL DEFAULT 'daily',
    status TEXT NOT NULL DEFAULT 'running',
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT,
    size_bytes INTEGER DEFAULT 0,
    file_path TEXT,
    error_message TEXT,
    metadata TEXT DEFAULT '{}',
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );
  CREATE INDEX idx_backups_project_date ON backups(project_id, started_at DESC);
  CREATE INDEX idx_backups_status ON backups(status);
  CREATE TABLE alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    backup_id INTEGER,
    type TEXT NOT NULL DEFAULT 'failure',
    message TEXT NOT NULL,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (backup_id) REFERENCES backups(id) ON DELETE SET NULL
  );
  CREATE INDEX idx_alerts_unread ON alerts(is_read, created_at DESC);
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// ── helpers date ──────────────────────────────────────────────────────────
function isoDaysAgo(days, hour = 3, minute = 0, second = 0) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(hour, minute, second, 0);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}
function isoMinutesAfter(iso, mins, secs = 0) {
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  d.setUTCSeconds(d.getUTCSeconds() + mins * 60 + secs);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}
function fakeTursoToken() {
  return 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.' + randomBytes(96).toString('base64url') + '.' + randomBytes(32).toString('base64url');
}

// ── projets ───────────────────────────────────────────────────────────────
const PROJECTS = [
  {
    name: 'Atelier Saint-Roch',
    description: 'Site vitrine du café-atelier (WordPress + média uploads).',
    is_active: 1,
    cron: '0 3 * * *',
    retention_count: 15,
    cron_lifetime: '0 4 1 * *',
    sources: [
      {
        type: 'wordpress',
        label: 'WordPress prod',
        config: {
          ftpHost: 'ftp.atelier-saint-roch.fr',
          ftpPort: 21,
          ftpUser: 'atelier_prod',
          ftpPassword: 'fake-password-not-real',
          ftpSecure: false,
          remoteWebRoot: '/home/atelier/public_html',
          siteUrl: 'https://atelier-saint-roch.fr',
        },
      },
    ],
  },
  {
    name: 'Coopérative Marais',
    description: 'Marketplace de producteurs locaux (front Next.js, BDD Turso, assets Vercel Blob).',
    is_active: 1,
    cron: '0 2 * * *',
    retention_count: 30,
    cron_lifetime: '0 3 1 * *',
    sources: [
      {
        type: 'turso',
        label: 'Turso — coop-marais',
        config: {
          url: 'libsql://coop-marais-prod-demo.turso.io',
          authToken: fakeTursoToken(),
        },
      },
      {
        type: 'vercel-blob',
        label: 'Vercel Blob — médias',
        config: {
          token: 'vercel_blob_rw_DEMOTOKENxxxxxxxxxxxxxx_FAKE',
        },
      },
    ],
  },
  {
    name: 'Brasserie Lumen',
    description: 'Brasserie artisanale, site de réservation + boutique en ligne.',
    is_active: 1,
    cron: '30 2 * * *',
    retention_count: 21,
    cron_lifetime: '0 3 1 * *',
    sources: [
      {
        type: 'mysql-ssh',
        label: 'MySQL via SSH',
        config: {
          sshHost: 'vps-lumen.example.com',
          sshPort: 22,
          sshUser: 'deploy',
          sshPassword: 'fake-ssh-password',
          mysqlHost: '127.0.0.1',
          mysqlPort: 3306,
          mysqlUser: 'brasserie',
          mysqlPassword: 'fake-mysql-password',
          mysqlDatabase: 'brasserie_lumen_prod',
        },
      },
      {
        type: 'ssh-sftp',
        label: 'Uploads — /var/www/lumen',
        config: {
          sshHost: 'vps-lumen.example.com',
          sshPort: 22,
          sshUser: 'deploy',
          sshPassword: 'fake-ssh-password',
          remotePath: '/var/www/lumen/wp-content/uploads',
          useSudo: false,
        },
      },
    ],
  },
  {
    name: 'Studio Calame',
    description: 'Portfolio + back-office Postgres pour studio de design graphique.',
    is_active: 1,
    cron: '0 4 * * *',
    retention_count: 14,
    cron_lifetime: null,
    sources: [
      {
        type: 'postgres-ssh',
        label: 'Postgres via SSH',
        config: {
          sshHost: 'bastion.calame-studio.fr',
          sshPort: 22,
          sshUser: 'studio',
          sshPrivateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nFAKEKEYFAKEKEYFAKEKEY\n-----END OPENSSH PRIVATE KEY-----',
          pgHost: '127.0.0.1',
          pgPort: 5432,
          pgUser: 'calame',
          pgPassword: 'fake-pg-password',
          pgDatabase: 'calame_cms',
        },
      },
    ],
  },
  {
    name: 'Vélo\'lerie de Reims',
    description: 'Petite enseigne de réparation de vélos, base clients sur Turso.',
    is_active: 0,
    cron: '0 5 * * 1',
    retention_count: 8,
    cron_lifetime: null,
    sources: [
      {
        type: 'turso',
        label: 'Turso — clients',
        config: {
          url: 'libsql://velolerie-clients-demo.turso.io',
          authToken: fakeTursoToken(),
        },
      },
    ],
  },
];

// ── insertion ─────────────────────────────────────────────────────────────
const insProject = db.prepare(
  'INSERT INTO projects (name, description, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
);
const insSource = db.prepare(
  'INSERT INTO data_sources (project_id, type, label, config_encrypted, created_at) VALUES (?, ?, ?, ?, ?)',
);
const insSchedule = db.prepare(
  'INSERT INTO backup_schedules (project_id, cron_expression, retention_count, retention_monthly, cron_lifetime, is_active) VALUES (?, ?, ?, ?, ?, ?)',
);
const insBackup = db.prepare(
  'INSERT INTO backups (project_id, type, status, started_at, completed_at, size_bytes, file_path, error_message, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
);
const insAlert = db.prepare(
  'INSERT INTO alerts (project_id, backup_id, type, message, is_read, created_at) VALUES (?, ?, ?, ?, ?, ?)',
);

function lastId() {
  const res = db.exec('SELECT last_insert_rowid() AS id');
  return res[0].values[0][0];
}

const projectIds = {};
for (const p of PROJECTS) {
  const created = isoDaysAgo(60 + Math.floor(Math.random() * 30), 10, 0, 0);
  insProject.run([p.name, p.description, p.is_active, created, created]);
  const pid = lastId();
  projectIds[p.name] = pid;

  for (const src of p.sources) {
    insSource.run([pid, src.type, src.label, encryptJson(src.config), created]);
  }

  insSchedule.run([pid, p.cron, p.retention_count, p.cron_lifetime ? 1 : 0, p.cron_lifetime, p.is_active]);
}

// ── backups ──────────────────────────────────────────────────────────────
// On génère un historique réaliste : ~3 semaines de daily + 1 monthly,
// avec quelques échecs ponctuels pour Brasserie Lumen (alerte non lue),
// et un partial pour Studio Calame.

function slugify(name) {
  return name.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function backupPath(projectName, kind, iso) {
  const slug = slugify(projectName);
  const ts = iso.replace(/[-: ]/g, '').slice(0, 14);
  return `data/backups/${slug}/${kind}/bkp_${slug}_${ts}.zip`;
}

function metaWp(label, dbBytes, fileCount, fileBytes, logs) {
  return JSON.stringify({
    sources: [
      {
        id: 1, label, type: 'wordpress', status: 'success',
        tables: [
          { name: 'wp_options', rowCount: 312 },
          { name: 'wp_posts', rowCount: 1847 },
          { name: 'wp_postmeta', rowCount: 9432 },
          { name: 'wp_comments', rowCount: 264 },
          { name: 'wp_users', rowCount: 7 },
          { name: 'wp_usermeta', rowCount: 35 },
          { name: 'wp_terms', rowCount: 58 },
          { name: 'wp_term_taxonomy', rowCount: 58 },
        ],
        files: fileCount,
        sizeBytes: dbBytes + fileBytes,
      },
    ],
    logs,
    duration: 38_000 + Math.floor(Math.random() * 20_000),
  });
}

function metaTursoBlob(tablesA, tablesB, dbBytes, fileCount, fileBytes, logs) {
  return JSON.stringify({
    sources: [
      { id: 1, label: 'Turso — coop-marais', type: 'turso', status: 'success', tables: tablesA },
      { id: 2, label: 'Vercel Blob — médias', type: 'vercel-blob', status: 'success', files: fileCount, sizeBytes: fileBytes },
    ],
    logs,
    duration: 22_000 + Math.floor(Math.random() * 15_000),
  });
}

function metaMysqlSftp(mysqlBytes, fileCount, fileBytes, logs, opts = {}) {
  return JSON.stringify({
    sources: [
      {
        id: 1, label: 'MySQL via SSH', type: 'mysql-ssh',
        status: opts.mysqlStatus || 'success',
        tables: opts.mysqlError ? undefined : [
          { name: 'wp_options', rowCount: 421 },
          { name: 'wp_posts', rowCount: 1208 },
          { name: 'wp_postmeta', rowCount: 7615 },
          { name: 'wp_woocommerce_orders', rowCount: 894 },
          { name: 'wp_woocommerce_order_itemmeta', rowCount: 3210 },
          { name: 'wp_users', rowCount: 1142 },
          { name: 'wp_usermeta', rowCount: 6890 },
        ],
        error: opts.mysqlError,
      },
      {
        id: 2, label: 'Uploads — /var/www/lumen', type: 'ssh-sftp',
        status: opts.sftpStatus || 'success',
        files: opts.sftpError ? undefined : fileCount,
        sizeBytes: opts.sftpError ? undefined : fileBytes,
        error: opts.sftpError,
      },
    ],
    logs,
    duration: opts.duration || 84_000 + Math.floor(Math.random() * 30_000),
  });
}

function metaPostgres(status, error, logs) {
  return JSON.stringify({
    sources: [
      {
        id: 1, label: 'Postgres via SSH', type: 'postgres-ssh', status,
        tables: status === 'failed' ? undefined : [
          { name: 'public.users', rowCount: 84 },
          { name: 'public.projects', rowCount: 312 },
          { name: 'public.assets', rowCount: 2841 },
          { name: 'public.galleries', rowCount: 76 },
          { name: 'public.gallery_items', rowCount: 1432 },
          { name: 'public.invoices', rowCount: 198 },
        ],
        error,
      },
    ],
    logs,
    duration: 14_000 + Math.floor(Math.random() * 8_000),
  });
}

function metaTursoSingle(label, tables, logs) {
  return JSON.stringify({
    sources: [
      { id: 1, label, type: 'turso', status: 'success', tables },
    ],
    logs,
    duration: 4_500 + Math.floor(Math.random() * 2_500),
  });
}

// Atelier Saint-Roch → 21 daily + 1 monthly, tous OK
{
  const pid = projectIds['Atelier Saint-Roch'];
  for (let i = 21; i >= 1; i--) {
    const started = isoDaysAgo(i, 3, 0, 0);
    const completed = isoMinutesAfter(started, 0, 38 + Math.floor(Math.random() * 25));
    const size = 124_000_000 + Math.floor(Math.random() * 18_000_000); // ~125 Mo
    const fp = backupPath('Atelier Saint-Roch', 'daily', started);
    const meta = metaWp('WordPress prod', 1_240_000, 842 + Math.floor(Math.random() * 30), size - 1_240_000, [
      'Found 12 tables',
      '  wp_options: 312 rows',
      '  wp_posts: 1847 rows',
      'Dumping database... done (1.24 MB)',
      'Uploading files... 842 files, 122 MB',
      'Compressing archive...',
      'OK',
    ]);
    insBackup.run([pid, 'daily', 'success', started, completed, size, fp, null, meta]);
  }
  // monthly
  const mStart = isoDaysAgo(25, 4, 0, 0);
  const mDone = isoMinutesAfter(mStart, 0, 41);
  const mSize = 132_500_000;
  const fp = backupPath('Atelier Saint-Roch', 'monthly', mStart);
  insBackup.run([pid, 'monthly', 'success', mStart, mDone, mSize, fp, null,
    metaWp('WordPress prod', 1_280_000, 851, mSize - 1_280_000, ['Monthly snapshot', 'OK'])]);
}

// Coopérative Marais → 21 daily + 1 monthly, tous OK
{
  const pid = projectIds['Coopérative Marais'];
  const tablesA = [
    { name: 'products', rowCount: 1284 },
    { name: 'producers', rowCount: 74 },
    { name: 'orders', rowCount: 5621 },
    { name: 'order_items', rowCount: 18934 },
    { name: 'customers', rowCount: 3421 },
    { name: 'categories', rowCount: 28 },
  ];
  for (let i = 21; i >= 1; i--) {
    const started = isoDaysAgo(i, 2, 0, 0);
    const completed = isoMinutesAfter(started, 0, 22 + Math.floor(Math.random() * 12));
    const size = 218_000_000 + Math.floor(Math.random() * 25_000_000);
    const fp = backupPath('Coopérative Marais', 'daily', started);
    const meta = metaTursoBlob(tablesA, [], 2_800_000, 1240 + Math.floor(Math.random() * 80), size - 2_800_000, [
      'Found 12 tables',
      'Dumping Turso... 18934 rows in order_items',
      'Listing Vercel Blob...',
      'Downloaded 1240 files (215 MB)',
      'OK',
    ]);
    insBackup.run([pid, 'daily', 'success', started, completed, size, fp, null, meta]);
  }
  const mStart = isoDaysAgo(30, 2, 0, 0);
  const mDone = isoMinutesAfter(mStart, 0, 28);
  const mSize = 224_000_000;
  insBackup.run([pid, 'monthly', 'success', mStart, mDone, mSize,
    backupPath('Coopérative Marais', 'monthly', mStart), null,
    metaTursoBlob(tablesA, [], 2_900_000, 1268, mSize - 2_900_000, ['Monthly snapshot', 'OK'])]);
}

// Brasserie Lumen → 21 daily : 2 échecs récents (cause SSH), 1 partial, reste OK
{
  const pid = projectIds['Brasserie Lumen'];
  for (let i = 21; i >= 1; i--) {
    const started = isoDaysAgo(i, 2, 30, 0);
    let status = 'success';
    let error = null;
    let meta;
    if (i === 1) {
      status = 'failed';
      error = 'SSH connect ECONNREFUSED 51.91.42.87:22 — l\'hôte ne répond pas';
      meta = metaMysqlSftp(0, 0, 0,
        ['Connecting to vps-lumen.example.com...', 'ssh: connect to host vps-lumen.example.com port 22: Connection refused'],
        { mysqlStatus: 'failed', mysqlError: error, sftpStatus: 'failed', sftpError: error, duration: 12_000 },
      );
    } else if (i === 3) {
      status = 'partial';
      meta = metaMysqlSftp(4_200_000, 2218, 318_000_000,
        ['mysqldump OK', 'SFTP started...', 'Timeout on /var/www/lumen/wp-content/uploads/2023/big-files', 'Partial dump'],
        { mysqlStatus: 'success', sftpStatus: 'failed', sftpError: 'Délai dépassé sur la connexion SFTP (timeout après 600s)' },
      );
    } else if (i === 7) {
      status = 'failed';
      error = 'mysqldump returned 2 — Access denied for user \'brasserie\'@\'localhost\'';
      meta = metaMysqlSftp(0, 0, 0,
        ['Connecting via SSH...', 'mysqldump: Got error: 1045 — Access denied'],
        { mysqlStatus: 'failed', mysqlError: error, sftpStatus: 'success', duration: 8_500 },
      );
    } else {
      meta = metaMysqlSftp(4_200_000, 2218 + Math.floor(Math.random() * 30), 318_000_000 + Math.floor(Math.random() * 20_000_000),
        ['mysqldump OK', 'SFTP listing...', 'Downloaded 2218 files', 'OK'],
        {},
      );
    }
    const completed = status === 'failed' ? isoMinutesAfter(started, 0, 8) : isoMinutesAfter(started, 1, 22);
    const size = status === 'failed' ? 0 : (status === 'partial' ? 4_200_000 : 322_000_000 + Math.floor(Math.random() * 22_000_000));
    const fp = status === 'failed' ? null : backupPath('Brasserie Lumen', 'daily', started);
    insBackup.run([pid, 'daily', status, started, completed, size, fp, error, meta]);
  }
  // monthly OK
  const mStart = isoDaysAgo(28, 2, 30, 0);
  const mDone = isoMinutesAfter(mStart, 1, 35);
  insBackup.run([pid, 'monthly', 'success', mStart, mDone, 332_000_000,
    backupPath('Brasserie Lumen', 'monthly', mStart), null,
    metaMysqlSftp(4_350_000, 2241, 327_000_000, ['Monthly snapshot', 'OK'], {})]);
}

// Studio Calame → 14 daily, dont 1 partial il y a 5 jours, reste OK
{
  const pid = projectIds['Studio Calame'];
  for (let i = 14; i >= 1; i--) {
    const started = isoDaysAgo(i, 4, 0, 0);
    let status = 'success';
    let error = null;
    let meta;
    if (i === 5) {
      status = 'partial';
      meta = metaPostgres('partial', 'pg_dump: WARNING: 2 large objects could not be exported', [
        'pg_dump started',
        'WARNING: 2 large objects could not be exported',
        'Dump terminated with warnings',
      ]);
    } else {
      meta = metaPostgres('success', null, [
        'pg_dump started',
        'public.users: 84 rows',
        'public.assets: 2841 rows',
        'Dump complete (8.4 MB)',
      ]);
    }
    const completed = isoMinutesAfter(started, 0, 14 + Math.floor(Math.random() * 6));
    const size = 8_300_000 + Math.floor(Math.random() * 800_000);
    const fp = backupPath('Studio Calame', 'daily', started);
    insBackup.run([pid, 'daily', status, started, completed, size, fp, error, meta]);
  }
}

// Vélo'lerie → projet inactif, 4 backups il y a longtemps
{
  const pid = projectIds["Vélo'lerie de Reims"];
  const tables = [
    { name: 'customers', rowCount: 412 },
    { name: 'repairs', rowCount: 1098 },
    { name: 'bikes', rowCount: 384 },
    { name: 'invoices', rowCount: 920 },
  ];
  for (let i = 4; i >= 1; i--) {
    const started = isoDaysAgo(28 + i * 7, 5, 0, 0);
    const completed = isoMinutesAfter(started, 0, 5);
    const size = 1_200_000 + Math.floor(Math.random() * 200_000);
    insBackup.run([pid, 'daily', 'success', started, completed, size,
      backupPath("Vélo'lerie de Reims", 'daily', started), null,
      metaTursoSingle('Turso — clients', tables, ['Found 4 tables', 'Dumping... OK', 'Total: 1.2 MB'])]);
  }
}

// ── alertes ───────────────────────────────────────────────────────────────
// 2 alertes non lues (les deux échecs Brasserie Lumen), 1 alerte lue (partial)
{
  const pid = projectIds['Brasserie Lumen'];
  // Récupère l'id du backup failed i=1
  const failedRow = db.exec(
    `SELECT id, started_at FROM backups WHERE project_id = ${pid} AND status = 'failed' ORDER BY started_at DESC`,
  )[0];
  const partialRow = db.exec(
    `SELECT id, started_at FROM backups WHERE project_id = ${pid} AND status = 'partial' ORDER BY started_at DESC LIMIT 1`,
  )[0];

  // Alerte la plus récente : non lue
  if (failedRow && failedRow.values[0]) {
    const [bid, sAt] = failedRow.values[0];
    insAlert.run([pid, bid, 'failure',
      'Échec du backup « Brasserie Lumen » : SSH connect ECONNREFUSED 51.91.42.87:22 — l\'hôte ne répond pas.',
      0, sAt]);
  }
  // Alerte plus ancienne : lue
  if (failedRow && failedRow.values[1]) {
    const [bid, sAt] = failedRow.values[1];
    insAlert.run([pid, bid, 'failure',
      'Échec du backup « Brasserie Lumen » : mysqldump returned 2 — Access denied for user \'brasserie\'@\'localhost\'.',
      1, sAt]);
  }
  // Partial : non lue
  if (partialRow && partialRow.values[0]) {
    const [bid, sAt] = partialRow.values[0];
    insAlert.run([pid, bid, 'failure',
      'Backup partiel pour « Brasserie Lumen » : la source SFTP a expiré après 600s, la base MySQL a été sauvegardée.',
      0, sAt]);
  }
}

// Studio Calame partial — alerte non lue plus ancienne
{
  const pid = projectIds['Studio Calame'];
  const partial = db.exec(
    `SELECT id, started_at FROM backups WHERE project_id = ${pid} AND status = 'partial' LIMIT 1`,
  )[0];
  if (partial && partial.values[0]) {
    const [bid, sAt] = partial.values[0];
    insAlert.run([pid, bid, 'failure',
      'Backup partiel pour « Studio Calame » : pg_dump a émis 2 avertissements sur les large objects.',
      0, sAt]);
  }
}

// ── écriture sur disque ───────────────────────────────────────────────────
const buf = db.export();
writeFileSync(DB_PATH, Buffer.from(buf));
db.close();
console.log(`[seed] BDD démo écrite -> ${DB_PATH}`);
console.log('[seed]   projets:', PROJECTS.length);
console.log('[seed]   sources:', PROJECTS.reduce((n, p) => n + p.sources.length, 0));
