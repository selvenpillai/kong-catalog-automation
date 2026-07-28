// Claude Code Stop hook. Once per session, if the working tree has code changes that
// README.md does not, it asks the agent to check whether the README is still accurate.
//
// It reports; it never edits. Auto-writing documentation produces churn rather than docs,
// and a human reading the diff is the point of the README existing at all.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DOCS = ['README.md'];

const CODE = [
  /^src\//,
  /^tests\//,
  /^k6\//,
  /^\.claude\/skills\//,
  /^\.github\/workflows\//,
  /^package\.json$/,
];

// Anything unexpected here is a reason to stay out of the way, not to fail the turn.
function bail() {
  process.exit(0);
}

// Deliberately untrimmed: porcelain status columns are significant, and an unstaged
// change starts with a space that trimming would eat, shifting every path by one.
function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

let input;
try {
  input = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  bail();
}

// Claude Code sets this when it is already continuing because of a stop hook. Without the
// guard the hook can hold a turn open until the eight-block cap ends it.
if (input.stop_hook_active) bail();

const root = git(['rev-parse', '--show-toplevel']).trim();
if (!root) bail();

// One nudge per session. Repeating it every turn would train the reader to ignore it.
const marker = join(tmpdir(), `readme-drift-${input.session_id ?? 'unknown'}`);
if (existsSync(marker)) bail();

const changed = git(['-C', root, 'status', '--porcelain'])
  .split('\n')
  .map((line) => /^..\s(.+)$/.exec(line)?.[1]?.trim())
  .filter(Boolean)
  // A rename reads "old -> new", and any path containing a space is quoted.
  .map((path) => path.split(' -> ').pop().replace(/^"|"$/g, ''));

const code = changed.filter((path) => CODE.some((pattern) => pattern.test(path)));
const docsTouched = changed.some((path) => DOCS.includes(path));

if (code.length === 0 || docsTouched) bail();

try {
  writeFileSync(marker, '');
} catch {
  // A missing marker only costs a repeated nudge, so carry on.
}

const listed = code.slice(0, 8).join(', ');
const more = code.length > 8 ? ` and ${code.length - 8} more` : '';

console.log(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'Stop',
      additionalContext:
        `README.md is unchanged, but these are: ${listed}${more}. ` +
        'Check whether the README still describes the project accurately. The sections that ' +
        'go stale first are "What the tests cover", the scripts list and the layout tree. ' +
        'If it is already accurate, say so and finish. Do not edit it just to satisfy this check.',
    },
  }),
);
