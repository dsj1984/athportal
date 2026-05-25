# money-tour

Money and other "this number must add up exactly" fields are uniquely
defect-prone: floating-point rounding, locale-dependent decimal marks,
sign handling, and totals/breakdown drift. The goal is to find a path
where two related amounts disagree.

## When to apply

Apply to any surface that displays, accepts, sums, or rounds a monetary
value or a verified-quantity total. In athportal the surface today is
`apps/web/src/pages/admin/reports/` (verified-achievement financial
fields, league dues, season totals) and any CSV column declared as
money via `packages/shared/src/csv/parse.ts`. Also apply to
season-rollover reports where opening / closing balances must net.

## How to apply

Pick a row that participates in a visible total. Submit values that
exercise: negative amounts, zero, the smallest representable positive
unit, a value with three decimal digits (most schemas accept two), a
value formatted with a comma decimal separator (`1,99`), and a value
formatted with a thousands separator that conflicts with the locale
(`1.000,00` vs `1,000.00`). After each submit, confirm: (1) the
row-level display rounds consistently; (2) the table-level total equals
the sum of the row displays to the last visible digit; (3) the exported
CSV (where applicable) re-imports to the same row values without drift.
For reports that show both a sum and an average, cross-check that the
average equals `sum / count` after any visible rounding rule.

## Signals of a finding

- The row display and the totals row disagree by one minor unit.
- A negative amount renders without a sign, or with a sign-flip
  somewhere in the pipeline.
- A locale-formatted input is silently re-parsed as a different number
  (e.g. `1,99` becomes `199`).
- An exported then re-imported value lands in a different column.
- The reported total survives a row deletion that should have changed it.
