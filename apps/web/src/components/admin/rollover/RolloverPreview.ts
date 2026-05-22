// apps/web/src/components/admin/rollover/RolloverPreview.ts
//
// Pure-TS view-shape and rendering helpers for the season-rollover
// admin page (Epic #10 / Story #665 / Task #696). The `.astro` sibling
// (`apps/web/src/pages/admin/rollover.astro`) renders the empty shell
// and binds an inline browser-side `<script>` that uses these helpers
// to populate the decisions table and the preview diff in response to
// operator input.
//
// Why pure-TS rather than a React island? `@repo/web` does not wire
// `@astrojs/react`; every existing admin component pairs an `.astro`
// renderer with a sibling `.ts` module (see TeamForm.ts and
// RosterTable.ts for the load-bearing precedent). Standing up the full
// React island toolchain is foundation-level scope that belongs to its
// own infrastructure Story, not Story #665. The Task ACs are all
// behavior — render decisions, fetch preview, fetch commit — and the
// `data-testid` invariants are easier to test against a deterministic
// DOM render than a React reconciler. The Task's "RolloverPreview.tsx"
// wording reflects the planning shorthand; the implementation pattern
// matches the rest of the repo.

/**
 * Canonical data-testid values exposed by the season-rollover admin
 * surface. Locked by Task #696 ACs so the Task #694 acceptance scenario
 * can target stable selectors across re-renders. ANY change to one of
 * these strings is a breaking change to the acceptance suite — bump
 * the suite in the same PR.
 */
export const ROLLOVER_TEST_IDS = {
  sourceSeason: 'admin-rollover-source-season',
  targetSeason: 'admin-rollover-target-season',
  decisions: 'admin-rollover-decisions',
  decisionRow: 'admin-rollover-decision-row',
  decisionSelect: 'admin-rollover-decision-select',
  decisionTargetTeam: 'admin-rollover-decision-target-team',
  previewBtn: 'admin-rollover-preview-btn',
  commitBtn: 'admin-rollover-commit-btn',
  diff: 'admin-rollover-diff',
  status: 'admin-rollover-status',
  error: 'admin-rollover-error',
} as const;

/** Operator-chosen disposition for one source-season membership. */
export type RolloverDecision = 'promote' | 'archive' | 'transfer';

/**
 * Server-projected shape of one current source-season membership the
 * decisions table renders. The fields are the minimum the operator
 * needs to recognize the row (athlete name + team) plus the membership
 * id (the load-bearing key the plan builder consumes).
 */
export interface RolloverMembershipRow {
  readonly membershipId: string;
  readonly athleteName: string;
  readonly sourceTeamId: string;
  readonly sourceTeamName: string;
}

/**
 * One row of operator input collected from the decisions table. The
 * shape matches `RolloverChoiceInput` from
 * `@repo/shared/schemas/admin/rollover` (the wire schema), so the
 * inline script can post it verbatim.
 */
export interface RolloverChoiceDraft {
  readonly membershipId: string;
  readonly decision: RolloverDecision;
  readonly targetTeamId?: string;
}

/**
 * Plan shape returned by the preview/commit endpoints. Mirrors
 * `RolloverPlanSchema.data` from
 * `@repo/shared/schemas/admin/rollover`.
 */
export interface RolloverPlanView {
  readonly archives: ReadonlyArray<{
    readonly membershipId: string;
    readonly athleteUserId: string;
    readonly sourceTeamId: string;
    readonly reason: 'promote' | 'archive' | 'transfer';
  }>;
  readonly promotions: ReadonlyArray<{
    readonly athleteUserId: string;
    readonly orgId: string;
    readonly sourceTeamId: string;
    readonly targetTeamId: string;
    readonly reason: 'promote' | 'transfer';
  }>;
  readonly errors: ReadonlyArray<{
    readonly membershipId: string;
    readonly code: string;
  }>;
}

/**
 * Render one row per current source-season membership into the decisions
 * tbody. Each row carries a `data-membership-id` attribute and a
 * `<select>` for `decision` + a target-team `<input>` field that is
 * disabled when the decision is `archive`.
 *
 * Cells are populated via `textContent` — never `innerHTML` — so the
 * server-supplied projection cannot inject markup on the client. (Per
 * `.agents/rules/security-baseline.md` § Output & Rendering.)
 */
export function renderDecisionRows(
  tbody: HTMLTableSectionElement,
  rows: ReadonlyArray<RolloverMembershipRow>,
): void {
  while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
  for (const row of rows) {
    const tr = document.createElement('tr');
    tr.setAttribute('data-testid', ROLLOVER_TEST_IDS.decisionRow);
    tr.setAttribute('data-membership-id', row.membershipId);

    const nameCell = document.createElement('td');
    nameCell.setAttribute('data-col', 'athlete');
    nameCell.textContent = row.athleteName;
    tr.appendChild(nameCell);

    const teamCell = document.createElement('td');
    teamCell.setAttribute('data-col', 'team');
    teamCell.textContent = row.sourceTeamName;
    tr.appendChild(teamCell);

    const decisionCell = document.createElement('td');
    decisionCell.setAttribute('data-col', 'decision');
    const select = document.createElement('select');
    select.setAttribute('data-testid', ROLLOVER_TEST_IDS.decisionSelect);
    select.setAttribute('data-membership-id', row.membershipId);
    for (const value of ['promote', 'archive', 'transfer'] as const) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = value;
      select.appendChild(opt);
    }
    decisionCell.appendChild(select);
    tr.appendChild(decisionCell);

    const targetCell = document.createElement('td');
    targetCell.setAttribute('data-col', 'target-team');
    const targetInput = document.createElement('input');
    targetInput.setAttribute('type', 'text');
    targetInput.setAttribute('data-testid', ROLLOVER_TEST_IDS.decisionTargetTeam);
    targetInput.setAttribute('data-membership-id', row.membershipId);
    targetInput.setAttribute('placeholder', 'Target team id');
    targetCell.appendChild(targetInput);
    tr.appendChild(targetCell);

    tbody.appendChild(tr);
  }
}

/**
 * Collect the current decisions from the DOM. Returns one draft per
 * decision row. `archive` rows omit `targetTeamId` (the API treats an
 * empty target as a no-op for the archive decision).
 */
export function collectDecisionDrafts(tbody: HTMLTableSectionElement): RolloverChoiceDraft[] {
  const drafts: RolloverChoiceDraft[] = [];
  const rows = tbody.querySelectorAll<HTMLTableRowElement>(
    `[data-testid="${ROLLOVER_TEST_IDS.decisionRow}"]`,
  );
  for (const row of Array.from(rows)) {
    const membershipId = row.getAttribute('data-membership-id') ?? '';
    if (!membershipId) continue;
    const select = row.querySelector<HTMLSelectElement>(
      `[data-testid="${ROLLOVER_TEST_IDS.decisionSelect}"]`,
    );
    const targetInput = row.querySelector<HTMLInputElement>(
      `[data-testid="${ROLLOVER_TEST_IDS.decisionTargetTeam}"]`,
    );
    const decision = (select?.value ?? 'archive') as RolloverDecision;
    const targetTeamId = targetInput?.value.trim() ?? '';
    if (decision === 'archive') {
      drafts.push({ membershipId, decision });
    } else {
      drafts.push({ membershipId, decision, targetTeamId });
    }
  }
  return drafts;
}

/**
 * Render the preview/commit plan diff into the supplied container.
 * The diff is a flat list of `Promote / Archive / Transfer` lines per
 * planned write, plus an Errors section for any error rows. The text
 * is deliberately terse — the operator's eye is on the counts and the
 * row identity, not on prose.
 */
export function renderPlanDiff(container: HTMLElement, plan: RolloverPlanView): void {
  while (container.firstChild) container.removeChild(container.firstChild);

  const heading = document.createElement('h2');
  heading.textContent = 'Planned writes';
  container.appendChild(heading);

  const counts = document.createElement('p');
  counts.setAttribute('data-col', 'counts');
  counts.textContent = `Archives: ${plan.archives.length} · Promotions: ${plan.promotions.length} · Errors: ${plan.errors.length}`;
  container.appendChild(counts);

  if (plan.archives.length > 0) {
    const ul = document.createElement('ul');
    ul.setAttribute('data-col', 'archives');
    for (const a of plan.archives) {
      const li = document.createElement('li');
      li.textContent = `${a.reason}: end-date membership ${a.membershipId} (athlete ${a.athleteUserId})`;
      ul.appendChild(li);
    }
    container.appendChild(ul);
  }

  if (plan.promotions.length > 0) {
    const ul = document.createElement('ul');
    ul.setAttribute('data-col', 'promotions');
    for (const p of plan.promotions) {
      const li = document.createElement('li');
      li.textContent = `${p.reason}: athlete ${p.athleteUserId} -> team ${p.targetTeamId}`;
      ul.appendChild(li);
    }
    container.appendChild(ul);
  }

  if (plan.errors.length > 0) {
    const ul = document.createElement('ul');
    ul.setAttribute('data-col', 'errors');
    for (const e of plan.errors) {
      const li = document.createElement('li');
      li.textContent = `${e.code}: membership ${e.membershipId}`;
      ul.appendChild(li);
    }
    container.appendChild(ul);
  }
}

/**
 * Render the post-commit status line into the supplied container.
 * Reads the applied counts the API returned and surfaces them as plain
 * text the acceptance scenario can assert against.
 */
export function renderCommitStatus(
  container: HTMLElement,
  applied: { archived: number; promoted: number; errors: number },
): void {
  while (container.firstChild) container.removeChild(container.firstChild);
  container.textContent = `Applied — archived: ${applied.archived}, promoted: ${applied.promoted}, errors: ${applied.errors}`;
}
