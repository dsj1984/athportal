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
 * layer) is enforced by issue #642 — migration
 * 0011_organization_type_check.sql rebuilds the `organizations` table
 * with the `CHECK` constraint that makes Drizzle's TypeScript `enum`
 * hint load-bearing at the persistence layer.
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
  // Resolved by issue #642: migration 0011_organization_type_check.sql
  // adds `CHECK ("organization_type" IN ('CLUB','HIGH_SCHOOL','COLLEGE'))`
  // to the rebuilt `organizations` table, so the Drizzle TypeScript enum
  // hint is now load-bearing at the persistence layer. This assertion
  // enforces the rejection contract at the DB boundary.
  it('rejects an unsupported string at insert time', async () => {
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
