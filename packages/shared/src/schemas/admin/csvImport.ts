/**
 * @repo/shared/schemas/admin/csvImport — Zod boundary schemas for the
 * org-admin CSV import surface.
 *
 * Epic #10 / Story #663 / Task #687. Pinned at the API edge
 * (`apps/api/src/routes/v1/admin/csv-import/router.ts`) and at the
 * admin upload page (`apps/web/src/pages/admin/import.astro`). Two
 * shapes:
 *
 *   - `CsvImportCommitInputSchema` — body of POST
 *     `/api/v1/admin/csv-import/commit`. Carries the file (base64-
 *     encoded so the same handler can be exercised by JSON-bodied
 *     contract tests without juggling multipart) and the user-chosen
 *     column mapping. The strict object rejects unknown keys so a
 *     stale client cannot smuggle extra fields past the schema.
 *
 *   - `CsvImportCommitOutputSchema` — `data` payload of a successful
 *     commit. The shape is intentionally tight: row counts plus the
 *     list of platform user ids whose membership was re-used for a
 *     duplicate-email row (`reusedUserIds`). The list is the only
 *     signal we return; per Tech Spec we do NOT leak per-row email
 *     status or the matching peer-org membership.
 *
 * `previewRows` is `string[][]`; `mapping` is `Record<string, string |
 * null>` where the value names a target field (or `null` to ignore).
 */

import { z } from 'zod';

/** Allowed target fields the admin can map a header to. */
export const TARGET_FIELDS = ['email', 'firstName', 'lastName', 'teamName'] as const;
export type TargetField = (typeof TARGET_FIELDS)[number];

/**
 * Required target fields. Mirrors the parser's
 * `REQUIRED_TARGET_FIELDS` — kept in lock-step here so the API edge
 * can reject a mapping that omits a required target without re-
 * importing the parser module.
 */
export const REQUIRED_TARGET_FIELDS = ['email', 'firstName', 'lastName'] as const;

/**
 * Per-header → target-field mapping. A `null` value means "ignore this
 * column"; a `string` value MUST be a known target field. The schema
 * uses `z.record` rather than a fixed shape because the header set
 * varies by upload — the strictness lives on the value side.
 */
export const ColumnMappingSchema = z.record(
  z.string().min(1),
  z.union([z.enum(TARGET_FIELDS), z.null()]),
);
export type ColumnMappingInput = z.infer<typeof ColumnMappingSchema>;

/**
 * Body of `POST /api/v1/admin/csv-import/commit`. The file is sent as
 * base64-encoded text so the handler can be exercised in contract
 * tests with a JSON body — production callers reach the same handler
 * via the upload page, which already encodes the file before posting.
 *
 * `fileBase64` is bounded at 5 MB of decoded bytes (~6.7 MB of base64
 * text). The bound is enforced in the handler, not in the schema, so
 * the rejection carries `PAYLOAD_TOO_LARGE` instead of a generic
 * Zod validation error.
 */
export const CsvImportCommitInputSchema = z
  .object({
    fileBase64: z.string().min(1),
    mapping: ColumnMappingSchema,
  })
  .strict();
export type CsvImportCommitInput = z.infer<typeof CsvImportCommitInputSchema>;

/**
 * Per-row error returned to the admin UI on a failed commit. Shape
 * matches the parser's `ResolveError` plus the importer's own
 * post-validation codes (`EMAIL_INVALID`, `TEAM_NOT_FOUND`).
 */
export const CsvImportRowErrorSchema = z.object({
  rowIndex: z.number().int(),
  code: z.string().min(1),
  field: z.string().min(1).optional(),
});
export type CsvImportRowError = z.infer<typeof CsvImportRowErrorSchema>;

/**
 * `data` payload of a successful commit. `rowCount` is the total
 * data-row count parsed from the upload; `successCount` is the
 * number of athlete-membership rows the transaction inserted (which
 * equals successful-new + successful-reused); `reusedUserIds` lists
 * the platform user ids whose account was re-used because the
 * imported email already existed.
 */
export const CsvImportCommitOutputSchema = z.object({
  batchId: z.string(),
  rowCount: z.number().int().min(0),
  successCount: z.number().int().min(0),
  errorCount: z.number().int().min(0),
  reusedUserIds: z.array(z.string()),
});
export type CsvImportCommitOutput = z.infer<typeof CsvImportCommitOutputSchema>;

/**
 * `data` payload of a successful parse. Mirrors the parser's
 * `ParseCsvResult`.
 */
export const CsvImportParseOutputSchema = z.object({
  headers: z.array(z.string()),
  previewRows: z.array(z.array(z.string())),
});
export type CsvImportParseOutput = z.infer<typeof CsvImportParseOutputSchema>;
