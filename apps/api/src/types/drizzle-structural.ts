// apps/api/src/types/drizzle-structural.ts
//
// Shared structural shapes for the Drizzle query-builder subset this app
// consumes. These interfaces single-source the inline declarations that
// previously lived in `middleware/auth.ts` and `routes/v1/users/role.ts`
// so the two consumers can no longer drift out of step.
//
// Why structural typing? The full Drizzle type surface diverges between
// SQLite drivers (better-sqlite3 vs. libSQL/Turso) and we don't want to
// couple production code or tests to a single driver's union. The DB
// handle is carried as `unknown` (`InternalUserDb = unknown` in auth.ts)
// and we cast structurally through these interfaces at the use site —
// the cast pins the subset of the builder we actually exercise.
//
// Each interface is generic over the row type the terminal `.all()`
// call materialises, so callers can plug their own `typeof
// table.$inferSelect` (or a narrower projection like `{ count: number }`)
// without widening the contract.

/**
 * Structural shape of `db.select(cols?).from(table).where(predicate)…`.
 *
 * The `where(...)` return supports both the limited form
 * (`.limit(n).all()`) used by the auth middleware's JIT lookup AND the
 * unlimited form (`.all()`) used by the role route's admin-count query.
 * Callers pick whichever terminal step their query needs.
 */
export interface DrizzleSelectChain<Row> {
  from: (table: unknown) => {
    where: (predicate: unknown) => {
      limit: (n: number) => { all: () => Array<Row> };
      all: () => Array<Row>;
    };
  };
}

/**
 * Structural shape of `db.insert(table).values(row).onConflictDoNothing({ target }).returning().all()`.
 *
 * Used by the JIT user provisioner in `requireInternalUser` — the
 * `onConflictDoNothing` step lets the second concurrent insert observe
 * the existing row instead of failing on the unique index.
 */
export interface DrizzleInsertChain<Row> {
  values: (row: unknown) => {
    onConflictDoNothing: (opts: { target: unknown }) => {
      returning: () => { all: () => Array<Row> };
    };
  };
}

/**
 * Structural shape of `tx.update(table).set(values).where(predicate).returning().all()`.
 *
 * Used by the role-update route inside a transaction; the `.returning()`
 * step is what tells the route whether the target row was matched.
 */
export interface DrizzleUpdateChain<Row> {
  set: (values: Record<string, unknown>) => {
    where: (predicate: unknown) => {
      returning: () => { all: () => Array<Row> };
    };
  };
}
