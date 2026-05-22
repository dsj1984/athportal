// apps/web/src/components/admin/OrgConfigForm.test.ts
//
// Unit tests for the admin org-config form's pure-TS state evaluator,
// payload builder, and server-error folder (Epic #10 / Story #656 /
// Task #674).
//
// The `.astro` sibling renders the form markup; the web Vitest project
// runs in node env with no JSX/Astro renderer, so the pure-TS builders
// are the testable surface. The acceptance scenario at
// `tests/features/org-admin/org-config.feature` exercises the full
// click-and-save journey end-to-end via Playwright-bdd.

import { describe, expect, it } from 'vitest';
import {
  ORG_CONFIG_FORM_TEST_IDS,
  type OrgConfigFormState,
  type OrgConfigLoaderPayload,
  buildOrgConfigPatchPayload,
  createInitialOrgConfigFormState,
  evaluateOrgConfigFormState,
  foldServerErrorIntoFieldMap,
  tryBuildOrgConfigPatchPayload,
} from './OrgConfigForm';

function loaderFixture(overrides: Partial<OrgConfigLoaderPayload> = {}): OrgConfigLoaderPayload {
  return {
    id: 'org-a',
    name: 'Alpha Athletics',
    sports: [],
    contactEmail: null,
    contactPhone: null,
    primaryColorHex: null,
    logoUrl: null,
    ...overrides,
  };
}

describe('ORG_CONFIG_FORM_TEST_IDS', () => {
  // The IDs below are load-bearing — they appear verbatim in the
  // Story #656 / Task #674 acceptance criteria and in the matching
  // Gherkin scenario. Lock them with a snapshot-equivalent assertion
  // so a careless rename fails CI loudly.
  it('exposes the load-bearing data-testid surface', () => {
    expect(ORG_CONFIG_FORM_TEST_IDS.form).toBe('admin-org-config-form');
    expect(ORG_CONFIG_FORM_TEST_IDS.status).toBe('admin-org-config-status');
    expect(ORG_CONFIG_FORM_TEST_IDS.logo).toBe('admin-org-logo-input');
    expect(ORG_CONFIG_FORM_TEST_IDS.primaryColor).toBe('admin-org-primary-color-input');
  });
});

describe('createInitialOrgConfigFormState', () => {
  it('populates every field from the loader payload', () => {
    const loader = loaderFixture({
      name: 'Beta Boosters',
      primaryColorHex: '#112233',
      logoUrl: 'https://cdn.example.invalid/logos/org-a/abc.png',
    });

    const state = createInitialOrgConfigFormState(loader);

    expect(state.name).toBe('Beta Boosters');
    expect(state.primaryColorHex).toBe('#112233');
    // logoR2Key is null at mount — the user uploads a new file to set it.
    expect(state.logoR2Key).toBeNull();
  });

  it('collapses null colour to an empty string for the controlled input', () => {
    const state = createInitialOrgConfigFormState(loaderFixture({ primaryColorHex: null }));
    expect(state.primaryColorHex).toBe('');
  });
});

describe('evaluateOrgConfigFormState', () => {
  function state(overrides: Partial<OrgConfigFormState> = {}): OrgConfigFormState {
    return {
      name: 'Alpha',
      primaryColorHex: '',
      logoR2Key: null,
      ...overrides,
    };
  }

  it('allows submit when name is present and colour is empty', () => {
    const evaluation = evaluateOrgConfigFormState(state());
    expect(evaluation.canSubmit).toBe(true);
    expect(evaluation.fieldErrors).toEqual({});
  });

  it('blocks submit when name is blank', () => {
    const evaluation = evaluateOrgConfigFormState(state({ name: '   ' }));
    expect(evaluation.canSubmit).toBe(false);
    expect(evaluation.fieldErrors.name).toMatch(/required/i);
  });

  it('blocks submit when colour does not match the hex pattern', () => {
    const evaluation = evaluateOrgConfigFormState(state({ primaryColorHex: 'not-a-hex' }));
    expect(evaluation.canSubmit).toBe(false);
    expect(evaluation.fieldErrors.primaryColorHex).toMatch(/#RRGGBB/);
  });

  it('accepts a valid 7-character hex colour', () => {
    const evaluation = evaluateOrgConfigFormState(state({ primaryColorHex: '#abcdef' }));
    expect(evaluation.canSubmit).toBe(true);
  });
});

describe('buildOrgConfigPatchPayload', () => {
  it('omits the colour key when the input is empty', () => {
    const payload = buildOrgConfigPatchPayload({
      name: 'Alpha',
      primaryColorHex: '',
      logoR2Key: null,
    });
    expect(payload).toEqual({ name: 'Alpha' });
  });

  it('includes the logo key when set', () => {
    const payload = buildOrgConfigPatchPayload({
      name: 'Alpha',
      primaryColorHex: '#aabbcc',
      logoR2Key: 'logos/org-a/abc.png',
    });
    expect(payload).toEqual({
      name: 'Alpha',
      primaryColorHex: '#aabbcc',
      logoR2Key: 'logos/org-a/abc.png',
    });
  });
});

describe('tryBuildOrgConfigPatchPayload', () => {
  it('returns ok when the state passes the strict schema', () => {
    const result = tryBuildOrgConfigPatchPayload({
      name: 'Alpha',
      primaryColorHex: '#112233',
      logoR2Key: null,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ name: 'Alpha', primaryColorHex: '#112233' });
    }
  });

  it('returns the per-field errors when validation fails', () => {
    const result = tryBuildOrgConfigPatchPayload({
      name: '',
      primaryColorHex: 'not-hex',
      logoR2Key: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.name).toBeDefined();
    }
  });
});

describe('foldServerErrorIntoFieldMap', () => {
  it('routes a "<field>: <reason>" message to the matching field slot', () => {
    const errors = foldServerErrorIntoFieldMap({
      code: 'VALIDATION_ERROR',
      message: 'primaryColorHex: primaryColorHex must match /^#[0-9a-f]{6}$/i',
    });
    expect(errors.primaryColorHex).toContain('match');
  });

  it('falls through to the form slot for an unknown path', () => {
    const errors = foldServerErrorIntoFieldMap({
      code: 'INTERNAL',
      message: 'Service temporarily unavailable.',
    });
    expect(errors.form).toBe('Service temporarily unavailable.');
  });
});
