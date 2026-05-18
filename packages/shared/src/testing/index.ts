/**
 * @repo/shared/testing — barrel for the shared test harness.
 *
 * Helpers landed in Story #172:
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
  type AuthContext,
  type CreateTestAppOptions,
  type TestApp,
  type TestAppBindings,
  type TestDbLike,
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
export {
  seedResource,
  seedUser,
  type SeedResourceInput,
  type SeedUserOverrides,
} from './seeds';
export {
  authHeaders,
  mintTestingToken,
  PERSONA_FIXTURES,
  resolvePersona,
  sessionCookieFor,
  signInAs,
  type AuthUserLike,
  type Persona,
  type PersonaFixture,
  type PersonaRole,
  type StorageState,
  type StorageStateCookie,
} from './auth';
