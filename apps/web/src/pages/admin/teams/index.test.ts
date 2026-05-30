// apps/web/src/pages/admin/teams/index.test.ts
//
// Unit test for the `buildTeamsListView` view-builder (Story #657 /
// Task #676). The Astro page consumes this evaluator to derive the
// heading text and the empty-state flag.

import { describe, expect, it } from 'vitest';
import { buildTeamsListView } from './_index';

const SAMPLE = [
  {
    id: 't1',
    name: 'Varsity',
    sport: 'Volleyball',
    season: 'Fall 2026',
    ageGroup: 'Varsity',
    archivedAt: null,
  },
];

describe('buildTeamsListView', () => {
  it('returns the active heading when not showing archived', () => {
    const view = buildTeamsListView(SAMPLE, false);
    expect(view.heading).toBe('Teams');
    expect(view.showingArchived).toBe(false);
    expect(view.isEmpty).toBe(false);
    expect(view.teams).toHaveLength(1);
  });

  it('returns the archived heading when showing archived', () => {
    const view = buildTeamsListView(SAMPLE, true);
    expect(view.heading).toBe('Archived teams');
    expect(view.showingArchived).toBe(true);
  });

  it('flags empty state when the list is empty', () => {
    const view = buildTeamsListView([], false);
    expect(view.isEmpty).toBe(true);
  });
});
