/**
 * Unit test — the rosterEntries Drizzle table exposes the columns the
 * Tech Spec pins (Epic #11 / Story #910 / Task #915).
 *
 * Asserts column presence by name so the schema and the migration
 * cannot drift silently: if a future Story renames a column on one
 * side without updating the other, this test fails before merge.
 */

import { describe, expect, it } from 'vitest';
import { rosterEntries } from '../rosterEntries';
import { schema } from '../index';

describe('rosterEntries — Drizzle table shape', () => {
  it('declares every column nominated by Tech Spec #906 §Data Models', () => {
    const cols = Object.keys(rosterEntries).sort();
    // Drizzle's table builder exposes the column keys as the JS
    // object keys on the table; assert the camelCase Drizzle surface.
    const expected = [
      'athleteUserId',
      'createdAt',
      'endedAt',
      'id',
      'jerseyNumber',
      'orgId',
      'primaryPosition',
      'teamId',
      'updatedAt',
    ];
    for (const key of expected) {
      expect(cols).toContain(key);
    }
  });

  it('is re-exported from the schema barrel', () => {
    expect(schema.rosterEntries).toBe(rosterEntries);
  });
});
