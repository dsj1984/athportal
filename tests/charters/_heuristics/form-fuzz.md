# form-fuzz

Generic form-input fuzzing: combine boundary values, encoding tricks, and
semantic confusions to drive each field through values its validators
were not designed to anticipate. The goal is the silent acceptance, not
the obvious crash.

## When to apply

Apply to any form-based surface — sign-up at `/sign-up`, onboarding at
`/onboarding`, team CRUD under `/admin/org`, invitation acceptance, CSV
import, and any settings page. Especially valuable on forms that mix
free-text, numeric, date, and select inputs, where validators are often
authored field-by-field but rarely audited as a whole.

## How to apply

For each field on the form: (1) submit the empty string and a single
whitespace; (2) submit a value longer than the visible field's
`maxLength`; (3) submit a value whose semantic type does not match the
field's intended type (a phone number in an email field, a date in a
free-text name); (4) paste a value containing HTML (`<script>alert(1)`),
SQL (`'; DROP TABLE`), and shell metacharacters; (5) for selects with
client-side options, replace the value in devtools with a value the
select never offered. Submit each combination both individually and as
part of an otherwise-valid submit so server-side validation order is
exercised. On the CSV import (`packages/shared/src/csv/parse.ts` and
`packages/shared/src/schemas/admin/csvImport.ts`), perform the same
substitutions row-by-row to confirm row-level validation tracks
field-level validation.

## Signals of a finding

- A submit succeeds with a value the client validator should have
  rejected.
- The server accepts a field whose type is wrong and persists the wrong
  type (a string in an integer column rendered as `NaN` downstream).
- The surface renders an unsanitized HTML fragment from one of the
  injection payloads.
- A row-level CSV error suppresses a different row-level error on the
  same row (only the first violation reported; the second silently
  applied).
- Submitting the same form twice in quick succession bypasses validation
  on the second submit (race condition between client and server checks).
