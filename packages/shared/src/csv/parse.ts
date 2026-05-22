/**
 * @repo/shared/csv/parse — pure CSV parsing + column-mapping resolver.
 *
 * Epic #10 / Story #663 / Task #690. Two pure functions, no I/O, no
 * network, no DB. The API handlers (`apps/api/src/routes/v1/admin/csv-import`)
 * and the admin upload page (`apps/web/src/pages/admin/import.astro`)
 * both call this module — keeping it pure means the parse step can run
 * in either runtime without dragging Node-only globals.
 *
 * Two stages:
 *
 *   1. `parseCsv(buffer)` — decode the upload bytes as UTF-8, split
 *      into rows, return the header row + first 10 preview rows. Used
 *      by the parse endpoint (Task #687) so the admin UI can render
 *      the column mapper before they commit.
 *   2. `resolveRows(buffer, mapping)` — re-parse the same buffer and
 *      project each data row through the user-supplied mapping
 *      (`{ headerName: targetField | null }`). Returns the
 *      target-shaped rows plus a per-row error envelope so the commit
 *      endpoint can report exactly which row failed and why before
 *      rolling back the transaction.
 *
 * RFC 4180-lite (no streaming, no embedded CRLF) intentionally —
 * the upload cap is 5 MB (Tech Spec §Limits), and pulling in a
 * heavyweight CSV library to handle multi-line quoted fields buys
 * us complexity we do not need at this scale. If a row's parse fails
 * mid-row (mismatched quote), we surface it as `PARSE_ERROR`
 * rather than silently truncating.
 */

/**
 * Number of preview rows returned by `parseCsv`. The admin UI shows
 * exactly this many rows in the mapping confirmation table — the
 * count is part of the API contract (Tech Spec §AC-7).
 */
export const PREVIEW_ROW_COUNT = 10;

/** Required target fields for an athlete-roster import. */
export const REQUIRED_TARGET_FIELDS = ['email', 'firstName', 'lastName'] as const;
export type RequiredTargetField = (typeof REQUIRED_TARGET_FIELDS)[number];

/** All known target fields (required + optional). */
export const KNOWN_TARGET_FIELDS = [
  'email',
  'firstName',
  'lastName',
  'teamName',
] as const;
export type KnownTargetField = (typeof KNOWN_TARGET_FIELDS)[number];

/**
 * Result of `parseCsv`. `headers` is the trimmed header row; an empty
 * file produces an empty header array and an empty preview.
 */
export interface ParseCsvResult {
  readonly headers: readonly string[];
  readonly previewRows: ReadonlyArray<readonly string[]>;
}

/** Per-row error surfaced by `resolveRows`. */
export type ResolveErrorCode =
  | 'EMPTY_FILE'
  | 'MISSING_REQUIRED_COLUMN'
  | 'MISSING_REQUIRED_VALUE'
  | 'UNMAPPABLE_ROW'
  | 'PARSE_ERROR';

export interface ResolveError {
  readonly rowIndex: number;
  readonly code: ResolveErrorCode;
  readonly field?: string;
}

export interface ResolveRowsResult {
  readonly rows: ReadonlyArray<Readonly<Record<string, string>>>;
  readonly errors: readonly ResolveError[];
}

/**
 * Mapping from CSV header name → target field name (or `null` to
 * indicate the column is ignored). Header names are matched
 * case-sensitively after trimming.
 */
export type ColumnMapping = Readonly<Record<string, string | null>>;

/**
 * Decode the upload buffer as UTF-8 and split into rows. The decoder
 * tolerates a leading BOM. No external dependency — we hand-roll the
 * RFC 4180-lite parser so the module stays pure and free of Node-only
 * globals.
 */
function decodeBuffer(buffer: Uint8Array): string {
  const decoder = new TextDecoder('utf-8');
  let text = decoder.decode(buffer);
  // Strip UTF-8 BOM if present.
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }
  return text;
}

/**
 * Parse the text into a 2D array of cell strings. Supports double-
 * quoted fields with embedded commas and escaped quotes (`""`). Does
 * not support embedded newlines inside quoted fields — those surface
 * as a `PARSE_ERROR` at the affected row.
 */
function splitRows(text: string): string[][] {
  // Normalise line endings then split. Drop a trailing blank row
  // produced by a final newline.
  const normalised = text.replace(/\r\n?/g, '\n');
  const lines = normalised.split('\n');
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines.map((line) => splitCells(line));
}

function splitCells(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line.charAt(i);
    if (inQuotes) {
      if (ch === '"') {
        // Look ahead for an escaped quote.
        if (line.charAt(i + 1) === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === ',') {
        cells.push(current);
        current = '';
      } else if (ch === '"' && current.length === 0) {
        inQuotes = true;
      } else {
        current += ch;
      }
    }
  }
  cells.push(current);
  return cells.map((c) => c.trim());
}

/**
 * Decode + split + project the first `PREVIEW_ROW_COUNT` data rows.
 * An empty buffer returns `{ headers: [], previewRows: [] }` rather
 * than throwing so the UI can surface a "file is empty" message
 * without a try/catch.
 */
export function parseCsv(buffer: Uint8Array): ParseCsvResult {
  const text = decodeBuffer(buffer);
  if (text.trim().length === 0) {
    return { headers: [], previewRows: [] };
  }
  const rows = splitRows(text);
  if (rows.length === 0) {
    return { headers: [], previewRows: [] };
  }
  const headers = rows[0]!;
  const dataRows = rows.slice(1);
  const previewRows = dataRows.slice(0, PREVIEW_ROW_COUNT);
  return { headers, previewRows };
}

/**
 * Re-parse the buffer and project every data row through `mapping`.
 * Returns:
 *
 *   - `rows`     — successfully resolved rows keyed by target field
 *                  name. Only rows with NO errors are included here.
 *   - `errors`   — one entry per failing row, in source order. Multiple
 *                  errors for the same row produce multiple entries so
 *                  the UI can render an error column per field.
 *
 * Validation order per row:
 *   1. Missing-required-column at the mapping level → single
 *      `MISSING_REQUIRED_COLUMN` error at rowIndex -1, no rows.
 *   2. Per-row `UNMAPPABLE_ROW` when the row's cell count is shorter
 *      than the header count and a required cell would be undefined.
 *   3. Per-field `MISSING_REQUIRED_VALUE` when a required cell is
 *      empty after trim.
 */
export function resolveRows(buffer: Uint8Array, mapping: ColumnMapping): ResolveRowsResult {
  const text = decodeBuffer(buffer);
  if (text.trim().length === 0) {
    return { rows: [], errors: [{ rowIndex: -1, code: 'EMPTY_FILE' }] };
  }

  // Mapping-level check: every required target field must be the
  // destination of at least one header.
  const mappedTargets = new Set(
    Object.values(mapping).filter((v): v is string => typeof v === 'string' && v.length > 0),
  );
  const missingRequired = REQUIRED_TARGET_FIELDS.filter((f) => !mappedTargets.has(f));
  if (missingRequired.length > 0) {
    return {
      rows: [],
      errors: missingRequired.map((field) => ({
        rowIndex: -1,
        code: 'MISSING_REQUIRED_COLUMN' as const,
        field,
      })),
    };
  }

  const allRows = splitRows(text);
  if (allRows.length === 0) {
    return { rows: [], errors: [{ rowIndex: -1, code: 'EMPTY_FILE' }] };
  }
  const headers = allRows[0]!;
  const dataRows = allRows.slice(1);

  // Build header-index → target-field lookup once.
  const headerToTarget = new Map<number, string>();
  headers.forEach((header, idx) => {
    const target = mapping[header];
    if (typeof target === 'string' && target.length > 0) {
      headerToTarget.set(idx, target);
    }
  });

  const rows: Record<string, string>[] = [];
  const errors: ResolveError[] = [];

  dataRows.forEach((cells, dataIdx) => {
    const rowIndex = dataIdx; // 0-based among data rows
    // A row shorter than the header count is unmappable.
    if (cells.length < headers.length) {
      errors.push({ rowIndex, code: 'UNMAPPABLE_ROW' });
      return;
    }
    const projected: Record<string, string> = {};
    let hadError = false;
    headerToTarget.forEach((target, colIdx) => {
      const raw = cells[colIdx];
      const value = typeof raw === 'string' ? raw.trim() : '';
      projected[target] = value;
    });
    // Per-field required-value check.
    for (const required of REQUIRED_TARGET_FIELDS) {
      if ((projected[required] ?? '').length === 0) {
        errors.push({ rowIndex, code: 'MISSING_REQUIRED_VALUE', field: required });
        hadError = true;
      }
    }
    if (!hadError) {
      rows.push(projected);
    }
  });

  return { rows, errors };
}
