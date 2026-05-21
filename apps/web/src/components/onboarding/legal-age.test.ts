// apps/web/src/components/onboarding/legal-age.test.ts
//
// Unit tests for the LegalAcceptanceCheckboxes and AgeAttestation
// pure-TS view-shape builders + complete-predicates. The `.astro`
// siblings render the surfaces and the OnboardingForm controller
// reads their checked state via dataset attributes; the builders +
// predicates are the testable surface.
//
// The submit-enabled invariant Task #583 locks down (both legal
// checkboxes ticked AND age attestation ticked) is exercised through
// the AND-composition of `legalAcceptanceComplete` and
// `ageAttestationComplete`. The full form's evaluator is tested
// independently in OnboardingForm.test.ts (Task #584).
//
// Story #574 / Task #583.
import { describe, expect, it } from 'vitest';
import {
  AGE_ATTESTATION_TEST_IDS,
  ageAttestationComplete,
  buildAgeAttestationView,
} from './AgeAttestation';
import {
  LEGAL_ACCEPTANCE_TEST_IDS,
  buildLegalAcceptanceView,
  legalAcceptanceComplete,
} from './LegalAcceptanceCheckboxes';

const PROPS = {
  termsOfServiceVersion: '1.2.0',
  termsOfServiceBodyUrl: '/legal/tos',
  privacyPolicyVersion: '2.0.0',
  privacyPolicyBodyUrl: '/legal/privacy',
} as const;

describe('buildLegalAcceptanceView', () => {
  it('threads the active ToS version into the rendered label verbatim', () => {
    const view = buildLegalAcceptanceView(PROPS);
    expect(view.tos.version).toBe('1.2.0');
    expect(view.tos.label).toContain('1.2.0');
  });

  it('threads the active Privacy version into the rendered label verbatim', () => {
    const view = buildLegalAcceptanceView(PROPS);
    expect(view.privacy.version).toBe('2.0.0');
    expect(view.privacy.label).toContain('2.0.0');
  });

  it('exposes the canonical onboarding-tos-checkbox and onboarding-privacy-checkbox testIds', () => {
    const view = buildLegalAcceptanceView(PROPS);
    expect(view.testIds.tosCheckbox).toBe('onboarding-tos-checkbox');
    expect(view.testIds.privacyCheckbox).toBe('onboarding-privacy-checkbox');
    expect(view.testIds).toBe(LEGAL_ACCEPTANCE_TEST_IDS);
  });

  it('throws TypeError when the ToS version is empty', () => {
    expect(() => buildLegalAcceptanceView({ ...PROPS, termsOfServiceVersion: '   ' })).toThrow(
      TypeError,
    );
  });

  it('throws TypeError when the Privacy version is empty', () => {
    expect(() => buildLegalAcceptanceView({ ...PROPS, privacyPolicyVersion: '' })).toThrow(
      TypeError,
    );
  });

  it('throws TypeError when the ToS bodyUrl is empty', () => {
    expect(() => buildLegalAcceptanceView({ ...PROPS, termsOfServiceBodyUrl: '' })).toThrow(
      TypeError,
    );
  });

  it('throws TypeError when the Privacy bodyUrl is empty', () => {
    expect(() => buildLegalAcceptanceView({ ...PROPS, privacyPolicyBodyUrl: '   ' })).toThrow(
      TypeError,
    );
  });
});

describe('legalAcceptanceComplete', () => {
  it('returns true only when both legal checkboxes are ticked', () => {
    expect(
      legalAcceptanceComplete({ acceptsTermsOfService: true, acceptsPrivacyPolicy: true }),
    ).toBe(true);
  });

  it('returns false when only the ToS checkbox is ticked', () => {
    expect(
      legalAcceptanceComplete({ acceptsTermsOfService: true, acceptsPrivacyPolicy: false }),
    ).toBe(false);
  });

  it('returns false when only the Privacy checkbox is ticked', () => {
    expect(
      legalAcceptanceComplete({ acceptsTermsOfService: false, acceptsPrivacyPolicy: true }),
    ).toBe(false);
  });

  it('returns false when neither checkbox is ticked', () => {
    expect(
      legalAcceptanceComplete({ acceptsTermsOfService: false, acceptsPrivacyPolicy: false }),
    ).toBe(false);
  });
});

describe('buildAgeAttestationView', () => {
  it('exposes the canonical onboarding-age-attestation testId', () => {
    const view = buildAgeAttestationView();
    expect(view.testIds.checkbox).toBe('onboarding-age-attestation');
    expect(view.testIds).toBe(AGE_ATTESTATION_TEST_IDS);
  });

  it('renders the >=13 attestation label exactly once', () => {
    const view = buildAgeAttestationView();
    expect(view.label).toContain('13');
  });
});

describe('ageAttestationComplete', () => {
  it('returns true only when isAtLeast13 is the literal true', () => {
    expect(ageAttestationComplete({ isAtLeast13: true })).toBe(true);
  });

  it('returns false when isAtLeast13 is false', () => {
    expect(ageAttestationComplete({ isAtLeast13: false })).toBe(false);
  });
});

describe('submit-enabled invariant (Task #583 AC)', () => {
  it('passes only when both legal checkboxes ticked AND age attestation ticked', () => {
    const cases: Array<{
      tos: boolean;
      privacy: boolean;
      age: boolean;
      expected: boolean;
    }> = [
      { tos: true, privacy: true, age: true, expected: true },
      { tos: true, privacy: true, age: false, expected: false },
      { tos: true, privacy: false, age: true, expected: false },
      { tos: false, privacy: true, age: true, expected: false },
      { tos: false, privacy: false, age: false, expected: false },
    ];

    for (const { tos, privacy, age, expected } of cases) {
      const result =
        legalAcceptanceComplete({
          acceptsTermsOfService: tos,
          acceptsPrivacyPolicy: privacy,
        }) && ageAttestationComplete({ isAtLeast13: age });
      expect(result).toBe(expected);
    }
  });
});
