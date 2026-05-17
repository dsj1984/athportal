/**
 * @repo/shared/testing — barrel for the shared test harness.
 *
 * Helpers landing in subsequent Tasks of Story #172:
 *   - safety.ts (assertSyntheticPii, syntheticEmailSchema) — landed in #180
 *   - db.ts (freshDb) — Task #175
 *   - app.ts (createTestApp) — Task #175
 *   - seeds.ts (seedUser, seedResource) — Task #181
 *   - auth.ts (authHeaders) — Task #181
 */

export {
  SyntheticPiiError,
  assertSyntheticPii,
  syntheticEmailSchema,
} from './safety';
