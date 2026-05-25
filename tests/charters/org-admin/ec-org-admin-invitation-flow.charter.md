---
id: ec-org-admin-invitation-flow
type: charter
title: Invitation flow — race conditions, email-handling, and expired-token surfaces
domain: org-admin
persona: org-admin
route_prefixes:
  - /admin/invitations
  - /admin/invitations/athlete
  - /admin/invitations/coach
mission: >-
  Probe the invitation flow at /admin/invitations for race conditions
  on concurrent accepts/declines, email-handling edge cases (case
  sensitivity, plus-aliases, unicode local-parts, leading/trailing
  whitespace), and the expired-token surface so a stale or replayed
  acceptance link cannot silently provision a membership.
heuristics:
  - email-collision
  - encoding-fuzz
  - boundary-values
time_box_minutes: 30
safety_constraints:
  environment: local
  mutation_surface:
    - "invitations table"
    - "athlete_memberships table (via accepted athlete invitations)"
    - "coach_assignments table (via accepted coach invitations)"
  required_reset: "pnpm --filter @repo/shared run db:reset && pnpm --filter @repo/shared run db:seed"
prerequisites:
  - "local stack running (pnpm dev)"
  - "DB seeded with a fresh org via pnpm --filter @repo/shared run db:seed"
  - "signed in as a seeded org-admin against the seeded fixture org"
  - "Clerk test channel available so the session can retrieve invitation tokens delivered to test emails"
---

## Mission

The invitation surface at `/admin/invitations` is the org-admin's primary
on-ramp for adding athletes and coaches. Two failure shapes carry the
highest blast radius: (1) a race between two concurrent acceptances
against the same invitation token, which can produce duplicate
memberships or a successful accept against a logically-revoked
invitation; and (2) email-handling defects (case sensitivity, plus-
aliases, leading/trailing whitespace, unicode local-parts) that allow a
single human identity to look like two different invitees — or worse,
allow a second invitation to silently overwrite the first. The mission
of this session is to find paths through the invitation flow where
either shape lands without surfacing a visible error: the operator sees
"invitation sent" or "invitation accepted" while the persisted state
diverges from the intent. A third complementary axis is the expired-
token surface — the acceptance link itself — where a stale, replayed,
or out-of-order token must surface a clear "invitation expired" error
instead of silently provisioning a membership.

## Heuristics

- **email-collision** (`tests/charters/_heuristics/email-collision.md`)
  — probe the invitation form by inviting the same human identity in
  multiple normalised-equivalent forms in rapid succession:
  `Alice@Example.com`, `alice@example.com`, `alice+spring@example.com`,
  ` alice@example.com ` (whitespace padded), and a unicode local-part
  variant. The hypothesis is that the form either accepts both as
  distinct invitations (producing two pending rows for one human) or
  silently overwrites the first invitation token with the second
  (revoking the first without telling the operator). Targets the
  `invitations` table's uniqueness model and the email-normalisation
  step that should run server-side before insert.

- **encoding-fuzz** (`tests/charters/_heuristics/encoding-fuzz.md`) —
  probe email-handling at the encoding boundary: a unicode local-part
  (`josé@example.com`), an IDN domain (`ali@münchen.de`), a punycode
  domain (`ali@xn--mnchen-3ya.de`), and a local-part containing a
  zero-width joiner. The hypothesis is that the surface accepts the
  decoded form on the wire but normalises it differently downstream,
  so the acceptance link delivered by Clerk does not match the row in
  `invitations` and the accept silently 404s — or, conversely,
  matches a *different* row than the operator intended.

- **boundary-values** (`tests/charters/_heuristics/boundary-values.md`)
  — probe the acceptance-token lifecycle by submitting (a) a token
  that was never issued, (b) a token that was issued and then
  revoked, (c) a token that was issued, accepted, and then submitted
  a second time (replay), and (d) two concurrent submissions of the
  same valid token from two browser sessions. Each path must surface
  a clear, user-visible error and must not silently produce a second
  `athlete_memberships` or `coach_assignments` row.

## Notes

Scratchpad. The session runner appends per-snapshot notes here.

## Findings

| id | title | severity | repro | suggested-promotion |
| --- | --- | --- | --- | --- |
