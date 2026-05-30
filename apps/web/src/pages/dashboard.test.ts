// apps/web/src/pages/dashboard.test.ts
//
// Unit tests for the dashboard page's pure data-shaper. Targets
// `buildDashboard`, which the `.astro` sibling renders; we assert the
// load-bearing AC for Task #558 / PRD #489 §Dashboard empty states:
// every widget renders an EmptyState when its data set is empty, with
// canonical data-testids, and never falls back to a skeleton on the
// no-data branch.
import { describe, expect, it } from 'vitest';
import {
  type DashboardTeamRow,
  type DashboardWidgetId,
  EMPTY_DASHBOARD_DATA,
  buildDashboard,
  buildRosterRows,
} from './_dashboard';

const REQUIRED_WIDGET_IDS: readonly DashboardWidgetId[] = [
  'dashboard-widget-recent-activity',
  'dashboard-widget-roster',
  'dashboard-widget-upcoming',
];

describe('buildDashboard (zero-data branch)', () => {
  it('renders all three widgets with the canonical data-testids', () => {
    const view = buildDashboard(EMPTY_DASHBOARD_DATA);
    expect(view.widgets.map((w) => w.id)).toEqual(REQUIRED_WIDGET_IDS);
  });

  it('marks every widget as empty when no data is provided', () => {
    const view = buildDashboard(EMPTY_DASHBOARD_DATA);
    for (const widget of view.widgets) {
      expect(widget.isEmpty).toBe(true);
    }
  });

  it('attaches a non-empty empty-state title and body to every widget', () => {
    const view = buildDashboard(EMPTY_DASHBOARD_DATA);
    for (const widget of view.widgets) {
      expect(widget.emptyState.title.length).toBeGreaterThan(0);
      expect(widget.emptyState.body.length).toBeGreaterThan(0);
    }
  });

  it('scopes each widget root testId on the dashboard', () => {
    const view = buildDashboard(EMPTY_DASHBOARD_DATA);
    expect(view.widgets[0].id).toBe('dashboard-widget-recent-activity');
    expect(view.widgets[1].id).toBe('dashboard-widget-roster');
    expect(view.widgets[2].id).toBe('dashboard-widget-upcoming');
  });

  it('wires the Roster widget CTA to the join-a-team route per the style guide', () => {
    const view = buildDashboard(EMPTY_DASHBOARD_DATA);
    const roster = view.widgets.find((w) => w.id === 'dashboard-widget-roster');
    expect(roster?.emptyState.action).toEqual({
      label: 'Join a team',
      href: '/teams/join',
    });
  });
});

describe('buildDashboard (populated branch)', () => {
  it('flips a widget out of the empty branch when its data array has rows', () => {
    const view = buildDashboard({
      recentActivity: [{ id: 'a1' }],
      roster: [],
      upcoming: [],
    });
    const recent = view.widgets.find((w) => w.id === 'dashboard-widget-recent-activity');
    const roster = view.widgets.find((w) => w.id === 'dashboard-widget-roster');
    expect(recent?.isEmpty).toBe(false);
    expect(recent?.rows.length).toBe(1);
    // Other widgets still empty — no cross-talk.
    expect(roster?.isEmpty).toBe(true);
  });

  it('preserves rows in the order the data slice provided them', () => {
    const rows: DashboardTeamRow[] = [
      { teamId: 't1', teamName: 'Team 1', role: 'coach', href: '/app/coach/teams/t1/roster' },
      { teamId: 't2', teamName: 'Team 2', role: 'athlete' },
    ];
    const view = buildDashboard({
      recentActivity: [],
      roster: rows,
      upcoming: [],
    });
    const roster = view.widgets.find((w) => w.id === 'dashboard-widget-roster');
    expect(roster?.rows).toEqual(rows);
  });
});

describe('buildRosterRows (Story #985 / F27)', () => {
  it('links coach teams to the coach roster surface', () => {
    const rows = buildRosterRows([{ teamId: 't_a', teamName: 'Eagles', role: 'coach' }]);
    expect(rows).toEqual([
      {
        teamId: 't_a',
        teamName: 'Eagles',
        role: 'coach',
        href: '/app/coach/teams/t_a/roster',
      },
    ]);
  });

  it('leaves athlete memberships without an href (no athlete surface yet)', () => {
    const rows = buildRosterRows([{ teamId: 't_b', teamName: 'Hawks', role: 'athlete' }]);
    expect(rows).toEqual([{ teamId: 't_b', teamName: 'Hawks', role: 'athlete' }]);
    expect(rows[0]?.href).toBeUndefined();
  });

  it('URL-encodes the team id in the coach href', () => {
    const rows = buildRosterRows([{ teamId: 't a/b', teamName: 'Odd', role: 'coach' }]);
    expect(rows[0]?.href).toBe('/app/coach/teams/t%20a%2Fb/roster');
  });
});

describe('EMPTY_DASHBOARD_DATA', () => {
  it('is a zero-data fixture for every widget slice', () => {
    expect(EMPTY_DASHBOARD_DATA.recentActivity).toEqual([]);
    expect(EMPTY_DASHBOARD_DATA.roster).toEqual([]);
    expect(EMPTY_DASHBOARD_DATA.upcoming).toEqual([]);
  });
});
