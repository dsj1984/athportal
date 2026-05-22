/**
 * @repo/shared/rollover/buildPlan — pure season-rollover plan builder.
 *
 * Epic #10 / Story #665 / Task #697.
 *
 * Given the current set of athlete memberships in the **source season**
 * and a per-athlete choice (`promote`, `archive`, or `transfer`), produce
 * the set of writes the rollover commit step will apply against the
 * `athlete_memberships` and `teams` tables.
 *
 * The function is **pure** — it performs no DB or network I/O, takes only
 * its arguments, and returns a deterministic `RolloverPlan`. The commit
 * endpoint re-runs this exact function server-side against fresh DB state
 * after the operator clicks "commit" and rejects the request with
 * `STALE_PLAN` if the recomputed plan differs from the submitted plan
 * (a row moved between preview and commit). That stale-plan invariant
 * is the load-bearing safety property of the entire rollover surface; do
 * not introduce any side effects here without re-deriving the canonical
 * `RolloverPlan` shape so the equality check stays sound.
 *
 * Decision semantics:
 *
 *   - `promote`  — end-date the membership row in the source season and
 *                  create a new row on the **target** team for the same
 *                  athlete. The target team is the one the choice names
 *                  (the admin UI lets the operator pick the next age
 *                  group / cohort). If the source membership is already
 *                  end-dated, the row is reported as a no-op (it was
 *                  already off the source roster).
 *   - `archive`  — end-date the membership row in the source season and
 *                  do not create a successor. The athlete is removed
 *                  from the active roster but the audit row stays.
 *   - `transfer` — same shape as `promote` (end-date source + create on
 *                  target). The distinction is editorial — the operator
 *                  is moving a returning athlete laterally rather than
 *                  promoting them — but it is preserved through to the
 *                  commit log so the audit trail records the intent.
 *
 * Error rows: a choice that references a `membershipId` not present in
 * `currentMemberships` is collected into the plan's `errors[]` rather
 * than thrown. The builder is pure and total — callers (preview, commit)
 * decide whether to short-circuit on errors or surface them in the diff.
 * This mirrors the way the bulk-roster CSV importer (Story #654) reports
 * row-level failures without aborting the whole batch.
 */

/** Operator-chosen disposition for one source-season membership. */
export type RolloverDecision = 'promote' | 'archive' | 'transfer';

/**
 * One operator decision keyed to a specific source-season membership.
 *
 * `targetTeamId` is required for `promote` and `transfer`; the builder
 * reports an error row when it is missing for those decisions. It is
 * ignored for `archive`.
 */
export interface RolloverChoice {
  readonly membershipId: string;
  readonly decision: RolloverDecision;
  readonly targetTeamId?: string;
}

/**
 * Snapshot of one membership in the source season. The builder treats
 * `endedAt` as the only meaningful lifecycle field — an already-ended
 * row is a no-op for any decision.
 */
export interface MembershipSnapshot {
  readonly id: string;
  readonly orgId: string;
  readonly teamId: string;
  readonly athleteUserId: string;
  readonly endedAt: Date | null;
}

/**
 * A planned "end-date this membership" write. The commit step issues
 * an `UPDATE athlete_memberships SET ended_at = NOW() WHERE id = ?`
 * for each entry.
 */
export interface ArchiveWrite {
  readonly membershipId: string;
  readonly athleteUserId: string;
  readonly sourceTeamId: string;
  readonly reason: 'promote' | 'archive' | 'transfer';
}

/**
 * A planned "create a successor membership" write. The commit step
 * issues an `INSERT INTO athlete_memberships (org_id, team_id,
 * athlete_user_id) VALUES (?, ?, ?)` for each entry.
 *
 * `reason` carries the editorial distinction between `promote` and
 * `transfer` so the audit trail preserves the operator intent.
 */
export interface PromotionWrite {
  readonly athleteUserId: string;
  readonly orgId: string;
  readonly sourceTeamId: string;
  readonly targetTeamId: string;
  readonly reason: 'promote' | 'transfer';
}

/**
 * Codes the builder may emit for one error row.
 *
 *   - `UNKNOWN_MEMBERSHIP` — the choice references a `membershipId`
 *     that does not appear in `currentMemberships`.
 *   - `MISSING_TARGET_TEAM` — a `promote` or `transfer` decision did
 *     not carry a `targetTeamId`.
 *   - `ALREADY_ENDED` — the membership row is already end-dated; the
 *     decision is a no-op against the live roster.
 */
export type RolloverErrorCode = 'UNKNOWN_MEMBERSHIP' | 'MISSING_TARGET_TEAM' | 'ALREADY_ENDED';

export interface RolloverError {
  readonly membershipId: string;
  readonly code: RolloverErrorCode;
}

/**
 * The deterministic plan the builder returns. Every collection is
 * sorted by `membershipId` (archives, errors) or by `athleteUserId`
 * (promotions) so the preview/commit equality check is order-independent
 * across runs — the JSON shape the client sends back is compared against
 * the JSON shape the server recomputes on commit.
 *
 * `archives` lists end-date writes for `archive` AND for the
 * source-side of `promote` / `transfer` (which also end-date the source
 * row). `promotions` lists the new-row inserts for `promote` and
 * `transfer` only.
 */
export interface RolloverPlan {
  readonly archives: ReadonlyArray<ArchiveWrite>;
  readonly promotions: ReadonlyArray<PromotionWrite>;
  readonly errors: ReadonlyArray<RolloverError>;
}

function sortByMembershipId<T extends { membershipId: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (a.membershipId < b.membershipId ? -1 : 1));
}

function sortByAthleteThenTarget<T extends { athleteUserId: string; targetTeamId: string }>(
  rows: T[],
): T[] {
  return [...rows].sort((a, b) => {
    if (a.athleteUserId !== b.athleteUserId) {
      return a.athleteUserId < b.athleteUserId ? -1 : 1;
    }
    return a.targetTeamId < b.targetTeamId ? -1 : 1;
  });
}

/**
 * Build a rollover plan from the source-season snapshot + operator
 * choices. See module-level docstring for the full semantics.
 */
export function buildPlan(
  currentMemberships: ReadonlyArray<MembershipSnapshot>,
  choices: ReadonlyArray<RolloverChoice>,
): RolloverPlan {
  // Index source memberships by id for O(1) lookup. Source membership
  // ids are unique within a season; if the caller supplies a duplicate
  // the later entry wins (we treat the array as the source of truth
  // the caller already de-duplicated).
  const byId = new Map<string, MembershipSnapshot>();
  for (const m of currentMemberships) {
    byId.set(m.id, m);
  }

  const archives: ArchiveWrite[] = [];
  const promotions: PromotionWrite[] = [];
  const errors: RolloverError[] = [];

  for (const choice of choices) {
    const source = byId.get(choice.membershipId);
    if (!source) {
      errors.push({ membershipId: choice.membershipId, code: 'UNKNOWN_MEMBERSHIP' });
      continue;
    }

    if (source.endedAt !== null) {
      errors.push({ membershipId: choice.membershipId, code: 'ALREADY_ENDED' });
      continue;
    }

    if (choice.decision === 'archive') {
      archives.push({
        membershipId: source.id,
        athleteUserId: source.athleteUserId,
        sourceTeamId: source.teamId,
        reason: 'archive',
      });
      continue;
    }

    // promote / transfer — both need a target team.
    if (!choice.targetTeamId || choice.targetTeamId.length === 0) {
      errors.push({ membershipId: choice.membershipId, code: 'MISSING_TARGET_TEAM' });
      continue;
    }

    archives.push({
      membershipId: source.id,
      athleteUserId: source.athleteUserId,
      sourceTeamId: source.teamId,
      reason: choice.decision,
    });
    promotions.push({
      athleteUserId: source.athleteUserId,
      orgId: source.orgId,
      sourceTeamId: source.teamId,
      targetTeamId: choice.targetTeamId,
      reason: choice.decision,
    });
  }

  return {
    archives: sortByMembershipId(archives),
    promotions: sortByAthleteThenTarget(promotions),
    errors: sortByMembershipId(errors),
  };
}
