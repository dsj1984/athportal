// apps/web/src/components/onboarding/LegalAcceptanceCheckboxes.ts
//
// Pure-TS view-shape + state-evaluator for the LegalAcceptanceCheckboxes
// island. The `.astro` sibling renders the two checkboxes (ToS, Privacy)
// bound to the active version strings passed as props; the inline
// `<script>` mirrors the checked state onto the dataset attributes so
// `OnboardingForm.astro`'s controller can read it without DOM queries.
//
// Story #574 / Task #583. Tech Spec #490.

/** Canonical data-testids exposed by the legal-acceptance island. */
export const LEGAL_ACCEPTANCE_TEST_IDS = {
  root: 'onboarding-legal-island',
  tosCheckbox: 'onboarding-tos-checkbox',
  privacyCheckbox: 'onboarding-privacy-checkbox',
} as const;

/**
 * Props the island receives. The version strings are the active rows
 * the SSR page fetched via `getActiveLegalDocuments(db)`; they flow
 * verbatim into the form payload so the API edge can re-validate
 * against the `legalDocuments` table at write-time.
 */
export interface LegalAcceptanceProps {
  readonly termsOfServiceVersion: string;
  readonly termsOfServiceBodyUrl: string;
  readonly privacyPolicyVersion: string;
  readonly privacyPolicyBodyUrl: string;
}

/** Working state the inline `<script>` mutates on every checkbox change. */
export interface LegalAcceptanceState {
  readonly acceptsTermsOfService: boolean;
  readonly acceptsPrivacyPolicy: boolean;
}

/** Render-time view shape consumed by the `.astro` sibling. */
export interface LegalAcceptanceView {
  readonly tos: {
    readonly version: string;
    readonly bodyUrl: string;
    readonly label: string;
  };
  readonly privacy: {
    readonly version: string;
    readonly bodyUrl: string;
    readonly label: string;
  };
  readonly testIds: typeof LEGAL_ACCEPTANCE_TEST_IDS;
}

/**
 * Project the SSR-fetched version strings into the render-ready view.
 * Throws `TypeError` when either version or bodyUrl is empty — see
 * `onboarding.ts § buildOnboardingPageView` for the matching SSR-side
 * defensive check.
 */
export function buildLegalAcceptanceView(props: LegalAcceptanceProps): LegalAcceptanceView {
  if (props.termsOfServiceVersion.trim().length === 0) {
    throw new TypeError('LegalAcceptanceCheckboxes: `termsOfServiceVersion` must be non-empty.');
  }
  if (props.privacyPolicyVersion.trim().length === 0) {
    throw new TypeError('LegalAcceptanceCheckboxes: `privacyPolicyVersion` must be non-empty.');
  }
  if (props.termsOfServiceBodyUrl.trim().length === 0) {
    throw new TypeError('LegalAcceptanceCheckboxes: `termsOfServiceBodyUrl` must be non-empty.');
  }
  if (props.privacyPolicyBodyUrl.trim().length === 0) {
    throw new TypeError('LegalAcceptanceCheckboxes: `privacyPolicyBodyUrl` must be non-empty.');
  }
  return {
    tos: {
      version: props.termsOfServiceVersion,
      bodyUrl: props.termsOfServiceBodyUrl,
      label: `I have read and accept the Terms of Service (version ${props.termsOfServiceVersion}).`,
    },
    privacy: {
      version: props.privacyPolicyVersion,
      bodyUrl: props.privacyPolicyBodyUrl,
      label: `I have read and accept the Privacy Policy (version ${props.privacyPolicyVersion}).`,
    },
    testIds: LEGAL_ACCEPTANCE_TEST_IDS,
  };
}

/**
 * Both checkboxes ticked. The OnboardingForm's submit-enabled
 * invariant requires this to be `true` as a precondition.
 */
export function legalAcceptanceComplete(state: LegalAcceptanceState): boolean {
  return state.acceptsTermsOfService && state.acceptsPrivacyPolicy;
}
