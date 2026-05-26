# Clerk persona bootstrap

> **Status:** stub. The full runbook lands with the QA-corpus persona
> bootstrap Story (deferred). This page exists so every plan and charter
> in the corpus can reference a stable path — `docs/runbooks/clerk-persona-bootstrap.md`
> is the canonical entry the corpus's `prerequisites` blocks point at
> (see [`docs/testing-strategy.md` § QA Corpus](../testing-strategy.md#qa-corpus)).

## Purpose

Every Test Plan and Exploratory Charter in `tests/plans/**` and
`tests/charters/**` declares the prerequisite:

```yaml
- "persona users bootstrapped in Clerk per docs/runbooks/clerk-persona-bootstrap.md"
```

The prerequisite means: before the operator (or the agent runner) drives
the artifact, the Clerk **Test** instance must contain a known-good set
of users covering every persona the corpus exercises — `athlete`,
`coach`, `org-admin`, and `platform-admin`. The corpus does NOT create
these users on the fly; doing so would couple every plan to Clerk's
sign-up surface and slow every run by the email-verification round-trip.

## Personas required

| Persona | Email convention | Role in seed fixture |
|---|---|---|
| `athlete` | the seeded athlete email declared in `packages/shared/src/db/seed.ts` | onboarded athlete (`onboardingCompleted=true`) |
| `coach` | a fresh test coach email mapped to the seeded org via the seed fixture | onboarded coach attached to at least one team |
| `org-admin` | the seeded org-admin email declared in the seed fixture | onboarded org-admin against the seeded fixture org |
| `platform-admin` | a separate fresh email promoted to `dev_admin` via `pnpm --filter @repo/shared exec scripts/seed-dev-admin.mjs` | dev_admin / platform admin |

The exact email addresses and the password used in each Clerk user are
declared in `.env.test.local` (gitignored) and consumed by both the
human operator and the agent runner. The seed script in
`packages/shared/src/db/seed.ts` mirrors the same identifiers when it
inserts the matching internal `users` rows so the Clerk → internal-user
JIT path resolves deterministically.

## Bootstrap procedure (placeholder)

The detailed step-by-step procedure (Clerk dashboard navigation, the
`@clerk/testing` helper, the rate-limit caveats around bulk
provisioning, the cleanup pass after every release) lands with the
follow-up Story. Until then, the working procedure is:

1. Open the Clerk **Test** instance dashboard for this workspace.
2. For each persona row above, create a Clerk user with the email
   declared in `.env.test.local` and a known strong password.
3. Confirm the email manually via the Clerk dashboard (the Test
   instance accepts the dashboard's "mark verified" affordance).
4. Run `pnpm --filter @repo/shared run db:reset && pnpm --filter @repo/shared run db:seed`
   to align the internal `users` rows.
5. For the `platform-admin` persona, additionally run
   `pnpm --filter @repo/shared exec scripts/seed-dev-admin.mjs` to
   promote the user to `dev_admin`.

The corpus's `prerequisites` block is satisfied once every persona is
verified and present in both Clerk and the internal `users` table.

## Where the canonical wording lives

The exact prerequisites text is normalised by Story #876 — see
[`docs/testing-strategy.md` § QA Corpus → Test Plan format](../testing-strategy.md#test-plan-format)
for the authoritative shape. Authors of new plans or charters MUST
copy the three canonical entries verbatim; only charters may append
charter-specific extras (e.g. "browser devtools open to the network
panel").
