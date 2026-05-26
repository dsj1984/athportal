/**
 * Unit tests for the coach roster Zod boundary schemas
 * (Epic #11 / Story #910 / Task #911).
 *
 * Pure unit tier per `.agents/rules/testing-standards.md` — no DB, no
 * fetch, no React. Pins the load-bearing parser contracts that both
 * the API edge and the web boundary depend on.
 */

import { describe, expect, it } from 'vitest';
import {
  EditRosterEntryInput,
  InviteAthleteInput,
  ROSTER_INVITE_STATUSES,
  RosterEntryOutput,
  RosterInviteOutput,
} from './roster';

describe('InviteAthleteInput', () => {
  it('accepts a valid email and lowercases it', () => {
    const result = InviteAthleteInput.parse({ email: 'Coach@Example.COM' });
    expect(result.email).toBe('coach@example.com');
  });

  it('rejects non-email input', () => {
    expect(() => InviteAthleteInput.parse({ email: 'not-an-email' })).toThrow();
  });

  it('rejects empty email', () => {
    expect(() => InviteAthleteInput.parse({ email: '' })).toThrow();
  });

  it('accepts optional firstName / lastName', () => {
    const result = InviteAthleteInput.parse({
      email: 'a@b.co',
      firstName: 'Ada',
      lastName: 'Lovelace',
    });
    expect(result.firstName).toBe('Ada');
    expect(result.lastName).toBe('Lovelace');
  });

  it('rejects unknown keys (strict)', () => {
    expect(() => InviteAthleteInput.parse({ email: 'a@b.co', role: 'admin' })).toThrow();
  });

  it('rejects firstName longer than 80 chars', () => {
    expect(() =>
      InviteAthleteInput.parse({ email: 'a@b.co', firstName: 'x'.repeat(81) }),
    ).toThrow();
  });
});

describe('EditRosterEntryInput', () => {
  it('accepts a 1-digit jersey number', () => {
    const result = EditRosterEntryInput.parse({ jerseyNumber: '7' });
    expect(result.jerseyNumber).toBe('7');
  });

  it('accepts a 3-digit jersey number with leading zeros', () => {
    const result = EditRosterEntryInput.parse({ jerseyNumber: '007' });
    expect(result.jerseyNumber).toBe('007');
  });

  it('accepts "00" as a jersey number (string-typed column preserves it)', () => {
    const result = EditRosterEntryInput.parse({ jerseyNumber: '00' });
    expect(result.jerseyNumber).toBe('00');
  });

  it('rejects non-numeric jerseyNumber', () => {
    expect(() => EditRosterEntryInput.parse({ jerseyNumber: '12A' })).toThrow();
  });

  it('rejects jerseyNumber longer than 3 digits', () => {
    expect(() => EditRosterEntryInput.parse({ jerseyNumber: '1234' })).toThrow();
  });

  it('rejects negative jerseyNumber', () => {
    expect(() => EditRosterEntryInput.parse({ jerseyNumber: '-1' })).toThrow();
  });

  it('accepts null jerseyNumber (clear)', () => {
    const result = EditRosterEntryInput.parse({ jerseyNumber: null });
    expect(result.jerseyNumber).toBeNull();
  });

  it('accepts a primaryPosition at the 32-char boundary', () => {
    const pos = 'x'.repeat(32);
    const result = EditRosterEntryInput.parse({ primaryPosition: pos });
    expect(result.primaryPosition).toBe(pos);
  });

  it('rejects primaryPosition longer than 32 chars', () => {
    expect(() => EditRosterEntryInput.parse({ primaryPosition: 'x'.repeat(33) })).toThrow();
  });

  it('accepts null primaryPosition (clear)', () => {
    const result = EditRosterEntryInput.parse({ primaryPosition: null });
    expect(result.primaryPosition).toBeNull();
  });

  it('rejects an empty patch (no field provided)', () => {
    expect(() => EditRosterEntryInput.parse({})).toThrow();
  });

  it('rejects unknown keys (strict)', () => {
    expect(() => EditRosterEntryInput.parse({ jerseyNumber: '7', position: 'pitcher' })).toThrow();
  });
});

describe('RosterEntryOutput', () => {
  it('accepts a fully-populated row', () => {
    const row = {
      id: 'r1',
      teamId: 't1',
      athleteUserId: 'u1',
      athleteEmail: 'a@b.co',
      athleteFullName: 'Ada Lovelace',
      jerseyNumber: '7',
      primaryPosition: 'pitcher',
      endedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    };
    expect(RosterEntryOutput.parse(row)).toEqual(row);
  });

  it('rejects unknown keys (strict)', () => {
    expect(() =>
      RosterEntryOutput.parse({
        id: 'r1',
        teamId: 't1',
        athleteUserId: 'u1',
        athleteEmail: 'a@b.co',
        athleteFullName: 'Ada',
        jerseyNumber: null,
        primaryPosition: null,
        endedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        clerkSubjectId: 'leak',
      }),
    ).toThrow();
  });
});

describe('RosterInviteOutput', () => {
  it('accepts a pending invite row', () => {
    const row = {
      id: 'i1',
      teamId: 't1',
      email: 'a@b.co',
      firstName: null,
      lastName: null,
      status: 'pending' as const,
      expiresAt: '2026-01-08T00:00:00.000Z',
      acceptedAt: null,
      declinedAt: null,
      invitedByUserId: 'u-coach',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    expect(RosterInviteOutput.parse(row)).toEqual(row);
  });

  it('rejects an invalid status value', () => {
    expect(() =>
      RosterInviteOutput.parse({
        id: 'i1',
        teamId: 't1',
        email: 'a@b.co',
        firstName: null,
        lastName: null,
        status: 'bogus',
        expiresAt: '2026-01-08T00:00:00.000Z',
        acceptedAt: null,
        declinedAt: null,
        invitedByUserId: 'u-coach',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toThrow();
  });

  it('refuses to leak the plaintext token (strict)', () => {
    expect(() =>
      RosterInviteOutput.parse({
        id: 'i1',
        teamId: 't1',
        email: 'a@b.co',
        firstName: null,
        lastName: null,
        status: 'pending' as const,
        expiresAt: '2026-01-08T00:00:00.000Z',
        acceptedAt: null,
        declinedAt: null,
        invitedByUserId: 'u-coach',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        token: 'leak',
      }),
    ).toThrow();
  });

  it('enumerates the canonical status set', () => {
    expect([...ROSTER_INVITE_STATUSES]).toEqual([
      'pending',
      'accepted',
      'declined',
      'expired',
      'revoked',
    ]);
  });
});
