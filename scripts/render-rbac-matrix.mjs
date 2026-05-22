#!/usr/bin/env node
// scripts/render-rbac-matrix.mjs
//
// Renders the RBAC rules table from packages/shared/src/rbac/rules.ts into
// docs/data-dictionary.md, replacing the content between the sentinel
// comments:
//
//   <!-- rbac-matrix:start -->
//   ...generated table...
//   <!-- rbac-matrix:end -->
//
// Story #616 (Epic #9) — "Publish RBAC matrix into the data dictionary".
//
// The rules table lives in TypeScript; rather than spinning up a TS loader
// from this Node script, we parse the deterministic `rule(...)` call sites
// out of the source text. The shape is stable by design (see
// packages/shared/src/rbac/rules.ts) — one row per call, predicate is a
// named identifier exported from the same module, and the optional `note`
// string is a single-line/multi-line single-quoted literal.
//
// CLI:
//   node scripts/render-rbac-matrix.mjs --check   Exit 1 on drift, 0 on match.
//   node scripts/render-rbac-matrix.mjs --write   Rewrite the section in-place.
//
// Exit codes:
//   0  clean / write succeeded
//   1  drift detected (--check) OR malformed input (predicate not recognized)
//   2  CLI usage error

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const RULES_PATH = path.join(REPO_ROOT, 'packages', 'shared', 'src', 'rbac', 'rules.ts');
const DICTIONARY_PATH = path.join(REPO_ROOT, 'docs', 'data-dictionary.md');
const SENTINEL_START = '<!-- rbac-matrix:start -->';
const SENTINEL_END = '<!-- rbac-matrix:end -->';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { check: false, write: false };
  for (const a of argv.slice(2)) {
    if (a === '--check') args.check = true;
    else if (a === '--write') args.write = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else {
      process.stderr.write(`render-rbac-matrix: unknown argument: ${a}\n`);
      process.exit(2);
    }
  }
  return args;
}

function printUsageAndExit(code) {
  const usage = [
    'Usage: node scripts/render-rbac-matrix.mjs (--check | --write)',
    '',
    '  --check   Verify docs/data-dictionary.md is in sync with',
    '            packages/shared/src/rbac/rules.ts. Exit 1 on drift.',
    '  --write   Rewrite the rbac-matrix section in docs/data-dictionary.md.',
    '',
  ].join('\n');
  process.stdout.write(`${usage}\n`);
  process.exit(code);
}

// ---------------------------------------------------------------------------
// Parser for rules.ts
// ---------------------------------------------------------------------------

/**
 * Recognized predicate identifiers. Mirrors the named predicates exported
 * from rules.ts. A predicate that does not appear in this table is a
 * malformed-input error — we refuse to render a row whose guard we cannot
 * label, because silently emitting "<unknown>" would degrade the doc.
 */
const PREDICATE_LABELS = {
  allow: 'allow',
  deny: 'deny',
  sameOrg: 'sameOrg',
  sameTeam: 'sameTeam',
  isOwner: 'isOwner',
  lastAdminGuard: 'lastAdminGuard',
  sameOrgWithLastAdmin: 'sameOrgWithLastAdmin',
};

/**
 * Extract the contents of the RULES array literal from the source text so
 * we only scan `rule(...)` call sites that are part of the canonical
 * table — never doc-comment examples elsewhere in the file.
 */
function extractRulesArrayBody(source) {
  const marker = 'export const RULES';
  const startIdx = source.indexOf(marker);
  if (startIdx === -1) {
    throw new Error('render-rbac-matrix: cannot locate `export const RULES` in rules.ts');
  }
  const openIdx = source.indexOf('[', startIdx);
  if (openIdx === -1) {
    throw new Error('render-rbac-matrix: cannot locate opening `[` for RULES array');
  }
  // Walk forward and track bracket depth, ignoring brackets inside strings
  // and line/block comments. Predicates are simple identifiers and notes
  // are single-quoted strings, so the state machine only needs to handle
  // single quotes, line comments, and block comments.
  let depth = 1;
  let i = openIdx + 1;
  let inSingle = false;
  let inLine = false;
  let inBlock = false;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    const next = source[i + 1];
    if (inLine) {
      if (ch === '\n') inLine = false;
    } else if (inBlock) {
      if (ch === '*' && next === '/') {
        inBlock = false;
        i++;
      }
    } else if (inSingle) {
      if (ch === '\\') {
        i++; // skip escaped char
      } else if (ch === "'") {
        inSingle = false;
      }
    } else if (ch === '/' && next === '/') {
      inLine = true;
      i++;
    } else if (ch === '/' && next === '*') {
      inBlock = true;
      i++;
    } else if (ch === "'") {
      inSingle = true;
    } else if (ch === '[') {
      depth++;
    } else if (ch === ']') {
      depth--;
      if (depth === 0) {
        return source.slice(openIdx + 1, i);
      }
    }
    i++;
  }
  throw new Error('render-rbac-matrix: unterminated RULES array body');
}

/**
 * Tokenize a `rule(role, resource, action, predicate[, note])` call's
 * argument list into the five logical components. We rely on the
 * canonical shape: the first three args are single-quoted string
 * literals, the fourth is an identifier, the fifth (optional) is a
 * single-quoted string literal that may span multiple lines.
 */
function parseRuleCallArgs(argText) {
  const args = [];
  let i = 0;
  let current = '';
  let depth = 0;
  let inSingle = false;
  let inLine = false;
  let inBlock = false;
  while (i < argText.length) {
    const ch = argText[i];
    const next = argText[i + 1];
    if (inLine) {
      current += ch;
      if (ch === '\n') inLine = false;
    } else if (inBlock) {
      current += ch;
      if (ch === '*' && next === '/') {
        current += next;
        i += 2;
        inBlock = false;
        continue;
      }
    } else if (inSingle) {
      current += ch;
      if (ch === '\\') {
        current += next;
        i += 2;
        continue;
      }
      if (ch === "'") inSingle = false;
    } else if (ch === '/' && next === '/') {
      inLine = true;
      current += ch;
    } else if (ch === '/' && next === '*') {
      inBlock = true;
      current += ch;
    } else if (ch === "'") {
      inSingle = true;
      current += ch;
    } else if (ch === '(' || ch === '[' || ch === '{') {
      depth++;
      current += ch;
    } else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
      current += ch;
    } else if (ch === ',' && depth === 0) {
      args.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
    i++;
  }
  const tail = current.trim();
  if (tail.length > 0) args.push(tail);
  return args;
}

/**
 * Strip surrounding `//` and `/* *\/` comments and trim the result.
 */
function stripCommentsAndTrim(raw) {
  let out = raw;
  // Block comments
  out = out.replace(/\/\*[\s\S]*?\*\//g, '');
  // Line comments
  out = out.replace(/\/\/[^\n]*/g, '');
  return out.trim();
}

/**
 * Parse a single-quoted string literal that may contain escaped chars and
 * span multiple lines. Returns the decoded content with whitespace
 * collapsed to single spaces so the rendered table cell stays on one row.
 */
function decodeSingleQuotedString(literal) {
  const trimmed = stripCommentsAndTrim(literal);
  if (!trimmed.startsWith("'") || !trimmed.endsWith("'")) {
    throw new Error(
      `render-rbac-matrix: expected single-quoted string, got: ${trimmed.slice(0, 40)}…`,
    );
  }
  const body = trimmed.slice(1, -1);
  // Decode the small set of escapes we expect: \\ \' \n
  let out = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '\\') {
      const next = body[i + 1];
      if (next === '\\') out += '\\';
      else if (next === "'") out += "'";
      else if (next === 'n') out += ' ';
      else out += next ?? '';
      i++;
    } else {
      out += ch;
    }
  }
  // Collapse any internal newlines/runs of whitespace to a single space.
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * Parse all rows from the RULES array body.
 */
function parseRules(arrayBody) {
  const rows = [];
  // Match `rule(` opening, then walk the argument list with the same
  // bracket-aware state machine used for the array body.
  const ruleRegex = /\brule\s*\(/g;
  let m;
  while ((m = ruleRegex.exec(arrayBody)) !== null) {
    const start = m.index + m[0].length;
    let i = start;
    let depth = 1;
    let inSingle = false;
    let inLine = false;
    let inBlock = false;
    while (i < arrayBody.length && depth > 0) {
      const ch = arrayBody[i];
      const next = arrayBody[i + 1];
      if (inLine) {
        if (ch === '\n') inLine = false;
      } else if (inBlock) {
        if (ch === '*' && next === '/') {
          inBlock = false;
          i++;
        }
      } else if (inSingle) {
        if (ch === '\\') {
          i++;
        } else if (ch === "'") {
          inSingle = false;
        }
      } else if (ch === '/' && next === '/') {
        inLine = true;
        i++;
      } else if (ch === '/' && next === '*') {
        inBlock = true;
        i++;
      } else if (ch === "'") {
        inSingle = true;
      } else if (ch === '(' || ch === '[' || ch === '{') {
        depth++;
      } else if (ch === ')' || ch === ']' || ch === '}') {
        depth--;
        if (depth === 0) break;
      }
      i++;
    }
    if (depth !== 0) {
      throw new Error('render-rbac-matrix: unterminated rule(...) call');
    }
    const argText = arrayBody.slice(start, i);
    const args = parseRuleCallArgs(argText);
    if (args.length < 4 || args.length > 5) {
      throw new Error(
        `render-rbac-matrix: rule(...) expects 4 or 5 args, got ${args.length}: ${argText.slice(0, 80)}…`,
      );
    }
    const role = decodeSingleQuotedString(args[0]);
    const resource = decodeSingleQuotedString(args[1]);
    const action = decodeSingleQuotedString(args[2]);
    const predicateIdent = stripCommentsAndTrim(args[3]);
    if (!Object.hasOwn(PREDICATE_LABELS, predicateIdent)) {
      throw new Error(
        `render-rbac-matrix: unknown predicate identifier "${predicateIdent}" — extend PREDICATE_LABELS in scripts/render-rbac-matrix.mjs to publish this rule`,
      );
    }
    const note = args.length === 5 ? decodeSingleQuotedString(args[4]) : '';
    rows.push({
      role,
      resource,
      action,
      predicate: PREDICATE_LABELS[predicateIdent],
      note,
    });
  }
  if (rows.length === 0) {
    throw new Error('render-rbac-matrix: no rule(...) rows parsed');
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

/**
 * Escape pipe and angle-bracket characters so a table cell never breaks
 * the surrounding Markdown table.
 */
function escapeCell(value) {
  return value.replace(/\|/g, '\\|');
}

function renderSection(rows) {
  const header = [
    '## RBAC matrix',
    '',
    '> **Auto-generated by `scripts/render-rbac-matrix.mjs` from `packages/shared/src/rbac/rules.ts`.** Do not edit this section by hand — run `node scripts/render-rbac-matrix.mjs --write` after changing the rules table. The Husky pre-commit hook and the `quality` CI workflow both run the `--check` mode to block drift.',
    '',
    `One row per \`(role, resource, action)\` triple — ${rows.length} rows total. The \`Predicate\` column is the named guard from \`rules.ts\`; see that file for the predicate definitions and the policy contract.`,
    '',
    '| Role | Resource | Action | Predicate | Notes |',
    '| --- | --- | --- | --- | --- |',
  ];
  const body = rows.map(
    (r) =>
      `| ${escapeCell(r.role)} | ${escapeCell(r.resource)} | ${escapeCell(r.action)} | \`${escapeCell(r.predicate)}\` | ${escapeCell(r.note)} |`,
  );
  return [...header, ...body, ''].join('\n');
}

/**
 * Replace the section between the sentinel comments in `dictionary`. If
 * the sentinels are missing, append a fresh section at end-of-file.
 */
function applySection(dictionary, sectionMarkdown) {
  const startIdx = dictionary.indexOf(SENTINEL_START);
  const endIdx = dictionary.indexOf(SENTINEL_END);
  const wrapped = `${SENTINEL_START}\n\n${sectionMarkdown}\n${SENTINEL_END}`;
  if (startIdx === -1 && endIdx === -1) {
    const trailingNewline = dictionary.endsWith('\n') ? '' : '\n';
    return `${dictionary}${trailingNewline}\n${wrapped}\n`;
  }
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error(
      'render-rbac-matrix: sentinel comments are unbalanced in docs/data-dictionary.md',
    );
  }
  const before = dictionary.slice(0, startIdx);
  const after = dictionary.slice(endIdx + SENTINEL_END.length);
  return `${before}${wrapped}${after}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv);
  if (args.help) printUsageAndExit(0);
  if (args.check === args.write) {
    process.stderr.write('render-rbac-matrix: pass exactly one of --check or --write\n');
    printUsageAndExit(2);
  }

  const rulesSource = fs.readFileSync(RULES_PATH, 'utf8');
  const arrayBody = extractRulesArrayBody(rulesSource);
  const rows = parseRules(arrayBody);
  const section = renderSection(rows);

  const dictionary = fs.readFileSync(DICTIONARY_PATH, 'utf8');
  const updated = applySection(dictionary, section);

  if (args.write) {
    if (updated !== dictionary) {
      fs.writeFileSync(DICTIONARY_PATH, updated);
      process.stdout.write(
        `render-rbac-matrix: rewrote docs/data-dictionary.md (${rows.length} rules)\n`,
      );
    } else {
      process.stdout.write(
        `render-rbac-matrix: docs/data-dictionary.md already in sync (${rows.length} rules)\n`,
      );
    }
    process.exit(0);
  }

  // --check
  if (updated !== dictionary) {
    process.stderr.write(
      [
        'render-rbac-matrix: drift detected in docs/data-dictionary.md',
        '',
        '  The rendered RBAC matrix does not match packages/shared/src/rbac/rules.ts.',
        '  Re-render with:',
        '',
        '    node scripts/render-rbac-matrix.mjs --write',
        '',
        '  Then stage docs/data-dictionary.md and retry the commit.',
        '',
      ].join('\n'),
    );
    process.exit(1);
  }
  process.stdout.write(
    `render-rbac-matrix: docs/data-dictionary.md in sync (${rows.length} rules)\n`,
  );
  process.exit(0);
}

main();
