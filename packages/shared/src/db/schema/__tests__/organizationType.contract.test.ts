/**
 * Contract test — organizations.organization_type enum (Story #617,
 * Task #625).
 *
 * Pins the enum contract for the multi-tenant data model: each of the
 * three canonical types (CLUB, HIGH_SCHOOL, COLLEGE) inserts and
 * round-trips against an ephemeral SQLite built from the canonical
 * migrations.
 *
 * The negative-case test (an unsupported string is rejected by the DB
 * layer) is currently `it.skip` and tracked by issue #642 — the
 * `organizations` table rebuilt by migration 0002 lacks the `CHECK`
 * constraint that would make Drizzle's TypeScript `enum` hint
 * load-bearing at the persistence layer. The skip points to the gap so
 * the assertion flips active in the same PR that lands the follow-up
 * migration.
 */

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { ORGANIZATION_TYPES, type OrganizationType, organizations } from '../organizations';
import { freshSchemaDb } from './freshSchemaDb';

describe('organizations.organization_type — enum acceptance', () => {
  for (const value of ORGANIZATION_TYPES) {
    it(`accepts ${value} and round-trips the value`, async () => {
      const db = freshSchemaDb();
      await db.insert(organizations).values({
        id: `org_${value}`,
        name: `Org ${value}`,
        organizationType: value,
      });

      const row = await db.query.organizations.findFirst({
        where: eq(organizations.id, `org_${value}`),
      });
      expect(row).toBeDefined();
      expect(row?.organizationType).toBe(value);
    });
  }
});

describe('organizations.organization_type — enum rejection', () => {
  // Gated on follow-up issue #642 (add CHECK constraint to
  // `organizations.organization_type` via migration 0003). The
  // production schema currently relies on the Drizzle TypeScript enum
  // hint only — the DB itself accepts arbitrary text. Once the CHECK
  // constraint lands, flip `.skip` to active and the assertion below
  // will start enforcing the rejection contract at the persistence
  // boundary.
  it.skip('rejects an unsupported string at insert time (blocked on #642)', async () => {
    const db = freshSchemaDb();

    // Cast bypasses the compile-time enum guard so we exercise the
    // persistence-layer rejection rather than the TypeScript-only one.
    const insert = () =>
      db.insert(organizations).values({
        id: 'org_bad',
        name: 'Org Bad',
        organizationType: 'UNIVERSITY' as unknown as OrganizationType,
      });

    await expect(insert()).rejects.toThrow();

    const leaked = await db.query.organizations.findFirst({
      where: eq(organizations.id, 'org_bad'),
    });
    expect(leaked).toBeUndefined();
  });
});
