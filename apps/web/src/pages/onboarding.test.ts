import type { ActiveLegalDocuments } from '@repo/shared/db/queries/legalDocuments';
// apps/web/src/pages/onboarding.test.ts
//
// Unit tests for the `/onboarding` page view-shape builder. The
// `.astro` sibling renders the page; the web Vitest project runs in
// node env with no JSX/Astro renderer, so the builder is the
// testable surface — mirrors the EmptyState.ts pattern.
//
// Story #574 / Task #580.
import { describe, expect, it } from 'vitest';
import { ONBOARDING_PAGE_TEST_IDS, buildOnboardingPageView } from './_onboarding';

function makeActiveDocs(
  overrides: {
    tosVersion?: string;
    tosBodyUrl?: string;
    privacyVersion?: string;
    privacyBodyUrl?: string;
  } = {},
): ActiveLegalDocuments {
  const now = new Date();
  return {
    termsOfService: {
      id: 'tos-1',
      kind: 'terms_of_service',
      version: overrides.tosVersion ?? '1.2.0',
      effectiveAt: now,
      bodyUrl: overrides.tosBodyUrl ?? '/legal/tos',
    },
    privacyPolicy: {
      id: 'privacy-1',
      kind: 'privacy_policy',
      version: overrides.privacyVersion ?? '2.0.0',
      effectiveAt: now,
      bodyUrl: overrides.privacyBodyUrl ?? '/legal/privacy',
    },
  };
}

describe('buildOnboardingPageView', () => {
  it('exposes the canonical data-testids the acceptance tier targets', () => {
    const view = buildOnboardingPageView(makeActiveDocs());
    // The six invariants Task #580 ACs lock down, plus the two email
    // surfaces Task #582 owns, all flow through the page's testIds
    // map so a future rename of any single id breaks here first.
    expect(view.testIds.form).toBe('onboarding-form');
    expect(view.testIds.submit).toBe('onboarding-submit');
    expect(view.testIds.tosCheckbox).toBe('onboarding-tos-checkbox');
    expect(view.testIds.privacyCheckbox).toBe('onboarding-privacy-checkbox');
    expect(view.testIds.ageAttestation).toBe('onboarding-age-attestation');
    expect(view.testIds.photoUpload).toBe('onboarding-photo-upload');
    expect(view.testIds.emailStatus).toBe('onboarding-email-status');
    expect(view.testIds.emailResend).toBe('onboarding-email-resend');
    expect(view.testIds).toBe(ONBOARDING_PAGE_TEST_IDS);
  });

  it('threads the SSR-fetched ToS version and bodyUrl into the page view verbatim', () => {
    const view = buildOnboardingPageView(
      makeActiveDocs({ tosVersion: '7.7.7', tosBodyUrl: '/legal/tos?v=7.7.7' }),
    );
    expect(view.legalAcceptances.termsOfServiceVersion).toBe('7.7.7');
    expect(view.legalAcceptances.termsOfServiceBodyUrl).toBe('/legal/tos?v=7.7.7');
  });

  it('threads the SSR-fetched Privacy version and bodyUrl into the page view verbatim', () => {
    const view = buildOnboardingPageView(
      makeActiveDocs({ privacyVersion: '9.9.9', privacyBodyUrl: '/legal/privacy?v=9' }),
    );
    expect(view.legalAcceptances.privacyPolicyVersion).toBe('9.9.9');
    expect(view.legalAcceptances.privacyPolicyBodyUrl).toBe('/legal/privacy?v=9');
  });

  it('throws TypeError when the active ToS row is missing a version', () => {
    expect(() => buildOnboardingPageView(makeActiveDocs({ tosVersion: '   ' }))).toThrow(TypeError);
  });

  it('throws TypeError when the active ToS row is missing a bodyUrl', () => {
    expect(() => buildOnboardingPageView(makeActiveDocs({ tosBodyUrl: '' }))).toThrow(TypeError);
  });

  it('throws TypeError when the active Privacy row is missing a version', () => {
    expect(() => buildOnboardingPageView(makeActiveDocs({ privacyVersion: '' }))).toThrow(
      TypeError,
    );
  });

  it('throws TypeError when the active Privacy row is missing a bodyUrl', () => {
    expect(() => buildOnboardingPageView(makeActiveDocs({ privacyBodyUrl: '   ' }))).toThrow(
      TypeError,
    );
  });

  it('produces non-empty heading, intro, and title copy for the page chrome', () => {
    const view = buildOnboardingPageView(makeActiveDocs());
    expect(view.title.length).toBeGreaterThan(0);
    expect(view.heading.length).toBeGreaterThan(0);
    expect(view.intro.length).toBeGreaterThan(0);
  });
});
