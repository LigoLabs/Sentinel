import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

const PORTS = [8081, 8082];
const isWindows = process.platform === 'win32';

async function killPidWindows(pid) {
  await execAsync(`taskkill /PID ${pid} /F`).catch(() => {});
}

async function killPidPosix(pid) {
  await execAsync(`kill -9 ${pid}`).catch(() => {});
}

async function killPort(port) {
  try {
    if (isWindows) {
      const { stdout } = await execAsync(`netstat -ano | findstr :${port}`).catch(() => ({ stdout: '' }));
      if (!stdout) {
        console.log(`  Port ${port} libre`);
        return;
      }
      const pids = new Set();
      for (const line of stdout.trim().split('\n')) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && /^\d+$/.test(pid) && pid !== '0') pids.add(pid);
      }
      for (const pid of pids) {
        await killPidWindows(pid);
        console.log(`  Port ${port} - processus ${pid} arrêté`);
      }
      if (pids.size === 0) console.log(`  Port ${port} libre`);
    } else {
      const { stdout } = await execAsync(`lsof -ti:${port}`).catch(() => ({ stdout: '' }));
      const pids = stdout.trim().split('\n').filter((p) => /^\d+$/.test(p));
      if (pids.length === 0) {
        console.log(`  Port ${port} libre`);
        return;
      }
      for (const pid of pids) {
        await killPidPosix(pid);
        console.log(`  Port ${port} - processus ${pid} arrêté`);
      }
    }
  } catch {
    console.log(`  Port ${port} libre`);
  }
}

console.log('Nettoyage des ports...');
for (const port of PORTS) {
  await killPort(port);
}
console.log('OK\n');
