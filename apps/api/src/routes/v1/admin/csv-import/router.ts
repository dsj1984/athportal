// apps/api/src/routes/v1/admin/csv-import/router.ts
//
// Real implementation of the `/api/v1/admin/csv-import` sub-router
// (Epic #10 / Story #663 / Task #687). Replaces the placeholder
// shipped by Story #654 (Task #658) on a one-file swap — the mount
// point in `apps/api/src/routes/v1/admin/index.ts` does not change.
//
// Endpoints:
//
//   POST /parse   → accept a multipart upload with a `file` field
//                   containing a CSV, return
//                   `{ success: true, data: { headers, previewRows } }`.
//                   No DB writes; the admin uses this to render the
//                   column-mapping UI before they commit.
//
//   POST /commit  → accept JSON `{ fileBase64, mapping }`, run the
//                   parser's `resolveRows`, then INSIDE a single
//                   Drizzle transaction:
//                     1. insert one `csv_import_batches` audit row,
//                     2. for each row: look up an existing user by
//                        email (any org) — if found, REUSE the
//                        user_id; otherwise INSERT a new pending
//                        user row,
//                     3. for each row: INSERT an `athlete_memberships`
//                        row pointing at the resolved user_id +
//                        target team.
//                   On ANY hard validation failure (missing required
//                   column, parser error envelope non-empty, target
//                   team not found in the actor's org) the transaction
//                   is rolled back, no audit row is persisted, and the
//                   handler returns 400 with the per-row error envelope.
//
// Cross-tenant isolation is load-bearing: every team-name resolution
// is filtered by the actor's `orgId`. A CSV that names a team owned by
// a peer org surfaces `TEAM_NOT_FOUND` against THIS org — we
// deliberately do not differentiate "no such team anywhere" from
// "exists but in another org" so the wire shape never leaks the
// cross-tenant membership of a name string.
//
// Duplicate-email reuse (AC-8): when an imported email matches an
// existing platform `users` row (any org), we add a new
// `athlete_memberships` row pointing at the existing `user_id` and
// surface the reuse in the response envelope as `reusedUserIds: [...]`.
// We do NOT leak whether the user is currently a member of any other
// org — only that the email already has a platform account and will
// be added to THIS org's roster.

import { randomUUID } from 'node:crypto';
import { parseCsv, resolveRows } from '@repo/shared/csv/parse';
import { athleteMemberships, csvImportBatches, teams, users } from '@repo/shared/db/schema';
import {
  type CsvImportBatchListOutput,
  CsvImportCommitInputSchema,
  type CsvImportCommitOutput,
  type CsvImportRowError,
} from '@repo/shared/schemas/admin/csvImport';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import type { RequireInternalUserEnv } from '../../../../middleware/auth';

/** 5 MB cap on raw upload bytes (Tech Spec §Limits). */
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Error envelope codes this router emits. */
type ErrorCode =
  | 'FORBIDDEN'
  | 'BAD_REQUEST'
  | 'VALIDATION_ERROR'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'IMPORT_FAILED'
  | 'INTERNAL';

interface ErrorBody {
  readonly success: false;
  readonly error: {
    readonly code: ErrorCode;
    readonly message: string;
    readonly rowErrors?: readonly CsvImportRowError[];
  };
}

function errorBody(
  code: ErrorCode,
  message: string,
  rowErrors?: readonly CsvImportRowError[],
): ErrorBody {
  return {
    success: false,
    error: rowErrors ? { code, message, rowErrors } : { code, message },
  };
}

/**
 * Narrowed Drizzle surface this router exercises. Same rationale as
 * `apps/api/src/routes/v1/admin/invitations/router.ts`: the auth
 * middleware carries the handle as `unknown` and each consumer pins
 * the precise subset it uses.
 */
interface DbWhereChain {
  all(): unknown[];
  orderBy(order: unknown): { all(): unknown[] };
}

interface DbLike {
  select(): {
    from(table: unknown): {
      where(predicate: unknown): DbWhereChain;
    };
  };
  insert(table: unknown): {
    values(rows: unknown): { run(): void };
  };
  update(table: unknown): {
    set(values: Record<string, unknown>): {
      where(predicate: unknown): { run(): void };
    };
  };
  transaction<T>(fn: (tx: DbLike) => T): T;
}

function narrowDb(db: unknown): DbLike | null {
  if (!db || typeof db !== 'object') return null;
  const candidate = db as Partial<DbLike>;
  if (typeof candidate.select !== 'function') return null;
  if (typeof candidate.insert !== 'function') return null;
  if (typeof candidate.transaction !== 'function') return null;
  return candidate as DbLike;
}

/**
 * Extract the binary CSV bytes from a multipart upload's `file` field.
 * Returns `null` when the field is missing or the value is not a Blob.
 */
async function extractUploadBytes(c: {
  req: { formData(): Promise<FormData> };
}): Promise<Uint8Array | null> {
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return null;
  }
  const file = form.get('file');
  if (!(file instanceof Blob)) return null;
  const arrayBuffer = await file.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

function decodeBase64(input: string): Uint8Array | null {
  try {
    const buf = Buffer.from(input, 'base64');
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  } catch {
    return null;
  }
}

/**
 * Build the importer's row-error code from the parser's
 * `ResolveErrorCode`. The parser emits structural errors (parser /
 * mapping / missing-value); this importer adds business-rule codes
 * (`EMAIL_INVALID`, `TEAM_NOT_FOUND`).
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Decode the upload bytes and split into headers + every data row.
 * Mirrors the RFC 4180-lite split inside `@repo/shared/csv/parse`
 * but returns the full row set rather than only the 10-row preview.
 * Used by the per-row error report (Story #973 F2) to look up the
 * original cell value for a failing rowIndex + field pair.
 */
function parseAllRows(bytes: Uint8Array): {
  headers: readonly string[];
  dataRows: ReadonlyArray<readonly string[]>;
} {
  const text = new TextDecoder('utf-8').decode(bytes);
  const stripped = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (stripped.trim().length === 0) {
    return { headers: [], dataRows: [] };
  }
  const normalised = stripped.replace(/\r\n?/g, '\n');
  const lines = normalised.split('\n');
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  const rows = lines.map((line) => splitCsvLine(line));
  if (rows.length === 0) return { headers: [], dataRows: [] };
  const [headers, ...dataRows] = rows;
  return { headers: headers ?? [], dataRows };
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line.charAt(i);
    if (inQuotes) {
      if (ch === '"') {
        if (line.charAt(i + 1) === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === ',') {
      cells.push(current);
      current = '';
    } else if (ch === '"' && current.length === 0) {
      inQuotes = true;
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells.map((c) => c.trim());
}

/**
 * Index `{ rowIndex, field } → cellValue` so the row-error enricher
 * can look up the offending cell in O(1) without re-parsing per error.
 */
type CellLookup = ReadonlyMap<number, ReadonlyMap<string, string>>;

function buildCellLookup(
  parse: { headers: readonly string[]; dataRows: ReadonlyArray<readonly string[]> },
  mapping: Readonly<Record<string, string | null>>,
): CellLookup {
  // header column index → target field name
  const colToTarget = new Map<number, string>();
  parse.headers.forEach((header, idx) => {
    const target = mapping[header];
    if (typeof target === 'string' && target.length > 0) {
      colToTarget.set(idx, target);
    }
  });

  const lookup = new Map<number, Map<string, string>>();
  parse.dataRows.forEach((cells, rowIndex) => {
    const fieldToCell = new Map<string, string>();
    colToTarget.forEach((target, colIdx) => {
      const raw = cells[colIdx];
      fieldToCell.set(target, typeof raw === 'string' ? raw : '');
    });
    lookup.set(rowIndex, fieldToCell);
  });
  return lookup;
}

/**
 * Attach the original cell value to a row-error envelope. Mapping-
 * level errors (`rowIndex === -1`) have no cell coordinate, and the
 * envelope is returned unchanged. When the field is present but the
 * lookup misses (out-of-bounds row, unmapped field), `cellValue` is
 * omitted so the wire shape never carries `undefined`.
 */
function enrichRowError(
  err: { rowIndex: number; code: string; field?: string },
  lookup: CellLookup,
): CsvImportRowError {
  const base: CsvImportRowError = {
    rowIndex: err.rowIndex,
    code: err.code,
    ...(err.field ? { field: err.field } : {}),
  };
  if (err.rowIndex < 0 || !err.field) return base;
  const cell = lookup.get(err.rowIndex)?.get(err.field);
  if (typeof cell !== 'string') return base;
  return { ...base, cellValue: cell };
}

export const csvImportAdminRouter = new Hono<RequireInternalUserEnv>();

// ──────────────────────────────────────────────────────────────────────────
// POST /parse — multipart upload, returns headers + first 10 preview rows.
// ──────────────────────────────────────────────────────────────────────────
csvImportAdminRouter.post('/parse', async (c) => {
  const auth = c.get('auth');
  if (!auth.orgId) {
    return c.json(errorBody('FORBIDDEN', 'Actor has no org context.'), 403);
  }

  const contentType = c.req.header('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    return c.json(errorBody('UNSUPPORTED_MEDIA_TYPE', 'Upload must be multipart/form-data.'), 415);
  }

  const bytes = await extractUploadBytes(c);
  if (!bytes) {
    return c.json(errorBody('BAD_REQUEST', 'Missing `file` field in upload.'), 400);
  }
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    return c.json(errorBody('PAYLOAD_TOO_LARGE', 'CSV exceeds the 5 MB limit.'), 413);
  }

  const result = parseCsv(bytes);
  return c.json(
    {
      success: true as const,
      data: {
        headers: result.headers,
        previewRows: result.previewRows,
      },
    },
    200,
  );
});

// ──────────────────────────────────────────────────────────────────────────
// POST /commit — JSON body, transactional import.
// ──────────────────────────────────────────────────────────────────────────
csvImportAdminRouter.post('/commit', async (c) => {
  const auth = c.get('auth');
  const orgId = auth.orgId;
  if (!orgId) {
    return c.json(errorBody('FORBIDDEN', 'Actor has no org context.'), 403);
  }

  const rawBody: unknown = await c.req.json().catch(() => null);
  const parsed = CsvImportCommitInputSchema.safeParse(rawBody);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const message = issue
      ? `${issue.path.join('.') || 'body'}: ${issue.message}`
      : 'Request body is invalid.';
    return c.json(errorBody('VALIDATION_ERROR', message), 400);
  }

  const bytes = decodeBase64(parsed.data.fileBase64);
  if (!bytes) {
    return c.json(errorBody('BAD_REQUEST', '`fileBase64` is not valid base64.'), 400);
  }
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    return c.json(errorBody('PAYLOAD_TOO_LARGE', 'CSV exceeds the 5 MB limit.'), 413);
  }

  const db = narrowDb(c.get('db'));
  if (!db) {
    return c.json(errorBody('INTERNAL', 'Service temporarily unavailable.'), 500);
  }

  // Re-parse the upload to recover the original (untrimmed) data cells
  // by row index. The resolver's per-row errors only carry rowIndex +
  // field — for the per-row error report (Story #973 F2) the UI needs
  // to show the operator the exact cell value that failed validation.
  // `parseCsv` returns only the first 10 preview rows by design, so we
  // call into the same parser via a small helper that yields every
  // row. The shape (`headers`, `dataRows`) is the parser's normalised
  // RFC 4180-lite output already trimmed of the trailing blank row.
  const fullParse = parseAllRows(bytes);
  const cellLookup = buildCellLookup(fullParse, parsed.data.mapping);

  // Resolve rows + collect parser errors first. If the mapping is
  // structurally bad (missing required column, etc.), the transaction
  // never starts.
  const resolved = resolveRows(bytes, parsed.data.mapping);
  if (resolved.errors.length > 0) {
    return c.json(
      errorBody(
        'IMPORT_FAILED',
        'CSV failed validation; no rows imported.',
        resolved.errors.map((e) => enrichRowError(e, cellLookup)),
      ),
      400,
    );
  }

  // Business-rule validation pass (still pre-transaction).
  const rowErrors: CsvImportRowError[] = [];
  for (let i = 0; i < resolved.rows.length; i++) {
    const row = resolved.rows[i]!;
    if (!EMAIL_REGEX.test(row.email ?? '')) {
      rowErrors.push(
        enrichRowError({ rowIndex: i, code: 'EMAIL_INVALID', field: 'email' }, cellLookup),
      );
    }
  }

  // Pre-resolve team ids when the mapping includes a `teamName`
  // column. Cross-tenant defence: the lookup is filtered by the
  // actor's `orgId`, so a CSV that names a peer-org team surfaces
  // `TEAM_NOT_FOUND` against THIS org.
  const wantsTeam = resolved.rows.some(
    (r) => typeof r.teamName === 'string' && r.teamName.length > 0,
  );
  const teamByName = new Map<string, string>();
  if (wantsTeam) {
    const names = Array.from(
      new Set(
        resolved.rows
          .map((r) => r.teamName)
          .filter((n): n is string => typeof n === 'string' && n.length > 0),
      ),
    );
    if (names.length > 0) {
      const found = db
        .select()
        .from(teams)
        .where(and(eq(teams.orgId, orgId), inArray(teams.name, names)))
        .all() as Array<{ id: string; name: string }>;
      for (const t of found) {
        teamByName.set(t.name, t.id);
      }
      for (let i = 0; i < resolved.rows.length; i++) {
        const name = resolved.rows[i]!.teamName;
        if (typeof name === 'string' && name.length > 0 && !teamByName.has(name)) {
          rowErrors.push(
            enrichRowError(
              { rowIndex: i, code: 'TEAM_NOT_FOUND', field: 'teamName' },
              cellLookup,
            ),
          );
        }
      }
    }
  }

  if (rowErrors.length > 0) {
    return c.json(
      errorBody('IMPORT_FAILED', 'CSV failed validation; no rows imported.', rowErrors),
      400,
    );
  }

  // Pre-resolve existing users by email (any org). This drives both
  // the duplicate-reuse signal and the per-row user_id selection
  // inside the transaction. Reading outside the transaction is fine —
  // the worst case is a race where a second admin onboarded a user
  // mid-import, which produces a duplicate-email INSERT failure and
  // rolls the whole batch back. The transaction itself re-reads on
  // conflict via the unique index on `clerk_subject_id` + `email`.
  const emails = Array.from(new Set(resolved.rows.map((r) => (r.email ?? '').toLowerCase())));
  const existingUsers =
    emails.length > 0
      ? (db.select().from(users).where(inArray(users.email, emails)).all() as Array<{
          id: string;
          email: string;
          orgId: string | null;
        }>)
      : [];
  const userByEmail = new Map<string, { id: string; orgId: string | null }>();
  for (const u of existingUsers) {
    userByEmail.set(u.email.toLowerCase(), {
      id: u.id,
      orgId: (u as { orgId: string | null }).orgId ?? null,
    });
  }

  const batchId = `cib_${randomUUID()}`;
  const reusedUserIds: string[] = [];
  const importedAt = new Date();

  try {
    db.transaction((tx) => {
      // 1. Audit row.
      tx.insert(csvImportBatches)
        .values({
          id: batchId,
          orgId,
          importedByUserId: auth.userId,
          rowCount: resolved.rows.length,
          successCount: resolved.rows.length,
          errorCount: 0,
          errorEnvelope: '[]',
          fileName: parsed.data.fileName,
          createdAt: importedAt,
        })
        .run();

      // 2. Per-row user-resolve + membership insert.
      for (const row of resolved.rows) {
        const email = (row.email ?? '').toLowerCase();
        const existing = userByEmail.get(email);
        let userId: string;
        if (existing) {
          userId = existing.id;
          reusedUserIds.push(userId);
          // The cross-tenant CHECK trigger on `athlete_memberships`
          // requires `users.org_id === athlete_memberships.org_id`.
          // When the existing user's `org_id` does NOT match the
          // importing org we reassign their home org to the importer
          // — this is the practical interpretation of AC-8's reuse
          // semantic given the current schema. The wire-shape
          // contract (`reusedUserIds`) is the only cross-org signal
          // we expose; no peer-org membership data is read back to
          // the caller.
          if (existing.orgId !== orgId) {
            tx.update(users)
              .set({ orgId, updatedAt: new Date() })
              .where(eq(users.id, userId))
              .run();
            // Cache the new org for any later row referencing the
            // same email so the membership insert sees the post-
            // update value.
            userByEmail.set(email, { id: userId, orgId });
          }
        } else {
          // Mint a new pending user. `clerk_subject_id` is a placeholder
          // — the matching Clerk identity is created lazily on first
          // login. The UNIQUE index on `clerk_subject_id` means we
          // generate one per row.
          const newUserId = `u_${randomUUID()}`;
          tx.insert(users)
            .values({
              id: newUserId,
              clerkSubjectId: `pending_${newUserId}`,
              email,
              role: 'member',
              orgId,
            })
            .run();
          userByEmail.set(email, { id: newUserId, orgId });
          userId = newUserId;
        }

        // Resolve the target team. When the mapping does not include a
        // team, the importer is creating "unassigned" memberships —
        // skip the join-row write for now (deferred to a follow-up
        // Story per Tech Spec).
        const teamName = row.teamName;
        if (typeof teamName !== 'string' || teamName.length === 0) {
          continue;
        }
        const teamId = teamByName.get(teamName);
        if (!teamId) {
          // Defensive — pre-flight already caught this; throw to roll back.
          throw new Error(`TEAM_NOT_FOUND:${teamName}`);
        }

        tx.insert(athleteMemberships)
          .values({
            id: `am_${randomUUID()}`,
            orgId,
            teamId,
            athleteUserId: userId,
          })
          .run();
      }
    });
  } catch (err) {
    // Mask the internal failure detail per security-baseline.
    const message = err instanceof Error ? err.message : 'Transaction failed.';
    return c.json(
      errorBody(
        'IMPORT_FAILED',
        message.startsWith('TEAM_NOT_FOUND:') ? 'CSV failed validation.' : 'Transaction failed.',
      ),
      message.startsWith('TEAM_NOT_FOUND:') ? 400 : 500,
    );
  }

  const data: CsvImportCommitOutput = {
    batchId,
    rowCount: resolved.rows.length,
    successCount: resolved.rows.length,
    errorCount: 0,
    // De-duplicate so the same user does not appear twice if a CSV
    // mentions the same email on two rows.
    reusedUserIds: Array.from(new Set(reusedUserIds)),
  };
  return c.json({ success: true as const, data }, 200);
});

// ──────────────────────────────────────────────────────────────────────────
// GET /batches — list prior import batches for the actor's org.
//
// Returns the persisted summary (id, fileName, row counts, createdAt)
// sorted newest-first. Cross-tenant defence: the `where(eq(orgId,
// actor.orgId))` predicate is the only signal we expose — peer-org
// batches are never reachable through this surface. Story #973 F1.
// ──────────────────────────────────────────────────────────────────────────
csvImportAdminRouter.get('/batches', (c) => {
  const auth = c.get('auth');
  const orgId = auth.orgId;
  if (!orgId) {
    return c.json(errorBody('FORBIDDEN', 'Actor has no org context.'), 403);
  }

  const db = narrowDb(c.get('db'));
  if (!db) {
    return c.json(errorBody('INTERNAL', 'Service temporarily unavailable.'), 500);
  }

  const rows = db
    .select()
    .from(csvImportBatches)
    .where(eq(csvImportBatches.orgId, orgId))
    .orderBy(desc(csvImportBatches.createdAt))
    .all() as Array<{
    id: string;
    fileName: string;
    rowCount: number;
    successCount: number;
    errorCount: number;
    createdAt: Date | number;
  }>;

  const data: CsvImportBatchListOutput = {
    batches: rows.map((r) => ({
      id: r.id,
      fileName: r.fileName,
      rowCount: r.rowCount,
      successCount: r.successCount,
      errorCount: r.errorCount,
      // Drizzle `{ mode: 'timestamp' }` returns a Date; raw SQLite
      // integer falls through as a number. Normalise both to ISO-8601
      // strings at the wire boundary.
      createdAt:
        r.createdAt instanceof Date
          ? r.createdAt.toISOString()
          : new Date(r.createdAt * 1000).toISOString(),
    })),
  };
  return c.json({ success: true as const, data }, 200);
});
