# Runbook: Bootstrap Clerk personas for the QA corpus

> **When to use this runbook.** You are setting up a developer machine, a CI runner, or a fresh Clerk **Test** instance and need the three core QA personas — `athlete`, `coach`, `org-admin` — to exist so the QA-corpus agent runner can mint sign-in tickets for them and drive Test Plans / Exploratory Charters without going through email-code 2FA on every run.
>
> Story #881 / Task #895 turned the prior stub (created in Story #876) into the full bootstrap procedure. The matching machinery is the persona-ID reader (`packages/shared/src/testing/clerkPersonas.ts`, Task #893) and the `mintSignInTicket()` helper (`packages/shared/src/testing/clerkTickets.ts`, Task #897). PRD #870 / Tech Spec #871 — Epic #869 (athportal QA-corpus agent runner) — explain why the runner uses a sign-in-token flow instead of a password-based login.

---

## What this runbook produces

When the procedure below completes successfully:

1. The Clerk **Test** instance for this workspace contains three users:

   | Persona     | Email                  | Verified |
   | ----------- | ---------------------- | -------- |
   | `athlete`   | `athlete@example.com`  | yes      |
   | `coach`     | `coach@example.com`    | yes      |
   | `org-admin` | `org-admin@example.com`| yes      |

2. Each user's Clerk subject ID (the public `user_…` identifier Clerk prints in every JWT `sub` claim) is pasted into `packages/shared/src/testing/clerk-personas.json` against the matching key.
3. `pnpm --filter @repo/shared exec vitest run src/testing/clerkPersonas.test.ts` passes.
4. `pnpm db:seed` runs cleanly twice — proving the seed's internal `users` rows align with the Clerk JIT-provisioned rows.

Once the procedure is complete the QA runner can mint sign-in tickets for any of the three personas via `mintSignInTicket({ persona: 'athlete' | 'coach' | 'org-admin' })`.

---

## Prerequisites

1. **You have access to the Clerk dashboard for this workspace's Test instance.** The runbook will not work against a Production instance — the `mintSignInTicket()` helper refuses to run when `CLERK_SECRET_KEY` does not start with `sk_test_`. If you don't have dashboard access yet, ask the operator (`@dsj1984`) to add you.
2. **Your local repo is on a branch with the persona-ID reader landed.** Confirm `packages/shared/src/testing/clerk-personas.json` exists and starts as:

   ```json
   {
     "athlete": null,
     "coach": null,
     "org-admin": null
   }
   ```

3. **The local SQLite DB is migrated.** Run `pnpm dev` once (it invokes `scripts/dev-preflight.mjs`, which creates and migrates `packages/shared/data/local.db` on first run) and stop the dev server. You don't need the server running for the rest of the runbook, only the migrated schema.

---

## Why subject IDs are tracked, but secret keys are not

Clerk's subject ID (the `sub` claim, prefixed `user_`) is a **public identifier**. It appears in every JWT Clerk issues and is visible in URLs the Clerk dashboard exposes. Persisting subject IDs in `packages/shared/src/testing/clerk-personas.json` (a tracked file) is intentional and safe.

The matching **secret** — the Clerk Backend SDK key — lives only in `CLERK_SECRET_KEY`, set in `.env` locally and in GitHub Actions secrets for CI. The tracked JSON never contains a secret. Tickets minted by `mintSignInTicket()` are never written to disk or logged.

If you ever find yourself about to paste a `sk_test_…` or `sk_live_…` value into the tracked JSON file: **stop.** That is the secret-key value, not the subject ID.

---

## Repo-visibility assumption

**This runbook assumes the project is a private repository.** Committing real Clerk subject IDs to `clerk-personas.json` is safe under that assumption: subject IDs are public identifiers in Clerk's threat model (the `sub` JWT claim, visible in dashboard URLs) and they cannot be used to authenticate as the persona. The `sk_test_` boundary on `mintSignInTicket()` ensures the IDs only resolve against the Clerk **test** instance.

The committed IDs become a privacy concern only if the threat model widens — for example, if the repo becomes public. Clerk's API permits `users.lookupByIdentifier` against the issuing instance, which can map a subject ID to its email; a fully-public repo therefore exposes the test-instance personas' emails to anyone who can clone the repo. For this project's `@example.com` synthetic emails the impact is bounded, but the same pattern applied to real PII would be a leak.

### Before any visibility change to public

Rotate the test-instance personas before flipping the repo's visibility:

1. **Create new personas in the Clerk dashboard.** Use the same three canonical emails (`athlete@example.com`, `coach@example.com`, `org-admin@example.com`), but mark the OLD personas inactive first so Clerk's uniqueness check accepts the new ones. (Clerk's email-uniqueness rules treat the synthetic `@example.com` addresses as unique; rotation through soft-delete is the supported path.) Set a fresh strong password on each new persona; verify each email manually.
2. **Delete the old personas** from the Clerk dashboard. Clerk hard-deletes test-instance users; no soft-delete revival is possible afterwards.
3. **Replace the subject IDs** in `packages/shared/src/testing/clerk-personas.json` with the new `user_…` values, following Step 2 of the Procedure below.
4. **Reset the local DB** so seeded rows align with the new subject IDs: `pnpm db:reset` (or `pnpm db:seed` if migrations are already current).
5. **Commit the new IDs** to a branch and merge to `main` BEFORE the visibility flip. After the visibility flip, the old IDs are publicly visible in git history — at minimum they should no longer resolve to active Clerk users.
6. **If the repo has had public exposure already** (e.g. accidental leak, prior public state), treat the rotation as urgent and rotate the Clerk **test-instance secret key** (`CLERK_SECRET_KEY`) in the same step — the key never appears in the repo, but a leaked subject ID combined with an attacker who can guess or reuse the secret-key value would be an escalation path.

### If the runbook reader is contributing from a fork

A fork of a private repo is also private (GitHub mirrors the original visibility). A fork of a public version of this repo would inherit the leaked subject IDs but would not have the matching `CLERK_SECRET_KEY` — meaning a fork-based attacker cannot mint tickets. The rotation procedure above is the operator's mitigation for the original-repo visibility flip; forks inherit the rotated IDs at the next pull.

---

## Procedure

### Step 1 — Create the three personas in the Clerk dashboard

For each row in the table below, open the Clerk dashboard's "Users → Create user" form and create the persona:

| Persona     | Email                  | Password                          |
| ----------- | ---------------------- | --------------------------------- |
| `athlete`   | `athlete@example.com`  | a strong password you control     |
| `coach`     | `coach@example.com`    | a strong password you control     |
| `org-admin` | `org-admin@example.com`| a strong password you control     |

For each user:

1. Click **Create user**.
2. Enter the email exactly as above. The seed fixture in `packages/shared/scripts/seed.mjs` references these three addresses verbatim; any deviation breaks the seed/Clerk alignment.
3. Set a strong password. The runner never uses this password (it mints sign-in tickets instead), but Clerk requires one at creation time.
4. **Verify the email manually.** In the Test instance, the user-detail page exposes a "Mark email verified" action — click it. Without verification, Clerk's frontend will refuse to honour sign-in tickets for the user.

> **Why these exact emails?** `packages/shared/scripts/seed.mjs` seeds three internal `users` rows keyed on these emails. When the runner mints a sign-in ticket and drives a sign-in, Clerk's JIT-provisioner upserts the matching internal `users` row by email — if the email doesn't match the seed, the runner sees a stranger user and the corpus assertions fail.

### Step 2 — Copy each user's subject ID into `clerk-personas.json`

For each user you just created:

1. Click into the user's detail page in the Clerk dashboard.
2. Locate the **User ID** field. It looks like `user_2abc123XYZ…` (the `user_` prefix is literal).
3. Copy that value.
4. Open `packages/shared/src/testing/clerk-personas.json` in your editor and replace `null` for the matching persona with the copied string:

```json
{
  "athlete": "user_2abcAthletePlaceholder",
  "coach": "user_2abcCoachPlaceholder",
  "org-admin": "user_2abcOrgAdminPlaceholder"
}
```

Save the file. **Do not commit it yet** — the reader test (next step) is the gate that catches typos before they hit `main`.

> **Tip — distinguishing subject IDs from session IDs.** Clerk's dashboard sometimes shows a `sess_…` value on the user-detail page (the user's current active session). That is not the subject ID. The subject ID is always prefixed `user_`. If you paste a `sess_` value, the reader will accept it as a string but the runner's first ticket-mint call will fail with a Clerk API error.

### Step 3 — Verify the reader resolves all three personas

From the repo root:

```bash
pnpm --filter @repo/shared exec vitest run src/testing/clerkPersonas.test.ts
```

The test suite is hermetic (it uses dependency injection rather than the real file), so it passes regardless of whether the JSON is populated. The verification that **does** depend on the populated JSON is a one-liner you run in the same shell:

```bash
node --input-type=module -e "import('@repo/shared/testing').then(({ readPersonaClerkIds }) => { const ids = readPersonaClerkIds(); console.log(JSON.stringify(ids, null, 2)); })"
```

Expected output:

```json
{
  "athlete": "user_2abcAthletePlaceholder",
  "coach": "user_2abcCoachPlaceholder",
  "org-admin": "user_2abcOrgAdminPlaceholder"
}
```

If you see an error message that begins:

```text
readPersonaClerkIds: the following persona(s) are not yet populated …
```

…then one or more keys is still `null` or empty. Re-read Step 2 and confirm every value is a `user_…` string.

### Step 4 — Reset and re-seed the local DB so it links to your real Clerk personas

> **Why this step is mandatory.** After Story #942, `packages/shared/scripts/seed.mjs` reads the populated `clerk-personas.json` at seed time and writes your operator-curated `user_…` subject IDs into the `users.clerk_subject_id` column. **A local DB that was seeded before you populated the JSON still carries the stub `user_test_*` values** — your real Clerk session's `sub` claim will not match any row, and `requireInternalUser` will JIT-provision a stranger row with no team assignment (every authenticated `/api/v1/*` request lands on the onboarding gate instead of the seeded coach team). Re-running the seed is the only way to relink.

From the repo root:

```bash
pnpm --filter @repo/shared run db:reset && pnpm --filter @repo/shared run db:seed
```

`db:reset` re-creates `packages/shared/data/local.db` from a clean schema; the chained `db:seed` then writes the legal-documents + persona-graph fixtures, with your real Clerk subject IDs from `clerk-personas.json` flowing into `users.clerk_subject_id`.

Verify idempotence by running `pnpm --filter @repo/shared run db:seed` a second time — it must exit `0` with no inserted rows (the seed uses `ON CONFLICT(id) DO NOTHING` for every table).

If the seed throws an error that begins:

```text
seed: the following persona(s) are not yet populated in …/clerk-personas.json: …
```

…re-read Step 2. The seed refuses to silently fall back to stub IDs when the JSON is present-but-partially-populated, because that is exactly the state PR #940's manual-QA walkthrough surfaced as a 500 on every authenticated request.

---

## Expected exit behaviour for `readPersonaClerkIds()`

| Outcome                                                  | Behaviour                                                                                                        |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| All three personas populated                             | Returns a frozen `{ athlete, coach, "org-admin" }` record of subject IDs.                                          |
| One or more personas still `null` / empty                | Throws `Error` naming the missing personas and pointing at this runbook.                                          |
| `clerk-personas.json` missing on disk                    | Throws `Error: cannot read …` naming the file path and this runbook.                                              |
| `clerk-personas.json` is malformed JSON                  | Throws `Error: not valid JSON …` naming the file and this runbook.                                                |
| `clerk-personas.json` has a value of the wrong type      | Throws `Error: key '<persona>' must be a string or null …`.                                                       |

Every error message names `docs/runbooks/clerk-persona-bootstrap.md` so an operator who only sees the error in CI logs can find their way back here.

---

## Reverting

There is no built-in "un-bootstrap" command. To reset:

1. Delete the three users in the Clerk dashboard. Clerk hard-deletes test-instance users; no soft-delete revival is possible afterwards.
2. Reset the local DB: `pnpm db:reset`.
3. Restore `packages/shared/src/testing/clerk-personas.json` to its all-`null` shape:

   ```bash
   git checkout HEAD -- packages/shared/src/testing/clerk-personas.json
   ```

Production rollback is not applicable — this runbook only targets the Clerk Test instance.

---

## Related

- [`packages/shared/src/testing/clerkPersonas.ts`](../../packages/shared/src/testing/clerkPersonas.ts) — the reader; throws actionable errors when JSON is unpopulated.
- [`packages/shared/src/testing/clerk-personas.json`](../../packages/shared/src/testing/clerk-personas.json) — the tracked JSON that holds the populated subject IDs.
- [`packages/shared/src/testing/clerkTickets.ts`](../../packages/shared/src/testing/clerkTickets.ts) — `mintSignInTicket()`; the helper the QA runner calls per-scenario. Enforces the `sk_test_` env-prefix guard.
- [`packages/shared/scripts/seed.mjs`](../../packages/shared/scripts/seed.mjs) — the seed that inserts the three matching internal `users` rows by email.
- [`docs/runbooks/seed-dev-admin.md`](./seed-dev-admin.md) — sister runbook for promoting a Clerk-provisioned account to `dev_admin`; the structure of this runbook mirrors that one.
- PRD #870 / Tech Spec #871 — Epic #869 (athportal QA-corpus agent runner) context.
- [`docs/testing-strategy.md` § QA Corpus](../testing-strategy.md#qa-corpus) — explains why every Test Plan and Charter declares "persona users bootstrapped in Clerk per docs/runbooks/clerk-persona-bootstrap.md" as a prerequisite.
