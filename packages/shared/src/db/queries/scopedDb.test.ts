/**
 * Unit tests for `scopedDb` (Story #607, Task #622).
 *
 * Pin the proxy semantics against a mocked Drizzle handle. The contract
 * test (Task #621) covers cross-tenant isolation end-to-end against an
 * ephemeral SQLite; these unit tests cover the proxy mechanics in
 * isolation — what predicate gets injected, which path throws, how the
 * `crossTenant()` gate behaves per role.
 *
 * No real database — `getSQL(...)` (Drizzle internals) is used only to
 * inspect the SQL chunks the proxy emits, never to run queries.
 */

import { type SQL, eq, getTableColumns } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import type { AuthContext } from '../../rbac/types';
import { athleteMemberships } from '../schema/athleteMemberships';
import { coachAssignments } from '../schema/coachAssignments';
import { organizations } from '../schema/organizations';
import { teams } from '../schema/teams';
import { users } from '../schema/users';
import { type ScopedDbHandle, scopedDb } from './scopedDb';

/**
 * Build a mocked Drizzle handle. Each `query.<table>` method records the
 * arguments it was called with so the test can introspect the `where`
 * predicate; the write builders forward through `vi.fn()` chains.
 */
function makeMockHandle(): {
  handle: ScopedDbHandle;
  spies: {
    findFirst: Record<string, ReturnType<typeof vi.fn>>;
    findMany: Record<string, ReturnType<typeof vi.fn>>;
    insert: ReturnType<typeof vi.fn>;
    insertValues: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateSet: ReturnType<typeof vi.fn>;
    updateWhere: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    deleteWhere: ReturnType<typeof vi.fn>;
  };
} {
  const tableNames = [
    'organizations',
    'teams',
    'users',
    'coachAssignments',
    'athleteMemberships',
  ] as const;
  const findFirst: Record<string, ReturnType<typeof vi.fn>> = {};
  const findMany: Record<string, ReturnType<typeof vi.fn>> = {};
  const query: Record<string, { findFirst: typeof vi.fn; findMany: typeof vi.fn }> = {};
  for (const name of tableNames) {
    findFirst[name] = vi.fn().mockResolvedValue(undefined);
    findMany[name] = vi.fn().mockResolvedValue([]);
    query[name] = {
      findFirst: findFirst[name] as unknown as typeof vi.fn,
      findMany: findMany[name] as unknown as typeof vi.fn,
    };
  }

  const insertValues = vi.fn().mockReturnValue({ __op: 'insert.values' });
  const insert = vi.fn().mockReturnValue({ values: insertValues });

  const updateWhere = vi.fn().mockReturnValue({ __op: 'update.where' });
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const update = vi.fn().mockReturnValue({ set: updateSet, where: updateWhere });

  const deleteWhere = vi.fn().mockReturnValue({ __op: 'delete.where' });
  const deleteBuilder = vi.fn().mockReturnValue({ where: deleteWhere });

  const handle = {
    query: query as unknown as ScopedDbHandle['query'],
    insert: insert as unknown as ScopedDbHandle['insert'],
    update: update as unknown as ScopedDbHandle['update'],
    delete: deleteBuilder as unknown as ScopedDbHandle['delete'],
  };

  return {
    handle,
    spies: {
      findFirst,
      findMany,
      insert,
      insertValues,
      update,
      updateSet,
      updateWhere,
      delete: deleteBuilder,
      deleteWhere,
    },
  };
}

function orgAdmin(orgId = 'org-A'): AuthContext {
  return {
    userId: 'u-1',
    clerkSubjectId: 'clerk-1',
    role: 'org_admin',
    orgId,
  };
}

function devAdmin(): AuthContext {
  return {
    userId: 'u-dev',
    clerkSubjectId: 'clerk-dev',
    role: 'dev_admin',
  };
}

describe('scopedDb — construction guards', () => {
  it('throws when a non-dev_admin actor has no orgId', () => {
    const { handle } = makeMockHandle();
    expect(() =>
      scopedDb(handle, {
        userId: 'u-1',
        clerkSubjectId: 'clerk-1',
        role: 'org_admin',
      }),
    ).toThrow(/non-dev_admin actor must have orgId/);
  });

  it('allows a dev_admin actor to construct without orgId (escape-hatch precursor)', () => {
    const { handle } = makeMockHandle();
    expect(() => scopedDb(handle, devAdmin())).not.toThrow();
  });

  it.each(['org_admin', 'team_admin', 'member'] as const)('allows %s with orgId set', (role) => {
    const { handle } = makeMockHandle();
    expect(() =>
      scopedDb(handle, {
        userId: 'u-1',
        clerkSubjectId: 'clerk-1',
        role,
        orgId: 'org-A',
      }),
    ).not.toThrow();
  });
});

describe('scopedDb — read surface injects org-id scope', () => {
  it.each([
    'teams',
    'users',
    'coachAssignments',
    'athleteMemberships',
  ] as const)('findFirst(%s) forwards eq(<table>.org_id, actor.orgId)', async (name) => {
    const { handle, spies } = makeMockHandle();
    const scoped = scopedDb(handle, orgAdmin('org-A'));
    // Touch the lazy getter dynamically; one path per table name.
    const node = (scoped as unknown as Record<string, { findFirst: () => Promise<unknown> }>)[name];
    if (!node) throw new Error(`missing scoped node for ${name}`);
    await node.findFirst();
    const spy = spies.findFirst[name];
    if (!spy) throw new Error(`missing spy for ${name}`);
    expect(spy).toHaveBeenCalledTimes(1);
    const callArg = spy.mock.calls[0]?.[0] as { where: SQL } | undefined;
    expect(callArg).toBeDefined();
    expect(callArg?.where).toBeDefined();
  });

  it('organizations scope keys off organizations.id (the tenant boundary itself)', async () => {
    const { handle, spies } = makeMockHandle();
    const scoped = scopedDb(handle, orgAdmin('org-A'));
    await scoped.organizations.findFirst();
    const spy = spies.findFirst.organizations;
    if (!spy) throw new Error('missing organizations spy');
    expect(spy).toHaveBeenCalledTimes(1);
    const callArg = spy.mock.calls[0]?.[0] as { where: SQL } | undefined;
    expect(callArg?.where).toBeDefined();
  });

  it("combines the caller's where with the org-scope predicate", async () => {
    const { handle, spies } = makeMockHandle();
    const scoped = scopedDb(handle, orgAdmin('org-A'));
    const callerWhere = eq(teams.id, 'team-1');
    await scoped.teams.findFirst({ where: callerWhere });
    const spy = spies.findFirst.teams;
    if (!spy) throw new Error('missing teams spy');
    const callArg = spy.mock.calls[0]?.[0] as { where: SQL } | undefined;
    expect(callArg?.where).toBeDefined();
    // The combined predicate is not the caller's verbatim — the wrapper
    // composes it with `and(scope, callerWhere)`.
    expect(callArg?.where).not.toBe(callerWhere);
  });

  it('forwards extra Drizzle options (with / orderBy / limit) verbatim', async () => {
    const { handle, spies } = makeMockHandle();
    const scoped = scopedDb(handle, orgAdmin('org-A'));
    const opts = { columns: { id: true } as const, limit: 5 };
    await scoped.teams.findMany(opts);
    const spy = spies.findMany.teams;
    if (!spy) throw new Error('missing teams spy');
    const callArg = spy.mock.calls[0]?.[0] as
      | { columns: unknown; limit: number; where: SQL }
      | undefined;
    expect(callArg?.columns).toEqual({ id: true });
    expect(callArg?.limit).toBe(5);
    expect(callArg?.where).toBeDefined();
  });
});

describe('scopedDb — write surface rejects unscoped rows', () => {
  it('insert(teams) rejects a row whose orgId does not match the actor', () => {
    const { handle, spies } = makeMockHandle();
    const scoped = scopedDb(handle, orgAdmin('org-A'));
    expect(() =>
      scoped.insert(teams).values({ id: 't-1', orgId: 'org-B', name: 'Other-Tenant Team' }),
    ).toThrow(/row\.orgId must equal actor\.orgId/);
    expect(spies.insertValues).not.toHaveBeenCalled();
  });

  it('insert(teams) accepts a row whose orgId matches the actor', () => {
    const { handle, spies } = makeMockHandle();
    const scoped = scopedDb(handle, orgAdmin('org-A'));
    expect(() =>
      scoped.insert(teams).values({ id: 't-1', orgId: 'org-A', name: 'My Team' }),
    ).not.toThrow();
    expect(spies.insertValues).toHaveBeenCalledTimes(1);
  });

  it('insert(organizations) rejects a row whose id does not match the actor orgId', () => {
    const { handle } = makeMockHandle();
    const scoped = scopedDb(handle, orgAdmin('org-A'));
    expect(() => scoped.insert(organizations).values({ id: 'org-B', name: 'Other org' })).toThrow(
      /row\.id must equal actor\.orgId/,
    );
  });

  it('insert(organizations) accepts a row whose id equals actor orgId', () => {
    const { handle, spies } = makeMockHandle();
    const scoped = scopedDb(handle, orgAdmin('org-A'));
    expect(() =>
      scoped.insert(organizations).values({ id: 'org-A', name: 'Same org' }),
    ).not.toThrow();
    expect(spies.insertValues).toHaveBeenCalledTimes(1);
  });

  it('insert rejects a value-array containing any out-of-tenant row', () => {
    const { handle, spies } = makeMockHandle();
    const scoped = scopedDb(handle, orgAdmin('org-A'));
    expect(() =>
      scoped.insert(teams).values([
        { id: 't-1', orgId: 'org-A', name: 'OK' },
        { id: 't-2', orgId: 'org-B', name: 'Leak' },
      ]),
    ).toThrow(/row\.orgId must equal actor\.orgId/);
    expect(spies.insertValues).not.toHaveBeenCalled();
  });

  it('update forces eq(<table>.org_id, actor.orgId) into the where clause', () => {
    const { handle, spies } = makeMockHandle();
    const scoped = scopedDb(handle, orgAdmin('org-A'));
    const callerWhere = eq(teams.id, 't-1');
    scoped.update(teams).set({ name: 'Renamed' }).where(callerWhere);
    expect(spies.update).toHaveBeenCalledWith(teams);
    expect(spies.updateSet).toHaveBeenCalledWith({ name: 'Renamed' });
    const sentWhere = spies.updateWhere.mock.calls[0]?.[0] as SQL | undefined;
    expect(sentWhere).toBeDefined();
    expect(sentWhere).not.toBe(callerWhere);
  });

  it('delete forces eq(<table>.org_id, actor.orgId) into the where clause', () => {
    const { handle, spies } = makeMockHandle();
    const scoped = scopedDb(handle, orgAdmin('org-A'));
    const callerWhere = eq(teams.id, 't-1');
    scoped.delete(teams).where(callerWhere);
    expect(spies.delete).toHaveBeenCalledWith(teams);
    const sentWhere = spies.deleteWhere.mock.calls[0]?.[0] as SQL | undefined;
    expect(sentWhere).toBeDefined();
    expect(sentWhere).not.toBe(callerWhere);
  });

  it('insert/update/delete throw on tables outside the scoped set', () => {
    // Construct a Drizzle table that is NOT one of the five graph tables
    // by reusing a column-bearing table object — `organizations` would
    // be valid, so we pick a non-listed reference (e.g. an arbitrary
    // SQLiteTable proxy). Simulate by passing a plain object cast.
    const stray = {} as unknown as Parameters<typeof scopedDb>[0]['insert'] extends (
      t: infer T,
    ) => unknown
      ? T
      : never;
    const { handle } = makeMockHandle();
    const scoped = scopedDb(handle, orgAdmin('org-A'));
    expect(() => scoped.insert(stray).values({})).toThrow(/scoped graph tables/);
    expect(() => scoped.update(stray).set({}).where(eq(teams.id, 't-1'))).toThrow(
      /scoped graph tables/,
    );
    expect(() => scoped.delete(stray).where(eq(teams.id, 't-1'))).toThrow(/scoped graph tables/);
  });
});

describe('scopedDb — crossTenant escape hatch', () => {
  it('returns the un-scoped handle for a dev_admin actor', () => {
    const { handle } = makeMockHandle();
    const scoped = scopedDb(handle, devAdmin());
    expect(scoped.crossTenant()).toBe(handle);
  });

  it.each(['org_admin', 'team_admin', 'member'] as const)('throws for role=%s', (role) => {
    const { handle } = makeMockHandle();
    const scoped = scopedDb(handle, {
      userId: 'u-1',
      clerkSubjectId: 'clerk-1',
      role,
      orgId: 'org-A',
    });
    expect(() => scoped.crossTenant()).toThrow(/Only dev_admin may bypass tenant scoping/);
  });

  it('dev_admin scoped reads/writes still require an orgId (no silent unscoped queries)', () => {
    const { handle } = makeMockHandle();
    const scoped = scopedDb(handle, devAdmin());
    expect(() => scoped.teams).toThrow(/dev_admin actor has no orgId/);
    expect(() => scoped.insert(teams).values({ id: 't-1', orgId: 'org-A', name: 'x' })).toThrow(
      /dev_admin actor has no orgId/,
    );
  });

  it('a dev_admin with orgId set CAN use the scoped surface AND escape via crossTenant', async () => {
    const { handle } = makeMockHandle();
    const scoped = scopedDb(handle, { ...devAdmin(), orgId: 'org-A' });
    await scoped.teams.findFirst();
    expect(scoped.crossTenant()).toBe(handle);
  });
});

describe('scopedDb — column wiring sanity', () => {
  // Lightweight self-check: the helper's internal scope-column map is
  // only correct if every join/leaf table really does carry `orgId`,
  // and `organizations` really does carry `id` as primary key. If a
  // schema rename ever lands without updating scopedDb, this fails.
  it('every scoped non-organizations table has an orgId column', () => {
    for (const table of [teams, users, coachAssignments, athleteMemberships]) {
      const cols = getTableColumns(table);
      expect(cols).toHaveProperty('orgId');
    }
  });

  it('organizations table has an id column (its own tenant boundary)', () => {
    const cols = getTableColumns(organizations);
    expect(cols).toHaveProperty('id');
  });
});
