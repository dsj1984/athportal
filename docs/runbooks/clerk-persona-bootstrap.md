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

```
readPersonaClerkIds: the following persona(s) are not yet populated …
```

…then one or more keys is still `null` or empty. Re-read Step 2 and confirm every value is a `user_…` string.

### Step 4 — Run `pnpm db:seed` twice

The seed script (`packages/shared/scripts/seed.mjs`) is idempotent — running it twice MUST be a no-op on the second run. Verify that:

```bash
pnpm db:seed
pnpm db:seed
```

Expected: both invocations exit `0` and the second prints "already seeded" diagnostics rather than re-inserting rows. If the second invocation throws a unique-constraint violation, the seed isn't aligned with what Clerk's JIT-provisioner has already created for one of the three personas — most commonly, you signed in as one of the personas in a previous session and Clerk's JIT wrote a row with a different email casing than the seed expects. Reset the local DB (`pnpm db:reset`) and re-run.

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
