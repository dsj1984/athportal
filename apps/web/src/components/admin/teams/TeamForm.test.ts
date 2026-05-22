// apps/web/src/components/admin/teams/TeamForm.test.ts
//
// Unit tests for the pure-TS evaluator behind the TeamForm Astro
// component (Story #657 / Task #676). Targets the same surfaces the
// inline browser script consumes:
//
//   - `tryBuildCreatePayload` — accepts a fully-filled state, rejects
//     a missing-field state with a per-field error map.
//   - `tryBuildUpdatePayload` — diffs current vs initial, returns only
//     changed fields, rejects a no-op edit.
//   - `TEAM_FORM_TEST_IDS` / `TEAMS_LIST_TEST_IDS` — the contract
//     surface the acceptance tier locks against.

import { describe, expect, it } from 'vitest';
import {
  TEAMS_LIST_TEST_IDS,
  TEAM_FORM_TEST_IDS,
  emptyTeamFormState,
  tryBuildCreatePayload,
  tryBuildUpdatePayload,
} from './TeamForm';

describe('TEAM_FORM_TEST_IDS', () => {
  it('pins the create / edit form testids', () => {
    expect(TEAM_FORM_TEST_IDS.createForm).toBe('admin-team-create-form');
    expect(TEAM_FORM_TEST_IDS.editForm).toBe('admin-team-edit-form');
  });
});

describe('TEAMS_LIST_TEST_IDS', () => {
  it('pins the list / archive testids', () => {
    expect(TEAMS_LIST_TEST_IDS.list).toBe('admin-teams-list');
    expect(TEAMS_LIST_TEST_IDS.showArchivedToggle).toBe('admin-teams-show-archived');
    expect(TEAMS_LIST_TEST_IDS.archiveButton).toBe('admin-team-archive-btn');
  });
});

describe('tryBuildCreatePayload', () => {
  it('returns ok with the parsed payload when every field is filled', () => {
    const result = tryBuildCreatePayload({
      name: 'Varsity Volleyball',
      sport: 'Volleyball',
      season: 'Fall 2026',
      ageGroup: 'Varsity',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        name: 'Varsity Volleyball',
        sport: 'Volleyball',
        season: 'Fall 2026',
        ageGroup: 'Varsity',
      });
    }
  });

  it('returns per-field errors for an empty state', () => {
    const result = tryBuildCreatePayload(emptyTeamFormState());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Zod reports the first issue per field; presence is enough.
      expect(Object.keys(result.fieldErrors).length).toBeGreaterThan(0);
    }
  });

  it('returns a per-field error keyed by the missing field name', () => {
    const result = tryBuildCreatePayload({
      name: 'Team',
      sport: 'Sport',
      season: '',
      ageGroup: 'U14',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.season).toBeDefined();
    }
  });
});

describe('tryBuildUpdatePayload', () => {
  it('returns only the changed fields when one field is edited', () => {
    const initial = {
      name: 'Old Name',
      sport: 'Volleyball',
      season: 'Fall 2026',
      ageGroup: 'U14',
    };
    const current = { ...initial, name: 'New Name' };
    const result = tryBuildUpdatePayload(current, initial);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ name: 'New Name' });
    }
  });

  it('returns multiple changed fields when several are edited', () => {
    const initial = {
      name: 'Old',
      sport: 'Soccer',
      season: 'Spring 2026',
      ageGroup: 'U10',
    };
    const current = {
      name: 'Old',
      sport: 'Tennis',
      season: 'Spring 2027',
      ageGroup: 'U10',
    };
    const result = tryBuildUpdatePayload(current, initial);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ sport: 'Tennis', season: 'Spring 2027' });
    }
  });

  it('rejects a no-op edit (empty patch)', () => {
    const initial = {
      name: 'Same',
      sport: 'Same',
      season: 'Same',
      ageGroup: 'Same',
    };
    const result = tryBuildUpdatePayload(initial, initial);
    expect(result.ok).toBe(false);
  });
});
