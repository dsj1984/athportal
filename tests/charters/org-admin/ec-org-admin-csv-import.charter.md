---
id: ec-org-admin-csv-import
type: charter
title: CSV import — silently-accepted bad data
domain: org-admin
persona: org-admin
route_prefixes:
  - /admin/import
mission: >-
  Find ways the CSV import surface accepts malformed, ambiguous, or
  out-of-range data without surfacing a visible error.
heuristics:
  - boundary-values
  - encoding-fuzz
  - form-fuzz
time_box_minutes: 30
safety_constraints:
  environment: local
  mutation_surface:
    - "csv_import_batches table"
    - "athlete_memberships table"
  required_reset: "pnpm --filter @repo/shared run db:reset && pnpm --filter @repo/shared run db:seed"
prerequisites:
  - "local stack running (pnpm dev)"
  - "DB seeded with a fresh org via pnpm --filter @repo/shared run db:seed"
  - "signed in as a seeded org-admin against the seeded fixture org"
---

## Mission

The CSV import surface at `/admin/import` is the org-admin's primary
data-on-ramp: a single bad upload can populate `csv_import_batches`
with a phantom batch and write spurious rows into `athlete_memberships`
that then drive downstream rosters, reports, and invitations. The
mission of this session is to find paths through the surface where bad
data is accepted without a visible row-level error — the operator sees
"import succeeded" while the persisted state diverges from the file's
intent. Defects of this shape are far more dangerous than an obvious
parse crash because they are unlikely to be noticed at upload time and
will surface later as a roster, reporting, or invitation defect that is
hard to trace back to the import.

## Heuristics

- **boundary-values** (`tests/charters/_heuristics/boundary-values.md`)
  — probe the CSV import surface by pushing every column with a numeric
  or length bound through its declared min/max and the adjacent
  off-by-one values. Targets the cell-length cap declared by
  `packages/shared/src/csv/parse.ts`, the row-count cap enforced by
  `packages/shared/src/schemas/admin/csvImport.ts`, the year-of-birth /
  age boundary at the 1899 ↔ 1900 transition, and the column count.
  Confirm each boundary is enforced symmetrically: a value accepted by
  the client must persist exactly as submitted, and a value rejected by
  the server must surface a row-level error the operator can see.

- **encoding-fuzz** (`tests/charters/_heuristics/encoding-fuzz.md`) —
  upload CSVs whose encoding deviates from the parser's assumptions:
  a UTF-16-LE CSV (Excel "Save As" default), a UTF-8 file with a
  leading BOM, a CSV whose header row uses Windows-1252 smart quotes,
  and a row containing an embedded NUL byte. The hypothesis is that
  one of these encodings is silently misinterpreted and either drops
  the affected rows without surfacing a row-level error, or — worse —
  matches a different column than the human author intended.

- **form-fuzz** (`tests/charters/_heuristics/form-fuzz.md`) — substitute
  wrong-type values into each column on a row-by-row basis: a phone
  number in an email column, a date string in a name column, an HTML
  fragment in a free-text column, and a value longer than the column's
  declared `maxLength` cap. The probe is intentionally orthogonal to
  the field-level validators — the goal is to find a row whose
  individual field errors do not aggregate into a row-level rejection,
  so the row is silently dropped or silently persisted with the bad
  value coerced.

## Notes

Scratchpad. The session runner appends per-snapshot notes here.

## Findings

| id | title | severity | repro | suggested-promotion |
| --- | --- | --- | --- | --- |
