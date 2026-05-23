# Runbook: Seed a `dev_admin` user (local dev)

> **When to use this runbook.** You want to reach `/_internal/styleguide` — the internal design-system reference page — on your local dev machine. The route is gated on `users.role === 'dev_admin'`; this runbook walks the operator through marking their own Clerk-provisioned account with that role.
>
> Story #749 / Task #751 introduced both the script and this runbook. The matching production lookup body landed in Story #749 / Task #752 (`apps/web/src/pages/_internal/styleguide.ts`). The runbook reflects the MVP DB topology — a local SQLite file at `TURSO_URL` (default `file:packages/shared/data/local.db` per `.env.example`). The libSQL/Turso swap lands with Epic #27 and this runbook will be updated alongside it.

---

## Prerequisites

1. **Local SQLite exists and is migrated.** The DB file pointed at by `TURSO_URL` must already exist and have the latest schema applied. If you have never bootstrapped the local DB:

   ```bash
   # From the repo root.
   # 1. Confirm TURSO_URL is set (.env at the repo root inherits from .env.example):
   echo "$TURSO_URL"   # should print: file:packages/shared/data/local.db (or similar)

   # 2. Apply the Drizzle migrations bundled at packages/shared/src/db/migrations/.
   #    (Use the project's standard migration command for your local setup; the
   #    seed script refuses to run against a missing file.)
   ```

2. **Your Clerk account has signed in at least once.** The internal `users` row is created by `requireInternalUser` (the API-side JIT provisioner) on first touch of any `/api/v1/*` route. If you have only loaded a static page and never hit the API, no row exists yet — the script will exit non-zero with a clear error. The fix is to sign in via the local dev app, click any link that calls the API, then re-run the script.

3. **You know the email address Clerk seeded into your row.** This is the email associated with your Clerk user. The script looks the row up by `users.email`, so the value must match the row Clerk's JIT created.

---

## Invocation

```bash
# From the repo root.
node scripts/seed-dev-admin.mjs --email <your-email@example.invalid>
```

The script:

1. Resolves `TURSO_URL` to a SQLite file path (mirrors the resolver in `apps/web/src/lib/db.ts`).
2. Opens the file with `better-sqlite3`.
3. Looks up the row by `email`.
4. If the row already carries `role='dev_admin'`, prints a no-op message and exits `0`. Re-running the script is safe — it is idempotent.
5. Otherwise updates the row to `role='dev_admin'` and exits `0`.

---

## Expected exit behaviour

| Outcome                                              | stdout / stderr                                              | Exit code |
| ---------------------------------------------------- | ------------------------------------------------------------ | --------- |
| Match found, role updated                            | `Updated user '<email>' (was role='<prev>') to role='dev_admin'.` | `0`       |
| Match found, role already `dev_admin` (no-op)        | `No-op: user '<email>' is already dev_admin.`                | `0`       |
| No row matches the email                             | `No user row matches email='<email>'. Sign in once via Clerk …` (stderr) | `1`       |
| `TURSO_URL` unset / points at a `libsql://` endpoint | Diagnostic on stderr; no DB connection opened                | `1`       |
| SQLite file missing at the resolved path             | Diagnostic on stderr; no DB connection opened                | `1`       |
| Unknown flag / missing `--email`                     | Usage banner on stderr                                       | `1`       |

The script always closes the DB handle on the way out (success or failure) so a re-run never collides with a held file lock.

---

## Verification

After a successful run:

1. Sign in to the local dev app with the same Clerk account.
2. Navigate to `/_internal/styleguide`.
3. Confirm the page renders (you should see the design-system reference content, not a redirect to `/`).

If you still get redirected, double-check:

- The email passed to the script exactly matches `users.email` for your row.
- You are signed in to Clerk in the same browser session.
- The Astro dev server has been restarted since the row was updated (the `getDb()` handle is cached at module scope; restarting the server clears the cache).

---

## Reverting

There is no built-in revert command. To demote a `dev_admin` row back to its previous role, run the matching SQL by hand against `TURSO_URL` or write a one-off:

```bash
sqlite3 "$(node -e "const r=process.env.TURSO_URL;process.stdout.write(r.startsWith('file:')?r.slice(5):r)")" \
  "UPDATE users SET role = 'member' WHERE email = '<your-email>';"
```

Production rollback is governed by [`docs/runbooks/rollback.md`](./rollback.md) — `dev_admin` is intentionally never assigned automatically in production environments.

---

## Related

- `apps/web/src/pages/_internal/styleguide.ts` — the gate the role read powers.
- `apps/web/src/lib/db.ts` — the shared lazy Drizzle handle the gate uses.
- `apps/api/src/middleware/auth.ts` — the JIT provisioner that creates the initial row Clerk's first sign-in needs.
- PRD #742 / Tech Spec #743 — Foundation hardening Epic #741 context.
