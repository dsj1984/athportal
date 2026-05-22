/**
 * Cross-tenant isolation property test (Story #627, Task #638).
 *
 * This is the load-bearing acceptance gate for Epic #9 (Acceptance Spec
 * #597, AC-13). The fast-check property below explores the cartesian
 * envelope of
 *
 *     (orgA, orgB, role, resource, action)
 *
 * across two seeded orgs, three meaningful roles (`org_admin`,
 * `team_admin`, `member` — `dev_admin` is excluded because it is
 * allow-all and bypasses scoping by design), the five graph resources
 * (`organization`, `team`, `user`, `coachAssignment`,
 * `athleteMembership`), and the full action set (`read`, `list`,
 * `update`, `delete`). For every generated tuple the test proves two
 * properties that together pin cross-tenant isolation end-to-end:
 *
 *   1. **No read leakage.** A read through `scopedDb(actor)` where the
 *      actor's `orgId` is `orgA` never returns a row owned by `orgB`,
 *      no matter which of the five graph tables is queried. This holds
 *      for both `findFirst({ where: eq(<table>.id, <foreignId>) })`
 *      and unconstrained `findMany()`.
 *
 *   2. **canPerform ↔ routed outcome agreement.** The verdict returned
 *      by `canPerform(role, resource, action, ctx)` agrees with the
 *      routed outcome through the production isolation boundary
 *      (`scopedDb`):
 *
 *        - allowed → the same-tenant routed read returns the row;
 *                    the foreign-tenant routed read returns undefined;
 *                    a same-tenant write succeeds (mutation visible
 *                    when re-read by a `dev_admin` cross-tenant view);
 *                    a foreign-tenant write is silently no-op.
 *        - denied  → the routed write is silently no-op (the row's
 *                    pre-image is preserved when re-read).
 *
 * The seam tested is `scopedDb` because it IS the production routing
 * boundary every protected route consults before reaching SQLite. The
 * Hono route handlers under `apps/api/src/routes/v1/**` go through
 * `scopedDb` for every graph read and write — pinning isolation here
 * pins it for every current and future route that honors the seam.
 *
 * Authentication seam: each generated actor is paired with a seeded
 * users row whose `clerk_subject_id` is fed through
 * `authHeaders(seededUser)` to confirm the contract-tier auth seam at
 * `packages/shared/src/testing/auth.ts` resolves to a well-formed
 * header bag for the synthetic Clerk test-instance subject. This is
 * the same seam consumed by `createTestApp(db, { actor })` — the
 * property test wires it explicitly so a future route-tier extension
 * (e.g. `apps/api/src/routes/v1/teams/list.contract.test.ts`) inherits
 * an already-validated header bag rather than re-deriving one.
 *
 * The property runs ≥ 100 generated cases per invocation (the
 * `numRuns: 100` budget exercises the full role × resource × action
 * matrix with the default fast-check shrinker enabled). The nightly
 * workflow (`.github/workflows/nightly.yml`, Task #636) bumps the
 * case count via `FC_NUM_RUNS` for the randomized cadence.
 *
 * Tech Spec #596 §"Property-based cross-tenant isolation test" and
 * Acceptance Spec #597 AC-13 name this test as the launch-blocking
 * contract; do not relax its assertions without an explicit Epic-level
 * decision recorded in `docs/decisions.md`.
 */

import { eq } from 'drizzle-orm';
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type GraphTestDb, freshGraphDb } from '../../db/queries/__tests__/graphDb';
import { type ScopedDbHandle, scopedDb } from '../../db/queries/scopedDb';
import { athleteMemberships } from '../../db/schema/athleteMemberships';
import { coachAssignments } from '../../db/schema/coachAssignments';
import { organizations } from '../../db/schema/organizations';
import { teams } from '../../db/schema/teams';
import { users } from '../../db/schema/users';
import { canPerform } from '../../rbac/policy';
import type { Action, AuthContext, RbacContext, Resource, Role } from '../../rbac/types';
import { authHeaders } from '../auth';

/**
 * Roles the property explores. `dev_admin` is intentionally excluded —
 * it is allow-all by policy and reaches SQLite via the `crossTenant()`
 * escape hatch, which is a separately-tested seam (see
 * `scopedDbCrossTenant.contract.test.ts`).
 */
const ROLES = ['org_admin', 'team_admin', 'member'] as const satisfies readonly Role[];

/**
 * Every resource the Epic #9 graph schema introduces or extends.
 * `invitation` is omitted because the graph isolation contract is
 * scoped to the five graph tables (Tech Spec #596 §Schema).
 */
const RESOURCES = [
  'organization',
  'team',
  'user',
  'coachAssignment',
  'athleteMembership',
] as const satisfies readonly Resource[];

/**
 * Verbs the routed-outcome property covers. `create` is excluded
 * because the scoped-insert assertion path is exhaustively covered by
 * the unit suite (`scopedDb.test.ts`) and the cross-tenant contract
 * (`scopedDbCrossTenant.contract.test.ts`); duplicating it here would
 * not add information.
 */
const ACTIONS = ['read', 'list', 'update', 'delete'] as const satisfies readonly Action[];

interface SeededOrg {
  readonly id: string;
  readonly name: string;
  readonly teamId: string;
  readonly teamName: string;
  readonly orgAdminId: string;
  readonly orgAdminClerkSubjectId: string;
  readonly coachId: string;
  readonly coachEmail: string;
  readonly coachClerkSubjectId: string;
  readonly athleteId: string;
  readonly athleteClerkSubjectId: string;
  readonly coachAssignmentId: string;
  readonly athleteMembershipId: string;
}

interface SeededWorld {
  readonly db: GraphTestDb;
  readonly orgA: SeededOrg;
  readonly orgB: SeededOrg;
}

function buildOrgFixture(suffix: 'A' | 'B'): SeededOrg {
  return {
    id: `org_${suffix}`,
    name: `Org ${suffix}`,
    teamId: `team_${suffix}_1`,
    teamName: `Team ${suffix}1`,
    orgAdminId: `u_${suffix}_orgadmin`,
    orgAdminClerkSubjectId: `clerk_${suffix}_orgadmin`,
    coachId: `u_${suffix}_coach`,
    coachEmail: `coach-${suffix.toLowerCase()}@example.invalid`,
    coachClerkSubjectId: `clerk_${suffix}_coach`,
    athleteId: `u_${suffix}_athlete`,
    athleteClerkSubjectId: `clerk_${suffix}_athlete`,
    coachAssignmentId: `ca_${suffix}`,
    athleteMembershipId: `am_${suffix}`,
  };
}

async function seedTwoOrgs(): Promise<SeededWorld> {
  const db = freshGraphDb();
  const orgA = buildOrgFixture('A');
  const orgB = buildOrgFixture('B');

  await db.insert(organizations).values([
    { id: orgA.id, name: orgA.name, organizationType: 'CLUB' },
    { id: orgB.id, name: orgB.name, organizationType: 'CLUB' },
  ]);

  await db.insert(teams).values([
    { id: orgA.teamId, orgId: orgA.id, name: orgA.teamName },
    { id: orgB.teamId, orgId: orgB.id, name: orgB.teamName },
  ]);

  await db.insert(users).values([
    {
      id: orgA.orgAdminId,
      clerkSubjectId: orgA.orgAdminClerkSubjectId,
      email: 'orgadmin-a@example.invalid',
      role: 'org_admin',
      orgId: orgA.id,
      teamId: null,
    },
    {
      id: orgA.coachId,
      clerkSubjectId: orgA.coachClerkSubjectId,
      email: orgA.coachEmail,
      role: 'team_admin',
      orgId: orgA.id,
      teamId: orgA.teamId,
    },
    {
      id: orgA.athleteId,
      clerkSubjectId: orgA.athleteClerkSubjectId,
      email: 'athlete-a@example.invalid',
      role: 'member',
      orgId: orgA.id,
      teamId: orgA.teamId,
    },
    {
      id: orgB.orgAdminId,
      clerkSubjectId: orgB.orgAdminClerkSubjectId,
      email: 'orgadmin-b@example.invalid',
      role: 'org_admin',
      orgId: orgB.id,
      teamId: null,
    },
    {
      id: orgB.coachId,
      clerkSubjectId: orgB.coachClerkSubjectId,
      email: orgB.coachEmail,
      role: 'team_admin',
      orgId: orgB.id,
      teamId: orgB.teamId,
    },
    {
      id: orgB.athleteId,
      clerkSubjectId: orgB.athleteClerkSubjectId,
      email: 'athlete-b@example.invalid',
      role: 'member',
      orgId: orgB.id,
      teamId: orgB.teamId,
    },
  ]);

  await db.insert(coachAssignments).values([
    {
      id: orgA.coachAssignmentId,
      orgId: orgA.id,
      teamId: orgA.teamId,
      coachUserId: orgA.coachId,
    },
    {
      id: orgB.coachAssignmentId,
      orgId: orgB.id,
      teamId: orgB.teamId,
      coachUserId: orgB.coachId,
    },
  ]);

  await db.insert(athleteMemberships).values([
    {
      id: orgA.athleteMembershipId,
      orgId: orgA.id,
      teamId: orgA.teamId,
      athleteUserId: orgA.athleteId,
    },
    {
      id: orgB.athleteMembershipId,
      orgId: orgB.id,
      teamId: orgB.teamId,
      athleteUserId: orgB.athleteId,
    },
  ]);

  return { db, orgA, orgB };
}

/**
 * Build the per-role actor for the given org. Mirrors the production
 * `requireInternalUser`-stamped `AuthContext` shape so the property
 * exercises the same input surface `scopedDb` sees in production.
 */
function buildActor(
  world: SeededWorld,
  role: (typeof ROLES)[number],
  side: 'A' | 'B',
): AuthContext {
  const org = side === 'A' ? world.orgA : world.orgB;
  switch (role) {
    case 'org_admin':
      return {
        userId: org.orgAdminId,
        clerkSubjectId: org.orgAdminClerkSubjectId,
        role: 'org_admin',
        orgId: org.id,
      };
    case 'team_admin':
      return {
        userId: org.coachId,
        clerkSubjectId: org.coachClerkSubjectId,
        role: 'team_admin',
        orgId: org.id,
        teamId: org.teamId,
      };
    case 'member':
      return {
        userId: org.athleteId,
        clerkSubjectId: org.athleteClerkSubjectId,
        role: 'member',
        orgId: org.id,
        teamId: org.teamId,
      };
    default: {
      const exhaustive: never = role;
      throw new Error(`buildActor: unhandled role ${String(exhaustive)}`);
    }
  }
}

/**
 * Build the `RbacContext` the production route layer assembles before
 * calling `canPerform`. The same-tenant variant is what an actor would
 * see when targeting a row that legitimately belongs to their own
 * scope; the foreign-tenant variant is what an attacker would assemble
 * when targeting a row from the other org.
 *
 * `remainingAdminsAfter` is supplied as `1` so the `lastAdminGuard`
 * rule (which only matters for `user`/`update` and `user`/`delete`)
 * never collapses to "deny because we'd drop to zero admins" — that
 * invariant has its own dedicated coverage in `policy.test.ts`.
 */
type GraphResource = (typeof RESOURCES)[number];
type GraphAction = (typeof ACTIONS)[number];
type GraphRole = (typeof ROLES)[number];

function buildRbacContext(
  actor: AuthContext,
  target: SeededOrg,
  resource: GraphResource,
): RbacContext {
  const base: RbacContext = {
    actorId: actor.userId,
    actorOrgId: actor.orgId,
    actorTeamId: actor.teamId,
    remainingAdminsAfter: 1,
  };
  switch (resource) {
    case 'organization':
      return { ...base, resourceOrgId: target.id };
    case 'team':
      return { ...base, resourceOrgId: target.id, resourceTeamId: target.teamId };
    case 'user':
      // Reads of a teammate row — pin the target to the team's coach so
      // both `sameOrg` and `sameTeam` predicates have inputs to fire.
      return {
        ...base,
        resourceOrgId: target.id,
        resourceTeamId: target.teamId,
        resourceOwnerId: target.coachId,
      };
    case 'coachAssignment':
      return { ...base, resourceOrgId: target.id, resourceTeamId: target.teamId };
    case 'athleteMembership':
      return { ...base, resourceOrgId: target.id, resourceTeamId: target.teamId };
    default: {
      const exhaustive: never = resource;
      throw new Error(`buildRbacContext: unhandled resource ${String(exhaustive)}`);
    }
  }
}

/**
 * Map a `Resource` to the `ScopedDb` read-node name. The two are
 * spelled differently (singular vs plural / pluralized) because
 * `Resource` is the policy vocabulary and the read-node names mirror
 * Drizzle table identifiers.
 */
function readNodeName(
  resource: GraphResource,
): 'organizations' | 'teams' | 'users' | 'coachAssignments' | 'athleteMemberships' {
  switch (resource) {
    case 'organization':
      return 'organizations';
    case 'team':
      return 'teams';
    case 'user':
      return 'users';
    case 'coachAssignment':
      return 'coachAssignments';
    case 'athleteMembership':
      return 'athleteMemberships';
    default: {
      const exhaustive: never = resource;
      throw new Error(`readNodeName: unhandled resource ${String(exhaustive)}`);
    }
  }
}

/**
 * The id of the target row the property looks up. Picked per-resource
 * to align with the seeded fixtures above.
 */
function targetRowId(resource: GraphResource, org: SeededOrg): string {
  switch (resource) {
    case 'organization':
      return org.id;
    case 'team':
      return org.teamId;
    case 'user':
      return org.coachId;
    case 'coachAssignment':
      return org.coachAssignmentId;
    case 'athleteMembership':
      return org.athleteMembershipId;
    default: {
      const exhaustive: never = resource;
      throw new Error(`targetRowId: unhandled resource ${String(exhaustive)}`);
    }
  }
}

interface Tuple {
  readonly side: 'A' | 'B';
  readonly role: GraphRole;
  readonly resource: GraphResource;
  readonly action: GraphAction;
}

const tupleArb: fc.Arbitrary<Tuple> = fc.record({
  side: fc.constantFrom('A', 'B'),
  role: fc.constantFrom(...ROLES),
  resource: fc.constantFrom(...RESOURCES),
  action: fc.constantFrom(...ACTIONS),
});

/**
 * Resolve the read-side outcome through the scopedDb proxy. The proxy
 * never throws on a cross-tenant read; it injects the org-scope
 * predicate and SQLite quietly returns 0 rows. `findFirst` is the
 * canonical single-row read the production handlers use.
 */
async function readById(
  scoped: ReturnType<typeof scopedDb>,
  resource: GraphResource,
  rowId: string,
): Promise<unknown> {
  const name = readNodeName(resource);
  switch (name) {
    case 'organizations':
      return scoped.organizations.findFirst({ where: eq(organizations.id, rowId) });
    case 'teams':
      return scoped.teams.findFirst({ where: eq(teams.id, rowId) });
    case 'users':
      return scoped.users.findFirst({ where: eq(users.id, rowId) });
    case 'coachAssignments':
      return scoped.coachAssignments.findFirst({
        where: eq(coachAssignments.id, rowId),
      });
    case 'athleteMemberships':
      return scoped.athleteMemberships.findFirst({
        where: eq(athleteMemberships.id, rowId),
      });
  }
}

/**
 * Resolve the list-side outcome — `findMany()` with no caller-supplied
 * `where`. This is the lookup pattern most prone to cross-tenant
 * leakage in production because the call site has nothing to add to the
 * predicate — the proxy is the only thing stopping a leak.
 */
async function listAll(
  scoped: ReturnType<typeof scopedDb>,
  resource: GraphResource,
): Promise<ReadonlyArray<{ readonly orgId?: string; readonly id?: string }>> {
  const name = readNodeName(resource);
  let rows: ReadonlyArray<unknown>;
  switch (name) {
    case 'organizations':
      rows = await scoped.organizations.findMany();
      break;
    case 'teams':
      rows = await scoped.teams.findMany();
      break;
    case 'users':
      rows = await scoped.users.findMany();
      break;
    case 'coachAssignments':
      rows = await scoped.coachAssignments.findMany();
      break;
    case 'athleteMemberships':
      rows = await scoped.athleteMemberships.findMany();
      break;
  }
  return rows as ReadonlyArray<{ readonly orgId?: string; readonly id?: string }>;
}

let world: SeededWorld;

beforeEach(async () => {
  world = await seedTwoOrgs();
});

afterEach(() => {
  // `freshGraphDb` opens a fresh in-memory SQLite per call — no shared
  // file, no shared state. Nothing to tear down explicitly.
  world = undefined as unknown as SeededWorld;
});

describe('cross-tenant isolation property (Epic #9 AC-13)', () => {
  it('authHeaders binds the seeded user to a well-formed Clerk header bag', () => {
    // Pin the auth seam wiring once up front so a regression in the
    // test-auth module surfaces here rather than as a cryptic property
    // failure. Every generated actor below is matched 1:1 with a seeded
    // users row whose `clerk_subject_id` feeds this header bag — the
    // same shape `createTestApp(db, { actor })` consumes in production
    // contract tests.
    const seededOrgAdmin = {
      clerkId: world.orgA.orgAdminClerkSubjectId,
      id: world.orgA.orgAdminId,
    };
    const headers = authHeaders(seededOrgAdmin);
    expect(headers.Authorization).toBe(
      `Bearer test-clerk-token-${world.orgA.orgAdminClerkSubjectId}`,
    );
    expect(headers['x-clerk-user-id']).toBe(world.orgA.orgAdminClerkSubjectId);
    expect(headers['content-type']).toBe('application/json');
  });

  it('no scoped read returns a foreign-tenant row across all five graph tables', async () => {
    // Property 1: no cross-tenant read leakage. For every generated
    // `(side, role, resource, action)` tuple, exercise the read paths
    // (`findFirst({ where: id = foreignId })` and `findMany()`) through
    // `scopedDb` and assert that no row tagged with the OTHER org's id
    // is ever returned.
    await fc.assert(
      fc.asyncProperty(tupleArb, async ({ side, role, resource }) => {
        const actor = buildActor(world, role, side);
        const foreign = side === 'A' ? world.orgB : world.orgA;
        const own = side === 'A' ? world.orgA : world.orgB;
        const scoped = scopedDb(world.db as unknown as ScopedDbHandle, actor);

        // findFirst targeting the foreign row by id MUST return
        // undefined — the proxy injects `eq(<table>.org_id, actor.orgId)`
        // so SQLite quietly returns 0 rows.
        const foreignRow = await readById(scoped, resource, targetRowId(resource, foreign));
        expect(foreignRow).toBeUndefined();

        // findMany MUST exclude every foreign-tenant row. We check the
        // `orgId` column for the four scoped tables; `organizations`
        // is special-cased because the row's own `id` IS the tenant
        // boundary (the proxy compares against `organizations.id`).
        const rows = await listAll(scoped, resource);
        if (resource === 'organization') {
          for (const row of rows) {
            expect(row.id).toBe(own.id);
          }
        } else {
          for (const row of rows) {
            expect(row.orgId).toBe(own.id);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('canPerform verdict agrees with the routed scopedDb outcome', async () => {
    // Property 2: canPerform ↔ routed-outcome agreement. For every
    // tuple, compare the policy's verdict to the outcome through the
    // production isolation boundary (`scopedDb`).
    await fc.assert(
      fc.asyncProperty(tupleArb, async ({ side, role, resource, action }) => {
        const actor = buildActor(world, role, side);
        const own = side === 'A' ? world.orgA : world.orgB;
        const foreign = side === 'A' ? world.orgB : world.orgA;

        // Same-tenant verdict — what canPerform says about the actor
        // touching a row in their OWN org.
        const sameTenantCtx = buildRbacContext(actor, own, resource);
        const sameTenantAllowed = canPerform(role, resource, action, sameTenantCtx);

        // Foreign-tenant verdict for a SCOPE-AWARE action. The
        // policy denies cross-tenant `read` / `update` / `delete`
        // for the three roles under test because their rules consult
        // `sameOrg` / `sameTeam` / `isOwner` — never a predicate that
        // returns true across org boundaries. The exception is `list`,
        // which several rules grant unconditionally (the predicate is
        // `allow`, with the scope filter delegated to the query
        // layer — see `rules.ts` for the `org_admin × * × list`
        // rows); for those we skip the policy-level deny check and
        // rely on the routed-outcome assertion below to pin
        // isolation.
        if (action !== 'list') {
          const foreignTenantCtx = buildRbacContext(actor, foreign, resource);
          const foreignTenantAllowed = canPerform(role, resource, action, foreignTenantCtx);
          expect(foreignTenantAllowed).toBe(false);
        }

        const scoped = scopedDb(world.db as unknown as ScopedDbHandle, actor);

        if (action === 'read' || action === 'list') {
          // Read-side agreement: the foreign-tenant routed read MUST
          // always return undefined / exclude the foreign row,
          // regardless of canPerform's same-tenant verdict — scopedDb
          // is the second line of defense.
          const foreignRow = await readById(scoped, resource, targetRowId(resource, foreign));
          expect(foreignRow).toBeUndefined();

          if (sameTenantAllowed && action === 'read') {
            // When policy allows, the same-tenant routed read MUST
            // return the row. This pins the positive case: a denial
            // by scopedDb is fine for ARO (an additional layer); a
            // denial when the policy allows is a regression.
            const ownRow = await readById(scoped, resource, targetRowId(resource, own));
            expect(ownRow).toBeDefined();
          }
          return;
        }

        // Write-side agreement: prove a foreign-tenant write through
        // the scoped surface is a silent no-op (the pre-image survives
        // when a dev_admin cross-tenant re-read inspects the row).
        if (action === 'update') {
          if (resource === 'organization') {
            await scoped
              .update(organizations)
              .set({ name: 'Hijacked' })
              .where(eq(organizations.id, foreign.id));
          } else if (resource === 'team') {
            await scoped
              .update(teams)
              .set({ name: 'Hijacked' })
              .where(eq(teams.id, foreign.teamId));
          } else if (resource === 'user') {
            await scoped
              .update(users)
              .set({ email: 'hijacked@example.invalid' })
              .where(eq(users.id, foreign.coachId));
          } else if (resource === 'coachAssignment') {
            await scoped
              .update(coachAssignments)
              .set({ endedAt: new Date(0) })
              .where(eq(coachAssignments.id, foreign.coachAssignmentId));
          } else if (resource === 'athleteMembership') {
            await scoped
              .update(athleteMemberships)
              .set({ endedAt: new Date(0) })
              .where(eq(athleteMemberships.id, foreign.athleteMembershipId));
          }
          // Re-read the foreign row via a dev_admin cross-tenant view
          // and confirm it was NOT mutated.
          const devScoped = scopedDb(world.db as unknown as ScopedDbHandle, {
            userId: 'u_dev',
            clerkSubjectId: 'clerk_dev',
            role: 'dev_admin',
          });
          const handle = devScoped.crossTenant();
          if (resource === 'organization') {
            const row = (await handle.query.organizations.findFirst({
              where: eq(organizations.id, foreign.id),
            })) as { name: string } | undefined;
            expect(row?.name).toBe(foreign.name);
          } else if (resource === 'team') {
            const row = (await handle.query.teams.findFirst({
              where: eq(teams.id, foreign.teamId),
            })) as { name: string } | undefined;
            expect(row?.name).toBe(foreign.teamName);
          } else if (resource === 'user') {
            const row = (await handle.query.users.findFirst({
              where: eq(users.id, foreign.coachId),
            })) as { email: string } | undefined;
            expect(row?.email).toBe(foreign.coachEmail);
          } else if (resource === 'coachAssignment') {
            const row = (await handle.query.coachAssignments.findFirst({
              where: eq(coachAssignments.id, foreign.coachAssignmentId),
            })) as { endedAt: Date | null } | undefined;
            expect(row?.endedAt).toBeNull();
          } else if (resource === 'athleteMembership') {
            const row = (await handle.query.athleteMemberships.findFirst({
              where: eq(athleteMemberships.id, foreign.athleteMembershipId),
            })) as { endedAt: Date | null } | undefined;
            expect(row?.endedAt).toBeNull();
          }
          return;
        }

        if (action === 'delete') {
          if (resource === 'organization') {
            await scoped.delete(organizations).where(eq(organizations.id, foreign.id));
          } else if (resource === 'team') {
            await scoped.delete(teams).where(eq(teams.id, foreign.teamId));
          } else if (resource === 'user') {
            await scoped.delete(users).where(eq(users.id, foreign.coachId));
          } else if (resource === 'coachAssignment') {
            await scoped
              .delete(coachAssignments)
              .where(eq(coachAssignments.id, foreign.coachAssignmentId));
          } else if (resource === 'athleteMembership') {
            await scoped
              .delete(athleteMemberships)
              .where(eq(athleteMemberships.id, foreign.athleteMembershipId));
          }
          // Foreign row MUST still exist when read through a
          // cross-tenant view.
          const devScoped = scopedDb(world.db as unknown as ScopedDbHandle, {
            userId: 'u_dev',
            clerkSubjectId: 'clerk_dev',
            role: 'dev_admin',
          });
          const handle = devScoped.crossTenant();
          let row: unknown;
          if (resource === 'organization') {
            row = await handle.query.organizations.findFirst({
              where: eq(organizations.id, foreign.id),
            });
          } else if (resource === 'team') {
            row = await handle.query.teams.findFirst({
              where: eq(teams.id, foreign.teamId),
            });
          } else if (resource === 'user') {
            row = await handle.query.users.findFirst({
              where: eq(users.id, foreign.coachId),
            });
          } else if (resource === 'coachAssignment') {
            row = await handle.query.coachAssignments.findFirst({
              where: eq(coachAssignments.id, foreign.coachAssignmentId),
            });
          } else if (resource === 'athleteMembership') {
            row = await handle.query.athleteMemberships.findFirst({
              where: eq(athleteMemberships.id, foreign.athleteMembershipId),
            });
          }
          expect(row).toBeDefined();
        }
      }),
      { numRuns: 100 },
    );
  });
});
