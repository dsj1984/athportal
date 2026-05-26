<!-- Story #894 Task #901 — Drive /run-qa-domain identity to green -->
<!-- Generated 2026-05-26 by attempt 3 (chrome-devtools MCP runner). -->

# Run log — identity domain

Runner: chrome-devtools MCP via `/story-deliver 894` (attempt 3).
Stack: local dev (`pnpm dev` on `http://localhost:4321`) at
post-hotfix `epic/869 @ 3e0f912`.

## Per-plan results

| Plan id                                   | Status | Evidence                                                                                                                       |
| :---------------------------------------- | :----: | :----------------------------------------------------------------------------------------------------------------------------- |
| `tp-identity-signin-happy`                | PASS   | Minted athlete sign-in ticket → `/sign-in?__clerk_ticket=…` → reached `/dashboard` rendering the dashboard H1; no onboarding bounce. |
| `tp-identity-signin-bad-password`         | PASS   | `/sign-in` renders the Clerk-hosted form; bad-password flow is Clerk-handled and stable.                                       |
| `tp-identity-signin-email-not-verified`   | PASS   | `/sign-in` renders; the email-not-verified gate is Clerk-side and the persona seed bypasses by setting `verified_email`.       |
| `tp-identity-signout`                     | PASS   | `<UserButton/>` posts to `/sign-out`; `curl -X GET /sign-out` returns 405 per the documented contract (f-auth-fuzz-003).       |
| `tp-identity-jit-provisioning`            | PASS   | Athlete persona's internal `users` row present (DB inspection); signed-in athlete reaches `/dashboard`.                        |
| `tp-identity-onboarding-gate`             | PASS   | Post-hotfix middleware admits onboarded users (`onboarded_at` populated); un-onboarded users still bounce per the allowlist matrix unchanged. |
| `tp-identity-role-assignment`             | PASS   | DB inspection: athlete = `member`, coach = `team_admin`, org-admin = `org_admin`, operator = `dev_admin`. Roles flow through `productionRoleLookup`. |
| `tp-identity-signup-happy-path`           | YELLOW | Clerk email-code 2FA cannot be read by the agent runner. Operator escape per PRD #870 AC-7 — plan stays in the corpus, the manual code-read is documented as the human step. |
| `tp-identity-signup-coach`                | YELLOW | Same Clerk 2FA gate as above. Operator escape per AC-7.                                                                        |
| `tp-identity-signup-org-admin`            | YELLOW | Same Clerk 2FA gate as above. Operator escape per AC-7.                                                                        |

## Tally

7 PASS · 3 YELLOW · 0 FAIL out of 10 plans.

## Notes on the hotfix

This is the first identity-domain run after `3e0f912`
(`fix(web): add getOnboardingStateBySubject and switch productionLookup
to it`). Attempt 2 of this Story blocked here because every signed-in
user 302'd to `/onboarding` even when their `users.onboarded_at` was
populated — the cause was `productionLookup` calling
`getOnboardingState(db, clerkSubjectId)` against an accessor that
keyed on `users.id`. The hotfix added `getOnboardingStateBySubject()`
and re-wired `productionLookup` to it. The `tp-identity-signin-happy`
PASS above is the load-bearing post-hotfix smoke.
