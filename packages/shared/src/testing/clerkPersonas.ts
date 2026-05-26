/**
 * @repo/shared/testing/clerkPersonas — persona ↔ Clerk subject-ID reader.
 *
 * This module reads `clerk-personas.json` (committed alongside this file)
 * and returns the operator-curated Clerk subject IDs for the three core
 * QA personas: `athlete`, `coach`, `org-admin`.
 *
 * The JSON ships with all three values set to `null`. The operator
 * populates it once per Clerk test instance per the runbook at
 * `docs/runbooks/clerk-persona-bootstrap.md`. Reading the file before
 * the operator has populated it throws an actionable error that names
 * the runbook and prints the absolute path of the JSON file.
 *
 * Story #881 / Task #893.
 *
 * Why "subject IDs are not secrets". Clerk's `sub` claim is a public
 * identifier — it appears in every JWT Clerk issues and in URLs the
 * Clerk dashboard exposes. Persisting subject IDs in a tracked file is
 * intentional. The matching secret (the Backend SDK key) lives in env
 * vars; see `clerkTickets.ts` for that boundary.
 */

import { readFileSync as nodeReadFileSync } from 'node:fs';
import path from 'node:path';

import type { Persona } from './auth';

/**
 * The three QA personas this reader serves. The wider `Persona` union in
 * `auth.ts` also covers `'anonymous'` (no Clerk account) and
 * `'dev-admin'` (provisioned out-of-band via `scripts/seed-dev-admin.mjs`).
 * Neither needs a Clerk subject ID in `clerk-personas.json`, so this
 * reader narrows to the bootstrap set.
 */
export type ClerkPersona = Extract<Persona, 'athlete' | 'coach' | 'org-admin'>;

export const CLERK_PERSONAS: readonly ClerkPersona[] = Object.freeze([
  'athlete',
  'coach',
  'org-admin',
]);

// `import.meta.dirname` (Node 20.11+, engines: >=24) is preferred over
// `fileURLToPath(new URL(..., import.meta.url))` because vitest's jsdom
// environment substitutes `import.meta.url` with a non-`file:` scheme
// which `fileURLToPath` rejects. `import.meta.dirname` is unaffected.
const PERSONAS_JSON_PATH = path.join(import.meta.dirname, 'clerk-personas.json');
const RUNBOOK_PATH = 'docs/runbooks/clerk-persona-bootstrap.md';

/**
 * On-disk shape of `clerk-personas.json`. Every key is required, every
 * value is `string | null`; `null` means "operator has not populated
 * this persona yet".
 */
export interface PersonaClerkIdsRaw {
  readonly athlete: string | null;
  readonly coach: string | null;
  readonly 'org-admin': string | null;
}

/**
 * Resolved shape — every persona must carry a non-empty `user_...`
 * subject ID. `readPersonaClerkIds()` returns this shape or throws.
 */
export type PersonaClerkIds = Readonly<Record<ClerkPersona, string>>;

/**
 * Options that let tests inject a synthetic JSON path and/or a stubbed
 * `readFileSync`. Production callers pass nothing; the defaults read
 * the tracked `clerk-personas.json` next to this module.
 *
 * Exposing this seam is intentional: mocking `node:fs` via `vi.mock`
 * is unreliable for native modules under vitest's vmThreads pool, and
 * dependency injection is the project-preferred testing pattern.
 */
export interface ReadPersonaClerkIdsOptions {
  /** Absolute path to the personas JSON. Defaults to the tracked file. */
  jsonPath?: string;
  /** UTF-8 file reader. Defaults to `node:fs#readFileSync`. */
  readFile?: (filePath: string, encoding: 'utf8') => string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function loadRaw(
  jsonPath: string,
  readFile: (filePath: string, encoding: 'utf8') => string,
): PersonaClerkIdsRaw {
  let contents: string;
  try {
    contents = readFile(jsonPath, 'utf8');
  } catch (cause) {
    throw new Error(
      `readPersonaClerkIds: cannot read ${jsonPath}. ` +
        `This file is tracked in git; restore it from the repo root or ` +
        `see ${RUNBOOK_PATH} to bootstrap a fresh copy.`,
      { cause: cause instanceof Error ? cause : undefined },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (cause) {
    throw new Error(
      `readPersonaClerkIds: ${jsonPath} is not valid JSON. ` +
        `Restore it from git or follow ${RUNBOOK_PATH} to recreate it.`,
      { cause: cause instanceof Error ? cause : undefined },
    );
  }

  if (!isPlainObject(parsed)) {
    throw new Error(
      `readPersonaClerkIds: ${jsonPath} must be a JSON object ` +
        `with keys 'athlete', 'coach', 'org-admin'. See ${RUNBOOK_PATH}.`,
    );
  }

  for (const persona of CLERK_PERSONAS) {
    if (!(persona in parsed)) {
      throw new Error(
        `readPersonaClerkIds: ${jsonPath} is missing the ` +
          `'${persona}' key. Follow ${RUNBOOK_PATH} to repopulate the ` +
          `personas JSON.`,
      );
    }
    const value = parsed[persona];
    if (value !== null && typeof value !== 'string') {
      throw new Error(
        `readPersonaClerkIds: ${jsonPath} key '${persona}' ` +
          `must be a string or null, received ${typeof value}. See ` +
          `${RUNBOOK_PATH}.`,
      );
    }
  }

  return parsed as unknown as PersonaClerkIdsRaw;
}

/**
 * Read the persona ↔ Clerk subject-ID map from disk.
 *
 * Returns a frozen `Record<ClerkPersona, string>` when every persona's
 * value is a non-empty string. Throws with an actionable, runbook-linked
 * message when any persona is still `null`, when the file is missing,
 * when it cannot be parsed, or when the structure is malformed.
 *
 * The thrown error message ALWAYS names `docs/runbooks/clerk-persona-bootstrap.md`
 * and includes the absolute path to `clerk-personas.json` so the
 * operator can locate the file from the error alone.
 */
export function readPersonaClerkIds(options: ReadPersonaClerkIdsOptions = {}): PersonaClerkIds {
  const jsonPath = options.jsonPath ?? PERSONAS_JSON_PATH;
  const readFile = options.readFile ?? nodeReadFileSync;
  const raw = loadRaw(jsonPath, readFile);
  const missing: ClerkPersona[] = [];
  for (const persona of CLERK_PERSONAS) {
    const value = raw[persona];
    if (value === null || value.trim().length === 0) {
      missing.push(persona);
    }
  }
  if (missing.length > 0) {
    const list = missing.map((p) => `'${p}'`).join(', ');
    throw new Error(
      `readPersonaClerkIds: the following persona(s) are not yet ` +
        `populated in ${jsonPath}: ${list}. ` +
        `Follow ${RUNBOOK_PATH} to create the corresponding Clerk users ` +
        `in the test instance and paste each user's subject ID into the ` +
        `JSON file.`,
    );
  }
  // After the null-check above, every persona is a non-empty string.
  return Object.freeze({
    athlete: raw.athlete as string,
    coach: raw.coach as string,
    'org-admin': raw['org-admin'] as string,
  });
}

/**
 * Absolute filesystem path of the persona-ID JSON file. Exported so the
 * runbook's operator-facing tooling (and the matching tests) can locate
 * the file without hard-coding workspace layout.
 */
export const personaClerkIdsPath: string = PERSONAS_JSON_PATH;

/**
 * Path to the operator runbook (repo-relative). Exported so callers can
 * surface it in their own error messages.
 */
export const personaClerkIdsRunbookPath: string = RUNBOOK_PATH;
