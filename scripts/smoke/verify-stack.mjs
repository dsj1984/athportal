#!/usr/bin/env node
// scripts/smoke/verify-stack.mjs
//
// Smoke runner for the local-dev stack. Boots in CI between contract and
// acceptance; runs locally against an already-running `pnpm dev` for a
// faster operator inner loop.
//
// What this is. A short allowlist of URLs hit through the Astro origin
// (`:4321` by default, which proxies `/api/*` to the Hono API on
// `:8787`). For each URL we assert the response status against an
// expected value. After the probes complete, we optionally scan one or
// more captured log files for forbidden substrings — a 200 response
// alongside a `500` or `TypeError` in the API log is still a regression
// (Story #943 F2).
//
// What this is NOT. Not a browser-driven E2E. No DOM, no client-side
// JS, no sign-in flow, no DB-state assertions. Those live at the
// acceptance and contract tiers respectively (per
// `docs/testing-strategy.md` and `.agents/rules/testing-standards.md`).
//
// Exit codes:
//   0 — every probe matched its expected status and no log scan tripped.
//   1 — one or more probes mismatched, or a log scan found a forbidden
//       substring during the probe window.
//   2 — usage / bootstrap error (couldn't reach the base URL at all).
//
// CLI:
//   node scripts/smoke/verify-stack.mjs
//     [--base <url>]           Base URL (default: http://localhost:4321)
//     [--log <path> ...]       Server log file to scan after probes
//                              (repeatable; safe to omit when running
//                              against an interactive `pnpm dev` whose
//                              logs are streaming to the operator's
//                              terminal).
//     [--allowlist <path>]     Override the URL allowlist JSON path.
//                              Defaults to the in-repo allowlist
//                              colocated at
//                              `scripts/smoke/allowlist.json`.
//     [--help]                 Print usage and exit 0.
//
// The default allowlist matches Story #943 F1 § Allowlist of URLs to
// ping; the JSON file is the single source of truth so reviewers can
// see the contract in one place without parsing the script.

import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Substrings that, when present in a captured server log emitted DURING
 * the probe window, mark the run as red even if every probe matched its
 * expected status. The list comes from Story #943 F2.
 *
 * Match is case-sensitive and substring-only — we trust the runtime to
 * spell these consistently. The leading/trailing spaces around ` 500 `
 * are deliberate: they prevent matching `5000` or `500ms`.
 */
const FORBIDDEN_LOG_SUBSTRINGS = ['TypeError', 'at async', ' 500 ', 'Internal Server Error'];

function printUsage() {
  process.stdout.write(
    [
      'verify-stack — smoke runner for the local-dev stack',
      '',
      'Usage:',
      '  node scripts/smoke/verify-stack.mjs [options]',
      '',
      'Options:',
      '  --base <url>         Base URL (default: http://localhost:4321)',
      '  --log <path>         Server log file to scan (repeatable)',
      '  --allowlist <path>   Override the URL-allowlist JSON path',
      '  --help               Print this message and exit 0',
      '',
    ].join('\n'),
  );
}

function parseArgs(argv) {
  const args = {
    base: 'http://localhost:4321',
    logs: [],
    allowlist: join(__dirname, 'allowlist.json'),
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--base') {
      args.base = argv[++i] ?? args.base;
    } else if (arg === '--log') {
      const value = argv[++i];
      if (value) args.logs.push(value);
    } else if (arg === '--allowlist') {
      args.allowlist = argv[++i] ?? args.allowlist;
    } else if (arg.startsWith('--')) {
      throw new Error(`verify-stack: unknown flag ${arg}`);
    }
  }
  // Normalise: strip trailing slash so URL composition stays simple.
  args.base = args.base.replace(/\/+$/, '');
  // Resolve allowlist path relative to cwd if not absolute.
  if (!isAbsolute(args.allowlist)) {
    args.allowlist = resolvePath(process.cwd(), args.allowlist);
  }
  return args;
}

/**
 * Decide whether an allowlist entry should run. Returns a sentinel
 * skip reason when the entry declares `requireEnv` and any named env
 * var is missing or empty. Used for entries like
 * `/dev/sign-in-as/coach` that need an operator-owned secret CI may
 * not have (e.g. fork-PR runs without `CLERK_SECRET_KEY`).
 */
function shouldSkipEntry(entry) {
  const requireEnv = Array.isArray(entry.requireEnv) ? entry.requireEnv : [];
  for (const name of requireEnv) {
    const value = process.env[name];
    if (value === undefined || value.length === 0) {
      return `env ${name} unset`;
    }
  }
  return null;
}

/**
 * Probe one URL. We do NOT follow redirects on the primary request — the
 * allowlist's `expectedStatus` is the FIRST response. A `302` that gets
 * followed to a `200` would silently hide a misrouted redirect target.
 *
 * When the entry declares `assertBodyContains`, a second redirect-following
 * fetch is issued to check that the final landed page contains the configured
 * substring. This closes the sign-in-seam blind spot: a 302 alone only means
 * the server answered; the body assertion confirms the DB seed's
 * `clerk_subject_id` resolved to the expected persona page (Story #1008).
 */
export async function probe(baseUrl, entry) {
  const url = `${baseUrl}${entry.path}`;
  let response;
  try {
    response = await fetch(url, {
      method: entry.method ?? 'GET',
      redirect: 'manual',
      // Hint to the server that this is a non-browser probe. The web
      // origin's middleware should treat us like any anonymous fetch.
      headers: { 'user-agent': 'verify-stack/1.0 (Story-#943 smoke)' },
    });
  } catch (cause) {
    return {
      entry,
      url,
      ok: false,
      status: null,
      detail: `network error: ${cause?.message ?? cause}`,
    };
  }
  const expected = entry.expectedStatus;
  const statusOk = response.status === expected;
  if (!statusOk) {
    return {
      entry,
      url,
      ok: false,
      status: response.status,
      detail: `expected ${expected}, got ${response.status}`,
    };
  }

  // Optional body assertion — only runs when the entry declares
  // `assertBodyContains`. Issues a separate redirect-following fetch so
  // the status check and the body check are independent and each can
  // fail with a precise diagnostic.
  const bodyNeedle =
    typeof entry.assertBodyContains === 'string' ? entry.assertBodyContains : null;
  if (bodyNeedle !== null) {
    let bodyResponse;
    try {
      bodyResponse = await fetch(url, {
        method: entry.method ?? 'GET',
        redirect: 'follow',
        headers: { 'user-agent': 'verify-stack/1.0 (Story-#943 smoke)' },
      });
    } catch (cause) {
      return {
        entry,
        url,
        ok: false,
        status: response.status,
        detail: `assertBodyContains fetch error: ${cause?.message ?? cause}`,
      };
    }
    let body;
    try {
      body = await bodyResponse.text();
    } catch (cause) {
      return {
        entry,
        url,
        ok: false,
        status: response.status,
        detail: `assertBodyContains body read error: ${cause?.message ?? cause}`,
      };
    }
    if (!body.includes(bodyNeedle)) {
      return {
        entry,
        url,
        ok: false,
        status: response.status,
        detail: `assertBodyContains failed: body does not contain ${JSON.stringify(bodyNeedle)}`,
      };
    }
  }

  // Optional Location-header assertion — for redirect responses where following
  // the redirect is not feasible (e.g. Clerk ticket exchanges that require
  // browser-side JS). Checks that the `Location` header of the primary
  // (non-following) response contains the configured substring. This is the
  // correct gate for the `/dev/sign-in-as/coach` seam: a `302` whose Location
  // contains `__clerk_ticket=` proves Clerk accepted the persona's user ID.
  const locationNeedle =
    typeof entry.assertLocationContains === 'string' ? entry.assertLocationContains : null;
  if (locationNeedle !== null) {
    const location = response.headers.get('location') ?? '';
    if (!location.includes(locationNeedle)) {
      return {
        entry,
        url,
        ok: false,
        status: response.status,
        detail: `assertLocationContains failed: Location header ${JSON.stringify(location)} does not contain ${JSON.stringify(locationNeedle)}`,
      };
    }
  }

  return {
    entry,
    url,
    ok: true,
    status: response.status,
    detail: null,
  };
}

/**
 * Scan a single log file for any forbidden substring. Reads the whole
 * file (these are short-lived dev-server logs, not GB-scale audit
 * trails) and returns the first match per substring. Returning the
 * *first* match keeps the failure summary compact while still giving
 * the operator a grep anchor.
 */
function scanLogFile(logPath) {
  let contents;
  try {
    contents = readFileSync(logPath, 'utf8');
  } catch (cause) {
    return {
      logPath,
      readError: cause?.message ?? String(cause),
      matches: [],
    };
  }
  const matches = [];
  for (const needle of FORBIDDEN_LOG_SUBSTRINGS) {
    const idx = contents.indexOf(needle);
    if (idx !== -1) {
      // Compute a tiny excerpt so the operator can see context without
      // dumping the whole log into the job summary.
      const start = Math.max(0, idx - 80);
      const end = Math.min(contents.length, idx + needle.length + 80);
      matches.push({
        needle,
        offset: idx,
        excerpt: contents.slice(start, end).replace(/\s+/g, ' ').trim(),
      });
    }
  }
  return { logPath, readError: null, matches };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return 0;
  }

  let allowlist;
  try {
    const raw = JSON.parse(readFileSync(args.allowlist, 'utf8'));
    if (!Array.isArray(raw)) {
      throw new Error('allowlist must be a JSON array of probe entries');
    }
    allowlist = raw;
  } catch (cause) {
    process.stderr.write(
      `verify-stack: cannot load allowlist ${args.allowlist}: ${cause?.message ?? cause}\n`,
    );
    return 2;
  }

  process.stdout.write(`[verify-stack] base=${args.base} probes=${allowlist.length}\n`);

  const probeStartedAt = Date.now();
  const results = [];
  let skippedCount = 0;
  for (const entry of allowlist) {
    const skipReason = shouldSkipEntry(entry);
    if (skipReason !== null) {
      skippedCount += 1;
      process.stdout.write(
        `  [skip] ${entry.method ?? 'GET'} ${entry.path.padEnd(60, ' ')} (${skipReason})\n`,
      );
      continue;
    }
    const result = await probe(args.base, entry);
    results.push(result);
    const tag = result.ok ? 'pass' : 'FAIL';
    const statusStr = result.status === null ? '---' : String(result.status);
    const note = result.detail ? `  ${result.detail}` : '';
    process.stdout.write(
      `  [${tag}] ${entry.method ?? 'GET'} ${entry.path.padEnd(60, ' ')} ${statusStr}${note}\n`,
    );
  }
  const probeDurationMs = Date.now() - probeStartedAt;

  const probeFailures = results.filter((r) => !r.ok);

  // Log scan runs even if probes failed — operators want both signals
  // in the same report. Order: probes first, then logs.
  const logScans = args.logs.map(scanLogFile);
  const logFailures = logScans.filter((s) => s.readError === null && s.matches.length > 0);
  const logReadErrors = logScans.filter((s) => s.readError !== null);

  if (logScans.length > 0) {
    process.stdout.write(`[verify-stack] log scans (${logScans.length}):\n`);
    for (const scan of logScans) {
      if (scan.readError) {
        process.stdout.write(`  [warn] ${scan.logPath}: ${scan.readError}\n`);
        continue;
      }
      if (scan.matches.length === 0) {
        process.stdout.write(`  [pass] ${scan.logPath}: no forbidden substrings\n`);
        continue;
      }
      process.stdout.write(`  [FAIL] ${scan.logPath}: ${scan.matches.length} match(es)\n`);
      for (const match of scan.matches) {
        process.stdout.write(
          `    - '${match.needle}' @ offset ${match.offset}: …${match.excerpt}…\n`,
        );
      }
    }
  }

  const overallOk =
    probeFailures.length === 0 && logFailures.length === 0 && logReadErrors.length === 0;

  process.stdout.write(
    `[verify-stack] summary: probes ${results.length - probeFailures.length}/${results.length} passed` +
      (skippedCount > 0 ? ` (${skippedCount} skipped)` : '') +
      `, log scans ${logScans.length - logFailures.length}/${logScans.length} passed ` +
      `(duration ${probeDurationMs}ms)\n`,
  );

  return overallOk ? 0 : 1;
}

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((err) => {
    process.stderr.write(`[verify-stack] fatal: ${err?.stack ?? err}\n`);
    process.exit(2);
  });
