// apps/web/src/components/admin/rollover/RolloverPreview.test.ts
//
// Unit tests for the pure-TS helpers behind the season-rollover admin
// page (Epic #10 / Story #665 / Task #696). The companion `.astro`
// renderer is exercised at the acceptance tier (Task #694). These
// tests pin:
//
//   - `ROLLOVER_TEST_IDS` constants stay stable (load-bearing for the
//     acceptance suite).
//   - `renderDecisionRows` produces one `<tr>` per membership with the
//     canonical row testid and uses `textContent` (never `innerHTML`)
//     for every cell value.
//   - `collectDecisionDrafts` round-trips the operator's UI input into
//     the wire-shape choices the API expects.
//   - `renderPlanDiff` surfaces counts and per-write lines for each
//     plan section.
//   - `renderCommitStatus` formats the applied counts deterministically.

// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ROLLOVER_TEST_IDS,
  collectDecisionDrafts,
  renderCommitStatus,
  renderDecisionRows,
  renderPlanDiff,
} from './RolloverPreview';

let tbody: HTMLTableSectionElement;

beforeEach(() => {
  document.body.innerHTML = '';
  const table = document.createElement('table');
  tbody = document.createElement('tbody');
  table.appendChild(tbody);
  document.body.appendChild(table);
});

describe('ROLLOVER_TEST_IDS', () => {
  it('exposes the canonical selector vocabulary required by the AC tier', () => {
    expect(ROLLOVER_TEST_IDS.sourceSeason).toBe('admin-rollover-source-season');
    expect(ROLLOVER_TEST_IDS.targetSeason).toBe('admin-rollover-target-season');
    expect(ROLLOVER_TEST_IDS.decisions).toBe('admin-rollover-decisions');
    expect(ROLLOVER_TEST_IDS.previewBtn).toBe('admin-rollover-preview-btn');
    expect(ROLLOVER_TEST_IDS.commitBtn).toBe('admin-rollover-commit-btn');
    expect(ROLLOVER_TEST_IDS.diff).toBe('admin-rollover-diff');
    expect(ROLLOVER_TEST_IDS.status).toBe('admin-rollover-status');
  });
});

describe('renderDecisionRows', () => {
  it('renders one row per membership with the canonical testid', () => {
    renderDecisionRows(tbody, [
      {
        membershipId: 'am_1',
        athleteName: 'Ada Lovelace',
        sourceTeamId: 't_u14',
        sourceTeamName: 'U14',
      },
      {
        membershipId: 'am_2',
        athleteName: 'Grace Hopper',
        sourceTeamId: 't_u14',
        sourceTeamName: 'U14',
      },
    ]);
    const rows = tbody.querySelectorAll(`[data-testid="${ROLLOVER_TEST_IDS.decisionRow}"]`);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.getAttribute('data-membership-id')).toBe('am_1');
    expect(rows[1]?.getAttribute('data-membership-id')).toBe('am_2');
  });

  it('uses textContent for cell values (no innerHTML injection)', () => {
    renderDecisionRows(tbody, [
      {
        membershipId: 'am_1',
        athleteName: '<script>alert(1)</script>',
        sourceTeamId: 't_u14',
        sourceTeamName: 'U14',
      },
    ]);
    // The angle-bracketed content stays as text; no <script> child is
    // mounted.
    expect(tbody.querySelector('script')).toBeNull();
    const nameCell = tbody.querySelector('td[data-col="athlete"]');
    expect(nameCell?.textContent).toBe('<script>alert(1)</script>');
  });

  it('replaces existing rows on subsequent calls (idempotent render)', () => {
    renderDecisionRows(tbody, [
      {
        membershipId: 'am_1',
        athleteName: 'Ada',
        sourceTeamId: 't_a',
        sourceTeamName: 'A',
      },
    ]);
    renderDecisionRows(tbody, [
      {
        membershipId: 'am_2',
        athleteName: 'Grace',
        sourceTeamId: 't_b',
        sourceTeamName: 'B',
      },
    ]);
    const rows = tbody.querySelectorAll(`[data-testid="${ROLLOVER_TEST_IDS.decisionRow}"]`);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.getAttribute('data-membership-id')).toBe('am_2');
  });
});

describe('collectDecisionDrafts', () => {
  it('round-trips operator input into the wire-shape choices', () => {
    renderDecisionRows(tbody, [
      {
        membershipId: 'am_1',
        athleteName: 'Ada',
        sourceTeamId: 't_a',
        sourceTeamName: 'A',
      },
      {
        membershipId: 'am_2',
        athleteName: 'Grace',
        sourceTeamId: 't_a',
        sourceTeamName: 'A',
      },
    ]);
    // Operator picks: am_1 → promote to t_b; am_2 → archive.
    const select1 = tbody.querySelector<HTMLSelectElement>(
      `[data-testid="${ROLLOVER_TEST_IDS.decisionSelect}"][data-membership-id="am_1"]`,
    );
    const target1 = tbody.querySelector<HTMLInputElement>(
      `[data-testid="${ROLLOVER_TEST_IDS.decisionTargetTeam}"][data-membership-id="am_1"]`,
    );
    const select2 = tbody.querySelector<HTMLSelectElement>(
      `[data-testid="${ROLLOVER_TEST_IDS.decisionSelect}"][data-membership-id="am_2"]`,
    );
    if (select1) select1.value = 'promote';
    if (target1) target1.value = 't_b';
    if (select2) select2.value = 'archive';

    const drafts = collectDecisionDrafts(tbody);
    expect(drafts).toEqual([
      { membershipId: 'am_1', decision: 'promote', targetTeamId: 't_b' },
      { membershipId: 'am_2', decision: 'archive' },
    ]);
  });
});

describe('renderPlanDiff', () => {
  it('renders counts + per-section lines for archives, promotions, and errors', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderPlanDiff(container, {
      archives: [
        { membershipId: 'am_1', athleteUserId: 'u_a', sourceTeamId: 't_a', reason: 'promote' },
      ],
      promotions: [
        { athleteUserId: 'u_a', orgId: 'org_a', sourceTeamId: 't_a', targetTeamId: 't_b', reason: 'promote' },
      ],
      errors: [{ membershipId: 'am_z', code: 'UNKNOWN_MEMBERSHIP' }],
    });
    expect(container.querySelector('[data-col="counts"]')?.textContent).toContain(
      'Archives: 1 · Promotions: 1 · Errors: 1',
    );
    expect(container.querySelector('[data-col="archives"]')).not.toBeNull();
    expect(container.querySelector('[data-col="promotions"]')).not.toBeNull();
    expect(container.querySelector('[data-col="errors"]')).not.toBeNull();
  });

  it('clears prior content on a re-render', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderPlanDiff(container, {
      archives: [
        { membershipId: 'am_1', athleteUserId: 'u_a', sourceTeamId: 't_a', reason: 'archive' },
      ],
      promotions: [],
      errors: [],
    });
    renderPlanDiff(container, { archives: [], promotions: [], errors: [] });
    expect(container.querySelector('[data-col="archives"]')).toBeNull();
    expect(container.textContent).toContain('Archives: 0');
  });
});

describe('renderCommitStatus', () => {
  it('formats the applied counts in a deterministic single line', () => {
    const el = document.createElement('div');
    renderCommitStatus(el, { archived: 3, promoted: 2, errors: 1 });
    expect(el.textContent).toBe('Applied — archived: 3, promoted: 2, errors: 1');
  });
});
