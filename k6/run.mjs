// Runs the k6 scenario with the same .env the Playwright suite uses, so there is only
// one place to configure credentials. Extra arguments are passed through to k6.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config();

if (!process.env.KONNECT_PAT) {
  console.error('KONNECT_PAT is not set. Copy .env.example to .env and add a Konnect personal access token.');
  process.exit(1);
}

// Run from the k6 directory and pass a bare filename, so a workspace path containing
// spaces doesn't need quoting on Windows.
const result = spawnSync('k6', ['run', 'api-catalog.js', ...process.argv.slice(2)], {
  cwd: fileURLToPath(new URL('.', import.meta.url)),
  stdio: 'inherit',
  env: process.env,
  shell: process.platform === 'win32',
});

if (result.error) {
  console.error('Could not start k6. Install it from https://grafana.com/docs/k6/latest/set-up/install-k6/');
  process.exit(1);
}

process.exit(result.status ?? 1);
