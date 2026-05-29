// scripts/qa/schema/coverage-floors.ts
//
// Per-domain minimum-coverage floors for the QA corpus. The
// `coverage:qa` script reads this table, counts the artifacts the
// indexer emitted under `tests/qa-index.json`, and reports the gap
// between the declared floor and the live count.
//
// Scripted Test Plans (`tests/plans/**`) were retired from the corpus —
// the live MVP journeys are covered by the executable `.feature` suite
// under `tests/features/**`. The only remaining markdown-corpus artifact
// is the exploratory charter, so the floor table tracks charters only.
//
// The floors are the TRIMMED-Epic baseline declared by PRD #781 AC-7
// for live MVP domains. The Epic that ships a new MVP route (mobile,
// athlete-dashboard, etc.) is responsible for raising its own row
// here in the same PR that lands the routes.
//
// Citation: PRD #781 AC-7 (TRIMMED Epic — live domains only); Tech
// Spec #782 § Core Components #3 ("scripts/qa/coverage.mjs"). The
// reserved-domain rows (mobile, marketing, public-discovery, settings,
// athlete-dashboard, coach-dashboard) live at 0 today so the enum
// stays exhaustive and the table can be extended by a domain backfill
// Story without touching the coverage runner.

import { DOMAINS, type Domain } from './domains.ts';

/**
 * A single floor entry. `charters` is the minimum number of
 * `.charter.md` artifacts the domain must host. Defaults to zero for
 * reserved / not-yet-live domains.
 */
export interface CoverageFloor {
  charters: number;
}

/**
 * Canonical floor table. The Record is keyed by every entry in
 * `DOMAINS` so a future addition to the enum produces a TypeScript
 * compile error here until the row is filled in — that is the
 * intentional safety net.
 */
export const COVERAGE_FLOORS: Record<Domain, CoverageFloor> = {
  marketing: { charters: 0 },
  'public-discovery': { charters: 0 },
  identity: { charters: 1 },
  'athlete-dashboard': { charters: 0 },
  'coach-dashboard': { charters: 0 },
  'org-admin': { charters: 2 },
  settings: { charters: 0 },
  'design-system': { charters: 0 },
  mobile: { charters: 0 },
};

/**
 * Returns the floor entry for `domain`. Throws when the input is not a
 * known domain — `coverage:qa` consumes a typed Domain so this guard
 * is mostly defensive against runtime-injected values from the JSON
 * index.
 */
export function getCoverageFloor(domain: string): CoverageFloor {
  if (!(domain in COVERAGE_FLOORS)) {
    throw new Error(`unknown domain "${domain}" — extend DOMAINS in scripts/qa/schema/domains.ts`);
  }
  return COVERAGE_FLOORS[domain as Domain];
}

/**
 * Re-export the enum so consumers (the runner, the unit tests) can
 * iterate the keys without re-importing `domains.ts` themselves.
 */
export { DOMAINS };
