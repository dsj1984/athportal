// apps/web/src/pages/_onboarding.ts
//
// Pure-TS view-shape builder for the `/onboarding` route. Mirrors the
// pattern set by `pages/_dashboard.ts`: the `.astro` sibling consumes
// `buildOnboardingPageView(activeLegalDocuments)` and renders the five
// islands in their canonical order. The unit tests target the builder
// directly because the web Vitest project runs in `node` env with no
// JSX/Astro renderer wired in (see `apps/web/vitest.config.ts`).
//
// Prefixed with `_` so Astro does not register this module as a route.
// Astro's router ignores any file whose name starts with `_`, which
// prevents the boot-time "route defined in both .ts and .astro" warning
// that fires when a plain `.ts` sits alongside its `.astro` sibling in
// the pages directory (Story #1068).
//
// Story #574 / Task #580. Tech Spec #490. PRD #489.

import type { ActiveLegalDocuments } from '@repo/shared/db/queries/legalDocuments';

/** Canonical data-testids exposed by the `/onboarding` route surface. */
export const ONBOARDING_PAGE_TEST_IDS = {
  form: 'onboarding-form',
  submit: 'onboarding-submit',
  tosCheckbox: 'onboarding-tos-checkbox',
  privacyCheckbox: 'onboarding-privacy-checkbox',
  ageAttestation: 'onboarding-age-attestation',
  photoUpload: 'onboarding-photo-upload',
  emailStatus: 'onboarding-email-status',
  emailResend: 'onboarding-email-resend',
} as const;

/**
 * Render-time view shape for the page. Carries only data the `.astro`
 * page needs to pass into the island components — the version strings
 * the legal-acceptance island binds to, and the page-level page title.
 *
 * The shape stays minimal on purpose: the page is a composition root
 * for five islands, not a data-rich surface. The islands themselves
 * own their respective working state.
 */
export interface OnboardingPageView {
  readonly title: string;
  readonly heading: string;
  readonly intro: string;
  readonly legalAcceptances: {
    readonly termsOfServiceVersion: string;
    readonly termsOfServiceBodyUrl: string;
    readonly privacyPolicyVersion: string;
    readonly privacyPolicyBodyUrl: string;
  };
  readonly testIds: typeof ONBOARDING_PAGE_TEST_IDS;
}

/**
 * Project the SSR-fetched legal documents into the page view. The page
 * `.astro` is the only call site — it reads the two active rows via
 * `getActiveLegalDocuments(db)` at request time and hands them here.
 *
 * Throws `TypeError` when either kind is missing its version or
 * `bodyUrl` — the API edge already enforces that an "active" row has
 * a non-empty version and bodyUrl, so a missing value here means the
 * SSR fetch returned a corrupted row and the page should fail loudly
 * rather than render a half-broken legal-acceptance checkbox.
 */
export function buildOnboardingPageView(
  activeLegalDocuments: ActiveLegalDocuments,
): OnboardingPageView {
  const { termsOfService, privacyPolicy } = activeLegalDocuments;
  if (termsOfService.version.trim().length === 0) {
    throw new TypeError('OnboardingPage: active terms-of-service row is missing a version.');
  }
  if (termsOfService.bodyUrl.trim().length === 0) {
    throw new TypeError('OnboardingPage: active terms-of-service row is missing a bodyUrl.');
  }
  if (privacyPolicy.version.trim().length === 0) {
    throw new TypeError('OnboardingPage: active privacy-policy row is missing a version.');
  }
  if (privacyPolicy.bodyUrl.trim().length === 0) {
    throw new TypeError('OnboardingPage: active privacy-policy row is missing a bodyUrl.');
  }
  return {
    title: 'Finish setting up your account',
    heading: 'Finish setting up your account',
    intro:
      'Tell us your name, accept the latest Terms of Service and Privacy Policy, confirm you are 13 or older, and verify your email to continue.',
    legalAcceptances: {
      termsOfServiceVersion: termsOfService.version,
      termsOfServiceBodyUrl: termsOfService.bodyUrl,
      privacyPolicyVersion: privacyPolicy.version,
      privacyPolicyBodyUrl: privacyPolicy.bodyUrl,
    },
    testIds: ONBOARDING_PAGE_TEST_IDS,
  };
}
