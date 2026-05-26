---
id: tp-org-admin-invite-coach
type: plan
title: Invite coach by email → invitation acceptance
domain: org-admin
persona: org-admin
surface: web
route_prefixes:
  - /admin/invitations
  - /admin/invitations/coach
est_minutes: 12
prerequisites:
  - "local stack running (pnpm dev)"
  - "DB seeded (pnpm db:seed)"
  - "persona users bootstrapped in Clerk per docs/runbooks/clerk-persona-bootstrap.md"
---

## Setup

- Confirm `pnpm dev` is running at the repo root and the web app is reachable at `http://localhost:4321`. The coach-invite surface lives at `/admin/invitations/coach.astro`, with the invitation index at `/admin/invitations/index.astro`.
- Confirm the local SQLite database has been reset and reseeded since the last destructive run: `pnpm --filter @repo/shared run db:reset && pnpm --filter @repo/shared run db:seed`. This plan writes a row to `invitations` for the seeded org and (on acceptance) a row to `coach_assignments`; start from a clean seed so the post-flow assertions are unambiguous.
- Sign in as the seeded org-admin (`Given I am signed in as "org-admin"`). The header should show the org-admin identity and `/admin/invitations` should render — a 403 / redirect to `/dashboard` indicates the role is wrong and the plan should be aborted.
- Pick a unique test email address for the invited coach (e.g. `e2e-coach+<timestamp>@example.com`) and have the Clerk test channel ready to retrieve the verification code on the acceptance leg. The plan assumes this address has no existing Clerk user and no existing assignment in the seeded org.

## Steps

1. Navigate to `/admin/invitations` and confirm the index renders.
   **Expected:** the invitations index renders with the existing list (or empty state) plus call-to-action controls for both invite-athlete and invite-coach. The org-admin's identity is shown in the header.

2. Click the "invite coach" call-to-action (or navigate to `/admin/invitations/coach` directly).
   **Expected:** the coach-invite form renders with an email input, a team / role selector pre-populated with at least one option from the seeded org's teams, and a submit control. No top-level error banner appears.

3. Enter the unique test email and select one of the seeded teams (and a coach role/level if the build exposes one). Submit the form.
   **Expected:** the form submits without a validation banner. The browser either returns to `/admin/invitations` (with the new invitation listed as pending) or stays on the coach-invite page with a visible success indicator that names the invited email.

4. From `/admin/invitations`, confirm the new invitation row is present with the invited email, the selected team, the coach role type, and a status indicator of pending.
   **Expected:** the invitation appears in the index with the correct email, team, and role. The status reads pending, not accepted, declined, or expired.

5. Open a second browser session (or a private window) so the acceptance leg runs against a fresh, unauthenticated session. Retrieve the invitation acceptance link from the Clerk-delivered email (via the Clerk test channel or the `@clerk/testing` helper) and visit it.
   **Expected:** the acceptance link resolves to a sign-up / accept surface scoped to the invitation. The page shows the invited email pre-filled (or read-only) and a "accept and create account" affordance. No "invitation not found" or "invitation expired" banner is shown.

6. Complete the Clerk sign-up flow for the invited coach (set a strong password, retrieve and submit the verification code through the Clerk test channel) and confirm the acceptance affordance.
   **Expected:** Clerk acknowledges the new account, the invitation transitions to accepted, and the new coach is redirected to the post-sign-up surface (`/onboarding` for a fresh user). No top-level error banner is shown.

7. Complete the onboarding flow with safe placeholder values until the post-onboarding redirect lands.
   **Expected:** the coach lands on the coach landing surface (e.g. `/dashboard` rendered with coach-scoped content). The header shows the invited identity and the persona-gated content is the coach view, not the athlete or org-admin view.

8. Return to the org-admin browser session and reload `/admin/invitations`. Then navigate to `/admin/roster` (or `/admin/teams/<id>/edit` for the selected team) and confirm the new coach is listed against the assigned team.
   **Expected:** the previously-pending invitation now reads accepted. The selected team's roster surface shows the new coach assigned with the role chosen in step 3. No duplicate-coach row is rendered.

## Cleanup

- Sign out of both browser sessions via the `<UserButton/>` menu in the header (the menu posts to `/sign-out`). Never GET `/sign-out` — the route returns 405 Method Not Allowed by design; see `docs/testing-strategy.md` § QA Corpus → Sign-out pattern.
- Delete the Clerk test user for the invited email via the Clerk dashboard (Clerk Test instance) so the plan can be re-run against the same address.
- Reset the DB so the next run starts from a known-clean state: `pnpm --filter @repo/shared run db:reset && pnpm --filter @repo/shared run db:seed`.
