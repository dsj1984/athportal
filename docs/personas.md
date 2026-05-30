# Personas

> **Status.** Locked for MVP as of 2026-05-09.
>
> **Why this exists.** The codebase (`docs/features.md`, `tests/features/`, the GitHub Epic backlog) buckets every capability against the persona it serves. This file is the canonical taxonomy. New capabilities reference exactly one MVP persona; new personas don't get added without a thesis-level review.

---

## Cardinality and trust chain

Personas don't exist in isolation — they sit inside a structural graph that the [thesis in `features.md`](./features.md#thesis) depends on:

```text
Organization (1)
  └── Team (1..n)
        ├── Coach (1..n per team)
        └── Athlete (0..n per team)
```

- An **Athlete** can belong to **multiple teams** (e.g. a school team and a club team) — their canonical profile aggregates across all of them.
- A **Coach** can run **multiple teams** (e.g. multiple age groups within one club).
- For MVP, an **Org admin** runs **exactly one organization**. Multi-org administration is deferred.
- **Platform admins** sit outside the org graph entirely.

The **trust chain** runs: org vouches for team → team carries org credibility → coach verifies an athlete's stat → stat is trustworthy. This is what makes the wedge ("verifiable record") structural rather than a marketing claim. Each MVP persona's responsibilities are defined to *preserve* this chain — see "Cannot do" sections for the separations of duty that keep it intact.

---

## MVP personas

### 1. Visitor

**Who.** Anyone unauthenticated who lands on the platform — typically a college coach, club scout, recruiter, family member, or prospective athlete arriving from a shared public profile URL.

**Jobs to be done.**

- View an athlete's **public profile** to evaluate them (record, achievements, team history).
- See **which achievements are verified** through the trust chain so they know what's trustworthy versus self-claimed.
- **Sign in** if they already have an account.

**Cannot do.**

- **Sign up as an athlete from a public page.** MVP is invite-only — there is no public athlete signup surface.
- DM an athlete or interact with private/team-only content.
- See unverified or coach-private fields on a profile.

---

### 2. Athlete

**Who.** A 13–22-year-old club, school, or collegiate athlete who was invited via email after their coach (or org admin) added them to a team. The primary user the product is designed around.

**Jobs to be done.**

- Maintain their **canonical athletic profile** — bio, jersey numbers, physical attributes, team affiliations, social links, custom URL.
- Display and own their **verified achievement record** — stats, awards, milestones — assembled from coach verification, not self-report.
- Connect with **peers inside their team-org graph** (utility-driven: find your teammates, see your opponents) — not a public social feed.
- See and react to **their team's schedule and events** (RSVP, see results, see media tied to events).
- **Share their public profile URL** with college coaches, family, or prospective teams as a portable record.

**Cannot do.**

- **Self-report stats and have them display as verified.** Only stats verified through the coach trust chain show as verified; anything self-entered is clearly marked otherwise (or is excluded from MVP entirely — to be decided in step 4).
- **DM users outside their team-org graph.** Cross-org messaging is post-MVP.
- **Create or modify teams.** That's the org admin's job.
- **Verify their own or another athlete's achievements.** Verification is a coach action — preserves the trust chain.

---

### 3. Coach

**Who.** A signed-in user invited by an org admin to run **one or more teams within that org**. The persona that the trust chain runs *through* — coaches are the source of "verified" in the wedge.

**Jobs to be done.**

- Manage their team's **roster** — invite new athletes by email, accept/remove athletes, assign jersey numbers and positions.
- **Verify athlete achievements and stats** — the credibility-carrying action. A stat without a coach signature isn't verified.
- Manage their team's **schedule and events** (games, practices, tournaments).
- Communicate with their team (utility-grade: announcements, schedule changes) — not a feed.
- View their athletes' profiles and performance histories within the team context.

**Cannot do.**

- **Create new teams under the org.** That's the org admin's job — a coach is invited to a team that already exists.
- Manage **org-level** settings, branding, billing, or invite other coaches.
- Access **teams they aren't assigned to**, even within the same org.
- Verify achievements they didn't witness — the verification UI is scoped to athletes on the coach's own team(s).

---

### 4. Org admin

**Who.** A signed-in user who runs a **club, school, or collegiate athletic department**. The MVP entry point: org admins are the patient-zero customer, and they bring the team-and-coach graph the rest of the product depends on.

**Jobs to be done.**

- **Configure the organization** — name, branding, contact info, the sports it offers.
- **Create teams** under the org and configure their season / age group / sport.
- **Invite and manage coaches** per team — including reassigning, removing, or rolling over for a new season.
- **Invite athletes** directly when needed (typically the coach does this, but the org admin has the authority to fall back).
- View **org-wide roster and verified-achievement reporting** as a credibility signal for the org itself.

**Cannot do.**

- **Verify individual athlete achievements.** That's the coach's role — separation of duty keeps the trust chain meaningful (an org admin who can verify any stat in their org is just self-attestation by another name).
- **Operate across multiple organizations they don't own** (multi-org administration is deferred).
- Modify platform-level configuration, legal documents, or other orgs' data.

---

### 5. Platform admin

**Who.** Operator or platform staff (currently a one-person team — you). Sits outside the org graph; runs the system itself.

**Jobs to be done.**

- **Onboard the patient-zero org** (and future seed orgs while the product is invite-only).
- **Diagnose and resolve user issues** — look up users, view their state, optionally impersonate (auditable) for support.
- Manage **legal and policy documents** (ToS, Privacy Policy, etc.) and roll out re-consent when material changes ship.
- Run **platform-level monitoring, incident response, and CI/CD operations**.
- Approve or roll back **risk-gated mutations** (any operation flagged by `agentSettings.planning.riskHeuristics`).

**Cannot do.**

- **Silently bypass RBAC.** Impersonation must be auditable; verification of an athlete stat as a platform admin (without the coach trust chain) is forbidden.
- Modify an athlete's profile content directly (must impersonate the athlete, with audit trail).

---

## Post-MVP personas (reserved taxonomy slots)

These are real personas with real jobs to be done; they are out of scope for MVP per the [thesis](./features.md#thesis), but the slots are reserved here so future capability decisions know where to bucket. Each is covered by a tracking GitHub Epic — see the **Version 1.0** and **Someday** milestones.

### Recruiter / College coach (post-MVP)

**Why deferred.** The thesis explicitly defines the MVP customer as the athlete; recruiters and college coaches consume athlete profiles but are not the paying / serving customer for MVP. Public profiles via the Visitor persona are sufficient until a recruiter-specific product surface is justified.

**Anticipated future jobs.** Advanced filtered search across athletes; saved searches and watchlists; verified-only roster filtering; compliance-grade DM channels with athletes; recruiter analytics. These map onto the brainstorm-era "Recruiter/Scout Access" tier.

**Tracking Epic.** TBD — to be created or identified in step 8 of the scope plan.

### Team admin (post-MVP)

**Why deferred.** A team-level operator (e.g. a parent volunteer or assistant coach who handles roster admin, RSVP collection, schedule logistics) is a real role in youth-sports operations, but for MVP the coach persona absorbs these responsibilities. Splitting them out is a permission/RBAC refinement, not a missing capability.

**Anticipated future jobs.** Team-level roster admin without verification authority; communication and logistics ownership; team-level reporting visible to the org admin.

**Tracking Epic.** TBD — to be created or identified in step 8.

### Parent / Guardian (post-MVP)

**Why deferred.** Family / parental-consent functionality (and with it the under-13 athlete experience) is hidden for MVP because the COPPA/VPC enforcement chain isn't fully built — see commit `dc81301f` and the audit summary in the thesis doc. The parent persona returns when [Epic #956](https://github.com/dsj1984/athlete-portal/issues/956) ships.

**Anticipated future jobs.** Linked-child consent management, account oversight, MAAPP exception authorization, cascading deletion, SafeSport co-CC visibility.

**Tracking Epic.** [#956 — Family Center, VPC, and minor-athlete safety](https://github.com/dsj1984/athlete-portal/issues/956).

---

## Persona → identity model mapping

Personas are a **product taxonomy**; the persistence model expresses them across two orthogonal axes (full detail in [`docs/data-dictionary.md` § Identity axes](./data-dictionary.md#identity-axes--privilege-role-vs-team-graph-membership) and [ADR-022](./decisions.md#adr-022--privilege-role-and-team-graph-membership-are-orthogonal-role-escalation-is-invitation-only)):

- **Privilege axis** — `users.role` (`dev_admin | org_admin | team_admin | member`). The **Athlete** persona maps to the `member` baseline (no admin capability); **Org admin** → `org_admin`; **Platform admin** → `dev_admin`.
- **Team-graph axis** — the **Coach** and **Athlete** personas are defined by active `coach_assignments` / `athlete_memberships` rows, **not** by `users.role`. A coach's privilege role is `member`.
- **Role is never self-selected.** Self-signup → `member`; coach/athlete relationships are assigned at **invitation-accept**; org admins are bootstrapped by platform staff. `/onboarding` collects identity, legal acceptance, and age attestation only — there is **no persona-selection step, by design**: a self-claim picker would let any user grant themselves `coach`/`org-admin` and break the trust chain above.
- **"Member" is the internal privilege name; "Athlete" is the surfaced label.** Not every member is an athlete — parents (post-MVP) and signed-in users not yet on a roster are also `member`.

## How this gets used

- **`docs/features.md`** is rewritten in step 5 with one section per MVP persona; every capability bullet falls under exactly one persona.
- **`tests/features/`** is reorganized in step 6 to mirror the persona tree.
- **Open Epics** are labeled with their primary persona in step 8 alongside the `mvp::yes` / `mvp::no` disposition.
- **New capabilities** must name the MVP persona they serve. A capability with no MVP persona is automatically post-MVP and needs its own `mvp::no` Epic before any code lands.
