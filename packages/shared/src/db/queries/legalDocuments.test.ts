/**
 * Unit tests for the active-legal-document lookup and the onboarding
 * acceptance writer.
 *
 * Each test builds a fresh in-memory SQLite handle via
 * `freshOnboardingDb()`, inserts the rows it needs through the Drizzle
 * table objects, and exercises the contract.
 */

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { legalDocuments } from '../schema/legalDocuments';
import { userLegalAgreements } from '../schema/userLegalAgreements';
import { users } from '../schema/users';
import { freshOnboardingDb } from './__tests__/onboardingDb';
import {
  LEGAL_DOCUMENT_KIND,
  getActiveLegalDocuments,
  recordOnboardingAcceptances,
} from './legalDocuments';

function seedUser(db: ReturnType<typeof freshOnboardingDb>, id: string): void {
  db.insert(users)
    .values({
      id,
      clerkSubjectId: `clerk_${id}`,
      email: `${id}@example.invalid`,
      role: 'member',
    })
    .run();
}

describe('getActiveLegalDocuments', () => {
  it('returns the most-recent effectiveAt row per kind', () => {
    const db = freshOnboardingDb();
    const now = new Date('2026-05-01T00:00:00.000Z');
    db.insert(legalDocuments)
      .values([
        {
          id: 'tos_v1',
          kind: LEGAL_DOCUMENT_KIND.termsOfService,
          version: '2026-01-01',
          effectiveAt: new Date('2026-01-01T00:00:00.000Z'),
          bodyUrl: 'https://example.invalid/tos/v1',
        },
        {
          id: 'tos_v2',
          kind: LEGAL_DOCUMENT_KIND.termsOfService,
          version: '2026-04-15',
          effectiveAt: new Date('2026-04-15T00:00:00.000Z'),
          bodyUrl: 'https://example.invalid/tos/v2',
        },
        {
          id: 'pp_v1',
          kind: LEGAL_DOCUMENT_KIND.privacyPolicy,
          version: '2026-01-01',
          effectiveAt: new Date('2026-01-01T00:00:00.000Z'),
          bodyUrl: 'https://example.invalid/pp/v1',
        },
      ])
      .run();

    const active = getActiveLegalDocuments(db, now);

    expect(active.termsOfService.id).toBe('tos_v2');
    expect(active.termsOfService.version).toBe('2026-04-15');
    expect(active.privacyPolicy.id).toBe('pp_v1');
    expect(active.privacyPolicy.version).toBe('2026-01-01');
  });

  it('ignores rows whose effectiveAt is in the future', () => {
    const db = freshOnboardingDb();
    const now = new Date('2026-05-01T00:00:00.000Z');
    db.insert(legalDocuments)
      .values([
        {
          id: 'tos_active',
          kind: LEGAL_DOCUMENT_KIND.termsOfService,
          version: 'active',
          effectiveAt: new Date('2026-04-15T00:00:00.000Z'),
          bodyUrl: 'https://example.invalid/tos/active',
        },
        {
          id: 'tos_future',
          kind: LEGAL_DOCUMENT_KIND.termsOfService,
          version: 'future',
          effectiveAt: new Date('2026-06-01T00:00:00.000Z'),
          bodyUrl: 'https://example.invalid/tos/future',
        },
        {
          id: 'pp_active',
          kind: LEGAL_DOCUMENT_KIND.privacyPolicy,
          version: 'active',
          effectiveAt: new Date('2026-04-15T00:00:00.000Z'),
          bodyUrl: 'https://example.invalid/pp/active',
        },
      ])
      .run();

    const active = getActiveLegalDocuments(db, now);

    expect(active.termsOfService.id).toBe('tos_active');
  });

  it('throws when either active row is missing', () => {
    const db = freshOnboardingDb();
    const now = new Date('2026-05-01T00:00:00.000Z');
    db.insert(legalDocuments)
      .values({
        id: 'tos_only',
        kind: LEGAL_DOCUMENT_KIND.termsOfService,
        version: '2026-04-15',
        effectiveAt: new Date('2026-04-15T00:00:00.000Z'),
        bodyUrl: 'https://example.invalid/tos/v2',
      })
      .run();

    expect(() => getActiveLegalDocuments(db, now)).toThrow(/privacy_policy/);
  });
});

describe('recordOnboardingAcceptances', () => {
  it('writes exactly two userLegalAgreements rows inside the supplied transaction', () => {
    const db = freshOnboardingDb();
    seedUser(db, 'u_1');
    db.insert(legalDocuments)
      .values([
        {
          id: 'tos_v1',
          kind: LEGAL_DOCUMENT_KIND.termsOfService,
          version: '2026-04-15',
          effectiveAt: new Date('2026-04-15T00:00:00.000Z'),
          bodyUrl: 'https://example.invalid/tos/v1',
        },
        {
          id: 'pp_v1',
          kind: LEGAL_DOCUMENT_KIND.privacyPolicy,
          version: '2026-04-15',
          effectiveAt: new Date('2026-04-15T00:00:00.000Z'),
          bodyUrl: 'https://example.invalid/pp/v1',
        },
      ])
      .run();
    const acceptedAt = new Date('2026-05-01T12:00:00.000Z');

    db.transaction((tx) => {
      recordOnboardingAcceptances(tx, {
        userId: 'u_1',
        tosId: 'tos_v1',
        privacyId: 'pp_v1',
        acceptedAt,
      });
    });

    const rows = db
      .select()
      .from(userLegalAgreements)
      .where(eq(userLegalAgreements.userId, 'u_1'))
      .all();
    expect(rows).toHaveLength(2);
    const docIds = rows.map((r) => r.legalDocumentId).sort();
    expect(docIds).toEqual(['pp_v1', 'tos_v1']);
    expect(rows.every((r) => r.acceptedAt?.getTime() === acceptedAt.getTime())).toBe(true);
  });

  it('throws on the second insert when the unique (user_id, legal_document_id) constraint is violated', () => {
    const db = freshOnboardingDb();
    seedUser(db, 'u_1');
    db.insert(legalDocuments)
      .values([
        {
          id: 'tos_v1',
          kind: LEGAL_DOCUMENT_KIND.termsOfService,
          version: '2026-04-15',
          effectiveAt: new Date('2026-04-15T00:00:00.000Z'),
          bodyUrl: 'https://example.invalid/tos/v1',
        },
        {
          id: 'pp_v1',
          kind: LEGAL_DOCUMENT_KIND.privacyPolicy,
          version: '2026-04-15',
          effectiveAt: new Date('2026-04-15T00:00:00.000Z'),
          bodyUrl: 'https://example.invalid/pp/v1',
        },
      ])
      .run();
    const acceptedAt = new Date('2026-05-01T12:00:00.000Z');
    db.transaction((tx) => {
      recordOnboardingAcceptances(tx, {
        userId: 'u_1',
        tosId: 'tos_v1',
        privacyId: 'pp_v1',
        acceptedAt,
      });
    });

    expect(() =>
      db.transaction((tx) => {
        recordOnboardingAcceptances(tx, {
          userId: 'u_1',
          tosId: 'tos_v1',
          privacyId: 'pp_v1',
          acceptedAt,
        });
      }),
    ).toThrow(/UNIQUE/i);
  });
});
