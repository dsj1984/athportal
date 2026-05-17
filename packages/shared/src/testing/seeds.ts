/**
 * @repo/shared/testing/seeds — seedUser / seedResource helpers.
 *
 * Each seed helper:
 *   1. Routes overrides through `assertSyntheticPii` so a real PII value
 *      throws **before** any DB I/O.
 *   2. Fills synthetic defaults so a call with no overrides still produces
 *      a row whose `email` matches `/^test-.+@example\.invalid$/`.
 *   3. Returns the inserted row using Drizzle's `returning()` so callers
 *      can drive ownership-bound fixtures (`seedResource(db, { ownerId: u.id })`).
 *
 * Story #172 / Task #181.
 */

import { randomUUID } from 'node:crypto';
import type { TestDb } from './db';
import { assertSyntheticPii } from './safety';
import {
  type NewResource,
  type NewUser,
  type Resource,
  type User,
  resources,
  users,
} from './schema';

export type SeedUserOverrides = Partial<NewUser>;

/**
 * Insert a synthetic user row into the provided DB. Overrides pass through
 * the synthetic-PII guard before reaching SQLite. Returns the inserted row.
 */
export function seedUser(db: TestDb, overrides: SeedUserOverrides = {}): User {
  assertSyntheticPii(overrides);
  const id = overrides.id ?? `u_${randomUUID()}`;
  const clerkId = overrides.clerkId ?? `clerk_${randomUUID()}`;
  const email = overrides.email ?? `test-${randomUUID().slice(0, 8)}@example.invalid`;
  const role = overrides.role ?? 'org_admin';
  const values: NewUser = {
    ...overrides,
    id,
    clerkId,
    email,
    role,
  };
  const inserted = db.insert(users).values(values).returning().all();
  const row = inserted[0];
  if (!row) {
    throw new Error('seedUser: insert returned no row');
  }
  return row;
}

/**
 * Required input for `seedResource` — ownership is mandatory at the type
 * level so a caller cannot accidentally orphan a row.
 */
export interface SeedResourceInput extends Partial<Omit<NewResource, 'ownerId'>> {
  ownerId: string;
}

/**
 * Insert a synthetic resource row owned by `ownerId`. Overrides pass
 * through the synthetic-PII guard. Returns the inserted row.
 */
export function seedResource(db: TestDb, input: SeedResourceInput): Resource {
  assertSyntheticPii(input);
  const id = input.id ?? `r_${randomUUID()}`;
  const name = input.name ?? `Test Resource ${id}`;
  const values: NewResource = {
    ...input,
    id,
    name,
    ownerId: input.ownerId,
  };
  const inserted = db.insert(resources).values(values).returning().all();
  const row = inserted[0];
  if (!row) {
    throw new Error('seedResource: insert returned no row');
  }
  return row;
}
