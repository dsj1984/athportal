# email-collision

Email is identity. Probe how the surface treats two different submissions
that resolve to the same canonical address: case differences, dot-
insensitive Gmail variants, plus-tags, comments, and homoglyphs.

## When to apply

Apply to any surface that uses email as a uniqueness key — sign-up,
sign-in, invitation acceptance, CSV-import roster ingestion, and password
reset. Also apply when an email address is treated as a display label
(welcome banners, audit logs) where two visually-distinct addresses
should resolve to the same account.

## How to apply

Pair-author the addresses in advance. Submit one canonical address
through the primary path (e.g. `/sign-up` against
`apps/web/src/pages/sign-up.astro` and the JIT provisioning at
`apps/api/src/middleware/auth.ts`), then attempt to re-register the
following variants and observe whether the surface treats them as the
same identity or a new one: uppercase domain
(`User@Example.COM`), uppercase local part (`USER@example.com`),
Gmail-style dot variant (`u.s.e.r@gmail.com`), plus-tag
(`user+test@example.com`), surrounded whitespace, a homoglyph in the
domain (`user@exаmple.com` with a Cyrillic `а`), and a
quoted local part (`"user"@example.com`). For the `org-admin` CSV
import (handled by `packages/shared/src/csv/parse.ts`), include two
roster rows whose emails collide under one of the above rules and
observe whether the import emits one row, two rows, or a clear
duplicate-rejection error.

## Signals of a finding

- Two visually-distinct addresses produce two accounts where the policy
  says one.
- One canonical address produces two accounts after a case-only edit.
- A Gmail dot-variant or plus-tag is accepted as a new identity when the
  invitation token assumed the canonical form.
- A CSV import row with a colliding email is silently dropped or silently
  merged without surfacing a row-level outcome.
- A homoglyph domain bypasses the domain allowlist on an invitation
  acceptance flow.
