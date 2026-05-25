# encoding-fuzz

Probe how the surface handles unusual character encodings, byte-order
marks, control characters, RTL overrides, and emoji. Encoding bugs are a
prolific source of silently-accepted bad data and downstream rendering
defects.

## When to apply

Apply to any surface that accepts free-text input, parses uploaded files
(CSV, JSON, images with metadata), renders user-provided strings in the
UI, or round-trips strings through email, PDF, or log channels. Always
apply to file-upload paths — file encoding is the most common attack
surface for round-trip corruption.

## How to apply

Submit inputs that include: a leading UTF-8 BOM (`﻿`), embedded
NUL bytes, Windows-1252 smart quotes interleaved with ASCII, RTL override
(`U+202E`), zero-width joiner / non-joiner, combining diacritics on Latin
letters, surrogate-pair-only emoji, four-byte CJK characters, and a
random sample of Unicode category `Cf` (format) codepoints. For the
`org-admin` CSV import (handled by `packages/shared/src/csv/parse.ts`),
upload a UTF-16-LE CSV (Excel "Save As" produces this by default), a
CSV with a UTF-8 BOM, and a CSV whose header row uses smart quotes that
will not match the canonical column names. For free-text fields on
`/sign-up` and `/admin/*`, paste a name with a combining acute accent
and a name with an RTL override embedded mid-string.

## Signals of a finding

- The persisted value differs visibly from the submitted value (BOM
  swallowed, smart quote stripped, NUL truncates the rest of the field).
- The same string renders differently across two surfaces (the dashboard
  shows one form; the email/notification shows another).
- A CSV with a non-UTF-8 encoding is silently misinterpreted instead of
  rejected — column headers fail to match and the parser falls through
  to a generic error or, worse, an empty success.
- An RTL override leaks past the surface and reorders unrelated UI text.
