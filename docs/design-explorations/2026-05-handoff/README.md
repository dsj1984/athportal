# 2026-05 Claude Design handoff

> **STATUS: directional, non-binding.** This bundle is a point-in-time
> design exploration imported from [claude.ai/design](https://claude.ai/design)
> on 2026-05-22. It informed Epic #702 (Design system foundation) and is
> retained as reference for downstream UI Epics.
>
> **Canonical sources of truth win when they disagree with this bundle.**
> See [`../README.md`](../README.md) for the canonical/exploration boundary;
> in short:
>
> | Surface | Source of truth |
> |---|---|
> | Brand rules, copy voice, casing | [`docs/style-guide.md`](../../style-guide.md) |
> | Tokens (colours, radii, shadows, type) | [`apps/web/src/styles/global.css`](../../../apps/web/src/styles/global.css) |
> | Primitive components | [`apps/web/src/components/ui/`](../../../apps/web/src/components/ui/) |
> | Live primitive reference | `/internal/styleguide` (run `pnpm --filter @repo/web dev`) |
> | This bundle | Visual inspiration only |
>
> When a PRD or Tech Spec cites an artboard here, it should also list the
> primitives the artboard would reuse, the primitives it would imply as
> net-new (with a build/inline/defer decision), and any intentional
> divergence from the mockup.

## How to consume an artboard

1. **Identify the relevant `.jsx` file** under `project/screens-*.jsx`. The
   master index lives in `project/app.jsx` which composes every artboard
   into a `<DesignCanvas>` with one `<DCArtboard>` per surface.
2. **Read the JSX directly** — do not render the bundle in a browser.
   Per the original handoff README: *"Don't render these files in a
   browser or take screenshots unless the user asks you to. Everything
   you need — dimensions, colors, layout rules — is spelled out in the
   source."*
3. **Map mockup elements to existing primitives** in
   [`apps/web/src/components/ui/`](../../../apps/web/src/components/ui/)
   — `<Btn>`, `<Badge>`, `<EventChip>`, `<Shell>`, etc. The mockup atoms
   in `project/atoms.jsx` were the seed for these primitives, so the
   mapping is usually 1:1.
4. **Flag net-new primitives** the mockup implies that the design system
   doesn't have yet. Per-primitive decision: (a) add as a Story under
   the consuming Epic's Feature, (b) build inline for this Epic only,
   (c) defer.
5. **Document intentional divergence** in the PRD's Non-Goals or
   Decisions section — *"the mockup shows X; we're shipping Y because…"*.

## Artboard → likely Epic mapping

| Bundle artboard | Likely consuming Epic | Notes |
|---|---|---|
| `screens-athlete.jsx` `<AthleteHome>` | #12 Canonical athlete profile, downstream of #19 PWA | Home dashboard layout |
| `screens-athlete.jsx` `<AthleteProfileEdit>` | #12 Canonical athlete profile | Athletic tab — private edit surface |
| `screens-athlete.jsx` `<PublicProfile>` | #15 Public athlete profile | Public shareable URL |
| `screens-coach.jsx` `<CoachRoster>` | #11 Digital roster | U-17 example roster |
| `screens-coach.jsx` `<CoachVerify>` | #14 Verified statistics | Sign-stat ceremony |
| `screens-calendar-feed.jsx` `<CalendarMonth>` | #13 Core calendar UI | Month view |
| `screens-calendar-feed.jsx` `<EventDetail>` | #13 Core calendar UI | RSVP surface |
| `screens-calendar-feed.jsx` `<TeamFeed>` | #21 Native team feed | Roster-only feed |
| `screens-org-discovery.jsx` `<OrgOverview>` | (shipped — Epic #10) | KPIs + alerts |
| `screens-org-discovery.jsx` `<OrgCreateTeam>` | (shipped — Epic #10) | Create team + invite coach |
| `screens-org-discovery.jsx` `<Discovery>` | #16 Public-discovery directories, #58 Anonymous landing | Athlete grid + filters |
| `screens-mobile.jsx` `<AthleteHomeMobile>` | #19 Mobile-web PWA | Mobile athlete home |
| `screens-mobile.jsx` `<PublicProfileMobile>` | #15 + #19 | Mobile public profile |
| `screens-mobile.jsx` `<CalendarMobile>` | #13 + #19 | Week + agenda |
| `screens-mobile.jsx` `<VerifyMobile>` | #14 + #19 + #43 | Coach sideline-verify |
| `screens-expressive.jsx` `<ExpressivePublicProfile>` | #15 (deferred per Epic #702 plan) | Editorial dark variant |
| `screens-expressive.jsx` `<ExpressiveAthleteHome>` | #12 (deferred) | Magazine direction |
| `screens-expressive.jsx` `<ExpressiveVerifyCeremony>` | #14 (deferred) | Focused ceremony |

## Bundle contents

- `README.md` — this file (header rewritten 2026-05-24)
- `project/` — the original Claude Design export (HTML prototypes, atoms,
  screens, design canvas wrapper)

## Original bundle README (preserved)

> **CODING AGENTS: READ THIS FIRST**
>
> This is a **handoff bundle** from Claude Design (claude.ai/design).
>
> A user mocked up designs in HTML/CSS/JS using an AI design tool, then
> exported this bundle so a coding agent can implement the designs for real.
>
> **Read `ath-portal/project/AthPortal mockups.html` in full.** The user
> had this file open when they triggered the handoff, so it's almost
> certainly the primary design they want built.
>
> The design medium is **HTML/CSS/JS** — these are prototypes, not
> production code. Your job is to **recreate them pixel-perfectly** in
> whatever technology makes sense for the target codebase. Match the
> visual output; don't copy the prototype's internal structure unless it
> happens to fit.
>
> **Don't render these files in a browser or take screenshots unless the
> user asks you to.** Everything you need — dimensions, colors, layout
> rules — is spelled out in the source.
