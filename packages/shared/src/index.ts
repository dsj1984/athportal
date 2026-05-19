/**
 * Public surface of `@repo/shared` — intentionally a **narrow barrel**.
 *
 * This entry point re-exports the observability primitives landed in
 * Epic #5 (Story #256) so consumers can write
 * `import { LogEventSchema } from '@repo/shared'` without reaching into
 * subpaths.
 *
 * Everything else MUST be imported via the package's documented subpath
 * contract:
 *
 * - RBAC policy / types → `@repo/shared/rbac`
 * - Drizzle schema and DB types → `@repo/shared/db/schema`
 * - Test helpers (contract harness, auth seam, seeders) → `@repo/shared/testing`
 *
 * Do **not** widen this barrel to re-export RBAC, db/schema, or testing
 * surfaces from here. Widening it risks pulling Worker-only types
 * (Drizzle/libsql) and test-only code (`@clerk/testing`, in-memory
 * SQLite drivers) into web/UI/tooling consumers that resolve the bare
 * `@repo/shared` specifier — bloating their bundles and dragging
 * server/test-only dependencies into client builds. Keep concerns on
 * their subpaths; each subpath has its own `package.json` `exports`
 * entry that lets bundlers tree-shake and platform-gate correctly.
 */
export { LogEventSchema, type LogEvent } from './observability/log-event';
export {
  RedactionAllowlist,
  redactHeaders,
  redactQueryAndBody,
} from './observability/redaction';
