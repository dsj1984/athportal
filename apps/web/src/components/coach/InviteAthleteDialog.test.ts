// apps/web/src/components/coach/InviteAthleteDialog.test.ts
//
// Unit tests for the pure-TS helpers behind the coach invite dialog
// and pending-invites strip (Epic #11 / Story #920 / Task #923).
//
// Pins:
//   - `COACH_INVITE_TEST_IDS` constants stay stable (acceptance
//     suite contract).
//   - `buildInvitesUrl` / `buildRevokeUrl` URL-encode the teamId and
//     inviteId.
//   - `inviteDisplayName` falls back to email when names are absent.
//   - `formatExpiresLabel` renders "expired" for past timestamps and
//     "expires in N days" for future ones.
//   - `readInvitePayload` trims, drops blank optional fields, returns
//     null on blank email.
//   - `renderPendingInvites` produces one `<li>` per item with the
//     canonical row data-testid, a revoke button per row, and uses
//     `textContent` for every cell.

// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import {
  COACH_INVITE_TEST_IDS,
  type CoachInviteEntry,
  buildInvitesUrl,
  buildRevokeUrl,
  formatExpiresLabel,
  inviteDisplayName,
  readInvitePayload,
  renderPendingInvites,
} from './InviteAthleteDialog';

describe('COACH_INVITE_TEST_IDS — canonical data-testid contract', () => {
  it('exposes every selector the acceptance suite targets', () => {
    expect(COACH_INVITE_TEST_IDS.openBtn).toBe('coach-invite-open-btn');
    expect(COACH_INVITE_TEST_IDS.dialog).toBe('coach-invite-dialog');
    expect(COACH_INVITE_TEST_IDS.emailInput).toBe('coach-invite-email-input');
    expect(COACH_INVITE_TEST_IDS.submitBtn).toBe('coach-invite-submit-btn');
    expect(COACH_INVITE_TEST_IDS.row).toBe('coach-pending-invite-row');
    expect(COACH_INVITE_TEST_IDS.revokeBtn).toBe('coach-pending-invite-revoke-btn');
  });
});

describe('buildInvitesUrl / buildRevokeUrl', () => {
  it('builds the canonical invites list/create URL with the teamId URL-encoded', () => {
    expect(buildInvitesUrl('t_one')).toBe('/api/v1/coach/teams/t_one/roster/invites');
    expect(buildInvitesUrl('t one')).toBe('/api/v1/coach/teams/t%20one/roster/invites');
  });

  it('builds the revoke URL with both teamId and inviteId URL-encoded', () => {
    expect(buildRevokeUrl('t_one', 'inv_1')).toBe(
      '/api/v1/coach/teams/t_one/roster/invites/inv_1/revoke',
    );
    expect(buildRevokeUrl('t one', 'inv 1')).toBe(
      '/api/v1/coach/teams/t%20one/roster/invites/inv%201/revoke',
    );
  });
});

describe('inviteDisplayName', () => {
  it('joins first and last when both are present', () => {
    expect(
      inviteDisplayName({
        id: 'inv_1',
        teamId: 't_1',
        email: 'ada@x.test',
        firstName: 'Ada',
        lastName: 'Lovelace',
        status: 'pending',
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        createdAt: new Date().toISOString(),
      }),
    ).toBe('Ada Lovelace');
  });

  it('returns first name only when last is missing', () => {
    expect(
      inviteDisplayName({
        id: 'inv_1',
        teamId: 't_1',
        email: 'ada@x.test',
        firstName: 'Ada',
        lastName: null,
        status: 'pending',
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        createdAt: new Date().toISOString(),
      }),
    ).toBe('Ada');
  });

  it('falls back to email when both names are missing', () => {
    expect(
      inviteDisplayName({
        id: 'inv_1',
        teamId: 't_1',
        email: 'ada@x.test',
        firstName: null,
        lastName: null,
        status: 'pending',
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        createdAt: new Date().toISOString(),
      }),
    ).toBe('ada@x.test');
  });
});

describe('formatExpiresLabel', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');

  it('returns "expired" when expiresAt is in the past', () => {
    const past = new Date(now.getTime() - 86_400_000).toISOString();
    expect(formatExpiresLabel(past, now)).toBe('expired');
  });

  it('returns "expires in 1 day" for a single-day window', () => {
    const oneDay = new Date(now.getTime() + 86_400_000).toISOString();
    expect(formatExpiresLabel(oneDay, now)).toBe('expires in 1 day');
  });

  it('returns "expires in N days" for multi-day windows', () => {
    const sevenDays = new Date(now.getTime() + 7 * 86_400_000).toISOString();
    expect(formatExpiresLabel(sevenDays, now)).toBe('expires in 7 days');
  });
});

describe('readInvitePayload', () => {
  function makeForm(fields: Record<string, string>): HTMLFormElement {
    const form = document.createElement('form');
    for (const [name, value] of Object.entries(fields)) {
      const input = document.createElement('input');
      input.name = name;
      input.value = value;
      form.appendChild(input);
    }
    return form;
  }

  it('returns null when email is blank', () => {
    expect(readInvitePayload(makeForm({ email: '   ' }))).toBeNull();
  });

  it('trims whitespace around fields', () => {
    expect(
      readInvitePayload(
        makeForm({ email: '  ada@x.test  ', firstName: '  Ada  ', lastName: '  Lovelace  ' }),
      ),
    ).toEqual({ email: 'ada@x.test', firstName: 'Ada', lastName: 'Lovelace' });
  });

  it('drops blank optional fields rather than sending empty strings', () => {
    expect(
      readInvitePayload(makeForm({ email: 'ada@x.test', firstName: '', lastName: '' })),
    ).toEqual({ email: 'ada@x.test' });
  });
});

describe('renderPendingInvites', () => {
  let list: HTMLElement;

  beforeEach(() => {
    list = document.createElement('ul');
    document.body.appendChild(list);
  });

  function entry(overrides: Partial<CoachInviteEntry> = {}): CoachInviteEntry {
    return {
      id: 'inv_default',
      teamId: 't_default',
      email: 'default@test.invalid',
      firstName: null,
      lastName: null,
      status: 'pending',
      expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      createdAt: new Date().toISOString(),
      ...overrides,
    };
  }

  it('renders one <li> per item with the canonical row data-testid and data-invite-id', () => {
    renderPendingInvites(list, [
      entry({ id: 'inv_a', email: 'ada@x.test' }),
      entry({ id: 'inv_b', email: 'bob@x.test' }),
    ]);

    const rows = list.querySelectorAll('li');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.getAttribute('data-testid')).toBe('coach-pending-invite-row');
    }
    expect(rows[0]?.getAttribute('data-invite-id')).toBe('inv_a');
  });

  it('renders a revoke button per row keyed by data-invite-id', () => {
    renderPendingInvites(list, [entry({ id: 'inv_x' })]);
    const btn = list.querySelector<HTMLButtonElement>(
      '[data-testid="coach-pending-invite-revoke-btn"]',
    );
    expect(btn).not.toBeNull();
    expect(btn?.getAttribute('data-invite-id')).toBe('inv_x');
    expect(btn?.type).toBe('button');
  });

  it('uses textContent (never innerHTML) for cell values', () => {
    const malicious = entry({
      firstName: '<script>alert(1)</script>',
      lastName: 'Hacker',
    });
    renderPendingInvites(list, [malicious]);
    const nameCell = list.querySelector('[data-col="name"]');
    expect(nameCell?.textContent).toBe('<script>alert(1)</script> Hacker');
    expect(nameCell?.querySelector('script')).toBeNull();
  });

  it('clears the container on re-render rather than appending', () => {
    renderPendingInvites(list, [entry({ id: 'inv_first' })]);
    expect(list.querySelectorAll('li')).toHaveLength(1);

    renderPendingInvites(list, [entry({ id: 'inv_second' }), entry({ id: 'inv_third' })]);
    const ids = Array.from(list.querySelectorAll('li')).map((li) =>
      li.getAttribute('data-invite-id'),
    );
    expect(ids).toEqual(['inv_second', 'inv_third']);
  });
});
