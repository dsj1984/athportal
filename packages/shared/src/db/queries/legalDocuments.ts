/**
 * @repo/shared/db/queries/legalDocuments — sanctioned helpers for the
 * Terms-of-Service / Privacy-Policy active-row lookup and the onboarding
 * acceptance writer.
 *
 * Introduced by Epic #8 / Story #555 / Task #567. Tech Spec #490.
 *
 * Two responsibilities:
 *
 *   1. `getActiveLegalDocuments(db)` — return the currently-active ToS
 *      and Privacy Policy rows, defined as the row per `kind` with the
 *      most-recent `effective_at <= now()`. The composite index
 *      `(kind, effective_at desc)` on `legal_documents` is what makes
 *      this a cheap lookup. Throws when either kind is missing — an
 *      un-seeded environment is a configuration error, not a runtime
 *      condition the onboarding flow should silently paper over.
 *
 *   2. `recordOnboardingAcceptances(tx, …)` — insert exactly one row in
 *      `user_legal_agreements` for each of the two accepted documents,
 *      keyed by the document ids the caller resolved via (1). MUST run
 *      inside the caller-supplied transaction so the writes compose
 *      atomically with the other onboarding mutations (parent-athlete
 *      link, `users.onboarded_at` stamp).
 *
 *      The `(user_id, legal_document_id)` unique index is the defence
 *      in depth against duplicate acceptance rows produced by a replayed
 *      onboarding submission. This function does **not** swallow the
 *      unique-constraint error — callers are expected to either short-
 *      circuit before reaching the writer (the handler's idempotency
 *      re-read of `users.onboarded_at`) or to let the transaction roll
 *      back. Surfacing the throw is the correct behaviour.
 */

import { and, desc, eq, lte } from 'drizzle-orm';
import { legalDocuments } from '../schema/legalDocuments';
import { userLegalAgreements } from '../schema/userLegalAgreements';

export const LEGAL_DOCUMENT_KIND = {
  termsOfService: 'terms_of_service',
  privacyPolicy: 'privacy_policy',
} as const;

export type LegalDocumentKind = (typeof LEGAL_DOCUMENT_KIND)[keyof typeof LEGAL_DOCUMENT_KIND];

export interface ActiveLegalDocumentRow {
  readonly id: string;
  readonly kind: LegalDocumentKind;
  readonly version: string;
  readonly effectiveAt: Date;
  readonly bodyUrl: string;
}

export interface ActiveLegalDocuments {
  readonly termsOfService: ActiveLegalDocumentRow;
  readonly privacyPolicy: ActiveLegalDocumentRow;
}

interface ActiveDocRow {
  readonly id: string;
  readonly kind: string;
  readonly version: string;
  readonly effectiveAt: Date;
  readonly bodyUrl: string;
}

interface ActiveDocSelectChain {
  select: (projection: {
    id: typeof legalDocuments.id;
    kind: typeof legalDocuments.kind;
    version: typeof legalDocuments.version;
    effectiveAt: typeof legalDocuments.effectiveAt;
    bodyUrl: typeof legalDocuments.bodyUrl;
  }) => {
    from: (table: typeof legalDocuments) => {
      where: (predicate: unknown) => {
        orderBy: (clause: unknown) => {
          limit: (n: number) => { all: () => Array<ActiveDocRow> };
        };
      };
    };
  };
}

interface InsertChain {
  insert: (table: typeof userLegalAgreements) => {
    values: (rows: Array<typeof userLegalAgreements.$inferInsert>) => {
      run: () => unknown;
    };
  };
}

function findActiveByKind(
  handle: ActiveDocSelectChain,
  kind: LegalDocumentKind,
  asOf: Date,
): ActiveDocRow | null {
  const rows = handle
    .select({
      id: legalDocuments.id,
      kind: legalDocuments.kind,
      version: legalDocuments.version,
      effectiveAt: legalDocuments.effectiveAt,
      bodyUrl: legalDocuments.bodyUrl,
    })
    .from(legalDocuments)
    .where(and(eq(legalDocuments.kind, kind), lte(legalDocuments.effectiveAt, asOf)))
    .orderBy(desc(legalDocuments.effectiveAt))
    .limit(1)
    .all();
  return rows[0] ?? null;
}

/**
 * Resolve the currently-active Terms-of-Service and Privacy-Policy
 * documents (the row per `kind` with the most-recent
 * `effective_at <= now()`).
 *
 * Throws when either active row is missing — a workspace that boots
 * without seeded legal documents cannot run the onboarding flow at all,
 * and surfacing the throw early (rather than returning a partial result)
 * is the safer failure mode.
 */
export function getActiveLegalDocuments(db: unknown, now: Date = new Date()): ActiveLegalDocuments {
  const handle = db as ActiveDocSelectChain;
  const tos = findActiveByKind(handle, LEGAL_DOCUMENT_KIND.termsOfService, now);
  const privacy = findActiveByKind(handle, LEGAL_DOCUMENT_KIND.privacyPolicy, now);
  if (!tos) {
    throw new Error(
      `[legalDocuments] no active 'terms_of_service' row at ${now.toISOString()} — seed required`,
    );
  }
  if (!privacy) {
    throw new Error(
      `[legalDocuments] no active 'privacy_policy' row at ${now.toISOString()} — seed required`,
    );
  }
  return {
    termsOfService: {
      id: tos.id,
      kind: LEGAL_DOCUMENT_KIND.termsOfService,
      version: tos.version,
      effectiveAt: tos.effectiveAt,
      bodyUrl: tos.bodyUrl,
    },
    privacyPolicy: {
      id: privacy.id,
      kind: LEGAL_DOCUMENT_KIND.privacyPolicy,
      version: privacy.version,
      effectiveAt: privacy.effectiveAt,
      bodyUrl: privacy.bodyUrl,
    },
  };
}

export interface RecordAcceptancesInput {
  readonly userId: string;
  readonly tosId: string;
  readonly privacyId: string;
  readonly acceptedAt: Date;
}

/**
 * Persist the two onboarding acceptance rows inside the caller-supplied
 * transaction.
 *
 * Stable id derivation: `${userId}:${legalDocumentId}` (URL-safe). The
 * unique index on `(user_id, legal_document_id)` is the defence in depth
 * against duplicate rows from replays; a deterministic id additionally
 * gives the caller a predictable handle for diagnostics.
 *
 * The function does NOT catch the unique-constraint error — replays MUST
 * be short-circuited upstream by the handler's idempotency re-read.
 */
export function recordOnboardingAcceptances(
  tx: unknown,
  { userId, tosId, privacyId, acceptedAt }: RecordAcceptancesInput,
): void {
  const handle = tx as InsertChain;
  handle
    .insert(userLegalAgreements)
    .values([
      {
        id: `${userId}:${tosId}`,
        userId,
        legalDocumentId: tosId,
        acceptedAt,
      },
      {
        id: `${userId}:${privacyId}`,
        userId,
        legalDocumentId: privacyId,
        acceptedAt,
      },
    ])
    .run();
}
