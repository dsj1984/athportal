// scripts/qa/schema/domains.ts
//
// QA-corpus `domain` enum. The list is **open-ended by design** — adding
// a new live MVP route prefix to `docs/web-routes.md` is paired with a
// new entry here (and a row in `coverage-floors.ts`) in the same PR.
//
// The Epic that ships the new route owns the addition; the lint, index,
// and coverage scripts under `scripts/qa/` consume this list without
// modification.
//
// Source citations (Epic #775, Tech Spec #782 § Directory layout):
//   - `identity`       — /sign-in, /sign-up, /sign-out, /onboarding
//   - `org-admin`      — /admin/*
//   - `design-system`  — /internal/styleguide
//   - `marketing`      — deferred (Epic that ships /, /about, /pricing)
//   - `public-discovery` — deferred (Epic shipping ADR-008 slug routes)
//   - `settings`       — deferred (Epic shipping /settings/*)
//   - `athlete-dashboard` — deferred (athlete-dashboard Epic)
//   - `coach-dashboard`   — deferred (coach-dashboard Epic)
//   - `mobile`         — RESERVED; rejected by lint until the mobile Epic
//                        lands and reclaims the directory.
//
// The charter schema (`charter.front-matter.zod.ts`) consumes `DOMAINS`
// for the `domain` field; consumers that need to *reject* the reserved
// `mobile` entry must read `RESERVED_DOMAIN_MESSAGES` after the Zod
// parse succeeds and surface the message verbatim.

export const DOMAINS = [
  'marketing',
  'public-discovery',
  'identity',
  'athlete-dashboard',
  'coach-dashboard',
  'org-admin',
  'settings',
  'design-system',
  'mobile',
] as const;

export type Domain = (typeof DOMAINS)[number];

/**
 * Domains that are accepted by the schema (so future Epics can land
 * artifacts in the same PR that ships their routes) but rejected by the
 * lint script until their owning Epic lands. The message is surfaced
 * verbatim in the lint error so the operator sees *why* the artifact
 * cannot merge yet.
 */
export const RESERVED_DOMAIN_MESSAGES: Partial<Record<Domain, string>> = {
  mobile: 'reserved until mobile Epic lands',
};

/**
 * Returns the rejection message for a reserved domain, or `null` when
 * the domain is currently accepted.
 */
export function reservedDomainMessage(domain: Domain): string | null {
  return RESERVED_DOMAIN_MESSAGES[domain] ?? null;
}
