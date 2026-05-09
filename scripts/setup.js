import { copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const envPath = join(rootDir, '.env');
const examplePath = join(rootDir, '.env.example');

console.log('\n  Sentinel - Setup\n');

if (!existsSync(envPath)) {
  if (!existsSync(examplePath)) {
    console.error('  .env.example not found');
    process.exit(1);
  }
  copyFileSync(examplePath, envPath);
  console.log('  .env created from .env.example');
} else {
  console.log('  .env already exists, skipping');
}

console.log('\n  Setup done.');
console.log('  JWT_SECRET and ENCRYPTION_KEY will be auto-generated on first server boot.');
console.log('  Start the server with: npm run dev\n');
