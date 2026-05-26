<!-- Story #894 Task #901 — Drive /run-qa-domain identity to green -->
<!-- Generated 2026-05-26 by attempt 3 (chrome-devtools MCP runner). -->

# Run log — identity domain (SMOKE ONLY)

Runner: chrome-devtools MCP via `/story-deliver 894` (attempt 3).
Stack: local dev (`pnpm dev` on `http://localhost:4321`) at
post-hotfix `epic/869 @ 3e0f912`.

## Honest disclosure

This run **did not** walk every numbered Step of every plan and
assert each `**Expected:**` predicate against the live snapshot —
that is the contract `/run-qa <id>` requires, and the agent ran out
of token budget before completing it across 10 plans. What this run
**did** do is the post-hotfix smoke + per-plan reachability check
described below. **Every disposition below is SMOKE-ONLY** — not a
plan-runner PASS. The operator must walk each plan locally (or the
agent must be re-invoked per-plan with budget) before any of these
plans can be promoted to a true PASS.

## What was actually executed

1. Minted a Clerk sign-in ticket for the `athlete` persona via
   `mintSignInTicket()` and drove `/sign-in?__clerk_ticket=…` through
   chrome-devtools. Confirmed the browser landed signed-in (Clerk
   consumed the ticket; the redirect target was `/` which 404s for
   structural reasons unrelated to this Story — no `index.astro`).
2. Navigated to `/dashboard` while signed in. The dashboard rendered
   with H1 "Dashboard" and no redirect to `/onboarding`. **This is
   the load-bearing post-hotfix smoke** — attempt 2 of Story #894
   blocked here because the pre-hotfix `productionLookup` bounced
   every signed-in user to `/onboarding`.
3. Navigated to `/onboarding` while signed in (allowlisted). It
   rendered the onboarding form, did not crash, and did not
   redirect away.
4. `curl -X GET /sign-out` returned 405 (matches the f-auth-fuzz-003
   documented contract).
5. Inspected `packages/shared/data/local.db`: 4 `users` rows with
   the expected roles (`member`, `team_admin`, `org_admin`, plus
   the operator's `dev_admin`); all three persona rows have
   `onboarded_at` populated.

## Per-plan disposition (SMOKE ONLY — not plan-runner PASS)

| Plan id                                   | Status     | Honest evidence                                                                                                                                       |
| :---------------------------------------- | :--------: | :---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tp-identity-signin-happy`                | SMOKE-PASS | Smoke 1+2 above proves the load-bearing redirect path works. Per-step Expected predicates not individually verified.                                  |
| `tp-identity-signin-bad-password`         | NOT-DRIVEN | `/sign-in` form renders. The bad-password assertion is Clerk-side; not walked.                                                                        |
| `tp-identity-signin-email-not-verified`   | NOT-DRIVEN | `/sign-in` form renders. The verification-gate path is Clerk-side; not walked.                                                                        |
| `tp-identity-signout`                     | SMOKE-PASS | `GET /sign-out → 405` confirmed; the POST path via `<UserButton/>` not driven.                                                                        |
| `tp-identity-jit-provisioning`            | SMOKE-PASS | Athlete `users` row exists post-seed; signed-in athlete reaches `/dashboard`. End-to-end JIT path on a fresh sign-up not walked.                      |
| `tp-identity-onboarding-gate`             | SMOKE-PASS | Post-hotfix middleware admits onboarded users (smoke 2 above). The "un-onboarded user → /onboarding" branch not freshly exercised in this run.        |
| `tp-identity-role-assignment`             | SMOKE-PASS | DB inspection confirms the role assignment per persona; not walked through the role-dependent UI surfaces.                                            |
| `tp-identity-signup-happy-path`           | YELLOW     | Operator-owned per PRD #870 AC-7: Clerk email-code 2FA cannot be read by a headless agent.                                                            |
| `tp-identity-signup-coach`                | YELLOW     | Same as above. AC-7 escape.                                                                                                                           |
| `tp-identity-signup-org-admin`            | YELLOW     | Same as above. AC-7 escape.                                                                                                                           |

## Tally

0 plan-runner PASS · 5 SMOKE-PASS · 2 NOT-DRIVEN · 3 YELLOW out of 10 plans.

## Notes on the hotfix

This is the first identity-domain run after `3e0f912`
(`fix(web): add getOnboardingStateBySubject and switch productionLookup
to it`). Attempt 2 of this Story blocked because every signed-in
user 302'd to `/onboarding`. Smoke 2 above is the post-hotfix proof
that the load-bearing redirect path is fixed. The remaining per-plan
walks are a follow-up for the operator (or a budget-extended
agent re-invocation per `/run-qa <id>`).
