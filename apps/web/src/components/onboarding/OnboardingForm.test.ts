// apps/web/src/components/onboarding/OnboardingForm.test.ts
//
// Unit tests for the OnboardingForm's pure-TS state evaluator,
// payload builder, schema gate, and server-error folder. The `.astro`
// sibling renders the form and the inline <script> wires the
// `submit-enabled` invariant to `evaluateOnboardingFormState`; the
// browser-side network call (`POST /api/v1/auth/onboard`) and the
// success-redirect to `/dashboard` are exercised end-to-end by the
// acceptance tier — this unit suite proves the evaluator gates the
// post in the first place and that the server-error envelope folds
// back into per-field errors.
//
// Story #574 / Task #584.
import { describe, expect, it } from 'vitest';
import {
  ONBOARDING_FORM_TEST_IDS,
  type OnboardingFormState,
  buildOnboardingPayload,
  createInitialOnboardingFormState,
  evaluateOnboardingFormState,
  foldServerErrorsIntoFieldMap,
  tryBuildOnboardingPayload,
} from './OnboardingForm';

function completeState(overrides: Partial<OnboardingFormState> = {}): OnboardingFormState {
  return {
    ...createInitialOnboardingFormState({
      termsOfServiceVersion: '1.2.0',
      privacyPolicyVersion: '2.0.0',
    }),
    firstName: 'Ada',
    lastName: 'Lovelace',
    displayName: 'Ada L.',
    acceptsTermsOfService: true,
    acceptsPrivacyPolicy: true,
    isAtLeast13: true,
    emailVerified: true,
    ...overrides,
  };
}

describe('createInitialOnboardingFormState', () => {
  it('seeds every text field empty and every checkbox unticked', () => {
    const state = createInitialOnboardingFormState({
      termsOfServiceVersion: '1.0.0',
      privacyPolicyVersion: '1.0.0',
    });
    expect(state.firstName).toBe('');
    expect(state.lastName).toBe('');
    expect(state.displayName).toBe('');
    expect(state.acceptsTermsOfService).toBe(false);
    expect(state.acceptsPrivacyPolicy).toBe(false);
    expect(state.isAtLeast13).toBe(false);
    expect(state.emailVerified).toBe(false);
    expect(state.profilePhotoUploadId).toBeNull();
  });

  it('threads the legal version strings into the seeded state verbatim', () => {
    const state = createInitialOnboardingFormState({
      termsOfServiceVersion: '7.7.7',
      privacyPolicyVersion: '9.9.9',
    });
    expect(state.termsOfServiceVersion).toBe('7.7.7');
    expect(state.privacyPolicyVersion).toBe('9.9.9');
  });
});

describe('evaluateOnboardingFormState — submit-enabled invariant', () => {
  it('returns canSubmit=true when every required field validates against OnboardInputSchema', () => {
    const result = evaluateOnboardingFormState(completeState());
    expect(result.canSubmit).toBe(true);
    expect(result.fieldErrors).toEqual({});
  });

  it('returns canSubmit=false when the email is not yet verified', () => {
    const result = evaluateOnboardingFormState(completeState({ emailVerified: false }));
    expect(result.canSubmit).toBe(false);
    expect(result.fieldErrors.email).toBeDefined();
  });

  it('returns canSubmit=false when the ToS checkbox is not ticked', () => {
    const result = evaluateOnboardingFormState(completeState({ acceptsTermsOfService: false }));
    expect(result.canSubmit).toBe(false);
    expect(result.fieldErrors.acceptsTermsOfService).toBeDefined();
  });

  it('returns canSubmit=false when the Privacy checkbox is not ticked', () => {
    const result = evaluateOnboardingFormState(completeState({ acceptsPrivacyPolicy: false }));
    expect(result.canSubmit).toBe(false);
    expect(result.fieldErrors.acceptsPrivacyPolicy).toBeDefined();
  });

  it('returns canSubmit=false when the age attestation checkbox is not ticked', () => {
    const result = evaluateOnboardingFormState(completeState({ isAtLeast13: false }));
    expect(result.canSubmit).toBe(false);
    expect(result.fieldErrors.isAtLeast13).toBeDefined();
  });

  it('returns canSubmit=false when firstName is empty or whitespace', () => {
    const result = evaluateOnboardingFormState(completeState({ firstName: '   ' }));
    expect(result.canSubmit).toBe(false);
    expect(result.fieldErrors.firstName).toBeDefined();
  });

  it('returns canSubmit=false when lastName is empty', () => {
    const result = evaluateOnboardingFormState(completeState({ lastName: '' }));
    expect(result.canSubmit).toBe(false);
    expect(result.fieldErrors.lastName).toBeDefined();
  });

  it('returns canSubmit=false when displayName is empty', () => {
    const result = evaluateOnboardingFormState(completeState({ displayName: '' }));
    expect(result.canSubmit).toBe(false);
    expect(result.fieldErrors.displayName).toBeDefined();
  });
});

describe('buildOnboardingPayload + tryBuildOnboardingPayload', () => {
  it('omits profilePhotoUploadId entirely when it is null (the optional-skip branch)', () => {
    const result = tryBuildOnboardingPayload(completeState({ profilePhotoUploadId: null }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect('profilePhotoUploadId' in result.value).toBe(false);
    }
  });

  it('threads a non-null profilePhotoUploadId into the payload', () => {
    const result = tryBuildOnboardingPayload(
      completeState({ profilePhotoUploadId: 'upload_abc_123' }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.profilePhotoUploadId).toBe('upload_abc_123');
    }
  });

  it('trims surrounding whitespace from firstName, lastName, and displayName', () => {
    const result = tryBuildOnboardingPayload(
      completeState({ firstName: '  Ada  ', lastName: '\tLovelace\n', displayName: ' Ada L. ' }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.profile.firstName).toBe('Ada');
      expect(result.value.profile.lastName).toBe('Lovelace');
      expect(result.value.profile.displayName).toBe('Ada L.');
    }
  });

  it('threads the active legal-version strings into the payload verbatim', () => {
    const result = tryBuildOnboardingPayload(completeState());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.legalAcceptances.termsOfServiceVersion).toBe('1.2.0');
      expect(result.value.legalAcceptances.privacyPolicyVersion).toBe('2.0.0');
    }
  });

  it('rejects with fieldErrors when isAtLeast13 is false (literal-true gate)', () => {
    const result = tryBuildOnboardingPayload(completeState({ isAtLeast13: false }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.fieldErrors).length).toBeGreaterThan(0);
    }
  });

  it('omits inviteToken entirely when it is null', () => {
    const payload = buildOnboardingPayload(completeState({ inviteToken: null })) as {
      inviteToken?: unknown;
    };
    expect('inviteToken' in payload).toBe(false);
  });
});

describe('foldServerErrorsIntoFieldMap', () => {
  it("folds the API edge's per-issue details into the per-field error map", () => {
    const errors = foldServerErrorsIntoFieldMap({
      code: 'VALIDATION_FAILED',
      message: 'Invalid input',
      details: [
        { path: ['profile', 'firstName'], message: 'First name is required.' },
        {
          path: ['ageAttestation', 'isAtLeast13'],
          message: 'Invalid literal value, expected true',
        },
      ],
    });
    expect(errors['profile.firstName']).toBe('First name is required.');
    expect(errors['ageAttestation.isAtLeast13']).toContain('expected true');
  });

  it('surfaces the envelope-level message as a form-level error when details is absent', () => {
    const errors = foldServerErrorsIntoFieldMap({
      code: 'CONFLICT',
      message: 'This account has already been onboarded.',
    });
    expect(errors.form).toBe('This account has already been onboarded.');
  });

  it('returns an empty map when the envelope is malformed (no message, no details)', () => {
    const errors = foldServerErrorsIntoFieldMap({ code: 'UNKNOWN' });
    expect(errors).toEqual({});
  });
});

describe('canonical data-testids (Task #584 AC)', () => {
  it('exposes the canonical onboarding-form and onboarding-submit testIds', () => {
    expect(ONBOARDING_FORM_TEST_IDS.form).toBe('onboarding-form');
    expect(ONBOARDING_FORM_TEST_IDS.submit).toBe('onboarding-submit');
  });
});
