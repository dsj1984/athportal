# Path to MVP

> Sequence-only roadmap from the completed foundation to a launchable MVP. Phases are ordered by dependency, not date. Each phase lists the load-bearing Epics, the cross-cutting work that no single Epic owns, and the gates that must clear before the next phase opens.
>
> Authoritative state for any Epic lives on its GitHub issue. This document orders them; it does not duplicate their scope. When an Epic's body and this file disagree, the Epic wins — open a PR to fix this file.
>
> **Dependencies.** Each Epic declares its prerequisites in a `## Depends on` block on its GitHub issue — that block is the source of truth. The phase ordering below respects every declared dependency: an Epic never appears in an earlier phase than something it depends on. Each phase below lists the inter-phase dependencies in a **Dependencies** callout; intra-phase dependencies are left implicit. When an Epic's `Depends on` block changes, audit this file in the same PR.
>
> Companion documents:
>
> - [`docs/testing-strategy.md`](testing-strategy.md) — automated test pyramid (unit / contract / acceptance).
> - [`docs/manual-testing.md`](manual-testing.md) — human-driven exploratory and regression cadence; the **Manual QA gate** between phases below is defined there.

---

## ✅ Phase 0 — Foundation *(complete)*

Foundation toolchain, quality gates, auth, and identity are landed on `main`.

| Epic | Status | Capability |
| --- | --- | --- |
| [#2](https://github.com/dsj1984/athportal/issues/2) — Toolchain foundation | ✅ Closed | pnpm 9, Turborepo 2, Biome, ESLint, strict TS |
| [#6](https://github.com/dsj1984/athportal/issues/6) — Seven quality baselines + supply-chain CVE gate | ✅ Closed | Lint baseline ratchet, coverage, mutation, dep audit |
| [#7](https://github.com/dsj1984/athportal/issues/7) — Authentication, session, RBAC policy | ✅ Closed | Clerk integration, `canPerform` policy module, test-auth seam |
| [#386](https://github.com/dsj1984/athportal/issues/386) — Finalize foundation | ✅ Closed | CI cost cuts, supply-chain hardening, structural cleanup |

**Exit gate:** ✅ all four Epics closed, `main` green, baselines primed.

---

## Phase 1 — Tenancy & onboarding

Establishes the multi-tenant data model and the gate every authenticated user must clear before any feature surface unlocks. Nothing else in the pyramid is safe to build until tenant isolation and onboarding are enforced server-side.

### Epics

- [#8](https://github.com/dsj1984/athportal/issues/8) — Server-enforced onboarding gate + ToS acceptance
- [#9](https://github.com/dsj1984/athportal/issues/9) — Org / team / coach / athlete data model + multi-tenant isolation
- [#10](https://github.com/dsj1984/athportal/issues/10) — Org configuration, team creation, invitations, bulk import
- [#11](https://github.com/dsj1984/athportal/issues/11) — Digital roster, athlete invitations, team-scoped access
- [#23](https://github.com/dsj1984/athportal/issues/23) — Versioned legal documents (ToS, Privacy, cookie consent)

### Dependencies

- #8, #9 → Phase 0 (#7 auth)
- #23 → #8 (onboarding owns the ToS acceptance moment)
- #10, #11 → #9 (need the org/team graph to exist)

### Cross-cutting work (no Epic owns it)

- Document the `(role, resource, action)` matrix in `docs/data-dictionary.md` as RBAC surface area lands.
- First exercise of the cross-tenant isolation property tests against a real Clerk test instance.

### Exit gates

- A coach can sign up, accept ToS, create an org, create a team, invite an athlete, and have that athlete appear on the roster.
- Manual QA gate: tenancy-isolation charter (see [`manual-testing.md` § Phase gates](manual-testing.md#phase-gates)).

---

## Phase 2 — Private identity & calendar

The canonical athlete profile is the wedge artifact. The calendar is the recurring touchpoint that brings users back. These are the two private surfaces every later feature decorates. The **public** projection of the profile is deferred to Phase 3 because it depends on the verified-stat badges that land there.

### Epics

- [#12](https://github.com/dsj1984/athportal/issues/12) — Canonical athlete profile (attributes, academic, vanity URL, privacy, completion)
- [#13](https://github.com/dsj1984/athportal/issues/13) — Core calendar UI, expanded event types, RSVP, outbound iCal feed

### Dependencies

- #12 → #9 (athlete entity comes from the org/team graph)
- #13 → #11 (events scope to teams / rosters)

### Cross-cutting work

- Vanity-URL collision policy decision recorded in `docs/decisions/`.

### Exit gates

- An athlete can complete their canonical profile to 100%, and a coach can publish an event the athlete RSVPs to.
- Manual QA gate: profile-completion + calendar charters.

---

## Phase 3 — Verified statistics, media & public profile

This is what makes the profile defensible vs. a generic team-management app. Stats and media both have safety pipelines that must be exercised before any user-generated content surface opens. The public projection of the athlete profile lands here too — it renders the verified badges produced by #14, so it can't ship before them.

### Epics

- [#14](https://github.com/dsj1984/athportal/issues/14) — Verified statistics (sideline collection, coach signature, badging — soccer first)
- [#17](https://github.com/dsj1984/athportal/issues/17) — Media capture, processing, playback, pre-publish safety pipeline
- [#20](https://github.com/dsj1984/athportal/issues/20) — Block, report, MAAPP plumbing, PII safety guardrails
- [#15](https://github.com/dsj1984/athportal/issues/15) — Public athlete profile with verification badges + SEO

### Dependencies

- #14 → #11, #12, #13 (needs roster, profile, and event context)
- #17 → #12 (media attaches to the athlete profile)
- #20 → Phase 0 (#7 auth)
- #15 → #12 **and #14** (public profile renders verified badges — this is why #15 sits in Phase 3, not Phase 2)

### Cross-cutting work

- Cloudflare R2 bucket + Mux account provisioned for staging *and* production; secrets in env, never in code.
- Media moderation policy (what the safety pipeline blocks vs. flags) recorded in `docs/decisions/`.
- Coach-signature audit trail reviewed end-to-end.
- SEO baseline: sitemap, robots, OpenGraph defaults. Lighthouse run captured against the public profile.

### Exit gates

- A coach can record a stat, sign it, and the athlete's public profile reflects the verified badge.
- A media upload survives the full pipeline (capture → process → safety check → publish) on staging.
- The public profile renders correctly when shared as a link (OG card, title, description).
- Manual QA gate: verified-stats + media-safety + public-profile charters.

---

## Phase 4 — Communication & engagement

Push, email, and the team feed close the engagement loop. Nothing in this phase ships before the safety guardrails from Phase 3 are exercised — comms surfaces are where harassment and PII leaks materialize.

### Epics

- [#18](https://github.com/dsj1984/athportal/issues/18) — Push, email transactional, event reminders, preference center
- [#21](https://github.com/dsj1984/athportal/issues/21) — Native team feed (posts, sharing, reactions within the team)
- [#19](https://github.com/dsj1984/athportal/issues/19) — Mobile-web PWA (service worker, manifest, install prompt, Web Push)

### Dependencies

- #18 → #7 auth, #13 calendar (reminders fire off events)
- #21 → #11 roster, #12 profile, #17 media, #20 trust & safety (every prerequisite for a moderated content surface)
- #19 → #17 media, #18 notifications (Web Push rides on the notification stack)

### Cross-cutting work

- Transactional email sender domain verified (SPF, DKIM, DMARC) in production DNS.
- Push notification credentials (APNs, FCM) provisioned for the PWA; native push waits for the native-apps Epic.
- Notification preference defaults reviewed for minor-athlete safety.

### Exit gates

- An event publication triggers a push and an email; the preference center can mute both.
- A team-feed post is visible only to roster members, never cross-tenant.
- Manual QA gate: notifications + team-feed charters.

---

## Phase 5 — Safety, compliance, legal

Minor-athlete safety and data-rights compliance are launch blockers. These Epics are sequenced before public-discovery and signup because they govern what those surfaces are allowed to expose.

### Epics

- [#25](https://github.com/dsj1984/athportal/issues/25) — Platform admin dashboard (onboarding, lookup, impersonation, support actions)
- [#24](https://github.com/dsj1984/athportal/issues/24) — DSAR, account deletion, standard retention enforcement
- [#28](https://github.com/dsj1984/athportal/issues/28) — Family Center, parental consent (VPC), minor-athlete safety
- [#47](https://github.com/dsj1984/athportal/issues/47) — Coach vetting (SafeSport API + background-check tracking)

### Dependencies

- #25 → #7 auth, #9 org/team graph
- #24 → #23 legal documents (retention policy is anchored to the published privacy policy)
- #28 → #7 auth, #8 onboarding, #20 trust & safety, #24 data-rights (VPC composes all four)
- #47 → #25 admin dashboard, #20 trust & safety (vetting flows surface in the admin console)

### Cross-cutting work

- Privacy review of the public profile surface against the VPC posture.
- Legal review of the ToS / Privacy / cookie copy in the production tenant.
- Admin-impersonation audit trail validated end-to-end (every action logged, no silent bypasses).

### Exit gates

- A parent can grant or revoke consent and see it reflected in the minor athlete's surfaces.
- A user can submit a DSAR and a deletion request; both flow through the admin dashboard.
- A coach without SafeSport completion cannot be invited to a team with minors.
- Manual QA gate: minor-safety + DSAR charters.

---

## Phase 6 — Public surface & growth

Opens the signup funnel and the discovery directories. Everything above this line is private-tenant; this phase is the first time anonymous traffic reaches the platform.

### Epics

- [#16](https://github.com/dsj1984/athportal/issues/16) — Public-discovery directories (athletes, clubs, teams, events, tournaments)
- [#58](https://github.com/dsj1984/athportal/issues/58) — Public signup, anonymous landing, conversion funnel

### Dependencies

- #16 → #13 calendar, #15 public profile (directories aggregate the public surfaces from Phases 2–3)
- #58 → #8 onboarding, #12 profile, #15 public profile (signup funnel terminates in the canonical profile flow)

### Cross-cutting work

- Production domain DNS cutover plan, including the apex and `www` redirect.
- Crawler rate-limit policy and `robots.txt` final state recorded in `docs/decisions/`.
- Analytics + funnel instrumentation wired (where it lands depends on the analytics decision; record in `docs/decisions/`).

### Exit gates

- Anonymous traffic can land on a club page, see a public roster, click an athlete, and reach a signup CTA.
- Manual QA gate: anonymous-funnel + public-directory charters.

---

## Phase 7 — Launch

Production cutover, beta cohort onboarding, native apps (if shipping at MVP), and the launch runbook. This is the last phase before MVP is declared done.

### Epics

- [#27](https://github.com/dsj1984/athportal/issues/27) — Production environment, beta cohort, store submission, launch runbook
- [#48](https://github.com/dsj1984/athportal/issues/48) — Native iOS + Android apps (EAS Build, store submission, native push, Detox) — *optional at MVP; see decision below*

### Dependencies

- #27 → every preceding Phase 1–6 Epic (it is the integration / launch gate for the whole MVP path — see its `Depends on` block for the full list)
- #48 → #19 mobile-web PWA, #27 launch (native apps wrap the validated mobile-web surface)

### Cross-cutting work

- Production secrets inventory: every key in `.env.example` has a real value in the production secret store and a documented rotation owner.
- Stripe live-mode keys provisioned (if commerce ships at MVP — see decision in `docs/decisions/`).
- On-call rotation and incident runbook published in `docs/runbooks/`.
- Beta cohort recruitment list finalized; onboarding script rehearsed.
- Full pre-release manual regression sweep (see [`manual-testing.md` § Pre-release sweep](manual-testing.md#pre-release-sweep)).

### Exit gates

- The full pre-release manual regression sweep passes against the production environment with seeded beta data.
- The launch runbook is rehearsed end-to-end against staging with the on-call rotation in the loop.
- MVP is declared done.

---

## Explicitly out of scope for MVP

The Epics below are tracked but **not** on the MVP path. They unlock after launch. Listed here so the boundary is explicit.

- [#37](https://github.com/dsj1984/athportal/issues/37) — Recruiter / college coach portal (B2B paid surface)
- [#29](https://github.com/dsj1984/athportal/issues/29) — Verified Placement Record (Trophy Case)
- [#46](https://github.com/dsj1984/athportal/issues/46) — Multi-sport expansion beyond soccer
- [#52](https://github.com/dsj1984/athportal/issues/52), [#53](https://github.com/dsj1984/athportal/issues/53), [#54](https://github.com/dsj1984/athportal/issues/54) — Follow graph, cross-team feed, direct messaging
- Every Epic in the `tier::supporting` band ([#59](https://github.com/dsj1984/athportal/issues/59)–[#86](https://github.com/dsj1984/athportal/issues/86)) — supporting capabilities, post-MVP.

If a supporting-tier Epic gets promoted onto the MVP path, update this section and the relevant phase in the same PR.

---

## How to update this document

- An Epic's scope changing does **not** require an update here unless its dependency position changes.
- A phase's exit gates changing **does** require an update — gates are the load-bearing part of this doc.
- A new cross-cutting concern surfacing that doesn't fit inside any Epic: add it to the relevant phase's "Cross-cutting work" list and link the decision record if there is one.
- Promotion of a supporting Epic onto the MVP path: update both the relevant phase and the "Out of scope" section in the same PR.
