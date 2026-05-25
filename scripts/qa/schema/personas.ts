// scripts/qa/schema/personas.ts
//
// QA-corpus `persona` enum. Sourced from the MVP persona list in
// `docs/personas.md` (and mirrored in PRD #781 § User Stories).
//
// The list is intentionally *closed* — adding a new persona is a
// platform-level decision (touches RBAC, onboarding, dashboards) and
// must land via a separate Epic that updates `docs/personas.md` first.
// `parent` / `guardian` are deferred to the parent-persona Epic and are
// NOT listed here.
//
// Citations (PRD #781):
//   - athlete        — the primary signup target; main app surface
//   - coach          — team-level operations
//   - org-admin      — `/admin/*` surface
//   - platform-admin — no MVP web surface; coverage stays automation-only
//   - visitor        — unauthenticated marketing/public routes

export const PERSONAS = ['visitor', 'athlete', 'coach', 'org-admin', 'platform-admin'] as const;

export type Persona = (typeof PERSONAS)[number];
