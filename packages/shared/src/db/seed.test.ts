/**
 * Unit tests for the legal-documents seed.
 *
 * The seed is load-bearing for any environment that runs the onboarding
 * handler — without an active ToS and Privacy Policy row, the active-
 * document lookup throws. The tests pin the two contractual guarantees
 * named in Task #565: exactly one active row per kind, and idempotence
 * on re-run.
 */

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { freshOnboardingDb } from './queries/__tests__/onboardingDb';
import { legalDocuments } from './schema/legalDocuments';
import { SEED_PRIVACY_ID, SEED_TOS_ID, seedLegalDocuments } from './seed';

describe('seedLegalDocuments', () => {
  it('writes exactly one terms_of_service row and one privacy_policy row', () => {
    const db = freshOnboardingDb();

    seedLegalDocuments(db);

    const tos = db
      .select()
      .from(legalDocuments)
      .where(eq(legalDocuments.kind, 'terms_of_service'))
      .all();
    const privacy = db
      .select()
      .from(legalDocuments)
      .where(eq(legalDocuments.kind, 'privacy_policy'))
      .all();
    expect(tos).toHaveLength(1);
    expect(privacy).toHaveLength(1);
    expect(tos[0]?.id).toBe(SEED_TOS_ID);
    expect(privacy[0]?.id).toBe(SEED_PRIVACY_ID);
  });

  it('is idempotent — re-running does not duplicate rows', () => {
    const db = freshOnboardingDb();

    seedLegalDocuments(db);
    seedLegalDocuments(db);
    seedLegalDocuments(db);

    const all = db.select().from(legalDocuments).all();
    expect(all).toHaveLength(2);
  });
});
