---
id: ec-org-admin-season-rollover
type: charter
title: Season rollover — stale references and orphaned memberships
domain: org-admin
persona: org-admin
route_prefixes:
  - /admin/rollover
mission: >-
  Probe the season rollover surface at /admin/rollover for stale-
  reference and orphaned-membership defects: athletes whose teams no
  longer exist after the rollover, coaches whose assignments dangle,
  and fee or roster rows that remain attached to archived teams. The
  goal is to find paths where the apply step succeeds at the UI layer
  while the persisted state contains references that no longer resolve.
heuristics:
  - boundary-values
  - money-tour
  - landmark-tour
time_box_minutes: 30
safety_constraints:
  environment: local
  mutation_surface:
    - "teams table"
    - "athlete_memberships table"
    - "coach_assignments table"
    - "csv_import_batches table (rows that reference rolled or archived teams)"
  required_reset: "pnpm --filter @repo/shared run db:reset && pnpm --filter @repo/shared run db:seed"
prerequisites:
  - "local stack running (pnpm dev)"
  - "DB seeded (pnpm db:seed)"
  - "persona users bootstrapped in Clerk per docs/runbooks/clerk-persona-bootstrap.md"
  - "seeded org has at least two teams from a prior season with athletes and coaches assigned so the rollover preview is non-empty"
---

## Mission

The season-rollover surface at `/admin/rollover` mutates four tables
in a single apply step (`teams`, `athlete_memberships`,
`coach_assignments`, and the rows in `csv_import_batches` that
reference the prior season's teams). The mission of this session is to
find paths where the apply step succeeds at the UI layer — the
operator sees "rollover complete" — while the persisted state contains
broken references: an athlete whose `team_id` points at a team that
was archived in the same transaction, a coach whose
`coach_assignments` row references a team that the rollover dropped, or
a `csv_import_batches` row that still references a season that no
longer has any active teams. Defects of this shape are particularly
dangerous because the org-admin sees a "rolled over" success state
while the downstream rosters, reporting, and invitation surfaces start
returning empty or partial results in ways that are hard to trace back
to the rollover. The plan-builder lives at
`packages/shared/src/rollover/buildPlan.ts` — that module is the
source of truth for what *should* roll forward; this session probes
the surface that consumes that builder.

## Heuristics

- **boundary-values** (`tests/charters/_heuristics/boundary-values.md`)
  — probe the rollover at the age-up boundary. The seeded fixture
  includes athletes whose birth dates straddle the bracket cutoff;
  probe the preview and apply against (a) an athlete whose birth date
  is exactly on the cutoff, (b) one day before, and (c) one day
  after. Each athlete must land in exactly one bracket post-rollover
  — never two, never zero. Probe the same way against the season
  cutoff dates declared by `buildPlan.ts`.

- **money-tour** (`tests/charters/_heuristics/money-tour.md`) — probe
  every fee, dues, or financial obligation that references a rolled
  or archived team. The hypothesis is that a fee row continues to
  reference an archived team's id after the apply, so the operator's
  reporting surface reads "team X has $N outstanding" for a team that
  no longer exists in `/admin/teams`. Walk every page that displays
  a money figure and confirm the figure ties back to a still-active
  team in the post-rollover state.

- **landmark-tour** (`tests/charters/_heuristics/landmark-tour.md`) —
  starting from `/admin/rollover` post-apply, walk each major
  org-admin surface in turn (`/admin/teams`, `/admin/roster`,
  `/admin/invitations`, `/admin/reports`) and confirm each landing
  page is internally consistent with the post-rollover state. A
  defect of the shape "rollover claims team X archived, but
  `/admin/roster` still lists athletes against team X" is the
  load-bearing finding for this heuristic.

## Notes

Scratchpad. The session runner appends per-snapshot notes here.

## Findings

| id | title | severity | repro | suggested-promotion |
| --- | --- | --- | --- | --- |
