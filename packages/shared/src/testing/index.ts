/**
 * @repo/shared/testing — barrel for the shared test harness.
 *
 * Helpers landing in Story #172:
 *   - safety.ts (assertSyntheticPii, syntheticEmailSchema) — Task #180
 *   - db.ts (freshDb, closeAllTestDbs) — Task #175
 *   - app.ts (createTestApp) — Task #175
 *   - seeds.ts (seedUser, seedResource) — Task #181
 *   - auth.ts (authHeaders) — Task #181
 */

export {
  SyntheticPiiError,
  assertSyntheticPii,
  syntheticEmailSchema,
} from './safety';
export {
  closeAllTestDbs,
  freshDb,
  type FreshDbSchema,
  type TestDb,
} from './db';
export {
  createTestApp,
  type TestApp,
  type TestAppBindings,
} from './app';
export {
  resources,
  schema,
  users,
  type NewResource,
  type NewUser,
  type Resource,
  type User,
} from './schema';
