// apps/web/src/components/admin/teams/TeamForm.ts
//
// Pure-TS view-shape and submit helpers for the TeamForm Astro
// component (Epic #10 / Story #657 / Task #676). The `.astro` sibling
// renders the form markup and binds a browser-side `<script>` that
// calls `tryBuildTeamPayload` on submit and POSTs/PATCHes to
// `/api/v1/admin/teams[/:id]`.
//
// Why pure-TS rather than a React + react-hook-form island? `@repo/web`
// does not wire `@astrojs/react`. Every existing component pairs an
// `.astro` renderer with a sibling `.ts` builder (see OnboardingForm.ts
// for the load-bearing precedent). Standing up the full React island
// toolchain is foundation-level scope that belongs to its own
// infrastructure Story, not Story #657. The Task ACs are all behavior
// (data-testid invariance, success-redirect, server-error display),
// satisfied by a pure-TS evaluator driving an inline Astro <script>
// against the same `TeamCreateInputSchema` / `TeamUpdateInputSchema`
// the API edge validates.

import {
  type TeamCreateInput,
  TeamCreateInputSchema,
  type TeamUpdateInput,
  TeamUpdateInputSchema,
} from '@repo/shared/schemas/admin/teams';

/**
 * Canonical data-testid values exposed by the Team CRUD surface. Locked
 * by Task #676 ACs so acceptance scenarios (Task #677) can target
 * stable selectors across re-renders.
 */
export const TEAM_FORM_TEST_IDS = {
  createForm: 'admin-team-create-form',
  editForm: 'admin-team-edit-form',
  nameInput: 'admin-team-name',
  sportInput: 'admin-team-sport',
  seasonInput: 'admin-team-season',
  ageGroupInput: 'admin-team-age-group',
  submit: 'admin-team-submit',
  formError: 'admin-team-form-error',
} as const;

export const TEAMS_LIST_TEST_IDS = {
  list: 'admin-teams-list',
  row: 'admin-teams-row',
  showArchivedToggle: 'admin-teams-show-archived',
  createLink: 'admin-teams-create-link',
  emptyState: 'admin-teams-empty',
  archiveButton: 'admin-team-archive-btn',
  editLink: 'admin-team-edit-link',
} as const;

/**
 * Mutable working state captured from the form inputs after each
 * change. Mirrors the four user-facing columns the API accepts.
 */
export interface TeamFormState {
  readonly name: string;
  readonly sport: string;
  readonly season: string;
  readonly ageGroup: string;
}

export function emptyTeamFormState(): TeamFormState {
  return { name: '', sport: '', season: '', ageGroup: '' };
}

/**
 * Result of attempting to build a create-payload. On success carries the
 * Zod-validated `TeamCreateInput`; on failure carries a per-field error
 * map keyed by the form's `name` attribute so the inline script can
 * render inline errors.
 */
export type BuildCreateResult =
  | { ok: true; value: TeamCreateInput }
  | { ok: false; fieldErrors: Readonly<Record<string, string>> };

export function tryBuildCreatePayload(state: TeamFormState): BuildCreateResult {
  const parsed = TeamCreateInputSchema.safeParse({
    name: state.name,
    sport: state.sport,
    season: state.season,
    ageGroup: state.ageGroup,
  });
  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }
  return { ok: false, fieldErrors: foldZodIssues(parsed.error.issues) };
}

/**
 * Result of attempting to build a patch-payload. PATCH semantics mean
 * an empty payload is a hard validation error at the boundary — the
 * shared Zod schema rejects it.
 */
export type BuildUpdateResult =
  | { ok: true; value: TeamUpdateInput }
  | { ok: false; fieldErrors: Readonly<Record<string, string>> };

export function tryBuildUpdatePayload(
  current: TeamFormState,
  initial: TeamFormState,
): BuildUpdateResult {
  // Only include fields that the user actually changed. This keeps the
  // PATCH payload minimal AND lets the server-side `.refine()` non-
  // empty guard fire when the user submits a no-op edit.
  const patch: Partial<TeamCreateInput> = {};
  if (current.name !== initial.name) patch.name = current.name;
  if (current.sport !== initial.sport) patch.sport = current.sport;
  if (current.season !== initial.season) patch.season = current.season;
  if (current.ageGroup !== initial.ageGroup) patch.ageGroup = current.ageGroup;

  const parsed = TeamUpdateInputSchema.safeParse(patch);
  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }
  return { ok: false, fieldErrors: foldZodIssues(parsed.error.issues) };
}

interface ZodIssueLike {
  readonly path: ReadonlyArray<PropertyKey>;
  readonly message: string;
}

function foldZodIssues(issues: ReadonlyArray<ZodIssueLike>): Record<string, string> {
  const map: Record<string, string> = {};
  for (const issue of issues) {
    const head = issue.path[0];
    const key = typeof head === 'string' && head.length > 0 ? head : 'form';
    if (!(key in map)) {
      map[key] = issue.message;
    }
  }
  if (Object.keys(map).length === 0) {
    map.form = 'Please fill out every field before submitting.';
  }
  return map;
}
