// One-command project setup. Node is a prerequisite (a setup script can't install the
// runtime it runs on), so this validates the version and then does the deterministic rest:
// dependencies, a .env to fill in, and — on request — the Playwright browser.
//
// Usage:
//   npm run setup            # prompts before installing the UI browser
//   npm run setup -- --ui    # install the browser without prompting
//   npm run setup -- --no-ui # skip the browser without prompting (CI-friendly)

import { spawnSync } from 'node:child_process';
import { existsSync, copyFileSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const MIN_NODE = { major: 22, minor: 15 };
const isWindows = process.platform === 'win32';
const npm = isWindows ? 'npm.cmd' : 'npm';
const npx = isWindows ? 'npx.cmd' : 'npx';

const args = process.argv.slice(2);
const wantsUi = args.includes('--ui');
const skipsUi = args.includes('--no-ui');

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

function run(command, commandArgs, extraEnv = {}) {
  const result = spawnSync(command, commandArgs, {
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
  });
  if (result.status !== 0) {
    fail(`\`${command} ${commandArgs.join(' ')}\` failed with exit code ${result.status}.`);
  }
}

function checkNode() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  const tooOld = major < MIN_NODE.major || (major === MIN_NODE.major && minor < MIN_NODE.minor);
  if (tooOld) {
    fail(
      `Node ${MIN_NODE.major}.${MIN_NODE.minor} or newer is required (found ${process.versions.node}). ` +
        `The test scripts use --use-system-ca, added in ${MIN_NODE.major}.${MIN_NODE.minor}. ` +
        `Install a newer Node and re-run \`npm run setup\`.`,
    );
  }
  console.log(`✓ Node ${process.versions.node}`);
}

function installDependencies() {
  console.log('\n→ Installing dependencies (npm install)…');
  run(npm, ['install']);
}

function ensureEnvFile() {
  if (existsSync('.env')) {
    const hasPat = /^KONNECT_PAT=.+/m.test(readFileSync('.env', 'utf8'));
    console.log(hasPat ? '✓ .env present, KONNECT_PAT set' : '! .env present, but KONNECT_PAT is empty — fill it in');
    return;
  }
  if (!existsSync('.env.example')) fail('.env.example is missing, cannot create .env.');
  copyFileSync('.env.example', '.env');
  console.log('✓ Created .env from .env.example — fill in KONNECT_PAT before running the tests');
}

function installBrowser() {
  console.log('\n→ Installing the Playwright browser (chromium)…');
  run(npx, ['playwright', 'install', 'chromium'], { NODE_OPTIONS: '--use-system-ca' });
}

async function maybeInstallBrowser() {
  if (skipsUi) {
    console.log('\n! Skipping the UI browser. Install it later with: npx playwright install chromium');
    return;
  }
  if (wantsUi) {
    installBrowser();
    return;
  }
  if (!stdin.isTTY) {
    console.log(
      '\n! Non-interactive shell: skipping the UI browser. ' +
        'Run `npm run setup -- --ui`, or `npx playwright install chromium`, when you need it.',
    );
    return;
  }

  const rl = createInterface({ input: stdin, output: stdout });
  const answer = (await rl.question('\nInstall the Playwright browser for the UI login test now? (y/N) ')).trim().toLowerCase();
  rl.close();

  if (answer === 'y' || answer === 'yes') {
    installBrowser();
  } else {
    console.log('! Skipped. Install it later with: npx playwright install chromium');
  }
}

function printNextSteps() {
  console.log('\nSetup complete. Next steps:');
  console.log('  1. Put your Konnect token in .env (KONNECT_PAT=…)');
  console.log('  2. npm test            # the API suite');
  console.log('  3. npm run test:ui     # UI login (needs the browser above + KONNECT_USERNAME/PASSWORD)');
  console.log('  4. npm run load        # k6 smoke run (needs k6: brew install k6)');
}

async function main() {
  console.log('Konnect API Catalog tests — setup\n');
  checkNode();
  installDependencies();
  ensureEnvFile();
  await maybeInstallBrowser();
  printNextSteps();
}

main().catch((error) => fail(error?.message ?? String(error)));
