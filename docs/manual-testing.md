# Manual Testing Strategy

> Human-driven testing is the counterpart to the automated pyramid in [`docs/testing-strategy.md`](testing-strategy.md). Automation covers regression — that a known behavior still works. Manual testing covers the things humans notice that machines don't: visual polish, copy tone, real-device feel, the "does this flow actually feel right" question, and the edge cases nobody thought to encode in a `.feature` file yet.
>
> This document defines **when** to test manually, **what** to test, and **where** the artifacts live. The cadence is referenced from [`docs/path-to-mvp.md`](path-to-mvp.md) as the manual-QA gate between phases, and is the ongoing rhythm after MVP.

---

## What manual testing is for

Use manual testing for:

- **Visual polish** — alignment, spacing, typography, hover states, focus rings, dark-mode contrast.
- **Copy quality** — tone, voice, error-message helpfulness, microcopy that machines can't grade.
- **Real-device feel** — touch targets on a phone, scroll inertia, keyboard handling, screen-reader announcements.
- **Cross-surface flows** — a journey that crosses email → web → mobile, where any single tier's automation can't see all three.
- **Exploratory edge cases** — "what happens if I…?" probes that surface bugs no scenario author predicted.
- **Production-only validations** — DNS, deliverability, third-party webhooks, real Stripe payments, real Mux pipelines.

Do **not** use manual testing for:

- Anything an automated test already covers reliably. If a manual check keeps catching regressions, write the test.
- Mass-scale data validation — that's a contract-tier test against a real DB.
- "I'll just click around for a few minutes" with no charter. Untracked manual testing finds nothing reproducible.

---

## The three cadences

### 1. Per-Story exploratory charter

Every Story whose acceptance criteria include a user-visible surface gets a **10-minute exploratory charter** before the Story closes. The charter is appended to the Story's GitHub issue as a structured comment.

**Charter template**

```markdown
### Manual exploratory charter — Story #<id>

- **Mission:** <one sentence — what am I trying to learn?>
- **Surfaces:** <which pages, components, or flows>
- **Personas:** <which seeded test users>
- **Devices:** <desktop browser + at least one mobile viewport unless the surface is desktop-only>
- **Timebox:** 10 minutes
- **Findings:**
  - <bug | polish | copy | a11y | perf — one line each, link issues if filed>
- **New automated tests filed:** <list issue numbers, or "none">
```

Rules:

- The mission must be falsifiable — "explore the form" is not a mission; "find ways a coach could submit the form and end up with a confusing error" is.
- Every finding either gets filed as an issue or recorded as deliberately accepted. No "I'll remember it" findings.
- If a finding could have been caught by an automated test, file the test-writing work as part of closing the Story.

### 2. Per-phase regression checklist

The checklist below grows phase-by-phase as new surfaces land. It is the **accumulating** manual sweep run before each phase's exit gate. New rows are appended at the end of the phase that introduced the surface; rows are never deleted, only marked deprecated when a surface is removed.

The checklist lives in this file (see [§ Regression checklist](#regression-checklist)) so it sits next to the strategy that governs it. When a row's manual check becomes reliably automated, the row is marked **(automated → see <test path>)** and skipped during the sweep — but kept in the list for traceability.

### 3. Pre-release sweep

Before MVP launch (Phase 7) and before every subsequent production release, run the **full** accumulated regression checklist against the staging environment with production-shaped data. Findings block the release until either fixed or explicitly accepted by the operator with a documented risk note.

Pre-release sweep specifics:

- Run from a **fresh** browser profile (no cached auth, no stale service worker).
- Run against **at least** one mobile device per platform (iOS Safari, Android Chrome) — not just emulators.
- Capture screenshots or screen recordings of the entire happy path; archive them with the release tag.
- The sweep is performed by **two people** when possible — the second pair of eyes catches the first's blind spots.

---

## Phase gates

Each phase in [`docs/path-to-mvp.md`](path-to-mvp.md) has a **Manual QA gate** as part of its exit criteria. The gate is satisfied when:

1. Every Story in the phase has a charter appended to its issue.
2. The phase's incremental section of the regression checklist (the rows added during this phase) passes end-to-end against staging.
3. Any open findings are either fixed or have a documented operator decision to defer.

Specific charters called out by phase below are the minimum — Stories may add more.

| Phase | Required charters |
| --- | --- |
| 1 — Tenancy & onboarding | Tenancy isolation; signup → org creation → invitation |
| 2 — Identity surface | Profile completion happy path; calendar event publish + RSVP; public-profile SEO render |
| 3 — Verified stats & media | Coach signs a stat → athlete sees badge; media upload survives full safety pipeline |
| 4 — Communication | Push + email round-trip; preference center mutes both; team-feed cross-tenant isolation |
| 5 — Safety & compliance | Parental consent grant/revoke visible on minor's surfaces; DSAR end-to-end; coach without SafeSport blocked from minor team |
| 6 — Public surface & growth | Anonymous funnel from landing → club page → signup; crawler `robots.txt` honored |
| 7 — Launch | Full pre-release sweep against production environment |

---

## Devices, browsers, and personas

### Browser matrix

The matrix is intentionally narrow at MVP. Add a row only when a real user reports a problem on a browser that isn't listed.

| Surface | Required browsers |
| --- | --- |
| Public anonymous (landing, public profile, directories) | Latest Chrome, latest Safari, latest Firefox, iOS Safari, Android Chrome |
| Authenticated coach / org admin surfaces | Latest Chrome, latest Safari |
| Authenticated athlete surfaces | Latest Chrome, latest Safari, iOS Safari, Android Chrome |
| Admin dashboard | Latest Chrome |

### Device matrix

| Class | Minimum device for pre-release sweep |
| --- | --- |
| iOS phone | One real iPhone running the latest public iOS, plus one on the previous major version |
| Android phone | One real Android running the latest Chrome |
| Tablet | iPad (Safari) — public surfaces only |
| Desktop | Whatever the operator uses; Lighthouse runs are captured here |

Emulators and responsive-mode browser viewports are acceptable for per-Story charters. They are **not** sufficient for the pre-release sweep.

### Personas

Use the seeded test-instance personas from [`docs/testing-strategy.md` § Canonical step vocabulary](testing-strategy.md#canonical-step-vocabulary):

- `athlete` — minor and adult variants.
- `coach` — head coach with a team; assistant coach.
- `org admin` — owns an org with multiple teams.
- `dev admin` — platform admin.
- `parent` — once Phase 5 lands.
- `anonymous` — no session.

Test data must be **synthetic** — synthetic emails (`*@example.invalid`), synthetic names, no real PII even in staging.

---

## Accessibility, performance, and security touchpoints

These overlap with automated checks but always benefit from a human pass:

- **Accessibility.** Tab through the surface with a keyboard. Run a screen reader on the happy path at least once per phase. Check focus rings, skip links, and form-error announcements. Axe / Lighthouse a11y scores are floors, not ceilings.
- **Performance.** Lighthouse on the public surfaces at the end of every phase that touches them. Real-device "feel" check on a mid-tier Android — emulators lie about scroll smoothness.
- **Security spot-checks.** Try the obvious things: change an ID in a URL, submit a form as a different role via the network tab, paste a JWT from another tenant. Findings file as security issues, not feature bugs.

---

## Findings, triage, and closing the loop

- File every finding as a GitHub issue. Tag with `manual-qa`. Link back to the Story or phase that surfaced it.
- Findings that recur across phases are a signal the automated tier is wrong, not that the manual sweep is working. Open a meta-issue to add the missing automated coverage.
- A finding is **closed** only when the fix has landed *and* either (a) an automated test now covers it, or (b) the operator has explicitly accepted that this class of bug stays in the manual-only column with a documented reason.

---

## Regression checklist

The accumulating sweep, grouped by phase. Rows are appended as phases land. The "Run" column is checked off during each pre-release sweep — never edited in-place; copy the table into the release notes and check it there.

> **Status today:** Foundation phases (0) are complete but no user-visible surface has shipped yet, so the checklist below is the **target shape**. Rows are filled in as each phase's Stories close.

### Phase 1 — Tenancy & onboarding

- [ ] Signup with new email → email verification → onboarding gate → ToS acceptance → org creation.
- [ ] Org admin creates a team and invites a coach by email.
- [ ] Coach accepts invitation and appears on team's coaching staff.
- [ ] Coach invites an athlete; athlete accepts; athlete appears on roster.
- [ ] Cross-tenant probe: a user in Org A cannot see Org B's roster, teams, or org settings via the UI or by manipulating IDs.
- [ ] ToS version bump forces re-acceptance on next sign-in.

### Phase 2 — Identity surface

- [ ] Athlete completes profile to 100%; completion badge updates live.
- [ ] Athlete sets vanity URL; collision against an existing URL is rejected with a helpful message.
- [ ] Public profile renders correctly when shared as a link (OpenGraph card, title, description).
- [ ] Coach publishes a calendar event; athletes on the team see it.
- [ ] Athlete RSVPs; the coach's event view reflects the RSVP within the expected propagation time.
- [ ] iCal feed URL produces a valid `.ics` file that imports cleanly into Google Calendar and Apple Calendar.

### Phase 3 — Verified stats & media

- [ ] Coach records a stat from the sideline UI on a mobile device with patchy connectivity; stat is queued and syncs when online.
- [ ] Coach signs the stat; athlete's public profile reflects the verified badge.
- [ ] Stat-signature audit trail visible in admin dashboard with timestamp and signer identity.
- [ ] Media upload (photo + video) survives the safety pipeline end-to-end; unsafe content is blocked with a clear user message.
- [ ] Block / report flow: athlete reports a coach; report appears in admin queue.

### Phase 4 — Communication & engagement

- [ ] Event publication triggers push (on PWA-installed device) and email.
- [ ] Preference center mutes push only; email still delivers. Then mutes email only; push still delivers.
- [ ] Team-feed post is visible to roster members; never to a user in another team or org.
- [ ] PWA installs from the browser prompt; survives a service-worker update without losing auth.

### Phase 5 — Safety, compliance, legal

- [ ] Parent claims their minor athlete; consent state visible on the minor's surfaces.
- [ ] Parent revokes consent; previously consented surfaces immediately lock down.
- [ ] DSAR submission produces a downloadable export within the documented SLA.
- [ ] Account deletion request flows through admin dashboard; user disappears from public surfaces; retention policy honored on the back end.
- [ ] Coach without completed SafeSport cannot be added to a team containing a minor.
- [ ] Admin impersonation: every impersonated action is logged with both the operator and the impersonated user.

### Phase 6 — Public surface & growth

- [ ] Anonymous landing → club page → public roster → public profile → signup CTA, all reachable without auth.
- [ ] `robots.txt` and sitemap reflect the documented crawler policy; private surfaces are excluded.
- [ ] Funnel instrumentation fires the expected events on anonymous → registered conversion.
- [ ] Apex domain redirects to canonical hostname; HTTPS enforced; HSTS header present.

### Phase 7 — Launch

- [ ] Full sweep of phases 1–6 against the production environment with seeded beta data.
- [ ] Real Stripe payment in live mode (if commerce ships at MVP).
- [ ] Production email deliverability: signup confirmation lands in Gmail, Outlook, iCloud inboxes (not spam).
- [ ] On-call rotation paged by a deliberate synthetic alert; runbook executed end-to-end.
- [ ] Rollback rehearsed: a tagged release can be reverted without data loss within the documented RTO.

---

## How to update this document

- A new surface lands → append rows to the relevant phase's regression checklist in the same PR that ships the surface.
- A manual check becomes reliably automated → mark the row **(automated → see <test path>)** rather than deleting it.
- A finding recurs across phases → that's a signal; open a meta-issue to add automated coverage rather than just adding another checklist row.
- A surface is removed → mark its rows **(deprecated — <date>)** rather than deleting them, so the change is traceable in git history.
