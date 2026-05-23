// apps/web/src/components/ui/Shell.test.ts
//
// Unit tests for the Shell + Sidebar composite primitives' pure-TS
// surface. Covers the canonical 232px sidebar grid, the three persona
// nav lists, and the active-row styling — the .astro renderers are
// thin templates that consume these values verbatim, so pinning the
// builders pins both surfaces.
//
// Story #712 / Task #729.
import { describe, expect, it } from 'vitest';
import {
  SHELL_CONTENT_TEST_ID,
  SHELL_SIDEBAR_WIDTH_PX,
  SHELL_TEST_ID,
  shellGridTemplateColumns,
} from './Shell';
import {
  SIDEBAR_ACTIVE_BG,
  SIDEBAR_ITEM_TEST_ID_PREFIX,
  SIDEBAR_TEST_ID,
  buildSidebarView,
} from './Sidebar';
import { SIDEBAR_NAV, type SidebarPersona } from './_lib/sidebarNav';

describe('Shell — layout constants', () => {
  it('pins the sidebar column at 232px', () => {
    expect(SHELL_SIDEBAR_WIDTH_PX).toBe(232);
  });

  it('composes a 232px + 1fr grid template', () => {
    expect(shellGridTemplateColumns()).toBe('232px 1fr');
  });

  it('exposes canonical data-testids for the shell and content surfaces', () => {
    expect(SHELL_TEST_ID).toBe('shell');
    expect(SHELL_CONTENT_TEST_ID).toBe('shell-content');
  });
});

describe('Sidebar — persona nav sets (Epic #702 handoff)', () => {
  it('renders the athlete nav set in canonical order', () => {
    const view = buildSidebarView({ persona: 'athlete' });
    expect(view.rows.map((r) => r.label)).toEqual([
      'Home',
      'My profile',
      'My teams',
      'Calendar',
      'Team feed',
      'Stats & awards',
    ]);
  });

  it('renders the coach nav set in canonical order', () => {
    const view = buildSidebarView({ persona: 'coach' });
    expect(view.rows.map((r) => r.label)).toEqual([
      'Home',
      'Roster',
      'Verify stats',
      'Calendar',
      'Team feed',
      'Announcements',
    ]);
  });

  it('renders the org nav set in canonical order', () => {
    const view = buildSidebarView({ persona: 'org' });
    expect(view.rows.map((r) => r.label)).toEqual([
      'Overview',
      'Teams',
      'Coaches',
      'Athletes',
      'Events',
      'Reports',
    ]);
  });

  it('throws TypeError for an unknown persona', () => {
    expect(() =>
      // @ts-expect-error — deliberate invalid persona.
      buildSidebarView({ persona: 'admin' }),
    ).toThrow(TypeError);
  });

  it('passes through a lucide-react icon name for every row', () => {
    const personas: SidebarPersona[] = ['athlete', 'coach', 'org'];
    for (const persona of personas) {
      const view = buildSidebarView({ persona });
      for (const row of view.rows) {
        expect(typeof row.icon).toBe('string');
        expect(row.icon.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('Sidebar — active row styling (color-mix(brand 10%))', () => {
  it('flags the row whose href matches the active prop', () => {
    const view = buildSidebarView({ persona: 'athlete', active: '/calendar' });
    const activeRows = view.rows.filter((r) => r.active);
    expect(activeRows).toHaveLength(1);
    expect(activeRows[0]?.label).toBe('Calendar');
  });

  it("paints the active row's background via color-mix(brand 10%)", () => {
    const view = buildSidebarView({ persona: 'coach', active: '/roster' });
    const active = view.rows.find((r) => r.active);
    expect(active?.activeStyle).toBe(
      'background-color:color-mix(in srgb, var(--color-brand) 10%, transparent)',
    );
    expect(SIDEBAR_ACTIVE_BG).toContain('color-mix');
    expect(SIDEBAR_ACTIVE_BG).toContain('var(--color-brand)');
    expect(SIDEBAR_ACTIVE_BG).toContain('10%');
  });

  it('leaves every row inactive when no `active` prop is supplied', () => {
    const view = buildSidebarView({ persona: 'org' });
    expect(view.rows.every((r) => !r.active)).toBe(true);
    expect(view.rows.every((r) => r.activeStyle === null)).toBe(true);
  });

  it('leaves every row inactive when `active` matches no nav href', () => {
    const view = buildSidebarView({ persona: 'athlete', active: '/nowhere' });
    expect(view.rows.every((r) => !r.active)).toBe(true);
  });
});

describe('Sidebar — testIds', () => {
  it('exposes the canonical sidebar root testId by default', () => {
    const view = buildSidebarView({ persona: 'athlete' });
    expect(view.testId).toBe(SIDEBAR_TEST_ID);
    expect(view.testId).toBe('sidebar');
  });

  it('allows the sidebar root testId to be overridden', () => {
    const view = buildSidebarView({ persona: 'athlete', testId: 'app-sidebar' });
    expect(view.testId).toBe('app-sidebar');
  });

  it('exposes a slug-derived testId per row (sidebar-item-<slug>)', () => {
    const view = buildSidebarView({ persona: 'athlete' });
    expect(view.rows[0]?.testId).toBe(`${SIDEBAR_ITEM_TEST_ID_PREFIX}home`);
    const statsRow = view.rows.find((r) => r.label === 'Stats & awards');
    expect(statsRow?.testId).toBe(`${SIDEBAR_ITEM_TEST_ID_PREFIX}stats-and-awards`);
  });
});

describe('SIDEBAR_NAV — registry shape (defensive pin)', () => {
  it('exposes nav sets for exactly the three canonical personas', () => {
    expect(Object.keys(SIDEBAR_NAV).sort()).toEqual(['athlete', 'coach', 'org']);
  });

  it('renders six rows per persona', () => {
    expect(SIDEBAR_NAV.athlete).toHaveLength(6);
    expect(SIDEBAR_NAV.coach).toHaveLength(6);
    expect(SIDEBAR_NAV.org).toHaveLength(6);
  });
});
