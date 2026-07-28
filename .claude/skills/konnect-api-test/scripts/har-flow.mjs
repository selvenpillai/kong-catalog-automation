// Summarises the Konnect API calls in a HAR capture, so a recorded console session can
// be read as a sequence of requests instead of scrolled through by hand.
//
//   node har-flow.mjs <capture.har>              every API call
//   node har-flow.mjs <capture.har> --mutations  only the calls that change state
//   node har-flow.mjs <capture.har> --bodies     include request and response bodies
//
// Spec payloads are summarised rather than printed, and anything that looks like a
// credential is reported at the end instead of echoed.
import { readFileSync } from 'node:fs';

const [file, ...flags] = process.argv.slice(2);

if (!file) {
  console.error('Usage: node har-flow.mjs <capture.har> [--mutations] [--bodies]');
  process.exit(1);
}

const mutationsOnly = flags.includes('--mutations');
const showBodies = flags.includes('--bodies');

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const SECRETS = [
  [/kpat_[A-Za-z0-9]+/g, 'personal access token'],
  [/"password"\s*:\s*"[^"]+"/gi, 'password'],
  [/eyJ[A-Za-z0-9_-]{20,}\./g, 'JWT'],
];

const har = JSON.parse(readFileSync(file, 'utf8'));

const calls = har.log.entries
  .filter((e) => {
    const url = new URL(e.request.url);
    if (e.request.method === 'OPTIONS') return false; // CORS preflight, never interesting
    return url.hostname.includes('api.konghq.com') && url.pathname.startsWith('/v');
  })
  .filter((e) => !mutationsOnly || e.request.method !== 'GET')
  .map((e) => ({
    method: e.request.method,
    path: new URL(e.request.url).pathname + (new URL(e.request.url).search || ''),
    status: e.response.status,
    requestBody: e.request.postData?.text,
    responseBody: e.response.content?.text,
  }));

if (calls.length === 0) {
  console.log('No Konnect API calls found. Was the capture taken with the network tab open?');
  process.exit(0);
}

// A spec is tens of kilobytes of noise in a flow summary; its version label is the part
// that matters, because Konnect derives the version from it.
function summarise(text) {
  if (!text) return undefined;

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text.length > 200 ? `${text.slice(0, 200)}...` : text;
  }

  const shrink = (value) => {
    if (typeof value === 'string' && value.length > 400) {
      let version;
      try {
        version = JSON.parse(value).info?.version;
      } catch {
        // not a nested document, just long
      }
      return version ? `<spec, ${value.length} bytes, info.version=${version}>` : `<${value.length} bytes>`;
    }
    if (Array.isArray(value)) return value.map(shrink);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shrink(v)]));
    }
    return value;
  };

  const out = JSON.stringify(shrink(parsed));
  return out.length > 600 ? `${out.slice(0, 600)}...` : out;
}

console.log(`${calls.length} Konnect API call(s) in ${file}\n`);

calls.forEach((call, i) => {
  const n = String(i + 1).padStart(3);
  console.log(`${n}  ${call.method.padEnd(6)} ${call.path.replace(UUID, '{id}').padEnd(52)} ${call.status}`);

  if (!showBodies) return;
  const req = summarise(call.requestBody);
  const res = summarise(call.responseBody);
  if (req) console.log(`       -> ${req}`);
  if (res) console.log(`       <- ${res}`);
  console.log();
});

const raw = JSON.stringify(har.log.entries);
const found = SECRETS.filter(([pattern]) => pattern.test(raw)).map(([, label]) => label);

if (found.length > 0) {
  console.log(`\nThis capture contains: ${found.join(', ')}. Keep it out of version control.`);
}
