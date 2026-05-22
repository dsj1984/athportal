// apps/web/src/components/admin/CsvMappingTool.ts
//
// Pure helpers and the test-id catalog for the admin CSV import
// surface (Epic #10 / Story #663 / Task #689). Kept TypeScript-only
// (no DOM imports) so the unit test can exercise the validation /
// build-payload logic without spinning up jsdom.
//
// Mirrors the shape of `OrgConfigForm.ts` from Story #656 / Task #674.

import type {
  ColumnMappingInput,
  CsvImportParseOutput,
} from '@repo/shared/schemas/admin/csvImport';

/**
 * Stable data-testid surface the acceptance scenario targets. Pinned
 * verbatim against the Task #689 ACs — the names are part of the test
 * contract and MUST NOT drift.
 */
export const CSV_IMPORT_TEST_IDS = {
  uploadInput: 'admin-csv-upload-input',
  mapping: 'admin-csv-mapping',
  preview: 'admin-csv-preview',
  commitBtn: 'admin-csv-commit-btn',
  status: 'admin-csv-status',
} as const;

/** Known target fields the admin can map a header to. */
export const TARGET_FIELDS = ['email', 'firstName', 'lastName', 'teamName'] as const;
export type TargetField = (typeof TARGET_FIELDS)[number];

/**
 * Working state of the form between parse and commit.
 */
export interface CsvMappingState {
  readonly parse: CsvImportParseOutput | null;
  readonly mapping: Readonly<Record<string, TargetField | null>>;
  readonly fileBase64: string | null;
}

export function emptyState(): CsvMappingState {
  return { parse: null, mapping: {}, fileBase64: null };
}

/**
 * Returns true when the current mapping covers every required target
 * field (`email`, `firstName`, `lastName`). The commit button is
 * disabled until this returns true.
 */
export function isMappingComplete(mapping: CsvMappingState['mapping']): boolean {
  const targets = new Set(Object.values(mapping).filter((v): v is TargetField => v !== null));
  return targets.has('email') && targets.has('firstName') && targets.has('lastName');
}

/**
 * Encode a `File`'s bytes as a base64 string. Used as the JSON body of
 * the commit endpoint. Kept here (rather than inline in the .astro
 * file) so the conversion is unit-testable in jsdom.
 */
export async function fileToBase64(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(arrayBuffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

/**
 * Build the strict `{ fileBase64, mapping }` payload the API edge
 * expects. Returns `null` when the prerequisite state is missing.
 */
export function tryBuildCommitPayload(
  state: CsvMappingState,
): { fileBase64: string; mapping: ColumnMappingInput } | null {
  if (!state.fileBase64) return null;
  if (!state.parse) return null;
  if (!isMappingComplete(state.mapping)) return null;
  return { fileBase64: state.fileBase64, mapping: state.mapping };
}

/**
 * Format the post-commit status line shown to the admin.
 * "Imported {N}, reused {N}, failed {N}."
 */
export function formatStatus(opts: {
  rowCount: number;
  successCount: number;
  reusedCount: number;
  errorCount: number;
}): string {
  return `Imported ${opts.successCount} of ${opts.rowCount} rows. Reused ${opts.reusedCount} existing accounts. ${opts.errorCount} errors.`;
}
