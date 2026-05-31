// apps/web/src/lib/navigation.test.ts
//
// Unit tests for the App Shell nav registry (Story #971). Pins:
//
//   1. The org-admin nav set matches the Story acceptance verbatim
//      (Teams, Org config, Invitations, Import, Reports, Rollover, in
//      that order). Story #1086 added the Org config row.
//   2. `resolveAppNav` throws on an unknown role so the renderer can't
//      silently render an empty header.
//   3. `buildAppNavView` flags exactly the row matching `activeHref`,
//      and exposes the slug-derived data-testid each row renders with.

import { describe, expect, it } from 'vitest';
import { APP_NAV, APP_NAV_ITEM_TEST_ID_PREFIX, buildAppNavView, resolveAppNav } from './navigation';

describe('navigation — org_admin nav set (Story #971 acceptance)', () => {
  it('renders the org-admin rows in canonical order', () => {
    // Story #1092 inserted Roster directly after Teams (the people /
    // structure grouping).
    expect(APP_NAV.org_admin.map((r) => r.label)).toEqual([
      'Teams',
      'Roster',
      'Org config',
      'Invitations',
      'Import',
      'Reports',
      'Rollover',
    ]);
  });

  it('points org-admin rows at their canonical hrefs', () => {
    expect(APP_NAV.org_admin.map((r) => r.href)).toEqual([
      '/admin/teams',
      '/admin/roster',
      '/admin/org',
      '/admin/invitations',
      '/admin/import',
      '/admin/reports',
      '/admin/rollover',
    ]);
  });

  it('includes a row for every admin surface the org-admin role grants', () => {
    // Story #1086 acceptance: org-admin must reach Teams, Org config,
    // pending invitations, Import, Reports, and Rollover via visible
    // affordances. Story #1092 adds the org-wide Roster. The shared
    // header is the affordance carrier.
    const hrefs = new Set(APP_NAV.org_admin.map((r) => r.href));
    for (const required of [
      '/admin/teams',
      '/admin/roster',
      '/admin/org',
      '/admin/invitations',
      '/admin/import',
      '/admin/reports',
      '/admin/rollover',
    ]) {
      expect(hrefs.has(required)).toBe(true);
    }
  });

  it('exposes the org-wide roster affordance only to org_admin (Story #1092)', () => {
    expect(APP_NAV.org_admin.some((r) => r.href === '/admin/roster')).toBe(true);
    // The roster is an org-admin surface — it must not leak into the
    // coach or athlete nav sets (both empty today; assert the negative
    // so a future non-empty set can't silently inherit it).
    expect(APP_NAV.coach.some((r) => r.href === '/admin/roster')).toBe(false);
    expect(APP_NAV.athlete.some((r) => r.href === '/admin/roster')).toBe(false);
  });
});

describe('navigation — resolveAppNav', () => {
  it('returns the org_admin list verbatim', () => {
    expect(resolveAppNav('org_admin')).toBe(APP_NAV.org_admin);
  });

  it('throws TypeError on an unknown role', () => {
    expect(() =>
      // @ts-expect-error — deliberate invalid role.
      resolveAppNav('overlord'),
    ).toThrow(TypeError);
  });
});

describe('navigation — buildAppNavView', () => {
  it('flags exactly the row whose href matches activeHref', () => {
    const view = buildAppNavView('org_admin', '/admin/teams');
    const active = view.filter((r) => r.active);
    expect(active).toHaveLength(1);
    expect(active[0]?.label).toBe('Teams');
  });

  it('leaves every row inactive when activeHref matches no row', () => {
    const view = buildAppNavView('org_admin', '/nowhere');
    expect(view.every((r) => !r.active)).toBe(true);
  });

  it('leaves every row inactive when activeHref is omitted', () => {
    const view = buildAppNavView('org_admin');
    expect(view.every((r) => !r.active)).toBe(true);
  });

  it('stamps each row with a slug-derived data-testid', () => {
    const view = buildAppNavView('org_admin', '/admin/teams');
    expect(view[0]?.testId).toBe(`${APP_NAV_ITEM_TEST_ID_PREFIX}teams`);
    expect(view[1]?.testId).toBe(`${APP_NAV_ITEM_TEST_ID_PREFIX}roster`);
    expect(view[2]?.testId).toBe(`${APP_NAV_ITEM_TEST_ID_PREFIX}org-config`);
    expect(view[3]?.testId).toBe(`${APP_NAV_ITEM_TEST_ID_PREFIX}invitations`);
    expect(view[6]?.testId).toBe(`${APP_NAV_ITEM_TEST_ID_PREFIX}rollover`);
  });
});
