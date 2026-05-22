#!/usr/bin/env node
// ----------------------------------------------------------------------------
// scripts/kill-port.mjs
//
// Tue tous les processus qui écoutent sur les ports donnés.
// Cross-platform : Windows (netstat), macOS / Linux (lsof).
//
// Usage :
//   node scripts/kill-port.mjs              # tue les ports Sentinel (8081, 8082)
//   node scripts/kill-port.mjs 3000         # tue le port 3000
//   node scripts/kill-port.mjs 8081 8082    # tue plusieurs ports
//   PORTS=8081,8082 node scripts/kill-port.mjs
//
// Branché en `predev`/`prestart` dans package.json pour éviter les zombies qui
// monopolisent les ports après un Ctrl+C mal interprété sous Windows (ou un
// autre projet qui écoute par hasard sur le même port).
// ----------------------------------------------------------------------------
import { execSync } from 'node:child_process';
import process from 'node:process';

const DEFAULT_PORTS = [8081, 8082];

function parsePorts() {
  const fromArgs = process.argv.slice(2);
  const fromEnv = (process.env.PORTS || process.env.PORT || '').split(',').filter(Boolean);
  const raw = fromArgs.length > 0 ? fromArgs : fromEnv;
  const parsed = raw
    .map((s) => Number(String(s).trim()))
    .filter((n) => Number.isFinite(n) && n > 0 && n < 65536);
  return parsed.length > 0 ? parsed : DEFAULT_PORTS;
}

const ports = parsePorts();
const isWin = process.platform === 'win32';

function findPids(targetPort) {
  const pids = new Set();
  try {
    if (isWin) {
      // netstat -ano renvoie une ligne par socket, dernière col = PID.
      // Pas de filtre `-p tcp` : sinon on rate les sockets IPv6 ([::]:PORT),
      // ce qui laisse un Vite/Node zombi en IPv6 monopoliser le port.
      const out = execSync(`netstat -ano`, { encoding: 'utf8' });
      const re = new RegExp(
        String.raw`^\s*TCP\s+\S*:${targetPort}\s+\S+\s+LISTENING\s+(\d+)\s*$`,
        'gm',
      );
      let m;
      while ((m = re.exec(out)) !== null) {
        const pid = Number(m[1]);
        if (Number.isFinite(pid) && pid > 0) pids.add(pid);
      }
    } else {
      // lsof -t -i :PORT -sTCP:LISTEN renvoie un PID par ligne
      const out = execSync(`lsof -tiTCP:${targetPort} -sTCP:LISTEN`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      out
        .split(/\s+/)
        .map((s) => Number(s))
        .filter((n) => Number.isFinite(n) && n > 0)
        .forEach((p) => pids.add(p));
    }
  } catch {
    // Aucun process à killer : c'est OK
  }
  return [...pids];
}

function killPid(pid) {
  try {
    if (isWin) {
      execSync(`taskkill /PID ${pid} /F /T`, { stdio: 'ignore' });
    } else {
      execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
    }
    return true;
  } catch {
    return false;
  }
}

let totalKilled = 0;
let totalFound = 0;
for (const port of ports) {
  const pids = findPids(port);
  if (pids.length === 0) {
    console.log(`✅ [kill-port] Port ${port} déjà libre`);
    continue;
  }
  totalFound += pids.length;
  console.log(`🔪 [kill-port] Port ${port} occupé par ${pids.length} processus → ${pids.join(', ')}`);
  for (const pid of pids) {
    if (killPid(pid)) {
      console.log(`   ✓ PID ${pid} tué`);
      totalKilled += 1;
    } else {
      console.log(`   ✗ PID ${pid} : impossible à tuer (déjà mort ?)`);
    }
  }
}

if (totalFound > 0) {
  console.log(`✅ [kill-port] ${totalKilled}/${totalFound} processus tués sur ${ports.join(', ')}`);
}
process.exit(0);
