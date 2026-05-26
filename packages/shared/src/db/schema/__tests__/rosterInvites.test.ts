/**
 * Unit test — the rosterInvites Drizzle table exposes the columns the
 * Tech Spec pins (Epic #11 / Story #910 / Task #916).
 *
 * Asserts column presence by name so the schema and the migration
 * cannot drift silently, and that the status literal set matches
 * the CHECK constraint declared in migration 0007.
 */

import { describe, expect, it } from 'vitest';
import { schema } from '../index';
import { ROSTER_INVITE_STATUSES, rosterInvites } from '../rosterInvites';

describe('rosterInvites — Drizzle table shape', () => {
  it('declares every column nominated by Tech Spec #906 §Data Models', () => {
    const cols = Object.keys(rosterInvites).sort();
    const expected = [
      'acceptedAt',
      'createdAt',
      'declinedAt',
      'email',
      'expiresAt',
      'firstName',
      'id',
      'invitedByUserId',
      'lastName',
      'orgId',
      'status',
      'teamId',
      'tokenHash',
      'updatedAt',
    ];
    for (const key of expected) {
      expect(cols).toContain(key);
    }
  });

  it('is re-exported from the schema barrel', () => {
    expect(schema.rosterInvites).toBe(rosterInvites);
  });

  it('pins the canonical status set used by the CHECK constraint', () => {
    expect([...ROSTER_INVITE_STATUSES]).toEqual([
      'pending',
      'accepted',
      'declined',
      'expired',
      'revoked',
    ]);
  });
});
