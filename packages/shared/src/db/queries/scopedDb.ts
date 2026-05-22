/**
 * @repo/shared/db/queries/scopedDb — query-layer tenant isolation helper.
 *
 * Story #607 (Epic #9, Tech Spec #596). The load-bearing security defense
 * that keeps cross-tenant rows out of every read and write against the
 * five graph tables: `organizations`, `teams`, `users`, `coachAssignments`,
 * and `athleteMemberships`.
 *
 * Contract:
 *
 *   const scoped = scopedDb(db, actor);
 *   await scoped.teams.findFirst({ where: eq(teams.id, someTeamId) });
 *
 * The helper wraps the Drizzle handle in a thin proxy that injects
 *
 *   eq(<table>.org_id, actor.orgId)   // (or eq(organizations.id, ...) for `organizations`)
 *
 * into every Drizzle Relational-Query (`findFirst` / `findMany`) call, and
 * onto every `update(table).where(...)` and `delete(table).where(...)`.
 * Inserts assert that the `orgId` of the inbound row equals the actor's
 * `orgId` — a handler that forgets to set `orgId` (or sets it wrong) is
 * rejected before the row reaches the database.
 *
 * Escape hatch: `scoped.crossTenant()` returns the un-scoped Drizzle
 * handle, but ONLY when `actor.role === 'dev_admin'`. Any other role
 * throws synchronously. Call sites are grep-able for review.
 *
 * Cross-tenant leakage is a launch blocker for Epic #9 — this helper has
 * no silent-fallthrough branches. Every error path throws an explicit
 * `Error` with the actor role and the operation in the message so the
 * audit trail (Tech Spec #596 §Security & Privacy Considerations) can
 * route the event.
 *
 * The helper is pure: no I/O of its own, no closures over time. Stateless
 * proxies are constructed per call.
 */

import { type SQL, and, eq } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { AuthContext } from '../../rbac/types';
import { athleteMemberships } from '../schema/athleteMemberships';
import { coachAssignments } from '../schema/coachAssignments';
import { organizations } from '../schema/organizations';
import { teams } from '../schema/teams';
import { users } from '../schema/users';

/**
 * Tables the helper enforces tenancy on. Every member of this set MUST
 * be scopable by an org-id column (either `org_id`, or for the
 * `organizations` table itself the row's own `id`).
 *
 * Adding a new table here requires a row in {@link ORG_SCOPE_COLUMN}.
 */
export type ScopedTableName =
  | 'organizations'
  | 'teams'
  | 'users'
  | 'coachAssignments'
  | 'athleteMemberships';

/**
 * Map a scoped-table identifier to the column carrying the org-id
 * scope. For every join / leaf table the scope is the row's `org_id`;
 * for `organizations` the row's own `id` IS the tenant boundary.
 */
const ORG_SCOPE_COLUMN = {
  organizations: organizations.id,
  teams: teams.orgId,
  users: users.orgId,
  coachAssignments: coachAssignments.orgId,
  athleteMemberships: athleteMemberships.orgId,
} as const;

/**
 * Map the public proxy name to the Drizzle table object. Used by the
 * write surface (`insert` / `update` / `delete`) to bind a caller-passed
 * table to its scope column.
 */
const TABLE_BY_NAME = {
  organizations,
  teams,
  users,
  coachAssignments,
  athleteMemberships,
} as const;

/**
 * Structural shape of a Drizzle Relational-Query node — the `findFirst`
 * / `findMany` surface exposed by `db.query.<table>`. We accept `unknown`
 * for the optional `with` / `orderBy` / `limit` fields because the proxy
 * is transparent: it forwards them verbatim, only the `where` clause is
 * rewritten.
 *
 * Parameterizing on `TRow` (the row return type) keeps the proxy
 * type-safe for callers without forcing this helper to depend on the
 * `drizzle-orm/relations` typings, which the consuming workspaces do not
 * import directly.
 */
interface FindFirstConfig {
  readonly where?: SQL | undefined;
  readonly with?: unknown;
  readonly orderBy?: unknown;
  readonly columns?: unknown;
}

interface FindManyConfig extends FindFirstConfig {
  readonly limit?: number;
  readonly offset?: number;
}

interface QueryNode<TRow> {
  readonly findFirst: (config?: FindFirstConfig) => Promise<TRow | undefined>;
  readonly findMany: (config?: FindManyConfig) => Promise<TRow[]>;
}

/**
 * Structural shape of the Drizzle write builders we wrap. Like the read
 * surface above, we type the chain transparently — every method returns
 * a Drizzle builder we forward without inspection except for `where`,
 * which we always combine with the scope predicate.
 */
interface UpdateBuilder {
  readonly set: (values: Record<string, unknown>) => UpdateBuilder;
  readonly where: (predicate: SQL) => unknown;
}

interface DeleteBuilder {
  readonly where: (predicate: SQL) => unknown;
}

interface InsertBuilder {
  readonly values: (values: Record<string, unknown> | Record<string, unknown>[]) => unknown;
}

/**
 * Structural shape of the Drizzle handle this helper consumes. The
 * production Worker handle and the better-sqlite3 contract-test handle
 * both satisfy this shape; we type it structurally so the helper does
 * not couple to a single driver union.
 */
export interface ScopedDbHandle {
  readonly query: Readonly<Record<ScopedTableName, QueryNode<unknown>>>;
  readonly insert: (table: SQLiteTable) => InsertBuilder;
  readonly update: (table: SQLiteTable) => UpdateBuilder;
  readonly delete: (table: SQLiteTable) => DeleteBuilder;
}

/**
 * Per-table read surface returned by the proxy. The signature mirrors
 * Drizzle's Relational-Query API one-for-one; the only behavioral
 * difference is the injected scope predicate.
 */
export interface ScopedQueryNode<TRow> {
  findFirst(config?: FindFirstConfig): Promise<TRow | undefined>;
  findMany(config?: FindManyConfig): Promise<TRow[]>;
}

/**
 * Public surface returned by {@link scopedDb}. Every read / write goes
 * through this object; the underlying handle is reachable ONLY via
 * `crossTenant()` and ONLY for `dev_admin` actors.
 */
export interface ScopedDb {
  readonly organizations: ScopedQueryNode<unknown>;
  readonly teams: ScopedQueryNode<unknown>;
  readonly users: ScopedQueryNode<unknown>;
  readonly coachAssignments: ScopedQueryNode<unknown>;
  readonly athleteMemberships: ScopedQueryNode<unknown>;
  /**
   * Auto-scoped insert. Asserts that the inbound row(s) carry the
   * actor's `orgId` (or, for the `organizations` table, that the row's
   * `id` equals the actor's `orgId`). Throws synchronously if the
   * assertion fails — the row never reaches the database.
   *
   * Pass the production Drizzle table object (e.g. `teams`), not the
   * `ScopedTableName` string — the proxy will match it by reference.
   */
  insert(table: SQLiteTable): InsertBuilder;
  /**
   * Auto-scoped update. Combines the caller's `where` predicate with
   * `eq(<table>.org_id, actor.orgId)` (or `eq(organizations.id, ...)`
   * for `organizations`), so the update can never touch a row outside
   * the actor's tenant.
   */
  update(table: SQLiteTable): UpdateBuilder;
  /**
   * Auto-scoped delete. Same scoping rule as {@link update}.
   */
  delete(table: SQLiteTable): DeleteBuilder;
  /**
   * Escape hatch for platform-admin paths that legitimately need a
   * cross-tenant view (e.g. tenant-wide migrations, abuse triage).
   *
   * Returns the un-scoped Drizzle handle. Throws synchronously if
   * `actor.role !== 'dev_admin'`. Every call site is grep-able for
   * review.
   */
  crossTenant(): ScopedDbHandle;
}

/**
 * Build the org-scope predicate for a named table. Combines with the
 * caller's `where` via `and(...)` when present; otherwise returns the
 * scope predicate alone.
 */
function scopePredicate(tableName: ScopedTableName, orgId: string, userWhere?: SQL): SQL {
  const scope = eq(ORG_SCOPE_COLUMN[tableName], orgId);
  if (!userWhere) return scope;
  const combined = and(scope, userWhere);
  // `and(...)` with at least two non-undefined predicates always returns
  // a defined SQL node; the union return type from drizzle is widened to
  // `SQL | undefined` for the zero-arg case, which we don't hit here.
  if (!combined) {
    throw new Error('scopedDb: failed to combine scope predicate with caller where');
  }
  return combined;
}

/**
 * Resolve a Drizzle table object (passed by reference to `insert` /
 * `update` / `delete`) to its scoped name. Returns `null` when the
 * table is not one of the five graph tables — callers receive an
 * explicit error rather than a silent passthrough.
 */
function resolveScopedTableName(table: SQLiteTable): ScopedTableName | null {
  for (const [name, schemaTable] of Object.entries(TABLE_BY_NAME)) {
    if (schemaTable === table) return name as ScopedTableName;
  }
  return null;
}

/**
 * Build a per-table scoped read node. Stateless — constructed fresh on
 * every `scopedDb()` call so the closure captures only the actor and
 * the underlying handle.
 */
function buildQueryNode(
  handle: ScopedDbHandle,
  tableName: ScopedTableName,
  orgId: string,
): ScopedQueryNode<unknown> {
  const underlying = handle.query[tableName];
  return {
    async findFirst(config) {
      const where = scopePredicate(tableName, orgId, config?.where);
      return underlying.findFirst({ ...(config ?? {}), where });
    },
    async findMany(config) {
      const where = scopePredicate(tableName, orgId, config?.where);
      return underlying.findMany({ ...(config ?? {}), where });
    },
  };
}

/**
 * Construct an org-scoped view over `db`. Every read and write against
 * one of the five graph tables is forced to carry
 * `eq(<table>.org_id, actor.orgId)` (or the equivalent for the
 * `organizations` table).
 *
 * Throws synchronously when a non-`dev_admin` actor has no `orgId` —
 * the helper refuses to construct an "unscoped" view by accident.
 * `dev_admin` is the only role permitted to operate without an
 * `orgId`, and even then it must call {@link ScopedDb.crossTenant}
 * explicitly to escape the scope.
 */
export function scopedDb(db: ScopedDbHandle, actor: AuthContext): ScopedDb {
  const handle = db;
  const { role, orgId } = actor;

  if (!orgId && role !== 'dev_admin') {
    throw new Error(
      `scopedDb: non-dev_admin actor must have orgId (role=${role}). Cross-tenant access requires role=dev_admin and an explicit crossTenant() call.`,
    );
  }

  // `dev_admin` with no `orgId` is allowed only as a precursor to
  // `crossTenant()`. Reads / writes through the scoped surface still
  // need a tenant boundary — we cannot inject `where org_id = undefined`
  // and call that "scoped". Reject early with a clear message.
  const enforcedOrgId = orgId;

  function requireScopedOrgId(op: string): string {
    if (!enforcedOrgId) {
      throw new Error(
        `scopedDb.${op}: dev_admin actor has no orgId. Call crossTenant() explicitly for cross-tenant ${op}.`,
      );
    }
    return enforcedOrgId;
  }

  function buildInsert(table: SQLiteTable): InsertBuilder {
    const tableName = resolveScopedTableName(table);
    if (!tableName) {
      throw new Error(
        'scopedDb.insert: table is not one of the scoped graph tables (organizations, teams, users, coachAssignments, athleteMemberships).',
      );
    }
    const scopedOrgId = requireScopedOrgId('insert');
    return {
      values(values) {
        const rows = Array.isArray(values) ? values : [values];
        for (const row of rows) {
          if (tableName === 'organizations') {
            // The `organizations` row's own `id` IS the tenant boundary;
            // an `org_admin` creating their second org is forbidden by
            // Tech Spec #596 (cardinality: Org : Admin = 1:1 at MVP).
            // `dev_admin` is the only role that reaches this branch
            // through the scoped surface, and even then the id must
            // match the actor's `orgId` — they should be using
            // `crossTenant()` for true multi-org creation.
            if (row.id !== scopedOrgId) {
              throw new Error(
                'scopedDb.insert(organizations): row.id must equal actor.orgId. Use crossTenant() for cross-org creation.',
              );
            }
          } else {
            if (row.orgId !== scopedOrgId) {
              throw new Error(
                `scopedDb.insert(${tableName}): row.orgId must equal actor.orgId (got ${String(row.orgId)}, expected ${scopedOrgId}).`,
              );
            }
          }
        }
        return handle.insert(table).values(values);
      },
    };
  }

  function buildUpdate(table: SQLiteTable): UpdateBuilder {
    const resolved = resolveScopedTableName(table);
    if (!resolved) {
      throw new Error(
        'scopedDb.update: table is not one of the scoped graph tables (organizations, teams, users, coachAssignments, athleteMemberships).',
      );
    }
    const tableName: ScopedTableName = resolved;
    const scopedOrgId = requireScopedOrgId('update');
    function wrap(setValues?: Record<string, unknown>): UpdateBuilder {
      return {
        set(values) {
          return wrap({ ...(setValues ?? {}), ...values });
        },
        where(predicate) {
          const scoped = scopePredicate(tableName, scopedOrgId, predicate);
          const builder = handle.update(table);
          const next = setValues ? builder.set(setValues) : builder;
          return next.where(scoped);
        },
      };
    }
    return wrap(undefined);
  }

  function buildDelete(table: SQLiteTable): DeleteBuilder {
    const tableName = resolveScopedTableName(table);
    if (!tableName) {
      throw new Error(
        'scopedDb.delete: table is not one of the scoped graph tables (organizations, teams, users, coachAssignments, athleteMemberships).',
      );
    }
    const scopedOrgId = requireScopedOrgId('delete');
    return {
      where(predicate) {
        const scoped = scopePredicate(tableName, scopedOrgId, predicate);
        return handle.delete(table).where(scoped);
      },
    };
  }

  // Lazy node construction — only build a scoped read node when the
  // caller touches the table. Keeps the per-request cost proportional
  // to the actual surface used by the handler.
  function readNode(tableName: ScopedTableName): ScopedQueryNode<unknown> {
    const scopedOrgId = requireScopedOrgId(`query.${tableName}`);
    return buildQueryNode(handle, tableName, scopedOrgId);
  }

  return {
    get organizations() {
      return readNode('organizations');
    },
    get teams() {
      return readNode('teams');
    },
    get users() {
      return readNode('users');
    },
    get coachAssignments() {
      return readNode('coachAssignments');
    },
    get athleteMemberships() {
      return readNode('athleteMemberships');
    },
    insert: buildInsert,
    update: buildUpdate,
    delete: buildDelete,
    crossTenant() {
      if (role !== 'dev_admin') {
        throw new Error(
          `scopedDb.crossTenant: forbidden for role=${role}. Only dev_admin may bypass tenant scoping.`,
        );
      }
      return handle;
    },
  };
}
