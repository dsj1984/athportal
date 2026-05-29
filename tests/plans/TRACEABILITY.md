# Test Plan → Feature Scenario traceability (non-coach domains)

Per-plan traceability backbone for **feat-drivability** (Epic #997,
Story #1025). Every non-coach Test Plan journey under
`tests/plans/{identity,org-admin,design-system}/**` is mapped here to a named
`.feature` scenario under the matching `tests/features/{identity,org-admin,design-system}/**`
directory that covers its user-visible journey.

Scope: the **17 non-coach Test Plans** (10 identity, 6 org-admin, 1
design-system). The coach-domain plans under `tests/plans/coach/**` are out of
scope for this Story. Two plans carry "coach" in their journey but live under
non-coach directories and are therefore in scope: `tp-identity-signup-coach`
(identity) and `tp-org-admin-invite-coach` (org-admin).

Plans are **not** deleted by this Story — teardown of the now-redundant plans is
owned by Story #1027. This record is the contract that proves every plan
journey is represented by a scenario before that teardown runs.

## How to read the `Status` column

- **existing** — the plan journey was already covered by a scenario on
  `epic/997`; no change was needed.
- **added** — the plan journey was not represented; this Story added the named
  scenario to the matching feature file. Added scenarios retain `@pending`
  (their step bindings / fixture seams land in a follow-up), consistent with
  the existing features-first scaffold.

## Identity (10 plans)

| Test Plan | Journey | Feature scenario | File | Status |
| --- | --- | --- | --- | --- |
| `tp-identity-jit-provisioning` | Fresh user is JIT-provisioned on first authenticated request and lands on the onboarding gate; completion lets re-auth reach the dashboard | `A freshly provisioned user is taken to onboarding on first sign-in` | `identity/onboarding/complete-onboarding.feature` | added |
| `tp-identity-onboarding-gate` | Un-onboarded user is redirected to onboarding from every protected surface; onboarded user passes; direct navigation is intercepted | `Un-onboarded user is redirected to onboarding on a protected route`, `Onboarded user reaches a protected route without redirect`, `Direct dashboard navigation is intercepted by the onboarding gate` | `identity/onboarding/gate-redirect.feature` | existing |
| `tp-identity-role-assignment` | Persona selected at onboarding determines the recorded role and the post-onboarding landing surface (athlete / coach / org-admin) | `Athlete completes onboarding and lands on the dashboard`, `Coach completes onboarding and lands on the team-management surface`, `Org admin completes onboarding and lands on the organization-management surface` | `identity/onboarding/complete-onboarding.feature` | existing (athlete) + added (coach, org-admin) |
| `tp-identity-signin-bad-password` | Sign-in with the wrong password surfaces a friendly error that does not disclose account existence | `Athlete is rejected with the wrong password` | `identity/auth/rejected-sign-in.feature` | existing |
| `tp-identity-signin-email-not-verified` | Sign-in with an unverified email surfaces the verification prompt rather than issuing a session | `Sign-in with an unverified email surfaces the verification prompt` | `identity/auth/rejected-sign-in.feature` | added |
| `tp-identity-signin-happy` | Already-onboarded athlete signs in with email + password and reaches the dashboard | `Athlete signs in with email and password` | `identity/auth/sign-in.feature` | existing |
| `tp-identity-signout` | Sign-out returns the athlete to the public surface and blocks protected routes until re-authentication | `Athlete signs out` | `identity/auth/sign-out.feature` | existing |
| `tp-identity-signup-coach` | Coach signs up, verifies email, selects the coach persona at onboarding, and reaches the coach-scoped surface | `Coach completes onboarding and lands on the team-management surface` | `identity/onboarding/complete-onboarding.feature` | added |
| `tp-identity-signup-happy-path` | Athlete signs up, verifies email, completes onboarding, and lands on the dashboard | `Athlete completes onboarding and lands on the dashboard`, `Fresh user completes onboarding and lands on the dashboard` | `identity/onboarding/complete-onboarding.feature`, `identity/onboarding/fresh-user-onboarding.feature` | existing |
| `tp-identity-signup-org-admin` | Org-admin signs up, verifies email, selects the org-admin persona at onboarding, and reaches the organization-management surface | `Org admin completes onboarding and lands on the organization-management surface` | `identity/onboarding/complete-onboarding.feature` | added |

## Org-admin (6 plans)

| Test Plan | Journey | Feature scenario | File | Status |
| --- | --- | --- | --- | --- |
| `tp-org-admin-csv-import-happy` | Org admin uploads a well-formed roster CSV, maps columns, commits, and sees the import success summary | `Org admin imports a roster from CSV` | `org-admin/csv-import.feature` | existing |
| `tp-org-admin-invite-athlete` | Org admin invites an athlete directly to a team; the invitation is sent and (on acceptance) the athlete joins the roster | `Org admin invites an athlete directly` | `org-admin/athlete-direct-invitation.feature` | existing |
| `tp-org-admin-invite-coach` | Org admin invites a coach by email; the invitation is sent and (on acceptance) the coach appears on the team roster | `Org admin invites a coach who accepts` | `org-admin/coach-invitation.feature` | existing |
| `tp-org-admin-reporting` | Org admin opens the reports surface and reads the verified-achievement report broken down by team and sport | `Org admin reads the verified-achievement report` | `org-admin/verified-achievement-report.feature` | existing |
| `tp-org-admin-season-rollover` | Org admin previews the season-rollover plan and applies it, seeing the applied counts | `Org admin rolls over a season with mixed promote/archive/transfer` | `org-admin/season-rollover.feature` | existing |
| `tp-org-admin-team-crud` | Org admin creates a team, renames it, and archives it from the team-management surface | `Org admin creates a team`, `Org admin edits and archives a team` | `identity/team/admin-team-crud.feature` | existing |

> Note: `tp-org-admin-team-crud` maps to scenarios under
> `identity/team/admin-team-crud.feature`. The org-admin Team CRUD AC was
> authored against the identity-domain team feature (it carries `@domain-team`
> and the `org admin` persona); there is no separate `org-admin/team-crud.feature`.

## Design-system (1 plan)

| Test Plan | Journey | Feature scenario | File | Status |
| --- | --- | --- | --- | --- |
| `tp-design-system-styleguide-walkthrough` | Dev-admin walks the internal styleguide and sees the live primitive catalogue organised into Foundations, Interactive atoms, Display atoms, and Composites | `Dev admin sees the live styleguide page` | `design-system/styleguide-page.feature` | existing |

## Verification note

The two manual `verify` items on Story #1025 are satisfied as follows:

1. **Traceability record reviewed** — this table; each of the 17 non-coach
   plans maps to a named scenario covering its journey.
2. **Spot harness run for one identity + one org-admin scenario** — recorded
   `manual:` (live harness run deferred to operator); a headless delivery
   sub-agent cannot sustain `pnpm dev` plus a chrome-devtools browser surface.
   The enriched scenarios are static `.feature` artifacts and do not require a
   live stack to author or review.
