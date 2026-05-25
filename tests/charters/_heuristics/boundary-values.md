# boundary-values

A classic Hendrickson tour: target the edges of every numeric, length, or
range input the surface accepts. Defects cluster at the off-by-one
transition from "accepted" to "rejected".

## When to apply

Apply whenever the surface under test takes user input that has any
numeric range, byte/character length cap, date window, or count limit.
Especially fruitful on forms, import pipelines (CSV cell values), search
filters, pagination controls, and money fields.

## How to apply

Pick each input with an implicit or explicit bound and push it through
`min - 1`, `min`, `min + 1`, `max - 1`, `max`, `max + 1`, plus the
type-relevant extremes (`0`, `-1`, empty string, single character, the
field's declared `maxLength`, the next byte after `maxLength`). For the
`org-admin` CSV import surface (`apps/web/src/pages/admin/import/` driven
by `packages/shared/src/csv/parse.ts`), target the cell-length boundary
the parser declares, the row-count cap, the column-count cap, and the
date range the column validators accept. For age/year-of-birth columns,
push to `1899`, `1900`, `1901` and the current-year-plus-one transition.

## Signals of a finding

- A boundary value is accepted by the client but silently truncated by
  the server (or vice versa).
- The same boundary value produces different outcomes on repeated submits.
- A success banner appears for a value that subsequent reads show was
  rejected.
- The error message names a different bound than the one the UI advertised.
- The persisted row diverges from the submitted value (truncation,
  rounding, sign flip).
