// apps/web/src/components/admin/InvitationList.test.ts
//
// Unit tests for the pure-TS helpers behind the org-admin
// pending-invitations table on `/admin/invitations` (Story #1088).
//
// Pins the epoch-milliseconds contract for the "Sent" column:
// `GET /api/v1/admin/invitations` returns `createdAt` already in
// epoch milliseconds, so `formatInvitationTimestamp` must pass it to
// `new Date(...)` unscaled. The regression these tests guard is the
// inline `new Date(ts * 1000)` that double-scaled an epoch-ms value
// and rendered the "Sent" date as the year ~58381.

import { describe, expect, it } from 'vitest';
import { formatInvitationTimestamp } from './InvitationList';

describe('formatInvitationTimestamp', () => {
  // 1780178874000 ms === 2026-05-30 (the value observed in the bug
  // report). Asserting the rendered year is locale-robust: the year
  // appears in every locale `toLocaleString()` produces, while the
  // exact separators/order do not.
  const EPOCH_MS = 1_780_178_874_000;

  it('treats the input as epoch milliseconds (no *1000 re-scaling)', () => {
    const expectedYear = String(new Date(EPOCH_MS).getFullYear());
    expect(formatInvitationTimestamp(EPOCH_MS)).toContain(expectedYear);
  });

  it('does not double-scale into the far future (regression guard for #1088)', () => {
    // If the formatter re-scaled by 1000, this epoch-ms value would
    // land in the year ~58381 — the exact symptom the Story reports.
    expect(formatInvitationTimestamp(EPOCH_MS)).not.toContain('58381');
  });

  it('renders the same label as a plain epoch-ms Date', () => {
    // The formatter is a thin, unscaled wrapper — its output must match
    // a direct epoch-ms `Date` render for any instant.
    expect(formatInvitationTimestamp(EPOCH_MS)).toBe(new Date(EPOCH_MS).toLocaleString());
  });
});
