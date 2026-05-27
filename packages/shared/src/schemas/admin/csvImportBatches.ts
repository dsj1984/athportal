/**
 * @repo/shared/schemas/admin/csvImportBatches — Zod boundary schemas
 * for the org-admin "import history" surface
 * (`GET /api/v1/admin/csv-import/batches`).
 *
 * Story #973 F1. Lives in its own module so the wire-shape schemas
 * for the commit/parse edges (sibling `csvImport.ts`) stay inside the
 * ADR-019 maintainability floor when the list endpoint is added.
 *
 * The DB schema mirror is `@repo/shared/db/schema/csvImportBatches`.
 * `createdAt` is serialised as an ISO-8601 string at the wire boundary
 * — the column stores a Unix timestamp.
 */

import { z } from 'zod';

/** Single import-history row. */
export const CsvImportBatchSummarySchema = z.object({
  id: z.string(),
  fileName: z.string(),
  rowCount: z.number().int().min(0),
  successCount: z.number().int().min(0),
  errorCount: z.number().int().min(0),
  createdAt: z.string(),
});
export type CsvImportBatchSummary = z.infer<typeof CsvImportBatchSummarySchema>;

/** `data` payload of `GET /api/v1/admin/csv-import/batches`. */
export const CsvImportBatchListOutputSchema = z.object({
  batches: z.array(CsvImportBatchSummarySchema),
});
export type CsvImportBatchListOutput = z.infer<typeof CsvImportBatchListOutputSchema>;
