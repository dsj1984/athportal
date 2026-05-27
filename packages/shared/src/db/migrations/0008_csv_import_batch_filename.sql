-- Migration 0008 — add `file_name` column to `csv_import_batches`
--
-- Story #973 (F1). The admin "import history" surface (and the
-- exploratory plan `tp-org-admin-csv-import-happy` Step 6) expects the
-- original upload filename to be visible against each batch. The
-- column was missing from migration 0006, so this forward migration
-- backfills it.
--
-- SQLite cannot add a NOT NULL column without a default. `''` (the
-- empty string) is used so any rows that pre-date this migration
-- remain valid; new batches inserted by `csv-import/commit` always
-- pass a non-empty value via the application-side `fileName` field on
-- `CsvImportCommitInputSchema`, which Zod constrains to `min(1)`.

ALTER TABLE `csv_import_batches` ADD COLUMN `file_name` text DEFAULT '' NOT NULL;
