// Refuses to let credentials into the repository.
//
//   node scripts/scan-secrets.mjs          staged changes, used by the pre-commit hook
//   node scripts/scan-secrets.mjs --all    every tracked file, used by CI
//
// This exists because the HAR captures in hars/ hold the account password and a personal
// access token in plaintext. .gitignore covers them, but `git add -f` doesn't care and
// neither does an edit to .gitignore, so the guard is here rather than only there.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const scanAll = process.argv.includes('--all');

// Paths that should never be committed, whatever is in them.
const FORBIDDEN_PATHS = [
  { pattern: /(^|\/)hars\//, why: 'HAR captures record session tokens and form fields' },
  { pattern: /\.har$/i, why: 'HAR captures record session tokens and form fields' },
  { pattern: /(^|\/)\.env$/, why: 'holds live credentials; commit .env.example instead' },
  { pattern: /(^|\/)\.env\.(?!example)[^/]+$/, why: 'holds live credentials' },
];

// Content that looks like a credential wherever it appears.
const SECRETS = [
  { pattern: /kpat_[A-Za-z0-9]{20,}/, why: 'Konnect personal access token' },
  { pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./, why: 'JSON web token' },
  { pattern: /Bearer\s+[A-Za-z0-9._~+/-]{20,}={0,2}/, why: 'bearer token' },
  { pattern: /"password"\s*:\s*"[^"]+"/i, why: 'password in a JSON body' },
  { pattern: /AKIA[0-9A-Z]{16}/, why: 'AWS access key id' },
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, why: 'private key' },
];

function git(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

function stagedPaths() {
  return git(['diff', '--cached', '--name-only', '--diff-filter=ACM']).split('\n').filter(Boolean);
}

function trackedPaths() {
  return git(['ls-files']).split('\n').filter(Boolean);
}

function contentOf(path) {
  try {
    // The staged scan reads the index, so it sees exactly what would be committed rather
    // than the working copy. --all runs on a fresh checkout where the two agree, and
    // reading the file avoids depending on HEAD existing.
    return scanAll ? readFileSync(path, 'utf8') : git(['show', `:${path}`]);
  } catch {
    return '';
  }
}

const paths = scanAll ? trackedPaths() : stagedPaths();
const findings = [];

for (const path of paths) {
  const forbidden = FORBIDDEN_PATHS.find((rule) => rule.pattern.test(path));
  if (forbidden) {
    findings.push({ path, detail: forbidden.why });
    continue;
  }

  const content = contentOf(path);
  // Anything with a null byte is binary, and a 5 MB source file is not worth scanning.
  if (!content || content.includes('\0') || content.length > 5_000_000) continue;

  const lines = content.split('\n');
  for (const secret of SECRETS) {
    const index = lines.findIndex((line) => secret.pattern.test(line));
    if (index !== -1) {
      findings.push({ path, detail: `${secret.why} on line ${index + 1}` });
    }
  }
}

if (findings.length === 0) {
  if (scanAll) console.log(`No credentials found in ${paths.length} tracked files.`);
  process.exit(0);
}

const scope = scanAll ? 'tracked files' : 'staged changes';
console.error(`\nRefusing to continue: possible credentials in ${scope}.\n`);
for (const { path, detail } of findings) {
  console.error(`  ${path}\n      ${detail}`);
}
console.error(
  scanAll
    ? '\nUntrack the file (git rm --cached <path>) or redact the value.\n'
    : '\nUnstage the file (git restore --staged <path>) or redact the value.' +
        '\nIf this is genuinely a false positive, commit with --no-verify and say why in the message.\n',
);

process.exit(1);
